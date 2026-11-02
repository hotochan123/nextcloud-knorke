/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Filter the selection in the context bar (factory job 144, AK3 and AK5),
 * rendered with @vue/server-renderer: with selection v2 kinds the count is
 * the button [data-knorke-action=filter] ("3 selected", title "Filter
 * selection", aria-expanded, aria-controls), without kinds the plain text
 * of before; the open panel 'filter' follows the button directly with one
 * [data-knorke-filter=<kind>] button per entry in the order of kinds. An
 * entry closes the panel and emits filter(kind, event); the panel also
 * closes on the second press, another selection and when kinds goes empty.
 * The board view wires @filter like Lock (the canvas gets the focus); the
 * count button and its entries are finger-sized on phones and coarse
 * pointers. German: "Nur Notizen (5)", "Auswahl filtern".
 *
 * Job 230: the count is the chip in front of the bar (title and panel name
 * "Narrow selection", German "Auswahl eingrenzen"), 36 px high with pen or
 * finger; its panel follows it directly and lists, under "By tag", the
 * tags of the selected notes (selection v2 tags, contextbar.js
 * narrowEntries) as [data-knorke-filter-tag=<id>] buttons that emit
 * filter-tag(id, event).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register, unregister } from '@nextcloud/l10n'
import { parse } from '@vue/compiler-dom'
import { FILTER_KINDS, canNarrow, filterEntries, filterLabel, narrowEntries } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { TYPES } from '../../../src/model/registry.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp, nextTick, reactive } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default

const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')
const DE = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
const PANEL_ID = 'knorke-contextbar-panel'

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

/** The kinds of the spec's selection F. */
const F_KINDS = Object.freeze([{ kind: 'sticky', count: 5 }, { kind: 'shape', count: 2 }, { kind: 'connector', count: 1 }, { kind: 'group', count: 1 }])
/** A selection v2 like F's (the style keys of its unlocked items do not matter here). */
const selF = () => sel(['sticky', 'sticky', 'sticky', 'sticky', 'shape', 'shape', 'connector', 'sticky', 'widget'], { kinds: F_KINDS, locked: 1, unlocked: 8 })

/** ContextBar whose panel 'filter' is open from the start (its own toggle, before the render). */
const WithFilterPanel = {
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		b.toggle('filter')
		return b
	},
}

