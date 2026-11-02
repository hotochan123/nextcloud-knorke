/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * What a click on "+" does (job 162), pure: reads the SceneModel, no scene,
 * no DOM. The click (actions.neighbourItem) and the mouse preview of the
 * scene (SceneManager) both ask plusPlan, so they never disagree.
 *
 * Everything is measured in the rotated frame of the source Q (a note or a
 * shape): n is the outer normal of the side s, u the axis along s.
 *
 * - neighbourBox: the place of the neighbour N of job 136 (also of a text
 *   item's copy, job 159), moved here unchanged from neighbourItem: Q's size
 *   and rotation, SERIES_GAP beyond the side, flush with Q across it, moved
 *   on past every item it would cover (covers: touching does not count).
 *   (job 211) Below a symbol, BPMN event or gateway the neighbour begins
 *   SERIES_GAP below its label (SceneModel labelReach).
 *   (job 188) movePast is that last step alone; actions.takeNote puts the
 *   note taken off a pad with Enter there, and a note pad counts with its
 *   sheets and title band (model/pad.js padExtent).
 * - plusPlan: a near item X instead, when there is one. X is any note,
 *   shape or text item but Q with w, h > 0 (locked, grouped or in another
 *   frame too; never a frame or a connector) whose rotated box
 *   - begins d = −TOUCH_TOLERANCE … PLUS_REACH beyond the side s (d = its
 *     least projection on n minus that of s: touching counts, overlapping Q
 *     does not),
 *   - shares more than TOUCH_TOLERANCE of Q's extent along u (a corner does
 *     not count),
 *   - and is not joined with Q by a connector yet (either direction, with or
 *     without anchors).
 *   The least d wins, within TOUCH_TOLERANCE of it the least distance of the
 *   centres along u, then the smaller id. The connector runs from the anchor
 *   of the clicked "+" to the anchor of X that lies furthest back along n
 *   (the side facing Q); ties: the one nearest to the start, then t, r, b, l.
 */
import { anchorPoint, anchorsFor } from './connectors.js'
import { q, rotatedBBox } from './geometry.js'
import { padExtent } from './pad.js'
import { getPath } from './paths.js'
import { isBindable, typeInfo } from './registry.js'
import { labelReach } from './SceneModel.js'

/** Gap between a note and the next one of a series entry (§6.5.1), and between an item and its neighbour (job 136). */
export const SERIES_GAP = 20
/** (job 162) How far beyond the side of a "+" a near item may begin (world units) for a click to connect to it. */
export const PLUS_REACH = 200
/** A shared area of two boxes up to this depth (world units) is touching, not covering; plusPlan's ties lie within it. */
export const TOUCH_TOLERANCE = 0.01
/** Outer normal of each side of an item at rotation 0 (job 136), in the anchor order t, r, b, l. */
export const NEIGHBOUR_SIDES = Object.freeze({ t: Object.freeze([0, -1]), r: Object.freeze([1, 0]), b: Object.freeze([0, 1]), l: Object.freeze([-1, 0]) })
/** Per side: the index of its anchor in anchorsFor (t, r, b, l). */
const SIDE_INDEX = Object.freeze({ t: 0, r: 1, b: 2, l: 3 })
/** Float noise of rotated projections on top of PLUS_REACH (a box exactly PLUS_REACH away still counts). */
const REACH_NOISE = 1e-6

/**
 * @param {unknown} v value
 * @return {boolean} finite number
 */
function isNum(v) {
	return typeof v === 'number' && Number.isFinite(v)
}

/**
 * @param {string} t type
 * @param {number} v size
 * @return {number} v within the size limits of the type (as actions.js clampSize)
 */
function clampSize(t, v) {
	const size = typeInfo(t).size
	return Math.min(size[1], Math.max(size[0], v))
}

/**
 * @param {number} r degrees
 * @return {number} the same direction in [0, 360) on the 0.01 grid, never -0 (as actions.js normAngle)
 */
