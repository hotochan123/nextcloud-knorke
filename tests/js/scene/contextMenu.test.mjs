/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Intent contextMenu of the scene (SPEC-M1 §9.5 WP-S4 (R16), §27 point 2e;
 * frozen in stage 4, phase 0, step 4.2), deterministic in Node on the fake
 * DOM with the real SceneManager, InputController, GestureController and
 * TextEditor and the recording renderer stub of sceneHarness.mjs:
 * - pointer path (the canvas's contextmenu event): an item outside the
 *   selection is selected first (onSelection before onIntent), an item
 *   inside keeps the selection, a transformer handle keeps it too, empty
 *   canvas clears it (id null); at = the event point in container px; the
 *   order down → contextmenu → up (Linux, macOS) and down → up →
 *   contextmenu (Windows) give the same; preventDefault
 * - macOS Ctrl+click and a pen held still (contextmenu after a button-0
 *   pointerdown): the press is dropped, no drag, no marquee, nothing created,
 *   the tool stays; a pen's barrel button works like a right click
 * - keyboard path: Shift+F10 and the ContextMenu key with the canvas focus →
 *   id = the last selected item or null, at = the midpoint of the selection's
 *   screen box clamped into the container (the container centre without a
 *   selection); the key's echo (a contextmenu without a pointerdown) and a
 *   synthetic one give no second intent
 * - never: without canvas focus (keys), in modes view and vote, for a finger
 *   (long press), while a text editor is open or on the editor (no
 *   preventDefault there: the browser's menu stays), during a moved press,
 *   a mouse pan or a finger below the tap threshold; a wheel gesture or a
 *   follow glide ends first
 * - a right-button press starts no pan, marquee or drag; the existing
 *   intents are unchanged
 * - (stage 4, phase 1: the gaps the mutation probes of WP-S4 found, the
 *   contract unchanged) one pointerdown opens at most one menu (rule 3); the
 *   event's pointerType wins over the pointerdown's (rule 4); a running touch
 *   gesture blocks a mouse right click (rule 5); on a handle over empty
 *   canvas id = the LAST selected item, a pen reaches a handle with the
 *   touch radius, the hit of a mouse has the 4-px mouse tolerance (rule 7)
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setupScene } from './sceneHarness.mjs'
import { HIT_TOL_MOUSE_PX, HIT_TOL_TOUCH_PX } from '../../../src/scene/InputController.js'
import { ROOT } from './sourceScan.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

let h
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/**
 * Notes A at (0, 0) and B at (300, 0), both 200 × 200; camera at the origin,
 * scale 1; container 1000 × 800.
 *
 * @param {object} [scene] SceneManager options
 * @return {object} sceneHarness
 */
function setup(scene = {}) {
	h = setupScene([note(A), note(B, { x: 300 })], { scene })
	return h
}

/**
 * A contextmenu event on the canvas (or props.target).
 *
 * @param {number} x client x (= container x unless the container is offset)
 * @param {number} y client y
 * @param {object} [props] event fields (pointerType, pointerId, ctrlKey, target, …)
 * @return {object} the event
 */
function ctxMenu(x, y, props = {}) {
	return dispatch(props.target ?? h.container, 'contextmenu', { clientX: x, clientY: y, button: 2, pointerId: 1, pointerType: 'mouse', ...props })
}

/**
 * A right click: pointerdown (button 2), contextmenu, pointerup; on Windows
 * the contextmenu comes after the pointerup.
 *
 * @param {number} x client x
 * @param {number} y client y
 * @param {object} [o] {type: pointerType, id: pointerId, order: 'down' | 'up'}
 * @return {object} the contextmenu event
 */
function rightClick(x, y, { type = 'mouse', id = 1, order = 'down' } = {}) {
	h.pointer('pointerdown', x, y, { button: 2, pointerType: type, pointerId: id })
	let e = null
	if (order === 'down') e = ctxMenu(x, y, { pointerType: type, pointerId: id })
	h.pointer('pointerup', x, y, { button: 2, pointerType: type, pointerId: id })
	if (order === 'up') e = ctxMenu(x, y, { pointerType: type, pointerId: id })
	return e
}

/** @return {object[]} the contextMenu intents so far */
const menus = () => h.intents('contextMenu')
/** @param {string} kind activity kind @return {object[]} onActivity entries of that kind */
const acts = (kind) => h.log.filter((e) => e[0] === 'onActivity' && e[1].kind === kind).map((e) => e[1])
/** @return {object[]} the non-null marquee rectangles handed to the renderer */
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null)

