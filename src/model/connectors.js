/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Connector math, pure and without Konva (SPEC-M1 §3.10, §4.7 rule 14, §6.2).
 *
 * Ends (data.start, data.end) have exactly one of three forms:
 *   {item}            bound, the side is chosen when routing ('auto'); item is
 *                     a ULID (ULID_RE of ids.js = the server's OpValidator::ULID_RE)
 *   {item, ax, ay}    bound to an anchor of the UNROTATED box, ax/ay in [0, 1]
 *                     on the 1e-4 grid ('anchor')
 *   {x, y}            free end in absolute world coordinates ('free')
 * normalizeEndpoint() is the mirror of the server's Connectors::endpoint (the
 * `endpoint` field rule of the registry) and anchorPoint() of
 * Connectors::anchorPoint, both pinned by the golden fixtures
 * (tests/fixtures/registry-golden.json, tests/fixtures/connector-golden.json).
 *
 * Derived geometry (line, box, label position) is never stored: connectors
 * have x = y = w = h = r = 0, and routeConnector() computes the line from the
 * ends and the boxes of their targets on every change. The routing
 * algorithm is replaceable (retrofit rules §3.10).
 *
 * Routing (round 1b), deterministic (no randomness, no time, no canvas; the
 * only rounding is q(…, 100) of the anchor points, §4.7):
 * - every bound end docks at a point and leaves its box along an outward
 *   normal rounded to the nearest axis: 'anchor' at its anchor, normal from
 *   the anchor's side of the unrotated box rotated by r; 'auto' at the
 *   midpoint of the side that faces the other end (dominant axis in the
 *   box's own rotated frame), normal rotated by r. A free end has no normal.
 * - 'straight': one segment.
 * - 'elbow' (elbowRoute): orthogonal; a stub of ELBOW_STUB along each normal
 *   (lengthened when the docking point lies inside the axis-aligned box of a
 *   rotated or interior anchor), then the inner path with the fewest bends
 *   (ties: the shorter one, then the first in a fixed candidate order that
 *   starts with the balanced Z through the middle, the M0 elbow) that keeps
 *   out of both end boxes; obstacles are only the end boxes (§12.1). All 16
 *   side combinations, U-turns and S-turns included; at most 4 bends.
 * - 'curved': cubic bezier [p0, p0 + n0·d, p1 + n1·d, p1] with
 *   d = max(40, 0.4·|p1 − p0|), hitPts = sampleBezier(points, 16).
 * Cap angles point away from the line (bezier: end − last control point,
 * like Konva's Arrow); labelAt is the middle of hitPts by arc length.
 */
import { pointsBBox, q, rotatedBBox, sampleBezier } from './geometry.js'
import { ULID_RE } from './ids.js'
import { shapeOf } from './shapes.js'
import { wrapLabel } from './text.js'
import {
	CONNECTOR_LABEL_FONT_SIZE, CONNECTOR_LABEL_MAX_W, CONNECTOR_LABEL_MIN_W, CONNECTOR_LABEL_PAD, LINE_HEIGHT,
} from './tokens.js'

/** Grid of stored anchor coordinates ax/ay (§3.10): q(v, ANCHOR_GRID). */
export const ANCHOR_GRID = 10000
/** Grid of anchor points in world coordinates (§4.7 rule 14): q(v, POINT_GRID). */
export const POINT_GRID = 100
/** Length of the straight stub an elbow route leaves a box with (§6.2). */
export const ELBOW_STUB = 20
/** Limit of |x|, |y| of a free end (server NUM_ABS_MAX). */
const NUM_ABS_MAX = 1e7
/** A docking point further inside its axis-aligned box than this lengthens the stub. */
const EXIT_EPS = 0.5
/** Path lengths closer than this count as equal (candidate order decides). */
const LEN_EPS = 1e-6
/** Segments of the bezier hit polyline (§6.2). */
const BEZIER_STEPS = 16

/**
 * @typedef {{item:string}|{item:string,ax:number,ay:number}|{x:number,y:number}} Endpoint
 * @typedef {{x:number, y:number, w:number, h:number, r:number}} AbsBox
 * @typedef {{box:(AbsBox|null), ep:Endpoint, point:({x:number,y:number}|null|undefined)}} RouteEnd
 *   box = absolute box of the bound target (null for a free end or a target
 *   that is not known yet), point = fallback position when there is no box
 *   (ignored for free ends, which carry their own x/y)
 * @typedef {{x:number, y:number, nx?:number, ny?:number, box?:(AbsBox|null)}} ResolvedEnd
 *   docking point, outward axis normal ([0, 0] or missing: free) and the
 *   target box (the obstacle of an elbow route)
 * @typedef {{kind:'poly'|'bezier', points:number[], hitPts:number[], bbox:[number,number,number,number],
 *            start:{x:number,y:number,angle:number}, end:{x:number,y:number,angle:number},
 *            labelAt:({x:number,y:number}|null)}} ConnGeom
 *   points: absolute polyline, or [p0, c1, c2, p1] for 'bezier'; hitPts: the
 *   polyline for hit tests (sampleBezier(points, 16) for 'bezier'); bbox: of
 *   hitPts, unpadded (SceneModel pads with cap size, stroke and label box);
 *   angle: radians, the direction the cap at that end points to (away from
 *   the line); labelAt: middle of the line by arc length
 * @typedef {{x:number, y:number, w:number, h:number, lines:number}} LabelBox
 */

const SIDE_ANCHORS = Object.freeze({
	top: Object.freeze([0.5, 0]), right: Object.freeze([1, 0.5]), bottom: Object.freeze([0.5, 1]), left: Object.freeze([0, 0.5]),
})
const SIDE_NORMALS = Object.freeze({
	top: Object.freeze([0, -1]), right: Object.freeze([1, 0]), bottom: Object.freeze([0, 1]), left: Object.freeze([-1, 0]),
})
/** Docking anchors of items without own anchors (notes, text items): side midpoints top, right, bottom, left. */
const SIDE_MIDS = Object.freeze([SIDE_ANCHORS.top, SIDE_ANCHORS.right, SIDE_ANCHORS.bottom, SIDE_ANCHORS.left])

/**
 * @param {unknown} v value
 * @return {boolean} a non-null, non-array object
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {object} o object
 * @param {string} k key
 * @return {boolean} own property
 */
function hasOwn(o, k) {
	return Object.prototype.hasOwnProperty.call(o, k)
}

/**
 * @param {unknown} v value
 * @return {boolean} a finite JSON number (never bool or numeric text)
 */
function isNum(v) {
	return typeof v === 'number' && Number.isFinite(v)
}

/**
 * The item of a bound end: a ULID (ULID_RE, the shape the server checks with
 * OpValidator::ULID_RE; 26 Crockford base32 characters, upper case). Whether
 * it names a live, bindable item is decided in the server's board lock
 * (rule 14), not here.
 *
 * @param {unknown} item value of `item`
 * @return {boolean}
 */
function validItem(item) {
	return typeof item === 'string' && ULID_RE.test(item)
}

/**
 * Form of a connector end, with the same acceptance as the server's
 * `endpoint` rule: exactly one of the three forms, no other key, item a
 * ULID, numbers
 * finite JSON numbers, ax/ay in [0, 1] (checked on the value as given, before
 * rounding), |x|, |y| ≤ 1e7.
 *
 * @param {unknown} ep end
 * @return {'auto'|'anchor'|'free'|null} null = invalid
 */
export function endpointForm(ep) {
	if (!isMap(ep)) {
		return null
	}
	const n = Object.keys(ep).length
	if (n === 1 && hasOwn(ep, 'item')) {
		return validItem(ep.item) ? 'auto' : null
	}
	if (n === 3 && hasOwn(ep, 'item') && hasOwn(ep, 'ax') && hasOwn(ep, 'ay')) {
		const { ax, ay } = ep
		return validItem(ep.item) && isNum(ax) && isNum(ay) && ax >= 0 && ax <= 1 && ay >= 0 && ay <= 1 ? 'anchor' : null
	}
	if (n === 2 && hasOwn(ep, 'x') && hasOwn(ep, 'y')) {
		const { x, y } = ep
		return isNum(x) && isNum(y) && Math.abs(x) <= NUM_ABS_MAX && Math.abs(y) <= NUM_ABS_MAX ? 'free' : null
	}
	return null
}

/**
 * The stored form of an end (mirror of the server's Connectors::endpoint):
 * a new object with a fixed key order (item, ax, ay / x, y), ax and ay as
 * q(v, ANCHOR_GRID), free coordinates as given (not rounded); never -0.
 *
 * @param {unknown} ep end as sent
 * @return {Endpoint|null} normalised end, or null when invalid (`bad`)
 */
export function normalizeEndpoint(ep) {
	switch (endpointForm(ep)) {
	case 'auto':
		return { item: ep.item }
	case 'anchor':
		return { item: ep.item, ax: q(ep.ax, ANCHOR_GRID), ay: q(ep.ay, ANCHOR_GRID) }
	case 'free':
		return { x: ep.x + 0, y: ep.y + 0 }
	default:
		return null
	}
}

/**
 * The docking point of a bound end (§4.7 rule 14, the formula of the server's
 * Connectors::anchorPoint in the same order of operations): cx = X + w/2,
 * cy = Y + h/2; without ax/ay ('auto') the centre, otherwise
 * dx = (ax − 0.5)·w, dy = (ay − 0.5)·h, θ = r·π/180,
 * px = cx + dx·cos θ − dy·sin θ, py = cy + dx·sin θ + dy·cos θ;
 * result [q(px, 100), q(py, 100)]. For r = 0 bit-identical to PHP; for r ≠ 0
 * sin/cos of V8 and libm may differ in the last bit (compare with ±0.01).
 *
 * The box is ABSOLUTE (a child's x/y plus its parent's x/y, containers are
 * roots). A free end yields its own point (as stored, not rounded).
 *
 * @param {AbsBox|null} box absolute box of the target (x, y top-left of the unrotated box)
 * @param {Endpoint} ep end
 * @return {{x:number, y:number}|null} null without a box for a bound end
 */
export function anchorPoint(box, ep) {
	if (isMap(ep) && !hasOwn(ep, 'item') && isNum(ep.x) && isNum(ep.y)) {
		return { x: ep.x, y: ep.y }
	}
	if (!isMap(box)) {
		return null
	}
	const w = box.w
	const h = box.h
	const cx = box.x + w / 2
	const cy = box.y + h / 2
	if (!isMap(ep) || !hasOwn(ep, 'ax') || !hasOwn(ep, 'ay')) {
		return { x: q(cx, POINT_GRID), y: q(cy, POINT_GRID) }
	}
	const dx = (ep.ax - 0.5) * w
	const dy = (ep.ay - 0.5) * h
	const t = (box.r || 0) * Math.PI / 180
	const cos = Math.cos(t)
	const sin = Math.sin(t)
	const px = cx + dx * cos - dy * sin
	const py = cy + dx * sin + dy * cos
	return { x: q(px, POINT_GRID), y: q(py, POINT_GRID) }
}

/**
 * Size of an end cap (arrow, triangle, dot, diamond) for a stroke width:
 * 3·strokeWidth + 4. A missing or invalid width counts as the default 2
 * (style.strokeWidth, §3.10), so capSize() of a default connector is 10.
 *
 * @param {unknown} strokeWidth style.strokeWidth
 * @return {number}
 */
export function capSize(strokeWidth) {
	const sw = isNum(strokeWidth) && strokeWidth >= 0 ? strokeWidth : 2
	return 3 * sw + 4
}

/**
 * Re-targets an end for pasting (§6.5.2, §6.5.3): a bound end whose item is
 * a key of idMap gets the mapped id (ax/ay kept); every other end (a free
 * end, or a bound end whose item is not mapped) becomes the free point
 * `freePoint`. Keeping a binding to an existing item (same board, target
 * alive) = mapping that id to itself. Ids on both sides must be ULIDs: an
 * end whose item or mapped id is not one counts as unmapped.
 *
 * @param {Endpoint} ep end from the clipboard payload
 * @param {Map<string,string>|Record<string,string>} idMap old id → new id
 * @param {{x:number,y:number}|((ep:Endpoint) => ({x:number,y:number}|null))|null} [freePoint] the
 *   free end to use (for a free end: its position after the paste offset);
 *   a function is called only when needed
 * @return {Endpoint|null} a new end; for an unmapped end without a usable
 *   freePoint a free end keeps its own x/y, a bound end gives null
 */
export function remapEndpoint(ep, idMap, freePoint = null) {
	if (isMap(ep) && validItem(ep.item)) {
		let id
		if (idMap instanceof Map) {
			id = idMap.get(ep.item)
		} else if (isMap(idMap) && hasOwn(idMap, ep.item)) {
			id = idMap[ep.item]
		}
		if (validItem(id)) {
			return hasOwn(ep, 'ax') && hasOwn(ep, 'ay') ? { item: id, ax: ep.ax, ay: ep.ay } : { item: id }
		}
	}
	const p = typeof freePoint === 'function' ? freePoint(ep) : freePoint
	if (isMap(p) && isNum(p.x) && isNum(p.y)) {
		return { x: p.x + 0, y: p.y + 0 }
	}
	if (endpointForm(ep) === 'free') {
		return { x: ep.x + 0, y: ep.y + 0 }
	}
	return null
}

// ---------------------------------------------------------------- anchors of targets ([S]-internal)

/**
 * The four docking anchors of a bindable item ([S]-internal: snapping of the
 * connect tool and the "+" handles, §6.3): SHAPES[kind].anchors for shapes,
 * the side midpoints for every other type; order top, right, bottom, left.
 *
 * @param {unknown} t item type
 * @param {unknown} [kind] data.kind of a shape (unknown kinds count as rect)
 * @return {ReadonlyArray<ReadonlyArray<number>>} [[ax, ay], …] (frozen)
 */
export function anchorsFor(t, kind) {
	return t === 'shape' ? shapeOf(kind).anchors : SIDE_MIDS
}

/**
 * Outward direction of an anchor in the item's own (unrotated) frame: the
 * axis from the box centre towards the anchor ([0, 0] for the centre).
 *
 * @param {number} ax anchor x (0..1)
 * @param {number} ay anchor y (0..1)
 * @return {[number, number]}
 */
export function anchorNormal(ax, ay) {
	return toAxis(ax - 0.5, ay - 0.5)
}

// ---------------------------------------------------------------- routing

/**
 * @param {number} x vector x
 * @param {number} y vector y
 * @param {number} deg rotation in degrees (clockwise, Konva)
 * @return {[number, number]}
 */
function rotate(x, y, deg) {
	if (!deg) {
		return [x, y]
	}
	const t = deg * Math.PI / 180
	const c = Math.cos(t)
	const s = Math.sin(t)
	return [x * c - y * s, x * s + y * c]
}

/**
 * @param {number} x vector x
 * @param {number} y vector y
 * @return {[number, number]} the nearest axis direction ([0, 0] for a zero vector)
 */
function toAxis(x, y) {
	if (x === 0 && y === 0) {
		return [0, 0]
	}
	return Math.abs(x) >= Math.abs(y) ? [x >= 0 ? 1 : -1, 0] : [0, y >= 0 ? 1 : -1]
}

/**
 * @param {AbsBox} b box
 * @return {{x:number, y:number}} centre
 */
function centreOf(b) {
	return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

/**
 * @param {AbsBox} b box
 * @return {[number, number, number, number]} axis-aligned bounds of the (rotated) box
 */
function aabbOf(b) {
	const r = rotatedBBox(b.x, b.y, b.w, b.h, b.r || 0)
	return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
}

/**
 * Reference point of an end for the side choice of the other end: the
 * docking point when fixed (free, anchor), the box centre for 'auto'.
 *
 * @param {RouteEnd} end end
 * @return {{x:number, y:number}|null}
 */
function referenceOf(end) {
	const form = endpointForm(end?.ep)
	if (form === 'free') {
		return { x: end.ep.x, y: end.ep.y }
	}
	if (isMap(end?.box)) {
		return form === 'anchor' ? anchorPoint(end.box, end.ep) : centreOf(end.box)
	}
	return isMap(end?.point) && isNum(end.point.x) && isNum(end.point.y) ? { x: end.point.x, y: end.point.y } : null
}

/**
 * Resolves one end: docking point, outward normal (rounded to the nearest
 * axis, [0, 0] for a free end or a missing box) and the target box.
 *
 * @param {RouteEnd} end this end
 * @param {{x:number, y:number}} other reference point of the other end
 * @return {ResolvedEnd|null}
 */
function resolveEnd(end, other) {
	const form = endpointForm(end?.ep)
	const box = isMap(end?.box) ? end.box : null
	if (form === 'free' || !box) {
		const p = referenceOf(end)
		return p ? { x: p.x, y: p.y, nx: 0, ny: 0, box: null } : null
	}
	const r = box.r || 0
	if (form === 'anchor') {
		const p = anchorPoint(box, end.ep)
		const [nx, ny] = toAxis(...rotate(...anchorNormal(end.ep.ax, end.ep.ay), r))
		return { x: p.x, y: p.y, nx, ny, box }
	}
	// 'auto' (or an invalid end on a known box): side from the dominant axis
	// between the centre and the other end, measured in the box's own frame
	// (M0 routeConnector for r = 0), normal rotated by r and rounded.
	const c = centreOf(box)
	const [lx, ly] = rotate(other.x - c.x, other.y - c.y, -r)
	const side = Math.abs(lx) >= Math.abs(ly) ? (lx >= 0 ? 'right' : 'left') : (ly >= 0 ? 'bottom' : 'top')
	const [ax, ay] = SIDE_ANCHORS[side]
	const p = anchorPoint(box, { item: 'x', ax, ay })
	const [nx, ny] = toAxis(...rotate(...SIDE_NORMALS[side], r))
	return { x: p.x, y: p.y, nx, ny, box }
}

/**
 * Removes zero-length segments and middle points of straight runs.
 *
 * @param {number[]} pts flat points
 * @return {number[]}
 */
function simplify(pts) {
	const out = []
	for (let i = 0; i < pts.length; i += 2) {
		const x = pts[i]
		const y = pts[i + 1]
		const n = out.length
		if (n >= 2 && out[n - 2] === x && out[n - 1] === y) {
			continue
		}
		if (n >= 4) {
			const x0 = out[n - 4]
			const y0 = out[n - 3]
			const x1 = out[n - 2]
			const y1 = out[n - 1]
			if ((x0 === x1 && x1 === x) || (y0 === y1 && y1 === y)) {
				out[n - 2] = x
				out[n - 1] = y
				continue
			}
		}
		out.push(x, y)
	}
	return out
}

/**
 * Where an elbow route leaves an end: ELBOW_STUB along the normal, measured
 * from the edge of the end's axis-aligned box when the docking point lies
 * inside it (an anchor inside the box, a side of a rotated box); the end
 * itself when it has no normal (free end, centre anchor).
 *
 * @param {ResolvedEnd} e end
 * @param {number} stub stub length
 * @return {{x:number, y:number}}
 */
function stubOf(e, stub) {
	const nx = e.nx || 0
	const ny = e.ny || 0
	if (nx === 0 && ny === 0) {
		return { x: e.x, y: e.y }
	}
	let d = stub
	if (isMap(e.box)) {
		const [x0, y0, x1, y1] = aabbOf(e.box)
		const exit = nx > 0 ? x1 - e.x : nx < 0 ? e.x - x0 : ny > 0 ? y1 - e.y : e.y - y0
		if (exit > EXIT_EPS) d += exit
	}
	return { x: e.x + nx * d, y: e.y + ny * d }
}

/**
 * Stub lengths of both ends: `stub`, except when the ends face each other
 * closer than two stubs (each gets half the gap, so the route stays straight
 * or a tight Z instead of a loop) or a free end lies ahead of the other end
 * closer than one stub (that stub ends level with it: one bend).
 *
 * @param {ResolvedEnd} a start
 * @param {ResolvedEnd} b end
 * @param {number} stub stub length
 * @return {[number, number]}
 */
function stubLengths(a, b, stub) {
	const anx = a.nx || 0
	const any = a.ny || 0
	const bnx = b.nx || 0
	const bny = b.ny || 0
	const hasA = anx !== 0 || any !== 0
	const hasB = bnx !== 0 || bny !== 0
	let la = stub
	let lb = stub
	if (hasA && hasB && anx === -bnx && any === -bny) {
		const d = (b.x - a.x) * anx + (b.y - a.y) * any
		if (d > 0 && d < 2 * stub) {
			la = d / 2
			lb = d / 2
		}
	} else if (hasA && !hasB) {
		const d = (b.x - a.x) * anx + (b.y - a.y) * any
		if (d > 0 && d < stub) la = d
	} else if (hasB && !hasA) {
		const d = (a.x - b.x) * bnx + (a.y - b.y) * bny
		if (d > 0 && d < stub) lb = d
	}
	return [la, lb]
}

/**
 * @param {number[]} r obstacle [x0, y0, x1, y1]
 * @param {{x:number, y:number}} p point
 * @return {boolean} p strictly inside
 */
function inside(r, p) {
	return p.x > r[0] && p.x < r[2] && p.y > r[1] && p.y < r[3]
}

/**
 * @param {number} x0 segment start x
 * @param {number} y0 segment start y
 * @param {number} x1 segment end x
 * @param {number} y1 segment end y
 * @param {number[]} r obstacle [x0, y0, x1, y1]
 * @return {boolean} an axis-parallel segment crosses the open rectangle
 */
function crosses(x0, y0, x1, y1, r) {
	if (y0 === y1) {
		return y0 > r[1] && y0 < r[3] && Math.max(x0, x1) > r[0] && Math.min(x0, x1) < r[2]
	}
	return x0 > r[0] && x0 < r[2] && Math.max(y0, y1) > r[1] && Math.min(y0, y1) < r[3]
}

/**
 * Bends and length of an orthogonal polyline, or null when it is not
 * orthogonal or turns back on itself (a spike: a segment reversing the
 * previous one, e.g. into a stub).
 *
 * @param {number[]} pts flat points
 * @return {{bends:number, length:number}|null}
 */
function shapeOfPath(pts) {
	let bends = 0
	let length = 0
	let pdx = 0
	let pdy = 0
	for (let i = 0; i + 3 < pts.length; i += 2) {
		const dx = pts[i + 2] - pts[i]
		const dy = pts[i + 3] - pts[i + 1]
		if (dx === 0 && dy === 0) continue
		if (dx !== 0 && dy !== 0) return null
		const sx = Math.sign(dx)
		const sy = Math.sign(dy)
		if (pdx !== 0 || pdy !== 0) {
			if (sx === -pdx && sy === -pdy) return null
			if (sx !== pdx || sy !== pdy) bends++
		}
		pdx = sx
		pdy = sy
		length += Math.abs(dx) + Math.abs(dy)
	}
	return { bends, length }
}

/**
 * @param {number[]} out list to extend
 * @param {number} v value (added once, in first-seen order)
 */
function addOnce(out, v) {
	if (Number.isFinite(v) && !out.includes(v)) out.push(v)
}

/**
 * Orthogonal route between two resolved ends (§6.2): a stub of `stub` along
 * each end's normal (see stubOf), then the inner path between the stub
 * points with the fewest bends that keeps out of both end boxes (inflated
 * by stub/2; a box containing a stub point is no obstacle); ties go to the
 * shorter path, then to the first candidate in this fixed order: straight,
 * the Z through the middle (vertical, then horizontal), the two L shapes
 * (dominant axis first), every Z and every U/S shape over the coordinate
 * lines of the stub points, the box edges + stub and the channels between
 * the boxes. Without a candidate that avoids the boxes the best one ignoring
 * them is taken. A free end (no normal) has no stub and no direction.
 *
 * @param {ResolvedEnd} a resolved start
 * @param {ResolvedEnd} b resolved end
 * @param {{stub?: number}} [opts] stub length
 * @return {number[]} flat absolute points from a to b (orthogonal, simplified)
 */
export function elbowRoute(a, b, { stub = ELBOW_STUB } = {}) {
	const [la, lb] = stubLengths(a, b, stub)
	const s0 = stubOf(a, la)
	const s1 = stubOf(b, lb)
	const boxA = isMap(a.box) ? aabbOf(a.box) : null
	const boxB = isMap(b.box) ? aabbOf(b.box) : null
	const m = stub / 2
	const obstacles = []
	for (const bx of [boxA, boxB]) {
		if (!bx) continue
		const o = [bx[0] - m, bx[1] - m, bx[2] + m, bx[3] + m]
		if (inside(o, s0) || inside(o, s1)) continue
		if (!obstacles.some((x) => x[0] === o[0] && x[1] === o[1] && x[2] === o[2] && x[3] === o[3])) obstacles.push(o)
	}
	const xs = []
	const ys = []
	addOnce(xs, (s0.x + s1.x) / 2)
	addOnce(ys, (s0.y + s1.y) / 2)
	for (const v of [s0.x, s1.x]) addOnce(xs, v)
	for (const v of [s0.y, s1.y]) addOnce(ys, v)
	for (const bx of [boxA, boxB]) {
		if (!bx) continue
		addOnce(xs, bx[0] - stub)
		addOnce(xs, bx[2] + stub)
		addOnce(ys, bx[1] - stub)
		addOnce(ys, bx[3] + stub)
	}
	if (boxA && boxB) {
		if (boxA[2] < boxB[0]) addOnce(xs, (boxA[2] + boxB[0]) / 2)
		if (boxB[2] < boxA[0]) addOnce(xs, (boxB[2] + boxA[0]) / 2)
		if (boxA[3] < boxB[1]) addOnce(ys, (boxA[3] + boxB[1]) / 2)
		if (boxB[3] < boxA[1]) addOnce(ys, (boxB[3] + boxA[1]) / 2)
	}
	const cands = [[]]
	cands.push([xs[0], s0.y, xs[0], s1.y], [s0.x, ys[0], s1.x, ys[0]])
	const lh = [s1.x, s0.y]
	const lv = [s0.x, s1.y]
	if (Math.abs(s1.x - s0.x) >= Math.abs(s1.y - s0.y)) cands.push(lh, lv)
	else cands.push(lv, lh)
	for (const x of xs) cands.push([x, s0.y, x, s1.y])
	for (const y of ys) cands.push([s0.x, y, s1.x, y])
	for (const x of xs) {
		for (const y of ys) {
			cands.push([s0.x, y, x, y, x, s1.y], [x, s0.y, x, y, s1.x, y])
		}
	}
	let best = null
	let bestFree = null
	for (const mid of cands) {
		const inner = [s0.x, s0.y, ...mid, s1.x, s1.y]
		const full = [a.x, a.y, ...inner, b.x, b.y]
		const sh = shapeOfPath(full)
		if (!sh) continue
		let hit = false
		for (let i = 0; i + 3 < inner.length && !hit; i += 2) {
			const x0 = inner[i]
			const y0 = inner[i + 1]
			const x1 = inner[i + 2]
			const y1 = inner[i + 3]
			if (x0 === x1 && y0 === y1) continue
			for (const o of obstacles) {
				if (crosses(x0, y0, x1, y1, o)) {
					hit = true
					break
				}
			}
		}
		const cand = { full, bends: sh.bends, length: sh.length }
		if (!hit && better(cand, bestFree)) bestFree = cand
		if (better(cand, best)) best = cand
	}
	const pick = bestFree ?? best
	return simplify(pick ? pick.full : [a.x, a.y, s0.x, s0.y, s1.x, s0.y, s1.x, s1.y, b.x, b.y])
}

/**
 * @param {{bends:number, length:number}} c candidate
 * @param {{bends:number, length:number}|null} best best so far
 * @return {boolean} c beats best (fewer bends, then shorter; equal keeps best)
 */
function better(c, best) {
	if (best === null) return true
	if (c.bends !== best.bends) return c.bends < best.bends
	return c.length < best.length - LEN_EPS
}

/**
 * @param {number[]} pts flat polyline
 * @return {{x:number, y:number}|null} point at half the arc length
 */
function midpoint(pts) {
	if (pts.length < 2) {
		return null
	}
	let total = 0
	for (let i = 0; i + 3 < pts.length; i += 2) {
		total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1])
	}
	let rest = total / 2
	for (let i = 0; i + 3 < pts.length; i += 2) {
		const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1])
		if (len > 0 && rest <= len) {
			const t = rest / len
			return { x: pts[i] + (pts[i + 2] - pts[i]) * t, y: pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t }
		}
		rest -= len
	}
	return { x: pts[0], y: pts[1] }
}

