/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 180 (AK2, AK3, AK5): templates in BoardSession, with fakes.
 * - insertTemplate('kanban'): 9 puts in one commit (one undo step; job 188:
 *   a pad per frame), undo removes all 9, redo brings them back; the frames' middle on the viewport
 *   centre; exactly the 3 frames selected; the camera gets their union with
 *   the title band (cameraForRect with ZOOM_PAD_PX), widened upwards by
 *   ui.viewTop so that the bands land below the top chrome; the canvas focused;
 *   existing items get no op (a frame and a note under the centre stay
 *   where they are, no adoption)
 * - no op in mode view, in mode vote and on a frozen board; a full board:
 *   the toast "This board is full.", no op
 * - ui.onEmpty: true after loading an empty board, false after loading a
 *   full one; false at the first item (own or a server change), true when
 *   the last goes (server, undo); only on a change
 * - the context menu's insert-template closes the menu and asks the shell
 *   for the dialog (ui.onTemplates), no canvas focus, no op
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession, ZOOM_PAD_PX } from '../../../src/board/BoardSession.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { FRAME_TITLE_BAND } from '../../../src/model/tokens.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, sticky } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const VOTER = { pid: 'pidvoter00000001', name: 'Volker', role: 'vote', guest: false, mod: false, source: 'share' }
const F = ID(1)
const N = ID(2)
const voteMeta = () => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false })

/**
 * Scene fake with setMode, cameraForRect (the formula of SceneManager for a
 * 1280 × 800 container, without the scale limits) and a screen → world map
 * that is no identity (world = 2 · px + (100, 50)).
 */
class TemplateScene extends FakeScene {
	setMode(mode) {
		this.log('setMode', mode)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	cameraForRect(rect, pad = 0) {
		this.log('cameraForRect', rect, pad)
		const scale = Math.min((1280 - 2 * pad) / rect.w, (800 - 2 * pad) / rect.h)
		return { x: rect.x + rect.w / 2 - 1280 / (2 * scale), y: rect.y + rect.h / 2 - 800 / (2 * scale), scale }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}

	screenToWorld(x, y) {
		return { x: 2 * x + 100, y: 2 * y + 50 }
	}
}

/**
 * LWW server of the test (as in undoOthers.test.mjs): applies ops like §4.6
 * and answers with every item changed since the request's cursor, so the
 * own puts come back and stay in the model.
 *
 * @param {object[]} items WireItems
 * @return {object} server
 */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) {
				return 'dup'
			}
			if (srv.dead.has(op.id) && op.revive !== true) {
				return 'gone'
			}
			srv.live.set(op.id, itemFromPut(op))
			srv.dead.delete(op.id)
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) {
				return 'gone'
			}
			applyPatch(it, structuredClone(op.p))
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) {
				return 'gone'
			}
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
 * @param {object} [o] items, me, meta, limits
 * @return {Promise<object>} harness
 */
async function open({ items = [], me = ALICE, meta = {}, limits = {}, viewTop = null } = {}) {
	const clock = new FakeClock(10000)
	const ui = { empty: [], templates: 0, menu: [] }
	const toasts = []
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
			if (res) {
				out.acks = { seq: body.seq, rev: srv.rev, res }
			}
			return out
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		limits,
		ui: {
			onEmpty: (x) => ui.empty.push(x),
			onTemplates: () => ui.templates++,
			onContextMenu: (m) => ui.menu.push(m),
			...(viewTop === null ? {} : { viewTop: () => viewTop }),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: TemplateScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m) => toasts.push(m),
			info: (m) => toasts.push(m),
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
	return { s, clock, tr, ui, toasts, scene: s.scene, model: s.model, opsSince }
}

