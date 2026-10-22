/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/scene/Selection.js: topLevel (dragging moves only selected items without
 * a selected ancestor) and the Selection set.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Selection, topLevel } from '../../../src/scene/Selection.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const m = new SceneModel()
m.load([
	{ id: 'F', t: 'frame', x: 0, y: 0, w: 800, h: 600, z: 'i0' },
	{ id: 'A', t: 'sticky', x: 10, y: 10, w: 200, h: 200, z: 'i1', parent: 'F' },
	{ id: 'B', t: 'sticky', x: 900, y: 10, w: 200, h: 200, z: 'i2' },
	{ id: 'L', t: 'frame', x: 0, y: 0, w: 10, h: 10, z: 'i3', parent: 'L2' },
	{ id: 'L2', t: 'frame', x: 0, y: 0, w: 10, h: 10, z: 'i4', parent: 'L' },
])

describe('topLevel', () => {
	test('drops selected descendants of selected containers', () => {
		assert.deepEqual(topLevel(['A', 'F', 'B'], m), ['F', 'B'])
		assert.deepEqual(topLevel(['A', 'B'], m), ['A', 'B'])
		assert.deepEqual(topLevel(['nope', 'A'], m), ['A'])
		assert.deepEqual(topLevel([], m), [])
	})

	test('job 023 (M2 R20): a locked item stays in the selection and in topLevel; the drag drops it afterwards (its locked children follow a free frame)', () => {
		const lm = new SceneModel()
		lm.load([
			{ id: 'F', t: 'frame', x: 0, y: 0, w: 800, h: 600, z: 'i0' },
			{ id: 'A', t: 'sticky', x: 10, y: 10, w: 200, h: 200, z: 'i1', parent: 'F', lock: { by: 'p', name: 'P' } },
			{ id: 'B', t: 'sticky', x: 900, y: 10, w: 200, h: 200, z: 'i2', lock: { by: null, name: null } },
		])
		assert.deepEqual(topLevel(['A', 'F', 'B'], lm), ['F', 'B'], 'topLevel itself knows no locks')
		const s = new Selection()
		s.set(['A', 'B'])
		assert.deepEqual(s.values(), ['A', 'B'], 'a locked item can be selected (click, Tab)')
	})

	test('cycles in the parent chain terminate', () => {
		// L ↔ L2 is a cycle: each covers the other, so neither is top-level alone…
		assert.deepEqual(topLevel(['L'], m), ['L'])
		assert.deepEqual(topLevel(['L', 'L2'], m), [])
	})
})

describe('Selection', () => {
	test('set reports changes, keeps order, drops duplicates', () => {
		const s = new Selection()
		assert.equal(s.set(['a', 'b', 'a']), true)
		assert.deepEqual(s.values(), ['a', 'b'])
		assert.equal(s.set(['a', 'b']), false)
		assert.equal(s.size, 2)
		assert.equal(s.has('b'), true)
	})

	test('toggle, clear, prune', () => {
		const s = new Selection()
		s.toggle('A')
		s.toggle('B')
		s.toggle('A')
		assert.deepEqual(s.values(), ['B'])
		s.set(['A', 'gone', 'B'])
		assert.equal(s.prune(m), true)
		assert.deepEqual(s.values(), ['A', 'B'])
		assert.equal(s.prune(m), false)
		assert.equal(s.clear(), true)
		assert.equal(s.clear(), false)
	})

	test('values() is a copy', () => {
		const s = new Selection()
		s.set(['x'])
		s.values().push('y')
		assert.deepEqual(s.values(), ['x'])
	})
})
