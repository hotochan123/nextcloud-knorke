/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Connector geometry of the HTTP harness (SPEC-M1 §3.10, §4.7 rule 14),
 * written from the spec text and independent of src/model/ and lib/ on
 * purpose (the harness is the oracle): the rounding formula q, the stored
 * form of a connector end and the anchor point of an end bound to an item.
 * dev/sim/geom.test.mjs pins it against tests/fixtures/connector-golden.json
 * and the endpoint cases of tests/fixtures/registry-golden.json.
 *
 * Comparing free ends (C55, C56, the convergence oracle): exact for an
 * unrotated target, ±0.01 for a rotated one (§4.7 rule 14, §12.1: sin/cos of
 * V8 and libm may differ in the last bit) – endsEqual().
 */

/** ULID of an item (26 Crockford base32 characters, upper case; OpValidator::ULID_RE). */
export const ITEM_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
/** |v| bound of free ends and positions (Limits::NUM_ABS_MAX). */
export const NUM_ABS_MAX = 1e7
/** Grid of stored anchor coordinates ax/ay and of anchor points (§4.7). */
export const ANCHOR_GRID = 10000
export const POINT_GRID = 100
/** Tolerance for free ends of rotated targets (§4.7 rule 14). */
export const ROTATED_TOL = 0.01

/**
 * The rounding formula of §4.7, literally:
 *   q(v, k) = (v < 0 ? -1 : 1) * floor(abs(v) * k + 0.5) / k
 * (R7) never -0: `+ 0` turns -0 into +0 and leaves every other value alone.
 */
export function q(v, k) {
	const r = (v < 0 ? -1 : 1) * Math.floor(Math.abs(v) * k + 0.5) / k
	return r + 0
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * The stored form of a connector end (§3.10), or null (`bad`):
 *   {item}          → {item}
 *   {item, ax, ay}  → {item, ax: q(ax, 10000), ay: q(ay, 10000)}; ax/ay checked
 *                     against [0, 1] on the value AS SENT (R8)
 *   {x, y}          → {x, y} as sent (no rounding), never -0
 * Exactly these keys; item a ULID; numbers finite JSON numbers.
 */
export function endpointOf(v) {
	if (!isObj(v)) return null
	const keys = Object.keys(v).sort().join(',')
	if (keys === 'item') return typeof v.item === 'string' && ITEM_RE.test(v.item) ? { item: v.item } : null
	if (keys === 'ax,ay,item') {
		if (typeof v.item !== 'string' || !ITEM_RE.test(v.item)) return null
		if (!isNum(v.ax) || !isNum(v.ay) || v.ax < 0 || v.ax > 1 || v.ay < 0 || v.ay > 1) return null
		return { item: v.item, ax: q(v.ax, ANCHOR_GRID), ay: q(v.ay, ANCHOR_GRID) }
	}
	if (keys === 'x,y') {
		if (!isNum(v.x) || !isNum(v.y) || Math.abs(v.x) > NUM_ABS_MAX || Math.abs(v.y) > NUM_ABS_MAX) return null
		return { x: v.x + 0, y: v.y + 0 }
	}
	return null
}

/** 'auto' | 'anchor' | 'free' | null for a stored end. */
export function endpointKind(ep) {
	if (!isObj(ep)) return null
	if ('item' in ep) return 'ax' in ep ? 'anchor' : 'auto'
	return 'x' in ep ? 'free' : null
}

/**
 * Anchor point of an end bound to an item (§4.7 rule 14): box {x, y, w, h, r}
 * relative to its container `parent` ({x, y} or null; containers are roots),
 * X = x + parent.x, Y = y + parent.y, cx = X + w/2, cy = Y + h/2; auto → the
 * centre, else dx = (ax − 0.5)·w, dy = (ay − 0.5)·h, θ = r·π/180,
 * px = cx + dx·cos θ − dy·sin θ, py = cy + dx·sin θ + dy·cos θ. The order of
 * the operations is the spec's (the golden file pins it).
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
	if (!('ax' in ep) || !('ay' in ep)) return [q(cx, POINT_GRID), q(cy, POINT_GRID)]
	const dx = (ep.ax - 0.5) * w
	const dy = (ep.ay - 0.5) * h
	const t = Number(box.r || 0) * Math.PI / 180
	const cos = Math.cos(t)
	const sin = Math.sin(t)
	const px = cx + dx * cos - dy * sin
	const py = cy + dx * sin + dy * cos
	return [q(px, POINT_GRID), q(py, POINT_GRID)]
}

/**
 * Do two free ends agree? Exact (same numbers, no -0, key order x, y) when the
 * target was unrotated, within ±0.01 per coordinate when it was rotated.
 */
export function endsEqual(got, want, rotated) {
	if (!isObj(got) || !isObj(want)) return false
	if (Object.keys(got).join(',') !== 'x,y') return false
	if (Object.is(got.x, -0) || Object.is(got.y, -0)) return false
	if (!rotated) return got.x === want.x && got.y === want.y
	return Math.abs(got.x - want.x) <= ROTATED_TOL + 1e-9 && Math.abs(got.y - want.y) <= ROTATED_TOL + 1e-9
}
