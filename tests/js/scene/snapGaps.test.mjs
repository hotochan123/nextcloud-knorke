/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Snapping a drag to equal gaps (M2, SPEC-M1 §1.2 (R12)), deterministic in
 * Node with the real SceneManager, InputController and SceneModel on the
 * fake DOM (renderer stubbed, sceneHarness.mjs). P at (100, 100), Q at
 * (360, 100) (gap 60), A at (700, 120), all 200 × 200:
 * - AK4: A dragged left by 77 snaps 60 right of Q: preview row, markers
 *   (setGapMarkers), stats().gapMarkers, no guide, one move intent with the
 *   snapped shift; at the release setGapMarkers(null), gapMarkers 0;
 *   setGapMarkers only when the list changes
 * - AK5: Ctrl/⌘ on the moves drags free; Control/Meta pressed and released
 *   during a snapped drag act without a pointer move
 * - AK6: inside a frame the same; locked by an item under the raw box; P
 *   outside the view; snapping back to the start sends no intent
 * - AK7: the threshold is OBJECT_SNAP_PX screen px of the scale
 * - AK8: Esc, setMode('vote', {settle}), reset() and destroy() end the markers
 * - AK9: gapMarkerPoints, one polyline with a cross tick of GAP_MARKER_TICK_PX screen px at both ends
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene } from './sceneHarness.mjs'
import { gapMarkerPoints } from '../../../src/scene/KonvaRenderer.js'

const A = '01JA0000000000000000000001'
const P = '01JA0000000000000000000002'
const Q = '01JA0000000000000000000003'
const O = '01JA0000000000000000000004'
const F = '01JA00000000000000000000F1'

/** P and Q 60 apart, A to the right of Q (the raw drag by −77 leaves 63 to Q). */
const row = (o = {}) => [
	note(P, { x: 100, y: 100, z: 'a1', ...o.p }),
	note(Q, { x: 360, y: 100, z: 'a2', ...o.q }),
	note(A, { x: 700, y: 120, z: 'a3', ...o.a }),
]
/** The markers of AK4: P–Q and Q–A (A at 620). */
const MARKERS = Object.freeze([
	{ axis: 'x', at: 200, from: 300, to: 360 },
	{ axis: 'x', at: 210, from: 560, to: 620 },
])

let h
afterEach(() => {
	h?.restore()
	h = null
})

/**
 * @param {string} id item
 * @return {Array|null} the last onDragPreview row of the item
 */
function lastRow(id) {
	for (const e of h.log.filter((x) => x[0] === 'onDragPreview').reverse()) {
		const r = e[1].find((x) => x[0] === id)
		if (r) return r
	}
	return null
}

/** @return {Array} the argument of every setGapMarkers call */
const markerCalls = () => callsOf('setGapMarkers').map((c) => c[0])
/** @return {Array} the setGapMarkers calls with a non-empty list */
const shownMarkers = () => markerCalls().filter((l) => Array.isArray(l) && l.length > 0)
/** @return {Array} the setSnapGuides calls with a non-empty list */
const shownGuides = () => callsOf('setSnapGuides').map((c) => c[0]).filter((l) => Array.isArray(l) && l.length > 0)
/** @return {Array<[string[], number, number]>} [ids, dx, dy] of every move intent */
const moves = () => h.intents('move').map((i) => [i.ids, i.dx, i.dy])

/** Press on A (800, 220) and move left by 77 (raw shift (−77, 0)), one frame. */
function dragLeft(props = {}) {
	h.pointer('pointerdown', 800, 220)
	h.pointer('pointermove', 723, 220, props)
	h.frame()
}

