/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 200 (AK1, AK2): "Save as SVG" and "Save as PDF" in
 * BoardSession, with the real SceneModel, the fake scene (its
 * exportVector injected per test) and an injected download:
 * - the whole board: one job with the PNG's items, plan and frame (never
 *   scaled), "<title> <day>.svg" / ".pdf" downloads with the scene's Blob,
 *   lastExport with the format; no op, no undo step; at 10 % and at 150 %
 *   the same job
 * - an empty board or selection: export-empty, no file; the scene gives
 *   nothing or throws: export-failed, no file; a call while any image export
 *   runs (a PNG too) does nothing; an unknown format does nothing
 * - a viewer and a frozen board save too
 * - the context menu's export-svg and export-pdf save the selection (a
 *   frame with its child)
 * Factory job 207 (AK3): "Save as PDF…" opens the shell's dialog through
 * openPdfExport (ui.onExportPdf) with the stored page size; exportVector
 * with a page stores it, hands it to the scene and names it in lastExport.
 * Factory job 217 (AK5): the vector part is loaded after the checks (an
 * empty board never loads it); it does not load: false with only the toast
 * part-load-failed, the scene is not asked, exporting is free again.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { EXPORT_MARGIN } from '../../../src/scene/exportImage.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, frame, memoryStorage, sticky, textItem } from './fakes.mjs'

const T0 = 1760100000000
const WALL = new Date(2026, 9, 27, 9, 15).getTime()
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const F = ID(1)
const C = ID(2)
const N = ID(3)
const EMPTY = 'There is nothing on the board to save.'
const FAILED = 'The image could not be saved.'

/**
 * @param {object} [o] items, me, title
 * @return {Promise<object>} harness: s, scene, log (downloads, infos and toasts in order), sent ops
 */
async function open({ items = [frame(F, { w: 600, h: 400 }), sticky(C, { x: 40, y: 60, parent: F, z: 'i1' }), sticky(N, { x: 900, y: 0, z: 'i2' })], me = ALICE, title = 'Retro: Q3', ui = {}, storage = memoryStorage(), parts = undefined } = {}) {
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
		ui,
		deps: {
			SceneModel,
			SceneManager: FakeScene,
			transport: tr,
			storage,
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
			...(parts ? { parts } : {}),
		},
	})
	await s.open()
	await clock.advance(0)
	const ops = () => tr.calls.flatMap((b) => b.ops ?? [])
	return { s, clock, tr, log, ops, storage, scene: s.scene, model: s.model }
}

/** @param {object} h harness @return {object[]} the jobs the scene was asked to draw as vectors */
const jobs = (h) => h.scene.callsOf('exportVector').map((c) => c[1])

/** Silences console.error while fn runs. */
async function quiet(fn) {
	const err = console.error
	console.error = () => {}
	try {
		return await fn()
	} finally {
		console.error = err
	}
}

for (const format of ['svg', 'pdf']) {
	test(`AK2 ${format}: the whole board, the PNG's items and frame (never scaled), "<title> <day>.${format}", the scene's Blob, lastExport; no op, no undo step`, async () => {
		const h = await open()
		const before = h.ops().length
		assert.equal(await h.s.exportVector('board', format), true)
		const [job] = jobs(h)
		assert.equal(jobs(h).length, 1)
		assert.deepEqual(job.ids, [F, C, N], 'stacking order, as the PNG')
		assert.equal(job.format, format)
		// job 207: a PDF names its page size, by default the size of the content
		assert.deepEqual(Object.keys(job).sort(), format === 'pdf' ? ['format', 'frame', 'ids', 'page', 'plan'] : ['format', 'frame', 'ids', 'plan'])
		if (format === 'pdf') assert.equal(job.page, 'content')
		await h.s.exportPng('board')
		const png = h.scene.callsOf('exportImage')[0][1]
		assert.deepEqual(job.frame, png.frame, 'the same frame as the PNG')
		assert.deepEqual(job.plan, png.plan, 'the same plan')
		const name = 'Retro_ Q3 2026-10-27.' + format
		assert.deepEqual(h.log[0].slice(0, 2), ['download', name])
		assert.equal(h.log[0][2].type, format === 'svg' ? 'image/svg+xml;charset=utf-8' : 'application/pdf')
		assert.equal(h.log.length, 2, 'the PNG after it, no notice')
		const last = h.s.lastExport
		assert.equal(last.format, 'png', 'the PNG came last')
		await h.s.exportVector('board', format)
		const v = debugApi(h.s).lastExport()
		assert.deepEqual({ ...v, bounds: undefined }, { name, format, width: job.frame.w, height: job.frame.h, scale: 1, scaled: false, ids: [F, C, N], bounds: undefined, ...(format === 'pdf' ? { page: 'content' } : {}) })
		assert.equal(v.bounds.x, job.frame.x + EXPORT_MARGIN)
		await h.clock.advance(5000)
		assert.equal(h.ops().length, before, 'no op')
		assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
		assert.equal(h.s.exporting, false)
	})
}

