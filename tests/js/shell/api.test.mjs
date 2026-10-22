/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as boards from '../../../src/api/boards.js'
import { HttpError } from '../../../src/sync/http.js'
import { guestTransport, userTransport } from '../../../src/sync/transport.js'
import { ROUTES, REQUIREMENTS, pages } from '../../../src/util/routes.js'

const TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs8t'
let calls
let answers

beforeEach(() => {
	calls = []
	answers = []
	globalThis._nc_auth_requestToken = 'tok1'
	boards.deps.urlOf = (p) => '/index.php/apps/knorke' + p
	boards.deps.csrfUrl = () => '/index.php/csrftoken'
	boards.deps.request = async (method, url, opts) => {
		calls.push({ method, url, body: opts.body, headers: opts.headers })
		const a = answers.shift()
		if (a instanceof Error) {
			throw a
		}
		return a
	}
})

test('board calls: verbs, URLs, bodies (every POST carries JSON), headers', async () => {
	answers = [{ boards: [{ id: 1 }] }, { board: { id: 2 } }, { board: { id: 2, title: 'T' } }, { deleted: true }, { link: { token: TOKEN } }, { link: null }, { boardId: 9 }]
	assert.deepEqual(await boards.listBoards(), [{ id: 1 }])
	assert.deepEqual(await boards.createBoard('New'), { id: 2 })
	assert.deepEqual(await boards.renameBoard(2, 'T'), { id: 2, title: 'T' })
	assert.equal(await boards.deleteBoard(2), true)
	assert.deepEqual(await boards.enableLink(2, true), { token: TOKEN })
	assert.equal(await boards.disableLink(2), null)
	assert.equal(await boards.joinLink(TOKEN), 9)
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['GET', '/index.php/apps/knorke/api/v1/boards', undefined],
		['POST', '/index.php/apps/knorke/api/v1/boards', { title: 'New' }],
		['PATCH', '/index.php/apps/knorke/api/v1/boards/2', { title: 'T' }],
		['DELETE', '/index.php/apps/knorke/api/v1/boards/2', undefined],
		['POST', '/index.php/apps/knorke/api/v1/boards/2/link', { rotate: true }],
		['DELETE', '/index.php/apps/knorke/api/v1/boards/2/link', undefined],
		['POST', '/index.php/apps/knorke/api/v1/links/' + TOKEN + '/join', {}],
	])
	for (const c of calls) {
		assert.equal(c.headers.requesttoken, 'tok1')
		assert.equal(c.headers['X-Requested-With'], 'XMLHttpRequest')
	}
})

test('412 → one CSRF refresh with one repeat; twice 412 → 401', async () => {
	answers = [new HttpError(412, 'http_412'), { token: 'tok2' }, { boards: [] }]
	assert.deepEqual(await boards.listBoards(), [])
	assert.equal(calls[1].url, '/index.php/csrftoken')
	assert.equal(calls[2].headers.requesttoken, 'tok2')
	answers = [new HttpError(412, 'http_412'), { token: 'tok3' }, new HttpError(412, 'http_412')]
	await assert.rejects(boards.listBoards(), (e) => e.status === 401 && e.code === 'http_401')
	answers = [new HttpError(412, 'http_412'), new HttpError(401, 'http_401')]
	await assert.rejects(boards.listBoards(), (e) => e.status === 401)
})

test('app errors pass through unchanged (link_revoked, not_found, rate_limited)', async () => {
	answers = [new HttpError(403, 'link_revoked', '', null, true)]
	await assert.rejects(boards.joinLink(TOKEN), (e) => e.code === 'link_revoked')
	answers = [new HttpError(429, 'rate_limited', '', null, true)]
	await assert.rejects(boards.createBoard('x'), (e) => e.code === 'rate_limited')
})

// ---- SPEC-M1 §4.1: a caller for every route (WP-C0) ---------------------------------

const LINK = { token: TOKEN, role: 'vote', url: 'u' }

