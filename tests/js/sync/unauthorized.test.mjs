/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §1.2 (R21), §5.6, §32 U1, factory job 164: a signed-in tab bridges
 * THREE 401 on /sync. A Redis restart makes Nextcloud answer accounts without
 * "remember me" 401 for a few seconds although their session stays valid
 * (probe P1).
 * - The 1st, 2nd and 3rd 401 of a series take the failure path of 0/5xx: the
 *   batch stays in flight (same seq, same ops), failures++, 'offline' from the
 *   second failure; never final.
 * - The wait after them follows the 401 count alone: 1000, 2000, 4000 ms
 *   (backoffMs[0..2] × (1 + rand × 0.2)), whatever failures came before.
 * - The 4th 401 with no 2xx in between: 'logged_out', stop (7000 ms after the
 *   first one, at most 8400 ms with the random part).
 * - Only a 2xx on /sync resets the count (busy acks and resync: true too);
 *   other errors neither count nor reset, and wait on the normal ladder.
 * - Unchanged: a 401 on the resync snapshot is 'logged_out' at once; guest
 *   tabs re-join once (syncClient.test.mjs).
 * Every case runs with kind 'user' and rand () => 0 (backoff without random)
 * unless it says otherwise.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '../../../src/sync/http.js'
import { Replica } from '../../../src/sync/Replica.js'
import { SyncClient, UNAUTHORIZED_RETRIES } from '../../../src/sync/SyncClient.js'
import { userTransport } from '../../../src/sync/transport.js'
import { FakeClock, fakeTransport } from './fakeClock.mjs'

const S1 = '01JA0000000000000000000001'

/** @return {HttpError} Nextcloud's 401 ({message}, no `error`) */
const e401 = () => new HttpError(401, 'http_401', 'Current user is not logged in')
/** @return {HttpError} no answer at all */
const net = () => new HttpError(0, 'network')

/**
 * @param {object} b request body
 * @return {object} a normal answer (acks for ops)
 */
function ok(b) {
	if (!b.ops) {
		return { rev: b.since, presence: {} }
	}
	return { rev: b.since + 1, acks: { seq: b.seq, rev: b.since + 1, res: b.ops.map(() => 'ok') }, presence: {} }
}

/**
 * Answers in call order: an Error is thrown, a function answers; after the
 * list every call gets `rest`.
 *
 * @param {Array<Error|Function>} steps answers of the first calls
 * @param {Error|Function} [rest] answer of every later call
 * @return {(b: object) => object} handler
 */
function script(steps, rest = ok) {
	let n = 0
	return (b) => {
		const step = n < steps.length ? steps[n] : rest
		n++
		if (step instanceof Error) {
			throw step
		}
		return step(b)
	}
}

/**
 * @param {number} n how many
 * @return {HttpError[]} n fresh 401
 */
const many401 = (n) => Array.from({ length: n }, e401)

/**
 * @param {object} o options
 * @return {{clock: FakeClock, tr: object, replica: Replica, client: SyncClient, log: object}}
 */
function setup({ handler, transport = null, clock = new FakeClock(10000), onResync = null, rand = () => 0 } = {}) {
	const tr = transport ?? fakeTransport(clock, handler, 'user')
	const replica = new Replica()
	const log = { statuses: [], at: {}, acks: [], resyncs: 0 }
	const client = new SyncClient({
		transport: tr,
		replica,
		client: 'cTEST00001',
		onAcks: (acks) => {
			log.acks.push(acks)
			replica.ack(acks)
		},
		onStatus: (s) => {
			log.statuses.push(s)
			log.at[s] = clock.now()
		},
		onResync: onResync ?? (async () => {
			log.resyncs++
			return 100
		}),
		now: clock.now,
		sleep: clock.sleep,
		rand,
	})
	return { clock, tr, replica, client, log }
}

/** @return {object[]} one queued op */
const oneOp = () => [{ o: 'patch', id: S1, p: { 'data.text': 'typed' } }]

/**
 * @param {object[]} calls recorded calls ({at})
 * @return {number[]} time between consecutive calls
 */
const gaps = (calls) => calls.slice(1).map((c, i) => c.at - calls[i].at)

test('job 164: three 401 are bridged before a sign-out', () => {
	assert.equal(UNAUTHORIZED_RETRIES, 3)
})

