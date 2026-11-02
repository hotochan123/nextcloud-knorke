/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Locked items in the scene (job 023, M2 SPEC-M1 §1.2 "(R20) Sperren";
 * AK10), on the fake DOM with the real SceneManager and InputController
 * (sceneHarness.mjs) and, for the symbol, pure in Node:
 * - (job 151, like background) a mouse or pen drag from a locked item draws
 *   the marquee (never taking it), Shift keeps the earlier selection, Esc
 *   and pointercancel end it; a click selects at the release by the click
 *   rules (Shift, narrowing, groups); a finger pans, taps select, a hold
 *   draws the touch marquee, a "+" handle stays a handle, a second finger
 *   pinches, a pen goes first (lockModes.test.mjs: the symbol only in mode
 *   edit, with the real renderer); a drag of a mixed selection moves only
 *   the free items
 * - the marquee and Ctrl+A skip locked items, Tab reaches them
 * - handles: a locked shape keeps only plus-t/r/b/l; a locked frame, a
 *   locked connector and a mixed selection with a lock have no transformer
 *   and no end handles; after the unlock the full handles are back
 * - double click and Enter open no editor on a locked item; the rescue
 *   editor (with a notice) still opens
 * - planLocks/paintLocks/buildLocks (nodes/locks.js): one entry per locked
 *   item in view at LOD 0, 1 and 2, a connector only at LOD 0/1, the
 *   rotated top-left corner, no plan without a lock; stats().locks passes
 *   through what the renderer counted
 * - (review round 1) where the symbol goes: inside a note or shape; outside,
 *   left of the top-left corner, for text items, frames and shapes with text
 *   at the top left (it never covers their text or the content of a frame);
 *   left of the label box of a connector (never on the label) at zoom 1 and
 *   0.5
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { KonvaRenderer } from '../../../src/scene/KonvaRenderer.js'
import { boxPlace, buildLocks, lockSquare, paintLocks, planLocks, topLeft } from '../../../src/scene/nodes/locks.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { LOCK_BORDER, LOCK_COLOR, LOCK_FILL, LOCK_ICON_PX, LOCK_INSET_PX, LOCK_PAD_PX } from '../../../src/model/tokens.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene, shapeItem, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const F = '01JA0000000000000000000009'
const K = '01JA00000000000000000000C1'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const conn = (id, start, end, extra = {}) => ({
	id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + id.slice(-2), parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' }, ...extra,
})

let h
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/** @param {string[]} ids the scene's own selection changes (onSelection) */
const selections = () => h.log.filter((e) => e[0] === 'onSelection').map((e) => e[1])
const activities = (kind) => h.log.filter((e) => e[0] === 'onActivity' && e[1].kind === kind)

/**
 * Sets the lock of an item in the model like a server change and updates the scene.
 *
 * @param {string} id item
 * @param {object|null} lock new lock
 */
function setLock(id, lock) {
	const summary = h.model.apply({ upserts: [{ ...structuredClone(h.model.get(id)), lock }] })
	h.scene.update(summary)
}

/*
 * (job 151) A locked item is background: the template L (0, 0) 800 × 600,
 * locked, with the free notes A (100, 100) and B (500, 100), 150 × 150, on
 * it; P is a point on L beside both. Camera at the origin, scale 1.
 */
const L = '01JA00000000000000000000L1'
const P = [50, 450]
const template = (extra = []) => [
	note(L, { x: 0, y: 0, w: 800, h: 600, z: 'a1', lock: LOCK }),
	note(A, { x: 100, y: 100, w: 150, h: 150, z: 'a2' }),
	note(B, { x: 500, y: 100, w: 150, h: 150, z: 'a3' }),
	...extra,
]
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null)
const userCameras = () => h.log.filter((e) => e[0] === 'onUserCamera').length
const boxOf = (id) => {
	const it = h.model.get(id)
	return [it.x, it.y, it.w, it.h]
}

