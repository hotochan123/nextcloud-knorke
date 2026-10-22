/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Group items in the actions and the session (job 026, AK6 and AK7; M2
 * SPEC-M1 §1.2 "(R20) Gruppieren"):
 * - groupItems / ungroupItems (one new id, inverses, empty and blocked
 *   cases in their order, connectors left out)
 * - deleteItems (a group left with one unlocked member: {group: null}
 *   before the removes, the inverse after the revives, which carry p.group)
 * - copyPayload / pasteItems / duplicateItems (a new common group, one
 *   parent for the roots under the centre of their union, single members
 *   and mixed payload parents without a group)
 * - moveItems (one parent for a fully dragged group, a single member keeps
 *   its parent), alignItems / distributeItems / tidyItems (a group is one
 *   block: every member the same shift; a group alone is empty), frame
 *   membership after a transform (a group freed or adopted only as a whole)
 * - BoardSession: groupSelection (one undo step, the selection grows by the
 *   group, the current item last), blocked → toast group-blocked, undo,
 *   selection v2 fields, align and nudge without a held group, lock of a
 *   whole group in one step, the intents group and ungroup, the menu
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	alignItems, copyPayload, createItem, deleteItems, distributeItems, duplicateItems, groupItems, moveItems, pasteItems, tidyItems,
	transformItems, ungroupItems,
} from '../../../src/board/actions.js'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { menuBlocked, menuEntries, showGroup, showUngroup } from '../../../src/components/contextbar.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, connector, frame, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const D = ID(4)
const F = ID('F1')
const K = ID('K1')
const G = '01JG0000000000000000000001'
const NEW = '01JG0000000000000000000099'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

/** @return {() => string} an id generator: ULID-shaped ids 01JN…1, 01JN…2, … */
const ids = () => {
	let n = 0
	return () => '01JN' + String(++n).padStart(22, '0')
}

// ---- AK6: actions -------------------------------------------------------------

test('AK6 groupItems: two notes at the root → two patches with the same new id, inverse null; a group plus a note → one new group of all three, inverses restore G and null', () => {
	let m = new FakeModel([sticky(A, { z: 'i1' }), sticky(B, { x: 300, z: 'i2' })])
	assert.deepEqual(groupItems(m, [B, A], () => NEW), {
		ops: [{ o: 'patch', id: A, p: { group: NEW } }, { o: 'patch', id: B, p: { group: NEW } }],
		inverse: [{ o: 'patch', id: A, p: { group: null } }, { o: 'patch', id: B, p: { group: null } }],
		ids: [A, B],
		blocked: null,
	})
	m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G }), sticky(C, { x: 600, z: 'i3' })])
	const r = groupItems(m, [A, C], () => NEW)
	assert.deepEqual(r.ops, [A, B, C].map((id) => ({ o: 'patch', id, p: { group: NEW } })), 'B comes with its group')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: A, p: { group: G } }, { o: 'patch', id: B, p: { group: G } }, { o: 'patch', id: C, p: { group: null } }])
	assert.deepEqual(groupItems(m, [A, B], () => NEW), { ops: [], inverse: [], ids: [A, B], blocked: null }, 'exactly one group: empty')
	assert.deepEqual(groupItems(m, [C], () => NEW).ops, [], 'one item: empty')
})

test('AK6 groupItems: blocked in the order frame, locked, parent – no ops; connectors in the selection are left out', () => {
	const m = new FakeModel([
		frame(F, { x: 2000 }), sticky(A, { z: 'i1' }), sticky(B, { x: 300, z: 'i2', lock: LOCK }), sticky(C, { x: 10, y: 10, z: 'i3', parent: F }),
		sticky(D, { x: 600, z: 'i4' }), connector(K, { item: A }, { item: D }),
	])
	for (const [sel, why] of [[[A, F, B, C], 'frame'], [[A, B, C], 'locked'], [[A, C], 'parent']]) {
		const r = groupItems(m, sel, () => NEW)
		assert.equal(r.blocked, why, why)
		assert.deepEqual([r.ops, r.inverse], [[], []], why + ': nothing to send')
	}
	const r = groupItems(m, [A, K, D], () => NEW)
	assert.equal(r.blocked, null)
	assert.deepEqual(r.ops.map((o) => o.id), [A, D], 'the connector is no member')
})

