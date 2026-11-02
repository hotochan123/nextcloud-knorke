/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 220: a CSV file becomes notes like cells from a spreadsheet:
 * - readCsvFile: the encoding from a BOM, else strict UTF-8, else
 *   windows-1252; .xlsx/.ods/.xls are spreadsheets, a text with U+0000 or
 *   null is invalid
 * - detectSeparator: tab, ';' or ',' (quotes respected, the most records
 *   alike win)
 * - noteTexts/splitGrid with sep
 * - BoardSession.insertCsvFile: one commit at the viewport centre, the
 *   question above 100 notes, the toasts, nothing outside mode edit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { NOTE_GRID, noteTexts } from '../../../src/board/actions.js'
import { CSV_FILE_MAX_BYTES } from '../../../src/board/boardFile.js'
import { SNIFF_CHARS, detectSeparator, readCsvFile } from '../../../src/board/csvFile.js'
import { splitGrid } from '../../../src/model/table.js'
import { itemFromPut } from '../../../src/model/paths.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, RoutedModel, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const OWNER = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { ...OWNER, pid: 'pidbob0000000001', name: 'Bob', role: 'view', mod: false }

const enc = (s) => new TextEncoder().encode(s)
const bytes = (...xs) => new Uint8Array(xs.flat())
/** @return {Uint8Array} s as UTF-16 (little or big endian) with its BOM */
function utf16(s, little) {
	const out = [little ? 0xff : 0xfe, little ? 0xfe : 0xff]
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		out.push(...(little ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]))
	}
	return new Uint8Array(out)
}
/** @return {Uint8Array} s in windows-1252 (Latin-1 range only) */
const cp1252 = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
const cells = (notes) => notes.map((x) => [x.text, x.col, x.row])

test('AK2: the same table as UTF-8, UTF-8 with BOM, UTF-16LE/BE with BOM and windows-1252 reads as "Größe;Maß", without the BOM', () => {
	const text = 'Größe;Maß\r\n1;2\r\n'
	const files = {
		'utf-8': enc(text),
		'utf-8 BOM': bytes([0xef, 0xbb, 0xbf], [...enc(text)]),
		'utf-16le': utf16(text, true),
		'utf-16be': utf16(text, false),
		'windows-1252': cp1252(text),
	}
	assert.deepEqual([...cp1252('öß')], [0xf6, 0xdf])
	for (const [name, b] of Object.entries(files)) {
		const r = readCsvFile(b)
		assert.equal(r.ok, true, name)
		assert.equal(r.text, text, name)
		assert.equal(r.sep, ';', name)
	}
	assert.equal(readCsvFile(files['utf-8'].buffer).text, text, 'an ArrayBuffer too')
	assert.equal(readCsvFile(cp1252('Äpfel;Öl')).text, 'Äpfel;Öl')
	assert.equal(readCsvFile(new Uint8Array([0x80])).text, '€', 'Excel\'s euro sign in windows-1252')
})

test('AK3: .xlsx/.ods (ZIP) and .xls (OLE) are spreadsheets; a picture, null and a text with U+0000 are invalid', () => {
	assert.deepEqual(readCsvFile(bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0])), { ok: false, error: 'spreadsheet' })
	assert.deepEqual(readCsvFile(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), { ok: false, error: 'spreadsheet' })
	assert.deepEqual(readCsvFile(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])), { ok: false, error: 'invalid' }, 'PNG')
	assert.deepEqual(readCsvFile(null), { ok: false, error: 'invalid' }, 'a file over CSV_FILE_MAX_BYTES')
	assert.deepEqual(readCsvFile('a;b'), { ok: false, error: 'invalid' }, 'no bytes')
	assert.deepEqual(readCsvFile(bytes([0x61, 0, 0x62, 0])), { ok: false, error: 'invalid' }, 'UTF-16 without BOM')
	assert.equal(readCsvFile(bytes([0x50, 0x4b])).ok, true, 'two bytes are no ZIP')
	assert.equal(CSV_FILE_MAX_BYTES, 16 * 1024 * 1024)
})

