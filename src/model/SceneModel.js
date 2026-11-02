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
 *   stroke width), 'none' text and placeholders, (job 188) 'band' note pads
 *   (their sheets, model/pad.js; job 263 plus the note shadow); rotated boxes via
 *   rotatedBBox. (Job 211) A symbol, BPMN event or gateway with a label
 *   joins the label box (shapeLabelOf) to its entry, and a point on the
 *   label hits it.
 * - no stored font size, no version/rev/deleted (the server owns those).
 *
 * M1 v2 (SPEC-M1 §6.2, round 1a): hit mode 'shape' (SHAPES[kind].hit:
 * box, ellipse formula with tolerance, polygon; the inside always hits, also
 * with fillOpacity 0, unless hitTest's option hollow asks for the border band
 * of a shape without fill, job 170, and its text zone, job 177),
 * setBoxesLocal() for the transformer's live preview.
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
 * - (job 197) elbow connectors run around the other items (obstacles: every
 *   item but connectors, frames and the connector's own targets, by its
 *   rbush entry; connectors.elbowPlan); #watch holds each one's `watch`
 *   rectangle, and every change of an item's entry (move, resize, stroke,
 *   new, removed, frame cascade) re-routes the elbow connectors whose watch
 *   it touches before or after, so a route never depends on the history:
 *   it equals the route of a model loaded fresh with the same items
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
import { mindmapLayout, nodeAtLayout } from './mindmap.js'
import { padExtent, padPartAt } from './pad.js'
import { distToStroke, pointsOf } from './ink.js'
import { colTop, hasLanes, laneHeadW } from './lanes.js'
import { hasLabel, isImageKind, outlinePoints, shapeOf, symbolLabelBox } from './shapes.js'
import { isCovered } from './privateWriting.js'
import { isValidKey } from './zorder.js'
import { FRAME_EDGE_HIT_PX, FRAME_TITLE_BAND, FRAME_TITLE_SIZE, NOTE_SHADOWS } from './tokens.js'

/**
 * @typedef {{id:string, t:string, x:number, y:number, w:number, h:number, r:number, z:string,
 *            parent:(string|null), data:Object, style:Object, group:(string|null),
 *            lock:({by:(string|null), name:(string|null)}|null)}} WireItem
 *   group and lock: M2 (SPEC-M1 §1.2 R20); the scene draws a lock symbol for a
 *   locked item (nodes/locks.js) and one outline per fully selected group
 *   ChangeField react (job 172): data.react changed (not counted as data); the
 *   scene paints the reaction rows in its overlay (nodes/reactions.js)
 * @typedef {'geom'|'z'|'parent'|'text'|'style'|'data'|'type'|'group'|'lock'|'react'} ChangeField
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

/** rbush padding of a note: its drop shadows (job 259: the far one, 3 sigma + its offset). */
export const STICKY_PAD = Math.max(...NOTE_SHADOWS.map((s) => s.blur * 1.5 + Math.hypot(s.x, s.y)))
/**
 * (Job 259) The margin a note keeps as an obstacle of an elbow route: the
 * index padding of 0.4.0 (one shadow 0/2/8: 8 · 1.5 + 2), so routes do not
 * change with the softer, wider shadows (the far one is invisible that far out).
 */
const STICKY_OBSTACLE_PAD = 14
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
 * @param {unknown} t item type
 * @return {boolean} (job 197) an elbow route runs around items of this type:
 *   all but connectors and frames (layer 'back')
 */
function isObstacle(t) {
	return !isRouted(t) && typeInfo(t).layer !== 'back'
}

/**
 * @param {string} id connector id
 * @param {Route} route its route
 * @return {IndexEntry|null} (job 197) its watch rectangle as an rbush entry, null without one
 */
