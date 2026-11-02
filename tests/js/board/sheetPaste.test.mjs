/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 218: cells copied from Excel, LibreOffice Calc or Google Sheets
 * and pasted on the board become one note per cell at its row and column:
 * - a grid with a tab or with an HTML table in text/html (a single column)
 * - quoted cells keep their line breaks, tabs and quotes; empty cells keep
 *   their place; one trailing line break goes
 * - at most PASTE_NOTES_MAX (1000) notes in reading order, a message names
 *   the cut; a full board pastes nothing
 * - an HTML table never becomes a mind map; without it an indented list does
 * - 1000 notes are one undo step (BoardSession with a small LWW server)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { NOTE_GRID, PASTE_NOTES_MAX, noteTexts, notesFromText } from '../../../src/board/actions.js'
import { itemFromPut } from '../../../src/model/paths.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, RoutedModel, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const ME = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const TABLE = '<meta charset="utf-8"><table><tr><td>x</td></tr></table>'

/** @return {() => string} ids ID(100), ID(101), … */
function counter() {
	let i = 100
	return () => ID(i++)
}

/** @return {Array<[string, number, number]>} text, column, row */
const cells = (notes) => notes.map((x) => [x.text, x.col, x.row])

/**
 * @param {number} rows rows
 * @param {number} cols columns
 * @return {string} a filled grid as Excel copies it (CRLF, one trailing break)
 */
function sheet(rows, cols) {
	return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join('\t')).join('\r\n') + '\r\n'
}

test('AK1: a grid with a tab: one note per non-empty cell at its column and row; empty cells and rows keep their place; one trailing break goes', () => {
	assert.deepEqual(cells(noteTexts('a\tb\r\n\tc\r\n')), [['a', 0, 0], ['b', 1, 0], ['c', 1, 1]])
	assert.deepEqual(cells(noteTexts('a\n\nb\t')), [['a', 0, 0], ['b', 0, 2]], 'the empty row keeps its place')
	assert.deepEqual(cells(noteTexts('\t\tz\r\n')), [['z', 2, 0]], 'empty leading cells keep their place')
	assert.deepEqual(cells(noteTexts('a\tb\n\n')), [['a', 0, 0], ['b', 1, 0]], 'only one trailing break goes, the empty row makes nothing')
})

test('AK2: quoted cells keep their line break, tab and quotes as one note each', () => {
	const notes = noteTexts('"Zeile 1\nZeile 2"\t"a\tb"\t"sagt ""hi"""\r\nx\ty\tz\r\n')
	assert.deepEqual(cells(notes), [
		['Zeile 1\nZeile 2', 0, 0], ['a\tb', 1, 0], ['sagt "hi"', 2, 0],
		['x', 0, 1], ['y', 1, 1], ['z', 2, 1],
	])
	assert.deepEqual(cells(noteTexts('"Zeile 1\r\nZeile 2"\tq\r\n')), [['Zeile 1\nZeile 2', 0, 0], ['q', 1, 0]], 'CRLF inside a cell is LF')
})

test('AK3: a single column with an HTML table stays one column; without it the square grid of today', () => {
	const html = '<table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr><tr><td>D</td></tr></table>'
	assert.deepEqual(cells(noteTexts('A\nB\nC\nD\n', { html })), [['A', 0, 0], ['B', 0, 1], ['C', 0, 2], ['D', 0, 3]])
	assert.deepEqual(cells(noteTexts('A\nB\nC\nD\n')), [['A', 0, 0], ['B', 1, 0], ['C', 0, 1], ['D', 1, 1]], 'plain lines: 2 × 2')
	assert.deepEqual(cells(noteTexts('"x\ny"\nz\n', { html: TABLE })), [['x\ny', 0, 0], ['z', 0, 1]], 'a quoted cell with a break is one note')
	assert.deepEqual(cells(noteTexts('A\n\nC\r\n', { html: TABLE })), [['A', 0, 0], ['C', 0, 2]], 'an empty cell in the column keeps its place')
	assert.deepEqual(cells(noteTexts('A\nB', { html: '<tablet>' })), [['A', 0, 0], ['B', 1, 0]], 'only the element table counts')
})

test('AK5: at most 1000 notes in reading order, cut: true; exactly 1000: cut false; a full board: nothing', () => {
	assert.equal(PASTE_NOTES_MAX, 1000)
	const m = new FakeModel([])
	const r = notesFromText(m, sheet(40, 30), { at: { x: 0, y: 0 } }, counter())
	assert.equal(r.ops.length, 1000)
	assert.equal(r.count, 1000)
	assert.equal(r.cut, true)
	const texts = r.ops.map((o) => o.p.data.text)
	assert.equal(texts[989], 'r32c29', 'rows 0–32 complete')
	assert.equal(texts[999], 'r33c9', 'row 33 up to column 9')
	assert.equal(texts.includes('r33c10'), false)
	assert.deepEqual(r.inverse.length, 1000)
	const x0 = r.ops[0].p.x
	assert.equal(r.ops[1].p.x - x0, NOTE_GRID, 'column by column')
	assert.equal(r.ops[30].p.y - r.ops[0].p.y, NOTE_GRID, 'row by row')
	const exact = notesFromText(m, sheet(25, 40), { at: { x: 0, y: 0 } }, counter())
	assert.deepEqual([exact.ops.length, exact.cut], [1000, false])
	const full = notesFromText(new FakeModel([]), sheet(40, 30), { at: { x: 0, y: 0 }, limits: { maxItems: 999 } }, counter())
	assert.deepEqual(full, { ops: [], inverse: [], selectIds: [], count: 1000, full: true })
	// plain lines are cut, too
	const lines = noteTexts(Array.from({ length: 1500 }, (_, i) => 'l' + i).join('\n'), { max: PASTE_NOTES_MAX })
	assert.equal(lines.length, 1000)
	assert.equal(lines[999].text, 'l999')
	assert.equal(noteTexts(sheet(40, 30), { max: 7 }).length, 7)
})

