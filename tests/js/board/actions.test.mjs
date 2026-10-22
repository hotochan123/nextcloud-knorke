/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	ALIGN_EDGES, alignableIds, alignItems, DISTRIBUTE_AXES, distributeItems, tidyItems,
	arrangeItem, copyPayload, createItem, deleteItems, duplicateItems, maxItemsOf, measureTarget, moveItems, nextNote,
	pasteItems, remeasure, reorder, round2, setFill, setStyle, setText, transformItems,
} from '../../../src/board/actions.js'
import { rotatedBBox } from '../../../src/model/geometry.js'
import { ULID_RE } from '../../../src/model/ids.js'
import { applyPatch } from '../../../src/model/paths.js'
import { TYPES } from '../../../src/model/registry.js'
import { nearestFrameFill, SHAPE_PALETTE, STICKY_COLORS } from '../../../src/model/tokens.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { FakeModel, ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const F = ID('F1')
const F2 = ID('F2')
const A = ID(1)
const B = ID(2)
const C = ID(3)

/**
 * Every placement op and every placement inverse carries x, y and parent.
 *
 * @param {object[]} ops ops
 */
function assertPlacementGroups(ops) {
	for (const op of ops) {
		if (op.o !== 'patch') {
			continue
		}
		const keys = Object.keys(op.p).filter((k) => k === 'x' || k === 'y' || k === 'parent')
		assert.ok(keys.length === 0 || keys.length === 3, 'placement group complete: ' + JSON.stringify(op))
	}
}

test('create sticky: defaults, centered on the click, z above the content, new ULID', () => {
	const m = new FakeModel([sticky(A, { z: 'i5' }), frame(F, { z: 'a0', x: 5000 })])
	const r = createItem(m, { t: 'sticky', at: { x: 100, y: 50 }, rect: null })
	assert.equal(r.ops.length, 1)
	const put = r.ops[0]
	assert.equal(put.o, 'put')
	assert.match(put.id, ULID_RE)
	assert.equal(put.t, 'sticky')
	assert.deepEqual(put.p, { x: 0, y: -50, w: 200, h: 200, r: 0, z: put.p.z, parent: null, data: { text: '' }, style: { fill: '#a8d8f8' } })
	assert.ok(isValidKey(put.p.z) && put.p.z > 'i5')
	assert.deepEqual(r.inverse, [{ o: 'remove', id: put.id }])
	assert.deepEqual(r.selectIds, [put.id])
})

test('create sticky inside a frame: parent = frame, coordinates relative', () => {
	const m = new FakeModel([frame(F, { x: 1000, y: 500 })])
	const r = createItem(m, { t: 'sticky', at: { x: 1300, y: 800 } }, () => A)
	assert.equal(r.ops[0].p.parent, F)
	assert.equal(r.ops[0].p.x, 200)
	assert.equal(r.ops[0].p.y, 200)
	// a frame is never placed into another frame
	const r2 = createItem(m, { t: 'frame', at: { x: 1300, y: 800 }, rect: null }, () => F2)
	assert.equal(r2.ops[0].p.parent, null)
	assert.equal(r2.ops[0].p.x, 900)
	assert.equal(r2.ops[0].p.w, 800)
})

test('create frame from a rect adopts the top-level non-container items completely inside', () => {
	const m = new FakeModel([
		sticky(A, { x: 110, y: 120 }),
		sticky(B, { x: 950, y: 120 }), // partly outside
		frame(F2, { x: 150, y: 150, w: 100, h: 100 }), // a container: never adopted
		sticky(C, { x: 10, y: 10, parent: F2 }), // not top-level
	])
	const r = createItem(m, { t: 'frame', at: { x: 0, y: 0 }, rect: { x: 100, y: 100, w: 1000, h: 600 } }, () => F)
	assert.equal(r.ops[0].o, 'put')
	assert.deepEqual({ x: r.ops[0].p.x, y: r.ops[0].p.y, w: r.ops[0].p.w, h: r.ops[0].p.h }, { x: 100, y: 100, w: 1000, h: 600 })
	assert.deepEqual(r.ops.slice(1), [{ o: 'patch', id: A, p: { x: 10, y: 20, parent: F } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: A, p: { x: 110, y: 120, parent: null } }, { o: 'remove', id: F }])
	assertPlacementGroups([...r.ops, ...r.inverse])
})

test('move: new position from origin (never from the model), into and out of frames', () => {
	const m = new FakeModel([frame(F, { x: 1000, y: 0, w: 800, h: 600 }), sticky(A, { x: 50, y: 50, parent: F }), sticky(B, { x: 0, y: 0 })])
	// the model holds a dragged (and here deliberately wrong) position
	m.moveLocal([A], 777, 777)
	const origin = new Map([[A, { x: 50, y: 50, parent: F }]])
	// out of the frame: abs(F) + origin + d = (1000+50-900, 0+50+0) = (150, 50)
	let r = moveItems(m, { ids: [A], dx: -900, dy: 0, origin })
	assert.deepEqual(r.ops, [{ o: 'patch', id: A, p: { x: 150, y: 50, parent: null } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: A, p: { x: 50, y: 50, parent: F } }])
	// root note into the frame: center (1200+100, 100+100) lies in F
	r = moveItems(m, { ids: [B], dx: 1200, dy: 100, origin: new Map([[B, { x: 0, y: 0, parent: null }]]) })
	assert.deepEqual(r.ops, [{ o: 'patch', id: B, p: { x: 200, y: 100, parent: F } }])
	// rounding to 0.01
	r = moveItems(m, { ids: [B], dx: 1.23456, dy: -0.004, origin: new Map([[B, { x: 0, y: 0, parent: null }]]) })
	assert.deepEqual(r.ops[0].p, { x: round2(1.23456), y: -0, parent: null })
	assertPlacementGroups([...r.ops, ...r.inverse])
})

test('move: a dragged frame never becomes a child; dragged descendants are excluded; no-op moves vanish', () => {
	const m = new FakeModel([frame(F, { x: 0, y: 0 }), frame(F2, { x: 2000, y: 0 }), sticky(A, { x: 10, y: 10, parent: F })])
	const r = moveItems(m, { ids: [F], dx: 2100, dy: 0, origin: new Map([[F, { x: 0, y: 0, parent: null }]]) })
	assert.deepEqual(r.ops, [{ o: 'patch', id: F, p: { x: 2100, y: 0, parent: null } }])
	const none = moveItems(m, { ids: [A], dx: 0, dy: 0, origin: new Map([[A, { x: 10, y: 10, parent: F }]]) })
	assert.deepEqual(none, { ops: [], inverse: [] })
})

test('delete: frame children are freed first (absolute), inverse revives containers first and hangs children back', () => {
	const f = frame(F, { x: 100, y: 200, data: { title: 'Ideas' } })
	const a = sticky(A, { x: 10, y: 20, parent: F, data: { text: 'a' } })
	const b = sticky(B, { x: 30, y: 40, parent: F })
	const m = new FakeModel([f, a, b])
	const r = deleteItems(m, [B, F])
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: A, p: { x: 110, y: 220, parent: null } },
		{ o: 'remove', id: B },
		{ o: 'remove', id: F },
	])
	const { id: fid, t: ft, ...fp } = f
	const { id: bid, t: bt, ...bp } = b
	assert.deepEqual(r.inverse, [
		{ o: 'put', id: fid, t: ft, revive: true, p: { ...fp, group: null } },
		{ o: 'put', id: bid, t: bt, revive: true, p: { ...bp, group: null } },
		{ o: 'patch', id: A, p: { x: 10, y: 20, parent: F } },
	])
	assertPlacementGroups([...r.ops, ...r.inverse])
	// unknown ids are ignored
	assert.deepEqual(deleteItems(m, [ID(99)]), { ops: [], inverse: [] })
})

test('text, fill and order', () => {
	const m = new FakeModel([sticky(A, { z: 'i1' }), sticky(B, { z: 'i3', style: {} }), frame(F, { z: 'a5' }), frame(F2, { z: 'a7' })])
	assert.deepEqual(setText(m, { id: A, path: 'data.text', value: 'new', before: 'old' }), {
		ops: [{ o: 'patch', id: A, p: { 'data.text': 'new' } }],
		inverse: [{ o: 'patch', id: A, p: { 'data.text': 'old' } }],
	})
	const fill = setFill(m, [A, B], '#FFB27A')
	assert.deepEqual(fill.ops, [{ o: 'patch', id: A, p: { 'style.fill': '#ffb27a' } }, { o: 'patch', id: B, p: { 'style.fill': '#ffb27a' } }])
	assert.deepEqual(fill.inverse, [{ o: 'patch', id: A, p: { 'style.fill': '#a8d8f8' } }, { o: 'patch', id: B, p: { 'style.fill': null } }])
	assert.deepEqual(setFill(m, [A], '#a8d8f8'), { ops: [], inverse: [] })

	const front = reorder(m, [B, A, F], 'front')
	const zs = Object.fromEntries(front.ops.map((o) => [o.id, o.p.z]))
	assert.ok(zs[A] > 'i3' && zs[B] > zs[A], 'content above the content max, relative order kept')
	assert.ok(zs[F] > 'a7', 'frames stay in their layer, above the frame max')
	assert.deepEqual(front.inverse.find((o) => o.id === A), { o: 'patch', id: A, p: { z: 'i1' } })
	const back = reorder(m, [B, A], 'back')
	const bz = Object.fromEntries(back.ops.map((o) => [o.id, o.p.z]))
	assert.ok(bz[A] < 'i1' && bz[A] < bz[B] && bz[B] < 'i1')
	for (const z of [...Object.values(zs), ...Object.values(bz)]) {
		assert.ok(isValidKey(z), z)
	}
})

test('setText: a lone UTF-16 surrogate becomes U+FFFD (T14); valid pairs stay', () => {
	const m = new FakeModel([sticky(A, { data: { text: 'old' } })])
	const r = setText(m, { id: A, path: 'data.text', value: 'a\uD83Db', before: 'old' })
	assert.deepEqual(r.ops, [{ o: 'patch', id: A, p: { 'data.text': 'a�b' } }])
	const lowFirst = setText(m, { id: A, path: 'data.text', value: '\uDE00x\uD83D', before: 'b\uD800' })
	assert.equal(lowFirst.ops[0].p['data.text'], '�x�')
	assert.equal(lowFirst.inverse[0].p['data.text'], 'b�')
	const pair = setText(m, { id: A, path: 'data.text', value: 'ok 😀', before: 'old' })
	assert.equal(pair.ops[0].p['data.text'], 'ok 😀')
})

// ---- SPEC-M1 §6.5.2 actions v2 (stage 1, round 1a) ---------------------------

/**
 * @param {...string} ids ids handed out in this order
 * @return {() => string} id generator
 */
function ids(...list) {
	let i = 0
	return () => list[i++]
}

const S = ID('S1')
const T = ID('T1')
const K1 = ID('K1')
const K2 = ID('K2')
const C1 = ID('C1')
const X = ID('X1')

test('M1 create shape: tool options in data/style (only valid typed values, normalised), default size centered, editor hint', () => {
	const m = new FakeModel([])
	const r = createItem(m, { t: 'shape', at: { x: 100, y: 50 }, rect: null, data: { kind: 'ellipse' }, style: { fill: '#ABCDEF', stroke: 'red', bogus: 1 } }, () => S)
	assert.deepEqual(r.ops, [{
		o: 'put', id: S, t: 'shape',
		p: { x: 0, y: -10, w: 200, h: 120, r: 0, z: r.ops[0].p.z, parent: null, data: { kind: 'ellipse', text: '' }, style: { fill: '#abcdef', stroke: '#1a1a1a', strokeWidth: 2 } },
	}])
	assert.equal(r.edit, true)
	assert.deepEqual(r.inverse, [{ o: 'remove', id: S }])
	// an unknown kind is not taken over; the registry default stays
	assert.equal(createItem(m, { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'star' } }, () => S).ops[0].p.data.kind, 'rect')
	// dragged out: rect, w/h clamped to TYPES.shape.size
	const d = createItem(m, { t: 'shape', at: { x: 0, y: 0 }, rect: { x: 10, y: 20, w: 5, h: 300 } }, () => S).ops[0].p
	assert.deepEqual([d.x, d.y, d.w, d.h], [10, 20, TYPES.shape.size[0], 300])
})

