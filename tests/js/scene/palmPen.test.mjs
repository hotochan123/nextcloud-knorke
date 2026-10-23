/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 134: the pen and the mouse go before the palm. On pen tablets without
 * palm rejection a resting palm, alone or with another finger, must not pan
 * or zoom the board during a pen or mouse press, nor win over the pen with a
 * create tool or the connector. A pen press (pen or mouse, button 0 or 1, on
 * the canvas) makes every finger that is down inert until it lifts (a
 * running touch gesture ends with a commit, a finger's press ends like Esc)
 * and keeps every finger that lands out until the press ends.
 *
 * Deterministic in Node on the fake DOM with the real SceneManager,
 * InputController, GestureController and SceneModel (renderer stubbed); the
 * hold timer is the GestureController's default setTimeout, replaced by
 * mock.timers. Notes A (100, 100) and B (600, 100), 200 × 200, camera
 * (0, 0, 1), tool select. Palm = finger 5, more fingers 6 and 7; pen
 * {pointerType 'pen', pointerId 9}, mouse {pointerType 'mouse', pointerId 1}.
 * Covered (spec AK1–AK5):
 * - AK1 contacts during the drag (pen, mouse): one move of A, no camera move
 * - AK2 the palm already waits: as AK1, no hold ring, no vibration; a new
 *   finger pans afterwards
 * - AK3 a palm pan already runs (pen): it ends with a commit at the pen's
 *   pointerdown, the pen drags A from the camera shown
 * - AK4 create tools and connector with a resting palm (pen, mouse): created
 *   at the device, not under the palm
 * - AK5 a finger on an item (pen): its selection stays until the pen takes
 *   over, its drag springs back
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

/** A at (100, 100), B at (600, 100), both 200 × 200; empty canvas around them. */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100, z: 'a2' })]

const PEN = Object.freeze({ pointerType: 'pen', pointerId: 9 })
const MOUSE = Object.freeze({ pointerType: 'mouse', pointerId: 1 })
const DEVICES = [['pen', PEN], ['mouse', MOUSE]]

const NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

let h = null
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
	if (NAVIGATOR) Object.defineProperty(globalThis, 'navigator', NAVIGATOR)
	else delete globalThis.navigator
})

/**
 * Fake timers first, then the scene.
 *
 * @return {object} sceneHarness
 */
function setup() {
	mock.timers.enable({ apis: ['setTimeout'] })
	h = setupScene(notes())
	return h
}

/** @return {Array<Array>} the calls of a navigator.vibrate spy */
function spyVibrate() {
	const calls = []
	Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (...args) => { calls.push(args); return true } }, configurable: true, writable: true })
	return calls
}

const finger = (id) => ({ pointerType: 'touch', pointerId: id })
const down = (x, y, id) => h.pointer('pointerdown', x, y, finger(id))
const move = (x, y, id) => {
	h.pointer('pointermove', x, y, finger(id))
	h.frame()
}
const up = (x, y, id) => {
	h.pointer('pointerup', x, y, finger(id))
	h.frame()
}
const devDown = (dev, x, y) => h.pointer('pointerdown', x, y, dev)
const devMove = (dev, x, y) => {
	h.pointer('pointermove', x, y, dev)
	h.frame()
}
const devUp = (dev, x, y) => {
	h.pointer('pointerup', x, y, dev)
	h.frame()
}

const gestureActivity = () => h.log.filter((e) => e[0] === 'onActivity' && e[1].kind === 'gesture').length
const holdRing = () => h.scene.stats().holdRing
const rings = () => h.container.descendants().filter((el) => el.hasAttribute('data-knorke-hold-ring'))

/** Exactly one intent: move [A] by (100, 60). */
function assertOneMoveOfA() {
	const moves = h.intents('move')
	assert.equal(moves.length, 1, 'exactly one move')
	assert.deepEqual([moves[0].ids, moves[0].dx, moves[0].dy], [[A], 100, 60])
	assert.equal(h.intents().length, 1, 'no other intent')
}

/**
 * The run of AK1: the device drags A from (200, 200) over (260, 240) to (300, 260); meanwhile
 * the palm (finger 5) is down at (50, 600) and slides to palmTo, finger 6 lands at (380, 700)
 * and slides to (580, 760). Then the device lifts, then the fingers.
 *
 * @param {object} dev pen or mouse
 * @param {object} o options
 * @param {boolean} o.palmDown the palm lands during the drag (false: it is already down)
 * @param {[number, number]} o.palmTo where the palm slides
 * @param {() => void} [o.during] runs while every contact is still down
 */
function ak1Run(dev, { palmDown, palmTo, during = () => {} }) {
	devDown(dev, 200, 200)
	devMove(dev, 260, 240)
	if (palmDown) down(50, 600, 5)
	down(380, 700, 6)
	move(580, 760, 6)
	move(palmTo[0], palmTo[1], 5)
	devMove(dev, 300, 260)
	during()
	devUp(dev, 300, 260)
	up(palmTo[0], palmTo[1], 5)
	up(580, 760, 6)
}

