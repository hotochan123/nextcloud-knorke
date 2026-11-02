/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 191, AK3: the pure tag rules of src/model/tags.js and the tag
 * tokens. The three limits equal lib/Service/Limits.php (read as text),
 * every TAG_COLORS entry has a text colour (contrastTextOn) with at least
 * 4.5 : 1; the free colour, the name rule, uniqueness, sorting, the search,
 * the cleaning of meta.tags, the valid ids of a note, the tick patch, the
 * paste plan and the faded notes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	TAGS_PER_BOARD, TAGS_PER_NOTE, TAG_NAME_MAX, cleanTagName, cleanTags, fadedNotes, findTagByName, matchTags, nextTagColor,
	noteTagIds, planPasteTags, remapTagIds, sortTags, tagCounts, tagMap, tagPatch, tagState, tagsOf, usedTags,
} from '../../../src/model/tags.js'
import { TAG_COLORS, contrastTextOn } from '../../../src/model/tokens.js'

const U = (n) => '01JA' + String(n).padStart(22, '0')
const tag = (n, name, color = '#e53935') => ({ id: U(n), name, color })
const note = (id, tags, extra = {}) => ({ id, t: 'sticky', data: tags === undefined ? {} : { tags }, ...extra })

/**
 * @param {string} hex #rrggbb
 * @return {number} WCAG 2.x relative luminance
 */
