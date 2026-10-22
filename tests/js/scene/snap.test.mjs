/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Snapping a drag to other items (M2, SPEC-M1 §1.2 (R12)), deterministic in
 * Node with the real SceneManager, InputController and SceneModel on the
 * fake DOM (renderer stubbed, sceneHarness.mjs):
 * - AK4: the top edge of A snaps to the bottom edge of B: preview row,
 *   guide (setSnapGuides), stats().snapGuides, one move intent with the
 *   snapped shift; at the release setSnapGuides(null), snapGuides 0
 * - AK5: Ctrl/⌘ on the moves drags free; Control/Meta pressed and released
 *   during a snapped drag act without a pointer move
 * - AK6: no targets: a connector, the dragged frame's child and the frame's
 *   own start, an item outside the view, the dragged note's own start
 * - AK7: the threshold is OBJECT_SNAP_PX screen px of the scale
 * - AK8: Esc and setMode('vote', {settle}) end a snapped drag (guides gone)
 * - snapGuideDashOffset (job 010): the dash phase of a guide in [0, 8), anchored to the board
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene } from './sceneHarness.mjs'
import { snapGuideDashOffset } from '../../../src/scene/KonvaRenderer.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const F = '01JA00000000000000000000F1'
const K = '01JA00000000000000000000K1'
const C1 = '01JA00000000000000000000C1'

/** A at (100, 400), B at (500, 100), both 200 × 200: A dragged up by 95 has its top 5 below B's bottom. */
const pair = (b = {}) => [note(A, { x: 100, y: 400 }), note(B, { x: 500, y: 100, ...b })]
const conn = (id, start, end) => ({
	id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + id.slice(-2), parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' },
})
/** The guide of AK4: B's bottom edge, from A's left edge to B's right edge. */
const GUIDE_Y300 = Object.freeze([{ axis: 'y', at: 300, from: 100, to: 700 }])

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
		const row = e[1].find((r) => r[0] === id)
		if (row) return row
	}
	return null
}

/** @return {Array} the argument of every setSnapGuides call */
const guideCalls = () => callsOf('setSnapGuides').map((c) => c[0])
/** @return {Array} the calls with a non-empty list */
const shownGuides = () => guideCalls().filter((l) => Array.isArray(l) && l.length > 0)
/** @return {Array<[string[], number, number]>} [ids, dx, dy] of every move intent */
const moves = () => h.intents('move').map((i) => [i.ids, i.dx, i.dy])

/** Press on A (200, 500) and move up by 95 (raw shift (0, −95)), one frame. */
function dragUp(props = {}) {
	h.pointer('pointerdown', 200, 500)
	h.pointer('pointermove', 200, 405, props)
	h.frame()
}

describe('AK4: snapping a drag', () => {
	test('A snaps to the bottom edge of B: preview, guide and stats in the same frame; one move intent; guides gone at the release', () => {
		h = setupScene(pair())
		assert.equal(h.scene.stats().snapGuides, 0)
		dragUp()
		assert.deepEqual(lastRow(A), [A, 100, 300])
		assert.deepEqual(guideCalls().at(-1), GUIDE_Y300)
		assert.equal(h.scene.stats().snapGuides, 1)
		h.pointer('pointerup', 200, 405)
		assert.deepEqual(moves(), [[[A], 0, -100]])
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.stats().dragging, false)
	})

	test('setSnapGuides only when the list changes; the guide goes ([]) when the drag leaves the threshold', () => {
		h = setupScene(pair())
		dragUp()
		const n = guideCalls().length
		// raw −96: still snapped to 300, the same guide
		h.pointer('pointermove', 200, 404)
		h.frame()
		assert.equal(guideCalls().length, n)
		assert.deepEqual(lastRow(A), [A, 100, 300])
		// raw −80: 20 below, free again
		h.pointer('pointermove', 200, 420)
		h.frame()
		assert.deepEqual(guideCalls().at(-1), [])
		assert.deepEqual(lastRow(A), [A, 100, 320])
		assert.equal(h.scene.stats().snapGuides, 0)
		h.pointer('pointerup', 200, 420)
		assert.deepEqual(moves(), [[[A], 0, -80]])
		// no guides stood at the release: no null call
		assert.deepEqual(guideCalls().at(-1), [])
	})

	test('the release order: guides go first, then the preview is cleared, then the intent', () => {
		h = setupScene(pair())
		dragUp()
		const n = h.log.length
		const r = callsOf('setSnapGuides').length
		h.pointer('pointerup', 200, 405)
		assert.equal(callsOf('setSnapGuides').length, r + 1)
		const after = h.log.slice(n).map((e) => e[0] === 'onIntent' ? 'intent:' + e[1].type : e[0] === 'onDragPreview' ? 'preview:' + e[1].length : e[0])
		assert.deepEqual(after.filter((x) => x.startsWith('preview') || x.startsWith('intent')), ['preview:0', 'intent:move'])
	})
})

