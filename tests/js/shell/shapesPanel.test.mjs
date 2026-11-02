/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 201 (shapes panel), the shell:
 * - AK4 shapeLibs.js: entry ids unique, every registry kind in a library,
 *   every new kind in exactly one, every kind of an entry a registry kind;
 *   the search (UI language and English, every library, hidden ones too);
 *   the stored choices (broken JSON → defaults, unknown ids dropped,
 *   recently used at most 8, newest first, no doubles)
 * - AK5 contextbar.js kindChoices: the twelve flowchart kinds for a
 *   document, no section for a symbol, the six for rect and for mixed kinds;
 *   the shape tool's menu offers the six (toolOptions.test.mjs)
 * - AK7 the tool bar's "Shapes" button: aria-expanded, aria-controls,
 *   emits shapes; it lives in the tool bar, which the view shows only in
 *   edit mode (never on a view-only device)
 * - ShapesPanel.vue: rendered with every library section and tile hook;
 *   hidden libraries and folded sections come from localStorage; a pointer
 *   click arms, a keyboard click places in the middle; a drag released over
 *   the canvas places at the client point, over anything else nothing, Esc
 *   ends it, the click after a drag is dropped; every use goes first in
 *   "Recently used" and is stored
 * - (job 203 AK8) own and adopted libraries: entries, search, stored ids,
 *   pruning; an account loads route 46 on opening, the sections follow the
 *   built-in ones, an own one shows "Waiting for approval", pictures load
 *   when a section is open or an entry is used, a click arms with the
 *   picture; the Guests app and the guest page get no import and no own
 *   libraries; pictures only as <img>; the import reads the picked files
 *   into the dialog; the context bar of own shapes has no colour, border,
 *   text or kind
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setupOf, useSfc } from './sfc.mjs'
import { ENUMS } from '../../../src/model/registry.js'
import { BASIC_KINDS, FLOWCHART_KINDS } from '../../../src/model/shapes.js'
import {
	POOL_KIND, PREFS_KEY, RECENT_MAX, SHAPE_LIBS, englishLabel, entryLabel, entryOf, libKey, ownEntries, prunePrefs, readPrefs, searchEntries, usePrefs,
} from '../../../src/components/shapeLibs.js'
import * as boardsApi from '../../../src/api/boards.js'
import { contextSections, kindChoices } from '../../../src/components/contextbar.js'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ShapesPanel = (await import('../../../src/components/ShapesPanel.vue')).default

const all = SHAPE_LIBS.flatMap((lib) => lib.entries)