function luminance(hex) {
	const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

test('AK3: 8, 100 and 30 are the numbers of lib/Service/Limits.php', () => {
	const php = readFileSync(new URL('../../../lib/Service/Limits.php', import.meta.url), 'utf8')
	const num = (name) => Number(new RegExp(`const ${name} = (\\d+);`).exec(php)?.[1])
	assert.equal(TAGS_PER_NOTE, num('TAGS_PER_NOTE'))
	assert.equal(TAGS_PER_BOARD, num('TAGS_PER_BOARD'))
	assert.equal(TAG_NAME_MAX, num('TAG_NAME_MAX'))
	assert.deepEqual([TAGS_PER_NOTE, TAGS_PER_BOARD, TAG_NAME_MAX], [8, 100, 30])
})

test('AK3: 12 different lower-case colours, each with a text colour of at least 4.5 : 1 (contrastTextOn)', () => {
	assert.equal(TAG_COLORS.length, 12)
	assert.equal(new Set(TAG_COLORS).size, 12)
	for (const c of TAG_COLORS) {
		assert.match(c, /^#[0-9a-f]{6}$/)
		const text = contrastTextOn(c)
		const [a, b] = [luminance(c), luminance(text)].sort((x, y) => y - x)
		assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `${c} with ${text}`)
	}
})

test('AK3: nextTagColor takes the first free colour, then TAG_COLORS[count % 12]', () => {
	assert.equal(nextTagColor([]), TAG_COLORS[0])
	assert.equal(nextTagColor([tag(1, 'A', TAG_COLORS[0]), tag(2, 'B', TAG_COLORS[2])]), TAG_COLORS[1])
	assert.equal(nextTagColor([tag(1, 'A', TAG_COLORS[1].toUpperCase())]), TAG_COLORS[0], 'case does not matter')
	const all = TAG_COLORS.map((c, i) => tag(i + 1, 'T' + i, c))
	assert.equal(nextTagColor(all), TAG_COLORS[0], '12 tags: 12 % 12')
	assert.equal(nextTagColor([...all, tag(20, 'X', TAG_COLORS[5])]), TAG_COLORS[1], '13 tags: 13 % 12')
})

test('job 227: an old tag colour takes the tone it is drawn in: a new tag never gets that tone while a free one is left', () => {
	// #e53935 (old red) is drawn as Coral, #43a047 (old green) as Sage
	const old = [tag(1, 'Alt', '#e53935'), tag(2, 'Grün', '#43a047')]
	const taken = new Set(['#c43e45', '#307d37'])
	const list = [...old]
	for (let i = 0; i < 10; i++) {
		const c = nextTagColor(list)
		assert.ok(!taken.has(c), c)
		taken.add(c)
		list.push(tag(10 + i, 'N' + i, c))
	}
	assert.equal(taken.size, 12, 'old and new tags use every tone once')
	assert.equal(nextTagColor(list), TAG_COLORS[list.length % 12], 'all taken: the fallback by count')
})

test('AK3: a name is trimmed, 1–30 code points, without control characters', () => {
	assert.equal(cleanTagName('  Kosten  '), 'Kosten')
	assert.equal(cleanTagName(' Zeit '), 'Zeit', 'Unicode spaces too, like Input::title')
	assert.equal(cleanTagName('😀'.repeat(30)), '😀'.repeat(30), '30 code points')
	assert.equal(cleanTagName('ä'.repeat(31)), null)
	for (const v of ['', '   ', 'a\u0007b', 'a\nb', null, 5, '\uD800']) assert.equal(cleanTagName(v), null, JSON.stringify(v))
})

test('AK3: unique without regard to case; findTagByName, sortTags, matchTags', () => {
	const list = [tag(1, 'Zeit'), tag(2, 'kosten'), tag(3, 'Äpfel'), tag(4, 'Budget')]
	assert.equal(findTagByName(list, 'KOSTEN')?.id, U(2))
	assert.equal(findTagByName(list, '  zeit '), list[0])
	assert.equal(findTagByName(list, 'Kost'), null)
	assert.deepEqual(sortTags(list).map((x) => x.name), ['Äpfel', 'Budget', 'kosten', 'Zeit'])
	assert.deepEqual(matchTags(list, 'E').map((x) => x.name), ['Äpfel', 'Budget', 'kosten', 'Zeit'])
	assert.deepEqual(matchTags(list, 'ost').map((x) => x.name), ['kosten'])
	assert.deepEqual(matchTags(list, ''), sortTags(list))
	assert.equal(list[0].name, 'Zeit', 'sortTags copies')
})

test('AK3: tagsOf cleans meta.tags like TagService::listOf', () => {
	const meta = {
		tags: [
			tag(1, 'A', '#ABCDEF'), tag(1, 'B'), tag(2, 'a'), { id: 'nope', name: 'C', color: '#000000' }, tag(3, 'D', 'red'),
			'x', tag(4, ' E'), tag(5, 'F', '#111111'),
		],
	}
	assert.deepEqual(tagsOf(meta), [{ id: U(1), name: 'A', color: '#abcdef' }, { id: U(5), name: 'F', color: '#111111' }])
	assert.deepEqual(tagsOf({ tags: 'x' }), [])
	assert.deepEqual(tagsOf(null), [])
	const many = Array.from({ length: 120 }, (_, i) => tag(i + 1, 'T' + i))
	assert.equal(cleanTags(many).length, 100, 'at most 100')
})

test('noteTagIds: only ids of the list, in order, each once, notes only', () => {
	const byId = tagMap([tag(1, 'A'), tag(2, 'B')])
	assert.deepEqual(noteTagIds(note('n', [U(2), U(9), U(1), U(2)]), byId), [U(2), U(1)])
	assert.deepEqual(noteTagIds({ id: 's', t: 'shape', data: { tags: [U(1)] } }, byId), [])
	assert.deepEqual(noteTagIds(note('n', 'x'), byId), [])
	assert.deepEqual(noteTagIds(note('n', [U(1)]), new Map()), [])
})

test('tagState has three states; tagCounts counts the notes per tag', () => {
	const byId = tagMap([tag(1, 'A'), tag(2, 'B')])
	const a = note('a', [U(1)])
	const b = note('b', [U(1), U(2)])
	const c = note('c')
	assert.equal(tagState([a, b], U(1), byId), 'on')
	assert.equal(tagState([a, b], U(2), byId), 'mixed')
	assert.equal(tagState([a, c], U(2), byId), 'off')
	assert.equal(tagState([], U(1), byId), 'off')
	assert.deepEqual([...tagCounts([a, b, c, { t: 'shape', data: { tags: [U(2)] } }], byId)], [[U(1), 2], [U(2), 1]])
})

test('tagPatch: one patch per changed note with inverse, deleted ids go, full notes are counted', () => {
	const list = Array.from({ length: 9 }, (_, i) => tag(i + 1, 'T' + i))
	const byId = tagMap(list)
	const a = note('a', [U(50), U(1)])
	const b = note('b', [U(2)])
	const full = note('f', list.slice(0, 8).map((x) => x.id))
	const r = tagPatch([a, b, full], U(2), true, byId)
	assert.deepEqual(r.ops, [{ o: 'patch', id: 'a', p: { 'data.tags': [U(1), U(2)] } }], 'b has it, f is full; the deleted id of a goes')
	assert.deepEqual(r.inverse, [{ o: 'patch', id: 'a', p: { 'data.tags': [U(50), U(1)] } }], 'the stored value comes back')
	assert.equal(r.full, 0, 'f has the tag already')
	const r9 = tagPatch([full], U(9), true, byId)
	assert.deepEqual([r9.ops, r9.full], [[], 1])
	const off = tagPatch([a, b], U(2), false, byId)
	assert.deepEqual(off.ops, [{ o: 'patch', id: 'b', p: { 'data.tags': null } }], 'the last tag removes the field')
	assert.deepEqual(off.inverse, [{ o: 'patch', id: 'b', p: { 'data.tags': [U(2)] } }])
	assert.deepEqual(tagPatch([note('n')], U(1), true, byId).inverse, [{ o: 'patch', id: 'n', p: { 'data.tags': null } }])
	assert.deepEqual(tagPatch([a], U(77), true, byId).ops, [], 'an unknown tag ticks nothing')
	assert.deepEqual(tagPatch([{ id: 's', t: 'shape', data: {} }], U(1), true, byId).ops, [], 'notes only')
})

test('planPasteTags: same id kept, else the same name, else a new tag with a fresh id; one list to add', () => {
	let n = 900
	const newId = () => U(++n)
	const board = [tag(1, 'Kosten'), tag(2, 'Zeit')]
	const payload = [tag(1, 'Other name'), tag(7, 'zeit'), tag(8, 'Neu', '#43a047'), tag(9, 'NEU'), { id: 'x', name: 'Bad', color: '#000000' }, tag(10, '')]
	const p = planPasteTags(payload, board, newId)
	assert.deepEqual([...p.map], [[U(1), U(1)], [U(7), U(2)], [U(8), U(901)]], 'the double name of the payload is dropped by cleanTags')
	assert.deepEqual(p.add, [{ id: U(901), name: 'Neu', color: '#43a047' }])
	assert.equal(p.dropped, 0)
	const q = planPasteTags([tag(8, 'Neu'), tag(9, 'Alt')], [], newId)
	assert.deepEqual(q.add.map((x) => x.name), ['Neu', 'Alt'])
	const fullBoard = Array.from({ length: 99 }, (_, i) => tag(i + 100, 'B' + i))
	const r = planPasteTags([tag(1, 'X'), tag(2, 'Y')], fullBoard, newId)
	assert.deepEqual([r.add.length, r.dropped, r.map.has(U(2))], [1, 1, false], 'never beyond 100 tags')
	assert.deepEqual(planPasteTags(undefined, board, newId), { map: new Map(), add: [], dropped: 0 })
})

test('remapTagIds maps, drops unknown ids, keeps the order, at most 8; usedTags in the board order', () => {
	const map = new Map([[U(1), U(11)], [U(2), U(12)], [U(3), U(11)]])
	assert.deepEqual(remapTagIds([U(2), U(9), U(1), U(3)], map), [U(12), U(11)])
	assert.equal(remapTagIds([U(9)], map), null)
	assert.equal(remapTagIds([U(1)], null), null)
	const big = new Map(Array.from({ length: 10 }, (_, i) => [U(i + 1), U(i + 1)]))
	assert.equal(remapTagIds([...big.keys()], big).length, 8)
	const list = [tag(1, 'A'), tag(2, 'B'), tag(3, 'C')]
	assert.deepEqual(usedTags([note('a', [U(3), U(1)]), { t: 'shape', data: { tags: [U(2)] } }], list), [list[0], list[2]])
})

test('fadedNotes: notes without a chosen tag, other types never; no filter fades nothing', () => {
	const byId = tagMap([tag(1, 'A'), tag(2, 'B')])
	const items = [note('a', [U(1)]), note('b', [U(2)]), note('c'), note('d', [U(9)]), { id: 's', t: 'shape', data: {} }]
	assert.deepEqual(fadedNotes(items, new Set([U(1)]), byId), ['b', 'c', 'd'])
	assert.deepEqual(fadedNotes(items, new Set([U(1), U(2)]), byId), ['c', 'd'], 'at least one chosen tag keeps a note')
	assert.deepEqual(fadedNotes(items, new Set(), byId), [])
	assert.deepEqual(fadedNotes(items, null, byId), [])
})
