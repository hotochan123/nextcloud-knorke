/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * U17 / CLIENT-9 at the scene level (SPEC-M0 §6.3): the real SceneManager and
 * GestureController on the minimal fake DOM (fakeDom.mjs) with a manual
 * animation-frame queue and mocked setTimeout (the 120 ms wheel end). Only
 * the Konva renderer is stubbed; it records what the user would see:
 * setCamera (direct path), gestureFrame (CSS transform) and endGesture.
 *
 * Before the fix the mouse/pen pan started from the camera captured at
 * pointerdown and could run alongside a CSS gesture; when that gesture ended
 * (or a zoom key changed the camera) the next move snapped the view back:
 * wheel 300 → pan 10 px → wheel end → pan 20 px drew -200, -200, -480
 * instead of -200, -190, -180.
 *
 * Stage 3 (SPEC-M1 §6.3 "Folgen", §8.2 cameraPaths.test: followTo without
 * onUserCamera): followTo glides over the same CSS path (beginGesture →
 * gestureFrame per frame → ONE endGesture at the exact target, no direct
 * draw in between), never reports onUserCamera or gesture activity, keeps
 * the confirmed camera until it arrives; a new followTo replaces the glide
 * from the camera shown; a pointerdown, a wheel start, stopFollow,
 * setCamera, fit, zoomBy and the camera keys end it at the camera shown
 * (false) and then work on that camera; ms <= 0, a non-finite ms and
 * prefers-reduced-motion jump; a target closer than 0.5 screen px is the
 * same camera (S-10/S-11: true, nothing drawn, no onCamera); a finger that
 * may still become a gesture blocks it; destroy settles it false. Every
 * target is fixed, none random (audit A-01: two random targets < 0.5 px
 * apart hit S-10).
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, installDom } from './fakeDom.mjs'
import { KonvaRenderer } from '../../../src/scene/KonvaRenderer.js'
import { SceneManager, glideCamera } from '../../../src/scene/SceneManager.js'
import { WHEEL_END_MS } from '../../../src/scene/GestureController.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

/** What the renderer was asked to show: ['direct'|'css'|'end', x, scale]. */
let shown = []
/** The same with the full camera: ['direct'|'css'|'end', {x, y, scale}]; beginGesture as ['begin']. */
let shownCams = []

/** Replaces every KonvaRenderer member with an inert stub; camera calls are recorded. */
function stubRenderer() {
	const proto = KonvaRenderer.prototype
	const defaults = {
		hasDirty: () => false,
		stats: () => ({ nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 0, lod: 0, visible: 0, draws: { static: 0, overlay: 0 } }),
		setCamera: (x, y, s) => {
			shown.push(['direct', x, s])
			shownCams.push(['direct', { x, y, scale: s }])
		},
		gestureFrame: (c) => {
			shown.push(['css', c.x, c.scale])
			shownCams.push(['css', { ...c }])
		},
		endGesture: (c) => {
			shown.push(['end', c.x, c.scale])
			shownCams.push(['end', { ...c }])
		},
		beginGesture: () => shownCams.push(['begin']),
	}
	for (const name of Object.getOwnPropertyNames(proto)) {
		if (name === 'constructor') continue
		const d = Object.getOwnPropertyDescriptor(proto, name)
		if (typeof d.value === 'function') {
			Object.defineProperty(proto, name, { configurable: true, writable: true, value: defaults[name] ?? (() => {}) })
		}
	}
	const content = new WeakMap()
	Object.defineProperty(proto, 'contentEl', {
		configurable: true,
		get() {
			if (!content.has(this)) content.set(this, { style: {} })
			return content.get(this)
		},
	})
	Object.defineProperty(proto, 'cssTransform', { configurable: true, get: () => null })
	Object.defineProperty(proto, 'stage', { configurable: true, get: () => null })
}
stubRenderer()

let dom
let h

beforeEach(() => {
	dom = installDom()
	mock.timers.enable({ apis: ['setTimeout'] })
	h = setup()
})

afterEach(() => {
	h.scene.destroy()
	mock.timers.reset()
	dom.restore()
})

/**
 * Empty board, 1000×800, hand tool; the start camera is {x: -500, y: -400, scale: 1}.
 *
 * @param {object} [callbacks] scene callbacks
 * @return {object} helpers
 */
