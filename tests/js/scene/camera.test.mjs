/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/scene/Camera.js (SPEC-M0 §6.3, §9.3): zoomAt keeps the point fixed, fit
 * incl. the empty board, clamping, cssTransformFor = formula of §6.3 with the
 * cross-check screen1 = k·screen0 + (c0 − c1)·s1.
 *
 * M2 overscan and coverage rule (SPEC-M1 §6.3 "Überstand und Deckungsregel",
 * job 034 AK1–AK5): the margin table of overscanFor (budget, area, 64-px
 * floor, maximality), overscanLayout/overscanResize (kept and re-centred or
 * reallocated, rounding of an odd difference), the coverage test with its
 * edge cases (pan by M + 1, the zoom-out bound w/(w + 2M), zoom-in around
 * inner points, the 1-px tolerance, an asymmetric kept stage), the stage and
 * cull rectangles, and gestureRedrawFrames on the lab's CSS-path camera paths
 * computed with the real cssTransformFor, zoomCamera and glideCamera.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
	COVER_TOL_PX, Camera, FIT_MAX_SCALE, GESTURE_K_MAX, OVERSCAN_AREA_FACTOR, OVERSCAN_DEVICE_PX, OVERSCAN_MAX_PX, OVERSCAN_MIN_PX,
	clampScale, cssTransformFor, cullRectOf, gestureRedrawFrames, needsGestureRedraw, overscanFor, overscanLayout, overscanResize,
	stageCovers, stageRectOf, viewRectOf, zoomCamera,
} from '../../../src/scene/Camera.js'
import { glideCamera } from '../../../src/scene/SceneManager.js'
import { MAX_SCALE, MIN_SCALE } from '../../../src/model/tokens.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`)

describe('Camera basics', () => {
	test('screen ↔ world are inverse', () => {
		const c = new Camera()
		c.set(120, -40, 0.5)
		const w = c.screenToWorld(300, 200)
		assert.deepEqual(w, { x: 720, y: 360 })
		assert.deepEqual(c.worldToScreen(w.x, w.y), { x: 300, y: 200 })
	})

	test('set clamps the scale and ignores non-finite values', () => {
		const c = new Camera()
		assert.equal(c.set(0, 0, 100).scale, MAX_SCALE)
		assert.equal(c.set(0, 0, 0.0001).scale, MIN_SCALE)
		c.set(5, 6, 1)
		assert.deepEqual(c.set(NaN, Infinity, -1), { x: 5, y: 6, scale: 1 })
		assert.equal(clampScale(0.01), MIN_SCALE)
		assert.equal(clampScale(2), 2)
		const narrow = new Camera({ minScale: 0.5, maxScale: 2 })
		assert.equal(narrow.set(0, 0, 3).scale, 2)
	})

	test('get returns a copy', () => {
		const c = new Camera()
		const g = c.get()
		g.x = 99
		assert.equal(c.x, 0)
	})
})

describe('zoomAt', () => {
	test('the world point under the anchor stays fixed', () => {
		const c = new Camera()
		c.set(-200, 100, 0.8)
		for (const [sx, sy, f] of [[0, 0, 2], [400, 300, 0.5], [960, 540, Math.exp(0.09)], [17, 900, 1.3]]) {
			const before = c.screenToWorld(sx, sy)
			const n = c.zoomAt(sx, sy, f)
			near((sx / n.scale) + n.x, before.x)
			near((sy / n.scale) + n.y, before.y)
			assert.equal(c.scale, 0.8, 'zoomAt does not change the camera')
		}
	})

	test('clamped zoom still keeps the anchor fixed', () => {
		const n = zoomCamera({ x: 0, y: 0, scale: 3 }, 100, 100, 10)
		assert.equal(n.scale, MAX_SCALE)
		near(n.x + 100 / n.scale, 0 + 100 / 3)
		assert.deepEqual(zoomCamera({ x: 1, y: 2, scale: 1 }, 0, 0, -1), { x: 1, y: 2, scale: 1 })
	})
})

