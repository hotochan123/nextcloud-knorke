/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 182 (AK11, from round 1 on): template suggestions in
 * BoardSession, with the real SceneModel, a scene fake and an LWW server (as
 * in boardFileSession.test.mjs).
 * - insertOwnTemplate: one commit, the new items selected, the canvas
 *   focused, Undo removes them; an invalid content toasts template-invalid,
 *   a full board template-full ({max}), each without an op; nothing in mode
 *   view, mode vote, on a frozen board or as a guest
 * - templateDraft: the board or the selection as a board file with title ""
 *   and its sketch, the board title as the name (cut to 100); an empty
 *   board: export-empty; too large: template-too-large; a guest: null
 *   without a message; never an op
 * - the context menu's save-template hands the selection's draft to the
 *   shell (ui.onSaveTemplate)
 * Factory job 192 (AK1–AK4, replaces the all or nothing of job 187 AK6):
 * insertOwnTemplate keeps the good items like a board file: the items that
 * pass go in, a connector only with both ends, and the toast
 * template-skipped counts the left-out items and dropped connectors; full
 * counts only the items that pass; a template without an item that passes
 * (or without an op left) still toasts template-invalid.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { readBoardFile } from '../../../src/board/boardFile.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, connector, frame, memoryStorage, shape, sticky } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const VOTER = { pid: 'pidvoter00000001', name: 'Volker', role: 'vote', guest: false, mod: false, source: 'share' }
const GUEST = { pid: 'pidgina000000001', name: 'Gina', role: 'edit', guest: true, mod: false, source: 'guest' }
const TITLE = 'Retro: Q3'
const EMPTY = 'There is nothing on the board to save.'
const INVALID = 'This template cannot be inserted.'
const voteMeta = () => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false })

const F = ID(1)
const C = ID(2)
const N = ID(3)
const S = ID(4)
const K = ID(5)
/** A frame with a child, a note with Alice's reaction, a shape she locked, a connector. */
const ITEMS = Object.freeze([
	frame(F, { x: 0, y: 0, w: 300, h: 300, data: { title: 'Rahmen' } }),
	sticky(C, { x: 50, y: 50, z: 'i1', parent: F, data: { text: 'Kind' } }),
	sticky(N, { x: 400, y: 0, z: 'i2', data: { text: 'Notiz', react: { ['p' + ALICE.pid]: { e: '1f44d', n: 'Alice Adler' } } } }),
	shape(S, { x: 400, y: 280, z: 'i3', data: { kind: 'rect', text: 'Form' }, lock: { by: ALICE.pid, name: 'Alice Adler' } }),
	connector(K, { item: N }, { item: S }, { z: 'i4' }),
])

/** @param {object[]} items WireItems @return {string} a template's content (a board file with title "") */
const contentOf = (items) => JSON.stringify({ knorke: 1, kind: 'board', title: '', origin: [0, 0], items })

/** Scene fake with setMode, cameraForRect and a screen → world map (world = 2 · px + (100, 50)). */
class TplScene extends FakeScene {
	setMode(mode) {
		this.log('setMode', mode)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	cameraForRect(rect, pad = 0) {
		const scale = Math.min((1280 - 2 * pad) / rect.w, (800 - 2 * pad) / rect.h)
		return { x: rect.x + rect.w / 2 - 1280 / (2 * scale), y: rect.y + rect.h / 2 - 800 / (2 * scale), scale }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}

	screenToWorld(x, y) {
		return { x: 2 * x + 100, y: 2 * y + 50 }
	}
}

/** LWW server of the test: applies ops and answers with every item changed since the cursor. */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) {
				return 'dup'
			}
			srv.live.set(op.id, itemFromPut(op))
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
 * @param {object} [o] items, me, meta, limits, title, guest, ui
 * @return {Promise<object>} harness: s, log (toasts and infos), opsSince, saved (ui.onSaveTemplate)
 */
