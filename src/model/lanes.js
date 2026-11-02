/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Swimlanes (factory job 199): a frame with data.lanes is divided into
 * horizontal lanes. The data form, its order, the bands, which children lie
 * in which lane, and the op builders. Pure; the server's mirror of checkLanes
 * and the order is lib/Service/Lanes.php, and tests/fixtures/lanes-golden.json
 * pins both sides.
 *
 * data.lanes of a frame: {"l<8>": {o: z key, h: LANE_MIN_H–LANE_MAX_H, t?: name}},
 * 1–LANES_MAX entries; a name has 1–LANE_TITLE_MAX code points after the
 * cleaning of data.title (an empty one is absent: the client sends null).
 * Lanes are ordered by o like z (byte order), then by their key. A frame
 * whose data.lanes does not have this form is drawn as a plain frame.
 *
 * Bands: the lanes lie in their order without a gap from the top to the
 * bottom of the frame; lane i is frame.h · h_i / Σh high (exactly h_i when
 * the heights add up to the frame's h). Every op below writes the drawn
 * height of every lane along when they do not (a race of two edits).
 *
 * Members: a direct child of the frame lies in the lane whose band holds
 * the centre of its box (the rotation is about the centre); a centre above
 * the first or below the last lane counts for that one. Children of one
 * group count together, by the centre of their joint hull.
 *
 * Op builders take the model (get, has, childrenOf) and give {ops, inverse}
 * for one undo step, or {error: 'gone'|'same'|'max'|'tall'|'wide'|'locked'|'last'}.
 * A moved child gets its placement group (x, y, parent: the frame) with the
 * new x and y; a locked child that would have to move gives 'locked'.
 *
 * Columns (factory job 208): data.cols of a frame with lanes, {"c<8>": {o,
 * w: COL_MIN_W–COL_MAX_W, t?}}, 1–COLS_MAX entries, the rules of a lane
 * (Lanes::checkCols on the server). With columns the head row (colTop:
 * COL_HEAD_H, at most half the frame) lies on top and the lanes below it;
 * the columns lie without a gap from the head column (laneHeadW: 0 for a
 * single lane without a name) to the right edge, in proportion when their
 * widths do not add up, and every op writes the drawn widths along then. A
 * child lies in the column whose band holds the x of its centre (groups by
 * their hull, outside the frame the first or last), so a cell is a lane and
 * a column. The ops of a column move the children by x only.
 *
 * Groups (factory job 225): data.lgroups {"g<8>": name} and data.cgroups
 * {"h<8>": name} of a frame, 1–GROUPS_MAX entries, a name 0–LANE_TITLE_MAX
 * code points ('' none: an empty map would be absent on the wire); a lane
 * (column) may carry g, the key of one of them. A run is a longest sequence
 * of neighbouring lanes (columns) with the same g; every op keeps a group in
 * one run, two edits at once may split it (each run is drawn as a cell).
 * With lane groups the head column gets the group cell (laneGroupW) left of
 * the names, with column groups the head row the group cell (colGroupH)
 * above them; the first group widens (heightens) the frame by it and moves
 * every child along, the last one going shrinks it back.
 *
 * Turned names (factory job 234): the head column is as narrow as the group
 * cell (LANE_HEAD_W 48, before 160), a lane's name stands turned like its
 * group's. A frame stored with the old head keeps its box and its children:
 * the lanes reach further left, and columns whose widths add up to the room
 * beside the old head (OLD_HEAD_W) are drawn with the first one wider by
 * the difference (colBands), so no other border moves. A name is drawn in
 * one line at nameFontSize: LANE_TITLE_SIZE, smaller down to
 * LANE_NAME_MIN_SIZE when it does not fit, then cut with "…".
 *
 * Design round 4 S4 (factory job 264): the head row is COL_HEAD_H 56 (before
 * 60), the column groups' cell COL_GROUP_H 44 (before 48). Lanes whose
 * heights add up to the room below the old head row are drawn with the
 * first one taller by the difference (laneBands), so no other border moves.
 */
import { q } from './geometry.js'
import { isLocked } from './locks.js'
import { setPath } from './paths.js'
import { boldLineWidth } from './text.js'
import { FONT_STEPS } from './tokens.js'
import { cmpBytes, isValidKey, keyBetween, keysBetween } from './zorder.js'

/** Most lanes of a frame. */
export const LANES_MAX = 30
/** Height bounds of a lane and of a new one (world units). */
export const LANE_MIN_H = 60
export const LANE_MAX_H = 100000
export const LANE_NEW_H = 200
/** Width of the head column with the names (at most half the frame's width); (job 234) as narrow as a group's cell. */
export const LANE_HEAD_W = 48
/** (Job 234) The width of the head column before job 234 (frames stored then: colBands). */
const OLD_HEAD_W = 160
/** Most code points of a name. */
export const LANE_TITLE_MAX = 200
/** The name in the head: font size (job 264: 16, before 20), padding. */
export const LANE_TITLE_SIZE = 16
export const LANE_PAD = 12
/** (Job 234) The smallest font size of a name that does not fit (then it is cut with "…"). */
export const LANE_NAME_MIN_SIZE = 12
/** A new frame with lanes: the lanes, the size of a click, the least size of a drag. */
export const LANES_NEW = 3
export const LANE_FRAME_W = 1200
export const LANE_FRAME_H = 600
export const LANE_FRAME_MIN_W = 220
export const LANE_FRAME_MIN_H = LANES_NEW * LANE_MIN_H
/** The highest a frame gets (registry size of a frame). */
export const FRAME_MAX = 100000
/** (Job 208) Most columns of a frame; the bounds of a column's width, a new one's; the height of the head row. */
export const COLS_MAX = 30
export const COL_MIN_W = 100
export const COL_MAX_W = 100000
export const COL_NEW_W = 300
export const COL_HEAD_H = 56
/** (Job 225) The width of a lane group's cell, the height of a column group's, the most groups of a frame. */
export const LANE_GROUP_W = 48
export const COL_GROUP_H = 44
/** (Job 264) The font size of a column group's name. */
export const COL_GROUP_SIZE = 14
/** (Job 264) The head row and the column groups' cell before job 264 (frames stored then: laneBands). */
const OLD_COL_HEAD_H = 60
const OLD_COL_GROUP_H = 48
export const GROUPS_MAX = 30

export const LANE_KEY_RE = /^l[0-9a-z]{8}$/
export const COL_KEY_RE = /^c[0-9a-z]{8}$/
/** (Job 225) Keys of a lane group and of a column group. */
export const LGROUP_KEY_RE = /^g[0-9a-z]{8}$/
export const CGROUP_KEY_RE = /^h[0-9a-z]{8}$/

const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
// C0 controls except \t and \n (the cleaning of data.title, registry.js cleanText)
const CONTROL_RE = /[\x00-\x08\x0B-\x1F]/g

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const absent = (v) => v === undefined || v === null
const q2 = (v) => q(v, 100)

/**
 * @param {unknown} v value
 * @return {number|null} code points after the cleaning of data.title, null for no string or a lone surrogate
 */
function nameLength(v) {
	if (typeof v !== 'string') return null
	const s = v.replace(/\r\n/g, '\n').replace(CONTROL_RE, '')
	let n = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = s.charCodeAt(i + 1)
			if (!(d >= 0xdc00 && d <= 0xdfff)) return null
			i++
		} else if (c >= 0xdc00 && c <= 0xdfff) {
			return null
		}
		n++
	}
	return n
}

/**
 * @param {unknown} map data.lanes or (job 208) data.cols
 * @param {RegExp} re the form of a key
 * @param {'h'|'w'} size the size field
 * @param {number} min least size
 * @param {number} max most size
 * @param {number} most most entries
 * @param {object|null} [groups] (job 225) the groups an entry's g may name (checked), null: none
 * @return {boolean}
 */
function checkMap(map, re, size, min, max, most, groups = null) {
	if (!isMap(map)) return false
	const keys = Object.keys(map)
	if (keys.length < 1 || keys.length > most) return false
	for (const k of keys) {
		const l = map[k]
		if (!re.test(k) || !isMap(l) || Object.keys(l).some((x) => x !== 'o' && x !== size && x !== 't' && x !== 'g')) return false
		if (!isValidKey(l.o)) return false
		const n = l[size]
		if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return false
		if (hasOwn(l, 't')) {
			const c = nameLength(l.t)
			if (c === null || c < 1 || c > LANE_TITLE_MAX) return false
		}
		if (hasOwn(l, 'g') && (typeof l.g !== 'string' || groups === null || !hasOwn(groups, l.g))) return false
	}
	return true
}