describe('fit', () => {
	test('empty board: world origin centred at 100 %', () => {
		const c = new Camera()
		assert.deepEqual(c.fit(null, 1920, 1080), { x: -960, y: -540, scale: 1 })
	})

	test('rect is centred with padding; never above 100 %', () => {
		const c = new Camera()
		const f = c.fit({ x: 0, y: 0, w: 10000, h: 5000 }, 1920, 1080, 48)
		near(f.scale, Math.min((1920 - 96) / 10000, (1080 - 96) / 5000))
		near(f.x + 1920 / (2 * f.scale), 5000)
		near(f.y + 1080 / (2 * f.scale), 2500)
		const small = c.fit({ x: 10, y: 10, w: 200, h: 200 }, 1920, 1080)
		assert.equal(small.scale, FIT_MAX_SCALE)
		near(small.x + 960, 110)
		const huge = c.fit({ x: 0, y: 0, w: 1e7, h: 1e7 }, 1920, 1080)
		assert.equal(huge.scale, MIN_SCALE)
	})

	test('degenerate rects and viewports do not produce NaN', () => {
		const c = new Camera()
		const line = c.fit({ x: 0, y: 0, w: 0, h: 100 }, 800, 600)
		assert.ok(Number.isFinite(line.x) && Number.isFinite(line.scale))
		const zero = c.fit({ x: 0, y: 0, w: 100, h: 100 }, 0, 0)
		assert.deepEqual(zero, { x: -0, y: -0, scale: 1 })
	})
})

describe('cssTransformFor', () => {
	test('formula of §6.3', () => {
		const c0 = { x: 100, y: 50, scale: 0.5 }
		const c1 = { x: 80, y: 70, scale: 0.75 }
		const t = cssTransformFor(c0, c1)
		near(t.k, 1.5)
		near(t.tx, (100 - 80) * 0.75)
		near(t.ty, (50 - 70) * 0.75)
	})

	test('cross-check: screen1 = k·screen0 + (c0 − c1)·s1 for random worlds', () => {
		const c0 = { x: -321.5, y: 812.25, scale: 0.37 }
		const c1 = zoomCamera(c0, 640, 360, 1.57)
		c1.x += 42
		c1.y -= 17
		const { k, tx, ty } = cssTransformFor(c0, c1)
		for (const [wx, wy] of [[0, 0], [1000, -500], [-321.5, 812.25], [77.7, 4242]]) {
			const s0x = (wx - c0.x) * c0.scale
			const s0y = (wy - c0.y) * c0.scale
			const s1x = (wx - c1.x) * c1.scale
			const s1y = (wy - c1.y) * c1.scale
			near(k * s0x + tx, s1x, 1e-6)
			near(k * s0y + ty, s1y, 1e-6)
		}
	})

	test('identity for equal cameras', () => {
		const c = { x: 5, y: 6, scale: 2 }
		assert.deepEqual(cssTransformFor(c, c), { k: 1, tx: 0, ty: 0 })
	})
})

describe('viewRect', () => {
	test('viewport in world units plus 10 % margin', () => {
		const c = new Camera()
		c.set(100, 200, 2)
		assert.deepEqual(c.viewRect(800, 600), { minX: 60, minY: 170, maxX: 540, maxY: 530 })
		assert.deepEqual(viewRectOf({ x: 0, y: 0, scale: 1 }, 100, 50, 0), { minX: 0, minY: 0, maxX: 100, maxY: 50 })
	})
})

// ---------------------------------------------------------------- M2 overscan (job 034)

/** Reference rows of the spec (§2): viewport, pr, M. */
const MARGINS = [
	[1920, 1080, 1, 384], [1920, 1080, 2, 141], [1366, 1024, 1, 384], [1366, 1024, 2, 272], [1024, 1366, 2, 272],
	[390, 844, 1, 201], [390, 844, 2, 201], [1280, 800, 2, 354], [1440, 900, 1, 384], [820, 1180, 1, 356],
	[2240, 1260, 2, 0], [2560, 1440, 2, 0],
]
/** @return {boolean} a stage of margin m keeps both budgets */
const fits = (w, h, pr, m) => (w + 2 * m) * (h + 2 * m) * pr * pr <= OVERSCAN_DEVICE_PX && (w + 2 * m) * (h + 2 * m) <= OVERSCAN_AREA_FACTOR * w * h
const W = 1920
const H = 1080
const OV384 = overscanLayout(W, H, 1)
const OV0 = { l: 0, r: 0, t: 0, b: 0, stageW: W, stageH: H }
const C0 = { x: 0, y: 0, scale: 1 }
/** @return {object} the transform of a pure pan by (dx, dy) screen px from C0 */
const panBy = (dx, dy) => cssTransformFor(C0, { x: -dx, y: -dy, scale: 1 })

