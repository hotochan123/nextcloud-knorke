/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession, stage 2 (SPEC-M1 §6.5.4, §4.5): the mode from role and
 * device, the live role change (onRole with {role, mod}) with its toasts,
 * the request field `role`, presence only in mode edit, the open editor when
 * editing goes away, and the password lock-out on open (R13, CLI-08).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { HttpError } from '../../../src/sync/http.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', guest: false, source: 'share' }

/** FakeScene with the v2 facade setMode (SPEC-M1 §6.3). */
class ModeScene extends FakeScene {
	constructor(container, model, opts) {
		super(container, model, opts)
		this.mode = opts.mode ?? (opts.viewOnly ? 'view' : 'edit')
	}

	setMode(mode, o = {}) {
		this.mode = mode
		this.viewOnly = mode !== 'edit'
		this.log('setMode', mode, o)
	}
}

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ me = { ...BOB, role: 'edit', mod: false }, viewOnly = false, Scene = ModeScene, reply = null, snapMe = null } = {}) {
	const clock = new FakeClock(10000)
	const ui = { modes: [], boards: [], status: [], rescue: [] }
	const toasts = []
	const infos = []
	let rev = 5
	let snaps = 0
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			snaps++
			const m = snaps > 1 && snapMe ? snapMe : me
			return { proto: 2, epoch: 'k3x9a0b2', now: 1760100000000, rev, minRev: 0, board: { id: 7, title: 'Board', role: m.role, metaRev: 0, meta: {} }, me: m, items: [sticky(A, { data: { text: 'hello' } })] }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				return {}
			}
			tr.calls.push(structuredClone(body))
			const r = reply ? reply(body, tr.calls.length) : null
			if (r instanceof Error) {
				throw r
			}
			if (r) {
				return r
			}
			const res = { rev: body.since, presence: {} }
			if (body.ops) {
				rev = Math.max(rev, body.since) + 1
				res.acks = { seq: body.seq, rev, res: body.ops.map(() => 'ok') }
				res.rev = rev
			}
			return res
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		ui: {
			onMode: (m) => ui.modes.push(m),
			onBoard: (x) => ui.boards.push(x),
			onStatus: (x) => ui.status.push(x),
			onRescue: (x) => ui.rescue.push(x),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: Scene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m) => toasts.push(m),
			info: (m) => infos.push(m),
			wall: () => 1760100000000 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model }
}

test('open with role view on a desktop: scene in mode view, uiMode view, no presence, role view in every request', async () => {
	const h = await open({ me: { ...BOB, role: 'view', mod: false } })
	assert.equal(h.scene.opts.mode, 'view')
	assert.equal(h.scene.opts.viewOnly, true)
	assert.deepEqual(h.ui.modes, ['view'])
	const st = debugApi(h.s).state()
	assert.equal(st.uiMode, 'view')
	assert.equal(st.viewOnly, true, 'viewOnly = no editing by role or device')
	assert.equal(st.role, 'view')
	assert.equal(h.s.getPresence(), null)
	h.s.pointer = [5, 5]
	h.s.sync.poke()
	await h.clock.advance(3000)
	assert.ok(h.tr.calls.every((b) => b.me === undefined), 'never a me block')
	assert.ok(h.tr.calls.every((b) => b.role === 'view'))
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 } })
	await h.clock.advance(1000)
	assert.ok(h.tr.calls.every((b) => !b.ops), 'no op from mode view')
	h.s.destroy()
})

test('open with role vote (voting off): mode view; role edit on a touch device: mode view, the device keeps the view cadence', async () => {
	const v = await open({ me: { ...BOB, role: 'vote', mod: false } })
	assert.equal(v.s.uiMode(), 'view')
	assert.equal(v.tr.calls[0].role, 'vote')
	v.s.destroy()
	const t = await open({ me: { ...BOB, role: 'edit', mod: false }, viewOnly: true })
	assert.equal(t.s.uiMode(), 'view')
	assert.equal(t.s.sync.viewOnly, true, 'SyncClient viewOnly = the device (viewMs cadence)')
	assert.equal(t.s.deviceViewOnly, true)
	t.s.destroy()
	const d = await open({ me: { ...BOB, role: 'view', mod: false } })
	assert.equal(d.s.sync.viewOnly, false, 'a desktop with role view keeps the desktop cadence')
	d.s.destroy()
})

