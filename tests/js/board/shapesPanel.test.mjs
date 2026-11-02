/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 201 (shapes panel), creating the new kinds:
 * - AK3 actions.createItem: without a dragged box a database is 160 × 200,
 *   a symbol 96 × 96, filled in the text colour without border, and opens
 *   no editor; the intent's style wins; a dragged box keeps its size (the
 *   symbol its look); an invalid kind is a plain rect; neighbourItem ("+")
 *   of a symbol opens no editor either
 * - BoardSession.placeShape: one put at the canvas point (screenToWorld)
 *   or the middle of the view, one undo step, selected; a flowchart shape
 *   opens its editor, a symbol none; nothing for an unknown kind, in view
 *   mode or on a frozen board
 * - (job 203 AK5) own shapes (kind image): placeShape with a picture puts
 *   data.img in pieces of 6000 and the proportions of the entry (long side
 *   96, at most 1 : 8), no editor; without a valid picture nothing; "+"
 *   copies the picture; data.kind never changes an own shape nor makes one
 * - (job 235 AK3, AK5) the label of an own shape: none when placed, one
 *   undo step, undo gives back the empty one
 * - (job 204 AK3, AK5, AK6) the BPMN kinds: sizes and editor of a click,
 *   the "+" of an end event; placeLanes ("Pool with lanes"): a frame with
 *   three lanes at the point or the middle of the view, one undo step;
 *   setFlow / session.setFlow: the fields of the flow on the unlocked
 *   connectors, one undo step, nothing in view-only mode or frozen
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { createItem, neighbourItem, setFlow, setStyle } from '../../../src/board/actions.js'
import { FLOWS } from '../../../src/model/connectors.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { SceneModel, isUnfilledShape } from '../../../src/model/SceneModel.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, connector, memoryStorage, shape } from './fakes.mjs'

const NEW = ID('N1')
const C = ID('C1')
const S = ID('S1')
const T0 = 1760100000000

/**
 * @param {object[]} items WireItems
 * @return {SceneModel} a loaded scene model
 */
function modelOf(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

describe('job 201 AK3: createItem of the new kinds', () => {
	test('a click: database 160 × 200 centred, white with a border, editor; offPage 120 × 120', () => {
		const r = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: null, data: { kind: 'database' } }, () => NEW)
		const p = r.ops[0].p
		assert.deepEqual([p.x, p.y, p.w, p.h], [-80, -100, 160, 200])
		assert.deepEqual(p.data, { kind: 'database', text: '' })
		assert.deepEqual(p.style, { fill: '#ffffff', stroke: '#3d4044', strokeWidth: 2 })
		assert.equal(r.edit, true)
		const o = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'offPage' } }, () => NEW).ops[0].p
		assert.deepEqual([o.w, o.h], [120, 120])
	})

	test('a click: a symbol is 96 × 96, filled in the text colour without border, and opens no editor', () => {
		const r = createItem(modelOf([]), { t: 'shape', at: { x: 100, y: 100 }, rect: null, data: { kind: 'iconPerson' } }, () => NEW)
		const p = r.ops[0].p
		assert.deepEqual([p.x, p.y, p.w, p.h], [52, 52, 96, 96])
		assert.deepEqual(p.style, { fill: '#191b1d', stroke: '#3d4044', strokeWidth: 0 })
		assert.equal(r.edit, false)
	})

	test('the intent\'s style wins; a dragged box keeps its size and the symbol its look; an invalid kind is a rect', () => {
		const a = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'iconStar' }, style: { fill: '#E53935' } }, () => NEW).ops[0].p
		assert.deepEqual([a.style.fill, a.style.strokeWidth], ['#e53935', 0])
		const b = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: { x: 10, y: 20, w: 300, h: 50 }, data: { kind: 'iconStar' } }, () => NEW).ops[0].p
		assert.deepEqual([b.x, b.y, b.w, b.h, b.style.fill, b.style.strokeWidth], [10, 20, 300, 50, '#191b1d', 0])
		const c = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'heptagon' } }, () => NEW)
		assert.deepEqual([c.ops[0].p.data.kind, c.ops[0].p.w, c.ops[0].p.h, c.edit], ['rect', 200, 120, true])
	})

	test('the "+" of a symbol: the neighbour is a symbol with its look, without editor; of a document with one', () => {
		const sym = shape(S, { w: 96, h: 96, data: { kind: 'iconFlag', text: '' }, style: { fill: '#191b1d', strokeWidth: 0 } })
		let n = 0
		const ids = () => (n++ === 0 ? NEW : C)
		const r = neighbourItem(modelOf([sym]), { id: S, side: 'r' }, {}, ids)
		assert.equal(r.ops[0].p.data.kind, 'iconFlag')
		assert.deepEqual([r.ops[0].p.style.fill, r.ops[0].p.style.strokeWidth], ['#191b1d', 0])
		assert.equal(r.edit, false)
		const doc = shape(S, { data: { kind: 'document', text: '' } })
		n = 0
		assert.equal(neighbourItem(modelOf([doc]), { id: S, side: 'r' }, {}, ids).edit, true)
	})
})

