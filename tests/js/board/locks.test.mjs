/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession and locked items (job 023, M2 SPEC-M1 §1.2 "(R20) Sperren";
 * AK8, AK9, AK11): the safety net of commit() and sendHistory(), the result
 * code itemlocked (one toast lock-held, the text rescue with its own notice,
 * never "Undo not possible"), a lock arriving for the open editor, lock and
 * unlock and toggleLock (one undo step each), selection v2 with the lock
 * fields, editing actions on mixed selections (only the unlocked items;
 * delete and cut toast lock-delete), select all, and undo/redo over locks
 * (lock-undo, the step moves anyway; undo of the own lock unlocks).
 * Job 044: the moderators' "Unlock all" and "Unlock all in this frame" (the
 * menu payload's unlockAll / unlockFrame, one undo step, batches of MAX_OPS,
 * busy retried, the toast unlock-all; nothing for others, in mode view or
 * frozen), select all still skips locked items for a moderator.
 * Job 062: the board menu inside a frame offers that frame (unlockFrame for
 * the frame under the point), "Unlock all locked by {name}" (the payload's
 * unlockBy / unlockByName, unlockByIds, unlockBy(pid): the locker's locks
 * only, the moderation's own stay), the toast unlock-none for a set that is
 * empty by the click, and lockStep as the one path of every lock step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession, KNOWN_CODES } from '../../../src/board/BoardSession.js'
import { menuEntries } from '../../../src/components/contextbar.js'
import { MAX_OPS } from '../../../src/sync/Replica.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const F = ID('F1')
const T0 = 1760100000000
/** A plain editor (no moderation right) and the owner (moderates). */
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const byBob = { by: BOB.pid, name: 'Bob Berg' }
const byCarol = { by: 'pidcarol00000001', name: 'Carol' }

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ items = [sticky(A, { x: 0, y: 0, z: 'a1' }), sticky(B, { x: 400, y: 0, z: 'a2' }), sticky(C, { x: 800, y: 0, z: 'a3' })], me = BOB, codes = null, viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	const ui = { selection: [], rescue: [], undo: [], menu: [] }
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
				res.acks = { seq: body.seq, rev, res: codes ? codes(body.ops, body) : body.ops.map(() => 'ok') }
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
			onRescue: (x) => ui.rescue.push(x),
			onUndoState: (x) => ui.undo.push(x),
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
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const select = (h, ids) => h.scene.callbacks.onSelection(ids)
const lastSel = (h) => h.ui.selection.at(-1)
/** the server says: these items now carry these locks */
const serverLocks = (h, locks) => h.s.onChanges(Object.entries(locks).map(([id, lock]) => ({ ...structuredClone(h.model.get(id)), lock })), [])

test('job 023: itemlocked is a known result code', () => {
	assert.ok(KNOWN_CODES.includes('itemlocked'))
})

test('AK8 safety net: commit leaves out an op on a locked item silently (inverse kept, no step when nothing is left); a lock patch on it goes out', async () => {
	const h = await open({ items: [sticky(A, { lock: byCarol }), sticky(B, { x: 400 })] })
	let n = h.tr.calls.length
	h.s.commit({ ops: [{ o: 'patch', id: A, p: { x: 50, y: 0, parent: null } }], inverse: [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } }] })
	assert.deepEqual(await opsAfter(h, n), [], 'nothing reaches a locked item')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step without an op')
	assert.deepEqual(h.toasts, [], 'silently')
	n = h.tr.calls.length
	const r = {
		ops: [{ o: 'patch', id: A, p: { 'style.fill': '#ffffff' } }, { o: 'patch', id: B, p: { 'style.fill': '#ffffff' } }],
		inverse: [{ o: 'patch', id: A, p: { 'style.fill': '#a8d8f8' } }, { o: 'patch', id: B, p: { 'style.fill': '#a8d8f8' } }],
	}
	h.s.commit(r)
	assert.deepEqual((await opsAfter(h, n)).map((o) => o.id), [B], 'only the op on the free item')
	assert.deepEqual(h.s.undoStack.done.at(-1).inverse, r.inverse, 'the inverse stays as it was')
	n = h.tr.calls.length
	h.s.commit({ ops: [{ o: 'patch', id: A, p: { lock: null } }], inverse: [{ o: 'patch', id: A, p: { lock: byCarol } }] })
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { lock: null } }], 'a lock patch is never held back')
	h.s.destroy()
})

test('AK8: handleFailed with itemlocked → one toast lock-held with the number of distinct items; never "Undo not possible", never the bad path', async () => {
	const h = await open()
	h.s.undoPending.add(A)
	const warns = []
	const warn = console.warn
	console.warn = (...a) => warns.push(a.join(' '))
	try {
		h.s.handleFailed([
			{ op: { o: 'patch', id: A, p: { x: 1, y: 1, parent: null } }, code: 'itemlocked' },
			{ op: { o: 'patch', id: A, p: { w: 300 } }, code: 'itemlocked' },
			{ op: { o: 'remove', id: B }, code: 'itemlocked' },
		])
	} finally {
		console.warn = warn
	}
	assert.deepEqual(h.toasts, [['2 locked items were not changed.', 'lock-held']])
	assert.deepEqual(warns, [], 'not treated as unknown or bad')
	h.s.handleFailed([{ op: { o: 'patch', id: C, p: { 'style.fill': '#ffffff' } }, code: 'itemlocked' }])
	assert.deepEqual(h.toasts.at(-1), ['1 locked item was not changed.', 'lock-held'], 'one toast per answer')
	assert.ok(!h.toasts.flat().includes('Undo not possible'))
	h.s.destroy()
})

test('AK8: a text op answered itemlocked goes to the text rescue with its own notice', async () => {
	const h = await open({ codes: (ops) => ops.map(() => 'itemlocked') })
	h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'my words', before: '', final: true })
	await h.clock.advance(150)
	const opened = h.scene.callsOf('openTextEditor')
	assert.equal(opened.length, 1, 'the rescue editor opens')
	assert.deepEqual([opened[0][1], opened[0][2].text], [A, 'my words'])
	assert.equal(opened[0][2].notice, 'Not saved: this item is locked. Copy your text before closing.')
	assert.equal(h.s.noticeFor(A, 'itemlocked'), 'Not saved: this item is locked. Copy your text before closing.')
	assert.deepEqual(h.toasts, [['1 locked item was not changed.', 'lock-held']])
	h.s.destroy()
})

