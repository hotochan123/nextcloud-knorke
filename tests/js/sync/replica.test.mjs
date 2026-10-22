/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemKey } from '../../../src/model/paths.js'
import { BUSY, Replica, isLockPatch, isVoteOp, keyOf, mergePatch, refsOf } from '../../../src/sync/Replica.js'

const ID = (n) => '01JA000000000000000000000' + n
const S1 = ID('1')
const S2 = ID('2')
const S3 = ID('3')
const F = ID('F')

/**
 * @param {string} id item id
 * @param {object} [extra] fields
 * @return {object} WireItem
 */
function item(id, extra = {}) {
	return { id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'i0', parent: null, data: { text: '' }, style: { fill: '#a8d8f8' }, ...extra }
}

/**
 * @param {object} it WireItem
 * @param {boolean} [revive] revive flag
 * @return {object} put op
 */
function putOf(it, revive = false) {
	const { id, t, ...p } = structuredClone(it)
	const op = { o: 'put', id, t, p }
	if (revive) {
		op.revive = true
	}
	return op
}

test('visible = confirmed ⊕ pending ops in order', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1, { x: 10 })], 5)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'hi' } }])
	assert.equal(r.visible(S1).x, 10)
	assert.equal(r.visible(S1).data.text, 'hi')
	// confirmed state stays untouched
	assert.equal(r.confirmed.get(S1).data.text, '')
	// a remote change of another path shows through the own pending op
	r.applyServer([item(S1, { x: 50, data: { text: 'remote' } })], [])
	assert.equal(r.visible(S1).x, 50)
	assert.equal(r.visible(S1).data.text, 'hi')
	// own put of a new item; remove hides an item
	r.addLocal([putOf(item(S2, { x: 7 }))])
	assert.equal(r.visible(S2).x, 7)
	r.addLocal([{ o: 'remove', id: S1 }])
	assert.equal(r.visible(S1), null)
	// visible returns copies
	const v = r.visible(S2)
	v.x = 999
	assert.equal(r.visible(S2).x, 7)
})

test('put on an existing confirmed item: the server state wins (also revive)', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1, { x: 1 })], 1)
	r.addLocal([putOf(item(S1, { x: 99 }), true)])
	assert.equal(r.visible(S1).x, 1)
})

test('ack ok waits until settle; rev null is done at once; failed carries op and code', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1)], 10)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }, { o: 'patch', id: S2, p: { x: 1, y: 1, parent: null } }, putOf(item(S3))])
	const b = r.takeBatch()
	assert.equal(b.ops.length, 3)
	const { ids, failed } = r.ack({ seq: b.seq, rev: 11, res: ['ok', 'gone', 'dup'] })
	assert.deepEqual([...ids].sort(), [S1, S2, S3].sort())
	assert.deepEqual(failed.map((f) => [f.op.id, f.code]), [[S2, 'gone'], [S3, 'dup']])
	assert.equal(r.waitingCount(), 1)
	// still visible while the cursor is below 11
	assert.equal(r.visible(S1).data.text, 'a')
	assert.deepEqual([...r.settle(10)], [])
	assert.deepEqual([...r.settle(11)], [S1])
	assert.equal(r.waitingCount(), 0)
	assert.equal(r.visible(S1).data.text, '')

	// rev null: nothing waits
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'b' } }])
	const b2 = r.takeBatch()
	const res = r.ack({ seq: b2.seq, rev: null, res: ['ok'] })
	assert.equal(res.failed.length, 0)
	assert.equal(r.waitingCount(), 0)
	assert.equal(r.pendingCount(), 0)
})

test('dup/gone/locked/bad/denied/limit are dropped and reported', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1)], 1)
	const codes = ['dup', 'gone', 'locked', 'bad', 'denied', 'limit']
	r.addLocal(codes.map((c, i) => ({ o: 'patch', id: ID(String.fromCharCode(65 + i)), p: { 'data.text': c } })))
	const b = r.takeBatch()
	const { failed } = r.ack({ seq: b.seq, rev: 2, res: codes })
	assert.deepEqual(failed.map((f) => f.code), codes)
	assert.equal(r.pendingCount(), 0)
	assert.equal(r.waitingCount(), 0)
})

test('ack with a foreign seq changes nothing', () => {
	const r = new Replica()
	r.addLocal([putOf(item(S1))])
	const b = r.takeBatch()
	const res = r.ack({ seq: b.seq + 5, rev: 3, res: ['ok'] })
	assert.equal(res.ids.size, 0)
	assert.equal(r.hasInflight(), true)
})

test('network error → identical batch with identical seq; new ops never merge into it', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1)], 1)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'one' } }])
	const b1 = r.takeBatch()
	r.failInflight()
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'two' } }])
	const b2 = r.takeBatch()
	assert.equal(b2.seq, b1.seq)
	assert.deepEqual(b2.ops, b1.ops)
	assert.equal(b2.ops[0].p['data.text'], 'one')
	// the newer op waits in the queue; visible shows it on top
	assert.equal(r.visible(S1).data.text, 'two')
	r.ack({ seq: b2.seq, rev: 2, res: ['ok'] })
	const b3 = r.takeBatch()
	assert.equal(b3.seq, b1.seq + 1)
	assert.equal(b3.ops[0].p['data.text'], 'two')
})

