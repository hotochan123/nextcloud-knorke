/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Keys v2 of the scene (SPEC-M1 §6.3, §6.10, §8.2 (1a)), deterministic in
 * Node on the fake DOM with the real SceneManager and InputController:
 * - focus rule (WCAG 2.1.4): single keys only with the canvas focus; Ctrl/⌘
 *   combinations and Esc window wide; a click on the canvas focuses it, in
 *   mode edit a tap too (R9; not in vote/view);
 *   mount() gives the container tabindex 0 when the host did not
 * - arrows (1, Shift × 10) → move intent with origin and nudge
 * - Ctrl/⌘+C/X/D → copy/cut/duplicate synchronously with preventDefault,
 *   NOT with a DOM text selection (no intent, no preventDefault)
 * - Ctrl/⌘(+Shift)+V → pasteKey synchronously WITHOUT preventDefault
 * - Tab / Shift+Tab: reading order (frames first, then y, x on a 10-unit
 *   grid, then z), leaving the canvas after the last item, panning into view
 * - Enter opens the editor of one selected item with text
 * - Shift+2 zooms to the selection without the 100 % limit; onUserCamera for
 *   key and gesture camera changes, never for the facade's setCamera/fit/zoomBy
 * - tool keys from the TOOLS table (S, T; L waits for round 1b)
 * - Esc on the canvas host works even when a window listener before the
 *   scene cancelled it, as Nextcloud's header menus do for every Esc
 *   (NcHeaderMenu, useHotKey('Escape', …, { prevent: true })); every other
 *   cancelled key, and Esc elsewhere, stays with that listener
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { frameItem, note, setupScene, shapeItem, textItem } from './sceneHarness.mjs'
import { ignoresShortcuts } from '../../../src/scene/InputController.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const F = '01JA0000000000000000000009'

let h
afterEach(() => {
	h?.restore()
	h = null
})