/**
 * (Job 225) The verdict of the server (Lanes::checkGroups) on data.lgroups or data.cgroups.
 *
 * @param {unknown} groups the map
 * @param {RegExp} [re] the form of a key (LGROUP_KEY_RE or CGROUP_KEY_RE)
 * @return {boolean}
 */
export function checkGroups(groups, re = LGROUP_KEY_RE) {
	if (!isMap(groups)) return false
	const keys = Object.keys(groups)
	if (keys.length < 1 || keys.length > GROUPS_MAX) return false
	for (const k of keys) {
		if (!re.test(k)) return false
		const c = nameLength(groups[k])
		if (c === null || c > LANE_TITLE_MAX) return false
	}
	return true
}

/**
 * The verdict of the server (Lanes::check) on data.lanes of a frame.
 *
 * @param {unknown} lanes data.lanes
 * @param {unknown} [groups] (job 225) data.lgroups (absent: none)
 * @return {boolean}
 */
export function checkLanes(lanes, groups = null) {
	if (!absent(groups) && !checkGroups(groups, LGROUP_KEY_RE)) return false
	return checkMap(lanes, LANE_KEY_RE, 'h', LANE_MIN_H, LANE_MAX_H, LANES_MAX, absent(groups) ? null : groups)
}

/**
 * (Job 208) The verdict of the server (Lanes::checkCols) on data.cols of a frame.
 *
 * @param {unknown} cols data.cols
 * @param {unknown} [groups] (job 225) data.cgroups (absent: none)
 * @return {boolean}
 */
export function checkCols(cols, groups = null) {
	if (!absent(groups) && !checkGroups(groups, CGROUP_KEY_RE)) return false
	return checkMap(cols, COL_KEY_RE, 'w', COL_MIN_W, COL_MAX_W, COLS_MAX, absent(groups) ? null : groups)
}

/**
 * @param {object|null|undefined} item WireItem
 * @return {boolean} a frame with lanes of the form above (job 225: and lane groups)
 */
export function hasLanes(item) {
	return item?.t === 'frame' && isMap(item.data) && checkLanes(item.data.lanes, item.data.lgroups)
}

/**
 * @param {object|null|undefined} item WireItem
 * @return {boolean} (job 208) a frame with lanes and with columns of the form above (job 225: and column groups)
 */
export function hasCols(item) {
	return hasLanes(item) && checkCols(item.data.cols, item.data.cgroups)
}

/**
 * @param {object} map data.lanes or data.cols (checked)
 * @param {'h'|'w'} size the size field
 * @return {Array<object>} {key, o, h|w, t, g} in order (t '' without a name; job 225: g null without a group)
 */
function ordered(map, size) {
	if (!isMap(map)) return []
	return Object.keys(map)
		.map((key) => ({ key, o: map[key].o, [size]: map[key][size], t: typeof map[key].t === 'string' ? map[key].t : '', g: typeof map[key].g === 'string' ? map[key].g : null }))
		.sort((a, b) => cmpBytes(a.o, b.o) || cmpBytes(a.key, b.key))
}

/**
 * @param {object} map data.lanes or data.cols (checked)
 * @return {boolean} (job 225) some entry has a group
 */
function grouped(map) {
	return isMap(map) && Object.values(map).some((l) => typeof l?.g === 'string')
}

/**
 * @param {object} lanes data.lanes (checked)
 * @return {Array<{key: string, o: string, h: number, t: string, g: (string|null)}>} the lanes in order (t '' without a name)
 */
export function orderedLanes(lanes) {
	return ordered(lanes, 'h')
}

/**
 * @param {object} cols data.cols (checked)
 * @return {Array<{key: string, o: string, w: number, t: string}>} (job 208) the columns in order
 */
export function orderedCols(cols) {
	return ordered(cols, 'w')
}

/**
 * @param {number} w width of the frame
 * @return {number} the width of the head column: LANE_HEAD_W, at most half the frame
 */
export function headWidth(w) {
	return Math.max(0, Math.min(LANE_HEAD_W, (Number.isFinite(w) ? w : 0) / 2))
}

/** (Job 234) The font sizes of a name, largest first: the FONT_STEPS from LANE_TITLE_SIZE down to LANE_NAME_MIN_SIZE. */
const NAME_SIZES = FONT_STEPS.filter((f) => f >= LANE_NAME_MIN_SIZE && f <= LANE_TITLE_SIZE).reverse()

/**
 * @param {unknown} name the name of a lane or a group
 * @return {string} (job 234) as drawn: in one line, a line break as a space
 */
export function nameLine(name) {
	return typeof name === 'string' ? name.replace(/\r?\n/g, ' ') : ''
}

/**
 * (Job 234) The font size of a name drawn in one line along a length (a
 * lane's or a lane group's height, a column group's width): the largest of
 * NAME_SIZES at which its estimated bold width (text.js boldLineWidth) fits
 * within the length less LANE_PAD on both ends, else LANE_NAME_MIN_SIZE
 * (Konva then cuts it with "…").
 *
 * @param {unknown} name the name
 * @param {number} length the length of its cell
 * @return {number} font size (world units)
 */
export function nameFontSize(name, length) {
	const s = nameLine(name)
	const room = (Number.isFinite(length) ? length : 0) - 2 * LANE_PAD
	for (const fs of NAME_SIZES) {
		if (boldLineWidth(s, fs) <= room) return fs
	}
	return LANE_NAME_MIN_SIZE
}

/**
 * @param {object} item frame with lanes
 * @return {boolean} (job 208) it has a single lane without a name (job 225: and without a group): no head column
 */
function headHidden(item) {
	const list = hasLanes(item) ? orderedLanes(item.data.lanes) : []
	return list.length === 1 && list[0].t === '' && list[0].g === null
}

/**
 * @param {object} item frame
 * @param {number} [w] its width (default item.w)
 * @return {number} (job 225) the width of the lane groups' cell: LANE_GROUP_W (at most a quarter of the frame)
 *   when a lane has a group, else 0
 */
export function laneGroupW(item, w = item?.w) {
	return hasLanes(item) && grouped(item.data.lanes) ? Math.max(0, Math.min(LANE_GROUP_W, (Number.isFinite(w) ? w : 0) / 4)) : 0
}

/**
 * @param {object} item frame
 * @param {number} [H] its height (default item.h)
 * @return {number} (job 225) the height of the column groups' cell: COL_GROUP_H (at most a quarter of the frame)
 *   when a column has a group, else 0
 */
export function colGroupH(item, H = item?.h) {
	return hasCols(item) && grouped(item.data.cols) ? Math.max(0, Math.min(COL_GROUP_H, (Number.isFinite(H) ? H : 0) / 4)) : 0
}

/**
 * @param {object} item frame with lanes
 * @param {number} [w] its width (default item.w)
 * @return {number} (job 208) the head column as drawn: headWidth, 0 for a single lane without a name (and no lanes);
 *   (job 225) the group cell plus headWidth of the rest with lane groups
 */
export function laneHeadW(item, w = item?.w) {
	if (!hasLanes(item) || headHidden(item)) return 0
	const g = laneGroupW(item, w)
	return g + headWidth(w - g)
}

/**
 * @param {object} item frame
 * @param {number} [H] its height (default item.h)
 * @return {number} (job 208) the height of the columns' head row: COL_HEAD_H, at most half the frame; 0 without columns;
 *   (job 225) plus the column groups' cell on top
 */
export function colTop(item, H = item?.h) {
	if (!hasCols(item)) return 0
	const g = colGroupH(item, H)
	return g + Math.max(0, Math.min(COL_HEAD_H, ((Number.isFinite(H) ? H : 0) - g) / 2))
}

/**
 * @param {object} item frame with lanes
 * @param {number} inner the width of all columns together
 * @return {number} (job 208) the frame's width that leaves them that room beside the head column (job 225: its group cell too)
 */
export function frameWForInner(item, inner) {
	if (headHidden(item)) return inner
	const g = hasLanes(item) && grouped(item.data.lanes) ? LANE_GROUP_W : 0
	return g + (inner >= LANE_HEAD_W ? inner + LANE_HEAD_W : inner * 2)
}

