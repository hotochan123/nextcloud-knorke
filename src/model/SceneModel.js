/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Runtime scene model (SPEC-M0 §6.2): the items the scene shows, their
 * absolute boxes, the parent/child index, the stacking order and an rbush
 * index for viewport queries (culling) and the engine-independent hit test.
 * Port of the core of the engine spike's model.js, extended:
 *
 * - generic parent: the absolute box is resolved through the parent chain (at
 *   most 8 levels, cycles count as root), independent of the load order. The
 *   child index Map<parentId, Set<childId>> also holds children of parents
 *   that are not (yet) known; such an item, or one whose parent is no
 *   container, lies at the root (offset 0) until the parent arrives, then it
 *   is recomputed and reindexed.
 * - cascade: when a container moves (patch or moveLocal), all descendants get
 *   new absolute boxes and rbush entries and land in ChangeSummary.geometry.
 * - no orderIndex map (O(n) per insert): order is compareOrder (rank, z, id)
 *   and the hit test sorts its few candidates with it.
 * - rbush padding from the registry (`pad`, SPEC-M1 §6.2, finding F4):
 *   'shadow' notes, 'title' frames (title band), 'stroke' shapes (half the
 *   stroke width), 'none' text and placeholders; rotated boxes via
 *   rotatedBBox.
 * - no stored font size, no version/rev/deleted (the server owns those).
 *
 * M1 v2 (SPEC-M1 §6.2, round 1a): hit mode 'shape' (SHAPES[kind].hit:
 * box, ellipse formula with tolerance, polygon; the inside always hits, also
 * with fillOpacity 0), setBoxesLocal() for the transformer's live preview.
 *
 * Connector index (SPEC-M1 §6.2, round 1b):
 * - #links: Map<itemId, Set<connectorId>> from data.start.item/data.end.item,
 *   kept in load/apply, also for targets that are not known yet (like #kids);
 *   #conn: Map<connectorId, {geom: ConnGeom, label: LabelBox|null}>
 * - routing (connectors.routeConnector) over the ABSOLUTE boxes of the
 *   targets, or the preview box of setBoxResolver (remote drag preview); a
 *   missing target falls back to the last docked point of that end (the
 *   loose end stays where it was until the server's release arrives); a
 *   connector whose target was never known has no geometry: no rbush entry,
 *   no node, never dropped (it routes as soon as the target arrives)
 * - every change of a target's absolute box (apply, moveLocal, setBoxesLocal,
 *   frame cascade) re-routes its connectors; ChangeSummary.geometry and the
 *   returned sets report connectors whose route changed (also when it
 *   appears or vanishes)
 * - rbush entry of a connector: the route box padded with cap size +
 *   strokeWidth/2 ('line'), joined with the label box; hit mode 'line':
 *   distance to hitPts ≤ tol + strokeWidth/2, a cap, or the label box;
 *   queryRect and boundsOf take the route box; abs() stays the stored
 *   0 × 0 box (rule 12)
 * - local states that never touch the stored data ([S]-internal, while the
 *   scene drags): a shift of the free ends (moveLocal of a connector id),
 *   end overrides (setEndsLocal: retarget preview, free ends in a transform
 *   preview); an upsert of that connector, load() and clearLocal() end them
 *   ([C] reads the stored ends from get() for its actions).
 *
 * Group index (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): #groups
 * Map<groupId, Set<id>> of the items with a `group`, kept in load/apply
 * (upsert, a change of group, remove); membersOf(groupId) lists them in
 * stacking order, groupSize(groupId) counts them without sorting. Whether a
 * group counts (two members at least) is model/groups.js's.
 *
 * The model lives outside any reactivity system and knows nothing about Konva.
 * Items returned by get() are the model's own objects: read, never mutate.
 */
import RBush from 'rbush'
import { capSize, labelBox, normalizeEndpoint, routeConnector } from './connectors.js'
import { distToPolyline, pointInPolygon, rotatedBBox, toLocal } from './geometry.js'
import { fieldValue, layerRank, textPathOf, typeInfo } from './registry.js'
import { canon } from './paths.js'
import { outlinePoints, shapeOf } from './shapes.js'
import { isValidKey } from './zorder.js'
import { FRAME_EDGE_HIT_PX, FRAME_TITLE_BAND, FRAME_TITLE_SIZE, SHADOW } from './tokens.js'

/**
 * @typedef {{id:string, t:string, x:number, y:number, w:number, h:number, r:number, z:string,
 *            parent:(string|null), data:Object, style:Object, group:(string|null),
 *            lock:({by:(string|null), name:(string|null)}|null)}} WireItem
 *   group and lock: M2 (SPEC-M1 §1.2 R20); the scene draws a lock symbol for a
 *   locked item (nodes/locks.js) and one outline per fully selected group
 * @typedef {'geom'|'z'|'parent'|'text'|'style'|'data'|'type'|'group'|'lock'} ChangeField
 * @typedef {{added:string[], removed:string[], updated:Map<string, Set<ChangeField>>,
 *            geometry:Set<string>, reordered:boolean}} ChangeSummary
 *   geometry = ids of items that existed before the call and whose absolute box
 *   changed (including descendants of a moved container), and connectors that
 *   existed before the call and whose route changed; new items are only in
 *   `added`, removed ones only in `removed`.
 * @typedef {{minX:number, minY:number, maxX:number, maxY:number, id:string, t:string}} IndexEntry
 * @typedef {{x:number, y:number, w:number, h:number, r:number}} AbsBox
 * @typedef {import('./connectors.js').ConnGeom} ConnGeom
 * @typedef {import('./connectors.js').LabelBox} LabelBox
 * @typedef {import('./connectors.js').Endpoint} Endpoint
 * @typedef {{geom:ConnGeom, label:(LabelBox|null)}} Route
 */

/** Deepest parent chain that is resolved (§6.2). */
const MAX_DEPTH = 8

/** rbush padding of a note: its drop shadow. */
const STICKY_PAD = SHADOW.blur * 1.5 + Math.abs(SHADOW.y)
/** rbush padding of a frame: stroke on three sides, generous title band on top. */
const FRAME_PAD = 2
const FRAME_TITLE_PAD = FRAME_TITLE_SIZE * 1.8

const NUM_FIELDS = ['x', 'y', 'w', 'h', 'r']
const ENDS = Object.freeze(['start', 'end'])

/**
 * @param {unknown} v value
 * @return {boolean} true for a plain map (no array, no null)
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
 * @param {unknown} t item type
 * @return {boolean} a routed type (connector: hit 'line', placement 'none')
 */
function isRouted(t) {
	return typeInfo(t).hit === 'line'
}

/**
 * Own copy of a wire item with the fields the model relies on: finite numbers
 * (missing → 0), parent null when missing, data/style maps, group a string or
 * null, lock a map (with its by and name) or null. Unknown fields stay.
 *
 * @param {object} src WireItem from the replica or a snapshot
 * @return {WireItem}
 */
function normalize(src) {
	const it = structuredClone(src)
	for (const f of NUM_FIELDS) {
		if (typeof it[f] !== 'number' || !Number.isFinite(it[f])) {
			it[f] = 0
		}
	}
	if (it.parent === undefined || (it.parent !== null && typeof it.parent !== 'string')) {
		it.parent = null
	}
	if (!isMap(it.data)) it.data = {}
	if (!isMap(it.style)) it.style = {}
	if (typeof it.group !== 'string') it.group = null
	if (!isMap(it.lock)) it.lock = null
	if (typeof it.z !== 'string') it.z = null
	if (typeof it.t !== 'string') it.t = ''
	return it
}

/**
 * @param {unknown} v value
 * @return {string} canonical JSON (sorted keys, empty = absent)
 */
function canonJson(v) {
	return JSON.stringify(canon(v))
}

/**
 * @param {object} data data map
 * @param {string|null} key level-1 key to leave out
 * @return {string} canonical JSON of data without that key
 */
function dataJsonWithout(data, key) {
	if (key === null || !Object.prototype.hasOwnProperty.call(data, key)) {
		return canonJson(data)
	}
	const copy = { ...data }
	delete copy[key]
	return canonJson(copy)
}

/**
 * What changed between two states of the same item.
 *
 * @param {WireItem} a before
 * @param {WireItem} b after
 * @return {Set<ChangeField>}
 */
function diffFields(a, b) {
	const out = new Set()
	if (a.t !== b.t) out.add('type')
	if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.r !== b.r) out.add('geom')
	if (a.parent !== b.parent) out.add('parent')
	if (a.z !== b.z) out.add('z')
	if (canonJson(a.style) !== canonJson(b.style)) out.add('style')
	const tp = textPathOf(b.t)
	const textKey = tp !== null && tp.startsWith('data.') && tp.indexOf('.', 5) < 0 ? tp.slice(5) : null
	if (textKey !== null && canonJson(a.data[textKey] ?? null) !== canonJson(b.data[textKey] ?? null)) {
		out.add('text')
	}
	if (dataJsonWithout(a.data, textKey) !== dataJsonWithout(b.data, textKey)) out.add('data')
	if (a.group !== b.group) out.add('group')
	if (JSON.stringify(a.lock ?? null) !== JSON.stringify(b.lock ?? null)) out.add('lock')
	return out
}

