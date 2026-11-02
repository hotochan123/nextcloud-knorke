/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 194) Distances and size while dragging, deterministic in Node with
 * the real SceneManager, InputController and SceneModel on the fake DOM
 * (renderer stubbed, sceneHarness.mjs):
 * - AK2 a drag: a guide gets a measuring line to the nearest item on its
 *   line with a label (setMeasureLines, setSnapLabels, stats().snapLabels);
 *   equal gaps label every marker with the same number (48.5 / 48.49 too);
 *   Ctrl/⌘, no snap and the grid alone show no numbers; release, Esc,
 *   reset() and destroy() take them away
 * - AK3 a resize: stats().sizeLabel "W × H" of the transformer frame at the
 *   bottom right corner of the drawn frame (handles br, tl, l; zoom 0.5, 1,
 *   2), a rotated item its own size at its hull, several items their common
 *   frame, with Ctrl/⌘ too; a snapped edge gets a measuring line; the
 *   rotation handle shows none; release, Esc and reset() end it
 * - AK6 the same numbers with a finger and a pen
 * - AK7 the preview rows and intents are the same as without the change
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, rcalls, setupScene, shapeItem } from './sceneHarness.mjs'
import { gapFrame } from '../../../src/model/transform.js'
import { rotatedBBox } from '../../../src/model/geometry.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const P = '01JA0000000000000000000003'
const Q = '01JA0000000000000000000004'
const R = '01JA0000000000000000000005'

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** @return {Array} the argument of every setSnapLabels call */
const labelCalls = () => callsOf('setSnapLabels').map((c) => c[0])
/** @return {Array} the argument of every setMeasureLines call */
const measureCalls = () => callsOf('setMeasureLines').map((c) => c[0])
/** @return {Array} the argument of every setSizeLabel call */
const sizeCalls = () => callsOf('setSizeLabel').map((c) => c[0])
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9, `${msg ?? ''} ${a} ≈ ${b}`)

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

/** A at (100, 400), B at (500, 100), both 200 × 200: A dragged up by 95 snaps its top to B's bottom (y 300). */
const pair = () => [note(A, { x: 100, y: 400 }), note(B, { x: 500, y: 100 })]
/** The measuring line of that drag: on y = 300 from A's right edge (300) to B's left edge (500). */
const MEASURE = Object.freeze({ axis: 'x', at: 300, from: 300, to: 500 })
const MEASURE_LABEL = Object.freeze({ text: '200', x: 400, y: 300, place: 'below' })

/** Press on A (200, 500) and move up by 95, one frame. */
function dragUp(props = {}) {
	h.pointer('pointerdown', 200, 500, props)
	h.pointer('pointermove', 200, 405, props)
	h.frame()
}

