/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession and the switch "Snap to grid" (M2, SPEC-M1 §1.2 (R12), job
 * 019): localStorage knorke.gridSnap = '0' turns the scene's option gridSnap
 * off when the board opens (missing and anything else: on, AK4); the menu
 * payload carries gridSnap; menuAction('grid-snap') closes the menu, switches
 * the scene, stores ('0' off, the key removed on) and gives the canvas the
 * focus back; toggleGridSnap works in mode view too, without a scene it gives
 * false (AK5). No op, no undo step, no toast, no setGrid; following goes on.
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
const KEY = 'knorke.gridSnap'
const GRID = 'knorke.grid'

/** Scene fake with the stage-3 facade (setMode, setVoteState, followTo, cameraForRect, getViewport). */
class SnapScene extends FakeScene {
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
			SceneManager: SnapScene,
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

/**
 * @param {string|undefined} snap knorke.gridSnap (undefined: no entry)
 * @param {string|undefined} [grid] knorke.grid (undefined: no entry)
 * @return {object} memoryStorage with these entries
 */
function storageWith(snap, grid) {
	const st = memoryStorage()
	if (snap !== undefined) st.data.local.set(KEY, snap)
	if (grid !== undefined) st.data.local.set(GRID, grid)
	return st
}

/** @return {Promise<object[]>} the ops sent after the first n sync calls (200 ms later) */
async function opsAfter(h, n) {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}

const order = (h) => h.scene.calls.map((c) => c[0]).filter((n) => ['mount', 'focusCanvas', 'fit', 'setCamera'].includes(n))

test('AK4 (a, d) opening without knorke.gridSnap: option gridSnap true; the order after open stays; no setGridSnap', async () => {
	const h = await open({ storage: storageWith(undefined), win: bodyWin() })
	assert.equal(FakeScene.last.opts.gridSnap, true)
	assert.equal(h.scene.getGridSnap(), true)
	assert.deepEqual(order(h), ['mount', 'focusCanvas', 'fit'])
	assert.equal(h.scene.callsOf('setGridSnap').length, 0, 'the option, no setGridSnap')
	h.s.destroy()
})

test('AK4 (b, d) opening with "0": option gridSnap false; the order stays; no setGridSnap', async () => {
	const h = await open({ storage: storageWith('0'), win: bodyWin() })
	assert.equal(FakeScene.last.opts.gridSnap, false)
	assert.equal(h.scene.getGridSnap(), false)
	assert.deepEqual(order(h), ['mount', 'focusCanvas', 'fit'])
	assert.equal(h.scene.callsOf('setGridSnap').length, 0)
	h.s.destroy()
})

test('AK4 (c, d) "1", "false", "" and "off" leave it on; the order stays; no setGridSnap', async () => {
	for (const v of ['1', 'false', '', 'off']) {
		const h = await open({ storage: storageWith(v), win: bodyWin() })
		assert.equal(FakeScene.last.opts.gridSnap, true, JSON.stringify(v))
		assert.deepEqual(order(h), ['mount', 'focusCanvas', 'fit'])
		assert.equal(h.scene.callsOf('setGridSnap').length, 0)
		h.s.destroy()
	}
})

test('AK4 (e) opts.grid follows knorke.grid only', async () => {
	for (const [snap, grid, want] of [['0', undefined, false], ['0', '1', true], [undefined, '1', true], ['1', '0', false]]) {
		const h = await open({ storage: storageWith(snap, grid) })
		assert.equal(FakeScene.last.opts.grid, want, `gridSnap ${snap}, grid ${grid}`)
		assert.equal(FakeScene.last.opts.gridSnap, snap !== '0')
		h.s.destroy()
	}
})

test('AK5 (a) the board menu reports gridSnap: true, after setGridSnap(false) a new intent reports false', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	assert.deepEqual(h.ui.menu.at(-1), { id: null, at: [640, 400], seq: 1, items: 2, grid: false, gridSnap: true, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	h.scene.setGridSnap(false)
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [10, 20] })
	assert.deepEqual(h.ui.menu.at(-1), { id: null, at: [10, 20], seq: 2, items: 2, grid: false, gridSnap: false, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	h.s.closeMenu()
	assert.equal(h.ui.menu.at(-1), null, 'closed: null')
	h.s.destroy()
})

test('AK5 (b, c) menuAction("grid-snap"): closes, setGridSnap(false) then focusCanvas, "0" stored, no setGrid/op/undo/toast; again: on, the key removed', async () => {
	const storage = storageWith(undefined, '1')
	const h = await open({ storage })
	const n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	assert.equal(h.ui.menu.at(-1).gridSnap, true)
	const before = h.scene.calls.length
	assert.equal(h.s.menuAction('grid-snap'), true)
	assert.equal(h.ui.menu.at(-1), null, 'the menu is closed')
	const after = h.scene.calls.slice(before).map((c) => c[0])
	assert.deepEqual(after.filter((x) => x === 'setGridSnap' || x === 'focusCanvas' || x === 'setGrid'), ['setGridSnap', 'focusCanvas'])
	assert.deepEqual(h.scene.callsOf('setGridSnap').at(-1), ['setGridSnap', false])
	assert.equal(h.scene.callsOf('setGrid').length, 0, 'no setGrid')
	assert.equal(storage.data.local.get(KEY), '0')
	assert.equal(storage.data.local.get(GRID), '1', 'knorke.grid unchanged')
	assert.equal(h.scene.getGrid(), true, 'the grid stays shown')
	assert.deepEqual(await opsAfter(h, n), [], 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.deepEqual(h.toasts, [], 'no toast')
	// (c) once more: on, the key removed
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] })
	assert.equal(h.ui.menu.at(-1).gridSnap, false)
	assert.equal(h.s.menuAction('grid-snap'), true)
	assert.deepEqual(h.scene.callsOf('setGridSnap').at(-1), ['setGridSnap', true])
	assert.equal(storage.data.local.has(KEY), false, 'the key is gone')
	assert.equal(storage.data.local.get(GRID), '1', 'knorke.grid unchanged')
	assert.equal(h.scene.callsOf('setGrid').length, 0, 'no setGrid')
	h.s.destroy()
})