test('M1 create text: click → left edge at the click, default size; drag → only the width; frames no editor; connectors never', () => {
	const m = new FakeModel([])
	const click = createItem(m, { t: 'text', at: { x: 100, y: 50 }, rect: null }, () => T)
	const d = TYPES.text.defaults
	assert.deepEqual([click.ops[0].p.x, click.ops[0].p.y, click.ops[0].p.w, click.ops[0].p.h], [100, 50 - d.h / 2, d.w, d.h])
	assert.deepEqual(click.ops[0].p.style, { fontSize: 24, color: '#1a1a1a', align: 'left' })
	assert.equal(click.edit, true)
	const drag = createItem(m, { t: 'text', at: { x: 0, y: 0 }, rect: { x: 10, y: 20, w: 400, h: 3 } }, () => T)
	assert.deepEqual([drag.ops[0].p.x, drag.ops[0].p.y, drag.ops[0].p.w, drag.ops[0].p.h], [10, 20, 400, d.h])
	assert.equal(createItem(m, { t: 'frame', at: { x: 0, y: 0 } }, () => F).edit, false)
	assert.equal(createItem(m, { t: 'sticky', at: { x: 0, y: 0 } }, () => A).edit, true)
	assert.deepEqual(createItem(m, { t: 'connector', at: { x: 0, y: 0 } }, () => C1).ops, [])
})

test('M1 transform: one patch per item with the placement group and the size on the 0.01 grid (q), from the intent\'s boxes; inverse = old values', () => {
	const m = new FakeModel([shape(S, { x: 100, y: 100 })])
	// the scene previews the transform in the model: the action must not read it
	m.items.get(S).x = 777
	const before = new Map([[S, { x: 100, y: 100, w: 200, h: 120, r: 0, parent: null }]])
	const after = new Map([[S, { x: 90.004, y: 95.556, w: 220.126, h: 130, r: -45 }]])
	const r = transformItems(m, { ids: [S], before, after, keep: false })
	assert.deepEqual(r.ops, [{ o: 'patch', id: S, p: { x: 90, y: 95.56, parent: null, w: 220.13, h: 130, r: 315 } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: S, p: { x: 100, y: 100, parent: null, w: 200, h: 120, r: 0 } }])
	assertPlacementGroups([...r.ops, ...r.inverse])
	// sizes are clamped to the type; an angle of 360 is 0
	const big = transformItems(m, { ids: [S], before, after: new Map([[S, { x: 0, y: 0, w: 5, h: 99999, r: 360 }]]) })
	assert.deepEqual([big.ops[0].p.w, big.ops[0].p.h, big.ops[0].p.r], [TYPES.shape.size[0], TYPES.shape.size[1], 0])
})

test('M1 transform: x/y stay relative to an untransformed parent frame', () => {
	const m = new FakeModel([frame(F, { x: 1000, y: 500 }), shape(S, { x: 50, y: 60, parent: F })])
	const r = transformItems(m, {
		ids: [S],
		before: new Map([[S, { x: 1050, y: 560, w: 200, h: 120, r: 0, parent: F }]]),
		after: new Map([[S, { x: 1100, y: 600, w: 300, h: 200, r: 0 }]]),
	})
	assert.deepEqual(r.ops[0].p, { x: 100, y: 100, parent: F, w: 300, h: 200, r: 0 })
	assert.deepEqual(r.inverse[0].p, { x: 50, y: 60, parent: F, w: 200, h: 120, r: 0 })
})

test('M1 transform text: style.fontSize (whole number in the rule) and the measured height (rule 13)', () => {
	const m = new FakeModel([textItem(T)])
	const before = new Map([[T, { x: 0, y: 0, w: 240, h: 28.8, r: 0, parent: null, fontSize: 24 }]])
	const r = transformItems(m, { ids: [T], before, after: new Map([[T, { x: 0, y: 0, w: 480, h: 57, r: 0, fontSize: 48.4 }]]), heights: new Map([[T, 57.6]]) })
	assert.deepEqual(r.ops[0].p, { x: 0, y: 0, parent: null, w: 480, h: 57.6, r: 0, 'style.fontSize': 48 })
	assert.deepEqual(r.inverse[0].p, { x: 0, y: 0, parent: null, w: 240, h: 28.8, r: 0, 'style.fontSize': 24 })
	const huge = transformItems(m, { ids: [T], before, after: new Map([[T, { x: 0, y: 0, w: 480, h: 57, r: 0, fontSize: 900 }]]) })
	assert.equal(huge.ops[0].p['style.fontSize'], 400)
	// only the width (side handle): no font size in the patch
	const side = transformItems(m, { ids: [T], before, after: new Map([[T, { x: 0, y: 0, w: 120, h: 28.8, r: 0, fontSize: 24 }]]), heights: new Map([[T, 86.4]]) })
	assert.deepEqual(side.ops[0].p, { x: 0, y: 0, parent: null, w: 120, h: 86.4, r: 0 })
})

test('M1 transform frame from the top left with keep: keep on the frame and its inverse; a child outside is freed, a top-level item inside is adopted (rule 15)', () => {
	const m = new FakeModel([
		frame(F, { x: 100, y: 100, w: 400, h: 400 }),
		sticky(K1, { x: 300, y: 300, w: 100, h: 100, parent: F }),
		sticky(K2, { x: 50, y: 50, w: 50, h: 50, parent: F }),
		sticky(A, { x: 420, y: 360, w: 50, h: 50 }),
	])
	const before = new Map([[F, { x: 100, y: 100, w: 400, h: 400, r: 0, parent: null }]])
	const after = new Map([[F, { x: 350, y: 350, w: 150, h: 150, r: 0 }]])
	const r = transformItems(m, { ids: [F], before, after, keep: true })
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: F, p: { x: 350, y: 350, parent: null, w: 150, h: 150, r: 0 }, keep: true },
		{ o: 'patch', id: K2, p: { x: 150, y: 150, parent: null } },
		{ o: 'patch', id: A, p: { x: 70, y: 10, parent: F } },
	])
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: F, p: { x: 100, y: 100, parent: null, w: 400, h: 400, r: 0 }, keep: true },
		{ o: 'patch', id: K2, p: { x: 50, y: 50, parent: F } },
		{ o: 'patch', id: A, p: { x: 420, y: 360, parent: null } },
	])
	assertPlacementGroups([...r.ops, ...r.inverse])
	// bottom right: x/y unchanged → no keep even when the intent says so; children move with the frame
	const br = transformItems(m, { ids: [F], before, after: new Map([[F, { x: 100, y: 100, w: 250, h: 250, r: 0 }]]), keep: true })
	assert.equal(br.ops[0].keep, undefined)
	assert.deepEqual(br.ops.slice(1), [{ o: 'patch', id: K1, p: { x: 400, y: 400, parent: null } }])
	// frames never rotate
	assert.equal(transformItems(m, { ids: [F], before, after: new Map([[F, { x: 100, y: 100, w: 400, h: 400, r: 45 }]]) }).ops[0].p.r, 0)
})

test('M1 transform: free connector ends of the selection follow the union of the boxes; bound ends stay', () => {
	const m = new FakeModel([shape(A, { x: 0, y: 0, w: 100, h: 100 }), shape(B, { x: 200, y: 0, w: 100, h: 100 }), connector(C1, { x: 50, y: 150 }, { item: A })])
	const before = new Map([[A, { x: 0, y: 0, w: 100, h: 100, r: 0, parent: null }], [B, { x: 200, y: 0, w: 100, h: 100, r: 0, parent: null }]])
	const after = new Map([[A, { x: 0, y: 0, w: 200, h: 200, r: 0 }], [B, { x: 400, y: 0, w: 200, h: 200, r: 0 }]])
	const r = transformItems(m, { ids: [A, B, C1], before, after })
	assert.deepEqual(r.ops.find((o) => o.id === C1), { o: 'patch', id: C1, p: { 'data.start': { x: 100, y: 300 } } })
	assert.deepEqual(r.inverse.find((o) => o.id === C1), { o: 'patch', id: C1, p: { 'data.start': { x: 50, y: 150 } } })
})

test('M1 setStyle: only types with the field; normalised values; invalid values change nothing; a note color lands on frames as the nearest frame color', () => {
	const m = new FakeModel([sticky(A), shape(S), frame(F)])
	const stroke = setStyle(m, [A, S, F], 'style.stroke', SHAPE_PALETTE[9].toUpperCase())
	assert.deepEqual(stroke.ops, [{ o: 'patch', id: S, p: { 'style.stroke': SHAPE_PALETTE[9] } }])
	assert.deepEqual(stroke.inverse, [{ o: 'patch', id: S, p: { 'style.stroke': '#1a1a1a' } }])
	const pick = SHAPE_PALETTE.find((c) => !STICKY_COLORS.includes(c) && c !== '#ffffff' && nearestFrameFill(c) !== c)
	const fill = setStyle(m, [A, S, F], 'style.fill', pick)
	assert.deepEqual(fill.ops, [
		{ o: 'patch', id: A, p: { 'style.fill': pick } },
		{ o: 'patch', id: S, p: { 'style.fill': pick } },
		{ o: 'patch', id: F, p: { 'style.fill': nearestFrameFill(pick) } },
	])
	assert.deepEqual(setStyle(m, [S], 'style.strokeWidth', 25), { ops: [], inverse: [] })
	assert.deepEqual(setStyle(m, [S], 'style.dash', 'wavy'), { ops: [], inverse: [] })
	assert.deepEqual(setStyle(m, [S], 'data.kind', 'star'), { ops: [], inverse: [] })
	assert.deepEqual(setStyle(m, [S], 'style.stroke', '#1a1a1a'), { ops: [], inverse: [] }, 'unchanged value: no op')
	assert.deepEqual(setStyle(m, [S], 'data.kind', 'diamond').ops, [{ o: 'patch', id: S, p: { 'data.kind': 'diamond' } }])
})

test('M1 setStyle: null removes the field (font size "Auto"), never a required field; text items carry the measured height', () => {
	const m = new FakeModel([shape(S, { style: { fontSize: 32 } }), shape(B), textItem(T), connector(C1, { x: 0, y: 0 }, { x: 10, y: 10 })])
	const auto = setStyle(m, [S, B], 'style.fontSize', null)
	assert.deepEqual(auto, { ops: [{ o: 'patch', id: S, p: { 'style.fontSize': null } }], inverse: [{ o: 'patch', id: S, p: { 'style.fontSize': 32 } }] })
	assert.deepEqual(setStyle(m, [C1], 'data.start', null), { ops: [], inverse: [] })
	const t = setStyle(m, [T], 'style.fontSize', 48, { heights: new Map([[T, 57.6]]) })
	assert.deepEqual(t.ops, [{ o: 'patch', id: T, p: { 'style.fontSize': 48, h: 57.6 } }])
	assert.deepEqual(t.inverse, [{ o: 'patch', id: T, p: { 'style.fontSize': 24, h: 28.8 } }])
})

test('M1 arrangeItem: absolute box → transform patch; clamped sizes; not rotatable keeps 0; a text item takes the measured height; nothing changed → no op', () => {
	const m = new FakeModel([shape(S, { x: 100, y: 100 }), textItem(T, { x: 5, y: 6 }), frame(F, { x: 1000, y: 1000 })])
	assert.deepEqual(arrangeItem(m, S, { x: 10, y: 20, w: 300, h: 150, r: 30 }).ops, [{ o: 'patch', id: S, p: { x: 10, y: 20, parent: null, w: 300, h: 150, r: 30 } }])
	assert.deepEqual(arrangeItem(m, S, { w: 5 }).ops[0].p.w, TYPES.shape.size[0])
	assert.deepEqual(arrangeItem(m, T, { w: 120, h: 999 }, { textH: 57.6 }).ops, [{ o: 'patch', id: T, p: { x: 5, y: 6, parent: null, w: 120, h: 57.6, r: 0 } }])
	assert.equal(arrangeItem(m, F, { r: 45, x: 900 }).ops[0].p.r, 0)
	assert.deepEqual(arrangeItem(m, S, { x: 100, y: 100 }), { ops: [], inverse: [] })
	assert.deepEqual(arrangeItem(m, ID(99), { x: 1 }), { ops: [], inverse: [] })
})

test('M1 moveItems: a connector moves only its free ends; a bound end is never patched', () => {
	const m = new FakeModel([shape(A, { x: 300 }), connector(C1, { x: 50, y: 150 }, { item: A }), connector(X, { item: A }, { item: A, ax: 1, ay: 0.5 })])
	// with its target A: the free end follows (rule 12: only data.start/data.end of a connector move)
	const r = moveItems(m, { ids: [A, C1, X], dx: 10, dy: 20, origin: new Map([[A, { x: 300, y: 0, parent: null }]]) })
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: A, p: { x: 310, y: 20, parent: null } },
		{ o: 'patch', id: C1, p: { 'data.start': { x: 60, y: 170 } } },
	])
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: A, p: { x: 300, y: 0, parent: null } },
		{ o: 'patch', id: C1, p: { 'data.start': { x: 50, y: 150 } } },
	])
})

