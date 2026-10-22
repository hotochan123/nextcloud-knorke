/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Minimal DOM for Node tests of the scene's DOM overlays (helper, not a test
 * file; the glob only runs *.test.mjs). Just what SceneManager, CursorLayer,
 * TextEditor, InputController and GestureController touch: elements with
 * attributes, inline styles, children, bubbling events with stopPropagation,
 * focus/blur, plus a manual requestAnimationFrame queue and a manual clock
 * behind performance.now(). No rendering, no layout.
 */

export class FakeNode {}

/** @return {object} style object: setProperty/removeProperty plus plain properties */
function makeStyle() {
	const props = new Map()
	return {
		setProperty(k, v) { props.set(k, String(v)) },
		removeProperty(k) { props.delete(k) },
		getPropertyValue(k) { return props.get(k) ?? '' },
	}
}

export class FakeElement extends FakeNode {
	constructor(doc, tag) {
		super()
		this.ownerDocument = doc
		this.tagName = String(tag).toUpperCase()
		this.nodeType = 1
		this.children = []
		this.parentNode = null
		this.attrs = new Map()
		this.listeners = new Map()
		this.style = makeStyle()
		this.className = ''
		this.value = ''
		this.maxLength = -1
		this.type = ''
		this.isContentEditable = false
		this.clientWidth = 0
		this.clientHeight = 0
		this._text = ''
		const classes = new Set()
		this.classList = {
			toggle: (c, on) => {
				const want = on === undefined ? !classes.has(c) : !!on
				if (want) classes.add(c)
				else classes.delete(c)
				return want
			},
			contains: (c) => classes.has(c),
		}
	}

	get textContent() {
		return this._text + this.children.map((c) => c.textContent).join('')
	}

	set textContent(v) {
		for (const c of this.children) c.parentNode = null
		this.children = []
		this._text = String(v)
	}

	get isConnected() {
		let n = this
		while (n.parentNode) n = n.parentNode
		return n === this.ownerDocument.body
	}

	setAttribute(k, v) { this.attrs.set(k, String(v)) }
	getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
	hasAttribute(k) { return this.attrs.has(k) }
	removeAttribute(k) { this.attrs.delete(k) }

	appendChild(c) {
		c.remove()
		c.parentNode = this
		this.children.push(c)
		return c
	}

	append(...cs) {
		for (const c of cs) this.appendChild(c)
	}

	remove() {
		const p = this.parentNode
		if (!p) return
		p.children = p.children.filter((c) => c !== this)
		this.parentNode = null
		if (this.contains(this.ownerDocument.activeElement)) {
			// focus falls back to the body; no blur event (TextEditor drops its
			// listeners before it removes the textarea anyway)
			this.ownerDocument.activeElement = this.ownerDocument.body
		}
	}

	contains(n) {
		for (let x = n; x; x = x.parentNode) {
			if (x === this) return true
		}
		return false
	}

	closest() { return null }

	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, [])
		this.listeners.get(type).push(fn)
	}

	removeEventListener(type, fn) {
		const l = this.listeners.get(type)
		if (l) this.listeners.set(type, l.filter((f) => f !== fn))
	}

	getBoundingClientRect() {
		return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }
	}

	setPointerCapture() {}
	setSelectionRange() {}

	focus() {
		this.ownerDocument.focusOn(this)
	}

	blur() {
		if (this.ownerDocument.activeElement === this) this.ownerDocument.focusOn(this.ownerDocument.body)
	}

	/** All descendants, depth first. */
	descendants() {
		const out = []
		for (const c of this.children) out.push(c, ...c.descendants())
		return out
	}
}

export class FakeDocument {
	constructor() {
		this.body = new FakeElement(this, 'body')
		this.activeElement = this.body
		this.documentElement = { lang: 'en', dataset: {}, getAttribute: () => null }
	}

	createElement(tag) {
		return new FakeElement(this, tag)
	}

	createElementNS(ns, tag) {
		return new FakeElement(this, tag)
	}

	focusOn(el) {
		const prev = this.activeElement
		if (prev === el) return
		this.activeElement = el
		if (prev && prev !== this.body) dispatch(prev, 'blur', {}, { bubbles: false })
	}
}

/**
 * Dispatches a synthetic event: target listeners, then bubbling up through the
 * parents and finally window (unless stopped or bubbles:false).
 *
 * @param {FakeElement} target element
 * @param {string} type event type
 * @param {object} [props] event fields (clientX, key, …)
 * @param {{bubbles?:boolean}} [o] options
 * @return {object} the event (defaultPrevented, propagationStopped)
 */
export function dispatch(target, type, props = {}, { bubbles = true } = {}) {
	const e = {
		type,
		target,
		button: 0,
		pointerId: 1,
		pointerType: 'mouse',
		clientX: 0,
		clientY: 0,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		defaultPrevented: false,
		propagationStopped: false,
		...props,
		preventDefault() { this.defaultPrevented = true },
		stopPropagation() { this.propagationStopped = true },
	}
	const path = []
	for (let n = target; n; n = bubbles ? n.parentNode : null) path.push(n)
	for (const n of path) {
		e.currentTarget = n
		for (const fn of [...(n.listeners.get(type) ?? [])]) fn(e)
		if (e.propagationStopped) return e
	}
	if (bubbles && target.isConnected) {
		const w = globalThis.window
		for (const fn of [...(w?.listeners?.get(type) ?? [])]) fn(e)
	}
	return e
}

/**
 * Installs the fake DOM as globals (document, window, Node, rAF, performance).
 *
 * @return {{doc:FakeDocument, clock:{t:number}, frame:(ms?:number) => number, pendingFrames:() => number, restore:() => void}}
 */
export function installDom() {
	const saved = {}
	for (const k of ['document', 'window', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance']) {
		saved[k] = Object.getOwnPropertyDescriptor(globalThis, k)
	}
	const doc = new FakeDocument()
	const clock = { t: 1000 }
	let nextId = 1
	let queue = new Map()
	const winListeners = new Map()
	const win = {
		listeners: winListeners,
		devicePixelRatio: 1,
		addEventListener(type, fn) {
			if (!winListeners.has(type)) winListeners.set(type, [])
			winListeners.get(type).push(fn)
		},
		removeEventListener(type, fn) {
			const l = winListeners.get(type)
			if (l) winListeners.set(type, l.filter((f) => f !== fn))
		},
	}
	const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
	define('document', doc)
	define('window', win)
	define('Node', FakeNode)
	define('requestAnimationFrame', (fn) => {
		const id = nextId++
		queue.set(id, fn)
		return id
	})
	define('cancelAnimationFrame', (id) => queue.delete(id))
	define('performance', { now: () => clock.t })
	return {
		doc,
		clock,
		/**
		 * Advances the clock and runs one animation frame.
		 *
		 * @param {number} [ms] time to advance first
		 * @return {number} callbacks run
		 */
		frame(ms = 16) {
			clock.t += ms
			const run = [...queue.values()]
			queue = new Map()
			for (const fn of run) fn(clock.t)
			return run.length
		},
		pendingFrames: () => queue.size,
		restore() {
			for (const [k, d] of Object.entries(saved)) {
				if (d) Object.defineProperty(globalThis, k, d)
				else delete globalThis[k]
			}
		},
	}
}
