/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Screen wake lock (SPEC-M1 §6.6 tablet details, stage 3): while a vote
 * session is open or a timer runs the screen of a tablet must not dim.
 * navigator.wakeLock.request('screen') where it exists (iPadOS 18.4+,
 * Chromium); without the API nothing happens. The browser drops the lock
 * when the page is hidden; want(true) asks again when the page becomes
 * visible. want(false) and destroy() release it.
 */

/**
 * @param {object} [o] injection points (tests)
 * @param {object} [o.nav] navigator
 * @param {object} [o.doc] document (visibilityState, visibilitychange)
 * @return {{want: (on: boolean) => void, held: () => boolean, destroy: () => void}}
 */
export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
	let wanted = false
	let sentinel = null
	let pending = false
	const api = () => (nav && nav.wakeLock && typeof nav.wakeLock.request === 'function' ? nav.wakeLock : null)
	const visible = () => !doc || doc.visibilityState !== 'hidden'
	const acquire = () => {
		const wl = api()
		if (!wl || sentinel || pending || !wanted || !visible()) {
			return
		}
		pending = true
		Promise.resolve()
			.then(() => wl.request('screen'))
			.then((s) => {
				pending = false
				if (!wanted) {
					s?.release?.().catch?.(() => {})
					return
				}
				sentinel = s ?? null
				sentinel?.addEventListener?.('release', () => {
					sentinel = null
				})
			})
			.catch(() => {
				pending = false
			})
	}
	const release = () => {
		const s = sentinel
		sentinel = null
		try {
			s?.release?.()?.catch?.(() => {})
		} catch (e) {
			// released already
		}
	}
	const onVisibility = () => {
		if (visible()) {
			acquire()
		} else {
			release()
		}
	}
	doc?.addEventListener?.('visibilitychange', onVisibility)
	return {
		want(on) {
			wanted = !!on
			if (wanted) {
				acquire()
			} else {
				release()
			}
		},
		held() {
			return sentinel !== null
		},
		destroy() {
			wanted = false
			release()
			doc?.removeEventListener?.('visibilitychange', onVisibility)
		},
	}
}
