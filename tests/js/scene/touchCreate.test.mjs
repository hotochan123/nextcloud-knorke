/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Hotfix H1 (SPEC-M1 §35): a finger creates with the create tools in mode
 * edit, like the mouse. A touch device that also reports a fine pointer
 * (a pen, a touchpad, some Samsung touch drivers) is in mode edit; before H1
 * claimTouch took a first finger only with the select tool, so a tap with
 * the note tool ended as a tap of the gesture controller, which only mode
 * vote uses, and nothing was created.
 *
 * Deterministic in Node on the fake DOM with the real SceneManager,
 * InputController, GestureController and SceneModel (renderer stubbed):
 * - sticky, text, shape, frame: a finger tap gives exactly one intent create
 *   (default size, rect null), the tool falls back to select (onTool), no
 *   camera gesture; a finger drag with shape, frame or text gives the rect
 *   (marquee preview, cleared at the release)
 * - connector: a finger drag from A to B gives one intent connect, the tool
 *   falls back; a tap creates nothing and keeps the tool (like the mouse)
 * - a second finger while a create press is down: no intent, a pinch zooms,
 *   the tool stays (cancel like Esc)
 * - the touchend of a finger that created an item is cancelled (no
 *   compatibility mouse events and no click on the new editor or the
 *   context bar under the finger); after a select tap, a connector or the
 *   mouse it is not (the double tap keeps its two clicks), and never on an
 *   overlay control (review B2)
 * - pointercancel during a create or connector press: nothing created, no
 *   flag left behind, the next tap creates (review B4)
 * - unchanged: hand tool (the finger pans, nothing claimed), select tool
 *   (a tap on an item selects, on empty canvas the finger pans), modes vote
 *   and view (nothing created), mouse and pen with the note tool
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

/** A at (100, 100), B at (600, 100), both 200 × 200; empty canvas below them. */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 })]

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })

/** One finger: down, optional moves (each followed by a frame), up. */
function touch(path, id = 5) {
	const [x0, y0] = path[0]
	h.pointer('pointerdown', x0, y0, finger(id))
	for (const [x, y] of path.slice(1)) {
		h.pointer('pointermove', x, y, finger(id))
		h.frame()
	}
	const [x1, y1] = path[path.length - 1]
	h.pointer('pointerup', x1, y1, finger(id))
	h.frame()
}

const tap = (x, y, id = 5) => touch([[x, y]], id)

/** onTool callbacks since the setup. */
const tools = () => h.log.filter((e) => e[0] === 'onTool').map((e) => e[1])