/**
 * Expected keyboard anchor: the selection's screen box (camera cam) with its
 * corners clamped into the 1000 × 800 container, its midpoint.
 *
 * @param {{x:number, y:number, w:number, h:number}} b world box
 * @param {{x:number, y:number, scale:number}} cam camera
 * @return {[number, number]} at
 */
function anchorOf(b, cam) {
	const cx = (v) => Math.min(1000, Math.max(0, v))
	const cy = (v) => Math.min(800, Math.max(0, v))
	const x0 = cx((b.x - cam.x) * cam.scale)
	const x1 = cx((b.x + b.w - cam.x) * cam.scale)
	const y0 = cy((b.y - cam.y) * cam.scale)
	const y1 = cy((b.y + b.h - cam.y) * cam.scale)
	return [(x0 + x1) / 2, (y0 + y1) / 2]
}

describe('pointer path (contextmenu of the canvas)', () => {
	for (const order of ['down', 'up']) {
		test(`right click on an item outside the selection: onSelection([id]) first, then {type:'contextMenu', id, at}; preventDefault (contextmenu at pointer${order})`, () => {
			setup()
			h.scene.setSelection([B])
			const e = rightClick(100, 50, { order })
			assert.equal(e.defaultPrevented, true)
			assert.deepEqual(h.log, [
				['onSelection', [A]],
				['onIntent', { type: 'contextMenu', id: A, at: [100, 50] }],
			])
			assert.deepEqual(h.scene.getSelection(), [A])
		})
	}

	test('at is in container px (not client px), the hit follows the confirmed camera', () => {
		setup()
		h.scene.setCamera({ x: -100, y: -50, scale: 0.5 })
		h.frame()
		h.log.length = 0
		h.container.getBoundingClientRect = () => ({ left: 30, top: 20, width: 1000, height: 800 })
		// client (130, 95) = container (100, 75) = world (100, 100): note A
		rightClick(130, 95)
		assert.deepEqual(menus(), [{ type: 'contextMenu', id: A, at: [100, 75] }])
		const r = h.scene.itemScreenRect(A)
		assert.ok(r.x <= 100 && 100 <= r.x + r.w && r.y <= 75 && 75 <= r.y + r.h, 'at lies in itemScreenRect(id)')
	})

	test('an item inside a multi-selection keeps the selection (no onSelection), id = that item', () => {
		setup()
		h.scene.setSelection([A, B])
		rightClick(400, 100)
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: B, at: [400, 100] }]])
		assert.deepEqual(h.scene.getSelection(), [A, B])
	})

	test('empty canvas: the selection is cleared like a click there, id = null; without a selection only the intent', () => {
		setup()
		h.scene.setSelection([A])
		rightClick(800, 600)
		assert.deepEqual(h.log, [
			['onSelection', []],
			['onIntent', { type: 'contextMenu', id: null, at: [800, 600] }],
		])
		h.log.length = 0
		rightClick(900, 700, { order: 'up' })
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: null, at: [900, 700] }]])
	})

	test('a transformer handle belongs to the selection: kept, id = the hit item when selected, else the last selected item', () => {
		setup()
		h.scene.setSelection([A])
		h.frame()
		const rot = h.scene.handles().find((x) => x.name === 'rot')
		const plus = h.scene.handles().find((x) => x.name === 'plus-r')
		assert.ok(rot && plus, 'rotation and "+" handles of one note')
		rightClick(rot.x, rot.y)
		rightClick(plus.x, plus.y)
		assert.deepEqual(h.log, [
			['onIntent', { type: 'contextMenu', id: A, at: [rot.x, rot.y] }],
			['onIntent', { type: 'contextMenu', id: A, at: [plus.x, plus.y] }],
		], 'no hit under these handles, the selection stays')
		h.log.length = 0
		h.scene.setSelection([A, B])
		h.frame()
		const tl = h.scene.handles().find((x) => x.name === 'tl')
		rightClick(tl.x, tl.y)
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: A, at: [tl.x, tl.y] }]], 'the corner over A: id A, not the last selected B')
		assert.deepEqual(h.scene.getSelection(), [A, B])
	})

	test('modifier keys change nothing (Shift+right click on an unselected item selects only it)', () => {
		setup()
		h.scene.setSelection([B])
		h.pointer('pointerdown', 100, 100, { button: 2, shiftKey: true })
		ctxMenu(100, 100, { shiftKey: true })
		h.pointer('pointerup', 100, 100, { button: 2, shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(menus(), [{ type: 'contextMenu', id: A, at: [100, 100] }])
	})
})

