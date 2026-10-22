/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * VoteState (SPEC-M1 §6.5.5, stage 3): session from meta.vote, own votes
 * from the votes blocks (foreign sid dropped, R16 SRV-03), sid change resets
 * vt and voters (R16 SRV-01), optimistic proposals with the double-tap
 * lock, badges() in the SceneVoteState shape (R16 CLI-04), votable as a real
 * boolean (S-13), missReason.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPEAT_MS, VoteState, cfgOf, mineOf } from '../../../src/board/votes.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const F = '01JA00000000000000000000F1'
const T0 = 1760100000000

const open = (extra = {}) => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice', show: false, ...extra })
const closed = (extra = {}) => ({ ...open(), state: 'closed', results: [[A, 7], [B, 5]], total: 2, voters: 4, closedAt: T0 + 60000, ...extra })

test('cfgOf/mineOf: defaults and cleaning (per 1–99, perItem ≤ per, types ⊂ votable, [] as {})', () => {
	assert.deepEqual(cfgOf(null), { per: 5, perItem: 1, scope: null, types: ['sticky'] })
	assert.deepEqual(cfgOf({ per: 200, perItem: 300, scope: '', types: ['frame', 'shape', 'shape'] }), { per: 99, perItem: 99, scope: null, types: ['shape'] })
	assert.deepEqual(mineOf([]), {})
	assert.deepEqual(mineOf({ [A]: 2, [B]: 0, [C]: 1.5 }), { [A]: 2 })
	assert.equal(mineOf([1]), null)
	assert.equal(mineOf('x'), null)
})

test('setSession: open → closed → cleared; transitions opened/closed/newSid; a new sid resets mine, left, vt and voters (R16 SRV-01)', () => {
	const v = new VoteState()
	assert.equal(v.state, null)
	assert.equal(v.open, false)
	let r = v.setSession(open())
	assert.deepEqual(r, { changed: true, newSid: true, opened: true, closed: false, cleared: false })
	assert.equal(v.sid, 12)
	assert.equal(v.left, 3, 'no server left yet: per')
	v.ack(null, { sid: 12, mine: {}, left: 3, voters: 4, vt: 9 })
	assert.equal(v.vt, 9)
	assert.equal(v.voters, 4)
	r = v.setSession(open())
	assert.equal(r.changed, false, 'the same meta changes nothing')
	assert.equal(r.opened, false)
	r = v.setSession(closed())
	assert.deepEqual(r, { changed: true, newSid: false, opened: false, closed: true, cleared: false })
	assert.deepEqual(v.results, [[A, 7], [B, 5]])
	assert.equal(v.voters, 4, 'meta.vote.voters after the close')
	assert.equal(v.left, null)
	r = v.setSession(open({ sid: 13 }))
	assert.equal(r.newSid, true)
	assert.equal(r.opened, true)
	assert.equal(v.vt, 0, 'vt = 0 after a sid change')
	assert.equal(v.voters, 0, 'voters = 0 after a sid change')
	assert.deepEqual(v.mine, {})
	r = v.setSession(undefined)
	assert.deepEqual(r, { changed: true, newSid: false, opened: false, closed: false, cleared: true })
	assert.equal(v.sid, null)
	assert.deepEqual(v.badges(), new Map())
})

test('a closed session seen for the first time is no "closed" transition (only open → closed of the same sid)', () => {
	const v = new VoteState()
	const r = v.setSession(closed())
	assert.equal(r.closed, false)
	assert.equal(r.newSid, true)
})

