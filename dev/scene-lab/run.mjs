#!/usr/bin/env node
/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Scene lab runner (SPEC-M0 §9.4). Runs INSIDE
 * mcr.microsoft.com/playwright:v1.49.1-jammy (see run.sh) with dev/scene-lab
 * mounted at /work and --network none. Serves dist/ itself over node:http
 * with COOP/COEP (as in the engine spike) and drives Chromium at 1920×1080.
 *
 *   node run.mjs --mode gates     deterministic Phase-1 gates + scene contract checks (exit 1 on failure)
 *   node run.mjs --mode measure   Phase-2 measurement report (out/report.md, no gate), incl.
 *                                 page memory with the two canvases (memory.js) and the GPU
 *                                 evidence of the run (gpu.js)
 *   add --gpu when the container got /dev/dri (run.sh KNORKE_GPU=1)
 *   add --label <x> (run.sh KNORKE_LAB_LABEL, ^[a-z0-9-]{1,24}$) to tell two runs of one variant apart
 *
 * Report names (SPEC-M1 §9.0 (R15)/(R16) "Laufbelege", names.js): gates →
 * gates-<cpu|gpu>[-<label>].{json,md}; measure → measure-<browser>-<cpu|gpu>
 * [-<set>][-noshadow][-<label>].json and report-<…>.md (-noshadow with
 * --shadows off, K8); gates.{json,md}, measure.json
 * and report.md are copies of the last run. The files of this run are
 * removed before it starts.
 *
 * Measurement mode only (the gates always run in Chromium at 1920×1080, DPR 1):
 *   --browser chromium|webkit   engine (run.sh KNORKE_LAB_BROWSER; default chromium). WebKit is
 *                               Playwright's WPE build, headless, as an approximation of Safari
 *                               (SPEC-M1 §16), never an iPad value
 *   --viewport WxH --dpr N      viewport and device pixel ratio (default 1920x1080, 1)
 *   --webkit-skia cpu|gpu       WebKit only: "cpu" is Playwright's launcher, which forces
 *                               WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 in headless mode; "gpu" starts
 *                               the WPE MiniBrowser of the same build directly so Skia may paint on
 *                               the GPU (run.sh KNORKE_LAB_WEBKIT_SKIA; default cpu)
 *   --browser-env KEY=VALUE     WebKit only, repeatable: extra environment of the browser for
 *                               experiments with WPE/Mesa variables (measure.json records it and
 *                               how many browser processes saw it)
 *   --set m1|noconn             scene set (scene-gen.js SCENE_SETS; default m1): noconn is the same
 *                               board without its 800 connectors, the A/B of the camera step
 *   --shadows on|off            note shadows (default on; off loads the lab with ?shadows=0, the
 *                               A/B of the shadow cost, SPEC-M1 §9.5 WP-S4); off adds -noshadow
 *                               to the report names (K8), the report header names it
 *
 * The measurement has, since stage 4 (SPEC-M1 §9.5 WP-S4, WebKit fixes), rows
 * for the one-finger pan on the CSS path (mode view, as on a tablet), follow
 * (short within the CSS rule, long with draws in between) and the badges of
 * mode vote (the G16 board, without and with totals); since job 034 (the
 * overscan of the stage, M2) a one-finger pan of 1500 px and a pinch-out to
 * k 0.6 on the CSS path, with their draws in between. The gates have, since
 * job 034, G20 "Rand ohne Lücke" and the checks "Überstand" and "Überstand
 * bei Größenänderung" (20 gates, 40 checks).
 */
import { chromium, webkit } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromiumKind, memoryReportLines, memorySnapshot, parseDrmFdinfo, parseProcStatus, parseSmapsRollup, plainSnapshot } from './memory.js'
import { engineDelta, gpuReportLines, gpuVerdict, mesaDrivers, parseDrmEngines, webkitKind } from './gpu.js'
import { evaluateBounds, parseStatusIds } from './bounds.js'
import { LABEL_RE, reportFiles } from './names.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
// Reports go to KNORKE_LAB_OUT (run.sh: /out, the only writable mount; /work
// is read-only with an empty tmpfs over /work/out). Without it (a manual run
// outside the container) they land in dev/scene-lab/out and G17 fails.
const OUT = process.env.KNORKE_LAB_OUT || join(HERE, 'out')
const argv = process.argv.slice(2)
const opt = (name, def) => {
	const i = argv.indexOf('--' + name)
	if (i < 0) return def
	const v = argv[i + 1]
	return v === undefined || v.startsWith('--') ? true : v
}
const MODE = String(opt('mode', 'gates'))
const GPU = opt('gpu', false) === true
const BROWSER = String(opt('browser', 'chromium'))
const IS_CHROMIUM = BROWSER === 'chromium'
const WEBKIT_SKIA = String(opt('webkit-skia', 'cpu'))
const viewportArg = /^(\d{3,4})x(\d{3,4})$/.exec(String(opt('viewport', '1920x1080')))
const VIEWPORT = viewportArg ? { width: Number(viewportArg[1]), height: Number(viewportArg[2]) } : null
const DPR = Number(opt('dpr', 1))
// --set m1|noconn (measurement mode only): the lab page loads ?set=<set>
const SET = String(opt('set', 'm1'))
// --label <x> (run.sh KNORKE_LAB_LABEL): appended to the report names
const LABEL = opt('label', null)
// --shadows on|off (measurement mode only): off loads the lab page with ?shadows=0
const SHADOWS = String(opt('shadows', 'on'))
// --browser-env KEY=VALUE (repeatable, WebKit only): extra environment of the
// browser for experiments with WPE/Mesa variables; measure.json records it
const BROWSER_ENV = Object.fromEntries(argv.flatMap((a, i) => {
	if (argv[i - 1] !== '--browser-env') return []
	const eq = a.indexOf('=')
	return [eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : ['=' + a, '']]
}))

/** @return {string|null} the first invalid option, or null */
function invalidOption() {
	if (!['gates', 'measure'].includes(MODE)) return `--mode ${MODE}`
	if (!['chromium', 'webkit'].includes(BROWSER)) return `--browser ${BROWSER}`
	for (const key of Object.keys(BROWSER_ENV)) {
		if (IS_CHROMIUM || !/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) return `--browser-env ${key}`
	}
	if (!VIEWPORT) return `--viewport ${opt('viewport')}`
	if (!['m1', 'noconn'].includes(SET)) return `--set ${SET}`
	if (!['on', 'off'].includes(SHADOWS)) return `--shadows ${SHADOWS}`
	if (LABEL !== null && (typeof LABEL !== 'string' || !LABEL_RE.test(LABEL))) return `--label ${LABEL}`
	if (!(DPR >= 1 && DPR <= 4)) return `--dpr ${opt('dpr')}`
	if (!['cpu', 'gpu'].includes(WEBKIT_SKIA) || (WEBKIT_SKIA !== 'cpu' && IS_CHROMIUM)) return `--webkit-skia ${WEBKIT_SKIA}`
	// the gates keep their one setup: Chromium, 1920×1080, DPR 1, the M1 set
	const standard = IS_CHROMIUM && VIEWPORT.width === 1920 && VIEWPORT.height === 1080 && DPR === 1 && SET === 'm1' && SHADOWS === 'on'
	if (MODE !== 'measure' && !standard) return `--browser/--viewport/--dpr/--set/--shadows in mode ${MODE} (measure only)`
	return null
}
if (invalidOption()) {
	console.error(`run.mjs: invalid ${invalidOption()}`)
	process.exit(2)
}
mkdirSync(OUT, { recursive: true })
// this run's report names; older files under them go now, so a broken run leaves none behind
const FILES = reportFiles({ mode: MODE, gpu: GPU, browser: BROWSER, set: SET, shadows: SHADOWS, label: LABEL })
for (const name of [FILES.json, FILES.md, FILES.copies.json, FILES.copies.md]) {
	try {
		unlinkSync(join(OUT, name))
	} catch (e) {
		if (e?.code !== 'ENOENT') throw e
	}
}

/**
 * Writes a report of this run under its own name and as the copy of the last run.
 *
 * @param {'json'|'md'} kind which report
 * @param {string} content file content
 */
