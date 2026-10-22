/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Text editor v2 (SPEC-M1 §6.3 "Text-Editor", §6.8, §1.4 "Serien-Eingabe",
 * rule 13), deterministic in Node on the fake DOM:
 * - data-knorke-editor-kind = note | title | shape | text from the registry
 *   (`editor`); layout inline !important, look (background, border, shadow,
 *   outline, color) inline without priority so [C]'s CSS can style each kind
 * - series entry: Tab in a NOTE editor ends it like a final commit with
 *   next:'right'; the session opens the next editor from inside that intent
 *   and it opens right after the close (isActive of the old item still true
 *   during the intent); Esc ends without next
 * - Shift+Tab, and Tab in other kinds, commit and return the focus to the
 *   canvas; Esc and Ctrl+Enter too; a blur (click elsewhere) does not steal
 *   the focus
 * - text intents of a `text` item carry h, its measured height for the new
 *   text; the text editor grows with the text
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { fakeTextHeight, frameItem, note, setupScene, shapeItem, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const F = '01JA0000000000000000000009'

let h
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
})

/** @return {object|null} the open textarea */
const editorEl = () => {
	const ta = h.dom.doc.activeElement
	return ta && ta.tagName === 'TEXTAREA' ? ta : null
}

/**
 * @param {string} text typed text (replaces the value, fires input)
 */
function type(text) {
	const ta = editorEl()
	ta.value = text
	dispatch(ta, 'input', {})
}

describe('editor kinds', () => {
	test('data-knorke-editor-kind follows the registry editor of the type', () => {
		h = setupScene([note(A), frameItem(F, { x: 0, y: 400 }), shapeItem(B, { x: 400 }), textItem(C, { x: 700 })])
		const kinds = {}
		for (const id of [A, F, B, C]) {
			assert.equal(h.scene.openTextEditor(id), true)
			const ta = editorEl()
			assert.equal(ta.getAttribute('data-knorke-editor'), '')
			kinds[id] = ta.getAttribute('data-knorke-editor-kind')
			h.key('Escape', { target: ta })
		}
		assert.deepEqual(kinds, { [A]: 'note', [F]: 'title', [B]: 'shape', [C]: 'text' })
	})

	test('layout is inline !important, the look is a default without priority ([C] styles it per kind)', () => {
		h = setupScene([textItem(C, { style: { fontSize: 30, color: '#e03131', align: 'right' } })])
		const props = new Map()
		h.scene.openTextEditor(C)
		const ta = editorEl()
		const orig = ta.style.setProperty
		ta.style.setProperty = (k, v, prio) => {
			props.set(k, prio)
			orig(k, v, prio)
		}
		h.frame()
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		for (const k of ['width', 'height', 'font-size', 'transform', 'text-align']) assert.equal(props.get(k), 'important', k)
		for (const k of ['background', 'color']) assert.equal(props.get(k), '', k)
		assert.equal(ta.style.getPropertyValue('text-align'), 'right')
		assert.equal(ta.style.getPropertyValue('color'), '#e03131')
		assert.equal(ta.style.getPropertyValue('font-size'), '60px')
		assert.equal(ta.style.getPropertyValue('padding'), '0px')
	})

	test('the text editor grows with the measured text height', () => {
		h = setupScene([textItem(C, { w: 120, h: 28.8, data: { text: 'one' }, style: { fontSize: 24 } })])
		h.scene.openTextEditor(C)
		h.frame()
		assert.equal(editorEl().style.getPropertyValue('height'), '28.8px')
		type('one two three four five six')
		h.frame()
		const want = fakeTextHeight({ w: 120, style: { fontSize: 24 }, data: { text: 'one two three four five six' } })
		assert.ok(want > 28.8)
		assert.equal(editorEl().style.getPropertyValue('height'), want + 'px')
	})

	test('shape editor sits on the text box of the kind (triangle: lower half)', () => {
		h = setupScene([shapeItem(B, { x: 100, y: 100, w: 200, h: 200, data: { kind: 'triangle', text: 'x' } })])
		h.scene.openTextEditor(B)
		h.frame()
		const ta = editorEl()
		// text box [0.25, 0.5, 0.5, 0.45] × 200 → (150, 200, 100, 90)
		assert.equal(ta.style.getPropertyValue('transform'), 'translate(150px, 200px)')
		assert.equal(ta.style.getPropertyValue('width'), '100px')
		assert.equal(ta.style.getPropertyValue('height'), '90px')
		assert.equal(ta.style.getPropertyValue('text-align'), 'center')
	})
})

