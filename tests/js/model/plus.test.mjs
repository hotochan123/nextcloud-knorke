/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * One plan for the click on "+" and its preview (job 162, AK2): plusPlan of
 * src/model/plus.js on the real SceneModel
 * - neighbour: exactly the absolute box of the N that neighbourItem puts
 *   (rounded the same way), also moved on past an item it would cover, for
 *   a rotated source and with Q's frame as parent; with connect the same N
 * - connect: the same ends as the connector C neighbourItem puts
 * - null for a text item, a frame, a connector, an unknown side and a
 *   missing source
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neighbourItem } from '../../../src/board/actions.js'
import { q } from '../../../src/model/geometry.js'
import { plusPlan } from '../../../src/model/plus.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { ID, connector, frame, shape, sticky, textItem } from '../board/fakes.mjs'

const Q = ID('Q1')
const X = ID('X1')
const NEW = ID('N1')
const CN = ID('C2')
const F = ID('F1')
const SIDES = ['t', 'r', 'b', 'l']
const CONNECT = Object.freeze({ route: 'elbow', endCap: 'arrow' })

/** @param {object[]} items WireItems @return {SceneModel} loaded model */
function model(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

/**
 * @param {SceneModel} m model
 * @param {string} side side
 * @return {object} the plan, asserted to be a neighbour whose box is exactly the put of neighbourItem's N
 */
function sameAsN(m, side) {
	const plan = plusPlan(m, { id: Q, side })
	assert.equal(plan?.kind, 'neighbour', side)
	const put = neighbourItem(m, { id: Q, side }, {}, () => NEW).ops[0]
	const pa = put.p.parent === null ? { x: 0, y: 0 } : m.abs(put.p.parent)
	const { box } = plan
	assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h, put.p.r], [q(box.x - pa.x, 100), q(box.y - pa.y, 100), q(box.w, 100), q(box.h, 100), box.r], `${side}: the put is the plan's box`)
	// a click without a target puts the same N, now with its connector
	const ids = [NEW, CN]
	const click = neighbourItem(m, { id: Q, side, connect: CONNECT }, {}, () => ids.shift())
	assert.deepEqual(click.ops.map((op) => op.id), [NEW, CN], side)
	assert.deepEqual(click.ops[0], put, `${side}: the click puts the same N`)
	return plan
}

test('AK2 neighbour: the box of the plan is the absolute box of N from neighbourItem on every side, free and moved on', () => {
	const free = model([sticky(Q, { x: 100, y: 100 })])
	const want = { t: [100, -120], r: [320, 100], b: [100, 320], l: [-120, 100] }
	for (const side of SIDES) {
		const { box } = sameAsN(free, side)
		assert.deepEqual([box.x, box.y, box.w, box.h, box.r], [...want[side], 200, 200, 0], side)
	}
	// an item 205 beyond the side (out of reach) covers the start place: N moves on past it
	const blocked = model([sticky(Q, { x: 0, y: 0 }), shape(ID(1), { x: 405, y: 50, w: 100, h: 100 }), sticky(ID(2), { x: 0, y: 405 })])
	assert.equal(sameAsN(blocked, 'r').box.x, 525)
	assert.equal(sameAsN(blocked, 'b').box.y, 625)
	// an item that is joined with Q already is no target, only an obstacle
	const joined = model([sticky(Q, { x: 0, y: 0 }), sticky(X, { x: 250, y: 0 }), connector(ID('C1'), { item: Q }, { item: X })])
	assert.equal(sameAsN(joined, 'r').box.x, 470)
})

test('AK2 neighbour: a rotated source (r 30) and a source in a frame (N fits: the frame is parent) give the same box as N', () => {
	const rot = model([sticky(Q, { x: 100, y: 100, r: 30 }), shape(ID(1), { x: 2000, y: 2000 })])
	for (const side of SIDES) {
		assert.equal(sameAsN(rot, side).box.r, 30, side)
	}
	const framed = model([frame(F, { x: 1000, y: 1000, w: 1200, h: 800, z: 'a0' }), sticky(Q, { x: 300, y: 300, parent: F })])
	const plan = sameAsN(framed, 'r')
	assert.deepEqual([plan.box.x, plan.box.y], [1520, 1300], 'absolute')
	assert.equal(neighbourItem(framed, { id: Q, side: 'r' }, {}, () => NEW).ops[0].p.parent, F)
})

test('AK2 connect: the plan names X and gives the same ends as the connector C neighbourItem puts (note and triangle)', () => {
	for (const [it, end] of [[sticky(X, { x: 350, y: 100 }), [0, 0.5]], [shape(X, { x: 350, y: 50, data: { kind: 'triangle', text: '' } }), [0.25, 0.5]]]) {
		const m = model([sticky(Q, { x: 0, y: 0 }), it])
		const plan = plusPlan(m, { id: Q, side: 'r' })
		assert.deepEqual(plan, { kind: 'connect', target: X, start: { item: Q, ax: 1, ay: 0.5 }, end: { item: X, ax: end[0], ay: end[1] } }, it.t)
		const c = neighbourItem(m, { id: Q, side: 'r', connect: CONNECT }, {}, () => CN).ops
		assert.equal(c.length, 1)
		assert.deepEqual([c[0].p.data.start, c[0].p.data.end], [plan.start, plan.end], `${it.t}: the same ends`)
	}
})

test('AK2 null: a text item, a frame, a connector, an unknown side and a missing source', () => {
	const m = model([
		textItem(Q, { x: 0, y: 0, data: { text: 'T' } }),
		frame(F, { x: 1000, y: 0 }),
		connector(ID('C1'), { x: 0, y: 500 }, { x: 100, y: 500 }),
		sticky(X, { x: 0, y: 1000 }),
	])
	for (const id of [Q, F, ID('C1'), ID('Z9')]) {
		assert.equal(plusPlan(m, { id, side: 'r' }), null, id)
	}
	for (const side of ['x', 'constructor', '', undefined, 3]) {
		assert.equal(plusPlan(m, { id: X, side }), null, String(side))
	}
	assert.equal(plusPlan(m), null)
	assert.equal(plusPlan(m, { id: X, side: 'r' }).kind, 'neighbour', 'a note works')
})
