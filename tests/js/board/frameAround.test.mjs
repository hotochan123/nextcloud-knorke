/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Frame around" (factory job 278): model/groups.js frameAroundPlan,
 * board/actions.js frameAround (box with 40 margin, parent null, z, the
 * movers, the rule of a frame drawn by hand for the rest, blocks), the
 * entries of the bar's "…" and the context menu, and BoardSession
 * frameAroundSelection (one step, title editor, toast, undo).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameAround } from '../../../src/board/actions.js'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { MENU_ITEMS, menuBlocked, menuEntries, menuLabel, menuShortcut, moreGroups } from '../../../src/components/contextbar.js'
import { FRAME_AROUND_MARGIN, frameAroundPlan } from '../../../src/model/groups.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, connector, frame, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const D = ID(4)
const E = ID(5)
const L = ID(6)
const M1 = ID(7)
const M2 = ID(8)
const F = ID('F1')
const H = ID('H1')
const K = ID('K1')
const G = '01JG0000000000000000000001'
const NEW = '01JN0000000000000000000099'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const PARENT_HINT = 'Only items in the same frame, or all outside frames, can be framed.'
const LOCK_HINT = 'Locked items cannot be framed.'

test('AK1 two notes outside frames: one frame put (union ± 40, parent null, above every frame), a patch per note with its place in N; the inverse puts all back', () => {
	assert.equal(FRAME_AROUND_MARGIN, 40)
	const m = new FakeModel([frame(F, { x: 2000, z: 'i3' }), sticky(A, { z: 'i1' }), sticky(B, { x: 300, z: 'i2' })])
	const r = frameAround(m, [A, B], () => NEW)
	assert.equal(r.blocked, null)
	assert.deepEqual(r.selectIds, [NEW])
	assert.equal(r.edit, true)
	const put = r.ops[0]
	assert.equal(put.o, 'put')
	assert.equal(put.t, 'frame')
	assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h, put.p.parent], [-40, -40, 580, 280, null])
	assert.equal(put.p.data.title, '')
	assert.ok(put.p.z > 'i3', 'above every frame')
	assert.deepEqual(r.ops.slice(1), [
		{ o: 'patch', id: A, p: { x: 40, y: 40, parent: NEW } },
		{ o: 'patch', id: B, p: { x: 340, y: 40, parent: NEW } },
	])
	assert.deepEqual(r.inverse, [
		{ o: 'patch', id: A, p: { x: 0, y: 0, parent: null } },
		{ o: 'patch', id: B, p: { x: 300, y: 0, parent: null } },
		{ o: 'remove', id: NEW },
	])
})

test('AK2 one note is enough; one member of a group brings the whole group', () => {
	let m = new FakeModel([sticky(A, { x: 100, y: 50 })])
	let r = frameAround(m, [A], () => NEW)
	assert.deepEqual([r.ops[0].p.x, r.ops[0].p.y, r.ops[0].p.w, r.ops[0].p.h], [60, 10, 280, 280])
	assert.deepEqual(r.ops.slice(1), [{ o: 'patch', id: A, p: { x: 40, y: 40, parent: NEW } }])
	m = new FakeModel([sticky(A, { z: 'i1', group: G }), sticky(B, { x: 300, z: 'i2', group: G }), sticky(C, { x: 900, z: 'i3' })])
	r = frameAround(m, [A], () => NEW)
	assert.deepEqual(r.ops[0].p.w, 580, 'the box holds B too')
	assert.deepEqual(r.ops.slice(1).map((o) => o.id).sort(), [A, B].sort())
})

