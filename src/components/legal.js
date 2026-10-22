/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The instance's legal links on the guest page (U9, SPEC-M0 §6.6). The page
 * hides Nextcloud's public footer (F7: it would cover the canvas), which is
 * where theming puts the imprint and the privacy policy. The server hands
 * them over as initial state `legal` = {imprintUrl, privacyUrl} ('' = not
 * configured); the name dialog, the guest top bar menu and the empty states
 * of the guest page show the configured ones.
 *
 * Only absolute http(s) URLs pass (the server checks too): a javascript: or
 * data: value must never reach an href. Links open in a new tab with
 * rel="noopener noreferrer", so the board keeps running.
 */
import { t } from '../util/l10n.js'

/**
 * @param {unknown} v value from the initial state
 * @return {string} v when it is an absolute http(s) URL with a host, else ''
 */
export function httpUrl(v) {
	if (typeof v !== 'string') {
		return ''
	}
	const s = v.trim()
	if (s === '' || s.length > 2048 || /[\u0000- \u007f]/.test(s)) {
		return ''
	}
	try {
		const u = new URL(s)
		return (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== '' ? s : ''
	} catch (e) {
		return ''
	}
}

/**
 * @param {object|null} legal initial state `legal`
 * @return {Array<{key: 'imprint'|'privacy', label: string, href: string}>} the configured links, imprint first
 */
export function legalLinks(legal) {
	if (!legal || typeof legal !== 'object') {
		return []
	}
	const out = []
	const imprint = httpUrl(legal.imprintUrl)
	if (imprint !== '') {
		out.push({ key: 'imprint', label: t('knorke', 'Legal notice'), href: imprint })
	}
	const privacy = httpUrl(legal.privacyUrl)
	if (privacy !== '') {
		out.push({ key: 'privacy', label: t('knorke', 'Privacy policy'), href: privacy })
	}
	return out
}
