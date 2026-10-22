/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Align items" in the context bar (SPEC-M1 §1.2, M2): the toggle from two
 * alignable items on (selection v2 `alignable`), its panel with the six
 * commands of actions.ALIGN_EDGES in two rows (rendered with
 * @vue/server-renderer), the panel name, the panel staying open while the
 * section stays and closing when it goes; the labels and their German texts.
 * The panel element stands right after the last panel toggle and before
 * "Copy" (one Tab from the toggle leads into it).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALIGN_EDGES } from '../../../src/board/actions.js'
import { icons } from '../../../src/components/icons.js'
import { alignLabel, itemAlignLabel, valignLabel } from '../../../src/components/labels.js'
import { TYPES } from '../../../src/model/registry.js'
import { panelOf } from './contextbarHtml.mjs'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp, nextTick, reactive } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default

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

/**
 * @param {string} name panel to open
 * @return {object} ContextBar whose panel is open from the start (its own toggle, before the render)
 */
const withPanel = (name) => ({
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		b.toggle(name)
		return b
	},
})

/** ContextBar whose panel is "Align items" from the start. */
const WithAlignPanel = withPanel('align')

/**
 * @param {string} html rendered bar
 * @return {string[]} the bar's own elements in document order, the panel as one entry
 *   (action:<name>, section:<name>, panel:<name>, count; the panel's content left out)
 */
function barOrder(html) {
	const panel = html.includes('<div id="knorke-contextbar-panel"') ? panelOf(html) : ''
	const flat = panel ? html.replace(panel, '<div data-knorke-panel-placeholder>') : html
	const out = []
	for (const m of flat.matchAll(/<div data-knorke-panel-placeholder>|<[a-z]+\b[^>]*data-stub="NcButton"[^>]*>|<span class="knorke-contextbar__count"/g)) {
		if (m[0].startsWith('<div data-knorke-panel-placeholder')) {
			out.push('panel:' + panel.match(/data-knorke-panel="([a-z]+)"/)[1])
		} else if (m[0].startsWith('<span')) {
			out.push('count')
		} else {
			const hook = m[0].match(/data-knorke-(action|section)="([a-z]+)"/)
			out.push(hook ? hook[1] + ':' + hook[2] : 'button:' + (m[0].match(/aria-label="([^"]*)"/)?.[1] ?? '?'))
		}
	}
	return out
}

const TEXTS = Object.freeze({
	left: 'Align left edges',
	center: 'Align horizontal centers',
	right: 'Align right edges',
	top: 'Align top edges',
	middle: 'Align vertical centers',
	bottom: 'Align bottom edges',
})

test('M2 align (AK10, 018 AK1): the toggle "Align items" renders from two alignable items, not from one; no "Arrange" beside it', async () => {
	const two = strip(await render(ContextBar, { selection: sel(['sticky', 'sticky'], { alignable: 2 }) }))
	assert.equal((two.match(/data-knorke-action="align"/g) ?? []).length, 1)
	const toggle = two.match(/<div[^>]*data-knorke-action="align"[^>]*>/)?.[0] ?? ''
	assert.match(toggle, /aria-label="Align items"/)
	assert.match(toggle, /title="Align items"/)
	assert.match(toggle, /aria-expanded="false"/)
	assert.match(toggle, /aria-controls="knorke-contextbar-panel"/)
	assert.doesNotMatch(two, /data-knorke-action="arrange"/)
	assert.doesNotMatch(two, /data-knorke-panel/, 'the panel is closed at first')
	const one = strip(await render(ContextBar, { selection: sel(['sticky', 'connector'], { alignable: 1 }) }))
	assert.doesNotMatch(one, /data-knorke-action="align"/)
	const none = strip(await render(ContextBar, { selection: sel(['sticky', 'sticky']) }))
	assert.doesNotMatch(none, /data-knorke-action="align"/, 'without alignable')
})

test('M2 align (AK10, 018 AK1): the open panel is named "Align items" and holds the six commands of ALIGN_EDGES in two rows, each named, none pressed', async () => {
	const html = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'shape', 'sticky'], { alignable: 3 }) }))
	const panel = html.match(/<div id="knorke-contextbar-panel"[^>]*>/)?.[0] ?? ''
	assert.match(panel, /data-knorke-panel="align"/)
	assert.match(panel, /aria-label="Align items"/)
	assert.match(panel, /role="group"/)
	assert.match(html, /data-knorke-action="align"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*data-knorke-action="align"/)
	const edges = [...html.matchAll(/data-knorke-align="([a-z]+)"/g)].map((m) => m[1])
	assert.deepEqual(edges, [...ALIGN_EDGES])
	for (const edge of ALIGN_EDGES) {
		const tag = html.match(new RegExp(`<div[^>]*data-knorke-align="${edge}"[^>]*>`))[0]
		assert.match(tag, new RegExp(`aria-label="${TEXTS[edge]}"`), edge)
		assert.match(tag, new RegExp(`title="${TEXTS[edge]}"`), edge)
		assert.match(tag, /data-stub="NcButton"/)
		assert.doesNotMatch(tag, /pressed="true"/)
	}
	const body = panelOf(html)
	assert.ok(body.startsWith(panel))
	const rows = body.split('class="knorke-contextbar__row"').slice(1).map((r) => [...r.matchAll(/data-knorke-(?:align|distribute|action)="([a-z]+)"/g)].map((m) => m[1]))
	// three alignable items: the "Distribute" row follows the two align rows, "Tidy up" ends the panel
	assert.deepEqual(rows, [['left', 'center', 'right'], ['top', 'middle', 'bottom'], ['horizontal', 'vertical'], ['tidy']])
})

