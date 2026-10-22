/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §6.4, §33.1 i (R22, P7-07, review finding SYNC-2): a 403 or 404
 * WITHOUT the app error body comes from a proxy or a web application
 * firewall (CrowdSec AppSec in front of Nextcloud blocks a note text), not
 * from Knorke. It is never final:
 * - on /sync the failure path of 0/5xx: the batch stays in flight with the
 *   same seq, failures++, 'offline' from the second one in a row, backoff
 *   1/2/4/8/15 s × (1 + 0–20 %), no isolation (U8 counts 500 only), the next
 *   2xx resets everything;
 * - on the resync snapshot and on a guest re-join the same attempt again
 *   after the same growing wait, the status stays;
 * - never the fixed 2–10 s of proxy 429/503;
 * - app 403/404 ({error: 'forbidden' | 'not_found' …}) stay final.
 * The HttpErrors are built by http.js request() from raw answers, as on the
 * wire.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError, isProxyBlock, isProxyRetry, request } from '../../../src/sync/http.js'
import { Replica } from '../../../src/sync/Replica.js'
import { SyncClient } from '../../../src/sync/SyncClient.js'
import { FakeClock, fakeTransport } from './fakeClock.mjs'

const S1 = '01JA0000000000000000000001'
const S2 = '01JA0000000000000000000002'
const HTML = '<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body>Request blocked</body></html>'

/**
 * @param {number} status HTTP status
 * @param {string} text body
 * @param {string} [type] content type
 * @return {Promise<HttpError>} the error request() throws for that answer
 */
async function wire(status, text, type = 'text/html') {
	const fetchImpl = async () => ({
		ok: false,
		status,
		statusText: status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : '',
		headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
		text: async () => text,
	})
	const e = await request('POST', '/apps/knorke/api/v1/boards/7/sync', { body: { proto: 2 }, fetchImpl }).then(() => null, (x) => x)
	assert.ok(e instanceof HttpError, 'request() rejects with an HttpError')
	return e
}

const PROXY_403 = await wire(403, HTML)
const PROXY_404 = await wire(404, '<html><body>Not Found</body></html>')
const APP_403 = await wire(403, JSON.stringify({ error: 'forbidden', message: 'Forbidden' }), 'application/json')
const APP_404 = await wire(404, JSON.stringify({ error: 'not_found', message: 'Not found' }), 'application/json')

/**
 * @param {object} o options
 * @return {object} harness
 */
function setup({ handler, kind = 'user', onResync = null } = {}) {
	const clock = new FakeClock(10000)
	const tr = fakeTransport(clock, handler, kind)
	const replica = new Replica()
	const log = { statuses: [], acks: [] }
	const client = new SyncClient({
		transport: tr,
		replica,
		client: 'cTEST00001',
		onAcks: (acks) => {
			log.acks.push(acks)
			replica.ack(acks)
		},
		onStatus: (s) => log.statuses.push(s),
		...(onResync ? { onResync } : {}),
		now: clock.now,
		sleep: clock.sleep,
		rand: () => 0.5,
	})
	return { clock, tr, replica, client, log }
}

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

test('R22 P7-07 http.js: 403/404 without the app body are proxy blocks (fromApp false); app 403/404, 401, 429 and 503 are not', async () => {
	for (const e of [PROXY_403, PROXY_404]) {
		assert.equal(e.fromApp, false)
		assert.equal(e.code, 'http_' + e.status)
		assert.equal(isProxyBlock(e), true, e.status + ' text/html')
		assert.equal(isProxyRetry(e), false, 'never the fixed 2–10 s path of 429/503')
	}
	for (const e of [APP_403, APP_404]) {
		assert.equal(e.fromApp, true)
		assert.equal(isProxyBlock(e), false, e.code)
	}
	assert.equal(isProxyBlock(await wire(401, JSON.stringify({ message: 'Current user is not logged in' }), 'application/json')), false, 'Nextcloud 401 is not a proxy block: one is bridged, the second in a row is logged_out (R21)')
	assert.equal(isProxyBlock(await wire(429, HTML)), false)
	assert.equal(isProxyBlock(await wire(503, HTML)), false)
	assert.equal(isProxyBlock(new HttpError(0, 'network')), false)
	assert.equal(isProxyBlock(null), false)
})

