/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Connectors in the scene (SPEC-M1 §6.3, round 1b), deterministic in Node on
 * the fake DOM with the real SceneManager, InputController, ConnectController,
 * TransformController and SceneModel (renderer stubbed):
 * - tool L: drag from item to item → intent connect (ends snapped: anchor
 *   ≤ SNAP_PX, else auto, free on empty canvas, Ctrl/⌘ free), route/endCap
 *   from the tool options, release order, the tool falls back; a click
 *   creates nothing; Esc cancels; a free end inside the start item gives
 *   nothing
 * - "+" handles of one note/shape/text: drag = connect from that anchor
 * - end handles of one connector: drag = retarget (previewed in the model,
 *   isActive at the intent, the other end's item is never the target)
 * - drags: attached connectors join the activeGroup and follow; a free
 *   connector shifts its free ends locally (stored data untouched); a
 *   connector bound outside the drag does not move; drag previews leave
 *   connectors out
 * - label editor (double click, kind label, Enter commits), transform of a
 *   multi selection with a free connector, remote previews re-routed over
 *   the box resolver, marquee, Tab order, itemScreenRect
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, rcalls, setupScene, shapeItem } from './sceneHarness.mjs'
import { transformItems } from '../../../src/board/actions.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const C1 = '01JA00000000000000000000C1'
const C2 = '01JA00000000000000000000C2'

/** A at (100, 100), B at (600, 100), C at (100, 500), all 200 × 200. */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 }), note(C, { x: 100, y: 500 })]
const conn = (id, start, end, extra = {}) => ({
	id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + id.slice(-2), parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' }, ...extra,
})

let h
afterEach(() => {
	h?.restore()
	h = null
})

/**
 * A mouse drag from (x0, y0) to (x1, y1) in two moves.
 *
 * @param {number} x0 start x
 * @param {number} y0 start y
 * @param {number} x1 end x
 * @param {number} y1 end y
 * @param {object} [props] modifier keys of the moves and the release
 */
function drag(x0, y0, x1, y1, props = {}) {
	h.pointer('pointerdown', x0, y0)
	h.pointer('pointermove', (x0 + x1) / 2, (y0 + y1) / 2, props)
	h.frame()
	h.pointer('pointermove', x1, y1, props)
	h.frame()
	h.pointer('pointerup', x1, y1, props)
}