describe('focus rule', () => {
	test('mount gives the container tabindex 0; an existing tabindex stays', () => {
		h = setupScene([note(A)])
		assert.equal(h.container.getAttribute('tabindex'), '0')
		h.restore()
		h = null
	})

	test('single keys need the canvas focus; with it they work', () => {
		h = setupScene([note(A)])
		h.scene.setSelection([A])
		const body = h.dom.doc.body
		h.key('n', { target: body })
		h.key('Delete', { target: body })
		h.key('ArrowLeft', { target: body })
		assert.equal(h.scene.getTool(), 'select', 'N without focus: no tool')
		assert.deepEqual(h.intents(), [], 'Delete/arrows without focus: no intent')
		h.focusCanvas()
		assert.equal(h.dom.doc.activeElement, h.container)
		h.key('n')
		assert.equal(h.scene.getTool(), 'sticky')
		assert.deepEqual(h.log.filter((e) => e[0] === 'onTool').map((e) => e[1]), ['sticky'])
	})

	test('a click on the canvas focuses it (mouse), then single keys work', () => {
		h = setupScene([note(A)])
		assert.notEqual(h.dom.doc.activeElement, h.container)
		h.pointer('pointerdown', 600, 600)
		h.pointer('pointerup', 600, 600)
		assert.equal(h.dom.doc.activeElement, h.container)
		h.key('s')
		assert.equal(h.scene.getTool(), 'shape')
	})

	// (R9) SPEC-M1 §6.3: in mode edit a tap focuses the canvas too
	// (focus({preventScroll:true}) on the tabindex div opens no on-screen
	// keyboard); in the modes vote and view a finger keeps today's behaviour.
	const tap = (x, y, props = {}) => {
		h.pointer('pointerdown', x, y, { pointerType: 'touch', pointerId: 5, ...props })
		h.pointer('pointerup', x, y, { pointerType: 'touch', pointerId: 5, ...props })
	}
	const blurCanvas = () => {
		h.dom.doc.focusOn(h.dom.doc.body)
		assert.notEqual(h.dom.doc.activeElement, h.container)
	}

	test('(R9) a tap focuses the canvas in mode edit: empty canvas and item, then single keys work', () => {
		h = setupScene([note(A)])
		assert.notEqual(h.dom.doc.activeElement, h.container)
		tap(600, 600)
		assert.equal(h.dom.doc.activeElement, h.container, 'tap on the empty canvas (unclaimed finger) focuses')
		h.key('s')
		assert.equal(h.scene.getTool(), 'shape', 'single key after the tap')
		h.scene.setTool('select')
		blurCanvas()
		tap(100, 100)
		assert.equal(h.dom.doc.activeElement, h.container, 'tap on an item (claimed finger) focuses')
		assert.deepEqual(h.scene.getSelection(), [A], 'the tap still selects')
		h.key('Delete')
		assert.deepEqual(h.intents().map((i) => i.type), ['delete'], 'Delete after the tap')
		blurCanvas()
		h.pointer('pointerdown', 600, 600, { pointerType: 'touch', pointerId: 6 })
		assert.equal(h.dom.doc.activeElement, h.container, 'already on pointerdown (a pan start too)')
		h.pointer('pointercancel', 600, 600, { pointerType: 'touch', pointerId: 6 })
	})

	for (const mode of ['vote', 'view']) {
		test(`(R9) a finger in mode ${mode} does not focus the canvas; mouse and pen still do`, () => {
			h = setupScene([note(A)], { scene: { mode } })
			tap(600, 600)
			assert.notEqual(h.dom.doc.activeElement, h.container, `${mode}: tap on the empty canvas`)
			tap(100, 100)
			assert.notEqual(h.dom.doc.activeElement, h.container, `${mode}: tap on an item`)
			h.pointer('pointerdown', 600, 600)
			h.pointer('pointerup', 600, 600)
			assert.equal(h.dom.doc.activeElement, h.container, `${mode}: mouse unchanged`)
			blurCanvas()
			h.pointer('pointerdown', 600, 600, { pointerType: 'pen', pointerId: 3 })
			h.pointer('pointerup', 600, 600, { pointerType: 'pen', pointerId: 3 })
			assert.equal(h.dom.doc.activeElement, h.container, `${mode}: pen unchanged`)
		})
	}

	test('(R9) the touch rule follows the runtime mode (setViewOnly); pen in edit unchanged', () => {
		h = setupScene([note(A)])
		h.scene.setViewOnly(true)
		tap(600, 600)
		assert.notEqual(h.dom.doc.activeElement, h.container, 'view-only at runtime: no focus by touch')
		h.scene.setViewOnly(false)
		tap(600, 600)
		assert.equal(h.dom.doc.activeElement, h.container, 'back in edit: the tap focuses')
		blurCanvas()
		h.pointer('pointerdown', 600, 600, { pointerType: 'pen', pointerId: 3 })
		h.pointer('pointerup', 600, 600, { pointerType: 'pen', pointerId: 3 })
		assert.equal(h.dom.doc.activeElement, h.container, 'pen in edit unchanged')
	})

	test('(R9) a touch on the open editor keeps its focus; a tap beside it ends it with the final commit, like a click', () => {
		h = setupScene([note(A)])
		assert.equal(h.scene.openTextEditor(A), true)
		const ta = h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
		assert.ok(ta, 'editor open')
		assert.equal(h.dom.doc.activeElement, ta)
		h.pointer('pointerdown', 50, 50, { pointerType: 'touch', pointerId: 5, target: ta })
		h.pointer('pointerup', 50, 50, { pointerType: 'touch', pointerId: 5, target: ta })
		assert.equal(h.dom.doc.activeElement, ta, 'a finger on the editor (interactive target) does not steal its focus')
		assert.equal(ta.isConnected, true)
		ta.value = 'typed by touch'
		dispatch(ta, 'input')
		tap(600, 600)
		assert.equal(ta.isConnected, false, 'the tap beside the editor ended it')
		const finals = h.intents('text').filter((i) => i.final)
		assert.deepEqual(finals.map((i) => [i.id, i.value]), [[A, 'typed by touch']], 'nothing typed is lost')
		assert.equal(h.dom.doc.activeElement, h.container, 'the canvas has the focus afterwards')
	})

	test('Ctrl/⌘ combinations and Esc stay window wide; text fields keep their keys', () => {
		h = setupScene([note(A)])
		h.scene.setSelection([A])
		const body = h.dom.doc.body
		h.key('z', { ctrlKey: true, target: body })
		h.key('c', { metaKey: true, target: body })
		assert.deepEqual(h.intents().map((i) => i.type), ['undo', 'copy'])
		h.key('Escape', { target: body })
		assert.deepEqual(h.scene.getSelection(), [])
		const input = h.dom.doc.createElement('input')
		input.type = 'text'
		h.dom.doc.body.appendChild(input)
		h.scene.setSelection([A])
		h.key('c', { ctrlKey: true, target: input })
		h.key('v', { ctrlKey: true, target: input })
		assert.equal(h.intents().length, 2, 'no copy/paste intent from a text field')
		assert.ok(ignoresShortcuts(input))
	})

	test('tool keys come from the TOOLS table: S shape, T text, F frame, H hand, V select, L connector (1b)', () => {
		h = setupScene([note(A)])
		h.focusCanvas()
		const seen = []
		for (const k of ['s', 't', 'f', 'h', 'v', 'l']) {
			h.key(k)
			seen.push(h.scene.getTool())
		}
		assert.deepEqual(seen, ['shape', 'text', 'frame', 'hand', 'select', 'connector'])
	})

	test('view-only: create tools refused, select/hand allowed', () => {
		h = setupScene([note(A)], { scene: { viewOnly: true } })
		h.focusCanvas()
		h.key('n')
		assert.equal(h.scene.getTool(), 'select')
		h.key('h')
		assert.equal(h.scene.getTool(), 'hand')
	})
})

