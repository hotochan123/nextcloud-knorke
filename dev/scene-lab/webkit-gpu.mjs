#!/usr/bin/env node
/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Series "WebKit with the GPU" (SPEC-M1 §16, before stage 1 phase 0) on the
 * host: runs dev/scene-lab/run.sh measure N times per variant, interleaved
 * (1, 2, 3, 1, 2, 3 …), keeps every measure.json, report.md and console log
 * under out/webkit-gpu/ and writes the summary out/webkit-gpu.{json,md}
 * (series.js: median and range, GPU verdicts, decision rule §8.8 point 6 as
 * a hint). One run.sh at a time (each also holds dev/.state/lab.lock); a
 * failed run stops the series with its log.
 *
 *   node dev/scene-lab/webkit-gpu.mjs [--reps 3] [--variants webkit-sw,webkit-gpu,chromium-gpu]
 *                                     [--viewport 1280x800] [--dpr 2] [--summarize-only]
 *
 * --summarize-only rebuilds the summary from the runs already in
 * out/webkit-gpu/. Variants: series.js VARIANTS (webkit-gpu-max on request).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_VARIANTS, VARIANTS, aggregate, fmt, ruleHint, seriesMarkdown } from './series.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'out')
const RUNS = join(OUT, 'webkit-gpu')
const RUN_FILE = /^([a-z0-9-]+)-(\d+)\.(json|md|log)$/

const argv = process.argv.slice(2)
const opt = (name, def) => {
	const i = argv.indexOf('--' + name)
	if (i < 0) return def
	const v = argv[i + 1]
	return v === undefined || v.startsWith('--') ? true : v
}
const REPS = Number(opt('reps', 3))
const VIEWPORT = String(opt('viewport', '1280x800'))
const DPR = Number(opt('dpr', 2))
const IDS = String(opt('variants', DEFAULT_VARIANTS.join(','))).split(',').filter(Boolean)
const SUMMARIZE_ONLY = opt('summarize-only', false) === true

/** @return {string|null} the first invalid option, or null */
function invalidOption() {
	if (!(Number.isInteger(REPS) && REPS >= 1 && REPS <= 10)) return `--reps ${opt('reps')}`
	if (!/^\d{3,4}x\d{3,4}$/.test(VIEWPORT)) return `--viewport ${VIEWPORT}`
	if (!(DPR >= 1 && DPR <= 4)) return `--dpr ${opt('dpr')}`
	const unknown = IDS.find((id) => !VARIANTS.some((v) => v.id === id))
	return unknown ? `--variants ${unknown} (known: ${VARIANTS.map((v) => v.id).join(', ')})` : null
}
if (invalidOption()) {
	console.error(`webkit-gpu.mjs: invalid ${invalidOption()}`)
	process.exit(2)
}
const variants = IDS.map((id) => VARIANTS.find((v) => v.id === id))

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

/**
 * One "run.sh measure" of a variant; its outputs are copied to out/webkit-gpu/.
 *
 * @param {object} v variant (series.js)
 * @param {number} rep 1-based repetition
 * @return {object} measure.json of the run
 */
