/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Browser-side rules of the acceptance run that do not need a stack or a
 * browser (tested with fake pages in dev/e2e/browsers.test.mjs):
 *
 * - Page errors (ENTWICKLUNG §5.2: a pageerror fails the running scenario).
 *   An actor watches its first page AND every later page of its context
 *   (second tabs, helper pages, popups): ctx.on('page'). A page is watched
 *   once per sink.
 * - Navigation windows (WebKit): WPE reports a fetch that a navigation cancels
 *   (a /sync tick in flight when the page leaves) as a pageerror
 *   "Fetch API cannot load … due to access control checks.". Such an error is
 *   tolerated only inside a recorded navigation window of the error list;
 *   every other error counts.
 * - Headless Firefox reports no pointer at all: (any-pointer: fine) is false,
 *   so Knorke runs its view-only device mode (src/util/device.js) and offers
 *   no editing. The pointer prefs give it a mouse (fine | hover = 2 | 4).
 *   Probe 12.10.2026 (Playwright 1.49.1 image): without prefs any-pointer
 *   fine/hover false, with them true; Chromium and WebKit true anyway.
 */

/** A pageerror as it goes into the report (message, at most 300 characters). */
export const errorText = (e) => String(e?.message || e).slice(0, 300)

const WATCHED = new WeakMap()

/**
 * Collects the pageerrors of `page` into the array `sink`; `tag` prefixes the
 * entry (e.g. "Tab 2: "). Registers at most once per page and sink.
 * @return {boolean} true when a listener was added
 */
export function watchPage(page, sink, tag = '') {
	let sinks = WATCHED.get(page)
	if (!sinks) {
		sinks = new Set()
		WATCHED.set(page, sinks)
	}
	if (sinks.has(sink)) return false
	sinks.add(sink)
	page.on('pageerror', (e) => sink.push(tag + errorText(e)))
	return true
}

/**
 * Watches the first page of a context and every page the context opens
 * later; entries of later pages carry "Tab <n>: ".
 */
export function watchContext(ctx, page, sink) {
	watchPage(page, sink)
	let n = 1
	ctx.on('page', (p) => { watchPage(p, sink, `Tab ${++n}: `) })
}

/** WebKit's message for a fetch cancelled by a navigation. */
export const NAV_ABORT_RE = /due to access control checks/

/**
 * The errors that count: everything except NAV_ABORT_RE matches whose index
 * lies inside one of the navigation windows [from, to) of the list.
 * @param {string[]} errors
 * @param {Array<[number, number]>} windows
 */
export function countedErrors(errors, windows = [], re = NAV_ABORT_RE) {
	return errors.filter((e, i) => !(re.test(e) && windows.some(([from, to]) => i >= from && i < to)))
}

/** Firefox prefs: a fine pointer with hover (SPEC-M1 §1.4: paste must work in Firefox). */
export const FIREFOX_POINTER_PREFS = Object.freeze({ 'ui.primaryPointerCapabilities': 6, 'ui.allPointerCapabilities': 6 })

/** Launch options of the Firefox part of E24. */
export const firefoxLaunchOptions = () => ({ firefoxUserPrefs: { ...FIREFOX_POINTER_PREFS } })

/** Default timeout of the Firefox actor (its first Nextcloud login is slow). */
export const FIREFOX_TIMEOUT_MS = 30000

/**
 * The note of an aborted report part (SPEC-M1 §21, R10: the Firefox part of
 * E24 broke off twice at the Nextcloud login and its note kept only the first
 * line of the error): the step that was running, the first line of the error
 * and the last `lines` lines of Playwright's call log ("Call log:" section;
 * without one, the last lines of the message after its first line), joined
 * with " / ", at most `max` characters in all.
 * @param {unknown} e the error
 * @param {string} step the step that was running
 * @return {string}
 */
export function abortNote(e, step, { lines = 5, max = 900 } = {}) {
	const msg = String(e?.message ?? e ?? '').replace(/\r\n/g, '\n')
	const all = msg.split('\n')
	const first = (all[0] || '').trim() || '(ohne Meldung)'
	const at = all.findIndex((l) => /^\s*Call log:\s*$/.test(l))
	const tail = (at >= 0 ? all.slice(at + 1) : all.slice(1)).map((l) => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean)
	const log = tail.slice(-Math.max(0, lines))
	const head = `abgebrochen bei „${step}“: ${first}`
	const text = log.length ? `${head} | Aufruf-Log (letzte ${log.length} von ${tail.length} Zeilen): ${log.join(' / ')}` : head
	return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/**
 * Runs `fn(1)`; when it throws, calls `onRetry(error)` and runs `fn(2)` once
 * more (the optional second Firefox login of E24, R10). The second error is
 * thrown with the first one as `firstError`.
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{onRetry?: (e: unknown) => (void|Promise<void>)}} [o]
 * @return {Promise<{value: T, attempts: number, firstError: (unknown|null)}>}
 */
export async function retryOnce(fn, { onRetry = null } = {}) {
	try {
		return { value: await fn(1), attempts: 1, firstError: null }
	} catch (e1) {
		if (onRetry) await onRetry(e1)
		try {
			return { value: await fn(2), attempts: 2, firstError: e1 }
		} catch (e2) {
			if (e2 && typeof e2 === 'object') e2.firstError = e1
			throw e2
		}
	}
}
