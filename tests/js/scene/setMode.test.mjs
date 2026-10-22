/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Scene modes (SPEC-M1 §6.3 "Fassade", §6.5.4; WP-S2, R13 finding SCN-02),
 * deterministic in Node with the real SceneManager, InputController,
 * TextEditor, TransformController, ConnectController and SceneModel on the
 * fake DOM (renderer stubbed):
 * - setMode/getMode, the alias setViewOnly(v) = setMode(v ? 'view' : 'edit'),
 *   the constructor's mode/viewOnly, unknown modes ignored, stats().mode
 * - vote behaves like view until stage 3 (no drag, create, delete, text or
 *   transformer intents, no handles)
 * - without settle (Esc semantics: role lost, frozen): a drag, transform or
 *   connect drag ends without an intent, the model goes back, an open
 *   editor stays open
 * - (R13) with settle: an open editor ends with its final commit first, then
 *   a drag, transform or connect drag ends like a release:
 *   onDragPreview([]) → intent (the items still active, the mode still edit)
 *   → onActivity({active: false}); only then the mode switches; the later
 *   pointerup does nothing
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setupScene, shapeItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C1 = '01JA00000000000000000000C1'

/** A at (100, 100), B at (600, 100), both 200 × 200. */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 })]
const conn = (id, start, end) => ({
	id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + id.slice(-2), parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' },
})

let h
afterEach(() => {
	h?.restore()
	h = null
})

/**
 * A scene whose intents record the mode and the activity of their ids at the moment they arrive.
 *
 * @param {object[]} items WireItems
 * @param {object} [scene] SceneManager options
 * @return {object} harness plus seen: [{type, mode, active}]
 */
function setup(items, scene = {}) {
	const seen = []
	const hh = setupScene(items, {
		scene,
		on: {
			onIntent: (i) => {
				const ids = i.ids ?? (i.id ? [i.id] : [])
				seen.push({ type: i.type, mode: hh.scene.getMode(), active: ids.length > 0 && ids.every((id) => hh.scene.isActive(id)) })
			},
		},
	})
	hh.seen = seen
	hh.editor = () => hh.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null
	hh.type = (text) => {
		const ta = hh.editor()
		ta.value = text
		dispatch(ta, 'input')
	}
	return hh
}

/**
 * The release sequence of the log: dragPreview / intent / activity entries.
 *
 * @param {Array} log harness log
 * @return {string[]}
 */
function sequence(log) {
	return log.filter((e) => e[0] === 'onDragPreview' || e[0] === 'onIntent' || e[0] === 'onActivity')
		.map((e) => e[0] === 'onDragPreview' ? `preview:${e[1].length}` : e[0] === 'onIntent' ? `intent:${e[1].type}` : `activity:${e[1].kind}:${e[1].active}`)
}

describe('setMode / getMode', () => {
	test('edit by default; vote and view are view-only; the same or an unknown mode does nothing', () => {
		h = setup(notes())
		assert.equal(h.scene.getMode(), 'edit')
		assert.equal(h.scene.stats().mode, 'edit')
		h.scene.setMode('vote')
		assert.equal(h.scene.getMode(), 'vote')
		assert.deepEqual([h.scene.stats().mode, h.scene.stats().viewOnly], ['vote', true])
		h.scene.setMode('kiosk')
		h.scene.setMode(undefined)
		assert.equal(h.scene.getMode(), 'vote')
		h.scene.setMode('view')
		assert.deepEqual([h.scene.getMode(), h.scene.stats().viewOnly], ['view', true])
		h.scene.setMode('edit')
		assert.deepEqual([h.scene.getMode(), h.scene.stats().viewOnly], ['edit', false])
	})

	test('setViewOnly(v) is setMode(v ? "view" : "edit")', () => {
		h = setup(notes())
		h.scene.setMode('vote')
		h.scene.setViewOnly(true)
		assert.equal(h.scene.getMode(), 'view')
		h.scene.setViewOnly(false)
		assert.equal(h.scene.getMode(), 'edit')
		h.scene.setViewOnly(true)
		assert.equal(h.scene.getMode(), 'view')
	})

	test('constructor: mode decides; the M0 alias viewOnly only restricts (true turns edit into view); unknown mode = view', () => {
		for (const [opts, mode] of [[{ mode: 'vote' }, 'vote'], [{ mode: 'view' }, 'view'], [{}, 'edit'], [{ viewOnly: false }, 'edit'],
			[{ viewOnly: true }, 'view'], [{ viewOnly: true, mode: 'edit' }, 'view'],
			// BoardSession passes both: the client mode and viewOnly = mode !== 'edit'
			[{ viewOnly: true, mode: 'vote' }, 'vote'], [{ viewOnly: true, mode: 'view' }, 'view'], [{ viewOnly: false, mode: 'edit' }, 'edit'],
			[{ viewOnly: false, mode: 'vote' }, 'vote'], [{ mode: 'bogus' }, 'view']]) {
			h = setup([], opts)
			assert.equal(h.scene.getMode(), mode, JSON.stringify(opts))
			assert.equal(h.scene.stats().viewOnly, mode !== 'edit')
			h.restore()
			h = null
		}
	})
})

