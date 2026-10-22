/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * components/share.js (SPEC-M1 §4.10, §4.11, §6.6, §6.11, stage 2) and the
 * structure of the share dialog family (parsed templates, R13 CLI-01, -03,
 * -05, -06, -07, -10, -12; R14-04, -07, -12; job 079: appAccess). The
 * behaviour of the components themselves (compiled and run in Node) is in
 * shareDialog.test.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import {
	DEFAULT_SHARE_ROLE, FILTERS, PASSWORD_LENGTH, SEARCH_DEBOUNCE_MS, SHARE_ROLES, accessLabel, addDays, addSharee, boardAccess, dateOfDay, dayOf,
	errorText, expiryProblem, filterBoards, generatePassword, initialExpiry, isDay, isTightening, linkDraft, linkMeetsPolicy,
	linkSaveBody, linksAllowedAfter, lockoutText, normalizePolicy, normalizeShares, removeShare, reprefill, roleChoices, roleLabel, sameShares, saveDisabled,
	setShareRole, settingsFirst, shareKey, shareeOptions, sourceLabel, sourceOf, subnameOf, textOf, todayOf, wireShares,
} from '../../../src/components/share.js'
import { HttpError } from '../../../src/sync/http.js'
import { FEATURES } from '../../../src/util/features.js'

const err = (status, code, body = {}, message = '') => new HttpError(status, code, message, null, true, { error: code, ...body })
const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

// ---- shares ----------------------------------------------------------------

test('share roles: order, labels (§6.11), "Can vote" offered only with voting (R13)', () => {
	assert.deepEqual(SHARE_ROLES, ['moderate', 'edit', 'vote', 'view'])
	assert.deepEqual(SHARE_ROLES.map(roleLabel), ['Can facilitate', 'Can edit', 'Can vote', 'Can view'])
	assert.equal(roleLabel('owner'), '')
	assert.deepEqual(roleChoices(false), ['moderate', 'edit', 'view'])
	assert.deepEqual(roleChoices(true), ['moderate', 'edit', 'vote', 'view'])
	assert.deepEqual(roleChoices(), ['moderate', 'edit', 'vote', 'view'], 'default FEATURES.voting (true from stage 3 on)')
	assert.equal(SEARCH_DEBOUNCE_MS, 300)
})

test('draft: a new recipient joins as edit (R13), never twice; role change and removal by key', () => {
	assert.equal(DEFAULT_SHARE_ROLE, 'edit')
	let d = []
	let r = addSharee(d, { kind: 'user', id: 'bob', name: 'Bob Berg', sub: 'bob@example.org' })
	assert.equal(r.added, true)
	assert.equal(r.key, 'user:bob')
	d = r.draft
	assert.deepEqual(d, [{ kind: 'user', id: 'bob', name: 'Bob Berg', role: 'edit', available: true }])
	r = addSharee(d, { kind: 'user', id: 'bob', name: 'Bob' })
	assert.equal(r.added, false, 'already in the list')
	assert.equal(r.draft, d)
	d = addSharee(d, { kind: 'group', id: 'knorke-e2e' }).draft
	assert.equal(d[1].name, 'knorke-e2e', 'name falls back to the id')
	assert.equal(addSharee(d, { kind: 'circle', id: 'x' }).added, false, 'unknown kind')
	assert.equal(addSharee(d, { kind: 'user', id: '' }).added, false)
	d = setShareRole(d, 'user:bob', 'moderate')
	assert.equal(d[0].role, 'moderate')
	assert.equal(setShareRole(d, 'user:bob', 'owner')[0].role, 'moderate', 'owner is no share role')
	d = removeShare(d, 'group:knorke-e2e')
	assert.deepEqual(d.map(shareKey), ['user:bob'])
})

test('a stored vote row keeps its role through the dialog and goes out unchanged (R13, CLI-06)', () => {
	const stored = normalizeShares([
		{ kind: 'user', id: 'bob', name: 'Bob Berg', role: 'edit', available: true },
		{ kind: 'group', id: 'knorke-e2e', name: 'Knorke E2E', role: 'vote', available: true },
	])
	// the owner adds carol and touches only bob
	let d = addSharee(stored, { kind: 'user', id: 'carol', name: 'Carol Clausen' }).draft
	d = setShareRole(d, 'user:bob', 'view')
	assert.deepEqual(wireShares(d), [
		{ kind: 'user', id: 'bob', role: 'view' },
		{ kind: 'group', id: 'knorke-e2e', role: 'vote' },
		{ kind: 'user', id: 'carol', role: 'edit' },
	])
})

test('normalizeShares: bad rows dropped, duplicates once, unknown role → view, available false kept', () => {
	const rows = normalizeShares([
		null,
		{ kind: 'user', id: 'bob', name: 'Bob', role: 'moderate', available: true },
		{ kind: 'user', id: 'bob', name: 'Bob again', role: 'edit' },
		{ kind: 'team', id: 'aBcD', name: '', role: 'nonsense', available: false },
		{ kind: 'email', id: 'x@y', role: 'edit' },
		{ kind: 'group', id: 7, role: 'edit' },
	])
	assert.deepEqual(rows, [
		{ kind: 'user', id: 'bob', name: 'Bob', role: 'moderate', available: true },
		{ kind: 'team', id: 'aBcD', name: 'aBcD', role: 'view', available: false },
	])
	assert.deepEqual(normalizeShares(undefined), [])
})

test('sameShares: order does not matter, roles do', () => {
	const a = [{ kind: 'user', id: 'bob', role: 'edit' }, { kind: 'group', id: 'g', role: 'view' }]
	assert.equal(sameShares(a, [...a].reverse()), true)
	assert.equal(sameShares(a, [a[0], { ...a[1], role: 'vote' }]), false)
	assert.equal(sameShares(a, [a[0]]), false)
	assert.equal(sameShares([], []), true)
})

