/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 223 (show everything clear of the bars), scene part:
 * AK2: Camera.js freePart, Camera.fit and SceneManager.cameraForRect with
 * insets put the content centred into the part the bars leave free, the
 * padding inside it; fit never zooms in beyond 100 %; without insets, with
 * zeros, with invalid values and when the free part would be too small:
 * exactly the camera of before.
 * AK4: Shift+1 and Shift+2 ask the callback viewInsets and use its insets
 * like the buttons; without the callback (or a null answer) as before.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Camera, FIT_MAX_SCALE, MIN_FREE_PX, freePart } from '../../../src/scene/Camera.js'
import { MAX_SCALE, ZOOM_TO_MAX_SCALE } from '../../../src/model/tokens.js'
import { note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`)

/**
 * @param {{x:number, y:number, scale:number}} cam camera
 * @param {{x:number, y:number, w:number, h:number}} r world rectangle
 * @return {{l:number, t:number, r:number, b:number}} its screen rectangle
 */
const screenOf = (cam, r) => ({ l: (r.x - cam.x) * cam.scale, t: (r.y - cam.y) * cam.scale, r: (r.x + r.w - cam.x) * cam.scale, b: (r.y + r.h - cam.y) * cam.scale })

/**
 * The screen rectangle lies inside the free part less pad and its centre on the free part's centre.
 *
 * @param {{l:number, t:number, r:number, b:number}} s screen rectangle
 * @param {{x:number, y:number, w:number, h:number}} f free part
 * @param {number} pad padding
 */
function centredIn(s, f, pad) {
	const tol = 1e-6
	assert.ok(s.l >= f.x + pad - tol && s.r <= f.x + f.w - pad + tol, 'horizontally inside: ' + JSON.stringify({ s, f }))
	assert.ok(s.t >= f.y + pad - tol && s.b <= f.y + f.h - pad + tol, 'vertically inside: ' + JSON.stringify({ s, f }))
	near((s.l + s.r) / 2, f.x + f.w / 2)
	near((s.t + s.b) / 2, f.y + f.h / 2)
}

describe('AK2 freePart', () => {
	test('the viewport less the insets; invalid values count as 0', () => {
		assert.deepEqual(freePart(1280, 800, 48, { top: 58, left: 58, bottom: 58, right: 368 }), { x: 58, y: 58, w: 854, h: 684 })
		assert.deepEqual(freePart(1280, 800, 48, { top: Number.NaN, left: -5, bottom: Infinity, right: '30' }), { x: 0, y: 0, w: 1280, h: 800 })
		assert.deepEqual(freePart(1280, 800, 48, { left: 10 }), { x: 10, y: 0, w: 1270, h: 800 }, 'missing edges count as 0')
	})

	test('no insets, zeros or a free part below MIN_FREE_PX after the padding: the whole viewport', () => {
		const full = { x: 0, y: 0, w: 1280, h: 800 }
		assert.deepEqual(freePart(1280, 800, 48), full)
		assert.deepEqual(freePart(1280, 800, 48, null), full)
		assert.deepEqual(freePart(1280, 800, 48, { top: 0, right: 0, bottom: 0, left: 0 }), full)
		// 1280 − 1120 − 96 = 64: just enough; one px more and it falls back
		assert.equal(MIN_FREE_PX, 64)
		assert.deepEqual(freePart(1280, 800, 48, { left: 1120 }), { x: 1120, y: 0, w: 160, h: 800 })
		assert.deepEqual(freePart(1280, 800, 48, { left: 1121 }), full)
		assert.deepEqual(freePart(1280, 800, 48, { top: 300, bottom: 341 }), full, 'too low')
		assert.deepEqual(freePart(1280, 800, 48, { right: 1280 }), full, 'nothing free')
	})
})

describe('AK2 Camera.fit with insets', () => {
	const insets = { top: 58, left: 58, bottom: 58, right: 0 }
	const free = freePart(1280, 800, 48, insets)

	test('a large board: inside the free part with 48 px, centred on it', () => {
		const rect = { x: -300, y: 100, w: 4000, h: 2000 }
		const cam = new Camera().fit(rect, 1280, 800, 48, insets)
		centredIn(screenOf(cam, rect), free, 48)
		near(cam.scale, Math.min((1222 - 96) / 4000, (684 - 96) / 2000))
		assert.ok(cam.scale < new Camera().fit(rect, 1280, 800, 48).scale, 'smaller than without the bars')
	})

	test('a small board: never beyond 100 %, centred in the free part', () => {
		const rect = { x: 10, y: 10, w: 200, h: 100 }
		const cam = new Camera().fit(rect, 1280, 800, 48, insets)
		assert.equal(cam.scale, FIT_MAX_SCALE)
		centredIn(screenOf(cam, rect), free, 48)
	})

	test('without insets, with zeros, invalid values or a free part that is too small: the camera of before', () => {
		const rect = { x: -300, y: 100, w: 4000, h: 2000 }
		const before = new Camera().fit(rect, 1280, 800, 48)
		for (const ins of [undefined, null, {}, { top: 0, right: 0, bottom: 0, left: 0 }, { top: Number.NaN, left: -20 }, { left: 1200 }]) {
			assert.deepEqual(new Camera().fit(rect, 1280, 800, 48, ins), before, JSON.stringify(ins))
		}
		assert.deepEqual(new Camera().fit(null, 1280, 800, 48, insets), { x: -640, y: -400, scale: 1 }, 'an empty board as before')
	})
})

describe('AK2 SceneManager.cameraForRect with insets', () => {
	let h
	afterEach(() => {
		h?.restore()
		h = null
	})

	test('no 100 % limit, centred in the free part with the padding; without insets as before', () => {
		h = setupScene([])
		const ins = { top: 60, left: 60, bottom: 60, right: 300 }
		const free = freePart(1000, 800, 40, ins)
		const big = { x: 0, y: 0, w: 3000, h: 900 }
		centredIn(screenOf(h.scene.cameraForRect(big, 40, ins), big), free, 40)
		const small = { x: 0, y: 0, w: 100, h: 50 }
		const c = h.scene.cameraForRect(small, 40, ins)
		assert.equal(c.scale, ZOOM_TO_MAX_SCALE, 'zooms in up to the limit of zooms that fit something in (job 238)')
		centredIn(screenOf(c, small), free, 40)
		assert.deepEqual(h.scene.cameraForRect(big, 40, null), h.scene.cameraForRect(big, 40))
		assert.deepEqual(h.scene.cameraForRect(big, 40, { left: 1000 }), h.scene.cameraForRect(big, 40), 'nothing free: as before')
	})

	test('fit(rect, pad, insets) sets the camera of Camera.fit with the insets', () => {
		h = setupScene([note(A, { x: 0, y: 0, w: 2000, h: 1000 })])
		const ins = { top: 58, left: 58, bottom: 58 }
		h.scene.fit(undefined, 48, ins)
		h.frame()
		centredIn(screenOf(h.scene.getCamera(), h.model.allBounds()), freePart(1000, 800, 48, ins), 48)
	})
})

describe('AK4 Shift+1 and Shift+2 use the insets of the callback viewInsets', () => {
	let h
	afterEach(() => {
		h?.restore()
		h = null
	})
	const ins = { top: 58, right: 0, bottom: 58, left: 58 }

	test('Shift+1: the whole board inside the free part, like the button', () => {
		let asked = 0
		h = setupScene([note(A, { x: 0, y: 0 }), note(B, { x: 2600, y: 1500 })], { viewInsets: () => { asked++; return ins } })
		h.focusCanvas()
		h.key('!', { shiftKey: true, code: 'Digit1' })
		h.frame()
		assert.equal(asked, 1)
		const cam = h.scene.getCamera()
		centredIn(screenOf(cam, h.model.allBounds()), freePart(1000, 800, 48, ins), 48)
		assert.deepEqual(cam, new Camera().fit(h.model.allBounds(), 1000, 800, 48, ins))
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 1)
	})

	test('Shift+2: the selection inside the free part with 40 px', () => {
		h = setupScene([note(A, { x: 0, y: 0 }), note(B, { x: 2600, y: 1500, w: 400, h: 100 })], { viewInsets: () => ins })
		h.focusCanvas()
		h.scene.setSelection([B])
		h.key('@', { shiftKey: true, code: 'Digit2' })
		h.frame()
		const b = { x: 2600, y: 1500, w: 400, h: 100 }
		centredIn(screenOf(h.scene.getCamera(), b), freePart(1000, 800, 40, ins), 40)
	})

	test('job 242: Shift+2 on a small item goes to 1000 %, centred in the free part beside a side panel', () => {
		const side = { top: 58, right: 300, bottom: 58, left: 58 }
		const b = { x: 2600, y: 1500, w: 20, h: 10 }
		h = setupScene([note(A, { x: 0, y: 0 }), note(B, b)], { viewInsets: () => side })
		h.focusCanvas()
		h.scene.setSelection([B])
		h.key('@', { shiftKey: true, code: 'Digit2' })
		h.frame()
		const cam = h.scene.getCamera()
		assert.equal(cam.scale, MAX_SCALE)
		centredIn(screenOf(cam, b), freePart(1000, 800, 40, side), 40)
	})

	test('without the callback or with a null answer: the whole container as before', () => {
		const items = [note(A, { x: 0, y: 0 }), note(B, { x: 2600, y: 1500 })]
		h = setupScene(items)
		h.focusCanvas()
		h.key('!', { shiftKey: true, code: 'Digit1' })
		h.frame()
		const before = h.scene.getCamera()
		assert.deepEqual(before, new Camera().fit(h.model.allBounds(), 1000, 800, 48))
		h.restore()
		h = setupScene(items, { viewInsets: () => null })
		h.focusCanvas()
		h.key('!', { shiftKey: true, code: 'Digit1' })
		h.frame()
		assert.deepEqual(h.scene.getCamera(), before)
	})
})