test('M1 callers of routes 17–26: verbs, URLs and bodies with only the allowed keys', async () => {
	answers = [
		{ link: LINK }, { link: null }, { shares: [] }, { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] }, { sharees: [{ kind: 'user', id: 'bob' }], more: true },
		{ board: { metaRev: 3 }, now: 1 }, { board: { metaRev: 4 } }, { board: { metaRev: 5 } }, { board: { metaRev: 6 } }, { board: { metaRev: 7 } },
	]
	assert.deepEqual(await boards.enableVoteLink(2, { rotate: true, password: null, expiresAt: '2026-12-31', junk: 1 }), LINK)
	assert.equal(await boards.disableVoteLink(2), null)
	assert.deepEqual(await boards.listShares(2), { shares: [] })
	assert.deepEqual(await boards.saveShares(2, [{ kind: 'user', id: 'bob', role: 'edit' }]), { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] })
	assert.deepEqual(await boards.searchSharees(2, 'bo b&x'), { sharees: [{ kind: 'user', id: 'bob' }], more: true })
	assert.deepEqual(await boards.startVote(2, { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: 10, extra: true }), { board: { metaRev: 3 }, now: 1 })
	await boards.updateVote(2, 'extend', 5)
	await boards.timer(2, 'start', 60000)
	await boards.summon(2, 'cK3j9aZp2Q')
	await boards.endSummon(2)
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['POST', '/index.php/apps/knorke/api/v1/boards/2/votelink', { rotate: true, password: null, expiresAt: '2026-12-31' }],
		['DELETE', '/index.php/apps/knorke/api/v1/boards/2/votelink', undefined],
		['GET', '/index.php/apps/knorke/api/v1/boards/2/shares', undefined],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/shares', { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] }],
		['GET', '/index.php/apps/knorke/api/v1/boards/2/sharees?q=bo%20b%26x', undefined],
		['POST', '/index.php/apps/knorke/api/v1/boards/2/vote', { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: 10 }],
		['PATCH', '/index.php/apps/knorke/api/v1/boards/2/vote', { action: 'extend', minutes: 5 }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/timer', { action: 'start', ms: 60000 }],
		['POST', '/index.php/apps/knorke/api/v1/boards/2/summon', { client: 'cK3j9aZp2Q' }],
		['DELETE', '/index.php/apps/knorke/api/v1/boards/2/summon', undefined],
	])
	answers = [{ board: {} }, { board: {} }]
	await boards.updateVote(2, 'end')
	await boards.timer(2, 'stop')
	assert.deepEqual(calls.slice(-2).map((c) => c.body), [{ action: 'end' }, { action: 'stop' }], 'optional keys left out, never sent as undefined/null')
})

test('M1 stub routes answer 501 not_implemented until their stage: the error passes through unchanged', async () => {
	answers = [new HttpError(501, 'not_implemented', 'Not implemented yet.', null, true)]
	await assert.rejects(boards.listShares(2), (e) => e.status === 501 && e.code === 'not_implemented')
})

/**
 * @param {string} method HTTP verb
 * @param {string} url request URL below /index.php/apps/knorke (query stripped)
 * @return {string|null} the route name it matches
 */
function routeOf(method, url) {
	const path = url.replace(/^\/index\.php\/apps\/knorke/, '').replace(/\?.*$/, '')
	for (const [name, r] of Object.entries(ROUTES)) {
		const re = new RegExp('^' + r.url.replace(/\{([a-z]+)\}/g, (m, k) => '(' + REQUIREMENTS[k].source.replace(/^\^|\$$/g, '') + ')') + '$')
		if (r.verb === method && re.test(path)) {
			return name
		}
	}
	return null
}

test('M1 §4.1: every one of the 27 routes has exactly one way in from the client (api/boards.js, a transport or a page builder)', async () => {
	const seen = new Map()
	const note = (via) => (method, url) => {
		const name = routeOf(method, url)
		assert.ok(name, via + ': ' + method + ' ' + url + ' matches a route')
		seen.set(name, [...(seen.get(name) ?? []), via])
	}
	// api/boards.js
	boards.deps.request = async (method, url) => { note('api')(method, url); return { boards: [], board: {}, link: null, boardId: 1, sharees: [] } }
	await boards.listBoards()
	await boards.createBoard('x')
	await boards.renameBoard(1, 'x')
	await boards.deleteBoard(1)
	await boards.enableLink(1)
	await boards.disableLink(1)
	await boards.joinLink(TOKEN)
	await boards.enableVoteLink(1)
	await boards.disableVoteLink(1)
	await boards.listShares(1)
	await boards.saveShares(1, [])
	await boards.searchSharees(1, 'q')
	await boards.startVote(1, {})
	await boards.updateVote(1, 'end')
	await boards.timer(1, 'stop')
	await boards.summon(1, 'cAbc')
	await boards.endSummon(1)
	await boards.savePrivacy({ default: { text: '', url: '' }, languages: {} })
	// transports
	const urlOf = (p) => '/index.php/apps/knorke' + p
	const req = (via) => async (method, url) => { note(via)(method, url); return { rev: 1, guest: { token: 't' }, board: { id: 1 }, me: {} } }
	const ut = userTransport(1, { request: req('user transport'), urlOf, getToken: () => 'x' })
	await ut.snapshot()
	await ut.sync({})
	let g = null
	const gt = guestTransport({ boardId: 1, linkToken: TOKEN, getClient: () => 'cAbc', getGuest: () => g, setGuest: (x) => { g = x }, clearGuest: () => {}, request: req('guest transport'), urlOf })
	await gt.join('Gina')
	await gt.snapshot()
	await gt.sync({})
	// pages (navigation, not requests)
	for (const p of [pages.list(), pages.board(1), pages.join(TOKEN), pages.publicLink(TOKEN)]) {
		note('page')(p.method, '/index.php/apps/knorke' + p.path)
	}
	assert.deepEqual([...seen.keys()].sort(), Object.keys(ROUTES).sort(), 'all 27 routes are reachable')
	for (const [name, vias] of seen) {
		assert.equal(vias.length, 1, name + ' is reached once: ' + vias.join(', '))
	}
	assert.equal(seen.size, 27)
})