function writeReport(kind, content) {
	for (const name of [FILES[kind], FILES.copies[kind]]) writeFileSync(join(OUT, name), content)
	log(`report written: out/${FILES[kind]} (copy out/${FILES.copies[kind]})`)
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- page server
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.map': 'application/json' }
if (!existsSync(join(DIST, 'index.html'))) {
	console.error('dist/index.html missing: build the lab first (run.sh does)')
	process.exit(2)
}
const server = createServer((req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
	const file = join(DIST, path === '/' ? 'index.html' : path)
	if (!file.startsWith(DIST) || !existsSync(file)) {
		res.writeHead(404)
		res.end()
		return
	}
	res.writeHead(200, {
		'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cache-Control': 'no-store',
	})
	res.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const URL_BASE = `http://127.0.0.1:${server.address().port}/`

// ---------------------------------------------------------------- browser
// Chromium only (WebKit gets no command-line flags)
const ARGS = [
	'--disable-renderer-backgrounding',
	'--disable-background-timer-throttling',
	'--disable-backgrounding-occluded-windows',
	...(GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl'] : []),
	// measureUserAgentSpecificMemory() resolves at once instead of at the next
	// GC (up to 20 s later); only the measurement mode asks for it
	...(MODE === 'measure' ? ['--enable-blink-features=ForceEagerMeasureMemory'] : []),
]
/**
 * WebKit launch options. Playwright's launcher (pw_run.sh) exports
 * WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 for headless WPE (WebKit bug 279523: a
 * crash with GPU rendering and isMobile, which the lab does not set), so the
 * page paints on the CPU even with /dev/dri. --webkit-skia gpu starts the
 * MiniBrowser wrapper of the same build directly, with the launcher's other
 * variable, and leaves the choice to WebKit.
 *
 * @return {object} webkit.launch() options
 */
function webkitLaunch() {
	const env = { ...process.env, ...BROWSER_ENV }
	if (WEBKIT_SKIA === 'cpu') return { headless: true, env }
	const wrapper = join(dirname(webkit.executablePath()), 'minibrowser-wpe', 'MiniBrowser')
	return { headless: true, executablePath: wrapper, env: { ...env, WEBKIT_FORCE_COMPLEX_TEXT: '1' } }
}
const browser = IS_CHROMIUM
	? await chromium.launch({ headless: true, channel: 'chromium', args: ARGS })
	: await webkit.launch(webkitLaunch())
const BROWSER_LABEL = `${IS_CHROMIUM ? 'Chromium' : 'WebKit'} ${browser.version()}`
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, locale: 'en-US' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)))
page.on('console', (m) => {
	if (m.type() === 'error') pageErrors.push('console: ' + m.text())
})
const PAGE_QUERY = new URLSearchParams([...(SET === 'm1' ? [] : [['set', SET]]), ...(SHADOWS === 'on' ? [] : [['shadows', '0']])]).toString()
await page.goto(PAGE_QUERY ? `${URL_BASE}?${PAGE_QUERY}` : URL_BASE, { waitUntil: 'load' })
await page.waitForFunction(() => window.__lab && window.__lab.settled, null, { timeout: 60000 })
// the page must have built the set that was asked for (a measurement of the wrong board is worse than none)
const loadedSet = await page.evaluate(() => window.__lab.meta.set)
if (loadedSet !== SET) {
	console.error(`run.mjs: the lab page loaded set ${loadedSet}, expected ${SET}`)
	await browser.close().catch(() => {})
	process.exit(2)
}
log(`lab ready: ${BROWSER_LABEL}, ${VIEWPORT.width}x${VIEWPORT.height}, DPR ${DPR}`)

const lab = (fn, arg) => page.evaluate(fn, arg)
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- result bookkeeping
const results = []
/**
 * @param {string} kind 'gate' (§9.4) or 'check' (scene contract)
 * @param {string} name name
 * @param {boolean} ok passed
 * @param {object} detail measured values
 */
function record(kind, name, ok, detail) {
	results.push({ kind, name, ok: !!ok, detail })
	log(`${ok ? 'ok  ' : 'FAIL'} [${kind}] ${name} ${JSON.stringify(detail)}`)
}

/**
 * @param {string} kind kind
 * @param {string} name name
 * @param {() => Promise<[boolean, object]>} fn returns [ok, detail]
 */
async function step(kind, name, fn) {
	try {
		const [ok, detail] = await fn()
		record(kind, name, ok, detail)
	} catch (e) {
		record(kind, name, false, { error: String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ') })
	}
}

const near = (a, b, tol) => Math.abs(a - b) <= tol
const sameDraws = (a, b) => a.static === b.static && a.overlay === b.overlay
/** Single keys need the canvas focus (SPEC-M1 §6.3, WCAG 2.1.4): the key checks focus it first. */
const focusCanvas = () => lab(() => window.__lab.focusCanvas())

/**
 * Real Ctrl+wheel through Playwright: 5 × deltaY −60 at 16 ms (E10 helper).
 *
 * @param {{x:number, y:number}} at client point
 * @return {Promise<object>} stats right after the last event
 */
async function ctrlWheel(at) {
	await page.mouse.move(at.x, at.y)
	await page.keyboard.down('Control')
	for (let i = 0; i < 5; i++) {
		await page.mouse.wheel(0, -60)
		await sleep(16)
	}
	const mid = await lab(() => window.__lab.stats())
	await page.keyboard.up('Control')
	return mid
}

// ---------------------------------------------------------------- container bounds (G17)
/**
 * Raw inputs of gate G17 from inside the container (bounds.js decides):
 * ids of this process, Uid/Gid of every process (Chromium included, the
 * browser is running by now), mountinfo, a write attempt directly in /work
 * (must fail with EROFS), the entries of /work/out (empty tmpfs) and a
 * create + read back + unlink probe in KNORKE_LAB_OUT.
 *
 * @return {object} evaluateBounds() result
 */
function collectBounds() {
	const procs = []
	let pids = []
	try {
		pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n))
	} catch {}
	for (const pid of pids) {
		const ids = parseStatusIds(readText(`/proc/${pid}/status`) ?? '')
		if (ids) procs.push({ pid: Number(pid), uids: ids.uids, gids: ids.gids })
	}
	const probeName = `.g17-probe-${process.pid}`
	let workProbe
	try {
		writeFileSync(join(HERE, probeName), 'x', { flag: 'wx' })
		try {
			unlinkSync(join(HERE, probeName))
		} catch {}
		workProbe = { wrote: true, code: null }
	} catch (e) {
		workProbe = { wrote: false, code: e?.code ?? String(e) }
	}
	let workOutEntries = null
	try {
		workOutEntries = readdirSync(join(HERE, 'out'))
	} catch {}
	const outDir = process.env.KNORKE_LAB_OUT
	let outProbe = { ok: false, code: 'KNORKE_LAB_OUT unset' }
	if (outDir) {
		const p = join(outDir, probeName)
		try {
			writeFileSync(p, 'g17', { flag: 'wx' })
			const back = readFileSync(p, 'utf8')
			unlinkSync(p)
			outProbe = { ok: back === 'g17', code: null }
		} catch (e) {
			outProbe = { ok: false, code: e?.code ?? String(e) }
		}
	}
	return evaluateBounds({
		self: { uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups: process.getgroups() },
		procs,
		mountinfo: readText('/proc/self/mountinfo') ?? '',
		work: HERE,
		workProbe,
		workOutEntries,
		outDir,
		resultsDir: OUT,
		outProbe,
	})
}

// ---------------------------------------------------------------- gates
async function gates() {
	await step('gate', 'G17 Container-Grenzen: not root, /work read-only, /work/out empty tmpfs, /out writable', async () => {
		const b = collectBounds()
		return [b.ok, { ...b.checks, ...b.detail }]
	})

	const meta = await lab(() => window.__lab.meta)
	const [idA, idB, idC, idD, idE, idF] = meta.centerNoteIds

	await step('gate', 'Lazy Build: nodesBuilt <= items in the cull rectangle (stage, at least viewport + 10 %) after load', async () => {
		const d = await lab(() => ({ ...window.__lab.stats(), vis: window.__lab.visibleCount() }))
		return [d.nodesBuilt > 0 && d.nodesBuilt <= d.vis && d.nodesBuilt < d.items,
			{ nodesBuilt: d.nodesBuilt, visibleRbush: d.vis, items: d.items }]
	})

	await step('check', 'layers: two canvases, all listening false', async () => {
		const d = await lab(() => ({ listening: window.__lab.layersListening(), canvases: document.querySelectorAll('#board canvas').length }))
		return [d.listening.length === 2 && d.listening.every((l) => l === false) && d.canvases === 2, d]
	})

	await step('gate', 'Ordnung: static layer order == compareOrder after drag and release', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idA)
		await lab(() => { window.__lab.clearLog(); window.__lab.select([]) })
		const c0 = await lab((id) => window.__lab.clientCenter(id), idA)
		await page.mouse.move(c0.x, c0.y)
		// Ctrl held: no snapping (R12), the expected shift is the raw one (neighbours in the dense frame lie within 8 px)
		await page.keyboard.down('Control')
		await page.mouse.down()
		let during = null
		for (let i = 1; i <= 12; i++) {
			await page.mouse.move(c0.x + 20 * i, c0.y + 4 * i)
			if (i === 6) {
				await lab(() => window.__lab.frames(1))
				during = await lab(() => window.__lab.stats())
			}
		}
		await lab(() => window.__lab.frames(1))
		await page.mouse.up()
		await page.keyboard.up('Control')
		await lab(() => window.__lab.idle())
		const d = await lab((id) => ({
			order: window.__lab.orderCheck(),
			log: window.__lab.log.slice(),
			center: window.__lab.clientCenter(id),
			st: window.__lab.stats(),
		}), idA)
		const iPrev = d.log.findLastIndex((e) => e[0] === 'dragPreview' && e[1] === 0)
		const iMove = d.log.findIndex((e) => e[0] === 'intent' && e[1].type === 'move')
		const iAct = d.log.findLastIndex((e) => e[0] === 'activity' && e[1].kind === 'drag' && !e[1].active)
		const move = d.log[iMove]
		const callbackOrder = iPrev >= 0 && iPrev < iMove && iMove < iAct
		const ok = d.order.sorted && d.order.n > 0 && during?.activeChildren >= 1 && callbackOrder &&
			move?.[2]?.activeAtIntent === true && near(move[1].dx, 240, 0.5) && near(move[1].dy, 48, 0.5) &&
			near(d.center.x - c0.x, 240, 2) && near(d.center.y - c0.y, 48, 2) && d.st.activeChildren === 0
		return [ok, {
			order: d.order, activeChildrenDuring: during?.activeChildren, callbackOrder: [iPrev, iMove, iAct],
			activeAtIntent: move?.[2]?.activeAtIntent, intent: move?.[1], moved: { dx: d.center.x - c0.x, dy: d.center.y - c0.y },
		}]
	})

	await step('gate', 'Platzhalter: unknown types render without errors', async () => {
		const out = []
		for (const id of meta.unknownIds.slice(0, 6)) {
			await lab((i) => window.__lab.focusItem(i, 1), id)
			out.push(await lab((i) => ({
				t: window.__lab.model.get(i).t,
				text: window.__lab.nodeText(i),
				attached: window.__lab.staticOrder().includes(i),
			}), id))
		}
		const ok = out.every((o) => o.attached && o.text === `Unknown item type: ${o.t}`) && pageErrors.length === 0
		return [ok, { checked: out.length, sample: out[0], pageErrors: pageErrors.length }]
	})

	await step('gate', 'Cursor auf ruhiger Szene: presenceChanged() → cursor in the next frame', async () => {
		const d = await lab(() => window.__lab.cursorQuiet())
		const ok = d.wasRunning === false && d.found && d.name === 'Tom & Jerry <b>x</b> (guest)' && d.nameHasElements === 0 &&
			d.guestClass && near(d.dx, 0, 2) && near(d.dy, 0, 2) && d.removed
		return [ok, d]
	})

	await step('gate', 'Gestenpfad Wheel: CSS transform, 0 draws during, one draw per non-empty layer after', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idB)
		await lab(() => { window.__lab.select([]); return window.__lab.idle() })
		const before = await lab((id) => ({ st: window.__lab.stats(), c: window.__lab.clientCenter(id) }), idB)
		await lab(() => window.__lab.clearDrawLog())
		const mid = await ctrlWheel(before.c)
		await sleep(300)
		const after = await lab((id) => ({ st: window.__lab.stats(), c: window.__lab.clientCenter(id), draws: window.__lab.drawLog.slice() }), idB)
		const overlayNonEmpty = before.st.activeChildren + before.st.uiChildren > 0
		const k = after.st.camera.scale / before.st.camera.scale
		const ok = mid.cssTransform !== null && mid.gestureActive && sameDraws(mid.draws, before.st.draws) &&
			mid.camera.scale === before.st.camera.scale && mid.camera.x === before.st.camera.x &&
			after.st.cssTransform === null && !after.st.gestureActive &&
			after.st.draws.static === before.st.draws.static + 1 &&
			after.st.draws.overlay === before.st.draws.overlay + (overlayNonEmpty ? 1 : 0) &&
			near(k, Math.exp(0.09) ** 5, 0.01 * Math.exp(0.45)) &&
			near(after.c.x, before.c.x, 2) && near(after.c.y, before.c.y, 2)
		return [ok, {
			duringCss: mid.cssTransform, drawsBefore: before.st.draws, drawsDuring: mid.draws, drawsAfter: after.st.draws,
			overlayNonEmpty, k: Math.round(k * 10000) / 10000, expectedK: Math.round(Math.exp(0.45) * 10000) / 10000,
			noteShift: { dx: after.c.x - before.c.x, dy: after.c.y - before.c.y },
		}]
	})

	await step('gate', 'Gestenende mit Auswahl: overlay drawn synchronously at the gesture end', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idB)
		await lab((id) => { window.__lab.select([id]); return window.__lab.idle() }, idB)
		const before = await lab((id) => ({ st: window.__lab.stats(), c: window.__lab.clientCenter(id) }), idB)
		await lab(() => window.__lab.clearDrawLog())
		const mid = await ctrlWheel(before.c)
		await sleep(300)
		const after = await lab(() => ({ st: window.__lab.stats(), draws: window.__lab.drawLog.slice() }))
		const statics = after.draws.filter((x) => x.layer === 'static')
		const overlays = after.draws.filter((x) => x.layer === 'overlay')
		const ok = before.st.uiChildren >= 1 && mid.cssTransform !== null && sameDraws(mid.draws, before.st.draws) &&
			statics.length === 1 && overlays.length === 1 &&
			statics[0].transform !== '' && overlays[0].transform !== '' && after.st.cssTransform === null
		await lab(() => { window.__lab.select([]); return window.__lab.idle() })
		return [ok, {
			uiChildren: before.st.uiChildren, drawsAtEnd: after.draws.map((x) => `${x.layer}:${x.transform ? 'transformed' : 'reset'}`),
		}]
	})

	await step('gate', 'Gestenpfad Touch: one-finger pan 300 px (CSS path, 0 draws during, one end draw)', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idC)
		await lab(() => window.__lab.setViewOnly(true))
		const d = await lab(() => window.__lab.touchPan(300))
		const expectOverlay = d.before.overlayNonEmpty ? 1 : 0
		const ok = d.during.every((x) => x.css !== null && x.active && sameDraws(x.draws, d.before.draws) &&
				x.cam.x === d.before.cam.x) &&
			d.atEnd.draws.static === d.before.draws.static + 1 &&
			d.atEnd.draws.overlay === d.before.draws.overlay + expectOverlay &&
			sameDraws(d.after.draws, d.atEnd.draws) && d.atEnd.transform === '' && d.after.css === null && !d.after.active &&
			near(d.after.cam.x - d.before.cam.x, 300 / d.before.cam.scale, 2 / d.before.cam.scale)
		return [ok, {
			frames: d.during.length, cssSample: d.during[4]?.css, drawsBefore: d.before.draws, drawsAtEnd: d.atEnd.draws,
			drawsAfter: d.after.draws, camDx: d.after.cam.x - d.before.cam.x,
		}]
	})

	await step('gate', 'Gestenpfad Touch: pinch → one finger lifts → keeps panning (one gesture, one end draw)', async () => {
		await lab(() => window.__lab.clearLog())
		const d = await lab(() => window.__lab.pinchLiftPan())
		const acts = await lab(() => window.__lab.log.filter((e) => e[0] === 'activity' && e[1].kind === 'gesture').map((e) => e[1].active))
		const lifted = d.trace.find((x) => x.label === 'lifted')
		const lastPinch = d.trace.filter((x) => x.label === 'pinch').at(-1)
		const firstPan = d.trace.find((x) => x.label === 'pan')
		const ok = d.trace.every((x) => x.css !== null && x.active && sameDraws(x.draws, d.before.draws)) &&
			JSON.stringify(acts) === '[true,false]' &&
			d.atEnd.draws.static === d.before.draws.static + 1 && sameDraws(d.after.draws, d.atEnd.draws) &&
			d.after.css === null && !d.after.active && near(lifted.live.scale, lastPinch.live.scale, 1e-9) &&
			near(firstPan.live.scale, lastPinch.live.scale, 1e-9) && firstPan.live.x > lifted.live.x &&
			near(d.after.cam.scale / d.before.cam.scale, 320 / 200, 0.01)
		await lab(() => window.__lab.setViewOnly(false))
		return [ok, {
			samples: d.trace.length, gestureActivity: acts, drawsBefore: d.before.draws, drawsAtEnd: d.atEnd.draws,
			scaleRatio: Math.round((d.after.cam.scale / d.before.cam.scale) * 1000) / 1000,
		}]
	})

	await step('check', 'touch in edit mode: a finger on an item is claimed (select + drag, no gesture) and focuses the canvas (R9)', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idD)
		await lab(() => window.__lab.clearLog())
		const d = await lab(async (id) => {
			const L = window.__lab
			const board = document.getElementById('board')
			document.activeElement?.blur?.()
			const focusedBefore = document.activeElement === board
			const r = L.scene.itemScreenRect(id)
			const x = r.x + r.w / 2
			const y = r.y + r.h / 2
			L.touch('pointerdown', 31, x, y)
			const focusedAtDown = document.activeElement === board
			await L.frames(1)
			const down = L.stats()
			for (let i = 1; i <= 5; i++) {
				L.touch('pointermove', 31, x + 20 * i, y)
				await L.frames(1)
			}
			L.touch('pointerup', 31, x + 100, y)
			await L.idle()
			return { gestureAtDown: down.gestureActive, focusedBefore, focusedAtDown, log: L.log.slice() }
		}, idD)
		const move = d.log.find((e) => e[0] === 'intent' && e[1].type === 'move')
		const focus = { before: d.focusedBefore, atDown: d.focusedAtDown }
		return [!d.gestureAtDown && !!move && near(move[1].dx, 100, 0.5) && !focus.before && focus.atDown,
			{ gestureAtDown: d.gestureAtDown, intent: move?.[1], focus }]
	})

	await step('check', 'text editor: double click opens, typing + Esc commits (final), selection kept', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idE)
		await lab(() => window.__lab.clearLog())
		const c = await lab((id) => window.__lab.clientCenter(id), idE)
		const before = await lab((id) => window.__lab.model.get(id).data.text, idE)
		await page.mouse.dblclick(c.x, c.y)
		const open = await lab(() => {
			const ta = window.__lab.editor()
			return ta ? { has: true, focused: document.activeElement === ta, maxLength: ta.maxLength } : { has: false }
		})
		await page.keyboard.type(' Hallo')
		await page.keyboard.press('Escape')
		await lab(() => window.__lab.idle())
		const d = await lab((id) => ({
			editor: !!window.__lab.editor(),
			text: window.__lab.model.get(id).data.text,
			node: window.__lab.nodeText(id),
			selection: window.__lab.scene.getSelection(),
			log: window.__lab.log.slice(),
		}), idE)
		const finals = d.log.filter((e) => e[0] === 'intent' && e[1].type === 'text' && e[1].final)
		const editing = d.log.filter((e) => e[0] === 'editing')
		const ok = open.has && open.focused && open.maxLength === 6000 && !d.editor && finals.length === 1 &&
			finals[0][1].value === before + ' Hallo' && finals[0][1].before === before && finals[0][2].activeAtIntent === true &&
			d.text === before + ' Hallo' && d.node === before + ' Hallo' &&
			JSON.stringify(d.selection) === JSON.stringify([idE]) &&
			JSON.stringify(editing.map((e) => [e[1] === null ? null : 'id', e[2]])) === '[["id",false],[null,false]]'
		return [ok, { open, finals: finals.length, value: finals[0]?.[1]?.value?.slice(-12), selection: d.selection.length }]
	})

	await step('check', 'lease lock: double click on a held item opens no editor; chip offers Take over; click opens', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idF)
		await lab(() => window.__lab.clearLog())
		await lab((id) => window.__lab.setSamples([{
			key: 'pidBob:cBob1', pid: 'pidBob', name: 'Bob Berg', color: '#2e9e58', guest: false, cursor: null,
			selection: [], drag: [], editing: id, editingHolder: true,
		}]), idF)
		await lab(() => window.__lab.frames(2))
		const chipBefore = await lab((id) => {
			const chip = document.querySelector(`[data-knorke-editing="${id}"]`)
			return { chip: !!chip, text: chip?.textContent, button: !!chip?.querySelector('[data-knorke-action="take-over"]') }
		}, idF)
		const c = await lab((id) => window.__lab.clientCenter(id), idF)
		await page.mouse.dblclick(c.x, c.y)
		await lab(() => window.__lab.frames(2))
		const blocked = await lab((id) => ({
			editor: !!window.__lab.editor(),
			button: !!document.querySelector(`[data-knorke-editing="${id}"] [data-knorke-action="take-over"]`),
		}), idF)
		await page.click(`[data-knorke-editing="${idF}"] [data-knorke-action="take-over"]`)
		await lab(() => window.__lab.frames(1))
		const taken = await lab(() => ({ editor: !!window.__lab.editor(), log: window.__lab.log.filter((e) => e[0] === 'editing') }))
		// notice: locked state, closing discards
		await lab((id) => window.__lab.scene.setEditorNotice(id, 'Not saved. Copy your text before closing.'), idF)
		const locked = await lab(() => window.__lab.editor()?.getAttribute('data-knorke-editor-state'))
		const textBefore = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text').length)
		await page.keyboard.type('xyz')
		await page.keyboard.press('Escape')
		// samples are active (Bob edits), so the loop keeps running: wait frames, not idle
		await lab(() => window.__lab.frames(3))
		const textAfter = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text').length)
		const closed = await lab(() => !window.__lab.editor())
		await lab(() => window.__lab.setSamples([]))
		await lab(() => window.__lab.idle())
		const ok = chipBefore.chip && chipBefore.text === 'Bob Berg is editing…' && !chipBefore.button &&
			!blocked.editor && blocked.button && taken.editor &&
			JSON.stringify(taken.log.at(-1)) === JSON.stringify(['editing', idF, true]) &&
			locked === 'locked' && textAfter === textBefore && closed
		return [ok, { chipBefore, blocked, takenEditor: taken.editor, locked, textIntentsDuringNotice: textAfter - textBefore }]
	})

	await step('check', 'Take over while this item\'s editor is open (stale button after a rescue): real click keeps text + focus, lifts the notice, reports onEditing(id, true)', async () => {
		// The button outlives the offer until the next frame. A text rescue can open
		// the editor (with a notice) in between; frames are held so a real mouse
		// click lands in exactly that state. Before the fix the click either
		// returned early (no onEditing(id, true), editor stayed locked) or, with
		// the focus moving to the button, blurred the editor: discard + reopen
		// with the model text, the rescued text lost.
		await lab((id) => window.__lab.focusItem(id, 1), idF)
		await lab(() => window.__lab.clearLog())
		await lab((id) => window.__lab.setSamples([{
			key: 'pidBob:cBob1', pid: 'pidBob', name: 'Bob Berg', color: '#2e9e58', guest: false, cursor: null,
			selection: [], drag: [], editing: id, editingHolder: true,
		}]), idF)
		await lab(() => window.__lab.frames(2))
		const c = await lab((id) => window.__lab.clientCenter(id), idF)
		await page.mouse.dblclick(c.x, c.y)
		await lab(() => window.__lab.frames(2))
		const sel = `[data-knorke-editing="${idF}"] [data-knorke-action="take-over"]`
		const offered = await lab((s) => !!document.querySelector(s), sel)
		const rescued = await lab(([id, s]) => {
			window.__lab.holdFrames()
			const opened = window.__lab.scene.openTextEditor(id, { text: 'rescued text', notice: 'Not saved. Copy your text before closing.' })
			const ta = window.__lab.editor()
			const r = document.querySelector(s)?.getBoundingClientRect()
			const at = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
			const hit = at ? document.elementFromPoint(at.x, at.y)?.getAttribute('data-knorke-action') ?? null : null
			return { opened, state: ta?.getAttribute('data-knorke-editor-state') ?? null, focused: document.activeElement === ta, at, hit }
		}, [idF, sel])
		let after = null
		try {
			// page.mouse, not page.click: its "stable" wait needs the page's frames, which are held here
			if (!rescued.at) throw new Error('button gone before the click')
			await page.mouse.click(rescued.at.x, rescued.at.y)
			after = await lab(() => {
				const ta = window.__lab.editor()
				return {
					editor: !!ta, value: ta?.value ?? null, state: ta?.getAttribute('data-knorke-editor-state') ?? null,
					focused: !!ta && document.activeElement === ta,
					editing: window.__lab.log.filter((e) => e[0] === 'editing').map((e) => [e[1] === null ? null : 'id', e[2]]),
				}
			})
		} finally {
			await lab(() => window.__lab.releaseFrames())
		}
		await lab(() => window.__lab.frames(3))
		const buttonGone = await lab((s) => !document.querySelector(s), sel)
		await page.keyboard.press('Escape')
		await lab(() => window.__lab.frames(3))
		const texts = await lab((id) => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text' && e[1].id === id)
			.map((e) => [e[1].value, e[1].final]), idF)
		const closed = await lab(() => !window.__lab.editor())
		await lab(() => window.__lab.setSamples([]))
		await lab(() => window.__lab.idle())
		const finals = texts.filter((x) => x[1])
		const ok = offered && rescued.opened && rescued.state === 'locked' && rescued.focused && rescued.hit === 'take-over' &&
			after.editor && after.value === 'rescued text' && after.state === null && after.focused &&
			JSON.stringify(after.editing) === '[["id",false],["id",true]]' &&
			buttonGone && closed && finals.length === 1 && finals[0][0] === 'rescued text'
		return [ok, { offered, rescued, after, buttonGone, texts }]
	})

	await step('check', 'remote drag preview moves the node into the overlay and back', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idA)
		const d = await lab(async (id) => {
			const L = window.__lab
			L.select([])
			await L.idle()
			const a = L.model.abs(id)
			L.setSamples([{ key: 'pidAl:c1', pid: 'pidAl', name: 'Alice Adler', color: '#2f6fdb', guest: false,
				cursor: [a.x, a.y], selection: [id], drag: [[id, a.x + 150, a.y + 30]], editing: null, editingHolder: false }])
			await L.frames(2)
			const during = L.stats()
			const cursor = document.querySelector('[data-knorke-cursor="pidAl:c1"] .knorke-cursor-name')?.textContent
			L.setSamples([])
			await L.idle()
			return { during, after: L.stats(), cursor, order: L.orderCheck() }
		}, idA)
		const ok = d.during.activeChildren >= 1 && d.during.uiChildren >= 1 && d.cursor === 'Alice Adler' &&
			d.after.activeChildren === 0 && d.after.uiChildren === 0 && d.order.sorted
		return [ok, { activeDuring: d.during.activeChildren, uiDuring: d.during.uiChildren, cursor: d.cursor, after: [d.after.activeChildren, d.after.uiChildren] }]
	})

	await step('check', 'marquee selects notes, not the frame it starts in; create + delete via tools and keys', async () => {
		const spot = await lab((f) => window.__lab.emptySpotIn(f), meta.denseFrameId)
		if (!spot) return [false, { error: 'no empty spot found in the dense frame' }]
		await lab((p) => {
			window.__lab.scene.setCamera({ x: p.x - 300, y: p.y - 300, scale: 1 })
			return window.__lab.idle()
		}, spot)
		await lab(() => window.__lab.clearLog())
		const box = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().toJSON())
		const sx = box.left + 300
		const sy = box.top + 300
		await page.mouse.move(sx, sy)
		await page.mouse.down()
		await page.mouse.move(sx + 300, sy + 200, { steps: 5 })
		await page.mouse.move(sx + 600, sy + 500, { steps: 5 })
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const sel = await lab((f) => {
			const ids = window.__lab.scene.getSelection()
			return { n: ids.length, hasFrame: ids.includes(f), types: [...new Set(ids.map((i) => window.__lab.model.get(i).t))] }
		}, meta.denseFrameId)
		// create a note with the N tool on empty canvas, type, Esc; then Delete
		await page.keyboard.press('Escape')
		await focusCanvas()
		await page.keyboard.press('n')
		await page.mouse.click(sx, sy)
		await lab(() => window.__lab.frames(2))
		const created = await lab(() => ({ editor: !!window.__lab.editor(), sel: window.__lab.scene.getSelection(), tool: window.__lab.scene.getTool() }))
		await page.keyboard.type('Neu')
		await page.keyboard.press('Escape')
		await lab(() => window.__lab.idle())
		const newId = created.sel[0]
		const text = await lab((id) => window.__lab.model.get(id)?.data?.text, newId)
		await page.keyboard.press('Delete')
		await lab(() => window.__lab.idle())
		const gone = await lab((id) => !window.__lab.model.has(id), newId)
		const logd = await lab(() => window.__lab.log.filter((e) => e[0] === 'tool' || (e[0] === 'intent' && ['create', 'delete'].includes(e[1].type))).map((e) => e[0] === 'tool' ? 'tool:' + e[1] : e[1].type))
		const ok = sel.n > 0 && !sel.hasFrame && sel.types.every((t) => t === 'sticky') && created.editor && created.tool === 'select' &&
			text === 'Neu' && gone && JSON.stringify(logd) === '["tool:sticky","create","tool:select","delete"]'
		return [ok, { marquee: sel, created: { editor: created.editor, tool: created.tool }, text, gone, log: logd }]
	})

	await step('check', 'direct pan: hand tool, space and middle button move the camera without the CSS path', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idB)
		await lab(() => { window.__lab.select([]); window.__lab.clearLog(); return window.__lab.idle() })
		const box = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().toJSON())
		const cx = box.left + box.width / 2
		const cy = box.top + box.height / 2
		const pan = async (button) => {
			const c0 = await lab(() => window.__lab.camera())
			await page.mouse.move(cx, cy)
			await page.mouse.down({ button })
			await page.mouse.move(cx - 100, cy - 50, { steps: 4 })
			const mid = await lab(() => window.__lab.stats())
			await page.mouse.up({ button })
			await lab(() => window.__lab.idle())
			const c1 = await lab(() => window.__lab.camera())
			return { dx: c1.x - c0.x, dy: c1.y - c0.y, css: mid.cssTransform }
		}
		await focusCanvas()
		await page.keyboard.press('h')
		const hand = await pan('left')
		await page.keyboard.press('v')
		await page.keyboard.down(' ')
		const space = await pan('left')
		await page.keyboard.up(' ')
		const middle = await pan('middle')
		const sel = await lab(() => window.__lab.scene.getSelection().length)
		const tools = await lab(() => window.__lab.log.filter((e) => e[0] === 'tool').map((e) => e[1]))
		const ok = [hand, space, middle].every((p) => near(p.dx, 100, 0.5) && near(p.dy, 50, 0.5) && p.css === null) &&
			sel === 0 && JSON.stringify(tools) === '["hand","select"]'
		return [ok, { hand, space, middle, selection: sel, tools }]
	})

	await step('check', 'keys: zoom +/−, Shift+0 (100 %), Shift+1 (fit), Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+A, Esc', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idB)
		await lab(() => window.__lab.clearLog())
		const scale = async () => { await lab(() => window.__lab.idle()); return lab(() => window.__lab.camera().scale) }
		await focusCanvas()
		await page.keyboard.press('+')
		const s1 = await scale()
		await page.keyboard.press('-')
		await page.keyboard.press('-')
		const s2 = await scale()
		await page.keyboard.press('Shift+Digit0')
		const s3 = await scale()
		await page.keyboard.press('Shift+Digit1')
		const s4 = await scale()
		await page.keyboard.press('Control+z')
		await page.keyboard.press('Control+Shift+z')
		await page.keyboard.press('Control+y')
		await page.keyboard.press('Control+a')
		const all = await lab(() => ({ sel: window.__lab.scene.getSelection().length, items: window.__lab.model.size }))
		await page.keyboard.press('Escape')
		const none = await lab(() => window.__lab.scene.getSelection().length)
		const intents = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent').map((e) => e[1].type))
		const ok = near(s1, 1.25, 1e-9) && near(s2, 0.8, 1e-9) && near(s3, 1, 1e-9) && s4 < 0.2 && s4 >= 0.05 &&
			JSON.stringify(intents) === '["undo","redo","redo"]' && all.sel === all.items && none === 0
		return [ok, { s1, s2, s3, s4, intents, selectAll: all, afterEsc: none }]
	})

	await step('check', 'frame tool: drag ≥ 50 × 50 creates with rect, a click creates with rect null; tool falls back', async () => {
		await lab(() => {
			window.__lab.scene.setCamera({ x: -3000, y: -3000, scale: 1 })
			window.__lab.clearLog()
			return window.__lab.idle()
		})
		const box = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().toJSON())
		await focusCanvas()
		await page.keyboard.press('f')
		await page.mouse.move(box.left + 300, box.top + 300)
		await page.mouse.down()
		await page.mouse.move(box.left + 700, box.top + 600, { steps: 6 })
		const preview = await lab(() => window.__lab.stats().uiChildren)
		await page.mouse.up()
		await page.keyboard.press('f')
		await page.mouse.click(box.left + 1200, box.top + 300)
		await lab(() => window.__lab.idle())
		const d = await lab(() => window.__lab.log.filter((e) => e[0] === 'tool' || (e[0] === 'intent' && e[1].type === 'create')))
		// double click on the title band of the drawn frame edits its title (Enter ends a title)
		await lab(() => window.__lab.clearLog())
		await page.mouse.dblclick(box.left + 500, box.top + 300 - 20)
		const titleEditor = await lab(() => {
			const ta = window.__lab.editor()
			return ta ? { maxLength: ta.maxLength, align: ta.style.getPropertyValue('text-align') } : null
		})
		await page.keyboard.type('Titel')
		await page.keyboard.press('Enter')
		await lab(() => window.__lab.idle())
		const title = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text').map((e) => [e[1].path, e[1].value, e[1].final]).at(-1))
		const creates = d.filter((e) => e[0] === 'intent').map((e) => e[1])
		const ok = preview === 1 && creates.length === 2 && creates[0].t === 'frame' && creates[0].rect &&
			near(creates[0].rect.w, 400, 0.5) && near(creates[0].rect.h, 300, 0.5) && creates[1].rect === null &&
			JSON.stringify(d.filter((e) => e[0] === 'tool').map((e) => e[1])) === '["frame","select","frame","select"]'
		const titleOk = titleEditor?.maxLength === 200 && titleEditor.align === 'left' && JSON.stringify(title) === JSON.stringify(['data.title', 'Titel', true])
		return [ok && titleOk, { preview, creates, titleEditor, title }]
	})

	await step('check', 'text editor: intermediate commits at most 1 per second, final on blur (click beside)', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idC)
		await lab(() => window.__lab.clearLog())
		const c = await lab((id) => window.__lab.clientCenter(id), idC)
		await page.mouse.dblclick(c.x, c.y)
		for (let i = 0; i < 14; i++) {
			await page.keyboard.type('a')
			await sleep(200)
		}
		await page.mouse.click(c.x + 400, c.y + 400)
		await lab(() => window.__lab.idle())
		const texts = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text').map((e) => ({ final: e[1].final, n: e[1].value.length })))
		const inter = texts.filter((x) => !x.final)
		const finals = texts.filter((x) => x.final)
		const editor = await lab(() => !!window.__lab.editor())
		const ok = !editor && inter.length >= 2 && inter.length <= 4 && finals.length === 1 && texts.at(-1).final
		return [ok, { intermediate: inter.length, finals: finals.length, typedMs: 14 * 200 }]
	})

	// (R4, T5 / E14) reload or close fires no blur: the session calls
	// flushEditor() first; the text typed since the leading-edge 1 Hz commit
	// must come out synchronously, with the editor left open and focused.
	await step('check', 'flushEditor (T5): text typed after the 1 Hz leading edge comes out synchronously, editor stays open', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idC)
		await lab(() => window.__lab.clearLog())
		const c = await lab((id) => window.__lab.clientCenter(id), idC)
		await page.mouse.dblclick(c.x, c.y)
		await page.keyboard.press('Control+A')
		await page.keyboard.type('n')
		await sleep(150)
		await page.keyboard.insertText('eu geladen T5')
		const d = await lab(() => {
			const texts = () => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text').map((e) => [e[1].value, e[1].final])
			const before = texts()
			const first = window.__lab.scene.flushEditor()
			const after = texts()
			const second = window.__lab.scene.flushEditor()
			const ta = window.__lab.editor()
			return { before, first, after, second, afterSecond: texts().length, open: !!ta, focused: document.activeElement === ta }
		})
		await sleep(1300)
		const late = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text').length)
		await page.keyboard.press('Escape')
		await lab(() => window.__lab.idle())
		const finals = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'text' && e[1].final).map((e) => e[1].value))
		const ok = JSON.stringify(d.before) === '[["n",false]]' && d.first === true &&
			JSON.stringify(d.after.at(-1)) === '["neu geladen T5",false]' && d.after.length === 2 &&
			d.second === false && d.afterSecond === 2 && d.open && d.focused && late === 2 &&
			JSON.stringify(finals) === '["neu geladen T5"]'
		return [ok, { before: d.before, first: d.first, after: d.after, second: d.second, open: d.open, focused: d.focused, lateTexts: late, finals }]
	})

	await step('check', 'Esc during a drag puts everything back without an intent', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idA)
		await lab(() => { window.__lab.select([]); window.__lab.clearLog(); return window.__lab.idle() })
		const c0 = await lab((id) => window.__lab.clientCenter(id), idA)
		await page.mouse.move(c0.x, c0.y)
		await page.mouse.down()
		await page.mouse.move(c0.x + 150, c0.y + 80, { steps: 6 })
		await lab(() => window.__lab.frames(1))
		await page.keyboard.press('Escape')
		await page.mouse.move(c0.x + 300, c0.y + 80, { steps: 3 })
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const d = await lab((id) => ({ c: window.__lab.clientCenter(id), log: window.__lab.log.slice(), st: window.__lab.stats() }), idA)
		const moves = d.log.filter((e) => e[0] === 'intent' && e[1].type === 'move').length
		const ok = moves === 0 && near(d.c.x, c0.x, 0.5) && near(d.c.y, c0.y, 0.5) && d.st.activeChildren === 0 && !d.st.dragging
		return [ok, { moves, shift: { dx: d.c.x - c0.x, dy: d.c.y - c0.y }, activeChildren: d.st.activeChildren }]
	})

	await step('check', 'remote updates: cascade, stale re-entry, reorder, type change, removal, reset', async () => {
		const d = await lab(() => window.__lab.updatesCheck())
		const ok = near(d.cascade.dx, 50, 0.5) && near(d.cascade.dy, 20, 0.5) && d.cascade.order &&
			d.stale.detached && d.stale.text === 'changed while away' &&
			d.reorder.last && d.reorder.sorted && d.typeChange.text === 'Unknown item type: kanban' && d.typeChange.sorted &&
			!d.removed.attached && d.removed.selection === 0 &&
			d.reset.nodesBuilt <= d.reset.visible && d.reset.nodesBuilt > 0 && d.reset.sorted
		return [ok, d]
	})

	await step('gate', 'Herausnehmen: pan over the whole board, attached <= visible + 5 at every step; no visible() setter', async () => {
		const d = await lab(() => window.__lab.panAcross(0.5))
		return [d.maxExcess <= 5 && d.visibleSetCalls === 0 && d.lods.length === 1 && d.steps > 50, d]
	})

	// ---------------------------------------------------------------- M1 round 1a (SPEC-M1 §8.5, §6.3)
	// after the M0 pan gate: it sees the M0 sequence (its visible() count would
	// otherwise include the lazy LOD sync of entries these checks build at LOD 1)

	await step('check', 'M1 scene: shapes, text items and connectors (1b: routed connector nodes with label) render without errors', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const sid = L.meta.shapeIds.find((id) => L.model.get(id).data.text !== '' && L.model.get(id).r === 0)
			await L.focusItem(sid, 1)
			const shape = { text: L.nodeText(sid), want: L.model.get(sid).data.text, level: L.scene.renderer.nodeLevel(sid) }
			const tid = L.meta.textIds[0]
			await L.focusItem(tid, 1)
			const text = { text: L.nodeText(tid), want: L.model.get(tid).data.text }
			const cid = L.meta.hubConnectorIds[0]
			await L.focusItem(L.meta.hubNoteId, 1)
			const routed = L.meta.connectorIds.filter((id) => L.model.geometryOf(id) !== null).length
			const conn = { text: L.nodeText(cid), want: L.model.get(cid).data.label, attached: L.staticOrder().includes(cid), level: L.scene.renderer.nodeLevel(cid) }
			return { shape, text, conn, routed, counts: L.meta.counts, order: L.orderCheck() }
		})
		const ok = d.shape.text === d.shape.want && d.shape.level === 0 && d.text.text === d.text.want &&
			d.conn.text === d.conn.want && d.conn.want === 'Hub' && d.conn.attached && d.conn.level === 0 && d.routed === 800 &&
			d.counts.shape === 500 && d.counts.text === 100 && d.counts.connector === 800 && d.order.sorted && pageErrors.length === 0
		return [ok, d]
	})

	await step('check', 'shape hit test: ellipse corner misses, inside hits; triangle outside its outline misses', async () => {
		const d = await lab(() => {
			const L = window.__lab
			const pick = (kind) => L.meta.shapeIds.find((id) => L.model.get(id).data.kind === kind && L.model.get(id).r === 0)
			// an isolated model: notes and text items of the board may lie on top of these shapes
			const m = new L.model.constructor()
			m.load([structuredClone(L.model.get(pick('ellipse'))), structuredClone(L.model.get(pick('triangle')))])
			const e = m.abs(pick('ellipse'))
			const t = m.abs(pick('triangle'))
			return {
				ellipseCenter: m.hitTest(e.x + e.w / 2, e.y + e.h / 2) === pick('ellipse'),
				ellipseCorner: m.hitTest(e.x + 3, e.y + 3),
				triangleBase: m.hitTest(t.x + t.w / 2, t.y + t.h - 3) === pick('triangle'),
				triangleCorner: m.hitTest(t.x + 3, t.y + 3),
			}
		})
		return [d.ellipseCenter && d.ellipseCorner === null && d.triangleBase && d.triangleCorner === null, d]
	})

	await step('check', 'LOD of text items: text at LOD 0; in LOD 1 text while fontSize · scale ≥ 6, else line bars; at LOD 2 (0.08) a grey bar of the painting, no node', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const small = L.meta.textIds.find((id) => L.model.get(id).style.fontSize === 16)
			const big = L.meta.textIds.find((id) => L.model.get(id).style.fontSize === 64)
			const at = async (id, scale) => {
				await L.focusItem(id, scale)
				return L.scene.renderer.nodeLevel(id)
			}
			const out = { small03: await at(small, 0.3), small02: await at(small, 0.2), big02: await at(big, 0.2), big01: await at(big, 0.1), small01: await at(small, 0.1) }
			await L.focusItem(big, 0.08)
			out.at008 = { lod: L.stats().lod, attached: L.staticOrder().includes(big), painted: L.scene.renderer.coarsePainted().ids.includes(big) }
			await L.focusItem(big, 1)
			return out
		})
		return [d.small03 === 0 && d.small02 === 1 && d.big02 === 0 && d.big01 === 0 && d.small01 === 1 &&
			d.at008.lod === 2 && !d.at008.attached && d.at008.painted, d]
	})

	await step('gate', 'G11 Transformer: resize one item live, 0 draws of the static layer while dragging; release order', async () => {
		const id = await lab(() => window.__lab.meta.shapeIds.find((i) => window.__lab.model.get(i).r === 0))
		await lab((i) => window.__lab.focusItem(i, 1), id)
		// Ctrl held (R12, job 015): the exact size below needs the raw resize, in the dense board the shape could snap to a neighbour
		const d = await lab((i) => window.__lab.transformDrag([i], 'br', 12, { dx: 6, dy: 4 }, true), id)
		const ok = d.live === true && d.transformingDuring && d.activeChildrenDuring >= 1 && d.staticDrawsDuring === 0 &&
			d.overlayDrawsDuring >= d.frames - 1 && d.modelMovedDuring && d.intent?.activeAtIntent === true &&
			JSON.stringify(d.order) === '["activity:true","dragPreview","intent","activity:false"]' &&
			near(d.modelAfter.w, d.absBefore.w + 78, 0.01) && near(d.modelAfter.h, d.absBefore.h + 52, 0.01) &&
			d.activeChildrenAfter === 0 && d.orderCheck.sorted
		return [ok, { staticDrawsDuring: d.staticDrawsDuring, overlayDrawsDuring: d.overlayDrawsDuring, frames: d.frames, order: d.order, w: [d.absBefore.w, d.modelAfter.w], h: [d.absBefore.h, d.modelAfter.h] }]
	})

	await step('gate', 'G11 Transformer: > 50 items preview = one activeGroup setAttrs per frame, 0 static draws, model only at the release', async () => {
		const ids = await lab(async () => {
			const L = window.__lab
			const c = L.meta.denseCenter
			const out = L.model.queryRect({ x: c.x - 1200, y: c.y - 900, w: 2400, h: 1800 }).filter((id) => L.model.get(id).t === 'sticky').slice(0, 60)
			const b = L.model.boundsOf(out)
			const s = 0.4
			L.scene.setCamera({ x: b.x + b.w / 2 - 1920 / (2 * s), y: b.y + b.h / 2 - 1080 / (2 * s), scale: s })
			await L.idle()
			return out
		})
		const d = await lab((i) => window.__lab.transformDrag(i, 'br', 12, { dx: 5, dy: 5 }), ids)
		const max = await lab(() => window.__lab.TRANSFORM_LIVE_MAX)
		const ok = ids.length > max && d.live === false && d.staticDrawsDuring === 0 && d.activeSetAttrsDuring === d.frames &&
			!d.modelMovedDuring && d.modelAfter.w > d.absBefore.w && d.intent?.ids === ids.length &&
			d.activeAfter.scaleX === 1 && d.activeAfter.x === 0 && d.activeChildrenAfter === 0 && d.orderCheck.sorted &&
			JSON.stringify(d.order) === '["activity:true","dragPreview","intent","activity:false"]'
		return [ok, { n: ids.length, live: d.live, setAttrsPerFrame: d.activeSetAttrsDuring / d.frames, staticDrawsDuring: d.staticDrawsDuring, modelMovedDuring: d.modelMovedDuring, w: [d.absBefore.w, d.modelAfter.w] }]
	})

	// ---------------------------------------------------------------- M1 round 1b: connectors (SPEC-M1 §8.5, §6.3)

	await step('gate', 'G12 Verbinder ziehen: note with 6 connectors dragged (it snaps), 0 draws of the static layer, connectors in the activeGroup re-routed in every frame in which the note moved; fps reported (target ≥ 55 Chromium)', async () => {
		const d = await lab(() => window.__lab.connectorDrag(90))
		// the drag snaps (R12): the overlay is drawn in every frame in which the note moved
		const ok = d.connectors === 6 && d.staticDrawsDuring === 0 && d.overlayDrawsDuring >= d.movedFrames - 1 &&
			d.activeChildrenDuring >= 7 && d.connectorsActive && d.allRerouted && d.consistent &&
			JSON.stringify(d.intent?.ids) === JSON.stringify([d.hub]) && d.after.activeChildren === 0 && d.after.order
		return [ok, { ...d, fpsTarget55: d.fps.fps >= 55 }]
	})

	await step('gate', 'G13 Routen: deterministic route snapshots (straight, elbow with all 16 side combinations, curved, rotated targets) equal the expected point lists; the model routes alike', async () => {
		const d = await lab(() => window.__lab.routeCheck())
		const ok = d.n === d.snapshots && d.n >= 80 && d.mismatched.length === 0 && d.modelMismatched.length === 0 &&
			d.combos === 16 && d.kinds.straight >= 3 && d.kinds.curved >= 3 && d.rotated >= 6
		return [ok, d]
	})

	await step('check', 'connector tool (real mouse): L + drag from note to note → connect, routed, rendered, selected; Esc cancels a second drag; end handle re-targets; double click edits the label (kind label)', async () => {
		const ids = await lab(async () => {
			const L = window.__lab
			const [a, b] = L.meta.centerNoteIds.slice(2, 4)
			const box = L.model.boundsOf([a, b])
			L.scene.setCamera({ x: box.x - 200, y: box.y - 200, scale: 1 })
			L.select([])
			await L.idle()
			L.clearLog()
			return { a, b }
		})
		const ca = await lab((id) => window.__lab.clientCenter(id), ids.a)
		const cb = await lab((id) => window.__lab.clientCenter(id), ids.b)
		await focusCanvas()
		await page.keyboard.press('l')
		const tool = await lab(() => window.__lab.scene.getTool())
		await page.mouse.move(ca.x, ca.y)
		await page.mouse.down()
		await page.mouse.move((ca.x + cb.x) / 2, (ca.y + cb.y) / 2 + 40, { steps: 4 })
		await page.mouse.move(cb.x + 10, cb.y + 10, { steps: 4 })
		const during = await lab(() => ({ connecting: window.__lab.stats().connecting, ui: window.__lab.stats().uiChildren }))
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const made = await lab(() => {
			const L = window.__lab
			const intent = L.log.find((e) => e[0] === 'intent' && e[1].type === 'connect')?.[1] ?? null
			const id = L.scene.getSelection()[0]
			return { intent, id, t: L.model.get(id)?.t, routed: !!L.model.geometryOf(id), attached: L.staticOrder().includes(id), tool: L.scene.getTool() }
		})
		// Esc cancels a second drag
		await page.keyboard.press('l')
		await page.mouse.move(ca.x, ca.y)
		await page.mouse.down()
		await page.mouse.move(cb.x, cb.y, { steps: 4 })
		await page.keyboard.press('Escape')
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const connects = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent' && e[1].type === 'connect').length)
		// end handle: re-target to a third note
		await page.keyboard.press('v')
		const third = await lab((id) => {
			const L = window.__lab
			L.select([id])
			return L.meta.centerNoteIds[4]
		}, made.id)
		await lab(() => window.__lab.idle())
		const hd = await lab(() => window.__lab.handles())
		const endH = hd.find((x) => x.name === 'end')
		const ct = await lab((id) => window.__lab.clientCenter(id), third)
		const board = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().toJSON())
		await page.mouse.move(board.left + endH.x, board.top + endH.y)
		await page.mouse.down()
		await page.mouse.move(ct.x, ct.y, { steps: 5 })
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const re = await lab(([id, t]) => {
			const L = window.__lab
			const e = L.log.find((x) => x[0] === 'intent' && x[1].type === 'retarget')
			return { intent: e?.[1] ?? null, active: e?.[2]?.activeAtIntent ?? null, end: L.model.get(id).data.end, third: t }
		}, [made.id, third])
		// double click on the line: label editor
		const mid = await lab((id) => {
			const g = window.__lab.model.geometryOf(id)
			return window.__lab.scene.worldToScreen(g.labelAt.x, g.labelAt.y)
		}, made.id)
		await page.mouse.dblclick(board.left + mid.x, board.top + mid.y)
		const kind = await lab(() => window.__lab.editor()?.getAttribute('data-knorke-editor-kind') ?? null)
		await page.keyboard.type('Ja')
		await page.keyboard.press('Enter')
		await lab(() => window.__lab.idle())
		const label = await lab((id) => ({ label: window.__lab.model.get(id).data.label, node: window.__lab.nodeText(id), editor: !!window.__lab.editor() }), made.id)
		const ok = tool === 'connector' && during.connecting === 'connect' && during.ui >= 2 &&
			made.intent?.start?.item === ids.a && made.intent?.end?.item === ids.b && made.t === 'connector' && made.routed && made.attached && made.tool === 'select' &&
			connects === 1 && re.intent?.which === 'end' && re.active === true && re.end?.item === third &&
			kind === 'label' && label.label === 'Ja' && label.node === 'Ja' && !label.editor
		return [ok, { tool, during, made, connects, retarget: re, kind, label }]
	})

	await step('check', 'connector UI in Konva: a selected connector gets a halo line along its route and two round end handles; one note gets four round "+" handles', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const cid = L.meta.hubConnectorIds[1]
			await L.focusItem(L.meta.hubNoteId, 1)
			L.select([cid])
			await L.idle()
			const ui = L.scene.renderer.stage.getLayers()[1].children[1]
			const hits = L.model.geometryOf(cid).hitPts
			const halo = ui.children.filter((n) => n.getClassName() === 'Line' && JSON.stringify(n.points()) === JSON.stringify(hits))
			const names = L.handles().map((x) => x.name)
			const round = ui.children.filter((n) => n.getClassName() === 'Rect' && n.cornerRadius() > 0 && Math.abs(n.cornerRadius() - n.width() / 2) < 1e-9)
			L.select([L.meta.hubNoteId])
			await L.idle()
			const noteNames = L.handles().map((x) => x.name)
			const roundNote = ui.children.filter((n) => n.getClassName() === 'Rect' && n.cornerRadius() > 0).length
			L.select([])
			await L.idle()
			return { halo: halo.length, haloOpacity: halo[0]?.opacity() ?? null, names, round: round.length, noteNames, roundNote, uiAfter: L.stats().uiChildren }
		})
		const ok = d.halo === 1 && d.haloOpacity > 0 && JSON.stringify(d.names) === '["start","end"]' && d.round === 2 &&
			d.noteNames.filter((n) => n.startsWith('plus-')).length === 4 && d.roundNote === 5 && d.uiAfter === 0
		return [ok, d]
	})

	await step('check', 'connector LOD: label at LOD 0; LOD 1 line and caps without the label', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const cid = L.meta.hubConnectorIds[0]
			await L.focusItem(L.meta.hubNoteId, 1)
			const lod0 = { level: L.scene.renderer.nodeLevel(cid), text: L.nodeText(cid) }
			await L.focusItem(L.meta.hubNoteId, 0.2)
			const lod1 = { level: L.scene.renderer.nodeLevel(cid), text: L.nodeText(cid), attached: L.staticOrder().includes(cid) }
			await L.focusItem(L.meta.hubNoteId, 1)
			return { lod0, lod1, back: L.nodeText(cid) }
		})
		return [d.lod0.level === 0 && d.lod0.text === 'Hub' && d.lod1.level === 1 && d.lod1.text === null && d.lod1.attached && d.back === 'Hub', d]
	})

	await step('check', 'connector labels (finding S-1b-01): Konva keeps every label whole in its estimated box (no …, every character, ≤ box.lines lines, OK/TODO/WICHTIG/👍/会议记录 on one line, lines within the box width, centred); every glyph within labelGlyphWidth', async () => {
		const d = await lab(() => window.__lab.labelCheck())
		const ink = (s) => s.replace(/\s+/g, '').length
		const eps = 1e-6
		const rows = d.labels.map((l) => {
			const b = l.box
			const t = l.layout
			if (!b || !t) return { text: l.text, ok: false, why: 'no box or no text node' }
			const W = b.w - 2 * d.pad
			const texts = t.rows.map((r) => r.text)
			const why = [
				l.level === 0 ? null : `level ${l.level}`,
				texts.some((x) => x.includes('…')) ? 'ellipsis' : null,
				ink(texts.join('')) === ink(l.text) ? null : 'characters lost',
				t.rows.length >= 1 && t.rows.length <= b.lines ? null : `${t.rows.length} rows > ${b.lines}`,
				!l.finding || (t.rows.length === 1 && b.lines === 1 && texts[0] === l.text) ? null : 'not one whole line',
				t.rows.every((r) => r.width <= W + eps) ? null : 'row wider than the box',
				t.fixedWidth && Math.abs(t.width - W) < eps ? null : `text width ${t.width} ≠ ${W}`,
				t.height <= b.h - 2 * d.pad + eps ? null : 'taller than the box',
				Math.abs(t.x + t.width / 2 - (b.x + b.w / 2)) < eps && Math.abs(t.y + t.height / 2 - (b.y + b.h / 2)) < eps ? null : 'not centred',
			].filter(Boolean)
			return { text: l.text, ok: why.length === 0, why, lines: b.lines, rows: texts, w: b.w }
		})
		const ok = rows.length === 13 && rows.every((r) => r.ok) && d.restored && d.glyphs.n > 200 && d.glyphs.over.length === 0
		return [ok, { rows, restored: d.restored, glyphs: d.glyphs }]
	})

	await step('check', 'remote drag preview of the hub note: its connectors join the activeGroup and dock at the preview box; back after', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const id = L.meta.hubNoteId
			await L.focusItem(id, 1)
			L.select([])
			await L.idle()
			const a = L.model.abs(id)
			const before = L.meta.hubConnectorIds.map((k) => JSON.stringify(L.model.geometryOf(k).points))
			L.setSamples([{ key: 'pidAl:c1', pid: 'pidAl', name: 'Alice Adler', color: '#2f6fdb', guest: false,
				cursor: null, selection: [], drag: [[id, a.x + 120, a.y + 60]], editing: null, editingHolder: false }])
			await L.frames(2)
			const during = { active: L.stats().activeChildren, changed: L.meta.hubConnectorIds.filter((k, i) => JSON.stringify(L.model.geometryOf(k).points) !== before[i]).length }
			L.setSamples([])
			await L.idle()
			const after = { active: L.stats().activeChildren, same: L.meta.hubConnectorIds.every((k, i) => JSON.stringify(L.model.geometryOf(k).points) === before[i]) }
			return { during, after, order: L.orderCheck().sorted }
		})
		return [d.during.active >= 7 && d.during.changed === 6 && d.after.active === 0 && d.after.same && d.order, d]
	})

	await step('check', 'transformer: frame from the top-left keeps its children in place (keep), no rotation handle; text corner scales the font', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const fid = L.meta.frameIds[1]
			const kid = L.model.childrenOf(fid)[0]
			const f = L.model.abs(fid)
			L.scene.setCamera({ x: f.x - 400, y: f.y - 400, scale: 0.25 })
			await L.idle()
			L.select([fid])
			await L.idle()
			const names = L.handles().map((x) => x.name)
			const kidBefore = L.model.abs(kid)
			const r = await L.transformDrag([fid], 'tl', 6, { dx: 5, dy: 4 })
			const kidAfter = L.model.abs(kid)
			const tid = L.meta.textIds.find((id) => L.model.get(id).r === 0)
			await L.focusItem(tid, 1)
			const fs0 = L.model.get(tid).style.fontSize
			const w0 = L.model.get(tid).w
			const t = await L.transformDrag([tid], 'br', 10, { dx: 8, dy: 0 })
			return { names, keep: r.intent?.keep, kidBefore, kidAfter, frameAfter: L.model.abs(fid), frameBefore: f, fs0, fs1: L.model.get(tid).style.fontSize, w0, w1: L.model.get(tid).w, h1: L.model.get(tid).h, textAfter: t.intent?.after }
		})
		const ok = !d.names.includes('rot') && d.names.length === 8 && d.keep === true &&
			near(d.kidAfter.x, d.kidBefore.x, 1) && near(d.kidAfter.y, d.kidBefore.y, 1) && d.frameAfter.x > d.frameBefore.x &&
			d.fs1 > d.fs0 && Number.isInteger(d.fs1) && d.w1 > d.w0
		return [ok, d]
	})

	await step('check', 'transformer: rotation snaps to 45°; Esc during a resize puts it back without an intent', async () => {
		const d = await lab(async () => {
			const L = window.__lab
			const id = L.meta.shapeIds.find((i) => L.model.get(i).r === 0 && i !== L.meta.shapeIds[0])
			await L.focusItem(id, 1)
			L.select([id])
			await L.idle()
			const a = L.model.abs(id)
			const rot = L.handles().find((x) => x.name === 'rot')
			const c = L.scene.worldToScreen(a.x + a.w / 2, a.y + a.h / 2)
			L.clearLog()
			L.mouse('pointerdown', rot.x, rot.y)
			const t = (47 - 90) * Math.PI / 180
			L.mouse('pointermove', rot.x + 10, rot.y)
			await L.frames(1)
			L.mouse('pointermove', c.x + 150 * Math.cos(t), c.y + 150 * Math.sin(t))
			await L.frames(1)
			L.mouse('pointerup', c.x + 150 * Math.cos(t), c.y + 150 * Math.sin(t))
			await L.idle()
			const r = L.model.get(id).r
			const before = L.model.abs(id)
			const br = L.handles().find((x) => x.name === 'br')
			L.clearLog()
			L.mouse('pointerdown', br.x, br.y)
			L.mouse('pointermove', br.x + 40, br.y + 30)
			await L.frames(2)
			const during = L.model.abs(id)
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			L.mouse('pointerup', br.x + 40, br.y + 30)
			await L.idle()
			return { r, during, before, after: L.model.abs(id), intents: L.log.filter((e) => e[0] === 'intent').length, transforming: L.stats().transforming }
		})
		const ok = d.r === 45 && d.during.w !== d.before.w && JSON.stringify(d.after) === JSON.stringify(d.before) && d.intents === 0 && !d.transforming
		return [ok, d]
	})

	await step('gate', 'G18 Textmessung: measureTextHeight for 50 text items gives the same values in two runs (whole lines)', async () => {
		const d = await lab(() => window.__lab.measureTexts())
		return [d.n === 50 && d.same && d.whole, d]
	})

	await step('check', 'keys v2: single keys only with canvas focus; Tab selects frames first; Ctrl+C copies the selection, not with marked page text', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idB)
		await lab(() => { window.__lab.select([]); window.__lab.clearLog(); document.activeElement?.blur?.(); return window.__lab.idle() })
		await page.keyboard.press('n')
		const unfocused = await lab(() => window.__lab.scene.getTool())
		await focusCanvas()
		await page.keyboard.press('Tab')
		const tab = await lab(() => ({ sel: window.__lab.scene.getSelection(), t: window.__lab.model.get(window.__lab.scene.getSelection()[0])?.t, focus: document.activeElement?.id }))
		await page.keyboard.press('Control+c')
		const copied = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent').map((e) => e[1].type))
		await lab(() => {
			const r = document.createRange()
			const span = document.createElement('span')
			span.textContent = 'page text'
			document.body.appendChild(span)
			r.selectNodeContents(span)
			window.getSelection().removeAllRanges()
			window.getSelection().addRange(r)
			window.__lab.clearLog()
		})
		// the canvas keeps the focus (selecting by Range moves no focus)
		await page.keyboard.press('Control+c')
		const withText = await lab(() => {
			const n = window.__lab.log.filter((e) => e[0] === 'intent').length
			window.getSelection().removeAllRanges()
			return n
		})
		await page.keyboard.press('Control+v')
		const paste = await lab(() => window.__lab.log.filter((e) => e[0] === 'intent').map((e) => e[1]))
		await page.keyboard.press('Escape')
		const ok = unfocused === 'select' && tab.sel.length === 1 && tab.t === 'frame' && tab.focus === 'board' &&
			JSON.stringify(copied) === '["copy"]' && withText === 0 && paste.length === 1 && paste[0].type === 'pasteKey' && paste[0].inPlace === false
		return [ok, { unfocused, tab, copied, withText, paste }]
	})

	await step('check', 'create: S tool drag → shape with kind and rect, editor kind shape; T tool click → text, editor kind text, h measured', async () => {
		await lab(() => {
			window.__lab.scene.setCamera({ x: -6000, y: -6000, scale: 1 })
			window.__lab.clearLog()
			return window.__lab.idle()
		})
		const box = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().toJSON())
		await lab(() => window.__lab.scene.setTool('shape', { kind: 'ellipse' }))
		await page.mouse.move(box.left + 300, box.top + 300)
		await page.mouse.down()
		await page.mouse.move(box.left + 500, box.top + 420, { steps: 5 })
		await page.mouse.up()
		await lab(() => window.__lab.frames(2))
		const shape = await lab(() => ({ kind: window.__lab.editor()?.getAttribute('data-knorke-editor-kind'), id: window.__lab.scene.getSelection()[0] }))
		await page.keyboard.type('Form')
		await page.keyboard.press('Escape')
		await lab(() => window.__lab.idle())
		await focusCanvas()
		await page.keyboard.press('t')
		await page.mouse.click(box.left + 900, box.top + 300)
		await lab(() => window.__lab.frames(2))
		const text = await lab(() => ({ kind: window.__lab.editor()?.getAttribute('data-knorke-editor-kind'), id: window.__lab.scene.getSelection()[0] }))
		await page.keyboard.type('Zeile eins')
		await page.keyboard.press('Shift+Enter')
		await page.keyboard.type('Zeile zwei')
		await page.keyboard.press('Escape')
		await lab(() => window.__lab.idle())
		const d = await lab(([s, t]) => {
			const L = window.__lab
			const creates = L.log.filter((e) => e[0] === 'intent' && e[1].type === 'create').map((e) => e[1])
			const texts = L.log.filter((e) => e[0] === 'intent' && e[1].type === 'text' && e[1].final).map((e) => e[1])
			return {
				creates, texts: texts.map((x) => ({ value: x.value, h: x.h ?? null })),
				shape: L.model.get(s), text: L.model.get(t), focus: document.activeElement?.id,
			}
		}, [shape.id, text.id])
		const ok = shape.kind === 'shape' && text.kind === 'text' && d.creates.length === 2 &&
			d.creates[0].t === 'shape' && d.creates[0].data?.kind === 'ellipse' && near(d.creates[0].rect?.w ?? 0, 200, 0.5) && near(d.creates[0].rect?.h ?? 0, 120, 0.5) &&
			d.creates[1].t === 'text' && d.creates[1].rect === null && d.shape?.data?.text === 'Form' && d.shape?.data?.kind === 'ellipse' &&
			d.text?.data?.text === 'Zeile eins\nZeile zwei' && near(d.text.h, 2 * 24 * 1.2, 0.01) && d.texts.at(-1)?.h === d.text.h &&
			d.texts[0].h === null && d.focus === 'board'
		return [ok, { shape, text, creates: d.creates.map((c) => [c.t, c.data?.kind, c.rect && [Math.round(c.rect.w), Math.round(c.rect.h)]]), texts: d.texts, textH: d.text?.h }]
	})

	await step('check', 'view-only: double click opens nothing; a finger does not focus the canvas (R9); LOD 1 below 0.3', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idB)
		await lab(() => window.__lab.setViewOnly(true))
		const c = await lab((id) => window.__lab.clientCenter(id), idB)
		await page.mouse.dblclick(c.x, c.y)
		const editor = await lab(() => !!window.__lab.editor())
		const tapFocus = await lab(async (id) => {
			const L = window.__lab
			const board = document.getElementById('board')
			const mouse = document.activeElement === board
			document.activeElement?.blur?.()
			const r = L.scene.itemScreenRect(id)
			L.touch('pointerdown', 41, r.x + r.w / 2, r.y + r.h / 2)
			L.touch('pointerup', 41, r.x + r.w / 2, r.y + r.h / 2)
			await L.idle()
			return { mouse, touch: document.activeElement === board }
		}, idB)
		await lab(() => window.__lab.setViewOnly(false))
		await lab((id) => window.__lab.focusItem(id, 0.2), idB)
		const lod1 = await lab(() => window.__lab.stats().lod)
		await lab((id) => window.__lab.focusItem(id, 0.5), idB)
		const lod0 = await lab(() => window.__lab.stats().lod)
		return [!editor && tapFocus.mouse && !tapFocus.touch && lod1 === 1 && lod0 === 0, { editorInViewOnly: editor, focus: tapFocus, lod1, lod0 }]
	})

	// ---------------------------------------------------------------- stage 2: modes and LOD 2 (SPEC-M1 §6.3, §8.5)

	await step('check', '(R13) setMode settle during a real mouse drag: preview cleared → move intent → activity end, then vote; the release does nothing; back to edit', async () => {
		await lab((id) => window.__lab.focusItem(id, 1), idA)
		await lab(() => { window.__lab.select([]); window.__lab.clearLog() })
		const c0 = await lab((id) => window.__lab.clientCenter(id), idA)
		await page.mouse.move(c0.x, c0.y)
		await page.mouse.down()
		for (let i = 1; i <= 6; i++) await page.mouse.move(c0.x + 15 * i, c0.y + 5 * i)
		await lab(() => window.__lab.frames(1))
		const atSettle = await lab(() => {
			const L = window.__lab
			L.setMode('vote', { settle: true })
			return { mode: L.scene.getMode(), dragging: L.stats().dragging }
		})
		await page.mouse.move(c0.x + 200, c0.y + 80)
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const d = await lab(() => ({ log: window.__lab.log.slice(), mode: window.__lab.scene.getMode() }))
		await lab(() => window.__lab.setMode('edit'))
		const seq = d.log.filter((e) => (e[0] === 'dragPreview' && e[1] === 0) || e[0] === 'intent' || (e[0] === 'activity' && e[1].kind === 'drag'))
			.map((e) => e[0] === 'intent' ? 'intent:' + e[1].type : e[0] === 'activity' ? 'activity:' + e[1].active : 'preview:0')
		const moves = d.log.filter((e) => e[0] === 'intent' && e[1].type === 'move')
		const ok = JSON.stringify(seq) === '["activity:true","preview:0","intent:move","activity:false"]' &&
			moves.length === 1 && moves[0][2].activeAtIntent === true && near(moves[0][1].dx, 90, 0.5) &&
			atSettle.mode === 'vote' && atSettle.dragging === false && d.mode === 'vote'
		return [ok, { seq, move: moves[0]?.[1], atSettle }]
	})

	await step('gate', 'G14 LOD 2: (1) one static child at 0.08 and in the board pan at 0.05; (2) camera step p95 ≤ 2 ms in the zoom series around 0.08 (< LOD2_ENTER) and the board pan; (3) first render of the whole board at 0.05 ≤ 250 ms; (4) 0.1 ± 0.004 without a switch; (5) drag at 0.08: 0 static draws, one static child, the note not painted; fps reported', async () => {
		const d = await lab(() => window.__lab.lod2Gate())
		const g = {
			one: d.at008.lod === 2 && d.at008.staticChildren === 1 && d.boardPan.staticChildren.min === 1 && d.boardPan.staticChildren.max === 1 &&
				d.zoom.staticChildren.max === 1 && JSON.stringify(d.zoom.lods) === '[2]' && JSON.stringify(d.boardPan.lods) === '[2]',
			step: d.zoom.camera.p95 <= 2 && d.boardPan.camera.p95 <= 2,
			first: d.firstRender.ms !== null && d.firstRender.ms <= 250 && d.firstRender.lod === 2 && d.firstRender.staticChildren === 1,
			hyst: JSON.stringify(d.hysteresis.from1.lods) === '[1]' && JSON.stringify(d.hysteresis.from2.lods) === '[2]' &&
				d.hysteresis.from1.switches === 0 && d.hysteresis.from2.switches === 0 && d.hysteresis.left === 1 && d.hysteresis.entered === 2,
			drag: d.drag.hitAtPress && d.drag.staticDrawsDuring === 0 && d.drag.paintsDuring === 0 && d.drag.staticChildren.min === 1 &&
				d.drag.staticChildren.max === 1 && d.drag.lod === 2 && !d.drag.paintedHasNote && d.drag.paintedConnectors === 0 &&
				d.drag.connectorsActive && d.drag.connectorsInLayers === 0 && d.drag.activeChildren.max === 1 &&
				JSON.stringify(d.drag.intent?.ids) === JSON.stringify([d.drag.hub]) && d.drag.after.paintedHasNote && d.drag.after.activeChildren === 0,
		}
		const report = {
			zoom: { fps: d.zoom.frames.fps, missed: d.zoom.frames.pctMissed, cameraP50: d.zoom.camera.p50, cameraP95: d.zoom.camera.p95, staticDrawP50: d.zoom.draw.static.p50 },
			boardPan: { fps: d.boardPan.frames.fps, missed: d.boardPan.frames.pctMissed, cameraP50: d.boardPan.camera.p50, cameraP95: d.boardPan.camera.p95, staticDrawP50: d.boardPan.draw.static.p50, scale: d.boardPan.scale },
		}
		return [Object.values(g).every(Boolean), { gates: g, ...report, at008: d.at008, firstRender: d.firstRender, hysteresis: d.hysteresis, drag: d.drag }]
	})

	await step('check', 'LOD 2 painting: one fillRect per painted id, frame border + 12-px title (≥ 40 px), no connector, the non-connector ids in view in compareOrder; a remote drag preview leaves the painting (one static draw) and comes back', async () => {
		const d = await lab(() => window.__lab.coarsePaintCheck(0.05))
		const ok = d.lod === 2 && d.staticChildren === 1 && d.staticDraws === 1 && d.painted === d.expected && d.sameOrder &&
			d.connectorsPainted === 0 && d.fillRect === d.painted && d.strokeRect === d.frames && d.frames >= 20 &&
			d.fillText === d.titled && d.titled > 0 && !d.preview.inPainting && d.preview.activeChildren === 1 &&
			d.preview.staticDraws === 1 && d.preview.back
		return [ok, d]
	})

	await step('check', 'LOD 2 interaction (E36 in the lab): a real click at 5 % selects a note; a click on a connector line selects nothing; the marquee leaves connectors out; Ctrl+A keeps them; a selected connector shows only its halo; back at 100 % the end handles and the nodes return', async () => {
		const t = await lab(() => window.__lab.lod2Targets(0.05))
		if (!t.note || !t.line) return [false, { error: 'no target', t }]
		const sel = () => lab(() => window.__lab.scene.getSelection())
		await page.mouse.click(t.note.at.x, t.note.at.y)
		await lab(() => window.__lab.frames(2))
		const clickNote = await sel()
		await page.mouse.click(t.line.at.x, t.line.at.y)
		await lab(() => window.__lab.frames(2))
		const clickLine = await sel()
		await page.mouse.move(t.marquee.from.x, t.marquee.from.y)
		await page.mouse.down()
		await page.mouse.move(t.marquee.to.x, t.marquee.to.y, { steps: 6 })
		await page.mouse.up()
		await lab(() => window.__lab.frames(2))
		const marquee = await lab(() => {
			const L = window.__lab
			const ids = L.scene.getSelection()
			return { n: ids.length, connectors: ids.filter((id) => L.model.get(id).t === 'connector').length, notes: ids.filter((id) => L.model.get(id).t === 'sticky').length }
		})
		await lab(() => window.__lab.focusCanvas())
		await page.keyboard.press('Control+a')
		const all = await lab(() => ({ n: window.__lab.scene.getSelection().length, items: window.__lab.model.size }))
		const halo = await lab(async (cid) => {
			const L = window.__lab
			L.select([cid])
			await L.idle()
			const at2 = { handles: L.handles().map((x) => x.name), ui: L.stats().uiChildren, lod: L.stats().lod }
			const a = L.model.boundsOf([cid])
			L.scene.setCamera({ x: a.x + a.w / 2 - 960, y: a.y + a.h / 2 - 540, scale: 1 })
			await L.idle()
			const at0 = { handles: L.handles().map((x) => x.name), lod: L.stats().lod, staticChildren: L.stats().staticChildren, order: L.orderCheck() }
			L.select([])
			await L.idle()
			return { at2, at0 }
		}, t.line.id)
		const ok = JSON.stringify(clickNote) === JSON.stringify([t.note.id]) && clickLine.length === 0 &&
			t.marquee.startEmpty && t.marquee.inView && marquee.connectors === 0 && marquee.notes >= t.marquee.notesInside && t.marquee.connectorsInside > 0 &&
			all.n === all.items && JSON.stringify(halo.at2.handles) === '[]' && halo.at2.ui >= 1 && halo.at2.lod === 2 &&
			JSON.stringify(halo.at0.handles) === '["start","end"]' && halo.at0.lod === 0 && halo.at0.staticChildren > 1 && halo.at0.order.sorted
		return [ok, { note: t.note.id, clickNote, clickLine, marquee: { ...marquee, target: t.marquee }, all, halo }]
	})

	await step('check', 'LOD 2 frame title (R14-13): a real click at 5 % on the painted title 13–14 px above a frame (outside its title band and border band) selects the frame; at the same height beside the title nothing', async () => {
		const t = await lab(() => window.__lab.lod2TitleTargets(0.05))
		if (!t.target) return [false, { error: 'no target', t }]
		const sel = () => lab(() => window.__lab.scene.getSelection())
		await page.mouse.click(t.target.beside.x, t.target.beside.y)
		await lab(() => window.__lab.frames(2))
		const beside = await sel()
		await page.mouse.click(t.target.on.x, t.target.on.y)
		await lab(() => window.__lab.frames(2))
		const on = await sel()
		await lab(async () => {
			window.__lab.select([])
			await window.__lab.idle()
		})
		const ok = t.lod === 2 && t.target.above > t.bands.borderBandPx && t.target.above > t.bands.titleBandPx && t.target.above < t.bands.boxPx &&
			t.target.recordedOk && beside.length === 0 && JSON.stringify(on) === JSON.stringify([t.target.id])
		return [ok, { ...t, clickBeside: beside, clickTitle: on }]
	})

	// ---------------------------------------------------------------- stage 3 (SPEC-M1 §8.5 G15, G16; §6.3 "Folgen", "Modus vote")
	await step('gate', 'G15 Folgen: followTo over 600 ms: 0 Konva draws while gliding, exactly one at the end (each non-empty layer once, still under the CSS transform), the target exactly; no onUserCamera, no gesture activity', async () => {
		const d = await lab(() => window.__lab.followGate())
		const ok = d.result === true && d.framesGliding >= 20 && d.drawsWhileGliding === 0 && d.cssWhileGliding === d.framesGliding &&
			d.confirmedWhileGliding && d.endDraws.static === 1 && d.endDraws.overlay === (d.overlayNonEmpty ? 1 : 0) && d.endDraws.underTransform &&
			d.afterIdle.static === 1 && d.afterIdle.overlay === (d.overlayNonEmpty ? 1 : 0) && d.exact && d.userCamera === 0 &&
			d.gestureActivity === 0 && d.cssAfter === null && d.ms >= 600 && d.ms <= 750
		return [ok, d]
	})

	await step('check', 'Folgen (2), (5), (1): a new followTo replaces the glide (old false, no draw in between, one end draw); a pointerdown and stopFollow end it at the camera shown (false, one draw, no onUserCamera); prefers-reduced-motion jumps', async () => {
		const d = await lab(() => window.__lab.followChecks())
		await page.emulateMedia({ reducedMotion: 'reduce' })
		let r
		try {
			r = await lab(() => window.__lab.followReduced())
		} finally {
			await page.emulateMedia({ reducedMotion: 'no-preference' })
		}
		const ended = (x) => x.result === false && x.atShown && !x.gliding && x.css === null && x.static === 1 && x.userCamera === 0
		const ok = d.replace.first === false && d.replace.second === true && d.replace.noDrawBefore && d.replace.static === 1 && d.replace.exact &&
			ended(d.pointerdown) && ended(d.stopFollow) && r.reduce === true && r.result === true && !r.gliding && r.atOnce && r.css === 0
		return [ok, { ...d, reduced: r }]
	})

	await step('gate', 'G16 Abzeichen: 300 own badges + 300 empty rings + the scope outline drawn and counted; a touch pan on the CSS path without Konva draws or DOM work, one end draw; digits ≥ 4.5:1 on every PALETTE colour (as drawn); no rings at LOD 2; pan fps reported', async () => {
		const d = await lab(() => window.__lab.badgeGate())
		const c = d.counts
		const ok = !!c && c.rings === 300 && c.badges === 300 && c.totals === 0 && typeof c.outline === 'string' && d.lod === 1 &&
			d.cssPan.allCss && d.cssPan.drawsDuring === 0 && d.cssPan.domMutations === 0 && d.cssPan.endDraws.static === 1 &&
			d.cssPan.endDraws.overlay === 1 && d.afterPan.rings + d.afterPan.badges < 600 && d.afterPan.rings + d.afterPan.badges > 0 &&
			d.back.rings === 300 && d.back.badges === 300 && d.contrast.length === 12 &&
			d.contrast.every((x) => x.own >= 300 && x.worst >= 4.5 && x.digits.length === 1) &&
			d.totals.counts.totals === 300 && d.totals.worst >= 4.5 &&
			d.lod2.lod === 2 && d.lod2.counts.rings === 0 && d.lod2.counts.badges === 300 && d.lod2.counts.outline === c.outline &&
			d.cleared.voteState === null
		return [ok, d]
	})

	await step('check', 'mode vote with real input (SPEC-M1 §6.3): a real click on a votable note → vote with rect = itemScreenRect, on a non-votable note → voteMiss, on empty canvas nothing, a real drag pans without a vote; press per canvas around each; a finger on a 20-px note zooms first (onUserCamera), then votes', async () => {
		const t = await lab(() => window.__lab.voteSetup())
		if (!t.empty) return [false, { error: 'no empty canvas in view', t }]
		await page.mouse.click(t.a.x, t.a.y)
		await page.mouse.click(t.b.x, t.b.y)
		await page.mouse.click(t.empty.x, t.empty.y)
		await page.mouse.move(t.empty.x, t.empty.y)
		await page.mouse.down()
		await page.mouse.move(t.empty.x + 80, t.empty.y + 10, { steps: 8 })
		await page.mouse.up()
		await lab(() => window.__lab.idle())
		const d = await lab(() => window.__lab.voteResult())
		const touch = await lab(() => window.__lab.voteTouch())
		await lab(() => window.__lab.voteTeardown())
		const [v, m] = d.intents
		const ok = d.intents.length === 2 && v.type === 'vote' && v.id === t.A && JSON.stringify(v.rect) === JSON.stringify(t.aRect) &&
			m.type === 'voteMiss' && m.id === t.B && JSON.stringify(d.press) === '[true,false,true,false,true,false,true,false]' &&
			d.userCamera === 1 && d.cameraMoved && d.selection.length === 0 &&
			touch.small.w < 44 && touch.afterZoom.intents === 0 && touch.afterZoom.userCamera === 1 &&
			Math.abs(Math.min(touch.zoomed.w, touch.zoomed.h) - 88) < 0.01 && touch.intents.length === 1 &&
			touch.intents[0].type === 'vote' && touch.intents[0].id === touch.A && touch.userCamera === 1 &&
			JSON.stringify(touch.press) === '[true,false,true,false]'
		return [ok, { t, d, touch }]
	})

	// M2 (SPEC-M1 §1.2 (R12)): the last steps that drag (this one moves note A, the next three drag their own
	// notes below the board and remove them; the last one also pans with the wheel); only the whole-run checks follow
	await step('check', 'Einrasten an Objekten (R12): a synthetic mouse drag snaps note A to the left edge of another note (guides = dashed knorke-snap-guide nodes, 0 static draws, intent ≤ 3 from the raw shift), no guide after the release; with Ctrl the raw shift without guides', async () => {
		const free = await lab(() => window.__lab.snapDrag(false))
		const ctrl = await lab(() => window.__lab.snapDrag(true))
		if (free.error || ctrl.error) return [false, { free, ctrl }]
		// the look (job 010): every guide node dashed as SNAP_GUIDE_DASH, magenta, 1 px, unscaled, phase anchored to the board
		const ok = free.during.snapGuides >= 1 && free.during.nodes === free.during.snapGuides && free.during.staticDraws === 0 &&
			free.during.lookOk === true && free.during.looks.length === free.during.nodes &&
			free.intent !== null && Math.abs(free.intent.dx - free.rawDx) <= 3 + 1e-6 && free.after.snapGuides === 0 && free.after.nodes === 0 &&
			ctrl.during.snapGuides === 0 && ctrl.during.nodes === 0 && ctrl.intent !== null &&
			near(ctrl.intent.dx, ctrl.rawDx, 0.5) && near(ctrl.intent.dy, ctrl.rawDy, 0.5)
		return [ok, { free, ctrl }]
	})

	await step('check', 'Gleiche Abstände (R12): a synthetic mouse drag snaps note A to the gap of two notes in its row (two solid knorke-gap-marker nodes, no snap guide, 0 static draws, intent −80 for a raw −77), no marker after the release; with Ctrl the raw shift without markers', async () => {
		const free = await lab(() => window.__lab.gapDrag(false))
		const ctrl = await lab(() => window.__lab.gapDrag(true))
		const ok = free.during.gapMarkers === 2 && free.during.nodes === 2 && free.during.lookOk === true &&
			free.during.snapGuides === 0 && free.during.staticDraws === 0 &&
			free.intent !== null && near(free.intent.dx, -80, 1e-6) && near(free.intent.dy, 0, 1e-6) &&
			free.after.gapMarkers === 0 && free.after.nodes === 0 &&
			ctrl.during.gapMarkers === 0 && ctrl.during.nodes === 0 && ctrl.intent !== null &&
			near(ctrl.intent.dx, ctrl.rawDx, 0.5) && near(ctrl.intent.dy, ctrl.rawDy, 0.5)
		return [ok, { free, ctrl }]
	})

	await step('check', 'Einrasten beim Skalieren (R12): a synthetic mouse drag on the handle r snaps the right edge of note A to the left edge of note B (one dashed knorke-snap-guide node, 0 static draws, A 400 wide for a raw +197), no guide after the release; with Ctrl the raw width without guides', async () => {
		const free = await lab(() => window.__lab.resizeSnap(false))
		const ctrl = await lab(() => window.__lab.resizeSnap(true))
		if (free.error || ctrl.error) return [false, { free, ctrl }]
		const a = free.intent?.after
		const ok = free.during.snapGuides === 1 && free.during.nodes === 1 && free.during.lookOk === true && free.during.staticDraws === 0 &&
			a != null && near(a.w, 400, 1e-6) && near(a.x, free.x0, 1e-6) && a.h === 200 &&
			free.after.snapGuides === 0 && free.after.nodes === 0 &&
			ctrl.during.snapGuides === 0 && ctrl.during.nodes === 0 && ctrl.intent !== null && near(ctrl.intent.after.w, 397, 0.5)
		return [ok, { free, ctrl }]
	})

	await step('check', 'Raster (R12): setGrid(true) puts one canvas.knorke-grid (aria-hidden, pointer-events none, bitmap w·pr × h·pr) first in the scene container, before the Konva content, that a hit passes through; minor/major line colors, a transparent cell; a synthetic drag snaps note N to (x0 + 40, y0 + 40) without guides and without grid or static draws; a wheel pan repaints the untransformed grid; setGrid(false) removes it', async () => {
		const d = await lab(() => window.__lab.gridCheck())
		const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
		const isColor = (px, hex) => Array.isArray(px) && rgb(hex).every((v, i) => Math.abs(px[i] - v) <= 2) && px[3] === 255
		const ok = d.dom?.count === 1 && d.dom.first === true && d.dom.pointerEvents === 'none' && d.dom.ariaHidden === 'true' &&
			d.dom.width === d.dom.wantWidth && d.dom.height === d.dom.wantHeight && d.dom.canvases === 3 &&
			d.hit?.grid === false &&
			isColor(d.px?.minor, d.colors.minor) && isColor(d.px.major, d.colors.major) && d.px.cell?.[3] === 0 &&
			d.drag?.gridDraws === 0 && d.drag.staticDraws === 0 && d.drag.snapGuides === 0 && d.drag.at !== null &&
			near(d.drag.at.x, d.x0 + 40, 1e-6) && near(d.drag.at.y, d.y0 + 40, 1e-6) &&
			d.wheel?.css !== null && d.wheel.gridDraws >= 1 && d.wheel.transform === '' && d.wheel.cssAfter === null &&
			d.off?.count === 0 && d.off.canvases === 2 && d.off.grid === false
		return [ok, d]
	})

	// ---------------------------------------------------------------- job 034: overscan of the stage (M2, SPEC-M1 §6.3)
	await step('check', 'Überstand: stats().overscan 384 per side, stage and both layer bitmaps 2688 × 1848, .konvajs-content at left/top −384px without a resting transform (its rect = the container + 384 per side), the host clips (overflow clip) and nothing scrolls; a second renderer sets clip at mount and restores the inline overflow at destroy', async () => {
		const d = await lab(() => window.__lab.overscanCheck())
		const ov = d.overscan
		const ok = !!ov && ov.l === 384 && ov.r === 384 && ov.t === 384 && ov.b === 384 && ov.stageW === 2688 && ov.stageH === 1848 &&
			d.layers.length === 2 && d.layers.every((l) => l.w === 2688 && l.h === 1848) &&
			d.style.left === '-384px' && d.style.top === '-384px' && d.style.transform === '' &&
			Object.values(d.rect).every((v) => near(v, 384, 0.5)) &&
			d.overflow.x === 'clip' && d.overflow.y === 'clip' && d.scroll.every((v) => v === 0) &&
			d.second?.mounted === 'clip' && d.second.computed === 'clip' && d.second.destroyed === 'auto'
		return [ok, d]
	})

	await step('check', 'Überstand bei Größenänderung: 1920 × 1000 keeps the stage (t = b = 424, no reallocation), 1080 × 1920 reallocates 1848 × 2688, 1920 × 1080 again 2688 × 1848; covered and drawn after each; a touch pan cut by the change to 1920 × 1000 draws once, in the frame the scene takes the new size, stays covered, one end draw, the camera follows the whole pan', async () => {
		const d = await lab(() => window.__lab.overscanResizeCheck())
		const side = (o, l, r, t, b, w, h) => !!o && o.l === l && o.r === r && o.t === t && o.b === b && o.stageW === w && o.stageH === h
		const after = (x) => x.covered && x.staticDraws >= 1
		const g = d.gesture
		const ok = after(d.short) && d.short.reallocated === 0 && side(d.short.overscan, 384, 384, 424, 424, 2688, 1848) &&
			d.short.layer.w === 2688 && d.short.layer.h === 1848 &&
			after(d.portrait) && d.portrait.reallocated === 1 && side(d.portrait.overscan, 384, 384, 384, 384, 1848, 2688) &&
			d.portrait.layer.w === 1848 && d.portrait.layer.h === 2688 &&
			after(d.back) && d.back.reallocated === 1 && side(d.back.overscan, 384, 384, 384, 384, 2688, 1848) &&
			g.frames === 24 && g.takeover > 0 && g.tBefore === 384 && g.tAfter === 424 && g.drawsDuring === 1 &&
			JSON.stringify(g.drawFrames) === JSON.stringify([g.takeover]) && g.covered && g.endDraws === 1 &&
			near(g.dx, 288, 2) && near(g.dy, 0, 2) &&
			after(d.restored) && d.restored.reallocated === 0 && side(d.restored.overscan, 384, 384, 384, 384, 2688, 1848)
		return [ok, d]
	})

	await step('gate', 'G20 Rand ohne Lücke: CSS-path pans of 30 × 12 px (one finger and real wheel steps, straight and diagonal) keep the container covered by the stage in every frame and show item pixels at 16 points of the newly exposed strip (0 misses), 0 draws during, one end draw; a 600-px pan and a pinch-out to k 0.6 redraw exactly in the frames gestureRedrawFrames predicts (frame 33; one)', async () => {
		const setup = await lab(() => window.__lab.edgeSetup())
		const runs = {}
		try {
			runs.touchStraight = await lab(() => window.__lab.edgeTouch('straight'))
			runs.touchDiagonal = await lab(() => window.__lab.edgeTouch('diagonal'))
			for (const [name, dx, dy] of [['wheelStraight', 12, 0], ['wheelDiagonal', 12, 12]]) {
				const at = await lab(() => window.__lab.edgeWheelBegin())
				await page.mouse.move(at.x, at.y)
				for (let i = 0; i < 30; i++) {
					await page.mouse.wheel(dx, dy)
					await lab(() => window.__lab.edgeWheelStep())
				}
				await sleep(300)
				runs[name] = await lab(() => window.__lab.edgeWheelEnd())
			}
			runs.touchLong = await lab(() => window.__lab.edgeTouch('long'))
			runs.pinchOut = await lab(() => window.__lab.edgeTouch('pinch'))
		} finally {
			await lab(() => window.__lab.edgeTeardown())
		}
		const clean = (r) => r.misses === 0 && r.uncovered === 0 && r.probesMin >= 16
		const short = ['touchStraight', 'touchDiagonal', 'wheelStraight', 'wheelDiagonal'].every((n) => {
			const r = runs[n]
			return clean(r) && r.frames === 30 && r.during.static === 0 && r.during.overlay === 0 && r.end.static === 1 &&
				r.cssAfter === null && r.transformAfter === '' && (r.maxStepGapMs === null || r.maxStepGapMs < 120)
		})
		const L = runs.touchLong
		const P = runs.pinchOut
		const long = clean(L) && L.frames === 50 && JSON.stringify(L.drawFrames) === JSON.stringify(L.predicted) && JSON.stringify(L.predicted) === '[32]'
		const pinch = clean(P) && P.frames === 30 && JSON.stringify(P.drawFrames) === JSON.stringify(P.predicted) && P.predicted.length === 1 && near(P.k, 0.6, 0.001)
		const report = Object.fromEntries(Object.entries(runs).map(([n, r]) => [n, {
			frames: r.frames, misses: r.misses, probesMin: r.probesMin, uncovered: r.uncovered, worstGap: r.worstGap,
			drawsDuring: r.during, endDraws: r.end, drawFrames: r.drawFrames, predicted: r.predicted, k: r.k, pan: r.pan,
			maxStepGapMs: r.maxStepGapMs, missSample: r.missSample,
		}]))
		return [short && long && pinch, { gates: { short, long, pinch }, setup, overscan: L.overscan, runs: report }]
	})

	await step('gate', 'Kamera: no stage.scale / stage.position calls (prototype spy, whole run)', async () => {
		const s = await lab(() => ({ ...window.__lab.spies }))
		return [s.stageScale === 0 && s.stagePosition === 0, s]
	})

	await step('check', 'no page errors during the whole run', async () => {
		const inPage = await lab(() => window.__lab.errors.slice())
		return [pageErrors.length === 0 && inPage.length === 0, { pageErrors: pageErrors.slice(0, 5), inPage: inPage.slice(0, 5) }]
	})
}

