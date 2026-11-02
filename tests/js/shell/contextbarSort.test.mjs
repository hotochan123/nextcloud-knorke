/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Sort by color" in the shell (factory job 139, AK5): the command in the
 * align panel after "Tidy up" and "Sort notes by color" before "Arrange"
 * (rendered with @vue/server-renderer), the context menu entries, the icon,
 * the German texts; and the name fields (SortLabels.vue): place, keys,
 * presses outside, Esc.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contextSections, MENU_ITEMS, menuEntries, menuLabel, menuShortcut } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { TYPES } from '../../../src/model/registry.js'
import { panelOf } from './contextbarHtml.mjs'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default
const SortLabels = (await import('../../../src/components/SortLabels.vue')).default

const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

/**
 * @param {string[]} types selected types
 * @param {object} [extra] selection keys
 * @return {object} selection v2 like BoardSession.selectionInfo
 */
function sel(types, extra = {}) {
	let fields = null
	for (const t of new Set(types)) {
		const own = Object.keys(TYPES[t]?.fields ?? {})
		fields = fields === null ? own : fields.filter((p) => own.includes(p))
	}
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: { x: 0, y: 0, w: 500, h: 200, r: 0 }, ...extra }
}

/** ContextBar whose panel is "Align items" from the start. */
const WithAlignPanel = {
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		b.toggle('align')
		return b
	},
}

/** @return {string[]} the commands of the open panel in document order */
function panelCommands(html) {
	return [...panelOf(html).matchAll(/data-knorke-(align|distribute|action)="([a-z-]+)"/g)].map((m) => m[1] + ':' + m[2])
}

test('job 139 AK5: sortable 2 → "Sort by color" [data-knorke-action=sort-colors] right after "Tidy up" in the align panel, named, a command; sortable 1 or missing → not there', async () => {
	const html = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'sticky'], { alignable: 2, sortable: 2 }) }))
	const cmds = panelCommands(html)
	assert.deepEqual(cmds.slice(-2), ['action:tidy', 'action:sort-colors'])
	const tags = html.match(/<div[^>]*data-stub="NcButton"[^>]*data-knorke-action="sort-colors"[^>]*>/g) ?? []
	assert.equal(tags.length, 1)
	assert.match(tags[0], /aria-label="Sort by color"/)
	assert.match(tags[0], /title="Sort by color"/)
	assert.match(tags[0], /variant="tertiary"/)
	assert.doesNotMatch(tags[0], /pressed=/)
	// in the same row as "Tidy up"
	const row = panelOf(html).match(/<div class="knorke-contextbar__row">(?:(?!<div class="knorke-contextbar__row">)[\s\S])*data-knorke-action="tidy"[\s\S]*?data-knorke-action="sort-colors"/)
	assert.ok(row, 'one row holds tidy and sort-colors')
	// job 230: outside the panel only the entry of "…"
	assert.deepEqual(html.replace(panelOf(html), '').match(/<div[^>]*data-knorke-action="sort-colors"[^>]*>/g)?.map((x) => /data-stub="(\w+)"/.exec(x)[1]), ['NcActionButton'])
	for (const extra of [{ alignable: 2, sortable: 1 }, { alignable: 2 }, { alignable: 2, sortable: '2' }]) {
		const h = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'sticky'], extra) }))
		assert.doesNotMatch(h, /sort-colors|Sort by color/, JSON.stringify(extra))
		assert.equal(panelCommands(h).at(-1), 'action:tidy')
	}
})

test('job 139 AK5, job 230: frameSortable 2 → "Sort notes by color" [data-knorke-action=sort-frame] in "…" right after "Arrange…", named, a command; 1 or missing → not there', async () => {
	const html = strip(await render(ContextBar, { selection: sel(['frame'], { frameSortable: 2 }) }))
	const order = [...html.matchAll(/data-knorke-action="([a-z-]+)"/g)].map((m) => m[1])
	assert.equal(order.indexOf('arrange') + 1, order.indexOf('sort-frame'), 'directly after arrange: ' + order.join(','))
	const tag = html.match(/<div[^>]*data-knorke-action="sort-frame"[^>]*>/)[0]
	assert.match(tag, /data-stub="NcActionButton"/)
	assert.match(tag, /title="Sort notes by color"/)
	assert.match(html, /data-knorke-action="sort-frame"[^>]*>(?:<div[^>]*><\/div>)?\s*Sort notes by color/)
	assert.doesNotMatch(tag, /pressed=|aria-expanded/)
	for (const extra of [{ frameSortable: 1 }, {}, { frameSortable: 0 }]) {
		const h = strip(await render(ContextBar, { selection: sel(['frame'], extra) }))
		assert.doesNotMatch(h, /sort-frame|Sort notes by color/, JSON.stringify(extra))
		assert.match(h, /data-knorke-action="arrange"/)
	}
	assert.deepEqual([contextSections(sel(['frame'], { frameSortable: 2 })).sortFrame, contextSections(sel(['sticky'], { sortable: 2 })).sortColors], [true, true])
	assert.deepEqual([contextSections(sel(['frame'])).sortFrame, contextSections(sel(['sticky'])).sortColors], [false, false], 'a selection v2 without the keys')
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /defineEmits\(\[[^\]]*'sort-colors', 'sort-frame'/)
})