describe('job 201 AK4: the libraries', () => {
	test('ids unique, every registry kind in a library, the new ones in exactly one, nothing else', () => {
		// job 204: BPMN after the flowchart
		assert.deepEqual(SHAPE_LIBS.map((lib) => lib.id), ['basic', 'flowchart', 'bpmn', 'symbols'])
		assert.equal(new Set(all.map((e) => e.id)).size, all.length)
		// job 204: the pool entry is no shape
		for (const e of all) assert.ok(ENUMS.shapeKinds.includes(e.kind) || (e.id === 'bpmn.pool' && e.kind === POOL_KIND), e.id)
		for (const k of ENUMS.shapeKinds) {
			const n = all.filter((e) => e.kind === k).length
			// job 203: the own shape stands only in own and adopted libraries
			assert.equal(n, k === 'rect' || k === 'diamond' ? 2 : k === 'image' ? 0 : 1, k)
		}
		assert.deepEqual(SHAPE_LIBS[0].entries.map((e) => e.kind), [...BASIC_KINDS])
		assert.deepEqual(SHAPE_LIBS[1].entries.map((e) => e.kind), [...FLOWCHART_KINDS])
		assert.ok(SHAPE_LIBS[3].entries.every((e) => e.kind.startsWith('icon')))
		assert.equal(SHAPE_LIBS[3].entries.length, 20)
		assert.equal(englishLabel(entryOf('flowchart.inputOutput')), 'Input / output')
		assert.equal(entryOf('nope'), null)
	})

	test('search: trimmed, case-insensitive, UI language or English, every library', () => {
		// job 204: and the BPMN data, after the flowchart
		assert.deepEqual(searchEntries('  data ').map((e) => e.id), ['flowchart.database', 'bpmn.dataObject', 'bpmn.dataInput', 'bpmn.dataOutput', 'bpmn.dataStore'])
		assert.deepEqual(searchEntries(''), [])
		assert.deepEqual(searchEntries(null), [])
		const german = (e) => ({ 'flowchart.document': 'Dokument', 'symbols.person': 'Person' })[e.id] ?? englishLabel(e)
		assert.deepEqual(searchEntries('doku', german).map((e) => e.id), ['flowchart.document'])
		assert.deepEqual(searchEntries('DOCU', german).map((e) => e.id), ['flowchart.document'], 'English too')
		assert.deepEqual(searchEntries('rect').map((e) => e.id), ['basic.rect', 'basic.roundRect'])
		assert.deepEqual(searchEntries('person').map((e) => e.id), ['symbols.person'])
		assert.deepEqual(searchEntries('xyz'), [])
	})

	test('stored choices: defaults for anything unreadable, unknown ids dropped, recent ≤ 3 (job 229) newest first', () => {
		assert.equal(RECENT_MAX, 3, 'job 229: one row of the three-column grid')
		const empty = { hidden: [], folded: [], recent: [] }
		for (const raw of [null, '', '{', '[]', '"x"', '42', 'null']) assert.deepEqual(readPrefs(raw), empty, String(raw))
		assert.deepEqual(readPrefs(JSON.stringify({ hidden: ['symbols', 'x', 'symbols', 3], folded: 'basic', recent: ['symbols.star', 'nope', 'symbols.star'] })),
			{ hidden: ['symbols'], folded: [], recent: ['symbols.star'] })
		const many = all.slice(0, 12).map((e) => e.id)
		assert.equal(readPrefs(JSON.stringify({ recent: many })).recent.length, RECENT_MAX)
		// job 229: a list of eight stored before is cut to its three newest
		assert.deepEqual(readPrefs(JSON.stringify({ recent: many.slice(0, 8) })).recent, many.slice(0, 3))
		let p = empty
		for (const id of many) p = usePrefs(p, id)
		assert.deepEqual(p.recent, many.slice(-RECENT_MAX).reverse())
		p = usePrefs(p, many[8])
		assert.deepEqual(p.recent.slice(0, 2), [many[8], many[11]], 'moved to the front, not doubled')
		assert.equal(p.recent.length, RECENT_MAX)
		assert.equal(usePrefs(p, 'nope'), p)
		assert.equal(PREFS_KEY, 'knorke.shapes')
	})
})

describe('job 201 AK5: the context bar\'s section "Shape"', () => {
	const sel = (kind, extra = {}) => ({ count: 1, types: new Set(['shape']), fields: ['data.kind'], kind, mixed: [], ...extra })
	test('flowchart kinds for a flowchart shape, none for a symbol, the six otherwise', () => {
		assert.deepEqual(kindChoices(sel('document')), [...FLOWCHART_KINDS])
		assert.equal(FLOWCHART_KINDS.length, 12)
		assert.equal(kindChoices(sel('iconStar')), null)
		assert.deepEqual(kindChoices(sel('rect')), [...BASIC_KINDS])
		assert.deepEqual(kindChoices(sel('diamond')), [...BASIC_KINDS])
		assert.deepEqual(kindChoices(sel(undefined, { mixed: ['data.kind'] })), [...BASIC_KINDS])
		assert.deepEqual(kindChoices(sel('iconStar', { mixed: ['data.kind'] })), [...BASIC_KINDS])
		assert.deepEqual(contextSections(sel('database')).kind, [...FLOWCHART_KINDS])
		assert.equal(contextSections(sel('iconHeart')).kind, null)
	})
})

