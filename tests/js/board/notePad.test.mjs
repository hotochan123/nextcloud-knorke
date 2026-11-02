/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 188, note pads, the board side:
 * - AK3 actions.takeNote: with at one put of a sticky in the pad's size and
 *   colour, its parent the frame under its centre, the pad without an op
 *   (locked too); with at null right of the pad, SERIES_GAP beyond its
 *   sheets, flush with its top, past every item in the way, in the pad's
 *   frame when it fits
 * - AK4 BoardSession with fakes: takeNote is one commit, the note selected
 *   and its editor opened (Enter: panned into view first); closed empty it
 *   stays; undo removes it with its text, redo brings it back; no op in
 *   modes vote and view, for the role view and on a frozen board; a click
 *   with the note tool's type pad creates a pad in one undo step, then the
 *   type is sticky again
 * - AK7 a pad keeps title, colour, size and frame through copyPayload →
 *   validatePayload → pasteItems and through boardFileData
 * Factory job 193 (AK1–AK3): createItem of a pad has edit true; pad-here and
 * a click with the type pad select the new pad, bring its band into view
 * (revealTitle) and open its title editor; the title merges with the
 * creation into one undo step; closed empty the pad stays untitled.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { SERIES_GAP, copyPayload, createItem, pasteItems, takeNote } from '../../../src/board/actions.js'
import { boardFileData } from '../../../src/board/boardFile.js'
import { validatePayload } from '../../../src/board/clipboard.js'
import { PAD_SHEETS_REACH } from '../../../src/model/pad.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, shape, sticky } from './fakes.mjs'

const P = ID('P1')
const F = ID('F1')
const NEW = ID('N1')
const T0 = 1760100000000

/**
 * @param {string} id item id
 * @param {object} [extra] fields
 * @return {object} pad WireItem
 */
const pad = (id, extra = {}) => ({ id, t: 'pad', x: 100, y: 100, w: 200, h: 200, r: 0, z: 'i3', parent: null, data: { title: 'Ideen' }, style: { fill: '#f5d76e' }, ...extra })

/**
 * @param {object[]} items WireItems
 * @return {SceneModel} a loaded scene model
 */
