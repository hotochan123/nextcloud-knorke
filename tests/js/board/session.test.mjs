/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as boardsApi from '../../../src/api/boards.js'
import { copyPayload } from '../../../src/board/actions.js'
import { BoardSession, limitsWithDefaults } from '../../../src/board/BoardSession.js'
import { CLIP_KEY, encodeClip } from '../../../src/board/clipboard.js'
import { debugApi } from '../../../src/board/debug.js'
import { applyPatch, itemFromPut, itemKey } from '../../../src/model/paths.js'
import { HttpError, request } from '../../../src/sync/http.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { anchorPoint } from '../../../src/model/connectors.js'
import { CONNECTOR_COLORS } from '../../../src/model/tokens.js'
import { FakeModel, FakeScene, ID, RoutedModel, connector, frame, memoryStorage, shape, sticky, textItem } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const F = ID('F1')
const ME = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }

/**
 * Opens a session against a scripted fake server.
 *
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({
	items = [sticky(A, { x: 10, y: 20, data: { text: 'hello' } })],
	viewOnly = false,
	codes = (ops) => ops.map(() => 'ok'),
	presence = () => ({}),
	reply = null,
	storage = memoryStorage(),
	Scene = FakeScene,
	win = null,
	limits = null,
	pasteCatcher = null,
	extraUi = {},
	extraDeps = {},
} = {}) {
	const clock = new FakeClock(10000)
	const ui = { status: [], reasons: [], rescue: [], selection: [], participants: [], board: [], zoom: [], tool: [], undo: [] }
	const toasts = []
	const infos = []
	let rev = 5
	const snapshotItems = () => items
	const tr = {
		kind: 'user',
		calls: [],
		keepalive: [],
		snapshots: 0,
		async snapshot() {
			tr.snapshots++
			return { proto: 2, epoch: 'k3x9a0b2', now: 1760100000000, rev, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', metaRev: 0, meta: {}, links: { edit: null, vote: null }, linksAllowed: true }, me: ME, items: snapshotItems() }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				tr.keepalive.push(body)
				return {}
			}
			tr.calls.push(structuredClone(body))
			if (reply) {
				const r = reply(body, tr.calls.length)
				if (r instanceof Error) {
					throw r
				}
				if (r) {
					return r
				}
			}
			const res = { rev: body.since, presence: presence(body) }
			if (body.ops) {
				rev = Math.max(rev, body.since) + 1
				res.acks = { seq: body.seq, rev, res: codes(body.ops) }
				res.rev = rev
			}
			return res
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 100, top: 50 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		debug: false,
		limits,
		pasteCatcher,
		ui: {
			...extraUi,
			onStatus: (x, reason) => {
				ui.status.push(x)
				ui.reasons.push(reason)
			},
			onRescue: (x) => ui.rescue.push(x),
			onSelection: (x) => ui.selection.push(x),
			onParticipants: (x) => ui.participants.push(x),
			onBoard: (x) => ui.board.push(x),
			onZoom: (x) => ui.zoom.push(x),
			onTool: (x) => ui.tool.push(x),
			onUndoState: (x) => ui.undo.push(x),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: Scene,
			transport: tr,
			storage,
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win,
			toast: (m) => toasts.push(m),
			info: (m) => infos.push(m),
			// wall clock in step with the fake clock: the snapshot's now (1760100000000) is "now"
			wall: () => 1760100000000 - 10000 + clock.now(),
			...extraDeps,
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model, storage }
}

test('open: snapshot → replica → model → scene (fit) → sync loop; client id per tab', async () => {
	const h = await open()
	assert.equal(h.model.has(A), true)
	assert.ok(h.scene.callsOf('mount').length === 1)
	assert.ok(h.scene.callsOf('fit').length === 1, 'no stored camera → fit')
	assert.equal(h.tr.calls.length, 1)
	assert.equal(h.tr.calls[0].since, 5)
	assert.match(h.tr.calls[0].client, /^c[A-Za-z0-9]{9}$/)
	assert.equal(h.storage.getItem('session', 'knorke.client.7'), h.tr.calls[0].client)
	assert.deepEqual(h.ui.board[0].board.title, 'Board')
	assert.deepEqual(h.ui.status, ['online'])
	assert.equal(h.ui.participants[0][0].self, true)
	h.s.destroy()
	assert.ok(h.scene.callsOf('destroy').length === 1)
})

test('open: stored camera is restored; a stored client id is reused', async () => {
	const storage = memoryStorage()
	storage.setJson('local', 'knorke.cam.7', { x: 5, y: 6, scale: 2 })
	storage.setItem('session', 'knorke.client.7', 'cStored123')
	const h = await open({ storage })
	assert.deepEqual(h.scene.callsOf('setCamera')[0][1], { x: 5, y: 6, scale: 2 })
	assert.equal(h.scene.callsOf('fit').length, 0)
	assert.equal(h.tr.calls[0].client, 'cStored123')
	h.s.destroy()
})

test('open: proxy 429 is repeated, other errors are thrown', async () => {
	const clock = new FakeClock()
	let n = 0
	const tr = {
		kind: 'user',
		async snapshot() {
			n++
			if (n < 3) {
				throw new HttpError(429, 'http_429', '', 1000, false)
			}
			return { proto: 2, rev: 1, items: [], me: ME, board: { id: 7, role: 'owner' } }
		},
		async sync(b) { return { rev: b.since } },
	}
	const s = new BoardSession({ container: {}, boardId: 7, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, win: null } })
	const p = s.open()
	await clock.advance(2000)
	await p
	assert.equal(n, 3)
	s.destroy()
	const s2 = new BoardSession({ container: {}, boardId: 7, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: { kind: 'user', snapshot: async () => { throw new HttpError(404, 'not_found', '', null, true) } }, storage: memoryStorage(), win: null } })
	await assert.rejects(s2.open(), (e) => e.status === 404)
})

test('flushVisible: active ids are deferred until the activity ends', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 6, items: [sticky(A, { x: 500, y: 20, data: { text: 'hello' } })], presence: {} } : null) })
	h.scene.active.add(A)
	await h.clock.advance(1000)
	assert.equal(h.tr.calls.length, 2)
	assert.equal(h.model.get(A).x, 10, 'dragged item ignores the remote change')
	h.scene.active.delete(A)
	h.scene.callbacks.onActivity({ kind: 'drag', active: false, ids: [A] })
	assert.equal(h.model.get(A).x, 500)
	h.s.destroy()
})

test('move intent: one patch with the whole placement group, sent urgently', async () => {
	const h = await open({ items: [frame(F, { x: 1000, y: 0 }), sticky(A, { x: 10, y: 20 })] })
	h.scene.callbacks.onIntent({ type: 'move', ids: [A], dx: 1100, dy: 100, origin: new Map([[A, { x: 10, y: 20, parent: null }]]) })
	assert.equal(h.model.get(A).parent, F, 'shown at once')
	await h.clock.advance(150)
	const ops = h.tr.calls[1].ops
	assert.deepEqual(ops, [{ o: 'patch', id: A, p: { x: 110, y: 120, parent: F } }])
	assert.deepEqual(h.ui.undo[h.ui.undo.length - 1], { canUndo: true, canRedo: false })
	h.s.destroy()
})

test('create sticky: put sent, selection set, editor opened', async () => {
	const h = await open({ items: [] })
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	const id = h.scene.selection[0]
	assert.ok(h.model.has(id))
	assert.deepEqual(h.scene.callsOf('openTextEditor')[0].slice(1), [id, {}])
	await h.clock.advance(150)
	assert.equal(h.tr.calls[1].ops[0].o, 'put')
	h.s.destroy()
})

test('text rescue: locked while the editor is open → notice with the holder name, no further commits', async () => {
	let lock = false
	const h = await open({
		codes: (ops) => ops.map(() => (lock ? 'locked' : 'ok')),
		presence: () => (lock ? { 'pidbob:c2': { n: 'Bob Berg', k: 'pidbob', g: 0, x: null, y: null, s: [], d: [], e: A, h: 1 } } : {}),
	})
	h.scene.callbacks.onEditing(A, false)
	lock = true
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'hello world', before: 'hello', final: false })
	await h.clock.advance(400)
	const notice = h.scene.callsOf('setEditorNotice')
	assert.equal(notice.length, 1)
	assert.equal(notice[0][1], A)
	assert.match(notice[0][2], /Bob Berg is editing this item/)
	const sent = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'hello world!', before: 'hello', final: true })
	await h.clock.advance(2000)
	assert.ok(h.tr.calls.slice(sent).every((c) => !c.ops), 'no commits after the notice')
	assert.equal(h.model.get(A).data.text, 'hello', 'server text stays')
	h.s.destroy()
})

test('text rescue: bad with the editor closed → editor reopens with the rejected text', async () => {
	const h = await open({ codes: (ops) => ops.map(() => 'bad') })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'too long?', before: 'hello', final: true })
	await h.clock.advance(150)
	const opened = h.scene.callsOf('openTextEditor')
	assert.equal(opened.length, 1)
	assert.equal(opened[0][1], A)
	assert.equal(opened[0][2].text, 'too long?')
	assert.match(opened[0][2].notice, /Not saved\. Copy your text/)
	h.s.destroy()
})

test('text rescue: gone and the item no longer exists → copy dialog with the text', async () => {
	const h = await open({
		codes: (ops) => ops.map(() => 'gone'),
		reply: (b) => (b.ops ? { rev: 7, removed: [A], acks: { seq: b.seq, rev: 7, res: b.ops.map(() => 'gone') }, presence: {} } : null),
	})
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'my words', before: 'hello', final: true })
	await h.clock.advance(150)
	assert.deepEqual(h.ui.rescue, [{ id: A, text: 'my words', gone: true }])
	assert.equal(h.scene.callsOf('openTextEditor').length, 0)
	h.s.destroy()
})

test('denied → one toast; limit → toast; dup is silent', async () => {
	let code = 'denied'
	const h = await open({ codes: (ops) => ops.map(() => code) })
	h.scene.callbacks.onIntent({ type: 'reorder', ids: [A], where: 'front' })
	await h.clock.advance(150)
	h.scene.callbacks.onIntent({ type: 'reorder', ids: [A], where: 'back' })
	await h.clock.advance(1000)
	assert.deepEqual(h.toasts, ['No permission'])
	code = 'limit'
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	await h.clock.advance(1000)
	assert.deepEqual(h.toasts, ['No permission', 'This board is full.'])
	h.s.destroy()
})

test('presence: presenceChanged after every onPresence; participants without the own pid; remote drag → active cadence', async () => {
	const h = await open({ presence: () => ({ 'pidbob:c2': { n: 'Bob Berg', k: 'pidbob', g: 0, x: 1, y: 2, s: [], d: [[A, 5, 5]], e: null, h: 0 }, 'pidalice00000001:c9': { n: 'Alice Adler', k: ME.pid, g: 0, x: 0, y: 0, s: [], d: [], e: null, h: 0 } }) })
	const before = h.scene.presenceChangedCount
	await h.clock.advance(400)
	assert.ok(h.scene.presenceChangedCount > before)
	assert.equal(h.scene.presenceChangedCount, h.tr.calls.length)
	const parts = h.ui.participants[h.ui.participants.length - 1]
	assert.deepEqual(parts.map((p) => [p.name, p.self]), [['Alice Adler', true], ['Bob Berg', false]])
	assert.equal(h.s.sync.remoteDragging, true)
	assert.equal(h.scene.sampler(h.clock.now()).length, 2)
	h.s.destroy()
})

test('lease lost through presence (foreign holder) → notice; not while the own take-over is pending', async () => {
	let holder = false
	const h = await open({ presence: () => (holder ? { 'pidbob:c2': { n: 'Bob Berg', k: 'pidbob', g: 0, x: null, y: null, s: [], d: [], e: A, h: 1 } } : {}) })
	h.scene.callbacks.onEditing(A, true)
	// the answer to a request without tk still names Bob
	holder = true
	h.s.onPresence({ 'pidbob:c2': { n: 'Bob Berg', k: 'pidbob', g: 0, x: null, y: null, s: [], d: [], e: A, h: 1 } })
	assert.equal(h.scene.callsOf('setEditorNotice').length, 0, 'take-over pending: no verdict yet')
	assert.equal(h.s.getPresence().tk, 1)
	holder = false
	await h.clock.advance(400)
	const withTk = h.tr.calls.filter((c) => c.me && c.me.tk === 1)
	assert.equal(withTk.length, 1, 'tk sent exactly once')
	assert.equal(h.s.getPresence().tk, undefined)
	holder = true
	await h.clock.advance(400)
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1)
	assert.match(h.scene.callsOf('setEditorNotice')[0][2], /Bob Berg/)
	h.s.destroy()
})

test('getPresence: cursor, selection, drag, editing; null in view-only mode', async () => {
	const h = await open()
	h.scene.callbacks.onPointer([12.345, -7.81])
	h.scene.callbacks.onSelection([A])
	h.scene.callbacks.onDragPreview([[A, 100.04, 200.06]])
	h.scene.callbacks.onEditing(A, false)
	assert.deepEqual(h.s.getPresence(), { c: [12.3, -7.8], s: [A], d: [[A, 100, 200.1]], e: A })
	h.s.destroy()
	const v = await open({ viewOnly: true })
	assert.equal(v.s.getPresence(), null)
	assert.equal(v.tr.calls[0].me, undefined)
	v.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	assert.equal(v.model.size, 1, 'no intents in view-only mode')
	v.s.destroy()
})

test('404 → gone: scene view-only, open editor gets a notice, loop stops', async () => {
	const h = await open({ reply: (b, n) => (n >= 2 ? new HttpError(404, 'not_found', '', null, true) : null) })
	h.scene.callbacks.onEditing(A, false)
	await h.clock.advance(1000)
	assert.deepEqual(h.ui.status, ['online', 'gone'])
	assert.deepEqual(h.scene.callsOf('setViewOnly').map((c) => c[1]), [true])
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1)
	assert.equal(h.s.getPresence(), null)
	const n = h.tr.calls.length
	await h.clock.advance(10000)
	assert.equal(h.tr.calls.length, n)
	h.s.destroy()
})

test('delete + undo + redo: inverse revives, redo of a create revives', async () => {
	const h = await open({ items: [frame(F, { x: 100, y: 100 }), sticky(A, { x: 10, y: 10, parent: F })] })
	h.scene.callbacks.onIntent({ type: 'delete', ids: [F] })
	assert.equal(h.model.has(F), false)
	assert.equal(h.model.get(A).parent, null)
	h.scene.callbacks.onIntent({ type: 'undo' })
	assert.equal(h.model.has(F), true)
	assert.equal(h.model.get(A).parent, F)
	await h.clock.advance(150)
	const ops = h.tr.calls[1]?.ops ?? []
	assert.ok(!ops.some((o) => o.o === 'remove'), 'delete + undo within one tick sends no remove')
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 5000, y: 5000 }, rect: null })
	const id = h.scene.selection[0]
	await h.clock.advance(400)
	h.s.undo()
	await h.clock.advance(400)
	h.s.redo()
	await h.clock.advance(400)
	const redoPut = h.tr.calls.flatMap((c) => c.ops ?? []).filter((o) => o.id === id && o.o === 'put')
	assert.equal(redoPut[redoPut.length - 1].revive, true)
	h.s.destroy()
})

test('resync: snapshot again, model reloaded with visible items, scene reset, counter', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 99, resync: true, presence: {} } : null) })
	await h.clock.advance(1000)
	assert.equal(h.tr.snapshots, 2)
	assert.equal(h.s.counters.resyncs, 1)
	assert.equal(h.model.calls.load, 2)
	assert.equal(h.scene.callsOf('reset').length, 1)
	assert.equal(h.s.sync.cursor, 5)
	h.s.destroy()
})

test('debug API: state, items, confirmed, serverItems, rects, counters, waitIdle', async () => {
	const h = await open()
	const d = debugApi(h.s)
	assert.deepEqual(d.state(), {
		boardId: 7, mode: 'user', cursor: 5, status: 'online', pid: ME.pid, role: 'owner', viewOnly: false, pending: 0, inflight: false,
		// SPEC-M1 §6.7 (stage 0)
		uiMode: 'edit', mod: true, source: 'own', epoch: 'k3x9a0b2', metaRev: 0, following: null, clockOffset: 0,
		// SPEC-M1 §6.7 (R16, stage 3)
		name: 'Alice Adler',
	})
	assert.deepEqual(d.meta(), {})
	assert.deepEqual(d.items(), [itemKey(sticky(A, { x: 10, y: 20, data: { text: 'hello' } }))])
	assert.deepEqual(d.confirmed(), d.items())
	assert.deepEqual(await d.serverItems(), d.items())
	assert.equal(h.s.counters.snapshotRequests, 0, 'serverItems is not counted (fake transport counts nothing)')
	assert.deepEqual(d.itemScreenRect(A), { x: 110, y: 70, w: 30, h: 40 })
	assert.deepEqual(d.worldToScreen(1, 1), { x: 102, y: 53 })
	assert.deepEqual(d.camera(), { x: 0, y: 0, scale: 1 })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'x', before: 'hello', final: true })
	assert.equal(d.state().pending, 1)
	const idle = d.waitIdle(5000)
	await h.clock.advance(2000)
	// waitIdle polls with real timers; give it real time while the fake loop runs
	for (let i = 0; i < 40 && d.state().pending > 0; i++) {
		await new Promise((r) => setTimeout(r, 30))
		await h.clock.advance(400)
	}
	const pump = setInterval(() => { h.clock.advance(400) }, 20)
	try {
		assert.equal(await idle, true)
	} finally {
		clearInterval(pump)
	}
	assert.equal(d.state().pending, 0)
	h.s.destroy()
})

test('closing the editor keeps me.e until the final text op is acknowledged (presence is written before ops)', async () => {
	const h = await open()
	h.scene.callbacks.onEditing(A, false)
	await h.clock.advance(1000)
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'final words', before: 'hello', final: true })
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(150)
	const withOps = h.tr.calls.find((c) => c.ops)
	assert.equal(withOps.ops[0].p['data.text'], 'final words')
	// me unchanged (e still A) is not resent: the server keeps the stored entry with e = A
	assert.ok(withOps.me === undefined || withOps.me.e === A, 'the lease is still announced next to the final commit')
	assert.equal(h.s.getPresence().e, null, 'released once the op is acknowledged')
	await h.clock.advance(1000)
	const last = h.tr.calls[h.tr.calls.length - 1]
	assert.equal(last.me?.e ?? null, null)
	h.s.destroy()
})

// ---- text lease: take-over and lease loss (E04b) ---------------------------

const BOB = (e, h) => ({ 'pidbob:c2': { n: 'Bob Berg', k: 'pidbob', g: 0, x: null, y: null, s: [], d: [], e, h } })

/**
 * Fake server with the §4.11 lease rules for item A, presence BEFORE ops:
 * me.tk with e = A makes this tab the holder; a text patch on A is `locked`
 * unless this tab holds. Bob (the other participant) is editing A unless
 * `bobEditing` is false.
 *
 * @param {object} [o] options
 * @return {object} server state + reply(body, n) for open()
 */
function leaseServer({ holder = 'bob', text = 'hello', bobEditing = true } = {}) {
	const srv = { holder, text, rev: 5, bobEditing, results: [], hook: null }
	srv.reply = (body, n) => {
		srv.hook?.(body, n)
		if (body.me) {
			if (body.me.tk === 1 && body.me.e === A) {
				srv.holder = 'me'
			} else if (body.me.e !== A && srv.holder === 'me') {
				srv.holder = srv.bobEditing ? 'bob' : null
			}
		}
		const res = { rev: srv.rev, presence: BOB(srv.bobEditing ? A : null, srv.holder === 'bob' ? 1 : 0) }
		if (body.ops) {
			const codes = body.ops.map((op) => {
				if (op.o === 'patch' && op.id === A && Object.prototype.hasOwnProperty.call(op.p, 'data.text')) {
					if (srv.holder === 'bob') {
						return 'locked'
					}
					srv.text = op.p['data.text']
				}
				return 'ok'
			})
			srv.results.push(...codes.map((c, i) => [c, body.ops[i].p?.['data.text'] ?? null, body.me?.tk === 1]))
			const wrote = codes.includes('ok')
			if (wrote) {
				srv.rev++
			}
			res.rev = srv.rev
			res.acks = { seq: body.seq, rev: srv.rev, res: codes }
			if (wrote) {
				res.items = [sticky(A, { x: 10, y: 20, data: { text: srv.text } })]
			}
		}
		return res
	}
	return srv
}

test('E04b failure mode A: take-over, then Esc before the next sync → tk still goes out (alone), the final text is accepted', async () => {
	const srv = leaseServer()
	const h = await open({ reply: srv.reply })
	const before = h.tr.calls.length
	h.scene.callbacks.onEditing(A, true)
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'Alice took over', before: 'hello', final: true })
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(3000)
	const after = h.tr.calls.slice(before)
	assert.equal(after[0].me?.tk, 1, 'the first request after the take-over carries me.tk')
	assert.equal(after[0].me.e, A)
	assert.equal(after[0].ops, undefined, 'the take-over travels alone')
	const withOps = after.find((c) => c.ops)
	assert.equal(withOps.me?.tk, undefined, 'tk only once')
	assert.ok(withOps.me === undefined || withOps.me.e === A, 'the lease tail still announces the item next to the final text')
	assert.deepEqual(srv.results, [['ok', 'Alice took over', false]])
	assert.equal(srv.text, 'Alice took over')
	assert.equal(h.model.get(A).data.text, 'Alice took over')
	assert.equal(h.scene.callsOf('setEditorNotice').length, 0)
	assert.equal(h.scene.callsOf('openTextEditor').length, 0, 'no rescue editor')
	assert.equal(h.s.getPresence().e, null, 'released once the text is through')
	assert.equal(h.tr.calls.filter((c) => c.me?.tk === 1).length, 1)
	h.s.destroy()
})

