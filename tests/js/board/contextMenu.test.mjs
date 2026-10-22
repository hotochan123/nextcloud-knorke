/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession, stage 4 (SPEC-M1 §6.6 ContextMenu.vue, §6.5.3, §6.5.6; R19
 * T4-02, T4-03, T4-04): the intent contextMenu opens the menu state for the
 * shell after follower.onIntent (opening ends following), only in mode edit;
 * W is taken when the intent arrives; the session closes the menu on a user
 * camera change, the start of following, a mode switch away from edit, a
 * frozen status, a selection change from another source and when the target
 * leaves the model; every entry runs the context bar's command and gives the
 * canvas the focus back (not after edit-text and note-here). "Paste here"
 * with a fake navigator.clipboard: payload with data-knorke-clip, plain text
 * only, refusal, empty, image, the stored copy only with clipboard text,
 * and "no secure context → no entry". The board menu's count line follows
 * the local model at the moment the menu is reported (menu.items).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyPayload } from '../../../src/board/actions.js'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { CLIP_KEY, canReadClipboard, clipboardItemsData, clipboardReader, encodeClip } from '../../../src/board/clipboard.js'
import { debugApi } from '../../../src/board/debug.js'
import { menuCount, menuEntries } from '../../../src/components/contextbar.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const F = ID('F1')
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }

/** Scene fake with followTo/cameraForRect/setMode and a screen → world map that is no identity. */
class MenuScene extends FakeScene {
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

	/** world = 2 × container px + (100, 50): `at` and W differ */
	screenToWorld(x, y) {
		return { x: 2 * x + 100, y: 2 * y + 50 }
	}
}

/**
 * A fake ClipboardItem.
 *
 * @param {Record<string, string>} data type → content
 * @return {object} ClipboardItem stand-in (getType resolves a Blob-like)
 */
function clipItem(data) {
	return {
		types: Object.keys(data),
		getType: async (type) => ({ text: async () => data[type] }),
	}
}

/**
 * A fake navigator.clipboard whose read() records how it was called.
 *
 * @param {() => Promise<object[]>|object[]} result what read() gives (or throws)
 * @return {object} clipboard stand-in
 */
function fakeClipboard(result) {
	const cb = {
		reads: 0,
		read() {
			cb.reads++
			return result()
		},
	}
	return cb
}

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ items = [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 400, y: 0 }), sticky(C, { x: 800, y: 0 })], me = ALICE, viewOnly = false, presence = () => ({}), win = null, storage = memoryStorage() } = {}) {
	const clock = new FakeClock(10000)
	const ui = { menu: [], follow: [], selection: [], status: [] }
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
		ui: {
			onContextMenu: (m) => ui.menu.push(m),
			onFollow: (f) => ui.follow.push(f),
			onSelection: (x) => ui.selection.push(x),
			onStatus: (x) => ui.status.push(x),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: MenuScene,
			transport: tr,
			storage,
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win,
			toast: (m, o) => toasts.push(o?.hook ? [m, o.hook] : m),
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model, storage }
}

const lastMenu = (h) => h.ui.menu[h.ui.menu.length - 1]
/** what the scene does for a right click on an item outside the selection: onSelection([id]) before onIntent */
function rightClick(h, id, at) {
	if (id !== null && !h.s.selection.includes(id)) {
		h.scene.callbacks.onSelection([id])
	} else if (id === null && h.s.selection.length > 0) {
		h.scene.callbacks.onSelection([])
	}
	h.scene.callbacks.onIntent({ type: 'contextMenu', id, at })
}
const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const focusCount = (h) => h.scene.callsOf('focusCanvas').length