// ---------------------------------------------------------------- memory (§9.4 "Seitenspeicher mit zwei Canvas")
const MEMORY_IDLE_MS = 10000
const readText = (p) => {
	try {
		return readFileSync(p, 'utf8')
	} catch {
		return null
	}
}

/**
 * Every process of this container's browser (run.sh: one browser, --network
 * none) with PSS/RSS from /proc, the DRM fdinfo of its /dev/dri descriptors
 * (VRAM/GTT of the GPU process in the GPU run; engine busy times for the GPU
 * evidence) and the Mesa drivers it mapped.
 *
 * @param {(cmdline: string) => string|null} kindOf chromiumKind (memory.js) or webkitKind (gpu.js)
 * @return {Array<{pid: number, kind: string, pss: number|null, rss: number|null, drm: Array, engines: Array, drmFds: number, drivers: string[]}>}
 */
function browserProcesses(kindOf) {
	let pids = []
	try {
		pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n))
	} catch {
		return []
	}
	const out = []
	for (const pid of pids) {
		const kind = kindOf(readText(`/proc/${pid}/cmdline`))
		if (!kind) continue
		const rollup = readText(`/proc/${pid}/smaps_rollup`)
		const sm = rollup ? parseSmapsRollup(rollup) : { rss: null, pss: null }
		const st = parseProcStatus(readText(`/proc/${pid}/status`) ?? '')
		let fds = []
		try {
			fds = readdirSync(`/proc/${pid}/fd`)
		} catch {}
		const drm = []
		const engines = []
		let drmFds = 0
		for (const fd of fds) {
			let target = ''
			try {
				target = readlinkSync(`/proc/${pid}/fd/${fd}`)
			} catch {
				continue
			}
			if (!target.startsWith('/dev/dri/')) continue
			const info = readText(`/proc/${pid}/fdinfo/${fd}`) ?? ''
			drmFds++
			drm.push(parseDrmFdinfo(info))
			engines.push(parseDrmEngines(info))
		}
		out.push({
			pid: Number(pid), kind, pss: sm.pss, rss: sm.rss ?? st.rss, drm: drm.filter(Boolean),
			engines: engines.filter(Boolean), drmFds, drivers: mesaDrivers(readText(`/proc/${pid}/maps`)),
		})
	}
	return out
}