test('AK4: the separator: tab, ";" or ","; quotes respected; the most records alike win; none: the tab', () => {
	assert.equal(detectSeparator('a\tb'), '\t')
	assert.equal(detectSeparator('Name;Preis\nApfel;3,5\nBirne;2,0'), ';')
	assert.equal(detectSeparator('a,b\nc,d'), ',')
	assert.equal(detectSeparator('"Smith; John",42\n"Doe; Jane",7'), ',')
	assert.equal(detectSeparator('Artikel;Preis (€, brutto)\nA;3\nB;4'), ';')
	assert.equal(detectSeparator('eins\nzwei'), '\t')
	assert.equal(detectSeparator(''), '\t')
	assert.equal(detectSeparator('"x\ny;z",1\n"p",2'), ',', 'a quoted line break stays in its record')
	assert.equal(detectSeparator('a;b,c\n1;2\n3;4'), ';', 'the most records alike')
	assert.equal(detectSeparator('a,b;c;d\n'), ';', 'a tie: more in the first record')
	assert.equal(detectSeparator('\r\n\r\na,b\r\n'), ',', 'empty records do not count')
	assert.equal(detectSeparator('"Hi" she said,x\n"b",y'), ',', 'a lone quote closes')
	// only the start is looked at
	assert.equal(detectSeparator('a;b\n'.repeat(20) + 'c,d,e,f\n'.repeat(100)), ';')
	assert.equal(detectSeparator('x'.repeat(SNIFF_CHARS) + ',;;'), '\t', 'beyond SNIFF_CHARS nothing counts')
})

test('AK5: noteTexts and splitGrid with sep: quoted fields keep the separator and quotes; empty cells keep their place', () => {
	assert.deepEqual(cells(noteTexts('a;"x;y";"sagt ""hi"""\r\n;b\r\n', { sep: ';' })), [['a', 0, 0], ['x;y', 1, 0], ['sagt "hi"', 2, 0], ['b', 1, 1]])
	assert.deepEqual(splitGrid('"Hallo" sagte sie,X\n"b",Y', ','), [['"Hallo" sagte sie', 'X'], ['b', 'Y']])
	assert.deepEqual(splitGrid('a\tb,c', ','), [['a\tb', 'c']], 'a tab is text in a comma file')
	assert.deepEqual(cells(noteTexts('eins\nzwei\ndrei\n', { sep: '\t' })), [['eins', 0, 0], ['zwei', 0, 1], ['drei', 0, 2]], 'one column stays a column')
	assert.deepEqual(cells(noteTexts('"Zeile 1\nZeile 2",x\n', { sep: ',' })), [['Zeile 1\nZeile 2', 0, 0], ['x', 1, 0]])
	assert.deepEqual(splitGrid('a\tb\nc'), [['a', 'b'], ['c']], 'the tab by default')
})

test('risk: a CSV of 16 MiB is cut after 1000 notes without splitting the rest', () => {
	const row = Array.from({ length: 10 }, (_, i) => 'c' + i).join(';') + '\r\n'
	const big = row.repeat(Math.ceil((16 * 1024 * 1024) / row.length))
	const t0 = performance.now()
	const r = readCsvFile(enc(big))
	const notes = noteTexts(r.text, { sep: r.sep, max: 1001 })
	const ms = performance.now() - t0
	assert.equal(r.sep, ';')
	assert.equal(notes.length, 1001)
	assert.ok(ms < 3000, `took ${ms} ms`)
})

// ---- the session -------------------------------------------------------------

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

async function open({ answer = true, me = OWNER, parts = undefined } = {}) {
	const clock = new FakeClock(10000)
	const toasts = []
	const asked = []
	const srv = lwwServer()
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Retro', role: me.role, metaRev: 3, meta: {} }, me, items: [] }
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
				asked.push([q.name, q.confirmLabel])
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
			toast: (m, o) => toasts.push([m, o?.hook ?? null]),
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
			...(parts ? { parts } : {}),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, srv, toasts, asked, model: s.model }
}

/** Lets every batch of the sync go through. */
async function settle(h) {
	for (let i = 0; i < 20; i++) {
		await h.clock.advance(200)
	}
}

/** @return {string} rows × cols filled cells, ';' and CRLF as Excel writes them */
function sheet(rows, cols) {
	return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(';')).join('\r\n') + '\r\n'
}

