/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Initial state of a page (SPEC-M0 §6.6, SPEC-M1 §4.11.3: 10 keys, frozen
 * from stage 0 on; 12 since the M2 privacy notice). The key list is the same as
 * PageController::INITIAL_STATE_KEYS; tests/js/shell/initialState.test.mjs
 * reads the PHP constant as text and keeps both equal. Every page sets every
 * key (inapplicable ones as null).
 *
 * (U9) `legal` = {imprintUrl, privacyUrl} on the guest page (theming's legal
 * links, '' = not configured), null elsewhere: the guest page hides
 * Nextcloud's footer, so the app shows them itself (components/legal.js).
 *
 * (M1 §4.11.3) `linkState` on /p/{token} is 'ok' | 'revoked' | 'invalid' |
 * 'expired' (stage 2). `linkInfo` = {role: 'edit'|'vote', password: boolean}
 * on /p/{token} with linkState 'ok', null elsewhere; always null until
 * stage 2.
 *
 * (M2 privacy notice) `privacy` = {text: string|null, url: string} on every
 * page of routes 1–4: the admin's notice text and privacy policy URL in the
 * page's language (text null = the built-in text, components/privacy.js);
 * null on the admin page. `privacyAdmin` = {settings, languages,
 * themingUrl, textMax, languagesMax} only on the admin page (page 'admin',
 * src/admin/AdminSettings.vue), null elsewhere.
 */
import { loadState } from '@nextcloud/initial-state'

export const STATE_KEYS = Object.freeze(['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal', 'linkInfo', 'privacy', 'privacyAdmin'])

/**
 * @param {(app: string, key: string, fallback: any) => any} [load] loader (tests)
 * @return {Readonly<Record<string, any>>} the initial state, missing keys as null
 */
export function readState(load = loadState) {
	const state = {}
	for (const key of STATE_KEYS) {
		try {
			state[key] = load('knorke', key, null)
		} catch (e) {
			state[key] = null
		}
	}
	return Object.freeze(state)
}
