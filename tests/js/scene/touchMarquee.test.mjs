/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (R38, SPEC-M1 §6.3 "Halten, dann Ziehen") The touch marquee: a finger
 * held still on empty canvas for LONG_PRESS_MS in mode edit with the select
 * tool gets the hold signal (a ring under the finger in the scene overlay,
 * one vibration where navigator.vibrate exists); dragging it beyond
 * TAP_SLOP_PX then draws the marquee and selects live by the rules of the
 * mouse marquee without Shift (the selection is replaced), without moving
 * the camera. Before: a finger on empty canvas could only pan.
 *
 * Deterministic in Node on the fake DOM with the real SceneManager,
 * InputController, GestureController and SceneModel (renderer stubbed);
 * the hold timer is the GestureController's default setTimeout, replaced by
 * mock.timers. Notes A (100, 100) and B (600, 100), 200 × 200, camera
 * (0, 0, 1), container 1000 × 800. Covered:
 * - AK1 hold, signal (ring, one vibration of 20 ms), drag: {A, B}; the ring
 *   stays at the start, no camera move, no intent, the marquee is cleared
 * - AK2 the same selection as a mouse marquee (frame only when whole, its
 *   content from its empty inside, groups whole, locked items and partly
 *   covered connectors never), the earlier selection is replaced
 * - AK3 a quick drag pans (no ring, no vibration, no marquee); a hold with
 *   jitter below TAP_SLOP_PX changes nothing
 * - AK4 hand tool, modes vote and view (no hold timer at all), a finger on
 *   an item (drag as before), the mouse (marquee at once): unchanged
 * - AK5 a second finger (pinch), pointercancel, Esc, a mode switch and
 *   destroy end the marquee and the ring without an intent
 * - AK7 Android's contextmenu during the hold: prevented, no menu, the
 *   signal still comes
 * - AK10 no navigator.vibrate, or one that throws: the ring alone, no error;
 *   one vibration per signal, none when the ring goes
 * - an item another client puts under the finger during the hold: no signal
 * - (round-1 UX B2) a pen or mouse goes before a held finger, e.g. a palm
 *   resting on a pen tablet: its pointerdown ends the hold press like Esc
 *   and works as usual; one while the finger still waits means no signal
 * - (052, job 134) a third contact during that pen or mouse drag: the press
 *   goes on (exactly one move), the palm and the new contact neither pan nor
 *   zoom; a second finger during a finger's drag still ends it like Esc (no
 *   move)
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { HOLD_RING_PX, LONG_PRESS_VIBRATE_MS } from '../../../src/model/tokens.js'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

/** A at (100, 100), B at (600, 100), both 200 × 200; empty canvas around them. */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100, z: 'a2' })]

const NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const REPORT_ERROR = Object.getOwnPropertyDescriptor(globalThis, 'reportError')

/** @param {unknown} value what globalThis.navigator is for this case */
function setNavigator(value) {
	Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}

/** @return {Array<Array>} the calls of a navigator.vibrate spy (answers true) */
function spyVibrate() {
	const calls = []
	setNavigator({ vibrate: (...args) => { calls.push(args); return true } })
	return calls
}

/** @return {Array} errors handed to reportError (the scene's reportAsync) from now on */
function spyReportError() {
	const errors = []
	Object.defineProperty(globalThis, 'reportError', { value: (e) => errors.push(e), configurable: true, writable: true })
	return errors
}

let h = null
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
	if (NAVIGATOR) Object.defineProperty(globalThis, 'navigator', NAVIGATOR)
	else delete globalThis.navigator
	if (REPORT_ERROR) Object.defineProperty(globalThis, 'reportError', REPORT_ERROR)
	else delete globalThis.reportError
})

/**
 * Fake timers first, then the scene.
 *
 * @param {object[]} [items] WireItems
 * @param {object} [opts] setupScene options
 * @return {object} sceneHarness
 */
