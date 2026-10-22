/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Transformer (SPEC-M1 §6.3, §1.4 "Transformer", §8.2 (1a)), deterministic in
 * Node:
 * - TransformController on a real SceneModel: per-type rules (note ratio,
 *   shape free / Shift, Alt centred, text l/r width vs. corners font × k,
 *   frame keep with children compensated), multi selection uniform with
 *   frames and placeholders fixed, size and font clamps, rotation snaps,
 *   restore map, result null without a change, preview above
 *   TRANSFORM_LIVE_MAX
 * - SceneManager flow on the fake DOM: handles in screen space before the
 *   item hit test, 8 + rot for one note, none for view-only / hand tool /
 *   open editor; release order onDragPreview([]) → onIntent (isActive true)
 *   → onActivity(false); Esc puts the model back without an intent; above
 *   50 items one activeGroup preview per frame and the model only at the end
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { TransformController } from '../../../src/scene/TransformController.js'
import { TRANSFORM_LIVE_MAX } from '../../../src/model/tokens.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, rcalls, setupScene, shapeItem, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const F = '01JA0000000000000000000009'
const P = '01JA000000000000000000000P'

const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`)
const box = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, r: b.r })

/**
 * @param {object[]} items WireItems
 * @return {{m: SceneModel, xf: TransformController}}
 */
function make(items) {
	const m = new SceneModel()
	m.load(items)
	return { m, xf: new TransformController(m) }
}

describe('TransformController: one item', () => {
	test('note corner keeps the ratio, Shift releases it; edges (notes have 8 handles) stretch one axis', () => {
		const { xf } = make([note(A, { x: 100, y: 100, w: 200, h: 200 })])
		assert.ok(xf.begin([A], 'br', { x: 300, y: 300 }))
		let r = xf.step({ x: 400, y: 320 })
		close(r.boxes.get(A).w, r.boxes.get(A).h, 'ratio kept')
		r = xf.step({ x: 400, y: 320 }, { shift: true })
		assert.deepEqual(box(r.boxes.get(A)), { x: 100, y: 100, w: 300, h: 220, r: 0 })
		xf.end()
		xf.begin([A], 'r', { x: 300, y: 200 })
		assert.deepEqual(box(xf.step({ x: 350, y: 999 }).boxes.get(A)), { x: 100, y: 100, w: 250, h: 200, r: 0 })
	})

	test('shape corner free, Shift keeps the ratio, Alt from the centre', () => {
		const { xf } = make([shapeItem(A, { x: 0, y: 0, w: 200, h: 100 })])
		xf.begin([A], 'br', { x: 200, y: 100 })
		assert.deepEqual(box(xf.step({ x: 260, y: 100 }).boxes.get(A)), { x: 0, y: 0, w: 260, h: 100, r: 0 })
		const s = xf.step({ x: 260, y: 100 }, { shift: true }).boxes.get(A)
		close(s.w / s.h, 2, 'Shift: ratio')
		assert.deepEqual(box(xf.step({ x: 230, y: 100 }, { alt: true }).boxes.get(A)), { x: -30, y: 0, w: 260, h: 100, r: 0 })
	})

	test('sizes stay in TYPES[t].size (note min 20, shape max 20000)', () => {
		const { xf } = make([note(A, { w: 100, h: 100 }), shapeItem(B, { x: 500, w: 100, h: 100 })])
		xf.begin([A], 'br', { x: 100, y: 100 })
		const n = xf.step({ x: -5000, y: -5000 }).boxes.get(A)
		assert.deepEqual([n.w, n.h], [20, 20])
		xf.end()
		xf.begin([B], 'r', { x: 600, y: 50 })
		assert.equal(xf.step({ x: 600 + 50000, y: 50 }).boxes.get(B).w, 20000)
	})

	test('text: l/r change the wrap width only; corners scale width and font size by k (integer 8..400)', () => {
		const { xf } = make([textItem(A, { x: 0, y: 0, w: 200, h: 28.8, style: { fontSize: 20, color: '#1a1a1a', align: 'left' } })])
		xf.begin([A], 'r', { x: 200, y: 14 })
		let r = xf.step({ x: 100, y: 500 })
		assert.deepEqual(box(r.boxes.get(A)), { x: 0, y: 0, w: 100, h: 28.8, r: 0 })
		assert.equal(r.fonts.get(A), 20)
		xf.end()
		xf.begin([A], 'br', { x: 200, y: 28.8 })
		r = xf.step({ x: 300, y: 28.8 * 1.5 }) // on the ratio diagonal: corners project onto it
		close(r.boxes.get(A).w, 300, 'k = 1.5')
		close(r.boxes.get(A).h, 43.2, 'k = 1.5', 1e-9)
		assert.equal(r.fonts.get(A), 30)
		assert.equal(r.map.get(A).fontSize, 30)
		r = xf.step({ x: -1000, y: -1000 })
		assert.equal(r.fonts.get(A), 8, 'font clamped at 8')
		close(r.boxes.get(A).w, 200 * 8 / 20, 'and the box with it')
		const res = xf.result()
		assert.equal(res.before.get(A).fontSize, 20)
		assert.equal(res.after.get(A).fontSize, 8)
	})

	test('rotation: 45° snaps within 5°, Shift 15° steps; rotation keeps x/y/w/h', () => {
		const { xf } = make([shapeItem(A, { x: 0, y: 0, w: 100, h: 100 })])
		xf.begin([A], 'rot', { x: 50, y: -28 })
		const at = (deg, d = 200) => {
			const t = (deg - 90) * Math.PI / 180
			return { x: 50 + d * Math.cos(t), y: 50 + d * Math.sin(t) }
		}
		assert.equal(xf.step(at(48)).boxes.get(A).r, 45)
		close(xf.step(at(30)).boxes.get(A).r, 30, 'free between snaps')
		assert.equal(xf.step(at(37), { shift: true }).boxes.get(A).r, 30)
		const b = xf.step(at(91)).boxes.get(A)
		assert.deepEqual([b.x, b.y, b.w, b.h, b.r], [0, 0, 100, 100, 90])
	})

	test('frame at the top/left: keep = true, children keep their board position (relative x/y compensated)', () => {
		const { m, xf } = make([frameItem(F, { x: 100, y: 100, w: 800, h: 600 }), note(A, { x: 50, y: 60, parent: F })])
		xf.begin([F], 'tl', { x: 100, y: 100 })
		const r = xf.step({ x: 80, y: 130 })
		assert.deepEqual(box(r.boxes.get(F)), { x: 80, y: 130, w: 820, h: 570, r: 0 })
		assert.equal(r.keep, true)
		assert.deepEqual(r.map.get(A), { x: 70, y: 30 })
		m.setBoxesLocal(r.map)
		assert.deepEqual(m.abs(A), { x: 150, y: 160, w: 200, h: 200, r: 0 }, 'absolute position unchanged')
		assert.equal(xf.result().keep, true)
		xf.end()
		xf.begin([F], 'br', { x: 900, y: 700 })
		const r2 = xf.step({ x: 950, y: 720 })
		assert.equal(r2.keep, false)
	})
})

describe('TransformController: several items', () => {
	test('uniform scale about the opposite corner; frames and placeholders keep their size and only move; text fonts × k', () => {
		const { xf } = make([
			note(A, { x: 0, y: 0, w: 100, h: 100 }),
			frameItem(F, { x: 200, y: 0, w: 100, h: 100 }),
			{ id: P, t: 'pen', x: 0, y: 200, w: 50, h: 50, r: 0, z: 'b', parent: null, data: {}, style: {} },
			textItem(C, { x: 200, y: 250, w: 100, h: 50, style: { fontSize: 20 } }),
		])
		xf.begin([A, F, P, C], 'br', { x: 300, y: 300 })
		const r = xf.step({ x: 600, y: 600 })
		assert.equal(r.preview, null, 'live')
		assert.deepEqual(box(r.boxes.get(A)), { x: 0, y: 0, w: 200, h: 200, r: 0 })
		assert.deepEqual(box(r.boxes.get(F)), { x: 450, y: 50, w: 100, h: 100, r: 0 }, 'frame centre (250, 50) → (500, 100)')
		assert.deepEqual(box(r.boxes.get(P)), { x: 25, y: 425, w: 50, h: 50, r: 0 })
		assert.equal(r.fonts.get(C), 40)
		const n = xf.step({ x: 600, y: 330 }).boxes.get(A)
		assert.equal(n.w, n.h, 'only uniform (no shear)')
	})

	test('the factor stops where the first item reaches its size limit', () => {
		const { xf } = make([note(A, { x: 0, y: 0, w: 100, h: 100 }), note(B, { x: 100, y: 100, w: 40, h: 40 })])
		xf.begin([A, B], 'br', { x: 140, y: 140 })
		const r = xf.step({ x: 0, y: 0 })
		assert.equal(r.boxes.get(B).w, 20, 'B reaches the note minimum at k = 0.5')
		assert.equal(r.boxes.get(A).w, 50)
	})

	test('several items: no rotation, edge handles do nothing', () => {
		const { xf } = make([shapeItem(A), shapeItem(B, { x: 300 })])
		xf.begin([A, B], 'rot', { x: 0, y: -50 })
		assert.equal(xf.step({ x: 400, y: 60 }).boxes.get(A).r, 0)
		xf.end()
		xf.begin([A, B], 'r', { x: 500, y: 60 })
		assert.deepEqual(box(xf.step({ x: 700, y: 60 }).boxes.get(B)), { x: 300, y: 0, w: 200, h: 120, r: 0 })
		assert.equal(xf.result(), null, 'nothing changed → no intent')
	})

	test('a child of a selected frame is not transformed itself (top level only), but it is active', () => {
		const { xf } = make([frameItem(F), note(A, { parent: F, x: 10, y: 10 })])
		xf.begin([F, A], 'br', { x: 800, y: 600 })
		assert.deepEqual(xf.ids, [F])
		assert.ok(xf.all.has(A))
	})

	test(`above TRANSFORM_LIVE_MAX (${TRANSFORM_LIVE_MAX}) items: preview transform, the map still describes the result`, () => {
		const items = []
		for (let i = 0; i < TRANSFORM_LIVE_MAX + 1; i++) items.push(note('01JA00000000000000000N' + String(i).padStart(4, '0'), { x: i * 10, y: 0, w: 100, h: 100 }))
		const { xf } = make(items)
		xf.begin(items.map((i) => i.id), 'br', { x: 600, y: 100 })
		assert.equal(xf.live, false)
		const r = xf.step({ x: 1200, y: 200 })
		assert.deepEqual(r.preview, { x: 0, y: 0, k: 2, offsetX: 0, offsetY: 0 })
		assert.equal(r.map.size, TRANSFORM_LIVE_MAX + 1)
	})
})

describe('TransformController: restore and result', () => {
	test('restoreMap puts boxes, children and the stored font size back (null removes a font size that was not stored)', () => {
		const { m, xf } = make([textItem(A, { style: { color: '#1a1a1a' } })])
		xf.begin([A], 'br', { x: 240, y: 28.8 })
		const r = xf.step({ x: 480, y: 28.8 })
		assert.equal(r.map.get(A).fontSize, 48)
		m.setBoxesLocal(r.map)
		assert.equal(m.get(A).style.fontSize, 48)
		m.setBoxesLocal(xf.restoreMap())
		assert.equal('fontSize' in m.get(A).style, false)
		assert.deepEqual(box(m.abs(A)), { x: 0, y: 0, w: 240, h: 28.8, r: 0 })
	})

	test('result: absolute boxes, before with parent, after without; null without a step', () => {
		const { xf } = make([frameItem(F, { x: 100, y: 100 }), shapeItem(A, { x: 10, y: 20, parent: F })])
		xf.begin([A], 'br', { x: 310, y: 240 })
		assert.equal(xf.result(), null)
		xf.step({ x: 330, y: 250 })
		const r = xf.result()
		assert.deepEqual(r.ids, [A])
		assert.deepEqual(r.before.get(A), { x: 110, y: 120, w: 200, h: 120, r: 0, parent: F })
		assert.deepEqual(r.after.get(A), { x: 110, y: 120, w: 220, h: 130, r: 0 })
		assert.equal(r.keep, false)
	})
})

describe('SceneManager: handles and the transform flow', () => {
	let h
	afterEach(() => {
		h?.restore()
		h = null
	})

	test('one note: 8 handles + rot (+ the four "+" handles of 1b) in container coordinates; none for view-only, hand tool, open editor, nothing selected', () => {
		h = setupScene([note(A, { x: 100, y: 100 })])
		assert.deepEqual(h.scene.handles(), [])
		h.scene.setSelection([A])
		const hs = h.scene.handles()
		assert.deepEqual(hs.map((x) => x.name), ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'rot', 'plus-t', 'plus-r', 'plus-b', 'plus-l'])
		// "+" handles: CONNECTOR_PLUS_OFFSET_PX (44) outside the side midpoints, beyond the rot handle (28)
		assert.deepEqual(hs.filter((x) => x.name.startsWith('plus-')).map((x) => [x.x, x.y]), [[200, 56], [344, 200], [200, 344], [56, 200]])
		assert.deepEqual(hs.find((x) => x.name === 'br'), { name: 'br', x: 300, y: 300 })
		assert.deepEqual(hs.find((x) => x.name === 'rot'), { name: 'rot', x: 200, y: 100 - 28 })
		h.scene.setTool('hand')
		assert.deepEqual(h.scene.handles(), [])
		h.scene.setTool('select')
		h.scene.setViewOnly(true)
		assert.deepEqual(h.scene.handles(), [])
		h.scene.setViewOnly(false)
		h.scene.openTextEditor(A)
		assert.deepEqual(h.scene.handles(), [])
	})

	test('handles follow the zoom: same screen offset of the rot handle at scale 2', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		const rot = h.scene.handles().find((x) => x.name === 'rot')
		assert.deepEqual(rot, { name: 'rot', x: 400, y: 200 - 28 })
		const last = callsOf('setHandles').at(-1)[0]
		assert.equal(last.handles.length, 13, '8 + rot + 4 "+"')
		assert.equal(last.outline, null)
		// the "+" handles keep their screen distance too: 44 px right of the right edge (x 300 → 600 on screen)
		assert.deepEqual(h.scene.handles().find((x) => x.name === 'plus-r'), { name: 'plus-r', x: 600 + 44, y: 320 })
	})

	test('a handle wins over the item under it; release order and isActive; one intent', () => {
		const active = []
		h = setupScene([note(A, { x: 100, y: 100 }), note(B, { x: 300, y: 300, z: 'a9' })], {
			on: { onIntent: (i) => { if (i.type === 'transform') active.push(h.scene.isActive(A)) } },
		})
		h.scene.setSelection([A])
		h.focusCanvas()
		// Ctrl held (R12, job 015): A's raw edge at 398 would snap to B's centre line at 400
		h.pointer('pointerdown', 302, 302)
		h.pointer('pointermove', 330, 330, { ctrlKey: true })
		h.frame()
		assert.equal(h.scene.stats().transforming, true)
		assert.ok(h.scene.isActive(A))
		h.pointer('pointermove', 400, 400, { ctrlKey: true })
		h.pointer('pointerup', 400, 400, { ctrlKey: true })
		const seq = h.log.filter((e) => ['onDragPreview', 'onIntent', 'onActivity'].includes(e[0]))
			.map((e) => e[0] === 'onActivity' ? `activity:${e[1].kind}:${e[1].active}` : e[0] === 'onIntent' ? 'intent:' + e[1].type : 'preview:' + e[1].length)
		assert.deepEqual(seq, ['activity:transform:true', 'preview:0', 'intent:transform', 'activity:transform:false'])
		assert.deepEqual(active, [true])
		const it = h.intents('transform')[0]
		assert.deepEqual(it.ids, [A])
		assert.deepEqual(it.after.get(A), { x: 100, y: 100, w: 298, h: 298, r: 0 })
		assert.equal(it.keep, false)
		assert.equal(h.scene.isActive(A), false)
		assert.deepEqual(h.scene.getSelection(), [A], 'B under the handle was not selected')
		assert.ok(callsOf('beginDrag').length === 1 && callsOf('endDrag').length === 1, 'nodes in the activeGroup during the transform')
		assert.ok(callsOf('transformMoved').length >= 1)
		assert.equal(h.model.get(A).w, 298, 'the model keeps the local box until the session applies')
	})

	test('Esc during a transform: model back, no intent, activity ends', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.focusCanvas()
		h.pointer('pointerdown', 300, 220)
		h.pointer('pointermove', 360, 260)
		h.frame()
		assert.equal(h.model.get(A).w, 260)
		h.key('Escape', { target: h.dom.doc.body })
		h.pointer('pointerup', 360, 260)
		assert.deepEqual(box(h.model.abs(A)), { x: 100, y: 100, w: 200, h: 120, r: 0 })
		assert.deepEqual(h.intents('transform'), [])
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => e[1].active), [true, false])
	})

	test('a click on a handle without moving transforms nothing', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.pointer('pointerdown', 300, 220)
		h.pointer('pointerup', 300, 220)
		assert.deepEqual(h.intents(), [])
		assert.equal(h.log.filter((e) => e[0] === 'onActivity').length, 0)
	})

	test('rotate with the rot handle, Shift = 15° steps', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100, w: 100, h: 100 })])
		h.scene.setSelection([A])
		h.pointer('pointerdown', 150, 72)
		h.pointer('pointermove', 260, 160, { shiftKey: true })
		h.pointer('pointerup', 260, 160, { shiftKey: true })
		const it = h.intents('transform')[0]
		assert.equal(it.after.get(A).r, 90)
	})

	test(`above ${TRANSFORM_LIVE_MAX} items: one activeGroup preview per frame, the model only at the release`, () => {
		const items = []
		for (let i = 0; i < 60; i++) items.push(note('01JA00000000000000000N' + String(i).padStart(4, '0'), { x: (i % 10) * 100, y: Math.floor(i / 10) * 100, w: 80, h: 80, z: 'a' + String(i).padStart(3, '0') }))
		h = setupScene(items)
		h.scene.setSelection(items.map((i) => i.id))
		const br = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', br.x, br.y)
		rcalls.length = 0
		for (let i = 1; i <= 5; i++) {
			h.pointer('pointermove', br.x + 10 * i, br.y + 10 * i)
			h.pointer('pointermove', br.x + 10 * i + 1, br.y + 10 * i + 1)
			h.frame()
		}
		assert.equal(callsOf('setActiveTransform').length, 5, 'one per frame, not per pointer move')
		assert.equal(callsOf('transformMoved').length, 0)
		assert.equal(h.model.get(items[59].id).w, 80, 'model untouched during the preview')
		h.pointer('pointerup', br.x + 51, br.y + 51)
		assert.equal(callsOf('setActiveTransform').at(-1)[0], null, 'preview reset at the release')
		assert.ok(h.model.get(items[59].id).w > 80, 'model updated at the release')
		const it = h.intents('transform')[0]
		assert.equal(it.ids.length, 60)
	})

	test('touch on a handle is claimed by the input controller (no gesture)', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		const at = { x: 300 + 15, y: 220 + 10 }
		dispatch(h.container, 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: at.x, clientY: at.y, button: 0 })
		dispatch(h.container, 'pointermove', { pointerType: 'touch', pointerId: 7, clientX: at.x + 40, clientY: at.y + 40, button: 0 })
		h.frame()
		assert.equal(h.scene.stats().gestureActive, false)
		assert.equal(h.scene.stats().transforming, true)
		dispatch(h.container, 'pointerup', { pointerType: 'touch', pointerId: 7, clientX: at.x + 40, clientY: at.y + 40, button: 0 })
		assert.equal(h.intents('transform').length, 1)
	})

	test('multi selection: 4 corners, union frame outline, no rot', () => {
		h = setupScene([shapeItem(A, { x: 0, y: 0 }), note(B, { x: 400, y: 300 })])
		h.scene.setSelection([A, B])
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['tl', 'tr', 'br', 'bl'])
		const last = callsOf('setHandles').at(-1)[0]
		assert.deepEqual(last.outline, { x: 0, y: 0, w: 600, h: 500 })
	})
})
