/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * User actions → ops + inverse ops (SPEC-M0 §6.5, v2 in SPEC-M1 §6.5.2).
 * Pure: reads the SceneModel (§6.2), writes nothing, no side effects.
 * BoardSession sends `ops`, keeps `inverse` on the undo stack. The actions
 * never measure text: BoardSession measures the target state of `text`
 * items with scene.measureTextHeight() and passes the heights in (§4.7
 * rule 13).
 *
 * Placement is ONE register {x, y, parent} (§4.7 rule 2a): every placement op
 * and every inverse carries all three. x/y are relative to the parent. M0
 * actions round to 0.01 with round2(); the M1 actions (create, transform,
 * arrange, paste, duplicate, notes) use q(v, 100) from geometry.js (§4.7).
 *
 * Connectors (placement 'none', rule 12) never get x/y/w/h/r/parent patches:
 * moving them moves their free ends, transforming them maps their free ends.
 *
 * Round 1b (SPEC-M1 §6.5.2, §4.7 rule 14):
 * - connectItems: one put of a connector (both ends in their stored form,
 *   normalizeEndpoint), route and end cap from the tool options
 * - retargetEnd: one patch of a whole end (data.start/data.end is ONE
 *   register; a sub-path patch would be `bad`)
 * - deleteItems v2: every connector bound to a deleted item (and not deleted
 *   itself) gets its end as a free point at the visible docking point BEFORE
 *   the removes; the inverse revives first, then binds again (one undo step)
 * - moveItems v2: a connector moves its free ends only when every bound end
 *   follows a moved item; alone it cannot be dragged
 *
 * M2 (SPEC-M1 §1.2 "Ausrichten"): alignItems moves the topmost non-connector
 * items of the selection to one edge or centre line of their union
 * (ALIGN_EDGES), with frame membership like moveItems.
 *
 * M2 (SPEC-M1 §1.2 "Verteilen"): distributeItems spreads the same items
 * (alignableIds, at least three) along one axis (DISTRIBUTE_AXES) to equal
 * gaps between neighbouring hulls; the two outermost stay put. With too
 * little room for that, equal steps between the centres instead.
 *
 * M2 (SPEC-M1 §1.2 "Aufräumen"): tidyItems snaps the same items
 * (alignableIds, at least two) to an exact grid: rows and columns from the
 * hull centres (order kept, empty cells stay empty), one whole-unit gap per
 * axis from today's mean track centres, each hull centred in its cell; the
 * top-left corner of the selection stays (rounded to whole units).
 *
 * M2 (SPEC-M1 §1.2 "(R20) Sperren"): lockItems and unlockItems give one
 * lock patch per item ({lock: lockValue(me)} / {lock: null}, model/locks.js)
 * with the opposite patch as inverse; together one undo step. Only items
 * that are not locked are locked, only items me may unlock are unlocked.
 *
 * M2 (SPEC-M1 §1.2 "(R20) Gruppieren", model/groups.js):
 * - groupItems: one patch {group: g} per item of C (groupPlan: the selection
 *   with the members of its groups, without connectors) under a new id g,
 *   the inverse restores each old group; nothing when blocked ('frame',
 *   'locked', 'parent'), for fewer than two items or for exactly one group.
 *   ungroupItems: {group: null} for every member of the selection's groups
 *   (blocked 'locked'), inverse {group: g}. One undo step each.
 * - deleteItems: a group left with one unlocked member gets {group: null}
 *   on it before the removes (inverse {group: g} after the revives); the
 *   revive puts carry p.group. copyPayload writes `group` per item;
 *   pasteItems (and duplicateItems) give items with the same group a new
 *   common id (two at least, all groupable, the same payload parent) and
 *   their roots one parent: the container under the centre of their
 *   shifted union.
 * - moveItems: a fully dragged group gets one parent, the container under
 *   the centre of the union of the new boxes; a member of a group that is
 *   not fully dragged keeps its parent. alignableIds gives blocks (a fully
 *   selected group, or a single item); alignItems, distributeItems and
 *   tidyItems shift every member of a block by the same amount, measured on
 *   the block's hull, with one parent per block. membership (frame
 *   transform) frees or adopts a group only as a whole, and so does a frame
 *   drawn from a rect (createItem).
 */
import { normalizeEndpoint, anchorPoint, remapEndpoint } from '../model/connectors.js'
import { q, rotatedBBox } from '../model/geometry.js'
import { blocksOf, groupOf, groupPlan, isOneGroup, movableIds, ungroupPlan, wholeGroups } from '../model/groups.js'
import { ULID_RE, ulid } from '../model/ids.js'
import { isLocked, lockValue, mayUnlock } from '../model/locks.js'
import { getPath, setPath } from '../model/paths.js'
import { canBeChildOf, checkField, fieldRule, isBindable, isGroupable, typeInfo, TYPES } from '../model/registry.js'
import { nearestFrameFill } from '../model/tokens.js'
import { keyBetween, keysBetween } from '../model/zorder.js'
import { wellFormed } from '../util/unicode.js'

/** Most items of one paste (SPEC-M1 §4.8 PASTE_MAX, client only). */
export const PASTE_MAX = 1000
/** Most live items of a board when the initial state has no limits.maxItems (§4.8). */
export const DEFAULT_MAX_ITEMS = 5000
/** Grid step of notes made from plain text (§6.5.2). */
export const NOTE_GRID = 220
/** Gap between a note and the next one of a series entry (§6.5.1). */
export const SERIES_GAP = 20
/** Edges and centre lines of "Align" (alignItems); the context bar reads this list. */
export const ALIGN_EDGES = Object.freeze(['left', 'center', 'right', 'top', 'middle', 'bottom'])
/** Axes of "Distribute" (distributeItems); the context bar reads this list. */
export const DISTRIBUTE_AXES = Object.freeze(['horizontal', 'vertical'])
/**
 * An item whose shift of "Align", "Distribute" or "Tidy up" (alignItems,
 * distributeItems, tidyItems) is at most this (world units, plus float
 * noise) on both axes already counts as in place (withinTolerance). For
 * "Align" this only decides whether the click is empty (every item in
 * place); within an effective click such an item snaps onto the target as
 * well (shiftBlock with snap: a group block as a whole, a single item
 * through shiftItem). Positions sit on the 0.01 grid, so the
 * hull of a rotated item (or the centre of an odd width) only reaches its
 * target to ±0.005; without the tolerance a second click on the same command
 * would move some item by 0.01 again, and again (one invisible undo step per
 * click). The float margin is 1e-6: at |v| ≈ 1e7 (the server's limit)
 * neighbouring doubles lie about 1.9e-9 apart (3.7e-9 for hull edges up to
 * 2e7), and hull, sum with the parent and round2 add a few such steps of
 * noise; 1e-6 lies far above that and far below anything visible.
 */
const ALIGN_TOLERANCE = 0.01 + 1e-6
/**
 * Float noise of the gap of "Distribute": equal gaps from g ≥ −this on.
 * Items packed edge to edge (g = 0 in decimals) give g = ±3e-14 in floats,
 * and the sign may change once the inner items have moved; at a plain g ≥ 0
 * a second click would then switch to equal centre steps and move items
 * again (and back on the next). Unrotated items on the 0.01 grid give
 * g = 0 or |g| ≥ 0.01 / (n − 1), so no real overlap falls inside the margin.
 */
const GAP_NOISE = 1e-6

/**
 * @param {number} dx shift of "Align", "Distribute" or "Tidy up"
 * @param {number} dy shift
 * @return {boolean} both within ALIGN_TOLERANCE: the item counts as in place
 */
function withinTolerance(dx, dy) {
	return Math.abs(dx) <= ALIGN_TOLERANCE && Math.abs(dy) <= ALIGN_TOLERANCE
}

/**
 * @param {number} v value
 * @return {number} rounded to 0.01
 */
export function round2(v) {
	return Math.round(v * 100) / 100
}

/**
 * @param {number} v value
 * @return {number} q(v, 100): the 0.01 grid of client positions (§4.7)
 */
function q2(v) {
	return q(v, 100)
}

const clone = (v) => structuredClone(v)

/**
 * @param {unknown} v value
 * @return {boolean} finite number
 */
function isNum(v) {
	return typeof v === 'number' && Number.isFinite(v)
}

/**
 * @param {unknown} v value
 * @return {boolean} plain map (not null, not a list)
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {Map|object|null|undefined} m Map or plain object
 * @param {string} k key
 * @return {any} value
 */
function pick(m, k) {
	if (m instanceof Map) {
		return m.get(k)
	}
	return isMap(m) && Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined
}

/**
 * @param {object} model SceneModel
 * @param {string|null} id container id or null
 * @return {{x: number, y: number}|null} absolute top-left, {0,0} for null, null when unknown
 */
function absOf(model, id) {
	if (id === null || id === undefined) {
		return { x: 0, y: 0 }
	}
	if (!model.has(id)) {
		return null
	}
	const a = model.abs(id)
	return a ? { x: a.x, y: a.y } : null
}

/**
 * Container that would receive an item of type t whose box has its center at
 * (cx, cy), or null.
 *
 * @param {object} model SceneModel
 * @param {string} t type of the item
 * @param {number} cx center x (world)
 * @param {number} cy center y (world)
 * @param {Set<string>} exclude ids that cannot be the parent
 * @return {string|null}
 */
function containerFor(model, t, cx, cy, exclude) {
	if (typeInfo(t).container || typeInfo(t).placement === 'none') {
		return null
	}
	const c = model.topContainerAt(cx, cy, exclude)
	if (c === null || c === undefined || !model.has(c)) {
		return null
	}
	return canBeChildOf(t, model.get(c).t) ? c : null
}

/**
 * Placement patch for an absolute position under a parent (M0 rounding).
 *
 * @param {object} model SceneModel
 * @param {{x: number, y: number}} absPos absolute top-left
 * @param {string|null} parent parent id or null
 * @return {{x: number, y: number, parent: string|null}}
 */
function placement(model, absPos, parent) {
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	return { x: round2(absPos.x - pa.x), y: round2(absPos.y - pa.y), parent }
}

/**
 * @param {string} t type
 * @param {number} v width or height
 * @return {number} v clamped into TYPES[t].size
 */
function clampSize(t, v) {
	const size = typeInfo(t).size
	return Math.min(size[1], Math.max(size[0], v))
}

/**
 * @param {number} r degrees
 * @return {number} the same direction in [0, 360) on the 0.01 grid, never -0
 */
function normAngle(r) {
	if (!isNum(r)) {
		return 0
	}
	let d = q2(((r % 360) + 360) % 360)
	if (d >= 360) {
		d -= 360
	}
	return d + 0
}

/**
 * Field values of an intent (data/style of a create, tool options) merged
 * onto the defaults: every typed field (data.kind, style.fill …) only when
 * it passes its rule, stored in its normalised form.
 *
 * @param {string} t type
 * @param {'data'|'style'} root root container
 * @param {object} base defaults (cloned)
 * @param {object|undefined} extra values of the intent
 * @return {object} merged map
 */
function mergeFields(t, root, base, extra) {
	const out = clone(base ?? {})
	if (!isMap(extra)) {
		return out
	}
	for (const k of Object.keys(extra)) {
		const path = root + '.' + k
		if (fieldRule(t, path) === null) {
			continue
		}
		const v = extra[k]
		if (v === null || v === undefined) {
			delete out[k]
			continue
		}
		const c = checkField(t, path, v)
		if (c.ok) {
			out[k] = c.norm
		}
	}
	return out
}

