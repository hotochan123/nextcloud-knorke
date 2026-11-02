/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 199 (AK3): swimlanes in the session (BoardSession with the
 * fake scene and an LWW server that checks data.lanes like Lanes::check):
 * - the create intent with lanes: by a click 1200 × 600 with three lanes
 *   "Lane 1" to "Lane 3", by a drag at least 220 × 180 and the note inside
 *   adopted; one undo step; the title editor opens
 * - laneAdd ("+"), laneHeight and the menu entries rename, above, below, up,
 *   down and delete on the lane of the menu: the paths, the moved children
 *   (a group as one), one undo step each, undo back to the old state; a
 *   new lane opens the editor of its name
 * - a lane name goes out once, at the final text; me.e never names a lane
 * - a locked frame, a locked child in the way, view, vote and a frozen board
 *   send nothing; the three infos come without an op
 * - duplicate and copy / paste of a frame with lanes give the same lanes
 * - the transformer: a frame's bottom edge changes the last lane, its top
 *   edge the first (actions.transformItems)
 *
 * Factory job 208 (AK3): the columns in the session: column-add (the first
 * column), colAdd ("+"), column-left, column-right, colWidth, colMove and
 * laneMove (dragged heads), column-move-left and -right, column-delete
 * (a middle, the first and the last column), column-rename with its final
 * text: the paths, the moved children (a group as one), one undo step each
 * and undo back; widths that do not add up are all written; the limits and
 * the modes without editing send nothing; duplicate keeps the columns; the
 * transformer's left and right edges change the first and last column.
 *
 * Factory job 225 (AK3): the groups in the session: lane-group and
 * column-group from the menu (the map, the wider or higher frame, every
 * child along, the editor of the group's name; its final text), the menu's
 * group flags, laneGroupSpan and laneGroupMove (dragged edge and cell),
 * lane-ungroup back to the frame before, a lane inserted beside a group
 * lane in it; a locked frame or child, view, vote and frozen send nothing;
 * duplicate keeps the groups.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import * as actions from '../../../src/board/actions.js'
import { checkCols, checkLanes, colBands, laneBands, orderedCols, orderedLanes } from '../../../src/model/lanes.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, RoutedModel, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const F = ID('F1')
const L1 = 'l00000001'
const L2 = 'l00000002'
const L3 = 'l00000003'
const G = '01JA0000000000000000000G01'

/** A stored frame 1200 × 600 at (0, 0) with three lanes of 200. */
function frame(extra = {}) {
	return {
		id: F, t: 'frame', x: 0, y: 0, w: 1200, h: 600, r: 0, z: 'a0', parent: null,
		data: { title: 'Prozess', lanes: { [L1]: { o: 'i0', h: 200, t: 'Sales' }, [L2]: { o: 'i1', h: 200, t: 'Support' }, [L3]: { o: 'i2', h: 200 } } },
		style: { fill: '#ffffff' }, group: null, lock: null, ...extra,
	}
}

/** A note child of the frame at relative (x, y). */
function note(n, x, y, extra = {}) {
	return { id: ID('N' + n), t: 'sticky', x, y, w: 100, h: 100, r: 0, z: 'i' + n, parent: F, data: { text: String(n) }, style: {}, group: null, lock: null, ...extra }
}

/** LWW server: applies like §4.6, data.lanes checked like Lanes::check (job 208: data.cols like checkCols; job 225: with their groups), and answers with every item changed since the cursor. */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) return 'dup'
			if (srv.dead.has(op.id) && op.revive !== true) return 'gone'
			const it = itemFromPut(op)
			if (it.t === 'frame' && it.data?.lanes !== undefined && !checkLanes(it.data.lanes, it.data.lgroups)) return 'bad'
			if (it.t === 'frame' && it.data?.cols !== undefined && !checkCols(it.data.cols, it.data.cgroups)) return 'bad'
			srv.live.set(op.id, it)
			srv.dead.delete(op.id)
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) return 'gone'
			if (Object.keys(op.p).length > 50) return 'bad'
			const next = structuredClone(it)
			applyPatch(next, structuredClone(op.p))
			if (next.t === 'frame' && next.data?.lanes !== undefined && !checkLanes(next.data.lanes, next.data.lgroups)) return 'bad'
			if (next.t === 'frame' && next.data?.cols !== undefined && !checkCols(next.data.cols, next.data.cgroups)) return 'bad'
			srv.live.set(op.id, next)
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) return 'gone'
			srv.live.delete(op.id)
			srv.dead.add(op.id)
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
		return { items: [...ids].filter((id) => srv.live.has(id)).map((id) => structuredClone(srv.live.get(id))), removed: [...ids].filter((id) => !srv.live.has(id)) }
	}
	return srv
}

