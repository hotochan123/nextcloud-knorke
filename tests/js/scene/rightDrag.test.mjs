/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Right-drag pans (factory job 156), deterministic in Node on the fake DOM
 * with the real SceneManager, InputController, GestureController and
 * TextEditor and the recording renderer stub of sceneHarness.mjs:
 * - AK1 mode edit: a right-button press of the mouse on empty canvas, on a
 *   note and on a handle of the selected note, with the tools select, hand,
 *   sticky and connector: 2 px keep the camera, a drag pans by the pointer
 *   way / scale (its first step from the pointerdown), the contextmenu after
 *   the pointerdown and after the pointerup is prevented, nothing is
 *   selected, moved, created or marqueed, onActivity gesture on and off
 * - AK2 modes vote (over a votable item) and view, the wheel stages auto,
 *   zoom and pan: the same pan, the scale stays; a right click there gives no
 *   vote, no voteMiss, no camera change and no menu
 * - AK4 the contextmenu after a right-drag in Windows order on document.body
 *   (or an overlay control) is prevented; a later one after a new pointerdown
 *   outside the canvas is not
 * - AK5 pointercancel during the press or the drag, and a pointermove without
 *   the right button (a missed pointerup): no menu, the pan ends, the wheel
 *   works again
 * - AK6 the text editor: a right press into it neither pans nor prevents
 *   anything and the editor stays open (job 168: the mouse and the pen)
 * Factory job 168 (the pen's side button; right press beside an open editor):
 * - AK1 a right-drag of the pen (button 2, or button 0 with bit 2 in
 *   buttons) in mode edit from empty canvas, note A and a handle of the
 *   selected A, tools select, sticky and connector: 10 px keep the camera,
 *   (−200, −100) sets it to (200, 100), the contextmenu after the
 *   pointerdown or the pointerup is prevented, nothing selected, moved,
 *   created or marqueed, gesture on and off; modes vote and view pan the
 *   same, and a pen right click there gives no vote, voteMiss, camera change
 *   (not even on a small votable item) or menu
 * - AK4 a right-drag beside the open editor (mouse in both contextmenu
 *   orders, pen) pans and leaves it open: focus, text, no final commit, no
 *   menu, the editor moves by the way, the compatibility mousedown is
 *   prevented; a left click beside it then commits once; a pointercancel or
 *   a move without a button after a right press beside it leaves it open
 * - AK5 a right click beside the open editor (mouse in both orders, pen): the
 *   editor stays open until the pointerup, then exactly its final commit and
 *   the menu at the release point; the canvas has the focus; mode vote:
 *   the commit, no menu, no vote
 * - AK6 a middle-button press beside the editor still ends it at the
 *   pointerdown with its commit and pans; the mousedown of a later press
 *   into the editor is not prevented
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

let h
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/**
 * Notes A at (0, 0) and B at (300, 0), both 200 × 200; container 1000 × 800.
 *
 * @param {object} [scene] SceneManager options
 * @return {object} sceneHarness
 */
function setup(scene = {}) {
	h = setupScene([note(A), note(B, { x: 300 })], { scene })
	return h
}

/**
 * A contextmenu event of the mouse on the canvas (or props.target).
 *
 * @param {number} x client x
 * @param {number} y client y
 * @param {object} [props] event fields
 * @return {object} the event
 */
function ctxMenu(x, y, props = {}) {
	return dispatch(props.target ?? h.container, 'contextmenu', { clientX: x, clientY: y, button: 2, pointerId: 1, pointerType: 'mouse', ...props })
}

/** The right press devices (pointerdown fields): the mouse, (job 168) the pen's side button as button 2 and as bit 2 in buttons. */
const MOUSE = Object.freeze({ pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2 })
const PEN = Object.freeze({ pointerType: 'pen', pointerId: 9, button: 2, buttons: 2 })
const PEN_TIP = Object.freeze({ pointerType: 'pen', pointerId: 9, button: 0, buttons: 3 })

/** (job 168) A right press of dev: its pointerdown, a pointermove (its buttons held), its pointerup or pointercancel. */
const rDown = (x, y, dev = MOUSE) => h.pointer('pointerdown', x, y, { ...dev })
const rMove = (x, y, dev = MOUSE) => h.pointer('pointermove', x, y, { ...dev, button: -1 })
const rUp = (x, y, dev = MOUSE, type = 'pointerup') => h.pointer(type, x, y, { ...dev, buttons: 0 })
/** The contextmenu of dev's press. */
const devMenu = (x, y, dev = MOUSE, props = {}) => ctxMenu(x, y, { pointerType: dev.pointerType, pointerId: dev.pointerId, ...props })

/**
 * A right-drag: pointerdown (button 2; job 168: of `dev`), steps of 10 % of the way, pointerup; the
 * contextmenu after the pointerdown (Linux, macOS) or after the pointerup (Windows), on `menuOn`.
 *
 * @param {number} x client x of the press
 * @param {number} y client y of the press
 * @param {number} dx way x
 * @param {number} dy way y
 * @param {object} [o] {order: 'down' | 'up', menuOn: target of the contextmenu (default the canvas), dev: MOUSE, PEN or PEN_TIP}
 * @return {object} the contextmenu event
 */
function rightDrag(x, y, dx, dy, { order = 'down', menuOn = null, dev = MOUSE } = {}) {
	rDown(x, y, dev)
	let e = null
	const target = menuOn ?? h.container
	if (order === 'down') e = devMenu(x, y, dev, { target })
	for (let i = 1; i <= 10; i++) {
		rMove(x + dx * i / 10, y + dy * i / 10, dev)
	}
	rUp(x + dx, y + dy, dev)
	if (order === 'up') e = devMenu(x + dx, y + dy, dev, { target })
	h.frame()
	return e
}

/**
 * A right click without moving.
 *
 * @param {number} x client x
 * @param {number} y client y
 * @param {string} [order] 'down' | 'up': where the contextmenu comes
 * @param {object} [dev] MOUSE, PEN or PEN_TIP
 * @return {object} the contextmenu event
 */
function rightClick(x, y, order = 'down', dev = MOUSE) {
	return rightDrag(x, y, 0, 0, { order, dev })
}

/** @param {string} kind activity kind @return {boolean[]} active of the onActivity entries of that kind */
const acts = (kind) => h.log.filter((e) => e[0] === 'onActivity' && e[1].kind === kind).map((e) => e[1].active)
/** @return {number} non-null marquee rectangles handed to the renderer so far */
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null).length

