/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Device class (SPEC-M0 §6.6). Without a fine pointer (tablet, phone) M0 only
 * lets you look: pan, zoom, see cursors. The role stays `edit`; only the UI
 * offers no editing. (any-pointer: fine) is false with hasTouch + isMobile in
 * Chromium (checked for E11), true as soon as a mouse or a pen is connected.
 */

/**
 * @param {Window|undefined} [win] window (tests)
 * @return {boolean} true when the device has no fine pointer at all
 */
export function isViewOnlyDevice(win = globalThis.window) {
	try {
		if (!win || typeof win.matchMedia !== 'function') {
			return false
		}
		return !win.matchMedia('(any-pointer: fine)').matches
	} catch (e) {
		return false
	}
}

/**
 * @param {Window|undefined} [win] window (tests)
 * @return {boolean} true in a secure context (clipboard, randomUUID available)
 */
export function isSecureContext(win = globalThis.window) {
	try {
		return !!(win && win.isSecureContext)
	} catch (e) {
		return false
	}
}

/**
 * Apple platform (macOS, iPadOS, iOS): shortcut hints with ⌘ and
 * aria-keyshortcuts Meta+… instead of Ctrl/Control+… (SPEC-M1 §6.6, §6.5.3).
 *
 * @param {Navigator|undefined} [nav] navigator (tests)
 * @return {boolean} true on an Apple platform
 */
export function isApplePlatform(nav = globalThis.navigator) {
	try {
		const p = nav?.userAgentData?.platform || nav?.platform || ''
		return /^(mac|iphone|ipad|ipod)|macos|macintosh/i.test(String(p))
	} catch (e) {
		return false
	}
}