async function open({ items = [frame()], me = ALICE } = {}) {
	const clock = new FakeClock(10000)
	const infos = []
	const menus = []
	const srv = lwwServer(items)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta: {} }, me, items: [...srv.live.values()].map((it) => structuredClone(it)) }
		},
		async sync(body) {
			tr.calls.push(structuredClone(body))
			const res = body.ops ? srv.apply(body.ops) : null
			const out = { rev: srv.rev, ...srv.since(body.since), presence: {} }
			if (res) out.acks = { seq: body.seq, rev: srv.rev, res }
			return out
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: { onContextMenu: (m) => menus.push(m) },
		deps: {
			SceneModel: RoutedModel,
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
	return { s, clock, tr, srv, infos, menus, scene: s.scene, model: s.model }
}

const cb = (h) => h.scene.callbacks
const live = (h, id = F) => h.srv.live.get(id)
async function opsAfter(h, n) {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const keysOf = (it) => orderedLanes(it.data.lanes).map((l) => l.key)

test('AK3: create by a click: 1200 × 600 with "Lane 1" to "Lane 3" of 200; one undo step; selected, the title editor opens', async () => {
	const h = await open({ items: [] })
	cb(h).onIntent({ type: 'create', t: 'frame', at: { x: 600, y: 400 }, rect: null, lanes: true })
	const ops = await opsAfter(h, 0)
	assert.equal(ops.length, 1)
	const put = ops[0]
	assert.equal(put.t, 'frame')
	assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h], [0, 100, 1200, 600], 'centred on the point')
	assert.ok(checkLanes(put.p.data.lanes))
	assert.deepEqual(orderedLanes(put.p.data.lanes).map((l) => [l.h, l.t]), [[200, 'Lane 1'], [200, 'Lane 2'], [200, 'Lane 3']])
	assert.equal(h.s.undoStack.done.length, 1)
	assert.deepEqual(h.s.selection, [put.id])
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', put.id, {}], 'the frame\'s title editor')
	// without lanes: a plain frame as before
	cb(h).onIntent({ type: 'create', t: 'frame', at: { x: 3000, y: 400 }, rect: null })
	const plain = (await opsAfter(h, 0)).at(-1)
	assert.equal(plain.p.data.lanes, undefined)
	assert.deepEqual([plain.p.w, plain.p.h], [800, 600])
})

test('AK3: create by a drag: at least 220 × 180, three equal lanes; a note inside is adopted in the same undo step', async () => {
	const n = { id: ID('N1'), t: 'sticky', x: 20, y: 20, w: 50, h: 50, r: 0, z: 'i1', parent: null, data: { text: 'x' }, style: {}, group: null, lock: null }
	const h = await open({ items: [n] })
	cb(h).onIntent({ type: 'create', t: 'frame', at: { x: 0, y: 0 }, rect: { x: 0, y: 0, w: 150, h: 90 }, lanes: true })
	const ops = await opsAfter(h, 0)
	const put = ops.find((o) => o.o === 'put')
	assert.deepEqual([put.p.w, put.p.h], [220, 180])
	assert.deepEqual(orderedLanes(put.p.data.lanes).map((l) => l.h), [60, 60, 60])
	assert.deepEqual(ops.find((o) => o.id === n.id)?.p, { x: 20, y: 20, parent: put.id }, 'the note goes into the frame')
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.undo()
	await opsAfter(h, 0)
	assert.equal(live(h, put.id), undefined)
	assert.equal(live(h, n.id).parent, null)
})

test('AK3: laneAdd at the end; menu above and below move the children below; the new lane\'s editor opens; one undo step each', async () => {
	const h = await open({ items: [frame(), note(1, 300, 50), note(2, 300, 250), note(3, 300, 450)] })
	cb(h).onIntent({ type: 'laneAdd', id: F })
	await opsAfter(h, 0)
	assert.equal(live(h).h, 800)
	assert.equal(keysOf(live(h)).length, 4)
	const fresh = keysOf(live(h))[3]
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: fresh }])
	assert.equal(live(h, ID('N3')).y, 450, 'at the end nothing moves')
	h.s.select([F])
	assert.equal(h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L2 }), true)
	assert.deepEqual(h.menus.at(-1).lanes, { index: 1, count: 4, locked: false, group: false, cols: null })
	h.s.menuAction('lane-above')
	await opsAfter(h, 0)
	assert.equal(keysOf(live(h))[1] !== L2, true)
	assert.deepEqual([live(h, ID('N1')).y, live(h, ID('N2')).y, live(h, ID('N3')).y], [50, 450, 650])
	assert.equal(live(h).h, 1000)
	assert.equal(h.s.undoStack.done.length, 2)
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([live(h, ID('N2')).y, live(h, ID('N3')).y, live(h).h, keysOf(live(h)).length], [250, 450, 800, 4])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L2 })
	h.s.menuAction('lane-below')
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)).slice(0, 2), [L1, L2])
	assert.deepEqual([live(h, ID('N2')).y, live(h, ID('N3')).y], [250, 650])
})