describe('AK4: snapping a drag to an equal gap', () => {
	test('A snaps 60 right of Q: preview, two markers, stats in the same frame, no guide; one move intent; markers gone at the release', () => {
		h = setupScene(row())
		assert.equal(h.scene.stats().gapMarkers, 0)
		dragLeft()
		assert.deepEqual(lastRow(A), [A, 620, 120])
		assert.deepEqual(markerCalls().at(-1), MARKERS)
		assert.equal(h.scene.stats().gapMarkers, 2)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.deepEqual(shownGuides(), [])
		h.pointer('pointerup', 723, 220)
		assert.deepEqual(moves(), [[[A], -80, 0]])
		assert.equal(markerCalls().at(-1), null)
		assert.equal(h.scene.stats().gapMarkers, 0)
		assert.equal(h.scene.stats().dragging, false)
	})

	test('setGapMarkers only when the list changes; the markers go ([]) when the drag leaves the threshold', () => {
		h = setupScene(row())
		dragLeft()
		const n = markerCalls().length
		// raw −76: still 60 right of Q, the same markers
		h.pointer('pointermove', 724, 220)
		h.frame()
		assert.equal(markerCalls().length, n)
		assert.deepEqual(lastRow(A), [A, 620, 120])
		// raw −50: 90 right of Q, free again
		h.pointer('pointermove', 750, 220)
		h.frame()
		assert.deepEqual(markerCalls().at(-1), [])
		assert.deepEqual(lastRow(A), [A, 650, 120])
		assert.equal(h.scene.stats().gapMarkers, 0)
		h.pointer('pointerup', 750, 220)
		assert.deepEqual(moves(), [[[A], -50, 0]])
		// no markers stood at the release: no null call
		assert.deepEqual(markerCalls().at(-1), [])
	})

	test('the release order: markers go first, then the preview is cleared, then the intent', () => {
		h = setupScene(row())
		dragLeft()
		const n = h.log.length
		const r = markerCalls().length
		h.pointer('pointerup', 723, 220)
		assert.equal(markerCalls().length, r + 1)
		const after = h.log.slice(n).map((e) => e[0] === 'onIntent' ? 'intent:' + e[1].type : e[0] === 'onDragPreview' ? 'preview:' + e[1].length : e[0])
		assert.deepEqual(after.filter((x) => x.startsWith('preview') || x.startsWith('intent')), ['preview:0', 'intent:move'])
	})
})

describe('AK5: Ctrl/⌘ drags free', () => {
	for (const mod of ['ctrlKey', 'metaKey']) {
		test(`${mod} on the moves: preview [A, 623, 120], intent dx −77, no marker`, () => {
			h = setupScene(row())
			dragLeft({ [mod]: true })
			assert.deepEqual(lastRow(A), [A, 623, 120])
			assert.equal(h.scene.stats().gapMarkers, 0)
			h.pointer('pointerup', 723, 220, { [mod]: true })
			assert.deepEqual(moves(), [[[A], -77, 0]])
			assert.deepEqual(shownMarkers(), [])
		})
	}

	for (const key of ['Control', 'Meta']) {
		test(`${key} pressed and released during a snapped drag acts without a pointer move`, () => {
			h = setupScene(row())
			dragLeft()
			assert.deepEqual(lastRow(A), [A, 620, 120])
			const down = { key, code: '', repeat: false, isComposing: false, ctrlKey: key === 'Control', metaKey: key === 'Meta' }
			dispatch(h.container, 'keydown', down)
			h.frame()
			assert.deepEqual(lastRow(A), [A, 623, 120])
			const last = markerCalls().at(-1)
			assert.ok(last === null || (Array.isArray(last) && last.length === 0), JSON.stringify(last))
			assert.equal(h.scene.stats().gapMarkers, 0)
			dispatch(h.container, 'keyup', { key, code: '' })
			h.frame()
			assert.deepEqual(lastRow(A), [A, 620, 120])
			assert.deepEqual(markerCalls().at(-1), MARKERS)
			assert.equal(h.scene.stats().gapMarkers, 2)
			h.pointer('pointerup', 723, 220)
			assert.deepEqual(moves(), [[[A], -80, 0]])
			// the key reached no shortcut: no other intent
			assert.deepEqual(h.intents().map((i) => i.type), ['move'])
		})
	}
})

describe('AK6: where and when', () => {
	test('(a) P, Q and A in a frame: the frame around A is not part of the row, the same as AK4', () => {
		h = setupScene([frameItem(F, { x: 0, y: 0, w: 1000, h: 700 }), ...row({ p: { parent: F }, q: { parent: F }, a: { parent: F } })])
		dragLeft()
		assert.deepEqual(lastRow(A), [A, 620, 120])
		assert.deepEqual(markerCalls().at(-1), MARKERS)
		assert.equal(h.scene.stats().gapMarkers, 2)
		h.pointer('pointerup', 723, 220)
		assert.deepEqual(moves(), [[[A], -80, 0]])
	})

	test('(b) a note O under the raw box locks: the raw shift, no marker', () => {
		h = setupScene([...row(), note(O, { x: 700, y: 250, z: 'a0' })])
		dragLeft()
		assert.deepEqual(lastRow(A), [A, 623, 120])
		assert.equal(h.scene.stats().gapMarkers, 0)
		h.pointer('pointerup', 723, 220)
		assert.deepEqual(moves(), [[[A], -77, 0]])
		assert.deepEqual(shownMarkers(), [])
	})

	test('(c) P outside the view at the start (x = −300): no reference gap, no marker', () => {
		h = setupScene(row({ p: { x: -300 } }))
		dragLeft()
		assert.deepEqual(lastRow(A), [A, 623, 120])
		assert.equal(h.scene.stats().gapMarkers, 0)
		h.pointer('pointerup', 723, 220)
		assert.deepEqual(moves(), [[[A], -77, 0]])
		assert.deepEqual(shownMarkers(), [])
	})

	test('(d) A already 60 right of Q, dragged by 5: back on its start with two markers, no intent', () => {
		h = setupScene(row({ a: { x: 620 } }))
		h.pointer('pointerdown', 720, 220)
		h.pointer('pointermove', 725, 220)
		h.frame()
		assert.deepEqual(lastRow(A), [A, 620, 120])
		assert.deepEqual(markerCalls().at(-1), MARKERS)
		h.pointer('pointerup', 725, 220)
		assert.deepEqual(moves(), [])
		assert.equal(markerCalls().at(-1), null)
		assert.equal(h.scene.stats().gapMarkers, 0)
	})
})

