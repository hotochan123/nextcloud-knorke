/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Transports (SPEC-M0 §6.4): how one board session talks to the server.
 * Everything above (SyncClient, BoardSession) only sees
 *   {kind, snapshot(), sync(body)} and, for guests, join(name).
 * notify_push or a WebSocket sidecar would be a third transport later.
 *
 * Rules that live here (decided on the STATUS, §4.2):
 * - 412 (signed-in only): fetch a fresh CSRF token once (GET /csrftoken),
 *   repeat the same request once; a second 412 becomes HttpError(401,
 *   'http_401'). On /sync SyncClient counts it like every 401 (SPEC-M1 §1.2,
 *   R21): one is bridged, a second 401 in a row reports `logged_out`.
 * - proxy 429/503 is NOT retried here; SyncClient and BoardSession.open wait
 *   and repeat (isProxyRetry).
 * - guest join answering 404: forget the stored guest entry, rethrow.
 * - end states with 200 (SPEC-M1 §1.2 (R23), §34 D8): sync (user and guest,
 *   keepalive too) and the guest join send `X-Knorke-End-State: 1`. The
 *   server then answers guest_token, not_logged_in, link_revoked,
 *   link_expired and links_disabled with 200 {"end", "message"} instead of
 *   401/403, so an edge ban rule never sees them. Such an answer is thrown
 *   here as the HttpError of the old answer (endStateOf: 401 for guest_token
 *   and not_logged_in, else 403, fromApp): SyncClient, BoardSession and the
 *   guest page decide exactly as before. A join end answer is thrown before
 *   the token check: the stored guest entry and boardId stay. A server
 *   without this (or a proxy that drops the header) answers 401/403 as before.
 *
 * Time limits: sync 10 s, snapshot and join 30 s.
 */
import { END_STATE_HEADER, HttpError, endStateOf, request as httpRequest } from './http.js'
import { api, appUrl, ncUrl } from '../util/routes.js'
import { getRequestToken, setRequestToken } from '../util/csrf.js'

export const SYNC_TIMEOUT_MS = 10000
export const SNAPSHOT_TIMEOUT_MS = 30000

/**
 * Debug counters of a session (window.__knorke.counters(), §6.7).
 *
 * @return {{syncRequests:number, snapshotRequests:number, resyncs:number, bytesIn:number}}
 */
export function newCounters() {
	return { syncRequests: 0, snapshotRequests: 0, resyncs: 0, bytesIn: 0 }
}

/**
 * @param {object|null} counters counters or null
 * @param {boolean} count whether to count at all
 * @return {(bytes:number) => void|null} byte meter
 */
function meter(counters, count) {
	return counters && count ? (bytes) => { counters.bytesIn += bytes } : null
}

/**
 * Transport of a signed-in user.
 *
 * @param {number} boardId board id
 * @param {object} [opts] injection points (tests)
 * @param {Function} [opts.request] http request function
 * @param {Function} [opts.urlOf] app path → URL
 * @param {Function} [opts.csrfUrl] URL of GET /csrftoken
 * @param {Function} [opts.getToken] current CSRF token
 * @param {Function} [opts.setToken] store a new CSRF token
 * @param {object} [opts.counters] debug counters (newCounters())
 * @return {{kind:'user', snapshot: Function, sync: Function}}
 */
export function userTransport(boardId, {
	request = httpRequest,
	urlOf = appUrl,
	csrfUrl = () => ncUrl('/csrftoken'),
	getToken = getRequestToken,
	setToken = setRequestToken,
	counters = null,
} = {}) {
	const headers = (endState) => ({
		requesttoken: getToken() ?? '',
		'X-Requested-With': 'XMLHttpRequest',
		...(endState ? { [END_STATE_HEADER]: '1' } : {}),
	})

	async function refreshToken() {
		let res
		try {
			res = await request('GET', csrfUrl(), { headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: SYNC_TIMEOUT_MS })
		} catch (e) {
			if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
				throw new HttpError(401, 'http_401', 'Session expired')
			}
			throw e
		}
		const token = res && typeof res.token === 'string' ? res.token : ''
		if (token === '') {
			throw new HttpError(401, 'http_401', 'No CSRF token')
		}
		setToken(token)
	}

	async function call(route, body, timeoutMs, { keepalive = false, onBytes = null, endState = false } = {}) {
		const url = urlOf(route.path)
		const send = () => request(route.method, url, { body, headers: headers(endState), timeoutMs, keepalive, onBytes })
		try {
			return await send()
		} catch (e) {
			if (!(e instanceof HttpError) || e.status !== 412 || keepalive) {
				throw e
			}
		}
		// 412: the CSRF token is stale. One refresh, one repeat.
		await refreshToken()
		try {
			return await send()
		} catch (e) {
			if (e instanceof HttpError && e.status === 412) {
				throw new HttpError(401, 'http_401', 'CSRF check failed twice')
			}
			throw e
		}
	}

	return {
		kind: 'user',
		get boardId() {
			return boardId
		},
		/**
		 * @param {{count?: boolean}} [o] count=false for debug reads (serverItems)
		 * @return {Promise<object>} snapshot (§4.4)
		 */
		snapshot({ count = true } = {}) {
			if (counters && count) {
				counters.snapshotRequests++
			}
			return call(api.snapshot(boardId), undefined, SNAPSHOT_TIMEOUT_MS, { onBytes: meter(counters, count) })
		},
		/**
		 * @param {object} body sync request (§4.5)
		 * @param {{keepalive?: boolean}} [o] keepalive for page unload (no 412 retry)
		 * @return {Promise<object>} sync answer; an end answer rejects with its old HttpError
		 */
		sync(body, { keepalive = false } = {}) {
			if (counters) {
				counters.syncRequests++
			}
			return call(api.sync(boardId), body, SYNC_TIMEOUT_MS, { keepalive, onBytes: meter(counters, true), endState: true }).then(endStateOf)
		},
	}
}

