/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 178 (AK7): "Save as image (PNG)" in BoardSession, with the
 * real SceneModel, the fake scene (its exportImage injected per test) and
 * an injected download:
 * - an empty board or selection: the info export-empty, no image, no file
 * - the whole board: one image at s = 2, the file "<title> <day>.png",
 *   lastExport; the same job at 10 % and at 150 % zoom
 * - too large: the file, then the info export-scaled
 * - the scene gives nothing twice: exactly 2 tries (the second at s ÷ √2),
 *   the error export-failed, no file; once: the second try downloads
 * - a call while an export runs does nothing
 * - never an op, never an undo step; a viewer and a frozen board export too
 * - the context menu's export-png saves the selection (a frame with its
 *   child); the plan carries the tab's vote state
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { exportFileName } from '../../../src/scene/exportImage.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, frame, memoryStorage, sticky, textItem } from './fakes.mjs'

const T0 = 1760100000000
const WALL = new Date(2026, 9, 25, 14, 30).getTime()
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const F = ID(1)
const C = ID(2)
const N = ID(3)
const EMPTY = 'There is nothing on the board to save.'
const SCALED = 'The board is too large for a sharp image in this browser. The image was saved smaller.'
const FAILED = 'The image could not be saved.'

/**
 * @param {object} [o] items, me, title
 * @return {Promise<object>} harness: s, scene, log (downloads, infos and toasts in order), sent ops
 */
async function open({ items = [frame(F, { w: 600, h: 400 }), sticky(C, { x: 40, y: 60, parent: F, z: 'i1' }), sticky(N, { x: 900, y: 0, z: 'i2' })], me = ALICE, title = 'Retro: Q3' } = {}) {
	const clock = new FakeClock(10000)
	const log = []
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title, role: me.role, metaRev: 3, meta: {} }, me, items: structuredClone(items) }
		},
		async sync(body) {
			tr.calls.push(structuredClone(body))
			return { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: {},
		deps: {
			SceneModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			wall: () => WALL,
			downloadBlob: (name, blob) => {
				log.push(['download', name, blob])
				return true
			},
		},
	})
	await s.open()
	await clock.advance(0)
	const ops = () => tr.calls.flatMap((b) => b.ops ?? [])
	return { s, clock, tr, log, ops, scene: s.scene, model: s.model }
}

/** @param {object} h harness @return {object[]} the jobs the scene was asked to draw */
const jobs = (h) => h.scene.callsOf('exportImage').map((c) => c[1])

test('AK7 an empty board: the info export-empty, no image, no file; an empty selection the same', async () => {
	const h = await open({ items: [] })
	assert.equal(await h.s.exportPng('board'), false)
	assert.deepEqual(h.log, [['info', EMPTY, 'export-empty']])
	assert.equal(jobs(h).length, 0)
	assert.equal(h.s.lastExport, null)
	const g = await open()
	g.s.select([])
	assert.equal(await g.s.exportPng('selection'), false)
	assert.deepEqual(g.log, [['info', EMPTY, 'export-empty']])
	assert.equal(jobs(g).length, 0)
})