function normAngle(r) {
	if (!isNum(r)) {
		return 0
	}
	let d = q(((r % 360) + 360) % 360, 100)
	if (d >= 360) {
		d -= 360
	}
	return d + 0
}

/**
 * @param {unknown} side side
 * @return {ReadonlyArray<number>|null} its outer normal at rotation 0, null for anything but t, r, b, l
 */
function normalOf(side) {
	return typeof side === 'string' && Object.prototype.hasOwnProperty.call(NEIGHBOUR_SIDES, side) ? NEIGHBOUR_SIDES[side] : null
}

/**
 * @param {object} model SceneModel
 * @param {unknown} id item id
 * @return {{item: object, a: object}|null} a note, shape or text item with its absolute box, else null
 */
function sourceOf(model, id) {
	const item = typeof id === 'string' && model.has(id) ? model.get(id) : null
	const a = item ? model.abs(id) : null
	return a && isBindable(item.t) && typeInfo(item.t).placement === 'box' ? { item, a } : null
}

/**
 * @param {{x: number, y: number, w: number, h: number, r?: number}} b absolute box, rotated around its centre
 * @return {{cx: number, cy: number, hw: number, hh: number, c: number, s: number, box: number[]}} centre, half
 *   sizes, cos/sin of the rotation and the axis-aligned hull [minX, minY, maxX, maxY]
 */
function orientedBox(b) {
	const a = (isNum(b.r) ? b.r : 0) * Math.PI / 180
	return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, hw: b.w / 2, hh: b.h / 2, c: Math.cos(a), s: Math.sin(a), box: rotatedBBox(b.x, b.y, b.w, b.h, b.r || 0) }
}

/**
 * @param {object} o oriented box (orientedBox)
 * @param {number} ax axis x (unit vector)
 * @param {number} ay axis y
 * @return {number} half the length of the box projected onto the axis
 */
function reach(o, ax, ay) {
	return o.hw * Math.abs(o.c * ax + o.s * ay) + o.hh * Math.abs(-o.s * ax + o.c * ay)
}

/**
 * @param {object} a oriented box
 * @param {object} b oriented box
 * @return {boolean} the two rotated rectangles share an area deeper than TOUCH_TOLERANCE on every
 *   separating axis (touching does not count)
 */
function covers(a, b) {
	const t = TOUCH_TOLERANCE
	if (a.box[0] + t >= b.box[2] || b.box[0] + t >= a.box[2] || a.box[1] + t >= b.box[3] || b.box[1] + t >= a.box[3]) {
		return false
	}
	const dx = b.cx - a.cx
	const dy = b.cy - a.cy
	for (const [ax, ay] of [[a.c, a.s], [-a.s, a.c], [b.c, b.s], [-b.s, b.c]]) {
		if (reach(a, ax, ay) + reach(b, ax, ay) - Math.abs(dx * ax + dy * ay) <= t) {
			return false
		}
	}
	return true
}

/**
 * The place of the neighbour of `id` on `side` (job 136; neighbourItem rounds
 * it): Q's size (within its type's limits) and rotation; the edge facing Q
 * SERIES_GAP behind Q's edge on that side, flush with Q across it
 * (right/left: the same top edge, top/bottom: the same left edge); while it
 * shares an area (touching does not count, TOUCH_TOLERANCE) with the rotated
 * box of any item but frames and connectors, it moves on in the direction of
 * the side until its facing edge lies SERIES_GAP beyond the farthest point
 * of those items.
 *
 * @param {object} model SceneModel
 * @param {string} id a note, shape or text item
 * @param {string} side 't' | 'r' | 'b' | 'l'
 * @return {{x: number, y: number, w: number, h: number, r: number}|null} absolute box (not rounded), null for
 *   anything else or an unknown side
 */
