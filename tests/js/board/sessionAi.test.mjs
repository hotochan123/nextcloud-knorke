/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 267: the AI of a board session (board/sessionAi.js) on a fake
 * host and fake routes:
 * - AK1 the bar offers Summarise / Cluster only in mode edit, with AI ready,
 *   the board switch on and nothing running; cluster needs two sortable notes
 *   or a frame with two
 * - AK4 the notice is asked before the first task and sent as acceptNotice;
 *   declined: nothing starts; confirmed: never asked again
 * - AK7 a finished task becomes exactly one undo step from its ops and
 *   inverse, nothing is sent again, the result is selected once it arrived,
 *   the task is forgotten; a failed task toasts
 * - the limit toast names the number; Cancel forgets the running task
 * - an AI card whose stored height is off gets one patch {h}, once
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { SessionAi, aiMessage, boardAllowsAi } from '../../../src/board/sessionAi.js'
import { UndoStack } from '../../../src/board/undo.js'
import { HttpError } from '../../../src/sync/http.js'

const ID = (s) => ('01JA' + s).padEnd(26, '0')
const note = (id, x, o = {}) => ({ id, t: 'sticky', x, y: 0, w: 200, h: 200, r: 0, z: 'i' + x, parent: null, data: { text: 'n' + x }, style: {}, ...o })

function harness({ state = {}, items = null, mode = 'edit', meta = {}, notice = true, start = null } = {}) {
	const model = new SceneModel()
	model.load(items ?? [note(ID('A'), 0), note(ID('B'), 300), note(ID('C'), 600)])
	const log = { zoom: [], toasts: [], forgot: [], started: [], selected: [], sent: [], asked: 0, views: [] }
	const undo = new UndoStack(50)
	let answer = {
		ready: true, reason: null, allowed: true, owner: true,
		notice: { text: null, url: '', hash: 'h', confirmed: notice }, limit: { max: 30, used: 0 }, tasks: [], ...state,
	}
	let wake = null
	const s = {
		board: { id: 7, meta }, boardId: 7, clientMode: mode, deps: {}, destroyed: false, frozen: false, mode: 'user', model,
		scene: { measureAiHeight: (it) => (it.data?.md ? 300 : null) },
		selection: [ID('A'), ID('B')],
		sync: { poke() {}, enqueue: (ops) => { log.sent.push(...ops); return new Set(ops.map((o) => o.id)) } },
		ui: {
			onAi: (v) => log.views.push(v),
			onAiNotice: async () => { log.asked++; return log.answerNotice ?? true },
		},
		undoStack: undo, viewOnly: false,
	}
	s.deps.ai = {
		aiState: async () => answer,
		startAi: async (id, body) => {
			log.started.push(body)
			if (start) return start(body)
			return 41
		},
		forgetAi: async (id, task) => { log.forgot.push(task) },
	}
	s.deps.aiSleep = () => new Promise((resolve) => { wake = resolve })
	const host = Object.fromEntries(Object.keys(s).map((k) => [k, () => s[k]]))
	Object.assign(host, {
		emitSelection() {}, emitUndo() {}, flushVisible() {}, info() {},
		boundsOf: (ids) => ({ x: 2000, y: 0, w: 360, h: 120 }),
		viewportWorld: () => ({ x: 0, y: 0, w: 1000, h: 700 }),
		reserveTop: (r) => r,
		viewTop: () => 0,
		zoomToRect: (r) => log.zoom.push(r),
		select: (ids) => log.selected.push(ids),
		toast: (m) => log.toasts.push(m),
	})
	const ai = new SessionAi(host)
	return { ai, s, log, model, undo, setAnswer: (a) => { answer = { ...answer, ...a } }, tick: async () => { const w = wake; wake = null; w?.(); await new Promise((r) => setTimeout(r, 0)) } }
}

const all = (h) => h.s.selection.map((id) => h.model.get(id))

