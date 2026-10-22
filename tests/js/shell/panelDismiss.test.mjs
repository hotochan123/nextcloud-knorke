/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §6.6 (R11), finding C-1b-02: an open context-bar panel closes on a
 * pointerdown on the canvas, and the press still reaches the scene (not
 * cancelled, not stopped, the first click of a double click not
 * swallowed). Esc inside the panel gives the focus back to its toggle. Esc
 * with the canvas focus (or the focus on <body>) closes an open panel first
 * and goes no further (the selection and following stay until the next Esc).
 *
 * A small fake DOM tree with real event phases (capture root → target,
 * target, bubble target → root), passive listeners (preventDefault is
 * ignored) and stopPropagation stands in for the board view: the scene
 * listens on the canvas host like InputController (bubble phase) for the
 * pointer and on the window above the document for the keys, the session's
 * follow listener is a bubble listener on the document, the context bar and
 * its panel are siblings of the host as in BoardView.vue.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { CANVAS_SELECTOR, closeOnCanvasEscape, closeOnCanvasPress, isCanvasTarget, toggleForEscape } from '../../../src/components/panelDismiss.js'

const PANEL_ID = 'knorke-contextbar-panel'

class FakeEl {
	/**
	 * @param {string} tag tag name
	 * @param {{cls?: string[], id?: string, attrs?: object}} [opts] class list, id, attributes
	 */
	constructor(tag, opts = {}) {
		this.tag = tag
		this.cls = new Set(opts.cls ?? [])
		this.id = opts.id ?? null
		this.attrs = { ...(opts.attrs ?? {}) }
		this.parent = null
		this.children = []
		this.listeners = []
		this.doc = null
	}

	/**
	 * @param {FakeEl} child child element
	 * @return {FakeEl} the child
	 */
	append(child) {
		child.parent = this
		this.children.push(child)
		return child
	}

	addEventListener(type, fn, opts) {
		const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
		const passive = typeof opts === 'object' && opts !== null && !!opts.passive
		if (!this.listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) {
			this.listeners.push({ type, fn, capture, passive, opts })
		}
	}

	removeEventListener(type, fn, opts) {
		const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
		this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture))
	}

	/**
	 * @param {string} sel '.class' or '#id'
	 * @return {boolean}
	 */
	matches(sel) {
		if (sel.startsWith('.')) return this.cls.has(sel.slice(1))
		if (sel.startsWith('#')) return this.id === sel.slice(1)
		throw new Error('fake selector not supported: ' + sel)
	}

	/**
	 * @param {string} sel '.class' or '#id'
	 * @return {FakeEl|null}
	 */
	closest(sel) {
		for (let n = this; n !== null; n = n.parent) {
			if (n.matches(sel)) return n
		}
		return null
	}

	/**
	 * @param {FakeEl} other element
	 * @return {boolean} other is this element or below it
	 */
	contains(other) {
		for (let n = other; n !== null; n = n.parent) {
			if (n === this) return true
		}
		return false
	}

	/**
	 * @param {string} sel '[attr]'
	 * @return {FakeEl[]} matching descendants in document order
	 */
	querySelectorAll(sel) {
		const m = sel.match(/^\[([a-z-]+)\]$/)
		if (!m) throw new Error('fake selector not supported: ' + sel)
		const out = []
		const walk = (n) => {
			for (const c of n.children) {
				if (Object.hasOwn(c.attrs, m[1])) out.push(c)
				walk(c)
			}
		}
		walk(this)
		return out
	}

	getAttribute(name) {
		return Object.hasOwn(this.attrs, name) ? String(this.attrs[name]) : null
	}

	focus() {
		let root = this
		while (root.parent !== null && root.tag !== '#document') root = root.parent
		root.activeElement = this
	}
}