/**
 * (Job 264) Lays stored sizes (l[f]) out from start to end: as stored when
 * they add up to the room, else in proportion with the last one up to the
 * end. When they add up to the room after an older, longer head (old >
 * start), the first one is drawn longer by what the head gave up and the
 * others as stored, so no other border moves.
 *
 * @param {Array<object>} list ordered lanes or columns
 * @param {string} f the size field ('h' or 'w')
 * @param {number} start where the first one starts
 * @param {number} end where the last one ends
 * @param {number} old where the first one started before the head shrank
 * @param {string} at the position field of a band ('y' or 'x')
 * @return {Array<object>} {key, [at], [f], title, stored, g} each
 */
function spread(list, f, start, end, old, at) {
	const sum = list.reduce((s, l) => s + l[f], 0)
	const avail = end - start
	let exact = Math.abs(sum - avail) <= 0.01
	let gain = 0
	if (!exact && old - start > 0.01 && Math.abs(sum - (end - old)) <= 0.01) {
		exact = true
		gain = old - start
	}
	let p = start
	return list.map((l, i) => {
		const d = exact ? l[f] + (i === 0 ? gain : 0) : i === list.length - 1 ? end - p : avail * l[f] / sum
		const band = { key: l.key, [at]: p, [f]: d, title: l.t, stored: l[f], g: l.g }
		p += d
		return band
	})
}

/**
 * The bands of a frame's lanes, relative to the frame's top. (Job 264)
 * Heights stored below the head row before job 264 (OLD_COL_HEAD_H,
 * OLD_COL_GROUP_H): the first lane takes the room it gave up (spread).
 *
 * @param {object} item frame with lanes
 * @param {number} [H] the frame's height (default item.h)
 * @return {Array<{key: string, y: number, h: number, title: string, stored: number, g: (string|null)}>} [] for a frame
 *   without lanes (job 225: g the lane's group)
 */
export function laneBands(item, H = item?.h) {
	if (!hasLanes(item) || !Number.isFinite(H) || H <= 0) return []
	// (job 208) below the head row of the columns
	const top = colTop(item, H)
	const g = top > 0 && grouped(item.data.cols) ? Math.max(0, Math.min(OLD_COL_GROUP_H, H / 4)) : 0
	return spread(orderedLanes(item.data.lanes), 'h', top, H, top > 0 ? g + Math.max(0, Math.min(OLD_COL_HEAD_H, (H - g) / 2)) : 0, 'y')
}

/**
 * (Job 208) The bands of a frame's columns, relative to its left edge: from
 * the head column to the right edge, in proportion when the widths do not
 * add up to that room. (Job 234) When they add up to the room beside the
 * head column before job 234 (OLD_HEAD_W), the first column is drawn wider
 * by what the head gave up and the others as stored (spread).
 *
 * @param {object} item frame with lanes and columns
 * @param {number} [W] the frame's width (default item.w)
 * @return {Array<{key: string, x: number, w: number, title: string, stored: number, g: (string|null)}>} [] without
 *   columns (job 225: g the column's group)
 */
export function colBands(item, W = item?.w) {
	if (!hasCols(item) || !Number.isFinite(W) || W <= 0) return []
	const hw = laneHeadW(item, W)
	const g = laneGroupW(item, W)
	return spread(orderedCols(item.data.cols), 'w', hw, W, hw > 0 ? g + Math.max(0, Math.min(OLD_HEAD_W, (W - g) / 2)) : 0, 'x')
}

/**
 * @param {Array<{y: number, h: number}>} bands laneBands
 * @param {number} ly y relative to the frame's top
 * @return {number} the index of the band that holds ly (clamped to the first and the last), -1 without bands
 */
export function laneIndexAt(bands, ly) {
	if (bands.length === 0) return -1
	for (let i = 0; i < bands.length; i++) {
		if (ly < bands[i].y + bands[i].h) return i
	}
	return bands.length - 1
}

/**
 * @param {Array<{x: number, w: number}>} bands colBands
 * @param {number} lx x relative to the frame's left edge
 * @return {number} (job 208) the index of the column that holds lx (clamped to the first and the last), -1 without columns
 */
export function colIndexAt(bands, lx) {
	if (bands.length === 0) return -1
	for (let i = 0; i < bands.length; i++) {
		if (lx < bands[i].x + bands[i].w) return i
	}
	return bands.length - 1
}

/**
 * @param {Array<object>} bands laneBands or colBands
 * @param {unknown} groups data.lgroups or data.cgroups
 * @param {'x'|'y'} ax the axis of the bands
 * @return {Array<object>} (job 225) the runs: {key: group, from, to (band indices), keys, y|x, h|w, title}
 */
function runsOf(bands, groups, ax) {
	const size = ax === 'y' ? 'h' : 'w'
	const out = []
	bands.forEach((b, i) => {
		if (b.g === null) return
		const last = out[out.length - 1]
		if (last && last.key === b.g && last.to === i - 1) {
			last.to = i
			last.keys.push(b.key)
			last[size] += b[size]
		} else {
			const title = isMap(groups) && typeof groups[b.g] === 'string' ? groups[b.g] : ''
			out.push({ key: b.g, from: i, to: i, keys: [b.key], [ax]: b[ax], [size]: b[size], title })
		}
	})
	return out
}

/**
 * @param {object} item frame
 * @param {number} [H] its height (default item.h)
 * @return {Array<{key: string, from: number, to: number, keys: string[], y: number, h: number, title: string}>} (job 225)
 *   the runs of its lane groups, relative to its top
 */
export function laneRuns(item, H = item?.h) {
	return hasLanes(item) ? runsOf(laneBands(item, H), item.data.lgroups, 'y') : []
}

/**
 * @param {object} item frame
 * @param {number} [W] its width (default item.w)
 * @return {Array<{key: string, from: number, to: number, keys: string[], x: number, w: number, title: string}>} (job 225)
 *   the runs of its column groups, relative to its left edge
 */
export function colRuns(item, W = item?.w) {
	return hasCols(item) ? runsOf(colBands(item, W), item.data.cgroups, 'x') : []
}

/**
 * @param {Array<{g: (string|null)}>} list lanes or columns in order
 * @return {Array<Array<object>>} (job 225) the units: neighbours with the same group together, one without a group alone
 */
function unitsOf(list) {
	const out = []
	for (const l of list) {
		const last = out[out.length - 1]
		if (l.g !== null && last && last[0].g === l.g) last.push(l)
		else out.push([l])
	}
	return out
}

/**
 * (Job 225) Where a dragged group can land: the units of the other lanes
 * (ax 'y') or columns ('x') in order, each with its drawn band (a: start, b:
 * end, relative to the frame), and at, the index the group has among them now.
 *
 * @param {object} item frame
 * @param {string} g the group
 * @param {'x'|'y'} ax lane or column group
 * @return {{units: Array<{a: number, b: number}>, at: number}|null} null when no lane (column) has that group
 */
export function groupUnits(item, g, ax) {
	const bands = ax === 'y' ? laneBands(item) : colBands(item)
	const first = bands.findIndex((x) => x.g === g)
	if (first < 0) return null
	const size = ax === 'y' ? 'h' : 'w'
	const units = unitsOf(bands.map((x, i) => ({ ...x, i })).filter((x) => x.g !== g))
	return {
		units: units.map((u) => ({ a: u[0][ax], b: u[u.length - 1][ax] + u[u.length - 1][size] })),
		at: units.filter((u) => u[0].i < first).length,
	}
}

/**
 * The direct children of a frame by lane. Children of one group (two or
 * more of them in this frame) count together, by their joint hull.
 *
 * @param {object} model SceneModel (get, childrenOf)
 * @param {string} id frame with lanes
 * @param {Array<{key: string, y: number, h: number}>} [bands] laneBands of the frame
 * @return {Map<string, string[]>} lane key → child ids (every lane has an entry)
 */
export function laneMembers(model, id, bands = laneBands(model.get(id))) {
	return membersBy(model, id, bands, 'y')
}

/**
 * (Job 208) The direct children of a frame by column, as laneMembers by lane.
 *
 * @param {object} model SceneModel (get, childrenOf)
 * @param {string} id frame with columns
 * @param {Array<{key: string, x: number, w: number}>} [bands] colBands of the frame
 * @return {Map<string, string[]>} column key → child ids (every column has an entry)
 */
export function colMembers(model, id, bands = colBands(model.get(id))) {
	return membersBy(model, id, bands, 'x')
}

/**
 * @param {object} model SceneModel (get, childrenOf)
 * @param {string} id frame
 * @param {Array<object>} bands its lane or column bands
 * @param {'x'|'y'} ax the axis of the bands
 * @return {Map<string, string[]>} band key → child ids
 */