/**
 * Direction (radians) from the first point of `pts` that differs from
 * (x, y) towards (x, y): the way an end cap at (x, y) points.
 *
 * @param {number} x end x
 * @param {number} y end y
 * @param {number[]} pts candidate points, nearest first
 * @return {number}
 */
function capAngle(x, y, pts) {
	for (let i = 0; i + 1 < pts.length; i += 2) {
		if (pts[i] !== x || pts[i + 1] !== y) {
			return Math.atan2(y - pts[i + 1], x - pts[i])
		}
	}
	return 0
}

/**
 * Routes a connector (§6.2). Ends: a fixed docking point for 'anchor' and
 * 'free'; for 'auto' the side of the target box from the dominant axis
 * towards the other end (measured in the box's rotated frame), its midpoint
 * as docking point and its normal rounded to the nearest axis. Routes:
 * 'straight' (anything unknown, rule 18), 'elbow' (elbowRoute) and 'curved'
 * (cubic bezier, control points p ± n·max(40, 0.4·d), hitPts sampled with
 * 16 segments; a free end has no normal, its control point is the end).
 *
 * @param {RouteEnd} a start
 * @param {RouteEnd} b end
 * @param {unknown} route data.route
 * @param {{stub?: number}} [opts] elbow stub length (ELBOW_STUB)
 * @return {ConnGeom|null} null while an end has neither box nor point
 *   (unknown target, the connector is not drawn yet)
 */
