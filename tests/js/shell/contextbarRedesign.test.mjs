/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 230 (redesign of the context bar, docs/redesign zuordnung.md
 * "Kontextleiste"): the fixed order of the bar (contextbar.js barGroups,
 * AK1), the tabs of the colour panel (colorTabs) and the dot (dotOf), the
 * groups of "…" (moreGroups, AK2) and how the bar runs them, "Custom
 * color…" and the edge of the white and black swatches (AK5), the chip and
 * "Delete" in the error colour (AK5).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { barGroups, barItems, colorTabs, contextSections, dotOf, moreGroups, SELECTION_FIELDS } from '../../../src/components/contextbar.js'
import { TYPES } from '../../../src/model/registry.js'
import { PALETTE } from '../../../src/model/tokens.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp, nextTick, reactive } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default
const ColorPicker = (await import('../../../src/components/ColorPicker.vue')).default
const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')
const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')

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
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: { x: 0, y: 0, w: 100, h: 100, r: 0 }, unlocked: types.length, lockable: types.length, ...extra }
}

test('AK1: barGroups – the fixed order for a note, a shape, a connector, a frame, a table, a mind map, a multi-selection, a locked one and none', () => {
	assert.deepEqual(barGroups(sel(['sticky'], { reactable: true, commentable: true, taggable: 1 })), [['color'], ['react', 'comment', 'tags'], ['more']], 'a note: 5 buttons')
	assert.deepEqual(barGroups(sel(['shape'], { commentable: true })), [['color'], ['kind'], ['comment'], ['more']])
	assert.deepEqual(barGroups(sel(['connector'])), [['color'], ['label', 'route', 'caps'], ['more']])
	assert.deepEqual(barGroups(sel(['frame'], { commentable: true })), [['color'], ['rename'], ['comment'], ['more']])
	assert.deepEqual(barGroups(sel(['table'], { commentable: true })), [['color'], ['header'], ['comment'], ['more']])
	const map = sel(['mindmap'], { mindmap: { id: 'id0', layout: 'both', locked: false, node: { key: 'n1', color: '#c43e45', shape: 'pill' } } })
	assert.deepEqual(barGroups(map), [['mm-node', 'mm-layout'], ['more']], 'a mind map: its colours are in "Branch", no dot')
	// several: the chip first (something to narrow), "Align items" right after it; no reaction or comment
	const multi = sel(['sticky', 'sticky', 'shape'], { alignable: 3, taggable: 2, kinds: [{ kind: 'sticky', count: 2 }, { kind: 'shape', count: 1 }] })
	assert.deepEqual(barGroups(multi), [['chip', 'align', 'color'], ['tags'], ['more']])
	assert.deepEqual(barItems(multi), ['chip', 'align', 'color', 'tags', 'more'], 'a multi-selection: 5 with the chip')
	assert.deepEqual(barGroups(sel(['sticky', 'sticky'], { alignable: 2 }))[0], ['count', 'align', 'color'], 'nothing to narrow: the plain count')
	// fully locked by someone: no style, the badge, "…" (copy)
	const locked = { ids: ['id0'], count: 1, types: new Set(), fields: [], mixed: [], locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } }
	assert.deepEqual(barGroups(locked), [['badge'], ['more']])
	assert.deepEqual(barGroups({ count: 0, lockedOffer: 2 }), [['offer']], 'only the offer')
	assert.deepEqual(barGroups({ count: 0 }), [])
	assert.deepEqual(barGroups(null), [])
	// own shapes (pictures): (job 235) the colour button for their label; one item: no chip
	assert.deepEqual(barGroups(sel(['shape'], { kind: 'image', labelled: true })), [['color'], ['more']])
})

