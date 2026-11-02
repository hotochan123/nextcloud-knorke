/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUERY_MAX_BYTES, REQUIREMENTS, ROUTES, api, pages, route, signInUrl, withQuery } from '../../../src/util/routes.js'
import { parse } from '../../../src/router.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PHP = readFileSync(join(ROOT, 'appinfo', 'routes.php'), 'utf8')

const LINE_RE = /^\s*\['name' => '([^']+)', 'url' => '([^']+)', 'verb' => '([A-Z]+)'(?:, 'requirements' => \$(id|tok))?\],\s*$/

/**
 * The route table of SPEC-M1 §4.1 (routes 1–16 as in SPEC-M0 §4.1, 17–26
 * new), frozen from stage 0 on, plus route 27 of the M2 privacy notice
 * (appended after them), routes 28–34 of the template suggestions
 * (factory job 182, appended after route 27) and routes 35–43 of the
 * comments (factory job 189, appended after route 34) and routes 44–45 of
 * the tags (factory job 191, appended after route 43) and routes 46–54 of
 * the own shape libraries (factory job 203, appended after route 45) and
 * routes 55–56 of the board list favorites (factory job 219, appended after
 * route 54) and route 57 of the board list sketches (factory job 221,
 * appended after route 56): name,
 * verb, URL.
 * Written out here so that
 * routes.php and routes.js cannot drift away from the spec together.
 */
const SPEC_ROUTES = [
	['page#index', 'GET', '/'],
	['page#board', 'GET', '/b/{id}'],
	['page#join', 'GET', '/join/{token}'],
	['publicPage#show', 'GET', '/p/{token}'],
	['boardApi#index', 'GET', '/api/v1/boards'],
	['boardApi#create', 'POST', '/api/v1/boards'],
	['boardApi#update', 'PATCH', '/api/v1/boards/{id}'],
	['boardApi#destroy', 'DELETE', '/api/v1/boards/{id}'],
	['boardApi#enableLink', 'POST', '/api/v1/boards/{id}/link'],
	['boardApi#disableLink', 'DELETE', '/api/v1/boards/{id}/link'],
	['boardApi#joinLink', 'POST', '/api/v1/links/{token}/join'],
	['sync#snapshot', 'GET', '/api/v1/boards/{id}/snapshot'],
	['sync#sync', 'POST', '/api/v1/boards/{id}/sync'],
	['publicSync#join', 'POST', '/pub/v1/{token}/join'],
	['publicSync#snapshot', 'GET', '/pub/v1/boards/{id}/snapshot'],
	['publicSync#sync', 'POST', '/pub/v1/boards/{id}/sync'],
	['boardApi#enableVoteLink', 'POST', '/api/v1/boards/{id}/votelink'],
	['boardApi#disableVoteLink', 'DELETE', '/api/v1/boards/{id}/votelink'],
	['shareApi#index', 'GET', '/api/v1/boards/{id}/shares'],
	['shareApi#update', 'PUT', '/api/v1/boards/{id}/shares'],
	['shareApi#sharees', 'GET', '/api/v1/boards/{id}/sharees'],
	['moderationApi#startVote', 'POST', '/api/v1/boards/{id}/vote'],
	['moderationApi#updateVote', 'PATCH', '/api/v1/boards/{id}/vote'],
	['moderationApi#timer', 'PUT', '/api/v1/boards/{id}/timer'],
	['moderationApi#summon', 'POST', '/api/v1/boards/{id}/summon'],
	['moderationApi#endSummon', 'DELETE', '/api/v1/boards/{id}/summon'],
	// M2 privacy notice: the admin setting, appended as route 27
	['settingsApi#update', 'PUT', '/api/v1/settings/privacy'],
	// factory job 182: template suggestions, appended as routes 28–34
	['templateApi#index', 'GET', '/api/v1/templates'],
	['templateApi#create', 'POST', '/api/v1/templates'],
	['templateApi#show', 'GET', '/api/v1/templates/{id}'],
	['templateApi#update', 'PATCH', '/api/v1/templates/{id}'],
	['templateApi#destroy', 'DELETE', '/api/v1/templates/{id}'],
	['templateApi#adopt', 'POST', '/api/v1/templates/{id}/adopt'],
	['templateApi#review', 'GET', '/api/v1/templates/review'],
	// factory job 189: comments, appended as routes 35–43
	['commentApi#index', 'GET', '/api/v1/boards/{id}/comments'],
	['commentApi#create', 'POST', '/api/v1/boards/{id}/comments'],
	['commentApi#update', 'PATCH', '/api/v1/boards/{id}/comments'],
	['commentApi#destroy', 'DELETE', '/api/v1/boards/{id}/comments'],
	['commentApi#mentions', 'GET', '/api/v1/boards/{id}/mentions'],
	['publicComment#index', 'GET', '/pub/v1/boards/{id}/comments'],
	['publicComment#create', 'POST', '/pub/v1/boards/{id}/comments'],
	['publicComment#update', 'PATCH', '/pub/v1/boards/{id}/comments'],
	['publicComment#destroy', 'DELETE', '/pub/v1/boards/{id}/comments'],
	// factory job 191: tags, appended as routes 44–45
	['tagApi#update', 'PUT', '/api/v1/boards/{id}/tags'],
	['publicTag#update', 'PUT', '/pub/v1/boards/{id}/tags'],
	// factory job 203: own shape libraries, appended as routes 46–54
	['shapeLibApi#index', 'GET', '/api/v1/shapelibs'],
	['shapeLibApi#create', 'POST', '/api/v1/shapelibs'],
	['shapeLibApi#show', 'GET', '/api/v1/shapelibs/{id}'],
	['shapeLibApi#update', 'PATCH', '/api/v1/shapelibs/{id}'],
	['shapeLibApi#destroy', 'DELETE', '/api/v1/shapelibs/{id}'],
	['shapeLibApi#suggest', 'POST', '/api/v1/shapelibs/{id}/suggest'],
	['shapeLibApi#adopt', 'POST', '/api/v1/shapelibs/{id}/adopt'],
	['shapeLibApi#review', 'GET', '/api/v1/shapelibs/review'],
	['shapeLibApi#withdraw', 'DELETE', '/api/v1/shapelibs/{id}/suggest'],
	// factory job 219: board list favorites, appended as routes 55–56
	['boardApi#favorite', 'PUT', '/api/v1/boards/{id}/favorite'],
	['boardApi#opened', 'POST', '/api/v1/boards/{id}/opened'],
	// factory job 221: board list sketches, appended as route 57
	['boardApi#sketch', 'GET', '/api/v1/boards/{id}/sketch'],
	// factory job 267: AI, appended as routes 58–62
	['settingsApi#ai', 'PUT', '/api/v1/settings/ai'],
	['aiApi#index', 'GET', '/api/v1/boards/{id}/ai'],
	['aiApi#start', 'POST', '/api/v1/boards/{id}/ai'],
	['aiApi#cancel', 'DELETE', '/api/v1/boards/{id}/ai'],
	['aiApi#allow', 'PUT', '/api/v1/boards/{id}/aiswitch'],
	// factory job 272: presenting frames, appended as routes 63–64
	['moderationApi#moveSummon', 'PUT', '/api/v1/boards/{id}/summon'],
	['moderationApi#slides', 'PUT', '/api/v1/boards/{id}/slides'],
	// factory job 275: private writing, route 65
	['moderationApi#privateWriting', 'PUT', '/api/v1/boards/{id}/private'],
]

/** @return {Map<string, {url: string, verb: string, req: string|null}>} routes.php as text (fixed format §4.1) */
function phpRoutes() {
	const out = new Map()
	const block = PHP.slice(PHP.indexOf("'routes' => ["))
	for (const line of block.split('\n')) {
		if (!line.includes("'name' =>")) {
			continue
		}
		const m = LINE_RE.exec(line)
		assert.ok(m, 'line in the fixed format: ' + line)
		assert.ok(!out.has(m[1]), 'duplicate route ' + m[1])
		out.set(m[1], { url: m[2], verb: m[3], req: m[4] ?? null })
	}
	return out
}

/** @return {{id: string, tok: string}} requirement regex sources from routes.php */
function phpRequirements() {
	const id = /\$id = \['id' => '([^']+)'\];/.exec(PHP)
	const tok = /\$tok = \['token' => '([^']+)'\];/.exec(PHP)
	assert.ok(id && tok, '$id and $tok in routes.php')
	return { id: id[1], tok: tok[1] }
}

