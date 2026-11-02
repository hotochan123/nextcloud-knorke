/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 271, AK7: a jump of the board search (BoardSession
 * showSearchHit) moves the camera and the frame, never the selection, and
 * sends no op; searchSource gives the model and the loaded threads; the
 * session reports ui.onItems after a change of the model and passes
 * Ctrl/⌘+F (the scene's onSearch) to ui.onSearch.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { searchBoard } from '../../../src/board/search.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }

class SearchScene extends FakeScene {
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

	setSearchHit(id) {
		this.hit = id
		this.log('setSearchHit', id)
	}
}

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

async function open() {
	const clock = new FakeClock(10000)
	const sent = []
	const ui = { items: 0, search: 0 }
	const tr = {
		kind: 'user',
		async snapshot() {
			const items = [sticky(A, { x: 0, y: 0, data: { text: 'alpha plan' } }), sticky(B, { x: 900, y: 500, data: { text: 'beta plan' } })]
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', metaRev: 3, meta: {} }, me: ALICE, items }
		},
		async sync(body, opts = {}) {
			sent.push(body)
			return opts.keepalive ? {} : { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: { onItems: () => ui.items++, onSearch: () => ui.search++ },
		deps: {
			SceneModel: FakeModel,
			SceneManager: SearchScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	sessions.push(s)
	await s.open()
	await clock.advance(1000)
	return { s, scene: s.scene, sent, ui, clock }
}

const ops = (sent) => sent.flatMap((b) => b.ops ?? [])

test('AK7: an item hit moves the camera and the frame; selection and ops stay', async () => {
	const h = await open()
	h.scene.callbacks.onSelection([A])
	const src = h.s.searchSource()
	const { hits } = searchBoard(src.model, src.threads, 'plan', { anchorOf: src.anchorOf })
	assert.deepEqual(hits.map((x) => x.id), [A, B])
	const before = h.scene.callsOf('setCamera').length
	assert.equal(h.s.showSearchHit(hits[1]), true)
	assert.equal(h.scene.callsOf('setCamera').length, before + 1)
	assert.equal(h.scene.hit, B)
	assert.deepEqual(h.s.selection, [A], 'the selection stays')
	await h.clock.advance(2000)
	assert.deepEqual(ops(h.sent), [], 'no op')
	h.s.setSearchHit(null)
	assert.equal(h.scene.hit, null)
})

test('AK7: a comment hit centres its anchor and frames the item it hangs on (a free one: none)', async () => {
	const h = await open()
	h.s.comments.threads = [
		{ id: '5', item: null, x: 3000, y: 4000, resolved: false, comments: [{ id: '51', parts: ['plan here'], name: 'Bob', at: 1 }] },
	]
	const src = h.s.searchSource()
	const { hits } = searchBoard(src.model, src.threads, 'here', { anchorOf: src.anchorOf })
	assert.deepEqual(hits.map((x) => [x.kind, x.id, x.item]), [['comment', '5', null]])
	assert.equal(h.s.showSearchHit(hits[0]), true)
	const cam = h.scene.callsOf('setCamera').at(-1)[1]
	assert.ok(Math.abs(cam.x + 640 / cam.scale - 3000) < 1e-6 && Math.abs(cam.y + 400 / cam.scale - 4000) < 1e-6, 'the anchor in the middle')
	assert.equal(h.scene.hit, null)
	assert.equal(h.s.showSearchHit(null), false)
	assert.deepEqual(h.s.selection, [])
})

test('ui.onItems after a change of the model; the scene\'s onSearch goes to ui.onSearch', async () => {
	const h = await open()
	const n = h.ui.items
	assert.ok(n >= 1, 'after the load')
	h.s.model.apply({ upserts: [sticky(ID(3), { data: { text: 'gamma' } })] })
	h.s.emitEmpty()
	assert.ok(h.ui.items > n)
	h.scene.callbacks.onSearch()
	assert.equal(h.ui.search, 1)
})
