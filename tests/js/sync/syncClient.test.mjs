/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError, request } from '../../../src/sync/http.js'
import { PROTOCOL } from '../../../src/sync/protocol.js'
import { Replica } from '../../../src/sync/Replica.js'
import { DEFAULT_EPOCH, KEEPALIVE_MAX_BYTES, RATE_LIMITED, SyncClient, finalOf403, protoOf } from '../../../src/sync/SyncClient.js'
import { FakeClock, fakeTransport } from './fakeClock.mjs'

const S1 = '01JA0000000000000000000001'

/**
 * @param {object} o options
 * @return {{clock: FakeClock, tr: object, replica: Replica, client: SyncClient, log: object}}
 */
function setup({ handler = (b) => ({ rev: b.since, presence: {} }), kind = 'user', getPresence = () => null, viewOnly = false, onResync = null, rand = () => 0.5, extra = {} } = {}) {
	const clock = new FakeClock(10000)
	const tr = fakeTransport(clock, handler, kind)
	const replica = new Replica()
	const log = { statuses: [], reasons: [], acks: [], changes: [], presence: [], settled: [], resyncs: [] }
	const client = new SyncClient({
		transport: tr,
		replica,
		client: 'cTEST00001',
		getPresence,
		viewOnly,
		onChanges: (items, removed) => log.changes.push({ items, removed }),
		onAcks: (acks) => {
			log.acks.push(acks)
			replica.ack(acks)
		},
		onSettled: (c) => log.settled.push(c),
		onPresence: (m) => log.presence.push(m),
		onStatus: (s, reason) => {
			log.statuses.push(s)
			log.reasons.push(reason)
		},
		onResync: onResync ?? (async () => {
			log.resyncs.push(clock.now())
			return 100
		}),
		now: clock.now,
		sleep: clock.sleep,
		rand,
		...extra,
	})
	return { clock, tr, replica, client, log }
}

test('exactly one request in flight; the tick counts from the request start', async () => {
	let release
	const { clock, tr, client } = setup({
		handler: (b) => new Promise((resolve) => { release = () => resolve({ rev: b.since, presence: {} }) }),
	})
	client.start(5)
	await clock.advance(0)
	assert.equal(tr.calls.length, 1, 'first request goes out at once')
	await clock.advance(20000)
	assert.equal(tr.calls.length, 1, 'no second request while the first is open')
	release()
	await clock.advance(0)
	// t0 of the first request was 10000; the answer came at 30000 → next at once
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].at, 30000)
	release()
	await clock.advance(999)
	assert.equal(tr.calls.length, 2)
	await clock.advance(1)
	assert.equal(tr.calls.length, 3, 'idle tick 1000 ms from the start of request 2')
	client.stop()
})

test('more → next request at once; cursor follows rev; onChanges and onSettled', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		handler: (b) => {
			n++
			if (n === 1) {
				return { rev: 7, items: [{ id: S1 }], more: true, presence: {} }
			}
			return { rev: 9, presence: {} }
		},
	})
	client.start(5)
	await clock.advance(0)
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].body.since, 7)
	assert.equal(tr.calls[1].at, tr.calls[0].at)
	assert.equal(client.cursor, 9)
	assert.deepEqual(log.settled, [7, 9])
	assert.equal(log.changes[0].items[0].id, S1)
	client.stop()
})

test('body: proto, client, since, ep, pres; ops with seq only when queued', async () => {
	const { clock, tr, client, replica } = setup()
	client.start(3)
	await clock.advance(0)
	assert.deepEqual(tr.calls[0].body, { proto: 2, client: 'cTEST00001', since: 3, ep: '0', pres: 1 }, 'no epoch known yet: ep "0" (never omitted, the server answers 400 without it)')
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }])
	await clock.advance(150)
	assert.equal(tr.calls.length, 2, 'urgent op: at most commitGapMs after t0')
	assert.equal(tr.calls[1].body.seq, 1)
	assert.equal(tr.calls[1].body.ops.length, 1)
	assert.equal(replica.hasInflight(), true, 'no acks in the answer: batch stays in flight')
	client.stop()
})

test('non-urgent ops ride the normal tick; poke never sends before t0 + activeMs', async () => {
	const { clock, tr, client } = setup()
	client.start(1)
	await clock.advance(0)
	const t0 = tr.calls[0].at
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'typing' } }], { urgent: false })
	await clock.advance(380)
	assert.equal(tr.calls.length, 1, 'text intermediate state does not shorten the tick')
	client.poke()
	await clock.advance(19)
	assert.equal(tr.calls.length, 1, 'poke: not before t0 + 400')
	await clock.advance(1)
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].at, t0 + 400)
	client.stop()
})

test('network errors: backoff, offline from the second failure, online again', async () => {
	let fail = true
	const { clock, tr, client, log } = setup({
		handler: (b) => {
			if (fail) {
				throw new HttpError(0, 'network')
			}
			return { rev: b.since, presence: {} }
		},
		rand: () => 0,
	})
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.calls.length, 1)
	assert.deepEqual(log.statuses, [])
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2, 'first backoff 1 s')
	assert.deepEqual(log.statuses, ['offline'])
	await clock.advance(1999)
	assert.equal(tr.calls.length, 2)
	await clock.advance(1)
	assert.equal(tr.calls.length, 3, 'second backoff 2 s')
	fail = false
	await clock.advance(4000)
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(log.statuses, ['offline', 'online'])
	client.stop()
})

test('a failed batch is repeated identically (same seq, same ops)', async () => {
	let n = 0
	const { clock, tr, client } = setup({
		handler: (b) => {
			n++
			if (n === 2) {
				throw new HttpError(503, 'http_503', '', 1000, false)
			}
			return { rev: b.since + (b.ops ? 1 : 0), acks: b.ops ? { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') } : undefined, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }])
	await clock.advance(150)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'b' } }])
	await clock.advance(1000)
	assert.equal(tr.calls.length, 3)
	assert.deepEqual(tr.calls[2].body.ops, tr.calls[1].body.ops)
	assert.equal(tr.calls[2].body.seq, tr.calls[1].body.seq)
	assert.equal(tr.calls[2].body.ops[0].p['data.text'], 'a')
	await clock.advance(1000)
	assert.equal(tr.calls[3].body.ops[0].p['data.text'], 'b')
	client.stop()
})

test('proxy 429 with Retry-After: wait exactly that long, never offline, failures unchanged', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		handler: (b) => {
			n++
			if (n <= 3) {
				throw new HttpError(429, 'http_429', '', 3000, false)
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	await clock.advance(2999)
	assert.equal(tr.calls.length, 1)
	await clock.advance(1)
	assert.equal(tr.calls.length, 2)
	await clock.advance(6000)
	assert.equal(tr.calls.length, 4)
	assert.equal(client.failures, 0)
	assert.ok(!log.statuses.includes('offline'))
	client.stop()
})

test('proxy 429/503 without Retry-After: 2–10 s with random', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		handler: (b) => {
			n++
			if (n === 1) {
				throw new HttpError(503, 'http_503', '', null, false)
			}
			return { rev: b.since, presence: {} }
		},
		rand: () => 0.25,
	})
	client.start(1)
	await clock.advance(0)
	await clock.advance(3999)
	assert.equal(tr.calls.length, 1)
	await clock.advance(1)
	assert.equal(tr.calls.length, 2, '2000 + 0.25 * 8000 = 4000 ms')
	assert.ok(!log.statuses.includes('offline'))
	client.stop()
})

test('app 429 (rate_limited) on /sync → final status rate_limited (R3), never repeated', async () => {
	const { clock, tr, client, log, replica } = setup({
		handler: (b) => {
			if (b.ops) {
				throw new HttpError(429, 'rate_limited', 'slow down', null, true)
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'typed' } }])
	await clock.advance(60000)
	assert.equal(tr.calls.length, 2, 'the throttled batch went out once')
	assert.equal(client.running, false)
	assert.equal(RATE_LIMITED, 'rate_limited')
	assert.deepEqual(log.statuses, ['online', 'rate_limited'], 'its own status, not gone (§6.4, §6.5)')
	assert.deepEqual(log.reasons, [null, null])
	assert.equal(client.status, 'rate_limited')
	assert.equal(replica.pendingCount(), 1, 'the op stays pending (still in the editor / replica)')
	// nothing brings the loop back: user activity, the browser online event, more ops
	client.poke()
	client.retryNow()
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'more' } }])
	await clock.advance(60000)
	assert.equal(tr.calls.length, 2)
	assert.equal(client.flushKeepalive(), 0, 'pagehide/destroy: no keepalive repeat after an app 429')
	assert.equal(tr.keepalive.length, 0)
})

