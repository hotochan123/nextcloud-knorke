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
 * - every Konva node is built with listening false and perfectDrawEnabled false
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { bodyAttrs, dashFor, shape, shapeTextBox, traceOutline, withAlpha } from '../../../src/scene/nodes/shape.js'
import { barAttrs, text } from '../../../src/scene/nodes/text.js'
import { nodeSpecFor } from '../../../src/scene/nodes/index.js'
import { placeholder } from '../../../src/scene/nodes/placeholder.js'
import { capCut, connector, drawCap, drawConnector, lineAttrs, shortened } from '../../../src/scene/nodes/connector.js'
import { capSize, labelBox, routeConnector } from '../../../src/model/connectors.js'
import { autoFontSize } from '../../../src/model/text.js'
import { SHAPE_TEXT_PADDING, TEXT_BAR_COLOR, TEXT_MIN_PX } from '../../../src/model/tokens.js'

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

const shapeItem = (o = {}) => ({ id: 'S', t: 'shape', x: 0, y: 0, w: 200, h: 100, r: 0, data: { kind: 'rect', text: 'Idee' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }, ...o })
const abs = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: it.r })

describe('shape node', () => {
	test('outline attributes through fieldValue: fill alpha, fillEnabled, stroke, dash, unknown kind and enum values', () => {
		const a = bodyAttrs(shapeItem({ style: { fill: '#FF0000', fillOpacity: 50, stroke: '#00ff00', strokeWidth: 3, dash: 'dashed' } }), { w: 200, h: 100 })
		assert.equal(a.fill, 'rgba(255,0,0,0.5)')
		assert.equal(a.fillEnabled, true)
		assert.equal(a.stroke, '#00ff00')
		assert.deepEqual([a.strokeWidth, a.strokeEnabled, a.dashEnabled], [3, true, true])
		assert.deepEqual(a.dash, [12, 9])
		const none = bodyAttrs(shapeItem({ data: { kind: 'hexagon' }, style: { fillOpacity: 0, strokeWidth: 0, dash: 'wavy' } }), { w: 10, h: 10 })
		assert.deepEqual([none.kind, none.fillEnabled, none.strokeEnabled, none.dashEnabled], ['rect', false, false, false])
		const def = bodyAttrs({ t: 'shape', data: {}, style: {} }, { w: 1, h: 1 })
		assert.deepEqual([def.fill, def.stroke, def.strokeWidth, def.kind], ['#ffffff', '#1a1a1a', 2, 'rect'], '§3.10 defaults')
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
		assert.deepEqual(paths.rect, ['beginPath', 'rect', 'closePath'])
		assert.deepEqual(paths.nope, paths.rect)
		assert.equal(paths.roundRect.filter((n) => n === 'arcTo').length, 4)
		assert.deepEqual(paths.ellipse, ['beginPath', 'ellipse', 'closePath'])
		assert.deepEqual(paths.triangle, ['beginPath', 'moveTo', 'lineTo', 'lineTo', 'closePath'])
		assert.equal(paths.arrowRight.filter((n) => n === 'lineTo').length, 6)
		const c = fakeContext()
		traceOutline(c, 'roundRect', 200, 100)
		assert.deepEqual(c.calls[1], ['moveTo', 15, 0], 'radius 0.15 × min(w, h)')
	})

	test('text box per kind; stored font size wins, else auto-fit in the box', () => {
		const tri = shapeTextBox(shapeItem({ w: 200, h: 200, data: { kind: 'triangle', text: 'x' } }), { w: 200, h: 200 })
		assert.deepEqual([tri.x, tri.y, tri.w, tri.h, tri.pad], [50, 100, 100, 90, SHAPE_TEXT_PADDING])
		assert.equal(tri.fontSize, autoFontSize('x', 100, 90, SHAPE_TEXT_PADDING))
		const stored = shapeTextBox(shapeItem({ style: { fontSize: 40, align: 'left', valign: 'top', textColor: '#e03131' } }), { w: 200, h: 100 })
		assert.deepEqual([stored.fontSize, stored.align, stored.valign, stored.color], [40, 'left', 'top', '#e03131'])
		const def = shapeTextBox(shapeItem({ style: { fontSize: 7, align: 'justify' } }), { w: 200, h: 100 })
		assert.deepEqual([def.align, def.valign, def.color], ['center', 'middle', '#1a1a1a'])
		assert.equal(def.fontSize, autoFontSize('Idee', 200, 100, SHAPE_TEXT_PADDING), 'invalid stored size → auto-fit')
	})

	test('build: outline Shape with a sceneFunc, text at LOD 0 only; setLod and setTextHidden toggle the text', () => {
		const it = shapeItem()
		const e = shape.build(ctx, it, abs(it), 0)
		assert.equal(e.parts.body.kind, 'Shape')
		assert.equal(typeof e.parts.body.attrs.sceneFunc, 'function')
		assert.equal(e.parts.text.attrs.text, 'Idee')
		assert.deepEqual([e.parts.text.attrs.x, e.parts.text.attrs.y], [SHAPE_TEXT_PADDING, SHAPE_TEXT_PADDING])
		const c = fakeContext()
		e.parts.body.attrs.sceneFunc(c, e.parts.body)
		assert.deepEqual(c.calls.map((x) => x[0]), ['beginPath', 'rect', 'closePath', 'fillStrokeShape'])
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
		assert.equal(e.parts.text.attrs.x, 0.25 * 300 + SHAPE_TEXT_PADDING, 'text box of the new kind')
		assert.equal(shape.update(ctx, e, next, abs(next), new Set(['type'])), true)
	})
})

