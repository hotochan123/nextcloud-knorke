/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Probe OPS-3 (SPEC-M1 §33.1 m, P7-05; the W2 runner and the code verifier
 * run it): the templates of the app are not executable from outside. Without
 * a login it GETs
 *
 *   <baseHost>/custom_apps/knorke/templates/guest.php
 *   <baseHost>/custom_apps/knorke/templates/main.php
 *   <baseHost>/custom_apps/knorke/templates/public.php
 *
 * of ONE namespace (Host: localhost, like up.sh's own probes) and expects
 * 404 each, with a body that holds neither "Fatal error" nor a server file
 * path (/var/www/, .php:<line>, on line <line>; ED-41: the requested URL in
 * Apache's 404 page is no leak). Nextcloud's .htaccess exempts exactly
 * cron.php, public.php, remote.php and status.php from its rewrite, so a
 * template named public.php ran on its own ("Class OCP\Util not found" with
 * the path, review finding OPS-3).
 *
 *   KD_NS=<ns> node dev/selftest/ops3-templates.mjs
 *
 * The namespace comes only from KD_NS (missing → exit 2); a protected one
 * (KD_PROTECT_NS, default try) is refused with exit 2 before loadEnv and any
 * docker call (SPEC-M1 §8.1 R20). Output: one line per path
 * "OPS-3 <path> <status> fatal=<yes|no> path=<yes|no>", then "OPS-3 ok" or
 * "OPS-3 FAIL: <n> checks red". Exit 0 = all as expected, 1 = a check red,
 * 2 = cannot run (no KD_NS, protected namespace, no env.json).
 */
import http from 'node:http'
import { loadEnv, protectedNs } from '../sim/lib/env.mjs'

/** The three paths of §33.1 m. */
export const OPS3_PATHS = Object.freeze([
	'/custom_apps/knorke/templates/guest.php',
	'/custom_apps/knorke/templates/main.php',
	'/custom_apps/knorke/templates/public.php',
])

/** A PHP fatal error in a body. */
export const hasFatal = (body) => /Fatal error/i.test(String(body ?? ''))

/**
 * A server file path in a body (ED-41): /var/www/, "<file>.php:<line>" or
 * "on line <line>" – not the requested URL itself.
 */
export const hasServerPath = (body) => /\/var\/www\/|\.php:\d+|\bon line \d+/i.test(String(body ?? ''))

/** The decisive line of one path. */
export const lineOf = (p, status, body) => `OPS-3 ${p} ${status} fatal=${hasFatal(body) ? 'yes' : 'no'} path=${hasServerPath(body) ? 'yes' : 'no'}`

/** Is one answer as §33.1 m wants it (404, no fatal error, no server path)? */
export const answerOk = (status, body) => status === 404 && !hasFatal(body) && !hasServerPath(body)

/** GET without login on 127.0.0.1:<port> with Host: localhost; resolves {status, body}. */
function get(port, p) {
	return new Promise((resolve) => {
		const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { Host: 'localhost', Accept: 'text/html', 'User-Agent': 'knorke-ops3' }, timeout: 30000 }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
			res.on('error', (e) => resolve({ status: 'neterr', body: String(e) }))
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve({ status: 'neterr', body: String(e) }))
		req.end()
	})
}

export async function main(env = process.env) {
	const ns = env.KD_NS
	if (!ns) {
		console.error('OPS-3: KD_NS fehlt (der Namensraum kommt nur aus KD_NS)')
		return 2
	}
	// SPEC-M1 §8.1 (R20): before loadEnv and before any docker call
	if (protectedNs(ns, env)) {
		console.error(`OPS-3: VERWEIGERT: Namensraum '${ns}' ist geschützt (KD_PROTECT_NS)`)
		return 2
	}
	let e
	try {
		e = loadEnv(ns, { anyDb: true })
	} catch (err) {
		console.error(`OPS-3: ${err.message}`)
		return 2
	}
	const port = Number(e.port)
	if (!Number.isInteger(port) || port < 1024) {
		console.error('OPS-3: env.json ohne port')
		return 2
	}
	const red = []
	for (const p of OPS3_PATHS) {
		const r = await get(port, p)
		const line = lineOf(p, r.status, r.body)
		console.log(line)
		if (!answerOk(r.status, r.body)) red.push(line)
	}
	if (red.length) {
		for (const l of red) console.log(`OPS-3 rot: ${l.slice('OPS-3 '.length)}`)
		console.log(`OPS-3 FAIL: ${red.length} checks red`)
		return 1
	}
	console.log('OPS-3 ok')
	return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().then((c) => process.exit(c), (err) => { console.error('OPS-3: ABBRUCH', err?.message || err); process.exit(2) })
}
