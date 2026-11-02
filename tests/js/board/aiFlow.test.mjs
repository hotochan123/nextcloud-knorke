/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 269: a flowchart from a prompt.
 * - AK4 flowLayout: rows top to bottom without overlap, back arrows found,
 *   kinds and sizes by type, deterministic; a cycle without a source and
 *   the limits end
 * - AK5 Insert: shapes and bound elbow connectors with their labels, the
 *   hull in the middle of the view, selected, one undo step
 * - AK6 the chip, the preview (n boxes, m lines, markup stays text), a
 *   reload with a finished flowchart task opens its preview
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { FLOW_SHAPES, GAP_Y, flowLayout, flowPayload } from '../../../src/board/aiFlow.js'
import { SessionAi } from '../../../src/board/sessionAi.js'
import { aiPreview } from '../../../src/components/aiPreview.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { UndoStack } from '../../../src/board/undo.js'
import { modelItems } from '../../../src/board/sessionConsts.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const OWNER = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
// start → order → arrived? → yes: eat; no: wait → back to arrived?
const FLOW = {
	nodes: [
		{ type: 'start', text: 'Hungry' }, { type: 'step', text: 'Order' }, { type: 'decision', text: 'Arrived?' },
		{ type: 'end', text: 'Eat' }, { type: 'step', text: 'Wait' },
	],
	edges: [
		{ from: 0, to: 1, label: '' }, { from: 1, to: 2, label: '' }, { from: 2, to: 3, label: 'yes' },
		{ from: 2, to: 4, label: 'no' }, { from: 4, to: 2, label: '' },
	],
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('AK4 flowLayout: rows from top to bottom, no overlap, the back arrow found, kinds and sizes by type, deterministic', () => {
	const l = flowLayout(FLOW)
	assert.deepEqual(l.nodes.map((nd) => nd.layer), [0, 1, 2, 3, 3])
	assert.deepEqual(l.nodes.map((nd) => nd.kind), ['terminal', 'rect', 'diamond', 'terminal', 'rect'])
	assert.deepEqual(l.nodes.map((nd) => [nd.w, nd.h]), [[160, 60], [180, 80], [180, 110], [160, 60], [180, 80]])
	assert.deepEqual(l.edges.map((e) => e.back), [false, false, false, false, true])
	for (let i = 1; i < 4; i++) {
		assert.ok(l.nodes[i].y >= l.nodes[i - 1].y + l.nodes[i - 1].h + GAP_Y, 'each row below the one before')
	}
	for (let i = 0; i < l.nodes.length; i++) {
		for (let j = i + 1; j < l.nodes.length; j++) assert.ok(!overlap(l.nodes[i], l.nodes[j]), i + '/' + j)
	}
	assert.equal(l.nodes[3].y, l.nodes[4].y, 'one row, top-aligned')
	assert.ok(Math.abs(l.nodes[0].x + l.nodes[0].w / 2) < 1e-9, 'a row is centred on x = 0')
	assert.deepEqual(flowLayout(FLOW), l, 'deterministic')
	assert.equal(FLOW_SHAPES.document.kind, 'document')
	assert.equal(FLOW_SHAPES.data.kind, 'parallelogram')
	// an unknown type is a step
	assert.equal(flowLayout({ nodes: [{ type: 'loop', text: 'a' }, { type: 'end', text: 'b' }], edges: [{ from: 0, to: 1 }] }).nodes[0].kind, 'rect')
})

test('AK4 risk: a cycle without a source, the limits and broken input end', () => {
	const ring = flowLayout({ nodes: [{ type: 'step', text: 'a' }, { type: 'step', text: 'b' }, { type: 'step', text: 'c' }], edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0 }] })
	assert.deepEqual(ring.nodes.map((nd) => nd.layer), [0, 1, 2])
	assert.deepEqual(ring.edges.map((e) => e.back), [false, false, true])
	const nodes = Array.from({ length: 60 }, (_, i) => ({ type: 'step', text: 'n' + i }))
	const edges = []
	for (let i = 0; i < 50; i++) for (let k = 1; k <= 3; k++) edges.push({ from: i, to: (i * 7 + k * 13) % 50 })
	const big = flowLayout({ nodes, edges })
	assert.equal(big.nodes.length, 50)
	assert.ok(big.edges.length <= 100)
	for (let i = 0; i < big.nodes.length; i++) {
		for (let j = i + 1; j < big.nodes.length; j++) assert.ok(!overlap(big.nodes[i], big.nodes[j]))
	}
	for (const bad of [null, {}, { nodes: [], edges: [] }, { nodes: FLOW.nodes, edges: [] }, { nodes: FLOW.nodes, edges: [{ from: 0, to: 0 }, { from: 0, to: 9 }, { from: '0', to: 1 }] }]) {
		assert.equal(flowLayout(bad), null, JSON.stringify(bad))
	}
})

