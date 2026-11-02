/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 273 AK2, model/ink.js: keeping points, simplification with
 * the 500-point cap, the box with half the width, a single point as a
 * circle, the distance to the line (hit and eraser), the smooth path.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
	INK_MAX_POINTS, PEN_COLORS, PEN_DEFAULTS, PEN_WIDTHS, distToStroke, eraserTouches, fitPoints, keepPoint, pointsOf, simplify, strokeBox,
	strokeItem, tracePath,
} from '../../../src/model/ink.js'
import { checkField, POINTS_MAX } from '../../../src/model/registry.js'

describe('job 273 AK2: points and simplification', () => {
	test('keepPoint: the first always, then only from 1.5 px on', () => {
		assert.equal(keepPoint(null, { x: 0, y: 0 }), true)
		assert.equal(keepPoint({ x: 0, y: 0 }, { x: 1, y: 1 }), false)
		assert.equal(keepPoint({ x: 0, y: 0 }, { x: 1.5, y: 0 }), true)
	})

	test('simplify keeps the ends and the corner, drops points on a straight line', () => {
		assert.deepEqual(simplify([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.5), [0, 0, 10, 0, 10, 10])
		assert.deepEqual(simplify([0, 0], 0.5), [0, 0])
		assert.deepEqual(simplify([0, 0, 3, 4], 0.5), [0, 0, 3, 4])
	})

	test('fitPoints: a scribble of 5000 points ends with at most 500, first and last kept, and passes the rule', () => {
		const pts = []
		for (let i = 0; i < 5000; i++) pts.push(i * 0.7, Math.sin(i / 3) * 40 + (i % 7))
		const out = fitPoints(pts, 0.5)
		assert.ok(out.length / 2 <= INK_MAX_POINTS, String(out.length / 2))
		assert.equal(INK_MAX_POINTS * 2, POINTS_MAX)
		assert.deepEqual(out.slice(0, 2), pts.slice(0, 2))
		assert.deepEqual(out.slice(-2), pts.slice(-2))
		const s = strokeItem(out, 4)
		assert.equal(checkField('pen', 'data.points', s.points).ok, true)
		assert.ok(JSON.stringify(s.points).length < 65536 / 4, 'far below MAX_ITEM_BYTES')
	})
})

describe('job 273 AK2: box and item', () => {
	test('strokeBox: the hull grown by half the width; one point is a circle of the width', () => {
		assert.deepEqual(strokeBox([10, 20, 110, 70], 4), { x: 8, y: 18, w: 104, h: 54 })
		assert.deepEqual(strokeBox([10, 20], 8), { x: 6, y: 16, w: 8, h: 8 })
	})

	test('strokeItem: x/y the box, points relative to it and rounded to 0.1', () => {
		const s = strokeItem([100.04, 50.06, 200.33, 80.17], 2)
		assert.deepEqual([s.x, s.y], [99, 49.1])
		assert.deepEqual(s.points, [1, 1, 101.3, 31.1])
		assert.deepEqual([s.w, s.h], [102.3, 32.1])
		const dot = strokeItem([5, 5], 8)
		assert.deepEqual(dot, { x: 1, y: 1, w: 8, h: 8, points: [4, 4] })
	})

	test('pointsOf takes only an even list of finite numbers', () => {
		assert.deepEqual(pointsOf([1, 2, 3, 4]), [1, 2, 3, 4])
		assert.deepEqual(pointsOf([1, 2, 3]), [1, 2])
		assert.deepEqual(pointsOf([1, 'x']), [])
		assert.deepEqual(pointsOf(null), [])
	})
})

describe('job 273 AK2: distance, eraser, path', () => {
	test('distToStroke: to the nearest segment; one point: to the point', () => {
		assert.equal(distToStroke([0, 0, 10, 0], 5, 3), 3)
		assert.equal(distToStroke([0, 0, 10, 0], 13, 4), 5)
		assert.equal(distToStroke([0, 0], 3, 4), 5)
		assert.equal(distToStroke([], 0, 0), Infinity)
	})

	test('eraserTouches: a path crossing the line touches it, one passing beyond the reach does not', () => {
		const line = [0, 0, 100, 0]
		assert.equal(eraserTouches(line, 50, -50, 50, 50, 1), true, 'crossing, even with a long segment')
		assert.equal(eraserTouches(line, 0, 20, 100, 20, 8), false)
		assert.equal(eraserTouches(line, 0, 7, 100, 7, 8), true)
	})

	test('tracePath: curves over the midpoints, the ends exact; one point a zero line', () => {
		const calls = []
		const ctx = { moveTo: (...a) => calls.push(['M', ...a]), lineTo: (...a) => calls.push(['L', ...a]), quadraticCurveTo: (...a) => calls.push(['Q', ...a]) }
		tracePath(ctx, [0, 0, 10, 0, 20, 10, 30, 10])
		assert.deepEqual(calls, [['M', 0, 0], ['Q', 10, 0, 15, 5], ['Q', 20, 10, 25, 10], ['L', 30, 10]])
		calls.length = 0
		tracePath(ctx, [5, 5])
		assert.deepEqual(calls, [['M', 5, 5], ['L', 5, 5]])
	})

	test('widths, colours and defaults per kind pass the field rules', () => {
		for (const k of ['pen', 'marker']) {
			assert.equal(PEN_WIDTHS[k].length, 3)
			for (const w of PEN_WIDTHS[k]) assert.equal(checkField('pen', 'style.strokeWidth', w).ok, true)
			for (const c of PEN_COLORS[k]) assert.equal(checkField('pen', 'style.stroke', c).ok, true)
			assert.ok(PEN_COLORS[k].includes(PEN_DEFAULTS[k].stroke) && PEN_WIDTHS[k].includes(PEN_DEFAULTS[k].strokeWidth))
			assert.ok(!PEN_COLORS[k].includes('#ffffff'), 'no white')
		}
	})
})
