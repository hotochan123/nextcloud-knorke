/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as ai from '../../../src/api/ai.js'
import * as boards from '../../../src/api/boards.js'
import * as shapeLibs from '../../../src/api/shapeLibs.js'
import * as templates from '../../../src/api/templates.js'
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
	assert.deepEqual(await boards.startVote(2, { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: 10, live: true, accountsOnly: true, extra: true }), { board: { metaRev: 3 }, now: 1 })
	await boards.updateVote(2, 'extend', 5)
	await boards.timer(2, 'start', 60000)
	await boards.summon(2, 'cK3j9aZp2Q')
	await boards.endSummon(2)
	await boards.summon(2, 'cK3j9aZp2Q', '01HZZZZZZZZZZZZZZZZZZZZZZA')
	await boards.moveSummon(2, '01HZZZZZZZZZZZZZZZZZZZZZZB')
	await boards.saveSlides(2, ['01HZZZZZZZZZZZZZZZZZZZZZZB'])
	await boards.privateWriting(2, 'start', '01HZZZZZZZZZZZZZZZZZZZZZZA')
	await boards.privateWriting(2, 'reveal')
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['POST', '/index.php/apps/knorke/api/v1/boards/2/votelink', { rotate: true, password: null, expiresAt: '2026-12-31' }],
		['DELETE', '/index.php/apps/knorke/api/v1/boards/2/votelink', undefined],
		['GET', '/index.php/apps/knorke/api/v1/boards/2/shares', undefined],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/shares', { shares: [{ kind: 'user', id: 'bob', role: 'edit' }] }],
		['GET', '/index.php/apps/knorke/api/v1/boards/2/sharees?q=bo%20b%26x', undefined],
		['POST', '/index.php/apps/knorke/api/v1/boards/2/vote', { per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: 10, live: true, accountsOnly: true }],
		['PATCH', '/index.php/apps/knorke/api/v1/boards/2/vote', { action: 'extend', minutes: 5 }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/timer', { action: 'start', ms: 60000 }],
		['POST', '/index.php/apps/knorke/api/v1/boards/2/summon', { client: 'cK3j9aZp2Q' }],
		['DELETE', '/index.php/apps/knorke/api/v1/boards/2/summon', undefined],
		['POST', '/index.php/apps/knorke/api/v1/boards/2/summon', { client: 'cK3j9aZp2Q', frame: '01HZZZZZZZZZZZZZZZZZZZZZZA' }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/summon', { frame: '01HZZZZZZZZZZZZZZZZZZZZZZB' }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/slides', { order: ['01HZZZZZZZZZZZZZZZZZZZZZZB'] }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/private', { action: 'start', frame: '01HZZZZZZZZZZZZZZZZZZZZZZA' }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/2/private', { action: 'reveal' }],
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

test('M1 §4.1: every one of the 65 routes (job 182: 28–34 through api/templates.js; job 189: 35–43 through the transports; job 203: 46–54 through api/shapeLibs.js; job 219: 55–56 and job 221: 57 through api/boards.js; job 267: 58–62 through api/ai.js; job 272: 63–64 and job 275: 65 through api/boards.js) has exactly one way in from the client (api/boards.js, api/templates.js, api/shapeLibs.js, a transport or a page builder)', async () => {
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
	await boards.moveSummon(1, '01HZZZZZZZZZZZZZZZZZZZZZZA')
	await boards.saveSlides(1, [])
	await boards.privateWriting(1, 'reveal')
	await boards.savePrivacy({ default: { text: '', url: '' }, languages: {} })
	// job 219: the board list marks
	await boards.setFavorite(1, true)
	await boards.markOpened(1)
	// job 221: the board list sketches
	await boards.boardSketch(1)
	// job 267: the AI (api/ai.js, through api/boards.js call)
	await ai.aiState(1)
	await ai.startAi(1, { kind: 'summarise', ids: [] })
	await ai.forgetAi(1, 5)
	await ai.allowAi(1, true)
	await ai.saveAiSettings({ enabled: true })
	// api/templates.js (job 182, through api/boards.js call)
	await templates.listTemplates()
	await templates.createTemplate({ name: 'T', note: '', content: '{}', sketch: [] })
	await templates.templateContent(1)
	await templates.renameTemplate(1, 'U')
	await templates.deleteTemplate(1)
	await templates.adoptTemplate(1)
	await templates.reviewTemplates()
	// api/shapeLibs.js (job 203, through api/boards.js call)
	await shapeLibs.listShapeLibs()
	await shapeLibs.createShapeLib('L', [])
	await shapeLibs.shapeLibEntries(1)
	await shapeLibs.renameShapeLib(1, 'M')
	await shapeLibs.deleteShapeLib(1)
	await shapeLibs.suggestShapeLib(1, 'n')
	await shapeLibs.adoptShapeLib(1)
	await shapeLibs.reviewShapeLibs()
	await shapeLibs.withdrawShapeLib(1)
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
	// job 189: the comment routes of both transports (the @ list only for accounts)
	await ut.comments.list()
	await ut.comments.create({ text: 'x', x: 0, y: 0 })
	await ut.comments.update({ comment: '5', resolved: true })
	await ut.comments.remove('5')
	await ut.comments.mentions('bo')
	await gt.comments.list()
	await gt.comments.create({ text: 'x', x: 0, y: 0 })
	await gt.comments.update({ comment: '5', resolved: true })
	await gt.comments.remove('5')
	assert.equal(gt.comments.mentions, null, 'guests have no @ list')
	// job 191: the tag routes of both transports
	await ut.tags.save({ action: 'delete', tag: '01JA0000000000000000000001' })
	await gt.tags.save({ action: 'delete', tag: '01JA0000000000000000000001' })
	// pages (navigation, not requests)
	for (const p of [pages.list(), pages.board(1), pages.join(TOKEN), pages.publicLink(TOKEN)]) {
		note('page')(p.method, '/index.php/apps/knorke' + p.path)
	}
	assert.deepEqual([...seen.keys()].sort(), Object.keys(ROUTES).sort(), 'all 65 routes are reachable')
	for (const [name, vias] of seen) {
		assert.equal(vias.length, 1, name + ' is reached once: ' + vias.join(', '))
	}
	assert.equal(seen.size, 65)
})

test('job 203: api/shapeLibs.js calls the nine routes 46–54 with verb, URL and exactly the allowed body keys; answers and errors', async () => {
	const lib = { id: 123456789012345, name: 'AWS', names: ['EC2'] }
	const entry = { name: 'EC2', img: 'data:image/png;base64,AAAA', w: 64, h: 64 }
	answers = [
		{ right: 'save', adopted: [lib], own: [{ ...lib, pending: true }] },
		{ id: 5 },
		{ entries: [entry] },
		{ id: 5, name: 'Neu' },
		{ deleted: true },
		{ id: 5, state: 'pending' },
		{ id: 5, state: 'pending' },
		{ id: 6 },
		{ suggestions: [{ ...lib, note: null, by: 'Bob', created: 1 }], adopted: [lib] },
		{ withdrawn: true },
		{ right: 'nope' },
	]
	assert.deepEqual(await shapeLibs.listShapeLibs(), { right: 'save', adopted: [lib], own: [{ ...lib, pending: true }] })
	assert.deepEqual(await shapeLibs.createShapeLib('AWS', [entry]), { id: 5 })
	assert.deepEqual(await shapeLibs.shapeLibEntries(5), [entry])
	await shapeLibs.renameShapeLib(5, 'Neu')
	await shapeLibs.deleteShapeLib(5)
	await shapeLibs.suggestShapeLib(5, 'bitte')
	await shapeLibs.suggestShapeLib(5)
	await shapeLibs.adoptShapeLib(5)
	assert.equal((await shapeLibs.reviewShapeLibs()).suggestions.length, 1)
	await shapeLibs.withdrawShapeLib(5)
	assert.deepEqual(await shapeLibs.listShapeLibs(), { right: null, adopted: [], own: [] }, 'an unknown right is none')
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['GET', '/index.php/apps/knorke/api/v1/shapelibs', undefined],
		['POST', '/index.php/apps/knorke/api/v1/shapelibs', { name: 'AWS', entries: [entry] }],
		['GET', '/index.php/apps/knorke/api/v1/shapelibs/5', undefined],
		['PATCH', '/index.php/apps/knorke/api/v1/shapelibs/5', { name: 'Neu' }],
		['DELETE', '/index.php/apps/knorke/api/v1/shapelibs/5', undefined],
		['POST', '/index.php/apps/knorke/api/v1/shapelibs/5/suggest', { note: 'bitte' }],
		['POST', '/index.php/apps/knorke/api/v1/shapelibs/5/suggest', {}],
		['POST', '/index.php/apps/knorke/api/v1/shapelibs/5/adopt', {}],
		['GET', '/index.php/apps/knorke/api/v1/shapelibs/review', undefined],
		['DELETE', '/index.php/apps/knorke/api/v1/shapelibs/5/suggest', undefined],
		['GET', '/index.php/apps/knorke/api/v1/shapelibs', undefined],
	])
	answers = [new HttpError(409, 'library_limit', '', null, true, { max: 20 })]
	await assert.rejects(shapeLibs.createShapeLib('X', [entry]), (e) => e.status === 409 && e.body?.max === 20)
})

