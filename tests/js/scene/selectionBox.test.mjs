/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The scene's selection box for the context bar (factory job 137, AK3):
 * onSelectionBox({box, keep}) in container px or null, with the real
 * SceneManager, InputController and GestureController on the fake DOM
 * (sceneHarness.mjs, 1000 × 800, camera {0, 0, 1}).
 * - box: the hull of the selection frames (job 140, AK5: each box 4 px
 *   wider on every side, a rotated note: its rotated frame, a frame with its
 *   title band); keep: box joined with ±HANDLE_TOUCH_PX around every drawn
 *   handle (job 231: the rotation handle 16 px beyond the top right corner,
 *   at any scale, the points on the frame); a locked
 *   frame has no handles, so keep is box
 * - null without a selection and while something moves: a drag, a resize
 *   (br), a rotation, a connector from a "+" handle, a wheel gesture until
 *   WHEEL_END_MS after its last event, a middle-button pan, a followTo glide;
 *   after the end exactly one box
 * - setCamera and zoomBy report the new box without a null; nothing is
 *   reported without a change
 * - (job 193) a note pad: box reaches down over its sheets (job 263)
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HANDLE_TOUCH_PX } from '../../../src/model/tokens.js'
import { WHEEL_END_MS } from '../../../src/scene/GestureController.js'
import { dispatch } from './fakeDom.mjs'
import { frameItem, note, setupScene } from './sceneHarness.mjs'

/** A lock of another participant (M2, R20). */
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

const A = '01JA0000000000000000000001'
const F = '01JA0000000000000000000009'

let h = null
/** every onSelectionBox value, in order */
let boxes = []

afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/**
 * @param {object[]} items WireItems
 * @return {object} the harness, onSelectionBox collected in `boxes`
 */
function open(items) {
	boxes = []
	h = setupScene(items, { on: { onSelectionBox: (b) => boxes.push(b) } })
	return h
}

/**
 * Selects ids, runs one frame and forgets what was reported so far.
 *
 * @param {string[]} ids selection
 * @return {object} the box reported for it
 */
function select(ids) {
	h.scene.setSelection(ids)
	h.frame()
	const last = boxes.at(-1)
	boxes = []
	return last
}

/**
 * A mouse press from a to b in steps, one frame per step; the release, then one frame.
 *
 * @param {{x:number, y:number}} a start (container px)
 * @param {{x:number, y:number}} b end
 * @param {object} [props] pointer props (button …)
 */
function press(a, b, props = {}) {
	h.pointer('pointerdown', a.x, a.y, props)
	for (let i = 1; i <= 4; i++) {
		h.pointer('pointermove', a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * i) / 4, props)
		h.frame()
	}
	h.pointer('pointerup', b.x, b.y, props)
	h.frame()
}

/** @param {string} what the movement: first null, then exactly one box */
function nullThenBox(what) {
	assert.equal(boxes.length, 2, `${what}: ${JSON.stringify(boxes)}`)
	assert.equal(boxes[0], null, `${what}: null first`)
	assert.ok(boxes[1] && boxes[1].box && boxes[1].keep, `${what}: then a box`)
}

describe('box and keep', () => {
	test('AK5: a note {100,100,200,200} at camera {0,0,1}: box {96,96,208,208} (the frame 4 px out), keep {74,58,268,268}', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointerup', 200, 200)
		h.frame()
		assert.deepEqual(boxes, [{ box: { x: 96, y: 96, w: 208, h: 208 }, keep: { x: 74, y: 58, w: 268, h: 268 } }])
		// keep: (job 231) the corners and the points on the frame, rot 16 px beyond the top right corner, each with its touch square
		const hs = h.scene.handles()
		const top = Math.min(...hs.map((x) => x.y))
		assert.equal(boxes[0].keep.y, top - HANDLE_TOUCH_PX)
	})

	test('at scale 0.5 keep.y lies 38 px above box.y (the rotation handle keeps its screen distance, job 231)', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		h.scene.setCamera({ x: 0, y: 0, scale: 0.5 })
		h.frame()
		const b = boxes.at(-1)
		assert.deepEqual(b.box, { x: 46, y: 46, w: 108, h: 108 }, 'the gap stays 4 screen px')
		assert.equal(b.box.y - b.keep.y, 16 + HANDLE_TOUCH_PX)
	})

	test('a note rotated by 45°: box is the hull of its rotated frame (±1)', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200, r: 45 })])
		const b = select([A]).box
		const half = Math.SQRT2 * 104
		for (const [got, want] of [[b.x, 200 - half], [b.y, 200 - half], [b.w, 2 * half], [b.h, 2 * half]]) {
			assert.ok(Math.abs(got - want) <= 1, `${got} ≈ ${want}`)
		}
	})

	test('AK5: a locked frame {0,200,400,300}: box {−4,160,408,344} (on top the title band as before, job 243: 40 high), keep = box; no selection: null', () => {
		open([frameItem(F, { x: 0, y: 200, w: 400, h: 300, lock: LOCK })])
		const b = select([F])
		assert.deepEqual(b.box, { x: -4, y: 160, w: 408, h: 344 })
		assert.deepEqual(b.keep, b.box, 'no handles on a locked frame')
		h.scene.setSelection([])
		h.frame()
		assert.deepEqual(boxes, [null])
	})
})

