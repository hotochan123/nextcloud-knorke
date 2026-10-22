/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Connector actions of round 1b (SPEC-M1 §6.5.2, §4.7 rules 12 and 14):
 * connectItems, retargetEnd, deleteItems v2 (release before the removes,
 * undo binds again), moveItems v2 (free ends, not draggable alone), and
 * copy/paste with remapEndpoint (connectors between copied items stay
 * connected). Against the fake model of fakes.mjs, so only [C]'s side of
 * the contract is pinned; the frozen model surface (normalizeEndpoint,
 * anchorPoint, q) is imported, never repeated.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectItems, copyPayload, deleteItems, duplicateItems, moveItems, pasteItems, retargetEnd } from '../../../src/board/actions.js'
import { decodeClipAttr, encodeClip, validatePayload } from '../../../src/board/clipboard.js'
import { anchorPoint, normalizeEndpoint } from '../../../src/model/connectors.js'
import { q } from '../../../src/model/geometry.js'
import { ULID_RE } from '../../../src/model/ids.js'
import { TYPES } from '../../../src/model/registry.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { FakeModel, ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const D = ID(4)
const F = ID('F1')
const C1 = ID('C1')
const C2 = ID('C2')

/**
 * @param {...string} list ids to hand out in order
 * @return {() => string} id generator
 */
function ids(...list) {
	let i = 0
	return () => list[i++]
}

/**
 * The fake model plus a routed geometry (what SceneModel.geometryOf returns
 * from round 1b on): every bound end at a fixed visible docking point.
 */
class RoutedModel extends FakeModel {
	constructor(items, geoms = {}) {
		super(items)
		this.geoms = geoms
	}

	geometryOf(id) {
		return this.geoms[id] ?? null
	}
}

test('connectItems: one put with placement none (rule 12), z above the content, ends in their stored form, route and end cap from the options', () => {
	const m = new FakeModel([sticky(A, { z: 'i5' }), shape(B, { x: 400, z: 'i6' }), frame(F, { x: 2000, z: 'a0' })])
	const r = connectItems(m, { start: { item: A, ax: 1, ay: 0.123456 }, end: { item: B }, route: 'elbow', endCap: 'triangle' }, () => C1)
	assert.equal(r.ops.length, 1)
	const put = r.ops[0]
	assert.deepEqual(Object.keys(put), ['o', 'id', 't', 'p'])
	assert.deepEqual([put.o, put.id, put.t], ['put', C1, 'connector'])
	assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h, put.p.r, put.p.parent], [0, 0, 0, 0, 0, null])
	assert.ok(isValidKey(put.p.z) && put.p.z > 'i6', 'above the content')
	// ax/ay with q(v, 10000), the server's normalisation; key order item, ax, ay
	assert.deepEqual(put.p.data.start, normalizeEndpoint({ item: A, ax: 1, ay: 0.123456 }))
	assert.deepEqual(put.p.data.start, { item: A, ax: 1, ay: q(0.123456, 10000) })
	assert.deepEqual(Object.keys(put.p.data.start), ['item', 'ax', 'ay'])
	assert.deepEqual(put.p.data.end, { item: B })
	assert.equal(put.p.data.route, 'elbow')
	assert.deepEqual(put.p.style, { ...TYPES.connector.defaults.style, endCap: 'triangle' })
	assert.deepEqual(r.inverse, [{ o: 'remove', id: C1 }])
	assert.deepEqual(r.selectIds, [C1])
	// the required ends are present (rule 19); nothing outside the field rules
	for (const k of Object.keys(put.p.data)) {
		assert.ok(['start', 'end', 'route'].includes(k), k)
	}
})

