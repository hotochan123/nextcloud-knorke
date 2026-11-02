/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * What the context bar shows (SPEC-M1 §6.5.1, §6.6): only fields every
 * selected type has, palettes by name from tokens.js (never literals here),
 * font sizes within every type's rule, "Auto" only where it means auto-fit.
 * Job 135 (colour picker): the fill toggle with its colour dot, the colour
 * block of every palette (grid, "#" field, preview dot, system picker, the
 * row "On this board"), parseHex and boardColors.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOARD_COLORS_MAX, BORDER_COLORS, boardColors, contextSections, fillPalette, fontSizes, HEADER_FILLS, isCurrent, LINE_COLORS, parseHex, SELECTION_FIELDS, STROKE_WIDTHS, strokePalette, strokeWidths } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { panelOf } from './contextbarHtml.mjs'
import { groupSummary } from '../../../src/model/groups.js'
import { ENUMS, fieldRule, TYPES } from '../../../src/model/registry.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { BASIC_KINDS } from '../../../src/model/shapes.js'
import {
	CONNECTOR_COLORS, CONNECTOR_STROKE, FRAME_FILL, FRAME_FILLS, LEGACY_MM_COLORS, LEGACY_TAG_COLORS, LIGHT, SHAPE_PALETTE, STICKY_COLORS, STRONG, STRONG_COLORED,
	TABLE_HEADER_FILL,
} from '../../../src/model/tokens.js'
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
 * @return {object} selection v2 as BoardSession.selectionInfo builds it
 */
function sel(types, extra = {}) {
	let fields = null
	for (const t of new Set(types)) {
		const own = Object.keys(TYPES[t]?.fields ?? {})
		fields = fields === null ? own : fields.filter((p) => own.includes(p))
	}
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], box: { x: 0, y: 0, w: 1, h: 1, r: 0 }, ...extra }
}

test('fill palette (job 227): the 13 light tones of the one palette for shapes, frames, notes, pads and a mix', () => {
	for (const types of [['shape'], ['frame', 'frame'], ['sticky'], ['pad'], ['sticky', 'shape'], ['sticky', 'frame']]) {
		assert.deepEqual(fillPalette(types), [...LIGHT], types.join())
	}
	assert.equal(LIGHT.length, 13)
	assert.ok(LIGHT.includes(FRAME_FILL), 'white for frames')
	assert.deepEqual(fillPalette([]), [])
})

test('sections per type: only fields every selected type has', () => {
	const shape = contextSections(sel(['shape']))
	assert.deepEqual(shape.fill, [...LIGHT])
	assert.equal(shape.fillOpacity, true)
	// job 260: "Default" #3d4044 first, Black (the old default border) left out, only for basic and flowchart shapes
	assert.deepEqual(shape.stroke, [...STRONG], 'without sel.redesigned (BPMN, symbols, own shapes): with Black')
	assert.deepEqual(contextSections(sel(['shape'], { redesigned: true })).stroke, [...BORDER_COLORS])
	assert.deepEqual(contextSections(sel(['shape', 'shape'], { redesigned: false })).stroke, [...STRONG], 'rect + bpmnTask')
	assert.equal(shape.strokeWidth, true)
	assert.deepEqual(shape.dash, [...ENUMS.dashes])
	assert.deepEqual(shape.textColor, { path: 'style.textColor', palette: [...STRONG] })
	assert.deepEqual(shape.align, [...ENUMS.aligns])
	assert.deepEqual(shape.valign, [...ENUMS.valigns])
	// job 201: without a common flowchart or symbol kind the six of M1 (kindChoices, shapesPanel.test.mjs)
	assert.deepEqual(shape.kind, [...BASIC_KINDS])
	assert.equal(shape.fontSize.auto, true)
	assert.equal(shape.arrange, true)

	const text = contextSections(sel(['text']))
	assert.equal(text.fill, null)
	assert.equal(text.stroke, null)
	assert.deepEqual(text.textColor.path, 'style.color')
	assert.equal(text.fontSize.auto, false, 'a text item has a primary size, no auto-fit')
	assert.equal(text.valign, null)
	assert.equal(text.kind, null)

	const note = contextSections(sel(['sticky']))
	assert.deepEqual(note.fill, [...LIGHT])
	assert.equal(note.stroke, null)
	assert.equal(note.textColor, null)
	assert.equal(note.fontSize.auto, true)
	assert.deepEqual(note.fontSize.sizes, [16, 22, 32], 'job 227: S, M and L')

	const frame = contextSections(sel(['frame']))
	assert.deepEqual(frame.fill, [...LIGHT])
	assert.equal(frame.fontSize, null)

	// note + shape: fill (note palette) and font size; no border (notes have none)
	const mix = contextSections(sel(['sticky', 'shape']))
	assert.deepEqual(mix.fill, [...LIGHT])
	assert.equal(mix.stroke, null)
	assert.equal(mix.kind, null)
	assert.ok(mix.fontSize)
	assert.deepEqual(mix.fontSize.sizes, [12, 16, 20, 24, 32, 48, 64, 96, 128], 'job 227: a mix keeps the number steps')
	// shape + text: different text colour paths → no text colour
	const st = contextSections(sel(['shape', 'text']))
	assert.equal(st.textColor, null)
	assert.deepEqual(st.align, [...ENUMS.aligns])
	assert.equal(contextSections(sel(['sticky', 'shape'])).arrange, false, 'arrange: one item only')
	// unknown types (placeholders) have no fields
	assert.equal(contextSections({ ...sel([]), types: new Set(['brush']), fields: [], count: 1 }).styled, false)
})

test('font sizes stay inside every selected type\'s rule; auto only when every type fits by default', () => {
	const note = fontSizes(['sticky'])
	const [, min, max] = fieldRule('sticky', 'style.fontSize')
	assert.ok(note.sizes.every((s) => s >= min && s <= max))
	assert.equal(note.auto, true)
	assert.equal(fontSizes(['sticky', 'text']).auto, false)
	assert.ok(fontSizes(['text']).sizes.includes(128))
	assert.deepEqual(fontSizes(['frame']), { sizes: [], auto: false })
})