describe('overscanFor (AK1)', () => {
	test('the constants of the spec', () => {
		assert.deepEqual([OVERSCAN_MAX_PX, OVERSCAN_MIN_PX, OVERSCAN_DEVICE_PX, OVERSCAN_AREA_FACTOR, GESTURE_K_MAX, COVER_TOL_PX], [384, 64, 12000000, 3, 2, 1])
	})

	for (const [w, h, pr, M] of MARGINS) {
		test(`${w} × ${h} @${pr}: M = ${M}, within budget, maximal`, () => {
			assert.equal(overscanFor(w, h, pr), M)
			assert.ok(M === 0 || (M >= OVERSCAN_MIN_PX && M <= OVERSCAN_MAX_PX), `M ${M} in {0} ∪ [64, 384]`)
			if (M > 0) {
				assert.ok(fits(w, h, pr, M), 'stage · pr² ≤ 12 M and ≤ 3 × the viewport area')
				if (M < OVERSCAN_MAX_PX) assert.ok(!fits(w, h, pr, M + 1), 'M + 1 breaks a bound')
			} else {
				// the largest admissible whole M is below 64 (or there is none at all)
				let best = -1
				for (let m = 0; m <= OVERSCAN_MAX_PX; m++) if (fits(w, h, pr, m)) best = m
				assert.ok(best < OVERSCAN_MIN_PX, `largest admissible M ${best}`)
			}
		})
	}

	test('the rows without a margin: 2240 × 1260 @2 has a raw 25 px, 2560 × 1440 @2 none at all', () => {
		assert.ok(fits(2240, 1260, 2, 25) && !fits(2240, 1260, 2, 26))
		assert.ok(!fits(2560, 1440, 2, 0))
	})

	test('invalid viewports give 0; a pixel ratio ≤ 0 or not finite counts as 1', () => {
		assert.equal(overscanFor(0, 800, 1), 0)
		assert.equal(overscanFor(Number.NaN, 800, 1), 0)
		assert.equal(overscanFor(-5, 800, 1), 0)
		assert.equal(overscanFor(1920, Infinity, 1), 0)
		assert.equal(overscanFor(1920, 1080, 0), overscanFor(1920, 1080, 1))
		assert.equal(overscanFor(1920, 1080, Number.NaN), 384)
		assert.equal(overscanFor(1920, 1080, -2), 384)
	})
})

