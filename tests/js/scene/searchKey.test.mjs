/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 271, AK4: Ctrl/⌘+F asks for the board search (onSearch) with
 * preventDefault, in every mode, outside text fields, the editor and dialogs.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'

let h
afterEach(() => {
	h?.scene.destroy()
	h = null
})

const asked = () => h.log.filter((e) => e[0] === 'onSearch').length

test('AK4: Ctrl+F and ⌘+F call onSearch once with preventDefault, also without the canvas focus; no intent, selection stays', () => {
	h = setupScene([note(A)])
	h.scene.setSelection([A])
	h.focusCanvas()
	h.log.length = 0
	assert.equal(h.key('f', { ctrlKey: true }).defaultPrevented, true)
	assert.equal(h.key('F', { metaKey: true }).defaultPrevented, true)
	assert.equal(h.key('f', { ctrlKey: true, target: h.dom.doc.body }).defaultPrevented, true)
	assert.equal(asked(), 3)
	assert.deepEqual(h.intents(), [])
	assert.deepEqual(h.scene.getSelection(), [A])
})

test('AK4: modes vote and view and a view-only scene still search', () => {
	h = setupScene([note(A)])
	for (const mode of ['vote', 'view']) {
		h.scene.setMode(mode)
		h.focusCanvas()
		assert.equal(h.key('f', { ctrlKey: true }).defaultPrevented, true, mode)
	}
	h.scene.setMode('edit')
	h.scene.setViewOnly(true)
	assert.equal(h.key('f', { metaKey: true }).defaultPrevented, true)
	assert.equal(asked(), 3)
})

test('AK4: no call and no preventDefault in a text field, the editor, with Alt or Shift, on auto-repeat, without Ctrl/⌘', () => {
	h = setupScene([note(A)])
	const events = []
	const input = h.dom.doc.createElement('input')
	h.dom.doc.body.appendChild(input)
	events.push(h.key('f', { ctrlKey: true, target: input }))
	h.focusCanvas()
	events.push(h.key('f', { ctrlKey: true, altKey: true }))
	events.push(h.key('f', { ctrlKey: true, shiftKey: true }))
	events.push(h.key('f'))
	assert.equal(h.scene.openTextEditor(A), true)
	const ta = h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor'))
	assert.ok(ta, 'editor open')
	events.push(h.key('f', { ctrlKey: true, target: ta }))
	assert.deepEqual(events.map((e) => e.defaultPrevented), events.map(() => false))
	assert.equal(asked(), 0)
	// auto-repeat: the browser search stays off, no second call
	h.scene.closeTextEditor?.()
	h.focusCanvas()
	assert.equal(h.key('f', { ctrlKey: true, repeat: true }).defaultPrevented, true)
	assert.equal(asked(), 0)
})

test('AK4: isSearchKey, the board view\'s capture rule: Ctrl/⌘+F outside text fields, without Alt and Shift', async () => {
	const { isSearchKey } = await import('../../../src/scene/InputController.js')
	h = setupScene([note(A)])
	const input = h.dom.doc.createElement('input')
	h.dom.doc.body.appendChild(input)
	const ev = (o) => ({ key: 'f', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, target: h.dom.doc.body, ...o })
	assert.equal(isSearchKey(ev({ ctrlKey: true })), true)
	assert.equal(isSearchKey(ev({ metaKey: true, key: 'F' })), true)
	assert.equal(isSearchKey(ev({})), false)
	assert.equal(isSearchKey(ev({ ctrlKey: true, altKey: true })), false)
	assert.equal(isSearchKey(ev({ ctrlKey: true, shiftKey: true })), false)
	assert.equal(isSearchKey(ev({ ctrlKey: true, isComposing: true })), false)
	assert.equal(isSearchKey(ev({ ctrlKey: true, target: input })), false)
	assert.equal(isSearchKey(ev({ ctrlKey: true, key: 'g' })), false)
	assert.equal(isSearchKey(null), false)
})