test('AK3 every item in frame F: not blocked, the items leave F for N, N lies above F, unselected children of F stay in F', () => {
	const m = new FakeModel([
		frame(F, { x: 1000, y: 0, w: 1400, h: 800, z: 'i5' }),
		sticky(C, { x: 100, y: 100, parent: F, z: 'i1' }), sticky(D, { x: 400, y: 100, parent: F, z: 'i2' }),
		sticky(E, { x: 150, y: 150, w: 50, h: 50, parent: F, z: 'i3' }),
	])
	const r = frameAround(m, [C, D], () => NEW)
	assert.equal(r.blocked, null)
	const put = r.ops[0]
	assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h, put.p.parent], [1060, 60, 580, 280, null])
	assert.ok(put.p.z > 'i5', 'above F, so it shows')
	assert.deepEqual(r.ops.slice(1), [
		{ o: 'patch', id: C, p: { x: 40, y: 40, parent: NEW } },
		{ o: 'patch', id: D, p: { x: 340, y: 40, parent: NEW } },
	])
	assert.deepEqual(r.inverse.slice(0, 2), [
		{ o: 'patch', id: C, p: { x: 100, y: 100, parent: F } },
		{ o: 'patch', id: D, p: { x: 400, y: 100, parent: F } },
	])
	assert.ok(!r.ops.some((o) => o.id === E), 'E (not selected, in F) keeps F, as with a frame drawn by hand')
})

test('AK4 items of two frames, or inside and outside: blocked parent, no ops; a selected frame with its own children is not mixed', () => {
	const m = new FakeModel([
		frame(F, { x: 1000, z: 'a1' }), frame(H, { x: 3000, z: 'a2' }),
		sticky(A, { z: 'i1' }), sticky(C, { x: 100, y: 100, parent: F, z: 'i2' }), sticky(D, { x: 100, y: 100, parent: H, z: 'i3' }),
	])
	for (const sel of [[C, D], [A, C]]) {
		const r = frameAround(m, sel, () => NEW)
		assert.equal(r.blocked, 'parent')
		assert.deepEqual([r.ops, r.inverse], [[], []])
	}
	assert.equal(frameAroundPlan(m, [F, C]).blocked, null, 'F with its child C')
	assert.equal(frameAroundPlan(m, [F, A]).blocked, null, 'a frame counts as outside frames')
	// round 1 (own code review): a selected frame plus an item of ANOTHER frame is mixed
	assert.equal(frameAroundPlan(m, [H, C]).blocked, 'parent', 'H (outside) and C (in F)')
	assert.deepEqual(frameAround(m, [H, C], () => NEW).ops, [])
	assert.equal(frameAroundPlan(m, [H, D, A]).blocked, null, 'H, its own child D and A outside')
	const r = frameAround(m, [F, C], () => NEW)
	assert.ok(!r.ops.some((o) => o.id === C || o.id === F), 'C stays in F, F keeps parent null')
})

test('AK5 a selected frame: N goes right below the lowest selected frame (above the frame below it); the frames keep their children', () => {
	const m = new FakeModel([
		frame(H, { x: -5000, z: 'i2' }), frame(D, { x: 4000, z: 'i5' }), frame(F, { x: 0, z: 'i8' }), frame(E, { x: 1000, z: 'iz' }),
		sticky(C, { x: 100, y: 100, parent: F, z: 'i1' }),
	])
	const r = frameAround(m, [E, F], () => NEW)
	assert.equal(r.blocked, null)
	const z = r.ops[0].p.z
	assert.ok(z > 'i5' && z < 'i8', 'between D and F: ' + z)
	assert.deepEqual([r.ops[0].p.x, r.ops[0].p.y, r.ops[0].p.w, r.ops[0].p.h], [-40, -40, 1880, 680])
	assert.equal(r.ops.length, 1, 'no patch: frames do not lie in frames, C stays in F')
	// the lowest frame of the board: z below it
	const m2 = new FakeModel([frame(F, { z: 'i8' })])
	const z2 = frameAround(m2, [F], () => NEW).ops[0].p.z
	assert.ok(z2 < 'i8')
})