describe('tool L', () => {
	test('L selects the connector tool (canvas focus); a drag from A to B gives connect with the tool options; release order; the tool falls back', () => {
		h = setupScene(notes())
		h.focusCanvas()
		h.key('l')
		assert.equal(h.scene.getTool(), 'connector')
		h.scene.setTool('connector', { route: 'elbow', endCap: 'diamond' })
		rcalls.length = 0
		drag(200, 200, 650, 250)
		assert.deepEqual(h.intents('connect'), [{ type: 'connect', start: { item: A }, end: { item: B }, route: 'elbow', endCap: 'diamond' }])
		const seq = h.log.filter((e) => ['onIntent', 'onActivity', 'onTool'].includes(e[0]))
			.map((e) => e[0] === 'onActivity' ? `activity:${e[1].kind}:${e[1].active}` : e[0] === 'onIntent' ? 'intent:' + e[1].type : 'tool:' + e[1])
		assert.deepEqual(seq, ['tool:connector', 'activity:connect:true', 'intent:connect', 'activity:connect:false', 'tool:select'])
		const previews = rcalls.filter((c) => c[0] === 'setConnectPreview')
		assert.ok(previews.length >= 2, 'previewed while dragging')
		assert.deepEqual(previews.at(-1), ['setConnectPreview', null], 'cleared at the release')
		const shown = previews.filter((c) => c[1] !== null).map((c) => c[1])
		assert.deepEqual([shown[0].target, shown[0].anchors.length], [null, 0], 'over empty canvas: a line to the pointer')
		assert.ok(shown.at(-1).points.length >= 4 && shown.at(-1).target !== null && shown.at(-1).anchors.length === 4, 'over B: its outline and anchors')
		assert.equal(h.scene.getTool(), 'select')
		assert.equal(h.scene.stats().connecting, null)
	})

	test('snapping: an anchor ≤ SNAP_PX (inside or beside the item), else auto inside, else a free point on the 0.01 grid', () => {
		h = setupScene(notes())
		const endOf = (x, y) => {
			h.scene.setTool('connector')
			drag(200, 200, x, y)
			return h.intents('connect').at(-1)?.end ?? null
		}
		assert.deepEqual(endOf(605, 195), { item: B, ax: 0, ay: 0.5 }, 'inside, 7 px from the left anchor')
		assert.deepEqual(endOf(590, 200), { item: B, ax: 0, ay: 0.5 }, 'beside it, 10 px from the anchor')
		assert.deepEqual(endOf(650, 250), { item: B }, 'inside, far from the anchors: auto')
		assert.deepEqual(endOf(450.123, 450.456), { x: 450.12, y: 450.46 }, 'empty canvas')
	})

	test('a free start on empty canvas; Ctrl/⌘ suppresses snapping (also when pressed during the drag without moving)', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		drag(450, 450, 650, 250, { ctrlKey: true })
		assert.deepEqual(h.intents('connect')[0], { type: 'connect', start: { x: 450, y: 450 }, end: { x: 650, y: 250 }, route: 'straight', endCap: 'arrow' })
		h.scene.setTool('connector')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 650, 250)
		h.frame()
		dispatch(h.container, 'keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, repeat: false, isComposing: false })
		h.frame()
		assert.equal(callsOf('setConnectPreview').at(-1)[0].target, null, 'free while Ctrl is down')
		dispatch(h.container, 'keyup', { key: 'Control', code: 'ControlLeft' })
		h.frame()
		assert.notEqual(callsOf('setConnectPreview').at(-1)[0].target, null, 'snapping again after the keyup')
		h.pointer('pointerup', 650, 250)
		assert.deepEqual(h.intents('connect')[1].end, { item: B }, 'Ctrl released before the release: snapped again')
	})

	test('a click creates nothing and keeps the tool; Esc cancels without an intent; a free end inside the start item gives nothing', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointerup', 201, 201)
		assert.equal(h.scene.getTool(), 'connector')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 400, 400)
		h.frame()
		h.key('Escape', { target: h.dom.doc.body })
		h.pointer('pointerup', 650, 250)
		drag(200, 200, 230, 240)
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => e[1].active), [true, false, true, false])
		assert.deepEqual(callsOf('setConnectPreview').at(-1), [null])
	})
})