for (const [name, err] of [['403 text/html', PROXY_403], ['404 text/html', PROXY_404]]) {
	test('R22 P7-07 /sync answered ' + name + ' once: not final, the batch stays (same seq), no offline after one failure, backoff 1 s × 1.1, then sent and acknowledged', async () => {
		let blocked = false
		const { clock, tr, client, replica, log } = setup({
			handler: (b) => {
				if (b.ops && !blocked) {
					blocked = true
					throw err
				}
				return ok(b)
			},
		})
		client.start(1)
		await clock.advance(0)
		client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'contains ${jndi:ldap://x}' } }])
		await clock.advance(150)
		assert.equal(tr.calls.length, 2)
		assert.equal(tr.calls[1].body.seq, 1)
		assert.equal(client.running, true, 'never final')
		assert.equal(client.finalStatus, null)
		assert.equal(client.failures, 1)
		assert.equal(replica.pendingCount(), 1, 'the op is kept')
		assert.deepEqual(log.statuses, ['online'], 'one failure: no offline, never gone')
		const failedAt = tr.calls[1].at
		await clock.advance(1099)
		assert.equal(tr.calls.length, 2, 'not before the first backoff step')
		await clock.advance(1)
		assert.equal(tr.calls.length, 3)
		assert.equal(tr.calls[2].at - failedAt, 1100, 'backoff 1000 × (1 + 0.5 × 0.2)')
		assert.equal(tr.calls[2].body.seq, 1, 'same seq')
		assert.deepEqual(tr.calls[2].body.ops, tr.calls[1].body.ops, 'same ops')
		assert.equal(replica.pendingCount(), 0, 'acknowledged after the 2xx')
		assert.equal(client.failures, 0)
		assert.deepEqual(log.statuses, ['online'])
		client.stop()
	})
}

test('R22 P7-07 /sync answered 403 text/html then 404 text/html in a row: offline from the second one, backoff 1.1 s then 2.2 s, online again with the next 2xx; never gone', async () => {
	let n = 0
	const { clock, tr, client, replica, log } = setup({
		handler: (b) => {
			if (b.ops && n < 2) {
				n++
				throw n === 1 ? PROXY_403 : PROXY_404
			}
			return ok(b)
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'x' } }])
	await clock.advance(150)
	await clock.advance(1100)
	assert.equal(tr.calls.length, 3)
	assert.deepEqual(log.statuses, ['online', 'offline'], 'the existing connection banner from the second failure on')
	await clock.advance(2199)
	assert.equal(tr.calls.length, 3)
	await clock.advance(1)
	assert.equal(tr.calls.length, 4)
	assert.deepEqual(log.statuses, ['online', 'offline', 'online'])
	assert.equal(replica.pendingCount(), 0)
	assert.equal(client.finalStatus, null)
	client.stop()
})

test('R22 P7-07 a firewall that keeps blocking the batch: never final, never isolated (U8 counts 500 only), waits 1.1/2.2/4.4/8.8/16.5/16.5 s, nothing dropped; the next 2xx delivers it', async () => {
	let block = true
	const { clock, tr, client, replica, log } = setup({
		handler: (b) => {
			if (b.ops && block) {
				throw PROXY_403
			}
			return ok(b)
		},
	})
	client.start(1)
	await clock.advance(0)
	client.enqueue([{ o: 'patch', id: S1, p: { 'data.text': 'a' } }, { o: 'patch', id: S2, p: { 'data.text': 'b' } }])
	await clock.advance(150)
	await clock.advance(1100 + 2200 + 4400 + 8800 + 16500 + 16500)
	const withOps = tr.calls.filter((c) => c.body.ops)
	assert.equal(withOps.length, 7)
	assert.deepEqual(withOps.slice(1).map((c, i) => c.at - withOps[i].at), [1100, 2200, 4400, 8800, 16500, 16500], 'the failure backoff, then ≥ 15 s every time')
	assert.ok(withOps.every((c) => c.body.seq === 1 && c.body.ops.length === 2), 'the whole batch every time: no bisection')
	assert.equal(client.running, true)
	assert.equal(log.acks.length, 0, 'nothing acknowledged or dropped')
	assert.equal(replica.pendingCount(), 2)
	assert.deepEqual(log.statuses, ['online', 'offline'])
	block = false
	await clock.advance(16500)
	assert.equal(replica.pendingCount(), 0)
	assert.deepEqual(log.acks.map((a) => a.res), [['ok', 'ok']])
	assert.deepEqual(log.statuses, ['online', 'offline', 'online'])
	client.stop()
})

