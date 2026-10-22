/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §1.2 (R21), §5.6, §32 U1: a signed-in tab tolerates ONE 401 on
 * /sync. A Redis restart makes Nextcloud answer accounts without "remember
 * me" 401 for a moment although their session stays valid (probe P1).
 * - The first 401 takes the failure path of 0/5xx: the batch stays in flight
 *   (same seq, same ops), failures++, 'offline' from the second failure, the
 *   next attempt after the normal backoff step; never final.
 * - A second 401 with no 2xx in between: 'logged_out', stop (as before).
 * - Only a 2xx on /sync resets the count; other errors keep it.
 * - Unchanged: a 401 on the resync snapshot is 'logged_out' at once; guest
 *   tabs re-join once (syncClient.test.mjs).
 * Every case runs with kind 'user' and rand () => 0 (backoff without random).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '../../../src/sync/http.js'
import { Replica } from '../../../src/sync/Replica.js'
import { SyncClient } from '../../../src/sync/SyncClient.js'
import { userTransport } from '../../../src/sync/transport.js'
import { FakeClock, fakeTransport } from './fakeClock.mjs'

const S1 = '01JA0000000000000000000001'

/** @return {HttpError} Nextcloud's 401 ({message}, no `error`) */
const e401 = () => new HttpError(401, 'http_401', 'Current user is not logged in')

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
 * @param {object} o options
 * @return {{clock: FakeClock, tr: object, replica: Replica, client: SyncClient, log: object}}
 */
function setup({ handler, transport = null, clock = new FakeClock(10000), onResync = null } = {}) {
	const tr = transport ?? fakeTransport(clock, handler, 'user')
	const replica = new Replica()
	const log = { statuses: [], acks: [], resyncs: 0 }
	const client = new SyncClient({
		transport: tr,
		replica,
		client: 'cTEST00001',
		onAcks: (acks) => {
			log.acks.push(acks)
			replica.ack(acks)
		},
		onStatus: (s) => log.statuses.push(s),
		onResync: onResync ?? (async () => {
			log.resyncs++
			return 100
		}),
		now: clock.now,
		sleep: clock.sleep,
		rand: () => 0,
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

test('R21 AK1: a single 401 on /sync is bridged: the next attempt exactly 1000 ms later, no offline, no logged_out', async () => {
	const { clock, tr, client, log } = setup({ handler: script([ok, e401(), ok]) })
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.calls.length, 1)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2, 'the idle tick answered 401')
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	assert.equal(client.failures, 1, 'counted like a transient failure')
	await clock.advance(999)
	assert.equal(tr.calls.length, 2, 'not before the first backoff step')
	await clock.advance(1)
	assert.equal(tr.calls.length, 3, 'the retry: first backoff step 1000 ms × (1 + 0 × 0.2)')
	assert.equal(tr.calls[2].at - tr.calls[1].at, 1000)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 4, 'then the normal cadence again')
	assert.deepEqual(log.statuses, ['online'], 'nothing visible: no offline, no logged_out')
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	assert.equal(client.status, 'online')
	assert.equal(client.failures, 0)
	client.stop()
})

test('R21 AK2: two 401 in a row sign out: exactly 2 calls, 1000 ms apart; logged_out, stop; flushKeepalive sends nothing', async () => {
	const { clock, tr, client, log, replica } = setup({ handler: () => { throw e401() } })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(60000)
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].at - tr.calls[0].at, 1000, 'the second try is the first backoff step')
	assert.equal(tr.calls[1].body.seq, tr.calls[0].body.seq)
	assert.deepEqual(log.statuses, ['logged_out'])
	assert.equal(client.running, false)
	assert.equal(client.finalStatus, 'logged_out')
	assert.equal(client.status, 'logged_out')
	assert.equal(replica.pendingCount(), 1, 'the op stays in the replica (text rescue of the session)')
	assert.equal(client.flushKeepalive(), 0)
	assert.equal(tr.keepalive.length, 0)
})

test('R21 AK3: a 2xx resets the count: 401, 200, 401, 200 stays online; 401, 200, 401, 401 signs out after 4 calls', async () => {
	{
		const { clock, tr, client, log } = setup({ handler: script([e401(), ok, e401(), ok]) })
		client.start(1)
		await clock.advance(0)
		await clock.advance(3000)
		assert.equal(tr.calls.length, 4)
		assert.deepEqual(gaps(tr.calls), [1000, 1000, 1000])
		assert.ok(!log.statuses.includes('logged_out'))
		assert.equal(client.running, true)
		await clock.advance(10000)
		assert.ok(!log.statuses.includes('logged_out'), 'nothing later either')
		assert.equal(client.running, true)
		assert.equal(client.finalStatus, null)
		client.stop()
	}
	{
		const { clock, tr, client, log } = setup({ handler: script([e401(), ok, e401()], e401()) })
		client.start(1)
		await clock.advance(60000)
		assert.equal(tr.calls.length, 4)
		assert.deepEqual(log.statuses, ['online', 'logged_out'])
		assert.equal(client.running, false)
		assert.equal(client.finalStatus, 'logged_out')
	}
})

for (const [name, mid] of [
	['500', () => new HttpError(500, 'internal', '', null, true)],
	['network (0)', () => new HttpError(0, 'network')],
]) {
	test('R21 AK4: another error between two 401 (' + name + ') does not reset the count: logged_out after 3 calls', async () => {
		const { clock, tr, client, log } = setup({ handler: script([e401(), mid(), e401()]) })
		client.start(1)
		await clock.advance(60000)
		assert.equal(tr.calls.length, 3)
		assert.deepEqual(gaps(tr.calls), [1000, 2000])
		assert.deepEqual(log.statuses, ['offline', 'logged_out'])
		assert.equal(client.running, false)
		assert.equal(client.finalStatus, 'logged_out')
	})
}

