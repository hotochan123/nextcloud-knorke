/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 155: undo and redo keep other people's changes (AK1–AK5). Alice (the
 * owner, a moderator: no exception for her) works against a small LWW
 * server that applies and echoes her ops; bob() changes items on that
 * server and a sync brings them to her (onChanges). Undo and redo send only
 * the parts nobody else changed since the step, per part; the toast
 * undo-changed counts the items skipped. Also the pure parts of undo.js
 * (decide, partOf, planHistory). Job 167 (AK1–AK5, at the end): the undo of
 * a create removes the item unless someone else changed its text. Job 176
 * (AK1–AK6, at the end): the redo of a delete follows that rule; a table's
 * text is its cells.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { decide, partOf, planHistory } from '../../../src/board/undo.js'
import { applyPatch, itemFromPut, itemKey } from '../../../src/model/paths.js'
import { orderedCols, orderedRows } from '../../../src/model/table.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, RoutedModel, connector, fakeTextHeight, frame, memoryStorage, sticky, textItem } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const N = ID('N1')
const T = ID('T1')
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const CHANGED = (k) => [k === 1 ? '1 item was skipped because someone else changed it.' : `${k} items were skipped because someone else changed them.`, 'undo-changed']
/** (job 148) The connect options of a click on "+" with the default connector tool. */
const CONNECT = Object.freeze({ route: 'straight', endCap: 'arrow' })

/**
 * LWW server of the test: applies ops like §4.6 (put on a live id dup, on a
 * tombstone gone unless revive; patch and remove on a missing id gone) and
 * answers with every item changed since the request's cursor.
 *
 * @param {object[]} items WireItems
 * @return {object} server
 */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) {
				return 'dup'
			}
			if (srv.dead.has(op.id) && op.revive !== true) {
				return 'gone'
			}
			srv.live.set(op.id, itemFromPut(op))
			srv.dead.delete(op.id)
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) {
				return 'gone'
			}
			applyPatch(it, structuredClone(op.p))
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) {
				return 'gone'
			}
			srv.live.delete(op.id)
			srv.dead.add(op.id)
		} else {
			return 'bad'
		}
		srv.rev++
		srv.changed.push([srv.rev, op.id])
		return 'ok'
	}
	srv.apply = (ops) => ops.map(apply)
	srv.since = (rev) => {
		const ids = new Set(srv.changed.filter(([r]) => r > rev).map(([, id]) => id))
		return {
			items: [...ids].filter((id) => srv.live.has(id)).map((id) => structuredClone(srv.live.get(id))),
			removed: [...ids].filter((id) => !srv.live.has(id)),
		}
	}
	return srv
}

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ items = [sticky(A, { x: 0, y: 0, z: 'a1' }), sticky(B, { x: 400, y: 0, z: 'a2' }), sticky(C, { x: 800, y: 0, z: 'a3' })], me = ALICE } = {}) {
	const clock = new FakeClock(10000)
	const ui = { undo: [] }
	const toasts = []
	const infos = []
	const srv = lwwServer(items)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta: {} }, me, items: [...srv.live.values()].map((it) => structuredClone(it)) }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				srv.apply(body.ops ?? [])
				return {}
			}
			tr.calls.push(structuredClone(body))
			const res = body.ops ? srv.apply(body.ops) : null
			const out = { rev: srv.rev, ...srv.since(body.since), presence: {} }
			if (res) {
				out.acks = { seq: body.seq, rev: srv.rev, res }
			}
			return out
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: { onUndoState: (x) => ui.undo.push(x) },
		deps: {
			SceneModel: RoutedModel,
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
	return { s, clock, tr, srv, ui, toasts, infos, scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
/** Bob writes ops on the server; a sync brings them to Alice. */
function bob(h, ops) {
	const before = h.srv.rev
	assert.ok(h.srv.apply(ops).every((x) => x === 'ok'), 'Bob\'s ops apply')
	const { items, removed } = h.srv.since(before)
	h.s.onChanges(items, removed)
}
const at = (h, id) => [h.srv.live.get(id)?.x, h.srv.live.get(id)?.y]
const move = (h, ids, dx, dy) => h.scene.callbacks.onIntent({ type: 'move', ids, dx, dy, origin: new Map(ids.map((id) => [id, { x: h.model.get(id).x, y: h.model.get(id).y, parent: h.model.get(id).parent ?? null }])) })
/** Alice makes a note N with text (creation and first text: one step) and closes its editor. */
function createNote(h, text) {
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 3000, y: 3000 }, rect: null })
	const id = h.scene.selection[0]
	h.scene.callbacks.onEditing(id, false)
	h.scene.callbacks.onIntent({ type: 'text', id, path: 'data.text', value: text, before: '', final: true })
	h.scene.callbacks.onEditing(null, false)
	return id
}

test('the pure decision: equal to the target → nothing, equal to the expected value → it goes out, else skipped', () => {
	assert.equal(decide('a', 'b', 'a'), 'same')
	assert.equal(decide('b', 'b', 'a'), 'send')
	assert.equal(decide('c', 'b', 'a'), 'changed')
	assert.equal(decide('a', 'a', 'a'), 'same', 'the target wins when both are equal')
	assert.deepEqual(['x', 'y', 'parent', 'w', 'h', 'r', 'z', 'lock', 'data.start', 'style.fill'].map((p) => partOf(p, false)),
		['place', 'place', 'place', 'size', 'size', 'r', 'z', 'lock', 'data.start', 'style.fill'])
	assert.equal(partOf('h', true), null, 'a text item\'s h is no part of its own')
	assert.equal(partOf('w', true), 'size')
})