// ---------------------------------------------------------------- the session

const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }

/** Scene fake: the world point of a screen point is the identity (FakeScene), the view 1280 × 800. */
class PanelScene extends FakeScene {
	setMode(mode) {
		this.log('setMode', mode)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

/**
 * @param {object[]} items WireItems
 * @return {object} a server that applies ops and answers with the items changed since the cursor
 */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) return 'dup'
			srv.live.set(op.id, itemFromPut(op))
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) return 'gone'
			applyPatch(it, structuredClone(op.p))
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) return 'gone'
			srv.live.delete(op.id)
		} else {
			return 'bad'
		}
		srv.rev++
		srv.changed.push([srv.rev, op.id])
		return 'ok'
	}
	srv.apply = (ops) => ops.map(apply)
	srv.since = (rev) => {
		const ids = new Set(srv.changed.filter(([r]) => r > rev).map(([, id]) => id))
		return {
			items: [...ids].filter((id) => srv.live.has(id)).map((id) => structuredClone(srv.live.get(id))),
			removed: [...ids].filter((id) => !srv.live.has(id)),
		}
	}
	return srv
}

/**
 * @param {object} [o] items, viewOnly, meta
 * @return {Promise<object>} harness
 */
async function open({ items = [], viewOnly = false, meta = {} } = {}) {
	const clock = new FakeClock(10000)
	const srv = lwwServer(items)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Board', role: ALICE.role, metaRev: 3, meta }, me: ALICE, items: structuredClone(items) }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				srv.apply(body.ops ?? [])
				return {}
			}
			tr.calls.push(structuredClone(body))
			const res = body.ops ? srv.apply(body.ops) : null
			const out = { rev: srv.rev, ...srv.since(body.since), presence: {} }
			if (res) out.acks = { seq: body.seq, rev: srv.rev, res }
			return out
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		ui: {},
		deps: {
			SceneModel: FakeModel,
			SceneManager: PanelScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: () => {},
			wall: () => T0,
		},
	})
	await s.open()
	await clock.advance(0)
	const opsSince = async (from = 0) => {
		await clock.advance(200)
		return tr.calls.slice(from).flatMap((b) => b.ops ?? [])
	}
	return { s, tr, scene: s.scene, opsSince }
}

describe('job 201: session.placeShape', () => {
	test('at a canvas point: one put centred there, one undo step, selected; a document opens its editor', async () => {
		const h = await open()
		const n = h.tr.calls.length
		const id = h.s.placeShape('document', { x: 400, y: 300 })
		const ops = await h.opsSince(n)
		assert.equal(ops.length, 1)
		assert.deepEqual([ops[0].id, ops[0].t, ops[0].p.data.kind], [id, 'shape', 'document'])
		assert.deepEqual([ops[0].p.x + ops[0].p.w / 2, ops[0].p.y + ops[0].p.h / 2], [400, 300])
		assert.equal(h.s.undoStack.done.length, 1)
		assert.deepEqual(h.s.selection, [id])
		assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', id, {}])
		h.s.destroy()
	})

	test('without a point: the middle of the view; a symbol opens no editor', async () => {
		const h = await open()
		const n = h.tr.calls.length
		const id = h.s.placeShape('iconClock', null)
		const ops = await h.opsSince(n)
		assert.deepEqual([ops[0].p.x, ops[0].p.y, ops[0].p.w, ops[0].p.h], [640 - 48, 400 - 48, 96, 96])
		assert.deepEqual(h.s.selection, [id])
		assert.equal(h.scene.callsOf('openTextEditor').length, 0)
		h.s.destroy()
	})

	test('nothing for an unknown kind, in view-only mode or on a frozen board', async () => {
		const h = await open()
		const n = h.tr.calls.length
		assert.equal(h.s.placeShape('heptagon', { x: 1, y: 1 }), null)
		assert.equal(h.s.placeShape(null), null)
		assert.equal((await h.opsSince(n)).length, 0)
		h.s.destroy()
		const v = await open({ viewOnly: true })
		assert.equal(v.s.placeShape('database'), null)
		v.s.destroy()
		const f = await open({ meta: { status: 'frozen' } })
		f.s.frozen = true
		assert.equal(f.s.placeShape('database'), null)
		f.s.destroy()
	})
})

