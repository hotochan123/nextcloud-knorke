/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Snapping a dragged selection to other items (M2, SPEC-M1 §1.2 (R12)), pure
 * and without Konva. The scene collects the candidate boxes once when a drag
 * starts (buildSnapIndex: sorted line lists per axis), then snaps every
 * frame (snapDelta, O(log n + k)):
 * - lines of a box: x, x + w/2, x + w (left, centre, right) and y, y + h/2,
 *   y + h (top, middle, bottom)
 * - per axis on its own, every line of the dragged box against every line
 *   of every candidate (3 × 3, so right against left is flush); the pair
 *   with the smallest distance wins when it is ≤ tol (inclusive); on a tie
 *   the earlier line of the box (left/top, centre, right/bottom), then the
 *   smaller candidate line
 * - one guide per snapped axis (x before y), spanning the snapped box and
 *   every candidate with a line within SAME_LINE of the snapped one
 * Equal gaps (snapMove, the second part of R12; the scene calls snapMove,
 * which also snaps to the lines as above), per axis with the raw box S (the
 * box moved by the raw shift); the rules for x, the same for y with x and y
 * swapped:
 * - row: the candidates that overlap S across the axis (strictly), without
 *   those that enclose S (the frame the selection lies in); a row member
 *   that overlaps S along the axis too locks the axis (S lies on another
 *   item: no gap)
 * - a sweep over row + S by minX (then maxX, minY, maxY) with a reach finds
 *   the free gaps (P, E) longer than SAME_LINE: E = S is the left neighbour
 *   gap, P = S the right one; any other gap whose P and E overlap across
 *   the axis is a reference gap (two items of the row)
 * - a neighbour gap snaps to the length g of a reference gap within tol
 *   (inclusive): the smallest correction wins, on a tie left before right,
 *   then the smaller g
 * - line or gap per axis: the smaller correction wins (opposite corrections
 *   of the same size: the line); within SAME_LINE of each other both apply
 *   (shift of the line, guide and markers); a marker for every gap of the
 *   sweep (reference and neighbour gaps, these with the snapped box) whose
 *   length is the winning g within SAME_LINE
 * Resizing (snapResize, the resize part of R12; the transformer calls it with
 * the start frame and the raw pointer offset it hands to resizeFrame):
 * - only the moving edges snap: the dragged edge of each axis the handle has
 *   a side on, with centered (Alt) also the opposite one; the centre of the
 *   resized frame is no source; the targets are the same lines as above
 * - free (no ratio): per axis on its own, the nearest candidate line of each
 *   moving edge; the smallest distance ≤ tol wins, on a tie the dragged edge
 * - ratio (keepRatio on a corner, as resizeFrame): one common factor k, the
 *   edges at the raw (unclamped) k; the smallest distance wins over all of
 *   them (on a tie x before y, the dragged edge before the opposite one),
 *   the pointer moves along the ratio diagonal to the k that puts that edge
 *   on its line; at most one axis snaps
 * - a snap that the min/max clamp of resizeFrame would cut (the winning edge
 *   of the snapped frame not within SAME_LINE of its line) does not apply:
 *   the snapping never makes a box smaller than min, larger than max or
 *   mirrored; free: that axis keeps its raw offset, ratio: the raw offset
 * - not for a rotated frame, the rotation handle or a non-finite offset
 * Background grid (the grid part of R12; the optional last parameter grid of
 * snapMove and snapResize, the step in world units; only a finite grid > 0
 * applies, else the result is exactly the one without it):
 * - gridLine(v, step): the nearest grid line, the larger one at exactly half
 *   the step; the snap to the grid has no threshold (every position snaps)
 * - drag: per axis, an axis without a snapped item (line or gap) puts the
 *   left (top) edge of the box on a grid line; right, bottom and centre
 *   follow; the guides and gap markers of the item axes are taken from the
 *   final box (with the other axis on the grid)
 * - resize, free: an axis without a snapped item (none won, or the clamp
 *   cut it) snaps the moving edge nearest to its grid line (a tie: the
 *   dragged edge); an axis whose grid snap the clamp cuts keeps its raw
 *   offset
 * - resize, ratio: without an item snap (or one the clamp cuts) the nearest
 *   grid line over the same edges in the same order wins; one the clamp
 *   cuts gives the raw offset
 * - the grid draws no guide; items keep the priority on their axis
 * Nothing is rounded here (the scene stores on the 0.01 grid as before).
 */
