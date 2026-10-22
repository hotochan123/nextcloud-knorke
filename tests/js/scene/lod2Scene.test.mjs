/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * LOD 2 in the scene's input and handles (SPEC-M1 §6.3 LOD 2, R13 (c), (d);
 * WP-S2, finding SCN-01), deterministic in Node with the real SceneManager,
 * InputController and SceneModel on the fake DOM; the stubbed renderer
 * reports the level (setStubLod), as the Konva renderer does from its camera:
 * - a click (hitTest with accept) and the marquee pass over connectors at
 *   LOD 2, Ctrl+A and Tab still select them; at LOD 0 the same presses select
 *   the connector (control)
 * - a selected connector shows only its halo (renderer selection) at LOD 2,
 *   no end handles; one note gets its transformer handles but no "+" handles;
 *   the handles come back when the camera leaves LOD 2
 * - frames hit as at LOD 0/1: title band and border, not the inside (d)
 * - (R14-13) at LOD 2 a frame also hits in its painted title rectangle: as
 *   wide as the shortened title, COARSE_TITLE_PX + COARSE_TITLE_GAP_PX screen
 *   px above the top edge, widened by the hit tolerance; no rectangle without
 *   a painted title; content painted over the title wins, the title wins over
 *   another frame hit by its border band; at LOD 0 the same clicks miss
 * - (R15-02) the same rectangle serves the double click (it opens the
 *   frame-title editor) and, in edit mode, the touch claim (a finger on it
 *   selects and drags the frame instead of panning); beside the title and at
 *   LOD 0 neither happens
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { COARSE_TITLE_BOX_PX } from '../../../src/scene/nodes/coarse.js'
import { FRAME_EDGE_HIT_PX, FRAME_TITLE_BAND } from '../../../src/model/tokens.js'
import { HIT_TOL_MOUSE_PX, HIT_TOL_TOUCH_PX } from '../../../src/scene/InputController.js'
import { GLYPH, callsOf, frameItem, note, paintStubCoarse, rcalls, setStubLod, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const F = '01JA0000000000000000000009'
const F2 = '01JA0000000000000000000008'
const C1 = '01JA00000000000000000000C1'

const conn = (id, start, end) => ({
	id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + id.slice(-2), parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' },
})
/** A at (100, 100), B at (600, 100), 200 × 200; the connector runs from (300, 200) to (600, 200). */
const items = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 }), conn(C1, { item: A }, { item: B })]

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** @param {number} x container x @param {number} y container y */
function click(x, y) {
	h.pointer('pointerdown', x, y)
	h.pointer('pointerup', x, y)
}

describe('click and marquee pass over connectors at LOD 2', () => {
	for (const lod of [0, 2]) {
		test(`LOD ${lod}: a click on the connector line ${lod === 2 ? 'selects nothing' : 'selects it'}; a click on a note selects it`, () => {
			h = setupScene(items())
			setStubLod(lod)
			click(450, 200)
			assert.deepEqual(h.scene.getSelection(), lod === 2 ? [] : [C1])
			click(150, 150)
			assert.deepEqual(h.scene.getSelection(), [A])
		})

		test(`LOD ${lod}: a marquee around everything ${lod === 2 ? 'leaves the connector out' : 'takes the connector too'}`, () => {
			h = setupScene(items())
			setStubLod(lod)
			h.pointer('pointerdown', 50, 50)
			h.pointer('pointermove', 400, 300)
			h.pointer('pointermove', 900, 400)
			h.pointer('pointerup', 900, 400)
			assert.deepEqual(h.scene.getSelection().sort(), (lod === 2 ? [A, B] : [A, B, C1]).sort())
		})
	}

	for (const lod of [0, 2]) {
		test(`LOD ${lod}: a double click on the connector ${lod === 2 ? 'opens no' : 'opens the'} label editor`, () => {
			h = setupScene(items())
			setStubLod(lod)
			h.pointer('dblclick', 450, 200)
			assert.deepEqual(h.log.filter((e) => e[0] === 'onEditing').map((e) => e[1]), lod === 2 ? [] : [C1])
		})
	}

	test('LOD 2: Ctrl+A and Tab still select connectors', () => {
		h = setupScene(items())
		setStubLod(2)
		h.focusCanvas()
		h.key('a', { ctrlKey: true })
		assert.deepEqual(h.scene.getSelection().sort(), [A, B, C1].sort())
		h.scene.setSelection([])
		const seen = []
		for (let i = 0; i < 3; i++) {
			h.key('Tab')
			seen.push(h.scene.getSelection()[0])
		}
		assert.ok(seen.includes(C1), seen.join())
	})

	test('(d) frames hit only the title band and the border at LOD 2 (as at LOD 0/1)', () => {
		h = setupScene([frameItem(F, { x: 100, y: 100, w: 600, h: 400 })])
		setStubLod(2)
		click(400, 300)
		assert.deepEqual(h.scene.getSelection(), [], 'inside the frame: empty canvas')
		click(400, 80)
		assert.deepEqual(h.scene.getSelection(), [F], 'title band')
		click(400, 700)
		click(100, 300)
		assert.deepEqual(h.scene.getSelection(), [F], 'border')
	})
})