test('search options (R13, CLI-12): subname = sub (user), id (group), "" (team); key per kind, duplicates once', () => {
	assert.equal(subnameOf({ kind: 'user', id: 'bob', sub: 'bob@example.org' }), 'bob@example.org')
	assert.equal(subnameOf({ kind: 'user', id: 'bob' }), '')
	assert.equal(subnameOf({ kind: 'group', id: 'knorke-e2e' }), 'knorke-e2e')
	assert.equal(subnameOf({ kind: 'team', id: 'aBcD', sub: 'x' }), '')
	const opts = shareeOptions([
		{ kind: 'user', id: 'bob', name: 'Bob Berg', sub: 'bob@example.org' },
		{ kind: 'group', id: 'knorke-e2e', name: 'Knorke E2E' },
		{ kind: 'team', id: 'aBcD', name: 'Team Nord' },
		{ kind: 'team', id: 'aBcD', name: 'Team Nord' },
		{ kind: 'circle', id: 'x', name: 'raw circle' },
		{ kind: 'user', id: '', name: 'no id' },
	], { group: 'G', team: 'T' })
	assert.deepEqual(opts.map((o) => [o.id, o.displayName, o.subname, o.isNoUser]), [
		['user:bob', 'Bob Berg', 'bob@example.org', false],
		['group:knorke-e2e', 'Knorke E2E', 'knorke-e2e', true],
		['team:aBcD', 'Team Nord', '', true],
	])
	assert.equal(opts[0].user, 'bob')
	assert.equal(opts[1].iconSvg, 'G')
	assert.equal(opts[2].shareId, 'aBcD')
	// the local filter of NcSelectUsers (`${label} ${subname}` contains the term) keeps every hit
	for (const [o, term] of [[opts[0], 'example'], [opts[1], 'knorke-e2e'], [opts[2], 'Team']]) {
		assert.ok(`${o.displayName} ${o.subname}`.toLocaleLowerCase().includes(term.toLocaleLowerCase()), o.id)
	}
})

test('job 079 AK6: appAccess false travels from hit to option to draft row and from the answer to the row; never into the PUT body or sameShares', () => {
	const opts = shareeOptions([
		{ kind: 'user', id: 'carol', name: 'Carol', sub: 'carol', appAccess: false },
		{ kind: 'user', id: 'bob', name: 'Bob', sub: 'bob' },
	])
	assert.equal(opts[0].appAccess, false)
	assert.ok(!('appAccess' in opts[1]), 'no key without the mark')
	const rows = normalizeShares([
		{ kind: 'user', id: 'carol', name: 'Carol', role: 'edit', available: true, appAccess: false },
		{ kind: 'user', id: 'dan', name: 'Dan', role: 'edit', available: true, appAccess: true },
		{ kind: 'user', id: 'eve', name: 'Eve', role: 'edit', available: true, appAccess: 'false' },
		{ kind: 'user', id: 'bob', name: 'Bob', role: 'edit', available: true },
	])
	assert.deepEqual(rows[0], { kind: 'user', id: 'carol', name: 'Carol', role: 'edit', available: true, appAccess: false })
	for (const r of rows.slice(1)) {
		assert.ok(!('appAccess' in r), r.id + ': only a strict false is kept')
	}
	const draft = addSharee([], { kind: 'user', id: 'carol', name: 'Carol', appAccess: false }).draft
	assert.deepEqual(draft, [{ kind: 'user', id: 'carol', name: 'Carol', role: 'edit', available: true, appAccess: false }])
	assert.ok(!('appAccess' in addSharee([], { kind: 'user', id: 'bob', name: 'Bob', appAccess: undefined }).draft[0]), 'no mark: the row as before')
	assert.deepEqual(wireShares(draft), [{ kind: 'user', id: 'carol', role: 'edit' }], 'the server answers any other key with 400 bad_request')
	const { appAccess, ...plain } = draft[0]
	assert.equal(appAccess, false)
	assert.equal(sameShares(draft, [plain]), true, 'appAccess is no change')
})

test('errorText (§6.11): every share code with its text; recipient_not_found names the row at `at`', () => {
	const sent = [{ kind: 'user', id: 'bob', name: 'Bob Berg' }, { kind: 'user', id: 'knorke-nope-1', name: 'knorke-nope-1' }]
	const cases = [
		[err(403, 'sharing_disabled'), 'Sharing is turned off for your account.'],
		[err(400, 'group_sharing_disabled', { at: 1 }), 'Sharing with groups is turned off.'],
		[err(400, 'teams_unavailable', { at: 0 }), 'Teams are not available.'],
		[err(400, 'group_members_only', { at: 0 }), 'You can only share with members of your groups.'],
		[err(400, 'recipient_not_found', { at: 1 }), '“knorke-nope-1” was not found.'],
		[err(400, 'self_share', { at: 0 }), 'You can\'t share with yourself.'],
		[err(429, 'slow_down', { retryMs: 10000 }), 'Too many requests. Please wait a moment.'],
	]
	for (const [e, text] of cases) {
		const x = errorText(e, { shares: sent })
		assert.equal(x.code, e.code)
		assert.equal(x.text, text, e.code)
	}
	assert.equal(errorText(err(400, 'group_sharing_disabled', { at: 1 })).at, 1)
	assert.equal(errorText(err(403, 'sharing_disabled')).at, null)
	assert.equal(errorText(new HttpError(0, 'network')).text, 'Sharing could not be changed. Please try again.')
	assert.equal(errorText(new Error('x')).code, 'network')
})

test('errorText (R13, CLI-11): max of too_many_shares and too_many_new_shares comes from the body', () => {
	assert.equal(errorText(err(400, 'too_many_shares', { at: 200, max: 200 })).text, 'This board can\'t be shared with more than 200 people, groups or teams.')
	assert.equal(errorText(err(400, 'too_many_shares', { at: 0, max: 7 })).text, 'This board can\'t be shared with more than 7 people, groups or teams.', 'not hard-coded')
	assert.equal(errorText(err(400, 'too_many_new_shares', { at: 20, max: 20 })).text, 'Add at most 20 people, groups or teams at once.')
	assert.equal(errorText(err(400, 'too_many_new_shares', { at: 20, max: 3 })).text, 'Add at most 3 people, groups or teams at once.')
	assert.equal(errorText(err(400, 'too_many_shares', {})).text, 'This board can\'t be shared with more than 200 people, groups or teams.', 'fallback without max')
})