import { resizeFrame } from './transform.js'

/** Two lines at most this far apart (world units, the 0.01 storage grid) are the same line of a guide. */
export const SAME_LINE = 0.01
/** Absorbs the float error of values on the 0.01 grid (299.99 vs 300 differ by 0.01000000000005). */
const SAME_EPS = 1e-9

/**
 * @typedef {{minX:number, minY:number, maxX:number, maxY:number}} SnapBox
 * @typedef {{v:Float64Array, box:Int32Array}} SnapAxis line values sorted ascending, the box index of each
 * @typedef {{x:SnapAxis, y:SnapAxis, boxes:SnapBox[]}} SnapIndex
 * @typedef {{axis:'x'|'y', at:number, from:number, to:number}} SnapGuide
 *   axis 'x': a vertical line at x = at from y = from to y = to; axis 'y': a horizontal one at y = at
 * @typedef {{axis:'x'|'y', at:number, from:number, to:number}} GapMarker
 *   axis 'x': a horizontal gap from x = from to x = to at y = at; axis 'y': a vertical one at x = at
 * @typedef {{p:SnapBox, e:SnapBox, len:number, side:('L'|'R'|null)}} SnapGap
 *   a free gap of a sweep from p to e; side 'L': e is the dragged box, 'R': p is, null: a reference gap
 */

/**
 * @param {SnapBox[]} boxes candidate boxes
 * @param {'minX'|'minY'} lo low edge key
 * @param {'maxX'|'maxY'} hi high edge key
 * @return {SnapAxis}
 */
function axisOf(boxes, lo, hi) {
	const n = boxes.length * 3
	const vals = new Float64Array(n)
	boxes.forEach((b, i) => {
		vals[3 * i] = b[lo]
		vals[3 * i + 1] = (b[lo] + b[hi]) / 2
		vals[3 * i + 2] = b[hi]
	})
	const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => vals[a] - vals[b])
	const v = new Float64Array(n)
	const box = new Int32Array(n)
	order.forEach((k, j) => {
		v[j] = vals[k]
		box[j] = Math.floor(k / 3)
	})
	return { v, box }
}

/**
 * Index of the candidates of one drag: their boxes and the sorted lines of each axis.
 *
 * @param {Iterable<SnapBox>} boxes candidate boxes (world); entries with a non-finite value are skipped
 * @return {SnapIndex}
 */