/** @return {ReturnType<typeof browserProcesses>} the Chromium processes */
const chromiumProcesses = () => browserProcesses(chromiumKind)
/** @return {ReturnType<typeof browserProcesses>} the processes of the browser under test */
const ownProcesses = () => browserProcesses(IS_CHROMIUM ? chromiumKind : webkitKind)

/**
 * GL renderer and 2D-canvas status of the browser (is the canvas on the GPU?).
 *
 * @return {Promise<object|null>}
 */
async function gpuInfo() {
	// CDP SystemInfo exists only in Chromium; WebKit's evidence is gpuEvidence()
	if (!IS_CHROMIUM) return null
	try {
		const s = await browser.newBrowserCDPSession()
		const { gpu } = await s.send('SystemInfo.getInfo')
		await s.detach()
		const aux = gpu?.auxAttributes ?? {}
		return {
			glRenderer: aux.glRenderer ?? aux.gl_renderer ?? null,
			device: gpu?.devices?.[0]?.deviceString || null,
			canvas2d: gpu?.featureStatus?.['2d_canvas'] ?? null,
			gpuCompositing: gpu?.featureStatus?.gpu_compositing ?? null,
		}
	} catch (e) {
		return { error: String(e?.message ?? e) }
	}
}

/**
 * One memory snapshot after a forced GC (Chromium). WebKit has no CDP: no
 * forced GC, no heap or UA-specific memory, only the canvas probe and /proc.
 *
 * @param {object|null} cdp page CDP session (null in WebKit)
 * @return {Promise<object>} memory.js memorySnapshot() or plainSnapshot()
 */