test('connectItems: options that fail their rule fall back to the registry defaults; free ends on the 0.01 grid, never -0', () => {
	const m = new FakeModel([sticky(A)])
	const r = connectItems(m, { start: { x: 10.123, y: -0.001 }, end: { item: A }, route: 'zigzag', endCap: 'star' }, () => C1)
	const p = r.ops[0].p
	assert.equal(p.data.route, TYPES.connector.defaults.data.route)
	assert.equal(p.style.endCap, TYPES.connector.defaults.style.endCap)
	assert.deepEqual(p.data.start, { x: 10.12, y: 0 })
	assert.ok(!Object.is(p.data.start.y, -0))
	// no tool options at all: the defaults that the put stores
	const d = connectItems(m, { start: { x: 0, y: 0 }, end: { item: A } }, () => C2).ops[0].p
	assert.deepEqual([d.data.route, d.style.endCap], ['straight', 'arrow'])
})

test('connectItems: nothing for an invalid end, a target the model does not have or that cannot be bound, or two equal ends', () => {
	const m = new FakeModel([sticky(A), frame(F, { x: 2000 }), connector(C2, { x: 0, y: 0 }, { item: A }), { ...sticky(D), t: 'pen' }])
	const none = { ops: [], inverse: [], selectIds: [] }
	const mk = (start, end) => connectItems(m, { start, end }, () => C1)
	assert.deepEqual(mk({ item: A }, null), none)
	assert.deepEqual(mk({ item: A }, { item: A, ax: 1.5, ay: 0 }), none, 'ax out of [0, 1]')
	assert.deepEqual(mk({ item: A }, { item: 'nope' }), none, 'not a ULID')
	assert.deepEqual(mk({ item: A }, { item: ID(99) }), none, 'unknown to the model')
	assert.deepEqual(mk({ item: A }, { item: F }), none, 'a frame is not bindable')
	assert.deepEqual(mk({ item: A }, { item: C2 }), none, 'a connector is not bindable')
	assert.deepEqual(mk({ item: A }, { item: D }), none, 'an unknown stored type is not bindable')
	assert.deepEqual(mk({ item: A }, { item: A }), none, 'equal ends')
	assert.deepEqual(mk({ x: 5, y: 5 }, { x: 5.001, y: 5 }), none, 'equal on the 0.01 grid')
	// a loop on one item between two anchors is allowed (the server allows it too)
	assert.equal(mk({ item: A, ax: 0, ay: 0.5 }, { item: A, ax: 1, ay: 0.5 }).ops.length, 1)
})

test('retargetEnd: one patch of the WHOLE end (one register, never a sub-path); inverse = the end before', () => {
	const m = new FakeModel([sticky(A), sticky(B, { x: 400 }), connector(C1, { item: A }, { x: 900, y: 50 })])
	const r = retargetEnd(m, { id: C1, which: 'end', value: { item: B, ax: 0, ay: 0.55555 }, before: { x: 900, y: 50 } })
	assert.deepEqual(r.ops, [{ o: 'patch', id: C1, p: { 'data.end': { item: B, ax: 0, ay: q(0.55555, 10000) } } }])
	assert.deepEqual(r.inverse, [{ o: 'patch', id: C1, p: { 'data.end': { x: 900, y: 50 } } }])
	for (const op of [...r.ops, ...r.inverse]) {
		assert.ok(Object.keys(op.p).every((k) => k === 'data.start' || k === 'data.end'), 'never data.end.item')
	}
	// to a free point (0.01 grid) and back; before missing → the model's end
	const s = retargetEnd(m, { id: C1, which: 'start', value: { x: 1.005, y: 2 } })
	assert.deepEqual(s.ops, [{ o: 'patch', id: C1, p: { 'data.start': { x: q(1.005, 100), y: 2 } } }])
	assert.deepEqual(s.inverse, [{ o: 'patch', id: C1, p: { 'data.start': { item: A } } }])
})

