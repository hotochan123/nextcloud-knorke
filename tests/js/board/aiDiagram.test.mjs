/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 268: a mind map, org chart or tree from a prompt.
 * - AK4 the tree becomes ONE put of a mind map with every node, the layout
 *   of the choice, the middle of its hull on the middle of the view,
 *   selected, one undo step; undo removes it; 50 nodes of 200 characters
 *   pass the mind map check (the server's mirror)
 * - AK5 sessionAi: start → poll → done opens the preview and keeps the task
 *   until Insert / Try again / Cancel; Cancel while it runs forgets it; a
 *   reload with a finished task opens the window again; nothing offered
 *   without AI or outside mode edit
 * - AK6 the preview draws n boxes and n − 1 lines, a text with markup stays
 *   text; the message of an unusable answer; the window closes on Esc
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { mindmapFromText, outlineOfTree } from '../../../src/board/actions.js'
import { SessionAi, diagramMessage } from '../../../src/board/sessionAi.js'
import { aiPreview, previewLabel } from '../../../src/components/aiPreview.js'
import { MM_MAX_BYTES, checkMindmap, estimateNodeSize, mindmapBytes, mindmapLayout, nodesOf } from '../../../src/model/mindmap.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { UndoStack } from '../../../src/board/undo.js'
import { HttpError } from '../../../src/sync/http.js'
import { modelItems } from '../../../src/board/sessionConsts.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const OWNER = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const TREE = { text: 'Holiday', children: [
	{ text: 'Sea', children: [{ text: 'Swim', children: [] }, { text: 'Sail', children: [] }] },
	{ text: 'Hills', children: [{ text: 'Walk', children: [] }] },
	{ text: 'City', children: [] },
] }

test('AK4 outlineOfTree: the centre is the root, the rest in pre-order with depths; empty texts go with their subtree', () => {
	assert.deepEqual(outlineOfTree(TREE), { root: 'Holiday', lines: [
		{ depth: 1, text: 'Sea' }, { depth: 2, text: 'Swim' }, { depth: 2, text: 'Sail' }, { depth: 1, text: 'Hills' }, { depth: 2, text: 'Walk' }, { depth: 1, text: 'City' },
	] })
	assert.deepEqual(outlineOfTree({ text: 'a', children: [{ text: ' ', children: [{ text: 'lost' }] }, { text: 'b' }] }).lines, [{ depth: 1, text: 'b' }])
	assert.equal(outlineOfTree({ text: '' }), null)
	assert.equal(outlineOfTree(null), null)
})

test('AK4 mindmapFromText with a layout and centre hull: one put, the layout, the hull centred on the point', () => {
	const model = new SceneModel()
	model.load([])
	for (const [layout, style] of [['both', {}], ['org', { layout: 'org' }], ['tree', { layout: 'tree' }]]) {
		const r = mindmapFromText(model, outlineOfTree(TREE), { at: { x: 500, y: 300 }, layout, centre: 'hull' }, () => 'X'.repeat(26))
		assert.equal(r.ops.length, 1)
		const p = r.ops[0].p
		assert.deepEqual(p.style, style, layout)
		assert.equal(nodesOf(p.data).size, 7)
		assert.ok(Math.abs(p.x + p.w / 2 - 500) <= 1 && Math.abs(p.y + p.h / 2 - 300) <= 1, layout + ': the hull is centred')
		assert.deepEqual(r.inverse, [{ o: 'remove', id: 'X'.repeat(26) }])
		assert.equal(checkMindmap(p.data), true)
	}
	// risk: 50 nodes of 200 characters stay within the mind map limits
	const big = { text: 'c'.repeat(200), children: [] }
	for (let i = 0; i < 7; i++) {
		big.children.push({ text: String(i).repeat(200), children: Array.from({ length: 6 }, (_, j) => ({ text: (i + '.' + j).padEnd(200, 'é') })) })
	}
	const r = mindmapFromText(model, outlineOfTree(big), { layout: 'org', centre: 'hull' })
	assert.equal(r.cut, 0)
	assert.equal(nodesOf(r.ops[0].p.data).size, 50)
	assert.equal(checkMindmap(r.ops[0].p.data), true)
	assert.ok(mindmapBytes({ data: r.ops[0].p.data }) <= MM_MAX_BYTES)
})

/** A board session with a fake transport (like exportCsvSession.test.mjs). */
async function open() {
	const clock = new FakeClock(10000)
	const log = []
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'B', role: 'owner', metaRev: 3, meta: {} }, me: OWNER, items: [] }
		},
		async sync(body) {
			tr.calls.push(structuredClone(body))
			return { rev: body.since, presence: {} }
		},
		async aiState() {
			return {}
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: {},
		deps: {
			SceneModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0.5, win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			ai: { aiState: async () => ({}), startAi: async () => 1, forgetAi: async () => {} },
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, log }
}

