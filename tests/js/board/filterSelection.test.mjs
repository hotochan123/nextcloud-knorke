/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Filter the selection in the session (factory job 144, AK1 and AK2):
 * selection v2 kinds over the whole selection (locked items too, [] while
 * not filterable or while the session cannot write), and
 * filterSelection(kind): only the selection changes (ui.onSelection, the
 * scene's selection), no op, no undo step, no toast, groups and locks stay;
 * an empty entry or one that is the whole selection changes nothing;
 * nothing outside mode edit or while frozen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, connector, memoryStorage, shape, sticky } from './fakes.mjs'

const [N1, N2, N3, N4, N5, S1, S2, K, X] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ID(n))
const [H1, H2, I1, I2] = [11, 12, 13, 14].map((n) => ID(n))
const G = '01JG0000000000000000000001'
const H = '01JG0000000000000000000002'
const I = '01JG0000000000000000000003'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const T0 = 1760100000000
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }

/** The test selection F of the spec: N1, N2 loose; G = {N3, N4, S1}; S2; K; N5 locked; X of an unknown type. */
const F = [N1, N2, N3, N4, S1, S2, K, N5, X]

/** @return {object[]} the items of F plus two note groups H = {H1, H2} and I = {I1, I2} */
function items() {
	return [
		sticky(N1, { z: 'a1' }), sticky(N2, { x: 300, z: 'a2' }), sticky(N3, { x: 600, z: 'a3', group: G }), sticky(N4, { x: 900, z: 'a4', group: G }),
		shape(S1, { x: 1200, z: 'a5', group: G }), shape(S2, { x: 1500, z: 'a6' }), connector(K, { item: N1 }, { item: S2 }, { z: 'a7' }),
		sticky(N5, { y: 400, z: 'a8', lock: LOCK }), { id: X, t: 'widget', x: 0, y: 800, w: 100, h: 100, r: 0, z: 'a9', parent: null, data: {}, style: {} },
		sticky(H1, { y: 1200, z: 'b1', group: H }), sticky(H2, { x: 300, y: 1200, z: 'b2', group: H }),
		sticky(I1, { y: 1600, z: 'b3', group: I }), sticky(I2, { x: 300, y: 1600, z: 'b4', group: I }),
	]
}

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness (as in groups.test.mjs)
 */
async function open({ viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	const ui = { selection: [], undo: [] }
	const toasts = []
	const infos = []
	let rev = 5
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: BOB.role, metaRev: 3, meta: {} }, me: BOB, items: items() }
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
			toast: (m, o) => toasts.push(o?.hook ? [m, o.hook] : m),
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model }
}

const select = (h, ids) => h.scene.callbacks.onSelection(ids)
const lastSel = (h) => h.ui.selection.at(-1)
const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
/** group and lock of every model item */
const marks = (h) => [...h.model.ids()].map((id) => [id, h.model.get(id).group ?? null, h.model.get(id).lock ?? null])

test('job 144 AK1: selectionInfo().kinds of F – sticky 5, shape 2, connector 1, group 1, locked N5 counted; [] for empty, one item, only notes, one note group, two whole note groups, N1 with only N3', async () => {
	const h = await open()
	select(h, F)
	assert.deepEqual(h.s.selectionInfo().kinds, [{ kind: 'sticky', count: 5 }, { kind: 'shape', count: 2 }, { kind: 'connector', count: 1 }, { kind: 'group', count: 1 }])
	assert.deepEqual(lastSel(h).kinds, h.s.selectionInfo().kinds, 'the bar hears it with the selection')
	for (const [name, ids] of [['empty', []], ['one item', [S2]], ['only notes', [N1, N2, N5]], ['one note group', [H1, H2]], ['two whole note groups', [H1, H2, I1, I2]], ['N1 with only N3', [N1, N3]]]) {
		select(h, ids)
		assert.deepEqual(h.s.selectionInfo().kinds, [], name)
	}
	// frozen: the session cannot write, nothing to filter
	select(h, F)
	h.s.onStatus('revoked')
	assert.deepEqual(h.s.selectionInfo().kinds, [])
	h.s.destroy()
})

test('job 144 AK2: filterSelection on F – sticky → [N1, N2, N3, N4, N5], group → [N3, N4, S1], connector → [K]; frame changes nothing; no op, no undo step, no toast; groups and locks stay; ui.onSelection reports the new selection', async () => {
	const h = await open()
	const before = marks(h)
	const n = h.tr.calls.length
	for (const [kind, want] of [['sticky', [N1, N2, N3, N4, N5]], ['group', [N3, N4, S1]], ['connector', [K]]]) {
		select(h, F)
		const reports = h.ui.selection.length
		assert.equal(h.s.filterSelection(kind), true, kind)
		assert.deepEqual(h.s.selection, want, kind)
		assert.deepEqual(h.scene.selection, want, kind + ': the scene shows it')
		assert.equal(h.ui.selection.length, reports + 1, kind + ': one report')
		assert.deepEqual(lastSel(h).ids, want, kind)
		assert.equal(lastSel(h).count, want.length)
	}
	assert.deepEqual(lastSel(h).kinds, [], 'a single connector: no filter any more')
	select(h, F)
	const reports = h.ui.selection.length
	assert.equal(h.s.filterSelection('frame'), false, 'no frame in F')
	assert.equal(h.s.filterSelection('text'), false)
	assert.equal(h.s.filterSelection('nonsense'), false)
	assert.deepEqual(h.s.selection, F, 'unchanged')
	assert.equal(h.ui.selection.length, reports, 'no report')
	assert.deepEqual(await opsAfter(h, n), [], 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.deepEqual([h.toasts, h.infos], [[], []], 'no toast')
	assert.deepEqual(marks(h), before, 'group and lock of every item stay')
	h.s.destroy()
})

test('job 144 AK2: an entry that is the whole selection changes nothing (one note group: "Only notes"); nothing in view mode or while frozen', async () => {
	const h = await open()
	select(h, [H1, H2])
	const reports = h.ui.selection.length
	assert.equal(h.s.filterSelection('sticky'), false)
	assert.equal(h.s.filterSelection('group'), false)
	assert.deepEqual(h.s.selection, [H1, H2])
	assert.equal(h.ui.selection.length, reports)
	select(h, F)
	h.s.onStatus('revoked')
	assert.equal(h.s.filterSelection('sticky'), false, 'frozen')
	assert.deepEqual(h.s.selection, F)
	h.s.destroy()
	const v = await open({ viewOnly: true })
	assert.equal(v.s.uiMode(), 'view')
	select(v, F)
	assert.equal(v.s.filterSelection('sticky'), false, 'mode view')
	assert.deepEqual(v.s.selection, F)
	v.s.destroy()
})
