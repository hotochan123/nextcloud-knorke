/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Neighbour with one click (job 136, job 148) in the scene, deterministic in
 * Node on the fake DOM with the real SceneManager, InputController,
 * GestureController, TextEditor and SceneModel (renderer stubbed):
 * - job 148 AK5 a click on plus-r (mouse, pen) gives exactly {type:
 *   'neighbour', id, side: 'r', connect: {route, endCap}} with the connector
 *   tool options (default elbow/arrow since job 153, after setTool('connector', …) the
 *   chosen ones); a mouse moving 4 px draws a connector; a finger trembling
 *   8 px is a tap, 12 px draws a connector; the touchend after the tap is
 *   cancelled (no compatibility click on the new selection); so is the
 *   touchend after a pen tap (a pen on a tablet sends touch events too,
 *   round 1 UI review of job 136), not after a mouse click; Alt+→ gives the
 *   intent without connect
 * - job 148 AK6 an open text editor (note, shape, text item, frame title,
 *   connector label) shows no handles; after Esc the full set is back; a
 *   press that ends an editor hits no handle (plus-b, a corner): the final
 *   text and no neighbour, connect or transform intent; a finger there gives
 *   no neighbour
 * - job 136 AK8 (camera part) panIntoView: an item outside the view is
 *   centred, the zoom stays, onUserCamera once; an item in view moves nothing
 * - job 162 AK4 the mouse preview of a "+": stats().plusPreview names the
 *   near item (connect) or carries the box of plusPlan (neighbour, also
 *   moved on), the renderer gets the rotated box; it follows a model change
 *   with the next frame, is not planned per pointermove, and is null off
 *   the "+", after a pointerdown, for a pen hovering and a finger's tap, on
 *   the "+" of a text item, with an editor open, after another tool or
 *   mode, reset and leaving the canvas; the click still gives the intent
 *   of job 148
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene, shapeItem, textItem } from './sceneHarness.mjs'
import { plusPlan } from '../../../src/model/plus.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const S = '01JA0000000000000000000003'
const T = '01JA0000000000000000000004'
const F = '01JA0000000000000000000009'
const C1 = '01JA00000000000000000000C1'

/** A at (100, 100), 200 × 200: (job 231) plus-r at (304, 200), plus-b at (200, 304) on screen, on its frame (camera at the origin, scale 1). */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 })]
const PLUS_R = [304, 200]
const PLUS_B = [200, 304]
/** The intent of a click on plus-r of A with the default connector tool. */
const CLICK_R = Object.freeze({ type: 'neighbour', id: A, side: 'r', connect: Object.freeze({ route: 'elbow', endCap: 'triangle' }) })

let h
afterEach(() => {
	h?.restore()
	h = null
})

const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })

/** One press from `at`, moved by (dx, 0) in one step, released there. */
function press(at, dx, props = {}) {
	h.pointer('pointerdown', at[0], at[1], props)
	if (dx !== 0) {
		h.pointer('pointermove', at[0] + dx, at[1], props)
		h.frame()
	}
	h.pointer('pointerup', at[0] + dx, at[1], props)
	h.frame()
}

/** Did a connector drag start (onActivity connect true) since the log was cleared? */
const connectStarted = () => h.log.some((e) => e[0] === 'onActivity' && e[1].kind === 'connect' && e[1].active === true)

/** The open editor's textarea. */
const editorArea = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))