test('isCurrent: the common value is marked; never when the field is mixed', () => {
	const s = { count: 2, fill: SHAPE_PALETTE[0], fontSize: null, mixed: [] }
	assert.equal(isCurrent(s, 'fill', SHAPE_PALETTE[0].toUpperCase()), true)
	assert.equal(isCurrent(s, 'fill', SHAPE_PALETTE[1]), false)
	assert.equal(isCurrent(s, 'fontSize', null), true, 'auto')
	assert.equal(isCurrent({ ...s, mixed: [SELECTION_FIELDS.fontSize] }, 'fontSize', null), false)
	assert.equal(isCurrent({ ...s, count: 0 }, 'fill', SHAPE_PALETTE[0]), false)
	assert.equal(SELECTION_FIELDS.kind, 'data.kind')
})

test('round 1b connectors: route, both tips, line colours (job 227: LINE_COLORS, connectors only), widths inside the rule (from 1), dash, label for one connector; never arrange', () => {
	const c = contextSections(sel(['connector']))
	assert.deepEqual(c.route, [...ENUMS.routes])
	assert.deepEqual(c.startCap, [...ENUMS.caps])
	assert.deepEqual(c.endCap, [...ENUMS.caps])
	assert.deepEqual(c.stroke, [CONNECTOR_STROKE, ...STRONG_COLORED])
	assert.deepEqual(c.stroke, [...LINE_COLORS])
	assert.equal(c.line, true)
	const [, min, max] = fieldRule('connector', 'style.strokeWidth')
	assert.deepEqual(c.strokeWidths, STROKE_WIDTHS.filter((w) => w >= min && w <= max))
	assert.ok(!c.strokeWidths.includes(0), 'a connector line is never 0 wide')
	assert.deepEqual(c.dash, [...ENUMS.dashes])
	assert.equal(c.label, true)
	assert.equal(c.arrange, false, 'placement none: no arrange (rule 12)')
	assert.equal(c.fill, null)
	assert.equal(c.kind, null)
	assert.equal(c.styled, true)
	// two connectors: no label button
	assert.equal(contextSections(sel(['connector', 'connector'])).label, false)
	// connector + shape: only the shared stroke fields, (job 227) the strong tones, widths valid for both
	const mix = contextSections(sel(['connector', 'shape']))
	assert.deepEqual(mix.stroke, [...STRONG])
	assert.equal(mix.line, false)
	assert.deepEqual(mix.strokeWidths, strokeWidths(['connector', 'shape']))
	assert.ok(!mix.strokeWidths.includes(0))
	assert.equal(mix.route, null)
	assert.equal(mix.endCap, null)
	assert.equal(mix.label, false)
	// connector + note: nothing in common
	const cn = contextSections(sel(['connector', 'sticky']))
	assert.equal(cn.styled, false)
	assert.equal(cn.stroke, null)
	// the shape border keeps 0 (= no border)
	assert.ok(contextSections(sel(['shape'])).strokeWidths.includes(0))
	// job 260 AK4: the shape border palette
	assert.deepEqual(strokePalette(['shape'], true), ['#3d4044', ...STRONG.filter((c) => c !== '#191b1d')])
	assert.deepEqual(strokePalette(['shape', 'shape'], true), [...BORDER_COLORS])
	assert.deepEqual(strokePalette(['shape']), [...STRONG], 'BPMN shapes keep Black')
	assert.deepEqual(strokePalette(['shape', 'table'], true), [...STRONG], 'mixed: as before')
	assert.deepEqual(strokePalette(['connector']), [...LINE_COLORS])
	assert.deepEqual(strokeWidths(['sticky']), [])
})

test('round 1b isCurrent knows the connector keys (route, startCap, endCap) of selection v2', () => {
	const s = { count: 1, route: 'elbow', startCap: 'none', endCap: 'arrow', mixed: [] }
	assert.equal(isCurrent(s, 'route', 'elbow'), true)
	assert.equal(isCurrent(s, 'route', 'curved'), false)
	assert.equal(isCurrent(s, 'endCap', 'arrow'), true)
	assert.equal(isCurrent({ ...s, mixed: [SELECTION_FIELDS.endCap] }, 'endCap', 'arrow'), false)
	assert.deepEqual([SELECTION_FIELDS.route, SELECTION_FIELDS.startCap, SELECTION_FIELDS.endCap], ['data.route', 'style.startCap', 'style.endCap'])
})

test('M2 align (AK8): the section itemAlign exactly from two alignable items (selection v2 alignable); never without it or without a selection; the text alignment `align` stays', () => {
	assert.equal(contextSections(sel(['sticky', 'sticky'], { alignable: 2 })).itemAlign, true)
	assert.equal(contextSections(sel(['sticky', 'shape', 'frame'], { alignable: 3 })).itemAlign, true)
	assert.equal(contextSections(sel(['sticky', 'sticky', 'connector'], { alignable: 2 })).itemAlign, true)
	assert.equal(contextSections(sel(['sticky', 'connector'], { alignable: 1 })).itemAlign, false, 'a note plus a connector')
	assert.equal(contextSections(sel(['frame', 'sticky'], { alignable: 1 })).itemAlign, false, 'a frame plus its child')
	assert.equal(contextSections(sel(['sticky'], { alignable: 1 })).itemAlign, false)
	assert.equal(contextSections(sel([], { alignable: 0 })).itemAlign, false)
	assert.equal(contextSections(sel(['sticky', 'sticky'])).itemAlign, false, 'without alignable')
	assert.equal(contextSections(null).itemAlign, false)
	assert.equal(contextSections(undefined).itemAlign, false)
	// `align` keeps meaning the text alignment of shapes and text items
	assert.deepEqual(contextSections(sel(['shape', 'shape'], { alignable: 2 })).align, [...ENUMS.aligns])
	assert.equal(contextSections(sel(['sticky', 'sticky'], { alignable: 2 })).align, null)
	// "Arrange" (one item) and "Align" (two and more) never show together
	for (const n of [0, 1, 2, 3]) {
		const s = contextSections(sel(Array(n).fill('sticky'), { alignable: n }))
		assert.ok(!(s.arrange && s.itemAlign), String(n))
	}
})

test('M2 distribute (AK8): the section distribute exactly from three alignable items; never without it or without a selection; never without itemAlign', () => {
	assert.equal(contextSections(sel(['sticky', 'sticky', 'sticky'], { alignable: 3 })).distribute, true)
	assert.equal(contextSections(sel(['sticky', 'shape', 'frame', 'text'], { alignable: 4 })).distribute, true)
	assert.equal(contextSections(sel(['sticky', 'sticky', 'connector'], { alignable: 2 })).distribute, false, 'two notes plus a connector')
	assert.equal(contextSections(sel(['frame', 'sticky', 'sticky'], { alignable: 2 })).distribute, false, 'a frame with its child plus a note')
	const two = contextSections(sel(['sticky', 'sticky'], { alignable: 2 }))
	assert.equal(two.distribute, false)
	assert.equal(two.itemAlign, true, 'Align stays from two on')
	assert.equal(contextSections(sel(['sticky', 'sticky', 'sticky'])).distribute, false, 'without alignable')
	assert.equal(contextSections(null).distribute, false)
	assert.equal(contextSections(undefined).distribute, false)
	for (const n of [0, 1, 2, 3, 4, 7]) {
		const s = contextSections(sel(Array(n).fill('sticky'), { alignable: n }))
		assert.equal(s.distribute, n >= 3, String(n))
		assert.ok(!s.distribute || s.itemAlign, 'never without itemAlign: ' + n)
	}
})