test('AK1: colorTabs – fill, border (a connector\'s line) and text, those the selection has; dotOf – the fill, else the line, else the text colour; mixed', () => {
	assert.deepEqual(colorTabs(contextSections(sel(['sticky']))), ['fill', 'text'])
	assert.deepEqual(colorTabs(contextSections(sel(['shape']))), ['fill', 'border', 'text'])
	assert.deepEqual(colorTabs(contextSections(sel(['connector']))), ['border'])
	assert.deepEqual(colorTabs(contextSections(sel(['text']))), ['text'])
	assert.deepEqual(colorTabs(contextSections(sel(['table']))), ['border', 'text'])
	assert.deepEqual(colorTabs(contextSections(sel(['shape'], { kind: 'image', labelled: true }))), ['text'], 'job 235: the label of an own shape')
	assert.deepEqual(colorTabs(null), [])
	assert.deepEqual(dotOf(sel(['sticky'], { fill: '#A2D9FE' })), { value: '#a2d9fe', colors: ['#a2d9fe'] })
	assert.deepEqual(dotOf(sel(['connector'], { stroke: '#0275a9' })), { value: '#0275a9', colors: ['#0275a9'] })
	assert.deepEqual(dotOf(sel(['text'], { color: '#c43e45' })), { value: '#c43e45', colors: ['#c43e45'] })
	assert.deepEqual(dotOf(sel(['sticky', 'sticky'], { fill: null, mixed: [SELECTION_FIELDS.fill], fills: ['#a2d9fe', '#faea89'] })), { value: 'mixed', colors: ['#a2d9fe', '#faea89'] })
	assert.deepEqual(dotOf(sel(['connector', 'connector'], { mixed: [SELECTION_FIELDS.stroke] })), { value: 'mixed', colors: [] })
	assert.deepEqual(dotOf(sel(['sticky'], { fill: 'url(x)' })), { value: '', colors: [] }, 'never a value that is no colour')
	assert.deepEqual(dotOf(sel(['shape'], { kind: 'image', labelled: true, textColor: '#C43E45' })), { value: '#c43e45', colors: ['#c43e45'] }, 'job 235: the label\'s colour')
})

test('AK1: the colour panel opens on the tab picked last while the selection has it, else on the first; the tabs are a tablist, arrows move between them', async () => {
	const { bindings } = setupOf(ContextBar, { selection: sel(['shape'], { fill: '#ffffff' }), at: null, room: null, apple: false })
	assert.equal(bindings.tab.value, 'fill')
	bindings.pickTab('text')
	assert.equal(bindings.tab.value, 'text')
	const props = reactive({ selection: sel(['sticky']), at: null, room: null, apple: false })
	const b2 = setupOf(ContextBar, props).bindings
	b2.pickTab('border')
	assert.equal(b2.tab.value, 'fill', 'a note has no border tab: the first one')
	b2.pickTab('text')
	props.selection = sel(['shape'])
	await nextTick()
	assert.equal(b2.tab.value, 'text', 'the last pick stays for the next selection that has it')
	const keyOn = (k) => {
		const e = { key: k, prevented: false, preventDefault() { e.prevented = true }, currentTarget: null }
		b2.onTabKey(e)
		return e
	}
	assert.equal(keyOn('ArrowRight').prevented, true)
	assert.equal(b2.tab.value, 'fill', 'text → fill (wraps)')
	keyOn('ArrowLeft')
	assert.equal(b2.tab.value, 'text')
	keyOn('Home')
	assert.equal(b2.tab.value, 'fill')
	keyOn('End')
	assert.equal(b2.tab.value, 'text')
	assert.equal(keyOn('x').prevented, false, 'other keys pass')
	const ToColor = { ...ContextBar, setup(p, c) { const b = ContextBar.setup(p, c); b.toggle('color'); b.pickTab('border'); return b } }
	const html = strip(await render(ToColor, { selection: sel(['shape'], { stroke: '#191b1d' }) }))
	const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0])
	assert.deepEqual(tabs.map((t) => /data-knorke-tab="([a-z]+)"/.exec(t)[1]), ['fill', 'border', 'text'])
	assert.deepEqual(tabs.map((t) => /aria-selected="(true|false)"/.exec(t)[1]), ['false', 'true', 'false'])
	assert.deepEqual(tabs.map((t) => /tabindex="(-?\d)"/.exec(t)[1]), ['-1', '0', '-1'], 'one tab stop')
	assert.match(html, /role="tablist" aria-label="Color and text"/)
	assert.match(html, /role="tabpanel" aria-label="Border"/)
	assert.match(html, /data-knorke-style="style.strokeWidth"[\s\S]*data-knorke-style="style.dash"[\s\S]*data-knorke-action="custom-color"/, 'Border: palette, width, dash, then "Custom color…"')
	const text = strip(await render({ ...ContextBar, setup(p, c) { const b = ContextBar.setup(p, c); b.toggle('color'); b.pickTab('text'); return b } }, { selection: sel(['shape'], { fontSize: 22 }) }))
	assert.match(text, /data-knorke-style="style.fontSize"[\s\S]*data-knorke-style="style.align"[\s\S]*data-knorke-style="style.textColor"/, 'Text: size, alignment, colour')
	const fill = strip(await render({ ...ContextBar, setup(p, c) { const b = ContextBar.setup(p, c); b.toggle('color'); return b } }, { selection: sel(['shape'], { fill: '#ffffff' }) }))
	assert.match(fill, /data-knorke-style="style.fill"[\s\S]*data-knorke-style="style.fillOpacity"[\s\S]*data-knorke-action="custom-color"/, 'Fill: palette, opacity, then "Custom color…"')
})

