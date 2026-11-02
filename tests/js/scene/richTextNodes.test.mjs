/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 279 (AK4, AK5, AK7): the text part of notes, shapes, text
 * items and table cells with the real Konva (a fake 2D canvas, as
 * aiCard.test.mjs): a text without marks stays the Konva.Text it was, a text
 * with marks becomes the rich shape, an update swaps them in place, the
 * layout is computed once per change; drawn into a VectorContext (PNG, SVG
 * and PDF take that way) the runs keep bold, italic, the code box, the lines
 * of struck text and links; the link under a point.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const ctx2d = {
	font: '10px sans-serif',
	save() {},
	restore() {},
	clearRect() {},
	fillRect() {},
	scale() {},
	setTransform() {},
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
	measureText(text) {
		const fs = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
		return { width: Array.from(text).length * 0.5 * fs }
	},
}

const measure = (text, font) => Array.from(text).length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)

let ctx
let Konva
let Text
let VectorContext
let SceneCanvas
let svgDocument
let sticky
let shape
let textNode
let table
let isRich
let setText
let textLinkAt

before(async () => {
	globalThis.document = { documentElement: { dataset: {}, lang: 'en' }, createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	Konva = (await import('konva/lib/Core')).default
	;({ Text } = await import('konva/lib/shapes/Text'))
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	;({ SceneCanvas } = await import('konva/lib/Canvas'))
	;({ sticky } = await import('../../../src/scene/nodes/sticky.js'))
	;({ shape } = await import('../../../src/scene/nodes/shape.js'))
	;({ text: textNode } = await import('../../../src/scene/nodes/text.js'))
	;({ table } = await import('../../../src/scene/nodes/table.js'))
	;({ isRich, setText, textLinkAt } = await import('../../../src/scene/nodes/richText.js'))
	;({ VectorContext } = await import('../../../src/scene/vectorContext.js'))
	;({ svgDocument } = await import('../../../src/scene/exportSvg.js'))
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: false, tags: new Map() }
})

const note = (text, o = {}) => ({ id: 'N', t: 'sticky', x: 0, y: 0, w: 240, h: 240, r: 0, z: 'i1', parent: null, data: { text }, style: {}, ...o })
const absOf = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: 0 })

function draw(root) {
	const vc = new VectorContext({ measure: (font, text) => ({ width: measure(text, font), shift: 0 }) })
	const canvas = new SceneCanvas({ width: 0, height: 0, pixelRatio: 1 })
	canvas.getContext()._context = vc
	vc.beginGroup('N')
	root.drawScene(canvas)
	vc.endGroup()
	return { vc, texts: vc.ops.filter((o) => o.op === 'text'), paths: vc.ops.filter((o) => o.op === 'path') }
}

