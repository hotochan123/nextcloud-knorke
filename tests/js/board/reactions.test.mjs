/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Emoji reactions in the session (factory job 172, AK3, AK6): react() sends
 * exactly one reaction patch (set, take back, replace) and never an undo
 * step; nothing goes out for view, a frozen board or another type; the
 * result codes (limit, bad, denied: one toast; gone: silent); the scene's
 * part of the rule (setReactions, job 183: touch); the picker (reactPick, the bar, the
 * menu) and when it closes; names and the list; selection v2 reactable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { menuEntries } from '../../../src/components/contextbar.js'
import { applyPatch } from '../../../src/model/paths.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, shape, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const S = ID(3)
const T0 = 1760100000000
const VIC = { pid: 'a1b2c3d4e5f60718', name: 'Vic Vogel', role: 'vote', guest: false, mod: false, source: 'share' }
const BOB = { pid: 'b0b0b0b0b0b0b0b0', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }
const KEY = 'data.react.pa1b2c3d4e5f60718'
const BOBKEY = 'data.react.pb0b0b0b0b0b0b0b0'
const FAILED = 'Your reaction could not be saved.'

/**
 * A session on a fake transport whose /sync answers every op with codes(ops)
 * (default ok) and sends back the items its ok patches changed (the echo;
 * the server writes n itself: here the name sent).
 *
 * @param {object} [o] items, me, codes; touch: the option touch of the session (left out when undefined)
 * @return {Promise<object>} harness
 */
async function open({ items = [sticky(A, { z: 'a1' }), sticky(B, { x: 400, z: 'a2' }), shape(S, { x: 800, z: 'a3' })], me = VIC, codes = null, touch = undefined } = {}) {
	const clock = new FakeClock(10000)
	const ui = { selection: [], undo: [], picker: [], names: [], menu: [] }
	const toasts = []
	let rev = 5
	const server = new Map(items.map((it) => [it.id, structuredClone(it)]))
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
				res.acks = { seq: body.seq, rev, res: codes ? codes(body.ops) : body.ops.map(() => 'ok') }
				res.rev = rev
				const changed = new Map()
				body.ops.forEach((op, i) => {
					if (res.acks.res[i] === 'ok' && op.o === 'patch' && server.has(op.id)) {
						applyPatch(server.get(op.id), op.p)
						changed.set(op.id, structuredClone(server.get(op.id)))
					}
				})
				if (changed.size > 0) {
					res.items = [...changed.values()]
				}
			}
			return res
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		...(touch === undefined ? {} : { touch }),
		ui: {
			onSelection: (x) => ui.selection.push(x),
			onUndoState: (x) => ui.undo.push(x),
			onReactionPicker: (x) => ui.picker.push(x),
			onReactionNames: (x) => ui.names.push(x),
			onContextMenu: (m) => ui.menu.push(m),
		},
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
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
const opsAfter = async (h, n) => {
	await h.clock.advance(3000)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}

test('AK3: none → set, the same → null, another → replaced; exactly one patch data.react.p<pid> each, never an undo step', async () => {
	const h = await open()
	const undo = h.ui.undo.length
	let n = h.tr.calls.length
	assert.equal(h.s.react(A, '1f44d'), true)
	assert.deepEqual(h.model.get(A).data.react, { pa1b2c3d4e5f60718: { e: '1f44d', n: 'Vic Vogel' } }, 'the model shows it at once')
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { [KEY]: { e: '1f44d', n: 'Vic Vogel' } } }])
	n = h.tr.calls.length
	assert.equal(h.s.react(A, '1f44d'), true, 'the same emoji again')
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { [KEY]: null } }])
	assert.equal(h.model.get(A).data.react, undefined, 'the last one gone: no data.react')
	n = h.tr.calls.length
	h.s.react(A, '1f44d')
	h.s.react(A, '2764-fe0f')
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { [KEY]: { e: '2764-fe0f', n: 'Vic Vogel' } } }], 'two in one tick: one op with the last value')
	n = h.tr.calls.length
	h.s.react(A, '1f389')
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { [KEY]: { e: '1f389', n: 'Vic Vogel' } } }], 'another one replaces')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.equal(h.ui.undo.length, undo, 'the undo state never changed')
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('AK3: no op for view, on a frozen board, for a shape, a missing note or an invalid emoji', async () => {
	const view = await open({ me: { ...VIC, role: 'view' } })
	let n = view.tr.calls.length
	assert.equal(view.s.react(A, '1f44d'), false)
	assert.deepEqual(await opsAfter(view, n), [])
	assert.deepEqual(view.scene.reactions, { canReact: false, me: VIC.pid, touch: false })
	view.s.destroy()
	const h = await open({ me: BOB })
	assert.deepEqual(h.scene.reactions, { canReact: true, me: BOB.pid, touch: false })
	n = h.tr.calls.length
	assert.equal(h.s.react(S, '1f44d'), false, 'a shape')
	assert.equal(h.s.react(ID(99), '1f44d'), false, 'no such note')
	for (const e of ['1F44D', '', 'x', null, '41']) {
		assert.equal(h.s.react(A, e), false, 'emoji ' + String(e))
	}
	h.s.onStatus('gone')
	assert.deepEqual(h.scene.reactions, { canReact: false, me: BOB.pid, touch: false }, 'a frozen board takes no reaction')
	assert.equal(h.s.react(A, '1f44d'), false, 'frozen')
	assert.deepEqual(await opsAfter(h, n), [])
	h.s.destroy()
})

