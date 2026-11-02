/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 159) The "+" of a text item hangs a connector, deterministic in Node
 * on the fake DOM with the real SceneManager, InputController,
 * GestureController, ConnectController and SceneModel (renderer stubbed;
 * the hold and wheel timers are mock.timers). Text T (100, 100), 300 × 45,
 * note B (600, 100), 200 × 200, note A (100, 500); camera (0, 0, 1), so
 * container px = world units. Covered:
 * - AK3.1 a click on plus-t of T gives no intent; the connector hangs
 *   (connecting 'connect'), no handles, no selection box, the preview starts
 *   at anchor (0.5, 0) of T
 * - AK3.2 hover over B: the preview's target is B; a click on B gives the
 *   connect intent with the default options; then nothing hangs
 * - AK3.3 a click on empty canvas: a free end on the 0.01 grid; a press
 *   dragged 30 px: the end at its release, no marquee; Ctrl over B: free
 *   (also at once with the key down, snapping again after the keyup)
 * - AK3.4 every way out gives no intent and ends the state: Esc (selection
 *   stays), a click on T, a second click on plus-t, a right click (no
 *   menu), macOS Ctrl+click (contextmenu, no menu), setTool, setMode view,
 *   setMode vote with settle, T removed, an editor that opens, reset
 * - AK3.5 keys act as during a press while it hangs; the wheel zooms and it
 *   keeps hanging
 * - AK3.6 a pen: tap on plus-t, hover over B, tap on B; both touchends
 *   cancelled
 * - AK3.7 unchanged: 4 px from plus-t of T drags a connector, a click on
 *   plus-r of a note gives neighbour with connect
 * - AK4 a finger: tap on plus-t hangs it (touchend cancelled), a swipe pans,
 *   a hold does nothing (no ring; round 1: its long-press contextmenu is
 *   prevented and leaves it hanging, also during a long tap), a tap on B
 *   connects (touchend cancelled); a tap on empty canvas gives a free end, a
 *   tap on T nothing; a pen held still (its contextmenu) drops it
 * - (job 169) the connect intent of a hanging connector whose end is bound
 *   to an item carries selectEnd: true (mouse, pen, finger, also beside an
 *   anchor); a free end, Ctrl/⌘ over B, a drag from "+" and the connector
 *   tool give none; the scene itself selects nothing
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { WHEEL_END_MS } from '../../../src/scene/GestureController.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, rcalls, setupScene, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const T = '01JA0000000000000000000004'

const items = () => [
	textItem(T, { x: 100, y: 100, w: 300, h: 45, data: { text: 'Hallo' } }),
	note(B, { x: 600, y: 100 }),
	note(A, { x: 100, y: 500, z: 'a2' }),
]
/** Anchor (0.5, 0) of T and the centre of B, container px. (job 231) A text item has no plus-r (its side r is the
 * wrap width handle there): the tests hang from plus-t. */
const T_R = [250, 100]
const B_MID = [700, 200]
const B_BOX = { x: 600, y: 100, w: 200, h: 200, r: 0 }
const DEFAULT = Object.freeze({ route: 'elbow', endCap: 'triangle' })

let h = null
/** Every selection box the scene reported (onSelectionBox). */
let boxes = []
/** Handle centres by name with T selected, before the click. */
let at = {}
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/** Mock timers, the scene, T selected; `at` holds T's handles. */
function setup() {
	mock.timers.enable({ apis: ['setTimeout'] })
	boxes = []
	h = setupScene(items(), { on: { onSelectionBox: (b) => boxes.push(b) } })
	h.scene.setSelection([T])
	at = Object.fromEntries(h.scene.handles().map((x) => [x.name, [x.x, x.y]]))
	h.frame()
	h.log.length = 0
	rcalls.length = 0
}

/** A press and its release at one point, then a frame. */
function click([x, y], props = {}) {
	h.pointer('pointerdown', x, y, props)
	h.pointer('pointerup', x, y, props)
	h.frame()
}

/** Setup, then a mouse click on plus-t of T: the connector hangs. */
function hang() {
	setup()
	click(at['plus-t'])
	assert.equal(h.scene.stats().connecting, 'connect', 'it hangs')
}

const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })
const pen = { pointerType: 'pen', pointerId: 3 }
const touchend = () => dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented
/** @return {object|null} the last preview handed to the renderer (null: cleared) */
const preview = () => callsOf('setConnectPreview').at(-1)?.[0] ?? null
const hover = ([x, y], props = {}) => {
	h.pointer('pointermove', x, y, { buttons: 0, ...props })
	h.frame()
}

