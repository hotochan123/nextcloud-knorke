/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BoardSession, stage 3 (SPEC-M1 §6.4–§6.7, moderation): session start while
 * editing (settle, one toast), presence rules incl. the presenter's {v}
 * (R16 SRV-05: also in mode view on a view-only device), vt sending rule
 * (R16 SRV-01), foreign-sid blocks dropped (SRV-03), vote ops (enqueue,
 * urgency, not in undo, toasts with hooks), voteMiss hints, SceneVoteState
 * for the scene (CLI-04, S-13), the automatic end at endsAt and the only
 * automatic call of routes 22–26 (SRV-07), moderation answers over onMeta,
 * the tablet camera at a new session, following through the session, and
 * the debug hooks votes()/sentPresence()/state().name (CLI-01, CLI-12).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_END_DELAY_MS, BoardSession, MISS_HINT_MS, VT_EVERY_MS, moderationError } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { HttpError } from '../../../src/sync/http.js'
import { colorFor } from '../../../src/sync/presence.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, shape, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const F = ID('F1')
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }

/** FakeScene with the stage-3 facade (setMode with settle, setVoteState, followTo, getViewport, cameraForRect). */
class Stage3Scene extends FakeScene {
	constructor(container, model, opts) {
		super(container, model, opts)
		this.mode = opts.mode ?? 'edit'
		this.voteStates = []
		this.follows = []
		this.viewport = { x: 10.04, y: -20.06, w: 1280.01, h: 720 }
		this.editing = null
	}

	setMode(mode, o = {}) {
		this.log('setMode', mode, o)
		if (o.settle && this.editing) {
			// the open editor ends with its final commit, then the mode changes (§6.3 settle)
			const id = this.editing
			this.editing = null
			this.callbacks.onIntent({ type: 'text', id, path: 'data.text', value: 'typed', before: '', final: true })
			this.callbacks.onEditing(null, false)
		}
		this.mode = mode
		this.viewOnly = mode !== 'edit'
	}

	setVoteState(st) {
		this.voteStates.push(st)
	}

	followTo(cam, ms) {
		this.follows.push({ cam, ms })
		return Promise.resolve(true)
	}

	stopFollow() {
		this.log('stopFollow')
	}

	cameraForRect(rect, pad = 0) {
		return { x: rect.x, y: rect.y, scale: 1, rect, pad }
	}

	getViewport() {
		return { ...this.viewport }
	}
}

