/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UndoStack } from '../../../src/board/undo.js'

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

test('job 023 (AK11): a lock step is one step (one op per item); undo gives {lock: null}, redo the lock again; a step moves to the other stack whatever the session sends of it', () => {
	const u = new UndoStack()
	const lock = { by: 'pidme', name: 'Me' }
	u.push({ ops: [{ o: 'patch', id: 'a', p: { lock } }, { o: 'patch', id: 'b', p: { lock } }], inverse: [{ o: 'patch', id: 'a', p: { lock: null } }, { o: 'patch', id: 'b', p: { lock: null } }] })
	assert.deepEqual(u.undo(), [{ o: 'patch', id: 'a', p: { lock: null } }, { o: 'patch', id: 'b', p: { lock: null } }])
	assert.equal(u.canUndo(), false)
	assert.equal(u.canRedo(), true, 'moved, even when the session skips every op of it (lock-undo)')
	assert.deepEqual(u.redo().map((op) => op.p.lock), [lock, lock])
	assert.equal(u.canUndo(), true)
})
