#!/usr/bin/env node
/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Session server for the tablet measurement R-A (SPEC-M1 §8.8, §16: Android
 * tablet with Chrome; the iPad comes with R-B). Runs on the Unraid host
 * "Tower" from the package of dev/scene-lab/run.sh ipad (out/ipad-ra/) for
 * the duration of one session:
 *
 *   GET  /               start page (session-start.html: links, order of the runs)
 *   GET  /send           send page (session-send.html: paste or pick the JSON, choose a label)
 *   GET  /<path>         the package itself, read only (lab/, bench/, the sheet …)
 *   POST /result?label=  stores the body as <results>/<UTC time>_<label>.json|.txt
 *
 * Bounds: binds one private IPv4 host address (10.0.0.0/8, 172.16.0.0/12,
 * 192.168.0.0/16; or 127.0.0.1 for tests), never 0.0.0.0/::, IPv6, a name or
 * a public address, port above 1024; no directory listing, no path outside
 * the package (symlinks resolved with realpath); requests for another Host
 * (DNS rebinding) get 421, a POST from another origin 403; bodies above
 * 4 MiB get 413; the results directory lies outside the package; the server
 * ends itself after --hours (default 4), so a forgotten session does not stay
 * open in the LAN. Node only, no dependencies.
 *
 *   node session.mjs <bind-address> <port> [--results <dir>] [--hours <n>] [--site <dir>]
 *   e.g. node out/ipad-ra/session.mjs <lan-address> 18612
 *   (R-B: port 18613, because 18612 is then the relay of the app, SPEC-M1 §8.1)
 *
 * Defaults: --site = the directory of this file (the package), --results =
 * ipad-ra-results/ next to it (out/ipad-ra-results/). Stop with Ctrl+C.
 * Unit tested in dev/scene-lab/test/session.test.mjs.
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const MAX_BODY = 4 * 1024 * 1024
export const LABEL_RE = /^[a-z0-9-]{1,40}$/
export const DEFAULT_HOURS = 4
/** Routes of the two session pages → file in the package. */
export const PAGES = Object.freeze({ '/': 'session-start.html', '/send': 'session-send.html' })

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.map': 'application/json',
	'.md': 'text/plain; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
}
/** On every response (same as serve.mjs plus no referrer). */
export const HEADERS = Object.freeze({
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
})

/**
 * Content-Security-Policy of a session page: its inline <style> and <script>
 * blocks by hash, fetch only to this server, no frames, no forms, no base.
 *
 * @param {string} html page
 * @return {string} header value
 */
