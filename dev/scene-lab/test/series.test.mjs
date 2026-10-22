/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Measurement series (dev/scene-lab/series.js, SPEC-M1 §16): median and
 * range, the figures of §8.8 points 5/6 from measure.json (R12: with the
 * whole-board pan), the decision rule as a hint, the report.
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VARIANTS, ROWS, VARIANTS, aggregate, cell, fmt, median, ruleHint, runFigures, seriesMarkdown, spread } from '../series.js'

/** A measure.json as run.mjs writes it (only the fields the series reads). */
const run = ({ pan = 26, zoom = 13, board = 41, boardMissed = 45, boardPan = 23, first = 90, fit = 60, verdict = 'software-only', gfxMs = 0 } = {}) => ({
	browser: '18.2', engine: 'webkit', viewport: { width: 1280, height: 800 }, dpr: 2,
	firstRenderMs: first, fit: { ms: fit, scale: 0.05 },
	pan: { frames: { fps: pan, p50: 38, p95: 45, pctMissed: 99 } },
	zoom: { frames: { fps: zoom, p50: 75, p95: 114, pctMissed: 87 } },
	board: { frames: { fps: board, p50: 24, p95: 31, pctMissed: boardMissed } },
	boardPan: { frames: { fps: boardPan, p50: 44, p95: 48, pctMissed: 97.8 } },
	drag: { frames: { fps: 60, p50: 16, p95: 17, pctMissed: 0.8 } },
	gpuEvidence: { verdict: { verdict, gfxMs, reasons: ['r1', 'r2'] }, processes: [{ kind: 'web', drivers: ['swrast'], drmFds: 0 }], launch: { note: 'n' } },
	meta: { counts: { sticky: 3000, frame: 20, unknown: 30 } },
})

describe('median and range', () => {
	test('odd and even counts, non-finite values ignored', () => {
		assert.equal(median([3, 1, 2]), 2)
		assert.equal(median([4, 1, 3, 2]), 2.5)
		assert.equal(median([5, null, NaN, undefined, 7]), 6)
		assert.equal(median([]), null)
		assert.deepEqual(spread([41.4, 39.1, 41.1]), { median: 41.1, min: 39.1, max: 41.4, n: 3 })
		assert.deepEqual(spread([null]), { median: null, min: null, max: null, n: 0 })
	})

	test('cells: German decimal comma, range only with more than one run', () => {
		assert.equal(fmt(41.06), '41,1')
		assert.equal(fmt(1234.5, 0), '1.235')
		assert.equal(fmt(null), '–')
		assert.equal(cell(spread([41.4, 39.1, 41.1])), '41,1 (39,1–41,4)')
		assert.equal(cell(spread([59.7])), '59,7')
		assert.equal(cell(spread([])), '–')
	})
})

describe('figures and aggregate', () => {
	test('runFigures reads the §8.8 figures of measure.json', () => {
		const f = runFigures(run({ pan: 25.8, board: 41.4, first: 88.4, fit: 60.9 }))
		assert.equal(f.panFps, 25.8)
		assert.equal(f.panMissed, 99)
		assert.equal(f.zoomP95, 114)
		assert.equal(f.boardFps, 41.4)
		assert.equal(f.boardMissed, 45)
		assert.equal(f.boardPanFps, 23)
		assert.equal(f.boardPanMissed, 97.8)
		assert.equal(f.boardPanP95, 48)
		assert.equal(f.firstRenderMs, 88.4)
		assert.equal(f.boardFirstRenderMs, 60.9)
		assert.equal(f.gfxMs, 0)
		for (const [key] of ROWS) assert.ok(key in f, key)
	})

	test('aggregate over three runs keeps median, range and the verdict of each run', () => {
		const a = aggregate([run({ pan: 25.8 }), run({ pan: 26.2 }), run({ pan: 26 })])
		assert.equal(a.n, 3)
		assert.deepEqual(a.figures.panFps, { median: 26, min: 25.8, max: 26.2, n: 3 })
		assert.deepEqual(a.verdicts, ['software-only', 'software-only', 'software-only'])
	})
})