test('AK4 insertAiDiagram: one mind map in the middle of the view, selected, one undo step; undo removes it', async () => {
	const h = await open()
	const before = h.s.undoStack.done.length
	assert.equal(h.s.insertAiDiagram(TREE, 'org'), true)
	const mm = [...modelItems(h.s.model)].filter((it) => it.t === 'mindmap')
	assert.equal(mm.length, 1)
	assert.equal(mm[0].style.layout, 'org')
	assert.equal(nodesOf(mm[0].data).size, 7)
	const c = h.s.viewportCenter()
	assert.ok(Math.abs(mm[0].x + mm[0].w / 2 - c.x) <= 1 && Math.abs(mm[0].y + mm[0].h / 2 - c.y) <= 1, 'the middle of the view')
	assert.deepEqual(h.s.selection, [mm[0].id])
	assert.equal(h.s.undoStack.done.length, before + 1)
	h.s.undo()
	assert.equal([...modelItems(h.s.model)].filter((it) => it.t === 'mindmap').length, 0)
	assert.equal(h.s.insertAiDiagram({ text: '' }, 'tree'), false)
	h.s.destroy()
})

/** sessionAi on a fake host (like sessionAi.test.mjs). */
function harness({ state = {}, mode = 'edit', start = null } = {}) {
	const log = { started: [], forgot: [], inserted: [], views: [], diagrams: [] }
	let answer = { ready: true, reason: null, allowed: true, owner: true, notice: { text: null, url: '', hash: 'h', confirmed: true }, limit: { max: 30, used: 0 }, tasks: [], ...state }
	let wake = null
	const model = new SceneModel()
	model.load([])
	const s = {
		board: { id: 7, meta: {} }, boardId: 7, clientMode: mode, deps: {}, destroyed: false, frozen: false, mode: 'user', model,
		scene: {}, selection: [], sync: { poke() {} }, undoStack: new UndoStack(50), viewOnly: false,
		ui: { onAi: (v) => log.views.push(v), onAiDiagram: (v) => log.diagrams.push(v), onAiNotice: async () => true },
	}
	s.deps.ai = {
		aiState: async () => answer,
		startAi: async (id, body) => {
			log.started.push(body)
			return start ? start(body) : 41 + log.started.length - 1
		},
		forgetAi: async (id, task) => { log.forgot.push(task) },
	}
	s.deps.aiSleep = () => new Promise((resolve) => { wake = resolve })
	const host = Object.fromEntries(Object.keys(s).map((k) => [k, () => s[k]]))
	Object.assign(host, {
		emitSelection() {}, emitUndo() {}, flushVisible() {}, info() {}, toast() {}, select() {},
		boundsOf: () => null, viewportWorld: () => null, reserveTop: (r) => r, viewTop: () => 0, zoomToRect() {},
		insertAiDiagram: (tree, shape) => { log.inserted.push([tree, shape]); return true },
	})
	const ai = new SessionAi(host)
	return {
		ai, s, log,
		setAnswer: (a) => { answer = { ...answer, ...a } },
		tick: async () => { const w = wake; wake = null; w?.(); await new Promise((r) => setTimeout(r, 0)) },
		view: () => log.diagrams.at(-1),
	}
}

test('AK5 start, poll, done: the preview stays until Insert; Insert builds the mind map and forgets the task', async () => {
	const h = harness()
	await h.ai.load()
	assert.equal(h.ai.openDiagram(), true)
	assert.equal(h.view().open, true)
	assert.equal(await h.ai.runDiagram('org', '  Our team  '), true)
	assert.deepEqual(h.log.started, [{ kind: 'diagram', shape: 'org', prompt: 'Our team', acceptNotice: false }])
	assert.equal(h.view().working, true)
	assert.deepEqual(h.ai.offer([{ id: 'x', t: 'sticky', data: { text: 'a' } }]), { summarise: false, cluster: false }, 'nothing else while it runs')
	assert.equal(await h.ai.runDiagram('org', 'again'), false, 'one diagram task at a time')
	h.setAnswer({ tasks: [{ task: 41, kind: 'diagram', shape: 'org', status: 'done', at: 1, tree: TREE }] })
	await h.tick()
	assert.deepEqual([h.view().working, h.view().tree, h.view().error], [false, TREE, null])
	assert.deepEqual(h.log.forgot, [], 'kept for the preview')
	assert.equal(await h.ai.insertDiagram(), true)
	assert.deepEqual(h.log.inserted, [[TREE, 'org']])
	assert.deepEqual(h.log.forgot, [41])
	assert.equal(h.view().open, false)
	assert.equal(await h.ai.insertDiagram(), false, 'a second Insert does nothing')
})

