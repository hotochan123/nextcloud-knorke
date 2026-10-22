/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Presence overlay in the DOM (SPEC-M0 §6.3, §6.8): cursors of the other
 * participants with a name tag, and the "X is editing…" chip on items whose
 * text someone edits (text lease, §4.11), optionally with the "Take over"
 * action. DOM instead of a third canvas: no extra GPU buffer.
 *
 * Test hooks (contract with [D]):
 *   [data-knorke-cursor=<pid>:<client>] with a child .knorke-cursor-name
 *   [data-knorke-editing=<itemId>]       chip
 *   [data-knorke-action=take-over]       action inside the chip
 * Guests carry the class knorke-cursor--guest and the "(guest)" suffix.
 *
 * Names are data, not markup: every text goes through textContent. Styles are
 * inline (the overlay is not part of a scoped component) and the button resets
 * Nextcloud's global button styles with !important.
 */
import { t } from '../util/l10n.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Arrow pointing up-left; its tip is at (1, 1) of the 14×20 cursor box. */
const ARROW_PATH = 'M1 1 L1 16 L5 12.2 L8 19 L10.6 17.9 L7.7 11.2 L13 11.2 Z'
const HEX6 = /^#[0-9a-fA-F]{6}$/

/**
 * @param {unknown} color background color
 * @return {string} a valid background color (fallback grey)
 */
function bgOf(color) {
	return typeof color === 'string' && HEX6.test(color) ? color : '#5f6368'
}

/**
 * Readable text color on a background (WCAG relative luminance).
 *
 * @param {string} bg #rrggbb
 * @return {string} white or near-black
 */
export function textColorOn(bg) {
	const c = bgOf(bg)
	const ch = [1, 3, 5].map((i) => {
		const v = parseInt(c.slice(i, i + 2), 16) / 255
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
	})
	const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
	// contrast with white vs. with #1a1a1a (luminance ≈ 0.0103)
	return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.0603) ? '#ffffff' : '#1a1a1a'
}

/**
 * @param {HTMLElement|SVGElement} el element
 * @param {Record<string, string>} styles CSS properties
 * @param {boolean} [important] add !important (against global Nextcloud styles)
 */
export function setStyles(el, styles, important = false) {
	for (const [k, v] of Object.entries(styles)) {
		el.style.setProperty(k, v, important ? 'important' : '')
	}
}

/**
 * @param {number} v pixels
 * @return {number} rounded to 0.1 px (fewer style writes)
 */
const px = (v) => Math.round(v * 10) / 10

/**
 * @param {object} s RemoteSample
 * @return {string} label of the name tag
 */
function nameLabel(s) {
	const name = typeof s.name === 'string' ? s.name : ''
	return s.guest ? t('knorke', '{name} (guest)', { name }) : name
}

export class CursorLayer {
	#root
	#onTakeOver
	/** @type {Map<string, {el:HTMLElement, path:SVGElement, name:HTMLElement, sig:string, pos:string}>} */
	#cursors = new Map()
	/** @type {Map<string, {el:HTMLElement, label:HTMLElement, button:(HTMLElement|null), sig:string, pos:string}>} */
	#chips = new Map()

	/**
	 * @param {HTMLElement} root overlay element (pointer-events: none)
	 * @param {{onTakeOver?:(id:string) => void}} [opts] click on "Take over"
	 */
	constructor(root, { onTakeOver = () => {} } = {}) {
		this.#root = root
		this.#onTakeOver = onTakeOver
	}

	/** @return {number} cursor elements in the DOM */
	get cursorCount() {
		return this.#cursors.size
	}