describe('job 151 AK1: a drag from a locked item draws the marquee (mouse and pen)', () => {
	for (const [name, input] of [['mouse', { pointerType: 'mouse', pointerId: 1 }], ['pen', { pointerType: 'pen', pointerId: 9 }]]) {
		test(`${name}: from L over A → [A]; L stays out; no drag, no move, no camera; L keeps its box`, () => {
			h = setupScene(template())
			const cam = h.scene.getCamera()
			h.pointer('pointerdown', ...P, input)
			assert.deepEqual(h.scene.getSelection(), [], 'the press changes nothing')
			h.pointer('pointermove', 120, 400, input)
			h.frame()
			assert.deepEqual(marquees()[0], [{ x: 50, y: 400, w: 70, h: 50 }, 'select'], 'the marquee from the press point')
			h.pointer('pointermove', 200, 200, input)
			h.frame()
			assert.deepEqual(h.scene.getSelection(), [A], 'live: A is covered')
			h.pointer('pointerup', 200, 200, input)
			h.frame()
			assert.deepEqual(h.scene.getSelection(), [A], 'L stays out')
			assert.equal(callsOf('setMarquee').at(-1)[0], null, 'the marquee is cleared at the release')
			assert.equal(callsOf('beginDrag').length, 0, 'no drag')
			assert.equal(activities('drag').length, 0)
			assert.deepEqual(h.intents('move'), [], 'no drag intent')
			assert.deepEqual(h.intents(), [])
			assert.deepEqual(h.scene.getCamera(), cam, 'no camera move')
			assert.equal(userCameras(), 0)
			assert.deepEqual(boxOf(L), [0, 0, 800, 600], 'L keeps place and size')
		})

		test(`${name}: with B selected, Shift keeps it ([B, A]); without Shift B goes as soon as the marquee starts`, () => {
			h = setupScene(template())
			h.scene.setSelection([B])
			h.pointer('pointerdown', ...P, { ...input, shiftKey: true })
			assert.deepEqual(h.scene.getSelection(), [B])
			h.pointer('pointermove', 120, 400, { ...input, shiftKey: true })
			assert.deepEqual(h.scene.getSelection(), [B], 'Shift: the selection from before the press stays')
			h.pointer('pointermove', 200, 200, { ...input, shiftKey: true })
			h.pointer('pointerup', 200, 200, { ...input, shiftKey: true })
			assert.deepEqual(h.scene.getSelection(), [B, A])
			h.scene.setSelection([B])
			h.pointer('pointerdown', ...P, input)
			assert.deepEqual(h.scene.getSelection(), [B], 'the press alone keeps B')
			h.pointer('pointermove', 120, 400, input)
			assert.deepEqual(h.scene.getSelection(), [], 'B goes when the marquee starts')
			h.pointer('pointermove', 200, 200, input)
			h.pointer('pointerup', 200, 200, input)
			assert.deepEqual(h.scene.getSelection(), [A], 'B is no longer selected')
			assert.deepEqual(h.intents(), [])
		})
	}

	test('a move within DRAG_THRESHOLD_PX is still a click; a marquee over L alone selects nothing, not L', () => {
		h = setupScene(template())
		h.pointer('pointerdown', ...P)
		h.pointer('pointermove', 52, 451)
		h.pointer('pointerup', 52, 451)
		assert.deepEqual(h.scene.getSelection(), [L], '3 px or less: the click')
		assert.deepEqual(marquees(), [])
		h.pointer('pointerdown', ...P)
		h.pointer('pointermove', 300, 550)
		h.pointer('pointerup', 300, 550)
		assert.deepEqual(h.scene.getSelection(), [], 'the marquee never takes L, also not as its start')
	})

	test('Esc and pointercancel end the marquee as on empty canvas: the marquee goes, the selection shown stays, no intent', () => {
		h = setupScene(template())
		h.pointer('pointerdown', ...P)
		h.pointer('pointermove', 200, 200)
		assert.deepEqual(h.scene.getSelection(), [A])
		h.key('Escape')
		assert.equal(callsOf('setMarquee').at(-1)[0], null, 'Esc clears the marquee')
		const n = callsOf('setMarquee').length
		h.pointer('pointermove', 600, 200)
		h.pointer('pointerup', 600, 200)
		assert.equal(callsOf('setMarquee').length, n, 'no marquee again')
		assert.deepEqual(h.scene.getSelection(), [A])
		h.scene.setSelection([])
		h.pointer('pointerdown', ...P)
		h.pointer('pointermove', 200, 200)
		h.pointer('pointercancel', 200, 200)
		assert.equal(callsOf('setMarquee').at(-1)[0], null, 'pointercancel clears the marquee')
		h.pointer('pointermove', 600, 200)
		h.pointer('pointerup', 600, 200)
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(h.intents(), [])
	})

	test('a mixed selection [L, A]: a drag on A moves only A; (job 163) a drag on its locked part, in the selection frame, moves only the free part', () => {
		h = setupScene(template())
		h.scene.setSelection([L, A])
		h.pointer('pointerdown', 175, 175)
		h.pointer('pointermove', 195, 185)
		h.frame()
		h.pointer('pointermove', 225, 195)
		h.frame()
		h.pointer('pointerup', 225, 195)
		assert.deepEqual(h.intents('move').map((m) => m.ids), [[A]], 'pressed on the free A: only A moves')
		h.scene.setSelection([L, B])
		h.pointer('pointerdown', ...P)
		h.pointer('pointermove', 120, 400)
		h.frame()
		h.pointer('pointermove', 300, 200)
		h.frame()
		h.pointer('pointerup', 300, 200)
		assert.deepEqual(h.intents('move').map((m) => m.ids), [[A], [B]], 'pressed on the locked L: the free B moves')
		assert.deepEqual(h.scene.getSelection(), [L, B], 'the selection stays')
		assert.deepEqual(marquees(), [], 'no marquee')
		assert.deepEqual(boxOf(L), [0, 0, 800, 600])
	})
})