for (const [name, err, status] of [
	['404', new HttpError(404, 'not_found', '', null, true), 'gone'],
	['401 (user)', new HttpError(401, 'http_401', ''), 'logged_out'],
	['409', new HttpError(409, 'protocol', '', null, true), 'reload'],
]) {
	test('after the final status ' + status + ' (' + name + ') flushKeepalive sends nothing', async () => {
		const { clock, tr, client, replica } = setup({ handler: () => { throw err } })
		client.start(1)
		replica.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }])
		await clock.advance(60000)
		assert.equal(client.status, status)
		assert.equal(client.finalStatus, status)
		assert.equal(replica.pendingCount(), 1)
		assert.equal(client.flushKeepalive(), 0)
		assert.equal(tr.keepalive.length, 0)
	})
}

for (const [name, err, kind, status] of [
	['404 stops for good', new HttpError(404, 'not_found', '', null, true), 'user', 'gone'],
	// 401 without error (user): the first one is bridged, see unauthorized.test.mjs (R21)
	['403 link_revoked (user) → revoked, no join', new HttpError(403, 'link_revoked', '', null, true), 'user', 'revoked'],
	['403 link_expired (guest sync) → link_expired, no join', new HttpError(403, 'link_expired', '', null, true), 'guest', 'link_expired'],
	['403 forbidden → gone', new HttpError(403, 'forbidden', '', null, true), 'user', 'gone'],
	['409 protocol → reload', new HttpError(409, 'protocol', '', null, true), 'user', 'reload'],
	['403 links_disabled (guest sync, U12) → links_disabled, no join', new HttpError(403, 'links_disabled', '', null, true), 'guest', 'links_disabled'],
]) {
	test(name, async () => {
		const { clock, tr, client, log } = setup({ handler: () => { throw err }, kind })
		client.start(1)
		await clock.advance(60000)
		assert.equal(tr.calls.length, 1)
		assert.equal(tr.joins, 0)
		assert.deepEqual(log.statuses, [status])
		assert.equal(client.running, false)
	})
}

test('401 guest_token (guest) → exactly one join, then on', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: (b) => {
			n++
			if (n === 1) {
				throw new HttpError(401, 'guest_token', '', null, true)
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.joins, 1)
	assert.equal(tr.calls.length, 2, 'after the join the next sync goes out at once')
	assert.deepEqual(log.statuses, ['online'])
	await clock.advance(5000)
	assert.equal(tr.joins, 1)
	client.stop()
})

test('401 guest_token twice in one failure streak → only one join, then stop', async () => {
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: () => { throw new HttpError(401, 'guest_token', '', null, true) },
	})
	client.start(1)
	await clock.advance(60000)
	assert.equal(tr.joins, 1)
	assert.equal(tr.calls.length, 2)
	assert.equal(client.running, false)
	assert.deepEqual(log.statuses, ['gone'])
})

for (const [name, err, reason] of [
	['link_revoked', new HttpError(403, 'link_revoked', '', null, true), null],
	['404', new HttpError(404, 'not_found', '', null, true), null],
	['app 429', new HttpError(429, 'rate_limited', '', null, true), RATE_LIMITED],
]) {
	test('re-join answering ' + name + ' → revoked, stop', async () => {
		const { clock, tr, client, log } = setup({
			kind: 'guest',
			handler: () => { throw new HttpError(401, 'guest_token', '', null, true) },
		})
		tr.joinHandler = async () => { throw err }
		client.start(1)
		await clock.advance(60000)
		assert.equal(tr.joins, 1)
		assert.equal(tr.calls.length, 1)
		assert.deepEqual(log.statuses, ['revoked'])
		assert.deepEqual(log.reasons, [reason])
		assert.equal(client.running, false)
	})
}

test('re-join answering 403 links_disabled (U12) → links_disabled, stop', async () => {
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: () => { throw new HttpError(401, 'guest_token', '', null, true) },
	})
	tr.joinHandler = async () => { throw new HttpError(403, 'links_disabled', 'Link sharing is disabled.', null, true) }
	client.start(1)
	await clock.advance(60000)
	assert.equal(tr.joins, 1)
	assert.deepEqual(log.statuses, ['links_disabled'])
	assert.equal(client.finalStatus, 'links_disabled')
	assert.equal(client.running, false)
})