test('T4-02: intent contextMenu in mode edit → ui.onContextMenu({id, at, seq, items}); W = screenToWorld(at) taken at once; a new intent moves the open menu', async () => {
	const h = await open()
	rightClick(h, A, [10.4, 20.6])
	assert.deepEqual(lastMenu(h), { id: A, at: [10.4, 20.6], seq: 1, items: 3, grid: false, gridSnap: true, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	assert.deepEqual(h.s.menu.world, { x: 120.8, y: 91.2 }, 'W from the scene at the moment of the intent')
	assert.deepEqual(h.s.menu.ids, [A])
	// a new intent (keyboard, same selection) moves the open menu
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: A, at: [300, 200] })
	assert.deepEqual(lastMenu(h), { id: A, at: [300, 200], seq: 2, items: 3, grid: false, gridSnap: true, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	assert.equal(h.ui.menu.filter((m) => m === null).length, 0, 'moved, not closed')
	// empty canvas
	rightClick(h, null, [640, 400])
	assert.equal(h.ui.menu.at(-2), null, 'the selection change closed the old menu first')
	assert.deepEqual(lastMenu(h), { id: null, at: [640, 400], seq: 3, items: 3, grid: false, gridSnap: true, unlockAll: 0, unlockFrame: 0, unlockBy: 0, unlockByName: null })
	h.s.destroy()
})

test('board menu count: menu.items is the local model size when the menu is reported; a change while it is open keeps it; a new right click after a local delete or a server remove reports the new count', async () => {
	const h = await open()
	rightClick(h, null, [10, 10])
	assert.equal(lastMenu(h).items, 3)
	assert.equal(menuCount(lastMenu(h).id, lastMenu(h).items), '3 items on this board')
	// a local delete, then a new right click
	h.s.closeMenu()
	h.s.deleteIds([A])
	assert.equal(h.model.has(A), false)
	rightClick(h, null, [10, 10])
	assert.equal(lastMenu(h).items, 2)
	// a server remove while the menu is open: no new report, the line keeps the count of the opening
	const reports = h.ui.menu.length
	h.s.onChanges([], [B])
	assert.equal(h.model.has(B), false)
	assert.notEqual(h.s.menu, null, 'the board menu stays open')
	assert.equal(h.ui.menu.length, reports, 'not live')
	assert.equal(lastMenu(h).items, 2)
	// a new intent brings the current count
	rightClick(h, null, [20, 20])
	assert.equal(lastMenu(h).items, 1)
	assert.equal(menuCount(lastMenu(h).id, lastMenu(h).items), '1 item on this board')
	h.s.destroy()
	// an empty board
	const e = await open({ items: [] })
	rightClick(e, null, [0, 0])
	assert.equal(lastMenu(e).items, 0)
	assert.equal(menuCount(lastMenu(e).id, lastMenu(e).items), '0 items on this board')
	e.s.destroy()
})

test('T4-02: ignored outside mode edit, while frozen, for an id the model does not hold and for a bad `at`', async () => {
	const v = await open({ viewOnly: true })
	assert.equal(v.s.uiMode(), 'view')
	v.scene.callbacks.onIntent({ type: 'contextMenu', id: A, at: [1, 2] })
	assert.equal(v.ui.menu.length, 0, 'mode view: nothing')
	assert.equal(v.s.openMenu({ id: A, at: [1, 2] }), false, 'also not through a direct call')
	v.s.destroy()
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: ID(99), at: [1, 2] })
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [NaN, 2] })
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [1] })
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null })
	assert.equal(h.ui.menu.length, 0)
	h.s.onStatus('gone')
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [1, 2] })
	assert.equal(h.ui.menu.length, 0, 'frozen: nothing')
	h.s.destroy()
})

test('T4-04: the intent is evaluated after follower.onIntent – opening the menu ends following (§6.5.6 unchanged)', async () => {
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const h = await open({ presence: () => pres })
	await h.clock.advance(1000)
	assert.equal(h.s.followParticipant('pidcarol0000001'), true)
	assert.equal(debugApi(h.s).state().following, 'pidcarol0000001')
	const order = []
	const orig = h.s.follower.onIntent.bind(h.s.follower)
	h.s.follower.onIntent = (i, mode) => {
		order.push('follower:' + i.type + ':' + mode)
		orig(i, mode)
	}
	h.s.ui.onContextMenu = (m) => order.push(m ? 'menu' : 'menu-closed')
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [5, 5] })
	assert.deepEqual(order, ['follower:contextMenu:edit', 'menu'])
	assert.equal(debugApi(h.s).state().following, null, 'following ended')
	assert.notEqual(h.s.menu, null, 'and the menu is open')
	h.s.destroy()
})