test('413 → splitInflight: first half stays in flight with the same seq, rest back to the front', () => {
	const r = new Replica()
	const ops = [1, 2, 3, 4, 5].map((i) => ({ o: 'patch', id: ID(String(i)), p: { 'data.text': 't' + i } }))
	r.addLocal(ops)
	const b = r.takeBatch()
	r.addLocal([{ o: 'patch', id: ID('9'), p: { 'data.text': 'later' } }])
	assert.equal(r.splitInflight(), true)
	const again = r.takeBatch()
	assert.equal(again.seq, b.seq)
	assert.deepEqual(again.ops.map((o) => o.id), [ID('1'), ID('2'), ID('3')])
	r.ack({ seq: again.seq, rev: 5, res: ['ok', 'ok', 'ok'] })
	const next = r.takeBatch()
	assert.deepEqual(next.ops.map((o) => o.id), [ID('4'), ID('5'), ID('9')])
	// a single op cannot be split
	r.ack({ seq: next.seq, rev: 6, res: ['ok', 'ok', 'ok'] })
	r.addLocal([{ o: 'patch', id: S1, p: { x: 1, y: 1, parent: null } }])
	r.takeBatch()
	assert.equal(r.splitInflight(), false)
})

test('compaction: put + patch folds into the put', () => {
	const r = new Replica()
	r.addLocal([putOf(item(S1))])
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'typed', x: 5, y: 6, parent: null } }], { urgent: false })
	assert.equal(r.queue.length, 1)
	const op = r.queue[0].op
	assert.equal(op.o, 'put')
	assert.equal(op.p.data.text, 'typed')
	assert.equal(op.p.x, 5)
	assert.equal(r.hasUrgent(), true)
})

test('compaction: remove of an unsent put drops both (and every op in between)', () => {
	const r = new Replica()
	r.addLocal([putOf(item(S1))])
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }])
	r.addLocal([{ o: 'remove', id: S1 }])
	assert.equal(r.queue.length, 0)
	assert.equal(r.visible(S1), null)
	assert.equal(r.takeBatch(), null)
})

test('compaction: remove after a put that is already in flight stays a remove', () => {
	const r = new Replica()
	r.addLocal([putOf(item(S1))])
	r.takeBatch()
	r.addLocal([{ o: 'remove', id: S1 }])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['remove'])
})

test('compaction: patch + patch merges (ancestor/descendant aware), patch + remove → remove', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1)], 1)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.a': { b: 1, c: 2 }, x: 1, y: 2, parent: null } }])
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.a.b': 5, 'style.fill': '#ffffff' } }])
	assert.equal(r.queue.length, 1)
	assert.deepEqual(r.queue[0].op.p, { 'data.a': { b: 5, c: 2 }, x: 1, y: 2, parent: null, 'style.fill': '#ffffff' })
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.a': null } }])
	assert.deepEqual(r.queue[0].op.p, { x: 1, y: 2, parent: null, 'style.fill': '#ffffff', 'data.a': null })
	r.addLocal([{ o: 'remove', id: S1 }])
	assert.deepEqual(r.queue.map((e) => e.op), [{ o: 'remove', id: S1 }])
	// a patch after a queued remove has no effect
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'late' } }])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['remove'])
})

test('mergePatch: newer descendant goes into the older ancestor value, newer ancestor replaces descendants', () => {
	assert.deepEqual(mergePatch({ 'data.a': { b: 1 } }, { 'data.a.c.d': 2 }), { 'data.a': { b: 1, c: { d: 2 } } })
	assert.deepEqual(mergePatch({ 'data.a.b': 1, 'data.a.c': 2, 'data.x': 3 }, { 'data.a': { z: 9 } }), { 'data.x': 3, 'data.a': { z: 9 } })
	// deleting the only key of an ancestor value leaves {} (= absent)
	assert.deepEqual(mergePatch({ 'data.a': { b: 1 } }, { 'data.a.b': null }), { 'data.a': {} })
	// ancestor deleted, then a descendant set: the ancestor becomes a map
	assert.deepEqual(mergePatch({ 'data.a': null }, { 'data.a.b': 1 }), { 'data.a': { b: 1 } })
	// same path: the newer value wins
	assert.deepEqual(mergePatch({ x: 1, y: 2, parent: null }, { x: 5, y: 6, parent: F }), { x: 5, y: 6, parent: F })
	// inputs are untouched
	const older = { 'data.a': { b: 1 } }
	mergePatch(older, { 'data.a.b': 2 })
	assert.deepEqual(older, { 'data.a': { b: 1 } })
})

test('takeBatch order: container put first only without an earlier op on the same id', () => {
	const r = new Replica()
	r.addLocal([
		{ o: 'patch', id: S1, p: { x: 1, y: 1, parent: F } },
		putOf(item(F, { t: 'frame', w: 800, h: 600 })),
		{ o: 'patch', id: S2, p: { 'data.text': 'x' } },
	])
	assert.deepEqual(r.takeBatch().ops.map((o) => o.id), [F, S1, S2])

	// an earlier remove of the same frame keeps the put behind it
	const r2 = new Replica()
	r2.loadSnapshot([item(F, { t: 'frame' })], 1)
	r2.queue = [
		{ op: { o: 'patch', id: S1, p: { 'data.text': 'a' } }, urgent: true },
		{ op: { o: 'remove', id: F }, urgent: true },
		{ op: putOf(item(F, { t: 'frame', x: 9 }), true), urgent: true },
	]
	assert.deepEqual(r2.takeBatch().ops.map((o) => [o.o, o.id]), [['patch', S1], ['remove', F], ['put', F]])
})

test('takeBatch order: remove last only without a later reference; per-id order never changes', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1), item(S2), item(F, { t: 'frame' })], 1)
	r.queue = [
		{ op: { o: 'remove', id: S1 }, urgent: true },
		{ op: { o: 'patch', id: S2, p: { 'data.text': 'a' } }, urgent: true },
		{ op: { o: 'remove', id: F }, urgent: true },
		{ op: { o: 'patch', id: S3, p: { x: 1, y: 2, parent: F } }, urgent: true },
	]
	const ops = r.takeBatch().ops
	// remove S1 has no later reference → end; remove F is named as parent later → stays
	assert.deepEqual(ops.map((o) => [o.o, o.id]), [['patch', S2], ['remove', F], ['patch', S3], ['remove', S1]])
})