test('risk: 100 000 cells (≈ 1 MB) are read quickly, the work stops after the cap', () => {
	const big = sheet(10000, 10)
	const t0 = performance.now()
	const r = notesFromText(new FakeModel([]), big, { at: { x: 0, y: 0 } }, counter())
	const ms = performance.now() - t0
	assert.equal(r.ops.length, 1000)
	assert.ok(ms < 1500, `took ${ms} ms`)
})

/** LWW server for notes: applies puts and removes, answers with every item changed since the cursor. */
function lwwServer() {
	const srv = { live: new Map(), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) return 'dup'
			if (srv.dead.has(op.id) && op.revive !== true) return 'gone'
			srv.live.set(op.id, itemFromPut(op))
			srv.dead.delete(op.id)
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
	srv.since = (rev) => {
		const ids = new Set(srv.changed.filter(([r]) => r > rev).map(([, id]) => id))
		return { items: [...ids].filter((id) => srv.live.has(id)).map((id) => structuredClone(srv.live.get(id))), removed: [...ids].filter((id) => !srv.live.has(id)) }
	}
	srv.apply = (ops) => ops.map(apply)
	return srv
}

async function open({ answer = true } = {}) {
	const clock = new FakeClock(10000)
	const toasts = []
	const asked = []
	const srv = lwwServer()
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Retro', role: ME.role, metaRev: 3, meta: {} }, me: ME, items: [] }
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
		limits: null,
		ui: {
			onConfirm: (q) => {
				asked.push(q.name)
				return Promise.resolve(answer)
			},
		},
		deps: {
			SceneModel: RoutedModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m) => toasts.push(m),
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, srv, toasts, asked, model: s.model }
}

/** Lets the confirm promise and every batch of the sync go through. */
async function settle(h) {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve()
	}
	for (let i = 0; i < 20; i++) {
		await h.clock.advance(200)
	}
}

test('AK6: 1200 cells from a spreadsheet: asked for 1000, one commit of 1000 puts, a message names the cut; one undo step removes all, redo brings them back', async () => {
	const h = await open()
	h.s.pasteData({ text: sheet(40, 30), html: TABLE }, { inPlace: false })
	await settle(h)
	assert.deepEqual(h.asked, ['Paste 1000 notes?'])
	assert.equal(h.model.size, 1000)
	assert.equal(h.srv.live.size, 1000, 'all 1000 reached the server (in batches of at most 200)')
	assert.ok(h.tr.calls.every((b) => (b.ops ?? []).length <= 200))
	assert.deepEqual(h.toasts, ['Only the first 1000 notes were pasted.'])
	h.s.undo()
	await settle(h)
	assert.equal(h.model.size, 0, 'one undo step')
	assert.equal(h.srv.live.size, 0)
	h.s.redo()
	await settle(h)
	assert.equal(h.model.size, 1000)
	assert.equal(h.srv.live.size, 1000)
	h.s.destroy()
})

test('AK6: declined: nothing; a grid that looks like an indented list is notes with an HTML table, a mind map without', async () => {
	const no = await open({ answer: false })
	no.s.pasteData({ text: sheet(40, 30), html: TABLE }, { inPlace: false })
	await settle(no)
	assert.equal(no.model.size, 0)
	assert.deepEqual(no.toasts, [])
	no.s.destroy()
	const h = await open()
	h.s.pasteData({ text: 'A1\n\tB2\n\tB3\n', html: TABLE }, { inPlace: false })
	await settle(h)
	const items = [...h.srv.live.values()]
	assert.deepEqual(items.map((it) => it.t), ['sticky', 'sticky', 'sticky'])
	assert.deepEqual(items.map((it) => it.data.text), ['A1', 'B2', 'B3'])
	const [a1, b2, b3] = items
	assert.deepEqual([b2.x - a1.x, b2.y - a1.y, b3.y - b2.y], [NOTE_GRID, NOTE_GRID, NOTE_GRID], 'at their column and row')
	assert.deepEqual(h.toasts, [], 'no cut, no message')
	h.s.destroy()
	const plain = await open()
	plain.s.pasteData({ text: 'A1\n\tB2\n\tB3\n' }, { inPlace: false })
	await settle(plain)
	assert.deepEqual([...plain.srv.live.values()].map((it) => it.t), ['mindmap'], 'without an HTML table: a mind map as before')
	plain.s.destroy()
})
