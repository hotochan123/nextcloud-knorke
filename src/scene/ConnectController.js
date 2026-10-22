/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Creating and re-targeting connectors (SPEC-M1 §6.3 "Verbinder anlegen und
 * umhängen"), pure on top of the model (no Konva, no DOM), like the
 * TransformController: SceneManager feeds pointer positions once per
 * animation frame and turns the end into the frozen intents
 *   {type:'connect', start, end, route, endCap}
 *   {type:'retarget', id, which, value, before}
 *
 * Ends from a world point (snapAt):
 * - Ctrl/⌘ held: no snapping, a free point {x, y} (on the 0.01 grid)
 * - over a bindable item (registry: notes, shapes, text items; topmost under
 *   the point, hit tolerance like a click): bound to it, at its nearest
 *   anchor when that is at most SNAP_PX screen px away ({item, ax, ay}),
 *   otherwise {item} (side chosen when routing)
 * - beside the items but within SNAP_PX of an anchor of a bindable item:
 *   bound to that anchor (the nearest; on a tie the topmost item)
 * - otherwise a free point
 * Anchors are SHAPES[kind].anchors of a shape, the side midpoints of the
 * other bindable types (connectors.anchorsFor), placed with anchorPoint
 * (rotation included). Ends leave as normalizeEndpoint() gives them (ax/ay
 * on the 1e-4 grid, the stored form).
 *
 * Rules: the start item of a new connector is never its end target (no
 * self loop by drag), and a re-targeted end never binds to the item of the
 * other end; a new connector whose free end lies inside its start item, and
 * a re-target that changes nothing, give no intent. A click without a drag
 * never reaches this controller (InputController threshold).
 */
import { anchorNormal, anchorPoint, anchorsFor, normalizeEndpoint, routeConnector } from '../model/connectors.js'
import { q, toLocal } from '../model/geometry.js'
import { fieldValue, isBindable } from '../model/registry.js'

/**
 * @typedef {import('../model/connectors.js').Endpoint} Endpoint
 * @typedef {{x:number, y:number, w:number, h:number, r:number}} AbsBox
 * @typedef {{ep:Endpoint, target:(string|null), box:(AbsBox|null),
 *            anchors:Array<{ax:number, ay:number, x:number, y:number}>, snap:({x:number, y:number}|null)}} Snap
 */

/**
 * @param {unknown} a value
 * @param {unknown} b value
 * @return {boolean} equal as JSON
 */
function same(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * The anchors of an item in world coordinates (rotation included).
 *
 * @param {object} model SceneModel
 * @param {string} id bindable item
 * @return {Array<{ax:number, ay:number, x:number, y:number}>}
 */
export function worldAnchors(model, id) {
	const it = model.get(id)
	const a = model.abs(id)
	if (!it || !a) return []
	const kind = it.t === 'shape' ? it.data?.kind : undefined
	return anchorsFor(it.t, kind).map(([ax, ay]) => {
		const p = anchorPoint(a, { item: id, ax, ay })
		return { ax, ay, x: p.x, y: p.y }
	})
}

/**
 * Positions of the "+" handles of one bindable item (SPEC-M1 §6.3): each
 * anchor pushed `offset` world units outwards along its side normal, rotated
 * with the item; names plus-t, plus-r, plus-b, plus-l (anchor order).
 *
 * @param {object} model SceneModel
 * @param {string} id bindable item
 * @param {number} offset distance in world units
 * @return {Array<{name:string, x:number, y:number, ax:number, ay:number}>}
 */
export function plusHandles(model, id, offset) {
	const a = model.abs(id)
	if (!a) return []
	const r = (a.r || 0) * Math.PI / 180
	const c = Math.cos(r)
	const s = Math.sin(r)
	const names = ['plus-t', 'plus-r', 'plus-b', 'plus-l']
	return worldAnchors(model, id).map((p, i) => {
		const [nx, ny] = anchorNormal(p.ax, p.ay)
		return { name: names[i], x: p.x + (nx * c - ny * s) * offset, y: p.y + (nx * s + ny * c) * offset, ax: p.ax, ay: p.ay }
	})
}

/**
 * Where a connector end goes for a world point (see the file comment).
 *
 * @param {object} model SceneModel
 * @param {{x:number, y:number}} w world point
 * @param {{snapWorld:number, tolWorld:number, exclude?:Set<string>, free?:boolean}} o
 *   snapping distance and hit tolerance in world units, items that must not
 *   be the target, free = Ctrl/⌘ (no snapping)
 * @return {Snap}
 */
export function snapAt(model, w, { snapWorld, tolWorld, exclude = new Set(), free = false }) {
	const point = () => ({ ep: { x: q(w.x, 100), y: q(w.y, 100) }, target: null, box: null, anchors: [], snap: null })
	if (free) return point()
	const ok = (id) => model.has(id) && !exclude.has(id) && isBindable(model.get(id).t)
	const bindTo = (id, anchors, best) => ({
		ep: best ? normalizeEndpoint({ item: id, ax: best.ax, ay: best.ay }) : { item: id },
		target: id,
		box: model.abs(id),
		anchors,
		snap: best ? { x: best.x, y: best.y } : null,
	})
	const nearest = (anchors) => {
		let best = null
		let bestD = Infinity
		for (const p of anchors) {
			const d = Math.hypot(p.x - w.x, p.y - w.y)
			if (d <= snapWorld && d < bestD) {
				best = p
				bestD = d
			}
		}
		return best ? { p: best, d: bestD } : null
	}
	const hit = model.hitTest(w.x, w.y, tolWorld, { accept: ok })
	if (hit !== null) {
		const anchors = worldAnchors(model, hit)
		return bindTo(hit, anchors, nearest(anchors)?.p ?? null)
	}
	let pick = null
	const near = model.query(w.x - snapWorld, w.y - snapWorld, w.x + snapWorld, w.y + snapWorld)
	for (const e of model.sortByOrder(near.map((x) => x.id)).reverse()) {
		if (!ok(e)) continue
		const anchors = worldAnchors(model, e)
		const n = nearest(anchors)
		if (n && (pick === null || n.d < pick.d)) pick = { id: e, anchors, p: n.p, d: n.d }
	}
	return pick ? bindTo(pick.id, pick.anchors, pick.p) : point()
}

/**
 * @param {object} model SceneModel
 * @param {Endpoint} ep end
 * @return {AbsBox|null} box of the end's target (null for a free end or an unknown target)
 */
function boxOf(model, ep) {
	return ep && typeof ep.item === 'string' && model.has(ep.item) ? model.abs(ep.item) : null
}

export class ConnectController {
	#model
	#s = null

	/**
	 * @param {import('../model/SceneModel.js').SceneModel} model scene model
	 */
	constructor(model) {
		this.#model = model
	}

	/** @return {boolean} true while a connect or retarget drag runs */
	get active() {
		return this.#s !== null
	}

	/** @return {'connect'|'retarget'|null} */
	get mode() {
		return this.#s ? this.#s.mode : null
	}

	/** @return {string|null} the re-targeted connector (retarget only) */
	get id() {
		return this.#s?.mode === 'retarget' ? this.#s.id : null
	}

	/** @return {'start'|'end'|null} the dragged end (retarget only) */
	get which() {
		return this.#s?.mode === 'retarget' ? this.#s.which : null
	}

	/** @return {string|null} the item the drag started from (connect only) */
	get startItem() {
		return this.#s?.mode === 'connect' ? this.#s.startItem : null
	}

	/**
	 * Starts a new connector at a fixed start end (a snapped point, or the
	 * anchor of a "+" handle).
	 *
	 * @param {Endpoint} start start end (stored form)
	 * @param {{x:number, y:number}} pointer world point
	 * @return {boolean} false for an invalid start
	 */
	beginConnect(start, pointer) {
		const ep = normalizeEndpoint(start)
		if (ep === null || !pointer) {
			this.#s = null
			return false
		}
		const startItem = typeof ep.item === 'string' ? ep.item : null
		this.#s = { mode: 'connect', start: ep, startItem, pointer: { ...pointer }, last: null }
		return true
	}

	/**
	 * Starts dragging one end of a connector (its end handle).
	 *
	 * @param {string} id connector id
	 * @param {'start'|'end'} which the end
	 * @param {{x:number, y:number}} pointer world point
	 * @return {boolean} false when the connector or its ends are unusable
	 */
	beginRetarget(id, which, pointer) {
		const it = this.#model.get(id)
		if (!it || (which !== 'start' && which !== 'end') || !pointer) {
			this.#s = null
			return false
		}
		// the stored ends through their registry rule (Rev 8); `before` is the stored value for undo
		const before = fieldValue(it, 'data.' + which)
		const other = fieldValue(it, 'data.' + (which === 'start' ? 'end' : 'start'))
		if (!before || !other) {
			this.#s = null
			return false
		}
		const otherItem = typeof other.item === 'string' ? other.item : null
		this.#s = { mode: 'retarget', id, which, before: structuredClone(it.data[which]), other, otherItem, pointer: { ...pointer }, last: null }
		return true
	}

	/**
	 * One step for the pointer position (world).
	 *
	 * @param {{x:number, y:number}} pointer world point
	 * @param {{snapWorld:number, tolWorld:number, free?:boolean, route?:string}} o snapping (see snapAt);
	 *   route of the preview line (connect)
	 * @return {(Snap & {preview: (object|null)})|null} the end now, plus the
	 *   routed preview of a new connector (ConnGeom; null while retargeting)
	 */
	step(pointer, { snapWorld, tolWorld, free = false, route = 'straight' }) {
		const s = this.#s
		if (!s || !pointer) return null
		s.pointer = { ...pointer }
		const exclude = new Set([s.mode === 'connect' ? s.startItem : s.otherItem].filter((x) => x !== null))
		const snap = snapAt(this.#model, pointer, { snapWorld, tolWorld, exclude, free })
		let preview = null
		if (s.mode === 'connect') {
			const a = { box: boxOf(this.#model, s.start), ep: s.start, point: null }
			const b = snap.target !== null ? { box: snap.box, ep: snap.ep, point: null } : { box: null, ep: snap.ep, point: null }
			preview = a.box || !('item' in s.start) ? routeConnector(a, b, route) : null
		}
		s.last = snap
		return { ...snap, preview }
	}

	/**
	 * The intent of the finished drag, or null (nothing to do).
	 *
	 * @param {{route?:string, endCap?:string}} [options] connector tool options (connect)
	 * @return {object|null} {type:'connect', start, end, route, endCap} or
	 *   {type:'retarget', id, which, value, before}
	 */
	result({ route = 'straight', endCap = 'arrow' } = {}) {
		const s = this.#s
		if (!s || !s.last) return null
		const end = normalizeEndpoint(s.last.ep)
		if (end === null) return null
		if (s.mode === 'connect') {
			if (s.startItem !== null && !('item' in end)) {
				// a free end inside the start item: the drag never left it
				const a = this.#model.abs(s.startItem)
				if (a) {
					const [lx, ly] = toLocal(end.x, end.y, a.x, a.y, a.w, a.h, a.r)
					if (lx >= 0 && ly >= 0 && lx <= a.w && ly <= a.h) return null
				}
			}
			return { type: 'connect', start: { ...s.start }, end, route, endCap }
		}
		if (same(end, normalizeEndpoint(s.before))) return null
		return { type: 'retarget', id: s.id, which: s.which, value: end, before: structuredClone(s.before) }
	}

	/** @return {Snap|null} the end of the last step */
	get last() {
		return this.#s?.last ?? null
	}

	/** Forgets the drag (after the intent or a cancel). */
	end() {
		this.#s = null
	}
}
