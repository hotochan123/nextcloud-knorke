/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Save as SVG" and "Save as PDF" (factory job 200): a recording 2D context.
 * KonvaRenderer.renderVector puts it under a Konva.SceneCanvas (its
 * context's _context), so the export's nodes draw into it exactly as into a
 * canvas; instead of pixels it keeps a list of drawing commands, which
 * scene/exportSvg.js and scene/exportPdf.js write out. Nothing here touches
 * the DOM: measuring text, reading named colours and copying bitmaps come
 * from the caller (the renderer gives the browser's, tests their own).
 *
 * It follows the canvas rules where they matter for the result:
 * - the path is kept in device space: each point goes through the
 *   transform current when it is added (arc, arcTo, ellipse and roundRect
 *   as cubic Béziers, ARC_SEGMENT at most per piece), so a later
 *   setTransform changes only how the stroke is drawn (Konva's
 *   strokeScaleEnabled false);
 * - a stroke's width and dashes are scaled by the transform at stroke time
 *   (√|det|); a gradient is read in the transform at fill time (kept as its
 *   matrix);
 * - state (styles, transform, clip, dashes) is saved and restored as a
 *   whole; an invalid style value is ignored like in a canvas (lineWidth
 *   ≤ 0, globalAlpha outside [0, 1], a colour that does not parse);
 * - clip() intersects: the clip is a chain of paths, each command keeps the
 *   chain it was drawn under (the same array while the clip is unchanged);
 * - fillText/strokeText keep the text with its left alphabetic baseline,
 *   moved by textAlign (measured width) and textBaseline (the font's
 *   shift from metrics); the text stays text.
 * Shadows, globalCompositeOperation, filters and letterSpacing are kept as
 * values but not drawn. Patterns, image data and Path2D throw, so an
 * export never ends half drawn without notice. (Job 203) drawImage takes
 * only the picture of an own shape (an image whose src passes
 * model/shapeImage.js isImageUri) at a destination box, (img, x, y) or
 * (img, x, y, w, h); any other image or form throws.
 *
 * Commands (ops): {op: 'group', id} and {op: 'end'} around an item
 * (beginGroup/endGroup); {op: 'path', d, fill, rule, stroke, clip};
 * {op: 'text', text, x, y, m, font, size, bold, italic, family, fill,
 * stroke, clip}; (job 203) {op: 'image', src, x, y, w, h, m, alpha, clip}
 * (the box in the units of m, alpha the globalAlpha). d is a list of
 * ['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y] and ['Z'] in device
 * space; a paint is {kind: 'color', rgb: [r, g, b], a} or a gradient
 * {kind: 'linear', coords: [x0, y0, x1, y1], …} / {kind: 'radial', coords:
 * [x0, y0, r0, x1, y1, r1], stops: [{t, rgb, a}], m, a}; a stroke is
 * {paint, width, cap, join, miter, dash, offset}.
 */
import { isImageUri } from '../model/shapeImage.js'

/** Largest sweep of one Bézier piece of an arc (radians). */
export const ARC_SEGMENT = Math.PI / 2

/** Named CSS colours resolved without the browser (the rest goes to opts.resolveColor). */
const NAMED = Object.freeze({
	black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
	gray: [128, 128, 128], grey: [128, 128, 128], yellow: [255, 255, 0], orange: [255, 165, 0],
	purple: [128, 0, 128], silver: [192, 192, 192], lime: [0, 255, 0], navy: [0, 0, 128],
})

/** The identity matrix [a, b, c, d, e, f]. */
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0])

/**
 * @param {number[]} m matrix [a, b, c, d, e, f]
 * @param {number[]} n matrix
 * @return {number[]} m · n (n applied first, as canvas transform())
 */
export function multiply(m, n) {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	]
}

/**
 * @param {number[]} m matrix
 * @param {number} x x
 * @param {number} y y
 * @return {number[]} [x', y']
 */