test('T4-02: the session closes the menu – user camera, start of following, mode away from edit, frozen status, selection from another source, target gone; the same selection again keeps it', async () => {
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const h = await open({ presence: () => pres })
	await h.clock.advance(1000)
	const reopen = () => {
		rightClick(h, A, [10, 10])
		assert.notEqual(h.s.menu, null)
	}
	reopen()
	h.scene.callbacks.onUserCamera()
	assert.equal(h.s.menu, null, 'user camera')
	assert.equal(lastMenu(h), null)
	reopen()
	h.s.followParticipant('pidcarol0000001')
	assert.equal(h.s.menu, null, 'following starts')
	h.s.stopFollow()
	reopen()
	h.s.onRole({ role: 'view', mod: false })
	assert.equal(h.s.uiMode(), 'view')
	assert.equal(h.s.menu, null, 'mode away from edit')
	h.s.onRole({ role: 'owner', mod: true })
	assert.equal(h.s.uiMode(), 'edit')
	reopen()
	h.scene.callbacks.onSelection([A, B])
	assert.equal(h.s.menu, null, 'selection from another source')
	reopen()
	h.s.emitSelection()
	assert.notEqual(h.s.menu, null, 'the same selection again: stays open')
	h.s.onChanges([], [A])
	assert.equal(h.model.has(A), false)
	assert.equal(h.s.menu, null, 'the target left the model')
	rightClick(h, B, [1, 1])
	h.s.onStatus('revoked')
	assert.equal(h.s.menu, null, 'frozen status')
	h.s.destroy()
})

test('T4-02: entries on items act on the selection the scene set; each closes the menu and gives the canvas the focus back', async () => {
	const h = await open({ items: [sticky(A, { x: 0, y: 0, z: 'a1', data: { text: 'A' } }), sticky(B, { x: 400, y: 0, z: 'a2', data: { text: 'B' } }), sticky(C, { x: 800, y: 0, z: 'a3' })] })
	let n = h.tr.calls.length
	// duplicate on a multi-selection: two copies, one undo step
	h.scene.callbacks.onSelection([A, B])
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: B, at: [5, 5] })
	assert.deepEqual(menuEntries(h.s.selectionInfo(), B), ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'connect', 'group', 'lock', 'zoom-selection'], 'job 023: lock for two unlocked notes; job 026: group')
	let f = focusCount(h)
	assert.equal(h.s.menuAction('duplicate'), true)
	assert.equal(h.s.menu, null)
	assert.equal(lastMenu(h), null)
	assert.equal(focusCount(h), f + 1, 'focus back to the canvas')
	assert.equal(h.model.size, 5, 'two copies (shown at once)')
	assert.equal(h.s.selection.length, 2)
	h.s.undo()
	assert.equal(h.model.size, 3, 'one undo step removes both copies')
	// (put + remove before the next tick cancel out in the queue: nothing to send)
	let ops = await opsAfter(h, n)
	assert.equal(ops.filter((o) => o.o === 'put').length, 0)
	// front / back / delete
	n = h.tr.calls.length
	rightClick(h, A, [1, 1])
	h.s.menuAction('front')
	ops = await opsAfter(h, n)
	assert.ok(ops.some((o) => o.o === 'patch' && o.id === A && typeof o.p.z === 'string'), 'front: a new z')
	n = h.tr.calls.length
	rightClick(h, C, [1, 1])
	h.s.menuAction('back')
	ops = await opsAfter(h, n)
	assert.ok(ops.some((o) => o.o === 'patch' && o.id === C && typeof o.p.z === 'string'), 'back: a new z')
	// connect with two bindable items
	n = h.tr.calls.length
	h.scene.callbacks.onSelection([A, B])
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: A, at: [1, 1] })
	f = focusCount(h)
	h.s.menuAction('connect')
	assert.equal(focusCount(h), f + 1)
	ops = await opsAfter(h, n)
	assert.ok(ops.some((o) => o.o === 'put' && o.p?.data?.start?.item === A && o.p?.data?.end?.item === B), 'connector A → B')
	// zoom-selection (like Shift+2)
	rightClick(h, A, [1, 1])
	const cams = h.scene.callsOf('setCamera').length
	h.s.menuAction('zoom-selection')
	assert.equal(h.scene.callsOf('setCamera').length, cams + 1)
	// edit-text: the editor of the one selected item, no focus change
	rightClick(h, A, [1, 1])
	f = focusCount(h)
	h.s.menuAction('edit-text')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(0, 2), ['openTextEditor', A])
	assert.equal(focusCount(h), f, 'the editor keeps the focus')
	// cut: copy + delete, one undo step
	n = h.tr.calls.length
	rightClick(h, C, [1, 1])
	h.s.menuAction('cut')
	assert.equal(h.model.has(C), false)
	assert.deepEqual(h.infos.at(-1), '1 item copied')
	// delete
	rightClick(h, B, [1, 1])
	h.s.menuAction('delete')
	assert.equal(h.model.has(B), false)
	// no open menu: nothing happens
	const size = h.model.size
	assert.equal(h.s.menuAction('duplicate'), false)
	assert.equal(h.model.size, size)
	h.s.destroy()
})