describe('job 151 AK2: a click on a locked item selects it at the release', () => {
	test('a click on L selects [L]; onSelection comes only with the pointerup', () => {
		h = setupScene(template())
		h.pointer('pointerdown', ...P)
		assert.deepEqual(selections(), [], 'nothing at the pointerdown')
		assert.deepEqual(h.scene.getSelection(), [])
		h.pointer('pointerup', ...P)
		assert.deepEqual(selections(), [[L]], 'one onSelection at the pointerup')
		assert.deepEqual(h.scene.getSelection(), [L])
	})

	test('Shift+click adds L and takes it out again; a click on L in [L, A] narrows to [L]', () => {
		h = setupScene(template())
		h.scene.setSelection([A])
		h.pointer('pointerdown', ...P, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A])
		h.pointer('pointerup', ...P, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A, L], 'Shift adds L')
		h.pointer('pointerdown', ...P, { shiftKey: true })
		h.pointer('pointerup', ...P, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A], 'Shift takes L out')
		h.scene.setSelection([L, A])
		h.pointer('pointerdown', ...P)
		assert.deepEqual(h.scene.getSelection(), [L, A], 'the press keeps the multi-selection')
		h.pointer('pointerup', ...P)
		assert.deepEqual(h.scene.getSelection(), [L], 'the release narrows it')
	})

	test('a click on a locked member of a group selects the whole group (groupOf/expandGroups); a pen click too', () => {
		const G = '01JG0000000000000000000001'
		const M = '01JA00000000000000000000M1'
		h = setupScene([
			note(L, { x: 0, y: 0, w: 300, h: 300, z: 'a1', lock: LOCK, group: G }),
			note(M, { x: 500, y: 0, w: 200, h: 200, z: 'a2', group: G }),
		])
		h.pointer('pointerdown', 150, 150)
		assert.deepEqual(h.scene.getSelection(), [])
		h.pointer('pointerup', 150, 150)
		assert.deepEqual(h.scene.getSelection(), [M, L], 'the members, the clicked one last')
		h.scene.setSelection([])
		h.pointer('pointerdown', 150, 150, { pointerType: 'pen', pointerId: 9 })
		h.pointer('pointerup', 150, 150, { pointerType: 'pen', pointerId: 9 })
		assert.deepEqual(h.scene.getSelection(), [M, L])
	})
})