async function open({ items = ITEMS, me = ALICE, meta = {}, limits = {}, title = TITLE, guest = false } = {}) {
	const clock = new FakeClock(10000)
	const log = []
	const saved = []
	const srv = lwwServer(items)
	const answer = () => ({ proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title, role: me.role, metaRev: 3, meta }, me, items: structuredClone(items) })
	const tr = {
		kind: guest ? 'guest' : 'user',
		calls: [],
		async snapshot() {
			return answer()
		},
		async join() {
			return { ...answer(), guest: { token: 't' } }
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
		mode: guest ? 'guest' : 'user',
		...(guest ? { linkToken: 'Ab3dEf6hIj9kLm2nOp5qRs8t' } : { boardId: 7 }),
		limits,
		ui: { onSaveTemplate: (d) => saved.push(d) },
		deps: {
			SceneModel,
			SceneManager: TplScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			wall: () => T0,
			downloadBlob: () => {
				throw new Error('no download')
			},
			download: () => {
				throw new Error('no download')
			},
		},
	})
	await (guest ? s.open('Gina') : s.open())
	await clock.advance(0)
	const opsSince = async (from = 0) => {
		await clock.advance(200)
		return tr.calls.slice(from).flatMap((b) => b.ops ?? [])
	}
	return { s, clock, tr, log, saved, scene: s.scene, model: s.model, opsSince }
}

// ---- insertOwnTemplate ----------------------------------------------------------------