test('T4-02: entries on the empty canvas – note-here at W (one undo step, editor, parent through containerFor), select-all like Ctrl/⌘+A, fit like Shift+1', async () => {
	const h = await open({ items: [frame(F, { x: 0, y: 0, w: 2000, h: 1000 }), sticky(A, { x: 3000, y: 0 })] })
	// at (500, 300) → W = (1100, 650): inside the frame
	rightClick(h, null, [500, 300])
	let f = focusCount(h)
	h.s.menuAction('note-here')
	const ids = [...h.model.ids()].filter((id) => id !== F && id !== A)
	assert.equal(ids.length, 1)
	const note = h.model.get(ids[0])
	assert.equal(note.t, 'sticky')
	assert.equal(note.parent, F, 'containerFor: the frame under W')
	const abs = h.model.abs(ids[0])
	assert.deepEqual([abs.x + abs.w / 2, abs.y + abs.h / 2], [1100, 650], 'box center at W')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(0, 2), ['openTextEditor', ids[0]])
	assert.equal(focusCount(h), f, 'the editor keeps the focus')
	assert.deepEqual(h.s.selection, [ids[0]])
	h.s.undo()
	assert.equal(h.model.has(ids[0]), false, 'one undo step')
	// select-all
	rightClick(h, null, [1, 1])
	f = focusCount(h)
	h.s.menuAction('select-all')
	assert.deepEqual([...h.s.selection].sort(), [F, A].sort())
	assert.deepEqual(h.scene.callsOf('setSelection').at(-1)[1].sort(), [F, A].sort())
	assert.equal(focusCount(h), f + 1)
	// fit
	rightClick(h, null, [1, 1])
	const fits = h.scene.callsOf('fit').length
	h.s.menuAction('fit')
	assert.equal(h.scene.callsOf('fit').length, fits + 1)
	h.s.destroy()
})

// ---- "Paste here" (§6.5.3 R19, T4-03) --------------------------------------------

/**
 * @param {object} cb fake navigator.clipboard
 * @param {{secure?: boolean, platform?: string}} [o] context
 * @return {object} window stand-in
 */
const winWith = (cb, { secure = true, platform = 'Win32' } = {}) => ({ isSecureContext: secure, navigator: { clipboard: cb, platform } })