test('R21 AK5: the batch answered 401 stays in flight: the retry carries the same seq and ops, its acks apply', async () => {
	const { clock, tr, client, log, replica } = setup({ handler: script([e401()]) })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(0)
	assert.equal(tr.calls.length, 1)
	assert.ok(Array.isArray(tr.calls[0].body.ops) && tr.calls[0].body.ops.length === 1, 'the batch went out with the first request')
	assert.equal(replica.pendingCount(), 1)
	await clock.advance(1000)
	assert.equal(tr.calls.length, 2)
	assert.equal(tr.calls[1].body.seq, tr.calls[0].body.seq)
	assert.deepEqual(tr.calls[1].body.ops, tr.calls[0].body.ops)
	assert.equal(replica.pendingCount(), 0)
	assert.deepEqual(log.acks.map((a) => a.res), [['ok']])
	assert.ok(!log.acks.some((a) => a.res.includes('bad') || a.res.includes('internal')))
	assert.deepEqual(log.statuses, ['online'])
	client.stop()
})

test('R21 AK6: the retry follows the normal backoff: network, network, 401, 200 → gaps 1000, 2000, 4000; offline, then online', async () => {
	const { clock, tr, client, log } = setup({ handler: script([new HttpError(0, 'network'), new HttpError(0, 'network'), e401()]) })
	client.start(1)
	await clock.advance(0)
	await clock.advance(7000)
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(gaps(tr.calls), [1000, 2000, 4000])
	assert.deepEqual(log.statuses, ['offline', 'online'])
	assert.equal(client.running, true)
	client.stop()
})

test('R21 AK7: a 401 on the resync snapshot is logged_out at once (unchanged; the 2xx before it reset the count)', async () => {
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

test('R21: the 401 the transport builds after a second 412 is bridged like any 401; two in a row sign out', async () => {
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
	assert.deepEqual(log.statuses, ['online', 'logged_out'], 'two transport 401 in a row')
	assert.equal(syncs().length, 3 + 2 * 2, 'two more ticks, each with its one 412 repeat')
	assert.equal(client.running, false)
})

test('R21: the bridged retry waits for the backoff step: enqueue and poke do not pull it forward, retryNow does', async () => {
	const { clock, tr, client, log } = setup({ handler: script([e401()]) })
	client.start(1)
	await clock.advance(0)
	assert.equal(tr.calls.length, 1)
	client.enqueue(oneOp())
	client.poke()
	await clock.advance(500)
	assert.equal(tr.calls.length, 1, 'an urgent op and user activity wait for the backoff step')
	client.retryNow()
	await clock.advance(0)
	assert.equal(tr.calls.length, 2, 'the browser online event ends the wait at once')
	assert.equal(tr.calls[1].at, 10500)
	assert.deepEqual(log.statuses, ['online'])
	client.stop()
})

test('R21: between the two 401 the loop is not final: a keepalive flush still sends the batch once', async () => {
	const { clock, tr, client, replica } = setup({ handler: () => { throw e401() } })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(0)
	assert.equal(tr.calls.length, 1)
	assert.equal(client.finalStatus, null)
	assert.equal(client.flushKeepalive(), 1, 'pagehide in the bridging window')
	assert.equal(tr.keepalive.length, 1)
	assert.equal(tr.keepalive[0].seq, tr.calls[0].body.seq)
	client.stop()
})

test('R21: a 2xx with busy acks resets the count: 401, busy, 401 is bridged; the batch goes out after the busy wait', async () => {
	const busy = (b) => ({ rev: b.since, acks: { seq: b.seq, rev: b.since, res: b.ops.map(() => 'busy'), retryMs: 2000 }, presence: {} })
	const { clock, tr, client, log, replica } = setup({ handler: script([e401(), busy, e401()]) })
	client.start(1)
	replica.addLocal(oneOp())
	await clock.advance(0)
	await clock.advance(60000)
	assert.deepEqual(gaps(tr.calls).slice(0, 3), [1000, 1000, 1000])
	assert.ok(Array.isArray(tr.calls[0].body.ops) && tr.calls[0].body.ops.length === 1, 'the first 401 answered the batch')
	assert.ok(Array.isArray(tr.calls[1].body.ops) && tr.calls[1].body.ops.length === 1, 'the retry carries the batch and gets busy')
	assert.equal(tr.calls[1].body.seq, tr.calls[0].body.seq)
	assert.equal(tr.calls[2].body.ops, undefined, 'during the busy wait only a read: the second 401')
	assert.equal(tr.calls[3].body.seq, tr.calls[0].body.seq, 'after the busy wait the same batch goes out')
	assert.deepEqual(log.acks.map((a) => a.res), [['busy'], ['ok']])
	assert.equal(replica.pendingCount(), 0)
	assert.deepEqual(log.statuses, ['online'], 'the busy answer reset the count: no logged_out')
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('R21: a 2xx with resync: true resets the count: 401, resync, 401 is bridged', async () => {
	const { clock, tr, client, log } = setup({ handler: script([e401(), (b) => ({ rev: b.since, resync: true }), e401()]) })
	client.start(1)
	await clock.advance(0)
	await clock.advance(60000)
	assert.deepEqual(gaps(tr.calls).slice(0, 3), [1000, 1000, 1000])
	assert.equal(log.resyncs, 1)
	assert.deepEqual(log.statuses, ['online', 'resyncing', 'online'], 'the resync answer reset the count: no logged_out')
	assert.equal(client.running, true)
	assert.equal(client.finalStatus, null)
	client.stop()
})