test('AK2: moreGroups – the groups of "…" in their order; locked: copy and unlock only; a blocked group stays; none without a selection', () => {
	const one = sel(['sticky'], { canConnect: false, lockable: 1 })
	assert.deepEqual(moreGroups(one), [['cut', 'copy', 'duplicate'], ['front', 'back'], ['arrange'], ['lock'], ['delete']])
	const two = sel(['sticky', 'sticky'], { canConnect: true, sortable: 2, groupable: 2, grouped: 0, groupBlock: 'parent', oneGroup: false, lockable: 2, unlockable: 1 })
	assert.deepEqual(moreGroups(two), [['cut', 'copy', 'duplicate'], ['front', 'back'], ['connect'], ['sort-colors'], ['group'], ['lock', 'unlock'], ['delete']], 'the blocked group stays')
	assert.deepEqual(moreGroups(sel(['frame'], { frameSortable: 3 })), [['cut', 'copy', 'duplicate'], ['front', 'back'], ['arrange', 'sort-frame'], ['lock'], ['delete']])
	const locked = { ids: ['a'], count: 1, types: new Set(), fields: [], locked: 1, unlocked: 0, lockable: 0, unlockable: 1 }
	assert.deepEqual(moreGroups(locked), [['copy'], ['unlock']])
	assert.deepEqual(moreGroups({ count: 0, lockedOffer: 2 }), [])
	assert.deepEqual(moreGroups(null), [])
	assert.deepEqual(moreGroups(sel(['connector'])).find((g) => g.includes('arrange')), undefined, 'connectors never arrange (their box is derived)')
})