test('AK2 the page size of a PDF comes from the scene: lastExport keeps width, height and scale', async () => {
	const h = await open()
	h.scene.vectorResult = () => ({ blob: new Blob(['%PDF']), width: 14400, height: 480, scale: 0.48 })
	assert.equal(await h.s.exportVector('board', 'pdf'), true)
	assert.deepEqual([h.s.lastExport.width, h.s.lastExport.height, h.s.lastExport.scale, h.s.lastExport.scaled], [14400, 480, 0.48, false])
})

test('AK2 a large board is never scaled down and gets no notice', async () => {
	const h = await open({ items: [textItem(ID(4), { x: 0, y: 0, w: 100, h: 100 }), textItem(ID(5), { x: 19900, y: 9900, w: 100, h: 100 })], title: 'Big' })
	assert.equal(await h.s.exportVector('board', 'svg'), true)
	const [job] = jobs(h)
	assert.ok(job.frame.w > 20000)
	assert.deepEqual(h.log.map((x) => x[0]), ['download'])
	assert.equal(h.s.lastExport.scaled, false)
})

test('AK2 the camera changes nothing: the same job at 10 % and at 150 %', async () => {
	const h = await open()
	h.scene.camera = { x: -500, y: 300, scale: 0.1 }
	await h.s.exportVector('board', 'pdf')
	h.scene.camera = { x: 20, y: -40, scale: 1.5 }
	await h.s.exportVector('board', 'pdf')
	const [a, b] = jobs(h)
	assert.deepEqual(a, b)
	assert.equal(h.scene.callsOf('setCamera').length, 0)
})

test('AK2 an empty board or selection: export-empty, no job, no file; an unknown format: nothing', async () => {
	const h = await open({ items: [] })
	assert.equal(await h.s.exportVector('board', 'svg'), false)
	assert.deepEqual(h.log, [['info', EMPTY, 'export-empty']])
	assert.equal(jobs(h).length, 0)
	const g = await open()
	g.s.select([])
	assert.equal(await g.s.exportVector('selection', 'pdf'), false)
	assert.deepEqual(g.log, [['info', EMPTY, 'export-empty']])
	assert.equal(await g.s.exportVector('board', 'png'), false)
	assert.equal(await g.s.exportVector('board'), false)
	assert.equal(jobs(g).length, 0)
	assert.equal(g.log.length, 1)
})

test('AK2 the scene gives nothing, a file without a Blob, or throws: export-failed, no file, lastExport stays', async () => {
	for (const result of [() => null, () => ({ width: 1, height: 1, scale: 1 }), () => { throw new Error('konva') }, () => Promise.reject(new Error('pdf'))]) {
		const h = await open()
		h.scene.vectorResult = result
		assert.equal(await quiet(() => h.s.exportVector('board', 'svg')), false)
		assert.equal(jobs(h).length, 1, 'one try only')
		assert.deepEqual(h.log, [['toast', FAILED, 'export-failed']])
		assert.equal(h.s.lastExport, null)
		assert.equal(h.s.exporting, false)
	}
	const h = await open()
	h.s.downloadFile = () => false
	assert.equal(await h.s.exportVector('board', 'pdf'), false)
	assert.deepEqual(h.log, [['toast', FAILED, 'export-failed']], 'the download refused')
})

test('AK2 a call while any image export runs does nothing (a PNG or a vector)', async () => {
	const h = await open()
	let release
	h.scene.vectorResult = (job) => new Promise((resolve) => { release = () => resolve({ blob: new Blob([job.format]), width: 1, height: 1, scale: 1 }) })
	const first = h.s.exportVector('board', 'svg')
	assert.equal(h.s.exporting, true)
	assert.equal(await h.s.exportVector('board', 'pdf'), false)
	assert.equal(await h.s.exportVector('selection', 'svg'), false)
	assert.equal(await h.s.exportPng('board'), false, 'the PNG waits too')
	assert.equal(jobs(h).length, 1)
	release()
	assert.equal(await first, true)
	assert.equal(h.log.filter((x) => x[0] === 'download').length, 1)
	h.scene.vectorResult = null
	let png
	h.scene.exportResult = () => new Promise((resolve) => { png = () => resolve(new Blob(['png'])) })
	const p = h.s.exportPng('board')
	assert.equal(await h.s.exportVector('board', 'svg'), false, 'ignored during a PNG')
	png()
	assert.equal(await p, true)
	assert.equal(await h.s.exportVector('board', 'svg'), true, 'afterwards again')
})