export function buildSnapIndex(boxes) {
	const list = []
	for (const b of boxes ?? []) {
		if (!b || ![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) continue
		list.push({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY })
	}
	return { x: axisOf(list, 'minX', 'maxX'), y: axisOf(list, 'minY', 'maxY'), boxes: list }
}

/**
 * The nearest line of a grid (the background grid of R12).
 *
 * @param {number} v value (world)
 * @param {number} step grid step (world units)
 * @return {number} Math.round(v / step) · step (the larger line at exactly half the step, never −0);
 *   v itself for a step that is not finite or ≤ 0
 */
export function gridLine(v, step) {
	if (!Number.isFinite(step) || step <= 0) return v
	return Math.round(v / step) * step + 0
}

/**
 * @param {unknown} grid grid parameter of snapMove/snapResize
 * @return {boolean} a grid that applies (finite and > 0)
 */
const gridOn = (grid) => Number.isFinite(grid) && grid > 0

/**
 * @param {SnapIndex|null} index candidates
 * @param {number} tol tolerance
 * @return {boolean} snapping to items applies (an index with boxes and a tol ≥ 0)
 */
const itemsOn = (index, tol) => !!index && !!index.boxes && index.boxes.length > 0 && tol >= 0

/**
 * @param {Float64Array} v ascending values
 * @param {number} x value
 * @return {number} first index whose value is ≥ x (v.length when none)
 */
function lowerBound(v, x) {
	let lo = 0
	let hi = v.length
	while (lo < hi) {
		const mid = (lo + hi) >>> 1
		if (v[mid] < x) lo = mid + 1
		else hi = mid
	}
	return lo
}

/**
 * @param {Float64Array} v ascending candidate lines of one axis
 * @param {number} l a line
 * @return {number|null} the nearest candidate line, the one below on a tie (smaller c); null without any
 */
function nearestLine(v, l) {
	const k = lowerBound(v, l)
	let c = k > 0 ? v[k - 1] : null
	if (k < v.length && (c === null || v[k] - l < l - c)) c = v[k]
	return c
}

/**
 * The winning pair of one axis.
 *
 * @param {SnapAxis} axis candidate lines
 * @param {number[]} lines the three lines of the dragged box before the shift
 * @param {number} d raw shift of this axis
 * @param {number} tol tolerance (world units)
 * @return {{c:number, delta:number}|null} the candidate line and the correction, null when nothing is within tol
 */
function snapAxis(axis, lines, d, tol) {
	const v = axis.v
	let win = null
	let best = Infinity
	for (const line of lines) {
		const l = line + d
		const c = nearestLine(v, l)
		if (c === null) continue
		const dist = Math.abs(c - l)
		// strictly smaller: on a tie the earlier line of the box wins
		if (dist <= tol && dist < best) {
			best = dist
			win = { c, delta: c - l }
		}
	}
	return win
}

/**
 * @param {SnapIndex} index candidates
 * @param {'x'|'y'} axis axis of the guide
 * @param {number} c snapped line
 * @param {number} lo low edge of the snapped box across the guide
 * @param {number} hi high edge of the snapped box across the guide
 * @return {SnapGuide}
 */
function guideOf(index, axis, c, lo, hi) {
	const ax = index[axis]
	const kLo = axis === 'x' ? 'minY' : 'minX'
	const kHi = axis === 'x' ? 'maxY' : 'maxX'
	let from = lo
	let to = hi
	const end = c + SAME_LINE + SAME_EPS
	for (let k = lowerBound(ax.v, c - SAME_LINE - SAME_EPS); k < ax.v.length && ax.v[k] <= end; k++) {
		const b = index.boxes[ax.box[k]]
		if (b[kLo] < from) from = b[kLo]
		if (b[kHi] > to) to = b[kHi]
	}
	return { axis, at: c, from, to }
}

/**
 * Snaps the raw shift of a dragged box to the candidates (see the module comment).
 *
 * @param {{x:number, y:number, w:number, h:number}|null} box dragged box before the drag (world)
 * @param {number} dx raw shift x (world)
 * @param {number} dy raw shift y (world)
 * @param {SnapIndex|null} index candidates (buildSnapIndex)
 * @param {number} tol tolerance per axis in world units (inclusive)
 * @return {{dx:number, dy:number, guides:SnapGuide[]}} the snapped shift and at most one guide per axis, x first;
 *   without a box, an index, a candidate or a valid tol the raw shift without guides
 */
export function snapDelta(box, dx, dy, index, tol) {
	if (!box || !index || !index.boxes || index.boxes.length === 0 || !(tol >= 0) ||
		!Number.isFinite(dx) || !Number.isFinite(dy)) {
		return { dx, dy, guides: [] }
	}
	const wx = snapAxis(index.x, [box.x, box.x + box.w / 2, box.x + box.w], dx, tol)
	const wy = snapAxis(index.y, [box.y, box.y + box.h / 2, box.y + box.h], dy, tol)
	const sdx = wx ? dx + wx.delta : dx
	const sdy = wy ? dy + wy.delta : dy
	const guides = []
	if (wx) guides.push(guideOf(index, 'x', wx.c, box.y + sdy, box.y + box.h + sdy))
	if (wy) guides.push(guideOf(index, 'y', wy.c, box.x + sdx, box.x + box.w + sdx))
	return { dx: sdx, dy: sdy, guides }
}

/** Edge keys of the gap axis (lo, hi) and of the cross axis (cLo, cHi). */
const GAP_X = Object.freeze({ lo: 'minX', hi: 'maxX', cLo: 'minY', cHi: 'maxY' })
const GAP_Y = Object.freeze({ lo: 'minY', hi: 'maxY', cLo: 'minX', cHi: 'maxX' })

/**
 * The free gaps of one axis around the raw box (see the module comment).
 *
 * @param {SnapBox[]} boxes candidates
 * @param {SnapBox} S raw box
 * @param {typeof GAP_X} k keys of the axis
 * @return {SnapGap[]|null} the neighbour and reference gaps in sweep order; null when the axis is locked
 */
function gapsOf(boxes, S, k) {
	const row = [S]
	for (const b of boxes) {
		if (!(b[k.cLo] < S[k.cHi] && b[k.cHi] > S[k.cLo])) continue
		// the frame around the selection is not part of the row
		if (b.minX <= S.minX && b.maxX >= S.maxX && b.minY <= S.minY && b.maxY >= S.maxY) continue
		if (b[k.lo] < S[k.hi] && b[k.hi] > S[k.lo]) return null
		row.push(b)
	}
	row.sort((a, b) => a[k.lo] - b[k.lo] || a[k.hi] - b[k.hi] || a[k.cLo] - b[k.cLo] || a[k.cHi] - b[k.cHi])
	const gaps = []
	let reach = -Infinity
	let p = null
	for (const e of row) {
		if (p !== null && e[k.lo] > reach) {
			const len = e[k.lo] - p[k.hi]
			if (len > SAME_LINE) {
				if (e === S) gaps.push({ p, e, len, side: 'L' })
				else if (p === S) gaps.push({ p, e, len, side: 'R' })
				// two other items: a reference gap only when they overlap each other across the axis
				else if (p[k.cLo] < e[k.cHi] && p[k.cHi] > e[k.cLo]) gaps.push({ p, e, len, side: null })
			}
		}
		if (e[k.hi] > reach) {
			reach = e[k.hi]
			p = e
		}
	}
	return gaps
}

/**
 * The winning gap of one axis.
 *
 * @param {SnapGap[]|null} gaps gaps of the axis (gapsOf)
 * @param {number} tol tolerance (world units, inclusive)
 * @return {{delta:number, g:number}|null} the correction and the reference length, null without a winner
 */
function gapWin(gaps, tol) {
	if (gaps === null) return null
	const refs = gaps.filter((x) => x.side === null).map((x) => x.len).sort((a, b) => a - b)
	let win = null
	let best = Infinity
	// left (top) before right (bottom), the smaller g first; only a strictly smaller correction replaces
	for (const side of ['L', 'R']) {
		const n = gaps.find((x) => x.side === side)
		if (!n) continue
		for (const g of refs) {
			const delta = side === 'L' ? g - n.len : n.len - g
			const dist = Math.abs(delta)
			if (dist <= tol && dist < best) {
				best = dist
				win = { delta, g }
			}
		}
	}
	return win
}

/**
 * Line or gap of one axis.
 *
 * @param {{c:number, delta:number}|null} line line winner (snapAxis)
 * @param {{delta:number, g:number}|null} gap gap winner (gapWin)
 * @return {{delta:number, line:boolean, gap:boolean}|null} the correction and what applies, null for neither
 */
function pick(line, gap) {
	if (!line && !gap) return null
	if (!gap) return { delta: line.delta, line: true, gap: false }
	if (!line) return { delta: gap.delta, line: false, gap: true }
	if (Math.abs(line.delta - gap.delta) <= SAME_LINE + SAME_EPS) return { delta: line.delta, line: true, gap: true }
	// the same size in opposite directions: the line
	if (Math.abs(gap.delta) < Math.abs(line.delta)) return { delta: gap.delta, line: false, gap: true }
	return { delta: line.delta, line: true, gap: false }
}

/**
 * The markers of an axis whose gap applies: every gap of its sweep (the
 * neighbour gaps measured with the snapped box) whose length is g within
 * SAME_LINE, ascending by from.
 *
 * @param {SnapGap[]} gaps gaps of the axis (raw box S)
 * @param {SnapBox} S raw box
 * @param {SnapBox} S2 snapped box
 * @param {'x'|'y'} axis axis
 * @param {number} g reference length of the winner
 * @return {GapMarker[]}
 */
function markersOf(gaps, S, S2, axis, g) {
	const k = axis === 'x' ? GAP_X : GAP_Y
	const out = []
	for (const x of gaps) {
		const p = x.p === S ? S2 : x.p
		const e = x.e === S ? S2 : x.e
		const from = p[k.hi]
		const to = e[k.lo]
		if (Math.abs(to - from - g) > SAME_LINE + SAME_EPS) continue
		// across the axis: the middle of the overlap of the two sides
		out.push({ axis, at: (Math.max(p[k.cLo], e[k.cLo]) + Math.min(p[k.cHi], e[k.cHi])) / 2, from, to })
	}
	return out.sort((a, b) => a.from - b.from)
}

/**
 * Snaps the raw shift of a dragged box to the lines of the candidates (as
 * snapDelta) and to equal gaps in its row and column (see the module comment).
 *
 * @param {{x:number, y:number, w:number, h:number}|null} box dragged box before the drag (world)
 * @param {number} dx raw shift x (world)
 * @param {number} dy raw shift y (world)
 * @param {SnapIndex|null} index candidates (buildSnapIndex)
 * @param {number} tol tolerance per axis in world units (inclusive)
 * @param {number} [grid] background grid step in world units (R12; 0, missing or not finite > 0: no grid);
 *   an axis without an item snap puts the left (top) edge of the box on a grid line
 * @return {{dx:number, dy:number, guides:SnapGuide[], gaps:GapMarker[]}} the snapped shift, at most one guide
 *   per axis whose line applies (x first, spanning the snapped box) and the markers of the axes whose gap
 *   applies (x first, each by from); without a box, without a grid and an index, a candidate or a valid tol
 *   the raw shift without guides and markers. Without markers and grid dx, dy and guides are those of snapDelta.
 */
export function snapMove(box, dx, dy, index, tol, grid = 0) {
	const onGrid = gridOn(grid)
	const onItems = itemsOn(index, tol)
	if (!box || (!onItems && !onGrid) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
		return { dx, dy, guides: [], gaps: [] }
	}
	const S = { minX: box.x + dx, minY: box.y + dy, maxX: box.x + box.w + dx, maxY: box.y + box.h + dy }
	let lx = null
	let ly = null
	let gx = null
	let gy = null
	let wgx = null
	let wgy = null
	if (onItems) {
		lx = snapAxis(index.x, [box.x, box.x + box.w / 2, box.x + box.w], dx, tol)
		ly = snapAxis(index.y, [box.y, box.y + box.h / 2, box.y + box.h], dy, tol)
		gx = gapsOf(index.boxes, S, GAP_X)
		gy = gapsOf(index.boxes, S, GAP_Y)
		wgx = gapWin(gx, tol)
		wgy = gapWin(gy, tol)
	}
	const px = pick(lx, wgx)
	const py = pick(ly, wgy)
	// an axis without an item snap: the left (top) edge on the grid, else raw
	const sdx = px ? dx + px.delta : onGrid ? gridLine(box.x + dx, grid) - box.x : dx
	const sdy = py ? dy + py.delta : onGrid ? gridLine(box.y + dy, grid) - box.y : dy
	const S2 = { minX: box.x + sdx, minY: box.y + sdy, maxX: box.x + box.w + sdx, maxY: box.y + box.h + sdy }
	const guides = []
	if (px?.line) guides.push(guideOf(index, 'x', lx.c, S2.minY, S2.maxY))
	if (py?.line) guides.push(guideOf(index, 'y', ly.c, S2.minX, S2.maxX))
	const gaps = []
	if (px?.gap) gaps.push(...markersOf(gx, S, S2, 'x', wgx.g))
	if (py?.gap) gaps.push(...markersOf(gy, S, S2, 'y', wgy.g))
	return { dx: sdx, dy: sdy, guides, gaps }
}

/** Sides of the resize handles (as resizeFrame): [x, y], −1 left/top, 1 right/bottom, 0 none. */
const RESIZE_SIDES = Object.freeze({
	tl: [-1, -1], t: [0, -1], tr: [1, -1], r: [1, 0], br: [1, 1], b: [0, 1], bl: [-1, 1], l: [-1, 0],
})

/**
 * @param {{x:number, y:number, w:number, h:number}} f frame
 * @param {'x'|'y'} axis axis
 * @param {'lo'|'hi'} edge low (left, top) or high (right, bottom) edge
 * @return {number} that edge of the frame
 */
function edgeOf(f, axis, edge) {
	const lo = axis === 'x' ? f.x : f.y
	return edge === 'lo' ? lo : lo + (axis === 'x' ? f.w : f.h)
}

/**
 * @param {SnapIndex} index candidates
 * @param {'x'|'y'} axis snapped axis
 * @param {number} c snapped line
 * @param {{x:number, y:number, w:number, h:number}} f snapped frame
 * @return {SnapGuide} the guide at c, spanning f and the candidates on c (as a drag)
 */
function frameGuide(index, axis, c, f) {
	return axis === 'x' ? guideOf(index, 'x', c, f.y, f.y + f.h) : guideOf(index, 'y', c, f.x, f.x + f.w)
}

/**
 * The winning moving edge of one axis without a ratio.
 *
 * @param {(l:number) => (number|null)} near the target line nearest to an edge (a candidate line or a grid line)
 * @param {number} lo low edge of the start frame on the axis
 * @param {number} size size of the start frame on the axis
 * @param {number} side side of the handle on the axis (−1 low, 1 high, 0 none)
 * @param {number} d raw offset of the axis
 * @param {boolean} centered the opposite edge moves too (the other way)
 * @param {number} tol tolerance (world units, inclusive; Infinity for the grid)
 * @return {{c:number, d:number, edge:('lo'|'hi')}|null} the target line, the corrected offset and the
 *   edge of the frame that lands on c; null when nothing is within tol
 */
function freeEdge(near, lo, size, side, d, centered, tol) {
	if (side === 0) return null
	// [edge now, sign of its movement with d, which edge]; the dragged edge first: it wins a tie
	const edges = side < 0 ? [[lo + d, 1, 'lo']] : [[lo + size + d, 1, 'hi']]
	if (centered) edges.push(side < 0 ? [lo + size - d, -1, 'hi'] : [lo - d, -1, 'lo'])
	let win = null
	let best = Infinity
	for (const [l, sign, edge] of edges) {
		const c = near(l)
		if (c === null) continue
		const dist = Math.abs(c - l)
		if (dist <= tol && dist < best) {
			best = dist
			win = { c, d: d + sign * (c - l), edge }
		}
	}
	return win
}

/**
 * Snaps the raw pointer offset of a resize handle so that a moving edge of
 * the resized frame lands on a line of a candidate, or on the background grid
 * where no candidate snaps (see the module comment).
 *
 * @param {{x:number, y:number, w:number, h:number, r?:number}|null} frame frame at the start of the resize (world)
 * @param {string} anchor handle (tl, t, tr, r, br, b, bl, l)
 * @param {number} dx raw pointer offset x since the start (world), as handed to resizeFrame
 * @param {number} dy raw pointer offset y
 * @param {{keepRatio?:boolean, centered?:boolean, min?:number, max?:number, axes?:('xy'|'x')}} opts the
 *   options of resizeFrame; axes 'x' (default 'xy'): the y side of the handle counts as none
 * @param {SnapIndex|null} index candidates (buildSnapIndex)
 * @param {number} tol tolerance in world units (inclusive)
 * @param {number} [grid] background grid step in world units (R12; 0, missing or not finite > 0: no grid)
 * @return {{dx:number, dy:number, guides:SnapGuide[]}} the snapped offset (resizeFrame(frame, anchor, dx, dy,
 *   opts) is the snapped frame) and one guide per axis snapped to a candidate, x first, at most one with a
 *   ratio (the grid draws none); the raw offset without guides for a rotated frame, another handle (rot),
 *   without a grid and a candidate or a valid tol, or a non-finite offset
 */
export function snapResize(frame, anchor, dx, dy, opts, index, tol, grid = 0) {
	const raw = { dx, dy, guides: [] }
	const onGrid = gridOn(grid)
	const onItems = itemsOn(index, tol)
	if (!frame || (frame.r || 0) !== 0 || !Object.prototype.hasOwnProperty.call(RESIZE_SIDES, anchor) ||
		(!onItems && !onGrid) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
		return raw
	}
	const o = opts ?? {}
	const { x, y, w, h } = frame
	const centered = !!o.centered
	const [ax, ay] = RESIZE_SIDES[anchor]
	const yOn = o.axes !== 'x'
	const toGrid = (l) => gridLine(l, grid)
	if (o.keepRatio && ax !== 0 && ay !== 0 && w > 0 && h > 0) {
		// ratio (as resizeFrame): fixed point f, the dragged corner at f + o·k
		const fx = centered ? w / 2 : (ax < 0 ? w : 0)
		const fy = centered ? h / 2 : (ay < 0 ? h : 0)
		const ox = (ax < 0 ? 0 : w) - fx
		const oy = (ay < 0 ? 0 : h) - fy
		const k = ((ox + dx) * ox + (oy + dy) * oy) / (ox * ox + oy * oy)
		// [axis, edge at k, the factor that puts it on c, which edge]: x before y, the dragged edge before the opposite
		const edges = [['x', x + fx + ox * k, (c) => (c - x - fx) / ox, ax < 0 ? 'lo' : 'hi']]
		if (centered) edges.push(['x', x + fx - ox * k, (c) => (x + fx - c) / ox, ax < 0 ? 'hi' : 'lo'])
		if (yOn) {
			edges.push(['y', y + fy + oy * k, (c) => (c - y - fy) / oy, ay < 0 ? 'lo' : 'hi'])
			if (centered) edges.push(['y', y + fy - oy * k, (c) => (y + fy - c) / oy, ay < 0 ? 'hi' : 'lo'])
		}
		/**
		 * @param {(axis:string, l:number) => (number|null)} near the target line nearest to an edge
		 * @param {number} limit tolerance (Infinity for the grid)
		 * @return {{win:object, sdx:number, sdy:number, f1:object}|null} the edge nearest to its target with the
		 *   snapped offset and frame; null without one within limit or when the min/max clamp cuts it
		 */
		const snapTo = (near, limit) => {
			let win = null
			let best = Infinity
			for (const [axis, l, kOf, edge] of edges) {
				const c = near(axis, l)
				if (c === null) continue
				const dist = Math.abs(c - l)
				if (dist <= limit && dist < best) {
					best = dist
					win = { axis, c, k: kOf(c), edge }
				}
			}
			if (!win) return null
			// the pointer moves along the ratio diagonal: resizeFrame gives exactly the new factor
			const sdx = dx + (win.k - k) * ox
			const sdy = dy + (win.k - k) * oy
			const f1 = resizeFrame(frame, anchor, sdx, sdy, o)
			// the min/max clamp cut the snap
			if (Math.abs(edgeOf(f1, win.axis, win.edge) - win.c) > SAME_LINE + SAME_EPS) return null
			return { win, sdx, sdy, f1 }
		}
		const item = onItems ? snapTo((axis, l) => nearestLine(index[axis].v, l), tol) : null
		if (item) return { dx: item.sdx, dy: item.sdy, guides: [frameGuide(index, item.win.axis, item.win.c, item.f1)] }
		// no item snap (or the clamp cut it): the grid; raw when the clamp cuts that too
		const onLine = onGrid ? snapTo((axis, l) => toGrid(l), Infinity) : null
		return onLine ? { dx: onLine.sdx, dy: onLine.sdy, guides: [] } : raw
	}
	const wx = onItems ? freeEdge((l) => nearestLine(index.x.v, l), x, w, ax, dx, centered, tol) : null
	const wy = onItems ? freeEdge((l) => nearestLine(index.y.v, l), y, h, yOn ? ay : 0, dy, centered, tol) : null
	if (!wx && !wy && !onGrid) return raw
	let sdx = wx ? wx.d : dx
	let sdy = wy ? wy.d : dy
	let f1 = resizeFrame(frame, anchor, sdx, sdy, o)
	// an axis whose snap the min/max clamp cut keeps its raw offset (the axes clamp on their own)
	const okX = wx !== null && Math.abs(edgeOf(f1, 'x', wx.edge) - wx.c) <= SAME_LINE + SAME_EPS
	const okY = wy !== null && Math.abs(edgeOf(f1, 'y', wy.edge) - wy.c) <= SAME_LINE + SAME_EPS
	if ((wx && !okX) || (wy && !okY)) {
		sdx = okX ? sdx : dx
		sdy = okY ? sdy : dy
		f1 = resizeFrame(frame, anchor, sdx, sdy, o)
	}
	if (onGrid) {
		// an axis without a snapped item: its moving edge nearest to a grid line (a tie: the dragged edge)
		const gx = okX ? null : freeEdge(toGrid, x, w, ax, dx, centered, Infinity)
		const gy = okY ? null : freeEdge(toGrid, y, h, yOn ? ay : 0, dy, centered, Infinity)
		if (gx || gy) {
			if (gx) sdx = gx.d
			if (gy) sdy = gy.d
			f1 = resizeFrame(frame, anchor, sdx, sdy, o)
			// an axis whose grid snap the clamp cut keeps its raw offset
			const cutX = gx !== null && Math.abs(edgeOf(f1, 'x', gx.edge) - gx.c) > SAME_LINE + SAME_EPS
			const cutY = gy !== null && Math.abs(edgeOf(f1, 'y', gy.edge) - gy.c) > SAME_LINE + SAME_EPS
			if (cutX || cutY) {
				sdx = cutX ? dx : sdx
				sdy = cutY ? dy : sdy
				f1 = resizeFrame(frame, anchor, sdx, sdy, o)
			}
		}
	}
	// the guides of the item axes, from the final frame (a grid axis as it lands)
	const guides = []
	if (okX) guides.push(frameGuide(index, 'x', wx.c, f1))
	if (okY) guides.push(frameGuide(index, 'y', wy.c, f1))
	return { dx: sdx, dy: sdy, guides }
}
