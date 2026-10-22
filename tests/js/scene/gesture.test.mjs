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
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { GestureController, LONG_PRESS_MS, TAP_MS, TAP_SLOP_PX, WHEEL_END_MS } from '../../../src/scene/GestureController.js'

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
		assert.equal(log.at(-1)[1].scale, 4)
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

	test('a mouse/pen pan does not start during a touch gesture, nor while a finger may still become one', () => {
		const { el, g, log } = setup({ wantsPan: () => true })
		el.fire('pointerdown', touch(1, 0, 0))
		el.fire('pointerdown', mouse(2, 100, 100, 1))
		assert.equal(g.panning, false, 'pending finger')
		el.fire('pointermove', mouse(2, 50, 100))
		assert.deepEqual(log, [])
		el.fire('pointerup', mouse(2, 50, 100))
		el.fire('pointermove', touch(1, -20, 0))
		el.fire('pointerdown', mouse(3, 100, 100, 1))
		assert.equal(g.panning, false, 'touch gesture')
		el.fire('pointermove', mouse(3, 50, 100))
		assert.deepEqual(kinds(log), ['start', 'frame'])
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

	test('a mouse or pen pointerdown while the finger waits clears the timer (a resting palm gets no signal); the finger stays pending as before', () => {
		for (const pointerType of ['mouse', 'pen']) {
			const s = holdSetup(true)
			s.el.fire('pointerdown', touch(1, 100, 100))
			assert.equal(holds(s.timers).length, 1, pointerType)
			s.el.fire('pointerdown', { ...mouse(2, 300, 300), pointerType })
			assert.deepEqual(holds(s.timers), [], pointerType + ': the hold timer is cleared')
			s.el.fire('pointerup', { ...mouse(2, 300, 300), pointerType })
			expire(s)
			assert.deepEqual(s.asked, [], pointerType + ': longPress never asked')
			assert.equal(s.g.pending, true, pointerType + ': the finger still waits')
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