test('413 → split, the first half goes out again at once', async () => {
	let n = 0
	const { clock, tr, client, replica } = setup({
		handler: (b) => {
			n++
			if (n === 2) {
				throw new HttpError(413, 'too_large', '', null, true)
			}
			return { rev: b.since + 1, acks: b.ops ? { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') } : undefined, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([1, 2, 3, 4].map((i) => ({ o: 'patch', id: '01JA000000000000000000000' + i, p: { 'data.text': 'x' } })))
	await clock.advance(150)
	assert.equal(tr.calls.length, 3, 'split: the first half again at once')
	await clock.advance(150)
	assert.equal(tr.calls.length, 4, 'then the rest')
	assert.equal(tr.calls[2].body.ops.length, 2)
	assert.equal(tr.calls[2].body.seq, tr.calls[1].body.seq)
	assert.equal(tr.calls[3].body.ops.length, 2)
	assert.equal(replica.pendingCount(), 0)
	client.stop()
})

test('400 → batch acked as bad for all + resync', async () => {
	let n = 0
	const { clock, client, log } = setup({
		handler: (b) => {
			n++
			if (n === 2) {
				throw new HttpError(400, 'bad_request', '', null, true)
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }, { o: 'remove', id: '01JA0000000000000000000002' }])
	await clock.advance(150)
	assert.equal(log.acks.length, 1)
	assert.deepEqual(log.acks[0].res, ['bad', 'bad'])
	assert.equal(log.acks[0].rev, null)
	assert.equal(log.resyncs.length, 1)
	assert.equal(client.cursor, 100)
	client.stop()
})

test('presence: sent when changed or every 3 s; never hidden; presence {} passes through; sentMe = the candidate of the last request', async () => {
	let me = { c: [1, 2], s: [], d: [], e: null }
	const { clock, tr, client, log } = setup({ getPresence: () => me })
	client.start(1)
	await clock.advance(0)
	assert.deepEqual(tr.calls[0].body.me, me)
	assert.deepEqual(client.sentMe, me)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].body.me, undefined, 'unchanged within 3 s')
	assert.deepEqual(client.sentMe, me, 'sentMe is the candidate before the keepalive filter (SPEC-M1 §6.7)')
	assert.notEqual(client.sentMe, me, 'a copy')
	me = { c: [5, 6], s: [], d: [], e: null }
	client.poke()
	await clock.advance(400)
	assert.deepEqual(tr.calls[2].body.me, me, 'changed → sent')
	await clock.advance(3400)
	const withMe = tr.calls.filter((c) => c.body.me)
	assert.ok(withMe.length >= 3, 'keepalive after 3 s')
	assert.deepEqual(log.presence[0], {})
	client.setHidden(true)
	await clock.advance(5000)
	const last = tr.calls[tr.calls.length - 1]
	assert.equal(last.body.pres, 0)
	assert.equal(last.body.me, undefined)
	assert.equal(client.sentMe, null, 'hidden: no candidate')
	const before = tr.calls.length
	client.setHidden(false)
	await clock.advance(0)
	assert.equal(tr.calls.length, before + 1, 'visible again → at once')
	client.stop()

	// SPEC-M1 §6.4 (R16 SRV-05): a view-only device asks getPresence() too (the
	// presenting tab sends {v}); the session returns null otherwise. Cadence stays 2 s.
	let vme = null
	const v = setup({ getPresence: () => vme, viewOnly: true })
	v.client.start(1)
	await v.clock.advance(0)
	assert.equal(v.tr.calls[0].body.me, undefined)
	assert.equal(v.client.sentMe, null)
	vme = { v: [1, 2, 300, 200] }
	await v.clock.advance(1999)
	assert.equal(v.tr.calls.length, 1)
	await v.clock.advance(1)
	assert.equal(v.tr.calls.length, 2, 'view-only tick 2 s')
	assert.deepEqual(v.tr.calls[1].body.me, { v: [1, 2, 300, 200] }, 'the session\'s {v} goes out on a view-only device')
	await v.clock.advance(2000)
	assert.equal(v.tr.calls[2].body.me, undefined, 'unchanged within 3 s')
	await v.clock.advance(2000)
	assert.deepEqual(v.tr.calls[3].body.me, { v: [1, 2, 300, 200] }, 'keepalive: at least every 3 s (PRESENCE_KEEPALIVE_MS)')
	v.client.stop()
})

test('getPresence throwing is logged and sends no me (the request still goes out)', async () => {
	const { clock, tr, client } = setup({ getPresence: () => { throw new Error('boom') } })
	const orig = console.error
	console.error = () => {}
	try {
		client.start(1)
		await clock.advance(0)
	} finally {
		console.error = orig
	}
	assert.equal(tr.calls.length, 1)
	assert.equal(tr.calls[0].body.me, undefined)
	assert.equal(client.failures, 0)
	client.stop()
})

test('presence takes the onPresenceSent path for tk', async () => {
	const sent = []
	const clock = new FakeClock()
	const tr = fakeTransport(clock, (b) => ({ rev: b.since, presence: {} }))
	const c = new SyncClient({
		transport: tr,
		replica: new Replica(),
		client: 'cX',
		getPresence: () => ({ c: null, s: [], d: [], e: S1, tk: 1 }),
		onPresenceSent: (me) => sent.push(me),
		now: clock.now,
		sleep: clock.sleep,
	})
	c.start(0)
	await clock.advance(0)
	assert.equal(sent.length, 1)
	assert.equal(sent[0].tk, 1)
	c.stop()
})

test('resync: cursor from onResync; brake from the third resync within 10 s (2, 4, 8, … ≤ 30 s)', async () => {
	const { clock, tr, client, log } = setup({
		handler: () => ({ rev: 50, resync: true, presence: {} }),
		onResync: null,
	})
	client.start(60)
	await clock.advance(200000)
	// idle tick 1 s; resync 3 waits 2 s, then 4, 8, 16, 30 (cap), 30
	assert.deepEqual(log.resyncs.slice(0, 8), [10000, 11000, 14000, 18000, 26000, 42000, 72000, 102000])
	assert.ok(log.statuses.includes('resyncing'))
	assert.equal(client.cursor, 100)
	assert.ok(tr.calls.slice(1).every((c) => c.body.since === 100), 'cursor from onResync')
	client.stop()
})

test('answer with rev < since is treated as resync', async () => {
	const { clock, client, log } = setup({ handler: () => ({ rev: 3, presence: {} }) })
	client.start(10)
	await clock.advance(0)
	assert.equal(log.resyncs.length, 1)
	assert.equal(client.cursor, 100)
	client.stop()
})

test('flushKeepalive sends at most 60 KiB in one keepalive request', async () => {
	const { tr, client, replica } = setup()
	client._cursor = 4
	const big = 'x'.repeat(5000)
	replica.addLocal(Array.from({ length: 40 }, (_, i) => ({ o: 'patch', id: '01JA00000000000000000000' + String(i).padStart(2, '0'), p: { 'data.text': big } })))
	const n = client.flushKeepalive()
	assert.equal(tr.keepalive.length, 1)
	const body = tr.keepalive[0]
	const bytes = new TextEncoder().encode(JSON.stringify(body)).length
	assert.ok(bytes <= KEEPALIVE_MAX_BYTES, `${bytes} ≤ ${KEEPALIVE_MAX_BYTES}`)
	assert.ok(n > 5 && n < 40, 'only as many ops as fit: ' + n)
	assert.equal(body.ops.length, n)
	assert.equal(body.pres, 0)
	assert.equal(body.since, 4)
	assert.equal(replica.pendingCount(), 40, 'replica unchanged')
	// nothing pending → nothing sent
	const empty = setup()
	assert.equal(empty.client.flushKeepalive(), 0)
	assert.equal(empty.tr.keepalive.length, 0)
})

test('stop: no further requests, an answer on the wire is ignored', async () => {
	let release
	const { clock, tr, client, log } = setup({
		handler: (b) => new Promise((resolve) => { release = () => resolve({ rev: 99, items: [{ id: S1 }], presence: {} }) }),
	})
	client.start(1)
	await clock.advance(0)
	client.stop()
	release()
	await clock.advance(10000)
	assert.equal(tr.calls.length, 1)
	assert.equal(log.changes.length, 0)
	assert.equal(client.cursor, 1)
})

test('debug setCursor while a request is open: the old answer does not overwrite it', async () => {
	let release
	let n = 0
	const { clock, client, log } = setup({
		handler: (b) => {
			n++
			if (n === 2) {
				return new Promise((resolve) => { release = () => resolve({ rev: 7, presence: {} }) })
			}
			return b.since > 100 ? { rev: 7, resync: true, presence: {} } : { rev: b.since, presence: {} }
		},
	})
	client.start(7)
	await clock.advance(1000)
	client.setCursor(1007)
	release()
	await clock.advance(0)
	assert.equal(client.cursor, 1007)
	await clock.advance(1000)
	assert.equal(log.resyncs.length, 1, 'the next request carries the new cursor and gets resync')
	client.stop()
})

test('a take-over (me.tk) travels alone; the held-back ops follow at once, without tk', async () => {
	let me = { c: null, s: [], d: [], e: S1, tk: 1 }
	const { clock, tr, client, replica } = setup({
		getPresence: () => me,
		handler: (b) => {
			if (b.me?.tk) {
				me = { c: null, s: [], d: [], e: S1 }
			}
			return { rev: b.since, presence: {}, ...(b.ops ? { acks: { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') } } : {}) }
		},
	})
	replica.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'mine' } }], { urgent: false })
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.calls.length, 2, 'the ops follow right after the answer, no tick wait')
	assert.equal(tr.calls[0].body.me.tk, 1)
	assert.equal(tr.calls[0].body.ops, undefined, 'no ops next to tk')
	assert.equal(tr.calls[0].body.seq, undefined)
	assert.deepEqual(tr.calls[1].body.ops, [{ o: 'patch', id: S1, p: { 'data.text': 'mine' } }])
	assert.equal(tr.calls[1].body.me?.tk, undefined)
	assert.equal(tr.calls[1].at, tr.calls[0].at)
	client.stop()
})

test('a pending take-over is sent even when the same me went out before (no "unchanged" skip)', async () => {
	const me = { c: null, s: [], d: [], e: S1, tk: 1 }
	const { clock, tr, client } = setup({ getPresence: () => me })
	client.start(1)
	await clock.advance(0)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].body.me?.tk, 1, 'still pending → sent again, not skipped as unchanged')
	client.stop()
})

test('flushKeepalive: a pending take-over (me.tk) goes ahead of the ops; a plain me never rides along', async () => {
	let me = { c: [1, 2], s: [], d: [], e: S1, tk: 1 }
	const { tr, client, replica } = setup({ getPresence: () => me })
	replica.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'last' } }])
	assert.equal(client.flushKeepalive(), 1)
	assert.deepEqual(tr.keepalive[0].me, me)
	me = { c: [1, 2], s: [], d: [], e: S1 }
	client.flushKeepalive()
	assert.equal(tr.keepalive[1].me, undefined)
	const v = setup({ getPresence: () => ({ e: S1, tk: 1 }), viewOnly: true })
	v.replica.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }])
	v.client.flushKeepalive()
	assert.equal(v.tr.keepalive[0].me, undefined, 'never in view-only mode')
})

const IDN = (i) => '01JA' + String(i).padStart(22, '0')

