/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Transformer state (SPEC-M1 §6.3): what a drag on a handle does to the
 * selected items. Pure on top of the model (no Konva, no DOM): SceneManager
 * feeds pointer positions once per animation frame and applies the result
 * (model.setBoxesLocal + renderer.transformMoved while live, one
 * activeGroup.setAttrs above TRANSFORM_LIVE_MAX items) and turns the end
 * into the intent {type:'transform', ids, before, after, keep}.
 *
 * Rules (§6.3 table):
 * - one note: 8 handles + rotation; corners keep the ratio, Shift releases
 * - one shape: 8 handles + rotation; corners free, Shift keeps the ratio;
 *   Alt resizes from the centre (every type)
 * - one text item: l/r change the wrap width; corners scale width AND font
 *   size by the same k (font size rounded to an integer in 8..400); the
 *   height is measured by the session when it writes (rule 13)
 * - one frame: 8 handles, no rotation; a drag at the top/left edge moves the
 *   frame's origin, its children stay where they are on the board
 *   (compensated relative positions, keep = true, rule 15)
 * - several items: 4 corners, uniform scaling only, no rotation; frames and
 *   types without resize (placeholders) keep their size and only move
 *   (mapBoxes fixed); text items scale their font size with k
 * - rotation: 45° snaps within 5°, with Shift fixed 15° steps
 * - sizes stay inside TYPES[t].size (else the server says bad)
 * - (M2, SPEC-M1 §1.2 (R12)) step(…, {snap}) snaps the moving edges of the
 *   frame to the candidates (snapResize: the raw offset is corrected before
 *   resizeFrame, so every rule above still holds) and reports the guides;
 *   not at 'rot', for a rotated frame, for several items with a frame or a
 *   placeholder among them (they keep their size: the union would not follow
 *   the frame's edges) nor at their edge handles (nothing resizes); with a
 *   text item only along x (its height is measured, rule 13); snap.grid
 *   (the background grid step, R12) snaps the moving edges to the grid on
 *   the axes without a snapped item, under the same conditions
 *
 * Boxes in before/after are ABSOLUTE world boxes (x/y top-left of the
 * unrotated box), before additionally carries parent (and fontSize for text
 * items); rounding to the 0.01 grid is the action's job (q(v, 100)).
 *
 * Connectors in the selection (round 1b, placement 'none'): they have no box
 * of their own. Their route box counts for the selection frame, they are not
 * scaled themselves; a connector with free ends is listed in the intent's
 * ids WITHOUT before/after, and its free ends follow the union of the boxes
 * (union of the old boxes → union of the new ones, the mapping of [C]'s
 * transformItems, §6.5.2); endsMap() previews that in the model
 * (SceneModel.setEndsLocal). Bound ends follow their targets anyway. A
 * selection of connectors only has nothing to transform.
 */
import { rotatedBBox } from '../model/geometry.js'
import { fieldValue, typeInfo } from '../model/registry.js'
import { snapResize } from '../model/snap.js'
import { mapBoxes, resizeFrame, rotateFrame, selectionFrame } from '../model/transform.js'
import { TRANSFORM_LIVE_MAX } from '../model/tokens.js'
import { topLevel } from './Selection.js'

const CORNERS = new Set(['tl', 'tr', 'br', 'bl'])
/** Font size range of text items (registry rule style.fontSize of `text`). */
const TEXT_FONT = Object.freeze([8, 400])
/** Smallest uniform factor, so a frame of fixed items never collapses. */
const K_MIN = 1e-3

/**
 * @param {Iterable<{x:number, y:number, w:number, h:number, r?:number}>} boxes boxes
 * @return {{x:number, y:number, w:number, h:number}|null} axis-parallel union of the rotated boxes
 */
function unionOf(boxes) {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const b of boxes) {
		const [x0, y0, x1, y1] = rotatedBBox(b.x, b.y, b.w, b.h, b.r || 0)
		minX = Math.min(minX, x0, x1)
		minY = Math.min(minY, y0, y1)
		maxX = Math.max(maxX, x0, x1)
		maxY = Math.max(maxY, y0, y1)
	}
	return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * @param {object} it connector WireItem
 * @return {{start?:{x:number, y:number}, end?:{x:number, y:number}}} its stored free ends
 */
function freeEnds(it) {
	const out = {}
	for (const which of ['start', 'end']) {
		const ep = fieldValue(it, 'data.' + which)
		if (ep && typeof ep === 'object' && !('item' in ep) && Number.isFinite(ep.x) && Number.isFinite(ep.y)) {
			out[which] = { x: ep.x, y: ep.y }
		}
	}
	return out
}

/**
 * @param {{x:number, y:number, w:number, h:number, r:number}} a box
 * @param {{x:number, y:number, w:number, h:number, r:number}} b box
 * @return {boolean} equal boxes
 */
function sameBox(a, b) {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && (a.r || 0) === (b.r || 0)
}

export class TransformController {
	#model
	#s = null

	/**
	 * @param {import('../model/SceneModel.js').SceneModel} model scene model
	 */
	constructor(model) {
		this.#model = model
	}

	/** @return {boolean} true while a transform runs */
	get active() {
		return this.#s !== null
	}

	/** @return {Set<string>} transformed items with their descendants (isActive scope) */
	get all() {
		return this.#s ? this.#s.all : new Set()
	}

	/** @return {string[]} the transformed (top-level) ids */
	get ids() {
		return this.#s ? this.#s.ids.slice() : []
	}

	/** @return {boolean} true when every step updates the model (≤ TRANSFORM_LIVE_MAX items) */
	get live() {
		return this.#s ? this.#s.live : true
	}

	/** @return {string|null} handle being dragged */
	get anchor() {
		return this.#s ? this.#s.anchor : null
	}

	/** @return {object|null} the frame of the last step (or the start frame) */
	get frame() {
		if (!this.#s) return null
		return { ...(this.#s.last ? this.#s.last.frame : this.#s.frame0) }
	}

	/** @return {object|null} the start frame */
	get startFrame() {
		return this.#s ? { ...this.#s.frame0 } : null
	}

	/**
	 * Starts a transform of the selection by a handle.
	 *
	 * @param {Iterable<string>} selection selected ids
	 * @param {string} anchor handle name (tl, t, tr, r, br, b, bl, l, rot)
	 * @param {{x:number, y:number}} pointer pointer in world coordinates
	 * @return {boolean} false when there is nothing to transform
	 */
	begin(selection, anchor, pointer) {
		const m = this.#model
		const top = topLevel(selection, m).filter((id) => m.has(id))
		const ids = top.filter((id) => typeInfo(m.get(id).t).placement !== 'none')
		const conns = new Map()
		for (const id of top) {
			if (typeInfo(m.get(id).t).placement !== 'none') continue
			const ends = freeEnds(m.get(id))
			if (Object.keys(ends).length > 0) conns.set(id, ends)
		}
		const frame0 = ids.length > 0 ? selectionFrame(m, top) : null
		if (!frame0 || !pointer) {
			this.#s = null
			return false
		}
		const multi = frame0.n > 1
		const items = new Map()
		const all = new Set()
		const kids = new Map()
		for (const id of ids) {
			const it = m.get(id)
			const a = m.abs(id)
			const info = typeInfo(it.t)
			items.set(id, {
				t: it.t,
				info,
				abs0: a,
				rel0: { x: it.x, y: it.y, w: it.w, h: it.h, r: it.r },
				off: { x: a.x - it.x, y: a.y - it.y },
				parent: it.parent,
				fontSize0: info.resize === 'text' ? fieldValue(it, 'style.fontSize') : undefined,
				storedFont: info.resize === 'text' ? (Number.isFinite(it.style?.fontSize) ? it.style.fontSize : null) : undefined,
			})
			all.add(id)
			for (const d of m.descendantsOf(id)) all.add(d)
			if (!multi && info.container) {
				for (const k of m.childrenOf(id)) {
					const c = m.get(k)
					kids.set(k, { x: c.x, y: c.y })
				}
			}
		}
		const fixed = new Set(ids.filter((id) => {
			const info = items.get(id).info
			return info.resize === 'none' || (multi && info.container)
		}))
		for (const id of conns.keys()) all.add(id)
		this.#s = {
			ids, frame0, multi, anchor, p0: { x: pointer.x, y: pointer.y }, items, fixed, kids, all, conns,
			ub: unionOf(ids.map((id) => items.get(id).abs0)),
			live: ids.length <= TRANSFORM_LIVE_MAX, last: null,
			// snapping (R12): several items with one that keeps its size do not snap; a text item only along x
			snaps: !multi || fixed.size === 0,
			axes: ids.some((id) => items.get(id).info.resize === 'text') ? 'x' : 'xy',
		}
		return true
	}

	/** @return {string[]} the selected connectors whose free ends follow the transform */
	get connectors() {
		return this.#s ? [...this.#s.conns.keys()] : []
	}

	/**
	 * Free ends of the selected connectors for the last step (model
	 * setEndsLocal; the same mapping as [C]'s transformItems).
	 *
	 * @return {Map<string, {start?:{x:number, y:number}, end?:{x:number, y:number}}>}
	 */
	endsMap() {
		const s = this.#s
		const out = new Map()
		if (!s || !s.last || s.conns.size === 0) return out
		const ub = s.ub
		const ua = unionOf(s.last.boxes.values())
		if (!ub || !ua || !(ub.w > 0) || !(ub.h > 0)) return out
		for (const [id, ends] of s.conns) {
			const e = {}
			for (const [which, p] of Object.entries(ends)) {
				e[which] = { x: ua.x + (p.x - ub.x) * ua.w / ub.w, y: ua.y + (p.y - ub.y) * ua.h / ub.h }
			}
			out.set(id, e)
		}
		return out
	}

	/**
	 * One step for the pointer position (world) and the modifier keys.
	 *
	 * @param {{x:number, y:number}} pointer pointer in world coordinates
	 * @param {{shift?:boolean, alt?:boolean, snap?:({index:import('../model/snap.js').SnapIndex,
	 *   tol:number, grid?:number}|null)}} [mods] Shift, Alt and the snap candidates with the tolerance in world
	 *   units and the background grid step (R12; grid 0 or missing: no grid; snap null or missing: no snapping)
	 * @return {{frame:object, boxes:Map<string,object>, fonts:Map<string,number>, map:Map<string,object>,
	 *           keep:boolean, preview:(object|null), guides:import('../model/snap.js').SnapGuide[]}|null} the
	 *   new state (map: relative boxes for model.setBoxesLocal, preview: activeGroup transform above
	 *   TRANSFORM_LIVE_MAX, guides: the snap guides of this step, [] without snapping)
	 */
	step(pointer, { shift = false, alt = false, snap = null } = {}) {
		const s = this.#s
		if (!s || !pointer) return null
		const f0 = s.frame0
		const dx = pointer.x - s.p0.x
		const dy = pointer.y - s.p0.y
		// the raw offset, snapped before resizeFrame when the transform snaps (R12)
		const snapped = (opts) => snap && s.snaps
			? snapResize(f0, s.anchor, dx, dy, { ...opts, axes: s.axes }, snap.index, snap.tol, snap.grid ?? 0)
			: { dx, dy, guides: [] }
		let f1
		let fontK = 1
		let guides = []
		if (s.anchor === 'rot') {
			f1 = s.multi || !s.items.get(s.ids[0]).info.rotatable
				? { ...f0 }
				: rotateFrame(f0, pointer, { stepDeg: shift ? 15 : null })
		} else if (!s.multi) {
			const one = s.items.get(s.ids[0])
			const info = one.info
			const corner = CORNERS.has(s.anchor)
			const textCorner = info.resize === 'text' && corner
			const keepRatio = corner && (textCorner || info.keepRatio !== !!shift)
			let [min, max] = info.size
			if (keepRatio) {
				const [kMin, kMax] = this.#kRange([s.ids[0]], textCorner)
				min = kMin * Math.min(f0.w, f0.h)
				max = kMax * Math.max(f0.w, f0.h)
			}
			const opts = { keepRatio, centered: !!alt, min, max }
			const d = snapped(opts)
			f1 = resizeFrame(f0, s.anchor, d.dx, d.dy, opts)
			guides = d.guides
			if (textCorner && f0.w > 0) fontK = f1.w / f0.w
		} else if (CORNERS.has(s.anchor)) {
			const [kMin, kMax] = this.#kRange(s.ids.filter((id) => !s.fixed.has(id)), true)
			const opts = { keepRatio: true, centered: !!alt, min: kMin * Math.min(f0.w, f0.h), max: kMax * Math.max(f0.w, f0.h) }
			const d = snapped(opts)
			f1 = resizeFrame(f0, s.anchor, d.dx, d.dy, opts)
			guides = d.guides
			if (f0.w > 0) fontK = f1.w / f0.w
			else if (f0.h > 0) fontK = f1.h / f0.h
		} else {
			f1 = { ...f0 }
		}
		const boxes = new Map()
		if (!s.multi) {
			boxes.set(s.ids[0], { x: f1.x, y: f1.y, w: f1.w, h: f1.h, r: f1.r || 0 })
		} else {
			const abs0 = new Map(s.ids.map((id) => [id, s.items.get(id).abs0]))
			for (const [id, b] of mapBoxes(f0, f1, abs0, { uniform: true, fixed: s.fixed })) boxes.set(id, b)
		}
		const fonts = new Map()
		const map = new Map()
		for (const id of s.ids) {
			const one = s.items.get(id)
			const b = boxes.get(id)
			const rel = { x: b.x - one.off.x, y: b.y - one.off.y, w: b.w, h: b.h, r: b.r }
			if (one.info.resize === 'text') {
				const fs = fontK === 1 ? one.fontSize0 : Math.min(TEXT_FONT[1], Math.max(TEXT_FONT[0], Math.round(one.fontSize0 * fontK)))
				fonts.set(id, fs)
				if (fs !== one.fontSize0 || one.storedFont !== null) rel.fontSize = fs
			}
			map.set(id, rel)
		}
		let keep = false
		if (s.kids.size > 0) {
			const one = s.items.get(s.ids[0])
			const b = boxes.get(s.ids[0])
			const ddx = b.x - one.abs0.x
			const ddy = b.y - one.abs0.y
			keep = ddx !== 0 || ddy !== 0
			for (const [k, rel0] of s.kids) map.set(k, { x: rel0.x - ddx, y: rel0.y - ddy })
		}
		const k = f0.w > 0 ? f1.w / f0.w : (f0.h > 0 ? f1.h / f0.h : 1)
		const preview = s.live ? null : { x: f1.x, y: f1.y, k, offsetX: f0.x, offsetY: f0.y }
		s.last = { frame: f1, boxes, fonts, map, keep, preview, guides }
		return s.last
	}

	/**
	 * The intent of the finished transform, or null when nothing changed.
	 *
	 * @return {{type:'transform', ids:string[], before:Map<string,object>, after:Map<string,object>, keep:boolean}|null}
	 */
	result() {
		const s = this.#s
		if (!s || !s.last) return null
		let changed = false
		const before = new Map()
		const after = new Map()
		for (const id of s.ids) {
			const one = s.items.get(id)
			const b = s.last.boxes.get(id)
			const a0 = one.abs0
			const pre = { x: a0.x, y: a0.y, w: a0.w, h: a0.h, r: a0.r, parent: one.parent }
			const post = { x: b.x, y: b.y, w: b.w, h: b.h, r: b.r }
			if (one.info.resize === 'text') {
				pre.fontSize = one.fontSize0
				post.fontSize = s.last.fonts.get(id)
				if (post.fontSize !== pre.fontSize) changed = true
			}
			if (!sameBox(a0, b)) changed = true
			before.set(id, pre)
			after.set(id, post)
		}
		return changed ? { type: 'transform', ids: [...s.ids, ...s.conns.keys()], before, after, keep: s.last.keep } : null
	}

	/**
	 * @return {Map<string, object>} relative boxes (and stored font sizes)
	 *   that put the model back to the start (Esc)
	 */
	restoreMap() {
		const s = this.#s
		const map = new Map()
		if (!s) return map
		for (const id of s.ids) {
			const one = s.items.get(id)
			const rel = { ...one.rel0 }
			if (one.info.resize === 'text') rel.fontSize = one.storedFont
			map.set(id, rel)
		}
		for (const [k, rel0] of s.kids) map.set(k, { ...rel0 })
		return map
	}

	/** @return {Map<string, object>|null} the relative boxes of the last step */
	lastMap() {
		return this.#s?.last ? this.#s.last.map : null
	}

	/** Forgets the transform (after the intent or a cancel). */
	end() {
		this.#s = null
	}

	/**
	 * Allowed range of the uniform factor k for these items: their sizes stay
	 * in TYPES[t].size, text font sizes in 8..400 (withFont).
	 *
	 * @param {string[]} ids items that scale
	 * @param {boolean} withFont text items scale their font size
	 * @return {[number, number]} [kMin, kMax]; [1, 1] when no common factor exists
	 */
	#kRange(ids, withFont) {
		let lo = K_MIN
		let hi = Infinity
		for (const id of ids) {
			const one = this.#s.items.get(id)
			const [min, max] = one.info.size
			for (const v of [one.abs0.w, one.abs0.h]) {
				if (!(v > 0)) continue
				lo = Math.max(lo, min / v)
				hi = Math.min(hi, max / v)
			}
			if (withFont && one.info.resize === 'text' && one.fontSize0 > 0) {
				lo = Math.max(lo, TEXT_FONT[0] / one.fontSize0)
				hi = Math.min(hi, TEXT_FONT[1] / one.fontSize0)
			}
		}
		return lo > hi ? [1, 1] : [lo, hi]
	}
}