test('AK2 insertTemplate(kanban): 9 puts (job 188: with a pad per frame) in one commit, the frames centred on the viewport, the 3 frames selected, the camera on their union with the title band, the canvas focused; existing items untouched', async () => {
	// an existing frame and a note right under the viewport centre (1380, 850)
	const h = await open({ items: [frame(F, { x: 1000, y: 600, w: 800, h: 600 }), sticky(N, { x: 1300, y: 800, z: 'i1' })] })
	const before = structuredClone([h.model.get(F), h.model.get(N)])
	const focus = h.scene.callsOf('focusCanvas').length
	const calls = h.tr.calls.length
	assert.equal(h.s.insertTemplate('kanban'), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	assert.equal(h.s.undoStack.done[0].ops.length, 9)
	const ops = await h.opsSince(calls)
	assert.equal(ops.length, 9)
	assert.ok(ops.every((op) => op.o === 'put'), 'only puts')
	assert.ok(!ops.some((op) => op.id === F || op.id === N), 'no op on an existing item')
	assert.deepEqual([h.model.get(F), h.model.get(N)], before, 'the existing frame and note stay as they were (no adoption)')
	const frames = ops.filter((op) => op.t === 'frame')
	const notes = ops.filter((op) => op.t === 'sticky')
	assert.deepEqual(frames.map((op) => op.p.data.title), ['To do', 'Doing', 'Done'])
	assert.ok(frames.every((op) => op.p.parent === null), 'the frames stay roots, never inside the existing frame')
	assert.deepEqual(notes.map((op) => frames.findIndex((f) => f.id === op.p.parent)), [0, 1, 2], 'one note in each new frame')
	const pads = ops.filter((op) => op.t === 'pad')
	assert.deepEqual(pads.map((op) => frames.findIndex((f) => f.id === op.p.parent)), [0, 1, 2], 'job 188: one pad in each new frame')
	// the middle of the frames on the viewport centre: container 1280 × 800 → world (100, 50)…(2660, 1650)
	const x0 = Math.min(...frames.map((op) => op.p.x))
	const x1 = Math.max(...frames.map((op) => op.p.x + op.p.w))
	const y0 = Math.min(...frames.map((op) => op.p.y))
	const y1 = Math.max(...frames.map((op) => op.p.y + op.p.h))
	assert.deepEqual([(x0 + x1) / 2, (y0 + y1) / 2], [1380, 850])
	assert.deepEqual(h.s.selection, frames.map((op) => op.id), 'exactly the 3 frames')
	assert.deepEqual(h.scene.selection, frames.map((op) => op.id))
	const rect = { x: x0, y: y0 - FRAME_TITLE_BAND, w: x1 - x0, h: y1 - y0 + FRAME_TITLE_BAND }
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1), ['cameraForRect', rect, ZOOM_PAD_PX], 'without ui.viewTop: exactly the frames with their title band')
	assert.deepEqual(h.scene.getCamera(), h.scene.cameraForRect(rect, ZOOM_PAD_PX), 'the camera of cameraForRect')
	assert.equal(h.scene.getCamera().scale, (800 - 2 * ZOOM_PAD_PX) / (1200 + FRAME_TITLE_BAND), 'kanban (1840 × 1236 with the band, job 227) in 1280 × 800 less the padding: the height decides')
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus')
	assert.deepEqual(h.toasts, [])
	h.s.destroy()
})

test('AK2 with ui.viewTop (top chrome and the context bar of the new selection) the title bands land below it, the frames still whole in view', async () => {
	for (const key of ['kanban', 'retro', 'swot', 'brainstorm']) {
		const h = await open({ viewTop: 110 })
		assert.equal(h.s.insertTemplate(key), true)
		const frames = h.s.selection.map((id) => h.model.abs(id))
		const x0 = Math.min(...frames.map((f) => f.x))
		const x1 = Math.max(...frames.map((f) => f.x + f.w))
		const y0 = Math.min(...frames.map((f) => f.y))
		const y1 = Math.max(...frames.map((f) => f.y + f.h))
		const c = h.scene.getCamera()
		const px = (wx, wy) => ({ x: (wx - c.x) * c.scale, y: (wy - c.y) * c.scale })
		const top = px(x0, y0 - FRAME_TITLE_BAND)
		const bottom = px(x1, y1)
		assert.ok(top.y >= 110 + ZOOM_PAD_PX - 1e-6, key + ': the bands below the covered top and the padding: ' + top.y)
		assert.ok(top.x >= ZOOM_PAD_PX - 1e-6 && bottom.x <= 1280 - ZOOM_PAD_PX + 1e-6 && bottom.y <= 800 - ZOOM_PAD_PX + 1e-6, key + ': whole in view')
		assert.ok(Math.abs(top.y - (110 + ZOOM_PAD_PX)) < 1e-6 || Math.abs(top.x - ZOOM_PAD_PX) < 1e-6, key + ': as large as fits')
		h.s.destroy()
	}
})

test('AK2 undo removes all 9 items (job 188: pads too) in one step, redo brings them back', async () => {
	const h = await open({ items: [sticky(N, { x: 0, y: 0 })] })
	h.s.insertTemplate('kanban')
	const put = await h.opsSince(0)
	const ids = put.map((op) => op.id)
	assert.equal(h.model.size, 10)
	let n = h.tr.calls.length
	h.s.undo()
	const removed = await h.opsSince(n)
	assert.deepEqual(removed.map((op) => op.o), Array(9).fill('remove'))
	assert.deepEqual([...removed.map((op) => op.id)].sort(), [...ids].sort())
	assert.equal(h.model.size, 1)
	assert.ok(h.model.has(N), 'the existing note stays')
	n = h.tr.calls.length
	h.s.redo()
	const again = await h.opsSince(n)
	assert.deepEqual(again.map((op) => op.o), Array(9).fill('put'))
	assert.deepEqual([...again.map((op) => op.id)].sort(), [...ids].sort())
	assert.equal(h.model.size, 10)
	h.s.destroy()
})