test('AK6 ungroupItems: every member → null, inverse G; a locked member blocks (locked), no ops', () => {
	let m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G }), sticky(C, { z: 'i3' })])
	assert.deepEqual(ungroupItems(m, [A, C]), {
		ops: [{ o: 'patch', id: A, p: { group: null } }, { o: 'patch', id: B, p: { group: null } }],
		inverse: [{ o: 'patch', id: A, p: { group: G } }, { o: 'patch', id: B, p: { group: G } }],
		blocked: null,
	})
	assert.deepEqual(ungroupItems(m, [C]), { ops: [], inverse: [], blocked: null })
	m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G, lock: LOCK })])
	assert.deepEqual(ungroupItems(m, [A]), { ops: [], inverse: [], blocked: 'locked' })
})

test('AK6 deleteItems: G {A, B} minus A → [patch B {group: null}, remove A], inverse [revive A with p.group G, patch B {group: G}]; three members or a locked rest → no group patch', () => {
	let m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G })])
	let r = deleteItems(m, [A])
	assert.deepEqual(r.ops, [{ o: 'patch', id: B, p: { group: null } }, { o: 'remove', id: A }])
	const { id, t, ...p } = m.get(A)
	assert.deepEqual(r.inverse, [{ o: 'put', id, t, revive: true, p: { ...p, group: G } }, { o: 'patch', id: B, p: { group: G } }])
	assert.equal(r.inverse[0].p.group, G, 'undo brings A back grouped')
	m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G }), sticky(C, { x: 600, z: 'i3', group: G })])
	r = deleteItems(m, [A])
	assert.deepEqual(r.ops, [{ o: 'remove', id: A }], 'two members left: still a group')
	assert.deepEqual(deleteItems(m, [A, B, C]).ops.map((o) => o.o), ['remove', 'remove', 'remove'], 'all of them: no patch')
	m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G, lock: LOCK })])
	r = deleteItems(m, [A])
	assert.deepEqual(r.ops, [{ o: 'remove', id: A }], 'a locked rest: the server dissolves it')
	assert.equal(r.inverse.length, 1)
})

test('AK6 copyPayload / pasteItems / duplicateItems: a whole group → a new common id ≠ G, its roots one parent (the union, not one box over F); one member → null; mixed payload parents → null', () => {
	// A's centre (600, 200) lies in F, B's (1100, 200) not; the union's centre (850, 200) not either
	const m = new FakeModel([frame(F, { x: 0, y: 0, w: 800, h: 600 }), sticky(A, { x: 500, y: 100, z: 'i1', group: G }), sticky(B, { x: 1000, y: 100, z: 'i2', group: G })])
	assert.deepEqual(copyPayload(m, [A, B]).items.map((it) => it.group), [G, G])
	let r = pasteItems(m, copyPayload(m, [A, B]), { inPlace: true }, ids())
	const puts = r.ops.filter((o) => o.o === 'put')
	assert.equal(puts.length, 2)
	assert.equal(puts[0].p.group, puts[1].p.group, 'one new group')
	assert.notEqual(puts[0].p.group, G)
	assert.match(puts[0].p.group, /^01JN/, 'a new id of the paste')
	assert.deepEqual(puts.map((o) => o.p.parent), [null, null], 'one parent for the roots, from the union')
	r = duplicateItems(m, [A, B], { offset: 20 }, ids())
	const dup = r.ops.filter((o) => o.o === 'put')
	assert.deepEqual([dup[0].p.group === dup[1].p.group, dup[0].p.group !== G, dup.map((o) => o.p.parent)], [true, true, [null, null]])
	assert.deepEqual(r.inverse.map((o) => o.o), ['remove', 'remove'], 'the inverse stays: all removes')
	r = duplicateItems(m, [A], { offset: 20 }, ids())
	assert.equal(r.ops[0].p.group, null, 'a single member: no group')
	assert.equal(r.ops[0].p.parent, F, 'and the usual parent rule')
	const payload = {
		knorke: 1, board: null, origin: [0, 0], items: [
			{ id: F, t: 'frame', x: 0, y: 0, w: 800, h: 600, r: 0, parent: null, data: {}, style: {}, group: null },
			{ id: A, t: 'sticky', x: 10, y: 10, w: 200, h: 200, r: 0, parent: F, data: {}, style: {}, group: G },
			{ id: B, t: 'sticky', x: 2000, y: 10, w: 200, h: 200, r: 0, parent: null, data: {}, style: {}, group: G },
			{ id: C, t: 'sticky', x: 3000, y: 10, w: 200, h: 200, r: 0, parent: null, data: {}, style: {}, group: NEW },
			{ id: D, t: 'frame', x: 4000, y: 10, w: 800, h: 600, r: 0, parent: null, data: {}, style: {}, group: NEW },
		],
	}
	r = pasteItems(new FakeModel([]), payload, { inPlace: true }, ids())
	assert.deepEqual(r.ops.map((o) => o.p.group), [null, null, null, null, null], 'different payload parents; a frame in the group')
})