test('planHistory: per part against the visible state, canonical (empty = absent, key order), a lock only by its locker; the step trimmed to what goes out', () => {
	const now = new Map([[A, sticky(A, { x: 50, style: { fill: '#ffffff' }, data: { extra: { b: 2, a: 1 } } })]])
	const step = {
		ops: [{ o: 'patch', id: A, p: { x: 50, y: 0, parent: null, 'style.fill': '#a8d8f8', 'data.extra': { a: 1, b: 2, c: null }, 'data.text': null } }],
		inverse: [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null, 'style.fill': '#000000', 'data.extra': null, 'data.text': 'x' } }],
	}
	const plan = planHistory(step, 'undo', { visible: (id) => now.get(id) ?? null })
	assert.deepEqual(plan.send, [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null, 'data.extra': null, 'data.text': 'x' } }],
		'the placement, data.extra (key order, null entries) and data.text (absent = null) go out; the fill changed')
	assert.deepEqual(plan.changed, [A])
	assert.deepEqual(plan.step, { ops: [{ o: 'patch', id: A, p: { x: 50, y: 0, parent: null, 'data.extra': { a: 1, b: 2, c: null }, 'data.text': null } }], inverse: plan.send })
	// a lock compares only its locker: another name of the same pid is the same lock
	const locked = new Map([[A, sticky(A, { lock: { by: 'pidcarol', name: 'Carol C.' } })]])
	const unlock = { ops: [{ o: 'patch', id: A, p: { lock: null } }], inverse: [{ o: 'patch', id: A, p: { lock: { by: 'pidcarol', name: 'Carol' } }, restore: true }] }
	assert.deepEqual(planHistory(unlock, 'undo', { visible: (id) => locked.get(id) }).send, [], 'Carol holds it again: nothing to do')
	assert.deepEqual(planHistory(unlock, 'redo', { visible: (id) => locked.get(id) }).send, [{ o: 'patch', id: A, p: { lock: null } }])
	// the input step stays as it was
	assert.equal(step.inverse[0].p['style.fill'], '#000000')
})

test('AK1: Alice moves A, a sync brings A with Bob\'s colour and her placement – undo sends exactly one {x, y, parent} patch with the old placement, no style.fill, no notice; redo exactly the new placement; the echo of her own step changes nothing', async () => {
	const h = await open()
	let n = h.tr.calls.length
	move(h, [A], 100, 50)
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { x: 100, y: 50, parent: null } }])
	// the echo of her own step (the same values), once more
	h.s.onChanges([structuredClone(h.srv.live.get(A))], [])
	bob(h, [{ o: 'patch', id: A, p: { 'style.fill': '#ffd6a5' } }])
	assert.equal(h.model.get(A).style.fill, '#ffd6a5', 'Bob\'s colour arrived')
	n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } }])
	assert.deepEqual(h.infos, [], 'no notice')
	assert.deepEqual([...at(h, A), h.srv.live.get(A).style.fill], [0, 0, '#ffd6a5'], 'back at the old place with Bob\'s colour')
	n = h.tr.calls.length
	h.s.redo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { x: 100, y: 50, parent: null } }])
	assert.deepEqual([...at(h, A), h.srv.live.get(A).style.fill], [100, 50, '#ffd6a5'])
	assert.deepEqual(h.infos, [])
	assert.equal(h.s.undoStack.canUndo(), true)
	h.s.destroy()
})

test('AK2: one step moves A and B, then Bob moves B – undo sends only A\'s placement with the notice 1; Bob then moves A too – redo sends nothing, the same notice, canUndo and canRedo false', async () => {
	const h = await open()
	let n = h.tr.calls.length
	move(h, [A, B], 100, 0)
	assert.equal((await opsAfter(h, n)).length, 2)
	bob(h, [{ o: 'patch', id: B, p: { x: 900, y: 900, parent: null } }])
	n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } }], 'only A')
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.deepEqual([at(h, A), at(h, B)], [[0, 0], [900, 900]], 'B stays where Bob put it')
	assert.equal(h.s.undoStack.canRedo(), true)
	bob(h, [{ o: 'patch', id: A, p: { x: 5, y: 5, parent: null } }])
	n = h.tr.calls.length
	h.s.redo()
	assert.deepEqual(await opsAfter(h, n), [], 'redo sends nothing')
	assert.deepEqual(h.infos, [CHANGED(1), CHANGED(1)])
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, false])
	assert.deepEqual(h.ui.undo.at(-1), { canUndo: false, canRedo: false })
	h.s.destroy()
})

test('AK2: Bob sets a colour back to exactly Alice\'s old value – undo sends nothing for it and shows no notice; the step vanishes', async () => {
	const h = await open()
	h.scene.callbacks.onSelection([A])
	let n = h.tr.calls.length
	h.s.setStyle('style.fill', '#ffd6a5')
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { 'style.fill': '#ffd6a5' } }])
	bob(h, [{ o: 'patch', id: A, p: { 'style.fill': '#a8d8f8' } }])
	n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [])
	assert.deepEqual(h.infos, [])
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, false])
	h.s.destroy()
})

test('AK3: Alice creates N with text (one step), Bob changes the text – undo sends neither a remove nor a text patch for N, notice 1; N keeps Bob\'s text', async () => {
	const h = await open()
	const id = createNote(h, 'Idea')
	assert.equal(h.s.undoStack.done.length, 1, 'creation and text: one step')
	await opsAfter(h, 0)
	assert.equal(h.srv.live.get(id).data.text, 'Idea')
	bob(h, [{ o: 'patch', id, p: { 'data.text': 'Idea, said Bob' } }])
	const n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [])
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.equal(h.model.get(id).data.text, 'Idea, said Bob')
	assert.equal(h.srv.live.get(id).data.text, 'Idea, said Bob')
	h.s.destroy()
})

test('AK3: N unchanged → undo removes it as before; Bob already deleted N → nothing goes out, no notice', async () => {
	const h = await open()
	const id = createNote(h, 'Idea')
	await opsAfter(h, 0)
	let n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'remove', id }])
	assert.equal(h.srv.live.has(id), false)
	assert.deepEqual(h.infos, [])
	h.s.destroy()
	const g = await open()
	const gid = createNote(g, 'Idea')
	await opsAfter(g, 0)
	bob(g, [{ o: 'remove', id: gid }])
	n = g.tr.calls.length
	g.s.undo()
	assert.deepEqual(await opsAfter(g, n), [])
	assert.deepEqual(g.infos, [])
	assert.deepEqual([g.s.undoStack.canUndo(), g.s.undoStack.canRedo()], [false, false], 'nothing went out: the step vanishes')
	g.s.destroy()
})