/**
 * @param {AbsBox} a box
 * @param {AbsBox} b box
 * @return {boolean} equal geometry
 */
function sameBox(a, b) {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.r === b.r
}

/**
 * @param {number[]} a flat numbers
 * @param {number[]} b flat numbers
 * @return {boolean} equal lists
 */
function sameList(a, b) {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

/**
 * @param {Route|null|undefined} a route
 * @param {Route|null|undefined} b route
 * @return {boolean} same drawn geometry (route kind and points, label box)
 */
function sameRoute(a, b) {
	if (!a || !b) return !a && !b
	if (a.geom.kind !== b.geom.kind || !sameList(a.geom.points, b.geom.points)) return false
	const la = a.label
	const lb = b.label
	if (!la || !lb) return !la && !lb
	return la.x === lb.x && la.y === lb.y && la.w === lb.w && la.h === lb.h
}

/**
 * @param {object} it WireItem of a shape
 * @return {number} half its stroke width (rbush padding and hit tolerance), 0 without a stroke
 */
function halfStroke(it) {
	const sw = fieldValue(it, 'style.strokeWidth')
	return typeof sw === 'number' && sw > 0 ? sw / 2 : 0
}

/**
 * Point test of a shape in its local frame (SHAPES[kind].hit): the inside
 * always hits (fillOpacity does not matter), the tolerance widens the outline.
 *
 * @param {unknown} kind data.kind (unknown kinds hit like rect)
 * @param {number} lx local x (origin top-left of the unrotated box)
 * @param {number} ly local y
 * @param {number} w width
 * @param {number} h height
 * @param {number} tol tolerance (world)
 * @return {boolean}
 */
export function hitShape(kind, lx, ly, w, h, tol) {
	const mode = shapeOf(kind).hit
	if (mode === 'ellipse') {
		const rx = w / 2 + tol
		const ry = h / 2 + tol
		if (!(rx > 0) || !(ry > 0)) return false
		const dx = (lx - w / 2) / rx
		const dy = (ly - h / 2) / ry
		return dx * dx + dy * dy <= 1
	}
	if (mode === 'polygon') {
		if (lx < -tol || ly < -tol || lx > w + tol || ly > h + tol) return false
		const pts = outlinePoints(kind, w, h)
		if (pointInPolygon(lx, ly, pts)) return true
		return tol > 0 && distToPolyline(lx, ly, [...pts, pts[0], pts[1]]) <= tol
	}
	return lx >= -tol && ly >= -tol && lx <= w + tol && ly <= h + tol
}

/**
 * @param {{x:number, y:number, w:number, h:number}} rect possibly with negative w/h
 * @return {{minX:number, minY:number, maxX:number, maxY:number}}
 */
function normRect(rect) {
	const x0 = rect.x
	const y0 = rect.y
	const x1 = rect.x + rect.w
	const y1 = rect.y + rect.h
	return { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) }
}