test('AK6: a windows-1252 file "Ä;B / C;" is three notes at their cells, one commit, selected, around the viewport centre; undo removes them', async () => {
	const h = await open()
	const centre = h.s.viewportCenter()
	assert.equal(await h.s.insertCsvFile(cp1252('Ä;B\r\nC;\r\n')), true)
	await settle(h)
	const items = [...h.model.items.values()].filter((it) => it.t === 'sticky')
	assert.deepEqual(items.map((it) => it.data.text), ['Ä', 'B', 'C'])
	const [a, b, c] = items
	assert.deepEqual([b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y], [NOTE_GRID, 0, 0, NOTE_GRID], 'at their column and row')
	const x0 = Math.min(...items.map((it) => it.x))
	const x1 = Math.max(...items.map((it) => it.x + it.w))
	const y0 = Math.min(...items.map((it) => it.y))
	const y1 = Math.max(...items.map((it) => it.y + it.h))
	assert.ok(Math.abs((x0 + x1) / 2 - centre.x) < 1 && Math.abs((y0 + y1) / 2 - centre.y) < 1, 'centred in the view')
	assert.deepEqual([...h.s.selection].sort(), items.map((it) => it.id).sort())
	assert.equal(h.tr.calls.filter((b) => (b.ops ?? []).length > 0).length, 1, 'one commit')
	assert.equal(h.srv.live.size, 3)
	assert.deepEqual(h.toasts, [])
	assert.deepEqual(h.asked, [])
	h.s.undo()
	await settle(h)
	assert.equal(h.model.size, 0, 'one undo step')
	assert.equal(h.srv.live.size, 0)
	h.s.destroy()
})

test('AK6: 1200 cells: asked "Insert 1000 notes?", 1000 puts and the toast csv-file-cut; declined: no op', async () => {
	const h = await open()
	assert.equal(await h.s.insertCsvFile(enc(sheet(40, 30))), true)
	await settle(h)
	assert.deepEqual(h.asked, [['Insert 1000 notes?', 'Insert']])
	assert.equal(h.model.size, 1000)
	assert.equal(h.srv.live.size, 1000)
	assert.deepEqual(h.toasts, [['Only the first 1000 notes were inserted.', 'csv-file-cut']])
	h.s.undo()
	await settle(h)
	assert.equal(h.model.size, 0)
	h.s.destroy()
	const no = await open({ answer: false })
	assert.equal(await no.s.insertCsvFile(enc(sheet(40, 30))), false)
	await settle(no)
	assert.equal(no.model.size, 0)
	assert.equal(no.tr.calls.filter((b) => (b.ops ?? []).length > 0).length, 0)
	assert.deepEqual(no.toasts, [])
	no.s.destroy()
})

test('AK6: a spreadsheet, null and an empty file: their toast, no op', async () => {
	const h = await open()
	assert.equal(await h.s.insertCsvFile(bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0])), false)
	assert.equal(await h.s.insertCsvFile(null), false)
	assert.equal(await h.s.insertCsvFile(enc('\r\n \r\n')), false)
	await settle(h)
	assert.deepEqual(h.toasts.map((x) => x[1]), ['csv-file-spreadsheet', 'csv-file-invalid', 'csv-file-empty'])
	assert.deepEqual(h.toasts[0][0], 'Excel and OpenDocument files can\'t be read here. Save the table as CSV first.')
	assert.equal(h.model.size, 0)
	assert.equal(h.tr.calls.filter((b) => (b.ops ?? []).length > 0).length, 0)
	h.s.destroy()
})

test('AK6: nothing in mode view or on a frozen board: false, no toast, no op, the part is not loaded', async () => {
	let loads = 0
	const parts = { csv: async () => { loads++; return import('../../../src/board/csvFile.js') } }
	const view = await open({ me: VIEWER, parts })
	const frozen = await open({ parts })
	frozen.s.onStatus('gone')
	assert.equal(frozen.s.frozen, true)
	for (const h of [view, frozen]) {
		assert.equal(await h.s.insertCsvFile(enc('a;b\r\n')), false)
		await settle(h)
		assert.deepEqual(h.toasts, [])
		assert.equal(h.model.size, 0)
		assert.equal(h.tr.calls.filter((b) => (b.ops ?? []).length > 0).length, 0)
		h.s.destroy()
	}
	assert.equal(loads, 0)
})

test('AK6: the part does not load: only part-load-failed, false', async () => {
	const parts = { csv: async () => { throw new TypeError('Failed to fetch dynamically imported module') } }
	const h = await open({ parts })
	assert.equal(await h.s.insertCsvFile(enc('a;b\r\n')), false)
	assert.deepEqual(h.toasts.map((x) => x[1]), ['part-load-failed'])
	assert.equal(h.model.size, 0)
	h.s.destroy()
})