describe('Esc after a header menu of Nextcloud (NcHeaderMenu) cancelled it', () => {
	/**
	 * A window keydown listener registered BEFORE the scene's, like the header
	 * menus of Nextcloud: preventDefault on every Esc outside text fields.
	 *
	 * @return {object[]} the events it saw
	 */
	const headerMenu = () => {
		const seen = []
		window.listeners.get('keydown').unshift((e) => {
			seen.push(e)
			if (e.key === 'Escape' && !ignoresShortcuts(e.target)) e.preventDefault()
		})
		return seen
	}

	test('Esc with the canvas focus clears the selection although the header menu called preventDefault first', () => {
		h = setupScene([note(A), note(B, { x: 300 })])
		const seen = headerMenu()
		h.scene.setSelection([A, B])
		h.focusCanvas()
		h.log.length = 0
		const e = h.key('Escape')
		assert.equal(seen.length, 1, 'the header menu ran first')
		assert.equal(e.defaultPrevented, true, 'cancelled by the header menu')
		assert.deepEqual(h.scene.getSelection(), [], 'the selection is cleared all the same')
		assert.deepEqual(h.log.filter((x) => x[0] === 'onSelection').map((x) => x[1]), [[]])
		// held: the auto-repeat changes nothing more (the real header menu skips
		// repeats through useHotKey's dedupe; this stand-in cancels them as well)
		h.scene.setSelection([A])
		h.focusCanvas()
		h.key('Escape')
		h.key('Escape', { repeat: true })
		assert.deepEqual(h.scene.getSelection(), [])
		// Shift+Esc clears as well
		h.scene.setSelection([B])
		h.focusCanvas()
		h.key('Escape', { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [])
	})

	test('Esc with the canvas focus still cancels a running transform after the header menu cancelled it', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		headerMenu()
		h.scene.setSelection([A])
		h.focusCanvas()
		h.pointer('pointerdown', 300, 220)
		h.pointer('pointermove', 360, 260)
		h.frame()
		assert.equal(h.model.get(A).w, 260)
		assert.equal(h.key('Escape').defaultPrevented, true)
		h.pointer('pointerup', 360, 260)
		assert.equal(h.model.get(A).w, 200, 'model back')
		assert.deepEqual(h.intents('transform'), [])
		assert.deepEqual(h.scene.getSelection(), [A], 'Esc cancelled the press and kept the selection')
	})

	test('a cancelled Esc elsewhere (body, a text field, the text editor) and every other cancelled key on the canvas stay with that listener', () => {
		h = setupScene([note(A), note(B, { x: 300 })])
		headerMenu()
		h.scene.setSelection([A])
		h.key('Escape', { target: h.dom.doc.body })
		assert.deepEqual(h.scene.getSelection(), [A], 'Esc on <body>: left to the listener that cancelled it')
		// another listener cancels Delete and N on the canvas: the scene does nothing
		window.listeners.get('keydown').unshift((e) => {
			if (e.key === 'Delete' || e.key === 'n') e.preventDefault()
		})
		h.focusCanvas()
		h.key('Delete')
		h.key('n')
		assert.deepEqual(h.intents(), [], 'no delete intent')
		assert.equal(h.scene.getTool(), 'select', 'no tool switch')
		// the text editor: its own Esc ends it, the scene's rule does not apply (textarea)
		h.scene.setSelection([B])
		h.focusCanvas()
		h.key('Enter')
		const ta = h.dom.doc.activeElement
		assert.notEqual(ta, h.container, 'the editor has the focus')
		assert.equal(ignoresShortcuts(ta), true)
		h.key('Escape', { target: ta })
		assert.equal(h.scene.stats().editing, null, 'the editor ended itself')
		assert.deepEqual(h.scene.getSelection(), [B], 'and the scene did not clear the selection')
	})
})

