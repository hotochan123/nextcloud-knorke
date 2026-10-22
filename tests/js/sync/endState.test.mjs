/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §1.2 (R23), §34 D8 (factory job 028): end states with HTTP 200.
 * - /sync (user and guest, keepalive too) and the guest join send
 *   `X-Knorke-End-State: 1`; the snapshot and the CSRF refresh do not need it.
 * - A 2xx answer {end, message} becomes the HttpError of the old answer:
 *   401 for guest_token and not_logged_in, else 403 (also an unknown code),
 *   fromApp true (never a proxy block), the answer as body. A join end answer
 *   neither stores nor forgets the guest entry and keeps boardId.
 * - Everything behind the transport sees the same errors: SyncClient over
 *   the real transports ends in the same statuses with the same number of
 *   joins, whether the server answers the old 401/403 or the 200 end form.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { END_STATE_HEADER, HttpError, endStateOf, isProxyBlock, request as httpRequest } from '../../../src/sync/http.js'
import { PROTOCOL } from '../../../src/sync/protocol.js'
import { Replica } from '../../../src/sync/Replica.js'
import { SyncClient } from '../../../src/sync/SyncClient.js'
import { guestTransport, userTransport } from '../../../src/sync/transport.js'
import { FakeClock } from './fakeClock.mjs'

const TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs8t'
const S1 = '01JA0000000000000000000001'

/** The server's English texts of the codes used here (HttpError::MESSAGES). */
const MESSAGES = {
	guest_token: 'The guest token is invalid or has expired.',
	not_logged_in: 'Not logged in.',
	link_revoked: 'This link has been revoked.',
	link_expired: 'This link has expired.',
	links_disabled: 'Link sharing is disabled by the administrator.',
	password_required: 'This link requires a password.',
}

/** The end states of the server (ApiResponses::END_STATES). */
const END_STATES = new Set(['guest_token', 'not_logged_in', 'link_revoked', 'link_expired', 'links_disabled'])

/**
 * Fake request recording calls; answers from a list (Error instances are thrown).
 *
 * @param {Array<any>} answers answers in order
 * @return {Function} request with .calls
 */
function fakeRequest(answers) {
	const calls = []
	const r = async (method, url, opts) => {
		calls.push({ method, url, opts })
		const a = answers[Math.min(calls.length - 1, answers.length - 1)]
		if (a instanceof Error) {
			throw a
		}
		return typeof a === 'function' ? a(method, url, opts) : a
	}
	r.calls = calls
	return r
}

/**
 * @param {Function} request request function
 * @param {object} [o] stored guest entry and spies
 * @return {{tr: object, spy: {set: object[], cleared: number}, stored: () => object}} guest transport
 */
function guest(request, { stored = { token: 'tok1', name: 'Gina', link: TOKEN } } = {}) {
	let g = stored
	const spy = { set: [], cleared: 0 }
	const tr = guestTransport({
		boardId: 9,
		linkToken: TOKEN,
		client: 'cAbc123456',
		getGuest: () => g,
		setGuest: (x) => { spy.set.push(x); g = x },
		clearGuest: () => { spy.cleared++; g = null },
		request,
		urlOf: (p) => p,
	})
	return { tr, spy, stored: () => g }
}

/** @return {object} end answer of the server */
const end = (code, message = MESSAGES[code] ?? 'Something ended.') => ({ end: code, message })

// ── AK4: the header ──────────────────────────────────────────────────────

test('R23 AK4: user sync (also keepalive) sends X-Knorke-End-State: 1 next to requesttoken and X-Requested-With; snapshot and CSRF refresh do not', async () => {
	const req = fakeRequest([{ rev: 1 }, { rev: 1 }, { rev: 1, items: [] }])
	const tr = userTransport(7, { request: req, urlOf: (p) => p, getToken: () => 'csrf1' })
	await tr.sync({ proto: 2 })
	await tr.sync({ proto: 2 }, { keepalive: true })
	await tr.snapshot()
	for (const c of req.calls.slice(0, 2)) {
		assert.equal(c.url, '/api/v1/boards/7/sync')
		assert.equal(c.opts.headers[END_STATE_HEADER], '1')
		assert.equal(c.opts.headers.requesttoken, 'csrf1')
		assert.equal(c.opts.headers['X-Requested-With'], 'XMLHttpRequest')
	}
	assert.equal(req.calls[1].opts.keepalive, true)
	assert.equal(END_STATE_HEADER, 'X-Knorke-End-State')
	assert.equal(req.calls[2].url, '/api/v1/boards/7/snapshot')
	assert.equal(req.calls[2].opts.headers[END_STATE_HEADER], undefined, 'the snapshot routes do not read it')

	// the repeat after a 412 carries it too; the CSRF refresh does not
	let token = 'old'
	const req2 = fakeRequest([new HttpError(412, 'http_412', 'CSRF check failed'), { token: 'fresh' }, { rev: 2 }])
	const tr2 = userTransport(3, { request: req2, urlOf: (p) => p, csrfUrl: () => '/csrftoken', getToken: () => token, setToken: (t) => { token = t } })
	assert.deepEqual(await tr2.sync({}), { rev: 2 })
	assert.deepEqual(req2.calls.map((c) => [c.method, c.url, c.opts.headers[END_STATE_HEADER]]), [
		['POST', '/api/v1/boards/3/sync', '1'],
		['GET', '/csrftoken', undefined],
		['POST', '/api/v1/boards/3/sync', '1'],
	])
	assert.equal(req2.calls[2].opts.headers.requesttoken, 'fresh')
})