function membersBy(model, id, bands, ax) {
	const out = new Map(bands.map((b) => [b.key, []]))
	if (bands.length === 0) return out
	const size = ax === 'y' ? 'h' : 'w'
	const indexAt = ax === 'y' ? laneIndexAt : colIndexAt
	const kids = (model.childrenOf(id) ?? []).filter((k) => model.has(k))
	const groups = new Map()
	for (const k of kids) {
		const g = model.get(k).group
		if (typeof g === 'string') {
			if (!groups.has(g)) groups.set(g, [])
			groups.get(g).push(k)
		}
	}
	const hull = new Map()
	for (const [g, ids] of groups) {
		if (ids.length < 2) continue
		let v0 = Infinity
		let v1 = -Infinity
		for (const k of ids) {
			const it = model.get(k)
			v0 = Math.min(v0, it[ax])
			v1 = Math.max(v1, it[ax] + it[size])
		}
		hull.set(g, (v0 + v1) / 2)
	}
	for (const k of kids) {
		const it = model.get(k)
		const g = typeof it.group === 'string' && hull.has(it.group) ? it.group : null
		const c = g !== null ? hull.get(g) : it[ax] + it[size] / 2
		out.get(bands[indexAt(bands, c)].key).push(k)
	}
	return out
}

/**
 * @param {object} taken data.lanes (its keys are taken)
 * @param {() => number} rand random numbers
 * @param {string} [pre] 'l' for a lane, (job 208) 'c' for a column
 * @return {string} a free random key
 */
function newLaneKey(taken, rand, pre = 'l') {
	let k = pre
	for (let attempt = 0; attempt < 16; attempt++) {
		k = pre
		for (let i = 0; i < 8; i++) {
			const r = Number(rand())
			k += KEY_ALPHABET[Math.floor((Number.isFinite(r) ? Math.abs(r) % 1 : 0) * KEY_ALPHABET.length)]
		}
		if (!hasOwn(taken, k)) return k
	}
	// a random source that repeats itself (tests): count up from the last key
	for (let n = 1; ; n++) {
		const tail = (parseInt(k.slice(1), 36) + n).toString(36).slice(-8).padStart(8, '0')
		if (!hasOwn(taken, pre + tail)) return pre + tail
	}
}

/**
 * @param {string} key a lane, a column or (job 225) a group of either
 * @return {string} the path of its name
 */
export function namePath(key) {
	if (LGROUP_KEY_RE.test(key)) return 'data.lgroups.' + key
	if (CGROUP_KEY_RE.test(key)) return 'data.cgroups.' + key
	return (COL_KEY_RE.test(key) ? 'data.cols.' : 'data.lanes.') + key + '.t'
}

/**
 * (Job 225) A free random key of a lane group ('g') or a column group ('h').
 *
 * @param {object} taken the groups (their keys are taken)
 * @param {() => number} rand random numbers
 * @param {'g'|'h'} [pre] lane or column group
 * @return {string}
 */
export function newGroupKey(taken, rand, pre = 'g') {
	return newLaneKey(taken, rand, pre)
}

/**
 * data.lanes of a new frame: n lanes of equal height (the last takes the rest of the rounding).
 *
 * @param {number} H the frame's height
 * @param {string[]} names a name per lane ('' none)
 * @param {() => number} [rand] random numbers
 * @return {object} data.lanes
 */
export function newLanes(H, names, rand = Math.random) {
	const n = names.length
	const each = q2(H / n)
	const lanes = {}
	keysBetween(null, null, n).forEach((o, i) => {
		const lane = { o, h: i === n - 1 ? q2(H - each * (n - 1)) : each }
		if (typeof names[i] === 'string' && names[i] !== '') lane.t = names[i]
		lanes[newLaneKey(lanes, rand)] = lane
	})
	return lanes
}

/**
 * The common part of every op: the frame, its bands, and the heights (job
 * 208: and widths) to write when the stored ones do not add up to the room
 * of the frame.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @return {{it: object, bands: Array<object>, cols: Array<object>, p: object, inv: object}|null} null for anything but a frame with lanes
 */
function base(model, id) {
	const it = model?.has?.(id) ? model.get(id) : null
	if (!hasLanes(it)) return null
	const bands = laneBands(it)
	const cols = colBands(it)
	const p = {}
	const inv = {}
	const top = colTop(it)
	const sum = bands.reduce((s, b) => s + b.stored, 0)
	if (Math.abs(sum - (it.h - top)) > 0.01) {
		let y = top
		bands.forEach((b, i) => {
			const h = i === bands.length - 1 ? q2(it.h - y) : q2(b.h)
			y += h
			p['data.lanes.' + b.key + '.h'] = Math.max(LANE_MIN_H, Math.min(LANE_MAX_H, h))
			inv['data.lanes.' + b.key + '.h'] = b.stored
		})
	}
	const hw = laneHeadW(it)
	const csum = cols.reduce((s, c) => s + c.stored, 0)
	if (cols.length > 0 && Math.abs(csum - (it.w - hw)) > 0.01) {
		let x = hw
		cols.forEach((c, i) => {
			const w = i === cols.length - 1 ? q2(it.w - x) : q2(c.w)
			x += w
			p['data.cols.' + c.key + '.w'] = Math.max(COL_MIN_W, Math.min(COL_MAX_W, w))
			inv['data.cols.' + c.key + '.w'] = c.stored
		})
	}
	return { it, bands, cols, p, inv }
}

/**
 * The patches of the frame and of its moved children as one undo step.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {object} p frame patch
 * @param {object} inv its inverse
 * @param {Map<string, {dx: number, dy: number}>} moves child id → its move
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
function assemble(model, id, p, inv, moves) {
	const ops = [{ o: 'patch', id, p }]
	const inverse = [{ o: 'patch', id, p: inv }]
	for (const [k, d] of moves) {
		if (Math.abs(d.dx) < 0.005 && Math.abs(d.dy) < 0.005) continue
		const c = model.get(k)
		if (isLocked(c)) return { error: 'locked' }
		ops.push({ o: 'patch', id: k, p: { x: d.dx === 0 ? c.x : q2(c.x + d.dx), y: d.dy === 0 ? c.y : q2(c.y + d.dy), parent: id } })
		inverse.push({ o: 'patch', id: k, p: { x: c.x, y: c.y, parent: id } })
	}
	return { ops, inverse }
}

/**
 * (Job 208) The op whose frame patch is b.p: the children of each lane
 * (ax 'y') or column ('x') move by as much as their band moves.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {object} b base() with the patch filled in
 * @param {'x'|'y'} ax the bands whose children move
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
function shifted(model, id, b, ax) {
	const next = structuredClone(b.it)
	for (const [path, v] of Object.entries(b.p)) setPath(next, path, v)
	const before = ax === 'y' ? b.bands : b.cols
	const at = new Map((ax === 'y' ? laneBands(next) : colBands(next)).map((x) => [x.key, x[ax]]))
	const members = ax === 'y' ? laneMembers(model, id, before) : colMembers(model, id, before)
	const moves = new Map()
	for (const band of before) {
		const d = at.has(band.key) ? q2(at.get(band.key) - band[ax]) : 0
		if (d === 0) continue
		for (const k of members.get(band.key) ?? []) moves.set(k, ax === 'y' ? { dx: 0, dy: d } : { dx: d, dy: 0 })
	}
	return assemble(model, id, b.p, b.inv, moves)
}

/** (Job 225) The maps of each axis: lanes ('y') and columns ('x'), their groups, the first letter of a group key. */
const AX = {
	y: { field: 'lanes', gfield: 'lgroups', pre: 'g' },
	x: { field: 'cols', gfield: 'cgroups', pre: 'h' },
}

/**
 * (Job 225) A group goes from the frame's patch b.p (the whole map when it
 * is the last entry).
 *
 * @param {object} b base()
 * @param {'x'|'y'} ax lane or column group
 * @param {string} g the group
 */
function dropGroup(b, ax, g) {
	const path = 'data.' + AX[ax].gfield
	const groups = b.it.data[AX[ax].gfield]
	if (!isMap(groups) || !hasOwn(groups, g)) return
	if (Object.keys(groups).length === 1) {
		b.p[path] = null
		b.inv[path] = structuredClone(groups)
	} else {
		b.p[path + '.' + g] = null
		b.inv[path + '.' + g] = groups[g]
	}
}

