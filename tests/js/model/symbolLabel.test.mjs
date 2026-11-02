/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 211: the label below symbols, BPMN events and gateways.
 * - AK1 shapes.js symbolLabelBox / hasLabel: centred SYMBOL_LABEL_GAP below
 *   the box, wrapped at max(w, SYMBOL_LABEL_WRAP_W), the stored font size or
 *   SYMBOL_LABEL_FONT_SIZE; null for a blank text, an own shape, a task, rect
 * - AK2 nodes/shape.js: the text node stands in that box, centred, in the
 *   text colour; a task keeps its text inside; a blank label draws nothing
 * - AK4 SceneModel: a point on the label hits the shape (filled or not,
 *   turned by 90°), bboxOf and exportBounds hold the label
 * - AK5 a duplicate carries the label; moving keeps it below the shape
 * - AK8 the context bar has no text alignment for labelled shapes only
 *
 * Factory job 235: an own shape (kind image) has the same label (AK1 hasLabel
 * and symbolLabelBox, AK2 the text node, AK4 hit and bounds, also turned).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { duplicateItems } from '../../../src/board/actions.js'
import { contextSections } from '../../../src/components/contextbar.js'
import { SceneModel, shapeLabelOf } from '../../../src/model/SceneModel.js'
import { hasLabel, isTextless, symbolLabelBox } from '../../../src/model/shapes.js'
import { LINE_HEIGHT, SYMBOL_LABEL_FONT_SIZE, SYMBOL_LABEL_GAP, SYMBOL_LABEL_WRAP_W } from '../../../src/model/tokens.js'
import { exportBounds } from '../../../src/scene/exportImage.js'
import { shape } from '../../../src/scene/nodes/shape.js'

const S = '01JA0000000000000000000001'

const item = (kind, o = {}) => ({
	id: S, t: 'shape', x: 100, y: 100, w: 96, h: 96, r: 0, z: 'a1', parent: null,
	data: { kind, text: '' }, style: { fill: '#191b1d', strokeWidth: 0 }, ...o,
})
const labelled = (kind, text, o = {}) => item(kind, { ...o, data: { kind, text } })

/** @param {object[]} items WireItems @return {SceneModel} */
function modelOf(items) {
	const m = new SceneModel()
	m.load(structuredClone(items))
	return m
}

/** Minimal Konva node classes for shape.build. */
class FakeNode {
	constructor(attrs = {}) {
		this.attrs = { ...attrs }
		this.children = []
	}

	setAttrs(a) { Object.assign(this.attrs, a) }
	getAttr(k) { return this.attrs[k] }
	visible(v) {
		if (v === undefined) return this.attrs.visible !== false
		this.attrs.visible = v
		return this
	}

	transformsEnabled() {}
	add(...c) { this.children.push(...c) }
	destroy() {}
}
const builder = { Group: class extends FakeNode {}, Rect: class extends FakeNode {}, Text: class extends FakeNode {}, Shape: class extends FakeNode {}, Line: class extends FakeNode {}, shadows: true }