test('AK2: an entry of "…" emits what the bar\'s button did; "Arrange…" opens the panel at "…"; opening "…" closes the open panel; openArrange (the right-click menu) only with arrange', async () => {
	const props = reactive({ selection: sel(['sticky'], { box: { x: 0, y: 0, w: 100, h: 100, r: 0 } }), at: null, room: null, apple: false })
	const { bindings, emitted } = setupOf(ContextBar, props)
	const ev = { type: 'click', detail: 1 }
	for (const name of ['cut', 'copy', 'duplicate', 'delete', 'connect', 'group', 'ungroup', 'lock', 'unlock', 'sort-colors', 'sort-frame']) {
		bindings.runMore(name, ev)
		assert.deepEqual(emitted.at(-1), [name, ev], name)
	}
	bindings.runMore('front', ev)
	assert.deepEqual(emitted.at(-1), ['reorder', 'front', ev])
	bindings.runMore('back', ev)
	assert.deepEqual(emitted.at(-1), ['reorder', 'back', ev])
	const n = emitted.length
	bindings.runMore('arrange', ev)
	assert.equal(bindings.panel.value, 'arrange')
	assert.equal(emitted.length, n, 'no emit')
	bindings.moreOpen.value = true
	await nextTick()
	assert.equal(bindings.panel.value, null, '"…" opened: the panel closed')
	bindings.openArrange({ focus: true })
	assert.equal(bindings.panel.value, 'arrange')
	props.selection = sel(['connector'])
	await nextTick()
	assert.equal(bindings.panel.value, null)
	bindings.openArrange()
	assert.equal(bindings.panel.value, null, 'a connector: no arrange')
	// the titles: the key, none for a blocked entry (its reason); Unlock names no key while something can be locked
	props.selection = sel(['sticky', 'sticky'], { groupable: 2, groupBlock: 'frame', grouped: 0, oneGroup: false, unlockable: 1, lockable: 1 })
	await nextTick()
	assert.equal(bindings.moreTitle('cut'), 'Cut (Ctrl+X)')
	assert.equal(bindings.moreTitle('group'), 'Frames cannot be grouped.')
	assert.equal(bindings.moreTitle('unlock'), 'Unlock')
	assert.equal(bindings.moreTitle('front'), 'Bring to front')
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(view, /onArrange: \(\) => contextBar\.value\?\.openArrange\?\.\(\{ focus: true \}\)/)
	const session = readFileSync(new URL('../../../src/board/BoardSession.js', import.meta.url), 'utf8')
	assert.match(session, /case 'arrange':\n\t\t\t\/\/ job 230: the bar's panel "Arrange" opens and takes the focus\n\t\t\tthis\.ui\.onArrange\?\.\(\)\n\t\t\treturn true/)
})

test('AK2: "…" renders as NcActions in #knorke-menus, named "More actions", the last element of the bar; its entries with their icons, a separator between the groups, Delete with the danger class', async () => {
	const html = strip(await render(ContextBar, { selection: sel(['sticky', 'sticky'], { canConnect: true }) }))
	const menu = html.match(/<div class="knorke-contextbar__more" data-knorke-menu="selection"><div data-stub="NcActions"[^>]*>/)?.[0] ?? ''
	assert.match(menu, /container="#knorke-menus"/)
	assert.match(menu, /aria-label="More actions"/)
	assert.match(menu, /force-menu/)
	assert.ok(html.endsWith('</div></div></div>'), '"…" closes the bar')
	const order = [...html.slice(html.indexOf(menu)).matchAll(/data-stub="NcActionSeparator"|data-knorke-action="([a-z-]+)"/g)].map((m) => m[1] ?? '|')
	assert.deepEqual(order, ['cut', 'copy', 'duplicate', '|', 'front', 'back', '|', 'connect', '|', 'lock', '|', 'delete'])
	assert.match(html, /<div data-stub="NcActionButton"[^>]*class="knorke-more--danger"[^>]*data-knorke-action="delete"/)
	assert.match(css, /\.knorke-more--danger \.action-button \{\s*color: var\(--color-error-text, #8a0000\) !important;/)
})

test('AK5: "Custom color…" shows and hides the hex row (aria-expanded, aria-controls); it starts closed; the white and black swatches carry the edge', async () => {
	const { bindings } = setupOf(ColorPicker, { path: 'style.fill', palette: PALETTE.map((e) => e.light), color: null, boardColors: [], label: 'Fill' })
	assert.equal(bindings.custom.value, false)
	const closed = strip(await render(ColorPicker, { path: 'style.fill', palette: PALETTE.map((e) => e.light), color: null, boardColors: [], label: 'Fill' }))
	const btn = closed.match(/<button[^>]*data-knorke-action="custom-color"[^>]*>/)[0]
	assert.match(btn, /aria-expanded="false"/)
	assert.match(btn, /aria-controls="knorke-hex-style-fill"/)
	assert.match(closed, /<div id="knorke-hex-style-fill" class="knorke-colorpicker__hex" style="display:none;">/, 'hidden (v-show)')
	const Open = { ...ColorPicker, setup(p, c) { const b = ColorPicker.setup(p, c); b.custom.value = true; return b } }
	const open = strip(await render(Open, { path: 'style.stroke', palette: PALETTE.map((e) => e.strong), color: '#191b1d', boardColors: [], label: 'Border' }))
	assert.match(open, /aria-expanded="true"/)
	assert.match(open, /<div id="knorke-hex-style-stroke" class="knorke-colorpicker__hex"(?: style="")?>/)
	const edged = [...closed.matchAll(/<button[^>]*data-knorke-swatch-edge[^>]*>/g)].map((m) => /data-knorke-value="([^"]+)"/.exec(m[0])[1])
	assert.deepEqual(edged, ['#ffffff', '#191b1d'], 'white and black only')
	assert.match(css, /button\.knorke-swatch\[data-knorke-swatch-edge\] \{\s*border-color: var\(--k-swatch-edge\) !important;/)
})

/** @return {number} WCAG 2.x contrast of two #rrggbb */
function contrast(a, b) {
	const lum = (hex) => {
		const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
		return 0.2126 * r + 0.7152 * g + 0.0722 * bl
	}
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
	return (x + 0.05) / (y + 0.05)
}

test('AK5: --k-swatch-edge has at least 3:1 against the light panel (#ffffff) and, in dark mode (b), against #2b2c30', () => {
	const light = /:root \{[\s\S]*?--k-swatch-edge: (#[0-9a-f]{6});/.exec(css)[1]
	const dark = /\[data-knorke-dark='b'\] :is\([\s\S]*?\) \{[\s\S]*?--k-swatch-edge: (#[0-9a-f]{6});/.exec(css)[1]
	assert.ok(contrast(light, '#ffffff') >= 3, `${light} on white: ${contrast(light, '#ffffff').toFixed(2)}`)
	assert.ok(contrast(dark, '#2b2c30') >= 3, `${dark} on #2b2c30: ${contrast(dark, '#2b2c30').toFixed(2)}`)
	assert.ok(contrast(dark, '#191b1d') >= 3, 'the black swatch shows its edge on the dark panel')
})

test('AK5: the chip is an info pair (light primary surface, dark text), a pill 28 px high, 44 px with pen or finger; the context menu\'s Delete in the error colour', () => {
	const chip = css.match(/button\.knorke-contextbar__filter \{([^}]*)\}/)[1]
	for (const rule of ['height: 28px !important;', 'color: var(--k-info-text) !important;', 'background: var(--k-info-bg) !important;', 'border-radius: var(--k-radius-pill) !important;']) {
		assert.ok(chip.includes(rule), rule)
	}
	assert.match(css, /@media \(max-width: 600px\), \(pointer: coarse\) \{\s*button\.knorke-contextbar__filter \{\s*height: var\(--knorke-touch\) !important;/)
	assert.match(css, /button\.knorke-contextmenu__item--danger \{\s*color: var\(--color-error-text, #8a0000\) !important;/)
	assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*?\.knorke-menus \.action-button \{\s*min-height: var\(--knorke-touch\) !important;/, 'the entries of "…" 44 px with pen or finger')
})

test('job 230: Esc inside the panel "Arrange" (opened from "…", no toggle of its own) closes it and gives "…" the focus; inside a toggled panel its toggle', () => {
	const { bindings } = setupOf(ContextBar, { selection: sel(['sticky']), at: null, room: null, apple: false })
	const focused = []
	const trigger = { focus: () => focused.push('more') }
	const toggle = { getAttribute: (k) => ({ 'aria-controls': 'knorke-contextbar-panel', 'aria-expanded': 'true' })[k], focus: () => focused.push('toggle') }
	const panelNode = {}
	let toggles = []
	bindings.bar.value = { contains: () => true, querySelectorAll: () => toggles, querySelector: (s) => (s === '[data-knorke-menu=selection] button' ? trigger : null) }
	const esc = () => {
		const e = { stopped: false, stopPropagation() { e.stopped = true }, target: { closest: (s) => (s === '#knorke-contextbar-panel' ? panelNode : null) } }
		bindings.onEsc(e)
		return e
	}
	bindings.runMore('arrange', { type: 'click' })
	assert.equal(bindings.panel.value, 'arrange')
	assert.equal(esc().stopped, true)
	assert.equal(bindings.panel.value, null)
	assert.deepEqual(focused, ['more'])
	bindings.toggle('color')
	toggles = [toggle]
	esc()
	assert.deepEqual(focused, ['more', 'toggle'])
	assert.equal(bindings.panel.value, null)
	// no panel: Esc goes on to the scene
	assert.equal(esc().stopped, false)
})

test('job 230 round 1: an entry of "…" by key gives "…" the focus back (or the canvas without the bar); a focus the view moved stays; "Arrange…" by key focuses its first field', async () => {
	const props = reactive({ selection: sel(['sticky'], { box: { x: 0, y: 0, w: 100, h: 100, r: 0 } }), at: null, room: null, apple: false })
	const { bindings, emitted } = setupOf(ContextBar, props)
	const focused = []
	const node = (name, inMenu = false) => ({ name, focus: () => focused.push(name), closest: (s) => (inMenu && s === '#knorke-menus' ? {} : null) })
	const body = node('body')
	const trigger = node('more')
	const canvas = node('canvas')
	const saved = globalThis.document
	globalThis.document = { body, activeElement: body, querySelector: (s) => (s === '.knorke-canvas' ? canvas : null) }
	try {
		bindings.bar.value = { querySelector: (s) => (s === '[data-knorke-menu=selection] button' ? trigger : null) }
		// Enter on "Duplicate": the focus fell to <body> with the closing menu
		bindings.runMore('duplicate', { type: 'click', detail: 0 })
		assert.deepEqual(emitted.at(-1).slice(0, 1), ['duplicate'])
		await nextTick()
		assert.deepEqual(focused, ['more'])
		// still inside the closing menu: "…" too
		globalThis.document.activeElement = node('entry', true)
		bindings.runMore('front', { type: 'click', detail: 0 })
		await nextTick()
		assert.deepEqual(focused, ['more', 'more'])
		// the view moved it (Lock: the canvas): it stays
		globalThis.document.activeElement = canvas
		bindings.runMore('lock', { type: 'click', detail: 0 })
		await nextTick()
		assert.deepEqual(focused, ['more', 'more'])
		// a pointer: nothing (the view gives the canvas the focus)
		globalThis.document.activeElement = body
		bindings.runMore('copy', { type: 'click', detail: 1 })
		await nextTick()
		assert.deepEqual(focused, ['more', 'more'])
		// the bar went away with the selection (Delete): the canvas
		bindings.bar.value = null
		bindings.runMore('delete', { type: 'click', detail: 0 })
		await nextTick()
		assert.deepEqual(focused, ['more', 'more', 'canvas'])
	} finally {
		globalThis.document = saved
	}
	// "Arrange…" by key opens the panel and asks for the focus in its first field (narrow layout: at once)
	const fields = []
	bindings.runMore('arrange', { type: 'click', detail: 0 })
	assert.equal(bindings.panel.value, 'arrange')
	bindings.panelEl.value = { getBoundingClientRect: () => ({ width: 300, height: 200 }), querySelector: () => ({ focus: () => fields.push('arrange-x') }) }
	await nextTick()
	assert.deepEqual(fields, ['arrange-x'])
})

test('job 235 AK6: only own shapes – text colour and size ("Auto"), no fill, border, dash, kind or text alignment; mixed with a symbol: labelled', () => {
	const s = contextSections(sel(['shape'], { kind: 'image', labelled: true }))
	assert.ok(s.textColor && s.textColor.path === 'style.textColor')
	assert.ok(s.fontSize && s.fontSize.auto === true && s.fontSize.sizes.length > 0)
	for (const k of ['fill', 'stroke', 'dash', 'kind', 'align', 'valign']) assert.equal(s[k], null, k)
	assert.equal(s.strokeWidth, false)
	assert.equal(s.styled, true)
	const mixed = contextSections(sel(['shape', 'shape'], { kind: null, mixed: ['data.kind'], labelled: true }))
	assert.equal(mixed.align, null)
	assert.equal(mixed.valign, null)
	assert.ok(mixed.textColor && mixed.fontSize)
})
