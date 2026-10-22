/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Board list, CRUD and link calls of signed-in users (SPEC-M0 §4.3).
 * Same headers and 412 rule as the user transport: one CSRF refresh, one
 * repeat; a second 412 counts as "logged out" (HttpError 401 http_401).
 * Every POST carries a JSON body (at least {}), so the server always sees a
 * Content-Length (JsonBody answers 411 otherwise).
 *
 * SPEC-M1 §4.1 (frozen from stage 0 on): one caller per REST route of the
 * shell. Routes 12/13 and 14–16 (snapshot, sync, guest join/snapshot/sync)
 * belong to the transports (src/sync/transport.js), routes 1–4 are page
 * navigations (router.js). Routes 17–26 answer 501 `not_implemented` until
 * their stage (sharing 2, moderation 3); their callers exist already, the
 * shell calls them only from those stages on. Bodies carry only the keys the
 * server allows for the route (JsonBody::read answers 400 for any other):
 *   enableLink/enableVoteLink  rotate, password, expiresAt ("YYYY-MM-DD"|null)
 *   saveShares                 shares
 *   startVote                  per, perItem, scope, types, minutes
 *   updateVote                 action, minutes
 *   timer                      action, ms
 *   summon                     client (required)
 * The moderation answers are {board: {title, meta, metaRev}, now}; the
 * session merges them through onMeta (SPEC-M1 §4.12, §6.5.1). Route 27 (M2
 * privacy notice, admin page only): savePrivacy sends default and languages.
 */
import { HttpError, request as httpRequest } from '../sync/http.js'
import { getRequestToken, setRequestToken } from '../util/csrf.js'
import { api, appUrl, ncUrl } from '../util/routes.js'

const TIMEOUT_MS = 15000

/** Injection points (tests replace them; the app never does). */
export const deps = {
	request: httpRequest,
	urlOf: appUrl,
	csrfUrl: () => ncUrl('/csrftoken'),
}

/**
 * @param {{method: string, path: string}} route route
 * @param {unknown} [body] JSON body
 * @param {object} [opts] injection points, default deps
 * @return {Promise<any>} parsed answer
 */
export async function call(route, body = undefined, { request = deps.request, urlOf = deps.urlOf, csrfUrl = deps.csrfUrl } = {}) {
	const send = () => request(route.method, urlOf(route.path), {
		body,
		headers: { requesttoken: getRequestToken() ?? '', 'X-Requested-With': 'XMLHttpRequest' },
		timeoutMs: TIMEOUT_MS,
	})
	try {
		return await send()
	} catch (e) {
		if (!(e instanceof HttpError) || e.status !== 412) {
			throw e
		}
	}
	let res
	try {
		res = await request('GET', csrfUrl(), { headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: TIMEOUT_MS })
	} catch (e) {
		throw new HttpError(401, 'http_401', 'Session expired')
	}
	if (!res || typeof res.token !== 'string' || res.token === '') {
		throw new HttpError(401, 'http_401', 'No CSRF token')
	}
	setRequestToken(res.token)
	try {
		return await send()
	} catch (e) {
		if (e instanceof HttpError && e.status === 412) {
			throw new HttpError(401, 'http_401', 'CSRF check failed twice')
		}
		throw e
	}
}

/** @return {Promise<object[]>} boards of the user (own and joined), newest first */
export async function listBoards() {
	const res = await call(api.listBoards())
	return Array.isArray(res?.boards) ? res.boards : []
}

/**
 * @param {string} title board title
 * @return {Promise<object>} the new board
 */
export async function createBoard(title) {
	const res = await call(api.createBoard(), { title })
	return res.board
}

/**
 * @param {number} id board id
 * @param {string} title new title
 * @return {Promise<object>} the board
 */
export async function renameBoard(id, title) {
	const res = await call(api.renameBoard(id), { title })
	return res.board
}

/**
 * @param {number} id board id
 * @return {Promise<boolean>}
 */
export async function deleteBoard(id) {
	const res = await call(api.deleteBoard(id))
	return res?.deleted === true
}

/**
 * Body of the link routes 9 and 17 (SPEC-M1 §4.11.2): a boolean is the M0
 * form (rotate or not); an object passes only rotate, password and
 * expiresAt ("YYYY-MM-DD" or null) – a key that is absent stays absent, so
 * the server leaves that part unchanged.
 *
 * @param {boolean|object|undefined} o rotate flag or {rotate?, password?, expiresAt?}
 * @return {object} JSON body (at least {})
 */
export function linkBody(o) {
	if (o === undefined || o === null || typeof o === 'boolean') {
		return { rotate: !!o }
	}
	return pick(o, LINK_BODY_KEYS)
}

/**
 * Turns the edit link on (or returns the active one); rotate = new token;
 * stage 2 also sets or removes password and expiry (SPEC-M1 §4.11.2).
 *
 * @param {number} id board id
 * @param {boolean|{rotate?: boolean, password?: (string|null), expiresAt?: (string|null)}} [o] rotate flag or body
 * @return {Promise<object>} the edit Link
 */
export async function enableLink(id, o = false) {
	const res = await call(api.enableLink(id), linkBody(o))
	return res.link
}

/**
 * @param {number} id board id
 * @return {Promise<null>}
 */
export async function disableLink(id) {
	await call(api.disableLink(id))
	return null
}

/**
 * @param {object|null|undefined} o source object
 * @param {string[]} allowed keys the route accepts
 * @return {object} only the allowed keys that are present (undefined dropped)
 */