describe('null while something moves, then exactly one box', () => {
	test('a drag', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		press({ x: 200, y: 200 }, { x: 300, y: 260 })
		nullThenBox('drag')
		assert.deepEqual(boxes[1].box, { x: 196, y: 156, w: 208, h: 208 })
	})

	test('the resize handle br', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		const br = h.scene.handles().find((x) => x.name === 'br')
		press(br, { x: br.x + 60, y: br.y + 60 })
		nullThenBox('br')
		assert.equal(boxes[1].box.w, 268)
	})

	test('the rotation handle', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		const rot = h.scene.handles().find((x) => x.name === 'rot')
		// (job 231) rot beyond the top right corner (45° from the centre (200, 200)): to 90° turns by 45°, the hull grows
		press(rot, { x: 400, y: 200 })
		nullThenBox('rot')
		assert.ok(boxes[1].box.w > 250, `the hull of the rotated note: ${JSON.stringify(boxes[1].box)}`)
	})

	test('a connector from the "+" handle', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		const before = select([A])
		const plus = h.scene.handles().find((x) => x.name === 'plus-r')
		press(plus, { x: 650, y: 250 })
		assert.equal(h.intents('connect').length, 1)
		nullThenBox('connect')
		assert.deepEqual(boxes[1], before, 'nothing applied the intent: the same box again')
	})

	test('the mouse wheel until WHEEL_END_MS after its last event', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 40, deltaMode: 0, clientX: 500, clientY: 400 })
		h.frame()
		dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 40, deltaMode: 0, clientX: 500, clientY: 400 })
		h.frame()
		mock.timers.tick(WHEEL_END_MS - 1)
		h.frame()
		assert.deepEqual(boxes, [null], 'still null before WHEEL_END_MS')
		mock.timers.tick(1)
		h.frame()
		nullThenBox('wheel')
		assert.deepEqual(boxes[1].box, { x: 96, y: 16, w: 208, h: 208 })
	})

	test('a pan with the middle button', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		press({ x: 600, y: 500 }, { x: 640, y: 530 }, { button: 1 })
		nullThenBox('pan')
		assert.deepEqual(boxes[1].box, { x: 136, y: 126, w: 208, h: 208 })
	})

	test('a followTo glide', async () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		const done = h.scene.followTo({ x: 50, y: 0, scale: 1 }, 300)
		for (let i = 0; i < 25; i++) h.frame(16)
		assert.equal(await done, true)
		nullThenBox('followTo')
		assert.deepEqual(boxes[1].box, { x: 46, y: 96, w: 208, h: 208 })
	})
})

describe('changes without a null, nothing without a change', () => {
	test('setCamera and zoomBy report the new box without a null; an unchanged scene reports nothing', () => {
		open([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		select([A])
		h.scene.setCamera({ x: 10, y: 0, scale: 1 })
		h.frame()
		assert.deepEqual(boxes.map((b) => b.box), [{ x: 86, y: 96, w: 208, h: 208 }])
		h.scene.zoomBy(2, { x: 0, y: 0 })
		h.frame()
		assert.deepEqual(boxes.map((b) => b.box), [{ x: 86, y: 96, w: 208, h: 208 }, { x: 176, y: 196, w: 408, h: 408 }])
		boxes = []
		h.scene.setCamera(h.scene.getCamera())
		for (let i = 0; i < 3; i++) h.frame()
		h.scene.presenceChanged()
		h.frame()
		assert.deepEqual(boxes, [])
	})
})

describe('job 193 review round 1: a note pad', () => {
	test('job 263 AK6: a pad {100,100,200,200}: box reaches down over its sheets (box bottom 100 + 200 + 12 = 312), so a bar below it never covers the pad', () => {
		const P = '01JA0000000000000000000005'
		open([{ id: P, t: 'pad', x: 100, y: 100, w: 200, h: 200, r: 0, z: 'a5', parent: null, data: { title: 'Ideen' }, style: { fill: '#a8d8f8' } }])
		const b = select([P])
		assert.deepEqual(b.box, { x: 96, y: 96, w: 208, h: 216 })
		assert.ok(b.keep.y + b.keep.h >= 312, JSON.stringify(b.keep))
		h.scene.setCamera({ x: 0, y: 0, scale: 0.5 })
		h.frame()
		assert.equal(boxes.at(-1).box.y + boxes.at(-1).box.h, 156, 'in screen px at 50 %')
	})
})
