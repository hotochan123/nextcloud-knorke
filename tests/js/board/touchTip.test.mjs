/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 142, AK3: BoardSession and the one-time tip about selecting
 * with a finger. The scene's onTouchPan shows it (ui.onTouchTip(true)) once:
 * not frozen, client mode edit, not shown in this session yet and
 * localStorage knorke.touchTip not '1'; the key becomes '1' as it appears.
 * dismissTouchTip() hides it (ui.onTouchTip(false)), the key stays. A storage
 * whose writes fail shows it once per session, without an error.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { webStorage } from '../../../src/util/storage.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const T0 = 1760100000000
const KEY = 'knorke.touchTip'
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIC = { pid: 'pidvic0000000001', name: 'Vic View', role: 'view', guest: false, mod: false, source: 'share' }
const VERA = { pid: 'pidvera000000001', name: 'Vera Vogt', role: 'vote', guest: false, mod: false, source: 'share' }

/** Scene fake with the stage-3 facade the session calls (setMode, setVoteState). */
class TipScene extends FakeScene {
	setMode(mode, o = {}) {
		this.log('setMode', mode, o)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}
}

const openVote = () => ({ vote: { sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false } })

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

/**
 * @param {object} [o] options
 * @return {Promise<object>} {s, tips (every ui.onTouchTip value), pan() (the scene's onTouchPan), storage}
 */
async function open({ storage = memoryStorage(), me = ALICE, meta = {}, viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	const tips = []
	const tr = {
		kind: 'user',
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items: [sticky(A, { x: 0, y: 0 })] }
		},
		async sync(body) {
			return { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		ui: { onTouchTip: (v) => tips.push(v) },
		deps: {
			SceneModel: FakeModel,
			SceneManager: TipScene,
			transport: tr,
			storage,
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
	await clock.advance(0)
	const scene = s.scene
	return { s, tips, storage, pan: () => scene.opts.callbacks.onTouchPan() }
}

test('AK3: the first pan shows the tip once and stores knorke.touchTip = "1"; later pans call nothing', async () => {
	const h = await open()
	assert.equal(h.s.clientMode, 'edit')
	assert.equal(typeof h.s.scene.opts.callbacks.onTouchPan, 'function', 'the session hands the scene an onTouchPan')
	assert.deepEqual(h.tips, [], 'nothing before the first pan')
	assert.equal(h.storage.data.local.has(KEY), false)
	h.pan()
	assert.deepEqual(h.tips, [true])
	assert.equal(h.storage.data.local.get(KEY), '1', 'stored as it appears')
	h.pan()
	h.pan()
	assert.deepEqual(h.tips, [true], 'no second call in this session')
})

test('AK3: with knorke.touchTip = "1" stored (any board, account or guest of this browser) the tip never shows', async () => {
	const st = memoryStorage()
	st.data.local.set(KEY, '1')
	const h = await open({ storage: st })
	h.pan()
	h.pan()
	assert.deepEqual(h.tips, [])
	// the next board in the same browser: the key the first one stored counts too
	const first = await open()
	first.pan()
	const next = await open({ storage: first.storage })
	next.pan()
	assert.deepEqual(next.tips, [])
})

test('AK3: any other stored value does not count as shown', async () => {
	for (const v of ['0', 'true', '']) {
		const st = memoryStorage()
		st.data.local.set(KEY, v)
		const h = await open({ storage: st })
		h.pan()
		assert.deepEqual(h.tips, [true], JSON.stringify(v))
		assert.equal(st.data.local.get(KEY), '1')
	}
})

test('AK3: frozen, never; nothing stored', async () => {
	const h = await open()
	h.s.onStatus('gone')
	assert.equal(h.s.frozen, true)
	h.pan()
	assert.deepEqual(h.tips, [])
	assert.equal(h.storage.data.local.has(KEY), false)
})

test('AK3: client mode other than edit (role view, a view-only device, mode vote), never; nothing stored', async () => {
	const cases = [
		{ me: VIC, mode: 'view' },
		{ viewOnly: true, mode: 'view' },
		{ me: VERA, meta: openVote(), mode: 'vote' },
	]
	for (const { mode, ...o } of cases) {
		const h = await open(o)
		assert.equal(h.s.clientMode, mode, JSON.stringify(o))
		h.pan()
		assert.deepEqual(h.tips, [], mode)
		assert.equal(h.storage.data.local.has(KEY), false, mode)
	}
})

test('AK3: dismissTouchTip hides the tip (ui.onTouchTip(false)), the key stays; no later pan shows it again', async () => {
	const h = await open()
	h.pan()
	h.s.dismissTouchTip()
	assert.deepEqual(h.tips, [true, false])
	assert.equal(h.storage.data.local.get(KEY), '1')
	h.pan()
	assert.deepEqual(h.tips, [true, false])
})

test('AK3: a storage whose setItem fails shows the tip once per session and never throws', async () => {
	const st = memoryStorage()
	st.setItem = () => false
	const h = await open({ storage: st })
	h.pan()
	h.pan()
	assert.deepEqual(h.tips, [true], 'once in this session')
	assert.equal(st.data.local.has(KEY), false, 'nothing stored')
	const again = await open({ storage: st })
	again.pan()
	assert.deepEqual(again.tips, [true], 'the next board shows it once more')
})

test('AK3: the real storage helpers over a localStorage that throws (private window, quota): once per session, no error', async () => {
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
	const calls = []
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (k) => { calls.push(['get', k]); return null },
			setItem: (k) => { calls.push(['set', k]); throw new Error('QuotaExceededError') },
			removeItem: () => {},
		},
	})
	try {
		const h = await open({ storage: webStorage() })
		assert.doesNotThrow(() => h.pan())
		h.pan()
		assert.deepEqual(h.tips, [true])
		assert.deepEqual(calls.filter((c) => c[1] === KEY), [['get', KEY], ['set', KEY]], 'read once, the failed write once')
	} finally {
		if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
		else delete globalThis.localStorage
	}
})