describe('"+" handles and end handles', () => {
	test('one note: four "+" handles; a drag from plus-r connects from its anchor', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		const plus = h.scene.handles().filter((x) => x.name.startsWith('plus-'))
		assert.deepEqual(plus.map((x) => [x.name, x.x, x.y]), [['plus-t', 200, 56], ['plus-r', 344, 200], ['plus-b', 200, 344], ['plus-l', 56, 200]])
		drag(344, 200, 650, 250)
		assert.deepEqual(h.intents('connect'), [{ type: 'connect', start: { item: A, ax: 1, ay: 0.5 }, end: { item: B }, route: 'straight', endCap: 'arrow' }])
		assert.deepEqual(h.intents('transform'), [], 'no transform from a "+" handle')
	})

	test('a shape: "+" handles at SHAPES[kind].anchors (triangle), rotated with it; none for several items or a frame', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100, w: 200, h: 200, data: { kind: 'triangle', text: '' } }), note(B, { x: 600, y: 100 })])
		h.scene.setSelection([A])
		const r = h.scene.handles().find((x) => x.name === 'plus-r')
		assert.deepEqual([r.x, r.y], [250 + 44, 200], 'triangle right anchor (0.75, 0.5)')
		h.scene.setSelection([A, B])
		assert.equal(h.scene.handles().filter((x) => x.name.startsWith('plus-')).length, 0)
	})

	test('one connector: end handles at its route; dragging the end re-targets (preview in the model, isActive at the intent)', () => {
		const active = []
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })], {
			on: { onIntent: (i) => { if (i.type === 'retarget') active.push(h.scene.isActive(C1)) } },
		})
		h.scene.setSelection([C1])
		assert.deepEqual(h.scene.handles(), [{ name: 'start', x: 300, y: 200 }, { name: 'end', x: 600, y: 200 }])
		h.pointer('pointerdown', 600, 200)
		h.pointer('pointermove', 400, 400)
		h.frame()
		h.pointer('pointermove', 205, 505)
		h.frame()
		assert.ok(h.scene.isActive(C1))
		assert.deepEqual(h.model.geometryOf(C1).end, { x: 200, y: 500, angle: h.model.geometryOf(C1).end.angle }, 'previewed at C\'s top anchor')
		assert.deepEqual(h.model.get(C1).data.end, { item: B }, 'stored end untouched')
		assert.deepEqual(callsOf('beginDrag').at(-1)[0], [C1], 'the connector in the activeGroup')
		h.pointer('pointerup', 205, 505)
		assert.deepEqual(h.intents('retarget'), [{ type: 'retarget', id: C1, which: 'end', value: { item: C, ax: 0.5, ay: 0 }, before: { item: B } }])
		assert.deepEqual(active, [true])
		assert.equal(h.scene.isActive(C1), false)
		assert.deepEqual(h.model.geometryOf(C1).end.x, 600, 'no session here: the local preview settles back to the stored end')
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => [e[1].kind, e[1].active, e[1].ids]), [['connect', true, [C1]], ['connect', false, [C1]]])
	})

	test('retarget: the other end\'s item is never the target; an unchanged end gives no intent; Esc puts the preview back', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		h.scene.setSelection([C1])
		drag(600, 200, 250, 250)
		assert.deepEqual(h.intents('retarget')[0].value, { x: 250, y: 250 }, 'over the start item: a free point')
		h.scene.setSelection([C1])
		drag(600, 200, 680, 220)
		assert.equal(h.intents('retarget').length, 1, 'still bound to B (auto): no intent')
		h.pointer('pointerdown', 600, 200)
		h.pointer('pointermove', 205, 505)
		h.frame()
		h.key('Escape', { target: h.dom.doc.body })
		assert.deepEqual(h.model.geometryOf(C1).points, [300, 200, 600, 200])
		h.pointer('pointerup', 205, 505)
		assert.equal(h.intents('retarget').length, 1)
	})
})

describe('connect and retarget end without an intent when the scene changes under them', () => {
	test('setViewOnly(true) during a connect drag cancels it like Esc', () => {
		h = setupScene(notes())
		h.scene.setTool('connector')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 650, 250)
		h.frame()
		h.scene.setViewOnly(true)
		h.pointer('pointerup', 650, 250)
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => e[1].active), [true, false])
		assert.equal(h.scene.stats().connecting, null)
	})

	test('reset() (resync) during a retarget: no intent, the preview and the activeGroup are dropped', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		h.scene.setSelection([C1])
		h.pointer('pointerdown', 600, 200)
		h.pointer('pointermove', 205, 505)
		h.frame()
		h.model.load([...notes(), conn(C1, { item: A }, { item: B })])
		h.scene.reset()
		h.pointer('pointerup', 205, 505)
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.isActive(C1), false)
		assert.deepEqual(callsOf('setConnectPreview').at(-1), [null])
		assert.ok(callsOf('endDrag').length >= 1)
	})

	test('the re-targeted connector is removed remotely: no intent, activity ends; so is the start item of a new connector', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		h.scene.setSelection([C1])
		h.pointer('pointerdown', 600, 200)
		h.pointer('pointermove', 205, 505)
		h.frame()
		h.scene.update(h.model.apply({ removes: [C1] }))
		h.pointer('pointerup', 205, 505)
		h.scene.setTool('connector')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 650, 250)
		h.frame()
		h.scene.update(h.model.apply({ removes: [A] }))
		h.pointer('pointerup', 650, 250)
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => [e[1].kind, e[1].active]), [['connect', true], ['connect', false], ['connect', true], ['connect', false]])
	})
})

