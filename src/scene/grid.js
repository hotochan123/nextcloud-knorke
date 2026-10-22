/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Background grid (M2, SPEC-M1 §1.2 (R12)), the pure part: which lines to
 * draw for a camera and how to paint them. No Konva and no DOM; the renderer
 * owns the one grid <canvas> below the Konva content and hands its 2D
 * context to paintGrid.
 *
 * - gridStep: the drawn step is GRID_SIZE · GRID_MAJOR_EVERY^k, the smallest
 *   one whose lines lie at least GRID_MIN_PX screen px apart (20 from scale
 *   0.5, 100 down to 0.1, 500 below); the major lines of one step are the
 *   minor lines of the next coarser one, so they stay put at a change
 * - gridLines: the lines in view, at whole device pixels of the grid canvas
 *   (the canvas is not transformed: a CSS gesture paints every frame with
 *   the live camera), every GRID_MAJOR_EVERY-th one a major line; the line
 *   width is round(pixel ratio) device px, at least 1; at most
 *   floor(size / GRID_MIN_PX) + 1 lines per axis for every finite input: so
 *   far out that a line index is no safe integer (|x| or |y| ≳ 1.8e17 world
 *   units at step 20) an axis has no lines (whole device pixels cannot be
 *   told apart there anyway), and the count is capped against float error
 * - paintGrid: clear, then whole-pixel rectangles (no smearing over two
 *   pixels, no shimmer while panning), the minor lines first, the major ones
 *   on top
 */
import { GRID_MAJOR_COLOR, GRID_MAJOR_EVERY, GRID_MIN_PX, GRID_MINOR_COLOR, GRID_SIZE } from '../model/tokens.js'

/**
 * @typedef {{at:number, major:boolean}} GridLine a line at device px `at` of the grid canvas
 * @typedef {{step:number, lw:number, xs:GridLine[], ys:GridLine[]}} GridLines
 *   step: drawn step in world units; lw: line width in device px; xs: vertical lines, ys: horizontal ones,
 *   each ascending
 */

/**
 * @param {number} scale camera scale
 * @return {number|null} the smallest GRID_SIZE · GRID_MAJOR_EVERY^k (k = 0, 1, …) with step · scale ≥
 *   GRID_MIN_PX; null for a scale that is not finite or ≤ 0
 */
export function gridStep(scale) {
	if (!Number.isFinite(scale) || scale <= 0) return null
	let step = GRID_SIZE
	while (step * scale < GRID_MIN_PX) step *= GRID_MAJOR_EVERY
	return step
}

/**
 * @param {number} origin world coordinate at the canvas's left (top) edge
 * @param {number} span viewport size along the axis (css px)
 * @param {number} scale camera scale
 * @param {number} step drawn step
 * @param {number} pr pixel ratio
 * @return {GridLine[]} the lines of one axis in view, ascending; at most floor(span / GRID_MIN_PX) + 1,
 *   none when a line index is no safe integer (i++ would stop counting there)
 */
function axisLines(origin, span, scale, step, pr) {
	const out = []
	const first = Math.ceil(origin / step)
	const last = Math.floor((origin + span / scale) / step)
	if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return out
	// the lines lie ≥ GRID_MIN_PX apart: this many fit, also against float error at the edges
	const max = Math.floor(span / GRID_MIN_PX) + 1
	for (let i = first; i <= last && out.length < max; i++) {
		// + 0: −0 counts as 0
		out.push({ at: Math.round((i * step - origin) * scale * pr) + 0, major: i % GRID_MAJOR_EVERY === 0 })
	}
	return out
}

/**
 * The grid lines in view.
 *
 * @param {{x:number, y:number, scale:number}} cam camera (world x/y of the top-left corner)
 * @param {number} width viewport width (css px)
 * @param {number} height viewport height (css px)
 * @param {number} pr pixel ratio of the grid canvas (Konva.pixelRatio)
 * @return {GridLines|null} null for a camera, size or pixel ratio that is not finite or ≤ 0 (x and y only
 *   finite) or without a finite step; xs has at most floor(width / GRID_MIN_PX) + 1 entries, ys at most
 *   floor(height / GRID_MIN_PX) + 1, for every finite camera (an axis whose line index is no safe integer,
 *   |x| or |y| ≳ 1.8e17 at step 20: none)
 */
export function gridLines(cam, width, height, pr) {
	if (!cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.scale) || cam.scale <= 0) return null
	for (const v of [width, height, pr]) {
		if (!Number.isFinite(v) || v <= 0) return null
	}
	const step = gridStep(cam.scale)
	if (!Number.isFinite(step)) return null
	return {
		step,
		lw: Math.max(1, Math.round(pr)),
		xs: axisLines(cam.x, width, cam.scale, step, pr),
		ys: axisLines(cam.y, height, cam.scale, step, pr),
	}
}

/**
 * Paints the grid lines into a 2D context with the identity transform (device px).
 *
 * @param {{clearRect:Function, fillRect:Function, fillStyle:string}} ctx 2D context of the grid canvas
 * @param {GridLines|null} lines gridLines() (null: only cleared)
 * @param {number} wDev canvas width (device px)
 * @param {number} hDev canvas height (device px)
 */
export function paintGrid(ctx, lines, wDev, hDev) {
	ctx.clearRect(0, 0, wDev, hDev)
	if (!lines) return
	const half = Math.floor(lines.lw / 2)
	for (const [major, color] of [[false, GRID_MINOR_COLOR], [true, GRID_MAJOR_COLOR]]) {
		ctx.fillStyle = color
		for (const l of lines.xs) {
			if (l.major === major) ctx.fillRect(l.at - half, 0, lines.lw, hDev)
		}
		for (const l of lines.ys) {
			if (l.major === major) ctx.fillRect(0, l.at - half, wDev, lines.lw)
		}
	}
}