export function pageCsp(html) {
	const hashes = (tag) => [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]
		.map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`)
	const list = (h) => (h.length ? h.join(' ') : "'none'")
	return [
		"default-src 'none'",
		`script-src ${list(hashes('script'))}`,
		`style-src ${list(hashes('style'))}`,
		'img-src data:',
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join('; ')
}

/**
 * The package is copied and has no configuration, so the rule is fixed: any
 * private IPv4 host address (four decimal parts 0–255 without leading zeros,
 * last part 1–254; the rule of KD_LAN_HOST in dev/lib.sh), or 127.0.0.1.
 *
 * @param {string} host bind address
 * @return {boolean} 127.0.0.1 or a host address of 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16
 */
export function allowedHost(host) {
	if (host === '127.0.0.1') return true
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(typeof host === 'string' ? host : '')
	if (!m || m.slice(1).some((p) => /^0\d/.test(p) || Number(p) > 255)) return false
	const [a, b, , d] = m.slice(1).map(Number)
	if (d < 1 || d > 254) return false
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * @param {string[]} args command line after the script
 * @return {{host: string, port: number, results: string|null, hours: number, site: string|null}|null} null when invalid
 */
export function parseArgs(args) {
	const pos = []
	const named = {}
	for (let i = 0; i < args.length; i++) {
		const m = /^--(results|hours|site)$/.exec(args[i])
		if (m) {
			if (args[i + 1] === undefined) return null
			named[m[1]] = args[++i]
		} else if (args[i].startsWith('--')) {
			return null
		} else {
			pos.push(args[i])
		}
	}
	const [host, portArg] = pos
	const port = Number(portArg)
	const hours = named.hours === undefined ? DEFAULT_HOURS : Number(named.hours)
	if (pos.length !== 2 || !allowedHost(host) || !/^\d+$/.test(portArg ?? '') || port <= 1024 || port > 65535) return null
	if (!(hours > 0 && hours <= 24)) return null
	return { host, port, results: named.results ?? null, hours, site: named.site ?? null }
}

/**
 * Absolute file of a request path inside the site, symlinks resolved; null
 * outside the site, for NUL bytes, broken escapes and missing files. A
 * directory stands for its index.html.
 *
 * @param {string} siteReal realpath of the site
 * @param {string} urlPath request path (with query)
 * @return {string|null} real path of a regular file below the site
 */
export function resolveInSite(siteReal, urlPath) {
	let p
	try {
		p = decodeURIComponent(new URL(urlPath, 'http://x').pathname)
	} catch {
		return null
	}
	if (p.includes('\0')) return null
	let file = resolve(siteReal, '.' + (p.startsWith('/') ? p : '/' + p))
	if (file !== siteReal && !file.startsWith(siteReal + sep)) return null
	try {
		if (statSync(file).isDirectory()) file = join(file, 'index.html')
		const real = realpathSync(file)
		if (!real.startsWith(siteReal + sep) || !statSync(real).isFile()) return null
		return real
	} catch {
		return null
	}
}

/**
 * The session server (not listening yet).
 *
 * @param {object} o options
 * @param {string} o.site package directory, served read only
 * @param {string} o.results directory for POST /result (created; must lie outside the site)
 * @param {number} [o.maxBody] body limit in bytes
 * @param {number} [o.lifetimeMs] ends the server after this long (0 = never)
 * @param {(line: string) => void} [o.log] request log
 * @param {(reason: string) => void} [o.onEnd] called once when the lifetime ran out
 * @return {import('node:http').Server}
 */
export function createSessionServer({ site, results, maxBody = MAX_BODY, lifetimeMs = 0, log = () => {}, onEnd = () => {} }) {
	const siteReal = realpathSync(site)
	mkdirSync(results, { recursive: true })
	const resultsReal = realpathSync(results)
	if (resultsReal === siteReal || resultsReal.startsWith(siteReal + sep)) {
		throw new Error(`results directory ${resultsReal} lies inside the served site ${siteReal}`)
	}
	const pages = {}
	for (const [route, name] of Object.entries(PAGES)) {
		const html = readFileSync(join(siteReal, name), 'utf8')
		pages[route] = { body: Buffer.from(html), csp: pageCsp(html) }
	}

	const server = createServer((req, res) => {
		const t0 = Date.now()
		const reply = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
			const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
			res.writeHead(status, { ...HEADERS, 'Content-Type': type, 'Content-Length': data.length, ...extra })
			res.end(req.method === 'HEAD' ? undefined : data)
			log(`${new Date().toISOString().slice(11, 19)} ${status} ${req.method} ${String(req.url).slice(0, 120)} ${Date.now() - t0} ms`)
		}
		// only the address this server listens on (no DNS rebinding through another name)
		const addr = server.address()
		if (req.headers.host !== `${addr.address}:${addr.port}`) return reply(421, 'misdirected request\n')
		let url
		try {
			url = new URL(req.url, 'http://x')
		} catch {
			return reply(400, 'bad request\n')
		}
		if (req.method === 'POST' && url.pathname === '/result') return receive(req, url, reply)
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			return reply(405, 'method not allowed\n', undefined, { Allow: url.pathname === '/result' ? 'POST' : 'GET, HEAD' })
		}
		const page = pages[url.pathname]
		if (page) return reply(200, page.body, TYPES['.html'], { 'Content-Security-Policy': page.csp })
		const file = resolveInSite(siteReal, req.url)
		if (!file) return reply(404, 'not found\n')
		try {
			return reply(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream')
		} catch {
			return reply(404, 'not found\n')
		}
	})

	/**
	 * POST /result: label check, size limit, then one new file (flag wx).
	 *
	 * @param {import('node:http').IncomingMessage} req request
	 * @param {URL} url parsed url
	 * @param {Function} reply reply(status, body, type?, headers?)
	 */
	function receive(req, url, reply) {
		const origin = req.headers.origin
		if (origin !== undefined && origin !== `http://${req.headers.host}`) return reply(403, 'Fremde Herkunft – nichts gespeichert\n')
		const label = url.searchParams.get('label') ?? ''
		if (!LABEL_RE.test(label)) return reply(400, 'Ungültige Bezeichnung (a–z, 0–9, -, höchstens 40 Zeichen)\n')
		const tooLarge = () => reply(413, `Zu groß (höchstens ${Math.round(maxBody / 1024 / 1024 * 10) / 10} MiB) – nichts gespeichert\n`, undefined, { Connection: 'close' })
		if (Number(req.headers['content-length'] ?? 0) > maxBody) {
			tooLarge()
			req.resume()
			return
		}
		const chunks = []
		let size = 0
		let over = false
		req.on('data', (c) => {
			if (over) return
			size += c.length
			if (size > maxBody) {
				over = true
				chunks.length = 0
				tooLarge()
				return
			}
			chunks.push(c)
		})
		req.on('error', () => {})
		req.on('end', () => {
			if (over) return
			const text = Buffer.concat(chunks).toString('utf8')
			if (!text.trim()) return reply(400, 'Leer – nichts gespeichert\n')
			let ext = 'txt'
			try {
				JSON.parse(text)
				ext = 'json'
			} catch {}
			const stamp = new Date().toISOString().replace(/[:.]/g, '-')
			for (let n = 1; n <= 20; n++) {
				const name = `${stamp}_${label}${n > 1 ? `_${n}` : ''}.${ext}`
				try {
					writeFileSync(join(resultsReal, name), text, { flag: 'wx' })
					log(`saved ${name} (${text.length} characters)`)
					return reply(200, `Gespeichert: ${name}\n`)
				} catch (e) {
					if (e?.code !== 'EEXIST') {
						log(`write failed: ${e?.code ?? e}`)
						return reply(500, 'Speichern fehlgeschlagen – bitte nochmal senden oder Bescheid geben\n')
					}
				}
			}
			return reply(500, 'Speichern fehlgeschlagen (zu viele gleichnamige Dateien)\n')
		})
	}

	if (lifetimeMs > 0) {
		const timer = setTimeout(() => {
			onEnd(`session ended after ${Math.round(lifetimeMs / 360000) / 10} h`)
			server.close()
			server.closeAllConnections()
		}, lifetimeMs)
		server.on('close', () => clearTimeout(timer))
	}
	return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	const a = parseArgs(process.argv.slice(2))
	if (!a) {
		console.error('usage: node session.mjs <bind-address> <port> [--results <dir>] [--hours <n>] [--site <dir>]')
		console.error('  bind-address: 127.0.0.1 or this host\'s private IPv4 LAN address (never 0.0.0.0), port 1025–65535, hours > 0 up to 24 (default 4)')
		console.error('  e.g. node session.mjs <lan-address> 18612')
		process.exit(2)
	}
	const site = resolve(a.site ?? HERE)
	const results = resolve(a.results ?? join(site, '..', 'ipad-ra-results'))
	let server
	try {
		server = createSessionServer({
			site, results, lifetimeMs: a.hours * 3600 * 1000, log: (line) => console.log(line),
			onEnd: (reason) => console.log(`Knorke R-A: ${reason} – Server beendet. Neu starten, falls die Sitzung weiterläuft.`),
		})
	} catch (e) {
		console.error(`session.mjs: ${e?.message ?? e}`)
		process.exit(2)
	}
	server.on('error', (e) => {
		console.error(`session.mjs: ${e?.code === 'EADDRINUSE' ? `port ${a.port} is in use` : e?.message ?? e}`)
		process.exit(1)
	})
	server.listen(a.port, a.host, () => {
		const base = `http://${a.host}:${a.port}/`
		console.log(`Knorke R-A: Sitzung läuft (${site})`)
		console.log(`  Startseite   ${base}`)
		console.log(`  Senden       ${base}send`)
		console.log(`  Ergebnisse   ${realpathSync(results)}`)
		console.log(`  Ende         automatisch nach ${a.hours} h, vorher mit Strg+C`)
	})
	let stopping = false
	const stop = () => {
		// a second Ctrl+C does not wait for anything
		if (stopping) process.exit(130)
		stopping = true
		console.log('Knorke R-A: beendet.')
		server.close()
		server.closeAllConnections()
	}
	process.on('SIGINT', stop)
	process.on('SIGTERM', stop)
}