/**
 * Opens a session against a scripted fake server.
 *
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ me = ALICE, meta = {}, votes = undefined, items = [sticky(A), sticky(B), shape(C)], viewOnly = false, reply = null, api = {}, presence = () => ({}), win = null } = {}) {
	const clock = new FakeClock(10000)
	const ui = { votes: [], follow: [], modes: [], stepper: [], skew: [] }
	const toasts = []
	const infos = []
	let rev = 5
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items, ...(votes ? { votes } : {}) }
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
			const res = { rev: body.since, presence: presence(body) }
			if (body.ops) {
				rev = Math.max(rev, body.since) + 1
				res.acks = { seq: body.seq, rev, res: body.ops.map(() => 'ok') }
				res.rev = rev
			}
			return res
		},
	}
	const apiCalls = []
	const fakeApi = {
		startVote: async (id, cfg) => { apiCalls.push(['startVote', id, cfg]); return api.startVote ? api.startVote(cfg) : {} },
		updateVote: async (id, action, minutes) => { apiCalls.push(['updateVote', id, action, minutes]); return api.updateVote ? api.updateVote(action, minutes) : {} },
		timer: async (id, action, ms) => { apiCalls.push(['timer', id, action, ms]); return api.timer ? api.timer(action, ms) : {} },
		summon: async (id, client) => { apiCalls.push(['summon', id, client]); return api.summon ? api.summon(client) : {} },
		endSummon: async (id) => { apiCalls.push(['endSummon', id]); return {} },
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		ui: {
			onVotes: (v) => ui.votes.push(v),
			onFollow: (f) => ui.follow.push(f),
			onMode: (m) => ui.modes.push(m),
			onStepper: (x) => ui.stepper.push(x),
			onClockSkew: (x) => ui.skew.push(x),
		},
		deps: {
			SceneModel: FakeModel,
			SceneManager: Stage3Scene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win,
			toast: (m) => toasts.push(m),
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
			api: fakeApi,
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, infos, scene: s.scene, model: s.model, apiCalls }
}

const voteMeta = (extra = {}) => ({ sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false, ...extra })
const lastVotes = (h) => h.ui.votes[h.ui.votes.length - 1]
const lastScene = (h) => h.scene.voteStates[h.scene.voteStates.length - 1]

test('session start while editing (§6.5.4, R13): setMode(vote, {settle}) commits the open editor first, then the mode, one toast; event "started"', async () => {
	const h = await open({ me: BOB })
	assert.equal(h.s.uiMode(), 'edit')
	h.scene.editing = A
	h.scene.callbacks.onEditing(A, false)
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta() } })
	const sm = h.scene.callsOf('setMode')
	assert.deepEqual(sm.map((c) => [c[1], c[2]]), [['vote', { settle: true }]])
	assert.equal(h.model.get(A).data.text, 'typed', 'the final text was applied while still in edit')
	assert.equal(h.s.uiMode(), 'vote')
	assert.deepEqual(h.infos.filter((x) => typeof x === 'string' && x.startsWith('Voting started')), ['Voting started. You are in vote mode; switch back with “Edit”.'])
	assert.equal(lastVotes(h).event, 'started')
	assert.equal(lastVotes(h).canSwitch, true, 'desktop editor: the Vote/Edit switch')
	await h.clock.advance(200)
	assert.ok(h.tr.calls.some((b) => (b.ops ?? []).some((op) => op.o === 'patch' && op.p['data.text'] === 'typed')), 'the commit went out')
	// the switch back
	h.s.setPreferVote(false)
	assert.equal(h.s.uiMode(), 'edit')
	h.s.setPreferVote(true)
	assert.equal(h.s.uiMode(), 'vote')
	assert.equal(h.infos.filter((x) => typeof x === 'string' && x.startsWith('Voting started')).length, 1, 'the toast only at the start')
	h.s.destroy()
})

test('presence (§6.4): v in mode edit; null in mode vote and with the vote panel open; sentPresence() is the candidate of the last request (CLI-01)', async () => {
	const h = await open({ me: BOB })
	const d = debugApi(h.s)
	const p = h.s.getPresence()
	assert.deepEqual(p.v, [10, -20.1, 1280, 720], 'v = getViewport with q(…, 10)')
	await h.clock.advance(1000)
	assert.deepEqual(d.sentPresence().v, [10, -20.1, 1280, 720])
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta() } })
	assert.equal(h.s.uiMode(), 'vote')
	assert.equal(h.s.getPresence(), null)
	await h.clock.advance(1000)
	assert.equal(d.sentPresence(), null, 'after the first tick in mode vote')
	assert.equal(h.tr.calls[h.tr.calls.length - 1].me, undefined)
	h.s.setPreferVote(false)
	assert.notEqual(h.s.getPresence(), null)
	h.s.setVotePanelOpen(true)
	assert.equal(h.s.getPresence(), null, 'vote panel open during a session')
	h.s.destroy()
})

test('R16 SRV-05: the presenting tab sends {v} outside mode edit – also in mode view on a view-only device (session.test case)', async () => {
	const t = await open({ me: { ...ALICE }, viewOnly: true })
	assert.equal(t.s.uiMode(), 'view')
	assert.equal(t.s.getPresence(), null, 'no summon: nothing')
	t.s.onMeta({ metaRev: 4, meta: { summon: { pid: ALICE.pid, client: t.s.client, name: 'Alice Adler', seq: 1, at: T0 } } })
	assert.equal(t.s.isPresenting(), true)
	assert.deepEqual(t.s.getPresence(), { v: [10, -20.1, 1280, 720] })
	await t.clock.advance(2000)
	assert.deepEqual(t.tr.calls[t.tr.calls.length - 1].me, { v: [10, -20.1, 1280, 720] }, 'goes out on the view-only device')
	t.s.onMeta({ metaRev: 5, meta: { summon: { pid: ALICE.pid, client: 'cOtherTab1', name: 'Alice Adler', seq: 2, at: T0 } } })
	assert.equal(t.s.getPresence(), null, 'another tab of mine presents: not this one')
	t.s.destroy()
	// desktop presenter with the vote panel open: {v} only
	const h = await open({ me: { ...ALICE }, meta: { vote: voteMeta() } })
	h.s.setPreferVote(false)
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta(), summon: { pid: ALICE.pid, client: h.s.client, name: 'Alice Adler', seq: 1, at: T0 } } })
	h.s.setVotePanelOpen(true)
	assert.deepEqual(h.s.getPresence(), { v: [10, -20.1, 1280, 720] })
	h.s.destroy()
})

test('vt (R16 SRV-01): only moderators, only while open, at most every 2 s; a new sid sends 0; voters reset', async () => {
	const nonMod = await open({ me: BOB, meta: { vote: voteMeta() } })
	await nonMod.clock.advance(3000)
	assert.ok(nonMod.tr.calls.every((b) => !('vt' in b)), 'never for non-moderators')
	nonMod.s.destroy()
	const noSession = await open({ me: ALICE })
	await noSession.clock.advance(3000)
	assert.ok(noSession.tr.calls.every((b) => !('vt' in b)), 'no open session: no vt (M0-E06 stays without app SQL)')
	noSession.s.destroy()
	let n = 0
	const h = await open({
		me: ALICE,
		meta: { vote: voteMeta() },
		reply: (b) => (++n === 2 ? { rev: b.since, votes: { sid: 12, voters: 3, vt: 7 }, presence: {} } : null),
	})
	assert.equal(h.tr.calls[0].vt, 0)
	await h.clock.advance(1000)
	assert.equal(h.s.voteState.vt, 7)
	assert.equal(h.s.voteState.voters, 3)
	const withVt = () => h.tr.calls.filter((b) => 'vt' in b)
	const at = h.tr.calls.length
	await h.clock.advance(VT_EVERY_MS)
	const sent = withVt()
	assert.ok(sent.length >= 2)
	assert.equal(sent[sent.length - 1].vt, 7)
	// the getter itself: at most every VT_EVERY_MS
	h.s.vtAt = -Infinity
	assert.equal(h.s.voteTally(), 7)
	assert.equal(h.s.voteTally(), null, 'again at once: omitted')
	await h.clock.advance(VT_EVERY_MS - 1)
	h.s.vtAt = h.clock.now() - (VT_EVERY_MS - 1)
	assert.equal(h.s.voteTally(), null)
	h.s.vtAt = h.clock.now() - VT_EVERY_MS
	assert.equal(h.s.voteTally(), 7)
	assert.ok(h.tr.calls.length - at >= 2, 'other requests meanwhile carry no vt')
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta({ sid: 13 }) } })
	assert.equal(h.s.voteState.vt, 0)
	assert.equal(h.s.voteState.voters, 0)
	h.s.sync.forceTick()
	await h.clock.advance(0)
	assert.equal(h.tr.calls[h.tr.calls.length - 1].vt, 0, 'the new sid at once, with 0')
	h.s.onMeta({ metaRev: 5, meta: { vote: voteMeta({ sid: 13, state: 'closed', results: [], total: 0, voters: 0 }) } })
	await h.clock.advance(3000)
	assert.ok(!('vt' in h.tr.calls[h.tr.calls.length - 1]), 'closed: no vt at once')
	h.s.destroy()
})

test('votes blocks of a foreign sid are dropped (R16 SRV-03); the snapshot block sets mine and left', async () => {
	const h = await open({ me: BOB, meta: { vote: voteMeta() }, votes: { sid: 12, mine: { [A]: 1 }, left: 2 } })
	assert.deepEqual(debugApi(h.s).votes(), { sid: 12, state: 'open', open: true, left: 2, mine: { [A]: 1 }, results: null, voters: null })
	h.s.onVotes({ sid: 11, mine: {}, left: 3 })
	assert.deepEqual(h.s.voteState.mine, { [A]: 1 })
	h.s.destroy()
})

test('vote ops: a tap toggles (perItem 1), not in the undo stack, urgent only with a fine pointer; limit/closed toasts carry hooks', async () => {
	let codes = null
	const h = await open({
		me: BOB,
		meta: { vote: voteMeta() },
		reply: (b) => {
			if (!b.ops) {
				return null
			}
			const res = b.ops.map((op) => codes?.[op.id] ?? 'ok')
			const mine = {}
			for (const op of b.ops) {
				if (res[b.ops.indexOf(op)] === 'ok' && op.n > 0) {
					mine[op.id] = op.n
				}
			}
			return { rev: b.since, acks: { seq: b.seq, rev: null, res }, votes: { sid: 12, mine, left: 3 - Object.keys(mine).length }, presence: {} }
		},
	})
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: { x: 1, y: 2, w: 3, h: 4 } })
	assert.deepEqual(h.s.voteState.mine, { [A]: 1 })
	assert.equal(h.s.undoStack.canUndo(), false, 'votes are never undo steps')
	await h.clock.advance(150)
	const op = h.tr.calls.flatMap((b) => b.ops ?? []).find((o) => o.o === 'vote')
	assert.deepEqual(op, { o: 'vote', s: 12, id: A, n: 1 })
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.deepEqual(h.s.voteState.mine, { [A]: 1 }, 'a double tap within 400 ms is ignored')
	await h.clock.advance(500)
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.deepEqual(h.s.voteState.mine, {}, 'later: toggles back')
	await h.clock.advance(500)
	codes = { [B]: 'closed' }
	h.s.vote(B, 1)
	await h.clock.advance(500)
	assert.ok(h.infos.some((x) => Array.isArray(x) && x[0] === 'Voting has ended.' && x[1] === 'vote-closed'))
	assert.deepEqual(h.s.voteState.mine, {}, 'the closed vote is dropped')
	h.s.destroy()
	// tablet: not urgent (rides the 2-s tick)
	const t = await open({ me: BOB, meta: { vote: voteMeta() }, viewOnly: true })
	assert.equal(t.s.uiMode(), 'vote')
	t.s.vote(A, 1)
	assert.equal(t.s.replica.hasUrgent(), false)
	t.s.destroy()
})

test('vote limit: a fourth vote is refused locally with [data-knorke-toast=vote-limit]', async () => {
	const h = await open({ me: BOB, meta: { vote: voteMeta({ cfg: { per: 1, perItem: 1, scope: null, types: ['sticky'] } }) } })
	assert.equal(h.s.vote(A, 1), true)
	assert.equal(h.s.vote(B, 1), false)
	assert.deepEqual(h.infos.filter(Array.isArray), [['You have no votes left.', 'vote-limit']])
	h.s.destroy()
})

test('perItem > 1: a tap opens the stepper at vote.rect (ui.onStepper), no vote yet', async () => {
	const h = await open({ me: BOB, meta: { vote: voteMeta({ cfg: { per: 5, perItem: 3, scope: null, types: ['sticky'] } }) } })
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: { x: 10, y: 20, w: 30, h: 40 } })
	assert.deepEqual(h.ui.stepper, [{ id: A, rect: { x: 10, y: 20, w: 30, h: 40 } }])
	assert.deepEqual(h.s.voteState.mine, {})
	h.s.destroy()
})

test('voteMiss: scope → frame title (empty: "Frame"), type → the type text; at most one hint per 3 s; ignored outside mode vote', async () => {
	const items = [frame(F, { data: { title: 'Ideas' } }), sticky(A, { parent: F }), sticky(B), shape(C)]
	const h = await open({ me: BOB, items, meta: { vote: voteMeta({ cfg: { per: 3, perItem: 1, scope: F, types: ['sticky'] } }) } })
	h.scene.callbacks.onIntent({ type: 'voteMiss', id: B })
	h.scene.callbacks.onIntent({ type: 'voteMiss', id: C })
	assert.deepEqual(h.infos.filter(Array.isArray), [['Only items in “Ideas” can get votes.', 'vote-miss']])
	await h.clock.advance(MISS_HINT_MS)
	h.scene.callbacks.onIntent({ type: 'voteMiss', id: C })
	assert.deepEqual(h.infos.filter(Array.isArray)[1], ['This kind of item can\'t get votes in this session.', 'vote-miss'])
	h.scene.callbacks.onIntent({ type: 'voteMiss', id: null })
	assert.equal(h.infos.filter(Array.isArray).length, 2, 'a miss without an item says nothing')
	h.s.setPreferVote(false)
	await h.clock.advance(MISS_HINT_MS)
	h.scene.callbacks.onIntent({ type: 'voteMiss', id: C })
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.equal(h.infos.filter(Array.isArray).length, 2, 'mode edit: no vote intents')
	assert.deepEqual(h.s.voteState.mine, {})
	h.s.destroy()
})

test('SceneVoteState (§6.3 R16): votable adapter returns booleans by id, badges, markVotable in mode vote, color = colorFor(me.pid); null without meta.vote', async () => {
	const h = await open({ me: BOB, meta: { vote: voteMeta() } })
	const st = lastScene(h)
	assert.equal(st.color, colorFor(BOB.pid))
	assert.match(st.color, /^#[0-9a-f]{6}$/i)
	assert.equal(st.markVotable, true)
	assert.equal(st.scope, null)
	assert.equal(st.votable(A), true)
	assert.equal(st.votable(C), false, 'shape: type not in the session')
	assert.equal(st.votable('nope'), false, 'unknown id')
	assert.equal(typeof st.votable(undefined), 'boolean')
	h.s.vote(A, 1)
	assert.deepEqual([...lastScene(h).badges], [[A, { mine: 1, total: null }]])
	h.s.setPreferVote(false)
	assert.equal(lastScene(h).markVotable, false, 'mode edit: no rings')
	h.s.onMeta({ metaRev: 9, meta: {} })
	assert.equal(lastScene(h), null, 'clear → null')
	h.s.destroy()
})

test('automatic end at endsAt (§4.12.1 way (c)): moderators only, once, 409 swallowed; "+5 min" moves it', async () => {
	let ends = 0
	const h = await open({
		me: ALICE,
		meta: { vote: voteMeta({ endsAt: T0 + 60000 }) },
		api: { updateVote: (action) => { ends++; throw new HttpError(409, 'vote_closed', 'closed', null, true) } },
	})
	await h.clock.advance(59000)
	assert.equal(h.apiCalls.length, 0)
	await h.clock.advance(1000 + AUTO_END_DELAY_MS)
	assert.deepEqual(h.apiCalls, [['updateVote', 7, 'end', undefined]])
	assert.equal(h.toasts.length, 0, '409 is the normal end, no toast')
	await h.clock.advance(20000)
	assert.equal(ends, 1, 'never repeated after a 409')
	h.s.destroy()
	const b = await open({ me: BOB, meta: { vote: voteMeta({ endsAt: T0 + 1000 }) } })
	await b.clock.advance(5000)
	assert.equal(b.apiCalls.length, 0, 'non-moderators never end it')
	b.s.destroy()
	const x = await open({ me: ALICE, meta: { vote: voteMeta({ endsAt: T0 + 1000 }) } })
	x.s.onMeta({ metaRev: 4, meta: { vote: voteMeta({ endsAt: T0 + 400000 }) } })
	await x.clock.advance(5000)
	assert.equal(x.apiCalls.length, 0, 'extended: the timer moved')
	x.s.destroy()
})

test('moderation routes (§4.12): the answer takes the onMeta path; an error is toasted and never repeated (R16 SRV-07); vote_config is left to the dialog', async () => {
	const answer = { board: { title: 'Board', meta: { vote: voteMeta() }, metaRev: 10 }, now: T0 }
	let fail = null
	const h = await open({
		me: ALICE,
		api: {
			startVote: () => { if (fail) { throw fail } return answer },
			timer: () => { throw new HttpError(409, 'timer_state', 'x', null, true) },
			summon: (client) => ({ board: { title: 'Board', meta: { summon: { pid: ALICE.pid, client, name: 'Alice Adler', seq: 1, at: T0 } }, metaRev: 11 }, now: T0 }),
		},
	})
	let r = await h.s.startVote({ per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
	assert.deepEqual(r, { ok: true, code: null })
	assert.equal(h.s.metaRev, 10)
	assert.equal(h.s.voteState.open, true)
	r = await h.s.timer('pause')
	assert.deepEqual(r, { ok: false, code: 'timer_state' })
	assert.deepEqual(h.toasts, ['The timer has changed in the meantime.'])
	assert.equal(h.apiCalls.filter((c) => c[0] === 'timer').length, 1)
	fail = new HttpError(400, 'vote_config', 'x', null, true)
	r = await h.s.startVote({})
	assert.deepEqual(r, { ok: false, code: 'vote_config' })
	assert.equal(h.toasts.length, 1, 'vote_config: shown in the dialog, no toast')
	r = await h.s.summon()
	assert.ok(r.ok)
	assert.equal(h.apiCalls.find((c) => c[0] === 'summon')[2], h.s.client, 'summon carries this tab\'s client id')
	assert.equal(h.s.isPresenting(), true)
	h.s.destroy()
	assert.equal(moderationError(new HttpError(429, 'slow_down', 'x', null, true)), 'Too many requests. Please wait a moment.')
	assert.equal(moderationError(new HttpError(409, 'vote_open', 'x', null, true)), 'A vote is already running.')
	assert.equal(moderationError(new HttpError(0, 'network', 'x')), 'The server cannot be reached. Check your connection.')
})

test('tablets bring the voting area into view at the start of a session unless they follow someone; desktops do not', async () => {
	const items = [frame(F, { x: 100, y: 200, w: 800, h: 600, data: { title: 'B' } }), sticky(A, { parent: F })]
	const t = await open({ me: BOB, items, viewOnly: true })
	t.s.onMeta({ metaRev: 4, meta: { vote: voteMeta({ cfg: { per: 3, perItem: 1, scope: F, types: ['sticky'] } }) } })
	const cams = t.scene.callsOf('setCamera')
	assert.equal(cams.length, 1)
	assert.deepEqual(cams[0][1].rect, { x: 100, y: 200, w: 800, h: 600, r: 0 })
	assert.equal(cams[0][1].pad, 40)
	t.s.destroy()
	const d = await open({ me: BOB, items })
	d.s.onMeta({ metaRev: 4, meta: { vote: voteMeta({ cfg: { per: 3, perItem: 1, scope: F, types: ['sticky'] } }) } })
	assert.equal(d.scene.callsOf('setCamera').length, 0)
	d.s.destroy()
})

test('following through the session: participant button, onUserCamera ends it, state().following, ui.onFollow', async () => {
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const h = await open({ me: BOB, presence: () => pres })
	await h.clock.advance(1000)
	assert.equal(h.s.followParticipant('pidcarol0000001'), true)
	assert.equal(debugApi(h.s).state().following, 'pidcarol0000001')
	assert.ok(h.scene.follows.length >= 1)
	assert.deepEqual(h.ui.follow[h.ui.follow.length - 1].following, { pid: 'pidcarol0000001', client: 'cC1', name: 'Carol', summon: false })
	h.scene.callbacks.onUserCamera()
	assert.equal(debugApi(h.s).state().following, null)
	// §6.5.1/§6.5.6: follow(pid, client) is the session command; Esc (own keydown listener) ends it
	assert.equal(h.s.follow('pidcarol0000001', 'cC1'), true)
	h.s.follower.onEsc()
	assert.equal(debugApi(h.s).state().following, null)
	assert.equal(h.s.follow(BOB.pid, h.s.client), false, 'never this tab itself')
	h.s.destroy()
})

test('__knorke.votes() shapes (CLI-12) and state().name: no session, open (moderator voters), closed with results', async () => {
	const h = await open({ me: ALICE })
	const d = debugApi(h.s)
	assert.deepEqual(d.votes(), { sid: null, state: null, open: false, left: null, mine: {}, results: null, voters: null })
	assert.equal(d.state().name, 'Alice Adler')
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta() } })
	h.s.onVotes({ sid: 12, voters: 2, vt: 3 })
	assert.deepEqual(d.votes(), { sid: 12, state: 'open', open: true, left: 3, mine: {}, results: null, voters: 2 })
	h.s.onMeta({ metaRev: 5, meta: { vote: voteMeta({ state: 'closed', results: [[A, 2]], total: 1, voters: 2, closedAt: T0 }) } })
	const v = d.votes()
	assert.deepEqual(v, { sid: 12, state: 'closed', open: false, left: null, mine: {}, results: [[A, 2]], voters: 2 })
	assert.equal(JSON.stringify(JSON.parse(JSON.stringify(v))), JSON.stringify(v), 'JSON-serialisable')
	assert.equal(lastVotes(h).event, 'closed', 'the panel opens once per sid')
	h.s.destroy()
})

test('the clock skew is reported to the shell (ui.onClockSkew) only when it changes by ≥ 100 ms', async () => {
	const h = await open({ me: BOB })
	const t = h.clock.now()
	h.s.clock.samples = []
	h.s.onClock({ now: T0 + 50, t0: t, t1: t })
	assert.deepEqual(h.ui.skew, [], '50 ms: not reported')
	h.s.clock.samples = []
	h.s.onClock({ now: T0 + 5000, t0: t, t1: t })
	assert.deepEqual(h.ui.skew, [5000])
	h.s.destroy()
})

test('Esc on the page ends following (the session\'s own keydown listener, §6.5.6); without following it does nothing', async () => {
	const handlers = {}
	const doc = { addEventListener: (t, fn) => { handlers['doc:' + t] = fn }, removeEventListener: () => {}, visibilityState: 'visible', activeElement: null, body: null }
	const win = { addEventListener: (t, fn) => { handlers['win:' + t] = fn }, removeEventListener: () => {}, document: doc }
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const h = await open({ me: BOB, presence: () => pres, win })
	await h.clock.advance(1000)
	handlers['doc:keydown']({ key: 'Escape' })
	h.s.follow('pidcarol0000001', 'cC1')
	handlers['doc:keydown']({ key: 'a' })
	assert.equal(debugApi(h.s).state().following, 'pidcarol0000001')
	handlers['doc:keydown']({ key: 'Escape' })
	assert.equal(debugApi(h.s).state().following, null)
	h.s.destroy()
})

// ---- fix round (asks of [B]): answers of routes 22–26, stale meta after 409, votes block shapes ----

test('an action without effect (show when shown, hide when hidden, DELETE summon without summon) answers 200 with the stored state and the same metaRev: success, no toast', async () => {
	const stored = { board: { title: 'Board', meta: { vote: voteMeta({ state: 'closed', results: [[A, 1]], total: 1, voters: 1, show: true }) }, metaRev: 3 }, now: T0 }
	const h = await open({ me: ALICE, meta: stored.board.meta, api: { updateVote: () => stored } })
	const before = h.ui.votes.length
	const r = await h.s.updateVote('show')
	assert.deepEqual(r, { ok: true, code: null })
	assert.equal(h.s.metaRev, 3, 'metaRev unchanged')
	assert.deepEqual(h.toasts, [])
	assert.equal(h.ui.votes.length, before, 'nothing to re-render')
	const e = await h.s.endSummon()
	assert.deepEqual(e, { ok: true, code: null }, 'DELETE summon answers {} or the stored state: success')
	h.s.destroy()
})

test('409 vote_open on start (R16: the server closed an expired open session): toast, the known meta is applied again, the next tick comes at the active cadence and brings the closed meta.vote; never repeated', async () => {
	const closedMeta = { vote: voteMeta({ state: 'closed', endsAt: T0 - 1, results: [[A, 2]], total: 1, voters: 1, closedAt: T0 }) }
	let closedSent = false
	const tickAt = []
	let h = null
	h = await open({
		me: ALICE,
		meta: { vote: voteMeta({ endsAt: T0 + 3600000 }) },
		api: { startVote: () => { throw new HttpError(409, 'vote_open', 'open', null, true) } },
		reply: (b) => {
			tickAt.push(h ? h.clock.now() : 0)
			if (closedSent || !h || h.toasts.length === 0) {
				return null
			}
			closedSent = true
			return { rev: b.since, board: { title: 'Board', metaRev: 4, meta: closedMeta }, presence: {} }
		},
	})
	// idle for a while: the loop runs at the idle cadence (1000 ms)
	await h.clock.advance(8000)
	const lastTick = tickAt[tickAt.length - 1]
	await h.clock.advance(lastTick + 10 - h.clock.now())
	const emitted = h.ui.votes.length
	const r = await h.s.startVote({ per: 3, perItem: 1, scope: null, types: ['sticky'], minutes: null })
	assert.deepEqual(r, { ok: false, code: 'vote_open' })
	assert.deepEqual(h.toasts, ['A vote is already running.'])
	assert.ok(h.ui.votes.length > emitted, 'the known meta was applied again (bar re-rendered)')
	assert.equal(h.s.voteState.open, true, 'still the known (open) state until the tick')
	await h.clock.advance(450)
	assert.ok(closedSent, 'a tick came within the active cadence (≤ 450 ms after the previous one, not after 1000 ms)')
	assert.equal(h.s.voteState.state, 'closed', 'the closed meta.vote arrived with the next tick')
	assert.equal(h.apiCalls.filter((c) => c[0] === 'startVote').length, 1, 'never repeated')
	h.s.destroy()
})

test('409 vote_closed (extend on an expired session) and timer_state re-apply meta; 403/429 and network errors do not poke the loop', async () => {
	const h = await open({
		me: ALICE,
		meta: { vote: voteMeta({ endsAt: T0 + 3600000 }) },
		api: {
			updateVote: () => { throw new HttpError(409, 'vote_closed', 'closed', null, true) },
			timer: () => { throw new HttpError(403, 'forbidden', 'x', null, true) },
		},
	})
	let pokes = 0
	const realPoke = h.s.sync.poke.bind(h.s.sync)
	h.s.sync.poke = () => { pokes++; realPoke() }
	let r = await h.s.updateVote('extend', 5)
	assert.deepEqual(r, { ok: false, code: 'vote_closed' })
	assert.equal(pokes, 1)
	assert.deepEqual(h.toasts, ['This vote has already ended.'])
	r = await h.s.timer('pause')
	assert.deepEqual(r, { ok: false, code: 'forbidden' })
	assert.equal(pokes, 1, '403: nothing stale, no poke')
	assert.equal(h.s.refreshMetaAfter(new HttpError(409, 'timer_state', 'x', null, true)), true)
	assert.equal(h.s.refreshMetaAfter(new HttpError(400, 'meta_too_large', 'x', null, true)), true)
	assert.equal(h.s.refreshMetaAfter(new HttpError(429, 'slow_down', 'x', null, true)), false)
	assert.equal(h.s.refreshMetaAfter(new Error('network')), false)
	assert.equal(pokes, 3)
	h.s.destroy()
})

test('sync answers of [B] (§4.5): only vote ops → acks.rev null; every vote op closed → no votes block, the optimistic vote goes back; left never negative', async () => {
	let mode = 'closed'
	const h = await open({
		me: BOB,
		meta: { vote: voteMeta() },
		votes: { sid: 12, mine: {}, left: 3 },
		reply: (b) => {
			if (!b.ops) {
				return null
			}
			if (mode === 'closed') {
				return { rev: b.since, acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'closed') }, presence: {} }
			}
			// a revived item overdrew the budget: the server clamps left at 0
			return { rev: b.since, acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'ok') }, votes: { sid: 12, mine: { [A]: 1, [B]: 1, [C]: 1 }, left: 0 }, presence: {} }
		},
	})
	assert.equal(h.s.uiMode(), 'vote')
	const waiting = h.s.replica.waiting.length
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.deepEqual(h.s.voteState.mine, { [A]: 1 }, 'optimistic')
	await h.clock.advance(1000)
	assert.deepEqual(h.s.voteState.mine, {}, 'no votes block: the server part stays {}, the rejected op is no longer pending')
	assert.equal(h.s.voteState.left, 3)
	assert.ok(h.infos.some((x) => Array.isArray(x) && x[1] === 'vote-closed'), 'the closed toast')
	assert.equal(h.s.replica.waiting.length, waiting, 'acks.rev null: vote ops never wait for a rev')
	assert.equal(h.s.replica.pendingCount(), 0)
	mode = 'ok'
	h.scene.callbacks.onIntent({ type: 'vote', id: B, rect: null })
	await h.clock.advance(1000)
	assert.equal(h.s.voteState.left, 0, 'clamped left = 0 is taken as is')
	assert.deepEqual(h.s.voteState.mine, { [A]: 1, [B]: 1, [C]: 1 })
	h.s.destroy()
})

test('R17 K4: with a session and the panel open, server changes (sticky added, removed, text edited, re-parented, frame renamed) refresh votableItems() and fire one ui.onVotes per tick; K2: a row on an item moved out of the scope still counts in mine/left but leaves the list', async () => {
	const D = ID(4)
	let next = null
	const h = await open({
		me: BOB,
		meta: { vote: voteMeta({ cfg: { per: 3, perItem: 1, scope: F, types: ['sticky'] } }) },
		votes: { sid: 12, mine: { [A]: 1 }, left: 2 },
		items: [
			frame(F, { x: 0, y: 0, w: 800, h: 600 }),
			sticky(A, { parent: F, x: 10, y: 10, data: { text: 'Alpha' } }),
			sticky(B, { parent: F, x: 300, y: 10, data: { text: 'Beta' } }),
			shape(C, { parent: F, x: 10, y: 400 }),
		],
		reply: (b) => {
			if (next === null || b.ops) {
				return null
			}
			const r = { rev: b.since + 1, items: [], removed: [], ...next, presence: {} }
			next = null
			return r
		},
	})
	assert.equal(h.s.uiMode(), 'vote')
	h.s.setVotePanelOpen(true)
	const list = () => h.s.votableItems().map((x) => [x.id, x.text, x.mine])
	assert.deepEqual(list(), [[A, 'Alpha', 1], [B, 'Beta', 0]])
	assert.equal(lastVotes(h).scopeTitle, '')
	/**
	 * Delivers one server change in the next sync answer.
	 *
	 * @param {object} change {items, removed}
	 * @return {Promise<number>} ui.onVotes calls during that tick
	 */
	const serve = async (change) => {
		const before = h.ui.votes.length
		next = change
		await h.clock.advance(2500)
		assert.equal(next, null, 'the change was delivered')
		return h.ui.votes.length - before
	}
	// a sticky added in the scope
	assert.equal(await serve({ items: [sticky(D, { parent: F, x: 10, y: 300, data: { text: 'Delta' } })] }), 1, 'one ui.onVotes for the change')
	assert.deepEqual(list(), [[A, 'Alpha', 1], [B, 'Beta', 0], [D, 'Delta', 0]])
	// a sticky deleted
	assert.equal(await serve({ removed: [B] }), 1)
	assert.deepEqual(list(), [[A, 'Alpha', 1], [D, 'Delta', 0]])
	// a text edited
	assert.equal(await serve({ items: [sticky(D, { parent: F, x: 10, y: 300, data: { text: 'Delta 2' } })] }), 1)
	assert.deepEqual(list(), [[A, 'Alpha', 1], [D, 'Delta 2', 0]])
	// re-parented out of the scope frame (K2): the list drops it, the row keeps counting
	assert.equal(await serve({ items: [sticky(A, { parent: null, x: 900, y: 10, data: { text: 'Alpha' } })] }), 1)
	assert.deepEqual(list(), [[D, 'Delta 2', 0]])
	assert.deepEqual(h.s.voteState.mine, { [A]: 1 }, 'K2: the row on the live item outside the scope stays in mine')
	assert.equal(h.s.voteState.left, 2, 'K2: and in left (no scope filter on counting)')
	assert.deepEqual(lastVotes(h).mine, { [A]: 1 })
	assert.equal(h.s.voteState.votable(h.model.get(A)), false, 'no own way in the UI to lower it (votable, missReason scope)')
	assert.equal(h.s.voteState.missReason(h.model.get(A)), 'scope')
	// the scope frame renamed: votesView().scopeTitle follows
	assert.equal(await serve({ items: [frame(F, { x: 0, y: 0, w: 800, h: 600, data: { title: 'Ideas' } })] }), 1)
	assert.equal(lastVotes(h).scopeTitle, 'Ideas')
	// a tick without changes emits nothing
	const quiet = h.ui.votes.length
	await h.clock.advance(2500)
	assert.equal(h.ui.votes.length, quiet, 'no model change: no ui.onVotes')
	// changes of the same turn are coalesced: one call
	const n0 = h.ui.votes.length
	h.s.onChanges([sticky(ID(5), { parent: F, x: 400, y: 300 })], [])
	h.s.onChanges([], [ID(5)])
	assert.equal(h.ui.votes.length, n0, 'not synchronous')
	await Promise.resolve()
	assert.equal(h.ui.votes.length, n0 + 1, 'one ui.onVotes for both changes of the turn')
	h.s.destroy()
	// no session: model changes never call ui.onVotes
	let more = null
	const g = await open({
		me: BOB,
		reply: (b) => {
			if (more === null || b.ops) {
				return null
			}
			const r = { rev: b.since + 1, items: [], removed: [], ...more, presence: {} }
			more = null
			return r
		},
	})
	const g0 = g.ui.votes.length
	more = { items: [sticky(D)] }
	await g.clock.advance(2500)
	assert.equal(more, null)
	assert.ok(g.model.has(D))
	assert.equal(g.ui.votes.length, g0, 'without a session nothing is emitted')
	g.s.destroy()
})