/**
 * Dispatches like the DOM: capture listeners root → parent, all listeners
 * at the target (capture first), bubble listeners parent → root;
 * stopPropagation ends the dispatch after the current node; preventDefault
 * inside a passive listener is ignored.
 *
 * @param {FakeEl} target event target
 * @param {string} type event type
 * @param {object} [init] event fields (key, ctrlKey, metaKey, altKey, shiftKey)
 * @return {object} the event
 */
function dispatch(target, type, init = {}) {
	const path = []
	for (let n = target; n !== null; n = n.parent) path.push(n)
	let passiveNow = false
	const e = {
		type,
		target,
		pointerId: 1,
		pointerType: 'mouse',
		button: 0,
		key: undefined,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...init,
		defaultPrevented: false,
		stopped: false,
		preventDefault() {
			if (!passiveNow) this.defaultPrevented = true
		},
		stopPropagation() {
			this.stopped = true
		},
	}
	const run = (node, phase) => {
		for (const l of [...node.listeners]) {
			if (l.type !== type) continue
			if (phase === 'capture' && !l.capture) continue
			if (phase === 'bubble' && l.capture) continue
			passiveNow = l.passive
			l.fn(e)
			passiveNow = false
		}
		return e.stopped
	}
	for (let i = path.length - 1; i >= 1; i--) {
		if (run(path[i], 'capture')) return e
	}
	const atTarget = [...target.listeners]
	target.listeners = atTarget.filter((l) => l.capture).concat(atTarget.filter((l) => !l.capture))
	const stopped = run(target, 'target')
	target.listeners = atTarget
	if (stopped) return e
	for (let i = 1; i < path.length; i++) {
		if (run(path[i], 'bubble')) return e
	}
	return e
}

/**
 * The board view as a fake tree: the window, the document, the canvas host
 * with the scene's content and overlay, toolbar, and the context bar with an
 * open "Line" panel.
 *
 * @return {object} elements, the scene and follow logs and the panel state
 */
function board() {
	const win = new FakeEl('#window')
	const doc = win.append(new FakeEl('#document'))
	const body = doc.append(new FakeEl('body'))
	doc.body = body
	const view = body.append(new FakeEl('div', { cls: ['knorke-board'] }))
	const host = view.append(new FakeEl('div', { cls: ['knorke-canvas'], attrs: { tabindex: '0' } }))
	const content = host.append(new FakeEl('div', { cls: ['konvajs-content'] }))
	const canvasEl = content.append(new FakeEl('canvas'))
	const overlay = host.append(new FakeEl('div', { cls: ['knorke-scene-overlay'] }))
	const editor = overlay.append(new FakeEl('textarea', { attrs: { 'data-knorke-editor': '' } }))
	const toolbar = view.append(new FakeEl('div', { cls: ['knorke-toolbar'] }))
	const toolBtn = toolbar.append(new FakeEl('button'))
	const bar = view.append(new FakeEl('div', { cls: ['knorke-contextbar'] }))
	const lineToggle = bar.append(new FakeEl('button', { attrs: { 'data-knorke-section': 'border', 'aria-controls': PANEL_ID, 'aria-expanded': 'true' } }))
	const routeToggle = bar.append(new FakeEl('button', { attrs: { 'data-knorke-section': 'route', 'aria-controls': PANEL_ID, 'aria-expanded': 'false' } }))
	const copyBtn = bar.append(new FakeEl('button', { attrs: { 'data-knorke-action': 'copy' } }))
	const panel = bar.append(new FakeEl('div', { cls: ['knorke-contextbar__panel'], id: PANEL_ID, attrs: { 'data-knorke-panel': 'border' } }))
	const dashBtn = panel.append(new FakeEl('button', { attrs: { 'data-knorke-style': 'style.dash', 'data-knorke-value': 'dashed' } }))
	// the scene: InputController listens on its container in the bubble phase
	const scene = []
	for (const type of ['pointerdown', 'pointerup', 'dblclick']) {
		host.addEventListener(type, (e) => scene.push({ type: e.type, target: e.target, e }))
	}
	// something above the scene that must still see the press (propagation not stopped)
	const above = []
	doc.addEventListener('pointerdown', (e) => above.push(e))
	// the scene's keys: InputController listens on the window (bubble phase; Esc clears the selection)
	const keys = []
	win.addEventListener('keydown', (e) => keys.push(e))
	// the session: Esc ends following (bubble listener on the document)
	const follow = []
	doc.addEventListener('keydown', (e) => follow.push(e))
	const state = { panel: 'border', closes: 0 }
	return { win, doc, body, view, host, content, canvasEl, overlay, editor, toolbar, toolBtn, bar, lineToggle, routeToggle, copyBtn, panel, dashBtn, scene, above, keys, follow, state }
}

