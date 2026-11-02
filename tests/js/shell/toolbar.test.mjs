/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 229 (redesign of the tool bar, docs/redesign/ P1, P5, P5b):
 * - AK1: components/toolbar.js – the eight buttons in two groups and the
 *   three tools behind "More tools" hold every tool of model/tools.js TOOLS
 *   exactly once; the variants are those of note, connector and frame (their
 *   TOOLS options); toolIcon shows the picked variant; the long press.
 * - AK2: ToolVariants.vue takes its values from the frozen lists (never a
 *   copy; carried over from the tests of ToolOptions.vue, SPEC-M1 §20 R9,
 *   jobs 173, 188, 199); Toolbar.vue: the first click chooses the tool, a
 *   second click, a right-click or a long press opens the variants (the
 *   click a long press leaves is dropped), a tile sets the option (the
 *   connector's popover stays open), "More tools" picks table, mind map or
 *   laser pointer; the shape tool emits shapes; no "Shapes" button, no
 *   options menu with an arrow.
 * Factory job 239: the first click on a tool with variants chooses it (with
 * the click) and opens them, a click while they are open closes them (the
 * tool stays); the keys open nothing (AK1–AK3, AK5).
 */
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ENUMS } from '../../../src/model/registry.js'
import { FRAME_TOOL_KINDS, NOTE_TOOL_TYPES, TOOLS } from '../../../src/model/tools.js'
import { icons, OPTION_ICONS } from '../../../src/components/icons.js'
import { ALL_TOOL_IDS, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, MORE_TOOLS, TOOL_GROUPS, TOOL_ICONS, VARIANTS, hasVariants, isMoreTool, toolIcon } from '../../../src/components/toolbar.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { nextTick, reactive } = await import('vue')
const Toolbar = (await import('../../../src/components/Toolbar.vue')).default

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
const bar = read('src/components/Toolbar.vue')
const variants = read('src/components/ToolVariants.vue')
const script = variants.match(/<script setup>([\s\S]*)<\/script>/)?.[1] ?? ''

// ---- AK1 -------------------------------------------------------------------------

test('job 229 AK1: two groups – select, pan | note, shape, text, (job 273) pen, connector, frame, more tools; table, mind map and laser behind "More tools"; every tool once', () => {
	assert.deepEqual(TOOL_GROUPS.map((g) => [...g]), [['select', 'hand'], ['sticky', 'shape', 'text', 'pen', 'connector', 'frame', 'more']])
	assert.deepEqual([...MORE_TOOLS], ['table', 'mindmap', 'laser'])
	const shown = [...TOOL_GROUPS.flat().filter((x) => x !== 'more'), ...MORE_TOOLS]
	assert.deepEqual([...shown].sort(), [...ALL_TOOL_IDS].sort(), 'every tool of TOOLS once')
	assert.equal(new Set(shown).size, shown.length)
	assert.equal(TOOL_GROUPS.flat().length, 9, 'nine buttons (job 273: the pen)')
	assert.ok(Object.isFrozen(TOOL_GROUPS) && TOOL_GROUPS.every((g) => Object.isFrozen(g)) && Object.isFrozen(MORE_TOOLS))
	for (const id of MORE_TOOLS) assert.ok(isMoreTool(id), id)
	assert.ok(!isMoreTool('sticky'))
})

test('job 229 AK1: the variants are note (type), connector (route, end tip), frame (frameKind) and (job 273) pen (penKind), the options TOOLS gives them; the shape tool has none', () => {
	assert.deepEqual(Object.keys(VARIANTS), ['sticky', 'connector', 'frame', 'pen'])
	for (const [id, opts] of Object.entries(VARIANTS)) {
		assert.deepEqual([...opts], [...TOOLS.find((x) => x.id === id).options], id)
	}
	for (const id of ['select', 'hand', 'shape', 'text', 'table', 'mindmap', 'laser', 'more']) assert.ok(!hasVariants(id), id)
	for (const id of ['sticky', 'connector', 'frame', 'pen']) assert.ok(hasVariants(id), id)
})