describe('overscanLayout and overscanResize (AK2)', () => {
	test('layout of 1920 × 1080 @1', () => {
		assert.deepEqual(overscanLayout(1920, 1080, 1), { l: 384, r: 384, t: 384, b: 384, stageW: 2688, stageH: 1848 })
		assert.deepEqual(overscanLayout(2560, 1440, 2), { l: 0, r: 0, t: 0, b: 0, stageW: 2560, stageH: 1440 })
	})

	const st = (stageW, stageH) => ({ l: 0, r: 0, t: 0, b: 0, stageW, stageH })
	for (const [prev, w, h, pr, want] of [
		[st(2688, 1848), 1920, 1000, 1, { l: 384, r: 384, t: 424, b: 424, stageW: 2688, stageH: 1848, kept: true }],
		[st(2688, 1848), 1920, 1100, 1, { l: 384, r: 384, t: 374, b: 374, stageW: 2688, stageH: 1848, kept: true }],
		[st(2688, 1848), 1080, 1920, 1, { l: 384, r: 384, t: 384, b: 384, stageW: 1848, stageH: 2688, kept: false }],
		[st(1910, 1568), 1366, 954, 2, { l: 272, r: 272, t: 307, b: 307, stageW: 1910, stageH: 1568, kept: true }],
		[st(1910, 1568), 1024, 1366, 2, { l: 272, r: 272, t: 272, b: 272, stageW: 1568, stageH: 1910, kept: false }],
		[st(2688, 1848), 2560, 1440, 2, { l: 0, r: 0, t: 0, b: 0, stageW: 2560, stageH: 1440, kept: false }],
	]) {
		test(`${prev.stageW} × ${prev.stageH} → ${w} × ${h} @${pr}: ${want.kept ? 'kept' : 'new'}`, () => {
			assert.deepEqual(overscanResize(prev, w, h, pr), want)
		})
	}

	test('an odd difference gives the left and top side the rounded-down half', () => {
		assert.deepEqual(overscanResize(st(2688, 1848), 1919, 999, 1), { l: 384, r: 385, t: 424, b: 425, stageW: 2688, stageH: 1848, kept: true })
	})

	test('kept needs 0.75 · M per side and both budgets', () => {
		// 0.75 · 384 = 288: a side of 287 reallocates, 288 keeps
		assert.equal(overscanResize(st(1920 + 576, 1848), 1920, 1080, 1).kept, true)
		assert.equal(overscanResize(st(1920 + 574, 1848), 1920, 1080, 1).kept, false)
		// a stage above 3 × the new viewport area is laid out anew
		assert.equal(overscanResize(st(2688, 1848), 1280, 1080, 1).kept, false)
	})

	test('without a valid previous stage: the layout, kept false', () => {
		for (const prev of [null, undefined, {}, { stageW: Number.NaN, stageH: 10 }, { stageW: -1, stageH: 10 }]) {
			assert.deepEqual(overscanResize(prev, 1920, 1080, 1), { ...overscanLayout(1920, 1080, 1), kept: false })
		}
		// a stage mounted at 0 × 0 is reallocated
		assert.deepEqual(overscanResize(st(0, 0), 1920, 1080, 1), { ...OV384, kept: false })
	})
})

describe('coverage rule (AK3)', () => {
	for (const [name, ov, M] of [['M = 384', OV384, 384], ['M = 0', OV0, 0]]) {
		test(`${name}: rest is covered`, () => {
			assert.equal(stageCovers({ k: 1, tx: 0, ty: 0 }, W, H, ov), true)
			assert.equal(needsGestureRedraw({ k: 1, tx: 0, ty: 0 }, W, H, ov), false)
		})

		test(`${name}: a pan by M + 1 px is covered at every edge, by M + 1.01 not`, () => {
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				assert.equal(stageCovers(panBy(dx * (M + 1), dy * (M + 1)), W, H, ov), true, `${dx},${dy} by M + 1`)
				assert.equal(stageCovers(panBy(dx * (M + 1.01), dy * (M + 1.01)), W, H, ov), false, `${dx},${dy} by M + 1.01`)
				assert.equal(needsGestureRedraw(panBy(dx * (M + 1.01), dy * (M + 1.01)), W, H, ov), true)
			}
		})

		test(`${name}: zoom-in around inner points up to k 2 never redraws, k 2.01 does`, () => {
			for (const [px, py] of [[0, 0], [100, 900], [960, 540], [1920, 1080]]) {
				for (const k of [1.5, 2]) {
					const t = cssTransformFor(C0, zoomCamera(C0, px, py, k))
					assert.equal(stageCovers(t, W, H, ov), true, `(${px}, ${py}) k ${k}`)
					assert.equal(needsGestureRedraw(t, W, H, ov), false)
				}
				assert.equal(needsGestureRedraw(cssTransformFor(C0, zoomCamera(C0, px, py, 2.01)), W, H, ov), true)
			}
		})
	}

	test('M = 384: centred zoom-out keeps the stage down to k = w/(w + 2M), and to the 1-px gap at (w − 2)/(w + 2M)', () => {
		const at = (k) => cssTransformFor(C0, zoomCamera(C0, W / 2, H / 2, k))
		assert.ok(Math.abs(W / (W + 2 * 384) - 0.7143) < 1e-4)
		assert.equal(stageCovers(at(W / (W + 768)), W, H, OV384), true)
		assert.equal(stageCovers(at((W - 2) / (W + 768)), W, H, OV384), true, 'gap exactly 1 px')
		assert.equal(stageCovers(at((W - 2.2) / (W + 768)), W, H, OV384), false)
		assert.equal(needsGestureRedraw(at((W - 2.2) / (W + 768)), W, H, OV384), true)
	})

	test('a non-finite transform or k ≤ 0 redraws', () => {
		for (const t of [{ k: Number.NaN, tx: 0, ty: 0 }, { k: 1, tx: Infinity, ty: 0 }, { k: 1, tx: 0, ty: Number.NaN }, { k: 0, tx: 0, ty: 0 }, { k: -1, tx: 0, ty: 0 }]) {
			assert.equal(needsGestureRedraw(t, W, H, OV384), true, JSON.stringify(t))
		}
		assert.equal(stageCovers({ k: 1, tx: Number.NaN, ty: 0 }, W, H, OV384), false)
	})

	test('the tolerance is a parameter; null means no overscan', () => {
		assert.equal(stageCovers(panBy(3, 0), W, H, OV0, 3), true)
		assert.equal(stageCovers(panBy(3.5, 0), W, H, OV0, 3), false)
		assert.equal(stageCovers(panBy(1, 0), W, H, null), true)
		assert.equal(stageCovers(panBy(1.5, 0), W, H, null), false)
	})

	test('an asymmetric (kept) stage counts every side with its own value', () => {
		const ov = { l: 384, r: 385, t: 424, b: 425, stageW: 2688, stageH: 1848 }
		assert.equal(stageCovers(panBy(385, 0), W, 999, ov), true)
		assert.equal(stageCovers(panBy(386, 0), W, 999, ov), false)
		assert.equal(stageCovers(panBy(-386, 0), W, 999, ov), true, 'right side 385')
		assert.equal(stageCovers(panBy(-387, 0), W, 999, ov), false)
		assert.equal(stageCovers(panBy(0, 425), W, 999, ov), true, 'top side 424')
		assert.equal(stageCovers(panBy(0, 426), W, 999, ov), false)
		assert.equal(stageCovers(panBy(0, -426), W, 999, ov), true, 'bottom side 425')
		assert.equal(stageCovers(panBy(0, -427), W, 999, ov), false)
	})
})