/**
 * Transport of a guest (edit link).
 *
 * @param {object} o options
 * @param {number|null} o.boardId board id from the initial state (active link)
 * @param {string} o.linkToken link token from the URL
 * @param {() => string} [o.getClient] client id of this tab, read on EVERY join (SPEC-M1 §6.4,
 *   M0 §16.2: the tab may take a fresh id after its claim, U18; a re-join must carry that one)
 * @param {string} [o.client] fixed client id (used when getClient is missing)
 * @param {() => ({token:string, name:string, link:string}|null)} o.getGuest stored guest entry
 * @param {(g: {token:string, name:string, link:string}) => void} o.setGuest store guest entry
 * @param {() => void} o.clearGuest forget guest entry
 * @param {Function} [o.request] http request function (tests)
 * @param {Function} [o.urlOf] app path → URL (tests)
 * @param {object} [o.counters] debug counters
 * @return {{kind:'guest', join: Function, snapshot: Function, sync: Function}}
 */
export function guestTransport({
	boardId = null,
	linkToken,
	client = null,
	getClient = () => client,
	getGuest,
	setGuest,
	clearGuest,
	request = httpRequest,
	urlOf = appUrl,
	counters = null,
}) {
	let board = boardId

	function tokenHeaders() {
		const g = getGuest()
		const token = g && typeof g.token === 'string' ? g.token : ''
		if (token === '') {
			throw new HttpError(401, 'guest_token', 'No guest token', null, true)
		}
		return { 'X-Requested-With': 'XMLHttpRequest', 'X-Knorke-Guest': token }
	}

	return {
		kind: 'guest',
		get boardId() {
			return board
		},
		/**
		 * Join (or re-join) through the link. Sends the stored token as `guest`
		 * so the server keeps the guest identity (§4.9.2). SPEC-M1 §4.11.4: the
		 * link password goes along only when the guest typed one (a valid old
		 * token skips the check on the server); it is never stored.
		 *
		 * @param {string|null} [name] display name; null = stored name
		 * @param {string|null} [password] link password from the name dialog (stage 2)
		 * @return {Promise<object>} snapshot plus `guest: {token, exp}`; an end answer rejects
		 *   with its old HttpError and leaves the stored entry and boardId alone
		 */
		async join(name = null, password = null) {
			const stored = getGuest()
			const useName = typeof name === 'string' && name.trim() !== '' ? name : (stored?.name ?? '')
			if (useName.trim() === '') {
				throw new HttpError(400, 'name_required', 'Name required', null, true)
			}
			if (counters) {
				counters.snapshotRequests++
			}
			const body = { client: getClient(), name: useName, guest: stored?.token ?? null }
			if (typeof password === 'string' && password !== '') {
				body.password = password
			}
			let res
			try {
				res = await request(api.guestJoin(linkToken).method, urlOf(api.guestJoin(linkToken).path), {
					body,
					headers: { 'X-Requested-With': 'XMLHttpRequest', [END_STATE_HEADER]: '1' },
					timeoutMs: SNAPSHOT_TIMEOUT_MS,
					onBytes: meter(counters, true),
				})
			} catch (e) {
				if (e instanceof HttpError && e.status === 404) {
					clearGuest()
				}
				throw e
			}
			endStateOf(res)
			const token = res?.guest?.token
			if (typeof token !== 'string' || token === '') {
				throw new HttpError(500, 'internal', 'Join answer without guest token')
			}
			if (Number.isInteger(res?.board?.id)) {
				board = res.board.id
			}
			setGuest({ token, name: typeof res?.me?.name === 'string' ? res.me.name : useName, link: linkToken })
			return res
		},
		/**
		 * @param {{count?: boolean}} [o] count=false for debug reads
		 * @return {Promise<object>} snapshot
		 */
		snapshot({ count = true } = {}) {
			const r = api.guestSnapshot(board)
			const headers = tokenHeaders()
			if (counters && count) {
				counters.snapshotRequests++
			}
			return request(r.method, urlOf(r.path), { headers, timeoutMs: SNAPSHOT_TIMEOUT_MS, onBytes: meter(counters, count) })
		},
		/**
		 * @param {object} body sync request
		 * @param {{keepalive?: boolean}} [o] keepalive for page unload
		 * @return {Promise<object>} sync answer; an end answer rejects with its old HttpError
		 */
		sync(body, { keepalive = false } = {}) {
			const r = api.guestSync(board)
			const headers = { ...tokenHeaders(), [END_STATE_HEADER]: '1' }
			if (counters) {
				counters.syncRequests++
			}
			return request(r.method, urlOf(r.path), { body, headers, timeoutMs: SYNC_TIMEOUT_MS, keepalive, onBytes: meter(counters, true) }).then(endStateOf)
		},
	}
}