test('AK3 (job 148): a neighbour N with its connector C, Bob writes in N – undo removes C, N stays, notice 1', async () => {
	const h = await open()
	// below A: B lies 200 right of A, where a click on plus-r connects to it (job 162)
	h.scene.callbacks.onIntent({ type: 'neighbour', id: A, side: 'b', connect: CONNECT })
	const nid = h.scene.selection[0]
	const cid = h.model.ids().find((id) => h.model.get(id).t === 'connector')
	assert.ok(nid && cid)
	assert.equal(h.s.undoStack.done.length, 1, 'one step')
	await opsAfter(h, 0)
	assert.deepEqual([h.srv.live.has(nid), h.srv.live.has(cid)], [true, true])
	bob(h, [{ o: 'patch', id: nid, p: { 'data.text': 'Bob' } }])
	const n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'remove', id: cid }])
	assert.deepEqual([h.srv.live.has(nid), h.srv.live.has(cid)], [true, false])
	assert.deepEqual(h.infos, [CHANGED(1)])
	h.s.destroy()
})

test('AK3: a frame drawn around notes adopts them, Bob changes its title – undo keeps the frame and sends no placement for the notes', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'create', t: 'frame', at: { x: 0, y: 0 }, rect: { x: -50, y: -50, w: 700, h: 300 } })
	const fid = h.scene.selection[0]
	h.scene.callbacks.onEditing(fid, false)
	h.scene.callbacks.onEditing(null, false)
	assert.deepEqual([h.model.get(A).parent, h.model.get(B).parent, h.model.get(C).parent ?? null], [fid, fid, null], 'A and B adopted')
	assert.equal(h.s.undoStack.done.length, 1)
	await opsAfter(h, 0)
	bob(h, [{ o: 'patch', id: fid, p: { 'data.title': 'Bob\'s frame' } }])
	const n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [], 'no remove of the frame, no placement of the notes')
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.deepEqual([h.srv.live.get(A).parent, h.srv.live.get(B).parent, h.srv.live.has(fid)], [fid, fid, true], 'the notes stay in the frame')
	h.s.destroy()
})

test('AK4: Alice deletes N with the connector C bound to it – undo revives N and binds C as before; Bob then writes in N – redo sends neither a remove of N nor a patch of C, notice 1; without Bob redo deletes as before', async () => {
	const board = () => [sticky(A, { x: 0, y: 0, z: 'a1' }), sticky(N, { x: 600, y: 0, z: 'a2', data: { text: 'N' } }), connector(C, { item: A }, { item: N })]
	const steps = async (h) => {
		h.scene.callbacks.onIntent({ type: 'delete', ids: [N] })
		const del = await opsAfter(h, 0)
		assert.deepEqual(del.map((o) => [o.o, o.id]), [['patch', C], ['remove', N]], 'C lets go of N, then N goes')
		const n = h.tr.calls.length
		h.s.undo()
		const back = await opsAfter(h, n)
		assert.deepEqual(back.map((o) => [o.o, o.id, o.revive ?? null]), [['put', N, true], ['patch', C, null]])
		assert.deepEqual(back[1].p, { 'data.end': { item: N } }, 'C bound to N again')
		assert.deepEqual([h.srv.live.has(N), h.srv.live.get(C).data.end], [true, { item: N }])
		return del
	}
	const h = await open({ items: board() })
	await steps(h)
	bob(h, [{ o: 'patch', id: N, p: { 'data.text': 'N, said Bob' } }])
	let n = h.tr.calls.length
	h.s.redo()
	assert.deepEqual(await opsAfter(h, n), [], 'neither remove N nor a patch of C')
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.deepEqual([h.srv.live.get(N)?.data.text, h.srv.live.get(C).data.end], ['N, said Bob', { item: N }], 'N stays, C stays docked')
	h.s.destroy()
	const g = await open({ items: board() })
	const del = await steps(g)
	n = g.tr.calls.length
	g.s.redo()
	assert.deepEqual(await opsAfter(g, n), del, 'redo deletes as before')
	assert.equal(g.srv.live.has(N), false)
	assert.deepEqual(g.infos, [])
	g.s.destroy()
})

test('AK5: Alice changes the text of text item T, Bob changes its width – undo sends the old text and h = fakeTextHeight of the state with the old text and Bob\'s width, no w', async () => {
	const old = 'an old text that wraps'
	const h = await open({ items: [textItem(T, { x: 0, y: 0, z: 'a1', w: 600, data: { text: old } })] })
	h.scene.callbacks.onEditing(T, false)
	h.scene.callbacks.onIntent({ type: 'text', id: T, path: 'data.text', value: 'new', before: old, final: true })
	h.scene.callbacks.onEditing(null, false)
	await opsAfter(h, 0)
	assert.equal(h.srv.live.get(T).data.text, 'new')
	bob(h, [{ o: 'patch', id: T, p: { w: 120, h: 28.8 } }])
	const state = structuredClone(h.srv.live.get(T))
	state.data.text = old
	const want = Math.round(fakeTextHeight(state) * 100) / 100
	assert.ok(want > 28.8, 'the old text wraps at Bob\'s width')
	const n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: T, p: { 'data.text': old, h: want } }])
	assert.deepEqual([h.srv.live.get(T).w, h.srv.live.get(T).h], [120, want], 'Bob\'s width stays')
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('AK5: without a measurement the stored target height goes out; a step of only h on a text item sends nothing', async () => {
	const old = 'an old text that wraps'
	const h = await open({ items: [textItem(T, { x: 0, y: 0, z: 'a1', w: 600, h: 28.8, data: { text: old } })] })
	h.scene.callbacks.onEditing(T, false)
	h.scene.callbacks.onIntent({ type: 'text', id: T, path: 'data.text', value: 'new', before: old, final: true })
	h.scene.callbacks.onEditing(null, false)
	await opsAfter(h, 0)
	bob(h, [{ o: 'patch', id: T, p: { w: 120, h: 28.8 } }])
	h.scene.measureTextHeight = () => null
	let n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: T, p: { 'data.text': old, h: 28.8 } }], 'the stored h of the inverse')
	h.s.destroy()
	const step = { ops: [{ o: 'patch', id: T, p: { h: 60 } }], inverse: [{ o: 'patch', id: T, p: { h: 28.8 } }] }
	const plan = planHistory(step, 'undo', { visible: () => textItem(T, { h: 60 }), measure: () => 99 })
	assert.deepEqual([plan.send, plan.step, plan.changed], [[], null, []])
})

/*
 * Job 167: the undo of a create removes the item unless someone else changed
 * its text; the redo stack then carries one put of the state right before
 * the undo.
 */
