/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Measurement report of round 1b (SPEC-M1 §8.5 "Messbericht wie M0 plus: Zoom
 * über das ganze Board bei 5 % (fps, verpasst), Kamera-Schritt mit 800
 * Verbindern, Speicher"; §9.2 Phase 2 (1b)):
 * - the whole board at 1920×1080 is shown at 5 % (the fit is clamped to
 *   MIN_SCALE), and the whole-board pan of __lab.measure() keeps every item of
 *   the M1 set in the cull rectangle at every one of its 180 camera steps (real
 *   SceneModel, Camera.fit and the renderer's cull rectangle, in Node): the
 *   camera step really runs with all 800 connectors attached. A 1280×800
 *   viewport sees only part of the board at 5 % (reported, not asserted here)
 * - the A/B set noconn is the M1 board without its connectors and otherwise
 *   identical (ids, fields, order)
 * - wiring: __lab.measure() runs the scenario after the whole-board zoom and
 *   records the attached range; run.mjs takes --set in the measurement mode
 *   only, checks the loaded set and reports p99, % > 16,7/33,4 ms, the new
 *   row and the draw time per layer (Konva beforeDraw → draw)
 * - stage 2, G14 (SPEC-M1 §8.5, R13): the zoom series around 0.08 stays
 *   below LOD2_ENTER at every step, the board pan runs at MIN_SCALE (LOD 2);
 *   the gate in run.mjs checks (1)–(5) with the thresholds of §8.5; the
 *   measurement reports the LOD-2 rows and the first render under a 4× CPU
 *   throttle
 * - stage 4 (SPEC-M1 §9.5 WP-S4, WebKit fixes): measure() adds the one-finger
 *   pan on the CSS path in mode view, follow (short within the CSS rule, long
 *   with draws in between) and the badge pans on the G16 board (without and
 *   with totals); the G16 gate and the badge rows build the same board
 *   (badgeGrid); run.mjs reports the rows and takes --shadows on|off in the
 *   measurement mode only (off = the lab page with ?shadows=0)
 * - job 034 (overscan of the stage, M2): the whole-board pan is checked
 *   against the renderer's cull rectangle (cullRectOf with
 *   overscanLayout(1920, 1080, 1)); measure() adds the 1500-px one-finger
 *   pan and the pinch-out to k 0.6 after the tablet pan, run.mjs reports
 *   them; the lab helpers that compare with the culled set (visibleCount,
 *   coarsePaintCheck, connectorsInView) call cullRectOf with
 *   stats().overscan, none viewRectOf(…, CULL_MARGIN); G20 and the two
 *   overscan checks are wired (20 gates, 40 checks)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, stripComments } from './sourceScan.mjs'
import { DEFAULT_COUNTS, SCENE_SETS, generateScene } from '../../../dev/scene-lab/scene-gen.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { Camera, cullRectOf, overscanLayout } from '../../../src/scene/Camera.js'
import { CULL_MARGIN } from '../../../src/scene/KonvaRenderer.js'
import { LOD2_ENTER, LOD_COARSE_SCALE, MIN_SCALE } from '../../../src/model/tokens.js'
import { lodFor } from '../../../src/scene/nodes/coarse.js'

const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const lab = stripComments(read('dev/scene-lab/lab.js'))
const run = stripComments(read('dev/scene-lab/run.mjs'))
const measure = lab.slice(lab.indexOf('async function measure()'), lab.indexOf('async function fitRender()'))
const series = lab.slice(lab.indexOf('async function cameraSeries('), lab.indexOf('function boardMid()'))
const gate = lab.slice(lab.indexOf('async function lod2Gate()'), lab.indexOf('async function lod2Targets('))
const BOARD_PAN_PX = Number(/^const BOARD_PAN_PX = (\d+)$/m.exec(lab)?.[1])

