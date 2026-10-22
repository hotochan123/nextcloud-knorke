/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Item paths and wire values (SPEC-M0 §6.2, §4.6, §4.7 rule 3). Mirror of
 * lib/Service/PathOps.php; tests/fixtures/paths-golden.json pins both sides.
 *
 * A path is a root field (x, y, w, h, r, z, parent) or data.<k>[.<k>…] /
 * style.<k>[.<k>…]. Each path is one LWW register; x, y and parent form ONE
 * register together (placement group, rule 2a).
 *
 * Value rules ("empty = absent"): null, {} and [] mean "no value" at every
 * level. As a patch value they delete the path; inside object values such
 * entries are dropped (an object that becomes empty is dropped too); inside
 * lists they are not allowed at all, because removing them would shift
 * indices. The server sees the body through json_decode(…, true) and cannot
 * tell {} from [], so this is the only reading both sides agree on.
 *
 * setPath semantics (the golden cases name each rule):
 * - root fields are set as given; parent = null keeps the key with null
 * - an absent value deletes the path and prunes parent maps that became
 *   empty, but the root containers data/style stay (as {})
 * - deleting an absent path is a strict no-op: nothing is created, also not
 *   through a scalar, a list or a missing root container
 * - setting through a scalar or a list replaces it with a map; a missing root
 *   container is created and appended
 * - object values are cleaned recursively (also objects inside lists), key
 *   order is kept
 * - own properties only: 'constructor' or 'toString' are ordinary keys
 *
 * group and lock (M2 data foundation) are wire fields: group a string or
 * null, lock null (not locked) or {by, name} (by = the locker's pid, name =
 * display name, each null when unknown). The lock is the server's alone (no
 * path; the lock op is a patch of its own, sync/Replica.js isLockPatch).
 * The group (M2, SPEC-M1 §1.2 "(R20) Gruppieren") is a root path of a patch
 * like z, one LWW register, and a put may carry it (p.group, a ULID or null;
 * itemFromPut takes it, null otherwise); diffPatch compares it, so a
 * compacted remove + revive keeps it.
 */

/** Fields of a WireItem besides id, in wire order. */
export const TOP_FIELDS = ['t', 'x', 'y', 'w', 'h', 'r', 'z', 'parent', 'data', 'style', 'group', 'lock']

/** Placement group: a patch carries all three or none (§4.7 rule 2a). */
export const PLACEMENT = ['x', 'y', 'parent']

/** Keys below data/style, on every level of object values. */
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

/** Root fields a patch may set (group: M2, R20 Gruppieren). */
const PATCH_ROOT_FIELDS = ['x', 'y', 'w', 'h', 'r', 'z', 'parent', 'group']
/** Root containers. */
const CONTAINERS = ['data', 'style']
/** Levels of keys below data/style in a patch path. */
const MAX_PATH_KEYS = 4

/** Value limits (§4.7 rule 3). */
const MAX_DEPTH = 6
const MAX_LIST = 1000
const MAX_KEYS = 100

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * @param {unknown} v value
 * @return {boolean} true for an object that is neither null nor an array
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {unknown} v value
 * @return {boolean} true for a plain JSON object (no class instance)
 */
function isPlainObject(v) {
	if (!isMap(v)) {
		return false
	}
	const proto = Object.getPrototypeOf(v)
	return proto === Object.prototype || proto === null
}

/**
 * Own, enumerable data property; also for the key '__proto__', which a plain
 * assignment would turn into a prototype change.
 *
 * @param {object} o target
 * @param {string} k key
 * @param {unknown} v value
 */
function put(o, k, v) {
	if (k === '__proto__') {
		Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
	} else {
		o[k] = v
	}
}

/**
 * Cleaned deep copy of a value: null/{}/[] entries of objects are dropped,
 * objects that end up empty are absent, list elements keep their positions.
 *
 * @param {unknown} v value
 * @return {unknown} cleaned copy, or undefined when the value is absent
 */
function clean(v) {
	if (v === null || v === undefined) {
		return undefined
	}
	if (Array.isArray(v)) {
		if (v.length === 0) {
			return undefined
		}
		// Elements that are absent are invalid wire values (isWireValue); they
		// stay as null so that indices never shift.
		return v.map((el) => {
			const c = clean(el)
			return c === undefined ? null : c
		})
	}
	if (isMap(v)) {
		const out = {}
		let any = false
		for (const k of Object.keys(v)) {
			const c = clean(v[k])
			if (c !== undefined) {
				put(out, k, c)
				any = true
			}
		}
		return any ? out : undefined
	}
	return v
}

/**
 * Value at a path.
 *
 * @param {object} item WireItem (or any map)
 * @param {string} path 'x' or 'data.a.b'
 * @return {unknown} the value (not copied) or null when absent
 */
export function getPath(item, path) {
	let node = item
	for (const k of String(path).split('.')) {
		if (!isMap(node) || !hasOwn(node, k)) {
			return null
		}
		node = node[k]
	}
	return node === undefined ? null : node
}

