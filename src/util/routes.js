/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Client copy of the route table (SPEC-M0 §4.1, SPEC-M1 §4.1: 26 routes,
 * frozen from stage 0 on; route 27 of the M2 privacy notice appended) and the
 * only place that builds app URLs.
 * tests/js/shell/routes.test.mjs reads appinfo/routes.php as text and keeps
 * ROUTES identical to it (name, verb, URL, requirements).
 *
 * Paths here are relative to /apps/knorke; appUrl() turns them into real URLs
 * through @nextcloud/router (web root, index.php, mod_rewrite). Parameters
 * are checked against the same requirements as on the server, so a bad id or
 * token can never smuggle a path segment into a request.
 *
 * Routes 17–26 exist on the server from stage 0 on, but their actions answer
 * 501 `not_implemented` until their stage (sharing 2, moderation 3). Their
 * builders are here already; the calls come with the stages that use them.
 */
import { generateUrl } from '@nextcloud/router'

export const APP_ID = 'knorke'
export const APP_BASE = '/apps/' + APP_ID

/** Requirements of the placeholders, same regexes as routes.php ($id, $tok). */
export const REQUIREMENTS = Object.freeze({
	id: /^\d{1,18}$/,
	token: /^[A-Za-z0-9]{24}$/,
})

/**
 * Longest query value the server accepts (JsonBody::query, SPEC-M1 §4.1:
 * strings of at most 200 bytes, UTF-8).
 */
export const QUERY_MAX_BYTES = 200

/** name → {verb, url}; url placeholders {id}/{token} use REQUIREMENTS. */
export const ROUTES = Object.freeze({
	'page#index': Object.freeze({ verb: 'GET', url: '/' }),
	'page#board': Object.freeze({ verb: 'GET', url: '/b/{id}' }),
	'page#join': Object.freeze({ verb: 'GET', url: '/join/{token}' }),
	'publicPage#show': Object.freeze({ verb: 'GET', url: '/p/{token}' }),
	'boardApi#index': Object.freeze({ verb: 'GET', url: '/api/v1/boards' }),
	'boardApi#create': Object.freeze({ verb: 'POST', url: '/api/v1/boards' }),
	'boardApi#update': Object.freeze({ verb: 'PATCH', url: '/api/v1/boards/{id}' }),
	'boardApi#destroy': Object.freeze({ verb: 'DELETE', url: '/api/v1/boards/{id}' }),
	'boardApi#enableLink': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/link' }),
	'boardApi#disableLink': Object.freeze({ verb: 'DELETE', url: '/api/v1/boards/{id}/link' }),
	'boardApi#joinLink': Object.freeze({ verb: 'POST', url: '/api/v1/links/{token}/join' }),
	'sync#snapshot': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/snapshot' }),
	'sync#sync': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/sync' }),
	'publicSync#join': Object.freeze({ verb: 'POST', url: '/pub/v1/{token}/join' }),
	'publicSync#snapshot': Object.freeze({ verb: 'GET', url: '/pub/v1/boards/{id}/snapshot' }),
	'publicSync#sync': Object.freeze({ verb: 'POST', url: '/pub/v1/boards/{id}/sync' }),
	'boardApi#enableVoteLink': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/votelink' }),
	'boardApi#disableVoteLink': Object.freeze({ verb: 'DELETE', url: '/api/v1/boards/{id}/votelink' }),
	'shareApi#index': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/shares' }),
	'shareApi#update': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/shares' }),
	'shareApi#sharees': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/sharees' }),
	'moderationApi#startVote': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/vote' }),
	'moderationApi#updateVote': Object.freeze({ verb: 'PATCH', url: '/api/v1/boards/{id}/vote' }),
	'moderationApi#timer': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/timer' }),
	'moderationApi#summon': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/summon' }),
	'moderationApi#endSummon': Object.freeze({ verb: 'DELETE', url: '/api/v1/boards/{id}/summon' }),
	'settingsApi#update': Object.freeze({ verb: 'PUT', url: '/api/v1/settings/privacy' }),
})

/**
 * Path of a route below /apps/knorke with its placeholders filled in.
 *
 * @param {string} name route name, e.g. 'sync#sync'
 * @param {Record<string, string|number>} [params] placeholder values
 * @return {{method: string, path: string}} verb and path
 */
