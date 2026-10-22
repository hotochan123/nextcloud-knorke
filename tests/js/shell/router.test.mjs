/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Leave guard of the mini router (T3): every in-app route change away from
 * a board (push, replace, browser Back/Forward) asks the registered guards
 * first. Runs against a fake window with a History API stand-in.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addLeaveGuard, current, onRouteChange, push, replace } from '../../../src/router.js'

const LIST = '/index.php/apps/knorke/'
const BOARD7 = '/index.php/apps/knorke/b/7'
const BOARD8 = '/index.php/apps/knorke/b/8'

/** @return {Promise<void>} lets pending promise chains run */
const flush = () => new Promise((resolve) => setImmediate(resolve))

/**
 * @param {string} path start path
 * @return {object} fake window (also installed as globalThis.window)
 */
function install(path) {
	const pop = new Set()
	const w = {
		_oc_webroot: '',
		location: { pathname: path },
		entries: [path],
		index: 0,
		history: {
			pushState(state, title, url) {
				w.entries.splice(w.index + 1)
				w.entries.push(url)
				w.index++
				w.location.pathname = url
			},
			replaceState(state, title, url) {
				w.entries[w.index] = url
				w.location.pathname = url
			},
		},
		addEventListener(type, fn) {
			if (type === 'popstate') {
				pop.add(fn)
			}
		},
		removeEventListener(type, fn) {
			if (type === 'popstate') {
				pop.delete(fn)
			}
		},
		/** @param {number} delta history.go(delta): the URL changes first, then popstate fires */
		go(delta) {
			w.index += delta
			w.location.pathname = w.entries[w.index]
			for (const fn of [...pop]) {
				fn({ state: {} })
			}
		},
		popListeners: () => pop.size,
	}
	globalThis.window = w
	return w
}

test('leave guard on push: false keeps route and URL on the board; true navigates', async () => {
	const w = install(BOARD7)
	const seen = []
	const off = onRouteChange((r) => seen.push(r))
	const asked = []
	let answer = false
	const unguard = addLeaveGuard((to, from) => {
		asked.push([to, from])
		return answer
	})
	assert.equal(await push({ name: 'list' }), false)
	assert.equal(w.location.pathname, BOARD7, 'URL stays on the board')
	assert.deepEqual(seen, [], 'route stays on the board')
	assert.deepEqual(asked, [[{ name: 'list' }, { name: 'board', id: 7 }]])
	answer = true
	assert.equal(await push({ name: 'list' }), true)
	assert.equal(w.location.pathname, LIST)
	assert.deepEqual(seen, [{ name: 'list' }])
	assert.deepEqual(w.entries, [BOARD7, LIST])
	unguard()
	off()
	assert.equal(w.popListeners(), 0, 'the popstate listener goes with the last subscriber')
})

test('leave guard on replace: false keeps the entry; an async true replaces it', async () => {
	const w = install(BOARD7)
	const seen = []
	const off = onRouteChange((r) => seen.push(r))
	let answer = false
	const unguard = addLeaveGuard(() => new Promise((resolve) => setImmediate(() => resolve(answer))))
	assert.equal(await replace({ name: 'board', id: 8 }), false)
	assert.deepEqual(w.entries, [BOARD7])
	answer = true
	assert.equal(await replace({ name: 'board', id: 8 }), true)
	assert.deepEqual(w.entries, [BOARD8])
	assert.deepEqual(seen, [{ name: 'board', id: 8 }])
	unguard()
	off()
})

test('leave guard on browser Back (popstate): false restores the board URL and keeps the route; true navigates', async () => {
	const w = install(LIST)
	const seen = []
	const off = onRouteChange((r) => seen.push(r))
	assert.equal(await push({ name: 'board', id: 7 }), true, 'no guard yet')
	let answer = false
	const asked = []
	const unguard = addLeaveGuard((to, from) => {
		asked.push([to, from])
		return Promise.resolve(answer)
	})
	w.go(-1)
	await flush()
	assert.deepEqual(asked, [[{ name: 'list' }, { name: 'board', id: 7 }]])
	assert.equal(w.location.pathname, BOARD7, 'board URL restored with pushState')
	assert.equal(current().name, 'board')
	assert.deepEqual(seen, [{ name: 'board', id: 7 }], 'the list was never shown')
	answer = true
	w.go(-1)
	await flush()
	assert.equal(w.location.pathname, LIST)
	assert.deepEqual(seen, [{ name: 'board', id: 7 }, { name: 'list' }])
	unguard()
	off()
})

test('the guard runs only when the route changes; a push while a guard is pending is ignored', async () => {
	const w = install(BOARD7)
	const seen = []
	const off = onRouteChange((r) => seen.push(r))
	let release = null
	let calls = 0
	const unguard = addLeaveGuard(() => {
		calls++
		return new Promise((resolve) => { release = resolve })
	})
	assert.equal(await push({ name: 'board', id: 7 }), true, 'same route: no guard')
	assert.equal(calls, 0)
	const first = push({ name: 'list' })
	await flush()
	assert.equal(calls, 1)
	assert.equal(await push({ name: 'board', id: 8 }), false, 'second navigation while asking')
	assert.equal(calls, 1)
	release(true)
	assert.equal(await first, true)
	assert.equal(w.location.pathname, LIST)
	assert.deepEqual(seen.map((r) => r.name), ['board', 'list'])
	unguard()
	// without guards the router navigates as before
	assert.equal(await push({ name: 'board', id: 8 }), true)
	w.go(-1)
	await flush()
	assert.equal(seen[seen.length - 1].name, 'list')
	off()
})

test('a throwing guard does not trap the user on the board', async () => {
	const w = install(BOARD7)
	const off = onRouteChange(() => {})
	const unguard = addLeaveGuard(() => { throw new Error('boom') })
	const err = console.error
	console.error = () => {}
	try {
		assert.equal(await push({ name: 'list' }), true)
	} finally {
		console.error = err
	}
	assert.equal(w.location.pathname, LIST)
	unguard()
	off()
})
