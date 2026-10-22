/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Requests per page for SC's edge model (SPEC-M1 §8.7 "Seitenzahlen für SC",
 * Revision 19 T4-11): a port of knorke-spike/poll/load/pageload.mjs and
 * pageload.sh. In wave W3 it runs in the namespace load right before SC; its
 * last stdout line is the value of `load.mjs --page-requests`.
 *
 *   KD_NS=load node dev/load/lib/pageload.mjs
 *
 * Host part (this file without --in-container):
 *   - namespace: env.json of KD_NS (default load); try (or any namespace in
 *     KD_PROTECT_NS) is refused with exit 2 before loadEnv and any docker
 *     call (protectedNs of dev/sim/lib/env.mjs, shared with the restore
 *     probe and dev/ipad/moderate.mjs; SPEC-M1 §8.1 R20)
 *   - setup as alice over the API: a board "pageload" with its vote link
 *   - a throwaway Playwright container knorke-e2e-<ns>-pageload-<pid>
 *     (mcr.microsoft.com/playwright:v1.49.1-jammy, the prefix of the
 *     namespace, so dev/down.sh and assert_own cover it) on the namespace's
 *     FRONT network, dev/e2e read-only (its playwright package) and this file
 *     read-only; uid 47001, 2 CPUs, no host IPC namespace (Chromium runs
 *     with --disable-dev-shm-usage; R20 K3), removed with docker rm -fv in
 *     every case
 *   - it opens, each in a cold context, (1) the signed-in board page
 *     /b/<id> (alice: a session from one Basic-auth request, no page loaded
 *     before) and (2) the vote link page /p/<token> as a tablet (820 × 1180,
 *     hasTouch, isMobile; the name left empty, "guest-join"); each window
 *     lasts until the network is idle plus SETTLE_MS – no __knorke
 *     (knorke_dev = false in load)
 *   - counted on the SERVER side: Apache's access log of the namespace's
 *     Nextcloud (docker logs), lines from the Playwright container's address
 *     per window (metrics.mjs countAccessLog) – only what reaches the server
 *     counts at the edge
 *   - prints a JSON report and, last, "<board>,<vote>" (e.g. 85,34); the
 *     board goes again; per window the statuses and (R21, W3V-03) nonOk:
 *     every request other than 200 with status, method and path
 * Exit 0 measured, 1 a step failed, 2 refused (namespace, env.json).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const SETTLE_MS = 5000
