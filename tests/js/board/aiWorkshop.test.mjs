/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 276: a workshop from a prompt.
 * - AK4 workshopPayload: frames side by side with title and minutes, a note
 *   and a pad per part with a question, reading order = the order of parts;
 *   the limits pass the paste check
 * - AK5 Insert: frames with their children in the middle of the view,
 *   selected, one undo step; a full board inserts nothing
 * - AK6 the chip, the preview (n frames, markup stays text), a reload with
 *   a finished workshop task opens its preview
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { workshopPayload as viaPart } from '../../../src/board/aiFlow.js'
import { WS_FRAME_H, WS_FRAME_W, workshopPayload } from '../../../src/board/aiWorkshop.js'
import { readingOrder } from '../../../src/board/arrangeActions.js'
import { SessionAi } from '../../../src/board/sessionAi.js'
import { slideOrder } from '../../../src/board/slides.js'
import { aiPreview } from '../../../src/components/aiPreview.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { UndoStack } from '../../../src/board/undo.js'
import { modelItems } from '../../../src/board/sessionConsts.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const OWNER = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const WS = {
	parts: [
		{ title: 'Check-in', minutes: 5, question: 'How are you arriving today?' },
		{ title: 'Gather data', minutes: null, question: 'What happened?' },
		{ title: 'Close', minutes: 10, question: '' },
	],
}

test('AK4 workshopPayload: frames side by side with title and minutes, note and pad per question, reading order = parts', () => {
	assert.equal(viaPart, workshopPayload, 'in the part aiFlow')
	let k = 0
	const p = workshopPayload(WS, () => String(++k).padStart(26, '0'))
	const frames = p.items.filter((it) => it.t === 'frame')
	assert.deepEqual(frames.map((f) => [f.x, f.y, f.w, f.h]), [[0, 0, WS_FRAME_W, WS_FRAME_H], [720, 0, 640, 880], [1440, 0, 640, 880]])
	assert.deepEqual(frames.map((f) => f.data.title), ['Check-in (5 min)', 'Gather data', 'Close (10 min)'])
	const notes = p.items.filter((it) => it.t === 'sticky')
	const pads = p.items.filter((it) => it.t === 'pad')
	assert.deepEqual(notes.map((n) => [n.parent, n.data.text, n.x, n.y]), [[frames[0].id, 'How are you arriving today?', 40, 40], [frames[1].id, 'What happened?', 40, 40]])
	assert.deepEqual(pads.map((n) => [n.parent, n.x, n.style.fill]), [[frames[0].id, 260, notes[0].style.fill], [frames[1].id, 260, notes[1].style.fill]])
	assert.notEqual(notes[0].style.fill, notes[1].style.fill)
	// the reading order (and so the slide order without a saved one) is the order of the parts
	const model = new SceneModel()
	model.load(p.items.filter((it) => it.t === 'frame').reverse())
	const ids = frames.map((f) => f.id)
	assert.deepEqual(readingOrder(model, [...ids].reverse()), ids)
	assert.deepEqual(slideOrder(undefined, frames.map((f) => ({ id: f.id, title: f.data.title })).reverse(), (x) => readingOrder(model, x)).map((f) => f.id), ids)
	// risk: 12 parts with the longest texts and markup pass the paste check; a title is cut to the frame limit
	const long = { parts: Array.from({ length: 14 }, (_, i) => ({ title: '<img src=x onerror=alert(1)>'.padEnd(198, 'é') + i, minutes: 600, question: 'q'.repeat(200) })) }
	const big = workshopPayload(long)
	assert.equal(big.items.length, 36, '12 parts: frame, note, pad')
	assert.equal([...big.items[0].data.title].length, 200)
	assert.ok(big.items[0].data.title.startsWith('<img src=x onerror=alert(1)>'), 'markup stays text')
	for (const bad of [null, {}, { parts: 'x' }, { parts: [{ title: 'only' }] }, { parts: [{ title: 'a' }, { title: '  ' }] }]) {
		assert.equal(workshopPayload(bad), null)
	}
})

/** A board session with a fake transport (like aiFlow.test.mjs). */
async function open(limits = {}) {
	const clock = new FakeClock(10000)
	const toasts = []
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
		limits,
		ui: {},
		deps: {
			SceneModel, SceneManager: FakeScene, transport: tr, storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0.5, win: null,
			toast: (m) => toasts.push(m), info: () => {},
			ai: { aiState: async () => ({}), startAi: async () => 1, forgetAi: async () => {} },
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, toasts }
}

