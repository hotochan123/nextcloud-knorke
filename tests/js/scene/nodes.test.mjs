/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Node builders of the M1 types (SPEC-M1 §3.10, §6.3 "Knoten", LOD table),
 * in Node with a fake builder context instead of Konva (the builders only
 * use ctx.{Group, Rect, Text, Shape, Line}):
 * - shape: outline attributes from fieldValue (fill alpha, no fill at
 *   fillOpacity 0, no stroke at width 0, dash patterns, unknown kind → rect),
 *   the outline path per kind, the text box and auto-fit vs. stored size,
 *   LOD 1 without text, updates in place
 * - text: wrap width, font size, color, align; levelOf with TEXT_MIN_PX
 *   inside LOD 1; grey line bars at level 1; editing hides both
 * - connector (round 1b): root at (0, 0) without place(), the line Shape from
 *   the route (points, bezier, cap angles) and fieldValue (stroke, width,
 *   dash, caps; rule 18 defaults), the sceneFunc strokes the path dashed and
 *   the caps solid, shortened under filled caps; the label (bg + text) only
 *   at LOD 0 and only with a label box; place() follows route changes;
 *   editing hides the label
 * - sticky (job 135): the text colour follows the fill (noteTextColor),
 *   when the text is built (also later, by setLod) and on a style update;
 *   a shape keeps its style.textColor on a dark fill
 * - every Konva node is built with listening false and perfectDrawEnabled false
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { bodyAttrs, dashFor, shape, shapeTextBox, traceOutline, withAlpha } from '../../../src/scene/nodes/shape.js'
import { barAttrs, text, textItemAttrs } from '../../../src/scene/nodes/text.js'
import { nodeSpecFor } from '../../../src/scene/nodes/index.js'
import { placeholder } from '../../../src/scene/nodes/placeholder.js'
import { sticky } from '../../../src/scene/nodes/sticky.js'
import { capCut, connector, drawCap, drawConnector, lineAttrs, shortened } from '../../../src/scene/nodes/connector.js'
import { capSize, labelBox, routeConnector } from '../../../src/model/connectors.js'
import { autoFontSize } from '../../../src/model/text.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { coarseLook } from '../../../src/scene/nodes/coarse.js'
import { FONT_FAMILY, LIGHT, SHAPE_TEXT_PADDING, STICKY_COLORS, TEXT_BAR_COLOR, TEXT_COLOR, TEXT_MIN_PX } from '../../../src/model/tokens.js'

const built = []

class FakeNode {
	constructor(attrs = {}) {
		this.attrs = { ...attrs }
		this.children = []
		this.kind = this.constructor.name
		built.push(this)
	}

	setAttrs(a) { Object.assign(this.attrs, a) }
	getAttr(k) { return this.attrs[k] }
	setAttr(k, v) { this.attrs[k] = v }
	visible(v) {
		if (v === undefined) return this.attrs.visible !== false
		this.attrs.visible = v
		return this
	}

	fill(v) {
		if (v === undefined) return this.attrs.fill
		this.attrs.fill = v
		return this
	}

	width() { return this.attrs.width }
	height() { return this.attrs.height }
	transformsEnabled(v) { this.attrs.transformsEnabled = v }
	add(...c) { this.children.push(...c) }
	destroy() {}
}
class Group extends FakeNode {}
class Rect extends FakeNode {}
class Text extends FakeNode {
	// automatic height like Konva (one line per paragraph: the fake does not wrap)
	height() {
		const a = this.attrs
		return a.height ?? String(a.text ?? '').split('\n').length * a.fontSize * (a.lineHeight ?? 1)
	}
}
class Shape extends FakeNode {}
class Line extends FakeNode {}
const ctx = { Group, Rect, Text, Shape, Line, shadows: true }

/** Records path calls of a sceneFunc. */
function fakeContext() {
	const calls = []
	const rec = (name) => (...a) => calls.push([name, ...a])
	return {
		calls,
		beginPath: rec('beginPath'), closePath: rec('closePath'), rect: rec('rect'), moveTo: rec('moveTo'),
		lineTo: rec('lineTo'), arcTo: rec('arcTo'), ellipse: rec('ellipse'), fillStrokeShape: rec('fillStrokeShape'),
		fillShape: rec('fillShape'), bezierCurveTo: rec('bezierCurveTo'), strokeShape: rec('strokeShape'),
		setLineDash: rec('setLineDash'), arc: rec('arc'), fill: rec('fill'), stroke: rec('stroke'), setAttr: rec('setAttr'),
	}
}

const shapeItem = (o = {}) => ({ id: 'S', t: 'shape', x: 0, y: 0, w: 200, h: 100, r: 0, data: { kind: 'rect', text: 'Idee' }, style: { fill: '#ffffff', stroke: '#191b1d', strokeWidth: 2 }, ...o })
const abs = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: it.r })
const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0

