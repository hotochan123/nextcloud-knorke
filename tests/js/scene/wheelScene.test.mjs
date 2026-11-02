/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 154 (the mouse wheel zooms), AK4, the scene part, with the real
 * SceneManager, GestureController and SceneModel on the fake DOM (renderer
 * stubbed, sceneHarness.mjs):
 * - the option wheel and setWheel normalize to 'auto', 'zoom' or 'pan'
 *   (anything else 'auto', the default); getWheel and stats().wheel show it;
 *   no callback, no renderer call
 * - a wheel event with a notch zooms in 'auto' (like Ctrl + wheel, around the
 *   pointer) and pans in 'pan', in the modes edit, vote and view
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { WHEEL_STAGES as MENU_STAGES } from '../../../src/components/contextbar.js'
import { WHEEL_END_MS, WHEEL_ZOOM } from '../../../src/scene/GestureController.js'
import { WHEEL_STAGES } from '../../../src/scene/SceneManager.js'
import { dispatch } from './fakeDom.mjs'
import { note, rcalls, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
/** One notch of a wheel on macOS (Safari, Chrome). */
const NOTCH = 4.000244140625

let h
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/** @return {number} the renderer calls so far, without stats() (stats() of the scene asks the renderer) */
const drawCalls = () => rcalls.filter((c) => c[0] !== 'stats').length

/**
 * One wheel event at container (500, 400), then the wheel's end.
 *
 * @param {object} props deltaY, deltaMode, ctrlKey, …
 * @return {object} the confirmed camera afterwards
 */
function wheel(props) {
	dispatch(h.container, 'wheel', { deltaX: 0, deltaMode: 0, clientX: 500, clientY: 400, ...props })
	mock.timers.tick(WHEEL_END_MS)
	return h.scene.getCamera()
}

describe('AK4: option wheel, setWheel, getWheel, stats().wheel', () => {
	test('the default is auto; WHEEL_STAGES, the same list as in contextbar.js (the menu, the order the session cycles)', () => {
		assert.deepEqual(WHEEL_STAGES, ['auto', 'zoom', 'pan'])
		assert.deepEqual(MENU_STAGES, WHEEL_STAGES)
		h = setupScene([note(A)])
		assert.equal(h.scene.getWheel(), 'auto')
		assert.equal(h.scene.stats().wheel, 'auto')
	})

	test('the option: auto, zoom and pan as given, anything else auto', () => {
		for (const [v, want] of [['auto', 'auto'], ['zoom', 'zoom'], ['pan', 'pan'], ['x', 'auto'], [null, 'auto'], [1, 'auto'], ['Zoom', 'auto'], ['', 'auto']]) {
			h = setupScene([note(A)], { scene: { wheel: v } })
			assert.equal(h.scene.getWheel(), want, String(v))
			assert.equal(h.scene.stats().wheel, want, String(v))
			h.restore()
			h = null
		}
	})

	test('setWheel normalizes the same way; no callback, no renderer call; also after destroy', () => {
		h = setupScene([note(A)])
		const calls = drawCalls()
		for (const [v, want] of [['zoom', 'zoom'], ['pan', 'pan'], ['auto', 'auto'], ['pan', 'pan'], ['nope', 'auto'], ['zoom', 'zoom'], [undefined, 'auto']]) {
			h.scene.setWheel(v)
			assert.equal(h.scene.getWheel(), want, String(v))
			assert.equal(h.scene.stats().wheel, want, String(v))
		}
		assert.equal(drawCalls(), calls, 'no renderer call')
		assert.deepEqual(h.log, [], 'no callback')
		h.scene.destroy()
		h.scene.setWheel('pan')
		assert.equal(h.scene.getWheel(), 'pan')
		assert.equal(h.scene.stats().wheel, 'pan')
	})
})

describe('AK4: a wheel event with a notch zooms in auto and pans in pan, in every mode', () => {
	for (const mode of ['edit', 'vote', 'view']) {
		test(`mode ${mode}`, () => {
			mock.timers.enable({ apis: ['setTimeout'] })
			h = setupScene([note(A)], { scene: { mode } })
			assert.equal(h.scene.getMode(), mode)
			// auto (the default): a notch zooms around the pointer like Ctrl + wheel
			const z = wheel({ deltaY: -3 * NOTCH })
			const k = Math.exp(3 * NOTCH * WHEEL_ZOOM)
			assert.ok(Math.abs(z.scale - k) < 1e-12, `scale ${z.scale} ≈ ${k}`)
			assert.ok(Math.abs(z.x + 500 / z.scale - 500) < 1e-9 && Math.abs(z.y + 400 / z.scale - 400) < 1e-9, 'the world point under the pointer stays')
			h.scene.setCamera({ x: 0, y: 0, scale: 1 })
			const ref = wheel({ deltaY: -3 * NOTCH, ctrlKey: true })
			assert.deepEqual(ref, z, 'the same camera as with Ctrl')
			// a trackpad step pans in auto
			h.scene.setCamera({ x: 0, y: 0, scale: 1 })
			assert.deepEqual(wheel({ deltaY: 30 }), { x: 0, y: 30, scale: 1 })
			// pan: the notch pans
			h.scene.setWheel('pan')
			h.scene.setCamera({ x: 0, y: 0, scale: 1 })
			assert.deepEqual(wheel({ deltaY: -3 * NOTCH }), { x: 0, y: -3 * NOTCH, scale: 1 })
			assert.deepEqual(wheel({ deltaMode: 1, deltaY: 2 }), { x: 0, y: -3 * NOTCH + 32, scale: 1 }, 'Firefox lines pan too')
			// zoom: a trackpad step zooms
			h.scene.setWheel('zoom')
			h.scene.setCamera({ x: 0, y: 0, scale: 1 })
			assert.ok(Math.abs(wheel({ deltaX: 12, deltaY: 30 }).scale - Math.exp(-30 * WHEEL_ZOOM)) < 1e-12, 'zoom: the trackpad zooms')
			assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 6, 'every wheel gesture is a user camera change (it ends following)')
		})
	}
})
