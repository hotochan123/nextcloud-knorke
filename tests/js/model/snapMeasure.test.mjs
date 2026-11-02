/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 194) The numbers of the snapping, pure (src/model/snap.js):
 * - AK1 guideMeasure: the measuring line of a guide to the nearest candidate
 *   on its line, after and before the box, both axes; a tie takes the one
 *   before; a candidate that overlaps the box along the guide does not
 *   count; a touching one gives none; a candidate with only its centre on
 *   the line counts; a guide without another candidate gives none; invalid
 *   input gives none
 * - snapMoveDetail: snapMove plus the winning gap length per axis (null
 *   without a gap); snapMove keeps its shape
 * - distanceText / sizeText: whole board units, the 0.01 grid first
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapIndex, distanceText, guideMeasure, sizeText, snapMove, snapMoveDetail } from '../../../src/model/snap.js'

/** @return {object} candidate box {minX, minY, maxX, maxY} */
const c = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY })
const idx = (list) => buildSnapIndex(list)
/** The snapped box: x 100–300, y 300–500. */
const BOX = Object.freeze(c(100, 300, 300, 500))

describe('AK1: guideMeasure', () => {
	test('a horizontal guide (axis y): the nearest candidate after the box on its line', () => {
		// B (500–700) and a farther one (900–1000) both with their bottom on y = 300
		const index = idx([c(500, 100, 700, 300), c(900, 200, 1000, 300)])
		assert.deepEqual(guideMeasure(index, { axis: 'y', at: 300, from: 100, to: 1000 }, BOX), { axis: 'x', at: 300, from: 300, to: 500 })
	})

	test('a horizontal guide: the nearest candidate before the box', () => {
		const index = idx([c(-200, 300, -100, 400), c(0, 250, 40, 300)])
		assert.deepEqual(guideMeasure(index, { axis: 'y', at: 300, from: -200, to: 300 }, BOX), { axis: 'x', at: 300, from: 40, to: 100 })
	})

	test('a vertical guide (axis x): measured along y, below and above', () => {
		const below = idx([c(300, 700, 400, 800)])
		assert.deepEqual(guideMeasure(below, { axis: 'x', at: 300, from: 300, to: 800 }, BOX), { axis: 'y', at: 300, from: 500, to: 700 })
		const above = idx([c(200, 0, 300, 120)])
		assert.deepEqual(guideMeasure(above, { axis: 'x', at: 300, from: 0, to: 500 }, BOX), { axis: 'y', at: 300, from: 120, to: 300 })
	})

	test('a tie takes the candidate before the box (left)', () => {
		const index = idx([c(-50, 300, 50, 400), c(350, 300, 450, 400)])
		assert.deepEqual(guideMeasure(index, { axis: 'y', at: 300, from: -50, to: 450 }, BOX), { axis: 'x', at: 300, from: 50, to: 100 })
	})

	test('a candidate that overlaps the box along the guide does not count; the next one does', () => {
		// a frame around the box with its top on y = 300, and a note at 600
		const index = idx([c(0, 300, 1000, 900), c(600, 300, 700, 400)])
		assert.deepEqual(guideMeasure(index, { axis: 'y', at: 300, from: 0, to: 1000 }, BOX), { axis: 'x', at: 300, from: 300, to: 600 })
		assert.equal(guideMeasure(idx([c(250, 300, 400, 400)]), { axis: 'y', at: 300, from: 100, to: 400 }, BOX), null)
	})

	test('the nearest one touches the box: no measuring line, even with a farther one', () => {
		const index = idx([c(300, 200, 400, 300), c(600, 200, 700, 300)])
		assert.equal(guideMeasure(index, { axis: 'y', at: 300, from: 100, to: 700 }, BOX), null)
		// 0.01 apart still touches
		assert.equal(guideMeasure(idx([c(300.01, 200, 400, 300)]), { axis: 'y', at: 300, from: 100, to: 400 }, BOX), null)
		assert.deepEqual(guideMeasure(idx([c(300.02, 200, 400, 300)]), { axis: 'y', at: 300, from: 100, to: 400 }, BOX),
			{ axis: 'x', at: 300, from: 300, to: 300.02 })
	})

	test('a candidate with only its centre on the line counts; one 0.01 off counts as the same line', () => {
		// centre y = 300 (250–350)
		assert.deepEqual(guideMeasure(idx([c(500, 250, 600, 350)]), { axis: 'y', at: 300, from: 100, to: 600 }, BOX),
			{ axis: 'x', at: 300, from: 300, to: 500 })
		assert.deepEqual(guideMeasure(idx([c(500, 200, 600, 299.99)]), { axis: 'y', at: 300, from: 100, to: 600 }, BOX),
			{ axis: 'x', at: 300, from: 300, to: 500 })
		assert.equal(guideMeasure(idx([c(500, 200, 600, 299.9)]), { axis: 'y', at: 300, from: 100, to: 600 }, BOX), null)
	})

	test('no other candidate on the line, or invalid input: null', () => {
		assert.equal(guideMeasure(idx([c(500, 0, 600, 100)]), { axis: 'y', at: 300, from: 100, to: 300 }, BOX), null)
		assert.equal(guideMeasure(idx([]), { axis: 'y', at: 300, from: 100, to: 300 }, BOX), null)
		assert.equal(guideMeasure(null, { axis: 'y', at: 300, from: 100, to: 300 }, BOX), null)
		assert.equal(guideMeasure(idx([c(500, 100, 700, 300)]), null, BOX), null)
		assert.equal(guideMeasure(idx([c(500, 100, 700, 300)]), { axis: 'y', at: 300, from: 100, to: 700 }, null), null)
		assert.equal(guideMeasure(idx([c(500, 100, 700, 300)]), { axis: 'z', at: 300, from: 100, to: 700 }, BOX), null)
	})
})

