/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The background grid in the scene (M2, SPEC-M1 §1.2 (R12), job 016),
 * deterministic in Node:
 * - AK3: TransformController.step(…, {snap: {index, tol, grid}}) on a real
 *   SceneModel: a side handle snaps to the grid, a text item keeps its font
 *   size, a frame among several items and a rotated shape do not snap
 * - with the real SceneManager, InputController and SceneModel on the fake
 *   DOM (renderer stubbed, sceneHarness.mjs):
 *   - AK4: option grid, setGrid/getGrid (only true turns it on, no echo),
 *     renderer.setGrid after mount, stats().grid
 *   - AK5: a drag snaps the top-left corner of the box to the grid; Ctrl/⌘
 *     on the move and pressed/released during the drag drags free
 *   - AK6: a resize snaps the moving edge to the grid; Ctrl/⌘; an item
 *     line keeps the priority (its guide)
 *   - AK7: the key G with the canvas focus toggles and reports onGrid; not
 *     with Shift, Ctrl/⌘, Alt, on repeat, without the focus, during a drag
 *     or in the text editor; in every mode
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { buildSnapIndex } from '../../../src/model/snap.js'
import { TransformController } from '../../../src/scene/TransformController.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, rcalls, setupScene, shapeItem, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const G = '01JA00000000000000000000G1'