describe('AK2: numbers of a drag', () => {
	test('a snapped edge: the measuring line to B with its label; stats; gone at the release', () => {
		h = setupScene(pair())
		dragUp()
		assert.deepEqual(measureCalls().at(-1), [MEASURE])
		assert.deepEqual(labelCalls().at(-1), [MEASURE_LABEL])
		assert.equal(h.scene.stats().measureLines, 1)
		assert.deepEqual(h.scene.stats().snapLabels, ['200'])
		assert.equal(h.scene.stats().sizeLabel, null, 'no size label while moving')
		// the same frame again: nothing new handed
		const n = rcalls.length
		h.pointer('pointermove', 200, 404)
		h.frame()
		assert.equal(callsOf('setSnapLabels').length, labelCalls().length)
		assert.equal(rcalls.slice(n).filter((c) => c[0] === 'setSnapLabels' || c[0] === 'setMeasureLines').length, 0)
		h.pointer('pointerup', 200, 404)
		assert.equal(measureCalls().at(-1), null)
		assert.equal(labelCalls().at(-1), null)
		assert.equal(h.scene.stats().measureLines, 0)
		assert.deepEqual(h.scene.stats().snapLabels, [])
		assert.deepEqual(h.intents('move').map((i) => [i.ids, i.dx, i.dy]), [[[A], 0, -100]], 'AK7: the snapped shift as before')
		assert.equal(sizeCalls().length, 0)
	})

	test('leaving the threshold takes the numbers away ([]), coming back shows them again', () => {
		h = setupScene(pair())
		dragUp()
		h.pointer('pointermove', 200, 420)
		h.frame()
		assert.deepEqual(measureCalls().at(-1), [])
		assert.deepEqual(labelCalls().at(-1), [])
		assert.deepEqual(h.scene.stats().snapLabels, [])
		assert.deepEqual(lastRow(A), [A, 100, 320])
		h.pointer('pointermove', 200, 405)
		h.frame()
		assert.deepEqual(labelCalls().at(-1), [MEASURE_LABEL])
	})

	test('equal gaps: every marker shows the length of the reference gap, also 48.49 next to 48.5', () => {
		// P 0–100, Q 148.5–248.5 (48.5), R 296.99–396.99 (48.49), A at 470 dragged left by 23 → 445.49
		h = setupScene([
			note(P, { x: 0, y: 100, w: 100, h: 100 }), note(Q, { x: 148.5, y: 100, w: 100, h: 100, z: 'a2' }),
			note(R, { x: 296.99, y: 100, w: 100, h: 100, z: 'a3' }), note(A, { x: 470, y: 120, w: 100, h: 100, z: 'a4' }),
		])
		h.pointer('pointerdown', 520, 170)
		h.pointer('pointermove', 497, 170)
		h.frame()
		assert.equal(h.scene.stats().gapMarkers, 3)
		assert.deepEqual(h.scene.stats().snapLabels, ['49', '49', '49'])
		const labels = labelCalls().at(-1)
		assert.deepEqual(labels.map((l) => l.place), ['below', 'below', 'below'])
		close(labels[1].x, (248.5 + 296.99) / 2, 'the middle of the Q–R marker')
		h.pointer('pointerup', 497, 170)
	})

	test('equal gaps in a column: the labels lie right of the vertical markers', () => {
		h = setupScene([note(P, { x: 100, y: 0, w: 100, h: 100 }), note(Q, { x: 100, y: 160, w: 100, h: 100, z: 'a2' }),
			note(A, { x: 120, y: 400, w: 100, h: 100, z: 'a3' })])
		h.pointer('pointerdown', 170, 450)
		h.pointer('pointermove', 170, 373)
		h.frame()
		assert.deepEqual(labelCalls().at(-1), [
			{ text: '60', x: 150, y: 130, place: 'right' },
			{ text: '60', x: 160, y: 290, place: 'right' },
		])
		h.pointer('pointerup', 170, 373)
	})

	for (const mod of ['ctrlKey', 'metaKey']) {
		test(`${mod}: no guide, no numbers`, () => {
			h = setupScene(pair())
			dragUp({ [mod]: true })
			assert.deepEqual(h.scene.stats().snapLabels, [])
			assert.equal(callsOf('setSnapLabels').length, 0)
			assert.equal(callsOf('setMeasureLines').length, 0)
			h.pointer('pointerup', 200, 405, { [mod]: true })
		})
	}

	test('Control pressed during a snapped drag takes the numbers away at once', () => {
		h = setupScene(pair())
		dragUp()
		dispatch(h.container, 'keydown', { key: 'Control', code: '', repeat: false, isComposing: false, ctrlKey: true })
		h.frame()
		assert.deepEqual(h.scene.stats().snapLabels, [])
		assert.deepEqual(labelCalls().at(-1), [])
	})

	test('the grid alone draws no guide and so no number', () => {
		h = setupScene(pair(), { scene: { grid: true } })
		h.pointer('pointerdown', 200, 500)
		h.pointer('pointermove', 263, 553)
		h.frame()
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.deepEqual(h.scene.stats().snapLabels, [])
		assert.equal(callsOf('setSnapLabels').length, 0)
	})

	test('Esc, reset() and destroy() take the numbers away', () => {
		h = setupScene(pair())
		dragUp()
		dispatch(h.container, 'keydown', { key: 'Escape', code: 'Escape', repeat: false, isComposing: false })
		assert.equal(labelCalls().at(-1), null)
		assert.deepEqual(h.scene.stats().snapLabels, [])
		dragUp()
		assert.deepEqual(h.scene.stats().snapLabels, ['200'])
		h.model.load(pair())
		h.scene.reset()
		assert.equal(labelCalls().at(-1), null)
		assert.deepEqual(h.scene.stats().snapLabels, [])
		dragUp()
		h.scene.destroy()
		assert.deepEqual(h.scene.stats().snapLabels, [])
		assert.equal(h.scene.stats().measureLines, 0)
	})
})

