/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 179 (AK6): "Save as CSV" in BoardSession, with the real
 * SceneModel, the fake scene, an injected download and an injected
 * language:
 * - the roles view and vote: false, no file, no toast
 * - the role edit in mode vote and on a frozen board: exactly one file
 *   "<title> <today>.csv"
 * - an empty board (or nothing with a row): the info export-empty, no file
 * - never an op, the undo stack stays
 * - the language de separates with ";", the table's "Export as CSV" too;
 *   en with ","
 * - the context menu's export-csv saves the selection (a frame with its
 *   notes), the votes of a finished vote go in
 *
 * Factory job 186 (AK3): the whole board after a finished vote has "0" for
 * a note without votes and the total for one with votes; an open vote
 * leaves the column empty; without a vote the file is the same as before.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { tableCsv } from '../../../src/model/table.js'
import { language } from '../../../src/util/l10n.js'
import { getLanguage, setLanguage } from '@nextcloud/l10n'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, frame, memoryStorage, shape, sticky, textItem } from './fakes.mjs'

const T0 = 1760100000000
const WALL = new Date(2026, 9, 25, 14, 30).getTime()
const OWNER = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const EDITOR = { pid: 'pidbob0000000001', name: 'Bob', role: 'edit', guest: false, mod: false, source: 'share' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const VOTER = { pid: 'pidvoter00000001', name: 'Vic', role: 'vote', guest: false, mod: false, source: 'share' }
const F = ID(1)
const C = ID(2)
const N = ID(3)
const T = ID(4)
const EMPTY = 'There is nothing on the board to save.'
const NAME = 'Retro_ Q3 2026-10-25.csv'
const OPEN_VOTE = { sid: 4, state: 'open', cfg: { per: 5, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0 - 1000, endsAt: null, by: 'Alice', show: false }

/** A 2 × 2 table with "a;b" in the first cell. */
const table = (extra = {}) => ({
	id: T, t: 'table', x: 0, y: 900, w: 320, h: 72, r: 0, z: 'i3', parent: null,
	data: { cols: { c00000001: { o: 'i0', w: 160 }, c00000002: { o: 'i1', w: 160 } }, rows: { r00000001: { o: 'i0' }, r00000002: { o: 'i1' } }, cells: { c00000001: { r00000001: 'a;b' } } },
	style: {},
	...extra,
})

const ITEMS = [frame(F, { w: 600, h: 400, data: { title: 'Ideen' } }), sticky(C, { x: 40, y: 60, parent: F, z: 'i1', data: { text: 'drin' } }), sticky(N, { x: 900, y: 0, z: 'i2', data: { text: 'draußen' } })]

/**
 * @param {object} [o] items, me, title, meta, language
 * @return {Promise<object>} harness: s, log (downloads, infos and toasts in order), sent ops
 */
async function open({ items = ITEMS, me = OWNER, title = 'Retro: Q3', meta = {}, language = 'en' } = {}) {
	const clock = new FakeClock(10000)
	const log = []
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title, role: me.role, metaRev: 3, meta }, me, items: structuredClone(items) }
		},
		async sync(body) {
			tr.calls.push(structuredClone(body))
			return { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: {},
		deps: {
			SceneModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			wall: () => WALL,
			download: (name, text) => {
				log.push(['download', name, text])
				return true
			},
			downloadBlob: () => {
				throw new Error('no Blob download for a CSV')
			},
			language: () => language,
		},
	})
	await s.open()
	await clock.advance(0)
	const ops = () => tr.calls.flatMap((b) => b.ops ?? [])
	return { s, clock, tr, log, ops, scene: s.scene, model: s.model }
}

/** @param {object} h harness @return {Array} the downloads */
const downloads = (h) => h.log.filter((x) => x[0] === 'download')

test('AK6 the roles view and vote: false, no file, no toast; owner and editor save', async () => {
	for (const me of [VIEWER, VOTER]) {
		const h = await open({ me })
		assert.equal(h.s.exportBoardCsv('board'), false, me.role)
		assert.deepEqual(h.log, [], me.role + ': nothing at all')
	}
	for (const me of [OWNER, EDITOR]) {
		const h = await open({ me })
		assert.equal(h.s.exportBoardCsv('board'), true, me.role)
		assert.equal(downloads(h).length, 1)
	}
})

