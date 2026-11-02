/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The session's side of "Select n locked items" (factory job 190), with the
 * fake scene of fakes.mjs (its offer() stands for the scene's own input: a
 * plain marquee or Ctrl/⌘+A, reported by onLockedOffer):
 * - AK3 selection v2 lockedOffer counts the offered items that still exist
 *   and are locked; it follows an unlock and a removal by others with a
 *   report of its own (no own action); selectLockedOffer() selects exactly
 *   the ones left, ends the offer, sends no op, adds no undo step, shows no
 *   message; "Select all" of the menu offers the locked items like
 *   Ctrl/⌘+A; outside mode edit there is no offer
 * - AK4 after selectLockedOffer() with own and foreign locks
 *   unlockSelection() lifts only the own lock for an editor and every lock
 *   for a moderator, each in one undo step; copy() puts every selected
 *   locked item on the clipboard
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { CLIP_KEY } from '../../../src/board/clipboard.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const L1 = ID('L1')
const L2 = ID('L2')
const A = ID(1)
const T0 = 1760100000000
/** A plain editor and the owner (moderates). */
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const byBob = { by: BOB.pid, name: 'Bob Berg' }
const byCarol = { by: 'pidcarol00000001', name: 'Carol' }

/** L1 locked by Bob, L2 locked by Carol, A free. */
const items = () => [sticky(L1, { x: 0, y: 0, z: 'a1', lock: byBob }), sticky(L2, { x: 400, y: 0, z: 'a2', lock: byCarol }), sticky(A, { x: 800, y: 0, z: 'a3' })]

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ me = BOB, viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	const ui = { selection: [], menu: [] }
	const toasts = []
	const infos = []
	const storage = memoryStorage()
	let rev = 5
	const snapItems = items()
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta: {} }, me, items: snapItems }
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
		viewOnly,
		ui: {
			onSelection: (x) => ui.selection.push(x),
			onContextMenu: (m) => ui.menu.push(m),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: FakeScene,
			transport: tr,
			storage,
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
	return { s, clock, tr, ui, toasts, infos, storage, scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const lastSel = (h) => h.ui.selection.at(-1)
const sorted = (ids) => [...ids].sort()
/** the server says: these items now carry these locks */
const serverLocks = (h, locks) => h.s.onChanges(Object.entries(locks).map(([id, lock]) => ({ ...structuredClone(h.model.get(id)), lock })), [])

test('job 190 AK3: lockedOffer counts the offered items that exist and are locked; an unlock and a removal by others report it again', async () => {
	const h = await open()
	assert.equal(h.s.selectionInfo().lockedOffer, 0, 'no offer')
	h.scene.offer([L1, L2, A])
	assert.equal(lastSel(h).lockedOffer, 2, 'reported at once; the free A does not count')
	assert.equal(lastSel(h).count, 0, 'nothing selected')
	let n = h.ui.selection.length
	serverLocks(h, { [L2]: null })
	assert.equal(h.ui.selection.length, n + 1, 'a report without an own action')
	assert.equal(lastSel(h).lockedOffer, 1, 'L2 unlocked by someone else')
	serverLocks(h, { [L2]: byCarol })
	assert.equal(lastSel(h).lockedOffer, 2, 'locked again: it counts again')
	n = h.ui.selection.length
	h.s.onChanges([], [L1])
	assert.equal(h.ui.selection.length, n + 1)
	assert.equal(lastSel(h).lockedOffer, 1, 'L1 deleted by someone else')
	n = h.ui.selection.length
	serverLocks(h, { [A]: null })
	assert.equal(h.ui.selection.length, n, 'a change that leaves the number alone reports nothing')
	h.s.destroy()
})

test('job 190 AK3: selectLockedOffer() selects exactly the remaining ids and ends the offer: no op, no undo step, no message', async () => {
	const h = await open()
	h.scene.callbacks.onSelection([A])
	h.scene.offer([L1, L2])
	serverLocks(h, { [L2]: null })
	assert.equal(lastSel(h).lockedOffer, 1)
	const n = h.tr.calls.length
	assert.equal(h.s.selectLockedOffer(), true)
	assert.deepEqual(h.s.selection, [L1], 'only the one still locked; it replaces [A]')
	assert.deepEqual(h.scene.getSelection(), [L1], 'the scene too')
	assert.deepEqual(h.scene.getLockedOffer(), [], 'the offer ended')
	assert.equal(lastSel(h).lockedOffer, 0)
	assert.deepEqual(lastSel(h).ids, [L1])
	assert.equal(lastSel(h).locked, 1)
	assert.deepEqual(await opsAfter(h, n), [], 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.deepEqual([h.toasts, h.infos], [[], []], 'no message')
	assert.equal(h.s.selectLockedOffer(), false, 'nothing offered any more')
	assert.deepEqual(h.s.selection, [L1])
	h.s.destroy()
})

test('job 190 AK3: "Select all" of the menu selects the free items and offers the locked ones, like Ctrl/⌘+A', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	assert.equal(h.s.menuAction('select-all'), true)
	assert.deepEqual(h.s.selection, [A])
	assert.deepEqual(sorted(h.scene.getLockedOffer()), sorted([L1, L2]))
	assert.equal(lastSel(h).lockedOffer, 2, 'reported with the number')
	assert.deepEqual(lastSel(h).ids, [A])
	assert.equal(h.s.selectLockedOffer(), true)
	assert.deepEqual(sorted(h.s.selection), sorted([L1, L2]))
	h.s.destroy()
})

test('job 190 AK3: outside mode edit no offer: lockedOffer 0, "Select all" offers nothing, selectLockedOffer() does nothing', async () => {
	const h = await open({ viewOnly: true })
	assert.notEqual(h.s.clientMode, 'edit')
	h.scene.offer([L1, L2])
	assert.equal(h.s.selectionInfo().lockedOffer, 0)
	h.s.selectAll()
	assert.deepEqual(h.scene.callsOf('setLockedOffer'), [], 'no offer set')
	assert.equal(h.s.selectLockedOffer(), false)
	assert.deepEqual(h.s.selection, [A], 'select all as before')
	h.s.destroy()
})

test('job 190 AK4: after selectLockedOffer() an editor unlocks only the own lock, a moderator every lock, each in one undo step', async () => {
	for (const [me, expect] of [[BOB, [L1]], [ALICE, [L1, L2]]]) {
		const h = await open({ me })
		h.scene.offer([L1, L2])
		h.s.selectLockedOffer()
		assert.equal(lastSel(h).unlockable, expect.length, me.name)
		const n = h.tr.calls.length
		assert.equal(h.s.unlockSelection(), true, me.name)
		const ops = await opsAfter(h, n)
		assert.deepEqual(sorted(ops.map((o) => o.id)), sorted(expect), me.name)
		assert.ok(ops.every((o) => o.o === 'patch' && o.p.lock === null), me.name)
		assert.equal(h.s.undoStack.done.length, 1, me.name + ': one undo step')
		assert.deepEqual(sorted(h.s.selection), sorted([L1, L2]), me.name + ': the selection stays')
		h.s.destroy()
	}
})

test('job 190 AK4: copy() puts every selected locked item on the clipboard', async () => {
	const h = await open()
	h.scene.offer([L1, L2])
	h.s.selectLockedOffer()
	h.s.copy()
	const clip = h.storage.getJson('local', CLIP_KEY)
	assert.deepEqual(sorted(clip.payload.items.map((it) => it.id)), sorted([L1, L2]))
	assert.deepEqual(h.infos, ['2 items copied'])
	h.s.destroy()
})