function setup(callbacks = {}) {
	const container = dom.doc.createElement('div')
	container.clientWidth = 1000
	container.clientHeight = 800
	dom.doc.body.appendChild(container)
	const model = new SceneModel()
	model.load([])
	const scene = new SceneManager(container, model, { limits: { maxText: 6000, maxTitle: 200 }, callbacks })
	scene.mount()
	scene.setTool('hand')
	dom.frame()
	shown = []
	shownCams = []
	/**
	 * @param {string} type pointer event type
	 * @param {number} x container x (y is fixed)
	 * @param {object} [o] pointerType, pointerId, button
	 */
	const ptr = (type, x, { pointerType = 'mouse', pointerId = 1, button = 0 } = {}) => {
		dispatch(container, type, { clientX: x, clientY: 100, pointerId, pointerType, button })
		dom.frame()
	}
	return {
		scene,
		container,
		ptr,
		wheel(dx) {
			dispatch(container, 'wheel', { deltaX: dx, deltaY: 0, deltaMode: 0, clientX: 500, clientY: 400 })
			dom.frame()
		},
		wait(ms) {
			mock.timers.tick(ms)
			dom.frame()
		},
		/** @return {Array} what the user saw, x rounded to 1e-6 */
		seen: () => shown.map(([k, x, s]) => [k, Math.round(x * 1e6) / 1e6, s]),
	}
}

describe('one camera path at a time, as the user sees it (U17)', () => {
	test('pan started within WHEEL_END_MS of a wheel event continues from the wheel camera; the wheel timer causes no snap back', () => {
		assert.equal(h.scene.getCamera().x, -500)
		h.wheel(300)
		h.ptr('pointerdown', 100, { button: 1 })
		h.ptr('pointermove', 90)
		h.wait(WHEEL_END_MS + 80)
		h.ptr('pointermove', 80)
		h.ptr('pointerup', 80)
		assert.deepEqual(h.seen(), [
			['css', -200, 1],
			['end', -200, 1], // committed at pointerdown, not by the timer
			['direct', -190, 1],
			['direct', -180, 1],
		])
		assert.equal(h.scene.getCamera().x, -180)
	})

	test('wheel events during a pan (momentum) are swallowed: no CSS gesture, the pan stays continuous', () => {
		h.ptr('pointerdown', 100, { button: 1 })
		h.ptr('pointermove', 90)
		h.wheel(300)
		h.ptr('pointermove', 80)
		h.wait(WHEEL_END_MS + 80)
		h.ptr('pointermove', 70)
		h.ptr('pointerup', 70)
		assert.deepEqual(h.seen(), [['direct', -490, 1], ['direct', -480, 1], ['direct', -470, 1]])
	})

	test('a finger that lands during a pen pan starts no touch gesture', () => {
		const pen = { pointerType: 'pen', pointerId: 1 }
		const finger = { pointerType: 'touch', pointerId: 2 }
		h.ptr('pointerdown', 100, pen)
		h.ptr('pointermove', 90, pen)
		h.ptr('pointerdown', 400, finger)
		h.ptr('pointermove', 100, finger)
		h.ptr('pointermove', 80, pen)
		h.ptr('pointerup', 100, finger)
		h.ptr('pointermove', 70, pen)
		h.ptr('pointerup', 70, pen)
		assert.deepEqual(h.seen(), [['direct', -490, 1], ['direct', -480, 1], ['direct', -470, 1]])
	})

	test('a zoom key during a pan is kept by the next move', () => {
		h.ptr('pointerdown', 100, { button: 1 })
		h.ptr('pointermove', 90)
		h.scene.zoomBy(1.25) // what the + key does
		dom.frame()
		h.ptr('pointermove', 80)
		h.ptr('pointerup', 80)
		assert.deepEqual(h.seen(), [['direct', -490, 1], ['direct', -390, 1.25], ['direct', -382, 1.25]])
	})
})