async function memoryNow(cdp) {
	if (!cdp) return plainSnapshot({ browser: BROWSER, canvases: await lab(() => window.__lab.canvasMemory()), processes: ownProcesses() })
	await cdp.send('HeapProfiler.collectGarbage')
	await cdp.send('Performance.enable')
	const { metrics } = await cdp.send('Performance.getMetrics')
	await cdp.send('Performance.disable')
	const ua = await lab(async () => {
		if (!self.crossOriginIsolated || typeof performance.measureUserAgentSpecificMemory !== 'function') {
			return { error: `unavailable (crossOriginIsolated ${self.crossOriginIsolated})` }
		}
		try {
			const timeout = new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout after 30 s')), 30000))
			const r = await Promise.race([performance.measureUserAgentSpecificMemory(), timeout])
			return { result: { bytes: r.bytes, breakdown: r.breakdown.map((b) => ({ bytes: b.bytes, types: b.types })) } }
		} catch (e) {
			return { error: String(e?.message ?? e) }
		}
	})
	const canvases = await lab(() => window.__lab.canvasMemory())
	return memorySnapshot({ metrics, ua: ua.result ?? null, uaError: ua.error ?? null, canvases, processes: chromiumProcesses() })
}

// ---------------------------------------------------------------- GPU evidence (gpu.js)
/**
 * WebGL renderer of the page (WEBGL_debug_renderer_info, else the masked
 * RENDERER). Read after the scenarios, so the probe's context cannot change
 * them, and released at once.
 *
 * @return {Promise<{vendor: string, renderer: string, unmasked: boolean, version: string}|null>}
 */