test('AK6 moveItems: a whole group whose union centre lies over F → both F (one member\'s own centre outside); out of F → both null; a single member keeps its parent', () => {
	let m = new FakeModel([frame(F, { x: 1000, y: 0, w: 800, h: 600 }), sticky(A, { x: 0, y: 0, z: 'i1', group: G }), sticky(B, { x: 300, y: 0, z: 'i2', group: G })])
	const origin = new Map([[A, { x: 0, y: 0, parent: null }], [B, { x: 300, y: 0, parent: null }]])
	// A → (800, 0), centre 900: outside F alone; the union 800..1300 has its centre 1050 in F
	let r = moveItems(m, { ids: [A, B], dx: 800, dy: 0, origin })
	assert.deepEqual(r.ops, [{ o: 'patch', id: A, p: { x: -200, y: 0, parent: F } }, { o: 'patch', id: B, p: { x: 100, y: 0, parent: F } }])
	r = moveItems(m, { ids: [A], dx: 1000, dy: 0, origin })
	assert.deepEqual(r.ops, [{ o: 'patch', id: A, p: { x: 1000, y: 0, parent: null } }], 'one member of a group that is not fully dragged keeps its parent')
	m = new FakeModel([frame(F, { x: 1000, y: 0, w: 800, h: 600 }), sticky(A, { x: 100, y: 100, z: 'i1', parent: F, group: G }), sticky(B, { x: 400, y: 100, z: 'i2', parent: F, group: G })])
	r = moveItems(m, { ids: [A, B], dx: -1000, dy: 0, origin: new Map([[A, { x: 100, y: 100, parent: F }], [B, { x: 400, y: 100, parent: F }]]) })
	assert.deepEqual(r.ops, [{ o: 'patch', id: A, p: { x: 100, y: 100, parent: null } }, { o: 'patch', id: B, p: { x: 400, y: 100, parent: null } }])
})

