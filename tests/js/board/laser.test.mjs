/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 171, the laser pointer in the session (BoardSession with the
 * fake scene, the fake clock and a scripted transport):
 * - AK2: laser points queue no op, add no undo step and send no ops.
 * - AK5: two strokes give getPresence().l exactly as "Senden" says (r1, d in
 *   whole ms, oldest first, null only between strokes, a point < 30 ms after
 *   the last stored one only moves it); at most the newest 80 elements of
 *   the last 2500 ms; no l without points there, in mode vote, while frozen
 *   and in the presenter's {v}; every point pokes; me.l goes out.
 * - AK8: a presence card with l sets remoteDragging, one without l and d
 *   clears it.
 * - The own colour goes to the scene (setLaserColor), the presence model
 *   plays at laserDelay of the device (900 ms, 2500 ms view-only).
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession, LASER_MIN_GAP_MS, LASER_WINDOW_MS, LASER_WIRE_MAX } from '../../../src/board/BoardSession.js'
import { colorFor } from '../../../src/sync/presence.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }

/** FakeScene with setMode, getViewport and setLaserColor. */
class LaserScene extends FakeScene {
	setMode(mode, o = {}) {
		this.log('setMode', mode, o)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	followTo() {
		return Promise.resolve(true)
	}

	stopFollow() {}

	cameraForRect(rect) {
		return { x: rect.x, y: rect.y, scale: 1 }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 720 }
	}

	setLaserColor(c) {
		this.log('setLaserColor', c)
	}
}

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ me = BOB, meta = {}, viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items: [sticky(A)] }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) return {}
			tr.calls.push(structuredClone(body))
			return { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		deps: {
			SceneModel: FakeModel,
			SceneManager: LaserScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: () => ({ hideToast: () => {} }),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	sessions.push(s)
	await s.open()
	await clock.advance(1000)
	let pokes = 0
	const poke = s.sync.poke.bind(s.sync)
	s.sync.poke = () => {
		pokes++
		poke()
	}
	return {
		s,
		clock,
		tr,
		scene: s.scene,
		pokes: () => pokes,
		/** a scene onLaser call */
		laser: (p) => s.scene.callbacks.onLaser(p),
		/** moves the fake clock without running the sync loop */
		at: (ms) => { clock.t += ms },
	}
}

test('AK5: two strokes give me.l in the format of "Senden"; every point pokes', async () => {
	const h = await open()
	h.laser({ x: 10.04, y: 20.06 })
	h.at(LASER_MIN_GAP_MS - 1)
	h.laser({ x: 11.06, y: 21 })
	h.at(1)
	h.laser({ x: 12, y: 22 })
	h.at(40)
	h.laser({ x: 13, y: 23.04 })
	h.laser(null)
	h.at(10)
	h.laser({ x: 100, y: 200 })
	h.at(35)
	h.laser({ x: 101.26, y: -201 })
	h.at(15)
	assert.equal(h.pokes(), 6, 'every point pokes, the end does not')
	const me = h.s.getPresence()
	assert.deepEqual(me.l, [[11.1, 21, 130], [12, 22, 100], [13, 23, 60], null, [100, 200, 50], [101.3, -201, 15]],
		'oldest first, r1, d in whole ms; < 30 ms only moved the first point; null between the strokes')
	assert.deepEqual(Object.keys(me), ['c', 's', 'd', 'e', 'v', 'l'], 'l last')
	// d never rises, null only between points
	const ds = me.l.filter((p) => p !== null).map((p) => p[2])
	assert.deepEqual(ds, [...ds].sort((a, b) => b - a))
	// it goes out with the next request
	await h.clock.advance(1000)
	const sent = h.tr.calls.at(-1).me
	assert.ok(Array.isArray(sent.l) && sent.l.length === 6, JSON.stringify(sent))
	assert.equal(sent.l[3], null)
})

test('AK5: only the last 2500 ms, at most the newest 80 elements, no leading null; without points there no l', async () => {
	const h = await open()
	for (let i = 0; i < 100; i++) {
		h.laser({ x: i, y: 0 })
		h.at(30)
	}
	h.at(-30)
	const l = h.s.getPresence().l
	assert.equal(l.length, LASER_WIRE_MAX)
	assert.deepEqual(l.at(-1), [99, 0, 0])
	assert.deepEqual(l[0], [20, 0, 2370], 'the newest 80')
	assert.ok(l.every((p) => p[2] <= LASER_WINDOW_MS))
	// a stroke break whose first stroke left the window: no null in front
	h.laser(null)
	h.at(2000)
	h.laser({ x: 500, y: 500 })
	h.at(600)
	assert.deepEqual(h.s.getPresence().l, [[500, 500, 600]], 'the old stroke and its break are gone')
	h.at(LASER_WINDOW_MS - 600 + 1)
	assert.equal('l' in h.s.getPresence(), false, 'no point in the window: no l')
})

test('AK5: no l in mode vote, while frozen and in the presenter\'s {v}', async () => {
	const voteMeta = { sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false }
	const h = await open({ me: { ...ALICE } })
	h.laser({ x: 1, y: 2 })
	assert.ok(h.s.getPresence().l, 'mode edit: l')
	// the presenter in mode vote: {v} only
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta, summon: { pid: ALICE.pid, client: h.s.client, name: 'Alice Adler', seq: 1, at: T0 } } })
	assert.equal(h.s.uiMode(), 'vote')
	h.laser({ x: 3, y: 4 })
	assert.deepEqual(h.s.getPresence(), { v: [0, 0, 1280, 720] }, 'the presenter\'s {v}: no l')
	h.s.setPreferVote(false)
	assert.ok(h.s.getPresence().l, 'back in edit')
	h.s.setVotePanelOpen(true)
	assert.deepEqual(h.s.getPresence(), { v: [0, 0, 1280, 720] }, 'vote panel open: {v} only')
	h.s.setVotePanelOpen(false)
	// not presenting, mode vote: nothing at all
	h.s.onMeta({ metaRev: 5, meta: { vote: voteMeta, summon: null } })
	h.s.setPreferVote(true)
	assert.equal(h.s.uiMode(), 'vote')
	assert.equal(h.s.getPresence(), null)
	h.s.setPreferVote(false)
	assert.ok(h.s.getPresence().l)
	h.s.onStatus('gone')
	assert.equal(h.s.getPresence(), null, 'frozen')
})

