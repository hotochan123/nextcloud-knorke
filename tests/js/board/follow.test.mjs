/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * FollowController (SPEC-M1 §6.5.6, stage 3): target '<pid>:<client>' or
 * the youngest entry of a pid (R16 CLI-16), camera per presence card with a
 * clamped glide (R16 CLI-05: false never ends following), the end rules,
 * "Bring everyone here" as the pair (seq, at) (R16 SRV-04, incl. the unit
 * case "seq 1 left, DELETE not seen, new summon seq 1 with another at →
 * follows"), the chip, and no jumps under the finger while a session is
 * open (press + HOLD_MS).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FollowController, GLIDE_MAX_MS, GLIDE_MIN_MS, HOLD_MS, STALE_MS, clampGlide, samePair, summonOf } from '../../../src/board/follow.js'
import { PresenceModel } from '../../../src/sync/presence.js'
import { FakeClock } from '../sync/fakeClock.mjs'

const ME = { pid: 'pidme00000000001', client: 'cMe0000001' }
const ALICE = 'pidalice00000001'
const BOB = 'pidbob0000000001'

/** A scene with the follow part of the facade; followTo resolves `answer`. */
class FollowScene {
	constructor() {
		this.calls = []
		this.answer = true
		this.stops = 0
	}

	cameraForRect(rect, pad) {
		return { x: rect.x, y: rect.y, scale: 1000 / rect.w, pad }
	}

	followTo(cam, ms) {
		this.calls.push({ cam, ms })
		return Promise.resolve(this.answer)
	}

	stopFollow() {
		this.stops++
	}
}

/**
 * @param {object} [o] options
 * @return {object} harness
 */
function setup({ sessionOpen = false } = {}) {
	const clock = new FakeClock(100000)
	const presence = new PresenceModel({ now: clock.now })
	const scene = new FollowScene()
	const changes = []
	const left = []
	let open = sessionOpen
	const fc = new FollowController({
		scene: () => scene,
		presence,
		now: clock.now,
		sleep: clock.sleep,
		self: () => ME,
		sessionOpen: () => open,
		onChange: (st) => changes.push(st),
		onLeft: (name) => left.push(name),
	})
	const card = async (map, ms = 0) => {
		if (ms > 0) {
			await clock.advance(ms)
		}
		presence.update(map, clock.now())
		fc.onPresence()
		await clock.settle()
	}
	return { clock, presence, scene, fc, changes, left, card, setOpen: (v) => { open = v } }
}

const entry = (name, v) => ({ n: name, k: name === 'Alice' ? ALICE : BOB, g: 0, x: 0, y: 0, s: [], d: [], e: null, h: 0, v })

test('helpers: clampGlide 300–2000, summonOf, samePair', () => {
	assert.equal(clampGlide(10), GLIDE_MIN_MS)
	assert.equal(clampGlide(5000), GLIDE_MAX_MS)
	assert.equal(clampGlide(1000), 1000)
	assert.equal(clampGlide(NaN), GLIDE_MAX_MS)
	assert.equal(summonOf(null), null)
	assert.equal(summonOf({ pid: 'x' }), null, 'seq required')
	assert.deepEqual(summonOf({ pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 5 }), { pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 5 })
	assert.equal(samePair({ seq: 1, at: 5 }, { seq: 1, at: 5 }), true)
	assert.equal(samePair({ seq: 1, at: 5 }, { seq: 1, at: 6 }), false)
	assert.equal(samePair(null, { seq: 1, at: 5 }), false)
})

test('follow(pid, client): every presence card → followTo(cameraForRect(v, 0), glide = observed interval clamped); an unchanged v is not sent again', async () => {
	const h = setup()
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	assert.equal(h.fc.follow(ALICE, 'c1'), true)
	assert.deepEqual(h.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: false })
	assert.equal(h.scene.calls.length, 1)
	assert.deepEqual(h.scene.calls[0].cam, { x: 0, y: 0, scale: 1, pad: 0 })
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }, 400)
	assert.equal(h.scene.calls.length, 1, 'same viewport: nothing to do')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 50, 1000, 500]) }, 400)
	assert.equal(h.scene.calls.length, 2)
	assert.equal(h.scene.calls[1].ms, 400, 'glide = card interval')
	await h.card({ [ALICE + ':c1']: entry('Alice', [200, 50, 1000, 500]) }, 100)
	assert.equal(h.scene.calls[2].ms, GLIDE_MIN_MS, 'clamped to 300')
	await h.card({ [ALICE + ':c1']: entry('Alice', [300, 50, 1000, 500]) }, 5000)
	assert.equal(h.scene.calls[3].ms, GLIDE_MAX_MS, 'clamped to 2000')
})