/**
 * New item (SPEC-M0 §6.5, SPEC-M1 §6.5.2): sticky, frame, shape or text.
 *
 * - box: `rect` (dragged out; w/h clamped to the type's size) or the default
 *   size centered on `at`; a text item takes only the width of `rect` (its
 *   height is measured, rule 13) and, without rect, starts at the click
 *   (left edge at at.x, vertically centered)
 * - data/style: registry defaults plus the intent's values (tool options,
 *   series entry), each typed field only when it passes its rule
 * - parent: topmost container under the center (non-containers)
 * - a frame from `rect` adopts every top-level non-container item whose box
 *   lies completely inside; a group (M2, R20 Gruppieren) only as a whole
 *   (every member inside), like membership after a transform
 * - edit: the editor should open (note, shape, text; SPEC-M1 §6.3)
 *
 * Connectors are created with connectItems (round 1b), never here.
 *
 * @param {object} model SceneModel
 * @param {{t: string, at?: {x: number, y: number}, rect?: ({x,y,w,h}|null), data?: object, style?: object}} intent create intent
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean}}
 */
export function createItem(model, { t, at, rect = null, data, style }, newId = ulid) {
	const info = TYPES[t]
	if (!info || info.placement !== 'box') {
		return { ops: [], inverse: [], selectIds: [], edit: false }
	}
	const d = info.defaults
	const id = newId()
	let box
	const p = at && isNum(at.x) && isNum(at.y) ? at : { x: 0, y: 0 }
	if (rect && isNum(rect.w) && isNum(rect.h) && rect.w > 0 && (rect.h > 0 || t === 'text')) {
		box = { x: rect.x, y: rect.y, w: rect.w, h: t === 'text' ? d.h : rect.h }
	} else if (t === 'text') {
		box = { x: p.x, y: p.y - d.h / 2, w: d.w, h: d.h }
	} else {
		box = { x: p.x - d.w / 2, y: p.y - d.h / 2, w: d.w, h: d.h }
	}
	box.w = clampSize(t, box.w)
	box.h = clampSize(t, box.h)
	const z = keyBetween(model.maxZ(info.layer), null)
	let parent = null
	if (!info.container) {
		parent = containerFor(model, t, box.x + box.w / 2, box.y + box.h / 2, new Set())
	}
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	const put = {
		o: 'put',
		id,
		t,
		p: {
			x: q2(box.x - pa.x),
			y: q2(box.y - pa.y),
			w: q2(box.w),
			h: q2(box.h),
			r: 0,
			z,
			parent,
			data: mergeFields(t, 'data', d.data, data),
			style: mergeFields(t, 'style', d.style, style),
		},
	}
	const ops = [put]
	const inverse = []
	if (info.container && rect) {
		const inside = new Set(model.queryRect({ x: box.x, y: box.y, w: box.w, h: box.h }, 'contain') ?? [])
		const adoptable = (cid) => {
			if (cid === id || !model.has(cid)) {
				return false
			}
			const it = model.get(cid)
			const parentId = it.parent ?? null
			return !(parentId !== null && model.has(parentId)) && !typeInfo(it.t).container && canBeChildOf(it.t, t)
		}
		// a group (M2, R20 Gruppieren) only as a whole: every member inside and adoptable (decided once per group)
		const groupOk = new Map()
		for (const cid of inside) {
			if (!adoptable(cid)) {
				continue
			}
			const g = groupOf(model, cid)
			if (g !== null) {
				if (!groupOk.has(g)) {
					groupOk.set(g, model.membersOf(g).every((m) => inside.has(m) && adoptable(m)))
				}
				if (!groupOk.get(g)) {
					continue
				}
			}
			const it = model.get(cid)
			const a = model.abs(cid)
			ops.push({ o: 'patch', id: cid, p: { x: q2(a.x - box.x), y: q2(a.y - box.y), parent: id } })
			inverse.push({ o: 'patch', id: cid, p: { x: it.x, y: it.y, parent: it.parent ?? null } })
		}
	}
	inverse.push({ o: 'remove', id })
	return { ops, inverse, selectIds: [id], edit: info.textPath !== null && t !== 'frame' }
}

/**
 * Drop after a drag (§6.5). The new absolute position is computed from the
 * origin, never from the current model: abs(origin.parent) + origin + (dx, dy).
 * New parent = topmost fitting container under the center of the new box,
 * excluding the dragged items and their descendants.
 *
 * v2 (SPEC-M1 §6.5.2): a connector moves only its free ends by (dx, dy); a
 * connector with a bound end follows its targets by itself (a bound end is
 * never patched here). A connector with a bound end whose target is not
 * moved (not in ids, not below a moved container) is not draggable alone:
 * it gets no patch at all, so its free end does not stretch away from it.
 *
 * Groups (M2, R20 Gruppieren): the members of a group that lies fully in
 * ids get ONE parent, the topmost fitting container under the centre of
 * the union of their new boxes (so a group moves into or out of a frame as
 * a whole); a member of a group that is not fully in ids keeps its parent
 * (only x/y change).
 *
 * @param {object} model SceneModel (still at the dragged position)
 * @param {{ids: string[], dx: number, dy: number, origin: Map<string, {x: number, y: number, parent: string|null}>}} intent move intent
 * @return {{ops: object[], inverse: object[]}}
 */
export function moveItems(model, { ids, dx, dy, origin }) {
	const ops = []
	const inverse = []
	const exclude = new Set()
	for (const id of ids) {
		exclude.add(id)
		for (const d of model.descendantsOf(id) ?? []) {
			exclude.add(d)
		}
	}
	// the new absolute top-left from the origin; the dragged position when the old parent vanished
	const target = (id, o) => {
		const pa = absOf(model, o.parent ?? null)
		if (pa !== null) {
			return { x: pa.x + o.x + dx, y: pa.y + o.y + dy, gone: false }
		}
		const a = model.abs(id)
		return { x: a.x, y: a.y, gone: true }
	}
	// one parent per fully dragged group: the container under the centre of their new union
	const whole = new Set(wholeGroups(model, ids))
	const groupParent = new Map()
	for (const g of whole) {
		const boxes = []
		let t = null
		for (const m of model.membersOf(g)) {
			const o = pick(origin, m)
			if (!o) {
				continue
			}
			const it = model.get(m)
			const at = target(m, o)
			boxes.push({ x: at.x, y: at.y, w: it.w, h: it.h, r: it.r ?? 0 })
			t = t ?? it.t
		}
		const u = unionOf(boxes)
		groupParent.set(g, u && t !== null ? containerFor(model, t, u.x + u.w / 2, u.y + u.h / 2, exclude) : null)
	}
	for (const id of ids) {
		if (!model.has(id)) {
			continue
		}
		const item = model.get(id)
		if (typeInfo(item.t).placement === 'none') {
			if (!boundEndsFollow(item, exclude)) {
				continue
			}
			const r = moveFreeEnds(item, dx, dy)
			if (r) {
				ops.push(r.op)
				inverse.push(r.inv)
			}
			continue
		}
		const o = pick(origin, id)
		if (!o) {
			continue
		}
		const oParent = o.parent ?? null
		// The old parent may have vanished during the drag: the model still
		// holds the dragged position then (target).
		const at = target(id, o)
		const absPos = { x: at.x, y: at.y }
		const g = groupOf(model, id)
		let parent
		if (g !== null && whole.has(g)) {
			parent = groupParent.get(g) ?? null
		} else if (g !== null) {
			// a member of a group that is not fully dragged keeps its parent
			parent = at.gone ? null : oParent
		} else {
			parent = containerFor(model, item.t, absPos.x + item.w / 2, absPos.y + item.h / 2, exclude)
		}
		const p = placement(model, absPos, parent)
		if (p.x === o.x && p.y === o.y && p.parent === oParent) {
			continue
		}
		ops.push({ o: 'patch', id, p })
		inverse.push({ o: 'patch', id, p: { x: o.x, y: o.y, parent: oParent } })
	}
	return { ops, inverse }
}

/**
 * @param {object} item connector WireItem
 * @param {number} dx shift x
 * @param {number} dy shift y
 * @return {{op: object, inv: object}|null} patch of its free ends, null when none
 */
function moveFreeEnds(item, dx, dy) {
	const p = {}
	const inv = {}
	for (const which of ['start', 'end']) {
		const ep = item.data?.[which]
		if (isMap(ep) && isNum(ep.x) && isNum(ep.y) && !('item' in ep)) {
			p['data.' + which] = { x: q2(ep.x + dx), y: q2(ep.y + dy) }
			inv['data.' + which] = { x: ep.x, y: ep.y }
		}
	}
	if (Object.keys(p).length === 0 || (dx === 0 && dy === 0)) {
		return null
	}
	return { op: { o: 'patch', id: item.id, p }, inv: { o: 'patch', id: item.id, p: inv } }
}

/**
 * @param {object} item connector WireItem
 * @param {Set<string>} moving ids that move (with their descendants)
 * @return {boolean} every bound end of the connector targets a moving item
 */
function boundEndsFollow(item, moving) {
	for (const which of ['start', 'end']) {
		const ep = item.data?.[which]
		if (isMap(ep) && typeof ep.item === 'string' && !moving.has(ep.item)) {
			return false
		}
	}
	return true
}

/**
 * @param {unknown} ep end as given by the scene (connect/retarget intent)
 * @return {object|null} the stored form (normalizeEndpoint); a free end on
 *   the 0.01 grid of client positions (§4.7); null when invalid
 */
function storedEnd(ep) {
	const norm = normalizeEndpoint(ep)
	if (norm === null || 'item' in norm) {
		return norm
	}
	return normalizeEndpoint({ x: q2(norm.x), y: q2(norm.y) })
}

/**
 * @param {object} model SceneModel
 * @param {object} ep stored end
 * @param {string|null} self id of the connector itself (never a target)
 * @return {boolean} a free end, or a bound end whose target the model has
 *   and may be bound to (rule 14: never the connector itself, a frame, a
 *   connector or an unknown type)
 */
function endTargetOk(model, ep, self) {
	if (!('item' in ep)) {
		return true
	}
	return ep.item !== self && model.has(ep.item) && isBindable(model.get(ep.item).t)
}

/**
 * New connector (intent connect, the "+" handle, or "Connect" with two
 * selected items; SPEC-M1 §6.3, §6.5.2): one put with x = y = w = h = r = 0
 * and parent null (rule 12), z above the content, both ends in their stored
 * form (ax/ay with q(v, 10000), the server's normalisation, so the local
 * value equals the stored one), data.route and style.endCap from the tool
 * options when they pass their rules (else the registry defaults, which
 * the put stores). Nothing for an invalid end, a bound end on an item the
 * model does not have or that cannot be bound, or two equal ends.
 *
 * @param {object} model SceneModel
 * @param {{start: object, end: object, route?: string, endCap?: string}} intent connect intent
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[]}}
 */