describe('arrows, Delete, Enter', () => {
	test('arrows move the top-level selection by 1, Shift by 10, with origin; nudge marks the series', () => {
		h = setupScene([frameItem(F), note(A, { x: 10, y: 20, parent: F }), note(B, { x: 400, y: 50 })])
		h.scene.setSelection([F, A])
		h.focusCanvas()
		const e1 = h.key('ArrowRight')
		const e2 = h.key('ArrowUp', { shiftKey: true })
		assert.ok(e1.defaultPrevented && e2.defaultPrevented)
		const [m1, m2] = h.intents('move')
		assert.deepEqual([m1.ids, m1.dx, m1.dy, m1.nudge], [[F], 1, 0, true], 'the child follows its frame')
		assert.deepEqual([m2.dx, m2.dy], [0, -10])
		assert.deepEqual(m1.origin.get(F), { x: 0, y: 0, parent: null })
		assert.ok(m1.origin instanceof Map)
	})

	test('arrows without a selection or in view-only mode: no intent', () => {
		h = setupScene([note(A)])
		h.focusCanvas()
		h.key('ArrowLeft')
		h.scene.setSelection([A])
		h.scene.setViewOnly(true)
		h.key('ArrowLeft')
		assert.deepEqual(h.intents(), [])
	})

	test('Delete/Backspace delete the selection (canvas focus)', () => {
		h = setupScene([note(A), note(B, { x: 300 })])
		h.scene.setSelection([A, B])
		h.focusCanvas()
		h.key('Backspace')
		assert.deepEqual(h.intents('delete').map((i) => i.ids), [[A, B]])
	})

	test('Enter opens the editor of exactly one selected item with text', () => {
		h = setupScene([note(A), shapeItem(B, { x: 300 }), textItem(C, { x: 600 })])
		h.focusCanvas()
		h.scene.setSelection([A, B])
		h.key('Enter')
		assert.equal(h.scene.stats().editing, null)
		for (const id of [B, C]) {
			h.scene.setSelection([id])
			h.focusCanvas()
			const e = h.key('Enter')
			assert.ok(e.defaultPrevented)
			assert.equal(h.scene.stats().editing, id)
			h.key('Escape', { target: h.dom.doc.activeElement })
		}
	})
})