test('retargetEnd: nothing for the connector itself, a non-bindable target, an unchanged end, an invalid value, which or id', () => {
	const m = new FakeModel([sticky(A), frame(F, { x: 2000 }), connector(C1, { item: A }, { x: 900, y: 50 }), connector(C2, { item: A }, { x: 0, y: 0 })])
	const none = { ops: [], inverse: [] }
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'end', value: { item: C1 } }), none)
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'end', value: { item: C2 } }), none)
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'end', value: { item: F } }), none)
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'end', value: { x: 900, y: 50 } }), none, 'unchanged')
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'end', value: { item: A } }), none, 'equal to the other end (zero length)')
	assert.equal(retargetEnd(m, { id: C1, which: 'end', value: { item: A, ax: 1, ay: 0.5 } }).ops.length, 1, 'a loop between two anchors is fine')
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'end', value: { x: 'a', y: 50 } }), none)
	assert.deepEqual(retargetEnd(m, { id: C1, which: 'middle', value: { x: 1, y: 1 } }), none)
	assert.deepEqual(retargetEnd(m, { id: ID(99), which: 'end', value: { x: 1, y: 1 } }), none)
	assert.deepEqual(retargetEnd(m, { id: A, which: 'end', value: { x: 1, y: 1 } }), none, 'a note has no ends')
})

test('deleteItems v2: a connector bound to a deleted item gets a free end at the VISIBLE docking point before the removes; undo revives first, then binds again', () => {
	// C1: A → B (auto), drawn with its end at B's left side midpoint (400, 100)
	const m = new RoutedModel([sticky(A), sticky(B, { x: 400, y: 0 }), connector(C1, { item: A }, { item: B })], {
		[C1]: { kind: 'poly', start: { x: 200, y: 100, angle: 0 }, end: { x: 400, y: 100, angle: 0 } },
	})
	const r = deleteItems(m, [B])
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: C1, p: { 'data.end': { x: 400, y: 100 } } },
		{ o: 'remove', id: B },
	])
	assert.equal(r.inverse[0].o, 'put')
	assert.equal(r.inverse[0].id, B)
	assert.equal(r.inverse[0].revive, true)
	assert.deepEqual(r.inverse.slice(1), [{ o: 'patch', id: C1, p: { 'data.end': { item: B } } }])
	// the stored end is restored as it was (anchor ax/ay included)
	const m2 = new RoutedModel([sticky(A), sticky(B, { x: 400, y: 0 }), connector(C1, { item: B, ax: 0.25, ay: 1 }, { item: B, ax: 1, ay: 0.5 })], {
		[C1]: { kind: 'poly', start: { x: 450.004, y: 200 }, end: { x: 600, y: 100 } },
	})
	const r2 = deleteItems(m2, [B])
	assert.deepEqual(r2.ops[0], { o: 'patch', id: C1, p: { 'data.start': { x: 450, y: 200 }, 'data.end': { x: 600, y: 100 } } }, 'both ends in ONE patch, on the 0.01 grid')
	assert.deepEqual(r2.inverse[1], { o: 'patch', id: C1, p: { 'data.start': { item: B, ax: 0.25, ay: 1 }, 'data.end': { item: B, ax: 1, ay: 0.5 } } })
})

test('deleteItems v2: without a routed geometry the target\'s anchor point (auto → centre, rule 14 formula); a deleted connector is only removed; children of a deleted frame stay bound', () => {
	const m = new FakeModel([
		frame(F, { x: 1000, y: 1000, w: 600, h: 600 }),
		sticky(A, { x: 10, y: 20, parent: F }),
		sticky(B, { x: 0, y: 0, w: 200, h: 100, r: 90 }),
		connector(C1, { item: A }, { item: B, ax: 1, ay: 0.5 }),
		connector(C2, { item: B }, { x: 5, y: 5 }),
	])
	const r = deleteItems(m, [B, C2])
	const box = m.abs(B)
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: C1, p: { 'data.end': anchorPoint(box, { item: B, ax: 1, ay: 0.5 }) } },
		{ o: 'remove', id: B },
		{ o: 'remove', id: C2 },
	])
	assert.ok(!r.ops.some((op) => op.id === C2 && op.o === 'patch'), 'C2 is deleted itself: no release')
	// deleting the frame frees its child A; C1 stays bound to A
	const f = deleteItems(m, [F])
	assert.deepEqual(f.ops.map((op) => [op.o, op.id]), [['patch', A], ['remove', F]])
	// a geometry that throws or has no point: the anchor point again
	const bad = deleteItems(m, [B], () => { throw new Error('boom') })
	assert.deepEqual(bad.ops[0], r.ops[0])
	const auto = deleteItems(new FakeModel([sticky(A, { x: 0, y: 0, w: 200, h: 200 }), connector(C1, { x: 900, y: 0 }, { item: A })]), [A], () => ({ start: null }))
	assert.deepEqual(auto.ops[0], { o: 'patch', id: C1, p: { 'data.end': { x: 100, y: 100 } } })
})