test('followTo resolving false never ends following (R16 CLI-05): the next card tries the same viewport again', async () => {
	const h = setup()
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.scene.answer = false
	h.fc.follow(ALICE, 'c1')
	await h.clock.settle()
	assert.ok(h.fc.following, 'still following')
	h.scene.answer = true
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }, 400)
	assert.equal(h.scene.calls.length, 2, 'retried after false')
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }, 400)
	assert.equal(h.scene.calls.length, 2, 'then quiet again')
})

/** A scene whose glides run until replaced: a newer followTo resolves the running one false (§6.3 "Folgen" (2)). */
class GlideScene extends FollowScene {
	constructor() {
		super()
		this.running = null
	}

	followTo(cam, ms) {
		this.calls.push({ cam, ms })
		if (this.running) {
			const r = this.running
			this.running = null
			r(false)
		}
		return new Promise((resolve) => {
			this.running = resolve
		})
	}

	/** The running glide reaches its target. */
	finish() {
		const r = this.running
		this.running = null
		r?.(true)
	}
}

test('RV-C-01: the false of a REPLACED glide is not charged to the newest followTo: an unchanged viewport is not sent again (cards v1, v2, v2 → 2 calls)', async () => {
	const h = setup()
	const scene = new GlideScene()
	h.fc.scene = () => scene
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.follow(ALICE, 'c1')
	await h.clock.settle()
	assert.equal(scene.calls.length, 1, 'v1: glide A')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 2, 'v2: glide B replaces A (A resolves false)')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 2, 'v2 again while B runs: not sent again')
	assert.equal(h.fc.lastOk, true, 'B never failed')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 2, 'still quiet: no chain of replaced glides')
	scene.finish()
	await h.clock.settle()
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 2, 'B arrived: quiet')
	assert.ok(h.fc.following, 'still following')
})

test('RV-C-01: the newest followTo answering false still retries the same viewport on the next card (CLI-05)', async () => {
	const h = setup()
	const scene = new GlideScene()
	h.fc.scene = () => scene
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.follow(ALICE, 'c1')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 2)
	// the newest glide (B) itself ends false (e.g. the scene could not finish it)
	const r = scene.running
	scene.running = null
	r(false)
	await h.clock.settle()
	assert.equal(h.fc.lastOk, false)
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 3, 'retried after its own false')
	assert.deepEqual(scene.calls[2].cam, scene.calls[1].cam)
	// a rejection of an older call does not count either
	await h.card({ [ALICE + ':c1']: entry('Alice', [200, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 4)
	assert.equal(h.fc.lastOk, true)
})

test('RV-C-01: a glide of an earlier follow() that ends false after a new follow() does not count', async () => {
	const h = setup()
	const scene = new GlideScene()
	h.fc.scene = () => scene
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]), [BOB + ':c2']: entry('Bob', [500, 0, 1000, 500]) })
	h.fc.follow(ALICE, 'c1')
	assert.equal(scene.calls.length, 1)
	const old = scene.running
	scene.running = null
	h.fc.follow(BOB, 'c2')
	assert.equal(scene.calls.length, 2, 'Bob: one glide')
	old(false)
	await h.clock.settle()
	assert.equal(h.fc.lastOk, true, 'the old answer belongs to Alice')
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]), [BOB + ':c2']: entry('Bob', [500, 0, 1000, 500]) }, 400)
	assert.equal(scene.calls.length, 2, 'Bob unchanged: not sent again')
})