test('R22 P7-07 app 403 forbidden and app 404 not_found on /sync stay final (gone)', async () => {
	for (const err of [APP_403, APP_404]) {
		const { clock, client, log } = setup({ handler: () => { throw err } })
		client.start(1)
		await clock.advance(60000)
		assert.deepEqual(log.statuses, ['gone'], err.code)
		assert.equal(client.running, false)
	}
})

test('R22 P7-07 resync snapshot answered 403 and 404 text/html: the same snapshot again after 1.1 s and 2.2 s, the status stays resyncing (never gone or offline), then online', async () => {
	const at = []
	let first = true
	const { clock, client, log } = setup({
		handler: (b) => {
			if (first) {
				first = false
				return { rev: b.since, resync: true, presence: {} }
			}
			return ok(b)
		},
		onResync: async () => {
			at.push(clock.now())
			if (at.length === 1) {
				throw PROXY_403
			}
			if (at.length === 2) {
				throw PROXY_404
			}
			return 40
		},
	})
	client.start(1)
	await clock.advance(0)
	assert.equal(at.length, 1)
	assert.deepEqual(log.statuses, ['online', 'resyncing'])
	await clock.advance(1100)
	assert.equal(at.length, 2)
	assert.deepEqual(log.statuses, ['online', 'resyncing'], 'still resyncing, no new text')
	await clock.advance(2200)
	assert.equal(at.length, 3)
	assert.deepEqual(at.slice(1).map((t, i) => t - at[i]), [1100, 2200])
	assert.deepEqual(log.statuses, ['online', 'resyncing', 'online'])
	assert.equal(client.cursor, 40)
	assert.equal(client.running, true)
	client.stop()
})

test('R22 P7-07 guest re-join answered 403/404 text/html: the same one attempt again after 1.1 s and 2.2 s, never revoked; then the loop goes on', async () => {
	let n = 0
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: (b) => {
			n++
			if (n === 1) {
				throw new HttpError(401, 'guest_token', '', null, true)
			}
			return ok(b)
		},
	})
	const joins = []
	tr.joinHandler = async () => {
		joins.push(clock.now())
		if (joins.length === 1) {
			throw PROXY_403
		}
		if (joins.length === 2) {
			throw PROXY_404
		}
		return { proto: 2, guest: { token: 'tok2' } }
	}
	client.start(1)
	await clock.advance(0)
	await clock.advance(3300)
	assert.equal(joins.length, 3)
	assert.deepEqual(joins.slice(1).map((t, i) => t - joins[i]), [1100, 2200])
	assert.equal(tr.calls.length >= 2, true, 'the sync goes on after the join')
	assert.equal(client.finalStatus, null)
	assert.ok(!log.statuses.includes('revoked') && !log.statuses.includes('gone'))
	assert.equal(client.running, true)
	client.stop()
})

test('R22 P7-07 a guest re-join answered app 404 stays final (revoked)', async () => {
	const { clock, tr, client, log } = setup({
		kind: 'guest',
		handler: () => { throw new HttpError(401, 'guest_token', '', null, true) },
	})
	tr.joinHandler = async () => { throw APP_404 }
	client.start(1)
	await clock.advance(60000)
	assert.deepEqual(log.statuses, ['revoked'])
	assert.equal(tr.joins, 1)
})
