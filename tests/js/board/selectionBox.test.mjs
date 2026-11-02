/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession hands the scene's selection box to the shell (factory job
 * 137, AK4): the scene callback onSelectionBox reaches ui.onSelectionBox
 * unchanged, a box as well as null; a shell without that callback is fine.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }

/**
 * @param {object} ui shell callbacks
 * @return {Promise<{s: BoardSession, scene: FakeScene}>} an open session on a fake scene
 */
async function open(ui) {
	const clock = new FakeClock(10000)
	const tr = {
		kind: 'user',
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', metaRev: 3, meta: {} }, me: ALICE, items: [sticky(A)] }
		},
		async sync(body) {
			return { rev: body.since ?? 5, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui,
		deps: {
			SceneModel: FakeModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			toast: () => {},
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, scene: s.scene }
}

test('the scene\'s onSelectionBox reaches ui.onSelectionBox: a box and null, as they are', async () => {
	const seen = []
	const { s, scene } = await open({ onSelectionBox: (b) => seen.push(b) })
	assert.equal(typeof scene.callbacks.onSelectionBox, 'function')
	const b = { box: { x: 100, y: 100, w: 200, h: 200 }, keep: { x: 34, y: 34, w: 332, h: 332 } }
	scene.callbacks.onSelectionBox(b)
	scene.callbacks.onSelectionBox(null)
	assert.deepEqual(seen, [b, null])
	assert.equal(seen[0], b, 'the same object, no copy')
	s.destroy()
})

test('a shell without ui.onSelectionBox: the callback does nothing', async () => {
	const { s, scene } = await open({})
	assert.doesNotThrow(() => scene.callbacks.onSelectionBox({ box: { x: 0, y: 0, w: 1, h: 1 }, keep: { x: 0, y: 0, w: 1, h: 1 } }))
	assert.doesNotThrow(() => scene.callbacks.onSelectionBox(null))
	s.destroy()
})
