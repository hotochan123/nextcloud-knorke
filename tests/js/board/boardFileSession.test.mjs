/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 181 (AK5–AK8): "Board as a file" in BoardSession, with the
 * real SceneModel, a scene fake, an injected Blob download and an LWW
 * server (as in templateSession.test.mjs), so the own puts come back and
 * stay in the model.
 * - AK5 exportBoardFile as a viewer, a guest, in mode vote and on a frozen
 *   board: exactly one downloadBlob of type application/octet-stream named
 *   "<title>.knorke", no op, no undo step; an empty board: the info
 *   export-empty, no download
 * - AK6 invalid files (no JSON, knorke 2, no kind, empty items, more than
 *   16 MiB, a file the shell did not read; since job 187 also only unknown
 *   types and only a connector between two unknown items): the toast
 *   board-file-invalid each, no op, no undo step, no board-file-skipped
 * - AK7 limits.maxItems 10 with 8 items: a file of 3 toasts board-file-full
 *   with "10", no op; a file of 2 is inserted
 * - AK8 in mode edit: one commit, the middle of the new roots on the
 *   viewport centre, the new roots and connectors selected, one undo
 *   removes everything; the camera stays when the items fit into the view,
 *   else zoomToRect of their hull; the canvas focused; the board keeps its
 *   title; nothing in mode view, mode vote, on a frozen board or with the
 *   role view
 * Factory job 187 (AK2–AK5): a file with single items that fail the check
 * inserts the rest in one commit and toasts board-file-skipped with the
 * count of the left-out items and dropped connectors.
 * - AK2 notes A and B as a group, frame F with child C, an unknown X,
 *   connectors A→B, A→X and A→free point: 6 puts, a new group of A and B,
 *   C in F, the connectors at the new ids, "2 items could not be pasted."
 * - AK3 a group of three with a broken member stays a group of two; of a
 *   group of two the rest has group null; the child of a broken frame is a
 *   root
 * - AK4 the former "unknown type" and "double id" files insert the good note
 *   and count 1
 * - AK5 limits.maxItems 10 with 8 items: 2 good and 2 unknown insert 2 and
 *   count 2
 * Factory job 205 (AK6): "Save as BPMN" and "Insert BPMN file…".
 * - exportBpmn('board') for the owner, a viewer, a guest, in mode vote and
 *   on a frozen board: one Blob "<title> <date>.bpmn" of type
 *   application/octet-stream, no op, no undo step; 'selection' only the
 *   selected; nothing BPMN: the info bpmn-empty, no file
 * - insertBpmnFile of the Camunda fixture: one commit of 21 puts (job 211: the five names are labels, no text items), the new
 *   roots and connectors selected, "2 items could not be pasted."
 *   (bpmn-file-skipped), one undo removes everything; nothing in mode view,
 *   mode vote, frozen or for a guest of a view link; the toasts
 *   bpmn-file-invalid and bpmn-file-full
 * Factory job 217 (AK5): the BPMN part does not load (deps.parts rejects):
 * exportBpmn and insertBpmnFile give false with only the toast
 * part-load-failed, no file, no op; a second call asks the loader again;
 * in mode view insertBpmnFile never loads it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession, ZOOM_PAD_PX } from '../../../src/board/BoardSession.js'
import { BOARD_FILE_MAX_BYTES } from '../../../src/board/boardFile.js'
import { readFileSync } from 'node:fs'
import { exportFileName } from '../../../src/scene/exportImage.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, connector, frame, memoryStorage, shape, sticky } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const VOTER = { pid: 'pidvoter00000001', name: 'Volker', role: 'vote', guest: false, mod: false, source: 'share' }
const GUEST = { pid: 'pidgina000000001', name: 'Gina', role: 'view', guest: true, mod: false, source: 'guest' }
const TITLE = 'Retro: Q3'
const NAME = 'Retro_ Q3.knorke'
const INVALID = 'This file is not a valid Knorke board file.'
const EMPTY = 'There is nothing on the board to save.'
const voteMeta = () => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false })

const F = ID(1)
const C = ID(2)
const N = ID(3)
const S = ID(4)
const K = ID(5)
const K2 = ID(6)
/** A board of a frame with a child, a note, a shape, a bound connector and one with a free end (600 × 400 in all). */
const ITEMS = Object.freeze([
	frame(F, { x: 0, y: 0, w: 300, h: 300, data: { title: 'Rahmen' } }),
	sticky(C, { x: 50, y: 50, z: 'i1', parent: F, data: { text: 'Kind' } }),
	sticky(N, { x: 400, y: 0, z: 'i2', data: { text: 'Notiz' } }),
	shape(S, { x: 400, y: 280, z: 'i3', data: { kind: 'rect', text: 'Form' } }),
	connector(K, { item: N }, { item: S }, { z: 'i4' }),
	connector(K2, { item: S }, { x: 600, y: 400 }, { z: 'i5' }),
])