test('job 182 AK11: api/templates.js calls the seven routes 28–34 with verb, URL and exactly the allowed body keys, CSRF headers; answers and errors', async () => {
	const entry = { id: 9007199254740991, name: 'Retro', sketch: [] }
	answers = [
		{ right: 'suggest', templates: [entry], pending: [{ ...entry, id: 5, note: 'n', created: 1 }] },
		{ id: 7, state: 'pending' },
		{ content: '{"knorke":1}' },
		{ id: 7, name: 'Neu' },
		{ deleted: true },
		{ id: 7 },
		{ suggestions: [{ id: 5, name: 'S', note: null, sketch: [], by: 'Bob Berg', created: 1 }], templates: [entry] },
	]
	assert.deepEqual(await templates.listTemplates(), { right: 'suggest', templates: [entry], pending: [{ ...entry, id: 5, note: 'n', created: 1 }] })
	assert.deepEqual(await templates.createTemplate({ name: 'Retro', note: 'Satz', content: '{"knorke":1}', sketch: [[1, 2, 3, 4, '']], scope: 'shared', owner: 'bob', id: 7 }), { id: 7, state: 'pending' })
	assert.equal(await templates.templateContent(entry.id), '{"knorke":1}')
	assert.deepEqual(await templates.renameTemplate(7, 'Neu'), { id: 7, name: 'Neu' })
	assert.deepEqual(await templates.deleteTemplate(7), { deleted: true })
	assert.deepEqual(await templates.adoptTemplate(7), { id: 7 })
	assert.deepEqual(await templates.reviewTemplates(), { suggestions: [{ id: 5, name: 'S', note: null, sketch: [], by: 'Bob Berg', created: 1 }], templates: [entry] })
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['GET', '/index.php/apps/knorke/api/v1/templates', undefined],
		['POST', '/index.php/apps/knorke/api/v1/templates', { name: 'Retro', note: 'Satz', content: '{"knorke":1}', sketch: [[1, 2, 3, 4, '']] }],
		['GET', '/index.php/apps/knorke/api/v1/templates/9007199254740991', undefined],
		['PATCH', '/index.php/apps/knorke/api/v1/templates/7', { name: 'Neu' }],
		['DELETE', '/index.php/apps/knorke/api/v1/templates/7', undefined],
		['POST', '/index.php/apps/knorke/api/v1/templates/7/adopt', {}],
		['GET', '/index.php/apps/knorke/api/v1/templates/review', undefined],
	])
	assert.deepEqual(templates.CREATE_KEYS, ['name', 'note', 'content', 'sketch'])
	for (const c of calls) {
		assert.equal(c.headers.requesttoken, 'tok1')
		assert.equal(c.headers['X-Requested-With'], 'XMLHttpRequest')
	}
	// missing parts: no right, empty lists, no content
	answers = [{ right: 'admin' }, {}, {}]
	assert.deepEqual(await templates.listTemplates(), { right: null, templates: [], pending: [] })
	assert.equal(await templates.templateContent(3), null)
	assert.deepEqual(await templates.reviewTemplates(), { suggestions: [], templates: [] })
	// 409 suggestion_limit keeps its max
	answers = [new HttpError(409, 'suggestion_limit', 'x', null, true, { error: 'suggestion_limit', max: 10 })]
	await assert.rejects(templates.createTemplate({ name: 'X', content: '{}', sketch: [] }), (e) => e.status === 409 && e.code === 'suggestion_limit' && e.body.max === 10)
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

