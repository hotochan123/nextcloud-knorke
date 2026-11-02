/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession and "Arrange" positions (job 146, SPEC-M1 §1.2 (R22)):
 * - AK2: arrange() clamps x/y to ±1e7 silently, the last selection report
 *   carries the clamped box
 * - AK3: the selection is reported again when the absolute box of a selected
 *   item changes (a move by someone else, undo, a frame moved by someone
 *   else), never for a change of an item that is not selected
 * - AK4: a `bad` answer to the own Arrange patch toasts arrange-bad once and
 *   the model and the report go back; `bad` on another patch and itemlocked
 *   on the Arrange patch never give it
 * Job 160 (a frame's child moves as far to the edge as it can):
 * - AK2: the stored (relative) x of a child is clamped to ±1e7 as well, no
 *   toast, the report carries the absolute position it ended up at
 * - AK3: `bad` from the server on the clamped patch still toasts once
 * - AK4: `bad` on an arrow-key patch right after an accepted Arrange never does
 * Job 240 (the tick "1:1"):
 * - AK6: selectionInfo().square for exactly one shape, null otherwise;
 *   arrange({square}) sends the tick and the square box in one patch, the
 *   report carries it, one undo takes both back
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { applyPatch } from '../../../src/model/paths.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, shape, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const K = ID(3)
const F = ID('F1')
const T0 = 1760100000000
const ME = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const ARRANGE_BAD = ['Position could not be set', 'arrange-bad']

/**
 * A session against a small last-writer-wins server: `codes(op)` answers each
 * op (only 'ok' is applied), every answer carries the items changed since
 * `since`; `others(list)` stores changes of someone else.
 *
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ items = [sticky(A, { x: 10, y: 20 }), sticky(B, { x: 400, y: 0 })], codes = () => 'ok' } = {}) {
	const clock = new FakeClock(10000)
	const ui = { selection: [] }
	const toasts = []
	const live = new Map(items.map((it) => [it.id, structuredClone(it)]))
	const changed = []
	let rev = 5
	const store = (it) => {
		live.set(it.id, structuredClone(it))
		changed.push([++rev, it.id])
	}
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', metaRev: 0, meta: {} }, me: ME, items: [...live.values()] }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				return {}
			}
			tr.calls.push(structuredClone(body))
			const res = (body.ops ?? []).map((op) => {
				const code = codes(op)
				if (code === 'ok' && op.o === 'patch' && live.has(op.id)) {
					const it = structuredClone(live.get(op.id))
					applyPatch(it, op.p)
					store(it)
				}
				return code
			})
			const ids = new Set(changed.filter(([r]) => r > body.since).map(([, id]) => id))
			const out = { rev, items: [...ids].map((id) => structuredClone(live.get(id))), removed: [], presence: {} }
			if (body.ops) {
				out.acks = { seq: body.seq, rev, res }
			}
			return out
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: { onSelection: (x) => ui.selection.push(x) },
		deps: {
			SceneModel: FakeModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => toasts.push(o?.hook ? [m, o.hook] : m),
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, others: (list) => list.forEach(store), scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
const opsAfter = async (h, n) => {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}
const select = (h, ids) => h.scene.callbacks.onSelection(ids)
const lastBox = (h) => h.ui.selection.at(-1).box
/** someone else's change arrives with the next sync answer */
const fromOthers = async (h, list) => {
	h.others(list)
	await h.clock.advance(2500)
}

/**
 * @param {() => Promise<void>|void} fn code that may warn (bad, unknown codes)
 * @return {Promise<string[]>} the warnings
 */
async function quiet(fn) {
	const warns = []
	const warn = console.warn
	console.warn = (...a) => warns.push(a.join(' '))
	try {
		await fn()
	} finally {
		console.warn = warn
	}
	return warns
}

test('job 146 (AK2): arrange({x: 2e7}) on a selected note sends x 1e7, without a toast; one report, with box.x 1e7; again: nothing sent, one report', async () => {
	const h = await open()
	select(h, [A])
	let reports = h.ui.selection.length
	const n = h.tr.calls.length
	h.s.arrange({ x: 2e7 })
	assert.equal(h.ui.selection.length, reports + 1, 'reported once')
	assert.equal(lastBox(h).x, 1e7)
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: A, p: { x: 1e7, y: 20, parent: null, w: 200, h: 200, r: 0 } }])
	assert.deepEqual(h.toasts, [])
	assert.equal(h.model.get(A).x, 1e7)
	assert.equal(lastBox(h).x, 1e7)
	// already at the limit: no op, but the fields get the real position again
	reports = h.ui.selection.length
	const m = h.tr.calls.length
	h.s.arrange({ x: 2e7, y: -3e7 })
	assert.equal(h.ui.selection.length, reports + 1)
	assert.deepEqual([lastBox(h).x, lastBox(h).y], [1e7, -1e7])
	const more = await opsAfter(h, m)
	assert.deepEqual(more, [{ o: 'patch', id: A, p: { x: 1e7, y: -1e7, parent: null, w: 200, h: 200, r: 0 } }], 'only y moves')
	h.s.arrange({ x: 2e7, y: -3e7 })
	assert.deepEqual(await opsAfter(h, h.tr.calls.length), [], 'nothing left to send')
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('job 146 (AK3 a, d): a move of the selected item by someone else reports the new box once; a change of an item that is not selected reports nothing', async () => {
	const h = await open()
	select(h, [A])
	await h.clock.advance(500)
	let reports = h.ui.selection.length
	await fromOthers(h, [sticky(A, { x: 500, y: 20 })])
	assert.equal(h.model.get(A).x, 500)
	assert.equal(h.ui.selection.length, reports + 1, 'one report')
	assert.deepEqual(lastBox(h), { x: 500, y: 20, w: 200, h: 200, r: 0 })
	reports = h.ui.selection.length
	await fromOthers(h, [sticky(B, { x: 900, y: 300 })])
	assert.equal(h.model.get(B).x, 900)
	assert.equal(h.ui.selection.length, reports, 'B is not selected: no report')
	await fromOthers(h, [sticky(A, { x: 500, y: 20, w: 300 }), sticky(B, { x: 0, y: 0 })])
	assert.equal(h.ui.selection.length, reports + 1, 'at most one report per flush')
	assert.equal(lastBox(h).w, 300)
	h.s.destroy()
})

