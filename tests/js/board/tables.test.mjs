/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 173 (AK4): tables in BoardSession, with the fake scene and a
 * small LWW server that applies and echoes the ops:
 * - creating: one put of a 3 × 3 table, selected, the editor of its
 *   top-left cell, me.e/me.ec while it is open; creation and first text are
 *   one undo step, the size measured again after the close
 * - Tab to the next cell (onEditing names it), "" goes out as null
 * - the three notices (50 rows, 20 columns, no bytes) send nothing
 * - inserting, deleting, a width and the header are one undo step each;
 *   undo brings the cells back with their text; w/h are written again
 * - a locked table, modes view and vote and a frozen board send nothing
 * - no merged patch has more than 50 paths
 * - the context menu carries the cell and the table's entries act on it;
 *   "Export as CSV" downloads "<title> - Table.csv"
 *
 * Factory job 174 (AK3):
 * - Tab in the last cell: two undo steps (the text, the row), then the new
 *   row's left cell opens; at 50 rows the hint, no op, no editor
 * - a 2 × 5 grid pasted into a new 3 × 3 table at the top left: 5 rows with
 *   the texts in one undo step, undo 3 × 3 without them, redo 5 rows; no
 *   patch above 50 paths (a 3 × 50 grid too)
 * - the hints with their hooks: cut pastes the rest; held and full send
 *   nothing; locked, view, vote and frozen send nothing
 *
 * Factory job 185 (AK3): a grid of 2 rows × 5 columns pasted into a new
 * 3 × 3 table at the top left gives 5 columns × 3 rows with the texts, no
 * hint, one undo step (undo 3 × 3 without them, redo 5 columns); four cells
 * from the second column give 5 columns without a hint, 21 columns the cut
 * hint with the rest pasted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession, leaseKey, leaseParts } from '../../../src/board/BoardSession.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { checkTable, orderedCols, orderedRows, tableBytes, tableCsv, tableLayout } from '../../../src/model/table.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, RoutedModel, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const T = ID('T1')
const C = ['c00000001', 'c00000002', 'c00000003']
const R = ['r00000001', 'r00000002', 'r00000003']
const cell = (c, r) => C[c] + '.' + R[r]

/** A stored 3 × 3 table. */
function table(extra = {}) {
	return {
		id: T, t: 'table', x: 0, y: 0, w: 480, h: 108, r: 0, z: 'i5', parent: null,
		data: {
			cols: Object.fromEntries(C.map((k, i) => [k, { o: 'i' + i, w: 160 }])),
			rows: Object.fromEntries(R.map((k, i) => [k, { o: 'i' + i }])),
			cells: { [C[0]]: { [R[0]]: 'Name', [R[1]]: 'Alice' }, [C[2]]: { [R[1]]: '42' } },
		},
		style: {},
		group: null,
		lock: null,
		...extra,
	}
}

/** LWW server: applies like §4.6 and answers with every item changed since the cursor. */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) return 'dup'
			if (srv.dead.has(op.id) && op.revive !== true) return 'gone'
			srv.live.set(op.id, itemFromPut(op))
			srv.dead.delete(op.id)
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) return 'gone'
			if (Object.keys(op.p).length > 50) return 'bad'
			applyPatch(it, structuredClone(op.p))
			if (it.t === 'table' && !checkTable(it.data)) return 'bad'
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