function webglInfo() {
	return lab(() => {
		const gl = document.createElement('canvas').getContext('webgl')
		if (!gl) return null
		const ext = gl.getExtension('WEBGL_debug_renderer_info')
		const info = {
			vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
			renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
			unmasked: !!ext,
			version: gl.getParameter(gl.VERSION),
		}
		gl.getExtension('WEBGL_lose_context')?.loseContext()
		return info
	})
}

/**
 * GPU evidence of one run: the browser's processes after the scenarios with
 * their Mesa drivers and the gfx busy time their DRM clients spent during the
 * scenarios, the WebGL renderer, the launch, and gpu.js's verdict.
 *
 * @param {ReturnType<typeof browserProcesses>} before processes right before __lab.measure()
 * @param {ReturnType<typeof browserProcesses>} after processes right after it
 * @param {object|null} webgl webglInfo()
 * @param {ReturnType<typeof browserProcesses>} probed processes after the WebGL probe (did WebGL alone reach the GPU?)
 * @return {object} measure.json gpuEvidence
 */
function gpuEvidence(before, after, webgl, probed) {
	const engines0 = new Map(before.map((p) => [p.pid, p.engines]))
	const processes = after.map((p) => ({
		pid: p.pid, kind: p.kind, drivers: p.drivers, drmFds: p.drmFds,
		gfxNs: p.drmFds ? engineDelta(engines0.get(p.pid) ?? [], p.engines).engines.gfx ?? 0 : null,
	}))
	const launch = {
		browser: BROWSER, version: browser.version(), devDri: GPU, chromiumArgs: IS_CHROMIUM ? ARGS : null,
		webkitSkia: IS_CHROMIUM ? null : WEBKIT_SKIA, env: BROWSER_ENV,
		note: IS_CHROMIUM ? `Chromium-Flags ${ARGS.join(' ')}`
			: WEBKIT_SKIA === 'cpu' ? 'Playwright-Starter (pw_run.sh) mit WEBKIT_SKIA_ENABLE_CPU_RENDERING=1'
				: 'WPE-MiniBrowser direkt, ohne WEBKIT_SKIA_ENABLE_CPU_RENDERING',
	}
	if (Object.keys(BROWSER_ENV).length) {
		// proof that the variables reached the browser: the environment of every process of it
		const seen = after.map((p) => (readText(`/proc/${p.pid}/environ`) ?? '').split('\0'))
		launch.envSeen = Object.fromEntries(Object.entries(BROWSER_ENV).map(([k, v]) => [k, seen.filter((e) => e.includes(`${k}=${v}`)).length]))
		launch.note += `; Umgebung ${Object.entries(BROWSER_ENV).map(([k, v]) => `${k}=${v} (in ${launch.envSeen[k]}/${after.length} Prozessen)`).join(' ')}`
	}
	const probe = webgl && { ...webgl, drivers: [...new Set(probed.flatMap((p) => p.drivers))].sort(), drmFds: probed.reduce((a, p) => a + p.drmFds, 0) }
	const ev = { webgl: probe, processes, scenarioEngines: engineDelta(before.flatMap((p) => p.engines), after.flatMap((p) => p.engines)), launch }
	return { ...ev, verdict: gpuVerdict(ev) }
}

