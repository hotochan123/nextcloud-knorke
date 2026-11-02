/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/scene/GestureController.js state machine with synthetic pointer and
 * wheel events (no DOM rendering), SPEC-M0 §6.3 / §9.3:
 * one-finger touch → CSS path; pinch → one finger lifts → the SAME gesture
 * keeps panning; mouse → direct path; claimTouch only in edit mode; a second
 * finger cancels a claimed touch; wheel zoom and its end after 120 ms.
 * Stage 3 (SPEC-M1 §6.3 "Tipp-Erkennung", §8.2 gesture.test): a first finger
 * starts the CSS path only beyond TAP_SLOP_PX, measured from its pointerdown
 * (M0-E11: 200 px pan 200 / scale); below it a release within TAP_MS is a tap
 * (onTap, no gesture); a second finger makes a pinch (no tap); deferPan gives
 * a mouse/pen pan a threshold (a click below it is onTap); beforeStart runs
 * before any gesture or pan reads the camera.
 * (R38, SPEC-M1 §6.3) Hold, then drag: a pending first finger outside
 * view-only mode starts a hold timer of LONG_PRESS_MS (with the longPress
 * option); when it runs out longPress(id, pointerdown point) is asked once,
 * true claims the finger, false keeps it pending; a move beyond
 * TAP_SLOP_PX, its release, pointercancel, a second finger, cancel() and
 * destroy() clear the timer first.
 * (Job 134) The pen goes first: during a pen or mouse press (button 0 or 1)
 * every finger is inert until it lifts; a running touch gesture ends with a
 * commit at its pointerdown.
 * (Job 142) onTouchPan: exactly once when a pending first finger moves beyond
 * TAP_SLOP_PX (its one-finger pan starts); never for a tap, a hold that
 * became a marquee, a pinch (also not for the finger left after it), a
 * claimed finger, a mouse/pen pan or the wheel.
 * (Job 154) The mouse wheel zooms: isNotchedWheel (AK1: deltaMode 1/2, a
 * macOS notch, a notch of Chrome on Windows/Linux by wheelDeltaY; deltaMode
 * read first); the option wheel
 * 'auto' (AK2: a notch zooms like Ctrl, decided once per gesture), 'zoom' and
 * 'pan' (AK3), Ctrl/⌘, Shift and ignoreTarget per event in every stage.
 * (Job 156) Right-drag: onTap carries the button of the pointerdown (2 for a
 * right click); pointercancel and a pointermove without the right button (a
 * missed pointerup) end a right press without a tap and a right-drag with
 * directEnd (AK5); a touch gesture blocks it, a wheel gesture ends first.
 * (Job 163) claimDrag: asked exactly once when a waiting first finger passes
 * TAP_SLOP_PX, with its pointerId and pointerdown point; true claims it (no
 * gesture, camera, onTouchPan or tap), false or no option pans as before;
 * never asked for a claimed finger, a tap, a hold that longPress took, a
 * pinch or in view-only mode (AK7).
 * (Job 168) The pen's side button: isRightPress (the mouse's button 2, the
 * pen's button 2 or button 0 with bit 2 in buttons); a right press of the pen
 * is a pen press (a waiting finger drops out, a one-finger pan ends with
 * its commit, fingers stay inert), it pans only by the pen's way beyond
 * TAP_SLOP_PX, buttons 1 pans on, buttons 0 or pointercancel end it without
 * a tap and the wheel works again (AK3); its click has no TAP_MS.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { GestureController, LONG_PRESS_MS, MAC_NOTCH_PX, TAP_MS, TAP_SLOP_PX, WHEEL_END_MS, WHEEL_ZOOM, isNotchedWheel, isRightPress } from '../../../src/scene/GestureController.js'