describe('snapMoveDetail: the winning gap length per axis', () => {
	const PQ = [c(0, 0, 100, 100), c(160, 0, 260, 100)]
	const B = { x: 400, y: 20, w: 100, h: 100 }

	test('a gap on x: gapLen.x = 60, y null; snapMove is the same without gapLen', () => {
		const r = snapMoveDetail(B, -77, 0, idx(PQ), 8)
		assert.deepEqual(r.gapLen, { x: 60, y: null })
		assert.deepEqual(snapMove(B, -77, 0, idx(PQ), 8), { dx: r.dx, dy: r.dy, guides: r.guides, gaps: r.gaps })
		assert.deepEqual(Object.keys(snapMove(B, -77, 0, idx(PQ), 8)).sort(), ['dx', 'dy', 'gaps', 'guides'])
	})

	test('no gap (a line, free, invalid): both null', () => {
		assert.deepEqual(snapMoveDetail(B, -2, 0, idx(PQ), 8).gapLen, { x: null, y: null })
		assert.deepEqual(snapMoveDetail(B, -77, 0, idx(PQ), 2).gapLen, { x: null, y: null })
		assert.deepEqual(snapMoveDetail(null, -77, 0, idx(PQ), 8).gapLen, { x: null, y: null })
	})

	test('markers of slightly different lengths (48.5 and 48.49) share the reference length 48.5', () => {
		const row = [c(0, 0, 100, 100), c(148.5, 0, 248.5, 100), c(296.99, 0, 396.99, 100)]
		const r = snapMoveDetail({ x: 450, y: 20, w: 100, h: 100 }, -3, 0, idx(row), 8)
		assert.equal(r.gapLen.x, 48.5)
		assert.equal(r.gaps.length, 3)
		assert.deepEqual(r.gaps.map((m) => distanceText(m.to - m.from)), ['49', '48', '49'], 'one by one they would differ')
		assert.equal(distanceText(r.gapLen.x), '49')
	})
})

describe('distanceText and sizeText', () => {
	test('whole units, ,5 rounds up, the float error of 48.5 does not round down', () => {
		assert.equal(distanceText(955), '955')
		assert.equal(distanceText(48.49), '48')
		assert.equal(distanceText(48.5), '49')
		assert.equal(distanceText(445.49 - 396.99), '49', String(445.49 - 396.99))
		assert.equal(distanceText(1306.4), '1306')
		assert.equal(distanceText(12345.6), '12346', 'no thousands separator')
		assert.equal(distanceText(0.2), '0')
		assert.equal(distanceText(NaN), '0')
	})

	test('"W × H" with U+00D7 and one space on each side', () => {
		assert.equal(sizeText(240, 180), '240 × 180')
		assert.equal(sizeText(1140.4, 1305.5), '1140 × 1306')
		assert.equal(sizeText(240, 180).charCodeAt(4), 0xd7)
		assert.equal(sizeText(Infinity, 3), '0 × 3')
	})
})