test('job 229 AK1: toolIcon shows the picked variant (note pad, swimlanes, elbow and curved routes), else the tool\'s icon', () => {
	assert.equal(toolIcon('sticky', {}), icons.sticky)
	assert.equal(toolIcon('sticky', { sticky: { type: 'sticky' } }), icons.sticky)
	assert.equal(toolIcon('sticky', { sticky: { type: 'pad' } }), OPTION_ICONS.type.pad)
	assert.equal(toolIcon('frame', { frame: { frameKind: 'lanes' } }), OPTION_ICONS.frameKind.lanes)
	assert.equal(toolIcon('frame', { frame: { frameKind: 'frame' } }), icons.frame)
	assert.equal(toolIcon('connector', { connector: { route: 'elbow' } }), OPTION_ICONS.route.elbow)
	assert.equal(toolIcon('connector', { connector: { route: 'curved' } }), OPTION_ICONS.route.curved)
	assert.equal(toolIcon('connector', { connector: { route: 'straight' } }), icons.connector)
	assert.equal(toolIcon('more'), icons.moreTools)
	assert.equal(toolIcon('text', null), icons.text)
	// job 273: the highlighter and the eraser show their picture, the pen the tool's
	assert.equal(toolIcon('pen', { pen: { penKind: 'pen' } }), icons.pen)
	assert.equal(toolIcon('pen', { pen: { penKind: 'marker' } }), OPTION_ICONS.penKind.marker)
	assert.equal(toolIcon('pen', { pen: { penKind: 'eraser' } }), OPTION_ICONS.penKind.eraser)
	for (const id of [...ALL_TOOL_IDS, 'more']) assert.equal(typeof TOOL_ICONS[id], 'string', id)
})

test('job 229 AK1: a long press is 500 ms within 8 px', () => {
	assert.equal(LONG_PRESS_MS, 500)
	assert.equal(LONG_PRESS_SLOP_PX, 8)
})

// ---- AK2: the components ---------------------------------------------------------

test('job 229 AK2: ToolVariants takes the values of the frozen lists, never a copy; a caption only with two groups; each tile its picture, name and aria-pressed', () => {
	const table = script.match(/const OPTION_VALUES = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1]
	assert.ok(table, 'OPTION_VALUES table present')
	assert.match(table, /\broute:\s*ENUMS\.routes\b/)
	assert.match(table, /\bendCap:\s*ENUMS\.caps\b/)
	assert.match(table, /\btype:\s*NOTE_TOOL_TYPES\b/)
	assert.match(table, /\bframeKind:\s*FRAME_TOOL_KINDS\b/)
	for (const v of [...ENUMS.routes, ...ENUMS.caps, ...NOTE_TOOL_TYPES, ...FRAME_TOOL_KINDS]) {
		assert.ok(!new RegExp(`['"\`]${v}['"\`]`).test(variants), `no literal '${v}' in ToolVariants.vue`)
	}
	for (const opts of Object.values(VARIANTS)) for (const o of opts) assert.match(table, new RegExp(`\\b${o}:`), o)
	assert.match(variants, /<p v-if="groups\.length > 1" class="knorke-toolpop__caption"/)
	assert.match(variants, /:aria-pressed="current\(g\.option\) === e\.value \? 'true' : 'false'"\s+:data-knorke-tool-option="e\.value"/)
	assert.match(script, /case 'type': return noteTypeLabel\(value\)/)
	assert.match(script, /case 'frameKind': return frameKindLabel\(value\)/)
})

test('job 229 AK2: the tool bar has no "Shapes" button, no options menu with an arrow, no undo/redo; the popovers are siblings of the bar', () => {
	assert.doesNotMatch(bar, /data-knorke-action="shapes"|data-knorke-tool-options|NcActions|chevronDown|'undo'|'redo'/)
	assert.match(bar, /<\/nav>\s*<ToolVariants v-if="pop && pop\.kind === 'variants'"/)
	assert.match(bar, /<section v-else-if="pop && pop\.kind === 'more'"[\s\S]*?data-knorke-more-tools/)
	assert.match(bar, /:data-knorke-tool-picked="id === 'more' && picked \? picked : null"/)
	assert.doesNotMatch(read('src/views/BoardView.vue'), /ToolOptions\.vue|FrameList/)
})

/** The window of the test: listeners only. */
let listeners = []

beforeEach(() => {
	listeners = []
	globalThis.window = {
		addEventListener: (type, fn) => listeners.push([type, fn]),
		removeEventListener: (type, fn) => { listeners = listeners.filter((l) => !(l[0] === type && l[1] === fn)) },
	}
	mock.timers.enable({ apis: ['setTimeout', 'Date'] })
})

afterEach(() => {
	mock.timers.reset()
	delete globalThis.window
})

/**
 * @param {string} type event type
 * @param {object} e event fields
 */
