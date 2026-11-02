/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 205 (AK1–AK5): board/bpmnFile.js and util/xmlRead.js with the
 * real SceneModel.
 * - AK1 the file of a pool with two lanes (start, user task, exclusive
 *   gateway, end named by a text item below it, a data object joined to the
 *   task, a note without a connector) and an empty pool with the free end of
 *   a connector in it: a collaboration of two participants, the pool and
 *   lane bounds of the head rule, flowNodeRefs, sequence flows with
 *   incoming/outgoing, the message flow to the empty pool, the data input
 *   association, the end's name and label, the shape bounds, the waypoints
 *   of the routes; no note; unique NCName ids
 * - AK2 without a pool one process; a connector styled as a message flow
 *   between two tasks is a sequence flow; a tip only at the start turns the
 *   flow around; a free end outside every pool drops the connector; a name
 *   with <&"> and a line break comes back the same; nothing BPMN: null
 * - AK3 the Camunda-style fixture: kinds, frames, lanes, children, names,
 *   connectors, free ends, skipped
 * - AK4 round trips both ways
 * - AK5 invalid files, entities, deep nesting, huge numbers, markup in names
 *
 * Factory job 208 (AK6): a pool with columns is saved like the same pool
 * without them whose first lane reaches over the head row.
 *
 * Factory job 211 (AK6, AK7): the label of an event or gateway is its name
 * with the label's box as its BPMNLabel; inserting puts the names of events
 * and gateways into their labels (data.text) instead of text items; both
 * round trips keep them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BPMN_FILE_MAX_BYTES, BPMN_LABEL_GAP, bpmnPayload, bpmnXml, cleanText, readBpmnFile } from '../../../src/board/bpmnFile.js'
import { validatePayload } from '../../../src/board/clipboard.js'
import { FLOWS } from '../../../src/model/connectors.js'
import { newLanes, orderedLanes } from '../../../src/model/lanes.js'
import { SceneModel, shapeLabelOf } from '../../../src/model/SceneModel.js'
import { childOf, readXml, walkXml } from '../../../src/util/xmlRead.js'
import { ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const FIXTURE = readFileSync(new URL('../../../dev/e2e/fixtures/order-camunda.bpmn', import.meta.url), 'utf8')
const NCNAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/** @param {object[]} items WireItems @return {SceneModel} */
function modelOf(items) {
	const m = new SceneModel()
	m.load(structuredClone(items))
	return m
}

/** @param {string} kind data.kind @param {string} id id @param {object} extra fields @return {object} a BPMN shape */
const bpmn = (kind, id, extra) => shape(id, { ...extra, data: { kind, text: extra.text ?? '' } })

/** @param {object} root XML tree @return {Map<string, object>} elements by id */
function byId(root) {
	const out = new Map()
	walkXml(root, (n) => {
		if (typeof n.attrs.id === 'string') out.set(n.attrs.id, n)
	})
	return out
}

/** @param {object} root XML tree @param {string} name local name @return {object[]} every element of that name */
function all(root, name) {
	const out = []
	walkXml(root, (n) => {
		if (n.name === name) out.push(n)
	})
	return out
}

/** @param {object} root XML tree @param {string} xid element id @return {object} the dc:Bounds of its BPMNShape as numbers */
function boundsOf(root, xid) {
	const di = all(root, 'BPMNShape').find((s) => s.attrs.bpmnElement === xid)
	assert.ok(di, 'a BPMNShape for ' + xid)
	const b = childOf(di, 'Bounds').attrs
	return { x: Number(b.x), y: Number(b.y), w: Number(b.width), h: Number(b.height) }
}

/** @param {object} root XML tree @param {string} xid element id @return {number[]} the waypoints of its BPMNEdge, flat */
function waypointsOf(root, xid) {
	const di = all(root, 'BPMNEdge').find((s) => s.attrs.bpmnElement === xid)
	assert.ok(di, 'a BPMNEdge for ' + xid)
	return di.children.filter((c) => c.name === 'waypoint').flatMap((w) => [Number(w.attrs.x), Number(w.attrs.y)])
}

// ---- the board of AK1 -------------------------------------------------------------

const P = ID(1)
const Q = ID(2)
const S = ID(3)
const U = ID(4)
const G = ID(5)
const E = ID(6)
const L = ID(7)
const D = ID(8)
const N = ID(9)
const K1 = ID(11)
const K2 = ID(12)
const K3 = ID(13)
const K4 = ID(14)
const K5 = ID(15)
let seed = 0
const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
const LANES_P = newLanes(400, ['Vertrieb', 'Lager'], rand)
const [V, W] = orderedLanes(LANES_P).map((l) => l.key)
const LANES_Q = newLanes(200, [''], rand)
const POOLS = Object.freeze([
	frame(P, { x: 0, y: 0, w: 1200, h: 400, z: 'a0', data: { title: 'Bestellung', lanes: LANES_P } }),
	frame(Q, { x: 0, y: 500, w: 1200, h: 200, z: 'a1', data: { title: 'Kunde', lanes: LANES_Q } }),
	bpmn('bpmnStart', S, { x: 200, y: 80, w: 40, h: 40, z: 'i1', parent: P }),
	bpmn('bpmnUserTask', U, { x: 320, y: 40, w: 180, h: 120, z: 'i2', parent: P, text: 'Prüfen' }),
	bpmn('bpmnExclusive', G, { x: 600, y: 60, w: 80, h: 80, z: 'i3', parent: P }),
	bpmn('bpmnEnd', E, { x: 800, y: 260, w: 64, h: 64, z: 'i4', parent: P }),
	textItem(L, { x: 782, y: 344, w: 100, h: 20, z: 'i5', parent: P, data: { text: 'Fertig' } }),
	bpmn('bpmnDataObject', D, { x: 350, y: 250, w: 80, h: 100, z: 'i6', parent: P, text: 'Auftrag' }),
	sticky(N, { x: 1000, y: 220, z: 'i7', parent: P, data: { text: 'Workshop-Notiz' } }),
	connector(K1, { item: S }, { item: U }, { z: 'i8', style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'triangle' } }),
	connector(K2, { item: U }, { item: G }, { z: 'i9' }),
	connector(K3, { item: G }, { item: E }, { z: 'ia', data: { start: { item: G }, end: { item: E }, route: 'elbow', label: 'ja' } }),
	connector(K4, { item: D }, { item: U }, { z: 'ib', style: { stroke: '#1a1a1a', strokeWidth: 2, dash: 'dotted', endCap: 'arrow' } }),
	connector(K5, { item: E }, { x: 832, y: 600 }, { z: 'ic' }),
])