test('M1 setText: a text item carries the measured height in the same patch; others never', () => {
	const m = new FakeModel([textItem(T), sticky(A)])
	assert.deepEqual(setText(m, { id: T, path: 'data.text', value: 'a\nb', before: '', h: 57.6 }), {
		ops: [{ o: 'patch', id: T, p: { 'data.text': 'a\nb', h: 57.6 } }],
		inverse: [{ o: 'patch', id: T, p: { 'data.text': '', h: 28.8 } }],
	})
	assert.deepEqual(setText(m, { id: A, path: 'data.text', value: 'x', before: '', h: 99 }).ops[0].p, { 'data.text': 'x' })
})

/** Board 7: frame F (100,100) with K1, K2, note A at (600,600), connector C1 K1 → A, connector X from K1 to an outside note B. */
function payloadModel() {
	return new FakeModel([
		frame(F, { x: 100, y: 100, w: 400, h: 400, z: 'a0', data: { title: 'Ideas' } }),
		sticky(K1, { x: 10, y: 20, parent: F, z: 'i1', data: { text: 'one' } }),
		sticky(K2, { x: 50, y: 60, parent: F, z: 'i2', data: { text: '' } }),
		sticky(A, { x: 600, y: 600, z: 'i3', data: { text: 'three' } }),
		sticky(B, { x: 2000, y: 0, z: 'i4' }),
		connector(C1, { item: K1 }, { item: A, ax: 0, ay: 0.5 }, { z: 'i5' }),
		connector(X, { item: K1 }, { item: B }, { z: 'i6' }),
	])
}

test('M1 copyPayload: topLevel + descendants of selected frames + connectors with both ends inside; roots absolute, children relative; an end outside becomes a free point', () => {
	const m = payloadModel()
	const p = copyPayload(m, [F, K1, A, X], { board: 7 })
	assert.equal(p.knorke, 1)
	assert.equal(p.board, 7)
	assert.deepEqual(p.origin, [100, 100])
	assert.deepEqual(p.items.map((it) => it.id), [F, K1, K2, A, C1, X], 'board order, frames first, K1 only once')
	assert.deepEqual(p.items[0], { id: F, t: 'frame', x: 100, y: 100, w: 400, h: 400, r: 0, parent: null, data: { title: 'Ideas' }, style: { fill: '#ffffff' }, group: null })
	assert.deepEqual([p.items[1].x, p.items[1].y, p.items[1].parent], [10, 20, F])
	assert.deepEqual([p.items[3].x, p.items[3].y, p.items[3].parent], [600, 600, null])
	const c = p.items.find((it) => it.id === C1)
	assert.deepEqual([c.x, c.y, c.w, c.h, c.parent, c.data.start, c.data.end], [0, 0, 0, 0, null, { item: K1 }, { item: A, ax: 0, ay: 0.5 }])
	// X was selected, its end B is outside: free point at B's anchor (auto = center)
	const x = p.items.find((it) => it.id === X)
	assert.deepEqual(x.data.end, { x: 2100, y: 100 })
	// a connector that is neither selected nor fully inside stays out
	assert.ok(!copyPayload(m, [F], { board: 7 }).items.some((it) => it.id === X))
})

test('M1 pasteItems: new ids, children under the new parent, roots at the target point, z per layer in payload order, containers first, connectors last; inverse removes all', () => {
	const src = payloadModel()
	const p = copyPayload(src, [F, A], { board: 7 })
	const target = new FakeModel([sticky(ID(50), { z: 'i9' }), frame(ID(51), { x: 5000, y: 5000, z: 'a9' })])
	const r = pasteItems(target, p, { at: { x: 1000, y: 1000 }, limits: null, board: 8 }, ids(ID(61), ID(62), ID(63), ID(64), ID(65)))
	// union of the roots: F (100..500) and A (600..800): center (450, 450) → +550/+550
	assert.deepEqual(r.ops.map((o) => [o.o, o.id, o.t]), [
		['put', ID(61), 'frame'], ['put', ID(62), 'sticky'], ['put', ID(63), 'sticky'], ['put', ID(64), 'sticky'], ['put', ID(65), 'connector'],
	])
	const put = (id) => r.ops.find((o) => o.id === id).p
	assert.deepEqual([put(ID(61)).x, put(ID(61)).y, put(ID(61)).parent], [650, 650, null])
	assert.deepEqual([put(ID(62)).x, put(ID(62)).y, put(ID(62)).parent], [10, 20, ID(61)])
	assert.deepEqual([put(ID(64)).x, put(ID(64)).y, put(ID(64)).parent], [1150, 1150, null])
	assert.deepEqual(put(ID(65)).data.start, { item: ID(62) })
	assert.deepEqual(put(ID(65)).data.end, { item: ID(64), ax: 0, ay: 0.5 })
	assert.ok(put(ID(61)).z > 'a9' && put(ID(62)).z > 'i9' && put(ID(63)).z > put(ID(62)).z && put(ID(65)).z > put(ID(64)).z)
	assert.deepEqual(r.inverse, [ID(65), ID(64), ID(63), ID(62), ID(61)].map((id) => ({ o: 'remove', id })))
	assert.deepEqual(r.selectIds, [ID(61), ID(64), ID(65)])
	assert.equal(r.skipped, 0)
	assert.equal(r.full, false)
	for (const op of r.ops) {
		assert.match(op.id, ULID_RE)
		assert.ok(isValidKey(op.p.z))
	}
})

test('M1 pasteItems: in place, offset, a root into the frame under its center, limits.maxItems (fallback 5000), unplaceable connector ends', () => {
	const src = payloadModel()
	const p = copyPayload(src, [A], { board: 7 })
	const target = new FakeModel([frame(F, { x: 500, y: 500, w: 800, h: 800 })])
	const inPlace = pasteItems(target, p, { inPlace: true, at: { x: 0, y: 0 } }, ids(ID(70)))
	assert.deepEqual([inPlace.ops[0].p.x, inPlace.ops[0].p.y, inPlace.ops[0].p.parent], [100, 100, F], 'original place lies in F: relative to F')
	const off = pasteItems(target, p, { offset: { x: 20, y: 20 } }, ids(ID(71)))
	assert.deepEqual([off.ops[0].p.x, off.ops[0].p.y], [120, 120])
	assert.equal(maxItemsOf(null), 5000)
	assert.equal(maxItemsOf({ maxItems: 3 }), 3)
	const full = pasteItems(target, p, { limits: { maxItems: 1 } }, ids(ID(72)))
	assert.deepEqual(full, { ops: [], inverse: [], selectIds: [], skipped: 0, full: true })
	// a connector bound to an item outside the payload: other board → skipped; same board, target alive → kept
	const cp = { knorke: 1, board: 7, items: [sticky(K1, { x: 0, y: 0 }), connector(C1, { item: K1 }, { item: B })].map((it) => ({ ...it, z: undefined })) }
	const other = pasteItems(new FakeModel([]), cp, { board: 8 }, ids(ID(73), ID(74)))
	assert.equal(other.skipped, 1)
	assert.deepEqual(other.ops.map((o) => o.id), [ID(73)])
	const same = pasteItems(src, cp, { board: 7 }, ids(ID(75), ID(76)))
	assert.deepEqual(same.ops[1].p.data, { start: { item: ID(75) }, end: { item: B }, route: 'straight' })
})

test('M1 duplicateItems: copies at +20/+20 with new ids, one inverse, the originals untouched', () => {
	const m = payloadModel()
	const r = duplicateItems(m, [A], { offset: 20, board: 7 }, ids(ID(80)))
	assert.deepEqual(r.ops.map((o) => [o.o, o.id, o.p.x, o.p.y]), [['put', ID(80), 620, 620]])
	assert.deepEqual(r.inverse, [{ o: 'remove', id: ID(80) }])
	assert.deepEqual(r.selectIds, [ID(80)])
})

test('M1 nextNote (series entry): right of the previous note with a 20 gap, same size and color, same frame when it fits', () => {
	const m = new FakeModel([frame(F, { x: 0, y: 0, w: 2000, h: 1000 }), sticky(A, { x: 100, y: 100, w: 150, h: 150, parent: F, style: { fill: STICKY_COLORS[0] } }), sticky(B, { x: 1900, y: 100, parent: null })])
	const r = nextNote(m, A, () => K1)
	assert.deepEqual(r.ops[0].p.x, 270)
	assert.deepEqual([r.ops[0].p.y, r.ops[0].p.w, r.ops[0].p.h, r.ops[0].p.parent, r.ops[0].p.style.fill], [100, 150, 150, F, STICKY_COLORS[0]])
	assert.equal(r.edit, true)
	// does not fit into the frame any more → not its child (container under the center otherwise)
	const out = nextNote(m, B, () => K2)
	assert.deepEqual([out.ops[0].p.x, out.ops[0].p.parent], [2120, null])
})

test('M1 remeasure: {h} only for text items whose measurement differs by more than 0.5', () => {
	const m = new FakeModel([textItem(T), sticky(A)])
	assert.deepEqual(remeasure(m, T, 29.2), { ops: [], inverse: [] })
	assert.deepEqual(remeasure(m, T, 30), { ops: [{ o: 'patch', id: T, p: { h: 30 } }], inverse: [{ o: 'patch', id: T, p: { h: 28.8 } }] })
	assert.deepEqual(remeasure(m, A, 30), { ops: [], inverse: [] })
	assert.deepEqual(measureTarget(textItem(T), { w: 100, fontSize: 48, text: 'x' }).style.fontSize, 48)
})

test('M1 transform frame with keep while the scene previews it (children compensated IN THE MODEL): membership and inverses come from the stored placements (origin)', () => {
	const m = new FakeModel([
		frame(F, { x: 100, y: 100, w: 400, h: 400 }),
		sticky(K1, { x: 300, y: 300, w: 100, h: 100, parent: F }),
		sticky(K2, { x: 20, y: 20, w: 100, h: 100, parent: F }),
	])
	// the scene's live preview: the frame moved by (250, 250), the children compensated
	m.items.get(F).x = 350
	m.items.get(F).y = 350
	m.items.get(K1).x = 50
	m.items.get(K1).y = 50
	m.items.get(K2).x = -230
	m.items.get(K2).y = -230
	const origin = new Map([[K1, { x: 300, y: 300, parent: F }], [K2, { x: 20, y: 20, parent: F }]])
	const r = transformItems(m, {
		ids: [F],
		before: new Map([[F, { x: 100, y: 100, w: 400, h: 400, r: 0, parent: null }]]),
		after: new Map([[F, { x: 350, y: 350, w: 150, h: 150, r: 0 }]]),
		keep: true,
		origin,
	})
	// K1 (abs 400..500) stays inside the new box 350..500; K2 (abs 120..220) is freed where it is
	assert.deepEqual(r.ops.slice(1), [{ o: 'patch', id: K2, p: { x: 120, y: 120, parent: null } }])
	assert.deepEqual(r.inverse.slice(1), [{ o: 'patch', id: K2, p: { x: 20, y: 20, parent: F } }])
	// without origin the compensated model values would free both at wrong places (the bug this pins)
	const wrong = transformItems(m, { ids: [F], before: new Map([[F, { x: 100, y: 100, w: 400, h: 400, r: 0, parent: null }]]), after: new Map([[F, { x: 350, y: 350, w: 150, h: 150, r: 0 }]]), keep: true })
	assert.notDeepEqual(wrong.ops.slice(1), r.ops.slice(1))
})

// ---- M2 (SPEC-M1 §1.2): align the selection ------------------------------------

const N = ID('N1')
const G = ID('G1')
const D = ID(4)

/**
 * @param {FakeModel} m model
 * @param {object[]} ops patches
 * @return {FakeModel} a copy of m with the patches applied in order
 */
function patched(m, ops) {
	const items = [...m.items.values()].map((it) => structuredClone(it))
	const byId = new Map(items.map((it) => [it.id, it]))
	for (const op of ops) {
		applyPatch(byId.get(op.id), op.p)
	}
	return new FakeModel(items)
}

/**
 * @param {FakeModel} m model
 * @param {string} id item
 * @return {number[]} [x0, y0, x1, y1] of its axis-parallel rotated hull
 */
