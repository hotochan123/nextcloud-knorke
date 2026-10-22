/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUERY_MAX_BYTES, REQUIREMENTS, ROUTES, api, pages, route, withQuery } from '../../../src/util/routes.js'
import { parse } from '../../../src/router.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PHP = readFileSync(join(ROOT, 'appinfo', 'routes.php'), 'utf8')

const LINE_RE = /^\s*\['name' => '([^']+)', 'url' => '([^']+)', 'verb' => '([A-Z]+)'(?:, 'requirements' => \$(id|tok))?\],\s*$/

/**
 * The route table of SPEC-M1 §4.1 (routes 1–16 as in SPEC-M0 §4.1, 17–26
 * new), frozen from stage 0 on, plus route 27 of the M2 privacy notice
 * (appended last): name, verb, URL. Written out here so that
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
	assert.equal(php.size, 27)
	assert.equal(Object.keys(ROUTES).length, 27)
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

test('ROUTES and routes.php follow the frozen table of SPEC-M1 §4.1 plus route 27 (27 routes, same order)', () => {
	assert.equal(SPEC_ROUTES.length, 27)
	assert.deepEqual(Object.entries(ROUTES).map(([name, r]) => [name, r.verb, r.url]), SPEC_ROUTES)
	assert.deepEqual([...phpRoutes()].map(([name, r]) => [name, r.verb, r.url]), SPEC_ROUTES)
})

test('every builder yields verb and path of its route in routes.php (27 builders)', () => {
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
		'page#index': pages.list(),
		'page#board': pages.board(id),
		'page#join': pages.join(tok),
		'publicPage#show': pages.publicLink(tok),
	}
	assert.equal(Object.keys(built).length, 27)
	assert.equal(Object.keys(api).length + Object.keys(pages).length, 27, 'no builder without a route')
	assert.deepEqual(Object.keys(built).sort(), [...php.keys()].sort(), 'one builder per route')
	for (const [name, b] of Object.entries(built)) {
		const r = php.get(name)
		const [path, query] = b.path.split('?')
		assert.equal(b.method, r.verb, name)
		assert.match(path, templateRe(r.url, req), name)
		assert.equal(query, name === 'shareApi#sharees' ? 'q=ana' : undefined, name + ': query only on the sharee search')
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