function setup(items = notes(), opts = {}) {
	mock.timers.enable({ apis: ['setTimeout'] })
	h = setupScene(items, opts)
	return h
}

const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })
const down = (x, y, id = 5) => h.pointer('pointerdown', x, y, finger(id))
const move = (x, y, id = 5) => {
	h.pointer('pointermove', x, y, finger(id))
	h.frame()
}
const up = (x, y, id = 5) => {
	h.pointer('pointerup', x, y, finger(id))
	h.frame()
}
/** Finger down and held still for LONG_PRESS_MS. */
const hold = (x, y, id = 5) => {
	down(x, y, id)
	mock.timers.tick(LONG_PRESS_MS)
}

/** @return {object[]} the ring elements in the scene */
const rings = () => h.container.descendants().filter((el) => el.hasAttribute('data-knorke-hold-ring'))
const holdRing = () => h.scene.stats().holdRing
/** @return {Array} non-null setMarquee calls [rect, kind] */
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null)
const sorted = (ids) => [...ids].sort()
const userCameras = () => h.log.filter((e) => e[0] === 'onUserCamera').length
const gestureActivity = () => h.log.filter((e) => e[0] === 'onActivity' && e[1].kind === 'gesture').length

/** The ring is gone: no element, stats().holdRing null. */
function assertNoRing(msg = '') {
	assert.equal(holdRing(), null, 'stats().holdRing ' + msg)
	assert.deepEqual(rings(), [], 'no ring element ' + msg)
}

/** The path of AK1 after the hold: over (420, 360) to (850, 360), then up. */
function dragAK1(id = 5) {
	const gesture = []
	for (const [x, y] of [[420, 360], [850, 360]]) {
		move(x, y, id)
		gesture.push(h.scene.stats().gestureActive)
	}
	up(850, 360, id)
	return gesture
}

describe('AK1: hold, signal, drag selects', () => {
	test('the ring and one vibration come at LONG_PRESS_MS, not before; the drag selects {A, B}; no camera move, no intent', () => {
		setup()
		const vib = spyVibrate()
		const cam = h.scene.getCamera()
		down(50, 50)
		mock.timers.tick(LONG_PRESS_MS - 1)
		assertNoRing('before 500 ms')
		assert.deepEqual(vib, [], 'no vibration before 500 ms')
		mock.timers.tick(1)
		assert.deepEqual(holdRing(), { x: 50, y: 50 })
		const list = rings()
		assert.equal(list.length, 1, 'exactly one ring')
		const [el] = list
		assert.equal(el.getAttribute('aria-hidden'), 'true')
		assert.equal(el.className, 'knorke-hold-ring')
		assert.ok(el.parentNode.className === 'knorke-scene-overlay', 'in the scene overlay')
		assert.equal(HOLD_RING_PX, 120, 'about 20 mm: wider than the area a resting fingertip hides (round-1 review)')
		const corner = `${50 - HOLD_RING_PX / 2}px`
		assert.equal(corner, '-10px')
		assert.equal(el.style.getPropertyValue('left'), corner, 'centred on the pointerdown point')
		assert.equal(el.style.getPropertyValue('top'), corner)
		assert.equal(el.style.getPropertyValue('width'), `${HOLD_RING_PX}px`)
		assert.equal(el.style.getPropertyValue('height'), `${HOLD_RING_PX}px`)
		assert.equal(LONG_PRESS_VIBRATE_MS, 20)
		assert.deepEqual(vib, [[20]], 'one vibration of 20 ms')
		assert.deepEqual(h.scene.getSelection(), [], 'the signal alone selects nothing')
		move(420, 360)
		assert.equal(h.scene.stats().gestureActive, false)
		assert.deepEqual(holdRing(), { x: 50, y: 50 }, 'the ring stays at the start')
		assert.deepEqual(h.scene.getSelection(), [A], 'live: A is covered')
		move(850, 360)
		assert.equal(h.scene.stats().gestureActive, false)
		assert.deepEqual(holdRing(), { x: 50, y: 50 })
		assert.equal(rings()[0], el, 'the same ring, not moved')
		assert.equal(el.style.getPropertyValue('left'), corner)
		assert.equal(el.style.getPropertyValue('top'), corner)
		up(850, 360)
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B]))
		assertNoRing('after the release')
		assert.deepEqual(h.scene.getCamera(), cam, 'the camera did not move')
		assert.equal(userCameras(), 0, 'no onUserCamera')
		assert.equal(gestureActivity(), 0, 'no onActivity gesture')
		assert.deepEqual(h.intents(), [], 'no intent')
		assert.deepEqual(vib, [[20]], 'still one vibration')
		const m = marquees()
		assert.deepEqual(m[0], [{ x: 50, y: 50, w: 370, h: 310 }, 'select'], 'from the pointerdown to the finger')
		assert.equal(callsOf('setMarquee').at(-1)[0], null, 'the marquee is cleared at the release')
	})

	test('the touchend after the release is not cancelled (no create, the compatibility events stay)', () => {
		setup()
		hold(50, 50)
		dragAK1()
		const e = dispatch(h.container, 'touchend', { cancelable: true })
		assert.equal(e.defaultPrevented, false)
	})

	test('an item another client puts under the finger during the hold counts: no signal, the finger pans', () => {
		setup()
		const vib = spyVibrate()
		down(50, 50)
		const C = '01JA0000000000000000000003'
		h.scene.update(h.model.apply({ upserts: [note(C, { x: 0, y: 0, w: 100, h: 100, z: 'a3' })] }))
		mock.timers.tick(LONG_PRESS_MS)
		assertNoRing()
		assert.deepEqual(vib, [])
		dragAK1()
		assert.deepEqual(h.scene.getCamera(), { x: -800, y: -310, scale: 1 }, 'a pan')
		assert.deepEqual(h.scene.getSelection(), [])
	})
})