test('AK2 a viewer and a frozen board save both formats', async () => {
	const h = await open({ me: VIEWER })
	assert.equal(h.s.clientMode, 'view')
	assert.equal(await h.s.exportVector('board', 'svg'), true)
	h.s.frozen = true
	assert.equal(await h.s.exportVector('board', 'pdf'), true)
	assert.deepEqual(h.log.map((x) => x.slice(0, 2)), [['download', 'Retro_ Q3 2026-10-27.svg'], ['download', 'Retro_ Q3 2026-10-27.pdf']])
	assert.equal(h.ops().length, 0)
})

for (const key of ['export-svg', 'export-pdf']) {
	test(`AK1 the context menu on a frame: ${key} saves the frame with its child, not the other note`, async () => {
		const h = await open()
		h.s.select([F])
		h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10] })
		assert.equal(h.s.menuAction(key), true)
		await h.clock.advance(0)
		await new Promise((resolve) => setImmediate(resolve))
		const [job] = jobs(h)
		assert.deepEqual(job.ids, [F, C])
		assert.equal(job.format, key.slice('export-'.length))
		assert.deepEqual(h.s.lastExport.ids, [F, C])
		assert.equal(h.log[0][1], 'Retro_ Q3 2026-10-27.' + job.format)
		assert.equal(h.s.menu, null, 'the menu closed')
	})
}

// ---- Job 207: the page size of "Save as PDF…" --------------------------------

const PAGE_KEY = 'knorke.pdfPage'

test('job 207 AK3 openPdfExport: the dialog gets the scope and the stored page size; content without one or for anything else', async () => {
	const asked = []
	const storage = memoryStorage()
	const h = await open({ ui: { onExportPdf: (x) => asked.push(x) }, storage })
	assert.equal(h.s.pdfPage(), 'content')
	assert.equal(h.s.openPdfExport('board'), true)
	storage.setItem('local', PAGE_KEY, 'a3')
	assert.equal(h.s.openPdfExport('board'), true)
	for (const junk of ['A4', 'letter', '', 'content ', '__proto__']) {
		storage.setItem('local', PAGE_KEY, junk)
		assert.equal(h.s.pdfPage(), 'content', JSON.stringify(junk))
	}
	assert.deepEqual(asked, [{ scope: 'board', page: 'content' }, { scope: 'board', page: 'a3' }])
	assert.equal(jobs(h).length, 0, 'the dialog saves, not the opening')
	assert.equal(h.log.length, 0)
})

test('job 207 AK3 openPdfExport: nothing to save gives export-empty and no dialog; during an export nothing', async () => {
	const asked = []
	const h = await open({ items: [], ui: { onExportPdf: (x) => asked.push(x) } })
	assert.equal(h.s.openPdfExport('board'), false)
	assert.deepEqual(h.log, [['info', EMPTY, 'export-empty']])
	const g = await open({ ui: { onExportPdf: (x) => asked.push(x) } })
	g.s.select([])
	assert.equal(g.s.openPdfExport('selection'), false)
	assert.deepEqual(g.log, [['info', EMPTY, 'export-empty']])
	let release
	g.scene.vectorResult = (job) => new Promise((resolve) => { release = () => resolve({ blob: new Blob([job.format]), width: 1, height: 1, scale: 1 }) })
	const first = g.s.exportVector('board', 'svg')
	assert.equal(g.s.openPdfExport('board'), false)
	// job 217: the scene is asked once the vector part is loaded
	while (!release) await new Promise((resolve) => setImmediate(resolve))
	release()
	await first
	assert.deepEqual(asked, [])
})

test('job 207 AK3 without the hook the PDF saves at once at the stored page size', async () => {
	const storage = memoryStorage()
	storage.setItem('local', PAGE_KEY, 'a4')
	const h = await open({ storage })
	assert.equal(h.s.openPdfExport('board'), true)
	await new Promise((resolve) => setImmediate(resolve))
	const [job] = jobs(h)
	assert.equal(job.format, 'pdf')
	assert.equal(job.page, 'a4')
	assert.equal(h.log[0][0], 'download')
})

