/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Groups in the model (job 026, AK5; M2 SPEC-M1 §1.2 "(R20) Gruppieren"):
 * the group index of the SceneModel (membersOf after load and apply) and
 * the pure helpers of src/model/groups.js on the real SceneModel: groupOf
 * (a group counts from two members), expandGroups (the current item stays
 * last), wholeGroups, heldGroup, movableIds (a group with a locked member
 * drops out whole), blocksOf, groupPlan, ungroupPlan and groupSummary
 * (every groupBlock reason, oneGroup, grouped, ungroupBlock, writable;
 * groupable 0 when C is exactly one group).
 * Round 1 (code review 2): groupSize, and the cost of the helpers – membersOf
 * at most once per group and call, groupOf without it; a group of 5000
 * notes stays fast.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import {
	blocksOf, expandGroups, groupOf, groupPlan, groupSummary, heldGroup, isOneGroup, movableIds, ungroupPlan, wholeGroups,
} from '../../../src/model/groups.js'
import { FakeModel } from '../board/fakes.mjs'
import { isGroupable } from '../../../src/model/registry.js'

const G = '01JG0000000000000000000001'
const H = '01JG0000000000000000000002'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const note = (id, extra = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a' + id.slice(-1), parent: null, data: {}, style: {}, ...extra })
const frame = (id, extra = {}) => ({ id, t: 'frame', x: 0, y: 0, w: 800, h: 600, r: 0, z: 'a0', parent: null, data: {}, style: {}, ...extra })
const conn = (id) => ({ id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b1', parent: null, data: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }, style: {} })

/** @param {object[]} items WireItems @return {SceneModel} loaded model */
function model(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

test('AK5 membersOf: after load in stacking order, after apply (upsert with a new group, a group change, remove), [] for an unknown id', () => {
	const m = model([note('A1', { group: G }), note('B2', { group: G }), note('C3'), note('D4', { group: H })])
	assert.deepEqual(m.membersOf(G), ['A1', 'B2'])
	assert.deepEqual(m.membersOf(H), ['D4'], 'a group of one is indexed (groupOf decides what counts)')
	assert.deepEqual(m.membersOf('01JG0000000000000000000099'), [])
	assert.deepEqual(m.membersOf(null), [])
	m.apply({ upserts: [note('E5', { group: G })] })
	assert.deepEqual(m.membersOf(G), ['A1', 'B2', 'E5'], 'a new item with a group')
	m.apply({ upserts: [{ ...m.get('C3'), group: G }, { ...m.get('A1'), group: H }] })
	assert.deepEqual(m.membersOf(G), ['B2', 'C3', 'E5'], 'C3 joined, A1 left')
	assert.deepEqual(m.membersOf(H), ['A1', 'D4'])
	m.apply({ removes: ['B2', 'D4'] })
	assert.deepEqual(m.membersOf(G), ['C3', 'E5'])
	assert.deepEqual(m.membersOf(H), ['A1'])
	m.apply({ upserts: [{ ...m.get('A1'), group: null }] })
	assert.deepEqual(m.membersOf(H), [], 'the last member left: the group is gone from the index')
	m.load([note('X9', { group: H })])
	assert.deepEqual([m.membersOf(G), m.membersOf(H)], [[], ['X9']], 'load replaces the index')
})

test('AK5 groupOf: the group from two live members on; one member left (or unknown id, no group) → null', () => {
	const m = model([note('A1', { group: G }), note('B2', { group: G }), note('C3', { group: H }), note('D4')])
	assert.equal(groupOf(m, 'A1'), G)
	assert.equal(groupOf(m, 'C3'), null, 'H has one member: no group for the client')
	assert.equal(groupOf(m, 'D4'), null)
	assert.equal(groupOf(m, 'nope'), null)
	m.apply({ removes: ['B2'] })
	assert.equal(groupOf(m, 'A1'), null, 'after the remove only one member is left')
})

test('AK5 expandGroups: the members of the groups come first, the given ids keep their order, the current item stays last', () => {
	const m = model([note('A1', { group: G }), note('B2', { group: G }), note('C3', { group: G }), note('D4'), note('E5', { group: H }), note('F6', { group: H })])
	assert.deepEqual(expandGroups(m, ['B2']), ['A1', 'C3', 'B2'])
	assert.deepEqual(expandGroups(m, ['D4', 'B2']), ['A1', 'C3', 'D4', 'B2'])
	assert.deepEqual(expandGroups(m, ['F6', 'A1']), ['E5', 'B2', 'C3', 'F6', 'A1'])
	assert.deepEqual(expandGroups(m, ['A1', 'B2', 'C3']), ['A1', 'B2', 'C3'], 'a whole group stays as it is')
	assert.deepEqual(expandGroups(m, []), [])
})

test('AK5 wholeGroups, heldGroup, movableIds: a group with a locked member drops out whole, also a member selected alone', () => {
	const m = model([note('A1', { group: G }), note('B2', { group: G, lock: LOCK }), note('C3', { group: H }), note('D4', { group: H }), note('E5'), note('F6', { lock: LOCK })])
	assert.deepEqual(wholeGroups(m, ['A1', 'B2', 'C3']), [G])
	assert.deepEqual(wholeGroups(m, ['C3', 'D4', 'A1', 'B2']), [H, G])
	assert.deepEqual(wholeGroups(m, ['A1', 'C3']), [])
	assert.equal(heldGroup(m, G), true)
	assert.equal(heldGroup(m, H), false)
	assert.equal(heldGroup(m, null), false)
	assert.deepEqual(movableIds(m, ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'nope']), ['C3', 'D4', 'E5'], 'no locked item, no member of G, no unknown id')
	assert.deepEqual(movableIds(m, ['A1']), [], 'the free member of a held group alone does not move either')
})

test('AK5 blocksOf: a fully selected group is one block (its members in selection order), everything else alone', () => {
	const m = model([note('A1', { group: G }), note('B2', { group: G }), note('C3', { group: H }), note('D4', { group: H }), note('E5')])
	assert.deepEqual(blocksOf(m, ['E5', 'B2', 'C3', 'A1']), [['E5'], ['B2', 'A1'], ['C3']], 'H is not whole: C3 alone')
	assert.deepEqual(blocksOf(m, ['A1', 'B2', 'C3', 'D4']), [['A1', 'B2'], ['C3', 'D4']])
	assert.deepEqual(blocksOf(m, []), [])
})

test('AK5 groupPlan / groupSummary: every groupBlock reason in its order (frame, locked, parent), oneGroup, grouped, ungroupBlock, writable false', () => {
	const F = 'F0'
	const m = model([
		frame(F), note('A1', { group: G }), note('B2', { group: G }), note('C3'), note('D4', { parent: F, x: 10, y: 10 }),
		note('E5', { lock: LOCK }), note('L7', { group: H, lock: LOCK }), note('M8', { group: H }), conn('K9'),
	])
	const sum = (ids) => groupSummary(m, ids)
	assert.deepEqual(sum(['C3', 'K9']), { groupable: 1, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false }, 'a connector is no member')
	assert.deepEqual(sum(['A1', 'C3']), { groupable: 3, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: false }, 'C = A1, B2 (the group) and C3')
	assert.deepEqual(groupPlan(m, ['C3', 'A1']).ids, ['A1', 'B2', 'C3'], 'C in stacking order')
	assert.deepEqual(sum(['A1', 'B2']), { groupable: 0, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: true }, 'exactly one group: no new group')
	// round 1 (code review 1, UX B1): C exactly one group → nothing to group, also when the selection is not
	assert.deepEqual(sum(['B2']), { groupable: 0, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: false }, 'one member (second click): C = the group')
	assert.deepEqual(sum(['A1', 'B2', 'K9']), { groupable: 0, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: false }, 'the group plus a connector: C = the group')
	assert.deepEqual(sum(['B2', 'C3']), { groupable: 3, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: false }, 'one member plus an item: a new group of three')
	assert.equal(sum(['C3', F, 'E5', 'D4']).groupBlock, 'frame', 'a frame first')
	assert.equal(sum(['C3', F]).groupable, 1, 'frames are not counted')
	assert.equal(sum(['C3', 'E5', 'D4']).groupBlock, 'locked', 'then a locked item')
	assert.equal(sum(['C3', 'D4']).groupBlock, 'parent', 'then different parents')
	assert.deepEqual(sum(['L7', 'C3']), { groupable: 3, groupBlock: 'locked', grouped: 1, ungroupBlock: 'locked', oneGroup: false }, 'a locked member blocks both')
	assert.deepEqual(sum(['A1', 'M8']), { groupable: 4, groupBlock: 'locked', grouped: 2, ungroupBlock: 'locked', oneGroup: false })
	assert.deepEqual(groupSummary(m, ['A1', 'C3'], { writable: false }), { groupable: 0, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(groupSummary(null, ['A1']).groupable, 0)
	assert.deepEqual(ungroupPlan(m, ['A1', 'B2', 'C3']), { groups: [G], blocked: null })
	assert.equal(isOneGroup(m, ['B2', 'A1']), true)
	assert.equal(isOneGroup(m, ['A1', 'B2', 'C3']), false)
})

test('isGroupable (registry.js, mirror of ItemRegistry::isGroupable): sticky, shape, text; never frame, connector or an unknown type', () => {
	for (const t of ['sticky', 'shape', 'text']) assert.equal(isGroupable(t), true, t)
	for (const t of ['frame', 'connector', 'mindmap', 'constructor', null]) assert.equal(isGroupable(t), false, String(t))
})

test('round 1 groupSize: the size of the index set, a group of one included; 0 for an unknown id or null', () => {
	const m = model([note('A1', { group: G }), note('B2', { group: G }), note('C3', { group: H }), note('D4')])
	assert.deepEqual([m.groupSize(G), m.groupSize(H), m.groupSize('nope'), m.groupSize(null)], [2, 1, 0, 0])
	m.apply({ upserts: [note('D4', { group: G })], removes: ['A1'] })
	assert.deepEqual([m.groupSize(G), m.groupSize(H)], [2, 1])
	m.apply({ removes: ['C3'] })
	assert.equal(m.groupSize(H), 0)
})

test('round 1 (code review 2): every helper asks membersOf at most once per group; groupOf asks groupSize, a model without it falls back to membersOf', () => {
	const items = [note('A1', { group: G }), note('B2', { group: G }), note('C3', { group: G }), note('D4', { group: H }), note('E5', { group: H }), note('F6')]
	const counted = (fake) => {
		const calls = new Map()
		const membersOf = fake.membersOf.bind(fake)
		fake.membersOf = (g) => {
			calls.set(g, (calls.get(g) ?? 0) + 1)
			return membersOf(g)
		}
		return calls
	}
	const all = items.map((it) => it.id)
	const runs = {
		groupOf: (m) => all.map((id) => groupOf(m, id)),
		expandGroups: (m) => expandGroups(m, all),
		wholeGroups: (m) => wholeGroups(m, all),
		movableIds: (m) => movableIds(m, all),
		blocksOf: (m) => blocksOf(m, all),
		isOneGroup: (m) => isOneGroup(m, ['A1', 'B2', 'C3']),
		ungroupPlan: (m) => ungroupPlan(m, all),
	}
	for (const [name, run] of Object.entries(runs)) {
		const m = new FakeModel(items)
		const calls = counted(m)
		run(m)
		const most = Math.max(0, ...calls.values())
		const limit = name === 'groupOf' ? 0 : 1
		assert.ok(most <= limit, name + ': membersOf asked ' + most + ' times for one group')
	}
	// a model without groupSize: groupOf still works through membersOf
	const plain = new FakeModel(items)
	plain.groupSize = undefined
	assert.deepEqual(['A1', 'D4', 'F6'].map((id) => groupOf(plain, id)), [G, H, null])
})

test('round 1 (code review 2): a whole group of 5000 notes – summary, blocks, movable ids and expand in well under a second each', () => {
	const n = 5000
	const items = []
	for (let i = 0; i < n; i++) {
		items.push(note('N' + String(i).padStart(5, '0'), { x: (i % 100) * 210, y: Math.floor(i / 100) * 210, z: 'a' + String(i).padStart(5, '0'), group: G }))
	}
	const m = model(items)
	const all = items.map((it) => it.id)
	const one = [all[42]]
	for (const [name, run] of [
		['groupSummary', () => groupSummary(m, all)],
		['groupSummary of one member', () => groupSummary(m, one)],
		['blocksOf(movableIds)', () => blocksOf(m, movableIds(m, all))],
		['wholeGroups', () => wholeGroups(m, all)],
		['expandGroups of one member', () => expandGroups(m, one)],
	]) {
		const t0 = performance.now()
		run()
		const ms = performance.now() - t0
		assert.ok(ms < 500, name + ' took ' + Math.round(ms) + ' ms')
	}
	assert.deepEqual(groupSummary(m, all), { groupable: 0, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: true })
	assert.equal(blocksOf(m, all).length, 1)
})