test('R23 AK4: guest sync and join send X-Knorke-End-State: 1; X-Requested-With and X-Knorke-Guest stay; the snapshot does not send it', async () => {
	const join = { proto: 2, rev: 3, board: { id: 9 }, me: { name: 'Gina' }, items: [], guest: { token: 'tok2', exp: 1 } }
	const req = fakeRequest([join, { rev: 3 }, { rev: 3 }, { rev: 3, items: [] }])
	const { tr } = guest(req)
	await tr.join('Gina')
	await tr.sync({ proto: 2 })
	await tr.sync({ proto: 2 }, { keepalive: true })
	await tr.snapshot()
	const [j, s, k, snap] = req.calls
	assert.equal(j.url, '/pub/v1/' + TOKEN + '/join')
	assert.deepEqual(j.opts.headers, { 'X-Requested-With': 'XMLHttpRequest', [END_STATE_HEADER]: '1' })
	for (const c of [s, k]) {
		assert.equal(c.url, '/pub/v1/boards/9/sync')
		assert.deepEqual(c.opts.headers, { 'X-Requested-With': 'XMLHttpRequest', 'X-Knorke-Guest': 'tok2', [END_STATE_HEADER]: '1' })
	}
	assert.equal(k.opts.keepalive, true)
	assert.deepEqual(snap.opts.headers, { 'X-Requested-With': 'XMLHttpRequest', 'X-Knorke-Guest': 'tok2' })
})

test('R23 AK4: the header reaches fetch through the real request()', async () => {
	const seen = []
	const fetchImpl = async (url, init) => {
		seen.push({ url, headers: init.headers })
		return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, text: async () => '{"rev":1}' }
	}
	const request = (m, u, o) => httpRequest(m, u, { ...o, fetchImpl })
	await userTransport(1, { request, urlOf: (p) => p, getToken: () => 't' }).sync({})
	await guest(request).tr.sync({})
	assert.deepEqual(seen.map((x) => x.headers[END_STATE_HEADER]), ['1', '1'])
	assert.equal(seen[0].headers.requesttoken, 't')
	assert.equal(seen[1].headers['X-Knorke-Guest'], 'tok1')
})

// ── AK5: the end answer becomes the old error ───────────────────────────

/**
 * @param {Promise<any>} p the call
 * @param {object} want expected status, code, message
 * @param {string} label assertion label
 */
async function rejectsAs(p, { status, code, message }, label) {
	await assert.rejects(p, (e) => {
		assert.ok(e instanceof HttpError, label + ': an HttpError')
		assert.equal(e.status, status, label + ': status')
		assert.equal(e.code, code, label + ': code')
		assert.equal(e.message, message, label + ': message')
		assert.equal(e.fromApp, true, label + ': fromApp')
		assert.equal(e.body?.end, code, label + ': the answer stays as body')
		assert.equal(e.retryAfterMs, null, label + ': no Retry-After')
		assert.equal(isProxyBlock(e), false, label + ': never a firewall block')
		return true
	})
}

test('R23 AK5: guest sync end answers → 403 link_revoked / links_disabled / link_expired / unknown, 401 guest_token; fromApp, never a proxy block', async () => {
	for (const [code, status] of [['link_revoked', 403], ['guest_token', 401], ['links_disabled', 403], ['link_expired', 403], ['foo', 403]]) {
		const { tr } = guest(fakeRequest([end(code)]))
		await rejectsAs(tr.sync({ proto: 2 }), { status, code, message: MESSAGES[code] ?? 'Something ended.' }, 'guest sync ' + code)
	}
	// a keepalive sync rejects the same way (SyncClient swallows it)
	const { tr } = guest(fakeRequest([end('link_revoked')]))
	await rejectsAs(tr.sync({ proto: 2 }, { keepalive: true }), { status: 403, code: 'link_revoked', message: MESSAGES.link_revoked }, 'keepalive')
})