/** @return {{m: SceneModel, xml: string, root: object, ids: Map<string, object>}} the AK1 board saved */
function savedPools() {
	const m = modelOf(POOLS)
	const xml = bpmnXml(m, [...m.ids()])
	const root = readXml(xml)
	return { m, xml, root, ids: byId(root) }
}

test('AK1 a collaboration of the two pools: participants with their names and processes, the pool and lane bounds of the head rule, the lanes with their flow nodes', () => {
	const { root, ids } = savedPools()
	assert.equal(root.name, 'definitions')
	const collab = childOf(root, 'collaboration')
	assert.ok(collab)
	const parts = collab.children.filter((c) => c.name === 'participant')
	assert.deepEqual(parts.map((p) => [p.attrs.name, p.attrs.processRef]), [['Bestellung', 'Process_' + P], ['Kunde', 'Process_' + Q]])
	for (const p of parts) assert.equal(ids.get(p.attrs.processRef).name, 'process')
	assert.deepEqual(boundsOf(root, 'Participant_' + P), { x: 18, y: 0, w: 1182, h: 400 }, 'x = frame.x + 48 − 30, w = w − 48 + 30')
	assert.deepEqual(boundsOf(root, `Lane_${P}_${V}`), { x: 48, y: 0, w: 1152, h: 200 })
	assert.deepEqual(boundsOf(root, `Lane_${P}_${W}`), { x: 48, y: 200, w: 1152, h: 200 })
	assert.deepEqual(boundsOf(root, 'Participant_' + Q), { x: 18, y: 500, w: 1182, h: 200 })
	const lanes = all(ids.get('Process_' + P), 'lane')
	assert.deepEqual(lanes.map((l) => [l.attrs.name, l.children.map((c) => c.text)]), [
		['Vertrieb', ['Event_' + S, 'Activity_' + U, 'Gateway_' + G]],
		['Lager', ['Event_' + E]],
	], 'data objects are no flow nodes')
	assert.equal(ids.get('Process_' + P).attrs.isExecutable, 'false')
	assert.equal(childOf(childOf(root, 'BPMNDiagram'), 'BPMNPlane').attrs.bpmnElement, 'Collaboration_1')
})

test('AK1 the elements, flows and associations: sequence flows with incoming/outgoing, the message flow to the empty pool, the data input association, the end named by its text item; the note is left out', () => {
	const { m, xml, root, ids } = savedPools()
	assert.equal(ids.get('Event_' + S).name, 'startEvent')
	assert.equal(ids.get('Activity_' + U).name, 'userTask')
	assert.equal(ids.get('Activity_' + U).attrs.name, 'Prüfen')
	assert.equal(ids.get('Gateway_' + G).name, 'exclusiveGateway')
	assert.equal(ids.get('Event_' + E).name, 'endEvent')
	assert.equal(ids.get('DataObjectReference_' + D).attrs.dataObjectRef, 'DataObject_' + D)
	assert.equal(ids.get('DataObject_' + D).name, 'dataObject')
	const seq = all(root, 'sequenceFlow')
	assert.deepEqual(seq.map((f) => [f.attrs.id, f.attrs.sourceRef, f.attrs.targetRef, f.attrs.name ?? '']), [
		['Flow_' + K1, 'Event_' + S, 'Activity_' + U, ''],
		['Flow_' + K2, 'Activity_' + U, 'Gateway_' + G, ''],
		['Flow_' + K3, 'Gateway_' + G, 'Event_' + E, 'ja'],
	])
	const refs = (xid, name) => ids.get(xid).children.filter((c) => c.name === name).map((c) => c.text)
	assert.deepEqual(refs('Event_' + S, 'outgoing'), ['Flow_' + K1])
	assert.deepEqual(refs('Activity_' + U, 'incoming'), ['Flow_' + K1])
	assert.deepEqual(refs('Activity_' + U, 'outgoing'), ['Flow_' + K2])
	assert.deepEqual(refs('Event_' + E, 'incoming'), ['Flow_' + K3])
	const msg = all(root, 'messageFlow')
	assert.deepEqual(msg.map((f) => [f.attrs.sourceRef, f.attrs.targetRef]), [['Event_' + E, 'Participant_' + Q]], 'the free end in the empty pool')
	const assoc = childOf(ids.get('Activity_' + U), 'dataInputAssociation')
	assert.equal(childOf(assoc, 'sourceRef').text, 'DataObjectReference_' + D)
	assert.equal(childOf(assoc, 'targetRef').text, 'Property_' + K4)
	assert.equal(ids.get('Property_' + K4).name, 'property')
	// the name of the end from the text item 20 below it, with its box as the label
	assert.equal(ids.get('Event_' + E).attrs.name, 'Fertig')
	const di = all(root, 'BPMNShape').find((s) => s.attrs.bpmnElement === 'Event_' + E)
	const lb = childOf(childOf(di, 'BPMNLabel'), 'Bounds').attrs
	assert.deepEqual([lb.x, lb.y, lb.width, lb.height].map(Number), [782, 344, 100, 20])
	assert.ok(!xml.includes(L) || !ids.has('TextAnnotation_' + L), 'the label is no annotation')
	assert.ok(!xml.includes(N), 'the note without a connector is left out')
	assert.ok(!xml.includes('Workshop-Notiz'))
	// shapes at their absolute boxes, edges along their routes
	for (const [xid, id] of [['Event_' + S, S], ['Activity_' + U, U], ['Gateway_' + G, G], ['Event_' + E, E], ['DataObjectReference_' + D, D]]) {
		const a = m.abs(id)
		assert.deepEqual(boundsOf(root, xid), { x: a.x, y: a.y, w: a.w, h: a.h }, xid)
	}
	for (const [xid, id] of [['Flow_' + K1, K1], ['Flow_' + K2, K2], ['Flow_' + K3, K3], ['DataInputAssociation_' + K4, K4], ['Flow_' + K5, K5]]) {
		assert.deepEqual(waypointsOf(root, xid), m.geometryOf(id).points.map((v) => Math.round(v * 100) / 100), xid)
	}
	assert.ok(waypointsOf(root, 'Flow_' + K3).length > 4, 'the elbow route with its bends')
	// ids: unique NCNames
	const seen = new Set()
	walkXml(root, (n) => {
		if (typeof n.attrs.id !== 'string') return
		assert.match(n.attrs.id, NCNAME)
		assert.ok(!seen.has(n.attrs.id), 'unique ' + n.attrs.id)
		seen.add(n.attrs.id)
	})
})