test('errorText: link codes with their field (password/expiry); password_policy shows the server hint', () => {
	const x = (e) => { const r = errorText(e); return [r.code, r.text, r.field] }
	assert.deepEqual(x(err(400, 'password_enforced')), ['password_enforced', 'A password is required by your administrator.', 'password'])
	assert.deepEqual(x(err(400, 'password_policy', {}, 'Password needs to be at least 10 characters long.')), ['password_policy', 'Password needs to be at least 10 characters long.', 'password'])
	assert.equal(errorText(err(400, 'password_policy')).text, 'This password does not meet the password policy.')
	assert.deepEqual(x(err(400, 'expiry_required')), ['expiry_required', 'An expiry date is required.', 'expiry'])
	assert.deepEqual(x(err(400, 'expiry_too_far', { maxDays: 7 })), ['expiry_too_far', 'The expiry date can be at most 7 days away.', 'expiry'])
	assert.deepEqual(x(err(400, 'expiry_past')), ['expiry_past', 'The expiry date must not be in the past.', 'expiry'])
	assert.deepEqual(x(err(403, 'sharing_disabled')), ['sharing_disabled', 'Sharing is turned off for your account.', null])
	assert.deepEqual(textOf('expiry_too_far', { maxDays: 30 }).text, 'The expiry date can be at most 30 days away.')
})

test('lock-out (R13, CLI-08): slow_down with reason password → "Too many wrong passwords…" with ceil(retryMs / 60000) minutes', () => {
	const lock = (ms) => err(429, 'slow_down', { retryMs: ms, reason: 'password' })
	assert.equal(lockoutText(lock(540000)), 'Too many wrong passwords. Try again in 9 minutes.')
	assert.equal(lockoutText(lock(540001)), 'Too many wrong passwords. Try again in 10 minutes.')
	assert.equal(lockoutText(lock(1000)), 'Too many wrong passwords. Try again in 1 minute.')
	assert.equal(lockoutText(lock(0)), 'Too many wrong passwords. Try again in 1 minute.', 'at least one minute')
	const x = errorText(lock(120000))
	assert.deepEqual([x.code, x.text, x.field], ['slow_down', 'Too many wrong passwords. Try again in 2 minutes.', 'password'])
	assert.equal(errorText(err(429, 'slow_down', { retryMs: 120000 })).text, 'Too many requests. Please wait a moment.', 'other slow_down: the general text')
})

// ---- links -----------------------------------------------------------------

test('calendar days: dayOf (local), isDay, addDays across months/years/leap day, dateOfDay is local midnight', () => {
	assert.equal(dayOf(new Date(2026, 9, 12, 23, 59)), '2026-10-12')
	assert.equal(dayOf(new Date(2026, 0, 1, 0, 0)), '2026-01-01')
	assert.equal(isDay('2026-02-29'), false)
	assert.equal(isDay('2028-02-29'), true)
	assert.equal(isDay('2026-13-01'), false)
	assert.equal(isDay('2026-1-1'), false)
	assert.equal(isDay(''), false)
	assert.equal(isDay(null), false)
	assert.equal(addDays('2026-10-12', 7), '2026-10-19')
	assert.equal(addDays('2026-12-30', 3), '2027-01-02')
	assert.equal(addDays('2028-02-28', 1), '2028-02-29')
	assert.equal(addDays('2026-03-01', -1), '2026-02-28')
	assert.equal(addDays('2026-03-28', 2), '2026-03-30', 'no DST shift (calendar arithmetic)')
	const d = dateOfDay('2026-10-26')
	assert.equal(d.getFullYear(), 2026)
	assert.equal(d.getMonth(), 9)
	assert.equal(d.getDate(), 26)
	assert.equal(d.getHours(), 0)
	assert.equal(dayOf(d), '2026-10-26')
	assert.equal(dateOfDay(''), null)
})

test('linkPolicy (R13 §4.10.1): normalized; settings first under enforcement; prefill only with expireDefaultDays', () => {
	assert.deepEqual(normalizePolicy(null), { passwordEnforced: false, expireDefaultDays: null, expireEnforced: false, expireMaxDays: null })
	assert.deepEqual(normalizePolicy({ passwordEnforced: true, expireDefaultDays: 7, expireEnforced: true, expireMaxDays: 7 }), { passwordEnforced: true, expireDefaultDays: 7, expireEnforced: true, expireMaxDays: 7 })
	assert.equal(normalizePolicy({ expireDefaultDays: 0 }).expireDefaultDays, null)
	assert.equal(settingsFirst(null), false)
	assert.equal(settingsFirst({ passwordEnforced: true }), true)
	assert.equal(settingsFirst({ expireEnforced: true, expireDefaultDays: 7, expireMaxDays: 7 }), true)
	assert.equal(settingsFirst({ expireDefaultDays: 7 }), false, 'a default alone does not stop the M0 one-click create')
	assert.equal(initialExpiry({ expireDefaultDays: 7 }, '2026-10-12'), '2026-10-19')
	assert.equal(initialExpiry({ expireEnforced: true }, '2026-10-12'), '')
	assert.deepEqual(linkDraft(null, { expireDefaultDays: 3 }, '2026-10-12'), { password: '', expiry: '2026-10-15', removePassword: false })
	assert.deepEqual(linkDraft({ password: true, expiresOn: '2026-11-01' }, { expireDefaultDays: 3 }, '2026-10-12'), { password: '', expiry: '2026-11-01', removePassword: false })
})