describe('stage and cull rectangles (AK4)', () => {
	test('stageRectOf maps viewport and sides at scale 0.5 into world units', () => {
		const ov = { l: 384, r: 300, t: 200, b: 100, stageW: 2604, stageH: 1380 }
		assert.deepEqual(stageRectOf({ x: 100, y: 50, scale: 0.5 }, W, H, ov), { minX: -668, minY: -350, maxX: 4540, maxY: 2410 })
		assert.deepEqual(stageRectOf({ x: 100, y: 50, scale: 0.5 }, W, H, null), { minX: 100, minY: 50, maxX: 3940, maxY: 2210 })
	})

	test('cullRectOf takes max(overscan, 10 %) per side', () => {
		assert.deepEqual(cullRectOf(C0, W, H, OV384, 0.1), { minX: -384, minY: -384, maxX: 2304, maxY: 1464 })
		const ov2 = overscanLayout(W, H, 2)
		assert.equal(ov2.l, 141)
		assert.deepEqual(cullRectOf(C0, W, H, ov2, 0.1), { minX: -192, minY: -141, maxX: 2112, maxY: 1221 })
		assert.deepEqual(cullRectOf({ x: 10, y: 20, scale: 2 }, W, H, OV384), { minX: 10 - 192, minY: 20 - 192, maxX: 10 + 960 + 192, maxY: 20 + 540 + 192 })
	})

	test('without an overscan (null or 0) it is exactly viewRectOf(…, 0.1)', () => {
		for (const cam of [C0, { x: -321.5, y: 812.25, scale: 0.37 }, { x: 7, y: 9, scale: 3.3 }]) {
			assert.deepEqual(cullRectOf(cam, W, H, null, 0.1), viewRectOf(cam, W, H, 0.1))
			assert.deepEqual(cullRectOf(cam, W, H, OV0, 0.1), viewRectOf(cam, W, H, 0.1))
			assert.deepEqual(cullRectOf(cam, W, H, undefined), viewRectOf(cam, W, H, 0.1))
		}
	})
})