test('E04b failure mode A: tk stays pending through a failed request and goes out with the repeat', async () => {
	const srv = leaseServer()
	let failNext = false
	srv.hook = () => {
		if (failNext) {
			failNext = false
			throw new HttpError(0, 'network')
		}
	}
	const h = await open({ reply: srv.reply })
	h.scene.callbacks.onEditing(A, true)
	failNext = true
	await h.clock.advance(400)
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'mine', before: 'hello', final: true })
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(5000)
	const tks = h.tr.calls.filter((c) => c.me?.tk === 1)
	assert.equal(tks.length, 2, 'sent, failed on the network, sent again')
	assert.deepEqual(srv.results, [['ok', 'mine', false]])
	h.s.destroy()
})

test('E04b failure mode B: lease lost through presence → queued intermediate text is dropped, never sent after the lease came back', async () => {
	const srv = leaseServer({ holder: 'me', bobEditing: false })
	let h = null
	srv.hook = (body, n) => {
		if (n === 3) {
			// on the wire: Bob takes over and writes his text; meanwhile the
			// editor's 1 Hz commit queues more of the own text
			srv.holder = 'bob'
			srv.bobEditing = true
			srv.text = 'Bob took over'
			srv.rev++
			h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'hello typed on', before: 'hello', final: false })
		}
		if (n === 4) {
			// Bob closed his editor: the lease is back with the own (locked) editor
			srv.holder = 'me'
			srv.bobEditing = false
		}
	}
	h = await open({ reply: srv.reply })
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'hello typed', before: 'hello', final: false })
	await h.clock.advance(400)
	assert.equal(h.tr.calls.length, 2)
	assert.deepEqual(srv.results, [['ok', 'hello typed', false]])
	await h.clock.advance(400)
	assert.equal(h.tr.calls.length, 3)
	const notice = h.scene.callsOf('setEditorNotice')
	assert.equal(notice.length, 1, 'the answer names Bob as holder → editor locked')
	assert.match(notice[0][2], /Bob Berg is editing/)
	assert.equal(h.s.replica.pendingCount(), 0, 'the queued intermediate text was dropped')
	await h.clock.advance(3000)
	assert.ok(h.tr.calls.slice(3).every((c) => !c.ops), 'nothing is sent after the lease came back')
	assert.equal(srv.text, 'Bob took over', 'Bob\'s text survives')
	assert.deepEqual(srv.results, [['ok', 'hello typed', false]])
	h.s.destroy()
})

test('text rejected locked because it went out before the take-over landed: no notice, sent again right behind tk', async () => {
	const srv = leaseServer()
	const h = await open({ reply: srv.reply })
	srv.hook = (body) => {
		if (body.ops) {
			// "Take over" is clicked while this request (without tk) is on the wire
			h.scene.callbacks.onEditing(A, true)
			srv.hook = null
		}
	}
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'early words', before: 'hello', final: true })
	await h.clock.advance(150)
	assert.deepEqual(srv.results, [['locked', 'early words', false]])
	await h.clock.advance(0)
	// the take-over editor closes without typing: the rejected text still counts
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(3000)
	assert.equal(h.scene.callsOf('setEditorNotice').length, 0, 'no lost-lease notice on the take-over')
	assert.equal(h.scene.callsOf('openTextEditor').length, 0)
	assert.deepEqual(h.ui.rescue, [])
	const i = h.tr.calls.findIndex((c) => c.me?.tk === 1)
	assert.ok(i > 0, 'tk sent')
	assert.equal(h.tr.calls[i].ops, undefined)
	assert.deepEqual(srv.results, [['locked', 'early words', false], ['ok', 'early words', false]])
	assert.equal(srv.text, 'early words')
	assert.equal(h.s.getPresence().e, null)
	h.s.destroy()
})

test('take-over closed with nothing to save: no tk, the lease is released at once', async () => {
	const srv = leaseServer()
	const h = await open({ reply: srv.reply })
	h.scene.callbacks.onEditing(A, true)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.s.getPresence().e, null)
	assert.equal(h.s.getPresence().tk, undefined)
	await h.clock.advance(2000)
	assert.equal(h.tr.calls.filter((c) => c.me?.tk === 1).length, 0)
	h.s.destroy()
})

test('take-over: the verdict waits for the tk answer; after it, a foreign holder locks again', async () => {
	const srv = leaseServer()
	const h = await open({ reply: srv.reply })
	h.scene.callbacks.onEditing(A, true)
	// an answer to an older request still names Bob as holder
	h.s.onPresence(BOB(A, 1))
	assert.equal(h.scene.callsOf('setEditorNotice').length, 0)
	await h.clock.advance(400)
	assert.equal(srv.holder, 'me')
	assert.equal(h.scene.callsOf('setEditorNotice').length, 0)
	h.s.onPresence(BOB(A, 1))
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1, 'Bob took it back: locked')
	h.s.destroy()
})

class ClosingScene extends FakeScene {
	destroy() {
		this.log('destroy')
		if (this.editing) {
			// SceneManager.destroy() ends an open editor with a final commit
			const id = this.editing
			this.editing = null
			this.callbacks.onIntent({ type: 'text', id, path: 'data.text', value: 'typed in the last second', before: 'hello', final: true })
			this.callbacks.onEditing(null, false)
		}
	}
}

test('destroy: the scene ends first (final text of an open editor), then keepalive with that op, then the loop stops', async () => {
	const h = await open({ Scene: ClosingScene })
	h.scene.callbacks.onEditing(A, false)
	h.scene.editing = A
	await h.clock.advance(400)
	const calls = h.tr.calls.length
	h.s.destroy()
	assert.equal(h.scene.callsOf('destroy').length, 1)
	assert.equal(h.tr.keepalive.length, 1, 'the final text goes out with fetch keepalive')
	assert.deepEqual(h.tr.keepalive[0].ops, [{ o: 'patch', id: A, p: { 'data.text': 'typed in the last second' } }])
	assert.equal(h.s.sync.running, false)
	await h.clock.advance(5000)
	assert.equal(h.tr.calls.length, calls, 'no regular request after destroy')
	h.s.destroy()
	assert.equal(h.tr.keepalive.length, 1, 'destroy twice is a no-op')
})

test('destroy with a pending take-over: the keepalive carries me.tk ahead of the final text', async () => {
	const h = await open({ Scene: ClosingScene })
	h.scene.callbacks.onEditing(A, true)
	h.scene.editing = A
	h.s.destroy()
	assert.equal(h.tr.keepalive.length, 1)
	assert.equal(h.tr.keepalive[0].me?.tk, 1)
	assert.equal(h.tr.keepalive[0].me.e, A)
	assert.equal(h.tr.keepalive[0].ops[0].p['data.text'], 'typed in the last second')
})

test('app 429 (rate_limited) on /sync → status rate_limited (R3): view-only, editor rescue like gone, loop and keepalive stop', async () => {
	const h = await open({
		Scene: ClosingScene,
		reply: (b) => (b.ops ? new HttpError(429, 'rate_limited', 'Too many requests', null, true) : null),
	})
	h.scene.callbacks.onEditing(A, false)
	h.scene.editing = A
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'hello world', before: 'hello', final: true })
	await h.clock.advance(1000)
	assert.deepEqual(h.ui.status, ['online', 'rate_limited'], 'its own status, not gone')
	assert.deepEqual(h.ui.reasons, [null, null])
	assert.equal(h.s.status, 'rate_limited')
	assert.equal(h.s.frozen, true)
	assert.equal(h.s.sync.running, false)
	assert.deepEqual(h.scene.callsOf('setViewOnly').map((c) => c[1]), [true])
	assert.deepEqual(h.scene.callsOf('setEditorNotice').map((c) => c[1]), [A], 'open editor keeps its text with a notice')
	assert.equal(h.s.getPresence(), null)
	assert.equal(h.ui.rescue.length, 0)
	const n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	assert.equal(h.model.size, 1, 'no intents after rate_limited')
	await h.clock.advance(30000)
	assert.equal(h.tr.calls.length, n, 'never repeated')
	h.s.destroy()
	assert.equal(h.tr.keepalive.length, 0, 'destroy/pagehide do not repeat the throttled batch by keepalive')
	assert.equal(h.tr.calls.length, n)
})

test('take-over on the already open, locked editor (scene reports onEditing(id, true) again): commits resume behind tk', async () => {
	const srv = leaseServer()
	const h = await open({ reply: srv.reply })
	h.scene.callbacks.onEditing(A, false)
	await h.clock.advance(400)
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1, 'Bob holds: the editor is locked')
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'ignored while locked', before: 'hello', final: false })
	assert.equal(h.s.replica.pendingCount(), 0)
	h.scene.callbacks.onEditing(A, true)
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'now mine', before: 'hello', final: true })
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(3000)
	assert.deepEqual(srv.results, [['ok', 'now mine', false]])
	assert.equal(srv.text, 'now mine')
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1, 'no second notice')
	h.s.destroy()
})

// ---- review round (T3, T5, T6, T15, T17) ------------------------------------

const C = ID(3)

/**
 * Fake window + document for the lifecycle listeners (pagehide,
 * visibilitychange, beforeunload, online).
 *
 * @return {object} window with fire(type, event)
 */
function fakeWin() {
	const listeners = []
	const target = (name) => ({
		addEventListener: (type, fn) => listeners.push({ name, type, fn }),
		removeEventListener: (type, fn) => {
			const i = listeners.findIndex((l) => l.name === name && l.type === type && l.fn === fn)
			if (i >= 0) {
				listeners.splice(i, 1)
			}
		},
	})
	const doc = { ...target('doc'), visibilityState: 'visible' }
	const win = { ...target('win'), document: doc }
	win.fire = (type, ev = {}) => {
		for (const l of listeners.filter((x) => x.type === type)) {
			l.fn(ev)
		}
		return ev
	}
	win.listenerCount = () => listeners.length
	return win
}

/** @return {object} beforeunload event stand-in that records preventDefault */
function unloadEvent() {
	const ev = { prevented: false, returnValue: undefined }
	ev.preventDefault = () => { ev.prevented = true }
	return ev
}

test('T5: pagehide with a dirty editor → the editor text is committed first and rides in the keepalive', async () => {
	const win = fakeWin()
	const h = await open({ win })
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	await h.clock.advance(1000)
	assert.equal(h.s.replica.pendingCount(), 0, 'the last 1 Hz commit was acknowledged')
	h.scene.dirty = { id: A, value: 'hello world, please keep this', before: 'hello' }
	win.fire('pagehide')
	assert.equal(h.scene.callsOf('flushEditor').length, 1)
	assert.equal(h.tr.keepalive.length, 1)
	assert.deepEqual(h.tr.keepalive[0].ops, [{ o: 'patch', id: A, p: { 'data.text': 'hello world, please keep this' } }])
	h.s.destroy()
})

test('T5: visibilitychange hidden with a dirty editor → flushEditor before the keepalive', async () => {
	const win = fakeWin()
	const h = await open({ win })
	h.scene.dirty = { id: A, value: 'typed', before: 'hello' }
	win.document.visibilityState = 'hidden'
	win.fire('visibilitychange')
	assert.equal(h.tr.keepalive.length, 1)
	assert.equal(h.tr.keepalive[0].ops[0].p['data.text'], 'typed')
	h.s.destroy()
})

test('T5: beforeunload with a dirty editor and an empty queue → prompt (preventDefault)', async () => {
	const win = fakeWin()
	const h = await open({ win })
	assert.equal(h.s.replica.pendingCount(), 0)
	const clean = win.fire('beforeunload', unloadEvent())
	assert.equal(clean.prevented, false, 'nothing typed, nothing pending: no prompt')
	h.scene.dirty = { id: A, value: 'hello again', before: 'hello' }
	const ev = win.fire('beforeunload', unloadEvent())
	assert.equal(ev.prevented, true)
	assert.equal(h.s.replica.pendingCount(), 1, 'the text is queued, so the normal loop or pagehide sends it')
	h.s.destroy()
	assert.equal(win.listenerCount(), 0)
})

test('T3: prepareLeave — nothing pending → true at once; frozen → true', async () => {
	const h = await open()
	assert.equal(await h.s.prepareLeave({ timeoutMs: 3000 }), true)
	assert.equal(h.scene.callsOf('flushEditor').length, 1, 'a dirty editor is committed first')
	h.s.destroy()
	const g = await open({ reply: (b, n) => (n >= 2 ? new HttpError(404, 'not_found', '', null, true) : null) })
	await g.clock.advance(1000)
	assert.equal(g.s.frozen, true)
	assert.equal(await g.s.prepareLeave(), true, 'a frozen board cannot send anything more: do not ask')
	g.s.destroy()
})

test('T3: prepareLeave with pending ops and a failing transport → false (offline work is not dropped silently)', async () => {
	const h = await open({ reply: (b) => (b.ops ? new HttpError(0, 'network') : null) })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'written while offline', before: 'hello', final: true })
	const p = h.s.prepareLeave({ timeoutMs: 3000 })
	let result = null
	p.then((v) => { result = v })
	await h.clock.advance(3500)
	assert.equal(result, false)
	assert.ok(h.s.replica.pendingCount() > 0)
	h.s.destroy()
})

test('T3: prepareLeave already offline → false without waiting', async () => {
	let fail = true
	const h = await open({ reply: () => (fail ? new HttpError(0, 'network') : null) })
	await h.clock.advance(5000)
	assert.equal(h.s.status, 'offline')
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'offline', before: 'hello', final: true })
	const p = h.s.prepareLeave({ timeoutMs: 3000 })
	let result = null
	p.then((v) => { result = v })
	await h.clock.advance(0)
	assert.equal(result, false)
	fail = false
	h.s.destroy()
})

test('T3: prepareLeave with ops acked within the timeout → true', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'reorder', ids: [A], where: 'front' })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'slow typist', before: 'hello', final: false })
	const p = h.s.prepareLeave({ timeoutMs: 3000 })
	let result = null
	p.then((v) => { result = v })
	await h.clock.advance(500)
	assert.equal(result, true)
	assert.equal(h.s.replica.pendingCount(), 0)
	const sent = h.tr.calls.flatMap((c) => c.ops ?? [])
	assert.ok(sent.some((o) => o.p?.['data.text'] === 'slow typist'))
	h.s.destroy()
})

test('T3: prepareLeave with a dirty editor → the text op is sent and acknowledged before it resolves true', async () => {
	const h = await open()
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	await h.clock.advance(1000)
	h.scene.dirty = { id: A, value: 'last second words', before: 'hello' }
	const before = h.tr.calls.length
	const p = h.s.prepareLeave({ timeoutMs: 3000 })
	let result = null
	p.then((v) => { result = v })
	assert.equal(h.s.replica.pendingCount(), 1, 'the editor text became a queued op')
	await h.clock.advance(0)
	assert.equal(h.tr.calls.length, before + 1, 'sent at once (forced tick), not after the idle cadence')
	assert.deepEqual(h.tr.calls[before].ops, [{ o: 'patch', id: A, p: { 'data.text': 'last second words' } }])
	await h.clock.advance(100)
	assert.equal(result, true)
	h.s.destroy()
})

/**
 * Scene stand-in whose editor follows the real SceneManager closely enough
 * for the rescue paths: openTextEditor reports onEditing synchronously and
 * replaces an open editor (a noticed one is discarded without an intent).
 */
class EditorScene extends FakeScene {
	openTextEditor(id, opts = {}) {
		this.log('openTextEditor', id, opts)
		if (!this.model.has(id)) {
			return false
		}
		if (this.editing && this.editing !== id) {
			this.closeEditor()
		}
		this.editing = id
		this.active.add(id)
		this.callbacks.onEditing(id, false)
		return true
	}

	closeEditor() {
		const id = this.editing
		this.editing = null
		this.active.delete(id)
		this.callbacks.onEditing(null, false)
		this.callbacks.onActivity({ kind: 'edit', active: false, ids: [id] })
	}
}

/**
 * @param {object} h harness
 * @return {string[]} every rescued text: rescue editors (with their text) and copy dialog entries
 */
function rescuedTexts(h) {
	return [
		...h.scene.callsOf('openTextEditor').filter((c) => typeof c[2]?.text === 'string').map((c) => c[2].text),
		...h.ui.rescue.map((r) => r.text),
	]
}

const textA = (value) => ({ type: 'text', id: A, path: 'data.text', value, before: 'hello', final: true })
const textB = (value) => ({ type: 'text', id: B, path: 'data.text', value, before: '', final: true })

test('T6: two texts rejected in one answer, both items exist → one rescue editor, the other text in the dialog', async () => {
	const h = await open({ Scene: EditorScene, items: [sticky(A, { data: { text: 'hello' } }), sticky(B)], codes: (ops) => ops.map(() => 'bad') })
	h.scene.callbacks.onIntent(textA('words A'))
	h.scene.callbacks.onIntent(textB('words B'))
	await h.clock.advance(150)
	assert.equal(h.scene.callsOf('openTextEditor').length, 1, 'never a second editor over the first')
	assert.equal(h.scene.callsOf('openTextEditor')[0][1], A)
	assert.deepEqual(h.ui.rescue.map((r) => [r.id, r.text, r.gone]), [[B, 'words B', false]])
	assert.deepEqual(rescuedTexts(h).sort(), ['words A', 'words B'])
	h.s.destroy()
})

test('T6: two texts rejected, both items deleted → both texts in the dialog', async () => {
	const h = await open({
		Scene: EditorScene,
		items: [sticky(A, { data: { text: 'hello' } }), sticky(B)],
		reply: (b) => (b.ops ? { rev: 7, removed: [A, B], acks: { seq: b.seq, rev: 7, res: b.ops.map(() => 'gone') }, presence: {} } : null),
	})
	h.scene.callbacks.onIntent(textA('words A'))
	h.scene.callbacks.onIntent(textB('words B'))
	await h.clock.advance(150)
	assert.equal(h.scene.callsOf('openTextEditor').length, 0)
	assert.deepEqual(h.ui.rescue.map((r) => [r.text, r.gone]), [['words A', true], ['words B', true]])
	h.s.destroy()
})

test('T6: mixed (A exists, B deleted) → A in a rescue editor, B in the dialog', async () => {
	const h = await open({
		Scene: EditorScene,
		items: [sticky(A, { data: { text: 'hello' } }), sticky(B)],
		reply: (b) => (b.ops ? { rev: 7, removed: [B], acks: { seq: b.seq, rev: 7, res: b.ops.map((op) => (op.id === A ? 'bad' : 'gone')) }, presence: {} } : null),
	})
	h.scene.callbacks.onIntent(textA('words A'))
	h.scene.callbacks.onIntent(textB('words B'))
	await h.clock.advance(150)
	assert.deepEqual(h.scene.callsOf('openTextEditor').map((c) => [c[1], c[2].text]), [[A, 'words A']])
	assert.deepEqual(h.ui.rescue.map((r) => r.text), ['words B'])
	h.s.destroy()
})

test('T6: rejections in two consecutive answers → the first rescue editor stays, the second text goes to the dialog', async () => {
	const h = await open({ Scene: EditorScene, items: [sticky(A, { data: { text: 'hello' } }), sticky(B)], codes: (ops) => ops.map(() => 'bad') })
	h.scene.callbacks.onIntent(textA('words A'))
	await h.clock.advance(150)
	assert.equal(h.scene.editing, A)
	h.scene.callbacks.onIntent(textB('words B'))
	await h.clock.advance(400)
	assert.equal(h.scene.callsOf('openTextEditor').length, 1)
	assert.equal(h.scene.editing, A, 'the rescue editor with text A was not replaced')
	assert.deepEqual(h.ui.rescue.map((r) => r.text), ['words B'])
	h.s.destroy()
})

test('T6: a normal editor open on C plus a rescue for A → no openTextEditor, A\'s text in the dialog', async () => {
	const h = await open({ Scene: EditorScene, items: [sticky(A, { data: { text: 'hello' } }), sticky(C)], codes: (ops) => ops.map((op) => (op.id === A ? 'bad' : 'ok')) })
	h.scene.callbacks.onIntent(textA('words A'))
	h.scene.editing = C
	h.scene.active.add(C)
	h.scene.callbacks.onEditing(C, false)
	await h.clock.advance(150)
	assert.equal(h.scene.callsOf('openTextEditor').length, 0, 'focus stays in the editor the user is typing in')
	assert.equal(h.scene.editing, C)
	assert.deepEqual(h.ui.rescue.map((r) => [r.id, r.text]), [[A, 'words A']])
	h.s.destroy()
})

test('T17: resync while editing an item deleted remotely → the model keeps it; the final text is rescued on gone', async () => {
	let serverItems = [sticky(A, { data: { text: 'hello' } })]
	const h = await open({
		items: [],
		reply: (b, n) => {
			if (n === 2) {
				// another client deleted A; this answer forces a resync
				serverItems = []
				return { rev: 9, resync: true, presence: {} }
			}
			if (b.ops) {
				return { rev: 10, acks: { seq: b.seq, rev: 10, res: b.ops.map((op) => (op.id === A ? 'gone' : 'ok')) }, presence: {} }
			}
			return null
		},
	})
	// open() read `items` once; serve the current server state from now on
	h.tr.snapshot = async () => ({ proto: 2, epoch: 'k3x9a0b2', rev: 9, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', links: { edit: null, vote: null } }, me: ME, items: serverItems })
	h.s.replica.loadSnapshot([sticky(A, { data: { text: 'hello' } })], 5)
	h.model.load([sticky(A, { data: { text: 'hello' } })])
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	await h.clock.advance(1000)
	assert.equal(h.s.counters.resyncs, 1)
	assert.equal(h.model.has(A), true, 'the item being edited stays in the model')
	h.scene.callbacks.onIntent(textA('final words'))
	assert.equal(h.s.replica.pendingCount(), 1, 'the final text goes out as a patch')
	h.scene.active.delete(A)
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(200)
	assert.deepEqual(h.ui.rescue.map((r) => [r.id, r.text, r.gone]), [[A, 'final words', true]])
	h.s.destroy()
})

test('T17 backstop: a text intent for an id the model no longer has → copy dialog, not dropped', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'text', id: B, path: 'data.text', value: 'orphan text', before: '', final: false })
	assert.deepEqual(h.ui.rescue, [], 'intermediate texts wait for the final one')
	h.scene.callbacks.onIntent({ type: 'text', id: B, path: 'data.text', value: 'orphan text!', before: '', final: true })
	assert.deepEqual(h.ui.rescue.map((r) => [r.id, r.text, r.gone]), [[B, 'orphan text!', true]])
	h.scene.callbacks.onIntent({ type: 'text', id: B, path: 'data.text', value: '', before: '', final: true })
	assert.equal(h.ui.rescue.length, 1, 'nothing typed, nothing to rescue')
	h.s.destroy()
})