export function neighbourBox(model, id, side) {
	const n = normalOf(side)
	const q0 = n !== null ? sourceOf(model, id) : null
	if (q0 === null) {
		return null
	}
	const { item: src, a } = q0
	const t = src.t
	const r = normAngle(src.r)
	const w = clampSize(t, a.w)
	const h = clampSize(t, a.h)
	// the start place in Q's rotated frame: centre offsets along the side's normal and across it;
	// (job 211) below a label, beyond it
	const below = side === 'b' ? labelReach(src, a) : 0
	const local = n[0] !== 0
		? [n[0] * (a.w / 2 + SERIES_GAP + w / 2), -a.h / 2 + h / 2]
		: [-a.w / 2 + w / 2, n[1] * (a.h / 2 + below + SERIES_GAP + h / 2)]
	const rad = r * Math.PI / 180
	const c = Math.cos(rad)
	const s = Math.sin(rad)
	const nx = n[0] * c - n[1] * s
	const ny = n[0] * s + n[1] * c
	const half = n[0] !== 0 ? w / 2 : h / 2
	const cx = a.x + a.w / 2 + local[0] * c - local[1] * s
	const cy = a.y + a.h / 2 + local[0] * s + local[1] * c
	return movePast(model, { cx, cy, w, h, r }, [nx, ny], half)
}

/**
 * Moves a box on along the unit vector n until it shares no area
 * (touching does not count, TOUCH_TOLERANCE) with the rotated box of any
 * item but frames and connectors (job 188: a note pad with its sheets and
 * title band, padExtent): each step puts its edge facing n SERIES_GAP
 * beyond the farthest point of those items. Size and rotation stay. The
 * last step of neighbourBox; (job 188) actions.takeNote puts the note taken
 * off a pad with Enter (at null) there, n = (1, 0).
 *
 * @param {object} model SceneModel
 * @param {{cx: number, cy: number, w: number, h: number, r: number}} start the box at its start place: centre,
 *   size and rotation
 * @param {[number, number]} n unit vector of the direction
 * @param {number} half half the box's extent along n
 * @return {{x: number, y: number, w: number, h: number, r: number}} absolute box (not rounded)
 */
export function movePast(model, { cx: cx0, cy: cy0, w, h, r }, [nx, ny], half) {
	let cx = cx0
	let cy = cy0
	// obstacles: the rotated box of every item but frames and connectors
	const obstacles = []
	for (const oid of model.ids()) {
		const it = model.get(oid)
		const ti = typeInfo(it?.t)
		const a = it && !ti.container && ti.placement !== 'none' ? model.abs(oid) : null
		const b = a && ti.pad === 'band' ? { ...a, ...padExtent(a.w, a.h), r: 0 } : a
		if (b && b.w > 0 && b.h > 0) {
			obstacles.push(orientedBox(b))
		}
	}
	for (let i = 0; i <= obstacles.length; i++) {
		const cand = orientedBox({ x: cx - w / 2, y: cy - h / 2, w, h, r })
		let far = -Infinity
		for (const o of obstacles) {
			if (covers(cand, o)) {
				far = Math.max(far, o.cx * nx + o.cy * ny + reach(o, nx, ny))
			}
		}
		if (far === -Infinity) {
			break
		}
		const shift = far + SERIES_GAP - (cx * nx + cy * ny - half)
		cx += nx * shift
		cy += ny * shift
	}
	return { x: cx - w / 2, y: cy - h / 2, w, h, r }
}

/**
 * The near item of a click on "+" (file comment), else null.
 *
 * @param {object} model SceneModel
 * @param {string} id source Q
 * @param {object} a Q's absolute box
 * @param {ReadonlyArray<number>} n0 outer normal of the side at rotation 0
 * @param {[number, number]} n outer normal of the side, rotated with Q
 * @return {string|null} id of X
 */