describe('job 211 AK1: symbolLabelBox', () => {
	test('a symbol, a start event and a gateway: centred below the box, one line, the default font size', () => {
		for (const [kind, w, h] of [['iconPerson', 96, 96], ['bpmnStart', 36, 36], ['bpmnExclusive', 50, 50]]) {
			assert.equal(hasLabel(kind), true, kind)
			const l = symbolLabelBox(kind, 'Kunde', null, w, h)
			assert.ok(l, kind)
			assert.equal(l.fs, SYMBOL_LABEL_FONT_SIZE)
			assert.equal(l.lines, 1)
			assert.equal(l.y, h + SYMBOL_LABEL_GAP)
			assert.equal(l.h, SYMBOL_LABEL_FONT_SIZE * LINE_HEIGHT)
			assert.ok(l.w > 0 && l.w <= Math.max(w, SYMBOL_LABEL_WRAP_W))
			assert.ok(Math.abs(l.x + l.w / 2 - w / 2) < 1e-9, 'centred under the box')
			assert.equal(l.wrapW, Math.max(w, SYMBOL_LABEL_WRAP_W))
		}
	})

	test('a long text wraps into more lines, never wider than max(w, 160); a wide box wraps at its width; a stored font size counts', () => {
		const long = 'Customer support team of the northern region'
		const l = symbolLabelBox('iconPeople', long, null, 96, 96)
		assert.ok(l.lines > 1)
		assert.ok(l.w <= SYMBOL_LABEL_WRAP_W)
		assert.equal(l.h, l.lines * SYMBOL_LABEL_FONT_SIZE * LINE_HEIGHT)
		const wide = symbolLabelBox('iconPeople', long, null, 600, 96)
		assert.equal(wide.lines, 1)
		assert.equal(wide.wrapW, 600)
		const big = symbolLabelBox('iconPerson', 'Kunde', 24, 96, 96)
		assert.equal(big.fs, 24)
		assert.ok(big.w > symbolLabelBox('iconPerson', 'Kunde', null, 96, 96).w)
		assert.equal(big.h, 24 * LINE_HEIGHT)
		assert.equal(symbolLabelBox('iconPerson', 'a\nb', null, 96, 96).lines, 2, 'a line break')
	})

	test('null for a blank text, a BPMN task, a data object and rect', () => {
		assert.equal(symbolLabelBox('iconPerson', '', null, 96, 96), null)
		assert.equal(symbolLabelBox('iconPerson', '  \n ', null, 96, 96), null)
		assert.equal(symbolLabelBox('iconPerson', undefined, null, 96, 96), null)
		for (const kind of ['bpmnTask', 'bpmnDataObject', 'rect', 'nope']) {
			assert.equal(hasLabel(kind), false, kind)
			assert.equal(symbolLabelBox(kind, 'Kunde', null, 96, 96), null, kind)
		}
	})

	test('6000 characters and emoji: a finite box, as many lines as needed', () => {
		const l = symbolLabelBox('iconPerson', 'Wort '.repeat(1200), null, 96, 96)
		assert.ok(Number.isFinite(l.h) && l.lines > 100)
		assert.ok(l.w <= SYMBOL_LABEL_WRAP_W)
		const e = symbolLabelBox('iconStar', '⭐👩‍👩‍👧 Team 東京', null, 96, 96)
		assert.ok(e.w > 0 && e.w <= SYMBOL_LABEL_WRAP_W)
	})
})

describe('job 211 AK2: drawing the label', () => {
	const build = (it) => shape.build(builder, it, { x: it.x, y: it.y, w: it.w, h: it.h, r: 0 }, 0).parts.text.attrs

	test('a symbol with text: the text node in the label box below, centred, in the text colour', () => {
		const it = labelled('iconPerson', 'Kunde', { style: { fill: '#191b1d', strokeWidth: 0, textColor: '#c43e45' } })
		const a = build(it)
		const l = shapeLabelOf(it, it)
		assert.equal(a.text, 'Kunde')
		assert.ok(a.y >= it.h, 'below the box')
		assert.deepEqual([a.x, a.y, a.width, a.fontSize], [l.x, l.y, l.w, l.fs])
		assert.equal(a.height, undefined, 'no fixed height: Konva keeps every line')
		assert.equal(a.align, 'center')
		assert.equal(a.fill, '#c43e45')
	})

	test('a BPMN event and gateway too; a task keeps its text inside; a blank label draws nothing', () => {
		for (const kind of ['bpmnEnd', 'bpmnParallel']) {
			const a = build(labelled(kind, 'Fertig', { w: 64, h: 64 }))
			assert.equal(a.text, 'Fertig')
			assert.ok(a.y >= 64, kind)
		}
		const task = build(labelled('bpmnTask', 'Prüfen', { w: 180, h: 120 }))
		assert.equal(task.text, 'Prüfen')
		assert.ok(task.y < 120 && task.height > 0, 'inside the task')
		assert.equal(build(labelled('iconPerson', '   ')).text, '')
		assert.equal(build(item('image')).text, '', 'an own shape without a label draws none')
	})

	test('a new text updates the node through update (data changed)', () => {
		const it = labelled('iconPerson', 'Kunde')
		const e = shape.build(builder, it, { x: 100, y: 100, w: 96, h: 96, r: 0 }, 0)
		const next = labelled('iconPerson', 'Kundin und Kunde aus dem Norden')
		shape.update(builder, e, next, { x: 100, y: 100, w: 96, h: 96, r: 0 }, new Set(['data']))
		assert.equal(e.parts.text.attrs.text, 'Kundin und Kunde aus dem Norden')
		assert.equal(e.parts.text.attrs.width, shapeLabelOf(next, next).w)
	})
})