export function routeConnector(a, b, route, opts = {}) {
	const ra = referenceOf(a)
	const rb = referenceOf(b)
	if (!ra || !rb) {
		return null
	}
	const pa = resolveEnd(a, rb)
	const pb = resolveEnd(b, ra)
	let kind = 'poly'
	let points
	let hitPts
	if (route === 'elbow') {
		points = elbowRoute(pa, pb, opts)
		hitPts = points
	} else if (route === 'curved') {
		const d = Math.max(40, 0.4 * Math.hypot(pb.x - pa.x, pb.y - pa.y))
		kind = 'bezier'
		points = [pa.x, pa.y, pa.x + pa.nx * d, pa.y + pa.ny * d, pb.x + pb.nx * d, pb.y + pb.ny * d, pb.x, pb.y]
		hitPts = sampleBezier(points, BEZIER_STEPS)
	} else {
		points = [pa.x, pa.y, pb.x, pb.y]
		hitPts = points
	}
	const n = points.length
	const reversed = []
	for (let i = n - 2; i >= 0; i -= 2) reversed.push(points[i], points[i + 1])
	return {
		kind,
		points,
		hitPts,
		bbox: pointsBBox(hitPts),
		start: { x: pa.x, y: pa.y, angle: capAngle(pa.x, pa.y, points.slice(2)) },
		end: { x: pb.x, y: pb.y, angle: capAngle(pb.x, pb.y, reversed.slice(2)) },
		labelAt: midpoint(hitPts),
	}
}

