/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/scene/order.js: binary insert position (same result as a linear scan),
 * key accessor for Konva nodes, bulk re-attach threshold (> 50 %).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { insertIndex, shouldBulkReattach } from '../../../src/scene/order.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

describe('insertIndex', () => {
	test('matches a linear scan for every position', () => {
		const kids = ['b', 'd', 'f', 'h']
		for (const id of ['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i']) {
			let linear = kids.length
			for (let i = 0; i < kids.length; i++) {
				if (cmp(kids[i], id) > 0) {
					linear = i
					break
				}
			}
			assert.equal(insertIndex(kids, id, cmp), linear, id)
		}
		assert.equal(insertIndex([], 'x', cmp), 0)
	})

	test('key accessor (Konva children with a kid attribute)', () => {
		const nodes = ['a', 'c', 'e'].map((kid) => ({ getAttr: () => kid }))
		assert.equal(insertIndex(nodes, 'd', cmp, (n) => n.getAttr('kid')), 2)
	})

	test('with SceneModel.compareOrder: frames first, then z, id breaks ties', () => {
		const m = new SceneModel()
		m.load([
			{ id: 'F', t: 'frame', x: 0, y: 0, w: 100, h: 100, z: 'i5' },
			{ id: 'A', t: 'sticky', x: 0, y: 0, w: 10, h: 10, z: 'i1' },
			{ id: 'B', t: 'sticky', x: 0, y: 0, w: 10, h: 10, z: 'i3' },
			{ id: 'C', t: 'sticky', x: 0, y: 0, w: 10, h: 10, z: 'i3' },
		])
		const kids = m.sortByOrder(['C', 'A', 'F'])
		assert.deepEqual(kids, ['F', 'A', 'C'])
		assert.equal(insertIndex(kids, 'B', (a, b) => m.compareOrder(a, b)), 2, 'B < C on equal z')
	})
})

describe('shouldBulkReattach', () => {
	test('more than 50 % of the attached count', () => {
		assert.equal(shouldBulkReattach(0, 0), false)
		assert.equal(shouldBulkReattach(1, 0), true)
		assert.equal(shouldBulkReattach(50, 100), false)
		assert.equal(shouldBulkReattach(51, 100), true)
		assert.equal(shouldBulkReattach(3, 100), false)
	})
})
