/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Tidy up" in the context bar (SPEC-M1 §1.2, M2): a fourth row of the align
 * panel with one command [data-knorke-action=tidy] whenever the panel is open
 * (rendered with @vue/server-renderer), after the align and distribute
 * commands; its icon (MDI view-grid) and its German text.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALIGN_EDGES, DISTRIBUTE_AXES } from '../../../src/board/actions.js'
import { icons } from '../../../src/components/icons.js'
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

/**
 * @param {string} html rendered bar
 * @return {string[]} the commands of the open panel in document order (align:<edge>, distribute:<axis>, action:<name>)
 */
function panelCommands(html) {
	const panel = panelOf(html)
	assert.match(panel, /^<div[^>]*data-knorke-panel="align"/)
	return [...panel.matchAll(/data-knorke-(align|distribute|action)="([a-z]+)"/g)].map((m) => m[1] + ':' + m[2])
}

test('M2 tidy up (AK9): with three alignable items the align panel ends with "Tidy up" after the six align and the two distribute commands; named, a command (no pressed)', async () => {
	const html = strip(await render(WithAlignPanel, { selection: sel(['sticky', 'shape', 'sticky'], { alignable: 3 }) }))
	assert.deepEqual(panelCommands(html), [
		...ALIGN_EDGES.map((e) => 'align:' + e),
		...DISTRIBUTE_AXES.map((a) => 'distribute:' + a),
		'action:tidy',
	])
	const tags = html.match(/<div[^>]*data-knorke-action="tidy"[^>]*>/g) ?? []
	assert.equal(tags.length, 1)
	assert.match(tags[0], /aria-label="Tidy up"/)
	assert.match(tags[0], /title="Tidy up"/)
	assert.match(tags[0], /data-stub="NcButton"/)
	assert.match(tags[0], /variant="tertiary"/)
	assert.doesNotMatch(tags[0], /pressed="true"/)
	// no toggle of its own in the bar: only the panel holds the command
	const bar = html.replace(panelOf(html), '')
	assert.ok(bar.length < html.length && /data-knorke-action="copy"/.test(bar), 'the bar without its panel')
	assert.doesNotMatch(bar, /data-knorke-action="tidy"/)
})

test('M2 tidy up (AK9): with two alignable items "Tidy up" follows the six align commands directly, without any distribute command', async () => {
	for (const types of [['sticky', 'sticky'], ['sticky', 'sticky', 'connector']]) {
		const html = strip(await render(WithAlignPanel, { selection: sel(types, { alignable: 2 }) }))
		assert.deepEqual(panelCommands(html), [...ALIGN_EDGES.map((e) => 'align:' + e), 'action:tidy'], types.join('+'))
		assert.doesNotMatch(html, /data-knorke-distribute/)
		assert.match(html, /<div[^>]*data-knorke-action="tidy"[^>]*aria-label="Tidy up"|aria-label="Tidy up"[^>]*data-knorke-action="tidy"/)
	}
	// the panel closed: no "Tidy up" anywhere
	const closed = strip(await render(ContextBar, { selection: sel(['sticky', 'sticky'], { alignable: 2 }) }))
	assert.doesNotMatch(closed, /data-knorke-action="tidy"/)
	assert.doesNotMatch(closed, /Tidy up/)
})

test('M2 tidy up: the panel stays open after a tidy up (same ids, new box) and closes below two alignable items, as for "Align items"', async () => {
	const props = reactive({ selection: sel(['sticky', 'sticky'], { alignable: 2 }) })
	const { bindings } = setupOf(ContextBar, props)
	bindings.toggle('align')
	props.selection = sel(['sticky', 'sticky'], { alignable: 2, box: { x: 10, y: 0, w: 480, h: 200, r: 0 } })
	await nextTick()
	assert.equal(bindings.panel.value, 'align', 'same ids, still two alignable items: open')
	assert.equal(bindings.panelLabel.value, 'Align items')
	props.selection = sel(['sticky', 'sticky'], { alignable: 1 })
	await nextTick()
	assert.equal(bindings.panel.value, null, '"Align items" is gone: closed')
})

test('M2 tidy up (AK10): "Tidy up" has its German text in l10n/de.json', () => {
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Tidy up'], 'Aufräumen')
})

test('M2 tidy up (AK11): icons.tidyUp is the path of MDI view-grid, apart from every align and distribute icon', () => {
	assert.equal(icons.tidyUp, 'M3,11H11V3H3M3,21H11V13H3M13,21H21V13H13M13,3V11H21V3')
	const others = Object.entries(icons).filter(([k]) => k.startsWith('alignItems') || k.startsWith('distribute'))
	assert.equal(others.length, 8)
	assert.ok(others.every(([, p]) => p !== icons.tidyUp), 'not an align or distribute icon')
})