function hull(m, id) {
	const a = m.abs(id)
	return rotatedBBox(a.x, a.y, a.w, a.h, a.r || 0)
}

/**
 * @param {FakeModel} m model
 * @param {string[]} ids items
 * @return {{minX: number, minY: number, maxX: number, maxY: number}} union of their hulls
 */
function unionHull(m, ids) {
	const hs = ids.map((id) => hull(m, id))
	return {
		minX: Math.min(...hs.map((b) => b[0])),
		minY: Math.min(...hs.map((b) => b[1])),
		maxX: Math.max(...hs.map((b) => b[2])),
		maxY: Math.max(...hs.map((b) => b[3])),
	}
}

test('M2 alignItems left (AK1): complete placement groups, y unchanged, every hull\'s left edge on U.minX (B rotated 30°), no patch for the item already there; inverse = old placement', () => {
	const m = new FakeModel([sticky(A, { x: 40, y: 0 }), sticky(B, { x: 100, y: 300, r: 30 }), sticky(C, { x: 250, y: 600 })])
	const U = unionHull(m, [A, B, C])
	assert.equal(U.minX, 40, 'A defines U.minX (B\'s hull starts at about 63.4)')
	const r = alignItems(m, [A, B, C], 'left')
	assert.deepEqual(r.ops.map((o) => o.id), [B, C], 'A already lies on U.minX: no patch')
	for (const op of r.ops) {
		assert.equal(op.o, 'patch')
		assert.deepEqual(Object.keys(op.p).sort(), ['parent', 'x', 'y'], 'the whole placement group, nothing else')
		assert.equal(op.p.y, m.get(op.id).y, 'y stays')
		assert.equal(op.p.parent, null)
		assert.equal(op.keep, undefined)
	}
	assert.equal(r.ops[0].p.x, 76.6, 'B: 100 + (40 − 63.3975), on the 0.01 grid')
	assertPlacementGroups([...r.ops, ...r.inverse])
	const after = patched(m, r.ops)
	for (const id of [A, B, C]) {
		assert.ok(Math.abs(hull(after, id)[0] - U.minX) <= 0.01, 'left edge of ' + id)
	}
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: B, p: { x: 100, y: 300, parent: null } },
		{ o: 'patch', id: C, p: { x: 250, y: 600, parent: null } },
	])
	const back = patched(after, r.inverse)
	for (const id of [A, B, C]) {
		assert.deepEqual(back.get(id), m.get(id))
	}
})

test('M2 alignItems (AK2): center, right, top, middle, bottom per the table; the other axis stays; ALIGN_EDGES is the one list', () => {
	assert.deepEqual([...ALIGN_EDGES], ['left', 'center', 'right', 'top', 'middle', 'bottom'])
	assert.ok(Object.isFrozen(ALIGN_EDGES))
	const ids = [A, B, C]
	const m = new FakeModel([sticky(A, { x: 40, y: 0 }), sticky(B, { x: 100, y: 300, r: 30 }), shape(C, { x: 250, y: 600, w: 300, h: 120 })])
	const U = unionHull(m, ids)
	const table = {
		center: { axis: 'x', target: (U.minX + U.maxX) / 2, at: (b) => (b[0] + b[2]) / 2 },
		right: { axis: 'x', target: U.maxX, at: (b) => b[2] },
		top: { axis: 'y', target: U.minY, at: (b) => b[1] },
		middle: { axis: 'y', target: (U.minY + U.maxY) / 2, at: (b) => (b[1] + b[3]) / 2 },
		bottom: { axis: 'y', target: U.maxY, at: (b) => b[3] },
	}
	for (const [edge, row] of Object.entries(table)) {
		const r = alignItems(m, ids, edge)
		assert.ok(r.ops.length >= 2, edge + ': at least two items move')
		assertPlacementGroups([...r.ops, ...r.inverse])
		const other = row.axis === 'x' ? 'y' : 'x'
		for (const op of r.ops) {
			assert.equal(op.p[other], m.get(op.id)[other], edge + ': ' + other + ' stays in the patch')
			// the table's shift, rounded like moveItems
			const b = hull(m, op.id)
			assert.equal(op.p[row.axis], round2(m.get(op.id)[row.axis] + row.target - row.at(b)), edge + ': shift of ' + op.id)
		}
		const after = patched(m, r.ops)
		for (const id of ids) {
			assert.ok(Math.abs(row.at(hull(after, id)) - row.target) <= 0.01, edge + ': ' + id + ' on the target line')
			assert.equal(after.abs(id)[other], m.abs(id)[other], edge + ': ' + id + ' keeps its ' + other)
		}
		const back = patched(after, r.inverse)
		for (const id of ids) {
			assert.deepEqual(back.get(id), m.get(id), edge + ': undo restores ' + id)
		}
	}
})

test('M2 alignItems (AK3): connectors are skipped – they do not count for U and get no patch (free ends stay); one note plus a connector is empty', () => {
	// the connector's free ends (and its stored box) lie far left of the notes
	const m = new FakeModel([
		sticky(A, { x: 0, y: 0 }),
		sticky(B, { x: 300, y: 300 }),
		connector(C1, { x: -1000, y: 0 }, { x: -900, y: 50 }, { x: -1000, y: -1000, w: 100, h: 50 }),
		connector(X, { item: A }, { item: B }),
	])
	const r = alignItems(m, [A, C1, B, X], 'left')
	assert.deepEqual(r.ops, [{ o: 'patch', id: B, p: { x: 0, y: 300, parent: null } }], 'U.minX comes from A, not from the connector')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: B, p: { x: 300, y: 300, parent: null } }])
	for (const edge of ALIGN_EDGES) {
		const res = alignItems(m, [A, B, C1, X], edge)
		assert.ok(res.ops.every((o) => o.id !== C1 && o.id !== X), edge + ': no connector patch')
		assert.ok(res.ops.every((o) => !Object.keys(o.p).some((k) => k.startsWith('data.'))), edge + ': no end moves')
	}
	assert.deepEqual(alignItems(m, [A, C1], 'left'), { ops: [], inverse: [] })
	assert.deepEqual(alignItems(m, [C1, X], 'right'), { ops: [], inverse: [] })
	assert.deepEqual(alignableIds(m, [A, C1, B, X]), [[A], [B]], 'blocks (job 026)')
})

test('M2 alignItems (AK4): frames – an aligned frame takes its child (no own patch, no keep); an item leaves or enters a frame that is not aligned; an aligned frame is never a parent; inverses restore', () => {
	// (a) frame F with child K1 and note N: only F moves, without keep
	let m = new FakeModel([frame(F, { x: 0, y: 0, w: 800, h: 600 }), sticky(K1, { x: 100, y: 100, parent: F }), sticky(N, { x: 1000, y: 0 })])
	let r = alignItems(m, [F, K1, N], 'right')
	assert.deepEqual(r.ops, [{ o: 'patch', id: F, p: { x: 400, y: 0, parent: null } }], 'U.maxX = 1200 (N); K1 has no patch of its own')
	assert.ok(r.ops.every((o) => !('keep' in o)) && r.inverse.every((o) => !('keep' in o)), 'no keep')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: F, p: { x: 0, y: 0, parent: null } }])
	let after = patched(m, r.ops)
	assert.deepEqual([after.abs(K1).x, after.get(K1).parent], [500, F], 'the child moves with its frame')
	assert.deepEqual(patched(after, r.inverse).get(F), m.get(F))
	// (d) N's new centre (100, 100) lies in the aligned frame F: F is never its parent
	r = alignItems(m, [F, N], 'left')
	assert.deepEqual(r.ops, [{ o: 'patch', id: N, p: { x: 0, y: 0, parent: null } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: N, p: { x: 1000, y: 0, parent: null } }])
	// a frame aligned under a note: the note stays top-level as well
	m = new FakeModel([frame(F, { x: 2000, y: 0, w: 800, h: 600 }), sticky(N, { x: 100, y: 100 }), sticky(B, { x: 0, y: 900 })])
	r = alignItems(m, [F, N, B], 'left')
	assert.ok(r.ops.every((o) => o.p.parent === null), 'nobody becomes a child of the aligned frame')
	assert.ok(r.ops.some((o) => o.id === F && o.p.x === 0))
	// (b) and (c) with a frame G that is not aligned
	m = new FakeModel([
		frame(G, { x: 50, y: 50, w: 800, h: 600 }),
		sticky(A, { x: 100, y: 100, parent: G }), // abs (150, 150)
		sticky(B, { x: 2000, y: 100 }),
		sticky(C, { x: 100, y: 1000 }),
	])
	// (b) A's new centre (2100, 250) lies outside G: free, absolute
	r = alignItems(m, [A, B], 'right')
	assert.deepEqual(r.ops, [{ o: 'patch', id: A, p: { x: 2000, y: 150, parent: null } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: A, p: { x: 100, y: 100, parent: G } }])
	assertPlacementGroups([...r.ops, ...r.inverse])
	after = patched(m, r.ops)
	assert.deepEqual(patched(after, r.inverse).get(A), m.get(A))
	// (c) C's new centre (200, 200) lies in G: G's child, relative to it
	r = alignItems(m, [B, C], 'top')
	assert.deepEqual(r.ops, [{ o: 'patch', id: C, p: { x: 50, y: 50, parent: G } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: C, p: { x: 100, y: 1000, parent: null } }])
	assertPlacementGroups([...r.ops, ...r.inverse])
	after = patched(m, r.ops)
	assert.deepEqual([after.abs(C).x, after.abs(C).y], [100, 100])
	assert.deepEqual(patched(after, r.inverse).get(C), m.get(C))
})

test('M2 alignItems (AK5): empty for an unknown edge, fewer than two alignable items (also a frame with its own child) and an aligned selection; alignableIds', () => {
	const P = ID('P1')
	const m = new FakeModel([
		sticky(A, { x: 0, y: 0 }),
		sticky(B, { x: 0, y: 400 }),
		frame(F, { x: 1000, y: 0 }),
		sticky(K1, { x: 10, y: 10, parent: F }),
		{ id: P, t: 'laterType', x: 500, y: 0, w: 100, h: 100, r: 0, z: 'i1', parent: null, data: {}, style: {} },
	])
	const none = { ops: [], inverse: [] }
	assert.deepEqual(alignItems(m, [A, B], 'diagonal'), none)
	assert.deepEqual(alignItems(m, [A, B], undefined), none)
	assert.deepEqual(alignItems(m, [A], 'left'), none)
	assert.deepEqual(alignItems(m, [A, A, ID(99)], 'right'), none, 'duplicates and unknown ids drop out')
	assert.deepEqual(alignItems(m, [F, K1], 'left'), none, 'a frame plus its own child: one alignable item')
	assert.deepEqual(alignItems(m, [], 'top'), none)
	for (const edge of ['left', 'center', 'right']) {
		assert.deepEqual(alignItems(m, [A, B], edge), none, edge + ': already aligned')
	}
	// unknown types (placeholders, placement box) count, like moving
	assert.deepEqual(alignableIds(m, [K1, F, A, A, ID(99), P]), [[F], [A], [P]], 'blocks (job 026)')
	assert.deepEqual(alignItems(m, [A, P], 'top'), none, 'both at y = 0')
	assert.deepEqual(alignItems(m, [A, P], 'left').ops, [{ o: 'patch', id: P, p: { x: 0, y: 0, parent: null } }])
	assert.deepEqual(alignableIds(m, null), [])
})