test('AK6 the role edit in mode vote and on a frozen board: exactly one file "<title> <today>.csv" each; no op, the undo stack stays', async () => {
	const h = await open({ me: EDITOR, meta: { vote: OPEN_VOTE } })
	assert.equal(h.s.clientMode, 'vote', 'an editor in an open vote')
	const undo = [h.s.undoStack.done.length, h.s.undoStack.undone.length]
	assert.equal(h.s.exportBoardCsv('board'), true)
	assert.equal(h.log.length, 1)
	assert.deepEqual(h.log[0].slice(0, 2), ['download', NAME])
	h.s.frozen = true
	assert.equal(h.s.exportBoardCsv('board'), true)
	assert.deepEqual(h.log.map((x) => x.slice(0, 2)), [['download', NAME], ['download', NAME]])
	await h.clock.advance(5000)
	assert.equal(h.ops().length, 0, 'no op')
	assert.deepEqual([h.s.undoStack.done.length, h.s.undoStack.undone.length], undo, 'the undo stack stays')
	assert.equal(h.s.undoStack.canUndo(), false)
})

test('AK6 the file: header and rows in order, BOM, CRLF; the selection and the camera stay', async () => {
	const h = await open()
	h.s.select([N])
	h.scene.camera = { x: 20, y: -40, scale: 1.5 }
	assert.equal(h.s.exportBoardCsv('board'), true)
	const text = downloads(h)[0][2]
	// job 191: Tags is the last column
	assert.equal(text, '﻿Type,Text,Color,Frame,Reactions,Votes,Tags\r\nNote,drin,Light blue,Ideen,,,\r\nNote,draußen,Light blue,,,,\r\n')
	assert.deepEqual(h.s.selection, [N], 'the selection stays')
	assert.deepEqual(h.scene.camera, { x: 20, y: -40, scale: 1.5 })
	assert.equal(h.scene.callsOf('setCamera').length, 0)
})

test('AK6 an empty board or nothing with a row: the info export-empty, no file', async () => {
	const h = await open({ items: [] })
	assert.equal(h.s.exportBoardCsv('board'), false)
	assert.deepEqual(h.log, [['info', EMPTY, 'export-empty']])
	const g = await open({ items: [frame(F, { w: 600, h: 400 })] })
	assert.equal(g.s.exportBoardCsv('board'), false, 'a frame alone has no row')
	assert.deepEqual(g.log, [['info', EMPTY, 'export-empty']])
	const e = await open()
	e.s.select([])
	assert.equal(e.s.exportBoardCsv('selection'), false)
	assert.deepEqual(e.log, [['info', EMPTY, 'export-empty']])
})

test('AK6 the language de separates with ";", the table\'s "Export as CSV" too; en and the default with ","', async () => {
	const h = await open({ items: [...ITEMS, table()], language: 'de' })
	assert.equal(h.s.exportBoardCsv('board'), true)
	const text = downloads(h)[0][2]
	assert.ok(text.startsWith('﻿Type;Text;Color;Frame;Reactions;Votes;Tags\r\n'), JSON.stringify(text.slice(0, 60)))
	assert.ok(text.includes('\r\nTable;"a;b |  |  | ";;;;;\r\n'), JSON.stringify(text))
	h.s.select([T])
	h.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: 'c00000001.r00000001' })
	h.s.menuAction('table-csv')
	const [, name, csv] = downloads(h)[1]
	assert.equal(name, 'Retro_ Q3 - Table.csv')
	assert.equal(csv, tableCsv(h.model.get(T), ';'))
	assert.equal(csv, '﻿"a;b";\r\n;\r\n')
	const g = await open({ items: [...ITEMS, table()], language: 'en_GB' })
	g.s.select([T])
	g.s.openMenu({ type: 'contextMenu', id: T, at: [10, 10], cell: 'c00000001.r00000001' })
	g.s.menuAction('table-csv')
	assert.equal(downloads(g)[0][2], '﻿a;b,\r\n,\r\n')
})

test('AK6 without deps.language the session follows Nextcloud\'s language (util/l10n.js language: getLanguage, else en)', async () => {
	const before = getLanguage()
	try {
		for (const [lang, sep] of [['de_DE', ';'], ['de', ';'], ['en', ','], ['pt_BR', ';']]) {
			setLanguage(lang)
			assert.equal(language(), lang)
			assert.equal(new BoardSession({ container: null, deps: {} }).csvSep(), sep, lang)
		}
		setLanguage('')
		assert.equal(language(), 'en', 'without a language: en')
	} finally {
		setLanguage(before)
	}
})