test('delete + undo in one tick → the item lives (remove + put revive → one patch or nothing)', () => {
	const r = new Replica()
	const s = item(S1, { x: 10, y: 20, data: { text: 'keep me' } })
	r.loadSnapshot([s], 5)
	r.addLocal([{ o: 'remove', id: S1 }])
	assert.equal(r.visible(S1), null)
	r.addLocal([putOf(s, true)])
	assert.equal(r.queue.length, 0, 'identical state: both ops vanish')
	assert.deepEqual(r.visible(S1), s)

	// with a change in between: one patch
	r.addLocal([{ o: 'remove', id: S1 }])
	r.addLocal([putOf({ ...s, x: 99, data: { text: 'changed' } }, true)])
	assert.equal(r.queue.length, 1)
	assert.equal(r.queue[0].op.o, 'patch')
	assert.deepEqual(r.queue[0].op.p, { x: 99, y: 20, parent: null, 'data.text': 'changed' })
	const b = r.takeBatch()
	assert.ok(!b.ops.some((o) => o.o === 'remove'))
	assert.equal(r.visible(S1).x, 99)
})

test('delete + undo when the item only existed as an unsent put: the put stays', () => {
	const r = new Replica()
	const s = item(S1)
	r.addLocal([putOf(s)])
	r.addLocal([{ o: 'remove', id: S1 }])
	assert.equal(r.queue.length, 0)
	r.addLocal([putOf(s, true)])
	assert.deepEqual(r.queue.map((e) => [e.op.o, e.op.revive === true]), [['put', true]])
	assert.deepEqual(r.visible(S1), { ...s, group: null, lock: null }, 'itemFromPut: group and lock null')
})

test('frame delete + undo in one tick: F lives, children hang in F again, no remove of F', () => {
	const r = new Replica()
	const f = item(F, { t: 'frame', x: 100, y: 100, w: 800, h: 600, z: 'a0', data: { title: 'F' }, style: { fill: '#ffffff' } })
	const c1 = item(S1, { x: 10, y: 10, parent: F })
	const c2 = item(S2, { x: 50, y: 60, parent: F })
	r.loadSnapshot([f, c1, c2], 7)
	// delete (actions.deleteItems): free children, then remove F
	r.addLocal([
		{ o: 'patch', id: S1, p: { x: 110, y: 110, parent: null } },
		{ o: 'patch', id: S2, p: { x: 150, y: 160, parent: null } },
		{ o: 'remove', id: F },
	])
	assert.equal(r.visible(F), null)
	assert.equal(r.visible(S1).parent, null)
	// undo: revive F, hang children back
	r.addLocal([
		putOf(f, true),
		{ o: 'patch', id: S1, p: { x: 10, y: 10, parent: F } },
		{ o: 'patch', id: S2, p: { x: 50, y: 60, parent: F } },
	])
	const b = r.takeBatch()
	assert.ok(!b.ops.some((o) => o.o === 'remove'), 'no remove of F in the batch')
	assert.ok(!b.ops.some((o) => o.o === 'put'), 'F needs no put: it never left the server')
	assert.deepEqual(r.visible(F), f)
	assert.equal(r.visible(S1).parent, F)
	assert.equal(r.visible(S2).parent, F)
	for (const op of b.ops) {
		assert.deepEqual(Object.keys(op.p).filter((k) => ['x', 'y', 'parent'].includes(k)).sort(), ['parent', 'x', 'y'])
	}
})

test('resync keeps pending ops and drops acked ones up to the snapshot rev', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1), item(S2)], 3)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'acked' } }])
	const b = r.takeBatch()
	r.ack({ seq: b.seq, rev: 4, res: ['ok'] })
	r.addLocal([{ o: 'patch', id: S2, p: { 'data.text': 'queued' } }])
	const ids = r.loadSnapshot([item(S1, { data: { text: 'acked' } }), item(S3)], 4)
	assert.deepEqual([...ids].sort(), [S1, S2, S3].sort())
	assert.equal(r.waitingCount(), 0)
	assert.equal(r.visible(S1).data.text, 'acked')
	assert.equal(r.visible(S2), null, 'S2 is gone on the server; the queued patch cannot revive it')
	assert.equal(r.hasQueued(), true)
	assert.equal(r.visible(S3).id, S3)
})

test('urgent flags, counts and pendingOps for keepalive', () => {
	const r = new Replica()
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }], { urgent: false })
	assert.equal(r.hasUrgent(), false)
	r.addLocal([{ o: 'patch', id: S2, p: { 'data.text': 'b' } }], { urgent: true })
	assert.equal(r.hasUrgent(), true)
	const b = r.takeBatch(1)
	assert.equal(b.ops.length, 1)
	assert.equal(r.pendingCount(), 2)
	const p = r.pendingOps()
	assert.equal(p.seq, b.seq)
	assert.deepEqual(p.ops.map((o) => o.id), [S1, S2])
	assert.equal(r.pendingCount(), 2, 'pendingOps changes nothing')
})