test('expiryProblem: required, past, too far (client check of §4.11.2)', () => {
	const p = { expireEnforced: true, expireDefaultDays: 7, expireMaxDays: 7 }
	assert.equal(expiryProblem('', p, '2026-10-12'), 'expiry_required')
	assert.equal(expiryProblem('', {}, '2026-10-12'), null)
	assert.equal(expiryProblem('2026-10-11', {}, '2026-10-12'), 'expiry_past')
	assert.equal(expiryProblem('2026-10-12', p, '2026-10-12'), null, 'today is fine')
	assert.equal(expiryProblem('2026-10-19', p, '2026-10-12'), null, 'today + max is fine')
	assert.equal(expiryProblem('2026-10-20', p, '2026-10-12'), 'expiry_too_far', 'E30: today + max + 1')
	assert.equal(expiryProblem('2030-01-01', { expireDefaultDays: 7 }, '2026-10-12'), null, 'no maximum without enforcement')
})

test('linkMeetsPolicy: password and expiry enforced later (not retroactive) → the link-policy note', () => {
	const today = '2026-10-12'
	assert.equal(linkMeetsPolicy(null, { passwordEnforced: true }, today), true)
	assert.equal(linkMeetsPolicy({ password: false }, {}, today), true)
	assert.equal(linkMeetsPolicy({ password: false }, { passwordEnforced: true }, today), false)
	assert.equal(linkMeetsPolicy({ password: true }, { passwordEnforced: true }, today), true)
	const p = { expireEnforced: true, expireMaxDays: 7 }
	assert.equal(linkMeetsPolicy({ password: false, expiresOn: null }, p, today), false)
	assert.equal(linkMeetsPolicy({ password: false, expiresOn: '2026-10-19' }, p, today), true)
	assert.equal(linkMeetsPolicy({ password: false, expiresOn: '2026-12-31' }, p, today), false)
})

test('linkSaveBody (§4.11.2, R13): password only when typed (or removed), expiresAt only when the day changed', () => {
	const link = { password: true, expiresOn: '2026-10-20' }
	assert.deepEqual(linkSaveBody(link, { password: '', expiry: '2026-10-20', removePassword: false }), {})
	assert.deepEqual(linkSaveBody(link, { password: 's3cret', expiry: '2026-10-20', removePassword: false }), { password: 's3cret' })
	assert.deepEqual(linkSaveBody(link, { password: '', expiry: '2026-10-15', removePassword: false }), { expiresAt: '2026-10-15' })
	assert.deepEqual(linkSaveBody(link, { password: '', expiry: '', removePassword: false }), { expiresAt: null }, 'cleared = remove')
	assert.deepEqual(linkSaveBody(link, { password: '', expiry: '2026-10-20', removePassword: true }), { password: null })
	assert.deepEqual(linkSaveBody({ password: false, expiresOn: null }, { password: '', expiry: '', removePassword: true }), {}, 'nothing to remove')
	assert.deepEqual(linkSaveBody(null, { password: 'pw', expiry: '2026-10-19', removePassword: false }), { password: 'pw', expiresAt: '2026-10-19' }, 'create')
	assert.deepEqual(linkSaveBody(null, { password: '', expiry: '', removePassword: false }), {}, 'create without settings')
	assert.deepEqual(linkSaveBody(null, { password: '', expiry: 'garbage', removePassword: false }), {})
})

test('saveDisabled (R13, CLI-07): required field empty, or nothing changed on an existing link', () => {
	const both = { passwordEnforced: true, expireEnforced: true, expireDefaultDays: 7, expireMaxDays: 7 }
	assert.equal(saveDisabled(null, { password: '', expiry: '2026-10-19' }, both), true, 'password missing')
	assert.equal(saveDisabled(null, { password: 'pw', expiry: '' }, both), true, 'expiry missing')
	assert.equal(saveDisabled(null, { password: 'pw', expiry: '2026-10-19' }, both), false)
	assert.equal(saveDisabled(null, { password: '', expiry: '' }, {}), false, 'create without enforcement')
	const link = { password: true, expiresOn: '2026-10-19' }
	assert.equal(saveDisabled(link, { password: '', expiry: '2026-10-19' }, both), true, 'unchanged')
	assert.equal(saveDisabled(link, { password: 'new', expiry: '2026-10-19' }, both), false)
	assert.equal(saveDisabled(link, { password: '', expiry: '2026-10-19', removePassword: true }, both), true, 'removing an enforced password')
	assert.equal(saveDisabled({ password: false, expiresOn: null }, { password: '', expiry: '' }, { passwordEnforced: true }), true, 'a non-conforming link needs the password typed')
})

test('isTightening: a typed password on an existing link asks first; creating or changing the expiry does not', () => {
	assert.equal(isTightening({ password: false }, { password: 'pw' }), true)
	assert.equal(isTightening({ password: true }, { password: 'other' }), true)
	assert.equal(isTightening(null, { password: 'pw' }), false)
	assert.equal(isTightening({ password: true }, { password: null }), false, 'removing loosens')
	assert.equal(isTightening({ password: false }, { expiresAt: '2026-10-13' }), false)
})

