/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Plain text → notes (SPEC-M1 §6.5.2): one note per non-empty line in a
 * ceil(sqrt(n)) grid, a table (tabs) cell by cell, texts above the note
 * limit split (never cut), cleaned like the server.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOTE_GRID, noteTexts, notesFromText } from '../../../src/board/actions.js'
import { ULID_RE } from '../../../src/model/ids.js'
import { TYPES } from '../../../src/model/registry.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { FakeModel, ID, frame, sticky } from './fakes.mjs'

/**
 * @return {() => string} ids ID(100), ID(101), …
 */
function counter() {
	let i = 100
	return () => ID(i++)
}

test('lines: one note per non-empty line, grid of ceil(sqrt(n)) columns, row by row', () => {
	assert.deepEqual(noteTexts('one\n\n  \ntwo\r\nthree\n'), [
		{ text: 'one', col: 0, row: 0 },
		{ text: 'two', col: 1, row: 0 },
		{ text: 'three', col: 0, row: 1 },
	])
	const five = noteTexts('a\nb\nc\nd\ne')
	assert.deepEqual(five.map((n) => [n.col, n.row]), [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]])
	assert.deepEqual(noteTexts(''), [])
	assert.deepEqual(noteTexts(' \n\t\n'), [], 'only whitespace and empty cells')
})

test('table: a text with a tab → one note per non-empty cell at its column and row', () => {
	assert.deepEqual(noteTexts('a\tb\tc\n\td\n\ne\t'), [
		{ text: 'a', col: 0, row: 0 },
		{ text: 'b', col: 1, row: 0 },
		{ text: 'c', col: 2, row: 0 },
		{ text: 'd', col: 1, row: 1 },
		{ text: 'e', col: 0, row: 3 },
	])
})

test('cleaned like the server: lone surrogates → U+FFFD, C0 controls removed; above the note limit split, never cut', () => {
	const [n] = noteTexts('a\u0001b\uD800c')
	assert.equal(n.text, 'ab�c')
	const max = TYPES.sticky.fields['data.text'][1]
	const long = 'x'.repeat(max) + 'y'.repeat(10)
	const parts = noteTexts(long)
	assert.deepEqual(parts.map((p) => p.text.length), [max, 10])
	assert.equal(parts.map((p) => p.text).join(''), long)
	// code points, not UTF-16 units: an emoji is never split in half
	const emoji = '😀'.repeat(max + 1)
	const ep = noteTexts(emoji)
	assert.deepEqual(ep.map((p) => Array.from(p.text).length), [max, 1])
	// in a table the parts of one cell stack in its column
	const cell = noteTexts('h1\th2\n' + long + '\tz')
	assert.deepEqual(cell.map((c) => [c.col, c.row]), [[0, 0], [1, 0], [0, 1], [0, 2], [1, 1]])
})

test('notesFromText: puts on the 220 grid centered at `at`, default note, z above the content, inverse removes, all selected', () => {
	const m = new FakeModel([sticky(ID(1), { z: 'i5', x: 9000 })])
	const r = notesFromText(m, 'a\nb\nc', { at: { x: 1000, y: 500 } }, counter())
	assert.equal(r.count, 3)
	assert.equal(r.full, false)
	const d = TYPES.sticky.defaults
	// 2 columns × 2 rows: width 220 + 200 = 420, height 420 → top-left (790, 290)
	assert.deepEqual(r.ops.map((o) => [o.p.x, o.p.y]), [[790, 290], [790 + NOTE_GRID, 290], [790, 290 + NOTE_GRID]])
	for (const op of r.ops) {
		assert.equal(op.o, 'put')
		assert.equal(op.t, 'sticky')
		assert.match(op.id, ULID_RE)
		assert.ok(isValidKey(op.p.z) && op.p.z > 'i5')
		assert.deepEqual([op.p.w, op.p.h, op.p.r, op.p.parent, op.p.style], [d.w, d.h, 0, null, d.style])
	}
	assert.deepEqual(r.ops.map((o) => o.p.data.text), ['a', 'b', 'c'])
	assert.ok(r.ops[0].p.z < r.ops[1].p.z && r.ops[1].p.z < r.ops[2].p.z)
	assert.deepEqual(r.inverse, [...r.ops].reverse().map((o) => ({ o: 'remove', id: o.id })))
	assert.deepEqual(r.selectIds, r.ops.map((o) => o.id))
})

test('notesFromText: a note whose center lies in a frame becomes its child; a full board creates nothing', () => {
	const m = new FakeModel([frame(ID('F1'), { x: 0, y: 0, w: 1000, h: 1000 })])
	const r = notesFromText(m, 'inside', { at: { x: 500, y: 500 } }, counter())
	assert.deepEqual([r.ops[0].p.parent, r.ops[0].p.x, r.ops[0].p.y], [ID('F1'), 400, 400])
	const full = notesFromText(m, 'a\nb', { at: { x: 0, y: 0 }, limits: { maxItems: 2 } }, counter())
	assert.deepEqual(full, { ops: [], inverse: [], selectIds: [], count: 2, full: true })
	assert.deepEqual(notesFromText(m, '\n\n', { at: null }), { ops: [], inverse: [], selectIds: [], count: 0, full: false })
})