test('M2 alignItems (review R1): a second click on the same edge is empty – rotated hulls and odd widths only reach the edge to ±0.005 on the 0.01 grid (tolerance 0.01); an unmoved item keeps its parent; no creeping', () => {
	const none = { ops: [], inverse: [] }
	/**
	 * @param {FakeModel} m model
	 * @param {string[]} ids selection
	 * @param {string} edge edge
	 * @param {number} n clicks
	 * @return {{m: FakeModel, counts: number[]}} the model after n clicks and the ops per click
	 */
	const clicks = (m, ids, edge, n) => {
		const counts = []
		for (let i = 0; i < n; i++) {
			const r = alignItems(m, ids, edge)
			counts.push(r.ops.length)
			m = patched(m, r.ops)
		}
		return { m, counts }
	}
	// (a) rotated notes, left: without the tolerance B, A, C, B … crept by 0.01 per click
	const a = new FakeModel([sticky(A, { x: 0, y: 0 }), sticky(B, { x: 300, y: 300, r: 10 }), sticky(C, { x: 600, y: 600, r: 33 })])
	const r1 = alignItems(a, [A, B, C], 'left')
	assert.deepEqual(r1.ops.map((o) => o.id), [B, C])
	assert.deepEqual(alignItems(patched(a, r1.ops), [A, B, C], 'left'), none)
	assert.deepEqual(clicks(a, [A, B, C], 'left', 30).counts, [2, ...Array(29).fill(0)])
	// (b) shapes with odd widths, center (was 3 ops, then 1, then empty)
	const b = new FakeModel([
		shape(A, { x: 217.15, y: 933.36, w: 241.94, h: 379.11 }),
		shape(B, { x: 253.28, y: 962.29, w: 265.15, h: 238.22 }),
		shape(C, { x: 482.82, y: 950.06, w: 409.75, h: 231.08 }),
	])
	const c1 = alignItems(b, [A, B, C], 'center')
	assert.equal(c1.ops.length, 3)
	assert.deepEqual(alignItems(patched(b, c1.ops), [A, B, C], 'center'), none)
	// (c) a note inside a frame without being its child, already aligned: no patch, still no parent
	const c = new FakeModel([frame(G, { x: 0, y: 0, w: 800, h: 600 }), sticky(N, { x: 100, y: 100 }), sticky(C, { x: 100, y: 1000 })])
	assert.deepEqual(alignItems(c, [N, C], 'left'), none)
	assert.equal(c.get(N).parent, null)
	// (d) every edge on a rotated selection: nothing after the first click, never creeping
	const d = new FakeModel([
		sticky(A, { x: 13.37, y: 7.01, r: 17 }),
		shape(B, { x: 420.5, y: 300.25, w: 241.95, h: 121.33, r: 33 }),
		shape(C, { x: 900.01, y: 640.99, w: 310.07, h: 99.99, r: 290 }),
		textItem(X, { x: -200.4, y: 1200.6, r: 5 }),
	])
	for (const edge of ALIGN_EDGES) {
		const { counts } = clicks(d, [A, B, C, X], edge, 10)
		assert.ok(counts[0] > 0, edge + ': the first click moves')
		assert.deepEqual(counts.slice(1), Array(9).fill(0), edge + ': ' + counts.join(','))
	}
	// a fixed pseudo-random sample (2–6 items, 70 % rotated, sizes on the 0.01 grid): no op from the second click on
	let seed = 42
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
	for (const edge of ALIGN_EDGES) {
		for (let k = 0; k < 200; k++) {
			const items = []
			for (let i = 0, n = 2 + Math.floor(rnd() * 5); i < n; i++) {
				items.push(shape(ID('R' + i), { x: round2(rnd() * 2000), y: round2(rnd() * 2000), w: round2(20 + rnd() * 500), h: round2(20 + rnd() * 500), r: rnd() < 0.7 ? round2(rnd() * 360) : 0 }))
			}
			const { counts } = clicks(new FakeModel(items), items.map((it) => it.id), edge, 4)
			assert.deepEqual(counts.slice(1), [0, 0, 0], edge + ' #' + k + ': ' + counts.join(','))
		}
	}
})

/**
 * @param {FakeModel} m model
 * @param {string} edge edge
 * @return {(ids: string[]) => {ops: object[], inverse: object[]}} one click of "Align"
 *   on a selection; each click works on the model after the previous one's patches
 */
function alignClicker(m, edge) {
	return (ids) => {
		const r = alignItems(m, ids, edge)
		m = patched(m, r.ops)
		return r
	}
}

test('M2 alignItems (align tolerance AK1): one more item for an aligned selection (review R2 UX 1) – the effective click also snaps B (within the tolerance) in the same result, every further click is empty', () => {
	const none = { ops: [], inverse: [] }
	const click = alignClicker(new FakeModel([
		sticky(A, { x: 0, y: 0 }),
		sticky(B, { x: 300, y: 300, r: 2 }),
		sticky(C, { x: 600, y: 600, r: 8 }),
		sticky(D, { x: 900, y: 900, r: 22 }),
	]), 'left')
	assert.deepEqual(click([A, B, C]).ops, [
		{ o: 'patch', id: B, p: { x: 3.43, y: 300, parent: null } },
		{ o: 'patch', id: C, p: { x: 12.94, y: 600, parent: null } },
	], 'click 1')
	assert.deepEqual(click([A, B, C]), none, 'click 2')
	// U.minX is now C's hull (≈ −0.0041); B lies 0.0051 right of it and snaps along with D.
	// Before, this click moved D only and click 4 patched B to 3.42: an invisible undo step
	const r = click([A, B, C, D])
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: B, p: { x: 3.42, y: 300, parent: null } },
		{ o: 'patch', id: D, p: { x: 30.17, y: 900, parent: null } },
	], 'click 3: one result')
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: B, p: { x: 3.43, y: 300, parent: null } },
		{ o: 'patch', id: D, p: { x: 900, y: 900, parent: null } },
	])
	assert.deepEqual(click([A, B, C, D]), none, 'click 4')
	assert.deepEqual(click([A, B, C, D]), none, 'click 5')
})

test('M2 alignItems (align tolerance AK2): an item within the tolerance snaps but keeps its parent – N stays top-level over the frame G, K1 stays G\'s child; D moves as before; the next click and the aligned [A, N] are empty', () => {
	const none = { ops: [], inverse: [] }
	const m = new FakeModel([
		frame(G, { x: 0, y: 0, w: 800, h: 600 }),
		sticky(A, { x: 0, y: 1000 }),
		sticky(N, { x: 0.01, y: 100 }), // over G, but not its child
		sticky(K1, { x: 0.01, y: 350, parent: G }),
		sticky(D, { x: 900, y: 1500 }),
	])
	const r = alignItems(m, [A, N, K1, D], 'left')
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: N, p: { x: 0, y: 100, parent: null } },
		{ o: 'patch', id: K1, p: { x: 0, y: 350, parent: G } },
		{ o: 'patch', id: D, p: { x: 0, y: 1500, parent: null } },
	])
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: N, p: { x: 0.01, y: 100, parent: null } },
		{ o: 'patch', id: K1, p: { x: 0.01, y: 350, parent: G } },
		{ o: 'patch', id: D, p: { x: 900, y: 1500, parent: null } },
	])
	assertPlacementGroups([...r.ops, ...r.inverse])
	const after = patched(m, r.ops)
	assert.deepEqual(alignItems(after, [A, N, K1, D], 'left'), none, 'the next click')
	const back = patched(after, r.inverse)
	for (const id of [N, K1, D]) {
		assert.deepEqual(back.get(id), m.get(id), 'undo restores ' + id)
	}
	assert.deepEqual(alignItems(m, [A, N], 'left'), none, 'already aligned: no snap, no parent chosen')
})

test('M2 alignItems (align tolerance AK3): coordinates near −1e7 (the server limit) – centre of three shapes moves once, then every click is empty (float noise there is a few 1e-9, far inside the margin 1e-6)', () => {
	const none = { ops: [], inverse: [] }
	const [R0, R1, R2] = [ID('R0'), ID('R1'), ID('R2')]
	const ids = [R0, R1, R2]
	const click = alignClicker(new FakeModel([
		shape(R0, { x: -9998772.99, y: -9998971.34, w: 238.92, h: 22.15 }),
		shape(R1, { x: -9998817.77, y: -9998968.61, w: 116.18, h: 328.52 }),
		shape(R2, { x: -9998972.48, y: -9998888.49, w: 57.78, h: 368.74 }),
	]), 'center')
	assert.deepEqual(click(ids).ops, [
		{ o: 'patch', id: R0, p: { x: -9998872.73, y: -9998971.34, parent: null } },
		{ o: 'patch', id: R1, p: { x: -9998811.36, y: -9998968.61, parent: null } },
		{ o: 'patch', id: R2, p: { x: -9998782.17, y: -9998888.49, parent: null } },
	], 'click 1')
	// with the margin 1e-9 click 2 patched R2 to −9998782.16 (also with the snapping)
	for (let i = 2; i <= 4; i++) {
		assert.deepEqual(click(ids), none, 'click ' + i)
	}
})

test('M2 alignItems (align tolerance AK4): a fixed random sample on every edge at offsets 0 and ±9 999 000 (all |v| ≤ 1e7) – a second click is empty, and after adding one item the click after the first is empty three times', () => {
	const MAX = 1e7
	for (const off of [0, 9999000, -9999000]) {
		// the same layouts at every offset
		const rnd = prng(17)
		let effective = 0
		for (const edge of ALIGN_EDGES) {
			for (let k = 0; k < 300; k++) {
				const items = []
				// 3–7 shapes within ±300 of the offset, at most 520 wide, 70 % rotated: every
				// position stays within 1e7, also once aligned
				for (let i = 0, n = 3 + Math.floor(rnd() * 5); i < n; i++) {
					items.push(shape(ID('R' + i), { x: round2(off + (rnd() - 0.5) * 600), y: round2(off + (rnd() - 0.5) * 600), w: round2(20 + rnd() * 500), h: round2(20 + rnd() * 500), r: rnd() < 0.7 ? round2(rnd() * 360) : 0 }))
				}
				const all = items.map((it) => it.id)
				const first = all.slice(0, -1)
				let m = new FakeModel(items)
				const counts = []
				let inside = items.every((it) => Math.abs(it.x) <= MAX && Math.abs(it.y) <= MAX)
				const click = (ids) => {
					const r = alignItems(m, ids, edge)
					counts.push(r.ops.length)
					inside &&= r.ops.every((o) => Math.abs(o.p.x) <= MAX && Math.abs(o.p.y) <= MAX)
					m = patched(m, r.ops)
				}
				click(first)
				click(first)
				for (let c = 0; c < 4; c++) {
					click(all)
				}
				const msg = edge + ' offset ' + off + ' #' + k + ': ' + counts.join(',')
				assert.equal(counts[1], 0, msg + ' (second click on the fresh selection)')
				assert.deepEqual(counts.slice(3), [0, 0, 0], msg + ' (after adding the last item)')
				assert.ok(inside, msg + ': every position within 1e7')
				effective += counts[2] > 0 ? 1 : 0
			}
		}
		assert.ok(effective > 1700, 'offset ' + off + ': adding the item moved something often enough (' + effective + ' of 1800)')
	}
})

// ---- M2 (SPEC-M1 §1.2): distribute the selection -------------------------------

const Z = ID('Z1')

/**
 * Deterministic PRNG (mulberry32, as in tests/js/model/zorder.test.mjs): 32-bit
 * integer steps, so no precision loss and no short cycle.
 *
 * @param {number} seed seed
 * @return {() => number} next value in [0, 1)
 */
function prng(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * @param {FakeModel} m model
 * @param {string[]} order items from first to last
 * @param {'horizontal'|'vertical'} axis axis
 * @return {number[]} the gaps between neighbouring hulls on the axis
 */
function gaps(m, order, axis) {
	const [s, e] = axis === 'horizontal' ? [0, 2] : [1, 3]
	return order.slice(1).map((id, i) => hull(m, id)[s] - hull(m, order[i])[e])
}

/**
 * @param {FakeModel} m model
 * @param {string[]} ids selection
 * @param {string} axis axis
 * @param {number} n clicks
 * @return {{m: FakeModel, counts: number[]}} the model after n clicks and the ops per click
 */
function distributeClicks(m, ids, axis, n) {
	const counts = []
	for (let i = 0; i < n; i++) {
		const r = distributeItems(m, ids, axis)
		counts.push(r.ops.length)
		m = patched(m, r.ops)
	}
	return { m, counts }
}

const AK1_ITEMS = () => [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 250, y: 300 }), sticky(C, { x: 900, y: 50 }), sticky(Z, { x: 1400, y: 0 })]
const AK2_ITEMS = () => [shape(A, { x: 0, y: 0 }), sticky(Z, { x: 40, y: 900 }), shape(B, { x: 80, y: 200, r: 30 }), shape(C, { x: 10, y: 500, w: 240, h: 60 })]
const AK3_ITEMS = () => [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 100, y: 40 }), sticky(C, { x: 150, y: 80 }), sticky(Z, { x: 300, y: 120 })]

