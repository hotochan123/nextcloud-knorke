/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 145, AK1 (session part): the scene's onShortcuts (the key ?
 * on the canvas) reaches ui.onShortcuts in the client modes edit, vote and
 * view and on a frozen board; it is no intent, so following goes on and
 * the selection stays.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIC = { pid: 'pidvic0000000001', name: 'Vic View', role: 'view', guest: false, mod: false, source: 'share' }
const VERA = { pid: 'pidvera000000001', name: 'Vera Vogt', role: 'vote', guest: false, mod: false, source: 'share' }
const CAROL = 'pidcarol0000001'
const PRESENCE = { [CAROL + ':cC1']: { n: 'Carol', k: CAROL, g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }

/** Scene fake with the stage-3 facade the session calls (setMode, setVoteState, followTo, …). */
class KeyScene extends FakeScene {
	setMode(mode, o = {}) {
		this.log('setMode', mode, o)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	followTo(cam, ms) {
		this.log('followTo', cam, ms)
		return Promise.resolve(true)
	}

	stopFollow() {
		this.log('stopFollow')
	}

	cameraForRect(rect, pad = 0) {
		return { x: rect.x, y: rect.y, scale: 1, rect, pad }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

const openVote = () => ({ vote: { sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false } })

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

/**
 * @param {object} [o] options
 * @return {Promise<object>} {s, clock, asked (count of ui.onShortcuts calls), press() (the scene's onShortcuts)}
 */
async function open({ me = ALICE, meta = {}, viewOnly = false } = {}) {
	const clock = new FakeClock(10000)
	let asked = 0
	const tr = {
		kind: 'user',
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items: [sticky(A, { x: 0, y: 0 })] }
		},
		async sync(body, opts = {}) {
			return opts.keepalive ? {} : { rev: body.since, presence: PRESENCE }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		ui: { onShortcuts: (...args) => { asked++; assert.deepEqual(args, [], 'no arguments') } },
		deps: {
			SceneModel: FakeModel,
			SceneManager: KeyScene,
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
	const scene = s.scene
	return { s, clock, asked: () => asked, press: () => scene.callbacks.onShortcuts() }
}

test('AK1: the session hands the scene an onShortcuts; in mode edit it reaches ui.onShortcuts once per key, following and the selection stay', async () => {
	const h = await open()
	assert.equal(h.s.clientMode, 'edit')
	assert.equal(typeof h.s.scene.callbacks.onShortcuts, 'function')
	h.s.scene.callbacks.onSelection([A])
	assert.equal(h.s.followParticipant(CAROL), true, 'following Carol')
	h.press()
	assert.equal(h.asked(), 1)
	h.press()
	assert.equal(h.asked(), 2)
	assert.equal(debugApi(h.s).state().following, CAROL, 'following goes on')
	assert.deepEqual(h.s.selection, [A], 'the selection stays')
	assert.equal(h.s.scene.callsOf('stopFollow').length, 0)
})

test('AK1: modes vote and view (role view, a view-only device) and a frozen board: ui.onShortcuts arrives, following goes on', async () => {
	const cases = [
		{ me: VERA, meta: openVote(), mode: 'vote' },
		{ me: VIC, mode: 'view' },
		{ viewOnly: true, mode: 'view' },
	]
	for (const { mode, ...o } of cases) {
		const h = await open(o)
		assert.equal(h.s.clientMode, mode, JSON.stringify(o))
		assert.equal(h.s.followParticipant(CAROL), true, mode + ': following Carol')
		h.press()
		assert.equal(h.asked(), 1, mode)
		assert.equal(debugApi(h.s).state().following, CAROL, mode + ': following goes on')
	}
	const f = await open()
	assert.equal(f.s.followParticipant(CAROL), true)
	f.s.onStatus('gone')
	assert.equal(f.s.frozen, true)
	f.press()
	assert.equal(f.asked(), 1, 'frozen')
})

test('AK1: without ui.onShortcuts the key does nothing and throws nothing', async () => {
	const h = await open()
	h.s.ui = {}
	assert.doesNotThrow(() => h.press())
})