// ---- review round P7 (SPEC-M1 §33.1 i, R22) ----------------------------------

const stepperMeta = (extra = {}) => voteMeta({ cfg: { per: 9, perItem: 3, scope: null, types: ['sticky'] }, ...extra })
const lastStepper = (h) => h.ui.stepper[h.ui.stepper.length - 1]

test('R22 P7-08 (CLIENT-1): the stepper closes on every camera change it did not make (wheel, follow jump, fit, zoomToItem: onCamera with another camera); an unchanged camera report and its own votes keep it', async () => {
	const h = await open({ me: BOB, meta: { vote: stepperMeta() } })
	assert.equal(h.s.uiMode(), 'vote')
	h.scene.camera = { x: 100, y: 50, scale: 2 }
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: { x: 10, y: 20, w: 30, h: 40 } })
	assert.deepEqual(lastStepper(h), { id: A, rect: { x: 10, y: 20, w: 30, h: 40 } })
	h.scene.callbacks.onCamera({ x: 100, y: 50, scale: 2 })
	h.scene.callbacks.onCamera({ x: 100.2, y: 49.9, scale: 2 })
	assert.equal(lastStepper(h).id, A, 'the same camera (a late 10-Hz report, < 0.5 px): stays')
	assert.equal(h.s.vote(A, 1), true)
	await h.clock.advance(150)
	assert.equal(h.s.vote(A, 2), true)
	await h.clock.advance(1000)
	assert.equal(lastStepper(h).id, A, 'its own "+" keeps it')
	assert.deepEqual(h.s.voteState.mine, { [A]: 2 })
	h.scene.callbacks.onCamera({ x: 140, y: 50, scale: 2 })
	assert.equal(lastStepper(h), null, 'a pan (mouse wheel, trackpad) closes it')
	assert.equal(h.s.stepper, null)
	// zoom only
	h.scene.callbacks.onIntent({ type: 'vote', id: B, rect: { x: 10, y: 20, w: 30, h: 40 } })
	assert.equal(lastStepper(h).id, B)
	h.scene.callbacks.onCamera({ x: 100, y: 50, scale: 2.2 })
	assert.equal(lastStepper(h), null, 'a zoom closes it')
	// a follow jump (followTo reports onCamera like a gesture)
	h.scene.camera = { x: 0, y: 0, scale: 1 }
	h.scene.callbacks.onIntent({ type: 'vote', id: B, rect: null })
	h.scene.callbacks.onCamera({ x: 400, y: 0, scale: 1 })
	assert.equal(lastStepper(h), null)
	const n = h.ui.stepper.length
	h.s.closeStepper()
	assert.equal(h.ui.stepper.length, n, 'closing a closed stepper says nothing')
	h.s.destroy()
})

