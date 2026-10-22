/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SceneManager.flushEditor() / TextEditor.flush() (SPEC-M0 §6.3, R4 review
 * finding T5), deterministic in Node: the real SceneManager, TextEditor,
 * CursorLayer, InputController and SceneModel on the fake DOM, with mocked
 * setTimeout; only the Konva renderer is stubbed.
 *
 * Regression pinned here (E14 red on NC 34 and 35): a reload or close by
 * keyboard fires no blur. The session calls scene.flushEditor() first in
 * visibilitychange(hidden), pagehide, beforeunload and prepareLeave, but the
 * scene had no such method, the session's typeof guard made the call a silent
 * no-op, and only the leading-edge 1 Hz commit ('n' of 'neu geladen …')
 * reached the server; everything typed in the last < 1 s was lost.
 *
 * Contract (§6.3): an open editor without a notice whose text differs from
 * the last reported value clears its 1 Hz timer, reports the current text
 * SYNCHRONOUSLY as {type:'text', …, final:false} and returns true. Otherwise
 * false and nothing is reported. Never closes the editor, never moves the
 * focus, never touches an editor with a notice.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, installDom } from './fakeDom.mjs'
import { KonvaRenderer } from '../../../src/scene/KonvaRenderer.js'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { TextEditor, COMMIT_INTERVAL_MS } from '../../../src/scene/TextEditor.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const N = '01JA0000000000000000000003'
const F = '01JA0000000000000000000005'
const NOTICE = 'Not saved: Alice Adler is editing this item. Copy your text before closing.'

/** Replaces every KonvaRenderer member with an inert stub (no canvas in Node). */
function stubRenderer() {
	const proto = KonvaRenderer.prototype
	const defaults = {
		hasDirty: () => false,
		stats: () => ({ nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 0, lod: 0, visible: 0, draws: { static: 0, overlay: 0 } }),
	}
	for (const name of Object.getOwnPropertyNames(proto)) {
		if (name === 'constructor') continue
		const d = Object.getOwnPropertyDescriptor(proto, name)
		if (typeof d.value === 'function') {
			Object.defineProperty(proto, name, { configurable: true, writable: true, value: defaults[name] ?? (() => {}) })
		}
	}
	const content = new WeakMap()
	Object.defineProperty(proto, 'contentEl', {
		configurable: true,
		get() {
			if (!content.has(this)) content.set(this, { style: {} })
			return content.get(this)
		},
	})
	Object.defineProperty(proto, 'cssTransform', { configurable: true, get: () => null })
	Object.defineProperty(proto, 'stage', { configurable: true, get: () => null })
}
stubRenderer()

const sticky = (id, text) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a0', parent: null, data: { text }, style: { fill: '#a8d8f8' } })
const frame = (id, title) => ({ id, t: 'frame', x: 400, y: 0, w: 600, h: 400, r: 0, z: 'Zz', parent: null, data: { title }, style: { fill: '#ffffff' } })

