/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Text-lease take-over path of the scene (SPEC-M0 §4.11, §6.3, §6.8; E04b),
 * deterministic in Node: the real SceneManager, CursorLayer, TextEditor,
 * InputController and SceneModel on a minimal fake DOM (fakeDom.mjs) with a
 * manual animation-frame queue and mocked setTimeout. Only the Konva renderer
 * is stubbed (no canvas in Node).
 *
 * Pinned here:
 * - E04b at the scene boundary: a double click on a held item opens no editor
 *   and offers "Take over"; the click reports onEditing(id, true) exactly once
 *   BEFORE anything else, and Esc then gives the final text intent followed by
 *   onEditing(null, false). Whatever the session does with tk after that is
 *   the session's business (§6.3 facade).
 * - regression: a "Take over" click for an item whose editor is already open
 *   (the button outlives the offer until the next frame; a text rescue can
 *   open the editor with a notice in between) used to return early: no
 *   onEditing(id, true), the notice stayed, and Esc discarded the text.
 * - TextEditor: lifting a notice resumes the 1 Hz intermediate commits; a
 *   closed editor never leaves a pending commit for the next one.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, installDom } from './fakeDom.mjs'
import { KonvaRenderer } from '../../../src/scene/KonvaRenderer.js'
import { SceneManager, TAKE_OVER_MS } from '../../../src/scene/SceneManager.js'
import { TextEditor, COMMIT_INTERVAL_MS } from '../../../src/scene/TextEditor.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const N = '01JA0000000000000000000003'
const M = '01JA0000000000000000000004'
const NOTICE = 'Not saved: Alice Adler is editing this item. Copy your text before closing.'

/** Replaces every KonvaRenderer member with an inert stub (the scene logic under test never needs pixels). */
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

/**
 * @param {string} id item id
 * @param {number} x world x
 * @param {string} text note text
 * @return {object} sticky WireItem
 */
const sticky = (id, x, text) => ({ id, t: 'sticky', x, y: 0, w: 200, h: 200, r: 0, z: 'i' + x / 300, parent: null, data: { text }, style: { fill: '#a8d8f8' } })

const ALICE = { key: 'pidalice:c1', pid: 'pidalice', name: 'Alice Adler', color: '#c62828', guest: false, cursor: null, selection: [], drag: [], editing: N, editingHolder: true }

let dom
let h

beforeEach(() => {
	dom = installDom()
	mock.timers.enable({ apis: ['setTimeout'] })
	h = setup()
})

afterEach(() => {
	h.scene.destroy()
	mock.timers.reset()
	dom.restore()
})

function setup() {
	const container = dom.doc.createElement('div')
	container.clientWidth = 1000
	container.clientHeight = 800
	dom.doc.body.appendChild(container)
	const model = new SceneModel()
	model.load([sticky(N, 0, 'alice text'), sticky(M, 300, 'm text')])
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
	let samples = []
	scene.setRemoteSampler(() => samples)
	dom.frame()
	return {
		container,
		model,
		scene,
		log,
		setSamples(s) {
			samples = s
			scene.presenceChanged()
			dom.frame()
		},
		/** Mouse double click on the centre of an item (pointer pairs, then dblclick, as Chromium sends them). */
		dblclick(id) {
			const c = scene.worldToScreen(model.abs(id).x + 100, model.abs(id).y + 100)
			const p = { clientX: c.x, clientY: c.y, pointerType: 'mouse', pointerId: 1 }
			for (let i = 0; i < 2; i++) {
				dispatch(container, 'pointerdown', p)
				dispatch(container, 'pointerup', p)
			}
			dispatch(container, 'dblclick', p)
		},
		chip: (id) => container.descendants().find((el) => el.getAttribute('data-knorke-editing') === id) ?? null,
		button: (id) => h.chip(id)?.descendants().find((el) => el.getAttribute('data-knorke-action') === 'take-over') ?? null,
		editor: () => container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null,
		/** Click as the browser delivers it to the button (pointerdown is stopped there). */
		click(el) {
			dispatch(el, 'pointerdown', { pointerType: 'mouse' })
			dispatch(el, 'pointerup', { pointerType: 'mouse' })
			dispatch(el, 'click')
		},
		type(text) {
			const ta = h.editor()
			ta.value = text
			dispatch(ta, 'input')
		},
		esc() {
			dispatch(h.editor(), 'keydown', { key: 'Escape' })
		},
		editing: () => log.filter((e) => e[0] === 'editing').map((e) => [e[1], e[2]]),
		texts: () => log.filter((e) => e[0] === 'intent' && e[1].type === 'text').map((e) => e[1]),
	}
}