/** @param {object[]} items WireItems @param {string} [title] board title @return {string} a board file */
const fileOf = (items, title = 'Andere Datei') => JSON.stringify({ knorke: 1, kind: 'board', title, origin: [0, 0], items })
/** @param {string} id item id @param {object} [extra] fields @return {object} an item of a type this version does not know */
const hologram = (id, extra = {}) => ({ ...sticky(id, extra), t: 'hologram' })
/** @param {number} lost left-out items @return {Array} the log entry of the count toast */
const skippedToast = (lost) => ['toast', lost === 1 ? '1 item could not be pasted.' : lost + ' items could not be pasted.', 'board-file-skipped']

/**
 * Scene fake with setMode, cameraForRect (the formula of SceneManager for a
 * 1280 × 800 container, without the scale limits) and a screen → world map
 * that is no identity (world = 2 · px + (100, 50)): the view is the world
 * rectangle (100, 50)–(2660, 1650), its centre (1380, 850).
 */
class FileScene extends FakeScene {
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
 * LWW server of the test (as in templateSession.test.mjs): applies ops like
 * §4.6 and answers with every item changed since the request's cursor.
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
 * @param {object} [o] items, me, meta, limits, viewTop, guest (opened through a link as Gina)
 * @return {Promise<object>} harness: s, log (downloads, infos and toasts in order), opsSince
 */
async function open({ items = ITEMS, me = ALICE, meta = {}, limits = {}, viewTop = null, guest = false, parts = undefined } = {}) {
	const clock = new FakeClock(10000)
	const log = []
	const srv = lwwServer(items)
	const answer = () => ({ proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: TITLE, role: me.role, metaRev: 3, meta }, me, items: structuredClone(items) })
	const tr = {
		kind: guest ? 'guest' : 'user',
		calls: [],
		async snapshot() {
			return answer()
		},
		async join() {
			return { ...answer(), guest: { token: 't' } }
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
		mode: guest ? 'guest' : 'user',
		...(guest ? { linkToken: 'Ab3dEf6hIj9kLm2nOp5qRs8t' } : { boardId: 7 }),
		limits,
		ui: viewTop === null ? {} : { viewTop: () => viewTop },
		deps: {
			SceneModel,
			SceneManager: FileScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			wall: () => T0,
			downloadBlob: (name, blob) => {
				log.push(['download', name, blob])
				return true
			},
			download: () => {
				throw new Error('no text download for a board file')
			},
			...(parts ? { parts } : {}),
		},
	})
	await (guest ? s.open('Gina') : s.open())
	await clock.advance(0)
	/** @param {number} [from] first request @return {Promise<object[]>} the ops sent since */
	const opsSince = async (from = 0) => {
		await clock.advance(200)
		return tr.calls.slice(from).flatMap((b) => b.ops ?? [])
	}
	return { s, clock, tr, log, scene: s.scene, model: s.model, opsSince }
}

/** @param {object} h harness @return {Array} the downloads */
const downloads = (h) => h.log.filter((x) => x[0] === 'download')

// ---- AK5: download ------------------------------------------------------------------

test('AK5 download as a viewer, a guest, in mode vote and on a frozen board: exactly one downloadBlob of type application/octet-stream named "<title>.knorke", no op, no undo step', async () => {
	const frozen = await open()
	frozen.s.onStatus('gone')
	assert.equal(frozen.s.frozen, true)
	const cases = [
		['viewer', await open({ me: VIEWER }), 'view'],
		['guest', await open({ me: GUEST, guest: true }), 'view'],
		['vote', await open({ me: VOTER, meta: { vote: voteMeta() } }), 'vote'],
		['frozen', frozen, null],
	]
	for (const [label, h, mode] of cases) {
		if (mode) {
			assert.equal(h.s.uiMode(), mode, label + ': precondition')
		}
		const n = h.tr.calls.length
		assert.equal(h.s.exportBoardFile(), true, label)
		const d = downloads(h)
		assert.equal(d.length, 1, label + ': exactly one file')
		assert.equal(d[0][1], NAME, label)
		assert.ok(d[0][2] instanceof Blob, label + ': a Blob')
		assert.equal(d[0][2].type, 'application/octet-stream', label)
		const f = JSON.parse(await d[0][2].text())
		assert.equal(f.kind, 'board')
		assert.equal(f.title, TITLE)
		assert.equal(f.items.length, ITEMS.length, label + ': every item')
		assert.deepEqual(await h.opsSince(n), [], label + ': no op')
		assert.equal(h.s.undoStack.done.length, 0, label + ': no undo step')
		assert.deepEqual(h.log.filter((x) => x[0] !== 'download'), [], label + ': no message')
		h.s.destroy()
	}
})