/** (job 203) a 1 × 1 PNG and a picture to place */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const BIG = 'data:image/png;base64,' + 'A'.repeat(14000)

describe('job 203 AK5: own shapes (kind image) on the board', () => {
	test('placeShape with a picture: data.img in pieces, the long side 96 in the proportions of the entry, no editor', async () => {
		const h = await open()
		const n = h.tr.calls.length
		const id = h.s.placeShape('image', { x: 400, y: 300 }, { uri: BIG, w: 200, h: 100 })
		const ops = await h.opsSince(n)
		assert.equal(ops.length, 1)
		const p = ops[0].p
		assert.deepEqual([ops[0].id, p.data.kind, p.w, p.h], [id, 'image', 96, 48])
		assert.deepEqual(p.data.img.map((s) => s.length), [6000, 6000, 2022], 'pieces of at most 6000 characters')
		assert.equal(p.data.img.join(''), BIG)
		assert.deepEqual(p.style, { fill: '#ffffff', stroke: '#3d4044', strokeWidth: 0, fillOpacity: 0 })
		assert.equal(h.scene.callsOf('openTextEditor').length, 0, 'no text editor')
		assert.deepEqual(h.s.selection, [id])
		h.s.destroy()
	})

	test('placeShape image: very long pictures stop at 1 : 8; without a valid picture nothing', async () => {
		const h = await open()
		const n = h.tr.calls.length
		h.s.placeShape('image', null, { uri: PNG, w: 20, h: 400 })
		const ops = await h.opsSince(n)
		assert.deepEqual([ops[0].p.w, ops[0].p.h], [12, 96])
		assert.equal(h.s.placeShape('image', null, null), null)
		assert.equal(h.s.placeShape('image', null, { uri: 'https://example.org/a.png', w: 1, h: 1 }), null)
		assert.equal(h.s.placeShape('image', null, { uri: PNG, w: 0, h: 1 }), null)
		h.s.destroy()
	})

	test('"+" copies the picture; the kind of an own shape never changes, no other shape becomes one', () => {
		const img = [PNG.slice(0, 40), PNG.slice(40)]
		const pic = shape(S, { data: { kind: 'image', img }, style: { strokeWidth: 0, fillOpacity: 0 } })
		const rect = shape(C, { data: { kind: 'rect' } })
		const m = modelOf([pic, rect])
		const r = neighbourItem(m, { id: S, side: 'r' }, {}, () => NEW)
		assert.deepEqual(r.ops[0].p.data, { kind: 'image', text: '', img })
		assert.equal(r.edit, false)
		const k = setStyle(m, [S, C], 'data.kind', 'ellipse')
		assert.deepEqual(k.ops.map((o) => o.id), [C], 'only the rectangle')
		assert.equal(setStyle(m, [C], 'data.kind', 'image').ops.length, 0)
	})

	test('round 1: the select tool hits an own shape anywhere on its picture (never a shape without fill)', () => {
		const m = modelOf([shape(S, { w: 96, h: 96, data: { kind: 'image', img: [PNG] }, style: { strokeWidth: 0, fillOpacity: 0 } })])
		assert.equal(isUnfilledShape(m.get(S)), false)
		assert.equal(m.hitTest(48, 48, 4, { hollow: true }), S, 'the middle of the picture')
		assert.equal(isUnfilledShape(shape(C, { style: { fillOpacity: 0 } })), true, 'a rectangle without fill stays hollow')
	})

	test('createItem: an invalid picture is dropped, a dragged box keeps its size', () => {
		const bad = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'image', img: ['data:image/bmp;base64,AAAA'] } }, () => NEW).ops[0].p
		assert.equal(bad.data.img, undefined)
		const r = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: { x: 10, y: 20, w: 300, h: 50 }, data: { kind: 'image', img: [PNG] }, size: { w: 96, h: 48 } }, () => NEW)
		assert.deepEqual([r.ops[0].p.w, r.ops[0].p.h, r.edit], [300, 50, false])
	})
})