describe('take-over at the scene boundary (E04b flow)', () => {
	test('held item: double click opens no editor, the chip offers Take over; the click reports onEditing(id, true) before the final text and the close', () => {
		h.setSamples([ALICE])
		assert.ok(h.chip(N), 'chip [data-knorke-editing=N]')
		assert.equal(h.chip(N).textContent.startsWith('Alice Adler is editing'), true)
		assert.equal(h.button(N), null, 'no Take over before a blocked double click')

		h.dblclick(N)
		dom.frame()
		assert.equal(h.editor(), null, 'no second editor')
		assert.deepEqual(h.editing(), [], 'nothing reported for the blocked open')
		const b = h.button(N)
		assert.ok(b, 'Take over offered after the blocked double click')

		h.click(b)
		const ta = h.editor()
		assert.ok(ta, 'editor open after Take over')
		assert.equal(dom.doc.activeElement, ta, 'editor focused')
		assert.equal(ta.value, 'alice text', 'starts with the model text')
		assert.deepEqual(h.editing(), [[N, true]], 'onEditing(N, true) exactly once')
		assert.equal(h.scene.isActive(N), true)

		h.type('Bob hat übernommen')
		mock.timers.tick(0)
		h.esc()
		assert.equal(h.editor(), null)
		assert.deepEqual(h.editing(), [[N, true], [null, false]])
		const texts = h.texts()
		assert.deepEqual(texts.map((x) => [x.value, x.final]), [['Bob hat übernommen', false], ['Bob hat übernommen', true]])
		// order at the boundary: take-over first, final text before the close
		const seq = h.log.filter((e) => e[0] === 'editing' || (e[0] === 'intent' && e[1].final)).map((e) => (e[0] === 'editing' ? `editing:${e[1] === null ? 'null' : 'N'}:${e[2]}` : 'final'))
		assert.deepEqual(seq, ['editing:N:true', 'final', 'editing:null:false'])

		dom.frame()
		assert.equal(h.button(N), null, 'Take over gone after it was used')
	})

	test('Take over while another item is in the editor: that one ends with its commit, then N opens with onEditing(N, true)', () => {
		h.setSamples([ALICE])
		h.dblclick(N)
		dom.frame()
		assert.ok(h.button(N))
		assert.equal(h.scene.openTextEditor(M), true, 'M is not held: opens')
		h.type('m text 2')
		h.click(h.button(N))
		assert.deepEqual(h.editing(), [[M, false], [null, false], [N, true]])
		assert.deepEqual(h.texts().map((x) => [x.id, x.value, x.final]), [[M, 'm text 2', true]])
		assert.equal(h.scene.isActive(N), true)
	})

	test('the offer expires after TAKE_OVER_MS', () => {
		h.setSamples([ALICE])
		h.dblclick(N)
		dom.frame()
		assert.ok(h.button(N))
		dom.frame(TAKE_OVER_MS - 100)
		assert.ok(h.button(N), 'still offered before the end of the window')
		dom.frame(200)
		dom.frame()
		assert.equal(h.button(N), null, 'gone after the window')
		assert.ok(h.chip(N), 'the chip itself stays while Alice edits')
	})

	test('Take over on an item deleted meanwhile, or in view-only mode: no editor, no take-over', () => {
		h.setSamples([ALICE])
		h.dblclick(N)
		dom.frame()
		const b = h.button(N)
		h.scene.setViewOnly(true)
		h.click(b)
		assert.equal(h.editor(), null)
		assert.deepEqual(h.editing(), [])
		h.scene.setViewOnly(false)
		h.dblclick(N)
		dom.frame()
		const b2 = h.button(N)
		h.scene.update(h.model.apply({ removes: [N] }))
		h.click(b2)
		assert.equal(h.editor(), null)
		assert.deepEqual(h.editing(), [])
	})
})