describe('drags with connectors', () => {
	test('dragging a note takes its connectors into the activeGroup; they follow; previews leave them out', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		drag(150, 150, 150, 250)
		const all = callsOf('beginDrag')[0][0]
		assert.ok(all.has(A) && all.has(C1), 'note and its connector in the activeGroup')
		assert.ok(callsOf('dragMoved').some((c) => c[0].has(C1)), 'the connector re-routed while dragging')
		for (const p of h.log.filter((e) => e[0] === 'onDragPreview')) assert.ok(p[1].every((d) => d[0] !== C1))
		assert.deepEqual(h.intents('move')[0].ids, [A])
	})

	test('a free connector moves its free ends locally (stored data untouched); move intent with its id', () => {
		h = setupScene([...notes(), conn(C2, { x: 100, y: 750 }, { x: 400, y: 750 })])
		h.pointer('pointerdown', 250, 750)
		h.pointer('pointerup', 250, 750)
		assert.deepEqual(h.scene.getSelection(), [C2], 'a click on the line selects it')
		h.pointer('pointerdown', 250, 750)
		h.pointer('pointermove', 275, 760)
		h.frame()
		h.pointer('pointermove', 300, 770)
		h.frame()
		assert.deepEqual(h.model.geometryOf(C2).points, [150, 770, 450, 770])
		assert.deepEqual(h.model.get(C2).data.start, { x: 100, y: 750 })
		assert.ok(h.scene.isActive(C2))
		h.pointer('pointerup', 300, 770)
		const mv = h.intents('move')[0]
		assert.deepEqual([mv.ids, mv.dx, mv.dy], [[C2], 50, 20])
		assert.deepEqual(h.model.geometryOf(C2).points, [100, 750, 400, 750], 'no session: settles back to the stored ends')
	})

	test('a selected connector bound to an item outside the drag does not move; with its targets it follows', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		h.scene.setSelection([C1])
		drag(450, 200, 450, 300)
		assert.deepEqual(h.intents('move'), [])
		assert.equal(callsOf('beginDrag').length, 0)
		h.scene.setSelection([A, B, C1])
		drag(150, 150, 150, 250)
		assert.deepEqual(h.intents('move')[0].ids, [A, B, C1])
	})

	test('arrow keys: a bound connector alone is not nudged, a free one is', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B }), conn(C2, { x: 100, y: 750 }, { x: 400, y: 750 })])
		h.focusCanvas()
		h.scene.setSelection([C1])
		h.key('ArrowRight')
		h.scene.setSelection([C2])
		h.key('ArrowRight')
		assert.deepEqual(h.intents('move').map((m) => m.ids), [[C2]])
	})
})