test('job 164 AK1: 401, 401, 401, 200 with an open op: 4 calls 1000/2000/4000 ms apart, same seq and ops, the acks apply, never logged_out', async () => {
	const { clock, tr, client, log, replica } = setup({ handler: script(many401(3)) })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(0)
	await clock.advance(7000)
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 4000])
	assert.equal(tr.calls[0].body.ops?.length, 1, 'the batch went out with the first request')
	for (const c of tr.calls.slice(1)) {
		assert.equal(c.body.seq, tr.calls[0].body.seq, 'same seq')
		assert.deepEqual(c.body.ops, tr.calls[0].body.ops, 'same ops')
	}
	assert.deepEqual(log.acks.map((a) => a.res), [['ok']])
	assert.equal(replica.pendingCount(), 0)
	assert.deepEqual(log.statuses, ['offline', 'online'])
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	assert.equal(client.failures, 0)
	assert.equal(client.unauthorizedStreak, 0)
	await clock.advance(10000)
	assert.ok(!log.statuses.includes('logged_out'), 'nothing later either')
	assert.equal(client.running, true)
	client.stop()
})

test('job 164: a single 401 is bridged: the next attempt exactly 1000 ms later, no offline, no logged_out', async () => {
	const { clock, tr, client, log } = setup({ handler: script([ok, e401(), ok]) })
	client.start(1)
	await clock.advance(0)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2, 'the idle tick answered 401')
	assert.equal(client.failures, 1, 'counted like a transient failure')
	await clock.advance(999)
	assert.equal(tr.calls.length, 2, 'not before the first backoff step')
	await clock.advance(1)
	assert.equal(tr.calls.length, 3)
	assert.deepEqual(log.statuses, ['online'], 'nothing visible: no offline, no logged_out')
	assert.equal(client.failures, 0)
	client.stop()
})

test('job 164 AK2: 401 throughout with an open op: 4 calls 1000/2000/4000 ms apart, logged_out 7000 ms after the first, stop; flushKeepalive sends nothing', async () => {
	const { clock, tr, client, log, replica } = setup({ handler: () => { throw e401() } })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(60000)
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 4000])
	for (const c of tr.calls.slice(1)) {
		assert.equal(c.body.seq, tr.calls[0].body.seq)
	}
	assert.equal(log.at.logged_out - tr.calls[0].at, 7000)
	assert.deepEqual(log.statuses, ['offline', 'logged_out'])
	assert.equal(client.running, false)
	assert.equal(client.finalStatus, 'logged_out')
	assert.equal(client.status, 'logged_out')
	assert.equal(replica.pendingCount(), 1, 'the op stays in the replica (text rescue of the session)')
	assert.equal(client.flushKeepalive(), 0)
	assert.equal(tr.keepalive.length, 0)
})

test('job 164 AK2: with rand () => 0.999 every wait lies in [step, 1.2 × step], logged_out at most 8400 ms after the first 401', async () => {
	const { clock, tr, client, log, replica } = setup({ handler: () => { throw e401() }, rand: () => 0.999 })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(60000)
	assert.equal(tr.calls.length, 4)
	const g = gaps(tr.calls)
	for (const [i, step] of [1000, 2000, 4000].entries()) {
		assert.ok(g[i] >= step && g[i] <= 1.2 * step, 'gap ' + i + ': ' + g[i])
	}
	assert.ok(g[2] > 4000, 'the random part is applied')
	assert.equal(client.finalStatus, 'logged_out')
	assert.ok(log.at.logged_out - tr.calls[0].at <= 8400, String(log.at.logged_out - tr.calls[0].at))
})

test('job 164 AK3: five network failures before do not stretch it: after the first 401 the gaps are 1000/2000/4000, then logged_out', async () => {
	const { clock, tr, client, log } = setup({ handler: script([net(), net(), net(), net(), net()], e401()) })
	client.start(1)
	await clock.advance(60000)
	assert.equal(tr.calls.length, 9)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 4000, 8000, 15000, 1000, 2000, 4000])
	assert.deepEqual(log.statuses, ['offline', 'logged_out'])
	assert.equal(client.finalStatus, 'logged_out')
	assert.equal(client.running, false)
})

