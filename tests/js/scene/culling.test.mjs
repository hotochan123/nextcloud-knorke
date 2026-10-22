/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/scene/culling.js: enter/leave/next of the static layer; exempt ids
 * (dragged, previewed) neither enter nor leave.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { diffVisible } from '../../../src/scene/culling.js'

describe('diffVisible', () => {
	test('first view: everything enters', () => {
		const r = diffVisible(new Set(), ['a', 'b', 'c'], new Set())
		assert.deepEqual(r.enter.sort(), ['a', 'b', 'c'])
		assert.deepEqual(r.leave, [])
		assert.deepEqual([...r.next].sort(), ['a', 'b', 'c'])
	})

	test('pan: some leave, some enter, the rest stays', () => {
		const r = diffVisible(new Set(['a', 'b', 'c']), ['b', 'c', 'd'], new Set())
		assert.deepEqual(r.enter, ['d'])
		assert.deepEqual(r.leave, ['a'])
		assert.deepEqual([...r.next].sort(), ['b', 'c', 'd'])
	})

	test('nothing visible: everything leaves', () => {
		const r = diffVisible(new Set(['a']), [], new Set())
		assert.deepEqual(r.leave, ['a'])
		assert.equal(r.next.size, 0)
	})

	test('exempt ids never enter the static layer and are never culled', () => {
		const r = diffVisible(new Set(['a', 'x']), ['b', 'd'], new Set(['x', 'd']))
		assert.deepEqual(r.enter, ['b'])
		assert.deepEqual(r.leave, ['a'], 'x is exempt and stays')
		assert.ok(r.next.has('x'))
		assert.ok(!r.next.has('d'))
	})

	test('duplicates in hits are harmless; inputs are not mutated', () => {
		const prev = new Set(['a'])
		const r = diffVisible(prev, ['a', 'b', 'b'], new Set())
		assert.deepEqual(r.enter, ['b'])
		assert.deepEqual([...prev], ['a'])
	})
})