/**
 * LWW mini server for the keepalive cases (§4.6 codes, tombstones, revive)
 * with a gate that holds the next regular /sync on the wire.
 *
 * @param {object[]} items live items at the start
 * @return {object} server
 */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, log: [], gate: null }
	const changed = []
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
			applyPatch(it, op.p)
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) {
				return 'gone'
			}
			srv.live.delete(op.id)
			srv.dead.add(op.id)
		}
		srv.rev++
		changed.push([srv.rev, op.id])
		return 'ok'
	}
	srv.applyBody = (body) => {
		const res = (body.ops ?? []).map(apply)
		srv.log.push([body.keepalive ? 'keepalive' : 'sync', res])
		return res
	}
	srv.answer = (body) => {
		const res = body.ops ? srv.applyBody(body) : null
		const ids = new Set(changed.filter(([r]) => r > body.since).map(([, id]) => id))
		const out = {
			rev: srv.rev,
			items: [...ids].filter((id) => srv.live.has(id)).map((id) => structuredClone(srv.live.get(id))),
			removed: [...ids].filter((id) => !srv.live.has(id)),
			presence: {},
		}
		if (res) {
			out.acks = { seq: body.seq, rev: srv.rev, res }
		}
		return out
	}
	return srv
}

/**
 * Session against lwwServer: keepalive bodies are applied too; srv.hold()
 * keeps the next regular request on the wire until release().
 *
 * @param {object} srv server
 * @param {object} [o] open() options
 * @return {Promise<object>} harness plus hold/release
 */
async function openLww(srv, o = {}) {
	let held = null
	let holdNext = false
	const h = await open({
		...o,
		items: [...srv.live.values()],
		reply: (body) => {
			if (holdNext) {
				holdNext = false
				return new Promise((resolve) => { held = () => resolve(srv.answer(body)) })
			}
			return srv.answer(body)
		},
	})
	const plain = h.tr.sync
	h.tr.sync = (body, opts = {}) => {
		if (opts.keepalive) {
			srv.applyBody({ ...body, keepalive: true })
		}
		return plain(body, opts)
	}
	h.hold = () => { holdNext = true }
	h.release = () => {
		const r = held
		held = null
		r?.()
	}
	return h
}

test('T15 (R1): delete → tab hidden (keepalive applies it) → back → undo while a /sync is held → the item lives', async () => {
	const srv = lwwServer([sticky(A, { x: 10, y: 20, data: { text: 'keep me' } })])
	const win = fakeWin()
	const h = await openLww(srv, { win })
	await h.clock.advance(1000)
	h.hold()
	await h.clock.advance(1000)
	h.scene.callbacks.onIntent({ type: 'delete', ids: [A] })
	win.document.visibilityState = 'hidden'
	win.fire('visibilitychange')
	assert.equal(srv.live.has(A), false, 'the keepalive applied the remove')
	win.document.visibilityState = 'visible'
	win.fire('visibilitychange')
	h.scene.callbacks.onIntent({ type: 'undo' })
	assert.equal(h.model.has(A), true)
	h.release()
	await h.clock.advance(3000)
	assert.equal(srv.live.has(A), true, 'undo reached the server')
	assert.equal(srv.live.get(A).data.text, 'keep me')
	assert.equal(h.model.has(A), true, 'and the client still shows it')
	assert.deepEqual(h.toasts, [], 'no false "Undo not possible"')
	h.s.destroy()
})

test('T15 (R2): new note → tab hidden (keepalive creates it) → back → typing while a /sync is held → the text arrives', async () => {
	const srv = lwwServer([])
	const win = fakeWin()
	const h = await openLww(srv, { win })
	await h.clock.advance(1000)
	h.hold()
	await h.clock.advance(1000)
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	const N = h.scene.selection[0]
	win.document.visibilityState = 'hidden'
	win.fire('visibilitychange')
	assert.equal(srv.live.has(N), true, 'the keepalive created the note')
	win.document.visibilityState = 'visible'
	win.fire('visibilitychange')
	h.scene.callbacks.onIntent({ type: 'text', id: N, path: 'data.text', value: 'Budget 2027: 1.2 M', before: '', final: true })
	h.release()
	await h.clock.advance(3000)
	assert.equal(srv.live.get(N).data.text, 'Budget 2027: 1.2 M')
	assert.equal(h.model.get(N).data.text, 'Budget 2027: 1.2 M')
	assert.deepEqual(h.ui.rescue, [])
	h.s.destroy()
})

test('T15: a resent remove the keepalive already applied answers gone → success, no "Undo not possible" (backoff case)', async () => {
	const srv = lwwServer([sticky(A, { x: 10, y: 20 })])
	const win = fakeWin()
	let fail = 0
	const h = await openLww(srv, { win })
	const answer = h.tr.sync
	h.tr.sync = (body, opts = {}) => {
		if (!opts.keepalive && fail > 0) {
			fail--
			return Promise.reject(new HttpError(503, 'http_503', '', null, true))
		}
		return answer(body, opts)
	}
	await h.clock.advance(1000)
	fail = 1
	await h.clock.advance(1000)
	assert.equal(h.s.sync.failures, 1, 'in a failure backoff')
	h.scene.callbacks.onIntent({ type: 'delete', ids: [A] })
	win.document.visibilityState = 'hidden'
	win.fire('visibilitychange')
	h.hold()
	win.document.visibilityState = 'visible'
	win.fire('visibilitychange')
	await h.clock.advance(0)
	assert.deepEqual(h.s.replica.inflight?.ops.map((o) => o.o), ['remove'], 'back in the tab: the remove is on the wire again')
	h.scene.callbacks.onIntent({ type: 'undo' })
	h.release()
	await h.clock.advance(3000)
	assert.deepEqual(h.toasts, [], 'the repeated remove answered gone: that is success, not a failed undo')
	assert.equal(srv.live.has(A), true)
	assert.equal(h.model.has(A), true)
	h.s.destroy()
})

test('T15/T6: two text patches of one item in one batch (barrier) both rejected → only the newest text is rescued', async () => {
	const win = fakeWin()
	const h = await open({ Scene: EditorScene, win, codes: (ops) => ops.map(() => 'bad') })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'older', before: 'hello', final: false })
	win.document.visibilityState = 'hidden'
	win.fire('visibilitychange')
	win.document.visibilityState = 'visible'
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'newer', before: 'hello', final: true })
	assert.equal(h.s.replica.queue.length, 2, 'the flushed patch is behind the barrier')
	win.fire('visibilitychange')
	await h.clock.advance(150)
	assert.deepEqual(rescuedTexts(h), ['newer'])
	h.s.destroy()
})

// ---- U8 / U7 -----------------------------------------------------------------

test('U8: a text op the server answers with 500 every time → dropped after isolation with a toast, its text reopens in the rescue editor; a move in the same batch is saved', async () => {
	const h = await open({
		items: [sticky(A, { data: { text: 'hello' } }), sticky(B, { x: 400 })],
		reply: (b) => ((b.ops ?? []).some((op) => op.p && op.p['data.text'] === 'great idea \u{1F44D}')
			? new HttpError(500, 'internal', 'Internal error', null, true)
			: null),
	})
	h.scene.callbacks.onIntent({ type: 'move', ids: [B], dx: 10, dy: 0, origin: new Map([[B, { x: 400, y: 0, parent: null }]]) })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'great idea \u{1F44D}', before: 'hello', final: true })
	await h.clock.advance(60000)
	const moved = h.tr.calls.some((c) => (c.ops ?? []).some((op) => op.id === B && op.p.x === 410))
	assert.ok(moved, 'the move went through')
	assert.deepEqual(h.toasts, ['A change could not be saved because of a server error.'])
	const opened = h.scene.callsOf('openTextEditor')
	assert.equal(opened.length, 1, 'text rescue')
	assert.equal(opened[0][2].text, 'great idea \u{1F44D}')
	assert.equal(h.s.replica.pendingCount(), 0)
	assert.equal(h.ui.status[h.ui.status.length - 1], 'online')
	h.s.destroy()
})

test('U7 contract: the server stores an altered value and returns the item in the same answer → the model converges to the stored value', async () => {
	const h = await open({
		reply: (b) => {
			if (!b.ops) {
				return null
			}
			const stored = sticky(A, { x: 10, y: 20, data: { text: 'great idea �' } })
			return { rev: 6, items: [stored], acks: { seq: b.seq, rev: 6, res: b.ops.map(() => 'ok') }, presence: {} }
		},
	})
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'great idea \u{1F44D}', before: 'hello', final: true })
	assert.equal(h.model.get(A).data.text, 'great idea \u{1F44D}', 'own text shown at once')
	await h.clock.advance(150)
	assert.equal(h.model.get(A).data.text, 'great idea �', 'the stored value wins once the answer is in')
	assert.equal(h.s.replica.visible(A).data.text, 'great idea �')
	// while the editor is open the item is deferred; it converges when the editor closes
	h.scene.active.add(A)
	h.scene.callbacks.onEditing(A, false)
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'more \u{1F600}', before: 'great idea �', final: false })
	await h.clock.advance(1000)
	h.scene.active.delete(A)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.get(A).data.text, 'great idea �', 'converged after the editor closed (the reply stores the same value here)')
	h.s.destroy()
})

// ---- U15: 'reload' (409 protocol) freezes the board -------------------------

/**
 * @param {string} href page URL
 * @return {object} fakeWin() plus a location that records replace()/reload()
 */
function reloadWin(href = 'http://nc.test/index.php/apps/knorke/b/7') {
	const win = fakeWin()
	win.navigated = []
	win.location = {
		href,
		replace: (u) => win.navigated.push(['replace', u]),
		reload: () => win.navigated.push(['reload']),
	}
	win.document.querySelectorAll = () => []
	return win
}

test('U15: 409 with nothing at stake → frozen like gone (view-only, no edits) and one cache-busting reload', async () => {
	const win = reloadWin()
	const h = await open({ win, reply: (b, n) => (n >= 2 ? new HttpError(409, 'protocol', '', null, true, { error: 'protocol', proto: 3 }) : null) })
	await h.clock.advance(1000)
	assert.equal(h.ui.status[h.ui.status.length - 1], 'reload')
	assert.deepEqual(h.scene.callsOf('setViewOnly').map((c) => c[1]), [true], 'scene view-only')
	assert.equal(h.s.frozen, true)
	await h.clock.settle()
	assert.equal(win.navigated.length, 1, 'reloaded once')
	assert.equal(win.navigated[0][0], 'replace')
	assert.match(win.navigated[0][1], /^http:\/\/nc\.test\/index\.php\/apps\/knorke\/b\/7\?knorke-reload=[a-z0-9]+$/, 'query bump')
	assert.equal(h.storage.getItem('session', 'knorke.reloaded'), '3', 'SPEC-M1 §4.3: the marker is the server protocol of the 409 body')
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	assert.equal(h.s.replica.pendingCount(), 0, 'no edit is accepted any more')
	h.s.destroy()
})

test('U15: 409 while editing → editor rescue notice, no automatic reload (the text would be gone), edits refused', async () => {
	const win = reloadWin()
	const h = await open({ win, reply: (b, n) => (n >= 2 ? new HttpError(409, 'protocol', '', null, true) : null) })
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	await h.clock.advance(1000)
	await h.clock.settle()
	assert.equal(h.ui.status[h.ui.status.length - 1], 'reload')
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1, 'the open editor keeps its text with a notice')
	assert.match(h.scene.callsOf('setEditorNotice')[0][2], /Not saved\. Copy your text/)
	assert.deepEqual(win.navigated, [], 'no reload while text is at stake; the banner offers it')
	const ev = win.fire('beforeunload', unloadEvent())
	assert.equal(h.s.replica.pendingCount(), 0, 'the text sits in the editor notice, no op is pending')
	assert.equal(ev.prevented, false, 'nothing pending: no leave prompt (R22: the prompt follows pending ops, also when frozen)')
	h.scene.callbacks.onIntent({ type: 'move', ids: [A], dx: 5, dy: 5, origin: new Map([[A, { x: 10, y: 20, parent: null }]]) })
	assert.equal(h.s.replica.pendingCount(), 0)
	h.s.destroy()
})

test('U15: the reloaded page still gets 409 for the same version on its first sync (marker = that version) → frozen, no reload loop', async () => {
	const win = reloadWin()
	const storage = memoryStorage()
	storage.setItem('session', 'knorke.reloaded', '3')
	const h = await open({ win, storage, reply: () => new HttpError(409, 'protocol', '', null, true, { error: 'protocol', proto: 3 }) })
	await h.clock.advance(1000)
	await h.clock.settle()
	assert.equal(h.s.frozen, true)
	assert.deepEqual(win.navigated, [])
	h.s.destroy()
	// a 409 without proto (an M0 server) uses the marker '?': same rule
	const win2 = reloadWin()
	const st2 = memoryStorage()
	const h2 = await open({ win: win2, storage: st2, reply: () => new HttpError(409, 'protocol', '', null, true) })
	await h2.clock.advance(1000)
	await h2.clock.settle()
	assert.equal(win2.navigated.length, 1)
	assert.equal(st2.getItem('session', 'knorke.reloaded'), '?')
	h2.s.destroy()
	const win3 = reloadWin()
	const h3 = await open({ win: win3, storage: st2, reply: () => new HttpError(409, 'protocol', '', null, true) })
	await h3.clock.advance(1000)
	await h3.clock.settle()
	assert.deepEqual(win3.navigated, [], 'the second "?" jump freezes')
	h3.s.destroy()
})

test('SPEC-M1 §4.3: a second protocol jump in the same tab session reloads again (marker 3, server now 4)', async () => {
	const win = reloadWin()
	const storage = memoryStorage()
	storage.setItem('session', 'knorke.reloaded', '3')
	const h = await open({ win, storage, reply: (b, n) => (n >= 2 ? new HttpError(409, 'protocol', '', null, true, { error: 'protocol', proto: 4 }) : null) })
	await h.clock.advance(1000)
	await h.clock.settle()
	assert.equal(h.ui.status[h.ui.status.length - 1], 'reload')
	assert.equal(win.navigated.length, 1, 'reloaded once for the new version')
	assert.equal(storage.getItem('session', 'knorke.reloaded'), '4')
	h.s.destroy()
})

test('SPEC-M1 §4.3: being online no longer clears the marker (the same jump after a successful start still freezes)', async () => {
	const storage = memoryStorage()
	storage.setItem('session', 'knorke.reloaded', '3')
	const h = await open({ storage })
	await h.clock.advance(1000)
	assert.equal(h.s.status, 'online')
	assert.equal(storage.getItem('session', 'knorke.reloaded'), '3')
	h.s.destroy()
})

// ---- U18: a client id cloned with sessionStorage (duplicated tab) -----------

/**
 * BroadcastChannel stand-in: one hub per test; messages reach every OTHER
 * open channel of the same name asynchronously (like the browser).
 *
 * @return {Function} constructor
 */
function fakeChannelHub() {
	const open = new Set()
	return class FakeChannel {
		constructor(name) {
			this.name = name
			this.onmessage = null
			this.closed = false
			open.add(this)
			FakeChannel.posts = FakeChannel.posts ?? []
		}

		postMessage(data) {
			FakeChannel.posts.push(structuredClone(data))
			for (const ch of open) {
				if (ch !== this && ch.name === this.name) {
					const copy = structuredClone(data)
					setImmediate(() => { if (!ch.closed) ch.onmessage?.({ data: copy }) })
				}
			}
		}

		close() {
			this.closed = true
			open.delete(this)
		}
	}
}

/**
 * @param {object} o options
 * @return {BoardSession} session against an idle fake server
 */
function idleSession({ clock, storage, BroadcastChannel }) {
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() { return { proto: 2, rev: 1, items: [], me: ME, board: { id: 7, role: 'owner' } } },
		async sync(b) { tr.calls.push(structuredClone(b)); return { rev: b.since, presence: {} } },
	}
	const s = new BoardSession({
		container: {},
		boardId: 7,
		ui: {},
		deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage, now: clock.now, sleep: clock.sleep, rand: () => 0.5, win: null, BroadcastChannel },
	})
	s.tr = tr
	return s
}

/**
 * @param {Map} m storage map
 * @return {object} memoryStorage with a copy of m (sessionStorage of a duplicated tab)
 */
function cloneSession(src) {
	const st = memoryStorage()
	for (const [k, v] of src.data.session) {
		st.data.session.set(k, v)
	}
	return st
}

test('U18: a duplicated tab (same client id in its cloned sessionStorage) gets a fresh id; the original keeps its own', async () => {
	const clock = new FakeClock(10000)
	const BC = fakeChannelHub()
	const st1 = memoryStorage()
	st1.setItem('session', 'knorke.client.7', 'cOriginal1')
	const s1 = idleSession({ clock, storage: st1, BroadcastChannel: BC })
	const p1 = s1.open()
	await clock.advance(300)
	await p1
	assert.equal(s1.client, 'cOriginal1', 'nobody else uses it')
	const st2 = cloneSession(st1)
	const s2 = idleSession({ clock, storage: st2, BroadcastChannel: BC })
	const p2 = s2.open()
	await clock.advance(300)
	await p2
	assert.notEqual(s2.client, 'cOriginal1', 'the duplicate does not reuse the live id')
	assert.match(s2.client, /^c[A-Za-z0-9]{9}$/)
	assert.equal(st2.getItem('session', 'knorke.client.7'), s2.client, 'stored for this tab')
	assert.equal(st1.getItem('session', 'knorke.client.7'), 'cOriginal1')
	await clock.advance(2000)
	assert.ok(s1.tr.calls.every((c) => c.client === 'cOriginal1'))
	assert.ok(s2.tr.calls.length > 0 && s2.tr.calls.every((c) => c.client === s2.client), 'every sync of the duplicate carries the new id')
	s1.destroy()
	s2.destroy()
})

test('U18: when the other tab is gone (session destroyed) the stored id is reused; without BroadcastChannel nothing changes', async () => {
	const clock = new FakeClock(10000)
	const BC = fakeChannelHub()
	const st1 = memoryStorage()
	st1.setItem('session', 'knorke.client.7', 'cOriginal1')
	const s1 = idleSession({ clock, storage: st1, BroadcastChannel: BC })
	const p1 = s1.open()
	await clock.advance(300)
	await p1
	s1.destroy()
	const s2 = idleSession({ clock, storage: cloneSession(st1), BroadcastChannel: BC })
	const p2 = s2.open()
	await clock.advance(300)
	await p2
	assert.equal(s2.client, 'cOriginal1', 'no live tab answers')
	s2.destroy()
	const s3 = idleSession({ clock, storage: cloneSession(st1), BroadcastChannel: null })
	await s3.open()
	assert.equal(s3.client, 'cOriginal1', 'no BroadcastChannel: the stored id, at once')
	s3.destroy()
})

test('U18: two tabs claiming the same id at the same time → exactly one keeps it', async () => {
	const clock = new FakeClock(10000)
	const BC = fakeChannelHub()
	const st1 = memoryStorage()
	st1.setItem('session', 'knorke.client.7', 'cTwin00001')
	const s1 = idleSession({ clock, storage: st1, BroadcastChannel: BC })
	const s2 = idleSession({ clock, storage: cloneSession(st1), BroadcastChannel: BC })
	const p = Promise.all([s1.open(), s2.open()])
	await clock.advance(300)
	await p
	const ids = [s1.client, s2.client]
	assert.equal(ids.filter((x) => x === 'cTwin00001').length, 1, ids.join(', '))
	assert.notEqual(s1.client, s2.client)
	s1.destroy()
	s2.destroy()
})

// ---- U19: an action that throws ------------------------------------------------

test('U19: an action throwing inside onIntent → toast, no exception into the scene, nothing sent; a final text goes to the copy dialog', async () => {
	class BrokenModel extends FakeModel {
		maxZ() { throw new Error('boom') }
		minZ() { throw new Error('boom') }
	}
	const h = await open({ items: [sticky(A, { data: { text: 'hello' } })] })
	// swap in the broken model (same items)
	const broken = new BrokenModel([...h.model.items.values()])
	h.s.model = broken
	const errors = []
	const orig = console.error
	console.error = (...a) => errors.push(a)
	try {
		assert.doesNotThrow(() => h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null }))
		assert.doesNotThrow(() => h.scene.callbacks.onIntent({ type: 'reorder', ids: [A], where: 'front' }))
		h.s.selection = [A]
		assert.doesNotThrow(() => h.s.reorder('back'))
		broken.has = () => { throw new Error('boom') }
		assert.doesNotThrow(() => h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'keep me', before: 'hello', final: true }))
	} finally {
		console.error = orig
	}
	assert.deepEqual(h.toasts, Array(4).fill('This change could not be applied.'))
	assert.ok(errors.length >= 4, 'logged for debugging')
	assert.deepEqual(h.ui.rescue, [{ id: A, text: 'keep me', gone: false }], 'a final text is never lost silently')
	assert.equal(h.s.replica.pendingCount(), 0)
	h.s.destroy()
})