/**
 * @param {string} url URL template from routes.php
 * @param {{id: string, tok: string}} req requirement sources
 * @return {RegExp} regex for concrete paths
 */
function templateRe(url, req) {
	const src = url.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
		.replace('{id}', '(' + req.id + ')')
		.replace('{token}', '(' + req.tok + ')')
	return new RegExp('^' + src + '$')
}

test('ROUTES equals appinfo/routes.php (names, verbs, URLs, requirements)', () => {
	const php = phpRoutes()
	assert.equal(php.size, 65)
	assert.equal(Object.keys(ROUTES).length, 65)
	assert.deepEqual([...php.keys()].sort(), Object.keys(ROUTES).sort())
	for (const [name, r] of php) {
		assert.equal(ROUTES[name].verb, r.verb, name)
		assert.equal(ROUTES[name].url, r.url, name)
		const placeholder = r.url.includes('{id}') ? 'id' : r.url.includes('{token}') ? 'tok' : null
		assert.equal(r.req, placeholder, name + ': requirement matches the placeholder')
	}
	const req = phpRequirements()
	assert.equal(REQUIREMENTS.id.source, '^' + req.id + '$')
	assert.equal(REQUIREMENTS.token.source, '^' + req.tok + '$')
})

test('ROUTES and routes.php follow the frozen table of SPEC-M1 §4.1 plus route 27, (job 182, AK8) routes 28–34 and (job 189, AK9) routes 35–43 and (job 191, AK8) routes 44–45 and (job 203) routes 46–54 and (job 219) routes 55–56 and (job 221) route 57 and (job 267) routes 58–62 and (job 272) routes 63–64 and (job 275) route 65 (65 routes, same order)', () => {
	assert.equal(SPEC_ROUTES.length, 65)
	assert.deepEqual(Object.entries(ROUTES).map(([name, r]) => [name, r.verb, r.url]), SPEC_ROUTES)
	assert.deepEqual([...phpRoutes()].map(([name, r]) => [name, r.verb, r.url]), SPEC_ROUTES)
})