test('AK8: a lock arriving for the item of the open editor ends editing like a lost lease (loseLease with the notice); also the own lock from another tab', async () => {
	for (const lock of [byCarol, { by: BOB.pid, name: BOB.name }]) {
		const h = await open()
		h.scene.callbacks.onEditing(A, false)
		h.scene.active.add(A)
		serverLocks(h, { [A]: lock })
		const notice = h.scene.callsOf('setEditorNotice')
		assert.equal(notice.length, 1, JSON.stringify(lock))
		assert.deepEqual(notice[0].slice(1), [A, 'Not saved: this item is locked. Copy your text before closing.'])
		assert.ok(h.s.leaseLost.has(A))
		// nothing more is sent for the text
		const n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'text', id: A, path: 'data.text', value: 'more', before: '', final: false })
		assert.deepEqual((await opsAfter(h, n)).filter((o) => o.id === A), [])
		h.s.destroy()
	}
	// an item that was locked before the editor opened (rescue editor): no second notice
	const h = await open({ items: [sticky(A, { lock: byCarol })] })
	h.scene.callbacks.onEditing(A, false)
	h.s.onChanges([{ ...structuredClone(h.model.get(A)), x: 5 }], [])
	assert.equal(h.scene.callsOf('setEditorNotice').length, 0)
	h.s.destroy()
})

test('AK9 toggleLock: a mixed selection locks only the free items (one undo step, the selection stays); undo sends {lock: null}', async () => {
	const h = await open({ items: [sticky(A), sticky(B, { x: 400, lock: { by: BOB.pid, name: BOB.name } })] })
	select(h, [A, B])
	assert.deepEqual([lastSel(h).lockable, lastSel(h).unlockable, lastSel(h).locked], [1, 1, 1])
	let n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'toggleLock' })
	assert.deepEqual(h.model.get(A).lock, { by: BOB.pid, name: 'Bob Berg' }, 'shown at once')
	assert.deepEqual(lastSel(h).lockedBy, { kind: 'mine' }, 'the bar follows')
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { lock: { by: BOB.pid, name: 'Bob Berg' } } }])
	assert.deepEqual(h.s.selection, [A, B], 'the selection stays')
	assert.equal(h.s.undoStack.done.length, 1)
	n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { lock: null } }])
	assert.deepEqual(h.infos, [], 'no toast for the own lock')
	n = h.tr.calls.length
	h.s.redo()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { lock: { by: BOB.pid, name: 'Bob Berg' } } }], 'redo locks again')
	h.s.destroy()
})

test('AK9 toggleLock: only own locks → unlock (inverse locks with me); only foreign locks without mod → toast lock-unlock (facilitator wording, job 093), nothing sent', async () => {
	const h = await open({ items: [sticky(A, { lock: { by: BOB.pid, name: BOB.name } }), sticky(B, { x: 400, lock: byCarol })] })
	select(h, [A])
	let n = h.tr.calls.length
	h.s.toggleLock()
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { lock: null } }])
	assert.deepEqual(h.s.undoStack.done.at(-1).inverse, [{ o: 'patch', id: A, p: { lock: { by: BOB.pid, name: 'Bob Berg' } } }])
	select(h, [B])
	n = h.tr.calls.length
	h.s.toggleLock()
	assert.deepEqual(await opsAfter(h, n), [])
	assert.deepEqual(h.infos, [['Only the person who locked it or a facilitator can unlock it.', 'lock-unlock']])
	h.s.destroy()
	// a moderator lifts Carol's lock (visibly: unlockBy names her)
	const m = await open({ me: ALICE, items: [sticky(B, { lock: byCarol })] })
	select(m, [B])
	assert.deepEqual(lastSel(m).unlockBy, { kind: 'name', name: 'Carol' })
	n = m.tr.calls.length
	m.s.toggleLock()
	assert.deepEqual(await opsAfter(m, n), [{ o: 'patch', id: B, p: { lock: null } }])
	m.s.destroy()
})

test('AK9 lockSelection/unlockSelection (bar and menu): one step each; nothing in mode view or while frozen', async () => {
	const h = await open()
	select(h, [A, B])
	assert.equal(h.s.lockSelection(), true)
	assert.equal(h.s.undoStack.done.length, 1)
	assert.equal(h.s.undoStack.done[0].ops.length, 2)
	h.s.onIntent({ type: 'contextMenu', id: A, at: [1, 1] })
	assert.deepEqual(menuEntries(h.s.selectionInfo(), A), ['copy', 'connect', 'group', 'unlock', 'zoom-selection'], 'own locks: copy, connect, group (blocked, job 026), unlock, zoom')
	assert.equal(h.s.menuAction('unlock'), true)
	assert.equal(h.model.get(A).lock, null)
	assert.equal(h.s.undoStack.done.length, 2)
	h.s.onStatus('revoked')
	assert.equal(h.s.lockSelection(), false, 'frozen')
	assert.equal(h.s.selectionInfo().lockable, 0)
	h.s.destroy()
})

test('selection v2 (AK9): style fields describe only the unlocked items; ids, count, canConnect the whole selection; lock fields', async () => {
	const h = await open({ items: [sticky(A, { style: { fill: '#ffffff' } }), sticky(B, { x: 400, lock: byCarol, style: { fill: '#a8d8f8' } })] })
	select(h, [A, B])
	const sel = lastSel(h)
	assert.deepEqual(sel.ids, [A, B])
	assert.equal(sel.count, 2)
	assert.equal(sel.canConnect, true, 'Connect over the whole selection')
	assert.deepEqual([...sel.types], ['sticky'])
	assert.equal(sel.fill, '#ffffff', 'the locked note does not make the fill mixed')
	assert.deepEqual(sel.mixed, [])
	assert.deepEqual(sel.box, { x: 0, y: 0, w: 200, h: 200, r: 0 }, 'the box of the free note')
	assert.deepEqual([sel.locked, sel.unlocked, sel.lockable, sel.unlockable], [1, 1, 1, 0])
	assert.deepEqual([sel.lockedBy, sel.unlockBy], [{ kind: 'name', name: 'Carol' }, null])
	select(h, [B])
	const only = lastSel(h)
	assert.deepEqual([only.count, [...only.types], only.fields, only.box, only.alignable], [1, [], [], null, 0], 'a fully locked selection has no style fields')
	assert.deepEqual(menuEntries(only, B), ['copy', 'zoom-selection'], 'foreign lock without mod')
	// a lock change of a selected item reports the selection again
	const before = h.ui.selection.length
	serverLocks(h, { [B]: null })
	assert.equal(h.ui.selection.length, before + 1)
	assert.equal(lastSel(h).locked, 0)
	h.s.destroy()
})

