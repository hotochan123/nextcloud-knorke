/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Snapping a resize to other items (M2, SPEC-M1 §1.2 (R12), job 015),
 * deterministic in Node:
 * - AK5: TransformController.step(…, {snap}) on a real SceneModel: several
 *   items snap with the union frame, not with a frame among them; a text
 *   item only along x (font size from the snapped k); a rotated shape and
 *   the rotation handle do not snap; without snap the old result
 * - with the real SceneManager, InputController and SceneModel on the fake
 *   DOM (renderer stubbed, sceneHarness.mjs):
 *   - AK6: the right edge of A snaps to the left edge of B: model, guide
 *     (setSnapGuides), stats().snapGuides; one transform intent; at the
 *     release setSnapGuides(null) before onDragPreview([]) and the intent
 *   - AK7: Ctrl/⌘ on the moves resizes free; Control/Meta pressed and
 *     released during a snapped resize act without a pointer move
 *   - AK8: a note corner keeps its ratio, Shift frees it; the child of a
 *     resized frame is a target; no target: the own start, a connector, an
 *     item outside the view
 *   - AK9: the threshold is OBJECT_SNAP_PX screen px of the scale
 *   - AK10: Esc, setMode('vote', {settle}), the item removed, reset and
 *     destroy end a snapped resize (guides gone)
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
const C = '01JA0000000000000000000003'
const F = '01JA00000000000000000000F1'
const G = '01JA00000000000000000000G1'
const K = '01JA00000000000000000000K1'
const C1 = '01JA00000000000000000000C1'

