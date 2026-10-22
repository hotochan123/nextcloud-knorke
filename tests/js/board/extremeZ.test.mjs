/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * U19 (round-1 T2, [C] side): stored extreme z keys must not break creating
 * or reordering for any client of that layer. Uses the real SceneModel and
 * the real actions (not the fakes), so the regression covers the whole path
 * BoardSession.onIntent takes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createItem, reorder } from '../../../src/board/actions.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { ID, frame, sticky } from './fakes.mjs'

const TOP = 'z'.repeat(64)
const BOTTOM = '0'.repeat(63) + '1'

/** @return {SceneModel} sticky z='z'×64, sticky z='0'×63+'1', frame z='z'×64 */
function extremeModel() {
	const m = new SceneModel()
	m.load([
		sticky(ID(1), { x: 2000, y: 0, z: TOP }),
		sticky(ID(2), { x: 2400, y: 0, z: BOTTOM }),
		frame(ID(3), { x: -5000, y: -5000, w: 400, h: 300, z: TOP }),
	])
	return m
}

let n = 0
const newId = () => ID('N' + (++n))

test('U19 the stored keys are what the finding describes (valid, at the ends of the key space)', () => {
	const m = extremeModel()
	assert.equal(isValidKey(TOP), true)
	assert.equal(isValidKey(BOTTOM), true)
	assert.equal(m.maxZ('content'), TOP)
	assert.equal(m.minZ('content'), BOTTOM)
	assert.equal(m.maxZ('back'), TOP)
})

for (const t of ['sticky', 'frame']) {
	test(`U19 createItem(${t}) above an exhausted layer: no throw, a valid z`, () => {
		const m = extremeModel()
		let r
		assert.doesNotThrow(() => { r = createItem(m, { t, at: { x: 0, y: 0 }, rect: null }, newId) })
		assert.equal(r.ops.length, 1)
		assert.equal(r.ops[0].o, 'put')
		assert.ok(isValidKey(r.ops[0].p.z), 'valid z: ' + r.ops[0].p.z)
		assert.ok(r.ops[0].p.z.length <= 64)
	})
}

test('U19 createItem(frame) by rect: no throw, valid z, takes over the content inside', () => {
	const m = extremeModel()
	let r
	assert.doesNotThrow(() => { r = createItem(m, { t: 'frame', at: null, rect: { x: 1900, y: -100, w: 900, h: 500 } }, newId) })
	assert.ok(isValidKey(r.ops[0].p.z))
	assert.deepEqual(r.ops.slice(1).map((op) => op.id).sort(), [ID(1), ID(2)].sort())
})

for (const where of ['front', 'back']) {
	test(`U19 reorder ${where} with extreme neighbours: no throw, every z valid`, () => {
		const m = extremeModel()
		m.apply({ upserts: [sticky(ID(4), { x: 3000, y: 0, z: 'a0' }), sticky(ID(5), { x: 3400, y: 0, z: 'a1' })] })
		for (const ids of [[ID(4)], [ID(4), ID(5)], [ID(1), ID(2)], [ID(3)]]) {
			let r
			assert.doesNotThrow(() => { r = reorder(m, ids, where) }, ids.join(','))
			assert.equal(r.ops.length, ids.length)
			for (const op of r.ops) {
				assert.ok(isValidKey(op.p.z), `${where} ${ids.join(',')}: ${op.p.z}`)
			}
		}
	})
}
