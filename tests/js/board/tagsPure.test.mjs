/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 191, the pure parts of AK6 and AK7: copyPayload's tags,
 * pasteItems with a tag map, validatePayload and readBoardFile accept (and
 * clean) tags, the board file and the own template of a selection carry the
 * right tags; the CSV's last column "Tags" (also in German), a formula as a
 * name defused, other types empty.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { copyPayload, duplicateItems, pasteItems } from '../../../src/board/actions.js'
import { boardFileData, readBoardFile } from '../../../src/board/boardFile.js'
import { validatePayload } from '../../../src/board/clipboard.js'
import { boardCsv, csvHeader, csvRows } from '../../../src/board/exportCsv.js'
import { templateData } from '../../../src/board/ownTemplates.js'
import { exportIds } from '../../../src/scene/exportImage.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { FakeModel, ID, shape, sticky } from './fakes.mjs'

const TG = (n) => '01JT' + String(n).padStart(22, '0')
const KOSTEN = { id: TG(1), name: 'Kosten', color: '#e53935' }
const ZEIT = { id: TG(2), name: 'Zeit', color: '#fb8c00' }
const FORMULA = { id: TG(3), name: '=1+1', color: '#1e88e5' }
const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
const modelOf = (items) => new FakeModel(items)

let n = 0
const newId = () => '01JA' + String(++n).padStart(22, '9')

test('AK6 copyPayload: the tags of its notes in the board\'s order; none without the option', () => {
	const m = modelOf([sticky(ID(1), { data: { tags: [TG(2), TG(9)] } }), sticky(ID(2), { x: 300, data: { tags: [TG(1)] } }), shape(ID(3), { x: 600, data: { kind: 'rect', tags: [TG(3)] } })])
	assert.deepEqual(copyPayload(m, [ID(1), ID(2), ID(3)], { tags: [KOSTEN, ZEIT, FORMULA] }).tags, [KOSTEN, ZEIT], 'a shape\'s data.tags counts for nothing')
	assert.deepEqual(copyPayload(m, [ID(1)], { tags: [KOSTEN, ZEIT] }).tags, [ZEIT])
	assert.deepEqual(copyPayload(m, [ID(1)]).tags, [])
	assert.equal(copyPayload(m, [ID(1)]).knorke, 1)
})

test('AK6 pasteItems maps data.tags through the tag map; without one the notes carry no tags; duplicateItems keeps them', () => {
	const m = modelOf([])
	const payload = { knorke: 1, board: 8, items: [sticky(ID(5), { data: { text: 'x', tags: [TG(1), TG(2), TG(9)] } })] }
	const r = pasteItems(m, payload, { tagMap: new Map([[TG(1), TG(11)], [TG(2), TG(11)]]) }, newId)
	assert.deepEqual(r.ops[0].p.data, { text: 'x', tags: [TG(11)] })
	const none = pasteItems(m, payload, {}, newId)
	assert.deepEqual(none.ops[0].p.data, { text: 'x' })
	const src = modelOf([sticky(ID(1), { data: { tags: [TG(1)] } })])
	assert.deepEqual(duplicateItems(src, [ID(1)], { tags: [KOSTEN] }, newId).ops[0].p.data.tags, [TG(1)])
	assert.equal(duplicateItems(src, [ID(1)], {}, newId).ops[0].p.data.tags, undefined, 'without the board\'s tags none')
})

test('AK6 validatePayload and readBoardFile accept tags and drop invalid entries; a note with a broken data.tags is skipped', () => {
	const raw = {
		knorke: 1,
		board: 8,
		items: [sticky(ID(1), { data: { tags: [TG(1)] } }), sticky(ID(2), { data: { tags: [TG(1), TG(1)] } })],
		tags: [KOSTEN, { id: 'x', name: 'Bad', color: '#000000' }, { id: TG(4), name: 'kosten', color: '#000000' }, ZEIT],
	}
	const v = validatePayload(raw)
	assert.equal(v.ok, true)
	assert.deepEqual(v.payload.tags, [KOSTEN, ZEIT])
	assert.deepEqual(v.payload.items.map((it) => it.id), [ID(1)])
	assert.equal(v.skipped, 1, 'the double id makes the note bad')
	assert.deepEqual(validatePayload({ knorke: 1, items: [] }).payload.tags, [])
	const file = JSON.stringify({ knorke: 1, kind: 'board', title: 'B', origin: [0, 0], items: [sticky(ID(1), { data: { tags: [TG(2)] } })], tags: [ZEIT, 'x'] })
	const f = readBoardFile(file)
	assert.equal(f.ok, true)
	assert.deepEqual(f.payload.tags, [ZEIT])
})

test('AK6 the board file carries every tag, the template of a selection the tags of its notes', () => {
	const m = modelOf([sticky(ID(1), { data: { tags: [TG(2)] } }), sticky(ID(2), { x: 300 })])
	assert.deepEqual(boardFileData(m, 'B', [KOSTEN, ZEIT]).tags, [KOSTEN, ZEIT])
	assert.deepEqual(templateData(m, 'board', null, [KOSTEN, ZEIT]).tags, [KOSTEN, ZEIT])
	assert.deepEqual(templateData(m, 'selection', [ID(1)], [KOSTEN, ZEIT]).tags, [ZEIT])
	assert.deepEqual(templateData(m, 'selection', [ID(2)], [KOSTEN, ZEIT]).tags, [])
})

test('AK7 CSV: "Tags" is the last column, the names in the note\'s order joined by ", "; a formula is defused; other types empty', () => {
	const m = new SceneModel()
	m.load([
		sticky(ID(1), { data: { text: 'A', tags: [TG(2), TG(9), TG(1)] } }),
		sticky(ID(2), { x: 300, data: { text: 'B', tags: [TG(3)] } }),
		shape(ID(3), { x: 600, data: { kind: 'rect', text: 'S', tags: [TG(1)] } }),
	])
	const rows = csvRows(m, exportIds(m, null), null, [KOSTEN, ZEIT, FORMULA])
	assert.deepEqual(rows.map((r) => r.at(-1)), ['Zeit, Kosten', '=1+1', ''])
	assert.equal(csvHeader().at(-1), 'Tags')
	const csv = boardCsv(rows)
	assert.ok(csv.includes(",'=1+1\r\n"), 'defused by csvField')
	assert.ok(csv.includes(',"Zeit, Kosten"\r\n'), 'quoted for the comma')
	assert.equal(typeof de.Tags, 'string')
	// German (as in contextMenu.test.mjs): de.json registered for knorke
	globalThis._oc_l10n_registry_translations ??= {}
	globalThis._oc_l10n_registry_plural_functions ??= {}
	const reg = globalThis._oc_l10n_registry_translations
	const plural = globalThis._oc_l10n_registry_plural_functions
	reg.knorke = de
	plural.knorke = (k) => (k === 1 ? 0 : 1)
	try {
		const header = csvHeader()
		assert.equal(header.at(-1), de.Tags, 'the German header ends with the translation of "Tags"')
		assert.equal(header[0], de.Type)
	} finally {
		delete reg.knorke
		delete plural.knorke
	}
})