test('R22 P7-08 (CLIENT-7, missed hint 1): the stepper closes when its item is deleted, leaves the voting area, the mode leaves vote, the right to vote goes, the session ends, or the board freezes', async () => {
	// deleted remotely
	let removeA = false
	const h = await open({ me: BOB, meta: { vote: stepperMeta() }, reply: (b) => (removeA ? (removeA = false, { rev: 9, removed: [A], presence: {} }) : null) })
	h.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.equal(lastStepper(h).id, A)
	removeA = true
	await h.clock.advance(1000)
	await h.clock.settle()
	assert.equal(h.model.has(A), false)
	assert.equal(lastStepper(h), null, 'item gone: closed')
	// the mode leaves vote (desktop switch "Edit")
	h.scene.callbacks.onIntent({ type: 'vote', id: B, rect: null })
	assert.equal(lastStepper(h).id, B)
	h.s.setPreferVote(false)
	assert.equal(h.s.uiMode(), 'edit')
	assert.equal(lastStepper(h), null, 'mode edit: closed')
	h.s.setPreferVote(true)
	// the right to vote goes (downgraded to view)
	h.scene.callbacks.onIntent({ type: 'vote', id: B, rect: null })
	assert.equal(lastStepper(h).id, B)
	h.s.onRole({ role: 'view', mod: false })
	assert.equal(h.s.uiMode(), 'view')
	assert.equal(lastStepper(h), null, 'no right to vote: closed')
	h.s.destroy()
	// leaves the voting area (moved out of the scope frame)
	const items = [frame(F, { data: { title: 'Ideas' } }), sticky(A, { parent: F }), sticky(B, { parent: F })]
	let move = false
	const g = await open({ me: BOB, items, meta: { vote: stepperMeta({ cfg: { per: 9, perItem: 3, scope: F, types: ['sticky'] } }) }, reply: (b) => (move ? (move = false, { rev: 9, items: [sticky(A, { parent: null })], presence: {} }) : null) })
	g.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.equal(lastStepper(g).id, A)
	move = true
	await g.clock.advance(1000)
	await g.clock.settle()
	assert.equal(g.model.get(A).parent ?? null, null)
	assert.equal(lastStepper(g), null, 'outside the scope: closed')
	// the session ends
	g.scene.callbacks.onIntent({ type: 'vote', id: B, rect: null })
	assert.equal(lastStepper(g).id, B)
	g.s.onMeta({ metaRev: 9, meta: { vote: stepperMeta({ state: 'closed', cfg: { per: 9, perItem: 3, scope: F, types: ['sticky'] }, results: [], total: 0, voters: 0, closedAt: T0 }) } })
	assert.equal(lastStepper(g), null, 'session closed: closed')
	g.s.destroy()
	// frozen
	let gone = false
	const f = await open({ me: BOB, meta: { vote: stepperMeta() }, reply: () => (gone ? new HttpError(404, 'not_found', '', null, true) : null) })
	f.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.equal(lastStepper(f).id, A)
	gone = true
	await f.clock.advance(3000)
	assert.equal(f.s.frozen, true)
	assert.equal(lastStepper(f), null, 'frozen: closed')
	f.s.destroy()
})