describe('macOS Ctrl+click and pen (contextmenu after a button-0 pointerdown)', () => {
	test('Ctrl+click on an unselected item: selected, the intent, then no drag (the press is dropped)', () => {
		setup()
		h.pointer('pointerdown', 100, 100, { ctrlKey: true })
		const e = ctxMenu(100, 100, { ctrlKey: true })
		h.pointer('pointermove', 160, 160, { ctrlKey: true })
		h.pointer('pointermove', 260, 260, { ctrlKey: true })
		h.pointer('pointerup', 260, 260, { ctrlKey: true })
		h.frame()
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(h.log, [
			['onSelection', [A]],
			['onIntent', { type: 'contextMenu', id: A, at: [100, 100] }],
		], 'no onActivity drag, no move intent, no onDragPreview')
		assert.equal(h.model.get(A).x, 0)
		assert.deepEqual(h.scene.getSelection(), [A])
	})

	test('Ctrl+click on empty canvas: no marquee; inside a multi-selection: the selection stays (no collapse on pointerup)', () => {
		setup()
		h.scene.setSelection([A])
		h.pointer('pointerdown', 800, 600, { ctrlKey: true })
		ctxMenu(800, 600, { ctrlKey: true })
		h.pointer('pointermove', 50, 50, { ctrlKey: true })
		h.pointer('pointerup', 50, 50, { ctrlKey: true })
		h.frame()
		assert.deepEqual(h.log, [
			['onSelection', []],
			['onIntent', { type: 'contextMenu', id: null, at: [800, 600] }],
		])
		assert.deepEqual(marquees(), [], 'no marquee drawn')
		assert.deepEqual(h.scene.getSelection(), [])
		h.log.length = 0
		h.scene.setSelection([A, B])
		h.pointer('pointerdown', 100, 100, { ctrlKey: true })
		ctxMenu(100, 100, { ctrlKey: true })
		h.pointer('pointerup', 100, 100, { ctrlKey: true })
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: A, at: [100, 100] }]])
		assert.deepEqual(h.scene.getSelection(), [A, B], 'a plain click would collapse to [A]')
	})

	test('a pending create tool: nothing is created, the tool stays (sticky on empty canvas, shape on an item)', () => {
		setup()
		h.scene.setTool('sticky')
		h.pointer('pointerdown', 800, 600, { ctrlKey: true })
		ctxMenu(800, 600, { ctrlKey: true })
		h.pointer('pointerup', 800, 600, { ctrlKey: true })
		h.scene.setTool('shape')
		h.pointer('pointerdown', 100, 100, { ctrlKey: true })
		ctxMenu(100, 100, { ctrlKey: true })
		h.pointer('pointermove', 400, 400, { ctrlKey: true })
		h.pointer('pointerup', 400, 400, { ctrlKey: true })
		h.frame()
		assert.deepEqual(h.intents(), [
			{ type: 'contextMenu', id: null, at: [800, 600] },
			{ type: 'contextMenu', id: A, at: [100, 100] },
		], 'no create intent')
		assert.equal(h.scene.getTool(), 'shape')
		assert.equal(h.log.filter((e) => e[0] === 'onTool').length, 0)
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(marquees(), [])
	})

	test('the connector tool: Ctrl+click on an item starts no connector', () => {
		setup()
		h.scene.setTool('connector')
		h.pointer('pointerdown', 100, 100, { ctrlKey: true })
		ctxMenu(100, 100, { ctrlKey: true })
		h.pointer('pointermove', 400, 100, { ctrlKey: true })
		h.pointer('pointerup', 400, 100, { ctrlKey: true })
		h.frame()
		assert.deepEqual(h.intents(), [{ type: 'contextMenu', id: A, at: [100, 100] }])
		assert.deepEqual(acts('connect'), [])
		assert.equal(h.scene.getTool(), 'connector')
	})

	test('pen: the barrel button (button 2) and a pen held still (button 0) open the menu; no drag', () => {
		setup()
		rightClick(100, 100, { type: 'pen', id: 3 })
		h.pointer('pointerdown', 400, 100, { pointerType: 'pen', pointerId: 3 })
		ctxMenu(400, 100, { pointerType: 'pen', pointerId: 3 })
		h.pointer('pointermove', 500, 200, { pointerType: 'pen', pointerId: 3 })
		h.pointer('pointerup', 500, 200, { pointerType: 'pen', pointerId: 3 })
		h.frame()
		assert.deepEqual(h.log, [
			['onSelection', [A]],
			['onIntent', { type: 'contextMenu', id: A, at: [100, 100] }],
			['onSelection', [B]],
			['onIntent', { type: 'contextMenu', id: B, at: [400, 100] }],
		])
		assert.equal(h.model.get(B).x, 300)
	})
})