test('AK6 unselected items in the area follow the rule of a frame drawn by hand: completely inside joins, partly inside stays, a group only as a whole, a locked one stays', () => {
	const m = new FakeModel([
		sticky(A, { z: 'i1' }),
		sticky(B, { x: 10, y: 10, w: 50, h: 50, z: 'i2' }),
		sticky(E, { x: 150, y: 150, z: 'i3' }),
		sticky(L, { x: 20, y: 120, w: 30, h: 30, z: 'i4', lock: LOCK }),
		sticky(M1, { x: 100, y: 10, w: 40, h: 40, z: 'i5', group: G }), sticky(M2, { x: 2000, z: 'i6', group: G }),
	])
	const r = frameAround(m, [A], () => NEW)
	assert.equal(r.blocked, null)
	assert.deepEqual(r.ops.slice(1).map((o) => o.id).sort(), [A, B].sort())
	assert.equal(r.inverse.length, 3)
	assert.deepEqual(r.inverse.at(-1), { o: 'remove', id: NEW })
	// a group lying completely inside joins whole, but not with a locked member
	const m2 = new FakeModel([
		sticky(A, { w: 400, h: 400, z: 'i1' }),
		sticky(M1, { x: 10, y: 10, w: 40, h: 40, z: 'i5', group: G }), sticky(M2, { x: 100, y: 10, w: 40, h: 40, z: 'i6', group: G }),
	])
	assert.deepEqual(frameAround(m2, [A], () => NEW).ops.slice(1).map((o) => o.id).sort(), [A, M1, M2].sort())
	m2.get(M2).lock = LOCK
	assert.deepEqual(frameAround(m2, [A], () => NEW).ops.slice(1).map((o) => o.id), [A])
})

test('AK7 a selected locked item blocks (locked) before a mixed parent; a selected connector only widens nothing and is never patched', () => {
	const m = new FakeModel([
		frame(F, { x: 1000, z: 'a1' }), sticky(A, { z: 'i1', lock: LOCK }), sticky(B, { x: 300, z: 'i2' }), sticky(C, { x: 100, y: 100, parent: F, z: 'i3' }),
		connector(K, { item: B }, { item: A }),
	])
	assert.equal(frameAround(m, [A, B], () => NEW).blocked, 'locked')
	assert.equal(frameAround(m, [A, C], () => NEW).blocked, 'locked', 'locked wins')
	const r = frameAround(m, [B, K], () => NEW)
	assert.equal(r.blocked, null)
	assert.ok(!r.ops.some((o) => o.id === K))
})

test('Risiko: a rotated note lies completely inside (its rotated hull), on the real SceneModel; a box beyond the frame\'s largest size offers nothing', () => {
	const m = new SceneModel()
	m.load([{ id: A, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 45, z: 'i1', parent: null, data: { text: '' }, style: {} }])
	const r = frameAround(m, [A], () => NEW)
	const half = 100 * Math.SQRT2
	const p = r.ops[0].p
	assert.ok(Math.abs(p.x - (100 - half - 40)) < 0.02, String(p.x))
	assert.ok(Math.abs(p.w - (2 * half + 80)) < 0.02, String(p.w))
	assert.deepEqual(r.ops[1].p.parent, NEW)
	const far = new FakeModel([sticky(A), sticky(B, { x: 99950 })])
	assert.equal(frameAroundPlan(far, [A, B]).box, null)
	assert.deepEqual(frameAround(far, [A, B], () => NEW), { ops: [], inverse: [], selectIds: [], edit: false, blocked: null })
})

test('AK8 the entry: after group and ungroup in "…" and in the menu while frameable, greyed with its hint, label "Frame around", no shortcut', () => {
	assert.ok(MENU_ITEMS.indexOf('frame-around') === MENU_ITEMS.indexOf('ungroup') + 1)
	const base = { count: 2, ids: [A, B], types: new Set(['sticky']), unlocked: 2, locked: 0 }
	assert.ok(!moreGroups({ ...base, frameable: false }).flat().includes('frame-around'))
	const sel = { ...base, frameable: true, frameBlock: null }
	assert.ok(moreGroups(sel).some((g) => g.at(-1) === 'frame-around'))
	assert.ok(menuEntries(sel, A).includes('frame-around'))
	assert.equal(menuBlocked('frame-around', sel), null)
	assert.equal(menuBlocked('frame-around', { ...sel, frameBlock: 'parent' }), PARENT_HINT)
	assert.equal(menuBlocked('frame-around', { ...sel, frameBlock: 'locked' }), LOCK_HINT)
	assert.equal(menuLabel('frame-around', sel), 'Frame around')
	assert.equal(menuShortcut('frame-around', true), null)
	assert.equal(menuShortcut('frame-around', false), null)
})