test('job 164 AK3: network, network, 401, 200: the wait after the 401 is 1000 ms (not the third step), the client stays online', async () => {
	const { clock, tr, client, log } = setup({ handler: script([net(), net(), e401()]) })
	client.start(1)
	await clock.advance(0)
	await clock.advance(4000)
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 1000])
	assert.deepEqual(log.statuses, ['offline', 'online'])
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('job 164 AK4: a 2xx resets the count: 401 ×3, 200, 401 ×3, 200 never signs out', async () => {
	const { clock, tr, client, log } = setup({ handler: script([...many401(3), ok, ...many401(3)]) })
	client.start(1)
	await clock.advance(60000)
	assert.deepEqual(gaps(tr.calls).slice(0, 7), [1000, 2000, 4000, 1000, 1000, 2000, 4000])
	assert.ok(!log.statuses.includes('logged_out'))
	assert.deepEqual(log.statuses, ['offline', 'online', 'offline', 'online'])
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('job 164 AK4: 401 ×3, 200, then 401 throughout: logged_out after exactly 8 calls', async () => {
	const { clock, tr, client, log } = setup({ handler: script([...many401(3), ok], e401()) })
	client.start(1)
	await clock.advance(60000)
	assert.equal(tr.calls.length, 8)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 4000, 1000, 1000, 2000, 4000])
	assert.deepEqual(log.statuses, ['offline', 'online', 'offline', 'logged_out'])
	assert.equal(client.running, false)
	assert.equal(client.finalStatus, 'logged_out')
})