export class SceneModel {
	/** @type {Map<string, WireItem>} */
	#items = new Map()
	/** @type {Map<string, AbsBox>} */
	#abs = new Map()
	/** declared parent → children (also for parents that are unknown) @type {Map<string, Set<string>>} */
	#kids = new Map()
	/** @type {Map<string, IndexEntry>} */
	#entries = new Map()
	#tree = new RBush(16)
	/** preview boxes for routing @type {((id:string) => (AbsBox|null))|null} */
	#boxResolver = null
	/** bound item → connectors (also for items that are not known yet) @type {Map<string, Set<string>>} */
	#links = new Map()
	/** connector → its route; absent = no geometry (unknown target) @type {Map<string, Route>} */
	#conn = new Map()
	/** connector → last docked points of its ends (fallback for a vanished target) */
	#last = new Map()
	/** connector → local shift of its free ends while dragged @type {Map<string, {dx:number, dy:number}>} */
	#shift = new Map()
	/** connector → local end overrides (retarget, transform preview) @type {Map<string, {start?:Endpoint, end?:Endpoint}>} */
	#localEnds = new Map()
	/** group id → its items (M2, R20 Gruppieren) @type {Map<string, Set<string>>} */
	#groups = new Map()

	/**
	 * Bulk load (snapshot or resync): replaces everything (local connector
	 * states included).
	 *
	 * @param {WireItem[]} items wire items, any order
	 */
	load(items) {
		this.#items.clear()
		this.#abs.clear()
		this.#kids.clear()
		this.#entries.clear()
		this.#tree.clear()
		this.#links.clear()
		this.#conn.clear()
		this.#last.clear()
		this.#shift.clear()
		this.#localEnds.clear()
		this.#groups.clear()
		for (const src of items ?? []) {
			if (!src || typeof src.id !== 'string') continue
			const old = this.#items.get(src.id)
			if (old) {
				this.#unlinkKid(old.parent, src.id)
				this.#unlinkEnds(src.id, old)
				this.#unlinkGroup(old.group, src.id)
			}
			const it = normalize(src)
			this.#items.set(it.id, it)
			this.#linkKid(it.parent, it.id)
			this.#linkEnds(it.id, it)
			this.#linkGroup(it.group, it.id)
		}
		const entries = []
		const routed = []
		for (const [id, it] of this.#items) {
			const a = this.#computeAbs(id)
			this.#abs.set(id, a)
			if (isRouted(it.t)) {
				routed.push(id)
				continue
			}
			const e = this.#makeEntry(id, a)
			this.#entries.set(id, e)
			entries.push(e)
		}
		for (const id of routed) {
			const route = this.#route(id)
			if (!route) continue
			this.#conn.set(id, route)
			const e = this.#connEntry(id, route)
			this.#entries.set(id, e)
			entries.push(e)
		}
		this.#tree.load(entries)
	}

	/**
	 * Applies full item states and removals (generic: whole objects).
	 * Removals are processed first, then upserts; the result does not depend on
	 * the order within either list. Connectors attached to anything whose box
	 * changed are routed anew; an upsert of a connector ends its local state.
	 *
	 * @param {{upserts?:WireItem[], removes?:string[]}} change full items and ids to drop
	 * @return {ChangeSummary}
	 */
	apply({ upserts = [], removes = [] } = {}) {
		const summary = { added: [], removed: [], updated: new Map(), geometry: new Set(), reordered: false }
		const dirty = new Set()
		const added = new Set()
		const touched = new Set()
		for (const id of removes) {
			const it = this.#items.get(id)
			if (!it) continue
			this.#items.delete(id)
			this.#unlinkKid(it.parent, id)
			this.#unlinkEnds(id, it)
			this.#unlinkGroup(it.group, id)
			this.#abs.delete(id)
			this.#dropConnState(id)
			const e = this.#entries.get(id)
			if (e) {
				this.#tree.remove(e)
				this.#entries.delete(id)
			}
			summary.removed.push(id)
			touched.add(id)
			// Children keep their declared parent and now lie at the root.
			const kids = this.#kids.get(id)
			if (kids) {
				for (const k of kids) dirty.add(k)
			}
		}
		for (const src of upserts) {
			if (!src || typeof src.id !== 'string') continue
			const it = normalize(src)
			const old = this.#items.get(it.id)
			if (!old) {
				this.#items.set(it.id, it)
				this.#linkKid(it.parent, it.id)
				this.#linkEnds(it.id, it)
				this.#linkGroup(it.group, it.id)
				summary.added.push(it.id)
				added.add(it.id)
				dirty.add(it.id)
				continue
			}
			const fields = diffFields(old, it)
			if (isRouted(old.t) || isRouted(it.t)) {
				// the stored state arrived: the local drag state of this connector ends
				if (this.#shift.delete(it.id) || this.#localEnds.delete(it.id)) dirty.add(it.id)
			}
			if (fields.size === 0) continue
			this.#items.set(it.id, it)
			if (fields.has('parent')) {
				this.#unlinkKid(old.parent, it.id)
				this.#linkKid(it.parent, it.id)
			}
			if (fields.has('data') || fields.has('type')) {
				this.#unlinkEnds(it.id, old)
				this.#linkEnds(it.id, it)
			}
			if (fields.has('group')) {
				this.#unlinkGroup(old.group, it.id)
				this.#linkGroup(it.group, it.id)
			}
			const prev = summary.updated.get(it.id)
			summary.updated.set(it.id, prev ? new Set([...prev, ...fields]) : fields)
			if (fields.has('geom') || fields.has('parent') || fields.has('type')) dirty.add(it.id)
			// the rbush padding of a shape is half its stroke width
			else if (fields.has('style') && typeInfo(it.t).pad === 'stroke') dirty.add(it.id)
			// a connector's route, caps and label box follow its data, style and label
			else if (isRouted(it.t)) dirty.add(it.id)
			if (fields.has('type') && isRouted(old.t) && !isRouted(it.t)) this.#dropConnState(it.id)
			if (fields.has('z') || fields.has('type')) summary.reordered = true
		}
		this.#recompute(dirty, added, summary.geometry, touched)
		return summary
	}

	/**
	 * Moves items during a local drag, without ops. Descendants follow, and so
	 * do the connectors attached to them (re-routed). A connector id among
	 * `ids` shifts its FREE ends locally (bound ends follow their targets);
	 * its stored data stays untouched until its upsert arrives.
	 *
	 * @param {Iterable<string>} ids items to move (normally the top-level selection)
	 * @param {number} dx world delta x
	 * @param {number} dy world delta y
	 * @return {Set<string>} ids whose absolute box or route changed
	 */
	moveLocal(ids, dx, dy) {
		const geometry = new Set()
		if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
			return geometry
		}
		const dirty = new Set()
		for (const id of ids) {
			const it = this.#items.get(id)
			if (!it) continue
			if (isRouted(it.t)) {
				const s = this.#shift.get(id) ?? { dx: 0, dy: 0 }
				const next = { dx: s.dx + dx, dy: s.dy + dy }
				if (next.dx === 0 && next.dy === 0) this.#shift.delete(id)
				else this.#shift.set(id, next)
			} else {
				it.x += dx
				it.y += dy
			}
			dirty.add(id)
		}
		this.#recompute(dirty, new Set(), geometry)
		return geometry
	}

