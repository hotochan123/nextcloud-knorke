/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Client copy of the route table (SPEC-M0 §4.1, SPEC-M1 §4.1: 26 routes,
 * frozen from stage 0 on; route 27 of the M2 privacy notice appended, then
 * routes 28–34 of the template suggestions, factory job 182, then routes
 * 35–43 of the comments, factory job 189, then routes 44–45 of the tags,
 * factory job 191, then routes 46–54 of the own shape libraries, factory job
 * 203, then routes 55–56 of the board list favorites, factory job 219, then
 * route 57 of the board list sketches, factory job 221, then routes 58–62 of
 * the AI, factory job 267) and the only place
 * that builds app URLs.
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
	'templateApi#index': Object.freeze({ verb: 'GET', url: '/api/v1/templates' }),
	'templateApi#create': Object.freeze({ verb: 'POST', url: '/api/v1/templates' }),
	'templateApi#show': Object.freeze({ verb: 'GET', url: '/api/v1/templates/{id}' }),
	'templateApi#update': Object.freeze({ verb: 'PATCH', url: '/api/v1/templates/{id}' }),
	'templateApi#destroy': Object.freeze({ verb: 'DELETE', url: '/api/v1/templates/{id}' }),
	'templateApi#adopt': Object.freeze({ verb: 'POST', url: '/api/v1/templates/{id}/adopt' }),
	'templateApi#review': Object.freeze({ verb: 'GET', url: '/api/v1/templates/review' }),
	'commentApi#index': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/comments' }),
	'commentApi#create': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/comments' }),
	'commentApi#update': Object.freeze({ verb: 'PATCH', url: '/api/v1/boards/{id}/comments' }),
	'commentApi#destroy': Object.freeze({ verb: 'DELETE', url: '/api/v1/boards/{id}/comments' }),
	'commentApi#mentions': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/mentions' }),
	'publicComment#index': Object.freeze({ verb: 'GET', url: '/pub/v1/boards/{id}/comments' }),
	'publicComment#create': Object.freeze({ verb: 'POST', url: '/pub/v1/boards/{id}/comments' }),
	'publicComment#update': Object.freeze({ verb: 'PATCH', url: '/pub/v1/boards/{id}/comments' }),
	'publicComment#destroy': Object.freeze({ verb: 'DELETE', url: '/pub/v1/boards/{id}/comments' }),
	'tagApi#update': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/tags' }),
	'publicTag#update': Object.freeze({ verb: 'PUT', url: '/pub/v1/boards/{id}/tags' }),
	'shapeLibApi#index': Object.freeze({ verb: 'GET', url: '/api/v1/shapelibs' }),
	'shapeLibApi#create': Object.freeze({ verb: 'POST', url: '/api/v1/shapelibs' }),
	'shapeLibApi#show': Object.freeze({ verb: 'GET', url: '/api/v1/shapelibs/{id}' }),
	'shapeLibApi#update': Object.freeze({ verb: 'PATCH', url: '/api/v1/shapelibs/{id}' }),
	'shapeLibApi#destroy': Object.freeze({ verb: 'DELETE', url: '/api/v1/shapelibs/{id}' }),
	'shapeLibApi#suggest': Object.freeze({ verb: 'POST', url: '/api/v1/shapelibs/{id}/suggest' }),
	'shapeLibApi#adopt': Object.freeze({ verb: 'POST', url: '/api/v1/shapelibs/{id}/adopt' }),
	'shapeLibApi#review': Object.freeze({ verb: 'GET', url: '/api/v1/shapelibs/review' }),
	'shapeLibApi#withdraw': Object.freeze({ verb: 'DELETE', url: '/api/v1/shapelibs/{id}/suggest' }),
	'boardApi#favorite': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/favorite' }),
	'boardApi#opened': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/opened' }),
	'boardApi#sketch': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/sketch' }),
	'settingsApi#ai': Object.freeze({ verb: 'PUT', url: '/api/v1/settings/ai' }),
	'aiApi#index': Object.freeze({ verb: 'GET', url: '/api/v1/boards/{id}/ai' }),
	'aiApi#start': Object.freeze({ verb: 'POST', url: '/api/v1/boards/{id}/ai' }),
	'aiApi#cancel': Object.freeze({ verb: 'DELETE', url: '/api/v1/boards/{id}/ai' }),
	'aiApi#allow': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/aiswitch' }),
	'moderationApi#moveSummon': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/summon' }),
	'moderationApi#slides': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/slides' }),
	'moderationApi#privateWriting': Object.freeze({ verb: 'PUT', url: '/api/v1/boards/{id}/private' }),
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
 * Appends a query string to a route (route 21, SPEC-M1 §4.1; factory job
 * 189: routes 38, 39 and 43). Values
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