describe('job 151 AK3: a finger on a locked item is background (the real GestureController)', () => {
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
	let pans = 0
	/** Fake timers first (the hold timer is the GestureController's setTimeout), then the scene. */
	const setup = (items = template()) => {
		mock.timers.enable({ apis: ['setTimeout'] })
		pans = 0
		h = setupScene(items, { on: { onTouchPan: () => { pans++ } } })
	}

	test('a drag on L pans the camera, keeps the selection, draws no marquee and calls onTouchPan once', () => {
		setup()
		h.scene.setSelection([B])
		down(...P)
		move(80, 480)
		move(150, 550)
		up(150, 550)
		assert.deepEqual(h.scene.getCamera(), { x: -100, y: -100, scale: 1 }, 'panned by the way of the finger')
		assert.deepEqual(h.scene.getSelection(), [B], 'the selection stays')
		assert.deepEqual(marquees(), [], 'no marquee')
		assert.equal(pans, 1, 'onTouchPan once')
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(boxOf(L), [0, 0, 800, 600])
	})

	test('a tap on L selects [L]; a tap on L in [L, A] narrows to [L]; a tap on empty canvas changes nothing', () => {
		setup()
		down(...P)
		up(...P)
		assert.deepEqual(h.scene.getSelection(), [L])
		h.scene.setSelection([L, A])
		down(...P)
		up(...P)
		assert.deepEqual(h.scene.getSelection(), [L])
		down(900, 700)
		up(900, 700)
		assert.deepEqual(h.scene.getSelection(), [L], 'empty canvas: as before')
		assert.equal(pans, 0)
		assert.deepEqual(h.intents(), [])
	})

	test('held for LONG_PRESS_MS, then dragged: the hold ring, the touch marquee selects A, never L; held and released without a drag: nothing changes', () => {
		setup()
		h.scene.setSelection([B])
		down(...P)
		mock.timers.tick(LONG_PRESS_MS)
		assert.deepEqual(h.scene.stats().holdRing, { x: 50, y: 450 }, 'the hold ring')
		assert.deepEqual(h.scene.getSelection(), [B], 'the selection stays until the marquee starts')
		move(120, 400)
		move(200, 200)
		up(200, 200)
		assert.deepEqual(h.scene.getSelection(), [A], 'A, not L')
		assert.equal(h.scene.stats().holdRing, null)
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'no pan')
		h.scene.setSelection([B])
		down(...P)
		mock.timers.tick(LONG_PRESS_MS)
		assert.deepEqual(h.scene.stats().holdRing, { x: 50, y: 450 })
		up(...P)
		assert.deepEqual(h.scene.getSelection(), [B], 'a hold without a drag selects nothing')
		assert.equal(h.scene.stats().holdRing, null)
		assert.equal(pans, 0)
		assert.deepEqual(h.intents(), [])
	})

	test('a tap on a "+" handle of the selected L gives the intent neighbour as before', () => {
		setup()
		h.scene.setSelection([L])
		const plus = h.scene.handles().find((x) => x.name === 'plus-r')
		assert.ok(plus, 'L has its "+" handles')
		down(plus.x, plus.y)
		up(plus.x, plus.y)
		const n = h.intents('neighbour')
		assert.equal(n.length, 1)
		assert.deepEqual([n[0].id, n[0].side], [L, 'r'])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
	})

	test('a second finger pinches as before; a pen goes before a finger resting on L (no tap after it lifts)', () => {
		setup()
		const scale = h.scene.getCamera().scale
		down(...P)
		down(600, 500, 6)
		move(750, 650, 6)
		up(...P)
		up(750, 650, 6)
		assert.notEqual(h.scene.getCamera().scale, scale, 'the pinch zoomed')
		assert.deepEqual(h.scene.getSelection(), [])
		h.scene.setCamera({ x: 0, y: 0, scale: 1 })
		h.frame()
		const pen = { pointerType: 'pen', pointerId: 9 }
		down(...P)
		h.pointer('pointerdown', 175, 175, pen)
		h.pointer('pointerup', 175, 175, pen)
		up(...P)
		assert.deepEqual(h.scene.getSelection(), [A], 'the pen tap selects A; the palm on L taps nothing')
	})
})