describe('AK5 click or tap on a "+" handle (job 148: with connect)', () => {
	test('a mouse click and a pen click on plus-r give exactly the neighbour intent with connect elbow/arrow (job 153); nothing else happens', () => {
		for (const props of [{}, { pointerType: 'pen', pointerId: 3 }]) {
			h = setupScene(notes())
			h.scene.setSelection([A])
			press(PLUS_R, 0, props)
			assert.deepEqual(h.intents(), [CLICK_R], props.pointerType ?? 'mouse')
			assert.equal(connectStarted(), false)
			assert.deepEqual(h.scene.getSelection(), [A], 'the scene changes no selection itself')
			h.restore()
			h = null
		}
	})

	test('the click carries the connector tool options: after setTool(connector, curved/dot) and back to select', () => {
		h = setupScene(notes())
		h.scene.setTool('connector', { route: 'curved', endCap: 'dot' })
		h.scene.setTool('select')
		h.scene.setSelection([A])
		press(PLUS_R, 0)
		assert.deepEqual(h.intents(), [{ type: 'neighbour', id: A, side: 'r', connect: { route: 'curved', endCap: 'dot' } }])
	})

	test('a mouse moving 4 px from plus-r draws a connector, no neighbour', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		press(PLUS_R, 4)
		assert.equal(connectStarted(), true)
		assert.deepEqual(h.intents('neighbour'), [])
	})

	test('a finger trembling 8 px is a tap (the same intent, touchend cancelled); 12 px draws a connector (touchend kept)', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		press(PLUS_R, 8, finger())
		assert.deepEqual(h.intents(), [CLICK_R])
		assert.equal(connectStarted(), false)
		assert.equal(dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented, true, 'no compatibility click on the new selection')
		assert.equal(dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented, false, 'only once')
		h.log.length = 0
		press(PLUS_R, 12, finger(6))
		assert.equal(connectStarted(), true)
		assert.deepEqual(h.intents('neighbour'), [])
		assert.equal(dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented, false)
	})

	test('a pen tap on plus-r cancels the touchend that follows (S Pen, Apple Pencil); a mouse click does not', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		press(PLUS_R, 0, { pointerType: 'pen', pointerId: 3 })
		assert.deepEqual(h.intents(), [CLICK_R])
		assert.equal(dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented, true, 'no compatibility click after the pen tap')
		assert.equal(dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented, false, 'only once')
		press(PLUS_R, 0)
		assert.equal(h.intents().length, 2)
		assert.equal(dispatch(h.container, 'touchend', { cancelable: true }).defaultPrevented, false, 'a mouse click sets nothing')
	})

	test('every side; a resize handle released without a drag gives nothing; Alt+→ gives the intent without connect', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		const at = Object.fromEntries(h.scene.handles().map((x) => [x.name, [x.x, x.y]]))
		for (const side of ['t', 'r', 'b', 'l']) press(at['plus-' + side], 0)
		assert.deepEqual(h.intents().map((i) => [i.type, i.id, i.side, i.connect?.route, i.connect?.endCap]), ['t', 'r', 'b', 'l'].map((s) => ['neighbour', A, s, 'elbow', 'triangle']))
		press(at.br, 0)
		assert.equal(h.intents().length, 4)
		h.focusCanvas()
		h.key('ArrowRight', { altKey: true })
		assert.deepEqual(h.intents().at(-1), { type: 'neighbour', id: A, side: 'r' })
	})
})

describe('AK6 no handles with a text editor open (job 148)', () => {
	test('note, shape and text: no handles while the editor is open (stats too); the full set with the "+" handles again after Esc', () => {
		h = setupScene([note(A, { x: 100, y: 100 }), shapeItem(S, { x: 100, y: 500 }), textItem(T, { x: 500, y: 500 })])
		for (const id of [A, S, T]) {
			h.scene.setSelection([id])
			const full = h.scene.handles().map((x) => x.name)
			// (job 231) a text item's sides l/r take the place of plus-l/plus-r
			assert.ok((id === T ? ['plus-t', 'plus-b', 'l', 'r', 'br'] : ['plus-t', 'plus-r', 'plus-b', 'plus-l', 'br']).every((n) => full.includes(n)), id)
			assert.equal(h.scene.openTextEditor(id), true)
			assert.deepEqual(h.scene.handles(), [], id)
			assert.equal(h.scene.stats().handles, 0)
			h.key('Escape', { target: editorArea() })
			assert.equal(h.scene.stats().editing, null)
			assert.deepEqual(h.scene.handles().map((x) => x.name), full, `${id}: the full set after the editor`)
		}
	})

	test('a frame title editor, a connector label editor and an editor beside a multi-selection show no handles', () => {
		const conn = { id: C1, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b1', parent: null, data: { start: { item: A }, end: { item: B }, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' } }
		h = setupScene([frameItem(F, { x: 0, y: 1000 }), ...notes(), conn])
		h.scene.setSelection([F])
		assert.equal(h.scene.openTextEditor(F), true)
		assert.deepEqual(h.scene.handles(), [], 'frame title')
		h.scene.setSelection([C1])
		assert.equal(h.scene.openTextEditor(C1), true)
		assert.deepEqual(h.scene.handles(), [], 'connector label')
		h.scene.setSelection([A, B])
		assert.equal(h.scene.openTextEditor(A), true)
		assert.deepEqual(h.scene.handles(), [], 'two items selected')
	})

	test('a mouse press where plus-b or a corner handle would be, with the editor open: the final text, then no neighbour, connect or transform intent (a click and a drag)', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		const br = h.scene.handles().find((x) => x.name === 'br')
		for (const [name, at] of [['plus-b', PLUS_B], ['br', [br.x, br.y]]]) {
			for (const dx of [0, 10]) {
				h.scene.setSelection([A])
				h.log.length = 0
				h.scene.openTextEditor(A)
				const ta = editorArea()
				ta.value = `typed ${name} ${dx}`
				dispatch(ta, 'input')
				press(at, dx)
				assert.equal(ta.isConnected, false, `${name} ${dx}: the editor ended`)
				const got = h.intents()
				assert.deepEqual(got.slice(0, 1).map((i) => [i.type, i.id, i.value, i.final]), [['text', A, `typed ${name} ${dx}`, true]], `${name} ${dx}: the final text first`)
				assert.deepEqual(got.filter((i) => ['neighbour', 'connect', 'transform'].includes(i.type)), [], `${name} ${dx}: no handle was hit`)
				assert.equal(connectStarted(), false, `${name} ${dx}: no connector drag`)
			}
		}
	})

	test('a finger where plus-r would be, with the editor open, gives no neighbour', () => {
		h = setupScene(notes())
		h.scene.setSelection([A])
		h.scene.openTextEditor(A)
		press(PLUS_R, 0, finger())
		assert.deepEqual(h.intents('neighbour'), [])
		assert.equal(connectStarted(), false)
	})
})

