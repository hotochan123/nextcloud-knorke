/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UndoStack, planTagHistory } from '../../../src/board/undo.js'

const p = (id, v) => ({ o: 'patch', id, p: { 'data.text': v } })

test('undo/redo order, fresh copies, redo cleared by a new action', () => {
	const u = new UndoStack()
	assert.equal(u.canUndo(), false)
	assert.equal(u.undo(), null)
	u.push({ ops: [p('a', '1')], inverse: [p('a', '0')] })
	u.push({ ops: [p('b', '1')], inverse: [p('b', '0')] })
	const inv = u.undo()
	assert.deepEqual(inv, [p('b', '0')])
	inv[0].id = 'mutated'
	assert.equal(u.canRedo(), true)
	assert.deepEqual(u.redo(), [p('b', '1')])
	assert.deepEqual(u.undo(), [p('b', '0')], 'stored steps are not affected by callers')
	u.push({ ops: [p('c', '1')], inverse: [p('c', '0')] })
	assert.equal(u.canRedo(), false)
	assert.deepEqual(u.undo(), [p('c', '0')])
	assert.deepEqual(u.undo(), [p('a', '0')])
	assert.equal(u.canUndo(), false)
	u.clear()
	assert.equal(u.canRedo(), false)
})

test('limit: at most 50 steps, the oldest fall off', () => {
	const u = new UndoStack(50)
	for (let i = 0; i < 60; i++) {
		u.push({ ops: [p('x', String(i))], inverse: [p('x', String(i - 1))] })
	}
	let n = 0
	let last = null
	while (u.canUndo()) {
		last = u.undo()
		n++
	}
	assert.equal(n, 50)
	assert.deepEqual(last, [p('x', '9')])
})

test('same mergeKey merges a text session into one step; the first inverse survives', () => {
	const u = new UndoStack()
	u.push({ ops: [p('n', 'h')], inverse: [p('n', '')], mergeKey: 'text:n:0' })
	u.push({ ops: [p('n', 'he')], inverse: [p('n', 'h')], mergeKey: 'text:n:0' })
	u.push({ ops: [p('n', 'hello')], inverse: [p('n', 'he')], mergeKey: 'text:n:0' })
	u.push({ ops: [p('n', 'x')], inverse: [p('n', 'hello')], mergeKey: 'text:n:1' })
	const undo2 = u.undo()
	assert.deepEqual(undo2, [p('n', 'hello')])
	const undo1 = u.undo()
	// applied in order, the last inverse is the state before the session
	assert.equal(undo1[undo1.length - 1].p['data.text'], '')
	assert.equal(u.canUndo(), false)
	const redo1 = u.redo()
	assert.equal(redo1[redo1.length - 1].p['data.text'], 'hello')
	// empty ops are not recorded
	u.push({ ops: [], inverse: [] })
	assert.equal(u.canRedo(), true)
})

test('job 023 (AK11): a lock step is one step (one op per item); undo gives {lock: null}, redo the lock again; job 155: with a cut the step moves trimmed to what went out, and a fully skipped step vanishes', () => {
	const u = new UndoStack()
	const lock = { by: 'pidme', name: 'Me' }
	const step = () => ({ ops: [{ o: 'patch', id: 'a', p: { lock } }, { o: 'patch', id: 'b', p: { lock } }], inverse: [{ o: 'patch', id: 'a', p: { lock: null } }, { o: 'patch', id: 'b', p: { lock: null } }] })
	u.push(step())
	assert.deepEqual(u.undo(), [{ o: 'patch', id: 'a', p: { lock: null } }, { o: 'patch', id: 'b', p: { lock: null } }])
	assert.equal(u.canUndo(), false)
	assert.equal(u.canRedo(), true, 'without a cut the whole step moves')
	assert.deepEqual(u.redo().map((op) => op.p.lock), [lock, lock])
	assert.equal(u.canUndo(), true)
	// the cut gets fresh copies and keeps only a
	let seen = null
	u.undo((s) => {
		seen = s
		s.ops[0].id = 'mutated'
		return { ops: [s.ops[1]], inverse: [s.inverse[1]] }
	})
	assert.deepEqual(seen.inverse.map((op) => op.id), ['a', 'b'])
	assert.equal(u.canRedo(), true)
	assert.deepEqual(u.redo(), [{ o: 'patch', id: 'b', p: { lock } }], 'only what went out comes back')
	// nothing went out (every op skipped, e.g. lock-undo): the step vanishes from both stacks
	u.undo(() => null)
	assert.equal(u.canUndo(), false)
	assert.equal(u.canRedo(), false)
	u.push(step())
	u.undo()
	u.redo(() => ({ ops: [], inverse: [] }))
	assert.equal(u.canUndo(), false, 'an empty step vanishes on redo too')
	assert.equal(u.canRedo(), false)
})

// ---- job 206: steps with a tag part ----------------------------------------

const TAG = 'T0000000000000000000000001'
const tg = (name, color = '#e53935') => ({ id: TAG, name, color })