describe('AK1: right-drag in mode edit pans, whatever lies under the press and whatever the tool', () => {
	for (const order of ['down', 'up']) {
		test(`empty canvas, note A, a handle of the selected A × select, hand, sticky, connector (contextmenu after pointer${order})`, () => {
			for (const tool of ['select', 'hand', 'sticky', 'connector']) {
				for (const start of ['empty', 'note', 'handle']) {
					const what = `${tool}, ${start}`
					setup()
					// scale 0.5: A covers container (50, 50)–(150, 150)
					h.scene.setCamera({ x: -100, y: -100, scale: 0.5 })
					let p = start === 'empty' ? { x: 700, y: 600 } : { x: 100, y: 100 }
					if (start === 'handle') {
						h.scene.setSelection([A])
						h.frame()
						const br = h.scene.handles().find((x) => x.name === 'br')
						assert.ok(br, `${what}: the corner handle of A`)
						p = { x: br.x, y: br.y }
					}
					h.scene.setTool(tool)
					h.frame()
					const sel0 = h.scene.getSelection()
					const cam0 = h.scene.getCamera()
					const m0 = marquees()
					h.log.length = 0
					h.pointer('pointerdown', p.x, p.y, { button: 2, buttons: 2 })
					const early = order === 'down' ? ctxMenu(p.x, p.y) : null
					h.pointer('pointermove', p.x + 2, p.y, { button: -1, buttons: 2 })
					assert.deepEqual(h.scene.getCamera(), cam0, `${what}: 2 px keep the camera`)
					for (let i = 1; i <= 10; i++) {
						h.pointer('pointermove', p.x - 20 * i, p.y - 10 * i, { button: -1, buttons: 2 })
					}
					h.pointer('pointerup', p.x - 200, p.y - 100, { button: 2, buttons: 0 })
					const late = order === 'up' ? ctxMenu(p.x - 200, p.y - 100) : null
					h.frame()
					assert.equal((early ?? late).defaultPrevented, true, `${what}: contextmenu prevented`)
					assert.deepEqual(h.scene.getCamera(), { x: cam0.x + 200 / 0.5, y: cam0.y + 100 / 0.5, scale: 0.5 }, `${what}: the camera moved by (200, 100) / scale`)
					assert.deepEqual(h.log, [
						['onActivity', { kind: 'gesture', active: true, ids: [] }],
						['onUserCamera'],
						['onActivity', { kind: 'gesture', active: false, ids: [] }],
					], `${what}: no intent, no onSelection, gesture on and off`)
					assert.equal(marquees(), m0, `${what}: no marquee`)
					assert.deepEqual(h.scene.getSelection(), sel0, `${what}: the selection stays`)
					assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [0, 0], `${what}: A did not move`)
					assert.equal(h.scene.getTool(), tool, `${what}: the tool stays`)
					h.restore()
					h = null
				}
			}
		})
	}
})