test('flushKeepalive: at most MAX_OPS (200) ops, the in-flight batch first and in order (T16)', async () => {
	const { tr, client, replica } = setup()
	replica.addLocal(Array.from({ length: 460 }, (_, i) => ({ o: 'patch', id: IDN(i), p: { 'style.fill': '#ffffff' } })))
	const batch = replica.takeBatch(200)
	assert.equal(batch.ops.length, 200)
	assert.equal(replica.queue.length, 260)
	const n = client.flushKeepalive()
	assert.equal(n, 200)
	const body = tr.keepalive[0]
	assert.equal(body.ops.length, 200, 'never more than the server accepts (Limits::MAX_OPS)')
	assert.equal(body.seq, batch.seq)
	assert.deepEqual(body.ops.map((o) => o.id), batch.ops.map((o) => o.id), 'in-flight ops are always resent first')
	assert.ok(replica.queue.every((e) => !e.maybeSent), 'queued ops that did not go out stay compactable')
	// only queued ops: the first 200 in send order, the rest stays unmarked
	const q = setup()
	q.replica.addLocal(Array.from({ length: 260 }, (_, i) => ({ o: 'patch', id: IDN(i), p: { 'style.fill': '#ffffff' } })))
	assert.equal(q.client.flushKeepalive(), 200)
	assert.deepEqual(q.tr.keepalive[0].ops.map((o) => o.id), Array.from({ length: 200 }, (_, i) => IDN(i)))
	assert.equal(q.replica.queue.filter((e) => e.maybeSent).length, 200)
	assert.ok(q.replica.queue.slice(200).every((e) => !e.maybeSent))
})

test('flushKeepalive: the 60 KiB cap still applies below 200 ops; sent queued ops are marked maybe-sent (T15)', async () => {
	const { tr, client, replica } = setup()
	const big = 'x'.repeat(2000)
	replica.addLocal(Array.from({ length: 150 }, (_, i) => ({ o: 'patch', id: IDN(i), p: { 'data.text': big } })))
	const n = client.flushKeepalive()
	assert.ok(n > 10 && n < 150, 'bytes, not ops, limit here: ' + n)
	const bytes = new TextEncoder().encode(JSON.stringify(tr.keepalive[0])).length
	assert.ok(bytes <= KEEPALIVE_MAX_BYTES)
	assert.equal(replica.queue.filter((e) => e.maybeSent).length, n)
	assert.equal(replica.pendingCount(), 150, 'nothing leaves the replica')
	// a later text on a flushed id is appended, not merged into the flushed patch
	replica.addLocal([{ o: 'patch', id: IDN(0), p: { 'data.text': 'newer' } }])
	assert.equal(replica.pendingCount(), 151)
})

// ---- U8 (NC-3): a batch the server keeps answering with 500 --------------

const POISON = '01JA00000000000000000000PZ'

/**
 * Server that answers 500 `internal` for every request carrying an op on
 * POISON (the whole batch rolls back) and applies everything else.
 *
 * @param {{down?: () => boolean}} [o] down(): every request fails with 500 (outage)
 * @return {{handler: Function, applied: object[]}} handler and the ops it applied
 */
function poisonServer({ down = () => false } = {}) {
	let rev = 1
	const applied = []
	const handler = (b) => {
		if (down() || (b.ops ?? []).some((op) => op.id === POISON)) {
			throw new HttpError(500, 'internal', 'Internal error', null, true)
		}
		const res = { rev, presence: {} }
		if (b.ops) {
			rev++
			applied.push(...b.ops)
			res.acks = { seq: b.seq, rev, res: b.ops.map(() => 'ok') }
			res.rev = rev
		}
		return res
	}
	return { handler, applied }
}

test('U8: a batch answered 500 three times is bisected; the other ops get through, the poison op is dropped after failing alone 3 times', async () => {
	const srv = poisonServer()
	const { clock, tr, client, replica, log } = setup({ handler: srv.handler, rand: () => 0 })
	client.start(1)
	await clock.advance(0)
	client.enqueue([
		{ o: 'patch', id: IDN(1), p: { 'style.fill': '#111111' } },
		{ o: 'patch', id: POISON, p: { 'data.text': 'great idea \u{1F44D}' } },
		{ o: 'patch', id: IDN(2), p: { 'style.fill': '#222222' } },
		{ o: 'patch', id: IDN(3), p: { 'style.fill': '#333333' } },
	])
	await clock.advance(60000)
	assert.deepEqual(srv.applied.map((op) => op.id).sort(), [IDN(1), IDN(2), IDN(3)], 'every other op reached the server')
	const dropped = log.acks.filter((a) => a.res.includes('internal'))
	assert.equal(dropped.length, 1, 'the poison op is reported once, as internal')
	assert.deepEqual(dropped[0].res, ['internal'])
	assert.equal(replica.pendingCount(), 0, 'nothing is retried forever')
	const alone = tr.calls.filter((c) => c.body.ops?.length === 1 && c.body.ops[0].id === POISON)
	assert.ok(alone.length >= 3, 'the poison op failed alone at least 3 times: ' + alone.length)
	assert.equal(log.statuses[log.statuses.length - 1], 'online')
	const before = tr.calls.length
	await clock.advance(5000)
	assert.ok(tr.calls.slice(before).every((c) => !c.body.ops), 'the loop is calm afterwards')
	client.stop()
})

test('U8: a lone op is dropped only after requests without it succeeded in between (never during an outage)', async () => {
	let down = true
	const srv = poisonServer({ down: () => down })
	const { clock, tr, client, replica, log } = setup({ handler: srv.handler, rand: () => 0 })
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: IDN(1), p: { 'style.fill': '#111111' } }, { o: 'patch', id: IDN(2), p: { 'style.fill': '#222222' } }])
	await clock.advance(120000)
	assert.ok(tr.calls.length > 10, 'kept trying: ' + tr.calls.length)
	assert.ok(!log.acks.some((a) => a.res.includes('internal')), 'nothing dropped while every request fails')
	assert.equal(replica.pendingCount(), 2)
	assert.ok(log.statuses.includes('offline'))
	down = false
	await clock.advance(60000)
	assert.deepEqual(srv.applied.map((op) => op.id).sort(), [IDN(1), IDN(2)], 'both arrive once the server is back')
	assert.equal(replica.pendingCount(), 0)
	assert.equal(log.statuses[log.statuses.length - 1], 'online')
	client.stop()
})

test('U8: while the poison op is isolated, new ops keep flowing; ops on its id wait behind it', async () => {
	const srv = poisonServer()
	const events = []
	const handler = (b) => {
		for (const op of b.ops ?? []) {
			events.push('sent ' + op.id + ' ' + Object.keys(op.p)[0])
		}
		return srv.handler(b)
	}
	const { clock, client, replica, log } = setup({
		handler,
		rand: () => 0,
	})
	const onAcks = client.onAcks
	client.onAcks = (a) => {
		if (a.res.includes('internal')) {
			events.push('dropped')
		}
		onAcks(a)
	}
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: POISON, p: { 'data.text': 'a \u{1F600}' } }])
	// three plain 500s (backoff 1 s, 2 s), then the op is set aside
	await clock.advance(3200)
	assert.equal(replica.heldCount(), 1, 'set aside after three 500 answers')
	client.enqueue([{ o: 'patch', id: IDN(7), p: { 'style.fill': '#777777' } }, { o: 'patch', id: POISON, p: { 'style.fill': '#000000' } }])
	await clock.advance(60000)
	const sent7 = events.indexOf('sent ' + IDN(7) + ' style.fill')
	const dropped = events.indexOf('dropped')
	const fill = events.indexOf('sent ' + POISON + ' style.fill')
	assert.ok(sent7 >= 0 && dropped > sent7, 'the new op went out while the poison op was held: ' + events.join(' | '))
	assert.ok(fill > dropped, 'a later op on the held id never overtakes it')
	assert.equal(log.acks.filter((a) => a.res.includes('internal')).length, 2, 'the later op on the same id fails on its own here and is dropped too')
	assert.equal(replica.pendingCount(), 0)
	client.stop()
})