test('job 146 (AK3 b): undo after the own Arrange reports the old box once', async () => {
	const h = await open()
	select(h, [A])
	h.s.arrange({ x: 300, y: 40 })
	await h.clock.advance(500)
	assert.equal(h.model.get(A).x, 300)
	const reports = h.ui.selection.length
	h.s.undo()
	assert.equal(h.ui.selection.length, reports + 1, 'one report')
	assert.deepEqual([lastBox(h).x, lastBox(h).y], [10, 20])
	await h.clock.advance(500)
	assert.equal(h.ui.selection.length, reports + 1, 'the ack changes nothing more')
	h.s.redo()
	assert.equal(h.ui.selection.length, reports + 2)
	assert.deepEqual([lastBox(h).x, lastBox(h).y], [300, 40])
	h.s.destroy()
})

test('job 146 (AK3 c): someone else moves the frame of the selected child: the child\'s new absolute box is reported once', async () => {
	const h = await open({ items: [frame(F, { x: 0, y: 0 }), sticky(K, { x: 10, y: 10, parent: F }), sticky(B, { x: 2000, y: 0 })] })
	select(h, [K])
	await h.clock.advance(500)
	const reports = h.ui.selection.length
	assert.equal(lastBox(h).x, 10)
	await fromOthers(h, [frame(F, { x: 1000, y: 50 })])
	assert.equal(h.ui.selection.length, reports + 1)
	assert.deepEqual([lastBox(h).x, lastBox(h).y], [1010, 60])
	h.s.destroy()
})

