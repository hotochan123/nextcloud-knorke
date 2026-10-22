/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Copies a short text (a link URL) for the share dialog (SPEC-M1 §6.6:
 * "URL kopieren", "Copy board link"). navigator.clipboard only in a secure
 * context (SPEC-M0 §0); http://knorke-dev-* is not one, there a hidden
 * textarea with document.execCommand('copy') inside the same click does it.
 * When both fail the caller selects the visible field and asks for Ctrl+C.
 */
import { isSecureContext } from '../util/device.js'

/**
 * @param {string} text text to copy
 * @param {{doc?: Document}} [o] document (tests)
 * @return {Promise<boolean>} copied
 */
export async function copyText(text, { doc = globalThis.document } = {}) {
	if (typeof text !== 'string' || text === '') {
		return false
	}
	const clip = isSecureContext() ? globalThis.navigator?.clipboard : null
	if (clip && typeof clip.writeText === 'function') {
		try {
			await clip.writeText(text)
			return true
		} catch (e) {
			// fall through to the textarea
		}
	}
	if (!doc || !doc.body || typeof doc.execCommand !== 'function') {
		return false
	}
	const active = doc.activeElement
	const ta = doc.createElement('textarea')
	ta.value = text
	ta.setAttribute('readonly', '')
	ta.setAttribute('aria-hidden', 'true')
	ta.style.position = 'fixed'
	ta.style.top = '-1000px'
	ta.style.opacity = '0'
	// inside an open modal (focus trap) the textarea must live in the dialog
	const host = active && typeof active.closest === 'function' ? (active.closest('[role="dialog"]') ?? doc.body) : doc.body
	host.appendChild(ta)
	let ok = false
	try {
		ta.focus({ preventScroll: true })
		ta.select()
		ok = doc.execCommand('copy') === true
	} catch (e) {
		ok = false
	} finally {
		ta.remove()
		try {
			active?.focus?.({ preventScroll: true })
		} catch (e) {
			// the element is gone
		}
	}
	return ok
}