describe('the lab paths and their redraws (AK5)', () => {
	/** @return {object[]} live cameras of a one-finger pan whose finger moves by (fx(i), fy(i)) screen px */
	const fingerPan = (c0, n, fx, fy) => Array.from({ length: n }, (_, j) => {
		const i = j + 1
		return { x: c0.x + fx(i) / c0.scale, y: c0.y + fy(i) / c0.scale, scale: c0.scale }
	})
	const none = (c0, cams, ov = OV384) => assert.deepEqual(gestureRedrawFrames(c0, cams, W, H, ov), [])

	test('G16: 6 px per frame up to 366/122 (at the G16 scale)', () => {
		const c0 = { x: -400, y: 12000, scale: 0.2253 }
		const cams = fingerPan(c0, 60, (i) => 6 * (i + 1), (i) => -2 * (i + 1))
		assert.ok(Math.abs((cams.at(-1).x - c0.x) * c0.scale - 366) < 1e-9)
		none(c0, cams)
	})

	test('touchPanSeries: 4 px per frame up to 368/184; Touch 300 px', () => {
		none(C0, fingerPan(C0, 90, (i) => 4 * (i + 2), (i) => -2 * (i + 2)))
		none(C0, fingerPan(C0, 10, (i) => 30 * i, () => 0))
	})

	test('Gestenpfad Wheel: 5 × exp(0.09) around a point in the view', () => {
		const cams = []
		let c = C0
		for (let i = 0; i < 5; i++) {
			c = zoomCamera(c, 700, 400, Math.exp(0.09))
			cams.push(c)
		}
		none(C0, cams)
	})

	test('pinch → lift → pan: k 1.6 around the centre, then 180 px', () => {
		const cams = []
		for (let i = 1; i <= 6; i++) cams.push(zoomCamera(C0, W / 2, H / 2, (200 + 20 * i) / 200))
		const p = cams.at(-1)
		for (let i = 1; i <= 6; i++) cams.push({ x: p.x + (30 * i) / p.scale, y: p.y, scale: p.scale })
		assert.ok(Math.abs(p.scale - 1.6) < 1e-12)
		none(C0, cams)
	})

	test('G15: the glide to +300/+150 at scale 1.2 needs no margin at all', () => {
		const target = { x: 300, y: 150, scale: 1.2 }
		const cams = Array.from({ length: 100 }, (_, i) => glideCamera(C0, target, (i + 1) / 100, W, H))
		none(C0, cams)
		none(C0, cams, OV0)
	})

	test('Folgen (2): a glide replaced at u 0.1/0.2/0.3 by one to −200/+200 at 0.9 needs at most 320 px', () => {
		const T1 = { x: 400, y: 0, scale: 1 }
		const T2 = { x: -200, y: 200, scale: 0.9 }
		for (const stop of [0.1, 0.2, 0.3]) {
			const cams = []
			for (let u = 0.02; u < stop + 1e-9; u += 0.02) cams.push(glideCamera(C0, T1, u, W, H))
			const from = cams.at(-1)
			for (let i = 1; i <= 19; i++) cams.push(glideCamera(from, T2, i / 19, W, H))
			none(C0, cams)
			none(C0, cams, { l: 320, r: 320, t: 320, b: 320, stageW: W + 640, stageH: H + 640 })
		}
	})

	test('a straight pan of 12 px per frame redraws every 33rd frame: 50 → [32], 125 → [32, 65, 98]', () => {
		const pan = (n) => fingerPan(C0, n, (i) => 12 * i, () => 0)
		assert.deepEqual(gestureRedrawFrames(C0, pan(50), W, H, OV384), [32])
		assert.deepEqual(gestureRedrawFrames(C0, pan(125), W, H, OV384), [32, 65, 98])
		// without a margin every frame redraws (the direct-path cost)
		assert.equal(gestureRedrawFrames(C0, pan(50), W, H, OV0).length, 50)
	})

	test('a centred pinch-out from 500 to 300 in 30 linear steps redraws exactly once', () => {
		const cams = Array.from({ length: 30 }, (_, i) => zoomCamera(C0, W / 2, H / 2, (500 - (200 * (i + 1)) / 30) / 500))
		const frames = gestureRedrawFrames(C0, cams, W, H, OV384)
		assert.equal(frames.length, 1)
		assert.ok(cams[frames[0]].scale < (W - 2) / (W + 768) && cams[frames[0] - 1].scale >= (W - 2) / (W + 768), `frame ${frames[0]}`)
	})
})
