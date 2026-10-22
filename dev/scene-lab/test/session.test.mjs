/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Session server of the tablet measurement R-A (dev/scene-lab/ipad/session.mjs,
 * SPEC-M1 §8.8, §16): bind address and port of the CLI, paths only inside the
 * package (also through symlinks), POST /result with label check, 413, 400,
 * 500, Host and Origin checks, headers incl. the CSP of the two pages, the
 * automatic end. Every server listens on 127.0.0.1 with port 0.
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HEADERS, LABEL_RE, PAGES, allowedHost, createSessionServer, pageCsp, parseArgs, resolveInSite } from '../ipad/session.mjs'

const IPAD = join(dirname(fileURLToPath(import.meta.url)), '..', 'ipad')
const TMP = mkdtempSync(join(tmpdir(), 'knorke-session-'))

/** A package-like site: the two pages, lab/ with an index, a secret beside it and symlinks. */
function makeSite() {
	const root = mkdtempSync(join(TMP, 'pkg-'))
	const site = join(root, 'ipad-ra')
	mkdirSync(join(site, 'lab'), { recursive: true })
	for (const name of Object.values(PAGES)) copyFileSync(join(IPAD, name), join(site, name))
	writeFileSync(join(site, 'lab', 'index.html'), '<!doctype html><title>lab</title>')
	writeFileSync(join(site, 'ANLEITUNG-R-A.md'), '# Anleitung\n')
	writeFileSync(join(root, 'secret.txt'), 'outside the package\n')
	symlinkSync(join(root, 'secret.txt'), join(site, 'link-out.txt'))
	symlinkSync(join(site, 'ANLEITUNG-R-A.md'), join(site, 'link-in.md'))
	symlinkSync(root, join(site, 'dir-out'))
	return { root, site, results: join(root, 'ipad-ra-results') }
}

/**
 * @param {import('node:http').Server} server listening server
 * @param {object} o request
 * @return {Promise<{status: number, headers: object, body: string}>}
 */
function send(server, { method = 'GET', path = '/', body = null, headers = {}, chunked = false }) {
	const { port } = server.address()
	return new Promise((resolve, reject) => {
		const h = { Host: `127.0.0.1:${port}`, ...headers }
		if (body !== null && !chunked && h['Content-Length'] === undefined) h['Content-Length'] = Buffer.byteLength(body)
		const req = request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
		})
		req.on('error', reject)
		if (body !== null) req.write(body)
		req.end()
	})
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
const close = (server) => new Promise((resolve) => server.close(() => resolve()))

after(() => {
	// only the directory this file created below the system tmpdir
	if (TMP.startsWith(tmpdir() + sep) && TMP.includes('knorke-session-')) rmSync(TMP, { recursive: true, force: true })
})

