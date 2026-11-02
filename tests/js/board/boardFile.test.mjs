/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 181 (AK2, AK3, AK4): board/boardFile.js with the real
 * SceneModel.
 * - AK2 the file of a board with a note (a reaction of "Anna"), a shape
 *   locked by "Bob", a text, a frame with a child, a group of two notes, a
 *   table, a bound connector and one with a free end: kind 'board', the
 *   title, as many items as the model; no name, no pid, no react, no lock,
 *   no board key
 * - AK3 that file pasted into an empty model: the same count, texts,
 *   colours, sizes and relative places, the frame's child, one group of two
 *   notes, the table cells, the connectors at the new items (the free end
 *   moved with the paste), all with new ids and without reactions
 * - AK4 boardFileName: cleaned like exportFileName, no date, ".knorke";
 *   "Board.knorke" without a title; a long title is cut
 * - readBoardFile: the order of the checks (invalid, invalid, full);
 *   validatePayload keeps the clipboard's limits as defaults
 * - job 187 AK1: items that fail the check are left out and counted in
 *   skipped, a file without any item that passes is invalid, full counts
 *   only the items that pass
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pasteItems } from '../../../src/board/actions.js'
import { BOARD_FILE_EXT, BOARD_FILE_MAX_BYTES, boardFileData, boardFileName, boardFileText, readBoardFile } from '../../../src/board/boardFile.js'
import { CLIP_MAX_BYTES, PASTE_MAX, validatePayload } from '../../../src/board/clipboard.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { itemFromPut } from '../../../src/model/paths.js'
import { EXPORT_NAME_MAX, exportFileName } from '../../../src/scene/exportImage.js'
import { ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const ANNA = 'a1b2c3d4e5f60718'
const BOB = 'b0b1b2b3b4b5b6b7'
const N = ID(1)
const S = ID(2)
const T = ID(3)
const F = ID(4)
const C = ID(5)
const G1 = ID(6)
const G2 = ID(7)
const TB = ID(8)
const K1 = ID(9)
const K2 = ID(10)
const GROUP = ID(50)

/** A 2 × 2 table. */
const table = (id, extra = {}) => ({
	id, t: 'table', x: 1400, y: 0, w: 320, h: 72, r: 0, z: 'i7', parent: null,
	data: { cols: { c00000001: { o: 'i0', w: 160 }, c00000002: { o: 'i1', w: 160 } }, rows: { r00000001: { o: 'i0' }, r00000002: { o: 'i1' } }, cells: { c00000001: { r00000001: 'Zelle A1' }, c00000002: { r00000002: 'Zelle B2' } } },
	style: {},
	...extra,
})

/** The board of AK2. */
const ITEMS = Object.freeze([
	frame(F, { x: -900, y: 0, w: 700, h: 500, data: { title: 'Rahmen' }, style: { fill: '#fff4cc' } }),
	sticky(N, { x: 0, y: 0, z: 'i1', data: { text: 'Notiz', react: { ['p' + ANNA]: { e: '1f44d', n: 'Anna' } } }, style: { fill: '#ffd5a8' } }),
	shape(S, { x: 400, y: 0, z: 'i2', data: { kind: 'ellipse', text: 'Form' }, lock: { by: BOB, name: 'Bob' } }),
	textItem(T, { x: 0, y: 400, z: 'i3', data: { text: 'Freier Text' } }),
	sticky(C, { x: 40, y: 60, z: 'i4', parent: F, data: { text: 'Kind' }, style: { fill: '#c9f0c9' } }),
	sticky(G1, { x: 0, y: 800, z: 'i5', group: GROUP, data: { text: 'Gruppe eins' } }),
	sticky(G2, { x: 260, y: 800, z: 'i6', group: GROUP, data: { text: 'Gruppe zwei' } }),
	table(TB),
	connector(K1, { item: N }, { item: S }, { z: 'i8' }),
	connector(K2, { item: T }, { x: 900, y: 700 }, { z: 'i9' }),
])

/** @param {object[]} items WireItems @return {SceneModel} */
function modelOf(items) {
	const m = new SceneModel()
	m.load(structuredClone(items))
	return m
}

/** @param {object} it item @return {string} what tells the items of ITEMS apart */
function signature(it) {
	if (it.t === 'connector') {
		return 'connector'
	}
	if (it.t === 'table') {
		return 'table'
	}
	return it.t + ':' + (it.data?.text ?? it.data?.title ?? '')
}

// ---- AK2: what goes into the file ----------------------------------------------

test('AK2 the file of a board: kind board, the title, as many items as the model; no name, no pid, no react, no lock, no board key', () => {
	const m = modelOf(ITEMS)
	assert.equal(m.get(N).data.react['p' + ANNA].n, 'Anna', 'precondition: the model holds the reaction')
	assert.deepEqual(m.get(S).lock, { by: BOB, name: 'Bob' }, 'precondition: and the lock')
	const text = boardFileText(m, 'Retro: Q3')
	assert.ok(!text.includes('\n'), 'no indentation')
	const f = JSON.parse(text)
	// job 191: and the board's tags
	assert.deepEqual(Object.keys(f), ['knorke', 'kind', 'title', 'origin', 'items', 'tags'])
	assert.equal(f.knorke, 1)
	assert.equal(f.kind, 'board')
	assert.equal(f.title, 'Retro: Q3')
	assert.equal(f.items.length, m.size)
	assert.equal(f.items.length, ITEMS.length)
	for (const word of ['Anna', 'Bob', ANNA, BOB, 'react', 'lock', '"board":']) {
		assert.ok(!text.includes(word), `no ${word} in the file`)
	}
	assert.ok(!('board' in f), 'no board key')
	assert.deepEqual(f.origin, [-900, 0], 'the top left of the roots')
})

test('AK2 the items: stacking order, roots absolute, the child relative to its frame, group per item, the table with cols and rows, both connectors (the free end as it is)', () => {
	const m = modelOf(ITEMS)
	const f = boardFileData(m, 'Retro')
	assert.deepEqual(f.items.map((it) => it.id), m.sortByOrder([...m.ids()]), 'stacking order')
	const by = new Map(f.items.map((it) => [it.id, it]))
	assert.deepEqual([by.get(C).parent, by.get(C).x, by.get(C).y], [F, 40, 60], 'the child relative to its frame')
	assert.deepEqual([by.get(N).parent, by.get(N).x, by.get(N).y], [null, 0, 0])
	assert.equal(by.get(G1).group, GROUP)
	assert.equal(by.get(G2).group, GROUP)
	assert.equal(by.get(N).group, null)
	assert.deepEqual(by.get(TB).data, ITEMS.find((it) => it.id === TB).data, 'the table with cols, rows and cells')
	assert.deepEqual(by.get(K1).data.start, { item: N })
	assert.deepEqual(by.get(K1).data.end, { item: S })
	assert.deepEqual(by.get(K2).data.end, { x: 900, y: 700 }, 'the free end')
	assert.equal(by.get(N).data.text, 'Notiz')
	assert.ok(!('react' in by.get(N).data))
	assert.ok(f.items.every((it) => !('lock' in it) && !('meta' in it)))
})

test('AK2 an empty title is an empty string; a title that is no string too', () => {
	const m = modelOf([sticky(N)])
	assert.equal(boardFileData(m, '').title, '')
	assert.equal(boardFileData(m, null).title, '')
})

// ---- AK3: there and back ---------------------------------------------------------

test('AK3 the file pasted into an empty model: same count, texts, colours, sizes, relative places, the frame child, one group of two, the table cells, the connectors at the new items; new ids, no reactions', () => {
	const src = modelOf(ITEMS)
	const text = boardFileText(src, 'Retro')
	const read = readBoardFile(text)
	assert.equal(read.ok, true)
	assert.equal(read.payload.board, null)
	const dst = new SceneModel()
	const r = pasteItems(dst, read.payload, { at: { x: 5000, y: 3000 }, board: null })
	assert.equal(r.full, false)
	assert.equal(r.skipped, 0)
	dst.apply({ upserts: r.ops.map(itemFromPut) })
	assert.equal(dst.size, ITEMS.length, 'the same count')
	const fresh = [...dst.ids()].map((id) => dst.get(id))
	assert.ok(fresh.every((it) => !src.has(it.id)), 'new ids')
	// old id → new id by what the items are
	const map = new Map()
	for (const old of ITEMS.filter((it) => it.t !== 'connector')) {
		const hit = fresh.filter((it) => signature(it) === signature(old))
		assert.equal(hit.length, 1, signature(old))
		map.set(old.id, hit[0].id)
	}
	// the shift of the paste: the same for every root
	const dx = dst.abs(map.get(N)).x - src.abs(N).x
	const dy = dst.abs(map.get(N)).y - src.abs(N).y
	for (const old of ITEMS.filter((it) => it.t !== 'connector')) {
		const a = src.abs(old.id)
		const b = dst.abs(map.get(old.id))
		const it = dst.get(map.get(old.id))
		assert.deepEqual([b.x - a.x, b.y - a.y, b.w, b.h], [dx, dy, a.w, a.h], signature(old) + ': size and relative place')
		assert.deepEqual(it.style, src.get(old.id).style, signature(old) + ': colours and style')
	}
	// the middle of the roots at the given point
	const roots = ITEMS.filter((it) => it.t !== 'connector' && it.parent === null).map((it) => dst.abs(map.get(it.id)))
	const x0 = Math.min(...roots.map((b) => b.x))
	const x1 = Math.max(...roots.map((b) => b.x + b.w))
	const y0 = Math.min(...roots.map((b) => b.y))
	const y1 = Math.max(...roots.map((b) => b.y + b.h))
	assert.deepEqual([(x0 + x1) / 2, (y0 + y1) / 2], [5000, 3000])
	// texts and the child
	assert.equal(dst.get(map.get(N)).data.text, 'Notiz')
	assert.equal(dst.get(map.get(S)).data.text, 'Form')
	assert.equal(dst.get(map.get(S)).data.kind, 'ellipse')
	assert.equal(dst.get(map.get(T)).data.text, 'Freier Text')
	assert.equal(dst.get(map.get(F)).data.title, 'Rahmen')
	assert.deepEqual([dst.get(map.get(C)).parent, dst.get(map.get(C)).x, dst.get(map.get(C)).y], [map.get(F), 40, 60], 'the child of the new frame, relative')
	// no reactions, no lock
	assert.ok(!('react' in dst.get(map.get(N)).data), 'no reactions')
	assert.equal(dst.get(map.get(S)).lock ?? null, null, 'no lock')
	// one group of two notes, a new id
	const g = dst.get(map.get(G1)).group
	assert.equal(typeof g, 'string')
	assert.notEqual(g, GROUP)
	assert.equal(dst.get(map.get(G2)).group, g)
	assert.deepEqual(fresh.filter((it) => it.group !== null).map((it) => it.id).sort(), [map.get(G1), map.get(G2)].sort())
	// the table cells
	assert.deepEqual(dst.get(map.get(TB)).data, src.get(TB).data)
	// the connectors at the new items, the free end moved with the paste
	const conns = fresh.filter((it) => it.t === 'connector')
	assert.equal(conns.length, 2)
	const k1 = conns.find((it) => it.data.start.item === map.get(N))
	assert.ok(k1, 'the bound connector starts at the new note')
	assert.deepEqual(k1.data.end, { item: map.get(S) })
	const k2 = conns.find((it) => it.data.start.item === map.get(T))
	assert.ok(k2, 'the other connector starts at the new text')
	assert.deepEqual(k2.data.end, { x: 900 + dx, y: 700 + dy })
})

// ---- AK4: the file name -------------------------------------------------------

test('AK4 boardFileName: cleaned like exportFileName, no date, ".knorke"; "Board.knorke" without a title; a long title is cut', () => {
	assert.equal(BOARD_FILE_EXT, 'knorke')
	assert.equal(boardFileName('Retro: Q3/Plan'), 'Retro_ Q3_Plan.knorke')
	assert.equal(boardFileName(''), 'Board.knorke')
	assert.equal(boardFileName('   '), 'Board.knorke')
	assert.equal(boardFileName(null), 'Board.knorke')
	assert.equal(boardFileName('a\\b*c?d"e<f>g|h\u0001i'), 'a_b_c_d_e_f_g_h_i.knorke')
	const long = boardFileName('x'.repeat(300))
	assert.equal(long, 'x'.repeat(EXPORT_NAME_MAX - '.knorke'.length) + '.knorke')
	assert.equal(Array.from(long).length, EXPORT_NAME_MAX)
	assert.equal(Array.from(boardFileName('😀'.repeat(300))).length, EXPORT_NAME_MAX, 'cut by code points')
	// the same cleaning as the image's name, only the date and the extension differ
	assert.equal(exportFileName('Retro: Q3/Plan', new Date(2026, 9, 25)), 'Retro_ Q3_Plan 2026-10-25.png')
})

// ---- readBoardFile: the checks ---------------------------------------------------

/** @param {object} [extra] fields over a valid file of one note @return {string} */
const file = (extra = {}) => JSON.stringify({ knorke: 1, kind: 'board', title: 'B', origin: [0, 0], items: [sticky(N, { data: { text: 'eins' } })], ...extra })

test('readBoardFile: step 1 – no string, no JSON, no object, knorke ≠ 1, kind ≠ board, title no string, items no or an empty list: invalid', () => {
	const invalid = { ok: false, reason: 'invalid' }
	for (const text of [null, undefined, 42, '', 'kein JSON', '[]', 'null', '"text"', '{}',
		file({ knorke: 2 }), file({ knorke: '1' }), file({ kind: undefined }), file({ kind: 'clip' }),
		file({ title: undefined }), file({ title: 7 }), file({ items: undefined }), file({ items: {} }), file({ items: [] })]) {
		assert.deepEqual(readBoardFile(text), invalid, String(text).slice(0, 60))
	}
	assert.equal(readBoardFile(file()).ok, true)
})

test('readBoardFile: more than 16 MiB as UTF-8 is invalid, before anything else (also on a full board)', () => {
	assert.equal(BOARD_FILE_MAX_BYTES, 16 * 1024 * 1024)
	const pad = (n) => file({ title: 'x'.repeat(n) })
	const base = pad(0).length
	assert.equal(readBoardFile(pad(BOARD_FILE_MAX_BYTES - base)).ok, true, 'exactly 16 MiB')
	assert.deepEqual(readBoardFile(pad(BOARD_FILE_MAX_BYTES - base + 1), { size: 10, limits: { maxItems: 10 } }), { ok: false, reason: 'invalid' })
	// "ä" is 2 bytes: fewer characters than bytes
	const umlauts = file({ title: 'ä'.repeat((BOARD_FILE_MAX_BYTES - base) / 2 + 1) })
	assert.ok(umlauts.length < BOARD_FILE_MAX_BYTES)
	assert.deepEqual(readBoardFile(umlauts), { ok: false, reason: 'invalid' })
})

/** @param {string} id item id @return {object} an item of a type this version does not know */
const hologram = (id) => ({ ...sticky(id), t: 'hologram' })

test('job 187 AK1 readBoardFile: two notes, a hologram and a double id give ok with the two notes and skipped 2', () => {
	const r = readBoardFile(file({ items: [sticky(N, { data: { text: 'eins' } }), sticky(S, { data: { text: 'zwei' } }), hologram(T), sticky(N, { data: { text: 'doppelt' } })] }))
	assert.equal(r.ok, true)
	assert.deepEqual(r.payload.items.map((it) => it.data.text), ['eins', 'zwei'])
	assert.equal(r.skipped, 2)
	assert.equal(r.payload.board, null)
	assert.equal(r.title, 'B')
	assert.equal(readBoardFile(file()).skipped, 0, 'a clean file skips nothing')
})

test('job 187 AK1 readBoardFile: step 2 – no item that passes is invalid (only holograms, only broken items); one good item next to them is enough; more than 1000 items are fine', () => {
	const invalid = { ok: false, reason: 'invalid' }
	assert.deepEqual(readBoardFile(file({ items: [hologram(N)] })), invalid, 'one hologram')
	assert.deepEqual(readBoardFile(file({ items: [hologram(N), hologram(S)] })), invalid, 'only holograms')
	assert.deepEqual(readBoardFile(file({ items: [sticky('kein-ulid')] })), invalid, 'no ULID')
	assert.deepEqual(readBoardFile(file({ items: [sticky(N, { w: 1e9 })] })), invalid, 'a size out of range')
	assert.deepEqual(readBoardFile(file({ items: [hologram(N)] }), { size: 10, limits: { maxItems: 10 } }), invalid, 'invalid before full')
	for (const [label, bad] of [['unknown type', hologram(S)], ['double id', sticky(N, { x: 300 })], ['no ULID', sticky('kein-ulid')], ['a size out of range', sticky(S, { w: 1e9 })]]) {
		const r = readBoardFile(file({ items: [sticky(N), bad] }))
		assert.equal(r.ok, true, label)
		assert.deepEqual(r.payload.items.map((it) => [it.id, it.x]), [[N, 0]], label + ': the good note')
		assert.equal(r.skipped, 1, label)
	}
	const many = Array.from({ length: PASTE_MAX + 1 }, (_, i) => sticky(ID(100 + i), { x: i * 10 }))
	const r = readBoardFile(file({ items: many }))
	assert.equal(r.ok, true, 'no item limit of the clipboard')
	assert.equal(r.payload.items.length, PASTE_MAX + 1)
	assert.deepEqual(readBoardFile(file({ board: 7 })).payload.board, null, 'a board key in the file never counts')
	assert.equal(readBoardFile(file()).title, 'B')
})

test('job 187 AK1 readBoardFile: step 3 – size + the items that pass over maxItemsOf(limits): full with max; left-out items do not count', () => {
	const limits = { maxItems: 10 }
	assert.deepEqual(readBoardFile(file(), { size: 10, limits }), { ok: false, reason: 'full', max: 10 })
	assert.equal(readBoardFile(file(), { size: 9, limits }).ok, true)
	const twoAndThree = file({ items: [sticky(ID(20)), sticky(ID(21)), hologram(ID(22)), hologram(ID(23)), hologram(ID(24))] })
	const r = readBoardFile(twoAndThree, { size: 8, limits })
	assert.equal(r.ok, true, '2 good + 3 unknown fit into 8 of 10')
	assert.equal(r.payload.items.length, 2)
	assert.equal(r.skipped, 3)
	const three = file({ items: [sticky(ID(20)), sticky(ID(21)), sticky(ID(22))] })
	assert.deepEqual(readBoardFile(three, { size: 8, limits }), { ok: false, reason: 'full', max: 10 })
})

test('validatePayload: the clipboard\'s limits stay the defaults; maxItems and maxBytes are options', () => {
	const items = (n) => Array.from({ length: n }, (_, i) => sticky(ID(100 + i)))
	assert.deepEqual(validatePayload({ knorke: 1, items: items(PASTE_MAX + 1) }), { ok: false, reason: 'max', count: PASTE_MAX + 1 })
	assert.equal(validatePayload({ knorke: 1, items: items(PASTE_MAX + 1) }, { maxItems: Infinity }).ok, true)
	assert.deepEqual(validatePayload({ knorke: 1, items: items(3) }, { maxItems: 2 }), { ok: false, reason: 'max', count: 3 })
	const big = { knorke: 1, items: [sticky(N, { data: { text: 'x' } })], pad: 'y'.repeat(CLIP_MAX_BYTES) }
	assert.equal(validatePayload(big).reason, 'size', 'over 2 MiB by default')
	assert.equal(validatePayload(big, { maxBytes: BOARD_FILE_MAX_BYTES }).ok, true)
})
