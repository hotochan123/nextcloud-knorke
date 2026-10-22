/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The switch "Snap to grid" in the scene (M2, SPEC-M1 §1.2 (R12), job 019),
 * with the real SceneManager, InputController and SceneModel on the fake DOM
 * (renderer stubbed, sceneHarness.mjs):
 * - AK1: option gridSnap (missing = on, only true keeps it on),
 *   setGridSnap/getGridSnap, stats().gridSnap; no renderer call, no callback;
 *   the state also after destroy
 * - AK2: with the grid shown and gridSnap off a drag is raw; a switch during
 *   the drag acts from the next step; the snapping to items stays
 * - AK3: the same for a resize at the side handle r
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { callsOf, note, rcalls, setupScene, shapeItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** @return {Array} the arguments of every renderer setGrid call */
const gridCalls = () => callsOf('setGrid').map((c) => c[0])
/** @return {number} the renderer calls so far, without stats() (stats() of the scene asks the renderer) */
const drawCalls = () => rcalls.filter((c) => c[0] !== 'stats').length
/** @return {Array} the setSnapGuides calls with a non-empty list */
const shownGuides = () => callsOf('setSnapGuides').map((c) => c[0]).filter((l) => Array.isArray(l) && l.length > 0)
/** @return {{x:number, y:number}} the position of A */
const posA = () => ({ x: h.model.abs(A).x, y: h.model.abs(A).y })

describe('AK1: option gridSnap, setGridSnap, getGridSnap, stats', () => {
	test('(a) on by default: getGridSnap and stats().gridSnap true', () => {
		h = setupScene([note(A)])
		assert.equal(h.scene.getGridSnap(), true)
		assert.equal(h.scene.stats().gridSnap, true)
	})

	test('(b, c) only true turns it on; no renderer call, no callback, the grid unchanged', () => {
		h = setupScene([note(A)])
		const calls = drawCalls()
		assert.equal(h.scene.getGrid(), false)
		h.scene.setGridSnap(false)
		assert.equal(h.scene.getGridSnap(), false)
		assert.equal(h.scene.stats().gridSnap, false)
		h.scene.setGridSnap(true)
		assert.equal(h.scene.getGridSnap(), true)
		assert.equal(h.scene.stats().gridSnap, true)
		for (const v of ['yes', 1, undefined]) {
			h.scene.setGridSnap(true)
			h.scene.setGridSnap(v)
			assert.equal(h.scene.getGridSnap(), false, String(v))
			assert.equal(h.scene.stats().gridSnap, false, String(v))
		}
		assert.equal(drawCalls(), calls, 'no renderer call')
		assert.deepEqual(gridCalls(), [], 'no renderer setGrid')
		assert.deepEqual(h.log, [], 'no callback, onGrid included')
		assert.equal(h.scene.getGrid(), false, 'the grid unchanged')
		h.scene.setGrid(true)
		const n = drawCalls()
		h.scene.setGridSnap(true)
		h.scene.setGridSnap(false)
		assert.equal(drawCalls(), n, 'no renderer call with the grid on either')
		assert.equal(h.scene.getGrid(), true, 'the grid stays on')
		assert.deepEqual(h.log, [])
	})

	test('(d) the option: false off, true on; null, 1, "1", "true" off', () => {
		h = setupScene([], { scene: { gridSnap: false } })
		assert.equal(h.scene.getGridSnap(), false)
		assert.equal(h.scene.stats().gridSnap, false)
		h.restore()
		h = setupScene([], { scene: { gridSnap: true } })
		assert.equal(h.scene.getGridSnap(), true)
		h.restore()
		h = null
		for (const v of [null, 1, '1', 'true']) {
			h = setupScene([], { scene: { gridSnap: v } })
			assert.equal(h.scene.getGridSnap(), false, String(v))
			assert.equal(h.scene.stats().gridSnap, false, String(v))
			assert.deepEqual(gridCalls(), [], 'no renderer setGrid')
			h.restore()
			h = null
		}
	})

	test('(e) after destroy: stats().gridSnap kept, setGridSnap still switches the state', () => {
		h = setupScene([note(A)])
		h.scene.setGridSnap(false)
		h.restore()
		assert.equal(h.scene.stats().gridSnap, false)
		const n = drawCalls()
		h.scene.setGridSnap(true)
		assert.equal(h.scene.getGridSnap(), true)
		assert.equal(h.scene.stats().gridSnap, true)
		assert.equal(drawCalls(), n, 'no renderer call')
		h = null
	})

	test('before mount: the option and setGridSnap act on the state', () => {
		// setupScene for the fake DOM and the stubbed renderer; a second scene that is never mounted
		h = setupScene([])
		const el = h.dom.doc.createElement('div')
		const s = new SceneManager(el, new SceneModel(), { gridSnap: false })
		assert.equal(s.getGridSnap(), false)
		assert.equal(s.stats().gridSnap, false)
		s.setGridSnap(true)
		assert.equal(s.stats().gridSnap, true)
		s.destroy()
	})
})

describe('AK2: a drag with the grid shown and gridSnap off', () => {
	/** Notes A (100, 100) and the given ones, the grid on, gridSnap off; press at (200, 200), move to (233, 247), one frame. */
	function drag(items = []) {
		h = setupScene([note(A, { x: 100, y: 100 }), ...items])
		h.scene.setGrid(true)
		h.scene.setGridSnap(false)
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 233, 247)
		h.frame()
	}

	test('(a) raw (+33, +47): A at (133, 147), no guide; one move intent (33, 47)', () => {
		drag()
		assert.deepEqual(posA(), { x: 133, y: 147 })
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.deepEqual(shownGuides(), [])
		h.pointer('pointerup', 233, 247)
		const moves = h.intents('move')
		assert.equal(moves.length, 1)
		assert.equal(moves[0].dx, 33)
		assert.equal(moves[0].dy, 47)
	})

	test('(b) setGridSnap(true) during the drag acts from the next step: (140, 140), intent (40, 40)', () => {
		drag()
		assert.deepEqual(posA(), { x: 133, y: 147 })
		h.scene.setGridSnap(true)
		h.pointer('pointermove', 234, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 140, y: 140 })
		h.pointer('pointerup', 234, 247)
		assert.deepEqual(h.intents('move').map((i) => [i.dx, i.dy]), [[40, 40]])
	})

	test('(c) the snapping to items stays: B at x 336 gives (136, 147) and its guide; with gridSnap (136, 140)', () => {
		drag([note(B, { x: 336, y: 500 })])
		assert.deepEqual(posA(), { x: 136, y: 147 })
		assert.equal(h.scene.stats().snapGuides, 1)
		assert.deepEqual(callsOf('setSnapGuides').at(-1)[0], [{ axis: 'x', at: 336, from: 147, to: 700 }])
		h.scene.setGridSnap(true)
		h.pointer('pointermove', 234, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 136, y: 140 })
		assert.deepEqual(callsOf('setSnapGuides').at(-1)[0], [{ axis: 'x', at: 336, from: 140, to: 700 }])
	})
})

