/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/snap.js with the background grid (M2, SPEC-M1 §1.2 (R12), job
 * 016), pure:
 * - AK1: gridLine; snapMove with grid: the left/top edge of the box on the
 *   grid without a candidate (also without an index), the item snap keeps
 *   the priority on its axis and its guide spans the final box; a grid that
 *   is 0, missing, NaN, negative or infinite changes nothing; no box or a
 *   non-finite shift stays raw
 * - AK2: snapResize with grid: free side and corner handles, the item
 *   priority, Alt (the opposite edge nearer, a tie: the dragged one), the
 *   ratio (the nearest edge over both axes), the clamp (raw), axes 'x', the
 *   raw cases (rotated, rot, non-finite) and the cases without a grid
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapIndex, gridLine, snapMove, snapResize } from '../../../src/model/snap.js'
import { resizeFrame } from '../../../src/model/transform.js'

/** @return {object} the index of the candidate boxes {minX, minY, maxX, maxY} */
const idx = (...boxes) => buildSnapIndex(boxes)
const none = buildSnapIndex([])
/** @return {object} candidate box */
const c = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY })
const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`)
/** Every value of a grid parameter that is no grid (AK1 (e), AK2 (i)). */
const NO_GRID = [0, undefined, NaN, -20, Infinity, -1]

describe('AK1: gridLine and snapMove with the grid', () => {
	test('(a) gridLine: the nearest line, the larger one at exactly half; v itself for a step 0 or NaN', () => {
		assert.equal(gridLine(133, 20), 140)
		assert.equal(gridLine(10, 20), 20)
		assert.ok(gridLine(-10, 20) === 0, 'the larger line 0 (−0 counts as 0)')
		assert.equal(gridLine(7, 0), 7)
		assert.equal(gridLine(7, NaN), 7)
		assert.equal(gridLine(7, -20), 7)
		assert.equal(gridLine(7, Infinity), 7)
	})

	test('(b) without candidates (an empty index or none at all) the left and top edge go to the grid', () => {
		const want = { dx: 40, dy: -20, guides: [], gaps: [] }
		assert.deepEqual(snapMove({ x: 0, y: 0, w: 100, h: 50 }, 47, -12, none, 8, 20), want)
		assert.deepEqual(snapMove({ x: 0, y: 0, w: 100, h: 50 }, 47, -12, null, 8, 20), want)
	})

	test('(c) a box beside the grid: its left and top edge land on 20', () => {
		assert.deepEqual(snapMove({ x: 5, y: 3, w: 100, h: 50 }, 20, 20, null, 8, 20), { dx: 15, dy: 17, guides: [], gaps: [] })
	})

	test('(d) priority per axis: x snaps to the item, y to the grid; the guide starts at the snapped box (from 40)', () => {
		assert.deepEqual(snapMove({ x: 0, y: 0, w: 100, h: 100 }, 98, 33, idx(c(203, 500, 303, 600)), 8, 20),
			{ dx: 103, dy: 40, guides: [{ axis: 'x', at: 203, from: 40, to: 600 }], gaps: [] })
		// without the grid the guide starts at the raw y (33)
		assert.deepEqual(snapMove({ x: 0, y: 0, w: 100, h: 100 }, 98, 33, idx(c(203, 500, 303, 600)), 8),
			{ dx: 103, dy: 33, guides: [{ axis: 'x', at: 203, from: 33, to: 600 }], gaps: [] })
	})

	test('(d) a gap snap keeps the priority too; the other axis goes to the grid', () => {
		// P and Q 60 apart, the box 63 right of Q: the gap snaps x to −80, y (top 20 + 17 = 37) to the grid (40)
		const r = snapMove({ x: 400, y: 20, w: 100, h: 100 }, -77, 17, idx(c(0, 0, 100, 100), c(160, 0, 260, 100)), 8, 20)
		assert.equal(r.dx, -80)
		assert.equal(r.dy, 20)
		assert.deepEqual(r.guides, [])
		assert.equal(r.gaps.length, 2)
	})

	test('(e) a grid of 0, undefined, NaN, −20 or Infinity changes nothing: (b) to (d) and samples of snapGaps', () => {
		const P = c(0, 0, 100, 100)
		const Q = c(160, 0, 260, 100)
		const BOX = { x: 400, y: 20, w: 100, h: 100 }
		const cases = [
			[{ x: 0, y: 0, w: 100, h: 50 }, 47, -12, none, 8],
			[{ x: 0, y: 0, w: 100, h: 50 }, 47, -12, null, 8],
			[{ x: 5, y: 3, w: 100, h: 50 }, 20, 20, null, 8],
			[{ x: 0, y: 0, w: 100, h: 100 }, 98, 33, idx(c(203, 500, 303, 600)), 8],
			// snapGaps.test.mjs AK1 and AK2
			[BOX, -77, 0, idx(P, Q), 8],
			[BOX, -77, 0, idx(P, Q), 2],
			[BOX, -563, 0, idx(P, Q), 8],
			[{ x: 20, y: 400, w: 100, h: 100 }, 0, -77, idx(c(0, 0, 100, 100), c(0, 160, 100, 260)), 8],
			[BOX, -77, 0, idx(P, Q, c(324, -300, 424, -200)), 8],
			[BOX, -77, 0, idx(P, Q, c(320, -300, 420, -200)), 8],
		]
		for (const [box, dx, dy, index, tol] of cases) {
			const plain = snapMove(box, dx, dy, index, tol)
			for (const g of NO_GRID) {
				assert.deepEqual(snapMove(box, dx, dy, index, tol, g), plain, `grid ${g}`)
			}
		}
	})

	test('(f) without a box or with a non-finite shift the raw shift, also with grid 20', () => {
		assert.deepEqual(snapMove(null, 47, -12, none, 8, 20), { dx: 47, dy: -12, guides: [], gaps: [] })
		assert.deepEqual(snapMove({ x: 0, y: 0, w: 100, h: 50 }, Infinity, -12, none, 8, 20), { dx: Infinity, dy: -12, guides: [], gaps: [] })
		assert.deepEqual(snapMove({ x: 0, y: 0, w: 100, h: 50 }, 3, NaN, null, 8, 20).dx, 3)
	})
})

const F = Object.freeze({ x: 0, y: 0, w: 100, h: 100, r: 0 })

describe('AK2: snapResize with the grid', () => {
	test('(a) free, side handle r: the right edge to 140; y has no side and stays raw', () => {
		assert.deepEqual(snapResize(F, 'r', 33, 7, {}, none, 8, 20), { dx: 40, dy: 7, guides: [] })
	})

	test('(b) free, corner br: both moving edges to the grid', () => {
		assert.deepEqual(snapResize(F, 'br', 33, 47, {}, none, 8, 20), { dx: 40, dy: 40, guides: [] })
		assert.deepEqual(snapResize(F, 'br', 33, 47, {}, null, 8, 20), { dx: 40, dy: 40, guides: [] })
	})

	test('(c) priority: the item line 136 within tol wins against the grid line 140', () => {
		assert.deepEqual(snapResize(F, 'r', 33, 0, {}, idx(c(136, 300, 236, 400)), 8, 20),
			{ dx: 36, dy: 0, guides: [{ axis: 'x', at: 136, from: 0, to: 400 }] })
	})

	test('(c) the guide of an item axis spans the final frame (the other axis on the grid)', () => {
		const r = snapResize(F, 'br', 33, 47, {}, idx(c(136, 300, 236, 400)), 8, 20)
		assert.deepEqual(r, { dx: 36, dy: 40, guides: [{ axis: 'x', at: 136, from: 0, to: 400 }] })
		const r2 = snapResize(F, 'br', 33, 47, {}, idx(c(136, -300, 236, -200)), 8, 20)
		assert.deepEqual(r2.guides, [{ axis: 'x', at: 136, from: -300, to: 140 }], 'to = the snapped bottom edge 140')
	})

	test('(d) Alt: the opposite edge is nearer (3 against 7), then a tie (7, 7) goes to the dragged edge', () => {
		const f = { x: 105, y: 0, w: 100, h: 100, r: 0 }
		const r = snapResize(f, 'r', 22, 0, { centered: true }, none, 8, 20)
		assert.equal(r.dx, 25)
		const g = resizeFrame(f, 'r', r.dx, r.dy, { centered: true })
		assert.equal(g.x, 80)
		assert.equal(g.w, 150)
		assert.equal(snapResize({ x: 100, y: 0, w: 100, h: 100, r: 0 }, 'r', 13, 0, { centered: true }, none, 8, 20).dx, 20)
	})

	test('(e) ratio: the nearest edge over both axes (x 4 before y 8; y 5 before x 10)', () => {
		const G = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		const a = snapResize(G, 'br', 96, 48, { keepRatio: true }, none, 8, 20)
		close(a.dx, 100, 'dx')
		close(a.dy, 50, 'dy')
		assert.deepEqual(a.guides, [])
		const fa = resizeFrame(G, 'br', a.dx, a.dy, { keepRatio: true })
		close(fa.w, 300, 'w')
		close(fa.h, 150, 'h')
		const b = snapResize(G, 'br', 90, 45, { keepRatio: true }, none, 8, 20)
		close(b.dx, 80, 'dx')
		close(b.dy, 40, 'dy')
		assert.deepEqual(b.guides, [])
		const fb = resizeFrame(G, 'br', b.dx, b.dy, { keepRatio: true })
		close(fb.w, 280, 'w')
		close(fb.h, 140, 'h')
	})

	test('(e) ratio: an item snap keeps the priority (its guide), the grid only without one', () => {
		const G = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		const r = snapResize(G, 'br', 96, 48, { keepRatio: true }, idx(c(1000, 147, 1100, 247)), 8, 20)
		close(r.dy, 47, 'the item line y 147 (1 away) wins against the grid line x 300 (4 away)')
		assert.equal(r.guides.length, 1)
		assert.deepEqual([r.guides[0].axis, r.guides[0].at], ['y', 147])
	})

	test('(f) the clamp cuts the grid snap (w 20 < min 24): the raw offset', () => {
		assert.deepEqual(snapResize(F, 'r', -83, 0, { min: 24 }, none, 8, 20), { dx: -83, dy: 0, guides: [] })
		assert.equal(resizeFrame(F, 'r', -83, 0, { min: 24 }).w, 24)
	})

	test('(f) ratio: a clamp that cuts the grid snap gives the raw offset', () => {
		const G = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		// raw k = 1.48 (x 296 → 300); max 290 wide cuts it
		assert.deepEqual(snapResize(G, 'br', 96, 48, { keepRatio: true, max: 290 }, none, 8, 20), { dx: 96, dy: 48, guides: [] })
	})

	test('(g) axes x: the y side counts as none', () => {
		assert.deepEqual(snapResize(F, 'br', 33, 47, { axes: 'x' }, none, 8, 20), { dx: 40, dy: 47, guides: [] })
	})

	test('(h) raw without guides, also with grid 20: rotated, the rotation handle, a non-finite offset', () => {
		assert.deepEqual(snapResize({ ...F, r: 30 }, 'br', 33, 47, {}, none, 8, 20), { dx: 33, dy: 47, guides: [] })
		assert.deepEqual(snapResize(F, 'rot', 33, 47, {}, none, 8, 20), { dx: 33, dy: 47, guides: [] })
		assert.deepEqual(snapResize(F, 'br', Infinity, 47, {}, none, 8, 20), { dx: Infinity, dy: 47, guides: [] })
		assert.deepEqual(snapResize(null, 'br', 33, 47, {}, none, 8, 20), { dx: 33, dy: 47, guides: [] })
	})

	test('(i) a grid of 0, NaN, −1 or none: the results without the grid', () => {
		const G = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		const cases = [
			[F, 'r', 33, 7, {}, none, 8],
			[F, 'br', 33, 47, {}, none, 8],
			[F, 'r', 33, 0, {}, idx(c(136, 300, 236, 400)), 8],
			[{ x: 105, y: 0, w: 100, h: 100, r: 0 }, 'r', 22, 0, { centered: true }, idx(c(83, 300, 183, 400)), 8],
			[G, 'br', 96, 48, { keepRatio: true }, idx(c(1000, 147, 1100, 247)), 8],
			[G, 'br', 90, 45, { keepRatio: true }, none, 8],
			[F, 'r', -83, 0, { min: 24 }, idx(c(20, 300, 120, 400)), 8],
		]
		for (const [frame, anchor, dx, dy, opts, index, tol] of cases) {
			const plain = snapResize(frame, anchor, dx, dy, opts, index, tol)
			for (const g of NO_GRID) {
				assert.deepEqual(snapResize(frame, anchor, dx, dy, opts, index, tol, g), plain, `${anchor} grid ${g}`)
			}
		}
	})
})
