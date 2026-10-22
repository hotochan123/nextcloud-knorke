/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The oracle of the HTTP harness (SPEC-M0 §8.3): an INDEPENDENT mirror of the
 * board state, written from the spec text, not imported from src/model/. It
 * must not share code with the client or the server, otherwise a bug common
 * to both would look like agreement.
 *
 *   Mirror        confirmed state of one client: snapshot + every sync answer
 *                 (items = full current objects, removed = tombstone ids)
 *   replayChanges the change log (oc_knorke_changes) applied from rev 0,
 *                 with tombstones kept (for the release positions of check 3)
 *   canon/itemKey canonical JSON for comparisons: sorted keys, no null and
 *                 no empty objects/lists at any depth (§4.7 rule 3)
 *   setPath       path semantics of PathOps/paths.js as the spec states them
 */

export const FIELDS = ['t', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style']
export const NUM_FIELDS = ['x', 'y', 'w', 'h', 'r']
export const PLACEMENT = ['x', 'y', 'parent']
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** true for null/undefined, {} and [] – "absent" in the value rules. */
export function isEmpty(v) {
	return v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0)
}

/** Canonical form: object keys sorted, absent values dropped at every depth, lists keep order. */
export function canon(v) {
	// List elements are never dropped: the server must not store empty ones (rule 3),
	// and an oracle that hid them would hide that bug.
	if (Array.isArray(v)) return v.map(canon)
	if (!isObj(v)) return v
	const out = {}
	for (const k of Object.keys(v).sort()) {
		const c = canon(v[k])
		if (isEmpty(c)) continue
		out[k] = c
	}
	return out
}

/** Comparable item in wire form; accepts DB-ish names too (type, rotation, parent_id). */
export function normItem(it) {
	const o = {
		t: it.t ?? it.type ?? null,
		x: num(it.x),
		y: num(it.y),
		w: num(it.w),
		h: num(it.h),
		r: num(it.r ?? it.rotation),
		z: it.z ?? null,
		parent: (it.parent !== undefined ? it.parent : it.parent_id) ?? null,
		data: isObj(it.data) ? it.data : {},
		style: isObj(it.style) ? it.style : {},
	}
	return o
}

function num(v) {
	if (v === null || v === undefined || v === '') return 0
	const n = Number(v)
	return Number.isFinite(n) ? n : NaN
}

/** Canonical JSON of one item including its id. */
export function itemKey(id, it) {
	const n = normItem(it)
	return JSON.stringify({ id, t: n.t, x: n.x, y: n.y, w: n.w, h: n.h, r: n.r, z: n.z, parent: n.parent, data: canon(n.data), style: canon(n.style) })
}

/** Cleans an object value: absent entries dropped recursively, key order kept. */
export function cleanValue(v) {
	if (Array.isArray(v)) return v.map(cleanValue)
	if (!isObj(v)) return v
	const out = {}
	for (const k of Object.keys(v)) {
		const c = cleanValue(v[k])
		if (isEmpty(c)) continue
		out[k] = c
	}
	return out
}

export function getPath(item, path) {
	const keys = path.split('.')
	let node = item
	for (const k of keys) {
		if (!isObj(node) || !own(node, k)) return null
		node = node[k]
	}
	return node === undefined ? null : node
}

/**
 * Sets one path on an item (mutates). Root fields as given; data./style. paths:
 * an absent value deletes and prunes emptied parent maps (the root containers
 * stay); deleting through a missing path is a no-op; object values are cleaned.
 */
export function setPath(item, path, value) {
	const keys = path.split('.')
	if (keys.length === 1) {
		if (keys[0] === 'data' || keys[0] === 'style') {
			item[keys[0]] = isObj(value) ? cleanValue(value) : {}
			return
		}
		item[keys[0]] = value
		return
	}
	const rootKey = keys.shift()
	if (isEmpty(value)) {
		if (!isObj(item[rootKey])) return
		delIn(item[rootKey], keys)
		return
	}
	if (!isObj(item[rootKey])) item[rootKey] = {}
	setIn(item[rootKey], keys, cleanValue(value))
}

function setIn(map, keys, value) {
	const k = keys[0]
	if (keys.length === 1) { map[k] = value; return }
	if (!isObj(map[k])) map[k] = {}
	setIn(map[k], keys.slice(1), value)
}

