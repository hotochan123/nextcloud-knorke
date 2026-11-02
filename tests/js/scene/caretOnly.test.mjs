/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Only the caret while writing (job 150), deterministic in Node on the fake
 * DOM with the real SceneManager, InputController, TextEditor and
 * SceneModel (renderer stubbed; the renderer's setSelection(localIds,
 * remote, groups) calls are what the scene asks it to draw):
 * - AK1 note, shape, text item, frame (title) and connector (label), each
 *   selected alone: right after openTextEditor(id) the last setSelection
 *   has no id in its local list while the selection stays; after Esc in the
 *   text field it is there again and handles() has the full set again
 *   (with plus-* for note, shape and text); the rescue editor (notice) shows
 *   no outline either; the title editor's inline background is transparent
 * - AK2 another participant's selection of A stays while A's editor is open,
 *   in their colour
 * - AK3 a selection [A, B] with the editor on A draws only B; a fully
 *   selected group G1/G2 with the editor on G1 draws no group outline and no
 *   member outline, after Esc the group outline is back
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, frameItem, note, setupScene, shapeItem, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const S = '01JA0000000000000000000003'
const T = '01JA0000000000000000000004'
const F = '01JA0000000000000000000009'
const C1 = '01JA00000000000000000000C1'
const G = '01JG0000000000000000000001'

let h
afterEach(() => {
	h?.restore()
	h = null
})

/** A connector from A to B. */
const conn = () => ({ id: C1, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b1', parent: null, data: { start: { item: A }, end: { item: B }, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' } })

/** Note A, note B, shape S, text item T, frame F and the connector A → B. */
const board = () => setupScene([
	note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 }), shapeItem(S, { x: 100, y: 500 }), textItem(T, { x: 500, y: 500 }),
	frameItem(F, { x: 0, y: 1000 }), conn(),
])

/** @return {Array} the last setSelection call of the renderer: [localIds, remote, groups] */
const lastSelection = () => callsOf('setSelection').at(-1)

/** The open editor's textarea. */
const editorArea = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))

/** Esc in the open editor's text field. */
const escape = () => h.key('Escape', { target: editorArea() })

const selectionEvents = () => h.log.filter((e) => e[0] === 'onSelection').length

describe('AK1 no own outline while the editor is open, back after it', () => {
	for (const [kind, id] of [['note', A], ['shape', S], ['text item', T], ['frame title', F], ['connector label', C1]]) {
		test(`${kind}: the outline goes with openTextEditor (no frame needed), the selection stays; after Esc outline and the full handle set are back`, () => {
			h = board()
			h.scene.setSelection([id])
			h.frame()
			assert.deepEqual(lastSelection()[0], [id], 'selected: its own outline')
			const full = h.scene.handles().map((x) => x.name)
			assert.ok(full.length > 0, 'handles while not editing')
			if (id === A || id === S) assert.ok(['plus-t', 'plus-r', 'plus-b', 'plus-l'].every((n) => full.includes(n)), 'with the "+" handles')
			// (job 231) a text item's sides l/r take the place of plus-l/plus-r
			if (id === T) assert.ok(['plus-t', 'plus-b', 'l', 'r'].every((n) => full.includes(n)) && !full.includes('plus-r'), 'with its points t/b and sides')
			h.log.length = 0
			assert.equal(h.scene.openTextEditor(id), true)
			assert.deepEqual(lastSelection()[0], [], 'no own outline, at once')
			assert.deepEqual(h.scene.getSelection(), [id], 'the selection stays')
			assert.deepEqual(h.scene.handles(), [], 'no handles (job 148)')
			h.frame()
			assert.deepEqual(lastSelection()[0], [], 'still none after a frame')
			escape()
			assert.equal(h.scene.stats().editing, null, 'the editor closed')
			assert.deepEqual(h.scene.getSelection(), [id], 'still selected')
			assert.deepEqual(lastSelection()[0], [id], 'its own outline is back')
			assert.deepEqual(h.scene.handles().map((x) => x.name), full, 'the full handle set again')
			assert.equal(selectionEvents(), 0, 'the selection never changed')
		})
	}

	test('the rescue editor (with a notice) draws no own outline either; closing brings it back', () => {
		h = board()
		h.scene.setSelection([A])
		assert.equal(h.scene.openTextEditor(A, { text: 'rescued', notice: 'Your text could not be saved.' }), true)
		assert.deepEqual(lastSelection()[0], [])
		escape()
		assert.deepEqual(lastSelection()[0], [A])
	})

	test('the frame title editor gets no white background inline (transparent, like shape and text)', () => {
		h = board()
		h.scene.setSelection([F])
		h.scene.openTextEditor(F)
		h.frame()
		const ta = editorArea()
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'title')
		assert.equal(ta.style.getPropertyValue('background'), 'transparent')
	})

	test('a connector label keeps its inline background (BOARD_BACKGROUND)', () => {
		h = board()
		h.scene.setSelection([C1])
		h.scene.openTextEditor(C1)
		h.frame()
		const ta = editorArea()
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'label')
		assert.notEqual(ta.style.getPropertyValue('background'), 'transparent')
	})
})