test('AK3: laneHeight, up, down, delete and rename on the lane of the menu; a group moves as one; undo back', async () => {
	const items = [frame(), note(1, 300, 50), note(2, 300, 250, { group: G }), note(3, 500, 230, { group: G }), note(4, 300, 450)]
	const h = await open({ items })
	cb(h).onIntent({ type: 'laneHeight', id: F, lane: L1, h: 300 })
	await opsAfter(h, 0)
	assert.deepEqual([live(h).data.lanes[L1].h, live(h).h], [300, 700])
	assert.deepEqual([ID('N1'), ID('N2'), ID('N3'), ID('N4')].map((id) => live(h, id).y), [50, 350, 330, 550])
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([ID('N2'), ID('N3'), ID('N4')].map((id) => live(h, id).y), [250, 230, 450])
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L2 })
	assert.deepEqual(h.menus.at(-1).lanes, { index: 1, count: 3, locked: false, group: false, cols: null })
	h.s.menuAction('lane-up')
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)), [L2, L1, L3])
	assert.deepEqual([ID('N1'), ID('N2'), ID('N3')].map((id) => live(h, id).y), [250, 50, 30], 'the group moved as one')
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L2 })
	h.s.menuAction('lane-down')
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)), [L1, L2, L3])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L2 })
	h.s.menuAction('lane-delete')
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)), [L1, L3])
	assert.deepEqual([live(h).data.lanes[L1].h, live(h).h], [400, 600], 'the band goes to the lane above, the frame stays')
	assert.deepEqual([ID('N2'), ID('N3')].map((id) => live(h, id).y), [250, 230], 'nothing moves or goes')
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)), [L1, L2, L3])
	assert.deepEqual(live(h).data.lanes[L2], { o: 'i1', h: 200, t: 'Support' })
	assert.equal(h.s.undoStack.done.length, 2, 'height and delete undone: up and down are left')
	// rename opens the editor; its final text goes out once
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L3 })
	h.s.menuAction('lane-rename')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: L3 }])
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'text', id: F, path: `data.lanes.${L3}.t`, cell: L3, value: 'IT', before: '', final: false })
	assert.deepEqual(await opsAfter(h, n), [], 'no intermediate text')
	cb(h).onIntent({ type: 'text', id: F, path: `data.lanes.${L3}.t`, cell: L3, value: 'IT', before: '', final: true })
	assert.deepEqual((await opsAfter(h, n)).map((o) => o.p), [{ [`data.lanes.${L3}.t`]: 'IT' }])
	cb(h).onIntent({ type: 'text', id: F, path: `data.lanes.${L1}.t`, cell: L1, value: '', before: 'Sales', final: true })
	await opsAfter(h, 0)
	assert.equal(live(h).data.lanes[L1].t, undefined, '"" goes as null')
})

test('AK3: the menu entries of the lane: the first has no up, the last no down, one lane no delete', async () => {
	const h = await open()
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1 })
	assert.deepEqual(h.menus.at(-1).lanes, { index: 0, count: 3, locked: false, group: false, cols: null })
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: 'l99999999' })
	assert.equal(h.menus.at(-1).lanes, undefined, 'no such lane: no lane entries')
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10] })
	assert.equal(h.menus.at(-1).lanes, undefined, 'no lane under W')
})