import { MAX_SCALE } from '../../../src/model/tokens.js'

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`)

/** Minimal element: listeners, bounding rect at (10, 20), pointer capture. */
function fakeEl() {
	const listeners = new Map()
	return {
		listeners,
		captured: [],
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, new Set())
			listeners.get(type).add(fn)
		},
		removeEventListener(type, fn) {
			listeners.get(type)?.delete(fn)
		},
		getBoundingClientRect: () => ({ left: 10, top: 20, width: 1000, height: 800 }),
		setPointerCapture(id) {
			this.captured.push(id)
		},
		fire(type, props = {}) {
			let prevented = false
			const e = { type, button: 0, ...props, preventDefault: () => { prevented = true } }
			for (const fn of listeners.get(type) ?? []) fn(e)
			return prevented
		},
	}
}

/** Fake timers for the wheel end. */
function fakeTimers() {
	let next = 1
	const pending = new Map()
	return {
		setTimer: (fn, ms) => {
			const h = next++
			pending.set(h, { fn, ms })
			return h
		},
		clearTimer: (h) => pending.delete(h),
		runAll() {
			for (const [h, t] of [...pending]) {
				pending.delete(h)
				t.fn()
			}
		},
		get pending() {
			return [...pending.values()]
		},
	}
}

/**
 * @param {object} [opts] controller options to override
 * @return {{el:object, g:GestureController, log:Array, cam:object, timers:object}}
 */
function setup(opts = {}) {
	const el = fakeEl()
	const timers = fakeTimers()
	const log = []
	const cam = { x: 0, y: 0, scale: 1 }
	const clock = { t: 1000 }
	const g = new GestureController(el, {
		getCamera: () => ({ ...cam }),
		now: () => clock.t,
		onGestureStart: (c) => log.push(['start', c]),
		onGestureFrame: (c) => log.push(['frame', c]),
		onGestureEnd: (c) => {
			log.push(['end', c])
			Object.assign(cam, c)
		},
		onDirect: (c) => {
			// like SceneManager: the direct path sets the confirmed camera
			log.push(['direct', c])
			Object.assign(cam, c)
		},
		onDirectStart: () => log.push(['directStart']),
		onDirectEnd: () => log.push(['directEnd']),
		onTap: (e) => log.push(['tap', e.pointerId, e.pointerType]),
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
		...opts,
	})
	return { el, g, log, cam, timers, clock }
}

const touch = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x + 10, clientY: y + 20 })
const mouse = (id, x, y, button = 0) => ({ pointerId: id, pointerType: 'mouse', clientX: x + 10, clientY: y + 20, button })
const kinds = (log) => log.map((e) => e[0])

describe('touch: CSS path', () => {
	test('one finger pans through the CSS path, ends when the finger lifts', () => {
		const { el, g, log } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		assert.equal(g.active, false, 'late start: no gesture at the pointerdown')
		assert.equal(g.pending, true)
		assert.equal(g.owns(1), true, 'the input controller keeps out')
		el.fire('pointermove', touch(1, 60, 100))
		assert.equal(g.active, true)
		assert.equal(g.mode, 'touch')
		assert.equal(g.pending, false)
		el.fire('pointermove', touch(1, -200, 50))
		const last = log.at(-1)
		assert.equal(last[0], 'frame')
		assert.deepEqual(last[1], { x: 300, y: 50, scale: 1 })
		el.fire('pointerup', touch(1, -200, 50))
		assert.deepEqual(kinds(log), ['start', 'frame', 'frame', 'end'])
		assert.deepEqual(log.at(-1)[1], { x: 300, y: 50, scale: 1 })
		assert.equal(g.active, false)
		assert.deepEqual(el.captured, [1])
	})

	test('pan respects the scale', () => {
		const { el, log, cam } = setup()
		cam.scale = 0.5
		el.fire('pointerdown', touch(1, 0, 0))
		el.fire('pointermove', touch(1, -200, 0))
		assert.deepEqual(log.at(-1)[1], { x: 400, y: 0, scale: 0.5 })
	})

	test('pinch → one finger lifts → the same gesture keeps panning, no jump', () => {
		const { el, g, log } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointerdown', touch(2, 300, 100))
		// spread the fingers symmetrically: midpoint (200, 100) fixed, distance 200 → 400
		el.fire('pointermove', touch(1, 0, 100))
		el.fire('pointermove', touch(2, 400, 100))
		let c = log.at(-1)[1]
		near(c.scale, 2)
		near(c.x + 200 / c.scale, 200, 1e-9)
		near(c.y + 100 / c.scale, 100, 1e-9)
		const pinched = { ...c }
		el.fire('pointerup', touch(1, 0, 100))
		assert.equal(g.active, true, 'still one gesture')
		assert.ok(!kinds(log).includes('end'))
		// the remaining finger (at 400,100) moves 100 px left: pan by 100 / scale
		el.fire('pointermove', touch(2, 300, 100))
		c = log.at(-1)[1]
		near(c.scale, pinched.scale)
		near(c.x, pinched.x + 100 / pinched.scale)
		near(c.y, pinched.y)
		el.fire('pointerup', touch(2, 300, 100))
		assert.equal(kinds(log).filter((k) => k === 'start').length, 1)
		assert.equal(kinds(log).filter((k) => k === 'end').length, 1)
		assert.equal(g.active, false)
	})

	test('pinch scale is clamped to the zoom range', () => {
		const { el, log } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointerdown', touch(2, 101, 100))
		el.fire('pointermove', touch(2, 900, 100))
		assert.equal(log.at(-1)[1].scale, MAX_SCALE)
		assert.equal(MAX_SCALE, 10, 'job 238 AK1: the pinch ends at 1000 %')
	})

	test('job 238 AK1: one pinch from 100 % to 1000 % (k = 10 on the CSS path), the end camera at scale 10', () => {
		const { el, log } = setup()
		el.fire('pointerdown', touch(1, 450, 400))
		el.fire('pointerdown', touch(2, 550, 400))
		// distance 100 → 500 → 1000: scale 5, then 10 (the midpoint (500, 400) stays put)
		el.fire('pointermove', touch(1, 250, 400))
		el.fire('pointermove', touch(2, 750, 400))
		near(log.at(-1)[1].scale, 5)
		el.fire('pointermove', touch(1, 0, 400))
		el.fire('pointermove', touch(2, 1000, 400))
		const c = log.at(-1)[1]
		near(c.scale, 10)
		near(c.x + 500 / c.scale, 500)
		near(c.y + 400 / c.scale, 400)
		el.fire('pointerup', touch(1, 0, 400))
		el.fire('pointerup', touch(2, 1000, 400))
		assert.equal(log.at(-1)[0], 'end')
		near(log.at(-1)[1].scale, 10)
	})

	test('a third finger is ignored and joins when one of the two lifts', () => {
		const { el, g, log } = setup()
		el.fire('pointerdown', touch(1, 0, 0))
		el.fire('pointerdown', touch(2, 100, 0))
		el.fire('pointerdown', touch(3, 500, 500))
		el.fire('pointermove', touch(3, 600, 600))
		const frames = kinds(log).filter((k) => k === 'frame').length
		assert.equal(frames, 0, 'third finger does not drive the gesture')
		el.fire('pointerup', touch(1, 0, 0))
		el.fire('pointermove', touch(3, 650, 600))
		assert.equal(kinds(log).filter((k) => k === 'frame').length, 1)
		el.fire('pointerup', touch(2, 100, 0))
		el.fire('pointerup', touch(3, 650, 600))
		assert.equal(g.active, false)
		assert.equal(kinds(log).filter((k) => k === 'end').length, 1)
	})

	test('pointercancel ends like pointerup', () => {
		const { el, g, log } = setup()
		el.fire('pointerdown', touch(1, 0, 0))
		el.fire('pointermove', touch(1, -20, 0))
		el.fire('pointercancel', touch(1, -20, 0))
		assert.equal(g.active, false)
		assert.deepEqual(kinds(log), ['start', 'frame', 'end'])
	})
})

describe('claimTouch', () => {
	test('edit mode: a claimed first touch is no gesture; the input controller owns it', () => {
		const claims = []
		const { el, g, log } = setup({ claimTouch: (e) => { claims.push(e.pointerId); return true } })
		el.fire('pointerdown', touch(7, 50, 50))
		assert.deepEqual(claims, [7])
		assert.equal(g.active, false)
		assert.equal(g.isClaimed(7), true)
		assert.equal(g.owns(7), false)
		el.fire('pointermove', touch(7, 80, 50))
		el.fire('pointerup', touch(7, 80, 50))
		assert.deepEqual(log, [])
		assert.equal(g.isClaimed(7), false)
	})

	test('view-only mode never claims (claimTouch is not even asked)', () => {
		const claims = []
		const { el, g } = setup({ viewOnly: () => true, claimTouch: () => { claims.push(1); return true } })
		el.fire('pointerdown', touch(1, 50, 50))
		assert.deepEqual(claims, [])
		assert.equal(g.pending, true)
		assert.equal(g.owns(1), true)
		el.fire('pointermove', touch(1, 80, 50))
		assert.equal(g.active, true)
	})

	test('second finger cancels the claim and both fingers pinch', () => {
		let cancelled = 0
		const { el, g, log } = setup({ claimTouch: () => true, cancelClaim: () => { cancelled++ } })
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 110, 100))
		el.fire('pointerdown', touch(2, 310, 100))
		assert.equal(cancelled, 1)
		assert.equal(g.active, true)
		assert.equal(g.isClaimed(1), false)
		assert.equal(g.owns(1), true)
		el.fire('pointermove', touch(2, 510, 100))
		const c = log.at(-1)[1]
		near(c.scale, 2)
		el.fire('pointerup', touch(1, 110, 100))
		el.fire('pointerup', touch(2, 510, 100))
		assert.deepEqual(kinds(log).filter((k) => k !== 'frame'), ['start', 'end'])
	})

	test('claimTouch returning false keeps the CSS path', () => {
		const { el, g } = setup({ claimTouch: () => false })
		el.fire('pointerdown', touch(1, 0, 0))
		assert.equal(g.pending, true)
		el.fire('pointermove', touch(1, 0, 11))
		assert.equal(g.active, true)
	})
})

describe('mouse and pen: direct path', () => {
	test('wantsPan → onDirect per move, never the CSS path', () => {
		const { el, g, log } = setup({ wantsPan: (e) => e.button === 1 })
		el.fire('pointerdown', mouse(1, 100, 100, 1))
		assert.equal(g.panning, true)
		assert.equal(g.active, false)
		el.fire('pointermove', mouse(1, 50, 80))
		el.fire('pointerup', mouse(1, 50, 80))
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'directEnd'])
		assert.deepEqual(log[1][1], { x: 50, y: 20, scale: 1 })
		assert.equal(g.owns(1), false)
	})

	test('without wantsPan a mouse press is left alone (input controller)', () => {
		const { el, g, log } = setup({ wantsPan: () => false })
		el.fire('pointerdown', mouse(1, 0, 0))
		el.fire('pointermove', mouse(1, 50, 0))
		el.fire('pointerup', mouse(1, 50, 0))
		assert.deepEqual(log, [])
		assert.equal(g.owns(1), false)
	})

	test('pen behaves like a mouse', () => {
		const { el, log } = setup({ wantsPan: () => true })
		el.fire('pointerdown', { ...mouse(4, 0, 0), pointerType: 'pen' })
		el.fire('pointermove', { ...mouse(4, -10, 0), pointerType: 'pen' })
		assert.deepEqual(kinds(log), ['directStart', 'direct'])
	})

	test('middle button prevents autoscroll', () => {
		const { el } = setup({ wantsPan: () => true })
		assert.equal(el.fire('pointerdown', mouse(1, 0, 0, 1)), true)
	})
})

describe('wheel', () => {
	test('Ctrl+wheel zooms around the pointer, ends WHEEL_END_MS after the last event', () => {
		const { el, g, log, timers } = setup()
		const prevented = []
		for (let i = 0; i < 5; i++) {
			prevented.push(el.fire('wheel', { ctrlKey: true, deltaY: -60, deltaX: 0, deltaMode: 0, clientX: 510, clientY: 420 }))
		}
		assert.deepEqual(prevented, [true, true, true, true, true])
		assert.equal(g.active, true)
		assert.equal(timers.pending.length, 1, 'one timer, re-armed per event')
		assert.equal(timers.pending[0].ms, WHEEL_END_MS)
		assert.equal(WHEEL_END_MS, 120)
		const c = log.at(-1)[1]
		near(c.scale, Math.exp(0.09) ** 5, 1e-12)
		// world point under (500, 400) stays fixed
		near(c.x + 500 / c.scale, 500)
		near(c.y + 400 / c.scale, 400)
		timers.runAll()
		assert.equal(g.active, false)
		assert.deepEqual(kinds(log), ['start', 'frame', 'frame', 'frame', 'frame', 'frame', 'end'])
	})

	test('job 238 AK1: Ctrl+wheel zooms in up to 1000 % and stops there', () => {
		const { el, log, timers } = setup()
		for (let i = 0; i < 60; i++) {
			el.fire('wheel', { ctrlKey: true, deltaY: -60, deltaX: 0, deltaMode: 0, clientX: 510, clientY: 420 })
		}
		const c = log.at(-1)[1]
		assert.equal(c.scale, MAX_SCALE)
		assert.equal(c.scale, 10)
		near(c.x + 500 / c.scale, 500)
		timers.runAll()
		assert.equal(log.at(-1)[0], 'end')
		assert.equal(log.at(-1)[1].scale, 10)
	})

	test('wheel without Ctrl pans; Shift turns vertical into horizontal; deltaMode 1 = 16 px', () => {
		const { el, log, timers } = setup()
		el.fire('wheel', { deltaX: 10, deltaY: 20, deltaMode: 0, clientX: 0, clientY: 0 })
		assert.deepEqual(log.at(-1)[1], { x: 10, y: 20, scale: 1 })
		el.fire('wheel', { deltaX: 0, deltaY: 30, deltaMode: 0, shiftKey: true, clientX: 0, clientY: 0 })
		assert.deepEqual(log.at(-1)[1], { x: 40, y: 20, scale: 1 })
		el.fire('wheel', { deltaX: 0, deltaY: 2, deltaMode: 1, clientX: 0, clientY: 0 })
		assert.deepEqual(log.at(-1)[1], { x: 40, y: 52, scale: 1 })
		timers.runAll()
		assert.equal(kinds(log).filter((k) => k === 'start').length, 1)
	})

	test('wheel over an overlay control without Ctrl is left to the browser', () => {
		const { el, g } = setup({ ignoreTarget: () => true })
		assert.equal(el.fire('wheel', { deltaY: 20, clientX: 0, clientY: 0 }), false)
		assert.equal(g.active, false)
		assert.equal(el.fire('wheel', { deltaY: 20, ctrlKey: true, clientX: 0, clientY: 0 }), true)
		assert.equal(g.active, true)
	})

	test('a touch ends a running wheel gesture first', () => {
		const { el, log } = setup()
		el.fire('wheel', { deltaY: 20, clientX: 0, clientY: 0 })
		el.fire('pointerdown', touch(1, 0, 0))
		assert.deepEqual(kinds(log), ['start', 'frame', 'end'])
		el.fire('pointermove', touch(1, 0, -30))
		assert.deepEqual(kinds(log), ['start', 'frame', 'end', 'start', 'frame'])
		assert.deepEqual(log.at(-1)[1], { x: 0, y: 50, scale: 1 }, 'the touch pan continues from the wheel camera')
	})
})

// ---- factory job 154: the mouse wheel zooms ----------------------------------------------

/** A wheel event at container (500, 400) (client 510, 420), deltaMode 0, deltaX 0, no modifier. */
const wheelAt = (props = {}) => ({ deltaX: 0, deltaMode: 0, clientX: 510, clientY: 420, ...props })
/** One notch of a wheel on macOS (Safari, Chrome). */
const NOTCH = 4.000244140625

/**
 * A Firefox-like wheel event of one notch (3 lines) with getters: whatever is read
 * first fixes the unit, deltaMode first gives lines, deltaX or deltaY first pixels
 * (48 px). Every read is recorded.
 *
 * @param {object} [extra] plain fields (clientX, ctrlKey, …)
 * @return {{e: object, reads: string[]}} the event and the reads
 */
function firefoxNotch(extra = {}) {
	const reads = []
	let mode = null
	const fix = (m) => {
		if (mode === null) mode = m
	}
	const e = {
		type: 'wheel', button: 0, clientX: 510, clientY: 420, ctrlKey: false, metaKey: false, shiftKey: false, ...extra,
		preventDefault() {},
		get deltaMode() { reads.push('deltaMode'); fix(1); return mode },
		get deltaX() { reads.push('deltaX'); fix(0); return 0 },
		get deltaY() { reads.push('deltaY'); fix(0); return mode === 1 ? 3 : 48 },
		get wheelDeltaY() { reads.push('wheelDeltaY'); return undefined },
	}
	return { e, reads }
}

/** Hands an event object to the wheel listeners as it is (fakeEl.fire copies it, which would run the getters). */
function fireRaw(el, e) {
	for (const fn of el.listeners.get('wheel') ?? []) fn(e)
}

/** @return {object} the last camera the controller reported */
const lastCam = (log) => log.at(-1)[1]

describe('job 154 AK1: isNotchedWheel', () => {
	test('true for deltaMode 1 and 2, a macOS notch (±k × 4.000244140625) and a wheelDeltaY of k × 120 that is not 3 × |deltaY| (100 with −120)', () => {
		assert.equal(MAC_NOTCH_PX, NOTCH)
		for (const e of [
			{ deltaMode: 1, deltaX: 0, deltaY: 3 },
			{ deltaMode: 2, deltaX: 0, deltaY: 1 },
			{ deltaMode: 1, deltaX: 2, deltaY: 0 },
			{ deltaMode: 0, deltaX: 0, deltaY: 4.000244140625 },
			{ deltaMode: 0, deltaX: 0, deltaY: -12.000732421875 },
			{ deltaMode: 0, deltaX: 0, deltaY: 40.00244140625 },
			{ deltaMode: 0, deltaX: 0, deltaY: 4.000244140625, wheelDeltaY: -120 },
			// (c) Chrome and Edge on Windows and Linux: wheelDeltaY ±120 per notch
			{ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 },
			{ deltaMode: 0, deltaX: 0, deltaY: -100, wheelDeltaY: 120 },
			{ deltaMode: 0, deltaX: 0, deltaY: 120, wheelDeltaY: -120 },
			{ deltaMode: 0, deltaX: 0, deltaY: 200, wheelDeltaY: -240 },
			{ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: 120 },
			// what Chromium reports for page.mouse.wheel (measured in E55's browser): ±120 at every deltaY
			{ deltaMode: 0, deltaX: 0, deltaY: 30, wheelDeltaY: -120 },
			{ deltaMode: 0, deltaX: 0, deltaY: -30, wheelDeltaY: 120 },
			{ deltaMode: 0, deltaX: 0, deltaY: 2000, wheelDeltaY: -120 },
		]) {
			assert.equal(isNotchedWheel(e), true, JSON.stringify(e))
		}
	})

	test('false for deltaY 4 and 2.5, 40 with wheelDeltaY 120, 100 without wheelDeltaY, 30 with wheelDeltaY 0, deltaX 3 with a notch; a trackpad of Chrome on macOS (wheelDeltaY = −3 × deltaY)', () => {
		for (const e of [
			{ deltaMode: 0, deltaX: 0, deltaY: 4 },
			{ deltaMode: 0, deltaX: 0, deltaY: 2.5 },
			{ deltaMode: 0, deltaX: 0, deltaY: 40, wheelDeltaY: 120 },
			{ deltaMode: 0, deltaX: 0, deltaY: 100 },
			{ deltaMode: 0, deltaX: 0, deltaY: 30, wheelDeltaY: 0 },
			{ deltaMode: 0, deltaX: 3, deltaY: 4.000244140625 },
			// a trackpad of Chrome on macOS: |wheelDeltaY| = 3 × |deltaY|, also where that is a multiple of 120
			{ deltaMode: 0, deltaX: 0, deltaY: 40, wheelDeltaY: -120 },
			{ deltaMode: 0, deltaX: 0, deltaY: -40, wheelDeltaY: 120 },
			{ deltaMode: 0, deltaX: 0, deltaY: 80, wheelDeltaY: -240 },
			{ deltaMode: 0, deltaX: 0, deltaY: 4, wheelDeltaY: -12 },
			{ deltaMode: 0, deltaX: 0, deltaY: 7, wheelDeltaY: -21 },
			// wheelDeltaY not a whole multiple of 120 or not a number; deltaX not 0; nothing at all
			{ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -100 },
			{ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -119.5 },
			{ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: '-120' },
			{ deltaMode: 0, deltaX: 3, deltaY: 100, wheelDeltaY: -120 },
			{ deltaMode: 0, deltaX: 0, deltaY: 0 },
			{ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: 0 },
		]) {
			assert.equal(isNotchedWheel(e), false, JSON.stringify(e))
		}
	})

	test('reads deltaMode before deltaX and deltaY (Firefox reports pixels otherwise)', () => {
		const ff = firefoxNotch()
		assert.equal(isNotchedWheel(ff.e), true, 'lines: a notch')
		assert.equal(ff.reads[0], 'deltaMode')
		const px = firefoxNotch()
		void px.e.deltaX // read before deltaMode: Firefox switches to pixels
		assert.equal(isNotchedWheel(px.e), false, '48 px: no notch')
		assert.ok(!ff.reads.includes('wheelDeltaY'), 'deltaMode 1 decides alone')
		assert.equal(px.reads.at(-1), 'wheelDeltaY', 'wheelDeltaY last, after deltaX and deltaY')
		// the controller reads deltaMode first as well: the Firefox notch zooms in 'auto' like Ctrl + 3 lines
		const a = setup({ wheel: () => 'auto' })
		const g = firefoxNotch()
		fireRaw(a.el, g.e)
		assert.equal(g.reads[0], 'deltaMode')
		const b = setup()
		b.el.fire('wheel', wheelAt({ deltaMode: 1, deltaY: 3, ctrlKey: true }))
		assert.deepEqual(lastCam(a.log), lastCam(b.log))
		near(lastCam(a.log).scale, Math.exp(-48 * WHEEL_ZOOM), 1e-12)
	})
})

describe('job 154 AK2: stage auto', () => {
	test('an event with a notch without Ctrl gives the same camera as with ctrlKey (deltaMode 0, 1 and 2; 100 with wheelDeltaY −120)', () => {
		for (const ev of [{ deltaY: NOTCH }, { deltaY: -3 * NOTCH }, { deltaMode: 1, deltaY: 3 }, { deltaMode: 1, deltaY: -2 }, { deltaMode: 2, deltaY: 0.05 }, { deltaY: 100, wheelDeltaY: -120 }, { deltaY: -100, wheelDeltaY: 120 }]) {
			const a = setup({ wheel: () => 'auto' })
			assert.equal(a.el.fire('wheel', wheelAt(ev)), true, 'preventDefault')
			const b = setup({ wheel: () => 'auto' })
			b.el.fire('wheel', wheelAt({ ...ev, ctrlKey: true }))
			assert.deepEqual(lastCam(a.log), lastCam(b.log), JSON.stringify(ev))
			assert.notEqual(lastCam(a.log).scale, 1, 'zoomed')
			const c = lastCam(a.log)
			near(c.x + 500 / c.scale, 500)
			near(c.y + 400 / c.scale, 400)
		}
	})

	test('deltaX 3 with deltaY 7 (a trackpad) pans as before; so does a trackpad of Chrome on macOS (40 with wheelDeltaY −120, 4 with −12)', () => {
		for (const [ev, cam] of [[{ deltaX: 3, deltaY: 7 }, { x: 3, y: 7, scale: 1 }], [{ deltaY: 40, wheelDeltaY: -120 }, { x: 0, y: 40, scale: 1 }], [{ deltaY: 4, wheelDeltaY: -12 }, { x: 0, y: 4, scale: 1 }]]) {
			const a = setup({ wheel: () => 'auto' })
			a.el.fire('wheel', wheelAt(ev))
			const b = setup()
			b.el.fire('wheel', wheelAt(ev))
			assert.deepEqual(lastCam(a.log), cam)
			assert.deepEqual(lastCam(b.log), cam, 'without the option the same')
		}
	})

	test('a gesture that starts with a notch zooms with its later events without a notch too (deltaX ignored); after its end the next event decides anew', () => {
		const { el, log, timers } = setup({ wheel: () => 'auto' })
		const ref = setup()
		for (const ev of [{ deltaY: NOTCH }, { deltaX: 3, deltaY: 7 }, { deltaY: -2.5 }]) {
			el.fire('wheel', wheelAt(ev))
			ref.el.fire('wheel', wheelAt({ ...ev, deltaX: 0, ctrlKey: true }))
		}
		assert.deepEqual(lastCam(log), lastCam(ref.log))
		near(lastCam(log).scale, Math.exp(-(NOTCH + 7 - 2.5) * WHEEL_ZOOM), 1e-12)
		assert.equal(kinds(log).filter((k) => k === 'start').length, 1, 'one gesture')
		timers.runAll()
		const s = log.at(-1)[1]
		assert.deepEqual(log.at(-1)[0], 'end')
		el.fire('wheel', wheelAt({ deltaX: 3, deltaY: 7 }))
		assert.deepEqual(lastCam(log), { x: s.x + 3 / s.scale, y: s.y + 7 / s.scale, scale: s.scale }, 'a new gesture: the trackpad pans')
	})

	test('a gesture that starts like a trackpad pans with a later notch too; Ctrl and Shift events do not decide', () => {
		const { el, log, timers } = setup({ wheel: () => 'auto' })
		el.fire('wheel', wheelAt({ deltaY: 7, clientX: 10, clientY: 20 }))
		el.fire('wheel', wheelAt({ deltaY: NOTCH, clientX: 10, clientY: 20 }))
		assert.deepEqual(lastCam(log), { x: 0, y: 7 + NOTCH, scale: 1 })
		timers.runAll()
		// a gesture that starts with Ctrl (a pinch) and Shift: the first plain event decides
		const z = setup({ wheel: () => 'auto' })
		z.el.fire('wheel', wheelAt({ deltaY: -60, ctrlKey: true }))
		z.el.fire('wheel', wheelAt({ deltaY: 20, shiftKey: true }))
		const s = lastCam(z.log)
		z.el.fire('wheel', wheelAt({ deltaY: 7 }))
		assert.deepEqual(lastCam(z.log), { x: s.x, y: s.y + 7 / s.scale, scale: s.scale }, 'the trackpad event decides: pan')
		z.el.fire('wheel', wheelAt({ deltaY: NOTCH }))
		assert.equal(lastCam(z.log).scale, s.scale, 'still pan')
		const n = setup({ wheel: () => 'auto' })
		n.el.fire('wheel', wheelAt({ deltaY: 20, shiftKey: true }))
		n.el.fire('wheel', wheelAt({ deltaY: NOTCH }))
		n.el.fire('wheel', wheelAt({ deltaY: 7 }))
		near(lastCam(n.log).scale, Math.exp(-(NOTCH + 7) * WHEEL_ZOOM), 1e-12)
	})
})

describe('job 154 AK3: stages zoom and pan, the modifiers in every stage', () => {
	test('zoom: trackpad events zoom, deltaX ignored; a gesture that starts with deltaY 0 pans', () => {
		const { el, log, timers } = setup({ wheel: () => 'zoom' })
		const ref = setup()
		for (const ev of [{ deltaX: 30, deltaY: 7 }, { deltaX: -5, deltaY: -2.5 }, { deltaY: 100 }]) {
			el.fire('wheel', wheelAt(ev))
			ref.el.fire('wheel', wheelAt({ ...ev, deltaX: 0, ctrlKey: true }))
		}
		assert.deepEqual(lastCam(log), lastCam(ref.log))
		near(lastCam(log).scale, Math.exp(-104.5 * WHEEL_ZOOM), 1e-12)
		timers.runAll()
		const s = log.at(-1)[1]
		el.fire('wheel', wheelAt({ deltaX: 20, deltaY: 0 }))
		el.fire('wheel', wheelAt({ deltaX: 0, deltaY: 10 }))
		assert.deepEqual(lastCam(log), { x: s.x + 20 / s.scale, y: s.y + 10 / s.scale, scale: s.scale }, 'a tilt wheel first: the gesture pans')
	})

	test('pan: notches pan as before (deltaMode 0 and 1, wheelDeltaY −120)', () => {
		for (const ev of [{ deltaY: NOTCH }, { deltaMode: 1, deltaY: 2 }, { deltaY: 100, wheelDeltaY: -120 }, { deltaX: 10, deltaY: 20 }]) {
			const a = setup({ wheel: () => 'pan' })
			a.el.fire('wheel', wheelAt(ev))
			const b = setup()
			b.el.fire('wheel', wheelAt(ev))
			assert.deepEqual(lastCam(a.log), lastCam(b.log), JSON.stringify(ev))
			assert.equal(lastCam(a.log).scale, 1)
		}
		const { el, log } = setup({ wheel: () => 'pan' })
		el.fire('wheel', wheelAt({ deltaMode: 1, deltaY: 2 }))
		assert.deepEqual(lastCam(log), { x: 0, y: 32, scale: 1 }, '16 px per line')
	})

	for (const stage of ['auto', 'zoom', 'pan', undefined]) {
		const opt = stage === undefined ? {} : { wheel: () => stage }
		test(`${stage ?? 'no option'}: Ctrl and ⌘ zoom, Shift pans sideways, Ctrl+Shift zooms; over ignoreTarget without Ctrl no preventDefault`, () => {
			for (const mod of ['ctrlKey', 'metaKey']) {
				const { el, log } = setup(opt)
				assert.equal(el.fire('wheel', wheelAt({ deltaY: -60, deltaX: 25, [mod]: true })), true)
				const c = lastCam(log)
				near(c.scale, Math.exp(0.09), 1e-12)
				near(c.x + 500 / c.scale, 500)
				near(c.y + 400 / c.scale, 400)
			}
			const sh = setup(opt)
			sh.el.fire('wheel', wheelAt({ deltaY: 5 * NOTCH, shiftKey: true }))
			assert.deepEqual(lastCam(sh.log), { x: 5 * NOTCH, y: 0, scale: 1 }, 'Shift with a notch: sideways')
			sh.el.fire('wheel', wheelAt({ deltaY: 30, shiftKey: true }))
			assert.deepEqual(lastCam(sh.log), { x: 5 * NOTCH + 30, y: 0, scale: 1 }, 'Shift with a trackpad step: sideways')
			const cs = setup(opt)
			cs.el.fire('wheel', wheelAt({ deltaY: -60, ctrlKey: true, shiftKey: true }))
			near(lastCam(cs.log).scale, Math.exp(0.09), 1e-12)
			const ov = setup({ ...opt, ignoreTarget: () => true })
			for (const ev of [{ deltaY: NOTCH }, { deltaY: 30 }, { deltaMode: 1, deltaY: 3 }]) {
				assert.equal(ov.el.fire('wheel', wheelAt(ev)), false, 'left to the browser: ' + JSON.stringify(ev))
			}
			assert.equal(ov.g.active, false)
			assert.equal(ov.el.fire('wheel', wheelAt({ deltaY: 30, metaKey: true })), true, 'with ⌘ it zooms the board')
			assert.equal(ov.g.active, true)
		})
	}

	test('every stage swallows wheel events during a mouse pan and while a finger is pending', () => {
		for (const stage of ['auto', 'zoom']) {
			const { el, g, log } = setup({ wheel: () => stage, wantsPan: () => true })
			el.fire('pointerdown', mouse(1, 100, 100, 1))
			assert.equal(el.fire('wheel', wheelAt({ deltaY: NOTCH })), true)
			assert.equal(g.active, false, stage + ': no CSS gesture during the pan')
			el.fire('pointerup', mouse(1, 100, 100, 1))
			el.fire('pointerdown', touch(2, 100, 100))
			assert.equal(el.fire('wheel', wheelAt({ deltaY: NOTCH })), true)
			assert.equal(g.active, false, stage + ': no CSS gesture while a finger is pending')
			assert.deepEqual(kinds(log), ['directStart', 'directEnd'])
		}
	})
})

/*
 * U17 / CLIENT-9: the CSS path and the direct path never run at the same
 * time, and the direct pan always continues from the current confirmed
 * camera. Before the fix a pan started from the camera captured at
 * pointerdown; a wheel gesture (or touch gesture) running alongside replaced
 * that camera when it ended, and the next move snapped the view back.
 */
describe('one camera path at a time (U17)', () => {
	for (const pointerType of ['mouse', 'pen']) {
		test(`${pointerType} pan within WHEEL_END_MS of a wheel event ends the wheel gesture first and continues from the wheel camera`, () => {
			const { el, g, log, timers } = setup({ wantsPan: () => true })
			el.fire('wheel', { deltaX: 300, deltaY: 0, deltaMode: 0, clientX: 0, clientY: 0 })
			assert.deepEqual(g.live, { x: 300, y: 0, scale: 1 })
			el.fire('pointerdown', { ...mouse(1, 100, 100, 1), pointerType })
			assert.equal(g.active, false, 'wheel gesture committed at pointerdown')
			assert.equal(g.panning, true)
			assert.deepEqual(log.find((x) => x[0] === 'end')?.[1], { x: 300, y: 0, scale: 1 })
			assert.equal(timers.pending.length, 0, 'no wheel timer left to end it a second time')
			el.fire('pointermove', { ...mouse(1, 90, 100), pointerType })
			assert.deepEqual(log.at(-1), ['direct', { x: 310, y: 0, scale: 1 }], 'continues from the wheel camera')
			timers.runAll()
			el.fire('pointermove', { ...mouse(1, 80, 100), pointerType })
			assert.deepEqual(log.at(-1), ['direct', { x: 320, y: 0, scale: 1 }], 'no snap back')
			el.fire('pointerup', { ...mouse(1, 80, 100), pointerType })
			assert.deepEqual(kinds(log), ['start', 'frame', 'end', 'directStart', 'direct', 'direct', 'directEnd'])
		})
	}

	test('wheel events during a mouse/pen pan are swallowed (trackpad momentum, free-spinning wheel)', () => {
		const { el, g, log, cam, timers } = setup({ wantsPan: () => true })
		el.fire('pointerdown', mouse(1, 100, 100, 1))
		el.fire('pointermove', mouse(1, 90, 100))
		for (const ctrlKey of [false, true]) {
			assert.equal(el.fire('wheel', { deltaX: 300, deltaY: 40, deltaMode: 0, ctrlKey, clientX: 0, clientY: 0 }), true, 'no page scroll/zoom')
		}
		assert.equal(g.active, false, 'no CSS gesture during the pan')
		assert.equal(timers.pending.length, 0)
		el.fire('pointermove', mouse(1, 80, 100))
		assert.deepEqual(log.at(-1), ['direct', { x: 20, y: 0, scale: 1 }])
		el.fire('pointerup', mouse(1, 80, 100))
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'direct', 'directEnd'])
		// after the pan the wheel works again, from the pan camera
		el.fire('wheel', { deltaX: 5, deltaY: 0, deltaMode: 0, clientX: 0, clientY: 0 })
		assert.deepEqual(log.at(-2), ['start', { x: 20, y: 0, scale: 1 }])
		assert.deepEqual(log.at(-1), ['frame', { x: 25, y: 0, scale: 1 }])
		assert.deepEqual(cam, { x: 20, y: 0, scale: 1 })
	})

	test('a touch that lands during a mouse/pen pan is ignored until it lifts (palm, second device)', () => {
		const claims = []
		const { el, g, log } = setup({ wantsPan: () => true, claimTouch: () => { claims.push(1); return true } })
		el.fire('pointerdown', { ...mouse(1, 100, 100), pointerType: 'pen' })
		el.fire('pointermove', { ...mouse(1, 90, 100), pointerType: 'pen' })
		el.fire('pointerdown', touch(2, 400, 100))
		assert.equal(g.active, false, 'no touch gesture')
		assert.equal(g.owns(2), false)
		assert.equal(g.isClaimed(2), false)
		assert.deepEqual(claims, [], 'claimTouch is not even asked')
		el.fire('pointermove', touch(2, 100, 100))
		el.fire('pointermove', { ...mouse(1, 80, 100), pointerType: 'pen' })
		assert.deepEqual(log.at(-1), ['direct', { x: 20, y: 0, scale: 1 }])
		el.fire('pointerup', { ...mouse(1, 80, 100), pointerType: 'pen' })
		el.fire('pointermove', touch(2, 50, 100))
		el.fire('pointerup', touch(2, 50, 100))
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'direct', 'directEnd'])
		// the next touch works normally
		el.fire('pointerdown', touch(3, 0, 0))
		assert.equal(g.isClaimed(3), true)
	})

	test('a mouse/pen pan starts while a finger waits (the finger is dropped) and during a touch gesture (it ends first with a commit)', () => {
		const { el, g, log } = setup({ wantsPan: () => true })
		el.fire('pointerdown', touch(1, 0, 0))
		el.fire('pointerdown', mouse(2, 100, 100, 1))
		assert.equal(g.panning, true, 'pending finger: the pan starts')
		assert.equal(g.pending, false)
		el.fire('pointermove', mouse(2, 50, 100))
		assert.deepEqual(log, [['directStart'], ['direct', { x: 50, y: 0, scale: 1 }]])
		el.fire('pointerup', mouse(2, 50, 100))
		el.fire('pointermove', touch(1, -20, 0))
		el.fire('pointerup', touch(1, -20, 0))
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'directEnd'], 'the dropped finger pans nothing, no tap')
		el.fire('pointerdown', touch(4, 0, 0))
		el.fire('pointermove', touch(4, -20, 0))
		assert.equal(g.active, true)
		el.fire('pointerdown', mouse(3, 100, 100, 1))
		assert.equal(g.active, false, 'touch gesture: ended')
		assert.equal(g.panning, true)
		el.fire('pointermove', mouse(3, 50, 100))
		assert.deepEqual(log.slice(3), [
			['start', { x: 50, y: 0, scale: 1 }],
			['frame', { x: 70, y: 0, scale: 1 }],
			['end', { x: 70, y: 0, scale: 1 }],
			['directStart'],
			['direct', { x: 120, y: 0, scale: 1 }],
		], 'the pan continues from the committed touch camera')
	})

	test('a camera change during the pan (zoom key, fit, setCamera) is kept by the next move', () => {
		const { el, log, cam } = setup({ wantsPan: () => true })
		el.fire('pointerdown', mouse(1, 100, 100, 1))
		el.fire('pointermove', mouse(1, 90, 100))
		assert.deepEqual(cam, { x: 10, y: 0, scale: 1 })
		Object.assign(cam, { x: 1000, y: -40, scale: 2 }) // e.g. zoomBy from the + key
		el.fire('pointermove', mouse(1, 80, 120))
		assert.deepEqual(log.at(-1), ['direct', { x: 1005, y: -50, scale: 2 }], 'pans the new camera by the pointer delta / scale')
	})
})

describe('taps and the late start of the touch gesture (SPEC-M1 §6.3, stage 3)', () => {
	test('a finger that lifts without moving is a tap: onTap once, no gesture, no capture lost, nothing pending', () => {
		const { el, g, log, clock } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		assert.equal(g.pending, true)
		assert.deepEqual(el.captured, [1], 'captured at the pointerdown (the pointerup comes back)')
		clock.t += 120
		el.fire('pointerup', touch(1, 100, 100))
		assert.deepEqual(log, [['tap', 1, 'touch']])
		assert.equal(g.pending, false)
		assert.equal(g.active, false)
		assert.equal(g.owns(1), false)
	})

	test(`moves up to TAP_SLOP_PX (${TAP_SLOP_PX} px) stay a tap; the release within TAP_MS (${TAP_MS} ms) counts, later not`, () => {
		assert.equal(TAP_SLOP_PX, 10)
		assert.equal(TAP_MS, 500)
		const { el, log, clock } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 106, 108))
		el.fire('pointermove', touch(1, 103, 92))
		clock.t += TAP_MS
		el.fire('pointerup', touch(1, 106, 108))
		assert.deepEqual(log, [['tap', 1, 'touch']], 'exactly 10 px away, exactly 500 ms: still a tap')
		el.fire('pointerdown', touch(2, 100, 100))
		clock.t += TAP_MS + 1
		el.fire('pointerup', touch(2, 100, 100))
		assert.deepEqual(log, [['tap', 1, 'touch']], 'a long press is no tap and no gesture')
	})

	test('beyond TAP_SLOP_PX the pan starts, and its first frame covers the whole way since the pointerdown', () => {
		const { el, g, log, cam } = setup()
		cam.scale = 0.5
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 95, 100))
		assert.deepEqual(log, [], '5 px: nothing yet')
		el.fire('pointermove', touch(1, 89, 100))
		assert.deepEqual(log, [['start', { x: 0, y: 0, scale: 0.5 }], ['frame', { x: 22, y: 0, scale: 0.5 }]], '11 px / 0.5')
		assert.equal(g.active, true)
		el.fire('pointerup', touch(1, 89, 100))
		assert.deepEqual(kinds(log), ['start', 'frame', 'end'], 'no tap after a pan')
	})

	test('M0-E11 swipe: 200 px in 20-px steps pans exactly 200 / scale (camera from the pointerdown, CLI-07)', () => {
		const { el, log, cam } = setup()
		cam.scale = 0.8
		el.fire('pointerdown', touch(1, 600, 400))
		for (let i = 1; i <= 10; i++) el.fire('pointermove', touch(1, 600 - 20 * i, 400))
		el.fire('pointerup', touch(1, 400, 400))
		const end = log.find((x) => x[0] === 'end')[1]
		near(end.x, 200 / 0.8)
		assert.equal(kinds(log).filter((k) => k === 'frame').length, 10, 'a frame per move, the first one at 20 px')
	})

	test('a second finger before the first moved: no tap, a pinch; the first finger\'s way so far pans first (M0 pinch)', () => {
		const { el, g, log } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 106, 100))
		el.fire('pointerdown', touch(2, 300, 100))
		assert.equal(g.active, true)
		assert.deepEqual(log, [['start', { x: 0, y: 0, scale: 1 }], ['frame', { x: -6, y: 0, scale: 1 }]])
		el.fire('pointermove', touch(2, 494, 100))
		const c = log.at(-1)[1]
		near(c.scale, 2)
		el.fire('pointerup', touch(1, 106, 100))
		el.fire('pointerup', touch(2, 494, 100))
		assert.ok(!kinds(log).includes('tap'))
		assert.deepEqual(kinds(log).filter((k) => k !== 'frame'), ['start', 'end'])
	})

	test('no tap: pointercancel, a release more than TAP_SLOP_PX away without a move event, a claimed finger', () => {
		const { el, log } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointercancel', touch(1, 100, 100))
		el.fire('pointerdown', touch(2, 100, 100))
		el.fire('pointerup', touch(2, 140, 100))
		assert.deepEqual(log, [])
		const c = setup({ claimTouch: () => true })
		c.el.fire('pointerdown', touch(3, 100, 100))
		c.el.fire('pointerup', touch(3, 100, 100))
		assert.deepEqual(c.log, [], 'the input controller handles a claimed finger')
	})

	test('wheel events while a finger may still start a gesture are swallowed (one camera path at a time)', () => {
		const { el, g, log, timers } = setup()
		el.fire('pointerdown', touch(1, 100, 100))
		assert.equal(el.fire('wheel', { deltaX: 0, deltaY: 30, deltaMode: 0, clientX: 0, clientY: 0 }), true)
		assert.equal(g.active, false)
		assert.equal(timers.pending.length, 0)
		el.fire('pointerup', touch(1, 100, 100))
		assert.deepEqual(log, [['tap', 1, 'touch']])
	})

	test('beforeStart runs before every gesture and pan reads the camera, never for a tap', () => {
		const order = []
		const cam = { x: 0, y: 0, scale: 1 }
		const { el } = setup({
			wantsPan: (e) => e.pointerType !== 'touch',
			beforeStart: () => { order.push('before'); cam.x = 77 },
			getCamera: () => { order.push('camera'); return { ...cam } },
			onTap: () => order.push('tap'),
		})
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointerup', touch(1, 100, 100))
		assert.deepEqual(order, ['tap'])
		order.length = 0
		el.fire('pointerdown', touch(2, 100, 100))
		el.fire('pointermove', touch(2, 50, 100))
		assert.deepEqual(order.slice(0, 2), ['before', 'camera'], 'touch pan')
		el.fire('pointerup', touch(2, 50, 100))
		order.length = 0
		el.fire('wheel', { deltaX: 5, deltaY: 0, deltaMode: 0, clientX: 0, clientY: 0 })
		assert.deepEqual(order.slice(0, 2), ['before', 'camera'], 'wheel')
		order.length = 0
		el.fire('pointerdown', mouse(3, 100, 100, 1))
		assert.deepEqual(order, ['before'], 'mouse pan: the wheel gesture ends first (reading nothing), then beforeStart')
		el.fire('pointermove', mouse(3, 90, 100))
		assert.deepEqual(order, ['before', 'camera'])
	})
})

describe('deferPan: a mouse/pen pan with a threshold, a click below it (mode vote, stage 3)', () => {
	test('mouse: below the threshold nothing pans; beyond it the pan starts at the pointerdown point', () => {
		const { el, g, log } = setup({ wantsPan: () => true, deferPan: (e) => (e.pointerType === 'mouse' ? 3 : 10) })
		el.fire('pointerdown', mouse(1, 100, 100))
		assert.equal(g.panning, false)
		assert.equal(g.pending, true)
		assert.equal(g.owns(1), true)
		assert.deepEqual(el.captured, [1])
		el.fire('pointermove', mouse(1, 102, 101))
		assert.deepEqual(log, [])
		el.fire('pointermove', mouse(1, 96, 100))
		assert.deepEqual(log, [['directStart'], ['direct', { x: 4, y: 0, scale: 1 }]], 'the whole 4 px')
		assert.equal(g.panning, true)
		el.fire('pointermove', mouse(1, 90, 100))
		el.fire('pointerup', mouse(1, 90, 100))
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'direct', 'directEnd'])
	})

	test('mouse released below the threshold is a click (onTap), whatever it lasted; pen only within TAP_MS', () => {
		const { el, log, clock } = setup({ wantsPan: () => true, deferPan: (e) => (e.pointerType === 'mouse' ? 3 : 10) })
		el.fire('pointerdown', mouse(1, 100, 100))
		el.fire('pointermove', mouse(1, 102, 100))
		clock.t += 2000
		el.fire('pointerup', mouse(1, 102, 100))
		assert.deepEqual(log, [['tap', 1, 'mouse']])
		const pen = (type, x, y) => el.fire(type, { ...mouse(4, x, y), pointerType: 'pen' })
		pen('pointerdown', 100, 100)
		pen('pointermove', 108, 100)
		clock.t += 300
		pen('pointerup', 108, 100)
		assert.deepEqual(log.at(-1), ['tap', 4, 'pen'])
		pen('pointerdown', 100, 100)
		clock.t += TAP_MS + 1
		pen('pointerup', 100, 100)
		assert.equal(log.length, 2, 'a long pen press is no tap')
	})

	test('deferPan 0 pans at once (M0); a finger during an armed press stays inert; destroy forgets it', () => {
		const { el, g, log } = setup({ wantsPan: () => true, deferPan: (e) => (e.button === 0 ? 3 : 0), claimTouch: () => true })
		el.fire('pointerdown', mouse(1, 100, 100, 1))
		assert.equal(g.panning, true, 'middle button: at once')
		el.fire('pointerup', mouse(1, 100, 100, 1))
		el.fire('pointerdown', mouse(2, 100, 100))
		el.fire('pointerdown', touch(5, 300, 300))
		assert.equal(g.owns(5), false)
		assert.equal(g.isClaimed(5), false)
		el.fire('pointerup', touch(5, 300, 300))
		assert.ok(!log.some((x) => x[0] === 'tap' && x[1] === 5))
		g.destroy()
		assert.equal(g.pending, false)
		assert.deepEqual(kinds(log), ['directStart', 'directEnd'])
	})
})

describe('hold, then drag: the hold timer of a pending first finger (R38, SPEC-M1 §6.3)', () => {
	/**
	 * @param {boolean} answer what the longPress spy returns
	 * @param {object} [opts] more controller options
	 * @return {object} setup() plus `asked`, the longPress calls [id, p]
	 */
	function holdSetup(answer = true, opts = {}) {
		const asked = []
		const s = setup({
			longPress: (id, p) => {
				asked.push([id, p])
				return answer
			},
			...opts,
		})
		return { ...s, asked }
	}

	/** @return {Array} the open hold timers */
	const holds = (timers) => timers.pending.filter((t) => t.ms === LONG_PRESS_MS)

	/** The hold time passes: the clock moves on and every open timer runs. */
	const expire = ({ clock, timers }) => {
		clock.t += LONG_PRESS_MS
		timers.runAll()
	}

	test('LONG_PRESS_MS is 500 ms; a first unclaimed finger opens exactly one hold timer, none in view-only mode', () => {
		assert.equal(LONG_PRESS_MS, 500)
		const { el, timers } = holdSetup()
		el.fire('pointerdown', touch(1, 100, 100))
		assert.equal(timers.pending.length, 1)
		assert.equal(timers.pending[0].ms, LONG_PRESS_MS)
		const v = holdSetup(true, { viewOnly: () => true })
		v.el.fire('pointerdown', touch(1, 100, 100))
		assert.deepEqual(v.timers.pending, [], 'view-only: no timer')
		expire(v)
		assert.deepEqual(v.asked, [])
		assert.equal(v.g.pending, true)
	})

	test('a claimed finger (item, handle, create tool) opens no hold timer', () => {
		const s = holdSetup(true, { claimTouch: () => true })
		s.el.fire('pointerdown', touch(1, 100, 100))
		assert.deepEqual(s.timers.pending, [])
		expire(s)
		assert.deepEqual(s.asked, [])
	})

	test('the timer runs out, longPress says true: asked once with the pointerdown point; the finger is claimed (no pan, no tap)', () => {
		const s = holdSetup(true)
		const { el, g, log, asked } = s
		el.fire('pointerdown', touch(4, 120, 80))
		el.fire('pointermove', touch(4, 126, 84))
		expire(s)
		assert.deepEqual(asked, [[4, { x: 120, y: 80 }]], 'once, container px of the pointerdown (not of the last move)')
		assert.equal(g.pending, false)
		assert.equal(g.active, false)
		assert.equal(g.owns(4), false, 'the input controller handles it now')
		assert.equal(g.isClaimed(4), true)
		el.fire('pointermove', touch(4, 300, 260))
		el.fire('pointermove', touch(4, 500, 400))
		assert.deepEqual(log, [], 'no start, no frame')
		el.fire('pointerup', touch(4, 500, 400))
		assert.deepEqual(log, [], 'no tap')
		assert.equal(g.isClaimed(4), false)
		expire(s)
		assert.equal(asked.length, 1, 'never asked twice')
	})

	test('after a true: a second finger cancels the claim once and both fingers pinch', () => {
		let cancelled = 0
		const s = holdSetup(true, { cancelClaim: () => { cancelled++ } })
		const { el, g, log } = s
		el.fire('pointerdown', touch(1, 100, 100))
		expire(s)
		el.fire('pointerdown', touch(2, 300, 100))
		assert.equal(cancelled, 1)
		assert.deepEqual(kinds(log), ['start'], 'the pinch starts')
		assert.equal(g.isClaimed(1), false)
		assert.equal(g.owns(1), true)
		el.fire('pointermove', touch(2, 500, 100))
		near(log.at(-1)[1].scale, 2)
	})

	for (const [name, answer] of [['longPress says false', false], ['no longPress option', null]]) {
		test(`${name}: the finger stays pending; a move pans as before (the first frame covers the whole way); its late release is no tap`, () => {
			const s = answer === null ? setup() : holdSetup(answer)
			const { el, g, log } = s
			el.fire('pointerdown', touch(1, 100, 100))
			if (answer === null) assert.deepEqual(s.timers.pending, [], 'no option: no timer at all')
			expire(s)
			if (answer !== null) assert.equal(s.asked.length, 1)
			assert.equal(g.pending, true)
			assert.equal(g.owns(1), true)
			assert.equal(g.isClaimed(1), false)
			el.fire('pointermove', touch(1, 60, 100))
			assert.deepEqual(log, [['start', { x: 0, y: 0, scale: 1 }], ['frame', { x: 40, y: 0, scale: 1 }]])
			el.fire('pointerup', touch(1, 60, 100))
			assert.deepEqual(kinds(log), ['start', 'frame', 'end'])
			el.fire('pointerdown', touch(2, 100, 100))
			expire(s)
			s.clock.t += 1
			el.fire('pointerup', touch(2, 100, 100))
			assert.deepEqual(kinds(log), ['start', 'frame', 'end'], 'held longer than TAP_MS: no tap, nothing')
		})
	}

	test('before it runs out a move beyond TAP_SLOP_PX, pointerup, pointercancel or a second finger clears the timer; longPress is never asked', () => {
		const cases = {
			move: (el) => {
				el.fire('pointermove', touch(1, 100, 100 + TAP_SLOP_PX + 1))
				return ['start', 'frame']
			},
			pointerup: (el) => {
				el.fire('pointerup', touch(1, 100, 100))
				return ['tap']
			},
			pointercancel: (el) => {
				el.fire('pointercancel', touch(1, 100, 100))
				return []
			},
			'second finger': (el) => {
				el.fire('pointerdown', touch(2, 300, 100))
				return ['start']
			},
		}
		for (const [name, act] of Object.entries(cases)) {
			const s = holdSetup(true)
			s.el.fire('pointerdown', touch(1, 100, 100))
			assert.equal(holds(s.timers).length, 1, name)
			const want = act(s.el)
			assert.deepEqual(holds(s.timers), [], name + ': the hold timer is cleared')
			assert.deepEqual(kinds(s.log), want, name + ': as before')
			expire(s)
			assert.deepEqual(s.asked, [], name + ': longPress never asked')
		}
	})

	test('a mouse or pen pointerdown while the finger waits clears the timer (a resting palm gets no signal); the finger no longer waits (the pen goes first)', () => {
		for (const pointerType of ['mouse', 'pen']) {
			const s = holdSetup(true)
			s.el.fire('pointerdown', touch(1, 100, 100))
			assert.equal(holds(s.timers).length, 1, pointerType)
			s.el.fire('pointerdown', { ...mouse(2, 300, 300), pointerType })
			assert.deepEqual(holds(s.timers), [], pointerType + ': the hold timer is cleared')
			s.el.fire('pointerup', { ...mouse(2, 300, 300), pointerType })
			expire(s)
			assert.deepEqual(s.asked, [], pointerType + ': longPress never asked')
			assert.equal(s.g.pending, false, pointerType + ': the finger no longer waits')
			assert.equal(s.g.isClaimed(1), false)
		}
	})

	test('a move within TAP_SLOP_PX keeps the timer', () => {
		const s = holdSetup(true)
		s.el.fire('pointerdown', touch(1, 100, 100))
		s.el.fire('pointermove', touch(1, 106, 108))
		assert.equal(holds(s.timers).length, 1)
		expire(s)
		assert.equal(s.asked.length, 1)
	})

	test('destroy() and cancel() clear an open hold timer', () => {
		for (const end of ['destroy', 'cancel']) {
			const s = holdSetup(true)
			s.el.fire('pointerdown', touch(1, 100, 100))
			assert.equal(holds(s.timers).length, 1)
			s.g[end]()
			assert.deepEqual(holds(s.timers), [], end)
			expire(s)
			assert.deepEqual(s.asked, [], end)
		}
	})

	test('the mode turns view-only while the finger is held: the timer runs out without asking', () => {
		let viewOnly = false
		const s = holdSetup(true, { viewOnly: () => viewOnly })
		s.el.fire('pointerdown', touch(1, 100, 100))
		viewOnly = true
		expire(s)
		assert.deepEqual(s.asked, [])
		assert.equal(s.g.pending, true)
	})
})

/*
 * Job 134: the pen goes first. A pen press (pen or mouse, button 0 or 1, not
 * ignoreTarget) makes every finger that is down inert until it lifts and
 * keeps every finger that lands out, whatever the press does.
 */
describe('the pen goes first: fingers during a pen press (job 134)', () => {
	const pen = (id, x, y, button = 0) => ({ ...mouse(id, x, y, button), pointerType: 'pen' })
	const device = (pointerType) => (pointerType === 'pen' ? (x, y) => pen(9, x, y) : (x, y) => mouse(1, x, y))

	for (const pointerType of ['pen', 'mouse']) {
		test(`(a) ${pointerType}: a finger during the press (no wantsPan) is not asked, not owned, not claimed, no gesture, no tap; after the pointerup a new finger is asked again`, () => {
			const claims = []
			const { el, g, log, timers } = setup({ claimTouch: (e) => { claims.push(e.pointerId); return false }, longPress: () => true })
			const dev = device(pointerType)
			el.fire('pointerdown', dev(200, 200))
			assert.deepEqual(el.captured, [dev(0, 0).pointerId], 'the pointer is captured at the pointerdown')
			el.fire('pointerdown', touch(5, 50, 600))
			assert.deepEqual(claims, [], 'claimTouch is not asked')
			assert.equal(g.owns(5), false)
			assert.equal(g.isClaimed(5), false)
			assert.equal(g.pending, false)
			assert.deepEqual(timers.pending, [], 'no hold timer')
			el.fire('pointerdown', touch(6, 300, 600))
			el.fire('pointermove', touch(6, 400, 700))
			el.fire('pointermove', touch(5, 50, 700))
			assert.equal(g.active, false, 'no pan, no pinch')
			el.fire('pointerdown', touch(7, 500, 500))
			el.fire('pointerup', touch(7, 500, 500))
			el.fire('pointerup', touch(6, 400, 700))
			assert.deepEqual(log, [], 'no gesture, no tap')
			el.fire('pointerup', dev(200, 200))
			el.fire('pointerdown', touch(8, 10, 10))
			assert.deepEqual(claims, [8], 'a new finger is asked again')
			assert.equal(g.pending, true)
			el.fire('pointermove', touch(5, 50, 800))
			assert.equal(g.active, false, 'the finger from the press stays inert until it lifts')
		})
	}

	for (const wantsPan of [false, true]) {
		for (const still of [true, false]) {
			test(`(b) a waiting finger, then the pen (wantsPan ${wantsPan}): pending false, no hold timer, the finger ${still ? 'lifts: no tap' : 'moves: no pan'}${wantsPan ? '; the pan starts at once' : ''}`, () => {
				const asked = []
				const s = setup({ wantsPan: () => wantsPan, longPress: (id) => { asked.push(id); return true } })
				const { el, g, log, timers, clock } = s
				el.fire('pointerdown', touch(5, 50, 600))
				assert.equal(g.pending, true)
				el.fire('pointerdown', pen(9, 200, 200))
				assert.equal(g.pending, false)
				assert.equal(g.owns(5), false)
				assert.deepEqual(timers.pending.filter((t) => t.ms === LONG_PRESS_MS), [], 'the hold timer is gone')
				assert.deepEqual(log, wantsPan ? [['directStart']] : [], wantsPan ? 'directStart at once' : 'nothing')
				clock.t += 100
				if (still) {
					el.fire('pointerup', touch(5, 50, 600))
				} else {
					el.fire('pointermove', touch(5, 50, 700))
				}
				clock.t += LONG_PRESS_MS
				timers.runAll()
				assert.deepEqual(asked, [], 'no hold signal')
				assert.equal(g.active, false)
				el.fire('pointerup', pen(9, 200, 200))
				if (!still) el.fire('pointerup', touch(5, 50, 700))
				assert.deepEqual(kinds(log), wantsPan ? ['directStart', 'directEnd'] : [], 'no tap, no gesture')
			})
		}
	}

	for (const kind of ['pan', 'pinch']) {
		for (const wantsPan of [false, true]) {
			test(`(c) a running ${kind}, then the pen (wantsPan ${wantsPan}): next comes end with the live camera${wantsPan ? ', then directStart' : ''}; no frame after it`, () => {
				const { el, g, log } = setup({ wantsPan: () => wantsPan })
				el.fire('pointerdown', touch(1, 100, 100))
				if (kind === 'pinch') el.fire('pointerdown', touch(2, 300, 100))
				el.fire('pointermove', touch(1, 60, 100))
				assert.equal(g.active, true)
				const live = g.live
				const n = log.length
				el.fire('pointerdown', pen(9, 500, 500))
				assert.deepEqual(log.slice(n), [['end', live], ...(wantsPan ? [['directStart']] : [])])
				assert.equal(g.active, false)
				el.fire('pointermove', touch(1, 0, 100))
				if (kind === 'pinch') el.fire('pointermove', touch(2, 500, 100))
				el.fire('pointermove', pen(9, 490, 500))
				el.fire('pointerup', touch(1, 0, 100))
				if (kind === 'pinch') el.fire('pointerup', touch(2, 500, 100))
				el.fire('pointerup', pen(9, 490, 500))
				assert.ok(!kinds(log.slice(n)).includes('frame'), 'no frame after the end')
				assert.equal(kinds(log).filter((k) => k === 'end').length, 1)
				assert.deepEqual(kinds(log.slice(n)), wantsPan ? ['end', 'directStart', 'direct', 'directEnd'] : ['end'])
			})
		}
	}

	test('(d) a claimed finger, then the pen: isClaimed false; another finger neither cancels a claim nor starts a gesture', () => {
		let cancelled = 0
		const claims = []
		const { el, g, log } = setup({ claimTouch: (e) => { claims.push(e.pointerId); return true }, cancelClaim: () => { cancelled++ } })
		el.fire('pointerdown', touch(5, 700, 200))
		assert.equal(g.isClaimed(5), true)
		el.fire('pointerdown', pen(9, 200, 200))
		assert.equal(g.isClaimed(5), false)
		assert.equal(g.owns(5), false)
		el.fire('pointerdown', touch(6, 300, 600))
		el.fire('pointermove', touch(6, 400, 700))
		el.fire('pointermove', touch(5, 750, 250))
		assert.equal(cancelled, 0, 'no cancelClaim')
		assert.equal(g.active, false)
		assert.deepEqual(log, [])
		assert.deepEqual(claims, [5])
		el.fire('pointerup', pen(9, 200, 200))
		el.fire('pointerdown', touch(7, 500, 500))
		assert.equal(cancelled, 0, 'after the pen only new fingers count: no claim left to cancel')
		assert.deepEqual(claims, [5, 7], 'the new finger is a first finger')
		assert.equal(g.isClaimed(7), true)
	})

	test('(e) pointerup, pointercancel and a pointermove with buttons 0 end the pen press; cancel() does not; destroy() forgets it', () => {
		const ends = {
			pointerup: (el) => el.fire('pointerup', pen(9, 210, 200)),
			pointercancel: (el) => el.fire('pointercancel', pen(9, 210, 200)),
			'pointermove with buttons 0': (el) => el.fire('pointermove', { ...pen(9, 210, 200), buttons: 0 }),
		}
		for (const [name, end] of Object.entries(ends)) {
			const { el, g } = setup()
			el.fire('pointerdown', pen(9, 200, 200))
			el.fire('pointermove', { ...pen(9, 205, 200), buttons: 1 })
			el.fire('pointerdown', touch(5, 50, 600))
			assert.equal(g.pending, false, name + ': still pressed, the finger is inert')
			el.fire('pointerup', touch(5, 50, 600))
			end(el)
			el.fire('pointerdown', touch(6, 50, 600))
			assert.equal(g.pending, true, name + ': a new finger works again')
		}
		const c = setup()
		c.el.fire('pointerdown', pen(9, 200, 200))
		c.g.cancel()
		c.el.fire('pointerdown', touch(5, 50, 600))
		assert.equal(c.g.pending, false, 'cancel() does not end the pen press')
		const d = setup()
		const down = [...d.el.listeners.get('pointerdown')]
		d.el.fire('pointerdown', pen(9, 200, 200))
		d.g.destroy()
		// the listeners are gone; the old pointerdown listener shows the state destroy() left behind
		for (const fn of down) fn({ type: 'pointerdown', button: 0, ...touch(5, 50, 600), preventDefault() {} })
		assert.equal(d.g.pending, true, 'destroy() forgot the pen press')
	})

	// (job 168) a pen's button 2 is a pen press now (its side button): see 'pen right press (job 168)'
	for (const [name, opts, ev, types] of [
		['button 2 of the mouse', {}, (pointerType) => ({ ...mouse(9, 200, 200, 2), pointerType }), ['mouse']],
		['ignoreTarget true', { ignoreTarget: (e) => e.pointerId === 9 }, (pointerType) => ({ ...mouse(9, 200, 200), pointerType }), ['pen', 'mouse']],
	]) {
		test(`(f) ${name}: no pen press, a waiting finger stays pending`, () => {
			for (const pointerType of types) {
				const { el, g } = setup(opts)
				el.fire('pointerdown', touch(5, 50, 600))
				el.fire('pointerdown', ev(pointerType))
				assert.equal(g.pending, true, pointerType)
				assert.equal(g.owns(5), true, pointerType)
				el.fire('pointerdown', touch(6, 300, 600))
				assert.equal(g.active, true, pointerType + ': a second finger still pinches')
			}
		})
	}
})

describe('onTouchPan: the first move of a one-finger pan (job 142)', () => {
	/**
	 * @param {object} [opts] controller options to override
	 * @return {object} setup() plus pans: one entry per onTouchPan call (g.active at that moment)
	 */
	function panSetup(opts = {}) {
		const pans = []
		const s = setup({ ...opts, onTouchPan: () => pans.push(s.g.active) })
		return { ...s, pans }
	}
	const pen = (id, x, y) => ({ pointerId: id, pointerType: 'pen', clientX: x + 10, clientY: y + 20, button: 0 })

	test('exactly one call when a pending finger moves beyond TAP_SLOP_PX, with the pan already running; none before, none after', () => {
		const { el, g, pans } = panSetup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 100 + TAP_SLOP_PX, 100))
		assert.deepEqual(pans, [], 'at TAP_SLOP_PX the finger is still pending')
		assert.equal(g.pending, true)
		el.fire('pointermove', touch(1, 100 + TAP_SLOP_PX + 1, 100))
		assert.deepEqual(pans, [true], 'one call, the touch gesture is active')
		for (const x of [150, 200, 40]) el.fire('pointermove', touch(1, x, 100))
		el.fire('pointerup', touch(1, 40, 100))
		assert.deepEqual(pans, [true], 'still one call for this pan')
		el.fire('pointerdown', touch(2, 300, 300))
		el.fire('pointermove', touch(2, 300, 360))
		el.fire('pointerup', touch(2, 300, 360))
		assert.deepEqual(pans, [true, true], 'the next pan reports again')
	})

	test('the state machine stays as without the option: the same frames and camera', () => {
		const run = (opts) => {
			const { el, log } = setup(opts)
			el.fire('pointerdown', touch(1, 100, 100))
			el.fire('pointermove', touch(1, 60, 100))
			el.fire('pointermove', touch(1, -200, 50))
			el.fire('pointerup', touch(1, -200, 50))
			return log
		}
		assert.deepEqual(run({ onTouchPan: () => {} }), run({}))
	})

	test('no call for a tap, for a finger released within the slop after TAP_MS, or for pointercancel', () => {
		const { el, pans, clock } = panSetup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 105, 104))
		el.fire('pointerup', touch(1, 105, 104))
		el.fire('pointerdown', touch(2, 100, 100))
		clock.t += TAP_MS + 100
		el.fire('pointerup', touch(2, 100, 100))
		el.fire('pointerdown', touch(3, 100, 100))
		el.fire('pointercancel', touch(3, 100, 100))
		assert.deepEqual(pans, [])
	})

	test('no call for a hold that longPress took (marquee), not even when it moves on', () => {
		const { el, g, pans, timers } = panSetup({ longPress: () => true })
		el.fire('pointerdown', touch(1, 100, 100))
		timers.runAll()
		assert.equal(g.isClaimed(1), true)
		el.fire('pointermove', touch(1, 300, 300))
		el.fire('pointerup', touch(1, 300, 300))
		assert.deepEqual(pans, [])
	})

	test('a hold that longPress declined stays pending: its later move pans and reports once', () => {
		const { el, g, pans, timers } = panSetup({ longPress: () => false })
		el.fire('pointerdown', touch(1, 100, 100))
		timers.runAll()
		assert.equal(g.pending, true)
		el.fire('pointermove', touch(1, 100, 160))
		assert.deepEqual(pans, [true])
	})

	test('no call for a pinch (second finger before the move), nor for the finger left after it', () => {
		const { el, g, pans } = panSetup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointerdown', touch(2, 300, 100))
		el.fire('pointermove', touch(1, 50, 100))
		el.fire('pointermove', touch(2, 400, 100))
		el.fire('pointerup', touch(2, 400, 100))
		assert.equal(g.active, true, 'the left finger keeps panning in the same gesture')
		el.fire('pointermove', touch(1, 0, 0))
		el.fire('pointermove', touch(1, -100, -50))
		el.fire('pointerup', touch(1, -100, -50))
		assert.equal(g.active, false)
		assert.deepEqual(pans, [])
	})

	test('a second finger during the pan makes a pinch: no further call', () => {
		const { el, pans } = panSetup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 100, 150))
		el.fire('pointerdown', touch(2, 300, 300))
		el.fire('pointermove', touch(2, 350, 350))
		el.fire('pointerup', touch(2, 350, 350))
		el.fire('pointermove', touch(1, 0, 0))
		el.fire('pointerup', touch(1, 0, 0))
		assert.deepEqual(pans, [true])
	})

	test('no call for a claimed finger (an item drag, a create tool)', () => {
		const { el, pans } = panSetup({ claimTouch: () => true })
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 300, 300))
		el.fire('pointerup', touch(1, 300, 300))
		assert.deepEqual(pans, [])
	})

	test('no call for a mouse or pen pan, at once or deferred, nor for the middle button', () => {
		for (const deferPan of [() => 0, () => 3]) {
			const { el, g, pans } = panSetup({ wantsPan: () => true, deferPan })
			for (const [down, move] of [
				[mouse(1, 100, 100), mouse(1, 300, 300)],
				[pen(2, 100, 100), pen(2, 300, 300)],
				[mouse(3, 100, 100, 1), mouse(3, 300, 300, 1)],
			]) {
				el.fire('pointerdown', down)
				el.fire('pointermove', { ...move, buttons: 1 })
				assert.equal(g.panning, true, down.pointerType + ' pans')
				el.fire('pointerup', move)
			}
			assert.deepEqual(pans, [])
		}
	})

	test('no call for a pending finger that a pen press made inert, nor for the wheel', () => {
		const { el, pans, timers } = panSetup()
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointerdown', pen(2, 500, 500))
		el.fire('pointermove', touch(1, 300, 300))
		el.fire('pointerup', pen(2, 500, 500))
		el.fire('pointerup', touch(1, 300, 300))
		el.fire('wheel', { deltaX: 40, deltaY: 30, deltaMode: 0, clientX: 0, clientY: 0 })
		el.fire('wheel', { ctrlKey: true, deltaY: -60, deltaX: 0, deltaMode: 0, clientX: 510, clientY: 420 })
		timers.runAll()
		assert.deepEqual(pans, [])
	})
})

describe('right-drag (job 156): a deferred right-button press of the mouse', () => {
	/** @return {object} setup with the scene's options for the right button: it pans beyond 3 px */
	const rightSetup = () => setup({ wantsPan: (e) => e.button === 2, deferPan: (e) => (e.button === 2 ? 3 : 0) })
	/** A right-button pointer event of mouse 1 (button 2 for down/up/cancel, -1 for a move) with `buttons`. */
	const right = (type, x, y, buttons) => ({ ...mouse(1, x, y, type === 'pointermove' ? -1 : 2), buttons })

	test('a click reaches onTap with the button of its pointerdown (2), a finger\'s tap without one', () => {
		const taps = []
		const { el } = setup({ wantsPan: (e) => e.button === 2, deferPan: () => 3, onTap: (e, button) => taps.push([e.pointerType, button]) })
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		el.fire('pointermove', right('pointermove', 103, 100, 2))
		el.fire('pointerup', right('pointerup', 103, 100, 0))
		el.fire('pointerdown', touch(5, 300, 300))
		el.fire('pointerup', touch(5, 300, 300))
		assert.deepEqual(taps, [['mouse', 2], ['touch', undefined]])
	})

	test('pointercancel while armed: no tap, nothing pending; while panning: directEnd', () => {
		const { el, g, log } = rightSetup()
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		el.fire('pointercancel', right('pointercancel', 100, 100, 0))
		assert.equal(g.pending, false)
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		el.fire('pointermove', right('pointermove', 90, 100, 2))
		assert.equal(g.panning, true)
		el.fire('pointercancel', right('pointercancel', 90, 100, 0))
		assert.equal(g.panning, false)
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'directEnd'], 'no tap')
	})

	test('a pointermove without the right button while armed (a missed pointerup): no tap at a later pointerup; the wheel pans again', () => {
		const { el, g, log, cam, timers } = rightSetup()
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		el.fire('wheel', { deltaX: 0, deltaY: 50, deltaMode: 0, clientX: 0, clientY: 0 })
		assert.equal(g.active, false, 'the wheel is swallowed while the press is armed')
		el.fire('pointermove', right('pointermove', 101, 100, 0))
		assert.equal(g.pending, false)
		assert.equal(g.owns(1), false)
		el.fire('pointerup', right('pointerup', 101, 100, 0))
		assert.deepEqual(log, [], 'no tap, no pan')
		el.fire('wheel', { deltaX: 0, deltaY: 50, deltaMode: 0, clientX: 0, clientY: 0 })
		assert.equal(g.active, true)
		timers.runAll()
		assert.deepEqual(cam, { x: 0, y: 50, scale: 1 })
	})

	test('a pointermove without the right button while panning ends the pan (directEnd); later moves do not pan', () => {
		const { el, g, log } = rightSetup()
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		el.fire('pointermove', right('pointermove', 80, 100, 2))
		el.fire('pointermove', right('pointermove', 60, 100, 1))
		el.fire('pointermove', right('pointermove', 40, 100, 0))
		assert.equal(g.panning, false)
		assert.deepEqual(log, [['directStart'], ['direct', { x: 20, y: 0, scale: 1 }], ['directEnd']], 'buttons 1 (only the left one): the right one is up')
	})

	test('buttons 2 (or 3, with the left one too) keep the press; a deferred left press ignores buttons', () => {
		const { el, g, log } = rightSetup()
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		el.fire('pointermove', right('pointermove', 101, 100, 3))
		assert.equal(g.pending, true)
		el.fire('pointermove', right('pointermove', 90, 100, 2))
		assert.equal(g.panning, true)
		el.fire('pointerup', right('pointerup', 90, 100, 0))
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'directEnd'])
		const v = setup({ wantsPan: () => true, deferPan: () => 3 })
		v.el.fire('pointerdown', mouse(2, 100, 100))
		v.el.fire('pointermove', { ...mouse(2, 101, 100), buttons: 2 })
		assert.equal(v.g.pending, true, 'a vote press (button 0) stays armed')
	})

	test('during a touch gesture a right press does nothing; a running wheel gesture ends first', () => {
		const { el, g, log } = rightSetup()
		el.fire('pointerdown', touch(5, 300, 300))
		el.fire('pointermove', touch(5, 250, 300))
		assert.equal(g.mode, 'touch')
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		assert.equal(g.pending, false)
		el.fire('pointermove', right('pointermove', 50, 100, 2))
		el.fire('pointerup', right('pointerup', 50, 100, 0))
		assert.ok(!kinds(log).includes('directStart') && !kinds(log).includes('tap'), JSON.stringify(log))
		el.fire('pointerup', touch(5, 250, 300))
		el.fire('wheel', { deltaX: 0, deltaY: 50, deltaMode: 0, clientX: 0, clientY: 0 })
		assert.equal(g.mode, 'wheel')
		el.fire('pointerdown', right('pointerdown', 100, 100, 2))
		assert.equal(g.mode, null, 'the wheel gesture ended (commit)')
		assert.equal(log.at(-1)[0], 'end')
		assert.equal(g.pending, true)
	})
})

describe('pen right press (job 168): the side button pans, the pen goes first', () => {
	/** @return {object} setup() with the scene's options for right presses (pen TAP_SLOP_PX, mouse 3 px) and taps [pointerType, button] */
	function penSetup(opts = {}) {
		const taps = []
		const s = setup({
			wantsPan: (e) => isRightPress(e),
			deferPan: (e) => (isRightPress(e) ? (e.pointerType === 'pen' ? TAP_SLOP_PX : 3) : 0),
			onTap: (e, button) => taps.push([e.pointerType, button]),
			...opts,
		})
		return { ...s, taps }
	}
	/** A pen event of pointer 9 (container point x, y) with button and buttons. */
	const pen = (x, y, button, buttons) => ({ pointerId: 9, pointerType: 'pen', clientX: x + 10, clientY: y + 20, button, buttons })
	/** the side button reported as button 2, and as bit 2 in buttons with button 0 */
	const DOWNS = [['button 2', 2, 2], ['button 0 with buttons 3', 0, 3]]

	test('isRightPress: the mouse\'s button 2; the pen\'s button 2 or button 0 with bit 2 in buttons; nothing else', () => {
		const yes = [{ pointerType: 'mouse', button: 2, buttons: 2 }, { pointerType: 'pen', button: 2, buttons: 2 }, { pointerType: 'pen', button: 0, buttons: 3 }, { pointerType: 'pen', button: 0, buttons: 2 }]
		const no = [{ pointerType: 'mouse', button: 0, buttons: 3 }, { pointerType: 'pen', button: 0, buttons: 1 }, { pointerType: 'pen', button: 0 }, { pointerType: 'pen', button: 5, buttons: 32 }, { pointerType: 'touch', button: 2, buttons: 2 }, { pointerType: 'mouse', button: 1, buttons: 4 }]
		assert.deepEqual(yes.map(isRightPress), yes.map(() => true))
		assert.deepEqual(no.map(isRightPress), no.map(() => false))
	})

	for (const [name, button, buttons] of DOWNS) {
		for (const end of ['buttons 0', 'pointercancel']) {
			test(`AK3 ${name}, a waiting finger: it drops out; 10 px keep the camera, then only the pen's way pans, buttons 1 pans on; ${end} ends the pan without a tap, the wheel pans again`, () => {
				const { el, g, log, cam, timers, taps } = penSetup({ longPress: () => true })
				el.fire('pointerdown', touch(5, 50, 600))
				assert.equal(g.pending, true)
				el.fire('pointerdown', pen(200, 200, button, buttons))
				assert.equal(g.owns(5), false, 'the finger lost its effect')
				assert.ok(el.captured.includes(9), 'the pen is captured')
				el.fire('pointermove', pen(210, 200, -1, buttons))
				el.fire('pointermove', touch(5, 300, 600))
				assert.deepEqual(log, [], '10 px: no pan; the finger does nothing')
				el.fire('pointermove', pen(150, 180, -1, buttons))
				assert.deepEqual(cam, { x: 50, y: 20, scale: 1 }, 'the first step pans the whole way since the pointerdown')
				el.fire('pointermove', touch(5, 500, 700))
				el.fire('pointermove', pen(140, 180, -1, 1))
				assert.deepEqual(cam, { x: 60, y: 20, scale: 1 }, 'buttons 1 (the side button let go, the tip down) pans on')
				if (end === 'buttons 0') el.fire('pointermove', pen(130, 180, -1, 0))
				else el.fire('pointercancel', pen(130, 180, button, 0))
				assert.equal(g.panning, false)
				el.fire('pointermove', pen(100, 180, -1, 0))
				el.fire('pointerup', pen(100, 180, button, 0))
				el.fire('pointerup', touch(5, 500, 700))
				assert.deepEqual(kinds(log), ['directStart', 'direct', 'direct', 'directEnd'], 'no gesture of the finger')
				assert.deepEqual(cam, { x: 60, y: 20, scale: 1 })
				assert.deepEqual(taps, [], 'no tap')
				el.fire('wheel', { deltaX: 0, deltaY: 50, deltaMode: 0, clientX: 0, clientY: 0 })
				assert.equal(g.active, true, 'the wheel starts a gesture again')
				timers.runAll()
				assert.deepEqual(cam, { x: 60, y: 70, scale: 1 })
			})
		}

		test(`AK3 ${name}, a running one-finger pan: it ends with its live camera first (onGestureEnd), then only the pen's way pans`, () => {
			const { el, g, log, cam, taps } = penSetup()
			el.fire('pointerdown', touch(5, 100, 100))
			el.fire('pointermove', touch(5, 60, 100))
			assert.equal(g.mode, 'touch')
			const live = g.live
			const n = log.length
			el.fire('pointerdown', pen(500, 500, button, buttons))
			assert.deepEqual(log.slice(n), [['end', live]])
			assert.equal(g.active, false)
			el.fire('pointermove', touch(5, 0, 100))
			el.fire('pointermove', pen(480, 500, -1, buttons))
			el.fire('pointermove', touch(5, -100, 100))
			el.fire('pointermove', pen(470, 490, -1, 1))
			el.fire('pointerup', pen(470, 490, button, 0))
			el.fire('pointerup', touch(5, -100, 100))
			assert.deepEqual(cam, { x: live.x + 30, y: live.y + 10, scale: 1 })
			assert.deepEqual(kinds(log.slice(n)), ['end', 'directStart', 'direct', 'direct', 'directEnd'])
			assert.deepEqual(taps, [])
		})
	}

	test('a pen right click: released within TAP_SLOP_PX, however long held (no TAP_MS), onTap(e, 2); 11 px pan without a tap; the mouse\'s right press stays no pen press', () => {
		const { el, g, log, clock, taps } = penSetup()
		el.fire('pointerdown', pen(200, 200, 2, 2))
		clock.t += 4 * TAP_MS
		el.fire('pointermove', pen(210, 200, -1, 1))
		el.fire('pointerup', pen(210, 200, 2, 0))
		el.fire('pointerdown', pen(200, 200, 0, 3))
		el.fire('pointerup', pen(206, 208, 0, 0))
		el.fire('pointerdown', pen(200, 200, 2, 2))
		el.fire('pointermove', pen(211, 200, -1, 2))
		el.fire('pointerup', pen(211, 200, 2, 0))
		assert.deepEqual(taps, [['pen', 2], ['pen', 2]])
		assert.deepEqual(kinds(log), ['directStart', 'direct', 'directEnd'])
		el.fire('pointerdown', touch(5, 50, 600))
		el.fire('pointerdown', { ...mouse(1, 200, 200, 2), buttons: 2 })
		assert.equal(g.owns(5), true, 'a waiting finger stays with a mouse right press')
	})
})