describe('regression: Take over for an item whose editor is already open', () => {
	test('stale button after a text rescue opened the editor with a notice: reports onEditing(id, true), lifts the notice, commits instead of discarding', () => {
		h.setSamples([ALICE])
		h.dblclick(N)
		dom.frame()
		const b = h.button(N)
		assert.ok(b, 'offered')
		// the session rescues rejected text into an editor with a notice (§6.5) within the same frame
		assert.equal(h.scene.openTextEditor(N, { text: 'rescued text', notice: NOTICE }), true)
		assert.equal(h.editor().getAttribute('data-knorke-editor-state'), 'locked')
		assert.equal(b.isConnected, true, 'the button is still in the DOM until the next frame')

		h.click(b)
		assert.deepEqual(h.editing(), [[N, false], [N, true]], 'take-over reported although the editor was open')
		assert.equal(h.editor().getAttribute('data-knorke-editor-state'), null, 'notice lifted')
		assert.equal(h.editor().value, 'rescued text', 'text kept')
		mock.timers.tick(0)
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['rescued text', false]], 'intermediate commit resumes')
		h.esc()
		assert.deepEqual(h.texts().map((x) => [x.value, x.final]), [['rescued text', false], ['rescued text', true]], 'Esc commits, no discard')
		assert.deepEqual(h.editing().at(-1), [null, false])
		dom.frame()
		assert.equal(h.button(N), null)
	})

	test('a second click on the same button (double click on Take over) re-reports the take-over and keeps the editor', () => {
		h.setSamples([ALICE])
		h.dblclick(N)
		dom.frame()
		const b = h.button(N)
		h.click(b)
		h.type('abc')
		h.click(b)
		assert.deepEqual(h.editing(), [[N, true], [N, true]])
		assert.equal(h.editor().value, 'abc')
		assert.equal(h.editor().getAttribute('data-knorke-editor-state'), null)
	})

	test('a double click on an item whose editor is open with a notice keeps the notice (only Take over lifts it)', () => {
		h.scene.openTextEditor(N, { text: 'mine', notice: NOTICE })
		h.setSamples([ALICE])
		assert.equal(h.scene.openTextEditor(N), true)
		assert.equal(h.editor().getAttribute('data-knorke-editor-state'), 'locked')
		assert.deepEqual(h.editing(), [[N, false]])
	})
})

describe('TextEditor: notice lifted → commits resume', () => {
	function editor() {
		const root = dom.doc.createElement('div')
		dom.doc.body.appendChild(root)
		let now = 5000
		const timers = new Map()
		let next = 1
		const intents = []
		const ed = new TextEditor(root, {
			onIntent: (i) => intents.push([i.value, i.final]),
			onClose: () => {},
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
		return { ed, intents, run, input, timers }
	}

	test('typed under the notice → no commit; lifted → one intermediate commit at the 1 Hz pace, then final on finish', () => {
		const e = editor()
		e.ed.open({ id: N, path: 'data.text', kind: 'note', value: 'a', before: 'a', maxLength: 100 })
		e.input('ab')
		e.run(0)
		assert.deepEqual(e.intents, [['ab', false]])
		e.ed.setNotice(NOTICE)
		e.input('abc')
		e.run(2000)
		assert.deepEqual(e.intents, [['ab', false]], 'no commits while the notice shows')
		e.ed.setNotice(null)
		e.run(0)
		assert.deepEqual(e.intents, [['ab', false], ['abc', false]])
		e.ed.finish()
		assert.deepEqual(e.intents.at(-1), ['abc', true])
	})

	test('lifting a notice when nothing changed since the last commit schedules nothing', () => {
		const e = editor()
		e.ed.open({ id: N, path: 'data.text', kind: 'note', value: 'a', before: 'a', maxLength: 100 })
		e.ed.setNotice(NOTICE)
		e.ed.setNotice(null)
		assert.equal(e.timers.size, 0)
		e.run(COMMIT_INTERVAL_MS)
		assert.deepEqual(e.intents, [])
	})

	test('discard with a commit pending leaves no timer that would commit for the next editor', () => {
		const e = editor()
		e.ed.open({ id: N, path: 'data.text', kind: 'note', value: 'a', before: 'a', maxLength: 100 })
		e.input('ab')
		e.run(0)
		e.input('abc')
		assert.equal(e.timers.size, 1, 'commit pending (1 Hz)')
		e.ed.discard()
		assert.equal(e.timers.size, 0)
		e.ed.open({ id: M, path: 'data.text', kind: 'note', value: 'x', before: 'x', maxLength: 100 })
		e.run(COMMIT_INTERVAL_MS)
		assert.deepEqual(e.intents, [['ab', false]], 'nothing committed for M')
	})
})