describe('(d, R14-13) at LOD 2 a frame also hits in its painted title', () => {
	const S = 0.05
	/**
	 * A click on a container point, then one on empty canvas (900, 750).
	 *
	 * @param {number} x container x
	 * @param {number} y container y
	 * @return {string[]} the selection after the first click
	 */
	function pick(x, y) {
		click(x, y)
		const sel = h.scene.getSelection()
		click(900, 750)
		assert.deepEqual(h.scene.getSelection(), [], '(900, 750) is empty canvas')
		return sel
	}

	/**
	 * @param {object[]} list WireItems
	 * @return {Array<object>} the title rectangles of the LOD-2 painting at 5 %
	 */
	function scene5(list) {
		h = setupScene(list)
		h.scene.setCamera({ x: 0, y: 0, scale: S })
		h.frame()
		setStubLod(2)
		return paintStubCoarse(h.model, S)
	}

	test('the title rectangle hits (13 px above the top edge, outside title band and border band); beside it, above it and at LOD 0 nothing', () => {
		// container px = world × 0.05: the frame spans (100, 100)–(500, 300); "Planning" is 8 glyphs of 6 px
		const rects = scene5([frameItem(F, { x: 2000, y: 2000, w: 8000, h: 4000, data: { title: 'Planning' } })])
		assert.equal(COARSE_TITLE_BOX_PX, 15)
		assert.deepEqual(rects, [{ id: F, x: 2000, y: 2000 - 15 / S, w: 8 * GLYPH * 12 / S, h: 15 / S }])
		// the bands of rule (d) above the frame reach 2.1 + 4 px (title band) and 8 + 4 px (border band)
		assert.ok(FRAME_TITLE_BAND * S + HIT_TOL_MOUSE_PX < 13 && FRAME_EDGE_HIT_PX + HIT_TOL_MOUSE_PX < 13)
		assert.deepEqual(pick(120, 87), [F], 'on the title')
		assert.deepEqual(pick(147, 87), [F], 'at the end of the title')
		assert.deepEqual(pick(151, 87), [F], 'within the tolerance right of it')
		assert.deepEqual(pick(155, 87), [], 'beside the title')
		assert.deepEqual(pick(300, 87), [], 'above the frame, far from the title')
		assert.deepEqual(pick(120, 82), [F], 'within the tolerance above it')
		assert.deepEqual(pick(120, 80), [], 'above the title')
		assert.deepEqual(pick(400, 200), [], 'inside: empty canvas (d)')
		assert.deepEqual(pick(120, 92), [F], 'border band')
		setStubLod(0)
		assert.deepEqual(pick(120, 87), [], 'LOD 0: no title rectangle')
		assert.deepEqual(pick(120, 92), [F], 'LOD 0: border band')
	})

	test('the rectangle is as wide as the shortened title; a frame narrower than 40 px has no title and no rectangle', () => {
		// F: 50 px wide → "Eine se…" (8 glyphs, 48 px); F2: 30 px wide, no title painted
		const rects = scene5([
			frameItem(F, { x: 2000, y: 2000, w: 1000, h: 2000, data: { title: 'Eine sehr lange Überschrift' } }),
			frameItem(F2, { x: 8000, y: 2000, w: 600, h: 2000, data: { title: 'Klein' } }),
		])
		assert.deepEqual(rects.map((r) => [r.id, r.w * S]), [[F, 48]])
		assert.deepEqual(pick(130, 87), [F], 'on the shortened title')
		assert.deepEqual(pick(200, 87), [], 'where the whole title would run on')
		assert.deepEqual(pick(410, 87), [], 'above the narrow frame')
	})

	test('content painted over the title wins; the title wins over a frame hit only by its border band', () => {
		// A covers (110, 82)–(120, 92) of the title of F; F2 lies 10 px below F (later in compareOrder
		// is F), so F's border band (to y 312) covers the whole title of F2 (295–310)
		const rects = scene5([
			frameItem(F, { x: 2000, y: 2000, w: 8000, h: 4000, z: 'a5', data: { title: 'Planning' } }),
			frameItem(F2, { x: 2000, y: 6200, w: 8000, h: 2000, z: 'a0', data: { title: 'Second' } }),
			note(A, { x: 2200, y: 1640 }),
		])
		assert.deepEqual(rects.map((r) => r.id).sort(), [F, F2].sort())
		assert.ok(h.model.compareOrder(F, F2) > 0, 'F is painted after F2')
		assert.deepEqual(pick(115, 87), [A], 'the note on the title')
		assert.deepEqual(pick(140, 87), [F], 'the title beside the note')
		assert.deepEqual(pick(120, 296), [F2], 'title of F2 inside the border band of F only')
		assert.deepEqual(pick(120, 304), [F2], 'title of F2 inside both border bands')
		setStubLod(0)
		assert.deepEqual(pick(120, 296), [F], 'LOD 0: the border band of F')
		assert.deepEqual(pick(120, 304), [F], 'LOD 0: the topmost border band')
	})

	test('(R15-02) a double click on the title rectangle opens the frame-title editor; beside it and at LOD 0 nothing opens', () => {
		// the frame spans (100, 100)–(500, 300), "Planning" (100, 85)–(148, 100); the
		// point 13 px above the top edge lies outside the title band and the border band
		scene5([frameItem(F, { x: 2000, y: 2000, w: 8000, h: 4000, data: { title: 'Planning' } })])
		/** @return {Array<string|null>} the ids of onEditing so far */
		const editing = () => h.log.filter((e) => e[0] === 'onEditing').map((e) => e[1])
		/** Mouse double click as Chromium sends it: two press pairs, then dblclick. */
		const dbl = (x, y) => {
			for (let i = 0; i < 2; i++) click(x, y)
			h.pointer('dblclick', x, y)
		}
		dbl(155, 87)
		assert.deepEqual(editing(), [], 'beside the title (same height): no editor')
		setStubLod(0)
		dbl(120, 87)
		assert.deepEqual(editing(), [], 'LOD 0: no title rectangle, no editor')
		setStubLod(2)
		dbl(120, 87)
		assert.deepEqual(editing(), [F], 'on the title: the editor of the frame')
		assert.equal(h.scene.stats().editing, F)
		const ta = h.dom.doc.activeElement
		assert.equal(ta?.tagName, 'TEXTAREA')
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'title', 'the frame-title editor')
	})

	test('(R15-02) in edit mode a finger on the title rectangle is claimed for select and drag; beside it and at LOD 0 the finger pans', () => {
		scene5([frameItem(F, { x: 2000, y: 2000, w: 8000, h: 4000, data: { title: 'Planning' } })])
		// touch tolerance: the border band reaches 8 + 12 px above the top edge, the
		// title band 2.1 + 12 px, the title rectangle 15 + 12 px; for a finger the
		// bare 15-px rectangle lies inside the border band, so the title decides only
		// more than 20 and at most 27 px above the edge: 24 px (y 76) lies only in the
		// widened rectangle
		assert.ok(FRAME_EDGE_HIT_PX + HIT_TOL_TOUCH_PX < 24 && FRAME_TITLE_BAND * S + HIT_TOL_TOUCH_PX < 24)
		assert.ok(COARSE_TITLE_BOX_PX + HIT_TOL_TOUCH_PX >= 24)
		const cam = h.scene.getCamera()
		/**
		 * One finger pressed at a container point, moved 40 px right and down,
		 * lifted; afterwards the camera is set back to `cam`.
		 *
		 * @param {number} x container x
		 * @param {number} y container y
		 * @return {object} what the press did: selection at the press, gesture and
		 *   drag state after the move, the camera moved, the move intents' ids
		 */
		const swipe = (x, y) => {
			const finger = { pointerType: 'touch', pointerId: 7 }
			const moves = h.intents('move').length
			h.pointer('pointerdown', x, y, finger)
			const sel = h.scene.getSelection()
			h.pointer('pointermove', x + 40, y + 40, finger)
			h.frame()
			const { gestureActive, dragging } = h.scene.stats()
			h.pointer('pointerup', x + 40, y + 40, finger)
			h.frame()
			const c = h.scene.getCamera()
			const panned = c.x !== cam.x || c.y !== cam.y
			h.scene.setCamera(cam)
			h.frame()
			h.scene.setSelection([])
			return { sel, gestureActive, dragging, panned, moved: h.intents('move').slice(moves).map((i) => i.ids) }
		}
		const pans = { sel: [], gestureActive: true, dragging: false, panned: true, moved: [] }
		assert.deepEqual(swipe(200, 76), pans, 'beside the title (same height): not claimed, the finger pans')
		setStubLod(0)
		assert.deepEqual(swipe(120, 76), pans, 'LOD 0: no title rectangle, the finger pans')
		setStubLod(2)
		assert.deepEqual(swipe(120, 76), { sel: [F], gestureActive: false, dragging: true, panned: false, moved: [[F]] },
			'on the title: claimed, the frame is selected and dragged, no pan')
	})
})

