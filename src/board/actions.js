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
 * Align, distribute, tidy up and sort by colour (alignItems, distributeItems,
 * tidyItems, sortNotesByColor, readingOrder …) live in board/arrangeActions.js
 * (job 254); this module re-exports them.
 *
 * M2 (SPEC-M1 §1.2 "(R20) Sperren"): lockItems and unlockItems give one
 * lock patch per item ({lock: lockValue(me)} / {lock: null}, model/locks.js)
 * with the opposite patch as inverse; together one undo step. Only items
 * that are not locked are locked, only items me may unlock are unlocked.
 * (job 152) Undoing the unlock of someone else's lock restores that lock
 * (restore: true), never one in me's name.
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
 *
 * Job 136 (neighbour with one click): neighbourItem puts an empty item of the
 * source's kind, size, rotation and style beside it, SERIES_GAP away, moved on
 * past every item it would cover; one put, inverse its remove. Job 148: with
 * `connect` (a click on "+") a second put joins the source and the neighbour
 * with a connector at their facing anchors; inverse remove C, then N. Job
 * 159: a text item's neighbour is a copy with its text, size and rotation.
 * Job 162: with `connect` a note or shape that has a near item in that
 * direction gets only a connector to it (plusPlan of model/plus.js, which
 * also holds the place of the neighbour, neighbourBox).
 *
 * Job 153 (swap direction): swapCaps gives every unlocked connector whose
 * two tips differ (swappableIds, by display value) one patch that stores
 * both tips swapped; the inverse restores the stored values (a missing one
 * as null). Route, ends, label and line stay.
 *
 * Job 188 (note pads, model/pad.js): createItem makes a pad without an
 * editor (edit false); takeNote takes a blank note off a pad, one put of a
 * sticky in the pad's size and colour, the pad itself gets no op.
 *
 * Job 191 (tags, model/tags.js): copyPayload carries `tags`, the board's
 * tags its notes use (option tags: the board's list); pasteItems maps every
 * note's data.tags through the option tagMap (planPasteTags: old id → the
 * board's id; an id without an entry goes, no tagMap: no tags at all);
 * duplicateItems keeps the tags (the same board). Ticking a tag is
 * model/tags.js tagPatch.
 */
import { FLOWS, normalizeEndpoint, anchorPoint, anchorsFor, plusEndCap, remapEndpoint } from '../model/connectors.js'
import { rotatedBBox } from '../model/geometry.js'
import { frameAroundPlan, groupOf, groupPlan, heldGroup, isOneGroup, ungroupPlan, wholeGroups } from '../model/groups.js'
import { ULID_RE, ulid } from '../model/ids.js'
import { isLocked, lockValue, mayUnlock } from '../model/locks.js'
import { getPath, setPath } from '../model/paths.js'
import { withoutReactions } from '../model/reactions.js'
import { remapTagIds, usedTags } from '../model/tags.js'
import { PAD_SHEETS_REACH } from '../model/pad.js'
import { pointsOf, round1, strokeItem } from '../model/ink.js'
import { NEIGHBOUR_SIDES, SERIES_GAP, movePast, neighbourBox, plusPlan } from '../model/plus.js'
import { POINTS_MAX, canBeChildOf, checkField, fieldRule, fieldValue, isBindable, isGroupable, typeInfo, TYPES } from '../model/registry.js'
import { checkTable, gridRows, hasHtmlTable, newTableData } from '../model/table.js'
import { LANE_FRAME_H, LANE_FRAME_MIN_H, LANE_FRAME_MIN_W, LANE_FRAME_W, newLanes, resizeLanes } from '../model/lanes.js'
import { checkMindmap, estimateNodeSize, mindmapFromOutline, mindmapLayout, newMindmapData } from '../model/mindmap.js'
import { fillBorder, isImageKind, isTextless, shapeOf, squareOn } from '../model/shapes.js'
import { isCovered } from '../model/privateWriting.js'
import { isValidKey, keyBetween, keysBetween } from '../model/zorder.js'
import { wellFormed } from '../util/unicode.js'
import { absOf, clampSize, clone, containerFor, isNum, placement, q2, round2 } from './actionsBase.js'

export { round2 }
export { ALIGN_EDGES, DISTRIBUTE_AXES, SORT_BLOCK_GAP, SORT_GAP, SORT_MARGIN, SORT_NAME_GAP, alignableIds, alignItems, distributeItems, readingOrder, sortBlockName, sortNotesByColor, sortableNotes, tidyItems } from './arrangeActions.js'

/** Most items of one paste (SPEC-M1 §4.8 PASTE_MAX, client only). */
export const PASTE_MAX = 1000
/** Most live items of a board when the initial state has no limits.maxItems (§4.8). */
export const DEFAULT_MAX_ITEMS = 5000
/** Grid step of notes made from plain text (§6.5.2). */
export const NOTE_GRID = 220
/** Gap between a note and the next one of a series entry (§6.5.1); (job 162) defined in model/plus.js. */
export { SERIES_GAP }
/** Absolute limit of coordinates (server NUM_ABS_MAX); "Arrange" clamps x and y to it (job 146). */
export const NUM_ABS_MAX = 1e7
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
 *   height is measured, rule 13) and, without rect, is centered on `at`
 *   like the others (job 241: its text is centred, TYPES.text.defaults)
 * - data/style: registry defaults plus the intent's values (tool options,
 *   series entry), each typed field only when it passes its rule
 * - parent: topmost container under the center (non-containers)
 * - a frame from `rect` adopts every top-level non-container item whose box
 *   lies completely inside; a group (M2, R20 Gruppieren) only as a whole
 *   (every member inside), like membership after a transform
 * - edit: the editor should open (note, shape, text; SPEC-M1 §6.3; job 143:
 *   a frame too, its title editor; job 173: a table, its top-left cell;
 *   job 193: a note pad, its title editor, like a frame)
 * - (job 173) a table: data is a new 3 × 3 table (model/table.js
 *   newTableData), or the intent's data when it is one (checkTable)
 * - (job 195) a mind map: data is its empty root (model/mindmap.js
 *   newMindmapData), or the intent's data when it is one (checkMindmap);
 *   the editor of its root opens
 * - (job 199) a frame with lanes (lanes: the names of its new lanes):
 *   LANE_FRAME_W × LANE_FRAME_H without rect, at least LANE_FRAME_MIN_W ×
 *   LANE_FRAME_MIN_H from rect, and data.lanes with one lane of equal
 *   height per name (model/lanes.js newLanes)
 * - (job 201) a shape of a kind with its own look (model/shapes.js create):
 *   its size without rect, its style always (the intent's style on top); a
 *   symbol opens no editor (edit false)
 * - (job 203) size: the default size {w, h} without rect, before the
 *   kind's own (an own shape takes the proportions of its library entry,
 *   model/shapeImage.js pictureSize)
 *
 * Connectors are created with connectItems (round 1b), never here.
 *
 * @param {object} model SceneModel
 * @param {{t: string, at?: {x: number, y: number}, rect?: ({x,y,w,h}|null), data?: object, style?: object, lanes?: (string[]|null),
 *   size?: ({w: number, h: number}|null)}} intent
 *   create intent
 * @param {() => string} [newId] id generator
 * @param {() => number} [rand] (job 199) random numbers for the keys of new lanes
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean}}
 */
