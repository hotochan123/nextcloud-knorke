/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 227 (one palette) AK3: an item with a colour of the old
 * palettes in any colour field is drawn in the new tone (tokens.shownColor),
 * at LOD 0 (the node builders) and at LOD 2 (coarseLook), in the SVG export
 * (a shape's outline through a VectorContext), in the sketches of the board
 * list and the own templates, and in the layout of a mind map; a connector
 * with the old default line #1a1a1a in CONNECTOR_STROKE. The item itself is
 * never changed. Custom colours stay as they are. The real renderer on the
 * fake DOM: tests/js/scene/tags.test.mjs.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shownRects } from '../../../src/components/boardSketches.js'
import { templateTile } from '../../../src/board/ownTemplates.js'
import { mindmapLayout } from '../../../src/model/mindmap.js'
import { CONNECTOR_STROKE } from '../../../src/model/tokens.js'
import { coarseLook } from '../../../src/scene/nodes/coarse.js'
import { connector, lineAttrs } from '../../../src/scene/nodes/connector.js'
import { frame } from '../../../src/scene/nodes/frame.js'
import { pad } from '../../../src/scene/nodes/pad.js'
import { shape } from '../../../src/scene/nodes/shape.js'
import { sticky } from '../../../src/scene/nodes/sticky.js'
import { frameAttrs } from '../../../src/scene/nodes/table.js'
import { text } from '../../../src/scene/nodes/text.js'
import { svgDocument } from '../../../src/scene/exportSvg.js'
import { VectorContext } from '../../../src/scene/vectorContext.js'
import { capSize, labelBox, routeConnector } from '../../../src/model/connectors.js'
import { bucketOf } from '../../../src/model/mindmap.js'

class FakeNode {
	constructor(attrs = {}) {
		this.attrs = { ...attrs }
		this.children = []
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
	height() { return this.attrs.height ?? 0 }
	text(v) {
		if (v === undefined) return this.attrs.text
		this.attrs.text = v
		return this
	}

	transformsEnabled(v) { this.attrs.transformsEnabled = v }
	add(...c) { this.children.push(...c) }
	moveToTop() {}
	destroy() {}
}
class Group extends FakeNode {}
class Rect extends FakeNode {}
class Text extends FakeNode {}
class Shape extends FakeNode {}
class Line extends FakeNode {}
const ctx = { Group, Rect, Text, Shape, Line, shadows: true, tags: new Map() }

const abs = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: it.r })
const base = (id, t, o) => ({ id, t, x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: {}, style: {}, ...o })
const frozen = (it) => JSON.parse(JSON.stringify(it))

/** Every string attribute of a built node and its children, lower case. */
function colorsOf(node) {
	const out = []
	const walk = (n) => {
		for (const v of Object.values(n.attrs ?? {})) if (typeof v === 'string') out.push(v.toLowerCase())
		for (const c of n.children ?? []) walk(c)
	}
	walk(node)
	return out
}