describe('AK2: the rules of the mouse marquee, the selection is replaced', () => {
	const F = '01JA0000000000000000000009'
	const C = '01JA0000000000000000000003'
	const L = '01JA0000000000000000000004'
	const G1 = '01JA0000000000000000000005'
	const G2 = '01JA0000000000000000000006'
	const K = '01JA0000000000000000000007'
	const P = '01JA0000000000000000000008'
	const G = '01JG0000000000000000000001'
	const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
	/**
	 * Frame F (50, 350) 400 × 300 with C inside (100, 430); locked L (550, 400); G1 (550, 100) and
	 * G2 (800, 100) in group G; connector K (600, 650) → (950, 750); P (800, 300) alone.
	 */
	const board = () => [
		frameItem(F, { x: 50, y: 350, w: 400, h: 300 }),
		note(C, { x: 50, y: 80, w: 100, h: 100, parent: F, z: 'a3' }),
		note(L, { x: 550, y: 400, w: 100, h: 100, z: 'a4', lock: LOCK }),
		note(G1, { x: 550, y: 100, w: 100, h: 100, z: 'a5', group: G }),
		note(G2, { x: 800, y: 100, w: 100, h: 100, z: 'a6', group: G }),
		{ id: K, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b0', parent: null, data: { start: { x: 600, y: 650 }, end: { x: 950, y: 750 }, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2 } },
		note(P, { x: 800, y: 300, w: 100, h: 100, z: 'a7' }),
	]

	/**
	 * @param {'mouse'|'touch'} kind pointer
	 * @param {Array<[number, number]>} path the first point is the pointerdown
	 * @return {string[]} the selection after the release, sorted
	 */
	function marquee(kind, path) {
		h.scene.setSelection([P])
		const [[x0, y0], ...rest] = path
		const props = kind === 'mouse' ? { pointerType: 'mouse', pointerId: 1 } : finger()
		h.pointer('pointerdown', x0, y0, props)
		if (kind === 'touch') {
			mock.timers.tick(LONG_PRESS_MS)
			assert.deepEqual(holdRing(), { x: x0, y: y0 }, 'the signal came')
			assert.deepEqual(h.scene.getSelection(), [P], 'the selection stays until the marquee starts')
		}
		for (const [x, y] of rest) {
			h.pointer('pointermove', x, y, props)
			h.frame()
		}
		const [x1, y1] = rest.at(-1)
		h.pointer('pointerup', x1, y1, props)
		h.frame()
		return sorted(h.scene.getSelection())
	}

	test('the finger selects exactly what the mouse selects: the whole frame and its content, the whole group; not the locked note, the partly covered connector, the earlier selection', () => {
		setup(board())
		const path = [[20, 20], [300, 300], [700, 700]]
		const byMouse = marquee('mouse', path)
		const byFinger = marquee('touch', path)
		assert.deepEqual(byFinger, byMouse)
		assert.deepEqual(byFinger, sorted([F, C, G1, G2]))
		assert.deepEqual(h.intents(), [])
	})

	test('a marquee from the empty inside of a frame selects its content, not the frame (finger and mouse)', () => {
		setup(board())
		const path = [[300, 450], [200, 500], [90, 540]]
		assert.deepEqual(marquee('touch', path), [C])
		assert.deepEqual(marquee('mouse', path), [C])
	})
})

describe('AK3: a quick drag pans; a hold without a drag changes nothing', () => {
	test('a drag before LONG_PRESS_MS pans as before: no ring, no vibration, no marquee, the selection stays', () => {
		setup()
		const vib = spyVibrate()
		down(200, 200)
		up(200, 200)
		assert.deepEqual(h.scene.getSelection(), [A], 'a tap on A selects it')
		down(50, 50)
		mock.timers.tick(LONG_PRESS_MS - 1)
		move(420, 360)
		assertNoRing('during the pan')
		move(850, 360)
		assertNoRing('during the pan')
		up(850, 360)
		mock.timers.tick(1000)
		assertNoRing('after the pan')
		assert.deepEqual(h.scene.getCamera(), { x: -800, y: -310, scale: 1 }, 'panned by the way of the finger')
		assert.deepEqual(vib, [])
		assert.deepEqual(marquees(), [])
		assert.deepEqual(h.scene.getSelection(), [A])
	})

	test('a hold with jitter below TAP_SLOP_PX, then the release: the ring comes and goes, nothing else changes', () => {
		setup()
		down(200, 200)
		up(200, 200)
		const cam = h.scene.getCamera()
		h.log.length = 0
		hold(50, 50)
		assert.deepEqual(holdRing(), { x: 50, y: 50 })
		move(55, 56)
		move(58, 50)
		assert.deepEqual(holdRing(), { x: 50, y: 50 })
		up(58, 50)
		assertNoRing('after the release')
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(h.scene.getCamera(), cam)
		assert.deepEqual(marquees(), [])
		assert.deepEqual(h.intents(), [])
	})
})

describe('AK4: other tools, modes and pointers unchanged', () => {
	test('hand tool: no ring, no vibration; the held finger pans; the selection stays', () => {
		setup()
		const vib = spyVibrate()
		h.scene.setTool('hand')
		h.scene.setSelection([A])
		hold(50, 50)
		assertNoRing()
		assert.deepEqual(vib, [])
		dragAK1()
		assert.deepEqual(h.scene.getCamera(), { x: -800, y: -310, scale: 1 })
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(marquees(), [])
	})

	for (const mode of ['vote', 'view']) {
		test(`mode ${mode}: no hold timer at the pointerdown, no ring; the finger pans; nothing selected, no intent`, () => {
			setup(notes(), { scene: { mode } })
			const vib = spyVibrate()
			const mocked = globalThis.setTimeout
			const asked = []
			globalThis.setTimeout = (fn, ms, ...rest) => {
				asked.push(ms)
				return mocked(fn, ms, ...rest)
			}
			try {
				down(50, 50)
			} finally {
				globalThis.setTimeout = mocked
			}
			assert.deepEqual(asked, [], 'no timer opened')
			mock.timers.tick(LONG_PRESS_MS)
			assertNoRing()
			assert.deepEqual(vib, [])
			dragAK1()
			assert.deepEqual(h.scene.getCamera(), { x: -800, y: -310, scale: 1 })
			assert.deepEqual(h.scene.getSelection(), [])
			assert.deepEqual(h.intents(), [])
		})
	}

	test('edit mode for comparison: the pointerdown of a finger on empty canvas opens one timer of LONG_PRESS_MS', () => {
		setup()
		const mocked = globalThis.setTimeout
		const asked = []
		globalThis.setTimeout = (fn, ms, ...rest) => {
			asked.push(ms)
			return mocked(fn, ms, ...rest)
		}
		try {
			down(50, 50)
		} finally {
			globalThis.setTimeout = mocked
		}
		assert.deepEqual(asked, [LONG_PRESS_MS])
		up(50, 50)
	})

	test('a finger held on A, then dragged: no ring; exactly one move of A, as before', () => {
		setup()
		const vib = spyVibrate()
		hold(200, 200)
		assertNoRing()
		move(300, 260)
		move(400, 330)
		up(400, 330)
		assertNoRing()
		assert.deepEqual(vib, [])
		const moves = h.intents('move')
		assert.equal(moves.length, 1)
		assert.deepEqual(moves[0].ids, [A])
		assert.equal(h.intents().length, 1)
	})

	test('(052) a finger drags A, a second finger lands: the drag ends like Esc (no move), both fingers pinch, [A] stays', () => {
		setup()
		const scale = h.scene.getCamera().scale
		down(200, 200)
		move(260, 240)
		assert.ok(h.log.some((e) => e[0] === 'onDragPreview' && e[1].length > 0), 'the finger drags A')
		down(600, 600, 6)
		assert.deepEqual(h.log.filter((e) => e[0] === 'onDragPreview').at(-1)[1], [], 'the second finger ends the drag')
		move(800, 700, 6)
		up(260, 240)
		up(800, 700, 6)
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(h.intents(), [])
		assert.notEqual(h.scene.getCamera().scale, scale, 'the pinch zoomed')
		assert.deepEqual(h.scene.getSelection(), [A])
	})

	test('the mouse draws the marquee at once without a hold: {A, B}, no ring', () => {
		setup()
		const vib = spyVibrate()
		h.pointer('pointerdown', 50, 50)
		h.pointer('pointermove', 420, 360)
		assertNoRing()
		h.pointer('pointermove', 850, 360)
		mock.timers.tick(LONG_PRESS_MS)
		assertNoRing()
		h.pointer('pointerup', 850, 360)
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B]))
		assert.deepEqual(marquees()[0], [{ x: 50, y: 50, w: 370, h: 310 }, 'select'])
		assert.deepEqual(vib, [])
	})
})