async function open({ items = [table()], me = ALICE, limits = null } = {}) {
	const clock = new FakeClock(10000)
	const infos = []
	const toasts = []
	const downloads = []
	const srv = lwwServer(items)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Work/shop', role: me.role, metaRev: 3, meta: {} }, me, items: [...srv.live.values()].map((it) => structuredClone(it)) }
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
		limits,
		ui: {},
		deps: {
			SceneModel: RoutedModel,
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
			download: (name, text) => downloads.push([name, text]),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, srv, infos, toasts, downloads, scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
async function opsAfter(h, n) {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}

const cb = (h) => h.scene.callbacks
const live = (h) => h.srv.live.get(T)

test('AK4: creating puts one 3 × 3 table, selects it, opens its top-left cell; me.e/me.ec while it is open; first text and creation one undo step', async () => {
	const h = await open({ items: [] })
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'create', t: 'table', at: { x: 1000, y: 500 }, rect: null })
	const id = h.scene.selection[0]
	assert.ok(id)
	const opened = h.scene.callsOf('openTextEditor')
	assert.deepEqual(opened.at(-1).slice(1), [id, {}], 'the scene opens the top-left cell (its default)')
	const it = h.model.get(id)
	const cols = orderedCols(it.data).map((c) => c.key)
	const rows = orderedRows(it.data).map((r) => r.key)
	assert.deepEqual([cols.length, rows.length, it.w, it.h, it.x, it.y], [3, 3, 480, 108, 760, 446], 'centred on the point')
	const first = cols[0] + '.' + rows[0]
	cb(h).onEditing(id, false, first)
	assert.deepEqual([h.s.getPresence().e, h.s.getPresence().ec], [id, first])
	cb(h).onIntent({ type: 'text', id, path: `data.cells.${cols[0]}.${rows[0]}`, value: 'Name', before: '', final: true, cell: first })
	cb(h).onEditing(null, false)
	const ops = await opsAfter(h, n)
	assert.equal(ops[0].o, 'put')
	assert.equal(ops[0].t, 'table')
	assert.equal(checkTable(ops[0].p.data), true)
	assert.equal(h.srv.live.get(id).data.cells[cols[0]][rows[0]], 'Name')
	assert.equal(h.s.undoStack.done.length, 1, 'creation and first text: one step')
	h.s.undo()
	await opsAfter(h, h.tr.calls.length)
	assert.equal(h.srv.live.has(id), false, 'one undo removes it')
	assert.equal(h.s.getPresence().ec, undefined, 'no ec without an editor')
})

test('AK4: Tab to the next cell names it; "" goes out as null; the lease key per cell', async () => {
	const h = await open()
	assert.equal(leaseKey(T, cell(0, 0)), T + '#' + cell(0, 0))
	assert.deepEqual(leaseParts(leaseKey(T, cell(0, 0))), [T, cell(0, 0)])
	assert.deepEqual(leaseParts(T), [T, null])
	const n = h.tr.calls.length
	cb(h).onEditing(T, false, cell(0, 1))
	cb(h).onIntent({ type: 'text', id: T, path: `data.cells.${C[0]}.${R[1]}`, value: '', before: 'Alice', final: true, cell: cell(0, 1) })
	// Tab: the scene closes this editor and opens the next cell
	cb(h).onEditing(null, false)
	cb(h).onEditing(T, false, cell(1, 1))
	assert.equal(h.s.getPresence().ec, cell(1, 1))
	cb(h).onIntent({ type: 'text', id: T, path: `data.cells.${C[1]}.${R[1]}`, value: 'B', before: '', final: true, cell: cell(1, 1) })
	cb(h).onEditing(null, false)
	const ops = await opsAfter(h, n)
	const cells = Object.assign({}, ...ops.filter((op) => op.o === 'patch').map((op) => Object.fromEntries(Object.entries(op.p).filter(([k]) => k.startsWith('data.cells.')))))
	assert.deepEqual(cells, { [`data.cells.${C[0]}.${R[1]}`]: null, [`data.cells.${C[1]}.${R[1]}`]: 'B' }, 'one path per cell, "" as null')
	assert.equal(live(h).data.cells[C[0]][R[1]], undefined, 'the empty cell is absent')
	assert.equal(live(h).data.cells[C[1]][R[1]], 'B')
	assert.ok(ops.every((op) => Object.values(op.p ?? {}).every((v) => v !== '')), 'never an empty string')
})