describe('AK2: modes vote and view, every wheel stage', () => {
	for (const mode of ['vote', 'view']) {
		test(`mode ${mode}: right-drag over A pans the same with the wheel stages auto, zoom and pan (scale stays); a right click gives no vote, voteMiss, camera change or menu`, () => {
			for (const wheel of ['auto', 'zoom', 'pan']) {
				setup({ mode, wheel })
				if (mode === 'vote') {
					h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
				}
				h.scene.setCamera({ x: 0, y: 0, scale: 2 })
				h.frame()
				h.log.length = 0
				const e = rightDrag(100, 100, -200, -100)
				assert.equal(e.defaultPrevented, true, `${wheel}: contextmenu prevented`)
				assert.deepEqual(h.scene.getCamera(), { x: 100, y: 50, scale: 2 }, `${wheel}: the camera moved by (200, 100) / 2, the scale stays`)
				assert.deepEqual(acts('gesture'), [true, false], `${wheel}: gesture on and off`)
				assert.deepEqual(h.intents(), [], `${wheel}: no intent`)
				const cam = h.scene.getCamera()
				h.log.length = 0
				// A covers container (−200, −100)–(200, 300) now: a click at (100, 100) lies on it
				const down = rightClick(100, 100, 'down')
				const up = rightClick(150, 150, 'up')
				assert.equal(down.defaultPrevented && up.defaultPrevented, true, `${wheel}: both contextmenus prevented`)
				assert.deepEqual(h.scene.getCamera(), cam, `${wheel}: no camera change (no small-target zoom)`)
				assert.deepEqual(h.intents(), [], `${wheel}: no vote, no voteMiss, no contextMenu`)
				assert.equal(h.log.filter((x) => x[0] === 'onUserCamera' || x[0] === 'onSelection').length, 0, `${wheel}: no user camera, no selection`)
				h.restore()
				h = null
			}
		})
	}

	test('mode vote: a right click on an item that is not votable gives no voteMiss either; a left click still votes', () => {
		setup({ mode: 'vote' })
		h.scene.setVoteState({ votable: (id) => id === B, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
		h.log.length = 0
		rightClick(100, 100)
		rightClick(400, 100, 'up')
		assert.deepEqual(h.intents(), [])
		h.pointer('pointerdown', 400, 100)
		h.pointer('pointerup', 400, 100)
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['vote', B]])
	})
})