describe('press, drag and marquee', () => {
	test('a drag of a mixed selection moves only the free items; pressed on the free one', () => {
		h = setupScene([note(A, { x: 100, y: 100, lock: LOCK }), note(B, { x: 400, y: 100 }), note(C, { x: 700, y: 100 })])
		h.scene.setSelection([A, B, C])
		h.pointer('pointerdown', 450, 150)
		h.pointer('pointermove', 470, 160)
		h.frame()
		h.pointer('pointermove', 500, 170)
		h.frame()
		h.pointer('pointerup', 500, 170)
		const moves = h.intents('move')
		assert.equal(moves.length, 1)
		assert.deepEqual(moves[0].ids, [B, C], 'only the free ids')
		assert.deepEqual(activities('drag')[0][1].ids.includes(A), false)
		assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [100, 100])
	})

	test('the arrow keys move only the free items', () => {
		h = setupScene([note(A, { x: 100, y: 100, lock: LOCK }), note(B, { x: 400, y: 100 })])
		h.scene.setSelection([A, B])
		h.focusCanvas()
		h.key('ArrowRight')
		assert.deepEqual(h.intents('move').map((m) => m.ids), [[B]])
		h.scene.setSelection([A])
		h.key('ArrowRight')
		assert.equal(h.intents('move').length, 1, 'a locked item alone: no move')
	})

	test('the marquee over a locked and a free note selects only the free one; Shift keeps a selected locked item; Ctrl+A skips locked items; Tab reaches them', () => {
		h = setupScene([note(A, { x: 100, y: 100, lock: LOCK }), note(B, { x: 400, y: 100 }), note(C, { x: 700, y: 100 })])
		h.pointer('pointerdown', 50, 50)
		h.pointer('pointermove', 300, 200)
		h.pointer('pointermove', 650, 400)
		h.pointer('pointerup', 650, 400)
		assert.deepEqual(h.scene.getSelection(), [B])
		h.scene.setSelection([A])
		h.pointer('pointerdown', 50, 50, { shiftKey: true })
		h.pointer('pointermove', 650, 400, { shiftKey: true })
		h.pointer('pointermove', 660, 410, { shiftKey: true })
		h.pointer('pointerup', 660, 410, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A, B], 'Shift keeps the locked A')
		h.focusCanvas()
		dispatch(h.container, 'keydown', { key: 'a', ctrlKey: true })
		assert.deepEqual(h.scene.getSelection().sort(), [B, C])
		h.scene.setSelection([])
		h.key('Tab')
		assert.deepEqual(h.scene.getSelection(), [A], 'Tab reaches the locked note (the keyboard way to Unlock)')
	})
})

describe('handles', () => {
	test('a locked shape: only plus-t/r/b/l; after the unlock the full handles are back', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100, lock: LOCK })])
		h.scene.setSelection([A])
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['plus-t', 'plus-r', 'plus-b', 'plus-l'])
		setLock(A, null)
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['tl', 'tr', 'br', 'bl', 'rot', 'plus-t', 'plus-r', 'plus-b', 'plus-l'])
		setLock(A, LOCK)
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['plus-t', 'plus-r', 'plus-b', 'plus-l'], 'a lock change of the selected item: the handles follow at once')
	})

	test('a locked frame, a locked connector and a mixed selection with a lock: no transformer and no end handles', () => {
		h = setupScene([frameItem(F, { x: 1000, y: 0, lock: LOCK }), note(A, { x: 100, y: 100 }), note(B, { x: 400, y: 100, lock: LOCK }),
			conn(K, { item: A }, { x: 700, y: 500 }, { lock: LOCK })])
		h.scene.setSelection([F])
		assert.deepEqual(h.scene.handles(), [])
		h.scene.setSelection([K])
		assert.deepEqual(h.scene.handles(), [], 'no end handles')
		h.scene.setSelection([A, B])
		assert.deepEqual(h.scene.handles(), [], 'no transformer handles for the multi selection')
		setLock(K, null)
		h.scene.setSelection([K])
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['start', 'end'])
		// a press on a transformer handle position of a locked item starts nothing
		h.scene.setSelection([B])
		h.pointer('pointerdown', 600, 300)
		h.pointer('pointermove', 650, 350)
		h.pointer('pointermove', 700, 400)
		h.pointer('pointerup', 700, 400)
		assert.deepEqual(h.intents('transform'), [])
	})
})