function modelOf(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

/**
 * @param {object} put put op (parent null)
 * @return {[number, number, number, number]} its box
 */
const boxOf = (put) => [put.p.x, put.p.y, put.p.w, put.p.h]

describe('job 188 AK3: actions.takeNote', () => {
	test('with at: one put of a sticky at the corner, w × h and fill of the pad, empty text, r 0, on top; the pad gets no op; inverse its remove; edit true', () => {
		const m = modelOf([pad(P, { w: 240, h: 180, z: 'i5' }), sticky(ID(1), { x: 2000, y: 0, z: 'i7' })])
		const r = takeNote(m, P, { at: { x: 500.123, y: 60 } }, () => NEW)
		assert.equal(r.ops.length, 1)
		const put = r.ops[0]
		assert.equal(put.o, 'put')
		assert.equal(put.t, 'sticky')
		assert.equal(put.id, NEW)
		const { z, ...p } = put.p
		assert.deepEqual(p, { x: 500.12, y: 60, w: 240, h: 180, r: 0, parent: null, data: { text: '' }, style: { fill: '#f5d76e', fontSize: 22 } }, 'job 227: text size M')
		assert.ok(isValidKey(z) && z > 'i7', 'on top of the content layer')
		assert.ok(r.ops.every((op) => op.id !== P), 'no op on the pad')
		assert.deepEqual(r.inverse, [{ o: 'remove', id: NEW }])
		assert.deepEqual(r.selectIds, [NEW])
		assert.equal(r.edit, true, 'the note\'s editor opens')
	})

	test('with at: the parent is the frame under the note\'s centre (none outside a frame), not the pad\'s', () => {
		const m = modelOf([frame(F, { x: 1000, y: 0, w: 800, h: 600 }), pad(P, { x: 40, y: 40 })])
		const inside = takeNote(m, P, { at: { x: 1100, y: 100 } }, () => NEW).ops[0]
		assert.equal(inside.p.parent, F)
		assert.deepEqual([inside.p.x, inside.p.y], [100, 100], 'relative to the frame')
		const m2 = modelOf([frame(F, { x: 0, y: 0, w: 800, h: 600 }), pad(P, { x: 40, y: 40, parent: F })])
		const out = takeNote(m2, P, { at: { x: 1000, y: 100 } }, () => NEW).ops[0]
		assert.equal(out.p.parent, null, 'dragged out of the pad\'s frame')
		assert.deepEqual([out.p.x, out.p.y], [1000, 100])
	})

	test('a locked pad gives notes all the same, and gets no op either; the pad\'s invalid fill gives the default', () => {
		const m = modelOf([pad(P, { lock: { by: 'pidcarol00000001', name: 'Carol' }, style: { fill: 'red' } })])
		const r = takeNote(m, P, { at: { x: 0, y: 0 } }, () => NEW)
		assert.equal(r.ops.length, 1)
		assert.equal(r.ops[0].t, 'sticky')
		assert.deepEqual(r.ops[0].p.style, { fill: '#a2d9fe', fontSize: 22 }, 'fieldValue: the default note fill')
		assert.ok(!r.ops.some((op) => op.id === P))
	})

	test('with at null: right of the pad, SERIES_GAP beyond its sheets (job 263: x + w + 0), flush with its top', () => {
		const m = modelOf([pad(P)])
		const put = takeNote(m, P, { at: null }, () => NEW).ops[0]
		assert.equal(PAD_SHEETS_REACH, 0, 'job 263: the sheets lie straight below')
		assert.deepEqual(boxOf(put), [100 + 200 + PAD_SHEETS_REACH + SERIES_GAP, 100, 200, 200])
		assert.equal(put.p.parent, null)
		assert.deepEqual(takeNote(m, P, {}, () => NEW).ops[0].p.x, 320, 'no at: the same')
	})

	test('with at null: it moves on past every item in its way and covers none (another pad with its sheets too); frames and connectors do not count', () => {
		const m = modelOf([
			pad(P),
			sticky(ID(1), { x: 330, y: 150, w: 100, h: 100, z: 'i4' }),
			shape(ID(2), { x: 450, y: 0, w: 100, h: 120, z: 'i5' }),
			// another pad whose sheets (job 263: y −200 … 112 at x 570–770) lie in the way
			pad(ID(3), { x: 570, y: -200, w: 200, h: 300, z: 'i6' }),
			frame(ID(4), { x: 0, y: 0, w: 3000, h: 3000, z: 'a0' }),
		])
		const put = takeNote(m, P, { at: null }, () => NEW).ops[0]
		const [x, y, w, h] = boxOf(put)
		assert.equal(y, 100, 'flush with the pad\'s top')
		assert.equal(x, 570 + 200 + PAD_SHEETS_REACH + SERIES_GAP, 'beyond the sheets of the other pad')
		for (const id of [ID(1), ID(2)]) {
			const a = m.abs(id)
			assert.ok(x >= a.x + a.w || x + w <= a.x || y >= a.y + a.h || y + h <= a.y, 'covers no ' + id)
		}
	})

	test('with at null: the pad\'s frame when the note fits completely, else the frame under its centre (none)', () => {
		const fits = modelOf([frame(F, { x: 0, y: 0, w: 1000, h: 600 }), pad(P, { x: 40, y: 40, parent: F })])
		const a = takeNote(fits, P, { at: null }, () => NEW).ops[0]
		assert.equal(a.p.parent, F)
		assert.deepEqual([a.p.x, a.p.y], [40 + 200 + PAD_SHEETS_REACH + SERIES_GAP, 40], 'relative to the frame')
		const tight = modelOf([frame(F, { x: 0, y: 0, w: 300, h: 600 }), pad(P, { x: 40, y: 40, parent: F })])
		const b = takeNote(tight, P, { at: null }, () => NEW).ops[0]
		assert.equal(b.p.parent, null, 'does not fit: the frame under its centre, none here')
		assert.deepEqual([b.p.x, b.p.y], [260, 40])
	})

	test('nothing for anything but a pad of the model, or an invalid at', () => {
		const m = modelOf([pad(P), sticky(ID(1))])
		for (const [id, at] of [[ID(1), null], [ID(9), null], [P, { x: NaN, y: 0 }], [P, { x: 1 }]]) {
			assert.deepEqual(takeNote(m, id, { at }, () => NEW), { ops: [], inverse: [], selectIds: [], edit: false }, String(id))
		}
	})

	test('createItem of a pad: one put, 200 × 200 centred on the point, empty title, default fill, child of the frame there; (job 193) edit true', () => {
		const m = modelOf([frame(F, { x: 0, y: 0, w: 800, h: 600 })])
		const r = createItem(m, { t: 'pad', at: { x: 300, y: 300 } }, () => NEW)
		assert.equal(r.edit, true, 'job 193: its title editor opens, like a frame\'s')
		assert.equal(r.ops.length, 1)
		const { z, ...p } = r.ops[0].p
		assert.deepEqual(p, { x: 200, y: 200, w: 200, h: 200, r: 0, parent: F, data: { title: '' }, style: { fill: '#a2d9fe' } })
		assert.equal(createItem(m, { t: 'sticky', at: { x: 0, y: 0 } }, () => NEW).edit, true, 'a note still opens its editor')
		assert.deepEqual(createItem(m, { t: 'connector', at: { x: 0, y: 0 } }, () => NEW), { ops: [], inverse: [], selectIds: [], edit: false }, 'a connector is no box item')
	})
})

describe('job 188 AK7: a pad travels like other items', () => {
	test('copyPayload → validatePayload → pasteItems: title, colour, size and frame stay (the frame pasted with it)', () => {
		const m = modelOf([frame(F, { x: 0, y: 0, w: 800, h: 600 }), pad(P, { x: 260, y: 40, w: 180, h: 160, parent: F })])
		const payload = JSON.parse(JSON.stringify(copyPayload(m, [F])))
		const v = validatePayload(payload)
		assert.equal(v.ok, true)
		assert.equal(v.skipped, 0)
		let n = 0
		const r = pasteItems(new FakeModel([]), v.payload, { at: { x: 0, y: 0 } }, () => ID('X' + ++n))
		const f = r.ops.find((op) => op.t === 'frame')
		const p = r.ops.find((op) => op.t === 'pad')
		assert.ok(f && p)
		assert.equal(p.p.parent, f.id, 'in the new frame')
		assert.deepEqual([p.p.x, p.p.y, p.p.w, p.p.h], [260, 40, 180, 160])
		assert.deepEqual(p.p.data, { title: 'Ideen' })
		assert.deepEqual(p.p.style, { fill: '#f5d76e' })
	})

	test('boardFileData: the pad with its title, colour, size and frame, and back through validatePayload', () => {
		const m = modelOf([frame(F, { x: 0, y: 0, w: 800, h: 600 }), pad(P, { x: 260, y: 40, parent: F })])
		const data = JSON.parse(JSON.stringify(boardFileData(m, 'Board')))
		const it = data.items.find((x) => x.t === 'pad')
		assert.deepEqual([it.x, it.y, it.w, it.h, it.parent], [260, 40, 200, 200, F])
		assert.deepEqual([it.data, it.style], [{ title: 'Ideen' }, { fill: '#f5d76e' }])
		const v = validatePayload(data, { maxItems: Infinity })
		assert.equal(v.ok, true)
		assert.equal(v.skipped, 0)
		assert.deepEqual(v.payload.items.find((x) => x.t === 'pad'), { id: P, t: 'pad', x: 260, y: 40, w: 200, h: 200, r: 0, parent: F, data: { title: 'Ideen' }, style: { fill: '#f5d76e' }, group: null })
	})
})

// ---------------------------------------------------------------- AK4: the session

const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const VOTER = { pid: 'pidvoter00000001', name: 'Volker', role: 'vote', guest: false, mod: false, source: 'share' }
const voteMeta = () => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false })