export function connectItems(model, { start, end, route, endCap } = {}, newId = ulid) {
	const none = { ops: [], inverse: [], selectIds: [] }
	const s = storedEnd(start)
	const e = storedEnd(end)
	if (s === null || e === null || !endTargetOk(model, s, null) || !endTargetOk(model, e, null) || same(s, e)) {
		return none
	}
	const info = TYPES.connector
	const id = newId()
	// an option that is not given keeps the default (mergeFields deletes a field given as null/undefined)
	const data = mergeFields('connector', 'data', info.defaults.data, route === undefined || route === null ? {} : { route })
	data.start = s
	data.end = e
	const put = {
		o: 'put',
		id,
		t: 'connector',
		p: {
			x: 0,
			y: 0,
			w: 0,
			h: 0,
			r: 0,
			z: keyBetween(model.maxZ(info.layer), null),
			parent: null,
			data,
			style: mergeFields('connector', 'style', info.defaults.style, endCap === undefined || endCap === null ? {} : { endCap }),
		},
	}
	return { ops: [put], inverse: [{ o: 'remove', id }], selectIds: [id] }
}

/**
 * Re-targets one end of a connector (intent retarget: an end handle was
 * dragged; SPEC-M1 §6.3, §6.5.2). data.start and data.end are ONE register
 * each (rule 14): the patch carries the whole end, never a sub-path. The
 * inverse restores `before` (the end when the drag started) or, without a
 * valid one, the model's current end. Nothing for a value that is invalid,
 * names the connector itself or an item that cannot be bound, equals the
 * end before, or equals the other end (a connector of zero length, like
 * connectItems refuses it).
 *
 * @param {object} model SceneModel
 * @param {{id: string, which: 'start'|'end', value: object, before?: object}} intent retarget intent
 * @return {{ops: object[], inverse: object[]}}
 */
export function retargetEnd(model, { id, which, value, before } = {}) {
	const none = { ops: [], inverse: [] }
	if (!model.has(id) || (which !== 'start' && which !== 'end')) {
		return none
	}
	const item = model.get(id)
	if (typeInfo(item.t).placement !== 'none') {
		return none
	}
	const v = storedEnd(value)
	if (v === null || !endTargetOk(model, v, id)) {
		return none
	}
	const path = 'data.' + which
	const old = normalizeEndpoint(before) ?? normalizeEndpoint(getPath(item, path))
	const other = normalizeEndpoint(getPath(item, which === 'start' ? 'data.end' : 'data.start'))
	if (old === null || same(old, v) || (other !== null && same(other, v))) {
		return none
	}
	return {
		ops: [{ o: 'patch', id, p: { [path]: v } }],
		inverse: [{ o: 'patch', id, p: { [path]: old } }],
	}
}

/**
 * Where a bound end is drawn now: the routed geometry of the connector
 * (`geom`, model.geometryOf) or, without one, the anchor point of the target
 * box (an 'auto' end then lands in the box centre, like the server's own
 * release).
 *
 * @param {object} model SceneModel
 * @param {(id: string) => object|null} geom routed geometry per connector
 * @param {string} id connector id
 * @param {'start'|'end'} which end
 * @param {object} ep the bound end
 * @return {{x: number, y: number}|null} on the 0.01 grid
 */
function dockingPoint(model, geom, id, which, ep) {
	let g = null
	try {
		g = typeof geom === 'function' ? geom(id) : null
	} catch (e) {
		g = null
	}
	const at = g && isMap(g[which]) && isNum(g[which].x) && isNum(g[which].y) ? g[which] : null
	if (at) {
		return { x: q2(at.x), y: q2(at.y) }
	}
	const pt = targetAnchor(model, ep)
	return pt ? { x: q2(pt.x), y: q2(pt.y) } : null
}

/**
 * @param {object} model SceneModel
 * @param {object} ep bound end
 * @return {{x: number, y: number}|null} anchor point of its target's absolute box (rule 14 formula)
 */
function targetAnchor(model, ep) {
	if (!isMap(ep) || typeof ep.item !== 'string' || !model.has(ep.item)) {
		return null
	}
	const a = model.abs(ep.item)
	if (!a) {
		return null
	}
	const pt = anchorPoint({ x: a.x, y: a.y, w: a.w, h: a.h, r: a.r ?? 0 }, ep)
	return pt && isNum(pt.x) && isNum(pt.y) ? { x: pt.x, y: pt.y } : null
}

/**
 * @param {object} model SceneModel
 * @param {Set<string>} set ids
 * @return {string[]} live connectors of the model bound to one of the ids
 */
function connectorsBoundTo(model, set) {
	const out = []
	for (const c of connectorCandidates(model, set)) {
		if (!model.has(c)) {
			continue
		}
		const it = model.get(c)
		if (typeInfo(it.t).placement !== 'none') {
			continue
		}
		if (['start', 'end'].some((w) => isMap(it.data?.[w]) && set.has(it.data[w].item))) {
			out.push(c)
		}
	}
	return out
}

/**
 * Delete (§6.5, F2): children of a deleted container that are not deleted
 * themselves are freed first (absolute position kept), then the removes.
 * Inverse: revive puts with the old states (containers first), then patches
 * that hang the freed children back.
 *
 * v2 (SPEC-M1 §6.5.2, §4.7 rule 14): every connector that is not deleted
 * itself and has an end bound to a deleted item gets that end as a free
 * point at its visible docking point (`geom`, model.geometryOf: the routed
 * line; without geometry the target's anchor point), in ONE patch per
 * connector, BEFORE the removes; the server then has nothing to release.
 * The inverse binds the end again (the stored end) after the revive puts,
 * so undo is one step and the target is alive when the binding arrives.
 * Connectors bound to the freed children of a deleted frame stay bound.
 *
 * Groups (M2, R20 Gruppieren): a group of which exactly one live member is
 * left, and that member is not locked, gets {group: null} on it before the
 * removes; the inverse sets {group: g} again after the revive puts. With a
 * locked rest nothing is sent (the server dissolves it). The revive puts
 * carry p.group (the stored group or null): undo brings members back
 * grouped.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items to delete
 * @param {(id: string) => object|null} [geom] routed geometry of a connector (ConnGeom)
 * @return {{ops: object[], inverse: object[]}}
 */
export function deleteItems(model, ids, geom = typeof model?.geometryOf === 'function' ? model.geometryOf.bind(model) : null) {
	const del = [...new Set(ids)].filter((id) => model.has(id))
	const set = new Set(del)
	const frees = []
	const rehang = []
	const releases = []
	const rebind = []
	for (const c of connectorsBoundTo(model, set)) {
		if (set.has(c)) {
			continue
		}
		const it = model.get(c)
		const p = {}
		const inv = {}
		for (const which of ['start', 'end']) {
			const ep = it.data?.[which]
			if (!isMap(ep) || !set.has(ep.item)) {
				continue
			}
			const pt = dockingPoint(model, geom, c, which, ep)
			if (pt === null) {
				continue
			}
			p['data.' + which] = pt
			inv['data.' + which] = clone(ep)
		}
		if (Object.keys(p).length > 0) {
			releases.push({ o: 'patch', id: c, p })
			rebind.push({ o: 'patch', id: c, p: inv })
		}
	}
	for (const id of del) {
		const item = model.get(id)
		if (!typeInfo(item.t).container) {
			continue
		}
		for (const cid of model.childrenOf(id) ?? []) {
			if (set.has(cid) || !model.has(cid)) {
				continue
			}
			const child = model.get(cid)
			const a = model.abs(cid)
			frees.push({ o: 'patch', id: cid, p: { x: round2(a.x), y: round2(a.y), parent: null } })
			rehang.push({ o: 'patch', id: cid, p: { x: child.x, y: child.y, parent: child.parent ?? null } })
		}
	}
	// a group with one unlocked member left: that member leaves it too (the server would dissolve it)
	const ungroup = []
	const regroup = []
	const seen = new Set()
	for (const id of del) {
		const g = groupOf(model, id)
		if (g === null || seen.has(g)) {
			continue
		}
		seen.add(g)
		const rest = model.membersOf(g).filter((m) => !set.has(m))
		if (rest.length === 1 && !isLocked(model.get(rest[0]))) {
			ungroup.push({ o: 'patch', id: rest[0], p: { group: null } })
			regroup.push({ o: 'patch', id: rest[0], p: { group: g } })
		}
	}
	const ops = [...frees, ...releases, ...ungroup, ...del.map((id) => ({ o: 'remove', id }))]
	const containersFirst = [...del].sort((a, b) => {
		const ca = typeInfo(model.get(a).t).container ? 0 : 1
		const cb = typeInfo(model.get(b).t).container ? 0 : 1
		return ca - cb
	})
	const revive = containersFirst.map((id) => {
		const it = model.get(id)
		return {
			o: 'put',
			id,
			t: it.t,
			revive: true,
			p: {
				x: it.x,
				y: it.y,
				w: it.w,
				h: it.h,
				r: it.r ?? 0,
				z: it.z,
				parent: it.parent ?? null,
				data: clone(it.data ?? {}),
				style: clone(it.style ?? {}),
				group: typeof it.group === 'string' ? it.group : null,
			},
		}
	})
	return { ops, inverse: [...revive, ...regroup, ...rehang, ...rebind] }
}

/**
 * Text of an item (note text, frame title, shape or text item). For a `text`
 * item the measured height `h` (§4.7 rule 13) travels in the same patch.
 *
 * @param {object} model SceneModel
 * @param {{id: string, path: string, value: string, before: string, h?: number}} intent text intent
 * @return {{ops: object[], inverse: object[]}}
 */
export function setText(model, { id, path, value, before, h }) {
	if (!model.has(id)) {
		return { ops: [], inverse: [] }
	}
	// well-formed UTF-16 (T14): the local model then equals what the server stores
	const p = { [path]: wellFormed(value) }
	const inv = { [path]: wellFormed(before ?? '') }
	const item = model.get(id)
	if (item.t === 'text' && isNum(h) && h > 0) {
		p.h = q2(clampSize('text', h))
		inv.h = item.h
	}
	return {
		ops: [{ o: 'patch', id, p }],
		inverse: [{ o: 'patch', id, p: inv }],
	}
}

/**
 * Fill color of the given items (M0; v2: setStyle with 'style.fill').
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {string} color #rrggbb
 * @return {{ops: object[], inverse: object[]}}
 */
export function setFill(model, ids, color) {
	return setStyle(model, ids, 'style.fill', color)
}

/**
 * @param {unknown} a value
 * @param {unknown} b value
 * @return {boolean} equal as JSON (null = absent)
 */