describe('job 201 AK7, job 229: the shape tool opens the shapes panel', () => {
	const tb = readFileSync(new URL('../../../src/components/Toolbar.vue', import.meta.url), 'utf8')
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	test('no "Shapes" button of its own; the shape tool has aria-expanded and aria-controls and emits shapes; the panel only beside the tool bar', () => {
		assert.doesNotMatch(tb, /data-knorke-action="shapes"/)
		assert.match(tb, /if \(id === 'shape'\) \{\s*return props\.shapesOpen \? 'true' : 'false'/)
		assert.match(tb, /if \(id === 'shape'\) \{\s*return props\.shapesId/)
		assert.match(tb, /if \(id === 'shape'\) \{\s*emit\('shapes', e\)/)
		assert.match(view, /<Toolbar v-if="ready && uiMode === 'edit' && !frozen"/)
		assert.match(view, /<ShapesPanel v-if="shapesOpen && ready && uiMode === 'edit' && !frozen"/)
	})
	test('the view: closed, the shape tool with the panel; open, the panel closes and select comes back (not after a tile armed the tool); the key S opens it without the focus; another tool closes it', () => {
		const fn = (name) => view.match(new RegExp('\nfunction ' + name + '\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}'))?.[1] ?? ''
		assert.match(fn('toggleShapes'), /if \(shapesOpen\.value\) \{\s*closeShapes\(\)\s*return\s*\}\s*act\(e, \(s\) => s\.setTool\('shape'\)\)\s*openShapes\(!isPointerActivation\(e\)\)/)
		assert.match(fn('closeShapes'), /if \(tool\.value === 'shape' && !shapesArmed\) \{\s*session\.value\?\.setTool\('select'\)/, 'select comes back unless a tile armed the tool')
		assert.match(fn('openShapes'), /shapesArmed = false/)
		assert.match(fn('armShape'), /^\s*shapesArmed = true/)
		assert.match(fn('closeShapes'), /querySelector\?\.\('\[data-knorke-tool="shape"\]'\)\?\.focus/)
		assert.match(fn('pickTool'), /if \(shapesOpen\.value\) \{\s*shapesOpen\.value = false/)
		assert.match(view, /if \(x === 'shape' && tool\.value !== 'shape' && !shapesOpen\.value && uiMode\.value === 'edit' && !frozen\.value\) openShapes\(false\)/)
	})
})

// ---------------------------------------------------------------- ShapesPanel.vue

/** A localStorage of the test. */
function memoryStorage() {
	const m = new Map()
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => { m.set(k, String(v)) },
		removeItem: (k) => { m.delete(k) },
		map: m,
	}
}

/** Window listeners of the test: [type, fn]. */
let listeners = []
/** What document.elementFromPoint returns. */
let under = null

beforeEach(() => {
	listeners = []
	under = null
	globalThis.localStorage = memoryStorage()
	globalThis.window = {
		addEventListener: (type, fn) => listeners.push([type, fn]),
		removeEventListener: (type, fn) => { listeners = listeners.filter((l) => !(l[0] === type && l[1] === fn)) },
	}
	globalThis.document = { elementFromPoint: () => under }
})

/**
 * @param {string} type event type
 * @param {object} e event fields
 */
function fire(type, e) {
	for (const [t, fn] of [...listeners]) {
		if (t === type) fn({ pointerId: 1, preventDefault() {}, stopPropagation() {}, ...e })
	}
}

/** A tile element of the test (pointer capture recorded). */
const tile = () => ({ captured: [], setPointerCapture(id) { this.captured.push(id) }, releasePointerCapture() {} })

/** An element inside the canvas host (closest finds .knorke-canvas), and one outside. */
const CANVAS = { closest: (sel) => (sel === '.knorke-canvas' ? {} : null) }
const PANEL = { closest: () => null }

const panel = (start = null) => setupOf(ShapesPanel, { id: 'knorke-shapes-7', autofocus: false, start })

describe('job 201: ShapesPanel.vue', () => {
	test('rendered: search, every library section with its fold button, a tile per entry, "Libraries" at the foot', async () => {
		const html = await renderToString(createSSRApp(ShapesPanel, { id: 'knorke-shapes-7' }))
		assert.match(html, /data-knorke-shapes/)
		assert.match(html, /role="dialog"/)
		assert.match(html, /data-knorke-shapes-search/)
		for (const lib of SHAPE_LIBS) {
			assert.match(html, new RegExp(`data-knorke-shape-lib="${lib.id}"`))
			assert.match(html, new RegExp(`data-knorke-shape-fold="${lib.id}"[^>]*|aria-expanded="true"[^>]*data-knorke-shape-fold="${lib.id}"`))
		}
		for (const e of all) assert.match(html, new RegExp(`data-knorke-shape="${e.id.replace('.', '\\.')}"`), e.id)
		assert.match(html, /data-knorke-action="shapes-libs"/)
		assert.doesNotMatch(html, /data-knorke-shape-lib="recent"/, 'nothing used yet')
		assert.equal((html.match(/<svg class="knorke-shapepreview/g) ?? []).length, all.length, 'one preview per tile')
		assert.equal((html.match(/<svg class="knorke-shapes__chevron"/g) ?? []).length, SHAPE_LIBS.length + 1, 'a chevron per fold button and at "Libraries"')
	})

	test('hidden and folded libraries come from localStorage; all hidden: the hint', async () => {
		globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify({ hidden: ['symbols'], folded: ['flowchart'], recent: ['symbols.star'] }))
		const html = await renderToString(createSSRApp(ShapesPanel, { id: 'p' }))
		assert.doesNotMatch(html, /data-knorke-shape-lib="symbols"/)
		assert.match(html, /data-knorke-shape-lib="recent"/)
		assert.match(html, /data-knorke-shape="symbols\.star"/, 'recently used, also from a hidden library')
		assert.match(html, /aria-expanded="false"[^>]*data-knorke-shape-fold="flowchart"/)
		assert.doesNotMatch(html, /data-knorke-shape="flowchart\.database"/, 'folded')
		globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify({ hidden: ['basic', 'flowchart', 'bpmn', 'symbols'] }))
		assert.match(await renderToString(createSSRApp(ShapesPanel, { id: 'p' })), /No library is shown\./)
	})

	test('round 2: the panel starts where the view says (beyond the tool bar); the preview is placed in the panel', () => {
		assert.deepEqual(panel(74).bindings.placeStyle.value, { insetInlineStart: '74px', width: 'min(272px, calc(100% - 82px))' })
		assert.equal(panel(null).bindings.placeStyle.value, null, 'no measure: the CSS default')
		const { bindings: b } = panel(74)
		b.rootEl.value = { getBoundingClientRect: () => ({ left: 82, top: 58 }) }
		b.onDown(entryOf('symbols.star'), { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 300, currentTarget: tile() })
		fire('pointermove', { clientX: 400, clientY: 358 })
		assert.deepEqual(b.ghost.value, { kind: 'iconStar', x: 318, y: 300 }, 'client point minus the panel corner')
		fire('pointercancel', {})
		const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
		assert.match(view, /:start="shapesStart"/)
		assert.match(view, /r\.right - b\.left\) \+ SHAPES_GAP/, 'measured from the tool bar as drawn')
		assert.match(readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8'), /\.knorke-shapes__ghost \{\n\tposition: absolute;/)
		// round 3: below the top stack, so the context bar of a shape beside the panel lies over it
		const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
		const z = (sel) => Number(css.match(new RegExp('\n' + sel.replace('.', '\\.') + ' \\{[^}]*?z-index: (\\d+);'))?.[1])
		assert.ok(z('.knorke-shapes') < z('.knorke-topstack'), 'panel ' + z('.knorke-shapes') + ' under the top stack ' + z('.knorke-topstack'))
		// job 229: narrow, the panel starts below one docked row (like the tool bar) and lies over the top stack,
		// so a docked context bar never covers its head and ×
		const narrow = css.match(/\n\.knorke-board--narrow \.knorke-shapes \{([^}]*)\}/)?.[1] ?? ''
		assert.match(narrow, /top: calc\(var\(--knorke-gap\) \* 3 \+ 2 \* var\(--knorke-bar-h\)\);/)
		assert.ok(Number(narrow.match(/z-index: (\d+);/)?.[1]) > z('.knorke-topstack'), 'narrow: over the top stack')
		// round 1 (fresh review): the tool bar's popovers stay over the narrow panel
		const pop = css.match(/\n\.knorke-board--narrow \.knorke-toolpop \{([^}]*)\}/)?.[1] ?? ''
		assert.ok(Number(pop.match(/z-index: (\d+);/)?.[1]) > Number(narrow.match(/z-index: (\d+);/)?.[1]), 'narrow: the popovers over the panel')
		assert.ok(z('.knorke-toolpop') > z('.knorke-shapes'), 'wide: the popovers over the panel')
		assert.match(css, /\n\.knorke-board--narrow \.knorke-toolbar \{\s*--knorke-tools-top: calc\(var\(--knorke-gap\) \* 3 \+ 2 \* var\(--knorke-bar-h\)\);/, 'the same top as the tool bar')
		// round 5: no <footer> in the template, the guest page pins every footer to the window's bottom (#body-public footer)
		const sfc = readFileSync(new URL('../../../src/components/ShapesPanel.vue', import.meta.url), 'utf8')
		assert.doesNotMatch(sfc.slice(0, sfc.indexOf('<script')), /<footer[\s>]/)
		// job 229: the foot (it never scrolls) holds only "Import shapes…", and only with the right to import;
		// "Libraries" is the list's last foldable section
		const tpl = sfc.slice(0, sfc.indexOf('<script'))
		const foot = tpl.slice(tpl.indexOf('<div v-if="canImport" class="knorke-shapes__foot">'))
		assert.ok(foot.length < tpl.length, 'the foot only with the right')
		assert.match(foot, /data-knorke-action="shapes-import"/)
		assert.doesNotMatch(foot, /shapes-libs/)
		const body = tpl.slice(tpl.indexOf('<div class="knorke-shapes__body">'), tpl.indexOf('<div v-if="canImport" class="knorke-shapes__foot">'))
		assert.match(body, /data-knorke-action="shapes-libs"/)
	})

	test('a pointer click arms the shape tool, a keyboard click places in the middle; both go first in "Recently used" and are stored', () => {
		const { bindings: b, emitted } = panel()
		b.onClick(entryOf('flowchart.database'), { pointerType: 'mouse', detail: 1 })
		b.onClick(entryOf('symbols.person'), { pointerType: '', detail: 0 })
		assert.deepEqual(emitted, [['arm', 'database'], ['place', 'iconPerson', null]])
		assert.deepEqual(b.recent.value.map((e) => e.id), ['symbols.person', 'flowchart.database'])
		assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(PREFS_KEY)).recent, ['symbols.person', 'flowchart.database'])
	})

	test('fold and the library check boxes are stored', () => {
		const { bindings: b } = panel()
		b.toggleFold('basic')
		b.setShown('symbols', false)
		assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(PREFS_KEY)), { hidden: ['symbols'], folded: ['basic'], recent: [] })
		assert.deepEqual(b.shownLibs.value.map((l) => l.key), ['basic', 'flowchart', 'bpmn'])
		b.toggleFold('basic')
		b.setShown('symbols', true)
		assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(PREFS_KEY)), { hidden: [], folded: [], recent: [] })
	})

	test('a drag released over the canvas places at the client point; the preview follows; the click after it is dropped', () => {
		const { bindings: b, emitted } = panel()
		const el = tile()
		b.onDown(entryOf('flowchart.document'), { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 300, currentTarget: el })
		fire('pointermove', { clientX: 53, clientY: 301 })
		assert.equal(b.ghost.value, null, 'below 6 px no drag')
		fire('pointermove', { clientX: 300, clientY: 320 })
		assert.deepEqual(b.ghost.value, { kind: 'document', x: 300, y: 320 })
		assert.deepEqual(el.captured, [1])
		under = CANVAS
		fire('pointerup', { clientX: 500, clientY: 400 })
		assert.deepEqual(emitted, [['place', 'document', { x: 500, y: 400 }]])
		assert.equal(b.ghost.value, null)
		assert.equal(listeners.length, 0, 'listeners gone')
		b.onClick(entryOf('flowchart.document'), { pointerType: 'mouse', detail: 1 })
		assert.equal(emitted.length, 1, 'the click of the drag is dropped')
		assert.deepEqual(b.recent.value.map((e) => e.id), ['flowchart.document'])
	})

	test('released over the panel or a bar: nothing; Esc and pointercancel end a drag; a short press leaves the click to arm', () => {
		const { bindings: b, emitted } = panel()
		const down = (id) => b.onDown(entryOf(id), { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0, currentTarget: tile() })
		down('symbols.star')
		fire('pointermove', { clientX: 40, clientY: 0 })
		under = PANEL
		fire('pointerup', { clientX: 40, clientY: 0 })
		down('symbols.star')
		fire('pointermove', { clientX: 40, clientY: 0 })
		fire('keydown', { key: 'Escape' })
		assert.equal(b.ghost.value, null)
		under = CANVAS
		fire('pointerup', { clientX: 400, clientY: 0 })
		down('symbols.star')
		fire('pointermove', { clientX: 40, clientY: 0 })
		fire('pointercancel', {})
		fire('pointerup', { clientX: 400, clientY: 0 })
		assert.deepEqual(emitted, [], 'nothing placed')
		// a press without way: the click after it arms
		down('symbols.star')
		fire('pointerup', { clientX: 1, clientY: 1 })
		// (the pointercancel just now ended a drag: the one click that follows it is dropped; the next one arms)
		b.onClick(entryOf('symbols.star'), { pointerType: 'mouse', detail: 1 })
		assert.deepEqual(emitted, [])
		b.onClick(entryOf('symbols.star'), { pointerType: 'mouse', detail: 1 })
		assert.deepEqual(emitted.at(-1), ['arm', 'iconStar'])
		// a secondary button never starts a drag
		b.onDown(entryOf('symbols.star'), { button: 2, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0, currentTarget: tile() })
		assert.equal(listeners.length, 0)
	})
})

