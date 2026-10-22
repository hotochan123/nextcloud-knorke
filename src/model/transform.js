/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Transformer math, pure (SPEC-M1 §6.2): selection frame, handle positions,
 * resize, rotation and the mapping of the selected boxes from the frame
 * before to the frame after. The scene's TransformController (§6.3) drives
 * it; actions.transformItems turns the result into patches.
 *
 * Konva's own Transformer is not used (it needs a hit graph and
 * listening: true, draws by batchDraw, installs window listeners and writes
 * scale/skew into nodes, finding F5 §12.4). Parts of the math are ported
 * from Konva 10.7.1 src/shapes/Transformer.ts (MIT License, Copyright (C)
 * Anton Lavrenov and the Konva contributors): getSnap (rotation snapping),
 * rotation around the centre (rotateAroundPoint), the corner projection with
 * keepRatio onto the ratio diagonal, the minimum size instead of mirroring
 * (flipEnabled false) and getCursor with ANGLES.
 *
 * Frames are {x, y, w, h, r} in world coordinates: x/y top-left of the
 * UNROTATED box, r degrees clockwise around the centre (the item
 * convention). selectionFrame() adds n, the number of boxes it covers; a
 * frame with n > 1 is a multi selection (axis-parallel, r = 0, corners only,
 * uniform scaling, no rotation: multi rotation was dropped, §12.1, §9.2).
 * Rounding to the 0.01 grid (q(v, 100)) happens when the actions write the
 * result, not here.
 */
import { rotatedBBox } from './geometry.js'
import { typeInfo } from './registry.js'
import { ROT_HANDLE_OFFSET_PX } from './tokens.js'

/** Handle names: corners, edge midpoints, rotation. */
export const ANCHORS = Object.freeze(['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'rot'])

/** Normalised positions of the resize handles on the unrotated box. */
const POS = Object.freeze({ tl: [0, 0], t: [0.5, 0], tr: [1, 0], r: [1, 0.5], br: [1, 1], b: [0.5, 1], bl: [0, 1], l: [0, 0.5] })
const CORNERS = Object.freeze(['tl', 'tr', 'br', 'bl'])
const LEFT = new Set(['tl', 'l', 'bl'])
const RIGHT = new Set(['tr', 'r', 'br'])
const TOP = new Set(['tl', 't', 'tr'])
const BOTTOM = new Set(['bl', 'b', 'br'])

/** Konva's ANGLES: direction of each handle relative to "up", for the cursor. */
const CURSOR_ANGLES = Object.freeze({ tl: -45, t: 0, tr: 45, r: -90, l: 90, bl: -135, b: 180, br: 135 })

/** Default rotation snaps: every 45°. */
const SNAPS = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315])

/**
 * @param {number} x vector x
 * @param {number} y vector y
 * @param {number} deg degrees clockwise
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
 * @param {number} deg any angle
 * @return {number} the same direction in [0, 360)
 */
function norm360(deg) {
	const d = ((deg % 360) + 360) % 360
	return d === 360 ? 0 : d + 0
}

/**
 * @param {unknown} v value
 * @return {boolean} finite number
 */
function isNum(v) {
	return typeof v === 'number' && Number.isFinite(v)
}

/**
 * The frame of a selection: one item → its absolute box and r; several →
 * the axis-parallel union of their rotated boxes with r = 0. Connectors
 * (placement 'none') count with the box of their route when the model can
 * route them (geometryOf, SceneModel v2), otherwise not at all.
 *
 * @param {{get: Function, abs: Function, geometryOf?: Function}} model SceneModel
 * @param {Iterable<string>} ids selected ids (unknown ids are skipped)
 * @return {{x:number, y:number, w:number, h:number, r:number, n:number}|null} null without any box
 */
export function selectionFrame(model, ids) {
	const boxes = []
	for (const id of ids) {
		const it = model.get(id)
		if (!it) continue
		if (typeInfo(it.t).placement === 'none') {
			const g = typeof model.geometryOf === 'function' ? model.geometryOf(id) : null
			if (g && Array.isArray(g.bbox)) {
				const [x0, y0, x1, y1] = g.bbox
				boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: 0 })
			}
			continue
		}
		const a = model.abs(id)
		if (a) boxes.push(a)
	}
	if (boxes.length === 0) {
		return null
	}
	if (boxes.length === 1) {
		const b = boxes[0]
		return { x: b.x, y: b.y, w: b.w, h: b.h, r: b.r || 0, n: 1 }
	}
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const b of boxes) {
		const [x0, y0, x1, y1] = rotatedBBox(b.x, b.y, b.w, b.h, b.r || 0)
		minX = Math.min(minX, x0)
		minY = Math.min(minY, y0)
		maxX = Math.max(maxX, x1)
		maxY = Math.max(maxY, y1)
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, r: 0, n: boxes.length }
}