describe('job 227 AK3: old palette colours are drawn as their new tones', () => {
	test('a note, a note pad and a frame: the fill; the item stays as stored', () => {
		const n = base('N', 'sticky', { data: { text: 'Idee' }, style: { fill: '#a8d8f8' } })
		const before = frozen(n)
		const e = sticky.build(ctx, n, abs(n), 0)
		assert.equal(e.parts.body.attrs.fill, '#a2d9fe')
		sticky.update(ctx, e, { ...n, style: { fill: '#fff6b6' } }, abs(n), new Set(['style']))
		assert.equal(e.parts.body.attrs.fill, '#faea89', 'also on a style update')
		assert.deepEqual(n, before, 'the note itself is not changed')
		const p = base('P', 'pad', { data: { title: '' }, style: { fill: '#ffb27a' } })
		const pe = pad.build(ctx, p, abs(p), 0)
		assert.ok(colorsOf(pe.root).includes('#febf87') && !colorsOf(pe.root).includes('#ffb27a'), 'the pad and its sheets in Orange')
		const f = base('F', 'frame', { w: 800, h: 600, data: { title: 'F' }, style: { fill: '#e4e4e4' } })
		assert.equal(frame.build(ctx, f, abs(f), 0).parts.body.attrs.fill, '#e0e0dd')
	})

	test('a shape: fill, border and text colour; a custom colour stays; a text item: its colour', () => {
		const s = base('S', 'shape', { w: 200, h: 120, data: { kind: 'rect', text: 'Box' }, style: { fill: '#ffc9c9', stroke: '#e03131', strokeWidth: 2, textColor: '#2f9e44' } })
		const e = shape.build(ctx, s, abs(s), 0)
		assert.equal(e.parts.body.attrs.fill, '#ffaaa7')
		assert.equal(e.parts.body.attrs.stroke, '#c43e45')
		assert.equal(e.parts.text.attrs.fill, '#307d37')
		const custom = base('S2', 'shape', { w: 200, h: 120, data: { kind: 'rect', text: 'Box' }, style: { fill: '#123456', stroke: '#ff8800', strokeWidth: 2, textColor: '#abcdef' } })
		const ce = shape.build(ctx, custom, abs(custom), 0)
		assert.deepEqual([ce.parts.body.attrs.fill, ce.parts.body.attrs.stroke, ce.parts.text.attrs.fill], ['#123456', '#ff8800', '#abcdef'])
		const t = base('T', 'text', { w: 240, h: 28.8, data: { text: 'Hallo' }, style: { fontSize: 24, color: '#7048e8', align: 'left' } })
		assert.equal(text.build(ctx, t, abs(t), 0).parts.text.attrs.fill, '#9550bb')
	})

	test('a connector: the old default #1a1a1a in CONNECTOR_STROKE, an old palette colour in its new tone', () => {
		const A = { x: 0, y: 0, w: 100, h: 100, r: 0 }
		const B = { x: 300, y: 0, w: 100, h: 100, r: 0 }
		const geom = routeConnector({ box: A, ep: { item: 'U' } }, { box: B, ep: { item: 'V' } }, 'straight')
		const c = (stroke) => base('C', 'connector', { w: 0, h: 0, data: { start: { item: 'U' }, end: { item: 'V' }, route: 'straight' }, style: { stroke, strokeWidth: 2 } })
		assert.equal(connector.build(ctx, c('#1a1a1a'), { geom, label: labelBox(null, geom.labelAt) }, 0).parts.line.attrs.stroke, CONNECTOR_STROKE)
		assert.equal(lineAttrs(c('#0082c9'), geom).stroke, '#0275a9')
		assert.equal(lineAttrs(c('#191b1d'), geom).stroke, '#191b1d', 'Black stays Black')
		assert.ok(capSize(2) > 0)
	})

	test('a table: border, header row and text colour', () => {
		const tb = base('TB', 'table', { style: { stroke: '#868e96', headerFill: '#fff6b6', textColor: '#1a1a1a' } })
		const l = { w: 300, h: 100, header: true, cols: [{ x: 0 }, { x: 150 }], rows: [{ y: 0, h: 50 }, { y: 50, h: 50 }] }
		const a = frameAttrs(tb, l)
		assert.equal(a.head.fill, '#faea89')
		assert.equal(a.border.stroke, '#6f6f6d')
	})

	test('a mind map: a branch with an old c and the root border in their new tones; branches without c take TEN in turn', () => {
		const root = 'n0000root'
		const list = [[root, { o: 'i0', c: '#1a1a1a' }, 'Thema'], ['n00000001', { o: 'i0', p: root, c: '#c92a2a' }, 'Alt'], ['n00000002', { o: 'i1', p: root }, 'Neu']]
		const nodes = {}
		const texts = {}
		for (const [k, n, t] of list) {
			;(nodes[bucketOf(k)] ??= {})[k] = n
			;(texts[bucketOf(k)] ??= {})[k] = t
		}
		const m = base('M', 'mindmap', { w: 120, h: 48, data: { nodes, texts }, style: { layout: 'right' } })
		const lay = mindmapLayout(m)
		const color = (k) => lay.nodes.find((x) => x.key === k)?.color
		assert.equal(color('n00000001'), '#c43e45')
		assert.equal(color(root), '#191b1d')
		assert.equal(color('n00000002'), '#087c77', 'the second main branch: TEN[1]')
	})

	test('LOD 2 (coarseLook): note, frame, shape and connector in their new tones', () => {
		assert.equal(coarseLook(base('N', 'sticky', { style: { fill: '#f58a98' } })).color, '#ffaaa7')
		assert.equal(coarseLook(base('F', 'frame', { style: { fill: '#fff6b6' } })).color, '#faea89')
		const s = coarseLook(base('S', 'shape', { data: { kind: 'ellipse' }, style: { fill: '#ffffff', fillOpacity: 0, stroke: '#e03131', strokeWidth: 3 } }))
		assert.equal(s.stroke, '#c43e45')
		assert.equal(coarseLook(base('C', 'connector', { w: 0, h: 0, data: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, style: { stroke: '#1a1a1a', strokeWidth: 2 } })).color, CONNECTOR_STROKE)
	})

	test('the SVG export: a shape with an old fill and border holds the new tones, never the old ones', () => {
		const s = base('S', 'shape', { w: 200, h: 120, data: { kind: 'rect', text: '' }, style: { fill: '#ffc9c9', stroke: '#e03131', strokeWidth: 2 } })
		const e = shape.build(ctx, s, abs(s), 0)
		const vc = new VectorContext()
		const k = {}
		for (const m of ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arcTo', 'arc', 'rect', 'ellipse', 'closePath', 'fill', 'stroke', 'setLineDash']) {
			k[m] = (...a) => vc[m](...a)
		}
		k.setAttr = (name, v) => { vc[name] = v }
		k.fillStrokeShape = (sh) => {
			vc.fillStyle = sh.getAttr('fill')
			vc.fill()
			vc.strokeStyle = sh.getAttr('stroke')
			vc.lineWidth = sh.getAttr('strokeWidth')
			vc.stroke()
		}
		k.strokeShape = (sh) => {
			vc.strokeStyle = sh.getAttr('stroke')
			vc.stroke()
		}
		vc.beginGroup('S')
		e.parts.body.attrs.sceneFunc(k, e.parts.body)
		vc.endGroup()
		const svg = svgDocument(vc.ops, { x: -10, y: -10, w: 220, h: 140 })
		assert.match(svg, /#ffaaa7/)
		assert.match(svg, /#c43e45/)
		assert.doesNotMatch(svg, /#ffc9c9|#e03131/)
	})

	test('the sketches of the board list and of own templates: old fills as new tones, frames and custom fills as they are', () => {
		const rects = shownRects([[0, 0, 60, 40, ''], [4, 4, 10, 10, '#a8d8f8'], [20, 4, 10, 10, '#123456']])
		assert.deepEqual(rects.map((r) => r.fill), [null, '#a2d9fe', '#123456'])
		const tile = templateTile({ id: 3, name: 'Retro', sketch: [[4, 4, 10, 10, '#FFF6B6']] })
		assert.deepEqual(tile.rects.map((r) => r.fill), ['#faea89'])
	})
})
