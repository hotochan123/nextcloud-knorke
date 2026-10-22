/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * CSRF request token of the signed-in page (SPEC-M0 §4.2).
 *
 * Same storage as @nextcloud/auth (globalThis._nc_auth_requestToken first,
 * then <head data-requesttoken>), so every bundle on the page sees a refreshed
 * token. Deliberately not imported from @nextcloud/auth: that module touches
 * `window` at import time, which would keep the transport out of the Node
 * tests.
 */

/**
 * @return {string|null} current request token
 */
export function getRequestToken() {
	if (typeof globalThis._nc_auth_requestToken === 'string' && globalThis._nc_auth_requestToken !== '') {
		return globalThis._nc_auth_requestToken
	}
	try {
		return globalThis.document?.head?.dataset?.requesttoken ?? null
	} catch (e) {
		return null
	}
}

/**
 * @param {string} token new request token
 */
export function setRequestToken(token) {
	if (typeof token !== 'string' || token === '') {
		return
	}
	globalThis._nc_auth_requestToken = token
	try {
		if (globalThis.document?.head) {
			globalThis.document.head.dataset.requesttoken = token
		}
	} catch (e) {
		// head not writable: the global above is enough for this bundle
	}
}
