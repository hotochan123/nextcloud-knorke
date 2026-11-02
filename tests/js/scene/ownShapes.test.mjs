/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 203 (own shape libraries), the picture of an own shape (kind
 * image) in the scene:
 * - imageCache.js: one decoded image per picture, null while it loads,
 *   listeners after the load, whenImagesReady with its timeout, pictureOf
 *   per stored item
 * - AK6 the shape node: the placeholder (light grey box, 1-unit border)
 *   until the picture is decoded, then drawImage over the box; no text
 *   inside (job 235 AK2: a label below, before and after the decode)
 * - AK6 LOD 2: the picture from COARSE_PICTURE_MIN_PX on, below a grey box;
 *   a rotated one turned about its centre; painted after the fills and
 *   before the lines (job 202's outlines, borders and connectors)
 * - AK7 the exports: SVG an <image> with the data URI, its box and matrix;
 *   PDF an image XObject from rasterizeImage under the matrix
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { imageFor, onImageReady, pictureOf, setImageFactory, whenImagesReady } from '../../../src/scene/imageCache.js'
import { bodyAttrs, shape, shapeTextAttrs } from '../../../src/scene/nodes/shape.js'
import { COARSE_PICTURE_MIN_PX, coarseLook, paintCoarse, planCoarse } from '../../../src/scene/nodes/coarse.js'
import { svgDocument } from '../../../src/scene/exportSvg.js'
import { pdfDocument } from '../../../src/scene/exportPdf.js'
import { VectorContext } from '../../../src/scene/vectorContext.js'
import { PLACEHOLDER_FILL, PLACEHOLDER_STROKE } from '../../../src/model/tokens.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SVG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')

/** Fake images: loading starts at `src =`, load() or fail() ends it. */
let made = []
const factory = () => {
	const img = { complete: false, naturalWidth: 0, onload: null, onerror: null, set src(v) { this._src = v }, get src() { return this._src } }
	img.load = () => {
		img.complete = true
		img.naturalWidth = 10
		img.onload?.()
	}
	img.fail = () => img.onerror?.()
	made.push(img)
	return img
}

beforeEach(() => {
	made = []
	setImageFactory(factory)
})

const item = (o = {}) => ({ id: 'P', t: 'shape', x: 10, y: 20, w: 96, h: 48, r: 0, data: { kind: 'image', img: [PNG.slice(0, 50), PNG.slice(50)] }, style: { strokeWidth: 0, fillOpacity: 0 }, ...o })

describe('imageCache', () => {
	test('one image per picture; null while it loads; the listeners after the load; a failed one stays null', () => {
		const heard = []
		const off = onImageReady((uri) => heard.push(uri))
		assert.equal(imageFor(PNG), null)
		assert.equal(imageFor(PNG), null)
		assert.equal(made.length, 1, 'loaded once')
		assert.equal(made[0].src, PNG)
		made[0].load()
		assert.equal(imageFor(PNG), made[0])
		assert.deepEqual(heard, [PNG])
		imageFor(SVG)
		made[1].fail()
		assert.equal(imageFor(SVG), null)
		assert.deepEqual(heard, [PNG], 'no draw for a failure')
		off()
		assert.equal(imageFor(''), null)
		assert.equal(imageFor(null), null)
	})

	test('whenImagesReady: at once without open loads, else at the last load or after the timeout', async () => {
		await whenImagesReady([], 10)
		let done = false
		const p = whenImagesReady([PNG, SVG, PNG], 10000).then(() => { done = true })
		made[0].load()
		await Promise.resolve()
		assert.equal(done, false)
		made[1].fail()
		await p
		assert.equal(done, true)
		const slow = Date.now()
		await whenImagesReady(['data:image/gif;base64,R0lG'], 30)
		assert.ok(Date.now() - slow >= 25, 'the timeout ends the wait')
	})

	test('pictureOf: the joined data.img of a shape of kind image, cached per stored item; null otherwise', () => {
		const it = item()
		assert.equal(pictureOf(it), PNG)
		it.data.img = ['x']
		assert.equal(pictureOf(it), PNG, 'per stored object (the model replaces items)')
		assert.equal(pictureOf(item({ data: { kind: 'rect', img: [PNG] } })), null)
		assert.equal(pictureOf(item({ data: { kind: 'image', img: ['data:image/bmp;base64,AAAA'] } })), null)
		assert.equal(pictureOf(item({ t: 'sticky' })), null)
		assert.equal(pictureOf(null), null)
	})
})

/** Konva-like nodes of the builder context */
class FakeNode {
	constructor(attrs = {}) {
		this.attrs = { ...attrs }
		this.children = []
	}