test('AK1 a name of its own wins over a text item; a text item names only one event, the nearest within BPMN_LABEL_GAP', () => {
	const A = ID(40)
	const B = ID(41)
	const T1 = ID(42)
	const T2 = ID(43)
	const items = [
		bpmn('bpmnStart', A, { x: 0, y: 0, w: 40, h: 40, z: 'i1' }),
		bpmn('bpmnEnd', B, { x: 300, y: 0, w: 40, h: 40, z: 'i2', text: 'Eigener Name' }),
		textItem(T1, { x: 0, y: 40 + BPMN_LABEL_GAP, w: 80, h: 20, z: 'i3', data: { text: 'genau 40' } }),
		textItem(T2, { x: 0, y: 40 + BPMN_LABEL_GAP + 1, w: 80, h: 20, z: 'i4', data: { text: 'zu weit' } }),
		textItem(ID(44), { x: 300, y: 45, w: 80, h: 20, z: 'i5', data: { text: 'bei B' } }),
	]
	const ids = byId(readXml(bpmnXml(modelOf(items), items.map((it) => it.id))))
	assert.equal(ids.get('Event_' + A).attrs.name, 'genau 40')
	assert.equal(ids.get('Event_' + B).attrs.name, 'Eigener Name')
	const far = [textItem(T2, { x: 0, y: 40 + BPMN_LABEL_GAP + 1, w: 80, h: 20, z: 'i4', data: { text: 'zu weit' } }), items[0]]
	assert.equal(byId(readXml(bpmnXml(modelOf(far), [A, T2]))).get('Event_' + A).attrs.name, undefined)
})

// ---- AK2 ---------------------------------------------------------------------------

test('AK2 without a pool: one process the plane shows; a message-styled connector between two tasks is a sequence flow; a tip only at the start turns it around; a free end outside every pool drops it; a note joined to a task is an annotation', () => {
	const A = ID(50)
	const B = ID(51)
	const C1 = ID(52)
	const C2 = ID(53)
	const C3 = ID(54)
	const C4 = ID(55)
	const NOTE = ID(56)
	const name = 'Prüfen <&"> \'x\'\nzweite Zeile\tTab'
	const items = [
		bpmn('bpmnTask', A, { x: 0, y: 0, w: 180, h: 120, z: 'i1', text: name }),
		bpmn('bpmnTask', B, { x: 400, y: 0, w: 180, h: 120, z: 'i2' }),
		sticky(NOTE, { x: 0, y: 300, z: 'i3', data: { text: 'Hinweis' } }),
		connector(C1, { item: A }, { item: B }, { z: 'i4', style: { stroke: '#1a1a1a', strokeWidth: 2, ...Object.fromEntries(Object.entries(FLOWS.message).map(([k, v]) => [k.slice(6), v])) } }),
		connector(C2, { item: B }, { item: A }, { z: 'i5', style: { stroke: '#1a1a1a', strokeWidth: 2, startCap: 'arrow', endCap: 'none' } }),
		connector(C3, { item: B }, { x: 900, y: 900 }, { z: 'i6' }),
		connector(C4, { item: NOTE }, { item: A }, { z: 'i7', style: { stroke: '#1a1a1a', strokeWidth: 2, dash: 'dotted', endCap: 'none' } }),
	]
	const m = modelOf(items)
	const xml = bpmnXml(m, items.map((it) => it.id))
	const root = readXml(xml)
	const ids = byId(root)
	assert.equal(childOf(root, 'collaboration'), null)
	assert.equal(all(root, 'process').length, 1)
	assert.equal(childOf(childOf(root, 'BPMNDiagram'), 'BPMNPlane').attrs.bpmnElement, 'Process_1')
	assert.deepEqual(all(root, 'sequenceFlow').map((f) => [f.attrs.id, f.attrs.sourceRef, f.attrs.targetRef]), [
		['Flow_' + C1, 'Activity_' + A, 'Activity_' + B],
		['Flow_' + C2, 'Activity_' + A, 'Activity_' + B],
	])
	const drawn = m.geometryOf(C2).points
	const back = []
	for (let i = drawn.length - 2; i >= 0; i -= 2) back.push(drawn[i], drawn[i + 1])
	assert.deepEqual(waypointsOf(root, 'Flow_' + C2), back, 'the waypoints turned around too')
	assert.equal(all(root, 'messageFlow').length, 0)
	assert.ok(!xml.includes(C3), 'the free end outside every pool')
	assert.equal(ids.get('TextAnnotation_' + NOTE).name, 'textAnnotation')
	assert.equal(childOf(ids.get('TextAnnotation_' + NOTE), 'text').text, 'Hinweis')
	assert.deepEqual([ids.get('Association_' + C4).attrs.sourceRef, ids.get('Association_' + C4).attrs.targetRef, ids.get('Association_' + C4).attrs.associationDirection], ['TextAnnotation_' + NOTE, 'Activity_' + A, 'None'])
	// the name escaped and read back the same (attribute normalisation keeps &#10; and &#9;)
	assert.ok(xml.includes('name="Prüfen &lt;&amp;&quot;&gt; \'x\'&#10;zweite Zeile&#9;Tab"'))
	assert.equal(ids.get('Activity_' + A).attrs.name, name)
	assert.equal(bpmnPayload(xml).raw.items.find((it) => it.t === 'shape' && it.data.text !== '').data.text, name)
})

test('AK2 nothing BPMN among the items: null; a frame with lanes that holds only notes is no pool', () => {
	const F = ID(60)
	const items = [
		frame(F, { x: 0, y: 0, w: 1200, h: 600, data: { title: 'Journey', lanes: newLanes(600, ['A', 'B', 'C'], rand) } }),
		sticky(ID(61), { x: 300, y: 50, z: 'i1', parent: F }),
		shape(ID(62), { x: 2000, y: 0, z: 'i2', data: { kind: 'rect', text: 'Rechteck' } }),
	]
	assert.equal(bpmnXml(modelOf(items), items.map((it) => it.id)), null)
	const withTask = [...items, bpmn('bpmnTask', ID(63), { x: 2000, y: 400, w: 180, h: 120, z: 'i3' })]
	const root = readXml(bpmnXml(modelOf(withTask), withTask.map((it) => it.id)))
	assert.equal(all(root, 'participant').length, 0, 'the journey frame is no pool')
	assert.equal(all(root, 'task').length, 1)
})

