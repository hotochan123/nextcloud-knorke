#!/usr/bin/env node
/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Check of the tablet package R-A (SPEC-M1 §8.8, §16, §17) before the
 * session. Runs INSIDE the lab container (dev/scene-lab/run.sh ipad:
 * non-root, --network none, package at /out/ipad-ra): serves the package
 * with serve.mjs on 127.0.0.1 and drives each engine with the device profile
 * of its measurement – Chromium as the Android tablet of R-A
 * (devices['Galaxy Tab S4 landscape']), WebKit as the iPad of R-B
 * (devices['iPad Pro 11 landscape'], Safari's engine) – through what the
 * user will do:
 *
 *   start page links → the bench shows the options the sheet names (engine
 *   "Konva 10.7.1", "Alle Szenarien", "100 % (voll)", repetitions, the
 *   scenario labels; SHEET_BENCH below) → "Alle Szenarien" (Konva, 10 %)
 *   measures every scenario in one run → lab with ?panel=1 settles →
 *   "Automatik-Messung" fills all rows → "Hand: 5 s Schwenk" with a
 *   synthetic one-finger pan → "JSON kopieren" → valid JSON → the session
 *   server (session.mjs, as on the Tower) shows its start page and its send
 *   page stores that JSON under a label (its CSP, Host and Origin checks let
 *   the real page through) and offers the next label, also after a reload
 *   → the send page refuses text above 4 MiB and a JSON without a
 *   measurement without sending anything → no page errors
 *
 * Numbers from here are software rendering in a container, NOT tablet
 * values; the report shows them only to prove the panel works. Exit 1 on failure.
 * Report (names.js, R18-C2): $KNORKE_LAB_OUT/ipad-check[-<label>].{json,md}
 * with --label <x> (run.sh KNORKE_LAB_LABEL, ^[a-z0-9-]{1,24}$, exit 2 for an
 * invalid one); ipad-check.{json,md} stays as the copy of the last run. The
 * files of this run are removed before the servers start.
 *
 *   node ipad/check.mjs [--pkg /out/ipad-ra] [--browsers chromium,webkit] [--label <x>]
 */
import { chromium, devices, webkit } from 'playwright'
import { mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LABEL_RE, reportFiles } from '../names.js'
import { serve } from './serve.mjs'
import { MAX_BODY, createSessionServer } from './session.mjs'

const argv = process.argv.slice(2)
const opt = (name, def) => {
	const i = argv.indexOf('--' + name)
	return i < 0 || argv[i + 1] === undefined ? def : argv[i + 1]
}
const PKG = opt('pkg', '/out/ipad-ra')
const OUT = process.env.KNORKE_LAB_OUT || '/out'
const BROWSERS = String(opt('browsers', 'chromium,webkit')).split(',').filter(Boolean)
// --label <x> (run.sh KNORKE_LAB_LABEL): appended to the report names
const LABEL = opt('label', null)
if (LABEL !== null && (typeof LABEL !== 'string' || !LABEL_RE.test(LABEL))) {
	console.error(`ipad/check.mjs: invalid --label ${LABEL}`)
	process.exit(2)
}
// this run's report names; older files under them go now, so a broken run leaves none behind
const FILES = reportFiles({ mode: 'ipad', label: LABEL })
for (const name of new Set([FILES.json, FILES.md, FILES.copies.json, FILES.copies.md])) {
	try {
		unlinkSync(join(OUT, name))
	} catch (e) {
		if (e?.code !== 'ENOENT') throw e
	}
}

/**
 * Writes a report of this run under its own name and as the copy of the last
 * run (without a label both are ipad-check.*, written once).
 *
 * @param {'json'|'md'} kind which report
 * @param {string} content file content
 */
function writeReport(kind, content) {
	for (const name of new Set([FILES[kind], FILES.copies[kind]])) writeFileSync(join(OUT, name), content)
	log(`report written: out/${FILES[kind]} (copy out/${FILES.copies[kind]})`)
}
const ENGINES = { chromium, webkit }
/** Device profile per engine: the Android tablet of R-A, the iPad of R-B. */
const PROFILES = { chromium: 'Galaxy Tab S4 landscape', webkit: 'iPad Pro 11 landscape' }
const DEVICES = { chromium: devices['Galaxy Tab S4 landscape'], webkit: devices['iPad Pro 11 landscape'] }
/*
 * What ANLEITUNG-R-A.md and the start page tell the user to pick in the bench,
 * as [option value, visible text]; some texts exist only at runtime (the
 * engine option is `Konva ${version}`, the repetitions come from a list), so
 * they are compared with the live page here. test/pages.test.mjs checks that
 * every such quote of the sheet is listed here.
 */
const SHEET_BENCH = {
	engine: ['konva', 'Konva 10.7.1'],
	scenario: ['all', 'Alle Szenarien'],
	scale: ['1', '100 % (voll)'],
	reps: ['1', '1'],
}
const SHEET_SCENARIOS = ['1 Laden → erste Vollzeichnung', '2 Schwenken 5 s (100 %)', '3 Zoom 10 % → 400 % → 10 % (6 s)',
	'6 Fremd-Änderungen 50/s beim Schwenken']
/** Status after one pass "Alle Szenarien" with one engine and one repetition. */
const SHEET_DONE = '8 Messungen fertig.'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const consoleLog = console.log
console.log = (...a) => {
	// serve.mjs logs every request; keep the check's own output readable
	if (typeof a[0] === 'string' && /^\d\d:\d\d:\d\d \d{3} (GET|HEAD|POST) /.test(a[0])) return
	consoleLog(...a)
}
const server = serve(PKG, '127.0.0.1', 0)
await new Promise((resolve) => server.once('listening', resolve))
const BASE = `http://127.0.0.1:${server.address().port}/`
// the session server as on the Tower; its results go to a fresh temp dir
const SESSION_RESULTS = mkdtempSync(join(tmpdir(), 'knorke-ra-results-'))
const session = createSessionServer({ site: PKG, results: SESSION_RESULTS })
await new Promise((resolve) => session.listen(0, '127.0.0.1', resolve))
const SESSION = `http://127.0.0.1:${session.address().port}/`

const results = []

/**
 * @param {string} name browser name
 * @return {Promise<object>} result of this browser
 */
async function checkBrowser(name) {
	const res = { browser: name, profile: PROFILES[name], version: null, steps: [], numbers: {}, pageErrors: [] }
	const stepOk = (label, ok, detail = {}) => {
		res.steps.push({ label, ok: !!ok, detail })
		log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${label} ${JSON.stringify(detail)}`)
		if (!ok) throw new Error(`${label} failed`)
	}
	const browser = await ENGINES[name].launch({ headless: true })
	res.version = browser.version()
	const { defaultBrowserType, ...ctxOpts } = DEVICES[name]
	const context = await browser.newContext({ ...ctxOpts, locale: 'de-DE' })
	const page = await context.newPage()
	let posts = 0
	page.on('request', (r) => {
		if (r.method() === 'POST') posts++
	})
	page.on('pageerror', (e) => res.pageErrors.push(String(e?.message ?? e)))
	page.on('console', (m) => {
		if (m.type() === 'error') res.pageErrors.push('console: ' + m.text())
	})
	try {
		await page.goto(BASE, { waitUntil: 'load' })
		stepOk('start page links bench and lab', await page.locator('a[href="bench/bench-standalone.html"]').count() === 1 &&
			await page.locator('a[href="lab/?panel=1"]').count() === 1)

		await page.goto(BASE + 'bench/bench-standalone.html', { waitUntil: 'load' })
		const shown = await page.evaluate(() => {
			const opts = (id) => [...document.querySelectorAll(`#${id} option`)].map((o) => ({ value: o.value, text: o.textContent }))
			return { engine: opts('engine'), scenario: opts('scenario'), scale: opts('scale'), reps: opts('reps'), shadows: !!document.getElementById('shadows')?.checked }
		})
		const missing = Object.entries(SHEET_BENCH).filter(([id, [value, text]]) => !shown[id].some((o) => o.value === value && o.text === text))
			.map(([id, [, text]]) => `${id}: ${text}`)
		for (const s of SHEET_SCENARIOS) if (!shown.scenario.some((o) => o.text === s)) missing.push(`scenario: ${s}`)
		if (!shown.shadows) missing.push('shadows on')
		const scenarioIds = shown.scenario.map((o) => o.value).filter((v) => v !== 'all')
		const reps = shown.reps.map((o) => o.text)
		// The sheets name only the repetition option "1" (SHEET_BENCH.reps, checked through `missing`);
		// a further "3" is not required (SPEC-M1 §18, F4).
		stepOk('bench: the options the sheet names are on the page (engine, scenarios, scale, repetitions, shadows)', missing.length === 0 &&
			Number.parseInt(SHEET_DONE, 10) === scenarioIds.length, { missing, scenarios: scenarioIds, reps })

		// one pass as in the sheet, on a smaller scene: every scenario in one run
		await page.selectOption('#engine', SHEET_BENCH.engine[0])
		await page.selectOption('#scenario', SHEET_BENCH.scenario[0])
		await page.selectOption('#scale', '0.1')
		await page.selectOption('#reps', SHEET_BENCH.reps[0])
		await page.getByRole('button', { name: 'Messung starten' }).click()
		await page.getByText(SHEET_DONE).waitFor({ timeout: 600000 })
		const ran = await page.$$eval('#panel tbody tr', (rows) => rows.map((r) => ({ scenario: r.cells[1]?.textContent, error: r.classList.contains('err') })))
		stepOk(`bench: "Alle Szenarien" (Konva, 10 %) measures every scenario in one run, "${SHEET_DONE}"`, ran.length === scenarioIds.length &&
			scenarioIds.every((id) => ran.some((r) => r.scenario === id && !r.error)), { rows: ran.length, errors: ran.filter((r) => r.error).map((r) => r.scenario) })

		await page.goto(BASE + 'lab/?panel=1', { waitUntil: 'load' })
		await page.waitForFunction(() => window.__lab && window.__lab.settled, null, { timeout: 120000 })
		const panel = page.locator('[data-lab-panel]')
		await panel.locator('.lab-panel__info', { hasText: 'DPR' }).waitFor({ timeout: 30000 })
		res.numbers.device = await page.evaluate(() => JSON.parse(document.querySelector('[data-lab-panel] textarea').value).device)
		// the board of scene-gen.js (M1 set since stage 1: 4450 items)
		const total = await page.evaluate(() => window.__lab.meta.counts.total)
		stepOk('lab: panel mounted, device line read', total > 0 && res.numbers.device?.items === total, { device: res.numbers.device, total })

		await panel.getByRole('button', { name: 'Automatik-Messung' }).click()
		await panel.locator('.lab-panel__status', { hasText: 'Automatik-Messung fertig.' }).waitFor({ timeout: 600000 })
		const autoRows = await panel.locator('tbody tr').count()
		const auto = await page.evaluate(() => JSON.parse(document.querySelector('[data-lab-panel] textarea').value).auto)
		res.numbers.auto = {
			firstRenderMs: auto.firstRenderMs, fit: auto.fit,
			pan: auto.pan.frames.fps, zoom: auto.zoom.frames.fps, drag: auto.drag.frames.fps,
			board: auto.board.frames.fps, boardMissed: auto.board.frames.pctMissed,
			boardPan: auto.boardPan.frames.fps, boardPanMissed: auto.boardPan.frames.pctMissed,
		}
		stepOk('lab: automatic measurement fills seven rows incl. the whole board (zoom and pan)', autoRows === 7 &&
			Number.isFinite(auto.board.frames.fps) && Number.isFinite(auto.boardPan.frames.fps) && Number.isFinite(auto.fit.ms), { rows: autoRows, ...res.numbers.auto })

		// one-finger pan on an empty area while the 5 s window runs
		await page.evaluate(() => window.__lab.scene.setCamera({ x: -30000, y: -30000, scale: 1 }))
		await page.evaluate(() => window.__lab.idle())
		await panel.getByRole('button', { name: 'Hand: 5 s Schwenk' }).click()
		await panel.locator('.lab-panel__status', { hasText: /^Jetzt / }).waitFor({ timeout: 10000 })
		const pan = await page.evaluate(async () => {
			const lab = window.__lab
			const w = document.getElementById('board').clientWidth
			const h = document.getElementById('board').clientHeight
			let x = w * 0.7
			const t0 = performance.now()
			let css = 0
			lab.touch('pointerdown', 31, x, h / 2)
			while (performance.now() - t0 < 4000) {
				await new Promise((resolve) => requestAnimationFrame(resolve))
				x -= 3
				if (x < w * 0.2) x = w * 0.7
				lab.touch('pointermove', 31, x, h / 2)
				if (lab.stats().cssTransform) css++
			}
			lab.touch('pointerup', 31, x, h / 2)
			return { cssFrames: css }
		})
		await panel.locator('.lab-panel__status', { hasText: /^Fertig\./ }).waitFor({ timeout: 15000 })
		const hand = await page.evaluate(() => JSON.parse(document.querySelector('[data-lab-panel] textarea').value).hand)
		res.numbers.handPan = { fps: hand[0]?.data?.frames?.fps, pctMissed: hand[0]?.data?.frames?.pctMissed, draws: hand[0]?.data?.draws, ...pan }
		stepOk('lab: hand pan (synthetic touch) measured through the CSS path', hand.length === 1 && hand[0].kind === 'pan' &&
			Number.isFinite(hand[0].data.frames.fps) && pan.cssFrames > 0 && await panel.locator('tbody tr').count() === 8, res.numbers.handPan)

		await panel.getByRole('button', { name: 'JSON kopieren' }).click()
		const status = panel.locator('.lab-panel__status', { hasText: /JSON kopiert|von Hand kopieren/ })
		const copied = await status.waitFor({ timeout: 15000 }).then(() => status.textContent(), () => null)
		stepOk('lab: "JSON kopieren" answers', copied !== null, { status: copied })
		const panelJson = await page.evaluate(() => document.querySelector('[data-lab-panel] textarea').value)

		await page.goto(SESSION, { waitUntil: 'load' })
		stepOk('session: start page links bench, lab, send page and sheet', await page.locator('a[href="bench/bench-standalone.html"]').count() === 1 &&
			await page.locator('a[href="lab/?panel=1"]').count() === 1 && await page.locator('a[href="/send"]').count() === 1 &&
			await page.locator('a[href="ANLEITUNG-R-A.md"]').count() === 1)
		await page.goto(SESSION + 'send', { waitUntil: 'load' })
		const labels = await page.$$eval('#label option', (os) => os.map((o) => o.value))
		const label = `labor-lauf-${BROWSERS.indexOf(name) + 1}`
		const expectNext = labels[labels.indexOf(label) + 1]
		await page.selectOption('#label', label)
		await page.fill('#text', panelJson)
		await page.click('#send')
		const sendStatus = page.locator('#status', { hasText: /^Gespeichert: |Fehler|Fremde|Ungültig|Zu groß|Leer/ })
		const answer = await sendStatus.waitFor({ timeout: 15000 }).then(() => sendStatus.textContent(), () => null)
		const saved = readdirSync(SESSION_RESULTS).filter((f) => f.endsWith(`_${label}.json`))
		const same = saved.length === 1 && readFileSync(join(SESSION_RESULTS, saved[0]), 'utf8') === panelJson
		const next = await page.evaluate(() => document.getElementById('label').value)
		stepOk('session: send page stores the panel JSON under its label, then offers the next label', /^Gespeichert: /.test(answer ?? '') && same &&
			next === expectNext, { status: answer, files: saved, next })

		// the page is loaded anew for every send: next label and "Gesendet" survive that
		await page.reload({ waitUntil: 'load' })
		const kept = await page.evaluate(() => ({ next: document.getElementById('label').value, sent: document.getElementById('sent').textContent }))
		stepOk('session: after a reload the send page still offers the next label and lists what was sent', kept.next === expectNext &&
			kept.sent === `Gesendet: ${label}`, kept)

		// refused in the page before any request: above 4 MiB (session.mjs MAX_BODY), a JSON copied before measuring
		const filesBefore = readdirSync(SESSION_RESULTS).length
		const postsBefore = posts
		const refused = []
		for (const [what, text, expect] of [
			['above 4 MiB', null, 'Zu groß (höchstens 4 MiB) – nichts gesendet'],
			['lab panel JSON before measuring', JSON.stringify({ at: 'x', device: {}, auto: null, hand: [] }), 'Darin ist noch keine Messung'],
			['bench JSON before measuring', JSON.stringify({ env: {}, engines: {}, results: [] }), 'Darin ist noch keine Messung'],
		]) {
			await page.evaluate(([t, max]) => {
				document.getElementById('text').value = t ?? 'x'.repeat(max + 1)
				document.getElementById('status').textContent = ''
			}, [text, MAX_BODY])
			await page.click('#send')
			const s = page.locator('#status', { hasText: expect })
			refused.push({ what, ok: await s.waitFor({ timeout: 10000 }).then(() => true, () => false), status: await page.locator('#status').textContent() })
		}
		stepOk('session: send page refuses text above 4 MiB and a JSON without a measurement, sends nothing', refused.every((r) => r.ok) &&
			posts === postsBefore && readdirSync(SESSION_RESULTS).length === filesBefore &&
			await page.evaluate(() => document.getElementById('label').value) === expectNext, { refused, posts: posts - postsBefore })

		stepOk('no page errors', res.pageErrors.length === 0, { pageErrors: res.pageErrors.slice(0, 5) })
		res.ok = true
	} catch (e) {
		res.ok = false
		res.error = String(e?.message ?? e).split('\n')[0]
		if (!res.steps.some((s) => !s.ok)) log(`FAIL [${name}] ${res.error}`)
	} finally {
		await browser.close().catch(() => {})
	}
	return res
}