/**
 * @param {object} b board()
 * @return {() => void} the installed listener's remover (closes like ContextBar.vue)
 */
function install(b) {
	return closeOnCanvasPress(b.doc, () => {
		b.state.closes++
		b.state.panel = null
	})
}

test('C-1b-02: a pointerdown on the canvas closes the open panel, and the scene still receives that press (not cancelled, not stopped)', () => {
	const b = board()
	install(b)
	const e = dispatch(b.canvasEl, 'pointerdown')
	assert.equal(b.state.panel, null, 'the panel is closed')
	assert.equal(b.state.closes, 1)
	assert.equal(b.scene.length, 1, 'the scene got the press')
	assert.equal(b.scene[0].e, e, 'the same event object')
	assert.equal(b.scene[0].target, b.canvasEl)
	assert.equal(e.defaultPrevented, false, 'not cancelled')
	assert.equal(e.stopped, false, 'propagation not stopped')
	assert.equal(b.above.length, 1, 'listeners above the canvas still see it')
})

test('C-1b-02: a double click on the canvas right after a style change — both presses and the dblclick reach the scene; the first press already closes the panel', () => {
	const b = board()
	install(b)
	dispatch(b.dashBtn, 'pointerdown') // the style click in the panel: panel stays open
	assert.equal(b.state.panel, 'border')
	dispatch(b.canvasEl, 'pointerdown')
	assert.equal(b.state.panel, null, 'closed by the FIRST press of the double click')
	dispatch(b.canvasEl, 'pointerup')
	dispatch(b.canvasEl, 'pointerdown')
	dispatch(b.canvasEl, 'pointerup')
	dispatch(b.canvasEl, 'dblclick')
	assert.deepEqual(b.scene.map((x) => x.type), ['pointerdown', 'pointerup', 'pointerdown', 'pointerup', 'dblclick'], 'nothing swallowed')
	assert.ok(b.scene.every((x) => x.e.defaultPrevented === false && x.e.stopped === false))
})

test('C-1b-02: presses outside the canvas leave the panel open (panel, its toggle, other bar buttons, toolbar, board margin)', () => {
	const b = board()
	install(b)
	for (const el of [b.dashBtn, b.panel, b.lineToggle, b.routeToggle, b.copyBtn, b.toolBtn, b.toolbar, b.view, b.bar]) {
		dispatch(el, 'pointerdown')
		assert.equal(b.state.panel, 'border', 'still open after a press on ' + (el.attrs['data-knorke-section'] ?? el.attrs['data-knorke-style'] ?? el.attrs['data-knorke-action'] ?? [...el.cls].join('.') ?? el.tag))
	}
	assert.equal(b.state.closes, 0)
	assert.equal(b.scene.length, 0, 'none of these reached the scene either')
})

test('C-1b-02: the close runs in the capture phase, before the scene, even when a scene control stops the propagation (overlay editor/chips)', () => {
	const b = board()
	const order = []
	// TextEditor/CursorLayer stop pointerdown at their own elements
	b.editor.addEventListener('pointerdown', (e) => {
		order.push('scene-control')
		e.stopPropagation()
	})
	closeOnCanvasPress(b.doc, () => {
		order.push('close')
		b.state.panel = null
	})
	const e = dispatch(b.editor, 'pointerdown')
	assert.equal(b.state.panel, null)
	assert.deepEqual(order, ['close', 'scene-control'], 'capture at the document runs first')
	assert.equal(e.defaultPrevented, false)
})