describe('job 235: the label of an own shape in the session', () => {
	test('AK5: a placed own shape has an empty label and no editor; AK3: its label is one undo step, undo gives back the empty one; labelled', async () => {
		const h = await open()
		const id = h.s.placeShape('image', { x: 400, y: 300 }, { uri: PNG, w: 96, h: 96 })
		const put = (await h.opsSince(0)).find((o) => o.o === 'put' && o.id === id)
		assert.equal(put.p.data.text, '')
		assert.equal(h.scene.callsOf('openTextEditor').length, 0, 'no text editor')
		assert.equal(h.s.selectionInfo().labelled, true)
		const done = h.s.undoStack.done.length
		const n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'text', id, path: 'data.text', value: 'Server', before: '', final: true })
		const ops = await h.opsSince(n)
		assert.ok(ops.some((o) => o.id === id && o.p?.['data.text'] === 'Server'), JSON.stringify(ops))
		assert.equal(h.s.undoStack.done.length, done + 1, 'one undo step')
		const m = h.tr.calls.length
		h.s.undo()
		const back = await h.opsSince(m)
		assert.ok(back.some((o) => o.id === id && o.p?.['data.text'] === ''), JSON.stringify(back))
		h.s.destroy()
	})
})

// ---------------------------------------------------------------- job 204 (BPMN)

describe('job 204 AK3: createItem of the BPMN kinds', () => {
	test('a click: a start event is 64 × 64 without editor, a task 180 × 120 with one, a gateway 80 × 80 without', () => {
		const ev = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: null, data: { kind: 'bpmnStart' } }, () => NEW)
		assert.deepEqual([ev.ops[0].p.w, ev.ops[0].p.h, ev.edit], [64, 64, false])
		assert.deepEqual(ev.ops[0].p.style, { fill: '#ffffff', stroke: '#191b1d', strokeWidth: 2 })
		const task = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: null, data: { kind: 'bpmnTask' } }, () => NEW)
		assert.deepEqual([task.ops[0].p.w, task.ops[0].p.h, task.edit], [180, 120, true])
		const gw = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: null, data: { kind: 'bpmnExclusive' } }, () => NEW)
		assert.deepEqual([gw.ops[0].p.w, gw.ops[0].p.h, gw.edit], [80, 80, false])
		const store = createItem(modelOf([]), { t: 'shape', at: { x: 0, y: 0 }, rect: null, data: { kind: 'bpmnDataStore' } }, () => NEW)
		assert.deepEqual([store.ops[0].p.w, store.ops[0].p.h, store.edit], [120, 120, true])
	})

	test('the "+" of an end event: the neighbour is an end event without editor', () => {
		const end = shape(S, { w: 64, h: 64, data: { kind: 'bpmnEnd', text: '' } })
		let n = 0
		const r = neighbourItem(modelOf([end]), { id: S, side: 'r' }, {}, () => (n++ === 0 ? NEW : C))
		assert.deepEqual([r.ops[0].p.data.kind, r.edit], ['bpmnEnd', false])
	})
})

describe('job 204 AK6: session.placeLanes ("Pool with lanes")', () => {
	test('at a canvas point: a frame with three lanes centred there, one undo step, selected, its title editor', async () => {
		const h = await open()
		const n = h.tr.calls.length
		const id = h.s.placeLanes({ x: 700, y: 500 })
		const ops = await h.opsSince(n)
		assert.equal(ops.length, 1)
		const p = ops[0].p
		assert.deepEqual([ops[0].id, ops[0].t, p.w, p.h], [id, 'frame', 1200, 600])
		assert.deepEqual([p.x + p.w / 2, p.y + p.h / 2], [700, 500])
		assert.deepEqual(Object.values(p.data.lanes).map((l) => [l.h, l.t]), [[200, 'Lane 1'], [200, 'Lane 2'], [200, 'Lane 3']])
		assert.equal(h.s.undoStack.done.length, 1)
		assert.deepEqual(h.s.selection, [id])
		assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', id, {}])
		h.s.destroy()
	})

	test('round 1: the pool takes the items lying wholly inside it, in the same undo step; one only partly inside stays', async () => {
		const IN = ID('I1')
		const HALF = ID('H1')
		const h = await open({ items: [shape(IN, { x: 500, y: 400, w: 180, h: 120, data: { kind: 'bpmnUserTask', text: 'Check order' } }), shape(HALF, { x: 1250, y: 400, w: 200, h: 120 })] })
		const n = h.tr.calls.length
		const id = h.s.placeLanes({ x: 700, y: 500 })
		const ops = await h.opsSince(n)
		const put = ops.find((o) => o.id === id)
		assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h], [100, 200, 1200, 600])
		assert.deepEqual(Object.values(put.p.data.lanes).map((l) => l.h), [200, 200, 200])
		assert.deepEqual(ops.find((o) => o.id === IN)?.p, { x: 400, y: 200, parent: id }, 'the task goes into the pool')
		assert.equal(ops.some((o) => o.id === HALF), false, 'partly outside: not taken')
		assert.equal(h.s.undoStack.done.length, 1)
		const m = h.tr.calls.length
		h.s.undo()
		const back = await h.opsSince(m)
		assert.deepEqual(back.find((o) => o.id === IN)?.p, { x: 500, y: 400, parent: null })
		assert.ok(back.some((o) => o.o === 'remove' && o.id === id))
		h.s.destroy()
	})

	test('without a point the middle of the view; nothing in view-only mode or on a frozen board', async () => {
		const h = await open()
		const n = h.tr.calls.length
		h.s.placeLanes(null)
		const p = (await h.opsSince(n))[0].p
		assert.deepEqual([p.x, p.y], [640 - 600, 400 - 300])
		h.s.destroy()
		const v = await open({ viewOnly: true })
		assert.equal(v.s.placeLanes({ x: 1, y: 1 }), null)
		v.s.destroy()
		const f = await open({ meta: { status: 'frozen' } })
		f.s.frozen = true
		assert.equal(f.s.placeLanes(null), null)
		f.s.destroy()
	})
})