// ---------------------------------------------------------------- measure
async function measure() {
	const bounds = collectBounds()
	if (!bounds.ok) log('G17 (info in measure mode): container bounds not met', JSON.stringify(bounds.checks))
	const cdp = IS_CHROMIUM ? await context.newCDPSession(page) : null
	const memory = { browser: BROWSER, gpu: GPU, gpuInfo: await gpuInfo(), idleMs: MEMORY_IDLE_MS, settled: await memoryNow(cdp) }
	const procsBefore = ownProcesses()
	const d = await lab(() => window.__lab.measure())
	const procsAfter = ownProcesses()
	memory.after = await memoryNow(cdp)
	// quiet scene (no frames): what Chromium gives back is cache, the rest stays
	await sleep(MEMORY_IDLE_MS)
	memory.idle = await memoryNow(cdp)
	// G14 (SPEC-M1 §8.5, stage 2): first render of the whole board at 0.05 from a cold scene
	// (model reloaded, scene reset), and the same under a 4× CPU throttle (Chromium only, CDP)
	const lod2First = { plain: await lab(() => window.__lab.firstRenderAt(0.05)), throttled: null }
	if (cdp) {
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
		try {
			lod2First.throttled = await lab(() => window.__lab.firstRenderAt(0.05))
		} finally {
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
		}
	}
	await cdp?.detach()
	const webgl = await webglInfo()
	const gpuEv = gpuEvidence(procsBefore, procsAfter, webgl, ownProcesses())
	log(`GPU evidence: ${gpuEv.verdict.verdict} – ${gpuEv.verdict.reasons.join('; ')}`)
	const meta = await lab(() => ({ meta: window.__lab.meta, timings: window.__lab.timings }))
	writeReport('json', JSON.stringify({ browser: browser.version(), engine: BROWSER, viewport: VIEWPORT, dpr: DPR, gpu: GPU, set: SET, shadows: SHADOWS, label: LABEL, files: FILES, gpuEvidence: gpuEv, bounds, ...d, lod2First, ...meta, memory }, null, 1) + '\n')
	// frame columns as in SPEC-M1 §8.8 point 5 (spike thresholds, metrics.js frameStats); the camera
	// step only where the scenario moves the camera
	const row = (name, r, cam = true) => {
		const f = r.frames
		const c = cam ? [r.camera.p50, r.camera.p95, r.camera.p99] : ['–', '–', '–']
		return `| ${name} | ${f.fps} | ${f.p50} | ${f.p95} | ${f.p99} | ${f.pctOver16} | ${f.pctOver33} | ${f.pctMissed} | ${c.join(' | ')} |`
	}
	const pct = (v) => `${Math.round(v * 10000) / 100} %`
	const bp = d.boardPan
	// Konva drawScene per layer on the main thread (lab.js drawLog ms), the other half of a frame
	const drawRow = (name, r) => {
		const cells = ['static', 'overlay'].flatMap((l) => {
			const s = r.draw?.[l]
			return s && s.n ? [s.n, s.p50, s.p95, s.max] : [0, '–', '–', '–']
		})
		return `| ${name} | ${cells.join(' | ')} |`
	}
	const lz = d.lod2Zoom
	// stage 4 (SPEC-M1 §9.5 WP-S4): CSS-path pan, follow, badges
	const fShort = d.followShort
	const fLong = d.followLong
	const badgeLabel = (r, totals) => `${totals ? 'Abzeichen mit Summen' : 'Abzeichen'} schwenken (Modus vote, ${pct(r.scale)}, ` +
		`${r.counts?.badges ?? '–'} eigene, ${r.counts?.rings ?? '–'} Ringe${totals ? `, ${r.counts?.totals ?? '–'} Summen` : ''})`
	const stage4 = [
		...(d.touchPan ? [['Ein-Finger-Schwenk 100 % (CSS-Pfad, Modus view)', d.touchPan, false]] : []),
		...(d.touchPan1500 ? [['Ein-Finger-Schwenk 1500 px (CSS-Pfad, Modus view)', d.touchPan1500, false]] : []),
		...(d.pinchOut ? [['Pinch-out auf k 0,6 (CSS-Pfad)', d.pinchOut, false]] : []),
		...(fShort ? [[`Folgen kurz (${fShort.glide.ms} ms, CSS-Pfad)`, fShort, false]] : []),
		...(fLong ? [[`Folgen lang (${fLong.glide.dx} px, ${fLong.glide.ms} ms)`, fLong, false]] : []),
		...(d.badgePan ? [[badgeLabel(d.badgePan, false), d.badgePan, true]] : []),
		...(d.badgeTotalsPan ? [[badgeLabel(d.badgeTotalsPan, true), d.badgeTotalsPan, true]] : []),
	]
	const scenarios = [['Schwenken', d.pan], ['Zoomen', d.zoom], ['Notiz ziehen', d.drag],
		...(d.connectorDrag ? [['Notiz mit 6 Verbindern ziehen (G12)', d.connectorDrag]] : []),
		['Ganzes Board zoomen', d.board], ...(bp ? [['Ganzes Board schwenken', bp]] : []),
		...(lz ? [['Board-Zoom um 8 % (G14)', lz]] : []),
		...stage4.map(([name, r]) => [name, r])]
	// the board pan at 5 % is LOD 2 since stage 2: the connectors are in view, but not drawn
	const bpLabel = bp && bp.lods.includes(2)
		? `Ganzes Board schwenken bei ${pct(bp.view.scale)} (LOD 2, ${bp.view.connectorsInView.start} Verbinder im Bild, nicht gezeichnet)`
		: bp && `Ganzes Board schwenken bei ${pct(bp.view.scale)} (Kamera-Schritt mit ${bp.view.connectorsAttached.start} Verbindern)`
	const ms = (r) => (r && r.ms !== null ? `${r.ms} ms` : '–')
	// the overscan of the stage (job 034); null with a renderer without one
	const ovText = (o) => (o ? `${o.stageW} × ${o.stageH} CSS-px, Überstand l/r/t/b ${o.l}/${o.r}/${o.t}/${o.b}` : 'ohne Überstand')
	const rendering = IS_CHROMIUM ? (GPU ? 'GPU (ANGLE)' : 'Software-Rendering (ohne GPU)')
		: `${GPU ? 'mit /dev/dri' : 'ohne /dev/dri'}, Skia-Start „${WEBKIT_SKIA}“, GPU-Nachweis: ${gpuEv.verdict.verdict}`
	const md = [
		'# Szenen-Labor – Messbericht',
		'',
		`${BROWSER_LABEL}, ${VIEWPORT.width}×${VIEWPORT.height}, DPR ${DPR}, ${rendering}; ` +
			`Szene ${meta.meta.counts.sticky} Notizen + ${meta.meta.counts.shape ?? 0} Formen + ${meta.meta.counts.text ?? 0} Text-Objekte + ` +
			`${meta.meta.counts.connector ?? 0} Verbinder + ${meta.meta.counts.frame} Frames + ${meta.meta.counts.unknown} Platzhalter` +
			(SET === 'm1' ? '.' : ` (Satz ${SET}: dasselbe Board ohne seine Verbinder, A/B zum M1-Satz).`) +
			(SHADOWS === 'on' ? '' : ' **Notiz-Schatten aus** (`--shadows off`, A/B der Schattenkosten).'),
		...(IS_CHROMIUM ? [] : ['', 'WebKit im Container (WPE, headless) ist eine Annäherung an Safari, **keine** iPad-Werte (SPEC-M1 §16).']),
		'',
		`- Laden des Modells: ${Math.round(d.loadMs * 10) / 10} ms`,
		`- erstes Rendern (mount bis erster Draw der statischen Ebene): ${d.firstRenderMs === null ? '–' : Math.round(d.firstRenderMs * 10) / 10 + ' ms'}`,
		`- rAF-Intervall im Leerlauf: ${d.refreshMs} ms`,
		`- erstes Rendern des ganzen Boards (fit bei ${Math.round(d.fit.scale * 1000) / 10} %, LOD ${d.fit.lod}, ${d.fit.attached} Knoten angehängt): ${d.fit.ms === null ? '–' : d.fit.ms + ' ms'}`,
		'',
		'| Szenario | fps | Frame p50 ms | Frame p95 ms | Frame p99 ms | > 16,7 ms % | > 33,4 ms % | verpasst % | Kamera-Schritt p50 ms | p95 ms | p99 ms |',
		'|---|---|---|---|---|---|---|---|---|---|---|',
		row('Schwenken', d.pan),
		row('Zoomen', d.zoom),
		row('Notiz ziehen', d.drag, false),
		...(d.connectorDrag ? [row('Notiz mit 6 Verbindern ziehen (G12)', d.connectorDrag, false)] : []),
		row('Ganzes Board zoomen (fit … 2 × fit)', d.board),
		...(bp ? [row(bpLabel, bp)] : []),
		...(lz ? [row(`Board-Zoom um 8 % (${pct(lz.scales.from)} … ${pct(lz.scales.to)}, LOD ${lz.lods.join('/')}, G14)`, lz)] : []),
		...stage4.map(([name, r, cam]) => row(name, r, cam)),
		'',
		`- verpasst: Frame > 1,5 × rAF-Intervall im Leerlauf; > 16,7 ms und > 33,4 ms sind feste Schwellen wie in der Spike-Bench (SPEC-M1 §8.8 Punkt 5).`,
		`- Ganzes Board zoomen: Skala ${pct(d.board.scales.from)} … ${pct(d.board.scales.to)} und zurück, LOD ${d.board.lods.join('/')}, angehängt ${d.board.attached.min}–${d.board.attached.max} Knoten.`,
		...(bp ? [`- Ganzes Board schwenken: Skala ${pct(bp.view.scale)} fest, Acht mit ±${bp.view.panPx} px, LOD ${bp.lods.join('/')}, angehängt ${bp.attached.min}–${bp.attached.max} von ${bp.view.items} Objekten, ` +
			`statische Knoten ${bp.staticChildren.min}–${bp.staticChildren.max}, ` +
			`Verbinder angehängt ${bp.view.connectorsAttached.start} (Start) / ${bp.view.connectorsAttached.end} (Ende), im Bild ${bp.view.connectorsInView.start} von ${bp.view.connectors}.`] : []),
		...(lz ? [`- G14 (LOD 2): Board-Zoom um 8 % mit statischen Knoten ${lz.staticChildren.min}–${lz.staticChildren.max}; ` +
			`erstes Rendern des ganzen Boards bei 5 % aus kalter Szene ${ms(lod2First.plain)} (LOD ${lod2First.plain.lod}, ${lod2First.plain.painted} Objekte gemalt), ` +
			`unter 4×-CPU-Drossel ${lod2First.throttled ? ms(lod2First.throttled) : '– (nur Chromium)'}. Gate-Werte stehen in out/gates.json (run.sh ohne measure).`] : []),
		...(d.touchPan ? [`- Stufe 4 (WebKit-Fixes, SPEC-M1 §9.5 WP-S4): Ein-Finger-Schwenk im Modus view wie auf einem Tablet, 90 Bilder auf dem CSS-Pfad, ` +
			`Zeichnungen währenddessen ${d.touchPan.drawsDuring} (Soll 0); Zeichnen am Ende statisch ${d.touchPan.draw.static.max ?? '–'} ms, Overlay ${d.touchPan.draw.overlay.max ?? '–'} ms.`] : []),
		...(d.touchPan1500 && d.pinchOut ? [`- Überstand (Job 034): Bühne ${ovText(d.stats?.overscan)}; Ein-Finger-Schwenk 1500 px (125 × 12 px, Modus view): ` +
			`Zwischen-Draws statisch ${d.touchPan1500.drawsDuring.static}, Overlay ${d.touchPan1500.drawsDuring.overlay}; ` +
			`Pinch-out auf k ${Math.round((d.pinchOut.scale ?? 0) * 100) / 100} in 30 Bildern: statisch ${d.pinchOut.drawsDuring.static}, Overlay ${d.pinchOut.drawsDuring.overlay}.`] : []),
		...(fShort && fLong ? [`- Folgen (followTo ab 100 %): kurz ${fShort.glide.dx}/${fShort.glide.dy} px auf ${pct(fShort.glide.scale)} in ${fShort.glide.ms} ms → ${fShort.result} nach ${fShort.ms} ms, ` +
			`${fShort.draw.static.n} statische Zeichnung(en); lang ${fLong.glide.dx} px in ${fLong.glide.ms} ms → ${fLong.result} nach ${fLong.ms} ms, ${fLong.draw.static.n} statische Zeichnungen (Gestenregel: Zwischen-Draws).`] : []),
		...(d.badgePan ? [`- Abzeichen: das G16-Board (600 Notizen in einem Frame), Modus vote, ein Kamera-Schritt je Bild, das Overlay mit allen Abzeichen in jedem Bild neu gezeichnet; ` +
			`ohne Summen ${JSON.stringify(d.badgePan.counts)}, mit Summen ${JSON.stringify(d.badgeTotalsPan?.counts ?? null)}.`] : []),
		'',
		'Zeichnen je Ebene (Konva `drawScene` im Hauptthread, ohne die Rasterung der GPU):',
		'',
		'| Szenario | statisch: Zeichnungen | p50 ms | p95 ms | max ms | Overlay: Zeichnungen | p50 ms | p95 ms | max ms |',
		'|---|---|---|---|---|---|---|---|---|',
		...scenarios.map(([name, r]) => drawRow(name, r)),
		'',
		'Vergleich Spike (Konva, Chromium): Kamera-Schritt 1,9 / 4,1 ms (p50/p95). Messwerte sind Bericht, kein Gate.',
		'Entscheidungsregel SPEC-M1 §8.8 (gilt für das Gerät: R-A Android/Chrome, R-B iPad): ganzes Board < 30 fps oder > 25 % verpasst oder erstes Rendern > 1 s → LOD 2 vorziehen.',
		'',
		...gpuReportLines(gpuEv),
		...memoryReportLines(memory),
	].join('\n')
	writeReport('md', md)
	console.log(md)
}