describe('no intent', () => {
	test('touch long press (pointerType touch, or none/empty after a touch pointerdown): no intent, preventDefault, the press goes on', () => {
		setup()
		h.pointer('pointerdown', 100, 100, { pointerType: 'touch', pointerId: 5 })
		const e = ctxMenu(100, 100, { pointerType: 'touch', pointerId: 5 })
		assert.equal(e.defaultPrevented, true)
		h.pointer('pointermove', 150, 150, { pointerType: 'touch', pointerId: 5 })
		h.pointer('pointerup', 150, 150, { pointerType: 'touch', pointerId: 5 })
		h.frame()
		assert.deepEqual(menus(), [])
		assert.deepEqual(h.intents().map((i) => i.type), ['move'], 'today: the claimed finger still drags')
		// a finger on an item (claimed: no camera gesture pending) and on the empty canvas (pending)
		for (const [x, y] of [[400, 100], [800, 600]]) {
			for (const pointerType of [undefined, '']) {
				h.pointer('pointerdown', x, y, { pointerType: 'touch', pointerId: 6 })
				const m = ctxMenu(x, y, { pointerType, pointerId: 6 })
				h.pointer('pointercancel', x, y, { pointerType: 'touch', pointerId: 6 })
				assert.equal(m.defaultPrevented, true)
			}
		}
		assert.deepEqual(menus(), [], 'a MouseEvent contextmenu after a touch pointerdown is a finger too')
	})

	for (const mode of ['view', 'vote']) {
		test(`mode ${mode}: no intent (no vote either), no selection, preventDefault as before`, () => {
			setup({ mode })
			if (mode === 'vote') {
				h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
			}
			h.log.length = 0
			const e = rightClick(100, 100)
			const w = rightClick(800, 600, { order: 'up' })
			assert.equal(e.defaultPrevented, true)
			assert.equal(w.defaultPrevented, true)
			assert.deepEqual(h.intents(), [])
			assert.equal(h.log.filter((x) => x[0] === 'onSelection').length, 0)
			assert.deepEqual(h.scene.getSelection(), [])
		})
	}

	test('an open text editor keeps the browser menu: on the editor and on the canvas no intent, no preventDefault', () => {
		setup()
		assert.equal(h.scene.openTextEditor(A), true)
		const ta = h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
		dispatch(ta, 'pointerdown', { button: 2 })
		const onEditor = ctxMenu(10, 10, { target: ta })
		dispatch(ta, 'pointerup', { button: 2 })
		const onCanvas = ctxMenu(800, 600)
		assert.equal(onEditor.defaultPrevented, false, 'spelling menu of the editor')
		assert.equal(onCanvas.defaultPrevented, false)
		assert.deepEqual(menus(), [])
		assert.equal(h.scene.stats().editing, A, 'the editor stays open')
	})

	test('an overlay control (e.g. a chip button) keeps the browser menu too: no intent, no preventDefault, selection unchanged', () => {
		setup()
		h.scene.setSelection([A])
		const overlay = h.container.descendants().find((el) => el.className === 'knorke-scene-overlay')
		const button = h.dom.doc.createElement('button')
		overlay.appendChild(button)
		h.pointer('pointerdown', 900, 50, { button: 2, target: button })
		const e = ctxMenu(900, 50, { target: button })
		h.pointer('pointerup', 900, 50, { button: 2, target: button })
		assert.equal(e.defaultPrevented, false)
		assert.deepEqual(h.log, [])
		assert.deepEqual(h.scene.getSelection(), [A])
	})

	test('a right click beside the open editor ends it with its final commit (like a click), then the menu opens', () => {
		setup()
		h.scene.openTextEditor(A)
		const ta = h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
		ta.value = 'changed'
		dispatch(ta, 'input')
		h.log.length = 0
		const e = rightClick(800, 600)
		assert.equal(e.defaultPrevented, true)
		const types = h.intents().map((i) => i.type)
		assert.deepEqual(types, ['text', 'contextMenu'])
		assert.equal(h.intents('text')[0].final, true)
		assert.equal(h.intents('text')[0].value, 'changed')
		assert.equal(h.scene.stats().editing, null)
	})

	test('a moved press goes on (drag, marquee): no intent, preventDefault; the drag still ends with its move intent', () => {
		setup()
		h.pointer('pointerdown', 100, 100)
		h.pointer('pointermove', 150, 150)
		const e = ctxMenu(150, 150)
		h.pointer('pointermove', 180, 180)
		h.pointer('pointerup', 180, 180)
		h.frame()
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(h.intents().map((i) => i.type), ['move'])
		assert.deepEqual(acts('drag').map((a) => a.active), [true, false])
		h.log.length = 0
		h.pointer('pointerdown', 900, 700)
		h.pointer('pointermove', 850, 650)
		ctxMenu(850, 650)
		h.pointer('pointermove', 50, 50)
		h.pointer('pointerup', 50, 50)
		assert.deepEqual(menus(), [])
		assert.deepEqual(h.scene.getSelection(), [A, B], 'the marquee went on and selected both')
	})

	test('a mouse pan (middle button) and a finger below the tap threshold: no intent', () => {
		setup()
		h.pointer('pointerdown', 500, 400, { button: 1 })
		const e = ctxMenu(500, 400)
		h.pointer('pointerup', 500, 400, { button: 1 })
		assert.equal(e.defaultPrevented, true)
		h.pointer('pointerdown', 800, 600, { pointerType: 'touch', pointerId: 7 })
		h.focusCanvas()
		const k = h.key('F10', { shiftKey: true })
		h.pointer('pointercancel', 800, 600, { pointerType: 'touch', pointerId: 7 })
		assert.equal(k.defaultPrevented, false)
		assert.deepEqual(menus(), [])
	})

	test('a contextmenu without a pointerdown (synthetic, or the echo of a key) gives no intent but preventDefault', () => {
		setup()
		const e = ctxMenu(100, 100, { pointerType: '', pointerId: -1, button: 0 })
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(menus(), [])
		assert.deepEqual(h.scene.getSelection(), [])
	})
})