describe('clipboard keys', () => {
	test('Ctrl/⌘+C/X/D: intents synchronously in the keydown, with preventDefault', () => {
		h = setupScene([note(A)])
		h.scene.setSelection([A])
		h.focusCanvas()
		const seen = []
		for (const [k, mod] of [['c', 'ctrlKey'], ['x', 'metaKey'], ['d', 'ctrlKey']]) {
			const before = h.intents().length
			const e = dispatch(h.container, 'keydown', { key: k, [mod]: true })
			seen.push([h.intents().slice(before).map((i) => i.type).join(), e.defaultPrevented])
		}
		assert.deepEqual(seen, [['copy', true], ['cut', true], ['duplicate', true]])
	})

	test('a DOM text selection wins: no intent, no preventDefault (the browser copies the text)', () => {
		h = setupScene([note(A)])
		h.scene.setSelection([A])
		globalThis.window.getSelection = () => ({ isCollapsed: false, toString: () => 'Board title' })
		try {
			for (const k of ['c', 'x', 'd']) {
				const e = h.key(k, { ctrlKey: true, target: h.dom.doc.body })
				assert.equal(e.defaultPrevented, false, k)
			}
			assert.deepEqual(h.intents(), [])
			globalThis.window.getSelection = () => ({ isCollapsed: true })
			h.key('c', { ctrlKey: true, target: h.dom.doc.body })
			assert.deepEqual(h.intents().map((i) => i.type), ['copy'])
		} finally {
			delete globalThis.window.getSelection
		}
	})

	test('nothing selected: no intent and no preventDefault; view-only: copy only', () => {
		h = setupScene([note(A)])
		h.focusCanvas()
		assert.equal(h.key('c', { ctrlKey: true }).defaultPrevented, false)
		h.scene.setSelection([A])
		h.scene.setViewOnly(true)
		h.key('c', { ctrlKey: true })
		assert.equal(h.key('x', { ctrlKey: true }).defaultPrevented, false)
		h.key('d', { ctrlKey: true })
		h.key('v', { ctrlKey: true })
		assert.deepEqual(h.intents().map((i) => i.type), ['copy'])
	})

	test('Ctrl/⌘+V → pasteKey synchronously and WITHOUT preventDefault; Shift = in place', () => {
		h = setupScene([note(A)])
		const order = []
		h.log.length = 0
		const e1 = dispatch(h.dom.doc.body, 'keydown', { key: 'v', ctrlKey: true })
		order.push(h.intents().length)
		const e2 = dispatch(h.container, 'keydown', { key: 'V', metaKey: true, shiftKey: true })
		assert.deepEqual(order, [1], 'the intent is there before dispatch returns')
		assert.equal(e1.defaultPrevented, false)
		assert.equal(e2.defaultPrevented, false)
		assert.deepEqual(h.intents('pasteKey'), [{ type: 'pasteKey', inPlace: false }, { type: 'pasteKey', inPlace: true }])
	})
})

