/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 142, AK2: the scene callback onTouchPan (the shell's one-time
 * tip about "hold, then drag") with the real SceneManager, InputController,
 * GestureController and SceneModel on the fake DOM (renderer stubbed). It
 * comes once per pan when a finger on empty canvas starts the one-finger pan
 * in mode edit with the select tool, where holding it still would have drawn
 * a selection frame; never with the hand tool, in modes vote and view, for a
 * finger on an item (drag), a tap, a hold that became a marquee, a pinch or
 * a mouse pan. Note A at (100, 100), 200 × 200, camera (0, 0, 1), container
 * 1000 × 800; the hold timer is the GestureController's default setTimeout,
 * replaced by mock.timers.
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'

let h = null
let pans = 0
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/**
 * Fake timers first, then the scene; counts onTouchPan in `pans`.
 *
 * @param {object} [scene] SceneManager options (mode …)
 * @return {object} sceneHarness
 */
function setup(scene = {}) {
	mock.timers.enable({ apis: ['setTimeout'] })
	pans = 0
	h = setupScene([note(A, { x: 100, y: 100 })], { scene, on: { onTouchPan: () => pans++ } })
	return h
}

const finger = (id) => ({ pointerType: 'touch', pointerId: id })
const down = (x, y, id = 5) => h.pointer('pointerdown', x, y, finger(id))
const move = (x, y, id = 5) => {
	h.pointer('pointermove', x, y, finger(id))
	h.frame()
}
const up = (x, y, id = 5) => {
	h.pointer('pointerup', x, y, finger(id))
	h.frame()
}

/** One finger from (x, y) over `dx` px to the right in four moves, then up. */
function swipe(x, y, dx = 200, id = 5) {
	down(x, y, id)
	for (let i = 1; i <= 4; i++) move(x + (dx * i) / 4, y, id)
	up(x + dx, y, id)
}

describe('AK2: onTouchPan only in mode edit with the select tool, for a finger on empty canvas', () => {
	test('edit + select: one call per pan, at its first move beyond the slop; the camera pans as before', () => {
		setup()
		const cam = h.scene.getCamera()
		down(500, 600)
		move(505, 600)
		assert.equal(pans, 0, 'within the slop: no pan yet')
		move(530, 600)
		assert.equal(pans, 1)
		assert.equal(h.scene.stats().gestureActive, true, 'the pan runs')
		move(700, 650)
		up(700, 650)
		assert.equal(pans, 1, 'one call for the whole pan')
		assert.notDeepEqual(h.scene.getCamera(), cam, 'the camera moved')
		swipe(500, 700)
		assert.equal(pans, 2, 'each pan reports (the session decides about once)')
	})

	test('edit + select: no call for a tap, a hold that became a marquee or a finger on an item (drag)', () => {
		setup()
		down(500, 600)
		up(502, 601)
		down(500, 600)
		mock.timers.tick(LONG_PRESS_MS)
		move(800, 750)
		up(800, 750)
		assert.equal(h.scene.stats().holdRing, null, 'the marquee ended')
		down(200, 200)
		move(260, 260)
		move(400, 300)
		up(400, 300)
		assert.equal(pans, 0)
		assert.equal(h.model.get(A).x, 300, 'the finger on A dragged it')
	})

	test('edit + select: no call for a pinch, nor for the finger left after it, nor for a mouse pan with the middle button', () => {
		setup()
		down(400, 400, 5)
		down(600, 400, 6)
		move(350, 400, 5)
		move(650, 400, 6)
		up(650, 400, 6)
		move(300, 300, 5)
		up(300, 300, 5)
		assert.equal(pans, 0, 'pinch')
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 500, 600, { pointerType: 'mouse', pointerId: 1, button: 1 })
		h.pointer('pointermove', 700, 600, { pointerType: 'mouse', pointerId: 1, buttons: 4 })
		h.pointer('pointerup', 700, 600, { pointerType: 'mouse', pointerId: 1, button: 1 })
		h.frame()
		assert.notDeepEqual(h.scene.getCamera(), cam, 'the mouse panned')
		assert.equal(pans, 0, 'mouse')
	})

	test('hand tool: the finger pans, no call', () => {
		setup()
		h.scene.setTool('hand')
		const cam = h.scene.getCamera()
		swipe(500, 600)
		assert.notDeepEqual(h.scene.getCamera(), cam, 'the finger panned')
		assert.equal(pans, 0)
	})

	for (const mode of ['vote', 'view']) {
		test(`mode ${mode}: the finger pans, no call`, () => {
			setup({ mode })
			const cam = h.scene.getCamera()
			swipe(500, 600)
			assert.notDeepEqual(h.scene.getCamera(), cam, 'the finger panned')
			assert.equal(pans, 0)
		})
	}

	test('a switch to mode view and back to edit: no call while in view, calls again in edit', () => {
		setup()
		h.scene.setMode('view')
		swipe(500, 600)
		assert.equal(pans, 0)
		h.scene.setMode('edit')
		swipe(500, 600)
		assert.equal(pans, 1)
	})
})