describe('H1: a finger creates with the create tools in mode edit (SPEC-M1 §35)', () => {
	test('sticky: a tap on empty canvas gives exactly one create at the tap point; the tool falls back to select; no gesture', () => {
		h = setupScene(notes())
		h.scene.setTool('sticky')
		const cam = h.scene.getCamera()
		tap(500, 600)
		assert.deepEqual(h.intents(), [{ type: 'create', t: 'sticky', at: { x: 500, y: 600 }, rect: null }])
		assert.equal(h.scene.getTool(), 'select')
		assert.deepEqual(tools(), ['select'])
		assert.deepEqual(h.scene.getCamera(), cam, 'the tap did not pan')
		assert.equal(h.scene.stats().gestureActive, false)
		assert.deepEqual(h.scene.getSelection(), [])
	})

	test('sticky: a tap on an item creates too, like the mouse (the tool decides, not the hit)', () => {
		h = setupScene(notes())
		h.scene.setTool('sticky')
		tap(200, 200)
		assert.deepEqual(h.intents(), [{ type: 'create', t: 'sticky', at: { x: 200, y: 200 }, rect: null }])
		assert.deepEqual(h.scene.getSelection(), [], 'nothing selected')
	})

	for (const t of ['text', 'shape', 'frame']) {
		test(`${t}: a tap gives the default size (rect null); the tool falls back to select`, () => {
			h = setupScene(notes())
			h.scene.setTool(t)
			tap(500, 600)
			const want = { type: 'create', t, at: { x: 500, y: 600 }, rect: null }
			if (t === 'shape') want.data = { kind: 'rect' }
			assert.deepEqual(h.intents(), [want])
			assert.equal(h.scene.getTool(), 'select')
			assert.deepEqual(tools(), ['select'])
		})
	}

	for (const t of ['shape', 'frame', 'text']) {
		test(`${t}: a finger drag gives the dragged rect, previewed as a marquee and cleared at the release; the camera stays`, () => {
			h = setupScene(notes())
			h.scene.setTool(t)
			const cam = h.scene.getCamera()
			touch([[300, 400], [350, 450], [420, 500], [500, 550]])
			const want = { type: 'create', t, at: { x: 300, y: 400 }, rect: { x: 300, y: 400, w: 200, h: 150 } }
			if (t === 'shape') want.data = { kind: 'rect' }
			assert.deepEqual(h.intents(), [want])
			const marquees = callsOf('setMarquee')
			assert.ok(marquees.some((c) => c[0] !== null && c[1] === 'frame'), 'previewed while dragging')
			assert.equal(marquees.at(-1)[0], null, 'cleared at the release')
			assert.deepEqual(h.scene.getCamera(), cam, 'the finger drew, it did not pan')
			assert.equal(h.scene.getTool(), 'select')
		})
	}

	test('shape: the tool options travel with a finger like with the mouse', () => {
		h = setupScene(notes())
		h.scene.setTool('shape', { kind: 'ellipse' })
		tap(500, 600)
		assert.deepEqual(h.intents().map((i) => i.data), [{ kind: 'ellipse' }])
	})

	test('connector: a finger drag from A to B gives one connect; the tool falls back to select', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		touch([[200, 200], [400, 220], [650, 250]])
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: A }, end: { item: B }, route: 'straight', endCap: 'arrow' }])
		assert.equal(h.scene.getTool(), 'select')
		assert.equal(h.scene.stats().connecting, null)
	})

	test('connector: a drag from A to empty canvas ends at a free point', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		touch([[200, 200], [400, 400], [450, 600]])
		assert.deepEqual(h.intents(), [{ type: 'connect', start: { item: A }, end: { x: 450, y: 600 }, route: 'straight', endCap: 'arrow' }])
	})

	test('connector: a tap creates nothing and keeps the tool (like a click)', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		const cam = h.scene.getCamera()
		tap(200, 200)
		tap(500, 600)
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.getTool(), 'connector')
		assert.deepEqual(h.scene.getCamera(), cam)
	})

	test('a second finger during a create press: no create, the two fingers pinch, the tool stays', () => {
		h = setupScene(notes())
		h.scene.setTool('shape')
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 400, 500, finger(5))
		h.pointer('pointermove', 450, 550, finger(5))
		h.frame()
		assert.ok(callsOf('setMarquee').some((c) => c[0] !== null), 'the first finger draws')
		h.pointer('pointerdown', 600, 550, finger(6))
		assert.equal(callsOf('setMarquee').at(-1)[0], null, 'the second finger cancels the draw (like Esc)')
		h.pointer('pointermove', 700, 550, finger(6))
		h.frame()
		assert.equal(h.scene.stats().gestureActive, true, 'pinch on the CSS path')
		h.pointer('pointerup', 450, 550, finger(5))
		h.pointer('pointerup', 700, 550, finger(6))
		h.frame()
		assert.deepEqual(h.intents(), [], 'nothing created')
		assert.ok(h.scene.getCamera().scale > cam.scale, 'zoomed in')
		assert.equal(h.scene.getTool(), 'shape', 'the tool stays, nothing was created')
	})

	test('sticky: a second finger before the first lifts creates nothing', () => {
		h = setupScene(notes())
		h.scene.setTool('sticky')
		h.pointer('pointerdown', 400, 500, finger(5))
		h.pointer('pointerdown', 600, 500, finger(6))
		h.pointer('pointermove', 650, 500, finger(6))
		h.frame()
		h.pointer('pointerup', 400, 500, finger(5))
		h.pointer('pointerup', 650, 500, finger(6))
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.getTool(), 'sticky')
	})
})

