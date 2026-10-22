/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * HTTP client of the contract tests and the convergence run (SPEC-M0 §8.3).
 *
 * - node:http straight to the container IP with `Host: localhost`: fetch
 *   (undici) would overwrite the Host header, and the IP is no trusted domain.
 * - One cookie jar per client. Login like the poll spike: the cookies
 *   nc_sameSiteCookielax/strict and cookie_test, then ONE Basic-auth
 *   GET /index.php/csrftoken; Nextcloud answers with a real session (cookies)
 *   and the request token. After that only cookies + requesttoken (CSRF on).
 * - Every request with a body carries Content-Length (JsonBody answers 411
 *   without one); `chunked: true` deliberately leaves it out (case C28).
 * - Guests: X-Requested-With on every public POST, X-Knorke-Guest once joined.
 * - X-Knorke-End-State (end states with 200, SPEC-M1 §1.2 (R23), C87) goes out
 *   only when a case names it: sync() through opts.headers, joinGuest() through
 *   its headers option. Without it the server answers the 401/403 the other
 *   cases check.
 * - Protocol 2 (SPEC-M1 §4.3–§4.5): every /sync carries `ep`, the board
 *   epoch. A client keeps the epoch of its last snapshot or join answer
 *   (`epoch`); until it has one, the stack's epoch read through occ
 *   (`env.epoch`, set by the caller) stands in. A body that names `ep`
 *   itself wins – `ep: undefined` sends none (C49).
 * - A pooled keep-alive socket that the server closed for idleness is retried
 *   once on a fresh connection (request(), ENTWICKLUNG trap 9.30). `env.ncPort`
 *   (default 80) exists only for the self-test against a local server
 *   (dev/sim/http.test.mjs).
 */
import http from 'node:http'
import zlib from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { APP } from './env.mjs'

export const PROTOCOL = 2

/** One keep-alive agent per process, like Traefik's connection pool. */
export const agent = new http.Agent({ keepAlive: true, maxSockets: 64 })

export class Client {
	/**
	 * @param {object} env  env.json
	 * @param {string} name label for messages
	 * @param {object} [o]
	 * @param {'user'|'guest'|'anon'} [o.kind]
	 */
	constructor(env, name, { kind = 'anon' } = {}) {
		this.env = env
		this.name = name
		this.kind = kind
		this.cookies = new Map([['nc_sameSiteCookielax', 'true'], ['nc_sameSiteCookiestrict', 'true']])
		this.requestToken = ''
		this.guestToken = ''
		this.uid = null
		this.requests = 0
		/** Requests sent a second time after a reset pooled socket (see request()). */
		this.retries = 0
		/** Board epoch of the last snapshot/join answer (protocol 2), or null. */
		this.epoch = null
	}

	/** The `ep` this client sends: its own epoch, else the stack's (env.epoch), else none. */
	get ep() {
		return this.epoch ?? this.env.epoch ?? undefined
	}

	/** Keeps the epoch of a snapshot or join answer (protocol 2). */
	takeEpoch(r) {
		if (r && r.status === 200 && typeof r.data?.epoch === 'string') this.epoch = r.data.epoch
		return r
	}