// ---- SPEC-M1 stage 0 (WP-C0) ------------------------------------------------------

const LINK_TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs8t'

/**
 * Session against a transport whose snapshot is `snap` (no sync expected).
 *
 * @param {object} o options
 * @return {{s: BoardSession, ui: object, win: object, storage: object, clock: FakeClock, tr: object}}
 */
function bareSession({ snap, storage = memoryStorage(), win = reloadWin(), mode = 'user' }) {
	const clock = new FakeClock(10000)
	const ui = { status: [], board: [] }
	const tr = {
		kind: mode,
		calls: [],
		async snapshot() { return structuredClone(snap) },
		async join() { return structuredClone(snap) },
		async sync(b) { tr.calls.push(b); return { rev: b.since } },
	}
	const s = new BoardSession({
		container: {},
		mode,
		boardId: 7,
		linkToken: mode === 'guest' ? LINK_TOKEN : null,
		ui: { onStatus: (x) => ui.status.push(x), onBoard: (x) => ui.board.push(x) },
		deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage, now: clock.now, sleep: clock.sleep, win, toast: () => {} },
	})
	return { s, ui, win, storage, clock, tr }
}

for (const mode of ['user', 'guest']) {
	test('M1 §4.3 open (' + mode + '): a snapshot/join answer with another protocol → like a 409 before the first /sync: reload once per version, then frozen', async () => {
		const snap = { proto: 3, rev: 1, items: [], me: ME, board: { id: 7, role: 'owner' } }
		const a = bareSession({ snap, mode })
		await assert.rejects(a.s.open(), (e) => e instanceof HttpError && e.status === 409 && e.code === 'protocol' && e.body.proto === 3)
		await a.clock.settle()
		assert.deepEqual(a.ui.status, ['reload'])
		assert.equal(a.s.frozen, true)
		assert.equal(a.s.sync, null, 'no sync loop, no /sync')
		assert.equal(a.tr.calls.length, 0)
		assert.equal(a.win.navigated.length, 1, 'one cache-busting reload')
		assert.equal(a.storage.getItem('session', 'knorke.reloaded'), '3')
		// the reloaded page meets the same version (stale bundle from a cache): frozen, no loop
		const b = bareSession({ snap, mode, storage: a.storage })
		await assert.rejects(b.s.open(), (e) => e.status === 409)
		await b.clock.settle()
		assert.deepEqual(b.win.navigated, [])
		a.s.destroy()
		b.s.destroy()
	})
}

test('M1 §4.3 open: a snapshot without proto counts as a mismatch (marker "?")', async () => {
	const a = bareSession({ snap: { rev: 1, items: [], me: ME, board: { id: 7, role: 'owner' } } })
	await assert.rejects(a.s.open(), (e) => e.status === 409 && e.body.proto === '?')
	await a.clock.settle()
	assert.equal(a.storage.getItem('session', 'knorke.reloaded'), '?')
	a.s.destroy()
})

test('M1 §4.3 resync: a snapshot with another protocol stops the loop with reload (server version from the snapshot)', async () => {
	const win = reloadWin()
	const h = await open({ win, reply: (b, n) => (n === 2 ? { rev: 99, resync: true, presence: {} } : null) })
	h.tr.snapshot = async () => ({ proto: 3, rev: 9, items: [], me: ME, board: { id: 7 } })
	await h.clock.advance(1000)
	await h.clock.settle()
	assert.equal(h.ui.status[h.ui.status.length - 1], 'reload')
	assert.equal(h.s.sync.serverProto, 3)
	assert.equal(win.navigated.length, 1)
	assert.equal(h.storage.getItem('session', 'knorke.reloaded'), '3')
	h.s.destroy()
})

test('M1 §4.5 requests carry ep (epoch of the snapshot) and role (access level); debug.setEpoch forces another ep', async () => {
	const h = await open()
	assert.equal(h.tr.calls[0].ep, 'k3x9a0b2')
	assert.equal(h.tr.calls[0].role, 'owner')
	assert.equal('vt' in h.tr.calls[0], false, 'no vote tally before stage 3')
	debugApi(h.s).debug.setEpoch('zzzz0000')
	await h.clock.advance(1000)
	assert.equal(h.tr.calls[1].ep, 'zzzz0000')
	h.s.destroy()
})

test('M1 §4.9 access level from me.role and me.mod: owner, moderate (edit + mod), edit, vote, view; unknown → null', () => {
	const s = new BoardSession({ container: {}, ui: {}, deps: { storage: memoryStorage(), win: null } })
	const level = (me) => { s.me = me; return s.accessLevel() }
	assert.equal(level({ role: 'owner', mod: true }), 'owner')
	assert.equal(level({ role: 'edit', mod: true }), 'moderate')
	assert.equal(level({ role: 'edit', mod: false }), 'edit')
	assert.equal(level({ role: 'edit' }), 'edit')
	assert.equal(level({ role: 'vote' }), 'vote')
	assert.equal(level({ role: 'view' }), 'view')
	assert.equal(level({ role: 'moderate' }), null, 'never a role value of the server')
	assert.equal(level({ role: 'boss' }), null)
	assert.equal(level(null), null)
})

test('M1 §6.5.1 live title: board {title, metaRev} of a sync answer → merged board view (links kept); an old metaRev is ignored; only present keys merge', async () => {
	const answers = {
		2: { rev: 6, now: 1, board: { title: 'Renamed', meta: {}, metaRev: 6 }, presence: {} },
		3: { rev: 6, board: { title: 'Stale', metaRev: 5 }, presence: {} },
		4: { rev: 7, board: { meta: { timer: { state: 'paused' } }, metaRev: 7 }, presence: {} },
	}
	const h = await open({ reply: (b, n) => answers[n] ?? null })
	h.s.mergeBoard({ links: { edit: { token: LINK_TOKEN, url: 'u' }, vote: null } })
	await h.clock.advance(1000)
	let last = h.ui.board[h.ui.board.length - 1].board
	assert.equal(last.title, 'Renamed')
	assert.equal(last.metaRev, 6)
	assert.deepEqual(last.links.edit, { token: LINK_TOKEN, url: 'u' }, 'a meta update never replaces links (F3)')
	assert.equal(last.linksAllowed, true)
	const emits = h.ui.board.length
	await h.clock.advance(1000)
	assert.equal(h.ui.board.length, emits, 'metaRev 5 ≤ 6: ignored')
	await h.clock.advance(1000)
	last = h.ui.board[h.ui.board.length - 1].board
	assert.equal(last.title, 'Renamed', 'a block without title keeps the known title')
	assert.deepEqual(last.meta, { timer: { state: 'paused' } })
	assert.deepEqual(debugApi(h.s).meta(), { timer: { state: 'paused' } })
	assert.equal(debugApi(h.s).state().metaRev, 7)
	h.s.destroy()
})

test('M1 §6.5.1 own rename: an answer with metaRev takes the meta path (the next sync with the same metaRev changes nothing); without metaRev only the title', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 6, board: { title: 'Mine', meta: {}, metaRev: 6 }, presence: {} } : null) })
	h.s.applyBoardUpdate({ id: 7, title: 'Mine', meta: {}, metaRev: 6 })
	const emits = h.ui.board.length
	assert.equal(h.ui.board[emits - 1].board.title, 'Mine')
	await h.clock.advance(1000)
	assert.equal(h.ui.board.length, emits, 'the sync block with metaRev 6 is not applied twice')
	h.s.applyBoardUpdate({ id: 7, title: 'Plain M0 answer' })
	assert.equal(h.ui.board[h.ui.board.length - 1].board.title, 'Plain M0 answer')
	assert.equal(h.s.metaRev, 6, 'no metaRev, no change of the known one')
	h.s.destroy()
})

/**
 * The own rename as BoardView does it (SPEC-M1 §6.5.1, §15 R4): the real
 * api/boards.js renameBoard against a fake REST answer, its `board` into
 * session.applyBoardUpdate; the sync loop runs on the fake sync transport.
 *
 * @param {object} h harness of open()
 * @param {object} answer fake answer of PATCH /api/v1/boards/7
 * @return {Promise<object>} the `board` of the answer
 */
async function renameVia(h, answer) {
	const saved = { ...boardsApi.deps }
	const rest = []
	boardsApi.deps.urlOf = (p) => '/index.php/apps/knorke' + p
	boardsApi.deps.request = async (method, url, opts) => {
		rest.push({ method, url, body: opts.body })
		return structuredClone(answer)
	}
	try {
		const b = await boardsApi.renameBoard(7, 'Mine')
		h.s.applyBoardUpdate(b)
		assert.deepEqual(rest, [{ method: 'PATCH', url: '/index.php/apps/knorke/api/v1/boards/7', body: { title: 'Mine' } }])
		return b
	} finally {
		Object.assign(boardsApi.deps, saved)
	}
}

/** Board object of route 7 on an M1 server: the list row plus meta and metaRev from MetaService::write. */
const RENAMED = (o = {}) => ({ board: { id: 7, title: 'Mine', role: 'owner', updatedAt: 1760100000000, owner: { uid: 'alice', name: 'Alice Adler' }, viaLink: false, linksAllowed: false, meta: {}, metaRev: 6, ...o } })

test('M1 §6.5.1/§15 own rename through the API (fake REST + fake sync transport): {title, meta, metaRev} takes the onMeta path; only title/meta merge; the sync block with the same metaRev changes nothing', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 6, now: 1, board: { title: 'Mine', meta: {}, metaRev: 6 }, presence: {} } : null) })
	h.s.mergeBoard({ links: { edit: { token: LINK_TOKEN, url: 'u' }, vote: null } })
	const before = h.ui.board.length
	const syncs = h.tr.calls.length
	await renameVia(h, RENAMED())
	assert.equal(h.ui.board.length, before + 1, 'one board update for the own rename')
	const last = h.ui.board[h.ui.board.length - 1].board
	assert.equal(last.title, 'Mine')
	assert.equal(last.metaRev, 6)
	assert.deepEqual(last.meta, {})
	assert.equal(last.linksAllowed, true, 'linksAllowed of the list row in the answer is not merged')
	assert.deepEqual(last.links.edit, { token: LINK_TOKEN, url: 'u' }, 'links stay (F3)')
	assert.equal('owner' in last, false, 'no list-row keys (owner, viaLink, updatedAt) in the board view')
	assert.equal('viaLink' in last, false)
	assert.equal(h.s.metaRev, 6)
	assert.equal(h.tr.calls.length, syncs, 'the rename sends no extra /sync')
	await h.clock.advance(1000)
	assert.equal(h.tr.calls.length, syncs + 1)
	assert.equal(h.ui.board.length, before + 1, 'the next sync with metaRev 6 is not applied a second time')
	h.s.destroy()
})

test('M1 §6.5.1/§15 own rename: an answer with metaRev ≤ known is ignored as a whole (a newer rename from another tab arrived first and stays)', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 8, now: 1, board: { title: 'From tab B', meta: { timer: { state: 'paused' } }, metaRev: 8 }, presence: {} } : null) })
	await h.clock.advance(1000)
	assert.equal(h.s.metaRev, 8)
	const before = h.ui.board.length
	await renameVia(h, RENAMED({ title: 'Mine', meta: {}, metaRev: 7 }))
	assert.equal(h.ui.board.length, before, 'metaRev 7 ≤ 8: no update')
	assert.equal(h.s.board.title, 'From tab B', 'the late own answer never brings an older title back')
	assert.deepEqual(h.s.board.meta, { timer: { state: 'paused' } })
	assert.equal(h.s.applyBoardUpdate({ title: 'Mine', meta: {}, metaRev: 8 }), false, 'equal metaRev: ignored too')
	assert.equal(h.s.board.title, 'From tab B')
	h.s.destroy()
})

test('M1 §6.5.1/§15 own rename: an answer with metaRev but without the meta map merges only the title and keeps the known metaRev, so the sync block still brings the meta', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 8, now: 1, board: { title: 'Mine', meta: { timer: { state: 'paused' } }, metaRev: 8 }, presence: {} } : null) })
	const before = h.ui.board.length
	const answer = RENAMED({ metaRev: 8 })
	delete answer.board.meta
	const b = await renameVia(h, answer)
	assert.equal('meta' in b, false, 'fake answer without meta')
	assert.equal(h.ui.board.length, before + 1)
	assert.equal(h.s.board.title, 'Mine', 'the title shows at once')
	assert.equal(h.s.metaRev, 0, 'known metaRev unchanged: the answer is not the whole state at 8')
	assert.deepEqual(h.s.board.meta, {}, 'meta kept')
	await h.clock.advance(1000)
	assert.equal(h.s.metaRev, 8)
	assert.deepEqual(h.s.board.meta, { timer: { state: 'paused' } }, 'a meta change by someone else between 0 and 8 is not lost')
	assert.equal(h.s.board.title, 'Mine')
	h.s.destroy()
})

test('M1 §6.5.1/§15 own rename without metaRev (M0 answer): only the title merges, as before; no title, no update', async () => {
	const h = await open()
	await renameVia(h, { board: { id: 7, title: 'Mine', role: 'owner', updatedAt: 1, owner: { uid: 'alice', name: 'Alice Adler' }, viaLink: false, linksAllowed: false } })
	assert.equal(h.s.board.title, 'Mine')
	assert.equal(h.s.board.linksAllowed, true, 'only the title is merged')
	assert.equal('owner' in h.s.board, false)
	assert.equal(h.s.metaRev, 0)
	const n = h.ui.board.length
	assert.equal(h.s.applyBoardUpdate({ id: 7 }), false)
	assert.equal(h.s.applyBoardUpdate(null), false)
	assert.equal(h.ui.board.length, n)
	h.s.destroy()
})

test('M1 §6.5.1 meta map: an empty list (PHP json_encode of an empty array) counts as {} in sync blocks and in the rename answer; a non-empty list or a scalar is no meta (the known one stays)', async () => {
	const answers = {
		2: { rev: 6, now: 1, board: { title: 'T', meta: { timer: { state: 'paused' } }, metaRev: 6 }, presence: {} },
		3: { rev: 7, now: 1, board: { title: 'T', meta: [], metaRev: 7 }, presence: {} },
		4: { rev: 8, now: 1, board: { title: 'T', meta: { timer: { state: 'running' } }, metaRev: 8 }, presence: {} },
		5: { rev: 9, now: 1, board: { title: 'T2', meta: ['x'], metaRev: 9 }, presence: {} },
		6: { rev: 10, now: 1, board: { title: 'T3', meta: 'x', metaRev: 10 }, presence: {} },
	}
	const h = await open({ reply: (b, n) => answers[n] ?? null })
	await h.clock.advance(1000)
	assert.deepEqual(h.s.board.meta, { timer: { state: 'paused' } })
	await h.clock.advance(1000)
	assert.deepEqual(h.s.board.meta, {}, 'meta [] = the empty map: the timer is gone')
	await h.clock.advance(1000)
	await h.clock.advance(1000)
	assert.equal(h.s.board.title, 'T2')
	assert.deepEqual(h.s.board.meta, { timer: { state: 'running' } }, 'a non-empty list is no meta')
	await h.clock.advance(1000)
	assert.equal(h.s.board.title, 'T3')
	assert.deepEqual(h.s.board.meta, { timer: { state: 'running' } }, 'a scalar is no meta')
	assert.equal(h.s.metaRev, 10)
	await renameVia(h, RENAMED({ meta: [], metaRev: 11 }))
	assert.equal(h.s.metaRev, 11, 'the rename answer with meta [] is the whole state: onMeta path')
	assert.deepEqual(h.s.board.meta, {})
	assert.equal(h.s.board.title, 'Mine')
	h.s.destroy()
})

test('M1 resync: the snapshot replaces the board view (also a LOWER metaRev after a restore) and the epoch', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: 6, board: { title: 'Before', metaRev: 40 }, presence: {} } : n === 3 ? { rev: 99, resync: true, presence: {} } : null) })
	h.tr.snapshot = async () => ({ proto: 2, epoch: 'newep001', rev: 3, minRev: 0, board: { id: 7, title: 'Restored', role: 'owner', metaRev: 2, meta: {}, links: { edit: null, vote: null } }, me: ME, items: [] })
	await h.clock.advance(2000)
	const last = h.ui.board[h.ui.board.length - 1].board
	assert.equal(last.title, 'Restored')
	assert.equal(h.s.metaRev, 2)
	await h.clock.advance(1000)
	assert.equal(h.tr.calls[h.tr.calls.length - 1].ep, 'newep001')
	h.s.destroy()
})

test('M1 §6.4 busy: 30 s of busy answers in a row → ONE info toast, status stays online, the ops arrive afterwards', async () => {
	let busyUntil = Infinity
	const h = await open({
		reply: (b) => (b.ops && h0.clock.now() < busyUntil
			? { rev: b.since, acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'busy'), retryMs: 4000 }, presence: {} }
			: null),
	})
	const h0 = h
	h.scene.callbacks.onIntent({ type: 'move', ids: [A], dx: 5, dy: 5, origin: new Map([[A, { x: 10, y: 20, parent: null }]]) })
	await h.clock.advance(29000)
	assert.deepEqual(h.infos, [], 'not before 30 s')
	await h.clock.advance(6000)
	assert.deepEqual(h.infos, ['Changes are being saved more slowly. Nothing is lost.'])
	await h.clock.advance(20000)
	assert.equal(h.infos.length, 1, 'once')
	assert.ok(!h.ui.status.includes('offline'))
	assert.equal(h.s.replica.pendingCount(), 1)
	busyUntil = 0
	await h.clock.advance(6000)
	assert.equal(h.s.replica.pendingCount(), 0)
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('M1 §4.6 closed drops the vote op with "Voting has ended."; an unknown code counts as bad (warning, text rescue)', async () => {
	const h = await open({ codes: (ops) => ops.map((op) => (op.o === 'vote' ? 'closed' : 'weird_new_code')) })
	const warned = []
	const orig = console.warn
	console.warn = (...a) => warned.push(a)
	try {
		h.s.sync.enqueue([{ o: 'vote', s: 12, id: A, n: 1 }])
		await h.clock.advance(1000)
		assert.deepEqual(h.infos, ['Voting has ended.'])
		h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'new text', before: 'hello', final: true })
		await h.clock.advance(1000)
		await h.clock.settle()
	} finally {
		console.warn = orig
	}
	assert.ok(warned.some((w) => /unknown result code weird_new_code/.test(String(w[0]))), 'warned')
	const reopened = h.scene.callsOf('openTextEditor').at(-1)
	assert.equal(reopened[1], A, 'the rejected text reopens like for bad')
	assert.equal(reopened[2].text, 'new text')
	assert.equal(h.s.replica.pendingCount(), 0)
	h.s.destroy()
})

test('M1 §4.2 (R2) gone of a link member (me.source link) carries the reason link; own boards do not', async () => {
	const meLink = { ...ME, role: 'edit', mod: false, source: 'link' }
	const h = await open({ reply: (b, n) => (n >= 2 ? new HttpError(404, 'not_found', '', null, true) : null) })
	h.s.me = meLink
	await h.clock.advance(1000)
	assert.equal(h.ui.status.at(-1), 'gone')
	assert.equal(h.ui.reasons.at(-1), 'link')
	h.s.destroy()
	const own = await open({ reply: (b, n) => (n >= 2 ? new HttpError(404, 'not_found', '', null, true) : null) })
	await own.clock.advance(1000)
	assert.equal(own.ui.status.at(-1), 'gone')
	assert.equal(own.ui.reasons.at(-1), null)
	own.s.destroy()
})

test('M1 §6.7 uiMode: edit on a fine-pointer device, view on a view-only device; mode stays user/guest', async () => {
	const h = await open()
	assert.equal(debugApi(h.s).state().uiMode, 'edit')
	assert.equal(debugApi(h.s).state().mode, 'user')
	h.s.destroy()
	const v = await open({ viewOnly: true })
	assert.equal(debugApi(v.s).state().uiMode, 'view')
	v.s.destroy()
})

test('M1 §6.5.7 the snapshot\'s and the sync answers\' now feed the clock (state().clockOffset)', async () => {
	const h = await open({ reply: (b, n) => (n === 2 ? { rev: b.since, now: 1760100000000 + 1000 + 5000, presence: {} } : null) })
	assert.equal(debugApi(h.s).state().clockOffset, 0, 'snapshot: server and wall clock agree')
	assert.equal(h.s.clock.samples.length, 1, 'the snapshot was sampled; the first sync answer of the fake carries no now → no sample')
	// only the next answer counts from here (fresh window)
	h.s.clock.samples = []
	await h.clock.advance(1000)
	// that answer came at fake time 11000 (wall 1760100001000) and says +5000
	assert.equal(debugApi(h.s).state().clockOffset, 5000)
	assert.equal(h.s.clock.now(), 1760100001000 + 5000)
	h.s.destroy()
})

/**
 * Guest session with a scripted fake guest transport (join + sync).
 *
 * @param {object} o options
 * @return {Promise<object>} harness
 */
async function guestSession({ sync, join }) {
	const clock = new FakeClock(10000)
	const ui = { status: [], rescue: [] }
	const tr = {
		kind: 'guest',
		calls: [],
		joins: 0,
		async join() {
			tr.joins++
			const r = join(tr.joins)
			if (r instanceof Error) {
				throw r
			}
			return r
		},
		async snapshot() { return join(0) },
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				return {}
			}
			tr.calls.push(structuredClone(body))
			const r = sync(body, tr.calls.length)
			if (r instanceof Error) {
				throw r
			}
			return r
		},
	}
	const s = new BoardSession({
		container: {},
		mode: 'guest',
		boardId: 7,
		linkToken: LINK_TOKEN,
		ui: { onStatus: (x) => ui.status.push(x), onRescue: (x) => ui.rescue.push(x) },
		deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0.5, win: null, toast: () => {}, info: () => {} },
	})
	await s.open('Gina')
	await clock.advance(0)
	return { s, clock, tr, ui, scene: s.scene }
}