test('every builder yields verb and path of its route in routes.php (65 builders)', () => {
	const php = phpRoutes()
	const req = phpRequirements()
	const id = 123456789012
	const tok = 'Ab3dEf6hIj9kLm2nOp5qRs8t'
	const built = {
		'boardApi#index': api.listBoards(),
		'boardApi#create': api.createBoard(),
		'boardApi#update': api.renameBoard(id),
		'boardApi#destroy': api.deleteBoard(id),
		'boardApi#enableLink': api.enableLink(id),
		'boardApi#disableLink': api.disableLink(id),
		'boardApi#joinLink': api.joinLink(tok),
		'sync#snapshot': api.snapshot(id),
		'sync#sync': api.sync(id),
		'publicSync#join': api.guestJoin(tok),
		'publicSync#snapshot': api.guestSnapshot(id),
		'publicSync#sync': api.guestSync(id),
		'boardApi#enableVoteLink': api.enableVoteLink(id),
		'boardApi#disableVoteLink': api.disableVoteLink(id),
		'shareApi#index': api.listShares(id),
		'shareApi#update': api.saveShares(id),
		'shareApi#sharees': api.searchSharees(id, 'ana'),
		'moderationApi#startVote': api.startVote(id),
		'moderationApi#updateVote': api.updateVote(id),
		'moderationApi#timer': api.timer(id),
		'moderationApi#summon': api.summon(id),
		'moderationApi#endSummon': api.endSummon(id),
		'settingsApi#update': api.savePrivacy(),
		'templateApi#index': api.listTemplates(),
		'templateApi#create': api.createTemplate(),
		'templateApi#show': api.showTemplate(id),
		'templateApi#update': api.updateTemplate(id),
		'templateApi#destroy': api.deleteTemplate(id),
		'templateApi#adopt': api.adoptTemplate(id),
		'templateApi#review': api.reviewTemplates(),
		'commentApi#index': api.listComments(id),
		'commentApi#create': api.createComment(id),
		'commentApi#update': api.updateComment(id),
		'commentApi#destroy': api.deleteComment(id, '17'),
		'commentApi#mentions': api.searchMentions(id, 'bo'),
		'publicComment#index': api.guestComments(id),
		'publicComment#create': api.guestCreateComment(id),
		'publicComment#update': api.guestUpdateComment(id),
		'publicComment#destroy': api.guestDeleteComment(id, 17),
		'tagApi#update': api.saveTags(id),
		'publicTag#update': api.guestSaveTags(id),
		'shapeLibApi#index': api.listShapeLibs(),
		'shapeLibApi#create': api.createShapeLib(),
		'shapeLibApi#show': api.showShapeLib(id),
		'shapeLibApi#update': api.updateShapeLib(id),
		'shapeLibApi#destroy': api.deleteShapeLib(id),
		'shapeLibApi#suggest': api.suggestShapeLib(id),
		'shapeLibApi#adopt': api.adoptShapeLib(id),
		'shapeLibApi#review': api.reviewShapeLibs(),
		'shapeLibApi#withdraw': api.withdrawShapeLib(id),
		'boardApi#favorite': api.setFavorite(id),
		'boardApi#opened': api.markOpened(id),
		'boardApi#sketch': api.boardSketch(id),
		'settingsApi#ai': api.saveAiSettings(),
		'aiApi#index': api.aiState(id),
		'aiApi#start': api.startAi(id),
		'aiApi#cancel': api.forgetAi(id, 17),
		'aiApi#allow': api.allowAi(id),
		'moderationApi#moveSummon': api.moveSummon(id),
		'moderationApi#slides': api.saveSlides(id),
		'moderationApi#privateWriting': api.privateWriting(id),
		'page#index': pages.list(),
		'page#board': pages.board(id),
		'page#join': pages.join(tok),
		'publicPage#show': pages.publicLink(tok),
	}
	assert.equal(Object.keys(built).length, 65)
	assert.equal(Object.keys(api).length + Object.keys(pages).length, 65, 'no builder without a route')
	assert.deepEqual(Object.keys(built).sort(), [...php.keys()].sort(), 'one builder per route')
	for (const [name, b] of Object.entries(built)) {
		const r = php.get(name)
		const [path, query] = b.path.split('?')
		assert.equal(b.method, r.verb, name)
		assert.match(path, templateRe(r.url, req), name)
		const want = { 'shareApi#sharees': 'q=ana', 'commentApi#mentions': 'q=bo', 'commentApi#destroy': 'comment=17', 'publicComment#destroy': 'comment=17', 'aiApi#cancel': 'task=17' }
		assert.equal(query, want[name], name + ': a query only on the sharee search and (job 189) the @ list and the comment deletes')
	}
	assert.equal(api.sync(7).path, '/api/v1/boards/7/sync')
	assert.equal(api.guestJoin(tok).path, '/pub/v1/' + tok + '/join')
	assert.deepEqual(api.enableVoteLink(7), { method: 'POST', path: '/api/v1/boards/7/votelink' })
	assert.deepEqual(api.disableVoteLink(7), { method: 'DELETE', path: '/api/v1/boards/7/votelink' })
	assert.deepEqual(api.saveShares(7), { method: 'PUT', path: '/api/v1/boards/7/shares' })
	assert.deepEqual(api.updateVote(7), { method: 'PATCH', path: '/api/v1/boards/7/vote' })
	assert.deepEqual(api.timer(7), { method: 'PUT', path: '/api/v1/boards/7/timer' })
	assert.deepEqual(api.endSummon(7), { method: 'DELETE', path: '/api/v1/boards/7/summon' })
	assert.deepEqual(api.savePrivacy(), { method: 'PUT', path: '/api/v1/settings/privacy' })
	// job 182: the template routes; an id up to 2^53 − 1 stays exact
	assert.deepEqual(api.listTemplates(), { method: 'GET', path: '/api/v1/templates' })
	assert.deepEqual(api.createTemplate(), { method: 'POST', path: '/api/v1/templates' })
	assert.deepEqual(api.showTemplate(9007199254740991), { method: 'GET', path: '/api/v1/templates/9007199254740991' })
	assert.deepEqual(api.updateTemplate(7), { method: 'PATCH', path: '/api/v1/templates/7' })
	assert.deepEqual(api.deleteTemplate(7), { method: 'DELETE', path: '/api/v1/templates/7' })
	assert.deepEqual(api.adoptTemplate(7), { method: 'POST', path: '/api/v1/templates/7/adopt' })
	assert.deepEqual(api.reviewTemplates(), { method: 'GET', path: '/api/v1/templates/review' })
	assert.throws(() => api.showTemplate('7/../8'), /Invalid route parameter id/)
	// job 189: the comment id of a delete is a decimal without a leading zero
	assert.deepEqual(api.deleteComment(7, '123'), { method: 'DELETE', path: '/api/v1/boards/7/comments?comment=123' })
	for (const bad of ['0', '012', '1x', 'a', '', null, 1.5, -1]) {
		assert.throws(() => api.deleteComment(7, bad), /Invalid comment id/, String(bad))
		assert.throws(() => api.guestDeleteComment(7, bad), /Invalid comment id/, String(bad))
	}
	assert.deepEqual(api.searchMentions(7, 'Bob B'), { method: 'GET', path: '/api/v1/boards/7/mentions?q=Bob%20B' })
	// job 191: the tag routes, PUT without a query
	assert.deepEqual(api.saveTags(7), { method: 'PUT', path: '/api/v1/boards/7/tags' })
	assert.deepEqual(api.guestSaveTags(7), { method: 'PUT', path: '/pub/v1/boards/7/tags' })
	assert.throws(() => api.saveTags('7/../8'), /Invalid route parameter id/)
})

