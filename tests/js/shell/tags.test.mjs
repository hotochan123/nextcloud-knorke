/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The shell's part of the tags (factory job 191): components/tags.js (the
 * row "Create “…”", aria-checked, the chip's names), TagPanels.vue (the tag
 * panel: the search field of at most 30 characters, the boxes with three
 * states, the pencil only for people who may edit; the filter panel: counts,
 * "Select all with this tag" only in mode edit, "Clear filter"; the list of
 * "+n"; names as text, never markup), TagFilterChip.vue and the context
 * bar's "Tags" only with taggable. Job 206: "Delete tag" asks no question.
 * Job 213: tagPanelPlace, the panel stays inside the board when the editor
 * opens and above its box while it fits there.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ariaChecked, createOffer, filterNames, shownTags, tagPanelPlace } from '../../../src/components/tags.js'
import { popoverPlace } from '../../../src/components/reactions.js'
import { icons } from '../../../src/components/icons.js'
import { useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const TagPanels = (await import('../../../src/components/TagPanels.vue')).default
const TagFilterChip = (await import('../../../src/components/TagFilterChip.vue')).default
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default
const { t, n } = await import('../../../src/util/l10n.js')

const render = (C, props) => {
	const app = createSSRApp(C, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return renderToString(app)
}
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

const TG = (k) => '01JT' + String(k).padStart(22, '0')
const TAGS = [
	{ id: TG(1), name: 'Kosten', color: '#e53935', count: 2, state: 'on' },
	{ id: TG(2), name: 'Zeit', color: '#fdd835', count: 1, state: 'mixed' },
	{ id: TG(3), name: '<b>x</b>', color: '#1e88e5', count: 0, state: 'off' },
]
const view = (panel, o = {}) => ({ tags: TAGS, mayEdit: true, edit: true, filter: [], busy: false, panel, ...o })

test('components/tags.js: the create row, aria-checked, the chip\'s names, the shown tags', () => {
	assert.equal(createOffer(TAGS, '  Risiko '), 'Risiko')
	assert.equal(createOffer(TAGS, 'kosten'), null, 'a name the board has (any case)')
	assert.equal(createOffer(TAGS, '   '), null)
	assert.equal(createOffer(TAGS, 'x'.repeat(31)), null)
	assert.deepEqual([ariaChecked('on'), ariaChecked('mixed'), ariaChecked('off'), ariaChecked(true), ariaChecked(false)], ['true', 'mixed', 'false', 'true', 'false'])
	assert.deepEqual(filterNames(TAGS, [TG(2), TG(1)]), ['Kosten', 'Zeit'], 'in the panel\'s order')
	assert.deepEqual(shownTags(TAGS, 'ze').map((x) => x.name), ['Zeit'])
})

test('the tag panel: a search field of at most 30 characters, boxes with three states, the pencil only for editors, names as text', async () => {
	const html = strip(await render(TagPanels, { view: view({ kind: 'tag', id: null, rect: null, targets: 2, list: [] }) }))
	assert.match(html, /data-knorke-tag-panel="tag"/)
	assert.match(html, /role="dialog"/)
	assert.match(html, /<input[^>]*maxlength="30"[^>]*data-knorke-tag-search/)
	const checks = [...html.matchAll(/data-knorke-tag-row="([^"]+)"[\s\S]*?aria-checked="(true|mixed|false)"/g)].map((m) => [m[1], m[2]])
	assert.deepEqual(checks, [[TG(3), 'false'], [TG(1), 'true'], [TG(2), 'mixed']], 'sorted by name, the three states')
	assert.equal((html.match(/data-knorke-tag-edit/g) ?? []).length, 3)
	assert.ok(!html.includes('<b>x</b>') && html.includes('&lt;b&gt;x&lt;/b&gt;'), 'a name is text')
	const viewer = strip(await render(TagPanels, { view: view({ kind: 'tag', id: null, rect: null, targets: 1, list: [] }, { mayEdit: false }) }))
	assert.equal((viewer.match(/data-knorke-tag-edit/g) ?? []).length, 0, 'no pencil without the right to edit')
	assert.equal(strip(await render(TagPanels, { view: view(null) })), '', 'no panel')
})

test('the filter panel: a box and the count per tag, "Select all with this tag" only in mode edit, "Clear filter"', async () => {
	const html = strip(await render(TagPanels, { view: view({ kind: 'filter', id: null, rect: null, targets: 0, list: [] }, { filter: [TG(1)] }) }))
	assert.match(html, /data-knorke-tag-panel="filter"/)
	assert.match(html, new RegExp(`data-knorke-tag-filter-row="${TG(1)}"[\\s\\S]*?aria-checked="true"[\\s\\S]*?2 notes`))
	assert.match(html, /1 note</)
	assert.equal((html.match(/data-knorke-tag-select="/g) ?? []).length, 3)
	assert.match(html, /data-knorke-tag-filter-clear[^>]*>\s*Clear filter/)
	const vote = strip(await render(TagPanels, { view: view({ kind: 'filter', id: null, rect: null, targets: 0, list: [] }, { edit: false }) }))
	assert.equal((vote.match(/data-knorke-tag-select="/g) ?? []).length, 0, 'not outside mode edit')
	assert.match(vote, /data-knorke-tag-filter-clear[^>]*disabled/)
})

test('the list of "+n": every tag of the note, in its order', async () => {
	const list = [TAGS[1], TAGS[0]]
	const html = strip(await render(TagPanels, { view: view({ kind: 'list', id: 'n1', rect: { x: 1, y: 2, w: 3, h: 4 }, targets: 0, list }) }))
	assert.match(html, /data-knorke-tag-list="n1"/)
	assert.deepEqual([...html.matchAll(/data-knorke-tag-list-item[^>]*>\s*<span[^>]*>([^<]*)</g)].map((m) => m[1]), ['Zeit', 'Kosten'])
})

test('TagFilterChip names the chosen tags and has "Clear filter"; the context bar\'s "Tags" only with taggable', async () => {
	const chip = strip(await render(TagFilterChip, { names: ['Kosten', 'Zeit'] }))
	assert.match(chip, /data-knorke-tag-filter/)
	assert.match(chip, /Tags: Kosten, Zeit/)
	assert.match(chip, /aria-label="Clear filter"[^>]*data-knorke-action="tag-filter-clear"/, 'job 228: its close button "×" is "Clear filter"')
	const sel = (extra) => ({ count: 1, types: new Set(['sticky']), fields: [], ids: ['a'], unlocked: 1, ...extra })
	const on = strip(await render(ContextBar, { selection: sel({ taggable: 1 }) }))
	assert.match(on, /data-knorke-action="tags"/)
	assert.ok(on.slice(on.indexOf('data-knorke-action="tags"')).includes(`path="${icons.tag}"`))
	assert.doesNotMatch(strip(await render(ContextBar, { selection: sel({ taggable: 0 }) })), /data-knorke-action="tags"/)
})

test('job 206 AK6: "Delete tag" deletes at once: the tag panel has no delete question', async () => {
	const src = readFileSync(new URL('../../../src/components/TagPanels.vue', import.meta.url), 'utf8')
	assert.ok(!src.includes('ConfirmDialog'), 'no ConfirmDialog')
	assert.ok(!src.includes('data-knorke-dialog="tag-delete"'), 'no dialog tag-delete')
	assert.match(src, /data-knorke-tag-delete\s+@click="remove"/)
})

test('job 213 AK3: tagPanelPlace below as popoverPlace, above when only there is room, stays above while it fits, pushed in otherwise', () => {
	const board = { w: 1000, h: 800 }
	const box = (y) => ({ x: 100, y, w: 24, h: 24 })
	// (a) room below: the same as popoverPlace
	assert.deepEqual(tagPanelPlace(box(300), { w: 300, h: 50 }, board, false), { ...popoverPlace(box(300), { w: 300, h: 50 }, board), above: false })
	assert.deepEqual(tagPanelPlace(box(300), { w: 300, h: 50 }, board, false), { x: 100, y: 330, above: false })
	// (b) room only above: its bottom 6 px above the box
	assert.deepEqual(tagPanelPlace(box(760), { w: 300, h: 50 }, board, false), { x: 100, y: 704, above: true })
	// (c) above so far, shorter, would fit below too: stays above, its bottom at the box
	assert.deepEqual(tagPanelPlace(box(400), { w: 300, h: 100 }, board, true), { x: 100, y: 294, above: true })
	assert.deepEqual(tagPanelPlace(box(400), { w: 300, h: 100 }, board, false), { x: 100, y: 430, above: false }, 'without above: below')
	// (d) above so far, no room above any more: popoverPlace
	assert.deepEqual(tagPanelPlace(box(100), { w: 300, h: 200 }, board, true), { x: 100, y: 130, above: false })
	// (e) room neither above nor below: pushed into the board
	const e = tagPanelPlace(box(400), { w: 300, h: 500 }, board, true)
	assert.ok(e.y >= 8 && e.y + 500 <= 792, JSON.stringify(e))
	assert.equal(e.above, false)
	// (d) above so far, the board got lower than the box (screen keyboard, rotation): pushed in like popoverPlace
	const low = tagPanelPlace(box(760), { w: 300, h: 284 }, { w: 1000, h: 650 }, true)
	assert.deepEqual(low, { ...popoverPlace(box(760), { w: 300, h: 284 }, { w: 1000, h: 650 }), above: true })
	assert.ok(low.y >= 8 && low.y + 284 <= 642, 'inside the lower board: ' + JSON.stringify(low))
	assert.deepEqual(tagPanelPlace(box(760), { w: 300, h: 284 }, { w: 1000, h: 650 }, low.above), low, 'stable on the next measure')
	// x as popoverPlace: pushed in from the right
	assert.equal(tagPanelPlace({ x: 900, y: 760, w: 24, h: 24 }, { w: 300, h: 50 }, board, true).x, 692)
	// (f) without box, size or board: popoverPlace, not above
	assert.deepEqual(tagPanelPlace(null, { w: 300, h: 50 }, board, true), { x: 350, y: 375, above: false })
	assert.deepEqual(tagPanelPlace(box(300), null, board, true), { x: 100, y: 330, above: false })
	assert.deepEqual(tagPanelPlace(box(300), { w: 300, h: 50 }, null, true), { x: 100, y: 330, above: false })
})

test('job 213 AK3: the bug\'s case: a list below a low box, the taller editor goes above inside the board, the list after Cancel stays above', () => {
	const board = { w: 1366, h: 650 }
	const bar = { x: 400, y: 470, w: 32, h: 32 }
	const list = tagPanelPlace(bar, { w: 300, h: 130 }, board, false)
	assert.deepEqual(list, { x: 400, y: 508, above: false }, 'the list fits below the button')
	const editor = tagPanelPlace(bar, { w: 300, h: 290 }, board, list.above)
	assert.ok(editor.y >= 8 && editor.y + 290 <= 642, 'the editor inside the board: ' + JSON.stringify(editor))
	assert.deepEqual(editor, { x: 400, y: 174, above: true })
	const back = tagPanelPlace(bar, { w: 300, h: 130 }, board, editor.above)
	assert.deepEqual(back, { x: 400, y: 334, above: true }, 'after Cancel: above, its bottom 6 px above the button')
	// round 1: the window gets lower while the editor stands above (screen keyboard): it stays inside the board
	const lower = tagPanelPlace(bar, { w: 300, h: 290 }, { w: 1366, h: 420 }, editor.above)
	assert.ok(lower.y >= 8 && lower.y + 290 <= 412, 'the editor inside the lower board: ' + JSON.stringify(lower))
})