test('without client: the entry of the pid whose v changed last (CLI-16); a tie goes to the smallest key', async () => {
	const h = setup()
	await h.card({ [ALICE + ':c2']: entry('Alice', [0, 0, 1000, 500]), [ALICE + ':c1']: entry('Alice', [5, 5, 1000, 500]) })
	assert.equal(h.presence.youngestViewKey(ALICE), ALICE + ':c1', 'same arrival: smallest key')
	await h.card({ [ALICE + ':c2']: entry('Alice', [9, 9, 1000, 500]), [ALICE + ':c1']: entry('Alice', [5, 5, 1000, 500]) }, 400)
	assert.equal(h.presence.youngestViewKey(ALICE), ALICE + ':c2', 'c2 changed last')
	h.fc.follow(ALICE)
	assert.equal(h.fc.following.client, 'c2')
})

test('end rules: own camera, Esc, own edit intent/activity in mode edit (not press, not a vote tap), the target itself', async () => {
	const h = setup()
	const map = { [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }
	await h.card(map)
	h.fc.follow(ALICE, 'c1')
	h.fc.onUserCamera()
	assert.equal(h.fc.following, null)
	assert.ok(h.scene.stops >= 1, 'stopFollow ends a running glide')
	h.fc.follow(ALICE, 'c1')
	h.fc.onEsc()
	assert.equal(h.fc.following, null)
	h.fc.follow(ALICE, 'c1')
	h.fc.onIntent({ type: 'vote', id: 'x' }, 'vote')
	h.fc.onActivity({ kind: 'press', active: true }, 'vote')
	h.fc.onActivity({ kind: 'press', active: false }, 'vote')
	assert.ok(h.fc.following, 'a tap to vote (mode vote) keeps following')
	h.fc.onActivity({ kind: 'drag', active: true }, 'edit')
	assert.equal(h.fc.following, null, 'own drag in mode edit ends it')
	h.fc.follow(ALICE, 'c1')
	h.fc.onIntent({ type: 'create' }, 'edit')
	assert.equal(h.fc.following, null)
	assert.equal(h.fc.follow(ME.pid, ME.client), false, 'never myself')
})

test('a target without a card for more than STALE_MS has left: "{name} left."', async () => {
	const h = setup()
	await h.card({ [BOB + ':c9']: entry('Bob', [0, 0, 1000, 500]) })
	h.fc.follow(BOB, 'c9')
	await h.card({}, 4000)
	assert.ok(h.fc.following, 'not yet')
	await h.card({}, STALE_MS)
	assert.equal(h.fc.following, null)
	assert.deepEqual(h.left, ['Bob'])
})

test('summon: a new pair follows with the banner; leaving remembers the pair; the chip brings back; summon gone ends it', async () => {
	const h = setup()
	const s1 = { pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 1000 }
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.onSummon(s1)
	assert.deepEqual(h.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: true })
	assert.equal(h.fc.chip(), null, 'no chip while following')
	h.fc.onUserCamera()
	assert.equal(h.fc.following, null)
	assert.deepEqual(h.fc.chip(), { pid: ALICE, client: 'c1', name: 'Alice' }, 'the chip: fresh entry with v')
	h.fc.onSummon({ ...s1 })
	assert.equal(h.fc.following, null, 'the same pair does not pull back')
	assert.equal(h.fc.followPresenter(), true)
	assert.equal(h.fc.following.summon, true)
	h.fc.onSummon(undefined)
	assert.equal(h.fc.following, null, 'summon removed → following ends')
	assert.equal(h.fc.chip(), null)
})

test('R16 SRV-04 unit case: seq 1 left, DELETE not seen, a new summon with seq 1 and another at → follows again', async () => {
	const h = setup()
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.onSummon({ pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 1000 })
	h.fc.onUserCamera()
	assert.equal(h.fc.following, null, 'left the first call')
	// DELETE summon happened on the server, this client never saw meta without summon
	h.fc.onSummon({ pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 9000 })
	assert.deepEqual(h.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: true })
})

test('my own summon (any tab of my pid) is never followed; no chip for it', async () => {
	const h = setup()
	await h.card({ [ME.pid + ':cOther0001']: entry('Me', [0, 0, 1000, 500]) })
	h.fc.onSummon({ pid: ME.pid, client: 'cOther0001', name: 'Me', seq: 1, at: 1 })
	assert.equal(h.fc.following, null)
	assert.equal(h.fc.chip(), null)
})

