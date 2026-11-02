/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Laser pointer trails (factory job 171) in the scene's DOM overlay: the own
 * trail (the points the scene reported while the laser was pressed, drawn at
 * once) and those of the others (RemoteSample.laser, already played back by
 * src/sync/presence.js). One <canvas> above the items and under the cursors
 * (z-index 2; cursors 3, chips 4), pointer-events none, made when a trail
 * first has a point in view.
 *
 * Every trail is a LASER_LINE_PX line in the person's colour, the same width
 * at every zoom, over a translucent glow of LASER_GLOW_PX, with a dot of
 * LASER_TIP_PX at the tip of each stroke. A piece between two points is fully
 * visible when it appears and fades evenly with the age of its older end,
 * gone after FADE; neighbouring pieces of the same opacity step are drawn as
 * one path, so no round caps pile up. The layer is drawn with the camera the
 * user sees (live during a gesture). A trail without a point in view is
 * neither painted nor counted; keys lists the painted ones of the last
 * render, sorted (`<pid>:<client>`, the own trail 'self').
 */
import { LASER_FADE_MS, LASER_GLOW_ALPHA, LASER_GLOW_PX, LASER_LINE_PX, LASER_TIP_PX } from '../model/tokens.js'
import { setStyles } from './CursorLayer.js'

/** A trail piece is gone after this long (ms). */
export const FADE = LASER_FADE_MS
/** The key of the own trail in keys (stats().lasers). */
export const SELF = 'self'
/** Opacity steps of the pieces. */
const STEPS = 10
const HEX6 = /^#[0-9a-fA-F]{6}$/

/**
 * @param {Array<[number, number, number]>} s stroke, points [x, y, age]
 * @param {{x:number, y:number, scale:number}} cam camera
 * @param {number} w container width
 * @param {number} h container height
 * @return {boolean} a point of the stroke lies in view
 */
function inView(s, cam, w, h) {
	for (const p of s) {
		const x = (p[0] - cam.x) * cam.scale
		const y = (p[1] - cam.y) * cam.scale
		if (x >= 0 && y >= 0 && x <= w && y <= h) return true
	}
	return false
}

/**
 * @param {number} age ms
 * @return {number} opacity 0..1
 */
const alphaOf = (age) => Math.min(1, Math.max(0, 1 - age / FADE))

export class LaserLayer {
	#root
	#canvas = null
	#ctx = null
	#color = '#5f6368'
	/** own strokes, each a list of [x, y, t] (world, time); the last one runs while #down */
	#own = []
	#down = false
	/** @type {string[]} */
	#keys = []
	/** the canvas holds pixels */
	#painted = false
	#w = 0
	#h = 0
	#dpr = 1

	/** @param {HTMLElement} root overlay element (pointer-events: none) */
	constructor(root) {
		this.#root = root
	}

	/** @param {string} color #rrggbb of the own trail (others' come with their samples) */
	setColor(color) {
		if (typeof color === 'string' && HEX6.test(color)) this.#color = color
	}

	/**
	 * A point of the own stroke; the first after end() starts a new stroke.
	 *
	 * @param {number} x world x
	 * @param {number} y world y
	 * @param {number} t time (performance.now())
	 */
	add(x, y, t) {
		if (!this.#down) {
			this.#own.push([])
			this.#down = true
		}
		this.#own[this.#own.length - 1].push([x, y, t])
	}

	/** The own stroke ends (release, cancel). */
	end() {
		this.#down = false
	}

	/** @return {string[]} the trails the last render painted, sorted */
	get keys() {
		return this.#keys
	}

	/**
	 * @param {number} now time
	 * @return {boolean} a frame is needed: an own point younger than FADE, or pixels to clear
	 */
	active(now) {
		return this.#painted || this.#own.some((s) => s.some((p) => now - p[2] <= FADE))
	}