let exitCode = 0
try {
	for (const name of BROWSERS) {
		if (!ENGINES[name]) throw new Error(`unknown browser ${name}`)
		results.push(await checkBrowser(name))
	}
	exitCode = results.every((r) => r.ok) ? 0 : 1
} catch (e) {
	console.error(e)
	exitCode = 1
} finally {
	server.close()
	session.close()
}

const n = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : '–')
writeReport('json', JSON.stringify({ at: new Date().toISOString(), pkg: PKG, label: LABEL, files: FILES, results }, null, 1) + '\n')
writeReport('md', [
	'# Paket R-A (Tablet) – Prüfung im Labor-Container',
	'',
	'Software-Rendering im Container, Touch-Viewport des Geräteprofils (Chromium: Android-Tablet, WebKit: iPad). Die Zahlen belegen nur, dass Bench, Messfeld und Sitzungsseiten laufen; ' +
		'es sind **keine** Tablet-Werte.',
	'',
	'| Browser | Geräteprofil | Ergebnis | Schritte ok | Board fit ms | Ganzes Board fps | Board-Schwenk fps | Hand-Schwenk fps |',
	'|---|---|---|---|---|---|---|---|',
	...results.map((r) => `| ${r.browser} ${r.version ?? ''} | ${r.profile} | ${r.ok ? 'ok' : '**fehlgeschlagen**: ' + (r.error ?? '')} | ` +
		`${r.steps.filter((s) => s.ok).length}/${r.steps.length} | ${n(r.numbers.auto?.fit?.ms, 0)} | ${n(r.numbers.auto?.board)} | ${n(r.numbers.auto?.boardPan)} | ${n(r.numbers.handPan?.fps)} |`),
	'',
].join('\n'))
console.log = consoleLog
console.log(`\nPaket R-A: ${results.filter((r) => r.ok).length} ok / ${results.filter((r) => !r.ok).length} fehlgeschlagen (${results.map((r) => r.browser).join(', ')})`)
process.exit(exitCode)