test('sharee search: query `q` only, encoded, strings of at most 200 bytes (JsonBody::query, §4.1)', () => {
	assert.equal(QUERY_MAX_BYTES, 200)
	assert.deepEqual(api.searchSharees(7, 'Ana {id}&shareType=1'), {
		method: 'GET',
		path: '/api/v1/boards/7/sharees?q=' + encodeURIComponent('Ana {id}&shareType=1'),
	})
	assert.doesNotMatch(api.searchSharees(7, 'Ana {id}&shareType=1').path, /[{}]|&shareType/, 'no raw braces (router placeholders), never a shareType parameter')
	assert.equal(api.searchSharees(7, '').path, '/api/v1/boards/7/sharees?q=')
	assert.equal(api.searchSharees(7, 'x'.repeat(200)).path.length, '/api/v1/boards/7/sharees?q='.length + 200)
	assert.ok(api.searchSharees(7, 'ä'.repeat(100)), '100 × 2 bytes = 200 bytes')
	assert.throws(() => api.searchSharees(7, 'x'.repeat(201)), /Invalid query parameter q/)
	assert.throws(() => api.searchSharees(7, 'ä'.repeat(101)), /Invalid query parameter q/, 'bytes, not characters')
	assert.throws(() => api.searchSharees(7), /Invalid query parameter q/)
	assert.throws(() => api.searchSharees(7, 42), /Invalid query parameter q/)
	assert.throws(() => api.searchSharees('7/../8', 'a'), /Invalid route parameter id/)
	assert.deepEqual(withQuery(api.listShares(7), {}), api.listShares(7), 'no parameters, no "?"')
})