describe('AK2 other people\'s selections stay', () => {
	test('bob\'s selection of A is still drawn in his colour while A\'s editor is open', () => {
		h = board()
		const BOB = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#2e7d32', guest: false, cursor: null, selection: [A], drag: [], editing: null, editingHolder: false, view: null }
		h.scene.setRemoteSampler(() => [BOB])
		h.frame()
		assert.deepEqual(lastSelection()[1], [{ ids: [A], color: BOB.color }], 'bob\'s selection of A')
		h.scene.setSelection([A])
		assert.equal(h.scene.openTextEditor(A), true)
		h.frame()
		const [local, remote] = lastSelection()
		assert.deepEqual(local, [], 'no own outline')
		assert.deepEqual(remote, [{ ids: [A], color: BOB.color }], 'bob\'s outline of A stays, in his colour')
		escape()
		assert.deepEqual(lastSelection()[0], [A])
		assert.deepEqual(lastSelection()[1], [{ ids: [A], color: BOB.color }])
	})
})

describe('AK3 the rest of the selection', () => {
	test('selection [A, B], editor on A: only B keeps its outline; after Esc both', () => {
		h = board()
		h.scene.setSelection([A, B])
		assert.deepEqual(lastSelection()[0], [A, B])
		assert.equal(h.scene.openTextEditor(A), true)
		assert.deepEqual(lastSelection()[0], [B])
		assert.deepEqual(h.scene.getSelection(), [A, B])
		escape()
		assert.deepEqual(lastSelection()[0], [A, B])
	})

	test('a fully selected group G1/G2, editor on G1: no group outline and no member outline; after Esc the group outline is back', () => {
		const G1 = '01JA0000000000000000000011'
		const G2 = '01JA0000000000000000000012'
		h = setupScene([note(G1, { x: 100, y: 100, group: G }), note(G2, { x: 400, y: 100, z: 'a2', group: G })])
		h.scene.setSelection([G1, G2])
		assert.deepEqual([lastSelection()[0], lastSelection()[2]], [[], [[G1, G2]]], 'one group outline')
		assert.equal(h.scene.openTextEditor(G1), true)
		const [local, , groups] = lastSelection()
		assert.deepEqual(groups, [], 'no group outline while G1 is edited')
		assert.ok(!local.includes(G1) && !local.includes(G2), 'no member gets its own outline')
		assert.deepEqual(h.scene.getSelection(), [G1, G2], 'the selection stays')
		escape()
		assert.deepEqual([lastSelection()[0], lastSelection()[2]], [[], [[G1, G2]]], 'the group outline is back')
	})
})