test('R22 P7-10 (CLIENT-3): list and stepper "+" twice 150 ms apart give 2 (two vote ops), a third over perItem says vote-limit; only the canvas toggle tap of perItem 1 has the double-tap lock', async () => {
	const h = await open({ me: BOB, meta: { vote: voteMeta({ cfg: { per: 9, perItem: 2, scope: null, types: ['sticky'] } }) } })
	assert.equal(h.s.vote(A, 1), true)
	await h.clock.advance(150)
	assert.equal(h.s.vote(A, 2), true, 'the second "+" 150 ms later')
	await h.clock.advance(100)
	assert.equal(h.s.vote(A, 3), false)
	assert.deepEqual(h.infos.filter(Array.isArray), [['You have no votes left.', 'vote-limit']], 'B14: the click over the limit says so')
	await h.clock.advance(1000)
	assert.deepEqual(h.s.voteState.mine, { [A]: 2 })
	const ops = h.tr.calls.flatMap((b) => b.ops ?? []).filter((o) => o.o === 'vote' && o.id === A)
	assert.equal(ops[ops.length - 1].n, 2, 'the server gets 2')
	h.s.destroy()
	// perItem 1: the canvas toggle keeps its double-tap lock
	const t = await open({ me: BOB, meta: { vote: voteMeta() } })
	t.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	await t.clock.advance(150)
	t.scene.callbacks.onIntent({ type: 'vote', id: A, rect: null })
	assert.deepEqual(t.s.voteState.mine, { [A]: 1 }, 'a double tap within 400 ms does not take the vote back')
	t.s.destroy()
})