describe('job 279 AK4: the drawing path', () => {
	test('a note, a shape and a text item without marks keep the Konva.Text; with marks the rich shape', () => {
		const plainNote = sticky.build(ctx, note('plain text'), absOf(note('')), 0)
		assert.ok(plainNote.parts.text instanceof Text)
		assert.equal(isRich(plainNote.parts.text), false)
		const rich = sticky.build(ctx, note('**bold** text'), absOf(note('')), 0)
		assert.equal(isRich(rich.parts.text), true)
		assert.equal(rich.parts.text.getAttr('text'), '**bold** text', 'the text as stored, the node lays it out')
		const sh = { id: 'S', t: 'shape', x: 0, y: 0, w: 200, h: 100, r: 0, z: 'i2', parent: null, data: { kind: 'rect', text: '*a*' }, style: {} }
		assert.equal(isRich(shape.build(ctx, sh, absOf(sh), 0).parts.text), true)
		assert.ok(shape.build(ctx, { ...sh, data: { kind: 'rect', text: 'a' } }, absOf(sh), 0).parts.text instanceof Text)
		const tx = { id: 'T', t: 'text', x: 0, y: 0, w: 200, h: 40, r: 0, z: 'i3', parent: null, data: { text: '- a' }, style: {} }
		assert.equal(isRich(textNode.build(ctx, tx, absOf(tx), 0).parts.text), true)
	})

	test('an update swaps the part in place when the text gains or loses marks', () => {
		const it = note('plain')
		const e = sticky.build(ctx, it, absOf(it), 0)
		const index = e.parts.text.zIndex()
		sticky.update(ctx, e, note('now **bold**'), absOf(it), new Set(['data']))
		assert.equal(isRich(e.parts.text), true)
		assert.equal(e.parts.text.getParent(), e.root)
		assert.equal(e.parts.text.zIndex(), index)
		assert.equal(e.root.getChildren().filter((c) => c.getAttr('text') !== undefined).length, 1, 'one text part')
		sticky.update(ctx, e, note('plain again'), absOf(it), new Set(['data']))
		assert.ok(e.parts.text instanceof Text)
		assert.equal(e.parts.text.getAttr('text'), 'plain again')
	})

	test('a hidden text (open editor) stays hidden across a swap', () => {
		const it = note('plain')
		const e = sticky.build(ctx, it, absOf(it), 0, true)
		sticky.update(ctx, e, note('**x**'), absOf(it), new Set(['data']))
		assert.equal(e.parts.text.getAttr('visible'), false)
	})

	test('job 282: a text item that gains a mark in a later line keeps all lines, and losing it again too', async () => {
		const { richLayout } = await import('../../../src/scene/nodes/richText.js')
		const tx = (text) => ({ id: 'T', t: 'text', x: 0, y: 0, w: 200, h: 20, r: 0, z: 'i3', parent: null, data: { text }, style: {} })
		const e = textNode.build(ctx, tx('eins\nzwei\ndrei'), absOf(tx('')), 0)
		assert.ok(e.parts.text instanceof Text)
		textNode.update(ctx, e, tx('eins\n**zwei**\ndrei'), absOf(tx('')), new Set(['text']))
		assert.equal(isRich(e.parts.text), true)
		assert.equal(e.parts.text.attrs.height, undefined, 'no height taken over from the measured plain text')
		const lay = richLayout(e.parts.text, measure)
		assert.equal(lay.lines.length, 3)
		assert.equal(lay.lines.some((l) => l.runs.some((r) => r.text.includes('…'))), false, 'nothing cut')
		const { texts } = draw(e.root)
		assert.deepEqual(texts.map((o) => o.text).join(' ').split(/\s+/).filter(Boolean), ['eins', 'zwei', 'drei'])
		textNode.update(ctx, e, tx('eins\nzwei\ndrei'), absOf(tx('')), new Set(['text']))
		assert.ok(e.parts.text instanceof Text)
		assert.equal(e.parts.text.attrs.height, undefined, 'no height 0 taken over from the rich shape')
		assert.equal(e.parts.text.textArr.length, 3)
	})

	test('job 282: a shape label without a height keeps it unset across a swap', () => {
		const sh = (text) => ({ id: 'S', t: 'shape', x: 0, y: 0, w: 100, h: 100, r: 0, z: 'i2', parent: null, data: { kind: 'bpmnStart', text }, style: {} })
		const e = shape.build(ctx, sh('a\nb'), absOf(sh('')), 0)
		shape.update(ctx, e, sh('a\n**b**'), absOf(sh('')), new Set(['data']))
		assert.equal(isRich(e.parts.text), true)
		shape.update(ctx, e, sh('a\nb'), absOf(sh('')), new Set(['data']))
		assert.equal(e.parts.text.textArr.length, 2)
	})

	test('the layout is computed once per change, not per drawing', () => {
		const it = note('**a** b')
		const e = sticky.build(ctx, it, absOf(it), 0)
		draw(e.root)
		const first = e.parts.text._richLayout
		assert.ok(first)
		draw(e.root)
		assert.equal(e.parts.text._richLayout, first, 'the same layout object')
		sticky.update(ctx, e, note('**a** c'), absOf(it), new Set(['data']))
		draw(e.root)
		assert.notEqual(e.parts.text._richLayout, first)
	})

	test('a table cell: plain Konva.Text or the rich shape, swapped on update', () => {
		const data = {
			cols: { c00000001: { o: 'a', w: 160 } },
			rows: { r00000001: { o: 'a' }, r00000002: { o: 'b' } },
			cells: { c00000001: { r00000001: 'Head', r00000002: '**x** y' } },
		}
		const it = { id: 'B', t: 'table', x: 0, y: 0, w: 160, h: 80, r: 0, z: 'i4', parent: null, data, style: {} }
		const e = table.build(ctx, it, absOf(it), 0)
		const nodes = [...e.parts.texts.values()]
		assert.equal(nodes.filter((n) => isRich(n)).length, 1)
		assert.equal(nodes.filter((n) => n instanceof Text).length, 1)
		const next = { ...it, data: { ...data, cells: { c00000001: { r00000001: '*Head*', r00000002: 'x y' } } } }
		table.update(ctx, e, next, absOf(next), new Set(['data']))
		const after = [...e.parts.texts.values()]
		assert.equal(after.filter((n) => isRich(n)).length, 1)
		assert.equal(after.filter((n) => isRich(n))[0].getAttr('fontStyle'), 'bold', 'the header row stays bold')
	})
})