test('AK4: the three notices send nothing (50 rows, 20 columns, the table is full)', async () => {
	const rows = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['r' + String(i + 1).padStart(8, '0'), { o: 'i' + '0123456789abcdefghijklmnopqrstuvwxyz'[i % 36] + (i >= 36 ? 'g' : '') }]))
	const cols = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['c' + String(i + 1).padStart(8, '0'), { o: 'i' + '0123456789abcdefghij'[i], w: 40 }]))
	const full = table({ w: 800, h: 1800, data: { cols, rows } })
	assert.equal(checkTable(full.data), true)
	const h = await open({ items: [full] })
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'tableAppend', id: T, axis: 'row' })
	cb(h).onIntent({ type: 'tableAppend', id: T, axis: 'col' })
	assert.deepEqual(h.infos, [['A table can have at most 50 rows.', 'table-limit'], ['A table can have at most 20 columns.', 'table-limit']])
	// room for 10 more bytes: a new row needs more
	const small = await open({ limits: { maxItemBytes: tableBytes(table()) + 10 } })
	const m = small.tr.calls.length
	small.scene.callbacks.onIntent({ type: 'tableAppend', id: T, axis: 'row' })
	assert.deepEqual(small.infos, [['The table is full.', 'table-full']])
	// a text that would make it too big: not sent, the editor keeps it with its notice
	small.scene.callbacks.onEditing(T, false, cell(1, 0))
	small.scene.callbacks.onIntent({ type: 'text', id: T, path: `data.cells.${C[1]}.${R[0]}`, value: 'x'.repeat(400), before: '', final: false, cell: cell(1, 0) })
	assert.deepEqual(small.scene.callsOf('setEditorNotice').at(-1), ['setEditorNotice', T, 'Not saved: the table is full. Copy your text before closing.', cell(1, 0)])
	assert.deepEqual(await opsAfter(h, n), [])
	assert.deepEqual(await opsAfter(small, m), [])
})

test('AK4: insert, delete, width and header are one undo step each; undo brings the cells with their text; w/h written again', async () => {
	const h = await open()
	const steps = () => h.s.undoStack.done.length
	// insert a column via the "+"
	cb(h).onIntent({ type: 'tableAppend', id: T, axis: 'col' })
	await opsAfter(h, 0)
	assert.equal(steps(), 1)
	assert.deepEqual([Object.keys(live(h).data.cols).length, live(h).w], [4, 640], 'w follows')
	// delete column 3 through the menu on its cell
	h.s.select([T])
	assert.equal(h.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: cell(2, 1) }), true)
	h.s.menuAction('col-delete')
	await opsAfter(h, 0)
	assert.equal(steps(), 2)
	assert.equal(live(h).data.cols[C[2]], undefined)
	assert.equal(live(h).data.cells[C[2]], undefined, 'the cells go with it')
	assert.equal(live(h).w, 480)
	// a width and the header
	cb(h).onIntent({ type: 'tableWidth', id: T, col: C[0], w: 300 })
	h.s.setStyle('style.header', 'off')
	await opsAfter(h, 0)
	assert.equal(steps(), 4)
	assert.deepEqual([live(h).data.cols[C[0]].w, live(h).w, live(h).style.header], [300, 620, 'off'])
	// undo: header, width, then the column comes back with its cells
	h.s.undo()
	h.s.undo()
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data.cells[C[2]], { [R[1]]: '42' }, 'undo brings the cells with their text')
	assert.deepEqual([live(h).w, live(h).style.header ?? 'on', live(h).data.cols[C[0]].w], [640, 'on', 160])
	// a row with text: delete and undo
	h.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: cell(0, 1) })
	h.s.menuAction('row-delete')
	await opsAfter(h, 0)
	assert.equal(live(h).data.cells[C[0]][R[1]], undefined)
	assert.equal(live(h).h, 72)
	h.s.undo()
	await opsAfter(h, 0)
	assert.equal(live(h).data.cells[C[0]][R[1]], 'Alice')
	assert.equal(live(h).h, 108)
	// someone else grew a row meanwhile: the undo of a width writes the measured h again
	cb(h).onIntent({ type: 'tableWidth', id: T, col: C[1], w: 40 })
	await opsAfter(h, 0)
	const before = h.srv.rev
	h.srv.apply([{ o: 'patch', id: T, p: { [`data.cells.${C[1]}.${R[2]}`]: 'long text that wraps a lot in a narrow column' } }])
	h.s.onChanges(h.srv.since(before).items, [])
	h.s.undo()
	const ops = await opsAfter(h, h.tr.calls.length)
	const measured = tableLayout(live(h)).h
	assert.ok(ops.some((op) => op.o === 'patch' && 'h' in op.p), 'w/h written after the undo')
	assert.equal(live(h).h, Math.round(measured * 100) / 100)
})

