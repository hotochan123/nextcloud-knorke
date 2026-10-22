/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Locked items in the scene (job 023, M2 SPEC-M1 §1.2 "(R20) Sperren";
 * AK10), on the fake DOM with the real SceneManager and InputController
 * (sceneHarness.mjs) and, for the symbol, pure in Node:
 * - a press on a locked note selects it, a move past the threshold starts
 *   no drag and no marquee; a drag of a mixed selection moves only the free
 *   items
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
 *   0.5; a finger on a locked note selects it and moves nothing: no drag, no
 *   move intent, no pan
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
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

describe('press, drag and marquee', () => {
	test('a press on a locked note selects it; a move past the threshold starts no drag and no marquee (mouse; the finger below)', () => {
		h = setupScene([note(A, { x: 100, y: 100, lock: LOCK }), note(B, { x: 400, y: 100 })])
		h.pointer('pointerdown', 150, 150)
		assert.deepEqual(h.scene.getSelection(), [A], 'selected')
		h.pointer('pointermove', 250, 250)
		h.frame()
		h.pointer('pointermove', 350, 300)
		h.frame()
		h.pointer('pointerup', 350, 300)
		assert.equal(activities('drag').length, 0, 'no beginDrag')
		assert.equal(callsOf('beginDrag').length, 0)
		assert.equal(callsOf('setMarquee').filter((c) => c[0] !== null).length, 0, 'no marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [100, 100], 'the note stays')
		assert.deepEqual(h.scene.getSelection(), [A])
		// a click into a multi selection with a locked item narrows it on release, like any click
		h.scene.setSelection([A, B])
		h.pointer('pointerdown', 150, 150)
		h.pointer('pointerup', 150, 150)
		assert.deepEqual(h.scene.getSelection(), [A])
	})

	test('a finger on a locked note selects it; dragging it starts no drag, no move intent and no pan (review round 1, N8)', () => {
		h = setupScene([note(A, { x: 100, y: 100, lock: LOCK }), note(B, { x: 400, y: 100 })])
		const finger = { pointerType: 'touch', pointerId: 5 }
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 150, 150, finger)
		h.pointer('pointerup', 150, 150, finger)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [A], 'a tap selects the locked note')
		h.pointer('pointerdown', 150, 150, finger)
		for (const [x, y] of [[170, 170], [220, 220], [300, 260]]) {
			h.pointer('pointermove', x, y, finger)
			h.frame()
		}
		h.pointer('pointerup', 300, 260, finger)
		h.frame()
		assert.equal(activities('drag').length, 0, 'no beginDrag')
		assert.equal(callsOf('beginDrag').length, 0)
		assert.deepEqual(h.intents('move'), [], 'no move intent')
		assert.deepEqual(h.scene.getCamera(), cam, 'no pan')
		assert.equal(h.scene.stats().gestureActive, false)
		assert.deepEqual([h.model.get(A).x, h.model.get(A).y], [100, 100])
		assert.deepEqual(h.scene.getSelection(), [A])
		// a finger on free canvas still pans
		h.pointer('pointerdown', 700, 600, finger)
		for (const [x, y] of [[680, 580], [640, 540], [600, 500]]) {
			h.pointer('pointermove', x, y, finger)
			h.frame()
		}
		h.pointer('pointerup', 600, 500, finger)
		h.frame()
		assert.notDeepEqual(h.scene.getCamera(), cam, 'the free canvas pans as before')
	})

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
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'rot', 'plus-t', 'plus-r', 'plus-b', 'plus-l'])
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