test('AK11: deleting [A free, B locked] sends exactly one remove (A), toasts lock-delete 1, and B stays selected; only locked: toast, nothing sent', async () => {
	const h = await open({ items: [sticky(A), sticky(B, { x: 400, lock: byCarol })] })
	select(h, [A, B])
	let n = h.tr.calls.length
	h.scene.callbacks.onIntent({ type: 'delete', ids: [A, B] })
	assert.deepEqual(await opsAfter(h, n), [{ o: 'remove', id: A }])
	assert.deepEqual(h.infos, [['1 locked item was not deleted.', 'lock-delete']])
	assert.deepEqual(h.s.selection, [B])
	assert.deepEqual(h.scene.selection, [B])
	n = h.tr.calls.length
	h.s.deleteSelection()
	assert.deepEqual(await opsAfter(h, n), [])
	assert.deepEqual(h.infos.at(-1), ['1 locked item was not deleted.', 'lock-delete'], 'also when nothing was deleted')
	h.s.destroy()
})

test('AK11: cutting [A free, B locked] copies only A, deletes A, toasts lock-delete; copy takes both', async () => {
	const h = await open({ items: [sticky(A, { data: { text: 'free' } }), sticky(B, { x: 400, lock: byCarol, data: { text: 'held' } })] })
	select(h, [A, B])
	let n = h.tr.calls.length
	assert.equal(h.s.copyNow(true), true)
	assert.deepEqual(h.infos.slice(0, 2), ['1 item copied', ['1 locked item was not deleted.', 'lock-delete']])
	assert.deepEqual(await opsAfter(h, n), [{ o: 'remove', id: A }])
	assert.deepEqual(h.s.selection, [B])
	select(h, [B])
	assert.equal(h.s.copyNow(false), true)
	assert.equal(h.infos.at(-1), '1 item copied', 'copy works on a locked item')
	n = h.tr.calls.length
	assert.equal(h.s.copyNow(true), false, 'cut of a fully locked selection copies nothing')
	assert.deepEqual(h.infos.at(-1), ['1 locked item was not deleted.', 'lock-delete'])
	assert.deepEqual(await opsAfter(h, n), [])
	h.s.destroy()
})

test('AK11: deleting a free frame with a locked child sends no patch on the child (the server releases it)', async () => {
	const h = await open({ items: [frame(F, { x: 0, y: 0 }), sticky(A, { x: 20, y: 30, parent: F, lock: byCarol }), sticky(B, { x: 300, y: 30, parent: F })] })
	select(h, [F])
	const n = h.tr.calls.length
	h.s.deleteSelection()
	const ops = await opsAfter(h, n)
	assert.ok(ops.some((o) => o.o === 'remove' && o.id === F), 'the frame goes')
	assert.ok(!ops.some((o) => o.id === A), 'nothing on the locked child: ' + JSON.stringify(ops))
	assert.ok(ops.some((o) => o.o === 'patch' && o.id === B), 'the free child is released as before')
	assert.deepEqual(h.infos, [], 'no toast: the frame itself is free')
	h.s.destroy()
})

test('AK11: style, z order, align, duplicate and the arrow keys send ops only for the free items', async () => {
	const h = await open({ items: [sticky(A, { x: 0 }), sticky(B, { x: 400, lock: byCarol }), sticky(C, { x: 800, y: 100 })] })
	select(h, [A, B, C])
	const only = async (fn) => {
		const n = h.tr.calls.length
		fn()
		const ops = await opsAfter(h, n)
		assert.ok(ops.length > 0)
		assert.ok(!ops.some((o) => o.id === B), JSON.stringify(ops))
		return ops
	}
	await only(() => h.s.setStyle('style.fill', '#ffffff'))
	await only(() => h.s.reorder('front'))
	await only(() => h.s.align('top'))
	const dup = await only(() => h.s.duplicate())
	assert.equal(dup.filter((o) => o.o === 'put').length, 2, 'two copies: A and C')
	select(h, [A, B, C])
	await only(() => h.s.nudge(10, 0))
	select(h, [B])
	const n = h.tr.calls.length
	h.s.setStyle('style.fill', '#ffffff')
	h.s.reorder('back')
	h.s.nudge(10, 0)
	h.s.duplicate()
	h.s.arrange({ x: 5 })
	assert.deepEqual(await opsAfter(h, n), [], 'a fully locked selection: nothing at all')
	h.s.destroy()
})

test('select all skips locked items; edit-text and the label editor never open on a locked item', async () => {
	const h = await open({ items: [sticky(A), sticky(B, { x: 400, lock: byCarol }), sticky(C, { x: 800 })] })
	h.s.selectAll()
	assert.deepEqual(h.s.selection, [A, C])
	select(h, [B])
	assert.equal(h.s.editTextOf(B), false)
	assert.equal(h.scene.callsOf('openTextEditor').length, 0)
	h.s.destroy()
})

test('AK11 undo: move A, someone locks A, undo → nothing sent, toast lock-undo 1, the step is on the redo stack', async () => {
	const h = await open()
	let n = h.tr.calls.length
	h.s.commit({ ops: [{ o: 'patch', id: A, p: { x: 50, y: 0, parent: null } }], inverse: [{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } }] })
	await opsAfter(h, n)
	serverLocks(h, { [A]: byCarol })
	n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), [])
	assert.deepEqual(h.infos, [['1 locked item was skipped.', 'lock-undo']])
	assert.equal(h.s.undoStack.canRedo(), true, 'the step moved to the redo stack')
	assert.equal(h.s.undoStack.canUndo(), false)
	assert.deepEqual(h.ui.undo.at(-1), { canUndo: false, canRedo: true })
	// redo: skipped again with the toast
	h.s.redo()
	assert.deepEqual(h.infos.at(-1), ['1 locked item was skipped.', 'lock-undo'])
	assert.equal(h.s.undoStack.canUndo(), true)
	h.s.destroy()
})

// ---- Job 044: "Unlock all" and "Unlock all in this frame" for moderators -------

const D = ID(4)
const N1 = ID(5)
const N2 = ID(6)
const N3 = ID(7)
const O = ID(8)
const byAlice = { by: ALICE.pid, name: ALICE.name }
const unknownLock = { by: null, name: null }
/** A member with the right "can moderate" (role edit). */
const MOD = { pid: 'pidmona00000001', name: 'Mona Moder', role: 'edit', guest: false, mod: true, source: 'share' }
const lastMenu = (h) => h.ui.menu.at(-1)
const unlockOps = (ids) => ids.map((id) => ({ o: 'patch', id, p: { lock: null } }))
const lockOps = (ids, lock) => ids.map((id) => ({ o: 'patch', id, p: { lock } }))
const unlockToasts = (h) => h.infos.filter((x) => Array.isArray(x) && x[1] === 'unlock-all')