describe('job 279 AK5: exports draw the text formatted', () => {
	test('bold, italic, struck, code and a link in the vector context and the SVG', () => {
		const it = note('**a** *b* ~~c~~ `d` [e](https://e.de)')
		const e = sticky.build(ctx, it, absOf(it), 0)
		const { vc, texts, paths } = draw(e.root)
		const by = (s) => texts.find((t) => t.text === s)
		assert.equal(by('a').bold, true)
		assert.equal(by('b').italic, true)
		assert.ok(by('c') && by('d') && by('e'))
		assert.match(by('d').font, /monospace/)
		assert.ok(!texts.some((t) => /\*\*|~~|`|\]\(/.test(t.text)), 'no marks drawn')
		// the line through c, the line under e, the box behind d: thin and filled
		assert.ok(paths.filter((p) => p.fill).length >= 3, 'three filled paths: strike, underline, code box')
		const svg = svgDocument(vc.ops, { x: 0, y: 0, w: 240, h: 240 })
		assert.match(svg, /<text [^>]*font-weight="bold"[^>]*>a<\/text>/)
		assert.doesNotMatch(svg, /\*\*a\*\*/)
	})

	test('a list: the marker and the item text', () => {
		const it = note('- one\n2. two')
		const { texts } = draw(sticky.build(ctx, it, absOf(it), 0).root)
		assert.ok(texts.some((t) => t.text === '•') && texts.some((t) => t.text === '2.'))
		assert.ok(texts.some((t) => t.text === 'one') && texts.some((t) => t.text === 'two'))
	})
})

describe('job 279 AK7: the link under a point', () => {
	test('textLinkAt in the node\'s coordinates; a plain text has none', () => {
		const n = new Konva.Shape({ text: 'ab [cd](https://c.de)', width: 200, fontSize: 10, lineHeight: 1.2, align: 'left', fontFamily: 'A', rich: true })
		assert.equal(textLinkAt(n, 20, 5, measure), 'https://c.de')
		assert.equal(textLinkAt(n, 2, 5, measure), null)
		assert.equal(textLinkAt(new Text({ text: 'https://c.de' }), 2, 5, measure), null)
	})

	test('setText keeps the node when the kind stays', () => {
		const it = note('**a**')
		const e = sticky.build(ctx, it, absOf(it), 0)
		const n = e.parts.text
		assert.equal(setText(ctx, n, { text: '*b*' }), n)
	})
})