test('AK3: a locked frame, a locked child in the way, modes view and vote and a frozen board send nothing; the infos', async () => {
	const locked = await open({ items: [frame({ lock: { by: 'pidbob', name: 'Bob' } })] })
	let n = locked.tr.calls.length
	cb(locked).onIntent({ type: 'laneAdd', id: F })
	cb(locked).onIntent({ type: 'laneHeight', id: F, lane: L1, h: 300 })
	locked.s.laneMenuAction('lane-delete', F, L2)
	assert.deepEqual(await opsAfter(locked, n), [])
	const child = await open({ items: [frame(), note(2, 300, 250, { lock: { by: 'pidbob', name: 'Bob' } })] })
	n = child.tr.calls.length
	cb(child).onIntent({ type: 'laneHeight', id: F, lane: L1, h: 300 })
	child.s.laneMenuAction('lane-up', F, L2)
	assert.deepEqual(await opsAfter(child, n), [])
	assert.deepEqual(child.infos, [['Locked items are in the way. Unlock them first.', 'lane-locked'], ['Locked items are in the way. Unlock them first.', 'lane-locked']])
	child.s.laneMenuAction('lane-delete', F, L2)
	assert.equal((await opsAfter(child, n)).length, 1, 'delete moves nothing: a locked child does not matter')
	for (const role of ['view', 'vote']) {
		const h = await open({ me: { ...ALICE, role, mod: false } })
		n = h.tr.calls.length
		cb(h).onIntent({ type: 'laneAdd', id: F })
		h.s.laneAdd(F)
		h.s.laneMenuAction('lane-delete', F, L2)
		assert.deepEqual(await opsAfter(h, n), [], role)
	}
	const frozen = await open()
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.laneAdd(F)
	frozen.s.laneMenuAction('lane-up', F, L2)
	assert.deepEqual(await opsAfter(frozen, n), [])
	// 30 lanes, a frame too tall
	const lanes = {}
	for (let i = 0; i < 30; i++) lanes['l' + String(i).padStart(8, '0')] = { o: 'i' + '0123456789abcdefghijklmnopqrstuvwxyz'[i], h: 100 }
	const full = await open({ items: [frame({ h: 3000, data: { lanes } })] })
	n = full.tr.calls.length
	full.s.laneAdd(F)
	const tall = await open({ items: [frame({ h: 99900, data: { lanes: { [L1]: { o: 'i0', h: 99900 } } } })] })
	tall.s.laneAdd(F)
	assert.deepEqual(await opsAfter(full, n), [])
	assert.deepEqual(full.infos, [['A frame can have at most 30 lanes.', 'lane-limit']])
	assert.deepEqual(tall.infos, [['The frame cannot get any taller.', 'lane-limit']])
})

test('AK3: while a lane\'s name is edited, me.e names nothing (no lease on the frame\'s title)', async () => {
	const h = await open()
	cb(h).onEditing(F, false, L2)
	const me = h.s.getPresence()
	assert.equal(me.e, null)
	assert.equal(me.ec, undefined)
	// job 208: nor while a column's name is edited
	cb(h).onEditing(F, false, 'c00000002')
	assert.deepEqual([h.s.getPresence().e, h.s.getPresence().ec], [null, undefined])
	cb(h).onEditing(F, false)
	assert.equal(h.s.getPresence().e, F, 'the title editor holds the lease as before')
})

test('AK3: duplicate and copy / paste of a frame with lanes give the same lanes', async () => {
	const h = await open()
	h.s.select([F])
	h.s.duplicate()
	const ops = await opsAfter(h, 0)
	const put = ops.find((o) => o.o === 'put' && o.t === 'frame')
	assert.ok(put && put.id !== F)
	assert.deepEqual(put.p.data.lanes, frame().data.lanes)
	const m = new SceneModel()
	m.load([frame()])
	const payload = actions.copyPayload(m, [F])
	const pasted = actions.pasteItems(m, payload, { at: { x: 5000, y: 0 } })
	assert.deepEqual(pasted.ops.find((o) => o.t === 'frame').p.data.lanes, frame().data.lanes)
})

test('AK3: the transformer: the bottom edge changes the last lane, the top edge the first; the width alone none', () => {
	const m = new SceneModel()
	m.load([frame({ x: 100, y: 100 })])
	const before = new Map([[F, { x: 100, y: 100, w: 1200, h: 600, r: 0, parent: null }]])
	const bottom = actions.transformItems(m, { ids: [F], before, after: new Map([[F, { x: 100, y: 100, w: 1200, h: 700, r: 0 }]]), keep: true })
	assert.equal(bottom.ops[0].p[`data.lanes.${L3}.h`], 300)
	assert.equal(bottom.inverse[0].p[`data.lanes.${L3}.h`], 200)
	const top = actions.transformItems(m, { ids: [F], before, after: new Map([[F, { x: 100, y: 50, w: 1200, h: 650, r: 0 }]]), keep: true })
	assert.equal(top.ops[0].p[`data.lanes.${L1}.h`], 250)
	assert.equal(top.ops[0].p[`data.lanes.${L3}.h`], undefined)
	const wide = actions.transformItems(m, { ids: [F], before, after: new Map([[F, { x: 100, y: 100, w: 1500, h: 600, r: 0 }]]), keep: true })
	assert.ok(!Object.keys(wide.ops[0].p).some((k) => k.startsWith('data.lanes')))
	const after = structuredClone(frame({ x: 100, y: 100 }))
	applyPatch(after, bottom.ops[0].p)
	assert.equal(laneBands(after).reduce((s, b) => s + b.h, 0), 700)
})