	/**
	 * Transformer preview (SPEC-M1 §6.2, §6.3): sets the box of items locally,
	 * without ops, like moveLocal for a drag. Values are RELATIVE (x/y to the
	 * parent, as stored); only the finite fields of each entry change.
	 * `fontSize` (text items, corner handles) sets style.fontSize locally, null
	 * removes it again (Esc restores the stored state). Descendants follow.
	 * Only while a transform runs: the session's next upsert of these ids
	 * replaces the local values. Connectors (no box) are skipped.
	 *
	 * @param {Map<string, {x?:number, y?:number, w?:number, h?:number, r?:number, fontSize?:(number|null)}>} map relative boxes
	 * @return {Set<string>} ids whose absolute box (or font size) changed,
	 *   plus the connectors attached to them whose route changed
	 */
	setBoxesLocal(map) {
		const geometry = new Set()
		const dirty = new Set()
		for (const [id, b] of map ?? []) {
			const it = this.#items.get(id)
			if (!it || !b || typeof b !== 'object' || isRouted(it.t)) continue
			for (const f of NUM_FIELDS) {
				if (typeof b[f] === 'number' && Number.isFinite(b[f])) it[f] = b[f]
			}
			if (Object.prototype.hasOwnProperty.call(b, 'fontSize')) {
				const fs = b.fontSize
				const cur = it.style.fontSize
				if (typeof fs === 'number' && Number.isFinite(fs) && fs !== cur) {
					it.style = { ...it.style, fontSize: fs }
					geometry.add(id)
				} else if (fs === null && cur !== undefined) {
					const style = { ...it.style }
					delete style.fontSize
					it.style = style
					geometry.add(id)
				}
			}
			dirty.add(id)
		}
		this.#recompute(dirty, new Set(), geometry)
		return geometry
	}