describe('Tab selection', () => {
	const items = () => [
		note(A, { x: 500, y: 10, z: 'a5' }), // content row 0 (cy 110), right
		note(B, { x: 100, y: 14, z: 'a6' }), // same row on the 10-grid (cy 114 → 11), left
		frameItem(F, { x: 2000, y: 3000, w: 400, h: 300 }), // frame: first despite its position
		note(C, { x: 100, y: 400, z: 'a7' }), // next row
	]

	test('frames first, then content by y, then x (10-unit grid), then z; after the last Tab leaves the canvas', () => {
		h = setupScene(items())
		h.focusCanvas()
		const order = []
		let left = false
		for (let i = 0; i < 6 && !left; i++) {
			const e = h.key('Tab')
			if (!e.defaultPrevented) left = true
			else order.push(h.scene.getSelection()[0])
		}
		assert.deepEqual(order, [F, B, A, C])
		assert.ok(left, 'Tab after the last item is not prevented (no keyboard trap)')
		assert.deepEqual(h.scene.getSelection(), [C], 'the selection stays on the last item')
		assert.ok(h.log.filter((e) => e[0] === 'onSelection').length >= 4)
	})

	test('Shift+Tab goes backwards and leaves before the first; without items Tab leaves at once', () => {
		h = setupScene(items())
		h.focusCanvas()
		h.scene.setSelection([A])
		assert.ok(h.key('Tab', { shiftKey: true }).defaultPrevented)
		assert.deepEqual(h.scene.getSelection(), [B])
		h.key('Tab', { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [F])
		assert.equal(h.key('Tab', { shiftKey: true }).defaultPrevented, false)
		h.restore()
		h = setupScene([])
		h.focusCanvas()
		assert.equal(h.key('Tab').defaultPrevented, false)
	})

	test('an item outside the viewport is panned into view (user camera change)', () => {
		h = setupScene(items())
		h.focusCanvas()
		h.key('Tab')
		h.frame()
		const cam = h.scene.getCamera()
		assert.equal(cam.scale, 1)
		assert.deepEqual([cam.x, cam.y], [2200 - 500, 3150 - 400], 'frame F centred')
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 1)
		h.key('Tab')
		h.frame()
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 2, 'B was off screen as well')
	})

	test('Tab in view-only mode or without canvas focus is not handled', () => {
		h = setupScene(items())
		assert.equal(h.key('Tab', { target: h.dom.doc.body }).defaultPrevented, false)
		h.scene.setViewOnly(true)
		h.focusCanvas()
		assert.equal(h.key('Tab').defaultPrevented, false)
	})
})

describe('camera keys and onUserCamera', () => {
	test('+/−, Shift+0, Shift+1 change the camera and report onUserCamera once each', () => {
		h = setupScene([note(A), note(B, { x: 3000, y: 2000 })])
		h.focusCanvas()
		h.key('+')
		h.frame()
		assert.equal(h.scene.getCamera().scale, 1.25)
		h.key('-')
		h.key('-')
		h.frame()
		assert.ok(Math.abs(h.scene.getCamera().scale - 0.8) < 1e-9)
		h.key(')', { shiftKey: true, code: 'Digit0' })
		h.frame()
		assert.ok(Math.abs(h.scene.getCamera().scale - 1) < 1e-9)
		h.key('!', { shiftKey: true, code: 'Digit1' })
		h.frame()
		assert.ok(h.scene.getCamera().scale < 1)
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 5)
	})

	test('the facade never reports onUserCamera (setCamera, fit, zoomBy)', () => {
		h = setupScene([note(A)])
		h.scene.setCamera({ x: 5, y: 5, scale: 2 })
		h.scene.fit()
		h.scene.zoomBy(1.5)
		h.frame()
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 0)
	})

	test('Shift+2 zooms to the selection with a 40 px margin, beyond 100 %; nothing without a selection', () => {
		h = setupScene([note(A, { x: 1000, y: 1000, w: 92, h: 72 })])
		h.focusCanvas()
		h.key('@', { shiftKey: true, code: 'Digit2' })
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		h.scene.setSelection([A])
		h.key('@', { shiftKey: true, code: 'Digit2' })
		h.frame()
		const c = h.scene.getCamera()
		assert.equal(Math.min(920 / 92, 720 / 72), 10, 'the 40 px margin asks for 1000 %')
		assert.equal(c.scale, 4, '… clamped to MAX_SCALE, far beyond the 100 % of fit()')
		assert.ok(Math.abs(c.x + 500 / 4 - 1046) < 1e-9 && Math.abs(c.y + 400 / 4 - 1036) < 1e-9, 'selection centred')
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 1)
	})

	test('(stage 3) a camera key during a wheel gesture works on the camera the user sees: the gesture ends first, its way is kept', () => {
		h = setupScene([note(A), note(B, { x: 3000, y: 2000 })])
		h.focusCanvas()
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 30, deltaMode: 0, ctrlKey: false })
		assert.equal(h.scene.stats().gestureActive, true)
		h.key('+')
		h.frame()
		const c = h.scene.getCamera()
		assert.equal(h.scene.stats().gestureActive, false)
		assert.equal(c.scale, 1.25)
		assert.ok(Math.abs(c.x + 500 / 1.25 - 500) < 1e-9 && Math.abs(c.y + 400 / 1.25 - 430) < 1e-9, 'zoomed around the centre of the wheel camera')
		h.scene.setSelection([B])
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 30, deltaMode: 0, ctrlKey: false })
		h.key('@', { shiftKey: true, code: 'Digit2' })
		h.frame()
		const s2 = h.scene.getCamera()
		assert.ok(Math.abs(s2.x + 500 / s2.scale - 3100) < 1e-9 && Math.abs(s2.y + 400 / s2.scale - 2100) < 1e-9, 'Shift+2 still centres the selection')
		assert.equal(h.scene.stats().gestureActive, false)
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 4, 'two wheel gestures, two keys')
	})

	test('cameraForRect has no 100 % limit and keeps the rect centred', () => {
		h = setupScene([])
		const c = h.scene.cameraForRect({ x: 0, y: 0, w: 250, h: 200 }, 0)
		assert.equal(c.scale, 4)
		assert.deepEqual([c.x, c.y], [125 - 500 / 4, 100 - 400 / 4])
	})

	test('a wheel gesture and a hand-tool pan report onUserCamera once each', () => {
		h = setupScene([note(A)])
		const wheel = () => dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 30, deltaMode: 0, ctrlKey: false })
		wheel()
		wheel()
		wheel()
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 1)
		h.scene.setTool('hand')
		h.pointer('pointerdown', 500, 400)
		h.pointer('pointermove', 450, 400)
		h.pointer('pointermove', 400, 400)
		h.pointer('pointerup', 400, 400)
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 2)
	})
})