	setAttrs(a) { Object.assign(this.attrs, a) }
	getAttr(k) { return this.attrs[k] }
	visible(v) { this.attrs.visible = v }
	width() { return this.attrs.width }
	height() { return this.attrs.height }
	transformsEnabled() {}
	add(...c) { this.children.push(...c) }
}
const builder = { Group: FakeNode, Rect: FakeNode, Text: FakeNode, Shape: FakeNode, Line: FakeNode, shadows: false }

/** @return {{calls: Array, ctx: object}} a recording canvas context */
function recorder() {
	const calls = []
	const rec = (name) => (...a) => calls.push([name, ...a])
	const ctx = {
		beginPath: rec('beginPath'), rect: rec('rect'), closePath: rec('closePath'), fillStrokeShape: rec('fillStrokeShape'),
		drawImage: rec('drawImage'), fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]), save: rec('save'), restore: rec('restore'),
		translate: rec('translate'), rotate: rec('rotate'), strokeShape: rec('strokeShape'),
	}
	return { calls, ctx }
}

describe('job 203 AK6: the shape node of an own shape', () => {
	test('the placeholder until the picture is decoded, then the picture over the box; no text inside', () => {
		const it = item()
		const a = bodyAttrs(it, { w: 96, h: 48 })
		assert.deepEqual([a.kind, a.picture, a.fill, a.fillEnabled, a.stroke, a.strokeWidth, a.strokeEnabled], ['image', PNG, PLACEHOLDER_FILL, true, PLACEHOLDER_STROKE, 1, true])
		const e = shape.build(builder, it, { x: 10, y: 20, w: 96, h: 48, r: 0 }, 0)
		const body = e.parts.body
		let r = recorder()
		body.attrs.sceneFunc(r.ctx, body)
		assert.deepEqual(r.calls.map((c) => c[0]), ['beginPath', 'rect', 'closePath', 'fillStrokeShape'], 'the grey box while it loads')
		made[0].load()
		r = recorder()
		body.attrs.sceneFunc(r.ctx, body)
		assert.deepEqual(r.calls, [['drawImage', made[0], 0, 0, 96, 48]])
		assert.equal(e.parts.text.attrs.text, '', 'no label: no text')
	})

	test('job 235 AK2: a label stands centred below the picture, in the text colour, the same before and after the decode', () => {
		const it = item({ data: { kind: 'image', img: [PNG], text: 'Server' }, style: { strokeWidth: 0, fillOpacity: 0, textColor: '#c43e45' } })
		const e = shape.build(builder, it, { x: 10, y: 20, w: 96, h: 48, r: 0 }, 0)
		const before = { ...e.parts.text.attrs }
		assert.equal(before.text, 'Server')
		assert.ok(before.y >= 48, 'below the box')
		assert.ok(Math.abs(before.x + before.width / 2 - 48) < 1e-9, 'centred under the box')
		assert.deepEqual([before.align, before.fill, before.fontSize], ['center', '#c43e45', 16])
		assert.equal(shapeTextAttrs(it, { w: 96, h: 48 }).y, 48 + 6, 'SYMBOL_LABEL_GAP below the box')
		const body = e.parts.body
		let r = recorder()
		body.attrs.sceneFunc(r.ctx, body)
		assert.deepEqual(r.calls.map((c) => c[0]), ['beginPath', 'rect', 'closePath', 'fillStrokeShape'], 'the grey box while it loads')
		made[0].load()
		r = recorder()
		body.attrs.sceneFunc(r.ctx, body)
		assert.deepEqual(r.calls, [['drawImage', made[0], 0, 0, 96, 48]], 'the picture over the box, as before')
		shape.update(builder, e, it, { x: 10, y: 20, w: 96, h: 48, r: 0 }, new Set(['data']))
		assert.deepEqual([e.parts.text.attrs.x, e.parts.text.attrs.y, e.parts.text.attrs.text], [before.x, before.y, 'Server'], 'unchanged after the decode')
	})
})

