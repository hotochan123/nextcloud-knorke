/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 273 AK3, the session side of a pen stroke: actions.createStroke
 * (one put of type pen, its box, points relative to it, the frame under the
 * first point as its parent, the tool's values when they pass their rules)
 * and the intent stroke in BoardSession (one commit, one undo step, nothing
 * selected; undo removes it, the eraser's delete intent is one step too).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createStroke } from '../../../src/board/actions.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { checkField } from '../../../src/model/registry.js'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage } from './fakes.mjs'

const F = ID(1)
const ME = { pid: 'p1', name: 'Alice', role: 'owner', mod: true, guest: false, client: 'c1' }

describe('job 273 AK3: createStroke', () => {
	test('one put of type pen: box with half the width, points relative to it, on top, no selection', () => {
		const m = new SceneModel()
		m.load([])
		const r = createStroke(m, { points: [100, 50, 200, 80], kind: 'marker', stroke: '#FAEA89', strokeWidth: 20 }, () => ID(9))
		assert.equal(r.ops.length, 1)
		const p = r.ops[0].p
		assert.deepEqual([r.ops[0].o, r.ops[0].t, p.x, p.y, p.w, p.h, p.r, p.parent], ['put', 'pen', 90, 40, 120, 50, 0, null])
		assert.deepEqual(p.data, { kind: 'marker', points: [10, 10, 110, 40] })
		assert.deepEqual(p.style, { stroke: '#faea89', strokeWidth: 20 })
		assert.deepEqual(r.inverse, [{ o: 'remove', id: ID(9) }])
		assert.deepEqual(r.selectIds, [])
		assert.equal(checkField('pen', 'data.points', p.data.points).ok, true)
	})

	test('the frame under the first point is the parent, x/y relative to it', () => {
		const m = new SceneModel()
		m.load([frame(F, { x: 1000, y: 1000, w: 800, h: 600 })])
		const r = createStroke(m, { points: [1100, 1100, 2500, 1100], kind: 'pen', stroke: '#191b1d', strokeWidth: 4 }, () => ID(9))
		assert.equal(r.ops[0].p.parent, F)
		assert.deepEqual([r.ops[0].p.x, r.ops[0].p.y], [98, 98])
	})

	test('values outside the rules fall back to the defaults; no or too many points: nothing', () => {
		const m = new SceneModel()
		m.load([])
		const r = createStroke(m, { points: [0, 0, 10, 10], kind: 'eraser', stroke: 'red', strokeWidth: 99 }, () => ID(9))
		assert.deepEqual([r.ops[0].p.data.kind, r.ops[0].p.style], ['pen', { stroke: '#191b1d', strokeWidth: 4 }])
		assert.deepEqual(createStroke(m, { points: [] }).ops, [])
		assert.deepEqual(createStroke(m, { points: new Array(1002).fill(1) }).ops, [])
	})
})

async function open(items) {
	const clock = new FakeClock(10000)
	let rev = 5
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: 1760100000000, rev, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', metaRev: 0, meta: {}, links: { edit: null, vote: null }, linksAllowed: true }, me: ME, items }
		},
		async sync(body) {
			tr.calls.push(structuredClone(body))
			const res = { rev: body.since, presence: {} }
			if (body.ops) {
				rev = Math.max(rev, body.since) + 1
				res.acks = { seq: body.seq, rev, res: body.ops.map(() => 'ok') }
				res.rev = rev
			}
			return res
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		mode: 'user',
		boardId: 7,
		viewOnly: false,
		debug: false,
		ui: {},
		deps: {
			SceneModel: FakeModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep,
			rand: () => 0.5, win: null, toast: () => {}, info: () => {}, wall: () => 1760100000000,
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, scene: s.scene, model: s.model }
}

describe('job 273 AK3: the intent stroke in the session', () => {
	test('one put, one undo step, nothing selected; undo removes the stroke, the eraser\'s delete is one step', async () => {
		const h = await open([])
		const n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'stroke', points: [10, 10, 60, 10], kind: 'pen', stroke: '#191b1d', strokeWidth: 4 })
		const id = [...h.model.ids()].find((x) => h.model.get(x).t === 'pen')
		assert.ok(id, 'the stroke is in the model at once')
		assert.equal(h.s.undoStack.done.length, 1)
		assert.deepEqual(h.s.selection, [])
		h.s.undo()
		assert.equal(h.model.has(id), false)
		h.s.redo()
		assert.equal(h.model.has(id), true)
		h.scene.callbacks.onIntent({ type: 'delete', ids: [id] })
		assert.equal(h.model.has(id), false)
		assert.equal(h.s.undoStack.done.length, 2)
		h.s.undo()
		assert.equal(h.model.has(id), true)
		await h.clock.advance(200)
		const puts = h.tr.calls.slice(n).flatMap((b) => b.ops ?? []).filter((o) => o.id === id && o.o === 'put')
		assert.ok(puts.length >= 1)
		assert.deepEqual([puts[0].t, puts[0].p.data.points, puts[0].p.style], ['pen', [2, 2, 52, 2], { stroke: '#191b1d', strokeWidth: 4 }])
		h.s.destroy()
	})
})