describe('CLI: bind address, port, options', () => {
	test('only 127.0.0.1 or a private IPv4 host address (10/8, 172.16/12, 192.168/16), never 0.0.0.0, ::, names or public addresses', () => {
		for (const h of ['127.0.0.1', '192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '192.168.1.254']) {
			assert.equal(allowedHost(h), true, h)
		}
		for (const h of ['0.0.0.0', '::', '::1', '127.0.0.2', 'localhost', 'tower', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1',
			'192.168.1.0', '192.168.1.255', '192.168.1.256', '192.168.1.057', '192.168.01.20', '10.0.0', ' 10.0.0.5', '', undefined, 1]) {
			assert.equal(allowedHost(h), false, String(h))
		}
	})

	test('parseArgs: address and port required, port above 1024, hours > 0 up to 24, known options only', () => {
		const LAN = '192.168.1.20'
		assert.deepEqual(parseArgs([LAN, '18612']), { host: LAN, port: 18612, results: null, hours: 4, site: null })
		// R-B (after stage 4; SPEC-M1 §8.8 point 2, §30 T4-13): the session server stays with [S] and runs on 18613, the app relay takes 18612
		assert.deepEqual(parseArgs([LAN, '18613']), { host: LAN, port: 18613, results: null, hours: 4, site: null })
		assert.deepEqual(parseArgs(['10.0.0.5', '18612']), { host: '10.0.0.5', port: 18612, results: null, hours: 4, site: null })
		assert.deepEqual(parseArgs(['127.0.0.1', '1025', '--results', '/x/r', '--hours', '0.5', '--site', '/x/p']),
			{ host: '127.0.0.1', port: 1025, results: '/x/r', hours: 0.5, site: '/x/p' })
		for (const args of [[], [LAN], ['0.0.0.0', '18612'], ['::', '18612'], ['8.8.8.8', '18612'], [LAN, '1024'],
			[LAN, '80'], [LAN, '65536'], [LAN, '18612x'], [LAN, '18612', 'extra'],
			[LAN, '18612', '--hours', '0'], [LAN, '18612', '--hours', '25'], [LAN, '18612', '--hours'],
			[LAN, '18612', '--bind', 'x']]) {
			assert.equal(parseArgs(args), null, args.join(' '))
		}
	})

	test('label pattern', () => {
		for (const l of ['bench-lauf-1', 'labor-lauf-3', 'geraet-notiz', 'a', 'x'.repeat(40)]) assert.ok(LABEL_RE.test(l), l)
		for (const l of ['', 'Bench', 'bench_1', 'bench 1', '../x', 'x'.repeat(41), 'ä', 'a/b']) assert.equal(LABEL_RE.test(l), false, l)
	})
})

describe('paths stay inside the package', () => {
	const { site } = makeSite()
	test('normal files, directories, query strings', () => {
		assert.equal(resolveInSite(site, '/ANLEITUNG-R-A.md'), join(site, 'ANLEITUNG-R-A.md'))
		assert.equal(resolveInSite(site, '/lab/?panel=1'), join(site, 'lab', 'index.html'))
		assert.equal(resolveInSite(site, '/link-in.md'), join(site, 'ANLEITUNG-R-A.md'))
	})

	test('../, %2e%2e, encoded slashes, NUL, broken escapes and symlinks out are refused', () => {
		for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/lab/../../secret.txt',
			'/a%00b', '/%E0%A4%A', '/link-out.txt', '/dir-out/secret.txt', '/dir-out/', '/missing.html', '/']) {
			assert.equal(resolveInSite(site, p), null, p)
		}
	})
})