// ---- Job 208: columns ------------------------------------------------------

const C1 = 'c00000001'
const C2 = 'c00000002'
const C3 = 'c00000003'

/** The frame with the head row (h 656, job 264: before 660) and columns of 300, 400 and 340. */
function grid(extra = {}) {
	const f = frame({ h: 656 })
	f.data.cols = { [C1]: { o: 'i0', w: 412, t: 'Discover' }, [C2]: { o: 'i1', w: 400 }, [C3]: { o: 'i2', w: 340 } }
	return { ...f, ...extra }
}

const colsOf = (it) => orderedCols(it.data.cols ?? {}).map((c) => c.key)
const ys = (h, ns) => ns.map((n) => live(h, ID('N' + n)).y)
const xs = (h, ns) => ns.map((n) => live(h, ID('N' + n)).x)

test('job 208 AK3: column-add makes the first column; column-right, "+" and column-left more; each one undo step, the editor opens', async () => {
	const h = await open({ items: [frame(), note(1, 300, 50), note(2, 300, 450)] })
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1 })
	assert.deepEqual(h.menus.at(-1).lanes, { index: 0, count: 3, locked: false, group: false, cols: null })
	assert.equal(h.s.menuAction('column-add'), true)
	await opsAfter(h, 0)
	const first = colsOf(live(h))
	assert.equal(first.length, 1)
	assert.deepEqual([live(h).h, live(h).data.cols[first[0]].w], [656, 1152])
	assert.deepEqual(ys(h, [1, 2]), [106, 506], 'the lanes and their children move below the head row')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: first[0] }])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: first[0] })
	assert.deepEqual(h.menus.at(-1).lanes.cols, { index: 0, count: 1, group: false })
	h.s.menuAction('column-right')
	await opsAfter(h, 0)
	assert.equal(colsOf(live(h)).length, 2)
	assert.equal(live(h).w, 1500)
	cb(h).onIntent({ type: 'colAdd', id: F })
	await opsAfter(h, 0)
	assert.equal(colsOf(live(h)).length, 3)
	assert.equal(live(h).w, 1800)
	assert.equal(h.s.undoStack.done.length, 3)
	h.s.undo()
	h.s.undo()
	h.s.undo()
	await opsAfter(h, 0)
	assert.equal(live(h).data.cols, undefined)
	assert.deepEqual([live(h).h, live(h).w, ...ys(h, [1, 2])], [600, 1200, 50, 450], 'undo back to the frame without columns')
})

test('job 208 AK3: colWidth, colMove, laneMove, column-move-left/right, column-delete and column-rename; a group moves as one; undo back', async () => {
	const items = [grid(), note(1, 200, 100), note(2, 500, 300, { group: G }), note(3, 620, 320, { group: G }), note(4, 900, 500)]
	const h = await open({ items })
	cb(h).onIntent({ type: 'colWidth', id: F, col: C1, w: 512 })
	await opsAfter(h, 0)
	assert.deepEqual([live(h).data.cols[C1].w, live(h).w], [512, 1300])
	assert.deepEqual(xs(h, [1, 2, 3, 4]), [200, 600, 720, 1000])
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(xs(h, [2, 3, 4]), [500, 620, 900])
	cb(h).onIntent({ type: 'colMove', id: F, col: C1, to: 2 })
	await opsAfter(h, 0)
	assert.deepEqual(colsOf(live(h)), [C2, C3, C1])
	assert.deepEqual(xs(h, [1, 2, 3, 4]), [940, 88, 208, 488], 'the group moved as one')
	h.s.undo()
	await opsAfter(h, 0)
	cb(h).onIntent({ type: 'laneMove', id: F, lane: L3, to: 0 })
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)), [L3, L1, L2])
	assert.deepEqual(ys(h, [1, 2, 4]), [300, 500, 100])
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(ys(h, [1, 2, 4]), [100, 300, 500])
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C2 })
	assert.deepEqual(h.menus.at(-1).lanes, { index: 0, count: 3, locked: false, group: false, cols: { index: 1, count: 3, group: false } })
	h.s.menuAction('column-move-left')
	await opsAfter(h, 0)
	assert.deepEqual(colsOf(live(h)), [C2, C1, C3])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C2 })
	h.s.menuAction('column-move-right')
	await opsAfter(h, 0)
	assert.deepEqual(colsOf(live(h)), [C1, C2, C3])
	assert.deepEqual(xs(h, [1, 2, 4]), [200, 500, 900])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C2 })
	h.s.menuAction('column-delete')
	await opsAfter(h, 0)
	assert.deepEqual(colsOf(live(h)), [C1, C3])
	assert.deepEqual([live(h).data.cols[C1].w, live(h).w], [812, 1200], 'the band goes to the column left, the frame stays')
	assert.deepEqual(xs(h, [1, 2, 4]), [200, 500, 900], 'nothing moves or goes')
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data.cols[C2], { o: 'i1', w: 400 })
	// rename opens the editor of the column; its final text goes out once
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C3 })
	h.s.menuAction('column-rename')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: C3 }])
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'text', id: F, path: `data.cols.${C3}.t`, cell: C3, value: 'Use', before: '', final: true })
	assert.deepEqual((await opsAfter(h, n)).map((o) => o.p), [{ [`data.cols.${C3}.t`]: 'Use' }])
})

