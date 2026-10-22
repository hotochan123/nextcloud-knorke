/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Cache-busting reload (U15, SPEC-M0 §6.5): after a 409 `protocol` the page
 * runs an outdated bundle. A plain location.reload() can bring the same
 * cached entry script back (same URL, long cache lifetime), and the next
 * /sync answers 409 again. hardReload() therefore
 *   1. refetches the app's entry scripts with cache 'reload', which replaces
 *      their entries in the HTTP cache (best effort, at most timeoutMs), and
 *   2. navigates to the same URL with a fresh query parameter, so no cache
 *      on the way can answer the page itself from memory.
 * main.js removes the parameter from the address bar again on start.
 *
 * Reload marker (SPEC-M1 §4.3, Abweichung zu M0: there the marker was '1'):
 * sessionStorage knorke.reloaded holds the SERVER protocol a reload was made
 * for (from the 409 body, the snapshot/join answer or the initial state;
 * '?' when unknown). A tab reloads automatically only when the marker differs
 * from that version: the same jump reloads once and then freezes (a cached
 * stale bundle cannot loop), a second jump in the same tab session reloads
 * again. claimReload() is the one place that decides and records it; the
 * board session (409) and main.js (initial state) both use it.
 */
import { keys, webStorage } from './storage.js'

/** Query parameter of the cache-busting reload. */
export const RELOAD_PARAM = 'knorke-reload'

/**
 * @param {unknown} version server protocol (number), '?' or anything else
 * @return {string} the marker value for it ('?' when it is not a protocol)
 */
export function markerOf(version) {
	if (Number.isInteger(version)) {
		return String(version)
	}
	return typeof version === 'string' && /^[A-Za-z0-9?]{1,16}$/.test(version) ? version : '?'
}

/**
 * May this tab reload automatically for a jump to `version`? Records the
 * version when it may (call it only right before reloading).
 *
 * @param {{getItem: Function, setItem: Function}} storage storage facade (util/storage.js)
 * @param {unknown} version server protocol of the jump
 * @return {boolean} true: reload now (marker set); false: this version was reloaded for already
 */
export function claimReload(storage, version) {
	const v = markerOf(version)
	if (storage.getItem('session', keys.reloaded()) === v) {
		return false
	}
	storage.setItem('session', keys.reloaded(), v)
	return true
}

/**
 * main.js on start (SPEC-M1 §4.3): the page came fresh from the server, so an
 * initial-state protocol other than the bundle's means the bundle came from a
 * stale cache. Reload once past every cache (same marker as a 409) instead of
 * only warning; when this version was tried already, warn and go on (the
 * first /sync then answers 409 and the board shows the reload banner).
 *
 * @param {object} o inputs
 * @param {unknown} o.pageProtocol initial state `protocol` (null when missing)
 * @param {number} o.bundleProtocol PROTOCOL of this bundle
 * @param {object} [o.storage] storage facade
 * @param {() => unknown} [o.reload] the reload (hardReload(window))
 * @param {(msg: string) => void} [o.warn] warning sink
 * @return {boolean} true: a reload was started, do not mount the app
 */
export function startupReload({ pageProtocol, bundleProtocol, storage = webStorage(), reload = () => hardReload(), warn = (m) => console.warn(m) }) {
	if (pageProtocol === null || pageProtocol === undefined || pageProtocol === bundleProtocol) {
		return false
	}
	if (claimReload(storage, pageProtocol)) {
		Promise.resolve()
			.then(() => reload())
			.catch(() => {
				// the page stays; the first /sync answers 409 and shows the banner
			})
		return true
	}
	warn('[knorke] page protocol ' + pageProtocol + ' differs from bundle protocol ' + bundleProtocol + ' (stale bundle, reloaded once already)')
	return false
}

/**
 * @param {string} href current URL
 * @param {string} stamp unique value
 * @return {string} href with RELOAD_PARAM=stamp (replacing an older one)
 */
export function bustUrl(href, stamp) {
	const u = new URL(href)
	u.searchParams.set(RELOAD_PARAM, stamp)
	return u.toString()
}

/**
 * @param {string} href current URL
 * @return {string|null} path + query + hash without RELOAD_PARAM, null when it is absent
 */
export function strippedUrl(href) {
	let u
	try {
		u = new URL(href)
	} catch (e) {
		return null
	}
	if (!u.searchParams.has(RELOAD_PARAM)) {
		return null
	}
	u.searchParams.delete(RELOAD_PARAM)
	return u.pathname + u.search + u.hash
}

/**
 * @param {Document|null} doc document
 * @return {string[]} URLs of the app's own scripts (js/*.mjs of the knorke app)
 */
export function appScripts(doc) {
	try {
		return [...doc.querySelectorAll('script[src]')]
			.map((s) => s.src)
			.filter((src) => typeof src === 'string' && /\/knorke\/js\/[^/?#]+\.mjs(?:[?#]|$)/.test(src))
	} catch (e) {
		return []
	}
}

/**
 * Reloads the page past every cache (see the file comment).
 *
 * @param {Window|null} [win] window
 * @param {{now?: () => number, timeoutMs?: number}} [o] options
 * @return {Promise<boolean>} false when there is no location to change
 */
export async function hardReload(win = globalThis.window ?? null, { now = Date.now, timeoutMs = 1500 } = {}) {
	if (!win?.location) {
		return false
	}
	const scripts = appScripts(win.document ?? null)
	if (scripts.length > 0 && typeof win.fetch === 'function') {
		let timer = null
		try {
			await Promise.race([
				Promise.allSettled(scripts.map((src) => win.fetch(src, { cache: 'reload', credentials: 'same-origin' }))),
				new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
			])
		} catch (e) {
			// best effort
		} finally {
			if (timer !== null) {
				clearTimeout(timer)
			}
		}
	}
	try {
		win.location.replace(bustUrl(win.location.href, Math.floor(now()).toString(36)))
	} catch (e) {
		win.location.reload?.()
	}
	return true
}
