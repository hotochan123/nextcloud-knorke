/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/scene/grid.js (M2, SPEC-M1 §1.2 (R12), job 016, AK8), pure:
 * - gridStep: GRID_SIZE · 5^k, the smallest with step · scale ≥ 10 px;
 *   null for a scale that is not finite or ≤ 0; over the whole zoom range
 *   10 ≤ step · scale ≤ 80 and the next finer step would be too dense
 * - gridLines: whole device pixels, major lines every fifth, the pixel
 *   ratio, null for bad input, at most floor(width / 10) + 1 lines per axis
 *   (also for a far but finite camera, |x| = 1e18: it returns)
 * - paintGrid: clearRect, the minor lines, then the major ones, each as a
 *   whole-pixel rectangle of lw device px
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { gridLines, gridStep, paintGrid } from '../../../src/scene/grid.js'
import { GRID_MAJOR_COLOR, GRID_MINOR_COLOR, MAX_SCALE, MIN_SCALE } from '../../../src/model/tokens.js'

/**
 * @param {number} seed seed
 * @return {() => number} mulberry32, values in [0, 1)
 */
function rng(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** @return {object} a 2D context stand-in that records every call and fillStyle assignment */
function recorder() {
	const calls = []
	return {
		calls,
		set fillStyle(v) { calls.push(['fillStyle', v]) },
		get fillStyle() { return null },
		clearRect: (...a) => calls.push(['clearRect', ...a]),
		fillRect: (...a) => calls.push(['fillRect', ...a]),
	}
}

describe('AK8 (a): gridStep', () => {
	test('the steps 20, 100, 500 at their scales', () => {
		for (const [s, want] of [[4, 20], [1, 20], [0.5, 20], [0.49, 100], [0.1, 100], [0.0999, 500], [0.05, 500]]) {
			assert.equal(gridStep(s), want, `scale ${s}`)
		}
	})

	test('null for 0, −1, NaN and Infinity', () => {
		for (const s of [0, -1, NaN, Infinity, -Infinity, undefined, null, '1']) {
			assert.equal(gridStep(s), null, String(s))
		}
	})

	test('200 log-distributed scales from MIN_SCALE to MAX_SCALE: 10 ≤ step · scale ≤ 80, the finer step too dense', () => {
		for (let i = 0; i < 200; i++) {
			const s = MIN_SCALE * Math.pow(MAX_SCALE / MIN_SCALE, i / 199)
			const step = gridStep(s)
			assert.ok(step * s >= 10 && step * s <= 80, `scale ${s}: ${step * s}`)
			assert.ok(step === 20 || (step / 5) * s < 10, `scale ${s}: step ${step} is the smallest`)
		}
	})
})

describe('AK8 (b): gridLines', () => {
	const at = (l) => l.map((x) => x.at)
	const major = (l) => l.map((x) => x.major)

	test('camera x −15 at scale 1, 100 × 50, pr 1: step 20, lw 1, the lines and their major flags', () => {
		const g = gridLines({ x: -15, y: 0, scale: 1 }, 100, 50, 1)
		assert.equal(g.step, 20)
		assert.equal(g.lw, 1)
		assert.deepEqual(at(g.xs), [15, 35, 55, 75, 95])
		assert.deepEqual(major(g.xs), [true, false, false, false, false])
		assert.deepEqual(at(g.ys), [0, 20, 40])
		assert.deepEqual(major(g.ys), [true, false, false])
		assert.ok(g.xs.every((x) => !Object.is(x.at, -0)) && g.ys.every((y) => !Object.is(y.at, -0)), 'never −0')
	})

	test('pixel ratio 2: device px doubled, lw 2; pr 1.5: first at 23, lw 2', () => {
		const g = gridLines({ x: -15, y: 0, scale: 1 }, 100, 50, 2)
		assert.deepEqual(at(g.xs), [30, 70, 110, 150, 190])
		assert.deepEqual(at(g.ys), [0, 40, 80])
		assert.equal(g.lw, 2)
		const h = gridLines({ x: -15, y: 0, scale: 1 }, 100, 50, 1.5)
		assert.equal(h.xs[0].at, 23)
		assert.equal(h.lw, 2)
	})

	test('x −120: the line at world −100 is a major line, the one at −120 is not', () => {
		const g = gridLines({ x: -120, y: 0, scale: 1 }, 100, 50, 1)
		assert.deepEqual(g.xs.slice(0, 2), [{ at: 0, major: false }, { at: 20, major: true }])
	})

	test('scale 0.05, 1000 × 800: step 500, 41 vertical lines 25 apart, every fifth a major line', () => {
		const g = gridLines({ x: 0, y: 0, scale: 0.05 }, 1000, 800, 1)
		assert.equal(g.step, 500)
		assert.equal(g.xs.length, 41)
		g.xs.forEach((x, i) => {
			assert.equal(x.at, 25 * i)
			assert.equal(x.major, i % 5 === 0)
		})
	})

	test('null for scale 0, width 0, height NaN, pr 0 and x Infinity', () => {
		const cam = { x: 0, y: 0, scale: 1 }
		assert.equal(gridLines({ ...cam, scale: 0 }, 100, 50, 1), null)
		assert.equal(gridLines(cam, 0, 50, 1), null)
		assert.equal(gridLines(cam, 100, NaN, 1), null)
		assert.equal(gridLines(cam, 100, 50, 0), null)
		assert.equal(gridLines({ ...cam, x: Infinity }, 100, 50, 1), null)
		assert.equal(gridLines({ ...cam, y: NaN }, 100, 50, 1), null)
		assert.equal(gridLines(null, 100, 50, 1), null)
	})

	test('a far but finite camera (x 1e18, y −1e18, also 1e17, 1e300): returns, at most floor(size / 10) + 1 lines per axis', () => {
		for (const cam of [{ x: 1e18, y: 0, scale: 1 }, { x: 0, y: -1e18, scale: 1 }, { x: 1e18, y: -1e18, scale: 0.05 },
			{ x: 1e17, y: -1e17, scale: 1 }, { x: 1e300, y: -1e300, scale: 4 }]) {
			const g = gridLines(cam, 1920, 1080, 1)
			assert.ok(g !== null, JSON.stringify(cam))
			assert.ok(g.xs.length <= Math.floor(1920 / 10) + 1, `xs ${g.xs.length} at ${JSON.stringify(cam)}`)
			assert.ok(g.ys.length <= Math.floor(1080 / 10) + 1, `ys ${g.ys.length} at ${JSON.stringify(cam)}`)
			assert.ok([...g.xs, ...g.ys].every((l) => Number.isFinite(l.at)))
		}
		// x 1e18 at step 20: the line index is no safe integer, no vertical lines; y 0 keeps its lines
		const far = gridLines({ x: 1e18, y: 0, scale: 1 }, 1920, 1080, 1)
		assert.deepEqual(far.xs, [])
		assert.equal(far.ys.length, 55)
		// 1e15 is still drawn normally
		assert.equal(gridLines({ x: 1e15, y: 0, scale: 1 }, 1920, 1080, 1).xs.length, 97)
	})

	test('200 seeded valid cameras: at most floor(width / 10) + 1 lines per axis, ascending', () => {
		const r = rng(16)
		for (let i = 0; i < 200; i++) {
			const scale = MIN_SCALE * Math.pow(MAX_SCALE / MIN_SCALE, r())
			const cam = { x: (r() - 0.5) * 2e5, y: (r() - 0.5) * 2e5, scale }
			const w = 1 + Math.floor(r() * 2560)
			const h = 1 + Math.floor(r() * 1440)
			const pr = [1, 1.25, 1.5, 2][Math.floor(r() * 4)]
			const g = gridLines(cam, w, h, pr)
			assert.ok(g.xs.length <= Math.floor(w / 10) + 1, `xs ${g.xs.length} for width ${w}`)
			assert.ok(g.ys.length <= Math.floor(h / 10) + 1, `ys ${g.ys.length} for height ${h}`)
			for (const l of [g.xs, g.ys]) {
				for (let k = 1; k < l.length; k++) assert.ok(l[k].at > l[k - 1].at)
			}
		}
	})
})

describe('AK8 (c): paintGrid', () => {
	test('clear, the minor lines (x, then y), then the major lines (x, then y)', () => {
		const ctx = recorder()
		paintGrid(ctx, gridLines({ x: -15, y: 0, scale: 1 }, 100, 50, 1), 100, 50)
		assert.deepEqual(ctx.calls, [
			['clearRect', 0, 0, 100, 50],
			['fillStyle', GRID_MINOR_COLOR],
			['fillRect', 35, 0, 1, 50], ['fillRect', 55, 0, 1, 50], ['fillRect', 75, 0, 1, 50], ['fillRect', 95, 0, 1, 50],
			['fillRect', 0, 20, 100, 1], ['fillRect', 0, 40, 100, 1],
			['fillStyle', GRID_MAJOR_COLOR],
			['fillRect', 15, 0, 1, 50], ['fillRect', 0, 0, 100, 1],
		])
	})

	test('pr 2 (lw 2): every rectangle starts at at − 1 and is 2 wide or high', () => {
		const ctx = recorder()
		const lines = gridLines({ x: -15, y: 0, scale: 1 }, 100, 50, 2)
		paintGrid(ctx, lines, 200, 100)
		const rects = ctx.calls.filter((c) => c[0] === 'fillRect')
		assert.equal(rects.length, lines.xs.length + lines.ys.length)
		const vertical = rects.filter((c) => c[2] === 0 && c[4] === 100)
		const horizontal = rects.filter((c) => c[1] === 0 && c[3] === 200)
		assert.deepEqual(vertical.map((c) => [c[1], c[3]]).sort((a, b) => a[0] - b[0]), lines.xs.map((x) => [x.at - 1, 2]))
		assert.deepEqual(horizontal.map((c) => [c[2], c[4]]).sort((a, b) => a[0] - b[0]), lines.ys.map((y) => [y.at - 1, 2]))
	})

	test('lines null: only clearRect', () => {
		const ctx = recorder()
		paintGrid(ctx, null, 100, 50)
		assert.deepEqual(ctx.calls, [['clearRect', 0, 0, 100, 50]])
	})
})