test('dropQueuedPaths: only queued patches of the item lose the paths; in flight, puts and other paths stay', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1), item(S2)], 1)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'sent' } }])
	const sent = r.takeBatch()
	r.addLocal([
		{ o: 'patch', id: S1, p: { 'data.text': 'queued', 'style.fill': '#ffffff' } },
		{ o: 'patch', id: S2, p: { 'data.text': 'other item' } },
	])
	const ids = r.dropQueuedPaths(S1, ['data.text'])
	assert.deepEqual([...ids], [S1])
	assert.deepEqual(r.inflight.ops, sent.ops, 'the batch on the wire is untouched')
	assert.deepEqual(r.queue.map((e) => e.op), [
		{ o: 'patch', id: S1, p: { 'style.fill': '#ffffff' } },
		{ o: 'patch', id: S2, p: { 'data.text': 'other item' } },
	])
	assert.equal(r.visible(S1).data.text, 'sent', 'the visible state falls back to what is on the wire')
	// a patch left empty goes; descendants of the path go too
	r.addLocal([{ o: 'patch', id: S2, p: { 'data.text': 'x', 'data.text.deep': 'y' } }])
	r.dropQueuedPaths(S2, ['data.text'])
	assert.deepEqual(r.queue.map((e) => e.op.id), [S1])
	// a put keeps its text (an unsent item has no other lease holder)
	const S9 = ID('9')
	r.addLocal([putOf(item(S9, { data: { text: 'new note' } }))])
	assert.equal(r.dropQueuedPaths(S9, ['data.text']).size, 0)
	assert.equal(r.visible(S9).data.text, 'new note')
	assert.equal(r.dropQueuedPaths(S3, ['data.text']).size, 0, 'unknown id: nothing')
})

// ---- compaction barrier (T15): ops a keepalive flush sent may be applied ----

test('barrier: a flushed remove is not folded into a later put revive (undo after tab hide)', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1, { x: 10 })], 5)
	r.addLocal([{ o: 'remove', id: S1 }])
	r.markMaybeSent()
	r.addLocal([putOf(item(S1, { x: 10 }), true)])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['remove', 'put'], 'two queued ops, not compacted')
	assert.equal(r.visible(S1).x, 10)
	const b = r.takeBatch()
	assert.deepEqual(b.ops.map((o) => [o.o, o.id, o.revive ?? false]), [['remove', S1, false], ['put', S1, true]])
})

test('barrier: a text patch is not folded into a flushed put; later ops still compact among themselves', () => {
	const r = new Replica()
	r.addLocal([putOf(item(S2))])
	r.markMaybeSent()
	r.addLocal([{ o: 'patch', id: S2, p: { 'data.text': 'Budget' } }])
	assert.equal(r.queue.length, 2, 'a separate patch')
	assert.equal(r.queue[0].op.p.data.text, '', 'the flushed put is untouched')
	r.addLocal([{ o: 'patch', id: S2, p: { 'data.text': 'Budget 2027' } }])
	assert.equal(r.queue.length, 2, 'patch + patch behind the barrier still merge')
	assert.deepEqual(r.queue[1].op, { o: 'patch', id: S2, p: { 'data.text': 'Budget 2027' } })
	assert.equal(r.visible(S2).data.text, 'Budget 2027')
})

test('barrier: remove of a flushed put drops neither (the server may have the item)', () => {
	const r = new Replica()
	r.addLocal([putOf(item(S2))])
	r.markMaybeSent()
	r.addLocal([{ o: 'remove', id: S2 }])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['put', 'remove'])
	assert.equal(r.visible(S2), null)
	assert.deepEqual(r.takeBatch().ops.map((o) => o.o), ['put', 'remove'], 'per-id order kept')
})

test('barrier: only the given ops are marked; the barrier goes away when they move in flight', () => {
	const r = new Replica()
	r.addLocal([{ o: 'patch', id: S1, p: { x: 1, y: 1, parent: null } }, { o: 'patch', id: S3, p: { 'style.fill': '#ffffff' } }])
	r.markMaybeSent([r.queue[0].op])
	r.addLocal([{ o: 'patch', id: S1, p: { x: 2, y: 2, parent: null } }, { o: 'patch', id: S3, p: { 'style.fill': '#000000' } }])
	assert.equal(r.queue.length, 3, 'S1 appended behind its flushed patch, S3 merged (never sent)')
	assert.deepEqual(r.queue.map((e) => e.op.id), [S1, S3, S1])
	r.takeBatch()
	r.ack({ seq: 1, rev: 9, res: ['ok', 'ok', 'ok'] })
	r.addLocal([{ o: 'patch', id: S1, p: { x: 3, y: 3, parent: null } }])
	r.addLocal([{ o: 'patch', id: S1, p: { x: 4, y: 4, parent: null } }])
	assert.equal(r.queue.length, 1, 'new queue compacts normally')
})

test('U8 hold: a held op stays pending and visible; queued ops on its id or naming it as parent wait, the rest is taken', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1), item(S2), item(F, { t: 'frame' })], 5)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'poison' } }])
	assert.equal(r.takeBatch().ops.length, 1)
	assert.equal(r.holdInflight(), true)
	assert.equal(r.hasInflight(), false)
	assert.equal(r.heldCount(), 1)
	assert.equal(r.pendingCount(), 1)
	assert.equal(r.visible(S1).data.text, 'poison', 'a held op is still shown')
	assert.ok(r.pendingIds().has(S1))
	r.addLocal([
		{ o: 'patch', id: S1, p: { 'style.fill': '#000000' } },
		{ o: 'patch', id: S2, p: { 'style.fill': '#222222' } },
		{ o: 'put', id: S3, t: 'sticky', p: { ...item(S3, { parent: S1 }), id: undefined, t: undefined } },
		{ o: 'patch', id: S3, p: { 'data.text': 'child' } },
	])
	const b = r.takeBatch()
	assert.deepEqual(b.ops.map((op) => op.id), [S2], 'only the op that does not wait behind the held one')
	assert.deepEqual(r.queue.map((e) => e.op.id), [S1, S3], 'waiting ops keep their order (the child text folded into its put)')
	assert.deepEqual(r.pendingOps().ops.map((op) => op.id), [S1, S2, S1, S3], 'held first, then in flight, then queued')
	r.ack({ seq: b.seq, rev: 6, res: ['ok'] })
	const again = r.releaseHeld()
	assert.deepEqual(again.ops.map((op) => op.p), [{ 'data.text': 'poison' }])
	assert.ok(again.seq > b.seq, 'a new seq')
	assert.equal(r.heldCount(), 0)
	assert.equal(r.releaseHeld(), null, 'nothing more held, a batch in flight')
})