test('C-1b-02: the listener is a passive capture listener on the given root; a preventDefault inside close has no effect', () => {
	const b = board()
	closeOnCanvasPress(b.doc, (e) => {
		b.state.panel = null
		e.preventDefault() // a passive listener cannot cancel the press
	})
	const mine = b.doc.listeners.filter((l) => l.type === 'pointerdown' && l.capture)
	assert.equal(mine.length, 1)
	assert.equal(mine[0].passive, true, 'passive')
	const e = dispatch(b.canvasEl, 'pointerdown')
	assert.equal(b.state.panel, null)
	assert.equal(e.defaultPrevented, false)
	assert.equal(b.scene.length, 1)
})

test('C-1b-02: the remover takes the listener off again (bar unmounted: no more closes, no listener left)', () => {
	const b = board()
	const stop = install(b)
	stop()
	assert.equal(b.doc.listeners.filter((l) => l.type === 'pointerdown' && l.capture).length, 0)
	dispatch(b.canvasEl, 'pointerdown')
	assert.equal(b.state.panel, 'border')
	assert.equal(b.state.closes, 0)
	assert.equal(b.scene.length, 1, 'the scene works as before')
})

test('C-1b-02: isCanvasTarget — the host and everything inside it; nothing else, null or targets without closest', () => {
	const b = board()
	for (const el of [b.host, b.content, b.canvasEl, b.overlay, b.editor]) {
		assert.equal(isCanvasTarget(el), true)
	}
	for (const el of [b.panel, b.dashBtn, b.lineToggle, b.toolBtn, b.view, b.doc]) {
		assert.equal(isCanvasTarget(el), false)
	}
	assert.equal(isCanvasTarget(null), false)
	assert.equal(isCanvasTarget(undefined), false)
	assert.equal(isCanvasTarget({}), false, 'window/document-like targets without closest')
	assert.equal(CANVAS_SELECTOR, '.knorke-canvas')
})

test('Esc inside the panel: the focus target is the toggle of the open panel (aria-controls + aria-expanded="true"); outside the panel: none', () => {
	const b = board()
	assert.equal(toggleForEscape(b.bar, b.dashBtn, PANEL_ID), b.lineToggle, 'from a style button in the panel')
	assert.equal(toggleForEscape(b.bar, b.panel, PANEL_ID), b.lineToggle, 'from the panel itself')
	assert.equal(toggleForEscape(b.bar, b.lineToggle, PANEL_ID), null, 'Esc on the toggle: focus stays on it')
	assert.equal(toggleForEscape(b.bar, b.copyBtn, PANEL_ID), null, 'Esc on another bar button: focus stays')
	assert.equal(toggleForEscape(b.bar, b.canvasEl, PANEL_ID), null, 'outside the bar')
	assert.equal(toggleForEscape(null, b.dashBtn, PANEL_ID), null)
	assert.equal(toggleForEscape(b.bar, null, PANEL_ID), null)
	// another panel open: its toggle is the one
	b.lineToggle.attrs['aria-expanded'] = 'false'
	b.routeToggle.attrs['aria-expanded'] = 'true'
	assert.equal(toggleForEscape(b.bar, b.dashBtn, PANEL_ID), b.routeToggle)
	b.routeToggle.attrs['aria-expanded'] = 'false'
	assert.equal(toggleForEscape(b.bar, b.dashBtn, PANEL_ID), null, 'no expanded toggle')
	b.lineToggle.attrs['aria-expanded'] = 'true'
	b.lineToggle.focus()
	assert.equal(b.doc.activeElement, b.lineToggle)
})

