/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pure geometry and handle names of the browser scenarios (no env.json, no
 * browser), importable by the host self-tests:
 *
 * - q and the anchor point of a bound connector end (SPEC-M1 §4.7 rule 14).
 *   A copy of dev/sim/lib/geom.mjs on purpose: the E2E container mounts only
 *   dev/e2e (run.sh), and the harness imports nothing from src/model (it is
 *   the oracle). dev/e2e/stage1.test.mjs pins this copy to
 *   tests/fixtures/connector-golden.json and to the HTTP harness's copy.
 * - The frozen names of __knorke.handles() (SPEC-M1 §6.7, R11): transformer
 *   = ANCHORS tl, t, tr, r, br, b, bl, l, rot; end handles start, end; "+"
 *   handles plus-t, plus-r, plus-b, plus-l. pickHandle() chooses a handle by
 *   its name and falls back to the nearest non-transformer handle only when
 *   the name is missing (the result says which way it went).
 */

/** Grid of anchor points (§4.7: k = 100). */
export const POINT_GRID = 100

/**
 * The rounding formula of §4.7, literally:
 *   q(v, k) = (v < 0 ? -1 : 1) * floor(abs(v) * k + 0.5) / k
 * (R7) never -0: `+ 0` turns -0 into +0 and leaves every other value alone.
 */
export function q(v, k) {
	const r = (v < 0 ? -1 : 1) * Math.floor(Math.abs(v) * k + 0.5) / k
	return r + 0
}

/**
 * Anchor point of an end bound to an item (§4.7 rule 14): box {x, y, w, h, r}
 * relative to its container `parent` ({x, y} or null; containers are roots),
 * X = x + parent.x, Y = y + parent.y, cx = X + w/2, cy = Y + h/2; without
 * ax/ay (auto) the centre, else dx = (ax − 0.5)·w, dy = (ay − 0.5)·h,
 * θ = r·π/180, px = cx + dx·cos θ − dy·sin θ, py = cy + dx·sin θ + dy·cos θ,
 * in the spec's order of operations.
 * @returns {[number, number]} [q(px, 100), q(py, 100)]
 */
export function anchorPoint(box, parent, ep) {
	let x = Number(box.x)
	let y = Number(box.y)
	if (parent) {
		x = x + Number(parent.x)
		y = y + Number(parent.y)
	}
	const w = Number(box.w)
	const h = Number(box.h)
	const cx = x + w / 2
	const cy = y + h / 2
	if (!ep || !('ax' in ep) || !('ay' in ep)) return [q(cx, POINT_GRID), q(cy, POINT_GRID)]
	const dx = (ep.ax - 0.5) * w
	const dy = (ep.ay - 0.5) * h
	const t = Number(box.r || 0) * Math.PI / 180
	const cos = Math.cos(t)
	const sin = Math.sin(t)
	const px = cx + dx * cos - dy * sin
	const py = cy + dx * sin + dy * cos
	return [q(px, POINT_GRID), q(py, POINT_GRID)]
}

/** Transformer handle names (SPEC-M1 §6.2 transform.ANCHORS). */
export const TRANSFORM_HANDLES = Object.freeze(['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'rot'])
/** End handles of one selected connector (§6.7, R11). */
export const END_HANDLES = Object.freeze(['start', 'end'])
/** "+" handles of one selected note, shape or text item, in anchor order (§6.7, R11). */
export const PLUS_HANDLES = Object.freeze(['plus-t', 'plus-r', 'plus-b', 'plus-l'])

/** Sorted names of the handles of `list` whose name is in `names` (null for a list that is none). */
export function handleNames(list, names) {
	return Array.isArray(list) ? list.map((h) => h?.name).filter((n) => names.includes(n)).sort() : null
}

/** The handles of a list that are not transformer handles ("+" and end handles, or unknown names). */
export function extraHandles(list) {
	return Array.isArray(list) ? list.filter((h) => h && !TRANSFORM_HANDLES.includes(h.name)) : []
}

/** The handle of `list` nearest to the client point `pt` (null for an empty list). */
export function nearestHandle(list, pt) {
	let best = null
	let bd = Infinity
	for (const h of list || []) {
		const d = Math.hypot(h.x - pt.x, h.y - pt.y)
		if (d < bd) { bd = d; best = h }
	}
	return best ? { ...best, dist: bd } : null
}

/**
 * One handle of `list` by its frozen name; when no handle has that name, the
 * non-transformer handle nearest to `pt` (the position fallback the scenarios
 * kept from round 1b, phase 1). The result carries `by: 'name' | 'position'`
 * and `dist` to `pt` (Infinity without `pt`), or is null.
 */
export function pickHandle(list, name, pt = null) {
	const hit = Array.isArray(list) ? list.find((h) => h && h.name === name) : null
	if (hit) return { ...hit, by: 'name', dist: pt ? Math.hypot(hit.x - pt.x, hit.y - pt.y) : Infinity }
	if (!pt) return null
	const n = nearestHandle(extraHandles(list), pt)
	return n ? { ...n, by: 'position' } : null
}