export function createItem(model, { t, at, rect = null, data, style, lanes = null, size = null }, newId = ulid, rand = Math.random) {
	const info = TYPES[t]
	if (!info || info.placement !== 'box') {
		return { ops: [], inverse: [], selectIds: [], edit: false }
	}
	const d = info.defaults
	const id = newId()
	// (job 201) the kind's own size and look; an invalid kind is dropped by mergeFields, so it has none
	const kind = t === 'shape' && checkField('shape', 'data.kind', data?.kind).ok ? data.kind : null
	const own = kind === null ? null : (shapeOf(kind).create ?? null)
	const sized = size && isNum(size.w) && isNum(size.h) && size.w > 0 && size.h > 0
	const dw = sized ? size.w : (own?.w ?? d.w)
	const dh = sized ? size.h : (own?.h ?? d.h)
	let box
	const p = at && isNum(at.x) && isNum(at.y) ? at : { x: 0, y: 0 }
	if (rect && isNum(rect.w) && isNum(rect.h) && rect.w > 0 && (rect.h > 0 || t === 'text')) {
		box = { x: rect.x, y: rect.y, w: rect.w, h: t === 'text' ? d.h : rect.h }
	} else {
		box = { x: p.x - dw / 2, y: p.y - dh / 2, w: dw, h: dh }
	}
	// (job 199) a frame with lanes: its own default and least size
	const laned = t === 'frame' && Array.isArray(lanes) && lanes.length > 0
	if (laned) {
		const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
		const w = rect ? Math.max(LANE_FRAME_MIN_W, box.w) : LANE_FRAME_W
		const h = rect ? Math.max(LANE_FRAME_MIN_H, box.h) : LANE_FRAME_H
		box = rect ? { x: box.x, y: box.y, w, h } : { x: c.x - w / 2, y: c.y - h / 2, w, h }
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
			data: t === 'table' ? (checkTable(data) ? clone(data) : newTableData())
				: t === 'mindmap' ? (checkMindmap(data) ? clone(data) : newMindmapData())
					: mergeFields(t, 'data', d.data, data),
			style: mergeFields(t, 'style', own?.style ? { ...d.style, ...own.style } : d.style, style),
		},
	}
	if (laned) {
		put.p.data = { ...put.p.data, lanes: newLanes(put.p.h, lanes, rand) }
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
	return { ops, inverse, selectIds: [id], edit: (info.textPath !== null && !isTextless(kind)) || t === 'table' || t === 'mindmap' }
}

/**
 * (Job 273) A new pen stroke: ONE put of type pen (model/ink.js strokeItem)
 * from its points in world units, already fitted (at most 500 points). Its
 * parent is the frame under its first point; it lies on top of the content.
 * Kind, colour and width are taken when they pass their rule, else the
 * registry defaults. Nothing is selected (selectIds empty), no editor.
 *
 * @param {object} model SceneModel
 * @param {{points: number[], kind?: string, stroke?: string, strokeWidth?: number}} s the stroke
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean}}
 */
export function createStroke(model, { points, kind, stroke, strokeWidth }, newId = ulid) {
	const pts = pointsOf(points)
	const none = { ops: [], inverse: [], selectIds: [], edit: false }
	if (pts.length < 2 || pts.length > POINTS_MAX) return none
	const d = TYPES.pen.defaults
	const given = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))
	const data = mergeFields('pen', 'data', d.data, given({ kind }))
	const style = mergeFields('pen', 'style', d.style, given({ stroke, strokeWidth }))
	const s = strokeItem(pts, style.strokeWidth)
	const parent = containerFor(model, 'pen', pts[0], pts[1], new Set())
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	const id = newId()
	const put = {
		o: 'put', id, t: 'pen',
		p: {
			x: round1(s.x - pa.x), y: round1(s.y - pa.y), w: s.w, h: s.h, r: 0,
			z: keyBetween(model.maxZ('content'), null), parent, data: { ...data, points: s.points }, style,
		},
	}
	return { ops: [put], inverse: [{ o: 'remove', id }], selectIds: [], edit: false }
}