describe('AK7: the threshold is in screen px', () => {
	// P at (20, 100), Q at (160, 100) (gap 40), A at (360, 120), all 100 × 100; raw −54 leaves 46 to Q (|δ| = 6)
	for (const [scale, snaps] of [[1, true], [0.5, true], [2, false]]) {
		test(`|δ| of 6 world units at scale ${scale} (${6 * scale} px) ${snaps ? 'snaps' : 'does not snap'}`, () => {
			h = setupScene([
				note(P, { x: 20, y: 100, w: 100, h: 100, z: 'a1' }),
				note(Q, { x: 160, y: 100, w: 100, h: 100, z: 'a2' }),
				note(A, { x: 360, y: 120, w: 100, h: 100, z: 'a3' }),
			])
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.frame()
			h.pointer('pointerdown', 410 * scale, 170 * scale)
			h.pointer('pointermove', 356 * scale, 170 * scale)
			h.frame()
			assert.deepEqual(lastRow(A), [A, snaps ? 300 : 306, 120])
			assert.equal(h.scene.stats().gapMarkers, snaps ? 2 : 0)
			h.pointer('pointerup', 356 * scale, 170 * scale)
			assert.deepEqual(moves(), [[[A], snaps ? -60 : -54, 0]])
			if (!snaps) assert.deepEqual(shownMarkers(), [])
		})
	}
})

describe('AK8: the end of a drag snapped to a gap', () => {
	test('Esc: A back at its start, no intent, setGapMarkers(null), gapMarkers 0', () => {
		h = setupScene(row())
		dragLeft()
		assert.equal(h.scene.stats().gapMarkers, 2)
		h.key('Escape')
		assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [700, 120])
		assert.deepEqual(moves(), [])
		assert.equal(markerCalls().at(-1), null)
		assert.equal(h.scene.stats().gapMarkers, 0)
		h.pointer('pointerup', 723, 220)
		assert.deepEqual(moves(), [])
	})

	test("setMode('vote', {settle: true}): the move intent with the snapped shift, markers gone", () => {
		h = setupScene(row())
		dragLeft()
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(moves(), [[[A], -80, 0]])
		assert.equal(markerCalls().at(-1), null)
		assert.equal(h.scene.stats().gapMarkers, 0)
		assert.equal(h.scene.getMode(), 'vote')
		h.pointer('pointerup', 723, 220)
		assert.deepEqual(moves(), [[[A], -80, 0]])
	})

	test('a model reload (reset) drops the drag and its markers', () => {
		h = setupScene(row())
		dragLeft()
		h.scene.reset()
		assert.equal(markerCalls().at(-1), null)
		assert.equal(h.scene.stats().gapMarkers, 0)
		assert.equal(h.scene.stats().dragging, false)
		assert.deepEqual(moves(), [])
	})

	test('stats().gapMarkers is 0 after destroy', () => {
		h = setupScene(row())
		dragLeft()
		assert.equal(h.scene.stats().gapMarkers, 2)
		h.scene.destroy()
		assert.equal(h.scene.stats().gapMarkers, 0)
	})
})

describe('AK9: gapMarkerPoints', () => {
	const mx = Object.freeze({ axis: 'x', from: 300, to: 360, at: 200 })
	const at1 = [300, 196, 300, 204, 300, 200, 360, 200, 360, 196, 360, 204]

	test('axis x: ticks of 8 screen px at both ends, one polyline', () => {
		assert.deepEqual(gapMarkerPoints(mx, 1), at1)
		assert.deepEqual(gapMarkerPoints(mx, 2), [300, 198, 300, 202, 300, 200, 360, 200, 360, 198, 360, 202])
	})

	test('axis y at scale 0.5', () => {
		assert.deepEqual(gapMarkerPoints({ axis: 'y', from: 100, to: 160, at: 50 }, 0.5), [42, 100, 58, 100, 50, 100, 50, 160, 42, 160, 58, 160])
	})

	test('scale 0, −1, NaN and Infinity count as 1', () => {
		for (const s of [0, -1, NaN, Infinity]) assert.deepEqual(gapMarkerPoints(mx, s), at1, String(s))
	})
})
