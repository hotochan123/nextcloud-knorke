/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError, isProxyRetry, isSlowDown, parseRetryAfter, request, slowDownDelay } from '../../../src/sync/http.js'
import { guestTransport, newCounters, userTransport } from '../../../src/sync/transport.js'

const TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs8t'

/**
 * Fake fetch answering from a list of {status, body, headers}.
 *
 * @param {Array<object|Function>} answers answers in order (function = throw/return)
 * @return {Function} fetch with .calls
 */
function fakeFetch(answers) {
	const calls = []
	const f = async (url, init) => {
		calls.push({ url, init })
		const a = answers[Math.min(calls.length - 1, answers.length - 1)]
		if (typeof a === 'function') {
			return a(url, init)
		}
		const body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body)
		const headers = new Map(Object.entries(a.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
		return {
			ok: a.status >= 200 && a.status < 300,
			status: a.status,
			statusText: a.statusText ?? '',
			headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
			text: async () => (a.status === 204 ? '' : body),
		}
	}
	f.calls = calls
	return f
}

test('http: JSON with error → app error; {message} → http_<status>; non-JSON → http_<status>', async () => {
	let f = fakeFetch([{ status: 404, body: { error: 'not_found', message: 'Not found' } }])
	await assert.rejects(request('GET', '/x', { fetchImpl: f }), (e) => e instanceof HttpError && e.status === 404 && e.code === 'not_found' && e.fromApp === true && e.message === 'Not found')
	f = fakeFetch([{ status: 401, body: { message: 'Current user is not logged in' } }])
	await assert.rejects(request('GET', '/x', { fetchImpl: f }), (e) => e.status === 401 && e.code === 'http_401' && e.fromApp === false)
	f = fakeFetch([{ status: 429, body: '<html>Too Many Requests</html>', headers: { 'Retry-After': '7' } }])
	await assert.rejects(request('POST', '/x', { body: {}, fetchImpl: f }), (e) => e.code === 'http_429' && e.retryAfterMs === 7000 && isProxyRetry(e))
	f = fakeFetch([{ status: 503, body: 'maintenance' }])
	await assert.rejects(request('GET', '/x', { fetchImpl: f }), (e) => e.code === 'http_503' && e.retryAfterMs === null && isProxyRetry(e))
	f = fakeFetch([{ status: 429, body: { error: 'rate_limited', message: 'slow' } }])
	await assert.rejects(request('GET', '/x', { fetchImpl: f }), (e) => e.code === 'rate_limited' && !isProxyRetry(e))
})

test('http: success, empty body, headers, bytes meter', async () => {
	const f = fakeFetch([{ status: 200, body: { rev: 4 } }, { status: 204, body: '' }])
	let bytes = 0
	const res = await request('POST', '/u', { body: { a: 1 }, headers: { 'X-Test': '1' }, fetchImpl: f, onBytes: (n) => { bytes += n } })
	assert.deepEqual(res, { rev: 4 })
	assert.equal(bytes, JSON.stringify({ rev: 4 }).length)
	const init = f.calls[0].init
	assert.equal(init.method, 'POST')
	assert.equal(init.credentials, 'same-origin')
	assert.equal(init.headers['Content-Type'], 'application/json')
	assert.equal(init.headers['X-Test'], '1')
	assert.equal(init.body, '{"a":1}')
	assert.ok(!/html/i.test(init.headers.Accept), 'Accept without html: Nextcloud answers JSON, no redirect')
	assert.equal(await request('GET', '/u', { fetchImpl: f }), null)
	assert.equal(f.calls[1].init.body, undefined)
})

test('http: network error and timeout → status 0 network', async () => {
	await assert.rejects(request('GET', '/x', { fetchImpl: async () => { throw new TypeError('Failed to fetch') } }), (e) => e.status === 0 && e.code === 'network')
	const hang = (url, init) => new Promise((resolve, reject) => {
		init.signal.addEventListener('abort', () => reject(new Error('aborted')))
	})
	await assert.rejects(request('GET', '/x', { fetchImpl: hang, timeoutMs: 20 }), (e) => e.status === 0 && e.code === 'network' && /timed out/.test(e.message))
})

test('parseRetryAfter: seconds and HTTP date', () => {
	assert.equal(parseRetryAfter('3'), 3000)
	assert.equal(parseRetryAfter(null), null)
	assert.equal(parseRetryAfter('nonsense'), null)
	const now = Date.parse('2026-10-10T10:00:00Z')
	assert.equal(parseRetryAfter('Sat, 10 Oct 2026 10:00:05 GMT', now), 5000)
})

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

test('user transport: headers and URLs; counters', async () => {
	const counters = newCounters()
	const req = fakeRequest([{ rev: 1, items: [] }, { rev: 1 }, { rev: 1 }])
	const tr = userTransport(7, { request: req, urlOf: (p) => '/index.php/apps/knorke' + p, getToken: () => 'csrf1', counters })
	assert.equal(tr.kind, 'user')
	await tr.snapshot()
	await tr.sync({ proto: 1 })
	await tr.snapshot({ count: false })
	assert.deepEqual(req.calls.map((c) => [c.method, c.url]), [
		['GET', '/index.php/apps/knorke/api/v1/boards/7/snapshot'],
		['POST', '/index.php/apps/knorke/api/v1/boards/7/sync'],
		['GET', '/index.php/apps/knorke/api/v1/boards/7/snapshot'],
	])
	for (const c of req.calls) {
		assert.equal(c.opts.headers.requesttoken, 'csrf1')
		assert.equal(c.opts.headers['X-Requested-With'], 'XMLHttpRequest')
	}
	assert.equal(req.calls[0].opts.timeoutMs, 30000)
	assert.equal(req.calls[1].opts.timeoutMs, 10000)
	assert.deepEqual(req.calls[1].opts.body, { proto: 1 })
	assert.equal(counters.snapshotRequests, 1, 'count:false is not counted')
	assert.equal(counters.syncRequests, 1)
})

test('user transport: 412 → one CSRF refresh and one repeat; second 412 → logged out (401)', async () => {
	let token = 'old'
	const e412 = () => new HttpError(412, 'http_412', 'CSRF check failed')
	const req = fakeRequest([e412(), { token: 'fresh' }, (m, u, o) => ({ rev: 2, used: o.headers.requesttoken })])
	const tr = userTransport(3, { request: req, urlOf: (p) => p, csrfUrl: () => '/index.php/csrftoken', getToken: () => token, setToken: (t) => { token = t } })
	const res = await tr.sync({ proto: 1 })
	assert.equal(res.used, 'fresh')
	assert.deepEqual(req.calls.map((c) => [c.method, c.url]), [['POST', '/api/v1/boards/3/sync'], ['GET', '/index.php/csrftoken'], ['POST', '/api/v1/boards/3/sync']])

	const req2 = fakeRequest([e412(), { token: 'fresh' }, e412()])
	const tr2 = userTransport(3, { request: req2, urlOf: (p) => p, csrfUrl: () => '/csrftoken', getToken: () => 'x', setToken: () => {} })
	await assert.rejects(tr2.sync({}), (e) => e.status === 401 && e.code === 'http_401')
	assert.equal(req2.calls.length, 3, 'exactly one repeat')

	// keepalive: no 412 retry
	const req3 = fakeRequest([e412()])
	const tr3 = userTransport(3, { request: req3, urlOf: (p) => p, getToken: () => 'x' })
	await assert.rejects(tr3.sync({}, { keepalive: true }), (e) => e.status === 412)
	assert.equal(req3.calls.length, 1)
	assert.equal(req3.calls[0].opts.keepalive, true)
})

test('guest transport: X-Knorke-Guest, join body, stored guest entry, clearGuest on 404', async () => {
	let stored = { token: 'oldtok', name: 'Gina', link: TOKEN }
	const cleared = []
	const join = { proto: 1, rev: 3, minRev: 0, board: { id: 9, title: 'B', role: 'edit' }, me: { pid: 'p', name: 'Gina G', role: 'edit', guest: true }, items: [], guest: { token: 'newtok', exp: 1 } }
	const req = fakeRequest([join, { rev: 3 }, { rev: 3 }])
	const tr = guestTransport({
		boardId: 9,
		linkToken: TOKEN,
		client: 'cAbc123456',
		getGuest: () => stored,
		setGuest: (g) => { stored = g },
		clearGuest: () => { cleared.push(1); stored = null },
		request: req,
		urlOf: (p) => p,
	})
	assert.equal(tr.kind, 'guest')
	const res = await tr.join()
	assert.equal(res.rev, 3)
	assert.deepEqual(req.calls[0].opts.body, { client: 'cAbc123456', name: 'Gina', guest: 'oldtok' })
	assert.equal(req.calls[0].url, '/pub/v1/' + TOKEN + '/join')
	assert.equal(req.calls[0].opts.headers['X-Requested-With'], 'XMLHttpRequest')
	assert.equal(req.calls[0].opts.headers['X-Knorke-Guest'], undefined, 'no token header on join')
	assert.deepEqual(stored, { token: 'newtok', name: 'Gina G', link: TOKEN })
	await tr.snapshot()
	await tr.sync({ proto: 1 })
	assert.equal(req.calls[1].url, '/pub/v1/boards/9/snapshot')
	assert.equal(req.calls[2].url, '/pub/v1/boards/9/sync')
	assert.equal(req.calls[1].opts.headers['X-Knorke-Guest'], 'newtok')
	assert.equal(req.calls[2].opts.headers['X-Knorke-Guest'], 'newtok')
	assert.equal(req.calls[2].opts.headers['X-Requested-With'], 'XMLHttpRequest')

	const req404 = fakeRequest([new HttpError(404, 'not_found', '', null, true)])
	const tr404 = guestTransport({ boardId: 9, linkToken: TOKEN, client: 'c1', getGuest: () => stored, setGuest: () => {}, clearGuest: () => { cleared.push(2) }, request: req404, urlOf: (p) => p })
	await assert.rejects(tr404.join('Gina'), (e) => e.status === 404)
	assert.deepEqual(cleared, [2])

	const req403 = fakeRequest([new HttpError(403, 'link_revoked', '', null, true)])
	const tr403 = guestTransport({ boardId: 9, linkToken: TOKEN, client: 'c1', getGuest: () => null, setGuest: () => {}, clearGuest: () => { cleared.push(3) }, request: req403, urlOf: (p) => p })
	await assert.rejects(tr403.join('Gina'), (e) => e.code === 'link_revoked')
	assert.deepEqual(cleared, [2], 'only 404 forgets the guest')
})

test('guest transport: no name → name_required before any request; no token → guest_token', async () => {
	const req = fakeRequest([{}])
	const tr = guestTransport({ boardId: 9, linkToken: TOKEN, client: 'c1', getGuest: () => null, setGuest: () => {}, clearGuest: () => {}, request: req, urlOf: (p) => p })
	await assert.rejects(tr.join(null), (e) => e.status === 400 && e.code === 'name_required')
	assert.throws(() => tr.sync({}), (e) => e.status === 401 && e.code === 'guest_token')
	assert.equal(req.calls.length, 0)
})

/**
 * @param {unknown} v parsed JSON
 * @return {string[]} every string (keys and values) that is not well-formed UTF-16
 */
function illFormed(v) {
	if (typeof v === 'string') {
		return v.isWellFormed() ? [] : [v]
	}
	if (v && typeof v === 'object') {
		return Object.entries(v).flatMap(([k, x]) => [...(k.isWellFormed() ? [] : [k]), ...illFormed(x)])
	}
	return []
}

test('http: request bodies are well-formed UTF-16 (T14): a lone surrogate goes out as U+FFFD', async () => {
	const f = fakeFetch([{ status: 200, body: {} }])
	await request('POST', '/sync', { body: { ops: [{ o: 'patch', id: 'x', p: { 'data.text': 'x\uDE00' } }], list: ['\uD83D', 'ok 😀'] }, fetchImpl: f })
	const raw = f.calls[0].init.body
	assert.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(raw), 'no escaped lone surrogate on the wire: ' + raw)
	const parsed = JSON.parse(raw)
	assert.deepEqual(illFormed(parsed), [])
	assert.equal(parsed.ops[0].p['data.text'], 'x�')
	assert.deepEqual(parsed.list, ['�', 'ok 😀'])
})