	/**
	 * @returns {Promise<{status:number|string, headers:object, text:string, data:any, ms:number, bytes:number}>}
	 *   status is 'neterr'/'timeout' when no HTTP answer came (after at most one
	 *   retry when the server had closed the pooled keep-alive socket).
	 */
	request(method, path, {
		body, rawBody, headers = {}, chunked = false, gzip = false, guest = this.kind === 'guest',
		xrw = true, timeoutMs = 30000, auth = null,
	} = {}) {
		const h = { Host: this.env.host || 'localhost', Accept: 'application/json', 'User-Agent': 'knorke-sim', ...headers }
		if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
		if (this.requestToken && this.kind === 'user') h.requesttoken = this.requestToken
		if (xrw && h['X-Requested-With'] === undefined) h['X-Requested-With'] = 'XMLHttpRequest'
		if (guest && this.guestToken && h['X-Knorke-Guest'] === undefined) h['X-Knorke-Guest'] = this.guestToken
		if (gzip) h['Accept-Encoding'] = 'gzip'
		if (auth) h.Authorization = 'Basic ' + Buffer.from(auth).toString('base64')
		let payload = null
		if (rawBody !== undefined) payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8')
		else if (body !== undefined) payload = Buffer.from(JSON.stringify(body), 'utf8')
		if (payload !== null && h['Content-Type'] === undefined) h['Content-Type'] = 'application/json'
		if (chunked) {
			h['Transfer-Encoding'] = 'chunked'
		} else if (payload !== null) {
			h['Content-Length'] = String(payload.length)
		} else if (!['GET', 'HEAD'].includes(method)) {
			h['Content-Length'] = '0'
		}
		this.requests++
		/*
		 * retry: a pooled keep-alive socket that the server closed for idleness
		 * (Apache KeepAliveTimeout 5 s) while this request was being written fails
		 * with ECONNRESET ("socket hang up") on a REUSED socket before any answer;
		 * the server never read it. Sent once more on a fresh connection, like the
		 * Node docs advise (http.ClientRequest#reusedSocket). Only once, only then:
		 * a reset of a fresh socket, a timeout or an aborted answer stays
		 * 'neterr'/'timeout' (ENTWICKLUNG trap 9.30).
		 */
		const attempt = (retry) => new Promise((resolve) => {
			const t0 = performance.now()
			let answered = false
			const req = http.request({ host: this.env.ncIp, port: this.env.ncPort || 80, path, method, headers: h, agent, timeout: timeoutMs }, (res) => {
				answered = true
				const chunks = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => {
					let buf = Buffer.concat(chunks)
					const bytes = buf.length
					if (/gzip/i.test(res.headers['content-encoding'] || '')) {
						try { buf = zlib.gunzipSync(buf) } catch { /* leave as is, the caller sees garbage */ }
					}
					const text = buf.toString('utf8')
					this.takeCookies(res.headers['set-cookie'])
					let data = null
					try { data = JSON.parse(text) } catch { /* not JSON */ }
					resolve({ status: res.statusCode, headers: res.headers, text, data, ms: performance.now() - t0, bytes })
				})
				res.on('error', (e) => resolve({ status: 'neterr', headers: {}, text: String(e), data: null, ms: performance.now() - t0, bytes: 0 }))
			})
			req.on('timeout', () => req.destroy(new Error('timeout')))
			req.on('error', (e) => {
				if (retry && !answered && req.reusedSocket && e.code === 'ECONNRESET') {
					this.retries++
					resolve(attempt(false))
					return
				}
				resolve({ status: e.message === 'timeout' ? 'timeout' : 'neterr', headers: {}, text: String(e), data: null, ms: performance.now() - t0, bytes: 0 })
			})
			if (payload !== null && chunked) {
				// Two chunks, so the body really travels chunked.
				const mid = Math.floor(payload.length / 2)
				req.write(payload.subarray(0, mid))
				req.end(payload.subarray(mid))
			} else if (payload !== null) {
				req.end(payload)
			} else {
				req.end()
			}
		})
		return attempt(true)
	}

	takeCookies(list) {
		for (const c of [].concat(list || [])) {
			const nv = c.split(';')[0]
			const i = nv.indexOf('=')
			if (i <= 0) continue
			const k = nv.slice(0, i).trim()
			if (/max-age=0|expires=thu, 01-jan-1970/i.test(c) || nv.slice(i + 1) === 'deleted') this.cookies.delete(k)
			else this.cookies.set(k, nv.slice(i + 1))
		}
	}

	/** Browser-like session login (see header). */
	async login(user, pass = this.env.userPass) {
		this.kind = 'user'
		this.uid = user
		this.cookies.set('cookie_test', 'test')
		const r = await this.request('GET', '/index.php/csrftoken', { auth: `${user}:${pass}`, xrw: true })
		if (r.status !== 200 || !r.data?.token) throw new Error(`Login ${user}: ${r.status} ${String(r.text).slice(0, 200)}`)
		this.requestToken = r.data.token
		return this
	}

	/** Fresh CSRF token (what the client does after a 412). */
	async refreshToken() {
		const r = await this.request('GET', '/index.php/csrftoken')
		if (r.status === 200 && r.data?.token) this.requestToken = r.data.token
		return r
	}

	// ── API shortcuts (paths of SPEC-M0 §4.1) ─────────────────────────────

	listBoards() { return this.request('GET', `${APP}/api/v1/boards`) }
	createBoard(title) { return this.request('POST', `${APP}/api/v1/boards`, { body: { title } }) }
	renameBoard(id, title) { return this.request('PATCH', `${APP}/api/v1/boards/${id}`, { body: { title } }) }
	deleteBoard(id) { return this.request('DELETE', `${APP}/api/v1/boards/${id}`) }
	enableLink(id, rotate = false) { return this.request('POST', `${APP}/api/v1/boards/${id}/link`, { body: { rotate } }) }
	disableLink(id) { return this.request('DELETE', `${APP}/api/v1/boards/${id}/link`) }
	/**
	 * Account join of a link (route 11). password undefined sends no body (M0);
	 * otherwise the body {password} of SPEC-M1 §4.1 (string or null).
	 */
	joinLink(token, password = undefined) {
		return password === undefined
			? this.request('POST', `${APP}/api/v1/links/${token}/join`)
			: this.request('POST', `${APP}/api/v1/links/${token}/join`, { body: { password } })
	}

	// ── SPEC-M1 §4.1 stage 2: links per role, shares, sharee search ────────

	/** POST the link of a role (edit: route 9, vote: route 17) with exactly this body ({rotate?, password?, expiresAt?}). */
	postLink(id, body = {}, role = 'edit') {
		return this.request('POST', `${APP}/api/v1/boards/${id}/${role === 'vote' ? 'votelink' : 'link'}`, { body })
	}

	/** DELETE the link of a role (route 10 or 18). */
	deleteLink(id, role = 'edit') {
		return this.request('DELETE', `${APP}/api/v1/boards/${id}/${role === 'vote' ? 'votelink' : 'link'}`)
	}

	/** GET …/shares (route 19). */
	listShares(id) { return this.request('GET', `${APP}/api/v1/boards/${id}/shares`) }

	/** PUT …/shares (route 20) with the wanted complete list; `raw` sends a body as given (shape errors). */
	saveShares(id, shares, { raw = undefined } = {}) {
		return this.request('PUT', `${APP}/api/v1/boards/${id}/shares`, raw === undefined ? { body: { shares } } : { body: raw })
	}

	/** GET …/sharees?q= (route 21; the parameter is q, never shareType). */
	searchSharees(id, q) {
		return this.request('GET', `${APP}/api/v1/boards/${id}/sharees?q=${encodeURIComponent(q)}`)
	}

	// ── SPEC-M1 §4.1 stage 3: moderation (routes 22–26), bodies as sent ────

	/** POST …/vote (route 22) {per, perItem, scope, types, minutes}. */
	startVote(id, body) { return this.request('POST', `${APP}/api/v1/boards/${id}/vote`, { body }) }
	/** PATCH …/vote (route 23) {action, minutes?}. */
	updateVote(id, body) { return this.request('PATCH', `${APP}/api/v1/boards/${id}/vote`, { body }) }
	/** PUT …/timer (route 24) {action, ms?}. */
	timer(id, body) { return this.request('PUT', `${APP}/api/v1/boards/${id}/timer`, { body }) }
	/** POST …/summon (route 25) {client}; `body` as given (C74 sends none). */
	summon(id, body) { return body === undefined ? this.request('POST', `${APP}/api/v1/boards/${id}/summon`) : this.request('POST', `${APP}/api/v1/boards/${id}/summon`, { body }) }
	/** DELETE …/summon (route 26). */
	endSummon(id) { return this.request('DELETE', `${APP}/api/v1/boards/${id}/summon`) }

	async snapshot(id) {
		const r = this.kind === 'guest'
			? await this.request('GET', `${APP}/pub/v1/boards/${id}/snapshot`)
			: await this.request('GET', `${APP}/api/v1/boards/${id}/snapshot`)
		return this.takeEpoch(r)
	}

	/**
	 * POST …/sync; body fields as in SPEC-M1 §4.5: proto defaults to PROTOCOL,
	 * ep to this.ep (see header). A body with its own `ep` key wins.
	 */
	sync(id, body, opts = {}) {
		const url = this.kind === 'guest' ? `${APP}/pub/v1/boards/${id}/sync` : `${APP}/api/v1/boards/${id}/sync`
		return this.request('POST', url, { body: { proto: PROTOCOL, ep: this.ep, ...body }, ...opts })
	}

	/**
	 * Guest join (§4.9.2). On 200 the client keeps the guest token. password
	 * (SPEC-M1 §4.11.4, stage 2) goes into the body only when given; headers
	 * are extra request headers (C87: X-Knorke-End-State).
	 */
	async joinGuest(linkToken, name, { client = 'cJoin', guest = undefined, password = undefined, headers = {} } = {}) {
		this.kind = 'guest'
		const body = { client, name }
		const old = guest === undefined ? (this.guestToken || null) : guest
		body.guest = old
		if (password !== undefined) body.password = password
		const r = await this.request('POST', `${APP}/pub/v1/${linkToken}/join`, { body, guest: false, headers })
		if (r.status === 200 && r.data?.guest?.token) this.guestToken = r.data.guest.token
		return this.takeEpoch(r)
	}

	/** GET /p/{token} as a browser would (Accept html), with the initial state decoded. */
	async publicPage(token) {
		const r = await this.request('GET', `${APP}/p/${token}`, { headers: { Accept: 'text/html' }, xrw: false, guest: false })
		r.state = initialState(r.text)
		return r
	}
}

/**
 * Initial state of a Nextcloud page: <input type="hidden" id="initial-state-<app>-<key>" value="<base64 JSON>">.
 * @returns {Record<string, any>} key → decoded value (only keys of the app knorke)
 */
export function initialState(html) {
	const out = {}
	const re = /id="initial-state-knorke-([A-Za-z0-9_]+)"\s+value="([^"]*)"/g
	let m
	while ((m = re.exec(String(html || '')))) {
		try { out[m[1]] = JSON.parse(Buffer.from(m[2], 'base64').toString('utf8')) } catch { out[m[1]] = '<undecodable>' }
	}
	return out
}

/** Short description of a response for failure messages. */
export function brief(r) {
	if (!r) return 'keine Antwort'
	const t = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').slice(0, 300) : ''
	return `${r.status} ${t}`
}