const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`)
/** @return {object} x, y, w, h, r of a box */
const box = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, r: b.r })
const none = buildSnapIndex([])
const SNAP = Object.freeze({ index: none, tol: 8, grid: 20 })

/**
 * @param {object[]} items WireItems
 * @return {{m: SceneModel, xf: TransformController}}
 */
function make(items) {
	const m = new SceneModel()
	m.load(items)
	return { m, xf: new TransformController(m) }
}

describe('AK3: TransformController.step with snap.grid', () => {
	test('(a) a shape at the side handle r: the right edge 333 snaps to 340 (w 240)', () => {
		const { xf } = make([shapeItem(A, { x: 100, y: 100, w: 200, h: 120 })])
		assert.ok(xf.begin([A], 'r', { x: 300, y: 160 }))
		const r = xf.step({ x: 333, y: 160 }, { snap: SNAP })
		assert.deepEqual(box(r.boxes.get(A)), { x: 100, y: 100, w: 240, h: 120, r: 0 })
		assert.deepEqual(r.guides, [])
	})

	test('(b) a text item at r: w 340, the font size stays', () => {
		const { xf } = make([textItem(A, { x: 0, y: 0, w: 240, h: 28.8 })])
		assert.ok(xf.begin([A], 'r', { x: 240, y: 14.4 }))
		const r = xf.step({ x: 333, y: 14.4 }, { snap: SNAP })
		close(r.boxes.get(A).w, 340, 'w')
		assert.equal(r.fonts.get(A), 24)
		assert.equal(r.map.get(A).fontSize, 24, 'the stored font size unchanged')
	})

	test('(c) a shape and a frame together: nothing snaps, the result without snap', () => {
		const items = [shapeItem(A, { x: 100, y: 100, w: 200, h: 120 }), frameItem(G, { x: 100, y: 300, w: 200, h: 100 })]
		const one = make(items)
		one.xf.begin([A, G], 'br', { x: 300, y: 400 })
		const r = one.xf.step({ x: 397, y: 545.5 }, { snap: SNAP })
		const want = { x: 100, y: 100, w: 297, h: 178.2 }
		for (const k of Object.keys(want)) close(r.boxes.get(A)[k], want[k], k)
		const two = make(items)
		two.xf.begin([A, G], 'br', { x: 300, y: 400 })
		assert.deepEqual([...r.boxes], [...two.xf.step({ x: 397, y: 545.5 }).boxes])
	})

	test('(d) a rotated shape: the same boxes as without snap', () => {
		const items = [shapeItem(A, { x: 100, y: 100, w: 200, h: 120, r: 30 })]
		const one = make(items)
		one.xf.begin([A], 'br', { x: 300, y: 220 })
		const r = one.xf.step({ x: 333, y: 247 }, { snap: SNAP })
		const two = make(items)
		two.xf.begin([A], 'br', { x: 300, y: 220 })
		assert.deepEqual(box(r.boxes.get(A)), box(two.xf.step({ x: 333, y: 247 }).boxes.get(A)))
	})
})

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** @return {Array} the arguments of every renderer setGrid call */
const gridCalls = () => callsOf('setGrid').map((c) => c[0])
/** @return {Array} the onGrid reports */
const onGrids = () => h.log.filter((e) => e[0] === 'onGrid').map((e) => e[1])
/** @return {Array} the setSnapGuides calls with a non-empty list */
const shownGuides = () => callsOf('setSnapGuides').map((c) => c[0]).filter((l) => Array.isArray(l) && l.length > 0)
/** @return {{x:number, y:number}} the position of A */
const posA = () => ({ x: h.model.abs(A).x, y: h.model.abs(A).y })

describe('AK4: option, setGrid, getGrid, stats', () => {
	test('off by default; setGrid(true) once to the renderer; again nothing; only true turns it on; no onGrid', () => {
		h = setupScene([note(A)])
		assert.equal(h.scene.getGrid(), false)
		assert.equal(h.scene.stats().grid, false)
		assert.deepEqual(gridCalls(), [])
		h.scene.setGrid(true)
		assert.deepEqual(gridCalls(), [true])
		assert.equal(h.scene.getGrid(), true)
		assert.equal(h.scene.stats().grid, true)
		h.scene.setGrid(true)
		assert.deepEqual(gridCalls(), [true], 'the same state: nothing')
		h.scene.setGrid('yes')
		assert.deepEqual(gridCalls(), [true, false], '"yes" turns it off')
		assert.equal(h.scene.getGrid(), false)
		h.scene.setGrid(true)
		h.scene.setGrid(1)
		assert.deepEqual(gridCalls(), [true, false, true, false], '1 turns it off')
		assert.equal(h.scene.getGrid(), false)
		assert.deepEqual(onGrids(), [], 'no echo')
	})

	test('option grid true: one setGrid(true) right after mount; getGrid true', () => {
		h = setupScene([], { scene: { grid: true } })
		const names = rcalls.map((c) => c[0])
		assert.deepEqual(gridCalls(), [true])
		assert.equal(names.indexOf('setGrid'), names.indexOf('mount') + 1, 'directly after mount')
		assert.equal(h.scene.getGrid(), true)
		assert.equal(h.scene.stats().grid, true)
	})

	test('only true turns the option on', () => {
		for (const v of ['1', 1, 'true', null]) {
			h = setupScene([], { scene: { grid: v } })
			assert.equal(h.scene.getGrid(), false, String(v))
			assert.deepEqual(gridCalls(), [])
			h.restore()
			h = null
		}
	})

	test('after destroy: grid kept in stats, draws {static, overlay, grid} 0, setGrid reaches no renderer', () => {
		h = setupScene([note(A)])
		h.scene.setGrid(true)
		h.restore()
		const st = h.scene.stats()
		assert.equal(st.grid, true)
		assert.deepEqual(st.draws, { static: 0, overlay: 0, grid: 0 })
		const n = gridCalls().length
		h.scene.setGrid(false)
		assert.equal(gridCalls().length, n)
		assert.equal(h.scene.getGrid(), false)
		h = null
	})
})

describe('AK5: a drag snaps to the grid', () => {
	test('(a) raw (+33, +47): A at (140, 140), no guide; one move intent (40, 40)', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setGrid(true)
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 233, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 140, y: 140 })
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.deepEqual(shownGuides(), [])
		h.pointer('pointerup', 233, 247)
		const moves = h.intents('move')
		assert.equal(moves.length, 1)
		assert.equal(moves[0].dx, 40)
		assert.equal(moves[0].dy, 40)
	})

	for (const mod of ['ctrlKey', 'metaKey']) {
		test(`(b) ${mod} on the move: A at (133, 147), intent (33, 47)`, () => {
			h = setupScene([note(A, { x: 100, y: 100 })])
			h.scene.setGrid(true)
			h.pointer('pointerdown', 200, 200)
			h.pointer('pointermove', 233, 247, { [mod]: true })
			h.frame()
			assert.deepEqual(posA(), { x: 133, y: 147 })
			h.pointer('pointerup', 233, 247, { [mod]: true })
			assert.deepEqual(h.intents('move').map((i) => [i.dx, i.dy]), [[33, 47]])
		})
	}

	test('(c) Control pressed and released during the drag acts without a pointer move', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setGrid(true)
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 233, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 140, y: 140 })
		dispatch(h.container, 'keydown', { key: 'Control', code: '', repeat: false, isComposing: false, ctrlKey: true })
		h.frame()
		assert.deepEqual(posA(), { x: 133, y: 147 })
		dispatch(h.container, 'keyup', { key: 'Control', code: '' })
		h.frame()
		assert.deepEqual(posA(), { x: 140, y: 140 })
		h.pointer('pointerup', 233, 247)
		assert.deepEqual(h.intents('move').map((i) => [i.dx, i.dy]), [[40, 40]])
		assert.deepEqual(onGrids(), [], 'the modifier is no grid key')
	})

	test('(d) with setGrid(false) the same drag is raw', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.scene.setGrid(true)
		h.scene.setGrid(false)
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 233, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 133, y: 147 })
		h.pointer('pointerup', 233, 247)
		assert.deepEqual(h.intents('move').map((i) => [i.dx, i.dy]), [[33, 47]])
	})

	test('a switch during the drag acts from the next step', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 233, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 133, y: 147 })
		h.scene.setGrid(true)
		h.pointer('pointermove', 234, 247)
		h.frame()
		assert.deepEqual(posA(), { x: 140, y: 140 })
		h.pointer('pointerup', 234, 247)
		assert.deepEqual(h.intents('move').map((i) => [i.dx, i.dy]), [[40, 40]])
	})
})

describe('AK6: a resize snaps to the grid', () => {
	/** A shape A (100, 100, 200 × 120) selected, the grid on; press on its handle r and move to x, one frame. */
	function pull(x, props = {}, items = []) {
		h = setupScene([shapeItem(A, { x: 100, y: 100 }), ...items])
		h.scene.setSelection([A])
		h.scene.setGrid(true)
		h.pointer('pointerdown', 300, 160)
		h.pointer('pointermove', x, 160, props)
		h.frame()
	}

	test('(a) raw right edge 333 → 340: w 240, no guide; one transform intent with w 240', () => {
		pull(333)
		assert.equal(h.model.get(A).w, 240)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.deepEqual(shownGuides(), [])
		h.pointer('pointerup', 333, 160)
		const it = h.intents('transform')
		assert.equal(it.length, 1)
		assert.equal(it[0].after.get(A).w, 240)
	})

	test('(b) Ctrl on the move: w 233', () => {
		pull(333, { ctrlKey: true })
		assert.equal(h.model.get(A).w, 233)
		h.pointer('pointerup', 333, 160, { ctrlKey: true })
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [233])
	})

	test('(c) a note B at x 336: the item line wins (w 236, its guide), not the grid (240)', () => {
		pull(333, {}, [note(B, { x: 336, y: 300 })])
		assert.equal(h.model.get(A).w, 236)
		assert.deepEqual(callsOf('setSnapGuides').at(-1)[0], [{ axis: 'x', at: 336, from: 100, to: 500 }])
		h.pointer('pointerup', 333, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [236])
	})
})

describe('AK7: the key G', () => {
	const g = (props = {}) => h.key('g', props)

	test('g toggles: setGrid(true) and one onGrid(true), then setGrid(false) and onGrid(false); no preventDefault', () => {
		h = setupScene([note(A)])
		const e = g()
		assert.equal(e.defaultPrevented, false)
		assert.deepEqual(gridCalls(), [true])
		assert.deepEqual(onGrids(), [true])
		assert.equal(h.scene.getGrid(), true)
		g()
		assert.deepEqual(gridCalls(), [true, false])
		assert.deepEqual(onGrids(), [true, false])
		assert.equal(h.scene.getGrid(), false)
		assert.deepEqual(h.intents(), [], 'no intent')
	})

	test('no effect: Shift+G, Ctrl/⌘/Alt+g, a repeat, without the canvas focus', () => {
		h = setupScene([note(A)])
		h.key('G', { shiftKey: true })
		g({ ctrlKey: true })
		g({ metaKey: true })
		g({ altKey: true })
		g({ repeat: true })
		g({ target: h.dom.doc.body })
		assert.deepEqual(gridCalls(), [])
		assert.deepEqual(onGrids(), [])
		assert.equal(h.scene.getGrid(), false)
	})

	test('no effect during a drag (over the threshold, before the release)', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 233, 247)
		h.frame()
		assert.equal(h.scene.stats().dragging, true)
		g()
		h.pointer('pointerup', 233, 247)
		assert.deepEqual(gridCalls(), [])
		assert.deepEqual(onGrids(), [])
	})

	test('no effect in the open text editor', () => {
		h = setupScene([note(A)])
		assert.equal(h.scene.openTextEditor(A), true)
		const ta = h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
		assert.ok(ta, 'editor open')
		g({ target: ta })
		assert.deepEqual(gridCalls(), [])
		assert.deepEqual(onGrids(), [])
	})

	test('modes view and vote: g still toggles', () => {
		h = setupScene([note(A)])
		h.scene.setMode('view')
		g()
		assert.equal(h.scene.getGrid(), true)
		h.scene.setMode('vote')
		g()
		assert.equal(h.scene.getGrid(), false)
		assert.deepEqual(gridCalls(), [true, false])
		assert.deepEqual(onGrids(), [true, false])
	})
})
