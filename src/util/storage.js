/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Web storage that never throws (SPEC-M0 §6.5): private windows, blocked
 * cookies or a full quota make localStorage/sessionStorage throw on access.
 * Every caller in the app goes through these helpers and treats a failure as
 * "nothing stored".
 *
 * Keys used by Knorke:
 *   localStorage   knorke.cam.<boardId>     camera {x, y, scale}
 *   localStorage   knorke.guest.<boardId>   guest {token, name, link}
 *   sessionStorage knorke.client.<boardId>  client id of this tab
 *   sessionStorage knorke.reloaded          one reload after 409 protocol
 *   localStorage   knorke.clip              last copy {v, ts, text, payload}
 *                                            (SPEC-M1 §6.5.3, TTL 10 min)
 *   localStorage   knorke.mute              '1' = no sound at the timer's end
 *                                            (SPEC-M1 §6.6 util/sound.js)
 *   localStorage   knorke.grid              '1' = background grid on (SPEC-M1 §1.2 R12, per person)
 *   localStorage   knorke.gridSnap          '0' = no snapping to the shown grid (per person; missing = snap)
 *   sessionStorage knorke.privacy.<boardId>  '1' = this tab showed the guest the privacy notice
 *                                            (M2: name dialog or the info card, once per tab session)
 *   localStorage   knorke.linkInfo.<boardId>.<pid>  linkOpenSince (ms, as text) the account's
 *                                            one-time privacy info was shown for (M2, per device)
 */

/**
 * @param {'local'|'session'} kind storage kind
 * @return {Storage|null}
 */
function store(kind) {
	try {
		const s = kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage
		return s ?? null
	} catch (e) {
		return null
	}
}

/**
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 * @return {string|null} stored string or null
 */
export function getItem(kind, key) {
	try {
		const s = store(kind)
		return s ? s.getItem(key) : null
	} catch (e) {
		return null
	}
}

/**
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 * @param {string} value value
 * @return {boolean} true when stored
 */
export function setItem(kind, key, value) {
	try {
		const s = store(kind)
		if (!s) {
			return false
		}
		s.setItem(key, value)
		return true
	} catch (e) {
		return false
	}
}

/**
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 */
export function removeItem(kind, key) {
	try {
		store(kind)?.removeItem(key)
	} catch (e) {
		// nothing to do
	}
}

/**
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 * @return {any} parsed JSON value or null (missing or unparsable)
 */
export function getJson(kind, key) {
	const s = getItem(kind, key)
	if (s === null) {
		return null
	}
	try {
		return JSON.parse(s)
	} catch (e) {
		return null
	}
}

/**
 * @param {'local'|'session'} kind storage kind
 * @param {string} key key
 * @param {unknown} value value (JSON-serialisable)
 * @return {boolean} true when stored
 */
export function setJson(kind, key, value) {
	let s
	try {
		s = JSON.stringify(value)
	} catch (e) {
		return false
	}
	return setItem(kind, key, s)
}

/** Key helpers, so no caller spells a key by hand. */
export const keys = Object.freeze({
	camera: (boardId) => 'knorke.cam.' + boardId,
	guest: (boardId) => 'knorke.guest.' + boardId,
	client: (boardId) => 'knorke.client.' + boardId,
	reloaded: () => 'knorke.reloaded',
	clip: () => 'knorke.clip',
	mute: () => 'knorke.mute',
	grid: () => 'knorke.grid',
	gridSnap: () => 'knorke.gridSnap',
	privacy: (boardId) => 'knorke.privacy.' + boardId,
	linkInfo: (boardId, pid) => 'knorke.linkInfo.' + boardId + '.' + pid,
})

/**
 * Storage facade for one board session (injectable in tests).
 *
 * @return {{getJson: Function, setJson: Function, getItem: Function, setItem: Function, removeItem: Function}}
 */
export function webStorage() {
	return { getJson, setJson, getItem, setItem, removeItem }
}