describe('mode vote = view until stage 3', () => {
	for (const mode of ['vote', 'view']) {
		test(`${mode}: no drag, delete, create, text or transformer; no handles; ${mode === 'vote' ? 'same as view' : 'M0 view'}`, () => {
			h = setup(notes())
			h.scene.setSelection([A])
			assert.ok(h.scene.handles().length > 0, 'handles in edit')
			h.scene.setMode(mode)
			assert.deepEqual(h.scene.handles(), [])
			h.focusCanvas()
			h.pointer('pointerdown', 200, 200)
			h.pointer('pointermove', 260, 230)
			h.frame()
			h.pointer('pointerup', 260, 230)
			h.key('Delete')
			h.key('n')
			h.key('Enter')
			h.pointer('pointerdown', 700, 500)
			h.pointer('pointerup', 700, 500)
			assert.equal(h.scene.openTextEditor(A), false)
			assert.deepEqual(h.intents(), [])
			assert.equal(h.scene.getTool(), 'select')
			assert.equal(h.scene.isActive(A), false)
		})
	}
})

describe('leaving edit without settle: Esc semantics', () => {
	test('a running drag ends without an intent, the model goes back; the release does nothing', () => {
		h = setup(notes())
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 240, 220)
		h.frame()
		h.pointer('pointermove', 300, 250)
		h.frame()
		assert.equal(h.model.get(A).x, 200)
		h.scene.setMode('vote')
		h.pointer('pointerup', 300, 250)
		assert.deepEqual(h.intents(), [])
		assert.equal(h.model.get(A).x, 100)
		assert.deepEqual(sequence(h.log).slice(-2), ['preview:0', 'activity:drag:false'])
		assert.equal(h.scene.stats().dragging, false)
	})

	test('an open editor stays open with its text (the session sets the notice); no final commit', () => {
		h = setup(notes())
		assert.equal(h.scene.openTextEditor(A), true)
		h.type('typed')
		h.scene.setMode('view')
		assert.ok(h.editor())
		assert.equal(h.editor().value, 'typed')
		assert.deepEqual(h.intents('text').filter((i) => i.final), [])
	})
})

