/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Tags of notes (factory job 191), the pure rules. Every board has its own
 * tag list meta.tags = [{id, name, color}] (routes 44 and 45 write it, the
 * server's TagService); a note carries the ids of its tags in data.tags (the
 * registry rule ['tags', 8]), in the order they were ticked.
 *
 * - limits: TAGS_PER_NOTE, TAGS_PER_BOARD and TAG_NAME_MAX are
 *   lib/Service/Limits.php's (a node test reads that file)
 * - tagsOf(meta): the stored list cleaned like TagService::listOf (a ULID,
 *   a name, a #rrggbb colour in lower case; each id and name, without regard
 *   to case, once; at most TAGS_PER_BOARD); cleanTags is the same check for
 *   a foreign list (a clipboard payload, a board file)
 * - cleanTagName: a name as the server takes it (Input::title: trimmed, no
 *   control character, 1–TAG_NAME_MAX code points); null when unusable
 * - findTagByName (case-insensitive), sortTags (by name, then id),
 *   matchTags (the names that contain a search, sorted)
 * - nextTagColor: the first TAG_COLORS entry no tag has; all taken:
 *   TAG_COLORS[count % 12]
 * - noteTagIds: the ids of a note's data.tags that name a tag of the list,
 *   in their order (ids of deleted tags stay stored but count for nothing;
 *   they go when the note's tags are written next)
 * - tagState: on, mixed or off for a set of notes; tagCounts: notes per tag;
 *   (job 230) selectionTags: the tags of a selection with their counts
 * - tagPatch: the ops and inverse of ticking or unticking one tag on notes
 *   (one patch data.tags per note that changes; a note with TAGS_PER_NOTE
 *   tags gets no new one and is counted as full)
 * - planPasteTags / remapTagIds: the tags of pasted notes (same id → kept,
 *   else the tag with the same name, else a new tag with a fresh id; the
 *   new ones are created with ONE add before the notes are sent)
 * - fadedNotes: the notes the tag filter fades (no chosen tag)
 */
import { ULID_RE, ulid } from './ids.js'
import { TAG_COLORS, shownColor } from './tokens.js'

/** Tags of one note (Limits::TAGS_PER_NOTE). */
export const TAGS_PER_NOTE = 8
/** Tags of one board (Limits::TAGS_PER_BOARD). */
export const TAGS_PER_BOARD = 100
/** Code points of a tag name (Limits::TAG_NAME_MAX). */
export const TAG_NAME_MAX = 30

const COLOR_RE = /^#[0-9a-fA-F]{6}$/
// Input::title: trimmed of \s and \p{Z}, no \p{Cc}
const TRIM_RE = /^[\s\p{Z}]+|[\s\p{Z}]+$/gu
const CONTROL_RE = /\p{Cc}/u

/**
 * @param {string} name tag name
 * @return {string} its comparison form (unique per board without regard to case)
 */
export function tagKey(name) {
	return String(name).toLowerCase()
}

/**
 * A tag name as the server takes it (Input::title with TAG_NAME_MAX).
 *
 * @param {unknown} v name
 * @return {string|null} the trimmed name; null: no string, empty, a control character or too long
 */
export function cleanTagName(v) {
	if (typeof v !== 'string') {
		return null
	}
	const s = v.replace(TRIM_RE, '')
	if (s === '' || CONTROL_RE.test(s) || Array.from(s).length > TAG_NAME_MAX) {
		return null
	}
	if (typeof s.isWellFormed === 'function' && !s.isWellFormed()) {
		return null
	}
	return s
}

/**
 * A list of tags cleaned (see the file comment): foreign input, a stored
 * meta.tags or a payload's tags.
 *
 * @param {unknown} raw list
 * @param {number} [max] most entries
 * @return {Array<{id: string, name: string, color: string}>}
 */
export function cleanTags(raw, max = TAGS_PER_BOARD) {
	if (!Array.isArray(raw)) {
		return []
	}
	const out = []
	const ids = new Set()
	const names = new Set()
	for (const e of raw) {
		if (out.length >= max) {
			break
		}
		if (e === null || typeof e !== 'object' || Array.isArray(e) || typeof e.id !== 'string' || !ULID_RE.test(e.id)
			|| typeof e.color !== 'string' || !COLOR_RE.test(e.color)) {
			continue
		}
		const name = cleanTagName(e.name)
		if (name === null || name !== e.name || ids.has(e.id) || names.has(tagKey(name))) {
			continue
		}
		ids.add(e.id)
		names.add(tagKey(name))
		out.push({ id: e.id, name, color: e.color.toLowerCase() })
	}
	return out
}

/**
 * @param {object|null|undefined} meta the board's meta
 * @return {Array<{id: string, name: string, color: string}>} meta.tags cleaned
 */
export function tagsOf(meta) {
	return cleanTags(meta?.tags)
}

/**
 * @param {Array<{id: string}>} list tags
 * @return {Map<string, {id: string, name: string, color: string}>} id → tag
 */
export function tagMap(list) {
	return new Map((list ?? []).map((tg) => [tg.id, tg]))
}

/**
 * @param {Array<{name: string}>} list tags
 * @param {unknown} name a name (cleaned first)
 * @return {object|null} the tag of that name without regard to case
 */
export function findTagByName(list, name) {
	const n = cleanTagName(name)
	if (n === null) {
		return null
	}
	const k = tagKey(n)
	return (list ?? []).find((tg) => tagKey(tg.name) === k) ?? null
}

/**
 * @param {Array<{id: string, name: string}>} list tags
 * @return {Array<object>} a copy sorted by name (localeCompare, base letters first), then id
 */
export function sortTags(list) {
	return [...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1))
}