test('live upgrade view → edit (me block): mode edit at once, toast, me/board role follow, next request role edit, editing works', async () => {
	let n = 0
	const h = await open({
		me: { ...BOB, role: 'view', mod: false },
		reply: (b) => (++n === 2 ? { rev: b.since, presence: {}, me: { role: 'edit', mod: false } } : null),
	})
	await h.clock.advance(1000)
	assert.deepEqual(h.scene.callsOf('setMode').map((c) => c[1]), ['edit'])
	assert.deepEqual(h.ui.modes, ['view', 'edit'])
	assert.deepEqual(h.infos, ['You can now edit this board.'])
	assert.equal(h.s.me.role, 'edit')
	assert.equal(h.s.board.role, 'edit')
	assert.equal(h.ui.boards.at(-1).me.role, 'edit', 'the shell gets the new me')
	assert.equal(debugApi(h.s).state().uiMode, 'edit')
	await h.clock.advance(1000)
	assert.equal(h.tr.calls.at(-1).role, 'edit', 'the request now carries the new access level')
	h.scene.callbacks.onIntent({ type: 'create', t: 'sticky', at: { x: 0, y: 0 } })
	await h.clock.advance(200)
	assert.ok(h.tr.calls.some((b) => Array.isArray(b.ops) && b.ops[0].o === 'put'), 'a put went out')
	h.s.destroy()
})

test('live downgrade edit → view with an open editor: notice, queued text dropped, presence stops, toast; pending ops come back denied once', async () => {
	let n = 0
	let downgraded = false
	const h = await open({
		me: { ...BOB, role: 'edit', mod: false },
		reply: (b) => {
			n++
			if (b.ops && downgraded) {
				return { rev: b.since, presence: {}, acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'denied') } }
			}
			return n === 3 ? { rev: b.since, presence: {}, me: { role: 'view', mod: false } } : null
		},
	})
	h.scene.callbacks.onEditing(A, false)
	assert.notEqual(h.s.getPresence(), null)
	await h.clock.advance(1000)
	downgraded = true
	await h.clock.advance(1000)
	assert.deepEqual(h.scene.callsOf('setMode').map((c) => c[1]), ['view'])
	assert.deepEqual(h.scene.callsOf('setMode')[0][2], {}, 'no settle: losing a role cancels like Esc')
	assert.deepEqual(h.scene.callsOf('setEditorNotice').map((c) => c[1]), [A])
	assert.equal(h.scene.callsOf('setEditorNotice')[0][2], 'Not saved. Copy your text before closing.')
	assert.deepEqual(h.infos, ['You can now only view this board.'])
	assert.equal(h.s.getPresence(), null, 'presence only in mode edit')
	assert.deepEqual(h.ui.modes, ['edit', 'view'])
	h.s.destroy()
})

test('only mod changes (edit → moderate → edit): no mode switch, toasts by access level, request role follows, board re-emitted', async () => {
	let n = 0
	const h = await open({
		me: { ...BOB, role: 'edit', mod: false },
		reply: (b) => {
			n++
			if (n === 2) {
				return { rev: b.since, presence: {}, me: { role: 'edit', mod: true } }
			}
			if (n === 4) {
				return { rev: b.since, presence: {}, me: { role: 'edit', mod: false } }
			}
			return null
		},
	})
	await h.clock.advance(1000)
	assert.equal(h.s.me.mod, true)
	assert.equal(h.ui.boards.at(-1).me.mod, true, 'the shell sees me.mod (share button)')
	assert.equal(debugApi(h.s).state().mod, true)
	await h.clock.advance(1000)
	assert.equal(h.tr.calls[2].role, 'moderate')
	await h.clock.advance(1000)
	assert.equal(h.s.me.mod, false)
	assert.deepEqual(h.scene.callsOf('setMode'), [], 'mode edit all along')
	assert.deepEqual(h.infos, ['You can now facilitate this board.', 'You can now edit this board.'])
	h.s.destroy()
})

test('the same me block twice changes nothing (no second toast); garbage me blocks are ignored', async () => {
	const h = await open({ me: { ...BOB, role: 'edit', mod: false } })
	assert.equal(h.s.onRole({ role: 'edit', mod: false }), false)
	assert.equal(h.s.onRole({ role: 'moderate', mod: true }), false, 'moderate is no me.role')
	assert.equal(h.s.onRole(null), false)
	assert.equal(h.s.onRole({ role: 'view', mod: false }), true)
	assert.equal(h.s.onRole({ role: 'view', mod: false }), false)
	assert.deepEqual(h.infos, ['You can now only view this board.'])
	h.s.destroy()
})

