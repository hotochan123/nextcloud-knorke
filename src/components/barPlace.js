/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Where the context bar and its panel stand in the wide layout (factory job
 * 137, like Miro's object menu). Pure rules, no DOM: everything in board px
 * (the board W × H, origin at its top left corner; the scene's container px
 * are the same). The narrow layout (NARROW_QUERY) does not use them.
 *
 * Limits (barLimits): L = EDGE, R = W − EDGE; T = the deeper bottom edge of
 * the TopBar and the visible banners (with the info card) + EDGE; U = the top
 * edge of the visible VoteBar, else H, − EDGE.
 *
 * The bar (placeBar), w × h measured; its width does not depend on where it
 * stands. b = the scene's onSelectionBox: {box, keep} or null; box is the
 * selection's screen box, keep the box with the space its handles need.
 * 1. 'hidden' when b is null or box shares no area with (0, 0, W, H).
 * 2. Across: centred on the middle of box ∩ [0, W], pushed into [L, R − w];
 *    a bar wider than R − L starts at L.
 * 3. Down, the first rule that fits: 'above' (top = keep.y − GAP − h, when
 *    top ≥ T), 'below' (top = keep.y + keep.h + GAP, when top ≥ T and
 *    top + h ≤ U), else 'pinned' (top = T, over the selection).
 *
 * The panel (placePanel), pw × ph measured (job 230: it gives way to the
 * selection and never covers the bar): the first of these places that lies
 * wholly in [L, R] × [T, U] and overlaps neither the bar nor keep wins:
 * (a) the side of the bar away from the selection, PANEL_GAP from it
 *     (upwards for a bar 'above', downwards for one 'below'; a 'pinned'
 *     bar has none), across centred on the bar and pushed into [L, R − pw];
 * (b) right of keep (left = keep.x + keep.w + GAP), top = keep.y pushed
 *     into [T, U − ph] (side 'right');
 * (c) left of keep (left = keep.x − GAP − pw), top as in (b) (side 'left');
 * (d) else the rule of job 137: a bar 'above' opens it upwards when it fits
 *     under T, else downwards; 'below' downwards when it fits above U, else
 *     upwards; 'pinned' always downwards; when neither side fits, the side
 *     with more room (a tie: below). Across as in (a). Never over the bar.
 */

/** Margin to the board's edges and to the bars (board px). */
export const EDGE = 8
/** Distance between the bar and the selection's keep box (board px). */
export const GAP = 8
/** Distance between the panel and its bar (board px). */
export const PANEL_GAP = 6

/**
 * @param {{W:number, H:number, chrome:number, vote?:(number|null)}} o board size, the deeper
 *   bottom edge of the TopBar and the visible banners (chrome), the top edge of the visible
 *   VoteBar (vote, null or missing without one)
 * @return {{L:number, R:number, T:number, U:number}}
 */
export function barLimits({ W, H, chrome, vote = null }) {
	return {
		L: EDGE,
		R: W - EDGE,
		T: chrome + EDGE,
		U: (Number.isFinite(vote) ? vote : H) - EDGE,
	}
}

/**
 * @param {number} want wanted left edge
 * @param {number} size width of the thing
 * @param {number} W board width
 * @return {number} left edge inside [L, R − size]; L when it is wider than R − L
 */
function across(want, size, W) {
	const L = EDGE
	const R = W - EDGE
	if (size > R - L) return L
	return Math.min(Math.max(want, L), R - size)
}

/**
 * @param {{box:{x:number, y:number, w:number, h:number}, keep:{x:number, y:number, w:number, h:number}}|null} b
 *   the scene's selection box (onSelectionBox)
 * @param {{W:number, H:number, T:number, U:number, w:number, h:number}} o board size, limits T and U,
 *   the bar's measured size
 * @return {{place:'above'|'below'|'pinned'|'hidden', left:(number|null), top:(number|null)}} board px
 *   (null while hidden)
 */
export function placeBar(b, { W, H, T, U, w, h }) {
	const box = b?.box
	if (!box || !(box.x < W) || !(box.x + box.w > 0) || !(box.y < H) || !(box.y + box.h > 0)) {
		return { place: 'hidden', left: null, top: null }
	}
	const mid = (Math.max(box.x, 0) + Math.min(box.x + box.w, W)) / 2
	const left = across(mid - w / 2, w, W)
	const keep = b.keep ?? box
	const above = keep.y - GAP - h
	if (above >= T) return { place: 'above', left, top: above }
	const below = keep.y + keep.h + GAP
	if (below >= T && below + h <= U) return { place: 'below', left, top: below }
	return { place: 'pinned', left, top: T }
}

/**
 * @param {{x:number, y:number, w:number, h:number}} a box
 * @param {{x:number, y:number, w:number, h:number}} b box
 * @return {boolean} the two share area
 */
function overlaps(a, b) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * @param {{place:'above'|'below'|'pinned', left:number, top:number, w:number, h:number}} bar where the
 *   bar stands (placeBar) and its size
 * @param {{W:number, T:number, U:number, pw:number, ph:number, keep?:({x:number, y:number, w:number, h:number}|null)}} o
 *   board width, limits T and U, the panel's measured size, (job 230) the selection's keep box (onSelectionBox;
 *   missing: only rules (a) and (d))
 * @return {{side:'above'|'below'|'right'|'left', left:number, top:number}} board px
 */
export function placePanel(bar, { W, T, U, pw, ph, keep = null }) {
	const L = EDGE
	const R = W - EDGE
	const up = bar.top - PANEL_GAP - ph
	const down = bar.top + bar.h + PANEL_GAP
	const mid = across(bar.left + bar.w / 2 - pw / 2, pw, W)
	const barBox = { x: bar.left, y: bar.top, w: bar.w, h: bar.h }
	/** @param {number} x left @param {number} y top @return {boolean} wholly inside the limits, over neither bar nor keep */
	const free = (x, y) => x >= L && x + pw <= R && y >= T && y + ph <= U
		&& !overlaps({ x, y, w: pw, h: ph }, barBox) && !(keep && overlaps({ x, y, w: pw, h: ph }, keep))
	// (a) away from the selection
	if (bar.place === 'above' && free(mid, up)) return { side: 'above', left: mid, top: up }
	if (bar.place === 'below' && free(mid, down)) return { side: 'below', left: mid, top: down }
	// (b), (c) beside the selection
	if (keep) {
		const top = Math.min(Math.max(keep.y, T), U - ph)
		const right = keep.x + keep.w + GAP
		if (free(right, top)) return { side: 'right', left: right, top }
		const left = keep.x - GAP - pw
		if (free(left, top)) return { side: 'left', left, top }
	}
	// (d) job 137
	const fitsUp = up >= T
	const fitsDown = down + ph <= U
	let side
	if (bar.place === 'pinned') {
		side = 'below'
	} else if (bar.place === 'above' ? fitsUp : !fitsDown && fitsUp) {
		side = 'above'
	} else if (fitsDown) {
		side = 'below'
	} else {
		// neither side fits: the one with more room, a tie goes below
		side = bar.top - PANEL_GAP - T > U - down ? 'above' : 'below'
	}
	return { side, left: mid, top: side === 'above' ? up : down }
}