describe('AK5: Ctrl/⌘ drags free', () => {
	for (const mod of ['ctrlKey', 'metaKey']) {
		test(`${mod} on the moves: preview [A, 100, 305], intent dy −95, no guide`, () => {
			h = setupScene(pair())
			dragUp({ [mod]: true })
			assert.deepEqual(lastRow(A), [A, 100, 305])
			assert.equal(h.scene.stats().snapGuides, 0)
			h.pointer('pointerup', 200, 405, { [mod]: true })
			assert.deepEqual(moves(), [[[A], 0, -95]])
			assert.deepEqual(shownGuides(), [])
		})
	}

	for (const key of ['Control', 'Meta']) {
		test(`${key} pressed and released during a snapped drag acts without a pointer move`, () => {
			h = setupScene(pair())
			dragUp()
			assert.deepEqual(lastRow(A), [A, 100, 300])
			const down = { key, code: '', repeat: false, isComposing: false, ctrlKey: key === 'Control', metaKey: key === 'Meta' }
			dispatch(h.container, 'keydown', down)
			h.frame()
			assert.deepEqual(lastRow(A), [A, 100, 305])
			const last = guideCalls().at(-1)
			assert.ok(last === null || (Array.isArray(last) && last.length === 0), JSON.stringify(last))
			assert.equal(h.scene.stats().snapGuides, 0)
			dispatch(h.container, 'keyup', { key, code: '' })
			h.frame()
			assert.deepEqual(lastRow(A), [A, 100, 300])
			assert.deepEqual(guideCalls().at(-1), GUIDE_Y300)
			assert.equal(h.scene.stats().snapGuides, 1)
			h.pointer('pointerup', 200, 405)
			assert.deepEqual(moves(), [[[A], 0, -100]])
			// the key reached no shortcut: no other intent
			assert.deepEqual(h.intents().map((i) => i.type), ['move'])
		})
	}

	test('a move without the modifier after a Ctrl keydown snaps again (a missed keyup corrects itself)', () => {
		h = setupScene(pair())
		dragUp()
		dispatch(h.container, 'keydown', { key: 'Control', code: '', repeat: false, isComposing: false, ctrlKey: true })
		h.frame()
		assert.deepEqual(lastRow(A), [A, 100, 305])
		h.pointer('pointermove', 200, 404)
		h.frame()
		assert.deepEqual(lastRow(A), [A, 100, 300])
		h.pointer('pointerup', 200, 404)
		assert.deepEqual(moves(), [[[A], 0, -100]])
	})
})

describe('AK6: what is no target', () => {
	test('(a) a connector with free ends on y = 300', () => {
		h = setupScene([note(A, { x: 100, y: 400 }), conn(C1, { x: 500, y: 300 }, { x: 700, y: 300 })])
		dragUp()
		assert.deepEqual(lastRow(A), [A, 100, 305])
		h.pointer('pointerup', 200, 405)
		assert.deepEqual(moves(), [[[A], 0, -95]])
		assert.deepEqual(shownGuides(), [])
	})

	test('(b) a frame dragged by 5 px: its child (flush at its left edge) and its own start are no targets', () => {
		h = setupScene([frameItem(F, { x: 100, y: 100, w: 600, h: 400 }), note(K, { x: 0, y: 100, parent: F })])
		// the title band above the frame
		h.pointer('pointerdown', 400, 80)
		h.pointer('pointermove', 405, 80)
		h.frame()
		h.pointer('pointerup', 405, 80)
		assert.deepEqual(moves(), [[[F], 5, 0]])
		assert.deepEqual(shownGuides(), [])
	})

	test('(c) B outside the view at the start (x = 1100)', () => {
		h = setupScene(pair({ x: 1100 }))
		dragUp()
		assert.deepEqual(lastRow(A), [A, 100, 305])
		h.pointer('pointerup', 200, 405)
		assert.deepEqual(moves(), [[[A], 0, -95]])
		assert.deepEqual(shownGuides(), [])
	})

	test('(d) a single note dragged by 5 px does not snap back to its own start', () => {
		h = setupScene([note(A, { x: 100, y: 400 })])
		h.pointer('pointerdown', 200, 500)
		h.pointer('pointermove', 205, 500)
		h.frame()
		assert.deepEqual(lastRow(A), [A, 105, 400])
		h.pointer('pointerup', 205, 500)
		assert.deepEqual(moves(), [[[A], 5, 0]])
		assert.deepEqual(shownGuides(), [])
	})

	test('the frame around a dragged note is a target (its left edge)', () => {
		h = setupScene([frameItem(F, { x: 0, y: 0, w: 900, h: 700 }), note(A, { x: 100, y: 300, parent: F })])
		// A's left edge from 100 to 6: 6 from the frame's left edge
		h.pointer('pointerdown', 200, 400)
		h.pointer('pointermove', 106, 400)
		h.frame()
		assert.deepEqual(lastRow(A), [A, 0, 300])
		assert.deepEqual(guideCalls().at(-1), [{ axis: 'x', at: 0, from: 0, to: 700 }])
		h.pointer('pointerup', 106, 400)
		assert.deepEqual(moves(), [[[A], -100, 0]])
	})
})

