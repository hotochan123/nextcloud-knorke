/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Mini router over the History API (SPEC-M0 §6.6), no vue-router:
 *   /apps/knorke/            → {name: 'list'}
 *   /apps/knorke/b/{id}      → {name: 'board', id}
 *   /apps/knorke/join/{tok}  → {name: 'join', token}
 * The server renders the same page for all three (PageController), so a
 * reload on any of them lands in the right view.
 *
 * Leave guards (T3): before ANY route change (push, replace, browser
 * Back/Forward) the registered guards are asked; the board view registers
 * one, because unmounting it ends the session and drops what the server has
 * not acknowledged (beforeunload never fires for History-API navigation).
 * A guard may answer asynchronously (it can wait for the sync and then ask
 * the user). While a guard is pending, further pushes are ignored and a
 * popstate only moves the target (the URL at the end counts).
 * - push/replace refused: nothing changes.
 * - popstate refused: the browser already changed the URL; the route stays
 *   and the URL of the shown route is restored with pushState.
 */
import { appUrl, pages } from './util/routes.js'

const listeners = new Set()
const guards = new Set()
/** Route last handed to the listeners (what the app shows). */
let shown = null
/** A guard is being asked. */
let guarding = false

/**
 * @param {string} pathname location.pathname
 * @return {{name: 'list'}|{name: 'board', id: number}|{name: 'join', token: string}}
 */
export function parse(pathname) {
	const marker = '/apps/knorke'
	const s = String(pathname ?? '')
	const i = s.indexOf(marker)
	let rest = i >= 0 ? s.slice(i + marker.length) : '/'
	if (rest === '') {
		rest = '/'
	}
	let m = /^\/b\/(\d{1,18})\/?$/.exec(rest)
	if (m) {
		return { name: 'board', id: Number(m[1]) }
	}
	m = /^\/join\/([A-Za-z0-9]{24})\/?$/.exec(rest)
	if (m) {
		return { name: 'join', token: m[1] }
	}
	return { name: 'list' }
}

/**
 * @param {{name: string, id?: number, token?: string}} route route
 * @return {string} URL of the route
 */
export function href(route) {
	if (route.name === 'board') {
		return appUrl(pages.board(route.id).path)
	}
	if (route.name === 'join') {
		return appUrl(pages.join(route.token).path)
	}
	return appUrl(pages.list().path)
}

/** @param {object} route route the listeners get */
function notify(route) {
	shown = route
	for (const fn of [...listeners]) {
		fn(route)
	}
}

/**
 * @param {object} a route
 * @param {object} b route
 * @return {boolean} same page
 */
function sameRoute(a, b) {
	return a.name === b.name && a.id === b.id && a.token === b.token
}

/**
 * Registers a leave guard.
 *
 * @param {(to: object, from: object) => (boolean|Promise<boolean>)} fn false (or a
 *   promise of false) keeps the current route; a guard that throws allows
 * @return {() => void} unregister
 */
export function addLeaveGuard(fn) {
	guards.add(fn)
	return () => {
		guards.delete(fn)
	}
}

/**
 * @param {object} to target route
 * @param {object} from shown route
 * @return {Promise<boolean>} every guard allows the change
 */
async function allowed(to, from) {
	for (const g of [...guards]) {
		let ok = true
		try {
			ok = (await g(to, from)) !== false
		} catch (e) {
			// never trap the user on a page because a guard failed
			console.error('[knorke] leave guard failed', e)
		}
		if (!ok) {
			return false
		}
	}
	return true
}

/**
 * Asks the guards about a change from the shown route to `to`.
 *
 * @param {object} to target route
 * @return {Promise<boolean|null>} true/false; null when a guard is already pending
 */
async function ask(to) {
	const from = shown ?? current()
	if (guards.size === 0 || sameRoute(to, from)) {
		return true
	}
	if (guarding) {
		return null
	}
	guarding = true
	try {
		return await allowed(to, from)
	} finally {
		guarding = false
	}
}

/** Refused: the URL goes back to the shown route (a popstate may have moved it). */
function restore() {
	if (shown && !sameRoute(current(), shown)) {
		window.history.pushState({}, '', href(shown))
	}
}

/**
 * @param {{name: string, id?: number, token?: string}} route target
 * @param {boolean} replaceEntry replace the history entry instead of adding one
 * @return {Promise<boolean>} navigated
 */
async function go(route, replaceEntry) {
	const url = href(route)
	const ok = await ask(parse(url))
	if (ok === null) {
		return false
	}
	if (!ok) {
		restore()
		return false
	}
	if (replaceEntry) {
		window.history.replaceState({}, '', url)
	} else {
		window.history.pushState({}, '', url)
	}
	notify(parse(window.location.pathname))
	return true
}

/**
 * Navigates (new history entry) once the leave guards allow it.
 *
 * @param {{name: string, id?: number, token?: string}} route target
 * @return {Promise<boolean>} navigated
 */
export function push(route) {
	return go(route, false)
}

/**
 * Navigates without a new history entry (join → board) once the leave
 * guards allow it.
 *
 * @param {{name: string, id?: number, token?: string}} route target
 * @return {Promise<boolean>} navigated
 */
export function replace(route) {
	return go(route, true)
}

/** Browser Back/Forward: the URL has already changed. */
async function onPop() {
	const ok = await ask(current())
	if (ok === null) {
		// a guard is pending; its outcome decides with the URL as it is then
		return
	}
	if (ok) {
		notify(current())
	} else {
		restore()
	}
}

/**
 * @param {(route: object) => void} fn called on push/replace/popstate
 * @return {() => void} unsubscribe
 */
export function onRouteChange(fn) {
	if (listeners.size === 0) {
		shown = current()
		window.addEventListener('popstate', onPop)
	}
	listeners.add(fn)
	return () => {
		if (listeners.delete(fn) && listeners.size === 0) {
			window.removeEventListener('popstate', onPop)
		}
	}
}

/** @return {object} route of the current location */
export function current() {
	return parse(window.location.pathname)
}