function same(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * One style or data field of the selection (context bar, SPEC-M1 §6.5.1,
 * §6.5.2): only items whose type has a field rule for `path` change; the
 * value must pass that rule (stored in its normalised form). A note colour
 * on a frame becomes the nearest frame colour (nearestFrameFill). null
 * deletes the field (e.g. font size "Auto"; never a required field). For
 * `text` items heights.get(id) is the measured height of the new state
 * (rule 13).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {string} path field path, e.g. 'style.stroke', 'data.kind'
 * @param {unknown} value new value (null = remove)
 * @param {{heights?: Map<string, number>}} [o] options
 * @return {{ops: object[], inverse: object[]}}
 */
export function setStyle(model, ids, path, value, { heights = null } = {}) {
	const ops = []
	const inverse = []
	for (const id of new Set(ids)) {
		if (!model.has(id)) {
			continue
		}
		const item = model.get(id)
		if (fieldRule(item.t, path) === null) {
			continue
		}
		let v = null
		if (value !== null && value !== undefined) {
			const given = item.t === 'frame' && path === 'style.fill' ? nearestFrameFill(value) : value
			const c = checkField(item.t, path, given)
			if (!c.ok) {
				continue
			}
			v = c.norm
		} else if (typeInfo(item.t).required.includes(path)) {
			continue
		}
		const before = getPath(item, path)
		if (same(before, v)) {
			continue
		}
		const p = { [path]: v }
		const inv = { [path]: before === null || before === undefined ? null : clone(before) }
		const h = heights instanceof Map ? heights.get(id) : undefined
		if (item.t === 'text' && isNum(h) && h > 0) {
			p.h = q2(clampSize('text', h))
			inv.h = item.h
		}
		ops.push({ o: 'patch', id, p })
		inverse.push({ o: 'patch', id, p: inv })
	}
	return { ops, inverse }
}

/**
 * Bring to front / send to back, keeping the current relative order of the
 * moved items; per layer (frames stay behind content).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {'front'|'back'} where direction
 * @return {{ops: object[], inverse: object[]}}
 */
export function reorder(model, ids, where) {
	const ops = []
	const inverse = []
	const byLayer = new Map()
	for (const id of new Set(ids)) {
		if (!model.has(id)) {
			continue
		}
		const layer = typeInfo(model.get(id).t).layer
		if (!byLayer.has(layer)) {
			byLayer.set(layer, [])
		}
		byLayer.get(layer).push(id)
	}
	for (const [layer, list] of byLayer) {
		const sorted = model.sortByOrder(list)
		const keys = where === 'back'
			? keysBetween(null, model.minZ(layer), sorted.length)
			: keysBetween(model.maxZ(layer), null, sorted.length)
		sorted.forEach((id, i) => {
			const before = model.get(id).z
			ops.push({ o: 'patch', id, p: { z: keys[i] } })
			inverse.push({ o: 'patch', id, p: { z: before } })
		})
	}
	return { ops, inverse }
}

/**
 * @param {Array<{x:number, y:number, w:number, h:number, r?:number}>} boxes boxes
 * @return {{x:number, y:number, w:number, h:number}|null} axis-parallel union of the rotated boxes
 */
function unionOf(boxes) {
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
	return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Transformer result (SPEC-M1 §6.3, §6.5.2): one patch per item with the
 * whole placement group and the size, {x, y, parent, w, h, r} on the 0.01
 * grid (q), computed from the intent's absolute boxes, never from the model
 * (the scene previews the transform in the model, setBoxesLocal).
 *
 * - `text`: style.fontSize from after.fontSize (whole number in the rule's
 *   bounds) and the measured height heights.get(id) (rule 13)
 * - a container whose x or y changes carries `keep: true` when the intent
 *   says so (rule 15: its children keep their absolute position); the
 *   inverse patch carries it as well, so undo leaves the children too
 * - frame membership afterwards, in the same commit: a child whose center
 *   lies outside the new box is freed (patch {parent: null, x, y} absolute),
 *   a top-level non-container item completely inside is adopted (as when a
 *   frame is dragged out). These patches follow the frame's, their inverses
 *   follow the frame's inverse (each sets its old placement exactly,
 *   whatever the server's keep shift did before)
 * - free connector ends of the selection are mapped from the union of the
 *   old boxes onto the union of the new ones
 *
 * The children's placements come from `origin` (id → {x, y, parent}, their
 * stored state, which the session takes from the replica): while a frame is
 * transformed with keep, the scene compensates the children's relative
 * positions IN THE MODEL (preview, so they stay where they are), and the
 * model's x/y are not what is stored. Without origin the model is read
 * (arrange: no preview).
 *
 * @param {object} model SceneModel
 * @param {{ids: string[], before: Map<string, object>, after: Map<string, object>, keep?: boolean,
 *   heights?: Map<string, number>|null, origin?: Map<string, {x: number, y: number, parent: string|null}>|null}} intent
 *   transform intent plus measured heights and the children's stored placements
 * @return {{ops: object[], inverse: object[]}}
 */
export function transformItems(model, { ids, before, after, keep = false, heights = null, origin = null }) {
	const ops = []
	const inverse = []
	const late = []
	const lateInverse = []
	const list = [...new Set(ids ?? [])].filter((id) => model.has(id))
	const boxed = list.filter((id) => typeInfo(model.get(id).t).placement !== 'none' && pick(before, id) && pick(after, id))
	const inList = new Set(boxed)
	const parentAbs = (p, map) => {
		if (p === null || p === undefined) {
			return { x: 0, y: 0 }
		}
		const b = inList.has(p) ? pick(map, p) : null
		return b ? { x: b.x, y: b.y } : (absOf(model, p) ?? { x: 0, y: 0 })
	}
	const touched = new Set()
	for (const id of boxed) {
		const item = model.get(id)
		const info = typeInfo(item.t)
		const b = pick(before, id)
		const a = pick(after, id)
		if (![a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h].every(isNum)) {
			continue
		}
		const parent = b.parent !== undefined ? (b.parent ?? null) : (item.parent ?? null)
		const pa = parentAbs(parent, after)
		const pb = parentAbs(parent, before)
		const p = {
			x: q2(a.x - pa.x),
			y: q2(a.y - pa.y),
			parent,
			w: q2(clampSize(item.t, a.w)),
			h: q2(clampSize(item.t, a.h)),
			r: info.rotatable ? normAngle(a.r ?? 0) : 0,
		}
		const inv = {
			x: q2(b.x - pb.x),
			y: q2(b.y - pb.y),
			parent,
			w: q2(b.w),
			h: q2(b.h),
			r: info.rotatable ? normAngle(b.r ?? 0) : 0,
		}
		if (item.t === 'text') {
			const rule = fieldRule('text', 'style.fontSize')
			if (isNum(a.fontSize) && a.fontSize !== b.fontSize) {
				p['style.fontSize'] = Math.min(rule[2], Math.max(rule[1], Math.round(a.fontSize)))
				inv['style.fontSize'] = isNum(b.fontSize) ? b.fontSize : (getPath(item, 'style.fontSize') ?? null)
			}
			const h = heights instanceof Map ? heights.get(id) : undefined
			if (isNum(h) && h > 0) {
				p.h = q2(clampSize('text', h))
			}
		}
		const op = { o: 'patch', id, p }
		const iop = { o: 'patch', id, p: inv }
		if (info.container && keep === true && (p.x !== inv.x || p.y !== inv.y)) {
			op.keep = true
			iop.keep = true
		}
		ops.push(op)
		inverse.push(iop)
		touched.add(id)
		if (info.container) {
			membership(model, id, b, a, op.keep === true, inList, late, lateInverse, touched, origin)
		}
	}
	// free connector ends of the selection follow the union of the boxes
	const ub = unionOf(boxed.map((id) => pick(before, id)))
	const ua = unionOf(boxed.map((id) => pick(after, id)))
	for (const id of list) {
		const item = model.get(id)
		if (typeInfo(item.t).placement !== 'none' || !ub || !ua || ub.w <= 0 || ub.h <= 0) {
			continue
		}
		const p = {}
		const inv = {}
		for (const which of ['start', 'end']) {
			const ep = item.data?.[which]
			if (isMap(ep) && isNum(ep.x) && isNum(ep.y) && !('item' in ep)) {
				p['data.' + which] = { x: q2(ua.x + (ep.x - ub.x) * ua.w / ub.w), y: q2(ua.y + (ep.y - ub.y) * ua.h / ub.h) }
				inv['data.' + which] = { x: ep.x, y: ep.y }
			}
		}
		if (Object.keys(p).length > 0) {
			ops.push({ o: 'patch', id, p })
			inverse.push({ o: 'patch', id, p: inv })
		}
	}
	return { ops: [...ops, ...late], inverse: [...inverse, ...lateInverse] }
}

/**
 * Frame membership after a frame changed its box (§6.5.2). A group (M2,
 * R20 Gruppieren, model/groups.js groupOf) is one block: its members among
 * the frame's children are freed together when the centre of the union of
 * their boxes lies outside the new box, else all stay; top-level members
 * are adopted together when every member is top-level and the union lies
 * completely inside, else all stay.
 *
 * @param {object} model SceneModel
 * @param {string} id frame id
 * @param {object} b box before (absolute)
 * @param {object} a box after (absolute)
 * @param {boolean} kept children keep their absolute position (keep)
 * @param {Set<string>} inList ids transformed in the same intent
 * @param {object[]} late ops (out)
 * @param {object[]} lateInverse inverse ops (out)
 * @param {Set<string>} touched ids that already have a patch
 * @param {Map<string, object>|null} origin stored placements of the children (see transformItems)
 */
function membership(model, id, b, a, kept, inList, late, lateInverse, touched, origin) {
	const frameT = model.get(id).t
	const inside = (x, y) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h
	// children: their absolute box after the change; a group decides by its union (one block)
	const kids = []
	for (const cid of model.childrenOf(id) ?? []) {
		if (inList.has(cid) || touched.has(cid) || !model.has(cid)) {
			continue
		}
		const kid = model.get(cid)
		if (typeInfo(kid.t).placement === 'none') {
			continue
		}
		const o = pick(origin, cid)
		const rel = o && isNum(o.x) && isNum(o.y) ? o : kid
		const base = kept ? b : a
		kids.push({ cid, rel, box: { x: base.x + rel.x, y: base.y + rel.y, w: kid.w, h: kid.h, r: kid.r ?? 0 } })
	}
	for (const block of byGroup(model, kids, (k) => k.cid)) {
		const u = block.length === 1 ? null : unionOf(block.map((k) => k.box))
		const c = u ? { x: u.x + u.w / 2, y: u.y + u.h / 2 } : { x: block[0].box.x + block[0].box.w / 2, y: block[0].box.y + block[0].box.h / 2 }
		if (inside(c.x, c.y)) {
			continue
		}
		for (const { cid, rel, box } of block) {
			touched.add(cid)
			late.push({ o: 'patch', id: cid, p: { x: q2(box.x), y: q2(box.y), parent: null } })
			lateInverse.push({ o: 'patch', id: cid, p: { x: rel.x, y: rel.y, parent: id } })
		}
	}
	const contained = new Set(model.queryRect({ x: a.x, y: a.y, w: a.w, h: a.h }, 'contain') ?? [])
	const adoptable = (cid) => {
		if (cid === id || inList.has(cid) || touched.has(cid) || !model.has(cid)) {
			return false
		}
		const it = model.get(cid)
		const parentId = it.parent ?? null
		if (parentId !== null && model.has(parentId)) {
			return false
		}
		return !typeInfo(it.t).container && typeInfo(it.t).placement !== 'none' && canBeChildOf(it.t, frameT)
	}
	// members of groups that stay as they are (decided once per group); local to this
	// frame, so another frame of the same transform may still adopt the group
	const stays = new Set()
	for (const cid of contained) {
		if (stays.has(cid) || !adoptable(cid)) {
			continue
		}
		const g = groupOf(model, cid)
		// a group only as a whole: every member top-level and adoptable, their union completely inside
		const block = g === null ? [cid] : model.membersOf(g)
		if (block.length > 1) {
			const u = unionOf(block.map((m) => model.abs(m)).filter((x) => x !== null))
			if (!block.every(adoptable) || !u || u.x < a.x || u.y < a.y || u.x + u.w > a.x + a.w || u.y + u.h > a.y + a.h) {
				for (const m of block) {
					stays.add(m)
				}
				continue
			}
		}
		for (const m of block) {
			const it = model.get(m)
			const ab = model.abs(m)
			touched.add(m)
			late.push({ o: 'patch', id: m, p: { x: q2(ab.x - a.x), y: q2(ab.y - a.y), parent: id } })
			lateInverse.push({ o: 'patch', id: m, p: { x: it.x, y: it.y, parent: it.parent ?? null } })
		}
	}
}

/**
 * Splits entries into blocks (M2, R20 Gruppieren): the entries of one group
 * (model/groups.js groupOf) together, every other entry alone; in order of
 * first appearance.
 *
 * @param {object} model SceneModel
 * @param {object[]} list entries
 * @param {(e: object) => string} idOf item id of an entry
 * @return {object[][]}
 */
function byGroup(model, list, idOf) {
	const blocks = []
	const byG = new Map()
	for (const e of list) {
		const g = groupOf(model, idOf(e))
		if (g === null) {
			blocks.push([e])
			continue
		}
		let block = byG.get(g)
		if (!block) {
			block = []
			byG.set(g, block)
			blocks.push(block)
		}
		block.push(e)
	}
	return blocks
}

/**
 * "Arrange" field (X, Y, W, H, angle; WCAG 2.5.7, SPEC-M1 §6.5.2): one item
 * transformed to an absolute box, like a transformer drag (same rounding,
 * same frame membership; a frame moves with its content, no keep). Values
 * that are missing or not finite keep the current ones. Sizes are clamped to
 * the type; a type that is not rotatable keeps r = 0; an item without
 * handles (resize 'none') only moves. A `text` item's height is measured:
 * textH is the height of the new width.
 *
 * @param {object} model SceneModel
 * @param {string} id item
 * @param {{x?: number, y?: number, w?: number, h?: number, r?: number}} box target (absolute, world)
 * @param {{textH?: number}} [o] measured height of a text item
 * @return {{ops: object[], inverse: object[]}}
 */
export function arrangeItem(model, id, { x, y, w, h, r } = {}, { textH } = {}) {
	if (!model.has(id)) {
		return { ops: [], inverse: [] }
	}
	const item = model.get(id)
	const info = typeInfo(item.t)
	if (info.placement === 'none') {
		return { ops: [], inverse: [] }
	}
	const cur = model.abs(id)
	const fontSize = item.t === 'text' ? getPath(item, 'style.fontSize') : undefined
	const b = { x: cur.x, y: cur.y, w: cur.w, h: cur.h, r: cur.r ?? 0, parent: item.parent ?? null, fontSize }
	const sized = info.resize !== 'none'
	const a = {
		x: isNum(x) ? x : cur.x,
		y: isNum(y) ? y : cur.y,
		w: sized && isNum(w) && w > 0 ? clampSize(item.t, w) : cur.w,
		h: sized && item.t !== 'text' && isNum(h) && h > 0 ? clampSize(item.t, h) : cur.h,
		r: info.rotatable && isNum(r) ? r : (cur.r ?? 0),
		fontSize,
	}
	const heights = new Map()
	if (item.t === 'text' && isNum(textH) && textH > 0) {
		heights.set(id, textH)
	}
	const res = transformItems(model, { ids: [id], before: new Map([[id, b]]), after: new Map([[id, a]]), keep: false, heights })
	// nothing changed: no op (the patch would only repeat the stored values)
	const op = res.ops[0]
	if (op && res.ops.length === 1) {
		const same0 = Object.keys(op.p).every((k) => same(op.p[k], k === 'parent' ? (item.parent ?? null) : getPath(item, k)))
		if (same0) {
			return { ops: [], inverse: [] }
		}
	}
	return res
}

/**
 * The blocks of a selection that "Align" moves: known ids (each once), no
 * connectors (placement 'none'; unknown types count, as when moving), only
 * the topmost ones (parent null or not selected itself, like
 * BoardSession.nudge: a child of a selected frame moves with its frame)
 * and only movable ones (M2, R20: model/groups.js movableIds, no locked
 * item, no member of a group with a locked member). Grouped into blocks
 * (blocksOf): a fully selected group is ONE block, every other item a
 * block of its own. Selection v2 `alignable` is the number of blocks.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @return {string[][]} blocks in selection order, each with its ids in selection order
 */
export function alignableIds(model, ids) {
	const sel = new Set((ids ?? []).filter((id) => model.has(id)))
	const top = [...sel].filter((id) => {
		const it = model.get(id)
		if (typeInfo(it.t).placement === 'none') {
			return false
		}
		const p = it.parent ?? null
		return p === null || !sel.has(p)
	})
	return blocksOf(model, movableIds(model, top))
}

/**
 * @param {object} model SceneModel
 * @param {string[][]} blocks blocks (alignableIds)
 * @return {Array<{block: string[], b: number[]}>} each block with its hull [x0, y0, x1, y1], the
 *   axis-parallel union of the members' rotated absolute boxes (blocks without a box are left out)
 */
function blockHulls(model, blocks) {
	const out = []
	for (const block of blocks) {
		let b = null
		for (const id of block) {
			const a = model.abs(id)
			if (!a) {
				continue
			}
			const r = rotatedBBox(a.x, a.y, a.w, a.h, a.r || 0)
			b = b === null ? r : [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])]
		}
		if (b !== null) {
			out.push({ block, b })
		}
	}
	return out
}