describe('(R13) leaving edit with settle', () => {
	test('open editor: one final commit while the mode is still edit, the editor closes, then the switch', () => {
		h = setup(notes())
		assert.equal(h.scene.openTextEditor(A), true)
		h.type('neu')
		h.scene.setMode('vote', { settle: true })
		const finals = h.intents('text').filter((i) => i.final)
		assert.deepEqual(finals.map((i) => [i.id, i.value, i.before]), [[A, 'neu', A]])
		assert.deepEqual(h.seen.filter((s) => s.type === 'text').at(-1), { type: 'text', mode: 'edit', active: true })
		assert.equal(h.editor(), null)
		assert.equal(h.scene.getMode(), 'vote')
		const edit = h.log.filter((e) => e[0] === 'onActivity' && e[1].kind === 'edit').map((e) => e[1].active)
		assert.deepEqual(edit, [true, false])
	})

	test('the editor had the focus: it goes back to the canvas', () => {
		h = setup(notes())
		h.scene.openTextEditor(A)
		h.editor().focus()
		h.scene.setMode('vote', { settle: true })
		assert.equal(h.dom.doc.activeElement, h.container)
	})

	test('an editor with a notice closes without a commit (as always)', () => {
		h = setup(notes())
		h.scene.openTextEditor(A)
		h.type('lost lease')
		h.scene.setEditorNotice(A, 'Not saved. Copy your text before closing.')
		h.scene.setMode('vote', { settle: true })
		assert.equal(h.editor(), null)
		assert.deepEqual(h.intents('text').filter((i) => i.final), [])
	})

	test('running drag: preview cleared → move intent (items active, mode edit) → activity end; then vote; the release does nothing', () => {
		h = setup(notes())
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 240, 220)
		h.frame()
		h.pointer('pointermove', 300, 250)
		h.log.length = 0
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(sequence(h.log), ['preview:1', 'preview:0', 'intent:move', 'activity:drag:false'],
			'the pending step is applied first (as on a release), then the release order')
		const move = h.intents('move')[0]
		assert.deepEqual([move.ids, move.dx, move.dy], [[A], 100, 50])
		assert.deepEqual(h.seen.at(-1), { type: 'move', mode: 'edit', active: true })
		assert.equal(h.scene.getMode(), 'vote')
		h.pointer('pointermove', 400, 300)
		h.frame()
		h.pointer('pointerup', 400, 300)
		assert.equal(h.intents().length, 1)
		assert.equal(h.scene.stats().dragging, false)
	})

	test('running transform: preview cleared → transform intent (active, edit) → activity end', () => {
		h = setup([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		const br = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', br.x, br.y)
		h.pointer('pointermove', br.x + 30, br.y + 20)
		h.frame()
		h.log.length = 0
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(sequence(h.log), ['preview:0', 'intent:transform', 'activity:transform:false'])
		const xf = h.intents('transform')[0]
		assert.deepEqual([xf.after.get(A).w, xf.after.get(A).h], [230, 140])
		assert.deepEqual(h.seen.at(-1), { type: 'transform', mode: 'edit', active: true })
		h.pointer('pointerup', br.x + 60, br.y + 60)
		assert.equal(h.intents().length, 1)
		assert.equal(h.scene.stats().transforming, false)
	})

	test('running connect drag (tool L): connect intent with the end under the pointer → activity end → tool select', () => {
		h = setup(notes())
		h.scene.setTool('connector')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 400, 220)
		h.frame()
		h.pointer('pointermove', 650, 250)
		h.log.length = 0
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(h.intents('connect').map((i) => [i.start, i.end]), [[{ item: A }, { item: B }]])
		const seq = h.log.filter((e) => ['onIntent', 'onActivity', 'onTool'].includes(e[0]))
			.map((e) => e[0] === 'onActivity' ? `activity:${e[1].kind}:${e[1].active}` : e[0] === 'onIntent' ? 'intent:' + e[1].type : 'tool:' + e[1])
		assert.deepEqual(seq, ['intent:connect', 'activity:connect:false', 'tool:select'])
		assert.equal(h.seen.at(-1).mode, 'edit')
		h.pointer('pointerup', 650, 250)
		assert.equal(h.intents().length, 1)
		assert.equal(h.scene.stats().connecting, null)
	})

	test('running retarget: retarget intent while the connector is still active, then the activity end', () => {
		h = setup([...notes(), note('01JA0000000000000000000003', { x: 100, y: 500 }), conn(C1, { item: A }, { item: B })])
		h.scene.setSelection([C1])
		h.pointer('pointerdown', 600, 200)
		h.pointer('pointermove', 205, 505)
		h.frame()
		h.scene.setMode('view', { settle: true })
		assert.deepEqual(h.intents('retarget').map((i) => [i.id, i.which, i.value.item]), [[C1, 'end', '01JA0000000000000000000003']])
		assert.deepEqual(h.seen.at(-1), { type: 'retarget', mode: 'edit', active: true })
		assert.equal(h.scene.getMode(), 'view')
	})

	test('editor and drag at once: the final commit comes before the drag release', () => {
		h = setup(notes())
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 260, 230)
		h.frame()
		assert.equal(h.scene.openTextEditor(B), true, 'the session may open an editor (text rescue) while a drag runs')
		h.type('rescued')
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual(h.intents().map((i) => [i.type, i.final ?? null]), [['text', true], ['move', null]])
	})

	test('marquee and create drags just end (nothing created); nothing running: no intent, the mode switches', () => {
		h = setup(notes())
		h.pointer('pointerdown', 700, 500)
		h.pointer('pointermove', 900, 700)
		h.scene.setMode('vote', { settle: true })
		assert.equal(callsOf('setMarquee').at(-1)[0], null)
		h.scene.setMode('edit')
		h.scene.setTool('frame')
		h.pointer('pointerdown', 700, 500)
		h.pointer('pointermove', 900, 700)
		h.scene.setMode('view', { settle: true })
		h.pointer('pointerup', 900, 700)
		assert.equal(callsOf('setMarquee').at(-1)[0], null)
		assert.deepEqual(h.intents(), [])
		h.scene.setMode('edit')
		h.scene.setTool('select')
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual([h.intents(), h.scene.getMode()], [[], 'vote'])
	})

	test('back to edit: dragging works again', () => {
		h = setup(notes())
		h.scene.setMode('vote', { settle: true })
		h.scene.setMode('edit')
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 260, 230)
		h.frame()
		h.pointer('pointerup', 260, 230)
		assert.deepEqual(h.intents().map((i) => i.type), ['move'])
	})

	test('settle between two non-edit modes changes nothing else', () => {
		h = setup(notes())
		h.scene.setMode('view')
		h.scene.setMode('vote', { settle: true })
		assert.deepEqual([h.scene.getMode(), h.intents()], ['vote', []])
	})
})