describe('text node', () => {
	const textItem = (o = {}) => ({ id: 'T', t: 'text', x: 0, y: 0, w: 240, h: 57.6, r: 0, data: { text: 'two\nlines' }, style: { fontSize: 24, color: '#e03131', align: 'center' }, ...o })

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
		assert.deepEqual([a.width, a.text, a.fontSize, a.fill, a.align, a.wrap, a.height], [240, 'two\nlines', 24, '#e03131', 'center', 'word', undefined])
		assert.equal(e.parts.bars, null)
		const def = text.build(ctx, textItem({ style: { color: 'red', align: 'justify', fontSize: 3 } }), abs(it), 0).parts.text.attrs
		assert.deepEqual([def.fill, def.align, def.fontSize], ['#1a1a1a', 'left', 24], 'invalid stored values draw as defaults')
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
	const conn = (o = {}) => ({ id: 'C', t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, data: { start: { item: U }, end: { item: V }, route: 'straight' }, style: { stroke: '#e03131', strokeWidth: 3, endCap: 'arrow' }, ...o })
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
			['#e03131', 3, 'none', 'arrow', false])
		const def = lineAttrs({ t: 'connector', data: {}, style: { endCap: 'star', dash: 'wavy', strokeWidth: 30 } }, null)
		assert.deepEqual([def.stroke, def.strokeWidth, def.startCap, def.endCap, def.dashEnabled, def.pts.length], ['#1a1a1a', 2, 'none', 'none', false, 0], '§3.10 defaults, rule 18')
		assert.deepEqual(lineAttrs(conn({ style: { dash: 'dashed', strokeWidth: 2 } }), null).dash, [8, 6])
		assert.equal(lineAttrs(conn({ style: { dash: 'dotted' } }), null).lineCap, 'round')
		assert.equal(e.parts.text, null, 'no label')
	})

	test('sceneFunc: path dashed by Konva (strokeShape), caps after setLineDash([]) and solid; bezier path for curved', () => {
		const e = connector.build(ctx, conn({ style: { stroke: '#e03131', strokeWidth: 3, startCap: 'dot', endCap: 'triangle', dash: 'dashed' } }), routeOf(), 0)
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
		assert.deepEqual([capCut('arrow', 10, 2), capCut('dot', 10, 2), capCut('none', 10, 2)], [1, 0, 0])
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
		assert.equal(e.parts.bg.attrs.fill, '#f1f1ec', 'BOARD_BACKGROUND')
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
		assert.equal(nodeSpecFor('pen'), placeholder)
	})

	test('every node built here has listening false and perfectDrawEnabled false', () => {
		assert.ok(built.length > 10)
		for (const n of built) {
			assert.equal(n.attrs.listening, false, n.kind)
			if (n.kind !== 'Group') assert.equal(n.attrs.perfectDrawEnabled, false, n.kind)
		}
	})
})