/**
 * The handles to show for a frame, in world coordinates (rotated with the
 * frame). One item: by its type's `resize` — 'box' all eight (notes too:
 * keepRatio only decides how a corner drags, §6.3 table "1 Notiz | 8 +
 * Drehen"), 'text' corners plus l/r (the height is measured, never
 * dragged), 'none' none (connectors, placeholders) — plus 'rot' when every
 * type is rotatable. Several items (frame.n > 1): the four corners, no
 * 'rot'. 'rot' sits ROT_HANDLE_OFFSET_PX screen px above the middle of the
 * top edge.
 *
 * @param {{x:number, y:number, w:number, h:number, r?:number, n?:number}|null} frame selection frame
 * @param {Set<string>|Iterable<string>} types types of the selected items
 * @param {number} scale camera scale (screen px per world unit)
 * @return {{name:string, x:number, y:number}[]} in ANCHORS order
 */
export function handlesFor(frame, types, scale) {
	if (!frame) {
		return []
	}
	const infos = [...(types ?? [])].map((t) => typeInfo(t))
	const multi = (frame.n ?? 1) > 1
	let names
	if (multi) {
		names = new Set(CORNERS)
	} else {
		const info = infos[0] ?? typeInfo(null)
		if (info.resize === 'none' || infos.some((i) => i.resize === 'none')) {
			names = new Set()
		} else if (infos.some((i) => i.resize === 'text')) {
			names = new Set([...CORNERS, 'l', 'r'])
		} else {
			names = new Set(Object.keys(POS))
		}
		if (names.size > 0 && infos.length > 0 && infos.every((i) => i.rotatable)) {
			names.add('rot')
		}
	}
	const s = isNum(scale) && scale > 0 ? scale : 1
	const r = frame.r || 0
	const cx = frame.x + frame.w / 2
	const cy = frame.y + frame.h / 2
	const out = []
	for (const name of ANCHORS) {
		if (!names.has(name)) continue
		let dx
		let dy
		if (name === 'rot') {
			dx = 0
			dy = -frame.h / 2 - ROT_HANDLE_OFFSET_PX / s
		} else {
			dx = (POS[name][0] - 0.5) * frame.w
			dy = (POS[name][1] - 0.5) * frame.h
		}
		const [wx, wy] = rotate(dx, dy, r)
		out.push({ name, x: cx + wx, y: cy + wy })
	}
	return out
}

/**
 * Resizes a frame by dragging one handle (dxWorld, dyWorld = pointer offset
 * since the drag started, in world coordinates; the frame is the one at the
 * start). The offset is taken into the frame's own axes, the dragged edges
 * follow it, the opposite edges stay (centered: move the other way, the
 * centre stays). keepRatio on a corner: the dragged corner is projected onto
 * the ratio diagonal (Konva). Sizes stay in [min, max]: a handle dragged past
 * the minimum stops there instead of mirroring.
 *
 * @param {{x:number, y:number, w:number, h:number, r?:number}} frame frame at drag start
 * @param {string} anchor handle name (tl, t, tr, r, br, b, bl, l)
 * @param {number} dxWorld pointer offset x
 * @param {number} dyWorld pointer offset y
 * @param {{keepRatio?: boolean, centered?: boolean, min?: number, max?: number}} [opts] options
 * @return {{x:number, y:number, w:number, h:number, r:number}} new frame (other keys of frame kept)
 */