test('T4-03 clipboardReader / canReadClipboard: only in a secure context with navigator.clipboard.read', () => {
	const cb = fakeClipboard(() => [])
	assert.equal(clipboardReader(winWith(cb)), cb)
	assert.equal(canReadClipboard(winWith(cb)), true)
	assert.equal(clipboardReader(winWith(cb, { secure: false })), null, 'http dev stack: no reader')
	assert.equal(canReadClipboard({ isSecureContext: 'yes', navigator: { clipboard: cb } }), false, 'only === true')
	assert.equal(canReadClipboard(winWith({ writeText() {} })), false, 'no read()')
	assert.equal(canReadClipboard(winWith(undefined)), false)
	assert.equal(canReadClipboard(null), false)
	assert.equal(canReadClipboard({ get isSecureContext() { throw new Error('x') } }), false)
	// "kein Secure Context → Eintrag fehlt"
	assert.deepEqual(menuEntries(null, null, { canPaste: canReadClipboard(winWith(cb, { secure: false })) }), ['note-here', 'select-all', 'fit'])
	assert.deepEqual(menuEntries(null, null, { canPaste: canReadClipboard(winWith(cb)) }), ['paste-here', 'note-here', 'select-all', 'fit'])
})

test('T4-03 clipboardItemsData: the first text/html and text/plain, other types count as files; Firefox\'s wrapped HTML is kept', async () => {
	assert.deepEqual(await clipboardItemsData([clipItem({ 'text/html': '<html><body><div data-knorke-clip="v1.x"></div></body></html>', 'text/plain': 'a' })]),
		{ html: '<html><body><div data-knorke-clip="v1.x"></div></body></html>', text: 'a', files: 0 })
	assert.deepEqual(await clipboardItemsData([clipItem({ 'image/png': 'PNG' })]), { html: '', text: '', files: 1 })
	assert.deepEqual(await clipboardItemsData([clipItem({ 'text/plain': 'one' }), clipItem({ 'text/plain': 'two', 'image/png': 'P' })]), { html: '', text: 'one', files: 1 })
	assert.deepEqual(await clipboardItemsData([]), { html: '', text: '', files: 0 })
	assert.deepEqual(await clipboardItemsData([{ types: ['text/plain'], getType: async () => 'plain string' }]), { html: '', text: 'plain string', files: 0 })
	await assert.rejects(clipboardItemsData([{ types: ['text/plain'], getType: async () => { throw new Error('denied') } }]))
})

