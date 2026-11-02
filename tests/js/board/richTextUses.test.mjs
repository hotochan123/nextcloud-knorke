/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 279 (AK7, AK8): where the text goes without its Markdown
 * marks – the board search (hits and snippets), the CSV column Text, the
 * outline's view text and "Copy as text" – and where it keeps them ("Download
 * as Markdown"); the context bar's buttons (B, I, S, list while an editor
 * with Markdown is open, "Open link" with links) and openLink's guard.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { searchBoard } from '../../../src/board/search.js'
import { csvRow } from '../../../src/board/exportCsv.js'
import { outlineMarkdown, outlineText } from '../../../src/board/outline.js'
import { FORMAT_ITEMS, barGroups } from '../../../src/components/contextbar.js'
import { openLink } from '../../../src/util/openLink.js'
import { ID, frame, shape, sticky, textItem } from './fakes.mjs'

function model(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

test('AK8 search: "fett" finds **fett**, the snippet has no marks; a cell too; a frame title stays as typed', () => {
	const m = model([
		sticky(ID(1), { x: 0, y: 0, data: { text: 'ganz **fett** hier' } }),
		shape(ID(2), { x: 0, y: 300, data: { kind: 'rect', text: '[Doku](https://x.de)' } }),
		textItem(ID(3), { x: 0, y: 600, data: { text: '~~alt~~ neu' } }),
		frame(ID(4), { x: 0, y: 900, z: 'a0', data: { title: '**Titel**' } }),
	])
	const fett = searchBoard(m, [], 'fett').hits
	assert.equal(fett.length, 1)
	assert.equal(fett[0].before + fett[0].match + fett[0].after, 'ganz fett hier')
	assert.equal(searchBoard(m, [], '**').hits.map((h) => h.item).join(), ID(4), 'only the frame title still has the stars')
	assert.equal(searchBoard(m, [], 'x.de').hits.length, 1, 'the address of a link is found too')
	assert.equal(searchBoard(m, [], 'alt neu').hits.length, 1)
})

test('AK8 CSV: the text column without marks', () => {
	const m = model([sticky(ID(1), { data: { text: '- **a**\n- [b](https://b.de)' } })])
	assert.equal(csvRow(m, ID(1), null)[1], '- a\n- b (https://b.de)')
})

test('AK8 outline: view and "Copy as text" without marks, "Download as Markdown" keeps them', () => {
	const o = { sections: [{ frame: null, title: '', items: [{ id: 'a', kind: 'sticky', text: '**fett** <b>x</b>' }] }] }
	assert.equal(outlineText(o, 'B', 'Lose'), 'B\n\nLose\n- fett <b>x</b>\n')
	assert.equal(outlineMarkdown(o, 'B', 'Lose'), '# B\n\n## Lose\n\n- **fett** \\<b\\>x\\</b\\>\n')
})

test('AK7 context bar: B, I, S and list while an editor with Markdown is open; "Open link" with links', () => {
	assert.deepEqual([...FORMAT_ITEMS], ['bold', 'italic', 'strike', 'list'])
	const one = { ids: ['a'], count: 1, types: new Set(['sticky']), fields: ['style.fill'], mixed: [] }
	assert.deepEqual(barGroups({ ...one, richEditing: true }), [['bold', 'italic', 'strike', 'list']])
	assert.ok(!barGroups(one).flat().includes('link'))
	assert.ok(barGroups({ ...one, links: [{ text: 'x', href: 'https://x.de' }] }).flat().includes('link'))
	assert.ok(!barGroups(one).flat().includes('bold'))
})

test('AK7 openLink: only http, https and mailto, in a new tab without opener', () => {
	const calls = []
	const win = { open: (...a) => calls.push(a) }
	assert.equal(openLink('https://x.de', win), true)
	assert.equal(openLink('mailto:a@b.de', win), true)
	assert.equal(openLink('javascript:alert(1)', win), false)
	assert.equal(openLink('data:text/html,x', win), false)
	assert.deepEqual(calls, [['https://x.de', '_blank', 'noopener,noreferrer'], ['mailto:a@b.de', '_blank', 'noopener,noreferrer']])
})
