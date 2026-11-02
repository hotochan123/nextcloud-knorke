/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A drag anywhere in the selection frame moves the selection (factory job
 * 163), with the real SceneManager, InputController and GestureController
 * on the fake DOM (sceneHarness.mjs, camera {0, 0, 1}). Notes A (100, 100)
 * and B (500, 100), 200 × 200, selected [A, B]: the frame R is
 * (96, 96)–(704, 304); P = (400, 150) is empty canvas in it; note C
 * (360, 200, 80 × 80) where named. Move ids are compared as sets.
 * - AK1 empty spot: a mouse or pen drag from P moves {A, B} (no marquee,
 *   the selection stays); a click there clears the selection at the
 *   release; R grows by the mouse tolerance (y 307 inside, 310 outside: a
 *   marquee that clears at the press); at scale 2, 40 screen px are dx 20
 * - AK2 items in R: an unselected C stays where it is while {A, B} move,
 *   a click selects C (a member: its group); a locked L likewise (click by
 *   job 151), a selected locked L too; nothing movable: the marquee as
 *   before; the empty inside of a selected frame F moves {A, F}
 * - AK3 Shift: as before (click keeps, drag draws an adding marquee,
 *   Shift+click adds or takes out)
 * - AK4 a selected group: a drag at P moves it, a click clears, a second
 *   click on a member narrows as before
 * - AK5 unchanged: one selected frame (marquee from its inside), one
 *   unfilled shape (job 170: a marquee from its inside too), another
 *   participant's selection (no gap, no R)
 * - AK6 a finger: from P over claimDrag (no pan, no onTouchPan, no tap), a
 *   hold draws the touch marquee, a tap at P changes nothing, a finger on
 *   C taps, trembles (8 px) or drags the selection (40 px), outside R it
 *   pans, a second finger cancels like Esc
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { InputController } from '../../../src/scene/InputController.js'
import { callsOf, frameItem, note, setupScene, shapeItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const D = '01JA0000000000000000000004'
const F = '01JA0000000000000000000009'
const L = '01JA00000000000000000000L1'
const S = '01JA00000000000000000000S1'
const G = '01JG0000000000000000000001'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const P = [400, 150]

let h = null
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
	mock.restoreAll()
})

/**
 * A and B (and the extra items), the selection [A, B] unless `sel` says otherwise (a scene of
 * this test before it goes).
 *
 * @param {object[]} [extra] more WireItems
 * @param {object} [o] {a, b: fields of A and B, sel: selection, opts: setupScene options}
 * @return {object} sceneHarness
 */
function board(extra = [], o = {}) {
	h?.restore()
	h = null
	h = setupScene([note(A, { x: 100, y: 100, z: 'a1', ...o.a }), note(B, { x: 500, y: 100, z: 'a2', ...o.b }), ...extra], o.opts)
	h.scene.setSelection(o.sel ?? [A, B])
	h.frame()
	h.log.length = 0
	return h
}

const noteC = (o = {}) => note(C, { x: 360, y: 200, w: 80, h: 80, z: 'a3', ...o })
/** non-null setMarquee calls */
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null)
const sorted = (ids) => [...ids].sort()
/** @return {Array<[string[], number, number]>} the move intents: sorted ids, dx, dy */
const moves = () => h.intents('move').map((m) => [sorted(m.ids), m.dx, m.dy])
const at = (id) => [h.model.get(id).x, h.model.get(id).y]

/**
 * A press at (x, y), moved by (dx, dy) in four frames, released.
 *
 * @param {number} x container x
 * @param {number} y container y
 * @param {number} dx move x
 * @param {number} dy move y
 * @param {object} [props] pointer props (pointerType, shiftKey, …)
 */
function drag(x, y, dx, dy = 0, props = {}) {
	h.pointer('pointerdown', x, y, props)
	for (let i = 1; i <= 4; i++) {
		h.pointer('pointermove', x + (dx * i) / 4, y + (dy * i) / 4, props)
		h.frame()
	}
	h.pointer('pointerup', x + dx, y + dy, props)
	h.frame()
}

/**
 * A click at (x, y) without a move.
 *
 * @param {number} x container x
 * @param {number} y container y
 * @param {object} [props] pointer props
 */