describe('AK1: contacts during the drag', () => {
	for (const [name, dev] of DEVICES) {
		test(`${name}: palm and a second finger land and slide during the drag: one move of A by (100, 60), the camera stays, no gesture`, () => {
			setup()
			ak1Run(dev, { palmDown: true, palmTo: [50, 700] })
			assertOneMoveOfA()
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
			assert.equal(gestureActivity(), 0, 'no onActivity gesture')
		})
	}
})

describe('AK2: the palm already waits', () => {
	for (const [name, dev] of DEVICES) {
		test(`${name}: as AK1, no hold ring and no vibration also after LONG_PRESS_MS; afterwards a new finger pans`, () => {
			setup()
			const vib = spyVibrate()
			down(50, 600, 5)
			mock.timers.tick(200)
			ak1Run(dev, {
				palmDown: false,
				palmTo: [50, 800],
				during: () => {
					mock.timers.tick(LONG_PRESS_MS)
					assert.equal(holdRing(), null, 'no hold ring during the drag')
					assert.deepEqual(rings(), [])
				},
			})
			mock.timers.tick(LONG_PRESS_MS)
			assertOneMoveOfA()
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
			assert.equal(gestureActivity(), 0, 'no onActivity gesture')
			assert.equal(holdRing(), null)
			assert.deepEqual(rings(), [])
			assert.deepEqual(vib, [], 'no vibration')
			down(500, 500, 7)
			move(500, 600, 7)
			up(500, 600, 7)
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: -100, scale: 1 }, 'a new finger pans again')
		})
	}
})

describe('AK3: a palm pan already runs', () => {
	test('pen: the pan ends with a commit at the pointerdown; the pen drags A from the camera shown', () => {
		setup()
		down(50, 600, 5)
		move(50, 700, 5)
		assert.equal(h.scene.stats().gestureActive, true, 'the palm pans')
		devDown(PEN, 200, 300)
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: -100, scale: 1 }, 'committed at the pointerdown')
		move(50, 780, 5)
		devMove(PEN, 300, 360)
		devUp(PEN, 300, 360)
		up(50, 780, 5)
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: -100, scale: 1 }, 'the sliding palm pans nothing more')
		assertOneMoveOfA()
	})
})

describe('AK4: create tools and the connector with a resting palm', () => {
	for (const [name, dev] of DEVICES) {
		for (const tool of ['sticky', 'text', 'shape', 'frame']) {
			test(`${name}, ${tool}: the device taps at (500, 600): one create there, not under the palm; the tool is select again`, () => {
				setup()
				h.scene.setTool(tool)
				down(50, 600, 5)
				devDown(dev, 500, 600)
				devUp(dev, 500, 600)
				up(50, 600, 5)
				const want = { type: 'create', t: tool, at: { x: 500, y: 600 }, rect: null }
				if (tool === 'shape') want.data = { kind: 'rect' }
				assert.deepEqual(h.intents(), [want])
				assert.equal(h.scene.getTool(), 'select')
			})
		}

		test(`${name}, connector: the device drags from A to B: one connect from A to B, nothing else`, () => {
			setup()
			h.scene.setTool('connector')
			down(50, 600, 5)
			devDown(dev, 200, 200)
			devMove(dev, 450, 200)
			devMove(dev, 700, 200)
			devUp(dev, 700, 200)
			up(50, 600, 5)
			const all = h.intents()
			assert.equal(all.length, 1, 'only one intent')
			assert.equal(all[0].type, 'connect')
			assert.deepEqual([all[0].start.item, all[0].end.item], [A, B])
		})
	}
})

describe('AK5: a finger on an item', () => {
	test('(a) the palm lands on B (selection [B]), the pen drags A: one move of A, selection [A]; the palm moving and lifting afterwards gives nothing', () => {
		setup()
		down(700, 200, 5)
		assert.deepEqual(h.scene.getSelection(), [B])
		devDown(PEN, 200, 200)
		devMove(PEN, 260, 240)
		devMove(PEN, 300, 260)
		devUp(PEN, 300, 260)
		assertOneMoveOfA()
		assert.deepEqual(h.scene.getSelection(), [A])
		move(750, 260, 5)
		move(800, 320, 5)
		up(800, 320, 5)
		assertOneMoveOfA()
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
	})

	test('(b) the palm drags B, then the pen drags A: no move of B, one move of A', () => {
		setup()
		down(700, 200, 5)
		move(740, 230, 5)
		assert.ok(h.log.some((e) => e[0] === 'onDragPreview' && e[1].length > 0), 'the palm drags B')
		devDown(PEN, 200, 200)
		devMove(PEN, 260, 240)
		devMove(PEN, 300, 260)
		devUp(PEN, 300, 260)
		up(740, 230, 5)
		assertOneMoveOfA()
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
	})
})