export function resizeFrame(frame, anchor, dxWorld, dyWorld, { keepRatio = false, centered = false, min = 0, max = Infinity } = {}) {
	const r = frame.r || 0
	const w = frame.w
	const h = frame.h
	if (!Object.prototype.hasOwnProperty.call(POS, anchor)) {
		return { ...frame, r }
	}
	const [lx, ly] = rotate(isNum(dxWorld) ? dxWorld : 0, isNum(dyWorld) ? dyWorld : 0, -r)
	const lo = isNum(min) ? Math.max(0, min) : 0
	const hi = typeof max === 'number' && max >= lo ? max : Infinity
	let x0 = 0
	let y0 = 0
	let x1 = w
	let y1 = h
	if (keepRatio && CORNERS.includes(anchor) && w > 0 && h > 0) {
		// Fixed point: the opposite corner, or the centre when centered.
		const fx = centered ? w / 2 : (LEFT.has(anchor) ? w : 0)
		const fy = centered ? h / 2 : (TOP.has(anchor) ? h : 0)
		const ox = (LEFT.has(anchor) ? 0 : w) - fx
		const oy = (TOP.has(anchor) ? 0 : h) - fy
		let k = ((ox + lx) * ox + (oy + ly) * oy) / (ox * ox + oy * oy)
		k = Math.min(Math.max(k, lo / w, lo / h), hi / w, hi / h)
		const nw = w * k
		const nh = h * k
		if (centered) {
			x0 = (w - nw) / 2
			y0 = (h - nh) / 2
		} else {
			x0 = LEFT.has(anchor) ? w - nw : 0
			y0 = TOP.has(anchor) ? h - nh : 0
		}
		x1 = x0 + nw
		y1 = y0 + nh
	} else {
		if (LEFT.has(anchor)) {
			x0 += lx
			if (centered) x1 -= lx
		} else if (RIGHT.has(anchor)) {
			x1 += lx
			if (centered) x0 -= lx
		}
		if (TOP.has(anchor)) {
			y0 += ly
			if (centered) y1 -= ly
		} else if (BOTTOM.has(anchor)) {
			y1 += ly
			if (centered) y0 -= ly
		}
		;[x0, x1] = clampSpan(x0, x1, w, lo, hi, centered, LEFT.has(anchor))
		;[y0, y1] = clampSpan(y0, y1, h, lo, hi, centered, TOP.has(anchor))
	}
	const nw = x1 - x0
	const nh = y1 - y0
	const [dx, dy] = rotate((x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, r)
	const cx = frame.x + w / 2 + dx
	const cy = frame.y + h / 2 + dy
	return { ...frame, x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh, r }
}

/**
 * Keeps one axis of a resized box in [lo, hi] by moving the dragged side
 * back (both sides when centered).
 *
 * @param {number} a start of the span (local)
 * @param {number} b end of the span (local)
 * @param {number} size original size
 * @param {number} lo minimum size
 * @param {number} hi maximum size
 * @param {boolean} centered both sides move
 * @param {boolean} startMoves the start side is the dragged one
 * @return {[number, number]}
 */
function clampSpan(a, b, size, lo, hi, centered, startMoves) {
	const len = b - a
	if (len >= lo && len <= hi) {
		return [a, b]
	}
	const target = len < lo ? lo : hi
	if (centered) {
		const c = size / 2
		return [c - target / 2, c + target / 2]
	}
	return startMoves ? [b - target, b] : [a, a + target]
}

/**
 * Konva's getSnap in degrees: the nearest snap angle closer than tolDeg, or
 * the angle itself.
 *
 * @param {number[]} snaps snap angles (degrees)
 * @param {number} deg angle (degrees)
 * @param {number} tolDeg tolerance (degrees)
 * @return {number}
 */
function getSnap(snaps, deg, tolDeg) {
	let snapped = deg
	let nearest = tolDeg
	for (const s of snaps) {
		const abs = Math.abs(s - deg) % 360
		const diff = Math.min(abs, 360 - abs)
		if (diff < nearest) {
			nearest = diff
			snapped = s
		}
	}
	return snapped
}

/**
 * Rotates a frame with the rotation handle: the angle from the frame centre
 * to the pointer (0° = pointer straight above the centre, clockwise), snapped
 * to `snaps` within tolDeg, or to multiples of stepDeg when given (Shift).
 * The rotation is around the centre, so x, y, w, h stay.
 *
 * @param {{x:number, y:number, w:number, h:number, r?:number}} frame frame
 * @param {{x:number, y:number}} pointer pointer in world coordinates
 * @param {{snaps?: number[], tolDeg?: number, stepDeg?: number|null}} [opts] snapping
 * @return {{x:number, y:number, w:number, h:number, r:number}} new frame, r in [0, 360)
 */
export function rotateFrame(frame, pointer, { snaps = SNAPS, tolDeg = 5, stepDeg = null } = {}) {
	const cx = frame.x + frame.w / 2
	const cy = frame.y + frame.h / 2
	if (!pointer || !isNum(pointer.x) || !isNum(pointer.y) || (pointer.x === cx && pointer.y === cy)) {
		return { ...frame, r: frame.r || 0 }
	}
	let deg = norm360(Math.atan2(pointer.y - cy, pointer.x - cx) * 180 / Math.PI + 90)
	if (isNum(stepDeg) && stepDeg > 0) {
		deg = Math.round(deg / stepDeg) * stepDeg
	} else {
		deg = getSnap(Array.isArray(snaps) ? snaps : [], deg, isNum(tolDeg) ? tolDeg : 0)
	}
	return { ...frame, r: norm360(deg) }
}

/**
 * Maps the selected boxes from the frame `before` to the frame `after`
 * (after resizeFrame/rotateFrame): each box centre keeps its place relative
 * to the frame (in the frame's own axes), sizes scale with the frame, r
 * turns with the frame. Several items only scale uniformly (uniform: one
 * factor for both axes, from the width; from the height for a zero width).
 * A zero-size box maps a single point (free connector ends). Boxes in
 * `fixed` keep their size and are only moved (their centre maps): frames in
 * a multi selection and types without resize ('none', e.g. placeholders),
 * SPEC-M1 §6.2 (R8), §6.3.
 *
 * @param {{x:number, y:number, w:number, h:number, r?:number}} before frame at the start
 * @param {{x:number, y:number, w:number, h:number, r?:number}} after frame now
 * @param {Map<string, {x:number, y:number, w:number, h:number, r?:number}>} boxes absolute boxes
 * @param {{uniform?: boolean, fixed?: Iterable<string>}} [opts] one scale factor; ids that keep their size
 * @return {Map<string, {x:number, y:number, w:number, h:number, r:number}>} new absolute boxes
 */
export function mapBoxes(before, after, boxes, { uniform = false, fixed = null } = {}) {
	const keep = fixed instanceof Set ? fixed : new Set(fixed ?? [])
	const br = before.r || 0
	const ar = after.r || 0
	let kx = before.w > 0 ? after.w / before.w : 1
	let ky = before.h > 0 ? after.h / before.h : 1
	if (uniform) {
		const k = before.w > 0 ? kx : ky
		kx = k
		ky = k
	}
	const bcx = before.x + before.w / 2
	const bcy = before.y + before.h / 2
	const acx = after.x + after.w / 2
	const acy = after.y + after.h / 2
	const out = new Map()
	for (const [id, b] of boxes) {
		const [lx, ly] = rotate(b.x + b.w / 2 - bcx, b.y + b.h / 2 - bcy, -br)
		const [wx, wy] = rotate(lx * kx, ly * ky, ar)
		const nw = keep.has(id) ? b.w : b.w * kx
		const nh = keep.has(id) ? b.h : b.h * ky
		const r = ar === br ? (b.r || 0) : norm360((b.r || 0) + ar - br)
		out.set(id, { x: acx + wx - nw / 2, y: acy + wy - nh / 2, w: nw, h: nh, r })
	}
	return out
}

/**
 * The scale factor nearest to k that keeps every w and h in the size range
 * of its type (TYPES[t].size): the largest k' ≤ k when growing; when k would
 * shrink a box below its minimum, the smallest factor that keeps it.
 * Connectors (placement 'none') and zero sizes do not limit. When the boxes
 * admit no common factor (an already invalid size), 1.
 *
 * @param {Map<string, {w:number, h:number}>} boxes boxes by id
 * @param {Map<string,string>|Record<string,string>|((id:string) => string)} types type of each id
 * @param {number} k wanted factor
 * @return {number}
 */
export function clampFactor(boxes, types, k) {
	let lo = 0
	let hi = Infinity
	for (const [id, b] of boxes) {
		let t
		if (types instanceof Map) t = types.get(id)
		else if (typeof types === 'function') t = types(id)
		else if (types && Object.prototype.hasOwnProperty.call(types, id)) t = types[id]
		const info = typeInfo(t)
		if (info.placement === 'none') continue
		const [min, max] = info.size
		for (const v of [b.w, b.h]) {
			if (!(v > 0)) continue
			lo = Math.max(lo, min / v)
			hi = Math.min(hi, max / v)
		}
	}
	if (lo > hi) {
		return 1
	}
	return Math.min(Math.max(isNum(k) ? k : 1, lo), hi)
}

/**
 * CSS cursor of a handle on a frame rotated by rotationDeg (Konva getCursor).
 *
 * @param {string} anchor handle name
 * @param {number} rotationDeg frame rotation
 * @return {string} ns-resize | nesw-resize | ew-resize | nwse-resize | crosshair ('rot')
 */
export function getCursor(anchor, rotationDeg) {
	if (anchor === 'rot') {
		return 'crosshair'
	}
	const a = norm360((isNum(rotationDeg) ? rotationDeg : 0) + (CURSOR_ANGLES[anchor] ?? 0))
	const sector = Math.round(a / 45) % 8
	return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][sector % 4]
}