/**
 * "Align" (SPEC-M1 §1.2 M2): every alignable item (alignableIds) to one edge
 * or centre line of U, the axis-parallel union of their rotated boxes
 * (rotatedBBox, like selectionFrame without connectors). Only one axis moves.
 *
 * - shift (dx, dy) = target minus the edge or centre of the item's hull;
 *   empty when every shift lies within ALIGN_TOLERANCE (an aligned
 *   selection: no op, no undo step, no parent chosen again)
 * - otherwise every item in selection order (shiftItem with snap):
 *   - shift above ALIGN_TOLERANCE: new absolute position = abs + (dx, dy);
 *     new parent = topmost fitting container under the new centre,
 *     excluding the aligned items and their descendants (as moveItems): an
 *     item may leave or enter a frame that is not aligned itself, an aligned
 *     frame is never a parent
 *   - shift within ALIGN_TOLERANCE: snapped as well (abs + (dx, dy), rounded
 *     relative to its current parent, which stays), an invisible move of at
 *     most 0.01 in the same undo step. Afterwards every item lies within
 *     0.005 of the target, so the next target moves by at most 0.005 and the
 *     next click on the same edge is empty, also after items were added to
 *     an aligned selection
 * - one patch {x, y, parent} per item (rule 2a, round2 like moveItems), no
 *   keep: a frame takes its children along; inverse = the stored placement;
 *   no patch when the rounded placement stays the same
 * - connectors neither count for U nor move (bound ends follow by routing)
 * - empty for an edge outside ALIGN_EDGES or fewer than two alignable items
 * - (M2, R20 Gruppieren) per block (alignableIds): a fully selected group
 *   is measured by its hull (the union of its members' rotated boxes) and
 *   every member gets the same shift, with one parent for the block
 *   (shiftBlock); "fewer than two" counts blocks
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {string} edge one of ALIGN_EDGES
 * @return {{ops: object[], inverse: object[]}}
 */
export function alignItems(model, ids, edge) {
	if (!ALIGN_EDGES.includes(edge)) {
		return { ops: [], inverse: [] }
	}
	const blocks = alignableIds(model, ids)
	const boxes = blockHulls(model, blocks)
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const { b } of boxes) {
		minX = Math.min(minX, b[0])
		minY = Math.min(minY, b[1])
		maxX = Math.max(maxX, b[2])
		maxY = Math.max(maxY, b[3])
	}
	if (boxes.length < 2) {
		return { ops: [], inverse: [] }
	}
	const exclude = withDescendants(model, blocks.flat())
	const shift = ([x0, y0, x1, y1]) => {
		switch (edge) {
		case 'left': return [minX - x0, 0]
		case 'center': return [(minX + maxX) / 2 - (x0 + x1) / 2, 0]
		case 'right': return [maxX - x1, 0]
		case 'top': return [0, minY - y0]
		case 'middle': return [0, (minY + maxY) / 2 - (y0 + y1) / 2]
		default: return [0, maxY - y1]
		}
	}
	const out = { ops: [], inverse: [] }
	const shifts = boxes.map(({ b }) => shift(b))
	if (shifts.every(([dx, dy]) => withinTolerance(dx, dy))) {
		// already aligned: no op, no undo step
		return out
	}
	boxes.forEach(({ block, b }, i) => {
		shiftBlock(model, block, b, shifts[i][0], shifts[i][1], exclude, out, true)
	})
	return out
}

/**
 * "Distribute" (SPEC-M1 §1.2 M2): the distributable items (alignableIds, at
 * least three) along one axis, by the axis-parallel hulls of their rotated
 * boxes (rotatedBBox, as alignItems). Only that axis moves.
 *
 * - order: by hull centre on the axis, stable (equal centres keep the
 *   selection order); the first (A) and the last (Z) never move
 * - equal gaps g = (Z.start − A.end − Σ inner lengths) / (n − 1); each inner
 *   item starts at the end of the previous TARGET + g (targets, not rounded
 *   positions, so a second click finds the same targets)
 * - g < 0 (the items overlap too much for equal gaps; below −GAP_NOISE):
 *   equal steps between the centres from A to Z instead; negative gaps could
 *   swap the order and move items again on every further click
 * - placement, frame membership, rounding and ALIGN_TOLERANCE as alignItems
 *   (shiftItem), but an item within ALIGN_TOLERANCE is not snapped; ops and
 *   inverses in the sorted order
 * - empty for an axis outside DISTRIBUTE_AXES, fewer than three
 *   distributable items or a distributed selection
 * - (M2, R20 Gruppieren) per block like alignItems: a fully selected group
 *   is one item with its hull, all members shift alike (shiftBlock)
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {string} axis one of DISTRIBUTE_AXES
 * @return {{ops: object[], inverse: object[]}}
 */
export function distributeItems(model, ids, axis) {
	if (!DISTRIBUTE_AXES.includes(axis)) {
		return { ops: [], inverse: [] }
	}
	const horizontal = axis === 'horizontal'
	const blocks = alignableIds(model, ids)
	const boxes = []
	for (const { block, b } of blockHulls(model, blocks)) {
		const s = horizontal ? b[0] : b[1]
		const e = horizontal ? b[2] : b[3]
		boxes.push({ block, b, s, e, w: e - s, c: (s + e) / 2 })
	}
	const n = boxes.length
	if (n < 3) {
		return { ops: [], inverse: [] }
	}
	// Array.prototype.sort is stable: equal centres keep the selection order
	boxes.sort((u, v) => u.c - v.c)
	const first = boxes[0]
	const last = boxes[n - 1]
	const inner = boxes.slice(1, -1)
	const g = (last.s - first.e - inner.reduce((sum, b) => sum + b.w, 0)) / (n - 1)
	const step = (last.c - first.c) / (n - 1)
	const exclude = withDescendants(model, blocks.flat())
	const gapped = g >= -GAP_NOISE
	const out = { ops: [], inverse: [] }
	// end of the previous target (equal gaps only)
	let end = first.e
	inner.forEach((b, i) => {
		const start = gapped ? end + g : first.c + (i + 1) * step - b.w / 2
		end = start + b.w
		const d = start - b.s
		shiftBlock(model, b.block, b.b, horizontal ? d : 0, horizontal ? 0 : d, exclude, out)
	})
	return out
}