describe('job 211 AK4: hit test and bounds', () => {
	test('a point on the label hits the symbol; beside it nothing; bboxOf and exportBounds hold the label', () => {
		const it = labelled('iconPerson', 'Kunde')
		const m = modelOf([it])
		const l = shapeLabelOf(it, it)
		const cx = 100 + l.x + l.w / 2
		const cy = 100 + l.y + l.h / 2
		assert.equal(m.hitTest(cx, cy, 0), S)
		assert.equal(m.hitTest(cx, cy, 0, { hollow: true }), S, 'the select tool too')
		assert.equal(m.hitTest(100 + l.x - 5, cy, 0), null, 'left of the label')
		const b = m.bboxOf(S)
		assert.ok(b.maxY >= 100 + l.y + l.h - 1e-9)
		assert.ok(b.minX <= 100 + l.x + 1e-9 && b.maxX >= 100 + l.x + l.w - 1e-9)
		const e = exportBounds(m, [S])
		assert.ok(e.y + e.h >= 100 + l.y + l.h - 1e-9, 'the PNG export reaches down over the label')
		const plain = modelOf([item('iconPerson')])
		assert.deepEqual(plain.bboxOf(S), { minX: 100, minY: 100, maxX: 196, maxY: 196 }, 'no label: the box only')
		assert.equal(plain.hitTest(cx, cy, 0), null)
	})

	test('an event without fill: its inside stays canvas for the select tool, its label still hits', () => {
		const it = labelled('bpmnStart', 'Start', { w: 64, h: 64, style: { fill: '#ffffff', fillOpacity: 0, strokeWidth: 2 } })
		const m = modelOf([it])
		const l = shapeLabelOf(it, it)
		assert.equal(m.hitTest(132, 132, 0, { hollow: true }), null, 'the empty inside')
		assert.equal(m.hitTest(100 + l.x + l.w / 2, 100 + l.y + l.h / 2, 0, { hollow: true }), S)
	})

	test('turned by 90°: the label stands left of the box (around its centre); there it hits, below the box it does not; bboxOf holds it', () => {
		const it = labelled('iconPerson', 'Kunde', { r: 90 })
		const m = modelOf([it])
		const l = shapeLabelOf(it, it)
		// local (x, y) → world: centre (148, 148), turned by 90°: (dx, dy) → (−dy, dx)
		const dy = l.y + l.h / 2 - 48
		const wx = 148 - dy
		const wy = 148
		assert.ok(wx < 100, 'left of the box')
		assert.equal(m.hitTest(wx, wy, 0), S)
		assert.equal(m.hitTest(148, 196 + SYMBOL_LABEL_GAP + l.h / 2, 0), null, 'nothing below the box')
		const b = m.bboxOf(S)
		assert.ok(b.minX <= 148 - (l.y + l.h - 48) + 1e-9)
	})
})

