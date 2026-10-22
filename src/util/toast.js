/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Minimal toasts instead of @nextcloud/dialogs (Pulse port, SPEC-M0 §6.6):
 * dialogs would add about 280 KB to the bundle just to show a line of text.
 * No dependencies; works on the signed-in page and on the guest page, follows
 * the Nextcloud theme through CSS variables (styles in knorke.css, classes
 * knorke-toast*) and respects prefers-reduced-motion. Text goes through
 * textContent only.
 *
 * SPEC-M1 §6.8 (stage 3): a toast can carry a test hook
 * [data-knorke-toast=<hook>] (vote-miss, vote-limit, vote-closed): the second
 * argument is the timeout (ms) or {timeout?, hook?}.
 */

/** Hook values a toast may carry ([data-knorke-toast], SPEC-M1 §6.8). */
const HOOK_RE = /^[a-z][a-z0-9-]{0,31}$/

/**
 * @param {number|{timeout?: number, hook?: string}|undefined} o timeout or options
 * @param {number} fallback default timeout
 * @return {{timeout: number, hook: (string|null)}}
 */
function optsOf(o, fallback) {
	if (typeof o === 'number') {
		return { timeout: o, hook: null }
	}
	const timeout = o && Number.isFinite(o.timeout) && o.timeout > 0 ? o.timeout : fallback
	const hook = o && typeof o.hook === 'string' && HOOK_RE.test(o.hook) ? o.hook : null
	return { timeout, hook }
}

let container = null

/**
 * @return {HTMLElement|null} the toast container, created on first use
 */
function ensureContainer() {
	if (typeof document === 'undefined' || !document.body) {
		return null
	}
	if (container && document.body.contains(container)) {
		return container
	}
	container = document.createElement('div')
	container.className = 'knorke-toasts'
	document.body.appendChild(container)
	return container
}

/**
 * @param {string} message text (plain, never HTML)
 * @param {{variant?: 'error'|'success'|'info', timeout?: number, hook?: (string|null)}} [opts] options
 * @return {{hideToast: () => void}}
 */
function showToast(message, opts = {}) {
	const host = ensureContainer()
	if (!host) {
		return { hideToast() {} }
	}
	const variant = opts.variant || 'error'
	const el = document.createElement('div')
	el.className = 'knorke-toast knorke-toast--' + variant
	el.setAttribute('role', variant === 'error' ? 'alert' : 'status')
	if (opts.hook) {
		el.setAttribute('data-knorke-toast', opts.hook)
	}
	el.textContent = String(message ?? '')
	const remove = () => {
		if (!el.parentNode) {
			return
		}
		el.classList.add('knorke-toast--out')
		setTimeout(() => el.remove(), 200)
	}
	el.addEventListener('click', remove)
	host.appendChild(el)
	setTimeout(remove, opts.timeout || 5000)
	return { hideToast: remove }
}

/**
 * Error message (red, role=alert). Click or timeout closes it.
 *
 * @param {string} message text
 * @param {number|{timeout?: number, hook?: string}} [o] ms, or {timeout, hook}
 * @return {{hideToast: () => void}}
 */
export function showError(message, o = 5000) {
	return showToast(message, { variant: 'error', ...optsOf(o, 5000) })
}

/**
 * Success message (green, role=status).
 *
 * @param {string} message text
 * @param {number|{timeout?: number, hook?: string}} [o] ms, or {timeout, hook}
 * @return {{hideToast: () => void}}
 */
export function showSuccess(message, o = 3000) {
	return showToast(message, { variant: 'success', ...optsOf(o, 3000) })
}

/**
 * Neutral message (role=status).
 *
 * @param {string} message text
 * @param {number|{timeout?: number, hook?: string}} [o] ms, or {timeout, hook}
 * @return {{hideToast: () => void}}
 */
export function showInfo(message, o = 4000) {
	return showToast(message, { variant: 'info', ...optsOf(o, 4000) })
}