test('U8: proxy 502/503/504 never count as server errors of the batch (no bisect, nothing dropped)', async () => {
	for (const status of [502, 504]) {
		const { clock, tr, client, replica, log } = setup({
			handler: (b) => {
				if (b.ops) {
					throw new HttpError(status, 'http_' + status, '', null, false)
				}
				return { rev: b.since, presence: {} }
			},
			rand: () => 0,
		})
		client.start(1)
		await clock.advance(0)
		client.enqueue([{ o: 'patch', id: IDN(1), p: { 'style.fill': '#111111' } }, { o: 'patch', id: IDN(2), p: { 'style.fill': '#222222' } }])
		await clock.advance(120000)
		const withOps = tr.calls.filter((c) => c.body.ops)
		assert.ok(withOps.length >= 5, status + ': kept trying')
		assert.ok(withOps.every((c) => c.body.ops.length === 2), status + ': the batch is never split')
		assert.equal(replica.pendingCount(), 2, status + ': nothing dropped')
		assert.ok(!log.acks.length, status + ': no acks')
		client.stop()
	}
})

test('U8: flushKeepalive leaves out a held op and everything that waits behind it', async () => {
	const srv = poisonServer()
	const { clock, tr, client, replica } = setup({ handler: srv.handler, rand: () => 0 })
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: POISON, p: { 'data.text': 'a \u{1F600}' } }])
	await clock.advance(7100)
	assert.equal(replica.heldCount(), 1, 'the poison op is set aside')
	client.stop()
	replica.addLocal([{ o: 'patch', id: POISON, p: { 'style.fill': '#000000' } }, { o: 'patch', id: IDN(4), p: { 'style.fill': '#444444' } }])
	assert.equal(client.flushKeepalive(), 1)
	assert.deepEqual(tr.keepalive[0].ops.map((op) => op.id), [IDN(4)])
})

// ---- SPEC-M1 protocol 2 (WP-C0) ----------------------------------------------

test('M1 body v2: ep from getEpoch (every request, keepalive too), role = access level, vt only as an int ≥ 0', async () => {
	let ep = 'k3x9a0b2'
	let role = 'moderate'
	let vt = 31
	const { clock, tr, client, replica } = setup({ extra: { getEpoch: () => ep, getRole: () => role, getVoteTally: () => vt } })
	client.start(4)
	await clock.advance(0)
	assert.deepEqual(tr.calls[0].body, { proto: 2, client: 'cTEST00001', since: 4, ep: 'k3x9a0b2', role: 'moderate', pres: 1, vt: 31 })
	ep = 'BAD-epoch!'
	role = 'superuser'
	vt = 1.5
	await clock.advance(1000)
	assert.equal(tr.calls[1].body.ep, DEFAULT_EPOCH, 'an invalid epoch never goes out (the server would answer 400 and drop the batch)')
	assert.equal('role' in tr.calls[1].body, false, 'unknown role values are left out (R3: 400 otherwise)')
	assert.equal('vt' in tr.calls[1].body, false)
	ep = 'k3x9a0b2'
	role = null
	vt = null
	await clock.advance(1000)
	assert.equal('role' in tr.calls[2].body, false)
	for (const r of ['owner', 'moderate', 'edit', 'vote', 'view']) {
		role = r
		client.forceTick()
		await clock.advance(0)
		assert.equal(tr.calls[tr.calls.length - 1].body.role, r)
	}
	client.stop()
	role = 'edit'
	vt = 7
	replica.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }])
	client.flushKeepalive()
	assert.equal(tr.keepalive[0].ep, 'k3x9a0b2', 'keepalive carries ep')
	assert.equal(tr.keepalive[0].role, 'edit')
	assert.equal('vt' in tr.keepalive[0], false, 'vt never rides in a keepalive')
})

test('M1 onClock: every 2xx answer with now → {now, t0, t1} measured around the request; none without now', async () => {
	const clocks = []
	let n = 0
	const { clock, client } = setup({
		handler: (b) => {
			n++
			return n === 2 ? { rev: b.since } : { rev: b.since, now: 1760100000000 + n }
		},
		extra: { onClock: (c) => clocks.push(c) },
	})
	client.start(1)
	await clock.advance(0)
	await clock.advance(1000)
	await clock.advance(1000)
	assert.deepEqual(clocks, [
		{ now: 1760100000001, t0: 10000, t1: 10000 },
		{ now: 1760100000003, t0: 12000, t1: 12000 },
	])
	client.stop()
})

test('M1 onMeta before onChanges, onVotes after onAcks and after onMeta (R16 SRV-03), onRole with the me block; a throwing callback is no failed request', async () => {
	const events = []
	let n = 0
	const { clock, client, log } = setup({
		handler: (b) => {
			n++
			if (n === 1) {
				return { rev: 6, now: 1, votes: { sid: 1 }, board: { title: 'New', metaRev: 6 }, me: { role: 'view', mod: false }, items: [{ id: S1 }], acks: undefined, presence: {} }
			}
			return { rev: b.since, presence: {} }
		},
		extra: {
			onMeta: (bd) => { events.push('meta ' + bd.title); throw new Error('boom') },
			onRole: (me) => events.push('role ' + me.role),
			onVotes: () => events.push('votes'),
			onClock: () => { throw new Error('boom') },
		},
	})
	const onChanges = client.onChanges
	client.onChanges = (items, removed) => { events.push('changes'); onChanges(items, removed) }
	const errors = []
	const orig = console.error
	console.error = (...a) => errors.push(a)
	try {
		client.start(5)
		await clock.advance(0)
	} finally {
		console.error = orig
	}
	assert.deepEqual(events, ['meta New', 'role view', 'votes', 'changes'])
	assert.equal(client.failures, 0, 'the answer was fine')
	assert.equal(client.cursor, 6)
	assert.deepEqual(log.statuses, ['online'])
	assert.ok(errors.length >= 2, 'logged')
	client.stop()
})

test('M1 onMeta also on the resync path (before the snapshot is loaded)', async () => {
	const events = []
	const { clock, client } = setup({
		handler: () => ({ rev: 50, resync: true, board: { title: 'T', metaRev: 49 }, presence: {} }),
		onResync: async () => { events.push('resync'); return 60 },
		extra: { onMeta: (bd) => events.push('meta ' + bd.metaRev) },
	})
	client.start(60)
	await clock.advance(0)
	assert.deepEqual(events.slice(0, 2), ['meta 49', 'resync'])
	client.stop()
})

