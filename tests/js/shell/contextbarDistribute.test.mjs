/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Distribute" in the context bar (SPEC-M1 §1.2, M2): a third row of the
 * align panel with the two commands of actions.DISTRIBUTE_AXES from three
 * alignable items on (rendered with @vue/server-renderer), the panel staying
 * open when the row goes, the icons, the labels and their German texts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALIGN_EDGES, DISTRIBUTE_AXES } from '../../../src/board/actions.js'
import { icons } from '../../../src/components/icons.js'
import { distributeLabel, itemAlignLabel } from '../../../src/components/labels.js'
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

/** ContextBar whose panel is "Align items" from the start (its own toggle, before the render). */
const WithAlignPanel = {
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		b.toggle('align')
		return b
	},
}

const TEXTS = Object.freeze({
	horizontal: 'Distribute horizontally',
	vertical: 'Distribute vertically',
})

test('M2 distribute (AK10): from three alignable items the align panel ends with the two commands of DISTRIBUTE_AXES after the six align commands, each named, none pressed', async () => {
	const html = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'shape', 'sticky'], { alignable: 3 }) }))
	const panel = panelOf(html)
	assert.match(panel, /^<div[^>]*data-knorke-panel="align"/)
	const commands = [...panel.matchAll(/data-knorke-(align|distribute)="([a-z]+)"/g)].map((m) => m[1] + ':' + m[2])
	assert.deepEqual(commands, [...ALIGN_EDGES.map((e) => 'align:' + e), 'distribute:horizontal', 'distribute:vertical'])
	for (const axis of DISTRIBUTE_AXES) {
		const tag = html.match(new RegExp(`<div[^>]*data-knorke-distribute="${axis}"[^>]*>`))[0]
		assert.match(tag, new RegExp(`aria-label="${TEXTS[axis]}"`), axis)
		assert.match(tag, new RegExp(`title="${TEXTS[axis]}"`), axis)
		assert.match(tag, /data-stub="NcButton"/)
		assert.match(tag, /variant="tertiary"/)
		assert.doesNotMatch(tag, /pressed="true"/)
	}
	// no toggle of its own in the bar
	assert.equal((html.match(/data-knorke-action="align"/g) ?? []).length, 1)
	assert.doesNotMatch(html, /data-knorke-action="distribute"/)
})

test('M2 distribute (AK10): with two alignable items the panel holds the six align commands and no distribute command', async () => {
	const html = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'sticky'], { alignable: 2 }) }))
	assert.match(html, /data-knorke-panel="align"/)
	assert.deepEqual([...html.matchAll(/data-knorke-align="([a-z]+)"/g)].map((m) => m[1]), [...ALIGN_EDGES])
	assert.doesNotMatch(html, /data-knorke-distribute/)
	const connector = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'sticky', 'connector'], { alignable: 2 }) }))
	assert.doesNotMatch(connector, /data-knorke-distribute/, 'two notes plus a connector')
})

test('M2 distribute (AK10): the panel stays open when the same ids drop from three to two alignable items (only the row goes), and closes below two', async () => {
	const props = reactive({ selection: sel(['sticky', 'sticky', 'sticky'], { alignable: 3 }) })
	const { bindings } = setupOf(ContextBar, props)
	bindings.toggle('align')
	assert.equal(bindings.sections.value.distribute, true)
	// the session reports the same ids again after a distribute (new box)
	props.selection = sel(['sticky', 'sticky', 'sticky'], { alignable: 3, box: { x: 10, y: 0, w: 500, h: 200, r: 0 } })
	await nextTick()
	assert.equal(bindings.panel.value, 'align', 'same ids, still three: open')
	// the same ids, one note became the child of another selected item elsewhere: two alignable items
	props.selection = sel(['sticky', 'sticky', 'sticky'], { alignable: 2 })
	await nextTick()
	assert.equal(bindings.sections.value.distribute, false)
	assert.equal(bindings.sections.value.itemAlign, true)
	assert.equal(bindings.panel.value, 'align', 'only the distribute row goes, the panel stays')
	assert.equal(bindings.panelLabel.value, 'Align items')
	props.selection = sel(['sticky', 'sticky', 'sticky'], { alignable: 1 })
	await nextTick()
	assert.equal(bindings.panel.value, null, '"Align items" is gone: closed')
})

test('M2 distribute (AK10, AK12): each axis has an MDI icon of its own, apart from every align icon; the paths of distribute-horizontal-center and distribute-vertical-center', () => {
	const { bindings } = setupOf(ContextBar, { selection: sel(['sticky', 'sticky', 'sticky'], { alignable: 3 }) })
	assert.deepEqual(DISTRIBUTE_AXES.map((a) => bindings.DISTRIBUTE_ICONS[a]), [icons.distributeHorizontal, icons.distributeVertical])
	assert.equal(icons.distributeHorizontal, 'M8 2V5H10V19H8V22H6V19H4V5H6V2H8M16 2V7H14V17H16V22H18V17H20V7H18V2H16Z')
	assert.equal(icons.distributeVertical, 'M2 16H5V14H19V16H22V18H19V20H5V18H2V16M2 8H7V10H17V8H22V6H17V4H7V6H2V8Z')
	assert.notEqual(icons.distributeHorizontal, icons.distributeVertical)
	const align = ALIGN_EDGES.map((e) => bindings.ITEM_ALIGN_ICONS[e])
	assert.ok(![icons.distributeHorizontal, icons.distributeVertical].some((p) => align.includes(p)), 'not an align icon')
})

test('M2 distribute (AK11): distributeLabel gives the source text per axis, an unknown value itself; German texts in l10n/de.json', () => {
	for (const axis of DISTRIBUTE_AXES) {
		assert.equal(distributeLabel(axis), TEXTS[axis], axis)
	}
	assert.equal(distributeLabel('diagonal'), 'diagonal')
	assert.equal(distributeLabel(undefined), 'undefined')
	assert.ok(DISTRIBUTE_AXES.every((a) => !ALIGN_EDGES.map(itemAlignLabel).includes(distributeLabel(a))), 'never an align text')
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual(Object.fromEntries(DISTRIBUTE_AXES.map((a) => [TEXTS[a], de[TEXTS[a]]])), {
		'Distribute horizontally': 'Horizontal verteilen',
		'Distribute vertically': 'Vertikal verteilen',
	})
})