describe('whole-board pan: the camera step with every connector attached', () => {
	const { items, meta } = generateScene({ counts: SCENE_SETS.m1 })
	const model = new SceneModel()
	model.load(items)

	for (const [vw, vh] of [[1920, 1080]]) {
		test(`${vw}×${vh}: all ${model.size} items (800 connectors) in the cull rectangle at all 180 steps`, () => {
			assert.ok(BOARD_PAN_PX > 0 && BOARD_PAN_PX < 48, `BOARD_PAN_PX ${BOARD_PAN_PX} below the 48 px fit padding`)
			const fitCam = new Camera().fit(model.allBounds(), vw, vh, 48)
			let minIn = Infinity
			let minConn = Infinity
			for (let i = 0; i < 180; i++) {
				// the camera path of __lab.measure() (figure eight at the fit scale)
				const a = (2 * Math.PI * i) / 180
				const s = fitCam.scale
				const cam = { x: fitCam.x + (BOARD_PAN_PX * Math.sin(a)) / s, y: fitCam.y + (BOARD_PAN_PX * Math.sin(2 * a)) / (2 * s), scale: s }
				const r = cullRectOf(cam, vw, vh, overscanLayout(vw, vh, 1), CULL_MARGIN)
				const hits = model.query(r.minX, r.minY, r.maxX, r.maxY)
				minIn = Math.min(minIn, hits.length)
				minConn = Math.min(minConn, hits.filter((e) => e.t === 'connector').length)
			}
			assert.equal(minIn, model.size)
			assert.equal(minConn, 800)
			assert.equal(meta.connectorIds.length, 800)
		})
	}

	test('1920×1080 shows the whole board at 5 % (fit clamped to MIN_SCALE: "Zoom über das ganze Board bei 5 %")', () => {
		assert.equal(MIN_SCALE, 0.05)
		assert.equal(new Camera().fit(model.allBounds(), 1920, 1080, 48).scale, MIN_SCALE)
	})
})

describe('A/B set noconn', () => {
	const strip = (it) => {
		const { z, ...rest } = it
		return rest
	}
	const m1 = generateScene({ counts: SCENE_SETS.m1 })
	const nc = generateScene({ counts: SCENE_SETS.noconn })

	test('the M1 set is the default board; noconn differs only in its connectors', () => {
		assert.equal(SCENE_SETS.m1, DEFAULT_COUNTS)
		assert.deepEqual(SCENE_SETS.noconn, { ...DEFAULT_COUNTS, connector: 0 })
		assert.equal(nc.meta.counts.connector, 0)
		assert.equal(nc.meta.hubNoteId, null)
		assert.deepEqual(nc.meta.connectorIds, [])
		assert.equal(m1.items.filter((it) => it.t === 'connector').length, 800)
	})

	test('every other item is identical (ids and fields) and in the same order', () => {
		const rest = m1.items.filter((it) => it.t !== 'connector')
		assert.equal(rest.length, nc.items.length)
		assert.deepEqual(nc.items.map(strip), rest.map(strip))
		const byZ = (list) => list.slice().sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0)).map((it) => it.id)
		assert.deepEqual(byZ(nc.items), byZ(rest))
		assert.deepEqual(nc.meta.centerNoteIds, m1.meta.centerNoteIds)
	})
})