test('AK2 text: cleanText drops what XML 1.0 forbids, keeps \\t and \\n, replaces lone surrogates, cuts by code points', () => {
	assert.equal(cleanText('a\u0000b\u0008c\u000bd\u001fe\tf\r\ng￿', 100), 'abcde\tf\ng')
	assert.equal(cleanText('x\ud800y\udc00z', 100), 'x�y�z')
	assert.equal(cleanText('😀😀😀', 2), '😀😀')
	assert.equal(cleanText(42, 10), '')
	const items = [bpmn('bpmnTask', ID(70), { x: 0, y: 0, w: 100, h: 80, z: 'i1', text: ']]></bpmn:definitions>\u0001\ud800' })]
	const xml = bpmnXml(modelOf(items), [ID(70)])
	assert.ok(readXml(xml), 'still well-formed')
	assert.equal(byId(readXml(xml)).get('Activity_' + ID(70)).attrs.name, ']]></bpmn:definitions>�')
})

// ---- AK3: the Camunda fixture -------------------------------------------------------

test('AK3 the fixture: two frames with lanes (x − 18, w + 18), 8 shapes, 1 text item, 10 connectors; complexGateway and group skipped', () => {
	const r = bpmnPayload(FIXTURE)
	assert.equal(r.skipped, 2)
	const items = r.raw.items
	const of = (t) => items.filter((it) => it.t === t)
	assert.equal(of('frame').length, 2)
	assert.equal(of('shape').length, 8)
	assert.equal(of('text').length, 1)
	assert.equal(of('connector').length, 10)
	const [order, customer] = of('frame')
	assert.deepEqual([order.x, order.y, order.w, order.h, order.data.title], [142, 80, 918, 400, 'Bestellung'])
	assert.deepEqual(orderedLanes(order.data.lanes).map((l) => [l.t, l.h]), [['Vertrieb', 200], ['Lager', 200]])
	assert.deepEqual([customer.x, customer.y, customer.w, customer.h, customer.data.title], [142, 520, 918, 60, 'Kunde'])
	assert.deepEqual(orderedLanes(customer.data.lanes).map((l) => [l.t, l.h]), [['', 60]], 'a pool without lanes: one lane without a name')
	const kinds = of('shape').map((it) => [it.data.kind, it.data.text, it.x, it.y, it.w, it.h, it.parent === order.id])
	assert.deepEqual(kinds, [
		['bpmnStart', 'Bestellung\neingegangen', 90, 82, 36, 36, true],
		['bpmnUserTask', 'Bestellung prüfen', 178, 60, 100, 80, true],
		['bpmnExclusive', 'OK?', 333, 75, 50, 50, true],
		['bpmnServiceTask', 'Ware reservieren', 438, 240, 100, 80, true],
		['bpmnEnd', 'Fertig', 700, 262, 36, 36, true],
		['bpmnEndMessage', 'Absage', 700, 82, 36, 36, true],
		['bpmnDataStore', 'Lager-DB', 583, 330, 50, 50, true],
		['bpmnIntermediateTimer', '2 Tage', 470, 302, 36, 36, true],
	], 'signal start → plain start, boundary timer → timer intermediate event; (job 211 AK7) names of events and gateways are their labels')
	const texts = of('text').map((it) => [it.data.text, it.style.fontSize, it.style.align, it.parent === order.id])
	assert.deepEqual(texts, [['Kundendaten <vollständig> prüfen', 12, 'left', true]], 'only the text annotation is a text item')
})

test('AK3 the fixture: connectors with the look of their flow, bound to the nearest anchor, a free end where the element did not come in', () => {
	const items = bpmnPayload(FIXTURE).raw.items
	const shapes = items.filter((it) => it.t === 'shape')
	const idOf = (kind) => shapes.find((it) => it.data.kind === kind).id
	const conns = items.filter((it) => it.t === 'connector')
	const look = (c) => ({ 'style.dash': c.style.dash, 'style.startCap': c.style.startCap, 'style.endCap': c.style.endCap })
	assert.deepEqual(conns.slice(0, 7).map(look), Array(7).fill(FLOWS.sequence))
	assert.deepEqual(conns[0].data, { start: { item: idOf('bpmnStart'), ax: 1, ay: 0.5 }, end: { item: idOf('bpmnUserTask'), ax: 0, ay: 0.5 }, route: 'elbow' })
	assert.deepEqual(conns[2].data, { start: { item: idOf('bpmnExclusive'), ax: 0.5, ay: 1 }, end: { item: idOf('bpmnServiceTask'), ax: 0, ay: 0.5 }, route: 'elbow', label: 'ja' })
	assert.deepEqual(conns[4].data.end, { x: 735, y: 360 }, 'to the skipped complex gateway: a free end at the waypoint')
	assert.deepEqual(conns[5].data.start, { x: 785, y: 360 })
	assert.deepEqual(look(conns[7]), { 'style.dash': 'dotted', 'style.startCap': 'none', 'style.endCap': 'none' }, 'association None')
	assert.equal(conns[7].data.start.item, items.find((it) => it.t === 'text' && it.style.fontSize === 12).id)
	assert.deepEqual(look(conns[8]), { 'style.dash': 'dotted', 'style.startCap': 'none', 'style.endCap': 'arrow' }, 'data output association')
	assert.deepEqual([conns[8].data.start.item, conns[8].data.end.item, conns[8].data.route], [idOf('bpmnServiceTask'), idOf('bpmnDataStore'), 'straight'])
	assert.deepEqual(look(conns[9]), FLOWS.message)
	assert.deepEqual(conns[9].data, { start: { item: idOf('bpmnEndMessage'), ax: 1, ay: 0.5 }, end: { x: 960, y: 520 }, route: 'elbow', label: 'Absage & Grund' })
})

test('AK3 readBpmnFile: a payload validatePayload takes whole; skipped 2; full counts every item; the order of the checks', () => {
	const r = readBpmnFile(FIXTURE)
	assert.equal(r.ok, true)
	assert.equal(r.skipped, 2)
	assert.equal(r.payload.items.length, 21)
	assert.equal(r.payload.board, null)
	const v = validatePayload(bpmnPayload(FIXTURE).raw, { maxItems: Infinity, maxBytes: BPMN_FILE_MAX_BYTES })
	assert.equal(v.skipped, 0, 'every item passes the check')
	assert.deepEqual(readBpmnFile(FIXTURE, { size: 980, limits: { maxItems: 1000 } }), { ok: false, reason: 'full', max: 1000 })
	assert.equal(readBpmnFile(FIXTURE, { size: 979, limits: { maxItems: 1000 } }).ok, true)
})

// ---- AK4: round trips -------------------------------------------------------------