test('U8 hold: takeBatch is null when everything waits behind a held op; holdInflight needs exactly one op in flight', () => {
	const r = new Replica()
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }, { o: 'patch', id: S2, p: { 'data.text': 'b' } }])
	r.takeBatch()
	assert.equal(r.holdInflight(), false, 'two ops in flight')
	assert.equal(r.splitInflight({ maybeSent: true }), true)
	assert.equal(r.queue[0].maybeSent, true, 'split after a 500: the returned ops get the compaction barrier')
	assert.equal(r.holdInflight(), true)
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'c' } }])
	assert.deepEqual(r.takeBatch().ops.map((op) => op.id), [S2])
	r.ack({ seq: r.inflight.seq, rev: 3, res: ['ok'] })
	assert.equal(r.takeBatch(), null, 'only an op behind the held one is left')
	assert.equal(r.queue.length, 1)
})

test('U8 withoutDependents: leaves out the blocked ops and everything behind them, transitively', () => {
	const a = { o: 'put', id: F, t: 'frame', p: {} }
	const b = { o: 'put', id: S1, t: 'sticky', p: { parent: F } }
	const c = { o: 'patch', id: S1, p: { 'data.text': 'x' } }
	const d = { o: 'patch', id: S2, p: { 'data.text': 'y' } }
	assert.deepEqual(Replica.withoutDependents([a, b, c, d], [a]), [d])
	assert.deepEqual(Replica.withoutDependents([a, b, c, d], []), [a, b, c, d])
	assert.deepEqual(Replica.withoutDependents([a, b, c, d], [c]), [a, b, d])
})

// ---- SPEC-M1 §6.4: Replica v2 (vote ops, busy, closed; Befund F1) -----------

const vote = (sid, id, n) => ({ o: 'vote', s: sid, id, n })

test('M1 vote ops: key vote:<s>:<id>; the newer one on the same key wins; never compacted with an op on the item itself', () => {
	const r = new Replica()
	r.confirmed.set(S1, item(S1))
	assert.equal(keyOf(vote(12, S1, 2)), 'vote:12:' + S1)
	assert.equal(keyOf({ o: 'patch', id: S1, p: {} }), S1)
	assert.equal(isVoteOp(vote(1, S1, 1)), true)
	const ids = r.addLocal([vote(12, S1, 1), { o: 'patch', id: S1, p: { 'data.text': 'a' } }, vote(12, S1, 3), vote(13, S1, 1), vote(12, S2, 1)])
	assert.deepEqual([...ids], [S1], 'vote ops affect no item: only the patch reports its id')
	assert.deepEqual(r.queue.map((e) => e.op), [
		vote(12, S1, 3),
		{ o: 'patch', id: S1, p: { 'data.text': 'a' } },
		vote(13, S1, 1),
		vote(12, S2, 1),
	], 'set semantics per (session, item): last one wins in place; the patch stays its own op')
	assert.equal(r.visible(S1).data.text, 'a', 'votes never touch the visible item')
	assert.deepEqual([...r.pendingIds()], [S1], 'S2 is not an item of this replica just because a vote names it')
	assert.deepEqual([...r.allIds()], [S1])
	assert.equal(r.visible(S2), null)
	const b = r.takeBatch()
	assert.equal(b.ops.length, 4, 'vote ops ride in the normal batch')
})

test('M1 vote ops behind the compaction barrier are appended, not replaced (T15)', () => {
	const r = new Replica()
	r.addLocal([vote(5, S1, 1)])
	r.markMaybeSent()
	r.addLocal([vote(5, S1, 0)])
	assert.deepEqual(r.queue.map((e) => e.op.n), [1, 0])
})

test('M1 ack: a vote op acked ok is done at once (no rev, never waits for the cursor); closed is reported and dropped', () => {
	const r = new Replica()
	r.confirmed.set(S1, item(S1))
	r.addLocal([{ o: 'patch', id: S1, p: { 'style.fill': '#111111' } }, vote(7, S1, 1), vote(7, S2, 1)])
	const b = r.takeBatch()
	const { ids, failed, busy } = r.ack({ seq: b.seq, rev: 9, res: ['ok', 'ok', 'closed'] })
	assert.equal(busy, false)
	assert.deepEqual([...ids], [S1])
	assert.deepEqual(failed, [{ op: vote(7, S2, 1), code: 'closed' }])
	assert.equal(r.waitingCount(), 1, 'only the item patch waits for rev 9')
	assert.equal(r.pendingCount(), 0)
	assert.equal(r.hasInflight(), false)
})

