/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Camera math (SPEC-M0 §6.3), pure and testable in Node.
 *
 * A camera is {x, y, scale}: x/y is the world coordinate of the top-left
 * corner of the viewport, scale the zoom (1 = 100 %). Screen coordinates are
 * relative to the scene container:
 *
 *   screen = (world - camera) * scale        world = camera + screen / scale
 *
 * The Konva stage gets exactly this camera as ONE setAttrs call
 * ({scaleX: s, scaleY: s, x: -x * s + l, y: -y * s + t}, l/t = the overscan
 * of the stage); see KonvaRenderer.
 *
 * Overscan and coverage (M2, SPEC-M1 §6.3 "Überstand und Deckungsregel"): the
 * stage is larger than the viewport by {l, r, t, b} CSS px (overscanFor: at
 * most OVERSCAN_MAX_PX per side within a device-pixel and an area budget);
 * a CSS gesture redraws in between exactly when the transformed stage would
 * stop covering the viewport (more than COVER_TOL_PX at an edge) or the
 * scale ratio exceeds GESTURE_K_MAX (needsGestureRedraw).
 */
import { MAX_SCALE, MIN_SCALE } from '../model/tokens.js'

/** @typedef {{x:number, y:number, scale:number}} CameraState */

/** Fit never zooms in beyond 100 %: a board with one note should not open at 400 %. */
export const FIT_MAX_SCALE = 1

/**
 * @param {number} s scale
 * @param {number} min lower bound
 * @param {number} max upper bound
 * @return {number} clamped scale
 */
export function clampScale(s, min = MIN_SCALE, max = MAX_SCALE) {
	return Math.min(max, Math.max(min, s))
}

/**
 * Zoom around a screen point: the world point under (sx, sy) stays fixed.
 *
 * @param {CameraState} cam camera before
 * @param {number} sx anchor x (container coordinates)
 * @param {number} sy anchor y (container coordinates)
 * @param {number} factor scale factor (> 1 zooms in)
 * @param {number} [min] lower scale bound
 * @param {number} [max] upper scale bound
 * @return {CameraState} new camera
 */
export function zoomCamera(cam, sx, sy, factor, min = MIN_SCALE, max = MAX_SCALE) {
	if (!Number.isFinite(factor) || factor <= 0) {
		return { x: cam.x, y: cam.y, scale: cam.scale }
	}
	const scale = clampScale(cam.scale * factor, min, max)
	const wx = cam.x + sx / cam.scale
	const wy = cam.y + sy / cam.scale
	return { x: wx - sx / scale, y: wy - sy / scale, scale }
}

/**
 * CSS transform that turns the picture rendered with camera c0 into the
 * picture of camera c1, with the origin at the host's top-left corner
 * (.konvajs-content sits at −l, −t and has transform-origin "l px t px",
 * the same point): screen1 = k * screen0 + (tx, ty).
 *
 * @param {CameraState} c0 camera the canvas was drawn with
 * @param {CameraState} c1 live camera
 * @return {{k:number, tx:number, ty:number}} k = s1 / s0, tx = (x0 - x1) * s1, ty = (y0 - y1) * s1
 */
export function cssTransformFor(c0, c1) {
	return { k: c1.scale / c0.scale, tx: (c0.x - c1.x) * c1.scale, ty: (c0.y - c1.y) * c1.scale }
}

export class Camera {
	#min
	#max

	/**
	 * @param {{minScale?:number, maxScale?:number}} [opts] zoom range
	 */
	constructor({ minScale = MIN_SCALE, maxScale = MAX_SCALE } = {}) {
		this.#min = minScale
		this.#max = maxScale
		this.x = 0
		this.y = 0
		this.scale = 1
	}

	/** @return {CameraState} copy */
	get() {
		return { x: this.x, y: this.y, scale: this.scale }
	}