describe('AK4: the contextmenu of a right-drag outside the canvas (Windows: after the pointerup)', () => {
	test('on document.body: prevented; a later one on the body after a new pointerdown outside the canvas is not', () => {
		setup()
		const body = h.dom.doc.body
		const e = rightDrag(500, 400, -200, -100, { order: 'up', menuOn: body })
		assert.equal(e.defaultPrevented, true, 'the right-drag\'s contextmenu on the body')
		dispatch(body, 'pointerdown', { clientX: 5, clientY: 5, button: 2, pointerId: 1, pointerType: 'mouse' })
		const later = dispatch(body, 'contextmenu', { clientX: 5, clientY: 5, button: 2, pointerId: 1, pointerType: 'mouse' })
		dispatch(body, 'pointerup', { clientX: 5, clientY: 5, button: 2, pointerId: 1, pointerType: 'mouse' })
		assert.equal(later.defaultPrevented, false, 'the browser\'s menu outside the canvas')
		assert.deepEqual(h.intents(), [])
	})

	test('a right-drag whose contextmenu has not come yet: a pointercancel or a menu key forgets it, the next contextmenu outside keeps the browser\'s menu', () => {
		setup()
		const body = h.dom.doc.body
		const drag = (end = 'pointerup') => {
			h.pointer('pointerdown', 500, 400, { button: 2, buttons: 2 })
			h.pointer('pointermove', 400, 300, { button: -1, buttons: 2 })
			h.pointer(end, 400, 300, { button: 2, buttons: 0 })
		}
		drag('pointercancel')
		const after = dispatch(body, 'contextmenu', { clientX: 5, clientY: 5, button: 2, pointerId: 1, pointerType: 'mouse' })
		assert.equal(after.defaultPrevented, false, 'Windows sends none after a pointercancel: a later one is the browser\'s')
		drag()
		const pending = dispatch(body, 'contextmenu', { clientX: 5, clientY: 5, button: 2, pointerId: 1, pointerType: 'mouse' })
		assert.equal(pending.defaultPrevented, true, 'after a pointerup it is still the right-drag\'s')
		// the echo of a menu key is no right press's either
		drag()
		h.key('F10', { shiftKey: true, target: body })
		const echo = dispatch(body, 'contextmenu', { clientX: 0, clientY: 0, button: 0, pointerId: -1, pointerType: '' })
		assert.equal(echo.defaultPrevented, false, 'Shift+F10 outside the canvas keeps the browser\'s menu')
		assert.deepEqual(h.intents(), [])
	})

	test('only one contextmenu per right press: a second one on the body without a new press keeps the browser\'s menu', () => {
		setup()
		const body = h.dom.doc.body
		rightDrag(500, 400, -200, -100, { order: 'up', menuOn: body })
		const again = dispatch(body, 'contextmenu', { clientX: 5, clientY: 5, button: 2, pointerId: 1, pointerType: 'mouse' })
		assert.equal(again.defaultPrevented, false)
	})

	test('on an overlay control (a chip button) after the pointerup: prevented, no menu; a right click on the control itself keeps the browser\'s menu', () => {
		setup()
		const overlay = h.container.descendants().find((el) => el.className === 'knorke-scene-overlay')
		const button = h.dom.doc.createElement('button')
		overlay.appendChild(button)
		const e = rightDrag(500, 400, 300, -300, { order: 'up', menuOn: button })
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(h.intents(), [])
		h.pointer('pointerdown', 800, 100, { button: 2, buttons: 2, target: button })
		const own = ctxMenu(800, 100, { target: button })
		h.pointer('pointerup', 800, 100, { button: 2, buttons: 0, target: button })
		assert.equal(own.defaultPrevented, false)
		assert.deepEqual(h.intents(), [])
	})
})