/**
 * Takes a note off a note pad (job 188): ONE put of a sticky, the pad itself
 * gets no op (locked or not).
 *
 * - the note: w × h of the pad, style.fill = fieldValue(pad, 'style.fill'),
 *   data.text '', r 0, z on top of the content layer (createItem with rect)
 * - at {x, y}: its top-left corner in world units (a drag from the pile: the
 *   pile's corner plus the pointer's way); parent the topmost fitting
 *   container under its centre (containerFor)
 * - at null (Enter at the selected pad): right of the pad, SERIES_GAP
 *   beyond its sheets (from x + w + PAD_SHEETS_REACH, job 263: 0), flush with its top,
 *   moved on past every item it would cover (model/plus.js movePast, the
 *   rule of neighbourBox's right side); parent the pad's frame when the
 *   note fits into it completely, else as with at
 *
 * @param {object} model SceneModel
 * @param {string} padId the pad
 * @param {{at?: ({x: number, y: number}|null)}} [o] where the note goes
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean}} edit true: the note's
 *   editor opens; no ops for anything but a pad of the model or an invalid at
 */
export function takeNote(model, padId, { at = null } = {}, newId = ulid) {
	const none = { ops: [], inverse: [], selectIds: [], edit: false }
	const pad = typeof padId === 'string' && model.has(padId) ? model.get(padId) : null
	const a = pad?.t === 'pad' ? model.abs(padId) : null
	if (!a) {
		return none
	}
	const w = clampSize('sticky', a.w)
	const h = clampSize('sticky', a.h)
	const beside = at === null || at === undefined
	let rect
	if (beside) {
		const b = movePast(model, { cx: a.x + a.w + PAD_SHEETS_REACH + SERIES_GAP + w / 2, cy: a.y + h / 2, w, h, r: 0 }, [1, 0], w / 2)
		rect = { x: b.x, y: b.y, w, h }
	} else if (isNum(at.x) && isNum(at.y)) {
		rect = { x: at.x, y: at.y, w, h }
	} else {
		return none
	}
	const r = createItem(model, { t: 'sticky', at: null, rect, style: { fill: fieldValue(pad, 'style.fill') } }, newId)
	const parent = pad.parent ?? null
	if (beside && r.ops.length > 0 && parent !== null && model.has(parent) && canBeChildOf('sticky', model.get(parent).t)) {
		// Enter: the pad's frame when the note fits into it completely (like nextNote)
		const f = model.abs(parent)
		if (f && rect.x >= f.x && rect.y >= f.y && rect.x + w <= f.x + f.w && rect.y + h <= f.y + f.h) {
			const put = r.ops[0]
			put.p.parent = parent
			put.p.x = q2(rect.x - f.x)
			put.p.y = q2(rect.y - f.y)
		}
	}
	return r
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
	const id = newId()
	const put = connectorPut(id, s, e, { route, endCap }, keyBetween(model.maxZ(TYPES.connector.layer), null))
	return { ops: [put], inverse: [{ o: 'remove', id }], selectIds: [id] }
}

/**
 * The put of a new connector (connectItems, neighbourItem): x = y = w = h =
 * r = 0 and parent null (rule 12), the stored ends `s` and `e`, data.route
 * and style.endCap from the options when they pass their rules, else the
 * registry defaults (the put stores them); the rest of the style is the
 * default.
 *
 * @param {string} id connector id
 * @param {object} s stored start
 * @param {object} e stored end
 * @param {{route?: unknown, endCap?: unknown}} o tool options
 * @param {string} z z key
 * @return {object} put op
 */