	/**
	 * Sets the camera; the scale is clamped, non-finite values keep the old value.
	 *
	 * @param {number} x world x of the top-left corner
	 * @param {number} y world y of the top-left corner
	 * @param {number} scale zoom
	 * @return {CameraState} the camera now in effect
	 */
	set(x, y, scale) {
		if (Number.isFinite(scale) && scale > 0) this.scale = clampScale(scale, this.#min, this.#max)
		if (Number.isFinite(x)) this.x = x
		if (Number.isFinite(y)) this.y = y
		return this.get()
	}

	/**
	 * @param {number} sx container x
	 * @param {number} sy container y
	 * @return {{x:number, y:number}} world point
	 */
	screenToWorld(sx, sy) {
		return { x: this.x + sx / this.scale, y: this.y + sy / this.scale }
	}

	/**
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @return {{x:number, y:number}} container point
	 */
	worldToScreen(wx, wy) {
		return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale }
	}

	/**
	 * @param {number} sx anchor x (container)
	 * @param {number} sy anchor y (container)
	 * @param {number} factor scale factor
	 * @return {CameraState} new camera (this camera is not changed)
	 */
	zoomAt(sx, sy, factor) {
		return zoomCamera(this.get(), sx, sy, factor, this.#min, this.#max)
	}

	/**
	 * Camera that shows rect centred with padPx on every side. An empty board
	 * (rect null) gets {x: -vw/2, y: -vh/2, scale: 1} (world origin centred).
	 * Never zooms in beyond FIT_MAX_SCALE.
	 *
	 * @param {{x:number, y:number, w:number, h:number}|null} rect world rectangle
	 * @param {number} vw viewport width
	 * @param {number} vh viewport height
	 * @param {number} [padPx] screen padding
	 * @return {CameraState}
	 */
	fit(rect, vw, vh, padPx = 48) {
		if (!rect || !(vw > 0) || !(vh > 0)) {
			return { x: -(vw > 0 ? vw : 0) / 2, y: -(vh > 0 ? vh : 0) / 2, scale: 1 }
		}
		const aw = Math.max(1, vw - 2 * padPx)
		const ah = Math.max(1, vh - 2 * padPx)
		const sw = rect.w > 0 ? aw / rect.w : Infinity
		const sh = rect.h > 0 ? ah / rect.h : Infinity
		let scale = Math.min(sw, sh, FIT_MAX_SCALE)
		scale = clampScale(scale, this.#min, Math.min(this.#max, FIT_MAX_SCALE))
		const cx = rect.x + rect.w / 2
		const cy = rect.y + rect.h / 2
		return { x: cx - vw / (2 * scale), y: cy - vh / (2 * scale), scale }
	}

	/**
	 * World rectangle of the viewport, widened by marginFrac on every side.
	 *
	 * @param {number} vw viewport width
	 * @param {number} vh viewport height
	 * @param {number} [marginFrac] margin as a fraction of the viewport size
	 * @return {{minX:number, minY:number, maxX:number, maxY:number}}
	 */
	viewRect(vw, vh, marginFrac = 0.1) {
		return viewRectOf(this.get(), vw, vh, marginFrac)
	}
}

/**
 * @param {CameraState} cam camera
 * @param {number} vw viewport width
 * @param {number} vh viewport height
 * @param {number} [marginFrac] margin as a fraction of the viewport size
 * @return {{minX:number, minY:number, maxX:number, maxY:number}} world rectangle
 */
export function viewRectOf(cam, vw, vh, marginFrac = 0.1) {
	const w = vw / cam.scale
	const h = vh / cam.scale
	const mx = w * marginFrac
	const my = h * marginFrac
	return { minX: cam.x - mx, minY: cam.y - my, maxX: cam.x + w + mx, maxY: cam.y + h + my }
}

// ---------------------------------------------------------------- overscan (M2)

/** Overscan of the stage: at most this many CSS px per side… */
export const OVERSCAN_MAX_PX = 384
/** …and none below this (a thinner margin is not worth its bitmap). */
export const OVERSCAN_MIN_PX = 64
/** Device-pixel budget per layer (iOS allows 16.7 M px per canvas up to Safari 17). */
export const OVERSCAN_DEVICE_PX = 12000000
/** The stage covers at most this many times the viewport area. */
export const OVERSCAN_AREA_FACTOR = 3
/** CSS gesture: redraw in between above this scale ratio (the bitmap would get too coarse). */
export const GESTURE_K_MAX = 2
/** An edge of the transformed stage may lie this far inside the viewport (subpixels, rounding). */
export const COVER_TOL_PX = 1
/** Float slack of the coverage test (a gap of exactly COVER_TOL_PX stays covered). */
const COVER_EPS = 1e-6

/** @typedef {{l:number, r:number, t:number, b:number, stageW:number, stageH:number}} Overscan */

/** @param {number} v value @return {number} v when finite and > 0, else 0 */
const positive = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
/** @param {number} pr pixel ratio @return {number} pr when finite and > 0, else 1 */
const ratio = (pr) => (Number.isFinite(pr) && pr > 0 ? pr : 1)

/**
 * @param {number} sw stage width
 * @param {number} sh stage height
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {number} pr pixel ratio
 * @return {boolean} the stage keeps the device-pixel and the area budget
 */
function inBudget(sw, sh, w, h, pr) {
	return sw * sh * pr * pr <= OVERSCAN_DEVICE_PX && sw * sh <= OVERSCAN_AREA_FACTOR * w * h
}

/**
 * Overscan per side for a viewport: the largest whole M in [0, OVERSCAN_MAX_PX]
 * whose stage (w + 2M) × (h + 2M) keeps both budgets; 0 when that M is below
 * OVERSCAN_MIN_PX or none fits (the viewport alone breaks the budget).
 *
 * @param {number} w viewport width (CSS px)
 * @param {number} h viewport height (CSS px)
 * @param {number} pr pixel ratio (not finite or ≤ 0: 1)
 * @return {number} M (CSS px); 0 for a non-finite or non-positive w or h
 */
export function overscanFor(w, h, pr) {
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0
	const p = ratio(pr)
	// both bounds grow with M: the first M from the top that fits is the largest
	for (let m = OVERSCAN_MAX_PX; m >= OVERSCAN_MIN_PX; m--) {
		if (inBudget(w + 2 * m, h + 2 * m, w, h, p)) return m
	}
	return 0
}

/**
 * Symmetric stage for a viewport (mount, and every reallocation).
 *
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {number} pr pixel ratio
 * @return {Overscan}
 */
export function overscanLayout(w, h, pr) {
	const m = overscanFor(w, h, pr)
	return { l: m, r: m, t: m, b: m, stageW: positive(w) + 2 * m, stageH: positive(h) + 2 * m }
}

/**
 * Stage after a resize: the old one is kept and only re-centred while it
 * leaves at least 0.75 · M' per side (M' = overscanFor of the new viewport)
 * and stays within both budgets; otherwise it is laid out anew. An odd
 * difference gives the left (top) side the rounded-down half.
 *
 * @param {Overscan|null} prev stage before
 * @param {number} w new viewport width
 * @param {number} h new viewport height
 * @param {number} pr pixel ratio
 * @return {Overscan & {kept:boolean}}
 */
export function overscanResize(prev, w, h, pr) {
	const sw = prev?.stageW
	const sh = prev?.stageH
	if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw < 0 || sh < 0) return { ...overscanLayout(w, h, pr), kept: false }
	const vw = positive(w)
	const vh = positive(h)
	const need = 0.75 * overscanFor(w, h, pr)
	const l = Math.floor((sw - vw) / 2)
	const t = Math.floor((sh - vh) / 2)
	const r = sw - vw - l
	const b = sh - vh - t
	if (l >= need && r >= need && t >= need && b >= need && inBudget(sw, sh, vw, vh, ratio(pr))) {
		return { l, r, t, b, stageW: sw, stageH: sh, kept: true }
	}
	return { ...overscanLayout(w, h, pr), kept: false }
}

/** @param {object|null|undefined} ov overscan @return {{l:number, r:number, t:number, b:number}} its sides, 0 where missing */
function sidesOf(ov) {
	return { l: positive(ov?.l), r: positive(ov?.r), t: positive(ov?.t), b: positive(ov?.b) }
}

/**
 * World rectangle of the whole stage (viewport plus overscan).
 *
 * @param {CameraState} cam camera the stage is drawn with
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {Overscan|null} ov overscan (null: none)
 * @return {{minX:number, minY:number, maxX:number, maxY:number}}
 */
export function stageRectOf(cam, w, h, ov) {
	const o = sidesOf(ov)
	const s = cam.scale
	return { minX: cam.x - o.l / s, minY: cam.y - o.t / s, maxX: cam.x + (w + o.r) / s, maxY: cam.y + (h + o.b) / s }
}

/**
 * World rectangle the renderer culls against: the viewport plus, per side,
 * the larger of the overscan and marginFrac of the viewport size (the
 * stage, never less than viewport + 10 %). Without an overscan this is
 * exactly viewRectOf(cam, w, h, marginFrac).
 *
 * @param {CameraState} cam camera
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {Overscan|null} ov overscan (null or missing: none)
 * @param {number} [marginFrac] margin as a fraction of the viewport size
 * @return {{minX:number, minY:number, maxX:number, maxY:number}}
 */
export function cullRectOf(cam, w, h, ov, marginFrac = 0.1) {
	if (!ov) return viewRectOf(cam, w, h, marginFrac)
	const o = sidesOf(ov)
	const s = cam.scale
	// world units in the order of viewRectOf: equal floats when every side is 0
	const ww = w / s
	const hh = h / s
	const mx = ww * marginFrac
	const my = hh * marginFrac
	return {
		minX: cam.x - Math.max(o.l / s, mx),
		minY: cam.y - Math.max(o.t / s, my),
		maxX: cam.x + ww + Math.max(o.r / s, mx),
		maxY: cam.y + hh + Math.max(o.b / s, my),
	}
}

/**
 * Does the stage, moved by the CSS transform {k, tx, ty} (screen1 = k ·
 * screen0 + t, origin at the viewport's top-left corner), still cover the
 * viewport? Gaps per edge: left tx − k·l, top ty − k·t, right
 * w − (tx + k·(w + r)), bottom h − (ty + k·(h + b)); covered when all are ≤ tol.
 *
 * @param {{k:number, tx:number, ty:number}} css transform
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {Overscan|null} ov overscan (null: none)
 * @param {number} [tol] allowed gap (CSS px)
 * @return {boolean} false also for non-finite values
 */
export function stageCovers({ k, tx, ty }, w, h, ov, tol = COVER_TOL_PX) {
	const o = sidesOf(ov)
	const lim = tol + COVER_EPS
	return tx - k * o.l <= lim && ty - k * o.t <= lim &&
		w - (tx + k * (w + o.r)) <= lim && h - (ty + k * (h + o.b)) <= lim
}

/**
 * The coverage rule of the CSS gesture (replaces the M0 rule): redraw in
 * between when the transform is not finite, k ≤ 0, k > GESTURE_K_MAX, or the
 * stage would stop covering the viewport.
 *
 * @param {{k:number, tx:number, ty:number}} css transform from the drawn camera to the live one
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {Overscan|null} ov overscan
 * @return {boolean} true = apply the live camera and draw now
 */
export function needsGestureRedraw(css, w, h, ov) {
	const { k, tx, ty } = css
	if (!Number.isFinite(k) || !Number.isFinite(tx) || !Number.isFinite(ty) || k <= 0 || k > GESTURE_K_MAX) return true
	return !stageCovers(css, w, h, ov)
}

/**
 * Replays gestureFrame for a camera sequence: the indices (from 0) of the
 * frames that redraw in between; after each the drawn camera is that frame's.
 *
 * @param {CameraState} c0 camera drawn at the gesture start
 * @param {CameraState[]} cams live camera of every frame
 * @param {number} w viewport width
 * @param {number} h viewport height
 * @param {Overscan|null} ov overscan
 * @return {number[]}
 */
export function gestureRedrawFrames(c0, cams, w, h, ov) {
	const out = []
	let base = c0
	cams.forEach((c, i) => {
		if (needsGestureRedraw(cssTransformFor(base, c), w, h, ov)) {
			out.push(i)
			base = c
		}
	})
	return out
}