test('AK6 alignItems / distributeItems / tidyItems: a group plus notes – both members get the same shift (one block, its hull); a group alone is empty', () => {
	const m = new FakeModel([
		sticky(A, { x: 0, y: 0, z: 'i1', group: G }), sticky(B, { x: 300, y: 0, z: 'i2', group: G }),
		sticky(C, { x: -200, y: 500, z: 'i3' }), sticky(D, { x: 2000, y: 1000, z: 'i4' }),
	])
	const shift = (r, id) => {
		const op = r.ops.find((o) => o.id === id)
		return op ? [op.p.x - m.get(id).x, op.p.y - m.get(id).y] : [0, 0]
	}
	let r = alignItems(m, [A, B, C], 'left')
	assert.deepEqual([shift(r, A), shift(r, B)], [[-200, 0], [-200, 0]], 'the group hull 0..500 moves to U.minX = -200')
	assert.equal(r.ops.some((o) => o.id === C), false)
	assert.deepEqual(alignItems(m, [A, B], 'left'), { ops: [], inverse: [] }, 'one block: no "Align"')
	// distribute: C (hull −1000..−800), the group (0..500) and D (2000..2200): the group is the inner block
	const m2 = new FakeModel([
		sticky(A, { x: 0, y: 0, z: 'i1', group: G }), sticky(B, { x: 300, y: 0, z: 'i2', group: G }),
		sticky(C, { x: -1000, y: 0, z: 'i3' }), sticky(D, { x: 2000, y: 0, z: 'i4' }),
	])
	r = distributeItems(m2, [A, B, C, D], 'horizontal')
	assert.deepEqual(r.ops.map((o) => [o.id, o.p.x]), [[A, 350], [B, 650]], 'equal gaps of 1150: both members +350')
	assert.deepEqual(distributeItems(m2, [A, B, C], 'horizontal'), { ops: [], inverse: [] }, 'two blocks: no "Distribute"')
	// tidy: the group (5..505 × 3..203) and C (0..200 × 600..800): one column, the group moves −5 as one
	const m3 = new FakeModel([sticky(A, { x: 5, y: 3, z: 'i1', group: G }), sticky(B, { x: 305, y: 3, z: 'i2', group: G }), sticky(C, { x: 0, y: 600, z: 'i3' })])
	r = tidyItems(m3, [A, B, C])
	assert.deepEqual(r.ops.filter((o) => o.id !== C).map((o) => [o.id, o.p.x, o.p.y]), [[A, 0, 3], [B, 300, 3]])
	assert.deepEqual(tidyItems(m3, [A, B]), { ops: [], inverse: [] }, 'a group alone')
})

test('AK6 transformItems of a frame: a group whose hull sticks out half is freed together or stays together, never split; adopted only as a whole', () => {
	const kids = () => new FakeModel([frame(F, { x: 0, y: 0, w: 800, h: 600 }), sticky(A, { x: 500, y: 100, z: 'i1', parent: F, group: G }), sticky(B, { x: 700, y: 100, z: 'i2', parent: F, group: G })])
	const xf = (m, w) => transformItems(m, { ids: [F], before: new Map([[F, { x: 0, y: 0, w: 800, h: 600, r: 0, parent: null }]]), after: new Map([[F, { x: 0, y: 0, w, h: 600, r: 0 }]]) })
	// w 700: B's own centre (800) lies outside, the union's (700) on the edge: both stay
	let r = xf(kids(), 700)
	assert.deepEqual(r.ops.map((o) => o.id), [F], 'both stay')
	// w 650: the union's centre lies outside: both are freed
	r = xf(kids(), 650)
	assert.deepEqual(r.ops.slice(1), [{ o: 'patch', id: A, p: { x: 500, y: 100, parent: null } }, { o: 'patch', id: B, p: { x: 700, y: 100, parent: null } }])
	assert.deepEqual(r.inverse.slice(1), [{ o: 'patch', id: A, p: { x: 500, y: 100, parent: F } }, { o: 'patch', id: B, p: { x: 700, y: 100, parent: F } }])
	const roots = () => new FakeModel([frame(F, { x: 0, y: 0, w: 800, h: 600 }), sticky(A, { x: 1000, y: 100, z: 'i1', group: G }), sticky(B, { x: 1300, y: 100, z: 'i2', group: G })])
	r = xf(roots(), 1600)
	assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p.parent]), [[A, F], [B, F]], 'the union inside: both adopted')
	r = xf(roots(), 1400)
	assert.deepEqual(r.ops.map((o) => o.id), [F], 'only A inside: neither is adopted')
})

test('round 1 (code review 3): two frames transformed together – a group one frame leaves alone may still be adopted by the other, in either order', () => {
	const F2 = ID('F2')
	const m = () => new FakeModel([
		frame(F, { x: 0, y: 0, w: 700, h: 600, z: 'f1' }), frame(F2, { x: 0, y: 0, w: 1500, h: 600, z: 'f0' }),
		sticky(A, { x: 500, y: 100, z: 'i1', group: G }), sticky(B, { x: 900, y: 100, z: 'i2', group: G }),
	])
	const before = new Map([[F, { x: 0, y: 0, w: 700, h: 600, r: 0, parent: null }], [F2, { x: 0, y: 0, w: 1500, h: 600, r: 0, parent: null }]])
	const after = new Map([[F, { x: 0, y: 0, w: 800, h: 600, r: 0 }], [F2, { x: 0, y: 0, w: 1600, h: 600, r: 0 }]])
	for (const order of [[F, F2], [F2, F]]) {
		const r = transformItems(m(), { ids: order, before, after })
		const adopted = r.ops.filter((o) => o.id === A || o.id === B).map((o) => [o.id, o.p.parent])
		assert.deepEqual(adopted, [[A, F2], [B, F2]], 'only A inside F, the union inside F2: F2 adopts both (order ' + order.map((x) => x.slice(-2)).join(',') + ')')
	}
})