// ---------------------------------------------------------------- label box ([S]-internal)

/**
 * Estimated box of a connector label centred at `at` ([S]-internal, §6.3:
 * label on a BOARD_BACKGROUND box at 50 % of the path). No canvas measuring
 * (deterministic on every client, like autoFontSize): the text is wrapped at
 * CONNECTOR_LABEL_MAX_W − 2·pad exactly like Konva.Text wraps it, with an
 * UPPER BOUND per glyph (text.js wrapLabel, labelGlyphWidth); the box is the
 * widest line (at least CONNECTOR_LABEL_MIN_W) by font size × LINE_HEIGHT
 * per line, CONNECTOR_LABEL_PAD around. Konva then lays the text out at that
 * width in at most `lines` lines without cutting a glyph (finding S-1b-01:
 * the old 0.6 em estimate cut 'OK', emoji and CJK). The model uses the box
 * for the hit test and the rbush padding, the node for the background and the
 * text box, the label editor for its size.
 *
 * @param {unknown} text label (anything but a non-empty string: no box)
 * @param {{x:number, y:number}|null} at centre (labelAt of the route)
 * @return {LabelBox|null}
 */
export function labelBox(text, at) {
	if (typeof text !== 'string' || text === '' || !isMap(at) || !isNum(at.x) || !isNum(at.y)) {
		return null
	}
	const fs = CONNECTOR_LABEL_FONT_SIZE
	const pad = CONNECTOR_LABEL_PAD
	const rows = wrapLabel(text, CONNECTOR_LABEL_MAX_W - 2 * pad, fs)
	let widest = CONNECTOR_LABEL_MIN_W
	for (const r of rows) widest = Math.max(widest, r.width)
	const lines = rows.length
	const w = widest + 2 * pad
	const h = lines * fs * LINE_HEIGHT + 2 * pad
	return { x: at.x - w / 2, y: at.y - h / 2, w, h, lines }
}