/** Scene fake with setMode and the world point of a screen point as the identity. */
class PadScene extends FakeScene {
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
 * LWW server of the test (as in templateSession.test.mjs): applies ops and
 * answers with every item changed since the request's cursor.
 *
 * @param {object[]} items WireItems
 * @return {object} server
 */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) return 'dup'
			if (srv.dead.has(op.id) && op.revive !== true) return 'gone'
			srv.live.set(op.id, itemFromPut(op))
			srv.dead.delete(op.id)
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) return 'gone'
			applyPatch(it, structuredClone(op.p))
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) return 'gone'
			srv.live.delete(op.id)
			srv.dead.add(op.id)
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
 * @param {object} [o] items, me, meta, viewOnly (a device without a fine pointer)
 * @return {Promise<object>} harness
 */
async function open({ items = [], me = ALICE, meta = {}, viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	const ui = { toolOptions: [], tool: [], menu: [] }
	const srv = lwwServer(items)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items: structuredClone(items) }
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
		ui: {
			onToolOptions: (x) => ui.toolOptions.push(x),
			onTool: (x) => ui.tool.push(x),
			onContextMenu: (m) => ui.menu.push(m),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: PadScene,
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
	/** @param {number} [from] first request @return {Promise<object[]>} the ops sent since */
	const opsSince = async (from = 0) => {
		await clock.advance(200)
		return tr.calls.slice(from).flatMap((b) => b.ops ?? [])
	}
	return { s, clock, tr, ui, scene: s.scene, model: s.model, opsSince }
}

describe('job 188 AK4: the session', () => {
	test('takeNote with at: one commit (one undo step) of a sticky put, the pad without an op; only the note selected, its editor opened', async () => {
		const h = await open({ items: [pad(P)] })
		const n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'takeNote', id: P, at: { x: 600, y: 120 } })
		const ops = await h.opsSince(n)
		assert.equal(ops.length, 1)
		assert.equal(ops[0].o, 'put')
		assert.equal(ops[0].t, 'sticky')
		assert.deepEqual([ops[0].p.x, ops[0].p.y, ops[0].p.w, ops[0].p.h, ops[0].p.style.fill], [600, 120, 200, 200, '#f5d76e'])
		const id = ops[0].id
		assert.equal(h.s.undoStack.done.length, 1)
		assert.equal(h.s.undoStack.done[0].mergeKey, 'new:' + id)
		assert.deepEqual(h.s.selection, [id])
		assert.deepEqual(h.scene.selection, [id])
		assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1), ['openTextEditor', id, {}])
		assert.equal(h.scene.callsOf('panIntoView').length, 0, 'a drag drops it in view')
		assert.deepEqual(h.model.get(P), pad(P), 'the pad unchanged')
		h.s.destroy()
	})

	test('takeNote with at null (Enter): right of the pad, panned into view before its editor opens; a locked pad too', async () => {
		const h = await open({ items: [pad(P, { lock: { by: 'pidcarol00000001', name: 'Carol' } })] })
		const n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'takeNote', id: P, at: null })
		const ops = await h.opsSince(n)
		assert.equal(ops.length, 1)
		assert.deepEqual([ops[0].p.x, ops[0].p.y], [100 + 200 + PAD_SHEETS_REACH + SERIES_GAP, 100])
		const order = h.scene.calls.map((c) => c[0]).filter((c) => c === 'panIntoView' || c === 'openTextEditor')
		assert.deepEqual(order.slice(-2), ['panIntoView', 'openTextEditor'])
		assert.deepEqual(h.scene.callsOf('panIntoView').at(-1), ['panIntoView', ops[0].id])
		h.s.destroy()
	})

	test('closed empty it stays; its first text merges with it: undo removes it with its text, redo brings both back', async () => {
		const h = await open({ items: [pad(P)] })
		h.scene.callbacks.onIntent({ type: 'takeNote', id: P, at: { x: 600, y: 120 } })
		const id = (await h.opsSince(0)).find((op) => op.o === 'put').id
		// opened and closed empty: no text op, the note stays
		h.scene.callbacks.onEditing(id, false)
		h.scene.callbacks.onEditing(null, false)
		let n = h.tr.calls.length
		assert.deepEqual(await h.opsSince(n), [], 'no remove of an empty note')
		assert.ok(h.model.has(id))
		// a second take, written into: one undo step
		h.scene.callbacks.onIntent({ type: 'takeNote', id: P, at: { x: 900, y: 120 } })
		n = h.tr.calls.length
		const id2 = h.s.selection[0]
		h.scene.callbacks.onEditing(id2, false)
		h.scene.callbacks.onIntent({ type: 'text', id: id2, path: 'data.text', value: 'Idee', before: '', final: true })
		h.scene.callbacks.onEditing(null, false)
		await h.opsSince(n)
		assert.equal(h.model.get(id2).data.text, 'Idee')
		assert.equal(h.s.undoStack.done.length, 2, 'creating and the first text: one step')
		n = h.tr.calls.length
		h.s.undo()
		const undone = await h.opsSince(n)
		assert.deepEqual(undone.map((op) => [op.o, op.id]), [['remove', id2]])
		assert.ok(!h.model.has(id2))
		assert.ok(h.model.has(P) && h.model.has(id), 'the pad and the first note stay')
		n = h.tr.calls.length
		h.s.redo()
		const redone = await h.opsSince(n)
		assert.ok(redone.some((op) => op.id === id2))
		assert.equal(h.model.get(id2).data.text, 'Idee', 'back with its text')
		h.s.destroy()
	})

	test('no op in mode vote, in mode view (a device without a fine pointer), for the role view and on a frozen board', async () => {
		const vote = await open({ items: [pad(P)], me: VOTER, meta: { vote: voteMeta() } })
		assert.equal(vote.s.uiMode(), 'vote')
		const view = await open({ items: [pad(P)], viewOnly: true })
		assert.equal(view.s.uiMode(), 'view')
		const viewer = await open({ items: [pad(P)], me: VIEWER })
		const frozen = await open({ items: [pad(P)] })
		frozen.s.onStatus('gone')
		for (const h of [vote, view, viewer, frozen]) {
			const n = h.tr.calls.length
			h.scene.callbacks.onIntent({ type: 'takeNote', id: P, at: { x: 600, y: 120 } })
			h.scene.callbacks.onIntent({ type: 'takeNote', id: P, at: null })
			assert.deepEqual(await h.opsSince(n), [])
			assert.equal(h.s.undoStack.done.length, 0)
			assert.equal(h.model.size, 1)
			h.s.destroy()
		}
	})

	test('pad-here: a pad with its centre at W, one undo step; (job 193) selected, band into view, then its title editor, which keeps the focus; the type stays sticky', async () => {
		const h = await open({ items: [frame(F, { x: 0, y: 0, w: 800, h: 600 })] })
		h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [300, 250] })
		assert.equal(h.ui.menu.at(-1)?.id, null, 'the board menu (its entries: menuEntries, tests/js/shell/contextMenu.test.mjs)')
		const n = h.tr.calls.length
		const focus = h.scene.callsOf('focusCanvas').length
		const from = h.scene.calls.length
		assert.equal(h.s.menuAction('pad-here'), true)
		const ops = await h.opsSince(n)
		assert.equal(ops.length, 1)
		assert.equal(ops[0].t, 'pad')
		const id = ops[0].id
		const { z, ...p } = ops[0].p
		assert.deepEqual(p, { x: 200, y: 150, w: 200, h: 200, r: 0, parent: F, data: { title: '' }, style: { fill: '#a2d9fe' } })
		assert.equal(h.s.undoStack.done.length, 1)
		assert.deepEqual(h.s.selection, [id])
		const order = h.scene.calls.slice(from).filter((c) => ['setSelection', 'revealTitle', 'openTextEditor'].includes(c[0])).map((c) => c.slice(0, 3))
		assert.deepEqual(order, [['setSelection', [id]], ['revealTitle', id, 0], ['openTextEditor', id, {}]], 'selected, band into view, then the title editor')
		assert.equal(h.scene.callsOf('focusCanvas').length, focus, 'the canvas does not take the focus from the editor')
		assert.equal(h.s.getToolOptions('sticky').type ?? 'sticky', 'sticky')
		h.s.destroy()
	})

	test('job 193: the title written into a new pad merges with its creation: undo removes the pad with its title, redo brings both back', async () => {
		const h = await open({ items: [frame(F, { x: 0, y: 0, w: 800, h: 600 })] })
		h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [300, 250] })
		h.s.menuAction('pad-here')
		const id = (await h.opsSince(0)).find((op) => op.o === 'put' && op.t === 'pad').id
		let n = h.tr.calls.length
		h.scene.callbacks.onEditing(id, false)
		h.scene.callbacks.onIntent({ type: 'text', id, path: 'data.title', value: 'Ideen', before: '', final: true })
		h.scene.callbacks.onEditing(null, false)
		const titled = await h.opsSince(n)
		assert.deepEqual(titled.map((op) => [op.o, op.id, op.p]), [['patch', id, { 'data.title': 'Ideen' }]])
		assert.equal(h.model.get(id).data.title, 'Ideen')
		assert.equal(h.s.undoStack.done.length, 1, 'creating and the title: one step')
		n = h.tr.calls.length
		h.s.undo()
		assert.deepEqual((await h.opsSince(n)).map((op) => [op.o, op.id]), [['remove', id]])
		assert.ok(!h.model.has(id), 'no empty pad left behind')
		assert.ok(h.model.has(F))
		n = h.tr.calls.length
		h.s.redo()
		assert.ok((await h.opsSince(n)).some((op) => op.id === id))
		assert.equal(h.model.get(id).data.title, 'Ideen', 'back with its title')
		h.s.destroy()
	})

	test('a click with the note tool\'s type pad: the scene\'s create of a pad, one undo step; (job 193) its title editor opens, closed empty the pad stays untitled; then the type is sticky again (the scene goes back to select)', async () => {
		const h = await open()
		h.s.setToolOptions('sticky', { type: 'pad' })
		assert.deepEqual(h.scene.callsOf('setTool').at(-1), ['setTool', 'sticky', { type: 'pad' }])
		assert.deepEqual(h.ui.toolOptions.at(-1).sticky, { type: 'pad' })
		// the scene: the create intent, then back to select (onTool)
		const n = h.tr.calls.length
		h.scene.callbacks.onIntent({ type: 'create', t: 'pad', at: { x: 400, y: 300 }, rect: null })
		h.scene.tool = 'select'
		h.scene.callbacks.onTool('select')
		const ops = await h.opsSince(n)
		assert.deepEqual(ops.map((op) => [op.o, op.t]), [['put', 'pad']])
		assert.deepEqual([ops[0].p.x, ops[0].p.y], [300, 200], 'centred on the point')
		assert.equal(h.s.undoStack.done.length, 1)
		const id = ops[0].id
		assert.deepEqual(h.scene.callsOf('openTextEditor'), [['openTextEditor', id, {}]], 'job 193: its title editor')
		assert.deepEqual(h.scene.callsOf('revealTitle').at(-1), ['revealTitle', id, 0, 0])
		// opened and closed empty (Esc or a click beside it): no op, the pad stays untitled
		h.scene.callbacks.onEditing(id, false)
		h.scene.callbacks.onEditing(null, false)
		const m = h.tr.calls.length
		assert.deepEqual(await h.opsSince(m), [], 'no remove and no title')
		assert.ok(h.model.has(id))
		assert.equal(h.model.get(id).data.title, '')
		assert.equal(h.s.undoStack.done.length, 1)
		assert.deepEqual(h.ui.toolOptions.at(-1).sticky, { type: 'sticky' }, 'the menu says Note again')
		assert.deepEqual(h.s.getToolOptions('sticky'), { type: 'sticky' })
		h.s.setTool('sticky')
		assert.deepEqual(h.scene.callsOf('setTool').at(-1), ['setTool', 'sticky', { type: 'sticky' }], 'the next N makes notes')
		h.s.destroy()
	})

	test('every change of the tool puts the type back to sticky: the toolbar, another tool\'s options; the same tool keeps it', async () => {
		const h = await open()
		h.s.setToolOptions('sticky', { type: 'pad' })
		h.s.setTool('sticky')
		assert.deepEqual(h.s.getToolOptions('sticky'), { type: 'pad' }, 'the same tool: it stays')
		h.s.setTool('select')
		assert.deepEqual(h.s.getToolOptions('sticky'), { type: 'sticky' })
		assert.deepEqual(h.ui.toolOptions.at(-1).sticky, { type: 'sticky' })
		h.s.setToolOptions('sticky', { type: 'pad' })
		h.s.setToolOptions('shape', { kind: 'ellipse' })
		assert.deepEqual(h.s.getToolOptions('sticky'), { type: 'sticky' })
		assert.deepEqual(h.ui.toolOptions.at(-1), { shape: { kind: 'ellipse' }, connector: {}, sticky: { type: 'sticky' }, frame: {}, pen: {} })
		h.s.destroy()
	})
})