describe('Space', () => {
	test('Space pans only with the canvas focus', () => {
		h = setupScene([note(A)])
		const e = h.key(' ', { code: 'Space', target: h.dom.doc.body })
		assert.equal(e.defaultPrevented, false)
		h.focusCanvas()
		const e2 = dispatch(h.container, 'keydown', { key: ' ', code: 'Space' })
		assert.ok(e2.defaultPrevented)
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'grab')
		dispatch(h.container, 'keyup', { key: ' ', code: 'Space' })
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'default')
	})
})

describe('lock key (job 023, M2 R20)', () => {
	test('Ctrl+Shift+L and ⌘+Shift+L → intent toggleLock with preventDefault, window wide (outside text fields)', () => {
		h = setupScene([note(A)])
		h.scene.setSelection([A])
		const e1 = dispatch(h.dom.doc.body, 'keydown', { key: 'L', ctrlKey: true, shiftKey: true })
		const e2 = dispatch(h.container, 'keydown', { key: 'L', metaKey: true, shiftKey: true })
		assert.equal(e1.defaultPrevented, true)
		assert.equal(e2.defaultPrevented, true)
		assert.deepEqual(h.intents('toggleLock'), [{ type: 'toggleLock' }, { type: 'toggleLock' }])
		// a plain Ctrl+L (no Shift) is not ours
		const e3 = dispatch(h.container, 'keydown', { key: 'l', ctrlKey: true })
		assert.equal(e3.defaultPrevented, false)
		assert.equal(h.intents('toggleLock').length, 2)
		// in a text field the key stays the field's
		const input = h.dom.doc.createElement('input')
		h.dom.doc.body.appendChild(input)
		const e4 = dispatch(input, 'keydown', { key: 'L', ctrlKey: true, shiftKey: true })
		assert.equal(e4.defaultPrevented, false)
		assert.equal(h.intents('toggleLock').length, 2)
	})

	test('no intent in modes vote and view or during a press; preventDefault always', () => {
		h = setupScene([note(A)])
		h.scene.setSelection([A])
		for (const mode of ['vote', 'view']) {
			h.scene.setMode(mode)
			const e = dispatch(h.container, 'keydown', { key: 'L', ctrlKey: true, shiftKey: true })
			assert.equal(e.defaultPrevented, true, mode)
		}
		assert.deepEqual(h.intents('toggleLock'), [])
		h.scene.setMode('edit')
		h.pointer('pointerdown', 100, 100)
		const e = dispatch(h.container, 'keydown', { key: 'L', ctrlKey: true, shiftKey: true })
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(h.intents('toggleLock'), [], 'not during a press')
		h.pointer('pointerup', 100, 100)
		dispatch(h.container, 'keydown', { key: 'L', ctrlKey: true, shiftKey: true })
		assert.deepEqual(h.intents('toggleLock'), [{ type: 'toggleLock' }])
	})
})