function nearItem(model, id, a, n0, [nx, ny]) {
	const tol = TOUCH_TOLERANCE
	const [ux, uy] = [-ny, nx]
	const qc = orientedBox(a)
	const edge = qc.cx * nx + qc.cy * ny + (n0[0] !== 0 ? a.w : a.h) / 2
	const qu = qc.cx * ux + qc.cy * uy
	const across = (n0[0] !== 0 ? a.h : a.w) / 2
	const linked = new Set()
	const found = []
	for (const xid of model.ids()) {
		const it = model.get(xid)
		if (!it) {
			continue
		}
		if (typeInfo(it.t).placement === 'none') {
			// a connector: its other end is joined with Q already
			const s = getPath(it, 'data.start.item')
			const e = getPath(it, 'data.end.item')
			if (s === id) linked.add(e)
			if (e === id) linked.add(s)
			continue
		}
		if (xid === id || !isBindable(it.t)) {
			continue
		}
		const b = model.abs(xid)
		if (!b || !(b.w > 0) || !(b.h > 0)) {
			continue
		}
		const o = orientedBox(b)
		const d = o.cx * nx + o.cy * ny - reach(o, nx, ny) - edge
		if (d < -tol || d > PLUS_REACH + REACH_NOISE) {
			continue
		}
		const xu = o.cx * ux + o.cy * uy
		const ru = reach(o, ux, uy)
		if (Math.min(qu + across, xu + ru) - Math.max(qu - across, xu - ru) <= tol) {
			continue
		}
		found.push({ id: xid, d, off: Math.abs(xu - qu) })
	}
	const free = found.filter((f) => !linked.has(f.id))
	if (free.length === 0) {
		return null
	}
	const dMin = Math.min(...free.map((f) => f.d))
	const nearest = free.filter((f) => f.d <= dMin + tol)
	const offMin = Math.min(...nearest.map((f) => f.off))
	return nearest.filter((f) => f.off <= offMin + tol).map((f) => f.id).sort()[0]
}

/**
 * What a click on the "+" of `side` of note or shape `id` does (file
 * comment): connect to a near item, or put the neighbour.
 *
 * @param {object} model SceneModel
 * @param {{id: string, side: string}} plus the source and the side of its "+"
 * @return {{kind: 'connect', target: string, start: object, end: object}|{kind: 'neighbour',
 *   box: {x: number, y: number, w: number, h: number, r: number}}|null} connect: X with both ends
 *   {item, ax, ay}; neighbour: the absolute box of N (neighbourBox); null for a missing source, a text
 *   item, anything but a note or shape, or an unknown side
 */
export function plusPlan(model, { id, side } = {}) {
	const n0 = normalOf(side)
	const q0 = n0 !== null ? sourceOf(model, id) : null
	if (q0 === null || q0.item.t === 'text') {
		return null
	}
	const { item: src, a } = q0
	const rad = (isNum(a.r) ? a.r : 0) * Math.PI / 180
	const c = Math.cos(rad)
	const s = Math.sin(rad)
	const n = [n0[0] * c - n0[1] * s, n0[0] * s + n0[1] * c]
	const target = nearItem(model, id, a, n0, n)
	if (target === null) {
		return { kind: 'neighbour', box: neighbourBox(model, id, side) }
	}
	const tol = TOUCH_TOLERANCE
	const [sx, sy] = anchorsFor(src.t, getPath(src, 'data.kind'))[SIDE_INDEX[side]]
	const start = { item: id, ax: sx, ay: sy }
	const p0 = anchorPoint(a, start)
	const x = model.get(target)
	const xb = model.abs(target)
	// X's anchors with their projection on n and their distance to the start, in the order t, r, b, l
	const anchors = anchorsFor(x.t, getPath(x, 'data.kind')).map(([ax, ay]) => {
		const p = anchorPoint(xb, { item: target, ax, ay })
		return { ax, ay, along: p.x * n[0] + p.y * n[1], dist: Math.hypot(p.x - p0.x, p.y - p0.y) }
	})
	const alongMin = Math.min(...anchors.map((k) => k.along))
	const facing = anchors.filter((k) => k.along <= alongMin + tol)
	const distMin = Math.min(...facing.map((k) => k.dist))
	const e = facing.find((k) => k.dist <= distMin + tol)
	return { kind: 'connect', target, start, end: { item: target, ax: e.ax, ay: e.ay } }
}