const LOCK_UNDO = ['1 locked item was skipped.', 'lock-undo']
/** (job 167) The undo of the top step sends these ops. */
const undoOps = async (h) => {
	const n = h.tr.calls.length
	h.s.undo()
	return opsAfter(h, n)
}
/** (job 167) The redo of the top step sends these ops. */
const redoOps = async (h) => {
	const n = h.tr.calls.length
	h.s.redo()
	return opsAfter(h, n)
}

for (const [what, p] of [
	['its placement {x, y}', { x: 3500, y: 3200 }],
	['its size {w, h}', { w: 320, h: 260 }],
	['its rotation {r}', { r: 30 }],
	['its colour style.fill', { 'style.fill': '#ffd6a5' }],
	['all of these at once', { x: 3500, y: 3200, w: 320, h: 260, r: 30, 'style.fill': '#ffd6a5' }],
]) {
	test(`job 167 AK1: Alice creates N with text, Bob changes ${what} – undo sends exactly the remove of N, no notice; N is gone on the server`, async () => {
		const h = await open()
		const id = createNote(h, 'Idea')
		await opsAfter(h, 0)
		bob(h, [{ o: 'patch', id, p }])
		assert.deepEqual(await undoOps(h), [{ o: 'remove', id }])
		assert.deepEqual(h.infos, [])
		assert.equal(h.srv.live.has(id), false)
		h.s.destroy()
	})
}

test('job 167 AK2: the text decides – Bob moves N and changes its text: undo sends nothing, notice 1, N keeps Bob\'s text at Bob\'s place; Bob\'s text set back to Alice\'s exactly, then a move: undo removes N without a notice', async () => {
	const h = await open()
	const id = createNote(h, 'Idea')
	await opsAfter(h, 0)
	bob(h, [{ o: 'patch', id, p: { x: 3500, y: 3200, 'data.text': 'Idea, said Bob' } }])
	assert.deepEqual(await undoOps(h), [])
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.deepEqual([...at(h, id), h.srv.live.get(id).data.text], [3500, 3200, 'Idea, said Bob'])
	h.s.destroy()
	const g = await open()
	const gid = createNote(g, 'Idea')
	await opsAfter(g, 0)
	bob(g, [{ o: 'patch', id: gid, p: { 'data.text': 'Something else' } }])
	bob(g, [{ o: 'patch', id: gid, p: { 'data.text': 'Idea' } }])
	bob(g, [{ o: 'patch', id: gid, p: { x: 3500, y: 3200 } }])
	assert.deepEqual(await undoOps(g), [{ o: 'remove', id: gid }])
	assert.deepEqual(g.infos, [])
	assert.equal(g.srv.live.has(gid), false)
	g.s.destroy()
})

/**
 * (job 148) Alice adds a neighbour N below A with its connector C (one step).
 *
 * @param {object} h harness
 * @return {Promise<{nid: string, cid: string}>} the new items
 */
async function neighbour(h) {
	h.scene.callbacks.onIntent({ type: 'neighbour', id: A, side: 'b', connect: CONNECT })
	const nid = h.scene.selection[0]
	const cid = h.model.ids().find((id) => h.model.get(id).t === 'connector')
	assert.ok(nid && cid)
	assert.equal(h.s.undoStack.done.length, 1, 'one step')
	await opsAfter(h, 0)
	return { nid, cid }
}

test('job 167 AK2 (job 148): a neighbour N with its connector C, Bob gives C a label – undo removes N, C stays, notice 1', async () => {
	const h = await open()
	const { nid, cid } = await neighbour(h)
	bob(h, [{ o: 'patch', id: cid, p: { 'data.label': 'because' } }])
	assert.deepEqual(await undoOps(h), [{ o: 'remove', id: nid }])
	assert.deepEqual([h.srv.live.has(nid), h.srv.live.has(cid)], [false, true])
	assert.equal(h.srv.live.get(cid).data.label, 'because')
	assert.deepEqual(h.infos, [CHANGED(1)])
	h.s.destroy()
})