test('M1 busy: every op busy → the same batch (same seq) again after retryMs × (1 + 0–20 %); reads go on; no failure, no offline', async () => {
	let n = 0
	const { clock, tr, client, replica, log } = setup({
		rand: () => 0.5,
		handler: (b) => {
			n++
			if (b.ops && n <= 3) {
				return { rev: b.since, now: 1, acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'busy'), retryMs: 5000 }, presence: {} }
			}
			if (b.ops) {
				return { rev: b.since + 1, acks: { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') }, presence: {} }
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }])
	await clock.advance(150)
	const first = tr.calls.find((c) => c.body.ops)
	assert.equal(replica.hasInflight(), true, 'the busy batch stays in flight')
	// rand 0.5 → 5000 × 1.1 = 5500 ms until the repeat; the loop keeps reading meanwhile
	client.enqueue([{ o: 'patch', id: S1, p: { 'style.fill': '#111111' } }])
	await clock.advance(5400)
	const between = tr.calls.filter((c) => c.at > first.at && c.at < first.at + 5500)
	assert.ok(between.length >= 4, 'reads go on at the normal cadence: ' + between.length)
	assert.ok(between.every((c) => !c.body.ops), 'nothing carries ops before retryMs')
	assert.ok(between.every((c) => c.at - first.at >= 150), 'urgent ops do not speed the loop up while busy')
	await clock.advance(100)
	const repeat = tr.calls.filter((c) => c.body.ops)[1]
	assert.equal(repeat.at, first.at + 5500)
	assert.equal(repeat.body.seq, first.body.seq, 'same seq')
	assert.deepEqual(repeat.body.ops, first.body.ops, 'same ops (the new one waits in the queue)')
	await clock.advance(20000)
	assert.equal(replica.pendingCount(), 0, 'everything got through in the end')
	assert.equal(client.failures, 0)
	assert.ok(!log.statuses.includes('offline'))
	assert.deepEqual(log.statuses, ['online'])
	client.stop()
})

test('M1 busy without retryMs → 2000 ms; a mixed answer re-queues only the busy op (Replica)', async () => {
	let n = 0
	const { clock, tr, client } = setup({
		rand: () => 0,
		handler: (b) => {
			n++
			if (b.ops && n === 2) {
				return { rev: b.since, acks: { seq: b.seq, rev: null, res: ['busy'] }, presence: {} }
			}
			return { rev: b.since + (b.ops ? 1 : 0), acks: b.ops ? { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') } : undefined, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }])
	await clock.advance(150)
	const t = tr.calls[1].at
	await clock.advance(1999)
	assert.ok(!tr.calls.slice(2).some((c) => c.body.ops))
	await clock.advance(1)
	assert.equal(tr.calls.filter((c) => c.body.ops).length, 2)
	assert.equal(tr.calls.filter((c) => c.body.ops)[1].at, t + 2000)
	client.stop()
})

test('M1 R19 T4-18: the §4.5 busy answer (every result busy, rev null, retryMs 2000) keeps both ops in flight with the same seq; never mixed, so nothing is half-applied', async () => {
	let n = 0
	const { clock, tr, client, replica } = setup({
		rand: () => 0,
		handler: (b) => {
			n++
			if (b.ops && n === 2) {
				// the example of §4.5 (R19): busy comes for all or for none
				return { rev: 45, now: 1760100000456, acks: { seq: b.seq, rev: null, res: ['busy', 'busy'], retryMs: 2000 }, presence: {} }
			}
			if (b.ops) {
				return { rev: 46, now: 1760100002456, acks: { seq: b.seq, rev: 46, res: ['ok', 'ok'] }, presence: {} }
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(45)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }, { o: 'patch', id: '01JA0000000000000000000002', p: { 'data.text': 'b' } }])
	await clock.advance(150)
	const first = tr.calls.find((c) => c.body.ops)
	assert.equal(first.body.ops.length, 2)
	assert.equal(replica.hasInflight(), true, 'busy for all: the batch stays in flight, nothing applied')
	assert.equal(replica.pendingCount(), 2)
	await clock.advance(1999)
	assert.equal(tr.calls.filter((c) => c.body.ops).length, 1, 'not before retryMs (rand 0: exactly 2000 ms)')
	await clock.advance(1)
	const again = tr.calls.filter((c) => c.body.ops)[1]
	assert.equal(again.at, first.at + 2000)
	assert.equal(again.body.seq, first.body.seq, 'same seq')
	assert.deepEqual(again.body.ops, first.body.ops, 'both ops again, unchanged')
	await clock.advance(10)
	assert.equal(replica.hasInflight(), false, 'all ok: done')
	assert.equal(client.failures, 0)
	client.stop()
})

test('M1 409 keeps the server protocol of the body for the reload marker ("?" when missing)', async () => {
	const a = setup({ handler: () => { throw new HttpError(409, 'protocol', '', null, true, { error: 'protocol', proto: 3 }) } })
	a.client.start(1)
	await a.clock.advance(0)
	assert.equal(a.client.finalStatus, 'reload')
	assert.equal(a.client.serverProto, 3)
	const b = setup({ handler: () => { throw new HttpError(409, 'protocol', '', null, true) } })
	b.client.start(1)
	await b.clock.advance(0)
	assert.equal(b.client.serverProto, '?')
	assert.equal(protoOf(new HttpError(409, 'protocol', '', null, true, { proto: 'x'.repeat(40) })), '?')
})

test('M1 (R2) 403 link_revoked on a guest sync → exactly one re-join; on success the loop goes on', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: (b) => {
			n++
			if (n === 1) {
				throw new HttpError(403, 'link_revoked', '', null, true)
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.joins, 1)
	assert.equal(tr.calls.length, 2, 'after the join the next sync goes out at once')
	assert.deepEqual(log.statuses, ['online'])
	await clock.advance(5000)
	assert.equal(tr.joins, 1)
	client.stop()
})

test('M1 (R2) 403 link_revoked again right after a re-join (no 2xx between) → revoked, no second join', async () => {
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: () => { throw new HttpError(403, 'link_revoked', '', null, true) },
	})
	client.start(1)
	await clock.advance(60000)
	assert.equal(tr.joins, 1)
	assert.deepEqual(log.statuses, ['revoked'])
	assert.equal(client.running, false)
})

for (const trigger of [['401 guest_token', new HttpError(401, 'guest_token', '', null, true)], ['403 link_revoked', new HttpError(403, 'link_revoked', '', null, true)]]) {
	for (const [name, err, status, reason] of [
		['403 password_required', new HttpError(403, 'password_required', '', null, true), 'password_required', null],
		['403 password_wrong', new HttpError(403, 'password_wrong', '', null, true), 'password_required', null],
		['403 link_revoked', new HttpError(403, 'link_revoked', '', null, true), 'revoked', null],
		['403 link_expired', new HttpError(403, 'link_expired', '', null, true), 'link_expired', null],
		['403 links_disabled', new HttpError(403, 'links_disabled', '', null, true), 'links_disabled', null],
		['404', new HttpError(404, 'not_found', '', null, true), 'revoked', null],
		['app 429 rate_limited', new HttpError(429, 'rate_limited', '', null, true), 'revoked', RATE_LIMITED],
	]) {
		test('M1 (R2) re-join after ' + trigger[0] + ' answering ' + name + ' → ' + status + ', stop', async () => {
			const { clock, tr, client, log } = setup({ kind: 'guest', handler: () => { throw trigger[1] } })
			tr.joinHandler = async () => { throw err }
			client.start(1)
			await clock.advance(60000)
			assert.equal(tr.joins, 1, 'exactly one join')
			assert.equal(tr.calls.length, 1)
			assert.deepEqual(log.statuses, [status])
			assert.deepEqual(log.reasons, [reason])
			assert.equal(client.finalStatus, status)
			assert.equal(client.running, false)
		})
	}
}

test('M1 (R2) re-join answering 429 slow_down → wait max(retryMs, 2000) × (1 + 0–20 %), doubling, then the same one attempt again; never final', async () => {
	const joinsAt = []
	let ok = false
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		rand: () => 0.5,
		handler: (b) => {
			if (!ok) {
				throw new HttpError(401, 'guest_token', '', null, true)
			}
			return { rev: b.since, presence: {} }
		},
	})
	tr.joinHandler = async () => {
		joinsAt.push(clock.now())
		if (joinsAt.length <= 2) {
			throw new HttpError(429, 'slow_down', '', 1000, true, { error: 'slow_down', retryMs: 1000 })
		}
		ok = true
		return { proto: PROTOCOL, guest: { token: 'tok3' } }
	}
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.joins, 1)
	await clock.advance(10000)
	// max(1000, 2000) × 1.1 = 2200, then doubled: 4000 × 1.1 = 4400
	assert.deepEqual(joinsAt.map((t) => t - joinsAt[0]), [0, 2200, 6600], 'the join itself is repeated, no sync in between')
	assert.equal(tr.calls.length >= 2, true)
	assert.equal(tr.calls[1].at, joinsAt[2], 'after the successful join the sync goes out at once')
	assert.equal(client.finalStatus, null)
	assert.equal(client.failures, 0)
	assert.deepEqual(log.statuses, ['online'])
	client.stop()
})

test('M1 a join answer with another protocol counts as a 409 (reload, serverProto from the answer)', async () => {
	const { clock, tr, client, log } = setup({ kind: 'guest', handler: () => { throw new HttpError(401, 'guest_token', '', null, true) } })
	tr.joinHandler = async () => ({ proto: 3, guest: { token: 't' } })
	client.start(1)
	await clock.advance(0)
	assert.deepEqual(log.statuses, ['reload'])
	assert.equal(client.serverProto, 3)
})

test('M1 (R2) resync snapshot answering slow_down → waits (2000, then 4000 … ≤ 60 s), status stays resyncing, then online; never final', async () => {
	let snaps = 0
	const times = []
	const { clock, client, log } = setup({
		rand: () => 0,
		handler: (b) => (b.since === 60 ? { rev: 50, resync: true, presence: {} } : { rev: b.since, presence: {} }),
		onResync: async () => {
			snaps++
			times.push(clock.now())
			if (snaps <= 3) {
				throw new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 500 })
			}
			return 70
		},
	})
	client.start(60)
	await clock.advance(0)
	await clock.advance(20000)
	assert.deepEqual(times.map((t) => t - times[0]), [0, 2000, 6000, 14000], 'max(500, 2000), doubled each time')
	assert.equal(client.cursor, 70)
	assert.deepEqual(log.statuses, ['online', 'resyncing', 'online'])
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('M1 slow_down on /sync (not expected) → wait like a proxy 429, never final, no failure', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		rand: () => 0,
		handler: (b) => {
			n++
			if (n === 1) {
				throw new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 3000 })
			}
			return { rev: b.since, presence: {} }
		},
	})
	client.start(1)
	await clock.advance(2999)
	assert.equal(tr.calls.length, 1)
	await clock.advance(1)
	assert.equal(tr.calls.length, 2)
	assert.equal(client.failures, 0)
	assert.deepEqual(log.statuses, ['online'])
	client.stop()
})