function connectorPut(id, s, e, { route, endCap }, z) {
	const info = TYPES.connector
	// an option that is not given keeps the default (mergeFields deletes a field given as null/undefined)
	const data = mergeFields('connector', 'data', info.defaults.data, route === undefined || route === null ? {} : { route })
	data.start = s
	data.end = e
	return {
		o: 'put',
		id,
		t: 'connector',
		p: {
			x: 0,
			y: 0,
			w: 0,
			h: 0,
			r: 0,
			z,
			parent: null,
			data,
			style: mergeFields('connector', 'style', info.defaults.style, endCap === undefined || endCap === null ? {} : { endCap }),
		},
	}
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
 * value must pass that rule (stored in its normalised form). Every type
 * takes the same value: a frame keeps a picked colour unchanged, also in a
 * mixed selection (job 135; before, it became the nearest frame colour). null
 * deletes the field (e.g. font size "Auto"; never a required field). For
 * `text` items heights.get(id) is the measured height of the new state
 * (rule 13). (Job 203) data.kind never changes an own shape (kind image)
 * nor turns another shape into one. (Job 260) A fill from the palette on a
 * basic or flowchart shape brings its border along in the same patch: the
 * strong tone of that colour (shapes.js fillBorder), one undo step.
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
		// (job 203) an own shape keeps its kind, and no other shape becomes one (it has no picture)
		if (path === 'data.kind' && item.t === 'shape' && (isImageKind(fieldValue(item, 'data.kind')) || isImageKind(value))) {
			continue
		}
		let v = null
		if (value !== null && value !== undefined) {
			const c = checkField(item.t, path, value)
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
		// (job 260) tone on tone: the border follows a fill picked from the palette
		const border = path === 'style.fill' && item.t === 'shape' && fillBorder(fieldValue(item, 'data.kind'), v)
		if (border && border !== item.style?.stroke) {
			p['style.stroke'] = border
			inv['style.stroke'] = item.style?.stroke ?? null
		}
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
 * (job 153) The items "Swap direction" changes: those of `ids` the model
 * has, that are not locked, whose type has both tips (connectors) and whose
 * tips differ in their display value (fieldValue: a missing or unknown tip
 * is 'none').
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items (e.g. the selection)
 * @return {string[]} in the order of ids, each once
 */
export function swappableIds(model, ids) {
	const out = []
	for (const id of new Set(ids ?? [])) {
		const item = model.has(id) ? model.get(id) : null
		if (!item || isLocked(item) || fieldRule(item.t, 'style.startCap') === null || fieldRule(item.t, 'style.endCap') === null) {
			continue
		}
		if (fieldValue(item, 'style.startCap') !== fieldValue(item, 'style.endCap')) {
			out.push(id)
		}
	}
	return out
}

/**
 * (job 153) "Swap direction": one patch per swappable item (swappableIds)
 * with both tips, start = the end's display value and end = the start's,
 * both stored ('none' too). The inverse puts back what was stored before:
 * the same value (also one the rules no longer know) or null for a missing
 * tip. Equal tips, locked items and other types give no op.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @return {{ops: object[], inverse: object[]}}
 */
export function swapCaps(model, ids) {
	const ops = []
	const inverse = []
	for (const id of swappableIds(model, ids)) {
		const item = model.get(id)
		const stored = (path) => {
			const v = getPath(item, path)
			return v === null || v === undefined ? null : clone(v)
		}
		ops.push({ o: 'patch', id, p: { 'style.startCap': fieldValue(item, 'style.endCap'), 'style.endCap': fieldValue(item, 'style.startCap') } })
		inverse.push({ o: 'patch', id, p: { 'style.startCap': stored('style.startCap'), 'style.endCap': stored('style.endCap') } })
	}
	return { ops, inverse }
}

/**
 * (Job 204) "Sequence flow" / "Message flow": one patch per unlocked
 * connector of ids with those fields of FLOWS[flow] (model/connectors.js) whose display value
 * differs; the inverse puts back what was stored (null for a missing field).
 * Other types, locked items and connectors that look so already give no op.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {string} flow sequence | message
 * @return {{ops: object[], inverse: object[]}}
 */
export function setFlow(model, ids, flow) {
	const ops = []
	const inverse = []
	const look = Object.prototype.hasOwnProperty.call(FLOWS, flow) ? FLOWS[flow] : null
	if (look === null) return { ops, inverse }
	for (const id of new Set(ids)) {
		const item = model.has(id) ? model.get(id) : null
		if (!item || item.t !== 'connector' || isLocked(item)) continue
		const p = {}
		const inv = {}
		for (const [path, value] of Object.entries(look)) {
			if (fieldValue(item, path) === value) continue
			const v = getPath(item, path)
			p[path] = value
			inv[path] = v === null || v === undefined ? null : clone(v)
		}
		if (Object.keys(p).length === 0) continue
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
		// (job 199) a frame with lanes: its first (top edge moved) or last lane takes the change of its height;
		// (job 208) its first (left edge moved) or last column the change of its width
		const lp = resizeLanes(item, b, { x: a.x, y: a.y, w: p.w, h: p.h })
		if (lp) {
			Object.assign(p, lp.p)
			Object.assign(inv, lp.inv)
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
 * Job 146 (R22): x and y are clamped to ±NUM_ABS_MAX, silently; an item that
 * already lies farther out keeps its current absolute value as the limit on
 * that side (a child of a frame at the edge), so an unchanged field never
 * moves it.
 * Job 160: the stored x and y (relative to the parent) are clamped to
 * ±NUM_ABS_MAX as well, the tighter of both limits wins (clampCoord), so a
 * frame's child moves as far to the edge as it can instead of being refused
 * (`bad`); the frame membership never changes.
 * Job 240: square true or false ticks or unticks "1:1" of a shape
 * (style.square 'on' or 'off', in the same patch; other types ignore it);
 * while the tick acts (model/shapes.js squareOn, with the new value) the
 * height follows the width.
 *
 * @param {object} model SceneModel
 * @param {string} id item
 * @param {{x?: number, y?: number, w?: number, h?: number, r?: number, square?: boolean}} box target (absolute, world)
 * @param {{textH?: number}} [o] measured height of a text item
 * @return {{ops: object[], inverse: object[]}}
 */
export function arrangeItem(model, id, { x, y, w, h, r, square } = {}, { textH } = {}) {
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
	// the parent's absolute top-left as transformItems takes it ({0, 0} without or with an unknown parent)
	const pa = absOf(model, b.parent) ?? { x: 0, y: 0 }
	const sized = info.resize !== 'none'
	const a = {
		x: isNum(x) ? clampCoord(x, cur.x, pa.x) : cur.x,
		y: isNum(y) ? clampCoord(y, cur.y, pa.y) : cur.y,
		w: sized && isNum(w) && w > 0 ? clampSize(item.t, w) : cur.w,
		h: sized && item.t !== 'text' && isNum(h) && h > 0 ? clampSize(item.t, h) : cur.h,
		r: info.rotatable && isNum(r) ? r : (cur.r ?? 0),
		fontSize,
	}
	// (job 240) the tick "1:1": the width counts, the height follows
	const sq = item.t === 'shape' && typeof square === 'boolean' ? (square ? 'on' : 'off') : undefined
	if (sized && squareOn(item, sq)) {
		a.h = a.w
	}
	const heights = new Map()
	if (item.t === 'text' && isNum(textH) && textH > 0) {
		heights.set(id, textH)
	}
	const res = transformItems(model, { ids: [id], before: new Map([[id, b]]), after: new Map([[id, a]]), keep: false, heights })
	const was = getPath(item, 'style.square')
	if (sq !== undefined && sq !== was && res.ops[0]?.id === id) {
		res.ops[0].p['style.square'] = sq
		res.inverse[0].p['style.square'] = was ?? null
	}
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
 * One axis of "Arrange": the absolute limit (job 146) and the limit of the
 * stored value cur − pa (job 160), the tighter wins. A side the item already
 * exceeds keeps its current value as the limit there, so the current
 * position always lies inside and an unchanged field never moves the item.
 * Without a parent (pa = 0) both limits are the same.
 *
 * @param {number} v target coordinate of "Arrange" (absolute, world)
 * @param {number} cur the item's current absolute coordinate
 * @param {number} [pa] the parent's absolute coordinate (0 without a parent)
 * @return {number} v within [max(min(−M, cur), pa + min(−M, cur − pa)), min(max(M, cur), pa + max(M, cur − pa))], M = NUM_ABS_MAX
 */
function clampCoord(v, cur, pa = 0) {
	if (!isNum(cur)) {
		return Math.min(NUM_ABS_MAX, Math.max(-NUM_ABS_MAX, v))
	}
	const p = isNum(pa) ? pa : 0
	const rel = cur - p
	const lo = Math.max(Math.min(-NUM_ABS_MAX, cur), p + Math.min(-NUM_ABS_MAX, rel))
	const hi = Math.min(Math.max(NUM_ABS_MAX, cur), p + Math.max(NUM_ABS_MAX, rel))
	return Math.min(hi, Math.max(lo, v))
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
 * - (job 172) data.react is left out: a copy starts without reactions
 * - (job 275) a covered note of private writing is left out, also as a
 *   descendant of a selected frame (its covered form is no content)
 * - (job 191) tags: the tags of the board's list (option tags) that a note
 *   of the payload carries, in the list's order ([] without the option)
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {{board?: number|null, tags?: Array<{id: string, name: string, color: string}>}} [o] board id of the
 *   source; (job 191) the board's tags (model/tags.js tagsOf)
 * @return {{knorke: 1, board: (number|null), origin: [number, number], items: object[], tags: object[]}}
 */
export function copyPayload(model, ids, { board = null, tags = [] } = {}) {
	const sel = [...new Set(ids ?? [])].filter((id) => model.has(id) && !isCovered(model.get(id)))
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
				if (model.has(d) && !isCovered(model.get(d))) {
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
		const data = clone(withoutReactions(it.data))
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
	// job 191: the tags its notes use
	const used = usedTags(items, Array.isArray(tags) ? tags : [])
	return { knorke: 1, board: Number.isInteger(board) ? board : null, origin: u ? [u.x, u.y] : [0, 0], items, tags: used }
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
 * - (job 172) no put carries data.react (a payload of an older tab or another
 *   board may still have it): pasted items start without reactions
 * - (job 191) a note's data.tags goes through tagMap (model/tags.js
 *   remapTagIds: mapped ids in order, unknown ones dropped, none: no field);
 *   without tagMap no note carries tags
 * One undo step: the inverse removes everything again (connectors first).
 *
 * @param {object} model SceneModel
 * @param {{board?: (number|null), items: object[]}} payload validated payload
 * @param {{at?: ({x:number,y:number}|null), inPlace?: boolean, offset?: ({x:number,y:number}|null),
 *   limits?: (object|null), board?: (number|null), tagMap?: (Map<string, string>|null)}} [o] placement, the current
 *   board and (job 191) the tag ids of the payload → the board's (planPasteTags)
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], skipped: number, full: boolean}}
 */
export function pasteItems(model, payload, { at = null, inPlace = false, offset = null, limits = null, board = null, tagMap = null } = {}, newId = ulid) {
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
			data: it.t === 'sticky' ? withTags(clone(withoutReactions(it.data)), tagMap) : clone(withoutReactions(it.data)),
			style: clone(it.style ?? {}),
			group: groupOfPut(it),
		})
	}
	const keepMap = new Map(idMap)
	for (const it of connectors) {
		const data = clone(withoutReactions(it.data))
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
 * (Job 191) A pasted note's data with its tags mapped (remapTagIds).
 *
 * @param {object} data the note's data (a fresh copy)
 * @param {Map<string, string>|null} tagMap tag ids of the payload → the board's
 * @return {object} data, with data.tags mapped or removed
 */
function withTags(data, tagMap) {
	if (!isMap(data) || !('tags' in data)) {
		return data
	}
	const tags = remapTagIds(data.tags, tagMap)
	if (tags === null) {
		delete data.tags
	} else {
		data.tags = tags
	}
	return data
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
 * clipboard, `offset` world units right and down of the originals. (Job
 * 191) The copies keep their notes' tags (the board's list: tags).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @param {{offset?: number, limits?: (object|null), board?: (number|null), tags?: object[]}} [o] options
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], skipped: number, full: boolean}}
 */
export function duplicateItems(model, ids, { offset = 20, limits = null, board = null, tags = [] } = {}, newId = ulid) {
	const payload = copyPayload(model, ids, { board, tags })
	const tagMap = new Map(payload.tags.map((tg) => [tg.id, tg.id]))
	return pasteItems(model, payload, { offset: { x: offset, y: offset }, limits, board, tagMap }, newId)
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

/** (Job 218) Most notes of one text paste; what goes beyond is left out. */
export const PASTE_NOTES_MAX = 1000

/**
 * The notes that plain text turns into (SPEC-M1 §6.5.2), with grid cells:
 * - text with a tab, or (job 218) an HTML table in the clipboard's text/html
 *   (a spreadsheet, also a single column): a grid; one trailing line break
 *   goes, model/table.js splitGrid gives the rows and cells (a quoted cell
 *   keeps its line breaks, tabs and quotes); one note per non-empty cell at
 *   its column/row, empty cells keep their place
 * - otherwise one note per non-empty line, in a grid of ceil(sqrt(n)) columns
 * - each text is cleaned like the server does (well-formed UTF-16, "\r\n" →
 *   "\n", C0 controls removed); a text above the note limit is split into
 *   several notes (stacked below each other in table mode), never shortened
 * - (job 218) at most max notes in reading order (row by row, the parts of a
 *   split text one by one); the work stops there
 * - (job 220) with sep (a CSV file's separator) always a grid, its cells
 *   split at sep instead of the tab
 *
 * @param {string} text plain text
 * @param {{html?: string, max?: number, sep?: string}} [o] text/html of the clipboard (only searched for a table), most notes,
 *   the cell separator of a CSV file
 * @return {Array<{text: string, col: number, row: number}>}
 */
export function noteTexts(text, { html = '', max = Infinity, sep = '' } = {}) {
	const rule = fieldRule('sticky', 'data.text')
	const size = rule ? rule[1] : 6000
	const norm = wellFormed(String(text ?? '')).replace(/\r\n?/g, '\n')
	const clean = (s) => {
		const c = checkField('sticky', 'data.text', s)
		return c.ok ? c.norm : ''
	}
	const out = []
	if (sep !== '' || norm.includes('\t') || hasHtmlTable(html)) {
		let row = 0
		for (const fields of gridRows(norm.replace(/\n$/, ''), sep || '\t')) {
			let height = 0
			for (let col = 0; col < fields.length; col++) {
				if (fields[col].trim() === '') {
					continue
				}
				const parts = splitCodePoints(fields[col], size).map(clean).filter((p) => p !== '')
				for (let k = 0; k < parts.length; k++) {
					if (out.length >= max) {
						return out
					}
					out.push({ text: parts[k], col, row: row + k })
				}
				height = Math.max(height, parts.length)
			}
			row += Math.max(1, height)
		}
		return out
	}
	const parts = []
	for (const line of norm.split('\n')) {
		if (parts.length >= max) {
			break
		}
		if (line.trim() === '') {
			continue
		}
		for (const p of splitCodePoints(line, size)) {
			const c = clean(p)
			if (c !== '' && parts.length < max) {
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
 * (Job 218) At most PASTE_NOTES_MAX notes, the rest is left out (cut: true).
 *
 * @param {object} model SceneModel
 * @param {string} text plain text
 * @param {{at?: ({x:number,y:number}|null), limits?: (object|null), html?: string, sep?: string}} [o] center of the grid,
 *   limits, text/html of the clipboard, (job 220) a CSV file's separator (noteTexts)
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], count: number, full: boolean, cut?: boolean}}
 *   cut only when notes were made
 */
export function notesFromText(model, text, { at = null, limits = null, html = '', sep = '' } = {}, newId = ulid) {
	const all = noteTexts(text, { html, sep, max: PASTE_NOTES_MAX + 1 })
	const cut = all.length > PASTE_NOTES_MAX
	const notes = cut ? all.slice(0, PASTE_NOTES_MAX) : all
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
	return { ops, inverse, selectIds, count: n, full: false, cut }
}

/**
 * (Job 195) An indented list pasted on the board (model/mindmap.js
 * parseOutline): ONE put of a mind map (mindmapFromOutline: what goes beyond
 * the limits is left out, cut), its root centred on at, the box its hull
 * (mindmapLayout with measure), the parent the topmost container under the
 * root's centre; nothing when the board is full. (Job 268) layout: the
 * mind map's style.layout (both when absent); centre 'hull': the middle of
 * the hull lies on at instead of the root's centre.
 *
 * @param {object} model SceneModel
 * @param {{root: string, lines: Array<{depth: number, text: string}>}} outline parseOutline
 * @param {{at?: ({x: number, y: number}|null), limits?: object|null, measure?: Function, maxBytes?: number, rand?: () => number, layout?: string, centre?: ('root'|'hull')}} [o]
 *   point, limits (maxItems), text size, limits.maxItemBytes, random numbers, layout, what lies on the point
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], full: boolean, cut: number}}
 */
export function mindmapFromText(model, outline, { at = null, limits = null, measure = estimateNodeSize, maxBytes, rand = Math.random, layout = 'both', centre = 'root' } = {}, newId = ulid) {
	if (model.size + 1 > maxItemsOf(limits)) {
		return { ops: [], inverse: [], selectIds: [], full: true, cut: 0 }
	}
	const { data, cut } = mindmapFromOutline(outline, { rand, ...(Number.isInteger(maxBytes) && maxBytes > 0 ? { maxBytes } : {}) })
	const style = layout === 'org' || layout === 'tree' || layout === 'right' ? { layout } : {}
	const item = { t: 'mindmap', data, style }
	const l = mindmapLayout(item, measure)
	const root = l.byKey.get(l.root)
	const c = at && isNum(at.x) && isNum(at.y) ? at : { x: 0, y: 0 }
	const x = centre === 'hull' ? c.x - l.w / 2 : c.x - (root.x + root.w / 2)
	const y = centre === 'hull' ? c.y - l.h / 2 : c.y - (root.y + root.h / 2)
	const [min, max] = TYPES.mindmap.size
	const id = newId()
	const parent = containerFor(model, 'mindmap', c.x, c.y, new Set())
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	const put = {
		o: 'put',
		id,
		t: 'mindmap',
		p: {
			x: q2(x - pa.x), y: q2(y - pa.y), w: q2(Math.min(max, Math.max(min, l.w))), h: q2(Math.min(max, Math.max(min, l.h))), r: 0,
			z: keyBetween(model.maxZ(TYPES.mindmap.layer), null), parent, data, style,
		},
	}
	return { ops: [put], inverse: [{ o: 'remove', id }], selectIds: [id], full: false, cut }
}

/**
 * (Job 268) The tree of an AI diagram ({text, children}, AiLayout::tree)
 * as an outline for mindmapFromText: the centre is the root, every other
 * node a line with its depth, in pre-order. Nodes without a text are left
 * out with their subtree.
 *
 * @param {unknown} tree {text, children}
 * @return {{root: string, lines: Array<{depth: number, text: string}>}|null} null: no centre text
 */
export function outlineOfTree(tree) {
	const text = (n) => (n && typeof n === 'object' && typeof n.text === 'string' ? n.text.trim() : '')
	if (text(tree) === '') return null
	const lines = []
	const walk = (n, depth) => {
		for (const k of Array.isArray(n.children) ? n.children : []) {
			if (text(k) === '') continue
			lines.push({ depth, text: text(k) })
			walk(k, depth + 1)
		}
	}
	walk(tree, 1)
	return { root: text(tree), lines }
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

/** (job 148) Per side: the index of its anchor in anchorsFor (t, r, b, l) and of the facing one (t↔b, r↔l). */
const SIDE_ANCHORS = Object.freeze({ t: Object.freeze([0, 2]), r: Object.freeze([1, 3]), b: Object.freeze([2, 0]), l: Object.freeze([3, 1]) })

/**
 * Neighbour with one click (job 136): an empty item of the same kind beside
 * `id` on `side` ('t' | 'r' | 'b' | 'l'), measured in the rotated frame of
 * the source Q (rotation r around its centre):
 *
 * - type of Q, a shape with Q's data.kind, empty text; every style field
 *   stored on Q that passes its registry rule (on top of the defaults); no
 *   lock, no group; r of Q. (job 159) A text item gets a copy instead: Q's
 *   data.text (none at all for an empty text or blanks only), edit false
 * - place and size: neighbourBox (model/plus.js, job 162): w/h of Q (job
 *   159: a text item's too, nothing is measured), SERIES_GAP beyond Q's
 *   edge on that side, flush with Q across it, moved on past every item it
 *   would cover (touching, frames and connectors do not count)
 * - parent as in nextNote: Q's frame when the hull of the neighbour lies
 *   completely inside it, else the topmost fitting container under its
 *   centre (or none); z on top of the content layer, positions on the 0.01 grid
 *
 * Note, shape and text only; anything else (or an unknown side) gives no ops.
 *
 * (job 148) With `connect` (the connector tool options {route, endCap}: a
 * click on "+") a second put follows N: a connector C from Q's anchor on
 * that side (the anchor of the clicked "+", anchorsFor, order t, r, b, l)
 * to N's anchor on the facing side (t↔b, r↔l; N has Q's type and kind, so
 * the same anchors), both ends stored, route and end cap as in
 * connectItems, z above N. Ops [put N, put C], inverse [remove C, remove
 * N]; only N is selected.
 *
 * (job 162) With `connect` a note or shape first asks plusPlan: with a near
 * item X there (not joined with Q yet) the only op is the put of a
 * connector C from the anchor of the clicked "+" to X's facing anchor,
 * route and end cap as above, z above everything; inverse [remove C], X is
 * selected, no item is made. Without `connect` (Alt/Option+arrow) nothing
 * is searched, and a text item never searches.
 *
 * (job 212) At a BPMN event, task or gateway Q both connectors leave with
 * the triangle of a sequence flow instead of the tool's arrow (plusEndCap).
 *
 * @param {object} model SceneModel
 * @param {{id: string, side: string, connect?: {route?: string, endCap?: string}}} intent the source item, the
 *   side and, for a connector, its options
 * @param {object} [o] no options left (job 159: the text height of job 136 is no longer measured)
 * @param {() => string} [newId] id generator (N first, then C; only C when it connects to X)
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean}}
 */
export function neighbourItem(model, { id, side, connect } = {}, o = {}, newId = ulid) {
	const none = { ops: [], inverse: [], selectIds: [], edit: false }
	const known = typeof side === 'string' && Object.prototype.hasOwnProperty.call(NEIGHBOUR_SIDES, side)
	const src = known && typeof id === 'string' && model.has(id) ? model.get(id) : null
	const a = src !== null ? model.abs(id) : null
	if (!a || !isBindable(src.t) || TYPES[src.t]?.placement !== 'box') {
		return none
	}
	const t = src.t
	const info = TYPES[t]
	// (job 159) a text item's copy takes its text; an empty text (blanks only) gives none
	const text = t === 'text' ? fieldValue(src, 'data.text') : null
	if (t === 'text' && (typeof text !== 'string' || text.trim() === '')) {
		return none
	}
	// (job 162) a click on "+" of a note or shape joins a near item instead of making one
	const plan = isMap(connect) && t !== 'text' ? plusPlan(model, { id, side }) : null
	// (job 212) from a BPMN event, task or gateway: a sequence flow
	const endCap = isMap(connect) && t === 'shape' ? plusEndCap(getPath(src, 'data.kind'), connect.endCap) : connect?.endCap
	if (plan?.kind === 'connect') {
		const cid = newId()
		const conn = connectorPut(cid, storedEnd(plan.start), storedEnd(plan.end), { route: connect.route, endCap },
			keyBetween(model.maxZ(TYPES.connector.layer), null))
		return { ops: [conn], inverse: [{ o: 'remove', id: cid }], selectIds: [plan.target], edit: false }
	}
	const nid = newId()
	// the stored style fields of Q that pass their rule (null and missing ones keep the default)
	const copied = {}
	for (const [k, v] of Object.entries(isMap(src.style) ? src.style : {})) {
		if (v !== null && v !== undefined) {
			copied[k] = v
		}
	}
	// (job 241) a text's copy takes the alignment Q shows (left without a stored one), not the centred create default
	if (t === 'text') {
		copied.align = fieldValue(src, 'style.align')
	}
	const style = mergeFields(t, 'style', info.defaults.style, copied)
	// (job 203) an own shape's copy takes its picture
	const data = mergeFields(t, 'data', info.defaults.data, t === 'shape' ? { kind: getPath(src, 'data.kind'), img: getPath(src, 'data.img') } : t === 'text' ? { text } : undefined)
	// the place: the same box a mouse hovering this "+" previews (plusPlan)
	const { x: x0, y: y0, w, h, r } = plan?.box ?? neighbourBox(model, id, side)
	const cx = x0 + w / 2
	const cy = y0 + h / 2
	let parent = null
	const p0 = src.parent ?? null
	if (p0 !== null && model.has(p0) && canBeChildOf(t, model.get(p0).t)) {
		const f = model.abs(p0)
		const [minX, minY, maxX, maxY] = rotatedBBox(x0, y0, w, h, r)
		if (f && minX >= f.x && minY >= f.y && maxX <= f.x + f.w && maxY <= f.y + f.h) {
			parent = p0
		}
	}
	if (parent === null) {
		parent = containerFor(model, t, cx, cy, new Set())
	}
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	const z = keyBetween(model.maxZ(info.layer), null)
	const put = {
		o: 'put',
		id: nid,
		t,
		p: { x: q2(x0 - pa.x), y: q2(y0 - pa.y), w: q2(w), h: q2(h), r, z, parent, data, style },
	}
	if (!isMap(connect)) {
		return { ops: [put], inverse: [{ o: 'remove', id: nid }], selectIds: [nid], edit: t !== 'text' && !isTextless(data.kind) }
	}
	// (job 148) the connector Q → N between the anchor of the clicked "+" and the facing one of N, above N
	const [from, to] = SIDE_ANCHORS[side]
	const qa = anchorsFor(t, getPath(src, 'data.kind'))[from]
	const na = anchorsFor(t, data.kind)[to]
	const cid = newId()
	const conn = connectorPut(cid, storedEnd({ item: id, ax: qa[0], ay: qa[1] }), storedEnd({ item: nid, ax: na[0], ay: na[1] }),
		{ route: connect.route, endCap }, keyBetween(z, null))
	return { ops: [put, conn], inverse: [{ o: 'remove', id: cid }, { o: 'remove', id: nid }], selectIds: [nid], edit: t !== 'text' && !isTextless(data.kind) }
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
 * unlock (mayUnlock: own lock, or a moderator). The inverse of me's own
 * lock (lock.by === me.pid) is {lock: lockValue(me)}: undoing locks again,
 * with me as the locker. (job 152) The inverse of someone else's or an
 * unknown lock is the restore op {lock: <that lock as it was>, restore:
 * true}: the server locks the item again for the person it remembers as
 * the last locker, only when lock.by is still that person's pid (null: an
 * unknown locker), and never in me's name; the value makes the optimistic
 * state equal to that echo.
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
		const lock = model.get(id).lock
		const by = typeof lock.by === 'string' ? lock.by : null
		ops.push({ o: 'patch', id, p: { lock: null } })
		if (by !== null && by === me.pid) {
			inverse.push({ o: 'patch', id, p: { lock: lockValue(me) } })
		} else {
			const was = { by, name: typeof lock.name === 'string' ? lock.name : null }
			if (lock.guest === true) was.guest = true
			inverse.push({ o: 'patch', id, p: { lock: was }, restore: true })
		}
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

/**
 * (Job 278) "Frame around": a new frame N around the selection
 * (model/groups.js frameAroundPlan: its box, FRAME_AROUND_MARGIN on every
 * side), parent null (frames cannot lie in frames), as one step:
 * - N is made like a frame dragged out over that box (createItem with
 *   rect): unselected top-level items completely inside are adopted, a
 *   group only as a whole; but no patch for a locked item or a group with
 *   a locked member (the server would refuse it)
 * - every mover of the plan gets parent N, also one that lay in a frame F
 *   (it leaves F)
 * - z: above every frame (so above F); with selected frames right below
 *   the lowest of them, so they lie on N
 * Blocked ('locked', 'parent') or without a box: no ops.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[], selectIds: string[], edit: boolean, blocked: (null|'locked'|'parent')}}
 */
export function frameAround(model, ids, newId = ulid) {
	const plan = frameAroundPlan(model, ids)
	if (plan.blocked !== null || plan.box === null) {
		return { ops: [], inverse: [], selectIds: [], edit: false, blocked: plan.blocked }
	}
	const r = createItem(model, { t: 'frame', rect: plan.box }, newId)
	if (r.ops.length === 0) {
		return { ops: [], inverse: [], selectIds: [], edit: false, blocked: null }
	}
	const put = r.ops[0]
	const id = put.id
	if (plan.frames.length > 0) {
		const low = model.sortByOrder(plan.frames)[0]
		const lowZ = model.get(low).z
		let below = null
		for (const oid of model.ids()) {
			const it = model.get(oid)
			if (typeInfo(it.t).layer !== 'back' || !isValidKey(it.z) || !(it.z < lowZ)) continue
			if (below === null || it.z > below) below = it.z
		}
		put.p.z = keyBetween(below, lowZ)
	}
	const ops = [put]
	const inverse = []
	const done = new Set()
	// createItem's adoptions: ops[k] pairs with inverse[k - 1]
	for (let k = 1; k < r.ops.length; k++) {
		const cid = r.ops[k].id
		const g = groupOf(model, cid)
		if (isLocked(model.get(cid)) || (g !== null && heldGroup(model, g))) continue
		ops.push(r.ops[k])
		inverse.push(r.inverse[k - 1])
		done.add(cid)
	}
	// the stored (rounded) top-left of N, parent null
	const box = { x: put.p.x, y: put.p.y }
	for (const cid of plan.movers) {
		if (done.has(cid)) continue
		const it = model.get(cid)
		const a = model.abs(cid)
		ops.push({ o: 'patch', id: cid, p: { x: q2(a.x - box.x), y: q2(a.y - box.y), parent: id } })
		inverse.push({ o: 'patch', id: cid, p: { x: it.x, y: it.y, parent: it.parent ?? null } })
		done.add(cid)
	}
	inverse.push({ o: 'remove', id })
	return { ops, inverse, selectIds: [id], edit: true, blocked: null }
}
