/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/snap.js (M2, SPEC-M1 §1.2 (R12)), pure: buildSnapIndex and
 * snapDelta of a dragged box against candidate boxes.
 * - AK1: the right edge snaps flush to a candidate's left edge, y stays; a
 *   smaller tol does not snap
 * - AK2: the tol limit is inclusive, both axes snap independently (guides
 *   x, y), centre to edge and edge to centre (3 × 3), the smaller distance
 *   wins, on a tie the earlier line of the box, then the smaller candidate
 *   line; without a box, an index or a candidate the raw shift
 * - AK3: a guide spans the snapped box and every candidate with a line
 *   within 0.01 of the snapped one (both sides, float error of the 0.01
 *   grid absorbed), not one 0.02 away
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SAME_LINE, buildSnapIndex, snapDelta } from '../../../src/model/snap.js'

/** @return {object} candidate box {minX, minY, maxX, maxY} */
const cand = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY })
/** A candidate far away on the y axis (its y lines never snap with the boxes below). */
const xOnly = (minX, maxX) => cand(minX, 5000, maxX, 5100)
/** A candidate far away on the x axis. */
const yOnly = (minY, maxY) => cand(5000, minY, 5100, maxY)
const BOX = Object.freeze({ x: 0, y: 0, w: 100, h: 100 })

describe('snapDelta: AK1', () => {
	test('right edge flush to the left edge of the candidate, y does not snap; with tol 4 nothing snaps', () => {
		const index = buildSnapIndex([{ minX: 300, minY: 0, maxX: 400, maxY: 100 }])
		assert.deepEqual(snapDelta({ x: 0, y: 200, w: 100, h: 100 }, 195, 0, index, 8),
			{ dx: 200, dy: 0, guides: [{ axis: 'x', at: 300, from: 0, to: 300 }] })
		assert.deepEqual(snapDelta({ x: 0, y: 200, w: 100, h: 100 }, 195, 0, index, 4), { dx: 195, dy: 0, guides: [] })
	})
})

describe('snapDelta: AK2 rules', () => {
	// [name, box, dx, dy, candidates, tol, expected dx, expected dy, expected guides (axis/at only)]
	const cases = [
		['distance exactly tol snaps', BOX, 192, 0, [xOnly(300, 400)], 8, 200, 0, [['x', 300]]],
		['distance just above tol does not snap', BOX, 191.9, 0, [xOnly(300, 400)], 8, 191.9, 0, []],
		['the y limit is inclusive too', BOX, 0, 192, [yOnly(300, 400)], 8, 0, 200, [['y', 300]]],
		['both axes snap independently, guides x then y', BOX, 97, 95, [cand(200, 200, 300, 300)], 8, 100, 100, [['x', 200], ['y', 200]]],
		['centre to edge', { x: 0, y: 0, w: 60, h: 60 }, 272, 0, [xOnly(300, 500)], 8, 270, 0, [['x', 300]]],
		['edge to centre', { x: 0, y: 0, w: 60, h: 60 }, 402, 0, [xOnly(300, 500)], 8, 400, 0, [['x', 400]]],
		['middle to edge (y)', { x: 0, y: 0, w: 60, h: 60 }, 0, 272, [yOnly(300, 500)], 8, 0, 270, [['y', 300]]],
		['the smaller distance wins (2 before 5)', BOX, 195, 0, [xOnly(293, 393), xOnly(300, 400)], 8, 193, 0, [['x', 293]]],
		['the smaller distance wins across lines of the box (right 1 before left 3)', BOX, 203, 0, [xOnly(150, 200), xOnly(304, 360)], 8, 204, 0, [['x', 304]]],
		['tie: left before right', BOX, 200, 0, [xOnly(150, 197), xOnly(303, 350)], 8, 197, 0, [['x', 197]]],
		['tie: left before centre', BOX, 200, 0, [xOnly(150, 197), xOnly(253, 263)], 8, 197, 0, [['x', 197]]],
		['tie: centre before right', BOX, 200, 0, [xOnly(140, 247), xOnly(303, 330)], 8, 197, 0, [['x', 247]]],
		['tie: top before bottom', BOX, 0, 200, [yOnly(150, 197), yOnly(303, 350)], 8, 0, 197, [['y', 197]]],
		['tie of one line: the smaller candidate line', BOX, 200, 0, [xOnly(100, 197), xOnly(203, 1000)], 8, 197, 0, [['x', 197]]],
		['tie of one line (y): the smaller candidate line', BOX, 0, 200, [yOnly(100, 197), yOnly(203, 1000)], 8, 0, 197, [['y', 197]]],
	]
	for (const [name, box, dx, dy, cands, tol, ex, ey, eg] of cases) {
		test(name, () => {
			const r = snapDelta(box, dx, dy, buildSnapIndex(cands), tol)
			assert.equal(r.dx, ex)
			assert.equal(r.dy, ey)
			assert.deepEqual(r.guides.map((g) => [g.axis, g.at]), eg)
		})
	}

	test('guides of both axes span the snapped box and the candidate', () => {
		const r = snapDelta(BOX, 97, 95, buildSnapIndex([cand(200, 200, 300, 300)]), 8)
		assert.deepEqual(r.guides, [{ axis: 'x', at: 200, from: 100, to: 300 }, { axis: 'y', at: 200, from: 100, to: 300 }])
	})

	test('without a box, without an index or with an empty index: the raw shift, no guides', () => {
		const index = buildSnapIndex([cand(103, 103, 200, 200)])
		assert.deepEqual(snapDelta(null, 1, 2, index, 8), { dx: 1, dy: 2, guides: [] })
		assert.deepEqual(snapDelta(BOX, 1, 2, null, 8), { dx: 1, dy: 2, guides: [] })
		assert.deepEqual(snapDelta(BOX, 1, 2, buildSnapIndex([]), 8), { dx: 1, dy: 2, guides: [] })
		assert.deepEqual(snapDelta(BOX, 1, 2, buildSnapIndex(null), 8), { dx: 1, dy: 2, guides: [] })
		// the same index snaps the box (proof that it is not empty)
		assert.deepEqual([snapDelta(BOX, 1, 2, index, 8).dx, snapDelta(BOX, 1, 2, index, 8).dy], [3, 3])
	})

	test('an invalid tol or a non-finite shift does not snap; boxes with non-finite values are skipped', () => {
		const index = buildSnapIndex([cand(103, 103, 200, 200), cand(NaN, 0, 10, 10), null])
		assert.equal(index.boxes.length, 1)
		for (const tol of [NaN, -1, undefined]) assert.deepEqual(snapDelta(BOX, 1, 2, index, tol), { dx: 1, dy: 2, guides: [] })
		assert.deepEqual(snapDelta(BOX, NaN, 2, index, 8).guides, [])
	})
})