test('guest join: a name with a lone surrogate is sent well-formed (T14)', async () => {
	const join = { rev: 1, board: { id: 9 }, me: { name: 'Gi�na' }, items: [], guest: { token: 't1', exp: 1 } }
	const f = fakeFetch([{ status: 200, body: join }])
	const tr = guestTransport({
		boardId: 9,
		linkToken: TOKEN,
		client: 'cAbc123456',
		getGuest: () => null,
		setGuest: () => {},
		clearGuest: () => {},
		request: (method, url, opts) => request(method, url, { ...opts, fetchImpl: f }),
		urlOf: (p) => p,
	})
	await tr.join('Gi\uDE00na')
	const parsed = JSON.parse(f.calls[0].init.body)
	assert.deepEqual(illFormed(parsed), [])
	assert.equal(parsed.name, 'Gi�na')
})

// ---- SPEC-M1 (WP-C0) -----------------------------------------------------------

test('M1 http: the app error body stays on the error (409 proto, slow_down retryMs); slow_down is no proxy retry and not final', async () => {
	let f = fakeFetch([{ status: 409, body: { error: 'protocol', message: 'Protocol mismatch', proto: 2 } }])
	await assert.rejects(request('POST', '/x', { body: {}, fetchImpl: f }), (e) => e.status === 409 && e.body?.proto === 2 && e.fromApp)
	f = fakeFetch([{ status: 429, body: { error: 'slow_down', message: 'Slow down', retryMs: 2000 }, headers: { 'Retry-After': '2' } }])
	await assert.rejects(request('GET', '/x', { fetchImpl: f }), (e) => isSlowDown(e) && !isProxyRetry(e) && e.body.retryMs === 2000 && e.retryAfterMs === 2000)
	f = fakeFetch([{ status: 401, body: { message: 'Current user is not logged in' } }])
	await assert.rejects(request('GET', '/x', { fetchImpl: f }), (e) => e.body === null, 'no app body without error')
	assert.equal(isSlowDown(new HttpError(429, 'rate_limited', '', null, true)), false)
	assert.equal(isSlowDown(new HttpError(429, 'slow_down', '', null, false)), false, 'only the app answer')
})