const GUEST_SNAP = () => ({ proto: 2, epoch: 'k3x9a0b2', rev: 5, minRev: 0, board: { id: 7, title: 'B', role: 'edit', metaRev: 0, meta: {} }, me: { pid: 'pidgina000000001', name: 'Gina', role: 'edit', guest: true, mod: false, source: 'guest' }, items: [sticky(A, { data: { text: 'hello' } }), sticky(B, { x: 300, data: { text: 'two' } })], guest: { token: 'tok', exp: 1 } })

test('M1 §6.4 (R2) password_required: an open guest tab whose re-join needs the password freezes with password_required; unsentTexts() has the open editor\'s text and the unsent text ops', async () => {
	let locked = false
	const h = await guestSession({
		join: (n) => (n >= 2 ? new HttpError(403, 'password_required', '', null, true) : GUEST_SNAP()),
		sync: (b) => (locked ? new HttpError(403, 'link_revoked', '', null, true) : { rev: b.since, presence: {} }),
	})
	// B: a text op typed while the server already refuses (stays unsent)
	locked = true
	h.scene.callbacks.onIntent({ type: 'text', id: B, path: 'data.text', value: 'two, edited', before: 'two', final: true })
	// A: the open editor holds text that was not committed yet
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	h.scene.dirty = { id: A, value: 'hello and more', before: 'hello' }
	await h.clock.advance(1000)
	await h.clock.settle()
	assert.equal(h.tr.joins, 2, 'exactly one re-join')
	assert.equal(h.ui.status.at(-1), 'password_required')
	assert.equal(h.s.frozen, true)
	assert.equal(h.s.sync.running, false)
	const texts = h.s.unsentTexts()
	assert.deepEqual(texts.sort((x, y) => (x.id < y.id ? -1 : 1)), [
		{ id: A, text: 'hello and more', gone: false },
		{ id: B, text: 'two, edited', gone: false },
	])
	assert.equal(h.scene.callsOf('setEditorNotice').length, 1, 'the editor got its notice after the text was caught')
	h.s.destroy()
})

test('M1 (M0 §16.2) a guest re-join after the claim carries the claimed client id (guestTransport getClient)', async () => {
	const clock = new FakeClock(10000)
	const BC = fakeChannelHub()
	const st1 = memoryStorage()
	st1.setItem('session', 'knorke.client.7', 'cOriginal1')
	// the original tab holds the id
	const s1 = idleSession({ clock, storage: st1, BroadcastChannel: BC })
	const p1 = s1.open()
	await clock.advance(300)
	await p1
	// a duplicated guest tab with the same stored id, real guestTransport over a fake request
	const st2 = cloneSession(st1)
	const joins = []
	const syncs = []
	const request = async (method, url, opts) => {
		if (url.endsWith('/join')) {
			joins.push(opts.body.client)
			return GUEST_SNAP()
		}
		syncs.push(opts.body.client)
		if (syncs.length === 1) {
			throw new HttpError(401, 'guest_token', '', null, true)
		}
		return { rev: opts.body.since }
	}
	const s2 = new BoardSession({
		container: {},
		mode: 'guest',
		boardId: 7,
		linkToken: LINK_TOKEN,
		ui: {},
		deps: { SceneModel: FakeModel, SceneManager: FakeScene, request, urlOf: (p) => p, storage: st2, now: clock.now, sleep: clock.sleep, rand: () => 0.5, win: null, BroadcastChannel: BC },
	})
	const p2 = s2.open('Gina')
	await clock.advance(300)
	await p2
	await clock.advance(0)
	assert.notEqual(s2.client, 'cOriginal1', 'the duplicate took a fresh id')
	assert.deepEqual(joins, ['cOriginal1', s2.client], 'the first join went out before the claim; the re-join carries the claimed id')
	assert.ok(syncs.every((c) => c === s2.client))
	s1.destroy()
	s2.destroy()
})

test('M1 §4.2 (R2) open: a snapshot answering 429 slow_down waits max(retryMs, 2000) × (1 + 0–20 %), doubling, and is never final', async () => {
	const clock = new FakeClock()
	const at = []
	const tr = {
		kind: 'user',
		async snapshot() {
			at.push(clock.now())
			if (at.length <= 25) {
				throw new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 2000 })
			}
			return { proto: 2, rev: 1, items: [], me: ME, board: { id: 7, role: 'owner' } }
		},
		async sync(b) { return { rev: b.since } },
	}
	const s = new BoardSession({ container: {}, boardId: 7, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null } })
	const p = s.open()
	await clock.advance(2 * 60 * 60 * 1000)
	await p
	assert.equal(at.length, 26, 'more attempts than the proxy limit of 20: slow_down is never final')
	assert.deepEqual(at.slice(1, 7).map((t, i) => t - at[i]), [2000, 4000, 8000, 16000, 32000, 60000], 'doubling up to 60 s')
	assert.equal(s.sync.running, true)
	s.destroy()
	// destroyed while waiting: no further request, the error comes out
	let n = 0
	const tr2 = { kind: 'user', async snapshot() { n++; throw new HttpError(429, 'slow_down', '', null, true, { retryMs: 2000 }) } }
	const s2 = new BoardSession({ container: {}, boardId: 7, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr2, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null } })
	const rejected = assert.rejects(s2.open(), (e) => e.code === 'slow_down')
	await clock.advance(1000)
	s2.destroy()
	await clock.advance(5000)
	await rejected
	assert.equal(n, 1)
})

// ---- SPEC-M1 stage 1, round 1a (§6.5.1–§6.5.3) ---------------------------------

const S1 = ID('S1')
const T1 = ID('T1')
const K1 = ID('K1')

/**
 * @param {object} h harness
 * @param {string} id item id
 * @return {object[]} every op sent for id, in order
 */
function opsFor(h, id) {
	return h.tr.calls.flatMap((c) => c.ops ?? []).filter((o) => o.id === id)
}

/**
 * A fake paste catcher (textarea[data-knorke-paste-catcher]).
 *
 * @return {object} element with .handlers and .focused
 */
function fakeCatcher() {
	return {
		value: '',
		focused: 0,
		handlers: {},
		focus() { this.focused++ },
		addEventListener(type, fn) { this.handlers[type] = fn },
		removeEventListener(type, fn) { if (this.handlers[type] === fn) delete this.handlers[type] },
		paste(data) {
			let prevented = false
			this.handlers.paste({
				preventDefault: () => { prevented = true },
				clipboardData: { getData: (t) => data[t] ?? '', files: data.files ?? [] },
			})
			return prevented
		},
	}
}

/** DOMParser stand-in: finds [data-knorke-clip] in the HTML text. */
const parseHtml = (html) => ({
	querySelector: () => {
		const m = /data-knorke-clip="([^"]*)"/.exec(html)
		return m ? { getAttribute: () => m[1] } : null
	},
})

test('M1 create shape: the tool options travel in the put, the editor opens, creation and its first text are ONE undo step', async () => {
	const srv = lwwServer([])
	const h = await openLww(srv)
	h.scene.callbacks.onIntent({ type: 'create', t: 'shape', at: { x: 0, y: 0 }, rect: null, data: { kind: 'ellipse' } })
	const id = h.scene.selection[0]
	assert.equal(h.model.get(id).data.kind, 'ellipse')
	assert.deepEqual(h.scene.callsOf('openTextEditor').map((c) => c[1]), [id])
	h.scene.callbacks.onEditing(id, false)
	h.scene.callbacks.onIntent({ type: 'text', id, path: 'data.text', value: 'Idea', before: '', final: true })
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(150)
	assert.equal(h.model.get(id).data.text, 'Idea')
	assert.deepEqual([srv.live.get(id).data, srv.live.get(id).t], [{ kind: 'ellipse', text: 'Idea' }, 'shape'])
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.undo()
	assert.equal(h.model.has(id), false, 'one undo removes the shape with its text')
	await h.clock.advance(150)
	assert.equal(srv.live.has(id), false)
	h.s.destroy()
})

test('M1 create text: the put carries the measured height; an empty new text item vanishes when its editor closes, merged with its creation', async () => {
	const h = await open({ items: [] })
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 10, y: 20 }, rect: null })
	const id = h.scene.selection[0]
	assert.equal(h.scene.callsOf('measureTextHeight').length, 1)
	assert.equal(h.model.get(id).h, 28.8)
	assert.deepEqual(h.scene.callsOf('openTextEditor').map((c) => c[1]), [id])
	h.scene.callbacks.onEditing(id, false)
	h.scene.callbacks.onIntent({ type: 'text', id, path: 'data.text', value: '  ', before: '', final: true })
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(id), false)
	await h.clock.advance(1000)
	assert.deepEqual(opsFor(h, id), [], 'put and remove never left the queue')
	assert.equal(h.s.undoStack.done.length, 1, 'one step for creation and removal')
	// a text item that was not just created keeps its empty text
	const h2 = await open({ items: [textItem(T1, { data: { text: 'x' } })] })
	h2.scene.callbacks.onEditing(T1, false)
	h2.scene.callbacks.onIntent({ type: 'text', id: T1, path: 'data.text', value: '', before: 'x', final: true })
	h2.scene.callbacks.onEditing(null, false)
	assert.equal(h2.model.has(T1), true)
	h.s.destroy()
	h2.s.destroy()
})

test('M1 §6.5.2 fix R1: a new text item closed untouched (Esc / click beside: the real editor sends NO text intent) vanishes, one undo step with its creation', async () => {
	const h = await open({ items: [] })
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 10, y: 20 }, rect: null })
	const id = h.scene.selection[0]
	h.scene.callbacks.onEditing(id, false)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(id), false, 'the empty new text item is gone locally')
	assert.deepEqual(h.scene.selection, [], 'and out of the selection')
	assert.equal(h.s.newEdit, null)
	assert.equal(h.s.undoStack.done.length, 1, 'one step for creation and removal')
	await h.clock.advance(1000)
	assert.deepEqual(opsFor(h, id), [], 'put and remove never left the queue')
	h.s.undo()
	await h.clock.advance(1000)
	assert.equal(h.model.has(id), false, 'undoing the merged step brings no empty item back')
	assert.deepEqual(opsFor(h, id), [])
	h.s.destroy()
})

test('M1 §6.5.2 fix R1: the put already reached the server → closing untouched sends the remove (E22: only the typed text item stays on the server)', async () => {
	const srv = lwwServer([])
	const h = await openLww(srv)
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 10, y: 20 }, rect: null })
	const id = h.scene.selection[0]
	h.scene.callbacks.onEditing(id, false)
	await h.clock.advance(150)
	assert.equal(srv.live.has(id), true, 'the put went out while the editor was open')
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(id), false)
	await h.clock.advance(1000)
	assert.equal(srv.live.has(id), false, 'the server deleted it too')
	assert.deepEqual(opsFor(h, id).map((o) => o.o), ['put', 'remove'])
	assert.equal(h.s.undoStack.done.length, 1)
	// E22 shape: a click beside with the text tool (pointerdown ends the open
	// editor first, then the create intent) leaves only the typed item
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 300, y: 20 }, rect: null })
	const a = h.scene.selection[0]
	h.scene.callbacks.onEditing(a, false)
	h.scene.callbacks.onIntent({ type: 'text', id: a, path: 'data.text', value: 'eins', before: '', final: true })
	h.scene.callbacks.onEditing(null, false)
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 600, y: 20 }, rect: null })
	const b = h.scene.selection[0]
	h.scene.callbacks.onEditing(b, false)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(a), true, 'the typed text item stays')
	assert.equal(h.model.has(b), false, 'the untouched one is gone')
	await h.clock.advance(1000)
	assert.deepEqual([...srv.live.values()].map((it) => [it.t, it.data.text]), [['text', 'eins']])
	h.s.destroy()
})

test('M1 §6.5.2 fix R1: opening the next new editor while an untouched new text editor is open (the real scene finishes the open editor inside openTextEditor) deletes the first one', async () => {
	const h = await open({ items: [] })
	// like SceneManager.#openEditor: finish the open editor (onEditing null), then open (onEditing id)
	let editing = null
	h.scene.openTextEditor = (id) => {
		h.scene.log('openTextEditor', id, {})
		if (editing !== null) {
			editing = null
			h.scene.callbacks.onEditing(null, false)
		}
		editing = id
		h.scene.callbacks.onEditing(id, false)
		return true
	}
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 10, y: 20 }, rect: null })
	const a = h.scene.selection[0]
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 300, y: 20 }, rect: null })
	const b = h.scene.selection[0]
	assert.equal(h.model.has(a), false, 'the first empty new text item vanished when the next editor opened')
	assert.equal(h.model.has(b), true, 'the item being edited stays')
	assert.equal(h.s.newEdit?.id, b, 'the new editor is the new-edit one')
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(b), false)
	await h.clock.advance(1000)
	assert.deepEqual([...opsFor(h, a), ...opsFor(h, b)], [], 'nothing reached the server')
	h.s.destroy()
})

test('M1 §6.5.2 fix R1: closing untouched keeps a new NOTE, an existing empty text item, a new text item whose lease was lost, and everything on a frozen board', async () => {
	const h = await open({ items: [textItem(T1, { data: { text: '' } })] })
	// a new note stays empty (only text items vanish)
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 10, y: 20 }, rect: null })
	const n = h.scene.selection[0]
	h.scene.callbacks.onEditing(n, false)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(n), true, 'new note kept')
	// an existing (not new) empty text item stays
	h.scene.callbacks.onEditing(T1, false)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(T1), true, 'existing empty text item kept')
	// lease lost (the editor showed a notice): nothing is committed for it
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 300, y: 20 }, rect: null })
	const l = h.scene.selection[0]
	h.scene.callbacks.onEditing(l, false)
	h.s.loseLease(l, null)
	const steps = h.s.undoStack.done.length
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(l), true, 'lease lost: no delete')
	assert.equal(h.s.undoStack.done.length, steps)
	// frozen board: no commit at all
	h.scene.callbacks.onIntent({ type: 'create', t: 'text', at: { x: 600, y: 20 }, rect: null })
	const f = h.scene.selection[0]
	h.scene.callbacks.onEditing(f, false)
	h.s.frozen = true
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.model.has(f), true, 'frozen: no delete')
	assert.equal(h.s.newEdit, null, 'the new-edit marker is cleared anyway')
	h.s.destroy()
})

test('M1 series entry: Tab in a note editor commits, creates the next note right of it and opens its editor; Esc ends; one undo step per note', async () => {
	const srv = lwwServer([])
	const h = await openLww(srv)
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 100, y: 100 }, rect: null })
	const a = h.scene.selection[0]
	h.scene.callbacks.onEditing(a, false)
	h.scene.callbacks.onIntent({ type: 'text', id: a, path: 'data.text', value: 'one', before: '', final: true, next: 'right' })
	const b = h.scene.selection[0]
	assert.notEqual(b, a)
	assert.deepEqual([h.model.get(b).x, h.model.get(b).y, h.model.get(b).w], [h.model.get(a).x + 220, h.model.get(a).y, h.model.get(a).w])
	await Promise.resolve()
	assert.deepEqual(h.scene.callsOf('openTextEditor').map((c) => c[1]), [a, b])
	h.scene.callbacks.onEditing(b, false)
	h.scene.callbacks.onIntent({ type: 'text', id: b, path: 'data.text', value: 'two', before: '', final: true, next: 'right' })
	const c = h.scene.selection[0]
	await Promise.resolve()
	h.scene.callbacks.onEditing(c, false)
	h.scene.callbacks.onIntent({ type: 'text', id: c, path: 'data.text', value: 'three', before: '', final: true })
	h.scene.callbacks.onEditing(null, false)
	await Promise.resolve()
	assert.equal(h.scene.callsOf('openTextEditor').length, 3, 'Esc opens no further note')
	await h.clock.advance(1000)
	assert.deepEqual([a, b, c].map((id) => h.model.get(id).data.text), ['one', 'two', 'three'])
	assert.deepEqual([a, b, c].map((id) => srv.live.get(id).data.text), ['one', 'two', 'three'])
	assert.equal(h.s.undoStack.done.length, 3)
	h.s.undo()
	assert.equal(h.model.has(c), false)
	assert.equal(h.model.get(b).data.text, 'two')
	h.s.destroy()
})

test('M1 text intent of a text item: the measured height travels in the same patch (rule 13); the scene\'s h wins when given', async () => {
	const h = await open({ items: [textItem(T1)] })
	h.scene.callbacks.onIntent({ type: 'text', id: T1, path: 'data.text', value: 'a\nb', before: '', final: true })
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, T1).at(-1), { o: 'patch', id: T1, p: { 'data.text': 'a\nb', h: 57.6 } })
	h.scene.callbacks.onIntent({ type: 'text', id: T1, path: 'data.text', value: 'a', before: 'a\nb', final: true, h: 30 })
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, T1).at(-1), { o: 'patch', id: T1, p: { 'data.text': 'a', h: 30 } })
	h.s.destroy()
})

test('M1 setStyle(font size) on text: the target state is measured BEFORE the op, which carries the height; other types only get the size', async () => {
	const h = await open({ items: [textItem(T1, { data: { text: 'abcdefghijklmnopqrstuvwxyz' } }), shape(S1)] })
	h.scene.callbacks.onSelection([T1, S1])
	const before = h.scene.callsOf('measureTextHeight').length
	h.s.setStyle('style.fontSize', 48)
	const measured = h.scene.callsOf('measureTextHeight').slice(before)
	assert.equal(measured.length, 1)
	assert.equal(measured[0][1].style.fontSize, 48)
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, T1).at(-1), { o: 'patch', id: T1, p: { 'style.fontSize': 48, h: 172.8 } })
	assert.deepEqual(opsFor(h, S1).at(-1), { o: 'patch', id: S1, p: { 'style.fontSize': 48 } })
	h.s.setShapeKind('diamond')
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, S1).at(-1), { o: 'patch', id: S1, p: { 'data.kind': 'diamond' } })
	h.s.destroy()
})

test('M1 transform intent: text heights measured for the new width/size; frame keep leaves the children in place at once (Replica keep), one undo step', async () => {
	const h = await open({ items: [textItem(T1, { data: { text: 'abcdefghijklmnopqrstuvwxyz' } }), frame(F, { x: 100, y: 100, w: 400, h: 400 }), sticky(K1, { x: 300, y: 300, w: 50, h: 50, parent: F })] })
	h.scene.callbacks.onIntent({
		type: 'transform', ids: [T1], keep: false,
		before: new Map([[T1, { x: 0, y: 0, w: 240, h: 28.8, r: 0, parent: null, fontSize: 24 }]]),
		after: new Map([[T1, { x: 0, y: 0, w: 120, h: 28.8, r: 0, fontSize: 24 }]]),
	})
	assert.equal(h.scene.callsOf('measureTextHeight').at(-1)[1].w, 120)
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, T1).at(-1), { o: 'patch', id: T1, p: { x: 0, y: 0, parent: null, w: 120, h: 86.4, r: 0 } })
	const abs = h.model.abs(K1)
	h.scene.callbacks.onIntent({
		type: 'transform', ids: [F], keep: true,
		before: new Map([[F, { x: 100, y: 100, w: 400, h: 400, r: 0, parent: null }]]),
		after: new Map([[F, { x: 200, y: 200, w: 300, h: 300, r: 0 }]]),
	})
	assert.equal(h.model.get(F).x, 200)
	assert.deepEqual([h.model.abs(K1).x, h.model.abs(K1).y], [abs.x, abs.y], 'the child stays where it was')
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, F).at(-1), { o: 'patch', id: F, p: { x: 200, y: 200, parent: null, w: 300, h: 300, r: 0 }, keep: true })
	assert.deepEqual(opsFor(h, K1), [], 'the server shifts the child (rule 15), the client sends nothing for it')
	h.s.destroy()
})

test('M1 closing a text item\'s editor re-measures it and sends {h} when it differs by more than 0.5; not for other types', async () => {
	const srv = lwwServer([textItem(T1, { data: { text: 'a\nb\nc' }, h: 28.8 }), shape(S1)])
	const h = await openLww(srv)
	h.scene.callbacks.onEditing(T1, false)
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(150)
	assert.deepEqual(opsFor(h, T1), [{ o: 'patch', id: T1, p: { h: 86.4 } }])
	h.scene.callbacks.onEditing(T1, false)
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(150)
	assert.equal(opsFor(h, T1).length, 1, 'now within 0.5: nothing more')
	h.scene.callbacks.onEditing(S1, false)
	h.scene.callbacks.onEditing(null, false)
	assert.equal(h.scene.callsOf('measureTextHeight').filter((c) => c[1].id === S1).length, 0)
	h.s.destroy()
})

test('M1 arrow keys: moves without a drag within 1 s on the same items are ONE undo step; a drag is its own step', async () => {
	const h = await open({ items: [sticky(A, { x: 10, y: 20 })] })
	const nudge = (x) => h.scene.callbacks.onIntent({ type: 'move', ids: [A], dx: 1, dy: 0, origin: new Map([[A, { x, y: 20, parent: null }]]) })
	nudge(10)
	await h.clock.advance(200)
	nudge(11)
	assert.equal(h.model.get(A).x, 12)
	assert.equal(h.s.undoStack.done.length, 1)
	await h.clock.advance(1500)
	nudge(12)
	assert.equal(h.s.undoStack.done.length, 2, 'a pause starts a new step')
	h.scene.callbacks.onActivity({ kind: 'drag', active: true, ids: [A] })
	h.scene.callbacks.onIntent({ type: 'move', ids: [A], dx: 1, dy: 0, origin: new Map([[A, { x: 13, y: 20, parent: null }]]) })
	h.scene.callbacks.onActivity({ kind: 'drag', active: false, ids: [A] })
	assert.equal(h.s.undoStack.done.length, 3)
	h.s.undo()
	h.s.undo()
	assert.equal(h.model.get(A).x, 12)
	h.s.undo()
	assert.equal(h.model.get(A).x, 10)
	// the shell's nudge() does the same
	h.scene.callbacks.onSelection([A])
	h.s.nudge(0, 10)
	h.s.nudge(0, 10)
	assert.equal(h.model.get(A).y, 40)
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.destroy()
})