test('job 219 AK5: setFavorite and markOpened send verb, URL and body of routes 55 and 56; answers', async () => {
	answers = [{ favorite: true }, { favorite: false }, { openedAt: 1760000000000 }, {}]
	assert.equal(await boards.setFavorite(7, true), true)
	assert.equal(await boards.setFavorite(7, false), false)
	assert.equal(await boards.markOpened(7), 1760000000000)
	assert.equal(await boards.markOpened(7), null, 'no time in the answer')
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['PUT', '/index.php/apps/knorke/api/v1/boards/7/favorite', { favorite: true }],
		['PUT', '/index.php/apps/knorke/api/v1/boards/7/favorite', { favorite: false }],
		['POST', '/index.php/apps/knorke/api/v1/boards/7/opened', {}],
		['POST', '/index.php/apps/knorke/api/v1/boards/7/opened', {}],
	])
	answers = [new HttpError(404, 'not_found')]
	await assert.rejects(boards.setFavorite(8, true), (e) => e instanceof HttpError && e.status === 404)
})

test('job 221 AK4: boardSketch sends GET of route 57 without a body; the sketch of the answer, [] without one', async () => {
	answers = [{ sketch: [[4, 4, 72, 72, '#ffeb3b']] }, {}, { sketch: 'x' }]
	assert.deepEqual(await boards.boardSketch(7), [[4, 4, 72, 72, '#ffeb3b']])
	assert.deepEqual(await boards.boardSketch(7), [])
	assert.deepEqual(await boards.boardSketch(7), [])
	assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
		['GET', '/index.php/apps/knorke/api/v1/boards/7/sketch', undefined],
		['GET', '/index.php/apps/knorke/api/v1/boards/7/sketch', undefined],
		['GET', '/index.php/apps/knorke/api/v1/boards/7/sketch', undefined],
	])
	answers = [new HttpError(404, 'not_found')]
	await assert.rejects(boards.boardSketch(8), (e) => e instanceof HttpError && e.status === 404)
})