describe('AK5: every end of the press ends the marquee and the ring, without an intent', () => {
	for (const when of ['before the first move', 'after the marquee covered A']) {
		test(`a second finger ${when}: the selection shown stays; the two fingers pinch`, () => {
			setup()
			h.scene.setSelection([B])
			hold(50, 50)
			let want = [B]
			let at = [50, 50]
			if (when !== 'before the first move') {
				move(420, 360)
				want = [A]
				at = [420, 360]
			}
			down(600, 600, 6)
			assertNoRing()
			if (marquees().length > 0) assert.equal(callsOf('setMarquee').at(-1)[0], null)
			assert.deepEqual(h.scene.getSelection(), want)
			const scale = h.scene.getCamera().scale
			move(800, 700, 6)
			up(at[0], at[1])
			up(800, 700, 6)
			assert.notEqual(h.scene.getCamera().scale, scale, 'the pinch zoomed')
			assert.deepEqual(h.scene.getSelection(), want)
			assert.deepEqual(h.intents(), [])
			assertNoRing()
		})
	}

	test('pointercancel after the signal: the ring goes; a following quick drag pans', () => {
		setup()
		hold(50, 50)
		h.pointer('pointercancel', 50, 50, finger())
		h.frame()
		assertNoRing()
		down(50, 50, 7)
		dragAK1(7)
		assert.deepEqual(h.scene.getCamera(), { x: -800, y: -310, scale: 1 })
		assert.deepEqual(h.scene.getSelection(), [])
		assert.deepEqual(h.intents(), [])
		assertNoRing()
	})

	test('Esc during the marquee: the selection at Esc stays; further moves of that finger change neither camera nor selection', () => {
		setup()
		hold(50, 50)
		move(420, 360)
		assert.deepEqual(h.scene.getSelection(), [A])
		h.key('Escape')
		assertNoRing()
		assert.equal(callsOf('setMarquee').at(-1)[0], null)
		assert.deepEqual(h.scene.getSelection(), [A], 'Esc keeps the selection while a press ran')
		const cam = h.scene.getCamera()
		const n = callsOf('setMarquee').length
		move(850, 360)
		move(900, 600)
		up(900, 600)
		assert.deepEqual(h.scene.getCamera(), cam)
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.equal(callsOf('setMarquee').length, n, 'no marquee again')
		assert.deepEqual(h.intents(), [])
		assertNoRing()
	})

	for (const [name, act] of [
		["setMode('view') right after the signal", () => h.scene.setMode('view')],
		["setMode('vote', {settle}) right after the signal", () => h.scene.setMode('vote', { settle: true })],
	]) {
		test(name + ': the ring goes, no intent', () => {
			setup()
			hold(50, 50)
			act()
			assertNoRing()
			move(420, 360)
			up(420, 360)
			assert.deepEqual(marquees(), [])
			assert.deepEqual(h.intents(), [])
		})
	}

	test("setMode('view') during the marquee: the marquee and the ring go, no intent", () => {
		setup()
		hold(50, 50)
		move(420, 360)
		h.scene.setMode('view')
		assertNoRing()
		assert.equal(callsOf('setMarquee').at(-1)[0], null)
		move(850, 360)
		up(850, 360)
		assert.deepEqual(h.intents(), [])
	})

	test('destroy during the hold: the ring is gone, stats().holdRing null', () => {
		setup()
		hold(50, 50)
		const overlay = rings()[0].parentNode
		h.scene.destroy()
		assert.equal(h.scene.stats().holdRing, null)
		assert.deepEqual(overlay.children.filter((el) => el.hasAttribute('data-knorke-hold-ring')), [])
		mock.timers.tick(1000)
	})
})