test('AK4: a locked table, modes view and vote and a frozen board send nothing', async () => {
	const locked = await open({ items: [table({ lock: { by: 'pidbob', name: 'Bob' } })] })
	let n = locked.tr.calls.length
	locked.scene.callbacks.onIntent({ type: 'tableAppend', id: T, axis: 'row' })
	locked.scene.callbacks.onIntent({ type: 'tableWidth', id: T, col: C[0], w: 300 })
	assert.deepEqual(await opsAfter(locked, n), [])
	for (const role of ['view', 'vote']) {
		const h = await open({ me: { ...ALICE, role, mod: false } })
		n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'tableAppend', id: T, axis: 'row' })
		h.s.tableAppend(T, 'col')
		h.s.tableMenuAction('row-delete', T, cell(0, 0))
		assert.deepEqual(await opsAfter(h, n), [], role)
	}
	const frozen = await open()
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.tableAppend(T, 'row')
	frozen.s.tableWidth(T, C[0], 300)
	assert.deepEqual(frozen.tr.calls.slice(n).flatMap((b) => b.ops ?? []), [])
})

test('AK4: no merged patch has more than 50 paths', async () => {
	const h = await open()
	// 61 patches of one path each on one item: the queue merges only up to 50 paths
	h.s.sync.enqueue([{ o: 'patch', id: T, p: { 'style.textColor': '#000000' } }], { urgent: false })
	for (let i = 0; i < 60; i++) {
		h.s.sync.enqueue([{ o: 'patch', id: T, p: { [`style.k${i}`]: i } }], { urgent: false })
	}
	const ops = h.s.replica.queue.map((e) => e.op)
	assert.ok(ops.length >= 2, 'appended behind once 50 paths are reached')
	assert.ok(ops.every((op) => Object.keys(op.p).length <= 50), ops.map((op) => Object.keys(op.p).length).join())
	assert.equal(ops.reduce((sum, op) => sum + Object.keys(op.p).length, 0), 61, 'nothing lost')
})

test('AK4: the menu payload names the table; "Export as CSV" downloads "<title> - Table.csv"', async () => {
	const menus = []
	const h = await open()
	h.s.ui.onContextMenu = (m) => menus.push(m)
	h.s.select([T])
	h.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: cell(1, 1) })
	assert.deepEqual(menus.at(-1).table, { rows: 3, cols: 3, locked: false })
	h.s.menuAction('table-csv')
	assert.deepEqual(h.downloads, [['Work_shop - Table.csv', tableCsv(h.model.get(T))]])
	assert.ok(h.downloads[0][1].startsWith('﻿Name,,\r\n'))
	// a menu on a table that is not the one selected item: no table entries
	h.s.select([T, ID(9)])
	h.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: cell(1, 1) })
	assert.equal(menus.at(-1).table, undefined)
	// a cell of another form: no cell
	h.s.select([T])
	h.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: 'nope' })
	assert.equal(menus.at(-1).table, undefined)
})

test('the row of the open cell goes away (another one deleted it): the editor keeps its text with the notice, nothing goes out for it', async () => {
	const h = await open()
	cb(h).onEditing(T, false, cell(1, 2))
	const before = h.srv.rev
	h.srv.apply([{ o: 'patch', id: T, p: { ['data.rows.' + R[2]]: null } }])
	h.s.onChanges(h.srv.since(before).items, [])
	assert.deepEqual(h.scene.callsOf('setEditorNotice').at(-1), ['setEditorNotice', T, 'Not saved. Copy your text before closing.', cell(1, 2)])
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'text', id: T, path: `data.cells.${C[1]}.${R[2]}`, value: 'lost?', before: '', final: false, cell: cell(1, 2) })
	assert.deepEqual(await opsAfter(h, n), [], 'the lease of the cell is lost: no text')
	// another cell of the same table is a lease of its own
	cb(h).onEditing(null, false)
	cb(h).onEditing(T, false, cell(1, 0))
	cb(h).onIntent({ type: 'text', id: T, path: `data.cells.${C[1]}.${R[0]}`, value: 'ok', before: '', final: true, cell: cell(1, 0) })
	cb(h).onEditing(null, false)
	await opsAfter(h, n)
	assert.equal(live(h).data.cells[C[1]][R[0]], 'ok')
})