/**
 * @param {object} b board()
 * @return {() => void} the installed Esc listener's remover (closes like ContextBar.vue)
 */
function installEsc(b) {
	return closeOnCanvasEscape(b.doc, () => b.state.panel !== null, () => {
		b.state.closes++
		b.state.panel = null
	})
}

test('Esc with the canvas focus (a): an open panel closes once, the key stops there (neither the scene on the window nor the follow listener on the document gets it), not cancelled', () => {
	const b = board()
	installEsc(b)
	const e = dispatch(b.host, 'keydown', { key: 'Escape' })
	assert.equal(b.state.panel, null, 'the panel is closed')
	assert.equal(b.state.closes, 1)
	assert.equal(b.keys.length, 0, 'the scene does not clear the selection')
	assert.equal(b.follow.length, 0, 'following does not end')
	assert.equal(e.stopped, true)
	assert.equal(e.defaultPrevented, false, 'no preventDefault')
	// the second Esc: no panel any more, it reaches the scene and the session as before
	const e2 = dispatch(b.host, 'keydown', { key: 'Escape' })
	assert.equal(b.state.closes, 1)
	assert.deepEqual(b.keys, [e2])
	assert.deepEqual(b.follow, [e2])
	assert.equal(e2.stopped, false)
})

test('Esc with the canvas focus (b): without an open panel nothing closes and nothing stops, the scene gets the key once; isOpen is asked only on the key', () => {
	const b = board()
	let asked = 0
	closeOnCanvasEscape(b.doc, () => {
		asked++
		return b.state.panel !== null
	}, () => {
		b.state.closes++
		b.state.panel = null
	})
	assert.equal(asked, 0, 'not asked when installed')
	b.state.panel = null
	const e = dispatch(b.host, 'keydown', { key: 'Escape' })
	assert.equal(asked, 1)
	assert.equal(b.state.closes, 0)
	assert.deepEqual(b.keys, [e], 'the scene got it exactly once')
	assert.deepEqual(b.follow, [e])
	assert.equal(e.stopped, false)
	assert.equal(e.defaultPrevented, false)
	// a panel opened later: the same listener closes it
	b.state.panel = 'align'
	dispatch(b.host, 'keydown', { key: 'Escape' })
	assert.equal(b.state.closes, 1)
	assert.equal(b.keys.length, 1)
})

test('Esc with the focus on <body> (a click beside a button): an open panel closes once and the key stops there, not cancelled; without a panel it passes', () => {
	const b = board()
	installEsc(b)
	const e = dispatch(b.body, 'keydown', { key: 'Escape' })
	assert.equal(b.state.panel, null)
	assert.equal(b.state.closes, 1)
	assert.equal(e.stopped, true)
	assert.equal(e.defaultPrevented, false)
	assert.equal(b.keys.length, 0, 'the scene does not get it')
	assert.equal(b.follow.length, 0)
	const e2 = dispatch(b.body, 'keydown', { key: 'Escape' })
	assert.equal(b.state.closes, 1)
	assert.deepEqual(b.keys, [e2], 'no panel: the scene gets the next one')
	assert.equal(e2.stopped, false)
	b.state.panel = 'border'
	dispatch(b.body, 'keydown', { key: 'Escape', altKey: true })
	assert.equal(b.state.panel, 'border', 'Alt+Esc on <body>: no effect')
})

test('Esc with the canvas focus (c): another target (editor in the host\'s overlay, a bar button, a button in the panel, a toolbar button, the board margin, the document) neither closes nor stops', () => {
	const b = board()
	installEsc(b)
	const targets = [b.editor, b.overlay, b.canvasEl, b.copyBtn, b.lineToggle, b.dashBtn, b.panel, b.toolBtn, b.view, b.doc]
	for (const el of targets) {
		const e = dispatch(el, 'keydown', { key: 'Escape' })
		assert.equal(b.state.panel, 'border', 'still open after Esc on ' + (el.attrs['data-knorke-action'] ?? el.attrs['data-knorke-style'] ?? el.attrs['data-knorke-section'] ?? el.tag))
		assert.equal(e.stopped, false)
		assert.equal(e.defaultPrevented, false)
	}
	assert.equal(b.state.closes, 0)
	assert.equal(b.keys.length, targets.length, 'the scene got every one')
	assert.equal(b.follow.length, targets.length)
})