describe('AK7: the threshold is in screen px', () => {
	// A at (100, 300), B at (300, 100), both 100 × 100; A dragged up by 94 world units: 6 below B
	for (const [scale, snaps] of [[1, true], [0.5, true], [2, false]]) {
		test(`a gap of 6 world units at scale ${scale} (${6 * scale} px) ${snaps ? 'snaps' : 'does not snap'}`, () => {
			h = setupScene([note(A, { x: 100, y: 300, w: 100, h: 100 }), note(B, { x: 300, y: 100, w: 100, h: 100 })])
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.frame()
			h.pointer('pointerdown', 150 * scale, 350 * scale)
			h.pointer('pointermove', 150 * scale, 256 * scale)
			h.frame()
			assert.deepEqual(lastRow(A), [A, 100, snaps ? 200 : 206])
			assert.equal(h.scene.stats().snapGuides, snaps ? 1 : 0)
			h.pointer('pointerup', 150 * scale, 256 * scale)
			assert.deepEqual(moves(), [[[A], 0, snaps ? -100 : -94]])
		})
	}
})

describe('AK8: the end of a snapped drag', () => {
	test('Esc: A back at its start, no intent, setSnapGuides(null), snapGuides 0', () => {
		h = setupScene(pair())
		dragUp()
		assert.equal(h.scene.stats().snapGuides, 1)
		h.key('Escape')
		assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [100, 400])
		assert.deepEqual(moves(), [])
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		h.pointer('pointerup', 200, 405)
		assert.deepEqual(moves(), [])
	})

	test("setMode('vote', {settle: true}): the move intent with the snapped shift, guides gone", () => {
		h = setupScene(pair())
		dragUp()
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(moves(), [[[A], 0, -100]])
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.getMode(), 'vote')
		h.pointer('pointerup', 200, 405)
		assert.deepEqual(moves(), [[[A], 0, -100]])
	})

	test('a model reload (reset) drops the drag and its guides', () => {
		h = setupScene(pair())
		dragUp()
		h.scene.reset()
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.stats().dragging, false)
		assert.deepEqual(moves(), [])
	})

	test('stats().snapGuides is 0 after destroy (no mount)', () => {
		h = setupScene(pair())
		dragUp()
		h.scene.destroy()
		assert.equal(h.scene.stats().snapGuides, 0)
	})
})

describe('snapGuideDashOffset: the dash phase of a guide, anchored to the board', () => {
	/** Deterministic PRNG (mulberry32, as in tests/js/model/zorder.test.mjs). */
	function prng(seed) {
		let a = seed >>> 0
		return () => {
			a = (a + 0x6D2B79F5) >>> 0
			let t = a
			t = Math.imul(t ^ (t >>> 15), t | 1)
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}
	const P = 8
	/** @return {number} the distance of two phases on the circle of length P */
	const circleDist = (a, b) => {
		const d = (((a - b) % P) + P) % P
		return Math.min(d, P - d)
	}

	test('fixed values: (from · scale) mod 8, never −0', () => {
		assert.strictEqual(snapGuideDashOffset(0, 1), 0)
		assert.strictEqual(snapGuideDashOffset(10, 1), 2)
		assert.strictEqual(snapGuideDashOffset(-3, 1), 5)
		assert.strictEqual(snapGuideDashOffset(-8, 1), 0)
		assert.ok(!Object.is(snapGuideDashOffset(-8, 1), -0))
		assert.strictEqual(snapGuideDashOffset(10, 0.5), 5)
		assert.strictEqual(snapGuideDashOffset(2.5, 2), 5)
		assert.strictEqual(snapGuideDashOffset(1e7, 4), 0)
	})

	test('a non-finite from or scale and scale ≤ 0 give 0', () => {
		assert.strictEqual(snapGuideDashOffset(NaN, 1), 0)
		assert.strictEqual(snapGuideDashOffset(10, 0), 0)
		assert.strictEqual(snapGuideDashOffset(10, -1), 0)
		assert.strictEqual(snapGuideDashOffset(10, Infinity), 0)
	})

	test('50 seeded pairs (from in [−1e4, 1e4], scale in [0.05, 4]) lie in [0, 8)', () => {
		const rnd = prng(0x5a4d)
		for (let k = 0; k < 50; k++) {
			const from = -1e4 + rnd() * 2e4
			const scale = 0.05 + rnd() * 3.95
			const o = snapGuideDashOffset(from, scale)
			assert.ok(o >= 0 && o < P && !Object.is(o, -0), `(${from}, ${scale}) → ${o}`)
		}
	})

	test('the dashes stand still: a world point has the same phase whichever from the guide starts at', () => {
		const w = 250
		for (const s of [1, 0.5, 2, 0.05]) {
			const phase = (from) => (snapGuideDashOffset(from, s) + (w - from) * s) % P
			assert.ok(circleDist(phase(100), phase(37.5)) <= 1e-9, `scale ${s}: ${phase(100)} vs ${phase(37.5)}`)
		}
	})
})