/** Scene with the real cameraForRect of the facade (SceneManager, container 1280 × 720). */
class CamScene extends Stage3Scene {
	constructor(container, model, opts) {
		super(container, model, opts)
		this.size = { w: 1280, h: 720 }
		this.camera = { x: 0, y: 0, scale: 1 }
	}

	getViewport() {
		const c = this.camera
		return { x: c.x, y: c.y, w: this.size.w / c.scale, h: this.size.h / c.scale }
	}

	cameraForRect(rect, padPx = 0) {
		const aw = Math.max(1, this.size.w - 2 * padPx)
		const ah = Math.max(1, this.size.h - 2 * padPx)
		const scale = Math.min(4, Math.max(0.1, Math.min(rect.w > 0 ? aw / rect.w : Infinity, rect.h > 0 ? ah / rect.h : Infinity)))
		return { x: rect.x + rect.w / 2 - this.size.w / (2 * scale), y: rect.y + rect.h / 2 - this.size.h / (2 * scale), scale }
	}
}

test('R22 P7-11 (CLIENT-4): zoomToItem(id, {right}) / ({left}) puts the item centred into the canvas part a side panel leaves free; without a reserve the whole canvas', async () => {
	const items = [sticky(A, { x: 1000, y: 400, w: 300, h: 300 }), sticky(B, { x: 0, y: 0, w: 2000, h: 100 })]
	const h = await open({ me: BOB, items })
	Object.setPrototypeOf(h.scene, CamScene.prototype)
	h.scene.size = { w: 1280, h: 720 }
	h.scene.camera = { x: 0, y: 0, scale: 1 }
	const screen = (id) => {
		const c = h.scene.camera
		const it = h.model.abs(id)
		return { l: (it.x - c.x) * c.scale, r: (it.x + it.w - c.x) * c.scale, cx: (it.x + it.w / 2 - c.x) * c.scale, cy: (it.y + it.h / 2 - c.y) * c.scale }
	}
	assert.equal(h.s.zoomToItem(A), true)
	assert.ok(Math.abs(screen(A).cx - 640) < 0.01, 'no panel: the canvas centre')
	assert.equal(h.s.zoomToItem(A, { right: 360 }), true)
	const r = screen(A)
	assert.ok(Math.abs(r.cx - 460) < 0.01, 'centred in the free part 0…920: ' + r.cx)
	assert.ok(r.r <= 920 - 40 + 0.01 && r.l >= 0, 'the whole item left of the panel, with the 40 px pad')
	assert.ok(Math.abs(r.cy - 360) < 0.01)
	assert.equal(h.s.zoomToItem(A, { left: 360 }), true)
	assert.ok(Math.abs(screen(A).cx - 820) < 0.01, 'RTL: free part 360…1280')
	// a wide item: limited by the free width
	h.s.zoomToItem(B, { right: 360 })
	const w = screen(B)
	assert.ok(w.l >= 40 - 0.01 && w.r <= 920 - 40 + 0.01, 'fits into the free part: ' + JSON.stringify(w))
	// nothing would stay free: the plain zoom
	h.s.zoomToItem(A, { right: 1280 })
	assert.ok(Math.abs(screen(A).cx - 640) < 0.01)
	h.s.destroy()
})

