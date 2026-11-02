/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Swap direction" in the shell (factory job 153, AK5, AK6, AK7): the third
 * row of the panel "Tips" (rendered with @vue/server-renderer), disabled
 * while selection v2 swappable is 0 or missing; the context menu entry
 * swap-direction after edit-text (or back) and before connect, only with
 * the panel "Tips" and something to swap; its label, no shortcut; the icon
 * and the German text.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MENU_ITEMS, menuEntries, menuLabel, menuShortcut } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { TYPES } from '../../../src/model/registry.js'
import { panelOf } from './contextbarHtml.mjs'
import { useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
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
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: null, ...extra }
}

/** ContextBar whose panel is "Tips" from the start. */
const WithCapsPanel = {
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		b.toggle('caps')
		return b
	},
}

/** @return {string} the start tag of the swap button in the open panel */
async function swapTag(selection) {
	const html = strip(await render(WithCapsPanel, { selection }))
	const panel = panelOf(html)
	assert.match(panel, /data-knorke-panel="caps"/)
	const tags = panel.match(/<div[^>]*data-knorke-action="swap-direction"[^>]*>/g) ?? []
	assert.equal(tags.length, 1, 'one swap button')
	return { panel, tag: tags[0] }
}

test('job 153 AK5: the open panel "Tips" has "Swap direction" after both tip rows, a tertiary button with icon and visible text, named; disabled with swappable 0 or missing, enabled with 1', async () => {
	const { panel, tag } = await swapTag(sel(['connector'], { swappable: 1, startCap: 'dot', endCap: 'arrow' }))
	const at = panel.indexOf('data-knorke-action="swap-direction"')
	const lastStart = panel.lastIndexOf('data-knorke-style="style.startCap"')
	const lastEnd = panel.lastIndexOf('data-knorke-style="style.endCap"')
	assert.ok(lastStart > 0 && lastEnd > lastStart && at > lastEnd, 'after the start row and the end row')
	assert.match(tag, /variant="tertiary"/)
	assert.match(tag, /aria-label="Swap direction"/)
	assert.match(tag, /title="Swap direction"/)
	assert.doesNotMatch(tag, /\sdisabled/, 'swappable 1: enabled')
	const button = panel.slice(panel.indexOf(tag), panel.indexOf('</div>', panel.indexOf(tag) + tag.length) + 6)
	assert.ok(button.includes('data-stub="NcIconSvgWrapper" path="' + icons.swapDirection + '"'), 'the swap icon (job 244: Phosphor arrows-left-right)')
	assert.match(panel.slice(panel.indexOf(tag)), /^<div[^>]*>[\s\S]*?Swap direction/, 'visible text')
	for (const extra of [{ swappable: 0 }, {}]) {
		const off = await swapTag(sel(['connector', 'connector'], extra))
		assert.match(off.tag, /\sdisabled/, JSON.stringify(extra))
	}
	// nothing of it outside the panel "Tips"
	const closed = strip(await render(ContextBar, { selection: sel(['connector'], { swappable: 1 }) }))
	assert.doesNotMatch(closed, /swap-direction/)
	const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(src, /defineEmits\(\[[^\]]*'swap-direction'/)
})

test('job 153 AK6, job 230: "Swap direction" stays in the panel "Tips" only: the menus no longer list it (the session still runs it); no key', () => {
	for (const s of [sel(['connector'], { swappable: 1 }), sel(['connector', 'connector'], { swappable: 2 })]) {
		assert.ok(!menuEntries(s, 'id0').includes('swap-direction'), [...s.types].join('+'))
	}
	assert.ok(!menuEntries(sel(['connector'], { swappable: 1 }), null, { items: 3 }).includes('swap-direction'), 'empty canvas')
	assert.ok(MENU_ITEMS.includes('swap-direction'), 'the session still knows the entry')
	assert.equal(menuLabel('swap-direction'), 'Swap direction')
	for (const apple of [true, false]) {
		assert.equal(menuShortcut('swap-direction', apple), null)
	}
})

test('job 153 AK7: icons.swapDirection is an icon of its own; "Swap direction" is "Richtung umkehren" in l10n/de.json', () => {
	for (const [k, p] of Object.entries(icons)) {
		if (k !== 'swapDirection') {
			assert.notEqual(p, icons.swapDirection, k)
		}
	}
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Swap direction'], 'Richtung umkehren')
})