function runOnce(v, rep) {
	const base = join(RUNS, `${v.id}-${rep}`)
	const t0 = Date.now()
	const r = spawnSync('bash', [join(HERE, 'run.sh'), 'measure', '--viewport', VIEWPORT, '--dpr', String(DPR), ...(v.args ?? [])], {
		env: { ...process.env, ...v.env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000,
	})
	writeFileSync(base + '.log', `${r.stdout ?? ''}${r.stderr ?? ''}`)
	if (r.status !== 0) {
		console.error(`${v.id} #${rep}: run.sh measure failed (exit ${r.status ?? r.signal}); log ${base}.log`)
		console.error(`${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-25).join('\n'))
		process.exit(1)
	}
	copyFileSync(join(OUT, 'measure.json'), base + '.json')
	copyFileSync(join(OUT, 'report.md'), base + '.md')
	const m = readJson(base + '.json')
	console.log(`${v.id} #${rep} (${Math.round((Date.now() - t0) / 1000)} s): pan ${fmt(m.pan.frames.fps)} fps, ` +
		`zoom ${fmt(m.zoom.frames.fps)}, board ${fmt(m.board.frames.fps)} (${fmt(m.board.frames.pctMissed)} % missed), ` +
		`board pan ${fmt(m.boardPan?.frames?.fps)} (${fmt(m.boardPan?.frames?.pctMissed)} % missed), ` +
		`GPU ${m.gpuEvidence.verdict.verdict} (gfx ${m.gpuEvidence.verdict.gfxMs} ms)`)
	return m
}

/**
 * Findings that follow from the data (German, for the report).
 *
 * @param {Array<{id: string, label: string, agg: object, runs: object[]}>} vs variants with their runs
 * @return {string[]} markdown paragraphs
 */
function findings(vs) {
	const out = []
	const by = Object.fromEntries(vs.map((v) => [v.id, v]))
	const webkitGpu = vs.filter((v) => v.id.startsWith('webkit-gpu'))
	const webkitAll = vs.filter((v) => v.id.startsWith('webkit'))
	const allSw = (v) => v.agg.verdicts.every((x) => x === 'software-only')
	if (webkitGpu.length && webkitGpu.every(allSw)) {
		const ev = webkitGpu[0].runs[0].gpuEvidence
		// say only what the runs show: these start paths, not every way WebKit could be started
		const paths = webkitAll.length === 1 ? 'einer Variante' : `${['zwei', 'drei', 'vier'][webkitAll.length - 2] ?? webkitAll.length} Varianten`
		out.push(`**WebKit (headless WPE) rendert im Container nur in Software, auch mit /dev/dri.** In keinem der ${webkitGpu.reduce((a, v) => a + v.agg.n, 0)} WebKit-Läufe mit GPU ` +
			'öffnete ein WebKit-Prozess einen /dev/dri-Deskriptor, die gfx-Engine der GPU zählte 0 ms, und die WebProcesses luden Mesa ' +
			`${[...new Set(ev.processes.flatMap((p) => p.drivers))].join('+') || '–'} (llvmpipe) – auch die WebGL-Probe (${ev.webgl?.drivers?.join('+') || '–'}, ` +
			`${ev.webgl?.drmFds ?? 0} /dev/dri). Der WebGL-Renderer-String ist bei WebKit kein Beleg: er lautet immer „${ev.webgl?.renderer ?? 'n/a'}“.`)
		out.push('**Ursache (Playwright 1.49.1, WebKit 18.2 als WPE, headless):** Der Headless-Modus des Playwright-MiniBrowsers zeigt die Seite über ' +
			'WPEBackend-fdo mit Shared-Memory-Puffern an (`HeadlessViewBackend`, `wpe_fdo_initialize_shm`). Der verschachtelte Wayland-Kompositor bietet ' +
			'dem WebProcess damit keinen DRM-Weg an, Mesa fällt für Komposition, 2D-Canvas und WebGL auf swrast zurück. Zusätzlich setzt Playwrights ' +
			'Starter `pw_run.sh` im Headless-Modus fest `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` (WebKit-Bug 279523). ' +
			(by['webkit-gpu-max'] ? 'Auch ohne diesen Zwang und mit `WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128` (Variante „ohne CPU-Zwang, Render-Knoten gesetzt“) bleibt es bei swrast. ' : '') +
			`**Mit den geprüften Startwegen (headless WPE, ${paths}) wird die GPU nicht erreicht.** ` +
			'Ungeprüft (vom Auftrag ausgeschlossen): WebKitGTK headful unter Xvfb – dessen WebProcess könnte über GBM auf den Render-Knoten zeichnen, ' +
			'die Anzeige über Xvfb bliebe Software; einen Wayland-Kompositor für ein WPE-Fenster bringt das Image nicht mit. ' +
			'Belegt ist also „nur in Software“ für diese Startwege, nicht, dass eine GPU-Annäherung mit diesem Image unmöglich wäre.')
	}
	const sw = by['webkit-sw']
	const gpu = by['webkit-gpu']
	if (sw && gpu) {
		const d = (k) => fmt(gpu.agg.figures[k].median - sw.agg.figures[k].median)
		out.push(`WebKit mit und ohne /dev/dri, Differenz der Mediane (mit − ohne): Schwenken ${d('panFps')} fps, Zoomen ${d('zoomFps')} fps, ` +
			`Zoom aufs ganze Board ${d('boardFps')} fps, erstes Rendern ${d('firstRenderMs')} ms – derselbe Software-Weg, die Unterschiede sind Streuung.`)
	}
	const wk = vs.filter((v) => v.id.startsWith('webkit')).flatMap((v) => v.runs)
	const refresh = wk.map((m) => m.refreshMs).filter(Number.isFinite)
	if (refresh.length && refresh.every((r) => Number.isInteger(r))) {
		const r = refresh.sort((a, b) => a - b)[refresh.length >> 1]
		out.push(`Messfalle: WebKit liefert die rAF-Zeitstempel in ganzen Millisekunden (Leerlauf-Intervall ${r} ms statt 16,67 ms). ` +
			`„verpasst“ zählt Frames über 1,5 × Intervall = ${fmt(1.5 * r)} ms; Frame-Zeiten genau an dieser Grenze (Zoom aufs ganze Board, p50 ` +
			`${fmt(by['webkit-gpu']?.agg.figures.boardP50.median ?? by['webkit-sw']?.agg.figures.boardP50.median)} ms) machen diesen Anteil unruhig.`)
	}
	const ref = by['chromium-gpu']
	if (ref && ref.agg.verdicts.every((x) => x === 'gpu-confirmed')) {
		const e = ref.runs[0].gpuEvidence
		out.push(`**Bezug Chromium:** Der Container erreicht die GPU – Chromium ${ref.runs[0].browser} rendert über ANGLE/GL-EGL auf Mesa ` +
			`${[...new Set(e.processes.flatMap((p) => p.drivers))].join('+')}, gfx-Engine ${fmt(ref.agg.figures.gfxMs.median, 0)} ms je Lauf (Median), ` +
			`WebGL-Renderer „${e.webgl?.renderer}“.`)
	}
	return out
}

/** Reads all runs of the requested variants and writes out/webkit-gpu.{json,md}. */
function summarize() {
	const files = existsSync(RUNS) ? readdirSync(RUNS) : []
	const vs = []
	for (const v of variants) {
		const runFiles = files.filter((f) => RUN_FILE.exec(f)?.[1] === v.id && f.endsWith('.json'))
			.sort((a, b) => Number(RUN_FILE.exec(a)[2]) - Number(RUN_FILE.exec(b)[2]))
		if (!runFiles.length) continue
		const runs = runFiles.map((f) => readJson(join(RUNS, f)))
		vs.push({ id: v.id, label: v.label, env: v.env, args: v.args ?? [], files: runFiles, runs, agg: aggregate(runs) })
	}
	if (!vs.length) {
		console.error(`webkit-gpu.mjs: no runs in ${RUNS}`)
		process.exit(1)
	}
	const first = vs[0].runs[0]
	const versions = [...new Set(vs.map((v) => `${v.runs[0].engine === 'webkit' ? 'WebKit' : 'Chromium'} ${v.runs[0].browser}`))]
	const chromium = vs.flatMap((v) => v.runs).find((m) => m.engine === 'chromium' && m.gpu)
	const runSh = readFileSync(join(HERE, 'run.sh'), 'utf8')
	const summary = {
		at: new Date().toISOString(),
		env: {
			image: /^IMAGE="([^"]+)"$/m.exec(runSh)?.[1] ?? '?',
			playwright: readJson(join(HERE, 'node_modules/playwright/package.json')).version,
			browsers: versions,
			viewport: `${first.viewport.width}×${first.viewport.height}`,
			dpr: first.dpr,
			scene: `${first.meta.counts.sticky} Notizen + ${first.meta.counts.shape ?? 0} Formen + ${first.meta.counts.text ?? 0} Text-Objekte + ${first.meta.counts.connector ?? 0} Verbinder + ${first.meta.counts.frame} Frames + ${first.meta.counts.unknown} Platzhalter`,
			cpuset: process.env.KNORKE_LAB_CPUSET || '8-15',
			hostGpu: chromium?.memory?.gpuInfo?.glRenderer ?? '/dev/dri/renderD128 (kein Chromium-GPU-Lauf in der Serie)',
			reps: Math.max(...vs.map((v) => v.agg.n)),
		},
		variants: vs.map((v) => ({
			id: v.id, label: v.label, env: v.env, args: v.args, files: v.files, agg: v.agg, hint: ruleHint(v.agg), sample: v.runs[0].gpuEvidence,
		})),
		findings: findings(vs),
	}
	writeFileSync(join(OUT, 'webkit-gpu.json'), JSON.stringify(summary, null, 1) + '\n')
	writeFileSync(join(OUT, 'webkit-gpu.md'), seriesMarkdown(summary))
	console.log(`summary: ${join(OUT, 'webkit-gpu.md')} (${vs.map((v) => `${v.id} ${v.agg.n}×`).join(', ')})`)
}

if (!SUMMARIZE_ONLY) {
	mkdirSync(RUNS, { recursive: true })
	// a new series starts empty (only this script's own file names)
	for (const f of readdirSync(RUNS)) if (RUN_FILE.test(f)) unlinkSync(join(RUNS, f))
	for (let rep = 1; rep <= REPS; rep++) {
		for (const v of variants) runOnce(v, rep)
	}
}
summarize()