describe('job 203 AK6: LOD 2', () => {
	const model = (items) => ({
		get: (id) => items.find((x) => x.id === id) ?? null,
		abs: (id) => {
			const x = items.find((i) => i.id === id)
			return x ? { x: x.x, y: x.y, w: x.w, h: x.h, r: x.r } : null
		},
	})

	test('the look is image; the plan lists own shapes apart; the picture from 4 px on, below a grey box; rotated about the centre', () => {
		const a = item({ id: 'A' })
		const b = item({ id: 'B', x: 500, w: 40, h: 40, r: 90 })
		assert.deepEqual(coarseLook(a), { cls: 'image', color: PLACEHOLDER_FILL, title: '', src: PNG })
		const order = { ids: ['A', 'B'], rank: new Map([['A', 0], ['B', 1]]) }
		const plan = planCoarse(model([a, b]), [{ id: 'A', t: 'shape' }, { id: 'B', t: 'shape' }], () => false, order)
		assert.deepEqual(plan.images, [{ x: 10, y: 20, w: 96, h: 48, r: 0, src: PNG }, { x: 500, y: 20, w: 40, h: 40, r: 90, src: PNG }])
		assert.equal(plan.groups.size, 0)
		// not decoded yet: grey boxes
		let r = recorder()
		paintCoarse(r.ctx, plan, 0.1)
		assert.deepEqual(r.calls.filter((c) => c[0] === 'fillRect').map((c) => c[1]), [PLACEHOLDER_FILL, PLACEHOLDER_FILL])
		made[0].load()
		r = recorder()
		paintCoarse(r.ctx, plan, 0.1)
		assert.deepEqual(r.calls, [
			['drawImage', made[0], 10, 20, 96, 48],
			['save'], ['translate', 520, 40], ['rotate', Math.PI / 2], ['drawImage', made[0], -20, -20, 40, 40], ['restore'],
		])
		// 48 × 0.08 = 3.84 px: below COARSE_PICTURE_MIN_PX the box
		r = recorder()
		paintCoarse(r.ctx, { ...plan, images: [plan.images[0]] }, 0.08)
		assert.ok(48 * 0.08 < COARSE_PICTURE_MIN_PX)
		assert.deepEqual(r.calls, [['fillRect', PLACEHOLDER_FILL, 10, 20, 96, 48]])
	})

	test('beside job 202\'s outlines: the picture after the fills, before the lines', () => {
		const pic = item({ id: 'A' })
		const rect = { id: 'R', t: 'shape', x: 200, y: 20, w: 96, h: 48, r: 0, data: { kind: 'rect' }, style: { fill: '#ff0000', fillOpacity: 100, stroke: '#0000ff', strokeWidth: 2 } }
		const order = { ids: ['R', 'A'], rank: new Map([['R', 0], ['A', 1]]) }
		const plan = planCoarse(model([pic, rect]), [{ id: 'R', t: 'shape' }, { id: 'A', t: 'shape' }], () => false, order, null, 0.1)
		assert.equal(plan.images.length, 1)
		assert.equal(plan.shapes.size, 1)
		assert.equal(plan.lines.size, 1)
		imageFor(PNG)
		made[0].load()
		const calls = []
		const ctx = new Proxy({}, {
			get: (t, k) => (k in t ? t[k] : (...a) => calls.push(k)),
			set: (t, k, v) => { t[k] = v; return true },
		})
		paintCoarse(ctx, plan, 0.1)
		const at = (name) => calls.indexOf(name)
		assert.ok(at('fill') >= 0 && at('fill') < at('drawImage') && at('drawImage') < at('stroke'), calls.join(' '))
	})
})

describe('job 203 AK7: the exports', () => {
	test('SVG: an <image> with the data URI, its box, the matrix and its opacity, stretched', () => {
		const c = new VectorContext()
		c.beginGroup('P')
		c.translate(10, 20)
		c.globalAlpha = 0.5
		c.drawImage({ src: PNG }, 0, 0, 96, 48)
		c.endGroup()
		const svg = svgDocument(c.ops, { x: 0, y: 0, w: 200, h: 100 })
		assert.match(svg, /<g id="item-P">\n<image x="0" y="0" width="96" height="48" preserveAspectRatio="none" opacity="0\.5" transform="matrix\(1 0 0 1 10 20\)" xlink:href="data:image\/png;base64,iVBOR[^"]+"\/>\n<\/g>/)
		assert.doesNotMatch(svg, /<script|foreignObject|https?:\/\/(?!www\.w3\.org)/)
	})

	test('PDF: the picture rasterised at the text images\' resolution, an image XObject drawn under the matrix', async () => {
		const c = new VectorContext()
		c.translate(10, 20)
		c.drawImage({ src: PNG }, 0, 0, 96, 48)
		const asked = []
		const rasterizeImage = (src, w, h) => {
			asked.push([src, w, h])
			return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }
		}
		const { bytes } = await pdfDocument(c.ops, { x: 0, y: 0, w: 200, h: 100 }, { rasterizeImage, deflate: null })
		const text = Buffer.from(bytes).toString('latin1')
		assert.deepEqual(asked, [[PNG, 384, 192]], '4 px per unit')
		assert.match(text, /\/Subtype \/Image \/Width 384 \/Height 192/)
		assert.match(text, /q\n\/A\d+ gs\n1 0 0 1 10 20 cm\n96 0 0 -48 0 48 cm\n\/I1 Do\nQ/)
		const none = Buffer.from((await pdfDocument(c.ops, { x: 0, y: 0, w: 200, h: 100 }, { deflate: null })).bytes).toString('latin1')
		assert.doesNotMatch(none, /\/Subtype \/Image/, 'without a rasteriser: nothing')
	})
})