test('AK5 flowPayload: one shape per node, one bound elbow connector per arrow with its label; the limits pass the paste check', () => {
	let k = 0
	const p = flowPayload(FLOW, () => String(++k).padStart(26, '0'))
	const shapes = p.items.filter((it) => it.t === 'shape')
	const conns = p.items.filter((it) => it.t === 'connector')
	assert.equal(shapes.length, 5)
	assert.equal(conns.length, 5)
	assert.deepEqual(shapes.map((s) => s.data.kind), ['terminal', 'rect', 'diamond', 'terminal', 'rect'])
	assert.deepEqual(shapes.map((s) => s.data.text), ['Hungry', 'Order', 'Arrived?', 'Eat', 'Wait'])
	assert.ok(conns.every((c) => c.data.route === 'elbow' && c.style.endCap === 'triangle'))
	assert.deepEqual(conns.map((c) => c.data.label ?? null), [null, null, 'yes', 'no', null])
	assert.deepEqual(conns[0].data.start, { item: shapes[0].id, ax: 0.5, ay: 1 })
	assert.deepEqual(conns[0].data.end, { item: shapes[1].id, ax: 0.5, ay: 0 })
	assert.deepEqual([conns[4].data.start, conns[4].data.end], [{ item: shapes[4].id, ax: 1, ay: 0.5 }, { item: shapes[2].id, ax: 1, ay: 0.5 }], 'a back arrow: right to right')
	// risk: 50 nodes of 200 characters with markup and 100 labelled arrows
	const text = '<img src=x onerror=alert(1)>'.padEnd(200, 'é')
	const nodes = Array.from({ length: 50 }, (_, i) => ({ type: ['start', 'step', 'decision', 'document', 'data', 'end'][i % 6], text }))
	const edges = []
	for (let i = 0; i < 50; i++) edges.push({ from: i, to: (i + 1) % 50, label: 'l'.repeat(50) }, { from: i, to: (i + 2) % 50, label: 'm'.repeat(50) })
	const big = flowPayload({ nodes, edges: edges.slice(0, 100) })
	assert.equal(big.items.length, 150)
	assert.equal(big.items[0].data.text, text, 'markup stays text')
	assert.equal(flowPayload({ nodes: [], edges: [] }), null)
})

/** A board session with a fake transport (like aiDiagram.test.mjs). */
async function open() {
	const clock = new FakeClock(10000)
	const tr = {
		kind: 'user',
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'B', role: 'owner', metaRev: 3, meta: {} }, me: OWNER, items: [] }
		},
		async sync(body) {
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
			toast: () => {}, info: () => {},
			ai: { aiState: async () => ({}), startAi: async () => 1, forgetAi: async () => {} },
		},
	})
	await s.open()
	await clock.advance(0)
	return s
}

test('AK5 insertAiDiagram flowchart: shapes and connectors in the middle of the view, selected, one undo step; undo removes all', async () => {
	const s = await open()
	const before = s.undoStack.done.length
	assert.equal(await s.insertAiDiagram(FLOW, 'flowchart'), true)
	const all = [...modelItems(s.model)]
	const shapes = all.filter((it) => it.t === 'shape')
	const conns = all.filter((it) => it.t === 'connector')
	assert.equal(shapes.length, 5)
	assert.equal(conns.length, 5)
	const ids = new Set(shapes.map((it) => it.id))
	assert.ok(conns.every((c) => ids.has(c.data.start.item) && ids.has(c.data.end.item)), 'bound to the new shapes')
	assert.deepEqual(conns.map((c) => c.data.label ?? '').sort(), ['', '', '', 'no', 'yes'])
	const x0 = Math.min(...shapes.map((it) => it.x))
	const x1 = Math.max(...shapes.map((it) => it.x + it.w))
	const y0 = Math.min(...shapes.map((it) => it.y))
	const y1 = Math.max(...shapes.map((it) => it.y + it.h))
	const c = s.viewportCenter()
	assert.ok(Math.abs((x0 + x1) / 2 - c.x) <= 1 && Math.abs((y0 + y1) / 2 - c.y) <= 1, 'the middle of the view')
	assert.deepEqual(new Set(s.selection), new Set(all.map((it) => it.id)))
	assert.equal(s.undoStack.done.length, before + 1)
	s.undo()
	assert.equal([...modelItems(s.model)].length, 0)
	assert.equal(await s.insertAiDiagram({ nodes: [], edges: [] }, 'flowchart'), false)
	s.destroy()
})