let exitCode = 0
try {
	if (MODE === 'measure') {
		await measure()
	} else {
		await gates()
		const failed = results.filter((r) => !r.ok)
		const gatesOnly = results.filter((r) => r.kind === 'gate')
		writeReport('json', JSON.stringify({ browser: browser.version(), gpu: GPU, label: LABEL, files: FILES, results }, null, 1) + '\n')
		const md = ['# Szenen-Labor – Gates', '', `Chromium ${browser.version()}, ${VIEWPORT.width}×${VIEWPORT.height}, ${GPU ? 'GPU' : 'CPU'}${LABEL ? `, Lauf ${LABEL}` : ''} (${FILES.md})`, '',
			'| Art | Prüfung | Ergebnis |', '|---|---|---|',
			...results.map((r) => `| ${r.kind} | ${r.name} | ${r.ok ? 'ok' : '**fehlgeschlagen**'} |`), ''].join('\n')
		writeReport('md', md)
		console.log(`\nGates: ${gatesOnly.filter((r) => r.ok).length} ok / ${gatesOnly.filter((r) => !r.ok).length} fehlgeschlagen`)
		console.log(`Gesamt: ${results.length - failed.length} ok / ${failed.length} fehlgeschlagen`)
		exitCode = failed.length ? 1 : 0
	}
} catch (e) {
	console.error(e)
	exitCode = 1
} finally {
	await browser.close().catch(() => {})
	server.close()
}
process.exit(exitCode)