// ---- job 174 (AK3): Tab in the last cell, spreadsheet paste ---------------------

/** The text of cell (c, r) by position in the order. */
function textAt(it, c, r) {
	const col = orderedCols(it?.data)[c]?.key
	const row = orderedRows(it?.data)[r]?.key
	return it?.data?.cells?.[col]?.[row] ?? ''
}

/** A stored table with 50 rows and 3 columns. */
function table50() {
	const rows = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['r' + String(i + 1).padStart(8, '0'), { o: 'i' + '0123456789abcdefghijklmnopqrstuvwxyz'[i % 36] + (i >= 36 ? 'g' : '') }]))
	return table({ h: 1800, data: { ...table().data, rows, cells: {} } })
}

test('job 174 AK3: Tab in the last cell gives two undo steps (text, row) and then opens the new row\'s left cell; at 50 rows the hint, no op, no editor', async () => {
	const h = await open()
	const n = h.tr.calls.length
	// the scene: the editor ends with its text, then asks for the row
	cb(h).onEditing(T, false, cell(2, 2))
	cb(h).onIntent({ type: 'text', id: T, path: `data.cells.${C[2]}.${R[2]}`, value: 'x', before: '', final: true, cell: cell(2, 2) })
	cb(h).onEditing(null, false)
	cb(h).onIntent({ type: 'tableAppend', id: T, axis: 'row', open: true })
	const rows = orderedRows(h.model.get(T).data).map((r) => r.key)
	assert.equal(rows.length, 4)
	assert.ok(!R.includes(rows[3]), 'the new row is the last')
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', T, { cell: C[0] + '.' + rows[3] }], 'its left cell opens')
	assert.equal(h.s.undoStack.done.length, 2, 'two undo steps')
	await opsAfter(h, n)
	assert.deepEqual([orderedRows(live(h).data).length, textAt(live(h), 2, 2), live(h).h], [4, 'x', 144])
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([orderedRows(live(h).data).length, textAt(live(h), 2, 2), live(h).h], [3, 'x', 108], 'the first undo takes the row')
	h.s.undo()
	await opsAfter(h, 0)
	assert.equal(textAt(live(h), 2, 2), '', 'the second the text')
	// 50 rows: the hint, no op, no editor
	const full = await open({ items: [table50()] })
	const m = full.tr.calls.length
	const opened = full.scene.callsOf('openTextEditor').length
	full.scene.callbacks.onIntent({ type: 'tableAppend', id: T, axis: 'row', open: true })
	assert.deepEqual(full.infos, [['A table can have at most 50 rows.', 'table-limit']])
	assert.deepEqual(await opsAfter(full, m), [])
	assert.equal(full.scene.callsOf('openTextEditor').length, opened, 'no editor')
})

test('job 174 AK3: a 2 × 5 grid into a new 3 × 3 table at the top left: 5 rows with the texts in one undo step; undo 3 × 3 without them, redo 5 rows; no patch above 50 paths', async () => {
	const h = await open({ items: [] })
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'create', t: 'table', at: { x: 1000, y: 500 }, rect: null })
	const id = h.scene.selection[0]
	const it = h.model.get(id)
	const first = orderedCols(it.data)[0].key + '.' + orderedRows(it.data)[0].key
	// the editor of the top-left cell opens; the paste ends it without a text
	cb(h).onEditing(id, false, first)
	cb(h).onEditing(null, false)
	const grid = [['Name', 'Age'], ['Ann', '31'], ['Bob', '42'], ['Cid', '53'], ['Dan', '64']]
	cb(h).onIntent({ type: 'tablePaste', id, cell: first, grid })
	const texts = (x) => orderedRows(x.data).map((_, r) => [textAt(x, 0, r), textAt(x, 1, r), textAt(x, 2, r)])
	const want = grid.map(([a, b]) => [a, b, ''])
	assert.deepEqual(texts(h.model.get(id)), want)
	assert.equal(h.s.undoStack.done.length, 2, 'the creation and the paste')
	assert.deepEqual(h.scene.selection, [id], 'the table stays selected')
	const ops = await opsAfter(h, n)
	const srv = () => h.srv.live.get(id)
	assert.deepEqual(texts(srv()), want, '5 rows with the texts at the server')
	assert.equal(srv().h, 5 * 36)
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([orderedRows(srv().data).length, srv().data.cells, srv().h], [3, undefined, 108], 'undo: 3 × 3 without the texts')
	h.s.redo()
	await opsAfter(h, 0)
	assert.deepEqual(texts(srv()), want, 'redo: 5 rows again')
	// a 3 × 50 grid from the same cell: several patches, none above 50 paths
	const big = Array.from({ length: 50 }, (_, r) => ['a' + r, 'b' + r, 'c' + r])
	cb(h).onIntent({ type: 'tablePaste', id, cell: first, grid: big })
	await opsAfter(h, 0)
	assert.equal(orderedRows(srv().data).length, 50)
	assert.equal(textAt(srv(), 2, 49), 'c49')
	const all = [...ops, ...h.tr.calls.flatMap((b) => b.ops ?? [])].filter((op) => op.o === 'patch')
	assert.ok(all.length > 0 && all.every((op) => Object.keys(op.p).length <= 50), all.map((op) => Object.keys(op.p).length).join())
	assert.ok(h.tr.calls.every((b) => !b.acks?.res?.includes('bad')))
	assert.ok(checkTable(srv().data))
})

