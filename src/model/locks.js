/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Locked items (M2, SPEC-M1 §1.2 "(R20) Sperren"), pure. The server sets
 * `lock` of a WireItem: null (not locked) or {by, name} (by = the locker's
 * pid on this board, name = the display name when locked; each null when
 * unknown, e.g. after the locker's account was deleted). The server enforces
 * every rule (SyncService::authorize, result code `itemlocked`); this module
 * only mirrors them for the client:
 *
 * - isLocked(item): `lock` is a map
 * - mayUnlock(item, me): locked, me may edit (canEdit(me.role)), and the
 *   lock is me's own (by === me.pid, never for an unknown locker) or me may
 *   moderate (me.mod)
 * - lockValue(me): the value a lock op sends, {by: me.pid, name: me.name ??
 *   null} in this key order: exactly what the server hands out afterwards,
 *   so the optimistic state and the server echo have the same itemKey
 * - lockSummary(items, me, {writable}): the counts and the lockers of a
 *   selection for the context bar and the context menu (selection v2:
 *   locked, unlocked, lockable, unlockable, lockedBy, unlockBy)
 */
/**
 * @param {unknown} role me.role
 * @return {boolean} owner or edit (board/mode.js canEdit, mirrored: the model imports nothing of the shell)
 */
function canEdit(role) {
	return role === 'owner' || role === 'edit'
}

/**
 * @param {unknown} v value
 * @return {boolean} a plain map (not null, not a list)
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {object|null|undefined} item WireItem
 * @return {boolean} the item is locked (by anyone, also by an unknown locker)
 */
export function isLocked(item) {
	return isMap(item?.lock)
}

/**
 * @param {object|null|undefined} item WireItem
 * @param {{pid?: string, role?: string, mod?: boolean}|null|undefined} me the own session (snapshot `me`)
 * @return {boolean} me may lift this lock (own lock, or a moderator's right)
 */
export function mayUnlock(item, me) {
	if (!isLocked(item) || !me || !canEdit(me.role)) {
		return false
	}
	const by = item.lock.by ?? null
	return (by !== null && by === me.pid) || me.mod === true
}

/**
 * @param {{pid?: string, name?: (string|null)}|null|undefined} me the own session
 * @return {{by: (string|null), name: (string|null)}} the lock op's value (keys in this order)
 */
export function lockValue(me) {
	return { by: typeof me?.pid === 'string' ? me.pid : null, name: typeof me?.name === 'string' ? me.name : null }
}

/**
 * Group key of a lock: by its locker's pid, without a pid by its name.
 *
 * @param {{by: (string|null), name: (string|null)}} lock lock
 * @return {string|null} key, null for a lock without pid and name (unknown)
 */
function lockerKey(lock) {
	if (typeof lock.by === 'string') {
		return 'by:' + lock.by
	}
	return typeof lock.name === 'string' ? 'name:' + lock.name : null
}

/**
 * Who locked these items (none of them me's own): one locker with a name,
 * nobody known, or several.
 *
 * @param {Array<{by: (string|null), name: (string|null)}>} locks foreign locks (at least one)
 * @return {{kind: 'name', name: string}|{kind: 'unknown'}|{kind: 'several'}}
 */
function foreign(locks) {
	const named = locks.filter((l) => typeof l.name === 'string' && l.name !== '')
	if (named.length === 0) {
		return { kind: 'unknown' }
	}
	const keys = new Set(locks.map(lockerKey))
	if (keys.size === 1 && !keys.has(null)) {
		return { kind: 'name', name: named[0].name }
	}
	return { kind: 'several' }
}

/**
 * The locks of a selection for the context bar, its badge and the menu
 * (selection v2, M2 R20).
 *
 * - locked / unlocked: how many of the items are locked / not locked
 * - lockable: unlocked, unlockable: the locked ones me may unlock; both 0
 *   when the session cannot write (writable false: mode not edit, frozen)
 *   or me may not edit
 * - lockedBy (null without a locked item): {kind: 'mine'} when every lock
 *   is me's own, {kind: 'name', name} when all are the same foreign locker
 *   with a name (grouped by by, without by by name), {kind: 'unknown'}
 *   when all are foreign and nameless, else {kind: 'several'}
 * - unlockBy (null when unlockable is 0): the same over the unlockable
 *   items: {kind: 'mine'} when all of them are me's own, else over the
 *   foreign ones among them ('name', 'unknown' or 'several')
 *
 * @param {object[]} items WireItems of the selection
 * @param {object|null} me the own session ({pid, name, role, mod})
 * @param {{writable?: boolean}} [o] writable: the session may write now
 * @return {{locked: number, unlocked: number, lockable: number, unlockable: number,
 *   lockedBy: (object|null), unlockBy: (object|null)}}
 */
export function lockSummary(items, me, { writable = true } = {}) {
	const pid = typeof me?.pid === 'string' ? me.pid : null
	const may = writable && !!me && canEdit(me.role)
	const own = (lock) => pid !== null && lock.by === pid
	const locks = []
	const unlockable = []
	let unlocked = 0
	for (const it of items ?? []) {
		if (!isLocked(it)) {
			unlocked++
			continue
		}
		const lock = { by: it.lock.by ?? null, name: it.lock.name ?? null }
		locks.push(lock)
		if (may && mayUnlock(it, me)) {
			unlockable.push(lock)
		}
	}
	const describe = (list) => {
		if (list.length === 0) {
			return null
		}
		if (list.every(own)) {
			return { kind: 'mine' }
		}
		return foreign(list.filter((l) => !own(l)))
	}
	let lockedBy = null
	if (locks.length > 0) {
		lockedBy = locks.every(own) ? { kind: 'mine' } : (locks.some(own) ? { kind: 'several' } : foreign(locks))
	}
	return {
		locked: locks.length,
		unlocked,
		lockable: may ? unlocked : 0,
		unlockable: unlockable.length,
		lockedBy,
		unlockBy: describe(unlockable),
	}
}