test('M1 finalOf403: the frozen final statuses of §4.2', () => {
	assert.equal(finalOf403('link_revoked'), 'revoked')
	assert.equal(finalOf403('links_disabled'), 'links_disabled')
	assert.equal(finalOf403('link_expired'), 'link_expired')
	assert.equal(finalOf403('password_required'), 'password_required')
	assert.equal(finalOf403('password_wrong'), 'password_required')
	assert.equal(finalOf403('forbidden'), 'gone')
})

test('M1 (R13, CLI-08) re-join answering 429 slow_down with reason password → final password_required at once: no wait, no second join', async () => {
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: () => { throw new HttpError(403, 'link_revoked', '', null, true) },
	})
	tr.joinHandler = async () => {
		throw new HttpError(429, 'slow_down', '', 600000, true, { error: 'slow_down', retryMs: 600000, reason: 'password' })
	}
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.joins, 1)
	assert.equal(client.finalStatus, 'password_required')
	assert.equal(client.running, false)
	assert.deepEqual(log.statuses, ['password_required'])
	await clock.advance(700000)
	assert.equal(tr.joins, 1, 'never repeated automatically')
	assert.equal(tr.calls.length, 1, 'no /sync after the final status')
})

test('M1 (R13) the same lock-out after a 401 guest_token (expired token) ends the same way', async () => {
	const { clock, tr, client } = setup({
		kind: 'guest',
		handler: () => { throw new HttpError(401, 'guest_token', '', null, true) },
	})
	tr.joinHandler = async () => {
		throw new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 1000, reason: 'password' })
	}
	client.start(1)
	await clock.advance(0)
	assert.equal(client.finalStatus, 'password_required')
	await clock.advance(60000)
	assert.equal(tr.joins, 1)
})

test('M1 (R13) the lock-out final status carries reason "password" and keeps the answer (retryMs) for the password phase', async () => {
	const { clock, tr, client, log } = setup({ kind: 'guest', handler: () => { throw new HttpError(401, 'guest_token', '', null, true) } })
	const lock = new HttpError(429, 'slow_down', '', null, true, { error: 'slow_down', retryMs: 300000, reason: 'password' })
	tr.joinHandler = async () => { throw lock }
	client.start(1)
	await clock.advance(0)
	assert.deepEqual(log.reasons, ['password'])
	assert.equal(client.finalError, lock)
})

test('M1 R16 SRV-03: one answer with acks, board, me and votes → onAcks, onMeta, onRole, onVotes in this order', async () => {
	const events = []
	const { clock, client, replica } = setup({
		handler: (b) => (b.ops
			? { rev: b.since, acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'ok') }, votes: { sid: 13, mine: { [S1]: 1 }, left: 2 }, board: { metaRev: 9, meta: { vote: { sid: 13, state: 'open' } } }, me: { role: 'edit', mod: true }, presence: {} }
			: { rev: b.since, presence: {} }),
		extra: {
			onMeta: () => events.push('meta'),
			onRole: () => events.push('role'),
			onVotes: (v) => events.push('votes ' + v.sid),
		},
	})
	const onAcks = client.onAcks
	client.onAcks = (a) => { events.push('acks'); onAcks(a) }
	replica.addLocal([{ o: 'vote', s: 13, id: S1, n: 1 }])
	client.start(1)
	await clock.advance(0)
	assert.deepEqual(events, ['acks', 'meta', 'role', 'votes 13'])
	client.stop()
})

// ---- Stage 4, fix round: the wire shapes [B] delivers (record of shapes) -----
//
// [B] put the exact shapes of the write budget, the snapshot throttle and the
// purge resync on record (stage 4, phase 1, fix round). These tests feed them
// to the client unchanged; the HttpErrors come out of http.js request() from
// a raw 429 answer, so body and Retry-After are parsed like in the browser.

/** retryMs of a busy answer as [B] computes it: the rest of the 10-s window of `now` + 100 ms. */
const busyRetryMs = (now) => (Math.floor(now / 10000) + 1) * 10000 - now + 100

/**
 * The HttpError http.js builds from a raw 429 answer.
 *
 * @param {object} body JSON body of the answer
 * @param {string} retryAfter Retry-After header
 * @return {Promise<HttpError>}
 */
async function wire429(body, retryAfter) {
	const fetchImpl = async () => ({
		ok: false,
		status: 429,
		statusText: 'Too Many Requests',
		headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? retryAfter : null) },
		text: async () => JSON.stringify(body),
	})
	try {
		await request('GET', '/x', { fetchImpl })
	} catch (e) {
		return e
	}
	throw new Error('request() did not reject')
}

test('M1 stage 4 [B] shape: a busy answer still carries the read (rev, items, removed, presence); it applies in the same tick while the batch waits retryMs = rest of the 10-s window + 100 ms', async () => {
	const NOW = 1760100003456
	assert.equal(busyRetryMs(NOW), 6644)
	const X = '01JA0000000000000000000009'
	const Y = '01JA0000000000000000000008'
	let opsCalls = 0
	const clocks = []
	const { clock, tr, client, replica, log } = setup({
		rand: () => 0,
		extra: { onClock: (c) => clocks.push(c.now) },
		handler: (b) => {
			if (!b.ops) {
				return { rev: b.since, now: NOW, presence: {} }
			}
			opsCalls++
			if (opsCalls === 1) {
				return {
					rev: b.since + 2,
					now: NOW,
					acks: { seq: b.seq, rev: null, res: b.ops.map(() => 'busy'), retryMs: busyRetryMs(NOW) },
					items: [{ id: X, t: 'sticky', x: 1, y: 2 }],
					removed: [Y],
					presence: { 'p1:c1': { n: 'Bob' } },
				}
			}
			return { rev: b.since + 1, now: NOW + 7000, acks: { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') }, presence: {} }
		},
	})
	client.start(40)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }, { o: 'patch', id: '01JA0000000000000000000002', p: { 'data.text': 'b' } }])
	await clock.advance(150)
	const first = tr.calls.find((c) => c.body.ops)
	assert.equal(first.body.since, 40)
	// the read part of the busy answer is applied at once
	const withItems = log.changes.filter((c) => c.items.length > 0 || c.removed.length > 0)
	assert.equal(withItems.length, 1)
	assert.deepEqual(withItems[0].items.map((i) => i.id), [X])
	assert.deepEqual(withItems[0].removed, [Y])
	assert.equal(client.cursor, 42, 'cursor = rev of the busy answer')
	assert.ok(log.presence.some((m) => m && m['p1:c1']), 'presence of the busy answer delivered')
	assert.ok(clocks.includes(NOW), 'now of the busy answer reached onClock')
	assert.equal(replica.hasInflight(), true, 'nothing applied: the batch stays in flight')
	assert.equal(replica.pendingCount(), 2)
	// the next reads use the new cursor and carry no ops; the repeat waits exactly retryMs (rand 0)
	await clock.advance(6643)
	const between = tr.calls.filter((c) => c.at > first.at)
	assert.ok(between.length >= 3, 'reads go on meanwhile: ' + between.length)
	assert.ok(between.every((c) => !c.body.ops && c.body.since === 42))
	await clock.advance(1)
	const again = tr.calls.filter((c) => c.body.ops)[1]
	assert.ok(again, 'repeated after retryMs')
	assert.equal(again.at, first.at + 6644)
	assert.equal(again.body.seq, first.body.seq, 'same seq')
	assert.deepEqual(again.body.ops, first.body.ops, 'same ops')
	await clock.advance(10)
	assert.equal(replica.hasInflight(), false)
	assert.equal(client.failures, 0)
	assert.deepEqual(log.statuses, ['online'], 'busy is no failure and never offline')
	client.stop()
})