/**
 * "Tidy up" (SPEC-M1 §1.2 M2): the alignable items (alignableIds, at least
 * two) onto an exact grid, by the axis-parallel hulls of their rotated boxes
 * (rotatedBBox, as alignItems).
 *
 * - rows (tidyTracks): stable by hull centre y (equal centres keep the
 *   selection order); an item joins the last row when its centre lies above
 *   the row's lowest bottom edge or its top edge above the centre of the
 *   row's last item, otherwise it opens the next row
 * - columns: the same on x, but never into a column that already holds an
 *   item of the same row (at most one item per cell)
 * - column width = widest hull, row height = highest hull; one gap per axis
 *   from the mean centres of the tracks (tidyGrid: a loose grid stays loose,
 *   a dense one dense), whole units, never negative, 0 for a single track;
 *   the grid starts at the top-left of the union, rounded
 * - each hull centred in its cell; empty cells stay empty, rows and columns
 *   keep their order. Whole-unit gaps and corner make a second click find
 *   the same grid (empty within ALIGN_TOLERANCE, no creeping)
 * - placement, frame membership, rounding and ALIGN_TOLERANCE as alignItems
 *   (shiftItem), but an item within ALIGN_TOLERANCE is not snapped; ops and
 *   inverses row by row, each row left to right
 * - empty for fewer than two alignable items or a tidy selection
 * - (M2, R20 Gruppieren) per block like alignItems: a fully selected group
 *   takes one cell with its hull, all members shift alike (shiftBlock)
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @return {{ops: object[], inverse: object[]}}
 */
export function tidyItems(model, ids) {
	const blocks = alignableIds(model, ids)
	const boxes = []
	for (const { block, b } of blockHulls(model, blocks)) {
		const [x0, y0, x1, y1] = b
		boxes.push({ block, b, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, row: 0, col: 0 })
	}
	if (boxes.length < 2) {
		return { ops: [], inverse: [] }
	}
	const rows = tidyTracks(boxes, 'y', null)
	const cols = tidyTracks(boxes, 'x', 'row')
	const top = tidyGrid(rows, Math.round(Math.min(...boxes.map((b) => b.y0))))
	const left = tidyGrid(cols, Math.round(Math.min(...boxes.map((b) => b.x0))))
	const exclude = withDescendants(model, blocks.flat())
	const out = { ops: [], inverse: [] }
	boxes.sort((u, v) => u.row - v.row || u.col - v.col)
	for (const b of boxes) {
		const dx = left[b.col] + (cols[b.col].size - (b.x1 - b.x0)) / 2 - b.x0
		const dy = top[b.row] + (rows[b.row].size - (b.y1 - b.y0)) / 2 - b.y0
		shiftBlock(model, b.block, b.b, dx, dy, exclude, out)
	}
	return out
}

/**
 * Rows or columns of "Tidy up": the boxes stably sorted by their centre on
 * the axis, each one joins the last track when its centre lies before the
 * track's far edge or its near edge before the centre of the track's last
 * box, otherwise it opens the next track. Writes the track index into the
 * box (`row` for y, `col` for x).
 *
 * @param {object[]} boxes hulls {x0, y0, x1, y1, cx, cy, row, col}
 * @param {'x'|'y'} axis axis
 * @param {string|null} apart a box never joins a track that already holds a
 *   box with the same value of this field (columns: one item per row)
 * @return {{size: number, centre: number}[]} tracks in order: size (largest
 *   extent of a box) and centre (mean centre of its boxes)
 */
function tidyTracks(boxes, axis, apart) {
	const [s, e, c, key] = axis === 'x' ? ['x0', 'x1', 'cx', 'col'] : ['y0', 'y1', 'cy', 'row']
	const tracks = []
	// Array.prototype.sort is stable: equal centres keep the selection order
	for (const b of [...boxes].sort((u, v) => u[c] - v[c])) {
		const t = tracks.at(-1)
		if (t && (b[c] < t.end || b[s] < t.mid) && !(apart && t.taken.has(b[apart]))) {
			t.end = Math.max(t.end, b[e])
			t.size = Math.max(t.size, b[e] - b[s])
			t.mid = b[c]
			t.sum += b[c]
			t.n++
		} else {
			tracks.push({ end: b[e], size: b[e] - b[s], mid: b[c], sum: b[c], n: 1, taken: apart ? new Set() : null })
		}
		b[key] = tracks.length - 1
		if (apart) {
			tracks.at(-1).taken.add(b[apart])
		}
	}
	return tracks.map((t) => ({ size: t.size, centre: t.sum / t.n }))
}

/**
 * The track starts of "Tidy up" with one gap between all tracks: the mean
 * over neighbours of (centre distance − half of both sizes), rounded to
 * whole units, never negative (0 for a single track). From the centres, not
 * from the bands (smallest start to largest end): every hand-placed offset
 * widens a band and shrinks the gap measured between bands, so a loose grid
 * came out much denser (in AK1 60/80 became 40/50, larger grids down to 0).
 * Once tidied, each centre lies within ALIGN_TOLERANCE of its cell centre,
 * so a second click measures gap ± 0.02 and rounds to the same gap.
 *
 * @param {{size: number, centre: number}[]} tracks rows or columns (tidyTracks)
 * @param {number} origin start of the first track (whole units)
 * @return {number[]} start of every track
 */
function tidyGrid(tracks, origin) {
	let sum = 0
	for (let i = 1; i < tracks.length; i++) {
		sum += tracks[i].centre - tracks[i - 1].centre - (tracks[i - 1].size + tracks[i].size) / 2
	}
	const gap = tracks.length < 2 ? 0 : Math.max(0, Math.round(sum / (tracks.length - 1)))
	const starts = [origin]
	for (let i = 1; i < tracks.length; i++) {
		starts.push(starts[i - 1] + tracks[i - 1].size + gap)
	}
	return starts
}

/**
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @return {Set<string>} the items and all their descendants
 */
function withDescendants(model, ids) {
	const set = new Set()
	for (const id of ids) {
		set.add(id)
		for (const d of model.descendantsOf(id) ?? []) {
			set.add(d)
		}
	}
	return set
}

/**
 * One item of "Align", "Distribute" or "Tidy up" by (dx, dy). Within
 * ALIGN_TOLERANCE: nothing without `snap` (Distribute, Tidy up), with `snap`
 * (alignItems) the shifted position rounded relative to the current parent,
 * which stays; the parent is never chosen again there. Otherwise the new
 * parent is the topmost fitting container under the new centre (not in
 * `exclude`, as moveItems). One patch of the whole placement group
 * {x, y, parent} (rule 2a, round2) plus its inverse go to `out`; none when
 * the rounded placement equals the stored one.
 *
 * @param {object} model SceneModel
 * @param {string} id item
 * @param {{x: number, y: number, w: number, h: number}} a its absolute box (model.abs)
 * @param {number} dx shift
 * @param {number} dy shift
 * @param {Set<string>} exclude never a parent (the moved items and their descendants)
 * @param {{ops: object[], inverse: object[]}} out receives the patch and its inverse
 * @param {boolean} [snap] also shift an item within ALIGN_TOLERANCE, keeping its parent
 */
function shiftItem(model, id, a, dx, dy, exclude, out, snap = false) {
	const near = withinTolerance(dx, dy)
	if (near && !snap) {
		// already in place: no patch, and the parent is not chosen again
		return
	}
	const item = model.get(id)
	const oldParent = item.parent ?? null
	const absPos = { x: a.x + dx, y: a.y + dy }
	// snapped (near): the parent stays, containerFor is not asked
	const parent = near ? oldParent : containerFor(model, item.t, absPos.x + a.w / 2, absPos.y + a.h / 2, exclude)
	const p = placement(model, absPos, parent)
	if (p.x === item.x && p.y === item.y && p.parent === oldParent) {
		return
	}
	out.ops.push({ o: 'patch', id, p })
	out.inverse.push({ o: 'patch', id, p: { x: item.x, y: item.y, parent: oldParent } })
}

/**
 * One block of "Align", "Distribute" or "Tidy up" by (dx, dy) (M2, R20
 * Gruppieren): a single item is shiftItem; a group block shifts every
 * member by the same amount, the parent chosen once for the block (the
 * topmost fitting container under the centre of the shifted hull, as
 * shiftItem; within ALIGN_TOLERANCE with `snap` each member keeps its
 * parent), one patch {x, y, parent} per member whose rounded placement
 * changes.
 *
 * @param {object} model SceneModel
 * @param {string[]} block ids of the block
 * @param {number[]} hull its hull [x0, y0, x1, y1] (blockHulls)
 * @param {number} dx shift
 * @param {number} dy shift
 * @param {Set<string>} exclude never a parent (the moved items and their descendants)
 * @param {{ops: object[], inverse: object[]}} out receives the patches and their inverses
 * @param {boolean} [snap] also shift a block within ALIGN_TOLERANCE, keeping the parents
 */
function shiftBlock(model, block, hull, dx, dy, exclude, out, snap = false) {
	if (block.length === 1) {
		shiftItem(model, block[0], model.abs(block[0]), dx, dy, exclude, out, snap)
		return
	}
	const near = withinTolerance(dx, dy)
	if (near && !snap) {
		return
	}
	const parent = near ? undefined : containerFor(model, model.get(block[0]).t, (hull[0] + hull[2]) / 2 + dx, (hull[1] + hull[3]) / 2 + dy, exclude)
	for (const id of block) {
		const item = model.get(id)
		const a = model.abs(id)
		const oldParent = item.parent ?? null
		const p = placement(model, { x: a.x + dx, y: a.y + dy }, parent === undefined ? oldParent : parent)
		if (p.x === item.x && p.y === item.y && p.parent === oldParent) {
			continue
		}
		out.ops.push({ o: 'patch', id, p })
		out.inverse.push({ o: 'patch', id, p: { x: item.x, y: item.y, parent: oldParent } })
	}
}

/**
 * The selection as a clipboard payload `knorke:1` (SPEC-M1 §6.5.3), read
 * from the model:
 * - topLevel(selection) plus every descendant of a selected container plus
 *   connectors that are selected or have both ends bound inside the payload
 * - payload order = board order (containers first, then content by z)
 * - roots absolute, children relative to their payload parent
 * - a connector end bound to an item outside the payload becomes a free end
 *   at its current place (geometryOf when the model routes connectors,
 *   otherwise the anchor point of the target)
 * - origin = top-left of the union of the root boxes
 * - (M2, R20 Gruppieren) every item carries `group` (its stored group or
 *   null), only as the key pasteItems groups by; copying takes the whole
 *   selection, a fully selected group with all its members
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {{board?: number|null}} [o] board id of the source
 * @return {{knorke: 1, board: (number|null), origin: [number, number], items: object[]}}
 */