function click(x, y, props = {}) {
	h.pointer('pointerdown', x, y, props)
	h.pointer('pointerup', x, y, props)
	h.frame()
}

describe('AK1: a press on an empty spot in the frame', () => {
	for (const pointerType of ['mouse', 'pen']) {
		test(`${pointerType}: from P 40 px to the right moves {A, B} by dx 40; no marquee, the selection stays`, () => {
			board()
			drag(...P, 40, 0, { pointerType, pointerId: pointerType === 'pen' ? 9 : 1 })
			assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]], JSON.stringify(h.intents()))
			assert.deepEqual(marquees(), [])
			assert.deepEqual(h.scene.getSelection(), [A, B])
			assert.deepEqual([at(A), at(B)], [[140, 100], [540, 100]])
		})
	}

	test('a click at P clears the selection only at the release; then a drag from P draws a marquee, no move', () => {
		board()
		h.pointer('pointerdown', ...P)
		assert.deepEqual(h.scene.getSelection(), [A, B], 'the pointerdown keeps the selection')
		h.pointer('pointerup', ...P)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [], 'the release clears it')
		drag(...P, 40, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})

	test('(400, 307) lies in R plus the 4-px tolerance: a drag moves {A, B}; (400, 310) draws a marquee and clears at the press', () => {
		board()
		drag(400, 307, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]])
		board()
		h.pointer('pointerdown', 400, 310)
		assert.deepEqual(h.scene.getSelection(), [], 'outside R: the press clears the selection as before')
		for (let i = 1; i <= 4; i++) {
			h.pointer('pointermove', 400 + 10 * i, 310)
			h.frame()
		}
		h.pointer('pointerup', 440, 310)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})

	test('at scale 2, 40 screen px from P (screen (800, 300)) move {A, B} by dx 20', () => {
		board()
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		drag(800, 300, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 20, 0]])
	})

	test('a press that ends an open editor never lies in the frame: it draws the marquee as before', () => {
		board()
		assert.equal(h.scene.openTextEditor(A), true)
		h.frame()
		h.scene.setSelection([A, B])
		h.frame()
		h.pointer('pointerdown', ...P)
		assert.equal(h.scene.stats().editing, null, 'the press ended the editor')
		for (let i = 1; i <= 4; i++) {
			h.pointer('pointermove', 400 + 10 * i, 150 + 10 * i)
			h.frame()
		}
		h.pointer('pointerup', 440, 190)
		h.frame()
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})

	test('Esc before the threshold drops the press: no move, the release keeps the selection; Esc during the drag springs back', () => {
		board()
		h.pointer('pointerdown', ...P)
		h.key('Escape')
		h.pointer('pointerup', ...P)
		assert.deepEqual(h.scene.getSelection(), [A, B], 'the dropped press clicks nothing')
		h.pointer('pointerdown', ...P)
		h.pointer('pointermove', 440, 150)
		h.frame()
		h.key('Escape')
		h.pointer('pointerup', 440, 150)
		h.frame()
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual([at(A), at(B)], [[100, 100], [500, 100]])
		assert.deepEqual(h.scene.getSelection(), [A, B])
	})
})