test('AK7 the whole board: one image at s = 2, "<title> <day>.png" downloads, lastExport; no op, no undo step', async () => {
	const h = await open()
	const before = h.ops().length
	assert.equal(await h.s.exportPng('board'), true)
	const [job] = jobs(h)
	assert.equal(jobs(h).length, 1)
	assert.deepEqual(job.ids, [F, C, N], 'stacking order')
	assert.equal(job.scale, 2)
	assert.equal(job.width, Math.ceil(job.frame.w * 2))
	assert.equal(job.height, Math.ceil(job.frame.h * 2))
	const name = exportFileName('Retro: Q3', new Date(WALL))
	assert.equal(name, 'Retro_ Q3 2026-10-25.png')
	assert.equal(h.log.length, 1)
	assert.deepEqual(h.log[0].slice(0, 2), ['download', name])
	assert.ok(h.log[0][2] instanceof Blob)
	const last = debugApi(h.s).lastExport()
	assert.deepEqual({ ...last, bounds: undefined }, { name, format: 'png', width: job.width, height: job.height, scale: 2, scaled: false, ids: [F, C, N], bounds: undefined })
	const near = (a, b) => Math.abs(a - b) < 1e-9
	assert.ok(near(last.bounds.x, job.frame.x + 16) && near(last.bounds.y, job.frame.y + 16) && near(last.bounds.w, job.frame.w - 32) && near(last.bounds.h, job.frame.h - 32),
		'the bounds without the margin: ' + JSON.stringify([last.bounds, job.frame]))
	await h.clock.advance(5000)
	assert.equal(h.ops().length, before, 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.equal(h.s.exporting, false)
})

test('AK7 the camera changes nothing: the same job at 10 % and at 150 %', async () => {
	const h = await open()
	h.scene.camera = { x: -500, y: 300, scale: 0.1 }
	await h.s.exportPng('board')
	h.scene.camera = { x: 20, y: -40, scale: 1.5 }
	await h.s.exportPng('board')
	const [a, b] = jobs(h)
	assert.deepEqual(a, b)
	assert.deepEqual(h.scene.camera, { x: 20, y: -40, scale: 1.5 }, 'the scene\'s camera is not touched')
	assert.equal(h.scene.callsOf('setCamera').length, 0)
})

test('AK7 too large: the file downloads, then the info export-scaled', async () => {
	const h = await open({ items: [textItem(ID(4), { x: 0, y: 0, w: 100, h: 100 }), textItem(ID(5), { x: 19900, y: 9900, w: 100, h: 100 })], title: 'Big' })
	assert.equal(await h.s.exportPng('board'), true)
	const [job] = jobs(h)
	assert.ok(job.scale < 2)
	assert.deepEqual(h.log.map((x) => x[0]), ['download', 'info'], 'the notice after the download')
	assert.deepEqual(h.log[1], ['info', SCALED, 'export-scaled'])
	assert.equal(h.s.lastExport.scaled, true)
	assert.equal(h.s.lastExport.scale, job.scale)
})

test('AK7 the scene gives nothing twice: exactly 2 tries (the second at s ÷ √2), export-failed, no file', async () => {
	const h = await open()
	h.scene.exportResult = () => null
	assert.equal(await h.s.exportPng('board'), false)
	const list = jobs(h)
	assert.equal(list.length, 2)
	assert.equal(list[0].scale, 2)
	assert.ok(Math.abs(list[1].scale - 2 / Math.SQRT2) < 1e-12)
	assert.equal(list[1].width, Math.ceil(list[1].frame.w * list[1].scale))
	assert.deepEqual(h.log, [['toast', FAILED, 'export-failed']])
	assert.equal(h.s.lastExport, null)
	// a scene that throws counts as no image
	const g = await open()
	g.scene.exportResult = () => { throw new Error('canvas') }
	const err = console.error
	console.error = () => {}
	try {
		assert.equal(await g.s.exportPng('board'), false)
	} finally {
		console.error = err
	}
	assert.equal(jobs(g).length, 2)
	assert.deepEqual(g.log, [['toast', FAILED, 'export-failed']])
})

test('AK7 the scene gives nothing once: the second try downloads, smaller, with export-scaled', async () => {
	const h = await open()
	let n = 0
	h.scene.exportResult = () => (n++ === 0 ? null : new Blob(['png']))
	assert.equal(await h.s.exportPng('board'), true)
	assert.equal(jobs(h).length, 2)
	assert.deepEqual(h.log.map((x) => x.slice(0, 2)), [['download', 'Retro_ Q3 2026-10-25.png'], ['info', SCALED]])
	assert.equal(h.s.lastExport.scaled, true)
	assert.equal(h.s.lastExport.width, jobs(h)[1].width)
})

test('AK7 a call while an export runs does nothing', async () => {
	const h = await open()
	let release
	h.scene.exportResult = () => new Promise((resolve) => { release = () => resolve(new Blob(['png'])) })
	const first = h.s.exportPng('board')
	assert.equal(h.s.exporting, true)
	assert.equal(await h.s.exportPng('board'), false, 'ignored')
	assert.equal(await h.s.exportPng('selection'), false, 'ignored')
	assert.equal(jobs(h).length, 1)
	release()
	assert.equal(await first, true)
	assert.equal(h.log.filter((x) => x[0] === 'download').length, 1)
	assert.equal(h.s.exporting, false)
	h.scene.exportResult = null
	assert.equal(await h.s.exportPng('board'), true, 'afterwards again')
})

test('AK7 a viewer and a frozen board save the board too', async () => {
	const h = await open({ me: VIEWER })
	assert.equal(h.s.clientMode, 'view')
	assert.equal(await h.s.exportPng('board'), true)
	h.s.frozen = true
	assert.equal(await h.s.exportPng('board'), true)
	assert.equal(h.log.filter((x) => x[0] === 'download').length, 2)
	assert.equal(h.ops().length, 0)
})

test('AK7 the context menu on a frame: export-png saves the frame with its child, not the other note', async () => {
	const h = await open()
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10] })
	assert.equal(h.s.menuAction('export-png'), true)
	await h.clock.advance(0)
	await new Promise((resolve) => setImmediate(resolve))
	const [job] = jobs(h)
	assert.deepEqual(job.ids, [F, C])
	assert.deepEqual(h.s.lastExport.ids, [F, C])
	assert.equal(h.log[0][1], 'Retro_ Q3 2026-10-25.png', 'named after the board, also for a selection')
	assert.equal(h.s.menu, null, 'the menu closed')
	assert.ok(h.scene.callsOf('focusCanvas').length > 0, 'the canvas gets the focus back')
})

test('AK7 the plan carries the tab\'s vote state (own votes, totals, live) and the reaction rows', async () => {
	const h = await open({ items: [sticky(N, { data: { text: '', react: { pbbbbbbbbbbbbbbbb: { e: '1f44d', n: 'Bob' } } } })] })
	h.s.sceneVoteState = () => ({ votable: () => true, scope: null, badges: new Map([[N, { mine: 1, total: 4 }]]), markVotable: true, color: '#e5004d', live: true })
	await h.s.exportPng('board')
	const [job] = jobs(h)
	assert.deepEqual(job.plan.badges.items.map((x) => [x.id, x.mine, x.total, x.ring]), [[N, 1, 4, false]])
	assert.equal(job.plan.badges.counts.rings, 0)
	assert.equal(job.plan.live, true)
	assert.equal(job.plan.color, '#e5004d')
	assert.deepEqual(job.plan.reactions.map((r) => [r.id, r.add, r.plan.pills.map((p) => [p.e, p.n, p.mine])]), [[N, false, [['1f44d', 1, false]]]])
})