export function copyPayload(model, ids, { board = null } = {}) {
	const sel = [...new Set(ids ?? [])].filter((id) => model.has(id))
	const selSet = new Set(sel)
	const underSelected = (id) => {
		let p = model.get(id).parent ?? null
		for (let depth = 0; depth < 8 && p !== null; depth++) {
			if (selSet.has(p)) {
				return true
			}
			if (!model.has(p)) {
				return false
			}
			p = model.get(p).parent ?? null
		}
		return false
	}
	const set = new Set()
	for (const id of sel) {
		if (underSelected(id)) {
			continue
		}
		set.add(id)
		if (typeInfo(model.get(id).t).container) {
			for (const d of model.descendantsOf(id) ?? []) {
				if (model.has(d)) {
					set.add(d)
				}
			}
		}
	}
	for (const c of connectorCandidates(model, set)) {
		if (set.has(c) || !model.has(c)) {
			continue
		}
		const it = model.get(c)
		const s = it.data?.start?.item
		const e = it.data?.end?.item
		if (typeof s === 'string' && typeof e === 'string' && set.has(s) && set.has(e)) {
			set.add(c)
		}
	}
	const ordered = model.sortByOrder([...set])
	const items = []
	const roots = []
	for (const id of ordered) {
		const it = model.get(id)
		const info = typeInfo(it.t)
		const data = clone(it.data ?? {})
		const style = clone(it.style ?? {})
		if (info.placement === 'none') {
			for (const which of ['start', 'end']) {
				const ep = data[which]
				if (isMap(ep) && typeof ep.item === 'string' && !set.has(ep.item)) {
					const pt = endPointNow(model, id, which, ep)
					if (pt) {
						data[which] = { x: q2(pt.x), y: q2(pt.y) }
					}
				}
			}
			items.push({ id, t: it.t, x: 0, y: 0, w: 0, h: 0, r: 0, parent: null, data, style, group: null })
			continue
		}
		const parent = it.parent ?? null
		const group = typeof it.group === 'string' ? it.group : null
		if (parent !== null && set.has(parent)) {
			items.push({ id, t: it.t, x: it.x, y: it.y, w: it.w, h: it.h, r: it.r ?? 0, parent, data, style, group })
		} else {
			const a = model.abs(id)
			items.push({ id, t: it.t, x: a.x, y: a.y, w: it.w, h: it.h, r: it.r ?? 0, parent: null, data, style, group })
			roots.push(a)
		}
	}
	const u = unionOf(roots)
	return { knorke: 1, board: Number.isInteger(board) ? board : null, origin: u ? [u.x, u.y] : [0, 0], items }
}

/**
 * @param {object} model SceneModel
 * @param {Set<string>} set ids of the payload
 * @return {Iterable<string>} connectors that may hang at these items
 */
function connectorCandidates(model, set) {
	if (typeof model.connectorsOf === 'function') {
		return model.connectorsOf(set) ?? []
	}
	const out = []
	for (const id of model.ids?.() ?? []) {
		if (typeInfo(model.get(id)?.t).placement === 'none') {
			out.push(id)
		}
	}
	return out
}

/**
 * @param {object} model SceneModel
 * @param {string} id connector id
 * @param {'start'|'end'} which end
 * @param {object} ep the bound end
 * @return {{x: number, y: number}|null} where that end is drawn now
 */
function endPointNow(model, id, which, ep) {
	const g = typeof model.geometryOf === 'function' ? model.geometryOf(id) : null
	if (g && isMap(g[which]) && isNum(g[which].x) && isNum(g[which].y)) {
		return { x: g[which].x, y: g[which].y }
	}
	return targetAnchor(model, ep)
}

/**
 * Pastes a validated payload (clipboard.js validatePayload, or copyPayload)
 * as new items (SPEC-M1 §6.5.2, §6.5.3):
 * - new ids; children keep their payload parent (mapped); roots go into the
 *   topmost fitting container under their new center
 * - position: inPlace → original coordinates; `offset` {x, y} → original
 *   coordinates shifted; otherwise the center of the payload's root box at
 *   `at` (pointer or viewport center, chosen by the session)
 * - z per layer with keysBetween(maxZ, null, n) in payload order;
 *   containers come first in the ops, connectors after both ends
 * - connector ends through remapEndpoint: into the payload → new id; same
 *   board and target alive (and bindable) → kept; a free end moves with
 *   the paste; an end that cannot be placed drops the connector (skipped)
 * - model.size + n > limits.maxItems → nothing at all, full: true (the
 *   session says "This board is full.")
 * - (M2, R20 Gruppieren) payload items with the same `group` form a NEW
 *   group (a new id per paste and old group) when they are at least two,
 *   all groupable and all of the same payload parent (all roots, or all
 *   children of the same payload frame); otherwise group null. The roots
 *   of a new group get one parent: the topmost fitting container under the
 *   centre of the union of their shifted boxes. Every put carries p.group.
 * One undo step: the inverse removes everything again (connectors first).
 *
 * @param {object} model SceneModel
 * @param {{board?: (number|null), items: object[]}} payload validated payload
 * @param {{at?: ({x:number,y:number}|null), inPlace?: boolean, offset?: ({x:number,y:number}|null),
 *   limits?: (object|null), board?: (number|null)}} [o] placement and the current board
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], skipped: number, full: boolean}}
 */
export function pasteItems(model, payload, { at = null, inPlace = false, offset = null, limits = null, board = null } = {}, newId = ulid) {
	const empty = (skipped = 0, full = false) => ({ ops: [], inverse: [], selectIds: [], skipped, full })
	const src = Array.isArray(payload?.items) ? payload.items : []
	if (src.length === 0) {
		return empty()
	}
	const max = maxItemsOf(limits)
	if (model.size + src.length > max) {
		return empty(0, true)
	}
	const byId = new Map(src.map((it) => [it.id, it]))
	const rootBoxes = src.filter((it) => typeInfo(it.t).placement !== 'none' && !byId.has(it.parent))
	const u = unionOf(rootBoxes)
	let dx = 0
	let dy = 0
	if (!inPlace) {
		if (offset && isNum(offset.x) && isNum(offset.y)) {
			dx = offset.x
			dy = offset.y
		} else if (at && isNum(at.x) && isNum(at.y) && u) {
			dx = at.x - (u.x + u.w / 2)
			dy = at.y - (u.y + u.h / 2)
		}
	}
	const idMap = new Map()
	for (const it of src) {
		idMap.set(it.id, newId())
	}
	// groups of the payload (M2, R20): a new id each where the members may form a group
	const parentOf = (it) => (byId.has(it.parent) ? it.parent : null)
	const payloadGroups = new Map()
	for (const it of src) {
		if (typeof it.group === 'string') {
			const list = payloadGroups.get(it.group)
			if (list) {
				list.push(it)
			} else {
				payloadGroups.set(it.group, [it])
			}
		}
	}
	const newGroup = new Map()
	const groupParent = new Map()
	for (const [g, list] of payloadGroups) {
		if (list.length < 2 || !list.every((it) => isGroupable(it.t)) || new Set(list.map(parentOf)).size !== 1) {
			continue
		}
		newGroup.set(g, newId())
		if (parentOf(list[0]) === null) {
			// the roots of a new group: one parent, under the centre of their shifted union
			const u = unionOf(list.map((it) => ({ x: it.x + dx, y: it.y + dy, w: it.w, h: it.h, r: it.r ?? 0 })))
			groupParent.set(g, u ? containerFor(model, list[0].t, u.x + u.w / 2, u.y + u.h / 2, new Set()) : null)
		}
	}
	const groupOfPut = (it) => (typeof it.group === 'string' ? newGroup.get(it.group) ?? null : null)
	const sameBoard = Number.isInteger(board) && payload.board === board
	const containers = src.filter((it) => typeInfo(it.t).container)
	const content = src.filter((it) => !typeInfo(it.t).container && typeInfo(it.t).placement !== 'none')
	const connectors = src.filter((it) => typeInfo(it.t).placement === 'none')
	const zKeys = new Map()
	for (const layer of ['back', 'content']) {
		const inLayer = src.filter((it) => typeInfo(it.t).layer === layer)
		const keys = inLayer.length > 0 ? keysBetween(model.maxZ(layer), null, inLayer.length) : []
		inLayer.forEach((it, i) => zKeys.set(it.id, keys[i]))
	}
	const ops = []
	const selectIds = []
	let skipped = 0
	const put = (it, p) => {
		ops.push({ o: 'put', id: idMap.get(it.id), t: it.t, p })
	}
	for (const it of [...containers, ...content]) {
		const parentOld = byId.has(it.parent) ? it.parent : null
		let x
		let y
		let parent
		if (parentOld !== null) {
			// children stay relative to their (pasted) parent
			x = it.x
			y = it.y
			parent = idMap.get(parentOld)
		} else {
			const ax = it.x + dx
			const ay = it.y + dy
			const c = groupParent.has(it.group) && newGroup.has(it.group)
				? groupParent.get(it.group)
				: containerFor(model, it.t, ax + it.w / 2, ay + it.h / 2, new Set())
			const pa = absOf(model, c) ?? { x: 0, y: 0 }
			x = ax - pa.x
			y = ay - pa.y
			parent = c
			selectIds.push(idMap.get(it.id))
		}
		put(it, {
			x: q2(x),
			y: q2(y),
			w: q2(it.w),
			h: q2(it.h),
			r: typeInfo(it.t).rotatable ? normAngle(it.r ?? 0) : 0,
			z: zKeys.get(it.id),
			parent,
			data: clone(it.data ?? {}),
			style: clone(it.style ?? {}),
			group: groupOfPut(it),
		})
	}
	const keepMap = new Map(idMap)
	for (const it of connectors) {
		const data = clone(it.data ?? {})
		let ok = true
		for (const which of ['start', 'end']) {
			const ep = data[which]
			if (isMap(ep) && typeof ep.item === 'string' && byId.has(ep.item) && !isBindable(byId.get(ep.item).t)) {
				// bound to a payload item that cannot be bound (a frame, another
				// connector): the server would answer bad (rule 14)
				ok = false
				break
			}
			if (sameBoard && isMap(ep) && typeof ep.item === 'string' && !idMap.has(ep.item) && ULID_RE.test(ep.item)
				&& model.has(ep.item) && typeInfo(model.get(ep.item).t).bindable === true) {
				keepMap.set(ep.item, ep.item)
			}
			const moved = remapEndpoint(ep, keepMap, (e) => (isMap(e) && isNum(e.x) && isNum(e.y) && !('item' in e)
				? { x: q2(e.x + dx), y: q2(e.y + dy) }
				: null))
			const norm = moved === null ? null : normalizeEndpoint(moved)
			if (norm === null) {
				ok = false
				break
			}
			data[which] = norm
		}
		if (!ok) {
			skipped++
			idMap.delete(it.id)
			continue
		}
		put(it, { x: 0, y: 0, w: 0, h: 0, r: 0, z: zKeys.get(it.id), parent: null, data, style: clone(it.style ?? {}), group: null })
		selectIds.push(idMap.get(it.id))
	}
	const inverse = ops.map((op) => ({ o: 'remove', id: op.id })).reverse()
	return { ops, inverse, selectIds, skipped, full: false }
}

/**
 * @param {object|null} limits initial-state limits
 * @return {number} limits.maxItems (positive whole number) or DEFAULT_MAX_ITEMS
 */
export function maxItemsOf(limits) {
	const v = limits?.maxItems
	return Number.isInteger(v) && v > 0 ? v : DEFAULT_MAX_ITEMS
}

/**
 * Duplicate (Ctrl/⌘+D, SPEC-M1 §6.5.2): paste(copyPayload(ids)) without the
 * clipboard, `offset` world units right and down of the originals.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {{offset?: number, limits?: (object|null), board?: (number|null)}} [o] options
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], skipped: number, full: boolean}}
 */