/**
 * (Job 225) With the frame's patch b.p, its first lane group comes (ax 'y')
 * or its last one goes: the frame gets LANE_GROUP_W wider (narrower by the
 * cell) and every child moves along in x; the same for column groups ('x')
 * with COL_GROUP_H in height and y. Adds to b.p, b.inv and moves.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {object} b base() with the patch filled in
 * @param {'x'|'y'} ax lane or column groups
 * @param {Map<string, {dx: number, dy: number}>} moves child id → its move
 * @return {string|null} an error ('wide', 'tall'), null: done
 */
function withHead(model, id, b, ax, moves) {
	const next = structuredClone(b.it)
	for (const [path, v] of Object.entries(b.p)) setPath(next, path, v)
	const field = AX[ax].field
	const was = grouped(b.it.data[field])
	if (was === grouped(next.data?.[field])) return null
	let d
	if (ax === 'y') {
		d = was ? -laneGroupW(b.it) : LANE_GROUP_W
		if (b.it.w + d > FRAME_MAX) return 'wide'
		b.p.w = q2(b.it.w + d)
		b.inv.w = b.it.w
	} else {
		d = was ? -colGroupH(b.it) : COL_GROUP_H
		if (b.it.h + d > FRAME_MAX) return 'tall'
		b.p.h = q2(b.it.h + d)
		b.inv.h = b.it.h
	}
	for (const k of (model.childrenOf(id) ?? []).filter((c) => model.has(c))) {
		const m = moves.get(k) ?? { dx: 0, dy: 0 }
		moves.set(k, ax === 'y' ? { dx: q2(m.dx + d), dy: m.dy } : { dx: m.dx, dy: q2(m.dy + d) })
	}
	return null
}

/**
 * @param {string|null} lo o of the lane before (null: none)
 * @param {string|null} hi o of the lane after (null: none)
 * @return {string|null} an o strictly between them, null when there is none (equal neighbours)
 */
function orderBetween(lo, hi) {
	const o = keyBetween(lo, hi)
	return (lo === null || cmpBytes(lo, o) < 0) && (hi === null || cmpBytes(o, hi) < 0) ? o : null
}

/**
 * Every lane a new o in the given order (the fallback when no o fits between
 * two neighbours: two inserts at once gave them the same o).
 *
 * @param {object} lanes data.lanes (job 208: or data.cols)
 * @param {string[]} order lane keys in the new order (a new lane may be among them)
 * @param {object} p frame patch
 * @param {object} inv its inverse
 * @param {string|null} [fresh] the key of a new lane (its o goes into its put value)
 * @param {string} [pre] the path of the map
 * @return {string|null} the o of the new lane
 */
function reorderAll(lanes, order, p, inv, fresh = null, pre = 'data.lanes.') {
	let out = null
	keysBetween(null, null, order.length).forEach((nk, n) => {
		if (order[n] === fresh) {
			out = nk
			return
		}
		p[pre + order[n] + '.o'] = nk
		inv[pre + order[n] + '.o'] = lanes[order[n]].o
	})
	return out
}

/**
 * @param {Map<string, string[]>} members laneMembers
 * @param {Array<{key: string}>} bands the bands
 * @param {(i: number) => number} dyOf dy of the children of band i
 * @return {Map<string, {dx: number, dy: number}>} child id → its move
 */
function movesOf(members, bands, dyOf) {
	const out = new Map()
	bands.forEach((b, i) => {
		const dy = dyOf(i)
		if (dy !== 0) for (const k of members.get(b.key) ?? []) out.set(k, { dx: 0, dy })
	})
	return out
}

/**
 * A lane's new height (a dragged border): the frame grows by the change, the
 * children of the lanes below move with it.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane
 * @param {number} h new height (at least LANE_MIN_H, the frame at most FRAME_MAX)
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function setLaneHeight(model, id, key, h) {
	const b = base(model, id)
	if (!b || !Number.isFinite(h)) return { error: 'gone' }
	const i = b.bands.findIndex((x) => x.key === key)
	if (i < 0) return { error: 'gone' }
	const nh = q2(Math.max(LANE_MIN_H, Math.min(LANE_MAX_H, h)))
	const dh = q2(nh - b.bands[i].h)
	if (Math.abs(dh) < 0.01) return { error: 'same' }
	if (b.it.h + dh > FRAME_MAX) return { error: 'tall' }
	const members = laneMembers(model, id, b.bands)
	b.p['data.lanes.' + key + '.h'] = nh
	b.inv['data.lanes.' + key + '.h'] = b.bands[i].stored
	b.p.h = q2(b.it.h + dh)
	b.inv.h = b.it.h
	return assemble(model, id, b.p, b.inv, movesOf(members, b.bands, (j) => (j > i ? dh : 0)))
}

/**
 * A new lane without a name (LANE_NEW_H high) above or below a lane, or at
 * the end: the frame grows by its height, the children below move with it.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {{at?: (string|null), where?: ('above'|'below')}} [o] the lane of the menu (null: at the end)
 * @param {() => number} [rand] random numbers
 * @return {{ops: object[], inverse: object[], key: string}|{error: string}}
 */
export function addLane(model, id, { at = null, where = 'below' } = {}, rand = Math.random) {
	const b = base(model, id)
	if (!b) return { error: 'gone' }
	if (b.bands.length >= LANES_MAX) return { error: 'max' }
	if (b.it.h + LANE_NEW_H > FRAME_MAX) return { error: 'tall' }
	const list = orderedLanes(b.it.data.lanes)
	const i = at === null ? -1 : list.findIndex((l) => l.key === at)
	if (at !== null && i < 0) return { error: 'gone' }
	// the index the new lane gets
	const pos = i < 0 ? list.length : where === 'above' ? i : i + 1
	const key = newLaneKey(b.it.data.lanes, rand)
	let o = orderBetween(list[pos - 1]?.o ?? null, list[pos]?.o ?? null)
	if (o === null) {
		const order = list.map((l) => l.key)
		order.splice(pos, 0, key)
		o = reorderAll(b.it.data.lanes, order, b.p, b.inv, key)
	}
	const members = laneMembers(model, id, b.bands)
	// (job 225) beside a lane of a group (the menu's): in that group
	b.p['data.lanes.' + key] = i >= 0 && list[i].g !== null ? { o, h: LANE_NEW_H, g: list[i].g } : { o, h: LANE_NEW_H }
	b.inv['data.lanes.' + key] = null
	b.p.h = q2(b.it.h + LANE_NEW_H)
	b.inv.h = b.it.h
	const r = assemble(model, id, b.p, b.inv, movesOf(members, b.bands, (j) => (j >= pos ? LANE_NEW_H : 0)))
	return r.error ? r : { ...r, key }
}

/**
 * (Job 208) A lane (ax 'y') or column ('x') goes to the index to among the
 * others: it gets a new o between its new neighbours, its children move by
 * the bands it passes, theirs back by its own size.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane or column
 * @param {number} to its new index
 * @param {'x'|'y'} ax columns or lanes
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
function moveTo(model, id, key, to, ax) {
	const b = base(model, id)
	if (!b || !Number.isInteger(to)) return { error: 'gone' }
	const map = ax === 'y' ? b.it.data.lanes : b.it.data.cols
	const list = ax === 'y' ? orderedLanes(map) : orderedCols(map)
	const i = list.findIndex((l) => l.key === key)
	if (i < 0 || to < 0 || to >= list.length) return { error: 'gone' }
	if (to === i) return { error: 'same' }
	const pre = ax === 'y' ? 'data.lanes.' : 'data.cols.'
	const rest = list.filter((l) => l.key !== key)
	const o = orderBetween(rest[to - 1]?.o ?? null, rest[to]?.o ?? null)
	if (o !== null) {
		b.p[pre + key + '.o'] = o
		b.inv[pre + key + '.o'] = list[i].o
	} else {
		const order = rest.map((l) => l.key)
		order.splice(to, 0, key)
		reorderAll(map, order, b.p, b.inv, null, pre)
	}
	// (job 225) between two of one group it joins that group; else it keeps its own when it is the group's only
	// one or a new neighbour is in it; else it has none. A group left without one goes.
	const own = list[i].g
	const up = rest[to - 1]?.g ?? null
	const down = rest[to]?.g ?? null
	const only = own !== null && list.filter((l) => l.g === own).length === 1
	const ng = up !== null && up === down ? up : own !== null && (only || up === own || down === own) ? own : null
	if (ng !== own) {
		b.p[pre + key + '.g'] = ng
		b.inv[pre + key + '.g'] = own
		if (only) dropGroup(b, ax, own)
	}
	return shifted(model, id, b, ax)
}

/**
 * (Job 208) A lane goes to another place (its head dragged): moveTo.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane
 * @param {number} to its new index
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function moveLaneTo(model, id, key, to) {
	return moveTo(model, id, key, to, 'y')
}

/**
 * A lane swaps places with the one above (dir -1) or below (+1): it gets a
 * new o, the children of both lanes move by the height of the other.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane
 * @param {-1|1} dir up or down
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function moveLane(model, id, key, dir) {
	const it = model?.has?.(id) ? model.get(id) : null
	const i = hasLanes(it) ? orderedLanes(it.data.lanes).findIndex((l) => l.key === key) : -1
	if (i < 0 || (dir !== -1 && dir !== 1)) return { error: 'gone' }
	return moveTo(model, id, key, i + dir, 'y')
}

/**
 * Deletes a lane: its band goes to the lane above (the first lane's to the
 * one below), which grows by its height. Nothing else moves or goes.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane
 * @return {{ops: object[], inverse: object[]}|{error: string}} error 'last' for the only lane
 */
