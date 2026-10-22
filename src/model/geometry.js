/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Engine-independent geometry (SPEC-M0 §6.2): port of the engine spike's
 * geometry.js without bezierPath (that one only fed the Leafer renderer).
 * Connector routing is derived, never stored; M0 has no connector UI, but the
 * routing stays here so M1 only adds a node type. Bounding boxes and the
 * precise point tests serve the rbush hit test of SceneModel.
 *
 * Conventions: boxes are {x, y, w, h} with the origin top-left, rotation in
 * degrees clockwise around the box centre (Konva's convention), bounding boxes
 * as [minX, minY, maxX, maxY].
 *
 * M1 (SPEC-M1 §6.2): q(v, k) is the one rounding formula shared with the
 * server (§4.7); routeConnector below stays the M0 box-to-box router, the M1
 * connector geometry lives in connectors.js; shapePolygon delegates to the
 * shape table (shapes.js).
 */
import { ARROW_SIZE } from './tokens.js'
import { outlinePoints, shapeOf } from './shapes.js'

/**
 * The rounding formula of SPEC-M1 §4.7, bit-identical to the server's
 * Connectors::q (PHP):
 *   q(v, k) = (v < 0 ? -1 : 1) * floor(abs(v) * k + 0.5) / k
 * Never Math.round or toFixed: they disagree with PHP on ≈ 7 % of a 0.01 grid
 * (1.005 * 100 is 100.49999999999999, so q(1.005, 100) = 1). (R7) The result is
 * never -0: for -0.5/k < v < 0 the formula yields -0, which JSON.stringify
 * writes as "0" but PHP's json_encode as "-0"; adding +0 turns -0 into +0 and
 * leaves every other value unchanged. Grids in use: anchor points k = 100,
 * ax/ay k = 10000, presence v k = 10, client transform/arrange values k = 100.
 *
 * @param {number} v value
 * @param {number} k grid (positive integer)
 * @return {number} v on the 1/k grid, half away from zero, never -0
 */
export function q(v, k) {
	const r = (v < 0 ? -1 : 1) * Math.floor(Math.abs(v) * k + 0.5) / k
	return r + 0
}

const NORMALS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }

/**
 * @param {{x:number, y:number, w:number, h:number}} b box
 * @param {'left'|'right'|'top'|'bottom'} side side of the box
 * @return {[number, number]} midpoint of that side
 */
function sideAnchor(b, side) {
	switch (side) {
	case 'left': return [b.x, b.y + b.h / 2]
	case 'right': return [b.x + b.w, b.y + b.h / 2]
	case 'top': return [b.x + b.w / 2, b.y]
	default: return [b.x + b.w / 2, b.y + b.h]
	}
}

/**
 * Routes a connector between two absolute boxes.
 *
 * @param {{x:number, y:number, w:number, h:number}} a start box
 * @param {{x:number, y:number, w:number, h:number}} b end box
 * @param {'straight'|'elbow'|'curved'} route routing style (anything else = straight)
 * @return {{kind:'poly'|'bezier', points:number[], bbox:number[]}} absolute points;
 *   for 'bezier' they are [p0, c1, c2, p1]
 */
export function routeConnector(a, b, route) {
	const acx = a.x + a.w / 2
	const acy = a.y + a.h / 2
	const bcx = b.x + b.w / 2
	const bcy = b.y + b.h / 2
	const dx = bcx - acx
	const dy = bcy - acy
	let sa
	let sb
	if (Math.abs(dx) >= Math.abs(dy)) {
		sa = dx >= 0 ? 'right' : 'left'
		sb = dx >= 0 ? 'left' : 'right'
	} else {
		sa = dy >= 0 ? 'bottom' : 'top'
		sb = dy >= 0 ? 'top' : 'bottom'
	}
	const [x0, y0] = sideAnchor(a, sa)
	const [x1, y1] = sideAnchor(b, sb)
	let kind = 'poly'
	let points
	if (route === 'elbow') {
		if (sa === 'left' || sa === 'right') {
			const mx = (x0 + x1) / 2
			points = [x0, y0, mx, y0, mx, y1, x1, y1]
		} else {
			const my = (y0 + y1) / 2
			points = [x0, y0, x0, my, x1, my, x1, y1]
		}
	} else if (route === 'curved') {
		const d = Math.max(40, 0.4 * Math.hypot(x1 - x0, y1 - y0))
		const na = NORMALS[sa]
		const nb = NORMALS[sb]
		kind = 'bezier'
		points = [x0, y0, x0 + na[0] * d, y0 + na[1] * d, x1 + nb[0] * d, y1 + nb[1] * d, x1, y1]
	} else {
		points = [x0, y0, x1, y1]
	}
	return { kind, points, bbox: pointsBBox(points, ARROW_SIZE) }
}