test('job 164 AK4: a 2xx with busy acks resets the count: 401 ×3, busy, 401 ×3, 200 is bridged; the batch goes out after the busy wait', async () => {
	const busy = (b) => ({ rev: b.since, acks: { seq: b.seq, rev: b.since, res: b.ops.map(() => 'busy'), retryMs: 2000 }, presence: {} })
	const { clock, tr, client, log, replica } = setup({ handler: script([...many401(3), busy, ...many401(3)]) })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(60000)
	assert.deepEqual(gaps(tr.calls).slice(0, 7), [1000, 2000, 4000, 1000, 1000, 2000, 4000])
	assert.equal(tr.calls[3].body.ops?.length, 1, 'the fourth call carries the batch and gets busy')
	assert.equal(tr.calls[3].body.seq, tr.calls[0].body.seq)
	assert.equal(tr.calls[4].body.ops, undefined, 'during the busy wait only a read: the first 401 of the new series')
	assert.equal(tr.calls[7].body.seq, tr.calls[0].body.seq, 'the same batch goes through')
	assert.deepEqual(log.acks.map((a) => a.res), [['busy'], ['ok']])
	assert.equal(replica.pendingCount(), 0)
	assert.ok(!log.statuses.includes('logged_out'), 'the busy answer reset the count')
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('job 164 AK4: a 2xx with resync: true resets the count: 401 ×3, resync, 401 ×3, 200 is bridged', async () => {
	const { clock, tr, client, log } = setup({ handler: script([...many401(3), (b) => ({ rev: b.since, resync: true }), ...many401(3)]) })
	client.start(1)
	await clock.advance(60000)
	assert.deepEqual(gaps(tr.calls).slice(0, 7), [1000, 2000, 4000, 1000, 1000, 2000, 4000])
	assert.equal(log.resyncs, 1)
	assert.ok(!log.statuses.includes('logged_out'), 'the resync answer reset the count')
	assert.deepEqual(log.statuses.slice(0, 4), ['offline', 'online', 'resyncing', 'online'])
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})

for (const [name, mid] of [
	['network (0)', net],
	['500', () => new HttpError(500, 'internal', '', null, true)],
]) {
	test('job 164 AK5: another error in the series (' + name + ') neither counts nor resets: 401, X, 401, 401, 401 → logged_out after 5 calls', async () => {
		const { clock, tr, client, log } = setup({ handler: script([e401(), mid(), ...many401(3)]) })
		client.start(1)
		await clock.advance(60000)
		assert.equal(tr.calls.length, 5)
		assert.deepEqual(gaps(tr.calls), [1000, 2000, 2000, 4000], 'X waits on the normal ladder (2nd failure), the next 401 goes on with the 401 count')
		assert.deepEqual(log.statuses, ['offline', 'logged_out'])
		assert.equal(client.running, false)
		assert.equal(client.finalStatus, 'logged_out')
	})
}

test('job 164 AK5: 401, network, 401, 401, 200 does not sign out', async () => {
	const { clock, tr, client, log } = setup({ handler: script([e401(), net(), e401(), e401()]) })
	client.start(1)
	await clock.advance(0)
	await clock.advance(9000)
	assert.equal(tr.calls.length, 5)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 2000, 4000])
	assert.deepEqual(log.statuses, ['offline', 'online'])
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('job 164 AK6: a 401 on the resync snapshot is logged_out at once (unchanged; the 2xx before it reset the count)', async () => {
	let resyncs = 0
	const { clock, tr, client, log } = setup({
		handler: (b) => ({ rev: b.since, resync: true }),
		onResync: async () => {
			resyncs++
			throw e401()
		},
	})
	client.start(1)
	await clock.advance(60000)
	assert.equal(tr.calls.length, 1)
	assert.equal(resyncs, 1)
	assert.deepEqual(log.statuses, ['online', 'resyncing', 'logged_out'])
	assert.equal(client.running, false)
	assert.equal(client.finalStatus, 'logged_out')
})

test('job 164 AK6: the 401 the transport builds after a second 412 is bridged three times like any 401; the fourth in a row signs out', async () => {
	const clock = new FakeClock(10000)
	const wire = []
	let csrfOk = false
	const request = async (method, url) => {
		wire.push({ at: clock.now(), method, url })
		if (url === '/csrftoken') {
			return { token: 'fresh' }
		}
		if (!csrfOk) {
			throw new HttpError(412, 'http_412', 'CSRF check failed')
		}
		return { rev: 1, presence: {} }
	}
	const transport = userTransport(3, { request, urlOf: (p) => p, csrfUrl: () => '/csrftoken', getToken: () => 'x', setToken: () => {} })
	const { client, log } = setup({ transport, clock })
	const syncs = () => wire.filter((w) => w.method === 'POST').map((w) => w.at)
	client.start(1)
	await clock.advance(0)
	assert.deepEqual(wire.map((w) => w.method), ['POST', 'GET', 'POST'], '412, one CSRF refresh, 412 again → HttpError(401)')
	assert.equal(client.running, true, 'bridged')
	csrfOk = true
	await clock.advance(1000)
	assert.deepEqual(syncs(), [10000, 10000, 11000])
	assert.deepEqual(log.statuses, ['online'])
	csrfOk = false
	await clock.advance(60000)
	assert.deepEqual(log.statuses, ['online', 'offline', 'logged_out'], 'four transport 401 in a row')
	// the idle tick 1000 ms after the success, then 1000/2000/4000 ms; each tick with its one 412 repeat
	assert.deepEqual(syncs(), [10000, 10000, 11000, 12000, 12000, 13000, 13000, 15000, 15000, 19000, 19000])
	assert.equal(client.running, false)
})

test('job 164 AK7: during the ladder enqueue and poke do not pull the attempt forward, retryNow does, and a pulled-forward 401 counts', async () => {
	const { clock, tr, client, log } = setup({ handler: script(many401(3)) })
	client.start(1)
	await clock.advance(0)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2, 'two 401: the next attempt after 2000 ms')
	client.enqueue(oneOp())
	client.poke()
	await clock.advance(1500)
	assert.equal(tr.calls.length, 2, 'an urgent op and user activity wait for the step')
	client.retryNow()
	await clock.advance(0)
	assert.equal(tr.calls.length, 3, 'the browser online event ends the wait at once')
	assert.equal(tr.calls[2].at, 12500)
	client.enqueue(oneOp())
	client.poke()
	await clock.advance(3999)
	assert.equal(tr.calls.length, 3, 'the pulled-forward 401 was the third: the next step is 4000 ms')
	await clock.advance(1)
	assert.equal(tr.calls.length, 4)
	assert.equal(tr.calls[3].at, 16500)
	assert.deepEqual(log.statuses, ['offline', 'online'])
	assert.equal(client.running, true)
	client.stop()
})

test('job 164 AK7: retryNow after every 401: the fourth 401 still signs out, earlier than 7000 ms', async () => {
	const { clock, tr, client, log } = setup({ handler: () => { throw e401() } })
	client.start(1)
	await clock.advance(0)
	for (let i = 1; i <= 3; i++) {
		assert.equal(tr.calls.length, i)
		assert.equal(client.finalStatus, null, 'bridged ' + i)
		await clock.advance(100)
		client.retryNow()
		await clock.advance(0)
	}
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(gaps(tr.calls), [100, 100, 100])
	assert.equal(client.finalStatus, 'logged_out')
	assert.deepEqual(log.statuses, ['offline', 'logged_out'])
})

test('job 164 AK7: between the first and the fourth 401 the loop is not final: a keepalive flush still sends the batch', async () => {
	const { clock, tr, client, replica } = setup({ handler: () => { throw e401() } })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(0)
	for (const [n, step] of [[1, 1000], [2, 2000], [3, 4000]]) {
		assert.equal(tr.calls.length, n)
		assert.equal(client.finalStatus, null)
		assert.equal(client.flushKeepalive(), 1, 'pagehide after 401 number ' + n)
		assert.equal(tr.keepalive.length, n)
		assert.equal(tr.keepalive[n - 1].seq, tr.calls[0].body.seq)
		await clock.advance(step)
	}
	assert.equal(tr.calls.length, 4)
	assert.equal(client.finalStatus, 'logged_out')
	assert.equal(client.flushKeepalive(), 0, 'after the fourth: nothing')
	assert.equal(tr.keepalive.length, 3)
})