// ---------------------------------------------------------------- job 203: own shape libraries

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ADOPTED = { id: 111111111111111, name: 'AWS', names: ['EC2', 'Lambda'] }
const OWN = { id: 222222222222222, name: 'Meine', names: ['Server'], pending: true }

/**
 * Route 46 and 48 of the test through api/boards.js deps.
 *
 * @param {object} list the answer of route 46
 * @return {string[]} the requests made ("GET /api/v1/shapelibs" …)
 */
function libsApi(list) {
	const seen = []
	boardsApi.deps.urlOf = (p) => p
	boardsApi.deps.request = async (method, url) => {
		seen.push(method + ' ' + url)
		if (url === '/api/v1/shapelibs') return list
		if (url.startsWith('/api/v1/shapelibs/')) return { entries: [{ name: 'x', img: PNG, w: 20, h: 10 }, { name: 'y', img: PNG, w: 10, h: 10 }] }
		return {}
	}
	return seen
}

describe('job 204: the pool entry in the panel', () => {
	test('its tile shows the pool preview; a pointer click arms it, the keyboard places it, a drag drops it at the client point', async () => {
		const html = await renderToString(createSSRApp(ShapesPanel, { id: 'knorke-shapes-7' }))
		const at = html.indexOf('data-knorke-shape="bpmn.pool"')
		assert.ok(at > 0)
		assert.ok(html.slice(at, at + 600).includes('d="M2 5H22V19H2ZM6 5V19M6 9.67H22M6 14.33H22"'), 'POOL_PREVIEW')
		assert.match(html, /data-knorke-shape="bpmn\.userTask"[\s\S]*?knorke-shapepreview__mark/, 'a task shows its badge')
		const { bindings: b, emitted } = panel()
		b.onClick(entryOf('bpmn.pool'), { pointerType: 'pen', detail: 1 })
		b.onClick(entryOf('bpmn.pool'), { pointerType: '', detail: 0 })
		b.onDown(entryOf('bpmn.pool'), { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 300, currentTarget: tile() })
		fire('pointermove', { clientX: 300, clientY: 320 })
		assert.deepEqual(b.ghost.value, { kind: POOL_KIND, x: 300, y: 320 })
		under = CANVAS
		fire('pointerup', { clientX: 500, clientY: 400 })
		assert.deepEqual(emitted, [['arm', POOL_KIND], ['place', POOL_KIND, null], ['place', POOL_KIND, { x: 500, y: 400 }]])
		assert.deepEqual(b.recent.value.map((e) => e.id), ['bpmn.pool'])
	})
})