test('AK5 insertAiDiagram workshop: frames with their notes and pads in the middle of the view, selected, one undo step; a full board inserts nothing', async () => {
	const { s } = await open()
	const four = { parts: [...WS.parts, { title: 'Actions', minutes: 15, question: 'What do we try next?' }] }
	const before = s.undoStack.done.length
	assert.equal(await s.insertAiDiagram(four, 'workshop'), true)
	const all = [...modelItems(s.model)]
	const frames = all.filter((it) => it.t === 'frame')
	assert.equal(frames.length, 4)
	const kids = all.filter((it) => it.t !== 'frame')
	assert.equal(kids.length, 6)
	assert.ok(kids.every((it) => frames.some((f) => f.id === it.parent)), 'children of their frames')
	const x0 = Math.min(...frames.map((it) => it.x))
	const x1 = Math.max(...frames.map((it) => it.x + it.w))
	const y0 = Math.min(...frames.map((it) => it.y))
	const y1 = Math.max(...frames.map((it) => it.y + it.h))
	const c = s.viewportCenter()
	assert.ok(Math.abs((x0 + x1) / 2 - c.x) <= 1 && Math.abs((y0 + y1) / 2 - c.y) <= 1, 'the middle of the view')
	assert.deepEqual(new Set(s.selection), new Set(frames.map((it) => it.id)), 'the frames selected (as a pasted template)')
	assert.equal(s.undoStack.done.length, before + 1)
	s.undo()
	assert.equal([...modelItems(s.model)].length, 0)
	assert.equal(await s.insertAiDiagram({ parts: [] }, 'workshop'), false)
	s.destroy()
	const full = await open({ maxItems: 3 })
	assert.equal(await full.s.insertAiDiagram(four, 'workshop'), false)
	assert.equal([...modelItems(full.s.model)].length, 0, 'nothing inserted on a full board')
	full.s.destroy()
})

/** sessionAi on a fake host (like aiFlow.test.mjs). */
function harness(state, insert = true) {
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
		insertAiDiagram: async (tree, shape) => { log.inserted.push([tree, shape]); return insert },
	})
	return { ai: new SessionAi(host), log, view: () => log.diagrams.at(-1) }
}

test('AK6 a reload with a finished workshop task opens its preview; Insert hands the parts over; a full board keeps the window', async () => {
	const h = harness({ tasks: [{ task: 9, kind: 'diagram', shape: 'workshop', status: 'done', at: 1, workshop: WS, tree: { text: 'not this' } }] })
	await h.ai.load()
	assert.deepEqual([h.view().open, h.view().shape, h.view().tree], [true, 'workshop', WS])
	assert.equal(await h.ai.insertDiagram(), true)
	assert.deepEqual(h.log.inserted, [[WS, 'workshop']])
	assert.deepEqual(h.log.forgot, [9])
	assert.equal(h.view().open, false)
	const keep = harness({ tasks: [{ task: 9, kind: 'diagram', shape: 'workshop', status: 'done', at: 1, workshop: WS }] }, false)
	await keep.ai.load()
	assert.equal(await keep.ai.insertDiagram(), false)
	assert.equal(keep.view().open, true, 'a full board keeps the window open')
	assert.deepEqual(keep.log.forgot, [])
	const bad = harness({ tasks: [{ task: 9, kind: 'diagram', shape: 'workshop', status: 'done', at: 1, flow: { nodes: [], edges: [] } }] })
	await bad.ai.load()
	assert.equal(bad.view().error, 'The AI answer could not be used. Try again.', 'a workshop without parts')
})

test('AK6 the chip and the preview: n frames, a note square per question; markup stays text', () => {
	const p = aiPreview(WS, 'workshop')
	assert.equal(p.frames, 3)
	assert.deepEqual(p.boxes.filter((b) => b.key.startsWith('f')).map((b) => b.label), ['Check-in (5 min)', 'Gather data', 'Close (10 min)'])
	assert.equal(p.boxes.filter((b) => b.key.startsWith('n')).length, 2)
	assert.deepEqual(p.lines, [])
	const many = aiPreview({ parts: Array.from({ length: 9 }, (_, i) => ({ title: 'P' + i, minutes: 5, question: '' })) }, 'workshop')
	assert.equal(many.frames, 9)
	assert.ok(many.boxes[4].y > many.boxes[3].y && many.boxes[4].x === 0, 'rows of four, in order')
	assert.ok(many.boxes.every((b) => b.x + b.w <= many.w && b.y + b.h <= many.h))
	const x = aiPreview({ parts: [{ title: '<b>a</b>', question: '<i>x</i>' }, { title: 'b' }] }, 'workshop')
	assert.equal(x.boxes[0].label, '<b>a</b>')
	assert.equal(aiPreview({ parts: [] }, 'workshop'), null)
	const vue = readFileSync(new URL('../../../src/components/AiDiagramDialog.vue', import.meta.url), 'utf8')
	assert.match(vue, /\{ id: 'flowchart', label: t\('knorke', 'Flowchart'\) \},\n\t\{ id: 'workshop', label: t\('knorke', 'Workshop'\) \},\n\]/, 'the fifth chip, after the flowchart (arrow keys go round)')
	assert.match(vue, /'Preview: %n frame', 'Preview: %n frames', preview\.frames/)
	assert.doesNotMatch(vue, /v-html|innerHTML/)
})