test('M1 ack: every op busy → nothing dropped, the same batch with the same seq comes back', () => {
	const r = new Replica()
	r.confirmed.set(S1, item(S1))
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }, vote(7, S2, 1)])
	const b = r.takeBatch()
	r.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'y' } }])
	const res = r.ack({ seq: b.seq, rev: null, res: [BUSY, BUSY], retryMs: 3000 })
	assert.deepEqual(res, { ids: new Set(), failed: [], busy: true })
	assert.equal(r.hasInflight(), true)
	const again = r.takeBatch()
	assert.equal(again.seq, b.seq)
	assert.deepEqual(again.ops, b.ops)
	assert.equal(r.visible(S1).data.text, 'y', 'the newer queued text still shows')
	assert.deepEqual(r.ack({ seq: b.seq, rev: 4, res: ['ok', 'ok'] }).busy, false)
	assert.equal(r.hasInflight(), false)
})

test('M1 ack: a mixed answer (not expected) puts the busy ops back to the front of the queue, unchanged', () => {
	const r = new Replica()
	r.confirmed.set(S1, item(S1))
	r.confirmed.set(S2, item(S2))
	r.addLocal([{ o: 'patch', id: S1, p: { x: 5 } }, { o: 'patch', id: S2, p: { x: 6 } }])
	const b = r.takeBatch()
	r.addLocal([{ o: 'patch', id: S3, p: { x: 7 } }])
	const res = r.ack({ seq: b.seq, rev: 3, res: ['ok', BUSY] })
	assert.equal(res.busy, false)
	assert.deepEqual(res.failed, [])
	assert.deepEqual(r.queue.map((e) => e.op.id), [S2, S3])
	assert.equal(r.visible(S2).x, 6)
})

test('M1 (F1) an unknown op kind is dropped with a warning, never silently', () => {
	const r = new Replica()
	const warned = []
	const orig = console.warn
	console.warn = (...a) => warned.push(a)
	try {
		r.addLocal([{ o: 'frobnicate', id: S1 }])
	} finally {
		console.warn = orig
	}
	assert.equal(r.pendingCount(), 0)
	assert.equal(warned.length, 1)
})

test('M1 order: a vote op naming an item never keeps its remove from moving to the end', () => {
	const r = new Replica()
	r.confirmed.set(S1, item(S1))
	r.addLocal([{ o: 'remove', id: S1 }, vote(3, S1, 1), { o: 'patch', id: S2, p: { x: 1 } }])
	const b = r.takeBatch()
	assert.deepEqual(b.ops.map((op) => op.o), ['vote', 'patch', 'remove'])
})

// ---- SPEC-M1 §4.7 rule 15: container keep -----------------------------------------

/**
 * @param {string} id frame id
 * @param {object} [extra] fields
 * @return {object} frame WireItem
 */
function frameItem(id, extra = {}) {
	return { id, t: 'frame', x: 100, y: 100, w: 400, h: 400, r: 0, z: 'a0', parent: null, data: { title: '' }, style: { fill: '#ffffff' }, ...extra }
}

const keepPatch = (x, y) => ({ o: 'patch', id: F, p: { x, y, parent: null, w: 300, h: 300, r: 0 }, keep: true })

test('M1 keep: a pending keep patch of the parent leaves the child at its absolute place, through every stage, never twice', () => {
	const r = new Replica()
	r.loadSnapshot([frameItem(F), item(S1, { x: 50, y: 60, parent: F })], 5)
	r.addLocal([keepPatch(200, 150)])
	assert.equal(r.visible(F).x, 200)
	assert.deepEqual([r.visible(S1).x, r.visible(S1).y], [-50, 10], 'abs (150, 160) unchanged')
	const batch = r.takeBatch()
	assert.deepEqual(batch.ops[0].keep, true, 'the flag goes out with the op')
	assert.equal(r.visible(S1).x, -50, 'in flight')
	r.ack({ seq: batch.seq, rev: 6, res: ['ok'] })
	assert.equal(r.visible(S1).x, -50, 'acked, waiting for the cursor')
	// the server's answer: frame moved, child shifted by the server (same rev)
	r.applyServer([frameItem(F, { x: 200, y: 150, w: 300, h: 300 }), item(S1, { x: -50, y: 10, parent: F })], [])
	assert.deepEqual([r.visible(S1).x, r.visible(S1).y], [-50, 10], 'confirmed already shifted: no second shift')
	r.settle(6)
	assert.deepEqual([r.visible(S1).x, r.visible(S1).y], [-50, 10])
	// a rejected keep patch: the child is back where the server has it
	const r2 = new Replica()
	r2.loadSnapshot([frameItem(F), item(S1, { x: 50, y: 60, parent: F })], 5)
	r2.addLocal([keepPatch(200, 150)])
	const b2 = r2.takeBatch()
	r2.ack({ seq: b2.seq, rev: null, res: ['bad'] })
	assert.equal(r2.visible(S1).x, 50)
})

test('M1 keep: only the parent\'s keep patches after the child\'s own last placement op shift it; a plain frame move never does', () => {
	const own = { o: 'patch', id: S1, p: { x: 10, y: 10, parent: F } }
	const after = new Replica()
	after.loadSnapshot([frameItem(F), item(S1, { x: 50, y: 60, parent: F })], 5)
	after.addLocal([keepPatch(200, 150), own])
	assert.deepEqual([after.visible(S1).x, after.visible(S1).y], [10, 10], 'set after the keep: the server applies it as sent')
	const before = new Replica()
	before.loadSnapshot([frameItem(F), item(S1, { x: 50, y: 60, parent: F })], 5)
	before.addLocal([own, keepPatch(200, 150)])
	assert.deepEqual([before.visible(S1).x, before.visible(S1).y], [-90, -40])
	const plain = new Replica()
	plain.loadSnapshot([frameItem(F), item(S1, { x: 50, y: 60, parent: F })], 5)
	plain.addLocal([{ o: 'patch', id: F, p: { x: 200, y: 150, parent: null } }])
	assert.equal(plain.visible(S1).x, 50, 'children move with a frame without keep')
	// a child released in the same commit is no child any more
	const freed = new Replica()
	freed.loadSnapshot([frameItem(F), item(S1, { x: 50, y: 60, parent: F })], 5)
	freed.addLocal([keepPatch(200, 150), { o: 'patch', id: S1, p: { x: 150, y: 160, parent: null } }])
	assert.deepEqual([freed.visible(S1).x, freed.visible(S1).parent], [150, null])
	// keep on a note (no container): nothing to shift (the server ignores it)
	const note = new Replica()
	note.loadSnapshot([item(S2), item(S1, { x: 50, y: 60, parent: S2 })], 5)
	note.addLocal([{ o: 'patch', id: S2, p: { x: 300, y: 0, parent: null }, keep: true }])
	assert.equal(note.visible(S1).x, 50)
})