	/**
	 * Draws one frame.
	 *
	 * @param {Array<object>} samples RemoteSample[] (laser: strokes of [x, y, age]; missing = none)
	 * @param {{x:number, y:number, scale:number}} cam camera the user sees
	 * @param {{w:number, h:number}} size container size (px)
	 * @param {number} now time
	 */
	render(samples, cam, size, now) {
		this.#prune(now)
		const w = size.w
		const h = size.h
		const trails = []
		if (this.#own.length > 0) {
			const strokes = this.#own.map((s) => s.filter((p) => now - p[2] <= FADE).map((p) => [p[0], p[1], now - p[2]])).filter((s) => s.length > 0)
			if (strokes.some((s) => inView(s, cam, w, h))) trails.push({ key: SELF, color: this.#color, strokes })
		}
		for (const s of samples) {
			if (!s || typeof s.key !== 'string' || !Array.isArray(s.laser) || s.laser.length === 0) continue
			const strokes = s.laser.filter((x) => Array.isArray(x) && x.length > 0)
			if (strokes.some((x) => inView(x, cam, w, h))) trails.push({ key: s.key, color: HEX6.test(s.color) ? s.color : '#5f6368', strokes })
		}
		this.#keys = trails.map((x) => x.key).sort()
		if (trails.length === 0) {
			if (this.#painted) this.#clear()
			return
		}
		const ctx = this.#context(w, h)
		if (ctx === null) return
		this.#clear()
		for (const t of trails) this.#paint(ctx, t, cam)
		this.#painted = true
	}

	/** Removes the canvas and forgets every trail. */
	destroy() {
		this.#canvas?.remove()
		this.#canvas = null
		this.#ctx = null
		this.#own = []
		this.#keys = []
		this.#painted = false
	}

	// ---------------------------------------------------------------- internals

	/** Own points older than FADE go; empty strokes too, except the running one. */
	#prune(now) {
		const last = this.#own.length - 1
		this.#own = this.#own.map((s) => s.filter((p) => now - p[2] <= FADE)).filter((s, i) => s.length > 0 || (this.#down && i === last))
		if (this.#own.length === 0 && this.#down) this.#own.push([])
	}

	/**
	 * @param {number} w width
	 * @param {number} h height
	 * @return {CanvasRenderingContext2D|null} the canvas context at this size (made on the first call)
	 */
	#context(w, h) {
		if (this.#canvas === null) {
			const c = document.createElement('canvas')
			c.className = 'knorke-laser'
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

	/**
	 * @param {CanvasRenderingContext2D} ctx context
	 * @param {{color:string, strokes:Array<Array<[number, number, number]>>}} t trail
	 * @param {{x:number, y:number, scale:number}} cam camera
	 */
	#paint(ctx, t, cam) {
		const dpr = this.#dpr
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		ctx.strokeStyle = t.color
		ctx.fillStyle = t.color
		const sx = (p) => (p[0] - cam.x) * cam.scale
		const sy = (p) => (p[1] - cam.y) * cam.scale
		for (const [width, share] of [[LASER_GLOW_PX, LASER_GLOW_ALPHA], [LASER_LINE_PX, 1]]) {
			ctx.lineWidth = width
			for (const s of t.strokes) {
				// runs of pieces with the same opacity step: one path each
				let i = 1
				while (i < s.length) {
					const step = Math.round(alphaOf(s[i - 1][2]) * STEPS)
					let j = i
					while (j + 1 < s.length && Math.round(alphaOf(s[j][2]) * STEPS) === step) j++
					if (step > 0) {
						ctx.globalAlpha = (step / STEPS) * share
						ctx.beginPath()
						ctx.moveTo(sx(s[i - 1]), sy(s[i - 1]))
						for (let k = i; k <= j; k++) ctx.lineTo(sx(s[k]), sy(s[k]))
						ctx.stroke()
					}
					i = j + 1
				}
			}
		}
		for (const s of t.strokes) {
			const tip = s[s.length - 1]
			const a = alphaOf(tip[2])
			if (a <= 0) continue
			ctx.globalAlpha = a
			ctx.beginPath()
			ctx.arc(sx(tip), sy(tip), LASER_TIP_PX / 2, 0, Math.PI * 2)
			ctx.fill()
		}
		ctx.globalAlpha = 1
	}
}