test('generatePassword: 16 characters, at least one upper, lower, digit, special; no ambiguous characters; no modulo bias source', () => {
	for (let i = 0; i < 300; i++) {
		const pw = generatePassword()
		assert.equal(pw.length, PASSWORD_LENGTH)
		assert.match(pw, /[A-Z]/)
		assert.match(pw, /[a-z]/)
		assert.match(pw, /[0-9]/)
		assert.match(pw, /[!#$%&*+\-=?@_]/)
		assert.doesNotMatch(pw, /[IlO01]/)
	}
	// deterministic source: a fill that never yields a digit is retried until one comes
	let round = 0
	let x = 2463534242
	const fill = (a) => {
		round++
		for (let i = 0; i < a.length; i++) {
			// xorshift32 from the third round on; before: all zero (= "AAAA…", no digit)
			x ^= x << 13
			x ^= x >>> 17
			x ^= x << 5
			a[i] = round < 3 ? 0 : x >>> 0
		}
		return a
	}
	const pw = generatePassword(fill)
	assert.ok(round >= 3, 'all-"A" rounds are rejected')
	assert.equal(pw.length, 16)
	assert.throws(() => generatePassword((a) => a.fill(0)), /No random source/)
	assert.doesNotMatch(read('src/components/share.js'), /password_policy\/api|ocs\/v2\.php/, 'no password_policy OCS call')
})

test('R14-04: todayOf — linkPolicy.today of route 19/20 (the owner\'s day) wins over the browser day; without a valid one the fallback stays', () => {
	assert.equal(todayOf({ passwordEnforced: false, today: '2026-10-12' }, '2026-10-13'), '2026-10-12', 'owner behind the browser')
	assert.equal(todayOf({ today: '2026-10-14' }, '2026-10-13'), '2026-10-14', 'owner ahead of the browser')
	assert.equal(todayOf({ passwordEnforced: true, expireEnforced: false }, '2026-10-13'), '2026-10-13', 'the snapshot\'s linkPolicy has no today (§4.4)')
	assert.equal(todayOf(null, '2026-10-13'), '2026-10-13')
	assert.equal(todayOf(undefined, '2026-10-13'), '2026-10-13')
	for (const bad of ['2026-02-30', '2026-10-12T00:00:00Z', '12.10.2026', '', 20261012, null, {}]) {
		assert.equal(todayOf({ today: bad }, '2026-10-13'), '2026-10-13', 'invalid today: ' + JSON.stringify(bad))
	}
	assert.equal('today' in normalizePolicy({ today: '2026-10-12' }), false, 'the normalized policy stays as before; the dialog keeps today apart')
})

test('R14-04: around midnight the owner\'s day decides the prefill, the date-picker bound and the client checks', () => {
	// browser already on 2026-10-13 (00:30 CEST), the owner's zone (UTC) still on 2026-10-12; 7 days enforced
	const p = { passwordEnforced: false, expireDefaultDays: 7, expireEnforced: true, expireMaxDays: 7 }
	const local = '2026-10-13'
	const owner = todayOf({ ...p, today: '2026-10-12' }, local)
	assert.equal(initialExpiry(p, owner), '2026-10-19', 'prefill = owner today + 7 = the server\'s maximum')
	assert.equal(expiryProblem(initialExpiry(p, local), p, owner), 'expiry_too_far', 'a prefill from the browser day would be one day too far for the server')
	assert.equal(addDays(owner, p.expireMaxDays), '2026-10-19', 'date-picker max')
	assert.equal(expiryProblem('2026-10-12', p, owner), null, 'the owner\'s today is allowed (date-picker min)')
	assert.equal(expiryProblem('2026-10-12', p, local), 'expiry_past', '… which the browser day would refuse')
	assert.equal(linkMeetsPolicy({ password: false, expiresOn: '2026-10-20' }, p, owner), false, 'link-policy note by the owner\'s day')
	assert.equal(linkMeetsPolicy({ password: false, expiresOn: '2026-10-20' }, p, local), true)
	// the other way round: the browser is behind the owner
	const ahead = todayOf({ today: '2026-10-14' }, local)
	assert.equal(expiryProblem('2026-10-13', p, ahead), 'expiry_past')
	assert.equal(initialExpiry(p, ahead), '2026-10-21')
	assert.equal(expiryProblem('2026-10-21', p, ahead), null)
})

test('R14-04: reprefill — an untouched prefill moves to the new today/policy; a typed password stays, a picked or cleared day stays', () => {
	const p = { expireDefaultDays: 7, expireEnforced: true, expireMaxDays: 7 }
	const before = { policy: p, today: '2026-10-13' }
	const after = { policy: p, today: '2026-10-12' }
	assert.deepEqual(reprefill({ password: '', expiry: '2026-10-20', removePassword: false }, before, after), { password: '', expiry: '2026-10-19', removePassword: false })
	assert.deepEqual(reprefill({ password: 'pw', expiry: '2026-10-20', removePassword: false }, before, after), { password: 'pw', expiry: '2026-10-19', removePassword: false }, 'the typed password stays')
	const picked = { password: '', expiry: '2026-10-15', removePassword: false }
	assert.equal(reprefill(picked, before, after), picked, 'a picked day stays')
	const cleared = { password: '', expiry: '', removePassword: false }
	assert.equal(reprefill(cleared, before, after), cleared, 'a cleared prefill stays cleared')
	assert.equal(reprefill({ password: '', expiry: '', removePassword: false }, { policy: null, today: '2026-10-13' }, after).expiry, '2026-10-19', 'no default so far (snapshot without policy) → the default now')
	assert.equal(reprefill({ password: '', expiry: '2026-10-20', removePassword: false }, before, { policy: {}, today: '2026-10-12' }).expiry, '', 'the default was dropped → the untouched prefill goes')
	const same = { password: '', expiry: '2026-10-19', removePassword: false }
	assert.equal(reprefill(same, after, after), same, 'nothing changed: the same object')
	assert.deepEqual(reprefill(null, before, after), linkDraft(null, p, '2026-10-12'), 'no draft yet')
})

test('R14-07: linksAllowedAfter — of route 19/20 only true is applied (lifts a disabled view); false never; an answer older than the last 403 lifts nothing', () => {
	assert.equal(linksAllowedAfter(false, { linksAllowed: true }), true, 'snapshot false or after a 403: route 19 true lifts')
	assert.equal(linksAllowedAfter(true, { linksAllowed: false }), true, 'route 19 false is not applied (E16: the next action takes the 403 path)')
	assert.equal(linksAllowedAfter(false, { linksAllowed: false }), false)
	assert.equal(linksAllowedAfter(true, { linksAllowed: true }), true)
	assert.equal(linksAllowedAfter(false, { links: { edit: null, vote: null } }), false, 'a moderator\'s answer carries no linksAllowed')
	assert.equal(linksAllowedAfter(false, { linksAllowed: true }, true), false, 'the request started before the last 403 links_disabled')
	assert.equal(linksAllowedAfter(true, { linksAllowed: false }, true), true)
	for (const v of ['true', 1, 'yes', null, undefined]) {
		assert.equal(linksAllowedAfter(false, { linksAllowed: v }), false, 'only the boolean true: ' + String(v))
	}
	assert.equal(linksAllowedAfter(false, null), false)
	assert.equal(linksAllowedAfter(false, 'linksAllowed'), false)
})

test('R14-04/R14-07: ShareDialog keeps today as state and lifts the Links view only through linksAllowedAfter', () => {
	const src = read('src/components/ShareDialog.vue')
	assert.match(src, /const today = ref\(dayOf\(new Date\(\)\)\)/, 'the browser day until route 19 answers')
	assert.match(src, /today\.value = todayOf\(res\.linkPolicy, today\.value\)/, 'route 19/20: linkPolicy.today')
	assert.doesNotMatch(src.replace(/today\.value/g, ''), /[(,]\s*today\s*[,)]/, 'no stale constant day is passed anywhere')
	assert.match(src, /:today="today"/)
	assert.doesNotMatch(src, /linksAllowed\.value = res\./, 'never taken from the answer as it is (false would block E16\'s 403 path)')
	assert.equal(src.match(/^\t\tliftLinks\(res, disabledAtStart\)$/gm)?.length, 2, 'route 19 (load) and route 20 (saveShares)')
	assert.match(src, /if \(isLinksDisabled\(e\)\) \{\s*disabledSeq\+\+\s*linksAllowed\.value = false/)
	assert.match(read('src/components/LinkSettings.vue'), /:min="dateOfDay\(today\)"/, 'date-picker min = the dialog\'s today')
	assert.match(read('src/components/ShareLinks.vue'), /linkMeetsPolicy\(links\[role\], linkPolicy, today\)/)
})

// ---- board list ------------------------------------------------------------

test('board list (R13, CLI-10): Mine = own, Shared with me = share or link; source and access per row', () => {
	const boards = [
		{ id: 1, role: 'owner', source: 'own', mod: true },
		{ id: 2, role: 'edit', source: 'share', mod: true },
		{ id: 3, role: 'vote', source: 'link', mod: false, viaLink: true },
		{ id: 4, role: 'view', source: 'share', mod: false },
		{ id: 5, role: 'edit', viaLink: true },
	]
	assert.deepEqual(FILTERS, ['all', 'mine', 'shared'])
	assert.deepEqual(filterBoards(boards, 'all').map((b) => b.id), [1, 2, 3, 4, 5])
	assert.deepEqual(filterBoards(boards, 'mine').map((b) => b.id), [1])
	assert.deepEqual(filterBoards(boards, 'shared').map((b) => b.id), [2, 3, 4, 5])
	assert.deepEqual(filterBoards(null, 'all'), [])
	assert.deepEqual(boards.map(sourceOf), ['own', 'share', 'link', 'share', 'link'])
	assert.equal(sourceOf({ role: 'owner' }), 'own', 'M0 server without source')
	assert.deepEqual(boards.map(boardAccess), ['owner', 'moderate', 'vote', 'view', 'edit'])
	assert.equal(sourceLabel('share'), 'Shared with you')
	assert.equal(sourceLabel('link'), 'Joined through a link')
	assert.equal(sourceLabel('own'), '')
})

test('R14-12: accessLabel — a vote row says "Can view" while !FEATURES.voting, "Can vote" with voting; the hook value and the share dialog\'s "Can vote" stay', () => {
	assert.equal(FEATURES.voting, true, 'stage 3')
	assert.equal(accessLabel('vote'), 'Can vote', 'default = FEATURES.voting')
	assert.equal(accessLabel('vote', false), 'Can view')
	assert.equal(accessLabel('vote', true), 'Can vote', 'stage 3')
	for (const voting of [false, true]) {
		assert.deepEqual(['moderate', 'edit', 'view'].map((a) => accessLabel(a, voting)), ['Can facilitate', 'Can edit', 'Can view'])
		assert.equal(accessLabel('owner', voting), '')
		assert.equal(accessLabel(null, voting), '')
	}
	assert.equal(boardAccess({ role: 'vote', mod: false }), 'vote', '[data-knorke-board-access=vote] stays')
	assert.equal(roleLabel('vote'), 'Can vote', 'SharePeople shows a stored vote row as "Can vote" (CLI-06)')
	const list = read('src/views/BoardList.vue')
	assert.match(list, /\{\{ accessLabel\(boardAccess\(b\)\) \}\}/)
	assert.doesNotMatch(list, /roleLabel\(/, 'the list never labels with the plain role label')
	assert.match(read('src/components/SharePeople.vue'), /function roleOption\(role\) \{\s*return \{ id: role, role, label: roleLabel\(role\) \}/)
})

// ---- structure of the components ---------------------------------------------

/**
 * @param {string} f repo path of a .vue file
 * @return {object} root AST of its <template>
 */
function template(f) {
	const src = read(f)
	const m = src.match(/<template>([\s\S]*)<\/template>\s*<script/)
	return parse(m[1])
}

/**
 * @param {object} node AST node
 * @param {(n: object) => boolean} pred predicate
 * @param {object[]} [out] results
 * @return {object[]} every element below node matching pred
 */
function findAll(node, pred, out = []) {
	for (const c of node.children ?? []) {
		if (c.type === 1 && pred(c)) {
			out.push(c)
		}
		findAll(c, pred, out)
	}
	return out
}

/**
 * @param {object} el element
 * @param {string} name attribute (static) or v-bind argument
 * @return {string|null} static value or bound expression
 */
function attr(el, name) {
	const p = el.props.find((x) => (x.type === 6 && x.name === name) || (x.type === 7 && x.name === 'bind' && x.arg?.content === name))
	if (!p) {
		return null
	}
	return p.type === 6 ? (p.value?.content ?? '') : p.exp?.content ?? ''
}

/**
 * @param {object} el element
 * @return {string|null} v-if / v-else-if expression, '' for v-else
 */
function vIf(el) {
	const p = el.props.find((x) => x.type === 7 && (x.name === 'if' || x.name === 'else-if' || x.name === 'else'))
	return p ? (p.exp?.content ?? '') : null
}

const withHook = (ast, name, value) => findAll(ast, (e) => attr(e, name) === value)

test('R13 CLI-01: ShareDialog opens on "Links" for owners and moderators; root class knorke-share; People only for the owner', () => {
	const src = read('src/components/ShareDialog.vue')
	assert.match(src, /const tab = ref\('links'\)/, 'the Links tab is active on open')
	assert.doesNotMatch(src, /tab = ref\('people'\)/)
	const ast = template('src/components/ShareDialog.vue')
	const root = findAll(ast, (e) => e.tag === 'NcDialog')[0]
	assert.equal(attr(root, 'class'), 'knorke-dialog knorke-share')
	const people = withHook(ast, 'data-knorke-share-tab', 'people')
	assert.equal(people.length, 1)
	assert.equal(vIf(people[0]), 'owner', 'People only for the owner')
	assert.equal(withHook(ast, 'data-knorke-share-tab', 'links').length, 1)
	assert.equal(vIf(withHook(ast, 'data-knorke-share-tab', 'links')[0]), null, 'Links for everyone who may open the dialog')
	const sp = findAll(ast, (e) => e.tag === 'SharePeople')[0]
	assert.match(vIf(sp), /tab === 'people' && owner/)
})

test('R13 CLI-05: the dialog loads route 19 on every open; 403/404 closes it; a later link change wins over an older answer', () => {
	const src = read('src/components/ShareDialog.vue')
	assert.match(src, /onMounted\(load\)/)
	assert.match(src, /boardsApi\.listShares\(props\.boardId\)/)
	assert.match(src, /e\.status === 403 \|\| e\.status === 404\)\) \{\s*emit\('close'\)/)
	assert.match(src, /apply\(res, changesAtStart === linkChanges\)/)
	assert.match(src, /if \(takeLinks && res\.links/)
	const view = read('src/views/BoardView.vue')
	assert.match(view, /:mod="isMod"/)
	assert.match(view, /const isMod = computed\(\(\) => props\.mode === 'user' && !isOwner\.value && me\.value\?\.mod === true\)/)
	assert.match(view, /watch\(\(\) => isOwner\.value \|\| isMod\.value, \(may\) => \{\s*if \(!may\) \{\s*shareOpen\.value = false/)
	const top = template('src/components/TopBar.vue')
	// stage 3 (R16 narrow layout): the wide layout's share button; the narrow one's overflow menu carries it (ModerationMenu)
	assert.equal(vIf(withHook(top, 'data-knorke-action', 'share')[0]), '!narrow && (isOwner || mod)', 'share button for owner || me.mod (wide layout)')
	const menu = findAll(top, (e) => e.tag === 'ModerationMenu' && e.props.some((p) => p.type === 6 && p.name === 'overflow'))
	assert.equal(menu.length, 1)
	assert.equal(vIf(menu[0]), 'narrow && (isOwner || mod || canModerate)')
	assert.ok(menu[0].props.some((p) => p.type === 7 && p.arg?.content === 'can-share' && p.exp?.content === 'isOwner || mod'), 'overflow "Share" for owner || me.mod')
})

test('R13 CLI-05: readOnly links exactly — no toggle, rotate, settings-save, password, expiry; copy, QR and present stay', () => {
	const ast = template('src/components/ShareLinks.vue')
	assert.match(read('src/components/ShareLinks.vue'), /const view = computed\(\(\) => \(!props\.readOnly && props\.linksAllowed === false \? 'disabled' : 'on'\)\)/, 'the disabled view (with its link-toggle) is never shown to moderators')
	const settings = findAll(ast, (e) => e.tag === 'LinkSettings')
	assert.equal(settings.length, 2)
	for (const s of settings) {
		assert.match(vIf(s), /!readOnly/, 'LinkSettings (password, expiry, save) never for moderators')
	}
	const lst = template('src/components/LinkSettings.vue')
	for (const [n, v] of [['data-knorke-field', 'link-password'], ['data-knorke-field', 'link-expiry'], ['data-knorke-action', 'link-settings-save']]) {
		assert.equal(withHook(lst, n, v).length, 1, v + ' lives only in LinkSettings')
		assert.equal(withHook(ast, n, v).length, 0, v + ' not directly in ShareLinks')
	}
	// rotate/toggle of an active link inside a !readOnly template; qr, present, link-url without condition
	const ro = findAll(ast, (e) => e.tag === 'template' && vIf(e) === '!readOnly')
	assert.equal(ro.length, 1)
	assert.equal(withHook(ro[0], 'data-knorke-action', 'link-rotate').length, 1)
	assert.equal(withHook(ro[0], 'data-knorke-action', 'link-toggle').length, 1)
	for (const h of ['link-qr', 'link-present']) {
		assert.equal(withHook(ro[0], 'data-knorke-action', h).length, 0, h + ' also for moderators')
	}
	const create = withHook(ast, 'data-knorke-action', 'link-toggle').filter((e) => vIf(e) === '!readOnly')
	assert.equal(create.length, 1, 'create only for the owner')
	assert.equal(withHook(ast, 'data-knorke-action', 'link-rotate').length, 1, 'renew only in the !readOnly branch')
	assert.equal(withHook(ast, 'data-knorke-action', 'link-qr').length, 1)
	assert.equal(withHook(ast, 'data-knorke-action', 'link-present').length, 1)
	assert.equal(withHook(ast, 'data-knorke-field', 'link-url').length, 1)
})

test('R13 CLI-01: the edit section comes before the vote section; the vote section only with FEATURES.voting', () => {
	const src = read('src/components/ShareLinks.vue')
	assert.match(src, /const roles = computed\(\(\) => \(FEATURES\.voting \? \['edit', 'vote'\] : \['edit'\]\)\)/)
	const ast = template('src/components/ShareLinks.vue')
	const sections = findAll(ast, (e) => e.tag === 'section')
	assert.ok(sections.every((s) => attr(s, 'data-knorke-link') === 'role'))
	const links = template('src/components/ShareLinks.vue')
	assert.equal(withHook(links, 'data-knorke-banner', 'links_disabled').length, 1, 'the links_disabled note is in the Links tab')
})

test('R13 CLI-06: share rows carry kind:id and the draft role; the picker and its options carry their hooks', () => {
	const ast = template('src/components/SharePeople.vue')
	const li = findAll(ast, (e) => e.tag === 'li')
	assert.equal(li.length, 1)
	assert.equal(attr(li[0], 'data-knorke-share-item'), 'shareKey(s)')
	assert.equal(attr(li[0], 'data-knorke-share-role'), 's.role')
	const picker = withHook(ast, 'data-knorke-field', 'share-role')
	assert.equal(picker.length, 1)
	assert.equal(picker[0].tag, 'NcSelect')
	const opt = findAll(picker[0], (e) => attr(e, 'data-knorke-share-role-option') !== null)
	assert.equal(opt.length, 1)
	assert.equal(attr(opt[0], 'data-knorke-share-role-option'), 'o.role')
	assert.equal(withHook(ast, 'data-knorke-action', 'share-save').length, 1)
	assert.equal(withHook(ast, 'data-knorke-action', 'share-remove').length, 1)
	assert.equal(withHook(ast, 'data-knorke-action', 'copy-board-link').length, 1)
	assert.equal(withHook(ast, 'data-knorke-field', 'sharee-search').length, 1)
	const src = read('src/components/SharePeople.vue')
	assert.match(src, /roleChoices\(FEATURES\.voting\)/, 'Can vote only with voting')
	assert.match(src, /:model-value="roleOption\(s\.role\)"/, 'the current value may be a role that is not offered (stored vote)')
	assert.match(src, /:filter-by="keepServerHits"/, 'the local filter never drops a server hit (CLI-12)')
})

test('R13 CLI-07: errors carry [data-knorke-error=<code>]; the link-policy note; save disabled by saveDisabled', () => {
	for (const f of ['src/components/ShareLinks.vue', 'src/components/LinkSettings.vue', 'src/components/SharePeople.vue', 'src/components/GuestNameDialog.vue', 'src/components/LinkPasswordDialog.vue']) {
		assert.match(read(f), /:data-knorke-error="/, f)
	}
	const links = template('src/components/ShareLinks.vue')
	assert.equal(withHook(links, 'data-knorke-note', 'link-policy').length, 1)
	const ls = read('src/components/LinkSettings.vue')
	assert.match(ls, /:disabled="busy \|\| disabled"[\s\S]*?data-knorke-action="link-settings-save"/)
	assert.match(ls, /const disabled = computed\(\(\) => saveDisabled\(props\.link, props\.draft, props\.policy\)\)/)
	const people = template('src/components/SharePeople.vue')
	const note = withHook(people, 'data-knorke-error', 'sharing_disabled')
	assert.equal(note.length, 1, 'policy.sharing false: a note with the sharing_disabled text instead of the search')
	assert.equal(note[0].tag, 'NcNoteCard')
	const dlg = read('src/components/ShareDialog.vue')
	assert.match(dlg, /if \(settingsFirst\(linkPolicy\.value\)\) \{[\s\S]*?settingsOpen\[role\] = !settingsOpen\[role\]\s*return/, 'under enforcement link-toggle opens the settings and creates nothing')
	assert.match(dlg, /if \(isTightening\(link, body\)\) \{\s*ask\(\{ kind: 'tighten', role, body \}\)/, 'a new password asks first')
})

test('R13 CLI-03: App.vue and PublicApp.vue carry data-knorke-features on their root ("voting" or "")', () => {
	for (const f of ['src/App.vue', 'src/PublicApp.vue']) {
		const ast = template(f)
		const root = ast.children.find((c) => c.type === 1)
		assert.equal(attr(root, 'data-knorke-features'), 'features', f)
		assert.match(read(f), /const features = FEATURES\.voting \? 'voting' : ''/, f)
	}
})

test('R13 CLI-10: the board list filters carry [data-knorke-filter] and aria-current on the active one; rows carry source and access', () => {
	const app = read('src/App.vue')
	assert.match(app, /:data-knorke-filter="f\.id"/)
	assert.match(app, /:aria-current="filter === f\.id \? 'page' : null"/)
	assert.match(app, /:active="filter === f\.id"/)
	assert.match(app, /\{ id: 'all', [^}]*\},\s*\{ id: 'mine', [^}]*\},\s*\{ id: 'shared', /)
	const list = template('src/views/BoardList.vue')
	const li = findAll(list, (e) => e.tag === 'li')[0]
	assert.equal(attr(li, 'data-knorke-board-source'), 'sourceOf(b)')
	assert.equal(attr(li, 'data-knorke-board-access'), 'boardAccess(b)')
	assert.match(read('src/views/BoardList.vue'), /Nothing has been shared with you yet\./)
})

test('GuestNameDialog: the password field; the voting-link form only with FEATURES.voting (R13)', () => {
	const ast = template('src/components/GuestNameDialog.vue')
	const pw = withHook(ast, 'data-knorke-field', 'guest-password')
	assert.equal(pw.length, 1)
	assert.equal(vIf(pw[0]), 'needsPassword')
	const src = read('src/components/GuestNameDialog.vue')
	assert.match(src, /const voteForm = computed\(\(\) => FEATURES\.voting && props\.linkRole === 'vote'\)/)
	assert.match(src, /:required="!voteForm"/)
	const lp = template('src/components/LinkPasswordDialog.vue')
	assert.equal(withHook(lp, 'data-knorke-field', 'link-join-password').length, 1)
	assert.match(read('src/components/LinkPasswordDialog.vue'), /data-knorke-dialog="link-password"/)
})

test('QrCode / PresentLinkDialog: svg with the value hook, no innerHTML; the present dialog hook and both calls to action', () => {
	const qr = read('src/components/QrCode.vue')
	assert.match(qr, /:data-knorke-qr-value="value"/)
	assert.match(qr, /<path class="knorke-qr__modules" :d="qr\.d" \/>/)
	const pres = read('src/components/PresentLinkDialog.vue')
	assert.match(pres, /data-knorke-dialog="present-link"/)
	assert.match(pres, /Scan to vote on this board/)
	assert.match(pres, /Scan to join this board/)
	assert.match(pres, /size="min\(64vmin, 720px\)"/, '≥ 60 % of the shorter screen side')
})