test('job 207 AK3 exportVector with a page: stored first, handed to the scene, named in lastExport; without one nothing is stored', async () => {
	const h = await open()
	h.scene.vectorResult = (job) => ({ blob: new Blob(['%PDF']), width: 841.89, height: 595.276, scale: 0.6, job })
	assert.equal(await h.s.exportVector('board', 'pdf', { page: 'a4' }), true)
	assert.equal(h.storage.getItem('local', PAGE_KEY), 'a4')
	assert.equal(jobs(h)[0].page, 'a4')
	assert.equal(h.s.lastExport.page, 'a4')
	assert.deepEqual([h.s.lastExport.width, h.s.lastExport.height, h.s.lastExport.scale], [841.89, 595.276, 0.6])
	assert.equal(await h.s.exportVector('board', 'pdf', { page: 'a3' }), true)
	assert.equal(h.storage.getItem('local', PAGE_KEY), 'a3')
	assert.equal(await h.s.exportVector('board', 'pdf'), true)
	assert.equal(await h.s.exportVector('board', 'pdf', { page: 'letter' }), true)
	assert.equal(h.storage.getItem('local', PAGE_KEY), 'a3', 'no page or an unknown one stores nothing')
	assert.deepEqual(jobs(h).map((j) => j.page), ['a4', 'a3', 'content', 'content'])
	assert.equal(await h.s.exportVector('board', 'svg', { page: 'a4' }), true)
	assert.equal(h.storage.getItem('local', PAGE_KEY), 'a3', 'an SVG stores nothing')
	assert.equal('page' in jobs(h)[4], false, 'an SVG has no page')
	assert.equal('page' in h.s.lastExport, false)
	await h.clock.advance(5000)
	assert.equal(h.ops().length, 0, 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
})

test('job 207 AK3 the choice is stored even when the file then fails; a blocked storage still saves', async () => {
	const h = await open()
	h.scene.vectorResult = () => null
	assert.equal(await quiet(() => h.s.exportVector('board', 'pdf', { page: 'a4' })), false)
	assert.equal(h.storage.getItem('local', PAGE_KEY), 'a4')
	const blocked = { ...memoryStorage(), getItem: () => null, setItem: () => false }
	const g = await open({ storage: blocked })
	assert.equal(g.s.pdfPage(), 'content')
	assert.equal(await g.s.exportVector('board', 'pdf', { page: 'a3' }), true)
	assert.equal(jobs(g)[0].page, 'a3')
})

test('job 207 AK3 the context menu\'s export-pdf opens the dialog for the selection and leaves the focus to it', async () => {
	const asked = []
	const h = await open({ ui: { onExportPdf: (x) => asked.push(x) } })
	h.s.select([F])
	h.s.openMenu({ type: 'contextMenu', id: F, at: [10, 10] })
	const focused = h.scene.callsOf('focusCanvas').length
	assert.equal(h.s.menuAction('export-pdf'), true)
	assert.deepEqual(asked, [{ scope: 'selection', page: 'content' }])
	assert.equal(h.s.menu, null, 'the menu closed')
	assert.equal(h.scene.callsOf('focusCanvas').length, focused, 'the dialog takes the focus')
	assert.equal(jobs(h).length, 0)
	assert.deepEqual(h.s.selection, [F], 'the selection stays for the dialog')
	assert.equal(await h.s.exportVector('selection', 'pdf', { page: 'a4' }), true)
	assert.deepEqual(jobs(h)[0].ids, [F, C])
})

test('job 217 AK5: the vector part does not load: false with only part-load-failed, the scene not asked, exporting free; an empty board never loads it', async (t) => {
	t.mock.method(console, 'error', () => {})
	let calls = 0
	const parts = { vector: async () => { calls++; throw new TypeError('Failed to fetch dynamically imported module') } }
	const h = await open({ parts })
	for (const format of ['svg', 'pdf']) {
		h.log.length = 0
		assert.equal(await h.s.exportVector('board', format), false, format)
		assert.deepEqual(h.log, [['toast', 'This part of Knorke could not be loaded. Reload the page.', 'part-load-failed']], format + ': no export-failed')
		assert.equal(h.s.exporting, false)
	}
	assert.equal(calls, 2, 'every try asks again')
	assert.equal(jobs(h).length, 0)
	assert.equal(h.s.lastExport, null)
	h.s.destroy()
	const e = await open({ items: [], parts })
	assert.equal(await e.s.exportVector('board', 'svg'), false)
	assert.equal(calls, 2, 'nothing to save: not loaded')
	e.s.destroy()
})