describe('over HTTP', () => {
	let server
	let fx
	const lines = []
	before(async () => {
		fx = makeSite()
		server = await listen(createSessionServer({ site: fx.site, results: fx.results, maxBody: 64 * 1024, log: (l) => lines.push(l) }))
	})
	after(() => close(server))

	test('start page and send page with the security headers and a hash CSP', async () => {
		for (const [path, name] of Object.entries(PAGES)) {
			const r = await send(server, { path })
			assert.equal(r.status, 200, path)
			assert.match(r.headers['content-type'], /^text\/html/)
			for (const [k, v] of Object.entries(HEADERS)) assert.equal(r.headers[k.toLowerCase()], v, `${path} ${k}`)
			const html = readFileSync(join(IPAD, name), 'utf8')
			assert.equal(r.body, html)
			assert.equal(r.headers['content-security-policy'], pageCsp(html))
			assert.match(r.headers['content-security-policy'], /default-src 'none'; .*connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'/)
		}
		const send_ = readFileSync(join(IPAD, 'session-send.html'), 'utf8')
		const script = /<script>([\s\S]*?)<\/script>/.exec(send_)[1]
		assert.ok(pageCsp(send_).includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`))
		assert.match(pageCsp(readFileSync(join(IPAD, 'session-start.html'), 'utf8')), /script-src 'none'/)
	})

	test('package files with the same headers (no CSP), HEAD without body', async () => {
		const r = await send(server, { path: '/lab/?panel=1' })
		assert.equal(r.status, 200)
		assert.equal(r.headers['cross-origin-embedder-policy'], 'require-corp')
		assert.equal(r.headers['referrer-policy'], 'no-referrer')
		assert.equal(r.headers['content-security-policy'], undefined)
		const h = await send(server, { method: 'HEAD', path: '/ANLEITUNG-R-A.md' })
		assert.equal(h.status, 200)
		assert.equal(h.body, '')
		assert.match(h.headers['content-type'], /^text\/plain/)
	})

	test('traversal and symlinks out: 404', async () => {
		for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/link-out.txt', '/dir-out/secret.txt', '/nope']) {
			const r = await send(server, { path })
			assert.equal(r.status, 404, path)
			assert.doesNotMatch(r.body, /outside the package/)
		}
	})

	test('405 with Allow for other methods', async () => {
		const put = await send(server, { method: 'PUT', path: '/result?label=x', body: 'x' })
		assert.equal(put.status, 405)
		assert.equal(put.headers.allow, 'POST')
		const post = await send(server, { method: 'POST', path: '/', body: 'x' })
		assert.equal(post.status, 405)
		assert.equal(post.headers.allow, 'GET, HEAD')
		assert.equal((await send(server, { method: 'DELETE', path: '/lab/' })).status, 405)
	})

	test('POST /result stores one new file per send (JSON as .json, text as .txt), flag wx', async () => {
		const a = await send(server, { method: 'POST', path: '/result?label=bench-lauf-1', body: '{"fps": 59.9}', headers: { 'Content-Type': 'text/plain' } })
		assert.equal(a.status, 200, a.body)
		const b = await send(server, { method: 'POST', path: '/result?label=bench-lauf-1', body: '{"fps": 58}' })
		const c = await send(server, { method: 'POST', path: '/result?label=geraet-notiz', body: 'Galaxy Tab S9, Android 15, Chrome 141, 120 Hz' })
		assert.equal(b.status, 200)
		assert.equal(c.status, 200)
		const files = readdirSync(fx.results).sort()
		assert.equal(files.length, 3)
		for (const f of files) assert.match(f, /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z_[a-z0-9-]+(_\d+)?\.(json|txt)$/)
		const laden = files.filter((f) => f.includes('_bench-lauf-1'))
		assert.equal(laden.length, 2)
		assert.ok(laden.every((f) => f.endsWith('.json')))
		assert.deepEqual(laden.map((f) => JSON.parse(readFileSync(join(fx.results, f), 'utf8')).fps).sort(), [58, 59.9])
		const notiz = files.find((f) => f.includes('_geraet-notiz'))
		assert.ok(notiz.endsWith('.txt'))
		assert.equal(readFileSync(join(fx.results, notiz), 'utf8'), 'Galaxy Tab S9, Android 15, Chrome 141, 120 Hz')
		assert.match(a.body, /^Gespeichert: .*_bench-lauf-1\.json\n$/)
		// the log names the file, never the content
		assert.ok(lines.some((l) => l.startsWith('saved ') && l.includes('_geraet-notiz')))
		assert.ok(!lines.some((l) => l.includes('Galaxy')))
	})

	test('label: missing, upper case, too long or with a slash → 400, nothing stored', async () => {
		const before_ = readdirSync(fx.results).length
		for (const q of ['', '?label=', '?label=Bench', '?label=' + 'x'.repeat(41), '?label=..%2Fx', '?label=a%20b']) {
			const r = await send(server, { method: 'POST', path: '/result' + q, body: '{}' })
			assert.equal(r.status, 400, q)
		}
		assert.equal(readdirSync(fx.results).length, before_)
	})

	test('empty or blank body → 400', async () => {
		assert.equal((await send(server, { method: 'POST', path: '/result?label=x', body: '' })).status, 400)
		assert.equal((await send(server, { method: 'POST', path: '/result?label=x', body: ' \n\t ' })).status, 400)
	})

	test('too large → 413, declared by Content-Length or found while streaming', async () => {
		const n = readdirSync(fx.results).length
		const declared = await send(server, { method: 'POST', path: '/result?label=gross', body: 'x', headers: { 'Content-Length': String(64 * 1024 + 1) } }).catch((e) => ({ status: e.code }))
		assert.equal(declared.status, 413)
		const streamed = await send(server, { method: 'POST', path: '/result?label=gross', body: 'y'.repeat(64 * 1024 + 10), chunked: true, headers: { 'Transfer-Encoding': 'chunked' } })
		assert.equal(streamed.status, 413)
		assert.match(streamed.body, /Zu groß/)
		assert.equal(readdirSync(fx.results).length, n)
	})

	test('wrong Host (DNS rebinding) → 421; POST from another origin or "null" → 403; same origin passes', async () => {
		assert.equal((await send(server, { path: '/', headers: { Host: 'evil.example:18612' } })).status, 421)
		assert.equal((await send(server, { path: '/', headers: { Host: 'localhost:' + server.address().port } })).status, 421)
		for (const origin of ['http://evil.example', 'null', 'https://127.0.0.1:' + server.address().port]) {
			const r = await send(server, { method: 'POST', path: '/result?label=x', body: '{}', headers: { Origin: origin } })
			assert.equal(r.status, 403, origin)
		}
		const ok = await send(server, { method: 'POST', path: '/result?label=same', body: '{}', headers: { Origin: `http://127.0.0.1:${server.address().port}` } })
		assert.equal(ok.status, 200)
	})

	test('write error → 500, the server keeps running', async () => {
		rmSync(fx.results, { recursive: true, force: true })
		const r = await send(server, { method: 'POST', path: '/result?label=x', body: '{}' })
		assert.equal(r.status, 500)
		mkdirSync(fx.results)
		assert.equal((await send(server, { method: 'POST', path: '/result?label=x', body: '{}' })).status, 200)
	})
})

describe('setup and lifetime', () => {
	test('a results directory inside the site is refused', () => {
		const fx = makeSite()
		assert.throws(() => createSessionServer({ site: fx.site, results: join(fx.site, 'results') }), /inside the served site/)
		assert.throws(() => createSessionServer({ site: fx.site, results: fx.site }), /inside the served site/)
	})

	test('the server ends itself after its lifetime and says so', async () => {
		const fx = makeSite()
		let reason = null
		const server = await listen(createSessionServer({ site: fx.site, results: fx.results, lifetimeMs: 60, onEnd: (r) => { reason = r } }))
		await new Promise((resolve) => server.once('close', resolve))
		assert.match(reason, /^session ended after/)
		assert.equal(server.listening, false)
	})
})

describe('CLI process', () => {
	const SCRIPT = join(IPAD, 'session.mjs')
	const run = (args) => new Promise((resolve) => {
		const p = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
		let out = ''
		p.stdout.on('data', (c) => { out += c })
		p.stderr.on('data', (c) => { out += c })
		p.on('exit', (code) => resolve({ code, out }))
	})

	test('refuses 0.0.0.0, ::, a public address and port 1024 with exit 2 and the usage', async () => {
		for (const args of [['0.0.0.0', '18612'], ['::', '18612'], ['8.8.8.8', '18612'], ['127.0.0.1', '1024'], ['127.0.0.1']]) {
			const r = await run(args)
			assert.equal(r.code, 2, args.join(' '))
			assert.match(r.out, /usage: node session\.mjs <bind-address> <port>/)
		}
	})

	test('refuses a results directory inside the package', async () => {
		const fx = makeSite()
		const r = await run(['127.0.0.1', '29999', '--site', fx.site, '--results', join(fx.site, 'r')])
		assert.equal(r.code, 2)
		assert.match(r.out, /inside the served site/)
	})

	test('starts on 127.0.0.1, names start page, send page and results, serves, ends on SIGINT', async () => {
		const fx = makeSite()
		// a free port above 1024 (asked from the kernel, then released)
		const probe = await listen(createServer())
		const port = probe.address().port
		await close(probe)
		const p = spawn(process.execPath, [SCRIPT, '127.0.0.1', String(port), '--site', fx.site, '--results', fx.results, '--hours', '1'],
			{ stdio: ['ignore', 'pipe', 'pipe'] })
		let out = ''
		p.stdout.on('data', (c) => { out += c })
		p.stderr.on('data', (c) => { out += c })
		const exited = new Promise((resolve) => p.on('exit', (code, signal) => resolve({ code, signal })))
		for (let i = 0; i < 100 && !out.includes('Ende'); i++) await new Promise((resolve) => setTimeout(resolve, 20))
		assert.match(out, new RegExp(`Startseite   http://127\\.0\\.0\\.1:${port}/`))
		assert.match(out, new RegExp(`Senden       http://127\\.0\\.0\\.1:${port}/send`))
		assert.match(out, /Ergebnisse   .*ipad-ra-results/)
		assert.match(out, /automatisch nach 1 h/)
		const r = await send({ address: () => ({ port }) }, { path: '/send' })
		assert.equal(r.status, 200)
		p.kill('SIGINT')
		const e = await exited
		assert.equal(e.code, 0, out)
		assert.match(out, /beendet\./)
	})
})