/** sessionAi on a fake host (like aiDiagram.test.mjs). */
function harness(state) {
	const log = { inserted: [], forgot: [], diagrams: [] }
	const model = new SceneModel()
	model.load([])
	const s = {
		board: { id: 7, meta: {} }, boardId: 7, clientMode: 'edit', deps: {}, destroyed: false, frozen: false, mode: 'user', model,
		scene: {}, selection: [], sync: { poke() {} }, undoStack: new UndoStack(50), viewOnly: false,
		ui: { onAi() {}, onAiDiagram: (v) => log.diagrams.push(v), onAiNotice: async () => true },
	}
	s.deps.ai = {
		aiState: async () => ({ ready: true, reason: null, allowed: true, owner: true, notice: { text: null, url: '', hash: 'h', confirmed: true }, limit: { max: 30, used: 0 }, ...state }),
		startAi: async () => 41,
		forgetAi: async (id, task) => { log.forgot.push(task) },
	}
	s.deps.aiSleep = () => new Promise(() => {})
	const host = Object.fromEntries(Object.keys(s).map((k) => [k, () => s[k]]))
	Object.assign(host, {
		emitSelection() {}, emitUndo() {}, flushVisible() {}, info() {}, toast() {}, select() {},
		boundsOf: () => null, viewportWorld: () => null, reserveTop: (r) => r, viewTop: () => 0, zoomToRect() {},
		insertAiDiagram: async (tree, shape) => { log.inserted.push([tree, shape]); return true },
	})
	return { ai: new SessionAi(host), log, view: () => log.diagrams.at(-1) }
}

test('AK6 a reload with a finished flowchart task opens its preview; Insert hands the flow over once', async () => {
	const h = harness({ tasks: [{ task: 9, kind: 'diagram', shape: 'flowchart', status: 'done', at: 1, flow: FLOW, tree: { text: 'not this' } }] })
	await h.ai.load()
	assert.deepEqual([h.view().open, h.view().shape, h.view().tree], [true, 'flowchart', FLOW])
	const first = h.ai.insertDiagram()
	assert.equal(await h.ai.insertDiagram(), false, 'one insert at a time')
	assert.equal(await first, true)
	assert.deepEqual(h.log.inserted, [[FLOW, 'flowchart']])
	assert.deepEqual(h.log.forgot, [9])
	assert.equal(h.view().open, false)
	const bad = harness({ tasks: [{ task: 9, kind: 'diagram', shape: 'flowchart', status: 'done', at: 1, tree: { text: 'a', children: [] } }] })
	await bad.ai.load()
	assert.equal(bad.view().error, 'The AI answer could not be used. Try again.', 'a flowchart without flow')
})

test('AK6 the chip and the preview: n boxes, m lines with tips, labels; markup stays text', () => {
	const p = aiPreview(FLOW, 'flowchart')
	assert.equal(p.boxes.length, 5)
	assert.equal(p.lines.length, 5)
	assert.equal(p.arrows, true)
	assert.deepEqual(p.labels.map((lb) => lb.text), ['yes', 'no'])
	assert.ok(p.boxes.every((b) => typeof b.d === 'string' && b.x >= 0))
	assert.match(p.boxes[2].d, /^M[\d.]+ [\d.]+L/, 'a diamond')
	assert.match(p.lines[0], /^M[\d.]+ [\d.]+V[\d.]+H[\d.]+V[\d.]+$/, 'right-angled')
	assert.match(p.lines[4], /^M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+$/, 'a back arrow around the right')
	assert.ok(p.w > Math.max(...p.boxes.map((b) => b.x + b.w)), 'room for the back arrow')
	const x = aiPreview({ nodes: [{ type: 'step', text: '<b>a</b>' }, { type: 'end', text: 'b' }], edges: [{ from: 0, to: 1, label: '<i>x</i>' }] }, 'flowchart')
	assert.deepEqual([x.boxes[0].label, x.labels[0].text], ['<b>a</b>', '<i>x</i>'])
	assert.equal(aiPreview({ nodes: [] }, 'flowchart'), null)
	const vue = readFileSync(new URL('../../../src/components/AiDiagramDialog.vue', import.meta.url), 'utf8')
	assert.match(vue, /\{ id: 'flowchart', label: t\('knorke', 'Flowchart'\) \}/)
	assert.match(vue, /fill="#5b5f63">\{\{ lb\.text \}\}<\/text>/)
	assert.doesNotMatch(vue, /v-html|innerHTML/)
})