test('job 167 AK3: Bob moves and recolours N, Alice undoes – redo sends exactly one revive put with Bob\'s x, y, fill and Alice\'s text; the server then holds the state right before the undo; a further undo removes N again without a notice', async () => {
	const h = await open()
	const id = createNote(h, 'Idea')
	await opsAfter(h, 0)
	bob(h, [{ o: 'patch', id, p: { x: 3500, y: 3200, 'style.fill': '#ffd6a5' } }])
	const before = itemKey(h.srv.live.get(id))
	assert.deepEqual(await undoOps(h), [{ o: 'remove', id }])
	assert.equal(h.srv.live.has(id), false)
	const ops = await redoOps(h)
	assert.equal(ops.length, 1, 'exactly one op')
	assert.deepEqual([ops[0].o, ops[0].id, ops[0].revive], ['put', id, true])
	assert.deepEqual([ops[0].p.x, ops[0].p.y, ops[0].p.style.fill, ops[0].p.data.text], [3500, 3200, '#ffd6a5', 'Idea'])
	assert.equal(itemKey(h.srv.live.get(id)), before, 'back as it was right before the undo')
	assert.deepEqual(await undoOps(h), [{ o: 'remove', id }])
	assert.equal(h.srv.live.has(id), false)
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 167 AK3: N unchanged before the undo – the redo stack holds the step as before job 167, and redo sends what the creation sent (its put with revive)', async () => {
	const h = await open()
	const id = createNote(h, 'Idea')
	const created = await opsAfter(h, 0)
	const step = structuredClone(h.s.undoStack.done[0].ops)
	assert.ok(step.length > 1, 'the put and the text patch')
	assert.deepEqual(await undoOps(h), [{ o: 'remove', id }])
	assert.deepEqual(h.s.undoStack.undone[0].ops, step, 'the step\'s own ops, no put of the visible state')
	assert.deepEqual(await redoOps(h), created.map((op) => (op.o === 'put' ? { ...op, revive: true } : op)))
	assert.equal(h.srv.live.get(id).data.text, 'Idea')
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 167 AK4: a frame F drawn around A and B adopts them, Bob moves F – undo removes F and sends A\'s and B\'s old placement at the root, no notice', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'create', t: 'frame', at: { x: 0, y: 0 }, rect: { x: -50, y: -50, w: 700, h: 300 } })
	const fid = h.scene.selection[0]
	h.scene.callbacks.onEditing(fid, false)
	h.scene.callbacks.onEditing(null, false)
	assert.deepEqual([h.model.get(A).parent, h.model.get(B).parent], [fid, fid], 'A and B adopted')
	await opsAfter(h, 0)
	bob(h, [{ o: 'patch', id: fid, p: { x: 1000, y: 1000 } }])
	const ops = await undoOps(h)
	const by = (id) => ops.filter((op) => op.id === id)
	assert.deepEqual(by(fid), [{ o: 'remove', id: fid }])
	assert.deepEqual(by(A), [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } }])
	assert.deepEqual(by(B), [{ o: 'patch', id: B, p: { x: 400, y: 0, parent: null } }])
	assert.equal(ops.length, 3)
	assert.equal(h.srv.live.has(fid), false)
	assert.deepEqual([...at(h, A), h.srv.live.get(A).parent, ...at(h, B), h.srv.live.get(B).parent], [0, 0, null, 400, 0, null])
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 167 AK4 (job 148): a neighbour N with its connector C, Bob moves N – undo sends a remove for N and one for C, no notice', async () => {
	const h = await open()
	const { nid, cid } = await neighbour(h)
	bob(h, [{ o: 'patch', id: nid, p: { x: 1000, y: 1000 } }])
	const ops = await undoOps(h)
	assert.deepEqual(ops.map((op) => op.o + ' ' + op.id).sort(), ['remove ' + cid, 'remove ' + nid].sort())
	assert.deepEqual([h.srv.live.has(nid), h.srv.live.has(cid)], [false, false])
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 167 AK5: what stays – Alice deletes N, undo revives it, Bob moves N: redo removes N without a notice (job 176); Carol locks Alice\'s new N: undo sends nothing, lock-undo 1, no undo-changed', async () => {
	const h = await open({ items: [sticky(N, { x: 600, y: 0, z: 'a2', data: { text: 'N' } })] })
	h.scene.callbacks.onIntent({ type: 'delete', ids: [N] })
	await opsAfter(h, 0)
	assert.deepEqual((await undoOps(h)).map((op) => [op.o, op.id, op.revive ?? null]), [['put', N, true]])
	bob(h, [{ o: 'patch', id: N, p: { x: 900, y: 900 } }])
	assert.deepEqual(await redoOps(h), [{ o: 'remove', id: N }])
	assert.deepEqual(h.infos, [])
	assert.equal(h.srv.live.has(N), false, 'the redo removes N although Bob moved it')
	h.s.destroy()
	const g = await open()
	const id = createNote(g, 'Idea')
	await opsAfter(g, 0)
	bob(g, [{ o: 'patch', id, p: { lock: { by: 'pidcarol00000001', name: 'Carol' } } }])
	assert.deepEqual(await undoOps(g), [])
	assert.deepEqual(g.infos, [LOCK_UNDO])
	assert.equal(g.srv.live.has(id), true)
	g.s.destroy()
})

test('job 167 planHistory: undo of a create compares only the text of its type (empty = absent); the trimmed step carries one put of the visible state at the place of the item\'s first op; redo of a delete follows the same rule (job 176)', () => {
	const F = ID('F1')
	const made = { id: F, t: 'frame', x: 0, y: 0, w: 700, h: 300, r: 0, z: 'a0', parent: null, data: {}, style: {}, group: null, lock: null }
	const step = {
		ops: [{ o: 'put', id: F, t: 'frame', p: { x: 0, y: 0, w: 700, h: 300, z: 'a0', data: {}, style: {} } }, { o: 'patch', id: A, p: { x: 50, y: 50, parent: F } }, { o: 'patch', id: F, p: { 'data.title': '' } }],
		inverse: [{ o: 'patch', id: F, p: { 'data.title': null } }, { o: 'patch', id: A, p: { x: 0, y: 0, parent: null } }, { o: 'remove', id: F }],
	}
	const moved = { ...made, x: 900, y: 900, style: { fill: '#ffd6a5' }, group: ID('G1') }
	const state = new Map([[F, moved], [A, sticky(A, { x: 50, y: 50, parent: F })]])
	const plan = planHistory(step, 'undo', { visible: (id) => state.get(id) ?? null })
	assert.deepEqual(plan.send, step.inverse, 'the remove of F with its other ops, and A\'s placement')
	assert.deepEqual(plan.changed, [])
	assert.deepEqual(plan.step.ops, [
		{ o: 'put', id: F, t: 'frame', p: { x: 900, y: 900, w: 700, h: 300, r: 0, z: 'a0', parent: null, data: {}, style: { fill: '#ffd6a5' }, group: ID('G1') } },
		{ o: 'patch', id: A, p: { x: 50, y: 50, parent: F } },
	], 'one put of the visible state before its child, the later op of F dropped')
	assert.deepEqual(plan.step.inverse, plan.send, 'the inverse stays the remove')
	// exactly the state the step left: the step as before
	const same = planHistory(step, 'undo', { visible: (id) => (id === F ? { ...made, data: { title: '' } } : state.get(id)) })
	assert.deepEqual(same.step.ops, step.ops)
	// a title written by someone else keeps the frame and its child's placement
	const titled = new Map([[F, { ...made, data: { title: 'Bob' } }], [A, state.get(A)]])
	const kept = planHistory(step, 'undo', { visible: (id) => titled.get(id) })
	assert.deepEqual([kept.send, kept.step, kept.changed], [[], null, [F]])
	// redo of a delete (job 176): only the text counts; the undo stack gets the put of the visible state with revive
	const del = { ops: [{ o: 'remove', id: F }], inverse: step.ops.slice(0, 1) }
	const redo = planHistory(del, 'redo', { visible: (id) => (id === F ? moved : null) })
	assert.deepEqual([redo.send, redo.changed], [[{ o: 'remove', id: F }], []])
	assert.deepEqual(redo.step, { ops: [{ o: 'remove', id: F }], inverse: [{ ...plan.step.ops[0], revive: true }] })
	const retitled = planHistory(del, 'redo', { visible: (id) => (id === F ? { ...moved, data: { title: 'Bob' } } : null) })
	assert.deepEqual([retitled.send, retitled.step, retitled.changed], [[], null, [F]], 'a title written by someone else keeps it')
})

// ---- Job 172: reactions of others survive undo and redo ---------------------

/** A reaction patch of someone else on the server (data.react.p<pid>). */
const reaction = (id, pid, e, name) => ({ o: 'patch', id, p: { ['data.react.p' + pid]: { e, n: name } } })