// ---- Job 023 (M2, SPEC-M1 §1.2 "(R20) Sperren"): the lock row of the bar ------

/**
 * the bar's own elements in document order (job 230: the entries of "…" after menu:selection, the lock badge)
 */
const order = (html) => [...html.matchAll(/data-knorke-(action|section)="([a-z-]+)"|data-knorke-lock-badge="([a-z]+)"|class="knorke-contextbar__count"|data-knorke-menu="(selection)"/g)]
	.map((m) => (m[1] ? m[1] + ':' + m[2] : m[3] ? 'badge:' + m[3] : m[4] ? 'menu:' + m[4] : 'count'))

test('job 023 (AK9), job 230: a fully locked selection renders no section and no cut/duplicate/front/back/delete; "…" holds copy and unlock, the badge names the locker as plain text', async () => {
	const name = '<b>x</b> & {name}'
	const selection = sel([], {
		ids: ['id0'], count: 1, canConnect: false, box: null,
		locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name }, unlockBy: { kind: 'name', name },
	})
	const html = strip(await render(ContextBar, { selection }))
	assert.doesNotMatch(html, /data-knorke-section=/)
	assert.deepEqual(order(html), ['badge:name', 'menu:selection', 'action:copy', 'action:unlock'])
	const badge = html.match(/<span[^>]*data-knorke-lock-badge="name"[^>]*>([^<]*)<\/span>/)
	assert.ok(badge, 'the badge')
	assert.equal(badge[1], 'Locked by &lt;b&gt;x&lt;/b&gt; &amp; {name}', 'the name as text, literally')
	assert.match(badge[0], /title="Locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}"/, 'the full text in the title')
	assert.doesNotMatch(html, /<b>x<\/b>/)
	const unlock = html.match(/<[a-z]+[^>]*data-knorke-action="unlock"[^>]*>/)[0]
	assert.match(unlock, /title="Unlock \(locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}\) \(Ctrl\+Shift\+L\)"/)
	assert.match(html, /data-knorke-action="unlock"[^>]*>(?:<div[^>]*><\/div>)?\s*Unlock \(locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}\)/, 'the entry text names the locker')
	// with Connect (two locked notes): the count first, connect in "…" after copy
	const two = strip(await render(ContextBar, { selection: { ...selection, ids: ['a', 'b'], count: 2, locked: 2, canConnect: true, unlockable: 0, unlockBy: null } }))
	assert.deepEqual(order(two), ['count', 'badge:name', 'menu:selection', 'action:copy', 'action:connect'])
})

test('job 023 (AK9), job 230: a selection without locks: no badge, Lock in "…" before Delete; a mixed one: Lock, Unlock, the badge before "…"', async () => {
	const free = sel(['sticky'], { ids: ['a'], locked: 0, unlocked: 1, lockable: 1, unlockable: 0, lockedBy: null, unlockBy: null })
	const html = strip(await render(ContextBar, { selection: free }))
	assert.doesNotMatch(html, /data-knorke-lock-badge/)
	assert.deepEqual(order(html).slice(-9), ['menu:selection', 'action:cut', 'action:copy', 'action:duplicate', 'action:front', 'action:back', 'action:arrange', 'action:lock', 'action:delete'])
	const lock = html.match(/<[a-z]+[^>]*data-knorke-action="lock"[^>]*>/)[0]
	assert.match(lock, /title="Lock \(Ctrl\+Shift\+L\)"/)
	const mixed = sel(['sticky'], { ids: ['a', 'b'], count: 2, locked: 1, unlocked: 1, lockable: 1, unlockable: 1, lockedBy: { kind: 'mine' }, unlockBy: { kind: 'mine' } })
	const m = strip(await render(ContextBar, { selection: mixed }))
	assert.deepEqual(order(m).filter((x) => /lock|badge|menu/.test(x)), ['badge:mine', 'menu:selection', 'action:lock', 'action:unlock'])
	assert.equal(order(m).at(-1), 'action:delete', 'Delete last')
	assert.match(m, /data-knorke-lock-badge="mine"[^>]*>Locked by you</)
	// review round 1 (UX N2): with something lockable the key locks, so Unlock names no key
	assert.match(m.match(/<[a-z]+[^>]*data-knorke-action="unlock"[^>]*>/)[0], /title="Unlock"/)
	assert.match(m.match(/<[a-z]+[^>]*data-knorke-action="lock"[^>]*>/)[0], /title="Lock \(Ctrl\+Shift\+L\)"/)
	// an older selection v2 without the lock keys: as before (no lock entries)
	const old = strip(await render(ContextBar, { selection: sel(['sticky'], { ids: ['a'] }) }))
	assert.deepEqual(order(old).slice(-2), ['action:arrange', 'action:delete'])
})