test('edit → vote with FEATURES.voting (stage 3): toast "view and vote", mode view without an open session', async () => {
	const h = await open({ me: { ...BOB, role: 'edit', mod: false } })
	h.s.onRole({ role: 'vote', mod: false })
	assert.equal(h.s.uiMode(), 'view', 'no session open: the vote role views')
	assert.deepEqual(h.infos, ['You can now view and vote on this board.'])
	h.s.destroy()
})

test('a scene without setMode gets the M0 alias setViewOnly', async () => {
	class OldScene extends FakeScene {}
	const h = await open({ me: { ...BOB, role: 'edit', mod: false }, Scene: OldScene })
	h.s.onRole({ role: 'view', mod: false })
	assert.deepEqual(h.scene.callsOf('setViewOnly').map((c) => c[1]), [true])
	h.s.onRole({ role: 'edit', mod: false })
	assert.deepEqual(h.scene.callsOf('setViewOnly').map((c) => c[1]), [true, false])
	h.s.destroy()
})

test('a resync snapshot with another role applies it like onRole', async () => {
	let n = 0
	const h = await open({
		me: { ...BOB, role: 'edit', mod: false },
		snapMe: { ...BOB, role: 'view', mod: false },
		reply: (b) => (++n === 2 ? { rev: b.since, presence: {}, resync: true } : null),
	})
	await h.clock.advance(3000)
	assert.equal(h.s.me.role, 'view')
	assert.equal(h.s.me.pid, BOB.pid, 'the rest of me stays')
	assert.equal(h.s.uiMode(), 'view')
	assert.deepEqual(h.infos, ['You can now only view this board.'])
	h.s.destroy()
})

test('a new role makes a denial news again: "No permission" once per role', async () => {
	const h = await open({ me: { ...BOB, role: 'edit', mod: false } })
	h.s.deniedShown = true
	h.s.onRole({ role: 'view', mod: false })
	assert.equal(h.s.deniedShown, false)
	h.s.destroy()
})

test('R13 CLI-08: open() never repeats the password lock-out (guest join), but waits and repeats any other slow_down', async () => {
	const clock = new FakeClock(10000)
	const make = (joins) => {
		let n = 0
		return {
			kind: 'guest',
			async join(name, password) {
				n++
				joins.push([name, password])
				const r = joins.answers[n - 1]
				if (r instanceof Error) {
					throw r
				}
				return r
			},
			async sync(b) { return { rev: b.since } },
			async snapshot() { return { proto: 2, rev: 1, items: [] } },
		}
	}
	const lockJoins = []
	lockJoins.answers = [new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 600000, reason: 'password' })]
	const s = new BoardSession({ container: {}, mode: 'guest', linkToken: 'Ab3dEf6hIj9kLm2nOp5qRs8t', ui: {}, deps: { SceneModel: FakeModel, SceneManager: ModeScene, transport: make(lockJoins), storage: memoryStorage(), now: clock.now, sleep: clock.sleep, win: null } })
	await assert.rejects(s.open('Gina', 'wrong'), (e) => e.code === 'slow_down' && e.body.reason === 'password')
	assert.deepEqual([...lockJoins], [['Gina', 'wrong']], 'one join, with the password')
	const slowJoins = []
	slowJoins.answers = [
		new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 100 }),
		{ proto: 2, epoch: 'e1', now: 1, rev: 1, items: [], board: { id: 7, role: 'edit', metaRev: 0 }, me: { pid: 'g', name: 'Gina', role: 'edit', guest: true, mod: false, source: 'guest' }, guest: { token: 't' } },
	]
	const s2 = new BoardSession({ container: {}, mode: 'guest', linkToken: 'Ab3dEf6hIj9kLm2nOp5qRs8t', ui: {}, deps: { SceneModel: FakeModel, SceneManager: ModeScene, transport: make(slowJoins), storage: memoryStorage(), now: clock.now, sleep: clock.sleep, rand: () => 0, win: null } })
	const p = s2.open('Gina', 'right')
	await clock.advance(2000)
	await p
	assert.deepEqual([...slowJoins], [['Gina', 'right'], ['Gina', 'right']], 'the throttled join is repeated with the same password')
	s2.destroy()
})