describe('AK5: pointercancel and a missed pointerup end the right press without a menu', () => {
	test('pointercancel during the press (unmoved) and during the drag: no menu, the pan ends', () => {
		setup()
		h.pointer('pointerdown', 100, 100, { button: 2, buttons: 2 })
		ctxMenu(100, 100)
		h.pointer('pointercancel', 100, 100, { button: 2, buttons: 0 })
		h.pointer('pointerup', 100, 100, { button: 2, buttons: 0 })
		assert.deepEqual(h.intents(), [], 'no menu after a cancelled press')
		h.pointer('pointerdown', 100, 100, { button: 2, buttons: 2 })
		ctxMenu(100, 100)
		h.pointer('pointermove', 50, 100, { button: -1, buttons: 2 })
		assert.deepEqual(h.scene.getCamera(), { x: 50, y: 0, scale: 1 }, 'the drag pans')
		h.pointer('pointercancel', 50, 100, { button: 2, buttons: 0 })
		h.pointer('pointermove', 0, 100, { button: -1, buttons: 0 })
		h.pointer('pointerup', 0, 100, { button: 2, buttons: 0 })
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: 50, y: 0, scale: 1 }, 'the pan ended at the pointercancel')
		assert.deepEqual(acts('gesture'), [true, false])
		assert.deepEqual(h.intents(), [])
	})

	test('a pointermove without the right button (buttons 0) after the press: no menu at a later pointerup; the wheel moves the camera again', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		setup()
		h.pointer('pointerdown', 100, 100, { button: 2, buttons: 2 })
		ctxMenu(100, 100)
		h.pointer('pointermove', 101, 100, { button: -1, buttons: 0 })
		h.pointer('pointerup', 101, 100, { button: 2, buttons: 0 })
		assert.deepEqual(h.intents(), [], 'no menu')
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 40, deltaMode: 0, clientX: 500, clientY: 400 })
		assert.equal(h.scene.stats().gestureActive, true, 'the wheel starts a gesture again')
		mock.timers.tick(500)
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 40, scale: 1 }, 'the wheel panned (stage auto, a trackpad-like event)')
	})

	test('a pointermove with buttons 0 during the drag ends the pan; later moves do not pan', () => {
		setup()
		h.pointer('pointerdown', 500, 400, { button: 2, buttons: 2 })
		h.pointer('pointermove', 450, 400, { button: -1, buttons: 2 })
		h.pointer('pointermove', 400, 400, { button: -1, buttons: 0 })
		h.pointer('pointermove', 300, 400, { button: -1, buttons: 0 })
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: 50, y: 0, scale: 1 })
		assert.deepEqual(acts('gesture'), [true, false])
		assert.deepEqual(h.intents(), [])
	})
})