test('setMine and ack drop blocks of a foreign sid (R16 SRV-03); mine {} or [] both mean empty', () => {
	const v = new VoteState()
	v.setSession(open())
	assert.equal(v.setMine(11, { [A]: 1 }, 2), false, 'foreign sid')
	assert.deepEqual(v.mine, {})
	assert.equal(v.setMine(12, { [A]: 1 }, 2), true)
	assert.deepEqual(v.mine, { [A]: 1 })
	assert.equal(v.left, 2)
	let r = v.ack(null, { sid: 99, mine: {}, left: 3, voters: 50, vt: 77 })
	assert.equal(r.taken, false)
	assert.deepEqual(v.mine, { [A]: 1 }, 'nothing of the foreign block')
	assert.equal(v.vt, 0)
	r = v.ack(null, { sid: 12, mine: [], left: 3 })
	assert.equal(r.taken, true)
	assert.deepEqual(v.mine, {}, 'PHP [] counts as {}')
	assert.equal(v.left, 3)
	r = v.ack(null, { sid: 12, voters: 5, vt: 6 })
	assert.equal(r.taken, true, 'the moderator part alone (step 9)')
	assert.equal(v.left, 3, 'mine/left unchanged without them')
	assert.equal(v.voters, 5)
	assert.equal(v.vt, 6)
})

test('propose: closed, limit (per, perItem), double tap of the canvas toggle within REPEAT_MS on the same item (R2, tap), lowering always allowed', () => {
	const v = new VoteState()
	const tap = { tap: true }
	assert.deepEqual(v.propose(A, 1, T0, tap), { ok: false, reason: 'closed' }, 'no session')
	v.setSession(open())
	assert.deepEqual(v.propose(A, 2, T0), { ok: false, reason: 'limit' }, 'perItem 1')
	assert.deepEqual(v.propose(A, 1, T0, tap), { ok: true, reason: null })
	assert.deepEqual(v.propose(A, 0, T0 + REPEAT_MS - 1, tap), { ok: false, reason: 'repeat' }, 'a double tap does not take the vote back')
	assert.deepEqual(v.mine, { [A]: 1 })
	assert.deepEqual(v.propose(B, 1, T0 + 10, tap), { ok: true, reason: null }, 'another item at once is fine')
	assert.deepEqual(v.propose(C, 1, T0 + 20, tap), { ok: true, reason: null })
	assert.equal(v.left, 0)
	assert.deepEqual(v.propose('01JA0000000000000000000004', 1, T0 + 30, tap), { ok: false, reason: 'limit' }, 'per 3 used up')
	assert.deepEqual(v.propose(A, 0, T0 + REPEAT_MS, tap), { ok: true, reason: null }, 'after REPEAT_MS the same item toggles back')
	assert.equal(v.left, 1)
	assert.deepEqual(v.mine, { [B]: 1, [C]: 1 })
})

test('R22 P7-10 (CLIENT-3): without tap (vote list, stepper) there is no double-tap lock: "+" twice 150 ms apart gives 2, a quick "+" then "−" is undone, the second "+" over the budget says limit', () => {
	const v = new VoteState()
	v.setSession(open({ cfg: { per: 9, perItem: 3, scope: null, types: ['sticky'] } }))
	assert.deepEqual(v.propose(A, 1, T0), { ok: true, reason: null })
	assert.deepEqual(v.propose(A, 2, T0 + 150), { ok: true, reason: null }, 'the second "+" 150 ms later counts')
	assert.deepEqual(v.mine, { [A]: 2 })
	assert.deepEqual(v.propose(A, 1, T0 + 200), { ok: true, reason: null }, 'a quick correction "−"')
	assert.deepEqual(v.mine, { [A]: 1 })
	const w = new VoteState()
	w.setSession(open({ cfg: { per: 1, perItem: 1, scope: null, types: ['sticky'] } }))
	assert.deepEqual(w.propose(A, 1, T0), { ok: true, reason: null })
	assert.deepEqual(w.propose(B, 1, T0 + 100), { ok: false, reason: 'limit' }, 'the budget answers, never repeat')
	assert.deepEqual(w.propose(A, 2, T0 + 120), { ok: false, reason: 'limit' }, 'perItem 1 on the same item at once: limit, not repeat')
	// a list click does not arm the canvas lock either
	const x = new VoteState()
	x.setSession(open())
	assert.deepEqual(x.propose(A, 1, T0), { ok: true, reason: null })
	assert.deepEqual(x.propose(A, 0, T0 + 100, { tap: true }), { ok: true, reason: null }, 'the lock remembers taps only')
	assert.deepEqual(x.propose(A, 1, T0 + 200, { tap: true }), { ok: false, reason: 'repeat' }, 'a second tap within REPEAT_MS of that tap is the double tap')
	assert.deepEqual(x.propose(A, 1, T0 + 250), { ok: true, reason: null }, 'a list click right after a tap is never taken for a double tap')
	assert.deepEqual(x.mine, { [A]: 1 })
})