test('job 206 AK1: the tag part of create, rename, recolour and delete against the board\'s tags, both directions', () => {
	const create = { id: TAG, before: null, after: tg('Kosten') }
	// undo of a create: delete while the name is the step's, whatever the colour; the trimmed step holds the tag right before
	assert.deepEqual(planTagHistory(create, 'undo', tg('Kosten', '#43a047')), { body: { action: 'delete', tag: TAG }, tag: { id: TAG, before: null, after: tg('Kosten', '#43a047') }, changed: false })
	assert.deepEqual(planTagHistory(create, 'undo', null), { body: null, tag: null, changed: false }, 'already gone: nothing')
	assert.deepEqual(planTagHistory(create, 'undo', tg('Budget')), { body: null, tag: null, changed: true }, 'renamed by someone else: skipped')
	// redo of a create: add while the id is missing
	assert.deepEqual(planTagHistory(create, 'redo', null), { body: { action: 'add', tags: [tg('Kosten')] }, tag: create, changed: false })
	assert.deepEqual(planTagHistory(create, 'redo', tg('Kosten')).body, null, 'already there: nothing')
	const del = { id: TAG, before: tg('Kosten'), after: null, notes: ['n1', 'n2'] }
	assert.deepEqual(planTagHistory(del, 'undo', null), { body: { action: 'add', tags: [tg('Kosten')] }, tag: del, changed: false })
	assert.deepEqual(planTagHistory(del, 'undo', tg('Kosten')), { body: null, tag: null, changed: false })
	// redo of a delete: the notes that carry it right before
	assert.deepEqual(planTagHistory(del, 'redo', tg('Kosten', '#fb8c00'), ['n3']), { body: { action: 'delete', tag: TAG }, tag: { id: TAG, before: tg('Kosten', '#fb8c00'), after: null, notes: ['n3'] }, changed: false })
	assert.deepEqual(planTagHistory(del, 'redo', tg('Geld'), ['n3']).changed, true)
	const rename = { id: TAG, before: tg('Kosten'), after: tg('Budget') }
	assert.deepEqual(planTagHistory(rename, 'undo', tg('Budget')), { body: { action: 'update', tag: TAG, name: 'Kosten' }, tag: rename, changed: false })
	assert.deepEqual(planTagHistory(rename, 'undo', tg('Kosten')), { body: null, tag: null, changed: false }, 'already the target')
	assert.deepEqual(planTagHistory(rename, 'undo', tg('Geld')), { body: null, tag: null, changed: true }, 'renamed again by someone else')
	assert.deepEqual(planTagHistory(rename, 'undo', null), { body: null, tag: null, changed: true }, 'deleted by someone else')
	assert.deepEqual(planTagHistory(rename, 'redo', tg('Kosten', '#43a047')).body, { action: 'update', tag: TAG, name: 'Budget' }, 'another colour does not matter')
	const recolor = { id: TAG, before: tg('Kosten', '#e53935'), after: tg('Kosten', '#43a047') }
	assert.deepEqual(planTagHistory(recolor, 'undo', tg('Budget', '#43a047')).body, { action: 'update', tag: TAG, color: '#e53935' }, 'another name does not matter')
	assert.deepEqual(planTagHistory(recolor, 'undo', tg('Kosten', '#fb8c00')), { body: null, tag: null, changed: true })
	assert.deepEqual(planTagHistory(recolor, 'redo', tg('Kosten', '#e53935')).body, { action: 'update', tag: TAG, color: '#43a047' })
})

test('job 206 AK1: UndoStack keeps steps with a tag part and no ops, never merges them, and settles them after their write', () => {
	const u = new UndoStack()
	const tag = { id: TAG, before: tg('Kosten'), after: tg('Budget') }
	u.push({ ops: [], inverse: [] })
	assert.equal(u.canUndo(), false, 'no ops and no tag part: no step')
	u.push({ ops: [p('a', '1')], inverse: [p('a', '0')], mergeKey: 'k' })
	u.push({ ops: [], inverse: [], mergeKey: 'k', tag })
	assert.equal(u.done.length, 2, 'a tag step is never merged')
	assert.deepEqual(u.peek('undo'), { ops: [], inverse: [], mergeKey: null, tag })
	// undo settled: it moves to the redo side
	let start = { gen: u.gen, at: u.done.length }
	u.settle(u.peek('undo'), 'undo', { ops: [], inverse: [], tag }, start)
	assert.deepEqual([u.done.length, u.undone.length], [1, 1])
	// redo settled with a new step meanwhile: back below that step
	start = { gen: u.gen, at: u.done.length }
	const step = u.peek('redo')
	u.push({ ops: [p('b', '1')], inverse: [p('b', '0')] })
	u.settle(step, 'redo', { ops: [], inverse: [], tag }, start)
	assert.deepEqual(u.done.map((s) => (s.tag ? 'tag' : s.ops[0].id)), ['a', 'tag', 'b'])
	// undo settled after a new step: nothing to redo
	start = { gen: u.gen, at: u.done.length }
	const top = u.done[1]
	u.push({ ops: [p('c', '1')], inverse: [p('c', '0')] })
	u.settle(top, 'undo', { ops: [], inverse: [], tag }, start)
	assert.deepEqual([u.done.map((s) => (s.tag ? 'tag' : s.ops[0].id)), u.canRedo()], [['a', 'b', 'c'], false])
	// nothing went out: the step vanishes
	u.push({ ops: [], inverse: [], tag })
	start = { gen: u.gen, at: u.done.length }
	u.settle(u.peek('undo'), 'undo', null, start)
	assert.deepEqual([u.done.length, u.canRedo()], [3, false])
})
