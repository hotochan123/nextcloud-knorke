/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the harness HTTP client (lib/http.mjs) – no stack needed, a
 * local TCP server on 127.0.0.1 plays the web server. Pins the retry of a
 * pooled keep-alive socket that the server closed for idleness (ENTWICKLUNG
 * trap 9.30): Apache closes an idle keep-alive connection after 5 s; a request
 * written to that socket in the same moment fails with ECONNRESET ("socket
 * hang up") on a REUSED socket, before the server read it. In wave W1 of
 * round 1a this turned one check of C47 red on dm (its requests are 4.96 s
 * apart: two occ calls plus the 4.5 s app-config wait); a probe with 96 gaps
 * of 4.99–5.01 s got two such resets. The client sends such a request once
 * more on a fresh connection – and only then: a reset of a fresh socket stays
 * 'neterr', and there is never a second retry. Run:
 *   node --test 'dev/sim/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { Client, agent } from './lib/http.mjs'

/**
 * A minimal HTTP/1.1 server. decide({conn, nth, req}) per request: 'ok'
 * answers 200 with keep-alive (body = JSON of what it read), 'reset' destroys
 * the connection without an answer. conn = connection number (1…), nth =
 * request number on that connection (1…).
 */
function server(decide) {
	const seen = []
	let conns = 0
	const srv = net.createServer((sock) => {
		const conn = ++conns
		let nth = 0
		let buf = Buffer.alloc(0)
		sock.on('error', () => {})
		sock.on('data', (chunk) => {
			buf = Buffer.concat([buf, chunk])
			for (;;) {
				const end = buf.indexOf('\r\n\r\n')
				if (end < 0) return
				const head = buf.subarray(0, end).toString('latin1')
				const len = Number((/\r\ncontent-length:\s*(\d+)/i.exec(head) || [])[1] || 0)
				if (buf.length < end + 4 + len) return
				const body = buf.subarray(end + 4, end + 4 + len).toString('utf8')
				buf = buf.subarray(end + 4 + len)
				const [method, path] = head.split('\r\n')[0].split(' ')
				const req = { method, path, body }
				nth++
				const what = decide({ conn, nth, req })
				seen.push({ conn, nth, ...req, what })
				if (what === 'reset') {
					sock.destroy()
					return
				}
				const out = JSON.stringify({ conn, nth, method, body })
				sock.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(out)}\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5, max=100\r\n\r\n${out}`)
			}
		})
	})
	return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, port: srv.address().port, conns: () => conns })))
}

const clientFor = (port) => new Client({ ncIp: '127.0.0.1', ncPort: port, host: 'localhost' }, 'selftest')

test.after(() => agent.destroy())

test('a reset of a REUSED keep-alive socket is sent once more on a fresh connection (GET and POST with body)', async () => {
	// every second request on a connection meets the "idle close": no answer
	const s = await server(({ nth }) => (nth >= 2 ? 'reset' : 'ok'))
	try {
		const c = clientFor(s.port)
		const a = await c.request('GET', '/one')
		assert.equal(a.status, 200)
		assert.equal(a.data.conn, 1)
		const b = await c.request('GET', '/two')
		assert.equal(b.status, 200, `the retry answers, not ${b.status} ${b.text}`)
		assert.equal(b.data.conn, 2, 'answered on a fresh connection')
		assert.equal(c.retries, 1)
		const p = await c.request('POST', '/three', { body: { seq: 7, ops: ['x'] } })
		assert.equal(p.status, 200)
		assert.deepEqual(JSON.parse(p.data.body), { seq: 7, ops: ['x'] }, 'the retry carries the whole body')
		assert.equal(c.retries, 2)
		assert.deepEqual(s.seen.map((r) => `${r.conn}.${r.nth} ${r.method} ${r.path} ${r.what}`), [
			'1.1 GET /one ok', '1.2 GET /two reset', '2.1 GET /two ok', '2.2 POST /three reset', '3.1 POST /three ok',
		])
	} finally {
		s.srv.close()
		agent.destroy()
	}
})

test('a reset of a FRESH socket is not retried (status neterr, one request at the server)', async () => {
	const s = await server(() => 'reset')
	try {
		const c = clientFor(s.port)
		const r = await c.request('GET', '/fresh')
		assert.equal(r.status, 'neterr')
		assert.match(r.text, /socket hang up|ECONNRESET/)
		assert.equal(c.retries, 0)
		assert.equal(s.seen.length, 1)
	} finally {
		s.srv.close()
		agent.destroy()
	}
})

test('at most one retry: the retry on its fresh connection is reset, too → neterr', async () => {
	// only the very first request of the run is answered
	const s = await server(({ conn, nth }) => (conn === 1 && nth === 1 ? 'ok' : 'reset'))
	try {
		const c = clientFor(s.port)
		assert.equal((await c.request('GET', '/warm')).status, 200)
		const r = await c.request('POST', '/sync', { body: { seq: 1 } })
		assert.equal(r.status, 'neterr')
		assert.equal(c.retries, 1)
		assert.deepEqual(s.seen.map((x) => `${x.conn}.${x.nth} ${x.what}`), ['1.1 ok', '1.2 reset', '2.1 reset'])
	} finally {
		s.srv.close()
		agent.destroy()
	}
})
