/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 212) A sequence flow from the "+" of BPMN shapes, the pure parts:
 * - AK1 plusEndCap: the arrow becomes the triangle at every BPMN event, task
 *   and gateway; another tip stays; data, basic, flowchart, symbol and own
 *   shapes and no kind keep the arrow
 * - AK3 neighbourItem with connect: the connector to the new neighbour and
 *   the one to a near item (a note) leave a BPMN task, event or gateway with
 *   the triangle, line and start tip the defaults; a note, a rect and a data
 *   store keep the arrow; a tip chosen in the tool stays; without connect no
 *   connector
 * - AK4 such a connector has the look of FLOWS.sequence: flowOf of its
 *   selection (as BoardSession.selectionInfo reads it) names 'sequence'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neighbourItem } from '../../../src/board/actions.js'
import { flowOf } from '../../../src/components/contextbar.js'
import { FLOWS, plusEndCap } from '../../../src/model/connectors.js'
import { fieldValue } from '../../../src/model/registry.js'
import { BPMN_GROUPS, FLOWCHART_KINDS } from '../../../src/model/shapes.js'
import { FakeModel, ID, shape, sticky } from './fakes.mjs'

const Q = ID('Q1')
const N = ID('N1')
const C = ID('C1')
const X = ID('X1')
const DEFAULTS = Object.freeze({ route: 'elbow', endCap: 'arrow' })
const FLOW_NODES = [...BPMN_GROUPS.events, ...BPMN_GROUPS.tasks, ...BPMN_GROUPS.gateways]

/** @return {() => string} neighbourItem's id generator: N first, then C */
const ids = () => {
	const left = [N, C]
	return () => left.shift()
}

/**
 * @param {object} put put op of a connector
 * @return {string|null} flowOf of a selection of that connector alone (fields as selectionInfo reads them)
 */
function flowOfPut(put) {
	const it = { id: put.id, t: put.t, ...put.p }
	return flowOf({
		types: ['connector'], mixed: [],
		dash: fieldValue(it, 'style.dash'), startCap: fieldValue(it, 'style.startCap'), endCap: fieldValue(it, 'style.endCap'),
	})
}

test('AK1 plusEndCap: the arrow becomes the triangle at all 24 BPMN events, tasks and gateways', () => {
	assert.equal(FLOW_NODES.length, 24)
	for (const kind of FLOW_NODES) {
		assert.equal(plusEndCap(kind, 'arrow'), 'triangle', kind)
		assert.equal(plusEndCap(kind, 'arrow'), FLOWS.sequence['style.endCap'], kind)
	}
})

test('AK1 plusEndCap: another tip of the tool stays at a BPMN shape', () => {
	for (const kind of ['bpmnTask', 'bpmnStart', 'bpmnExclusive']) {
		for (const cap of ['none', 'dot', 'triangle', 'diamond', 'circleOpen', 'triangleOpen']) {
			assert.equal(plusEndCap(kind, cap), cap, `${kind} ${cap}`)
		}
	}
})

test('AK1 plusEndCap: BPMN data, basic, flowchart, symbol and own shapes and no kind keep the arrow', () => {
	for (const kind of [...BPMN_GROUPS.data, 'rect', 'ellipse', ...FLOWCHART_KINDS, 'iconPerson', 'image', undefined, null, '']) {
		assert.equal(plusEndCap(kind, 'arrow'), 'arrow', String(kind))
	}
})

test('AK3 a click on "+" of a BPMN task, event and gateway: the connector to the new neighbour has the triangle, the neighbour the same kind', () => {
	for (const kind of ['bpmnTask', 'bpmnUserTask', 'bpmnSubprocess', 'bpmnStart', 'bpmnEndTerminate', 'bpmnExclusive', 'bpmnEventGateway']) {
		const m = new FakeModel([shape(Q, { x: 0, y: 0, w: 180, h: 120, data: { kind, text: '' } })])
		const r = neighbourItem(m, { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())
		assert.deepEqual(r.ops.map((op) => [op.o, op.id, op.t]), [['put', N, 'shape'], ['put', C, 'connector']], kind)
		assert.equal(r.ops[0].p.data.kind, kind)
		const c = r.ops[1]
		assert.equal(c.p.data.route, 'elbow', kind)
		assert.deepEqual(c.p.style, { stroke: '#3d4044', strokeWidth: 2, endCap: 'triangle' }, `${kind}: only the end tip differs from the arrow`)
		assert.equal(flowOfPut(c), 'sequence', `${kind}: AK4 "Sequence flow" pressed`)
		assert.deepEqual(r.inverse, [{ o: 'remove', id: C }, { o: 'remove', id: N }])
	}
})

test('AK3 a click on "+" of a BPMN task beside a note: only the connector to the note, with the triangle', () => {
	const m = new FakeModel([shape(Q, { x: 0, y: 0, w: 180, h: 120, data: { kind: 'bpmnTask', text: '' } }), sticky(X, { x: 260, y: 0 })])
	const r = neighbourItem(m, { id: Q, side: 'r', connect: DEFAULTS }, {}, () => C)
	assert.deepEqual(r.ops.map((op) => [op.o, op.id, op.t]), [['put', C, 'connector']])
	assert.deepEqual(r.selectIds, [X])
	assert.equal(r.ops[0].p.data.end.item, X)
	assert.equal(r.ops[0].p.style.endCap, 'triangle')
	assert.equal(flowOfPut(r.ops[0]), 'sequence', 'AK4')
})

test('AK3 a note, a rect and a BPMN data store keep the arrow, the near-item connector of a note too', () => {
	const cases = [
		sticky(Q, { x: 0, y: 0 }),
		shape(Q, { x: 0, y: 0, data: { kind: 'rect', text: '' } }),
		shape(Q, { x: 0, y: 0, w: 120, h: 120, data: { kind: 'bpmnDataStore', text: '' } }),
	]
	for (const q of cases) {
		const r = neighbourItem(new FakeModel([q]), { id: Q, side: 'b', connect: DEFAULTS }, {}, ids())
		assert.equal(r.ops[1].p.style.endCap, 'arrow', `${q.t} ${q.data.kind}`)
		assert.equal(flowOfPut(r.ops[1]), null)
	}
	const near = neighbourItem(new FakeModel([sticky(Q, { x: 0, y: 0 }), sticky(X, { x: 260, y: 0 })]), { id: Q, side: 'r', connect: DEFAULTS }, {}, () => C)
	assert.equal(near.ops[0].p.style.endCap, 'arrow')
})

test('AK3 a tip chosen in the connector tool stays at a BPMN task; without connect (Alt/Option+arrow) no connector', () => {
	const m = new FakeModel([shape(Q, { x: 0, y: 0, w: 180, h: 120, data: { kind: 'bpmnTask', text: '' } })])
	const r = neighbourItem(m, { id: Q, side: 'r', connect: { route: 'curved', endCap: 'dot' } }, {}, ids())
	assert.deepEqual([r.ops[1].p.data.route, r.ops[1].p.style.endCap], ['curved', 'dot'])
	const alt = neighbourItem(m, { id: Q, side: 'r' }, {}, () => N)
	assert.deepEqual(alt.ops.map((op) => [op.id, op.t]), [[N, 'shape']])
})