/**
 * @param {Array<{id: string, name: string}>} list tags
 * @param {string} q search (trimmed, case-insensitive; empty: every tag)
 * @return {Array<object>} the tags whose name contains q, sorted (sortTags)
 */
export function matchTags(list, q) {
	const k = tagKey(String(q ?? '').replace(TRIM_RE, ''))
	return sortTags((list ?? []).filter((tg) => k === '' || tagKey(tg.name).includes(k)))
}

/**
 * @param {Array<{color: string}>} list tags
 * @return {string} the colour of a new tag: the first of TAG_COLORS no tag has (job 227: as drawn,
 *   tokens.shownColor); all taken: TAG_COLORS[count % 12]
 */
export function nextTagColor(list) {
	// job 227: an old tag colour counts as the tone it is drawn in
	const used = new Set((list ?? []).map((tg) => shownColor(String(tg.color).toLowerCase())))
	return TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[(list?.length ?? 0) % TAG_COLORS.length]
}

/**
 * @param {object|null|undefined} item WireItem
 * @param {Map<string, object>} byId tagMap of the board
 * @return {string[]} the ids of its data.tags that name a tag of the board, in order, each once (notes only)
 */
export function noteTagIds(item, byId) {
	const raw = item?.t === 'sticky' ? item.data?.tags : null
	if (!Array.isArray(raw) || !(byId instanceof Map) || byId.size === 0) {
		return []
	}
	const out = []
	for (const id of raw) {
		if (typeof id === 'string' && byId.has(id) && !out.includes(id)) {
			out.push(id)
		}
	}
	return out
}

/**
 * @param {object[]} items notes
 * @param {string} tagId tag
 * @param {Map<string, object>} byId tagMap
 * @return {'on'|'mixed'|'off'} every note has it, some have it, none (also for no notes)
 */
export function tagState(items, tagId, byId) {
	let on = 0
	for (const it of items) {
		if (noteTagIds(it, byId).includes(tagId)) {
			on++
		}
	}
	return on === 0 ? 'off' : on === items.length ? 'on' : 'mixed'
}

/**
 * @param {Iterable<object>} items items (anything but notes counts for nothing)
 * @param {Map<string, object>} byId tagMap
 * @return {Map<string, number>} tag id → its notes
 */
export function tagCounts(items, byId) {
	const out = new Map()
	for (const it of items) {
		for (const id of noteTagIds(it, byId)) {
			out.set(id, (out.get(id) ?? 0) + 1)
		}
	}
	return out
}

/**
 * (Job 230) Selection v2 tags: the board's tags that at least one of the
 * items carries (notes only), in the order of the board's list, each with
 * its count (tagCounts) for the context bar's "Narrow selection".
 *
 * @param {Iterable<object>} items the selected items
 * @param {Array<{id: string, name: string, color: string}>} list the board's tags (tagsOf)
 * @return {Array<{id: string, name: string, color: string, count: number}>}
 */
export function selectionTags(items, list) {
	const tags = Array.isArray(list) ? list : []
	const counts = tagCounts(items, tagMap(tags))
	return tags.filter((tg) => counts.has(tg.id)).map((tg) => ({ id: tg.id, name: tg.name, color: tg.color, count: counts.get(tg.id) }))
}