describe('claimDrag: a waiting first finger beyond TAP_SLOP_PX (job 163)', () => {
	/**
	 * @param {boolean|null} answer what the claimDrag spy returns (null: no claimDrag option)
	 * @param {object} [opts] more controller options
	 * @return {object} setup() plus asked (the claimDrag calls [id, p]) and pans (one entry per onTouchPan)
	 */
	function dragSetup(answer, opts = {}) {
		const asked = []
		const pans = []
		const claimDrag = (id, p) => {
			asked.push([id, p])
			return answer
		}
		const s = setup({ ...(answer === null ? {} : { claimDrag }), onTouchPan: () => pans.push(1), ...opts })
		return { ...s, asked, pans }
	}

	test('asked exactly once with the pointerId and the pointerdown point; true: claimed, no gesture, no camera, no onTouchPan, no tap at the release', () => {
		const { el, g, log, cam, asked, pans } = dragSetup(true)
		el.fire('pointerdown', touch(4, 120, 80))
		el.fire('pointermove', touch(4, 120 + TAP_SLOP_PX, 80))
		assert.deepEqual(asked, [], 'at TAP_SLOP_PX the finger still waits')
		el.fire('pointermove', touch(4, 140, 86))
		assert.deepEqual(asked, [[4, { x: 120, y: 80 }]], 'container px of the pointerdown, not of the move')
		assert.equal(g.isClaimed(4), true)
		assert.equal(g.owns(4), false, 'the input controller handles it now')
		assert.equal(g.pending, false)
		assert.equal(g.active, false)
		el.fire('pointermove', touch(4, 300, 200))
		// back near the pointerdown and released quickly: as a waiting finger this would be a tap
		el.fire('pointermove', touch(4, 121, 80))
		el.fire('pointerup', touch(4, 121, 80))
		assert.deepEqual(log, [], 'no start, no frame, no tap')
		assert.deepEqual(cam, { x: 0, y: 0, scale: 1 })
		assert.deepEqual(pans, [])
		assert.equal(asked.length, 1, 'never asked twice')
		assert.equal(g.isClaimed(4), false)
	})

	test('after a true: a second finger cancels the claim once and both fingers pinch', () => {
		let cancelled = 0
		const { el, g, log } = dragSetup(true, { cancelClaim: () => { cancelled++ } })
		el.fire('pointerdown', touch(1, 100, 100))
		el.fire('pointermove', touch(1, 130, 100))
		assert.equal(g.isClaimed(1), true)
		el.fire('pointerdown', touch(2, 300, 100))
		assert.equal(cancelled, 1)
		assert.deepEqual(kinds(log), ['start'], 'the pinch starts')
		assert.equal(g.isClaimed(1), false)
	})

	for (const [name, answer] of [['claimDrag says false', false], ['no claimDrag option', null]]) {
		test(`${name}: the pan starts as before (the first frame covers the whole way), onTouchPan once`, () => {
			const { el, g, log, asked, pans } = dragSetup(answer)
			el.fire('pointerdown', touch(1, 100, 100))
			el.fire('pointermove', touch(1, 60, 100))
			assert.deepEqual(log, [['start', { x: 0, y: 0, scale: 1 }], ['frame', { x: 40, y: 0, scale: 1 }]])
			assert.equal(g.isClaimed(1), false)
			el.fire('pointermove', touch(1, 20, 100))
			el.fire('pointerup', touch(1, 20, 100))
			assert.deepEqual(kinds(log), ['start', 'frame', 'frame', 'end'])
			assert.deepEqual(pans, [1])
			assert.deepEqual(asked, answer === null ? [] : [[1, { x: 100, y: 100 }]], 'asked once, before the pan')
		})
	}

	test('not asked for a claimed finger, a tap, a hold that longPress took, a pinch, nor in view-only mode', () => {
		const claimed = dragSetup(true, { claimTouch: () => true })
		claimed.el.fire('pointerdown', touch(1, 100, 100))
		claimed.el.fire('pointermove', touch(1, 300, 100))
		claimed.el.fire('pointerup', touch(1, 300, 100))
		assert.deepEqual(claimed.asked, [], 'claimTouch took it')
		const tap = dragSetup(true)
		tap.el.fire('pointerdown', touch(1, 100, 100))
		tap.el.fire('pointermove', touch(1, 106, 104))
		tap.el.fire('pointerup', touch(1, 106, 104))
		assert.deepEqual(kinds(tap.log), ['tap'])
		assert.deepEqual(tap.asked, [], 'a tap')
		const hold = dragSetup(true, { longPress: () => true })
		hold.el.fire('pointerdown', touch(1, 100, 100))
		hold.timers.runAll()
		hold.el.fire('pointermove', touch(1, 300, 300))
		hold.el.fire('pointerup', touch(1, 300, 300))
		assert.deepEqual(hold.asked, [], 'a hold that became a marquee')
		const pinch = dragSetup(true)
		pinch.el.fire('pointerdown', touch(1, 100, 100))
		pinch.el.fire('pointerdown', touch(2, 300, 100))
		pinch.el.fire('pointermove', touch(1, 40, 100))
		pinch.el.fire('pointermove', touch(2, 400, 100))
		assert.deepEqual(pinch.asked, [], 'a pinch')
		const view = dragSetup(true, { viewOnly: () => true })
		view.el.fire('pointerdown', touch(1, 100, 100))
		view.el.fire('pointermove', touch(1, 60, 100))
		assert.deepEqual(view.asked, [], 'view-only')
		assert.deepEqual(kinds(view.log), ['start', 'frame'], 'view-only: it pans')
		assert.deepEqual(view.pans, [1])
	})
})

describe('lifecycle', () => {
	test('cancel ends a running gesture with a commit', () => {
		const { el, g, log } = setup()
		el.fire('pointerdown', touch(1, 0, 0))
		el.fire('pointermove', touch(1, -50, 0))
		g.cancel()
		assert.equal(g.active, false)
		assert.deepEqual(log.at(-1), ['end', { x: 50, y: 0, scale: 1 }])
	})

	test('gesturestart (WebKit pinch zoom) is prevented', () => {
		const { el } = setup()
		assert.equal(el.fire('gesturestart', {}), true)
	})

	test('destroy removes every listener', () => {
		const { el, g } = setup()
		g.destroy()
		for (const set of el.listeners.values()) assert.equal(set.size, 0)
	})
})