/** What the scene does for a right click: an item outside the selection becomes it, the empty canvas clears it; then the intent. */
function rightClick(h, id, at = [640, 400]) {
	if (id !== null && !h.s.selection.includes(id)) {
		h.scene.callbacks.onSelection([id])
	} else if (id === null && h.s.selection.length > 0) {
		h.scene.callbacks.onSelection([])
	}
	h.scene.callbacks.onIntent({ type: 'contextMenu', id, at })
}

/**
 * The board of AK3 in model order: A locked by Carol, B by `own`, C free, D
 * with an unknown locker, frame F (free) with N1 (locked by Carol) and N2
 * (free).
 *
 * @param {object} own the lock of B (ALICE's, or BOB's own lock)
 * @return {object[]} WireItems
 */
const ak3Board = (own = byAlice) => [
	sticky(A, { x: 0, y: 0, z: 'a1', lock: byCarol }),
	sticky(B, { x: 400, y: 0, z: 'a2', lock: own }),
	sticky(C, { x: 800, y: 0, z: 'a3' }),
	sticky(D, { x: 0, y: 400, z: 'a4', lock: unknownLock }),
	frame(F, { x: 1200, y: 0 }),
	sticky(N1, { x: 20, y: 30, z: 'a5', parent: F, lock: byCarol }),
	sticky(N2, { x: 300, y: 30, z: 'a6', parent: F }),
]

test('job 044 AK3: the menu payload counts what a moderator may unlock – board menu unlockAll 4 (A, B, D, N1), frame F unlockFrame 1, C both 0; not live; BOB (no mod, his own lock) always 0', async () => {
	const h = await open({ me: ALICE, items: ak3Board() })
	rightClick(h, null)
	assert.deepEqual([lastMenu(h).unlockAll, lastMenu(h).unlockFrame], [4, 0], 'empty canvas')
	assert.deepEqual(h.s.unlockAllIds(), [A, B, D, N1], 'model order: foreign, own and unknown locks, a locked child')
	// a lock change while the menu is open: no new report, the number of the opening stays
	const reports = h.ui.menu.length
	serverLocks(h, { [C]: byCarol })
	assert.equal(h.ui.menu.length, reports, 'not live')
	assert.equal(lastMenu(h).unlockAll, 4)
	serverLocks(h, { [C]: null })
	h.s.closeMenu()
	rightClick(h, F)
	assert.deepEqual([lastMenu(h).unlockAll, lastMenu(h).unlockFrame], [0, 1], 'frame F: F free, N1 locked')
	assert.deepEqual(h.s.unlockFrameIds(F), [N1])
	h.s.closeMenu()
	rightClick(h, C)
	assert.deepEqual([lastMenu(h).unlockAll, lastMenu(h).unlockFrame], [0, 0], 'a note: no frame')
	h.s.closeMenu()
	rightClick(h, N1)
	assert.equal(lastMenu(h).unlockFrame, 0, 'a locked child is no frame')
	h.s.destroy()
	const b = await open({ me: BOB, items: ak3Board(byBob) })
	for (const id of [null, F, B]) {
		rightClick(b, id)
		assert.deepEqual([lastMenu(b).unlockAll, lastMenu(b).unlockFrame], [0, 0], 'BOB: ' + id)
		b.s.closeMenu()
	}
	assert.deepEqual([b.s.unlockAllIds(), b.s.unlockFrameIds(F)], [[], []])
	b.s.destroy()
})

test('job 044 AK4: "Unlock all" as ALICE sends one {lock: null} for A, B, D and N1 each (nothing for C, F, N2), one undo step with her lock as the inverse, unlocked at once, the toast unlock-all; undo locks again in her name, redo unlocks, neither toasts', async () => {
	const h = await open({ me: ALICE, items: ak3Board() })
	rightClick(h, null)
	const focus = h.scene.callsOf('focusCanvas').length
	let n = h.tr.calls.length
	assert.equal(h.s.menuAction('unlock-all'), true)
	assert.equal(lastMenu(h), null, 'the menu is closed')
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus back')
	for (const id of [A, B, D, N1]) {
		assert.equal(h.model.get(id).lock, null, 'unlocked at once: ' + id)
	}
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	assert.deepEqual(h.s.undoStack.done[0].ops, unlockOps([A, B, D, N1]))
	assert.deepEqual(h.s.undoStack.done[0].inverse, lockOps([A, B, D, N1], byAlice), 'the inverse locks in her name')
	assert.deepEqual(h.infos.at(-1), ['4 items unlocked', 'unlock-all'])
	assert.deepEqual(h.s.selection, [], 'the selection stays (the board menu cleared it)')
	assert.deepEqual(await opsAfter(h, n), unlockOps([A, B, D, N1]), 'each once, in model order')
	n = h.tr.calls.length
	h.s.undo()
	// (before the fake server's ack: it sends no echo, so the settled state is the snapshot's)
	assert.deepEqual(h.model.get(A).lock, byAlice, 'shown locked by ALICE at once')
	assert.deepEqual(await opsAfter(h, n), lockOps([A, B, D, N1], byAlice), 'undo: locked again in ALICE\'s name')
	n = h.tr.calls.length
	h.s.redo()
	assert.deepEqual(await opsAfter(h, n), unlockOps([A, B, D, N1]), 'redo: unlocked again')
	assert.equal(unlockToasts(h).length, 1, 'undo and redo show no toast unlock-all')
	assert.deepEqual(h.infos.filter((x) => Array.isArray(x) && x[1] === 'lock-undo'), [], 'lock patches are never skipped')
	h.s.destroy()
})

test('job 044 AK4: unlockAll() keeps a selection and reports it again (the bar\'s Unlock/Lock follow); a single item: "1 item unlocked"', async () => {
	const h = await open({ me: ALICE, items: ak3Board() })
	select(h, [A, C])
	assert.deepEqual([lastSel(h).locked, lastSel(h).unlockable, lastSel(h).lockable], [1, 1, 1])
	const reports = h.ui.selection.length
	assert.equal(h.s.unlockAll(), true)
	assert.deepEqual(h.s.selection, [A, C], 'the selection stays')
	assert.ok(h.ui.selection.length > reports, 'reported again')
	assert.deepEqual([lastSel(h).locked, lastSel(h).unlockable, lastSel(h).lockable], [0, 0, 2])
	h.s.destroy()
	const one = await open({ me: ALICE, items: [sticky(A, { lock: byCarol }), sticky(C, { x: 800 })] })
	assert.equal(one.s.unlockAll(), true)
	assert.deepEqual(one.infos.at(-1), ['1 item unlocked', 'unlock-all'])
	one.s.destroy()
})