test('M2 distributeItems horizontal (AK1): equal gaps, the outermost two stay, ops in the order of the centres (not of the selection), complete placement groups, no keep; inverse = old placement', () => {
	const m = new FakeModel(AK1_ITEMS())
	const r = distributeItems(m, [C, Z, A, B], 'horizontal')
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: B, p: { x: 466.67, y: 300, parent: null } },
		{ o: 'patch', id: C, p: { x: 933.33, y: 50, parent: null } },
	], 'A and Z stay; B starts at 200 + 800/3, C at 200 + 2 · 800/3 + 200')
	assert.ok([...r.ops, ...r.inverse].every((o) => !('keep' in o)), 'no keep')
	for (const op of [...r.ops, ...r.inverse]) {
		assert.deepEqual(Object.keys(op.p).sort(), ['parent', 'x', 'y'], 'the whole placement group, nothing else')
	}
	assertPlacementGroups([...r.ops, ...r.inverse])
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: B, p: { x: 250, y: 300, parent: null } },
		{ o: 'patch', id: C, p: { x: 900, y: 50, parent: null } },
	])
	const after = patched(m, r.ops)
	for (const gap of gaps(after, [A, B, C, Z], 'horizontal')) {
		assert.ok(Math.abs(gap - 800 / 3) <= 0.01, 'gap ' + gap)
	}
	const back = patched(after, r.inverse)
	for (const id of [A, B, C, Z]) {
		assert.deepEqual(back.get(id), m.get(id), 'undo restores ' + id)
	}
})

test('M2 distributeItems vertical (AK2): rotated hulls of different sizes, only y moves, equal gaps between the hulls; DISTRIBUTE_AXES is the one list', () => {
	assert.deepEqual([...DISTRIBUTE_AXES], ['horizontal', 'vertical'])
	assert.ok(Object.isFrozen(DISTRIBUTE_AXES))
	const m = new FakeModel(AK2_ITEMS())
	const r = distributeItems(m, [A, Z, B, C], 'vertical')
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: B, p: { x: 80, y: 333.99, parent: null } },
		{ o: 'patch', id: C, p: { x: 10, y: 667.97, parent: null } },
	])
	assertPlacementGroups([...r.ops, ...r.inverse])
	const after = patched(m, r.ops)
	for (const id of [A, B, C, Z]) {
		assert.equal(after.abs(id).x, m.abs(id).x, id + ' keeps its x')
	}
	// the exact gap: (Z.start − A.end − hull heights of B and C) / 3 ≈ 172.03 (B's hull is 203.92 high at r 30);
	// each inner item lands within ±0.005 of its target on the 0.01 grid, so each gap within 0.01 of it
	const exact = (hull(m, Z)[1] - hull(m, A)[3] - (hull(m, B)[3] - hull(m, B)[1]) - (hull(m, C)[3] - hull(m, C)[1])) / 3
	assert.ok(Math.abs(exact - 172.03) < 0.01, 'exact gap ' + exact)
	const g = gaps(after, [A, B, C, Z], 'vertical')
	assert.ok(g.every((v) => Math.abs(v - exact) <= 0.01), 'equal gaps: ' + g.join(', '))
	assert.ok(Math.max(...g) - Math.min(...g) <= 0.02, 'equal gaps: ' + g.join(', '))
	const back = patched(after, r.inverse)
	for (const id of [A, B, C, Z]) {
		assert.deepEqual(back.get(id), m.get(id), 'undo restores ' + id)
	}
})

test('M2 distributeItems (AK3): too little room for equal gaps – equal steps between the centres instead; an item already on its target centre gets no patch', () => {
	const m = new FakeModel(AK3_ITEMS())
	const r = distributeItems(m, [A, B, C, Z], 'horizontal')
	assert.deepEqual(r.ops, [{ o: 'patch', id: C, p: { x: 200, y: 80, parent: null } }], 'B already has its target centre 200')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: C, p: { x: 150, y: 80, parent: null } }])
	const after = patched(m, r.ops)
	assert.deepEqual([A, B, C, Z].map((id) => (hull(after, id)[0] + hull(after, id)[2]) / 2), [100, 200, 300, 400])
	assert.ok(gaps(after, [A, B, C, Z], 'horizontal').every((g) => g < 0), 'the gaps stay negative (overlap)')
})

test('M2 distributeItems (AK4): connectors are skipped – never A or Z, no patch, no end moves; empty for fewer than three distributable items, an unknown axis and a distributed selection', () => {
	const none = { ops: [], inverse: [] }
	// the connector's free ends (and its stored box) lie far left of the notes
	const m = new FakeModel([
		sticky(A, { x: 0, y: 0 }),
		sticky(B, { x: 300, y: 100 }),
		sticky(Z, { x: 1000, y: 0 }),
		connector(C1, { x: -1000, y: 0 }, { x: -900, y: 50 }, { x: -1000, y: -1000, w: 100, h: 50 }),
		connector(X, { item: A }, { item: B }),
		frame(F, { x: 0, y: 2000 }),
		sticky(K1, { x: 10, y: 10, parent: F }),
	])
	const r = distributeItems(m, [C1, A, X, B, Z], 'horizontal')
	assert.deepEqual(r.ops, [{ o: 'patch', id: B, p: { x: 500, y: 100, parent: null } }], 'A (x 0) stays the first, the connector is not')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: B, p: { x: 300, y: 100, parent: null } }])
	for (const axis of DISTRIBUTE_AXES) {
		const res = distributeItems(m, [A, C1, B, X, Z], axis)
		assert.ok(res.ops.every((o) => o.id !== C1 && o.id !== X), axis + ': no connector patch')
		assert.ok(res.ops.every((o) => !Object.keys(o.p).some((k) => k.startsWith('data.'))), axis + ': no end moves')
	}
	assert.deepEqual(distributeItems(m, [A, B, C1], 'horizontal'), none, 'two notes plus a connector')
	assert.deepEqual(distributeItems(m, [F, K1, A], 'horizontal'), none, 'a frame with its own child plus a note: two distributable items')
	assert.deepEqual(distributeItems(m, [A, B, Z], 'diagonal'), none)
	assert.deepEqual(distributeItems(m, [A, B, Z], undefined), none)
	assert.deepEqual(distributeItems(m, [A, A, B, ID(99)], 'horizontal'), none, 'duplicates and unknown ids drop out')
	assert.deepEqual(distributeItems(m, [], 'vertical'), none)
	assert.deepEqual(distributeItems(m, null, 'vertical'), none)
	// already distributed: gaps 100 and 100
	const d = new FakeModel([sticky(A, { x: 0, y: 0 }), sticky(B, { x: 300, y: 500 }), sticky(Z, { x: 600, y: 50 })])
	assert.deepEqual(distributeItems(d, [Z, B, A], 'horizontal'), none)
})

test('M2 distributeItems (AK5): frames – a distributed frame takes its child (no own patch, no keep); an item leaves or enters a frame that is not distributed; a distributed frame is never a parent; inverses restore', () => {
	// (a) frame F (inner) with child K1: only F moves, without keep
	let m = new FakeModel([sticky(A, { x: 0, y: 0 }), frame(F, { x: 300, y: 0, w: 400, h: 300 }), sticky(K1, { x: 10, y: 10, parent: F }), sticky(Z, { x: 1500, y: 0 })])
	let r = distributeItems(m, [A, F, K1, Z], 'horizontal')
	assert.deepEqual(r.ops, [{ o: 'patch', id: F, p: { x: 650, y: 0, parent: null } }], 'g = (1500 − 200 − 400) / 2 = 450; K1 has no patch of its own')
	assert.ok([...r.ops, ...r.inverse].every((o) => !('keep' in o)), 'no keep')
	let after = patched(m, r.ops)
	assert.deepEqual([after.abs(K1).x, after.get(K1).parent], [660, F], 'the child moves with its frame')
	assert.deepEqual(patched(after, r.inverse).get(F), m.get(F))
	// (b) N, child of G (not distributed): its new centre (1300, 200) lies outside G – free, absolute
	m = new FakeModel([frame(G, { x: 50, y: 50, w: 800, h: 600 }), sticky(A, { x: -600, y: 100 }), sticky(N, { x: 250, y: 50, parent: G }), sticky(Z, { x: 3000, y: 100 })])
	r = distributeItems(m, [A, N, Z], 'horizontal')
	assert.deepEqual(r.ops, [{ o: 'patch', id: N, p: { x: 1200, y: 100, parent: null } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: N, p: { x: 250, y: 50, parent: G } }])
	assertPlacementGroups([...r.ops, ...r.inverse])
	after = patched(m, r.ops)
	assert.deepEqual(patched(after, r.inverse).get(N), m.get(N))
	// (c) free N: its new centre (600, 200) lies in G – G's child, relative to it
	m = new FakeModel([frame(G, { x: 50, y: 50, w: 800, h: 600 }), sticky(A, { x: -1000, y: 100 }), sticky(N, { x: 1500, y: 100 }), sticky(Z, { x: 2000, y: 100 })])
	r = distributeItems(m, [A, N, Z], 'horizontal')
	assert.deepEqual(r.ops, [{ o: 'patch', id: N, p: { x: 450, y: 50, parent: G } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: N, p: { x: 1500, y: 100, parent: null } }])
	assertPlacementGroups([...r.ops, ...r.inverse])
	after = patched(m, r.ops)
	assert.deepEqual([after.abs(N).x, after.abs(N).y], [500, 100])
	assert.deepEqual(patched(after, r.inverse).get(N), m.get(N))
	// (d) the frame F is Z (distributed, it stays); N's new centre (300, 200) lies in F: still no parent
	m = new FakeModel([sticky(A, { x: 0, y: 0 }), sticky(N, { x: 250, y: 100 }), frame(F, { x: 100, y: 0, w: 800, h: 600 })])
	assert.equal(m.topContainerAt(300, 200), F, 'without the exclusion F would be the parent')
	r = distributeItems(m, [A, N, F], 'horizontal')
	assert.deepEqual(r.ops, [{ o: 'patch', id: N, p: { x: 200, y: 100, parent: null } }], 'centre steps (g < 0): N to centre 300')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: N, p: { x: 250, y: 100, parent: null } }])
	after = patched(m, r.ops)
	assert.deepEqual(patched(after, r.inverse).get(N), m.get(N))
})

test('M2 distributeItems (AK6): no creeping – a second click is empty (AK1–AK3, packed items, a fixed random sample with rotated, overlapping and framed items)', () => {
	const none = { ops: [], inverse: [] }
	for (const [items, ids, axis] of [
		[AK1_ITEMS(), [C, Z, A, B], 'horizontal'],
		[AK2_ITEMS(), [A, Z, B, C], 'vertical'],
		[AK3_ITEMS(), [A, B, C, Z], 'horizontal'],
	]) {
		const m = new FakeModel(items)
		const r = distributeItems(m, ids, axis)
		assert.ok(r.ops.length > 0)
		assert.deepEqual(distributeItems(patched(m, r.ops), ids, axis), none, axis)
	}
	// packed edge to edge (gaps 0 on the 0.01 grid): g is 0 or ±3e-14 in floats, depending on where the
	// inner items stand; at a plain g ≥ 0 the clicks switched between gaps and centre steps for ever
	const packed = new FakeModel([shape(A, { x: 69.63, w: 243.03 }), shape(B, { x: 312.66, w: 296.73 }), shape(Z, { x: 609.39, w: 173.32 })])
	assert.deepEqual(distributeClicks(packed, [A, B, Z], 'horizontal', 4).counts, [0, 0, 0, 0], 'B is in place (was 1, 1, 1, 1)')
	const overlapping = new FakeModel([
		shape(A, { x: 443.35, w: 139.34 }),
		shape(B, { x: 625.07, w: 70.64 }),
		shape(C, { x: 584.78, w: 231.56 }),
		shape(Z, { x: 884.89, w: 178.18 }),
	])
	assert.deepEqual(distributeClicks(overlapping, [A, B, C, Z], 'horizontal', 4).counts, [2, 0, 0, 0], 'packed after one click (was 2, 2, 2, 2)')
	// a fixed pseudo-random sample: 3–7 notes and shapes, ~60 % rotated, ~30 % crowded (centre steps),
	// ~20 % children of a frame that is not selected; no op from the second click on
	const rnd = prng(20261016)
	for (const axis of DISTRIBUTE_AXES) {
		const seen = new Set()
		const crowded = new Set()
		for (let k = 0; k < 2000; k++) {
			const span = rnd() < 0.3 ? 300 : 3000
			const items = [frame(G, { x: 500, y: 500, w: 1200, h: 900 })]
			for (let i = 0, n = 3 + Math.floor(rnd() * 5); i < n; i++) {
				const o = { x: round2(rnd() * span), y: round2(rnd() * span), r: rnd() < 0.6 ? round2(rnd() * 360) : 0 }
				if (rnd() < 0.2) {
					Object.assign(o, { parent: G, x: round2(o.x / 3), y: round2(o.y / 3) })
				}
				items.push(rnd() < 0.5 ? sticky(ID('R' + i), o) : shape(ID('R' + i), { ...o, w: round2(20 + rnd() * 400), h: round2(20 + rnd() * 400) }))
			}
			const ids = items.slice(1).map((it) => it.id)
			const m = new FakeModel(items)
			const key = JSON.stringify(items)
			seen.add(key)
			const order = [...ids].sort((u, v) => {
				const [hu, hv] = [hull(m, u), hull(m, v)]
				return axis === 'horizontal' ? hu[0] + hu[2] - hv[0] - hv[2] : hu[1] + hu[3] - hv[1] - hv[3]
			})
			if (gaps(m, order, axis).reduce((s, g) => s + g, 0) < 0) {
				crowded.add(key)
			}
			const { counts } = distributeClicks(m, ids, axis, 6)
			assert.deepEqual(counts.slice(1), [0, 0, 0, 0, 0], axis + ' #' + k + ': ' + counts.join(','))
		}
		assert.equal(seen.size, 2000, axis + ': 2000 different selections')
		assert.ok(crowded.size > 400, axis + ': the centre steps ran often enough (' + crowded.size + ' different selections)')
	}
})