test('AK5 (d) without an open menu menuAction("grid-snap") does nothing (like every entry)', async () => {
	const h = await open()
	assert.equal(h.s.menuAction('grid-snap'), false)
	assert.equal(h.scene.callsOf('setGridSnap').length, 0)
	h.s.destroy()
})

test('AK5 (e) toggleGridSnap: false without a scene (before open, after destroy); in mode view it switches and stores', async () => {
	const pre = new BoardSession({ container: {}, mode: 'user', boardId: 7, ui: {}, deps: { storage: memoryStorage() } })
	assert.equal(pre.toggleGridSnap(), false)
	const view = await open({ viewOnly: true })
	assert.equal(view.s.uiMode(), 'view')
	assert.equal(view.s.toggleGridSnap(), true)
	assert.deepEqual(view.scene.callsOf('setGridSnap').at(-1), ['setGridSnap', false])
	assert.equal(view.storage.data.local.get(KEY), '0')
	assert.equal(view.s.toggleGridSnap(), true)
	assert.deepEqual(view.scene.callsOf('setGridSnap').at(-1), ['setGridSnap', true])
	assert.equal(view.storage.data.local.has(KEY), false)
	assert.equal(view.scene.callsOf('setGrid').length, 0, 'no setGrid')
	view.s.destroy()
	const n = view.scene.callsOf('setGridSnap').length
	assert.equal(view.s.toggleGridSnap(), false, 'after destroy')
	assert.equal(view.scene.callsOf('setGridSnap').length, n)
})

test('AK5 (e) toggleGridSnap: following goes on, no toast', async () => {
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const h = await open({ presence: () => pres })
	await h.clock.advance(1000)
	assert.equal(h.s.followParticipant('pidcarol0000001'), true)
	const toasts = h.toasts.length
	assert.equal(h.s.toggleGridSnap(), true)
	assert.equal(h.scene.getGridSnap(), false)
	assert.equal(debugApi(h.s).state().following, 'pidcarol0000001', 'following goes on')
	assert.equal(h.toasts.length, toasts, 'no toast')
	assert.equal(h.storage.data.local.get(KEY), '0')
	h.s.destroy()
})