test('no jumps under the finger while a session is open: held during press and HOLD_MS after it, then the newest target in one step', async () => {
	const h = setup({ sessionOpen: true })
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.follow(ALICE, 'c1')
	assert.equal(h.scene.calls.length, 1)
	h.fc.onActivity({ kind: 'press', active: true }, 'vote')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	await h.card({ [ALICE + ':c1']: entry('Alice', [200, 0, 1000, 500]) }, 400)
	assert.equal(h.scene.calls.length, 1, 'held while the finger is down')
	h.fc.onActivity({ kind: 'press', active: false }, 'vote')
	await h.clock.advance(HOLD_MS - 10)
	assert.equal(h.scene.calls.length, 1, 'still held 1.5 s after the press')
	await h.clock.advance(20)
	assert.equal(h.scene.calls.length, 2, 'then one step')
	assert.equal(h.scene.calls[1].cam.x, 200, 'only the newest target')
	h.fc.destroy()
})

test('without an open session a press holds nothing', async () => {
	const h = setup({ sessionOpen: false })
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.follow(ALICE, 'c1')
	h.fc.onActivity({ kind: 'press', active: true }, 'view')
	await h.card({ [ALICE + ':c1']: entry('Alice', [100, 0, 1000, 500]) }, 400)
	assert.equal(h.scene.calls.length, 2)
})

test('R22 P7-09 (CLIENT-2): the presenter\'s entry goes stale ("left") – the same summon pulls this client back with the banner as soon as a fresh entry with v comes', async () => {
	const h = setup()
	const s1 = { pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 1000 }
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	h.fc.onSummon(s1)
	assert.deepEqual(h.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: true })
	// the presenter's tab is hidden and sends nothing: the server drops the entry
	await h.card({}, 5000)
	await h.card({}, STALE_MS)
	assert.equal(h.fc.following, null)
	assert.deepEqual(h.left, ['Alice'])
	assert.equal(h.fc.exited, null, 'left is no own exit: the pair is not remembered')
	await h.card({}, 3000)
	assert.equal(h.fc.following, null, 'no entry yet: nothing to follow')
	// the presenter is back (or its hidden tab sends {v} again)
	const before = h.changes.length
	await h.card({ [ALICE + ':c1']: entry('Alice', [50, 0, 1000, 500]) }, 2000)
	assert.deepEqual(h.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: true }, 'back to the presenter, banner as for the summon')
	assert.ok(h.changes.slice(before).some((c) => c.following?.summon === true && c.chip === null), 'onChange: following with the summon flag, no chip')
	assert.ok(h.scene.calls.length >= 2, 'the camera follows again')
	// meta.summon arriving again unchanged does not disturb it
	h.fc.onSummon({ ...s1 })
	assert.equal(h.fc.following.summon, true)
})

test('R22 P7-09: an own exit (camera, Esc, Stop button) stays an exit while fresh cards come; a new pair pulls back; summon gone forgets everything', async () => {
	for (const leave of [(fc) => fc.onUserCamera(), (fc) => fc.onEsc(), (fc) => fc.stop('user')]) {
		const h = setup()
		const s1 = { pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 1000 }
		await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
		h.fc.onSummon(s1)
		leave(h.fc)
		assert.equal(h.fc.following, null)
		assert.deepEqual(h.fc.exited, { seq: 1, at: 1000 })
		await h.card({ [ALICE + ':c1']: entry('Alice', [10, 0, 1000, 500]) }, 1000)
		await h.card({ [ALICE + ':c1']: entry('Alice', [20, 0, 1000, 500]) }, 1000)
		assert.equal(h.fc.following, null, 'fresh cards never undo an own exit')
		assert.deepEqual(h.fc.chip(), { pid: ALICE, client: 'c1', name: 'Alice' }, 'the chip offers the way back')
		h.fc.onSummon({ ...s1, seq: 2, at: 5000 })
		assert.equal(h.fc.following.summon, true, 'a new call pulls back')
	}
})