describe('job 204 AK5: "Sequence flow" and "Message flow"', () => {
	const A = ID('A1')
	const B = ID('B1')
	const K1 = ID('K1')
	const K2 = ID('K2')
	const K3 = ID('K3')
	const items = () => [
		shape(A), shape(B, { x: 400 }),
		connector(K1, { item: A }, { item: B }),
		connector(K2, { item: B }, { item: A }, { style: { stroke: '#191b1d', strokeWidth: 2, dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen' } }),
		connector(K3, { item: A }, { x: 0, y: 900 }, { lock: { by: 'pidbob0000000001', at: 1 } }),
	]

	test('setFlow: the differing fields of each unlocked connector, the inverse what was stored; others give no op', () => {
		const m = modelOf(items())
		const r = setFlow(m, [K1, K2, K3, A], 'message')
		assert.deepEqual(r.ops, [{ o: 'patch', id: K1, p: { 'style.dash': 'dashed', 'style.startCap': 'circleOpen', 'style.endCap': 'triangleOpen' } }])
		assert.deepEqual(r.inverse, [{ o: 'patch', id: K1, p: { 'style.dash': null, 'style.startCap': null, 'style.endCap': 'arrow' } }])
		const s = setFlow(m, [K1, K2], 'sequence')
		assert.deepEqual(s.ops, [
			{ o: 'patch', id: K1, p: { 'style.endCap': 'triangle' } },
			{ o: 'patch', id: K2, p: { 'style.dash': 'solid', 'style.startCap': 'none', 'style.endCap': 'triangle' } },
		])
		assert.deepEqual(s.inverse[1].p, { 'style.dash': 'dashed', 'style.startCap': 'circleOpen', 'style.endCap': 'triangleOpen' })
		assert.deepEqual(setFlow(m, [K2], 'message'), { ops: [], inverse: [] }, 'looks so already')
		assert.deepEqual(setFlow(m, [K1], 'association'), { ops: [], inverse: [] }, 'no such flow')
		assert.deepEqual(Object.keys(FLOWS), ['sequence', 'message'])
	})

	test('session.setFlow: one patch per unlocked selected connector, one undo step, undo restores; view-only and frozen send nothing', async () => {
		const h = await open({ items: items() })
		h.s.select([K1, K2, K3])
		const n = h.tr.calls.length
		h.s.setFlow('sequence')
		const ops = await h.opsSince(n)
		assert.deepEqual(ops.map((o) => o.id), [K1, K2])
		assert.equal(h.s.undoStack.done.length, 1)
		const m = h.tr.calls.length
		h.s.undo()
		const back = await h.opsSince(m)
		assert.deepEqual(back.find((o) => o.id === K2).p, { 'style.dash': 'dashed', 'style.startCap': 'circleOpen', 'style.endCap': 'triangleOpen' })
		h.s.destroy()
		const v = await open({ items: items(), viewOnly: true })
		v.s.select([K1])
		const nv = v.tr.calls.length
		v.s.setFlow('message')
		assert.equal((await v.opsSince(nv)).length, 0)
		v.s.destroy()
		const f = await open({ items: items(), meta: { status: 'frozen' } })
		f.s.frozen = true
		f.s.select([K1])
		const nf = f.tr.calls.length
		f.s.setFlow('message')
		assert.equal((await f.opsSince(nf)).length, 0)
		f.s.destroy()
	})
})