	/**
	 * Local end overrides of connectors ([S]-internal: retarget preview, free
	 * ends in a transform preview): an end given here is routed instead of
	 * the stored one, null removes that end's override. The stored data stays
	 * untouched; an upsert of the connector, load() or clearLocal() end it.
	 *
	 * @param {Map<string, {start?:(Endpoint|null), end?:(Endpoint|null)}>} map connector → ends
	 * @return {Set<string>} connectors whose route changed
	 */
	setEndsLocal(map) {
		const geometry = new Set()
		const dirty = new Set()
		for (const [id, ends] of map ?? []) {
			const it = this.#items.get(id)
			if (!it || !isRouted(it.t) || !isMap(ends)) continue
			const cur = { ...(this.#localEnds.get(id) ?? {}) }
			for (const which of ENDS) {
				if (!hasOwn(ends, which)) continue
				const ep = ends[which] === null ? null : normalizeEndpoint(ends[which])
				if (ep === null) delete cur[which]
				else cur[which] = ep
			}
			if (Object.keys(cur).length === 0) this.#localEnds.delete(id)
			else this.#localEnds.set(id, cur)
			dirty.add(id)
		}
		this.#recompute(dirty, new Set(), geometry)
		return geometry
	}

	/**
	 * Ends the local states (free-end shift, end overrides) of the given
	 * connectors, or of all; their stored ends route again.
	 *
	 * @param {Iterable<string>} [ids] connectors (default: every connector with a local state)
	 * @return {Set<string>} connectors whose route changed
	 */
	clearLocal(ids = null) {
		const list = ids === null ? new Set([...this.#shift.keys(), ...this.#localEnds.keys()]) : new Set(ids)
		const dirty = new Set()
		for (const id of list) {
			const a = this.#shift.delete(id)
			const b = this.#localEnds.delete(id)
			if ((a || b) && this.#items.has(id)) dirty.add(id)
		}
		const geometry = new Set()
		this.#recompute(dirty, new Set(), geometry)
		return geometry
	}

	/**
	 * Routes the connectors attached to these items (or their descendants)
	 * anew ([S]-internal): after the box resolver's answers changed (remote
	 * drag previews start, move or end).
	 *
	 * @param {Iterable<string>} ids items
	 * @return {Set<string>} connectors whose route changed
	 */
	reroute(ids) {
		const geometry = new Set()
		this.#recompute(new Set(this.connectorsOf(ids)), new Set(), geometry)
		return geometry
	}

	/**
	 * Connectors attached to the given items or their descendants (frame
	 * cascade), known or not (a connector is listed as soon as it names the item).
	 *
	 * @param {Iterable<string>} ids item ids
	 * @return {Set<string>} connector ids
	 */
	connectorsOf(ids) {
		const out = new Set()
		const seen = new Set()
		const add = (id) => {
			if (seen.has(id)) return
			seen.add(id)
			const set = this.#links.get(id)
			if (!set) return
			for (const c of set) {
				if (this.#items.has(c)) out.add(c)
			}
		}
		for (const id of ids ?? []) {
			add(id)
			for (const d of this.descendantsOf(id)) add(d)
		}
		return out
	}

	/**
	 * Routed geometry of a connector (ConnGeom, connectors.js): the model's own
	 * object, read only. null for other items and for a connector whose
	 * target has never been known.
	 *
	 * @param {string} id connector id
	 * @return {ConnGeom|null}
	 */
	geometryOf(id) {
		return this.#conn.get(id)?.geom ?? null
	}

	/**
	 * Route of a connector with its estimated label box ([S]-internal: node,
	 * selection outline, label editor). Read only.
	 *
	 * @param {string} id connector id
	 * @return {Route|null}
	 */
	routeOf(id) {
		return this.#conn.get(id) ?? null
	}

	/**
	 * Preview boxes (remote drag preview) for routing attached connectors:
	 * fn(id) answers an ABSOLUTE box for an item that is shown elsewhere than
	 * its model box, null otherwise. Changing the answers needs reroute(ids).
	 *
	 * @param {((id:string) => (AbsBox|null))|null} fn resolver or null
	 */
	setBoxResolver(fn) {
		this.#boxResolver = typeof fn === 'function' ? fn : null
	}

	/**
	 * @param {string} id item id
	 * @return {WireItem|undefined} the model's own object (do not mutate)
	 */
	get(id) {
		return this.#items.get(id)
	}

	/**
	 * @param {string} id item id
	 * @return {boolean}
	 */
	has(id) {
		return this.#items.has(id)
	}

	/** @return {number} number of items */
	get size() {
		return this.#items.size
	}

	/** @return {IterableIterator<string>} all item ids (insertion order) */
	ids() {
		return this.#items.keys()
	}

	/**
	 * @param {string} id item id
	 * @return {AbsBox|null} absolute box (parent offsets resolved), a copy;
	 *   for a connector its stored 0 × 0 box (rule 12; the route: geometryOf)
	 */
	abs(id) {
		const a = this.#abs.get(id)
		return a ? { x: a.x, y: a.y, w: a.w, h: a.h, r: a.r } : null
	}

	/**
	 * @param {string} id item id
	 * @return {{minX:number, minY:number, maxX:number, maxY:number}|null} padded index box (render bounds)
	 */
	bboxOf(id) {
		const e = this.#entries.get(id)
		return e ? { minX: e.minX, minY: e.minY, maxX: e.maxX, maxY: e.maxY } : null
	}

	/**
	 * Index entries intersecting a world rectangle (unordered, padded boxes).
	 *
	 * @param {number} minX left
	 * @param {number} minY top
	 * @param {number} maxX right
	 * @param {number} maxY bottom
	 * @return {IndexEntry[]}
	 */
	query(minX, minY, maxX, maxY) {
		return this.#tree.search({ minX, minY, maxX, maxY })
	}

	/**
	 * Topmost item under a world point, precise per registry hit mode:
	 * 'box' = the (rotated) box; 'frameEdge' = title band above the frame plus
	 * a border band, the inside is empty canvas; 'shape' = SHAPES[kind].hit;
	 * 'line' = the routed connector line, its caps and its label box.
	 *
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {number} [tolWorld] tolerance in world units (4 px / scale for a mouse, 12 px / scale for touch)
	 * @param {{edgeWorld?:number, accept?:((id:string) => boolean)}} [opts] width of the frame
	 *   border band in world units (the scene passes FRAME_EDGE_HIT_PX / scale; default
	 *   FRAME_EDGE_HIT_PX); accept: only items it accepts count (e.g. bindable targets)
	 * @return {string|null} item id
	 */
	hitTest(wx, wy, tolWorld = 0, opts = {}) {
		const tol = Number.isFinite(tolWorld) && tolWorld > 0 ? tolWorld : 0
		const edge = Number.isFinite(opts.edgeWorld) && opts.edgeWorld >= 0 ? opts.edgeWorld : FRAME_EDGE_HIT_PX
		const accept = typeof opts.accept === 'function' ? opts.accept : null
		const pad = tol + edge
		const cands = this.#tree.search({ minX: wx - pad, minY: wy - pad, maxX: wx + pad, maxY: wy + pad })
		if (cands.length === 0) {
			return null
		}
		cands.sort((a, b) => this.compareOrder(b.id, a.id))
		for (const e of cands) {
			if (accept !== null && !accept(e.id)) continue
			if (this.#hitItem(e.id, wx, wy, tol, edge)) {
				return e.id
			}
		}
		return null
	}

	/**
	 * Items for a marquee selection (connectors with their route box).
	 *
	 * @param {{x:number, y:number, w:number, h:number}} rect world rectangle (w/h may be negative)
	 * @param {'intersect'|'contain'} [mode] 'contain' = box completely inside
	 * @return {string[]} ids in stacking order (bottom first)
	 */
	queryRect(rect, mode = 'intersect') {
		const r = normRect(rect)
		const out = []
		for (const e of this.#tree.search(r)) {
			const b = this.#boxOf(e.id)
			if (!b) continue
			const hit = mode === 'contain'
				? b[0] >= r.minX && b[1] >= r.minY && b[2] <= r.maxX && b[3] <= r.maxY
				: b[0] <= r.maxX && b[2] >= r.minX && b[1] <= r.maxY && b[3] >= r.minY
			if (hit) out.push(e.id)
		}
		return this.sortByOrder(out)
	}

	/**
	 * Topmost container whose box contains a world point (drop target, parent of a new item).
	 *
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {Iterable<string>} [excludeIds] containers to skip (dragged items and their descendants)
	 * @return {string|null}
	 */
	topContainerAt(wx, wy, excludeIds = new Set()) {
		const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
		let best = null
		for (const e of this.#tree.search({ minX: wx, minY: wy, maxX: wx, maxY: wy })) {
			if (exclude.has(e.id)) continue
			const it = this.#items.get(e.id)
			if (!typeInfo(it.t).container) continue
			const a = this.#abs.get(e.id)
			const [lx, ly] = toLocal(wx, wy, a.x, a.y, a.w, a.h, a.r)
			if (lx < 0 || ly < 0 || lx > a.w || ly > a.h) continue
			if (best === null || this.compareOrder(e.id, best) > 0) {
				best = e.id
			}
		}
		return best
	}

	/**
	 * @param {string} id item id
	 * @return {string[]} items whose parent field names id (in stacking order)
	 */
	childrenOf(id) {
		const kids = this.#kids.get(id)
		if (!kids) {
			return []
		}
		return this.sortByOrder([...kids].filter((k) => this.#items.has(k)))
	}

	/**
	 * Group index (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): the items whose
	 * `group` is groupId, a group of one included (model/groups.js decides
	 * what counts as a group).
	 *
	 * @param {string} groupId group id
	 * @return {string[]} its items in stacking order (compareOrder), [] for an unknown id
	 */
	membersOf(groupId) {
		const set = typeof groupId === 'string' ? this.#groups.get(groupId) : undefined
		return set ? this.sortByOrder(set) : []
	}

	/**
	 * @param {string} groupId group id
	 * @return {number} how many items have this group, without sorting (O(1);
	 *   model/groups.js groupOf asks it for every id)
	 */
	groupSize(groupId) {
		return typeof groupId === 'string' ? this.#groups.get(groupId)?.size ?? 0 : 0
	}

	/**
	 * @param {string} id item id
	 * @return {string[]} all items below id in the parent tree (breadth first, without id)
	 */
	descendantsOf(id) {
		const out = []
		const seen = new Set([id])
		let level = [id]
		for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
			const next = []
			for (const p of level) {
				const kids = this.#kids.get(p)
				if (!kids) continue
				for (const k of kids) {
					if (seen.has(k) || !this.#items.has(k)) continue
					seen.add(k)
					out.push(k)
					next.push(k)
				}
			}
			level = next
		}
		return out
	}

	/**
	 * Total stacking order: layer rank (frames behind content), z key (code
	 * units), id as the tie breaker for equal keys from two clients.
	 * Unknown ids compare as content without a key.
	 *
	 * @param {string} a item id
	 * @param {string} b item id
	 * @return {number} < 0 when a lies below b
	 */
	compareOrder(a, b) {
		if (a === b) {
			return 0
		}
		const ia = this.#items.get(a)
		const ib = this.#items.get(b)
		const ra = ia ? layerRank(ia.t) : 1
		const rb = ib ? layerRank(ib.t) : 1
		if (ra !== rb) {
			return ra < rb ? -1 : 1
		}
		const za = ia && typeof ia.z === 'string' ? ia.z : ''
		const zb = ib && typeof ib.z === 'string' ? ib.z : ''
		if (za !== zb) {
			return za < zb ? -1 : 1
		}
		return a < b ? -1 : 1
	}

	/**
	 * @param {Iterable<string>} ids item ids
	 * @return {string[]} new array, bottom first
	 */
	sortByOrder(ids) {
		return [...ids].sort((a, b) => this.compareOrder(a, b))
	}

	/**
	 * @param {'back'|'content'} layer registry layer
	 * @return {string|null} highest valid z key on that layer (invalid stored keys are skipped)
	 */
	maxZ(layer) {
		return this.#extremeZ(layer, 1)
	}

	/**
	 * @param {'back'|'content'} layer registry layer
	 * @return {string|null} lowest valid z key on that layer (invalid stored keys are skipped)
	 */
	minZ(layer) {
		return this.#extremeZ(layer, -1)
	}

	/**
	 * @param {Iterable<string>} ids item ids (unknown ids and connectors without a route are skipped)
	 * @return {{x:number, y:number, w:number, h:number}|null} union of the (rotated)
	 *   absolute boxes; connectors count with their route box
	 */
	boundsOf(ids) {
		let minX = Infinity
		let minY = Infinity
		let maxX = -Infinity
		let maxY = -Infinity
		for (const id of ids) {
			const b = this.#boxOf(id)
			if (!b) continue
			minX = Math.min(minX, b[0])
			minY = Math.min(minY, b[1])
			maxX = Math.max(maxX, b[2])
			maxY = Math.max(maxY, b[3])
		}
		if (minX === Infinity) {
			return null
		}
		return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
	}

	/** @return {{x:number, y:number, w:number, h:number}|null} bounds of all items, null for an empty board */
	allBounds() {
		return this.boundsOf(this.#items.keys())
	}

	// ---------------------------------------------------------------- internals

	/**
	 * @param {string} id item id
	 * @return {number[]|null} [minX, minY, maxX, maxY]: the (rotated) absolute
	 *   box, for a connector its route box; null when unknown or unrouted
	 */
	#boxOf(id) {
		const it = this.#items.get(id)
		if (!it) return null
		if (isRouted(it.t)) {
			const r = this.#conn.get(id)
			return r ? r.geom.bbox : null
		}
		const a = this.#abs.get(id)
		const b = rotatedBBox(a.x, a.y, a.w, a.h, a.r)
		return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])]
	}

	/**
	 * @param {'back'|'content'} layer registry layer
	 * @param {1|-1} sign 1 = maximum, -1 = minimum
	 * @return {string|null}
	 */
	#extremeZ(layer, sign) {
		let best = null
		for (const it of this.#items.values()) {
			if (typeInfo(it.t).layer !== layer || !isValidKey(it.z)) continue
			if (best === null || (sign > 0 ? it.z > best : it.z < best)) {
				best = it.z
			}
		}
		return best
	}

	/**
	 * @param {string|null} parent declared parent
	 * @param {string} id child
	 */
	#linkKid(parent, id) {
		if (parent === null) return
		let set = this.#kids.get(parent)
		if (!set) {
			set = new Set()
			this.#kids.set(parent, set)
		}
		set.add(id)
	}

	/**
	 * @param {string|null} parent declared parent
	 * @param {string} id child
	 */
	#unlinkKid(parent, id) {
		if (parent === null) return
		const set = this.#kids.get(parent)
		if (!set) return
		set.delete(id)
		if (set.size === 0) this.#kids.delete(parent)
	}

	/**
	 * @param {string|null} group the item's group
	 * @param {string} id item
	 */
	#linkGroup(group, id) {
		if (typeof group !== 'string') return
		let set = this.#groups.get(group)
		if (!set) {
			set = new Set()
			this.#groups.set(group, set)
		}
		set.add(id)
	}

	/**
	 * @param {string|null} group the item's former group
	 * @param {string} id item
	 */
	#unlinkGroup(group, id) {
		if (typeof group !== 'string') return
		const set = this.#groups.get(group)
		if (!set) return
		set.delete(id)
		if (set.size === 0) this.#groups.delete(group)
	}