test('M1 keep: a keep patch is never compacted with another patch of the same id (the flag belongs to that one move)', () => {
	const r = new Replica()
	r.loadSnapshot([frameItem(F)], 5)
	r.addLocal([{ o: 'patch', id: F, p: { 'data.title': 'a' } }, keepPatch(200, 150), { o: 'patch', id: F, p: { x: 300, y: 150, parent: null } }])
	assert.deepEqual(r.queue.map((e) => [e.op.keep === true, Object.keys(e.op.p).join(',')]), [
		[false, 'data.title'], [true, 'x,y,parent,w,h,r'], [false, 'x,y,parent'],
	])
	r.addLocal([{ o: 'remove', id: F }])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['patch', 'patch', 'remove'], 'remove replaces only the last patch')
	// a keep patch on a new, unsent frame is not folded into its put
	const n = new Replica()
	n.loadSnapshot([], 5)
	n.addLocal([putOf(frameItem(F)), keepPatch(200, 150)])
	assert.deepEqual(n.queue.map((e) => e.op.o), ['put', 'patch'])
})

// ---- SPEC-M1 §4.7 rule 14 (round 1b): connector ends name other items ---------

const C1 = ID('C')
/**
 * @param {string} id connector id
 * @param {object} start data.start
 * @param {object} end data.end
 * @return {object} put op of a connector (placement none, rule 12)
 */
const connPut = (id, start, end) => ({ o: 'put', id, t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, z: 'i9', parent: null, data: { start, end }, style: {} } })

test('M1 refsOf: parent and the items bound connector ends name (put data, patch data.start/data.end, a whole data); never the op itself, free ends or votes', () => {
	assert.deepEqual(refsOf(connPut(C1, { item: S1 }, { item: S2, ax: 1, ay: 0 })), [S1, S2])
	assert.deepEqual(refsOf(connPut(C1, { x: 1, y: 2 }, { item: S2 })), [S2])
	assert.deepEqual(refsOf({ o: 'patch', id: C1, p: { 'data.end': { item: S3 } } }), [S3])
	assert.deepEqual(refsOf({ o: 'patch', id: C1, p: { data: { start: { item: S1 }, end: { x: 0, y: 0 } } } }), [S1])
	assert.deepEqual(refsOf({ o: 'patch', id: S1, p: { x: 1, y: 2, parent: F } }), [F])
	assert.deepEqual(refsOf({ o: 'remove', id: S1 }), [])
	assert.deepEqual(refsOf(vote(1, S1, 2)), [])
})

test('M1 rule 14 + U8 hold: a connector naming a held item waits behind it (the server would answer bad: "never existed"); its later ops too', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1)], 5)
	r.addLocal([putOf(item(S2, { x: 400 }))])
	assert.equal(r.takeBatch().ops.length, 1)
	assert.equal(r.holdInflight(), true, 'the put of S2 is held (repeated 500)')
	r.addLocal([connPut(C1, { item: S1 }, { item: S2 }), { o: 'patch', id: C1, p: { 'style.endCap': 'dot' } }, { o: 'patch', id: S1, p: { 'data.text': 'free' } }])
	const b = r.takeBatch()
	assert.deepEqual(b.ops.map((op) => op.id), [S1], 'only the op that names no held item')
	assert.deepEqual(r.queue.map((e) => e.op.id), [C1])
	assert.deepEqual(Replica.withoutDependents([connPut(C1, { item: S1 }, { item: S2 })], []).length, 1)
	const held = putOf(item(S2))
	assert.deepEqual(Replica.withoutDependents([held, connPut(C1, { item: S1 }, { item: S2 }), { o: 'patch', id: S3, p: { x: 1, y: 1, parent: null } }], [held]).map((op) => op.id), [S3])
})

test('M1 rule 14 order: a remove moves to the end only when no later op names it as a connector end either', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1), item(S2), { id: C1, t: 'connector', ...connPut(C1, { item: S1 }, { x: 0, y: 0 }).p }], 5)
	r.addLocal([
		{ o: 'remove', id: S2 },
		{ o: 'patch', id: C1, p: { 'data.end': { item: S2 } } },
		{ o: 'patch', id: S1, p: { 'data.text': 'x' } },
	])
	assert.deepEqual(r.takeBatch().ops.map((op) => [op.o, op.id]), [['remove', S2], ['patch', C1], ['patch', S1]], 'the remove keeps its place before the op that binds to it')
	const q = new Replica()
	q.loadSnapshot([item(S1), item(S2)], 5)
	q.addLocal([{ o: 'remove', id: S2 }, { o: 'patch', id: S1, p: { 'data.text': 'x' } }])
	assert.deepEqual(q.takeBatch().ops.map((op) => op.o), ['patch', 'remove'], 'unreferenced: still moved to the end')
})