describe('job 211 AK5: the label goes with the shape', () => {
	test('a duplicate carries the label; a move keeps it below the shape', () => {
		const m = modelOf([labelled('iconPerson', 'Kunde')])
		let n = 0
		const r = duplicateItems(m, [S], {}, () => '01JA' + String(100 + ++n).padStart(22, '0'))
		const puts = r.ops.filter((o) => o.o === 'put' && o.t === 'shape')
		assert.equal(puts.length, 1)
		assert.notEqual(puts[0].id, S)
		assert.equal(puts[0].p.data.text, 'Kunde')
		assert.equal(puts[0].p.data.kind, 'iconPerson')
		const before = m.bboxOf(S)
		m.apply({ upserts: [labelled('iconPerson', 'Kunde', { x: 300, y: 50 })] })
		const after = m.bboxOf(S)
		assert.deepEqual([after.minX - before.minX, after.minY - before.minY, after.maxX - before.maxX, after.maxY - before.maxY], [200, -50, 200, -50])
	})
})

describe('job 211 AK8: the context bar', () => {
	const sel = (o) => ({ count: 1, types: new Set(['shape']), fields: ['style.fill', 'style.textColor', 'style.fontSize', 'style.align', 'style.valign', 'data.kind'], mixed: [], ...o })

	test('only labelled shapes: no text alignment, text colour and size stay; with a task: alignment', () => {
		const only = contextSections(sel({ kind: 'bpmnStart', labelled: true }))
		assert.equal(only.align, null)
		assert.equal(only.valign, null)
		assert.ok(only.textColor)
		assert.ok(only.fontSize)
		const mixed = contextSections(sel({ count: 2, kind: null, mixed: ['data.kind'], labelled: false }))
		assert.ok(Array.isArray(mixed.align) && Array.isArray(mixed.valign))
	})
})

describe('job 211 risk: elbow connectors and labels (job 197)', () => {
	const id = (n) => '01JA' + String(n).padStart(22, '0')
	const note = (i, x) => ({ id: i, t: 'sticky', x, y: 0, w: 200, h: 200, r: 0, z: 'a' + i.slice(-4), parent: null, data: { text: '' }, style: {} })
	const elbow = (i, from, to) => ({
		id: i, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + i.slice(-4), parent: null,
		data: { start: { item: from }, end: { item: to }, route: 'elbow' }, style: { strokeWidth: 2 },
	})
	const ev = (text) => ({ ...labelled('bpmnStart', text, { id: id(3), x: 480, y: 20, w: 40, h: 40, z: 'a0003' }) })

	test('a label in the way is gone round; the route equals the one of a model loaded fresh after the label changed', () => {
		const A = id(1)
		const B = id(2)
		const C = id(4)
		const items = [note(A, 0), note(B, 800), ev(''), elbow(C, A, B)]
		const m = modelOf(items)
		assert.deepEqual(m.geometryOf(C).points, [200, 100, 800, 100], 'no label: straight through below the event')
		const long = 'Bestellung eingegangen beim Vertrieb Nord'
		m.apply({ upserts: [ev(long)] })
		const l = shapeLabelOf(m.get(id(3)), m.abs(id(3)))
		assert.ok(20 + l.y < 100 && 20 + l.y + l.h > 100, 'the label reaches over the line (the event itself does not)')
		const pts = m.geometryOf(C).points
		assert.notDeepEqual(pts, [200, 100, 800, 100], 'the line goes round the label')
		const fresh = modelOf([note(A, 0), note(B, 800), ev(long), elbow(C, A, B)])
		assert.deepEqual(fresh.geometryOf(C).points, pts, 'the same route on every client')
	})
})