test('R23 AK5: user sync end answers → 401 not_logged_in, 403 for the rest; also after a 412 repeat and with keepalive', async () => {
	for (const [code, status] of [['not_logged_in', 401], ['guest_token', 401], ['link_revoked', 403], ['links_disabled', 403], ['link_expired', 403], ['foo', 403]]) {
		const tr = userTransport(3, { request: fakeRequest([end(code)]), urlOf: (p) => p, getToken: () => 'x' })
		await rejectsAs(tr.sync({}), { status, code, message: MESSAGES[code] ?? 'Something ended.' }, 'user sync ' + code)
	}
	const req = fakeRequest([new HttpError(412, 'http_412', 'CSRF check failed'), { token: 'fresh' }, end('not_logged_in')])
	const tr = userTransport(3, { request: req, urlOf: (p) => p, csrfUrl: () => '/csrftoken', getToken: () => 'x', setToken: () => {} })
	await rejectsAs(tr.sync({}), { status: 401, code: 'not_logged_in', message: 'Not logged in.' }, 'after 412')
	assert.equal(req.calls.length, 3)
	const ka = userTransport(3, { request: fakeRequest([end('not_logged_in')]), urlOf: (p) => p, getToken: () => 'x' })
	await rejectsAs(ka.sync({}, { keepalive: true }), { status: 401, code: 'not_logged_in', message: 'Not logged in.' }, 'keepalive')
})

test('R23 AK5: the message comes from the body; a missing or non-string message gives the plain code', async () => {
	for (const body of [{ end: 'link_revoked' }, { end: 'link_revoked', message: 5 }, { end: 'link_revoked', message: null }]) {
		assert.throws(() => endStateOf(body), (e) => e.status === 403 && e.code === 'link_revoked' && e.message === 'link_revoked' && e.fromApp === true)
	}
	assert.throws(() => endStateOf({ end: 'link_expired', message: 'Gone since Monday.' }), (e) => e.message === 'Gone since Monday.')
})

test('R23 AK5: a join end answer throws before the token check: no setGuest, no clearGuest, boardId stays', async () => {
	for (const [code, status] of [['link_revoked', 403], ['link_expired', 403], ['links_disabled', 403], ['guest_token', 401]]) {
		const req = fakeRequest([end(code)])
		const { tr, spy, stored } = guest(req)
		const before = stored()
		await rejectsAs(tr.join(null), { status, code, message: MESSAGES[code] }, 'join ' + code)
		assert.deepEqual(spy.set, [], code + ': setGuest not called')
		assert.equal(spy.cleared, 0, code + ': clearGuest not called')
		assert.equal(stored(), before, code + ': the stored entry stays')
		assert.equal(tr.boardId, 9, code + ': boardId stays')
		assert.equal(req.calls[0].opts.body.guest, 'tok1', 'the old token went along')
	}
	// an end answer that also carried board and guest is still an end answer
	const { tr, spy } = guest(fakeRequest([{ ...end('link_revoked'), board: { id: 12 }, guest: { token: 'x' } }]))
	await rejectsAs(tr.join('Gina'), { status: 403, code: 'link_revoked', message: MESSAGES.link_revoked }, 'join with extra keys')
	assert.deepEqual([spy.set, spy.cleared, tr.boardId], [[], 0, 9])
})

test('R23 AK5: answers without a non-empty string end come back unchanged', async () => {
	for (const body of [{ rev: 3 }, { rev: 3, end: '' }, { rev: 3, end: 5 }, { rev: 3, end: null }, { rev: 3, end: ['link_revoked'] }]) {
		const { tr } = guest(fakeRequest([body]))
		assert.equal(await tr.sync({}), body, JSON.stringify(body) + ' (guest)')
		const ut = userTransport(3, { request: fakeRequest([body]), urlOf: (p) => p, getToken: () => 'x' })
		assert.equal(await ut.sync({}), body, JSON.stringify(body) + ' (user)')
		assert.equal(endStateOf(body), body)
	}
	for (const v of [null, undefined, 'x', 3, [{ end: 'link_revoked' }]]) {
		assert.equal(endStateOf(v), v)
	}
	// a join answer without end goes on as before
	const join = { proto: 2, rev: 3, board: { id: 11 }, me: { name: 'Gina G' }, items: [], guest: { token: 'tok2', exp: 1 }, end: '' }
	const { tr, stored } = guest(fakeRequest([join]))
	assert.equal(await tr.join(null), join)
	assert.deepEqual(stored(), { token: 'tok2', name: 'Gina G', link: TOKEN })
	assert.equal(tr.boardId, 11)
})