/**
 * Removes a nested path; strict no-op when it does not exist.
 *
 * @param {object} item item to mutate
 * @param {string[]} keys path segments, at least two
 */
function deletePath(item, keys) {
	const stack = []
	let node = item
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i]
		if (!hasOwn(node, k) || !isMap(node[k])) {
			return
		}
		stack.push([node, k])
		node = node[k]
	}
	const leaf = keys[keys.length - 1]
	if (!hasOwn(node, leaf)) {
		return
	}
	delete node[leaf]
	// Prune maps that became empty, bottom-up; stack[0] is the root container,
	// which stays.
	for (let i = stack.length - 1; i >= 1; i--) {
		const [parent, k] = stack[i]
		if (Object.keys(parent[k]).length > 0) {
			break
		}
		delete parent[k]
	}
}

/**
 * Sets or deletes one path (mutates the item).
 *
 * @param {object} item WireItem to change
 * @param {string} path root field or data.<k>…/style.<k>…
 * @param {unknown} value new value; null, {} or [] (also objects that clean to
 *   empty) delete a nested path
 * @return {object} the item
 */
export function setPath(item, path, value) {
	const keys = String(path).split('.')
	if (keys.length === 1) {
		if (CONTAINERS.includes(path)) {
			// Whole container (not a patch path, but keep the invariant: a map).
			const c = clean(value)
			put(item, path, isMap(c) ? c : {})
		} else {
			put(item, path, value)
		}
		return item
	}
	const c = clean(value)
	if (c === undefined) {
		deletePath(item, keys)
		return item
	}
	let node = item
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i]
		if (!hasOwn(node, k) || !isMap(node[k])) {
			put(node, k, {})
		}
		node = node[k]
	}
	put(node, keys[keys.length - 1], c)
	return item
}

/**
 * Applies a patch (mutates the item), paths in object order.
 *
 * @param {object} item WireItem to change
 * @param {Record<string, unknown>} patch path → value
 * @return {object} the item
 */
export function applyPatch(item, patch) {
	for (const path of Object.keys(patch)) {
		setPath(item, path, patch[path])
	}
	return item
}

/**
 * True for a path a patch may carry: a root field from x, y, w, h, r, z,
 * parent, group, or data/style followed by 1–4 keys that match KEY_RE.
 *
 * @param {unknown} path candidate
 * @return {boolean}
 */
export function isPatchPath(path) {
	if (typeof path !== 'string') {
		return false
	}
	const keys = path.split('.')
	if (keys.length === 1) {
		return PATCH_ROOT_FIELDS.includes(path)
	}
	if (!CONTAINERS.includes(keys[0]) || keys.length - 1 > MAX_PATH_KEYS) {
		return false
	}
	return keys.slice(1).every((k) => KEY_RE.test(k))
}

const INVALID = 0
const ABSENT = 1
const PRESENT = 2

/**
 * @param {unknown} v value
 * @param {number} depth containers already around v
 * @return {number} INVALID | ABSENT | PRESENT
 */
function check(v, depth) {
	if (v === null) {
		return ABSENT
	}
	switch (typeof v) {
	case 'string':
	case 'boolean':
		return PRESENT
	case 'number':
		return Number.isFinite(v) ? PRESENT : INVALID
	case 'object':
		break
	default:
		return INVALID
	}
	const level = depth + 1
	if (level > MAX_DEPTH) {
		return INVALID
	}
	if (Array.isArray(v)) {
		if (v.length > MAX_LIST) {
			return INVALID
		}
		for (const el of v) {
			// No absent elements: dropping them would shift indices.
			if (check(el, level) !== PRESENT) {
				return INVALID
			}
		}
		return v.length > 0 ? PRESENT : ABSENT
	}
	if (!isPlainObject(v)) {
		return INVALID
	}
	const keys = Object.keys(v)
	if (keys.length > MAX_KEYS) {
		return INVALID
	}
	let any = false
	for (const k of keys) {
		if (!KEY_RE.test(k)) {
			return INVALID
		}
		const s = check(v[k], level)
		if (s === INVALID) {
			return INVALID
		}
		if (s === PRESENT) {
			any = true
		}
	}
	return any ? PRESENT : ABSENT
}

/**
 * Value rules of §4.7 rule 3 (mirror of the server's value check):
 * scalars (string, finite number, boolean), lists and objects as whole values,
 * at most 6 container levels (the value itself is level 1), lists with at most
 * 1000 elements and none of them null/{}/[] or an object that cleans to empty,
 * objects with at most 100 keys that all match KEY_RE (also next to null
 * values). null, {} and [] are fine as a whole (= delete the path) and as
 * object entries (dropped when stored). Limits are checked on the raw value,
 * before cleaning, so the work stays bounded. undefined, NaN, Infinity and
 * class instances are no wire values.
 *
 * @param {unknown} v value
 * @param {number} [depth] containers already around v
 * @return {boolean}
 */
