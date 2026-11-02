/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pen strokes (factory job 273), pure: an item of type `pen` is one freehand
 * line of the pen or the highlighter (data.kind 'pen' | 'marker').
 *
 * - data.points: x0, y0, x1, y1, … relative to the item's x/y (its box's
 *   top-left), at most POINTS_MAX numbers (500 points), rounded to 0.1.
 * - box: the hull of the points grown by half the stroke width on each side,
 *   so a single point is a circle of the stroke's width (strokeBox).
 * - drawing: the input controller keeps a point when it lies at least
 *   INK_MIN_STEP_PX (CSS px) from the last one (keepPoint); at the release
 *   the points are simplified (Ramer-Douglas-Peucker, simplify) with
 *   INK_TOLERANCE_PX, the tolerance doubled until at most 500 points remain
 *   (fitPoints), then made into an item (strokeItem).
 * - look: a smooth line through the points, quadratic curves over the
 *   midpoints (tracePath), round caps and joins; the highlighter see-through
 *   (MARKER_OPACITY).
 * - hit: the distance of a point to the line (distToStroke) at most half the
 *   width plus the tolerance (SceneModel hit mode 'ink', the eraser).
 * - widths and colours of the tool: PEN_WIDTHS, PEN_COLORS per kind.
 */
import { POINTS_MAX } from './registry.js'
import { LIGHT, STRONG_COLORED, TEXT_COLOR } from './tokens.js'

/** A point is kept while drawing when it lies this far from the last one (CSS px). */
export const INK_MIN_STEP_PX = 1.5
/** Tolerance of the simplification at the release (CSS px). */
export const INK_TOLERANCE_PX = 0.5
/** Most points of a stroke. */
export const INK_MAX_POINTS = POINTS_MAX / 2
/** Opacity of a highlighter stroke. */
export const MARKER_OPACITY = 0.4
/** The eraser's reach around its path (CSS px; with pen or finger INK_ERASER_COARSE_PX). */
export const INK_ERASER_PX = 8
export const INK_ERASER_COARSE_PX = 12

/** The kinds the pen tool offers (its option penKind): two that draw, then the eraser. */
export const PEN_TOOL_KINDS = Object.freeze(['pen', 'marker', 'eraser'])

/** The three widths (thin, medium, thick) per kind. */
export const PEN_WIDTHS = Object.freeze({
	pen: Object.freeze([2, 4, 8]),
	marker: Object.freeze([12, 20, 32]),
})

/** The colours per kind: the pen the strong tones but white (Black last), the highlighter the light tones but white. */
export const PEN_COLORS = Object.freeze({
	pen: STRONG_COLORED,
	marker: Object.freeze(LIGHT.filter((c) => c !== '#ffffff')),
})

/** What the tool starts with per kind: Black, medium; Yellow, medium. */
export const PEN_DEFAULTS = Object.freeze({
	pen: Object.freeze({ stroke: TEXT_COLOR, strokeWidth: 4 }),
	marker: Object.freeze({ stroke: '#faea89', strokeWidth: 20 }),
})

/**
 * @param {number} v number
 * @return {number} rounded to 0.1, never -0
 */
export function round1(v) {
	return Math.round(v * 10) / 10 + 0
}

/**
 * @param {{x:number, y:number}|null} last the last kept point (CSS px or world)
 * @param {{x:number, y:number}} p the new point (same units)
 * @param {number} [step] minimum distance
 * @return {boolean} p is kept
 */
export function keepPoint(last, p, step = INK_MIN_STEP_PX) {
	return last === null || Math.hypot(p.x - last.x, p.y - last.y) >= step
}

/**
 * Distance of (px, py) to the segment (ax, ay)–(bx, by).
 *
 * @return {number}
 */
function segDist(px, py, ax, ay, bx, by) {
	const dx = bx - ax
	const dy = by - ay
	const l2 = dx * dx + dy * dy
	let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2
	t = Math.max(0, Math.min(1, t))
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Ramer-Douglas-Peucker over a flat list; the first and the last point stay.
 *
 * @param {number[]} pts x0, y0, x1, y1, …
 * @param {number} tol tolerance (same units)
 * @return {number[]} the kept points, flat
 */
export function simplify(pts, tol) {
	const n = Math.floor(pts.length / 2)
	if (n <= 2) return pts.slice(0, n * 2)
	const keep = new Uint8Array(n)
	keep[0] = 1
	keep[n - 1] = 1
	const stack = [[0, n - 1]]
	while (stack.length > 0) {
		const [a, b] = stack.pop()
		let best = -1
		let dmax = tol
		for (let i = a + 1; i < b; i++) {
			const d = segDist(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1])
			if (d > dmax) {
				dmax = d
				best = i
			}
		}
		if (best >= 0) {
			keep[best] = 1
			stack.push([a, best], [best, b])
		}
	}
	const out = []
	for (let i = 0; i < n; i++) {
		if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
	}
	return out
}

/**
 * Simplifies with tol, doubling it until at most max points remain.
 *
 * @param {number[]} pts flat points
 * @param {number} tol starting tolerance (> 0)
 * @param {number} [max] most points
 * @return {number[]}
 */