describe('job 211 AK4: a label that arrives later', () => {
	test('a text, a kind or a font size that arrives by apply moves the index box and the hit with it; an empty text gives the box back', () => {
		const m = modelOf([item('iconPerson')])
		m.apply({ upserts: [labelled('iconPerson', 'Kunde')] })
		const l = shapeLabelOf(m.get(S), m.abs(S))
		assert.equal(m.hitTest(148, 100 + l.y + l.h / 2, 0), S, 'the new label hits')
		assert.ok(m.bboxOf(S).maxY >= 100 + l.y + l.h - 1e-9)
		m.apply({ upserts: [labelled('iconPerson', 'Kunde', { style: { fill: '#191b1d', strokeWidth: 0, fontSize: 40 } })] })
		assert.ok(m.bboxOf(S).maxY >= 100 + 96 + SYMBOL_LABEL_GAP + 40 * LINE_HEIGHT - 1e-9, 'a larger font size')
		m.apply({ upserts: [labelled('rect', 'Kunde')] })
		assert.deepEqual(m.bboxOf(S), { minX: 100, minY: 100, maxX: 196, maxY: 196 }, 'a rect: its text is inside')
		m.apply({ upserts: [labelled('bpmnEnd', 'Kunde')] })
		assert.ok(m.bboxOf(S).maxY > 196, 'switched to an end event: a label again')
		m.apply({ upserts: [labelled('bpmnEnd', '')] })
		assert.deepEqual(m.bboxOf(S), { minX: 100, minY: 100, maxX: 196, maxY: 196 })
	})
})

describe('job 211 round 2: the neighbour of "+" below a label', () => {
	test('below a labelled event it begins SERIES_GAP below the label; without a label, and on the other sides, as before', async () => {
		const { neighbourBox, SERIES_GAP } = await import('../../../src/model/plus.js')
		const ev = labelled('bpmnStart', 'Bestellung eingegangen', { w: 36, h: 36 })
		const m = modelOf([ev])
		const l = shapeLabelOf(ev, ev)
		const b = neighbourBox(m, S, 'b')
		assert.equal(b.y, 100 + l.y + l.h + SERIES_GAP)
		assert.equal(b.x, 100)
		assert.deepEqual(neighbourBox(m, S, 'r'), { x: 100 + 36 + SERIES_GAP, y: 100, w: 36, h: 36, r: 0 }, 'right: unchanged')
		const plain = modelOf([labelled('bpmnStart', '', { w: 36, h: 36 })])
		assert.equal(neighbourBox(plain, S, 'b').y, 100 + 36 + SERIES_GAP, 'no label: as before')
	})
})

// ---------------------------------------------------------------- job 235 (own shapes)

describe('job 235 AK1: the label of an own shape', () => {
	test('hasLabel and the label box like a symbol; still textless inside', () => {
		assert.equal(hasLabel('image'), true)
		assert.equal(isTextless('image'), true, 'no text inside the picture, no editor for a new one')
		const l = symbolLabelBox('image', 'Server', null, 96, 48)
		assert.deepEqual([l.y, l.fs, l.wrapW, l.lines], [48 + SYMBOL_LABEL_GAP, SYMBOL_LABEL_FONT_SIZE, SYMBOL_LABEL_WRAP_W, 1])
		assert.equal(l.x, (96 - l.w) / 2)
		assert.ok(l.w > 0 && l.w <= SYMBOL_LABEL_WRAP_W)
		const long = symbolLabelBox('image', 'Datenbankserver der Buchhaltung im Rechenzentrum Nord', null, 96, 48)
		assert.ok(long.lines > 1 && long.w <= SYMBOL_LABEL_WRAP_W)
		const big = symbolLabelBox('image', 'Server', 24, 96, 48)
		assert.ok(big.fs === 24 && big.w > l.w && big.h > l.h)
		assert.equal(symbolLabelBox('image', '', null, 96, 48), null)
		assert.equal(symbolLabelBox('image', '  \n ', null, 96, 48), null)
		assert.equal(symbolLabelBox('bpmnTask', 'Server', null, 96, 48), null)
		assert.equal(symbolLabelBox('rect', 'Server', null, 96, 48), null)
	})

	test('a large picture (800 × 600): wrapped at its width, SYMBOL_LABEL_GAP below it, inside the export bounds', () => {
		const l = symbolLabelBox('image', 'Grundriss Erdgeschoss', null, 800, 600)
		assert.deepEqual([l.wrapW, l.y], [800, 606])
		const it = labelled('image', 'Grundriss Erdgeschoss', { w: 800, h: 600 })
		const e = exportBounds(modelOf([it]), [S])
		assert.ok(e.y + e.h >= 100 + 606 + l.h - 1e-9, 'the PNG export reaches down over the label')
	})
})