export function duplicateItems(model, ids, { offset = 20, limits = null, board = null } = {}, newId = ulid) {
	const payload = copyPayload(model, ids, { board })
	return pasteItems(model, payload, { offset: { x: offset, y: offset }, limits, board }, newId)
}

/**
 * @param {string} s text
 * @param {number} max code points per part
 * @return {string[]} s split into parts of at most max code points, never shortened
 */
function splitCodePoints(s, max) {
	const cps = Array.from(s)
	if (cps.length <= max) {
		return [s]
	}
	const out = []
	for (let i = 0; i < cps.length; i += max) {
		out.push(cps.slice(i, i + max).join(''))
	}
	return out
}

/**
 * The notes that plain text turns into (SPEC-M1 §6.5.2), with grid cells:
 * - text with a tab: a table; one note per non-empty cell at its column/row
 * - otherwise one note per non-empty line, in a grid of ceil(sqrt(n)) columns
 * - each text is cleaned like the server does (well-formed UTF-16, "\r\n" →
 *   "\n", C0 controls removed); a text above the note limit is split into
 *   several notes (stacked below each other in table mode), never shortened
 *
 * @param {string} text plain text
 * @return {Array<{text: string, col: number, row: number}>}
 */
export function noteTexts(text) {
	const rule = fieldRule('sticky', 'data.text')
	const max = rule ? rule[1] : 6000
	const norm = wellFormed(String(text ?? '')).replace(/\r\n?/g, '\n')
	const clean = (s) => {
		const c = checkField('sticky', 'data.text', s)
		return c.ok ? c.norm : ''
	}
	const out = []
	if (norm.includes('\t')) {
		let row = 0
		for (const line of norm.split('\n')) {
			let height = 0
			line.split('\t').forEach((cell, col) => {
				if (cell.trim() === '') {
					return
				}
				const parts = splitCodePoints(cell, max).map(clean).filter((p) => p !== '')
				parts.forEach((p, k) => out.push({ text: p, col, row: row + k }))
				height = Math.max(height, parts.length)
			})
			row += Math.max(1, height)
		}
		return out
	}
	const parts = []
	for (const line of norm.split('\n')) {
		if (line.trim() === '') {
			continue
		}
		for (const p of splitCodePoints(line, max)) {
			const c = clean(p)
			if (c !== '') {
				parts.push(c)
			}
		}
	}
	const cols = Math.max(1, Math.ceil(Math.sqrt(parts.length)))
	parts.forEach((p, i) => out.push({ text: p, col: i % cols, row: Math.floor(i / cols) }))
	return out
}

/**
 * Plain text → notes (SPEC-M1 §6.5.2): noteTexts() on a NOTE_GRID grid
 * whose center is `at`, default note size and color, each note into the
 * topmost fitting container under its center, z above the content. The
 * session asks first above 100 notes; with model.size + n above
 * limits.maxItems nothing is created (full: true). One undo step.
 *
 * @param {object} model SceneModel
 * @param {string} text plain text
 * @param {{at?: ({x:number,y:number}|null), limits?: (object|null)}} [o] center of the grid
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], count: number, full: boolean}}
 */
export function notesFromText(model, text, { at = null, limits = null } = {}, newId = ulid) {
	const notes = noteTexts(text)
	const n = notes.length
	if (n === 0) {
		return { ops: [], inverse: [], selectIds: [], count: 0, full: false }
	}
	if (model.size + n > maxItemsOf(limits)) {
		return { ops: [], inverse: [], selectIds: [], count: n, full: true }
	}
	const d = TYPES.sticky.defaults
	const cols = Math.max(...notes.map((x) => x.col)) + 1
	const rows = Math.max(...notes.map((x) => x.row)) + 1
	const c = at && isNum(at.x) && isNum(at.y) ? at : { x: 0, y: 0 }
	const x0 = c.x - (cols * NOTE_GRID - (NOTE_GRID - d.w)) / 2
	const y0 = c.y - (rows * NOTE_GRID - (NOTE_GRID - d.h)) / 2
	const keys = keysBetween(model.maxZ(TYPES.sticky.layer), null, n)
	const ops = []
	const selectIds = []
	notes.forEach((note, i) => {
		const id = newId()
		const ax = x0 + note.col * NOTE_GRID
		const ay = y0 + note.row * NOTE_GRID
		const parent = containerFor(model, 'sticky', ax + d.w / 2, ay + d.h / 2, new Set())
		const pa = absOf(model, parent) ?? { x: 0, y: 0 }
		const data = clone(d.data)
		data.text = note.text
		ops.push({
			o: 'put',
			id,
			t: 'sticky',
			p: { x: q2(ax - pa.x), y: q2(ay - pa.y), w: d.w, h: d.h, r: 0, z: keys[i], parent, data, style: clone(d.style) },
		})
		selectIds.push(id)
	})
	const inverse = ops.map((op) => ({ o: 'remove', id: op.id })).reverse()
	return { ops, inverse, selectIds, count: n, full: false }
}

/**
 * Next note of a series entry (Tab in a note editor, SPEC-M1 §6.5.1): right
 * of the previous note with SERIES_GAP, same size and color; the previous
 * note's frame when the new box fits into it completely, otherwise the
 * topmost fitting container under its center.
 *
 * @param {object} model SceneModel
 * @param {string} prevId the note just committed
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean}}
 */
export function nextNote(model, prevId, newId = ulid) {
	if (!model.has(prevId)) {
		return { ops: [], inverse: [], selectIds: [], edit: false }
	}
	const prev = model.get(prevId)
	const a = model.abs(prevId)
	const t = 'sticky'
	const rect = { x: a.x + a.w + SERIES_GAP, y: a.y, w: a.w, h: a.h }
	const style = {}
	const fill = getPath(prev, 'style.fill')
	if (typeof fill === 'string') {
		style.fill = fill
	}
	const r = createItem(model, { t, at: null, rect, style }, newId)
	const parent = prev.parent ?? null
	if (r.ops.length > 0 && parent !== null && model.has(parent)) {
		const f = model.abs(parent)
		const fits = rect.x >= f.x && rect.y >= f.y && rect.x + rect.w <= f.x + f.w && rect.y + rect.h <= f.y + f.h
		if (fits && canBeChildOf(t, model.get(parent).t)) {
			const put = r.ops[0]
			put.p.parent = parent
			put.p.x = q2(rect.x - f.x)
			put.p.y = q2(rect.y - f.y)
		}
	}
	return r
}

/**
 * Re-measured height of a `text` item when its editor closes (§4.7 rule 13,
 * R2): a patch {h} when the measurement differs by more than 0.5.
 *
 * @param {object} model SceneModel
 * @param {string} id item
 * @param {number} measured height measured with the visible state
 * @return {{ops: object[], inverse: object[]}}
 */
export function remeasure(model, id, measured) {
	if (!model.has(id) || !isNum(measured) || measured <= 0) {
		return { ops: [], inverse: [] }
	}
	const item = model.get(id)
	if (item.t !== 'text' || (isNum(item.h) && Math.abs(item.h - measured) <= 0.5)) {
		return { ops: [], inverse: [] }
	}
	return {
		ops: [{ o: 'patch', id, p: { h: q2(clampSize('text', measured)) } }],
		inverse: [{ o: 'patch', id, p: { h: item.h } }],
	}
}

/**
 * The item a text height is measured for: `item` with the given overrides
 * (w, style.fontSize, data.text), as scene.measureTextHeight() takes it.
 *
 * @param {object} item WireItem
 * @param {{w?: number, fontSize?: number, text?: string}} o overrides
 * @return {object} new WireItem
 */
export function measureTarget(item, { w, fontSize, text } = {}) {
	const out = clone(item)
	if (isNum(w)) {
		out.w = w
	}
	if (isNum(fontSize)) {
		setPath(out, 'style.fontSize', fontSize)
	}
	if (typeof text === 'string') {
		setPath(out, 'data.text', text)
	}
	return out
}

/**
 * Lock (M2, SPEC-M1 §1.2 "(R20) Sperren"): one patch {lock: lockValue(me)}
 * per item of ids the model holds that is not locked yet, inverse {lock:
 * null}. The server sets the locker from the principal; the value only makes
 * the optimistic state equal to the server echo.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {object} me the own session ({pid, name})
 * @return {{ops: object[], inverse: object[]}}
 */
export function lockItems(model, ids, me) {
	const ops = []
	const inverse = []
	for (const id of new Set(ids ?? [])) {
		if (!model.has(id) || isLocked(model.get(id))) {
			continue
		}
		ops.push({ o: 'patch', id, p: { lock: lockValue(me) } })
		inverse.push({ o: 'patch', id, p: { lock: null } })
	}
	return { ops, inverse }
}

/**
 * Unlock (M2, R20): one patch {lock: null} per item of ids that me may
 * unlock (mayUnlock: own lock, or a moderator), inverse {lock:
 * lockValue(me)} (undoing an unlock locks again, with me as the locker).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {object} me the own session ({pid, name, role, mod})
 * @return {{ops: object[], inverse: object[]}}
 */
export function unlockItems(model, ids, me) {
	const ops = []
	const inverse = []
	for (const id of new Set(ids ?? [])) {
		if (!model.has(id) || !mayUnlock(model.get(id), me)) {
			continue
		}
		ops.push({ o: 'patch', id, p: { lock: null } })
		inverse.push({ o: 'patch', id, p: { lock: lockValue(me) } })
	}
	return { ops, inverse }
}

/**
 * "Group items" (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): C =
 * model/groups.js groupPlan(ids) (the items with the members of their
 * groups, connectors left out, stacking order). Blocked ('frame',
 * 'locked', 'parent', the first reason): no ops. Empty for fewer than two
 * items in C or when C is exactly the members of one group. Otherwise one
 * patch {group: g} per item under a new id g = newId(), the inverse
 * {group: <its old group or null>}: one undo step. A selection with groups
 * becomes ONE new group of all their members (one level).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], ids: string[], blocked: (null|'frame'|'locked'|'parent')}}
 */
export function groupItems(model, ids, newId = ulid) {
	const plan = groupPlan(model, ids)
	if (plan.blocked !== null || plan.ids.length < 2 || isOneGroup(model, plan.ids)) {
		return { ops: [], inverse: [], ids: plan.ids, blocked: plan.blocked }
	}
	const g = newId()
	return {
		ops: plan.ids.map((id) => ({ o: 'patch', id, p: { group: g } })),
		inverse: plan.ids.map((id) => ({ o: 'patch', id, p: { group: model.get(id).group ?? null } })),
		ids: plan.ids,
		blocked: null,
	}
}

/**
 * "Ungroup" (M2, R20): every group of the selection (model/groups.js
 * groupOf) is dissolved, {group: null} per member and the inverse
 * {group: g}, one undo step. A locked member of one of them blocks it
 * ('locked', no ops): it could not be patched.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @return {{ops: object[], inverse: object[], blocked: (null|'locked')}}
 */
export function ungroupItems(model, ids) {
	const plan = ungroupPlan(model, ids)
	if (plan.blocked !== null) {
		return { ops: [], inverse: [], blocked: plan.blocked }
	}
	const ops = []
	const inverse = []
	for (const g of plan.groups) {
		for (const id of model.membersOf(g)) {
			ops.push({ o: 'patch', id, p: { group: null } })
			inverse.push({ o: 'patch', id, p: { group: g } })
		}
	}
	return { ops, inverse, blocked: null }
}