describe('snapDelta: AK3 extent of a guide', () => {
	test('two candidates on the same line (≤ 0.01, here 299.99 against 300) share the guide, one 0.02 away does not extend it', () => {
		assert.equal(SAME_LINE, 0.01)
		const index = buildSnapIndex([
			cand(300, 0, 400, 100),
			cand(299.99, 1000, 350, 1100),
			cand(299.98, 2000, 350, 2100),
			cand(300.02, 3000, 350, 3100),
		])
		// the right edge lands on 300 exactly (the nearest line, distance 0)
		assert.deepEqual(snapDelta({ x: 0, y: 500, w: 100, h: 100 }, 200, 0, index, 8),
			{ dx: 200, dy: 0, guides: [{ axis: 'x', at: 300, from: 0, to: 1100 }] })
	})

	test('the same on the y axis after a real snap (300.01 shares the line, 300.02 does not)', () => {
		const index = buildSnapIndex([
			cand(0, 300, 100, 400),
			cand(-2000, 300.01, -1900, 350),
			cand(2000, 300.02, 2100, 350),
		])
		assert.deepEqual(snapDelta({ x: 500, y: 0, w: 100, h: 100 }, 0, 195, index, 8),
			{ dx: 0, dy: 200, guides: [{ axis: 'y', at: 300, from: -2000, to: 600 }] })
	})

	test('only the snapped box when no other candidate shares the line', () => {
		const r = snapDelta({ x: 0, y: 500, w: 100, h: 100 }, 195, 0, buildSnapIndex([cand(300, 0, 400, 100), cand(320, 2000, 400, 2100)]), 8)
		assert.deepEqual(r.guides, [{ axis: 'x', at: 300, from: 0, to: 600 }])
	})
})

describe('buildSnapIndex', () => {
	test('three lines per box and axis, sorted, each with its box', () => {
		const index = buildSnapIndex([cand(10, 0, 30, 4), cand(0, 10, 2, 20)])
		assert.deepEqual([...index.x.v], [0, 1, 2, 10, 20, 30])
		assert.deepEqual([...index.x.box], [1, 1, 1, 0, 0, 0])
		assert.deepEqual([...index.y.v], [0, 2, 4, 10, 15, 20])
		assert.deepEqual([...index.y.box], [0, 0, 0, 1, 1, 1])
	})
})