export function fitPoints(pts, tol, max = INK_MAX_POINTS) {
	let t = tol > 0 ? tol : 0.1
	let out = simplify(pts, t)
	while (out.length / 2 > max) {
		t *= 2
		out = simplify(out, t)
	}
	return out
}

/**
 * Box of points (relative or absolute) grown by half the width.
 *
 * @param {number[]} pts flat points (≥ 1 point)
 * @param {number} width stroke width
 * @return {{x:number, y:number, w:number, h:number}}
 */
export function strokeBox(pts, width) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (let i = 0; i + 1 < pts.length; i += 2) {
		minX = Math.min(minX, pts[i])
		maxX = Math.max(maxX, pts[i])
		minY = Math.min(minY, pts[i + 1])
		maxY = Math.max(maxY, pts[i + 1])
	}
	const half = width / 2
	return { x: minX - half, y: minY - half, w: maxX - minX + width, h: maxY - minY + width }
}

/**
 * The fields of a new stroke from its points in world (or parent) units.
 *
 * @param {number[]} pts flat points, already fitted (≤ 500)
 * @param {number} width stroke width
 * @return {{x:number, y:number, w:number, h:number, points:number[]}} x/y in the units of pts,
 *   points relative to x/y, all rounded to 0.1
 */
export function strokeItem(pts, width) {
	const b = strokeBox(pts, width)
	const x = round1(b.x)
	const y = round1(b.y)
	const points = []
	for (let i = 0; i + 1 < pts.length; i += 2) points.push(round1(pts[i] - x), round1(pts[i + 1] - y))
	const r = strokeBox(points, width)
	return { x, y, w: round1(Math.max(r.x + r.w, width)), h: round1(Math.max(r.y + r.h, width)), points }
}

/**
 * @param {unknown} pts data.points of a stored stroke
 * @return {number[]} the usable flat points (an even-length list of finite numbers), else []
 */
export function pointsOf(pts) {
	if (!Array.isArray(pts) || pts.length < 2) return []
	const n = pts.length - (pts.length % 2)
	for (let i = 0; i < n; i++) if (typeof pts[i] !== 'number' || !Number.isFinite(pts[i])) return []
	return n === pts.length ? pts : pts.slice(0, n)
}

/**
 * Distance of (lx, ly) to the line of a stroke (its own coordinates).
 *
 * @param {number[]} pts flat points
 * @param {number} lx x
 * @param {number} ly y
 * @return {number} Infinity without points
 */
export function distToStroke(pts, lx, ly) {
	const n = Math.floor(pts.length / 2)
	if (n === 0) return Infinity
	if (n === 1) return Math.hypot(lx - pts[0], ly - pts[1])
	let d = Infinity
	for (let i = 0; i + 1 < n; i++) {
		d = Math.min(d, segDist(lx, ly, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]))
	}
	return d
}

/**
 * Does a segment (ax, ay)–(bx, by) of the eraser come within reach of the stroke?
 * Checked at points along the segment no further apart than reach.
 *
 * @param {number[]} pts flat points of the stroke (its coordinates)
 * @param {number} ax eraser segment start x (same coordinates)
 * @param {number} ay start y
 * @param {number} bx end x
 * @param {number} by end y
 * @param {number} reach eraser reach plus half the stroke width
 * @return {boolean}
 */
export function eraserTouches(pts, ax, ay, bx, by, reach) {
	const len = Math.hypot(bx - ax, by - ay)
	const steps = Math.max(1, Math.ceil(len / Math.max(reach, 0.01)))
	for (let s = 0; s <= steps; s++) {
		const t = s / steps
		if (distToStroke(pts, ax + (bx - ax) * t, ay + (by - ay) * t) <= reach) return true
	}
	return false
}

/**
 * Traces the smooth line of a stroke into a canvas-like context (moveTo,
 * lineTo, quadraticCurveTo): quadratic curves through the midpoints, the
 * first and last point exact. One point: a zero-length line (round caps
 * make it a dot).
 *
 * @param {{moveTo:Function, lineTo:Function, quadraticCurveTo:Function}} ctx context
 * @param {number[]} pts flat points
 * @param {number} [every] take every n-th point only (the coarse painter), first and last always
 */
export function tracePath(ctx, pts, every = 1) {
	let p = pts
	if (every > 1 && pts.length > 4) {
		p = []
		const n = pts.length / 2
		for (let i = 0; i < n; i += every) p.push(pts[i * 2], pts[i * 2 + 1])
		if ((n - 1) % every !== 0) p.push(pts[pts.length - 2], pts[pts.length - 1])
	}
	const n = Math.floor(p.length / 2)
	if (n === 0) return
	ctx.moveTo(p[0], p[1])
	if (n === 1) {
		ctx.lineTo(p[0], p[1])
		return
	}
	if (n === 2) {
		ctx.lineTo(p[2], p[3])
		return
	}
	for (let i = 1; i < n - 1; i++) {
		const mx = (p[i * 2] + p[i * 2 + 2]) / 2
		const my = (p[i * 2 + 1] + p[i * 2 + 3]) / 2
		ctx.quadraticCurveTo(p[i * 2], p[i * 2 + 1], mx, my)
	}
	ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1])
}