test('propose after endsAt (server time) is closed; perItem > 1 allows up to perItem', () => {
	const v = new VoteState()
	v.setSession(open({ endsAt: T0 + 1000, cfg: { per: 5, perItem: 3, scope: null, types: ['sticky'] } }))
	assert.deepEqual(v.propose(A, 3, T0), { ok: true, reason: null })
	assert.deepEqual(v.propose(B, 3, T0 + 10), { ok: false, reason: 'limit' }, '3 + 3 > 5')
	assert.deepEqual(v.propose(B, 2, T0 + 20), { ok: true, reason: null })
	assert.deepEqual(v.propose(C, 1, T0 + 1000), { ok: false, reason: 'closed' })
})

test('ack: the server state wins, pending proposals stay on top; left moves by their difference', () => {
	const v = new VoteState()
	v.setSession(open({ cfg: { per: 5, perItem: 2, scope: null, types: ['sticky'] } }))
	v.setMine(12, {}, 5)
	v.propose(A, 2, T0)
	v.propose(B, 1, T0 + 1)
	assert.equal(v.left, 2)
	// the answer to the batch with A arrives; B is still queued
	v.ack(['ok'], { sid: 12, mine: { [A]: 2 }, left: 3 }, new Map([[B, 1]]))
	assert.deepEqual(v.mine, { [A]: 2, [B]: 1 })
	assert.equal(v.left, 2)
	// B comes back limit (another tab used the budget): server says left 0
	const r = v.ack(['limit'], { sid: 12, mine: { [A]: 2 }, left: 0 }, new Map())
	assert.equal(r.limit, true)
	assert.deepEqual(v.mine, { [A]: 2 })
	assert.equal(v.left, 0)
})

test('ack without a block (denied before the lock): the optimistic vote is dropped when no op is pending', () => {
	const v = new VoteState()
	v.setSession(open())
	v.propose(A, 1, T0)
	const r = v.ack(['denied'], null, new Map())
	assert.equal(r.denied, true)
	assert.deepEqual(v.mine, {})
	assert.equal(v.left, 3)
})

test('badges(): SceneVoteState values (R16 CLI-04): own votes while open (total null), totals after the close only with show', () => {
	const v = new VoteState()
	v.setSession(open({ cfg: { per: 5, perItem: 3, scope: null, types: ['sticky'] } }))
	v.setMine(12, { [A]: 2 }, 3)
	assert.deepEqual([...v.badges()], [[A, { mine: 2, total: null }]])
	for (const b of v.badges().values()) {
		assert.ok(Number.isInteger(b.mine) && b.mine >= 0)
		assert.ok(b.total === null || (Number.isInteger(b.total) && b.total >= 0))
	}
	v.setSession(closed())
	assert.deepEqual(v.badges(), new Map(), 'closed, results hidden')
	v.setSession(closed({ show: true }))
	assert.deepEqual([...v.badges()], [[A, { mine: 0, total: 7 }], [B, { mine: 0, total: 5 }]])
})