test('job 139 AK5, job 230: the context menu on items lists sort-colors / sort-frame after connect and arrange, before group, with the bar\'s texts and no shortcut', () => {
	assert.deepEqual(MENU_ITEMS.slice(MENU_ITEMS.indexOf('connect'), MENU_ITEMS.indexOf('group') + 1), ['connect', 'arrange', 'sort-colors', 'sort-frame', 'group'])
	const two = sel(['sticky', 'sticky'], { canConnect: true, sortable: 2, groupable: 2, grouped: 0, oneGroup: false })
	const list = menuEntries(two, 'id0')
	assert.deepEqual(list.slice(list.indexOf('connect'), list.indexOf('group') + 1), ['connect', 'sort-colors', 'group'])
	const f = menuEntries(sel(['frame'], { frameSortable: 3 }), 'id0')
	assert.deepEqual(f.slice(-8), ['arrange', 'sort-frame', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'])
	assert.ok(!menuEntries(sel(['sticky', 'sticky'], { sortable: 1 }), 'id0').includes('sort-colors'))
	assert.ok(!menuEntries(sel(['sticky', 'sticky']), 'id0').includes('sort-colors'), 'without the key')
	assert.ok(!menuEntries(sel(['frame'], { frameSortable: 1 }), 'id0').includes('sort-frame'))
	assert.ok(!menuEntries(sel([], { sortable: 5, frameSortable: 5 }), null, { items: 3 }).some((e) => e.startsWith('sort')), 'never in the board menu')
	assert.equal(menuLabel('sort-colors'), 'Sort by color')
	assert.equal(menuLabel('sort-frame'), 'Sort notes by color')
	for (const apple of [true, false]) {
		assert.equal(menuShortcut('sort-colors', apple), null)
		assert.equal(menuShortcut('sort-frame', apple), null)
	}
})

test('job 139 AK5: icons.sortColors is an icon of its own; the German texts are in l10n/de.json', () => {
	assert.equal(typeof icons.sortColors, 'string')
	assert.ok(icons.sortColors.length > 20)
	for (const [k, p] of Object.entries(icons)) {
		if (k !== 'sortColors') {
			assert.notEqual(p, icons.sortColors, k)
		}
	}
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Sort by color'], 'Nach Farbe sortieren')
	assert.equal(de['Sort notes by color'], 'Notizen nach Farbe sortieren')
	assert.equal(de['Name this group…'], 'Gruppe benennen …')
})

/**
 * SortLabels' setup with two open blocks, without a DOM.
 *
 * @param {Array} [places] what the session's sortLabelPlaces gives
 * @return {{bindings: object, emitted: Array}}
 */
function labelsSetup(places = [{ i: 0, color: '#fff6b6', x: 10.4, y: 100, w: 420 }, { i: 1, color: '#a8d8f8', x: 530, y: 100, w: 80 }]) {
	const labels = [{ i: 0, color: '#fff6b6', x: 0, y: 0, w: 420, h: 200, parent: null }, { i: 1, color: '#a8d8f8', x: 520, y: 0, w: 80, h: 200, parent: null }]
	return setupOf(SortLabels, { labels, places: () => places })
}

/** A fake field element. */
function field(value = '') {
	const el = { value, focused: 0, focus() { el.focused++ } }
	return el
}

/** A fake keydown in a field. */
function key(name, target, extra = {}) {
	const e = { key: name, target, shiftKey: false, isComposing: false, prevented: false, preventDefault() { e.prevented = true }, ...extra }
	return e
}

test('job 139 name fields: placed from the session\'s places at the first render – left on the block, bottom 8 px above it, the block\'s width but at least 120 px', async () => {
	const { bindings } = labelsSetup()
	assert.deepEqual([...bindings.pos.value], [[0, { left: 10, top: 92, width: 420 }], [1, { left: 530, top: 92, width: 120 }]])
	assert.deepEqual(bindings.styleOf(1), { left: '530px', top: '92px', width: '120px' })
	const html = strip(await render(SortLabels, { labels: [{ i: 0, color: '#fff6b6', x: 0, y: 0, w: 420, h: 200, parent: null }], places: () => [{ i: 0, color: '#fff6b6', x: 0, y: 50, w: 420 }] }))
	const input = html.match(/<input[^>]*>/)[0]
	for (const a of ['data-knorke-sort-label', 'data-knorke-sort-color="#fff6b6"', 'placeholder="Name this group…"', 'aria-label="Name this group…"', 'type="text"']) {
		assert.ok(input.includes(a), a + ' in ' + input)
	}
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /input\.knorke-sortlabel \{[^}]*height: 32px !important;[^}]*font-size: 16px !important;[^}]*background: var\(--color-background-dark/)
	assert.match(css, /input\.knorke-sortlabel::placeholder \{[^}]*color: var\(--color-text-maxcontrast/)
	assert.match(css, /@media \(pointer: coarse\) \{\s*input\.knorke-sortlabel \{\s*height: 44px !important;/)
})

test('job 139 name fields: Enter with a name emits name and gives the canvas the focus, an empty Enter nothing; Tab saves and goes round the fields; blur with a name saves', () => {
	const { bindings, emitted } = labelsSetup()
	const [a, b] = [field(), field()]
	bindings.setField(0, a)
	bindings.setField(1, b)
	let e = key('Enter', a)
	bindings.onKey(e, 0)
	assert.equal(e.prevented, true)
	assert.deepEqual(emitted, [], 'empty Enter: nothing')
	a.value = ' Ideas '
	bindings.onKey(key('Enter', a, { isComposing: true }), 0)
	assert.deepEqual(emitted, [], 'not while composing')
	bindings.onKey(key('Enter', a), 0)
	assert.deepEqual(emitted, [['name', 0, ' Ideas '], ['canvas']])
	emitted.length = 0
	// Tab from an empty field: the next one, round the list
	a.value = ''
	b.value = ''
	e = key('Tab', b)
	bindings.onKey(e, 1)
	assert.equal(e.prevented, true)
	assert.equal(a.focused, 1, 'from the last to the first')
	assert.deepEqual(emitted, [])
	bindings.onKey(key('Tab', a, { shiftKey: true }), 0)
	assert.equal(b.focused, 1, 'Shift+Tab: the previous one')
	// Tab from a named field saves it
	b.value = 'Later'
	bindings.onKey(key('Tab', b), 1)
	assert.deepEqual(emitted, [['name', 1, 'Later']])
	assert.equal(a.focused, 2)
	emitted.length = 0
	bindings.onBlur({ target: { value: '  ' } }, 0)
	assert.deepEqual(emitted, [], 'blur without a name')
	bindings.onBlur({ target: { value: 'X' } }, 0)
	assert.deepEqual(emitted, [['name', 0, 'X']])
	// one named field left alone: Tab saves it and gives the canvas the focus
	const single = labelsSetup([{ i: 0, color: '#fff6b6', x: 0, y: 0, w: 420 }])
	const c = field('Solo')
	single.bindings.setField(0, c)
	single.bindings.onKey(key('Tab', c), 0)
	assert.deepEqual(single.emitted.filter((x) => x[0] !== 'input'), [['name', 0, 'Solo'], ['canvas']])
})

test('job 139 name fields: a press outside the fields ends them, a press on a field does not; Esc in a field or on the canvas ends them, gives the canvas the focus and goes no further', () => {
	const { bindings, emitted } = labelsSetup()
	const inField = { closest: (s) => (s === '[data-knorke-sort-label]' ? {} : null) }
	const elsewhere = { closest: () => null, classList: { contains: () => false } }
	const canvas = { closest: () => null, classList: { contains: (c) => c === 'knorke-canvas' } }
	bindings.onDocDown({ target: inField })
	assert.deepEqual(emitted, [])
	bindings.onDocDown({ target: elsewhere })
	assert.deepEqual(emitted, [['end']])
	emitted.length = 0
	const esc = (target, extra = {}) => {
		const e = { key: 'Escape', target, isComposing: false, prevented: false, stopped: false, preventDefault() { e.prevented = true }, stopPropagation() { e.stopped = true }, ...extra }
		bindings.onDocKey(e)
		return e
	}
	let e = esc(elsewhere)
	assert.deepEqual(emitted, [], 'Esc elsewhere (a dialog, the bar) is not ours')
	assert.equal(e.stopped, false)
	e = esc(inField)
	assert.deepEqual(emitted, [['end'], ['canvas']])
	assert.ok(e.prevented && e.stopped)
	emitted.length = 0
	e = esc(canvas)
	assert.deepEqual(emitted, [['end'], ['canvas']])
	assert.ok(e.prevented && e.stopped, 'the scene does not see it')
	emitted.length = 0
	esc(canvas, { key: 'a' })
	esc(canvas, { isComposing: true })
	assert.deepEqual(emitted, [])
})