test('AK5 Try again forgets the old result and starts anew; Cancel while running forgets the task; a failed one shows its message', async () => {
	const h = harness()
	await h.ai.load()
	h.ai.openDiagram()
	await h.ai.runDiagram('mindmap', 'Holiday')
	h.setAnswer({ tasks: [{ task: 41, kind: 'diagram', shape: 'mindmap', status: 'done', at: 1, tree: TREE }] })
	await h.tick()
	assert.equal(await h.ai.runDiagram('tree', 'Holiday'), true)
	assert.deepEqual(h.log.forgot, [41])
	assert.deepEqual([h.log.started.length, h.view().tree, h.view().shape], [2, null, 'tree'])
	h.ai.closeDiagram()
	assert.deepEqual(h.log.forgot, [41, 42])
	assert.equal(h.view().open, false)
	h.ai.openDiagram()
	await h.ai.runDiagram('mindmap', 'x')
	h.setAnswer({ tasks: [{ task: 43, kind: 'diagram', shape: 'mindmap', status: 'failed', at: 1, error: 'ai_answer' }] })
	await h.tick()
	assert.equal(h.view().error, 'The AI answer could not be used. Try again.')
	assert.equal(h.view().open, true, 'the window stays with the message')
	assert.deepEqual(h.log.forgot, [41, 42, 43])
	const g = harness({ start: () => { throw new HttpError(429, 'ai_limit', '', null, true, { error: 'ai_limit', max: 30 }) } })
	await g.ai.load()
	g.ai.openDiagram()
	assert.equal(await g.ai.runDiagram('tree', 'x'), false)
	assert.equal(g.view().error, 'You have used your 30 AI tasks for today.')
	assert.equal(await g.ai.runDiagram('tree', '   '), false, 'an empty request is not sent')
	assert.equal(await g.ai.runDiagram('tree', 'x'.repeat(1001)), false, 'too long')
	assert.equal(await g.ai.runDiagram('flow', 'x'), false, 'an unknown shape')
	assert.equal(g.log.started.length, 1)
})

test('AK5 a reload with a finished diagram task opens the window with its preview; without AI nothing opens', async () => {
	const h = harness({ state: { tasks: [{ task: 9, kind: 'diagram', shape: 'tree', status: 'done', at: 1, tree: TREE }] } })
	await h.ai.load()
	assert.deepEqual([h.view().open, h.view().shape, h.view().tree], [true, 'tree', TREE])
	const r = harness({ state: { tasks: [{ task: 9, kind: 'diagram', shape: 'org', status: 'running', at: 1 }] } })
	await r.ai.load()
	assert.deepEqual([r.view().open, r.view().working], [true, true])
	for (const over of [{ mode: 'view' }, { state: { ready: false } }, { state: { reason: 'forbidden' } }]) {
		const g = harness(over)
		await g.ai.load()
		assert.equal(g.ai.openDiagram(), false, JSON.stringify(over))
		assert.equal(g.log.views.at(-1).available, false)
	}
})

test('AK6 the preview: n boxes and n − 1 lines, markup stays text, labels are cut; the message of an unusable answer', () => {
	for (const shape of ['mindmap', 'org', 'tree']) {
		const p = aiPreview(TREE, shape)
		assert.equal(p.boxes.length, 7, shape)
		assert.equal(p.lines.length, 6, shape)
		assert.ok(p.w > 0 && p.h > 0)
		assert.equal(p.boxes.filter((b) => b.root).length, 1)
	}
	assert.match(aiPreview(TREE, 'org').lines[0], /^M[\d.-]+ [\d.-]+V[\d.-]+H[\d.-]+V[\d.-]+$/, 'org: right-angled')
	const x = aiPreview({ text: 'c', children: [{ text: '<img src=x onerror=alert(1)>' }] }, 'mindmap')
	assert.equal(x.boxes[1].label, '<img src=x onerror=aler…')
	assert.equal(previewLabel('Ann\nHead of sales'), 'Ann')
	assert.equal(aiPreview({ text: '' }, 'tree'), null)
	assert.equal(diagramMessage('ai_answer'), 'The AI answer could not be used. Try again.')
	assert.equal(diagramMessage('ai_too_much'), 'The request is too long (at most 1000 characters).')
	// the window: no HTML from the AI, Esc closes, the texts as SVG text
	const vue = readFileSync(new URL('../../../src/components/AiDiagramDialog.vue', import.meta.url), 'utf8')
	assert.doesNotMatch(vue, /v-html|innerHTML/)
	assert.match(vue, /@keydown\.esc\.stop\.prevent="\$emit\('close'\)"/)
	assert.match(vue, /fill="#191b1d">\{\{ b\.label \}\}<\/text>/)
	assert.match(vue, /role="radiogroup"/)
	assert.ok(mindmapLayout && estimateNodeSize)
})
