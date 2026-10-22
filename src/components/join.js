/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * What a failed join through an edit link shows (SPEC-M0 §6.6). Pure, so
 * the decisions can be checked in Node; PublicApp.vue (guests) and App.vue
 * (signed-in users, /join/{token}) only render the result.
 *
 * Every outcome is final: nothing here retries on its own. (U12) 403
 * `links_disabled` (the instance does not allow link sharing for the board
 * owner) has its own final state; it used to look like a generic error or a
 * deleted board.
 *
 * SPEC-M1 (stage 0): the snapshot carries `board.links = {edit, vote}`
 * instead of M0's `board.link` (§4.4, Abweichung zu M0); the readers here
 * take the edit link from there (editLinkOf). 403 `link_expired` ends in its
 * own state 'expired'; 403 `password_required`/`password_wrong` brings a
 * guest back to the name phase with the hint.
 *
 * Stage 2 (SPEC-M1 §4.11.4, §6.4, R13): the name phase shows the password
 * field (needsPassword) with the hint at the field (passwordError, hook
 * [data-knorke-error=<code>]); the password lock-out (429 slow_down with
 * reason 'password') is never repeated and shows "Too many wrong passwords.
 * Try again in {minutes} minutes." there. A signed-in user who opens such a
 * link gets the account password dialog (accountJoinState 'password').
 */
import { HttpError, isPasswordLock } from '../sync/http.js'
import { LINKS_DISABLED } from '../sync/SyncClient.js'
import { t } from '../util/l10n.js'
import { lockoutText } from './share.js'

/**
 * @param {unknown} e error
 * @return {boolean} 403 links_disabled from the app
 */
export function isLinksDisabled(e) {
	return e instanceof HttpError && e.status === 403 && e.code === LINKS_DISABLED
}

/**
 * The name phase for a link with password (stage 2): the password field,
 * the hint at it and the code of the hint.
 *
 * @param {string} code §4.2 code of the hint ('password_required', 'password_wrong', 'slow_down')
 * @param {string} text hint
 * @return {{phase: 'name', error: string, needsPassword: true, passwordError: string, passwordCode: string}}
 */
function passwordPhase(code, text) {
	return { phase: 'name', error: '', needsPassword: true, passwordError: text, passwordCode: code }
}

/**
 * Guest page (PublicApp): next phase after the join of BoardView failed.
 *
 * @param {unknown} e error of the join
 * @return {{phase: 'revoked'|'disabled'|'expired'|'name', error: string, needsPassword?: boolean,
 *   passwordError?: string, passwordCode?: string}|null} null: the board view keeps showing its own error
 */
export function guestJoinOutcome(e) {
	if (!(e instanceof HttpError)) {
		return null
	}
	if (e.status === 403 && e.code === 'link_revoked') {
		return { phase: 'revoked', error: '' }
	}
	if (isLinksDisabled(e)) {
		return { phase: 'disabled', error: '' }
	}
	if (e.status === 403 && e.code === 'link_expired') {
		return { phase: 'expired', error: '' }
	}
	if (e.status === 403 && e.code === 'password_required') {
		return passwordPhase('password_required', t('knorke', 'Enter the password for this board.'))
	}
	if (e.status === 403 && e.code === 'password_wrong') {
		return passwordPhase('password_wrong', t('knorke', 'Wrong password.'))
	}
	if (isPasswordLock(e)) {
		return passwordPhase('slow_down', lockoutText(e))
	}
	if (e.status === 404) {
		// The transport already forgot the stored guest.
		return { phase: 'name', error: '' }
	}
	if (e.status === 400) {
		return { phase: 'name', error: t('knorke', 'Please enter a name.') }
	}
	if (e.status === 429 && e.fromApp) {
		// (U20) The budget for new guests is per link: a new link starts fresh.
		return { phase: 'name', error: t('knorke', 'Too many people joined from here in a short time. Please wait a moment, or ask the person who shared the board for a new link.') }
	}
	return null
}

/**
 * Signed-in user opening /join/{token} (App.vue). 'password': the link has a
 * password (403 password_required/password_wrong or the lock-out): the
 * account password dialog (LinkPasswordDialog) takes over.
 *
 * @param {unknown} e error of POST /api/v1/links/{token}/join
 * @return {'revoked'|'disabled'|'expired'|'invalid'|'limited'|'password'|'error'} join state
 */
export function accountJoinState(e) {
	if (e instanceof HttpError && e.status === 403 && (e.code === 'password_required' || e.code === 'password_wrong')) {
		return 'password'
	}
	if (isPasswordLock(e)) {
		return 'password'
	}
	if (e instanceof HttpError && e.status === 403 && e.code === 'link_revoked') {
		return 'revoked'
	}
	if (e instanceof HttpError && e.status === 403 && e.code === 'link_expired') {
		return 'expired'
	}
	if (isLinksDisabled(e)) {
		return 'disabled'
	}
	if (e instanceof HttpError && e.status === 404) {
		return 'invalid'
	}
	if (e instanceof HttpError && e.status === 429) {
		return 'limited'
	}
	return 'error'
}

/**
 * The edit link of a board view (SPEC-M1 §4.4: `board.links.edit`, null
 * when off or not visible to this viewer).
 *
 * @param {object|null} board board view of the snapshot ({links: {edit, vote}})
 * @return {object|null} Link {token, role, url, …} or null
 */
export function editLinkOf(board) {
	const link = board && board.links && typeof board.links === 'object' ? board.links.edit : null
	return link && typeof link === 'object' ? link : null
}

/**
 * The board view after the edit link changed (turned on, renewed or off):
 * `links.edit` replaced, `links.vote` kept (the answers of routes 9/10 stay
 * {link}, SPEC-M1 §4.4).
 *
 * @param {object|null} board board view
 * @param {object|null} link new edit link or null
 * @return {{links: {edit: (object|null), vote: (object|null)}}} the keys to merge
 */
export function withEditLink(board, link) {
	const links = board && board.links && typeof board.links === 'object' ? board.links : {}
	return { links: { ...links, edit: link ?? null, vote: links.vote ?? null } }
}

/**
 * Share dialog (U12): what it offers for the board.
 *
 * @param {object|null} board board view of the snapshot ({links: {edit, vote}, linksAllowed})
 * @return {'disabled'|'on'|'off'} disabled: the instance does not allow link
 *   sharing (no create/renew; a kept link can still be turned off)
 */
export function shareView(board) {
	if (board && board.linksAllowed === false) {
		return 'disabled'
	}
	return editLinkOf(board) ? 'on' : 'off'
}