// ---- M2 (SPEC-M1 §1.2): tidy up the selection ----------------------------------

const E = ID(5)

/**
 * The scenarios of the tidy up criteria AK1–AK5 (fresh items per call).
 *
 * @type {Object<string, () => [object[], string[]]>} name → [items, selection]
 */
const TIDY_CASES = {
	// AK1: a grid with noise
	grid: () => [[
		sticky(A, { x: 0, y: 0 }), sticky(B, { x: 270, y: 30 }), sticky(C, { x: 520, y: 10 }),
		sticky(D, { x: 20, y: 290 }), sticky(E, { x: 250, y: 310 }), sticky(F, { x: 540, y: 280 }),
	], [F, A, E, C, D, B]],
	// AK2: different sizes, E rotated, the middle cell of row 1 empty
	sizes: () => [[
		sticky(A, { x: 0, y: 0 }), shape(B, { x: 300, y: 40 }), textItem(T, { x: 600, y: 60 }),
		shape(C, { x: -10, y: 330, w: 240, h: 60 }), sticky(E, { x: 560, y: 300, r: 45 }),
	], [E, C, T, B, A]],
	// AK3 (a): a connector far left, its stored box as well
	connector: () => [[
		sticky(A, { x: 0, y: 0 }), sticky(B, { x: 250, y: 30 }), sticky(C, { x: 520, y: 0 }),
		connector(X, { x: -900, y: 100 }, { x: -700, y: 140 }, { x: -900, y: 100, w: 200, h: 40 }),
	], [X, C, A, B]],
	// AK4 (a): a tidied frame with its child
	frame: () => [[
		frame(F, { x: 300, y: 10 }), sticky(K1, { x: 100, y: 100, parent: F }), sticky(A, { x: 0, y: 0 }), sticky(B, { x: 1200, y: 60 }),
	], [B, K1, F, A]],
	// AK4 (b): N leaves the frame G (not tidied)
	leave: () => [[
		frame(G, { x: -100, y: -100, w: 380, h: 400 }), sticky(N, { x: 150, y: 110, parent: G }), sticky(A, { x: 0, y: 0 }),
	], [N, A]],
	// AK4 (c): N enters the frame G (not tidied)
	enter: () => [[
		frame(G, { x: 250, y: -100, w: 400, h: 400 }), sticky(N, { x: 50, y: 10 }), sticky(A, { x: 0, y: 0 }),
	], [N, A]],
	// AK5 (a)–(c)
	heap: () => [[sticky(A, { x: 0, y: 0 }), sticky(B, { x: 50, y: 10 }), sticky(C, { x: 100, y: 20 })], [C, B, A]],
	checker: () => [[sticky(A, { x: 0, y: 0 }), sticky(B, { x: 250, y: 250 }), sticky(C, { x: 470, y: 10 }), sticky(D, { x: 700, y: 230 })], [A, B, C, D]],
	pairRow: () => [[sticky(A, { x: 0, y: 0 }), sticky(B, { x: 300, y: 40 })], [A, B]],
	pairColumn: () => [[sticky(A, { x: 0, y: 0 }), sticky(B, { x: 30, y: 300 })], [A, B]],
}

/**
 * @param {string} name key of TIDY_CASES
 * @return {{m: FakeModel, ids: string[]}} a fresh model of the scenario and its selection
 */
function tidyCase(name) {
	const [items, ids] = TIDY_CASES[name]()
	return { m: new FakeModel(items), ids }
}

/**
 * @param {FakeModel} m model
 * @param {string[]} ids selection
 * @param {number} n clicks
 * @return {{m: FakeModel, counts: number[], first: object}} the model after n clicks, the ops per click, the first result
 */
function tidyClicks(m, ids, n) {
	const counts = []
	let first = null
	for (let i = 0; i < n; i++) {
		const r = tidyItems(m, ids)
		first ??= r
		counts.push(r.ops.length)
		m = patched(m, r.ops)
	}
	return { m, counts, first }
}

/**
 * @param {FakeModel} m model
 * @param {string[]} ids items
 * @param {number} slack overlap allowed on each axis
 * @return {string[]} the pairs whose hulls overlap by more than slack on both axes at once
 */
function overlaps(m, ids, slack) {
	const out = []
	ids.forEach((u, i) => {
		const a = hull(m, u)
		for (const v of ids.slice(i + 1)) {
			const b = hull(m, v)
			if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > slack && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > slack) {
				out.push(u.slice(-2) + '/' + v.slice(-2))
			}
		}
	})
	return out
}

/**
 * @param {FakeModel} m model
 * @param {string} id item
 * @return {number[]} [cx, cy] of its hull
 */
function hullCentre(m, id) {
	const [x0, y0, x1, y1] = hull(m, id)
	return [(x0 + x1) / 2, (y0 + y1) / 2]
}

/** Within 0.01 (plus float noise). */
const near = (v, w) => Math.abs(v - w) <= 0.01 + 1e-9

/**
 * @param {FakeModel} m model
 * @param {object} r result of tidyItems
 * @param {string[]} ids items to compare
 */
function assertUndo(m, r, ids) {
	const back = patched(patched(m, r.ops), r.inverse)
	for (const id of ids) {
		assert.deepEqual(back.get(id), m.get(id), 'undo restores ' + id)
	}
}

test('M2 tidyItems (AK1): a grid with noise keeps its mean gaps (columns 60, rows 80), equal everywhere, the top-left note stays, ops row by row and left to right (not in selection order), complete placement groups, no keep; inverse = old placement', () => {
	const { m, ids } = tidyCase('grid')
	const r = tidyItems(m, ids)
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: B, p: { x: 260, y: 0, parent: null } },
		{ o: 'patch', id: C, p: { x: 520, y: 0, parent: null } },
		{ o: 'patch', id: D, p: { x: 0, y: 280, parent: null } },
		{ o: 'patch', id: E, p: { x: 260, y: 280, parent: null } },
		{ o: 'patch', id: F, p: { x: 520, y: 280, parent: null } },
	], 'column centres 110, 360, 630 → gaps 50, 70 → 60; row centres 113.33, 393.33 → gap 80; A is in place')
	assert.ok(r.ops.every((o) => o.id !== A), 'no patch for A')
	assert.ok([...r.ops, ...r.inverse].every((o) => !('keep' in o)), 'no keep')
	for (const op of [...r.ops, ...r.inverse]) {
		assert.deepEqual(Object.keys(op.p).sort(), ['parent', 'x', 'y'], 'the whole placement group, nothing else')
	}
	assertPlacementGroups([...r.ops, ...r.inverse])
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: B, p: { x: 270, y: 30, parent: null } },
		{ o: 'patch', id: C, p: { x: 520, y: 10, parent: null } },
		{ o: 'patch', id: D, p: { x: 20, y: 290, parent: null } },
		{ o: 'patch', id: E, p: { x: 250, y: 310, parent: null } },
		{ o: 'patch', id: F, p: { x: 540, y: 280, parent: null } },
	])
	const after = patched(m, r.ops)
	const gapX = (s, u, v) => hull(s, v)[0] - hull(s, u)[2]
	const gapY = (s, u, v) => hull(s, v)[1] - hull(s, u)[3]
	// before: the gaps between neighbouring notes differ, their means are 60 and 80
	assert.deepEqual([gapX(m, A, B), gapX(m, B, C), gapX(m, D, E), gapX(m, E, F)], [70, 50, 30, 90])
	assert.deepEqual([gapY(m, A, D), gapY(m, B, E), gapY(m, C, F)], [90, 80, 70])
	assert.deepEqual([gapX(after, A, B), gapX(after, B, C), gapX(after, D, E), gapX(after, E, F)], [60, 60, 60, 60], 'both column gaps 60')
	assert.deepEqual([gapY(after, A, D), gapY(after, B, E), gapY(after, C, F)], [80, 80, 80], 'row gap 80')
	assertUndo(m, r, [A, B, C, D, E, F])
})

test('M2 tidyItems (AK2): different sizes, a rotated note and an empty cell – each hull centred in its cell (rows y 100 and 388.42, columns x 110, 392 and 695.42), the middle cell of row 1 stays empty, gaps 62 and 47', () => {
	const { m, ids } = tidyCase('sizes')
	const r = tidyItems(m, ids)
	// columns [A, C] [B] [E, T]: widths 240, 200, 282.84 (E's hull), mean centres 105, 400, 690
	// → gaps 75 and 48.58 → 62; rows [T, A, B] [C, E]: heights 200, 282.84, mean centres 91.47, 380 → 47
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: A, p: { x: 10, y: 0, parent: null } },
		{ o: 'patch', id: B, p: { x: 292, y: 40, parent: null } },
		{ o: 'patch', id: T, p: { x: 575.42, y: 85.6, parent: null } },
		{ o: 'patch', id: C, p: { x: -10, y: 358.42, parent: null } },
		{ o: 'patch', id: E, p: { x: 595.42, y: 288.42, parent: null } },
	])
	assertPlacementGroups([...r.ops, ...r.inverse])
	const after = patched(m, r.ops)
	for (const [id, cx, cy] of [[A, 110, 100], [B, 392, 100], [T, 695.42, 100], [C, 110, 388.42], [E, 695.42, 388.42]]) {
		const [x, y] = hullCentre(after, id)
		assert.ok(near(x, cx) && near(y, cy), id + ' centred at ' + x + ', ' + y)
	}
	assert.ok([C, E].every((id) => !near(hullCentre(after, id)[0], 392)), 'the middle cell of row 1 stays empty')
	// bands: columns [A ∪ C], [B], [T ∪ E]; rows [A ∪ B ∪ T], [C ∪ E]
	const band = (list, s, e) => [Math.min(...list.map((id) => hull(after, id)[s])), Math.max(...list.map((id) => hull(after, id)[e]))]
	const cols = [band([A, C], 0, 2), band([B], 0, 2), band([T, E], 0, 2)]
	const rows = [band([A, B, T], 1, 3), band([C, E], 1, 3)]
	const colGaps = [cols[1][0] - cols[0][1], cols[2][0] - cols[1][1]]
	assert.ok(colGaps.every((g) => near(g, 62)), 'column gaps ' + colGaps.join(', '))
	assert.ok(near(rows[1][0] - rows[0][1], 47), 'row gap ' + (rows[1][0] - rows[0][1]))
	assertUndo(m, r, [A, B, T, C, E])
})

test('M2 tidyItems (AK3): connectors are skipped – no row, column, gap or corner of their own and no patch (free ends stay); empty for fewer than two alignable items and a tidy selection', () => {
	const none = { ops: [], inverse: [] }
	const { m, ids } = tidyCase('connector')
	const r = tidyItems(m, ids)
	assert.deepEqual(r.ops, [{ o: 'patch', id: B, p: { x: 260, y: 0, parent: null } }], 'gaps 50 and 70 → 60; A stays at 0 (the connector is not the corner)')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: B, p: { x: 250, y: 30, parent: null } }])
	assert.ok(r.ops.every((o) => !Object.keys(o.p).some((k) => k.startsWith('data.'))), 'no end moves')
	assert.deepEqual(patched(m, r.ops).get(X), m.get(X), 'the connector stays as it is')
	assert.deepEqual(tidyItems(m, [A, X]), none, 'one note plus a connector')
	const k = new FakeModel([frame(G, { x: 0, y: 0 }), sticky(K1, { x: 600, y: 400, parent: G }), sticky(A, { x: 2000, y: 0 })])
	assert.deepEqual(tidyItems(k, [G, K1]), none, 'a frame plus its own child: one alignable item')
	assert.deepEqual(tidyItems(m, [A, A, ID(99)]), none, 'duplicates and unknown ids drop out')
	assert.deepEqual(tidyItems(m, []), none)
	assert.deepEqual(tidyItems(m, null), none)
	const grid = tidyCase('grid')
	assert.deepEqual(tidyItems(patched(grid.m, tidyItems(grid.m, grid.ids).ops), grid.ids), none, 'the selection of AK1 once tidied')
})

