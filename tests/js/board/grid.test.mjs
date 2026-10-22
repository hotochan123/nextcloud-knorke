/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession and the background grid (M2, SPEC-M1 §1.2 (R12), job 016,
 * AK9): localStorage knorke.grid = '1' turns the scene's option on when the
 * board opens (anything else: off); the board menu's payload carries grid;
 * menuAction('grid') closes the menu, switches the scene, stores and gives
 * the canvas the focus back; the scene's own switch (onGrid) is only
 * stored; toggleGrid works in modes view and vote too, without a scene it
 * gives false. No op, no undo step, no toast; following goes on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VERA = { pid: 'pidvera000000001', name: 'Vera Vogt', role: 'vote', guest: false, mod: false, source: 'share' }
const KEY = 'knorke.grid'

/** Scene fake with the stage-3 facade (setMode, setVoteState, followTo, cameraForRect, getViewport). */
class GridScene extends FakeScene {
	constructor(container, model, opts) {
		super(container, model, opts)
		this.mode = opts.mode ?? 'edit'
		this.follows = []
	}

	setMode(mode, o = {}) {
		this.log('setMode', mode, o)
		this.mode = mode
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	followTo(cam, ms) {
		this.follows.push({ cam, ms })
		return Promise.resolve(true)
	}

	stopFollow() {
		this.log('stopFollow')
	}

	cameraForRect(rect, pad = 0) {
		return { x: rect.x, y: rect.y, scale: 1, rect, pad }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

const voteMeta = () => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false })

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ storage = memoryStorage(), me = ALICE, meta = {}, viewOnly = false, presence = () => ({}), win = null } = {}) {
	const clock = new FakeClock(10000)
	const ui = { menu: [] }
	const toasts = []
	let rev = 5
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items: [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 400, y: 0 })] }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				return {}
			}
			tr.calls.push(structuredClone(body))
			const res = { rev: body.since, presence: presence(body) }
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
		ui: { onContextMenu: (m) => ui.menu.push(m) },
		deps: {
			SceneModel: FakeModel,
			SceneManager: GridScene,
			transport: tr,
			storage,
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win,
			toast: (m) => toasts.push(m),
			info: (m) => toasts.push(m),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, scene: s.scene, storage }
}

/** @return {object} a window stand-in whose document has nothing focused (body): open focuses the canvas */
function bodyWin() {
	const target = () => ({ addEventListener() {}, removeEventListener() {} })
	const body = { tagName: 'BODY' }
	return { ...target(), document: { ...target(), visibilityState: 'visible', body, activeElement: body } }
}

/** @return {object} memoryStorage with knorke.grid set to v (undefined: no entry) */
function storageWith(v) {
	const st = memoryStorage()
	if (v !== undefined) st.data.local.set(KEY, v)
	return st
}

/** @return {Promise<object[]>} the ops sent after the first n sync calls (200 ms later) */
async function opsAfter(h, n) {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}

test('(a) opening: knorke.grid "1" turns the option on, no entry, "0", "true" and "" leave it off; the order after open stays', async () => {
	const order = (x) => x.scene.calls.map((c) => c[0]).filter((n) => ['mount', 'focusCanvas', 'fit', 'setCamera'].includes(n))
	const h = await open({ storage: storageWith('1'), win: bodyWin() })
	assert.equal(FakeScene.last.opts.grid, true)
	assert.equal(h.scene.getGrid(), true)
	assert.deepEqual(order(h), ['mount', 'focusCanvas', 'fit'])
	assert.equal(h.scene.callsOf('setGrid').length, 0, 'the option, no setGrid')
	h.s.destroy()
	for (const v of [undefined, '0', 'true', '']) {
		const o = await open({ storage: storageWith(v), win: bodyWin() })
		assert.equal(FakeScene.last.opts.grid, false, JSON.stringify(v))
		assert.deepEqual(order(o), ['mount', 'focusCanvas', 'fit'])
		assert.equal(o.scene.callsOf('setGrid').length, 0, 'the option, no setGrid')
		o.s.destroy()
	}
})