test('AK4 save, then insert: the same kinds, boxes, lanes, names and flows', () => {
	const { xml } = savedPools()
	const r = bpmnPayload(xml)
	assert.equal(r.skipped, 0)
	const m = modelOf(r.raw.items.map((it, i) => ({ ...it, z: 'k' + String(i).padStart(3, '0') })))
	const items = [...m.ids()].map((id) => m.get(id))
	const frames = items.filter((it) => it.t === 'frame')
	assert.deepEqual(frames.map((f) => [m.abs(f.id), f.data.title, orderedLanes(f.data.lanes).map((l) => [l.t, l.h])]), [
		[{ x: 0, y: 0, w: 1200, h: 400, r: 0 }, 'Bestellung', [['Vertrieb', 200], ['Lager', 200]]],
		[{ x: 0, y: 500, w: 1200, h: 200, r: 0 }, 'Kunde', [['', 200]]],
	])
	const shapes = items.filter((it) => it.t === 'shape').map((it) => [it.data.kind, it.data.text, m.abs(it.id)])
	const before = modelOf(POOLS)
	// (job 211 AK7) the end, named by the text item below it, comes back with that name as its label
	const want = POOLS.filter((it) => it.t === 'shape').map((it) => [it.data.kind, it.id === E ? 'Fertig' : it.data.text, before.abs(it.id)])
	assert.equal(want.length, 5)
	assert.deepEqual(shapes, want)
	assert.equal(items.filter((it) => it.t === 'text').length, 0, 'no text item for the name')
	const conns = items.filter((it) => it.t === 'connector')
	assert.deepEqual(conns.map((c) => [c.style.dash, c.style.startCap, c.style.endCap, c.data.label ?? '']), [
		['solid', 'none', 'triangle', ''],
		['solid', 'none', 'triangle', ''],
		['solid', 'none', 'triangle', 'ja'],
		['dotted', 'none', 'arrow', ''],
		['dashed', 'circleOpen', 'triangleOpen', ''],
	])
	assert.equal(conns[4].data.end.x, 832, 'the message flow ends free at the pool "Kunde"')
})

test('AK4 insert the fixture, then save: the same flow nodes by type and name (a boundary event is an intermediate catch event, the complex gateway is gone), 5 of 7 sequence flows (two ran to the complex gateway), the message flow', () => {
	const r = bpmnPayload(FIXTURE)
	const m = modelOf(r.raw.items.map((it, i) => ({ ...it, z: 'k' + String(i).padStart(3, '0') })))
	const root = readXml(bpmnXml(m, [...m.ids()]))
	const nodes = []
	walkXml(root, (n, parent) => {
		if (parent?.name === 'process' && /Event$|Task$|Gateway$/.test(n.name)) nodes.push([n.name, n.attrs.name ?? ''])
	})
	assert.deepEqual(nodes, [
		['startEvent', 'Bestellung\neingegangen'],
		['userTask', 'Bestellung prüfen'],
		['exclusiveGateway', 'OK?'],
		['serviceTask', 'Ware reservieren'],
		['endEvent', 'Fertig'],
		['endEvent', 'Absage'],
		['intermediateCatchEvent', '2 Tage'],
	])
	assert.equal(all(root, 'sequenceFlow').length, 5)
	assert.equal(all(root, 'messageFlow').length, 1)
	assert.equal(all(root, 'messageFlow')[0].attrs.targetRef.startsWith('Participant_'), true, 'to the pool "Kunde"')
	assert.equal(all(root, 'dataOutputAssociation').length, 1)
	assert.equal(all(root, 'textAnnotation').length, 1)
	assert.deepEqual(all(root, 'lane').map((l) => l.attrs.name ?? ''), ['Vertrieb', 'Lager', ''])
})

// ---- AK5: robustness ---------------------------------------------------------------

/** @param {string} body the inside of definitions @return {string} a .bpmn file */
const fileWith = (body) => `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">${body}</bpmn:definitions>`
/** @param {string} el the element @param {string} shapes the plane's shapes @return {string} a file with one process and one diagram */
const oneProcess = (el, shapes) => fileWith(`<bpmn:process id="P">${el}</bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">${shapes}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`)
const taskAt = (x, y, w, h) => `<bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`

test('AK5 invalid: no XML, another root, no diagram, nothing drawable, over 16 MiB, not a string', () => {
	const cases = {
		'no XML': 'Hallo Welt',
		'broken tags': '<bpmn:definitions><bpmn:process></bpmn:definitions>',
		'another root': '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
		'a board file': '{"knorke":1,"kind":"board"}',
		'no diagram': fileWith('<bpmn:process id="P"><bpmn:task id="T" /></bpmn:process>'),
		'only a group': oneProcess('<bpmn:group id="T" />', taskAt(0, 0, 100, 80)),
		'bounds without numbers': oneProcess('<bpmn:task id="T" />', taskAt('a', 0, 100, 80)),
		'over 16 MiB': oneProcess(`<bpmn:task id="T" name="${'x'.repeat(BPMN_FILE_MAX_BYTES)}" />`, taskAt(0, 0, 100, 80)),
	}
	for (const [label, text] of Object.entries(cases)) {
		assert.deepEqual(readBpmnFile(text), { ok: false, reason: 'invalid' }, label)
	}
	for (const v of [null, undefined, 42, {}]) assert.deepEqual(readBpmnFile(v), { ok: false, reason: 'invalid' })
	assert.equal(readBpmnFile(oneProcess('<bpmn:task id="T" name="ok" />', taskAt(0, 0, 100, 80))).ok, true)
})

test('AK5 entities: a DOCTYPE with its own (nested) entities and an external one is skipped, 10⁵ references stay literal, in well under 200 ms', () => {
	const doctype = '<!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY ext SYSTEM "file:///etc/passwd"> <!-- ] > --> ]>'
	const refs = '&b;'.repeat(100000)
	const text = '<?xml version="1.0"?>' + doctype + oneProcess(`<bpmn:task id="T" name="&ext;${refs}" />`, taskAt(0, 0, 100, 80)).replace(/^<\?xml version="1.0"\?>/, '')
	const t0 = performance.now()
	const r = readBpmnFile(text)
	const ms = performance.now() - t0
	assert.equal(r.ok, true)
	const task = r.payload.items.find((it) => it.t === 'shape')
	assert.ok(task.data.text.startsWith('&ext;&b;&b;'), 'nothing resolved, nothing fetched')
	assert.equal([...task.data.text].length, 6000, 'cut to the text limit')
	assert.ok(ms < 200, `${ms.toFixed(1)} ms`)
})