test('job 208 AK3: deleting the last column takes the head row to the first lane; nothing moves; undo back', async () => {
	const one = grid()
	one.data.cols = { [C1]: { o: 'i0', w: 1152 } }
	const h = await open({ items: [one, note(1, 300, 100)] })
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C1 })
	assert.deepEqual(h.menus.at(-1).lanes.cols, { index: 0, count: 1, group: false })
	h.s.menuAction('column-delete')
	await opsAfter(h, 0)
	assert.equal(live(h).data.cols, undefined)
	assert.deepEqual([live(h).h, live(h).data.lanes[L1].h, live(h, ID('N1')).y], [656, 256, 100])
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data.cols, { [C1]: { o: 'i0', w: 1152 } })
	assert.equal(live(h).data.lanes[L1].h, 200)
})

test('job 208 AK3: widths that do not add up are all written; the limits, a locked frame or child, view, vote and frozen send nothing', async () => {
	const h = await open({ items: [grid({ w: 1776 })] })
	cb(h).onIntent({ type: 'colWidth', id: F, col: C1, w: 500 })
	const [op] = await opsAfter(h, 0)
	assert.deepEqual([C1, C2, C3].map((k) => op.p[`data.cols.${k}.w`]), [500, 600, 510])
	assert.ok(Math.abs(colBands(live(h)).reduce((s, b) => s + b.w, 0) - (live(h).w - 48)) < 0.01)
	const thirty = {}
	for (let i = 1; i <= 30; i++) thirty['c' + String(i).padStart(8, '0')] = { o: 'i' + i.toString(36).padStart(2, '0'), w: 100 }
	const full = await open({ items: [grid({ w: 3048, data: { ...grid().data, cols: thirty } })] })
	let n = full.tr.calls.length
	full.s.colAdd(F)
	assert.deepEqual(await opsAfter(full, n), [])
	assert.deepEqual(full.infos, [['A frame can have at most 30 columns.', 'lane-limit']])
	const wide = await open({ items: [grid({ w: 99900, data: { ...grid().data, cols: { [C1]: { o: 'i0', w: 99852 } } } })] })
	wide.s.colAdd(F)
	cb(wide).onIntent({ type: 'colWidth', id: F, col: C1, w: 99990 })
	assert.deepEqual(wide.infos, [['The frame cannot get any wider.', 'lane-limit'], ['The frame cannot get any wider.', 'lane-limit']])
	const locked = await open({ items: [grid({ lock: { by: 'pidbob', name: 'Bob' } })] })
	n = locked.tr.calls.length
	cb(locked).onIntent({ type: 'colAdd', id: F })
	cb(locked).onIntent({ type: 'colWidth', id: F, col: C1, w: 400 })
	cb(locked).onIntent({ type: 'colMove', id: F, col: C1, to: 2 })
	cb(locked).onIntent({ type: 'laneMove', id: F, lane: L1, to: 2 })
	locked.s.laneMenuAction('column-delete', F, L1, C2)
	assert.deepEqual(await opsAfter(locked, n), [])
	const child = await open({ items: [grid(), note(4, 900, 500, { lock: { by: 'pidbob', name: 'Bob' } })] })
	n = child.tr.calls.length
	cb(child).onIntent({ type: 'colWidth', id: F, col: C1, w: 400 })
	cb(child).onIntent({ type: 'colMove', id: F, col: C3, to: 0 })
	assert.deepEqual(await opsAfter(child, n), [])
	assert.deepEqual(child.infos, [['Locked items are in the way. Unlock them first.', 'lane-locked'], ['Locked items are in the way. Unlock them first.', 'lane-locked']])
	for (const role of ['view', 'vote']) {
		const v = await open({ items: [grid()], me: { ...ALICE, role, mod: false } })
		n = v.tr.calls.length
		cb(v).onIntent({ type: 'colAdd', id: F })
		cb(v).onIntent({ type: 'colMove', id: F, col: C1, to: 2 })
		v.s.laneMenuAction('column-add', F, L1)
		assert.deepEqual(await opsAfter(v, n), [], role)
	}
	const frozen = await open({ items: [grid()] })
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.colAdd(F)
	cb(frozen).onIntent({ type: 'laneMove', id: F, lane: L1, to: 2 })
	assert.deepEqual(await opsAfter(frozen, n), [])
})