// ── AK6: the same final states behind the transport ──────────────────────

/**
 * Fake server behind the real request(): an error is answered in the app's
 * error form, or — `ends` true (a server with job 028), the header sent, an
 * end state with 401/403 — as 200 {end, message}, like ApiResponses.
 *
 * @param {FakeClock} clock clock for the call times
 * @param {boolean} ends whether the server answers end states with 200
 * @param {(call: object) => ({status: number, code?: string, body?: object})} route answer per call
 * @return {Function} fetch with .calls
 */
function fakeServer(clock, ends, route) {
	const calls = []
	const f = async (url, init) => {
		const call = { at: clock.now(), url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null }
		calls.push(call)
		const a = route(call)
		let status = a.status
		let body = a.body
		if (a.code) {
			body = { error: a.code, message: MESSAGES[a.code] ?? a.code }
			if (ends && init.headers?.[END_STATE_HEADER] === '1' && (status === 401 || status === 403) && END_STATES.has(a.code)) {
				status = 200
				body = { end: a.code, message: MESSAGES[a.code] }
			}
		}
		call.status = status
		const text = JSON.stringify(body)
		return { ok: status >= 200 && status < 300, status, statusText: '', headers: { get: () => null }, text: async () => text }
	}
	f.calls = calls
	return f
}

/** @return {object} a normal sync answer */
const ok = (call) => ({ status: 200, body: call.body?.ops ? { rev: call.body.since + 1, acks: { seq: call.body.seq, rev: call.body.since + 1, res: call.body.ops.map(() => 'ok') }, presence: {} } : { rev: call.body.since, presence: {} } })

/**
 * Runs SyncClient over a real transport against fakeServer.
 *
 * @param {object} o options
 * @param {'guest'|'user'} o.kind transport kind
 * @param {boolean} o.ends server answers end states with 200
 * @param {(call: object) => object} o.sync answer of a /sync
 * @param {(call: object) => object} [o.join] answer of a /join
 * @return {Promise<object>} what the run produced
 */
async function runClient({ kind, ends, sync, join = () => ({ status: 500, code: 'internal' }) }) {
	const clock = new FakeClock(10000)
	const fetchImpl = fakeServer(clock, ends, (call) => (/\/join$/.test(call.url) ? join(call) : sync(call)))
	const request = (m, u, o) => httpRequest(m, u, { ...o, fetchImpl })
	let stored = { token: 'tok1', name: 'Gina', link: TOKEN }
	const transport = kind === 'guest'
		? guestTransport({ boardId: 9, linkToken: TOKEN, client: 'cTEST00001', getGuest: () => stored, setGuest: (g) => { stored = g }, clearGuest: () => { stored = null }, request, urlOf: (p) => p })
		: userTransport(3, { request, urlOf: (p) => p, getToken: () => 'csrf' })
	const replica = new Replica()
	const log = { statuses: [] }
	const client = new SyncClient({
		transport,
		replica,
		client: 'cTEST00001',
		onAcks: (acks) => replica.ack(acks),
		onStatus: (s) => log.statuses.push(s),
		now: clock.now,
		sleep: clock.sleep,
		rand: () => 0,
	})
	client.start(1)
	replica.addLocal([{ o: 'patch', id: S1, p: { 'data.text': 'typed' } }])
	await clock.advance(60000)
	const calls = fetchImpl.calls
	const out = {
		statuses: log.statuses,
		joins: calls.filter((c) => /\/join$/.test(c.url)).length,
		syncTimes: calls.filter((c) => /\/sync$/.test(c.url)).map((c) => c.at),
		finalStatus: client.finalStatus,
		running: client.running,
		stored,
		wire: calls.map((c) => c.status),
		keepalive: client.finalStatus !== null ? client.flushKeepalive() : null,
	}
	client.stop()
	return out
}