describe('series entry (Tab in a note)', () => {
	test('Tab → final intent with next:right; the next editor opened from inside it opens after the close', () => {
		const seen = []
		h = setupScene([note(A)], {
			on: {
				onIntent: (i) => {
					if (i.type !== 'text' || !i.final) return
					seen.push(['final', i.next ?? null, h.scene.isActive(A)])
					if (i.next === 'right') {
						// the session: create the next note, open its editor (synchronously, inside the intent)
						h.scene.update(h.model.apply({ upserts: [note(B, { x: 220 })] }))
						seen.push(['open', h.scene.openTextEditor(B)])
					}
				},
			},
		})
		h.scene.openTextEditor(A)
		type('first')
		const e = h.key('Tab', { target: editorEl() })
		assert.ok(e.defaultPrevented)
		assert.deepEqual(seen, [['final', 'right', true], ['open', true]])
		assert.equal(h.scene.stats().editing, B)
		assert.equal(editorEl()?.getAttribute('data-knorke-editor-kind'), 'note', 'focus in the new editor')
		const order = h.log.filter((x) => x[0] === 'onEditing').map((x) => x[1])
		assert.deepEqual(order, [A, null, B], 'old editor closed before the new one opened')
		const finals = h.intents('text').filter((i) => i.final)
		assert.deepEqual(finals.map((i) => [i.id, i.value, i.next]), [[A, 'first', 'right']])
	})

	test('Tab with an unchanged text still sends the final intent (the session needs next)', () => {
		h = setupScene([note(A, { data: { text: '' } })])
		h.scene.openTextEditor(A)
		h.key('Tab', { target: editorEl() })
		assert.deepEqual(h.intents('text').map((i) => [i.value, i.final, i.next]), [['', true, 'right']])
	})

	test('Esc ends without next and puts the focus on the canvas', () => {
		h = setupScene([note(A)])
		h.scene.openTextEditor(A)
		type('done')
		h.key('Escape', { target: editorEl() })
		const t = h.intents('text')
		assert.equal(t.at(-1).next, undefined)
		assert.equal(h.dom.doc.activeElement, h.container)
	})

	test('Shift+Tab in a note, Tab in a shape: commit without next, focus on the canvas', () => {
		h = setupScene([note(A), shapeItem(B, { x: 400 })])
		for (const [id, shift] of [[A, true], [B, false]]) {
			h.scene.openTextEditor(id)
			type('t-' + id.slice(-1))
			const e = h.key('Tab', { target: editorEl(), shiftKey: shift })
			assert.ok(e.defaultPrevented)
			assert.equal(h.scene.stats().editing, null)
			assert.equal(h.dom.doc.activeElement, h.container, 'focus back on the canvas')
		}
		assert.deepEqual(h.intents('text').filter((i) => i.final).map((i) => i.next), [undefined, undefined])
	})

	test('a blur (click on a toolbar button) commits but leaves the focus where it went', () => {
		h = setupScene([note(A)])
		const btn = h.dom.doc.createElement('button')
		h.dom.doc.body.appendChild(btn)
		h.scene.openTextEditor(A)
		type('x')
		btn.focus()
		assert.equal(h.scene.stats().editing, null)
		assert.equal(h.dom.doc.activeElement, btn)
		assert.equal(h.intents('text').at(-1).final, true)
	})

	test('a notice editor: Tab discards like any close, no next note', () => {
		h = setupScene([note(A)])
		h.scene.openTextEditor(A, { text: 'rescued', notice: 'Copy your text.' })
		h.key('Tab', { target: editorEl() })
		assert.deepEqual(h.intents('text'), [])
		assert.equal(h.scene.stats().editing, null)
	})
})

describe('text items: h in the text intent (rule 13)', () => {
	test('intermediate and final text intents of a text item carry the measured height', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		h = setupScene([textItem(C, { w: 100, data: { text: '' }, style: { fontSize: 20 } })])
		h.scene.openTextEditor(C)
		type('alpha beta gamma delta')
		mock.timers.tick(1000)
		h.key('Enter', { target: editorEl(), ctrlKey: true })
		const t = h.intents('text')
		assert.ok(t.length >= 2)
		const want = fakeTextHeight({ w: 100, style: { fontSize: 20 }, data: { text: 'alpha beta gamma delta' } })
		for (const i of t) assert.equal(i.h, want)
		assert.equal(h.dom.doc.activeElement, h.container, 'Ctrl+Enter ends by key')
	})

	test('notes and shapes get no h', () => {
		h = setupScene([note(A), shapeItem(B, { x: 400 })])
		for (const id of [A, B]) {
			h.scene.openTextEditor(id)
			type('abc')
			h.key('Escape', { target: editorEl() })
		}
		assert.ok(h.intents('text').every((i) => !('h' in i)))
	})

	test('measureTextHeight: the renderer measures; a stub without answer falls back to item.h', () => {
		h = setupScene([textItem(C)])
		assert.equal(h.scene.measureTextHeight({ ...h.model.get(C), data: { text: 'a\nb\nc' } }), 3 * 24 * 1.2)
	})
})