test('job 208 AK3: duplicate keeps the columns; the transformer\'s left edge changes the first column, its right edge the last', async () => {
	const h = await open({ items: [grid()] })
	h.s.select([F])
	h.s.duplicate()
	const put = (await opsAfter(h, 0)).find((o) => o.o === 'put' && o.t === 'frame')
	assert.deepEqual(put.p.data.cols, grid().data.cols)
	const m = new SceneModel()
	m.load([grid({ x: 100, y: 100 })])
	const before = new Map([[F, { x: 100, y: 100, w: 1200, h: 656, r: 0, parent: null }]])
	const right = actions.transformItems(m, { ids: [F], before, after: new Map([[F, { x: 100, y: 100, w: 1300, h: 656, r: 0 }]]), keep: true })
	assert.deepEqual([right.ops[0].p[`data.cols.${C3}.w`], right.inverse[0].p[`data.cols.${C3}.w`]], [440, 340])
	const left = actions.transformItems(m, { ids: [F], before, after: new Map([[F, { x: 50, y: 100, w: 1250, h: 656, r: 0 }]]), keep: true })
	assert.equal(left.ops[0].p[`data.cols.${C1}.w`], 462)
	assert.equal(left.ops[0].p[`data.cols.${C3}.w`], undefined)
})

// ---- job 225: lane and column groups -----------------------------------------------

test('job 225 AK3: lane-group from the menu: the group, the frame 48 wider, every child along, the editor; its name; span, move and ungroup; undo back', async () => {
	const h = await open({ items: [frame(), note(1, 300, 50), note(2, 300, 250, { group: G }), note(3, 420, 260, { group: G }), note(4, 300, 450)] })
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: null })
	assert.deepEqual(h.menus.at(-1).lanes, { index: 0, count: 3, locked: false, group: false, cols: null })
	h.s.menuAction('lane-group')
	await opsAfter(h, 0)
	const g = Object.keys(live(h).data.lgroups)[0]
	assert.match(g, /^g[0-9a-z]{8}$/)
	assert.deepEqual([live(h).w, live(h).data.lanes[L1].g, live(h).data.lgroups[g]], [1248, g, ''])
	assert.deepEqual(xs(h, [1, 2, 3, 4]), [348, 348, 468, 348], 'every child 48 to the right')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: g }], 'the editor of the group\'s name')
	let n = h.tr.calls.length
	cb(h).onIntent({ type: 'text', id: F, path: `data.lgroups.${g}`, cell: g, value: 'Team', before: '', final: true })
	assert.deepEqual((await opsAfter(h, n)).map((o) => o.p), [{ [`data.lgroups.${g}`]: 'Team' }])
	// the dragged edge takes L2 in
	cb(h).onIntent({ type: 'laneGroupSpan', id: F, group: g, from: 0, to: 1 })
	await opsAfter(h, 0)
	assert.deepEqual(orderedLanes(live(h).data.lanes).map((l) => l.g), [g, g, null])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L2, col: null })
	assert.equal(h.menus.at(-1).lanes.group, true)
	// "Add lane below" from a lane of the group: in it
	h.s.menuAction('lane-below')
	await opsAfter(h, 0)
	assert.deepEqual(orderedLanes(live(h).data.lanes).map((l) => l.g), [g, g, g, null])
	h.s.undo()
	await opsAfter(h, 0)
	// the dragged cell: the group below L3, its children along
	cb(h).onIntent({ type: 'laneGroupMove', id: F, group: g, to: 1 })
	await opsAfter(h, 0)
	assert.deepEqual(keysOf(live(h)), [L3, L1, L2])
	assert.deepEqual(ys(h, [1, 2, 3, 4]), [250, 450, 460, 50], 'the group of notes moved as one')
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([keysOf(live(h)), ys(h, [1, 2, 3, 4])], [[L1, L2, L3], [50, 250, 260, 450]])
	// dissolve: the cell goes, the children back
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: null })
	h.s.menuAction('lane-ungroup')
	await opsAfter(h, 0)
	assert.deepEqual([live(h).w, live(h).data.lgroups, orderedLanes(live(h).data.lanes).map((l) => l.g)], [1200, undefined, [null, null, null]])
	assert.deepEqual(xs(h, [1, 2, 3, 4]), [300, 300, 420, 300])
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([live(h).w, live(h).data.lgroups], [1248, { [g]: 'Team' }])
	// lane-group-rename opens the group's editor
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: null })
	h.s.menuAction('lane-group-rename')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: g }])
})