test('AK3: limit, bad and denied toast "Your reaction could not be saved." once per answer; gone stays silent; no undo failure', async () => {
	for (const code of ['limit', 'bad', 'denied', 'weird']) {
		const h = await open({ codes: (ops) => ops.map(() => code) })
		h.s.react(A, '1f44d')
		h.s.react(B, '1f44d')
		await h.clock.advance(3000)
		assert.deepEqual(h.toasts, [[FAILED, 'react-failed']], code)
		assert.equal(h.model.get(A).data.react, undefined, code + ': the model is back on the server state')
		h.s.destroy()
	}
	const h = await open({ codes: (ops) => ops.map(() => 'gone') })
	h.s.react(A, '1f44d')
	await h.clock.advance(3000)
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('AK3: a role change to view and back: the scene follows; a mode switch, rights and a frozen board close the picker', async () => {
	const h = await open({ me: BOB })
	h.scene.callbacks.onIntent({ type: 'reactPick', id: A, rect: { x: 10, y: 220, w: 24, h: 24 } })
	assert.deepEqual(h.ui.picker.at(-1), { id: A, rect: { x: 10, y: 220, w: 24, h: 24 }, mine: null })
	h.s.onRole({ role: 'view', mod: false })
	assert.equal(h.ui.picker.at(-1), null, 'rights changed')
	assert.deepEqual(h.scene.reactions, { canReact: false, me: BOB.pid, touch: false })
	h.scene.callbacks.onIntent({ type: 'reactPick', id: A, rect: null })
	assert.equal(h.ui.picker.at(-1), null, 'view opens no picker')
	h.s.onRole({ role: 'vote', mod: false })
	assert.deepEqual(h.scene.reactions, { canReact: true, me: BOB.pid, touch: false })
	h.scene.callbacks.onIntent({ type: 'reactPick', id: A, rect: null })
	assert.equal(h.ui.picker.at(-1).id, A)
	h.s.onStatus('revoked')
	assert.equal(h.ui.picker.at(-1), null, 'frozen')
	h.s.destroy()
})

test('job 183 AK4: the option touch reaches scene.setReactions (only true counts); without it touch is false', async () => {
	const h = await open({ touch: true })
	assert.deepEqual(h.scene.reactions, { canReact: true, me: VIC.pid, touch: true })
	h.s.onRole({ role: 'view', mod: false })
	assert.deepEqual(h.scene.reactions, { canReact: false, me: VIC.pid, touch: true }, 'the rights change, the device stays')
	h.s.destroy()
	const plain = await open()
	assert.deepEqual(plain.scene.reactions, { canReact: true, me: VIC.pid, touch: false }, 'without the option')
	plain.s.destroy()
	const odd = await open({ touch: 1 })
	assert.equal(odd.scene.reactions.touch, false, 'anything but true counts as false')
	odd.s.destroy()
})

test('picker: the choice reacts and closes; the note going, a camera change and Esc (closeReactionPicker) close it; its own emoji is pressed', async () => {
	const h = await open()
	let n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'reactPick', id: A, rect: { x: 1, y: 2, w: 3, h: 4 } })
	assert.equal(h.s.pickReaction('1f602'), true)
	assert.equal(h.ui.picker.at(-1), null)
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { [KEY]: { e: '1f602', n: 'Vic Vogel' } } }])
	h.scene.callbacks.onIntent({ type: 'reactPick', id: A, rect: { x: 1, y: 2, w: 3, h: 4 } })
	assert.equal(h.ui.picker.at(-1).mine, '1f602', 'the own emoji')
	n = h.tr.calls.length
	h.s.onCamera({ x: 0, y: 0, scale: 1 })
	assert.equal(h.ui.picker.at(-1).id, A, 'the same camera keeps it')
	h.s.onCamera({ x: 50, y: 0, scale: 1 })
	assert.equal(h.ui.picker.at(-1), null, 'a camera change')
	assert.equal(h.s.pickReaction('1f44d'), false, 'no picker: no choice')
	h.scene.callbacks.onIntent({ type: 'reactPick', id: B, rect: null })
	h.s.onChanges([], [B])
	assert.equal(h.ui.picker.at(-1), null, 'its note went')
	h.scene.callbacks.onIntent({ type: 'reactPick', id: A, rect: null })
	h.s.closeReactionPicker()
	assert.equal(h.ui.picker.at(-1), null)
	h.scene.callbacks.onIntent({ type: 'reactPick', id: S, rect: null })
	assert.equal(h.ui.picker.at(-1), null, 'no picker for a shape')
	assert.deepEqual(await opsAfter(h, n), [])
	h.s.destroy()
})