describe('job 203 AK8: own and adopted libraries in the panel', () => {
	test('shapeLibs.js: entries of a library, the search over their names, stored ids by form, pruned when gone', () => {
		assert.deepEqual(ownEntries(ADOPTED), [
			{ id: 'lib:111111111111111.0', kind: 'image', lib: ADOPTED.id, index: 0, name: 'EC2' },
			{ id: 'lib:111111111111111.1', kind: 'image', lib: ADOPTED.id, index: 1, name: 'Lambda' },
		])
		assert.equal(entryOf('lib:111111111111111.1', [ADOPTED]).name, 'Lambda')
		assert.equal(entryOf('lib:111111111111111.2', [ADOPTED]), null)
		assert.equal(entryLabel(entryOf('lib:111111111111111.0', [ADOPTED])), 'EC2')
		// job 204: the built-in ones first (Service task)
		assert.deepEqual(searchEntries('serv', undefined, [ADOPTED, OWN]).map((e) => e.id), ['bpmn.serviceTask', 'lib:222222222222222.0'])
		const p = readPrefs(JSON.stringify({ hidden: ['lib:111111111111111', 'lib:12'], folded: [], recent: ['lib:222222222222222.0', 'lib:1.0', 'symbols.star'] }))
		assert.deepEqual(p, { hidden: ['lib:111111111111111'], folded: [], recent: ['lib:222222222222222.0', 'symbols.star'] })
		assert.deepEqual(usePrefs(p, 'lib:111111111111111.1').recent[0], 'lib:111111111111111.1')
		assert.deepEqual(prunePrefs(p, [OWN]), { hidden: [], folded: [], recent: ['lib:222222222222222.0', 'symbols.star'] })
		const same = prunePrefs(p, [ADOPTED, OWN])
		assert.equal(same, p, 'nothing gone: the same object')
		assert.equal(libKey(5), 'lib:5')
	})

	test('an account: route 46 on opening; sections built-in, adopted, own (waiting for approval); pictures load when shown; a click arms with the picture', async () => {
		const seen = libsApi({ right: 'suggest', adopted: [ADOPTED], own: [OWN] })
		globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify({ hidden: [], folded: ['lib:111111111111111'], recent: [] }))
		const { bindings: b, emitted } = setupOf(ShapesPanel, { id: 'p', autofocus: false, start: null, account: true })
		await b.refresh()
		assert.deepEqual(b.sections.value.map((s) => [s.key, s.own, s.pending, s.folded]), [
			['basic', false, false, false], ['flowchart', false, false, false], ['bpmn', false, false, false], ['symbols', false, false, false],
			['lib:111111111111111', false, false, true], ['lib:222222222222222', true, true, false],
		])
		assert.equal(b.canImport.value, true)
		assert.deepEqual(b.libChoices.value.map((l) => l.key), ['basic', 'flowchart', 'bpmn', 'symbols', 'lib:111111111111111', 'lib:222222222222222'])
		await new Promise((r) => setTimeout(r, 0))
		assert.deepEqual(seen, ['GET /api/v1/shapelibs', 'GET /api/v1/shapelibs/222222222222222'], 'only the open section loads its pictures')
		assert.deepEqual(b.pictures.value.get('lib:222222222222222.0'), { name: 'x', uri: PNG, w: 20, h: 10 })
		b.onClick(entryOf('lib:222222222222222.0', [OWN]), { pointerType: 'mouse', detail: 1 })
		await new Promise((r) => setTimeout(r, 0))
		assert.deepEqual(emitted, [['arm', 'image', { name: 'x', uri: PNG, w: 20, h: 10 }]])
		b.onClick(entryOf('lib:111111111111111.1', [ADOPTED]), { pointerType: '', detail: 0 })
		await new Promise((r) => setTimeout(r, 0))
		assert.deepEqual(emitted.at(-1), ['place', 'image', null, { name: 'y', uri: PNG, w: 10, h: 10 }], 'a folded library loads when used')
		assert.deepEqual(b.recent.value.map((e) => e.id), ['lib:111111111111111.1', 'lib:222222222222222.0'])
	})

	test('round 2: an own tile dragged onto the canvas places its picture at the client point; the preview shows the picture', async () => {
		libsApi({ right: 'suggest', adopted: [], own: [OWN] })
		const { bindings: b, emitted } = setupOf(ShapesPanel, { id: 'p', autofocus: false, start: null, account: true })
		await b.refresh()
		await new Promise((r) => setTimeout(r, 0))
		const e = entryOf('lib:222222222222222.0', [OWN])
		b.onDown(e, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 300, currentTarget: tile() })
		fire('pointermove', { clientX: 300, clientY: 320 })
		assert.deepEqual(b.ghost.value, { kind: 'image', uri: PNG, x: 300, y: 320 })
		under = CANVAS
		fire('pointerup', { clientX: 500, clientY: 400 })
		await new Promise((r) => setTimeout(r, 0))
		assert.deepEqual(emitted, [['place', 'image', { x: 500, y: 400 }, { name: 'x', uri: PNG, w: 20, h: 10 }]])
		assert.equal(b.ghost.value, null)
	})

	test('libraries that are gone leave the stored choices; the Guests app and the guest page: no import, no own libraries', async () => {
		globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify({ hidden: ['lib:333333333333333'], folded: [], recent: ['lib:333333333333333.0'] }))
		libsApi({ right: 'suggest', adopted: [], own: [] })
		const { bindings: b } = setupOf(ShapesPanel, { id: 'p', autofocus: false, start: null, account: true })
		await b.refresh()
		assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(PREFS_KEY)), { hidden: [], folded: [], recent: [] })
		const seen = libsApi({ right: null, adopted: [], own: [] })
		const g = setupOf(ShapesPanel, { id: 'p', autofocus: false, start: null, account: true }).bindings
		await g.refresh()
		assert.equal(g.canImport.value, false, 'Guests app')
		const guest = setupOf(ShapesPanel, { id: 'p', autofocus: false, start: null, account: false }).bindings
		await guest.refresh()
		assert.equal(guest.canImport.value, false)
		assert.deepEqual(guest.sections.value.map((s) => s.key), ['basic', 'flowchart', 'bpmn', 'symbols'])
		assert.deepEqual(seen, ['GET /api/v1/shapelibs'], 'the guest page asks nothing')
		const html = await renderToString(createSSRApp(ShapesPanel, { id: 'p' }))
		assert.doesNotMatch(html, /data-knorke-action="shapes-import"/)
		const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
		assert.match(view, /:account="mode === 'user'"/, 'only signed-in accounts (never the guest page)')
	})

	test('pictures are <img> only; names text only; the import reads the files into the dialog', async () => {
		for (const f of ['components/ShapesPanel.vue', 'components/ShapeLibDialog.vue', 'admin/ShapeLibAdmin.vue']) {
			assert.doesNotMatch(readFileSync(new URL('../../../src/' + f, import.meta.url), 'utf8'), /v-html|innerHTML/, f)
		}
		const sfc = readFileSync(new URL('../../../src/components/ShapesPanel.vue', import.meta.url), 'utf8')
		assert.match(sfc, /<img v-if="e\.kind === 'image' && pictures\.get\(e\.id\)"\s+class="knorke-shapes__pic"\s+:src="pictures\.get\(e\.id\)\.uri"\s+alt=""\s+draggable="false"/)
		// round 2: the browser's own image drag never takes the gesture (tile and preview)
		assert.match(sfc, /@pointerdown="\(ev\) => onDown\(e, ev\)"\s+@dragstart\.prevent/)
		assert.match(sfc, /<img v-if="ghost\.uri"\s+class="knorke-shapes__pic"\s+:src="ghost\.uri"\s+alt=""\s+draggable="false"/)
		assert.match(readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8'), /\.knorke-shapes__pic \{[^}]*-webkit-user-drag: none;/)
		assert.match(sfc, /accept="\.svg,\.xml,image\/svg\+xml,application\/xml,text\/xml"\s+multiple/)
		// round 1: a long name ends in an ellipsis before "Waiting for approval" and the menu, whole in the title
		assert.match(sfc, /:title="sec\.lib \? sec\.caption : null"[\s\S]*?<span class="knorke-shapes__name">\{\{ sec\.caption \}\}<\/span>/)
		const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
		assert.match(css, /\.knorke-shapes__name \{\n\tmin-width: 0;\n\toverflow: hidden;\n\ttext-overflow: ellipsis;\n\twhite-space: nowrap;\n\}/)
		assert.match(css, /\.knorke-shapes__chip \{\n\tflex: none;/)
		libsApi({ right: 'suggest', adopted: [], own: [] })
		const { bindings: b } = setupOf(ShapesPanel, { id: 'p', autofocus: false, start: null, account: true })
		const file = (name, text) => ({ name, size: text.length, text: async () => text })
		const input = { files: [file('a.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"/>'), file('b.txt', 'nope')], value: 'C:\\a.svg' }
		await b.onFiles({ target: input })
		assert.equal(input.value, '', 'the same files can be picked again')
		assert.equal(b.dialog.value.mode, 'import')
		assert.deepEqual([b.dialog.value.draft.name, b.dialog.value.draft.entries.length, b.dialog.value.draft.skipped], ['My shapes', 1, 1])
	})
})

describe('job 203 AK8: the context bar of own shapes', () => {
	test('only own shapes: no colour, border, text alignment or kind (job 235: the text colour of the label); mixed with others the shape sections stay', () => {
		const sel = (kind, mixed = []) => ({ count: 1, types: new Set(['shape']), fields: ['data.kind', 'style.fill', 'style.stroke', 'style.strokeWidth', 'style.textColor', 'style.align', 'data.img'], kind, mixed })
		const own = contextSections(sel('image'))
		assert.deepEqual([own.fill, own.stroke, own.strokeWidth, own.align, own.kind], [null, null, false, null, null])
		assert.deepEqual([own.textColor?.path, own.styled], ['style.textColor', true])
		const mixed = contextSections(sel(undefined, ['data.kind']))
		assert.ok(mixed.fill && mixed.kind)
	})
})