test('job 225 AK3: column-group: the frame 44 higher (job 264: before 48), every child down; column-ungroup back; duplicate keeps the groups', async () => {
	const h = await open({ items: [grid(), note(1, 200, 100), note(2, 600, 300)] })
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C2 })
	assert.deepEqual(h.menus.at(-1).lanes.cols, { index: 1, count: 3, group: false })
	h.s.menuAction('column-group')
	await opsAfter(h, 0)
	const g = Object.keys(live(h).data.cgroups)[0]
	assert.match(g, /^h[0-9a-z]{8}$/)
	assert.deepEqual([live(h).h, live(h).data.cols[C2].g], [700, g])
	assert.deepEqual(ys(h, [1, 2]), [144, 344])
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', F, { cell: g }])
	cb(h).onIntent({ type: 'colGroupSpan', id: F, group: g, from: 1, to: 2 })
	await opsAfter(h, 0)
	assert.deepEqual(orderedCols(live(h).data.cols).map((c) => c.g), [null, g, g])
	cb(h).onIntent({ type: 'colGroupMove', id: F, group: g, to: 0 })
	await opsAfter(h, 0)
	assert.deepEqual(colsOf(live(h)), [C2, C3, C1])
	const before = h.tr.calls.length
	h.s.select([F])
	h.s.duplicate()
	const put = (await opsAfter(h, before)).find((o) => o.o === 'put' && o.t === 'frame')
	assert.deepEqual(put.p.data.cgroups, live(h).data.cgroups)
	assert.ok(checkCols(put.p.data.cols, put.p.data.cgroups))
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10], cell: L1, col: C2 })
	h.s.menuAction('column-ungroup')
	await opsAfter(h, 0)
	assert.deepEqual([live(h).h, live(h).data.cgroups], [656, undefined])
	assert.deepEqual(ys(h, [1, 2]), [100, 300])
})

test('job 225 AK3: a locked frame or child, view, vote and a frozen board send nothing; the infos; too wide', async () => {
	const locked = await open({ items: [frame({ lock: { by: 'pidbob', name: 'Bob' } })] })
	let n = locked.tr.calls.length
	locked.s.laneMenuAction('lane-group', F, L1)
	cb(locked).onIntent({ type: 'laneGroupSpan', id: F, group: 'g00000001', from: 0, to: 1 })
	assert.deepEqual(await opsAfter(locked, n), [])
	const child = await open({ items: [frame(), note(2, 300, 250, { lock: { by: 'pidbob', name: 'Bob' } })] })
	n = child.tr.calls.length
	child.s.laneMenuAction('lane-group', F, L1)
	assert.deepEqual(await opsAfter(child, n), [])
	assert.deepEqual(child.infos, [['Locked items are in the way. Unlock them first.', 'lane-locked']])
	for (const role of ['view', 'vote']) {
		const v = await open({ me: { ...ALICE, role, mod: false } })
		n = v.tr.calls.length
		v.s.laneMenuAction('lane-group', F, L1)
		cb(v).onIntent({ type: 'laneGroupMove', id: F, group: 'g00000001', to: 0 })
		assert.deepEqual(await opsAfter(v, n), [], role)
	}
	const frozen = await open()
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.laneMenuAction('lane-group', F, L1)
	assert.deepEqual(await opsAfter(frozen, n), [])
	const wide = await open({ items: [frame({ w: 99960 })] })
	n = wide.tr.calls.length
	wide.s.laneMenuAction('lane-group', F, L1)
	assert.deepEqual(await opsAfter(wide, n), [])
	assert.deepEqual(wide.infos, [['The frame cannot get any wider.', 'lane-limit']])
})