/** Nothing hangs any more and no intent came. */
function assertDropped(msg) {
	assert.deepEqual(h.intents(), [], `${msg}: no intent`)
	assert.equal(h.scene.stats().connecting, null, `${msg}: connecting null`)
	assert.equal(preview(), null, `${msg}: the preview is gone`)
}

describe('AK3 mouse and pen', () => {
	test('AK3.1 a click on plus-t of T: no intent; connecting "connect", no handles, no selection box; the last preview starts at anchor (0.5, 0) of T', () => {
		setup()
		assert.ok(boxes.at(-1) !== null, 'a selection box before')
		click(at['plus-t'])
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.stats().connecting, 'connect')
		assert.deepEqual(h.scene.handles(), [])
		assert.equal(boxes.at(-1), null, 'no context bar while it hangs')
		assert.deepEqual(preview().points.slice(0, 2), T_R)
		assert.deepEqual(h.scene.getSelection(), [T], 'the selection stays')
		assert.equal(h.log.filter((e) => e[0] === 'onSelection').length, 0)
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => [e[1].kind, e[1].active]), [['connect', true]])
		assert.equal(touchend(), false, 'a mouse click cancels no touchend')
	})

	test('AK3.2 hover over B: the target of the preview is B; a click on B gives exactly the connect intent (job 169: with selectEnd); afterwards nothing hangs and the tool stays select', () => {
		hang()
		hover(B_MID)
		assert.deepEqual(preview().target, B_BOX)
		assert.deepEqual(preview().points.slice(0, 2), T_R)
		click(B_MID)
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T, ax: 0.5, ay: 0 }, end: { item: B }, route: 'elbow', endCap: 'triangle', selectEnd: true }])
		assert.equal(h.scene.stats().connecting, null)
		assert.equal(preview(), null)
		assert.equal(h.scene.getTool(), 'select')
		assert.equal(h.log.filter((e) => e[0] === 'onTool').length, 0)
		assert.deepEqual(h.scene.getSelection(), [T], 'the scene selects nothing itself (the session selects B)')
		assert.ok(h.scene.handles().length > 0, 'the handles come back')
	})

	test('AK3.2 the connector tool options of the shell come with the intent', () => {
		setup()
		h.scene.setTool('connector', { route: 'curved', endCap: 'dot' })
		h.scene.setTool('select')
		click(at['plus-t'])
		click(B_MID)
		assert.deepEqual(h.intents().map((i) => [i.type, i.route, i.endCap]), [['connect', 'curved', 'dot']])
	})

	test('AK3.3 a click on empty canvas: a free end on the 0.01 grid; a press dragged 30 px: the end at its release, no marquee, the selection stays', () => {
		hang()
		click([500.123, 600.456])
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T, ax: 0.5, ay: 0 }, end: { x: 500.12, y: 600.46 }, route: 'elbow', endCap: 'triangle' }])
		h.log.length = 0
		h.scene.setSelection([T])
		click(at['plus-t'])
		h.pointer('pointerdown', 500, 650)
		h.pointer('pointermove', 515, 650, { buttons: 1 })
		h.frame()
		h.pointer('pointermove', 530, 650, { buttons: 1 })
		h.frame()
		assert.deepEqual(preview().points.slice(-2), [530, 650], 'the preview follows the press')
		h.pointer('pointerup', 530, 650)
		h.frame()
		assert.deepEqual(h.intents().map((i) => i.end), [{ x: 530, y: 650 }])
		assert.deepEqual(callsOf('setMarquee').filter((c) => c[0] !== null), [], 'no marquee')
		assert.deepEqual(h.scene.getSelection(), [T])
		assert.equal(h.scene.stats().dragging, false)
	})

	test('AK3.3 Ctrl/⌘ over B: the end is free; the key alone frees the preview at once and its release snaps again', () => {
		hang()
		hover(B_MID)
		dispatch(h.container, 'keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, repeat: false, isComposing: false })
		h.frame()
		assert.equal(preview().target, null, 'free while Ctrl is down')
		dispatch(h.container, 'keyup', { key: 'Control', code: 'ControlLeft' })
		h.frame()
		assert.deepEqual(preview().target, B_BOX, 'snapping again after the keyup')
		click(B_MID, { ctrlKey: true })
		assert.deepEqual(h.intents().map((i) => i.end), [{ x: 700, y: 200 }])
		h.log.length = 0
		h.scene.setSelection([T])
		click(at['plus-t'])
		click(B_MID, { metaKey: true })
		assert.deepEqual(h.intents().map((i) => i.end), [{ x: 700, y: 200 }], '⌘ too')
	})

	test('AK3.4 every way out: no intent, nothing hangs; Esc keeps the selection [T]', () => {
		const ways = {
			Esc: () => h.key('Escape'),
			'a click on T': () => click([250, 122]),
			'a second click on plus-t': () => click(at['plus-t']),
			'a click on plus-t, 6 px beside it': () => click([at['plus-t'][0] + 6, at['plus-t'][1]]),
			"setTool('hand')": () => h.scene.setTool('hand'),
			"setMode('view')": () => h.scene.setMode('view'),
			"setMode('vote', {settle: true})": () => h.scene.setMode('vote', { settle: true }),
			'T removed': () => h.scene.update(h.model.apply({ removes: [T] })),
			'an editor opens': () => h.scene.openTextEditor(A),
			reset: () => h.scene.reset(),
		}
		for (const [name, way] of Object.entries(ways)) {
			hang()
			way()
			h.frame()
			assertDropped(name)
			if (name === 'Esc') assert.deepEqual(h.scene.getSelection(), [T], 'Esc: the selection stays')
			if (name.startsWith('a ')) {
				assert.deepEqual(h.scene.getSelection(), [T], `${name}: the selection stays`)
				assert.ok(h.scene.handles().length > 0, `${name}: the handles are back`)
			}
			h.key('Delete')
			if (h.scene.getMode() === 'edit' && h.scene.getSelection().length > 0 && h.scene.getTool() === 'select') {
				assert.deepEqual(h.intents().map((i) => i.type), ['delete'], `${name}: the keys work again`)
			}
			h.restore()
			h = null
			mock.timers.reset()
		}
	})

	test('AK3.4 a right click and a macOS Ctrl+click (contextmenu): no intent, no contextMenu, the browser menu prevented', () => {
		for (const order of ['down', 'up']) {
			hang()
			const [x, y] = [500, 650]
			h.pointer('pointerdown', x, y, { button: 2, buttons: 2 })
			let e = null
			if (order === 'down') e = dispatch(h.container, 'contextmenu', { clientX: x, clientY: y, button: 2, pointerId: 1, pointerType: 'mouse' })
			assert.equal(h.scene.stats().connecting, 'connect', `${order}: the press itself drops nothing`)
			h.pointer('pointerup', x, y, { button: 2, buttons: 0 })
			if (order === 'up') e = dispatch(h.container, 'contextmenu', { clientX: x, clientY: y, button: 2, pointerId: 1, pointerType: 'mouse' })
			h.frame()
			assertDropped(`right click, contextmenu after pointer${order}`)
			assert.equal(e.defaultPrevented, true)
			h.restore()
			h = null
			mock.timers.reset()
		}
		hang()
		h.pointer('pointerdown', 500, 650, { ctrlKey: true })
		const e = dispatch(h.container, 'contextmenu', { clientX: 500, clientY: 650, button: 0, pointerId: 1, pointerType: 'mouse', ctrlKey: true })
		h.pointer('pointerup', 500, 650, { ctrlKey: true })
		h.frame()
		assertDropped('macOS Ctrl+click')
		assert.equal(e.defaultPrevented, true)
	})

	test('AK3.4 a right-drag pans and the connector keeps hanging', () => {
		hang()
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 500, 650, { button: 2, buttons: 2 })
		for (let i = 1; i <= 5; i++) h.pointer('pointermove', 500 + 20 * i, 650, { button: -1, buttons: 2 })
		h.pointer('pointerup', 600, 650, { button: 2, buttons: 0 })
		h.frame()
		assert.notDeepEqual(h.scene.getCamera(), cam, 'panned')
		assert.equal(h.scene.stats().connecting, 'connect')
		assert.deepEqual(h.intents(), [])
	})

	test('AK3.5 while it hangs Delete, Ctrl+Z, Alt+→, →, Tab, a tool key, Enter, G, C, ?, Ctrl+G give nothing; the tool and the selection stay; the wheel zooms and it keeps hanging', () => {
		hang()
		h.focusCanvas()
		const keys = [['Delete'], ['z', { ctrlKey: true }], ['ArrowRight', { altKey: true }], ['ArrowRight'], ['Tab'], ['n'], ['Enter'], ['g'], ['c'], ['?'], ['g', { ctrlKey: true }], ['y', { ctrlKey: true }], ['d', { ctrlKey: true }], ['ContextMenu']]
		for (const [key, props] of keys) h.key(key, props)
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.log.filter((e) => ['onTool', 'onGrid', 'onShortcuts', 'onCursors', 'onSelection'].includes(e[0])), [])
		assert.equal(h.scene.getTool(), 'select')
		assert.deepEqual(h.scene.getSelection(), [T])
		assert.equal(h.scene.stats().editing, null)
		assert.equal(h.scene.stats().connecting, 'connect')
		const cam = h.scene.getCamera()
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: -100, deltaMode: 0, clientX: 500, clientY: 400, ctrlKey: true })
		mock.timers.tick(WHEEL_END_MS)
		h.frame()
		assert.ok(h.scene.getCamera().scale > cam.scale, 'the wheel zoomed')
		assert.equal(h.scene.stats().connecting, 'connect', 'it keeps hanging')
		assert.deepEqual(h.scene.handles(), [])
	})

	test('AK3.6 a pen: tap on plus-t, hover over B (target B), tap on B gives connect (job 169: with selectEnd); both touchends are cancelled', () => {
		setup()
		click(at['plus-t'], pen)
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.stats().connecting, 'connect')
		assert.equal(touchend(), true, 'no compatibility click after the tap on plus-t')
		hover(B_MID, pen)
		assert.deepEqual(preview().target, B_BOX)
		click(B_MID, pen)
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T, ax: 0.5, ay: 0 }, end: { item: B }, ...DEFAULT, selectEnd: true }])
		assert.equal(touchend(), true, 'no compatibility click after the tap on B')
		assert.equal(touchend(), false, 'only once')
		assert.equal(h.scene.stats().connecting, null)
	})

	test('AK3.7 unchanged: 4 px with the mouse from plus-t of T drags a connector; a click on plus-r of a note gives neighbour with connect', () => {
		setup()
		h.pointer('pointerdown', ...at['plus-t'])
		h.pointer('pointermove', at['plus-t'][0] + 4, at['plus-t'][1], { buttons: 1 })
		h.frame()
		assert.equal(h.scene.stats().connecting, 'connect', 'a drag')
		h.pointer('pointermove', B_MID[0], B_MID[1], { buttons: 1 })
		h.frame()
		h.pointer('pointerup', ...B_MID)
		h.frame()
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T, ax: 0.5, ay: 0 }, end: { item: B }, ...DEFAULT }])
		assert.equal(h.scene.stats().connecting, null, 'nothing hangs after the drag')
		h.log.length = 0
		h.scene.setSelection([A])
		const plusA = h.scene.handles().find((x) => x.name === 'plus-r')
		click([plusA.x, plusA.y])
		assert.deepEqual(h.intents(), [{ type: 'neighbour', id: A, side: 'r', connect: DEFAULT }])
		assert.equal(h.scene.stats().connecting, null)
	})
})