test('job 267: the AI callers send only the keys of their routes', async () => {
	const calls = []
	boards.deps.request = async (method, url, o) => { calls.push([method, url.replace(/^\/index\.php\/apps\/knorke/, ''), o?.body ?? null]); return { task: 9, ai: { enabled: false } } }
	assert.equal(await ai.startAi(7, { kind: 'cluster', ids: ['a', 'b'], frame: 'f', acceptNotice: true, extra: 1 }), 9)
	assert.equal(await ai.startAi(7, { kind: 'summarise', ids: ['a'] }), 9)
	await ai.forgetAi(7, 12)
	await ai.allowAi(7, false)
	assert.deepEqual(await ai.saveAiSettings({ dailyLimit: 5, other: 1 }), { enabled: false })
	const bodies = calls.map(([m, u, b]) => [m, u, typeof b === 'string' ? JSON.parse(b) : b])
	assert.deepEqual(bodies, [
		['POST', '/api/v1/boards/7/ai', { kind: 'cluster', ids: ['a', 'b'], frame: 'f', acceptNotice: true }],
		['POST', '/api/v1/boards/7/ai', { kind: 'summarise', ids: ['a'] }],
		['DELETE', '/api/v1/boards/7/ai?task=12', null],
		['PUT', '/api/v1/boards/7/aiswitch', { allowed: false }],
		['PUT', '/api/v1/settings/ai', { dailyLimit: 5 }],
	])
})