describe('a pen or mouse goes before a held finger (a resting palm; round-1 UX B2, SPEC-M1 §35.3)', () => {
	const pen = { pointerType: 'pen', pointerId: 9 }

	test('the palm got the signal, then the pen drags A: exactly one move of A; the ring goes; the palm does nothing more until it lifts', () => {
		setup()
		const vib = spyVibrate()
		h.scene.setSelection([B])
		hold(50, 600)
		assert.deepEqual(holdRing(), { x: 50, y: 600 }, 'the palm got the signal')
		h.pointer('pointerdown', 200, 200, pen)
		assertNoRing('the pen ends the hold press')
		assert.deepEqual(h.scene.getSelection(), [A], 'the pen selects A as usual')
		h.pointer('pointermove', 260, 240, pen)
		h.frame()
		h.pointer('pointermove', 300, 260, pen)
		h.frame()
		h.pointer('pointerup', 300, 260, pen)
		h.frame()
		const moves = h.intents('move')
		assert.equal(moves.length, 1, 'the pen dragged A')
		assert.deepEqual(moves[0].ids, [A])
		const cam = h.scene.getCamera()
		move(80, 640)
		move(400, 720)
		up(400, 720)
		assert.deepEqual(h.scene.getSelection(), [A], 'the sliding palm draws no marquee')
		assert.deepEqual(h.scene.getCamera(), cam, 'and pans nothing')
		assert.deepEqual(marquees(), [])
		assert.equal(h.intents().length, 1, 'only the move')
		assertNoRing()
		assert.deepEqual(vib, [[20]], 'no second signal')
	})

	test('the palm got the signal, then the mouse draws a marquee over B: [B], the ring goes', () => {
		setup()
		hold(50, 600)
		h.pointer('pointerdown', 550, 50)
		assertNoRing('the mouse ends the hold press')
		h.pointer('pointermove', 700, 200)
		h.pointer('pointermove', 850, 350)
		h.pointer('pointerup', 850, 350)
		assert.deepEqual(h.scene.getSelection(), [B])
		assert.deepEqual(marquees()[0], [{ x: 550, y: 50, w: 150, h: 150 }, 'select'], 'the mouse marquee, not the palm one')
		move(400, 700)
		up(400, 700)
		assert.deepEqual(h.scene.getSelection(), [B])
		assert.deepEqual(h.intents(), [])
	})

	test('the palm slid after the signal and its marquee covers A; the pen comes down on A: marquee and ring go like at Esc, [A] stays, no intent', () => {
		setup()
		hold(50, 50)
		move(420, 360)
		assert.deepEqual(h.scene.getSelection(), [A], 'the palm marquee covers A')
		h.pointer('pointerdown', 200, 200, pen)
		assertNoRing()
		assert.equal(callsOf('setMarquee').at(-1)[0], null, 'the palm marquee is cleared')
		assert.deepEqual(h.scene.getSelection(), [A], 'the selection shown stays (A is selected, the pen keeps it)')
		h.pointer('pointerup', 200, 200, pen)
		h.frame()
		const n = callsOf('setMarquee').length
		move(850, 360)
		up(850, 360)
		assert.equal(callsOf('setMarquee').length, n, 'the palm draws no marquee again')
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(h.intents(), [])
	})

	for (const [name, input] of [['pen', pen], ['mouse', { pointerType: 'mouse', pointerId: 1 }]]) {
		test(`a ${name} tap while the finger still waits: no signal and no vibration under the finger, also after LONG_PRESS_MS`, () => {
			setup()
			const vib = spyVibrate()
			down(50, 600)
			mock.timers.tick(200)
			h.pointer('pointerdown', 200, 200, input)
			h.pointer('pointerup', 200, 200, input)
			h.frame()
			assert.deepEqual(h.scene.getSelection(), [A], `the ${name} tap selects A`)
			mock.timers.tick(LONG_PRESS_MS)
			assertNoRing()
			assert.deepEqual(vib, [])
			mock.timers.tick(5000)
			assertNoRing()
			move(50, 700)
			assert.deepEqual(marquees(), [], 'no marquee from the finger')
			up(50, 700)
			assert.deepEqual(h.scene.getSelection(), [A])
			assert.deepEqual(h.intents(), [])
		})
	}

	// (052, job 134) a third contact during the drag is inert: the pen (mouse) press keeps every
	// finger out of the GestureController, so its move goes through
	for (const [name, input] of [['pen', pen], ['mouse', { pointerType: 'mouse', pointerId: 1 }]]) {
		test(`the palm got the signal, the ${name} drags A, a third contact lands and rests: exactly one move of A by (100, 60); no ring, no second signal`, () => {
			setup()
			const vib = spyVibrate()
			hold(50, 600)
			assert.deepEqual(holdRing(), { x: 50, y: 600 }, 'the palm got the signal')
			h.pointer('pointerdown', 200, 200, input)
			h.pointer('pointermove', 260, 240, input)
			h.frame()
			down(380, 700, 6)
			h.pointer('pointermove', 300, 260, input)
			h.frame()
			h.pointer('pointerup', 300, 260, input)
			h.frame()
			up(50, 600)
			up(380, 700, 6)
			const moves = h.intents('move')
			assert.equal(moves.length, 1, `the ${name}'s drag went through`)
			assert.deepEqual([moves[0].ids, moves[0].dx, moves[0].dy], [[A], 100, 60], 'resting contacts: the live camera stays at scale 1')
			assert.equal(h.intents().length, 1, 'only the move')
			assert.deepEqual(h.scene.getSelection(), [A])
			assertNoRing()
			assert.deepEqual(vib, [[20]], 'no second signal')
		})
	}

	test('the palm got the signal, the pen drags A, a third contact lands and the two spread: exactly one move of A by (100, 60); the camera stays at scale 1 (the pen goes first, job 134)', () => {
		setup()
		hold(50, 600)
		h.pointer('pointerdown', 200, 200, pen)
		h.pointer('pointermove', 260, 240, pen)
		h.frame()
		down(380, 700, 6)
		move(580, 760, 6)
		h.pointer('pointermove', 300, 260, pen)
		h.frame()
		h.pointer('pointerup', 300, 260, pen)
		h.frame()
		up(50, 600)
		up(580, 760, 6)
		const moves = h.intents('move')
		assert.equal(moves.length, 1, 'the pen drag went through')
		assert.deepEqual([moves[0].ids, moves[0].dx, moves[0].dy], [[A], 100, 60])
		assert.equal(h.intents().length, 1, 'only the move')
		assert.equal(h.scene.getCamera().scale, 1, 'palm and third contact do not pinch')
	})
})