describe('handles at LOD 2', () => {
	test('a selected connector: halo (renderer selection) but no end handles; back at LOD 0 the ends return', () => {
		h = setupScene(items())
		setStubLod(2)
		h.scene.setSelection([C1])
		assert.deepEqual(h.scene.handles(), [])
		assert.deepEqual(callsOf('setSelection').at(-1)[0], [C1], 'the halo is the selection outline')
		// the camera leaves LOD 2: the end handles come back without another selection change
		setStubLod(0)
		h.scene.setCamera({ x: 0, y: 0, scale: 1.25 })
		h.frame()
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['start', 'end'])
		setStubLod(2)
		h.scene.setCamera({ x: 0, y: 0, scale: 0.08 })
		h.frame()
		assert.deepEqual(h.scene.handles(), [])
	})

	test('one note: transformer handles stay, the four "+" handles go', () => {
		h = setupScene(items())
		h.scene.setSelection([A])
		const at0 = h.scene.handles().map((x) => x.name)
		assert.ok(at0.includes('plus-r') && at0.includes('br'), at0.join())
		setStubLod(2)
		h.scene.setCamera({ x: 0, y: 0, scale: 0.08 })
		h.frame()
		const at2 = h.scene.handles().map((x) => x.name)
		assert.ok(at2.includes('br') && at2.includes('rot'), at2.join())
		assert.deepEqual(at2.filter((n) => n.startsWith('plus-')), [])
		assert.ok(rcalls.length > 0)
	})
})