describe('job 235 AK2: drawing the label of an own shape', () => {
	const build = (it) => shape.build(builder, it, { x: it.x, y: it.y, w: it.w, h: it.h, r: 0 }, 0).parts.text.attrs

	test('the text node in the label box below the picture, centred, in the text colour; none without a label', () => {
		const it = labelled('image', 'Server', { h: 48, style: { strokeWidth: 0, fillOpacity: 0, textColor: '#c43e45' } })
		const a = build(it)
		const l = shapeLabelOf(it, it)
		assert.equal(a.text, 'Server')
		assert.ok(a.y >= 48)
		assert.deepEqual([a.x, a.y, a.width, a.fontSize, a.align, a.fill], [l.x, l.y, l.w, l.fs, 'center', '#c43e45'])
		assert.ok(Math.abs(a.x + a.width / 2 - 48) < 1e-9, 'centred under the box')
		assert.equal(build(labelled('image', '', { h: 48 })).text, '')
	})
})

describe('job 235 AK4: hit test and bounds of an own shape\'s label', () => {
	test('a point on the label selects the own shape (the select tool too); bboxOf and exportBounds hold it; no label: the box only', () => {
		const it = labelled('image', 'Server', { style: { strokeWidth: 0, fillOpacity: 0 } })
		const m = modelOf([it])
		const l = shapeLabelOf(it, it)
		const cx = 100 + l.x + l.w / 2
		const cy = 100 + l.y + l.h / 2
		assert.equal(m.hitTest(cx, cy, 0), S)
		assert.equal(m.hitTest(cx, cy, 0, { hollow: true }), S)
		assert.equal(m.hitTest(100 + l.x - 5, cy, 0), null, 'left of the label')
		assert.ok(m.bboxOf(S).maxY >= 100 + l.y + l.h - 1e-9)
		const e = exportBounds(m, [S])
		assert.ok(e.y + e.h >= 100 + l.y + l.h - 1e-9)
		const plain = modelOf([item('image', { style: { strokeWidth: 0, fillOpacity: 0 } })])
		assert.deepEqual(plain.bboxOf(S), { minX: 100, minY: 100, maxX: 196, maxY: 196 })
		assert.equal(plain.hitTest(cx, cy, 0), null)
	})

	test('turned by 90°: the label hits left of the box, not below it; bboxOf holds it', () => {
		const it = labelled('image', 'Server', { r: 90, style: { strokeWidth: 0, fillOpacity: 0 } })
		const m = modelOf([it])
		const l = shapeLabelOf(it, it)
		const dy = l.y + l.h / 2 - 48
		assert.equal(m.hitTest(148 - dy, 148, 0), S)
		assert.equal(m.hitTest(148, 196 + SYMBOL_LABEL_GAP + l.h / 2, 0), null)
		assert.ok(m.bboxOf(S).minX <= 148 - (l.y + l.h - 48) + 1e-9)
	})

	test('a duplicate carries the label of an own shape', () => {
		const m = modelOf([labelled('image', 'Server')])
		const r = duplicateItems(m, [S], {}, () => '01JA' + String(200).padStart(22, '0'))
		const put = r.ops.find((o) => o.o === 'put' && o.t === 'shape')
		assert.deepEqual([put.p.data.kind, put.p.data.text], ['image', 'Server'])
	})
})