test('R22 P7-09: no return while following somebody else, for my own summon, or when the presenter\'s entry has no v', async () => {
	const h = setup()
	const s1 = { pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 1000 }
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]), [BOB + ':c9']: entry('Bob', [0, 0, 1000, 500]) })
	h.fc.onSummon(s1)
	h.fc.follow(BOB, 'c9')
	await h.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]), [BOB + ':c9']: entry('Bob', [5, 0, 1000, 500]) }, 1000)
	assert.equal(h.fc.following.pid, BOB, 'following somebody else is kept')
	// the presenter's entry comes back without v: no return (yet)
	const g = setup()
	await g.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) })
	g.fc.onSummon(s1)
	await g.card({}, 5000)
	await g.card({}, STALE_MS)
	assert.equal(g.fc.following, null, 'left')
	await g.card({ [ALICE + ':c1']: entry('Alice', null) }, 1000)
	assert.equal(g.fc.following, null, 'an entry without v is nothing to follow')
	await g.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }, 1000)
	assert.equal(g.fc.following?.summon, true, 'with v: back')
	// my own summon
	const m = setup()
	await m.card({ [ME.pid + ':cOther0001']: entry('Me', [0, 0, 1000, 500]) })
	m.fc.onSummon({ pid: ME.pid, client: 'cOther0001', name: 'Me', seq: 1, at: 1 })
	await m.card({ [ME.pid + ':cOther0001']: entry('Me', [0, 0, 1000, 500]) }, 1000)
	assert.equal(m.fc.following, null)
})

test('R22 VC-03: switching from the summon follow to another target (PresenceBar → followParticipant) is an own exit: ending that follow does not pull back; the chip offers the way back', async () => {
	const s1 = { pid: ALICE, client: 'c1', name: 'Alice', seq: 1, at: 1000 }
	const both = (bx) => ({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]), [BOB + ':c9']: entry('Bob', [bx, 0, 1000, 500]) })
	for (const [pid, client, want] of [[BOB, 'c9', 'c9'], [BOB, null, 'c9'], [ALICE, null, 'c1']]) {
		const h = setup()
		await h.card(both(0))
		h.fc.onSummon(s1)
		assert.equal(h.fc.following.summon, true)
		assert.equal(h.fc.follow(pid, client), true)
		assert.deepEqual(h.fc.following, { pid, client: want, name: pid === ALICE ? 'Alice' : 'Bob', summon: false }, 'a plain follow replaces the summon follow')
		assert.deepEqual(h.fc.exited, { seq: 1, at: 1000 }, 'the switch remembers the pair')
		h.fc.onUserCamera()
		assert.equal(h.fc.following, null)
		await h.card(both(5), 1000)
		assert.equal(h.fc.following, null, 'the next card does not pull back to the presenter')
		await h.card(both(10), 1000)
		assert.equal(h.fc.following, null, 'nor the one after')
		assert.deepEqual(h.fc.chip(), { pid: ALICE, client: 'c1', name: 'Alice' }, 'the chip offers the way back')
		assert.equal(h.fc.followPresenter(), true)
		assert.deepEqual(h.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: true }, 'the chip follows the presenter again')
	}
	// the other target leaves: still no pull back for the same pair; a new pair pulls back
	const g = setup()
	await g.card(both(0))
	g.fc.onSummon(s1)
	g.fc.follow(BOB, null)
	await g.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }, 5000)
	await g.card({ [ALICE + ':c1']: entry('Alice', [0, 0, 1000, 500]) }, STALE_MS)
	assert.equal(g.fc.following, null)
	assert.deepEqual(g.left, ['Bob'])
	await g.card({ [ALICE + ':c1']: entry('Alice', [20, 0, 1000, 500]) }, 1000)
	assert.equal(g.fc.following, null, 'the pair was left with the switch')
	g.fc.onSummon({ ...s1, seq: 2, at: 7000 })
	assert.deepEqual(g.fc.following, { pid: ALICE, client: 'c1', name: 'Alice', summon: true }, 'a new call pulls back')
	// summon calls themselves never count as a switch
	const k = setup()
	await k.card(both(0))
	k.fc.onSummon(s1)
	assert.equal(k.fc.followPresenter(), true)
	assert.equal(k.fc.exited, null, 'the chip path is no exit')
	k.fc.onSummon({ ...s1, seq: 2, at: 8000 })
	assert.equal(k.fc.exited, null, 'a new pair replacing the summon follow is no exit')
	assert.equal(k.fc.following.summon, true)
})
