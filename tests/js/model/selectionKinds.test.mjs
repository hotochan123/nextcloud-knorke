/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Filter the selection (factory job 144, AK1): the pure helpers of
 * src/model/groups.js on the real SceneModel. selectionKinds gives the kinds
 * of a selection in the order sticky, shape, text, connector, frame, group
 * (locked items and group members with their type, 'group' = the fully
 * selected groups with their members, unknown types left out, ids in
 * selection order); filterKinds gives selection v2 kinds, [] while no entry
 * would make the selection smaller. Linear: membersOf at most once per
 * group, a selection of 5000 notes in a group is fast.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { ITEM_KINDS, filterKinds, selectionKinds } from '../../../src/model/groups.js'
import { FakeModel } from '../board/fakes.mjs'

const G = '01JG0000000000000000000001'
const H = '01JG0000000000000000000002'
const I = '01JG0000000000000000000003'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const base = (id, t, extra) => ({ id, t, x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a' + id, parent: null, data: {}, style: {}, ...extra })
const note = (id, extra = {}) => base(id, 'sticky', extra)
const shape = (id, extra = {}) => base(id, 'shape', { data: { kind: 'rect' }, ...extra })
const conn = (id) => base(id, 'connector', { w: 0, h: 0, data: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } })

/** The test selection F of the spec, in this order. */
const F = ['N1', 'N2', 'N3', 'N4', 'S1', 'S2', 'K', 'N5', 'X']

/** @return {object[]} N1, N2 loose; G = {N3, N4, S1}; S2; K; N5 locked; X unknown; H = {H1, H2}, I = {I1, I2} note groups */
function items() {
	return [
		note('N1'), note('N2'), note('N3', { group: G }), note('N4', { group: G }), shape('S1', { group: G }), shape('S2'), conn('K'),
		note('N5', { lock: LOCK }), base('X', 'widget'),
		note('H1', { group: H }), note('H2', { group: H }), note('I1', { group: I }), note('I2', { group: I }),
	]
}

/** @return {SceneModel} the loaded model */
function model(list = items()) {
	const m = new SceneModel()
	m.load(list)
	return m
}

test('job 144 AK1: selectionKinds of F – sticky 5, shape 2, connector 1, group 1 in this order; ids in selection order, the group\'s ids its members', () => {
	const m = model()
	assert.deepEqual(selectionKinds(m, F), [
		{ kind: 'sticky', count: 5, ids: ['N1', 'N2', 'N3', 'N4', 'N5'] },
		{ kind: 'shape', count: 2, ids: ['S1', 'S2'] },
		{ kind: 'connector', count: 1, ids: ['K'] },
		{ kind: 'group', count: 1, ids: ['N3', 'N4', 'S1'] },
	])
	assert.deepEqual(filterKinds(m, F), [{ kind: 'sticky', count: 5 }, { kind: 'shape', count: 2 }, { kind: 'connector', count: 1 }, { kind: 'group', count: 1 }])
	assert.deepEqual(ITEM_KINDS, ['sticky', 'shape', 'text', 'connector', 'frame'])
})

test('job 144 AK1: the current item stays the last of its kind; ids the model does not know and duplicates are left out; text and frame have entries of their own', () => {
	const m = model([...items(), base('T1', 'text'), base('T2', 'text'), base('FR', 'frame', { w: 800, h: 600 })])
	assert.deepEqual(selectionKinds(m, ['S2', 'N2', 'GONE', 'N1', 'S2', 'T2', 'FR', 'T1', 'N2']).map((k) => [k.kind, k.ids]), [
		['sticky', ['N2', 'N1']], ['shape', ['S2']], ['text', ['T2', 'T1']], ['frame', ['FR']],
	])
	// the group's members keep the selection order too (S1 the current item)
	assert.deepEqual(selectionKinds(m, ['N4', 'N1', 'N3', 'S1']).at(-1), { kind: 'group', count: 1, ids: ['N4', 'N3', 'S1'] })
	// two whole groups: count 2, every member
	assert.deepEqual(selectionKinds(m, ['H1', 'S2', 'I2', 'H2', 'I1']).at(-1), { kind: 'group', count: 2, ids: ['H1', 'I2', 'H2', 'I1'] })
	assert.deepEqual(selectionKinds(m, ['X']), [], 'an unknown type: no entry')
	assert.deepEqual(selectionKinds(null, F), [])
	assert.deepEqual(selectionKinds(m, undefined), [])
})

test('job 144 AK1: filterKinds is [] for an empty selection, one item, only notes, exactly one note group, two whole note groups and N1 with only N3 (a single member is no group)', () => {
	const m = model()
	for (const [name, ids] of [
		['empty', []], ['one item', ['S2']], ['only notes', ['N1', 'N2', 'N5']], ['one note group', ['H1', 'H2']],
		['two whole note groups', ['H1', 'H2', 'I1', 'I2']], ['N1 with only N3', ['N1', 'N3']],
	]) {
		assert.deepEqual(filterKinds(m, ids), [], name)
	}
	// the reasons: one note group has two entries, but each keeps the whole selection
	assert.deepEqual(selectionKinds(m, ['H1', 'H2']).map((k) => [k.kind, k.count, k.ids.length]), [['sticky', 2, 2], ['group', 1, 2]])
	assert.deepEqual(selectionKinds(m, ['N1', 'N3']).map((k) => k.kind), ['sticky'], 'N3 alone: its group is not fully selected')
	// a note group plus a loose note is filterable: "Only groups" keeps two of three
	assert.deepEqual(filterKinds(m, ['H1', 'H2', 'N1']), [{ kind: 'sticky', count: 3 }, { kind: 'group', count: 1 }])
	// an unknown type counts as a selected item: "Only notes" would drop it
	assert.deepEqual(filterKinds(m, ['N1', 'X', 'S2']), [{ kind: 'sticky', count: 1 }, { kind: 'shape', count: 1 }])
})

test('job 144: linear – selectionKinds asks membersOf at most once per group; 5000 notes of one group plus a shape in well under a second', () => {
	const fake = new FakeModel(items())
	const calls = new Map()
	const membersOf = fake.membersOf.bind(fake)
	fake.membersOf = (g) => {
		calls.set(g, (calls.get(g) ?? 0) + 1)
		return membersOf(g)
	}
	assert.equal(selectionKinds(fake, [...F, 'H1', 'H2', 'I1']).at(-1).count, 2)
	assert.ok(Math.max(0, ...calls.values()) <= 1, 'membersOf per group: ' + JSON.stringify([...calls]))
	const n = 5000
	const list = [shape('SX')]
	for (let i = 0; i < n; i++) {
		list.push(note('M' + String(i).padStart(5, '0'), { x: (i % 100) * 210, y: Math.floor(i / 100) * 210, group: G }))
	}
	const m = model(list)
	const all = list.map((it) => it.id)
	const t0 = performance.now()
	const kinds = filterKinds(m, all)
	const ms = performance.now() - t0
	assert.ok(ms < 500, 'filterKinds took ' + Math.round(ms) + ' ms')
	assert.deepEqual(kinds, [{ kind: 'sticky', count: n }, { kind: 'shape', count: 1 }, { kind: 'group', count: 1 }])
})