test('votable is a real boolean (S-13): type, scope, open; missReason names the type before the scope', () => {
	const v = new VoteState()
	const note = { id: A, t: 'sticky', parent: F }
	const free = { id: B, t: 'sticky', parent: null }
	const shape = { id: C, t: 'shape', parent: F }
	const frame = { id: F, t: 'frame', parent: null }
	assert.equal(v.votable(note), false, 'no session')
	v.setSession(open({ cfg: { per: 3, perItem: 1, scope: F, types: ['sticky'] } }))
	assert.equal(v.scope, F)
	assert.equal(v.votable(note), true)
	assert.equal(v.votable(free), false)
	assert.equal(v.votable(shape), false)
	for (const x of [null, undefined, 0, '', {}, note, free]) {
		assert.equal(typeof v.votable(x), 'boolean')
	}
	assert.equal(v.missReason(free), 'scope')
	assert.equal(v.missReason(shape), 'type')
	assert.equal(v.missReason(frame), 'type', 'the scope frame itself: its type')
	assert.equal(v.missReason(note), null)
	assert.equal(v.missReason(null), null)
	v.setSession(closed())
	assert.equal(v.votable(note), false, 'closed: nothing is votable')
})

test('a closed session clears the own votes and the pending proposals (the server deleted the vote rows)', () => {
	const v = new VoteState()
	v.setSession(open())
	v.setMine(12, { [B]: 1 }, 2)
	v.propose(A, 1, T0)
	v.setSession(closed())
	assert.deepEqual(v.pending, new Map())
	assert.deepEqual(v.mine, {})
})

test('R17 K1: lowering or keeping a number never answers limit, also overdrawn after an undo; an increase still does (per 3, perItem 2, mine {A:2, B:1, C:2})', () => {
	const v = new VoteState()
	v.setSession(open({ cfg: { per: 3, perItem: 2, scope: null, types: ['sticky'] } }))
	// an undo revived voted items: the server counts 5 > per 3 and says left 0 (B1: never negative)
	assert.equal(v.setMine(12, { [A]: 2, [B]: 1, [C]: 2 }, 0), true)
	assert.equal(v.left, 0)
	assert.deepEqual(v.propose(A, 2, T0), { ok: true, reason: null }, 'an unchanged value is no increase')
	assert.deepEqual(v.propose(B, 0, T0 + 10), { ok: true, reason: null }, 'taking a vote back while overdrawn')
	assert.deepEqual(v.mine, { [A]: 2, [C]: 2 })
	assert.equal(v.left, 0, 'still 4 > per 3: nothing left (as the server: max(0, 3 − 4))')
	assert.deepEqual(v.propose(B, 1, T0 + 10 + REPEAT_MS), { ok: false, reason: 'limit' }, 'an increase checks per: 4 + 1 > 3')
	assert.deepEqual(v.mine, { [A]: 2, [C]: 2 }, 'the refused increase is not pending')
	assert.deepEqual(v.propose(C, 1, T0 + 20), { ok: true, reason: null }, 'lowering C (2 → 1) is fine')
	assert.equal(v.left, 0, '2 + 1 = 3 = per')
	assert.deepEqual(v.propose(A, 1, T0 + 30), { ok: true, reason: null })
	assert.equal(v.left, 1, '1 + 1 = 2 < per 3')
	assert.deepEqual(v.propose(B, 1, T0 + 40 + REPEAT_MS), { ok: true, reason: null }, 'below per again: an increase passes')
	assert.equal(v.left, 0)
	// the same with the budget known only from per (no server left yet)
	const w = new VoteState()
	w.setSession(open({ cfg: { per: 3, perItem: 2, scope: null, types: ['sticky'] } }))
	w.ack(null, { sid: 12, mine: { [A]: 2, [B]: 1, [C]: 2 } })
	assert.deepEqual(w.propose(B, 0, T0), { ok: true, reason: null })
	assert.deepEqual(w.propose(B, 1, T0 + REPEAT_MS), { ok: false, reason: 'limit' })
})
