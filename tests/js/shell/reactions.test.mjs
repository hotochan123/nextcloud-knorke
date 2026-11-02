/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The shell's part of emoji reactions (factory job 172, AK6): "Add reaction"
 * in the context bar and the menu only for exactly one note (selection v2
 * reactable); the quick row of ReactionPicker.vue (the six in this order,
 * "More…", aria-pressed for the own one, the keys); ReactionNames.vue
 * (names sorted as given, the own one "(you)", the list's heads as buttons
 * only while one may react); popoverPlace; the German texts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MENU_ITEMS, menuEntries, menuLabel, menuShortcut } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { nameLine, popoverPlace, quickKey } from '../../../src/components/reactions.js'
import { QUICK_REACTIONS } from '../../../src/model/reactions.js'
import { TYPES } from '../../../src/model/registry.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default
const ReactionPicker = (await import('../../../src/components/ReactionPicker.vue')).default
const ReactionNames = (await import('../../../src/components/ReactionNames.vue')).default

const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

/**
 * @param {string[]} types selected types
 * @param {object} [extra] more selection v2 keys
 * @return {object} selection v2
 */
function sel(types, extra = {}) {
	let fields = null
	for (const t of new Set(types)) {
		const own = Object.keys(TYPES[t]?.fields ?? {})
		fields = fields === null ? own : fields.filter((p) => own.includes(p))
	}
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: null, ...extra }
}

