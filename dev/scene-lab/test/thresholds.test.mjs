/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The M1 thresholds of job 214 (thresholds.js) and the summary of several
 * runs (summary.mjs), without a browser:
 * - the limits are the M1 numbers (SPEC-M1 §8.5 G12/G14, §8.8 point 6)
 * - a value equal to its limit passes, a hair beyond fails, a missing one fails
 * - summary: median of the runs per set and variant, a note below three
 *   runs, the verdict on the medians, the failed thresholds listed
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS, checkText, evaluate, keeps, valueAt } from '../thresholds.js'
import { median, summarize, summaryLines } from '../summary.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @param {object} v values of the threshold paths
 * @return {object} a measurement with exactly these values
 */
function run({ fit = 30, cold = 20, zoom = 0.3, pan = 0.2, fps = 59.7, missed = 0, panFps = 59.7, drag = 59.5 } = {}, extra = {}) {
	return {
		fit: { ms: fit }, lod2First: { plain: { ms: cold } }, lod2Zoom: { camera: { p95: zoom } }, boardPan: { camera: { p95: pan } },
		board: { frames: { fps, pctMissed: missed } }, pan: { frames: { fps: panFps } }, connectorDrag: { frames: { fps: drag } }, ...extra,
	}
}

describe('thresholds.js (AK4)', () => {
	test('the M1 numbers, unchanged', () => {
		const limits = Object.fromEntries(THRESHOLDS.flatMap((t) => t.checks.map((c) => [c.path, `${c.op} ${c.limit}`])))
		assert.deepEqual(limits, {
			'fit.ms': '<= 250', 'lod2First.plain.ms': '<= 250', 'lod2Zoom.camera.p95': '<= 2', 'boardPan.camera.p95': '<= 2',
			'board.frames.fps': '>= 30', 'board.frames.pctMissed': '<= 25', 'pan.frames.fps': '>= 45', 'connectorDrag.frames.fps': '>= 55',
		})
		assert.deepEqual(THRESHOLDS.map((t) => t.id), ['S1', 'S2', 'S3', 'S4', 'S5'])
	})

	test('a value equal to its limit passes, a hair beyond fails', () => {
		const edge = evaluate(run({ fit: 250, cold: 250, zoom: 2, pan: 2, fps: 30, missed: 25, panFps: 45, drag: 55 }))
		assert.deepEqual(edge.map((v) => v.ok), [true, true, true, true, true])
		const cases = [
			[{ fit: 250.1 }, 'S1'], [{ cold: 250.1 }, 'S1'], [{ zoom: 2.001 }, 'S2'], [{ pan: 2.01 }, 'S2'],
			[{ fps: 29.9 }, 'S3'], [{ missed: 25.01 }, 'S3'], [{ panFps: 44.9 }, 'S4'], [{ drag: 54.9 }, 'S5'],
		]
		for (const [v, id] of cases) {
			const out = evaluate(run(v))
			assert.deepEqual(out.filter((x) => !x.ok).map((x) => x.id), [id], JSON.stringify(v))
		}
	})

	test('a missing value fails and says so', () => {
		const m = run()
		delete m.connectorDrag
		m.lod2First.plain.ms = null
		const out = evaluate(m)
		assert.deepEqual(out.filter((x) => !x.ok).map((x) => x.id), ['S1', 'S5'])
		assert.equal(checkText(out[4].checks[0]), '– (≥ 55) FAIL (fehlt)')
		assert.equal(valueAt({ a: { b: '3' } }, 'a.b'), null)
		assert.equal(valueAt({ a: { b: Infinity } }, 'a.b'), null)
		assert.equal(keeps(null, '>=', 0), false)
		assert.equal(checkText(out[0].checks[0]), '30 (≤ 250) PASS')
	})
})

describe('summary.mjs (AK5)', () => {
	test('median', () => {
		assert.equal(median([3, 1, 2]), 2)
		assert.equal(median([4, 1, 3, 2]), 2.5)
		assert.equal(median([null, 5]), 5)
		assert.equal(median([]), null)
	})

	test('median of three runs per set and variant, verdict on the medians, failed thresholds listed', () => {
		const runs = [
			run({ fit: 100, panFps: 40 }, { set: 'm2diagrams', gpu: false, label: 'r1', loadavg: { start: [2.5, 2, 2], end: [3.1, 2, 2] } }),
			run({ fit: 300, panFps: 50 }, { set: 'm2diagrams', gpu: false, label: 'r2', loadavg: { start: [1, 1, 1], end: [1, 1, 1] } }),
			run({ fit: 200, panFps: 44 }, { set: 'm2diagrams', gpu: false, label: 'r3' }),
			run({}, { set: 'm2diagrams', gpu: true, label: 'r1' }),
			run({}, { set: 'm2diagrams', gpu: true, label: 'r2' }),
		]
		const groups = summarize(runs)
		assert.deepEqual(groups.map((g) => [g.set, g.variant, g.runs]), [['m2diagrams', 'cpu', 3], ['m2diagrams', 'gpu', 2]])
		const cpu = groups[0]
		assert.equal(cpu.verdicts[0].checks[0].value, 200)
		assert.equal(cpu.verdicts[0].ok, true)
		assert.equal(cpu.verdicts[3].checks[0].value, 44)
		assert.equal(cpu.verdicts[3].ok, false)
		assert.equal(cpu.load, 3.1)
		const md = summaryLines(groups).join('\n')
		assert.match(md, /\| chromium \| m2diagrams \| cpu \| 3 \| 200 \/ 20 PASS \|/)
		assert.match(md, /\| chromium \| m2diagrams \| gpu \| 2 \(weniger als 3\) \|/)
		assert.match(md, /- m2diagrams cpu: S4 Schwenken bei 100 % – fps 44 \(Grenze ≥ 45\)/)
		assert.doesNotMatch(md, /m2diagrams gpu: S/)
		assert.match(summaryLines(summarize([run({}, { set: 'm1' })])).join('\n'), /Keine Schwelle gerissen\./)
	})

	test('the command: a table for measurements, exit 2 without files or for a file that is no measurement', () => {
		const dir = mkdtempSync(join(tmpdir(), 'lab-summary-'))
		try {
			const a = join(dir, 'measure-chromium-cpu-m2notes-r1.json')
			writeFileSync(a, JSON.stringify(run({}, { set: 'm2notes', gpu: false, label: 'r1' })))
			const out = execFileSync(process.execPath, [join(HERE, '..', 'summary.mjs'), a], { encoding: 'utf8' })
			assert.match(out, /\| chromium \| m2notes \| cpu \| 1 \(weniger als 3\) \|/)
			const bad = join(dir, 'gates-cpu.json')
			writeFileSync(bad, JSON.stringify({ results: [] }))
			assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'summary.mjs'), bad]).status, 2)
			assert.equal(spawnSync(process.execPath, [join(HERE, '..', 'summary.mjs')]).status, 2)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