test('job 044 AK4: nothing for BOB (not even his own lock), in mode view, after revoked, or when the set is empty by the click (unlocked meanwhile, mod taken away); without a locked item only the toast unlock-none (job 062)', async () => {
	const b = await open({ me: BOB, items: ak3Board(byBob) })
	let n = b.tr.calls.length
	assert.equal(b.s.unlockAll(), false)
	assert.equal(b.s.unlockFrame(F), false)
	assert.deepEqual(await opsAfter(b, n), [], 'nothing sent')
	assert.deepEqual(b.infos, [], 'no toast')
	assert.equal(b.s.undoStack.done.length, 0, 'no undo step')
	assert.deepEqual(b.model.get(B).lock, byBob, 'his own lock stays')
	b.s.destroy()
	const v = await open({ me: ALICE, items: ak3Board(), viewOnly: true })
	assert.equal(v.s.uiMode(), 'view')
	n = v.tr.calls.length
	assert.equal(v.s.unlockAll(), false, 'mode view')
	assert.deepEqual(await opsAfter(v, n), [])
	assert.deepEqual(unlockToasts(v), [])
	v.s.destroy()
	const r = await open({ me: ALICE, items: ak3Board() })
	r.s.onStatus('revoked')
	n = r.tr.calls.length
	assert.equal(r.s.unlockAll(), false, 'revoked (frozen)')
	assert.deepEqual(await opsAfter(r, n), [])
	assert.deepEqual(unlockToasts(r), [])
	r.s.destroy()
	const free = await open({ me: ALICE })
	n = free.tr.calls.length
	assert.equal(free.s.unlockAll(), false, 'no locked item')
	assert.deepEqual(await opsAfter(free, n), [])
	assert.deepEqual(free.infos, [['Nothing left to unlock.', 'unlock-none']], 'job 062: a moderator hears that nothing is left')
	free.s.destroy()
	// counted when the menu opened, empty when it runs: the set is computed again
	const late = await open({ me: ALICE, items: [sticky(A, { lock: byCarol }), sticky(C, { x: 800 })] })
	rightClick(late, null)
	assert.equal(lastMenu(late).unlockAll, 1)
	serverLocks(late, { [A]: null })
	n = late.tr.calls.length
	assert.equal(late.s.menuAction('unlock-all'), true, 'the entry ran')
	assert.deepEqual(await opsAfter(late, n), [], 'someone unlocked meanwhile: nothing sent')
	assert.deepEqual(unlockToasts(late), [])
	assert.equal(late.s.undoStack.done.length, 0)
	late.s.destroy()
	const demoted = await open({ me: MOD, items: ak3Board({ by: MOD.pid, name: MOD.name }) })
	rightClick(demoted, null)
	assert.equal(lastMenu(demoted).unlockAll, 4, 'a member who may moderate')
	assert.equal(demoted.s.applyRole('edit', false), true)
	n = demoted.tr.calls.length
	assert.equal(demoted.s.unlockAll(), false, 'mod taken away: nothing, not even the own lock')
	assert.deepEqual(await opsAfter(demoted, n), [])
	assert.deepEqual(unlockToasts(demoted), [])
	demoted.s.destroy()
})

test('job 044 AK4 batches: 450 notes locked by Carol, "Unlock all" as ALICE – every request carries at most MAX_OPS ops, all together exactly the 450 {lock: null} once each; one undo step of 450 ops', async () => {
	const ids = Array.from({ length: 450 }, (_, i) => ID('M' + i))
	const h = await open({ me: ALICE, items: ids.map((id, i) => sticky(id, { x: (i % 30) * 220, y: Math.floor(i / 30) * 220, lock: byCarol })) })
	const n = h.tr.calls.length
	assert.equal(h.s.unlockAll(), true)
	for (let k = 0; k < 50 && h.s.replica.pendingCount() > 0; k++) {
		await h.clock.advance(500)
	}
	assert.equal(h.s.replica.pendingCount(), 0, 'nothing waits any more')
	const batches = h.tr.calls.slice(n).filter((b) => Array.isArray(b.ops) && b.ops.length > 0)
	assert.equal(MAX_OPS, 200)
	assert.ok(batches.length >= 3, batches.length + ' requests')
	assert.ok(batches.every((b) => b.ops.length <= MAX_OPS), 'at most MAX_OPS per request: ' + batches.map((b) => b.ops.length))
	const sent = batches.flatMap((b) => b.ops)
	assert.equal(sent.length, 450)
	assert.deepEqual(sent, unlockOps(ids), 'each id once, in model order')
	assert.equal(h.s.undoStack.done.length, 1)
	assert.equal(h.s.undoStack.done[0].ops.length, 450)
	assert.deepEqual(h.infos, [['450 items unlocked', 'unlock-all']])
	h.s.destroy()
})

test('job 044 (§5): a batch answered busy (write budget) waits and goes again with the same seq and ops; nothing is lost, no error toast', async () => {
	const ids = Array.from({ length: 450 }, (_, i) => ID('M' + i))
	let busySeq = null
	const codes = (ops, body) => {
		// the second batch of the unlock is answered busy once
		if (busySeq === null && ops.length > 0 && ops[0].id === ids[MAX_OPS]) {
			busySeq = body.seq
			return ops.map(() => 'busy')
		}
		return ops.map(() => 'ok')
	}
	const h = await open({ me: ALICE, codes, items: ids.map((id, i) => sticky(id, { x: (i % 30) * 220, y: Math.floor(i / 30) * 220, lock: byCarol })) })
	const n = h.tr.calls.length
	assert.equal(h.s.unlockAll(), true)
	for (let k = 0; k < 100 && h.s.replica.pendingCount() > 0; k++) {
		await h.clock.advance(500)
	}
	assert.equal(h.s.replica.pendingCount(), 0, 'nothing waits any more')
	assert.notEqual(busySeq, null, 'one batch was answered busy')
	const batches = h.tr.calls.slice(n).filter((b) => Array.isArray(b.ops) && b.ops.length > 0)
	const again = batches.filter((b) => b.seq === busySeq)
	assert.equal(again.length, 2, 'the busy batch went out twice')
	assert.deepEqual(again[1].ops, again[0].ops, 'with the same ops')
	assert.ok(batches.every((b) => b.ops.length <= MAX_OPS))
	const accepted = batches.filter((b, i) => !(b.seq === busySeq && i === batches.indexOf(again[0]))).flatMap((b) => b.ops)
	assert.deepEqual(accepted, unlockOps(ids), 'the accepted batches carry every id once')
	assert.deepEqual(h.toasts, [], 'no error toast')
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.destroy()
})

