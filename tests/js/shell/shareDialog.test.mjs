/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Behaviour of the share dialog family and the board list (SPEC-M1 §6.6,
 * stage 2), run in Node: the real .vue files compiled by ./sfc.mjs
 * (@nextcloud/vue as stubs), the board API with its injectable request as
 * in api.test.mjs, the browser clock mocked.
 *
 * - R14-04: "today" of ShareDialog is the browser's local day until route 19
 *   answers, then linkPolicy.today (the owner's day): prefill
 *   (today + expireDefaultDays), the date-picker min and max and the client
 *   checks follow it, an untouched prefill moves along, the POST sends it.
 * - R14-07: the "Links" view follows the snapshot and a 403 links_disabled;
 *   of route 19/20 only linksAllowed: true is applied; an answer older than
 *   the last 403 lifts nothing; false from route 19 leaves E16's 403 path.
 * - R14-12: a board-list row with access vote says "Can view" (hook stays
 *   vote) while the owner's share dialog shows a stored vote row as
 *   "Can vote".
 * - Job 079: an account that cannot open Knorke (appAccess: false) says
 *   "Cannot open Knorke" in its row and its search option, and keeps the
 *   mark when it is added from the search.
 */
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
// @nextcloud/router needs a web root outside a browser (board-list hrefs)
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const boards = await import('../../../src/api/boards.js')
const { HttpError } = await import('../../../src/sync/http.js')
const ShareDialog = (await import('../../../src/components/ShareDialog.vue')).default
const ShareLinks = (await import('../../../src/components/ShareLinks.vue')).default
const LinkSettings = (await import('../../../src/components/LinkSettings.vue')).default
const SharePeople = (await import('../../../src/components/SharePeople.vue')).default
const BoardList = (await import('../../../src/views/BoardList.vue')).default

const BOARD = 7
const URL_EDIT = 'http://knorke-dev-c-nc/index.php/apps/knorke/p/Ab3dEf6hIj9kLm2nOp5qRs8t'
/** Password and 7-day expiry enforced (E30's policy), as the snapshot sends it (no today). */
const ENFORCED = Object.freeze({ passwordEnforced: true, expireDefaultDays: 7, expireEnforced: true, expireMaxDays: 7 })
/** The browser is already on 2026-10-13 (00:30 local); the owner's zone is still on 2026-10-12. */
const BROWSER_NOW = new Date(2026, 9, 13, 0, 30)
const OWNER_TODAY = '2026-10-12'

let calls
let answers

beforeEach(() => {
	calls = []
	answers = []
	globalThis._nc_auth_requestToken = 'tok1'
	boards.deps.urlOf = (p) => '/index.php/apps/knorke' + p
	boards.deps.csrfUrl = () => '/index.php/csrftoken'
	boards.deps.request = async (method, url, opts) => {
		calls.push({ method, url, body: opts.body })
		const a = answers.shift()
		if (typeof a === 'function') {
			return a()
		}
		if (a instanceof Error) {
			throw a
		}
		return a
	}
	mock.timers.enable({ apis: ['Date'], now: BROWSER_NOW.getTime() })
})

afterEach(() => {
	mock.timers.reset()
})

const err = (status, code, body = {}) => new HttpError(status, code, code, null, true, { error: code, ...body })

/**
 * @param {object} [over] today (null: the field is missing), linksAllowed, links, policy
 * @return {object} owner's answer of route 19 (§4.10.1)
 */
function ownerAnswer({ today = OWNER_TODAY, linksAllowed = true, links = { edit: null, vote: null }, policy = ENFORCED } = {}) {
	return {
		shares: [],
		policy: { sharing: true, groups: true, teams: true, groupMembersOnly: false },
		links,
		linksAllowed,
		linkPolicy: today === null ? { ...policy } : { ...policy, today },
	}
}

/** A deferred answer: answers.push(d.answer); later d.resolve(value). */
function deferred() {
	let resolve
	const p = new Promise((r) => { resolve = r })
	return { answer: () => p, resolve }
}

/**
 * @param {object} props ShareDialog props (merged over an owner's defaults)
 * @return {{b: object, emitted: Array}} bindings of setup() and the emits
 */
function dialog(props = {}) {
	const { bindings, emitted } = setupOf(ShareDialog, {
		boardId: BOARD,
		owner: true,
		mod: false,
		title: 'Workshop',
		links: { edit: null, vote: null },
		linksAllowed: null,
		linkPolicy: ENFORCED,
		...props,
	})
	return { b: bindings, emitted }
}

/**
 * @param {object} b ShareDialog bindings
 * @param {'edit'|'vote'} role section
 * @return {Promise<string>} SSR HTML of that section's LinkSettings with the dialog's state
 */
function renderSettings(b, role = 'edit') {
	return renderToString(createSSRApp(LinkSettings, {
		role,
		link: b.links.value[role],
		draft: b.drafts[role],
		policy: b.linkPolicy.value,
		busy: false,
		error: b.linkErrors[role],
		today: b.today.value,
	}))
}

/**
 * @param {object} b ShareDialog bindings
 * @return {Promise<string>} SSR HTML of the "Links" tab with the dialog's state
 */
function renderLinks(b) {
	return renderToString(createSSRApp(ShareLinks, {
		links: b.links.value,
		linksAllowed: b.linksAllowed.value,
		linkPolicy: b.linkPolicy.value,
		readOnly: !b.props.owner,
		loaded: true,
		busy: false,
		drafts: b.drafts,
		settingsOpen: b.settingsOpen,
		qrOpen: b.qrOpen,
		errors: b.linkErrors,
		today: b.today.value,
	}))
}

/**
 * @param {string} html rendered LinkSettings
 * @return {{min: string|null, max: string|null, value: string|null}} the date picker's bounds and value (stub)
 */
function picker(html) {
	const tag = html.match(/<div data-stub="NcDateTimePickerNative"[^>]*>/)?.[0] ?? ''
	const get = (a) => tag.match(new RegExp(' ' + a + '="([^"]*)"'))?.[1] ?? null
	return { min: get('min'), max: get('max'), value: get('model-value') }
}

const linksEmits = (emitted) => emitted.filter(([name]) => name === 'links').map(([, p]) => p)

// ---- R14-04 -------------------------------------------------------------------

test('R14-04: before route 19 the browser day; after it linkPolicy.today — prefill, date-picker min/max and the POST follow the owner\'s day', async () => {
	const { b } = dialog()
	assert.equal(b.today.value, '2026-10-13', 'until route 19 answers: the browser\'s local day')
	assert.equal(b.drafts.edit.expiry, '2026-10-20', 'snapshot policy: browser day + 7')

	answers.push(ownerAnswer())
	await b.load()
	assert.deepEqual(calls.map((c) => [c.method, c.url]), [['GET', '/index.php/apps/knorke/api/v1/boards/7/shares']])
	assert.equal(b.today.value, OWNER_TODAY, 'linkPolicy.today of route 19')
	assert.equal(b.drafts.edit.expiry, '2026-10-19', 'prefill = owner today + expireDefaultDays')

	await b.toggleLink('edit')
	assert.equal(b.settingsOpen.edit, true, 'enforced policy: the settings open, nothing is created')
	assert.equal(calls.length, 1)
	assert.equal(b.drafts.edit.expiry, '2026-10-19')
	const pk = picker(await renderSettings(b))
	assert.deepEqual(pk, { min: OWNER_TODAY, max: '2026-10-19', value: '2026-10-19' }, 'date picker: min = owner today, max = owner today + 7')

	b.setDraft('edit', { ...b.drafts.edit, password: 'S3cret!pw' })
	answers.push({ link: { url: URL_EDIT, password: true, expiresOn: '2026-10-19', expiresAt: Date.UTC(2026, 9, 19, 23, 59, 59, 999) } })
	await b.saveLink('edit')
	assert.deepEqual(calls[1], { method: 'POST', url: '/index.php/apps/knorke/api/v1/boards/7/link', body: { password: 'S3cret!pw', expiresAt: '2026-10-19' } }, 'the prefill the server accepts (not 2026-10-20 → expiry_too_far)')
	assert.equal(b.links.value.edit.url, URL_EDIT)
	assert.equal(b.settingsOpen.edit, false)
})

test('R14-04: the client checks use the owner\'s day — today + 8 is expiry_too_far at the field, the owner\'s today is not expiry_past', async () => {
	const { b } = dialog()
	answers.push(ownerAnswer())
	await b.load()
	await b.toggleLink('edit')
	b.setDraft('edit', { ...b.drafts.edit, expiry: '2026-10-20' })
	let html = await renderSettings(b)
	assert.match(html, /data-knorke-error="expiry_too_far"/, 'browser day + 7 is owner day + 8')
	assert.match(html, /The expiry date can be at most 7 days away\./)
	b.setDraft('edit', { ...b.drafts.edit, expiry: OWNER_TODAY })
	html = await renderSettings(b)
	assert.doesNotMatch(html, /data-knorke-error=/, 'the owner\'s today is allowed although the browser is a day ahead')
	b.setDraft('edit', { ...b.drafts.edit, expiry: '2026-10-11' })
	assert.match(await renderSettings(b), /data-knorke-error="expiry_past"/)
})

test('R14-04: settings opened before route 19 — the untouched prefill moves to the owner\'s day, the typed password stays; a picked day stays', async () => {
	const { b } = dialog({ links: { edit: null, vote: null } })
	await b.toggleLink('edit')
	assert.equal(b.settingsOpen.edit, true)
	assert.equal(b.drafts.edit.expiry, '2026-10-20', 'prefill from the browser day')
	b.setDraft('edit', { ...b.drafts.edit, password: 'typed' })
	answers.push(ownerAnswer())
	await b.load()
	assert.deepEqual({ ...b.drafts.edit }, { password: 'typed', expiry: '2026-10-19', removePassword: false })

	const second = dialog().b
	await second.toggleLink('edit')
	second.setDraft('edit', { ...second.drafts.edit, expiry: '2026-10-15' })
	answers.push(ownerAnswer())
	await second.load()
	assert.equal(second.drafts.edit.expiry, '2026-10-15', 'a day the user picked is kept')
})

test('R14-04: the link-policy note and its fix use the owner\'s day', async () => {
	const kept = { url: URL_EDIT, password: true, expiresOn: '2026-10-20', expiresAt: Date.UTC(2026, 9, 20, 23, 59, 59, 999) }
	const { b } = dialog({ links: { edit: kept, vote: null } })
	assert.doesNotMatch(await renderLinks(b), /data-knorke-note="link-policy"/, 'browser day: 2026-10-20 = today + 7 looks fine')
	answers.push(ownerAnswer({ links: { edit: kept, vote: null } }))
	await b.load()
	assert.match(await renderLinks(b), /data-knorke-note="link-policy"/, 'owner day: 2026-10-20 = today + 8 → does not meet the policy')

	const noExpiry = { url: URL_EDIT, password: true, expiresOn: null, expiresAt: null }
	const f = dialog({ links: { edit: noExpiry, vote: null } }).b
	answers.push(ownerAnswer({ links: { edit: noExpiry, vote: null } }))
	await f.load()
	f.fixPolicy('edit')
	assert.equal(f.drafts.edit.expiry, '2026-10-19', 'the fix prefills owner today + 7')
})

test('R14-04: without linkPolicy.today (server before R14-04) and for moderators the browser day stays', async () => {
	const { b } = dialog()
	answers.push(ownerAnswer({ today: null }))
	await b.load()
	assert.equal(b.today.value, '2026-10-13')
	assert.equal(b.drafts.edit.expiry, '2026-10-20')

	const m = dialog({ owner: false, mod: true, linkPolicy: null, links: { edit: { url: URL_EDIT, password: false, expiresOn: null }, vote: null } }).b
	answers.push({ links: { edit: { url: URL_EDIT, password: false, expiresOn: null }, vote: null } })
	await m.load()
	assert.equal(m.today.value, '2026-10-13')
})

test('R14-04: the PUT answer (route 20) carries today as well', async () => {
	const { b } = dialog()
	answers.push(ownerAnswer({ today: null }))
	await b.load()
	assert.equal(b.today.value, '2026-10-13')
	answers.push(ownerAnswer())
	await b.saveShares()
	assert.equal(calls[1].method, 'PUT')
	assert.equal(b.today.value, OWNER_TODAY)
	assert.equal(b.drafts.edit.expiry, '2026-10-19')
})

// ---- R14-07 -------------------------------------------------------------------

test('R14-07: snapshot linksAllowed false → route 19 true lifts the Links view (and tells the board view)', async () => {
	const { b, emitted } = dialog({ linksAllowed: false, linkPolicy: null })
	assert.equal(b.linksAllowed.value, false)
	assert.match(await renderLinks(b), /data-knorke-banner="links_disabled"/, 'disabled view from the snapshot')
	answers.push(ownerAnswer({ linksAllowed: true, policy: {} }))
	await b.load()
	assert.equal(b.linksAllowed.value, true)
	const html = await renderLinks(b)
	assert.doesNotMatch(html, /data-knorke-banner="links_disabled"/, 'lifted')
	assert.match(html, /data-knorke-action="link-toggle"/, 'create is offered again')
	assert.deepEqual(linksEmits(emitted).filter((p) => 'linksAllowed' in p), [{ linksAllowed: true }], 'the board view merges the lift')
})

test('R14-07: route 19 false is not applied — E16\'s create button and 403 path stay; the next route 19 true lifts again', async () => {
	const { b, emitted } = dialog({ linksAllowed: null, linkPolicy: null })
	answers.push(ownerAnswer({ linksAllowed: false, policy: {} }))
	await b.load()
	assert.equal(b.linksAllowed.value, true, 'false from route 19 is not applied')
	assert.deepEqual(linksEmits(emitted).filter((p) => 'linksAllowed' in p), [])
	assert.match(await renderLinks(b), /data-knorke-action="link-toggle"/, 'E16: "Create edit link" still there')

	answers.push(err(403, 'links_disabled'))
	await b.toggleLink('edit')
	assert.deepEqual(calls.at(-1), { method: 'POST', url: '/index.php/apps/knorke/api/v1/boards/7/link', body: {} }, 'the click POSTs (no enforced policy)')
	assert.equal(b.linksAllowed.value, false, 'the 403 links_disabled disables the view')
	assert.match(await renderLinks(b), /data-knorke-banner="links_disabled"/)
	assert.deepEqual(linksEmits(emitted).filter((p) => 'linksAllowed' in p), [{ linksAllowed: false }])

	answers.push(ownerAnswer({ linksAllowed: true, policy: {} }))
	await b.load()
	assert.equal(b.linksAllowed.value, true, 'the admin allowed links again: route 19 true lifts')
	assert.deepEqual(linksEmits(emitted).filter((p) => 'linksAllowed' in p), [{ linksAllowed: false }, { linksAllowed: true }])
})

test('R14-07: an answer whose request started before the last 403 links_disabled lifts nothing; a later PUT answer does', async () => {
	const { b } = dialog({ linksAllowed: null, linkPolicy: null })
	const slow = deferred()
	answers.push(slow.answer)
	const loading = b.load()
	answers.push(err(403, 'links_disabled'))
	await b.toggleLink('edit')
	assert.equal(b.linksAllowed.value, false)
	slow.resolve(ownerAnswer({ linksAllowed: true, policy: {} }))
	await loading
	assert.equal(b.linksAllowed.value, false, 'the older route-19 answer does not undo the newer 403')

	answers.push(ownerAnswer({ linksAllowed: true, policy: {} }))
	await b.saveShares()
	assert.equal(calls.at(-1).method, 'PUT')
	assert.equal(b.linksAllowed.value, true, 'the PUT answer (route 20, same form) started after the 403 and lifts')
})

test('R14-07: a moderator\'s answer ({links}) changes nothing; moderators never see the disabled view', async () => {
	const { b, emitted } = dialog({ owner: false, mod: true, linksAllowed: null, linkPolicy: null, links: null })
	answers.push({ links: { edit: { url: URL_EDIT, password: false, expiresOn: null }, vote: null } })
	await b.load()
	assert.equal(b.linksAllowed.value, true)
	assert.deepEqual(linksEmits(emitted).filter((p) => 'linksAllowed' in p), [])
	assert.doesNotMatch(await renderLinks(b), /data-knorke-banner="links_disabled"/)
})

// ---- R14-12 -------------------------------------------------------------------

test('R14-12 (stage 3, FEATURES.voting): a board-list row with access vote says "Can vote" (hook vote); the other levels keep their labels', async () => {
	const now = Date.now()
	const html = await renderToString(createSSRApp(BoardList, {
		filter: 'all',
		boards: [
			{ id: 1, title: 'Own', role: 'owner', source: 'own', mod: true, updatedAt: now },
			{ id: 2, title: 'Vote share', role: 'vote', source: 'share', mod: false, owner: { name: 'Bob' }, updatedAt: now },
			{ id: 3, title: 'Vote link', role: 'vote', source: 'link', viaLink: true, mod: false, owner: { name: 'Bob' }, updatedAt: now },
			{ id: 4, title: 'Facilitate', role: 'edit', source: 'share', mod: true, owner: { name: 'Bob' }, updatedAt: now },
			{ id: 5, title: 'Edit', role: 'edit', source: 'share', mod: false, owner: { name: 'Bob' }, updatedAt: now },
			{ id: 6, title: 'View', role: 'view', source: 'share', mod: false, owner: { name: 'Bob' }, updatedAt: now },
		],
	}))
	const rows = Object.fromEntries([...html.matchAll(/<li [^>]*data-knorke-board="(\d+)"[^>]*data-knorke-board-access="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g)]
		.map(([, id, access, inner]) => [id, { access, meta: inner.match(/knorke-list__meta">([\s\S]*?)<\/span>/)?.[1].replace(/<!--[[\]]?-->/g, '') ?? '' }]))
	assert.equal(rows[2].access, 'vote', '[data-knorke-board-access=vote] stays')
	assert.match(rows[2].meta, /Shared with you · Can vote · /)
	assert.equal(rows[3].access, 'vote')
	assert.match(rows[3].meta, /Joined through a link · Can vote · /)
	assert.match(rows[4].meta, /Can facilitate/)
	assert.equal(rows[4].access, 'moderate')
	assert.match(rows[5].meta, /Can edit/)
	assert.match(rows[6].meta, /Can view/)
	assert.equal(rows[1].access, 'owner')
	assert.doesNotMatch(rows[1].meta, /Can /, 'own boards name no access level')
})

test('R14-12 (stage 3): the owner\'s share dialog shows a stored vote row as "Can vote" and offers "Can vote" (FEATURES.voting)', async () => {
	const shares = [{ kind: 'group', id: 'workshop', name: 'Workshop', role: 'vote', available: true }]
	const { bindings } = setupOf(SharePeople, { boardId: BOARD, shares, stored: shares, policy: { sharing: true, groups: true, teams: true, groupMembersOnly: false }, loaded: true, busy: false, error: null })
	assert.deepEqual(bindings.roleOption('vote'), { id: 'vote', role: 'vote', label: 'Can vote' }, 'current value of the row')
	assert.deepEqual(bindings.roleOptions.value.map((o) => o.label), ['Can facilitate', 'Can edit', 'Can vote', 'Can view'], '"Can vote" is offered from stage 3 on')
	const html = await renderToString(createSSRApp(SharePeople, { boardId: BOARD, shares, stored: shares, policy: { sharing: true, groups: true, teams: true, groupMembersOnly: false }, loaded: true, busy: false, error: null }))
	assert.match(html, /data-knorke-share-item="group:workshop"[^>]*data-knorke-share-role="vote"/)
})

// ---- job 079: accounts that cannot open Knorke ----------------------------------

const PEOPLE_POLICY = Object.freeze({ sharing: true, groups: true, teams: true, groupMembersOnly: false })

test('job 079 AK7: a row with appAccess false says "Cannot open Knorke" ([data-knorke-note=app-access]); not grey; other rows say nothing', async () => {
	const shares = [
		{ kind: 'user', id: 'bob', name: 'Bob', role: 'edit', available: true },
		{ kind: 'user', id: 'carol', name: 'Carol', role: 'edit', available: true, appAccess: false },
	]
	const html = await renderToString(createSSRApp(SharePeople, { boardId: BOARD, shares, stored: shares, policy: PEOPLE_POLICY, loaded: true, busy: false, error: null }))
	const rows = Object.fromEntries([...html.matchAll(/<li ([^>]*data-knorke-share-item="([^"]+)"[^>]*)>([\s\S]*?)<\/li>/g)].map(([, open, key, inner]) => [key, { open, inner }]))
	assert.deepEqual(Object.keys(rows), ['user:bob', 'user:carol'])
	const notes = [...rows['user:carol'].inner.matchAll(/<span[^>]*data-knorke-note="app-access"[^>]*>([\s\S]*?)<\/span>/g)]
	assert.equal(notes.length, 1)
	assert.equal(notes[0][1].trim(), 'Cannot open Knorke')
	assert.doesNotMatch(rows['user:bob'].inner, /data-knorke-note="app-access"/)
	assert.doesNotMatch(rows['user:carol'].open, /knorke-people__row--off/, 'only a hint: not grey like an unavailable share')
})

test('job 079 AK8: the search option shows the hint when its appAccess is false; adding it keeps appAccess false in the draft', async () => {
	// (a) template of the search field's #option slot (NcSelect is a stub in Node, its slot is not rendered)
	const src = readFileSync(new URL('../../../src/components/SharePeople.vue', import.meta.url), 'utf8')
	const ast = parse(src.match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
	const all = (node, pred, out = []) => {
		for (const c of node.children ?? []) {
			if (c.type === 1 && pred(c)) {
				out.push(c)
			}
			all(c, pred, out)
		}
		return out
	}
	const attr = (el, name) => el.props.find((p) => p.type === 6 && p.name === name)?.value?.content ?? null
	const search = all(ast, (e) => e.tag === 'NcSelect' && attr(e, 'data-knorke-field') === 'sharee-search')
	assert.equal(search.length, 1)
	const slot = all(search[0], (e) => e.tag === 'template' && e.props.some((p) => p.type === 7 && p.name === 'slot' && p.arg?.content === 'option'))
	assert.equal(slot.length, 1)
	const notes = all(slot[0], (e) => attr(e, 'data-knorke-note') === 'app-access')
	assert.equal(notes.length, 1)
	const vIf = notes[0].props.find((p) => p.type === 7 && p.name === 'if')
	assert.match(vIf?.exp?.content ?? '', /\bo\.appAccess === false\b/)
	assert.match(src, /data-knorke-note="app-access">\{\{ t\('knorke', 'Cannot open Knorke'\) \}\}/)
	// (b) picking that option adds a row with the mark
	const { bindings, emitted } = setupOf(SharePeople, { boardId: BOARD, shares: [], stored: [], policy: PEOPLE_POLICY, loaded: true, busy: false, error: null })
	await bindings.add({ id: 'user:carol', kind: 'user', shareId: 'carol', displayName: 'Carol', subname: 'carol', isNoUser: false, appAccess: false })
	const updates = emitted.filter(([name]) => name === 'update:shares')
	assert.equal(updates.length, 1)
	assert.deepEqual(updates[0][1], [{ kind: 'user', id: 'carol', name: 'Carol', role: 'edit', available: true, appAccess: false }])
})