test('R22 P7-09 (CLIENT-9, missed hint 3): Esc in an input field (title, Nextcloud search, rescue texts, contenteditable) keeps following, also when the field\'s own handler removed it first; Esc elsewhere and in the paste catcher ends it', async () => {
	const handlers = {}
	const doc = { addEventListener: (t, fn) => { handlers['doc:' + t] = fn }, removeEventListener: () => {}, visibilityState: 'visible', activeElement: null, body: null }
	const win = { addEventListener: (t, fn) => { handlers['win:' + t] = fn }, removeEventListener: () => {}, document: doc }
	const pres = { 'pidcarol0000001:cC1': { n: 'Carol', k: 'pidcarol0000001', g: 0, x: 1, y: 2, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
	const h = await open({ me: BOB, presence: () => pres, win })
	await h.clock.advance(1000)
	const el = (tagName, extra = {}) => ({ tagName, hasAttribute: (n) => extra.attrs?.includes(n) ?? false, isContentEditable: !!extra.editable })
	h.s.follow('pidcarol0000001', 'cC1')
	const following = () => debugApi(h.s).state().following
	for (const target of [el('INPUT'), el('TEXTAREA'), el('SELECT'), el('DIV', { editable: true })]) {
		doc.activeElement = target
		handlers['doc:keydown']({ key: 'Escape', target })
		assert.equal(following(), 'pidcarol0000001', target.tagName + ' focused')
	}
	// the title field's Esc handler removed the field before the bubble listener: the key's target still counts
	doc.activeElement = null
	handlers['doc:keydown']({ key: 'Escape', target: el('INPUT') })
	assert.equal(following(), 'pidcarol0000001', 'target was an input')
	// the focus in a field, the event from elsewhere (e.g. a synthetic one)
	doc.activeElement = el('INPUT')
	handlers['doc:keydown']({ key: 'Escape', target: el('BODY') })
	assert.equal(following(), 'pidcarol0000001', 'an input has the focus')
	// the paste catcher is no input field
	const catcher = el('TEXTAREA', { attrs: ['data-knorke-paste-catcher'] })
	doc.activeElement = catcher
	handlers['doc:keydown']({ key: 'Escape', target: catcher })
	assert.equal(following(), null, 'Esc with the paste catcher focused ends following')
	h.s.follow('pidcarol0000001', 'cC1')
	doc.activeElement = el('DIV')
	handlers['doc:keydown']({ key: 'Escape', target: el('DIV') })
	assert.equal(following(), null, 'Esc on the canvas ends following')
	h.s.destroy()
})

test('R22 P7-09 (CLIENT-2): the presenting tab sends {v} while hidden (getHiddenPresence, every hidden tick); not presenting or frozen: nothing', async () => {
	const listeners = []
	const doc = { addEventListener: (t, fn) => listeners.push(['doc', t, fn]), removeEventListener: () => {}, visibilityState: 'visible', activeElement: null, body: null }
	const win = { addEventListener: (t, fn) => listeners.push(['win', t, fn]), removeEventListener: () => {}, document: doc }
	const fire = (who, type) => listeners.filter((l) => l[0] === who && l[1] === type).forEach((l) => l[2]({}))
	const h = await open({ me: { ...ALICE }, meta: { vote: voteMeta() }, win })
	assert.equal(h.s.getHiddenPresence(), null, 'no summon: nothing')
	h.s.onMeta({ metaRev: 4, meta: { vote: voteMeta(), summon: { pid: ALICE.pid, client: h.s.client, name: 'Alice Adler', seq: 1, at: T0 } } })
	assert.deepEqual(h.s.getHiddenPresence(), { v: [10, -20.1, 1280, 720] })
	await h.clock.advance(1000)
	doc.visibilityState = 'hidden'
	fire('doc', 'visibilitychange')
	const from = h.tr.calls.length
	await h.clock.advance(15000)
	const hidden = h.tr.calls.slice(from)
	assert.equal(hidden.length, 3, 'hidden cadence 5 s')
	assert.ok(hidden.every((b) => b.pres === 0 && JSON.stringify(b.me) === JSON.stringify({ v: [10, -20.1, 1280, 720] })), 'every hidden request carries {v}: ' + JSON.stringify(hidden.map((b) => b.me)))
	// another tab of mine presents now: this hidden tab sends nothing
	h.s.onMeta({ metaRev: 5, meta: { vote: voteMeta(), summon: { pid: ALICE.pid, client: 'cOtherTab1', name: 'Alice Adler', seq: 2, at: T0 } } })
	assert.equal(h.s.getHiddenPresence(), null)
	const from2 = h.tr.calls.length
	await h.clock.advance(10000)
	assert.ok(h.tr.calls.slice(from2).every((b) => b.me === undefined))
	h.s.destroy()
})