describe('AK2: items in the frame', () => {
	test('C not selected: a drag from C moves {A, B}, C stays where it is; a click on C selects [C]', () => {
		board([noteC()])
		drag(400, 240, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]])
		assert.deepEqual(at(C), [360, 200], 'C stays')
		assert.deepEqual(h.scene.getSelection(), [A, B])
		board([noteC()])
		h.pointer('pointerdown', 400, 240)
		assert.deepEqual(h.scene.getSelection(), [A, B], 'nothing changes at the pointerdown')
		h.pointer('pointerup', 400, 240)
		assert.deepEqual(h.scene.getSelection(), [C])
	})

	test('C in a group with D: a click on C selects {C, D}', () => {
		board([noteC({ group: G }), note(D, { x: 800, y: 500, w: 80, h: 80, z: 'a4', group: G })])
		click(400, 240)
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([C, D]))
	})

	test('a locked, unselected L at the place of C: a drag moves {A, B}, a click selects [L]', () => {
		board([note(L, { x: 360, y: 200, w: 80, h: 80, z: 'a3', lock: LOCK })])
		drag(400, 240, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]])
		assert.deepEqual(marquees(), [])
		assert.deepEqual(at(L), [360, 200])
		board([note(L, { x: 360, y: 200, w: 80, h: 80, z: 'a3', lock: LOCK })])
		click(400, 240)
		assert.deepEqual(h.scene.getSelection(), [L])
	})

	test('the selection [A, B, L] with L locked: a drag from L moves {A, B}', () => {
		board([note(L, { x: 360, y: 200, w: 80, h: 80, z: 'a3', lock: LOCK })], { sel: [A, B, L] })
		drag(400, 240, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]])
		assert.deepEqual(at(L), [360, 200])
	})

	test('A and B locked (nothing movable): a drag at P draws a marquee as before', () => {
		board([], { a: { lock: LOCK }, b: { lock: LOCK } })
		drag(...P, 40, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})

	test('a frame F instead of B, the selection [A, F]: a drag in the empty inside of F moves {A, F}', () => {
		h = setupScene([note(A, { x: 100, y: 100, z: 'a1' }), frameItem(F, { x: 500, y: 100, w: 200, h: 200, z: 'a0' })])
		h.scene.setSelection([A, F])
		h.frame()
		drag(600, 200, 40)
		assert.deepEqual(moves(), [[sorted([A, F]), 40, 0]])
		assert.deepEqual(marquees(), [])
	})
})

describe('AK3: Shift in the frame works as before', () => {
	test('Shift+click at P keeps [A, B]; Shift+drag at P draws a marquee that keeps A and B', () => {
		board([noteC()])
		click(...P, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A, B])
		drag(...P, 20, 100, { shiftKey: true })
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B, C]), 'A and B stay, the marquee adds C')
	})

	test('Shift+click on C adds it: {A, B, C}; Shift+click on A takes it out: [B]', () => {
		board([noteC()])
		click(400, 240, { shiftKey: true })
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B, C]))
		board([noteC()])
		click(200, 200, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [B])
	})
})

describe('AK4: a selected group', () => {
	test('A and B in group G: a click on A selects {A, B}; a drag at P moves {A, B}; a click at P clears; a second click on A narrows to [A]', () => {
		board([], { a: { group: G }, b: { group: G }, sel: [] })
		click(200, 200)
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B]), 'the click on A selects the group')
		drag(...P, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]])
		click(...P)
		assert.deepEqual(h.scene.getSelection(), [])
		click(240, 200)
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([A, B]))
		click(240, 200)
		assert.deepEqual(h.scene.getSelection(), [A], 'the second click narrows as before')
	})
})