test('AK5 10⁵ nested elements do not throw (the reader keeps its own stack); readXml basics', () => {
	const deep = '<a>'.repeat(100000) + '</a>'.repeat(100000)
	assert.equal(readXml(deep).name, 'a')
	assert.deepEqual(readBpmnFile(fileWith(deep)), { ok: false, reason: 'invalid' })
	let n = 0
	walkXml(readXml(deep), () => n++)
	assert.equal(n, 100000)
	const x = readXml('﻿<?xml version="1.0"?><!-- c --><r:root xmlns:r="u" a=\'1 &amp; 2\' b="x\ny" c="p&#10;q"><r:k>t<![CDATA[<raw> & ]]>&lt;&#x41;&unknown;</r:k><e/></r:root>')
	assert.equal(x.name, 'root')
	assert.deepEqual({ ...x.attrs }, { a: '1 & 2', b: 'x y', c: 'p\nq' }, 'xmlns left out, a literal line break is a space, &#10; a line break')
	assert.equal(x.children[0].text, 't<raw> & <A&unknown;')
	assert.equal(x.children[1].name, 'e')
	for (const bad of ['<a><b></a></b>', '<a>', '<a/><b/>', 'text<a/>', '<a x="1></a>', '<!-- open', '']) {
		assert.equal(readXml(bad), null, JSON.stringify(bad))
	}
})

test('AK5 numbers: coordinates over 10⁷ and sizes over 20000 are clamped, a pool of 100 px and a lane of 20 px give valid lanes; the payload passes whole; markup in a name is plain text', () => {
	const big = oneProcess('<bpmn:task id="T" name="&lt;script&gt;alert(1)&lt;/script&gt;" />', taskAt(5e7, -5e7, 90000, 2))
	const r = bpmnPayload(big)
	const task = r.raw.items[0]
	assert.deepEqual([task.x, task.y, task.w, task.h], [1e7, -1e7, 20000, 10])
	assert.equal(task.data.text, '<script>alert(1)</script>')
	assert.equal(validatePayload(r.raw, { maxItems: Infinity, maxBytes: BPMN_FILE_MAX_BYTES }).skipped, 0)
	const pool = fileWith(`<bpmn:collaboration id="C"><bpmn:participant id="PA" processRef="P" /></bpmn:collaboration>
		<bpmn:process id="P"><bpmn:laneSet><bpmn:lane id="L1" name="eins"><bpmn:childLaneSet><bpmn:lane id="L1a" name="innen" /></bpmn:childLaneSet></bpmn:lane><bpmn:lane id="L2" name="zwei" /></bpmn:laneSet><bpmn:task id="T" /></bpmn:process>
		<bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="C">
		<bpmndi:BPMNShape bpmnElement="PA" isHorizontal="true"><dc:Bounds x="0" y="0" width="100" height="100" /></bpmndi:BPMNShape>
		<bpmndi:BPMNShape bpmnElement="L1" isHorizontal="true"><dc:Bounds x="30" y="0" width="70" height="80" /></bpmndi:BPMNShape>
		<bpmndi:BPMNShape bpmnElement="L1a" isHorizontal="true"><dc:Bounds x="60" y="0" width="40" height="80" /></bpmndi:BPMNShape>
		<bpmndi:BPMNShape bpmnElement="L2" isHorizontal="true"><dc:Bounds x="30" y="80" width="70" height="20" /></bpmndi:BPMNShape>
		${taskAt(40, 10, 50, 50)}
		</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`)
	const p = bpmnPayload(pool)
	const f = p.raw.items[0]
	assert.equal(f.t, 'frame')
	assert.deepEqual(orderedLanes(f.data.lanes).map((l) => [l.t, l.h]), [['innen', 80], ['zwei', 60]], 'the innermost lanes, each at least 60')
	assert.equal(f.h, 140, 'the frame grows')
	assert.ok(f.w >= 220)
	const v = validatePayload(p.raw, { maxItems: Infinity, maxBytes: BPMN_FILE_MAX_BYTES })
	assert.equal(v.skipped, 0)
	assert.equal(v.payload.items.find((it) => it.t === 'shape').parent, f.id, 'the task inside it')
})

test('AK5 more than 30 lanes: 30, the last reaches to the bottom; a vertical pool: one lane', () => {
	const lanes = Array.from({ length: 35 }, (_, i) => `<bpmn:lane id="L${i}" name="Bahn ${i}" />`).join('')
	const di = Array.from({ length: 35 }, (_, i) => `<bpmndi:BPMNShape bpmnElement="L${i}"><dc:Bounds x="30" y="${i * 100}" width="970" height="100" /></bpmndi:BPMNShape>`).join('')
	const text = (horizontal) => fileWith(`<bpmn:collaboration id="C"><bpmn:participant id="PA" name="Viele" processRef="P" /></bpmn:collaboration>
		<bpmn:process id="P"><bpmn:laneSet>${lanes}</bpmn:laneSet></bpmn:process>
		<bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="C"><bpmndi:BPMNShape bpmnElement="PA" isHorizontal="${horizontal}"><dc:Bounds x="0" y="0" width="1000" height="3500" /></bpmndi:BPMNShape>${di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`)
	const f = bpmnPayload(text(true)).raw.items[0]
	const list = orderedLanes(f.data.lanes)
	assert.equal(list.length, 30)
	assert.deepEqual([list[0].t, list[0].h, list[29].t, list[29].h], ['Bahn 0', 100, 'Bahn 29', 600])
	assert.equal(f.h, 3500)
	const v = bpmnPayload(text(false)).raw.items[0]
	assert.deepEqual(orderedLanes(v.data.lanes).map((l) => [l.t, l.h]), [['', 3500]])
	assert.equal(v.data.title, 'Viele')
})

test('job 208 AK6: a pool with columns is saved like one without: the first lane reaches over the head row, no column in the file', () => {
	const cols = { c00000001: { o: 'i0', w: 300, t: 'Phase 1' }, c00000002: { o: 'i1', w: 400 }, c00000003: { o: 'i2', w: 340 } }
	const shift = (it) => (it.parent === P ? { ...it, y: it.y + 60 } : it)
	const grid = POOLS.map((it) => (it.id === P ? { ...it, h: 460, data: { ...it.data, cols } } : shift(it)))
	const lanes = structuredClone(LANES_P)
	lanes[V].h = 260
	const plain = POOLS.map((it) => (it.id === P ? { ...it, h: 460, data: { ...it.data, lanes } } : shift(it)))
	const a = modelOf(grid)
	const b = modelOf(plain)
	const xml = bpmnXml(a, [...a.ids()])
	assert.equal(xml, bpmnXml(b, [...b.ids()]))
	const root = readXml(xml)
	assert.deepEqual(boundsOf(root, `Lane_${P}_${V}`), { x: 48, y: 0, w: 1152, h: 260 })
	assert.deepEqual(boundsOf(root, `Lane_${P}_${W}`), { x: 48, y: 260, w: 1152, h: 200 })
	assert.doesNotMatch(xml, /Phase 1|c0000000/)
})

