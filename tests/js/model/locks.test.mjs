/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Locked items in the model (job 023, AK8; src/model/locks.js): isLocked,
 * mayUnlock (own lock, foreign lock without and with the moderation right,
 * unknown locker, roles vote/view), lockValue (keys by, name in this order:
 * the server echo has the same itemKey) and lockSummary (every kind of
 * lockedBy and unlockBy, lockable/unlockable 0 while the session cannot
 * write).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocked, lockSummary, lockValue, mayUnlock } from '../../../src/model/locks.js'
import { itemKey } from '../../../src/model/paths.js'

const ME = { pid: 'pidme00000000001', name: 'Alice', role: 'edit', mod: false }
const MOD = { ...ME, mod: true }
const item = (id, lock) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'i0', parent: null, data: {}, style: {}, group: null, lock })
const mine = { by: ME.pid, name: 'Alice' }
const bob = { by: 'pidbob0000000001', name: 'Bob' }
const carol = { by: 'pidcarol00000001', name: 'Carol' }
const unknown = { by: null, name: null }

test('isLocked: a map is a lock (also with an unknown locker); null and anything else is not', () => {
	assert.equal(isLocked(item('a', null)), false)
	assert.equal(isLocked(item('a', { by: null, name: null })), true, 'locked, locker unknown')
	assert.equal(isLocked(item('a', { by: 'p', name: 'A' })), true)
	for (const v of [undefined, true, 'x', 1, ['a']]) {
		assert.equal(isLocked({ lock: v }), false, JSON.stringify(v))
	}
	assert.equal(isLocked(null), false)
})

test('mayUnlock: own lock yes; a foreign or unknown lock only with mod; vote and view never; never without me', () => {
	assert.equal(mayUnlock(item('a', mine), ME), true, 'own lock')
	assert.equal(mayUnlock(item('a', bob), ME), false, 'foreign, no moderation')
	assert.equal(mayUnlock(item('a', bob), MOD), true, 'foreign, moderator')
	assert.equal(mayUnlock(item('a', unknown), ME), false, 'unknown locker: never by pid')
	assert.equal(mayUnlock(item('a', unknown), MOD), true)
	assert.equal(mayUnlock(item('a', mine), { ...ME, role: 'owner' }), true)
	assert.equal(mayUnlock(item('a', bob), { ...ME, role: 'owner', mod: true }), true, 'the owner lifts any lock')
	for (const role of ['vote', 'view']) {
		assert.equal(mayUnlock(item('a', mine), { ...ME, role }), false, role + ', own lock')
		assert.equal(mayUnlock(item('a', bob), { ...MOD, role }), false, role + ', mod')
	}
	assert.equal(mayUnlock(item('a', null), MOD), false, 'not locked')
	assert.equal(mayUnlock(item('a', mine), null), false)
	assert.equal(mayUnlock(item('a', { by: null, name: 'X' }), { ...ME, pid: null }), false, 'a null pid never matches a null by')
})

test('lockValue: {by: me.pid, name: me.name ?? null}, keys in the order by, name; the optimistic itemKey equals the server echo', () => {
	assert.deepEqual(Object.keys(lockValue(ME)), ['by', 'name'])
	assert.deepEqual(lockValue(ME), { by: ME.pid, name: 'Alice' })
	assert.deepEqual(lockValue({ pid: 'p' }), { by: 'p', name: null })
	const optimistic = item('a', lockValue(ME))
	const echo = JSON.parse('{"id":"a","t":"sticky","x":0,"y":0,"w":200,"h":200,"r":0,"z":"i0","parent":null,"data":{},"style":{},"group":null,"lock":{"by":"pidme00000000001","name":"Alice"}}')
	assert.equal(itemKey(optimistic), itemKey(echo))
})

test('lockSummary: counts; lockable = unlocked, unlockable = own or (mod) any; 0 while the session cannot write or me may not edit', () => {
	const sel = [item('a', null), item('b', mine), item('c', bob)]
	assert.deepEqual(lockSummary(sel, ME), {
		locked: 2, unlocked: 1, lockable: 1, unlockable: 1, lockedBy: { kind: 'several' }, unlockBy: { kind: 'mine' },
	})
	assert.deepEqual(lockSummary(sel, MOD), {
		locked: 2, unlocked: 1, lockable: 1, unlockable: 2, lockedBy: { kind: 'several' }, unlockBy: { kind: 'name', name: 'Bob' },
	}, 'a moderator over own and Bob\'s locks: the foreign locker is named')
	assert.deepEqual(lockSummary(sel, MOD, { writable: false }), {
		locked: 2, unlocked: 1, lockable: 0, unlockable: 0, lockedBy: { kind: 'several' }, unlockBy: null,
	})
	assert.deepEqual(lockSummary(sel, { ...MOD, role: 'vote' }), {
		locked: 2, unlocked: 1, lockable: 0, unlockable: 0, lockedBy: { kind: 'several' }, unlockBy: null,
	})
	assert.deepEqual(lockSummary([], ME), { locked: 0, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: null, unlockBy: null })
	assert.deepEqual(lockSummary([item('a', null)], ME), { locked: 0, unlocked: 1, lockable: 1, unlockable: 0, lockedBy: null, unlockBy: null })
})

test('lockSummary lockedBy: mine, one named foreign locker (grouped by by), unknown (all nameless), several', () => {
	const by = (locks, me = ME) => lockSummary(locks.map((l, i) => item('i' + i, l)), me).lockedBy
	assert.deepEqual(by([mine, mine]), { kind: 'mine' })
	assert.deepEqual(by([bob, bob]), { kind: 'name', name: 'Bob' })
	assert.deepEqual(by([bob, { by: bob.by, name: null }]), { kind: 'name', name: 'Bob' }, 'the same locker, one name')
	assert.deepEqual(by([unknown]), { kind: 'unknown' })
	assert.deepEqual(by([unknown, { by: 'x', name: null }]), { kind: 'unknown' }, 'all foreign and nameless')
	assert.deepEqual(by([bob, carol]), { kind: 'several' })
	assert.deepEqual(by([bob, { by: 'other', name: 'Bob' }]), { kind: 'several' }, 'two people named Bob: grouped by by')
	assert.deepEqual(by([{ by: null, name: 'Bob' }, { by: null, name: 'Bob' }]), { kind: 'name', name: 'Bob' }, 'without by: by name')
	assert.deepEqual(by([bob, unknown]), { kind: 'several' })
	assert.deepEqual(by([mine, bob]), { kind: 'several' })
})

test('lockSummary unlockBy: mine when every unlockable lock is own, else over the foreign ones among them', () => {
	const un = (locks, me = MOD) => lockSummary(locks.map((l, i) => item('i' + i, l)), me).unlockBy
	assert.deepEqual(un([mine], ME), { kind: 'mine' })
	assert.equal(un([bob], ME), null, 'nothing unlockable')
	assert.deepEqual(un([bob, mine], ME), { kind: 'mine' }, 'only the own lock is unlockable for an editor')
	assert.deepEqual(un([bob]), { kind: 'name', name: 'Bob' })
	assert.deepEqual(un([unknown]), { kind: 'unknown' })
	assert.deepEqual(un([bob, carol]), { kind: 'several' })
	assert.deepEqual(un([mine, unknown]), { kind: 'unknown' })
})