const ROWS = [
	{
		name: 'guest: sync link_revoked, re-join link_revoked → revoked, 1 join',
		kind: 'guest',
		sync: () => ({ status: 403, code: 'link_revoked' }),
		join: () => ({ status: 403, code: 'link_revoked' }),
		want: { finalStatus: 'revoked', joins: 1, statuses: ['revoked'] },
	},
	{
		name: 'guest: sync guest_token, re-join 200 with a snapshot → online, 1 join, the new token stored',
		kind: 'guest',
		sync: (call) => (call.headers['X-Knorke-Guest'] === 'tok1' ? { status: 401, code: 'guest_token' } : ok(call)),
		join: () => ({ status: 200, body: { proto: PROTOCOL, rev: 1, board: { id: 9 }, me: { name: 'Gina' }, items: [], guest: { token: 'tok2', exp: 1 } } }),
		want: { finalStatus: null, joins: 1, statuses: ['online'] },
	},
	{
		name: 'guest: sync links_disabled → links_disabled, no join',
		kind: 'guest',
		sync: () => ({ status: 403, code: 'links_disabled' }),
		want: { finalStatus: 'links_disabled', joins: 0, statuses: ['links_disabled'] },
	},
	{
		name: 'guest: sync guest_token, re-join link_expired → link_expired',
		kind: 'guest',
		sync: () => ({ status: 401, code: 'guest_token' }),
		join: () => ({ status: 403, code: 'link_expired' }),
		want: { finalStatus: 'link_expired', joins: 1, statuses: ['link_expired'] },
	},
	{
		name: 'guest: sync link_revoked, re-join links_disabled → links_disabled',
		kind: 'guest',
		sync: () => ({ status: 403, code: 'link_revoked' }),
		join: () => ({ status: 403, code: 'links_disabled' }),
		want: { finalStatus: 'links_disabled', joins: 1, statuses: ['links_disabled'] },
	},
	{
		name: 'guest: sync link_revoked, re-join 403 password_required (stays 403) → password_required',
		kind: 'guest',
		sync: () => ({ status: 403, code: 'link_revoked' }),
		join: () => ({ status: 403, code: 'password_required' }),
		want: { finalStatus: 'password_required', joins: 1, statuses: ['password_required'] },
	},
	{
		name: 'user: sync not_logged_in twice → logged_out after exactly 2 calls, 1000 ms apart',
		kind: 'user',
		sync: () => ({ status: 401, code: 'not_logged_in' }),
		want: { finalStatus: 'logged_out', joins: 0, statuses: ['logged_out'], syncGaps: [1000] },
	},
]

for (const row of ROWS) {
	test('R23 AK6: ' + row.name + '; the same with the 401/403 and with the 200 end answer', async () => {
		const old = await runClient({ ...row, ends: false })
		const now = await runClient({ ...row, ends: true })
		for (const [label, r] of [['401/403', old], ['200 end', now]]) {
			assert.equal(r.finalStatus, row.want.finalStatus, label + ': finalStatus')
			assert.equal(r.joins, row.want.joins, label + ': joins')
			assert.deepEqual(r.statuses, row.want.statuses, label + ': statuses')
			if (row.want.syncGaps) {
				assert.deepEqual(r.syncTimes.slice(1).map((t, i) => t - r.syncTimes[i]), row.want.syncGaps, label + ': calls')
			}
			if (r.finalStatus !== null) {
				assert.equal(r.running, false, label + ': stopped')
				assert.equal(r.keepalive, 0, label + ': flushKeepalive sends nothing after the final status')
			}
		}
		assert.deepEqual([now.statuses, now.joins, now.finalStatus, now.syncTimes], [old.statuses, old.joins, old.finalStatus, old.syncTimes], 'both runs alike')
		assert.ok(old.wire.some((s) => s === 401 || s === 403), 'the old server answered 401/403')
		const endsSeen = now.wire.filter((s) => s === 401 || s === 403)
		if (row.name.includes('password_required')) {
			assert.deepEqual(endsSeen, [403], 'with end answers only the password join stays 403')
		} else {
			assert.deepEqual(endsSeen, [], 'with end answers no 401/403 went over the wire')
		}
		if (row.want.finalStatus === null) {
			assert.equal(now.stored.token, 'tok2', 'the new token is stored')
			assert.equal(old.stored.token, 'tok2')
		}
	})
}

test('R23 AK6: an old server (or a proxy that drops the header) gets the old answers: the client behaves as before', async () => {
	// the fake server with ends = false is exactly that: it ignores the header
	const r = await runClient({ kind: 'guest', ends: false, sync: () => ({ status: 403, code: 'link_revoked' }), join: () => ({ status: 403, code: 'link_revoked' }) })
	assert.deepEqual(r.wire, [403, 403])
	assert.equal(r.finalStatus, 'revoked')
})