test('Esc with the canvas focus (d): other keys on the canvas host (Enter, Delete, Tab, a) have no effect', () => {
	const b = board()
	installEsc(b)
	for (const key of ['Enter', 'Delete', 'Tab', 'a']) {
		const e = dispatch(b.host, 'keydown', { key })
		assert.equal(b.state.panel, 'border', key)
		assert.equal(e.stopped, false, key)
		assert.equal(e.defaultPrevented, false, key)
	}
	assert.equal(b.state.closes, 0)
	assert.equal(b.keys.length, 4)
})

test('Esc with the canvas focus (e): with Ctrl, ⌘ (Meta) or Alt no effect; Shift+Esc closes like Esc', () => {
	const b = board()
	installEsc(b)
	for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
		const e = dispatch(b.host, 'keydown', { key: 'Escape', [mod]: true })
		assert.equal(b.state.panel, 'border', mod)
		assert.equal(e.stopped, false, mod)
	}
	assert.equal(b.state.closes, 0)
	assert.equal(b.keys.length, 3)
	const e = dispatch(b.host, 'keydown', { key: 'Escape', shiftKey: true })
	assert.equal(b.state.panel, null, 'Shift+Esc closes')
	assert.equal(b.state.closes, 1)
	assert.equal(e.stopped, true)
	assert.equal(e.defaultPrevented, false)
	assert.equal(b.keys.length, 3, 'the scene did not get Shift+Esc')
})

test('Esc with the canvas focus (f): one capture keydown listener on the given root; the remover takes it off again (no listener left, Esc reaches the scene)', () => {
	const b = board()
	const order = []
	b.view.addEventListener('keydown', () => order.push('board-view-capture'), true)
	const stop = closeOnCanvasEscape(b.doc, () => b.state.panel !== null, () => {
		order.push('close')
		b.state.panel = null
	})
	const mine = b.doc.listeners.filter((l) => l.type === 'keydown' && l.capture)
	assert.equal(mine.length, 1)
	assert.equal(b.win.listeners.filter((l) => l.type === 'keydown' && l.capture).length, 0, 'not on the window')
	dispatch(b.host, 'keydown', { key: 'Escape' })
	assert.deepEqual(order, ['close'], 'capture on the document runs first and stops the key')
	stop()
	assert.equal(b.doc.listeners.filter((l) => l.type === 'keydown' && l.capture).length, 0, 'no listener left')
	b.state.panel = 'border'
	const e = dispatch(b.host, 'keydown', { key: 'Escape' })
	assert.equal(b.state.panel, 'border', 'no more closes')
	assert.deepEqual(b.keys, [e], 'the scene works as before')
	assert.deepEqual(order, ['close', 'board-view-capture'])
})

const BAR_SRC = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
const BAR_SCRIPT = BAR_SRC.match(/<script setup>([\s\S]*)<\/script>/)?.[1] ?? ''

test('C-1b-02 wiring in ContextBar.vue: installed on the document while the bar is mounted, removed on unmount; the close only sets panel = null', () => {
	assert.match(BAR_SCRIPT, /import \{ closeOnCanvasEscape, closeOnCanvasPress, toggleForEscape \} from '\.\/panelDismiss\.js'/)
	const mounted = BAR_SCRIPT.match(/onMounted\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1] ?? ''
	assert.match(mounted, /stopCanvasPress = closeOnCanvasPress\(document, \(\) => \{\s*panel\.value = null\s*\}\)/)
	assert.doesNotMatch(mounted, /preventDefault|stopPropagation/, 'the close never cancels or stops the press')
	const unmount = BAR_SCRIPT.match(/onBeforeUnmount\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1] ?? ''
	assert.match(unmount, /stopCanvasPress\?\.\(\)/)
})