test('job 044 AK5: "Unlock all in this frame" as ALICE: F (locked by BOB), N1 (Carol), N3 (unknown locker) – not N2 (free) nor O outside; one undo step, the toast unlock-all; then the frame offers it no more', async () => {
	const items = [
		frame(F, { x: 0, y: 0, lock: byBob }),
		sticky(N1, { x: 20, y: 30, z: 'a1', parent: F, lock: byCarol }),
		sticky(N2, { x: 300, y: 30, z: 'a2', parent: F }),
		sticky(N3, { x: 20, y: 300, z: 'a3', parent: F, lock: unknownLock }),
		sticky(O, { x: 1200, y: 0, z: 'a4', lock: byCarol }),
	]
	const h = await open({ me: ALICE, items })
	rightClick(h, F)
	assert.equal(lastMenu(h).unlockFrame, 3)
	// job 062: F is locked by BOB, so his entry shows as well (only F is his)
	assert.deepEqual([lastMenu(h).unlockBy, lastMenu(h).unlockByName], [1, 'Bob Berg'])
	assert.deepEqual(menuEntries(h.s.selectionInfo(), F, lastMenu(h)), ['copy', 'unlock', 'unlock-by', 'unlock-frame', 'zoom-selection'])
	let n = h.tr.calls.length
	assert.equal(h.s.menuAction('unlock-frame'), true)
	assert.deepEqual(await opsAfter(h, n), unlockOps([F, N1, N3]), 'the frame and its locked children')
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	assert.deepEqual(h.infos.at(-1), ['3 items unlocked', 'unlock-all'])
	assert.deepEqual(h.model.get(O).lock, byCarol, 'O outside stays locked')
	assert.deepEqual(h.s.selection, [F], 'the selection stays')
	// then the frame offers it no more: a new menu on F counts 0 and has no entry
	// (the server's changes arrive; the fake server itself never echoes items)
	serverLocks(h, { [F]: null, [N1]: null, [N3]: null })
	rightClick(h, F)
	assert.equal(lastMenu(h).id, F)
	assert.equal(lastMenu(h).unlockFrame, 0, 'nothing left in or on F')
	assert.ok(!menuEntries(h.s.selectionInfo(), F, lastMenu(h)).includes('unlock-frame'), 'no unlock-frame on F any more')
	h.s.closeMenu()
	// no frame, no item: nothing
	n = h.tr.calls.length
	assert.equal(h.s.unlockFrame(N2), false, 'no frame id')
	assert.equal(h.s.unlockFrame('unknown'), false, 'not in the model')
	assert.equal(h.s.unlockFrame(null), false)
	assert.deepEqual(await opsAfter(h, n), [])
	h.s.destroy()
	// a frame without a lock in or on it (only O outside is locked): 0, no entry
	const free = await open({ me: ALICE, items: [frame(F, { x: 0, y: 0 }), sticky(N2, { x: 300, y: 30, parent: F }), sticky(O, { x: 1200, y: 0, lock: byCarol })] })
	rightClick(free, F)
	assert.equal(lastMenu(free).unlockFrame, 0)
	assert.ok(!menuEntries(free.s.selectionInfo(), F, lastMenu(free)).includes('unlock-frame'))
	assert.equal(free.s.unlockFrame(F), false)
	free.s.destroy()
	const b = await open({ me: BOB, items })
	n = b.tr.calls.length
	assert.equal(b.s.unlockFrame(F), false, 'BOB, not even with his own lock on F')
	assert.deepEqual(await opsAfter(b, n), [])
	b.s.destroy()
})

test('job 044 AK6: select all still skips locked items for a moderator (ALICE: [A locked, C free] → C), also from the board menu', async () => {
	const h = await open({ me: ALICE, items: [sticky(A, { lock: byCarol }), sticky(C, { x: 800 })] })
	h.s.selectAll()
	assert.deepEqual(h.s.selection, [C])
	h.scene.callbacks.onSelection([])
	rightClick(h, null)
	assert.equal(h.s.menuAction('select-all'), true)
	assert.deepEqual(h.s.selection, [C])
	h.s.destroy()
})

// ---- Job 062: the frame from the board menu, "Unlock all locked by {name}", unlock-none ----

const T = ID('T1')
const CAROL = 'pidcarol00000001'
const unlockNone = ['Nothing left to unlock.', 'unlock-none']
const noneToasts = (h) => h.infos.filter((x) => Array.isArray(x) && x[1] === 'unlock-none')
/** A point inside frame F of ak3Board (x 1200–2000, y 0–600) that no note covers. */
const IN_F = [1600, 300]

test('job 062 AK3: the payload – the board menu inside F counts F (unlockFrame 1), outside 0; on A (Carol) unlockBy 2 named Carol; own, unknown and no lock 0 with no name; BOB always 0', async () => {
	const h = await open({ me: ALICE, items: ak3Board() })
	rightClick(h, null, IN_F)
	assert.equal(lastMenu(h).id, null, 'the board menu')
	assert.deepEqual(h.s.menu.frame, F, 'the frame under W')
	assert.deepEqual([lastMenu(h).unlockAll, lastMenu(h).unlockFrame, lastMenu(h).unlockBy, lastMenu(h).unlockByName], [4, 1, 0, null])
	h.s.closeMenu()
	rightClick(h, null)
	assert.deepEqual([lastMenu(h).unlockAll, lastMenu(h).unlockFrame], [4, 0], '[640, 400] lies outside F')
	assert.equal(h.s.menu.frame, null)
	h.s.closeMenu()
	rightClick(h, A)
	assert.deepEqual([lastMenu(h).unlockBy, lastMenu(h).unlockByName, lastMenu(h).unlockAll], [2, 'Carol', 0], 'A and N1 are Carol\'s')
	assert.deepEqual(h.s.menu.locker, byCarol)
	h.s.closeMenu()
	for (const [id, what] of [[B, 'ALICE\'s own lock'], [D, 'unknown locker'], [C, 'free']]) {
		rightClick(h, id)
		assert.deepEqual([lastMenu(h).unlockBy, lastMenu(h).unlockByName], [0, null], what)
		assert.equal(h.s.menu.locker, null, what)
		h.s.closeMenu()
	}
	assert.deepEqual(h.s.unlockByIds(CAROL), [A, N1], 'model order')
	assert.deepEqual(h.s.unlockByIds(ALICE.pid), [], 'never the own locks')
	assert.deepEqual([h.s.unlockByIds(null), h.s.unlockByIds(''), h.s.unlockByIds(7)], [[], [], []])
	h.s.destroy()
	// a locker with a pid but without a name: no entry (the name is what the entry shows)
	const nameless = await open({ me: ALICE, items: [sticky(A, { lock: { by: CAROL, name: null } }), sticky(C, { x: 800, lock: { by: CAROL, name: '' } })] })
	for (const id of [A, C]) {
		rightClick(nameless, id)
		assert.deepEqual([lastMenu(nameless).unlockBy, lastMenu(nameless).unlockByName], [0, null], id)
		nameless.s.closeMenu()
	}
	assert.deepEqual(nameless.s.unlockByIds(CAROL), [A, C], 'the set still goes by the pid')
	nameless.s.destroy()
	const b = await open({ me: BOB, items: ak3Board() })
	rightClick(b, null, IN_F)
	assert.equal(lastMenu(b).unlockFrame, 0, 'BOB: no frame entry')
	b.s.closeMenu()
	rightClick(b, A)
	assert.deepEqual([lastMenu(b).unlockBy, lastMenu(b).unlockByName], [0, null], 'BOB: no unlock-by')
	assert.deepEqual(b.s.unlockByIds(CAROL), [])
	b.s.destroy()
})