	/**
	 * Draws one frame of presence.
	 *
	 * @param {Array<object>} samples RemoteSample[]
	 * @param {{x:number, y:number, scale:number}} cam live camera
	 * @param {object} ctx helpers
	 * @param {(id:string) => ({x:number, y:number}|null)} ctx.itemAnchor screen anchor (top-left) of an item or null
	 * @param {{id:string, until:number}|null} [ctx.takeOver] item that offers "Take over" until a time
	 * @param {number} [ctx.now] current time (same clock as takeOver.until)
	 */
	render(samples, cam, { itemAnchor, takeOver = null, now = 0 }) {
		const seen = new Set()
		const editing = new Map()
		for (const s of samples) {
			if (!s || typeof s.key !== 'string') continue
			const c = s.cursor
			if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
				seen.add(s.key)
				this.#cursor(s, (c[0] - cam.x) * cam.scale, (c[1] - cam.y) * cam.scale)
			}
			if (typeof s.editing === 'string') {
				const prev = editing.get(s.editing)
				if (!prev || (!prev.editingHolder && s.editingHolder)) editing.set(s.editing, s)
			}
		}
		for (const [key, c] of this.#cursors) {
			if (!seen.has(key)) {
				c.el.remove()
				this.#cursors.delete(key)
			}
		}
		const chipSeen = new Set()
		for (const [id, s] of editing) {
			const at = itemAnchor(id)
			if (!at) continue
			chipSeen.add(id)
			const offer = takeOver !== null && takeOver.id === id && now < takeOver.until
			this.#chip(id, s, at, offer)
		}
		for (const [id, c] of this.#chips) {
			if (!chipSeen.has(id)) {
				c.el.remove()
				this.#chips.delete(id)
			}
		}
	}

	/** Removes everything. */
	clear() {
		for (const c of this.#cursors.values()) c.el.remove()
		for (const c of this.#chips.values()) c.el.remove()
		this.#cursors.clear()
		this.#chips.clear()
	}

	destroy() {
		this.clear()
	}

	// ---------------------------------------------------------------- internals

	#cursor(s, x, y) {
		let c = this.#cursors.get(s.key)
		if (!c) {
			const el = document.createElement('div')
			el.className = 'knorke-cursor'
			el.setAttribute('data-knorke-cursor', s.key)
			setStyles(el, {
				position: 'absolute', left: '0', top: '0', width: '14px', height: '20px',
				'pointer-events': 'none', 'will-change': 'transform', 'z-index': '3',
			})
			const svg = document.createElementNS(SVG_NS, 'svg')
			svg.setAttribute('width', '14')
			svg.setAttribute('height', '20')
			svg.setAttribute('viewBox', '0 0 14 20')
			svg.setAttribute('aria-hidden', 'true')
			setStyles(svg, { display: 'block', overflow: 'visible' })
			const path = document.createElementNS(SVG_NS, 'path')
			path.setAttribute('d', ARROW_PATH)
			path.setAttribute('stroke', '#ffffff')
			path.setAttribute('stroke-width', '1.2')
			path.setAttribute('stroke-linejoin', 'round')
			svg.appendChild(path)
			const name = document.createElement('div')
			name.className = 'knorke-cursor-name'
			setStyles(name, {
				position: 'absolute', left: '12px', top: '17px', 'max-width': '220px', overflow: 'hidden',
				'text-overflow': 'ellipsis', 'white-space': 'nowrap', padding: '1px 6px', 'border-radius': '9px',
				font: '12px/1.4 ' + 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
				'box-shadow': '0 1px 2px rgba(0,0,0,0.2)',
			})
			el.append(svg, name)
			this.#root.appendChild(el)
			c = { el, path, name, sig: '', pos: '' }
			this.#cursors.set(s.key, c)
		}
		const label = nameLabel(s)
		const bg = bgOf(s.color)
		const sig = label + '|' + bg + '|' + (s.guest ? 1 : 0)
		if (sig !== c.sig) {
			c.sig = sig
			c.name.textContent = label
			c.path.setAttribute('fill', bg)
			setStyles(c.name, { background: bg, color: textColorOn(bg) })
			c.el.classList.toggle('knorke-cursor--guest', !!s.guest)
			if (s.guest) {
				setStyles(c.name, { 'font-style': 'italic' })
			} else {
				c.name.style.removeProperty('font-style')
			}
		}
		// the arrow tip sits at (1, 1) of the box
		const pos = `translate(${px(x - 1)}px, ${px(y - 1)}px)`
		if (pos !== c.pos) {
			c.pos = pos
			c.el.style.transform = pos
		}
	}

	#chip(id, s, at, offer) {
		let c = this.#chips.get(id)
		if (!c) {
			const el = document.createElement('div')
			el.className = 'knorke-editing-chip'
			el.setAttribute('data-knorke-editing', id)
			setStyles(el, {
				position: 'absolute', left: '0', top: '0', display: 'flex', 'align-items': 'center', gap: '6px',
				'white-space': 'nowrap', padding: '2px 4px 2px 8px', 'border-radius': '11px', 'z-index': '4',
				font: '12px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
				'box-shadow': '0 1px 3px rgba(0,0,0,0.25)', 'pointer-events': 'none', 'will-change': 'transform',
			})
			const label = document.createElement('span')
			label.className = 'knorke-editing-chip__label'
			setStyles(label, { 'padding-right': '4px' })
			el.appendChild(label)
			this.#root.appendChild(el)
			c = { el, label, button: null, sig: '', pos: '' }
			this.#chips.set(id, c)
		}
		const name = typeof s.name === 'string' ? s.name : ''
		const text = t('knorke', '{name} is editing…', { name })
		const bg = bgOf(s.color)
		const sig = text + '|' + bg
		if (sig !== c.sig) {
			c.sig = sig
			c.label.textContent = text
			setStyles(c.el, { background: bg, color: textColorOn(bg) })
		}
		if (offer && !c.button) {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'knorke-editing-chip__take-over'
			b.setAttribute('data-knorke-action', 'take-over')
			b.textContent = t('knorke', 'Take over')
			setStyles(b, {
				'pointer-events': 'auto', margin: '0', padding: '0 8px', 'min-height': '0', height: '20px',
				'line-height': '20px', border: '0', 'border-radius': '10px', background: '#ffffff', color: '#1a1a1a',
				font: '600 12px/20px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
				cursor: 'pointer', 'box-shadow': 'none', width: 'auto', 'min-width': '0',
			}, true)
			b.addEventListener('pointerdown', (e) => e.stopPropagation())
			// keep the focus where it is (the default of mousedown moves it to the
			// button): a blur would end an open editor before the click arrives,
			// and an editor with a notice would discard its text. Keyboard users
			// still reach the button with Tab and activate it with Enter/Space.
			b.addEventListener('mousedown', (e) => e.preventDefault())
			b.addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				this.#onTakeOver(id)
			})
			c.el.appendChild(b)
			c.button = b
		} else if (!offer && c.button) {
			c.button.remove()
			c.button = null
		}
		const pos = `translate(${px(at.x)}px, ${px(at.y - 4)}px) translateY(-100%)`
		if (pos !== c.pos) {
			c.pos = pos
			c.el.style.transform = pos
		}
	}
}