	/**
	 * @param {WireItem} it item
	 * @return {string[]} items its stored ends name (connectors only)
	 */
	#boundItems(it) {
		if (!isRouted(it.t)) return []
		const out = []
		for (const which of ENDS) {
			// the stored end through its registry rule (Rev 8): an invalid end binds nothing
			const item = fieldValue(it, 'data.' + which)?.item
			if (typeof item === 'string' && !out.includes(item)) out.push(item)
		}
		return out
	}

	/**
	 * @param {string} id connector id
	 * @param {WireItem} it its state
	 */
	#linkEnds(id, it) {
		for (const target of this.#boundItems(it)) {
			let set = this.#links.get(target)
			if (!set) {
				set = new Set()
				this.#links.set(target, set)
			}
			set.add(id)
		}
	}

	/**
	 * @param {string} id connector id
	 * @param {WireItem} it its previous state
	 */
	#unlinkEnds(id, it) {
		for (const target of this.#boundItems(it)) {
			const set = this.#links.get(target)
			if (!set) continue
			set.delete(id)
			if (set.size === 0) this.#links.delete(target)
		}
	}

	/** @param {string} id connector that is gone or no connector any more */
	#dropConnState(id) {
		this.#conn.delete(id)
		this.#last.delete(id)
		this.#shift.delete(id)
		this.#localEnds.delete(id)
	}

	/**
	 * Absolute box through the parent chain: only existing containers count,
	 * at most MAX_DEPTH levels, a cycle puts the item at the root.
	 *
	 * @param {string} id item id
	 * @return {AbsBox}
	 */
	#computeAbs(id) {
		const it = this.#items.get(id)
		let x = it.x
		let y = it.y
		let cur = it
		const seen = new Set([id])
		for (let depth = 0; depth < MAX_DEPTH; depth++) {
			const pid = cur.parent
			if (pid === null) break
			const p = this.#items.get(pid)
			if (!p || !typeInfo(p.t).container) break
			if (seen.has(pid)) {
				x = it.x
				y = it.y
				break
			}
			seen.add(pid)
			x += p.x
			y += p.y
			cur = p
		}
		return { x, y, w: it.w, h: it.h, r: it.r }
	}

	/**
	 * Recomputes abs + index for the dirty items and all their descendants,
	 * then routes the connectors that are dirty themselves or attached to
	 * anything whose box changed, appeared or vanished.
	 *
	 * @param {Set<string>} dirty changed items
	 * @param {Set<string>} added items new in this change (not reported in geometry)
	 * @param {Set<string>} geometry collects ids whose box or route changed
	 * @param {Set<string>} [gone] items removed in this change (their connectors route anew)
	 */
	#recompute(dirty, added, geometry, gone = new Set()) {
		const all = new Set()
		for (const id of dirty) {
			if (all.has(id)) continue
			all.add(id)
			for (const d of this.descendantsOf(id)) all.add(d)
		}
		const moved = new Set(gone)
		const routed = new Set()
		for (const id of all) {
			const it = this.#items.get(id)
			if (!it) continue
			const before = this.#abs.get(id)
			const a = this.#computeAbs(id)
			this.#abs.set(id, a)
			if (isRouted(it.t)) {
				routed.add(id)
				continue
			}
			this.#reindex(id, a)
			if (added.has(id) || !before || !sameBox(before, a)) moved.add(id)
			if (!added.has(id) && before && !sameBox(before, a)) {
				geometry.add(id)
			}
		}
		if (moved.size > 0) {
			for (const id of moved) {
				const set = this.#links.get(id)
				if (!set) continue
				for (const c of set) {
					if (this.#items.has(c)) routed.add(c)
				}
			}
		}
		for (const id of routed) {
			const before = this.#conn.get(id) ?? null
			const route = this.#route(id)
			if (route) this.#conn.set(id, route)
			else this.#conn.delete(id)
			this.#reindexConn(id, route)
			if (!added.has(id) && !sameRoute(before, route)) geometry.add(id)
		}
	}

	/**
	 * The route of a connector from its ends (local override, else stored;
	 * free ends with the local shift) and the boxes of its targets (preview
	 * box of the resolver, else the absolute box; a missing target: the last
	 * docked point of that end).
	 *
	 * @param {string} id connector id
	 * @return {Route|null} null when an end is invalid or has never docked
	 */
	#route(id) {
		const it = this.#items.get(id)
		const local = this.#localEnds.get(id)
		const shift = this.#shift.get(id)
		const last = this.#last.get(id)
		const ends = []
		for (const which of ENDS) {
			const own = local && hasOwn(local, which)
			let ep = own ? local[which] : (fieldValue(it, 'data.' + which) ?? null)
			if (ep === null) return null
			if (hasOwn(ep, 'item')) {
				const box = this.#targetBox(ep.item)
				ends.push({ box, ep, point: box ? null : (last?.[which] ?? null) })
				continue
			}
			if (shift && !own) ep = { x: ep.x + shift.dx, y: ep.y + shift.dy }
			ends.push({ box: null, ep, point: null })
		}
		const geom = routeConnector(ends[0], ends[1], fieldValue(it, 'data.route'))
		if (!geom) return null
		this.#last.set(id, { start: { x: geom.start.x, y: geom.start.y }, end: { x: geom.end.x, y: geom.end.y } })
		return { geom, label: labelBox(fieldValue(it, 'data.label'), geom.labelAt) }
	}

	/**
	 * @param {string} target item a connector end names
	 * @return {AbsBox|null} its preview box (resolver) or absolute box; null when unknown
	 */
	#targetBox(target) {
		const t = this.#items.get(target)
		if (!t || isRouted(t.t)) return null
		if (this.#boxResolver !== null) {
			const b = this.#boxResolver(target)
			if (isMap(b) && [b.x, b.y, b.w, b.h].every(Number.isFinite)) {
				return { x: b.x, y: b.y, w: b.w, h: b.h, r: Number.isFinite(b.r) ? b.r : 0 }
			}
		}
		return this.#abs.get(target) ?? null
	}

	/**
	 * @param {string} id connector id
	 * @param {Route|null} route its route
	 */
	#reindexConn(id, route) {
		const old = this.#entries.get(id)
		if (old) {
			this.#tree.remove(old)
			this.#entries.delete(id)
		}
		if (!route) return
		const e = this.#connEntry(id, route)
		this.#entries.set(id, e)
		this.#tree.insert(e)
	}

	/**
	 * rbush entry of a connector ('line'): route box padded with cap size +
	 * strokeWidth/2, joined with the label box.
	 *
	 * @param {string} id connector id
	 * @param {Route} route its route
	 * @return {IndexEntry}
	 */
	#connEntry(id, route) {
		const it = this.#items.get(id)
		const sw = fieldValue(it, 'style.strokeWidth')
		const d = capSize(sw) + (typeof sw === 'number' && sw > 0 ? sw / 2 : 0)
		const [x0, y0, x1, y1] = route.geom.bbox
		let minX = x0 - d
		let minY = y0 - d
		let maxX = x1 + d
		let maxY = y1 + d
		const l = route.label
		if (l) {
			minX = Math.min(minX, l.x)
			minY = Math.min(minY, l.y)
			maxX = Math.max(maxX, l.x + l.w)
			maxY = Math.max(maxY, l.y + l.h)
		}
		return { minX, minY, maxX, maxY, id, t: it.t }
	}

	/**
	 * @param {string} id item id
	 * @param {AbsBox} a absolute box
	 * @return {IndexEntry}
	 */
	#makeEntry(id, a) {
		const it = this.#items.get(id)
		const b = rotatedBBox(a.x, a.y, a.w, a.h, a.r)
		let minX = Math.min(b[0], b[2])
		let minY = Math.min(b[1], b[3])
		let maxX = Math.max(b[0], b[2])
		let maxY = Math.max(b[1], b[3])
		const pad = typeInfo(it.t).pad
		if (pad === 'title') {
			minX -= FRAME_PAD
			maxX += FRAME_PAD
			maxY += FRAME_PAD
			minY -= Math.max(FRAME_TITLE_PAD, FRAME_TITLE_BAND)
		} else {
			const d = pad === 'shadow' ? STICKY_PAD : pad === 'stroke' ? halfStroke(it) : 0
			minX -= d
			minY -= d
			maxX += d
			maxY += d
		}
		return { minX, minY, maxX, maxY, id, t: it.t }
	}

	/**
	 * @param {string} id item id
	 * @param {AbsBox} a new absolute box
	 */
	#reindex(id, a) {
		const old = this.#entries.get(id)
		if (old) {
			this.#tree.remove(old)
		}
		const e = this.#makeEntry(id, a)
		this.#entries.set(id, e)
		this.#tree.insert(e)
	}

	/**
	 * @param {string} id item id
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {number} tol tolerance (world)
	 * @param {number} edge frame border band (world)
	 * @return {boolean}
	 */
	#hitItem(id, wx, wy, tol, edge) {
		const it = this.#items.get(id)
		const mode = typeInfo(it.t).hit
		if (mode === 'line') {
			return this.#hitLine(id, it, wx, wy, tol)
		}
		const a = this.#abs.get(id)
		const [lx, ly] = toLocal(wx, wy, a.x, a.y, a.w, a.h, a.r)
		if (mode === 'shape') {
			return hitShape(fieldValue(it, 'data.kind'), lx, ly, a.w, a.h, tol + halfStroke(it))
		}
		if (mode === 'frameEdge') {
			const inTitle = lx >= -tol && lx <= a.w + tol && ly >= -FRAME_TITLE_BAND - tol && ly < 0
			if (inTitle) {
				return true
			}
			const d = edge + tol
			const inOuter = lx >= -d && ly >= -d && lx <= a.w + d && ly <= a.h + d
			const inInner = lx > d && ly > d && lx < a.w - d && ly < a.h - d
			return inOuter && !inInner
		}
		return lx >= -tol && ly >= -tol && lx <= a.w + tol && ly <= a.h + tol
	}

	/**
	 * Hit mode 'line': the route within tol + strokeWidth/2, a cap within
	 * tol + capSize/2 of its end point, or the label box (widened by tol).
	 *
	 * @param {string} id connector id
	 * @param {WireItem} it connector
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {number} tol tolerance (world)
	 * @return {boolean}
	 */
	#hitLine(id, it, wx, wy, tol) {
		const r = this.#conn.get(id)
		if (!r) return false
		const sw = fieldValue(it, 'style.strokeWidth')
		const half = typeof sw === 'number' && sw > 0 ? sw / 2 : 1
		if (distToPolyline(wx, wy, r.geom.hitPts) <= tol + half) return true
		const cap = capSize(sw) / 2 + tol
		for (const which of ENDS) {
			if (fieldValue(it, which === 'start' ? 'style.startCap' : 'style.endCap') === 'none') continue
			const p = r.geom[which]
			if (Math.hypot(wx - p.x, wy - p.y) <= cap) return true
		}
		const l = r.label
		return !!l && wx >= l.x - tol && wx <= l.x + l.w + tol && wy >= l.y - tol && wy <= l.y + l.h + tol
	}
}