test('job 185 AK3: 2 rows × 5 columns into a new 3 × 3 table at the top left: 5 columns × 3 rows with the texts, no hint, one undo step; undo 3 × 3 without them, redo 5 columns', async () => {
	const h = await open({ items: [] })
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'create', t: 'table', at: { x: 1000, y: 500 }, rect: null })
	const id = h.scene.selection[0]
	const it = h.model.get(id)
	const first = orderedCols(it.data)[0].key + '.' + orderedRows(it.data)[0].key
	cb(h).onEditing(id, false, first)
	cb(h).onEditing(null, false)
	const grid = [['Name', 'Age', 'Team', 'Room', 'Note'], ['Ann', '31', 'A', '12', 'ok']]
	cb(h).onIntent({ type: 'tablePaste', id, cell: first, grid })
	const size = (x) => [orderedCols(x.data).length, orderedRows(x.data).length]
	const texts = (x) => [0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((c) => textAt(x, c, r)))
	const want = [...grid, ['', '', '', '', '']]
	assert.deepEqual([size(h.model.get(id)), texts(h.model.get(id))], [[5, 3], want])
	assert.deepEqual(h.infos, [], 'no hint')
	assert.equal(h.s.undoStack.done.length, 2, 'the creation and the paste')
	await opsAfter(h, n)
	const srv = () => h.srv.live.get(id)
	assert.deepEqual([size(srv()), texts(srv()), srv().w], [[5, 3], want, 800], '5 × 3 with the texts at the server')
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([size(srv()), srv().data.cells, srv().w, srv().h], [[3, 3], undefined, 480, 108], 'undo: 3 × 3 without the texts')
	h.s.redo()
	await opsAfter(h, 0)
	assert.deepEqual([size(srv()), texts(srv())], [[5, 3], want], 'redo: 5 columns with the texts again')
	assert.ok(h.tr.calls.every((b) => !b.acks?.res?.includes('bad')))
	assert.ok(checkTable(srv().data))
})

