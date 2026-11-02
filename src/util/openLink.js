/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (Factory job 279) Opens a link of a text in a new tab: only http, https
 * and mailto (model/richText.js linkAllowed), without opener and referrer.
 */
import { linkAllowed } from '../model/richText.js'

/**
 * @param {string} href address
 * @param {object} [win] window (tests)
 * @return {boolean} it was opened
 */
export function openLink(href, win = globalThis.window) {
	if (!linkAllowed(href) || typeof win?.open !== 'function') return false
	win.open(href, '_blank', 'noopener,noreferrer')
	return true
}