test('Esc with the canvas focus, wiring in ContextBar.vue: installed on the document in onMounted (isOpen = panel.value !== null), removed in onBeforeUnmount; the close only sets panel = null (no focus, no preventDefault); closeOnCanvasPress and onEsc stay', () => {
	const mounted = BAR_SCRIPT.match(/onMounted\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1] ?? ''
	const call = mounted.match(/stopCanvasEscape = closeOnCanvasEscape\(document, \(\) => panel\.value !== null, \(\) => \{([\s\S]*?)\}\)/)
	assert.ok(call, 'closeOnCanvasEscape(document, () => panel.value !== null, () => { … }) in onMounted')
	assert.equal(call[1].trim(), 'panel.value = null', 'the close only sets panel = null')
	assert.doesNotMatch(mounted, /focus|preventDefault|stopPropagation/, 'no focus call, no preventDefault (the helper stops the key)')
	assert.match(mounted, /stopCanvasPress = closeOnCanvasPress\(document, \(\) => \{\s*panel\.value = null\s*\}\)/, 'closeOnCanvasPress unchanged')
	const unmount = BAR_SCRIPT.match(/onBeforeUnmount\(\(\) => \{([\s\S]*?)\n\}\)/)?.[1] ?? ''
	assert.match(unmount, /stopCanvasEscape\?\.\(\)/)
	assert.match(unmount, /stopCanvasPress\?\.\(\)/)
	assert.equal((BAR_SCRIPT.match(/closeOnCanvasEscape\(/g) ?? []).length, 1, 'installed once')
})

test('Esc wiring in ContextBar.vue: the bar root has ref="bar" and @keydown.esc; onEsc focuses the toggle BEFORE closing and stops the key', () => {
	const ast = parse(BAR_SRC.match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
	const root = ast.children.find((c) => c.type === 1)
	assert.ok(root.props.some((p) => p.type === 6 && p.name === 'ref' && p.value?.content === 'bar'))
	assert.ok(root.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'keydown' && p.modifiers.some((m) => (m.content ?? m) === 'esc')))
	const onEsc = BAR_SCRIPT.match(/function onEsc\(e\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
	assert.match(onEsc, /e\.stopPropagation\(\)\s*toggleForEscape\(bar\.value, e\.target, panelId\)\?\.focus\(\)\s*panel\.value = null/)
	assert.match(BAR_SCRIPT, /const panelId = 'knorke-contextbar-panel'/)
	assert.equal(PANEL_ID, 'knorke-contextbar-panel')
})

test('C-1b-02 board view: the canvas host is .knorke-canvas and the context bar is NOT inside it (presses on the panel never close it)', () => {
	const src = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	const ast = parse(src.match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
	const root = ast.children.find((c) => c.type === 1)
	const host = root.children.find((c) => c.type === 1 && c.props.some((p) => p.type === 6 && p.name === 'class' && p.value?.content === CANVAS_SELECTOR.slice(1)))
	assert.ok(host, 'canvas host is a direct child of the board root')
	const inside = (n, tag) => (n.children ?? []).some((c) => c.type === 1 && (c.tag === tag || inside(c, tag)))
	assert.equal(inside(host, 'ContextBar'), false)
	// stage 3 (R16 (3)): the bar sits in the top stack with the banner strips (a sibling of the host)
	const stack = root.children.find((c) => c.type === 1 && c.props.some((p) => p.type === 6 && p.name === 'class' && p.value?.content === 'knorke-topstack'))
	assert.ok(stack && stack.children.some((c) => c.type === 1 && c.tag === 'ContextBar'), 'the bar is in the top stack, outside the host')
})