test('M2 align (AK10, 018 AK1): toggle(\'align\') opens the panel "Align items" and closes it again; every edge has an icon of its own', () => {
	const { bindings } = setupOf(ContextBar, { selection: sel(['sticky', 'sticky'], { alignable: 2 }) })
	assert.equal(bindings.sections.value.itemAlign, true)
	assert.equal(bindings.panel.value, null)
	bindings.toggle('align')
	assert.equal(bindings.panel.value, 'align')
	assert.equal(bindings.panelLabel.value, 'Align items')
	bindings.toggle('align')
	assert.equal(bindings.panel.value, null)
	const own = ALIGN_EDGES.map((e) => bindings.ITEM_ALIGN_ICONS[e])
	assert.deepEqual(own, [icons.alignItemsLeft, icons.alignItemsCenter, icons.alignItemsRight, icons.alignItemsTop, icons.alignItemsMiddle, icons.alignItemsBottom])
	assert.equal(new Set(own).size, 6)
	assert.ok(own.every((p) => typeof p === 'string' && /^M[\d .HVMZ]+$/.test(p)), 'MDI path data')
	assert.ok(![icons.alignLeft, icons.alignCenter, icons.alignRight, icons.valignTop, icons.valignMiddle, icons.valignBottom].some((p) => own.includes(p)), 'not the text alignment icons')
})

test('M2 align: the panel stays open while the same items stay alignable (after a click), and closes once "Align items" goes away', async () => {
	const props = reactive({ selection: sel(['frame', 'sticky'], { alignable: 2 }) })
	const { bindings } = setupOf(ContextBar, props)
	bindings.toggle('align')
	// the session reports the same ids again after an align (new box)
	props.selection = sel(['frame', 'sticky'], { alignable: 2, box: { x: 10, y: 0, w: 500, h: 200, r: 0 } })
	await nextTick()
	assert.equal(bindings.panel.value, 'align', 'same ids, still two alignable items: open')
	// the same ids, but the note became the frame's child elsewhere: one alignable item
	props.selection = sel(['frame', 'sticky'], { alignable: 1 })
	await nextTick()
	assert.equal(bindings.sections.value.itemAlign, false)
	assert.equal(bindings.panel.value, null, 'the section is gone: closed')
})

test('M2 align (AK11, 018 AK2): itemAlignLabel gives the source text per edge (apart from the text alignment), an unknown value itself; German texts in l10n/de.json ("Align items", no "Align" any more)', () => {
	for (const edge of ALIGN_EDGES) {
		assert.equal(itemAlignLabel(edge), TEXTS[edge], edge)
	}
	assert.equal(itemAlignLabel('diagonal'), 'diagonal')
	assert.equal(itemAlignLabel(undefined), 'undefined')
	const text = new Set(['left', 'center', 'right'].map(alignLabel).concat(['top', 'middle', 'bottom'].map(valignLabel)))
	assert.ok(ALIGN_EDGES.every((e) => !text.has(itemAlignLabel(e))), 'never a text of the text alignment')
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de.Align, undefined, 'the old key "Align" is gone')
	assert.deepEqual({
		'Align items': de['Align items'],
		...Object.fromEntries(ALIGN_EDGES.map((e) => [TEXTS[e], de[TEXTS[e]]])),
	}, {
		'Align items': 'Objekte ausrichten',
		'Align left edges': 'Linke Kanten ausrichten',
		'Align horizontal centers': 'Horizontal zentrieren',
		'Align right edges': 'Rechte Kanten ausrichten',
		'Align top edges': 'Obere Kanten ausrichten',
		'Align vertical centers': 'Vertikal zentrieren',
		'Align bottom edges': 'Untere Kanten ausrichten',
	})
})