test('AK1 the offer follows the mode, AI ready, the board switch and the selection', async () => {
	const h = harness()
	assert.deepEqual(h.ai.offer(all(h)), { summarise: false, cluster: false }, 'not loaded yet')
	await h.ai.load()
	assert.deepEqual(h.ai.offer(all(h)), { summarise: true, cluster: true })
	h.s.selection = [ID('A')]
	assert.deepEqual(h.ai.offer(all(h)), { summarise: true, cluster: false }, 'one note: nothing to cluster')
	h.s.board = { id: 7, meta: { ai: 'off' } }
	assert.deepEqual(h.ai.offer(all(h)), { summarise: false, cluster: false }, 'board switch off')
	assert.equal(boardAllowsAi({ ai: 'off' }), false)
	assert.equal(boardAllowsAi(undefined), true)
	for (const over of [{ mode: 'view' }, { mode: 'vote' }, { state: { ready: false } }, { state: { reason: 'forbidden' } }]) {
		const g = harness(over)
		await g.ai.load()
		assert.deepEqual(g.ai.offer(all(g)), { summarise: false, cluster: false }, JSON.stringify(over))
	}
	const f = harness({ items: [{ id: ID('F'), t: 'frame', x: 0, y: 0, w: 900, h: 600, r: 0, z: 'a1', parent: null, data: { title: 'T' }, style: {} },
		note(ID('A'), 10, { parent: ID('F') }), note(ID('B'), 300, { parent: ID('F') })] })
	await f.ai.load()
	f.s.selection = [ID('F')]
	assert.deepEqual(f.ai.offer(all(f)), { summarise: true, cluster: true }, 'a frame with two notes')
})

test('AK4 the notice comes first; declined: nothing starts; confirmed: sent as acceptNotice, never asked again', async () => {
	const h = harness({ notice: false })
	await h.ai.load()
	h.log.answerNotice = false
	assert.equal(await h.ai.run('summarise'), false)
	assert.deepEqual([h.log.asked, h.log.started.length], [1, 0])
	h.log.answerNotice = true
	assert.equal(await h.ai.run('summarise'), true)
	assert.deepEqual(h.log.started[0], { kind: 'summarise', ids: [ID('A'), ID('B')], acceptNotice: true })
	assert.equal(h.log.asked, 2)
	await h.ai.cancel()
	assert.equal(await h.ai.run('cluster'), true)
	assert.deepEqual(h.log.started[1], { kind: 'cluster', ids: [ID('A'), ID('B')], frame: null, acceptNotice: false })
	assert.equal(h.log.asked, 2, 'confirmed once')
})

test('AK7 a finished task is one undo step, nothing is sent, the result selected once it is here, the task forgotten', async () => {
	const h = harness()
	await h.ai.load()
	assert.equal(await h.ai.run('summarise'), true)
	assert.deepEqual(h.log.views.at(-1).working, true)
	assert.deepEqual(h.ai.offer(all(h)), { summarise: false, cluster: false }, 'no second task while one runs')
	const card = ID('Z')
	const put = { o: 'put', id: card, t: 'ai', p: { x: 900, y: 0, w: 360, h: 120, r: 0, z: 'i9', parent: null, data: { md: '# x' }, style: {} } }
	h.setAnswer({ tasks: [{ task: 41, kind: 'summarise', status: 'done', at: 1, ops: [put], inverse: [{ o: 'remove', id: card }], select: [card] }] })
	await h.tick()
	assert.equal(h.undo.canUndo(), true)
	assert.deepEqual([h.undo.peek('undo').ops.length, h.undo.peek('undo').inverse[0]], [1, { o: 'remove', id: card }], 'exactly one step: undo removes the card')
	assert.deepEqual(h.log.sent, [], 'the server wrote it: nothing sent')
	assert.deepEqual(h.log.selected, [], 'not here yet')
	assert.deepEqual(h.log.forgot, [41])
	assert.equal(h.log.views.at(-1).working, false)
	h.model.load([note(ID('A'), 0), note(ID('B'), 300), { ...put.p, id: card, t: 'ai' }])
	h.ai.selectArrived()
	assert.deepEqual(h.log.selected, [[card]])
})