test('AK11 insertOwnTemplate in mode edit: one commit, the new roots and connectors selected, the canvas focused; one undo removes it', async () => {
	const existing = sticky(ID(60), { x: 5000, y: 5000, data: { text: 'schon da' } })
	const h = await open({ items: [existing] })
	const draft = (await open()).s.templateDraft('board')
	const focus = h.scene.callsOf('focusCanvas').length
	const calls = h.tr.calls.length
	assert.equal(h.s.insertOwnTemplate(draft.content), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one commit, one undo step')
	const ops = await h.opsSince(calls)
	assert.equal(ops.length, ITEMS.length)
	assert.ok(ops.every((op) => op.o === 'put'), 'only puts')
	const fresh = ops.map((op) => op.id)
	assert.ok(fresh.every((id) => !ITEMS.some((it) => it.id === id) && id !== existing.id), 'new ids')
	const child = ops.find((op) => op.p.parent !== null)
	assert.deepEqual([...h.s.selection].sort(), fresh.filter((id) => id !== child.id).sort(), 'the new roots and connectors selected')
	assert.ok(ops.every((op) => !op.p.lock && !op.p.data?.react), 'no lock, no reaction')
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus')
	assert.deepEqual(h.log, [])
	const n = h.tr.calls.length
	h.s.undo()
	const removed = await h.opsSince(n)
	assert.deepEqual(removed.map((op) => op.o), Array(ITEMS.length).fill('remove'))
	assert.equal(h.model.size, 1)
	assert.ok(h.model.has(existing.id))
	h.s.destroy()
})

test('AK11 an invalid content toasts template-invalid, a full board template-full with {max}; no op, no undo step', async () => {
	const h = await open()
	for (const bad of ['kein JSON', null, '{}', JSON.stringify({ knorke: 2, kind: 'board', title: '', items: [sticky(ID(20))] }), contentOf([]), contentOf([{ ...sticky(ID(21)), t: 'hologram' }])]) {
		h.log.length = 0
		const n = h.tr.calls.length
		assert.equal(h.s.insertOwnTemplate(bad), false, String(bad))
		assert.deepEqual(h.log, [['toast', INVALID, 'template-invalid']], String(bad))
		assert.deepEqual(await h.opsSince(n), [])
		assert.equal(h.s.undoStack.done.length, 0)
		assert.equal(h.model.size, ITEMS.length)
	}
	h.s.destroy()
	const eight = Array.from({ length: 8 }, (_, i) => sticky(ID(30 + i), { x: i * 250, z: 'i' + i }))
	const f = await open({ items: eight, limits: { maxItems: 10 } })
	assert.equal(f.s.insertOwnTemplate(contentOf([0, 1, 2].map((i) => sticky(ID(40 + i), { x: i * 250 })))), false)
	assert.deepEqual(f.log, [['toast', 'The template does not fit: a board holds at most 10 items.', 'template-full']])
	assert.deepEqual(await f.opsSince(0), [])
	assert.equal(f.s.undoStack.done.length, 0)
	assert.equal(f.model.size, 8)
	f.s.destroy()
})

/** @param {string} id item id @param {object} [extra] fields @return {object} an item of a type this version does not know */
const hologram = (id, extra = {}) => ({ ...sticky(id, extra), t: 'hologram' })

test('job 192 AK1 a good note and a hologram: the note goes in (new id), "1 item could not be pasted." (template-skipped); one commit, selected, focused, true; one undo removes it', async () => {
	const h = await open()
	const focus = h.scene.callsOf('focusCanvas').length
	const calls = h.tr.calls.length
	assert.equal(h.s.insertOwnTemplate(contentOf([sticky(ID(20), { data: { text: 'gut' } }), hologram(ID(21), { x: 300 })])), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one commit, one undo step')
	const ops = await h.opsSince(calls)
	assert.equal(ops.length, 1)
	assert.equal(ops[0].o, 'put')
	assert.equal(ops[0].t, 'sticky')
	assert.equal(ops[0].p.data.text, 'gut')
	assert.ok(![ID(20), ID(21)].includes(ops[0].id), 'a new id')
	assert.deepEqual([...h.s.selection], [ops[0].id])
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus')
	assert.deepEqual(h.log, [['toast', '1 item could not be pasted.', 'template-skipped']])
	const n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual((await h.opsSince(n)).map((op) => [op.o, op.id]), [['remove', ops[0].id]])
	assert.equal(h.model.size, ITEMS.length)
	h.s.destroy()
})

test('job 192 AK2 note A, frame F with child C, an unknown X, connectors A→C, A→X and A→an id not in the template: 4 puts (A, F, C, A→C), C in F, A→C at the new ids, "3 items could not be pasted."', async () => {
	const A = ID(20)
	const FR = ID(21)
	const CH = ID(22)
	const X = ID(23)
	const content = contentOf([
		frame(FR, { x: 0, y: 0, w: 400, h: 300, data: { title: 'F' } }),
		sticky(CH, { x: 40, y: 60, z: 'i1', parent: FR, data: { text: 'C' } }),
		sticky(A, { x: 500, y: 0, z: 'i2', data: { text: 'A' } }),
		hologram(X, { x: 500, y: 300, z: 'i3' }),
		connector(ID(24), { item: A }, { item: CH }, { z: 'i4' }),
		connector(ID(25), { item: A }, { item: X }, { z: 'i5' }),
		connector(ID(26), { item: A }, { item: ID(99) }, { z: 'i6' }),
	])
	const h = await open()
	const calls = h.tr.calls.length
	assert.equal(h.s.insertOwnTemplate(content), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one commit, one undo step')
	const ops = await h.opsSince(calls)
	assert.equal(ops.length, 4)
	assert.ok(ops.every((op) => op.o === 'put'), 'only puts')
	assert.ok(ops.every((op) => ![A, FR, CH, X, ID(24), ID(25), ID(26)].includes(op.id)), 'new ids')
	const byText = (s) => ops.find((op) => op.t !== 'connector' && (op.p.data.text ?? op.p.data.title) === s)
	const [a, f, c] = ['A', 'F', 'C'].map(byText)
	assert.ok(a && f && c, 'A, F and C')
	assert.deepEqual([c.p.parent, c.p.x, c.p.y], [f.id, 40, 60], 'C stays the child of the new F, relative')
	const conns = ops.filter((op) => op.t === 'connector')
	assert.equal(conns.length, 1)
	assert.deepEqual([conns[0].p.data.start, conns[0].p.data.end], [{ item: a.id }, { item: c.id }], 'A→C at the new ids')
	// the count: X, A→X and the connector to an id that is not in the template
	assert.deepEqual(h.log, [['toast', '3 items could not be pasted.', 'template-skipped']])
	h.s.destroy()
})

test('job 192 AK3 8 of 10 items: two good notes and two holograms put 2 and count 2; three good notes toast template-full, no op', async () => {
	const eight = Array.from({ length: 8 }, (_, i) => sticky(ID(30 + i), { x: i * 250, z: 'i' + i }))
	const h = await open({ items: eight, limits: { maxItems: 10 } })
	const mixed = contentOf([sticky(ID(40)), sticky(ID(41), { x: 250 }), hologram(ID(42)), hologram(ID(43))])
	assert.equal(h.s.insertOwnTemplate(mixed), true)
	assert.deepEqual((await h.opsSince(0)).map((op) => op.o), ['put', 'put'])
	assert.deepEqual(h.log, [['toast', '2 items could not be pasted.', 'template-skipped']])
	assert.equal(h.model.size, 10)
	h.s.destroy()
	const f = await open({ items: eight, limits: { maxItems: 10 } })
	assert.equal(f.s.insertOwnTemplate(contentOf([0, 1, 2].map((i) => sticky(ID(40 + i), { x: i * 250 })))), false)
	assert.deepEqual(f.log, [['toast', 'The template does not fit: a board holds at most 10 items.', 'template-full']])
	assert.deepEqual(await f.opsSince(0), [])
	assert.equal(f.s.undoStack.done.length, 0)
	assert.equal(f.model.size, 8)
	f.s.destroy()
})

test('job 192 AK4 a template without an item that passes, or with only a connector between two holograms, still toasts template-invalid: false, no op, no undo step, no template-skipped', async () => {
	const h = await open()
	const cases = [
		['no JSON', 'kein JSON'],
		['null', null],
		['{}', '{}'],
		['knorke 2', JSON.stringify({ knorke: 2, kind: 'board', title: '', items: [sticky(ID(20))] })],
		['no items', contentOf([])],
		['only holograms', contentOf([hologram(ID(21)), hologram(ID(22), { x: 300 })])],
		['a connector between two holograms', contentOf([hologram(ID(21)), hologram(ID(22), { x: 300 }), connector(ID(23), { item: ID(21) }, { item: ID(22) })])],
	]
	for (const [label, content] of cases) {
		h.log.length = 0
		const n = h.tr.calls.length
		assert.equal(h.s.insertOwnTemplate(content), false, label)
		assert.deepEqual(h.log, [['toast', INVALID, 'template-invalid']], label + ': the toast')
		assert.deepEqual(await h.opsSince(n), [], label + ': no op')
		assert.equal(h.s.undoStack.done.length, 0, label + ': no undo step')
		assert.equal(h.model.size, ITEMS.length, label + ': nothing inserted')
	}
	h.s.destroy()
})

test('AK11 no op in mode view, mode vote or on a frozen board: false, no toast, no undo step', async () => {
	const view = await open({ me: VIEWER })
	assert.equal(view.s.uiMode(), 'view')
	const vote = await open({ me: VOTER, meta: { vote: voteMeta() } })
	assert.equal(vote.s.uiMode(), 'vote')
	const frozen = await open()
	frozen.s.onStatus('gone')
	assert.equal(frozen.s.frozen, true)
	for (const h of [view, vote, frozen]) {
		const n = h.tr.calls.length
		assert.equal(h.s.insertOwnTemplate(contentOf([sticky(ID(70))])), false)
		assert.equal(h.s.insertOwnTemplate('kein JSON'), false, 'not even the invalid toast')
		assert.deepEqual(h.log, [])
		assert.deepEqual(await h.opsSince(n), [])
		assert.equal(h.s.undoStack.done.length, 0)
		assert.equal(h.model.size, ITEMS.length)
		h.s.destroy()
	}
})

// ---- templateDraft --------------------------------------------------------------------

test('AK11 templateDraft(\'board\'): the board file with title "" and its sketch, the board title as the name; in every role and mode, frozen too; no op', async () => {
	const frozen = await open()
	frozen.s.onStatus('gone')
	for (const [label, h] of [['owner', await open()], ['viewer', await open({ me: VIEWER })], ['vote', await open({ me: VOTER, meta: { vote: voteMeta() } })], ['frozen', frozen]]) {
		const n = h.tr.calls.length
		const d = h.s.templateDraft('board')
		assert.ok(d, label)
		assert.deepEqual(Object.keys(d), ['scope', 'content', 'sketch', 'name'], label)
		assert.equal(d.scope, 'board')
		assert.equal(d.name, TITLE)
		const f = JSON.parse(d.content)
		assert.deepEqual([f.kind, f.title, f.items.length], ['board', '', ITEMS.length], label)
		assert.ok(!d.content.includes('Alice') && !d.content.includes(ALICE.pid) && !d.content.includes('"react"') && !d.content.includes('"lock"'), label + ': no names, pids, reactions or locks')
		assert.equal(readBoardFile(d.content).ok, true)
		assert.equal(d.sketch.length, ITEMS.length - 1, 'no connector in the sketch')
		assert.deepEqual(h.log, [])
		assert.deepEqual(await h.opsSince(n), [], label + ': no op')
		assert.equal(h.s.undoStack.done.length, 0)
		h.s.destroy()
	}
})

test('AK11 templateDraft on an empty board: the info export-empty, null; too large: the toast template-too-large; a long title is cut to 100; a guest: null without a message', async () => {
	const e = await open({ items: [] })
	assert.equal(e.s.templateDraft('board'), null)
	assert.deepEqual(e.log, [['info', EMPTY, 'export-empty']])
	e.s.destroy()
	const many = Array.from({ length: 1001 }, (_, i) => sticky(ID(1000 + i), { x: i * 10, z: 'i' + String(i).padStart(4, '0') }))
	const big = await open({ items: many })
	assert.equal(big.s.templateDraft('board'), null)
	assert.deepEqual(big.log, [['toast', 'This is too large for a template: at most 1000 items and 2 MB.', 'template-too-large']])
	big.s.destroy()
	const long = await open({ title: 'ä'.repeat(150) })
	assert.equal(long.s.templateDraft('board').name, 'ä'.repeat(100))
	long.s.destroy()
	const g = await open({ me: GUEST, guest: true })
	assert.equal(g.s.templateDraft('board'), null)
	assert.deepEqual(g.log, [])
	g.s.destroy()
})

test('AK11 the context menu\'s save-template: the selection\'s draft goes to ui.onSaveTemplate (the dialog takes the focus); a selection draft holds the selected items only', async () => {
	const h = await open()
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10] })
	const focus = h.scene.callsOf('focusCanvas').length
	assert.equal(h.s.menuAction('save-template'), true)
	assert.equal(h.s.menu, null, 'the menu closed')
	assert.equal(h.saved.length, 1)
	const d = h.saved[0]
	assert.equal(d.scope, 'selection')
	assert.deepEqual(JSON.parse(d.content).items.map((it) => it.id).sort(), [F, C].sort(), 'the frame with its child')
	assert.equal(d.sketch.length, 2)
	assert.equal(d.name, TITLE)
	assert.equal(h.scene.callsOf('focusCanvas').length, focus, 'the focus stays for the dialog')
	assert.deepEqual(await h.opsSince(0), [])
	h.s.destroy()
})