test('M1 stage 4 [B] shape: the snapshot throttle answers (retryMs 2000 + Retry-After 2; snapip retryMs 200 + Retry-After 1) both wait 2000 ms on a resync snapshot, never 200 or 1000', async () => {
	const msg = 'Too many snapshot requests, please slow down.'
	for (const [body, header] of [[{ error: 'slow_down', message: msg, retryMs: 2000 }, '2'], [{ error: 'slow_down', message: msg, retryMs: 200 }, '1']]) {
		const err = await wire429(body, header)
		assert.equal(err.status, 429)
		assert.equal(err.code, 'slow_down')
		assert.equal(err.fromApp, true)
		assert.equal(err.body.retryMs, body.retryMs)
		assert.equal(err.retryAfterMs, Number(header) * 1000)
		const times = []
		const { clock, client, log } = setup({
			rand: () => 0,
			handler: (b) => (b.since === 60 ? { rev: 50, now: 1, resync: true, presence: {} } : { rev: b.since, presence: {} }),
			onResync: async () => {
				times.push(clock.now())
				if (times.length <= 2) {
					throw err
				}
				return 70
			},
		})
		client.start(60)
		await clock.advance(0)
		await clock.advance(10000)
		assert.deepEqual(times.map((t) => t - times[0]), [0, 2000, 6000], 'retryMs ' + body.retryMs + ': max(retryMs, 2000), then doubled')
		assert.equal(client.cursor, 70)
		assert.equal(client.finalStatus, null, 'never final')
		assert.deepEqual(log.statuses, ['online', 'resyncing', 'online'])
		client.stop()
	}
})

test('M1 stage 4 [B] shape: a guest re-join with the old token answered by knorke-snap-<gid> (retryMs 2000, Retry-After 2) or knorke-snapip-<board> (retryMs 200, Retry-After 1) waits 2000 ms, then the same one attempt', async () => {
	for (const [body, header] of [[{ error: 'slow_down', message: 'Slow down', retryMs: 2000 }, '2'], [{ error: 'slow_down', message: 'Slow down', retryMs: 200 }, '1']]) {
		const err = await wire429(body, header)
		const joinsAt = []
		let ok = false
		const { clock, tr, client, log } = setup({
			kind: 'guest',
			rand: () => 0,
			handler: (b) => {
				if (!ok) {
					throw new HttpError(401, 'guest_token', '', null, true)
				}
				return { rev: b.since, presence: {} }
			},
		})
		tr.joinHandler = async () => {
			joinsAt.push(clock.now())
			if (joinsAt.length === 1) {
				throw err
			}
			ok = true
			return { proto: PROTOCOL, guest: { token: 'tok4' } }
		}
		client.start(1)
		await clock.advance(0)
		await clock.advance(5000)
		assert.deepEqual(joinsAt.map((t) => t - joinsAt[0]), [0, 2000], 'retryMs ' + body.retryMs + ' → 2000 ms')
		assert.equal(client.finalStatus, null)
		assert.equal(client.failures, 0)
		assert.deepEqual(log.statuses, ['online'])
		client.stop()
	}
})

test('M1 stage 4 [B] shape: a cursor below the purge mark gets {rev, now, resync: true} without items, removed or more → acks of the batch still apply, then one snapshot; no page is applied and no extra "more" request follows', async () => {
	const NOW = 1760100009000
	const clocks = []
	let first = true
	const { clock, tr, client, replica, log } = setup({
		rand: () => 0,
		extra: { onClock: (c) => clocks.push(c.now) },
		handler: (b) => {
			if (first && b.ops) {
				first = false
				return { rev: 900, now: NOW, acks: { seq: b.seq, rev: 900, res: b.ops.map(() => 'ok') }, presence: {}, resync: true }
			}
			return { rev: b.since, now: NOW, presence: {} }
		},
		onResync: async () => {
			log.resyncs.push(clock.now())
			return 905
		},
	})
	client.start(12)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'z' } }])
	await clock.advance(150)
	const req = tr.calls.find((c) => c.body.ops)
	assert.equal(req.body.since, 12)
	assert.equal(log.acks.length, 1, 'the acks of the answer are applied')
	assert.equal(replica.hasInflight(), false)
	assert.equal(log.resyncs.length, 1, 'exactly one snapshot')
	assert.ok(log.changes.every((c) => c.items.length === 0 && c.removed.length === 0), 'nothing applied from the answer itself')
	assert.ok(!log.settled.includes(900), 'rev of a resync answer is no cursor')
	assert.equal(client.cursor, 905, 'cursor from the snapshot')
	assert.ok(clocks.includes(NOW))
	const after = tr.calls.filter((c) => c.at > req.at)
	assert.ok(after.length === 0 || after[0].at - req.at >= 150, 'no immediate "more" request')
	assert.ok(after.every((c) => c.body.since === 905))
	assert.ok(log.statuses.includes('resyncing'))
	assert.equal(log.statuses[log.statuses.length - 1], 'online')
	client.stop()
})

test('R22 P7-09 (CLIENT-2): a hidden tab asks getHiddenPresence() instead of getPresence(): the presenting tab\'s {v} goes out on every hidden tick (5 s < 10 s staleness); other hidden tabs send no me', async () => {
	const visibleMe = { c: [1, 2], s: [], d: [], e: null, v: [0, 0, 800, 600] }
	let hiddenMe = { v: [0, 0, 800, 600] }
	let asked = 0
	const { clock, tr, client } = setup({
		getPresence: () => {
			asked++
			return visibleMe
		},
		extra: { getHiddenPresence: () => hiddenMe },
	})
	client.start(1)
	await clock.advance(0)
	assert.deepEqual(tr.calls[0].body.me, visibleMe)
	client.setHidden(true)
	const askedBefore = asked
	const from = tr.calls.length
	await clock.advance(5000 * 4)
	const hiddenCalls = tr.calls.slice(from)
	assert.equal(hiddenCalls.length, 4, 'one request every 5 s while hidden')
	assert.ok(hiddenCalls.every((c) => c.body.pres === 0), 'no presence wanted back while hidden')
	assert.deepEqual(hiddenCalls.map((c) => c.body.me), [hiddenMe, hiddenMe, hiddenMe, hiddenMe], 'the presenter\'s {v} on every hidden tick')
	assert.ok(hiddenCalls.slice(1).every((c, i) => c.at - hiddenCalls[i].at <= 5000), 'at least every 5 s')
	assert.equal(asked, askedBefore, 'getPresence() is not asked while hidden')
	assert.deepEqual(client.sentMe, hiddenMe)
	// not presenting (any more): hidden ticks carry no me (the M0 rule)
	hiddenMe = null
	const from2 = tr.calls.length
	await clock.advance(10000)
	assert.ok(tr.calls.slice(from2).length >= 2)
	assert.ok(tr.calls.slice(from2).every((c) => c.body.me === undefined))
	assert.equal(client.sentMe, null)
	client.stop()
	// without getHiddenPresence (default) a hidden tab sends no me at all
	const d = setup({ getPresence: () => visibleMe })
	d.client.start(1)
	await d.clock.advance(0)
	d.client.setHidden(true)
	const f = d.tr.calls.length
	await d.clock.advance(15000)
	assert.ok(d.tr.calls.slice(f).every((c) => c.body.me === undefined))
	d.client.stop()
})
