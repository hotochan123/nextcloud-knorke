/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * What the state banner of a board says (ConnectionBanner.vue, SPEC-M0 §6.6,
 * §6.8). Pure, so the texts can be checked in Node.
 *
 * `kind` is the test hook value [data-knorke-banner=<kind>]; it follows the
 * sync status and never changes with the reason:
 * - 'rate_limited' (R3): app 429 on /sync. The board was not deleted, the
 *   network sent too many requests: wait, then reload.
 * - 'revoked' with reason 'rate_limited': a guest re-join was answered with an
 *   app 429 (§6.4 keeps the status 'revoked' there). The hook stays
 *   'revoked', but the text says what happened instead of "link revoked".
 * - 'links_disabled' (U12): the instance does not allow link sharing (any
 *   more) for the board owner; final, no action (reloading does not help).
 * - 'link_expired', 'password_required' (SPEC-M1 §4.2, §6.11): final statuses
 *   set by the guest re-join mapping of §6.4. link_expired: "This link has
 *   expired." (no action: a new attempt does not help); password_required:
 *   "Enter the password for this board." while the guest view hands over to
 *   the name and password phase of PublicApp.
 * - 'gone' with reason 'link' (SPEC-M1 §4.2, R2): a signed-in member whose
 *   access came through a link (me.source 'link') lost it; the hook stays
 *   'gone', the text says to open the link again.
 *
 * Final status of the OPEN path (factory job 049, BoardView statusOf): the
 * board view shows the empty state "Could not open the board" instead of the
 * spinner; finalOpenView(status, {mode, source}) decides its parts. The
 * reason 'link' only for an account whose board list in this tab already
 * said the board came through a link (source 'link', the server's own answer
 * to that account); the 404 itself stays the same for everyone. The button
 * "Back to all boards" only for accounts (guests have no board list).
 *
 * Role/device banner (SPEC-M1 §6.5.4, stage 2, R13): roleBannerFor(kind)
 * gives the text of the one result of board/mode.js bannerFor ('view_role',
 * 'vote_ready', 'device_vote', 'viewonly'); ConnectionBanner shows it next to
 * the status banner as [data-knorke-banner=<kind>]. roleToastText(kind) is
 * the toast of a live role change (mode.js roleToastFor).
 */
import { LINKS_DISABLED, LINK_EXPIRED, PASSWORD_REQUIRED, RATE_LIMITED } from '../sync/SyncClient.js'
import { t } from '../util/l10n.js'

const rateLimitedText = () => t('knorke', 'Too many requests from your network. Please wait a few minutes, then reload the page.')

const MESSAGES = {
	offline: () => t('knorke', 'Offline. Changes are kept and sent when the connection is back.'),
	gone: () => t('knorke', 'This board is no longer available.'),
	revoked: () => t('knorke', 'This link was revoked.'),
	logged_out: () => t('knorke', 'Your session has ended. Please sign in again.'),
	reload: () => t('knorke', 'Knorke was updated. Please reload the page.'),
	[RATE_LIMITED]: rateLimitedText,
	[LINKS_DISABLED]: () => t('knorke', 'Link sharing was turned off by the administrator. This board can no longer be opened through the link.'),
	[LINK_EXPIRED]: () => t('knorke', 'This link has expired.'),
	[PASSWORD_REQUIRED]: () => t('knorke', 'Enter the password for this board.'),
}

/** Reason of 'gone' for a member whose access came through a link (BoardSession GONE_VIA_LINK). */
export const GONE_VIA_LINK = 'link'

const ACTIONS = {
	logged_out: 'signin',
	reload: 'reload',
	[RATE_LIMITED]: 'reload',
}

/**
 * @param {string} status sync status
 * @param {string|null} [reason] detail of a final status
 * @return {{kind: (string|null), text: string, action: (null|'signin'|'reload')}}
 *   kind null: no banner
 */
export function bannerFor(status, reason = null) {
	const kind = Object.prototype.hasOwnProperty.call(MESSAGES, status) ? status : null
	if (kind === null) {
		return { kind: null, text: '', action: null }
	}
	if (kind === 'revoked' && reason === RATE_LIMITED) {
		return { kind, text: rateLimitedText(), action: 'reload' }
	}
	if (kind === 'gone' && reason === GONE_VIA_LINK) {
		return { kind, text: t('knorke', 'Your access through the link ended. Open the link again.'), action: null }
	}
	return { kind, text: MESSAGES[kind](), action: ACTIONS[kind] ?? null }
}

/**
 * What the board view shows when opening the board ended in a final status
 * (factory job 049): the banner's reason and whether the empty state offers
 * "Back to all boards". Pure: reads neither storage nor DOM.
 *
 * @param {string} status final status of the open path (BoardView statusOf)
 * @param {{mode?: string, source?: (string|null)}} [o] mode of the view; origin of the board in this tab's board list
 * @return {{reason: (string|null), back: boolean}}
 */
export function finalOpenView(status, { mode = 'user', source = null } = {}) {
	const reason = status === 'gone' && mode === 'user' && source === 'link' ? GONE_VIA_LINK : null
	return { reason, back: mode === 'user' }
}

const ROLE_BANNERS = {
	view_role: () => t('knorke', 'View only'),
	vote_ready: () => t('knorke', 'You can vote here when voting starts.'),
	device_vote: () => t('knorke', 'On this device you can view and vote. Editing works on a computer.'),
	viewonly: () => t('knorke', 'View only on this device'),
}

/**
 * @param {string|null} kind result of board/mode.js bannerFor
 * @return {{kind: (string|null), text: string}} kind null: no role banner
 */
export function roleBannerFor(kind) {
	if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(ROLE_BANNERS, kind)) {
		return { kind: null, text: '' }
	}
	return { kind, text: ROLE_BANNERS[kind]() }
}

const ROLE_TOASTS = {
	facilitate: () => t('knorke', 'You can now facilitate this board.'),
	edit: () => t('knorke', 'You can now edit this board.'),
	vote: () => t('knorke', 'You can now view and vote on this board.'),
	view: () => t('knorke', 'You can now only view this board.'),
}

/**
 * @param {string|null} kind result of board/mode.js roleToastFor
 * @return {string|null} toast text, null: no toast
 */
export function roleToastText(kind) {
	return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(ROLE_TOASTS, kind) ? ROLE_TOASTS[kind]() : null
}
