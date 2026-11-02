/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 273 AK6, how a pen stroke is drawn: the node (nodes/ink.js)
 * strokes the smooth line in the stroke's colour and width with round caps,
 * the pen opaque and the highlighter at 0.4; the SVG export keeps it as a
 * path; nodeSpecFor('pen') is the ink node, not the placeholder; at LOD 2
 * the coarse painter draws its line, not a box.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { coarseOrder, paintCoarse, planCoarse } from '../../../src/scene/nodes/coarse.js'

const ctx2d = {
	font: '10px sans-serif', save() {}, restore() {}, clearRect() {}, fillRect() {}, scale() {}, setTransform() {},
	measureText: (text) => ({ width: text.length * 5 }),
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
}

let ink
let nodeSpecFor
let placeholder
let ctx
let VectorContext
let SceneCanvas
let svgDocument

before(async () => {
	globalThis.document = { documentElement: { dataset: {}, lang: 'en' }, createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	const { Text } = await import('konva/lib/shapes/Text')
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	;({ SceneCanvas } = await import('konva/lib/Canvas'))
	;({ ink } = await import('../../../src/scene/nodes/ink.js'))
	;({ nodeSpecFor } = await import('../../../src/scene/nodes/index.js'))
	;({ placeholder } = await import('../../../src/scene/nodes/placeholder.js'))
	;({ VectorContext } = await import('../../../src/scene/vectorContext.js'))
	;({ svgDocument } = await import('../../../src/scene/exportSvg.js'))
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true }
})

const S = '01JA0000000000000000000021'
const stroke = (o = {}) => ({
	id: S, t: 'pen', x: 100, y: 50, w: 104, h: 44, r: 0, z: 'i1', parent: null,
	data: { kind: 'pen', points: [2, 2, 50, 40, 102, 2] }, style: { stroke: '#c43e45', strokeWidth: 4 }, ...o,
})

function draw(it) {
	const vc = new VectorContext({ measure: () => ({ width: 0, shift: 0 }) })
	const canvas = new SceneCanvas({ width: 0, height: 0, pixelRatio: 1 })
	canvas.getContext()._context = vc
	vc.beginGroup(S)
	ink.build(ctx, it, { x: it.x, y: it.y, w: it.w, h: it.h, r: 0 }, 0).root.drawScene(canvas)
	vc.endGroup()
	return { vc, paths: vc.ops.filter((o) => o.op === 'path') }
}

describe('job 273 AK6: the stroke node', () => {
	test('the pen: one stroked path in its colour and width, round caps, opaque, a curve through the middle point', () => {
		const { paths } = draw(stroke())
		assert.equal(paths.length, 1)
		const p = paths[0]
		assert.equal(p.fill, null)
		assert.deepEqual(p.stroke.paint.rgb, [0xc4, 0x3e, 0x45])
		assert.equal(p.stroke.paint.a, 1)
		assert.equal(p.stroke.width, 4)
		assert.equal(p.stroke.cap, 'round')
		assert.equal(p.stroke.join, 'round')
		assert.ok(p.d.some((s) => s[0] === 'C'), 'smoothed (a quadratic curve becomes a cubic one)')
		assert.deepEqual(p.d[0], ['M', 102, 52], 'at its box')
	})

	test('the highlighter is drawn at 0.4; the SVG keeps the stroke', () => {
		const { vc, paths } = draw(stroke({ data: { kind: 'marker', points: [2, 2, 102, 2] }, style: { stroke: '#faea89', strokeWidth: 20 } }))
		assert.ok(Math.abs(paths[0].stroke.paint.a - 0.4) < 1e-9, String(paths[0].stroke.paint.a))
		assert.equal(paths[0].stroke.width, 20)
		const svg = svgDocument(vc.ops, { x: 0, y: 0, w: 400, h: 200 })
		assert.match(svg, /<path [^>]*stroke="#faea89"[^>]*stroke-width="20"/)
	})

	test('nodeSpecFor(pen) is the ink node; missing style falls back to black 4', () => {
		assert.equal(nodeSpecFor('pen'), ink)
		assert.notEqual(nodeSpecFor('pen'), placeholder)
		const { paths } = draw(stroke({ style: {} }))
		assert.deepEqual([paths[0].stroke.paint.rgb, paths[0].stroke.width], [[0x19, 0x1b, 0x1d], 4])
	})
})

describe('job 273 AK6: LOD 2', () => {
	test('a stroke is a line along its points, not a box', () => {
		const m = new SceneModel()
		m.load([stroke()])
		const plan = planCoarse(m, m.query(-1e6, -1e6, 1e6, 1e6), () => false, coarseOrder(m), null, 0.1)
		assert.deepEqual(plan.painted, [S])
		assert.equal(plan.groups.size, 0, 'no box')
		const calls = []
		const c2 = new Proxy({}, {
			get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a])),
			set: (t, k, v) => { t[k] = v; calls.push(['set', k, v]); return true },
		})
		paintCoarse(c2, plan, 0.1)
		assert.ok(calls.some((x) => x[0] === 'translate' && x[1] === 100 && x[2] === 50), 'at its box')
		assert.ok(calls.some((x) => x[0] === 'stroke'))
		assert.ok(calls.some((x) => x[0] === 'set' && x[1] === 'strokeStyle' && x[2] === '#c43e45'))
	})
})