test('T4-03 paste-here: read() synchronously in the click; a Knorke payload lands with its box center at W (never +20/+20, also with the originals in view); one undo step', async () => {
	let cb = null
	const h = await open({ items: [sticky(A, { x: 0, y: 0, data: { text: 'hello' } })], win: winWith((cb = fakeClipboard(() => Promise.resolve(itemsOf)))) })
	const payload = copyPayload(h.model, [A], { board: 7 })
	const clip = encodeClip(payload)
	const itemsOf = [clipItem({ 'text/html': clip.html, 'text/plain': clip.text })]
	h.s.deps.parseHtml = (html) => ({ querySelector: () => ({ getAttribute: () => /data-knorke-clip="([^"]*)"/.exec(html)[1] }) })
	// at (100, 75) → W = (300, 200)
	rightClick(h, null, [100, 75])
	const f = focusCount(h)
	assert.equal(h.s.menuAction('paste-here'), true)
	assert.equal(cb.reads, 1, 'read() ran inside the click, before the action returned')
	assert.equal(focusCount(h), f + 1)
	await h.clock.advance(0)
	const added = [...h.model.ids()].filter((id) => id !== A)
	assert.equal(added.length, 1)
	const box = h.model.abs(added[0])
	assert.deepEqual([box.x + box.w / 2, box.y + box.h / 2], [300, 200], 'box center at W, not the original +20/+20')
	assert.deepEqual(h.s.selection, added)
	h.s.undo()
	assert.equal(h.model.size, 1, 'one undo step')
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('T4-03 paste-here: plain text only → notes at W; an image without text → "Images can\'t be pasted yet."', async () => {
	let data = [clipItem({ 'text/plain': 'one\ntwo' })]
	const h = await open({ items: [], win: winWith(fakeClipboard(() => Promise.resolve(data))) })
	rightClick(h, null, [0, 0])
	h.s.menuAction('paste-here')
	await h.clock.advance(0)
	assert.equal(h.model.size, 2, 'two notes')
	const boxes = [...h.model.ids()].map((id) => h.model.abs(id))
	const cx = (Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.w))) / 2
	const cy = (Math.min(...boxes.map((b) => b.y)) + Math.max(...boxes.map((b) => b.y + b.h))) / 2
	assert.deepEqual([cx, cy], [100, 50], 'the note grid is centred on W = screenToWorld(0, 0), not on the viewport center')
	data = [clipItem({ 'image/png': 'PNG' })]
	rightClick(h, null, [0, 0])
	h.s.menuAction('paste-here')
	await h.clock.advance(0)
	assert.equal(h.model.size, 2, 'nothing pasted')
	assert.ok(h.infos.includes('Images can\'t be pasted yet.'))
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('T4-03 paste-here: refused (NotAllowedError, sync or async), empty or failed → toast paste-blocked with the platform\'s shortcut, nothing pasted', async () => {
	const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
	const cases = [
		['rejects', () => Promise.reject(denied), 'Win32', 'Ctrl+V'],
		['throws in the click', () => { throw denied }, 'MacIntel', '⌘V'],
		['empty', () => Promise.resolve([]), 'Linux x86_64', 'Ctrl+V'],
		['nothing readable', () => Promise.resolve([{ types: [], getType: async () => '' }]), 'iPad', '⌘V'],
		['getType fails', () => Promise.resolve([{ types: ['text/plain'], getType: async () => { throw new Error('x') } }]), 'Win32', 'Ctrl+V'],
	]
	for (const [name, result, platform, shortcut] of cases) {
		const h = await open({ items: [], win: winWith(fakeClipboard(result), { platform }) })
		rightClick(h, null, [0, 0])
		h.s.menuAction('paste-here')
		await h.clock.advance(0)
		assert.equal(h.model.size, 0, name + ': nothing pasted')
		assert.deepEqual(h.toasts, [[`Paste with ${shortcut} instead: the browser did not allow reading the clipboard.`, 'paste-blocked']], name)
		h.s.destroy()
	}
	// no secure context at all (the entry is missing; a direct call still only toasts)
	const h = await open({ items: [], win: winWith(fakeClipboard(() => Promise.resolve([clipItem({ 'text/plain': 'x' })])), { secure: false }) })
	rightClick(h, null, [0, 0])
	h.s.menuAction('paste-here')
	await h.clock.advance(0)
	assert.equal(h.model.size, 0)
	assert.deepEqual(h.toasts.map((x) => x[1]), ['paste-blocked'])
	h.s.destroy()
})

test('T4-03 paste-here: the stored copy only with text from the clipboard (same text, < 10 min); without text it never steps in', async () => {
	const storage = memoryStorage()
	let data = null
	const h = await open({ items: [sticky(A, { x: 0, y: 0, data: { text: '' } })], storage, win: winWith(fakeClipboard(() => Promise.resolve(data))) })
	const payload = copyPayload(h.model, [A], { board: 7 })
	// a stored copy of a note without text: its text is ''
	storage.setJson('local', CLIP_KEY, { v: 1, ts: T0, text: '', payload })
	data = [clipItem({ 'text/html': '<p>foreign</p>' })]
	rightClick(h, null, [0, 0])
	h.s.menuAction('paste-here')
	await h.clock.advance(0)
	assert.equal(h.model.size, 1, 'no clipboard text: the stored copy does not step in')
	// with matching text it does (Ctrl+Shift+V style plain text from Knorke)
	storage.setJson('local', CLIP_KEY, { v: 1, ts: T0, text: 'Hello', payload })
	data = [clipItem({ 'text/plain': ' Hello ' })]
	rightClick(h, null, [0, 0])
	h.s.menuAction('paste-here')
	await h.clock.advance(0)
	assert.equal(h.model.size, 2, 'the stored payload')
	const copy = [...h.model.ids()].find((id) => id !== A)
	assert.equal(h.model.get(copy).t, 'sticky')
	const b = h.model.abs(copy)
	assert.deepEqual([b.x + b.w / 2, b.y + b.h / 2], [100, 50], 'at W')
	h.s.destroy()
})