// ---- Job 023 (M2, SPEC-M1 §1.2 "(R20) Sperren"): lock patches -----------------

const LOCK = Object.freeze({ by: 'pidme00000000001', name: 'Alice' })
const lockOp = (id, lock = LOCK) => ({ o: 'patch', id, p: { lock: structuredClone(lock) } })
const unlockOp = (id) => ({ o: 'patch', id, p: { lock: null } })

test('job 023 (AK8): a lock patch is never folded into a queued put, nor merged with a patch before it; later ops come behind it', () => {
	const r = new Replica()
	r.loadSnapshot([], 5)
	r.addLocal([putOf(item(S1)), lockOp(S1)])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['put', 'patch'], '[put X, lock X] stay two ops')
	assert.equal(isLockPatch(r.queue[1].op), true)
	assert.equal(Object.prototype.hasOwnProperty.call(r.queue[0].op.p, 'lock'), false, 'the put carries no lock')
	const m = new Replica()
	m.loadSnapshot([item(S1)], 5)
	m.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }, lockOp(S1), { o: 'patch', id: S1, p: { 'data.text': 'b' } }])
	assert.deepEqual(m.queue.map((e) => Object.keys(e.op.p).join(',')), ['data.text', 'lock', 'data.text'], '[patch, lock, patch] stay three, in this order')
	assert.deepEqual(m.queue.map((e) => e.op.p['data.text'] ?? null), ['a', null, 'b'])
	// a later patch behind the lock patch is still compacted with patches after it
	m.addLocal([{ o: 'patch', id: S1, p: { 'style.fill': '#ffffff' } }])
	assert.equal(m.queue.length, 3)
	assert.deepEqual(Object.keys(m.queue[2].op.p), ['data.text', 'style.fill'])
})

test('job 023 (AK8): a remove after a lock patch does not replace it; a lock patch after a queued remove is dropped', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1)], 5)
	r.addLocal([lockOp(S1), { o: 'remove', id: S1 }])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['patch', 'remove'], '[lock X, remove X] stay two')
	assert.equal(isLockPatch(r.queue[0].op), true)
	r.addLocal([unlockOp(S1)])
	assert.deepEqual(r.queue.map((e) => e.op.o), ['patch', 'remove'], 'a lock patch after a queued remove is dropped like every patch')
	const u = new Replica()
	u.loadSnapshot([item(S1)], 5)
	u.addLocal([lockOp(S1), unlockOp(S1)])
	assert.deepEqual(u.queue.map((e) => e.op.p.lock), [LOCK, null], 'lock and unlock stay two ops')
	assert.equal(u.takeBatch().ops.length, 2)
})

test('job 023 (AK8): visible(X).lock is the sent map after the lock patch, null after {lock: null}; the optimistic itemKey equals the server echo', () => {
	const r = new Replica()
	r.loadSnapshot([item(S1, { group: null, lock: null })], 5)
	r.addLocal([lockOp(S1)])
	assert.deepEqual(r.visible(S1).lock, LOCK)
	assert.deepEqual(Object.keys(r.visible(S1).lock), ['by', 'name'])
	const echo = item(S1, { group: null, lock: { by: LOCK.by, name: LOCK.name } })
	assert.equal(itemKey(r.visible(S1)), itemKey(echo), 'the same itemKey as the server echo: nothing twitches')
	r.addLocal([unlockOp(S1)])
	assert.equal(r.visible(S1).lock, null)
	// the server echo replaces the confirmed state; the own ops stay on top until acked
	r.applyServer([echo], [])
	assert.equal(r.visible(S1).lock, null)
})

// ---- Job 026 (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): the group path ----------

test('job 026 (AK5): [put X, patch X {group: G}] folds into ONE put with p.group G, and visible(X).group === G', () => {
	const r = new Replica()
	r.loadSnapshot([], 5)
	const g = '01JG0000000000000000000001'
	r.addLocal([putOf(item(S1))])
	r.addLocal([{ o: 'patch', id: S1, p: { group: g } }])
	assert.equal(r.queue.length, 1)
	assert.equal(r.queue[0].op.o, 'put')
	assert.equal(r.queue[0].op.p.group, g, 'the server takes p.group')
	assert.equal(r.visible(S1).group, g)
	const b = r.takeBatch()
	assert.deepEqual(b.ops.map((o) => [o.o, o.p.group]), [['put', g]])
})

test('job 026 (AK5): remove + revive with another group compacts to a patch that carries group (diffPatch)', () => {
	const r = new Replica()
	const g = '01JG0000000000000000000001'
	const h = '01JG0000000000000000000002'
	const s = item(S1, { group: g })
	r.loadSnapshot([s], 5)
	r.addLocal([{ o: 'remove', id: S1 }])
	r.addLocal([putOf({ ...s, group: h }, true)])
	assert.deepEqual(r.queue.map((e) => e.op), [{ o: 'patch', id: S1, p: { group: h } }])
	assert.equal(r.visible(S1).group, h)
	// the same group again: nothing left to send (the item is back as it was)
	const r2 = new Replica()
	r2.loadSnapshot([s], 5)
	r2.addLocal([{ o: 'remove', id: S1 }])
	r2.addLocal([putOf(s, true)])
	assert.equal(r2.queue.length, 0)
	assert.equal(r2.visible(S1).group, g)
	// a patch of the group beside another path merges like any root path
	r2.addLocal([{ o: 'patch', id: S1, p: { group: null } }])
	r2.addLocal([{ o: 'patch', id: S1, p: { w: 300 } }])
	assert.deepEqual(r2.queue.map((e) => e.op.p), [{ group: null, w: 300 }])
	assert.equal(r2.visible(S1).group, null)
})