describe('SceneManager.flushEditor (T5)', () => {
	let dom
	let h

	beforeEach(() => {
		dom = installDom()
		mock.timers.enable({ apis: ['setTimeout'] })
		const container = dom.doc.createElement('div')
		container.clientWidth = 1000
		container.clientHeight = 800
		dom.doc.body.appendChild(container)
		const model = new SceneModel()
		model.load([sticky(N, 'start'), frame(F, 'Titel')])
		const log = []
		const scene = new SceneManager(container, model, {
			limits: { maxText: 6000, maxTitle: 200 },
			callbacks: {
				onIntent: (i) => log.push(['intent', i]),
				onEditing: (id, takeover) => log.push(['editing', id, takeover]),
				onActivity: (a) => log.push(['activity', a.kind, a.active]),
			},
		})
		scene.mount()
		dom.frame()
		h = {
			container,
			model,
			scene,
			log,
			editor: () => container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null,
			/** Replaces the text as one input event (Ctrl+A + type / insertText). */
			type(text) {
				const ta = h.editor()
				ta.value = text
				dispatch(ta, 'input')
			},
			texts: () => log.filter((e) => e[0] === 'intent' && e[1].type === 'text').map((e) => e[1]),
		}
	})

	afterEach(() => {
		h.scene.destroy()
		mock.timers.reset()
		dom.restore()
	})

	test('E14 shape: leading-edge commit of the first character, rest typed < 1 s later → flushEditor reports the full text synchronously and cancels the 1 Hz commit', () => {
		assert.equal(h.scene.openTextEditor(N), true)
		const ta = h.editor()
		h.type('n')
		mock.timers.tick(0)
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['n', false]], 'leading edge of the 1 Hz commits')
		mock.timers.tick(150)
		h.type('neu geladen abc')
		assert.equal(h.texts().length, 1, 'the rest waits for the 1 Hz timer')

		const before = h.log.length
		assert.equal(h.scene.flushEditor(), true)
		// synchronous: the intent is there when the call returns (the session's
		// beforeunload checks pendingCount() right after it)
		assert.equal(h.log.length, before + 1)
		const last = h.texts().at(-1)
		assert.deepEqual(last, { type: 'text', id: N, path: 'data.text', value: 'neu geladen abc', before: 'start', final: false })

		// editor untouched: open, focused, active; no close reported
		assert.equal(h.editor(), ta, 'same editor still open')
		assert.equal(ta.isConnected, true)
		assert.equal(dom.doc.activeElement, ta, 'focus not moved')
		assert.equal(h.scene.isActive(N), true)
		assert.deepEqual(h.log.filter((e) => e[0] !== 'intent'), [['editing', N, false], ['activity', 'edit', true]], 'no onEditing(null) / edit end')

		mock.timers.tick(5 * COMMIT_INTERVAL_MS)
		assert.equal(h.texts().length, 2, 'the cancelled 1 Hz commit does not repeat the text')
	})

	test('a second call without new input returns false and reports nothing', () => {
		h.scene.openTextEditor(N)
		h.type('abc')
		assert.equal(h.scene.flushEditor(), true)
		const n = h.log.length
		assert.equal(h.scene.flushEditor(), false)
		assert.equal(h.scene.flushEditor(), false)
		assert.equal(h.log.length, n)
	})

	test('after a flush, typing resumes the 1 Hz pace from the flush; Esc ends with the final commit', () => {
		h.scene.openTextEditor(N)
		h.type('a')
		assert.equal(h.scene.flushEditor(), true)
		h.type('ab')
		mock.timers.tick(COMMIT_INTERVAL_MS - 1)
		assert.deepEqual(h.texts().map((x) => x.value), ['a'], 'no commit before the interval since the flush')
		mock.timers.tick(1)
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['a', false], ['ab', false]])
		h.type('abc')
		assert.equal(h.scene.flushEditor(), true)
		dispatch(h.editor(), 'keydown', { key: 'Escape' })
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['a', false], ['ab', false], ['abc', false], ['abc', true]])
		assert.equal(h.editor(), null)
	})

	test('no editor, nothing typed, or the 1 Hz commit already carried the text → false', () => {
		assert.equal(h.scene.flushEditor(), false, 'no editor')
		h.scene.openTextEditor(N)
		assert.equal(h.scene.flushEditor(), false, 'unchanged since opening')
		h.type('xyz')
		mock.timers.tick(0)
		assert.equal(h.texts().length, 1)
		assert.equal(h.scene.flushEditor(), false, 'already reported by the 1 Hz commit')
		h.type('start')
		assert.equal(h.scene.flushEditor(), true, 'back to the model text is still new input (differs from the last report)')
		assert.deepEqual(h.texts().at(-1), { type: 'text', id: N, path: 'data.text', value: 'start', before: 'start', final: false })
	})

	test('an editor with a notice is never touched: false, no intent, notice and text stay, nothing committed later', () => {
		h.scene.openTextEditor(N, { text: 'rescued text', notice: NOTICE })
		const ta = h.editor()
		h.type('rescued text plus')
		assert.equal(h.scene.flushEditor(), false)
		assert.equal(h.editor(), ta)
		assert.equal(ta.getAttribute('data-knorke-editor-state'), 'locked')
		assert.equal(ta.value, 'rescued text plus')
		mock.timers.tick(5 * COMMIT_INTERVAL_MS)
		assert.deepEqual(h.texts(), [])
	})

	test('notice lost meanwhile (setEditorNotice) → the flush stops reporting', () => {
		h.scene.openTextEditor(N)
		h.type('mine')
		h.scene.setEditorNotice(N, NOTICE)
		assert.equal(h.scene.flushEditor(), false)
		assert.deepEqual(h.texts(), [])
		h.scene.setEditorNotice(N, null)
		assert.equal(h.scene.flushEditor(), true, 'lifted: the unreported text goes out')
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['mine', false]])
	})

	test('text rescue opened without a notice: the rescued text was never reported, so the flush reports it', () => {
		h.scene.openTextEditor(N, { text: 'rescued' })
		assert.equal(h.scene.flushEditor(), true)
		assert.deepEqual(h.texts(), [{ type: 'text', id: N, path: 'data.text', value: 'rescued', before: 'start', final: false }])
	})

	test('frame title editor: reports on data.title', () => {
		assert.equal(h.scene.openTextEditor(F), true)
		h.type('Neuer Titel')
		assert.equal(h.scene.flushEditor(), true)
		assert.deepEqual(h.texts(), [{ type: 'text', id: F, path: 'data.title', value: 'Neuer Titel', before: 'Titel', final: false }])
	})

	test('view-only switch keeps the editor; until [C] sets the notice, the flush still reports (same as the 1 Hz commit)', () => {
		h.scene.openTextEditor(N)
		h.type('typed')
		h.scene.setViewOnly(true)
		assert.ok(h.editor(), 'editor stays open (§6.3 setViewOnly)')
		assert.equal(h.scene.flushEditor(), true)
		assert.deepEqual(h.texts().map((x) => x.value), ['typed'])
	})

	test('after destroy, or before mount: false', () => {
		h.scene.openTextEditor(N)
		h.type('bye')
		h.scene.destroy()
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['bye', true]], 'destroy commits as before')
		assert.equal(h.scene.flushEditor(), false)
		const other = new SceneManager(dom.doc.createElement('div'), new SceneModel(), { callbacks: {} })
		assert.equal(other.flushEditor(), false, 'never mounted')
	})

	test('the facade method exists on the prototype (the session guards with typeof and would silently skip it)', () => {
		assert.equal(typeof SceneManager.prototype.flushEditor, 'function')
		assert.equal(typeof TextEditor.prototype.flush, 'function')
	})
})