test('failed tasks and failed starts toast once; Cancel forgets the running task', async () => {
	const h = harness()
	await h.ai.load()
	await h.ai.run('cluster')
	h.setAnswer({ tasks: [{ task: 41, kind: 'cluster', status: 'failed', error: 'ai_answer', at: 1 }] })
	await h.tick()
	assert.deepEqual(h.log.toasts, ['The AI answer could not be used. Try again.'])
	assert.equal(h.undo.canUndo(), false)
	const g = harness({ start: () => { throw new HttpError(429, 'ai_limit', 'x', null, true, { error: 'ai_limit', max: 5 }) } })
	await g.ai.load()
	assert.equal(await g.ai.run('summarise'), false)
	assert.deepEqual(g.log.toasts, ['You have used your 5 AI tasks for today.'])
	const c = harness()
	await c.ai.load()
	await c.ai.run('summarise')
	await c.ai.cancel()
	assert.deepEqual(c.log.forgot, [41])
	assert.equal(c.log.views.at(-1).working, false)
	assert.equal(aiMessage('ai_cancelled'), null)
})

test('a running task of an earlier tab comes back as the chip', async () => {
	const h = harness({ state: { tasks: [{ task: 9, kind: 'cluster', status: 'running', at: 1 }] } })
	await h.ai.load()
	assert.deepEqual([h.log.views.at(-1).working, h.log.views.at(-1).kinds], [true, ['cluster']])
})

test('an AI card with a stored height off by more than 2 gets one patch {h}, once per session', () => {
	const h = harness()
	const card = { id: ID('Z'), t: 'ai', x: 0, y: 0, w: 360, h: 120, r: 0, z: 'i9', parent: null, data: { md: '# x' }, style: {} }
	h.ai.fixHeights([card, { ...card, id: ID('Y'), h: 299 }, note(ID('A'), 0)])
	assert.deepEqual(h.log.sent, [{ o: 'patch', id: ID('Z'), p: { h: 300 } }])
	h.ai.fixHeights([card])
	assert.equal(h.log.sent.length, 1, 'once')
	const v = harness({ mode: 'view' })
	v.ai.fixHeights([card])
	assert.deepEqual(v.log.sent, [], 'a viewer never writes')
})

test('round 2: the result of a task of this tab outside the view is brought into view, once; one of an earlier tab is not', async () => {
	const card = ID('Z')
	const put = { o: 'put', id: card, t: 'ai', p: { x: 2000, y: 0, w: 360, h: 120, r: 0, z: 'i9', parent: null, data: { md: '# x' }, style: {} } }
	const done = (task) => ({ tasks: [{ task, kind: 'summarise', status: 'done', at: 1, ops: [put], inverse: [{ o: 'remove', id: card }], select: [card] }] })
	const h = harness()
	await h.ai.load()
	await h.ai.run('summarise')
	h.setAnswer(done(41))
	await h.tick()
	h.model.load([note(ID('A'), 0), note(ID('B'), 300), { ...put.p, id: card, t: 'ai' }])
	h.ai.selectArrived()
	assert.deepEqual(h.log.zoom, [{ x: 2000, y: 0, w: 360, h: 120 }])
	h.ai.selectArrived()
	assert.equal(h.log.zoom.length, 1, 'once')
	const g = harness({ state: { tasks: [{ task: 9, kind: 'summarise', status: 'running', at: 1 }] } })
	await g.ai.load()
	g.setAnswer(done(9))
	await g.tick()
	g.model.load([{ ...put.p, id: card, t: 'ai' }])
	g.ai.selectArrived()
	assert.deepEqual(g.log.zoom, [], 'not started here: the camera stays')
	assert.deepEqual(g.log.selected, [[card]])
})