test('job 062 AK4: "Unlock all in this frame" from the board menu inside F – the entries end on unlock-frame, unlock-all; it unlocks F, N1, N3 (not N2, not O outside), one undo step, the toast unlock-all', async () => {
	const items = [
		frame(F, { x: 0, y: 0, lock: byBob }),
		sticky(N1, { x: 20, y: 30, z: 'a1', parent: F, lock: byCarol }),
		sticky(N2, { x: 300, y: 30, z: 'a2', parent: F }),
		sticky(N3, { x: 20, y: 300, z: 'a3', parent: F, lock: unknownLock }),
		sticky(O, { x: 1200, y: 0, z: 'a4', lock: byCarol }),
	]
	const h = await open({ me: ALICE, items })
	rightClick(h, null, [600, 450])
	assert.deepEqual([lastMenu(h).id, lastMenu(h).unlockFrame, lastMenu(h).unlockAll], [null, 3, 4])
	assert.deepEqual(menuEntries(h.s.selectionInfo(), null, lastMenu(h)).slice(-2), ['unlock-frame', 'unlock-all'])
	const n = h.tr.calls.length
	assert.equal(h.s.menuAction('unlock-frame'), true)
	assert.equal(lastMenu(h), null, 'the menu is closed')
	assert.deepEqual(await opsAfter(h, n), unlockOps([F, N1, N3]), 'exactly F, N1 and N3')
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	assert.deepEqual(h.s.undoStack.done[0].inverse, lockOps([F, N1, N3], byAlice))
	assert.deepEqual(h.infos.at(-1), ['3 items unlocked', 'unlock-all'])
	assert.deepEqual([h.model.get(N2).lock ?? null, h.model.get(O).lock], [null, byCarol], 'N2 free, O stays locked')
	h.s.destroy()
})

/**
 * The board of AK5 in model order: frame T locked by ALICE (a template), A
 * by Carol, B by BOB, N1 in T by Carol, D with an unknown locker, C free.
 *
 * @return {object[]} WireItems
 */
const ak5Board = () => [
	frame(T, { x: 1200, y: 0, lock: byAlice }),
	sticky(A, { x: 0, y: 0, z: 'a1', lock: byCarol }),
	sticky(B, { x: 400, y: 0, z: 'a2', lock: byBob }),
	sticky(N1, { x: 20, y: 30, z: 'a3', parent: T, lock: byCarol }),
	sticky(D, { x: 0, y: 400, z: 'a4', lock: unknownLock }),
	sticky(C, { x: 800, y: 0, z: 'a5' }),
]

test('job 062 AK5: "Unlock all locked by Carol" on A as ALICE – {lock: null} for A and N1 only (not T, B, D, C), one undo step, the toast unlock-all, the selection stays; undo locks in ALICE\'s name, redo unlocks, neither toasts', async () => {
	const h = await open({ me: ALICE, items: ak5Board() })
	rightClick(h, A)
	assert.deepEqual([lastMenu(h).unlockBy, lastMenu(h).unlockByName], [2, 'Carol'])
	assert.deepEqual(menuEntries(h.s.selectionInfo(), A, lastMenu(h)), ['copy', 'unlock', 'unlock-by', 'zoom-selection'])
	const focus = h.scene.callsOf('focusCanvas').length
	let n = h.tr.calls.length
	assert.equal(h.s.menuAction('unlock-by'), true)
	assert.equal(lastMenu(h), null, 'the menu is closed')
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus back')
	assert.deepEqual(await opsAfter(h, n), unlockOps([A, N1]), 'A and N1, in model order, nothing else')
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	assert.deepEqual(h.s.undoStack.done[0].inverse, lockOps([A, N1], byAlice))
	assert.deepEqual(h.infos.at(-1), ['2 items unlocked', 'unlock-all'])
	assert.deepEqual([h.model.get(T).lock, h.model.get(B).lock, h.model.get(D).lock], [byAlice, byBob, unknownLock], 'the template, BOB\'s and the unknown lock stay')
	assert.deepEqual(h.s.selection, [A], 'the selection stays')
	n = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await opsAfter(h, n), lockOps([A, N1], byAlice), 'undo: locked again in ALICE\'s name')
	n = h.tr.calls.length
	h.s.redo()
	assert.deepEqual(await opsAfter(h, n), unlockOps([A, N1]), 'redo: unlocked again')
	assert.equal(unlockToasts(h).length, 1, 'undo and redo show no toast unlock-all')
	h.s.destroy()
})