export function apply(m, x, y) {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/**
 * @param {number[]} m matrix
 * @return {number[]|null} its inverse, null when it is singular
 */
export function invert(m) {
	const det = m[0] * m[3] - m[1] * m[2]
	if (!det) return null
	return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}

/**
 * @param {number[]} m matrix
 * @return {number} the scale of a length under it (√|det|)
 */
export function lengthScale(m) {
	return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

/**
 * @param {string} s a number or a percentage
 * @param {number} full the value of 100 %
 * @return {number} NaN when it is neither
 */
function part(s, full) {
	const t = s.trim()
	if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%$/i.test(t)) return parseFloat(t) / 100 * full
	if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return parseFloat(t)
	return NaN
}

/**
 * A CSS colour as {rgb, a}: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba()
 * (commas or spaces, an alpha after "/", numbers or percentages),
 * "transparent" and a few names; others through resolve (the browser).
 *
 * @param {unknown} value the colour
 * @param {((s: string) => (string|null))|null} [resolve] a colour the browser normalises to #rrggbb or rgba(), null if invalid
 * @return {{rgb: number[], a: number}|null} null when it does not parse
 */
export function parseColor(value, resolve = null) {
	if (typeof value !== 'string') return null
	const s = value.trim().toLowerCase()
	let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
	if (m) {
		let h = m[1]
		if (h.length <= 4) h = [...h].map((c) => c + c).join('')
		const n = (i) => parseInt(h.slice(i, i + 2), 16)
		return { rgb: [n(0), n(2), n(4)], a: h.length === 8 ? n(6) / 255 : 1 }
	}
	m = /^rgba?\(([^)]*)\)$/.exec(s)
	if (m) {
		let body = m[1]
		let alpha = '1'
		let parts
		if (body.includes(',')) {
			parts = body.split(',')
			if (parts.length === 4) alpha = parts.pop()
		} else {
			const slash = body.split('/')
			if (slash.length > 2) return null
			if (slash.length === 2) {
				alpha = slash[1]
				body = slash[0]
			}
			parts = body.trim().split(/\s+/)
		}
		if (parts.length !== 3) return null
		const rgb = parts.map((p) => part(p, 255))
		const a = part(alpha, 1)
		if (rgb.some((v) => !Number.isFinite(v)) || !Number.isFinite(a)) return null
		return { rgb: rgb.map((v) => Math.round(Math.min(255, Math.max(0, v)))), a: Math.min(1, Math.max(0, a)) }
	}
	if (s === 'transparent') return { rgb: [0, 0, 0], a: 0 }
	if (Object.hasOwn(NAMED, s)) return { rgb: NAMED[s].slice(), a: 1 }
	if (typeof resolve === 'function') {
		const r = resolve(value)
		if (typeof r === 'string' && r.trim().toLowerCase() !== s) return parseColor(r, null)
	}
	return null
}

/**
 * @param {number} a start angle
 * @param {number} b end angle
 * @param {boolean} ccw anticlockwise
 * @return {number} the sweep of a canvas arc (signed, at most a full turn)
 */
function sweepOf(a, b, ccw) {
	const turn = 2 * Math.PI
	if (!ccw && b - a >= turn) return turn
	if (ccw && a - b >= turn) return -turn
	if (!ccw) {
		const d = (b - a) % turn
		return d < 0 ? d + turn : d
	}
	const d = (a - b) % turn
	return -(d < 0 ? d + turn : d)
}

/**
 * @param {number|{x:number, y:number}|undefined} r one radius of roundRect
 * @return {number} its size (a DOMPointInit takes its x)
 */