test('AK2: laser points queue no op, add no undo step and send no ops', async () => {
	const h = await open()
	const undo = h.s.undoStack.canUndo()
	for (let i = 0; i < 10; i++) {
		h.laser({ x: i * 10, y: i })
		h.at(40)
	}
	h.laser(null)
	await h.clock.advance(1500)
	assert.equal(h.s.replica.pendingCount(), 0)
	assert.equal(h.s.undoStack.canUndo(), undo)
	assert.ok(h.tr.calls.every((b) => !b.ops || b.ops.length === 0), 'no op went out')
	assert.ok(h.tr.calls.some((b) => Array.isArray(b.me?.l)), 'only presence')
})

test('AK8: a card with l keeps the fast cadence (remoteDragging), one without l and d ends it', async () => {
	const h = await open()
	const card = (extra) => ({ 'pidcarol0000001:c1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: null, ...extra } })
	h.s.onPresence(card({ l: [[1, 2, 300], [3, 4, 0]] }))
	assert.equal(h.s.sync.remoteDragging, true)
	h.s.onPresence(card({}))
	assert.equal(h.s.sync.remoteDragging, false)
	h.s.onPresence(card({ d: [[A, 5, 6]] }))
	assert.equal(h.s.sync.remoteDragging, true, 'a drag still counts')
	h.s.onPresence(card({ l: 'bad' }))
	assert.equal(h.s.sync.remoteDragging, false, 'an invalid l counts as none')
})

test('the own colour goes to the scene; the trails play laserDelay late (900 ms, 2500 ms on a view-only device)', async () => {
	const h = await open()
	assert.deepEqual(h.scene.callsOf('setLaserColor').map((c) => c[1]), [colorFor(BOB.pid)])
	assert.equal(h.s.presence.laserDelayMs, 900)
	const v = await open({ viewOnly: true })
	assert.equal(v.s.presence.laserDelayMs, 2500)
})