test('job 160 (AK2): a child of a frame at x −100 gets X 1e7: stored at x 1e7 (relative), the server takes it, no toast; the report shows 9999900; again: nothing sent, one report', async () => {
	// the server's rule: |x| ≤ 1e7 (relative, as stored)
	const h = await open({
		items: [frame(F, { x: -100, y: 0 }), sticky(K, { x: 50, y: 50, parent: F })],
		codes: (op) => (op.o === 'patch' && Math.abs(op.p.x ?? 0) > 1e7 ? 'bad' : 'ok'),
	})
	select(h, [K])
	assert.equal(lastBox(h).x, -50)
	let reports = h.ui.selection.length
	const n = h.tr.calls.length
	h.s.arrange({ x: 1e7 })
	assert.equal(h.ui.selection.length, reports + 1, 'reported once')
	assert.equal(lastBox(h).x, 9999900, 'shown at once where it ends up')
	let ops
	const warns = await quiet(async () => {
		ops = await opsAfter(h, n)
	})
	assert.deepEqual(ops, [{ o: 'patch', id: K, p: { x: 1e7, y: 50, parent: F, w: 200, h: 200, r: 0 } }], 'stored relative: at the limit')
	assert.deepEqual(h.toasts, [], 'no toast')
	assert.deepEqual(warns, [], 'nothing rejected')
	assert.equal(h.model.get(K).x, 1e7, 'the model keeps the stored x')
	assert.equal(h.model.get(K).parent, F, 'still in the frame')
	assert.equal(lastBox(h).x, 9999900)
	// already at the limit: nothing to send, the fields get the real position again
	reports = h.ui.selection.length
	const m = h.tr.calls.length
	h.s.arrange({ x: 1e7 })
	assert.equal(h.ui.selection.length, reports + 1, 'reported once')
	assert.equal(lastBox(h).x, 9999900)
	assert.deepEqual(await opsAfter(h, m), [], 'nothing sent')
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('job 160 (AK3): the server answers bad on every patch of the child: arrange({x: 500}) toasts arrange-bad exactly once, model and report back at the old position', async () => {
	const h = await open({
		items: [frame(F, { x: -100, y: 0 }), sticky(K, { x: 50, y: 50, parent: F })],
		codes: (op) => (op.o === 'patch' && op.id === K ? 'bad' : 'ok'),
	})
	select(h, [K])
	assert.equal(lastBox(h).x, -50)
	const n = h.tr.calls.length
	h.s.arrange({ x: 500 })
	assert.equal(lastBox(h).x, 500, 'shown at once')
	let ops
	const warns = await quiet(async () => {
		ops = await opsAfter(h, n)
	})
	assert.deepEqual(ops, [{ o: 'patch', id: K, p: { x: 600, y: 50, parent: F, w: 200, h: 200, r: 0 } }])
	assert.deepEqual(h.toasts, [ARRANGE_BAD], 'exactly one toast')
	assert.equal(warns.length, 1, 'the bad path warns as before')
	assert.equal(h.model.get(K).x, 50, 'the model is back on the confirmed state')
	assert.equal(lastBox(h).x, -50, 'and so is the report: the fields spring back')
	await h.clock.advance(3000)
	assert.deepEqual(h.toasts, [ARRANGE_BAD], 'still one')
	h.s.destroy()
})

test('job 160 (AK4): after an accepted Arrange of a note, bad on the arrow-key patch of the same note never toasts arrange-bad', async () => {
	let code = 'ok'
	const h = await open({ codes: () => code })
	select(h, [A])
	h.s.arrange({ x: 100 })
	await h.clock.advance(500)
	assert.equal(h.model.get(A).x, 100)
	assert.deepEqual(h.toasts, [])
	code = 'bad'
	const n = h.tr.calls.length
	let ops
	await quiet(async () => {
		h.s.nudge(1, 0)
		ops = await opsAfter(h, n)
	})
	assert.deepEqual(ops, [{ o: 'patch', id: A, p: { x: 101, y: 20, parent: null } }], 'the arrow-key patch went out and was refused')
	assert.deepEqual(h.toasts, [], 'no arrange-bad')
	assert.equal(h.model.get(A).x, 100, 'the model is back on the confirmed state')
	h.s.destroy()
})

test('job 146 (AK4): bad on a setStyle patch never toasts arrange-bad, nor does itemlocked on the Arrange patch (only lock-held); an unknown code counts as bad; one toast per answer', async () => {
	let code = 'ok'
	const h = await open({ codes: () => code })
	select(h, [A])
	h.s.arrange({ x: 100 })
	await h.clock.advance(500)
	assert.equal(h.model.get(A).x, 100)
	// a later style patch of the same item, rejected
	code = 'bad'
	await quiet(async () => {
		h.s.setStyle('style.fill', '#ffffff')
		await h.clock.advance(500)
	})
	assert.deepEqual(h.toasts, [], 'not from Arrange')
	// itemlocked on the Arrange patch: only the lock toast
	code = 'itemlocked'
	h.s.arrange({ x: 200 })
	await h.clock.advance(500)
	assert.deepEqual(h.toasts, [['1 locked item was not changed.', 'lock-held']])
	assert.equal(h.model.get(A).x, 100)
	// an unknown result code counts as bad
	code = 'weird'
	const n = h.tr.calls.length
	await quiet(async () => {
		h.s.arrange({ x: 300 })
		await h.clock.advance(500)
	})
	assert.deepEqual(h.toasts.slice(1), [ARRANGE_BAD])
	assert.equal(h.model.get(A).x, 100)
	// the same Arrange patch twice in one answer (a keepalive repeat): one toast
	const sent = h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])[0]
	h.s.arrange({ x: 300 })
	await quiet(() => h.s.handleFailed([{ op: structuredClone(sent), code: 'bad' }, { op: structuredClone(sent), code: 'bad' }]))
	assert.deepEqual(h.toasts.slice(1), [ARRANGE_BAD, ARRANGE_BAD], 'one more toast for the whole answer')
	h.s.destroy()
})

