/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The privacy notice of guests and of boards open by link (M2), pure
 * helpers. No consent, no confirmation: Art. 13 GDPR asks for information,
 * so nothing here is worded as agreeing to anything.
 *
 * - Initial state `privacy` = {text: string|null, url: string}: the admin's
 *   notice text and privacy policy URL in the page's language. A missing or
 *   empty text means the built-in text (English and German through l10n),
 *   with its own wording for the voting role (no cursor, anonymous votes).
 * - Guests: the name dialog shows the notice (and marks the tab session);
 *   a returning guest (stored identity, no dialog) gets the info card once
 *   per tab session (sessionStorage knorke.privacy.<boardId>).
 * - Accounts: on a board with an active edit or voting link the top bar
 *   shows "Open by link" (linkOpen), and once per device and link the info
 *   card (localStorage knorke.linkInfo.<boardId>.<pid> holds the
 *   linkOpenSince it was shown for), never for the owner.
 *
 * `storage` is the facade of util/storage.js (webStorage()); a storage
 * failure never throws here.
 */
import { t } from '../util/l10n.js'
import { keys } from '../util/storage.js'
import { httpUrl } from './legal.js'

/**
 * The built-in notice text. The voting role has its own: voting clients send
 * no presence (SPEC-M1 §6.4) and votes are anonymous, so the edit wording
 * ("your name, your cursor and everything you add") would contradict "Your
 * votes are anonymous." right above it.
 *
 * @param {{vote?: boolean}} [o] vote: the person can only vote (link or share role vote)
 * @return {string} the built-in notice text
 */
export function builtInText({ vote = false } = {}) {
	return vote
		? t('knorke', 'Others on this board see neither your cursor nor how you vote. The board is stored on this Nextcloud server.')
		: t('knorke', 'Everyone on this board sees your name, your cursor and everything you add or change. The board is stored on this Nextcloud server.')
}

/** @return {string} what guests of a board open by link see (badge title, account card) */
export function explainText() {
	return t('knorke', 'Guests can join this board through a link without an account. They see the display names and cursors of everyone on the board and all of its content.')
}

/**
 * @param {unknown} privacy initial state `privacy`
 * @param {{vote?: boolean}} [o] vote: the built-in text of the voting role (an admin text stays as it is)
 * @return {string} the admin's text when it is not empty, else the built-in text
 */
export function noticeText(privacy, { vote = false } = {}) {
	const text = privacy && typeof privacy === 'object' && typeof privacy.text === 'string' ? privacy.text : ''
	return text.trim() !== '' ? text : builtInText({ vote })
}

/**
 * @param {unknown} privacy initial state `privacy`
 * @return {string} the privacy policy URL when it is an absolute http(s) URL, else ''
 */
export function noticeUrl(privacy) {
	return httpUrl(privacy && typeof privacy === 'object' ? privacy.url : null)
}

/**
 * Is the board open by link right now? The live `board.links` of owners and
 * moderators (share dialog) when present: an edit or vote link that has no
 * expiry or expires after nowMs. Otherwise the snapshot's
 * `board.linkOpenSince` (members; null = no active link).
 *
 * @param {object|null} board merged board view
 * @param {number} nowMs server time
 * @return {boolean}
 */
export function linkOpen(board, nowMs) {
	if (!board || typeof board !== 'object') {
		return false
	}
	const links = board.links
	if (links && typeof links === 'object' && !Array.isArray(links)) {
		return ['edit', 'vote'].some((role) => {
			const l = links[role]
			if (!l || typeof l !== 'object') {
				return false
			}
			return l.expiresAt === null || l.expiresAt === undefined || (Number.isFinite(l.expiresAt) && l.expiresAt > nowMs)
		})
	}
	return Number.isFinite(board.linkOpenSince)
}

/**
 * @param {object} storage webStorage() facade
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 * @return {string|null} the stored value, null when missing or unreadable
 */
function read(storage, kind, key) {
	try {
		const v = storage.getItem(kind, key)
		return typeof v === 'string' ? v : null
	} catch (e) {
		return null
	}
}

/**
 * @param {object} storage webStorage() facade
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 * @param {string} value value
 * @return {boolean} stored
 */
function write(storage, kind, key, value) {
	try {
		return storage.setItem(kind, key, value) === true
	} catch (e) {
		return false
	}
}

/**
 * Is the account's one-time info due? Never for the owner, never without
 * `me` or without a number in `board.linkOpenSince`; due when the stored
 * value is missing, no number, or smaller than linkOpenSince (renewing,
 * switching on again or turning on the second link makes a newer row).
 *
 * @param {{board: object|null, me: object|null, isOwner: boolean}} o board view, me, owner
 * @param {object} storage webStorage() facade
 * @return {boolean}
 */
export function accountInfoDue({ board, me, isOwner }, storage) {
	if (isOwner || !board || !me || typeof me.pid !== 'string' || me.pid === '') {
		return false
	}
	const since = board.linkOpenSince
	if (!Number.isFinite(since)) {
		return false
	}
	const raw = read(storage, 'local', keys.linkInfo(board.id, me.pid))
	const seen = raw === null || raw.trim() === '' ? NaN : Number(raw)
	return !Number.isFinite(seen) || seen < since
}

/**
 * Remembers that the info was shown for this linkOpenSince (when it is
 * SHOWN, not when it is closed).
 *
 * @param {{board: object|null, me: object|null}} o board view and me
 * @param {object} storage webStorage() facade
 * @return {boolean} stored
 */
export function markAccountSeen({ board, me }, storage) {
	if (!board || !me || typeof me.pid !== 'string' || !Number.isFinite(board.linkOpenSince)) {
		return false
	}
	return write(storage, 'local', keys.linkInfo(board.id, me.pid), String(board.linkOpenSince))
}

/**
 * @param {object} storage webStorage() facade
 * @param {number} boardId board
 * @return {boolean} this tab session has not shown the guest the notice yet
 *   (also when sessionStorage cannot be read: then the card shows every time)
 */
export function guestInfoDue(storage, boardId) {
	return read(storage, 'session', keys.privacy(boardId)) !== '1'
}

/**
 * @param {object} storage webStorage() facade
 * @param {number} boardId board
 * @return {boolean} stored
 */
export function markGuestSeen(storage, boardId) {
	return write(storage, 'session', keys.privacy(boardId), '1')
}