test('M2 tidyItems (AK4): frames – a tidied frame takes its child (no own patch, no keep) and sizes its row and column; an item leaves or enters a frame that is not tidied, an item in place keeps its parent; inverses restore', () => {
	// (a) one row as high as F (600): A and B centred in it; K1 moves with F
	const a = tidyCase('frame')
	const ra = tidyItems(a.m, a.ids)
	assert.deepEqual(ra.ops, [
		{ o: 'patch', id: A, p: { x: 0, y: 200, parent: null } },
		{ o: 'patch', id: F, p: { x: 300, y: 0, parent: null } },
		{ o: 'patch', id: B, p: { x: 1200, y: 200, parent: null } },
	], 'K1 has no patch of its own')
	assert.ok([...ra.ops, ...ra.inverse].every((o) => !('keep' in o)), 'no keep')
	assertPlacementGroups([...ra.ops, ...ra.inverse])
	const afterA = patched(a.m, ra.ops)
	assert.deepEqual([afterA.abs(K1).x, afterA.abs(K1).y, afterA.get(K1).parent], [400, 100, F], 'the child moves with its frame')
	assertUndo(a.m, ra, [A, F, K1, B])
	// (b) N (child of G, abs 50, 10) gets a column of its own; its new centre (300, 100) lies outside G
	const b = tidyCase('leave')
	assert.deepEqual([b.m.abs(N).x, b.m.abs(N).y], [50, 10])
	const rb = tidyItems(b.m, b.ids)
	assert.deepEqual(rb.ops, [{ o: 'patch', id: N, p: { x: 200, y: 0, parent: null } }])
	assert.deepEqual(rb.inverse, [{ o: 'patch', id: N, p: { x: 150, y: 110, parent: G } }])
	assert.equal(b.m.topContainerAt(100, 100), G, 'A\'s centre lies in G')
	assert.equal(patched(b.m, rb.ops).get(A).parent, null, 'A is in place: no patch, its parent stays')
	assertPlacementGroups([...rb.ops, ...rb.inverse])
	assertUndo(b.m, rb, [N, A])
	// (c) free N: its new centre (300, 100) lies in G – G's child, relative to it
	const c = tidyCase('enter')
	const rc = tidyItems(c.m, c.ids)
	assert.deepEqual(rc.ops, [{ o: 'patch', id: N, p: { x: -50, y: 100, parent: G } }])
	assert.deepEqual(rc.inverse, [{ o: 'patch', id: N, p: { x: 50, y: 10, parent: null } }])
	assertPlacementGroups([...rc.ops, ...rc.inverse])
	const afterC = patched(c.m, rc.ops)
	assert.deepEqual([afterC.abs(N).x, afterC.abs(N).y], [200, 0])
	assertUndo(c.m, rc, [N, A])
})

test('M2 tidyItems (AK5): a heap becomes one row, a checkerboard two rows and four columns with empty cells, two notes in a row or column line up; no overlap afterwards', () => {
	const cases = {
		heap: [[B, 200, 0], [C, 400, 0]],
		// columns: one note each, gaps 50, 20, 30 → 33; rows [A, C] [D, B]: mean centres 105, 340 → 35
		checker: [[C, 466, 0], [B, 233, 235], [D, 699, 235]],
		pairRow: [[B, 300, 0]],
		pairColumn: [[B, 0, 300]],
	}
	const after = {}
	for (const [name, want] of Object.entries(cases)) {
		const { m, ids } = tidyCase(name)
		const r = tidyItems(m, ids)
		assert.deepEqual(r.ops, want.map(([id, x, y]) => ({ o: 'patch', id, p: { x, y, parent: null } })), name)
		assertPlacementGroups([...r.ops, ...r.inverse])
		after[name] = patched(m, r.ops)
		assert.deepEqual(overlaps(after[name], ids, 1e-9), [], name + ': no two hulls overlap')
		assertUndo(m, r, ids)
	}
	// the heap: one row, gap 0 (the hulls touch); the checkerboard: two row centres, four column centres
	assert.deepEqual([A, B, C].map((id) => hull(after.heap, id)), [[0, 0, 200, 200], [200, 0, 400, 200], [400, 0, 600, 200]])
	const checker = [A, B, C, D].map((id) => hullCentre(after.checker, id))
	assert.equal(new Set(checker.map(([, y]) => y)).size, 2, 'two rows')
	assert.equal(new Set(checker.map(([x]) => x)).size, 4, 'four columns')
})

test('M2 tidyItems (AK6): no creeping – a second call is empty (AK1–AK5); a fixed random sample of 2000+ selections (noisy grids with empty cells, slightly rotated items and children of a frame; free scatter, rotated and heavily overlapping) settles after the first call, without overlaps, keeping the rounded top-left corner', () => {
	const none = { ops: [], inverse: [] }
	for (const name of Object.keys(TIDY_CASES)) {
		const { m, ids } = tidyCase(name)
		const r = tidyItems(m, ids)
		assert.ok(r.ops.length > 0, name + ': the first call moves')
		assert.deepEqual(tidyItems(patched(m, r.ops), ids), none, name + ': the second call is empty')
	}
	const rnd = prng(20261016)
	const pick = (list) => list[Math.floor(rnd() * list.length)]
	const seen = new Set()
	const kinds = { grid: 0, scatter: 0, emptyCell: 0, rotated: 0, child: 0, crowded: 0 }
	for (let k = 0; k < 2200; k++) {
		const grid = k % 2 === 0
		const items = []
		const flags = new Set()
		const g = frame(G, { x: round2(-300 + rnd() * 900), y: round2(-300 + rnd() * 900), w: round2(400 + rnd() * 600), h: round2(300 + rnd() * 500) })
		const add = (id, o) => {
			const kind = pick(grid ? ['sticky', 'shape', 'text'] : ['sticky', 'shape'])
			const it = kind === 'sticky'
				? sticky(id, o)
				: kind === 'shape' ? shape(id, { ...o, w: round2(40 + rnd() * 260), h: round2(30 + rnd() * 260) }) : textItem(id, { ...o, w: round2(80 + rnd() * 200) })
			if (it.r) {
				flags.add('rotated')
			}
			// about half of the items whose centre lies in G are its children (relative to it)
			const cx = it.x + it.w / 2
			const cy = it.y + it.h / 2
			if (grid && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h && rnd() < 0.5) {
				Object.assign(it, { parent: G, x: round2(it.x - g.x), y: round2(it.y - g.y) })
				flags.add('child')
			}
			items.push(it)
		}
		if (grid) {
			// 1–4 rows × 1–5 columns, pitch 240–440, noise ±25, ~15 % empty cells, ~25 % slightly rotated
			const rows = 1 + Math.floor(rnd() * 4)
			const cols = 1 + Math.floor(rnd() * 5)
			const px = 240 + rnd() * 200
			const py = 240 + rnd() * 200
			for (let i = 0; i < rows; i++) {
				for (let j = 0; j < cols; j++) {
					if (rnd() < 0.15) {
						flags.add('emptyCell')
						continue
					}
					const r = rnd() < 0.25 ? round2((360 + (rnd() - 0.5) * 16) % 360) : 0
					add(ID('R' + i + j), { x: round2(j * px + (rnd() - 0.5) * 50), y: round2(i * py + (rnd() - 0.5) * 50), r })
				}
			}
		} else {
			// 2–10 notes and shapes, ~60 % rotated, ~30 % crowded into 300 × 300
			const span = rnd() < 0.3 ? 300 : 2500
			if (span === 300) {
				flags.add('crowded')
			}
			for (let i = 0, n = 2 + Math.floor(rnd() * 9); i < n; i++) {
				add(ID('S' + i), { x: round2(rnd() * span), y: round2(rnd() * span), r: rnd() < 0.6 ? round2(rnd() * 360) : 0 })
			}
		}
		if (items.length < 2) {
			continue
		}
		// the selection in a shuffled order (equal centres keep it)
		const ids = items.map((it) => [rnd(), it.id]).sort((u, v) => u[0] - v[0]).map(([, id]) => id)
		const key = JSON.stringify([items, ids])
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		kinds[grid ? 'grid' : 'scatter']++
		for (const f of flags) {
			kinds[f]++
		}
		const m = new FakeModel([g, ...items])
		const label = (grid ? 'grid' : 'scatter') + ' #' + k
		const { counts, first } = tidyClicks(m, ids, 5)
		assert.deepEqual(counts.slice(1), [0, 0, 0, 0], label + ': ' + counts.join(','))
		const once = patched(m, first.ops)
		assert.deepEqual(overlaps(once, ids, 0.01), [], label + ': no overlap after the first call')
		const before = unionHull(m, ids)
		const now = unionHull(once, ids)
		assert.ok(Math.abs(now.minX - Math.round(before.minX)) <= 0.01 + 1e-9, label + ': left ' + before.minX + ' → ' + now.minX)
		assert.ok(Math.abs(now.minY - Math.round(before.minY)) <= 0.01 + 1e-9, label + ': top ' + before.minY + ' → ' + now.minY)
	}
	assert.ok(seen.size >= 2000, seen.size + ' different selections')
	assert.ok(kinds.grid > 900 && kinds.scatter > 900, 'about half grids, half scatter: ' + JSON.stringify(kinds))
	assert.ok(kinds.emptyCell > 300 && kinds.rotated > 800 && kinds.child > 300 && kinds.crowded > 200, 'the sample covers every kind: ' + JSON.stringify(kinds))
})

test('M2 tidyItems (review R1 UX): a hand-placed grid of notes keeps its gap on average (gaps from the track centres, not from the bands); every tidied grid is exact and stays put', () => {
	// before review R1 the gap came from the bands (smallest start to largest end of a track): every
	// hand-placed offset widened them, so 5 × 5 at gap 40 ± 20 came out at about 13 and at ± 40 at 0
	const rnd = prng(20261017)
	for (const [rows, cols, gap, off] of [[3, 4, 20, 20], [3, 4, 40, 20], [5, 5, 40, 20], [5, 5, 40, 40], [5, 5, 60, 30]]) {
		const label = rows + ' × ' + cols + ', gap ' + gap + ' ± ' + off
		const id = (i, j) => ID('G' + i + '_' + j)
		let sumX = 0
		let sumY = 0
		const runs = 100
		for (let k = 0; k < runs; k++) {
			const items = []
			for (let i = 0; i < rows; i++) {
				for (let j = 0; j < cols; j++) {
					const jitter = () => (rnd() * 2 - 1) * off
					items.push(sticky(id(i, j), { x: round2(j * (200 + gap) + jitter()), y: round2(i * (200 + gap) + jitter()) }))
				}
			}
			const ids = items.map((it) => it.id)
			const { m: after, counts } = tidyClicks(new FakeModel(items), ids, 2)
			assert.equal(counts[1], 0, label + ' #' + k + ': the second click is empty')
			// exact: one gap per axis between every pair of neighbours
			const gx = new Set()
			const gy = new Set()
			for (let i = 0; i < rows; i++) {
				for (let j = 0; j < cols; j++) {
					if (j > 0) {
						gx.add(round2(hull(after, id(i, j))[0] - hull(after, id(i, j - 1))[2]))
					}
					if (i > 0) {
						gy.add(round2(hull(after, id(i, j))[1] - hull(after, id(i - 1, j))[3]))
					}
				}
			}
			assert.equal(gx.size, 1, label + ' #' + k + ': column gaps ' + [...gx])
			assert.equal(gy.size, 1, label + ' #' + k + ': row gaps ' + [...gy])
			sumX += [...gx][0]
			sumY += [...gy][0]
		}
		assert.ok(Math.abs(sumX / runs - gap) <= 2, label + ': mean column gap ' + sumX / runs)
		assert.ok(Math.abs(sumY / runs - gap) <= 2, label + ': mean row gap ' + sumY / runs)
	}
})