/** A shape A (100, 100, 200 × 120) selected; B a note. */
function setupResize(items = [], opts = {}) {
	const s = setupScene([shapeItem(A, { x: 100, y: 100 }), ...items], opts)
	s.scene.setSelection([A])
	s.frame()
	return s
}

/**
 * @param {{x:number, y:number, w:number, h:number, r?:number}} f transformer frame
 * @param {number} scale camera scale
 * @return {{x:number, y:number}} the bottom right corner of the drawn frame (its hull when rotated)
 */
function corner(f, scale) {
	const g = gapFrame(f, scale)
	const [, , x1, y1] = rotatedBBox(g.x, g.y, g.w, g.h, g.r || 0)
	return { x: x1, y: y1 }
}

describe('AK3: the size label of a resize', () => {
	test('handle br: "250 × 160" right below the drawn frame\'s bottom right corner; gone at the release', () => {
		h = setupResize()
		h.pointer('pointerdown', 304, 224)
		h.pointer('pointermove', 354, 264)
		h.frame()
		assert.equal(h.scene.stats().sizeLabel, '250 × 160')
		assert.deepEqual(sizeCalls().at(-1), { text: '250 × 160', ...corner({ x: 100, y: 100, w: 250, h: 160 }, 1) })
		assert.deepEqual(sizeCalls().at(-1), { text: '250 × 160', x: 354, y: 264 })
		h.pointer('pointerup', 354, 264)
		assert.equal(sizeCalls().at(-1), null)
		assert.equal(h.scene.stats().sizeLabel, null)
		assert.deepEqual(h.intents('transform')[0].after.get(A), { x: 100, y: 100, w: 250, h: 160, r: 0 }, 'AK7')
	})

	test('handle tl and bl (job 231: no edge handle l): always at the bottom right corner', () => {
		h = setupResize()
		h.pointer('pointerdown', 96, 96)
		h.pointer('pointermove', 56, 76)
		h.frame()
		assert.equal(h.scene.stats().sizeLabel, '240 × 140')
		assert.deepEqual(sizeCalls().at(-1), { text: '240 × 140', x: 304, y: 224 })
		h.pointer('pointerup', 56, 76)
		h.restore()
		h = setupResize()
		h.pointer('pointerdown', 96, 224)
		h.pointer('pointermove', 46, 224)
		h.frame()
		assert.deepEqual(sizeCalls().at(-1), { text: '250 × 120', x: 304, y: 224 })
	})

	for (const scale of [0.5, 2]) {
		test(`zoom ${scale}: the anchor keeps the gap of the drawn frame at that scale`, () => {
			h = setupResize()
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.frame()
			const s = (v) => v * scale
			const br = { x: 300 + 4 / scale, y: 220 + 4 / scale }
			h.pointer('pointerdown', s(br.x), s(br.y))
			h.pointer('pointermove', s(br.x + 40), s(br.y + 20))
			h.frame()
			assert.equal(h.scene.stats().sizeLabel, '240 × 140')
			const got = sizeCalls().at(-1)
			const want = corner({ x: 100, y: 100, w: 240, h: 140 }, scale)
			close(got.x, want.x, 'x')
			close(got.y, want.y, 'y')
		})
	}

	test('a rotated item: its own size, anchored at the hull of its rotated frame', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100, w: 200, h: 120, r: 30 })])
		h.scene.setSelection([A])
		h.frame()
		const br = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', br.x, br.y)
		h.pointer('pointermove', br.x + 10, br.y + 10)
		h.frame()
		const f = h.model.get(A)
		assert.equal(f.r, 30)
		assert.equal(h.scene.stats().sizeLabel, `${Math.round(f.w)} × ${Math.round(f.h)}`)
		const want = corner({ x: f.x, y: f.y, w: f.w, h: f.h, r: 30 }, 1)
		close(sizeCalls().at(-1).x, want.x, 'x')
		close(sizeCalls().at(-1).y, want.y, 'y')
	})

	test('several items: the common frame', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 }), shapeItem(B, { x: 400, y: 300, z: 'a3' })])
		h.scene.setSelection([A, B])
		h.frame()
		// union 100–600 × 100–420; corner br at (604, 424); the ratio stays (500 × 320)
		h.pointer('pointerdown', 604, 424)
		h.pointer('pointermove', 704, 488)
		h.frame()
		assert.equal(h.scene.stats().sizeLabel, '600 × 384')
		assert.deepEqual(sizeCalls().at(-1), { text: '600 × 384', x: 704, y: 488 })
	})

	test('Ctrl/⌘: no snapping, the size label stays', () => {
		h = setupResize([note(B, { x: 500, y: 100 })])
		h.pointer('pointerdown', 304, 224, { ctrlKey: true })
		h.pointer('pointermove', 499, 224, { ctrlKey: true })
		h.frame()
		assert.equal(h.scene.stats().sizeLabel, '395 × 120')
		assert.deepEqual(h.scene.stats().snapLabels, [])
	})

	test('a snapped edge: the measuring line to the item below on that line, with its label', () => {
		// B below on x = 500: A's right edge snaps to 500 (raw 495), the line runs from A's bottom (220) to B's top (400)
		h = setupResize([note(B, { x: 500, y: 400 })])
		h.pointer('pointerdown', 304, 224)
		h.pointer('pointermove', 499, 224)
		h.frame()
		assert.equal(h.model.get(A).w, 400)
		assert.deepEqual(measureCalls().at(-1), [{ axis: 'y', at: 500, from: 220, to: 400 }])
		assert.deepEqual(labelCalls().at(-1), [{ text: '180', x: 500, y: 310, place: 'right' }])
		assert.deepEqual(h.scene.stats().snapLabels, ['180'])
		assert.equal(h.scene.stats().sizeLabel, '400 × 120')
		h.pointer('pointerup', 499, 224)
		assert.equal(labelCalls().at(-1), null)
		assert.equal(measureCalls().at(-1), null)
		assert.equal(h.scene.stats().sizeLabel, null)
	})

	test('the rotation handle shows no size label', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100, w: 100, h: 100 })])
		h.scene.setSelection([A])
		h.frame()
		h.pointer('pointerdown', 220, 80)
		h.pointer('pointermove', 250, 250)
		h.frame()
		assert.equal(h.scene.stats().transforming, true)
		assert.equal(h.scene.stats().sizeLabel, null)
		assert.equal(sizeCalls().length, 0)
	})

	test('Esc and reset() end the size label', () => {
		h = setupResize()
		h.pointer('pointerdown', 304, 224)
		h.pointer('pointermove', 354, 264)
		h.frame()
		dispatch(h.container, 'keydown', { key: 'Escape', code: 'Escape', repeat: false, isComposing: false })
		assert.equal(h.scene.stats().sizeLabel, null)
		assert.equal(sizeCalls().at(-1), null)
		h.pointer('pointerup', 354, 264)
		h.pointer('pointerdown', 304, 224)
		h.pointer('pointermove', 354, 264)
		h.frame()
		assert.equal(h.scene.stats().sizeLabel, '250 × 160')
		h.model.load([shapeItem(A, { x: 100, y: 100 })])
		h.scene.reset()
		assert.equal(h.scene.stats().sizeLabel, null)
		assert.equal(sizeCalls().at(-1), null)
	})
})

describe('AK6: finger and pen', () => {
	for (const pointerType of ['touch', 'pen']) {
		test(`${pointerType}: the same numbers while dragging and resizing`, () => {
			const p = { pointerType, pointerId: 7 }
			h = setupScene(pair())
			h.scene.setSelection([A])
			h.frame()
			dragUp(p)
			assert.deepEqual(h.scene.stats().snapLabels, ['200'])
			assert.deepEqual(labelCalls().at(-1), [MEASURE_LABEL])
			h.pointer('pointerup', 200, 405, p)
			assert.deepEqual(h.scene.stats().snapLabels, [])
			h.restore()
			h = setupResize()
			h.pointer('pointerdown', 304, 224, p)
			h.pointer('pointermove', 354, 264, p)
			h.frame()
			assert.equal(h.scene.stats().sizeLabel, '250 × 160')
			assert.deepEqual(sizeCalls().at(-1), { text: '250 × 160', x: 354, y: 264 })
			h.pointer('pointerup', 354, 264, p)
			assert.equal(h.scene.stats().sizeLabel, null)
		})
	}
})