test('job 023: the badge is one line with an ellipsis (40vw, 30vw narrow); Lock and Unlock are 44 px on phones and coarse pointers', () => {
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	const badge = css.match(/\.knorke-contextbar__lock \{([^}]*)\}/)[1]
	for (const rule of ['max-width: 40vw;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;']) {
		assert.ok(badge.includes(rule), rule)
	}
	assert.match(css, /@media only screen and \(max-width: 600px\) \{[\s\S]*?\.knorke-contextbar__lock \{\s*max-width: 30vw;/)
	assert.match(css, /@media \(max-width: 600px\), \(pointer: coarse\) \{\s*\.button-vue\.knorke-contextbar__lockbtn \{\s*min-width: var\(--knorke-touch\) !important;\s*min-height: var\(--knorke-touch\) !important;/)
})

// ---- Job 026 (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): the group section of the bar ----

test('job 026 (AK7), job 230: two free notes → "Group items" in "…" (key in the title); different parents → it stays, its reason as title and description; a whole group → Ungroup only; the group of "…" after back, before lock', async () => {
	const tag = (html, name) => html.match(new RegExp(`<[a-z]+[^>]*data-knorke-action="${name}"[^>]*>`))?.[0] ?? null
	const free = sel(['sticky', 'sticky'], { ids: ['a', 'b'], locked: 0, unlocked: 2, lockable: 2, unlockable: 0, groupable: 2, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false })
	let html = strip(await render(ContextBar, { selection: free }))
	const group = tag(html, 'group')
	assert.ok(group, 'Group items')
	assert.match(group, /data-stub="NcActionButton"/)
	assert.doesNotMatch(group, /\sdisabled|description=/, 'never disabled, no reason')
	assert.match(group, /title="Group items \(Ctrl\+G\)"/)
	assert.equal(tag(html, 'ungroup'), null)
	assert.deepEqual(order(html).slice(-4), ['action:back', 'action:group', 'action:lock', 'action:delete'])
	assert.equal((html.match(/data-stub="NcActionSeparator"/g) ?? []).length, 4, 'a separator between each two of the five groups')
	html = strip(await render(ContextBar, { selection: { ...free, groupable: 3, groupBlock: 'parent' } }))
	assert.match(tag(html, 'group'), /title="Only items in the same frame, or all outside frames, can be grouped\."/)
	assert.match(tag(html, 'group'), /description="Only items in the same frame, or all outside frames, can be grouped\."/)
	assert.match(tag(html, 'group'), /class="knorke-more--blocked"/)
	const whole = { ...free, grouped: 1, oneGroup: true }
	html = strip(await render(ContextBar, { selection: whole }))
	assert.equal(tag(html, 'group'), null, 'exactly one group: no Group items')
	assert.match(tag(html, 'ungroup'), /title="Ungroup \(Ctrl\+Shift\+G\)"/)
	html = strip(await render(ContextBar, { selection: { ...whole, ungroupBlock: 'locked' } }))
	assert.match(tag(html, 'ungroup'), /title="Locked items cannot be grouped or ungrouped\."/)
	html = strip(await render(ContextBar, { selection: sel(['sticky'], { ids: ['a'] }) }))
	assert.equal(tag(html, 'group') ?? tag(html, 'ungroup'), null, 'a selection v2 without the group keys: no entry')
})

test('job 026 (AK7): a blocked group button looks disabled; Group items and Ungroup are 44 px on phones and coarse pointers', () => {
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /\.button-vue\.knorke-contextbar__groupbtn\[aria-disabled='true'\] \{\s*opacity: var\(--opacity-disabled, 0\.5\);/)
	assert.match(css, /@media \(max-width: 600px\), \(pointer: coarse\) \{[\s\S]*?\.button-vue\.knorke-contextbar__groupbtn \{\s*min-width: var\(--knorke-touch\) !important;\s*min-height: var\(--knorke-touch\) !important;/)
})

test('job 026 round 1 (code review 1, UX B1): Group items only when it would make a new group – a member after the second click and a group plus its connector show Ungroup only (fields from groupSummary on a real SceneModel)', async () => {
	const G = '01JG0000000000000000000001'
	const note = (id, x, extra = {}) => ({ id, t: 'sticky', x, y: 0, w: 200, h: 200, r: 0, z: 'a' + id, parent: null, data: {}, style: {}, ...extra })
	const m = new SceneModel()
	m.load([
		note('A', 0, { group: G }), note('B', 300, { group: G }), note('C', 600),
		{ id: 'K', t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b0', parent: null, data: { start: { item: 'A' }, end: { item: 'B' } }, style: {} },
	])
	const tag = (html, name) => html.match(new RegExp(`<[a-z]+[^>]*data-knorke-action="${name}"[^>]*>`))?.[0] ?? null
	const bar = async (ids) => strip(await render(ContextBar, {
		selection: sel(ids.map((id) => m.get(id).t), { ids, locked: 0, unlocked: ids.length, lockable: ids.length, unlockable: 0, ...groupSummary(m, ids) }),
	}))
	for (const [ids, why] of [[['A'], 'one member (second click)'], [['A', 'B', 'K'], 'the group plus its connector'], [['B', 'A'], 'the whole group']]) {
		const html = await bar(ids)
		assert.equal(tag(html, 'group'), null, why + ': no Group items')
		assert.match(tag(html, 'ungroup') ?? '', /title="Ungroup/, why + ': Ungroup')
	}
	const html = await bar(['A', 'C'])
	assert.doesNotMatch(tag(html, 'group') ?? '', /description=/, 'a member plus a free note: a new group of three')
	assert.ok(tag(html, 'group'))
})

// ---- Job 135: colour picker -------------------------------------------------

/**
 * @param {string} name panel to open; (job 230) fill, border and text are tabs of the panel 'color'
 * @return {object} ContextBar whose panel is open from the start (its own toggle, before the render)
 */
const withPanel = (name) => ({
	...ContextBar,
	setup(props, ctx) {
		const b = ContextBar.setup(props, ctx)
		if (['fill', 'border', 'text'].includes(name)) {
			b.toggle('color')
			b.pickTab(name)
		} else {
			b.toggle(name)
		}
		return b
	},
})

/** every element with the attribute (start tags) */
const tagsWith = (html, attr) => [...html.matchAll(new RegExp(`<[a-z]+\\b[^>]*\\b${attr}(?:="[^"]*")?[^>]*>`, 'g'))].map((m) => m[0])

/** the values of data-knorke-value inside the first element with `attr` (its own closing tag) */
function valuesIn(html, attr) {
	const start = html.search(new RegExp(`<div\\b[^>]*${attr}`))
	assert.ok(start >= 0, attr)
	const tags = /<(\/?)div\b[^>]*>/g
	tags.lastIndex = start
	let depth = 0
	for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
		depth += m[1] === '/' ? -1 : 1
		if (depth === 0) {
			return [...html.slice(start, tags.lastIndex).matchAll(/data-knorke-value="([^"]*)"/g)].map((x) => x[1])
		}
	}
	throw new Error('not closed: ' + attr)
}

test('job 135 (AK1), job 230: a note, a frame, a shape and mixes render exactly one colour dot [data-knorke-section=color] with the common fill and no swatch outside the panel', async () => {
	for (const [types, fill] of [[['sticky'], '#a8d8f8'], [['frame'], '#ffffff'], [['shape'], '#ffffff'], [['sticky', 'shape'], '#a8d8f8'], [['sticky', 'frame'], '#ffd8e6']]) {
		const html = strip(await render(ContextBar, { selection: sel(types, { fill, fills: [fill] }) }))
		const toggles = tagsWith(html, 'data-knorke-section="color"')
		assert.equal(toggles.length, 1, types.join('+'))
		assert.match(toggles[0], /data-stub="NcButton"/)
		assert.match(toggles[0], /aria-label="Color and text"/)
		assert.match(toggles[0], /aria-expanded="false"/)
		const dots = tagsWith(html, 'data-knorke-fill-current')
		assert.equal(dots.length, 1, types.join('+') + ': one dot')
		assert.match(dots[0], new RegExp(`data-knorke-fill-current="${fill}"`))
		assert.match(dots[0], new RegExp(`style="background-color:${fill};"`))
		assert.match(dots[0], /aria-hidden="true"/)
		assert.ok(html.indexOf(dots[0]) > html.indexOf(toggles[0]), 'the dot inside the toggle')
		assert.doesNotMatch(html, /knorke-swatch/, types.join('+') + ': no swatch while the panel is closed')
		assert.doesNotMatch(html, /data-knorke-section="(fill|border|text)"/, 'job 230: no fill, border or text toggle of their own')
		assert.equal(order(html).filter((x) => x.startsWith('section:'))[0], 'section:color', 'the dot is the first section')
	}
	// job 230: without a fill the dot shows the line (connector) or the text colour (text item)
	const line = tagsWith(strip(await render(ContextBar, { selection: sel(['connector'], { stroke: '#0275a9' }) })), 'data-knorke-fill-current')
	assert.match(line[0], /data-knorke-fill-current="#0275a9"/)
	const text = tagsWith(strip(await render(ContextBar, { selection: sel(['text'], { color: '#c43e45' }) })), 'data-knorke-fill-current')
	assert.match(text[0], /data-knorke-fill-current="#c43e45"/)
})

test('job 135 (AK2): two notes #a8d8f8 and #fff6b6 → the dot carries mixed and is split in half into exactly these colours, in selection order; equal fills → one colour, no split', async () => {
	const mixed = (fills) => sel(['sticky', 'sticky'], { fill: null, mixed: [SELECTION_FIELDS.fill], fills })
	let dot = tagsWith(strip(await render(ContextBar, { selection: mixed(['#a8d8f8', '#fff6b6']) })), 'data-knorke-fill-current')
	assert.equal(dot.length, 1)
	assert.match(dot[0], /data-knorke-fill-current="mixed"/)
	assert.match(dot[0], /style="background:linear-gradient\(90deg, #a8d8f8 50%, #fff6b6 50%\);"/)
	dot = tagsWith(strip(await render(ContextBar, { selection: mixed(['#fff6b6', '#a8d8f8']) })), 'data-knorke-fill-current')
	assert.match(dot[0], /linear-gradient\(90deg, #fff6b6 50%, #a8d8f8 50%\)/, 'the order of the selection')
	dot = tagsWith(strip(await render(ContextBar, { selection: sel(['sticky', 'sticky'], { fill: '#a8d8f8', fills: ['#a8d8f8'] }) })), 'data-knorke-fill-current')
	assert.match(dot[0], /data-knorke-fill-current="#a8d8f8"/)
	assert.match(dot[0], /style="background-color:#a8d8f8;"/)
	assert.doesNotMatch(dot[0], /gradient/)
	// a value that is no #rrggbb never reaches the style
	dot = tagsWith(strip(await render(ContextBar, { selection: mixed(['#a8d8f8', 'red;background:url(x)']) })), 'data-knorke-fill-current')
	assert.doesNotMatch(dot[0], /url|red|background/)
})

test('job 135 (AK3): the colour block renders for each of the six palettes: grid, "#" field, preview dot and system picker with the right path; then the other rows', async () => {
	const cases = [
		['note fill', ['sticky'], 'fill', 'style.fill', LIGHT, { fill: '#a2d9fe' }],
		['frame fill', ['frame'], 'fill', 'style.fill', LIGHT, { fill: '#ffffff' }],
		['shape fill', ['shape'], 'fill', 'style.fill', LIGHT, { fill: '#ffffff' }],
		['shape border', ['shape'], 'border', 'style.stroke', BORDER_COLORS, { stroke: '#3d4044', redesigned: true }],
		['BPMN border', ['shape'], 'border', 'style.stroke', STRONG, { stroke: '#191b1d' }],
		['shape text colour', ['shape'], 'text', 'style.textColor', STRONG, { textColor: '#191b1d' }],
		['text item colour', ['text'], 'text', 'style.color', STRONG, { color: '#c43e45' }],
		['connector line', ['connector'], 'border', 'style.stroke', LINE_COLORS, { stroke: '#3d4044' }],
	]
	for (const [what, types, name, path, palette, values] of cases) {
		const html = panelOf(strip(await render(withPanel(name), { selection: sel(types, values) })))
		const common = Object.values(values)[0]
		assert.deepEqual(valuesIn(html, 'knorke-contextbar__colors--grid'), [...palette], what + ': the grid')
		for (const sw of tagsWith(html, 'data-knorke-value').filter((x) => x.includes('knorke-swatch'))) {
			assert.match(sw, new RegExp(`data-knorke-style="${path.replace('.', '\\.')}"`), what + ': the path of every swatch')
		}
		const hex = tagsWith(html, 'data-knorke-hex=')
		assert.equal(hex.length, 1, what)
		assert.match(hex[0], /^<input type="text"/)
		assert.ok(hex[0].includes(`data-knorke-hex="${path}"`), what + ': hex path')
		assert.ok(hex[0].includes(`value="${common.slice(1)}"`), what + ': the common colour without #')
		for (const a of ['aria-label="Hex color"', 'maxlength="7"', 'autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"', 'enterkeyhint="done"']) {
			assert.ok(hex[0].includes(a), what + ': ' + a)
		}
		assert.doesNotMatch(hex[0], /aria-invalid/)
		const preview = tagsWith(html, 'data-knorke-hex-preview')
		assert.equal(preview.length, 1, what)
		assert.ok(preview[0].includes(`background-color:${common};`), what + ': the preview shows the colour')
		const system = tagsWith(html, 'data-knorke-system-color=')
		assert.equal(system.length, 1, what)
		assert.match(system[0], /^<input type="color"/)
		assert.ok(system[0].includes(`data-knorke-system-color="${path}"`), what + ': system path')
		assert.ok(system[0].includes(`value="${common}"`), what + ': the system picker starts on the common colour')
		assert.match(system[0], /aria-label="Custom color"/)
		assert.doesNotMatch(html, /data-knorke-board-colors/, what + ': no board row without board colours')
		const order = ['knorke-contextbar__colors--grid', 'data-knorke-hex=', 'data-knorke-system-color='].map((x) => html.indexOf(x))
		assert.deepEqual([...order].sort((a, b) => a - b), order, what + ': grid, hex field, system picker')
	}
	// mixed: the field is empty, the preview only an edge, the system picker on the first palette colour
	const mixed = panelOf(strip(await render(withPanel('fill'), { selection: sel(['sticky', 'sticky'], { fill: null, mixed: [SELECTION_FIELDS.fill], fills: ['#a2d9fe', '#faea89'] }) })))
	assert.ok(tagsWith(mixed, 'data-knorke-hex=')[0].includes('value=""'))
	assert.doesNotMatch(tagsWith(mixed, 'data-knorke-hex-preview')[0], /background/)
	assert.ok(tagsWith(mixed, 'data-knorke-system-color=')[0].includes(`value="${LIGHT[0]}"`))
	assert.doesNotMatch(mixed, /aria-pressed="true"/, 'no swatch pressed')
})

test('job 135 (AK3): the row "On this board": only with board colours, up to BOARD_COLORS_MAX swatches with data-knorke-style and data-knorke-value, before the other rows (opacity)', async () => {
	const board = ['#1f3a5f', '#123456', '#abcdef']
	const html = panelOf(strip(await render(withPanel('fill'), { selection: sel(['shape'], { fill: '#123456', boardColors: board }) })))
	const row = tagsWith(html, 'data-knorke-board-colors')
	assert.equal(row.length, 1)
	assert.match(row[0], /role="group"/)
	assert.match(row[0], /aria-label="On this board"/)
	assert.deepEqual(valuesIn(html, 'data-knorke-board-colors'), board)
	const swatches = tagsWith(html.slice(html.indexOf(row[0])), 'data-knorke-value').slice(0, 3)
	for (const [i, sw] of swatches.entries()) {
		assert.match(sw, /data-knorke-style="style\.fill"/)
		assert.ok(sw.includes(`aria-label="Color ${board[i]}"`))
		assert.match(sw, i === 1 ? /aria-pressed="true"/ : /aria-pressed="false"/, 'the common colour is pressed')
	}
	assert.ok(html.indexOf('data-knorke-board-colors') > html.indexOf('knorke-contextbar__colors--grid'), 'job 230: after the grid')
	assert.ok(html.indexOf('data-knorke-board-colors') < html.indexOf('data-knorke-action="custom-color"'), 'job 230: before "Custom color…" and its hex row')
	assert.ok(html.indexOf('data-knorke-board-colors') < html.indexOf('aria-label="Opacity"'), 'before the opacity row')
	// at most BOARD_COLORS_MAX; a value that is no colour is left out
	const many = Array.from({ length: 10 }, (_, i) => '#00000' + i)
	const capped = panelOf(strip(await render(withPanel('border'), { selection: sel(['connector'], { boardColors: ['x', ...many] }) })))
	assert.deepEqual(valuesIn(capped, 'data-knorke-board-colors'), many.slice(0, BOARD_COLORS_MAX))
	assert.equal(BOARD_COLORS_MAX, 8)
	assert.match(capped, /data-knorke-board-colors[^>]*>[\s\S]*data-knorke-style="style\.stroke"/)
})

test('job 135 (AK4): parseHex – optional #, exactly six hex digits, blanks around and case do not matter', () => {
	for (const ok of ['#ff8800', 'FF8800', ' #Ff8800 ', 'ff8800', '\t#FF8800\n']) {
		assert.equal(parseHex(ok), '#ff8800', JSON.stringify(ok))
	}
	for (const bad of ['#f80', 'ff880', '#ff88001', 'gg8800', '##ff8800', '', null, undefined, 0xff8800, '#ff 8800', 'ff8800;', ['#ff8800']]) {
		assert.equal(parseHex(bad), null, JSON.stringify(bad))
	}
})

test('job 135 (AK6): boardColors – palette colours left out, one count per item and field, most used first, ties by hex, at most 8, the same for any item order', () => {
	const item = (id, t, style) => ({ id, t, x: 0, y: 0, w: 10, h: 10, r: 0, z: 'a' + id, parent: null, data: {}, style })
	const items = [
		item('1', 'sticky', { fill: '#1F3A5F' }),
		item('2', 'sticky', { fill: '#1f3a5f' }),
		item('3', 'shape', { fill: '#1f3a5f', stroke: '#abcdef', textColor: '#abcdef' }),
		item('4', 'text', { color: '#abcdef' }),
		item('5', 'connector', { stroke: '#123456' }),
		item('6', 'frame', { fill: '#ff8800' }),
		item('7', 'frame', { fill: '#ff8800' }),
		// palette colours of every palette: never in the row
		item('8', 'sticky', { fill: STICKY_COLORS[3] }),
		item('9', 'frame', { fill: FRAME_FILL }),
		item('10', 'shape', { fill: SHAPE_PALETTE[5], stroke: SHAPE_PALETTE[12], textColor: SHAPE_PALETTE[15] }),
		item('11', 'connector', { stroke: CONNECTOR_COLORS[4] }),
		// job 227: the new tones and the two defaults
		item('11a', 'sticky', { fill: LIGHT[2] }),
		item('11b', 'shape', { fill: LIGHT[12], stroke: STRONG[5], textColor: STRONG[10] }),
		item('11c', 'connector', { stroke: CONNECTOR_STROKE }),
		item('11d', 'table', { headerFill: TABLE_HEADER_FILL, stroke: STRONG[1], textColor: STRONG[0] }),
		// a locked item counts too
		{ ...item('12', 'sticky', { fill: '#010203' }), lock: { by: 'p1', name: 'Al' } },
		// invalid stored values read as the default (a palette colour); unknown types and fields have no colour rule
		item('13', 'sticky', { fill: 'red' }),
		item('14', 'brush', { fill: '#0a0b0c', stroke: '#0a0b0c' }),
		item('15', 'sticky', { stroke: '#0d0e0f', textColor: '#0d0e0f' }),
	]
	assert.deepEqual(boardColors(items), ['#1f3a5f', '#abcdef', '#ff8800', '#010203', '#123456'])
	assert.deepEqual(boardColors([...items].reverse()), boardColors(items), 'the order of the items does not matter')
	assert.deepEqual(boardColors([]), [])
	assert.deepEqual(boardColors(null), [])
	const ten = Array.from({ length: 10 }, (_, i) => item('t' + i, 'sticky', { fill: '#0000' + String(10 + i) }))
	assert.deepEqual(boardColors(ten), ten.slice(0, 8).map((it) => it.style.fill), 'at most 8, ties by hex')
	assert.deepEqual(boardColors([...ten].reverse()), boardColors(ten))
	const palettes = [...STICKY_COLORS, ...FRAME_FILLS, ...SHAPE_PALETTE, ...CONNECTOR_COLORS, ...LEGACY_TAG_COLORS, ...LEGACY_MM_COLORS, ...LIGHT, ...STRONG, CONNECTOR_STROKE, TABLE_HEADER_FILL]
	assert.deepEqual(boardColors(palettes.map((c, i) => item('p' + i, 'shape', { fill: c, stroke: c, textColor: c }))), [], 'no palette colour')
})

// ---- Job 143: "Rename" for one frame ----------------------------------------------------

test('job 143 (AK6): sections.rename only for exactly one unlocked frame', () => {
	assert.equal(contextSections(sel(['frame'])).rename, true, 'a selection v2 without lock keys counts as unlocked')
	assert.equal(contextSections(sel(['frame'], { locked: 0, unlocked: 1 })).rename, true)
	assert.equal(contextSections(sel(['frame'], { locked: 1, unlocked: 0 })).rename, false, 'a locked frame')
	assert.equal(contextSections(sel(['frame', 'frame'])).rename, false, 'two frames')
	assert.equal(contextSections(sel(['frame', 'sticky'])).rename, false, 'a frame with a note')
	assert.equal(contextSections(sel(['sticky'])).rename, false, 'a note')
	assert.equal(contextSections(sel(['connector'])).rename, false, 'a connector')
	assert.equal(contextSections(null).rename, false)
})

test('job 143 (AK6): the bar renders "Rename" for a frame (pencil, aria-label, title with Enter) before the separator; not for a note', async () => {
	const html = strip(await render(ContextBar, { selection: sel(['frame'], { ids: ['f'], locked: 0, unlocked: 1, lockable: 1, unlockable: 0 }) }))
	const tags = html.match(/<[a-z]+[^>]*data-knorke-action="rename"[^>]*>/g) ?? []
	assert.equal(tags.length, 1)
	assert.match(tags[0], /aria-label="Rename"/)
	assert.match(tags[0], /title="Rename \(Enter\)"/)
	const button = html.slice(html.indexOf(tags[0]), html.indexOf('</button>', html.indexOf(tags[0])))
	assert.ok(button.includes(icons.pencil), 'the pencil icon')
	assert.deepEqual(order(html).slice(0, 2), ['section:color', 'action:rename'], 'job 230: the type group right after the colour dot')
	assert.ok(html.indexOf(tags[0]) > html.indexOf('knorke-contextbar__sep'), 'job 230: after the separator behind the dot')
	const apple = strip(await render(ContextBar, { selection: sel(['frame'], { ids: ['f'] }), apple: true }))
	assert.match(apple.match(/<[a-z]+[^>]*data-knorke-action="rename"[^>]*>/)[0], /title="Rename \(↩\)"/)
	const sticky = strip(await render(ContextBar, { selection: sel(['sticky'], { ids: ['a'] }) }))
	assert.doesNotMatch(sticky, /data-knorke-action="rename"/)
	const locked = strip(await render(ContextBar, { selection: sel(['frame'], { ids: ['f'], locked: 1, unlocked: 0, lockable: 0, unlockable: 1 }) }))
	assert.doesNotMatch(locked, /data-knorke-action="rename"/)
})

test('job 173 AK6: tables – border and text only with the colour (no width, dash or size), the section header only for tables alone', async () => {
	const tb = contextSections(sel(['table']))
	assert.deepEqual(tb.stroke, [...STRONG])
	assert.equal(tb.strokeWidth, false)
	assert.deepEqual(tb.strokeWidths, [])
	assert.equal(tb.dash, null)
	assert.deepEqual(tb.textColor, { path: 'style.textColor', palette: [...STRONG] })
	assert.equal(tb.fontSize, null)
	assert.equal(tb.align, null)
	assert.equal(tb.fill, null)
	assert.deepEqual(tb.header, { palette: [TABLE_HEADER_FILL, ...LIGHT] })
	assert.deepEqual(tb.header.palette, [...HEADER_FILLS])
	assert.equal(tb.styled, true)
	for (const mix of [['table', 'shape'], ['table', 'sticky'], ['shape']]) {
		assert.equal(contextSections(sel(mix)).header, null, mix.join('+'))
	}
	// rendered: the toggle [data-knorke-section=header] only for tables
	const html = strip(await render(ContextBar, { selection: sel(['table'], { header: 'on', headerFill: TABLE_HEADER_FILL }) }))
	assert.match(html, /data-knorke-section="header"/)
	assert.doesNotMatch(strip(await render(ContextBar, { selection: sel(['table', 'shape']) })), /data-knorke-section="header"/)
	// its panel: the switch "Header row" (aria-pressed: on) and the colour of the header
	const on = panelOf(strip(await render(withPanel('header'), { selection: sel(['table'], { header: 'on', headerFill: TABLE_HEADER_FILL }) })))
	const sw = tagsWith(on, 'data-knorke-style="style.header"')
	assert.equal(sw.length, 1)
	assert.match(sw[0], / pressed="true"/, 'NcButton :pressed (aria-pressed) – the stub renders the prop')
	assert.match(sw[0], /data-knorke-value="off"/, 'a click switches it off')
	assert.match(on, /Header row/)
	assert.deepEqual(valuesIn(on, 'knorke-contextbar__colors--grid'), [TABLE_HEADER_FILL, ...LIGHT])
	const off = panelOf(strip(await render(withPanel('header'), { selection: sel(['table'], { header: 'off' }) })))
	assert.match(tagsWith(off, 'data-knorke-style="style.header"')[0], / pressed="false"/)
	assert.match(tagsWith(off, 'data-knorke-style="style.header"')[0], /data-knorke-value="on"/)
	// job 265: the switch "Header column" beside it, off by default
	assert.match(tagsWith(off, 'data-knorke-style="style.headerCol"')[0], / pressed="false"/)
	assert.match(tagsWith(off, 'data-knorke-style="style.headerCol"')[0], /data-knorke-value="on"/)
	const col = panelOf(strip(await render(withPanel('header'), { selection: sel(['table'], { header: 'on', headerCol: 'on' }) })))
	assert.match(tagsWith(col, 'data-knorke-style="style.headerCol"')[0], / pressed="true"/)
	assert.match(tagsWith(col, 'data-knorke-style="style.headerCol"')[0], /data-knorke-value="off"/)
	assert.equal(SELECTION_FIELDS.headerCol, 'style.headerCol')
	// the border and text panels hold only the colour
	const border = panelOf(strip(await render(withPanel('border'), { selection: sel(['table'], { stroke: '#c6cacf' }) })))
	assert.doesNotMatch(border, /data-knorke-style="style.strokeWidth"|data-knorke-style="style.dash"/)
	const text = panelOf(strip(await render(withPanel('text'), { selection: sel(['table'], { textColor: '#191b1d' }) })))
	assert.doesNotMatch(text, /data-knorke-style="style.fontSize"|data-knorke-style="style.align"/)
	assert.match(text, /data-knorke-hex="style.textColor"/)
	assert.equal(SELECTION_FIELDS.header, 'style.header')
	assert.equal(SELECTION_FIELDS.headerFill, 'style.headerFill')
})

test('job 195 AK5, job 198 AK6: mind maps – the section "Layout" for one unlocked map; the section "Branch" only with a focused node: its colours and the four shapes', async () => {
	const map = (node, extra = {}) => sel(['mindmap'], { mindmap: { id: 'id0', layout: 'both', locked: false, node, ...extra } })
	const node = { key: 'n10000000', root: false, color: '#c43e45', shape: 'pill', kids: 1, folded: false }
	const layouts = { layouts: ['both', 'right', 'org', 'tree'] }
	assert.deepEqual(contextSections(map(node)).mmNode, { colors: [...STRONG_COLORED], shapes: ['line', 'rect', 'roundRect', 'pill'] })
	assert.deepEqual(contextSections(map(node)).mmLayout, layouts)
	assert.equal(contextSections(map(null)).mmNode, null, 'no focus: no section')
	assert.deepEqual(contextSections(map(null)).mmLayout, layouts)
	assert.equal(contextSections(map(node, { locked: true })).mmNode, null, 'locked')
	assert.equal(contextSections(map(node, { locked: true })).mmLayout, null)
	assert.equal(contextSections(sel(['sticky'])).mmLayout, null)
	// job 198: org and tree draw boxes only
	for (const layout of ['org', 'tree']) {
		assert.deepEqual(contextSections(map(node, { layout })).mmNode.shapes, ['rect', 'roundRect', 'pill'], layout)
	}
	const html = strip(await render(ContextBar, { selection: map(node) }))
	assert.match(html, /data-knorke-section="mm-node"/)
	const toggle = tagsWith(html, 'data-knorke-section="mm-layout"')
	assert.equal(toggle.length, 1)
	assert.match(toggle[0], /aria-expanded="false"/)
	assert.equal(tagsWith(html, 'data-knorke-action="mm-layout"').length, 0, 'the layouts are in the panel')
	for (const layout of ['both', 'right', 'org', 'tree']) {
		const p = panelOf(strip(await render(withPanel('mm-layout'), { selection: map(node, { layout }) })))
		const buttons = tagsWith(p, 'data-knorke-action="mm-layout"')
		assert.deepEqual(buttons.map((b) => /data-knorke-value="([a-z]+)"/.exec(b)[1]), ['both', 'right', 'org', 'tree'])
		assert.deepEqual(buttons.map((b) => / pressed="true"/.test(b)), ['both', 'right', 'org', 'tree'].map((v) => v === layout), layout)
		assert.ok(buttons.every((b) => /aria-label="[^"]+"/.test(b)), 'named')
	}
	assert.equal(tagsWith(strip(await render(ContextBar, { selection: map(node, { locked: true }) })), 'data-knorke-section="mm-layout"').length, 0, 'locked: none')
	assert.doesNotMatch(strip(await render(ContextBar, { selection: map(null) })), /data-knorke-section="mm-node"/)
	const panel = panelOf(strip(await render(withPanel('mm-node'), { selection: map(node) })))
	assert.deepEqual(valuesIn(panel, 'knorke-contextbar__colors--grid'), [...STRONG_COLORED])
	const shapes = tagsWith(panel, 'data-knorke-style="mm.shape"')
	assert.equal(shapes.length, 4)
	assert.match(shapes.find((x) => /data-knorke-value="pill"/.test(x)), / pressed="true"/, 'the node\'s shape')
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(src, /@mindmap="\(w, v, e\) => act\(e, \(s\) => s\.mindmapStyle\(w, v\)\)"/)
})

test('job 227 AK8: notes only: the text panel offers Auto, S, M and L (16, 22, 32) named Small, Medium and Large, M marked on a new note; a mix keeps the number steps', async () => {
	const html = panelOf(strip(await render(withPanel('text'), { selection: sel(['sticky'], { fontSize: 22 }) })))
	const sizes = tagsWith(html, 'data-knorke-style="style.fontSize"')
	assert.deepEqual(sizes.map((b) => /data-knorke-value="([^"]+)"/.exec(b)[1]), ['auto', '16', '22', '32'])
	assert.deepEqual(sizes.slice(1).map((b) => /aria-label="([^"]+)"/.exec(b)?.[1]), ['Small', 'Medium', 'Large'])
	assert.deepEqual(sizes.slice(1).map((b) => /title="([^"]+)"/.exec(b)?.[1]), ['Small', 'Medium', 'Large'])
	assert.deepEqual(sizes.map((b) => /aria-pressed="(true|false)"/.exec(b)[1]), ['false', 'false', 'true', 'false'])
	for (const [v, letter] of [['16', 'S'], ['22', 'M'], ['32', 'L']]) {
		assert.match(html, new RegExp(`data-knorke-value="${v}"[^>]*>\\s*${letter}\\s*</button>`), letter)
	}
	const auto = panelOf(strip(await render(withPanel('text'), { selection: sel(['sticky'], { fontSize: null }) })))
	assert.match(tagsWith(auto, 'data-knorke-value="auto"')[0], /aria-pressed="true"/, 'a stored note without a size: Auto')
	const mix = panelOf(strip(await render(withPanel('text'), { selection: sel(['sticky', 'shape'], { fontSize: null }) })))
	const mixed = tagsWith(mix, 'data-knorke-style="style.fontSize"').map((b) => /data-knorke-value="([^"]+)"/.exec(b)[1])
	assert.deepEqual(mixed, ['auto', '12', '16', '20', '24', '32', '48', '64', '96', '128'])
	assert.doesNotMatch(mix, /aria-label="Medium"/)
})