describe('group keys (job 026, M2 R20 Gruppieren)', () => {
	test('AK7: Ctrl+G and ⌘+G → intent group, Ctrl+Shift+G and ⌘+Shift+G → ungroup, always with preventDefault (the browser would find on); a text field keeps them', () => {
		h = setupScene([note(A), note(B, { x: 300 })])
		h.scene.setSelection([A, B])
		const e1 = dispatch(h.dom.doc.body, 'keydown', { key: 'g', ctrlKey: true })
		const e2 = dispatch(h.container, 'keydown', { key: 'g', metaKey: true })
		const e3 = dispatch(h.container, 'keydown', { key: 'G', ctrlKey: true, shiftKey: true })
		const e4 = dispatch(h.container, 'keydown', { key: 'G', metaKey: true, shiftKey: true })
		assert.deepEqual([e1, e2, e3, e4].map((e) => e.defaultPrevented), [true, true, true, true])
		assert.deepEqual(h.intents('group'), [{ type: 'group' }, { type: 'group' }], 'window wide, like Ctrl+Z')
		assert.deepEqual(h.intents('ungroup'), [{ type: 'ungroup' }, { type: 'ungroup' }])
		const e5 = dispatch(h.container, 'keydown', { key: 'g', ctrlKey: true, altKey: true })
		assert.equal(e5.defaultPrevented, false, 'Ctrl+Alt+G is not ours')
		const input = h.dom.doc.createElement('input')
		h.dom.doc.body.appendChild(input)
		const e6 = dispatch(input, 'keydown', { key: 'g', ctrlKey: true })
		assert.equal(e6.defaultPrevented, false)
		assert.equal(h.intents('group').length, 2)
	})

	test('AK7: no intent in modes vote and view or during a press, preventDefault anyway; G alone still switches the grid', () => {
		h = setupScene([note(A), note(B, { x: 300 })])
		h.scene.setSelection([A, B])
		for (const mode of ['vote', 'view']) {
			h.scene.setMode(mode)
			assert.equal(dispatch(h.container, 'keydown', { key: 'g', ctrlKey: true }).defaultPrevented, true, mode)
			assert.equal(dispatch(h.container, 'keydown', { key: 'G', ctrlKey: true, shiftKey: true }).defaultPrevented, true, mode)
		}
		assert.deepEqual([h.intents('group'), h.intents('ungroup')], [[], []])
		h.scene.setMode('edit')
		h.pointer('pointerdown', 100, 100)
		assert.equal(dispatch(h.container, 'keydown', { key: 'g', ctrlKey: true }).defaultPrevented, true)
		assert.deepEqual(h.intents('group'), [], 'not during a press')
		h.pointer('pointerup', 100, 100)
		h.focusCanvas()
		const grid = h.scene.getGrid()
		h.key('g')
		assert.equal(h.scene.getGrid(), !grid, 'G alone: the grid (R12)')
		assert.deepEqual(h.intents('group'), [])
	})
})
