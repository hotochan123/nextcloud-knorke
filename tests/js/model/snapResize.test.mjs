/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/snap.js snapResize (M2, SPEC-M1 §1.2 (R12), job 015), pure:
 * the raw pointer offset of a resize handle snapped so that a moving edge
 * of the resized frame lands on a candidate line.
 * - AK1: the dragged right edge snaps to a candidate's left edge; a smaller
 *   tol does not snap
 * - AK2 (free): both axes of a corner (guides x, y), the inclusive tol,
 *   Alt (the opposite edge moves too: nearer wins, a tie the dragged edge),
 *   axes 'x', the raw cases
 * - AK3 (ratio): one common factor, x wins a tie, the pointer moves along
 *   the ratio diagonal, at most one guide
 * - AK4: a snap the min/max clamp would cut does not apply (never smaller
 *   than min, larger than max, mirrored)
 * - the promise to the caller over seeded cases: resizeFrame with the
 *   returned offset puts every guide on a moving edge (within 0.01)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SAME_LINE, buildSnapIndex, snapResize } from '../../../src/model/snap.js'
import { resizeFrame } from '../../../src/model/transform.js'

/** @return {object} the index of the candidate boxes {minX, minY, maxX, maxY} */
const idx = (...boxes) => buildSnapIndex(boxes)
/** A candidate far away on the y axis (only its x lines can snap). */
const xOnly = (minX, maxX) => ({ minX, minY: 5000, maxX, maxY: 5100 })
/** A candidate far away on the x axis (only its y lines can snap). */
const yOnly = (minY, maxY) => ({ minX: 5000, minY, maxX: 5100, maxY })
const SQ = Object.freeze({ x: 0, y: 0, w: 100, h: 100, r: 0 })
const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`)
/** @return {object} x, y, w, h of a frame */
const xywh = (f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })

describe('snapResize: AK1', () => {
	test('the right edge (raw 195) snaps to the left edge of the candidate at 200; with tol 4 it stays raw', () => {
		const index = idx({ minX: 200, minY: 300, maxX: 300, maxY: 400 })
		assert.deepEqual(snapResize(SQ, 'r', 95, 0, {}, index, 8), { dx: 100, dy: 0, guides: [{ axis: 'x', at: 200, from: 0, to: 400 }] })
		assert.deepEqual(snapResize(SQ, 'r', 95, 0, {}, index, 4), { dx: 95, dy: 0, guides: [] })
	})
})

describe('snapResize: AK2 free mode', () => {
	test('(a) corner br without a ratio snaps both axes, guides x then y', () => {
		const r = snapResize(SQ, 'br', 97, 95, {}, idx({ minX: 200, minY: 200, maxX: 300, maxY: 300 }), 8)
		assert.deepEqual(r, {
			dx: 100, dy: 100,
			guides: [{ axis: 'x', at: 200, from: 0, to: 300 }, { axis: 'y', at: 200, from: 0, to: 300 }],
		})
		assert.deepEqual(xywh(resizeFrame(SQ, 'br', r.dx, r.dy)), { x: 0, y: 0, w: 200, h: 200 })
	})

	// [name, anchor, dx, dy, candidates, expected dx, expected dy, expected guides (axis/at)]
	const cases = [
		['(b) a distance of exactly tol snaps', 'r', 92, 0, [xOnly(200, 300)], 100, 0, [['x', 200]]],
		['(b) tol + 0.01 does not', 'r', 91.99, 0, [xOnly(200, 300)], 91.99, 0, []],
		['(b) the same on y (b): exactly tol', 'b', 0, 92, [yOnly(200, 300)], 0, 100, [['y', 200]]],
		['(b) the same on y (b): tol + 0.01', 'b', 0, 91.99, [yOnly(200, 300)], 0, 91.99, []],
		['the left handle moves the left edge (−20 → −24)', 'l', -20, 0, [xOnly(-124, -24)], -24, 0, [['x', -24]]],
		['the top handle moves the top edge (−20 → −17)', 't', 0, -20, [yOnly(-17, 50)], 0, -17, [['y', -17]]],
		['an edge handle has no side on the other axis', 'r', 50, 3, [cand(150, 0, 300, 103)], 50, 3, [['x', 150]]],
		['a centre line of a candidate is a target', 'r', 45, 0, [xOnly(50, 250)], 50, 0, [['x', 150]]],
		['the nearest line wins (2 before 5)', 'r', 95, 0, [xOnly(193, 400), xOnly(200, 401)], 93, 0, [['x', 193]]],
		['one edge between two lines at the same distance: the smaller one', 'r', 100, 0, [xOnly(0, 197), xOnly(203, 600)], 97, 0, [['x', 197]]],
		['tl without a ratio: both dragged edges (left, top)', 'tl', -10, 10, [cand(-112, 13, -12, 40)], -12, 13, [['x', -12], ['y', 13]]],
	]
	function cand(minX, minY, maxX, maxY) {
		return { minX, minY, maxX, maxY }
	}
	for (const [name, anchor, dx, dy, cands, ex, ey, eg] of cases) {
		test(name, () => {
			const r = snapResize(SQ, anchor, dx, dy, {}, buildSnapIndex(cands), 8)
			assert.equal(r.dx, ex)
			assert.equal(r.dy, ey)
			assert.deepEqual(r.guides.map((g) => [g.axis, g.at]), eg)
		})
	}

	test('(c) Alt: the dragged edge wins with the smaller distance, the opposite one when it is nearer, the dragged one on a tie', () => {
		const G = { x: 100, y: 0, w: 100, h: 100, r: 0 }
		const right = { minX: 212, minY: 500, maxX: 312, maxY: 600 }
		const opts = { centered: true }
		// dragged right edge 210 → 212 (2), opposite left edge 90 → 87 (3)
		let r = snapResize(G, 'r', 10, 0, opts, idx(right, { minX: -13, minY: 500, maxX: 87, maxY: 600 }), 8)
		assert.equal(r.dx, 12)
		assert.deepEqual(r.guides.map((g) => g.at), [212])
		assert.deepEqual(xywh(resizeFrame(G, 'r', r.dx, r.dy, opts)), { x: 88, y: 0, w: 124, h: 100 })
		// the opposite edge 90 → 89 (1) is nearer
		r = snapResize(G, 'r', 10, 0, opts, idx(right, { minX: -11, minY: 500, maxX: 89, maxY: 600 }), 8)
		assert.equal(r.dx, 11)
		assert.deepEqual(xywh(resizeFrame(G, 'r', r.dx, r.dy, opts)), { x: 89, y: 0, w: 122, h: 100 })
		assert.deepEqual(r.guides, [{ axis: 'x', at: 89, from: 0, to: 600 }])
		// both 2 away: the dragged edge
		r = snapResize(G, 'r', 10, 0, opts, idx(right, { minX: -12, minY: 500, maxX: 88, maxY: 600 }), 8)
		assert.equal(r.dx, 12)
		assert.deepEqual(r.guides.map((g) => g.at), [212])
	})

	test('(c) Alt on y: the opposite (top) edge of the bottom handle snaps', () => {
		// lines −12, −6, 0: the top edge −10 is 2 from −12, the bottom edge 110 has none within 8
		const r = snapResize(SQ, 'b', 0, 10, { centered: true }, idx(yOnly(-12, 0)), 8)
		assert.equal(r.dy, 12)
		assert.deepEqual(xywh(resizeFrame(SQ, 'b', r.dx, r.dy, { centered: true })), { x: 0, y: -12, w: 100, h: 124 })
		assert.deepEqual(r.guides.map((g) => [g.axis, g.at]), [['y', -12]])
	})

	test("(d) axes 'x' leaves out a near y line (free and ratio)", () => {
		const index = idx(yOnly(200, 300))
		assert.deepEqual(snapResize(SQ, 'br', 50, 95, { axes: 'x' }, index, 8), { dx: 50, dy: 95, guides: [] })
		// the same without axes: the y line snaps (proof)
		assert.equal(snapResize(SQ, 'br', 50, 95, {}, index, 8).dy, 100)
		const R = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		const yLine = idx(yOnly(150, 250))
		assert.deepEqual(snapResize(R, 'br', 96, 48, { keepRatio: true, axes: 'x' }, yLine, 8), { dx: 96, dy: 48, guides: [] })
		assert.equal(snapResize(R, 'br', 96, 48, { keepRatio: true }, yLine, 8).guides.length, 1)
	})

	test('(e) the raw offset without guides: r 30, rot, no index, an empty index, tol NaN or −1, dx Infinity', () => {
		const index = idx(xOnly(200, 300))
		// the same call snaps (proof that the index is not empty)
		assert.equal(snapResize(SQ, 'r', 95, 0, {}, index, 8).dx, 100)
		assert.deepEqual(snapResize({ ...SQ, r: 30 }, 'r', 95, 0, {}, index, 8), { dx: 95, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'rot', 95, 0, {}, index, 8), { dx: 95, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'r', 95, 0, {}, null, 8), { dx: 95, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'r', 95, 0, {}, idx(), 8), { dx: 95, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'r', 95, 0, {}, index, NaN), { dx: 95, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'r', 95, 0, {}, index, -1), { dx: 95, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'r', Infinity, 0, {}, index, 8), { dx: Infinity, dy: 0, guides: [] })
		assert.deepEqual(snapResize(SQ, 'r', 95, NaN, {}, index, 8).guides, [])
		assert.deepEqual(snapResize(null, 'r', 95, 0, {}, index, 8), { dx: 95, dy: 0, guides: [] })
	})
})

describe('snapResize: AK3 ratio mode', () => {
	const R = Object.freeze({ x: 0, y: 0, w: 200, h: 100, r: 0 })
	const opts = { keepRatio: true }

	test('(a) x and y both 3 away (k = 1.48, edges 296 and 148): x wins, the pointer moves along the diagonal', () => {
		const r = snapResize(R, 'br', 96, 48, opts, idx({ minX: 299, minY: 400, maxX: 399, maxY: 500 }, { minX: 400, minY: 151, maxX: 500, maxY: 251 }), 8)
		close(r.dx, 99, 'dx')
		close(r.dy, 49.5, 'dy')
		assert.equal(r.guides.length, 1)
		const g = r.guides[0]
		assert.deepEqual([g.axis, g.at], ['x', 299])
		close(g.from, 0, 'from')
		close(g.to, 500, 'to')
		const f = resizeFrame(R, 'br', r.dx, r.dy, opts)
		close(f.x, 0)
		close(f.y, 0)
		close(f.w, 299, 'w')
		close(f.h, 149.5, 'h')
	})

	test('(b) y 2 away (150): y wins alone, no second guide', () => {
		const r = snapResize(R, 'br', 96, 48, opts, idx({ minX: 299, minY: 400, maxX: 399, maxY: 500 }, { minX: 400, minY: 150, maxX: 500, maxY: 250 }), 8)
		close(r.dx, 100, 'dx')
		close(r.dy, 50, 'dy')
		assert.equal(r.guides.length, 1)
		const g = r.guides[0]
		assert.deepEqual([g.axis, g.at], ['y', 150])
		close(g.from, 0, 'from')
		close(g.to, 500, 'to')
		const f = resizeFrame(R, 'br', r.dx, r.dy, opts)
		close(f.w, 300, 'w')
		close(f.h, 150, 'h')
	})

	test('the dragged edge before the opposite one on a tie (Alt), the opposite one when nearer', () => {
		// centered, br: edges at k = 1.48: right 100 + 148 = 248, left 100 − 148 = −48; y: 50 ± 74 (124, −24)
		const c = { keepRatio: true, centered: true }
		// both 3 away (251, −51)
		let r = snapResize(R, 'br', 48, 24, c, idx(xOnly(251, 260), xOnly(-61, -51)), 8)
		let f = resizeFrame(R, 'br', r.dx, r.dy, c)
		assert.deepEqual(r.guides.map((g) => g.at), [251])
		close(f.x + f.w, 251, 'right edge on 251')
		// the left edge 2 from −50, the right one 5 from 253
		r = snapResize(R, 'br', 48, 24, c, idx(xOnly(253, 260), xOnly(-60, -50)), 8)
		f = resizeFrame(R, 'br', r.dx, r.dy, c)
		assert.deepEqual(r.guides.map((g) => g.at), [-50])
		close(f.x, -50, 'left edge on −50')
		close(f.w / f.h, 2, 'ratio kept')
	})

	test('the top-left corner: the dragged edges are left and top', () => {
		// tl, raw (−96, −48): k = 1.48, left edge 200 − 296 = −96, top 100 − 148 = −48
		const r = snapResize(R, 'tl', -96, -48, opts, idx(xOnly(-100, -80)), 8)
		const f = resizeFrame(R, 'tl', r.dx, r.dy, opts)
		close(f.x, -100, 'left edge')
		close(f.x + f.w, 200, 'right edge fixed')
		close(f.y + f.h, 100, 'bottom edge fixed')
		assert.deepEqual(r.guides.map((g) => [g.axis, g.at]), [['x', -100]])
	})
})

describe('snapResize: AK4 the clamp and no mirroring', () => {
	test('(a) minimum size: a line at 22 below min 24 is not taken (w = 25 raw)', () => {
		const r = snapResize(SQ, 'r', -75, 0, { min: 24 }, idx({ minX: -78, minY: 300, maxX: 22, maxY: 400 }), 8)
		assert.deepEqual(r, { dx: -75, dy: 0, guides: [] })
		assert.equal(resizeFrame(SQ, 'r', r.dx, r.dy, { min: 24 }).w, 25)
	})

	test('(b) maximum size: a line at 152 above max 150 is not taken (w = 148 raw)', () => {
		const r = snapResize(SQ, 'r', 48, 0, { max: 150 }, idx({ minX: 152, minY: 300, maxX: 252, maxY: 400 }), 8)
		assert.deepEqual(r, { dx: 48, dy: 0, guides: [] })
		assert.equal(resizeFrame(SQ, 'r', r.dx, r.dy, { max: 150 }).w, 148)
	})

	test('(c) no mirroring: a right handle dragged past its left edge does not snap to a line beyond it', () => {
		const G = { x: 100, y: 0, w: 100, h: 100, r: 0 }
		const r = snapResize(G, 'r', -190, 0, { min: 10 }, idx({ minX: 12, minY: 300, maxX: 62, maxY: 400 }), 8)
		assert.deepEqual(r, { dx: -190, dy: 0, guides: [] })
		assert.deepEqual(xywh(resizeFrame(G, 'r', r.dx, r.dy, { min: 10 })), { x: 100, y: 0, w: 10, h: 100 })
	})

	test('free: only the cut axis keeps its raw offset, the other one snaps', () => {
		// br: x line at 22 below min 24 (cut), y line at 203 (snaps)
		const r = snapResize(SQ, 'br', -75, 97, { min: 24 }, idx({ minX: -78, minY: 203, maxX: 22, maxY: 303 }), 8)
		assert.equal(r.dx, -75)
		assert.equal(r.dy, 103)
		assert.deepEqual(r.guides.map((g) => [g.axis, g.at]), [['y', 203]])
		const f = resizeFrame(SQ, 'br', r.dx, r.dy, { min: 24 })
		assert.deepEqual([f.w, f.h], [25, 203])
		// the guide spans the frame as it ends up (x from 0 to 25) and the candidate
		assert.deepEqual([r.guides[0].from, r.guides[0].to], [-78, 25])
	})

	test('ratio: a snap below the minimum factor gives the raw offset entirely', () => {
		const R = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		// raw k = 0.52 (edges 104, 52); min 50 → k ≥ 0.5; the line at 98 needs k = 0.49
		const opts = { keepRatio: true, min: 50 }
		const r = snapResize(R, 'br', -96, -48, opts, idx(xOnly(90, 98)), 8)
		assert.deepEqual(r, { dx: -96, dy: -48, guides: [] })
	})
})

describe('snapResize: the promise to the caller (seeded)', () => {
	/** Deterministic PRNG (mulberry32, as in tests/js/model/zorder.test.mjs). */
	function prng(seed) {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6D2B79F5) >>> 0
			let t = a
			t = Math.imul(t ^ (t >>> 15), t | 1)
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}
	const ANCHORS = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l']
	const CORNERS = new Set(['tl', 'tr', 'br', 'bl'])
	const LEFT = new Set(['tl', 'l', 'bl'])
	const RIGHT = new Set(['tr', 'r', 'br'])
	const TOP = new Set(['tl', 't', 'tr'])
	const BOTTOM = new Set(['bl', 'b', 'br'])

	/** @return {number[]} the moving edges of the frame f on the axis */
	function moving(f, anchor, axis, centered) {
		const [lo, hi] = axis === 'x' ? [f.x, f.x + f.w] : [f.y, f.y + f.h]
		const [low, high] = axis === 'x' ? [LEFT, RIGHT] : [TOP, BOTTOM]
		if (low.has(anchor)) return centered ? [lo, hi] : [lo]
		if (high.has(anchor)) return centered ? [lo, hi] : [hi]
		return []
	}

	test('400 cases: the snapped frame keeps min/max, every guide lies on a moving edge, no guide = the raw offset', () => {
		const rnd = prng(0x15e5)
		const pick = (list) => list[Math.floor(rnd() * list.length)]
		let snapped = 0
		for (let n = 0; n < 400; n++) {
			const frame = { x: Math.round(rnd() * 400) - 200, y: Math.round(rnd() * 400) - 200, w: 20 + Math.round(rnd() * 300), h: 20 + Math.round(rnd() * 300), r: 0 }
			const anchor = pick(ANCHORS)
			const opts = { keepRatio: rnd() < 0.5, centered: rnd() < 0.3, min: 10, max: 600, axes: rnd() < 0.2 ? 'x' : 'xy' }
			const boxes = []
			for (let k = 0; k < 6; k++) {
				const x = Math.round(rnd() * 1200) - 600
				const y = Math.round(rnd() * 1200) - 600
				boxes.push({ minX: x, minY: y, maxX: x + 10 + Math.round(rnd() * 200), maxY: y + 10 + Math.round(rnd() * 200) })
			}
			const dx = Math.round((rnd() - 0.5) * 800 * 100) / 100
			const dy = Math.round((rnd() - 0.5) * 800 * 100) / 100
			const r = snapResize(frame, anchor, dx, dy, opts, buildSnapIndex(boxes), 8)
			const f = resizeFrame(frame, anchor, r.dx, r.dy, opts)
			const tag = JSON.stringify({ frame, anchor, opts, dx, dy, r })
			assert.ok(f.w >= 10 - 1e-9 && f.w <= 600 + 1e-9 && f.h >= 10 - 1e-9 && f.h <= 600 + 1e-9, tag)
			if (r.guides.length === 0) {
				assert.deepEqual([r.dx, r.dy], [dx, dy], tag)
				continue
			}
			snapped++
			// ratio mode: at most one guide
			assert.ok(r.guides.length <= (opts.keepRatio && CORNERS.has(anchor) ? 1 : 2), tag)
			for (const g of r.guides) {
				if (g.axis === 'y') assert.notEqual(opts.axes, 'x', tag)
				const edges = moving(f, anchor, g.axis, opts.centered)
				assert.ok(edges.some((e) => Math.abs(e - g.at) <= SAME_LINE + 1e-9), `${tag} edges ${edges}`)
			}
		}
		assert.ok(snapped >= 20, `only ${snapped} cases snapped`)
	})
})
