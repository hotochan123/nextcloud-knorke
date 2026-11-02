/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The running pen stroke (factory job 273) in the scene's DOM overlay: one
 * <canvas> above the items and under the cursors (z-index 2, like the laser
 * trails), pointer-events none, made with the first stroke. While the pen or
 * the highlighter is pressed it shows the points so far as the smooth line
 * the stroke will get (model/ink.js tracePath) in its colour, width and
 * opacity, drawn with the camera the user sees; the eraser shows its path as
 * a thin grey line of its reach. Nobody else sees it: the stroke is one put
 * at the release (SceneManager), the others see the item.
 */
import { tracePath } from '../model/ink.js'
import { setStyles } from './CursorLayer.js'

/** Colour and opacity of the eraser's path. */
const ERASER_COLOR = '#6f6f6d'
const ERASER_ALPHA = 0.25

export class InkLayer {
	#root
	#canvas = null
	#ctx = null
	/** @type {{pts:number[], color:string, width:number, opacity:number, eraser:boolean, reachPx:number}|null} */
	#stroke = null
	#painted = false
	#w = 0
	#h = 0
	#dpr = 1

	/** @param {HTMLElement} root overlay element (pointer-events: none) */
	constructor(root) {
		this.#root = root
	}

	/**
	 * @param {{pts:number[], color?:string, width?:number, opacity?:number, eraser?:boolean, reachPx?:number}|null} s
	 *   the running stroke (points in world units, flat), or null: none
	 */
	set(s) {
		this.#stroke = s && Array.isArray(s.pts) ? {
			pts: s.pts, color: s.color ?? ERASER_COLOR, width: s.width ?? 1, opacity: s.opacity ?? 1, eraser: s.eraser === true, reachPx: s.reachPx ?? 8,
		} : null
	}

	/** @return {boolean} a frame is needed (a stroke runs, or pixels to clear) */
	active() {
		return this.#stroke !== null || this.#painted
	}

	/** @return {boolean} a stroke is shown */
	get showing() {
		return this.#stroke !== null
	}

	/**
	 * @param {{x:number, y:number, scale:number}} cam camera the user sees
	 * @param {{w:number, h:number}} size container size (px)
	 */
	render(cam, size) {
		const s = this.#stroke
		if (s === null || s.pts.length < 2) {
			if (this.#painted) this.#clear()
			return
		}
		const ctx = this.#context(size.w, size.h)
		if (ctx === null) return
		this.#clear()
		const dpr = this.#dpr
		ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, -cam.x * cam.scale * dpr, -cam.y * cam.scale * dpr)
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		ctx.strokeStyle = s.color
		ctx.globalAlpha = s.eraser ? ERASER_ALPHA : s.opacity
		ctx.lineWidth = s.eraser ? (2 * s.reachPx) / cam.scale : s.width
		ctx.beginPath()
		tracePath(ctx, s.pts)
		ctx.stroke()
		ctx.globalAlpha = 1
		this.#painted = true
	}

	/** Removes the canvas. */
	destroy() {
		this.#canvas?.remove()
		this.#canvas = null
		this.#ctx = null
		this.#stroke = null
		this.#painted = false
	}

	/**
	 * @param {number} w width
	 * @param {number} h height
	 * @return {CanvasRenderingContext2D|null}
	 */
	#context(w, h) {
		if (this.#canvas === null) {
			if (typeof document === 'undefined') return null
			const c = document.createElement('canvas')
			c.className = 'knorke-ink'
			c.setAttribute('aria-hidden', 'true')
			setStyles(c, { position: 'absolute', left: '0', top: '0', 'pointer-events': 'none', 'z-index': '2' })
			this.#root.appendChild(c)
			this.#canvas = c
			this.#ctx = typeof c.getContext === 'function' ? c.getContext('2d') : null
			this.#w = -1
		}
		const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? Math.min(2, window.devicePixelRatio) : 1
		if (w !== this.#w || h !== this.#h || dpr !== this.#dpr) {
			this.#w = w
			this.#h = h
			this.#dpr = dpr
			this.#canvas.width = Math.max(1, Math.round(w * dpr))
			this.#canvas.height = Math.max(1, Math.round(h * dpr))
			setStyles(this.#canvas, { width: w + 'px', height: h + 'px' })
		}
		return this.#ctx
	}

	#clear() {
		this.#painted = false
		if (this.#ctx === null) return
		this.#ctx.setTransform(1, 0, 0, 1, 0, 0)
		this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height)
	}
}
