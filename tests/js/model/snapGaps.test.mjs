/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/snap.js snapMove (M2, SPEC-M1 §1.2 (R12), equal gaps), pure:
 * the lines of snapDelta plus the gaps to the neighbours in the row and
 * column of the dragged box.
 * - AK1: a left and a right neighbour gap snap to the gap of two other
 *   notes in the row, a column the same; the tol limit is inclusive
 * - AK2: the smallest correction, ties (left before right, the smaller g),
 *   line against gap (nearer, both, the same size in opposite directions),
 *   the guide spans the snapped box, every equal gap gets a marker; no gap
 *   when locked, outside the row, inside a frame of the row, with an
 *   offset pair; the frame around the box is not part of the row; invalid
 *   input gives the raw shift
 * - AK3: 300 seeded cases: without markers the result of snapDelta, with
 *   markers at least two per axis, all of one length
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SAME_LINE, buildSnapIndex, snapDelta, snapMove } from '../../../src/model/snap.js'

/** @return {object} candidate box {minX, minY, maxX, maxY} */
const c = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY })
/** P and Q 60 apart in the row of BOX. */
const PQ = Object.freeze([c(0, 0, 100, 100), c(160, 0, 260, 100)])
const BOX = Object.freeze({ x: 400, y: 20, w: 100, h: 100 })
const idx = (list) => buildSnapIndex(list)
/** @return {object} a gap marker */
const gx = (at, from, to) => ({ axis: 'x', at, from, to })
const gy = (at, from, to) => ({ axis: 'y', at, from, to })

/** AK1: the result of snapMove(BOX, −77, 0, idx(PQ), 8). */
const AK1 = Object.freeze({ dx: -80, dy: 0, guides: [], gaps: [gx(50, 100, 160), gx(60, 260, 320)] })

describe('snapMove: AK1', () => {
	test('the left neighbour gap 63 snaps to the gap 60 of P and Q (two markers); with tol 2 the raw shift', () => {
		assert.deepEqual(snapMove(BOX, -77, 0, idx(PQ), 8), AK1)
		assert.deepEqual(snapMove(BOX, -77, 0, idx(PQ), 2), { dx: -77, dy: 0, guides: [], gaps: [] })
	})

	test('the limit is inclusive: |δ| = 8 snaps, 8.01 does not', () => {
		assert.deepEqual(snapMove(BOX, -72, 0, idx(PQ), 8), AK1)
		assert.deepEqual(snapMove(BOX, -71.99, 0, idx(PQ), 8), { dx: -71.99, dy: 0, guides: [], gaps: [] })
	})

	test('the right neighbour gap: the box left of P', () => {
		assert.deepEqual(snapMove(BOX, -563, 0, idx(PQ), 8),
			{ dx: -560, dy: 0, guides: [], gaps: [gx(60, -60, 0), gx(50, 100, 160)] })
	})

	test('a column: the top neighbour gap snaps to the vertical gap of two notes', () => {
		assert.deepEqual(snapMove({ x: 20, y: 400, w: 100, h: 100 }, 0, -77, idx([c(0, 0, 100, 100), c(0, 160, 100, 260)]), 8),
			{ dx: 0, dy: -80, guides: [], gaps: [gy(50, 100, 160), gy(60, 260, 320)] })
	})
})