describe('follow glide over the CSS path (SPEC-M1 §6.3 "Folgen", G15 in Node)', () => {
	const START = { x: -500, y: -400, scale: 1 }
	const TARGET = { x: -200, y: -300, scale: 1.25 }
	const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
	const sameCam = (a, b, eps = 1e-9) => near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.scale, b.scale, eps)

	/** A scene that records onCamera, onUserCamera and onActivity in h.ev. */
	function follow() {
		h.scene.destroy()
		const ev = []
		h = setup({
			onCamera: (c) => ev.push(['camera', { ...c }]),
			onUserCamera: () => ev.push(['user']),
			onActivity: (a) => ev.push(['activity', a.kind, a.active]),
		})
		h.ev = ev
		return h
	}
	/** @param {Promise<boolean>} p promise @return {{value:(boolean|null)}} its value once settled */
	const watch = (p) => {
		const box = { value: null }
		p.then((v) => { box.value = v })
		return box
	}
	const kinds = () => shownCams.map((e) => e[0])
	const lastCss = () => shownCams.filter((e) => e[0] === 'css').at(-1)[1]

	test('600 ms: beginGesture, one gestureFrame per frame, no draw while gliding, ONE endGesture exactly at the target; no onUserCamera, no gesture activity', async () => {
		follow()
		const p = h.scene.followTo(TARGET, 600)
		const r = watch(p)
		const during = []
		for (let i = 0; i < 36; i++) {
			dom.frame(16)
			during.push({ cam: h.scene.getCamera(), st: h.scene.stats() })
		}
		await Promise.resolve()
		assert.equal(r.value, null, 'still gliding after 576 ms')
		assert.ok(during.every((d) => sameCam(d.cam, START) && d.st.gliding && d.st.gestureActive), 'confirmed camera unchanged while gliding')
		assert.ok(during.every((d) => d.st.camera.x === START.x && !sameCam(d.st.liveCamera, START)), 'liveCamera moves')
		dom.frame(16)
		dom.frame(16)
		assert.equal(await p, true)
		assert.deepEqual(h.scene.getCamera(), TARGET, 'exactly at the target')
		assert.equal(h.scene.stats().gliding, false)
		const k = kinds()
		assert.equal(k[0], 'begin')
		assert.equal(k.filter((x) => x === 'end').length, 1, 'one end draw')
		assert.equal(k.at(-1), 'end')
		assert.equal(k.filter((x) => x === 'direct').length, 0, 'no direct draw')
		assert.equal(k.filter((x) => x === 'css').length, 37, 'one CSS step per frame until the end')
		assert.deepEqual(shownCams.at(-1)[1], TARGET)
		// linear centre, geometric scale: half way after 300 ms
		const css = shownCams.filter((e) => e[0] === 'css').map((e) => e[1])
		for (const c of css) assert.ok(c.scale > 1 && c.scale < 1.25)
		const mid = glideCamera(START, TARGET, 0.5, 1000, 800)
		assert.ok(near(mid.scale, Math.sqrt(1.25)))
		assert.ok(near(mid.x + 500 / mid.scale, (0 + (-200 + 400)) / 2, 1e-9), 'centre half way')
		assert.ok(!h.ev.some((e) => e[0] === 'user' || e[0] === 'activity'), 'no onUserCamera, no activity')
		const cams = h.ev.filter((e) => e[0] === 'camera').map((e) => e[1])
		assert.ok(cams.length >= 5 && cams.length <= 9, `onCamera throttled like a gesture (${cams.length})`)
		assert.deepEqual(cams.at(-1), TARGET, 'last onCamera = the confirmed camera')
	})

	test('(2) a new followTo replaces the glide: the old promise false, the new glide continues from the camera shown, no draw in between', async () => {
		follow()
		const a = watch(h.scene.followTo(TARGET, 600))
		for (let i = 0; i < 12; i++) dom.frame(16)
		const shownNow = lastCss()
		const T2 = { x: 300, y: 100, scale: 0.8 }
		const b = h.scene.followTo(T2, 400)
		await Promise.resolve()
		assert.equal(a.value, false)
		dom.frame(16)
		const first = lastCss()
		const exp = glideCamera(shownNow, T2, 16 / 400, 1000, 800)
		assert.ok(sameCam(first, exp, 1e-6), 'from the camera shown')
		for (let i = 0; i < 30; i++) dom.frame(16)
		assert.equal(await b, true)
		assert.deepEqual(h.scene.getCamera(), T2)
		assert.deepEqual(kinds().filter((x) => x !== 'css'), ['begin', 'end'], 'one CSS path, one end draw')
	})

	test('(5) a pointerdown ends the glide at the camera shown (false, one end draw), then pans from there', async () => {
		follow()
		const p = watch(h.scene.followTo(TARGET, 600))
		for (let i = 0; i < 10; i++) dom.frame(16)
		const shownNow = lastCss()
		h.ptr('pointerdown', 100, { button: 1 })
		await Promise.resolve()
		assert.equal(p.value, false)
		assert.ok(sameCam(h.scene.getCamera(), shownNow), 'the camera shown is now the confirmed one')
		assert.equal(shownCams.filter((e) => e[0] === 'end').length, 1)
		assert.ok(sameCam(shownCams.find((e) => e[0] === 'end')[1], shownNow))
		h.ptr('pointermove', 90)
		const d = shownCams.at(-1)
		assert.equal(d[0], 'direct')
		assert.ok(near(d[1].x, shownNow.x + 10 / shownNow.scale, 1e-9), 'the pan continues from the camera shown')
		h.ptr('pointerup', 90)
		assert.ok(!h.ev.some((e) => e[0] === 'activity' && e[1] !== 'gesture'), 'only the pan reports activity')
		assert.equal(h.ev.filter((e) => e[0] === 'user').length, 1, 'onUserCamera only for the pan')
	})

	test('(5) a finger aborts too; while it may still become a gesture followTo is refused (4); after the tap it works again', async () => {
		follow()
		const p = watch(h.scene.followTo(TARGET, 600))
		dom.frame(16)
		dom.frame(16)
		h.ptr('pointerdown', 300, { pointerType: 'touch', pointerId: 7 })
		await Promise.resolve()
		assert.equal(p.value, false)
		const refused = watch(h.scene.followTo(TARGET, 600))
		await Promise.resolve()
		assert.equal(refused.value, false, 'finger down below the tap threshold: refused at once')
		assert.equal(h.scene.stats().gliding, false)
		h.ptr('pointerup', 300, { pointerType: 'touch', pointerId: 7 })
		assert.equal(h.scene.stats().gliding, false)
		const q = h.scene.followTo(TARGET, 100)
		for (let i = 0; i < 8; i++) dom.frame(16)
		assert.equal(await q, true)
		assert.deepEqual(h.scene.getCamera(), TARGET)
	})

	test('(5) the start of a wheel gesture ends the glide; the wheel gesture starts from the camera shown', async () => {
		follow()
		const p = watch(h.scene.followTo(TARGET, 600))
		for (let i = 0; i < 6; i++) dom.frame(16)
		const shownNow = lastCss()
		h.wheel(50)
		await Promise.resolve()
		assert.equal(p.value, false)
		assert.ok(sameCam(lastCss(), { ...shownNow, x: shownNow.x + 50 / shownNow.scale }, 1e-9), 'wheel CSS step from the camera shown')
		h.wait(WHEEL_END_MS + 20)
		assert.ok(near(h.scene.getCamera().x, shownNow.x + 50 / shownNow.scale))
	})

	test('(5) stopFollow, setCamera, fit and zoomBy end the glide at the camera shown; then they work on it', async () => {
		follow()
		for (const [name, act, check] of [
			['stopFollow', () => h.scene.stopFollow(), (c) => sameCam(h.scene.getCamera(), c)],
			['setCamera', () => h.scene.setCamera({ x: 1, y: 2, scale: 3 }), () => sameCam(h.scene.getCamera(), { x: 1, y: 2, scale: 3 })],
			['zoomBy', () => h.scene.zoomBy(2, { x: 0, y: 0 }), (c) => sameCam(h.scene.getCamera(), { x: c.x, y: c.y, scale: c.scale * 2 })],
			['fit', () => h.scene.fit(), () => h.scene.getCamera().scale === 1],
		]) {
			h.scene.setCamera(START)
			dom.frame(16)
			const p = watch(h.scene.followTo(TARGET, 600))
			for (let i = 0; i < 5; i++) dom.frame(16)
			const shownNow = lastCss()
			const ends = shownCams.filter((e) => e[0] === 'end').length
			act()
			await Promise.resolve()
			assert.equal(p.value, false, name)
			assert.equal(shownCams.filter((e) => e[0] === 'end').length, ends + 1, `${name}: one end draw`)
			assert.ok(sameCam(shownCams.filter((e) => e[0] === 'end').at(-1)[1], shownNow), `${name}: ends at the camera shown`)
			assert.ok(check(shownNow), name)
			assert.equal(h.scene.stats().gliding, false)
		}
		assert.ok(!h.ev.some((e) => e[0] === 'user'), 'the facade never reports onUserCamera')
	})

	test('(1) ms <= 0, a non-finite ms and prefers-reduced-motion jump (no CSS path); a jump during a glide ends it at the target', async () => {
		follow()
		// fixed targets 20 px apart and far from START: none is the "same camera" as the one before
		// (S-10, < 0.5 px), so every ms really jumps (random targets once collided, audit A-01)
		for (const [i, ms] of [0, -1, NaN, Infinity, undefined, '600'].entries()) {
			const T = { x: 10 + 20 * i, y: 5, scale: 1 }
			assert.equal(await h.scene.followTo(T, ms), true, String(ms))
			assert.deepEqual(h.scene.getCamera(), T)
		}
		dom.frame(16)
		assert.ok(!kinds().includes('begin'), 'no CSS path')
		const saved = Object.getOwnPropertyDescriptor(window, 'matchMedia')
		window.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' })
		try {
			const jumped = watch(h.scene.followTo(TARGET, 600))
			await Promise.resolve()
			assert.equal(jumped.value, true, 'reduced motion: settled at once')
			assert.deepEqual(h.scene.getCamera(), TARGET, 'reduced motion: at once')
			dom.frame(16)
			assert.ok(!kinds().includes('begin'))
		} finally {
			if (saved) Object.defineProperty(window, 'matchMedia', saved)
			else delete window.matchMedia
		}
		const p = watch(h.scene.followTo(START, 600))
		for (let i = 0; i < 5; i++) dom.frame(16)
		const T3 = { x: 9, y: 9, scale: 2 }
		assert.equal(await h.scene.followTo(T3, 0), true)
		assert.equal(p.value, false)
		assert.deepEqual(shownCams.at(-1), ['end', T3], 'the CSS path ends at the jump target, one draw')
		assert.deepEqual(h.scene.getCamera(), T3)
	})

	test('(3) S-10/S-11: a target 0.2 px from the confirmed camera is the same camera: true at once, the camera stays, nothing drawn, no onCamera', async () => {
		follow()
		const C = { x: 30, y: 5, scale: 1 }
		assert.equal(await h.scene.followTo(C, 0), true)
		for (let i = 0; i < 10; i++) dom.frame(16) // the jump's draw and its onCamera are through
		assert.deepEqual(h.scene.getCamera(), C)
		const drawn = shownCams.length
		const cams = h.ev.filter((e) => e[0] === 'camera').length
		assert.ok(drawn > 0 && cams > 0, 'the jump to C was drawn and reported')
		// 0.2 world px at scale 1 = 0.2 screen px < FOLLOW_SAME_PX (0.5): as a jump (ms 0) and as a glide (600 ms)
		for (const [ms, near02] of [[0, { x: 30.2, y: 5, scale: 1 }], [600, { x: 30, y: 4.8, scale: 1 }]]) {
			const r = watch(h.scene.followTo(near02, ms))
			await Promise.resolve()
			assert.equal(r.value, true, `ms ${ms}: resolved true at once`)
			assert.deepEqual(h.scene.getCamera(), C, `ms ${ms}: the camera stays exactly as it was`)
			assert.equal(h.scene.stats().gliding, false, `ms ${ms}: no glide`)
			for (let i = 0; i < 10; i++) dom.frame(16)
			assert.deepEqual(h.scene.getCamera(), C)
		}
		assert.equal(shownCams.length, drawn, 'nothing drawn: no direct draw, no CSS path')
		assert.equal(h.ev.filter((e) => e[0] === 'camera').length, cams, 'no onCamera (S-11)')
		assert.ok(!h.ev.some((e) => e[0] === 'user' || e[0] === 'activity'), 'no onUserCamera, no activity')
	})

	test('(3) during a glide a target equal to the confirmed camera is a new glide back, not a no-op; destroy settles a glide false', async () => {
		follow()
		const p = watch(h.scene.followTo(TARGET, 600))
		for (let i = 0; i < 5; i++) dom.frame(16)
		const back = h.scene.followTo(START, 200)
		await Promise.resolve()
		assert.equal(p.value, false)
		for (let i = 0; i < 14; i++) dom.frame(16)
		assert.equal(await back, true)
		assert.deepEqual(h.scene.getCamera(), START)
		const q = watch(h.scene.followTo(TARGET, 600))
		dom.frame(16)
		h.scene.destroy()
		await Promise.resolve()
		assert.equal(q.value, false)
	})

	test('a zoom key during a glide works on the camera shown (one onUserCamera, the glide ends false)', async () => {
		follow()
		h.container.focus()
		const p = watch(h.scene.followTo(TARGET, 600))
		for (let i = 0; i < 8; i++) dom.frame(16)
		const shownNow = lastCss()
		dispatch(h.container, 'keydown', { key: '+', code: 'Equal' })
		await Promise.resolve()
		assert.equal(p.value, false)
		const c = h.scene.getCamera()
		assert.ok(near(c.scale, shownNow.scale * 1.25), 'zoomed from the camera shown')
		assert.ok(near(c.x + 500 / c.scale, shownNow.x + 500 / shownNow.scale, 1e-9), 'around the centre shown')
		assert.equal(h.ev.filter((e) => e[0] === 'user').length, 1)
	})
})