test('(b) the board menu reports grid: false, after setGrid(true) a new intent reports true', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	assert.deepEqual(h.ui.menu.at(-1), { id: null, at: [640, 400], seq: 1, items: 2, grid: false, gridSnap: true, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	h.scene.setGrid(true)
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [10, 20] })
	assert.deepEqual(h.ui.menu.at(-1), { id: null, at: [10, 20], seq: 2, items: 2, grid: true, gridSnap: true, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	h.s.closeMenu()
	assert.equal(h.ui.menu.at(-1), null, 'closed: null')
	h.s.destroy()
})

test('(c) menuAction("grid"): the menu closes, setGrid(true) then focusCanvas, "1" stored; no op, undo step or toast; again: off, the key removed', async () => {
	const storage = memoryStorage()
	const h = await open({ storage })
	const n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	const before = h.scene.calls.length
	assert.equal(h.s.menuAction('grid'), true)
	assert.equal(h.ui.menu.at(-1), null, 'the menu is closed')
	const after = h.scene.calls.slice(before).map((c) => c[0])
	assert.deepEqual(after.filter((x) => x === 'setGrid' || x === 'focusCanvas'), ['setGrid', 'focusCanvas'])
	assert.deepEqual(h.scene.callsOf('setGrid').at(-1), ['setGrid', true])
	assert.equal(storage.data.local.get(KEY), '1')
	assert.deepEqual(await opsAfter(h, n), [], 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.deepEqual(h.toasts, [], 'no toast')
	// once more: off
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	assert.equal(h.ui.menu.at(-1).grid, true)
	assert.equal(h.s.menuAction('grid'), true)
	assert.deepEqual(h.scene.callsOf('setGrid').at(-1), ['setGrid', false])
	assert.equal(storage.data.local.has(KEY), false, 'the key is gone')
	h.s.destroy()
})

test('(c) without an open menu menuAction("grid") does nothing (like every entry)', async () => {
	const h = await open()
	assert.equal(h.s.menuAction('grid'), false)
	assert.equal(h.scene.callsOf('setGrid').length, 0)
	h.s.destroy()
})

test('(d) onGrid of the scene only stores ("1", then removed), no setGrid; following goes on', async () => {
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const storage = memoryStorage()
	const h = await open({ storage, presence: () => pres })
	await h.clock.advance(1000)
	assert.equal(h.s.followParticipant('pidcarol0000001'), true)
	h.scene.callbacks.onGrid(true)
	assert.equal(storage.data.local.get(KEY), '1')
	h.scene.callbacks.onGrid(false)
	assert.equal(storage.data.local.has(KEY), false)
	assert.equal(h.scene.callsOf('setGrid').length, 0, 'the scene switched itself')
	assert.equal(debugApi(h.s).state().following, 'pidcarol0000001', 'following goes on')
	h.s.toggleGrid()
	assert.equal(debugApi(h.s).state().following, 'pidcarol0000001', 'also for toggleGrid')
	h.s.destroy()
})

test('(e) toggleGrid in modes view and vote switches and stores; without a scene (before open, after destroy) false', async () => {
	const pre = new BoardSession({ container: {}, mode: 'user', boardId: 7, ui: {}, deps: { storage: memoryStorage() } })
	assert.equal(pre.toggleGrid(), false)
	const view = await open({ viewOnly: true })
	assert.equal(view.s.uiMode(), 'view')
	assert.equal(view.s.toggleGrid(), true)
	assert.deepEqual(view.scene.callsOf('setGrid').at(-1), ['setGrid', true])
	assert.equal(view.storage.data.local.get(KEY), '1')
	view.s.destroy()
	assert.equal(view.s.toggleGrid(), false, 'after destroy')
	const vote = await open({ me: VERA, meta: { vote: voteMeta() }, storage: storageWith('1') })
	assert.equal(vote.s.uiMode(), 'vote')
	assert.equal(vote.scene.getGrid(), true, 'stored on')
	assert.equal(vote.s.toggleGrid(), true)
	assert.deepEqual(vote.scene.callsOf('setGrid').at(-1), ['setGrid', false])
	assert.equal(vote.storage.data.local.has(KEY), false)
	vote.s.destroy()
})