function fire(type, e) {
	for (const [t, fn] of [...listeners]) {
		if (t === type) fn({ pointerId: 1, ...e })
	}
}

/**
 * @param {object} [props] props of Toolbar
 * @return {{b: object, emitted: Array, props: object}} its bindings, its emits and its (reactive) props
 */
function toolbar(props = {}) {
	const p = reactive({ active: 'select', options: {}, apple: false, shapesOpen: false, shapesId: 'knorke-shapes', ...props })
	const { bindings, emitted } = setupOf(Toolbar, p)
	return { b: bindings, emitted, props: p }
}

const CLICK = Object.freeze({ type: 'click', detail: 1, pointerType: 'mouse' })
const KEY = Object.freeze({ type: 'click', detail: 0, pointerType: '' })
const down = (x = 0, y = 0) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y })

test('job 239 AK1: the first click on note, connector or frame chooses it (with the click) and opens its variants', async () => {
	for (const id of ['sticky', 'connector', 'frame']) {
		const { b, emitted } = toolbar()
		b.onClick(id, CLICK)
		assert.deepEqual(emitted, [['tool', id, CLICK]], id)
		assert.deepEqual(b.pop.value, { kind: 'variants', tool: id }, id)
		assert.equal(b.expandedOf(id), 'true', id)
		assert.equal(b.controlsOf(id), b.popId, id)
		assert.equal(b.popupOf(id), 'dialog', id)
	}
	await nextTick()
})

test('job 239 AK2 (round 2): a second click closes the variants and the tool stays (no tool emit, only refocus with the click), a third opens them again; a click on a tool chosen by its key opens them', async () => {
	const { b, emitted, props } = toolbar()
	b.onClick('sticky', CLICK)
	props.active = 'sticky'
	await nextTick()
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'sticky' }, 'the tool becoming active keeps its own variants open')
	b.onClick('sticky', CLICK)
	assert.equal(b.pop.value, null)
	assert.equal(b.expandedOf('sticky'), 'false')
	assert.deepEqual(emitted, [['tool', 'sticky', CLICK], ['refocus', CLICK]], 'the tool stays; the view gives the canvas the focus')
	b.onClick('sticky', CLICK)
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'sticky' })
	assert.deepEqual(emitted.slice(2), [['refocus', CLICK]], 'no second tool emit')
	// the key L chose the connector: its button's click opens its variants, refocus only
	const t2 = toolbar({ active: 'connector' })
	t2.b.onClick('connector', CLICK)
	assert.deepEqual(t2.b.pop.value, { kind: 'variants', tool: 'connector' })
	assert.deepEqual(t2.emitted, [['refocus', CLICK]])
	// from the keyboard the same, with the key's click (the view leaves the focus then)
	t2.b.onClick('connector', KEY)
	assert.equal(t2.b.pop.value, null)
	assert.deepEqual(t2.emitted.at(-1), ['refocus', KEY])
	// a tool without variants only chooses
	props.active = 'text'
	await nextTick()
	b.onClick('text', CLICK)
	b.onClick('text', CLICK)
	assert.equal(b.pop.value, null, 'text has no variants')
	assert.equal(b.popupOf('text'), null)
	assert.deepEqual(emitted.slice(3), [['tool', 'text', CLICK], ['tool', 'text', CLICK]])
})

test('job 239 round 2: the view answers refocus with refocusAfter – a pointer click gives the canvas the focus, a key\'s click does not', async () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /@refocus="\(e\) => refocusAfter\(e, session\)"/)
	const { refocusAfter } = await import('../../../src/components/focus.js')
	let focused = 0
	const session = { focusCanvas: () => { focused++ } }
	assert.equal(refocusAfter(CLICK, session), true)
	assert.equal(refocusAfter({ type: 'click', detail: 1, pointerType: 'touch' }, session), true)
	assert.equal(refocusAfter(KEY, session, 0), false)
	assert.equal(focused, 2)
})

test('job 239 AK3: the keys N, L and F choose a tool without its variants; open ones stay with their own tool and close with another', async () => {
	const { b, props } = toolbar()
	for (const id of ['sticky', 'connector', 'frame']) {
		props.active = id
		await nextTick()
		assert.equal(b.pop.value, null, id)
	}
	props.active = 'sticky'
	await nextTick()
	b.onClick('sticky', CLICK)
	props.active = 'sticky'
	await nextTick()
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'sticky' }, 'N again keeps them')
	props.active = 'connector'
	await nextTick()
	assert.equal(b.pop.value, null, 'L closes the note\'s variants')
})