describe('AK4 finger', () => {
	test('tap on plus-t hangs it (touchend cancelled); a 60-px swipe pans without an intent; a 700-ms hold gives nothing and no ring; a tap on B connects (touchend cancelled)', () => {
		setup()
		click(at['plus-t'], finger())
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.stats().connecting, 'connect')
		assert.equal(touchend(), true, 'no compatibility click after the tap on plus-t')
		// a swipe over empty canvas pans
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 500, 650, finger(6))
		h.pointer('pointermove', 530, 650, finger(6))
		h.frame()
		h.pointer('pointermove', 560, 650, finger(6))
		h.frame()
		h.pointer('pointerup', 560, 650, finger(6))
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: cam.x - 60, y: cam.y, scale: cam.scale }, 'panned by the swipe')
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.stats().connecting, 'connect', 'still hanging after the swipe')
		assert.equal(touchend(), false)
		// a swipe that starts on note A pans too (the finger is not claimed): no end, A not moved
		h.pointer('pointerdown', 200 + 60, 600, finger(6))
		h.pointer('pointermove', 230 + 60, 600, finger(6))
		h.frame()
		h.pointer('pointermove', 260 + 60, 600, finger(6))
		h.frame()
		h.pointer('pointerup', 260 + 60, 600, finger(6))
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: cam.x - 120, y: cam.y, scale: cam.scale }, 'a swipe from A pans')
		assert.deepEqual(h.intents(), [])
		assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [100, 500])
		assert.equal(h.scene.stats().connecting, 'connect')
		// a finger held still; Android sends its long-press contextmenu meanwhile (round 1 of job 159)
		h.pointer('pointerdown', 500, 650, finger(7))
		mock.timers.tick(700)
		assert.equal(h.scene.stats().holdRing, null, 'no hold ring')
		const menu = dispatch(h.container, 'contextmenu', { clientX: 500, clientY: 650, button: 0, pointerId: 7, pointerType: 'touch' })
		assert.equal(menu.defaultPrevented, true, 'the long press opens no browser menu')
		assert.equal(h.scene.stats().connecting, 'connect', 'a finger\'s contextmenu leaves it hanging')
		h.frame(700)
		h.pointer('pointerup', 500, 650, finger(7))
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.stats().holdRing, null)
		assert.deepEqual(callsOf('setMarquee').filter((c) => c[0] !== null), [], 'no selection frame')
		assert.equal(h.scene.stats().connecting, 'connect', 'still hanging after the hold')
		// a tap on B
		// B lies 120 px further right on screen after the two swipes
		click([B_MID[0] - h.scene.getCamera().x, B_MID[1]], finger(8))
		assert.deepEqual(h.intents().map((i) => [i.type, i.start, i.end.item]), [['connect', { item: T, ax: 0.5, ay: 0 }, B]])
		assert.equal(touchend(), true, 'no compatibility click after the tap on B')
		assert.equal(h.scene.stats().connecting, null)
	})

	test('round 1: a 450-ms tap on B with the long-press contextmenu during it (no pointerType: the finger\'s pointerdown counts) still connects; a pen held still drops it', () => {
		setup()
		click(at['plus-t'], finger())
		h.pointer('pointerdown', ...B_MID, finger(6))
		const menu = dispatch(h.container, 'contextmenu', { clientX: B_MID[0], clientY: B_MID[1], button: 0, pointerType: '' })
		assert.equal(menu.defaultPrevented, true)
		assert.equal(h.scene.stats().connecting, 'connect', 'still hanging')
		h.frame(450)
		h.pointer('pointerup', ...B_MID, finger(6))
		h.frame()
		assert.deepEqual(h.intents().map((i) => [i.type, i.end.item]), [['connect', B]])
		assert.deepEqual(h.scene.getSelection(), [T], 'the tap selected nothing')
		h.log.length = 0
		click(at['plus-t'], pen)
		h.pointer('pointerdown', 500, 650, pen)
		const penMenu = dispatch(h.container, 'contextmenu', { clientX: 500, clientY: 650, button: 0, pointerId: 3, pointerType: 'pen' })
		h.pointer('pointerup', 500, 650, pen)
		h.frame()
		assertDropped('a pen held still')
		assert.equal(penMenu.defaultPrevented, true)
	})

	test('a tap on empty canvas gives a free end; a tap on T gives nothing and ends it; a tap on plus-t again ends it too', () => {
		setup()
		click(at['plus-t'], finger())
		click([500, 650], finger(6))
		assert.deepEqual(h.intents().map((i) => i.end), [{ x: 500, y: 650 }])
		assert.equal(touchend(), true)
		h.log.length = 0
		h.scene.setSelection([T])
		h.frame()
		click(at['plus-t'], finger(7))
		click([250, 122], finger(8))
		assertDropped('a tap on T')
		assert.deepEqual(h.scene.getSelection(), [T])
		click(at['plus-t'], finger(9))
		click([at['plus-t'][0] + 15, at['plus-t'][1]], finger(10))
		assertDropped('a tap 15 px beside plus-t (HANDLE_TOUCH_PX)')
	})

	test('two fingers zoom while it hangs, and it keeps hanging', () => {
		setup()
		click(at['plus-t'], finger())
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 400, 600, finger(6))
		h.pointer('pointerdown', 600, 600, finger(7))
		h.pointer('pointermove', 350, 600, finger(6))
		h.pointer('pointermove', 650, 600, finger(7))
		h.frame()
		h.pointer('pointerup', 350, 600, finger(6))
		h.pointer('pointerup', 650, 600, finger(7))
		h.frame()
		assert.ok(h.scene.getCamera().scale > cam.scale, 'zoomed')
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.stats().connecting, 'connect')
	})
})