test('job 026: a frame drawn from a rect adopts a group only as a whole (every member inside), like membership after a transform', () => {
	const m = new FakeModel([sticky(A, { x: 100, y: 100, z: 'i1', group: G }), sticky(B, { x: 400, y: 100, z: 'i2', group: G }), sticky(C, { x: 100, y: 400, z: 'i3' })])
	let r = createItem(m, { t: 'frame', at: { x: 0, y: 0 }, rect: { x: 0, y: 0, w: 380, h: 700 } }, () => F)
	assert.deepEqual(r.ops.slice(1).map((o) => o.id), [C], 'only A of the group lies inside: neither member is adopted, C is')
	r = createItem(m, { t: 'frame', at: { x: 0, y: 0 }, rect: { x: 0, y: 0, w: 700, h: 700 } }, () => F)
	assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p.parent]), [[A, F], [B, F], [C, F]], 'the whole group inside: both adopted')
})
// ---- AK7: the session ---------------------------------------------------------

const T0 = 1760100000000
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness (as in locks.test.mjs)
 */
async function open({ items = [sticky(A, { x: 0, y: 0, z: 'a1' }), sticky(B, { x: 400, y: 0, z: 'a2' }), sticky(C, { x: 800, y: 0, z: 'a3' })], me = BOB } = {}) {
	const clock = new FakeClock(10000)
	const ui = { selection: [], undo: [] }
	const toasts = []
	const infos = []
	let rev = 5
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta: {} }, me, items }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				return {}
			}
			tr.calls.push(structuredClone(body))
			const res = { rev: body.since, presence: {} }
			if (body.ops) {
				rev = Math.max(rev, body.since) + 1
				res.acks = { seq: body.seq, rev, res: body.ops.map(() => 'ok') }
				res.rev = rev
			}
			return res
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: { onSelection: (x) => ui.selection.push(x), onUndoState: (x) => ui.undo.push(x) },
		deps: {
			SceneModel: FakeModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => toasts.push(o?.hook ? [m, o.hook] : m),
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model }
}

const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const select = (h, ids) => h.scene.callbacks.onSelection(ids)
const lastSel = (h) => h.ui.selection.at(-1)

test('AK7 groupSelection: one undo step, the ops go out, the selection grows by the group (current item last); undo restores the old groups', async () => {
	const h = await open({ items: [sticky(A, { z: 'a1', group: G }), sticky(B, { x: 400, z: 'a2', group: G }), sticky(C, { x: 800, z: 'a3' })] })
	select(h, [A, C])
	const n = h.tr.calls.length
	assert.equal(h.s.groupSelection(), 'sent')
	assert.equal(h.s.undoStack.done.length, 1)
	assert.deepEqual(h.s.selection, [B, A, C], 'B joins, C stays the current item')
	const g = h.model.get(A).group
	assert.ok(typeof g === 'string' && g !== G)
	assert.deepEqual([h.model.get(B).group, h.model.get(C).group], [g, g], 'shown at once')
	assert.equal(lastSel(h).oneGroup, true, 'the bar hears of the new group')
	const ops = await opsAfter(h, n)
	assert.deepEqual(ops.map((o) => [o.id, o.p.group]), [[A, g], [B, g], [C, g]], 'one batch of three patches')
	// undo: the inverse (the fake server never echoes items, so the model shows the confirmed state again anyway)
	const m = h.tr.calls.length
	h.s.undo()
	assert.deepEqual([h.model.get(A).group, h.model.get(B).group, h.model.get(C).group ?? null], [G, G, null])
	assert.deepEqual(await opsAfter(h, m), [{ o: 'patch', id: A, p: { group: G } }, { o: 'patch', id: B, p: { group: G } }, { o: 'patch', id: C, p: { group: null } }])
	h.s.destroy()
})