describe('AK3: a resize with the grid shown and gridSnap off', () => {
	/** A shape A (100, 100, 200 × 120) selected, the grid on; press on its handle r and move to x, one frame. */
	function pull(x, { snapOff = true, items = [] } = {}) {
		h = setupScene([shapeItem(A, { x: 100, y: 100 }), ...items])
		h.scene.setSelection([A])
		h.scene.setGrid(true)
		if (snapOff) h.scene.setGridSnap(false)
		h.pointer('pointerdown', 300, 160)
		h.pointer('pointermove', x, 160)
		h.frame()
	}

	test('(a) raw right edge 333: w 233, no guide; one transform intent with w 233', () => {
		pull(333)
		assert.equal(h.model.get(A).w, 233)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.deepEqual(shownGuides(), [])
		h.pointer('pointerup', 333, 160)
		const it = h.intents('transform')
		assert.equal(it.length, 1)
		assert.equal(it[0].after.get(A).w, 233)
	})

	test('(b) a note B at x 336: the item line still snaps (w 236, its guide)', () => {
		pull(333, { items: [note(B, { x: 336, y: 300 })] })
		assert.equal(h.model.get(A).w, 236)
		assert.deepEqual(callsOf('setSnapGuides').at(-1)[0], [{ axis: 'x', at: 336, from: 100, to: 500 }])
	})

	test('(c) gridSnap on by default: the right edge snaps to the grid as in 016 (w 240)', () => {
		pull(333, { snapOff: false })
		assert.equal(h.scene.getGridSnap(), true)
		assert.equal(h.model.get(A).w, 240)
		h.pointer('pointerup', 333, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [240])
	})
})