test('route() refuses parameters outside the requirements', () => {
	assert.throws(() => route('sync#sync', { id: '7/../8' }))
	assert.throws(() => route('sync#sync', { id: 1.5 }))
	assert.throws(() => route('sync#sync', {}))
	assert.throws(() => route('publicSync#join', { token: 'short' }))
	assert.throws(() => route('moderationApi#summon', { id: '1e3' }))
	assert.throws(() => route('nope#nope'))
	assert.equal(route('sync#sync', { id: '42' }).path, '/api/v1/boards/42/sync')
})

test('mini router: parse paths of the three pages', () => {
	assert.deepEqual(parse('/index.php/apps/knorke/'), { name: 'list' })
	assert.deepEqual(parse('/index.php/apps/knorke'), { name: 'list' })
	assert.deepEqual(parse('/apps/knorke/b/17'), { name: 'board', id: 17 })
	assert.deepEqual(parse('/nc/index.php/apps/knorke/b/17/'), { name: 'board', id: 17 })
	assert.deepEqual(parse('/index.php/apps/knorke/join/Ab3dEf6hIj9kLm2nOp5qRs8t'), { name: 'join', token: 'Ab3dEf6hIj9kLm2nOp5qRs8t' })
	assert.deepEqual(parse('/index.php/apps/knorke/join/short'), { name: 'list' })
	assert.deepEqual(parse('/index.php/apps/knorke/b/x'), { name: 'list' })
})

test('job 175 signInUrl: the Nextcloud login with redirect_url = the URL-encoded app path /p/<token>', () => {
	// @nextcloud/router builds URLs from the web root (empty, as in the other shell tests)
	globalThis.window ??= { _oc_webroot: '' }
	const url = signInUrl('abc')
	const [path, query] = url.split('?')
	assert.match(path, /\/login$/)
	assert.match(query, /^redirect_url=[^&]+$/)
	const target = decodeURIComponent(query.slice('redirect_url='.length))
	assert.match(target, /\/apps\/knorke\/p\/abc$/)
	assert.ok(target.startsWith('/'), 'a relative path, no host')
	assert.ok(!query.slice('redirect_url='.length).includes('/'), 'the path is URL-encoded')
	const tok = 'AbCdEfGhIjKlMnOpQrStUvWx'
	assert.equal(decodeURIComponent(signInUrl(tok).split('redirect_url=')[1]).endsWith('/apps/knorke/p/' + tok), true)
	assert.doesNotMatch(decodeURIComponent(signInUrl('a/../b?c').split('redirect_url=')[1]), /\/\.\.\/|\?/, 'a token never adds a path segment or a query')
})