test('AK7 blocked: the toast group-blocked with the hint, nothing sent, no undo step; ungroupSelection likewise; nothing in view or frozen', async () => {
	const h = await open({ items: [sticky(A, { z: 'a1' }), sticky(B, { x: 400, z: 'a2', lock: LOCK }), sticky(C, { x: 800, z: 'a3', group: G }), sticky(D, { x: 1200, z: 'a4', group: G, lock: LOCK })] })
	select(h, [A, B])
	const n = h.tr.calls.length
	assert.equal(h.s.groupSelection(), 'blocked')
	assert.deepEqual(h.infos.at(-1), ['Locked items cannot be grouped or ungrouped.', 'group-blocked'])
	select(h, [C])
	assert.equal(h.s.ungroupSelection(), 'blocked')
	assert.deepEqual(h.infos.at(-1), ['Locked items cannot be grouped or ungrouped.', 'group-blocked'])
	assert.deepEqual(await opsAfter(h, n), [])
	assert.equal(h.s.undoStack.canUndo(), false)
	h.s.onStatus('revoked')
	select(h, [A])
	assert.equal(h.s.groupSelection(), 'none', 'frozen')
	h.s.destroy()
})

test('AK7 selectionInfo: the five new fields (0/null/false while the session cannot write); the intents group and ungroup; the menu entries and their reasons', async () => {
	const h = await open({ items: [frame(F, { x: 2000, z: 'a0' }), sticky(A, { z: 'a1', group: G }), sticky(B, { x: 400, z: 'a2', group: G }), sticky(C, { x: 800, z: 'a3' })] })
	select(h, [A, B])
	let sel = lastSel(h)
	assert.deepEqual([sel.groupable, sel.groupBlock, sel.grouped, sel.ungroupBlock, sel.oneGroup], [0, null, 1, null, true], 'round 1: groupable 0, C is exactly the group')
	assert.deepEqual(menuEntries(sel, A).filter((e) => e === 'group' || e === 'ungroup'), ['ungroup'], 'exactly one group: no "Group items"')
	select(h, [A, C, F])
	sel = lastSel(h)
	assert.deepEqual([sel.groupable, sel.groupBlock, sel.grouped, sel.oneGroup], [3, 'frame', 1, false])
	assert.equal(menuBlocked('group', sel), 'Frames cannot be grouped.')
	// Ctrl+G with a frame in the selection: the toast, nothing sent
	h.s.onIntent({ type: 'group' })
	assert.deepEqual(h.infos.at(-1), ['Frames cannot be grouped.', 'group-blocked'])
	// the intents: Ctrl+Shift+G dissolves, Ctrl+G groups again (one step each)
	select(h, [A])
	h.s.onIntent({ type: 'ungroup' })
	assert.deepEqual([h.model.get(A).group, h.model.get(B).group], [null, null])
	assert.deepEqual(h.s.selection, [A], 'after ungrouping the selection stays')
	select(h, [A, B])
	h.s.onIntent({ type: 'group' })
	assert.ok(typeof h.model.get(A).group === 'string' && h.model.get(A).group === h.model.get(B).group)
	assert.equal(h.s.undoStack.done.length, 2)
	// the menu entry runs the same action
	h.s.onIntent({ type: 'contextMenu', id: A, at: [1, 1] })
	assert.equal(h.s.menuAction('ungroup'), true)
	assert.equal(h.model.get(A).group, null)
	h.s.onStatus('revoked')
	select(h, [A, B])
	sel = h.s.selectionInfo()
	assert.deepEqual([sel.groupable, sel.groupBlock, sel.grouped, sel.ungroupBlock, sel.oneGroup], [0, null, 0, null, false], 'frozen: nothing to offer')
	h.s.destroy()
})