describe('label, transform, remote previews, queries', () => {
	test('double click on a connector opens the label editor (kind label, centred at labelAt); Enter commits data.label', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		dispatch(h.container, 'dblclick', { clientX: 450, clientY: 201, button: 0 })
		const ta = h.dom.doc.activeElement
		assert.equal(ta?.getAttribute('data-knorke-editor-kind'), 'label')
		assert.equal(ta.maxLength, 200)
		h.frame()
		// empty editor: LABEL_EDITOR_MIN_W = 4 · 16 + 2 · 4 = 72 wide, centred at labelAt.x 450
		assert.match(ta.style.getPropertyValue('transform'), /^translate\(414px, 186\.4px\)/)
		ta.value = 'ja'
		dispatch(ta, 'input', {})
		h.key('Enter', { target: ta })
		const t = h.intents('text').at(-1)
		assert.deepEqual([t.id, t.path, t.value, t.final], [C1, 'data.label', 'ja', true])
		assert.equal(h.dom.doc.activeElement, h.container, 'focus back on the canvas')
		// Shift+Enter breaks the line and keeps the editor open
		h.scene.openTextEditor(C1)
		const ta2 = h.dom.doc.activeElement
		const e = h.key('Enter', { target: ta2, shiftKey: true })
		assert.equal(e.defaultPrevented, false)
		assert.equal(h.dom.doc.activeElement, ta2)
	})

	test('multi transform with a free connector: its id in the intent (no box), free ends previewed in the model', () => {
		h = setupScene([note(A, { x: 100, y: 100 }), conn(C2, { x: 100, y: 400 }, { x: 300, y: 400 })])
		h.scene.setSelection([A, C2])
		const br = h.scene.handles().find((x) => x.name === 'br')
		assert.deepEqual([br.x, br.y], [300, 400], 'the frame includes the route box')
		h.pointer('pointerdown', br.x, br.y)
		h.pointer('pointermove', br.x + 30, br.y + 30)
		h.frame()
		h.pointer('pointermove', br.x + 100, br.y + 100)
		h.frame()
		assert.notDeepEqual(h.model.geometryOf(C2).points, [100, 400, 300, 400])
		assert.deepEqual(h.model.get(C2).data.start, { x: 100, y: 400 })
		assert.ok(h.scene.isActive(C2))
		h.pointer('pointerup', br.x + 100, br.y + 100)
		const it = h.intents('transform')[0]
		assert.deepEqual(it.ids, [A, C2])
		assert.deepEqual([...it.before.keys()], [A])
		assert.deepEqual(h.model.geometryOf(C2).points, [100, 400, 300, 400], 'settled back without a session')
	})

	test('cross-check with [C]: the preview of free ends equals what transformItems patches (0.01 grid)', () => {
		h = setupScene([note(A, { x: 100, y: 100 }), note(B, { x: 400, y: 100 }), conn(C2, { x: 120, y: 420 }, { x: 560, y: 380 })])
		h.scene.setSelection([A, B, C2])
		const br = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', br.x, br.y)
		h.pointer('pointermove', br.x + 40, br.y + 40)
		h.frame()
		h.pointer('pointermove', br.x + 137, br.y + 91)
		h.frame()
		const preview = h.model.geometryOf(C2).points.slice()
		let intent = null
		h.log.length = 0
		h.pointer('pointerup', br.x + 137, br.y + 91)
		intent = h.intents('transform')[0]
		const r = transformItems(h.model, { ids: intent.ids, before: intent.before, after: intent.after, keep: intent.keep })
		const op = r.ops.find((o) => o.id === C2)
		const q2 = (v) => Math.round(v * 100) / 100
		assert.deepEqual([op.p['data.start'].x, op.p['data.start'].y, op.p['data.end'].x, op.p['data.end'].y], preview.map(q2))
	})

	test('a selection of connectors only has no transformer handles (one connector: its end handles)', () => {
		h = setupScene([conn(C1, { x: 0, y: 0 }, { x: 100, y: 0 }), conn(C2, { x: 0, y: 50 }, { x: 100, y: 50 })])
		h.scene.setSelection([C1, C2])
		assert.deepEqual(h.scene.handles(), [])
	})

	test('remote drag preview: attached connectors re-route over the box resolver', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		let offset = { dx: 0, dy: 300 }
		h.scene.renderer.setPreviews = () => true
		h.scene.renderer.previewOffset = (id) => (id === A ? offset : null)
		h.scene.setRemoteSampler(() => [{ key: 'p:c', pid: 'p', name: 'P', color: '#123456', guest: false, cursor: null, selection: [], drag: [[A, 100, 400]], editing: null, editingHolder: false }])
		h.frame()
		assert.deepEqual(h.model.geometryOf(C1).start, { x: 300, y: 500, angle: h.model.geometryOf(C1).start.angle })
		assert.ok(callsOf('dragMoved').some((c) => c[0].has(C1)))
		offset = null
		h.scene.setRemoteSampler(() => [])
		h.frame()
		assert.deepEqual(h.model.geometryOf(C1).points, [300, 200, 600, 200])
	})

	test('marquee takes a connector only when its route lies inside; Tab order uses the route box; itemScreenRect too', () => {
		h = setupScene([...notes(), conn(C1, { item: A }, { item: B })])
		drag(50, 50, 350, 350)
		assert.deepEqual(h.scene.getSelection(), [A])
		drag(50, 50, 850, 350)
		assert.deepEqual(h.scene.getSelection().slice().sort(), [A, B, C1].sort())
		assert.deepEqual(h.scene.itemScreenRect(C1), { x: 300, y: 200, w: 300, h: 0 })
		h.scene.setSelection([])
		h.focusCanvas()
		const order = []
		for (let i = 0; i < 4; i++) {
			h.key('Tab')
			order.push(h.scene.getSelection()[0])
		}
		assert.deepEqual(order, [A, C1, B, C])
	})
})