// ---- AK9: the session ----------------------------------------------------------

const T0 = 1760100000000
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }

async function open(items) {
	const clock = new FakeClock(10000)
	const ui = { selection: [], undo: [] }
	const infos = []
	let rev = 5
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: 'edit', metaRev: 3, meta: {} }, me: BOB, items }
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
		ui: { onSelection: (x) => ui.selection.push(x), onUndoState: (x) => ui.undo.push(x) },
		deps: {
			SceneModel: FakeModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, infos, scene: s.scene, model: s.model }
}

const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const select = (h, ids) => h.scene.callbacks.onSelection(ids)

test('AK9 frameAroundSelection: one undo step, the frame selected alone with its title editor open; undo removes it and gives every item its old parent', async () => {
	const h = await open([
		frame(F, { x: 1000, y: 0, w: 1400, h: 800, z: 'i5' }),
		sticky(C, { x: 100, y: 100, parent: F, z: 'i1' }), sticky(D, { x: 400, y: 100, parent: F, z: 'i2' }),
	])
	select(h, [C, D])
	let sel = h.ui.selection.at(-1)
	assert.deepEqual([sel.frameable, sel.frameBlock], [true, null])
	const n = h.tr.calls.length
	assert.equal(h.s.frameAroundSelection(), 'sent')
	assert.equal(h.s.undoStack.done.length, 1)
	assert.equal(h.s.selection.length, 1)
	const N = h.s.selection[0]
	assert.equal(h.model.get(N).t, 'frame')
	assert.deepEqual([h.model.get(C).parent, h.model.get(D).parent], [N, N])
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(0, 2), ['openTextEditor', N])
	assert.equal(h.scene.callsOf('revealTitle').at(-1)[1], N)
	assert.deepEqual(h.s.newEdit, { id: N, key: 'new:' + N })
	const ops = await opsAfter(h, n)
	assert.deepEqual(ops.map((o) => [o.o, o.id]), [['put', N], ['patch', C], ['patch', D]], 'one batch')
	h.s.onChanges([structuredClone(h.model.get(N)), structuredClone(h.model.get(C)), structuredClone(h.model.get(D))], [])
	h.s.newEdit = null
	h.s.undo()
	assert.equal(h.model.has(N), false)
	assert.deepEqual([h.model.get(C).parent, h.model.get(D).parent], [F, F])
	// the menu entry runs the same action and keeps the focus in the title editor (true)
	select(h, [C])
	h.s.onIntent({ type: 'contextMenu', id: C, at: [1, 1] })
	assert.equal(h.s.menuAction('frame-around'), true)
	assert.equal(h.model.get(C).parent === F, false)
	h.s.destroy()
})

test('AK9 blocked: the toast frame-blocked with the hint, nothing sent, no undo step; nothing in view-only or frozen', async () => {
	const h = await open([frame(F, { x: 1000, z: 'a1' }), sticky(A, { z: 'i1' }), sticky(C, { x: 100, y: 100, parent: F, z: 'i2' }), sticky(B, { x: 300, z: 'i3', lock: LOCK })])
	select(h, [A, C])
	assert.deepEqual([h.ui.selection.at(-1).frameable, h.ui.selection.at(-1).frameBlock], [true, 'parent'])
	const n = h.tr.calls.length
	assert.equal(h.s.frameAroundSelection(), 'blocked')
	assert.deepEqual(h.infos.at(-1), [PARENT_HINT, 'frame-blocked'])
	select(h, [B])
	assert.equal(h.s.frameAroundSelection(), 'blocked')
	assert.deepEqual(h.infos.at(-1), [LOCK_HINT, 'frame-blocked'])
	assert.deepEqual(await opsAfter(h, n), [])
	assert.equal(h.s.undoStack.canUndo(), false)
	h.s.onStatus('revoked')
	select(h, [A])
	assert.equal(h.s.frameAroundSelection(), 'none', 'frozen')
	assert.deepEqual([h.s.selectionInfo().frameable, h.s.selectionInfo().frameBlock], [false, null])
	h.s.destroy()
})
