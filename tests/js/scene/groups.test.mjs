/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Groups in the scene (job 026, AK8; M2 SPEC-M1 §1.2 "(R20) Gruppieren"),
 * on the fake DOM with the real SceneManager, InputController and
 * SceneModel (sceneHarness.mjs, the renderer a recording stub):
 * - clicks: a click on a member selects the group (the member last), a
 *   second click narrows to the member, Shift+click deselects the whole
 *   group, a double click edits the member at once
 * - the marquee takes the whole group of a member it hits
 * - Tab selects like a click and skips the other members of the current
 *   item's fully selected group; Enter on exactly one group narrows to the
 *   current item (like the second click) and edits it, so the next Tab
 *   reaches the next member (round 1, UX B2: every member by keyboard)
 * - a drag and the arrows move the whole group, nothing with a locked member
 * - handles: four corners for a whole group, none with a locked member
 * - one outline per fully selected group (the renderer's setSelection
 *   groups; stats().groupOutlines passes the renderer's count through), no
 *   dashed multi-selection frame for exactly one group, following an
 *   incoming group change at once
 * - the drop target of a dragged group: the frame under the union's centre
 * - mode vote: a click votes for the member only, nothing is selected
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { KonvaRenderer } from '../../../src/scene/KonvaRenderer.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, frameItem, note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const F = '01JA0000000000000000000009'
const G = '01JG0000000000000000000001'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** A (100, 100) and B (400, 100) in group G, C (100, 500) alone. */
const board = (extra = []) => setupScene([note(A, { x: 100, y: 100, group: G }), note(B, { x: 400, y: 100, z: 'a2', group: G }), note(C, { x: 100, y: 500, z: 'a3' }), ...extra])

/** @param {number} x container x @param {number} y container y @param {object} [props] modifiers */
const click = (x, y, props = {}) => {
	h.pointer('pointerdown', x, y, props)
	h.pointer('pointerup', x, y, props)
}

/** The model changes like a server change and the scene follows. */
const serverChange = (id, fields) => {
	h.scene.update(h.model.apply({ upserts: [{ ...structuredClone(h.model.get(id)), ...fields }] }))
}

/** @return {Array} the last setSelection call of the renderer: [localIds, remote, groups] */
const lastSelection = () => callsOf('setSelection').at(-1)

describe('selection by click, marquee, Tab and Enter', () => {
	test('AK8: a click on A → [B, A]; a second click → [A]; Shift+click on B → both off; a double click on B edits B', () => {
		h = board()
		click(200, 200)
		assert.deepEqual(h.scene.getSelection(), [B, A], 'the group, A (the hit) last')
		click(200, 200)
		assert.deepEqual(h.scene.getSelection(), [A], 'the second click: only the member')
		click(200, 200)
		assert.deepEqual(h.scene.getSelection(), [A], 'selection [A]: stays')
		click(200, 600)
		click(200, 200)
		assert.deepEqual(h.scene.getSelection(), [B, A])
		click(500, 200, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [], 'Shift on a member: the group leaves whole')
		click(200, 600)
		click(500, 200, { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [C, A, B], 'Shift on a member of an unselected group: it joins whole, the hit last')
		click(200, 600)
		click(500, 200)
		click(500, 200)
		dispatch(h.container, 'dblclick', { clientX: 500, clientY: 200, button: 0 })
		assert.equal(h.scene.stats().editing, B, 'first click the group, second B, then the editor')
	})

	test('AK8: a click into a mixed selection selects the group on release; a drag moves the selection', () => {
		h = board()
		h.scene.setSelection([A, C])
		click(200, 200)
		assert.deepEqual(h.scene.getSelection(), [B, A], 'X selected, else: M with X last')
	})

	test('AK8: the marquee over A alone takes A and B; locked members stay out', () => {
		h = board()
		h.pointer('pointerdown', 50, 50)
		h.pointer('pointermove', 150, 150)
		h.pointer('pointermove', 250, 250)
		h.pointer('pointerup', 250, 250)
		assert.deepEqual(h.scene.getSelection().sort(), [A, B])
		serverChange(B, { lock: LOCK })
		h.scene.setSelection([])
		h.pointer('pointerdown', 50, 50)
		h.pointer('pointermove', 150, 150)
		h.pointer('pointermove', 250, 250)
		h.pointer('pointerup', 250, 250)
		assert.deepEqual(h.scene.getSelection(), [A], 'the locked B is left out (023)')
	})

	test('AK8: Tab on A → [B, A], the next Tab skips B; Shift+Tab reaches B as the current item; Enter edits the current item', () => {
		h = board()
		h.focusCanvas()
		h.key('Tab')
		assert.deepEqual(h.scene.getSelection(), [B, A])
		h.key('Tab')
		assert.deepEqual(h.scene.getSelection(), [C], 'B was skipped')
		h.key('Tab', { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A, B], 'B is the current item now')
		h.key('Tab', { shiftKey: true })
		assert.deepEqual(h.scene.getSelection(), [A, B], 'A skipped, nothing before it: Tab leaves the canvas')
		h.scene.setSelection([B, A])
		h.focusCanvas()
		h.key('Enter')
		assert.equal(h.scene.stats().editing, A, 'exactly one group: Enter edits the current item')
		assert.deepEqual(h.scene.getSelection(), [A], 'narrowed like the second click')
	})

	test('round 1 (UX B2): group {A, B, C} in a row – Tab, Enter, Esc, Tab, Enter edits B; once more edits C; every member by keyboard', () => {
		const D = '01JA0000000000000000000004'
		h = setupScene([
			note(A, { x: 100, y: 100, z: 'a1', group: G }), note(B, { x: 400, y: 100, z: 'a2', group: G }), note(C, { x: 700, y: 100, z: 'a3', group: G }),
			note(D, { x: 100, y: 500, z: 'a4' }),
		])
		const esc = () => {
			const ta = h.dom.doc.activeElement
			assert.equal(ta?.tagName, 'TEXTAREA', 'the editor has the focus')
			h.key('Escape', { target: ta })
			assert.equal(h.scene.stats().editing, null)
			assert.equal(h.dom.doc.activeElement, h.container, 'focus back on the canvas')
		}
		h.focusCanvas()
		h.key('Tab')
		assert.deepEqual(h.scene.getSelection(), [B, C, A], 'Tab selects like a click: the group, A current')
		h.key('Enter')
		assert.deepEqual([h.scene.stats().editing, h.scene.getSelection()], [A, [A]])
		esc()
		for (const [id, sel] of [[B, [A, C, B]], [C, [A, B, C]]]) {
			h.key('Tab')
			assert.deepEqual(h.scene.getSelection(), sel, 'the next member is reached, its group selected')
			h.key('Enter')
			assert.deepEqual([h.scene.stats().editing, h.scene.getSelection()], [id, [id]], 'Enter narrows and edits ' + id.slice(-1))
			esc()
		}
		h.key('Tab')
		assert.deepEqual(h.scene.getSelection(), [D], 'past the group')
	})

	test('AK8: Enter on a group whose current item is locked opens nothing; Enter on a selection that is no group as before', () => {
		h = board()
		serverChange(A, { lock: LOCK })
		h.scene.setSelection([B, A])
		h.focusCanvas()
		h.key('Enter')
		assert.equal(h.scene.stats().editing, null)
		assert.deepEqual(h.scene.getSelection(), [A], 'narrowed like the second click, no editor (as the double click)')
		h.scene.setSelection([A, C])
		h.key('Enter')
		assert.equal(h.scene.stats().editing, null)
	})
})

describe('drag, arrows, handles, outline, drop target, vote', () => {
	test('AK8: a drag of A with the group selected moves A and B (beginDrag with both); with a locked B no drag; the arrows likewise', () => {
		h = board()
		h.scene.setSelection([B, A])
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 230, 220, { ctrlKey: true })
		h.frame()
		h.pointer('pointermove', 260, 240, { ctrlKey: true })
		h.frame()
		h.pointer('pointerup', 260, 240)
		const moves = h.intents('move')
		assert.equal(moves.length, 1)
		assert.deepEqual([...moves[0].ids].sort(), [A, B])
		assert.ok(callsOf('beginDrag')[0][0].has(A) && callsOf('beginDrag')[0][0].has(B))
		h.focusCanvas()
		h.key('ArrowRight')
		assert.deepEqual([...h.intents('move')[1].ids].sort(), [A, B], 'the arrows move the group')
		serverChange(B, { lock: LOCK })
		h.scene.setSelection([B, A])
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 260, 240)
		h.frame()
		h.pointer('pointerup', 260, 240)
		assert.equal(h.intents('move').length, 2, 'no drag with a locked member')
		assert.equal(callsOf('beginDrag').length, 1)
		h.scene.setSelection([A])
		h.focusCanvas()
		h.key('ArrowRight')
		assert.equal(h.intents('move').length, 2, 'not even A alone: the group is held')
	})

	test('AK8: handles() of a whole group = exactly tl, tr, br, bl; with a locked member none; a single member its own', () => {
		h = board()
		h.scene.setSelection([B, A])
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['tl', 'tr', 'br', 'bl'])
		h.scene.setSelection([A])
		assert.ok(h.scene.handles().some((x) => x.name === 'rot'), 'one member: the handles of one note')
		serverChange(B, { lock: LOCK })
		h.scene.setSelection([B, A])
		assert.deepEqual(h.scene.handles(), [], 'no resize as a whole')
		h.scene.setSelection([A])
		assert.ok(h.scene.handles().length > 0, 'a single free member may still be resized')
	})

	test('AK8: one outline per whole group (groupOutlines 1), none at [A]; no dashed frame for exactly one group; an incoming group: null on B drops it', () => {
		const stats = KonvaRenderer.prototype.stats
		// the stub renderer counts what the scene asked it to draw (the real one counts its group Rects)
		KonvaRenderer.prototype.stats = () => ({ handles: 0, nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 0, lod: 0, visible: 0,
			draws: { static: 0, overlay: 0 }, groupOutlines: (callsOf('setSelection').at(-1)?.[2] ?? []).length })
		try {
			h = board()
			h.scene.setSelection([B, A])
			assert.deepEqual(lastSelection().slice(0, 1).concat([lastSelection()[2]]), [[], [[A, B]]], 'the members have no outline of their own')
			assert.equal(h.scene.stats().groupOutlines, 1)
			h.scene.handles()
			assert.equal(callsOf('setHandles').at(-1)[0].outline, null, 'exactly one group: no dashed multi-selection frame')
			h.scene.setSelection([A])
			assert.deepEqual([lastSelection()[0], lastSelection()[2]], [[A], []])
			assert.equal(h.scene.stats().groupOutlines, 0)
			h.scene.setSelection([A, B, C])
			assert.deepEqual([lastSelection()[0], lastSelection()[2]], [[C], [[A, B]]], 'C keeps its own outline')
			h.scene.handles()
			assert.notEqual(callsOf('setHandles').at(-1)[0].outline, null, 'a group plus C: the dashed frame')
			h.scene.setSelection([B, A])
			serverChange(B, { group: null })
			assert.equal(h.scene.stats().groupOutlines, 0, 'the group is gone at once')
			assert.deepEqual(lastSelection()[0], [B, A])
			h.scene.handles()
			assert.notEqual(callsOf('setHandles').at(-1)[0].outline, null, 'two items again: the dashed frame')
		} finally {
			KonvaRenderer.prototype.stats = stats
		}
		assert.equal(h.scene.stats().groupOutlines, 0, 'the stub renderer counts nothing')
	})

	test('AK8: the drop target of the dragged group over F is F (the union\'s centre, not A\'s own)', () => {
		h = setupScene([frameItem(F, { x: 600, y: 0, w: 800, h: 600 }), note(A, { x: 100, y: 100, group: G }), note(B, { x: 400, y: 100, z: 'a2', group: G })])
		h.scene.setSelection([B, A])
		h.pointer('pointerdown', 200, 200)
		h.pointer('pointermove', 300, 200, { ctrlKey: true })
		h.frame()
		h.pointer('pointermove', 550, 200, { ctrlKey: true })
		h.frame()
		// A's box 450..650 has its centre (550) left of F; the union 450..950 its centre (700) in F
		assert.equal(callsOf('setDropTarget').at(-1)[0], F)
		h.pointer('pointerup', 550, 200)
		// a member of a group that is not fully dragged keeps its parent: no drop target
		h.scene.setSelection([A])
		h.pointer('pointerdown', 550, 200)
		h.pointer('pointermove', 600, 200, { ctrlKey: true })
		h.frame()
		h.pointer('pointermove', 900, 200, { ctrlKey: true })
		h.frame()
		assert.equal(callsOf('setDropTarget').at(-1)[0], null)
		h.pointer('pointerup', 900, 200)
	})

	test('AK8: in mode vote a click on A selects nothing and votes for A only', () => {
		h = setupScene([note(A, { x: 0, y: 0, group: G }), note(B, { x: 300, y: 0, z: 'a2', group: G })], { scene: { mode: 'vote' } })
		h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: true, color: '#c62828' })
		h.frame()
		h.log.length = 0
		click(100, 100)
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['vote', A]])
		assert.deepEqual(h.scene.getSelection(), [])
	})
})