test('intents: a pill toggles in every mode (vote without a session is view) without a vote; "+n" opens the list, a hold the names; a mouse leaving hides only its own names', async () => {
	const other = { ...sticky(A, { z: 'a1' }), data: { text: '', react: { pb0b0b0b0b0b0b0b0: { e: '1f44d', n: 'Bob Berg' }, pc0c0c0c0c0c0c0c0: { e: '2764-fe0f', n: 'Carol' } } } }
	const h = await open({ items: [other, sticky(B, { x: 400, z: 'a2' })] })
	assert.equal(h.s.clientMode, 'view')
	let n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'react', id: A, e: '1f44d' })
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { [KEY]: { e: '1f44d', n: 'Vic Vogel' } } }])
	assert.ok(h.tr.calls.slice(n).every((b) => !(b.ops ?? []).some((op) => op.o === 'vote')), 'no vote op')
	h.scene.callbacks.onIntent({ type: 'reactList', id: A, rect: { x: 5, y: 6, w: 7, h: 8 } })
	const list = h.ui.names.at(-1)
	assert.equal(list.kind, 'list')
	assert.equal(list.canReact, true)
	assert.equal(list.hold, true)
	assert.deepEqual(list.entries.map((g) => [g.e, g.n, g.mine, g.names]), [
		['1f44d', 2, true, [{ name: 'Bob Berg', mine: false }, { name: 'Vic Vogel', mine: true }]],
		['2764-fe0f', 1, false, [{ name: 'Carol', mine: false }]],
	])
	h.scene.callbacks.onIntent({ type: 'reactNames', id: null })
	assert.equal(h.ui.names.at(-1).kind, 'list', 'a mouse leaving a pill keeps the list')
	h.scene.callbacks.onIntent({ type: 'reactNames', id: A, e: '2764-fe0f', rect: null, hold: false })
	assert.deepEqual(h.ui.names.at(-1).entries.map((g) => g.e), ['2764-fe0f'])
	assert.equal(h.ui.names.at(-1).hold, false)
	h.scene.callbacks.onIntent({ type: 'reactNames', id: null })
	assert.equal(h.ui.names.at(-1), null, 'the mouse left: its names hide')
	h.scene.callbacks.onIntent({ type: 'reactNames', id: A, e: '1f44d', rect: null, hold: true })
	h.scene.callbacks.onIntent({ type: 'reactNames', id: null })
	assert.equal(h.ui.names.at(-1).kind, 'names', 'names of a hold stay')
	// they follow their note: Bob takes his back
	h.s.onChanges([{ ...structuredClone(other), data: { text: '', react: { pa1b2c3d4e5f60718: { e: '1f44d', n: 'Vic Vogel' }, pc0c0c0c0c0c0c0c0: { e: '2764-fe0f', n: 'Carol' } } } }], [])
	assert.deepEqual(h.ui.names.at(-1).entries[0].names, [{ name: 'Vic Vogel', mine: true }])
	h.s.onStatus('gone')
	assert.equal(h.ui.names.at(-1).canReact, false, 'a frozen board keeps them, without action')
	h.s.destroy()
})

test('AK6: selection v2 reactable for exactly one note (locked too) in mode edit; the menu entry and the bar open the picker', async () => {
	const locked = sticky(B, { x: 400, z: 'a2', lock: { by: 'pidcarol00000001', name: 'Carol' } })
	const h = await open({ me: BOB, items: [sticky(A, { z: 'a1' }), locked, shape(S, { x: 800, z: 'a3' })] })
	const sel = (ids) => {
		h.scene.callbacks.onSelection(ids)
		return h.ui.selection.at(-1)
	}
	assert.equal(sel([A]).reactable, true)
	assert.equal(sel([B]).reactable, true, 'a locked note')
	assert.equal(sel([A, B]).reactable, false, 'two notes')
	assert.equal(sel([S]).reactable, false, 'a shape')
	assert.equal(sel([]).reactable, false)
	// job 230: the bar's collaboration group has it, the menu not (the session still runs menuAction('react'))
	assert.ok(!menuEntries(sel([A]), A).includes('react'))
	// the menu entry: the picker at the menu's point
	sel([A])
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: A, at: [120, 80] })
	const focus = h.scene.callsOf('focusCanvas').length
	assert.equal(h.s.menuAction('react'), true)
	assert.deepEqual(h.ui.picker.at(-1), { id: A, rect: { x: 120, y: 80, w: 0, h: 0 }, mine: null })
	assert.equal(h.scene.callsOf('focusCanvas').length, focus, 'the picker takes the focus, not the canvas')
	h.s.closeReactionPicker()
	// the bar
	assert.equal(h.s.reactFromBar({ x: 300, y: 40, w: 34, h: 34 }), true)
	assert.deepEqual(h.ui.picker.at(-1).rect, { x: 300, y: 40, w: 34, h: 34 })
	sel([A, B])
	h.s.closeReactionPicker()
	assert.equal(h.s.reactFromBar(null), false, 'two selected')
	h.s.onRole({ role: 'view', mod: false })
	assert.equal(sel([A]).reactable, false, 'view')
	h.s.destroy()
})
