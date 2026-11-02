/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 274: the board as an outline (src/board/outline.js) AK1–AK3,
 * the view switch (src/board/viewSwitch.js) AK7.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { boardOutline, mdEscape, outlineMarkdown, outlineText } from '../../../src/board/outline.js'
import { nextView } from '../../../src/board/viewSwitch.js'
import { ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

function model(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

const shape2 = (id, extra) => shape(id, { ...extra, data: { kind: 'rect', ...extra.data } })
const titles = (o) => o.sections.map((s) => [s.frame, s.title, s.items.map((p) => p.text)])

test('AK1: notes, text items and shapes with text become points; empty notes, shapes without text, tables, connectors, mind maps and AI cards do not', () => {
	const m = model([
		frame(ID(1), { x: 0, y: 0, w: 1000, h: 1000, z: 'a0', data: { title: '  Ideen ' } }),
		sticky(ID(2), { x: 10, y: 100, parent: ID(1), data: { text: '  Kaffee\r\nmehr ' } }),
		sticky(ID(3), { x: 300, y: 100, parent: ID(1), data: { text: '   ' } }),
		shape2(ID(4), { x: 10, y: 400, parent: ID(1), data: { text: 'Form' } }),
		shape2(ID(5), { x: 300, y: 400, parent: ID(1), data: { text: '' } }),
		textItem(ID(6), { x: 2000, y: 0, data: { text: 'Lose' } }),
		connector(ID(7), { x: 0, y: 0 }, { x: 10, y: 10 }, { data: { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, route: 'straight', label: 'Linie' } }),
		{ id: ID(8), t: 'table', x: 3000, y: 0, w: 400, h: 200, r: 0, z: 'i1', parent: null, data: { cols: {}, rows: {}, cells: {} }, style: {} },
	])
	const o = boardOutline(m, [{ id: ID(1), title: 'Ideen' }])
	assert.deepEqual(titles(o), [[ID(1), 'Ideen', ['Kaffee\nmehr', 'Form']], [null, '', ['Lose']]])
	assert.deepEqual(o.sections[0].items.map((p) => p.kind), ['sticky', 'shape'])
	const other = { ids: () => [ID(9), ID(10)], get: (id) => ({ id, t: id === ID(9) ? 'mindmap' : 'ai', parent: null, data: { text: 'x', md: 'x' } }), has: () => true, abs: () => ({ x: 0, y: 0, w: 1, h: 1, r: 0 }), sortByOrder: (x) => x }
	assert.deepEqual(boardOutline(other, []).sections, [], 'mind maps and AI cards give no point')
})

test('AK1: every frame shows, also without points; its shown title comes from frames(); no loose section without loose points', () => {
	const m = model([
		frame(ID(1), { x: 0, y: 0, z: 'a0', data: { title: '' } }),
		frame(ID(2), { x: 1000, y: 0, z: 'a1', data: { title: 'Zwei' } }),
		sticky(ID(3), { x: 1010, y: 10, parent: ID(2), data: { text: 'a' } }),
	])
	const o = boardOutline(m, [{ id: ID(1), title: 'Frame 1' }, { id: ID(2), title: 'Zwei' }])
	assert.deepEqual(titles(o), [[ID(1), 'Frame 1', []], [ID(2), 'Zwei', ['a']]])
	assert.deepEqual(boardOutline(model([]), []).sections, [])
	assert.deepEqual(boardOutline(null, []).sections, [])
})

test('AK2: frames and points in reading order (two frames side by side, three notes in two rows)', () => {
	const m = model([
		frame(ID(1), { x: 1000, y: 0, w: 800, h: 800, z: 'a0', data: { title: 'Rechts' } }),
		frame(ID(2), { x: 0, y: 0, w: 800, h: 800, z: 'a1', data: { title: 'Links' } }),
		sticky(ID(3), { x: 400, y: 400, parent: ID(2), data: { text: 'unten' } }),
		sticky(ID(4), { x: 400, y: 10, parent: ID(2), data: { text: 'oben rechts' } }),
		sticky(ID(5), { x: 10, y: 10, parent: ID(2), data: { text: 'oben links' } }),
		sticky(ID(6), { x: 1010, y: 10, parent: ID(1), data: { text: 'r' } }),
		sticky(ID(7), { x: 5000, y: 5000, data: { text: 'lose 2' } }),
		sticky(ID(8), { x: 5000, y: 3000, data: { text: 'lose 1' } }),
	])
	const o = boardOutline(m, [{ id: ID(1), title: 'Rechts' }, { id: ID(2), title: 'Links' }])
	assert.deepEqual(titles(o), [
		[ID(2), 'Links', ['oben links', 'oben rechts', 'unten']],
		[ID(1), 'Rechts', ['r']],
		[null, '', ['lose 1', 'lose 2']],
	])
})

const FIXED = {
	sections: [
		{ frame: 'f1', title: 'Ideen', items: [{ id: 'a', kind: 'sticky', text: 'Kaffee\nmehr\n\nKuchen' }, { id: 'b', kind: 'text', text: 'Tee' }] },
		{ frame: 'f2', title: 'Leer', items: [] },
		{ frame: null, title: '', items: [{ id: 'c', kind: 'shape', text: 'Lose' }] },
	],
}

test('AK3: outlineText gives the plain text exactly', () => {
	assert.equal(outlineText(FIXED, ' Retro ', 'Not in a frame'), [
		'Retro',
		'',
		'Ideen',
		'- Kaffee',
		'  mehr',
		'',
		'  Kuchen',
		'- Tee',
		'',
		'Leer',
		'',
		'Not in a frame',
		'- Lose',
		'',
	].join('\n'))
	assert.equal(outlineText({ sections: [] }, 'Retro', 'x'), 'Retro\n')
})

test('AK3: outlineMarkdown gives the Markdown exactly', () => {
	assert.equal(outlineMarkdown(FIXED, 'Retro #1', 'Not in a frame'), [
		'# Retro \\#1',
		'',
		'## Ideen',
		'',
		'- Kaffee',
		'  mehr',
		'',
		'  Kuchen',
		'- Tee',
		'',
		'## Leer',
		'',
		'## Not in a frame',
		'',
		'- Lose',
		'',
	].join('\n'))
	assert.equal(outlineMarkdown({ sections: [] }, 'Retro', 'x'), '# Retro\n', 'an empty board: only the title line')
})

test('AK3: mdEscape turns HTML, links, headings, list markers, emphasis and table pipes into literal text', () => {
	assert.equal(mdEscape('<img src=x onerror=alert(1)>'), '\\<img src=x onerror=alert(1)\\>')
	assert.equal(mdEscape('[a](javascript:x)'), '\\[a\\](javascript:x)')
	assert.equal(mdEscape('# Titel'), '\\# Titel')
	assert.equal(mdEscape('1. Punkt'), '1\\. Punkt')
	assert.equal(mdEscape('12) Punkt'), '12\\) Punkt')
	assert.equal(mdEscape('**fett**'), '\\*\\*fett\\*\\*')
	assert.equal(mdEscape('a|b'), 'a\\|b')
	assert.equal(mdEscape('x\n- y\n+ z\n==='), 'x\n\\- y\n\\+ z\n\\===')
	assert.equal(mdEscape('a\\b `c` _d_ ~e~'), 'a\\\\b \\`c\\` \\_d\\_ \\~e\\~')
	assert.equal(mdEscape('Kaffee - mehr 1. Wahl'), 'Kaffee - mehr 1. Wahl', 'only at the start of a line')
})

test('AK3: a point text in the Markdown cannot start a new heading; (job 279) its own list items stay list items', () => {
	const md = outlineMarkdown({ sections: [{ frame: null, title: '', items: [{ id: 'a', kind: 'sticky', text: 'x\n- y\n# z' }] }] }, 'B', 'Lose')
	assert.equal(md, '# B\n\n## Lose\n\n- x\n  - y\n  \\# z\n')
})

test('AK7: nextView – the switch, the narrow toggle, and the ways back to the board', () => {
	assert.equal(nextView('board', 'outline'), 'outline')
	assert.equal(nextView('outline', 'board'), 'board')
	assert.equal(nextView('board', 'toggle'), 'outline')
	assert.equal(nextView('outline', 'toggle'), 'board')
	for (const e of ['escape', 'jump', 'search', 'follow', 'thread']) {
		assert.equal(nextView('outline', e), 'board', e)
		assert.equal(nextView('board', e), 'board', e)
	}
	assert.equal(nextView('outline', 'something'), 'outline')
	assert.equal(nextView(undefined, 'something'), 'board')
})