describe('job 168 AK1: a right-drag of the pen pans like the mouse\'s', () => {
	for (const [name, dev] of [['button 2', PEN], ['button 0 with buttons 3', PEN_TIP]]) {
		for (const order of ['down', 'up']) {
			test(`${name}: empty canvas, note A, a handle of the selected A × select, sticky, connector (contextmenu after pointer${order})`, () => {
				for (const tool of ['select', 'sticky', 'connector']) {
					for (const start of ['empty', 'note', 'handle']) {
						const what = `${tool}, ${start}`
						setup()
						let p = start === 'empty' ? { x: 700, y: 600 } : { x: 100, y: 100 }
						if (start === 'handle') {
							h.scene.setSelection([A])
							h.frame()
							const br = h.scene.handles().find((x) => x.name === 'br')
							assert.ok(br, `${what}: the corner handle of A`)
							p = { x: br.x, y: br.y }
						}
						h.scene.setTool(tool)
						h.frame()
						const sel0 = h.scene.getSelection()
						const m0 = marquees()
						h.log.length = 0
						rDown(p.x, p.y, dev)
						const early = order === 'down' ? devMenu(p.x, p.y, dev) : null
						rMove(p.x + 10, p.y, dev)
						assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, `${what}: 10 px keep the camera`)
						for (let i = 1; i <= 10; i++) rMove(p.x - 20 * i, p.y - 10 * i, dev)
						rUp(p.x - 200, p.y - 100, dev)
						const late = order === 'up' ? devMenu(p.x - 200, p.y - 100, dev) : null
						h.frame()
						assert.equal((early ?? late).defaultPrevented, true, `${what}: contextmenu prevented`)
						assert.deepEqual(h.scene.getCamera(), { x: 200, y: 100, scale: 1 }, `${what}: the camera at (200, 100)`)
						assert.deepEqual(h.log, [
							['onActivity', { kind: 'gesture', active: true, ids: [] }],
							['onUserCamera'],
							['onActivity', { kind: 'gesture', active: false, ids: [] }],
						], `${what}: no intent, no onSelection, gesture on and off`)
						assert.equal(marquees(), m0, `${what}: no marquee`)
						assert.deepEqual(h.scene.getSelection(), sel0, `${what}: the selection stays`)
						assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [0, 0], `${what}: A did not move`)
						assert.equal(h.scene.getTool(), tool, `${what}: the tool stays`)
						h.restore()
						h = null
					}
				}
			})
		}
	}

	for (const mode of ['vote', 'view']) {
		test(`mode ${mode}: a pen right-drag pans the same; a pen right click gives no vote, voteMiss, camera change or menu, also on a small votable item`, () => {
			for (const dev of [PEN, PEN_TIP]) {
				setup({ mode })
				if (mode === 'vote') {
					h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
				}
				h.scene.setCamera({ x: 0, y: 0, scale: 2 })
				h.frame()
				h.log.length = 0
				const e = rightDrag(100, 100, -200, -100, { dev })
				assert.equal(e.defaultPrevented, true, 'contextmenu prevented')
				assert.deepEqual(h.scene.getCamera(), { x: 100, y: 50, scale: 2 }, 'the camera moved by (200, 100) / 2')
				assert.deepEqual(acts('gesture'), [true, false])
				assert.deepEqual(h.intents(), [])
				// scale 0.1: A covers container (10, 10)–(30, 30), a small target a pen tap would zoom to
				h.scene.setCamera({ x: -100, y: -100, scale: 0.1 })
				h.frame()
				h.log.length = 0
				const down = rightClick(20, 20, 'down', dev)
				const up = rightClick(22, 18, 'up', dev)
				assert.equal(down.defaultPrevented && up.defaultPrevented, true, 'both contextmenus prevented')
				assert.deepEqual(h.scene.getCamera(), { x: -100, y: -100, scale: 0.1 }, 'no camera change (no small-target zoom)')
				assert.deepEqual(h.intents(), [], 'no vote, no voteMiss, no contextMenu')
				assert.equal(h.log.filter((x) => x[0] === 'onUserCamera' || x[0] === 'onSelection').length, 0)
				h.restore()
				h = null
			}
		})
	}
})

