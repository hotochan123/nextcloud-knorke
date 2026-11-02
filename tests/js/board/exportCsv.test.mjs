/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 179 "Save as CSV", the pure part (board/exportCsv.js) on the
 * real SceneModel:
 * - AK1 rows and order: the frames in reading order ("Links" before
 *   "Rechts", whatever the stacking order), in each one reading order (the
 *   right note 5 units higher stays in the first row), then the loose items;
 *   an empty note has a row, a shape without text, a connector and the
 *   frames have none; the selection "Rechts" gives its three notes
 * - AK2 columns: colour names (a note's fill, a shape's stroke without
 *   fill, a custom colour by its nearest palette colour since job 186, a
 *   table empty), the frame title, the reactions without names, a table's
 *   cells, the votes of the last finished vote (show false and true) and
 *   none while open, without a vote and after "Close results"
 * - AK3 (job 227: the 13 colours of the one palette) every colour has its own name, in
 *   l10n/de.json
 * - AK4 BOM, CRLF, the separator, formulas defused (frame titles too)
 *
 * Factory job 186:
 * - AK1 colorName: the 27 palette colours keep their names of job 179,
 *   every other #rrggbb gets the name of the nearest one (CIE76 in CIELAB),
 *   never a hex code; no colour → ''
 * - AK2 "0" votes after a finished vote for every item that could get
 *   votes in it (type in cfg.types, in cfg.scope), only with a complete
 *   ranking; tables, other types, items outside the scope stay empty
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readingOrder } from '../../../src/board/actions.js'
import { CSV_TYPES, boardCsv, closedVotes, csvHeader, csvRowIds, csvRows, hasCsvRow } from '../../../src/board/exportCsv.js'
import { VoteState } from '../../../src/board/votes.js'
import { NAMED_COLORS, colorName } from '../../../src/components/labels.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { LIGHT, PALETTE, SHAPE_PALETTE, STICKY_COLORS, STRONG_COLORED, shownColor } from '../../../src/model/tokens.js'
import { exportIds } from '../../../src/scene/exportImage.js'
import { ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations

/** @param {object[]} items @return {SceneModel} */
function modelOf(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

/**
 * A table with the cells by row, each row in column order (keys c0000000<n>, r0000000<n>).
 *
 * @param {string} id item id
 * @param {string[][]} grid rows of cell texts ('' = empty)
 * @param {object} [extra] fields
 * @return {object} table WireItem
 */
function table(id, grid, extra = {}) {
	const cols = {}
	const rows = {}
	const cells = {}
	grid.forEach((row, r) => {
		rows['r0000000' + (r + 1)] = { o: 'i' + r }
		row.forEach((text, c) => {
			const ck = 'c0000000' + (c + 1)
			cols[ck] = { o: 'i' + c, w: 160 }
			if (text !== '') {
				cells[ck] = { ...(cells[ck] ?? {}), ['r0000000' + (r + 1)]: text }
			}
		})
	})
	return { id, t: 'table', x: 0, y: 0, w: 160 * grid[0].length, h: 36 * grid.length, r: 0, z: 'i0', parent: null, data: { cols, rows, cells }, style: {}, ...extra }
}

/** @param {Array<[string, number]>} list [emoji (hex), count] @return {object} data.react of that many people, named Person 1…n */
function reacts(list) {
	const out = {}
	let i = 0
	for (const [e, count] of list) {
		for (let k = 0; k < count; k++, i++) {
			out['p' + String(i + 1).padStart(16, '0')] = { e, n: 'Person ' + (i + 1) }
		}
	}
	return out
}

const LINKS = ID('FL')
const RECHTS = ID('FR')
const [L1, L2, L3, R1, R2, R3] = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'].map((n) => ID(n))
const EMPTY = ID('E1')
const BARE = ID('S0')
const WORD = ID('S1')
const TABLE = ID('T1')
const LINE = ID('K1')

/**
 * The board of AK1: frame "Rechts" right of frame "Links" (but lower in the
 * stack), in each two notes side by side, the right one 5 units higher, one
 * below them; loose: an empty note, a shape without text, a shape with
 * text, a table, a connector L1 → R1. The stacking order inside the frames
 * runs against the reading order.
 */
function ak1() {
	return modelOf([
		frame(RECHTS, { x: 1000, y: 0, w: 800, h: 600, z: 'a0', data: { title: 'Rechts' } }),
		frame(LINKS, { x: 0, y: 0, w: 800, h: 600, z: 'a1', data: { title: 'Links' } }),
		sticky(L3, { x: 40, y: 320, parent: LINKS, z: 'i1', data: { text: 'links unten' } }),
		sticky(L2, { x: 300, y: 55, parent: LINKS, z: 'i2', data: { text: 'links rechts' } }),
		sticky(L1, { x: 40, y: 60, parent: LINKS, z: 'i3', data: { text: 'links links' } }),
		sticky(R3, { x: 40, y: 320, parent: RECHTS, z: 'i4', data: { text: 'rechts unten' } }),
		sticky(R2, { x: 300, y: 55, parent: RECHTS, z: 'i5', data: { text: 'rechts rechts' } }),
		sticky(R1, { x: 40, y: 60, parent: RECHTS, z: 'i6', data: { text: 'rechts links' } }),
		table(TABLE, [['a', 'b']], { x: 0, y: 1100, z: 'i7' }),
		shape(WORD, { x: 600, y: 800, z: 'i8', data: { kind: 'rect', text: 'Idee' } }),
		shape(BARE, { x: 300, y: 800, z: 'i9', data: { kind: 'rect', text: '  \n ' } }),
		sticky(EMPTY, { x: 0, y: 800, z: 'j0' }),
		connector(LINE, { item: L1 }, { item: R1 }, { z: 'j1' }),
	])
}

/** @param {string} csv file @return {string[][]} its rows split at "," (only for the plain fields of these tests) */
const cells = (csv) => csv.replace(/^﻿/, '').split('\r\n').slice(0, -1).map((l) => l.split(','))

test('AK1 rows and order: header, "Links" (left, right, below), "Rechts", then the loose items; an empty note has a row, no shape without text, connector or frame', () => {
	const m = ak1()
	const ids = exportIds(m, null)
	assert.deepEqual(csvRowIds(m, ids), [L1, L2, L3, R1, R2, R3, EMPTY, WORD, TABLE])
	const csv = boardCsv(csvRows(m, ids))
	const lines = cells(csv)
	// job 191: Tags is the last column
	assert.deepEqual(lines[0], ['Type', 'Text', 'Color', 'Frame', 'Reactions', 'Votes', 'Tags'])
	assert.deepEqual(lines.slice(1).map((r) => r.slice(0, 2)), [
		['Note', 'links links'], ['Note', 'links rechts'], ['Note', 'links unten'],
		['Note', 'rechts links'], ['Note', 'rechts rechts'], ['Note', 'rechts unten'],
		['Note', ''], ['Shape', 'Idee'], ['Table', 'a | b'],
	])
	assert.deepEqual(lines.slice(1).map((r) => r[3]), ['Links', 'Links', 'Links', 'Rechts', 'Rechts', 'Rechts', '', '', ''])
	for (const id of [BARE, LINE, LINKS, RECHTS]) {
		assert.equal(hasCsvRow(m.get(id)), false, id)
	}
	assert.deepEqual(CSV_TYPES, ['sticky', 'text', 'shape', 'table', 'ai'])
	assert.equal(hasCsvRow({ t: 'later', data: { text: 'x' } }), false, 'an unknown type')
})

test('AK1 the selection "Rechts" gives only its three notes; a selection of loose items keeps the reading order', () => {
	const m = ak1()
	assert.deepEqual(csvRowIds(m, exportIds(m, [RECHTS])), [R1, R2, R3])
	assert.deepEqual(csvRowIds(m, exportIds(m, [TABLE, WORD, EMPTY, BARE])), [EMPTY, WORD, TABLE])
	assert.deepEqual(csvRowIds(m, exportIds(m, [R3, L1])), [L1, R3], 'notes of two frames: by frame')
	assert.deepEqual(csvRows(m, exportIds(m, [LINE, BARE])), [], 'nothing with a row')
})

test('AK1 readingOrder: rows as "Tidy up", in a row by the centre x, ties in the given order; ids without a box last', () => {
	const m = ak1()
	assert.deepEqual(readingOrder(m, [L3, L2, L1]), [L1, L2, L3])
	assert.deepEqual(readingOrder(m, [RECHTS, LINKS]), [LINKS, RECHTS])
	const twins = modelOf([sticky(ID(1), { x: 0, y: 0, z: 'i1' }), sticky(ID(2), { x: 0, y: 0, z: 'i0' })])
	assert.deepEqual(readingOrder(twins, [ID(1), ID(2)]), [ID(1), ID(2)])
	assert.deepEqual(readingOrder(twins, [ID(2), ID(1)]), [ID(2), ID(1)])
	assert.deepEqual(csvRowIds(twins, [ID(1), ID(2)]), [ID(2), ID(1)], 'the CSV: ties in stacking order')
	assert.deepEqual(readingOrder(twins, ['missing', ID(1)]), [ID(1), 'missing'])
})

test('AK2 colours: palette names, a shape without fill by its border, a custom colour by its nearest palette colour (job 186), a table empty; a text item by its colour', () => {
	const N = ID(1)
	const m = modelOf([
		sticky(N, { x: 0, y: 0, style: { fill: '#A8D8F8' } }),
		shape(ID(2), { x: 300, y: 0, data: { kind: 'rect', text: 'Rand' }, style: { fill: '#ffffff', fillOpacity: 0, stroke: '#e03131' } }),
		shape(ID(3), { x: 600, y: 0, data: { kind: 'rect', text: 'Voll' }, style: { fill: '#f08c00', fillOpacity: 50, stroke: '#e03131' } }),
		sticky(ID(4), { x: 900, y: 0, style: { fill: '#123456' } }),
		table(ID(5), [['x']], { x: 1200, y: 0 }),
		textItem(ID(6), { x: 1500, y: 0, data: { text: 'Titel' }, style: { fontSize: 24, color: '#2f9e44', align: 'left' } }),
		sticky(ID(7), { x: 1800, y: 0, style: {} }),
	])
	const rows = csvRows(m, exportIds(m, null))
	assert.deepEqual(rows.map((r) => [r[0], r[2]]), [
		['Note', 'Light blue'], ['Shape', 'Coral'], ['Shape', 'Orange'], ['Note', 'Black'], ['Table', ''], ['Text', 'Sage'], ['Note', 'Light blue'],
	], 'the last note has no fill: the default; (job 227) old palette colours by the name of their new tone')
})

test('AK2 the frame title, the reactions without names, a table\'s cells row by row with empty cells', () => {
	const F = ID('F1')
	const N = ID(1)
	const m = modelOf([
		frame(F, { x: 0, y: 0, w: 1000, h: 600, data: { title: 'Ideen' } }),
		sticky(N, { x: 20, y: 40, parent: F, data: { text: 'Pizza', react: reacts([['1f389', 1], ['1f44d', 3]]) } }),
		shape(ID(2), { x: 300, y: 40, parent: F, data: { kind: 'rect', text: 'Form', react: reacts([['1f44d', 1]]) } }),
		table(ID(3), [['a', ''], ['c', 'd']], { x: 0, y: 900 }),
	])
	const rows = csvRows(m, exportIds(m, null))
	assert.deepEqual(rows[0], ['Note', 'Pizza', 'Light blue', 'Ideen', '👍 3, 🎉 1', '', ''])
	assert.equal(rows[1][4], '', 'reactions only for notes')
	assert.equal(rows[1][3], 'Ideen')
	assert.deepEqual(rows[2], ['Table', 'a |  | c | d', '', '', '', '', ''])
	const csv = boardCsv(rows)
	assert.doesNotMatch(csv, /Person/, 'no name of a reacting person')
})

test('AK2 votes: the totals of a finished vote (show false and true), "0" for the other note (job 186); empty while open, without a vote and after "Close results"', () => {
	const N = ID(1)
	const O = ID(2)
	const m = modelOf([sticky(N, { x: 0, y: 0 }), sticky(O, { x: 300, y: 0 })])
	const ids = exportIds(m, null)
	const meta = { sid: 3, state: 'open', cfg: { per: 5, perItem: 2, scope: null, types: ['sticky'] }, startedAt: 1, endsAt: null, by: 'Alice', show: false }
	const v = new VoteState()
	const votesCol = () => csvRows(m, ids, closedVotes(v)).map((r) => r[5])
	assert.deepEqual(votesCol(), ['', ''], 'no vote')
	v.setSession(meta)
	assert.equal(closedVotes(v), null)
	assert.deepEqual(votesCol(), ['', ''], 'open')
	for (const show of [false, true]) {
		v.setSession({ ...meta, state: 'closed', results: [[N, 4]], total: 1, voters: 2, closedAt: 9, show })
		assert.deepEqual(votesCol(), ['4', '0'], 'closed, show ' + show)
	}
	v.setSession(undefined)
	assert.deepEqual(votesCol(), ['', ''], 'after "Close results" (meta.vote gone)')
	assert.equal(closedVotes(null), null)
})

test('AK3 (job 227) the 13 colours of the one palette have 13 distinct names, each in l10n/de.json; light and strong tone share it; an old palette colour has the name of its new tone', () => {
	const names = PALETTE.map((e) => colorName(e.light))
	assert.deepEqual(names, ['Light blue', 'Turquoise', 'Sage', 'Yellow', 'Orange', 'Coral', 'Pink', 'Purple', 'Indigo', 'Sand', 'White', 'Gray', 'Black'])
	for (const name of names) assert.ok(typeof de[name] === 'string' && de[name] !== '', name + ' in de.json')
	assert.deepEqual(PALETTE.map((e) => colorName(e.strong)), [...names.slice(0, 10), 'White', 'Gray', 'Black'])
	for (const c of [...STICKY_COLORS, ...SHAPE_PALETTE]) assert.equal(colorName(c), colorName(shownColor(c)), c)
	assert.equal(colorName('#A8D8F8'), 'Light blue', 'upper case too')
	assert.equal(colorName('#ABCDEF'), 'Light blue', 'job 186: the nearest palette colour')
})

test('AK4 the file: BOM, CRLF after every row, the separator, formulas defused (frame titles too); all new texts in de.json', () => {
	const F = ID('F1')
	const m = modelOf([
		frame(F, { x: 0, y: 0, w: 1000, h: 600, data: { title: '=HYPERLINK("x")' } }),
		sticky(ID(1), { x: 20, y: 40, parent: F, data: { text: 'a;b' } }),
		sticky(ID(2), { x: 300, y: 40, parent: F, data: { text: '=1+1' } }),
		sticky(ID(3), { x: 600, y: 40, parent: F, data: { text: 'zwei\nZeilen' } }),
	])
	const rows = csvRows(m, exportIds(m, null))
	for (const sep of [',', ';']) {
		const csv = boardCsv(rows, sep)
		assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM')
		assert.ok(csv.endsWith('\r\n'))
		assert.equal(csv.split('\r\n').length - 1, 4, 'CRLF after the header and every row')
		assert.ok(csv.startsWith('﻿' + ['Type', 'Text', 'Color', 'Frame', 'Reactions', 'Votes', 'Tags'].join(sep) + '\r\n'))
		assert.ok(csv.includes(sep + "'=1+1" + sep), "'=1+1")
		assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'the frame title defused and quoted')
		assert.ok(csv.includes('"zwei\nZeilen"'), 'line breaks stay, quoted')
	}
	assert.ok(boardCsv(rows, ';').includes(';"a;b";'), 'a;b quoted with ";"')
	assert.ok(boardCsv(rows, ',').includes(',a;b,'), 'a;b plain with ","')
	assert.equal(boardCsv(rows), boardCsv(rows, ','), 'the default is ","')
	for (const text of [...csvHeader(), 'Note', 'Text', 'Shape', 'Table', 'Save as CSV']) {
		assert.ok(typeof de[text] === 'string' && de[text] !== '', text + ' in de.json')
	}
})

/** (Job 179 spec §7) The 27 palette colours and their names, in colorName's order. */
const NAMES_179 = [
	['#fff6b6', 'Light yellow'], ['#f5d76e', 'Yellow'], ['#d4e98a', 'Lime'], ['#dfe98a', 'Yellow green'],
	['#b8f0a0', 'Light green'], ['#d3f9d8', 'Mint'], ['#2f9e44', 'Green'], ['#7fd3cc', 'Turquoise'],
	['#a8d8f8', 'Light blue'], ['#6cc6ea', 'Sky blue'], ['#0082c9', 'Blue'], ['#c8a5d6', 'Lilac'],
	['#e5dbff', 'Lavender'], ['#7048e8', 'Violet'], ['#f2a7c8', 'Pink'], ['#ffd8e6', 'Light pink'],
	['#c2255c', 'Raspberry'], ['#f58a98', 'Coral'], ['#ffc9c9', 'Light red'], ['#e03131', 'Red'],
	['#ffe8cc', 'Apricot'], ['#ffb27a', 'Light orange'], ['#f08c00', 'Orange'], ['#ffffff', 'White'],
	['#e4e4e4', 'Light gray'], ['#868e96', 'Gray'], ['#1a1a1a', 'Black'],
]

test('job 186 AK1, job 227: NAMED_COLORS are the light tones, then the strong ones without white, each once; every old palette colour (upper case too) has the name of its new tone', () => {
	assert.deepEqual(NAMED_COLORS, [...new Set([...LIGHT, ...STRONG_COLORED])])
	assert.ok(Object.isFrozen(NAMED_COLORS))
	for (const [hex] of NAMES_179) {
		assert.equal(colorName(hex), colorName(shownColor(hex)), hex)
		assert.equal(colorName(hex.toUpperCase()), colorName(shownColor(hex)), hex.toUpperCase())
	}
	assert.deepEqual(['#fff6b6', '#b8f0a0', '#e03131', '#1a1a1a'].map(colorName), ['Yellow', 'Sage', 'Coral', 'Black'])
})

test('job 186 AK1 any other colour by its nearest palette colour (CIELAB): #FFFF00 Yellow, #40e0d0 Turquoise, #c0c0c0 Gray (job 227), #123456 Black, #ABCDEF Light blue', () => {
	assert.equal(colorName('#FFFF00'), 'Yellow')
	assert.equal(colorName('#40e0d0'), 'Turquoise')
	assert.equal(colorName('#c0c0c0'), 'Gray')
	assert.equal(colorName('#123456'), 'Black')
	assert.equal(colorName('#ABCDEF'), 'Light blue')
	assert.equal(colorName('#000000'), 'Black')
	assert.equal(colorName('#ff0000'), 'Coral')
})

test('job 186 AK1 no colour gives "": empty, null, undefined, a word, a short or long code, spaces, a number', () => {
	for (const v of ['', null, undefined, 'red', '#12345', '#1234567', '#gggggg', ' #ffffff', '#ffffff ', 'ffffff', 0xffffff]) {
		assert.equal(colorName(v), '', String(v))
	}
})

test('job 186 AK1 no result starts with "#": a sweep over the colour cube gives a palette name every time', () => {
	const names = new Set(PALETTE.map((e) => e.name))
	const hex = (v) => v.toString(16).padStart(2, '0')
	for (let r = 0; r < 256; r += 15) {
		for (let g = 0; g < 256; g += 15) {
			for (let b = 0; b < 256; b += 15) {
				const c = '#' + hex(r) + hex(g) + hex(b)
				const name = colorName(c)
				assert.ok(!name.startsWith('#') && names.has(name), c + ': ' + name)
			}
		}
	}
})

test('job 186 AK1 a note with the fill #123456 has "Black" in its row, not "#123456"', () => {
	const m = modelOf([sticky(ID(1), { x: 0, y: 0, style: { fill: '#123456' } })])
	const rows = csvRows(m, exportIds(m, null))
	assert.equal(rows[0][2], 'Black')
	assert.doesNotMatch(boardCsv(rows), /#123456/)
})

/**
 * The board of job 186 AK2: notes N and O, a text T, a table, a note P in
 * frame F and a loose note Q; N, O and Q are loose.
 */
const [VN, VO, VT, VTAB, VP, VQ, VF, VX] = ['VN', 'VO', 'VT', 'VB', 'VP', 'VQ', 'VF', 'VX'].map((n) => ID(n))
const ak2Items = () => [
		frame(VF, { x: 0, y: 0, w: 800, h: 600, data: { title: 'Bereich' } }),
		sticky(VP, { x: 40, y: 60, parent: VF, z: 'i1', data: { text: 'P' } }),
		sticky(VN, { x: 0, y: 1000, z: 'i2', data: { text: 'N' } }),
		sticky(VO, { x: 300, y: 1000, z: 'i3', data: { text: 'O' } }),
		textItem(VT, { x: 600, y: 1000, z: 'i4', data: { text: 'T' } }),
		table(VTAB, [['a']], { x: 900, y: 1000, z: 'i5' }),
		sticky(VQ, { x: 1200, y: 1000, z: 'i6', data: { text: 'Q' } }),
]
const ak2 = () => modelOf(ak2Items())

/** A vote of job 186 AK2, open. */
const VOTE = { sid: 5, state: 'open', cfg: { per: 5, perItem: 2, scope: null, types: ['sticky'] }, startedAt: 1, endsAt: null, by: 'Alice', show: false }

/**
 * @param {object} m SceneModel
 * @param {...(object|null)} metas meta.vote one after the other, null = none (gone)
 * @return {Record<string, string>} the Votes column by item (P, N, O, T, table, Q, X)
 */
function votesBy(m, ...metas) {
	const v = new VoteState()
	for (const meta of metas) {
		v.setSession(meta ?? undefined)
	}
	const ids = csvRowIds(m, exportIds(m, null))
	const rows = csvRows(m, exportIds(m, null), closedVotes(v))
	const name = { [VP]: 'P', [VN]: 'N', [VO]: 'O', [VT]: 'T', [VTAB]: 'table', [VQ]: 'Q', [VX]: 'X' }
	return Object.fromEntries(ids.map((id, i) => [name[id] ?? id, rows[i][5]]))
}

/** @param {object} [cfg] cfg fields @param {object} [extra] meta.vote fields @return {object} a finished vote, N with 4 votes */
const closed = (cfg = {}, extra = {}) => ({ ...VOTE, cfg: { ...VOTE.cfg, ...cfg }, state: 'closed', results: [[VN, 4]], total: 1, voters: 2, closedAt: 9, ...extra })

test('job 186 AK2 finished, types sticky, the whole board: N "4", O, P and Q "0", the text and the table empty; show false and true', () => {
	for (const show of [false, true]) {
		assert.deepEqual(votesBy(ak2(), closed({}, { show })), { P: '0', N: '4', O: '0', T: '', table: '', Q: '0' }, 'show ' + show)
	}
})

test('job 186 AK2 types sticky and text: the text "0" too, the table stays empty', () => {
	assert.deepEqual(votesBy(ak2(), closed({ types: ['sticky', 'text'] })), { P: '0', N: '4', O: '0', T: '0', table: '', Q: '0' })
	assert.deepEqual(votesBy(ak2(), closed({ types: ['text', 'table'] })), { P: '', N: '4', O: '', T: '0', table: '', Q: '' }, 'never a table')
})

test('job 186 AK2 scope F: P "0", O and Q empty, N still "4" outside F', () => {
	assert.deepEqual(votesBy(ak2(), closed({ scope: VF })), { P: '0', N: '4', O: '', T: '', table: '', Q: '' })
})

test('job 186 AK2 an incomplete ranking (total 2 for one entry) or no total: N "4", all others empty', () => {
	const none = { P: '', N: '4', O: '', T: '', table: '', Q: '' }
	assert.deepEqual(votesBy(ak2(), closed({}, { total: 2 })), none, 'total 2')
	const old = closed()
	delete old.total
	assert.deepEqual(votesBy(ak2(), old), none, 'no total (an old vote)')
	assert.deepEqual(votesBy(ak2(), closed({}, { results: [], total: 0 })), { P: '0', N: '0', O: '0', T: '', table: '', Q: '0' }, 'nobody voted')
})

test('job 186 AK2 open, without a vote and after "Close results": every row empty', () => {
	const empty = { P: '', N: '', O: '', T: '', table: '', Q: '' }
	assert.deepEqual(votesBy(ak2(), VOTE), empty, 'open')
	assert.deepEqual(votesBy(ak2(), null), empty, 'no vote')
	assert.deepEqual(votesBy(ak2(), closed(), null), empty, 'after "Close results" (meta.vote gone)')
})

test('job 186 AK2 type and parent as they are now: a note made after the end and a note moved into the scope get "0", one moved out stays empty', () => {
	const later = modelOf([...ak2Items(), sticky(VX, { x: 1500, y: 1000, z: 'i7', data: { text: 'X' } })])
	assert.equal(votesBy(later, closed()).X, '0', 'made after the end')
	assert.equal(votesBy(later, closed({ scope: VF })).X, '', 'made after the end outside the scope')
	const moved = modelOf(ak2Items().map((it) => {
		if (it.id === VO) {
			return { ...it, x: 300, y: 60, parent: VF }
		}
		return it.id === VP ? { ...it, x: 1500, y: 1000, parent: null } : it
	}))
	assert.deepEqual(votesBy(moved, closed({ scope: VF })), { O: '0', N: '4', P: '', T: '', table: '', Q: '' })
})

test('job 186 AK2 closedVotes: totals, types and scope (cfgOf), complete; null without a finished vote', () => {
	const v = new VoteState()
	v.setSession(closed({ scope: VF, types: ['text', 'sticky'] }))
	const c = closedVotes(v)
	assert.deepEqual([...c.totals], [[VN, 4]])
	assert.deepEqual(c.types, ['text', 'sticky'])
	assert.equal(c.scope, VF)
	assert.equal(c.complete, true)
	v.setSession(closed({ types: undefined }, { total: 3 }))
	assert.deepEqual(closedVotes(v).types, ['sticky'], 'the default')
	assert.equal(closedVotes(v).complete, false)
	v.setSession(VOTE)
	assert.equal(closedVotes(v), null, 'open')
	assert.equal(closedVotes(null), null)
	assert.equal(closedVotes(undefined), null)
})

test('job 188 AK7 a note pad has no row (its title neither); job 267 adds only the AI card to CSV_TYPES', () => {
	const P = ID('PAD1')
	const m = modelOf([
		frame(ID('FR1'), { x: 0, y: 0, w: 800, h: 600, data: { title: 'Links' } }),
		sticky(ID('NO1'), { x: 40, y: 40, parent: ID('FR1'), data: { text: 'Idee' } }),
		{ id: P, t: 'pad', x: 260, y: 40, w: 200, h: 200, r: 0, z: 'i3', parent: ID('FR1'), data: { title: 'Ideen' }, style: { fill: '#f5d76e' } },
	])
	const ids = exportIds(m, null)
	assert.ok(ids.includes(P), 'the pad is exported (the image takes it)')
	assert.equal(hasCsvRow(m.get(P)), false)
	assert.deepEqual(csvRowIds(m, ids), [ID('NO1')])
	assert.ok(!boardCsv(csvRows(m, ids)).includes('Ideen'), 'no row with its title')
	assert.deepEqual(CSV_TYPES, ['sticky', 'text', 'shape', 'table', 'ai'])
})

test('job 267 AK9 an AI card gets a row: type "AI summary", its Markdown as the text, no colour', () => {
	const A = ID('AI01')
	const m = modelOf([
		frame(ID('FR1'), { x: 0, y: 0, w: 800, h: 600, data: { title: 'Links' } }),
		{ id: A, t: 'ai', x: 40, y: 40, w: 360, h: 200, r: 0, z: 'i3', parent: ID('FR1'), data: { md: '# Sum\n- **a**', title: 'Links' }, style: {} },
	])
	assert.equal(hasCsvRow(m.get(A)), true)
	assert.deepEqual(csvRows(m, exportIds(m, null)), [['AI summary', '# Sum\n- **a**', '', 'Links', '', '', '']])
})