describe('editor', () => {
	test('double click and Enter open no editor on a locked item; the rescue editor with a notice still opens', () => {
		h = setupScene([note(A, { x: 100, y: 100, lock: LOCK })])
		h.pointer('pointerdown', 150, 150)
		h.pointer('pointerup', 150, 150)
		h.pointer('pointerdown', 150, 150)
		h.pointer('pointerup', 150, 150)
		dispatch(h.container, 'dblclick', { clientX: 150, clientY: 150, button: 0 })
		assert.equal(h.scene.stats().editing, null)
		h.focusCanvas()
		h.key('Enter')
		assert.equal(h.scene.stats().editing, null)
		assert.equal(h.scene.openTextEditor(A), false, '"Edit text" / "Edit label" of the shell')
		assert.equal(h.scene.openTextEditor(A, { text: 'rescued', notice: 'Not saved' }), true, 'the rescue editor')
		assert.equal(h.scene.stats().editing, A)
	})
})

describe('lock symbol (nodes/locks.js)', () => {
	/** @return {SceneModel} A locked, B free, C locked and rotated 90°, F a locked frame, K a locked connector */
	function board() {
		const m = new SceneModel()
		m.load([
			note(A, { x: 0, y: 0, lock: LOCK }), note(B, { x: 300, y: 0 }), note(C, { x: 600, y: 0, w: 200, h: 100, r: 90, lock: { by: null, name: null } }),
			frameItem(F, { x: -100, y: 400, lock: LOCK }), conn(K, { item: A }, { item: B }, { lock: LOCK }),
		])
		return m
	}

	test('planLocks: one entry per locked item among the given ids at LOD 0, 1 and 2; a connector only at LOD 0/1; none without a lock', () => {
		const m = board()
		const all = [A, B, C, F, K]
		assert.deepEqual(planLocks(m, all, { lod: 0 }).items.map((x) => x.id), [A, C, F, K])
		assert.deepEqual(planLocks(m, all, { lod: 1 }).items.map((x) => x.id), [A, C, F, K])
		assert.deepEqual(planLocks(m, all, { lod: 2 }).items.map((x) => x.id), [A, C, F], 'no connector at LOD 2')
		assert.deepEqual(planLocks(m, [A], { lod: 0 }).items.map((x) => x.id), [A], 'only the culled ids')
		assert.equal(planLocks(m, [B], { lod: 0 }), null, 'no lock in view: no plan')
		assert.equal(planLocks(m, [], { lod: 2 }), null)
		const a = planLocks(m, [A]).items[0]
		assert.deepEqual(a, { id: A, x: 0, y: 0, r: 0, place: 'inside' }, 'the top-left corner, inside (a note)')
		const k = planLocks(m, [K]).items[0]
		const g = m.geometryOf(K)
		assert.deepEqual([k.x, k.y, k.place], [g.labelAt.x, g.labelAt.y, 'route'], 'the middle of the route (no label)')
		const off = planLocks(m, [A], { offsetOf: (id) => (id === A ? { dx: 10, dy: 20 } : null) }).items[0]
		assert.deepEqual([off.x, off.y], [10, 20], 'a remote drag preview moves the symbol')
	})

	test('after a rotation by 90° the symbol sits at the rotated top-left corner', () => {
		const m = board()
		const c = planLocks(m, [C]).items[0]
		// box (600, 0, 200 × 100), centre (700, 50): the top-left (-100, -50) turned by 90° lies at (+50, -100)
		assert.ok(Math.abs(c.x - 750) < 1e-9 && Math.abs(c.y - -50) < 1e-9, JSON.stringify(c))
		assert.equal(c.r, 90)
		assert.deepEqual(topLeft({ x: 0, y: 0, w: 10, h: 10, r: 0 }), { x: 0, y: 0 })
		const p = topLeft({ x: 0, y: 0, w: 200, h: 100, r: 180 })
		assert.ok(Math.abs(p.x - 200) < 1e-9 && Math.abs(p.y - 100) < 1e-9)
	})

	test('paintLocks: per item the edged white square and the padlock, sizes in screen px, rotated with the item; returns the count', () => {
		const m = board()
		const calls = []
		const ctx = new Proxy({}, {
			get: (t, name) => (name in t ? t[name] : (...args) => calls.push([name, ...args])),
			set: (t, name, v) => {
				calls.push(['set ' + String(name), v])
				return true
			},
		})
		const plan = planLocks(m, [A, C, K])
		assert.equal(paintLocks(ctx, plan, 2), 3)
		assert.equal(calls.filter((c) => c[0] === 'save').length, 3)
		assert.equal(calls.filter((c) => c[0] === 'restore').length, 3)
		assert.deepEqual(calls.filter((c) => c[0] === 'rotate'), [['rotate', Math.PI / 2]], 'only the rotated item')
		assert.deepEqual(calls.filter((c) => c[0] === 'set fillStyle').map((c) => c[1]).slice(0, 3), [LOCK_BORDER, LOCK_FILL, LOCK_COLOR])
		// the body of the first padlock: LOCK_ICON_PX (16) screen px at scale 2 → 8 world units wide icon
		const px = 1 / 2
		const x0 = (LOCK_INSET_PX + LOCK_PAD_PX) * px
		const u = LOCK_ICON_PX * px / 16
		assert.deepEqual(calls.find((c) => c[0] === 'fillRect'), ['fillRect', x0 + 3 * u, x0 + 8 * u, 10 * u, 7 * u])
		assert.deepEqual(calls.find((c) => c[0] === 'translate'), ['translate', 0, 0], 'A: its top-left corner')
		assert.equal(paintLocks(ctx, null, 1), 0)
		assert.equal(paintLocks(ctx, { items: [] }, 1), 0)
	})

	test('buildLocks: one Konva.Shape without hit graph whose sceneFunc paints', () => {
		let painted = 0
		class Shape {
			constructor(attrs) {
				this.attrs = attrs
			}

			transformsEnabled(v) {
				this.transforms = v
			}
		}
		const node = buildLocks({ Shape }, () => { painted++ })
		assert.equal(node.attrs.listening, false)
		assert.equal(node.attrs.perfectDrawEnabled, false)
		assert.equal(node.transforms, 'position')
		node.attrs.sceneFunc({})
		assert.equal(painted, 1)
	})

	test('stats().locks passes through what the renderer counted (0 before mount and without the field)', () => {
		h = setupScene([note(A, { lock: LOCK })])
		assert.equal(h.scene.stats().locks, 0, 'the stub renderer counts nothing')
		const stats = KonvaRenderer.prototype.stats
		KonvaRenderer.prototype.stats = () => ({ handles: 0, nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 1, locks: 1, lod: 0, visible: 1, draws: { static: 0, overlay: 0 } })
		try {
			assert.equal(h.scene.stats().locks, 1)
		} finally {
			KonvaRenderer.prototype.stats = stats
		}
	})
})