describe('a wheel gesture or a follow glide ends first', () => {
	test('wheel gesture: it ends (commit) before the intent; hit and at follow the camera shown', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		setup()
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 100, deltaMode: 0, clientX: 500, clientY: 400 })
		assert.equal(h.scene.stats().gestureActive, true)
		h.log.length = 0
		// container (100, 50) shows world (100, 150) now: note A
		rightClick(100, 50)
		assert.equal(h.scene.stats().gestureActive, false)
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 100, scale: 1 })
		const kinds = h.log.filter((e) => e[0] !== 'onUserCamera').map((e) => (e[0] === 'onActivity' ? `${e[1].kind}:${e[1].active}` : e[0]))
		assert.deepEqual(kinds, ['gesture:false', 'onSelection', 'onIntent'])
		assert.deepEqual(menus(), [{ type: 'contextMenu', id: A, at: [100, 50] }])
	})

	test('follow glide and the keyboard: the glide ends at the camera shown (false, no onUserCamera), at follows it', async () => {
		setup()
		h.scene.setSelection([A])
		const p = h.scene.followTo({ x: 300, y: 0, scale: 1 }, 600)
		let value = null
		p.then((v) => { value = v })
		for (let i = 0; i < 10; i++) h.frame(16)
		const shown = h.scene.stats().liveCamera
		assert.ok(shown.x > 0 && shown.x < 300, 'half way')
		h.log.length = 0
		h.focusCanvas()
		const k = h.key('F10', { shiftKey: true })
		await Promise.resolve()
		assert.equal(value, false)
		assert.equal(k.defaultPrevented, true)
		assert.equal(h.scene.stats().gliding, false)
		assert.deepEqual(h.scene.getCamera(), shown, 'the camera shown is the confirmed one')
		assert.deepEqual(menus(), [{ type: 'contextMenu', id: A, at: anchorOf({ x: 0, y: 0, w: 200, h: 200 }, shown) }])
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 0)
	})
})

