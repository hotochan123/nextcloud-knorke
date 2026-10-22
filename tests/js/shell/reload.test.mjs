/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RELOAD_PARAM, appScripts, bustUrl, claimReload, hardReload, markerOf, startupReload, strippedUrl } from '../../../src/util/reload.js'

/** @return {object} in-memory storage facade with .session */
function mem() {
	const session = new Map()
	return { session, getItem: (k, key) => (k === 'session' ? session.get(key) ?? null : null), setItem: (k, key, v) => { session.set(key, String(v)); return true } }
}

test('U15 bustUrl/strippedUrl: one fresh query parameter, removed again on start', () => {
	assert.equal(bustUrl('https://nc.test/index.php/apps/knorke/b/7', 'abc'), 'https://nc.test/index.php/apps/knorke/b/7?knorke-reload=abc')
	assert.equal(bustUrl('https://nc.test/x?a=1&knorke-reload=old#h', 'new'), 'https://nc.test/x?a=1&knorke-reload=new#h')
	assert.equal(strippedUrl('https://nc.test/index.php/apps/knorke/b/7?knorke-reload=abc'), '/index.php/apps/knorke/b/7')
	assert.equal(strippedUrl('https://nc.test/x?a=1&knorke-reload=abc#h'), '/x?a=1#h')
	assert.equal(strippedUrl('https://nc.test/x?a=1'), null)
	assert.equal(strippedUrl('not a url'), null)
	assert.equal(RELOAD_PARAM, 'knorke-reload')
})

test('U15 appScripts: only the app\'s own js/*.mjs', () => {
	const doc = {
		querySelectorAll: () => [
			{ src: 'https://nc.test/apps/knorke/js/knorke-main.mjs?v=1a2b' },
			{ src: 'https://nc.test/custom_apps/knorke/js/knorke-main.mjs' },
			{ src: 'https://nc.test/core/js/main.js?v=9' },
			{ src: 'https://nc.test/apps/other/js/x.mjs' },
		],
	}
	assert.deepEqual(appScripts(doc), ['https://nc.test/apps/knorke/js/knorke-main.mjs?v=1a2b', 'https://nc.test/custom_apps/knorke/js/knorke-main.mjs'])
	assert.deepEqual(appScripts(null), [])
})

test('U15 hardReload: refetches the entry script with cache reload, then navigates with a query bump', async () => {
	const events = []
	const win = {
		document: { querySelectorAll: () => [{ src: 'https://nc.test/apps/knorke/js/knorke-main.mjs?v=1' }] },
		fetch: async (url, init) => { events.push(['fetch', url, init.cache]) },
		location: {
			href: 'https://nc.test/index.php/apps/knorke/p/abc',
			replace: (u) => events.push(['replace', u]),
		},
	}
	assert.equal(await hardReload(win, { now: () => 36 ** 3 }), true)
	assert.deepEqual(events, [
		['fetch', 'https://nc.test/apps/knorke/js/knorke-main.mjs?v=1', 'reload'],
		['replace', 'https://nc.test/index.php/apps/knorke/p/abc?knorke-reload=1000'],
	])
	assert.equal(await hardReload(null), false)
})

test('U15 hardReload: a hanging fetch does not block the reload (timeout)', async () => {
	const events = []
	const win = {
		document: { querySelectorAll: () => [{ src: 'https://nc.test/apps/knorke/js/knorke-main.mjs' }] },
		fetch: () => new Promise(() => {}),
		location: { href: 'https://nc.test/a', replace: (u) => events.push(u) },
	}
	await hardReload(win, { now: () => 1, timeoutMs: 5 })
	assert.deepEqual(events, ['https://nc.test/a?knorke-reload=1'])
})

test('M1 §4.3 claimReload: the marker is the server version; the same version reloads once, another one again', () => {
	const st = mem()
	assert.equal(claimReload(st, 3), true)
	assert.equal(st.session.get('knorke.reloaded'), '3')
	assert.equal(claimReload(st, 3), false, 'same jump: frozen, no loop')
	assert.equal(claimReload(st, 4), true, 'a second jump in the same tab session')
	assert.equal(claimReload(st, undefined), true)
	assert.equal(st.session.get('knorke.reloaded'), '?')
	assert.equal(claimReload(st, null), false)
	assert.equal(markerOf(2), '2')
	assert.equal(markerOf('?'), '?')
	assert.equal(markerOf('<script>'), '?')
	assert.equal(markerOf(1.5), '?')
	const legacy = mem()
	legacy.session.set('knorke.reloaded', '1')
	assert.equal(claimReload(legacy, 2), true, 'an M0 marker ("1") does not block a jump to 2')
})

test('M1 §4.3 startupReload (main.js): initial-state protocol ≠ bundle → one hard reload instead of mounting; once per version', async () => {
	const st = mem()
	let reloads = 0
	const warns = []
	const o = { bundleProtocol: 2, storage: st, reload: () => { reloads++ }, warn: (m) => warns.push(m) }
	assert.equal(startupReload({ ...o, pageProtocol: 2 }), false, 'same protocol: mount')
	assert.equal(startupReload({ ...o, pageProtocol: null }), false, 'no initial state: mount')
	assert.equal(startupReload({ ...o, pageProtocol: 3 }), true, 'stale bundle: reload, do not mount')
	await new Promise((r) => setImmediate(r))
	assert.equal(reloads, 1)
	assert.equal(st.session.get('knorke.reloaded'), '3')
	assert.equal(startupReload({ ...o, pageProtocol: 3 }), false, 'tried once already: mount (the 409 banner follows)')
	assert.equal(reloads, 1)
	assert.equal(warns.length, 1)
	const failing = { ...o, storage: mem(), reload: () => Promise.reject(new Error('x')) }
	assert.equal(startupReload({ ...failing, pageProtocol: 5 }), true, 'a failing reload never throws into main.js')
	await new Promise((r) => setImmediate(r))
})

test('M1 §4.3 main.js mounts only when startupReload says so; the session uses claimReload (one marker rule)', () => {
	const main = readFileSync(new URL('../../../src/main.js', import.meta.url), 'utf8')
	assert.match(main, /if \(!startupReload\(\{ pageProtocol: state\.protocol, bundleProtocol: PROTOCOL, reload: \(\) => hardReload\(window\) \}\)\) \{[\s\S]*app\.mount\(root\)/)
	assert.doesNotMatch(main, /console\.warn\('\[knorke\] page protocol/)
	const session = readFileSync(new URL('../../../src/board/BoardSession.js', import.meta.url), 'utf8')
	assert.match(session, /claimReload\(this\.storage, version\)/)
	assert.doesNotMatch(session, /setItem\('session', k, '1'\)/, 'the M0 marker "1" is gone')
})