test('M1 copy (keydown intent, synchronous): clipboard written with both formats, copy stored with TTL entry, toast "{n} items copied"; nothing while an editor is open', async () => {
	const written = []
	const io = { clipboard: { write: async (items) => { written.push(items) } }, ClipboardItem: class { constructor(o) { this.o = o } }, Blob: class { constructor(p) { this.text = p.join('') } }, doc: null }
	const h = await open({ items: [sticky(A, { data: { text: 'hello' } }), sticky(B)], extraDeps: { clipboardIo: io } })
	h.scene.callbacks.onSelection([A])
	h.scene.callbacks.onIntent({ type: 'copy' })
	assert.equal(written.length, 1, 'written inside the keydown')
	assert.equal(written[0][0].o['text/plain'].text, 'hello')
	assert.ok(written[0][0].o['text/html'].text.includes('data-knorke-clip="v1.'))
	const stored = h.storage.getJson('local', CLIP_KEY)
	assert.deepEqual([stored.v, stored.text, stored.payload.board, stored.payload.items.map((it) => it.id)], [1, 'hello', 7, [A]])
	assert.deepEqual(h.infos, ['1 item copied'])
	h.scene.callbacks.onEditing(A, false)
	h.scene.callbacks.onIntent({ type: 'copy' })
	assert.equal(written.length, 1, 'an open editor copies its own text (browser default)')
	h.scene.callbacks.onEditing(null, false)
	h.scene.callbacks.onSelection([B])
	h.scene.callbacks.onIntent({ type: 'cut' })
	assert.equal(written.length, 2)
	assert.equal(h.model.has(B), false)
	h.s.undo()
	assert.equal(h.model.has(B), true, 'cut = copy + delete, one undo step')
	h.s.destroy()
})

test('M1 pasteKey focuses the paste catcher synchronously; the paste event pastes the clip of another board at the pointer, gives the focus back, one undo step', async () => {
	const catcher = fakeCatcher()
	const h = await open({ items: [], pasteCatcher: catcher, extraDeps: { parseHtml } })
	const src = new FakeModel([sticky(ID(30), { x: 0, y: 0, data: { text: 'x' } })])
	const clip = encodeClip(copyPayload(src, [ID(30)], { board: 8 }))
	h.scene.callbacks.onPointer([500, 600])
	h.scene.callbacks.onIntent({ type: 'pasteKey', inPlace: false })
	assert.equal(catcher.focused, 1, 'focused inside the keydown')
	assert.equal(catcher.paste({ 'text/html': clip.html, 'text/plain': clip.text }), true, 'preventDefault')
	assert.equal(h.scene.callsOf('focusCanvas').length, 1)
	const id = h.scene.selection[0]
	assert.notEqual(id, ID(30))
	assert.deepEqual([h.model.get(id).x, h.model.get(id).y, h.model.get(id).data.text], [400, 500, 'x'])
	await h.clock.advance(150)
	assert.equal(opsFor(h, id)[0].o, 'put')
	h.s.undo()
	assert.equal(h.model.has(id), false)
	h.s.destroy()
})

test('M1 paste on the same board with the originals visible: +20/+20, again +20 for a repeat; Ctrl+Shift+V with only text/plain takes the stored copy IN PLACE', async () => {
	const catcher = fakeCatcher()
	const io = { clipboard: null, doc: null }
	const h = await open({ items: [sticky(A, { x: 100, y: 100, data: { text: 'hello' } })], pasteCatcher: catcher, extraDeps: { parseHtml, clipboardIo: io } })
	h.scene.callbacks.onSelection([A])
	h.scene.callbacks.onIntent({ type: 'copy' })
	const clip = encodeClip(copyPayload(h.model, [A], { board: 7 }))
	const paste = (inPlace, data) => {
		h.scene.callbacks.onIntent({ type: 'pasteKey', inPlace })
		catcher.paste(data)
		return h.model.get(h.scene.selection[0])
	}
	h.scene.callbacks.onPointer([900, 900])
	const p1 = paste(false, { 'text/html': clip.html, 'text/plain': 'hello' })
	assert.deepEqual([p1.x, p1.y], [120, 120])
	const p2 = paste(false, { 'text/html': clip.html, 'text/plain': 'hello' })
	assert.deepEqual([p2.x, p2.y], [140, 140])
	// "paste as plain text": no HTML, the stored copy with the same text is taken, in place
	const p3 = paste(true, { 'text/plain': 'hello\n' })
	assert.deepEqual([p3.x, p3.y, p3.t], [100, 100, 'sticky'])
	assert.notEqual(p3.id, A)
	h.s.destroy()
})

test('M1 paste plain text → notes at the pointer; above 100 notes the user is asked first; images only → hint; a broken clip → "could not be pasted"; a full board → "This board is full."', async () => {
	const catcher = fakeCatcher()
	const asked = []
	let answer = true
	const h = await open({ items: [], pasteCatcher: catcher, limits: { maxItems: 200 }, extraDeps: { parseHtml }, extraUi: { onConfirm: (q) => { asked.push(q); return Promise.resolve(answer) } } })
	const paste = (data) => {
		h.scene.callbacks.onIntent({ type: 'pasteKey', inPlace: false })
		catcher.paste(data)
	}
	h.scene.callbacks.onPointer([0, 0])
	paste({ 'text/plain': 'a\nb' })
	assert.equal(h.model.size, 2)
	assert.deepEqual([...h.model.items.values()].map((it) => it.data.text).sort(), ['a', 'b'])
	h.s.undo()
	assert.equal(h.model.size, 0, 'one undo step')
	const many = Array.from({ length: 101 }, (_, i) => 'n' + i).join('\n')
	answer = false
	paste({ 'text/plain': many })
	await Promise.resolve()
	await Promise.resolve()
	assert.deepEqual(asked.map((q) => q.name), ['Paste 101 notes?'])
	assert.equal(h.model.size, 0, 'declined')
	answer = true
	paste({ 'text/plain': many })
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(h.model.size, 101)
	paste({ 'text/plain': many })
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(h.model.size, 101, '101 + 101 > 200: nothing')
	assert.deepEqual(h.toasts, ['This board is full.'])
	paste({ 'text/plain': '', files: [{}] })
	assert.deepEqual(h.infos, ['Images can\'t be pasted yet.'])
	// a stored copy without any text never stands in for an image
	h.storage.setJson('local', CLIP_KEY, { v: 1, ts: 1760100000000, text: '', payload: { knorke: 1, board: 7, items: [] } })
	paste({ 'text/plain': '', files: [{}] })
	assert.deepEqual(h.infos, ['Images can\'t be pasted yet.', 'Images can\'t be pasted yet.'])
	paste({ 'text/html': '<div data-knorke-clip="v1.garbage"></div>', 'text/plain': 'zzz' })
	assert.deepEqual(h.toasts, ['This board is full.', '1 item could not be pasted.'], 'never notes from a broken clip')
	h.s.destroy()
})

test('M1 duplicate: copies of the selection at +20/+20, selected, one undo step', async () => {
	const h = await open({ items: [sticky(A, { x: 10, y: 20 })] })
	h.scene.callbacks.onSelection([A])
	h.scene.callbacks.onIntent({ type: 'duplicate' })
	const id = h.scene.selection[0]
	assert.notEqual(id, A)
	assert.deepEqual([h.model.get(id).x, h.model.get(id).y], [30, 40])
	h.s.duplicate()
	assert.equal(h.model.size, 3)
	h.s.undo()
	h.s.undo()
	assert.equal(h.model.size, 1)
	h.s.destroy()
})

test('M1 selection v2: types (Set), field intersection, common values or null with the field in mixed, box, canConnect', async () => {
	const h = await open({ items: [sticky(A, { x: 0, y: 0, style: { fill: '#a8d8f8' } }), shape(S1, { x: 300, y: 0, style: { fill: '#a8d8f8', stroke: '#1a1a1a', strokeWidth: 2 } }), shape(B, { x: 600, y: 0 })] })
	h.scene.callbacks.onSelection([A, S1])
	let sel = h.ui.selection.at(-1)
	assert.deepEqual([...sel.types], ['sticky', 'shape'])
	assert.deepEqual(sel.fields, ['data.text', 'style.fill', 'style.fontSize'])
	assert.equal(sel.fill, '#a8d8f8')
	assert.equal(sel.stroke, null, 'a note has no border')
	assert.equal(sel.fontSize, null)
	assert.deepEqual(sel.mixed, [])
	assert.equal(sel.count, 2)
	assert.equal(sel.canConnect, true)
	assert.deepEqual(sel.box, { x: 0, y: 0, w: 500, h: 200, r: 0 })
	h.scene.callbacks.onSelection([S1, B])
	sel = h.ui.selection.at(-1)
	assert.equal(sel.fill, null, 'the fills differ')
	assert.deepEqual(sel.mixed, ['style.fill'])
	assert.equal(sel.stroke, '#1a1a1a')
	assert.equal(sel.kind, 'rect')
	h.scene.callbacks.onSelection([S1])
	sel = h.ui.selection.at(-1)
	assert.deepEqual(sel.box, { x: 300, y: 0, w: 200, h: 120, r: 0 })
	assert.equal(sel.rotatable, true)
	h.s.destroy()
})

test('M1 limits: maxItems/maxLabel fall back to 5000/200 (SPEC-M1 §4.8); the scene gets them too', async () => {
	assert.deepEqual(limitsWithDefaults(null), { maxItems: 5000, maxLabel: 200 })
	assert.deepEqual(limitsWithDefaults({ maxText: 6000, maxItems: 0, maxLabel: 120 }), { maxText: 6000, maxItems: 5000, maxLabel: 120 })
	const h = await open({ items: [], limits: { maxText: 6000, maxItems: 42 } })
	assert.deepEqual(h.scene.opts.limits, { maxText: 6000, maxItems: 42, maxLabel: 200 })
	h.s.destroy()
})

test('M1 tool options and focus: setToolOptions activates the tool with them and reports them; focusCanvas reaches the scene', async () => {
	const seen = []
	const h = await open({ items: [], extraUi: { onToolOptions: (x) => seen.push(x) } })
	assert.deepEqual(seen[0], { shape: { kind: 'rect' }, connector: {} }, 'the scene\'s options at the start')
	h.s.setToolOptions('shape', { kind: 'ellipse' })
	assert.deepEqual(h.scene.callsOf('setTool').at(-1), ['setTool', 'shape', { kind: 'ellipse' }])
	assert.deepEqual(seen.at(-1).shape, { kind: 'ellipse' })
	assert.deepEqual(h.ui.tool.at(-1), 'shape')
	h.s.setTool('select')
	h.s.setTool('shape')
	assert.deepEqual(h.scene.callsOf('setTool').at(-1), ['setTool', 'shape', { kind: 'ellipse' }], 'S remembers the last kind')
	h.s.focusCanvas()
	assert.equal(h.scene.callsOf('focusCanvas').length, 1)
	h.s.destroy()
})

test('M1 open focuses the canvas right after mount when nothing has the focus (R9, §6.5.1); an element focused meanwhile keeps it', async () => {
	const winWith = (active) => {
		const w = fakeWin()
		w.document.body = { tagName: 'BODY' }
		w.document.activeElement = active === 'body' ? w.document.body : active
		return w
	}
	const order = (h) => h.scene.calls.map((c) => c[0]).filter((n) => ['mount', 'focusCanvas', 'fit', 'setCamera'].includes(n))
	// nothing focused: document.activeElement is body → single keys work at once
	const h1 = await open({ items: [], win: winWith('body') })
	assert.deepEqual(order(h1), ['mount', 'focusCanvas', 'fit'], 'right after mount, before the camera')
	h1.s.destroy()
	// no active element at all
	const h2 = await open({ items: [], win: winWith(null) })
	assert.equal(h2.scene.callsOf('focusCanvas').length, 1)
	h2.s.destroy()
	// the user (or E26) focused another element, e.g. the TopBar rename button: no theft
	const h3 = await open({ items: [], win: winWith({ tagName: 'BUTTON', dataset: { knorkeAction: 'rename-board' } }) })
	assert.equal(h3.scene.callsOf('focusCanvas').length, 0)
	assert.equal(h3.scene.callsOf('mount').length, 1)
	h3.s.destroy()
	// no document (no DOM): nothing to decide
	const h4 = await open({ items: [], win: null })
	assert.equal(h4.scene.callsOf('focusCanvas').length, 0)
	h4.s.destroy()
})

test('M1 debug API: selection(), handles() in client coordinates, connector(id) from the model\'s routing (null until 1b)', async () => {
	const h = await open({ items: [sticky(A)] })
	const api = debugApi(h.s)
	h.scene.callbacks.onSelection([A])
	assert.deepEqual(api.selection(), [A])
	h.scene.handleList = [{ name: 'tl', x: 1, y: 2 }]
	assert.deepEqual(api.handles(), [{ name: 'tl', x: 101, y: 52 }])
	assert.equal(api.connector(A), null)
	h.model.geometryOf = (id) => (id === A ? { kind: 'poly', start: { x: 1, y: 2, angle: 0 }, end: { x: 3, y: 4, angle: 0 } } : null)
	assert.deepEqual(api.connector(A), { start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, kind: 'poly' })
	h.s.destroy()
})

test('M1 paste in a browser without access to the clipboard data (WebKit): the inserted plain text matches the stored copy → the objects are pasted, not notes', async () => {
	const catcher = fakeCatcher()
	const h = await open({ items: [sticky(A, { x: 100, y: 100, data: { text: 'hello' } })], pasteCatcher: catcher, extraDeps: { parseHtml, clipboardIo: { clipboard: null, doc: null } } })
	h.scene.callbacks.onSelection([A])
	h.scene.callbacks.onIntent({ type: 'copy' })
	h.scene.callbacks.onIntent({ type: 'pasteKey', inPlace: false })
	assert.equal(catcher.paste({}), false, 'no preventDefault: the browser inserts the text')
	catcher.value = 'hello'
	catcher.handlers.input()
	const id = h.scene.selection[0]
	assert.notEqual(id, A)
	assert.deepEqual([h.model.get(id).t, h.model.get(id).x, h.model.get(id).y], ['sticky', 120, 120])
	assert.equal(h.model.size, 2)
	h.s.destroy()
})

test('M1 view-only and frozen sessions neither take the paste key nor copy', async () => {
	const catcher = fakeCatcher()
	const h = await open({ items: [sticky(A)], viewOnly: true, pasteCatcher: catcher })
	h.scene.callbacks.onSelection([A])
	h.scene.callbacks.onIntent({ type: 'pasteKey', inPlace: false })
	assert.equal(catcher.focused, 0)
	assert.equal(h.s.copyNow(false), false)
	h.s.destroy()
})

test('M1 transform of a frame with keep during the scene\'s preview (children compensated in the model): the session takes the stored placements from the replica', async () => {
	const srv = lwwServer([frame(F, { x: 100, y: 100, w: 400, h: 400 }), sticky(K1, { x: 300, y: 300, w: 100, h: 100, parent: F }), sticky(B, { x: 20, y: 20, w: 100, h: 100, parent: F })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	// scene preview: frame moved, children compensated
	h.scene.active.add(F)
	h.scene.active.add(K1)
	h.scene.active.add(B)
	Object.assign(h.model.items.get(F), { x: 350, y: 350, w: 150, h: 150 })
	Object.assign(h.model.items.get(K1), { x: 50, y: 50 })
	Object.assign(h.model.items.get(B), { x: -230, y: -230 })
	h.scene.callbacks.onIntent({
		type: 'transform', ids: [F], keep: true,
		before: new Map([[F, { x: 100, y: 100, w: 400, h: 400, r: 0, parent: null }]]),
		after: new Map([[F, { x: 350, y: 350, w: 150, h: 150, r: 0 }]]),
	})
	h.scene.active.clear()
	h.scene.callbacks.onActivity({ kind: 'transform', active: false, ids: [F] })
	assert.deepEqual([h.model.abs(K1).x, h.model.abs(K1).y, h.model.get(K1).parent], [400, 400, F], 'K1 stays inside, in place')
	assert.deepEqual([h.model.abs(B).x, h.model.abs(B).y, h.model.get(B).parent], [120, 120, null], 'B is freed where it was')
	await h.clock.advance(1000)
	assert.deepEqual([srv.live.get(B).x, srv.live.get(B).y, srv.live.get(B).parent], [120, 120, null])
	h.s.undo()
	await h.clock.advance(1000)
	assert.deepEqual([srv.live.get(B).x, srv.live.get(B).y, srv.live.get(B).parent], [20, 20, F], 'undo hangs B back at its old place')
	h.s.destroy()
})

// ---- SPEC-M1 stage 1, round 1b: connectors -----------------------------------

const CN = ID('CN')
const CX = ID('CX')

/**
 * lwwServer plus rule 14 of SPEC-M1 §4.7 (what the real server does with
 * connector ends): an end naming a tombstone becomes a free point at the
 * anchor point of its last box; at the end of a batch every live connector
 * bound to an item the batch removed gets that end as a free point
 * (srv.derived: the server-derived release rows, same answer).
 *
 * @param {object[]} items live items at the start (roots only)
 * @return {object} server
 */
function lwwServer14(items) {
	const srv = lwwServer(items)
	const last = new Map()
	const plain = srv.applyBody
	srv.derived = []
	const freeAt = (ep) => {
		const box = last.get(ep.item)
		return anchorPoint({ x: box.x, y: box.y, w: box.w, h: box.h, r: box.r ?? 0 }, ep)
	}
	const fixEnd = (ep) => (ep && typeof ep.item === 'string' && srv.dead.has(ep.item) ? freeAt(ep) : ep)
	const fix = (op) => {
		if (op.o === 'put' && op.t === 'connector') {
			return { ...op, p: { ...op.p, data: { ...op.p.data, start: fixEnd(op.p.data.start), end: fixEnd(op.p.data.end) } } }
		}
		if (op.o === 'patch') {
			const p = { ...op.p }
			for (const k of ['data.start', 'data.end']) {
				if (k in p) {
					p[k] = fixEnd(p[k])
				}
			}
			return { ...op, p }
		}
		return op
	}
	srv.applyBody = (body) => {
		for (const [id, it] of srv.live) {
			last.set(id, structuredClone(it))
		}
		// op by op: an end is checked against the state at the time of the op (working copy)
		const res = []
		const ops = []
		for (const raw of body.ops ?? []) {
			const op = fix(raw)
			ops.push(op)
			res.push(...plain({ ...body, ops: [op] }))
		}
		const removed = new Set(ops.filter((o) => o.o === 'remove' && !srv.live.has(o.id)).map((o) => o.id))
		const derived = []
		for (const it of srv.live.values()) {
			if (it.t !== 'connector') {
				continue
			}
			const p = {}
			for (const w of ['start', 'end']) {
				const ep = it.data?.[w]
				if (ep && removed.has(ep.item)) {
					p['data.' + w] = freeAt(ep)
				}
			}
			if (Object.keys(p).length > 0) {
				derived.push({ o: 'patch', id: it.id, p })
			}
		}
		if (derived.length > 0) {
			srv.derived.push(...derived)
			plain({ ops: derived })
		}
		return res
	}
	return srv
}

/** Two notes, A at (0, 0) and B at (400, 0), both 200 × 200. */
const twoNotes = () => [sticky(A, { x: 0, y: 0, data: { text: 'a' } }), sticky(B, { x: 400, y: 0, data: { text: 'b' } })]

test('M1 1b connect intent: one put with both ends (stored form) and the intent\'s route/end cap; the connector is selected; one undo step, redo revives', async () => {
	const srv = lwwServer14(twoNotes())
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onIntent({ type: 'connect', start: { item: A, ax: 1, ay: 0.50004 }, end: { item: B }, route: 'elbow', endCap: 'dot' })
	const id = h.scene.selection[0]
	assert.equal(h.model.get(id).t, 'connector', 'shown at once')
	assert.deepEqual(h.ui.selection.at(-1).ids, [id])
	await h.clock.advance(1000)
	const stored = srv.live.get(id)
	assert.deepEqual(stored.data, { route: 'elbow', start: { item: A, ax: 1, ay: 0.5 }, end: { item: B } })
	assert.equal(stored.style.endCap, 'dot')
	assert.deepEqual([stored.x, stored.y, stored.w, stored.h, stored.r, stored.parent], [0, 0, 0, 0, 0, null])
	assert.equal(itemKey(h.model.get(id)), itemKey(stored), 'model = server')
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.undo()
	await h.clock.advance(1000)
	assert.equal(srv.live.has(id), false)
	h.s.redo()
	await h.clock.advance(1000)
	assert.equal(srv.live.has(id), true)
	assert.equal(opsFor(h, id).at(-1).revive, true)
	// an intent the action refuses (end on the connector itself / unknown) sends nothing
	const before = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'connect', start: { item: A }, end: { item: ID(99) }, route: 'straight', endCap: 'arrow' })
	await h.clock.advance(1000)
	assert.ok(h.tr.calls.slice(before).every((c) => !c.ops))
	h.s.destroy()
})