/** @return {string} the count button's tag with its content */
const countButton = (html) => html.match(/<button[^>]*data-knorke-action="filter"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
/** @return {string} the visible text of an element (tags dropped, blanks collapsed) */
const textOf = (el) => el.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

test('job 144 AK3, job 230: two entries in kinds → the count is the chip button[data-knorke-action=filter] "3 selected" with the chevron, title "Narrow selection", aria-expanded="false", aria-controls the panel id; the first child of the bar', async () => {
	const html = strip(await render(ContextBar, { selection: sel(['sticky', 'sticky', 'shape'], { kinds: [{ kind: 'sticky', count: 2 }, { kind: 'shape', count: 1 }] }) }))
	assert.equal((html.match(/data-knorke-action="filter"/g) ?? []).length, 1)
	const btn = countButton(html)
	const tag = btn.match(/^<button[^>]*>/)[0]
	assert.match(tag, /type="button"/)
	assert.match(tag, /class="knorke-contextbar__filter"/)
	assert.match(tag, /title="Narrow selection"/)
	assert.match(tag, /aria-expanded="false"/)
	assert.match(tag, new RegExp(`aria-controls="${PANEL_ID}"`))
	assert.equal(textOf(btn), '3 selected', 'named by its text, the count of before')
	assert.ok(btn.includes(`path="${icons.chevronDown}"`), 'icons.chevronDown')
	assert.doesNotMatch(html, /knorke-contextbar__count/, 'no plain count beside it')
	assert.ok(html.replace(/^<div[^>]*>/, '').startsWith(btn), 'job 230: the chip is the first child of the bar')
	assert.doesNotMatch(html, /data-knorke-panel=/, 'no panel yet')
})

test('job 144 AK3: without kinds, with [] or with no known entry the count stays the span of before (no tab stop)', async () => {
	for (const extra of [{}, { kinds: [] }, { kinds: [{ kind: 'image', count: 2 }, { kind: 'sticky', count: 0 }] }, { kinds: 'sticky' }]) {
		const html = strip(await render(ContextBar, { selection: sel(['sticky', 'shape'], extra) }))
		assert.match(html, /^<div[^>]*><span class="knorke-contextbar__count">2 selected<\/span>/, JSON.stringify(extra) + ': the first child')
		assert.doesNotMatch(html, /data-knorke-action="filter"|Narrow selection/, JSON.stringify(extra))
	}
	assert.deepEqual(filterEntries({ kinds: [{ kind: 'shape', count: 2 }, { kind: 'shape', count: 1.5 }, null, { kind: 'group', count: 1 }] }), [{ kind: 'shape', count: 2 }, { kind: 'group', count: 1 }])
	assert.deepEqual(FILTER_KINDS, ['sticky', 'shape', 'text', 'connector', 'frame', 'group'])
})

test('job 144 AK3, job 230: the open panel [data-knorke-panel=filter] follows the chip directly (aria-expanded="true"), role group, named "Narrow selection"; its [data-knorke-filter] buttons in the order of kinds with their texts', async () => {
	const html = strip(await render(WithFilterPanel, { selection: selF() }))
	const btn = countButton(html)
	assert.match(btn, /aria-expanded="true"/)
	const start = html.indexOf(btn) + btn.length
	assert.ok(html.slice(start).startsWith(`<div id="${PANEL_ID}"`), 'the panel follows the button directly: one Tab leads into it')
	assert.equal((html.match(new RegExp(`id="${PANEL_ID}"`, 'g')) ?? []).length, 1, 'one panel')
	const panel = html.slice(start)
	const open = panel.match(/^<div[^>]*>/)[0]
	assert.match(open, /class="knorke-contextbar__panel knorke-contextbar__panel--filter"/)
	assert.match(open, /role="group"/)
	assert.match(open, /aria-label="Narrow selection"/)
	assert.match(open, /data-knorke-panel="filter"/)
	const entries = [...panel.matchAll(/<button([^>]*)data-knorke-filter="([a-z]+)"[^>]*>([^<]*)<\/button>/g)]
	assert.deepEqual(entries.map((m) => m[2]), ['sticky', 'shape', 'connector', 'group'])
	assert.deepEqual(entries.map((m) => m[3].trim()), ['Only notes (5)', 'Only shapes (2)', 'Only connectors (1)', 'Only groups (1)'])
	assert.ok(entries.every((m) => /type="button"/.test(m[0]) && /class="knorke-contextbar__filteritem"/.test(m[0])))
	// every kind's text; the numbers follow selection v2
	const all = strip(await render(WithFilterPanel, { selection: sel(['text', 'frame', 'sticky'], { kinds: [{ kind: 'sticky', count: 3 }, { kind: 'text', count: 12 }, { kind: 'frame', count: 2 }] }) }))
	assert.deepEqual([...all.matchAll(/data-knorke-filter="([a-z]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]),
		[['sticky', 'Only notes (3)'], ['text', 'Only text items (12)'], ['frame', 'Only frames (2)']])
	assert.equal(filterLabel('connector', 7), 'Only connectors (7)')
	assert.equal(filterLabel('group', 2), 'Only groups (2)')
	assert.equal(filterLabel('image', 2), 'image')
})

test('job 144 AK3: toggle(\'filter\') opens and closes the panel; an entry closes it and emits filter(kind, event), also when nothing changes', () => {
	const { bindings, emitted } = setupOf(ContextBar, { selection: selF() })
	assert.deepEqual(bindings.narrow.value.kinds, F_KINDS)
	bindings.toggle('filter')
	assert.equal(bindings.panel.value, 'filter')
	assert.equal(bindings.panelLabel.value, 'Narrow selection')
	bindings.toggle('filter')
	assert.equal(bindings.panel.value, null, 'the second press closes it')
	bindings.toggle('align')
	bindings.toggle('filter')
	assert.equal(bindings.panel.value, 'filter', 'one panel at a time')
	const ev = { type: 'click', detail: 1 }
	bindings.pickFilter('group', ev)
	assert.equal(bindings.panel.value, null)
	assert.deepEqual(emitted, [['filter', 'group', ev]])
})

test('job 144 AK3: the panel closes with another selection and as soon as kinds goes empty; the same ids keep it open with live numbers', async () => {
	const props = reactive({ selection: selF() })
	const { bindings } = setupOf(ContextBar, props)
	bindings.toggle('filter')
	props.selection = { ...selF(), kinds: [{ kind: 'sticky', count: 4 }, { kind: 'shape', count: 2 }] }
	await nextTick()
	assert.equal(bindings.panel.value, 'filter', 'same ids: still open')
	assert.deepEqual(bindings.narrow.value.kinds, [{ kind: 'sticky', count: 4 }, { kind: 'shape', count: 2 }], 'the numbers follow')
	props.selection = { ...selF(), kinds: [] }
	await nextTick()
	assert.equal(bindings.panel.value, null, 'kinds empty: closed')
	props.selection = selF()
	bindings.toggle('filter')
	props.selection = { ...selF(), ids: ['id0', 'id1'] }
	await nextTick()
	assert.equal(bindings.panel.value, null, 'another selection: closed')
})

test('job 144 AK3: the board view wires @filter like Lock (filterSelection, then the canvas gets the focus after a pointer and a key); ContextBar emits filter', () => {
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /defineEmits\(\[[^\]]*'filter'/)
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	const ast = parse(view.match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
	const find = (node) => {
		for (const c of node.children ?? []) {
			if (c.type === 1 && c.tag === 'ContextBar') return c
			const f = find(c)
			if (f) return f
		}
		return null
	}
	const on = find(ast).props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'filter')
	assert.ok(on, 'ContextBar @filter')
	assert.equal(on.exp.content, '(k) => lockAct((s) => s.filterSelection(k))')
	assert.match(view, /function lockAct\(fn\) \{\n\tconst s = session\.value\n\tif \(!s\) \{\n\t\treturn\n\t\}\n\tfn\(s\)\n\ts\.focusCanvas\(\)\n\}/, 'lockAct focuses the canvas either way')
})

test('job 144 AK3, job 230: on phones and coarse pointers the chip is 44 px high and every entry at least 44 px high (knorke.css)', () => {
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	const blocks = [...css.matchAll(/@media \(max-width: 600px\), \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map((m) => m[1])
	const rule = (selector) => blocks.map((b) => b.match(new RegExp(selector.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}'))?.[1]).find(Boolean) ?? ''
	const btn = rule('button.knorke-contextbar__filter')
	assert.match(btn, /height: var\(--knorke-touch\) !important/)
	assert.match(btn, /min-height: var\(--knorke-touch\) !important/)
	assert.match(rule('button.knorke-contextbar__filteritem'), /min-height: var\(--knorke-touch\) !important/)
	assert.match(css, /--knorke-touch: 44px;/)
})

test('job 144 AK5, job 230: in German the entry for five notes reads "Nur Notizen (5)", the title "Auswahl eingrenzen"; every entry text is translated', async () => {
	register('knorke', DE)
	try {
		assert.equal(filterLabel('sticky', 5), 'Nur Notizen (5)')
		assert.deepEqual(['shape', 'text', 'connector', 'frame', 'group'].map((k) => filterLabel(k, 2)),
			['Nur Formen (2)', 'Nur Texte (2)', 'Nur Verbinder (2)', 'Nur Frames (2)', 'Nur Gruppen (2)'])
		const html = strip(await render(WithFilterPanel, { selection: selF() }))
		assert.match(countButton(html), /title="Auswahl eingrenzen"/)
		assert.match(html, /aria-label="Auswahl eingrenzen"/, 'the panel name')
		const tags = strip(await render(WithFilterPanel, { selection: { ...selF(), tags: [{ id: 't1', name: 'A', color: '#0275a9', count: 2 }] } }))
		assert.match(tags, />\s*Nach Tag\s*</, 'the caption "By tag"')
		assert.match(html, /data-knorke-filter="sticky"[^>]*>\s*Nur Notizen \(5\)\s*</)
	} finally {
		unregister('knorke')
	}
	assert.equal(filterLabel('sticky', 5), 'Only notes (5)', 'English again without the bundle')
})

test('job 230 AK4: narrowEntries – the tags of selection v2 whose count is below the selection, in the given order; invalid ones left out; canNarrow with kinds or tags', () => {
	const tags = [
		{ id: 't1', name: 'A', color: '#0275a9', count: 2 },
		{ id: 't2', name: 'All', color: '#307d37', count: 4 },
		{ id: 't3', name: 'B', color: '#c43e45', count: 1 },
		{ id: '', name: 'x', color: '#000000', count: 1 },
		{ id: 't4', name: 'zero', color: '#000000', count: 0 },
		{ id: 't5', name: 5, color: '#000000', count: 1 },
		null,
	]
	const s4 = sel(['sticky', 'sticky', 'sticky', 'sticky'], { tags })
	assert.deepEqual(narrowEntries(s4).tags.map((t) => t.id), ['t1', 't3'], '"All" is on every item: it changes nothing')
	assert.deepEqual(narrowEntries(s4).kinds, [])
	assert.equal(canNarrow(s4), true)
	assert.equal(canNarrow(sel(['sticky', 'sticky'], { tags: [{ id: 't2', name: 'All', color: '#307d37', count: 2 }] })), false)
	assert.equal(canNarrow(sel(['sticky', 'shape'], { kinds: [{ kind: 'sticky', count: 1 }, { kind: 'shape', count: 1 }] })), true)
	assert.deepEqual(narrowEntries(null), { kinds: [], tags: [] })
})

test('job 230 AK4: the panel lists "By tag" after the kinds, one [data-knorke-filter-tag] button per tag with its dot (a valid colour only), name and count; a click closes the panel and emits filter-tag(id, event); without tags no caption', async () => {
	const tags = [{ id: 't1', name: '<b>A</b>', color: '#0275a9', count: 2 }, { id: 't3', name: 'B', color: 'url(x)', count: 1 }]
	const html = strip(await render(WithFilterPanel, { selection: { ...selF(), tags } }))
	const panel = html.slice(html.indexOf('data-knorke-panel="filter"'))
	assert.ok(panel.indexOf('By tag') > panel.lastIndexOf('data-knorke-filter="'), 'after the kinds')
	const entries = [...panel.matchAll(/<button[^>]*data-knorke-filter-tag="([a-z0-9]+)"[^>]*>([\s\S]*?)<\/button>/g)]
	assert.deepEqual(entries.map((m) => m[1]), ['t1', 't3'])
	assert.deepEqual(entries.map((m) => textOf(m[2])), ['&lt;b&gt;A&lt;/b&gt; (2)', 'B (1)'], 'the name as text')
	assert.match(entries[0][2], /knorke-contextbar__tagdot" style="background-color:#0275a9;"/)
	assert.doesNotMatch(entries[1][2], /url/, 'an invalid colour never reaches the style')
	const none = strip(await render(WithFilterPanel, { selection: selF() }))
	assert.doesNotMatch(none, /By tag|data-knorke-filter-tag/)
	const { bindings, emitted } = setupOf(ContextBar, { selection: { ...selF(), tags } })
	bindings.toggle('filter')
	const ev = { type: 'click', detail: 1 }
	bindings.pickTag('t1', ev)
	assert.equal(bindings.panel.value, null)
	assert.deepEqual(emitted, [['filter-tag', 't1', ev]])
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(view, /@filter-tag="\(id\) => lockAct\(\(s\) => s\.filterSelectionByTag\(id\)\)"/)
})