describe('H1: no ghost click after a touch create', () => {
	/** The touchend the browser sends after the finger's pointerup (cancelable, like a real one). */
	const touchEnd = () => dispatch(h.container, 'touchend', { cancelable: true })

	for (const t of ['sticky', 'text', 'shape', 'frame']) {
		test(`${t}: the touchend after the create is cancelled, the next one is not`, () => {
			h = setupScene(notes())
			h.scene.setTool(t)
			tap(500, 600)
			assert.equal(h.intents().length, 1)
			assert.equal(touchEnd().defaultPrevented, true, 'no click on the editor or context bar under the finger')
			assert.equal(touchEnd().defaultPrevented, false, 'only once')
		})
	}

	test('a drag create cancels its touchend too; a cancelled create (second finger) does not', () => {
		h = setupScene(notes())
		h.scene.setTool('shape')
		touch([[300, 400], [400, 500], [500, 550]])
		assert.equal(touchEnd().defaultPrevented, true)
		h.scene.setTool('sticky')
		h.pointer('pointerdown', 400, 500, finger(5))
		h.pointer('pointerdown', 600, 500, finger(6))
		h.pointer('pointerup', 400, 500, finger(5))
		assert.equal(touchEnd().defaultPrevented, false, 'nothing was created')
		h.pointer('pointerup', 600, 500, finger(6))
		assert.equal(touchEnd().defaultPrevented, false)
	})

	test('select tap, connector and the hand tool keep their touchend (the double tap needs its clicks)', () => {
		h = setupScene(notes())
		tap(200, 200)
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.equal(touchEnd().defaultPrevented, false, 'select tap on an item')
		h.scene.setTool('connector')
		touch([[200, 200], [400, 220], [650, 250]])
		assert.equal(touchEnd().defaultPrevented, false, 'connector drag')
		h.scene.setTool('hand')
		tap(500, 600)
		assert.equal(touchEnd().defaultPrevented, false, 'hand tap')
	})

	test('a pending flag never outlives the next press: a mouse press clears it, a mouse create sets nothing', () => {
		h = setupScene(notes())
		h.scene.setTool('sticky')
		tap(500, 600)
		h.pointer('pointerdown', 700, 600)
		h.pointer('pointerup', 700, 600)
		assert.equal(touchEnd().defaultPrevented, false, 'the next pointerdown cleared it')
		h.scene.setTool('sticky')
		h.pointer('pointerdown', 700, 600)
		h.pointer('pointerup', 700, 600)
		assert.equal(h.intents().length, 2, 'mouse created')
		assert.equal(touchEnd().defaultPrevented, false, 'a mouse create sets nothing')
	})

	test('(review B2) a flag whose touchend never came does not swallow a touchend on the open editor', () => {
		h = setupScene(notes())
		h.scene.setTool('sticky')
		tap(500, 600)
		assert.equal(h.intents().length, 1)
		// no touchend reached the container; the editor's textarea stops its own pointerdown
		assert.equal(h.scene.openTextEditor(A), true)
		const ta = h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
		assert.ok(ta, 'editor open')
		dispatch(ta, 'pointerdown', { ...finger(7), clientX: 200, clientY: 200 })
		assert.equal(dispatch(ta, 'touchend', { cancelable: true }).defaultPrevented, false, 'the click on the editor stays')
		assert.equal(touchEnd().defaultPrevented, false, 'the flag is gone')
	})
})