test('AK5 an empty board: the info export-empty, no download, no op', async () => {
	const h = await open({ items: [] })
	assert.equal(h.s.exportBoardFile(), false)
	assert.deepEqual(h.log, [['info', EMPTY, 'export-empty']])
	assert.deepEqual(await h.opsSince(0), [])
	h.s.destroy()
})

// ---- AK6: invalid files -------------------------------------------------------------

test('AK6 (job 187 AK4) invalid files: no JSON, knorke 2, no kind, empty items, over 16 MiB, a file that was not read, {}, only unknown types, only a connector between two unknown items: the toast board-file-invalid each, no op, no undo step, no board-file-skipped', async () => {
	const one = [sticky(ID(20), { data: { text: 'neu' } })]
	const big = fileOf(one, 'x'.repeat(BOARD_FILE_MAX_BYTES))
	const files = {
		'no JSON': '{"knorke": 1, "kind": "board",',
		'knorke 2': JSON.stringify({ knorke: 2, kind: 'board', title: '', origin: [0, 0], items: one }),
		'no kind': JSON.stringify({ knorke: 1, title: '', origin: [0, 0], items: one }),
		'empty items': fileOf([]),
		'over 16 MiB': big,
		'not read (null)': null,
		'{}': '{}',
		'only unknown types': fileOf([hologram(ID(21)), hologram(ID(22))]),
		'only a connector between two unknown items': fileOf([hologram(ID(21)), hologram(ID(22)), connector(ID(23), { item: ID(21) }, { item: ID(22) })]),
	}
	assert.ok(big.length > BOARD_FILE_MAX_BYTES)
	const h = await open()
	for (const [label, text] of Object.entries(files)) {
		h.log.length = 0
		const n = h.tr.calls.length
		assert.equal(h.s.insertBoardFile(text), false, label)
		assert.deepEqual(h.log, [['toast', INVALID, 'board-file-invalid']], label + ': the toast')
		assert.deepEqual(await h.opsSince(n), [], label + ': no op')
		assert.equal(h.s.undoStack.done.length, 0, label + ': no undo step')
		assert.equal(h.model.size, ITEMS.length, label + ': nothing inserted')
	}
	h.s.destroy()
})

// ---- AK7: the item limit ------------------------------------------------------------

test('AK7 limits.maxItems 10 with 8 items: a file of 3 toasts board-file-full with "10" and sends nothing; a file of 2 is inserted', async () => {
	const eight = Array.from({ length: 8 }, (_, i) => sticky(ID(30 + i), { x: i * 250, y: 0, z: 'i' + i }))
	const h = await open({ items: eight, limits: { maxItems: 10 } })
	const three = fileOf([0, 1, 2].map((i) => sticky(ID(40 + i), { x: i * 250 })))
	assert.equal(h.s.insertBoardFile(three), false)
	assert.deepEqual(h.log, [['toast', 'The board file does not fit: a board holds at most 10 items.', 'board-file-full']])
	assert.deepEqual(await h.opsSince(0), [])
	assert.equal(h.s.undoStack.done.length, 0)
	assert.equal(h.model.size, 8)
	h.log.length = 0
	const two = fileOf([0, 1].map((i) => sticky(ID(40 + i), { x: i * 250 })))
	assert.equal(h.s.insertBoardFile(two), true)
	assert.deepEqual(h.log, [])
	assert.equal((await h.opsSince(0)).filter((op) => op.o === 'put').length, 2)
	assert.equal(h.model.size, 10)
	h.s.destroy()
})

// ---- AK8: inserting -----------------------------------------------------------------