test('M1 slowDownDelay: max(retryMs, 2000) × (1 + 0–20 %), doubling per attempt, capped at 60 s', () => {
	const e = (retryMs, header = null) => new HttpError(429, 'slow_down', '', header, true, retryMs === null ? { error: 'slow_down' } : { error: 'slow_down', retryMs })
	assert.equal(slowDownDelay(e(500), 1, () => 0), 2000)
	const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' ≈ ' + b)
	near(slowDownDelay(e(500), 1, () => 0.999999), 2000 * 1.1999998)
	assert.equal(slowDownDelay(e(3000), 1, () => 0), 3000)
	assert.equal(slowDownDelay(e(3000), 2, () => 0), 6000)
	near(slowDownDelay(e(3000), 3, () => 0.5), 13200)
	assert.equal(slowDownDelay(e(3000), 9, () => 0), 60000)
	assert.equal(slowDownDelay(e(3000), 9, () => 0.9), 60000, 'never above 60 s, random included')
	assert.equal(slowDownDelay(e(null, 7000), 1, () => 0), 7000, 'Retry-After when the body has no retryMs')
	assert.equal(slowDownDelay(e(null), 1, () => 0), 2000)
})

test('M1 (M0 §16.2) guest transport: join reads the client id through getClient on every call', async () => {
	let stored = { token: 'oldtok', name: 'Gina', link: TOKEN }
	let client = 'cPreClaim1'
	const answer = () => ({ proto: 2, rev: 1, board: { id: 9 }, me: { name: 'Gina' }, items: [], guest: { token: 'tok', exp: 1 } })
	const req = fakeRequest([answer, answer])
	const tr = guestTransport({
		boardId: 9,
		linkToken: TOKEN,
		getClient: () => client,
		getGuest: () => stored,
		setGuest: (g) => { stored = g },
		clearGuest: () => {},
		request: req,
		urlOf: (p) => p,
	})
	await tr.join()
	client = 'cClaimed22'
	await tr.join()
	assert.deepEqual(req.calls.map((c) => c.opts.body.client), ['cPreClaim1', 'cClaimed22'])
	// the M0 form (a fixed client) still works
	const req2 = fakeRequest([answer])
	const tr2 = guestTransport({ boardId: 9, linkToken: TOKEN, client: 'cFixed0001', getGuest: () => stored, setGuest: () => {}, clearGuest: () => {}, request: req2, urlOf: (p) => p })
	await tr2.join()
	assert.equal(req2.calls[0].opts.body.client, 'cFixed0001')
})