function delIn(map, keys) {
	const k = keys[0]
	if (!own(map, k)) return
	if (keys.length === 1) { delete map[k]; return }
	if (!isObj(map[k])) return
	delIn(map[k], keys.slice(1))
	if (Object.keys(map[k]).length === 0) delete map[k]
}

/** Confirmed state of one client, fed only by server answers. */
export class Mirror {
	constructor() {
		this.items = new Map()
		this.rev = 0
		this.minRev = 0
		this.resyncs = 0
	}

	load(snapshot) {
		this.items.clear()
		for (const it of snapshot.items || []) this.items.set(it.id, normItem(it))
		this.rev = snapshot.rev
		this.minRev = snapshot.minRev ?? 0
	}

	/** Applies a sync answer unless it says resync. Returns false on resync. */
	apply(res) {
		if (res.resync) return false
		for (const it of res.items || []) this.items.set(it.id, normItem(it))
		for (const id of res.removed || []) this.items.delete(id)
		this.rev = res.rev
		return true
	}

	keys() {
		const m = new Map()
		for (const [id, it] of this.items) m.set(id, itemKey(id, it))
		return m
	}
}

/** Map id → itemKey of a snapshot. */
export function snapshotKeys(snapshot) {
	const m = new Map()
	for (const it of snapshot.items || []) m.set(it.id, itemKey(it.id, it))
	return m
}

/**
 * Compares two id→itemKey maps. @returns {Array<{id, problem, a?, b?}>} (empty = equal)
 */
export function diffKeys(a, b, labelA = 'a', labelB = 'b') {
	const out = []
	for (const [id, k] of a) {
		if (!b.has(id)) out.push({ id, problem: `nur in ${labelA}`, a: k })
		else if (b.get(id) !== k) out.push({ id, problem: 'abweichend', a: k, b: b.get(id) })
	}
	for (const [id, k] of b) if (!a.has(id)) out.push({ id, problem: `nur in ${labelB}`, b: k })
	return out
}

/**
 * Replays change-log rows {rev, item_id, op, patch} in order.
 * `patch` is JSON (string or parsed): put = full item without id, patch =
 * effective paths, remove = null. Tombstones stay in `dead` with their last state.
 * onRev(rev, state) is called after the last row of every rev.
 */
export function replayChanges(rows, onRev = null) {
	const live = new Map()
	const dead = new Map()
	const problems = []
	let cur = null
	const flush = () => { if (onRev && cur !== null) onRev(cur, { live, dead }) }
	for (const row of rows) {
		const rev = Number(row.rev)
		if (cur !== null && rev !== cur) flush()
		cur = rev
		const id = row.item_id
		let p = row.patch
		if (typeof p === 'string') {
			try { p = JSON.parse(p) } catch { problems.push({ rev, id, problem: 'patch ist kein JSON' }); continue }
		}
		if (row.op === 'put') {
			if (!isObj(p)) { problems.push({ rev, id, problem: 'put ohne Objekt' }); continue }
			live.set(id, normItem(p))
			dead.delete(id)
		} else if (row.op === 'remove') {
			const it = live.get(id)
			if (!it) { problems.push({ rev, id, problem: 'remove auf unbekanntes Objekt' }); continue }
			live.delete(id)
			dead.set(id, it)
		} else if (row.op === 'patch') {
			const it = live.get(id)
			if (!it) { problems.push({ rev, id, problem: 'patch auf unbekanntes Objekt' }); continue }
			if (!isObj(p)) { problems.push({ rev, id, problem: 'patch ohne Objekt' }); continue }
			for (const [path, v] of Object.entries(p)) {
				const field = path === 'rotation' ? 'r' : path === 'parent_id' ? 'parent' : path
				setPath(it, field, NUM_FIELDS.includes(field) ? num(v) : v)
			}
		} else {
			problems.push({ rev, id, problem: `unbekannte op '${row.op}'` })
		}
	}
	flush()
	return { live, dead, problems }
}

/** Map id → itemKey of a replay result. */
export function replayKeys(replay) {
	const m = new Map()
	for (const [id, it] of replay.live) m.set(id, itemKey(id, it))
	return m
}
