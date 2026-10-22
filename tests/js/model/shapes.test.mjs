/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/shapes.js: the shape table of SPEC-M1 §6.2 literally, one entry
 * per registry shape kind, fallback to rect, outline points, and anchors that
 * lie on the outline.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ELLIPSE_SEGMENTS, SHAPES, outlinePoints, shapeOf } from '../../../src/model/shapes.js'
import { ENUMS } from '../../../src/model/registry.js'
import { distToPolyline } from '../../../src/model/geometry.js'

const SIDES = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]

describe('shapes', () => {
	test('SHAPES is the table of §6.2', () => {
		assert.deepEqual(SHAPES, {
			rect: { hit: 'box', outline: null, radius: 0, text: [0, 0, 1, 1], anchors: SIDES },
			roundRect: { hit: 'box', outline: null, radius: 0.15, text: [0, 0, 1, 1], anchors: SIDES },
			ellipse: { hit: 'ellipse', outline: 'ellipse', text: [0.146, 0.146, 0.707, 0.707], anchors: SIDES },
			diamond: { hit: 'polygon', outline: [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5], text: [0.25, 0.25, 0.5, 0.5], anchors: SIDES },
			triangle: { hit: 'polygon', outline: [0.5, 0, 1, 1, 0, 1], text: [0.25, 0.5, 0.5, 0.45], anchors: [[0.5, 0], [0.75, 0.5], [0.5, 1], [0.25, 0.5]] },
			arrowRight: {
				hit: 'polygon', outline: [0, 0.25, 0.65, 0.25, 0.65, 0, 1, 0.5, 0.65, 1, 0.65, 0.75, 0, 0.75],
				text: [0, 0.25, 0.65, 0.5], anchors: [[0.5, 0.25], [1, 0.5], [0.5, 0.75], [0, 0.5]],
			},
		})
	})

	test('one entry per registry kind, same order (shape packs extend both, §3.10)', () => {
		assert.deepEqual(Object.keys(SHAPES), ENUMS.shapeKinds)
	})

	test('shapeOf: entry or rect for unknown kinds (own keys only)', () => {
		for (const k of ENUMS.shapeKinds) assert.equal(shapeOf(k), SHAPES[k])
		for (const k of ['hexagon', 'Rect', '', null, undefined, 3, 'constructor', '__proto__', 'toString']) assert.equal(shapeOf(k), SHAPES.rect, String(k))
	})

	test('text boxes lie inside the unit box; hit modes are box, ellipse or polygon', () => {
		for (const [k, s] of Object.entries(SHAPES)) {
			const [x, y, w, h] = s.text
			assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0000001 && y + h <= 1.0000001, k)
			assert.ok(['box', 'ellipse', 'polygon'].includes(s.hit), k)
			assert.equal(s.hit === 'polygon', Array.isArray(s.outline), k)
		}
	})

	test('outlinePoints: polygons scaled by w and h, boxes as four corners, ellipse as a closed regular polygon', () => {
		assert.deepEqual(outlinePoints('diamond', 100, 50), [50, 0, 100, 25, 50, 50, 0, 25])
		assert.deepEqual(outlinePoints('triangle', 10, 10), [5, 0, 10, 10, 0, 10])
		assert.deepEqual(outlinePoints('arrowRight', 100, 40), [0, 10, 65, 10, 65, 0, 100, 20, 65, 40, 65, 30, 0, 30])
		assert.deepEqual(outlinePoints('rect', 10, 20), [0, 0, 10, 0, 10, 20, 0, 20])
		assert.deepEqual(outlinePoints('roundRect', 10, 20), [0, 0, 10, 0, 10, 20, 0, 20])
		assert.deepEqual(outlinePoints('mystery', 10, 20), [0, 0, 10, 0, 10, 20, 0, 20])
		const e = outlinePoints('ellipse', 200, 100)
		assert.equal(e.length, 2 * ELLIPSE_SEGMENTS)
		assert.ok(Math.abs(e[0] - 100) < 1e-9 && Math.abs(e[1]) < 1e-9, 'starts at the top')
		for (let i = 0; i < e.length; i += 2) {
			const v = ((e[i] - 100) / 100) ** 2 + ((e[i + 1] - 50) / 50) ** 2
			assert.ok(Math.abs(v - 1) < 1e-9)
		}
		const a = outlinePoints('diamond', 1, 1)
		a[0] = 99
		assert.equal(SHAPES.diamond.outline[0], 0.5, 'a new array every time')
	})

	test('every anchor lies on its outline', () => {
		for (const [k, s] of Object.entries(SHAPES)) {
			for (const [ax, ay] of s.anchors) {
				let d
				if (s.outline === 'ellipse') {
					d = Math.abs(((ax - 0.5) / 0.5) ** 2 + ((ay - 0.5) / 0.5) ** 2 - 1)
				} else {
					const pts = outlinePoints(k, 1, 1)
					d = distToPolyline(ax, ay, [...pts, pts[0], pts[1]])
				}
				assert.ok(d < 1e-9, `${k} [${ax}, ${ay}]`)
			}
		}
	})

	test('frozen', () => {
		assert.throws(() => { SHAPES.rect.radius = 1 }, TypeError)
		assert.throws(() => { SHAPES.triangle.anchors[0][0] = 1 }, TypeError)
		assert.throws(() => { SHAPES.hexagon = {} }, TypeError)
	})
})