const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`)
/** @return {object} x, y, w, h, r of a box */
const box = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, r: b.r })
/** @return {object} the index of the candidate boxes {minX, minY, maxX, maxY} */
const idx = (...boxes) => buildSnapIndex(boxes)
/** @param {object} a box @param {object} b expected box @param {string} [msg] label */
function closeBox(a, b, msg) {
	for (const k of Object.keys(b)) close(a[k], b[k], `${msg ?? ''} ${k}`)
}

/**
 * @param {object[]} items WireItems
 * @return {{m: SceneModel, xf: TransformController}}
 */
function make(items) {
	const m = new SceneModel()
	m.load(items)
	return { m, xf: new TransformController(m) }
}

describe('AK5: TransformController.step with snap', () => {
	test('(a) two shapes at br: the union frame snaps (x 397 → 400), both boxes scale with it, one guide', () => {
		const { xf } = make([shapeItem(A, { x: 100, y: 100, w: 200, h: 120 }), shapeItem(C, { x: 100, y: 300, w: 200, h: 100 })])
		assert.ok(xf.begin([A, C], 'br', { x: 300, y: 400 }))
		const r = xf.step({ x: 397, y: 545.5 }, { snap: { index: idx({ minX: 400, minY: 600, maxX: 600, maxY: 800 }), tol: 8 } })
		closeBox(r.boxes.get(A), { x: 100, y: 100, w: 300, h: 180 }, 'A')
		closeBox(r.boxes.get(C), { x: 100, y: 400, w: 300, h: 150 }, 'C')
		assert.equal(r.guides.length, 1)
		assert.deepEqual([r.guides[0].axis, r.guides[0].at], ['x', 400])
		close(r.guides[0].from, 100, 'from')
		close(r.guides[0].to, 800, 'to')
	})

	test('(b) with a frame among them (it keeps its size) nothing snaps: the result without snap', () => {
		const items = [shapeItem(A, { x: 100, y: 100, w: 200, h: 120 }), frameItem(G, { x: 100, y: 300, w: 200, h: 100 })]
		const snap = { index: idx({ minX: 400, minY: 600, maxX: 600, maxY: 800 }), tol: 8 }
		const one = make(items)
		one.xf.begin([A, G], 'br', { x: 300, y: 400 })
		const r = one.xf.step({ x: 397, y: 545.5 }, { snap })
		closeBox(r.boxes.get(A), { x: 100, y: 100, w: 297, h: 178.2 }, 'A')
		assert.deepEqual(r.guides, [])
		const two = make(items)
		two.xf.begin([A, G], 'br', { x: 300, y: 400 })
		const raw = two.xf.step({ x: 397, y: 545.5 })
		assert.deepEqual([...r.boxes], [...raw.boxes])
	})

	test('(c) a text item at br snaps only along x: a y line is left out; an x line sets w and the font size', () => {
		const text = textItem(A, { x: 0, y: 0, w: 240, h: 28.8 })
		let { xf } = make([text])
		xf.begin([A], 'br', { x: 240, y: 28.8 })
		let r = xf.step({ x: 360, y: 43.2 }, { snap: { index: idx({ minX: 1000, minY: 45, maxX: 1100, maxY: 145 }), tol: 8 } })
		close(r.boxes.get(A).w, 360, 'w')
		assert.equal(r.fonts.get(A), 36)
		assert.deepEqual(r.guides, [])
		;({ xf } = make([text]))
		xf.begin([A], 'br', { x: 240, y: 28.8 })
		r = xf.step({ x: 360, y: 43.2 }, { snap: { index: idx({ minX: 364, minY: 1000, maxX: 464, maxY: 1100 }), tol: 8 } })
		close(r.boxes.get(A).w, 364, 'w')
		assert.equal(r.fonts.get(A), 36)
		assert.equal(r.map.get(A).fontSize, 36)
		assert.equal(r.guides.length, 1)
		assert.deepEqual([r.guides[0].axis, r.guides[0].at, r.guides[0].to], ['x', 364, 1100])
		close(r.guides[0].from, 0, 'from')
	})

	test('(c) several items with a text item snap only along x too', () => {
		const { xf } = make([shapeItem(A, { x: 0, y: 0, w: 200, h: 100 }), textItem(B, { x: 0, y: 200, w: 200, h: 28.8 })])
		xf.begin([A, B], 'br', { x: 200, y: 228.8 })
		// raw edges (k = 1.1): x 220, y 251.68; only a y line within 8 (255)
		const r = xf.step({ x: 220, y: 251.68 }, { snap: { index: idx({ minX: 1000, minY: 255, maxX: 1100, maxY: 355 }), tol: 8 } })
		assert.deepEqual(r.guides, [])
		close(r.frame.w, 220, 'w')
	})

	test('(d) a rotated shape and the rotation handle do not snap: the same boxes as without snap', () => {
		const snap = { index: idx({ minX: 300, minY: 0, maxX: 400, maxY: 1000 }, { minX: 0, minY: 300, maxX: 1000, maxY: 400 }), tol: 8 }
		for (const [anchor, start, p] of [['br', { x: 300, y: 220 }, { x: 297, y: 217 }], ['rot', { x: 200, y: 72 }, { x: 297, y: 160 }]]) {
			const items = [shapeItem(A, { x: 100, y: 100, w: 200, h: 120, r: anchor === 'br' ? 30 : 0 })]
			const one = make(items)
			one.xf.begin([A], anchor, start)
			const r = one.xf.step(p, { snap })
			const two = make(items)
			two.xf.begin([A], anchor, start)
			const raw = two.xf.step(p)
			assert.deepEqual(r.guides, [], anchor)
			assert.deepEqual(box(r.boxes.get(A)), box(raw.boxes.get(A)), anchor)
		}
	})

	test('(e) without snap (missing or null) the result is that of a step without the option; guides []', () => {
		const items = [note(A, { x: 100, y: 100 }), shapeItem(B, { x: 400, y: 100 })]
		for (const [ids, anchor, start] of [[[A], 'br', { x: 300, y: 300 }], [[B], 'l', { x: 400, y: 160 }], [[A, B], 'tl', { x: 100, y: 100 }]]) {
			const one = make(items)
			const two = make(items)
			one.xf.begin(ids, anchor, start)
			two.xf.begin(ids, anchor, start)
			for (const p of [{ x: 297, y: 288 }, { x: 397, y: 403 }]) {
				const r = one.xf.step(p, { snap: null })
				const raw = two.xf.step(p)
				assert.deepEqual(r.guides, [])
				assert.deepEqual([...r.boxes], [...raw.boxes])
				assert.deepEqual(r.frame, raw.frame)
			}
		}
	})
})

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** @return {Array} the argument of every setSnapGuides call */
const guideCalls = () => callsOf('setSnapGuides').map((c) => c[0])
/** @return {Array} the calls with a non-empty list */
const shownGuides = () => guideCalls().filter((l) => Array.isArray(l) && l.length > 0)
/** The guide of AK6: B's left edge, from A's top to B's bottom. */
const GUIDE_X500 = Object.freeze([{ axis: 'x', at: 500, from: 100, to: 300 }])

/**
 * A shape A (100, 100, 200 × 120) selected, a note B at (500, 100) (AK6).
 *
 * @param {object} [b] fields of B
 * @param {object} [opts] setupScene options
 * @return {object} harness
 */
function setupPair(b = {}, opts = {}) {
	const s = setupScene([shapeItem(A, { x: 100, y: 100 }), note(B, { x: 500, y: 100, ...b })], opts)
	s.scene.setSelection([A])
	return s
}

/** Press on A's handle r (300, 160) and move to x (raw right edge at x), one frame. */
function pullTo(x, props = {}) {
	h.pointer('pointerdown', 300, 160)
	h.pointer('pointermove', x, 160, props)
	h.frame()
}

describe('AK6: snapping a resize', () => {
	test('A snaps to the left edge of B (raw 495 → 500), leaves it at 480 and snaps again; one transform intent; guides gone first at the release', () => {
		const atPreview = []
		const atIntent = []
		h = setupPair({}, {
			on: {
				onDragPreview: (rows) => { if (rows.length === 0) atPreview.push(guideCalls().at(-1)) },
				onIntent: () => atIntent.push(guideCalls().at(-1)),
			},
		})
		assert.equal(h.scene.stats().snapGuides, 0)
		pullTo(495)
		assert.equal(h.model.get(A).w, 400)
		assert.deepEqual(guideCalls().at(-1), GUIDE_X500)
		assert.equal(h.scene.stats().snapGuides, 1)
		assert.equal(h.scene.stats().gapMarkers, 0)
		h.pointer('pointermove', 480, 160)
		h.frame()
		assert.equal(h.model.get(A).w, 380)
		assert.deepEqual(guideCalls().at(-1), [])
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.stats().gapMarkers, 0)
		h.pointer('pointermove', 495, 160)
		h.frame()
		assert.equal(h.model.get(A).w, 400)
		assert.deepEqual(guideCalls().at(-1), GUIDE_X500)
		assert.equal(h.scene.stats().snapGuides, 1)
		h.pointer('pointerup', 495, 160)
		const it = h.intents('transform')
		assert.equal(it.length, 1)
		assert.deepEqual(it[0].after.get(A), { x: 100, y: 100, w: 400, h: 120, r: 0 })
		assert.equal(guideCalls().at(-1), null)
		assert.deepEqual(atPreview, [null])
		assert.deepEqual(atIntent, [null])
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.stats().gapMarkers, 0)
		assert.equal(callsOf('setGapMarkers').length, 0)
		assert.equal(h.scene.stats().transforming, false)
	})

	test('setSnapGuides only when the list changes (raw 496 still snaps to 500)', () => {
		h = setupPair()
		pullTo(495)
		const n = guideCalls().length
		h.pointer('pointermove', 496, 160)
		h.frame()
		assert.equal(guideCalls().length, n)
		assert.equal(h.model.get(A).w, 400)
		h.pointer('pointerup', 496, 160)
		// one call more: null at the release
		assert.equal(guideCalls().length, n + 1)
	})

	test('no guide stood at the release: no null call', () => {
		h = setupPair()
		pullTo(480)
		h.pointer('pointerup', 480, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [380])
		assert.deepEqual(guideCalls(), [])
	})
})

describe('AK7: Ctrl/⌘ resizes free', () => {
	for (const mod of ['ctrlKey', 'metaKey']) {
		test(`${mod} on the moves: w 395, after.w 395, no guide`, () => {
			h = setupPair()
			pullTo(495, { [mod]: true })
			assert.equal(h.model.get(A).w, 395)
			assert.equal(h.scene.stats().snapGuides, 0)
			h.pointer('pointerup', 495, 160, { [mod]: true })
			assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [395])
			assert.deepEqual(shownGuides(), [])
		})
	}

	for (const key of ['Control', 'Meta']) {
		test(`${key} pressed and released during a snapped resize acts without a pointer move`, () => {
			h = setupPair()
			pullTo(495)
			assert.equal(h.model.get(A).w, 400)
			const down = { key, code: '', repeat: false, isComposing: false, ctrlKey: key === 'Control', metaKey: key === 'Meta' }
			dispatch(h.container, 'keydown', down)
			h.frame()
			assert.equal(h.model.get(A).w, 395)
			const last = guideCalls().at(-1)
			assert.ok(last === null || (Array.isArray(last) && last.length === 0), JSON.stringify(last))
			assert.equal(h.scene.stats().snapGuides, 0)
			// the key's auto-repeat: the same step, no new setSnapGuides call
			const n = guideCalls().length
			dispatch(h.container, 'keydown', { ...down, repeat: true })
			h.frame()
			assert.equal(guideCalls().length, n)
			dispatch(h.container, 'keyup', { key, code: '' })
			h.frame()
			assert.equal(h.model.get(A).w, 400)
			assert.deepEqual(guideCalls().at(-1), GUIDE_X500)
			assert.equal(h.scene.stats().snapGuides, 1)
			h.pointer('pointerup', 495, 160)
			assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [400])
			// the key reached no shortcut: no other intent
			assert.deepEqual(h.intents().map((i) => i.type), ['transform'])
		})
	}

	test('a move without the modifier after a Ctrl keydown snaps again (a missed keyup corrects itself)', () => {
		h = setupPair()
		pullTo(495)
		dispatch(h.container, 'keydown', { key: 'Control', code: '', repeat: false, isComposing: false, ctrlKey: true })
		h.frame()
		assert.equal(h.model.get(A).w, 395)
		h.pointer('pointermove', 496, 160)
		h.frame()
		assert.equal(h.model.get(A).w, 400)
		h.pointer('pointerup', 496, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [400])
	})
})

describe('AK8: targets and modes', () => {
	test('(a) a note corner keeps its ratio (x 396.5 → 400), Shift frees it (y stays 396)', () => {
		for (const shift of [false, true]) {
			h = setupScene([note(A, { x: 100, y: 100 }), note(B, { x: 400, y: 500 })])
			h.scene.setSelection([A])
			h.pointer('pointerdown', 300, 300)
			h.pointer('pointermove', 397, 396, { shiftKey: shift })
			h.frame()
			const want = shift ? { x: 100, y: 100, w: 300, h: 296 } : { x: 100, y: 100, w: 300, h: 300 }
			closeBox(h.model.abs(A), want, `shift ${shift}`)
			const g = guideCalls().at(-1)
			assert.equal(g.length, 1)
			assert.deepEqual([g[0].axis, g[0].at], ['x', 400])
			close(g[0].from, 100, 'from')
			close(g[0].to, 700, 'to')
			h.pointer('pointerup', 397, 396, { shiftKey: shift })
			closeBox(h.intents('transform')[0].after.get(A), want, `intent, shift ${shift}`)
			h.restore()
			h = null
		}
	})

	test('(b) a resized frame snaps to its own child (it stays where it is)', () => {
		h = setupScene([frameItem(F, { x: 0, y: 0, w: 800, h: 600 }), note(K, { x: 50, y: 50, parent: F })])
		h.scene.setSelection([F])
		h.pointer('pointerdown', 800, 300)
		h.pointer('pointermove', 254, 300)
		h.frame()
		assert.equal(h.model.get(F).w, 250)
		assert.deepEqual(guideCalls().at(-1), [{ axis: 'x', at: 250, from: 0, to: 600 }])
		h.pointer('pointerup', 254, 300)
		const it = h.intents('transform')
		assert.equal(it.length, 1)
		assert.equal(it[0].after.get(F).w, 250)
	})

	test('(c) the own start is no target (+5 → w 205)', () => {
		h = setupPair()
		pullTo(305)
		assert.equal(h.model.get(A).w, 205)
		h.pointer('pointerup', 305, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [205])
		assert.deepEqual(shownGuides(), [])
	})

	test('(c) a connector with free ends on x = 500 is no target (w 395)', () => {
		const conn = {
			id: C1, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'bC1', parent: null,
			data: { start: { x: 500, y: 100 }, end: { x: 500, y: 300 }, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' },
		}
		h = setupScene([shapeItem(A, { x: 100, y: 100 }), conn])
		h.scene.setSelection([A])
		pullTo(495)
		assert.equal(h.model.get(A).w, 395)
		h.pointer('pointerup', 495, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [395])
		assert.deepEqual(shownGuides(), [])
	})

	test('(c) an item outside the view at the start is no target (B at x = 1100, pulled to 1095: w 995)', () => {
		h = setupPair({ x: 1100 })
		pullTo(1095)
		assert.equal(h.model.get(A).w, 995)
		h.pointer('pointerup', 1095, 160)
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [995])
		assert.deepEqual(shownGuides(), [])
	})
})

describe('AK9: the threshold is in screen px', () => {
	// A (100, 100, 200 × 120), B at (350, 100); the raw right edge at 344 is 6 world units from 350.
	// The camera at (60, 60) keeps A and B fully in view at every scale.
	for (const [scale, snaps] of [[1, true], [0.5, true], [2, false]]) {
		test(`a gap of 6 world units at scale ${scale} (${6 * scale} px) ${snaps ? 'snaps' : 'does not snap'}`, () => {
			h = setupPair({ x: 350 })
			h.scene.setCamera({ x: 60, y: 60, scale })
			h.frame()
			const sx = (x) => (x - 60) * scale
			const sy = (y) => (y - 60) * scale
			h.pointer('pointerdown', sx(300), sy(160))
			h.pointer('pointermove', sx(344), sy(160))
			h.frame()
			assert.equal(h.model.get(A).w, snaps ? 250 : 244)
			assert.equal(h.scene.stats().snapGuides, snaps ? 1 : 0)
			h.pointer('pointerup', sx(344), sy(160))
			assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [snaps ? 250 : 244])
		})
	}
})

describe('AK10: the end of a snapped resize', () => {
	test('Esc: A back at its start, no intent, setSnapGuides(null), snapGuides 0', () => {
		h = setupPair()
		pullTo(495)
		assert.equal(h.scene.stats().snapGuides, 1)
		h.key('Escape')
		assert.deepEqual(box(h.model.abs(A)), { x: 100, y: 100, w: 200, h: 120, r: 0 })
		assert.deepEqual(h.intents('transform'), [])
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		h.pointer('pointerup', 495, 160)
		assert.deepEqual(h.intents('transform'), [])
	})

	test("setMode('vote', {settle: true}): one transform intent with the snapped size, guides gone", () => {
		h = setupPair()
		pullTo(495)
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(h.intents('transform').map((i) => i.after.get(A).w), [400])
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.getMode(), 'vote')
		h.pointer('pointerup', 495, 160)
		assert.equal(h.intents('transform').length, 1)
	})

	test('A removed during the resize: no intent, guides gone (null), snapGuides 0', () => {
		h = setupPair()
		pullTo(495)
		h.scene.update(h.model.apply({ removes: [A] }))
		assert.deepEqual(h.intents(), [])
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.stats().transforming, false)
		h.pointer('pointerup', 495, 160)
		assert.deepEqual(h.intents(), [])
	})

	test('a model reload (reset) drops the resize and its guides', () => {
		h = setupPair()
		pullTo(495)
		h.scene.reset()
		assert.equal(guideCalls().at(-1), null)
		assert.equal(h.scene.stats().snapGuides, 0)
		assert.equal(h.scene.stats().transforming, false)
		assert.deepEqual(h.intents(), [])
	})

	test('stats().snapGuides is 0 after destroy', () => {
		h = setupPair()
		pullTo(495)
		h.scene.destroy()
		assert.equal(h.scene.stats().snapGuides, 0)
	})

	test('the rotation handle shows no guide and leaves the 45° snap as it was', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100, w: 100, h: 100 }), note(B, { x: 400, y: 100 })])
		h.scene.setSelection([A])
		rcalls.length = 0
		h.pointer('pointerdown', 150, 72)
		h.pointer('pointermove', 260, 152)
		h.frame()
		h.pointer('pointerup', 260, 152)
		assert.equal(h.intents('transform')[0].after.get(A).r, 90)
		assert.deepEqual(guideCalls(), [])
	})
})