test('deleteItems v2: the release and the binding travel as one undo step through a server that applies rule 14 (no derived release left)', () => {
	const m = new RoutedModel([sticky(A), sticky(B, { x: 400, y: 0 }), connector(C1, { item: A }, { item: B })], {
		[C1]: { start: { x: 200, y: 100 }, end: { x: 400, y: 100 } },
	})
	const r = deleteItems(m, [B])
	// a miniature server with rule 14: after the batch, release ends still bound to removed items
	const live = new Map([...m.items].map(([k, v]) => [k, structuredClone(v)]))
	const derived = []
	const run = (ops) => {
		const removed = new Set()
		for (const op of ops) {
			if (op.o === 'remove') {
				live.delete(op.id)
				removed.add(op.id)
			} else if (op.o === 'put') {
				live.set(op.id, { id: op.id, t: op.t, ...structuredClone(op.p) })
			} else {
				const it = live.get(op.id)
				for (const [k, v] of Object.entries(op.p)) {
					it.data[k.slice(5)] = structuredClone(v)
				}
			}
		}
		for (const it of live.values()) {
			for (const w of ['start', 'end']) {
				if (it.t === 'connector' && removed.has(it.data[w]?.item)) {
					derived.push([it.id, w])
				}
			}
		}
	}
	run(r.ops)
	assert.deepEqual(derived, [], 'the client released first: nothing left for the server')
	assert.deepEqual(live.get(C1).data.end, { x: 400, y: 100 })
	run(r.inverse)
	assert.deepEqual(live.get(C1).data.end, { item: B }, 'undo: bound again, B alive before the binding arrives')
})

test('moveItems v2: a connector with a bound end is not draggable alone; with its target (also through a frame) its free end follows; free-free moves both ends', () => {
	const m = new FakeModel([
		frame(F, { x: 1000, y: 0, w: 600, h: 600 }),
		sticky(A, { x: 10, y: 20, parent: F }),
		connector(C1, { item: A }, { x: 50, y: 60 }),
		connector(C2, { x: 1, y: 2 }, { x: 3, y: 4 }),
	])
	assert.deepEqual(moveItems(m, { ids: [C1], dx: 5, dy: 5, origin: new Map() }), { ops: [], inverse: [] })
	const both = moveItems(m, { ids: [C2], dx: 5, dy: 5, origin: new Map() })
	assert.deepEqual(both.ops, [{ o: 'patch', id: C2, p: { 'data.start': { x: 6, y: 7 }, 'data.end': { x: 8, y: 9 } } }])
	// the frame (with A inside) moves: C1 follows
	const r = moveItems(m, { ids: [F, C1], dx: 5, dy: 5, origin: new Map([[F, { x: 1000, y: 0, parent: null }]]) })
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: F, p: { x: 1005, y: 5, parent: null } },
		{ o: 'patch', id: C1, p: { 'data.end': { x: 55, y: 65 } } },
	])
	assert.deepEqual(r.inverse[1], { o: 'patch', id: C1, p: { 'data.end': { x: 50, y: 60 } } })
	for (const op of [...r.ops, ...both.ops]) {
		if (op.id === C1 || op.id === C2) {
			assert.ok(!['x', 'y', 'w', 'h', 'r', 'parent'].some((k) => k in op.p), 'rule 12: no placement patch on a connector')
		}
	}
})