describe('AK7: the contextmenu Android sends during the hold does not disturb', () => {
	test('prevented, no context menu; the signal still comes at 500 ms and the marquee selects {A, B}', () => {
		setup()
		const vib = spyVibrate()
		const cam = h.scene.getCamera()
		down(50, 50)
		mock.timers.tick(450)
		const e = dispatch(h.container, 'contextmenu', { clientX: 50, clientY: 50, button: 0, pointerType: 'touch', pointerId: 5 })
		assert.equal(e.defaultPrevented, true)
		mock.timers.tick(50)
		assert.deepEqual(holdRing(), { x: 50, y: 50 })
		assert.equal(rings().length, 1)
		assert.deepEqual(vib, [[20]])
		dragAK1()
		assert.deepEqual(h.intents('contextMenu'), [])
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B]))
		assert.deepEqual(h.scene.getCamera(), cam)
	})
})

describe('AK10: vibration only where possible', () => {
	const cases = [
		['no navigator', () => setNavigator(undefined)],
		['a navigator without vibrate', () => setNavigator({})],
		['vibrate that is no function', () => setNavigator({ vibrate: 1 })],
		['vibrate that throws', () => setNavigator({ vibrate: () => { throw new Error('NotAllowedError') } })],
	]
	for (const [name, install] of cases) {
		test(`${name}: the ring shows, no error, the marquee works`, () => {
			setup()
			install()
			const errors = spyReportError()
			assert.doesNotThrow(() => hold(50, 50))
			assert.deepEqual(holdRing(), { x: 50, y: 50 })
			assert.equal(rings().length, 1)
			dragAK1()
			mock.timers.tick(1000)
			assert.deepEqual(errors, [], 'nothing for reportAsync')
			assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B]))
			assertNoRing()
		})
	}

	test('with vibrate: one call of 20 ms per signal, none when the ring goes', () => {
		setup()
		const vib = spyVibrate()
		hold(50, 50)
		assert.deepEqual(vib, [[20]])
		up(50, 50)
		assert.deepEqual(vib, [[20]], 'none at the release')
		hold(50, 50)
		assert.deepEqual(vib, [[20], [20]])
		h.key('Escape')
		up(50, 50)
		assert.deepEqual(vib, [[20], [20]], 'none at Esc')
	})
})