/**
 * (Job 175) The Nextcloud login that leads back to the board's link: after
 * the sign-in Nextcloud opens /p/<token>, and PublicPageController::show
 * sends the account on to page#join. redirect_url is a relative app path
 * (Nextcloud refuses targets with "@", so it is no open redirect).
 *
 * @param {string} token link token of the guest session
 * @return {string} URL of the login page
 */
export function signInUrl(token) {
	return ncUrl('/login') + '?redirect_url=' + encodeURIComponent(appUrl('/p/' + encodeURIComponent(String(token ?? ''))))
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
	// Factory job 182: template suggestions (accounts only; update, adopt and review for admins).
	listTemplates: () => route('templateApi#index'),
	createTemplate: () => route('templateApi#create'),
	showTemplate: (id) => route('templateApi#show', { id }),
	updateTemplate: (id) => route('templateApi#update', { id }),
	deleteTemplate: (id) => route('templateApi#destroy', { id }),
	adoptTemplate: (id) => route('templateApi#adopt', { id }),
	reviewTemplates: () => route('templateApi#review'),
	// Factory job 189: comments; accounts (35–39, the @ list only for accounts) and guests (40–43).
	listComments: (id) => route('commentApi#index', { id }),
	createComment: (id) => route('commentApi#create', { id }),
	updateComment: (id) => route('commentApi#update', { id }),
	deleteComment: (id, comment) => withQuery(route('commentApi#destroy', { id }), { comment: commentId(comment) }),
	searchMentions: (id, q) => withQuery(route('commentApi#mentions', { id }), { q }),
	guestComments: (id) => route('publicComment#index', { id }),
	guestCreateComment: (id) => route('publicComment#create', { id }),
	guestUpdateComment: (id) => route('publicComment#update', { id }),
	guestDeleteComment: (id, comment) => withQuery(route('publicComment#destroy', { id }), { comment: commentId(comment) }),
	// Factory job 191: the board's tag list; accounts (44) and guests of the edit link (45).
	saveTags: (id) => route('tagApi#update', { id }),
	guestSaveTags: (id) => route('publicTag#update', { id }),
	// Factory job 203: own shape libraries (accounts only; adopt and review for admins).
	listShapeLibs: () => route('shapeLibApi#index'),
	createShapeLib: () => route('shapeLibApi#create'),
	showShapeLib: (id) => route('shapeLibApi#show', { id }),
	updateShapeLib: (id) => route('shapeLibApi#update', { id }),
	deleteShapeLib: (id) => route('shapeLibApi#destroy', { id }),
	suggestShapeLib: (id) => route('shapeLibApi#suggest', { id }),
	adoptShapeLib: (id) => route('shapeLibApi#adopt', { id }),
	reviewShapeLibs: () => route('shapeLibApi#review'),
	withdrawShapeLib: (id) => route('shapeLibApi#withdraw', { id }),
	// Factory job 219: the account's own marks of the board list, star and last opened.
	setFavorite: (id) => route('boardApi#favorite', { id }),
	markOpened: (id) => route('boardApi#opened', { id }),
	// Factory job 221: the sketch of a board for its row in the board list.
	boardSketch: (id) => route('boardApi#sketch', { id }),
	// Factory job 267: the AI settings (admins) and the AI tasks of a board.
	saveAiSettings: () => route('settingsApi#ai'),
	aiState: (id) => route('aiApi#index', { id }),
	startAi: (id) => route('aiApi#start', { id }),
	forgetAi: (id, task) => withQuery(route('aiApi#cancel', { id }), { task: commentId(task) }),
	allowAi: (id) => route('aiApi#allow', { id }),
	// Factory job 272: presenting frames (the shown frame, the saved slide order).
	moveSummon: (id) => route('moderationApi#moveSummon', { id }),
	saveSlides: (id) => route('moderationApi#slides', { id }),
	privateWriting: (id) => route('moderationApi#privateWriting', { id }),
})

/**
 * (Job 189) A comment id for a query: a decimal string without a leading
 * zero (the server's CommentService::ID_RE); anything else throws like a
 * bad route parameter.
 *
 * @param {string|number} v comment id
 * @return {string}
 */
function commentId(v) {
	const s = typeof v === 'number' ? String(v) : v
	if (typeof s !== 'string' || !/^[1-9][0-9]{0,18}$/.test(s)) {
		throw new Error('Invalid comment id')
	}
	return s
}

export const pages = Object.freeze({
	list: () => route('page#index'),
	board: (id) => route('page#board', { id }),
	join: (token) => route('page#join', { token }),
	publicLink: (token) => route('publicPage#show', { token }),
})