// ---- job 211: labels -------------------------------------------------------------

test('job 211 AK6: a start event and a gateway with a label: the label is the name, its box (absolute) the BPMNLabel; an event without one still takes the text item beside it', () => {
	const A = ID(60)
	const B = ID(61)
	const C = ID(62)
	const T = ID(63)
	const items = [
		frame(P, { x: 100, y: 50, w: 1000, h: 400, z: 'a0', data: { title: 'Pool', lanes: newLanes(400, ['Eins'], rand) } }),
		bpmn('bpmnStart', A, { x: 200, y: 100, w: 36, h: 36, z: 'i1', parent: P, text: 'Order received' }),
		bpmn('bpmnExclusive', B, { x: 400, y: 100, w: 50, h: 50, z: 'i2', parent: P, text: 'OK?' }),
		bpmn('bpmnEnd', C, { x: 600, y: 100, w: 36, h: 36, z: 'i3', parent: P }),
		textItem(T, { x: 580, y: 150, w: 80, h: 20, z: 'i4', parent: P, data: { text: 'Done' } }),
	]
	const m = modelOf(items)
	const root = readXml(bpmnXml(m, [...m.ids()]))
	const ids = byId(root)
	assert.equal(ids.get('Event_' + A).attrs.name, 'Order received')
	assert.equal(ids.get('Gateway_' + B).attrs.name, 'OK?')
	const labelOf = (xid) => {
		const di = all(root, 'BPMNShape').find((s) => s.attrs.bpmnElement === xid)
		const b = childOf(childOf(di, 'BPMNLabel'), 'Bounds').attrs
		return [b.x, b.y, b.width, b.height].map(Number)
	}
	const box = (id) => {
		const a = m.abs(id)
		const l = shapeLabelOf(m.get(id), a)
		return [a.x + l.x, a.y + l.y, l.w, l.h].map((v) => Math.round(v * 100) / 100)
	}
	assert.deepEqual(labelOf('Event_' + A), box(A))
	assert.deepEqual(labelOf('Gateway_' + B), box(B))
	assert.equal(labelOf('Event_' + A)[1], 50 + 100 + 36 + 6, 'below the event')
	assert.equal(ids.get('Event_' + C).attrs.name, 'Done', 'without a label: the text item beside it, as before')
	assert.deepEqual(labelOf('Event_' + C), [680, 200, 80, 20])
})

test('job 211 AK7: insert the fixture, save, insert again: the names stay labels of the same events and gateways, still no text item for them', () => {
	const first = bpmnPayload(FIXTURE).raw.items
	const m = modelOf(first.map((it, i) => ({ ...it, z: 'k' + String(i).padStart(3, '0') })))
	const again = bpmnPayload(bpmnXml(m, [...m.ids()])).raw.items
	const named = (items) => items.filter((it) => it.t === 'shape').map((it) => [it.data.kind, it.data.text])
	assert.deepEqual(named(again), named(first))
	assert.ok(named(again).some(([k, t]) => k === 'bpmnExclusive' && t === 'OK?'))
	assert.deepEqual(again.filter((it) => it.t === 'text').map((it) => it.data.text), ['Kundendaten <vollständig> prüfen'])
})

// ---- job 225: lane groups ---------------------------------------------------------

/** Job 225: frame P 1248 wide (head 208) with three lanes, the first two in the group "Team", a start event in the first. */
function grouped() {
	const lanes = newLanes(600, ['Sales', 'Support', 'IT'], rand)
	const [a, b, c] = orderedLanes(lanes).map((l) => l.key)
	lanes[a].g = 'g00000001'
	lanes[b].g = 'g00000001'
	const items = [
		frame(P, { x: 0, y: 0, w: 1248, h: 600, z: 'a0', data: { title: 'Prozess', lanes, lgroups: { g00000001: 'Team' } } }),
		bpmn('bpmnStart', S, { x: 300, y: 80, w: 40, h: 40, z: 'i1', parent: P }),
		bpmn('bpmnEnd', E, { x: 600, y: 480, w: 40, h: 40, z: 'i2', parent: P }),
		connector(K1, { item: S }, { item: E }, { z: 'i3' }),
	]
	return { items, a, b, c }
}

test('job 225 AK6: a lane group is a lane with the refs of its lanes and a childLaneSet; the pool 2 · POOL_HEAD left of the content', () => {
	const { items, a, b, c } = grouped()
	const m = modelOf(items)
	const xml = bpmnXml(m, [...m.ids()])
	const root = readXml(xml)
	const ids = byId(root)
	const g = ids.get(`Lane_${P}_g00000001`)
	assert.equal(g.attrs.name, 'Team')
	assert.equal(g.children.filter((x) => x.name === 'flowNodeRef').length, 1, 'the start event of its first lane')
	const child = childOf(g, 'childLaneSet')
	assert.deepEqual(child.children.filter((x) => x.name === 'lane').map((x) => x.attrs.id), [`Lane_${P}_${a}`, `Lane_${P}_${b}`])
	const top = childOf(childOf(ids.get(`Process_${P}`), 'laneSet'), 'lane')
	assert.equal(top.attrs.id, `Lane_${P}_g00000001`)
	assert.deepEqual(boundsOf(root, `Participant_${P}`), { x: 36, y: 0, w: 1212, h: 600 })
	assert.deepEqual(boundsOf(root, `Lane_${P}_g00000001`), { x: 66, y: 0, w: 1182, h: 400 })
	assert.deepEqual(boundsOf(root, `Lane_${P}_${a}`), { x: 96, y: 0, w: 1152, h: 200 })
	assert.deepEqual(boundsOf(root, `Lane_${P}_${b}`), { x: 96, y: 200, w: 1152, h: 200 })
	assert.deepEqual(boundsOf(root, `Lane_${P}_${c}`), { x: 66, y: 400, w: 1182, h: 200 })
	assert.ok([...ids.keys()].every((k) => NCNAME.test(k)))
})

test('job 225 AK6: save, then insert: the same frame, lanes, group and members', () => {
	const { items } = grouped()
	const m = modelOf(items)
	const r = bpmnPayload(bpmnXml(m, [...m.ids()]))
	const f = r.raw.items.find((it) => it.t === 'frame')
	assert.deepEqual([f.x, f.y, f.w, f.h], [0, 0, 1248, 600])
	const lanes = orderedLanes(f.data.lanes)
	assert.deepEqual(lanes.map((l) => [l.t, l.h]), [['Sales', 200], ['Support', 200], ['IT', 200]])
	const [g] = Object.keys(f.data.lgroups)
	assert.match(g, /^g[0-9a-z]{8}$/)
	assert.deepEqual(f.data.lgroups, { [g]: 'Team' })
	assert.deepEqual(lanes.map((l) => l.g), [g, g, null])
	assert.equal(validatePayload(r.raw, { maxItems: Infinity, maxBytes: BPMN_FILE_MAX_BYTES }).skipped, 0, "the payload passes whole, groups too")
})