export function isWireValue(v, depth = 0) {
	return check(v, depth) !== INVALID
}

/**
 * Canonical form for comparisons: sorted keys, no null, no empty objects or
 * lists; list elements keep their positions. Absent values become null.
 *
 * @param {unknown} v value
 * @return {unknown} canonical copy, null when absent
 */
export function canon(v) {
	if (v === null || v === undefined) {
		return null
	}
	if (Array.isArray(v)) {
		return v.length > 0 ? v.map(canon) : null
	}
	if (isMap(v)) {
		const out = {}
		let any = false
		for (const k of Object.keys(v).sort()) {
			const c = canon(v[k])
			if (c !== null) {
				put(out, k, c)
				any = true
			}
		}
		return any ? out : null
	}
	return v
}

/**
 * @param {unknown} a value
 * @param {unknown} b value
 * @return {boolean} true when both are equal under "empty = absent"
 */
function sameValue(a, b) {
	return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

/**
 * Canonical JSON string of an item including its id, for comparisons in tests,
 * debug output and E2E: fields in wire order, missing fields as null, data and
 * style canonical (sorted, empty = absent, {} when empty).
 *
 * @param {object} item WireItem
 * @return {string} JSON
 */
export function itemKey(item) {
	const o = { id: item.id === undefined ? null : item.id }
	for (const f of TOP_FIELDS) {
		if (f === 'data' || f === 'style') {
			o[f] = canon(item[f]) ?? {}
		} else {
			o[f] = item[f] === undefined ? null : item[f]
		}
	}
	return JSON.stringify(o)
}

/**
 * @param {unknown} v number field
 * @return {unknown} 0 for a missing value, otherwise v
 */
function num(v) {
	return v === undefined || v === null ? 0 : v
}

/**
 * Patch that turns `before` into `after`.
 *
 * - x/y/parent always travel as a group, as soon as one of them differs
 * - w, h, r and z when they differ (z only when after has one)
 * - group when (before.group ?? null) !== (after.group ?? null) (M2, R20
 *   Gruppieren; otherwise a compacted remove + revive would lose it)
 * - data/style per key on level 1, with the whole cleaned value; a key that is
 *   absent in after (or empty) becomes null
 * - t is never patched (a type does not change)
 *
 * @param {object} before WireItem before
 * @param {object} after WireItem after
 * @return {Record<string, unknown>} patch, {} when both are equal
 */
export function diffPatch(before, after) {
	const b = isMap(before) ? before : {}
	const a = isMap(after) ? after : {}
	const patch = {}
	const bParent = b.parent ?? null
	const aParent = a.parent ?? null
	if (num(b.x) !== num(a.x) || num(b.y) !== num(a.y) || bParent !== aParent) {
		patch.x = num(a.x)
		patch.y = num(a.y)
		patch.parent = aParent
	}
	for (const f of ['w', 'h', 'r']) {
		if (num(b[f]) !== num(a[f])) {
			patch[f] = num(a[f])
		}
	}
	if (typeof a.z === 'string' && a.z !== b.z) {
		patch.z = a.z
	}
	if ((b.group ?? null) !== (a.group ?? null)) {
		patch.group = a.group ?? null
	}
	for (const root of CONTAINERS) {
		const bm = isMap(b[root]) ? b[root] : {}
		const am = isMap(a[root]) ? a[root] : {}
		const keys = Object.keys(bm)
		for (const k of Object.keys(am)) {
			if (!hasOwn(bm, k)) {
				keys.push(k)
			}
		}
		for (const k of keys) {
			const bv = hasOwn(bm, k) ? bm[k] : null
			const av = hasOwn(am, k) ? am[k] : null
			if (!sameValue(bv, av)) {
				const c = clean(av)
				patch[root + '.' + k] = c === undefined ? null : c
			}
		}
	}
	return patch
}

/**
 * WireItem that a put creates, with the server defaults of §4.6: missing
 * numbers 0, parent null, data/style {} (cleaned copies), group p.group
 * when it is a string (M2, R20 Gruppieren; the server checks ULID_RE),
 * otherwise null, lock null (a put never sets it). z stays as sent (null
 * when missing; the server answers such a put with `bad`).
 *
 * @param {{id:string, t:string, p:object}} op put op
 * @return {object} new WireItem (shares nothing with the op)
 */
export function itemFromPut(op) {
	const p = isMap(op?.p) ? op.p : {}
	const data = clean(p.data)
	const style = clean(p.style)
	return {
		id: op?.id,
		t: op?.t,
		x: num(p.x),
		y: num(p.y),
		w: num(p.w),
		h: num(p.h),
		r: num(p.r),
		z: typeof p.z === 'string' ? p.z : null,
		parent: p.parent ?? null,
		data: isMap(data) ? data : {},
		style: isMap(style) ? style : {},
		group: typeof p.group === 'string' ? p.group : null,
		lock: null,
	}
}