describe('where the lock symbol goes (review round 1)', () => {
	/** world rectangle of the painted square of a plan entry with r = 0 */
	const rectOf = (it, scale) => {
		const q = lockSquare(it.place, scale)
		return { x: it.x + q.x, y: it.y + q.y, w: q.size, h: q.size }
	}
	const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
	const T = '01JA00000000000000000000T1'
	const S = '01JA00000000000000000000S1'
	const S2 = '01JA00000000000000000000S2'
	const KL = '01JA00000000000000000000K2'
	/** @return {SceneModel} a locked text item, a frame with a child, a top-left text shape, a centred shape, a labelled connector */
	function board() {
		const m = new SceneModel()
		m.load([
			textItem(T, { x: 0, y: 0, w: 240, h: 28.8, lock: LOCK }),
			frameItem(F, { x: 1000, y: 0, w: 600, h: 400, lock: LOCK }), note(A, { x: 0, y: 0, parent: F }),
			shapeItem(S, { x: 0, y: 500, lock: LOCK, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2, align: 'left', valign: 'top' } }),
			shapeItem(S2, { x: 300, y: 500, lock: LOCK }),
			note(B, { x: 0, y: 900 }), note(C, { x: 700, y: 900 }),
			conn(KL, { item: B }, { item: C }, { lock: LOCK, data: { start: { item: B }, end: { item: C }, route: 'straight', label: 'Label' } }),
		])
		return m
	}

	test('boxPlace: notes and plain shapes inside; text items, frames and shapes with text at the top left outside', () => {
		const m = board()
		assert.deepEqual([T, F, S, S2].map((id) => boxPlace(m.get(id))), ['outside', 'outside', 'outside', 'inside'])
		assert.equal(boxPlace(note(A)), 'inside')
		assert.equal(boxPlace(shapeItem(S, { style: { align: 'left' } })), 'inside', 'left but not top: the text starts lower')
	})

	test('at zoom 1 and 0.5 the square never meets a text item, a frame (or its content), a top-left text shape or a connector label; a plain shape keeps it inside', () => {
		const m = board()
		for (const scale of [1, 0.5]) {
			// zoom 1 and 0.5 are LOD 0 (LOD_TEXT_SCALE 0.3): the level that paints the label
			const plan = new Map(planLocks(m, [T, F, S, S2, KL], { lod: 0 }).items.map((it) => [it.id, it]))
			for (const id of [T, F, S]) {
				const box = m.abs(id)
				const r = rectOf(plan.get(id), scale)
				assert.ok(!overlaps(r, box), id + ' at ' + scale + ': ' + JSON.stringify(r) + ' outside ' + JSON.stringify(box))
				assert.ok(Math.abs(r.x + r.w - (box.x - 4 / scale)) < 1e-9 && Math.abs(r.y - box.y) < 1e-9, 'left of the top-left corner, LOCK_INSET_PX away, top-aligned')
			}
			assert.ok(!overlaps(rectOf(plan.get(F), scale), m.abs(A)), 'the child of the frame is never covered')
			const label = m.routeOf(KL).label
			assert.ok(label, 'the connector has a label box')
			const kl = plan.get(KL)
			assert.equal(kl.place, 'label')
			const r = rectOf(kl, scale)
			assert.ok(!overlaps(r, label), 'label at ' + scale + ': ' + JSON.stringify(r) + ' beside ' + JSON.stringify(label))
			assert.ok(Math.abs(r.x + r.w - (label.x - 4 / scale)) < 1e-9 && Math.abs(r.y + r.h / 2 - (label.y + label.h / 2)) < 1e-9, 'left of the label, centred on it')
			const s2 = rectOf(plan.get(S2), scale)
			const b2 = m.abs(S2)
			assert.ok(s2.x > b2.x && s2.y > b2.y && s2.x + s2.w < b2.x + b2.w, 'a plain shape: inside the top-left corner')
		}
	})

	test('at LOD 1 a labelled connector keeps its symbol on the middle of the route (the label is not drawn there); at LOD 2 it has none (review round 2)', () => {
		const m = board()
		const at = m.routeOf(KL).geom.labelAt
		const lod1 = planLocks(m, [KL], { lod: 1 }).items[0]
		assert.deepEqual([lod1.place, lod1.x, lod1.y], ['route', at.x, at.y])
		assert.equal(planLocks(m, [KL], { lod: 0 }).items[0].place, 'label')
		assert.equal(planLocks(m, [KL], { lod: 2 }), null)
	})

	test('outside follows the rotation: a text item turned by 90° gets the square left of its rotated top-left corner, rotated with it', () => {
		const m = new SceneModel()
		m.load([textItem(T, { x: 0, y: 0, w: 200, h: 100, r: 90, lock: LOCK })])
		const it = planLocks(m, [T]).items[0]
		assert.equal(it.place, 'outside')
		assert.ok(Math.abs(it.x - 150) < 1e-9 && Math.abs(it.y - -50) < 1e-9 && it.r === 90, JSON.stringify(it))
		const calls = []
		const ctx = new Proxy({}, {
			get: (t, name) => (name in t ? t[name] : (...args) => calls.push([name, ...args])),
			set: (t, name, v) => {
				calls.push(['set ' + String(name), v])
				return true
			},
		})
		paintLocks(ctx, { items: [it] }, 1)
		assert.deepEqual(calls.find((c) => c[0] === 'translate'), ['translate', it.x, it.y])
		assert.deepEqual(calls.find((c) => c[0] === 'rotate'), ['rotate', Math.PI / 2])
		const q = lockSquare('outside', 1)
		assert.ok(q.x + q.size <= -4 + 1e-9 && q.y === 0, 'in the frame of the item: left of x = 0, from y = 0')
	})
})