export function deleteLane(model, id, key) {
	const b = base(model, id)
	if (!b) return { error: 'gone' }
	const i = b.bands.findIndex((x) => x.key === key)
	if (i < 0) return { error: 'gone' }
	if (b.bands.length <= 1) return { error: 'last' }
	const n = b.bands[i === 0 ? 1 : i - 1]
	const lanePath = 'data.lanes.' + key
	// a height of the deleted lane written by base() goes with it
	delete b.p[lanePath + '.h']
	delete b.inv[lanePath + '.h']
	b.p[lanePath] = null
	b.inv[lanePath] = structuredClone(b.it.data.lanes[key])
	b.p['data.lanes.' + n.key + '.h'] = q2(Math.min(LANE_MAX_H, n.h + b.bands[i].h))
	b.inv['data.lanes.' + n.key + '.h'] = n.stored
	// (job 225) the last lane of a group takes the group along, the last group the group cell
	const own = b.bands[i].g
	if (own !== null && b.bands.every((x, j) => j === i || x.g !== own)) dropGroup(b, 'y', own)
	const moves = new Map()
	const err = withHead(model, id, b, 'y', moves)
	if (err) return { error: err }
	return assemble(model, id, b.p, b.inv, moves)
}

/**
 * The name of a lane (job 208: or a column): one path, '' as null.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane
 * @param {string} text new name
 * @param {'lanes'|'cols'} [field] lanes or columns
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function renameLane(model, id, key, text, field = 'lanes') {
	const it = model?.has?.(id) ? model.get(id) : null
	const ok = field === 'cols' ? hasCols(it) : hasLanes(it)
	if (!ok || !hasOwn(it.data[field], key) || typeof text !== 'string') return { error: 'gone' }
	const old = typeof it.data[field][key].t === 'string' ? it.data[field][key].t : ''
	if (old === text) return { error: 'same' }
	const path = 'data.' + field + '.' + key + '.t'
	return { ops: [{ o: 'patch', id, p: { [path]: text === '' ? null : text } }], inverse: [{ o: 'patch', id, p: { [path]: old === '' ? null : old } }] }
}

/**
 * (Job 208) The name of a column: renameLane on data.cols.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key column
 * @param {string} text new name
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function renameCol(model, id, key, text) {
	return renameLane(model, id, key, text, 'cols')
}

/**
 * @param {object} b base()
 * @param {string} skip a column left out (null: none)
 * @return {number} (job 208) the widths of the other columns as they will be stored
 */
function colsWidth(b, skip = null) {
	return b.cols.reduce((s, c) => (c.key === skip ? s : s + (b.p['data.cols.' + c.key + '.w'] ?? c.stored)), 0)
}

/**
 * (Job 208) A column's new width (a dragged border): the frame grows by the
 * change, the children of the columns right of it move with it.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key column
 * @param {number} w new width (at least COL_MIN_W, the frame at most FRAME_MAX)
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function setColWidth(model, id, key, w) {
	const b = base(model, id)
	if (!b || !Number.isFinite(w)) return { error: 'gone' }
	const i = b.cols.findIndex((x) => x.key === key)
	if (i < 0) return { error: 'gone' }
	const nw = q2(Math.max(COL_MIN_W, Math.min(COL_MAX_W, w)))
	if (Math.abs(nw - b.cols[i].w) < 0.01) return { error: 'same' }
	const W = q2(frameWForInner(b.it, colsWidth(b, key) + nw))
	if (W > FRAME_MAX) return { error: 'wide' }
	b.p['data.cols.' + key + '.w'] = nw
	b.inv['data.cols.' + key + '.w'] = b.cols[i].stored
	b.p.w = W
	b.inv.w = b.it.w
	return shifted(model, id, b, 'x')
}

/**
 * (Job 208) A new column without a name. On a frame without columns the
 * first one, as wide as the room beside the head column: the head row comes
 * on top (the frame grows by COL_HEAD_H), the lanes and their children move
 * down by it. Else COL_NEW_W wide, left or right of a column or at the end:
 * the frame grows by its width, the children right of it move with it.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {{at?: (string|null), where?: ('left'|'right')}} [o] the column of the menu (null: at the end)
 * @param {() => number} [rand] random numbers
 * @return {{ops: object[], inverse: object[], key: string}|{error: string}}
 */
export function addCol(model, id, { at = null, where = 'right' } = {}, rand = Math.random) {
	const b = base(model, id)
	if (!b) return { error: 'gone' }
	if (b.cols.length === 0) {
		if (b.it.h + COL_HEAD_H > FRAME_MAX) return { error: 'tall' }
		const key = newLaneKey({}, rand, 'c')
		const w = q2(Math.max(COL_MIN_W, Math.min(COL_MAX_W, b.it.w - laneHeadW(b.it))))
		b.p['data.cols'] = { [key]: { o: keyBetween(null, null), w } }
		b.inv['data.cols'] = hasOwn(b.it.data, 'cols') ? structuredClone(b.it.data.cols) : null
		b.p.h = q2(b.it.h + COL_HEAD_H)
		b.inv.h = b.it.h
		const r = shifted(model, id, b, 'y')
		return r.error ? r : { ...r, key }
	}
	if (b.cols.length >= COLS_MAX) return { error: 'max' }
	const list = orderedCols(b.it.data.cols)
	const i = at === null ? -1 : list.findIndex((c) => c.key === at)
	if (at !== null && i < 0) return { error: 'gone' }
	const pos = i < 0 ? list.length : where === 'left' ? i : i + 1
	const W = q2(frameWForInner(b.it, colsWidth(b) + COL_NEW_W))
	if (W > FRAME_MAX) return { error: 'wide' }
	const key = newLaneKey(b.it.data.cols, rand, 'c')
	let o = orderBetween(list[pos - 1]?.o ?? null, list[pos]?.o ?? null)
	if (o === null) {
		const order = list.map((c) => c.key)
		order.splice(pos, 0, key)
		o = reorderAll(b.it.data.cols, order, b.p, b.inv, key, 'data.cols.')
	}
	// (job 225) beside a column of a group (the menu's): in that group
	b.p['data.cols.' + key] = i >= 0 && list[i].g !== null ? { o, w: COL_NEW_W, g: list[i].g } : { o, w: COL_NEW_W }
	b.inv['data.cols.' + key] = null
	b.p.w = W
	b.inv.w = b.it.w
	const r = shifted(model, id, b, 'x')
	return r.error ? r : { ...r, key }
}