function radius(r) {
	const v = typeof r === 'object' && r !== null ? r.x : r
	return Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * @param {Array} d a device path
 * @return {Array} without a moveTo nothing is drawn from (rect and roundRect end with one)
 */
function drawn(d) {
	return d.filter((s, i) => s[0] !== 'M' || (i + 1 < d.length && d[i + 1][0] !== 'M'))
}

/** A canvas gradient that keeps its geometry and stops. */
class VectorGradient {
	/**
	 * @param {'linear'|'radial'} kind kind
	 * @param {number[]} coords [x0, y0, x1, y1] or [x0, y0, r0, x1, y1, r1]
	 * @param {Function|null} resolve the colour resolver
	 */
	constructor(kind, coords, resolve) {
		this.kind = kind
		this.coords = coords
		this.stops = []
		this.resolve = resolve
	}

	/**
	 * @param {number} t offset in [0, 1]
	 * @param {string} color CSS colour
	 */
	addColorStop(t, color) {
		const c = parseColor(color, this.resolve)
		if (!(t >= 0 && t <= 1) || !c) throw new RangeError('invalid colour stop')
		this.stops.push({ t, rgb: c.rgb, a: c.a })
		this.stops.sort((p, q) => p.t - q.t)
	}
}

/**
 * The state a canvas saves and restores.
 *
 * @return {object}
 */
function initialState() {
	return {
		m: IDENTITY.slice(),
		fillStyle: '#000000',
		strokeStyle: '#000000',
		lineWidth: 1,
		lineCap: 'butt',
		lineJoin: 'miter',
		miterLimit: 10,
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		font: '10px sans-serif',
		textAlign: 'start',
		textBaseline: 'alphabetic',
		direction: 'ltr',
		letterSpacing: '0px',
		shadowColor: 'rgba(0, 0, 0, 0)',
		shadowBlur: 0,
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		imageSmoothingEnabled: true,
		imageSmoothingQuality: 'low',
		filter: 'none',
		lineDashOffset: 0,
		dash: [],
		clip: [],
	}
}

/**
 * @param {string} font a CSS font shorthand ("bold normal 24px Arial, sans-serif")
 * @return {{size: number, bold: boolean, italic: boolean, family: string}}
 */
export function parseFont(font) {
	const s = String(font ?? '')
	const m = /(?:^|\s)([0-9]*\.?[0-9]+)px(?:\s*\/\s*\S+)?\s+(.+)$/.exec(s)
	const head = m ? s.slice(0, m.index) : ''
	const weight = /\b([1-9]00)\b/.exec(head)
	return {
		size: m ? parseFloat(m[1]) : 10,
		bold: /\b(bold|bolder)\b/.test(head) || (weight !== null && Number(weight[1]) >= 600),
		italic: /\b(italic|oblique)\b/.test(head),
		family: m ? m[2].trim() : 'sans-serif',
	}
}

/**
 * The recording context (see the file comment).
 */
export class VectorContext {
	/**
	 * @param {object} [opts] what the context needs from outside
	 * @param {(font: string, text: string, baseline?: string) => {width: number, shift?: number}} [opts.measure]
	 *   width of text in a font; shift: what to add to a y at that textBaseline to reach the alphabetic baseline
	 * @param {(s: string) => (string|null)} [opts.resolveColor] a colour the browser normalises, null if invalid
	 */
	constructor({ measure = null, resolveColor = null } = {}) {
		this.ops = []
		this.measureFn = measure
		this.resolveColor = resolveColor
		this.canvas = null
		this.state = initialState()
		this.stack = []
		this.path = []
		/** current point and subpath start, device space */
		this.cur = null
		this.start = null
	}

	/** @param {string} id an item id: the commands up to endGroup belong to it */
	beginGroup(id) {
		this.ops.push({ op: 'group', id: String(id) })
	}

	endGroup() {
		this.ops.push({ op: 'end' })
	}

	// ── styles ─────────────────────────────────────────────────────────

	get fillStyle() { return this.state.fillStyle }
	set fillStyle(v) { if (this.#validStyle(v)) this.state.fillStyle = v }
	get strokeStyle() { return this.state.strokeStyle }
	set strokeStyle(v) { if (this.#validStyle(v)) this.state.strokeStyle = v }
	get lineWidth() { return this.state.lineWidth }
	set lineWidth(v) { if (Number.isFinite(v) && v > 0) this.state.lineWidth = v }
	get lineCap() { return this.state.lineCap }
	set lineCap(v) { if (['butt', 'round', 'square'].includes(v)) this.state.lineCap = v }
	get lineJoin() { return this.state.lineJoin }
	set lineJoin(v) { if (['miter', 'round', 'bevel'].includes(v)) this.state.lineJoin = v }
	get miterLimit() { return this.state.miterLimit }
	set miterLimit(v) { if (Number.isFinite(v) && v > 0) this.state.miterLimit = v }
	get globalAlpha() { return this.state.globalAlpha }
	set globalAlpha(v) { if (Number.isFinite(v) && v >= 0 && v <= 1) this.state.globalAlpha = v }
	get globalCompositeOperation() { return this.state.globalCompositeOperation }
	set globalCompositeOperation(v) { this.state.globalCompositeOperation = String(v) }
	get font() { return this.state.font }
	set font(v) { this.state.font = String(v) }
	get textAlign() { return this.state.textAlign }
	set textAlign(v) { if (['start', 'end', 'left', 'right', 'center'].includes(v)) this.state.textAlign = v }
	get textBaseline() { return this.state.textBaseline }
	set textBaseline(v) { if (['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'].includes(v)) this.state.textBaseline = v }
	get direction() { return this.state.direction }
	set direction(v) { if (['ltr', 'rtl', 'inherit'].includes(v)) this.state.direction = v }
	get letterSpacing() { return this.state.letterSpacing }
	set letterSpacing(v) { this.state.letterSpacing = String(v) }
	get shadowColor() { return this.state.shadowColor }
	set shadowColor(v) { this.state.shadowColor = String(v) }
	get shadowBlur() { return this.state.shadowBlur }
	set shadowBlur(v) { if (Number.isFinite(v) && v >= 0) this.state.shadowBlur = v }
	get shadowOffsetX() { return this.state.shadowOffsetX }
	set shadowOffsetX(v) { if (Number.isFinite(v)) this.state.shadowOffsetX = v }
	get shadowOffsetY() { return this.state.shadowOffsetY }
	set shadowOffsetY(v) { if (Number.isFinite(v)) this.state.shadowOffsetY = v }
	get imageSmoothingEnabled() { return this.state.imageSmoothingEnabled }
	set imageSmoothingEnabled(v) { this.state.imageSmoothingEnabled = !!v }
	get imageSmoothingQuality() { return this.state.imageSmoothingQuality }
	set imageSmoothingQuality(v) { this.state.imageSmoothingQuality = String(v) }
	get filter() { return this.state.filter }
	set filter(v) { this.state.filter = String(v) }
	get lineDashOffset() { return this.state.lineDashOffset }
	set lineDashOffset(v) { if (Number.isFinite(v)) this.state.lineDashOffset = v }

	/**
	 * @param {unknown} v a fill or stroke style
	 * @return {boolean} a canvas would take it
	 */
	#validStyle(v) {
		if (v instanceof VectorGradient) return true
		return parseColor(v, this.resolveColor) !== null
	}

	/** @param {number[]} segs dash lengths (an odd list is doubled, as in a canvas) */
	setLineDash(segs) {
		const a = Array.from(segs ?? [])
		if (a.some((v) => !Number.isFinite(v) || v < 0)) return
		this.state.dash = a.length % 2 === 1 ? a.concat(a) : a
	}

	/** @return {number[]} the dash lengths */
	getLineDash() {
		return this.state.dash.slice()
	}

	// ── state and transform ────────────────────────────────────────────

	save() {
		this.stack.push({ ...this.state, m: this.state.m.slice(), dash: this.state.dash.slice() })
	}

	restore() {
		if (this.stack.length > 0) this.state = this.stack.pop()
	}

	/**
	 * @param {number|object} a a, or a DOMMatrix-like {a, b, c, d, e, f}
	 * @param {number} [b] b
	 * @param {number} [c] c
	 * @param {number} [d] d
	 * @param {number} [e] e
	 * @param {number} [f] f
	 */
	setTransform(a, b, c, d, e, f) {
		const m = typeof a === 'object' && a !== null ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f]
		if (m.every(Number.isFinite)) this.state.m = m
	}

	resetTransform() {
		this.state.m = IDENTITY.slice()
	}

	/**
	 * @param {number} a a
	 * @param {number} b b
	 * @param {number} c c
	 * @param {number} d d
	 * @param {number} e e
	 * @param {number} f f
	 */
	transform(a, b, c, d, e, f) {
		const n = [a, b, c, d, e, f]
		if (n.every(Number.isFinite)) this.state.m = multiply(this.state.m, n)
	}

	/** @param {number} x x @param {number} y y */
	translate(x, y) {
		this.transform(1, 0, 0, 1, x, y)
	}

	/** @param {number} x x @param {number} y y */
	scale(x, y) {
		this.transform(x, 0, 0, y, 0, 0)
	}

	/** @param {number} t angle (radians) */
	rotate(t) {
		this.transform(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0)
	}

	/** @return {{a:number, b:number, c:number, d:number, e:number, f:number}} the current transform */
	getTransform() {
		const [a, b, c, d, e, f] = this.state.m
		return { a, b, c, d, e, f }
	}

	// ── paths ──────────────────────────────────────────────────────────

	beginPath() {
		this.path = []
		this.cur = null
		this.start = null
	}

	/** @param {number} x x @param {number} y y */
	moveTo(x, y) {
		if (!Number.isFinite(x) || !Number.isFinite(y)) return
		const p = apply(this.state.m, x, y)
		this.path.push(['M', p[0], p[1]])
		this.cur = p
		this.start = p
	}

	/** @param {number} x x @param {number} y y */
	lineTo(x, y) {
		if (!Number.isFinite(x) || !Number.isFinite(y)) return
		if (!this.cur) {
			this.moveTo(x, y)
			return
		}
		const p = apply(this.state.m, x, y)
		this.path.push(['L', p[0], p[1]])
		this.cur = p
	}

	/**
	 * A cubic from the current point (device space).
	 *
	 * @param {number[]} p1 control 1
	 * @param {number[]} p2 control 2
	 * @param {number[]} p end
	 */
	#cubic(p1, p2, p) {
		this.path.push(['C', p1[0], p1[1], p2[0], p2[1], p[0], p[1]])
		this.cur = p
	}

	/**
	 * @param {number} x1 control 1 x
	 * @param {number} y1 control 1 y
	 * @param {number} x2 control 2 x
	 * @param {number} y2 control 2 y
	 * @param {number} x x
	 * @param {number} y y
	 */
	bezierCurveTo(x1, y1, x2, y2, x, y) {
		if (![x1, y1, x2, y2, x, y].every(Number.isFinite)) return
		if (!this.cur) this.moveTo(x1, y1)
		const m = this.state.m
		this.#cubic(apply(m, x1, y1), apply(m, x2, y2), apply(m, x, y))
	}

	/**
	 * @param {number} cx control x
	 * @param {number} cy control y
	 * @param {number} x x
	 * @param {number} y y
	 */
	quadraticCurveTo(cx, cy, x, y) {
		if (![cx, cy, x, y].every(Number.isFinite)) return
		if (!this.cur) this.moveTo(cx, cy)
		const m = this.state.m
		const p0 = this.cur
		const c = apply(m, cx, cy)
		const p = apply(m, x, y)
		this.#cubic([p0[0] + 2 / 3 * (c[0] - p0[0]), p0[1] + 2 / 3 * (c[1] - p0[1])], [p[0] + 2 / 3 * (c[0] - p[0]), p[1] + 2 / 3 * (c[1] - p[1])], p)
	}

	/**
	 * An elliptic arc as Béziers: centre, radii, rotation, start and sweep
	 * in the current (local) space; joined to the current point by a line.
	 *
	 * @param {number} cx centre x
	 * @param {number} cy centre y
	 * @param {number} rx radius x
	 * @param {number} ry radius y
	 * @param {number} rot rotation (radians)
	 * @param {number} a0 start angle
	 * @param {number} sweep signed sweep
	 */
	#arcPath(cx, cy, rx, ry, rot, a0, sweep) {
		const cos = Math.cos(rot)
		const sin = Math.sin(rot)
		const at = (t) => {
			const x = rx * Math.cos(t)
			const y = ry * Math.sin(t)
			return [cx + x * cos - y * sin, cy + x * sin + y * cos]
		}
		const tan = (t) => {
			const x = -rx * Math.sin(t)
			const y = ry * Math.cos(t)
			return [x * cos - y * sin, x * sin + y * cos]
		}
		const p0 = at(a0)
		if (!this.cur) this.moveTo(p0[0], p0[1])
		else {
			// a line to the start, unless the arc starts where the path is
			const d = apply(this.state.m, p0[0], p0[1])
			if (Math.abs(d[0] - this.cur[0]) > 1e-9 || Math.abs(d[1] - this.cur[1]) > 1e-9) this.lineTo(p0[0], p0[1])
		}
		const n = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_SEGMENT - 1e-9))
		const step = sweep / n
		const k = 4 / 3 * Math.tan(step / 4)
		const m = this.state.m
		for (let i = 0; i < n; i++) {
			const t0 = a0 + i * step
			const t1 = t0 + step
			const s = at(t0)
			const e = at(t1)
			const d0 = tan(t0)
			const d1 = tan(t1)
			this.#cubic(apply(m, s[0] + k * d0[0], s[1] + k * d0[1]), apply(m, e[0] - k * d1[0], e[1] - k * d1[1]), apply(m, e[0], e[1]))
		}
	}

	/**
	 * @param {number} x centre x
	 * @param {number} y centre y
	 * @param {number} r radius
	 * @param {number} a0 start angle
	 * @param {number} a1 end angle
	 * @param {boolean} [ccw] anticlockwise
	 */
	arc(x, y, r, a0, a1, ccw = false) {
		if (![x, y, r, a0, a1].every(Number.isFinite)) return
		if (r < 0) throw new RangeError('negative radius')
		this.#arcPath(x, y, r, r, 0, a0, sweepOf(a0, a1, !!ccw))
	}

	/**
	 * @param {number} x centre x
	 * @param {number} y centre y
	 * @param {number} rx radius x
	 * @param {number} ry radius y
	 * @param {number} rot rotation
	 * @param {number} a0 start angle
	 * @param {number} a1 end angle
	 * @param {boolean} [ccw] anticlockwise
	 */
	ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
		if (![x, y, rx, ry, rot, a0, a1].every(Number.isFinite)) return
		if (rx < 0 || ry < 0) throw new RangeError('negative radius')
		this.#arcPath(x, y, rx, ry, rot, a0, sweepOf(a0, a1, !!ccw))
	}

	/**
	 * @param {number} x1 corner x
	 * @param {number} y1 corner y
	 * @param {number} x2 end direction x
	 * @param {number} y2 end direction y
	 * @param {number} r radius
	 */
	arcTo(x1, y1, x2, y2, r) {
		if (![x1, y1, x2, y2, r].every(Number.isFinite)) return
		if (r < 0) throw new RangeError('negative radius')
		if (!this.cur) {
			this.moveTo(x1, y1)
			return
		}
		const inv = invert(this.state.m)
		if (!inv) return
		const [x0, y0] = apply(inv, this.cur[0], this.cur[1])
		const ax = x0 - x1
		const ay = y0 - y1
		const bx = x2 - x1
		const by = y2 - y1
		const la = Math.hypot(ax, ay)
		const lb = Math.hypot(bx, by)
		const cross = ax * by - ay * bx
		if (la === 0 || lb === 0 || r === 0 || Math.abs(cross) < 1e-12 * la * lb) {
			this.lineTo(x1, y1)
			return
		}
		const cosT = (ax * bx + ay * by) / (la * lb)
		const half = Math.acos(Math.max(-1, Math.min(1, cosT))) / 2
		const dist = r / Math.tan(half)
		const t0 = [x1 + ax / la * dist, y1 + ay / la * dist]
		const t1 = [x1 + bx / lb * dist, y1 + by / lb * dist]
		// the centre lies on the bisector, r / sin(half) from the corner
		const bis = [ax / la + bx / lb, ay / la + by / lb]
		const bl = Math.hypot(bis[0], bis[1])
		const c = [x1 + bis[0] / bl * r / Math.sin(half), y1 + bis[1] / bl * r / Math.sin(half)]
		const a0 = Math.atan2(t0[1] - c[1], t0[0] - c[0])
		const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0])
		let sweep = a1 - a0
		while (sweep > Math.PI) sweep -= 2 * Math.PI
		while (sweep < -Math.PI) sweep += 2 * Math.PI
		this.lineTo(t0[0], t0[1])
		this.#arcPath(c[0], c[1], r, r, 0, a0, sweep)
	}

	/** @param {number} x x @param {number} y y @param {number} w width @param {number} h height */
	rect(x, y, w, h) {
		if (![x, y, w, h].every(Number.isFinite)) return
		this.moveTo(x, y)
		this.lineTo(x + w, y)
		this.lineTo(x + w, y + h)
		this.lineTo(x, y + h)
		this.closePath()
	}

	/**
	 * @param {number} x x
	 * @param {number} y y
	 * @param {number} w width
	 * @param {number} h height
	 * @param {number|Array} [radii] 1–4 radii (numbers or {x, y}), like the canvas
	 */
	roundRect(x, y, w, h, radii = 0) {
		if (![x, y, w, h].every(Number.isFinite)) return
		const list = Array.isArray(radii) ? radii : [radii]
		if (list.length < 1 || list.length > 4) throw new RangeError('1 to 4 radii')
		const r = list.map(radius)
		const [tl, tr, br, bl] = r.length === 1 ? [r[0], r[0], r[0], r[0]]
			: r.length === 2 ? [r[0], r[1], r[0], r[1]]
				: r.length === 3 ? [r[0], r[1], r[2], r[1]]
					: r
		if (w < 0) {
			x += w
			w = -w
		}
		if (h < 0) {
			y += h
			h = -h
		}
		const f = Math.min(1, w / (tl + tr || 1), w / (bl + br || 1), h / (tl + bl || 1), h / (tr + br || 1))
		const [a, b, c, d] = [tl * f, tr * f, br * f, bl * f]
		this.moveTo(x + a, y)
		this.lineTo(x + w - b, y)
		if (b > 0) this.#arcPath(x + w - b, y + b, b, b, 0, -Math.PI / 2, Math.PI / 2)
		this.lineTo(x + w, y + h - c)
		if (c > 0) this.#arcPath(x + w - c, y + h - c, c, c, 0, 0, Math.PI / 2)
		this.lineTo(x + d, y + h)
		if (d > 0) this.#arcPath(x + d, y + h - d, d, d, 0, Math.PI / 2, Math.PI / 2)
		this.lineTo(x, y + a)
		if (a > 0) this.#arcPath(x + a, y + a, a, a, 0, Math.PI, Math.PI / 2)
		this.closePath()
		this.moveTo(x, y)
	}

	closePath() {
		if (!this.cur) return
		this.path.push(['Z'])
		this.cur = this.start
	}

	// ── drawing ────────────────────────────────────────────────────────

	/**
	 * @param {unknown} style a fill or stroke style
	 * @return {object|null} its paint (globalAlpha included), null when nothing shows
	 */
	#paint(style) {
		const ga = this.state.globalAlpha
		if (style instanceof VectorGradient) {
			if (style.stops.length === 0 || ga === 0) return null
			return { kind: style.kind, coords: style.coords.slice(), stops: style.stops.map((s) => ({ ...s, rgb: s.rgb.slice() })), m: this.state.m.slice(), a: ga }
		}
		const c = parseColor(style, this.resolveColor)
		if (!c || c.a * ga === 0) return null
		return { kind: 'color', rgb: c.rgb, a: c.a * ga }
	}

	/** @return {object|null} the stroke of the current state, null when nothing shows */
	#stroke() {
		const paint = this.#paint(this.state.strokeStyle)
		if (!paint) return null
		const k = lengthScale(this.state.m)
		return {
			paint,
			width: this.state.lineWidth * k,
			cap: this.state.lineCap,
			join: this.state.lineJoin,
			miter: this.state.miterLimit,
			dash: this.state.dash.map((v) => v * k),
			offset: this.state.lineDashOffset * k,
		}
	}

	/**
	 * @param {Array} d a path
	 * @param {object|null} fill paint
	 * @param {string} rule fill rule
	 * @param {object|null} stroke stroke
	 */
	#pushPath(d, fill, rule, stroke) {
		const kept = drawn(d)
		if ((!fill && !stroke) || !kept.some((s) => s[0] !== 'M' && s[0] !== 'Z')) return
		this.ops.push({ op: 'path', d: kept.map((s) => s.slice()), fill, rule, stroke, clip: this.state.clip })
	}

	/** @param {unknown} [rule] 'nonzero' or 'evenodd' (a Path2D throws) */
	fill(rule = 'nonzero') {
		if (typeof rule !== 'string') throw new TypeError('Path2D is not supported')
		this.#pushPath(this.path, this.#paint(this.state.fillStyle), rule === 'evenodd' ? 'evenodd' : 'nonzero', null)
	}

	/** @param {unknown} [path] a Path2D throws */
	stroke(path) {
		if (path !== undefined) throw new TypeError('Path2D is not supported')
		this.#pushPath(this.path, null, 'nonzero', this.#stroke())
	}

	/**
	 * @param {number} x x
	 * @param {number} y y
	 * @param {number} w width
	 * @param {number} h height
	 * @return {Array} the rectangle as a device path
	 */
	#rectPath(x, y, w, h) {
		const m = this.state.m
		return [['M', ...apply(m, x, y)], ['L', ...apply(m, x + w, y)], ['L', ...apply(m, x + w, y + h)], ['L', ...apply(m, x, y + h)], ['Z']]
	}

	/** @param {number} x x @param {number} y y @param {number} w width @param {number} h height */
	fillRect(x, y, w, h) {
		if (![x, y, w, h].every(Number.isFinite) || w === 0 || h === 0) return
		this.#pushPath(this.#rectPath(x, y, w, h), this.#paint(this.state.fillStyle), 'nonzero', null)
	}

	/** @param {number} x x @param {number} y y @param {number} w width @param {number} h height */
	strokeRect(x, y, w, h) {
		if (![x, y, w, h].every(Number.isFinite)) return
		this.#pushPath(this.#rectPath(x, y, w, h), null, 'nonzero', this.#stroke())
	}

	/** Nothing to clear: the export starts on its own background. */
	clearRect() {}

	/** @param {unknown} [rule] 'nonzero' or 'evenodd' */
	clip(rule = 'nonzero') {
		if (typeof rule !== 'string') throw new TypeError('Path2D is not supported')
		this.state.clip = this.state.clip.concat([{ d: drawn(this.path).map((s) => s.slice()), rule: rule === 'evenodd' ? 'evenodd' : 'nonzero' }])
	}

	/**
	 * @param {string} text text
	 * @return {{width: number, actualBoundingBoxAscent: number, actualBoundingBoxDescent: number,
	 *   fontBoundingBoxAscent: number, fontBoundingBoxDescent: number}} TextMetrics of the current font
	 */
	measureText(text) {
		const f = parseFont(this.state.font)
		const width = this.measureFn ? this.measureFn(this.state.font, String(text)).width : 0.5 * f.size * String(text).length
		return { width, actualBoundingBoxAscent: 0.8 * f.size, actualBoundingBoxDescent: 0.2 * f.size, fontBoundingBoxAscent: 0.9 * f.size, fontBoundingBoxDescent: 0.2 * f.size }
	}

	/**
	 * @param {string} text text
	 * @param {number} x x
	 * @param {number} y y
	 * @param {boolean} stroke strokeText
	 */
	#text(text, x, y, stroke) {
		const s = String(text)
		if (!Number.isFinite(x) || !Number.isFinite(y) || s === '') return
		const font = this.state.font
		const f = parseFont(font)
		const fill = stroke ? null : this.#paint(this.state.fillStyle)
		const line = stroke ? this.#stroke() : null
		if (!fill && !line) return
		const base = this.state.textBaseline
		const m = this.measureFn ? this.measureFn(font, s, base) : { width: 0.5 * f.size * s.length, shift: 0 }
		let align = this.state.textAlign
		if (align === 'start') align = this.state.direction === 'rtl' ? 'right' : 'left'
		if (align === 'end') align = this.state.direction === 'rtl' ? 'left' : 'right'
		const dx = align === 'center' ? -m.width / 2 : align === 'right' ? -m.width : 0
		const dy = base === 'alphabetic' ? 0 : (Number.isFinite(m.shift) ? m.shift : 0)
		if (line) {
			// the text keeps its own matrix: the stroke stays in its units
			Object.assign(line, { width: this.state.lineWidth, dash: this.state.dash.slice(), offset: this.state.lineDashOffset })
		}
		this.ops.push({
			op: 'text',
			text: s,
			x: x + dx,
			y: y + dy,
			width: m.width,
			m: this.state.m.slice(),
			font,
			size: f.size,
			bold: f.bold,
			italic: f.italic,
			family: f.family,
			fill,
			stroke: line,
			clip: this.state.clip,
		})
	}

	/** @param {string} text text @param {number} x x @param {number} y y */
	fillText(text, x, y) {
		this.#text(text, x, y, false)
	}

	/** @param {string} text text @param {number} x x @param {number} y y */
	strokeText(text, x, y) {
		this.#text(text, x, y, true)
	}

	/**
	 * @param {string} kind linear or radial
	 * @param {number[]} coords its geometry
	 * @return {VectorGradient}
	 */
	#gradient(kind, coords) {
		if (!coords.every(Number.isFinite)) throw new TypeError('non-finite gradient')
		return new VectorGradient(kind, coords, this.resolveColor)
	}

	/** @param {number} x0 x0 @param {number} y0 y0 @param {number} x1 x1 @param {number} y1 y1 @return {VectorGradient} */
	createLinearGradient(x0, y0, x1, y1) {
		return this.#gradient('linear', [x0, y0, x1, y1])
	}

	/**
	 * @param {number} x0 x0
	 * @param {number} y0 y0
	 * @param {number} r0 r0
	 * @param {number} x1 x1
	 * @param {number} y1 y1
	 * @param {number} r1 r1
	 * @return {VectorGradient}
	 */
	createRadialGradient(x0, y0, r0, x1, y1, r1) {
		if (r0 < 0 || r1 < 0) throw new RangeError('negative radius')
		return this.#gradient('radial', [x0, y0, r0, x1, y1, r1])
	}

	createPattern() {
		throw new TypeError('patterns are not supported')
	}

	/**
	 * (Job 203) The picture of an own shape at a box (see the file comment).
	 *
	 * @param {{src: string, naturalWidth?: number, naturalHeight?: number, width?: number, height?: number}} img the decoded picture
	 * @param {...number} box x, y or x, y, w, h
	 */
	drawImage(img, ...box) {
		const src = img?.src
		if (!isImageUri(src)) throw new TypeError('only pictures of own shapes are supported')
		if (box.length !== 2 && box.length !== 4) throw new TypeError('source rectangles are not supported')
		const [x, y] = box
		const w = box.length === 4 ? box[2] : (img.naturalWidth || img.width)
		const h = box.length === 4 ? box[3] : (img.naturalHeight || img.height)
		if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return
		this.ops.push({ op: 'image', src, x, y, w, h, m: this.state.m.slice(), alpha: this.state.globalAlpha, clip: this.state.clip })
	}

	getImageData() {
		throw new TypeError('image data is not supported')
	}

	putImageData() {
		throw new TypeError('image data is not supported')
	}

	createImageData() {
		throw new TypeError('image data is not supported')
	}

	/** @return {boolean} never a hit (the export has no hit canvas) */
	isPointInPath() {
		return false
	}
}