describe('the text editor (job 156 AK6, job 168 AK4–AK6)', () => {
	/** @return {object} the editor's textarea */
	const editor = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
	/** @return {number[]} the editor's translate (container px) */
	const shift = () => (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(editor().style.getPropertyValue('transform')) ?? []).slice(1).map(Number)
	/** Devices beside the editor: the mouse in both contextmenu orders, the pen. */
	const BESIDE = [['mouse, contextmenu after pointerdown', MOUSE, 'down'], ['mouse, contextmenu after pointerup', MOUSE, 'up'], ['pen', PEN, 'down']]

	/** Opens A's editor and types into it. */
	function openTyped() {
		assert.equal(h.scene.openTextEditor(A), true)
		const ta = editor()
		ta.value = 'changed'
		dispatch(ta, 'input')
		h.frame()
		h.log.length = 0
	}

	for (const [name, dev, order] of BESIDE) {
		test(`job 168 AK4, ${name}: a right-drag beside the open editor pans and leaves it open with its focus and text; it moves with A; a left click beside it then commits once`, () => {
			setup()
			openTyped()
			const ta = editor()
			assert.equal(h.dom.doc.activeElement, ta, 'precondition: the text field has the focus')
			const t0 = shift()
			rDown(800, 600, dev)
			assert.equal(h.dom.doc.activeElement, ta, 'after the pointerdown the text field keeps the focus')
			const md = dispatch(h.container, 'mousedown', { clientX: 800, clientY: 600, button: dev.button })
			assert.equal(md.defaultPrevented, true, 'the compatibility mousedown is prevented (no browser focus change)')
			const early = order === 'down' ? devMenu(800, 600, dev) : null
			for (let i = 1; i <= 10; i++) rMove(800 - 20 * i, 600 - 10 * i, dev)
			rUp(600, 500, dev)
			const late = order === 'up' ? devMenu(600, 500, dev) : null
			h.frame()
			assert.deepEqual(h.scene.getCamera(), { x: 200, y: 100, scale: 1 })
			assert.equal(h.scene.stats().editing, A, 'the editor stays open')
			assert.equal(editor(), ta)
			assert.equal(ta.value, 'changed')
			assert.equal(h.dom.doc.activeElement, ta, 'after the pointerup the text field has the focus')
			assert.deepEqual(h.intents().filter((i) => i.type === 'text' && i.final === true), [], 'no final commit')
			assert.deepEqual(h.intents('contextMenu'), [], 'no menu')
			assert.equal((early ?? late).defaultPrevented, true, 'contextmenu prevented')
			const t1 = shift()
			assert.deepEqual([t1[0] - t0[0], t1[1] - t0[1]], [-200, -100], 'the editor moved by the way')
			h.log.length = 0
			h.pointer('pointerdown', 800, 600)
			h.pointer('pointerup', 800, 600)
			assert.deepEqual(h.intents().map((i) => [i.type, i.final, i.value]), [['text', true, 'changed']], 'a left click beside it: one final commit')
			assert.equal(h.scene.stats().editing, null)
		})
	}

	for (const dev of [MOUSE, PEN]) {
		test(`job 168 AK4, ${dev.pointerType}: a pointercancel or a move without a button after a right press beside the editor: open, no intent, no menu`, () => {
			setup()
			openTyped()
			const ta = editor()
			rDown(800, 600, dev)
			devMenu(800, 600, dev)
			rUp(800, 600, dev, 'pointercancel')
			rUp(800, 600, dev)
			rDown(800, 600, dev)
			devMenu(800, 600, dev)
			h.pointer('pointermove', 801, 600, { ...dev, button: -1, buttons: 0 })
			rUp(801, 600, dev)
			h.frame()
			assert.equal(h.scene.stats().editing, A)
			assert.equal(ta.value, 'changed')
			assert.equal(h.dom.doc.activeElement, ta)
			assert.deepEqual(h.intents(), [])
		})
	}

	for (const [name, dev, order] of BESIDE) {
		test(`job 168 AK5, ${name}: a right click beside the open editor: open until the pointerup, then its final commit and one menu at the release point; the canvas has the focus`, () => {
			setup()
			openTyped()
			const ta = editor()
			rDown(800, 600, dev)
			const early = order === 'down' ? devMenu(800, 600, dev) : null
			rMove(802, 601, dev)
			assert.equal(h.scene.stats().editing, A, 'open after the pointerdown and the contextmenu')
			assert.equal(h.dom.doc.activeElement, ta)
			assert.deepEqual(h.intents(), [], 'no intent before the release')
			rUp(802, 601, dev)
			const late = order === 'up' ? devMenu(802, 601, dev) : null
			assert.equal((early ?? late).defaultPrevented, true)
			assert.deepEqual(h.intents().map((i) => i.type), ['text', 'contextMenu'])
			assert.deepEqual([h.intents('text')[0].final, h.intents('text')[0].value], [true, 'changed'])
			assert.deepEqual(h.intents('contextMenu'), [{ type: 'contextMenu', id: null, at: [802, 601] }])
			assert.equal(h.scene.stats().editing, null)
			assert.equal(h.dom.doc.activeElement, h.container, 'the canvas has the focus')
		})
	}

	for (const dev of [MOUSE, PEN]) {
		test(`job 168 AK5, ${dev.pointerType}: mode vote (the editor opened before the switch): a right click on B beside it commits, no menu, no vote`, () => {
			setup()
			openTyped()
			h.scene.setMode('vote')
			h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
			assert.equal(h.scene.stats().editing, A, 'precondition: the editor is still open in mode vote')
			h.log.length = 0
			rDown(400, 100, dev)
			devMenu(400, 100, dev)
			assert.deepEqual(h.intents(), [])
			rUp(400, 100, dev)
			assert.deepEqual(h.intents().map((i) => [i.type, i.final, i.value]), [['text', true, 'changed']], 'the commit, no menu, no vote')
			assert.equal(h.scene.stats().editing, null)
		})
	}

	for (const dev of [MOUSE, PEN]) {
		test(`job 168 AK6, ${dev.pointerType}: a right press into the editor: no pan, no preventDefault, the editor stays open with its text`, () => {
			setup()
			openTyped()
			const ta = editor()
			const down = dispatch(ta, 'pointerdown', { clientX: 100, clientY: 100, ...dev })
			const md = dispatch(ta, 'mousedown', { clientX: 100, clientY: 100, button: 2 })
			const menu = ctxMenu(100, 100, { target: ta, pointerType: dev.pointerType, pointerId: dev.pointerId })
			for (const x of [80, 40, 0]) dispatch(ta, 'pointermove', { clientX: x, clientY: 100, ...dev, button: -1 })
			const up = dispatch(ta, 'pointerup', { clientX: 0, clientY: 100, ...dev, buttons: 0 })
			h.frame()
			assert.deepEqual([down.defaultPrevented, md.defaultPrevented, menu.defaultPrevented, up.defaultPrevented], [false, false, false, false])
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
			assert.equal(h.scene.stats().editing, A)
			assert.equal(editor().value, 'changed')
			assert.deepEqual(h.intents(), [])
		})
	}

	test('job 168 AK6: the mousedown of a press into the editor after a right press beside it (whose own mousedown never came) is not prevented', () => {
		setup()
		openTyped()
		const ta = editor()
		rightDrag(800, 600, -50, 0, { dev: PEN })
		dispatch(ta, 'pointerdown', { clientX: 100, clientY: 100, pointerType: 'mouse', pointerId: 1 })
		const md = dispatch(ta, 'mousedown', { clientX: 100, clientY: 100, button: 0 })
		assert.equal(md.defaultPrevented, false)
		assert.equal(h.scene.stats().editing, A)
	})

	test('job 168 AK6: a middle-button press beside the editor still ends it at the pointerdown with its commit and pans', () => {
		setup()
		openTyped()
		h.pointer('pointerdown', 800, 600, { button: 1, buttons: 4 })
		assert.deepEqual(h.intents().map((i) => [i.type, i.final, i.value]), [['text', true, 'changed']], 'committed at the pointerdown')
		assert.equal(h.scene.stats().editing, null)
		for (let i = 1; i <= 10; i++) h.pointer('pointermove', 800 - 20 * i, 600 - 10 * i, { button: -1, buttons: 4 })
		h.pointer('pointerup', 600, 500, { button: 1, buttons: 0 })
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: 200, y: 100, scale: 1 })
		assert.equal(h.intents().length, 1)
	})
})
