/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/geometry.js: port regression against the engine spike. The golden
 * numbers below were produced by knorke-spike/engine/src/geometry.js (same
 * inputs); the port must reproduce them exactly. M1: q against the PHP
 * half-boundary table (§8.2 (1)), shapePolygon delegating to shapes.js.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as g from '../../../src/model/geometry.js'
import { ARROW_SIZE } from '../../../src/model/tokens.js'
import { outlinePoints } from '../../../src/model/shapes.js'
import { Q_TABLE } from './qTable.mjs'

const SPIKE = {
	rot: [
		[-1.6025403784438765, -23.301270189221924, 221.60254037844388, 163.30127018922192],
		[-3.0330085889910663, -28.03300858899106, 103.03300858899107, 78.03300858899107],
		[5, 5, 15, 15],
	],
	local: [[139.64101615137756, 38.66025403784439], [25.251262658470832, -25.204581464244875]],
	route: [
		{ kind: 'poly', points: [100, 50, 300, 100], bbox: [90, 40, 310, 110] },
		{ kind: 'poly', points: [100, 50, 200, 50, 200, 100, 300, 100], bbox: [90, 40, 310, 110] },
		{ kind: 'poly', points: [50, 100, 50, 250, 100, 250, 100, 400], bbox: [40, 90, 110, 410] },
		{ kind: 'bezier', points: [0, 50, -89.44271909999158, 50, -130.55728090000844, 10, -220, 10], bbox: [-230, 0, 10, 60] },
	],
	dist: [5, 4],
	bez: [0, 0, 9.0625, 11.25, 20, 15, 30.9375, 11.25, 40, 0],
}

describe('geometry (spike port regression)', () => {
	test('exports exactly the ported functions (no bezierPath) plus q (M1)', () => {
		assert.deepEqual(Object.keys(g).sort(), [
			'distToPolyline', 'distToSegment', 'pointInPolygon', 'pointsBBox', 'q', 'rotatedBBox', 'routeConnector',
			'sampleBezier', 'shapePolygon', 'toLocal',
		])
	})

	test('q: the half-boundary table of the PHP test, +0 for every 0 (R7)', () => {
		const bad = Q_TABLE.filter(([v, k, want]) => !Object.is(g.q(v, k), want))
			.map(([v, k, want]) => `q(${v}, ${k}) = ${g.q(v, k)}, want ${want}`)
		assert.deepEqual(bad, [])
		assert.ok(Q_TABLE.length >= 20)
	})

	test('rotatedBBox', () => {
		assert.deepEqual(g.rotatedBBox(10, 20, 200, 100, 30), SPIKE.rot[0])
		assert.deepEqual(g.rotatedBBox(0, 0, 100, 50, -45), SPIKE.rot[1])
		assert.deepEqual(g.rotatedBBox(5, 5, 10, 10, 0), SPIKE.rot[2])
		// 90°: width and height swap around the centre
		const b = g.rotatedBBox(0, 0, 100, 50, 90)
		const close = (a, e) => assert.ok(Math.abs(a - e) < 1e-9, `${a} ≈ ${e}`)
		close(b[0], 25)
		close(b[1], -25)
		close(b[2], 75)
		close(b[3], 75)
	})

	test('toLocal', () => {
		assert.deepEqual(g.toLocal(150, 80, 10, 20, 200, 100, 30), SPIKE.local[0])
		assert.deepEqual(g.toLocal(-3, 7, 0, 0, 100, 50, -45), SPIKE.local[1])
		assert.deepEqual(g.toLocal(15, 25, 10, 20, 100, 100, 0), [5, 5])
	})

	test('toLocal maps the rotated corners back onto the box', () => {
		const x = 40
		const y = -30
		const w = 120
		const h = 80
		const r = 37
		const rad = r * Math.PI / 180
		const cx = x + w / 2
		const cy = y + h / 2
		for (const [lx, ly] of [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]]) {
			const dx = lx - w / 2
			const dy = ly - h / 2
			const wx = cx + dx * Math.cos(rad) - dy * Math.sin(rad)
			const wy = cy + dx * Math.sin(rad) + dy * Math.cos(rad)
			const [bx, by] = g.toLocal(wx, wy, x, y, w, h, r)
			assert.ok(Math.abs(bx - lx) < 1e-9 && Math.abs(by - ly) < 1e-9, `${lx},${ly}`)
		}
	})

	test('routeConnector', () => {
		assert.deepEqual(g.routeConnector({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 50, w: 100, h: 100 }, 'straight'), SPIKE.route[0])
		assert.deepEqual(g.routeConnector({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 50, w: 100, h: 100 }, 'elbow'), SPIKE.route[1])
		assert.deepEqual(g.routeConnector({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 400, w: 100, h: 100 }, 'elbow'), SPIKE.route[2])
		assert.deepEqual(g.routeConnector({ x: 0, y: 0, w: 100, h: 100 }, { x: -300, y: -20, w: 80, h: 60 }, 'curved'), SPIKE.route[3])
		assert.equal(ARROW_SIZE, 10)
	})

	test('pointsBBox, distances, bezier sampling, polygons', () => {
		assert.deepEqual(g.pointsBBox([3, 4, -1, 9, 7, 2]), [-1, 2, 7, 9])
		assert.deepEqual(g.pointsBBox([0, 0], 5), [-5, -5, 5, 5])
		assert.equal(g.distToSegment(5, 5, 0, 0, 10, 0), SPIKE.dist[0])
		assert.equal(g.distToPolyline(5, 5, [0, 0, 10, 0, 10, 10], 1, 1), SPIKE.dist[1])
		assert.equal(g.distToPolyline(5, 5, [0, 0]), Infinity)
		assert.equal(g.distToSegment(3, 4, 0, 0, 0, 0), 5)
		assert.deepEqual(g.sampleBezier([0, 0, 10, 20, 30, 20, 40, 0], 4), SPIKE.bez)
		assert.equal(g.sampleBezier([0, 0, 1, 1, 2, 2, 3, 3]).length, 34)
		const diamond = g.shapePolygon('diamond', 100, 50)
		assert.deepEqual(diamond, [50, 0, 100, 25, 50, 50, 0, 25])
		assert.equal(g.pointInPolygon(50, 25, diamond), true)
		assert.equal(g.pointInPolygon(5, 5, diamond), false)
		assert.deepEqual(g.shapePolygon('triangle', 10, 10), [5, 0, 10, 10, 0, 10])
		assert.equal(g.shapePolygon('rect', 10, 10), null)
		// M1: delegates to shapes.outlinePoints for every polygon kind; box and ellipse kinds stay null
		assert.deepEqual(g.shapePolygon('arrowRight', 100, 40), outlinePoints('arrowRight', 100, 40))
		for (const kind of ['roundRect', 'ellipse', 'hexagon', undefined]) assert.equal(g.shapePolygon(kind, 10, 10), null, String(kind))
	})
})