describe('wiring of the measurement mode', () => {
	test('__lab.measure(): whole-board pan after the zoom, at the fit scale, attached range and LOD per scenario', () => {
		assert.match(measure, /await run\('board', 180,[\s\S]*await run\('boardPan', 180,/)
		assert.match(measure, /const s = fitCam\.scale\s+scene\.setCamera\(\{ x: fitCam\.x \+ \(BOARD_PAN_PX \* Math\.sin\(a\)\) \/ s, y: fitCam\.y \+ \(BOARD_PAN_PX \* Math\.sin\(2 \* a\)\) \/ \(2 \* s\), scale: s \}\)/)
		assert.match(measure, /const run = async \(name, steps, fn\) => \{\s+result\[name\] = await cameraSeries\(steps, fn, refreshMs\)/)
		assert.match(series, /const st = scene\.stats\(\)\s+cameraMs\.push\(st\.lastCameraMs\)\s+attached\.push\(st\.attached\)\s+statics\.push\(st\.staticChildren\)/)
		assert.match(series, /attached: \{ min: Math\.min\(\.\.\.attached\), max: Math\.max\(\.\.\.attached\) \}/)
		assert.match(series, /staticChildren: \{ min: Math\.min\(\.\.\.statics\), max: Math\.max\(\.\.\.statics\) \}/)
		assert.match(measure, /result\.board\.scales = \{ from: result\.fit\.scale,/)
		assert.match(measure, /connectorsAttached: \{ start: connectorsAtStart, end: connectorsAttached\(\) \}/)
	})

	test('draw time per layer: beforeDraw → draw in the draw log, summarized per scenario', () => {
		assert.match(lab, /layer\.on\('beforeDraw\.lab', \(\) => \{\s+drawStart\[name\] = performance\.now\(\)/)
		assert.match(lab, /drawLog\.push\(\{ layer: name, transform: scene\.renderer\.contentEl\.style\.transform, t, ms: t - drawStart\[name\] \}\)/)
		assert.match(series, /const d0 = drawLog\.length\s+meter\.start\(\)/)
		assert.match(series, /draw: \{ static: drawMs\('static'\), overlay: drawMs\('overlay'\) \}/)
		assert.match(run, /'\| Szenario \| statisch: Zeichnungen \| p50 ms \| p95 ms \| max ms \| Overlay: Zeichnungen \| p50 ms \| p95 ms \| max ms \|'/)
		assert.match(run, /\.\.\.scenarios\.map\(\(\[name, r\]\) => drawRow\(name, r\)\)/)
	})

	test('lab.js builds the set of ?set= and rejects an unknown one', () => {
		assert.match(lab, /const set = params\.get\('set'\) \?\? 'm1'/)
		assert.match(lab, /if \(!Object\.hasOwn\(SCENE_SETS, set\)\) throw new Error/)
		assert.match(lab, /generateScene\(\{ counts: SCENE_SETS\[set\] \}\)\s+meta\.set = set/)
	})

	test('run.mjs: --set only in the measurement mode, loaded set checked, set in measure.json', () => {
		assert.match(run, /if \(!\['m1', 'noconn'\]\.includes\(SET\)\) return `--set \$\{SET\}`/)
		assert.match(run, /const standard = IS_CHROMIUM && VIEWPORT\.width === 1920 && VIEWPORT\.height === 1080 && DPR === 1 && SET === 'm1'/)
		assert.match(run, /const PAGE_QUERY = new URLSearchParams\(\[\.\.\.\(SET === 'm1' \? \[\] : \[\['set', SET\]\]\), \.\.\.\(SHADOWS === 'on' \? \[\] : \[\['shadows', '0'\]\]\)\]\)\.toString\(\)/)
		assert.match(run, /await page\.goto\(PAGE_QUERY \? `\$\{URL_BASE\}\?\$\{PAGE_QUERY\}` : URL_BASE, \{ waitUntil: 'load' \}\)/)
		assert.match(run, /if \(loadedSet !== SET\) \{[\s\S]*?process\.exit\(2\)/)
		assert.match(run, /dpr: DPR, gpu: GPU, set: SET,/)
	})

	test('run.mjs report: frame p99, % > 16,7/33,4 ms, verpasst, camera p99; rows for the board zoom and the board pan', () => {
		assert.match(run, /'\| Szenario \| fps \| Frame p50 ms \| Frame p95 ms \| Frame p99 ms \| > 16,7 ms % \| > 33,4 ms % \| verpasst % \| Kamera-Schritt p50 ms \| p95 ms \| p99 ms \|'/)
		assert.match(run, /\$\{f\.p99\} \| \$\{f\.pctOver16\} \| \$\{f\.pctOver33\} \| \$\{f\.pctMissed\} \|/)
		assert.match(run, /row\('Ganzes Board zoomen \(fit … 2 × fit\)', d\.board\)/)
		assert.match(run, /\.\.\.\(bp \? \[row\(bpLabel, bp\)\] : \[\]\)/)
		assert.match(run, /Ganzes Board schwenken bei \$\{pct\(bp\.view\.scale\)\} \(LOD 2, \$\{bp\.view\.connectorsInView\.start\} Verbinder im Bild, nicht gezeichnet\)/)
	})
})

describe('G14 (stage 2): wiring of the gate and the measurement', () => {
	const zoom = /const LOD2_ZOOM = Object\.freeze\(\{ from: ([\d.]+), to: ([\d.]+), steps: (\d+) \}\)/.exec(lab)

	test('the zoom series around 0.08 stays below LOD2_ENTER at every step (LOD 2 from its first step on)', () => {
		assert.ok(zoom, 'LOD2_ZOOM in lab.js')
		const [from, to, steps] = [Number(zoom[1]), Number(zoom[2]), Number(zoom[3])]
		assert.ok(from < 0.08 && to > 0.08 && to < LOD2_ENTER && from >= MIN_SCALE && steps === 180)
		// the scale path of lod2ZoomScale(i)
		let lod = 1
		for (let i = 0; i < steps; i++) {
			const u = i < steps / 2 ? i / (steps / 2) : (steps - i) / (steps / 2)
			const s = Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * u)
			assert.ok(s < LOD2_ENTER, `step ${i}: ${s}`)
			lod = lodFor(s, lod)
			assert.equal(lod, 2)
		}
		assert.match(lab, /function lod2ZoomScale\(i\) \{\s+const u = i < LOD2_ZOOM\.steps \/ 2 \? i \/ \(LOD2_ZOOM\.steps \/ 2\) : \(LOD2_ZOOM\.steps - i\) \/ \(LOD2_ZOOM\.steps \/ 2\)\s+return Math\.exp\(Math\.log\(LOD2_ZOOM\.from\) \+ \(Math\.log\(LOD2_ZOOM\.to\) - Math\.log\(LOD2_ZOOM\.from\)\) \* u\)/)
	})

	test('lod2Gate: first render at MIN_SCALE, hysteresis, 0.08, the zoom series, the board pan at MIN_SCALE, the drag at 0.08', () => {
		assert.match(gate, /out\.firstRender = await firstRenderAt\(MIN_SCALE\)/)
		assert.match(gate, /out\.hysteresis = await lod2Hysteresis\(\)/)
		assert.match(gate, /scene\.setCamera\(camAt\(0\.08\)\)/)
		assert.match(gate, /out\.zoom = await cameraSeries\(LOD2_ZOOM\.steps, \(i\) => scene\.setCamera\(camAt\(lod2ZoomScale\(i\)\)\), refreshMs\)/)
		assert.match(gate, /scene\.setCamera\(camAt\(MIN_SCALE\)\)[\s\S]*out\.boardPan = await cameraSeries\(180, \(i\) => scene\.setCamera\(boardPanCam\(c0, i\)\), refreshMs\)/)
		assert.match(gate, /out\.drag = await coarseDrag\(0\.08\)/)
		assert.match(lab, /scene\.setCamera\(camAt\(LOD_COARSE_SCALE \+ 0\.004 \* Math\.sin\(i \/ 4\)\)\)/)
		assert.equal(LOD_COARSE_SCALE, 0.1)
	})

	test('run.mjs gates (1)–(5) with the §8.5 thresholds, in every gate run (CPU and GPU)', () => {
		const g = run.slice(run.indexOf("'gate', 'G14 LOD 2:"), run.indexOf("'check', 'LOD 2 painting:"))
		assert.ok(g.length > 500, 'G14 step found')
		assert.match(g, /d\.at008\.staticChildren === 1 && d\.boardPan\.staticChildren\.min === 1 && d\.boardPan\.staticChildren\.max === 1/)
		assert.match(g, /step: d\.zoom\.camera\.p95 <= 2 && d\.boardPan\.camera\.p95 <= 2/)
		assert.match(g, /d\.firstRender\.ms <= 250/)
		assert.match(g, /d\.hysteresis\.from1\.switches === 0 && d\.hysteresis\.from2\.switches === 0/)
		assert.match(g, /d\.drag\.staticDrawsDuring === 0 && d\.drag\.paintsDuring === 0/)
		assert.match(g, /!d\.drag\.paintedHasNote/)
		assert.match(g, /return \[Object\.values\(g\)\.every\(Boolean\)/)
		// one gate list for both runs: run.sh adds only --gpu
		assert.doesNotMatch(g, /if \(GPU\)|!GPU/)
	})

	test('measurement: LOD-2 zoom row, the board pan as LOD 2, the first render under a 4× CPU throttle (Chromium)', () => {
		assert.match(measure, /await run\('lod2Zoom', LOD2_ZOOM\.steps, \(i\) => scene\.setCamera\(camAt\(lod2ZoomScale\(i\)\)\)\)/)
		assert.match(run, /await cdp\.send\('Emulation\.setCPUThrottlingRate', \{ rate: 4 \}\)[\s\S]*lod2First\.throttled = await lab\(\(\) => window\.__lab\.firstRenderAt\(0\.05\)\)[\s\S]*rate: 1/)
		assert.match(run, /row\(`Board-Zoom um 8 %/)
	})
})

describe('stage 4 (SPEC-M1 §9.5 WP-S4, WebKit fixes): the measurement rows for the tablet pan, follow and badges', () => {
	const stage4 = lab.slice(lab.indexOf('const FOLLOW_SHORT'), lab.indexOf('async function fitRender()'))

	test('measure() runs them after the LOD-2 zoom series and before the final stats', () => {
		assert.match(measure, /result\.lod2Zoom\.scales = [^\n]+\s+result\.touchPan = await touchPanSeries\(refreshMs\)\s+result\.touchPan1500 = await touchPan1500Series\(refreshMs\)\s+result\.pinchOut = await pinchOutSeries\(refreshMs\)\s+result\.followShort = await followSeries\(FOLLOW_SHORT, refreshMs\)\s+result\.followLong = await followSeries\(FOLLOW_LONG, refreshMs\)\s+Object\.assign\(result, await badgeSeries\(refreshMs\)\)\s+result\.stats = scene\.stats\(\)/)
		// G15's glide and its long glide
		assert.match(stage4, /const FOLLOW_SHORT = Object\.freeze\(\{ dx: 300, dy: 150, scale: 1\.2, ms: 600 \}\)/)
		assert.match(stage4, /const FOLLOW_LONG = Object\.freeze\(\{ dx: 5000, dy: 0, scale: 1, ms: 800 \}\)/)
	})

	test('touch pan: mode view (one finger pans as on a tablet), 90 moves, draws while panning counted, the end draw timed, mode edit again', () => {
		const t = stage4.slice(stage4.indexOf('async function touchPanSeries'), stage4.indexOf('async function followSeries'))
		assert.match(t, /scene\.setMode\('view'\)/)
		assert.match(t, /for \(let i = 1; i <= 90; i\+\+\) \{\s+touch\('pointermove', 42,/)
		assert.match(t, /const drawsDuring = drawLog\.length - d0\s+touch\('pointerup'/)
		assert.match(t, /return \{ frames, drawsDuring, draw: drawsSince\(d0 \+ drawsDuring\) \}/)
		assert.match(t, /finally \{\s+scene\.setMode\('edit'\)/)
	})

	test('follow: frames over the whole glide, its result and duration, the draws it caused', () => {
		const f = stage4.slice(stage4.indexOf('async function followSeries'), stage4.indexOf('async function badgeSeries'))
		assert.match(f, /meter\.start\(\)\s+const r = await settleWithFrames\(scene\.followTo\(\{ x: c0\.x \+ f\.dx, y: c0\.y \+ f\.dy, scale: f\.scale \}, f\.ms\), f\.ms \+ 3000\)\s+const frames = meter\.stop\(refreshMs\)/)
		assert.match(f, /draw: drawsSince\(d0\)/)
	})

	test('badges: the G16 board in mode vote, a camera step per frame, without and with totals; board removed and mode edit after', () => {
		const b = stage4.slice(stage4.indexOf('async function badgeSeries'))
		assert.match(b, /const grid = badgeGrid\(\)/)
		assert.match(b, /scene\.setMode\('vote'\)/)
		assert.match(b, /scene\.setVoteState\(grid\.voteState\(PALETTE\[0\]\)\)[\s\S]*out\.badgePan = \{ \.\.\.await cameraSeries\(120, pan, refreshMs\), counts: scene\.stats\(\)\.voteState, scale: cam\.scale \}/)
		assert.match(b, /total: 10 \+ \(i % 7\)[\s\S]*out\.badgeTotalsPan = \{ \.\.\.await cameraSeries\(120, pan, refreshMs\)/)
		assert.match(b, /finally \{\s+scene\.setVoteState\(null\)\s+scene\.setMode\('edit'\)\s+scene\.update\(model\.apply\(\{ removes: \[grid\.fid, \.\.\.grid\.ids\] \}\)\)/)
		// the gate builds the same board
		assert.match(lab, /async function badgeGate\(\) \{\s+const \{ fid, ids, frameBox, own, rings, voteState \} = badgeGrid\(\)/)
		assert.equal([...lab.matchAll(/upserts\.push\(\{ id, t: 'sticky', x: x0 \+ c \* step/g)].length, 1, 'one place builds the G16 notes')
	})

	test('run.mjs reports the rows (frames; camera only for the badge pans) and their notes; --shadows on|off only in the measurement mode', () => {
		assert.match(run, /\['Ein-Finger-Schwenk 100 % \(CSS-Pfad, Modus view\)', d\.touchPan, false\]/)
		assert.match(run, /\[`Folgen kurz \(\$\{fShort\.glide\.ms\} ms, CSS-Pfad\)`, fShort, false\]/)
		assert.match(run, /\[`Folgen lang \(\$\{fLong\.glide\.dx\} px, \$\{fLong\.glide\.ms\} ms\)`, fLong, false\]/)
		assert.match(run, /\[badgeLabel\(d\.badgePan, false\), d\.badgePan, true\]/)
		assert.match(run, /\[badgeLabel\(d\.badgeTotalsPan, true\), d\.badgeTotalsPan, true\]/)
		assert.match(run, /\.\.\.stage4\.map\(\(\[name, r, cam\]\) => row\(name, r, cam\)\)/)
		assert.match(run, /\.\.\.stage4\.map\(\(\[name, r\]\) => \[name, r\]\)\]/)
		assert.match(run, /const SHADOWS = String\(opt\('shadows', 'on'\)\)/)
		assert.match(run, /if \(!\['on', 'off'\]\.includes\(SHADOWS\)\) return `--shadows \$\{SHADOWS\}`/)
		assert.match(run, /DPR === 1 && SET === 'm1' && SHADOWS === 'on'\s+if \(MODE !== 'measure' && !standard\)/)
		assert.match(run, /set: SET, shadows: SHADOWS, label: LABEL,/)
		assert.match(lab, /const shadows = params\.get\('shadows'\) !== '0'/)
	})
})

describe('job 034 (overscan of the stage): lab wiring', () => {
	const fn = (name, next) => lab.slice(lab.indexOf(name), lab.indexOf(next))

	test('the helpers that compare with the culled set use cullRectOf with stats().overscan, never viewRectOf(…, CULL_MARGIN)', () => {
		assert.match(fn('function visibleCount()', 'function clientCenter('), /cullRectOf\(scene\.getCamera\(\), container\.clientWidth, container\.clientHeight, scene\.stats\(\)\.overscan, CULL_MARGIN\)/)
		const coarse = fn('async function coarsePaintCheck(', '// ---------------------------------------------------------------- job 034')
		assert.match(coarse, /const st = scene\.stats\(\)\s+const r = cullRectOf\(scene\.getCamera\(\), vw, vh, st\.overscan, CULL_MARGIN\)/)
		assert.match(measure, /const connectorsInView = \(\) => \{\s+const r = cullRectOf\(scene\.getCamera\(\), vw, vh, scene\.stats\(\)\.overscan, CULL_MARGIN\)/)
		assert.doesNotMatch(lab, /viewRectOf\([^)]*CULL_MARGIN/)
		assert.doesNotMatch(run, /viewRectOf\(/)
	})

	test('measure(): the 1500-px pan (125 × 12 px) and the pinch-out (500 → 300 px in 30 frames) on the CSS path in mode view; run.mjs reports both', () => {
		const g = fn('async function cssGestureSeries(', 'const touchPan1500Series')
		assert.match(g, /scene\.setMode\('view'\)/)
		assert.match(g, /const n = kind === 'pinch' \? 30 : 125/)
		assert.match(g, /half = 250 - \(100 \* i\) \/ n/)
		assert.match(g, /touch\('pointermove', 81, x0 - 12 \* i, y0\)/)
		assert.match(g, /drawsDuring: \{ static: during\.filter\(\(x\) => x\.layer === 'static'\)\.length, overlay: during\.filter\(\(x\) => x\.layer === 'overlay'\)\.length \}/)
		assert.match(lab, /const touchPan1500Series = \(refreshMs\) => cssGestureSeries\('pan', refreshMs\)/)
		assert.match(lab, /const pinchOutSeries = \(refreshMs\) => cssGestureSeries\('pinch', refreshMs\)/)
		assert.match(run, /\['Ein-Finger-Schwenk 100 % \(CSS-Pfad, Modus view\)', d\.touchPan, false\]\] : \[\]\),\s+\.\.\.\(d\.touchPan1500 \? \[\['Ein-Finger-Schwenk 1500 px \(CSS-Pfad, Modus view\)', d\.touchPan1500, false\]\] : \[\]\),\s+\.\.\.\(d\.pinchOut \? \[\['Pinch-out auf k 0,6 \(CSS-Pfad\)', d\.pinchOut, false\]\] : \[\]\)/)
		assert.match(run, /Zwischen-Draws statisch \$\{d\.touchPan1500\.drawsDuring\.static\}/)
	})

	test('gates: G20 and the checks "Überstand" and "Überstand bei Größenänderung" before the whole-run steps; 20 gates and 40 checks', () => {
		assert.equal([...run.matchAll(/await step\('gate'/g)].length, 20)
		assert.equal([...run.matchAll(/await step\('check'/g)].length, 40)
		const at = (name) => run.indexOf(name)
		assert.ok(at("'check', 'Überstand: ") > 0 && at("'check', 'Überstand bei Größenänderung: ") > at("'check', 'Überstand: "))
		assert.ok(at("'gate', 'G20 Rand ohne Lücke: ") > at("'check', 'Überstand bei Größenänderung: "))
		assert.ok(at("'gate', 'Kamera: no stage.scale") > at("'gate', 'G20 Rand ohne Lücke: "))
		assert.match(run, /'gate', 'Lazy Build: nodesBuilt <= items in the cull rectangle \(stage, at least viewport \+ 10 %\) after load'/)
		const g20 = run.slice(at("'gate', 'G20 Rand ohne Lücke: "), at("'gate', 'Kamera: no stage.scale"))
		assert.match(g20, /for \(const \[name, dx, dy\] of \[\['wheelStraight', 12, 0\], \['wheelDiagonal', 12, 12\]\]\)/)
		assert.match(g20, /await page\.mouse\.wheel\(dx, dy\)\s+await lab\(\(\) => window\.__lab\.edgeWheelStep\(\)\)/)
		assert.match(g20, /r\.during\.static === 0 && r\.during\.overlay === 0 && r\.end\.static === 1/)
		assert.match(g20, /JSON\.stringify\(L\.drawFrames\) === JSON\.stringify\(L\.predicted\) && JSON\.stringify\(L\.predicted\) === '\[32\]'/)
		assert.match(g20, /JSON\.stringify\(P\.drawFrames\) === JSON\.stringify\(P\.predicted\) && P\.predicted\.length === 1/)
		// one gate list for both runs: run.sh adds only --gpu
		assert.doesNotMatch(g20, /if \(GPU\)|!GPU/)
	})

	test('G20 in the page: probe points mapped with ((p − t)/k + (l, t)) · pr onto the static canvas, alpha ≥ 250; coverage of .konvajs-content within COVER_TOL_PX', () => {
		const sample = fn('function edgeSample(run)', 'function edgeSummary(run)')
		assert.match(sample, /const \{ k, tx, ty \} = cssTransformFor\(scene\.renderer\.camera, live\)/)
		assert.match(sample, /Math\.floor\(\(\(\(p\.x - live\.x\) \* live\.scale - tx\) \/ k \+ ov\.l\) \* pr\)/)
		assert.match(sample, /Math\.floor\(\(\(\(p\.y - live\.y\) \* live\.scale - ty\) \/ k \+ ov\.t\) \* pr\)/)
		assert.match(sample, /getLayers\(\)\[0\]\.getCanvas\(\)\._canvas\.getContext\('2d'\)/)
		assert.match(sample, /if \(!\(a >= 250\)\)/)
		assert.match(sample, /return x1 >= 2 && x1 <= vw - 2 && y1 >= 2 && y1 <= vh - 2/)
		assert.match(lab, /const coveredBy = \(g\) => Math\.max\(g\.l, g\.t, g\.r, g\.b\) <= COVER_TOL_PX/)
		assert.match(fn('function edgeSummary(run)', 'async function edgeTouch('), /predicted: gestureRedrawFrames\(run\.c0, run\.lives, vw, vh, run\.ov\)/)
		const t = fn('async function edgeTouch(', 'async function edgeWheelBegin(')
		assert.match(t, /const run = await edgeStart\('view'\)/)
		assert.match(t, /const n = kind === 'long' \? 50 : 30/)
	})
})