describe('AK8 camera: panIntoView', () => {
	test('an item outside the view is centred, the zoom stays, onUserCamera once; an item in view moves nothing', () => {
		h = setupScene([note(A, { x: 100, y: 100 }), note(B, { x: 3000, y: 2000 })])
		h.scene.setCamera({ x: 0, y: 0, scale: 0.5 })
		h.frame()
		h.log.length = 0
		assert.equal(h.scene.panIntoView(A), false, 'A is in view')
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 0)
		assert.equal(h.scene.panIntoView(B), true)
		h.frame()
		const cam = h.scene.getCamera()
		assert.equal(cam.scale, 0.5, 'the zoom stays')
		assert.deepEqual([cam.x, cam.y], [3100 - 1000, 2100 - 800], 'B centred (container 1000 × 800 at scale 0.5)')
		const r = h.scene.itemScreenRect(B)
		assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1000 && r.y + r.h <= 800, 'B wholly in view')
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera').length, 1)
		assert.equal(h.scene.panIntoView('01JA0000000000000000000099'), false, 'unknown item')
	})
})

describe('job 162 AK4 the mouse preview of a "+"', () => {
	const X = '01JA00000000000000000000X1'
	/** A at (100, 100) as above; X 150 right of A (in reach), D 205 below it (out of reach, in the way of N). */
	const board = () => [note(A, { x: 100, y: 100 }), note(X, { x: 450, y: 150 }), note(B, { x: 100, y: 505 })]
	const preview = () => h.scene.stats().plusPreview
	const hover = (at, props = {}) => {
		h.pointer('pointermove', at[0], at[1], props)
		h.frame()
	}

	test('the mouse over plus-r of A with X in reach: {kind: connect, id: X}, the renderer gets X\'s box; X removed: neighbour after the next frame', () => {
		h = setupScene(board())
		h.scene.setSelection([A])
		hover(PLUS_R)
		assert.deepEqual(preview(), { kind: 'connect', id: X })
		assert.deepEqual(callsOf('setPlusPreview').at(-1), [{ kind: 'connect', box: { x: 450, y: 150, w: 200, h: 200, r: 0 } }])
		h.scene.update(h.model.apply({ removes: [X] }))
		assert.equal(preview().kind, 'connect', 'planned anew with the frame, not at once')
		h.frame()
		assert.deepEqual(preview(), { kind: 'neighbour', box: plusPlan(h.model, { id: A, side: 'r' }).box })
		assert.deepEqual(preview().box, { x: 320, y: 100, w: 200, h: 200, r: 0 })
		assert.deepEqual(callsOf('setPlusPreview').at(-1), [{ kind: 'neighbour', box: { x: 320, y: 100, w: 200, h: 200, r: 0 } }])
	})

	test('the mouse over plus-b without a target: {kind: neighbour, box} as plusPlan gives it, moved on past B', () => {
		h = setupScene(board())
		h.scene.setSelection([A])
		hover(PLUS_B)
		const want = plusPlan(h.model, { id: A, side: 'b' })
		assert.equal(want.kind, 'neighbour')
		assert.deepEqual(preview(), { kind: 'neighbour', box: want.box })
		assert.deepEqual([want.box.x, want.box.y], [100, 725], 'moved on: 20 below B')
	})

	test('planned when the hovered handle changes and once per frame for model changes, not per pointermove', () => {
		h = setupScene(board())
		h.scene.setSelection([A])
		hover(PLUS_R)
		const ids = h.model.ids.bind(h.model)
		let scans = 0
		h.model.ids = () => {
			scans++
			return ids()
		}
		for (const [dx, dy] of [[1, 0], [2, 1], [0, 2], [-1, -1]]) h.pointer('pointermove', PLUS_R[0] + dx, PLUS_R[1] + dy)
		assert.equal(scans, 0, 'no plan while the mouse stays on plus-r')
		assert.deepEqual(preview(), { kind: 'connect', id: X })
		h.scene.update(h.model.apply({ upserts: [note(B, { x: 100, y: 600 })] }))
		h.scene.update(h.model.apply({ upserts: [note(B, { x: 100, y: 700 })] }))
		const before = scans
		h.frame()
		assert.ok(scans > before, 'the frame plans anew')
		const once = scans - before
		h.frame()
		assert.equal(scans - before, once, 'nothing more without a change')
	})

	test('null off the "+", after a pointerdown (back with the next hover), for a pen hovering and after a finger\'s tap', () => {
		h = setupScene(board())
		h.scene.setSelection([A])
		hover(PLUS_R)
		assert.equal(preview().kind, 'connect')
		hover([700, 700])
		assert.equal(preview(), null, 'off the "+"')
		hover(PLUS_R)
		h.pointer('pointerdown', PLUS_R[0], PLUS_R[1])
		assert.equal(preview(), null, 'a pointerdown')
		h.pointer('pointerup', PLUS_R[0], PLUS_R[1])
		h.frame()
		assert.equal(preview(), null, 'still none after the release')
		assert.deepEqual(h.intents(), [CLICK_R], 'the click still gives the intent of job 148')
		hover(PLUS_R)
		assert.equal(preview().kind, 'connect', 'the next hover plans anew')
		hover(PLUS_R, { pointerType: 'pen', pointerId: 3 })
		assert.equal(preview(), null, 'a pen hovering plus-r (S Pen)')
		hover(PLUS_R)
		assert.equal(preview().kind, 'connect')
		press(PLUS_R, 0, finger())
		assert.equal(preview(), null, 'a finger\'s tap')
		assert.deepEqual(callsOf('setPlusPreview').at(-1), [null])
	})

	test('null on the "+" of a text item, with an editor open, after another tool or mode, reset and leaving the canvas', () => {
		h = setupScene([...board(), textItem(T, { x: 100, y: 1200 })])
		h.scene.setSelection([T])
		const t = Object.fromEntries(h.scene.handles().map((x) => [x.name, [x.x, x.y]]))
		hover(t['plus-t'])
		assert.equal(h.scene.stats().handles > 0 && preview(), null, 'the "+" of a text item')
		h.scene.setSelection([A])
		h.frame()
		const on = () => {
			hover([700, 700])
			hover(PLUS_R)
			assert.equal(preview().kind, 'connect')
		}
		on()
		h.scene.openTextEditor(A)
		h.frame()
		assert.equal(preview(), null, 'an editor')
		hover(PLUS_R)
		assert.equal(preview(), null, 'no "+" while the editor is open')
		h.key('Escape', { target: editorArea() })
		h.frame()
		on()
		h.scene.setTool('sticky')
		h.frame()
		assert.equal(preview(), null, 'another tool')
		h.scene.setTool('select')
		h.frame()
		on()
		h.scene.setMode('view')
		h.frame()
		assert.equal(preview(), null, 'mode view')
		h.scene.setMode('edit')
		h.frame()
		on()
		h.scene.reset()
		assert.equal(preview(), null, 'reset')
		h.frame()
		assert.equal(preview(), null, 'reset: none until the next hover')
		on()
		h.pointer('pointerleave', 1200, 200)
		assert.equal(preview(), null, 'the mouse left the canvas')
	})
})