/**
 * (Job 208) A column goes to another place (its head dragged): moveTo.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key column
 * @param {number} to its new index
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function moveColTo(model, id, key, to) {
	return moveTo(model, id, key, to, 'x')
}

/**
 * (Job 208) A column swaps places with the one left (dir -1) or right (+1).
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key column
 * @param {-1|1} dir left or right
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function moveCol(model, id, key, dir) {
	const it = model?.has?.(id) ? model.get(id) : null
	const i = hasCols(it) ? orderedCols(it.data.cols).findIndex((c) => c.key === key) : -1
	if (i < 0 || (dir !== -1 && dir !== 1)) return { error: 'gone' }
	return moveTo(model, id, key, i + dir, 'x')
}

/**
 * (Job 208) Deletes a column: its band goes to the column left of it (the
 * first's to the one right), which grows by its width. The last column
 * takes the head row along, its height goes to the first lane. Nothing
 * moves or goes.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key column
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function deleteCol(model, id, key) {
	const b = base(model, id)
	if (!b) return { error: 'gone' }
	const i = b.cols.findIndex((x) => x.key === key)
	if (i < 0) return { error: 'gone' }
	if (b.cols.length === 1) {
		for (const k of Object.keys(b.p)) {
			if (k.startsWith('data.cols.')) {
				delete b.p[k]
				delete b.inv[k]
			}
		}
		b.p['data.cols'] = null
		b.inv['data.cols'] = structuredClone(b.it.data.cols)
		// (job 225) the column groups go along; the head row with their cell goes to the first lane
		if (hasOwn(b.it.data, 'cgroups')) {
			b.p['data.cgroups'] = null
			b.inv['data.cgroups'] = structuredClone(b.it.data.cgroups)
		}
		const f = b.bands[0]
		b.p['data.lanes.' + f.key + '.h'] = q2(Math.min(LANE_MAX_H, f.h + colTop(b.it)))
		b.inv['data.lanes.' + f.key + '.h'] = f.stored
		return assemble(model, id, b.p, b.inv, new Map())
	}
	const n = b.cols[i === 0 ? 1 : i - 1]
	const colPath = 'data.cols.' + key
	delete b.p[colPath + '.w']
	delete b.inv[colPath + '.w']
	b.p[colPath] = null
	b.inv[colPath] = structuredClone(b.it.data.cols[key])
	b.p['data.cols.' + n.key + '.w'] = q2(Math.min(COL_MAX_W, n.w + b.cols[i].w))
	b.inv['data.cols.' + n.key + '.w'] = n.stored
	// (job 225) the last column of a group takes the group along, the last group the group cell
	const own = b.cols[i].g
	if (own !== null && b.cols.every((x, j) => j === i || x.g !== own)) dropGroup(b, 'x', own)
	const moves = new Map()
	const err = withHead(model, id, b, 'x', moves)
	if (err) return { error: err }
	return assemble(model, id, b.p, b.inv, moves)
}

/**
 * (Job 225) A new group without a name that holds one lane (ax 'y') or
 * column ('x'); the first group of the frame brings the group cell
 * (withHead).
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane or column
 * @param {'x'|'y'} ax lane or column
 * @param {() => number} rand random numbers
 * @return {{ops: object[], inverse: object[], key: string}|{error: string}} key: the new group
 */
function makeGroup(model, id, key, ax, rand) {
	const b = base(model, id)
	if (!b || (ax === 'x' && !hasCols(b.it))) return { error: 'gone' }
	const A = AX[ax]
	const map = b.it.data[A.field]
	if (!hasOwn(map, key)) return { error: 'gone' }
	if (typeof map[key].g === 'string') return { error: 'same' }
	const groups = isMap(b.it.data[A.gfield]) ? b.it.data[A.gfield] : null
	if (groups !== null && Object.keys(groups).length >= GROUPS_MAX) return { error: 'max' }
	const g = newLaneKey(groups ?? {}, rand, A.pre)
	if (groups === null) {
		b.p['data.' + A.gfield] = { [g]: '' }
		b.inv['data.' + A.gfield] = null
	} else {
		b.p['data.' + A.gfield + '.' + g] = ''
		b.inv['data.' + A.gfield + '.' + g] = null
	}
	b.p['data.' + A.field + '.' + key + '.g'] = g
	b.inv['data.' + A.field + '.' + key + '.g'] = null
	const moves = new Map()
	const err = withHead(model, id, b, ax, moves)
	if (err) return { error: err }
	const r = assemble(model, id, b.p, b.inv, moves)
	return r.error ? r : { ...r, key: g }
}

/**
 * (Job 225) "Create lane group": makeGroup on a lane.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key lane
 * @param {() => number} [rand] random numbers
 * @return {{ops: object[], inverse: object[], key: string}|{error: string}}
 */
export function groupLane(model, id, key, rand = Math.random) {
	return makeGroup(model, id, key, 'y', rand)
}

/**
 * (Job 225) "Create column group": makeGroup on a column.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} key column
 * @param {() => number} [rand] random numbers
 * @return {{ops: object[], inverse: object[], key: string}|{error: string}}
 */
export function groupCol(model, id, key, rand = Math.random) {
	return makeGroup(model, id, key, 'x', rand)
}

/**
 * (Job 225) "Dissolve … group": the group goes, its lanes (columns) and
 * their content stay; the last group takes the group cell along (withHead).
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} g the group
 * @param {'x'|'y'} [ax] lane or column group
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function ungroup(model, id, g, ax = 'y') {
	const b = base(model, id)
	if (!b || (ax === 'x' && !hasCols(b.it))) return { error: 'gone' }
	const A = AX[ax]
	const groups = b.it.data[A.gfield]
	if (!isMap(groups) || !hasOwn(groups, g)) return { error: 'gone' }
	dropGroup(b, ax, g)
	for (const [k, l] of Object.entries(b.it.data[A.field])) {
		if (l.g !== g) continue
		b.p['data.' + A.field + '.' + k + '.g'] = null
		b.inv['data.' + A.field + '.' + k + '.g'] = g
	}
	const moves = new Map()
	const err = withHead(model, id, b, ax, moves)
	if (err) return { error: err }
	return assemble(model, id, b.p, b.inv, moves)
}

/**
 * (Job 225) The name of a group: one path, '' for none.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} g the group
 * @param {string} text new name
 * @param {'x'|'y'} [ax] lane or column group
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function renameGroup(model, id, g, text, ax = 'y') {
	const it = model?.has?.(id) ? model.get(id) : null
	const ok = ax === 'x' ? hasCols(it) : hasLanes(it)
	const groups = ok ? it.data[AX[ax].gfield] : null
	if (!isMap(groups) || !hasOwn(groups, g) || typeof text !== 'string') return { error: 'gone' }
	if (groups[g] === text) return { error: 'same' }
	const path = 'data.' + AX[ax].gfield + '.' + g
	return { ops: [{ o: 'patch', id, p: { [path]: text } }], inverse: [{ o: 'patch', id, p: { [path]: groups[g] } }] }
}

/**
 * (Job 225) A group's edge dragged: the lanes (columns) from index from to
 * to are in the group, the others of it leave it. The range holds at least
 * one of the group's and none of another group's.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} g the group
 * @param {number} from first index
 * @param {number} to last index
 * @param {'x'|'y'} [ax] lane or column group
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function spanGroup(model, id, g, from, to, ax = 'y') {
	const b = base(model, id)
	if (!b || (ax === 'x' && !hasCols(b.it))) return { error: 'gone' }
	const A = AX[ax]
	const bands = ax === 'y' ? b.bands : b.cols
	const groups = b.it.data[A.gfield]
	if (!isMap(groups) || !hasOwn(groups, g) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > to || to >= bands.length) {
		return { error: 'gone' }
	}
	let had = false
	for (let i = from; i <= to; i++) {
		if (bands[i].g === g) had = true
		else if (bands[i].g !== null) return { error: 'gone' }
	}
	if (!had) return { error: 'gone' }
	let changed = false
	bands.forEach((x, i) => {
		const want = i >= from && i <= to ? g : x.g === g ? null : x.g
		if (want === x.g) return
		b.p['data.' + A.field + '.' + x.key + '.g'] = want
		b.inv['data.' + A.field + '.' + x.key + '.g'] = x.g
		changed = true
	})
	if (!changed) return { error: 'same' }
	return assemble(model, id, b.p, b.inv, new Map())
}

/**
 * (Job 225) A group's cell dragged: its lanes (columns) go together before
 * the unit to of the others (groupUnits; units.length: at the end) and take
 * their children along, the lanes they pass move by the group's size.
 *
 * @param {object} model SceneModel
 * @param {string} id frame
 * @param {string} g the group
 * @param {number} to the index among the other units
 * @param {'x'|'y'} [ax] lane or column group
 * @return {{ops: object[], inverse: object[]}|{error: string}}
 */