/**
 * @param {number[]} points flat [x0, y0, x1, y1, …]
 * @param {number} [pad] padding on every side
 * @return {number[]} [minX, minY, maxX, maxY]
 */
export function pointsBBox(points, pad = 0) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (let i = 0; i < points.length; i += 2) {
		const x = points[i]
		const y = points[i + 1]
		if (x < minX) minX = x
		if (x > maxX) maxX = x
		if (y < minY) minY = y
		if (y > maxY) maxY = y
	}
	return [minX - pad, minY - pad, maxX + pad, maxY + pad]
}

/**
 * Axis-aligned bounding box of a box rotated (degrees, clockwise) around its centre.
 *
 * @param {number} x left
 * @param {number} y top
 * @param {number} w width
 * @param {number} h height
 * @param {number} rotation degrees
 * @return {number[]} [minX, minY, maxX, maxY]
 */
export function rotatedBBox(x, y, w, h, rotation) {
	if (!rotation) {
		return [x, y, x + w, y + h]
	}
	const r = rotation * Math.PI / 180
	const c = Math.abs(Math.cos(r))
	const s = Math.abs(Math.sin(r))
	const cx = x + w / 2
	const cy = y + h / 2
	const hw = (w * c + h * s) / 2
	const hh = (w * s + h * c) / 2
	return [cx - hw, cy - hh, cx + hw, cy + hh]
}

/**
 * Transforms a world point into the unrotated local frame of a box (origin top-left).
 *
 * @param {number} px point x
 * @param {number} py point y
 * @param {number} x box left
 * @param {number} y box top
 * @param {number} w box width
 * @param {number} h box height
 * @param {number} rotation degrees
 * @return {[number, number]} local coordinates
 */
export function toLocal(px, py, x, y, w, h, rotation) {
	if (!rotation) {
		return [px - x, py - y]
	}
	const r = -rotation * Math.PI / 180
	const c = Math.cos(r)
	const s = Math.sin(r)
	const cx = x + w / 2
	const cy = y + h / 2
	const dx = px - cx
	const dy = py - cy
	return [dx * c - dy * s + w / 2, dx * s + dy * c + h / 2]
}

/**
 * Even-odd point-in-polygon test.
 *
 * @param {number} px point x
 * @param {number} py point y
 * @param {number[]} pts flat polygon points
 * @return {boolean}
 */
export function pointInPolygon(px, py, pts) {
	let inside = false
	for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
		const xi = pts[i]
		const yi = pts[i + 1]
		const xj = pts[j]
		const yj = pts[j + 1]
		if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
			inside = !inside
		}
	}
	return inside
}

/**
 * @param {number} px point x
 * @param {number} py point y
 * @param {number} x0 segment start x
 * @param {number} y0 segment start y
 * @param {number} x1 segment end x
 * @param {number} y1 segment end y
 * @return {number} distance from the point to the segment
 */
export function distToSegment(px, py, x0, y0, x1, y1) {
	const dx = x1 - x0
	const dy = y1 - y0
	const l2 = dx * dx + dy * dy
	let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0
	t = t < 0 ? 0 : t > 1 ? 1 : t
	return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/**
 * @param {number} px point x
 * @param {number} py point y
 * @param {number[]} pts flat polyline points
 * @param {number} [ox] offset added to every x
 * @param {number} [oy] offset added to every y
 * @return {number} smallest distance to any segment (Infinity for < 2 points)
 */
export function distToPolyline(px, py, pts, ox = 0, oy = 0) {
	let best = Infinity
	for (let i = 0; i + 3 < pts.length; i += 2) {
		const d = distToSegment(px, py, pts[i] + ox, pts[i + 1] + oy, pts[i + 2] + ox, pts[i + 3] + oy)
		if (d < best) best = d
	}
	return best
}

/**
 * Samples a cubic bezier [p0, c1, c2, p1] into a polyline (for hit testing).
 *
 * @param {number[]} p 8 numbers
 * @param {number} [steps] segments
 * @return {number[]} flat points, steps + 1 of them
 */
export function sampleBezier(p, steps = 16) {
	const out = []
	for (let i = 0; i <= steps; i++) {
		const t = i / steps
		const u = 1 - t
		const a = u * u * u
		const b = 3 * u * u * t
		const c = 3 * u * t * t
		const d = t * t * t
		out.push(a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7])
	}
	return out
}

/**
 * Local polygon points of the polygonal shape kinds (SHAPES[kind].outline is a
 * list: diamond, triangle, arrowRight); delegates to shapes.outlinePoints.
 *
 * @param {string} kind shape kind (unknown kinds count as rect)
 * @param {number} w width
 * @param {number} h height
 * @return {number[]|null} flat points in item coordinates, or null for the
 *   non-polygonal kinds (rect, roundRect: box; ellipse: ellipse formula)
 */
export function shapePolygon(kind, w, h) {
	return Array.isArray(shapeOf(kind).outline) ? outlinePoints(kind, w, h) : null
}