describe('shape node', () => {
	test('outline attributes through fieldValue: fill alpha, fillEnabled, stroke, dash, unknown kind and enum values', () => {
		const a = bodyAttrs(shapeItem({ style: { fill: '#FF0000', fillOpacity: 50, stroke: '#00ff00', strokeWidth: 3, dash: 'dashed' } }), { w: 200, h: 100 })
		assert.equal(a.fill, 'rgba(255,0,0,0.5)')
		assert.equal(a.fillEnabled, true)
		assert.equal(a.stroke, '#00ff00')
		assert.deepEqual([a.strokeWidth, a.strokeEnabled, a.dashEnabled], [3, true, true])
		assert.deepEqual(a.dash, [12, 9])
		const none = bodyAttrs(shapeItem({ data: { kind: 'heptagon' }, style: { fillOpacity: 0, strokeWidth: 0, dash: 'wavy' } }), { w: 10, h: 10 })
		assert.deepEqual([none.kind, none.fillEnabled, none.strokeEnabled, none.dashEnabled], ['rect', false, false, false])
		const def = bodyAttrs({ t: 'shape', data: {}, style: {} }, { w: 1, h: 1 })
		// job 260: the default border is #3d4044 (F4)
		assert.deepEqual([def.fill, def.stroke, def.strokeWidth, def.kind], ['#ffffff', '#3d4044', 2, 'rect'], '§3.10 defaults')
		assert.equal(bodyAttrs(shapeItem({ style: { dash: 'dotted', strokeWidth: 2 } }), { w: 1, h: 1 }).lineCap, 'round')
		assert.equal(withAlpha('#123456', 100), '#123456')
		assert.equal(dashFor('solid', 4), null)
	})

	test('outline path per kind: rect, rounded rect (arcs), ellipse, polygon; unknown kind → rect', () => {
		const paths = {}
		for (const kind of ['rect', 'roundRect', 'ellipse', 'triangle', 'arrowRight', 'nope']) {
			const c = fakeContext()
			traceOutline(c, kind, 200, 100)
			paths[kind] = c.calls.map((x) => x[0])
		}
		// job 260: rect, triangle and arrow have rounded corners (corner 4)
		assert.deepEqual(paths.rect, ['beginPath', 'moveTo', 'lineTo', 'arcTo', 'lineTo', 'arcTo', 'lineTo', 'arcTo', 'lineTo', 'arcTo', 'closePath'])
		assert.deepEqual(paths.nope, paths.rect)
		assert.equal(paths.roundRect.filter((n) => n === 'arcTo').length, 4)
		assert.deepEqual(paths.ellipse, ['beginPath', 'moveTo', 'ellipse', 'closePath'])
		assert.deepEqual(paths.triangle, ['beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'closePath'])
		assert.equal(paths.arrowRight.filter((n) => n === 'arcTo').length, 7)
		const c = fakeContext()
		traceOutline(c, 'roundRect', 200, 100)
		assert.deepEqual(c.calls[1], ['moveTo', 16, 0], 'job 260: a fixed radius 16')
	})

	test('job 260 AK5: corner radii: rect 4, roundRect 16 (at most half a side), diamond 4; ellipse and BPMN as before', () => {
		const radii = (kind, w, h) => {
			const c = fakeContext()
			traceOutline(c, kind, w, h)
			return c.calls.filter((x) => x[0] === 'arcTo').map((x) => x[5])
		}
		assert.deepEqual(radii('rect', 200, 120), [4, 4, 4, 4])
		assert.deepEqual(radii('roundRect', 200, 120), [16, 16, 16, 16])
		assert.deepEqual(radii('roundRect', 20, 20), [10, 10, 10, 10])
		assert.deepEqual(radii('diamond', 160, 160), [4, 4, 4, 4])
		assert.deepEqual(radii('document', 200, 120).slice(0, 2), [4, 4], 'the two top corners')
		assert.deepEqual(radii('ellipse', 160, 160), [])
		assert.deepEqual(radii('bpmnTask', 180, 120), [12, 12, 12, 12], 'BPMN task: radius 0.1 × min(w, h) as before')
		assert.deepEqual(radii('parallelogram', 200, 120), [], 'not in the list of the request: sharp')
		// the arcs pass through the sharp corners of the diamond (hit test and anchors keep them)
		const c = fakeContext()
		traceOutline(c, 'diamond', 160, 160)
		assert.deepEqual(c.calls.filter((x) => x[0] === 'arcTo').map((x) => [x[1], x[2]]), [[80, 0], [160, 80], [80, 160], [0, 80]])
		assert.deepEqual(c.calls[1], ['moveTo', 40, 40], 'starts in the middle of the last edge')
	})

	test('job 260 risk: tiny and thin shapes round without NaN, the radius capped by half the shorter edge', () => {
		for (const [kind, w, h] of [['diamond', 10, 10], ['triangle', 10, 200], ['arrowRight', 20, 10], ['rect', 10, 10], ['roundRect', 10, 4], ['document', 10, 10]]) {
			const c = fakeContext()
			traceOutline(c, kind, w, h)
			for (const call of c.calls) {
				for (const v of call.slice(1)) assert.ok(Number.isFinite(v), `${kind} ${w} × ${h}: ${call}`)
			}
			for (const a of c.calls.filter((x) => x[0] === 'arcTo')) assert.ok(a[5] >= 0 && a[5] <= 4 + 1e-9 && a[5] <= Math.min(w, h) / 2 + 1e-9, `${kind}: ${a}`)
		}
		const c = fakeContext()
		traceOutline(c, 'diamond', 10, 10)
		assert.ok(Math.abs(c.calls.find((x) => x[0] === 'arcTo')[5] - Math.hypot(5, 5) / 2) < 1e-9, 'half of the 7.07 edge')
	})

	test('job 260 AK2: the old default border draws as #3d4044 on basic and flowchart shapes, BPMN stays black; joins round with corners', () => {
		const old = (kind) => bodyAttrs(shapeItem({ data: { kind, text: '' }, style: { stroke: '#191b1d', strokeWidth: 2 } }), { w: 200, h: 100 })
		assert.equal(old('rect').stroke, '#3d4044')
		assert.equal(old('database').stroke, '#3d4044')
		assert.equal(old('nope').stroke, '#3d4044', 'an unknown kind draws as rect')
		assert.equal(old('bpmnTask').stroke, '#191b1d')
		assert.equal(old('bpmnTask').markColor, '#191b1d')
		assert.equal(bodyAttrs(shapeItem({ style: { stroke: '#0275a9' } }), { w: 1, h: 1 }).stroke, '#0275a9')
		assert.equal(old('rect').lineJoin, 'round')
		assert.equal(old('ellipse').lineJoin, 'miter')
		assert.equal(old('bpmnTask').lineJoin, 'miter')
	})

	test('text box per kind; stored font size wins, else auto-fit in the box', () => {
		// job 260: triangle from 60 % of the height, 58 % wide, padding 4
		const tri = shapeTextBox(shapeItem({ w: 200, h: 200, data: { kind: 'triangle', text: 'x' } }), { w: 200, h: 200 })
		assert.deepEqual([tri.x, tri.y, tri.w, tri.h, tri.pad].map(r6), [42, 120, 116, 80, 4])
		assert.equal(tri.fontSize, autoFontSize('x', tri.w, tri.h, 4))
		const stored = shapeTextBox(shapeItem({ style: { fontSize: 40, align: 'left', valign: 'top', textColor: '#c43e45' } }), { w: 200, h: 100 })
		assert.deepEqual([stored.fontSize, stored.align, stored.valign, stored.color], [40, 'left', 'top', '#c43e45'])
		const def = shapeTextBox(shapeItem({ style: { fontSize: 7, align: 'justify' } }), { w: 200, h: 100 })
		assert.deepEqual([def.align, def.valign, def.color], ['center', 'middle', '#191b1d'])
		assert.equal(def.fontSize, autoFontSize('Idee', 200, 100, 12), 'invalid stored size → auto-fit (job 260: padding 12)')
	})

	test('job 260 AK6: text boxes and paddings of design round 3 (F4)', () => {
		const box = (kind, w, h) => {
			const b = shapeTextBox(shapeItem({ w, h, data: { kind, text: 'x' } }), { w, h })
			return [b.x, b.y, b.w, b.h, b.pad].map(r6)
		}
		assert.deepEqual(box('diamond', 160, 160), [33.6, 49.6, 92.8, 60.8, 4])
		assert.deepEqual(box('triangle', 160, 140), [33.6, 84, 92.8, 56, 4])
		assert.deepEqual(box('ellipse', 160, 160), [12.8, 36.8, 134.4, 86.4, 8])
		assert.deepEqual(box('rect', 200, 120), [0, 0, 200, 120, 12])
		assert.deepEqual(box('roundRect', 200, 120).at(-1), 12)
		assert.deepEqual(box('arrowRight', 200, 100), [0, 25, 130, 50, 12], 'the shaft as before')
		for (const k of ['document', 'database']) assert.equal(box(k, 200, 120).at(-1), 12, k)
		for (const k of ['terminal', 'hexagon', 'bpmnTask']) assert.equal(box(k, 200, 120).at(-1), SHAPE_TEXT_PADDING, k)
		// long text still shrinks to fit
		const long = shapeTextBox(shapeItem({ w: 160, h: 160, data: { kind: 'diamond', text: 'Ein langer Text '.repeat(6) } }), { w: 160, h: 160 })
		assert.ok(long.fontSize < 20, String(long.fontSize))
	})

	test('build: outline Shape with a sceneFunc, text at LOD 0 only; setLod and setTextHidden toggle the text', () => {
		const it = shapeItem()
		const e = shape.build(ctx, it, abs(it), 0)
		assert.equal(e.parts.body.kind, 'Shape')
		assert.equal(typeof e.parts.body.attrs.sceneFunc, 'function')
		assert.equal(e.parts.text.attrs.text, 'Idee')
		assert.deepEqual([e.parts.text.attrs.x, e.parts.text.attrs.y], [12, 12], 'job 260: padding 12')
		const c = fakeContext()
		e.parts.body.attrs.sceneFunc(c, e.parts.body)
		assert.deepEqual(c.calls.map((x) => x[0]), [...['beginPath', 'moveTo', 'lineTo', 'arcTo', 'lineTo', 'arcTo', 'lineTo', 'arcTo', 'lineTo', 'arcTo', 'closePath'], 'fillStrokeShape'])
		shape.setTextHidden(e, true)
		assert.equal(e.parts.text.visible(), false)
		shape.setTextHidden(e, false)
		shape.setLod(ctx, e, it, abs(it), 1)
		assert.equal(e.parts.text.visible(), false)
		const far = shape.build(ctx, it, abs(it), 1)
		assert.equal(far.parts.text, null, 'no text node at LOD 1')
		shape.setLod(ctx, far, it, abs(it), 0)
		assert.equal(far.parts.text.attrs.text, 'Idee')
	})

	test('update in place: kind, style, geometry, text; a type change rebuilds', () => {
		const it = shapeItem()
		const e = shape.build(ctx, it, abs(it), 0)
		const next = shapeItem({ w: 300, data: { kind: 'diamond', text: 'neu' }, style: { fill: '#000000', strokeWidth: 0 } })
		assert.equal(shape.update(ctx, e, next, abs(next), new Set(['geom', 'data', 'style', 'text'])), false)
		assert.deepEqual([e.parts.body.attrs.kind, e.parts.body.attrs.width, e.parts.body.attrs.fill, e.parts.body.attrs.strokeEnabled], ['diamond', 300, '#000000', false])
		assert.equal(e.parts.text.attrs.text, 'neu')
		assert.equal(r6(e.parts.text.attrs.x), r6(0.21 * 300 + 4), 'text box of the new kind (job 260: 21 %, padding 4)')
		assert.equal(shape.update(ctx, e, next, abs(next), new Set(['type'])), true)
	})
})

describe('job 260 AK8: old boards load', () => {
	test('shapes without border, with a broken one, an unknown kind and 0.4.0 values load and draw a border', () => {
		const items = [
			shapeItem({ id: 'A', style: { fill: '#ffffff', strokeWidth: 2 } }),
			shapeItem({ id: 'B', style: { stroke: 'kaputt', strokeWidth: 2 } }),
			shapeItem({ id: 'C', data: { kind: 'zukunft', text: 'x' } }),
			shapeItem({ id: 'D', data: { kind: 'roundRect', text: 'alt' }, style: { fill: '#fff6b6', stroke: '#191b1d', strokeWidth: 2 } }),
			shapeItem({ id: 'E', data: { kind: 'diamond', text: '' }, w: 10, h: 10 }),
			shapeItem({ id: 'F', data: { kind: 'bpmnTask', text: 'Task' } }),
		]
		const m = new SceneModel()
		m.load(items)
		assert.equal(m.size, items.length)
		const want = { A: '#3d4044', B: '#3d4044', C: '#3d4044', D: '#3d4044', E: '#3d4044', F: '#191b1d' }
		for (const it of items) {
			const e = shape.build(ctx, it, m.abs(it.id), 0)
			assert.equal(e.parts.body.attrs.stroke, want[it.id], it.id)
			assert.equal(e.parts.body.attrs.strokeEnabled, true, it.id)
			const c = fakeContext()
			e.parts.body.attrs.sceneFunc(c, e.parts.body)
			assert.ok(c.calls.some((x) => x[0] === 'fillStrokeShape'), it.id)
			assert.equal(coarseLook(it).stroke, want[it.id], `${it.id} at LOD 2`)
		}
	})
})

describe('sticky node (job 135, AK8)', () => {
	const note = (fill) => ({ id: 'N', t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, data: { text: 'Idee' }, style: { fill } })

	test('the text colour follows the fill: every note colour TEXT_COLOR, a dark custom fill (and Black) white', () => {
		// job 227: the old note colours and the light tones but Black
		for (const c of [...STICKY_COLORS, ...LIGHT.filter((x) => x !== '#191b1d')]) {
			assert.equal(sticky.build(ctx, note(c), abs(note(c)), 0).parts.text.attrs.fill, TEXT_COLOR, c)
		}
		for (const c of ['#191b1d', '#9550bb', '#1f3a5f']) {
			assert.equal(sticky.build(ctx, note(c), abs(note(c)), 0).parts.text.attrs.fill, '#ffffff', c)
		}
		// an invalid stored fill draws as the default note colour (rule 18), so with TEXT_COLOR
		assert.equal(sticky.build(ctx, note('dark'), abs(note('dark')), 0).parts.text.attrs.fill, TEXT_COLOR)
	})

	test('update: light → dark → light switches the text colour in place; a text built later by setLod gets it too', () => {
		const light = note(STICKY_COLORS[0])
		const dark = note('#191b1d')
		const e = sticky.build(ctx, light, abs(light), 0)
		assert.equal(e.parts.text.attrs.fill, TEXT_COLOR)
		assert.equal(sticky.update(ctx, e, dark, abs(dark), new Set(['style'])), false)
		assert.equal(e.parts.body.attrs.fill, '#191b1d')
		assert.equal(e.parts.text.attrs.fill, '#ffffff')
		sticky.update(ctx, e, light, abs(light), new Set(['style']))
		assert.equal(e.parts.text.attrs.fill, TEXT_COLOR)
		const far = sticky.build(ctx, dark, abs(dark), 1)
		assert.equal(far.parts.text, null, 'no text node at LOD 1')
		sticky.setLod(ctx, far, dark, abs(dark), 0)
		assert.equal(far.parts.text.attrs.fill, '#ffffff')
	})

	test('a shape on the fill #191b1d keeps its text colour (no automatic text colour)', () => {
		const dark = shapeItem({ style: { fill: '#191b1d', stroke: '#191b1d', strokeWidth: 2 } })
		assert.equal(shape.build(ctx, dark, abs(dark), 0).parts.text.attrs.fill, '#191b1d', 'the default text colour stays')
		const red = shapeItem({ style: { fill: '#191b1d', textColor: '#c43e45' } })
		assert.equal(shape.build(ctx, red, abs(red), 0).parts.text.attrs.fill, '#c43e45')
	})
})

describe('text node', () => {
	const textItem = (o = {}) => ({ id: 'T', t: 'text', x: 0, y: 0, w: 240, h: 57.6, r: 0, data: { text: 'two\nlines' }, style: { fontSize: 24, color: '#c43e45', align: 'center' }, ...o })

	test('level: text at LOD 0; inside LOD 1 text while fontSize · scale ≥ TEXT_MIN_PX, else bars', () => {
		const it = textItem()
		assert.equal(text.scaleSensitive, true)
		assert.equal(text.levelOf(it, 0, 0.3), 0)
		assert.equal(text.levelOf(it, 1, TEXT_MIN_PX / 24), 0)
		assert.equal(text.levelOf(it, 1, TEXT_MIN_PX / 24 - 0.001), 1)
		assert.equal(text.levelOf(textItem({ style: { fontSize: 400 } }), 1, 0.1), 0)
		assert.equal(text.levelOf(textItem({ style: {} }), 1, 0.2), 1, 'missing size = 24 (§3.10)')
	})

	test('level 0: Konva text with the wrap width, size, color and align; no fixed height', () => {
		const it = textItem()
		const e = text.build(ctx, it, abs(it), 0)
		const a = e.parts.text.attrs
		assert.deepEqual([a.width, a.text, a.fontSize, a.fill, a.align, a.wrap, a.height], [240, 'two\nlines', 24, '#c43e45', 'center', 'word', undefined])
		assert.equal(e.parts.bars, null)
		const def = text.build(ctx, textItem({ style: { color: 'red', align: 'justify', fontSize: 3 } }), abs(it), 0).parts.text.attrs
		assert.deepEqual([def.fill, def.align, def.fontSize], ['#191b1d', 'left', 24], 'invalid stored values draw as defaults')
	})

	test('job 241 AK3: a stored text keeps its alignment; one without style.align draws left (a new text is centred only by its stored field)', () => {
		assert.equal(textItemAttrs(textItem({ style: { fontSize: 24 } }), 240).align, 'left')
		assert.equal(textItemAttrs(textItem({ style: { fontSize: 24, align: 'left' } }), 240).align, 'left')
		assert.equal(textItemAttrs(textItem({ style: { fontSize: 24, align: 'center' } }), 240).align, 'center')
		assert.equal(textItemAttrs(textItem({ style: { fontSize: 24, align: 'right' } }), 240).align, 'right')
	})

	test('level 1: grey bars, one per line estimated from h, none for an empty text; switching levels', () => {
		const it = textItem()
		const e = text.build(ctx, it, abs(it), 1)
		assert.equal(e.parts.text, null)
		assert.equal(e.parts.bars.attrs.fill, TEXT_BAR_COLOR)
		assert.deepEqual(barAttrs(it, abs(it)), { width: 240, lines: 2, step: 24 * 1.2 })
		assert.equal(barAttrs(textItem({ data: { text: '' } }), abs(it)).lines, 0)
		const c = fakeContext()
		e.parts.bars.attrs.sceneFunc(c, e.parts.bars)
		assert.equal(c.calls.filter((x) => x[0] === 'rect').length, 2)
		assert.equal(c.calls.at(-1)[0], 'fillShape')
		// a level change swaps the parts (no visible() setter on re-entry, lab gate "Herausnehmen")
		const bars = e.parts.bars
		let destroyed = 0
		bars.destroy = () => { destroyed++ }
		text.setLod(ctx, e, it, abs(it), 0)
		assert.deepEqual([e.parts.text.visible(), e.parts.bars, destroyed], [true, null, 1])
		assert.equal(e.parts.text.attrs.visible, true, 'built visible')
		text.setLod(ctx, e, it, abs(it), 1)
		assert.deepEqual([e.parts.text, e.parts.bars.visible()], [null, true])
		text.setTextHidden(e, true)
		assert.equal(e.parts.bars.visible(), false)
		text.setLod(ctx, e, it, abs(it), 0)
		assert.equal(e.parts.text.visible(), false, 'built hidden while the editor is open')
	})

	test('update: width, size and text in place', () => {
		const it = textItem()
		const e = text.build(ctx, it, abs(it), 0)
		const next = textItem({ w: 120, style: { fontSize: 48 }, data: { text: 'x' } })
		assert.equal(text.update(ctx, e, next, abs(next), new Set(['geom', 'style', 'text'])), false)
		assert.deepEqual([e.parts.text.attrs.width, e.parts.text.attrs.fontSize, e.parts.text.attrs.text], [120, 48, 'x'])
	})
})

describe('connector node (round 1b)', () => {
	const U = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'
	const V = '01JF5Q4T0V9W8X7Y6Z5A4B3C2E'
	const conn = (o = {}) => ({ id: 'C', t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, data: { start: { item: U }, end: { item: V }, route: 'straight' }, style: { stroke: '#c43e45', strokeWidth: 3, endCap: 'arrow' }, ...o })
	const A = { x: 0, y: 0, w: 100, h: 100, r: 0 }
	const B = { x: 300, y: 0, w: 100, h: 100, r: 0 }
	const routeOf = (route = 'straight', label = null) => {
		const geom = routeConnector({ box: A, ep: { item: U } }, { box: B, ep: { item: V } }, route)
		return { geom, label: labelBox(label, geom.labelAt) }
	}
	/** @param {object} line the line Shape @return {object} a Konva-like shape facade for drawConnector */
	const shapeOf = (line) => ({ getAttr: (k) => line.attrs[k], strokeWidth: () => line.attrs.strokeWidth, stroke: () => line.attrs.stroke })

	test('build: root at (0, 0) with position transforms, one line Shape; style through fieldValue', () => {
		const e = connector.build(ctx, conn(), routeOf(), 0)
		assert.equal(connector.routed, true)
		assert.equal(e.root.kind, 'Group')
		assert.equal(e.root.attrs.transformsEnabled, 'position')
		assert.equal(e.root.attrs.x, undefined, 'never placed')
		const line = e.parts.line
		assert.equal(line.kind, 'Shape')
		assert.deepEqual(line.attrs.pts, [100, 50, 300, 50])
		assert.deepEqual([line.attrs.stroke, line.attrs.strokeWidth, line.attrs.startCap, line.attrs.endCap, line.attrs.dashEnabled],
			['#c43e45', 3, 'none', 'arrow', false])
		const def = lineAttrs({ t: 'connector', data: {}, style: { endCap: 'star', dash: 'wavy', strokeWidth: 30 } }, null)
		assert.deepEqual([def.stroke, def.strokeWidth, def.startCap, def.endCap, def.dashEnabled, def.pts.length], ['#3d4044', 2, 'none', 'none', false, 0], '§3.10 defaults (job 227: CONNECTOR_STROKE), rule 18')
		assert.deepEqual(lineAttrs(conn({ style: { dash: 'dashed', strokeWidth: 2 } }), null).dash, [8, 6])
		assert.equal(lineAttrs(conn({ style: { dash: 'dotted' } }), null).lineCap, 'round')
		assert.equal(e.parts.text, null, 'no label')
	})

	test('sceneFunc: path dashed by Konva (strokeShape), caps after setLineDash([]) and solid; bezier path for curved', () => {
		const e = connector.build(ctx, conn({ style: { stroke: '#c43e45', strokeWidth: 3, startCap: 'dot', endCap: 'triangle', dash: 'dashed' } }), routeOf(), 0)
		const c = fakeContext()
		drawConnector(c, shapeOf(e.parts.line))
		const names = c.calls.map((x) => x[0])
		const iStroke = names.indexOf('strokeShape')
		const iDash = names.indexOf('setLineDash')
		assert.ok(iStroke > 0 && iDash > iStroke, 'line first, then the caps without dash')
		assert.deepEqual(c.calls[iDash], ['setLineDash', []])
		assert.ok(names.includes('arc') && names.filter((n) => n === 'fill').length === 2, 'dot and triangle filled')
		// the line is shortened under the filled triangle at the end
		const lineTo = c.calls.find((x) => x[0] === 'lineTo')
		assert.ok(Math.abs(lineTo[1] - (300 - capCut('triangle', capSize(3), 3))) < 1e-9)
		const b = connector.build(ctx, conn({ data: { start: { item: U }, end: { item: V }, route: 'curved' } }), routeOf('curved'), 0)
		assert.equal(b.parts.line.attrs.bezier, true)
		const cb = fakeContext()
		drawConnector(cb, shapeOf(b.parts.line))
		assert.ok(cb.calls.some((x) => x[0] === 'bezierCurveTo'))
		const none = fakeContext()
		drawConnector(none, shapeOf(connector.build(ctx, conn({ style: {} }), routeOf(), 0).parts.line))
		assert.ok(!none.calls.some((x) => x[0] === 'setLineDash'), 'no caps: nothing after the path')
		const empty = fakeContext()
		drawConnector(empty, shapeOf(connector.build(ctx, conn(), null, 0).parts.line))
		assert.deepEqual(empty.calls, [], 'no route: nothing drawn')
	})

	test('caps: arrow stroked open, triangle/diamond/dot filled; unknown caps draw nothing', () => {
		for (const [cap, last] of [['arrow', 'stroke'], ['triangle', 'fill'], ['diamond', 'fill'], ['dot', 'fill']]) {
			const c = fakeContext()
			drawCap(c, cap, 10, 10, 0, 10, 2, '#000000')
			assert.equal(c.calls.at(-1)[0], last, cap)
		}
		const c = fakeContext()
		drawCap(c, 'none', 0, 0, 0, 10, 2, '#000000')
		drawCap(c, 'star', 0, 0, 0, 10, 2, '#000000')
		assert.deepEqual(c.calls, [])
		assert.deepEqual([capCut('arrow', 10, 2), capCut('dot', 10, 2), capCut('none', 10, 2)], [1, 9, 0])
	})

	test('job 261 AK2: tips in the look of V6: base at L, half breadth 0.36·L; the diamond 2·L long; dot and open circle centred L/2 behind the tip', () => {
		const L = capSize(2)
		const B = 0.36 * L
		const near = (a, b) => Math.abs(a - b) < 1e-9
		// pointing right (angle 0) with the tip at (100, 50)
		const tri = fakeContext()
		drawCap(tri, 'triangle', 100, 50, 0, L, 2, '#000000')
		const pts = tri.calls.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo').map((x) => [x[1], x[2]])
		assert.deepEqual(pts.length, 3)
		assert.ok(near(pts[0][0], 100) && near(pts[0][1], 50), 'the tip')
		assert.ok(near(pts[1][0], 100 - L) && near(Math.abs(pts[1][1] - 50), B), 'one base corner')
		assert.ok(near(pts[2][0], 100 - L) && near(Math.abs(pts[2][1] - 50), B) && pts[1][1] !== pts[2][1], 'the other base corner')
		assert.equal(tri.calls.at(-1)[0], 'fill')
		const arrow = fakeContext()
		drawCap(arrow, 'arrow', 100, 50, 0, L, 2, '#000000')
		const ap = arrow.calls.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo').map((x) => [x[1], x[2]])
		assert.ok(near(ap[0][0], 100 - L) && near(Math.abs(ap[0][1] - 50), B) && near(ap[1][0], 100), 'an open chevron of the same size')
		assert.equal(arrow.calls.at(-1)[0], 'stroke')
		const dia = fakeContext()
		drawCap(dia, 'diamond', 100, 50, 0, L, 2, '#000000')
		const dp = dia.calls.filter((x) => x[0] === 'lineTo').map((x) => [x[1], x[2]])
		assert.ok(near(dp[0][0], 100 - L) && near(Math.abs(dp[0][1] - 50), B), 'side corner at L')
		assert.ok(near(dp[1][0], 100 - 2 * L) && near(dp[1][1], 50), 'back end at 2·L')
		for (const [cap, r] of [['dot', 0.4], ['circleOpen', 0.375]]) {
			const c = fakeContext()
			drawCap(c, cap, 100, 50, 0, L, 2, '#000000')
			const arc = c.calls.find((x) => x[0] === 'arc')
			assert.ok(near(arc[1], 100 - L / 2) && near(arc[2], 50) && near(arc[3], r * L), cap)
		}
		// the width rule: 8 → 17.3 long, 6.2 to each side
		const t8 = fakeContext()
		drawCap(t8, 'triangle', 0, 0, Math.PI / 2, capSize(8), 8, '#000000')
		const b8 = t8.calls.filter((x) => x[0] === 'lineTo')[0]
		assert.ok(near(b8[2], -capSize(8)) && near(Math.abs(b8[1]), 0.36 * capSize(8)), 'pointing down')
	})

	test('job 261 AK3: the line ends at the base of filled tips, at the back of open ones', () => {
		const L = 10
		assert.deepEqual(['triangle', 'triangleOpen', 'diamond', 'dot', 'circleOpen', 'arrow', 'none'].map((c) => capCut(c, L, 2)),
			[10, 10, 20, 9, 8.75, 1, 0])
		// drawn: the straight line before a triangle stops exactly at its base
		const e = connector.build(ctx, conn({ style: { strokeWidth: 2, endCap: 'triangle' } }), routeOf(), 0)
		const c = fakeContext()
		drawConnector(c, shapeOf(e.parts.line))
		const end = c.calls.find((x) => x[0] === 'lineTo')
		const base = c.calls.filter((x) => x[0] === 'lineTo').at(-2)
		assert.ok(Math.abs(end[1] - (300 - capSize(2))) < 1e-9, 'line end')
		assert.ok(Math.abs(base[1] - (300 - capSize(2))) < 1e-9, 'base corner of the tip at the same x: no gap')
	})

	test('job 261 AK4: elbow bends are rounded with radius 10, at most half of the shorter piece; straight and curved never', () => {
		const sh = (pts, route = 'elbow', bezier = false) => shapeOf({ attrs: { ...lineAttrs(conn({ data: { start: { item: U }, end: { item: V }, route }, style: {} }), null), pts, bezier, startAngle: Math.PI, endAngle: 0 } })
		const c = fakeContext()
		drawConnector(c, sh([0, 0, 100, 0, 100, 100, 200, 100]))
		assert.deepEqual(c.calls.filter((x) => x[0] === 'arcTo'), [['arcTo', 100, 0, 100, 100, 10], ['arcTo', 100, 100, 200, 100, 10]])
		assert.deepEqual(c.calls.filter((x) => x[0] === 'lineTo').at(-1), ['lineTo', 200, 100])
		const short = fakeContext()
		drawConnector(short, sh([0, 0, 100, 0, 100, 8, 200, 8]))
		assert.deepEqual(short.calls.filter((x) => x[0] === 'arcTo').map((x) => x[5]), [4, 4], 'a piece of 8: radius 4')
		const zero = fakeContext()
		drawConnector(zero, sh([0, 0, 100, 0, 100, 0, 200, 0]))
		assert.deepEqual(zero.calls.filter((x) => x[0] === 'arcTo'), [], 'a piece of length 0: a sharp corner, no NaN')
		assert.ok(zero.calls.every((x) => x.slice(1).every((v) => typeof v !== 'number' || Number.isFinite(v))))
		const straight = fakeContext()
		drawConnector(straight, sh([0, 0, 100, 0, 100, 100], 'straight'))
		assert.ok(!straight.calls.some((x) => x[0] === 'arcTo'), 'straight route')
		const curved = fakeContext()
		drawConnector(curved, sh([0, 0, 60, 0, 140, 100, 200, 100], 'curved', true))
		assert.ok(!curved.calls.some((x) => x[0] === 'arcTo'), 'curved route')
		assert.equal(lineAttrs(conn({ data: { start: { item: U }, end: { item: V }, route: 'elbow' } }), routeOf('elbow')).rounded, true)
		assert.equal(lineAttrs(conn(), routeOf()).rounded, false)
	})

	test('job 261 AK8: all seven tips at widths 1–24 on straight, elbow and curved routes draw finite paths', () => {
		for (const route of ['straight', 'elbow', 'curved']) {
			for (const cap of ['none', 'arrow', 'triangle', 'dot', 'diamond', 'circleOpen', 'triangleOpen']) {
				for (const sw of [1, 2, 4, 8, 12, 24]) {
					const e = connector.build(ctx, conn({ data: { start: { item: U }, end: { item: V }, route, label: 'Ja' }, style: { strokeWidth: sw, startCap: cap, endCap: cap } }), routeOf(route, 'Ja'), 0)
					const c = fakeContext()
					drawConnector(c, shapeOf(e.parts.line))
					assert.ok(c.calls.length > 0, `${route} ${cap} ${sw}`)
					assert.ok(c.calls.every((x) => x.slice(1).every((v) => typeof v !== 'number' || Number.isFinite(v))), `${route} ${cap} ${sw}`)
				}
			}
		}
	})

	test('shortened: a polyline end moves along its last segment (never past it), a bezier end with its control point', () => {
		assert.deepEqual(shortened([0, 0, 100, 0, 100, 50], false, 10, 5, Math.PI, Math.PI / 2), [10, 0, 100, 0, 100, 45])
		const short = shortened([0, 0, 10, 0], false, 0, 50, 0, 0)
		assert.ok(Math.abs(short[2] - 0.1) < 1e-9 && short[3] === 0, 'a cut longer than the segment stops at 99 % of it')
		assert.deepEqual(shortened([0, 0, 0, 40, 100, 40, 100, 0], true, 0, 4, 0, -Math.PI / 2).map((v) => Math.round(v * 1e9) / 1e9), [0, 0, 0, 40, 100, 44, 100, 4])
	})

	test('label: bg + text at LOD 0 with a label box, none at LOD 1; place() follows the route; editing hides it', () => {
		const it = conn({ data: { start: { item: U }, end: { item: V }, label: 'ja' } })
		const r = routeOf('straight', 'ja')
		const e = connector.build(ctx, it, r, 0)
		assert.equal(e.parts.text.attrs.text, 'ja')
		assert.deepEqual([e.parts.bg.attrs.x, e.parts.bg.attrs.y, e.parts.bg.attrs.width], [r.label.x, r.label.y, r.label.w])
		// job 261 AK6: a white pill with a fine edge, Arial 15, padding 5 and 9
		assert.deepEqual([e.parts.bg.attrs.fill, e.parts.bg.attrs.stroke, e.parts.bg.attrs.strokeWidth], ['#ffffff', 'rgba(25,27,29,0.28)', 1])
		assert.equal(r.label.h, 28)
		assert.equal(e.parts.bg.attrs.cornerRadius, 12, 'half of 28, at most 12')
		assert.equal(e.parts.text.attrs.fontSize, 15)
		assert.equal(e.parts.text.attrs.fontFamily, FONT_FAMILY)
		const tall = { geom: r.geom, label: labelBox('a\nb\nc', r.geom.labelAt) }
		connector.place(ctx, e, it, tall)
		assert.equal(e.parts.bg.attrs.cornerRadius, 12, 'three lines: still 12')
		const small = { geom: r.geom, label: { ...r.label, h: 20 } }
		connector.place(ctx, e, it, small)
		assert.equal(e.parts.bg.attrs.cornerRadius, 10, 'half the height below 24')
		connector.place(ctx, e, it, r)
		const e1 = connector.build(ctx, it, r, 1)
		assert.equal(e1.parts.text, null, 'LOD 1: no label')
		connector.setLod(ctx, e1, it, r, 0)
		assert.equal(e1.parts.text.attrs.text, 'ja')
		connector.setLod(ctx, e1, it, r, 1)
		assert.equal(e1.parts.text, null)
		// route change: line and label move
		const moved = { geom: routeConnector({ box: A, ep: { item: U } }, { box: { ...B, y: 300 }, ep: { item: V } }, 'straight') }
		moved.label = labelBox('ja', moved.geom.labelAt)
		connector.place(ctx, e, it, moved)
		assert.deepEqual(e.parts.line.attrs.pts, moved.geom.points)
		assert.equal(e.parts.bg.attrs.y, moved.label.y)
		// label removed
		connector.update(ctx, e, conn(), routeOf(), new Set(['text']), 0)
		assert.equal(e.parts.text, null)
		assert.equal(connector.update(ctx, e, conn(), routeOf(), new Set(['type']), 0), true)
		// editing hides an existing label
		const e2 = connector.build(ctx, it, r, 0, true)
		assert.equal(e2.parts.text.attrs.visible, false)
		connector.setTextHidden(e2, false)
		assert.equal(e2.parts.text.attrs.visible, true)
		assert.equal(e2.parts.bg.attrs.visible, true)
	})
})

describe('registry of node specs', () => {
	test('shape, text and connector have nodes; unknown types get the placeholder', () => {
		assert.equal(nodeSpecFor('shape'), shape)
		assert.equal(nodeSpecFor('text'), text)
		assert.equal(nodeSpecFor('connector'), connector)
		assert.equal(nodeSpecFor('constructor'), placeholder)
		assert.equal(nodeSpecFor('brush'), placeholder)
	})

	test('every node built here has listening false and perfectDrawEnabled false', () => {
		assert.ok(built.length > 10)
		for (const n of built) {
			assert.equal(n.attrs.listening, false, n.kind)
			if (n.kind !== 'Group') assert.equal(n.attrs.perfectDrawEnabled, false, n.kind)
		}
	})
})
