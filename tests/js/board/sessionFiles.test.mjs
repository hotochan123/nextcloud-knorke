/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Factory job 253 (export and file insert out of BoardSession,
 * board/sessionFiles.js): BoardSession keeps thin methods that hand over to
 * SessionFiles; nothing visible changes.
 *
 * - AK1: exportBpmn in the cases no other test covers: a call while an
 *   image export runs (false, no part loaded, no file), a session destroyed
 *   while the part loads (false, no file), a download the browser refuses
 *   (false), bpmnXml throwing (false, the toast of actionFailed, no file),
 *   and the file's name and type.
 * - AK3: sessionFiles.js never imports BoardSession.js.
 * - AK5: the session's download, downloadFile and commit are read at the
 *   time of the call: a test that replaces them on the instance after the
 *   constructor still sees them called.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { exportFileName } from '../../../src/scene/exportImage.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, memoryStorage, shape, sticky } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const TITLE = 'Retro: Q3'
const BPMN_NAME = exportFileName(TITLE, new Date(T0), 'bpmn')
const FAILED = 'This change could not be applied.'
const ITEMS = Object.freeze([
	sticky(ID(1), { x: 400, y: 0, z: 'i1', data: { text: 'Notiz' } }),
	shape(ID(2), { x: 0, y: 0, w: 180, h: 120, z: 'i2', data: { kind: 'bpmnTask', text: 'Prüfen' } }),
])

class FileScene extends FakeScene {
	setMode(mode) {
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	cameraForRect(rect) {
		return { x: rect.x, y: rect.y, scale: 1 }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}

	screenToWorld(x, y) {
		return { x, y }
	}
}

/**
 * @param {object} [o] parts: deps.parts
 * @return {Promise<{s: BoardSession, log: Array}>} an owner on an open board; log: downloads, infos and toasts
 */
async function open({ parts } = {}) {
	const clock = new FakeClock(10000)
	const log = []
	let rev = 5
	const answer = () => ({ proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: TITLE, role: 'owner', metaRev: 3, meta: {} }, me: ALICE, items: structuredClone(ITEMS) })
	const tr = {
		kind: 'user',
		async snapshot() {
			return answer()
		},
		async sync(body) {
			const res = (body.ops ?? []).map(() => 'ok')
			rev += res.length
			return { rev, items: [], removed: [], presence: {}, ...(body.ops ? { acks: { seq: body.seq, rev, res } } : {}) }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: {},
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
			download: (name, text) => {
				log.push(['download', name, text])
				return true
			},
			...(parts ? { parts } : {}),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, log }
}

const downloads = (h) => h.log.filter((x) => x[0] === 'download')

test('job 253 AK1 exportBpmn: one Blob "<title> <date>.bpmn" of type application/octet-stream', async () => {
	const h = await open()
	assert.equal(await h.s.exportBpmn('board'), true)
	const d = downloads(h)
	assert.equal(d.length, 1)
	assert.equal(d[0][1], BPMN_NAME)
	assert.equal(d[0][2].type, 'application/octet-stream')
	assert.match(await d[0][2].text(), /<bpmn:task id="Activity_[0-9A-Z]+" name="Prüfen" \/>/)
	h.s.destroy()
})

test('job 253 AK1 exportBpmn while an image export runs: false, the part is not loaded, no file, no message', async () => {
	let loads = 0
	const h = await open({ parts: { bpmn: async () => { loads++; return import('../../../src/board/bpmnFile.js') } } })
	h.s.exporting = true
	assert.equal(await h.s.exportBpmn('board'), false)
	assert.equal(loads, 0)
	assert.deepEqual(h.log, [])
	assert.equal(h.s.exporting, true, 'the running export keeps its flag')
	h.s.exporting = false
	h.s.destroy()
})

test('job 253 AK1 exportBpmn: the session is destroyed while the part loads: false, no file, no message', async () => {
	let release
	const gate = new Promise((resolve) => { release = resolve })
	const h = await open({ parts: { bpmn: async () => { await gate; return import('../../../src/board/bpmnFile.js') } } })
	const p = h.s.exportBpmn('board')
	h.s.destroy()
	release()
	assert.equal(await p, false)
	assert.deepEqual(h.log, [])
})

test('job 253 AK1 exportBpmn: the browser refuses the download: false, no message', async () => {
	const h = await open()
	const seen = []
	h.s.downloadFile = (name, blob) => {
		seen.push(name)
		return false
	}
	assert.equal(await h.s.exportBpmn('board'), false)
	assert.deepEqual(seen, [BPMN_NAME])
	assert.deepEqual(h.log, [])
	h.s.destroy()
})

test('job 253 AK1 exportBpmn: bpmnXml throws: false, the toast of actionFailed, no file', async (t) => {
	t.mock.method(console, 'error', () => {})
	const boom = new Error('boom')
	const h = await open({ parts: { bpmn: async () => ({ bpmnXml: () => { throw boom } }) } })
	assert.equal(await h.s.exportBpmn('board'), false)
	assert.deepEqual(h.log, [['toast', FAILED, null]])
	assert.equal(console.error.mock.calls[0].arguments[1], boom)
	h.s.destroy()
})

test('job 253 AK3 sessionFiles.js (and sessionConsts.js) never import BoardSession.js', () => {
	for (const name of ['sessionFiles.js', 'sessionConsts.js']) {
		const url = new URL('../../../src/board/' + name, import.meta.url)
		if (name === 'sessionConsts.js' && !existsSync(url)) {
			continue
		}
		const src = readFileSync(url, 'utf8')
		assert.doesNotMatch(src, /from '\.\/BoardSession\.js'/, name)
		assert.doesNotMatch(src, /import\(['"]\.\/BoardSession\.js['"]\)/, name)
	}
})

test('job 253 AK5 download, downloadFile and commit replaced on the instance after the constructor are the ones called', async () => {
	const h = await open()
	const seen = []
	h.s.downloadFile = (name) => {
		seen.push(['downloadFile', name])
		return true
	}
	h.s.download = (name) => {
		seen.push(['download', name])
		return true
	}
	const commit = h.s.commit.bind(h.s)
	h.s.commit = (r, o) => {
		seen.push(['commit', r.ops.length])
		return commit(r, o)
	}
	assert.equal(h.s.exportBoardFile(), true)
	assert.equal(h.s.exportBoardCsv('board'), true)
	const file = JSON.stringify({ knorke: 1, kind: 'board', title: 'X', origin: [0, 0], items: [sticky(ID(9), { x: 0, y: 0, z: 'i9', data: { text: 'Neu' } })] })
	assert.equal(h.s.insertBoardFile(file), true)
	assert.deepEqual(seen, [['downloadFile', 'Retro_ Q3.knorke'], ['download', exportFileName(TITLE, new Date(T0), 'csv')], ['commit', 1]])
	assert.deepEqual(downloads(h), [], 'the deps were not called directly')
	h.s.destroy()
})