export function moveGroupTo(model, id, g, to, ax = 'y') {
	const b = base(model, id)
	if (!b || (ax === 'x' && !hasCols(b.it)) || !Number.isInteger(to)) return { error: 'gone' }
	const map = b.it.data[AX[ax].field]
	const list = ax === 'y' ? orderedLanes(map) : orderedCols(map)
	const mine = list.filter((l) => l.g === g)
	const units = unitsOf(list.filter((l) => l.g !== g))
	if (mine.length === 0 || to < 0 || to > units.length) return { error: 'gone' }
	const before = units.slice(0, to).flat()
	const order = [...before, ...mine, ...units.slice(to).flat()]
	if (order.every((l, i) => l.key === list[i].key)) return { error: 'same' }
	const pre = 'data.' + AX[ax].field + '.'
	const lo = before.length > 0 ? before[before.length - 1].o : null
	const hi = order[before.length + mine.length]?.o ?? null
	const ks = keysBetween(lo, hi, mine.length)
	// strictly between the neighbours and rising, else every lane (column) a new o
	const fits = ks.length === mine.length && (hi === null || cmpBytes(ks[ks.length - 1], hi) < 0) && ks.every((k, n) => {
		const prev = n === 0 ? lo : ks[n - 1]
		return prev === null || cmpBytes(prev, k) < 0
	})
	if (fits) {
		mine.forEach((l, n) => {
			b.p[pre + l.key + '.o'] = ks[n]
			b.inv[pre + l.key + '.o'] = l.o
		})
	} else {
		reorderAll(map, order.map((l) => l.key), b.p, b.inv, null, pre)
	}
	return shifted(model, id, b, ax)
}

/**
 * (Transformer) A frame with lanes resized: the change of its height goes to
 * the first lane (the top edge moved) or the last (the bottom edge); (job
 * 208) the change of its width to the first column (the left edge moved) or
 * the last; the children stay where they are on the board (the
 * transformer's rule).
 *
 * @param {object} item frame (before)
 * @param {{x?: number, y: number, w?: number, h: number}} before absolute box before
 * @param {{x?: number, y: number, w?: number, h: number}} after absolute box after
 * @return {{p: object, inv: object}|null} the lane (and column) paths to add to the frame's patch, null: none
 */
export function resizeLanes(item, before, after) {
	if (!hasLanes(item) || !Number.isFinite(after?.h) || !Number.isFinite(before?.h)) return null
	const p = {}
	const inv = {}
	const bands = laneBands(item, before.h)
	const dh = after.h - before.h
	const sum = bands.reduce((s, b) => s + b.stored, 0)
	const fix = Math.abs(sum - (before.h - colTop(item, before.h))) > 0.01
	if (Math.abs(dh) >= 0.005 || fix) {
		const top = Math.abs(after.y - before.y) > 0.005
		const k = top ? 0 : bands.length - 1
		bands.forEach((b, i) => {
			if (!fix && i !== k) return
			const h = i === k ? b.h + dh : b.h
			p['data.lanes.' + b.key + '.h'] = q2(Math.max(LANE_MIN_H, Math.min(LANE_MAX_H, h)))
			inv['data.lanes.' + b.key + '.h'] = b.stored
		})
	}
	const cols = Number.isFinite(before.w) && Number.isFinite(after.w) ? colBands(item, before.w) : []
	if (cols.length > 0) {
		const room0 = before.w - laneHeadW(item, before.w)
		const dw = after.w - laneHeadW(item, after.w) - room0
		const csum = cols.reduce((s, c) => s + c.stored, 0)
		const cfix = Math.abs(csum - room0) > 0.01
		if (Math.abs(dw) >= 0.005 || cfix) {
			const k = Number.isFinite(after.x) && Number.isFinite(before.x) && Math.abs(after.x - before.x) > 0.005 ? 0 : cols.length - 1
			cols.forEach((c, i) => {
				if (!cfix && i !== k) return
				const w = i === k ? c.w + dw : c.w
				p['data.cols.' + c.key + '.w'] = q2(Math.max(COL_MIN_W, Math.min(COL_MAX_W, w)))
				inv['data.cols.' + c.key + '.w'] = c.stored
			})
		}
	}
	return Object.keys(p).length > 0 ? { p, inv } : null
}

/**
 * (Transformer) The least height of a frame with lanes when one edge
 * moves: the changed lane (first or last) keeps LANE_MIN_H (job 208: below
 * the head row).
 *
 * @param {object} item frame
 * @param {'top'|'bottom'} edge the edge that moves
 * @return {number} least height (0 for a frame without lanes)
 */
export function minLaneFrameH(item, edge) {
	const bands = laneBands(item)
	if (bands.length === 0) return 0
	const k = edge === 'top' ? 0 : bands.length - 1
	return colTop(item) + bands.reduce((s, b, i) => s + (i === k ? LANE_MIN_H : b.h), 0)
}

/**
 * (Job 208, transformer) The least width of a frame with columns when one
 * edge moves: the changed column (first or last) keeps COL_MIN_W.
 *
 * @param {object} item frame
 * @param {'left'|'right'} edge the edge that moves
 * @return {number} least width (0 for a frame without columns)
 */
export function minColFrameW(item, edge) {
	const cols = colBands(item)
	if (cols.length === 0) return 0
	const k = edge === 'left' ? 0 : cols.length - 1
	return frameWForInner(item, cols.reduce((s, c, i) => s + (i === k ? COL_MIN_W : c.w), 0))
}

/**
 * The local preview of a dragged lane border: the frame with that lane's
 * new height (the frame grows by the change). (Transformer) With edge, the
 * frame being resized: item.h is its live height, h0 the one at the start,
 * and the first ('top') or last lane ('bottom') takes the change, as
 * resizeLanes writes it at the release; (job 208) with xedge ('left',
 * 'right') and w0 the same for the first or last column. (Job 208) With
 * col and w a dragged column border: that column's width, the frame
 * grows by the change.
 *
 * @param {object} item frame with lanes
 * @param {{key?: string, h?: number, edge?: ('top'|'bottom'), h0?: number, xedge?: ('left'|'right'), w0?: number,
 *   col?: string, w?: number}} p the lane and its height, the column and its width, or the edges
 * @return {object} a copy with data.lanes (and h), data.cols (and w) changed
 */
export function previewLanes(item, p) {
	if (!hasLanes(item)) return item
	// (job 225) a dragged group edge: the lanes (columns) from..to in the group, the others of it out
	if (p?.span && typeof p.span.g === 'string') {
		const { g, from, to } = p.span
		const field = p.span.ax === 'x' ? 'cols' : 'lanes'
		if (field === 'cols' && !hasCols(item)) return item
		const list = field === 'cols' ? orderedCols(item.data.cols) : orderedLanes(item.data.lanes)
		const next = {}
		list.forEach((l, i) => {
			const e = { ...item.data[field][l.key] }
			delete e.g
			const want = i >= from && i <= to ? g : l.g === g ? null : l.g
			next[l.key] = want === null ? e : { ...e, g: want }
		})
		return { ...item, data: { ...item.data, [field]: next } }
	}
	const yEdge = (p?.edge === 'top' || p?.edge === 'bottom') && Number.isFinite(p.h0)
	const xEdge = (p?.xedge === 'left' || p?.xedge === 'right') && Number.isFinite(p.w0) && hasCols(item)
	if (yEdge || xEdge) {
		let data = item.data
		if (yEdge) {
			const start = laneBands(item, p.h0)
			const k = p.edge === 'top' ? 0 : start.length - 1
			const dh = item.h - p.h0
			const lanes = {}
			start.forEach((x, i) => {
				lanes[x.key] = { ...item.data.lanes[x.key], h: i === k ? Math.max(LANE_MIN_H, x.h + dh) : x.h }
			})
			data = { ...data, lanes }
		}
		if (xEdge) {
			const start = colBands(item, p.w0)
			const k = p.xedge === 'left' ? 0 : start.length - 1
			const dw = item.w - laneHeadW(item, item.w) - (p.w0 - laneHeadW(item, p.w0))
			const cols = {}
			start.forEach((x, i) => {
				cols[x.key] = { ...item.data.cols[x.key], w: i === k ? Math.max(COL_MIN_W, x.w + dw) : x.w }
			})
			data = { ...data, cols }
		}
		return { ...item, data }
	}
	if (typeof p?.col === 'string') {
		const cols = colBands(item)
		if (!cols.some((x) => x.key === p.col) || !Number.isFinite(p.w)) return item
		const next = {}
		let inner = 0
		for (const x of cols) {
			const w = x.key === p.col ? p.w : x.w
			next[x.key] = { ...item.data.cols[x.key], w }
			inner += w
		}
		return { ...item, w: frameWForInner(item, inner), data: { ...item.data, cols: next } }
	}
	const bands = laneBands(item)
	const b = bands.find((x) => x.key === p?.key)
	if (!b || !Number.isFinite(p.h)) return item
	const lanes = {}
	for (const x of bands) lanes[x.key] = { ...item.data.lanes[x.key], h: x.key === b.key ? p.h : x.h }
	return { ...item, h: item.h + p.h - b.h, data: { ...item.data, lanes } }
}
