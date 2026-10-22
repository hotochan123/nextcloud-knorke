/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * What the context bar shows (SPEC-M1 §6.5.1, §6.6): only fields every
 * selected type has, palettes by name from tokens.js (never literals here),
 * font sizes within every type's rule, "Auto" only where it means auto-fit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contextSections, fillPalette, fontSizes, isCurrent, SELECTION_FIELDS, STROKE_WIDTHS, strokePalette, strokeWidths } from '../../../src/components/contextbar.js'
import { groupSummary } from '../../../src/model/groups.js'
import { ENUMS, fieldRule, TYPES } from '../../../src/model/registry.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { CONNECTOR_COLORS, FRAME_FILL, FRAME_FILLS, SHAPE_PALETTE, STICKY_COLORS } from '../../../src/model/tokens.js'
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

test('fill palette: shapes → SHAPE_PALETTE, frames → FRAME_FILLS, notes or a mix → the note palette (+ FRAME_FILL with a frame)', () => {
	assert.deepEqual(fillPalette(['shape']), [...SHAPE_PALETTE])
	assert.deepEqual(fillPalette(['frame', 'frame']), [...FRAME_FILLS])
	assert.deepEqual(fillPalette(['sticky']), [...STICKY_COLORS])
	assert.deepEqual(fillPalette(['sticky', 'shape']), [...STICKY_COLORS])
	assert.deepEqual(fillPalette(['sticky', 'frame']), [...STICKY_COLORS, FRAME_FILL])
	assert.deepEqual(fillPalette([]), [])
})

