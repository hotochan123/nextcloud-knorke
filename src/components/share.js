/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Decisions of the share dialog and the board list (SPEC-M1 §4.10, §4.11,
 * §6.6, stage 2). Pure (no DOM, no requests), so they can be checked in Node;
 * ShareDialog, SharePeople, ShareLinks, LinkSettings and BoardList only render
 * the results.
 *
 * Shares (§4.10): the dialog edits a DRAFT of the complete list; "Save"
 * ([data-knorke-action=share-save]) sends it as PUT (the server takes the
 * complete wanted list, idempotent). A new recipient starts as `edit`
 * ("Can edit", R13). Without FEATURES.voting "Can vote" is not offered, but a
 * stored row with `vote` keeps showing it as its current value and goes out
 * unchanged (never silently down- or upgraded, R13).
 *
 * Search options for NcSelectUsers: it filters locally by
 * "displayName subname", so `subname` = sub (users), id (groups), '' (teams)
 * keeps every server hit (R13, CLI-12).
 *
 * Links (§4.11): expiry travels as the calendar day "YYYY-MM-DD" (the day as
 * the owner picks it; the server stores the end of that day in the owner's
 * zone). Under an enforced policy (password or expiry, R13 CLI-07) turning a
 * link on opens its settings first: the password empty, the expiry
 * prefilled with today + expireDefaultDays; saving stays disabled while a
 * required field is empty. Setting or changing the password of an existing
 * link is a tightening and is confirmed first ("Everyone who joined through
 * this link will have to enter the password again.").
 *
 * (R14-04) "Today" of the dialog is linkPolicy.today of the owner's answer of
 * route 19/20 (the owner's day, the one the server checks against); until
 * that answer is there it is the browser's local day (todayOf). (R14-07) The
 * "Links" view follows linksAllowed of the snapshot and of a 403
 * links_disabled; of an answer of route 19/20 only `true` is applied
 * (linksAllowedAfter).
 *
 * Errors carry the code of §4.2; errorText() gives the §6.11 text, the
 * element showing it carries [data-knorke-error=<code>] (R13).
 */
import { HttpError, isPasswordLock, isSlowDown, lockMinutes } from '../sync/http.js'
import { FEATURES } from '../util/features.js'
import { n, t } from '../util/l10n.js'
import { accessOf } from '../board/mode.js'

/** Share roles in rank order, highest first (§4.9 SHARE_ROLES). */
export const SHARE_ROLES = Object.freeze(['moderate', 'edit', 'vote', 'view'])
/** Recipient kinds (§4.10.1), in the server's sort order. */
export const SHARE_KINDS = Object.freeze(['user', 'group', 'team'])
/** Role of a newly added recipient (R13, CLI-06). */
export const DEFAULT_SHARE_ROLE = 'edit'
/** Fallbacks of `max` when a too_many_* answer lacks it (§4.8 MAX_SHARES, MAX_NEW_SHARES). */
export const MAX_SHARES_FALLBACK = 200
export const MAX_NEW_SHARES_FALLBACK = 20
/** Debounce of the recipient search (§6.6 SharePeople). */
export const SEARCH_DEBOUNCE_MS = 300
/** Length of a generated link password (§6.6 LinkSettings). */
export const PASSWORD_LENGTH = 16

/**
 * @param {string} role share role or access level
 * @return {string} "Can facilitate" | "Can edit" | "Can vote" | "Can view" ('' for anything else)
 */
export function roleLabel(role) {
	switch (role) {
	case 'moderate':
		return t('knorke', 'Can facilitate')
	case 'edit':
		return t('knorke', 'Can edit')
	case 'vote':
		return t('knorke', 'Can vote')
	case 'view':
		return t('knorke', 'Can view')
	default:
		return ''
	}
}

/**
 * Roles the role picker offers for a row.
 *
 * @param {boolean} [votingEnabled] FEATURES.voting
 * @return {string[]} selectable roles, highest first
 */
export function roleChoices(votingEnabled = FEATURES.voting) {
	return SHARE_ROLES.filter((r) => votingEnabled || r !== 'vote')
}

/**
 * @param {{kind: string, id: string}} s share or sharee
 * @return {string} '<kind>:<id>' (the hook value of [data-knorke-share-item])
 */
export function shareKey(s) {
	return String(s?.kind ?? '') + ':' + String(s?.id ?? '')
}

/**
 * Shares of an answer (GET/PUT, §4.10.1) as rows of the draft. A row with
 * `appAccess: false` (an account that cannot open Knorke, job 079) keeps it;
 * any other value gives a row without the key.
 *
 * @param {unknown} list `shares` of the answer
 * @return {Array<{kind: string, id: string, name: string, role: string, available: boolean, appAccess?: false}>}
 */
export function normalizeShares(list) {
	if (!Array.isArray(list)) {
		return []
	}
	const out = []
	const seen = new Set()
	for (const s of list) {
		if (!s || typeof s !== 'object' || !SHARE_KINDS.includes(s.kind) || typeof s.id !== 'string' || s.id === '') {
			continue
		}
		const key = shareKey(s)
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		const row = {
			kind: s.kind,
			id: s.id,
			name: typeof s.name === 'string' && s.name !== '' ? s.name : s.id,
			role: SHARE_ROLES.includes(s.role) ? s.role : 'view',
			available: s.available !== false,
		}
		if (s.appAccess === false) {
			row.appAccess = false
		}
		out.push(row)
	}
	return out
}

/**
 * The PUT body of a draft: exactly kind, id, role per row (§4.10.2), in the
 * order of the draft (never appAccess: the server answers any other key
 * with 400 bad_request).
 *
 * @param {object[]} draft rows
 * @return {Array<{kind: string, id: string, role: string}>}
 */
export function wireShares(draft) {
	return (draft ?? []).map((s) => ({ kind: s.kind, id: s.id, role: s.role }))
}

/**
 * @param {object[]} a rows
 * @param {object[]} b rows
 * @return {boolean} the same recipients with the same roles (order does not matter)
 */
export function sameShares(a, b) {
	const sig = (list) => wireShares(list).map((s) => shareKey(s) + '=' + s.role).sort().join('\n')
	return sig(a) === sig(b)
}

/**
 * Adds a search hit to the draft as `edit` (R13). A recipient that is
 * already in the list is not added twice. A hit with `appAccess: false`
 * gives a row with it, so the hint shows at once (job 079).
 *
 * @param {object[]} draft rows
 * @param {{kind: string, id: string, name?: string, appAccess?: boolean}} sharee search hit
 * @return {{draft: object[], added: boolean, key: string}}
 */
export function addSharee(draft, sharee) {
	const rows = draft ?? []
	const key = shareKey(sharee)
	if (!sharee || !SHARE_KINDS.includes(sharee.kind) || typeof sharee.id !== 'string' || sharee.id === '' || rows.some((s) => shareKey(s) === key)) {
		return { draft: rows, added: false, key }
	}
	const name = typeof sharee.name === 'string' && sharee.name !== '' ? sharee.name : sharee.id
	const row = { kind: sharee.kind, id: sharee.id, name, role: DEFAULT_SHARE_ROLE, available: true }
	if (sharee.appAccess === false) {
		row.appAccess = false
	}
	return { draft: [...rows, row], added: true, key }
}

/**
 * @param {object[]} draft rows
 * @param {string} key '<kind>:<id>'
 * @return {object[]} the draft without that row
 */
export function removeShare(draft, key) {
	return (draft ?? []).filter((s) => shareKey(s) !== key)
}

/**
 * @param {object[]} draft rows
 * @param {string} key '<kind>:<id>'
 * @param {string} role new role (a share role)
 * @return {object[]} the draft with that row's role changed
 */
export function setShareRole(draft, key, role) {
	if (!SHARE_ROLES.includes(role)) {
		return draft ?? []
	}
	return (draft ?? []).map((s) => (shareKey(s) === key ? { ...s, role } : s))
}

/**
 * @param {{kind: string, id: string, sub?: string}} s search hit (§4.10.3)
 * @return {string} subname for NcSelectUsers (R13): sub (users), id (groups), '' (teams)
 */
export function subnameOf(s) {
	if (s?.kind === 'user') {
		return typeof s.sub === 'string' ? s.sub : ''
	}
	if (s?.kind === 'group') {
		return typeof s.id === 'string' ? s.id : ''
	}
	return ''
}

/**
 * Options for NcSelectUsers from the search answer: users with avatar,
 * groups and teams as isNoUser with an icon (§6.6). A hit with
 * `appAccess: false` (an account that cannot open Knorke, job 079) gives an
 * option with it; otherwise the key is missing.
 *
 * @param {unknown} sharees `sharees` of the answer
 * @param {{group?: string, team?: string}} [iconPaths] icon path data
 * @return {object[]} options (id = '<kind>:<id>')
 */
export function shareeOptions(sharees, iconPaths = {}) {
	if (!Array.isArray(sharees)) {
		return []
	}
	const out = []
	const seen = new Set()
	for (const s of sharees) {
		if (!s || !SHARE_KINDS.includes(s.kind) || typeof s.id !== 'string' || s.id === '') {
			continue
		}
		const key = shareKey(s)
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		const name = typeof s.name === 'string' && s.name !== '' ? s.name : s.id
		const o = { id: key, kind: s.kind, shareId: s.id, displayName: name, subname: subnameOf(s), isNoUser: s.kind !== 'user' }
		if (s.kind === 'user') {
			o.user = s.id
		} else if (iconPaths[s.kind]) {
			o.iconSvg = iconPaths[s.kind]
		}
		if (s.appAccess === false) {
			o.appAccess = false
		}
		out.push(o)
	}
	return out
}

/**
 * @param {unknown} e error
 * @return {string|null} app error code of an HttpError
 */
function codeOf(e) {
	return e instanceof HttpError ? e.code : null
}

/**
 * Text of a §4.2 error code (§6.11). `ctx.shares` names the recipient of
 * `recipient_not_found` (the row at `at`).
 *
 * @param {unknown} e error of a share, search or link call
 * @param {{shares?: object[]}} [ctx] the list that was sent
 * @return {{code: string, text: string, at: (number|null), field: ('password'|'expiry'|null)}}
 */
export function errorText(e, { shares = [] } = {}) {
	const code = codeOf(e) ?? 'network'
	const body = e instanceof HttpError ? (e.body ?? {}) : {}
	const at = Number.isInteger(body.at) ? body.at : null
	const max = Number.isInteger(body.max) && body.max > 0 ? body.max : null
	const out = (text, field = null) => ({ code, text, at, field })
	if (isPasswordLock(e)) {
		return { code, text: lockoutText(e), at, field: 'password' }
	}
	if (isSlowDown(e)) {
		return out(t('knorke', 'Too many requests. Please wait a moment.'))
	}
	switch (code) {
	case 'sharing_disabled':
		return out(t('knorke', 'Sharing is turned off for your account.'))
	case 'group_sharing_disabled':
		return out(t('knorke', 'Sharing with groups is turned off.'))
	case 'teams_unavailable':
		return out(t('knorke', 'Teams are not available.'))
	case 'group_members_only':
		return out(t('knorke', 'You can only share with members of your groups.'))
	case 'recipient_not_found': {
		const row = at !== null ? shares[at] : null
		const name = row ? (row.name || row.id) : ''
		return out(t('knorke', '“{name}” was not found.', { name }))
	}
	case 'self_share':
		return out(t('knorke', 'You can\'t share with yourself.'))
	case 'too_many_shares':
		return out(t('knorke', 'This board can\'t be shared with more than {max} people, groups or teams.', { max: max ?? MAX_SHARES_FALLBACK }))
	case 'too_many_new_shares':
		return out(t('knorke', 'Add at most {max} people, groups or teams at once.', { max: max ?? MAX_NEW_SHARES_FALLBACK }))
	case 'password_enforced':
		return out(t('knorke', 'A password is required by your administrator.'), 'password')
	case 'password_policy':
		// the hint of Nextcloud's password policy (HintException), English or translated by the policy app
		return out(typeof e?.message === 'string' && e.message !== '' && e.message !== code ? e.message : t('knorke', 'This password does not meet the password policy.'), 'password')
	case 'expiry_required':
		return out(t('knorke', 'An expiry date is required.'), 'expiry')
	case 'expiry_too_far':
		return out(t('knorke', 'The expiry date can be at most {maxDays} days away.', { maxDays: Number.isInteger(body.maxDays) ? body.maxDays : '?' }), 'expiry')
	case 'expiry_past':
		return out(t('knorke', 'The expiry date must not be in the past.'), 'expiry')
	case 'password_wrong':
		return out(t('knorke', 'Wrong password.'), 'password')
	case 'password_required':
		return out(t('knorke', 'Enter the password for this board.'), 'password')
	default:
		return out(t('knorke', 'Sharing could not be changed. Please try again.'))
	}
}

/**
 * errorText for a code the client found itself (expiry checks): the same
 * text as the server's answer with that code.
 *
 * @param {string} code §4.2 code
 * @param {object} [body] extra fields (maxDays …)
 * @return {{code: string, text: string, at: (number|null), field: ('password'|'expiry'|null)}}
 */
export function textOf(code, body = {}) {
	return errorText(new HttpError(400, code, '', null, true, { error: code, ...body }))
}

/**
 * "Too many wrong passwords. Try again in {minutes} minutes." (§6.4, §6.11,
 * plural) with minutes = ceil(retryMs / 60000).
 *
 * @param {unknown} e the slow_down error with reason 'password'
 * @return {string}
 */
export function lockoutText(e) {
	const minutes = lockMinutes(e)
	return n('knorke', 'Too many wrong passwords. Try again in {minutes} minute.', 'Too many wrong passwords. Try again in {minutes} minutes.', minutes, { minutes })
}

// ---- links -----------------------------------------------------------------

/**
 * @param {Date} d date
 * @return {string} 'YYYY-MM-DD' of the local calendar day
 */
export function dayOf(d) {
	const yyyy = String(d.getFullYear()).padStart(4, '0')
	const mm = String(d.getMonth() + 1).padStart(2, '0')
	const dd = String(d.getDate()).padStart(2, '0')
	return `${yyyy}-${mm}-${dd}`
}

/**
 * "Today" of the share dialog (R14-04, §4.10.1, §6.6 LinkSettings):
 * linkPolicy.today of the owner's answer of route 19 (or 20), the owner's day
 * in the owner's zone (LinkSecrets::today), when it is a real calendar day;
 * otherwise `fallback`, the day the dialog had so far (the browser's local
 * day until route 19 answered). The snapshot's linkPolicy carries no today.
 *
 * @param {object|null|undefined} policy linkPolicy of an answer (raw, not normalized)
 * @param {string} fallback 'YYYY-MM-DD'
 * @return {string} 'YYYY-MM-DD'
 */
export function todayOf(policy, fallback) {
	const day = policy && typeof policy === 'object' ? policy.today : undefined
	return isDay(day) ? day : fallback
}

/**
 * The settings draft of a link that is not on yet, after "today" or the
 * policy changed (R14-04): a prefill the user did not touch moves to the new
 * today + expireDefaultDays; a typed password and a day the user picked or
 * cleared stay.
 *
 * @param {{password: string, expiry: string, removePassword: boolean}} draft settings draft
 * @param {{policy: object|null, today: string}} before policy and today the prefill was made with
 * @param {{policy: object|null, today: string}} after policy and today now
 * @return {{password: string, expiry: string, removePassword: boolean}}
 */
export function reprefill(draft, before, after) {
	const d = draft ?? linkDraft(null, before.policy, before.today)
	if (d.expiry !== initialExpiry(before.policy, before.today)) {
		return d
	}
	const expiry = initialExpiry(after.policy, after.today)
	return expiry === d.expiry ? d : { ...d, expiry }
}

/**
 * linksAllowed of the "Links" view after an answer of route 19 or 20
 * (R14-07, §6.6 ShareDialog): the view follows the snapshot and a 403
 * links_disabled (U12); of the answer only `linksAllowed: true` is applied,
 * lifting a disabled view (snapshot false, or after such a 403). `false` is
 * not applied: the next action takes the 403 path (the frozen M0 case E16
 * opens the dialog with a stale "allowed" view and expects that path). An
 * answer to a request that started before the last 403 links_disabled is
 * older than that 403 and lifts nothing.
 *
 * @param {boolean} current linksAllowed of the view
 * @param {object|null|undefined} res answer of GET or PUT …/shares
 * @param {boolean} [older] the request started before the last 403 links_disabled
 * @return {boolean}
 */
export function linksAllowedAfter(current, res, older = false) {
	if (current === false && !older && res && typeof res === 'object' && res.linksAllowed === true) {
		return true
	}
	return current
}

/**
 * @param {unknown} s value
 * @return {boolean} a real calendar day 'YYYY-MM-DD'
 */
export function isDay(s) {
	if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return false
	}
	const [y, m, d] = s.split('-').map(Number)
	const u = new Date(Date.UTC(y, m - 1, d))
	return u.getUTCFullYear() === y && u.getUTCMonth() === m - 1 && u.getUTCDate() === d
}

/**
 * @param {string} day 'YYYY-MM-DD'
 * @param {number} days days to add (may be negative)
 * @return {string} 'YYYY-MM-DD' (calendar arithmetic, no time zone involved)
 */
export function addDays(day, days) {
	const [y, m, d] = day.split('-').map(Number)
	const u = new Date(Date.UTC(y, m - 1, d + days))
	return `${String(u.getUTCFullYear()).padStart(4, '0')}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(u.getUTCDate()).padStart(2, '0')}`
}

/**
 * @param {string|null} day 'YYYY-MM-DD' or null/''
 * @return {Date|null} local midnight of that day (NcDateTimePickerNative model)
 */
export function dateOfDay(day) {
	if (!isDay(day)) {
		return null
	}
	const [y, m, d] = day.split('-').map(Number)
	return new Date(y, m - 1, d)
}

/**
 * @param {object|null} policy linkPolicy (§4.10.1)
 * @return {{passwordEnforced: boolean, expireDefaultDays: (number|null), expireEnforced: boolean, expireMaxDays: (number|null)}}
 */
export function normalizePolicy(policy) {
	const p = policy && typeof policy === 'object' ? policy : {}
	const days = (v) => (Number.isInteger(v) && v > 0 ? v : null)
	return {
		passwordEnforced: p.passwordEnforced === true,
		expireDefaultDays: days(p.expireDefaultDays),
		expireEnforced: p.expireEnforced === true,
		expireMaxDays: days(p.expireMaxDays),
	}
}

/**
 * Under an enforced policy turning a link on opens its settings first (R13).
 *
 * @param {object|null} policy linkPolicy
 * @return {boolean}
 */
export function settingsFirst(policy) {
	const p = normalizePolicy(policy)
	return p.passwordEnforced || p.expireEnforced
}

/**
 * Prefill of the expiry field when a link is created (R13 §4.10.1: only with
 * expireDefaultDays).
 *
 * @param {object|null} policy linkPolicy
 * @param {string} today 'YYYY-MM-DD'
 * @return {string} 'YYYY-MM-DD' or ''
 */
export function initialExpiry(policy, today) {
	const p = normalizePolicy(policy)
	return p.expireDefaultDays !== null ? addDays(today, p.expireDefaultDays) : ''
}

/**
 * Client check of an expiry day (the server checks again, §4.11.2).
 *
 * @param {string} day 'YYYY-MM-DD' or ''
 * @param {object|null} policy linkPolicy
 * @param {string} today 'YYYY-MM-DD'
 * @return {'expiry_required'|'expiry_past'|'expiry_too_far'|null}
 */
export function expiryProblem(day, policy, today) {
	const p = normalizePolicy(policy)
	if (!isDay(day)) {
		return p.expireEnforced ? 'expiry_required' : null
	}
	if (day < today) {
		return 'expiry_past'
	}
	if (p.expireMaxDays !== null && day > addDays(today, p.expireMaxDays)) {
		return 'expiry_too_far'
	}
	return null
}

/**
 * A link created before the admin enforced password or expiry keeps working
 * (not retroactive, Q5); the dialog says so with
 * [data-knorke-note=link-policy] and offers to add what is missing.
 *
 * @param {object|null} link Link (§4.4)
 * @param {object|null} policy linkPolicy
 * @param {string} today 'YYYY-MM-DD'
 * @return {boolean} the link meets the current policy (true without a link)
 */
export function linkMeetsPolicy(link, policy, today) {
	if (!link) {
		return true
	}
	const p = normalizePolicy(policy)
	if (p.passwordEnforced && link.password !== true) {
		return false
	}
	if (p.expireEnforced) {
		if (!isDay(link.expiresOn)) {
			return false
		}
		if (p.expireMaxDays !== null && link.expiresOn > addDays(today, p.expireMaxDays)) {
			return false
		}
	}
	return true
}

/**
 * Settings draft of a link section ({password, expiry, removePassword}).
 *
 * @param {object|null} link Link or null (not on)
 * @param {object|null} policy linkPolicy
 * @param {string} today 'YYYY-MM-DD'
 * @return {{password: string, expiry: string, removePassword: boolean}}
 */
export function linkDraft(link, policy, today) {
	return {
		password: '',
		expiry: link ? (isDay(link.expiresOn) ? link.expiresOn : '') : initialExpiry(policy, today),
		removePassword: false,
	}
}

/**
 * POST body of "Save" (§4.11.2): `password` only when the user typed one
 * (any string is a set/change, R13) or removes it (null); `expiresAt` only
 * when the day differs from the link's (null = remove). For a new link the
 * prefilled day goes along.
 *
 * @param {object|null} link Link or null
 * @param {{password: string, expiry: string, removePassword: boolean}} draft settings draft
 * @return {{password?: (string|null), expiresAt?: (string|null)}}
 */
export function linkSaveBody(link, draft) {
	const body = {}
	if (typeof draft?.password === 'string' && draft.password !== '') {
		body.password = draft.password
	} else if (link && draft?.removePassword === true && link.password === true) {
		body.password = null
	}
	const day = isDay(draft?.expiry) ? draft.expiry : ''
	const was = link && isDay(link.expiresOn) ? link.expiresOn : ''
	if (!link) {
		if (day !== '') {
			body.expiresAt = day
		}
	} else if (day !== was) {
		body.expiresAt = day === '' ? null : day
	}
	return body
}

/**
 * Whether "Save" of a section is disabled (R13 CLI-07): a required field is
 * empty (password under passwordEnforced when the link has none, expiry
 * under expireEnforced), or an existing link would not change.
 *
 * @param {object|null} link Link or null
 * @param {{password: string, expiry: string, removePassword: boolean}} draft settings draft
 * @param {object|null} policy linkPolicy
 * @return {boolean}
 */
export function saveDisabled(link, draft, policy) {
	const p = normalizePolicy(policy)
	const hasPassword = (typeof draft?.password === 'string' && draft.password !== '') || (link?.password === true && draft?.removePassword !== true)
	if (p.passwordEnforced && !hasPassword) {
		return true
	}
	if (p.expireEnforced && !isDay(draft?.expiry)) {
		return true
	}
	return link !== null && link !== undefined && Object.keys(linkSaveBody(link, draft)).length === 0
}

/**
 * Setting or changing the password of an existing link signs everyone out
 * who joined through it (§4.11.2): the dialog asks first.
 *
 * @param {object|null} link Link or null
 * @param {object} body POST body
 * @return {boolean}
 */
export function isTightening(link, body) {
	return !!link && typeof body?.password === 'string'
}

/**
 * Local password generator (R2 §6.6): PASSWORD_LENGTH characters from
 * crypto.getRandomValues (works without a secure context) with at least one
 * upper case letter, lower case letter, digit and special character; no call
 * to the password_policy OCS API. Ambiguous characters (I, l, O, 0, 1) are
 * left out.
 *
 * @param {(a: Uint32Array) => Uint32Array} [fill] random source (crypto.getRandomValues)
 * @return {string}
 */
export function generatePassword(fill = (a) => globalThis.crypto.getRandomValues(a)) {
	const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%&*+-=?@_']
	const all = sets.join('')
	const buf = new Uint32Array(PASSWORD_LENGTH * 4)
	for (let round = 0; round < 64; round++) {
		fill(buf)
		let k = 0
		/** Uniform index below n by rejection (no modulo bias). */
		const pick = (n) => {
			const limit = Math.floor(0x100000000 / n) * n
			while (k < buf.length) {
				const v = buf[k++]
				if (v < limit) {
					return v % n
				}
			}
			return -1
		}
		let out = ''
		for (let i = 0; i < PASSWORD_LENGTH; i++) {
			const j = pick(all.length)
			if (j < 0) {
				break
			}
			out += all[j]
		}
		if (out.length === PASSWORD_LENGTH && sets.every((set) => [...out].some((c) => set.includes(c)))) {
			return out
		}
	}
	throw new Error('No random source')
}

// ---- board list ------------------------------------------------------------

/** Filters of the board list (R13 CLI-10). */
export const FILTERS = Object.freeze(['all', 'mine', 'shared'])

/**
 * Origin of the effective role of a list row (§4.10.4); an M0 server sends
 * no `source`: owner → own, viaLink → link.
 *
 * @param {object} b board of the list
 * @return {'own'|'share'|'link'}
 */
export function sourceOf(b) {
	if (b && ['own', 'share', 'link'].includes(b.source)) {
		return b.source
	}
	if (b?.role === 'owner') {
		return 'own'
	}
	return b?.viaLink === true ? 'link' : 'share'
}

/**
 * Origin of a board as this tab's board list knows it (factory job 049: the
 * board view's text after a final open error). Only a real row counts:
 * sourceOf(undefined) would be 'share'.
 *
 * @param {unknown} boards rows of the board list (App.vue `boards`)
 * @param {number|null} id board id of the route
 * @return {'own'|'share'|'link'|null} origin of that row, null when the list has no row for id
 */
export function listSourceOf(boards, id) {
	if (!Array.isArray(boards)) {
		return null
	}
	const row = boards.find((b) => b && b.id === id)
	return row ? sourceOf(row) : null
}

/**
 * @param {object} b board of the list
 * @return {'owner'|'moderate'|'edit'|'vote'|'view'|null} access level of the row
 */
export function boardAccess(b) {
	return accessOf(b?.role, b?.mod)
}

/**
 * Label of a row's access level in the board list (R14-12, §6.6 BoardList):
 * while FEATURES.voting is false (stage 2) a board with access `vote` opens
 * view-only, so its row says "Can view" (the rule of the role toasts,
 * board/mode.js roleToastFor, CLI-09). The hook
 * [data-knorke-board-access=vote] stays. The owner's share dialog keeps
 * showing a stored vote row as "Can vote" (SharePeople with roleLabel,
 * CLI-06; the picker does not offer vote).
 *
 * @param {string|null|undefined} access access level of the row (boardAccess)
 * @param {boolean} [votingEnabled] FEATURES.voting
 * @return {string} "Can facilitate" | "Can edit" | "Can vote" | "Can view" ('' for the owner or an unknown level)
 */
export function accessLabel(access, votingEnabled = FEATURES.voting) {
	return roleLabel(access === 'vote' && !votingEnabled ? 'view' : access)
}

/**
 * R13 (CLI-10): "Mine" = source own, "Shared with me" = source share or link.
 *
 * @param {object[]} boards list
 * @param {string} filter 'all' | 'mine' | 'shared'
 * @return {object[]}
 */
export function filterBoards(boards, filter) {
	const list = Array.isArray(boards) ? boards : []
	if (filter === 'mine') {
		return list.filter((b) => sourceOf(b) === 'own')
	}
	if (filter === 'shared') {
		return list.filter((b) => sourceOf(b) !== 'own')
	}
	return list
}

/**
 * @param {'own'|'share'|'link'} source origin
 * @return {string} label of the row ('' for own boards)
 */
export function sourceLabel(source) {
	if (source === 'share') {
		return t('knorke', 'Shared with you')
	}
	if (source === 'link') {
		return t('knorke', 'Joined through a link')
	}
	return ''
}