test('018 AK2: the text alignment keeps its own texts and German entries (not renamed with "Align items")', () => {
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual(['left', 'center', 'right'].map(alignLabel).concat(['top', 'middle', 'bottom'].map(valignLabel)),
		['Align left', 'Align center', 'Align right', 'Align top', 'Align middle', 'Align bottom'])
	assert.deepEqual(['Align left', 'Align center', 'Align right', 'Align top', 'Align middle', 'Align bottom'].map((k) => de[k]),
		['Links ausrichten', 'Mittig ausrichten', 'Rechts ausrichten', 'Oben ausrichten', 'Vertikal mittig ausrichten', 'Unten ausrichten'])
})

test('018 AK6: with "Align items" open the panel follows its toggle directly and stands before "Copy"; its first control is "Align left edges"; the count stays the last child after "Delete"', async () => {
	for (const types of [['sticky', 'sticky'], ['sticky', 'shape', 'sticky']]) {
		const html = strip(await render(WithAlignPanel, { selection: sel(types, { alignable: types.length }) }))
		const order = barOrder(html)
		const at = order.indexOf('action:align')
		assert.ok(at >= 0, types.join('+'))
		assert.deepEqual(order.slice(at, at + 3), ['action:align', 'panel:align', 'action:copy'], types.join('+') + ': ' + order.join(' '))
		assert.deepEqual(order.slice(-2), ['button:Delete', 'count'], 'the count is the last after "Delete"')
		const panel = panelOf(html)
		// nothing focusable between the toggle's tag and the panel
		const between = html.slice(html.indexOf('data-knorke-action="align"'), html.indexOf(panel))
		assert.equal((between.match(/data-stub="NcButton"|<button\b|<input\b/g) ?? []).length, 0, 'no other control between toggle and panel')
		// the first control inside the panel is the command "left"
		const first = panel.match(/<[a-z]+\b[^>]*(?:data-stub="Nc(?:Button|TextField)"|type="button")[^>]*>|<button\b[^>]*>|<input\b[^>]*>/)?.[0] ?? ''
		assert.match(first, /data-knorke-align="left"/)
		assert.match(first, /aria-label="Align left edges"/)
		// the bar's root closes right after the count
		assert.match(html, /<span class="knorke-contextbar__count">[^<]*<\/span><\/div>$/)
	}
})

test('018 AK6: "Arrange" (one item) — its panel follows the toggle directly; a style panel ("Text" of two shapes) stands after the last panel toggle and before "Copy"', async () => {
	const arrange = strip(await render(withPanel('arrange'), { selection: sel(['sticky']) }))
	const a = barOrder(arrange)
	const at = a.indexOf('action:arrange')
	assert.ok(at >= 0, a.join(' '))
	assert.deepEqual(a.slice(at, at + 3), ['action:arrange', 'panel:arrange', 'action:copy'], a.join(' '))
	assert.equal(a.at(-1), 'count')
	const first = panelOf(arrange).match(/<[a-z]+\b[^>]*data-stub="NcTextField"[^>]*>/)?.[0] ?? ''
	assert.match(first, /data-knorke-field="arrange-x"/, 'the first field of the ArrangePopover')
	const text = strip(await render(withPanel('text'), { selection: sel(['shape', 'shape'], { alignable: 2 }) }))
	const t = barOrder(text)
	assert.ok(t.includes('section:text') && t.includes('panel:text'), t.join(' '))
	assert.ok(t.indexOf('section:text') < t.indexOf('panel:text'))
	assert.deepEqual(t.slice(t.indexOf('panel:text') - 1, t.indexOf('panel:text') + 2), ['action:align', 'panel:text', 'action:copy'], t.join(' '))
	assert.equal(t.at(-1), 'count')
})
