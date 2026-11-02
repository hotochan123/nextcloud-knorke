/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 271: search on the board (src/board/search.js), AK1–AK3 and
 * the step of AK5.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { SEARCH_MAX, findIn, foldQuery, searchBoard, snippet, stepHit } from '../../../src/board/search.js'
import { ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

function table(id, cells, extra = {}) {
	return {
		id, t: 'table', x: 0, y: 0, w: 400, h: 200, r: 0, z: 'i1', parent: null,
		data: {
			cols: { caaaaaaaa: { o: 'a0', w: 200 }, cbbbbbbbb: { o: 'a1', w: 200 } },
			rows: { raaaaaaaa: { o: 'a0' }, rbbbbbbbb: { o: 'a1' } },
			cells,
		},
		style: {},
		...extra,
	}
}

function model(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

const thread = (id, text, extra = {}) => ({ id, item: null, x: 0, y: 0, resolved: false, comments: [{ id: id + 'c', parts: [text], name: 'A', at: 1 }], ...extra })

test('AK1: every source is found without case, as a substring', () => {
	const m = model([
		sticky(ID(1), { x: 0, y: 0, data: { text: 'Coffee break' } }),
		shape(ID(2), { x: 0, y: 300, data: { kind: 'rect', text: 'more COFFEE' } }),
		textItem(ID(3), { x: 0, y: 600, data: { text: 'decaffeinated coffee' } }),
		frame(ID(4), { x: 0, y: 900, z: 'a0', data: { title: 'Coffee corner' } }),
		table(ID(5), { cbbbbbbbb: { raaaaaaaa: 'iced coffee' } }, { x: 0, y: 2000 }),
		connector(ID(6), { x: 0, y: 0 }, { x: 10, y: 10 }, { data: { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, route: 'straight', label: 'coffee' } }),
		sticky(ID(7), { x: 0, y: 3000, data: { text: 'tea' } }),
	])
	const { hits, more } = searchBoard(m, [thread('11', 'Need coffee', { x: 5, y: 5000 })], 'cOfFeE')
	assert.equal(more, false)
	assert.deepEqual(hits.map((h) => [h.kind, h.id]), [
		['note', ID(1)], ['shape', ID(2)], ['text', ID(3)], ['frame', ID(4)], ['table', ID(5)], ['comment', '11'],
	])
	assert.equal(hits[4].match, 'coffee')
	assert.equal(hits[1].match, 'COFFEE')
})

test('AK1: mind maps and pads are not searched', () => {
	const items = [
		{ id: ID(1), t: 'pad', x: 0, y: 0, w: 300, h: 300, r: 0, z: 'i0', parent: null, data: { title: 'coffee' }, style: {} },
	]
	const m = { ids: () => items.map((x) => x.id), get: (id) => items.find((x) => x.id === id), abs: () => ({ x: 0, y: 0, w: 1, h: 1 }), has: () => true }
	assert.deepEqual(searchBoard(m, [], 'coffee').hits, [])
})

test('AK2: reading order, one hit per item, table and thread; comments after items', () => {
	const m = model([
		sticky(ID(1), { x: 500, y: 100, data: { text: 'x a x a' } }),
		sticky(ID(2), { x: 0, y: 100.5, data: { text: 'a' } }),
		sticky(ID(3), { x: 0, y: 0, data: { text: 'A' } }),
		table(ID(4), { caaaaaaaa: { raaaaaaaa: 'a', rbbbbbbbb: 'a' }, cbbbbbbbb: { raaaaaaaa: 'ba' } }, { y: 50 }),
	])
	const threads = [
		thread('12', 'a', { x: 0, y: 10 }),
		{ ...thread('13', 'zzz', { x: 0, y: 0 }), comments: [{ parts: ['no'] }, { parts: ['an a'] }] },
	]
	const { hits } = searchBoard(m, threads, 'a')
	assert.deepEqual(hits.map((h) => h.id), [ID(3), ID(4), ID(2), ID(1), '13', '12'])
	// the table snippet comes from its first matching cell in row, then column order
	assert.equal(hits[1].before + hits[1].match + hits[1].after, 'a')
})

test('AK2: an empty query finds nothing; the cap sets more', () => {
	const items = []
	for (let i = 0; i < SEARCH_MAX + 5; i++) items.push(sticky(ID(100 + i), { y: i * 10, data: { text: 'hit' } }))
	const m = model(items)
	assert.deepEqual(searchBoard(m, [], '   '), { hits: [], more: false })
	assert.deepEqual(searchBoard(m, [], ''), { hits: [], more: false })
	const r = searchBoard(m, [], ' hit ')
	assert.equal(r.hits.length, SEARCH_MAX)
	assert.equal(r.more, true)
	assert.equal(searchBoard(m, [], 'hit', { max: 500 }).more, false)
})

test('AK2: comments without a thread list and broken threads are skipped', () => {
	const m = model([sticky(ID(1), { data: { text: 'x' } })])
	assert.deepEqual(searchBoard(m, null, 'x').hits.map((h) => h.id), [ID(1)])
	assert.deepEqual(searchBoard(m, [null, { id: 3 }, { id: '4' }], 'x').hits.map((h) => h.id), [ID(1)])
})

test('AK2: a comment hit names its item and resolved state, anchored by anchorOf', () => {
	const m = model([sticky(ID(1), { x: 0, y: 0, data: { text: 'none' } })])
	const threads = [thread('20', 'late', { item: ID(1), resolved: true }), thread('21', 'late', { x: 0, y: -50 })]
	const { hits } = searchBoard(m, threads, 'late', { anchorOf: (t) => (t.id === '20' ? { x: 0, y: -100 } : null) })
	assert.deepEqual(hits.map((h) => [h.id, h.item, h.resolved]), [['20', ID(1), true], ['21', null, false]])
})

test('AK3: snippet keeps at most 60 code points, cuts with …, line breaks as spaces', () => {
	const text = 'a'.repeat(100) + '\nneedle\n' + 'b'.repeat(100)
	const q = foldQuery('NEEDLE')
	const m = findIn(text, q)
	const s = snippet(m.cps, m.start, m.end)
	assert.equal(s.match, 'needle')
	assert.ok(s.before.startsWith('…'))
	assert.ok(s.after.endsWith('…'))
	assert.ok(s.before.endsWith(' '))
	const shown = Array.from(s.before + s.match + s.after).length - 2
	assert.equal(shown, 60)
	// short text: no cut
	const m2 = findIn('one needle', q)
	assert.deepEqual(snippet(m2.cps, m2.start, m2.end), { before: 'one ', match: 'needle', after: '' })
})

test('AK3: emoji before the match keep the indices right; a long match is cut', () => {
	const q = foldQuery('käse')
	const m = findIn('🧀🧀 Käse', q)
	assert.deepEqual([m.start, m.end], [3, 7])
	assert.equal(snippet(m.cps, m.start, m.end).match, 'Käse')
	// decomposed ä (NFD) is found by the composed query
	assert.ok(findIn('Käse', q))
	const long = 'x'.repeat(80)
	const m3 = findIn(long, foldQuery(long))
	const s3 = snippet(m3.cps, m3.start, m3.end)
	assert.equal(s3.match.length, 60)
	assert.equal(s3.before, '')
	assert.equal(s3.after, '…')
	assert.equal(findIn('', q), null)
	assert.equal(findIn(null, q), null)
})

test('AK3: text with markup stays text (the snippet is plain)', () => {
	const m = findIn('<img src=x onerror=alert(1)> hi', foldQuery('hi'))
	const s = snippet(m.cps, m.start, m.end)
	assert.equal(s.before, '<img src=x onerror=alert(1)> ')
})

test('AK5: stepHit goes round both ways', () => {
	assert.equal(stepHit(-1, 3, 1), 0)
	assert.equal(stepHit(-1, 3, -1), 2)
	assert.equal(stepHit(0, 3, 1), 1)
	assert.equal(stepHit(2, 3, 1), 0)
	assert.equal(stepHit(0, 3, -1), 2)
	assert.equal(stepHit(5, 3, 1), 0)
	assert.equal(stepHit(0, 0, 1), -1)
})

test('Risk: 5000 items are searched in well under 250 ms', () => {
	const items = []
	for (let i = 0; i < 5000; i++) items.push(sticky(ID(1000 + i), { x: i % 70 * 210, y: Math.floor(i / 70) * 210, data: { text: 'Idea number ' + i + ' about the workshop and its goals' } }))
	const m = model(items)
	const t0 = performance.now()
	const r = searchBoard(m, [], 'goals')
	const ms = performance.now() - t0
	assert.equal(r.hits.length, SEARCH_MAX)
	assert.ok(ms < 250, `took ${ms} ms`)
})