test('job 062 AK5: the person of the opening counts – A unlocked meanwhile, the entry still lifts Carol\'s N1; BOB gets nothing; ALICE\'s own pid, null and \'\' send nothing', async () => {
	const h = await open({ me: ALICE, items: ak5Board() })
	rightClick(h, A)
	assert.equal(lastMenu(h).unlockBy, 2)
	serverLocks(h, { [A]: null })
	assert.notEqual(h.s.menu, null, 'a lock change keeps the menu open')
	const n = h.tr.calls.length
	assert.equal(h.s.menuAction('unlock-by'), true)
	assert.deepEqual(await opsAfter(h, n), unlockOps([N1]), 'only N1 is left of Carol\'s')
	assert.deepEqual(h.infos.at(-1), ['1 item unlocked', 'unlock-all'])
	h.s.destroy()
	const b = await open({ me: BOB, items: ak5Board() })
	let m = b.tr.calls.length
	assert.equal(b.s.unlockBy(CAROL), false)
	assert.deepEqual(await opsAfter(b, m), [], 'nothing sent')
	assert.deepEqual(b.infos, [], 'no toast')
	assert.equal(b.s.undoStack.done.length, 0)
	b.s.destroy()
	const a = await open({ me: ALICE, items: ak5Board() })
	m = a.tr.calls.length
	for (const pid of [ALICE.pid, null, '']) {
		assert.equal(a.s.unlockBy(pid), false, String(pid))
	}
	assert.deepEqual(await opsAfter(a, m), [], 'nothing sent')
	assert.deepEqual(unlockToasts(a), [])
	assert.equal(a.s.undoStack.done.length, 0)
	assert.deepEqual(a.model.get(T).lock, byAlice, 'the template stays locked')
	a.s.destroy()
})

test('job 062 AK6: a stale menu (every counted lock lifted by someone else) → unlock-all, unlock-frame (board menu in F) and unlock-by each toast unlock-none; nothing sent, no undo step, no toast unlock-all', async () => {
	const cases = [
		['unlock-all', (h) => rightClick(h, null), 'unlockAll', [A, B, D, N1]],
		['unlock-frame', (h) => rightClick(h, null, IN_F), 'unlockFrame', [N1]],
		['unlock-by', (h) => rightClick(h, A), 'unlockBy', [A, N1]],
	]
	for (const [entry, openIt, key, ids] of cases) {
		const h = await open({ me: ALICE, items: ak3Board() })
		openIt(h)
		assert.ok(lastMenu(h)[key] > 0, entry + ': counted something')
		serverLocks(h, Object.fromEntries(ids.map((id) => [id, null])))
		const n = h.tr.calls.length
		assert.equal(h.s.menuAction(entry), true, entry + ': the entry ran')
		assert.deepEqual(await opsAfter(h, n), [], entry + ': nothing sent')
		assert.equal(h.s.undoStack.done.length, 0, entry + ': no undo step')
		assert.deepEqual(h.infos.at(-1), unlockNone, entry)
		assert.deepEqual(unlockToasts(h), [], entry + ': no unlock-all')
		h.s.destroy()
	}
})

test('job 062 AK6: no unlock-none for BOB, in mode view, after revoked or with mod taken away; an exception gives only the toast of actionFailed', async () => {
	const all = (h) => [h.s.unlockAll(), h.s.unlockFrame(F), h.s.unlockBy(CAROL)]
	const b = await open({ me: BOB, items: ak3Board() })
	assert.deepEqual(all(b), [false, false, false])
	assert.deepEqual(b.infos, [], 'BOB: no toast at all')
	b.s.destroy()
	const v = await open({ me: ALICE, items: ak3Board(), viewOnly: true })
	assert.deepEqual(all(v), [false, false, false])
	assert.deepEqual(noneToasts(v), [], 'mode view')
	v.s.destroy()
	const r = await open({ me: ALICE, items: ak3Board() })
	r.s.onStatus('revoked')
	assert.deepEqual(all(r), [false, false, false])
	assert.deepEqual(noneToasts(r), [], 'revoked')
	r.s.destroy()
	const demoted = await open({ me: MOD, items: ak3Board({ by: MOD.pid, name: MOD.name }) })
	assert.equal(demoted.s.applyRole('edit', false), true)
	assert.deepEqual(all(demoted), [false, false, false])
	assert.deepEqual(noneToasts(demoted), [], 'mod taken away')
	demoted.s.destroy()
	// commit throws: guard toasts actionFailed, nothing else
	const x = await open({ me: ALICE, items: ak3Board() })
	x.s.commit = () => {
		throw new Error('boom')
	}
	const error = console.error
	console.error = () => {}
	try {
		assert.equal(x.s.unlockAll(), false)
	} finally {
		console.error = error
	}
	assert.deepEqual(x.toasts, ['This change could not be applied.'], 'exactly the toast of actionFailed')
	assert.deepEqual(noneToasts(x), [], 'no unlock-none')
	assert.deepEqual(unlockToasts(x), [], 'no unlock-all')
	x.s.destroy()
})

test('job 062 AK7: lockSelection, unlockSelection and the mass unlocks share lockStep (one entry check); lockStep counts the ops, null without the right to write', async () => {
	const h = await open({ me: ALICE, items: ak3Board() })
	select(h, [C])
	assert.equal(h.s.lockStep((ids) => ({ ops: [], inverse: [] })), 0, 'nothing to do: 0')
	assert.equal(h.s.lockStep(() => ({ ops: [], inverse: [] }), () => [A]), 0)
	let seen = null
	assert.equal(h.s.lockStep((ids) => {
		seen = ids
		return { ops: [], inverse: [] }
	}, () => [A, N1]), 0)
	assert.deepEqual(seen, [A, N1], 'the given ids instead of the selection')
	assert.equal(h.s.lockSelection(), true, 'lockSelection still answers a boolean')
	assert.equal(h.s.unlockSelection(), true)
	h.s.onStatus('revoked')
	assert.equal(h.s.lockStep(() => ({ ops: [{ o: 'patch', id: C, p: { lock: null } }], inverse: [] })), null, 'frozen: null')
	assert.equal(h.s.lockSelection(), false)
	h.s.destroy()
})

test('job 086 AK3: unlockByIds(pid) is unlockAllIds() filtered by lock.by – on ak3Board and with F locked by Carol as well, for Carol, ALICE\'s own pid, BOB, null, \'\' and 7; BOB (no mod) gets []', async () => {
	const withF = ak3Board().map((it) => (it.id === F ? frame(F, { x: 1200, y: 0, lock: byCarol }) : it))
	for (const [items, carols] of [[ak3Board(), [A, N1]], [withF, [A, F, N1]]]) {
		const h = await open({ me: ALICE, items })
		for (const pid of [CAROL, ALICE.pid, BOB.pid, null, '', 7]) {
			const want = typeof pid === 'string' && pid !== '' && pid !== ALICE.pid ? h.s.unlockAllIds().filter((id) => h.model.get(id).lock.by === pid) : []
			assert.deepEqual(h.s.unlockByIds(pid), want, String(pid))
		}
		assert.deepEqual(h.s.unlockByIds(CAROL), carols, 'Carol\'s locks in model order')
		h.s.destroy()
	}
	const b = await open({ me: BOB, items: withF })
	assert.deepEqual(b.s.unlockByIds(CAROL), [], 'BOB does not moderate')
	b.s.destroy()
})