test('job 225 AK6: a file with three levels: the top lane is the group of the innermost lanes, a top lane without lanes below has none', () => {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D1">
  <bpmn:collaboration id="C1"><bpmn:participant id="P1" name="Pool" processRef="Pr1" /></bpmn:collaboration>
  <bpmn:process id="Pr1">
    <bpmn:laneSet id="LS1">
      <bpmn:lane id="A" name="Org"><bpmn:childLaneSet id="LS2">
        <bpmn:lane id="B" name="Dept"><bpmn:childLaneSet id="LS3">
          <bpmn:lane id="C1x" name="One" /><bpmn:lane id="D1x" name="Two" />
        </bpmn:childLaneSet></bpmn:lane>
      </bpmn:childLaneSet></bpmn:lane>
      <bpmn:lane id="E1x" name="Else" />
    </bpmn:laneSet>
    <bpmn:startEvent id="S1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Di1"><bpmndi:BPMNPlane id="Pl1" bpmnElement="C1">
    <bpmndi:BPMNShape id="P1_di" bpmnElement="P1" isHorizontal="true"><dc:Bounds x="100" y="100" width="1000" height="600" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="A_di" bpmnElement="A" isHorizontal="true"><dc:Bounds x="130" y="100" width="970" height="400" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="B_di" bpmnElement="B" isHorizontal="true"><dc:Bounds x="160" y="100" width="940" height="400" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="C_di" bpmnElement="C1x" isHorizontal="true"><dc:Bounds x="190" y="100" width="910" height="200" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="D_di" bpmnElement="D1x" isHorizontal="true"><dc:Bounds x="190" y="300" width="910" height="200" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="E_di" bpmnElement="E1x" isHorizontal="true"><dc:Bounds x="130" y="500" width="970" height="200" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="S1_di" bpmnElement="S1"><dc:Bounds x="300" y="180" width="36" height="36" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`
	const r = bpmnPayload(xml)
	const f = r.raw.items.find((it) => it.t === 'frame')
	assert.deepEqual([f.x, f.w], [100 - 36, 1000 + 36])
	const lanes = orderedLanes(f.data.lanes)
	const [g] = Object.keys(f.data.lgroups)
	assert.deepEqual(f.data.lgroups[g], 'Org')
	assert.deepEqual(lanes.map((l) => [l.t, l.g]), [['One', g], ['Two', g], ['Else', null]])
})

test('job 225 AK6: column groups stay out of the file', () => {
	const cols = { c00000001: { o: 'i0', w: 300, g: 'h00000001' }, c00000002: { o: 'i1', w: 400, g: 'h00000001' }, c00000003: { o: 'i2', w: 340 } }
	const shift = (it) => (it.parent === P ? { ...it, y: it.y + 60 } : it)
	const lanes = structuredClone(LANES_P)
	const grid = POOLS.map((it) => (it.id === P ? { ...it, h: 460, data: { ...it.data, cols: structuredClone(cols) } } : shift(it)))
	const withGroups = POOLS.map((it) => (it.id === P ? { ...it, h: 508, data: { ...it.data, lanes, cols, cgroups: { h00000001: 'Phase A' } } } : shift({ ...it, y: it.parent === P ? it.y + 48 : it.y })))
	const a = modelOf(grid)
	const b = modelOf(withGroups)
	const xa = bpmnXml(a, [...a.ids()])
	const xb = bpmnXml(b, [...b.ids()])
	assert.doesNotMatch(xb, /Phase A|h0000000/)
	assert.equal(all(readXml(xb), 'lane').length, all(readXml(xa), 'lane').length)
})

test('job 285 AK1/AK2: a pool plus a loose task joined by a connector: a collaboration with Participant_0, Process_0 without laneSet, and the file reads back', () => {
	const LOOSE = ID(90)
	const C = ID(91)
	const items = [...POOLS, bpmn('bpmnTask', LOOSE, { x: 1500, y: 100, w: 180, h: 120, z: 'j1', text: 'Lose' }), connector(C, { item: U }, { item: LOOSE }, { z: 'j2' })]
	const m = modelOf(items)
	const xml = bpmnXml(m, [...m.ids()])
	const root = readXml(xml)
	const ids = byId(root)
	assert.deepEqual(all(root, 'participant').map((p) => [p.attrs.id, p.attrs.processRef]), [
		['Participant_' + P, 'Process_' + P], ['Participant_' + Q, 'Process_' + Q], ['Participant_0', 'Process_0'],
	])
	const proc0 = ids.get('Process_0')
	assert.deepEqual(proc0.children.filter((c) => c.name === 'task').map((c) => [c.attrs.id, c.attrs.name]), [['Activity_' + LOOSE, 'Lose']])
	assert.equal(childOf(proc0, 'laneSet'), null)
	const b = boundsOf(root, 'Participant_0')
	assert.ok(b.x < 1500 && b.x + b.w > 1680 && b.y < 100 && b.y + b.h > 220, 'the pool around the loose task')
	assert.equal(all(root, 'BPMNShape').filter((s) => s.attrs.bpmnElement.startsWith('Lane_')).length, 3, 'only the lanes of the two pools')
	assert.deepEqual(all(root, 'messageFlow').filter((f) => f.attrs.id === 'Flow_' + C).map((f) => [f.attrs.sourceRef, f.attrs.targetRef]), [['Activity_' + U, 'Activity_' + LOOSE]])

	const r = readBpmnFile(xml)
	assert.equal(r.ok, true)
	assert.equal(r.skipped, 0)
	assert.equal(validatePayload(bpmnPayload(xml).raw, { maxItems: Infinity, maxBytes: BPMN_FILE_MAX_BYTES }).skipped, 0, 'every item passes the check')
	const back = r.payload.items
	assert.deepEqual(back.filter((it) => it.t === 'shape' && /Task$/.test(it.data.kind)).map((it) => it.data.text).sort(), ['Lose', 'Prüfen'])
	const pool = back.find((it) => it.t === 'frame' && it.data.title === 'Bestellung')
	assert.deepEqual(orderedLanes(pool.data.lanes).map((l) => l.t), ['Vertrieb', 'Lager'])
})