test('job 239 AK5: from the keyboard the button opens the variants too; another button moves or closes them', async () => {
	const { b, emitted, props } = toolbar()
	b.onClick('frame', KEY)
	assert.deepEqual(emitted, [['tool', 'frame', KEY]])
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'frame' })
	props.active = 'frame'
	await nextTick()
	// the connector while the frame's variants are open: the frame's go, the connector's open
	b.onClick('connector', CLICK)
	assert.deepEqual(emitted.at(-1), ['tool', 'connector', CLICK])
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'connector' })
	props.active = 'connector'
	await nextTick()
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'connector' })
	// "More tools" replaces them, a note click replaces the grid
	b.onClick('more', CLICK)
	assert.deepEqual(b.pop.value, { kind: 'more', tool: 'more' })
	b.onClick('sticky', CLICK)
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'sticky' })
	props.active = 'sticky'
	await nextTick()
	// text and select close them and open nothing
	b.onClick('text', CLICK)
	assert.equal(b.pop.value, null)
	b.onClick('sticky', CLICK)
	b.onClick('select', CLICK)
	assert.equal(b.pop.value, null)
	assert.deepEqual(emitted.at(-1), ['tool', 'select', CLICK])
	await nextTick()
})

test('job 239 round 1: Esc closes the variants; the focus goes back to the button only from inside them, after a pointer click the canvas keeps it', async () => {
	const canvas = { name: 'canvas' }
	const tile = { name: 'tile' }
	const button = { name: 'button', focus() { globalThis.document.activeElement = button } }
	globalThis.document = { activeElement: canvas, addEventListener() {}, removeEventListener() {} }
	try {
		const { b } = toolbar()
		b.navEl.value = { querySelector: (sel) => (sel === '[data-knorke-tool="sticky"]' ? button : null) }
		b.onClick('sticky', CLICK)
		b.popEl.value = { contains: (x) => x === tile }
		const esc = () => {
			let stopped = 0
			b.onDocKey({ key: 'Escape', stopPropagation: () => { stopped++ }, preventDefault() {} })
			return stopped
		}
		// a pointer click: the canvas has the focus and keeps it
		assert.equal(esc(), 1, 'Esc does not reach the canvas')
		assert.equal(b.pop.value, null)
		assert.equal(globalThis.document.activeElement, canvas)
		// from the keyboard the focus stood on a tile: back to the button
		b.onClick('sticky', KEY)
		b.popEl.value = { contains: (x) => x === tile }
		globalThis.document.activeElement = tile
		esc()
		assert.equal(b.pop.value, null)
		assert.equal(globalThis.document.activeElement, button)
		await nextTick()
	} finally {
		delete globalThis.document
	}
})

test('job 229 AK2 (risk: a finger on the Galaxy Tab): a press held 500 ms chooses the tool and opens the variants; the click after it is dropped; a press that moves or ends early is a click', async () => {
	const { b, emitted } = toolbar()
	b.onDown('frame', down(10, 10))
	mock.timers.tick(LONG_PRESS_MS - 1)
	assert.equal(b.pop.value, null)
	mock.timers.tick(1)
	assert.deepEqual(emitted, [['tool', 'frame', null]])
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'frame' })
	// Android sends contextmenu as well: it opens nothing twice
	b.onContext('frame', { preventDefault() {}, pointerType: 'touch' })
	fire('pointerup', {})
	b.onClick('frame', CLICK)
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'frame' }, 'the click of the long press does not close it')
	assert.equal(emitted.length, 1)
	b.onClick('frame', CLICK)
	assert.equal(b.pop.value, null, 'the next click is a click again')
	// moved beyond 8 px: no long press
	const t2 = toolbar()
	t2.b.onDown('sticky', down(0, 0))
	fire('pointermove', { clientX: 9, clientY: 0 })
	mock.timers.tick(LONG_PRESS_MS)
	assert.equal(t2.b.pop.value, null)
	assert.deepEqual(t2.emitted, [])
	// released early: the click chooses the tool and (job 239) opens its variants
	const t3 = toolbar()
	t3.b.onDown('sticky', down(0, 0))
	fire('pointerup', {})
	mock.timers.tick(LONG_PRESS_MS)
	t3.b.onClick('sticky', CLICK)
	assert.deepEqual(t3.emitted, [['tool', 'sticky', CLICK]])
	assert.deepEqual(t3.b.pop.value, { kind: 'variants', tool: 'sticky' })
	// a tool without variants never waits for a long press
	const t4 = toolbar()
	t4.b.onDown('text', down(0, 0))
	assert.equal(listeners.length, 0)
	await nextTick()
})