test('AK8 insert in mode edit: one commit, the middle of the new roots on the viewport centre, the new roots and connectors selected, the canvas focused, the title stays; one undo removes everything', async () => {
	const existing = sticky(ID(60), { x: 5000, y: 5000, data: { text: 'schon da' } })
	const h = await open({ items: [existing] })
	const focus = h.scene.callsOf('focusCanvas').length
	const calls = h.tr.calls.length
	assert.equal(h.s.insertBoardFile(fileOf(ITEMS)), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	const ops = await h.opsSince(calls)
	assert.equal(ops.length, ITEMS.length)
	assert.ok(ops.every((op) => op.o === 'put'), 'only puts')
	const fresh = ops.map((op) => op.id)
	assert.ok(fresh.every((id) => !ITEMS.some((it) => it.id === id)), 'new ids')
	assert.ok(!fresh.includes(existing.id))
	// the middle of the new roots (frame, note, shape) on the viewport centre (1380, 850)
	const roots = ops.filter((op) => op.t !== 'connector' && op.p.parent === null)
	assert.equal(roots.length, 3)
	const x0 = Math.min(...roots.map((op) => op.p.x))
	const x1 = Math.max(...roots.map((op) => op.p.x + op.p.w))
	const y0 = Math.min(...roots.map((op) => op.p.y))
	const y1 = Math.max(...roots.map((op) => op.p.y + op.p.h))
	assert.deepEqual([(x0 + x1) / 2, (y0 + y1) / 2], [1380, 850])
	// selected: the new roots and connectors (selectIds), not the frame's child
	const child = ops.find((op) => op.p.parent !== null)
	assert.equal(child.p.data.text, 'Kind')
	const want = fresh.filter((id) => id !== child.id).sort()
	assert.deepEqual([...h.s.selection].sort(), want)
	assert.deepEqual([...h.scene.selection].sort(), want)
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus')
	assert.equal(h.s.board.title, TITLE, 'the board keeps its title')
	assert.deepEqual(h.log, [])
	// one undo removes everything
	const n = h.tr.calls.length
	h.s.undo()
	const removed = await h.opsSince(n)
	assert.deepEqual(removed.map((op) => op.o), Array(ITEMS.length).fill('remove'))
	assert.deepEqual(removed.map((op) => op.id).sort(), [...fresh].sort())
	assert.equal(h.model.size, 1)
	assert.ok(h.model.has(existing.id))
	h.s.destroy()
})

test('AK8 the camera: it stays when the inserted items lie wholly in the view; else zoomToRect of their hull (cameraForRect with ZOOM_PAD_PX)', async () => {
	const fits = await open({ items: [] })
	const before = fits.scene.getCamera()
	assert.equal(fits.s.insertBoardFile(fileOf(ITEMS)), true, '600 × 400 in a view of 2560 × 1600')
	assert.deepEqual(fits.scene.callsOf('cameraForRect'), [], 'no camera move')
	assert.deepEqual(fits.scene.getCamera(), before)
	fits.s.destroy()
	const large = await open({ items: [] })
	const wide = fileOf([frame(F, { x: 0, y: 0, w: 4000, h: 1000, data: { title: 'Breit' } }), sticky(N, { x: 0, y: 1200, z: 'i1' })])
	assert.equal(large.s.insertBoardFile(wide), true)
	const hull = { x: 1380 - 2000, y: 850 - 700, w: 4000, h: 1400 }
	assert.deepEqual(large.scene.callsOf('cameraForRect').at(-1), ['cameraForRect', hull, ZOOM_PAD_PX], 'the hull of the new items')
	assert.deepEqual(large.scene.getCamera(), large.scene.cameraForRect(hull, ZOOM_PAD_PX))
	large.s.destroy()
})

test('AK8 with ui.viewTop the hull lands below the covered top (reserveTop, like a template)', async () => {
	const h = await open({ items: [], viewTop: 110 })
	const wide = fileOf([frame(F, { x: 0, y: 0, w: 4000, h: 1000, data: { title: 'Breit' } })])
	assert.equal(h.s.insertBoardFile(wide), true)
	const c = h.scene.getCamera()
	const b = h.model.abs(h.s.selection[0])
	const top = (b.y - c.y) * c.scale
	const left = (b.x - c.x) * c.scale
	assert.ok(top >= 110 + ZOOM_PAD_PX - 1e-6, 'below the covered top and the padding: ' + top)
	assert.ok(left >= ZOOM_PAD_PX - 1e-6 && (b.x + b.w - c.x) * c.scale <= 1280 - ZOOM_PAD_PX + 1e-6, 'whole in view')
	h.s.destroy()
})

test('AK8 nothing in mode view, mode vote, on a frozen board or with the role view: false, no toast, no op', async () => {
	const view = await open({ me: VIEWER })
	assert.equal(view.s.uiMode(), 'view')
	const vote = await open({ me: VOTER, meta: { vote: voteMeta() } })
	assert.equal(vote.s.uiMode(), 'vote')
	const frozen = await open()
	frozen.s.onStatus('gone')
	const guest = await open({ me: GUEST, guest: true })
	for (const h of [view, vote, frozen, guest]) {
		const n = h.tr.calls.length
		assert.equal(h.s.insertBoardFile(fileOf([sticky(ID(70))])), false)
		assert.equal(h.s.insertBoardFile('kein JSON'), false, 'not even the invalid toast')
		assert.deepEqual(h.log, [])
		assert.deepEqual(await h.opsSince(n), [])
		assert.equal(h.s.undoStack.done.length, 0)
		assert.equal(h.model.size, ITEMS.length)
		h.s.destroy()
	}
})

// ---- job 187: the good items of a file --------------------------------------------

test('job 187 AK2 partial insert: notes A and B (a group), frame F with child C, an unknown X, connectors A→B, A→X, A→free point: one commit of 6 puts, a new group of A and B, C in F, the connectors at the new ids, "2 items could not be pasted."; selected, focused, true; one undo removes all 6', async () => {
	const A = ID(80)
	const B = ID(81)
	const FR = ID(82)
	const CH = ID(83)
	const X = ID(84)
	const OLD_GROUP = ID(88)
	const text = fileOf([
		frame(FR, { x: 0, y: 0, w: 400, h: 300, data: { title: 'F' } }),
		sticky(CH, { x: 40, y: 60, z: 'i1', parent: FR, data: { text: 'C' } }),
		sticky(A, { x: 500, y: 0, z: 'i2', group: OLD_GROUP, data: { text: 'A' } }),
		sticky(B, { x: 750, y: 0, z: 'i3', group: OLD_GROUP, data: { text: 'B' } }),
		hologram(X, { x: 500, y: 300, z: 'i4' }),
		connector(ID(85), { item: A }, { item: B }, { z: 'i5' }),
		connector(ID(86), { item: A }, { item: X }, { z: 'i6' }),
		connector(ID(87), { item: A }, { x: 600, y: 500 }, { z: 'i7' }),
	])
	const existing = sticky(ID(60), { x: 5000, y: 5000, data: { text: 'schon da' } })
	const h = await open({ items: [existing] })
	const focus = h.scene.callsOf('focusCanvas').length
	const calls = h.tr.calls.length
	assert.equal(h.s.insertBoardFile(text), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one commit, one undo step')
	const ops = await h.opsSince(calls)
	assert.equal(h.tr.calls.slice(calls).filter((b) => (b.ops ?? []).length > 0).length, 1, 'one request with ops')
	assert.equal(ops.length, 6)
	assert.ok(ops.every((op) => op.o === 'put'), 'only puts')
	const fresh = ops.map((op) => op.id)
	assert.ok(fresh.every((id) => ![A, B, FR, CH, X, ID(85), ID(86), ID(87), existing.id].includes(id)), 'new ids')
	const byText = (s) => ops.find((op) => op.t !== 'connector' && (op.p.data.text ?? op.p.data.title) === s)
	const [a, b, f, c] = ['A', 'B', 'F', 'C'].map(byText)
	assert.ok(a && b && f && c, 'A, B, F and C')
	// A and B: a new group
	assert.equal(typeof a.p.group, 'string')
	assert.notEqual(a.p.group, OLD_GROUP)
	assert.equal(b.p.group, a.p.group)
	assert.deepEqual([f.p.group, c.p.group], [null, null])
	// C stays the child of the new F, relative
	assert.deepEqual([c.p.parent, c.p.x, c.p.y], [f.id, 40, 60])
	// the connectors at the new ids; A→X is gone; the free end moved with the paste
	const conns = ops.filter((op) => op.t === 'connector')
	assert.equal(conns.length, 2)
	const kab = conns.find((op) => op.p.data.end.item === b.id)
	assert.ok(kab, 'A→B')
	assert.deepEqual(kab.p.data.start, { item: a.id })
	const kap = conns.find((op) => op !== kab)
	assert.deepEqual(kap.p.data.start, { item: a.id })
	const dx = a.p.x - 500
	const dy = a.p.y - 0
	assert.deepEqual(kap.p.data.end, { x: 600 + dx, y: 500 + dy }, 'A→point')
	// the count: X and A→X
	assert.deepEqual(h.log, [['toast', '2 items could not be pasted.', 'board-file-skipped']])
	// selected: the new roots and connectors (r.selectIds), not the child
	const want = fresh.filter((id) => id !== c.id).sort()
	assert.deepEqual([...h.s.selection].sort(), want)
	assert.equal(h.scene.callsOf('focusCanvas').length, focus + 1, 'the canvas gets the focus')
	// one undo removes all 6
	const n = h.tr.calls.length
	h.s.undo()
	const removed = await h.opsSince(n)
	assert.deepEqual(removed.map((op) => op.o), Array(6).fill('remove'))
	assert.deepEqual(removed.map((op) => op.id).sort(), [...fresh].sort())
	assert.equal(h.model.size, 1)
	assert.ok(h.model.has(existing.id))
	h.s.destroy()
})

test('job 187 AK3 groups and children: a group of three with a broken note becomes a new group of two; of a group of two the rest has group null; the note of a broken frame goes in as a root; the toast counts each', async () => {
	const G = ID(90)
	const cases = [
		['a group of three with a broken note', [
			sticky(ID(91), { x: 0, z: 'i1', group: G, data: { text: 'eins' } }),
			sticky(ID(92), { x: 250, z: 'i2', group: G, data: { text: 'zwei' } }),
			sticky(ID(93), { x: 500, z: 'i3', group: G, w: 1e9, data: { text: 'kaputt' } }),
		], 1, (ops) => {
			assert.deepEqual(ops.map((op) => op.p.data.text), ['eins', 'zwei'])
			assert.equal(typeof ops[0].p.group, 'string')
			assert.notEqual(ops[0].p.group, G)
			assert.equal(ops[1].p.group, ops[0].p.group, 'a new group of two')
		}],
		['a group of two with a broken note', [
			sticky(ID(91), { x: 0, z: 'i1', group: G, data: { text: 'eins' } }),
			hologram(ID(92), { x: 250, z: 'i2', group: G }),
		], 1, (ops) => {
			assert.deepEqual(ops.map((op) => [op.p.data.text, op.p.group]), [['eins', null]])
		}],
		['a note in a broken frame, next to a root note', [
			frame(ID(94), { x: 0, y: 0, w: 1e9, h: 300, data: { title: 'kaputt' } }),
			sticky(ID(95), { x: 40, y: 60, z: 'i1', parent: ID(94), data: { text: 'Kind' } }),
			sticky(ID(96), { x: 0, y: 0, z: 'i2', data: { text: 'Wurzel' } }),
		], 1, (ops) => {
			const [child, root] = ['Kind', 'Wurzel'].map((s) => ops.find((op) => op.p.data.text === s))
			assert.equal(ops.length, 2)
			assert.deepEqual([child.p.parent, root.p.parent], [null, null], 'both roots')
			assert.deepEqual([child.p.x - root.p.x, child.p.y - root.p.y], [40, 60], 'its relative place counts as absolute')
		}],
	]
	for (const [label, items, lost, check] of cases) {
		const h = await open({ items: [] })
		assert.equal(h.s.insertBoardFile(fileOf(items)), true, label)
		const ops = await h.opsSince(0)
		assert.ok(ops.every((op) => op.o === 'put'), label)
		check(ops)
		assert.deepEqual(h.log, [skippedToast(lost)], label + ': the toast')
		assert.deepEqual([...h.s.selection].sort(), ops.map((op) => op.id).sort(), label + ': every new root selected')
		assert.equal(h.s.undoStack.done.length, 1, label)
		h.s.destroy()
	}
})

test('job 187 AK4 the former "unknown type" and "double id" files of job 181 AK6 now insert the one good note and count 1', async () => {
	const one = [sticky(ID(20), { data: { text: 'neu' } })]
	const files = [
		['an unknown type', fileOf([...one, hologram(ID(21))])],
		['a double id', fileOf([...one, sticky(ID(20), { x: 300, data: { text: 'doppelt' } })])],
	]
	for (const [label, text] of files) {
		const h = await open()
		const n = h.tr.calls.length
		assert.equal(h.s.insertBoardFile(text), true, label)
		const ops = await h.opsSince(n)
		assert.deepEqual(ops.map((op) => [op.o, op.p.data.text]), [['put', 'neu']], label)
		assert.deepEqual(h.log, [skippedToast(1)], label + ': the toast')
		assert.equal(h.s.undoStack.done.length, 1, label)
		assert.equal(h.model.size, ITEMS.length + 1, label)
		h.s.destroy()
	}
})

test('job 187 AK5 limits.maxItems 10 with 8 items: 2 good and 2 unknown insert 2 puts and count 2; 3 good toast board-file-full with "10" and send nothing', async () => {
	const eight = Array.from({ length: 8 }, (_, i) => sticky(ID(30 + i), { x: i * 250, y: 0, z: 'i' + i }))
	const h = await open({ items: eight, limits: { maxItems: 10 } })
	const mixed = fileOf([sticky(ID(40)), sticky(ID(41), { x: 250 }), hologram(ID(42), { x: 500 }), hologram(ID(43), { x: 750 })])
	assert.equal(h.s.insertBoardFile(mixed), true)
	const ops = await h.opsSince(0)
	assert.equal(ops.filter((op) => op.o === 'put').length, 2)
	assert.equal(ops.length, 2)
	assert.deepEqual(h.log, [skippedToast(2)])
	assert.equal(h.model.size, 10)
	h.s.destroy()
	const g = await open({ items: eight, limits: { maxItems: 10 } })
	const three = fileOf([sticky(ID(40)), sticky(ID(41), { x: 250 }), sticky(ID(42), { x: 500 }), hologram(ID(43), { x: 750 })])
	assert.equal(g.s.insertBoardFile(three), false)
	assert.deepEqual(g.log, [['toast', 'The board file does not fit: a board holds at most 10 items.', 'board-file-full']])
	assert.deepEqual(await g.opsSince(0), [])
	assert.equal(g.s.undoStack.done.length, 0)
	assert.equal(g.model.size, 8)
	g.s.destroy()
})

// ---- job 205: BPMN files ----------------------------------------------------------

const BPMN_FIXTURE = readFileSync(new URL('../../../dev/e2e/fixtures/order-camunda.bpmn', import.meta.url), 'utf8')
const START = ID(80)
const TASK = ID(81)
/** A start event, a task and the flow between them, next to the items of ITEMS. */
const BPMN_ITEMS = Object.freeze([
	...ITEMS,
	shape(START, { x: 0, y: 1000, w: 64, h: 64, z: 'i6', data: { kind: 'bpmnStart', text: '' } }),
	shape(TASK, { x: 200, y: 972, w: 180, h: 120, z: 'i7', data: { kind: 'bpmnTask', text: 'Prüfen' } }),
	connector(ID(82), { item: START }, { item: TASK }, { z: 'i8' }),
])
const BPMN_NAME = exportFileName(TITLE, new Date(T0), 'bpmn')

test('job 205 AK6 exportBpmn("board") as the owner, a viewer, a guest, in mode vote and on a frozen board: one Blob "<title> <date>.bpmn" of type application/octet-stream with the diagram, no op, no undo step', async () => {
	const frozen = await open({ items: BPMN_ITEMS })
	frozen.s.onStatus('gone')
	const cases = [
		['owner', await open({ items: BPMN_ITEMS })],
		['viewer', await open({ items: BPMN_ITEMS, me: VIEWER })],
		['guest', await open({ items: BPMN_ITEMS, me: GUEST, guest: true })],
		['vote', await open({ items: BPMN_ITEMS, me: VOTER, meta: { vote: voteMeta() } })],
		['frozen', frozen],
	]
	assert.match(BPMN_NAME, /^Retro_ Q3 \d{4}-\d{2}-\d{2}\.bpmn$/)
	for (const [label, h] of cases) {
		const n = h.tr.calls.length
		assert.equal(await h.s.exportBpmn('board'), true, label)
		const d = downloads(h)
		assert.equal(d.length, 1, label)
		assert.equal(d[0][1], BPMN_NAME, label)
		assert.equal(d[0][2].type, 'application/octet-stream', label)
		const text = await d[0][2].text()
		assert.match(text, /<bpmn:startEvent id="Event_[0-9A-Z]+">/, label)
		assert.match(text, /<bpmn:task id="Activity_[0-9A-Z]+" name="Prüfen">/, label)
		assert.match(text, /<bpmn:sequenceFlow /, label)
		assert.doesNotMatch(text, /Notiz|Rahmen/, label + ': notes, frames without lanes and plain shapes are left out')
		assert.deepEqual(await h.opsSince(n), [], label + ': no op')
		assert.equal(h.s.undoStack.done.length, 0, label)
		assert.deepEqual(h.log.filter((x) => x[0] !== 'download'), [], label + ': no message')
		h.s.destroy()
	}
})

test('job 205 AK6 exportBpmn("selection") takes only the selection; nothing BPMN: the info bpmn-empty, no file', async () => {
	const h = await open({ items: BPMN_ITEMS })
	h.s.select([TASK])
	assert.equal(await h.s.exportBpmn('selection'), true)
	const text = await downloads(h)[0][2].text()
	assert.match(text, /<bpmn:task /)
	assert.doesNotMatch(text, /startEvent|sequenceFlow/)
	h.s.destroy()
	const e = await open()
	assert.equal(await e.s.exportBpmn('board'), false)
	assert.deepEqual(e.log, [['info', 'There is no BPMN diagram to save.', 'bpmn-empty']])
	e.s.select([N])
	assert.equal(await e.s.exportBpmn('selection'), false)
	assert.equal(downloads(e).length, 0)
	e.s.destroy()
})

test('job 205 AK6 insertBpmnFile of the Camunda fixture in mode edit: one commit of 21 puts (job 211: names as labels), the new roots and connectors selected, the canvas focused, "2 items could not be pasted." (bpmn-file-skipped); one undo removes everything', async () => {
	const h = await open()
	const focus = h.scene.callsOf('focusCanvas').length
	assert.equal(await h.s.insertBpmnFile(BPMN_FIXTURE), true)
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	const ops = await h.opsSince(0)
	const puts = ops.filter((op) => op.o === 'put')
	assert.equal(puts.length, 21)
	assert.equal(ops.length, 21)
	assert.deepEqual(puts.filter((op) => op.t === 'frame').map((op) => op.p.data.title), ['Bestellung', 'Kunde'])
	assert.equal(h.model.size, ITEMS.length + 21)
	const roots = puts.filter((op) => op.p.parent === null || op.t === 'connector').map((op) => op.id).sort()
	assert.equal(roots.length, 12, 'the two frames and the ten connectors')
	assert.deepEqual([...h.s.selection].sort(), roots)
	assert.deepEqual(h.log, [['toast', '2 items could not be pasted.', 'bpmn-file-skipped']])
	assert.ok(h.scene.callsOf('focusCanvas').length > focus)
	h.s.undo()
	assert.equal(h.model.size, ITEMS.length)
	h.s.destroy()
})

test('job 205 AK6 insertBpmnFile: nothing in mode view, mode vote, on a frozen board or for a guest of a view link; invalid files toast bpmn-file-invalid; more than the limit bpmn-file-full', async () => {
	const view = await open({ me: VIEWER })
	const vote = await open({ me: VOTER, meta: { vote: voteMeta() } })
	const frozen = await open()
	frozen.s.onStatus('gone')
	const guest = await open({ me: GUEST, guest: true })
	for (const h of [view, vote, frozen, guest]) {
		const n = h.tr.calls.length
		assert.equal(await h.s.insertBpmnFile(BPMN_FIXTURE), false)
		assert.equal(await h.s.insertBpmnFile('kein XML'), false)
		assert.deepEqual(h.log, [])
		assert.deepEqual(await h.opsSince(n), [])
		assert.equal(h.model.size, ITEMS.length)
		h.s.destroy()
	}
	const h = await open()
	for (const text of ['kein XML', null, '{}', fileOf(ITEMS)]) {
		h.log.length = 0
		assert.equal(await h.s.insertBpmnFile(text), false)
		assert.deepEqual(h.log, [['toast', 'This file is not a BPMN diagram that Knorke can read.', 'bpmn-file-invalid']], String(text).slice(0, 20))
	}
	assert.deepEqual(await h.opsSince(0), [])
	h.s.destroy()
	const full = await open({ limits: { maxItems: 10 } })
	assert.equal(await full.s.insertBpmnFile(BPMN_FIXTURE), false)
	assert.deepEqual(full.log, [['toast', 'The BPMN file does not fit: a board holds at most 10 items.', 'bpmn-file-full']])
	assert.deepEqual(await full.opsSince(0), [])
	full.s.destroy()
})

test('job 217 AK5: the BPMN part does not load: exportBpmn and insertBpmnFile give false with only part-load-failed, no file, no op; the next call tries again; mode view never loads it', async (t) => {
	t.mock.method(console, 'error', () => {})
	let calls = 0
	const parts = { bpmn: async () => { calls++; throw new TypeError('Failed to fetch dynamically imported module') } }
	const h = await open({ items: BPMN_ITEMS, parts })
	const failed = ['toast', 'This part of Knorke could not be loaded. Reload the page.', 'part-load-failed']
	assert.equal(await h.s.exportBpmn('board'), false)
	assert.deepEqual(h.log, [failed])
	assert.equal(await h.s.insertBpmnFile(BPMN_FIXTURE), false)
	assert.deepEqual(h.log, [failed, failed])
	assert.equal(calls, 2, 'a failure is not kept: every use asks again')
	assert.deepEqual(await h.opsSince(0), [])
	assert.equal(h.model.size, BPMN_ITEMS.length)
	assert.equal(console.error.mock.callCount(), 2)
	h.s.destroy()
	const view = await open({ me: VIEWER, parts })
	assert.equal(await view.s.insertBpmnFile(BPMN_FIXTURE), false)
	assert.equal(calls, 2, 'mode view: not loaded at all')
	assert.deepEqual(view.log, [])
	view.s.destroy()
	// a loaded part is kept: one import for both uses
	let loads = 0
	const ok = { bpmn: async () => { loads++; return import('../../../src/board/bpmnFile.js') } }
	const g = await open({ items: BPMN_ITEMS, parts: ok })
	assert.equal(await g.s.exportBpmn('board'), true)
	assert.equal(await g.s.insertBpmnFile(BPMN_FIXTURE), true)
	assert.equal(loads, 1)
	g.s.destroy()
})