test('M1 1b retarget intent: the whole end in one patch (one register), undo restores the end before', async () => {
	const srv = lwwServer14([...twoNotes(), shape(S1, { x: 0, y: 600 }), connector(CN, { item: A }, { item: B })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onIntent({ type: 'retarget', id: CN, which: 'end', value: { item: S1, ax: 0.5, ay: 0 }, before: { item: B } })
	await h.clock.advance(1000)
	assert.deepEqual(opsFor(h, CN), [{ o: 'patch', id: CN, p: { 'data.end': { item: S1, ax: 0.5, ay: 0 } } }])
	assert.deepEqual(srv.live.get(CN).data.end, { item: S1, ax: 0.5, ay: 0 })
	h.scene.callbacks.onIntent({ type: 'retarget', id: CN, which: 'start', value: { x: -50.004, y: 10 }, before: { item: A } })
	await h.clock.advance(1000)
	assert.deepEqual(srv.live.get(CN).data.start, { x: -50, y: 10 })
	h.s.undo()
	h.s.undo()
	await h.clock.advance(1000)
	assert.deepEqual([srv.live.get(CN).data.start, srv.live.get(CN).data.end], [{ item: A }, { item: B }])
	h.s.destroy()
})

test('M1 1b delete B: the connector A→B gets a free end at its VISIBLE docking point before the remove (the server releases nothing); undo revives B and binds again in ONE step', async () => {
	const srv = lwwServer14([...twoNotes(), connector(CN, { item: A }, { item: B })])
	const h = await openLww(srv, { extraDeps: { SceneModel: RoutedModel } })
	await h.clock.advance(1000)
	const drawn = h.model.geometryOf(CN).end
	assert.deepEqual([drawn.x, drawn.y], [400, 100], 'auto end: left side of B, facing A')
	h.scene.callbacks.onIntent({ type: 'delete', ids: [B] })
	assert.deepEqual(h.model.get(CN).data.end, { x: 400, y: 100 }, 'free at once, where it was drawn')
	assert.equal(h.model.has(B), false)
	await h.clock.advance(1000)
	const sent = h.tr.calls.flatMap((c) => c.ops ?? [])
	assert.deepEqual(sent.map((o) => [o.o, o.id]), [['patch', CN], ['remove', B]], 'release before the remove')
	assert.deepEqual(srv.derived, [], 'nothing left for the server-side release')
	assert.deepEqual(srv.live.get(CN).data.end, { x: 400, y: 100 })
	assert.equal(itemKey(h.model.get(CN)), itemKey(srv.live.get(CN)))
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	h.s.undo()
	assert.deepEqual(h.model.get(CN).data.end, { item: B })
	await h.clock.advance(1000)
	assert.equal(srv.live.has(B), true)
	assert.deepEqual(srv.live.get(CN).data.end, { item: B }, 'bound again on the server')
	const undoOps = h.tr.calls.flatMap((c) => c.ops ?? []).slice(sent.length)
	assert.deepEqual(undoOps.map((o) => [o.o, o.id]), [['put', B], ['patch', CN]], 'B revives before the binding arrives')
	h.s.redo()
	await h.clock.advance(1000)
	assert.equal(srv.live.has(B), false)
	assert.deepEqual(srv.live.get(CN).data.end, { x: 400, y: 100 })
	assert.deepEqual(srv.derived, [])
	h.s.destroy()
})

test('M1 1b server-derived release row (a connector this client did not know yet): the replica takes it like any change, model = server; undo of the delete revives B, that connector stays free', async () => {
	const srv = lwwServer14([...twoNotes(), connector(CN, { item: A }, { item: B })])
	const h = await openLww(srv, { extraDeps: { SceneModel: RoutedModel } })
	await h.clock.advance(1000)
	// Bob binds CX to B; the put reaches the server before this client's next request
	srv.applyBody({ ops: [{ o: 'put', id: CX, t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, z: 'i8', parent: null, data: { start: { x: 900, y: 900 }, end: { item: B, ax: 0, ay: 0 } }, style: {} } }] })
	h.scene.callbacks.onIntent({ type: 'delete', ids: [B] })
	assert.equal(h.model.has(CX), false, 'not known when deleting')
	await h.clock.advance(1000)
	assert.deepEqual(srv.derived, [{ o: 'patch', id: CX, p: { 'data.end': { x: 400, y: 0 } } }], 'the server released CX at the anchor of B')
	assert.deepEqual(h.model.get(CX).data.end, { x: 400, y: 0 }, 'the derived row arrived as a change')
	for (const id of [CN, CX]) {
		assert.equal(itemKey(h.model.get(id)), itemKey(srv.live.get(id)), id)
	}
	assert.deepEqual(h.s.replica.pendingOps().ops, [])
	h.s.undo()
	await h.clock.advance(1000)
	assert.deepEqual(srv.live.get(CN).data.end, { item: B }, 'the known connector binds again')
	assert.deepEqual(srv.live.get(CX).data.end, { x: 400, y: 0 }, 'the unknown one stays free (§4.7 rule 14: the server release only catches concurrent cases)')
	assert.equal(itemKey(h.model.get(CX)), itemKey(srv.live.get(CX)))
	h.s.destroy()
})

test('M1 1b "Connect" (WCAG 2.5.7): two bindable items selected → a connector between them, ends auto, route and end cap of the connector tool options; the connector is selected; otherwise nothing', async () => {
	const srv = lwwServer14([...twoNotes(), frame(F, { x: 2000, y: 0 })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.s.setToolOptions('connector', { route: 'curved', endCap: 'diamond' })
	h.scene.callbacks.onSelection([A, B])
	assert.equal(h.ui.selection.at(-1).canConnect, true)
	const id = h.s.connectSelection()
	assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/)
	assert.deepEqual(h.scene.selection, [id])
	assert.equal(h.ui.selection.at(-1).canConnect, false, 'a connector alone cannot be connected')
	await h.clock.advance(1000)
	assert.deepEqual(srv.live.get(id).data, { route: 'curved', start: { item: A }, end: { item: B } })
	assert.equal(srv.live.get(id).style.endCap, 'diamond')
	assert.equal(h.s.undoStack.done.length, 1)
	// not connectable: one item, a frame, the connector itself
	for (const sel of [[A], [A, F], [id], [A, id]]) {
		h.scene.callbacks.onSelection(sel)
		assert.equal(h.ui.selection.at(-1).canConnect, false, sel.join())
		assert.equal(h.s.connectSelection(), null, sel.join())
	}
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.destroy()
	// view-only devices never connect
	const v = await open({ items: twoNotes(), viewOnly: true })
	v.scene.callbacks.onSelection([A, B])
	assert.equal(v.s.connectSelection(), null)
	v.s.destroy()
})

test('M1 1b label: the label editor\'s text intents patch data.label; the final one closes the undo step; "Edit label" opens the editor of one selected connector only', async () => {
	const srv = lwwServer14([...twoNotes(), connector(CN, { item: A }, { item: B })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onSelection([CN])
	assert.equal(h.s.editLabel(), true)
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(1, 2), [CN])
	h.scene.callbacks.onEditing(CN, false)
	h.scene.callbacks.onIntent({ type: 'text', id: CN, path: 'data.label', value: 'ye', before: '', final: false })
	h.scene.callbacks.onIntent({ type: 'text', id: CN, path: 'data.label', value: 'yes', before: '', final: true })
	h.scene.callbacks.onEditing(null, false)
	await h.clock.advance(1000)
	assert.equal(srv.live.get(CN).data.label, 'yes')
	assert.equal(h.s.undoStack.done.length, 1, 'one step for the whole edit')
	assert.ok(h.scene.callsOf('measureTextHeight').length === 0, 'a label is never measured (rule 13 is for text items)')
	h.s.undo()
	await h.clock.advance(1000)
	assert.equal(srv.live.get(CN).data.label ?? '', '')
	// "Edit label" only for exactly one connector
	h.scene.callbacks.onSelection([A])
	assert.equal(h.s.editLabel(), false)
	h.scene.callbacks.onSelection([CN, A])
	assert.equal(h.s.editLabel(), false)
	h.s.destroy()
})

test('M1 1b text rescue for data.label: locked while the label editor is open → notice; bad with the editor closed → rescue editor with the label; gone → copy dialog', async () => {
	let code = 'ok'
	const items = [...twoNotes(), connector(CN, { item: A }, { item: B })]
	const h = await open({
		items,
		codes: (ops) => ops.map(() => code),
		presence: () => (code === 'locked' ? BOB(CN, 1) : {}),
	})
	h.scene.callbacks.onEditing(CN, false)
	code = 'locked'
	h.scene.callbacks.onIntent({ type: 'text', id: CN, path: 'data.label', value: 'mine', before: '', final: false })
	await h.clock.advance(400)
	const notice = h.scene.callsOf('setEditorNotice')
	assert.equal(notice.length, 1)
	assert.equal(notice[0][1], CN)
	assert.match(notice[0][2], /Bob Berg is editing this item/)
	h.scene.callbacks.onEditing(null, false)
	h.s.destroy()
	// bad with the editor closed: the rejected label reopens in a rescue editor
	const b = await open({ items, codes: (ops) => ops.map(() => 'bad') })
	b.scene.callbacks.onIntent({ type: 'text', id: CN, path: 'data.label', value: 'x'.repeat(201), before: '', final: true })
	await b.clock.advance(150)
	const opened = b.scene.callsOf('openTextEditor')
	assert.equal(opened.length, 1)
	assert.equal(opened[0][1], CN)
	assert.equal(opened[0][2].text, 'x'.repeat(201))
	assert.match(opened[0][2].notice, /Not saved\. Copy your text/)
	b.s.destroy()
	// gone: the connector was deleted meanwhile → copy dialog; an unknown id is checked on every text path
	const g = await open({
		items,
		reply: (body) => (body.ops ? { rev: 7, removed: [CN], acks: { seq: body.seq, rev: 7, res: body.ops.map(() => 'gone') }, presence: {} } : null),
	})
	g.scene.callbacks.onIntent({ type: 'text', id: CN, path: 'data.label', value: 'lost words', before: '', final: true })
	await g.clock.advance(150)
	assert.deepEqual(g.ui.rescue, [{ id: CN, text: 'lost words', gone: true }])
	assert.deepEqual(g.s.textPathsOf(ID(98)), ['data.text', 'data.title', 'data.label'])
	g.s.destroy()
})

test('M1 1b connector style from the context bar: route, tips, line colour (CONNECTOR_COLORS), width (rule from 1), dash; selection v2 reports them; each an undo step', async () => {
	const srv = lwwServer14([...twoNotes(), connector(CN, { item: A }, { item: B })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onSelection([CN])
	const info = h.ui.selection.at(-1)
	assert.deepEqual([info.route, info.startCap, info.endCap, info.stroke, info.strokeWidth, info.dash], ['straight', 'none', 'arrow', '#1a1a1a', 2, 'solid'])
	assert.ok(['data.route', 'data.label', 'style.startCap', 'style.endCap'].every((p) => info.fields.includes(p)))
	h.s.setStyle('data.route', 'elbow')
	h.s.setStyle('style.startCap', 'dot')
	h.s.setStyle('style.endCap', 'none')
	h.s.setStyle('style.stroke', CONNECTOR_COLORS[3])
	h.s.setStyle('style.strokeWidth', 0)
	h.s.setStyle('style.dash', 'dashed')
	await h.clock.advance(1000)
	const st = srv.live.get(CN)
	assert.deepEqual([st.data.route, st.style.startCap, st.style.endCap, st.style.stroke, st.style.strokeWidth, st.style.dash], ['elbow', 'dot', 'none', CONNECTOR_COLORS[3], 2, 'dashed'], 'width 0 is outside the connector rule: no op')
	const now = h.ui.selection.at(-1)
	assert.deepEqual([now.route, now.startCap, now.endCap], ['elbow', 'dot', 'none'])
	assert.equal(h.s.undoStack.done.length, 5)
	for (let i = 0; i < 5; i++) {
		h.s.undo()
	}
	await h.clock.advance(1000)
	assert.equal(itemKey(srv.live.get(CN)), itemKey(connector(CN, { item: A }, { item: B })))
	h.s.destroy()
})

test('M1 1b move: a connector bound to a note that is not moved sends nothing; a free-free connector moves both ends; moving its target moves no bound end', async () => {
	const srv = lwwServer14([...twoNotes(), connector(CN, { item: A }, { x: 900, y: 900 }), connector(CX, { x: 0, y: 500 }, { x: 100, y: 500 })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	const n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'move', ids: [CN], dx: 10, dy: 10, origin: new Map() })
	await h.clock.advance(1000)
	assert.ok(h.tr.calls.slice(n).every((c) => !c.ops), 'not draggable alone')
	h.scene.callbacks.onIntent({ type: 'move', ids: [CX], dx: 10, dy: 10, origin: new Map() })
	h.scene.callbacks.onIntent({ type: 'move', ids: [A], dx: 50, dy: 0, origin: new Map([[A, { x: 0, y: 0, parent: null }]]) })
	await h.clock.advance(1000)
	assert.deepEqual([srv.live.get(CX).data.start, srv.live.get(CX).data.end], [{ x: 10, y: 510 }, { x: 110, y: 510 }])
	assert.deepEqual(srv.live.get(CN).data.start, { item: A }, 'the bound end follows by routing, never patched')
	assert.ok(!opsFor(h, CN).length)
	h.s.destroy()
})

test('M1 1b copy A + B + their connector, paste on a second board: the copy is connected to the copies (new ids)', async () => {
	const storage = memoryStorage()
	const items = [...twoNotes(), connector(CN, { item: A, ax: 1, ay: 0.5 }, { item: B }, { data: { start: { item: A, ax: 1, ay: 0.5 }, end: { item: B }, route: 'elbow', label: 'yes' } })]
	const h = await open({ items, storage, extraDeps: { parseHtml, clipboardIo: { clipboard: null, doc: null } } })
	h.scene.callbacks.onSelection([A, B, CN])
	h.scene.callbacks.onIntent({ type: 'copy' })
	assert.match(h.infos.at(-1), /3 items copied/)
	h.s.destroy()
	// board 8, empty; Ctrl+V → catcher → stored copy (WebKit path: the browser inserts the plain text)
	const catcher = fakeCatcher()
	const t2 = await open({ items: [], storage, pasteCatcher: catcher, extraDeps: { parseHtml, clipboardIo: { clipboard: null, doc: null } } })
	t2.s.boardId = 8
	t2.scene.callbacks.onIntent({ type: 'pasteKey', inPlace: false })
	const stored = storage.getJson('local', 'knorke.clip')
	catcher.paste({ 'text/plain': stored.text, 'text/html': '' })
	const pasted = [...t2.model.items.values()]
	assert.equal(pasted.length, 3)
	const conn = pasted.find((it) => it.t === 'connector')
	const notes = pasted.filter((it) => it.t === 'sticky')
	const byText = Object.fromEntries(notes.map((it) => [it.data.text, it.id]))
	assert.deepEqual(conn.data.start, { item: byText.a, ax: 1, ay: 0.5 })
	assert.deepEqual(conn.data.end, { item: byText.b })
	assert.deepEqual([conn.data.route, conn.data.label], ['elbow', 'yes'])
	assert.ok(![A, B, CN].some((id) => t2.model.has(id)), 'new ids')
	assert.equal(t2.s.undoStack.done.length, 1, 'one undo step')
	await t2.clock.advance(1000)
	const sent = t2.tr.calls.flatMap((c) => c.ops ?? [])
	assert.deepEqual(sent.map((o) => o.t), ['sticky', 'sticky', 'connector'], 'the connector after both ends')
	t2.s.destroy()
})

test('M1 1b retarget onto a target another participant deleted meanwhile: ok, the server stores a free point at its anchor (rule 14); the model converges to it; undo restores the old end', async () => {
	const srv = lwwServer14([...twoNotes(), shape(S1, { x: 0, y: 600, w: 200, h: 120 }), connector(CN, { item: A }, { item: S1 })])
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onIntent({ type: 'retarget', id: CN, which: 'end', value: { item: B, ax: 1, ay: 0.5 }, before: { item: S1 } })
	assert.deepEqual(h.model.get(CN).data.end, { item: B, ax: 1, ay: 0.5 }, 'shown at once')
	// Bob's remove of B reaches the server first
	srv.applyBody({ ops: [{ o: 'remove', id: B }] })
	await h.clock.advance(1000)
	assert.deepEqual(srv.live.get(CN).data.end, { x: 600, y: 100 }, 'free point at B\'s anchor (ax 1, ay 0.5)')
	assert.deepEqual(h.model.get(CN).data.end, { x: 600, y: 100 }, 'the model converged to the stored free point')
	assert.equal(h.model.has(B), false)
	assert.equal(h.toasts.length, 0, 'ok, no undo failure, no toast')
	h.s.undo()
	await h.clock.advance(1000)
	assert.deepEqual(srv.live.get(CN).data.end, { item: S1 })
	assert.equal(itemKey(h.model.get(CN)), itemKey(srv.live.get(CN)))
	h.s.destroy()
})

test('M1 §4.2/§6.4 (E29) password_required: the open editor\'s text goes to the rescue even when its last commit already reached the server', async () => {
	let locked = false
	const h = await guestSession({
		join: (n) => (n >= 2 ? new HttpError(403, 'password_required', '', null, true) : GUEST_SNAP()),
		// a server that stores the text and sends the change back (the replica confirms it)
		sync: (b) => {
			if (locked) {
				return new HttpError(403, 'link_revoked', '', null, true)
			}
			if (!b.ops) {
				return { rev: b.since, presence: {} }
			}
			const text = b.ops.find((o) => o.id === A && o.p && typeof o.p['data.text'] === 'string')?.p['data.text'] ?? 'hello'
			return { rev: b.since + 1, presence: {}, items: [sticky(A, { data: { text }, rev: b.since + 1 })], acks: { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') } }
		},
	})
	h.scene.callbacks.onEditing(A, false)
	h.scene.active.add(A)
	// an intermediate commit of the open editor reaches the server …
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'Rettungstext', before: 'hello', final: false })
	await h.clock.advance(1500)
	await h.clock.settle()
	assert.equal(h.s.replica.pendingCount(), 0, 'nothing pending: the text is on the server')
	assert.equal(h.s.replica.confirmed.get(A).data.text, 'Rettungstext', 'confirmed by the server')
	// … then the password changes
	locked = true
	await h.clock.advance(1500)
	await h.clock.settle()
	assert.equal(h.ui.status.at(-1), 'password_required')
	assert.deepEqual(h.s.unsentTexts(), [{ id: A, text: 'Rettungstext', gone: false }], 'the open editor\'s text, although the server has it')
	h.s.destroy()
})

// ---- Stage 4, fix round: the snapshot throttle shapes [B] delivers -----------

test('M1 stage 4 [B] shape: opening as a guest, the join answered 429 slow_down by knorke-snapip-<board> (retryMs 200, Retry-After 1) or knorke-snap-<gid> (retryMs 2000, Retry-After 2) waits 2000, then 4000 ms, and the board opens; never final', async () => {
	for (const [body, header] of [[{ error: 'slow_down', message: 'Slow down', retryMs: 200 }, '1'], [{ error: 'slow_down', message: 'Slow down', retryMs: 2000 }, '2']]) {
		// the HttpError exactly as http.js builds it from the raw answer
		const fetchImpl = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? header : null) }, text: async () => JSON.stringify(body) })
		const wire = await request('POST', '/x', { body: {}, fetchImpl }).then(() => null, (e) => e)
		assert.ok(wire instanceof HttpError && wire.code === 'slow_down' && wire.body.retryMs === body.retryMs && wire.retryAfterMs === Number(header) * 1000)
		const clock = new FakeClock(10000)
		const at = []
		const tr = {
			kind: 'guest',
			async join() {
				at.push(clock.now())
				if (at.length <= 2) {
					throw wire
				}
				return GUEST_SNAP()
			},
			async snapshot() { return GUEST_SNAP() },
			async sync(b) { return { rev: b.since, presence: {} } },
		}
		const s = new BoardSession({
			container: {},
			mode: 'guest',
			boardId: 7,
			linkToken: LINK_TOKEN,
			ui: {},
			deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null, toast: () => {}, info: () => {} },
		})
		const p = s.open('Gina')
		await clock.advance(10000)
		const opened = await p
		assert.deepEqual(at.map((t) => t - at[0]), [0, 2000, 6000], 'retryMs ' + body.retryMs + ': max(retryMs, 2000), doubled; never 200 or 1000 ms')
		assert.equal(opened.me.name, 'Gina')
		assert.equal(s.sync.running, true)
		assert.equal(s.sync.finalStatus, null)
		s.destroy()
	}
})

// ---- review round P7 (SPEC-M1 §33.1 i, R22, P7-07) -----------------------------

/**
 * @param {number} status HTTP status
 * @param {string} text body
 * @return {Promise<HttpError>} the error request() throws for that raw answer
 */
async function wireError(status, text) {
	const fetchImpl = async () => ({ ok: false, status, statusText: '', headers: { get: () => null }, text: async () => text })
	return request('GET', '/x', { fetchImpl }).then(() => null, (e) => e)
}

test('R22 P7-07 open: a snapshot answered 403/404 text/html by a proxy or firewall is repeated after 1, 2, 4, 8, 15 s × (1 + 0–20 %), then every 15 s; never final, more often than the proxy limit of 20; the board opens', async () => {
	const block403 = await wireError(403, '<html><body>Forbidden</body></html>')
	const block404 = await wireError(404, '<html><body>Not Found</body></html>')
	assert.ok(block403.fromApp === false && block404.fromApp === false)
	const clock = new FakeClock()
	const at = []
	const tr = {
		kind: 'user',
		async snapshot() {
			at.push(clock.now())
			if (at.length <= 24) {
				throw at.length % 2 ? block403 : block404
			}
			return { proto: 2, rev: 1, items: [], me: ME, board: { id: 7, role: 'owner' } }
		},
		async sync(b) { return { rev: b.since } },
	}
	const status = []
	const s = new BoardSession({ container: {}, boardId: 7, ui: { onStatus: (x) => status.push(x) }, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null } })
	const p = s.open()
	await clock.advance(10 * 60 * 1000)
	await p
	assert.equal(at.length, 25, 'more attempts than OPEN_ATTEMPTS (20): never final')
	assert.deepEqual(at.slice(1, 8).map((t, i) => t - at[i]), [1000, 2000, 4000, 8000, 15000, 15000, 15000], 'the failure backoff, then 15 s')
	assert.ok(!status.some((x) => ['gone', 'revoked', 'offline'].includes(x)), 'no final status and no new text while connecting: ' + status.join(','))
	assert.equal(s.sync.running, true)
	s.destroy()
	// an app 403/404 is still thrown at once
	const s2 = new BoardSession({ container: {}, boardId: 7, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: { kind: 'user', snapshot: async () => { throw new HttpError(403, 'forbidden', '', null, true) } }, storage: memoryStorage(), win: null } })
	await assert.rejects(s2.open(), (e) => e.status === 403 && e.fromApp === true)
})