test('job 229 AK2: a right-click opens the variants (never the browser menu), a mouse leaves no click behind; Android\'s long press (touch contextmenu) drops the click after it', async () => {
	const { b, emitted } = toolbar()
	let prevented = 0
	b.onContext('connector', { preventDefault: () => { prevented++ }, pointerType: 'mouse' })
	assert.equal(prevented, 1)
	assert.deepEqual(emitted, [['tool', 'connector', null]])
	assert.deepEqual(b.pop.value, { kind: 'variants', tool: 'connector' })
	b.closePop()
	const t2 = toolbar({ active: 'sticky' })
	t2.b.onContext('sticky', { preventDefault() {}, pointerType: 'touch' })
	assert.deepEqual(t2.emitted, [], 'already the active tool')
	t2.b.onClick('sticky', CLICK)
	assert.deepEqual(t2.b.pop.value, { kind: 'variants', tool: 'sticky' }, 'the finger\'s click is dropped')
	let none = 0
	t2.b.onContext('text', { preventDefault: () => { none++ }, pointerType: 'mouse' })
	assert.equal(none, 0, 'a tool without variants keeps the browser menu')
	await nextTick()
})

test('job 229 AK2: a tile sets the option with its event; note and frame close, the connector (two choices) stays open', async () => {
	const { b, emitted } = toolbar({ active: 'sticky' })
	b.onClick('sticky', CLICK)
	b.pickVariant('type', 'pad', CLICK)
	assert.deepEqual(emitted, [['refocus', CLICK], ['options', 'sticky', { type: 'pad' }, CLICK]])
	assert.equal(b.pop.value, null)
	const t2 = toolbar({ active: 'connector' })
	t2.b.onClick('connector', CLICK)
	t2.b.pickVariant('route', 'curved', CLICK)
	t2.b.pickVariant('endCap', 'dot', CLICK)
	assert.deepEqual(t2.emitted, [['refocus', CLICK], ['options', 'connector', { route: 'curved' }, CLICK], ['options', 'connector', { endCap: 'dot' }, CLICK]])
	assert.deepEqual(t2.b.pop.value, { kind: 'variants', tool: 'connector' })
	// another tool (a key, the switch back to select) closes the variants
	t2.props.active = 'select'
	await nextTick()
	assert.equal(t2.b.pop.value, null)
})

test('job 229 AK2: "More tools" opens its grid; a tile chooses the tool and closes it; the button shows the picked tool', async () => {
	const { b, emitted, props } = toolbar()
	assert.equal(b.labelOf('more'), 'More tools')
	assert.equal(b.pressed('more'), false)
	assert.equal(b.iconOf('more'), icons.moreTools)
	b.onClick('more', CLICK)
	assert.deepEqual(b.pop.value, { kind: 'more', tool: 'more' })
	b.pickMore('table', CLICK)
	assert.deepEqual(emitted, [['tool', 'table', CLICK]])
	assert.equal(b.pop.value, null)
	props.active = 'table'
	assert.equal(b.pressed('more'), true)
	assert.equal(b.picked.value, 'table')
	assert.equal(b.labelOf('more'), 'More tools: Table')
	assert.equal(b.iconOf('more'), icons.table)
	assert.equal(b.keyOf('laser'), 'K')
	b.onClick('more', KEY)
	b.onClick('more', KEY)
	assert.equal(b.pop.value, null, 'a second click closes it')
	await nextTick()
})

test('job 229 AK2: the shape tool emits shapes (the view opens the panel), highlighted while the panel is open; another tool closes a popover', async () => {
	const { b, emitted, props } = toolbar()
	b.onClick('shape', CLICK)
	assert.deepEqual(emitted, [['shapes', CLICK]])
	assert.equal(b.expandedOf('shape'), 'false')
	assert.equal(b.controlsOf('shape'), 'knorke-shapes')
	props.shapesOpen = true
	assert.equal(b.expandedOf('shape'), 'true')
	assert.equal(b.highlighted('shape'), true)
	assert.equal(b.pressed('shape'), false, 'aria-pressed follows the tool only')
	b.onClick('more', CLICK)
	b.onClick('text', CLICK)
	assert.equal(b.pop.value, null)
	assert.deepEqual(emitted.at(-1), ['tool', 'text', CLICK])
	await nextTick()
})