function watchEntry(id, route) {
	const w = route?.geom?.watch
	if (!Array.isArray(w)) return null
	return { minX: w[0], minY: w[1], maxX: w[2], maxY: w[3], id, t: 'watch' }
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
 * @param {Array<string|null>} keys level-1 keys to leave out (null entries are ignored)
 * @return {string} canonical JSON of data without those keys
 */
function dataJsonWithout(data, keys) {
	const drop = keys.filter((k) => k !== null && Object.prototype.hasOwnProperty.call(data, k))
	if (drop.length === 0) {
		return canonJson(data)
	}
	const copy = { ...data }
	for (const k of drop) delete copy[k]
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
	// (job 172) the reactions are a field of their own: the scene paints them in the overlay
	if (canonJson(a.data.react ?? null) !== canonJson(b.data.react ?? null)) out.add('react')
	if (dataJsonWithout(a.data, [textKey, 'react']) !== dataJsonWithout(b.data, [textKey, 'react'])) out.add('data')
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
 * @param {object|undefined} it WireItem
 * @return {boolean} (job 170) a shape without fill: style.fillOpacity 0 (a missing or
 *   invalid value counts as its default 100, filled); (job 203) never an own shape
 *   (kind image): its picture is its inside
 */
export function isUnfilledShape(it) {
	return it?.t === 'shape' && fieldValue(it, 'style.fillOpacity') === 0 && !isImageKind(fieldValue(it, 'data.kind'))
}

/**
 * @param {object|undefined} it WireItem
 * @param {{w:number, h:number}} a its absolute box
 * @return {{x:number, y:number, w:number, h:number, fs:number, lines:number, wrapW:number}|null}
 *   (job 211) the label of a symbol, BPMN event or gateway in its own coordinates
 *   (shapes.js symbolLabelBox), null for any other item or a blank text
 */
export function shapeLabelOf(it, a) {
	if (it?.t !== 'shape' || !a) return null
	return symbolLabelBox(fieldValue(it, 'data.kind'), fieldValue(it, 'data.text'), fieldValue(it, 'style.fontSize'), a.w, a.h)
}

/**
 * @param {object|undefined} it WireItem
 * @param {{w:number, h:number}} a its absolute box
 * @return {number} (job 211) how far the label of a symbol, BPMN event or gateway reaches below
 *   its box (world units, along the item's own axis); 0 without one
 */
export function labelReach(it, a) {
	const l = shapeLabelOf(it, a)
	return l ? l.y + l.h - a.h : 0
}

/**
 * @param {number} x x
 * @param {number} y y
 * @param {{x:number, y:number, w:number, h:number}|null|undefined} r rectangle (w, h ≥ 0)
 * @param {number} grow added on every side
 * @return {boolean} (job 177) r grown by grow holds (x, y); false without a valid r
 */
function inRect(x, y, r, grow) {
	if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return false
	return x >= r.x - grow && y >= r.y - grow && x <= r.x + r.w + grow && y <= r.y + r.h + grow
}

/**
 * (job 170) The empty inside of a shape without fill in its local frame: the
 * inside of its outline shrunk by `band` (rect, roundRect and unknown kinds
 * the box (band, band)–(w − band, h − band); ellipse the ellipse with the same
 * centre and the half-axes w/2 − band, h/2 − band; the polygon kinds the
 * points inside the polygon farther than band from its outline). None when
 * w or h is at most 2 · band.
 *
 * @param {unknown} kind data.kind (unknown kinds count as rect)
 * @param {number} lx local x (origin top-left of the unrotated box)
 * @param {number} ly local y
 * @param {number} w width
 * @param {number} h height
 * @param {number} band width of the border band inside the outline (world)
 * @return {boolean} the point lies in the empty inside
 */
export function inHollow(kind, lx, ly, w, h, band) {
	if (!(w > 2 * band) || !(h > 2 * band)) return false
	const mode = shapeOf(kind).hit
	if (mode === 'ellipse') {
		const dx = (lx - w / 2) / (w / 2 - band)
		const dy = (ly - h / 2) / (h / 2 - band)
		return dx * dx + dy * dy < 1
	}
	if (mode === 'polygon') {
		const pts = outlinePoints(kind, w, h)
		return pointInPolygon(lx, ly, pts) && distToPolyline(lx, ly, [...pts, pts[0], pts[1]]) > band
	}
	return lx > band && ly > band && lx < w - band && ly < h - band
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
	/** (job 195) the layout of a mind map for hit mode 'tree' (the scene's, as drawn), see setTreeLayout */
	#treeLayout = null
	/** (job 195) item object → its layout with estimateNodeSize, without a scene */
	#treeCache = new WeakMap()
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
	/** (job 197) watch rectangles of elbow connectors (connectors.elbowPlan) */
	#watch = new RBush(16)
	/** (job 197) connector → its entry in #watch @type {Map<string, IndexEntry>} */
	#watchEntries = new Map()

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
		this.#watch.clear()
		this.#watchEntries.clear()
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
		// (job 197) the items first: elbow routes ask the index for obstacles
		this.#tree.load(entries)
		const lines = []
		const watches = []
		for (const id of routed) {
			const route = this.#route(id)
			if (!route) continue
			this.#conn.set(id, route)
			const e = this.#connEntry(id, route)
			this.#entries.set(id, e)
			lines.push(e)
			const w = watchEntry(id, route)
			if (w) {
				this.#watchEntries.set(id, w)
				watches.push(w)
			}
		}
		this.#tree.load(lines)
		this.#watch.load(watches)
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
		const goneEntries = []
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
				goneEntries.push(e)
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
			// (job 211) and its entry holds the label of a symbol, BPMN event or gateway (text, kind)
			else if ((fields.has('text') || fields.has('data')) && it.t === 'shape' && (hasLabel(fieldValue(old, 'data.kind')) || hasLabel(fieldValue(it, 'data.kind')))) dirty.add(it.id)
			// a connector's route, caps and label box follow its data, style and label
			else if (isRouted(it.t)) dirty.add(it.id)
			if (fields.has('type') && isRouted(old.t) && !isRouted(it.t)) this.#dropConnState(it.id)
			if (fields.has('z') || fields.has('type')) summary.reordered = true
		}
		this.#recompute(dirty, added, summary.geometry, touched, goneEntries)
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
	 * (Job 197) The obstacles of an elbow route (connectors.js `obstacles`):
	 * a query answering the index entries ([x0, y0, x1, y1], the drawn extent)
	 * of the items that touch a rectangle, except connectors, frames and the
	 * given items (the connector's own targets). Items are where the model
	 * has them (a remote drag preview does not count).
	 *
	 * @param {Iterable<string>} [skip] items that are no obstacle
	 * @return {(x0:number, y0:number, x1:number, y1:number) => number[][]}
	 */
	obstaclesFor(skip = []) {
		const not = new Set(skip ?? [])
		return (x0, y0, x1, y1) => {
			const out = []
			for (const e of this.#tree.search({ minX: x0, minY: y0, maxX: x1, maxY: y1 })) {
				if (not.has(e.id) || !isObstacle(e.t)) continue
				const k = e.t === 'sticky' ? STICKY_PAD - STICKY_OBSTACLE_PAD : 0
				const r = [e.minX + k, e.minY + k, e.maxX - k, e.maxY - k]
				if (r[0] <= x1 && r[2] >= x0 && r[1] <= y1 && r[3] >= y0) out.push(r)
			}
			return out
		}
	}

	/**
	 * (Job 195) Where hit mode 'tree' takes the layout of a mind map from:
	 * the scene hands its layout as drawn (measured texts, a local preview);
	 * without one (null) it is mindmapLayout with estimateNodeSize.
	 *
	 * @param {((id: string) => (object|null))|null} fn layout of a mind map id, null: none
	 */
	setTreeLayout(fn) {
		this.#treeLayout = typeof fn === 'function' ? fn : null
	}

	/**
	 * @param {string} id mind map id
	 * @return {object|null} its layout for the hit test (model/mindmap.js mindmapLayout)
	 */
	treeLayoutOf(id) {
		const it = this.#items.get(id)
		if (!it) return null
		if (this.#treeLayout !== null) {
			const l = this.#treeLayout(id)
			if (l) return l
		}
		let l = this.#treeCache.get(it)
		if (!l) {
			l = mindmapLayout(it)
			this.#treeCache.set(it, l)
		}
		return l
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
	 * a border band, the inside is empty canvas ((job 199) but for the head
	 * column of a frame with lanes, model/lanes.js laneHeadW, and (job 208) the
	 * head row of its columns, colTop); 'shape' = SHAPES[kind].hit;
	 * 'line' = the routed connector line, its caps and its label box; (job
	 * 188) 'pad' = (0, 0)–(w, h + 12) of a note pad (model/pad.js, job 263); (job
	 * 195) 'tree' = a node or a fold dot of a mind map (treeLayoutOf); (job 273)
	 * 'ink' = the line of a pen stroke (model/ink.js distToStroke).
	 *
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {number} [tolWorld] tolerance in world units (4 px / scale for a mouse, 12 px / scale for touch)
	 * @param {{edgeWorld?:number, accept?:((id:string) => boolean), hollow?:boolean,
	 *          textRect?:((id:string) => ({x:number, y:number, w:number, h:number}|null)),
	 *          tabWidth?:((id:string) => (number|null))}} [opts] width of the frame
	 *   border band in world units (the scene passes FRAME_EDGE_HIT_PX / scale; default
	 *   FRAME_EDGE_HIT_PX); accept: only items it accepts count (e.g. bindable targets);
	 *   hollow (job 170): a shape without fill (isUnfilledShape) hits only in its border band,
	 *   its inside shrunk by edgeWorld + tolerance + half its stroke is empty canvas (inHollow),
	 *   so the point goes on to the items below it; textRect (job 177, only with hollow): the
	 *   text block of such a shape in its own coordinates (origin top-left of the unrotated
	 *   box) or null, asked only for a point in its empty inside: that block grown by the
	 *   tolerance on every side (its text zone) hits the shape too; tabWidth (job 252): the
	 *   width of the tab a frame shows above its top edge (null or ≤ 0: none); then above the
	 *   frame only that tab, widened by the tolerance (at most the frame's width), hits, not
	 *   the whole title band
	 * @return {string|null} item id
	 */
	hitTest(wx, wy, tolWorld = 0, opts = {}) {
		const tol = Number.isFinite(tolWorld) && tolWorld > 0 ? tolWorld : 0
		const edge = Number.isFinite(opts.edgeWorld) && opts.edgeWorld >= 0 ? opts.edgeWorld : FRAME_EDGE_HIT_PX
		const accept = typeof opts.accept === 'function' ? opts.accept : null
		const hollow = opts.hollow === true
		const textRect = hollow && typeof opts.textRect === 'function' ? opts.textRect : null
		const tabWidth = typeof opts.tabWidth === 'function' ? opts.tabWidth : null
		const pad = tol + edge
		const cands = this.#tree.search({ minX: wx - pad, minY: wy - pad, maxX: wx + pad, maxY: wy + pad })
		if (cands.length === 0) {
			return null
		}
		cands.sort((a, b) => this.compareOrder(b.id, a.id))
		for (const e of cands) {
			// job 275: a covered note (private writing) is never picked: clicks pass through it
			if (isCovered(this.get(e.id))) continue
			if (accept !== null && !accept(e.id)) continue
			if (this.#hitItem(e.id, wx, wy, tol, edge, hollow, textRect, tabWidth)) {
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
			// job 275: nor caught by a marquee or a new frame
			if (!b || isCovered(this.get(e.id))) continue
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
		this.#dropWatch(id)
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
	 * @param {IndexEntry[]} [goneEntries] (job 197) the index entries of the removed items
	 */
	#recompute(dirty, added, geometry, gone = new Set(), goneEntries = []) {
		const all = new Set()
		for (const id of dirty) {
			if (all.has(id)) continue
			all.add(id)
			for (const d of this.descendantsOf(id)) all.add(d)
		}
		const moved = new Set(gone)
		const routed = new Set()
		// (job 197) index entries of obstacles before and after this change
		const shifted = [...goneEntries]
		for (const id of all) {
			const it = this.#items.get(id)
			if (!it) continue
			const before = this.#abs.get(id)
			const a = this.#computeAbs(id)
			this.#abs.set(id, a)
			const old = this.#entries.get(id)
			if (isRouted(it.t)) {
				if (old && !isRouted(old.t)) shifted.push(old)
				routed.add(id)
				continue
			}
			this.#reindex(id, a)
			const now = this.#entries.get(id)
			if (!old || old.t !== now.t || old.minX !== now.minX || old.minY !== now.minY || old.maxX !== now.maxX || old.maxY !== now.maxY) {
				if (old) shifted.push(old)
				shifted.push(now)
			}
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
		for (const e of shifted) {
			if (!isObstacle(e.t)) continue
			for (const w of this.#watch.search(e)) {
				if (this.#items.has(w.id)) routed.add(w.id)
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
		const targets = []
		for (const which of ENDS) {
			const own = local && hasOwn(local, which)
			let ep = own ? local[which] : (fieldValue(it, 'data.' + which) ?? null)
			if (ep === null) return null
			if (hasOwn(ep, 'item')) {
				const box = this.#targetBox(ep.item)
				ends.push({ box, ep, point: box ? null : (last?.[which] ?? null) })
				targets.push(ep.item)
				continue
			}
			if (shift && !own) ep = { x: ep.x + shift.dx, y: ep.y + shift.dy }
			ends.push({ box: null, ep, point: null })
		}
		const route = fieldValue(it, 'data.route')
		const geom = routeConnector(ends[0], ends[1], route, route === 'elbow' ? { obstacles: this.obstaclesFor(targets) } : {})
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

	/** @param {string} id connector whose watch rectangle goes (job 197) */
	#dropWatch(id) {
		const w = this.#watchEntries.get(id)
		if (!w) return
		this.#watch.remove(w)
		this.#watchEntries.delete(id)
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
		this.#dropWatch(id)
		const w = route ? watchEntry(id, route) : null
		if (w) {
			this.#watchEntries.set(id, w)
			this.#watch.insert(w)
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
		const pad = typeInfo(it.t).pad
		// (job 188) a note pad with its sheets (never rotated: rotatable false); job 263: plus the shadow below
		const e = pad === 'band' ? padExtent(a.w, a.h) : a
		const b = rotatedBBox(a.x, a.y, e.w, e.h, pad === 'band' ? 0 : a.r)
		let minX = Math.min(b[0], b[2])
		let minY = Math.min(b[1], b[3])
		let maxX = Math.max(b[0], b[2])
		let maxY = Math.max(b[1], b[3])
		if (pad === 'title') {
			minX -= FRAME_PAD
			maxX += FRAME_PAD
			maxY += FRAME_PAD
			minY -= Math.max(FRAME_TITLE_PAD, FRAME_TITLE_BAND)
		} else {
			// (job 263) a note pad's bottom sheet casts the note shadow too
			const d = pad === 'shadow' || pad === 'band' ? STICKY_PAD : pad === 'stroke' ? halfStroke(it) : 0
			minX -= d
			minY -= d
			maxX += d
			maxY += d
		}
		// (job 211) the label below a symbol, BPMN event or gateway, turned with the box around its centre
		const l = shapeLabelOf(it, a)
		if (l) {
			const r = (a.r || 0) * Math.PI / 180
			const cos = Math.cos(r)
			const sin = Math.sin(r)
			const cx = a.x + a.w / 2
			const cy = a.y + a.h / 2
			for (const [lx, ly] of [[l.x, l.y], [l.x + l.w, l.y], [l.x, l.y + l.h], [l.x + l.w, l.y + l.h]]) {
				const dx = lx - a.w / 2
				const dy = ly - a.h / 2
				const wx = cx + dx * cos - dy * sin
				const wy = cy + dx * sin + dy * cos
				minX = Math.min(minX, wx)
				minY = Math.min(minY, wy)
				maxX = Math.max(maxX, wx)
				maxY = Math.max(maxY, wy)
			}
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
	 * @param {boolean} hollow (job 170) a shape without fill hits only in its border band
	 * @param {((id:string) => object|null)|null} textRect (job 177) and in the text zone of this text block
	 * @param {((id:string) => number|null)|null} tabWidth (job 252) above a frame only its tab this wide
	 *   hits; null: the whole title band
	 * @return {boolean}
	 */
	#hitItem(id, wx, wy, tol, edge, hollow, textRect, tabWidth) {
		const it = this.#items.get(id)
		const mode = typeInfo(it.t).hit
		if (mode === 'line') {
			return this.#hitLine(id, it, wx, wy, tol)
		}
		const a = this.#abs.get(id)
		const [lx, ly] = toLocal(wx, wy, a.x, a.y, a.w, a.h, a.r)
		if (mode === 'shape') {
			const kind = fieldValue(it, 'data.kind')
			const half = halfStroke(it)
			// (job 211) the label below a symbol, BPMN event or gateway, filled or not
			if (inRect(lx, ly, shapeLabelOf(it, a), tol)) return true
			if (!hitShape(kind, lx, ly, a.w, a.h, tol + half)) return false
			// (job 170) the empty inside of a shape without fill is canvas, like a frame's
			if (!hollow || !isUnfilledShape(it) || !inHollow(kind, lx, ly, a.w, a.h, edge + tol + half)) return true
			// (job 177) except its text zone, like a frame's title
			return textRect !== null && inRect(lx, ly, textRect(id), tol)
		}
		if (mode === 'pad') {
			// (job 188) the box and the sheets of a note pad (job 263: the binding lies on the box)
			return padPartAt(lx, ly, a.w, a.h, tol) !== null
		}
		if (mode === 'ink') {
			// (job 273) only the line of a pen stroke; the rest of its box is empty canvas
			return distToStroke(pointsOf(it.data?.points), lx, ly) <= tol + fieldValue(it, 'style.strokeWidth') / 2
		}
		if (mode === 'tree') {
			// (job 195) only the nodes and fold dots of a mind map; the rest of its box is empty canvas
			return nodeAtLayout(this.treeLayoutOf(id), lx, ly, tol) !== null
		}
		if (mode === 'frameEdge') {
			if (ly >= -FRAME_TITLE_BAND - tol && ly < 0 && lx >= -tol) {
				// (job 252) with tabWidth only the visible tab hits (none: nothing above the frame)
				const tw = tabWidth === null ? a.w : tabWidth(id)
				if (typeof tw === 'number' && Number.isFinite(tw) && tw > 0 && lx <= Math.min(tw, a.w) + tol) {
					return true
				}
			}
			// (job 199) the head column of a frame with lanes (job 208: none for a single lane without a name)
			const hw = laneHeadW(it, a.w)
			if (hasLanes(it) && hw > 0 && lx >= -tol && lx <= hw + tol && ly >= 0 && ly <= a.h + tol) {
				return true
			}
			// (job 208) and the head row of its columns
			const top = colTop(it, a.h)
			if (top > 0 && lx >= -tol && lx <= a.w + tol && ly >= 0 && ly <= top + tol) {
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