test('R22 P7-07 open as a guest: the join answered 403 text/html is repeated with the growing wait and the board opens; destroyed while waiting: no further join', async () => {
	const block = await wireError(403, '<html>blocked</html>')
	const clock = new FakeClock(10000)
	const at = []
	const tr = {
		kind: 'guest',
		async join() {
			at.push(clock.now())
			if (at.length <= 2) {
				throw block
			}
			return GUEST_SNAP()
		},
		async snapshot() { return GUEST_SNAP() },
		async sync(b) { return { rev: b.since, presence: {} } },
	}
	const s = new BoardSession({ container: {}, mode: 'guest', boardId: 7, linkToken: LINK_TOKEN, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null, toast: () => {}, info: () => {} } })
	const p = s.open('Gina')
	await clock.advance(5000)
	const opened = await p
	assert.deepEqual(at.map((t) => t - at[0]), [0, 1000, 3000])
	assert.equal(opened.me.name, 'Gina')
	assert.equal(s.sync.finalStatus, null)
	s.destroy()
	let n = 0
	const s2 = new BoardSession({ container: {}, mode: 'guest', boardId: 7, linkToken: LINK_TOKEN, ui: {}, deps: { SceneModel: FakeModel, SceneManager: FakeScene, transport: { kind: 'guest', async join() { n++; throw block } }, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null } })
	const rejected = assert.rejects(s2.open('Gina'), (e) => e === block)
	await clock.advance(500)
	s2.destroy()
	await clock.advance(5000)
	await rejected
	assert.equal(n, 1)
})

test('R22 P7-07 beforeunload asks while ops are pending also when the board is frozen (gone, reload with pending ops); the session\'s own reload goes without the question', async () => {
	// gone (an app 404) with an unsent note: the prompt protects it
	const win = fakeWin()
	const h = await open({ win, reply: (b) => (b.ops ? new HttpError(404, 'not_found', '', null, true) : null) })
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	await h.clock.advance(1000)
	assert.equal(h.s.frozen, true)
	assert.equal(h.ui.status[h.ui.status.length - 1], 'gone')
	assert.equal(h.s.replica.pendingCount(), 1)
	const ev = win.fire('beforeunload', unloadEvent())
	assert.equal(ev.prevented, true, 'frozen with a pending op: ask')
	h.s.destroy()
	// 409 with a pending op: no automatic reload, the prompt asks
	const w2 = reloadWin()
	const g = await open({ win: w2, reply: (b) => (b.ops ? new HttpError(409, 'protocol', '', null, true, { error: 'protocol', proto: 3 }) : null) })
	g.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 }, rect: null })
	await g.clock.advance(1000)
	await g.clock.settle()
	assert.equal(g.ui.status[g.ui.status.length - 1], 'reload')
	assert.deepEqual(w2.navigated, [], 'no automatic reload with an op pending')
	assert.equal(w2.fire('beforeunload', unloadEvent()).prevented, true)
	g.s.destroy()
	// 409 with nothing at stake: the session reloads itself and is never asked
	const w3 = reloadWin()
	const r = await open({ win: w3, reply: (b, n) => (n >= 2 ? new HttpError(409, 'protocol', '', null, true, { error: 'protocol', proto: 3 }) : null) })
	await r.clock.advance(1000)
	await r.clock.settle()
	assert.equal(w3.navigated.length, 1, 'the own reload started')
	assert.equal(r.s.selfReload, true)
	r.s.replica.addLocal([{ o: 'patch', id: A, p: { 'data.text': 'late' } }])
	assert.equal(w3.fire('beforeunload', unloadEvent()).prevented, false, 'the own reload must not hang on the question')
	r.s.destroy()
})

// ---- M2 (SPEC-M1 §1.2): align the selection ------------------------------------

/**
 * Records every sync.enqueue of a session (and passes it on).
 *
 * @param {object} h harness
 * @return {object[][]} the ops of each call
 */
function spyEnqueue(h) {
	const sent = []
	const plain = h.s.sync.enqueue.bind(h.s.sync)
	h.s.sync.enqueue = (ops, o) => {
		sent.push(structuredClone(ops))
		return plain(ops, o)
	}
	return sent
}

test('M2 align (AK6): three notes (two rotated) to the right edge in ONE enqueue and ONE undo step, the selection stays; undo sends the inverse; nothing in mode view, frozen or when already aligned', async () => {
	// B (r 10) and C (r 33): their hulls only reach the edge to ±0.005 on the 0.01 grid,
	// without the align tolerance every further click moved one note by 0.01 (review R1)
	const items = [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 300, y: 300, r: 10 }), sticky(C, { x: 600, y: 600, r: 33 })]
	const srv = lwwServer(items)
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onSelection([A, B, C])
	const sent = spyEnqueue(h)
	const steps = h.s.undoStack.done.length
	const requests = () => h.tr.calls.filter((c) => c.ops).length
	const before = requests()
	h.s.align('right')
	// U.maxX = C's hull: 600 + 100 + (200 cos 33° + 200 sin 33°) / 2 ≈ 838.33
	assert.deepEqual(sent, [[
		{ o: 'patch', id: A, p: { x: 638.33, y: 0, parent: null } },
		{ o: 'patch', id: B, p: { x: 622.49, y: 300, parent: null } },
	]], 'one enqueue with every patch')
	assert.equal(h.s.undoStack.done.length, steps + 1, 'one undo step')
	assert.deepEqual([A, B, C].map((id) => h.model.get(id).x), [638.33, 622.49, 600])
	assert.deepEqual(h.s.selection, [A, B, C], 'the selection stays')
	assert.deepEqual(h.ui.selection.at(-1).ids, [A, B, C])
	const box = h.ui.selection.at(-1).box
	assert.ok(Math.abs(box.x + box.w - 838.33) <= 0.01 && Math.abs(box.x - 561.67) <= 0.01, 'the shell sees the new box: ' + JSON.stringify(box))
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'one request')
	assert.deepEqual([A, B, C].map((id) => srv.live.get(id).x), [638.33, 622.49, 600])
	// already aligned (rotated hulls within the tolerance): neither an op nor an undo step, also on a third click
	h.s.align('right')
	h.s.align('right')
	assert.equal(sent.length, 1)
	assert.equal(h.s.undoStack.done.length, steps + 1)
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'no further request')
	// undo sends the inverse; every note is back
	h.s.undo()
	assert.deepEqual(sent[1], [
		{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } },
		{ o: 'patch', id: B, p: { x: 300, y: 300, parent: null } },
	])
	assert.deepEqual([A, B, C].map((id) => [h.model.get(id).x, h.model.get(id).y]), [[0, 0], [300, 300], [600, 600]])
	await h.clock.advance(1000)
	assert.deepEqual([A, B, C].map((id) => [srv.live.get(id).x, srv.live.get(id).y]), [[0, 0], [300, 300], [600, 600]])
	// frozen: nothing
	const done = h.s.undoStack.done.length
	h.s.frozen = true
	h.s.align('left')
	assert.equal(sent.length, 2)
	assert.equal(h.s.undoStack.done.length, done)
	assert.equal(h.model.get(B).x, 300)
	h.s.destroy()
	// mode view: nothing
	const v = await open({ items, viewOnly: true })
	v.s.selection = [A, B, C]
	const vsent = spyEnqueue(v)
	v.s.align('left')
	assert.deepEqual(vsent, [])
	assert.equal(v.s.undoStack.done.length, 0)
	assert.equal(v.model.get(B).x, 300)
	v.s.destroy()
})

test('M2 align (align tolerance AK6): one more note for an aligned selection – the effective click is ONE enqueue and ONE undo step (B snaps along with D), further clicks send nothing and add no undo step; one undo brings B and D back', async () => {
	const D = ID(4)
	const items = [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 300, y: 300, r: 2 }), sticky(C, { x: 600, y: 600, r: 8 }), sticky(D, { x: 900, y: 900, r: 22 })]
	const srv = lwwServer(items)
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onSelection([A, B, C])
	const sent = spyEnqueue(h)
	const steps = h.s.undoStack.done.length
	const requests = () => h.tr.calls.filter((c) => c.ops).length
	h.s.align('left')
	assert.equal(sent.length, 1, 'the first click: one enqueue')
	h.s.align('left')
	assert.equal(sent.length, 1, 'the second click sends nothing')
	assert.equal(h.s.undoStack.done.length, steps + 1)
	await h.clock.advance(1000)
	const before = requests()
	// D joins: B lies 0.0051 right of the new U.minX (C's hull) and snaps in the same click;
	// before, this click moved D only and the next one patched B (an invisible undo step)
	h.scene.callbacks.onSelection([A, B, C, D])
	h.s.align('left')
	assert.deepEqual(sent.slice(1), [[
		{ o: 'patch', id: B, p: { x: 3.42, y: 300, parent: null } },
		{ o: 'patch', id: D, p: { x: 30.17, y: 900, parent: null } },
	]], 'one enqueue with both patches')
	assert.equal(h.s.undoStack.done.length, steps + 2, 'one undo step more')
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'one request')
	h.s.align('left')
	h.s.align('left')
	assert.equal(sent.length, 2, 'no further enqueue')
	assert.equal(h.s.undoStack.done.length, steps + 2, 'no further undo step')
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'no further request')
	// the first undo takes back the last visible step: B and D
	h.s.undo()
	assert.deepEqual(sent.slice(2), [[
		{ o: 'patch', id: B, p: { x: 3.43, y: 300, parent: null } },
		{ o: 'patch', id: D, p: { x: 900, y: 900, parent: null } },
	]])
	assert.deepEqual([A, B, C, D].map((id) => [h.model.get(id).x, h.model.get(id).y]), [[0, 0], [3.43, 300], [12.94, 600], [900, 900]])
	await h.clock.advance(1000)
	assert.deepEqual([A, B, C, D].map((id) => [srv.live.get(id).x, srv.live.get(id).y]), [[0, 0], [3.43, 300], [12.94, 600], [900, 900]])
	h.s.destroy()
})

test('M2 selection v2 alignable (AK7): two notes plus a connector → 2; a frame plus its child → 1; a note plus a connector → 1; nothing selected → 0', async () => {
	const h = await open({ items: [
		sticky(A, { x: 0, y: 0 }),
		sticky(B, { x: 300, y: 0 }),
		connector(CN, { x: 0, y: 500 }, { x: 100, y: 500 }),
		frame(F, { x: 1000, y: 0 }),
		sticky(K1, { x: 10, y: 10, parent: F }),
	] })
	const alignable = (ids) => {
		h.scene.callbacks.onSelection(ids)
		return h.ui.selection.at(-1).alignable
	}
	assert.equal(alignable([A, B, CN]), 2)
	assert.equal(alignable([F, K1]), 1)
	assert.equal(alignable([A, CN]), 1)
	assert.equal(alignable([]), 0)
	assert.equal(alignable([K1, A]), 2, 'a child of a frame that is not selected counts')
	assert.equal(h.ui.selection.at(-1).count, 2, 'the other keys stay')
	h.s.destroy()
})

// ---- M2 (SPEC-M1 §1.2): distribute the selection -------------------------------

test('M2 distribute (AK7): four notes (one rotated) horizontally in ONE enqueue and ONE undo step, the selection stays and is reported; undo sends the inverse; a second click, mode view and frozen do nothing', async () => {
	const Z = ID('Z1')
	// B (r 20): hull 256.35 wide around x 350; g = (1400 − 200 − 256.35 − 200) / 3 ≈ 247.88
	const items = [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 250, y: 300, r: 20 }), sticky(C, { x: 900, y: 50 }), sticky(Z, { x: 1400, y: 0 })]
	const srv = lwwServer(items)
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onSelection([Z, C, B, A])
	const sent = spyEnqueue(h)
	const steps = h.s.undoStack.done.length
	const reported = h.ui.selection.length
	const requests = () => h.tr.calls.filter((c) => c.ops).length
	const before = requests()
	h.s.distribute('horizontal')
	assert.deepEqual(sent, [[
		{ o: 'patch', id: B, p: { x: 476.06, y: 300, parent: null } },
		{ o: 'patch', id: C, p: { x: 952.11, y: 50, parent: null } },
	]], 'one enqueue with every patch, A and Z stay')
	assert.equal(h.s.undoStack.done.length, steps + 1, 'one undo step')
	assert.deepEqual([A, B, C, Z].map((id) => h.model.get(id).x), [0, 476.06, 952.11, 1400])
	assert.deepEqual(h.s.selection, [Z, C, B, A], 'the selection stays')
	assert.equal(h.ui.selection.length, reported + 1, 'reported once more')
	assert.deepEqual(h.ui.selection.at(-1).ids, [Z, C, B, A])
	assert.equal(h.ui.selection.at(-1).alignable, 4)
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'one request')
	assert.deepEqual([A, B, C, Z].map((id) => srv.live.get(id).x), [0, 476.06, 952.11, 1400])
	// already distributed: neither an op nor an undo step, also on a third click
	h.s.distribute('horizontal')
	h.s.distribute('horizontal')
	assert.equal(sent.length, 1)
	assert.equal(h.s.undoStack.done.length, steps + 1)
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'no further request')
	// undo sends the inverse; every note is back
	h.s.undo()
	assert.deepEqual(sent[1], [
		{ o: 'patch', id: B, p: { x: 250, y: 300, parent: null } },
		{ o: 'patch', id: C, p: { x: 900, y: 50, parent: null } },
	])
	assert.deepEqual([A, B, C, Z].map((id) => [h.model.get(id).x, h.model.get(id).y]), [[0, 0], [250, 300], [900, 50], [1400, 0]])
	await h.clock.advance(1000)
	assert.deepEqual([A, B, C, Z].map((id) => [srv.live.get(id).x, srv.live.get(id).y]), [[0, 0], [250, 300], [900, 50], [1400, 0]])
	// frozen: nothing
	const done = h.s.undoStack.done.length
	h.s.frozen = true
	h.s.distribute('horizontal')
	assert.equal(sent.length, 2)
	assert.equal(h.s.undoStack.done.length, done)
	assert.equal(h.model.get(B).x, 250)
	h.s.destroy()
	// mode view: nothing, although model and sync are there – the guard stops it
	const v = await open({ items, viewOnly: true })
	v.s.selection = [A, B, C, Z]
	assert.ok(v.s.model && v.s.sync, 'model and sync exist')
	const vsent = spyEnqueue(v)
	v.s.distribute('horizontal')
	assert.deepEqual(vsent, [])
	assert.equal(v.s.undoStack.done.length, 0)
	assert.equal(v.model.get(B).x, 250)
	// the same session without the view flag distributes: only the guard held it back
	v.s.viewOnly = false
	v.s.distribute('horizontal')
	assert.equal(vsent.length, 1)
	assert.equal(v.model.get(B).x, 476.06)
	v.s.destroy()
})

// ---- M2 (SPEC-M1 §1.2): tidy up the selection ----------------------------------

test('M2 tidy (AK7): six notes in two rows (one rotated) to an exact grid in ONE enqueue and ONE undo step, the selection stays and is reported; undo sends the inverse; a second click, mode view and frozen do nothing', async () => {
	const D = ID(4)
	const E = ID(5)
	// E (r 20): hull 256.34 × 256.34 around (350, 410); mean column centres 110, 360, 630 with widths 200, 256.34, 200
	// → gaps 21.83 and 41.83 → 32, so B and E start at 200 + 32 + 28.17 = 260.17; mean row centres 113.33, 393.33 → gap 52
	const items = [
		sticky(A, { x: 0, y: 0 }), sticky(B, { x: 270, y: 30 }), sticky(C, { x: 520, y: 10 }),
		sticky(D, { x: 20, y: 290 }), sticky(E, { x: 250, y: 310, r: 20 }), sticky(F, { x: 540, y: 280 }),
	]
	const all = [A, B, C, D, E, F]
	const old = all.map((id) => [items.find((it) => it.id === id).x, items.find((it) => it.id === id).y])
	const srv = lwwServer(items)
	const h = await openLww(srv)
	await h.clock.advance(1000)
	h.scene.callbacks.onSelection([F, A, E, C, D, B])
	const sent = spyEnqueue(h)
	const steps = h.s.undoStack.done.length
	const reported = h.ui.selection.length
	const requests = () => h.tr.calls.filter((c) => c.ops).length
	const before = requests()
	h.s.tidy()
	const want = [
		{ o: 'patch', id: B, p: { x: 260.17, y: 0, parent: null } },
		{ o: 'patch', id: C, p: { x: 520.34, y: 0, parent: null } },
		{ o: 'patch', id: D, p: { x: 0, y: 280.17, parent: null } },
		{ o: 'patch', id: E, p: { x: 260.17, y: 280.17, parent: null } },
		{ o: 'patch', id: F, p: { x: 520.34, y: 280.17, parent: null } },
	]
	assert.deepEqual(sent, [want], 'one enqueue with every patch, A stays')
	assert.equal(h.s.undoStack.done.length, steps + 1, 'one undo step')
	assert.deepEqual(all.map((id) => [h.model.get(id).x, h.model.get(id).y]), [[0, 0], ...want.map((o) => [o.p.x, o.p.y])])
	assert.deepEqual(h.s.selection, [F, A, E, C, D, B], 'the selection stays')
	assert.equal(h.ui.selection.length, reported + 1, 'reported once more')
	assert.deepEqual(h.ui.selection.at(-1).ids, [F, A, E, C, D, B])
	assert.equal(h.ui.selection.at(-1).alignable, 6)
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'one request')
	assert.deepEqual(all.map((id) => [srv.live.get(id).x, srv.live.get(id).y]), [[0, 0], ...want.map((o) => [o.p.x, o.p.y])])
	// already tidy: neither an op nor an undo step, also on a third click
	h.s.tidy()
	h.s.tidy()
	assert.equal(sent.length, 1)
	assert.equal(h.s.undoStack.done.length, steps + 1)
	await h.clock.advance(1000)
	assert.equal(requests(), before + 1, 'no further request')
	// undo sends the inverse; every note is back
	h.s.undo()
	assert.deepEqual(sent[1], want.map((o) => ({ o: 'patch', id: o.id, p: { x: old[all.indexOf(o.id)][0], y: old[all.indexOf(o.id)][1], parent: null } })))
	assert.deepEqual(all.map((id) => [h.model.get(id).x, h.model.get(id).y]), old)
	await h.clock.advance(1000)
	assert.deepEqual(all.map((id) => [srv.live.get(id).x, srv.live.get(id).y]), old)
	// frozen: nothing
	const done = h.s.undoStack.done.length
	h.s.frozen = true
	h.s.tidy()
	assert.equal(sent.length, 2)
	assert.equal(h.s.undoStack.done.length, done)
	assert.equal(h.model.get(B).x, 270)
	h.s.destroy()
	// mode view: nothing, although model and sync are there – the guard stops it
	const v = await open({ items, viewOnly: true })
	v.s.selection = [...all]
	assert.ok(v.s.model && v.s.sync, 'model and sync exist')
	const vsent = spyEnqueue(v)
	v.s.tidy()
	assert.deepEqual(vsent, [])
	assert.equal(v.s.undoStack.done.length, 0)
	assert.equal(v.model.get(B).x, 270)
	// the same session without the view flag tidies up: only the guard held it back
	v.s.viewOnly = false
	v.s.tidy()
	assert.equal(vsent.length, 1)
	assert.equal(v.model.get(B).x, 260.17)
	v.s.destroy()
})

test('M2 data foundation: a server object that only differs in group or lock reaches the model and items()', async () => {
	const h = await open({ items: [sticky(A, { x: 10, y: 20, data: { text: 'hello' }, group: null, lock: null })] })
	const applied = h.model.calls.apply.length
	h.s.onChanges([sticky(A, { x: 10, y: 20, data: { text: 'hello' }, group: '01JGA0000000000000000000G1', lock: null })], [])
	assert.equal(h.model.calls.apply.length, applied + 1, 'one upsert to the model (itemKey sees group)')
	assert.equal(h.model.get(A).group, '01JGA0000000000000000000G1')
	assert.ok(debugApi(h.s).items()[0].includes('"group":"01JGA0000000000000000000G1","lock":null}'), debugApi(h.s).items()[0])
	h.s.onChanges([sticky(A, { x: 10, y: 20, data: { text: 'hello' }, group: '01JGA0000000000000000000G1', lock: { by: 'pidalice00000001', name: 'Alice Adler' } })], [])
	assert.deepEqual(h.model.get(A).lock, { by: 'pidalice00000001', name: 'Alice Adler' })
	assert.ok(debugApi(h.s).items()[0].endsWith(',"lock":{"by":"pidalice00000001","name":"Alice Adler"}}'))
	// the same object once more: no further upsert
	const n = h.model.calls.apply.length
	h.s.onChanges([sticky(A, { x: 10, y: 20, data: { text: 'hello' }, group: '01JGA0000000000000000000G1', lock: { by: 'pidalice00000001', name: 'Alice Adler' } })], [])
	assert.equal(h.model.calls.apply.length, n, 'unchanged: nothing to apply')
	h.s.destroy()
})