test('job 172 (round 1): Alice creates N, Bob reacts 👍, Alice undoes – redo brings N back with Bob\'s 👍 (the revive put of the visible state)', async () => {
	const h = await open()
	const id = createNote(h, 'Idea')
	await opsAfter(h, 0)
	bob(h, [reaction(id, 'b0b0b0b0b0b0b0b0', '1f44d', 'Bob Berg')])
	assert.deepEqual(await undoOps(h), [{ o: 'remove', id }], 'the text is unchanged: the remove goes out')
	const ops = await redoOps(h)
	assert.equal(ops.length, 1)
	assert.deepEqual([ops[0].o, ops[0].id, ops[0].revive], ['put', id, true])
	assert.deepEqual(ops[0].p.data.react, { pb0b0b0b0b0b0b0b0: { e: '1f44d', n: 'Bob Berg' } }, 'Bob\'s reaction travels with the redo')
	assert.deepEqual(h.srv.live.get(id).data.react, { pb0b0b0b0b0b0b0b0: { e: '1f44d', n: 'Bob Berg' } })
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 172 (round 1), job 176 AK3: Alice deletes N, undoes, Carol reacts 🚀 – redo deletes N without a notice (a reaction is no text); the undo after it brings N back with Carol\'s 🚀', async () => {
	const h = await open({ items: [sticky(N, { x: 600, y: 0, z: 'a2', data: { text: 'N' } })] })
	h.scene.callbacks.onIntent({ type: 'delete', ids: [N] })
	await opsAfter(h, 0)
	assert.deepEqual((await undoOps(h)).map((op) => [op.o, op.id, op.revive ?? null]), [['put', N, true]])
	bob(h, [reaction(N, 'c0c0c0c0c0c0c0c0', '1f680', 'Carol Clausen')])
	assert.deepEqual(await redoOps(h), [{ o: 'remove', id: N }], 'the delete goes out')
	assert.deepEqual(h.infos, [])
	assert.equal(h.srv.live.has(N), false)
	const ops = await undoOps(h)
	assert.deepEqual(ops.map((op) => [op.o, op.id, op.revive ?? null]), [['put', N, true]])
	assert.deepEqual(ops[0].p.data.react, { pc0c0c0c0c0c0c0c0: { e: '1f680', n: 'Carol Clausen' } }, 'Carol\'s reaction travels with the undo')
	assert.deepEqual(h.srv.live.get(N).data.react, { pc0c0c0c0c0c0c0c0: { e: '1f680', n: 'Carol Clausen' } })
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

// ---- Job 176: the redo of a delete follows the undo rule --------------------

/** (job 176) N with a text, on the board. */
const NOTE = () => sticky(N, { x: 600, y: 0, z: 'a2', data: { text: 'N' } })

/**
 * (job 176) Alice deletes ids (one step), then undoes it: the revive puts go out.
 *
 * @param {object} h harness
 * @param {string[]} ids items
 * @return {Promise<{del: object[], back: object[]}>} the ops of the delete and of the undo
 */
async function deleteUndo(h, ids) {
	const n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'delete', ids })
	const del = await opsAfter(h, n)
	assert.ok(ids.every((id) => !h.srv.live.has(id)), 'deleted')
	const back = await undoOps(h)
	assert.ok(ids.every((id) => h.srv.live.has(id)), 'the undo revives them')
	return { del, back }
}

for (const [what, p] of [
	['its placement {x, y}', { x: 900, y: 900 }],
	['its size {w, h}', { w: 320, h: 260 }],
	['its rotation {r}', { r: 30 }],
	['its colour style.fill', { 'style.fill': '#ffd6a5' }],
	['a reaction data.react.p…', reaction(N, 'b0b0b0b0b0b0b0b0', '1f44d', 'Bob Berg').p],
	['all of these at once', { x: 900, y: 900, w: 320, h: 260, r: 30, 'style.fill': '#ffd6a5', ...reaction(N, 'b0b0b0b0b0b0b0b0', '1f44d', 'Bob Berg').p }],
]) {
	test(`job 176 AK1: Alice deletes N with text, undo revives it, Bob changes ${what} – redo sends exactly the remove of N, no notice; N is gone on the server`, async () => {
		const h = await open({ items: [NOTE()] })
		await deleteUndo(h, [N])
		bob(h, [{ o: 'patch', id: N, p }])
		assert.deepEqual(await redoOps(h), [{ o: 'remove', id: N }])
		assert.deepEqual(h.infos, [])
		assert.equal(h.srv.live.has(N), false)
		h.s.destroy()
	})
}

test('job 176 AK2: the text decides – Bob moves N and changes its text: redo sends nothing, notice 1, N keeps Bob\'s text at Bob\'s place; Bob\'s text set back to the old one exactly, then a move: redo removes N without a notice', async () => {
	const h = await open({ items: [NOTE()] })
	await deleteUndo(h, [N])
	bob(h, [{ o: 'patch', id: N, p: { x: 900, y: 900, 'data.text': 'N, said Bob' } }])
	assert.deepEqual(await redoOps(h), [])
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.deepEqual([...at(h, N), h.srv.live.get(N).data.text], [900, 900, 'N, said Bob'])
	h.s.destroy()
	const g = await open({ items: [NOTE()] })
	await deleteUndo(g, [N])
	bob(g, [{ o: 'patch', id: N, p: { 'data.text': 'Something else' } }])
	bob(g, [{ o: 'patch', id: N, p: { 'data.text': 'N' } }])
	bob(g, [{ o: 'patch', id: N, p: { x: 900, y: 900 } }])
	assert.deepEqual(await redoOps(g), [{ o: 'remove', id: N }])
	assert.deepEqual(g.infos, [])
	assert.equal(g.srv.live.has(N), false)
	g.s.destroy()
})

test('job 176 AK3: Bob moves and recolours N, Alice redoes its delete – undo sends exactly one revive put with Bob\'s x, y, fill and the old text; the server then holds the state right before the redo; a further redo removes N again without a notice', async () => {
	const h = await open({ items: [NOTE()] })
	await deleteUndo(h, [N])
	bob(h, [{ o: 'patch', id: N, p: { x: 900, y: 900, 'style.fill': '#ffd6a5' } }])
	const before = itemKey(h.srv.live.get(N))
	assert.deepEqual(await redoOps(h), [{ o: 'remove', id: N }])
	assert.equal(h.srv.live.has(N), false)
	const ops = await undoOps(h)
	assert.equal(ops.length, 1, 'exactly one op')
	assert.deepEqual([ops[0].o, ops[0].id, ops[0].revive], ['put', N, true])
	assert.deepEqual([ops[0].p.x, ops[0].p.y, ops[0].p.style.fill, ops[0].p.data.text], [900, 900, '#ffd6a5', 'N'])
	assert.equal(itemKey(h.srv.live.get(N)), before, 'back as it was right before the redo')
	assert.deepEqual(await redoOps(h), [{ o: 'remove', id: N }])
	assert.equal(h.srv.live.has(N), false)
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 176 AK3: N unchanged before the redo – the undo stack holds the step as before job 176, and the undo after the redo sends what the first undo sent', async () => {
	const h = await open({ items: [sticky(A, { x: 0, y: 0, z: 'a1' }), NOTE(), connector(C, { item: A }, { item: N })] })
	const { del, back } = await deleteUndo(h, [N])
	const inverse = structuredClone(h.s.undoStack.undone[0].inverse)
	assert.deepEqual(await redoOps(h), del)
	assert.deepEqual(h.s.undoStack.done.at(-1).inverse, inverse, 'the step\'s own inverse, no put of the visible state')
	assert.deepEqual(await undoOps(h), back)
	assert.deepEqual([h.srv.live.has(N), h.srv.live.get(C).data.end], [true, { item: N }])
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 176 AK4: Alice deletes frame F with its children A and B, undoes, Bob moves F – redo sends A\'s and B\'s stored placements at the root and the remove of F, no notice; the undo after it revives F at Bob\'s place with A and B inside again', async () => {
	const F = ID('F1')
	const h = await open({ items: [frame(F, { x: 1000, y: 1000, w: 800, h: 400, z: 'a0' }), sticky(A, { x: 100, y: 100, z: 'a1', parent: F }), sticky(B, { x: 400, y: 100, z: 'a2', parent: F })] })
	const { del } = await deleteUndo(h, [F])
	const by = (ops, id) => ops.filter((op) => op.id === id)
	assert.deepEqual([by(del, A), by(del, B), by(del, F)], [
		[{ o: 'patch', id: A, p: { x: 1100, y: 1100, parent: null } }],
		[{ o: 'patch', id: B, p: { x: 1400, y: 1100, parent: null } }],
		[{ o: 'remove', id: F }],
	], 'the delete frees A and B at their place')
	assert.deepEqual([h.srv.live.get(A).parent, h.srv.live.get(B).parent], [F, F])
	bob(h, [{ o: 'patch', id: F, p: { x: 3000, y: 2000 } }])
	assert.deepEqual(await redoOps(h), del, 'the stored placements of A and B at the root, then the remove of F')
	assert.deepEqual(h.infos, [])
	assert.equal(h.srv.live.has(F), false)
	assert.deepEqual([...at(h, A), h.srv.live.get(A).parent, ...at(h, B), h.srv.live.get(B).parent], [1100, 1100, null, 1400, 1100, null], 'where they lay at the delete')
	const back = await undoOps(h)
	assert.deepEqual(back.map((op) => [op.o, op.id, op.revive ?? null]).sort(), [['put', F, true], ['patch', A, null], ['patch', B, null]].sort())
	assert.equal(back[0].id, F, 'the frame first')
	assert.deepEqual(at(h, F), [3000, 2000], 'F at Bob\'s place')
	assert.deepEqual([...at(h, A), h.srv.live.get(A).parent, ...at(h, B), h.srv.live.get(B).parent], [100, 100, F, 400, 100, F], 'A and B inside F again')
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

test('job 176 AK4: Alice deletes N with the connector C bound to it, undoes, Bob moves N – redo sends the stored patch that lets C go of N and the remove of N, no notice; the undo after it revives N at Bob\'s place and binds C to it again', async () => {
	const h = await open({ items: [sticky(A, { x: 0, y: 0, z: 'a1' }), NOTE(), connector(C, { item: A }, { item: N })] })
	const { del } = await deleteUndo(h, [N])
	assert.deepEqual(del.map((op) => [op.o, op.id]), [['patch', C], ['remove', N]])
	bob(h, [{ o: 'patch', id: N, p: { x: 900, y: 900 } }])
	assert.deepEqual(await redoOps(h), del, 'C lets go of N at the stored docking point, then N goes')
	assert.deepEqual(h.infos, [])
	assert.equal(h.srv.live.has(N), false)
	assert.deepEqual(h.srv.live.get(C).data.end, del[0].p['data.end'], 'a free end at the docking point of the delete')
	const back = await undoOps(h)
	assert.deepEqual(back.map((op) => [op.o, op.id, op.revive ?? null]), [['put', N, true], ['patch', C, null]])
	assert.deepEqual(at(h, N), [900, 900], 'N at Bob\'s place')
	assert.deepEqual(h.srv.live.get(C).data.end, { item: N }, 'C bound to N again')
	assert.deepEqual(h.infos, [])
	h.s.destroy()
})

/** (job 176) A stored 2 × 2 table with one cell text. */
const TB = ID('TB1')
const TCOLS = ['c00000001', 'c00000002']
const TROWS = ['r00000001', 'r00000002']
function storedTable() {
	return {
		id: TB, t: 'table', x: 0, y: 0, w: 320, h: 72, r: 0, z: 'i5', parent: null,
		data: {
			cols: Object.fromEntries(TCOLS.map((k, i) => [k, { o: 'i' + i, w: 160 }])),
			rows: Object.fromEntries(TROWS.map((k, i) => [k, { o: 'i' + i }])),
			cells: { [TCOLS[0]]: { [TROWS[0]]: 'Name' } },
		},
		style: {},
		group: null,
		lock: null,
	}
}

/**
 * (job 176) Alice makes a 3 × 3 table and writes in its top-left cell (one step), the editor closed.
 *
 * @param {object} h harness
 * @return {{id: string, cols: string[], rows: string[]}} the table and its column and row keys in order
 */
function createTable(h) {
	h.scene.callbacks.onIntent({ type: 'create', t: 'table', at: { x: 1000, y: 500 }, rect: null })
	const id = h.scene.selection[0]
	const cols = orderedCols(h.model.get(id).data).map((c) => c.key)
	const rows = orderedRows(h.model.get(id).data).map((r) => r.key)
	const first = cols[0] + '.' + rows[0]
	h.scene.callbacks.onEditing(id, false, first)
	h.scene.callbacks.onIntent({ type: 'text', id, path: `data.cells.${cols[0]}.${rows[0]}`, value: 'Name', before: '', final: true, cell: first })
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.s.undoStack.done.length, 1, 'creation and first text: one step')
	return { id, cols, rows }
}

test('job 176 AK5: a table\'s text is its cells – Bob writes in a cell of Alice\'s new table: undo sends nothing, notice 1; Bob writes in a cell of a deleted and revived table: redo sends nothing, notice 1', async () => {
	const h = await open({ items: [] })
	const { id, cols, rows } = createTable(h)
	await opsAfter(h, 0)
	bob(h, [{ o: 'patch', id, p: { [`data.cells.${cols[1]}.${rows[0]}`]: 'Bob' } }])
	assert.deepEqual(await undoOps(h), [])
	assert.deepEqual(h.infos, [CHANGED(1)])
	assert.equal(h.srv.live.get(id).data.cells[cols[1]][rows[0]], 'Bob')
	h.s.destroy()
	const g = await open({ items: [storedTable()] })
	await deleteUndo(g, [TB])
	bob(g, [{ o: 'patch', id: TB, p: { [`data.cells.${TCOLS[1]}.${TROWS[1]}`]: 'Bob' } }])
	assert.deepEqual(await redoOps(g), [])
	assert.deepEqual(g.infos, [CHANGED(1)])
	assert.equal(g.srv.live.get(TB).data.cells[TCOLS[1]][TROWS[1]], 'Bob')
	g.s.destroy()
})

for (const [what, p] of [
	['a column width of a table', (col) => ({ [`data.cols.${col}.w`]: 240, w: 560 })],
	['the placement of a table', () => ({ x: 2000, y: 2000 })],
]) {
	test(`job 176 AK5: Bob changes only ${what} – the undo of Alice's new table and the redo of a table's delete remove it without a notice`, async () => {
		const h = await open({ items: [] })
		const { id, cols } = createTable(h)
		await opsAfter(h, 0)
		bob(h, [{ o: 'patch', id, p: p(cols[0]) }])
		assert.deepEqual(await undoOps(h), [{ o: 'remove', id }])
		assert.deepEqual(h.infos, [])
		assert.equal(h.srv.live.has(id), false)
		h.s.destroy()
		const g = await open({ items: [storedTable()] })
		await deleteUndo(g, [TB])
		bob(g, [{ o: 'patch', id: TB, p: p(TCOLS[0]) }])
		assert.deepEqual(await redoOps(g), [{ o: 'remove', id: TB }])
		assert.deepEqual(g.infos, [])
		assert.equal(g.srv.live.has(TB), false)
		g.s.destroy()
	})
}

test('job 176 AK6: Carol locks N after the undo of its delete – redo sends nothing, lock-undo 1, no undo-changed; N stays', async () => {
	const h = await open({ items: [NOTE()] })
	await deleteUndo(h, [N])
	bob(h, [{ o: 'patch', id: N, p: { lock: { by: 'pidcarol00000001', name: 'Carol' } } }])
	assert.deepEqual(await redoOps(h), [])
	assert.deepEqual(h.infos, [LOCK_UNDO])
	assert.equal(h.srv.live.has(N), true)
	h.s.destroy()
})

test('job 176 planHistory: redo of a delete – the revive put of the visible state takes the place of the item\'s first op in step.inverse (its later ops dropped, other items kept); a step that creates and deletes the same item sends nothing', () => {
	const F = ID('F1')
	const leftF = { id: F, t: 'frame', x: 100, y: 100, w: 700, h: 300, r: 0, z: 'a0', parent: null, data: { title: 'Plan' }, style: {}, group: null, lock: null }
	const leftB = sticky(B, { x: 400, y: 0, z: 'a2', data: { text: 'B' }, group: null, lock: null })
	const put = (it) => ({ o: 'put', id: it.id, t: it.t, revive: true, p: { x: it.x, y: it.y, w: it.w, h: it.h, r: it.r, z: it.z, parent: it.parent, data: structuredClone(it.data), style: structuredClone(it.style), group: it.group } })
	const del = {
		ops: [{ o: 'patch', id: A, p: { x: 150, y: 150, parent: null } }, { o: 'remove', id: B }, { o: 'remove', id: F }],
		inverse: [put(leftB), put(leftF), { o: 'patch', id: A, p: { x: 50, y: 50, parent: F } }, { o: 'patch', id: F, p: { 'style.fill': null } }],
	}
	const moved = { ...leftF, x: 900, y: 900, style: { fill: '#ffd6a5' } }
	const state = new Map([[F, moved], [B, structuredClone(leftB)], [A, sticky(A, { x: 50, y: 50, parent: F })]])
	const plan = planHistory(del, 'redo', { visible: (id) => state.get(id) ?? null })
	assert.deepEqual([plan.send, plan.changed], [del.ops, []], 'A\'s stored placement and both removes go out')
	assert.deepEqual(plan.step.ops, del.ops)
	assert.deepEqual(plan.step.inverse, [
		put(leftB),
		{ o: 'put', id: F, t: 'frame', revive: true, p: { x: 900, y: 900, w: 700, h: 300, r: 0, z: 'a0', parent: null, data: { title: 'Plan' }, style: { fill: '#ffd6a5' }, group: null } },
		{ o: 'patch', id: A, p: { x: 50, y: 50, parent: F } },
	], 'B (unchanged) keeps its put; F\'s put of the visible state at the place of its first op, before its child; its later op dropped')
	assert.equal(del.inverse.length, 4, 'the input step stays as it was')
	// a step that creates and deletes the same item (an empty new text item, SPEC-M1 §6.5.2)
	const X = ID('X1')
	const made = { o: 'put', id: X, t: 'text', p: { x: 0, y: 0, w: 240, h: 28.8, z: 'a5', data: { text: '' }, style: {} } }
	const both = { ops: [made, { o: 'remove', id: X }], inverse: [{ ...made, revive: true }, { o: 'remove', id: X }] }
	for (const dir of ['undo', 'redo']) {
		const p = planHistory(both, dir, { visible: () => null })
		assert.deepEqual([p.send, p.step, p.changed], [[], null, []], dir)
	}
})