/**
 * Ticks (on) or unticks one tag on notes: one patch data.tags per note that
 * changes (its valid ids, the new one at the end; an empty list is sent as
 * null), the inverse restores the stored value. A note that already has
 * TAGS_PER_NOTE tags gets no new one (full).
 *
 * @param {object[]} items the notes (WireItems with id)
 * @param {string} tagId tag
 * @param {boolean} on tick (true) or untick
 * @param {Map<string, object>} byId tagMap
 * @return {{ops: object[], inverse: object[], full: number}}
 */
export function tagPatch(items, tagId, on, byId) {
	const ops = []
	const inverse = []
	let full = 0
	for (const it of items) {
		if (it?.t !== 'sticky' || !byId.has(tagId)) {
			continue
		}
		const ids = noteTagIds(it, byId)
		const has = ids.includes(tagId)
		if (on === has) {
			continue
		}
		if (on && ids.length >= TAGS_PER_NOTE) {
			full++
			continue
		}
		const next = on ? [...ids, tagId] : ids.filter((x) => x !== tagId)
		const before = it.data?.tags
		ops.push({ o: 'patch', id: it.id, p: { 'data.tags': next.length > 0 ? next : null } })
		inverse.push({ o: 'patch', id: it.id, p: { 'data.tags': Array.isArray(before) && before.length > 0 ? [...before] : null } })
	}
	return { ops, inverse, full }
}

/**
 * The tags pasted notes get (see the file comment): every valid tag of the
 * payload maps to the board's tag with the same id, else to the one with
 * the same name (also one created by this paste), else to a new tag with a
 * fresh id (name and colour of the payload). New tags beyond
 * TAGS_PER_BOARD are not created (dropped counts them).
 *
 * @param {unknown} payloadTags the payload's tags (foreign input)
 * @param {Array<{id: string, name: string, color: string}>} boardTags tagsOf(meta)
 * @param {() => string} [newId] id generator
 * @return {{map: Map<string, string>, add: Array<{id: string, name: string, color: string}>, dropped: number}}
 */
export function planPasteTags(payloadTags, boardTags, newId = ulid) {
	const board = boardTags ?? []
	const byId = tagMap(board)
	const map = new Map()
	const add = []
	let dropped = 0
	for (const tg of cleanTags(payloadTags)) {
		if (byId.has(tg.id)) {
			map.set(tg.id, tg.id)
			continue
		}
		const same = findTagByName(board, tg.name) ?? findTagByName(add, tg.name)
		if (same) {
			map.set(tg.id, same.id)
			continue
		}
		if (board.length + add.length >= TAGS_PER_BOARD) {
			dropped++
			continue
		}
		const id = newId()
		add.push({ id, name: tg.name, color: tg.color })
		map.set(tg.id, id)
	}
	return { map, add, dropped }
}

/**
 * @param {unknown} ids a pasted note's data.tags
 * @param {Map<string, string>|null} map planPasteTags map (null: no tags)
 * @return {string[]|null} the mapped ids in order, each once, at most TAGS_PER_NOTE; null: none
 */
export function remapTagIds(ids, map) {
	if (!Array.isArray(ids) || !(map instanceof Map)) {
		return null
	}
	const out = []
	for (const id of ids) {
		const to = typeof id === 'string' ? map.get(id) : undefined
		if (to !== undefined && !out.includes(to) && out.length < TAGS_PER_NOTE) {
			out.push(to)
		}
	}
	return out.length > 0 ? out : null
}

/**
 * The tags the given items use, in the board's order (a copy, a template of
 * a selection).
 *
 * @param {Iterable<object>} items items
 * @param {Array<{id: string, name: string, color: string}>} list tagsOf(meta)
 * @return {Array<{id: string, name: string, color: string}>}
 */
export function usedTags(items, list) {
	const byId = tagMap(list)
	const used = new Set()
	for (const it of items) {
		for (const id of noteTagIds(it, byId)) {
			used.add(id)
		}
	}
	return (list ?? []).filter((tg) => used.has(tg.id)).map((tg) => ({ ...tg }))
}

/**
 * @param {Iterable<object>} items the board's items
 * @param {Set<string>|null} chosen the filter's tags (null or empty: no filter)
 * @param {Map<string, object>} byId tagMap
 * @return {string[]} the notes without a chosen tag, in the order given
 */
export function fadedNotes(items, chosen, byId) {
	if (!(chosen instanceof Set) || chosen.size === 0) {
		return []
	}
	const out = []
	for (const it of items) {
		if (it?.t === 'sticky' && !noteTagIds(it, byId).some((id) => chosen.has(id))) {
			out.push(it.id)
		}
	}
	return out
}