test('AK6 the context menu on a frame: export-csv saves its notes only; the votes of the finished vote go in, none while a vote is open', async () => {
	const closed = { ...OPEN_VOTE, state: 'closed', results: [[C, 3], [N, 1]], total: 2, voters: 2, closedAt: T0 - 10, show: false }
	const h = await open({ meta: { vote: closed } })
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10] })
	assert.equal(h.s.menuAction('export-csv'), true)
	assert.equal(h.s.menu, null, 'the menu closed')
	assert.ok(h.scene.callsOf('focusCanvas').length > 0, 'the canvas gets the focus back')
	const [, name, text] = downloads(h)[0]
	assert.equal(name, NAME, 'named after the board, also for a selection')
	assert.equal(text, '﻿Type,Text,Color,Frame,Reactions,Votes,Tags\r\nNote,drin,Light blue,Ideen,,3,\r\n')
	const o = await open({ meta: { vote: OPEN_VOTE } })
	assert.equal(o.s.exportBoardCsv('board'), true)
	const lines = downloads(o)[0][2].split('\r\n').slice(1, -1)
	assert.equal(lines.length, 2)
	assert.ok(lines.every((l) => l.endsWith(',,')), 'an open vote: the column stays empty (job 191: then the empty Tags) ' + JSON.stringify(lines))
})

/** (Job 186) A text item and a shape with text beside ITEMS, both in palette colours. */
const MORE = [
	textItem(ID(5), { x: 900, y: 400, z: 'i4', data: { text: 'Titel' }, style: { fontSize: 24, color: '#2f9e44', align: 'left' } }),
	shape(ID(6), { x: 1300, y: 400, z: 'i5', data: { kind: 'rect', text: 'Form' }, style: { fill: '#ffffff', fillOpacity: 0, stroke: '#e03131' } }),
]

test('job 186 AK3 the whole board after a finished vote: a note without votes ends on "0", one with votes on its total; no op, no undo step', async () => {
	const closed = { ...OPEN_VOTE, state: 'closed', results: [[C, 3]], total: 1, voters: 1, closedAt: T0 - 10, show: false }
	const h = await open({ items: [...ITEMS, table()], meta: { vote: closed } })
	const undo = [h.s.undoStack.done.length, h.s.undoStack.undone.length]
	assert.equal(h.s.exportBoardCsv('board'), true)
	assert.equal(downloads(h)[0][2], '﻿Type,Text,Color,Frame,Reactions,Votes,Tags\r\nNote,drin,Light blue,Ideen,,3,\r\nNote,draußen,Light blue,,,0,\r\nTable,a;b |  |  | ,,,,,\r\n')
	await h.clock.advance(5000)
	assert.equal(h.ops().length, 0, 'no op')
	assert.deepEqual([h.s.undoStack.done.length, h.s.undoStack.undone.length], undo, 'the undo stack stays')
})

test('job 186 AK3 an open vote: every row still ends on the empty separator', async () => {
	const h = await open({ items: [...ITEMS, table(), ...MORE], meta: { vote: OPEN_VOTE } })
	assert.equal(h.s.exportBoardCsv('board'), true)
	const lines = downloads(h)[0][2].split('\r\n').slice(1, -1)
	assert.equal(lines.length, 5)
	assert.ok(lines.every((l) => l.endsWith(',,')), JSON.stringify(lines))
})

test('job 186 AK3 without a vote the file is byte for byte the one of job 179', async () => {
	const h = await open({ items: [...ITEMS, table(), ...MORE] })
	assert.equal(h.s.exportBoardCsv('board'), true)
	assert.equal(downloads(h)[0][2], '﻿Type,Text,Color,Frame,Reactions,Votes,Tags\r\nNote,drin,Light blue,Ideen,,,\r\nNote,draußen,Light blue,,,,\r\nText,Titel,Sage,,,,\r\nShape,Form,Coral,,,,\r\nTable,a;b |  |  | ,,,,,\r\n', 'job 191: plus the empty Tags column; job 227: the names of the one palette')
})
