/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 279 (AK6): the text editor's Markdown – Ctrl/⌘+B and
 * Ctrl/⌘+I (the browser's own prevented), format() of the context bar's B,
 * I, S and list button with the selection, nothing beyond maxLength, nothing
 * in a kind without Markdown (a frame title), nothing under a notice.
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, installDom } from './fakeDom.mjs'
import { RICH_KINDS, TextEditor } from '../../../src/scene/TextEditor.js'

describe('job 279 AK6: the editor formats', () => {
	let dom
	let ed
	let inputs
	beforeEach(() => {
		dom = installDom()
		const root = dom.doc.createElement('div')
		dom.doc.body.appendChild(root)
		inputs = 0
		ed = new TextEditor(root, { onIntent: () => {}, onClose: () => {}, onInput: () => inputs++, setTimer: () => 0, clearTimer: () => {} })
	})

	const open = (kind, value, maxLength = 5000) => {
		ed.open({ id: 'N', path: kind === 'title' ? 'data.title' : 'data.text', kind, value, before: value, maxLength })
		const ta = ed.element
		ta.selectionStart = 0
		ta.selectionEnd = 0
		ta.setSelectionRange = (a, b) => {
			ta.selectionStart = a
			ta.selectionEnd = b
		}
		return ta
	}

	test('the kinds with Markdown', () => {
		assert.deepEqual([...RICH_KINDS], ['note', 'shape', 'text', 'cell'])
	})

	test('Ctrl+B and ⌘+I around the selection; the browser\'s own is prevented', () => {
		const ta = open('note', 'ab cd')
		ta.setSelectionRange(3, 5)
		assert.equal(dispatch(ta, 'keydown', { key: 'b', ctrlKey: true }).defaultPrevented, true, 'preventDefault')
		assert.equal(ta.value, 'ab **cd**')
		assert.deepEqual([ta.selectionStart, ta.selectionEnd], [5, 7])
		assert.equal(inputs, 1, 'through the input path')
		assert.equal(dispatch(ta, 'keydown', { key: 'I', metaKey: true }).defaultPrevented, true)
		assert.equal(ta.value, 'ab ***cd***')
		ta.setSelectionRange(0, 0)
		dispatch(ta, 'keydown', { key: 'b', ctrlKey: true, shiftKey: true })
		assert.equal(ta.value, 'ab ***cd***', 'Ctrl+Shift+B does nothing here')
	})

	test('format(): strike and list, in a cell too', () => {
		const ta = open('cell', 'x\ny')
		ta.setSelectionRange(0, 3)
		assert.equal(ed.format('list'), true)
		assert.equal(ta.value, '- x\n- y')
		ta.setSelectionRange(2, 3)
		assert.equal(ed.format('strike'), true)
		assert.equal(ta.value, '- ~~x~~\n- y')
		assert.equal(ed.format('nonsense'), false)
	})

	test('nothing beyond maxLength, in a frame title or under a notice', () => {
		let ta = open('note', 'abcd', 5)
		ta.setSelectionRange(0, 4)
		assert.equal(ed.format('bold'), false)
		assert.equal(ta.value, 'abcd')
		ed.discard()
		ta = open('title', 'Titel')
		ta.setSelectionRange(0, 5)
		assert.equal(dispatch(ta, 'keydown', { key: 'b', ctrlKey: true }).defaultPrevented, false, 'not prevented in a title')
		assert.equal(ed.format('bold'), false)
		assert.equal(ta.value, 'Titel')
		ed.discard()
		ta = open('note', 'abc')
		ed.setNotice('Not saved')
		ta.setSelectionRange(0, 3)
		assert.equal(ed.format('bold'), false)
		assert.equal(ta.value, 'abc')
	})
})