test('job 174 AK3: the hints with their hooks – cut pastes the rest; held and full send nothing', async () => {
	const h = await open()
	let n = h.tr.calls.length
	// job 185: four cells from the second column add two columns, no hint
	cb(h).onIntent({ type: 'tablePaste', id: T, cell: cell(1, 0), grid: [['a', 'b', 'c', 'd']] })
	assert.deepEqual(h.infos, [], 'it all fits: no hint')
	await opsAfter(h, n)
	assert.equal(orderedCols(live(h).data).length, 5)
	assert.deepEqual([1, 2, 3, 4].map((c) => textAt(live(h), c, 0)), ['a', 'b', 'c', 'd'])
	// 21 columns from the first: cut beyond the 20th, the rest goes in
	n = h.tr.calls.length
	cb(h).onIntent({ type: 'tablePaste', id: T, cell: cell(0, 0), grid: [Array.from({ length: 21 }, (_, i) => 'v' + i)] })
	assert.deepEqual(h.infos, [['Not all pasted cells fit into the table.', 'table-paste-cut']])
	await opsAfter(h, n)
	assert.equal(orderedCols(live(h).data).length, 20)
	assert.deepEqual([textAt(live(h), 0, 0), textAt(live(h), 19, 0)], ['v0', 'v19'], 'the rest goes in')
	assert.ok(checkTable(live(h).data))
	// bob holds cell (1, 1), whose text would change
	h.s.onPresence({ 'pidbob:c1': { n: 'Bob', k: 'pidbob', g: 0, x: 0, y: 0, s: [], d: [], e: T, ec: cell(1, 1), h: 1 } })
	n = h.tr.calls.length
	cb(h).onIntent({ type: 'tablePaste', id: T, cell: cell(0, 0), grid: [['x', 'y'], ['z', 'w']] })
	assert.deepEqual(h.infos.at(-1), ['Someone else is writing in one of these cells.', 'table-paste-held'])
	assert.deepEqual(await opsAfter(h, n), [], 'held: no op')
	// a cell bob holds whose text stays is no hindrance
	cb(h).onIntent({ type: 'tablePaste', id: T, cell: cell(0, 0), grid: [['x', 'y'], ['z', '']] })
	await opsAfter(h, n)
	assert.equal(textAt(live(h), 0, 1), 'z')
	// full
	const small = await open({ limits: { maxItemBytes: tableBytes(table()) + 10 } })
	const m = small.tr.calls.length
	small.scene.callbacks.onIntent({ type: 'tablePaste', id: T, cell: cell(0, 0), grid: [['x'.repeat(40), 'y']] })
	assert.deepEqual(small.infos, [['The table is full.', 'table-full']])
	assert.deepEqual(await opsAfter(small, m), [])
})

test('job 174 AK3: a locked table, modes view and vote and a frozen board send nothing (paste, Tab in the last cell)', async () => {
	const grid = [['x', 'y'], ['z', 'w']]
	const locked = await open({ items: [table({ lock: { by: 'pidbob', name: 'Bob' } })] })
	let n = locked.tr.calls.length
	locked.scene.callbacks.onIntent({ type: 'tablePaste', id: T, cell: cell(0, 0), grid })
	locked.scene.callbacks.onIntent({ type: 'tableAppend', id: T, axis: 'row', open: true })
	assert.deepEqual(await opsAfter(locked, n), [])
	assert.deepEqual(locked.infos, [], 'no hint')
	assert.equal(locked.scene.callsOf('openTextEditor').length, 0)
	for (const role of ['view', 'vote']) {
		const h = await open({ me: { ...ALICE, role, mod: false } })
		n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'tablePaste', id: T, cell: cell(0, 0), grid })
		h.s.tablePaste(T, cell(0, 0), grid)
		h.s.tableAppend(T, 'row', { open: true })
		assert.deepEqual(await opsAfter(h, n), [], role)
		assert.deepEqual(h.infos, [], role + ': no hint')
	}
	const frozen = await open()
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.tablePaste(T, cell(0, 0), grid)
	frozen.s.tableAppend(T, 'row', { open: true })
	assert.deepEqual(frozen.tr.calls.slice(n).flatMap((b) => b.ops ?? []), [])
})

test('job 265 AK6: the header column is one undo step; the bold first column sets the new height in the same patch', async () => {
	const long = 'abcdefghijklmnop'
	const h = await open({ items: [table({ data: { ...table().data, cells: { [C[0]]: { [R[0]]: 'Name', [R[1]]: long } } } })] })
	const n = h.s.undoStack.done.length
	h.s.select([T])
	h.s.setStyle('style.headerCol', 'on')
	const ops = await opsAfter(h, 0)
	const p = ops.find((o) => o.o === 'patch' && o.p['style.headerCol'] === 'on')
	assert.ok(p, 'one patch sets the switch')
	assert.equal(p.p.h, 36 + (2 * 16 * 1.2 + 16) + 36, 'the long word in bold takes two lines')
	assert.equal(h.s.undoStack.done.length, n + 1)
	assert.equal(live(h).style.headerCol, 'on')
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([live(h).style.headerCol ?? 'off', live(h).h], ['off', 108])
})