describe('job 169 selectEnd', () => {
	test('AK1 mouse: a click on B (also beside its left anchor) gives selectEnd: true and the scene keeps [T]; a click on empty canvas and Ctrl/⌘ over B give none', () => {
		hang()
		click(B_MID)
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T, ax: 0.5, ay: 0 }, end: { item: B }, route: 'elbow', endCap: 'triangle', selectEnd: true }])
		assert.deepEqual(h.scene.getSelection(), [T], 'the scene selects nothing itself')
		assert.equal(h.log.filter((e) => e[0] === 'onSelection').length, 0)
		const ends = {
			'beside the left anchor of B': [[590, 200], {}],
			'empty canvas': [[500.123, 600.456], {}],
			'Ctrl over B': [B_MID, { ctrlKey: true }],
			'⌘ over B': [B_MID, { metaKey: true }],
		}
		const got = {}
		for (const [name, [pt, props]] of Object.entries(ends)) {
			h.log.length = 0
			h.scene.setSelection([T])
			h.frame()
			click(at['plus-t'])
			assert.equal(h.scene.stats().connecting, 'connect', `${name}: it hangs`)
			click(pt, props)
			const [i] = h.intents()
			got[name] = [i?.end, i?.selectEnd]
		}
		assert.deepEqual(got, {
			'beside the left anchor of B': [{ item: B, ax: 0, ay: 0.5 }, true],
			'empty canvas': [{ x: 500.12, y: 600.46 }, undefined],
			'Ctrl over B': [{ x: 700, y: 200 }, undefined],
			'⌘ over B': [{ x: 700, y: 200 }, undefined],
		})
		assert.equal('selectEnd' in h.intents()[0], false, 'a free end has no selectEnd field')
	})

	test('AK1 unchanged without selectEnd: a drag from plus-t of T to B and a drag with the connector tool from T to B', () => {
		setup()
		h.pointer('pointerdown', ...at['plus-t'])
		h.pointer('pointermove', at['plus-t'][0] + 4, at['plus-t'][1], { buttons: 1 })
		h.frame()
		h.pointer('pointermove', ...B_MID, { buttons: 1 })
		h.frame()
		h.pointer('pointerup', ...B_MID)
		h.frame()
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T, ax: 0.5, ay: 0 }, end: { item: B }, ...DEFAULT }], 'a drag from "+"')
		h.log.length = 0
		h.scene.setTool('connector')
		h.pointer('pointerdown', 250, 122)
		h.pointer('pointermove', 475, 161, { buttons: 1 })
		h.frame()
		h.pointer('pointermove', ...B_MID, { buttons: 1 })
		h.frame()
		h.pointer('pointerup', ...B_MID)
		h.frame()
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: T }, end: { item: B }, ...DEFAULT }], 'the connector tool')
	})

	test('AK2 finger: tap on plus-t, a swipe only pans, a tap on B gives end.item B with selectEnd (touchend cancelled); tap on plus-t, tap on empty canvas: a free end without selectEnd', () => {
		setup()
		click(at['plus-t'], finger())
		assert.equal(touchend(), true)
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 500, 650, finger(6))
		h.pointer('pointermove', 530, 650, finger(6))
		h.frame()
		h.pointer('pointermove', 560, 650, finger(6))
		h.frame()
		h.pointer('pointerup', 560, 650, finger(6))
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: cam.x - 60, y: cam.y, scale: cam.scale }, 'the swipe panned')
		assert.deepEqual(h.intents(), [], 'the swipe gave no intent')
		assert.equal(h.scene.stats().connecting, 'connect', 'still hanging')
		click([B_MID[0] - h.scene.getCamera().x, B_MID[1]], finger(7))
		const [i] = h.intents()
		assert.deepEqual([i.type, i.start, i.end.item, i.selectEnd], ['connect', { item: T, ax: 0.5, ay: 0 }, B, true])
		assert.equal(touchend(), true, 'no compatibility click after the tap on B')
		assert.deepEqual(h.scene.getSelection(), [T], 'the scene selects nothing itself')
		h.log.length = 0
		h.scene.setSelection([T])
		h.frame()
		const plus = h.scene.handles().find((x) => x.name === 'plus-t')
		click([plus.x, plus.y], finger(8))
		assert.equal(h.scene.stats().connecting, 'connect')
		click([500, 650], finger(9))
		const [f] = h.intents()
		assert.equal('item' in f.end, false, 'a free end')
		assert.equal('selectEnd' in f, false, 'without selectEnd')
	})
})