test('round 1 (code review 1, UX B1): no dead "Group items" – a member after the second click, and the group a connector was grouped with, offer Ungroup only; Ctrl+G there sends nothing', async () => {
	const h = await open({ items: [sticky(A, { z: 'a1' }), sticky(B, { x: 400, z: 'a2' }), sticky(C, { x: 800, z: 'a3' }), connector(K, { item: A }, { item: B })] })
	// a connected cluster selected by a marquee and grouped: the connector stays in the selection
	select(h, [A, B, K])
	assert.equal(showGroup(lastSel(h)), true)
	assert.equal(h.s.groupSelection(), 'sent')
	assert.deepEqual(h.s.undoStack.done.at(-1).ops.map((o) => o.id), [A, B], 'K is left out')
	assert.deepEqual(h.s.selection, [A, B, K], 'the connector stays selected')
	let sel = lastSel(h)
	assert.deepEqual([sel.groupable, sel.grouped, sel.oneGroup], [0, 1, false], 'not exactly one group (K), but nothing new to group')
	assert.deepEqual([showGroup(sel), showUngroup(sel)], [false, true], 'the button turns to Ungroup')
	assert.deepEqual(menuEntries(sel, A).filter((e) => e === 'group' || e === 'ungroup'), ['ungroup'])
	// the second click on a member: [A]
	select(h, [A])
	sel = lastSel(h)
	assert.deepEqual([sel.groupable, sel.grouped, sel.oneGroup], [0, 1, false])
	assert.deepEqual([showGroup(sel), showUngroup(sel)], [false, true])
	assert.deepEqual(menuEntries(sel, A).filter((e) => e === 'group' || e === 'ungroup'), ['ungroup'])
	const steps = h.s.undoStack.done.length
	const infos = h.infos.length
	assert.equal(h.s.groupSelection(), 'none', 'a member alone: nothing to group')
	h.s.onIntent({ type: 'group' })
	assert.deepEqual([h.s.undoStack.done.length, h.infos.length], [steps, infos], 'Ctrl+G: no step, no toast')
	// a member plus a free note: a new group of three is offered
	select(h, [A, C])
	assert.deepEqual([lastSel(h).groupable, showGroup(lastSel(h))], [3, true])
	h.s.destroy()
})

test('AK7 align and nudge leave a group with a locked member out; lockSelection on a whole group locks every member in one step; a group change reports the selection again', async () => {
	const h = await open({
		items: [
			sticky(A, { x: 0, y: 0, z: 'a1', group: G, lock: LOCK }), sticky(B, { x: 400, y: 0, z: 'a2', group: G }),
			sticky(C, { x: 50, y: 500, z: 'a3' }), sticky(D, { x: 100, y: 900, z: 'a4' }),
		],
	})
	select(h, [A, B, C, D])
	assert.equal(lastSel(h).alignable, 2, 'blocks C and D: the held group drops out')
	let n = h.tr.calls.length
	h.s.align('left')
	let ops = await opsAfter(h, n)
	assert.deepEqual(ops.map((o) => o.id), [D], 'D to C\'s edge; A and B stay')
	select(h, [B, C])
	n = h.tr.calls.length
	h.s.nudge(10, 0)
	ops = await opsAfter(h, n)
	assert.deepEqual(ops.map((o) => o.id), [C], 'a member of a held group selected alone does not move')
	// a whole free group: one lock step for both
	const g2 = '01JG0000000000000000000002'
	const k = await open({ items: [sticky(A, { z: 'a1', group: g2 }), sticky(B, { x: 400, z: 'a2', group: g2 })] })
	select(k, [A, B])
	assert.equal(k.s.lockSelection(), true)
	assert.equal(k.s.undoStack.done.length, 1)
	assert.deepEqual(k.s.undoStack.done[0].ops.map((o) => [o.id, Object.keys(o.p)]), [[A, ['lock']], [B, ['lock']]])
	assert.equal(lastSel(k).ungroupBlock, 'locked')
	// a foreign op dissolves the group: the bar hears of it
	const before = k.ui.selection.length
	k.s.onChanges([{ ...structuredClone(k.model.get(B)), group: null }], [])
	assert.equal(k.ui.selection.length, before + 1)
	assert.equal(lastSel(k).grouped, 0)
	h.s.destroy()
	k.s.destroy()
})