export function pick(o, allowed) {
	const out = {}
	for (const k of allowed) {
		if (o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined) {
			out[k] = o[k]
		}
	}
	return out
}

/** Body keys of the link routes 9 and 17 (SPEC-M1 §4.1, §4.11.2). */
export const LINK_BODY_KEYS = Object.freeze(['rotate', 'password', 'expiresAt'])

/**
 * Turns the voting link on, renews it or changes password/expiry (stage 2).
 *
 * @param {number} id board id
 * @param {{rotate?: boolean, password?: (string|null), expiresAt?: (string|null)}} [o] body
 * @return {Promise<object|null>} the voting Link
 */
export async function enableVoteLink(id, o = {}) {
	const res = await call(api.enableVoteLink(id), linkBody(o))
	return res?.link ?? null
}

/**
 * @param {number} id board id
 * @return {Promise<null>}
 */
export async function disableVoteLink(id) {
	await call(api.disableVoteLink(id))
	return null
}

/**
 * Shares of a board (stage 2): owner → {shares, policy, links, linksAllowed,
 * linkPolicy}; moderator → {links} only.
 *
 * @param {number} id board id
 * @return {Promise<object>}
 */
export async function listShares(id) {
	return (await call(api.listShares(id))) ?? {}
}

/**
 * Replaces the complete share list (idempotent, stage 2).
 *
 * @param {number} id board id
 * @param {Array<{kind: string, id: string, role: string}>} shares wanted list
 * @return {Promise<object>} same form as listShares
 */
export async function saveShares(id, shares) {
	return (await call(api.saveShares(id), { shares: Array.isArray(shares) ? shares : [] })) ?? {}
}

/**
 * Sharee search (stage 2, query parameter `q`, never `shareType`).
 *
 * @param {number} id board id
 * @param {string} q search term (≤ 200 bytes)
 * @return {Promise<{sharees: object[], more: boolean}>}
 */
export async function searchSharees(id, q) {
	const res = await call(api.searchSharees(id, q))
	return { sharees: Array.isArray(res?.sharees) ? res.sharees : [], more: res?.more === true }
}

/**
 * Starts a dot vote (stage 3).
 *
 * @param {number} id board id
 * @param {{per?: number, perItem?: number, scope?: (string|null), types?: string[], minutes?: (number|null)}} cfg settings
 * @return {Promise<object>} {board: {title, meta, metaRev}, now}
 */
export async function startVote(id, cfg) {
	return (await call(api.startVote(id), pick(cfg, ['per', 'perItem', 'scope', 'types', 'minutes']))) ?? {}
}

/**
 * end, extend, show, hide, clear (stage 3).
 *
 * @param {number} id board id
 * @param {string} action action
 * @param {number|null} [minutes] for extend
 * @return {Promise<object>} {board, now}
 */
export async function updateVote(id, action, minutes = undefined) {
	return (await call(api.updateVote(id), pick({ action, minutes }, ['action', 'minutes']))) ?? {}
}

/**
 * Timer actions (stage 3).
 *
 * @param {number} id board id
 * @param {string} action start, pause, resume, add, stop
 * @param {number} [ms] duration or amount in ms
 * @return {Promise<object>} {board, now}
 */
export async function timer(id, action, ms = undefined) {
	return (await call(api.timer(id), pick({ action, ms }, ['action', 'ms']))) ?? {}
}

/**
 * "Bring everyone here" (stage 3) for this tab.
 *
 * @param {number} id board id
 * @param {string} client client id of the presenting tab
 * @return {Promise<object>} {board, now}
 */
export async function summon(id, client) {
	return (await call(api.summon(id), { client })) ?? {}
}

/**
 * @param {number} id board id
 * @return {Promise<object>} {board, now}
 */
export async function endSummon(id) {
	return (await call(api.endSummon(id))) ?? {}
}

/**
 * Link calls by role (SPEC-M1 §4.11.1): 'edit' = routes 9/10, 'vote' =
 * routes 17/18.
 *
 * @param {'edit'|'vote'} role link role
 * @return {{enable: (id: number, o?: object) => Promise<object|null>, disable: (id: number) => Promise<null>}}
 */
export function linkCalls(role) {
	return role === 'vote'
		? { enable: enableVoteLink, disable: disableVoteLink }
		: { enable: enableLink, disable: disableLink }
}

/**
 * Signed-in user opens a link: becomes a member (F1). SPEC-M1 §4.11.4: the
 * link password goes along only when the user typed one.
 *
 * @param {string} token link token
 * @param {string|null} [password] link password (LinkPasswordDialog)
 * @return {Promise<number>} board id
 */
export async function joinLink(token, password = null) {
	const res = await call(api.joinLink(token), typeof password === 'string' && password !== '' ? { password } : {})
	return res.boardId
}

/**
 * The admin setting of the privacy notice (route 27, M2; admins only). The
 * body replaces the whole setting: {default: {text, url}, languages: {<code>:
 * {text, url}}}. A 400 carries `at` ("default" or a language code) and, with
 * text_too_long / too_many_languages, `max` (HttpError.body).
 *
 * @param {{default: {text: string, url: string}, languages: Record<string, {text: string, url: string}>}} settings the form
 * @return {Promise<object>} the stored, normalised setting
 */
export async function savePrivacy(settings) {
	const res = await call(api.savePrivacy(), { default: settings?.default ?? {}, languages: settings?.languages ?? {} })
	return res?.privacy ?? null
}
