/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The gap of the selection frame hits the item (factory job 140, AK4), with
 * the real SceneManager, InputController and GestureController on the fake
 * DOM (sceneHarness.mjs, camera {0, 0, 1}):
 * - a mouse press 7 px left of a selected note A (gap 4 + tolerance 4 px;
 *   at y 140, away from the handles l and tl, which are tested first) and
 *   a drag of 40 px move A (dx 40); the same press beside an unselected A
 *   starts a marquee; at scale 2 the same 7 screen px still hit
 * - a selected ellipse is hit 3 px diagonally outside its box corner (its
 *   outline would not be), an unselected one is not: a double click there
 *   (no handle test on that path; a press there takes the handle tl)
 *   opens its editor only while it is selected
 * - inside a selected frame a press starts a marquee as before (the inside
 *   is empty canvas; only the gap outside the box counts)
 * - the topmost wins: an unselected note B under the gap of the selected A
 *   loses to A, above A it wins
 * - a finger 14 px beside a selected note (gap 4 + 12 px) is claimed and
 *   drags it; beside an unselected one it pans
 * - a right click in the gap keeps the selection and names the item
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene, shapeItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const E = '01JA0000000000000000000005'
const F = '01JA0000000000000000000009'

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

/** non-null setMarquee calls */
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null)

/**
 * A mouse press at (x, y), moved by (dx, dy) in four frames, released.
 *
 * @param {number} x container x
 * @param {number} y container y
 * @param {number} dx move x
 * @param {number} dy move y
 */
function press(x, y, dx, dy = 0) {
	h.pointer('pointerdown', x, y)
	for (let i = 1; i <= 4; i++) {
		h.pointer('pointermove', x + (dx * i) / 4, y + (dy * i) / 4)
		h.frame()
	}
	h.pointer('pointerup', x + dx, y + dy)
	h.frame()
}

describe('AK4: a mouse press into the gap', () => {
	test('7 px left of the selected note A and 40 px drag: a move intent for A with dx 40, no marquee', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.frame()
		press(93, 140, 40)
		const moves = h.intents('move')
		assert.equal(moves.length, 1, JSON.stringify(h.intents()))
		assert.deepEqual(moves[0].ids, [A])
		assert.deepEqual([moves[0].dx, moves[0].dy], [40, 0])
		assert.deepEqual(marquees(), [])
	})

	test('A not selected: the same press starts a marquee, no move', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		press(93, 140, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.ok(marquees().length > 0, 'a marquee')
	})

	test('9 px left of the selected A is beyond gap + tolerance (8 px): a marquee', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.frame()
		press(91, 140, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.ok(marquees().length > 0)
	})

	test('at scale 2 a press 7 screen px left of the selected A hits it', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		// A's left edge on screen at x 200
		press(193, 300, 40)
		const moves = h.intents('move')
		assert.equal(moves.length, 1, JSON.stringify(h.intents()))
		assert.deepEqual([moves[0].dx, moves[0].dy], [20, 0], '40 screen px are 20 world units')
	})

	test('a selected ellipse is hit 3 px diagonally outside its box corner, an unselected one is not', () => {
		h = setupScene([shapeItem(E, { x: 100, y: 100, w: 200, h: 120, data: { kind: 'ellipse', text: '' } })])
		dispatch(h.container, 'dblclick', { clientX: 97, clientY: 97, button: 0 })
		assert.equal(h.scene.stats().editing, null, 'not selected: the corner lies outside the ellipse')
		h.scene.setSelection([E])
		h.frame()
		dispatch(h.container, 'dblclick', { clientX: 97, clientY: 97, button: 0 })
		assert.equal(h.scene.stats().editing, E, 'selected: the gap hits it, its editor opens')
	})

	test('the topmost wins: in the gap of the selected A over the unselected B below → A; B above A → B', () => {
		h = setupScene([note(B, { x: 0, y: 0, w: 98, h: 400, z: 'a1' }), note(A, { x: 100, y: 100, z: 'a2' })])
		h.scene.setSelection([A])
		h.frame()
		press(97, 140, 40)
		assert.deepEqual(h.intents('move').map((m) => m.ids), [[A]], 'A above B')
		h.restore()
		h = setupScene([note(B, { x: 0, y: 0, w: 98, h: 400, z: 'a3' }), note(A, { x: 100, y: 100, z: 'a2' })])
		h.scene.setSelection([A])
		h.frame()
		press(97, 140, 40)
		assert.deepEqual(h.intents('move').map((m) => m.ids), [[B]], 'B above A')
	})

	test('the middle of a selected frame starts a marquee as before', () => {
		h = setupScene([frameItem(F, { x: 0, y: 0, w: 800, h: 600 })])
		h.scene.setSelection([F])
		h.frame()
		press(400, 300, 60, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.ok(marquees().length > 0, 'a marquee')
	})

	test('a right click in the gap keeps the selection and names the item', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.frame()
		h.log.length = 0
		h.pointer('pointerdown', 93, 140, { button: 2 })
		h.pointer('pointerup', 93, 140, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 93, clientY: 140, button: 2, pointerType: 'mouse' })
		assert.deepEqual(h.log, [['onIntent', { type: 'contextMenu', id: A, at: [93, 140] }]])
	})
})

describe('AK4: a finger in the gap (touch tolerance 12 px)', () => {
	/**
	 * One finger from (x, y) moved by 40 px to the right, released.
	 *
	 * @param {number} x container x
	 * @param {number} y container y
	 */
	function finger(x, y) {
		dispatch(h.container, 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, button: 0 })
		for (let i = 1; i <= 4; i++) {
			dispatch(h.container, 'pointermove', { pointerType: 'touch', pointerId: 7, clientX: x + 10 * i, clientY: y, button: 0 })
			h.frame()
		}
		dispatch(h.container, 'pointerup', { pointerType: 'touch', pointerId: 7, clientX: x + 40, clientY: y, button: 0 })
		h.frame()
	}

	test('14 px left of the selected A: claimed, A moves; beside an unselected A the finger pans', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.frame()
		finger(86, 140)
		const moves = h.intents('move')
		assert.equal(moves.length, 1, JSON.stringify(h.intents()))
		assert.deepEqual([moves[0].dx, moves[0].dy], [40, 0])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'no pan')
		h.scene.setSelection([])
		h.frame()
		h.log.length = 0
		finger(86, 140)
		assert.deepEqual(h.intents('move'), [])
		assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the finger panned')
	})
})