describe('keyboard path (ContextMenu key, Shift+F10)', () => {
	for (const [label, key, props] of [['Shift+F10', 'F10', { shiftKey: true }], ['the ContextMenu key', 'ContextMenu', {}]]) {
		test(`${label} with a selection: id = the last selected item, at = the midpoint of its screen box; preventDefault, no onSelection`, () => {
			setup()
			h.scene.setSelection([A, B])
			h.focusCanvas()
			const e = h.key(key, props)
			assert.equal(e.defaultPrevented, true)
			assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: B, at: [250, 100] }]])
			assert.deepEqual(h.scene.getSelection(), [A, B])
		})

		test(`${label} without a selection: id null, at = the container centre`, () => {
			setup()
			h.focusCanvas()
			h.key(key, props)
			assert.deepEqual(menus(), [{ type: 'contextMenu', id: null, at: [500, 400] }])
		})
	}

	test('the anchor is clamped into the container per axis (partly or wholly outside), with the camera scale', () => {
		setup()
		h.scene.setSelection([A])
		h.focusCanvas()
		const cams = [
			{ x: 100, y: 0, scale: 1 },
			{ x: -2000, y: 0, scale: 1 },
			{ x: 0, y: 1000, scale: 1 },
			{ x: -100, y: -100, scale: 2 },
			{ x: -50, y: -60, scale: 0.25 },
		]
		const got = []
		for (const cam of cams) {
			h.scene.setCamera(cam)
			h.frame()
			h.key('ContextMenu')
			got.push(menus().at(-1).at)
		}
		assert.deepEqual(got, [[50, 100], [1000, 100], [100, 0], [400, 400], [37.5, 40]])
		assert.deepEqual(got, cams.map((c) => anchorOf({ x: 0, y: 0, w: 200, h: 200 }, c)))
	})

	test('only with the canvas focus: on the body or in a text field nothing (no preventDefault)', () => {
		setup()
		h.scene.setSelection([A])
		const body = h.dom.doc.body
		const input = h.dom.doc.createElement('input')
		input.type = 'text'
		body.appendChild(input)
		const a = h.key('F10', { shiftKey: true, target: body })
		const b = h.key('ContextMenu', { target: input })
		assert.equal(a.defaultPrevented, false)
		assert.equal(b.defaultPrevented, false)
		assert.deepEqual(menus(), [])
	})

	test('other modifiers or F10 alone: nothing', () => {
		setup()
		h.scene.setSelection([A])
		h.focusCanvas()
		h.key('F10')
		h.key('F10', { shiftKey: true, ctrlKey: true })
		h.key('F10', { shiftKey: true, altKey: true })
		h.key('F10', { shiftKey: true, metaKey: true })
		h.key('ContextMenu', { ctrlKey: true })
		h.key('ContextMenu', { altKey: true })
		assert.deepEqual(menus(), [])
	})

	for (const mode of ['view', 'vote']) {
		test(`mode ${mode}: no intent, the key is not prevented, its echo contextmenu is prevented`, () => {
			setup({ mode })
			h.scene.setSelection([A])
			h.focusCanvas()
			const k = h.key('F10', { shiftKey: true })
			const echo = ctxMenu(0, 0, { pointerType: '', pointerId: -1, button: 0 })
			assert.equal(k.defaultPrevented, false)
			assert.equal(echo.defaultPrevented, true)
			assert.deepEqual(h.intents(), [])
		})
	}

	test('the browser\'s echo of the key gives no second intent, also after an earlier pointerdown', () => {
		setup()
		h.pointer('pointerdown', 800, 600)
		h.pointer('pointerup', 800, 600)
		h.scene.setSelection([A])
		h.key('ContextMenu')
		const echo = ctxMenu(0, 0, { pointerType: '', pointerId: -1, button: 0 })
		assert.equal(echo.defaultPrevented, true)
		assert.deepEqual(menus(), [{ type: 'contextMenu', id: A, at: [100, 100] }])
		assert.deepEqual(h.scene.getSelection(), [A], 'the echo did not clear the selection')
	})

	test('no intent while a press is down (unmoved) or after the canvas lost the focus', () => {
		setup()
		h.pointer('pointerdown', 100, 100)
		const k = h.key('F10', { shiftKey: true })
		h.pointer('pointerup', 100, 100)
		assert.equal(k.defaultPrevented, false)
		assert.deepEqual(menus(), [])
		h.dom.doc.focusOn(h.dom.doc.body)
		h.key('F10', { shiftKey: true, target: h.dom.doc.body })
		assert.deepEqual(menus(), [])
	})
})