test('M2 privacy notice: savePrivacy is PUT /api/v1/settings/privacy with only default and languages, CSRF headers, answer privacy', async () => {
	answers = [{ privacy: { default: { text: 'T0', url: '' }, languages: { de: { text: 'Tde', url: '' } } } }]
	const r = await boards.savePrivacy({ default: { text: 'T0', url: '' }, languages: { de: { text: 'Tde', url: '' } }, extra: 1 })
	assert.deepEqual(r, { default: { text: 'T0', url: '' }, languages: { de: { text: 'Tde', url: '' } } })
	assert.equal(calls.length, 1)
	assert.equal(calls[0].method, 'PUT')
	assert.equal(calls[0].url, '/index.php/apps/knorke/api/v1/settings/privacy')
	assert.deepEqual(calls[0].body, { default: { text: 'T0', url: '' }, languages: { de: { text: 'Tde', url: '' } } })
	assert.equal(calls[0].headers.requesttoken, 'tok1')
	assert.equal(calls[0].headers['X-Requested-With'], 'XMLHttpRequest')
	answers = [new HttpError(400, 'invalid_url', 'x', null, true, { error: 'invalid_url', at: 'de' })]
	await assert.rejects(boards.savePrivacy({}), (e) => e.code === 'invalid_url' && e.body.at === 'de')
	assert.deepEqual(calls[1].body, { default: {}, languages: {} }, 'an empty form sends empty objects')
})

test('M1 stage 2: link bodies — boolean = M0 rotate form; object passes only rotate/password/expiresAt; joinLink sends a typed password only; linkCalls by role', async () => {
	answers = [{ link: { token: TOKEN } }, { link: { token: TOKEN } }, { link: { token: TOKEN } }, { link: { token: TOKEN } }, { boardId: 4 }, { boardId: 5 }, { link: null }, { link: null }]
	await boards.enableLink(3)
	await boards.enableLink(3, { password: 's3cret', expiresAt: '2026-10-20', bogus: 1 })
	await boards.enableLink(3, { password: null, expiresAt: null })
	await boards.enableLink(3, {})
	assert.equal(await boards.joinLink(TOKEN, 'pw'), 4)
	assert.equal(await boards.joinLink(TOKEN, ''), 5)
	await boards.linkCalls('edit').disable(3)
	await boards.linkCalls('vote').disable(3)
	assert.deepEqual(calls.map((c) => [c.method, c.url.replace('/index.php/apps/knorke', ''), c.body]), [
		['POST', '/api/v1/boards/3/link', { rotate: false }],
		['POST', '/api/v1/boards/3/link', { password: 's3cret', expiresAt: '2026-10-20' }],
		['POST', '/api/v1/boards/3/link', { password: null, expiresAt: null }],
		['POST', '/api/v1/boards/3/link', {}],
		['POST', '/api/v1/links/' + TOKEN + '/join', { password: 'pw' }],
		['POST', '/api/v1/links/' + TOKEN + '/join', {}],
		['DELETE', '/api/v1/boards/3/link', undefined],
		['DELETE', '/api/v1/boards/3/votelink', undefined],
	])
	assert.equal(boards.linkCalls('vote').enable, boards.enableVoteLink)
	assert.equal(boards.linkCalls('edit').enable, boards.enableLink)
	assert.deepEqual(boards.linkBody(true), { rotate: true })
	assert.deepEqual(boards.linkBody({ rotate: true, expiresAt: undefined }), { rotate: true }, 'undefined keys never go out')
})

test('M1 stage 2: the guest join carries the password only when one was typed', async () => {
	const bodies = []
	let g = null
	const req = async (method, url, opts) => { bodies.push(opts.body); return { proto: 2, guest: { token: 't' + bodies.length }, board: { id: 1 }, me: { name: 'Gina' } } }
	const gt = guestTransport({ boardId: 1, linkToken: TOKEN, getClient: () => 'cAbc', getGuest: () => g, setGuest: (x) => { g = x }, clearGuest: () => {}, request: req, urlOf: (p) => p })
	await gt.join('Gina', 'pw1')
	await gt.join(null)
	await gt.join(null, '')
	assert.deepEqual(bodies, [
		{ client: 'cAbc', name: 'Gina', guest: null, password: 'pw1' },
		{ client: 'cAbc', name: 'Gina', guest: 't1' },
		{ client: 'cAbc', name: 'Gina', guest: 't2' },
	])
	assert.equal(JSON.stringify(g).includes('pw1'), false, 'the stored guest entry never holds the password')
})