describe('TextEditor.flush (T5)', () => {
	let dom
	beforeEach(() => {
		dom = installDom()
	})
	afterEach(() => {
		dom.restore()
	})

	function editor() {
		const root = dom.doc.createElement('div')
		dom.doc.body.appendChild(root)
		let now = 5000
		const timers = new Map()
		let next = 1
		const intents = []
		const closed = []
		const ed = new TextEditor(root, {
			onIntent: (i) => intents.push(i),
			onClose: (id) => closed.push(id),
			now: () => now,
			setTimer: (fn, ms) => {
				const id = next++
				timers.set(id, { fn, at: now + ms })
				return id
			},
			clearTimer: (id) => timers.delete(id),
		})
		const run = (ms) => {
			now += ms
			for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
				if (t.at <= now && timers.has(id)) {
					timers.delete(id)
					t.fn()
				}
			}
		}
		const input = (v) => {
			ed.element.value = v
			dispatch(ed.element, 'input')
		}
		return { ed, intents, closed, run, input, timers }
	}

	test('pending 1 Hz commit: flush emits the current text at once and clears the timer', () => {
		const e = editor()
		e.ed.open({ id: N, path: 'data.text', kind: 'note', value: '', before: '', maxLength: 100 })
		e.input('n')
		e.run(0)
		e.run(150)
		e.input('neu geladen')
		assert.equal(e.timers.size, 1, '1 Hz commit pending')
		assert.equal(e.ed.flush(), true)
		assert.equal(e.timers.size, 0, 'timer cleared')
		assert.deepEqual(e.intents.map((i) => [i.value, i.final]), [['n', false], ['neu geladen', false]])
		e.run(10 * COMMIT_INTERVAL_MS)
		assert.equal(e.intents.length, 2)
		assert.equal(e.ed.id, N, 'still open')
		assert.deepEqual(e.closed, [])
	})

	test('closed editor, no change, or a notice → false and nothing emitted', () => {
		const e = editor()
		assert.equal(e.ed.flush(), false, 'closed')
		e.ed.open({ id: N, path: 'data.text', kind: 'note', value: 'a', before: 'a', maxLength: 100 })
		assert.equal(e.ed.flush(), false, 'unchanged')
		e.input('ab')
		e.ed.setNotice(NOTICE)
		assert.equal(e.ed.flush(), false, 'notice')
		assert.equal(e.ed.notice, NOTICE)
		assert.deepEqual(e.intents, [])
		e.ed.discard()
		assert.equal(e.ed.flush(), false, 'discarded')
		assert.deepEqual(e.intents, [])
	})

	test('finish after a flush still ends with the final commit of the same text', () => {
		const e = editor()
		e.ed.open({ id: N, path: 'data.text', kind: 'note', value: 'a', before: 'a', maxLength: 100 })
		e.input('abc')
		assert.equal(e.ed.flush(), true)
		e.ed.finish()
		assert.deepEqual(e.intents.map((i) => [i.value, i.final]), [['abc', false], ['abc', true]])
		assert.deepEqual(e.closed, [N])
	})
})