describe('right button and the existing intents', () => {
	test('a right-button press starts no pan, marquee or drag (also with the hand tool), and selects nothing by itself', () => {
		setup()
		for (const tool of ['select', 'hand']) {
			h.scene.setTool(tool)
			for (const [x, y] of [[100, 100], [800, 600]]) {
				h.pointer('pointerdown', x, y, { button: 2 })
				h.pointer('pointermove', x - 60, y - 60, { button: 2 })
				h.pointer('pointermove', x - 300, y - 300, { button: 2 })
				h.pointer('pointerup', x - 300, y - 300, { button: 2 })
				h.frame()
			}
		}
		assert.deepEqual(h.log.filter((e) => e[0] !== 'onTool'), [], 'no activity, selection, intent, preview or onUserCamera')
		assert.deepEqual(marquees(), [])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		assert.equal(h.model.get(A).x, 0)
	})

	test('after a right click the left button works as before: click selects, drag moves, Delete deletes; no contextMenu among them', () => {
		setup()
		rightClick(100, 100)
		h.log.length = 0
		h.pointer('pointerdown', 400, 100)
		h.pointer('pointerup', 400, 100)
		assert.deepEqual(h.log, [['onSelection', [B]]])
		h.pointer('pointerdown', 400, 100)
		h.pointer('pointermove', 450, 150)
		h.pointer('pointerup', 450, 150)
		h.frame()
		h.key('Delete')
		h.key('c', { ctrlKey: true })
		h.key('Escape')
		assert.deepEqual(h.intents().map((i) => i.type), ['move', 'delete', 'copy'])
		assert.equal(h.intents('move')[0].ids[0], B)
	})

	test('the facade JSDoc carries the intent in the Intent union', () => {
		const src = readFileSync(join(ROOT, 'src/scene/SceneManager.js'), 'utf8')
		assert.match(src, /\{type:'contextMenu', id:\(string\|null\), at:\[number, number\]\} \|/)
	})
})