test('AK6, job 230: the bar shows "Add reaction" (emoticon-plus) first in the collaboration group only with reactable; no menu lists it (the session still runs it), no key', async () => {
	const one = strip(await render(ContextBar, { selection: sel(['sticky'], { reactable: true }) }))
	const tags = one.match(/<div[^>]*data-knorke-action="react"[^>]*>/g) ?? []
	assert.equal(tags.length, 1)
	assert.match(tags[0], /aria-label="Add reaction"/)
	assert.match(tags[0], /aria-haspopup="dialog"/)
	assert.ok(one.indexOf('data-knorke-section="color"') < one.indexOf('data-knorke-action="react"') && one.indexOf('data-knorke-action="react"') < one.indexOf('data-knorke-menu="selection"'), 'job 230: after the colour dot, before "…"')
	assert.ok(one.slice(one.indexOf('data-knorke-action="react"')).includes(`path="${icons.emoticonPlus}"`))
	for (const s of [sel(['sticky']), sel(['sticky'], { reactable: false }), sel(['sticky', 'sticky'], { reactable: false })]) {
		assert.doesNotMatch(await render(ContextBar, { selection: s }), /data-knorke-action="react"/)
	}
	assert.ok(MENU_ITEMS.includes('react'), 'the session still knows the entry')
	assert.equal(menuLabel('react'), 'Add reaction')
	assert.equal(menuShortcut('react', false), null)
	assert.equal(menuShortcut('react', true), null)
	const note = sel(['sticky'], { unlocked: 1, reactable: true })
	assert.deepEqual(menuEntries(note, 'id0'), ['cut', 'copy', 'duplicate', 'front', 'back', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'], 'no box: no arrange')
	assert.ok(!menuEntries(sel([], { reactable: true }), null).includes('react'), 'never on the empty canvas')
})

test('AK6: the quick row – 👍 ❤️ 😂 🎉 🤔 👀 in this order, then "More…"; the own one aria-pressed="true"', async () => {
	assert.deepEqual([...QUICK_REACTIONS], ['1f44d', '2764-fe0f', '1f602', '1f389', '1f914', '1f440'])
	const html = strip(await render(ReactionPicker, { rect: { x: 10, y: 20, w: 24, h: 24 }, mine: '1f602' }))
	assert.match(html, /^<div[^>]*data-knorke-reactions="pick"[^>]*role="dialog"|^<div[^>]*role="dialog"[^>]*data-knorke-reactions="pick"/)
	const buttons = [...html.matchAll(/<button[^>]*data-knorke-react="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
	assert.deepEqual(buttons.map((b) => b[1]), [...QUICK_REACTIONS, 'more'])
	assert.deepEqual(buttons.map((b) => b[2].trim()), ['👍', '❤️', '😂', '🎉', '🤔', '👀', 'More…'])
	const pressed = buttons.filter((b) => /aria-pressed="true"/.test(b[0])).map((b) => b[1])
	assert.deepEqual(pressed, ['1f602'])
	assert.equal(buttons.slice(0, 6).filter((b) => /aria-pressed="false"/.test(b[0])).length, 5)
	assert.doesNotMatch(html, /data-knorke-reactions="error"/)
	const none = strip(await render(ReactionPicker, { rect: null, mine: null }))
	assert.doesNotMatch(none, /aria-pressed="true"/)
})

test('AK6: the keys – the arrows wander and wrap, Home and End jump, Esc closes; keys of the full list are its own', () => {
	const n = QUICK_REACTIONS.length + 1
	assert.equal(quickKey('ArrowRight', 0, n), 1)
	assert.equal(quickKey('ArrowRight', 6, n), 0)
	assert.equal(quickKey('ArrowLeft', 0, n), 6)
	assert.equal(quickKey('ArrowDown', 2, n), 3)
	assert.equal(quickKey('ArrowUp', 2, n), 1)
	assert.equal(quickKey('Home', 4, n), 0)
	assert.equal(quickKey('End', 1, n), 6)
	assert.equal(quickKey('Enter', 1, n), null, 'Enter and Space are the buttons\' own')
	assert.equal(quickKey(' ', 1, n), null)
	assert.equal(quickKey('ArrowRight', -1, n), 0)
	const { bindings, emitted } = setupOf(ReactionPicker, { rect: null, mine: null })
	const focused = []
	const buttons = Array.from({ length: n }, (_, i) => ({ focus: () => focused.push(i) }))
	buttons.forEach((b, i) => bindings.setButton(b, i))
	const key = (k, target) => {
		const e = { key: k, target, prevented: false, stopped: false, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
		bindings.onKey(e)
		return e
	}
	let e = key('ArrowRight', buttons[2])
	assert.deepEqual([focused.at(-1), e.prevented, e.stopped], [3, true, true])
	e = key('End', buttons[0])
	assert.equal(focused.at(-1), 6)
	e = key('x', buttons[0])
	assert.deepEqual([e.prevented, e.stopped], [false, false], 'other keys go on')
	e = key('ArrowRight', { tagName: 'INPUT' })
	assert.equal(e.prevented, false, 'the search field of the full list keeps its arrows')
	e = key('Escape', buttons[1])
	assert.deepEqual([e.prevented, e.stopped], [true, true])
	assert.deepEqual(emitted, [['close']])
	bindings.onSelect('🚀')
	assert.deepEqual(emitted.at(-1), ['pick', '1f680'], 'a choice of the full list in hex form')
})

test('names and the list: every name in the given order, the own one "(you)"; the heads act like pills only while one may react; names are text', async () => {
	const entries = [
		{ e: '1f44d', n: 3, mine: true, names: [{ name: 'Ann', mine: false }, { name: '<b>Bob</b>', mine: false }, { name: 'Vic Vogel', mine: true }] },
		{ e: '2764-fe0f', n: 1, mine: false, names: [{ name: 'Carol', mine: false }] },
	]
	const names = strip(await render(ReactionNames, { kind: 'names', id: 'n1', entries: entries.slice(0, 1), rect: null }))
	assert.match(names, /data-knorke-reactions="names"/)
	assert.match(names, /role="tooltip"/)
	assert.match(names, /knorke-reactnames--tip/, 'a resting mouse\'s names let the pointer through')
	const lines = [...names.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].trim())
	assert.deepEqual(lines, ['Ann', '&lt;b&gt;Bob&lt;/b&gt;', 'Vic Vogel (you)'])
	assert.doesNotMatch(names, /<button/)
	const held = strip(await render(ReactionNames, { kind: 'names', id: 'n1', entries: entries.slice(0, 1), rect: null, hold: true }))
	assert.doesNotMatch(held, /knorke-reactnames--tip/, 'a long press: a popover that scrolls')
	const list = strip(await render(ReactionNames, { kind: 'list', id: 'n1', entries, rect: null, canReact: true }))
	assert.match(list, /data-knorke-reactions="list"/)
	const heads = [...list.matchAll(/<button[^>]*data-knorke-react="([^"]+)"[^>]*>/g)]
	assert.deepEqual(heads.map((m) => m[1]), ['1f44d', '2764-fe0f'])
	assert.match(heads[0][0], /aria-pressed="true"/)
	assert.match(heads[1][0], /aria-pressed="false"/)
	const viewer = strip(await render(ReactionNames, { kind: 'list', id: 'n1', entries, rect: null, canReact: false }))
	assert.doesNotMatch(viewer, /<button/, 'viewers see, but cannot act')
	assert.equal(nameLine({ name: 'Gina', mine: true }), 'Gina (you)')
	assert.equal(nameLine({ name: 'Gina', mine: false }), 'Gina')
	const { bindings, emitted } = setupOf(ReactionNames, { kind: 'list', id: 'n1', entries, rect: null, canReact: true, hold: true })
	assert.ok(typeof bindings.measure === 'function')
	assert.deepEqual(emitted, [])
})

test('popoverPlace: below the box, left aligned; above when only there is room; pushed into the board; the centre without a box', () => {
	const board = { w: 1000, h: 800 }
	assert.deepEqual(popoverPlace({ x: 100, y: 300, w: 24, h: 24 }, { w: 300, h: 50 }, board), { x: 100, y: 330 })
	assert.deepEqual(popoverPlace({ x: 100, y: 760, w: 24, h: 24 }, { w: 300, h: 50 }, board), { x: 100, y: 704 }, 'above')
	assert.deepEqual(popoverPlace({ x: 900, y: 300, w: 24, h: 24 }, { w: 300, h: 50 }, board), { x: 692, y: 330 }, 'pushed in from the right')
	assert.deepEqual(popoverPlace({ x: -50, y: 300, w: 24, h: 24 }, { w: 300, h: 50 }, board), { x: 8, y: 330 })
	assert.deepEqual(popoverPlace(null, { w: 300, h: 50 }, board), { x: 350, y: 375 })
	assert.deepEqual(popoverPlace({ x: 1, y: 2, w: 3, h: 4 }, null, null), { x: 1, y: 12 }, 'before it is measured')
})

test('AK6: the German texts are there', () => {
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	for (const s of ['Add reaction', 'More…', 'Reactions', 'The emoji list could not be loaded. Reload the page.', 'Your reaction could not be saved.', '{name} (you)']) {
		assert.equal(typeof de[s], 'string', s)
		assert.ok(de[s].length > 0, s)
	}
})

test('round 1: on phones and coarse pointers the quick row and the heads of the "+n" list are finger-sized (var(--knorke-touch))', () => {
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	const start = css.indexOf('/* the quick row and the heads of the "+n" list are finger-sized')
	assert.ok(start > 0)
	const block = css.slice(start, css.indexOf('\n}\n', start) + 3)
	assert.match(block, /@media \(max-width: 600px\), \(pointer: coarse\) \{/)
	assert.match(block, /button\.knorke-reactpicker__emoji \{\s*width: var\(--knorke-touch\) !important;/)
	assert.match(block, /button\.knorke-reactpicker__emoji,\s*button\.knorke-reactpicker__more,\s*button\.knorke-reactnames__head--button \{\s*min-width: var\(--knorke-touch\) !important;\s*min-height: var\(--knorke-touch\) !important;/)
	assert.match(css, /--knorke-touch: 44px;/)
})