test('job 240 (AK6): square in the report for one shape only; ticking sends tick and square box in one patch; one undo takes both back', async () => {
	const S = ID(9)
	const h = await open({ items: [sticky(A, { x: 10, y: 20 }), shape(S, { x: 400, y: 0 }), shape(K, { x: 800, y: 0, w: 96, h: 96, data: { kind: 'bpmnStart', text: '' } })] })
	select(h, [A])
	assert.equal(h.ui.selection.at(-1).square, null, 'a note')
	select(h, [S, K])
	assert.equal(h.ui.selection.at(-1).square, null, 'two shapes')
	select(h, [K])
	assert.equal(h.ui.selection.at(-1).square, true, 'a square BPMN event without the field')
	select(h, [S])
	assert.equal(h.ui.selection.at(-1).square, false, 'a rectangle 200 × 120')
	const n = h.tr.calls.length
	h.s.arrange({ x: 400, y: 0, w: 200, h: 120, r: 0, square: true })
	assert.equal(h.ui.selection.at(-1).square, true)
	assert.deepEqual([lastBox(h).w, lastBox(h).h], [200, 200])
	assert.deepEqual(await opsAfter(h, n), [{ o: 'patch', id: S, p: { x: 400, y: 0, parent: null, w: 200, h: 200, r: 0, 'style.square': 'on' } }])
	h.s.undo()
	assert.equal(h.ui.selection.at(-1).square, false, 'undo: the tick is gone')
	assert.deepEqual([lastBox(h).w, lastBox(h).h], [200, 120], 'and the size is back')
	assert.equal(h.model.get(S).style.square, undefined)
})

test('job 240 (round 2): after an own drag or corner drag the selection is reported with the box as it ended, so the tick "1:1" keeps it', async () => {
	const S = ID(9)
	const h = await open({ items: [shape(S, { x: 400, y: 0 }), shape(K, { x: 800, y: 0, w: 96, h: 96, data: { kind: 'iconStar', text: '' } })] })
	select(h, [S])
	// a drag: the scene moves the box in the model while it moves, then the intent, then the end
	h.scene.active.add(S)
	h.model.moveLocal([S], 0, 145)
	h.scene.callbacks.onIntent({ type: 'move', ids: [S], dx: 0, dy: 145, origin: new Map([[S, { x: 400, y: 0, parent: null }]]) })
	h.scene.active.delete(S)
	h.scene.callbacks.onActivity({ kind: 'drag', active: false, ids: [S] })
	assert.deepEqual([lastBox(h).x, lastBox(h).y], [400, 145], 'the fields show where it ended')
	// the tick sends the fields as shown: the shape stays where it was dragged
	h.s.arrange({ ...lastBox(h), square: true })
	assert.deepEqual([h.model.get(S).x, h.model.get(S).y, h.model.get(S).w, h.model.get(S).h], [400, 145, 200, 200])
	// a corner drag of a symbol: the scene writes the box (like setBoxesLocal), then the intent, then the end
	select(h, [K])
	h.scene.active.add(K)
	applyPatch(h.model.get(K), { w: 156, h: 156 })
	h.scene.callbacks.onIntent({ type: 'transform', ids: [K], keep: false, before: new Map([[K, { x: 800, y: 0, w: 96, h: 96, r: 0, parent: null }]]), after: new Map([[K, { x: 800, y: 0, w: 156, h: 156, r: 0 }]]) })
	h.scene.active.delete(K)
	h.scene.callbacks.onActivity({ kind: 'transform', active: false, ids: [K] })
	assert.deepEqual([lastBox(h).w, lastBox(h).h], [156, 156])
	// unticking keeps the dragged size
	h.s.arrange({ ...lastBox(h), square: false })
	assert.deepEqual([h.model.get(K).w, h.model.get(K).h, h.model.get(K).style.square], [156, 156, 'off'])
	h.s.destroy()
})

test('job 240 (round 2): another person ticks or unticks the selected shape: the selection is reported again with the new tick', async () => {
	const h = await open({ items: [shape(K, { x: 800, y: 0, w: 64, h: 64, data: { kind: 'bpmnStart', text: '' } })] })
	select(h, [K])
	assert.equal(h.ui.selection.at(-1).square, true)
	const n = h.ui.selection.length
	await fromOthers(h, [{ ...structuredClone(h.model.get(K)), style: { ...h.model.get(K).style, square: 'off' } }])
	assert.equal(h.model.get(K).style.square, 'off')
	assert.ok(h.ui.selection.length > n, 'reported again')
	assert.equal(h.ui.selection.at(-1).square, false)
	h.s.destroy()
})