export const IMAGE = 'mcr.microsoft.com/playwright:v1.49.1-jammy'
export const TABLET = Object.freeze({ width: 820, height: 1180 })
export const DESKTOP = Object.freeze({ width: 1440, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Container name of one measurement (prefix of the namespace, SPEC-M1 §8.7). */
export function containerName(ns, n = process.pid) {
	if (!/^[a-z]{1,8}$/.test(String(ns))) throw new Error(`Namensraum '${ns}' ist ungültig`)
	return `knorke-e2e-${ns}-pageload-${n}`
}

/** The report's windows: the browser's window with the server-side counts (countAccessLog), nonOk included (R21, W3V-03). */
export function reportWindows(windows, counted) {
	return (windows || []).map((w, i) => ({ ...w, serverRequests: counted[i].requests, statuses: counted[i].statuses, nonOk: counted[i].nonOk }))
}

/** "<board>,<vote>" for load.mjs --page-requests from the counted windows. */
export function pageRequestsValue(windows) {
	const by = Object.fromEntries((windows || []).map((w) => [w.name, w.requests]))
	if (!(by.board > 0) || !(by.vote > 0)) return null
	return `${by.board},${by.vote}`
}

// ── inside the Playwright container ──────────────────────────────────────

async function inContainer([base, user, pass, board, voteToken]) {
	const { chromium } = createRequire('/work/package.json')('playwright')
	const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
	const out = []
	const win = async (name, ctxOpts, prepare, url, after = null) => {
		const ctx = await browser.newContext({ locale: 'en-US', ...ctxOpts })
		await prepare(ctx)
		const page = await ctx.newPage()
		let seen = 0
		page.on('request', () => seen++)
		await sleep(1500) // a gap in the access log between windows
		const from = new Date().toISOString()
		await page.goto(base + url, { waitUntil: 'networkidle', timeout: 60000 })
		if (after) await after(page)
		await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
		await sleep(SETTLE_MS)
		out.push({ name, from, to: new Date().toISOString(), browserRequests: seen, title: await page.title() })
		await ctx.close()
	}
	const login = async (ctx) => {
		// a session without loading any page: the cache stays cold (spike pageload.mjs)
		const host = new URL(base).hostname
		await ctx.addCookies([{ name: 'cookie_test', value: 'test', domain: host, path: '/' }])
		const r = await ctx.request.get(base + '/index.php/csrftoken', { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } })
		if (r.status() !== 200) throw new Error(`login ${r.status()}`)
	}
	await win('board', { viewport: DESKTOP }, login, `/index.php/apps/knorke/b/${board}`)
	await win('vote', { viewport: TABLET, hasTouch: true, isMobile: true }, async () => {}, `/index.php/apps/knorke/p/${voteToken}`, async (page) => {
		const name = page.locator('[data-knorke-field=guest-name]').first()
		if (await name.isVisible({ timeout: 10000 }).catch(() => false)) {
			const input = (await name.evaluate((el) => el.tagName)) === 'INPUT' ? name : name.locator('input').first()
			await input.fill('')
			await page.locator('[data-knorke-action=guest-join]').first().click()
		}
	})
	await browser.close()
	console.log(JSON.stringify(out))
}

// ── host ─────────────────────────────────────────────────────────────────

async function host() {
	const { loadEnv, Stack, run, protectedNs } = await import('../../sim/lib/env.mjs')
	const { Client, brief } = await import('../../sim/lib/http.mjs')
	const { countAccessLog } = await import('./metrics.mjs')
	const ns = process.env.KD_NS || 'load'
	if (protectedNs(ns)) {
		console.error(`[pageload] VERWEIGERT: Namensraum '${ns}' ist geschützt (KD_PROTECT_NS)`)
		return 2
	}
	let env
	try {
		env = loadEnv(ns, { anyDb: true })
	} catch (e) {
		console.error(`[pageload] ${e.message}`)
		return 2
	}
	const stack = new Stack(env)
	const here = path.dirname(fileURLToPath(import.meta.url))
	const e2e = path.resolve(here, '..', '..', 'e2e')
	if (!fs.existsSync(path.join(e2e, 'node_modules', 'playwright'))) {
		console.error('[pageload] dev/e2e/node_modules/playwright fehlt (einmalig installieren, docs/ENTWICKLUNG.md 5.2)')
		return 1
	}
	const front = env.networks?.front ?? env.network
	const name = containerName(ns)
	const alice = await new Client(env, 'alice').login('alice')
	const cr = await alice.createBoard('pageload')
	if (cr.status !== 201) { console.error(`[pageload] Board: ${brief(cr)}`); return 1 }
	const board = cr.data.board.id
	let code = 1
	try {
		const vl = await alice.postLink(board, {}, 'vote')
		if (vl.status !== 200) throw new Error(`Abstimm-Link: ${brief(vl)}`)
		const since = new Date(Date.now() - 2000).toISOString()
		const started = await run('docker', ['run', '-d', '--name', name, '--network', front, '--label', `knorke=dev-${ns}`, '--cpus', '2',
			'--user', '47001:47001', '-e', 'HOME=/tmp', '-v', `${e2e}:/work:ro`, '-v', `${fileURLToPath(import.meta.url)}:/pl/pageload.mjs:ro`, IMAGE, 'sleep', '900'], { timeoutMs: 120000 })
		if (!started.ok) throw new Error(`Playwright-Container: ${started.err.trim()}`)
		const ip = (await run('docker', ['container', 'inspect', '-f', `{{(index .NetworkSettings.Networks "${front}").IPAddress}}`, name])).out.trim()
		if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`keine Adresse für ${name}`)
		const base = `http://${env.containers.nc}`
		const m = await run('docker', ['exec', name, 'node', '/pl/pageload.mjs', '--in-container', base, 'alice', env.userPass, String(board), vl.data.link.token], { timeoutMs: 300000 })
		if (!m.ok) throw new Error(`Messung: ${(m.err || m.out).trim().slice(0, 400)}`)
		const windows = JSON.parse(m.out.trim().split('\n').pop())
		const logs = await run('docker', ['logs', '--since', since, env.containers.nc], { timeoutMs: 60000 })
		const counted = countAccessLog(logs.out + '\n' + logs.err, ip, windows)
		const value = pageRequestsValue(counted)
		console.log(JSON.stringify({ ns, image: IMAGE, client: ip, nextcloud: env.versions?.nextcloud ?? null, windows: reportWindows(windows, counted) }, null, 1))
		if (!value) throw new Error('keine Anfragen gezählt (Zugriffsprotokoll leer?)')
		console.log(value)
		code = 0
	} catch (e) {
		console.error(`[pageload] ${e.message}`)
	} finally {
		await run('docker', ['rm', '-fv', name])
		await alice.deleteBoard(board).catch(() => {})
		void stack
	}
	return code
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const i = process.argv.indexOf('--in-container')
	const p = i >= 0 ? inContainer(process.argv.slice(i + 1)).then(() => 0) : host()
	p.then((c) => process.exit(c), (e) => { console.error('[pageload] ABBRUCH', e); process.exit(1) })
}