test('sections per type: only fields every selected type has', () => {
	const shape = contextSections(sel(['shape']))
	assert.deepEqual(shape.fill, [...SHAPE_PALETTE])
	assert.equal(shape.fillOpacity, true)
	assert.deepEqual(shape.stroke, [...SHAPE_PALETTE])
	assert.equal(shape.strokeWidth, true)
	assert.deepEqual(shape.dash, [...ENUMS.dashes])
	assert.deepEqual(shape.textColor, { path: 'style.textColor', palette: [...SHAPE_PALETTE] })
	assert.deepEqual(shape.align, [...ENUMS.aligns])
	assert.deepEqual(shape.valign, [...ENUMS.valigns])
	assert.deepEqual(shape.kind, [...ENUMS.shapeKinds])
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
	assert.deepEqual(note.fill, [...STICKY_COLORS])
	assert.equal(note.stroke, null)
	assert.equal(note.textColor, null)
	assert.equal(note.fontSize.auto, true)

	const frame = contextSections(sel(['frame']))
	assert.deepEqual(frame.fill, [...FRAME_FILLS])
	assert.equal(frame.fontSize, null)

	// note + shape: fill (note palette) and font size; no border (notes have none)
	const mix = contextSections(sel(['sticky', 'shape']))
	assert.deepEqual(mix.fill, [...STICKY_COLORS])
	assert.equal(mix.stroke, null)
	assert.equal(mix.kind, null)
	assert.ok(mix.fontSize)
	// shape + text: different text colour paths → no text colour
	const st = contextSections(sel(['shape', 'text']))
	assert.equal(st.textColor, null)
	assert.deepEqual(st.align, [...ENUMS.aligns])
	assert.equal(contextSections(sel(['sticky', 'shape'])).arrange, false, 'arrange: one item only')
	// unknown types (placeholders) have no fields
	assert.equal(contextSections({ ...sel([]), types: new Set(['pen']), fields: [], count: 1 }).styled, false)
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

test('round 1b connectors: route, both tips, line colours CONNECTOR_COLORS (connectors only), widths inside the rule (from 1), dash, label for one connector; never arrange', () => {
	const c = contextSections(sel(['connector']))
	assert.deepEqual(c.route, [...ENUMS.routes])
	assert.deepEqual(c.startCap, [...ENUMS.caps])
	assert.deepEqual(c.endCap, [...ENUMS.caps])
	assert.deepEqual(c.stroke, [...CONNECTOR_COLORS])
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
	// connector + shape: only the shared stroke fields, the shape palette, widths valid for both
	const mix = contextSections(sel(['connector', 'shape']))
	assert.deepEqual(mix.stroke, [...SHAPE_PALETTE])
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
	assert.deepEqual(strokePalette(['shape']), [...SHAPE_PALETTE])
	assert.deepEqual(strokePalette(['connector']), [...CONNECTOR_COLORS])
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

/** the bar's own elements in document order (lock row included) */
const order = (html) => [...html.matchAll(/data-knorke-(action|section)="([a-z]+)"|data-knorke-lock-badge="([a-z]+)"|class="knorke-contextbar__count"|aria-label="(Bring to front|Send to back|Delete)"/g)]
	.map((m) => (m[1] ? m[1] + ':' + m[2] : m[3] ? 'badge:' + m[3] : m[4] ? 'button:' + m[4] : 'count'))

test('job 023 (AK9): a fully locked selection renders no section, no cut/duplicate/front/back/delete, but copy, unlock and the badge with the name as plain text', async () => {
	const name = '<b>x</b> & {name}'
	const selection = sel([], {
		ids: ['id0'], count: 1, canConnect: false, box: null,
		locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name }, unlockBy: { kind: 'name', name },
	})
	const html = strip(await render(ContextBar, { selection }))
	assert.doesNotMatch(html, /data-knorke-section=/)
	assert.deepEqual(order(html), ['action:copy', 'action:unlock', 'badge:name', 'count'])
	const badge = html.match(/<span[^>]*data-knorke-lock-badge="name"[^>]*>([^<]*)<\/span>/)
	assert.ok(badge, 'the badge')
	assert.equal(badge[1], 'Locked by &lt;b&gt;x&lt;/b&gt; &amp; {name}', 'the name as text, literally')
	assert.match(badge[0], /title="Locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}"/, 'the full text in the title')
	assert.doesNotMatch(html, /<b>x<\/b>/)
	const unlock = html.match(/<[a-z]+[^>]*data-knorke-action="unlock"[^>]*>/)[0]
	assert.match(unlock, /aria-label="Unlock \(locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}\)"/)
	assert.match(unlock, /title="Unlock \(locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}\) \(Ctrl\+Shift\+L\)"/)
	// with Connect (two locked notes): connect first
	const two = strip(await render(ContextBar, { selection: { ...selection, ids: ['a', 'b'], count: 2, locked: 2, canConnect: true, unlockable: 0, unlockBy: null } }))
	assert.deepEqual(order(two), ['action:connect', 'action:copy', 'badge:name', 'count'])
})

test('job 023 (AK9): a selection without locks: no badge, but Lock after Delete; a mixed one: the editing buttons, Lock, Unlock and the badge before the count', async () => {
	const free = sel(['sticky'], { ids: ['a'], locked: 0, unlocked: 1, lockable: 1, unlockable: 0, lockedBy: null, unlockBy: null })
	const html = strip(await render(ContextBar, { selection: free }))
	assert.doesNotMatch(html, /data-knorke-lock-badge/)
	assert.deepEqual(order(html).slice(-8), ['action:copy', 'action:cut', 'action:duplicate', 'button:Bring to front', 'button:Send to back', 'button:Delete', 'action:lock', 'count'])
	const lock = html.match(/<[a-z]+[^>]*data-knorke-action="lock"[^>]*>/)[0]
	assert.match(lock, /aria-label="Lock"/)
	assert.match(lock, /title="Lock \(Ctrl\+Shift\+L\)"/)
	const mixed = sel(['sticky'], { ids: ['a', 'b'], count: 2, locked: 1, unlocked: 1, lockable: 1, unlockable: 1, lockedBy: { kind: 'mine' }, unlockBy: { kind: 'mine' } })
	const m = strip(await render(ContextBar, { selection: mixed }))
	assert.deepEqual(order(m).slice(-5), ['button:Delete', 'action:lock', 'action:unlock', 'badge:mine', 'count'])
	assert.match(m, /data-knorke-lock-badge="mine"[^>]*>Locked by you</)
	// review round 1 (UX N2): with something lockable the key locks, so Unlock names no key
	assert.match(m.match(/<[a-z]+[^>]*data-knorke-action="unlock"[^>]*>/)[0], /title="Unlock"/)
	assert.match(m.match(/<[a-z]+[^>]*data-knorke-action="lock"[^>]*>/)[0], /title="Lock \(Ctrl\+Shift\+L\)"/)
	// an older selection v2 without the lock keys: as before (no lock row)
	const old = strip(await render(ContextBar, { selection: sel(['sticky'], { ids: ['a'] }) }))
	assert.deepEqual(order(old).slice(-2), ['button:Delete', 'count'])
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

test('job 026 (AK7): two free notes → Group items without aria-disabled; different parents → aria-disabled and the hint as title; a whole group → Ungroup only; the section after Delete, before the lock row', async () => {
	const tag = (html, name) => html.match(new RegExp(`<[a-z]+[^>]*data-knorke-action="${name}"[^>]*>`))?.[0] ?? null
	const free = sel(['sticky', 'sticky'], { ids: ['a', 'b'], locked: 0, unlocked: 2, lockable: 2, unlockable: 0, groupable: 2, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false })
	let html = strip(await render(ContextBar, { selection: free }))
	const group = tag(html, 'group')
	assert.ok(group, 'Group items')
	assert.doesNotMatch(group, /aria-disabled/)
	assert.doesNotMatch(group, /\sdisabled/, 'never disabled')
	assert.match(group, /aria-label="Group items"/)
	assert.match(group, /title="Group items \(Ctrl\+G\)"/)
	assert.equal(tag(html, 'ungroup'), null)
	assert.deepEqual(order(html).slice(-4), ['button:Delete', 'action:group', 'action:lock', 'count'])
	assert.equal((html.match(/knorke-contextbar__sep/g) ?? []).length >= 3, true, 'a separator before the group section and before the lock row')
	html = strip(await render(ContextBar, { selection: { ...free, groupable: 3, groupBlock: 'parent' } }))
	assert.match(tag(html, 'group'), /aria-disabled="true"/)
	assert.match(tag(html, 'group'), /title="Only items in the same frame, or all outside frames, can be grouped\."/)
	const whole = { ...free, grouped: 1, oneGroup: true }
	html = strip(await render(ContextBar, { selection: whole }))
	assert.equal(tag(html, 'group'), null, 'exactly one group: no Group items')
	assert.match(tag(html, 'ungroup'), /aria-label="Ungroup"/)
	assert.match(tag(html, 'ungroup'), /title="Ungroup \(Ctrl\+Shift\+G\)"/)
	html = strip(await render(ContextBar, { selection: { ...whole, ungroupBlock: 'locked' } }))
	assert.match(tag(html, 'ungroup'), /aria-disabled="true"/)
	assert.match(tag(html, 'ungroup'), /title="Locked items cannot be grouped or ungrouped\."/)
	html = strip(await render(ContextBar, { selection: sel(['sticky'], { ids: ['a'] }) }))
	assert.equal(tag(html, 'group') ?? tag(html, 'ungroup'), null, 'a selection v2 without the group keys: no section')
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
		assert.match(tag(html, 'ungroup') ?? '', /aria-label="Ungroup"/, why + ': Ungroup')
	}
	const html = await bar(['A', 'C'])
	assert.doesNotMatch(tag(html, 'group') ?? '', /aria-disabled/, 'a member plus a free note: a new group of three')
	assert.ok(tag(html, 'group'))
})