test('AK2 no op in mode view, in mode vote and on a frozen board; a full board: the toast "This board is full." and no op', async () => {
	const view = await open({ me: VIEWER })
	assert.equal(view.s.uiMode(), 'view')
	const vote = await open({ me: VOTER, meta: { vote: voteMeta() } })
	assert.equal(vote.s.uiMode(), 'vote')
	const frozen = await open()
	frozen.s.onStatus('gone')
	for (const h of [view, vote, frozen]) {
		const n = h.tr.calls.length
		assert.equal(h.s.insertTemplate('retro'), false)
		assert.deepEqual(await h.opsSince(n), [])
		assert.equal(h.s.undoStack.done.length, 0)
		assert.equal(h.model.size, 0)
		h.s.destroy()
	}
	const full = await open({ items: [sticky(N)], limits: { maxItems: 6 } })
	const n = full.tr.calls.length
	assert.equal(full.s.insertTemplate('kanban'), false, '1 + 6 > 6')
	assert.deepEqual(full.toasts, ['This board is full.'])
	assert.deepEqual(await full.opsSince(n), [])
	assert.equal(full.s.undoStack.done.length, 0)
	assert.equal(full.model.size, 1)
	full.s.destroy()
	const unknown = await open()
	assert.equal(unknown.s.insertTemplate('own'), false, 'an unknown template')
	assert.deepEqual(await unknown.opsSince(0), [])
	unknown.s.destroy()
})

test('AK3 ui.onEmpty after loading: true on an empty board, false on a board with items', async () => {
	const empty = await open()
	assert.deepEqual(empty.ui.empty, [true])
	empty.s.destroy()
	const full = await open({ items: [sticky(N)] })
	assert.deepEqual(full.ui.empty, [false])
	full.s.destroy()
})

test('AK3 ui.onEmpty: false at the first own item, true when undo takes the last away, false again with redo; only on a change', async () => {
	const h = await open()
	h.s.insertTemplate('brainstorm')
	await h.opsSince(0)
	assert.deepEqual(h.ui.empty, [true, false])
	h.s.insertTemplate('swot')
	await h.opsSince(0)
	assert.deepEqual(h.ui.empty, [true, false], 'more items: no new report')
	h.s.undo()
	await h.opsSince(0)
	assert.deepEqual(h.ui.empty, [true, false], 'still items left')
	h.s.undo()
	await h.opsSince(0)
	assert.deepEqual(h.ui.empty, [true, false, true], 'the last item went')
	h.s.redo()
	await h.opsSince(0)
	assert.deepEqual(h.ui.empty, [true, false, true, false])
	h.s.destroy()
})

test('AK3 ui.onEmpty follows server changes: false at the first item from elsewhere, true when the last is removed; only on a change', async () => {
	const h = await open()
	h.s.onChanges([sticky(ID(10), { x: 0, y: 0 })], [])
	assert.deepEqual(h.ui.empty, [true, false])
	h.s.onChanges([sticky(ID(11), { x: 300, y: 0 })], [])
	h.s.onChanges([], [ID(10)])
	assert.deepEqual(h.ui.empty, [true, false], 'one item left')
	h.s.onChanges([], [ID(11)])
	assert.deepEqual(h.ui.empty, [true, false, true])
	h.s.onChanges([], [ID(12)])
	assert.deepEqual(h.ui.empty, [true, false, true], 'nothing changed')
	h.s.destroy()
})

test('AK5 the context menu\'s insert-template closes the menu and asks the shell for the dialog: no op, no canvas focus; outside mode edit nothing', async () => {
	const h = await open()
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [100, 100] })
	assert.notEqual(h.ui.menu.at(-1), null, 'the board menu is open')
	const focus = h.scene.callsOf('focusCanvas').length
	assert.equal(h.s.menuAction('insert-template'), true)
	assert.equal(h.ui.menu.at(-1), null, 'closed')
	assert.equal(h.ui.templates, 1)
	assert.equal(h.scene.callsOf('focusCanvas').length, focus, 'the dialog takes the focus')
	assert.deepEqual(await h.opsSince(0), [])
	assert.equal(h.s.menuAction('insert-template'), false, 'no open menu')
	assert.equal(h.ui.templates, 1)
	h.s.destroy()
})