describe('decision rule §8.8 point 6 (hint only)', () => {
	test('whole board < 30 fps or > 25 % missed or first render > 1 s → LOD 2; pan < 45 fps → profiling', () => {
		const sw = ruleHint(aggregate([run(), run(), run()]))
		assert.equal(sw.lod2, true)
		assert.deepEqual(sw.lod2Reasons, ['Zoom aufs ganze Board 45 % verpasst > 25 %'])
		assert.equal(sw.profiling, true)
		assert.deepEqual(sw.profilingReasons, ['Schwenken 26 fps < 45'])
		const slow = ruleHint(aggregate([run({ board: 29.9, boardMissed: 10, first: 1200, fit: 1001 })]))
		assert.deepEqual(slow.lod2Reasons, ['Zoom aufs ganze Board 29,9 fps < 30', 'erstes Rendern 1.200 ms > 1 s', 'erstes Rendern ganzes Board 1.001 ms > 1 s'])
		const fast = ruleHint(aggregate([run({ pan: 59.7, board: 59.7, boardMissed: 0, first: 22, fit: 50 })]))
		assert.deepEqual(fast, { lod2: false, lod2Reasons: [], profiling: false, profilingReasons: [] })
		// boundaries: exactly 30 fps, 25 %, 1 s and 45 fps do not trigger
		const edge = ruleHint(aggregate([run({ pan: 45, board: 30, boardMissed: 25, first: 1000, fit: 1000 })]))
		assert.equal(edge.lod2, false)
		assert.equal(edge.profiling, false)
	})
})

describe('variants and report', () => {
	test('every variant sets all run.sh variables; the default series is the three of the task', () => {
		assert.deepEqual([...DEFAULT_VARIANTS], ['webkit-sw', 'webkit-gpu', 'chromium-gpu'])
		for (const v of VARIANTS) {
			assert.deepEqual(Object.keys(v.env).sort(), ['KNORKE_GPU', 'KNORKE_LAB_BROWSER', 'KNORKE_LAB_WEBKIT_SKIA'], v.id)
		}
		assert.equal(VARIANTS.find((v) => v.id === 'webkit-sw').env.KNORKE_GPU, '0')
		assert.equal(VARIANTS.find((v) => v.id === 'chromium-gpu').env.KNORKE_LAB_BROWSER, 'chromium')
	})

	test('markdown: environment, one column per variant, verdicts, the rule as a hint, findings', () => {
		const vs = [
			{ id: 'webkit-sw', label: 'WebKit ohne GPU', runs: [run(), run({ pan: 25 }), run({ pan: 27 })] },
			{ id: 'chromium-gpu', label: 'Chromium mit KNORKE_GPU=1 (Bezug)', runs: [run({ pan: 59.7, board: 59.7, boardMissed: 0, verdict: 'gpu-confirmed', gfxMs: 3444 })] },
		].map((v) => ({ ...v, agg: aggregate(v.runs), sample: v.runs[0].gpuEvidence }))
		const md = seriesMarkdown({
			at: '2026-10-12T05:10:00.000Z',
			env: { image: 'mcr.microsoft.com/playwright:v1.49.1-jammy', playwright: '1.49.1', browsers: ['WebKit 18.2', 'Chromium 131'], viewport: '1280×800', dpr: 2, scene: 's', cpuset: '8-15', hostGpu: 'g', reps: 3 },
			variants: vs,
			findings: ['**Befund A.**'],
		})
		assert.match(md, /Container ≠ Gerät/)
		assert.match(md, /\| Kennzahl \| WebKit ohne GPU \| Chromium mit KNORKE_GPU=1 \(Bezug\) \|/)
		assert.match(md, /\| Schwenken fps \| 26 \(25–27\) \| 59,7 \|/)
		assert.match(md, /\| Ganzes Board schwenken fps \| 23 \(23–23\) \| 23 \|/)
		assert.match(md, /\| GPU-Urteil je Lauf \| software-only, software-only, software-only \| gpu-confirmed \|/)
		assert.match(md, /- WebKit ohne GPU: LOD 2 vorziehen\? \*\*ja\*\*/)
		assert.match(md, /- Chromium mit KNORKE_GPU=1 \(Bezug\): LOD 2 vorziehen\? nein; Culling-Profiling auf WebKit\? nein\./)
		assert.match(md, /sie entscheidet \*\*nicht\*\* über LOD 2/)
		assert.match(md, /## Befund\n\n\*\*Befund A\.\*\*/)
	})
})
