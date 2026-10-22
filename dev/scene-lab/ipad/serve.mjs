#!/usr/bin/env node
/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Static server for the iPad session R-A (SPEC-M1 §8.8 point 2): serves the
 * directory it lives in (the package from dev/scene-lab/run.sh ipad: lab/,
 * bench/, index.html) on the Mac in the LAN. GET/HEAD only, no directory
 * listing, no path outside the package, COOP/COEP like the lab runner and
 * Cache-Control: no-store (every reload measures a cold page). Node only, no
 * dependencies.
 *
 *   node serve.mjs <bind-address> [port]      e.g. node serve.mjs 192.168.1.20 8000
 *
 * The bind address is required on purpose: the server listens on the one
 * interface the iPad uses. Stop it with Ctrl+C after the session.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

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
}
const HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
}

/**
 * @param {string} root served directory (absolute)
 * @param {string} urlPath request path
 * @return {string|null} absolute file below root, or null
 */
export function resolvePath(root, urlPath) {
	let p
	try {
		p = decodeURIComponent(new URL(urlPath, 'http://x').pathname)
	} catch {
		return null
	}
	if (p.includes('\0')) return null
	if (p.endsWith('/')) p += 'index.html'
	const file = normalize(join(root, p))
	return file.startsWith(root + sep) ? file : null
}

/**
 * @param {string[]} args [bind-address, port?]
 * @return {{host: string, port: number}|null} null when invalid
 */
export function parseArgs(args) {
	const [host, portArg = '8000'] = args
	const port = Number(portArg)
	if (!host || !/^[0-9a-fA-F.:]+$/.test(host) || !Number.isInteger(port) || port < 1024 || port > 65535) return null
	return { host, port }
}

/**
 * @param {string} root served directory
 * @param {string} host bind address
 * @param {number} port port
 * @return {import('node:http').Server}
 */
export function serve(root, host, port) {
	const server = createServer(async (req, res) => {
		const t0 = Date.now()
		const done = (code) => console.log(`${new Date().toISOString().slice(11, 19)} ${code} ${req.method} ${req.url} ${Date.now() - t0} ms`)
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { Allow: 'GET, HEAD', ...HEADERS })
			res.end()
			done(405)
			return
		}
		const file = resolvePath(root, req.url ?? '/')
		try {
			if (!file || !(await stat(file)).isFile()) throw new Error('not a file')
			const body = await readFile(file)
			res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, ...HEADERS })
			res.end(req.method === 'HEAD' ? undefined : body)
			done(200)
		} catch {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...HEADERS })
			res.end('not found\n')
			done(404)
		}
	})
	server.listen(port, host, () => {
		const base = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}/`
		console.log(`Knorke R-A: serving ${root}`)
		console.log(`  Start page  ${base}`)
		console.log(`  Bench       ${base}bench/bench-standalone.html`)
		console.log(`  Scene lab   ${base}lab/?panel=1`)
		console.log('Ctrl+C stops the server.')
	})
	return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const a = parseArgs(process.argv.slice(2))
	if (!a) {
		console.error('usage: node serve.mjs <bind-address> [port 1024–65535]   e.g. node serve.mjs 192.168.1.20 8000')
		process.exit(2)
	}
	serve(ROOT, a.host, a.port)
}