describe('AK5: unchanged outside a multi-selection', () => {
	test('one selected frame (0, 0, 800 × 600): a drag in its middle draws a marquee', () => {
		h = setupScene([frameItem(F, { x: 0, y: 0, w: 800, h: 600 })])
		h.scene.setSelection([F])
		h.frame()
		drag(400, 300, 60, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})

	test('one selected rectangle with fillOpacity 0: a drag in its middle draws a marquee, no move (job 170)', () => {
		h = setupScene([shapeItem(S, { x: 100, y: 100, w: 200, h: 120, style: { fill: '#ffffff', fillOpacity: 0, stroke: '#1a1a1a', strokeWidth: 2 } })])
		h.scene.setSelection([S])
		h.frame()
		drag(200, 160, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(at(S), [100, 100])
	})

	test('A selected only by another participant: a press 7 px left of A with a drag draws a marquee, no move', () => {
		board([], { sel: [] })
		const BOB = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#2e7d32', guest: false, cursor: null, selection: [A, B], drag: [], editing: null, editingHolder: false, view: null }
		h.scene.setRemoteSampler(() => [BOB])
		h.frame()
		drag(93, 140, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})
})

describe('AK6: a finger (the real GestureController)', () => {
	const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })
	/** @return {object} the board with fake timers (the hold timer) and spies on taps and onTouchPan */
	function touchBoard(extra = []) {
		h?.restore()
		h = null
		mock.timers.reset()
		mock.restoreAll()
		mock.timers.enable({ apis: ['setTimeout'] })
		const pans = []
		board(extra, { opts: { on: { onTouchPan: () => pans.push(1) } } })
		const taps = mock.method(InputController.prototype, 'tap')
		return { pans, taps }
	}

	/**
	 * One finger from (x, y) moved by dx in four steps, released.
	 *
	 * @param {number} x container x
	 * @param {number} y container y
	 * @param {number} dx move x
	 * @param {number} [dy] move y
	 */
	function swipe(x, y, dx, dy = 0) {
		h.pointer('pointerdown', x, y, finger())
		for (let i = 1; i <= 4; i++) {
			h.pointer('pointermove', x + (dx * i) / 4, y + (dy * i) / 4, finger())
			h.frame()
		}
		h.pointer('pointerup', x + dx, y + dy, finger())
		h.frame()
	}

	test('P, 40 px in 4 steps: move {A, B} dx 40; the camera stays, no onTouchPan, no tap', () => {
		const { pans, taps } = touchBoard()
		swipe(...P, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]], JSON.stringify(h.intents()))
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		assert.deepEqual(pans, [])
		assert.equal(taps.mock.callCount(), 0)
		assert.deepEqual(h.scene.getSelection(), [A, B])
	})

	test('P held LONG_PRESS_MS, then dragged: a marquee with the hold ring, no move', () => {
		touchBoard()
		h.pointer('pointerdown', ...P, finger())
		mock.timers.tick(LONG_PRESS_MS)
		assert.notEqual(h.scene.stats().holdRing, null, 'the hold ring')
		h.pointer('pointermove', 450, 260, finger())
		h.frame()
		assert.ok(marquees().length > 0, 'a marquee')
		assert.notEqual(h.scene.stats().holdRing, null, 'the ring stays during the marquee')
		h.pointer('pointerup', 450, 260, finger())
		h.frame()
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
	})

	test('a tap at P changes nothing, no intent', () => {
		const { taps } = touchBoard()
		h.pointer('pointerdown', ...P, finger())
		h.pointer('pointerup', ...P, finger())
		h.frame()
		assert.equal(taps.mock.callCount(), 1, 'the tap reached the input controller')
		assert.deepEqual(h.scene.getSelection(), [A, B])
		assert.deepEqual(h.intents(), [])
	})

	test('a finger on C: a tap selects [C]; 8 px selects [C] without a move; 40 px moves {A, B}', () => {
		touchBoard([noteC()])
		h.pointer('pointerdown', 400, 240, finger())
		h.pointer('pointerup', 400, 240, finger())
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [C], 'tap')
		touchBoard([noteC()])
		swipe(400, 240, 8)
		assert.deepEqual(h.scene.getSelection(), [C], '8 px: still the tap of C')
		assert.deepEqual(h.intents('move'), [])
		touchBoard([noteC()])
		swipe(400, 240, 40)
		assert.deepEqual(moves(), [[sorted([A, B]), 40, 0]])
		assert.deepEqual(at(C), [360, 200])
		assert.deepEqual(h.scene.getSelection(), [A, B])
	})

	test('a finger whose pointerdown ended an open editor pans from P, no move', () => {
		touchBoard()
		assert.equal(h.scene.openTextEditor(A), true)
		h.frame()
		h.scene.setSelection([A, B])
		h.frame()
		h.pointer('pointerdown', ...P, finger())
		assert.equal(h.scene.stats().editing, null, 'the finger ended the editor')
		for (let i = 1; i <= 4; i++) {
			h.pointer('pointermove', 400 + 10 * i, 150, finger())
			h.frame()
		}
		h.pointer('pointerup', 440, 150, finger())
		h.frame()
		assert.deepEqual(h.intents('move'), [])
		assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the finger panned')
	})

	test('(400, 330) dragged (outside R plus 12 px): the camera pans, no move', () => {
		const { pans } = touchBoard()
		swipe(400, 330, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the finger panned')
		assert.deepEqual(pans, [1])
	})

	test('a second finger during the drag: no move, A and B at their start', () => {
		touchBoard()
		h.pointer('pointerdown', ...P, finger())
		h.pointer('pointermove', 420, 150, finger())
		h.frame()
		h.pointer('pointermove', 440, 150, finger())
		h.frame()
		assert.deepEqual([at(A), at(B)], [[140, 100], [540, 100]], 'the drag runs')
		h.pointer('pointerdown', 700, 500, finger(6))
		h.frame()
		h.pointer('pointerup', 440, 150, finger())
		h.pointer('pointerup', 700, 500, finger(6))
		h.frame()
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual([at(A), at(B)], [[100, 100], [500, 100]])
	})
})