test('copy/paste to a second board: connectors between copied items stay connected (new ids, anchors kept); an end to an item left out becomes a free point that moves with the paste', () => {
	const src = new RoutedModel([
		sticky(A, { x: 0, y: 0, z: 'i1' }),
		shape(B, { x: 400, y: 0, z: 'i2' }),
		textItem(D, { x: 0, y: 800, z: 'i3' }),
		connector(C1, { item: A, ax: 1, ay: 0.5 }, { item: B }, { z: 'i4', data: { start: { item: A, ax: 1, ay: 0.5 }, end: { item: B }, route: 'elbow', label: 'yes' } }),
		connector(C2, { item: B }, { item: D }, { z: 'i5' }),
	], { [C2]: { start: { x: 500, y: 120 }, end: { x: 120, y: 800 } } })
	// A, B and both connectors selected; D (C2's end) is left out
	const payload = copyPayload(src, [A, B, C1, C2], { board: 7 })
	assert.deepEqual(payload.items.map((it) => it.id), [A, B, C1, C2])
	assert.deepEqual(payload.items[3].data.end, { x: 120, y: 800 }, 'the end outside: free at its visible docking point')
	// through the clipboard format and its check, like Ctrl+C / Ctrl+V between boards
	const clip = encodeClip(payload)
	const attr = clip.html.match(/data-knorke-clip="([^"]+)"/)[1]
	const v = validatePayload(decodeClipAttr(attr))
	assert.equal(v.ok, true)
	const target = new FakeModel([])
	const r = pasteItems(target, v.payload, { offset: { x: 100, y: 50 }, board: 8 }, ids(ID(61), ID(62), ID(63), ID(64)))
	assert.deepEqual(r.ops.map((o) => [o.o, o.t]), [['put', 'sticky'], ['put', 'shape'], ['put', 'connector'], ['put', 'connector']], 'connectors after both ends')
	const c1 = r.ops[2].p.data
	assert.deepEqual([c1.start, c1.end, c1.route, c1.label], [{ item: ID(61), ax: 1, ay: 0.5 }, { item: ID(62) }, 'elbow', 'yes'])
	const c2 = r.ops[3].p.data
	assert.deepEqual([c2.start, c2.end], [{ item: ID(62) }, { x: 220, y: 850 }])
	for (const op of r.ops) {
		assert.match(op.id, ULID_RE)
		assert.ok(![A, B, C1, C2].includes(op.id))
	}
	assert.equal(r.skipped, 0)
	assert.deepEqual(r.selectIds, [ID(61), ID(62), ID(63), ID(64)])
	// duplicate on the same board (+20/+20): the copies are connected among themselves
	const dup = duplicateItems(src, [A, B, C1], { offset: 20, board: 7 }, ids(ID(71), ID(72), ID(73)))
	assert.deepEqual(dup.ops[2].p.data.start, { item: ID(71), ax: 1, ay: 0.5 })
	assert.deepEqual(dup.ops[2].p.data.end, { item: ID(72) })
})

test('pasteItems: a connector bound to a payload item that cannot be bound (a frame) is skipped and counted', () => {
	const payload = {
		knorke: 1,
		board: 7,
		items: [
			{ ...frame(F, { x: 0, y: 0 }) },
			{ ...sticky(A, { x: 900, y: 0 }) },
			{ ...connector(C1, { item: F }, { item: A }) },
			{ ...connector(C2, { item: A }, { x: 1, y: 1 }) },
		],
	}
	const r = pasteItems(new FakeModel([]), payload, { inPlace: true, board: 8 }, ids(ID(81), ID(82), ID(83), ID(84)))
	assert.equal(r.skipped, 1)
	assert.deepEqual(r.ops.filter((o) => o.t === 'connector').map((o) => o.p.data.start), [{ item: ID(82) }])
})