describe('snapMove: AK2 rules', () => {
	// [name, candidates, expected dx, expected guides ([axis, at]), expected gaps]; BOX, dx −77, dy 0, tol 8
	const cases = [
		['the smallest |δ| wins (gap 65 with +2 before gap 60 with −3)', [...PQ, c(-165, 0, -65, 100)], -75, [],
			[gx(50, -65, 0), gx(60, 260, 325)]],
		['an even row: every gap of 60 gets a marker', [...PQ, c(-160, 0, -60, 100)], -80, [],
			[gx(50, -60, 0), gx(50, 100, 160), gx(60, 260, 320)]],
		['a tie between both sides: left before right (S′–R is 66)', [...PQ, c(486, 0, 586, 100)], -80, [],
			[gx(50, 100, 160), gx(60, 260, 320)]],
		['a tie on one side: the smaller g (60 before 66)', [...PQ, c(-166, 0, -66, 100)], -80, [],
			[gx(50, 100, 160), gx(60, 260, 320)]],
		['the line is nearer (+1 before −3)', [...PQ, c(324, -300, 424, -200)], -76, [['x', 324]], []],
		['the gap is nearer (−3 before +5)', [...PQ, c(328, -300, 428, -200)], -80, [],
			[gx(50, 100, 160), gx(60, 260, 320)]],
		['line and gap on the same spot: both', [...PQ, c(320, -300, 420, -200)], -80, [['x', 320]],
			[gx(50, 100, 160), gx(60, 260, 320)]],
		['the same size in opposite directions (+3, −3): the line', [...PQ, c(326, -300, 426, -200)], -74, [['x', 326]], []],
	]
	for (const [name, cands, ex, eg, egaps] of cases) {
		test(name, () => {
			const r = snapMove(BOX, -77, 0, idx(cands), 8)
			assert.equal(r.dx, ex)
			assert.equal(r.dy, 0)
			assert.deepEqual(r.guides.map((g) => [g.axis, g.at]), eg)
			assert.deepEqual(r.gaps, egaps)
		})
	}

	test('both on the same spot: the whole guide (from the candidate to the snapped box)', () => {
		const r = snapMove(BOX, -77, 0, idx([...PQ, c(320, -300, 420, -200)]), 8)
		assert.deepEqual(r.guides, [{ axis: 'x', at: 320, from: -300, to: 120 }])
	})

	test('the guide of the other axis spans the box after the gap correction (420, not 423)', () => {
		assert.deepEqual(snapMove({ x: 400, y: 0, w: 100, h: 100 }, -77, 0, idx(PQ), 8),
			{ dx: -80, dy: 0, guides: [{ axis: 'y', at: 0, from: 0, to: 420 }], gaps: [gx(50, 100, 160), gx(50, 260, 320)] })
	})

	test('both axes snap to gaps: the x markers first, then the y markers, each by from', () => {
		const cands = [c(0, 330, 100, 430), c(160, 330, 260, 430), c(330, 0, 430, 100), c(330, 160, 430, 260)]
		// the lines of the other pair are 7 away (330 against 323): the gaps (3) win on both axes
		assert.deepEqual(snapMove({ x: 400, y: 400, w: 100, h: 100 }, -77, -77, idx(cands), 8), {
			dx: -80, dy: -80, guides: [],
			gaps: [gx(380, 100, 160), gx(375, 260, 320), gy(380, 100, 160), gy(375, 260, 320)],
		})
	})

	const RAW = Object.freeze({ dx: -77, dy: 0, guides: [], gaps: [] })
	for (const [name, box, cands] of [
		['locked: a small item inside the raw box', BOX, [...PQ, c(335, 45, 345, 55)]],
		['not in the row (the box below P and Q)', { x: 400, y: 110, w: 100, h: 100 }, PQ],
		['a frame around P and Q in the row: its inner gap is no reference gap', BOX, [...PQ, c(-10, -10, 270, 110)]],
		['an offset pair that does not overlap across the axis', { x: 400, y: 0, w: 100, h: 200 }, [c(0, -90, 100, 10), c(160, 110, 260, 210)]],
	]) {
		test(`no gap: ${name}`, () => {
			assert.deepEqual(snapMove(box, -77, 0, idx(cands), 8), RAW)
		})
	}

	test('the frame around the box is not part of the row: the same as AK1', () => {
		assert.deepEqual(snapMove(BOX, -77, 0, idx([...PQ, c(-1000, -1000, 1000, 1000)]), 8), AK1)
	})

	test('a frame beside the box counts with its gap to the neighbours (inner gaps covered)', () => {
		// frame F 0..260 with two notes 60 apart inside, a note N 60 right of F; the box 63 right of N
		const cands = [c(0, 0, 260, 100), c(20, 10, 80, 90), c(140, 10, 200, 90), c(320, 0, 420, 100)]
		const r = snapMove({ x: 600, y: 20, w: 100, h: 100 }, -117, 0, idx(cands), 8)
		assert.equal(r.dx, -120)
		assert.deepEqual(r.gaps, [gx(50, 260, 320), gx(60, 420, 480)])
	})

	test('invalid input: the raw shift without guides and markers', () => {
		const index = idx(PQ)
		assert.deepEqual(snapMove(null, -77, 0, index, 8), RAW)
		assert.deepEqual(snapMove(BOX, -77, 0, null, 8), RAW)
		assert.deepEqual(snapMove(BOX, -77, 0, idx([]), 8), RAW)
		assert.deepEqual(snapMove(BOX, -77, 0, index, -1), RAW)
		assert.deepEqual(snapMove(BOX, -77, 0, index, NaN), RAW)
		assert.deepEqual(snapMove(BOX, NaN, 0, index, 8).gaps, [])
	})
})

describe('snapMove: AK3 property', () => {
	/** Deterministic PRNG (mulberry32, as in tests/js/scene/snap.test.mjs). */
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

	test('300 seeded cases: without markers snapDelta; with markers ≥ 2 per axis, to > from, one length per axis', () => {
		const rnd = prng(0x6a95)
		/** @return {number} a multiple of 10 in [0, max] */
		const grid = (max) => 10 * Math.floor(rnd() * (max / 10 + 1))
		let withMarkers = 0
		for (let k = 0; k < 300; k++) {
			const cands = []
			for (let i = 0; i < 8; i++) {
				const x = grid(900)
				const y = grid(200)
				cands.push(c(x, y, x + 100, y + 100))
			}
			const box = { x: grid(900), y: grid(200), w: 100, h: 100 }
			const dx = -50 + rnd() * 100
			const dy = -50 + rnd() * 100
			const index = idx(cands)
			const r = snapMove(box, dx, dy, index, 8)
			const at = `case ${k}: ${JSON.stringify({ cands, box, dx, dy })}`
			if (r.gaps.length === 0) {
				const d = snapDelta(box, dx, dy, index, 8)
				assert.deepEqual({ dx: r.dx, dy: r.dy, guides: r.guides }, d, at)
				continue
			}
			withMarkers++
			for (const axis of ['x', 'y']) {
				const list = r.gaps.filter((m) => m.axis === axis)
				if (list.length === 0) continue
				assert.ok(list.length >= 2, at)
				const lens = list.map((m) => m.to - m.from)
				for (const m of list) assert.ok(m.to > m.from, at)
				assert.ok(Math.max(...lens) - Math.min(...lens) <= SAME_LINE + 1e-9, at)
			}
		}
		assert.ok(withMarkers > 0, 'at least one case has markers')
	})
})