export function route(name, params = {}) {
	const r = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null
	if (r === null) {
		throw new Error('Unknown route ' + name)
	}
	const path = r.url.replace(/\{([a-z]+)\}/g, (m, key) => {
		const v = params[key]
		const s = typeof v === 'number' ? String(v) : v
		if (typeof s !== 'string' || !REQUIREMENTS[key] || !REQUIREMENTS[key].test(s)) {
			throw new Error('Invalid route parameter ' + key)
		}
		return s
	})
	return { method: r.verb, path }
}

/**
 * Appends a query string to a GET route (route 21 only, SPEC-M1 §4.1). Values
 * follow the server rule of JsonBody::query: strings of at most
 * QUERY_MAX_BYTES bytes; anything else throws, like a bad route parameter.
 * encodeURIComponent also escapes braces, so @nextcloud/router never mistakes
 * a value for a placeholder.
 *
 * @param {{method: string, path: string}} r route from route()
 * @param {Record<string, string>} query parameter names and values, in order
 * @return {{method: string, path: string}} verb and path with the query
 */
export function withQuery(r, query) {
	const parts = []
	for (const [key, value] of Object.entries(query)) {
		if (typeof value !== 'string' || new TextEncoder().encode(value).length > QUERY_MAX_BYTES) {
			throw new Error('Invalid query parameter ' + key)
		}
		parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value))
	}
	return parts.length === 0 ? r : { method: r.method, path: r.path + '?' + parts.join('&') }
}

/**
 * Full URL of an app path (web root, index.php unless mod_rewrite works).
 *
 * @param {string} path path below /apps/knorke, starting with '/'
 * @return {string} URL
 */
export function appUrl(path) {
	return generateUrl(APP_BASE + path)
}

/**
 * Full URL of a Nextcloud path outside the app (e.g. '/csrftoken').
 *
 * @param {string} path Nextcloud route path
 * @return {string} URL
 */
export function ncUrl(path) {
	return generateUrl(path)
}

/*
 * Builders, one per route. Each returns {method, path}; tests check every one
 * of them against appinfo/routes.php.
 */
export const api = Object.freeze({
	listBoards: () => route('boardApi#index'),
	createBoard: () => route('boardApi#create'),
	renameBoard: (id) => route('boardApi#update', { id }),
	deleteBoard: (id) => route('boardApi#destroy', { id }),
	enableLink: (id) => route('boardApi#enableLink', { id }),
	disableLink: (id) => route('boardApi#disableLink', { id }),
	joinLink: (token) => route('boardApi#joinLink', { token }),
	snapshot: (id) => route('sync#snapshot', { id }),
	sync: (id) => route('sync#sync', { id }),
	guestJoin: (token) => route('publicSync#join', { token }),
	guestSnapshot: (id) => route('publicSync#snapshot', { id }),
	guestSync: (id) => route('publicSync#sync', { id }),
	// Stage 2 (sharing): voting link, shares, sharee search (query `q`, never `shareType`).
	enableVoteLink: (id) => route('boardApi#enableVoteLink', { id }),
	disableVoteLink: (id) => route('boardApi#disableVoteLink', { id }),
	listShares: (id) => route('shareApi#index', { id }),
	saveShares: (id) => route('shareApi#update', { id }),
	searchSharees: (id, q) => withQuery(route('shareApi#sharees', { id }), { q }),
	// Stage 3 (moderation): vote session, timer, "bring everyone here".
	startVote: (id) => route('moderationApi#startVote', { id }),
	updateVote: (id) => route('moderationApi#updateVote', { id }),
	timer: (id) => route('moderationApi#timer', { id }),
	summon: (id) => route('moderationApi#summon', { id }),
	endSummon: (id) => route('moderationApi#endSummon', { id }),
	// M2 privacy notice: the admin setting (admins only).
	savePrivacy: () => route('settingsApi#update'),
})

export const pages = Object.freeze({
	list: () => route('page#index'),
	board: (id) => route('page#board', { id }),
	join: (token) => route('page#join', { token }),
	publicLink: (token) => route('publicPage#show', { token }),
})