describe('stage 4, phase 1: rules the mutation probes found untested (contract of step 4.2 unchanged)', () => {
	test('rule 3: one pointerdown opens at most one menu; a second contextmenu without a new pointerdown is no pointer\'s', () => {
		setup()
		rightClick(100, 100)
		const again = ctxMenu(100, 100)
		assert.equal(again.defaultPrevented, true)
		assert.deepEqual(menus(), [{ type: 'contextMenu', id: A, at: [100, 100] }])
		rightClick(400, 100)
		assert.deepEqual(menus().map((m) => m.id), [A, B], 'a new pointerdown opens the next one')
	})

	test('rule 4: the event\'s pointerType wins over the pointerdown\'s (touch on the event: no intent, the press goes on)', () => {
		setup()
		h.pointer('pointerdown', 100, 100, { button: 2, pointerType: 'mouse', pointerId: 1 })
		const e = ctxMenu(100, 100, { pointerType: 'touch', pointerId: 1 })
		h.pointer('pointerup', 100, 100, { button: 2, pointerType: 'mouse', pointerId: 1 })
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(menus(), [])
		assert.deepEqual(h.scene.getSelection(), [])
	})

	test('rule 5: while a touch gesture (pinch) runs, a mouse right click opens no menu; after it, it does', () => {
		setup()
		h.pointer('pointerdown', 700, 500, { pointerType: 'touch', pointerId: 11 })
		h.pointer('pointerdown', 900, 700, { pointerType: 'touch', pointerId: 12 })
		h.pointer('pointermove', 660, 460, { pointerType: 'touch', pointerId: 11 })
		h.pointer('pointermove', 940, 740, { pointerType: 'touch', pointerId: 12 })
		h.frame()
		assert.equal(h.scene.stats().gestureActive, true, 'the pinch runs')
		const e = rightClick(100, 100)
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual(menus(), [])
		h.pointer('pointerup', 660, 460, { pointerType: 'touch', pointerId: 11 })
		h.pointer('pointerup', 940, 740, { pointerType: 'touch', pointerId: 12 })
		h.frame()
		const c = h.scene.getCamera()
		const r = h.scene.itemScreenRect(A)
		rightClick(r.x + r.w / 2, r.y + r.h / 2)
		assert.deepEqual(menus().map((m) => m.id), [A], `after the pinch (camera ${JSON.stringify(c)})`)
	})

	test('rule 7: a handle over empty canvas keeps the selection, id = the LAST selected item', () => {
		const D = '01JA0000000000000000000004'
		h = setupScene([note(A), note(D, { x: 300, y: 300 })])
		h.scene.setSelection([A, D])
		h.frame()
		const tr = h.scene.handles().find((x) => x.name === 'tr')
		const bl = h.scene.handles().find((x) => x.name === 'bl')
		assert.deepEqual([tr.x, tr.y, bl.x, bl.y], [500, 0, 0, 500], 'corners of the union box, no item under them')
		rightClick(tr.x, tr.y)
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: D, at: [500, 0] }]])
		h.scene.setSelection([D, A])
		h.log.length = 0
		rightClick(bl.x, bl.y)
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: A, at: [0, 500] }]], 'no onSelection: kept')
		assert.deepEqual(h.scene.getSelection(), [D, A])
	})

	test('rule 7: a pen reaches a handle with the touch radius, a mouse at the same point is on empty canvas', () => {
		setup()
		h.scene.setSelection([A])
		h.frame()
		const plus = h.scene.handles().find((x) => x.name === 'plus-r')
		// 15 px right of the "+" handle: inside the touch radius (22 px), outside the mouse radius (8 px); nothing hit there
		const x = plus.x + 15
		rightClick(x, plus.y, { type: 'pen', id: 4 })
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: A, at: [x, plus.y] }]], 'pen: the handle keeps the selection')
		h.log.length = 0
		rightClick(x, plus.y)
		assert.deepEqual(h.log, [['onSelection', []], ['onIntent', { type: 'contextMenu', id: null, at: [x, plus.y] }]], 'mouse: empty canvas')
	})

	test('rule 7: the hit of a right click has the mouse tolerance (4 px), not the touch tolerance (12 px)', () => {
		setup()
		assert.ok(HIT_TOL_MOUSE_PX === 4 && HIT_TOL_TOUCH_PX === 12)
		// first beside A (nothing selected yet, so no handle of A lies there), then just inside the tolerance
		rightClick(200 + HIT_TOL_MOUSE_PX + 4, 50)
		rightClick(200 + HIT_TOL_MOUSE_PX - 1, 50)
		assert.deepEqual(menus().map((m) => m.id), [null, A], 'at 8 px beside A nothing (12 px would still hit A), inside 4 px A')
	})

	test('rule 7: an item inside a single selection keeps it too (no onSelection, no re-selection)', () => {
		setup()
		h.scene.setSelection([A])
		h.log.length = 0
		rightClick(100, 100)
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: A, at: [100, 100] }]])
	})
})