describe('H1: pointercancel (review B4)', () => {
	/** The touchend the browser sends after the finger's pointerup (cancelable, like a real one). */
	const touchEnd = () => dispatch(h.container, 'touchend', { cancelable: true })

	test('sticky: finger down, pointercancel → no create, the tool stays, no flag; the next tap creates', () => {
		h = setupScene(notes())
		h.scene.setTool('sticky')
		h.pointer('pointerdown', 500, 600, finger(5))
		h.pointer('pointercancel', 500, 600, finger(5))
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.getTool(), 'sticky')
		assert.equal(touchEnd().defaultPrevented, false, 'no flag after a cancel')
		tap(500, 600, 6)
		assert.deepEqual(h.intents().map((i) => [i.type, i.t]), [['create', 'sticky']])
		assert.equal(touchEnd().defaultPrevented, true)
	})

	test('shape drag, pointercancel → no create, marquee cleared', () => {
		h = setupScene(notes())
		h.scene.setTool('shape')
		h.pointer('pointerdown', 300, 400, finger(5))
		h.pointer('pointermove', 450, 500, finger(5))
		h.frame()
		h.pointer('pointercancel', 450, 500, finger(5))
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.equal(callsOf('setMarquee').at(-1)[0], null)
		assert.equal(h.scene.getTool(), 'shape')
	})

	test('connector: pointercancel mid-drag and a second finger mid-drag → no connect, connecting null', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		h.pointer('pointerdown', 200, 200, finger(5))
		h.pointer('pointermove', 400, 220, finger(5))
		h.frame()
		assert.notEqual(h.scene.stats().connecting, null, 'connecting')
		h.pointer('pointercancel', 400, 220, finger(5))
		h.frame()
		assert.equal(h.scene.stats().connecting, null)
		h.pointer('pointerdown', 200, 200, finger(6))
		h.pointer('pointermove', 400, 220, finger(6))
		h.frame()
		h.pointer('pointerdown', 700, 500, finger(7))
		h.frame()
		assert.equal(h.scene.stats().connecting, null, 'the second finger cancelled the drag')
		h.pointer('pointerup', 400, 220, finger(6))
		h.pointer('pointerup', 700, 500, finger(7))
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.getTool(), 'connector')
	})
})

describe('H1: unchanged paths', () => {
	test('hand tool: a finger pans (CSS path), nothing is claimed, created or selected', () => {
		h = setupScene(notes())
		h.scene.setTool('hand')
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 500, 600, finger())
		h.pointer('pointermove', 450, 600, finger())
		h.frame()
		assert.equal(h.scene.stats().gestureActive, true)
		h.pointer('pointermove', 400, 600, finger())
		h.frame()
		h.pointer('pointerup', 400, 600, finger())
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.ok(Math.abs(h.scene.getCamera().x - (cam.x + 100 / cam.scale)) < 1e-6, 'panned by 100 px')
		assert.equal(h.scene.getTool(), 'hand')
		touch([[200, 200], [200, 300], [200, 400]])
		assert.deepEqual(h.intents(), [], 'on an item too: a pan, no drag')
		assert.deepEqual(h.scene.getSelection(), [])
	})

	test('select tool: a tap on an item selects it, a finger on empty canvas pans; nothing is created', () => {
		h = setupScene(notes())
		tap(200, 200)
		assert.deepEqual(h.scene.getSelection(), [A])
		const cam = h.scene.getCamera()
		touch([[500, 600], [460, 600], [400, 600]])
		assert.ok(Math.abs(h.scene.getCamera().x - (cam.x + 100 / cam.scale)) < 1e-6, 'panned')
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.getTool(), 'select')
	})

	test('two fingers with the select tool zoom; nothing is created', () => {
		h = setupScene(notes())
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 400, 600, finger(5))
		h.pointer('pointerdown', 600, 600, finger(6))
		h.pointer('pointermove', 700, 600, finger(6))
		h.frame()
		h.pointer('pointerup', 400, 600, finger(5))
		h.pointer('pointerup', 700, 600, finger(6))
		h.frame()
		assert.ok(h.scene.getCamera().scale > cam.scale)
		assert.deepEqual(h.intents(), [])
	})

	for (const mode of ['vote', 'view']) {
		test(`mode ${mode}: a finger with a create tool creates nothing`, () => {
			h = setupScene(notes(), { scene: { mode } })
			for (const t of ['sticky', 'shape', 'frame', 'text', 'connector']) {
				h.scene.setTool(t)
				tap(500, 600)
				touch([[300, 400], [400, 500], [500, 600]])
			}
			assert.deepEqual(h.intents(), [])
		})
	}

	for (const pointerType of ['mouse', 'pen']) {
		test(`${pointerType} with the note tool: unchanged, one create and back to select`, () => {
			h = setupScene(notes())
			h.scene.setTool('sticky')
			h.pointer('pointerdown', 500, 600, { pointerType, pointerId: 3 })
			h.pointer('pointerup', 500, 600, { pointerType, pointerId: 3 })
			assert.deepEqual(h.intents(), [{ type: 'create', t: 'sticky', at: { x: 500, y: 600 }, rect: null }])
			assert.equal(h.scene.getTool(), 'select')
		})
	}
})
