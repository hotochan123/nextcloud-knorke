/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The one fetch wrapper of the app (SPEC-M0 §6.4, §4.2). No axios: fetch with
 * credentials 'same-origin', an AbortController timeout and one error type.
 *
 * Error mapping (decisions are taken on the STATUS where Nextcloud or a proxy
 * answers, never on a guessed code):
 * - network error or timeout       → HttpError(0, 'network')
 * - JSON with a string `error`     → HttpError(status, error, message, …, fromApp = true)
 * - JSON without `error` (Nextcloud 401/412 `{message}`) or no JSON at all
 *   (Traefik 429, maintenance 503, a firewall's 403 page) → HttpError(status, 'http_' + status)
 * - Retry-After (seconds or HTTP date) → retryAfterMs
 * - the parsed app error body stays on the error as `body` (SPEC-M1 §4.2:
 *   409 `protocol` carries the server's `proto`, 429 `slow_down` its
 *   `retryMs`, 400 field errors `at`/`max`/`maxDays`)
 * - a 2xx end answer {end, message} of /sync and the guest join (SPEC-M1
 *   §1.2 (R23)) resolves here like any 2xx; the transports turn it into the
 *   HttpError of the old 401/403 answer (endStateOf)
 *
 * 429 `slow_down` (SPEC-M1 §4.2, R2) is NOT final: an app throttle of a
 * repeatable action (snapshot, guest join, sharing, search, moderation). The
 * caller waits max(retryMs, 2000) × (1 + 0–20 % random), doubling on every
 * repetition up to 60 s (slowDownDelay), and tries again. (R13) Exception:
 * `"reason": "password"` (the link password lock-out, isPasswordLock) is
 * never repeated automatically.
 *
 * Every string in a JSON body goes out as well-formed UTF-16 (T14): PHP
 * rejects an escaped lone surrogate, and with it the whole request.
 */
import { wellFormed } from '../util/unicode.js'

/** Error of a request; `status` 0 means the request never got an answer. */
export class HttpError extends Error {
	/**
	 * @param {number} status HTTP status, 0 for network errors and timeouts
	 * @param {string} code app error code or 'http_<status>' / 'network'
	 * @param {string} [message] human readable text (English, from the server or generic)
	 * @param {number|null} [retryAfterMs] Retry-After of the answer in ms
	 * @param {boolean} [fromApp] true when the body carried the app error form {error, message}
	 * @param {object|null} [body] parsed app error body (extra fields such as proto, retryMs), null otherwise
	 */
	constructor(status, code, message = '', retryAfterMs = null, fromApp = false, body = null) {
		super(message || code)
		this.name = 'HttpError'
		this.status = status
		this.code = code
		this.retryAfterMs = retryAfterMs
		this.fromApp = fromApp
		this.body = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null
	}
}

/** App error code of the non-final throttle (SPEC-M1 §4.2). */
export const SLOW_DOWN = 'slow_down'
/** slow_down: shortest wait and cap of the doubling (SPEC-M1 §4.2, §6.4). */
export const SLOW_DOWN_MIN_MS = 2000
export const SLOW_DOWN_MAX_MS = 60000

/**
 * @param {unknown} e error
 * @return {boolean} the app's own 429 `slow_down` (wait and repeat, never final)
 */
export function isSlowDown(e) {
	return e instanceof HttpError && e.status === 429 && e.fromApp && e.code === SLOW_DOWN
}

/** `reason` of the link password lock-out (SPEC-M1 §4.2, §4.11.4 step 4, R13). */
export const PASSWORD_LOCK = 'password'

/**
 * The link password lock-out (SPEC-M1 §4.2, R13): 429 `slow_down` with
 * `"reason": "password"`. It is never repeated automatically (§6.4): a join
 * from a dialog shows "Too many wrong passwords…", the automatic re-join of
 * an open guest tab ends in the final status `password_required`.
 *
 * @param {unknown} e error
 * @return {boolean}
 */
export function isPasswordLock(e) {
	return isSlowDown(e) && e.body?.reason === PASSWORD_LOCK
}

/**
 * Whole minutes of a lock-out for the dialog text (SPEC-M1 §6.4:
 * minutes = ceil(retryMs / 60000), at least 1). retryMs comes from the body,
 * else from Retry-After.
 *
 * @param {unknown} e the slow_down error
 * @return {number} minutes ≥ 1
 */
export function lockMinutes(e) {
	const fromBody = e instanceof HttpError && Number.isFinite(e.body?.retryMs) ? e.body.retryMs : null
	const fromHeader = e instanceof HttpError && Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : null
	const ms = Math.max(0, fromBody ?? fromHeader ?? 0)
	return Math.max(1, Math.ceil(ms / 60000))
}

/**
 * Wait before repeating an action the app throttled with `slow_down`:
 * max(retryMs, 2000) doubled for every earlier attempt of the same streak,
 * at most 60 s, times 1 + 0–20 % random (capped at 60 s as well).
 * retryMs comes from the body, else from Retry-After.
 *
 * @param {unknown} e the slow_down error
 * @param {number} attempt 1 for the first throttled answer of a streak, 2 for the next …
 * @param {() => number} [rand] random source in [0, 1)
 * @return {number} delay in ms
 */
export function slowDownDelay(e, attempt, rand = Math.random) {
	const fromBody = e instanceof HttpError && Number.isFinite(e.body?.retryMs) ? e.body.retryMs : null
	const fromHeader = e instanceof HttpError && Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : null
	const retryMs = Math.max(0, fromBody ?? fromHeader ?? 0)
	const n = Math.max(1, Math.floor(attempt) || 1)
	const base = Math.min(SLOW_DOWN_MAX_MS, Math.max(retryMs, SLOW_DOWN_MIN_MS) * 2 ** Math.min(n - 1, 16))
	return Math.min(SLOW_DOWN_MAX_MS, base * (1 + rand() * 0.2))
}

/**
 * Request header of a client that reads end states in a 200 body (SPEC-M1
 * §1.2 (R23), §34 D8). The transports send it on /sync (routes 13, 16) and on
 * the guest join (route 14); there the server answers the end of a session
 * with 200 {"end": code, "message": text} instead of the 401/403 that edge
 * ban rules (CrowdSec, fail2ban, a WAF) count. password_required/_wrong stay 403.
 */
export const END_STATE_HEADER = 'X-Knorke-End-State'

/** End states that were a 401 before; every other one (known or not) was a 403. */
const END_STATES_401 = ['guest_token', 'not_logged_in']

/**
 * A 2xx answer that reports an end state (SPEC-M1 §1.2 (R23)) becomes the
 * error of the old 401/403 answer, so everything behind the transport decides
 * as before: status 401 for guest_token and not_logged_in, else 403 (also for
 * an unknown code); fromApp true (a 403 without it would count as a firewall
 * block, isProxyBlock, and be repeated); the answer stays on it as body.
 *
 * @param {unknown} res parsed 2xx answer
 * @return {unknown} res itself when it is no end answer (no `end`, or not a non-empty string)
 * @throws {HttpError} for an end answer
 */
export function endStateOf(res) {
	if (res === null || typeof res !== 'object' || Array.isArray(res) || typeof res.end !== 'string' || res.end === '') {
		return res
	}
	const status = END_STATES_401.includes(res.end) ? 401 : 403
	throw new HttpError(status, res.end, typeof res.message === 'string' ? res.message : '', null, true, res)
}

/**
 * True for a 429/503 that did not come from the app (proxy token bucket,
 * maintenance): wait and repeat, it does not count as offline. The app's own
 * 429 `rate_limited` is final.
 *
 * @param {unknown} e error
 * @return {boolean}
 */
export function isProxyRetry(e) {
	return e instanceof HttpError && (e.status === 429 || e.status === 503) && !e.fromApp
}

/**
 * True for a 403 or 404 without the app error body (SPEC-M1 §6.4, R22,
 * P7-07): Knorke answers every 403/404 with `{error, message}`, so this one
 * came from a proxy or a web application firewall in front of Nextcloud (a
 * blocked note text, a route the proxy does not know). It is never final:
 * /sync takes the failure path (failures++, offline from the second one,
 * backoff 1/2/4/8/15 s), a snapshot or a join is repeated with the same
 * growing wait. Never the fixed 2–10 s of isProxyRetry: a request a firewall
 * keeps blocking would stay above the drain rate of fail2ban-like 403
 * scenarios and get the address banned (ED-18).
 *
 * @param {unknown} e error
 * @return {boolean}
 */
export function isProxyBlock(e) {
	return e instanceof HttpError && (e.status === 403 || e.status === 404) && !e.fromApp
}

/**
 * Retry-After header value → milliseconds.
 *
 * @param {string|null} value header value (delta seconds or HTTP date)
 * @param {number} [nowMs] current wall clock time
 * @return {number|null} delay in ms, null when absent or unparsable
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
	if (typeof value !== 'string' || value.trim() === '') {
		return null
	}
	const v = value.trim()
	if (/^\d+$/.test(v)) {
		return Math.min(Number(v), 3600) * 1000
	}
	const at = Date.parse(v)
	if (Number.isNaN(at)) {
		return null
	}
	return Math.max(0, Math.min(at - nowMs, 3600 * 1000))
}

/**
 * JSON.stringify replacer: lone surrogates in string values → U+FFFD.
 *
 * @param {string} key key (unused)
 * @param {unknown} value value
 * @return {unknown}
 */
function wellFormedValue(key, value) {
	return typeof value === 'string' ? wellFormed(value) : value
}

/**
 * @param {string} text response body
 * @return {unknown} parsed JSON or undefined when the body is not JSON
 */
function parseJson(text) {
	if (text === '') {
		return undefined
	}
	try {
		return JSON.parse(text)
	} catch (e) {
		return undefined
	}
}

/**
 * One HTTP request. Resolves with the parsed JSON body (null for an empty
 * body), rejects with HttpError.
 *
 * @param {string} method HTTP verb
 * @param {string} url absolute or root-relative URL
 * @param {object} [opts] options
 * @param {unknown} [opts.body] value sent as JSON (omitted when undefined)
 * @param {Record<string,string>} [opts.headers] extra headers
 * @param {number} [opts.timeoutMs] abort after this many ms
 * @param {boolean} [opts.keepalive] fetch keepalive (page unload, body ≤ 64 KiB)
 * @param {(bytes:number) => void} [opts.onBytes] receives the size of the answer body
 * @param {typeof fetch} [opts.fetchImpl] fetch implementation (tests)
 * @return {Promise<any>} parsed answer
 */
export async function request(method, url, { body, headers = {}, timeoutMs = 10000, keepalive = false, onBytes = null, fetchImpl = null } = {}) {
	const doFetch = fetchImpl ?? globalThis.fetch
	const h = { Accept: 'application/json, */*', ...headers }
	const init = { method, headers: h, credentials: 'same-origin', keepalive, cache: 'no-store' }
	if (body !== undefined) {
		init.body = typeof body === 'string' ? body : JSON.stringify(body, wellFormedValue)
		if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
			h['Content-Type'] = 'application/json'
		}
	}
	const ctl = typeof AbortController === 'function' ? new AbortController() : null
	if (ctl) {
		init.signal = ctl.signal
	}
	const timer = ctl && timeoutMs > 0 ? setTimeout(() => ctl.abort(), timeoutMs) : null
	let res
	let text
	try {
		res = await doFetch(url, init)
		text = await res.text()
	} catch (e) {
		const aborted = ctl?.signal?.aborted
		throw new HttpError(0, 'network', aborted ? 'Request timed out' : 'Network error')
	} finally {
		if (timer !== null) {
			clearTimeout(timer)
		}
	}
	if (onBytes) {
		try {
			onBytes(text.length)
		} catch (e) {
			// a meter must never break a request
		}
	}
	const data = parseJson(text)
	if (res.ok) {
		return data === undefined ? null : data
	}
	const retryAfterMs = parseRetryAfter(res.headers?.get?.('Retry-After') ?? null)
	if (data !== null && typeof data === 'object' && typeof data.error === 'string' && data.error !== '') {
		throw new HttpError(res.status, data.error, typeof data.message === 'string' ? data.message : '', retryAfterMs, true, data)
	}
	const message = data !== null && typeof data === 'object' && typeof data.message === 'string' ? data.message : (res.statusText || '')
	throw new HttpError(res.status, 'http_' + res.status, message, retryAfterMs, false)
}
