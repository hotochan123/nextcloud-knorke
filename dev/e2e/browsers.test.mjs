/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the page-error and browser rules of the acceptance run
 * (lib/browsers.mjs, Actor in lib/harness.mjs, World in scenarios/world.mjs),
 * with fake pages and contexts – no browser, no stack. Regressions of the
 * stage-1 fix round (findings R2, R3):
 *  - a second tab of an actor (E24 board 2) and an actor dropped before the
 *    end of its scenario must still fail the scenario on a pageerror;
 *  - the WebKit part of E24 checks its own actor's errors and tolerates WPE's
 *    "access control checks" only inside navigation windows;
 *  - Firefox runs with a fine pointer (else Knorke's view-only device mode)
 *    and a longer login timeout;
 *  - (SPEC-M1 §21, R10) an aborted Firefox part keeps the running step and
 *    the last lines of Playwright's call log, and the login gets one retry.
 * Run:
 *   node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	watchPage, watchContext, countedErrors, errorText, NAV_ABORT_RE, FIREFOX_POINTER_PREFS, firefoxLaunchOptions, FIREFOX_TIMEOUT_MS,
	abortNote, retryOnce,
} from './lib/browsers.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')

// harness.mjs and world.mjs read env.json on import: a throwaway one
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-browsers-'))
fs.writeFileSync(path.join(TMP, 'env.json'), JSON.stringify({ baseNet: 'http://kd.invalid', userPass: 'x', ns: 'd' }))
process.env.KD_ENV_JSON = path.join(TMP, 'env.json')
process.env.KD_E2E_OUT = TMP
const { Actor } = await import('./lib/harness.mjs')
const { World } = await import('./scenarios/world.mjs')
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const fakePage = () => new EventEmitter()
const fakeCtx = () => new EventEmitter()
const WPE_ABORT = 'Fetch API cannot load http://knorke-dev-d-nc/index.php/apps/knorke/api/v1/boards/01ABC/sync due to access control checks.'

test('watchPage: collects pageerrors (message, ≤ 300 characters) once per page and sink', () => {
	const p = fakePage()
	const sink = []
	assert.equal(watchPage(p, sink), true)
	assert.equal(watchPage(p, sink), false, 'second registration for the same sink is a no-op')
	p.emit('pageerror', new Error('boom'))
	p.emit('pageerror', 'x'.repeat(400))
	assert.deepEqual(sink, ['boom', 'x'.repeat(300)])
	const other = []
	assert.equal(watchPage(p, other, 'Tab 2: '), true, 'another sink on the same page is allowed')
	p.emit('pageerror', new Error('zwei'))
	assert.deepEqual(other, ['Tab 2: zwei'])
	assert.equal(errorText({ message: 'm' }), 'm')
})

test('watchContext: the first page and every later page of the context report into the sink', () => {
	const ctx = fakeCtx()
	const first = fakePage()
	const sink = []
	watchContext(ctx, first, sink)
	const second = fakePage()
	const third = fakePage()
	ctx.emit('page', second)
	ctx.emit('page', third)
	first.emit('pageerror', new Error('eins'))
	second.emit('pageerror', new Error('clipboard.js: paste kaputt'))
	third.emit('pageerror', new Error('drei'))
	assert.deepEqual(sink, ['eins', 'Tab 2: clipboard.js: paste kaputt', 'Tab 3: drei'])
})

test('Actor (harness.mjs): a second tab of the context (E24 pB, Firefox p2) feeds actor.errors (R2)', () => {
	const ctx = fakeCtx()
	const page = fakePage()
	const a = new Actor('alice-clip', ctx, page, 'user')
	const pB = fakePage()
	ctx.emit('page', pB)
	page.emit('pageerror', new Error('Seite A'))
	pB.emit('pageerror', new Error('pasteItems: TypeError'))
	assert.deepEqual(a.errors, ['Seite A', 'Tab 2: pasteItems: TypeError'])
	// World.resetErrors clears in place: the listeners keep the same array
	a.errors.length = 0
	pB.emit('pageerror', new Error('danach'))
	assert.deepEqual(a.errors, ['Tab 2: danach'])
})

test('World: errors of an actor dropped before the end of the scenario still fail it; resetErrors clears them (R2)', async () => {
	const w = new World(null)
	const mk = (name) => ({ name, errors: [], closed: false, async close() { this.closed = true } })
	const a = mk('alice-clip')
	const b = mk('bob')
	w.actors.add(a)
	w.actors.add(b)
	a.errors.push('Tab 2: pasteItems: TypeError')
	await w.drop(a)
	assert.equal(a.closed, true)
	assert.equal(w.actors.has(a), false)
	b.errors.push('noch offen')
	assert.deepEqual(w.pageErrors(), ['alice-clip: Tab 2: pasteItems: TypeError', 'bob: noch offen'])
	w.resetErrors()
	assert.deepEqual(w.pageErrors(), [], 'the next scenario starts clean')
	await w.drop(null)
	await w.drop(b)
	assert.deepEqual(w.pageErrors(), [], 'a clean actor adds nothing')
})

test('countedErrors: WPE "access control checks" is tolerated only inside a navigation window', () => {
	assert.match(WPE_ABORT, NAV_ABORT_RE)
	const errs = [WPE_ABORT, 'TypeError: clip.items is undefined', WPE_ABORT, `Tab 2: ${WPE_ABORT}`]
	assert.deepEqual(countedErrors(errs, [[0, 1]]), ['TypeError: clip.items is undefined', WPE_ABORT, `Tab 2: ${WPE_ABORT}`])
	assert.deepEqual(countedErrors(errs, [[0, 1], [2, 4]]), ['TypeError: clip.items is undefined'])
	assert.deepEqual(countedErrors(errs, []), errs, 'without a window every error counts')
	assert.deepEqual(countedErrors(['TypeError'], [[0, 1]]), ['TypeError'], 'other errors count inside a window too')
	assert.deepEqual(countedErrors(errs, [[1, 1]]), errs, 'an empty window tolerates nothing')
})

test('Firefox: pointer prefs give a fine pointer with hover, a fresh object per launch, 30 s timeout (R3)', () => {
	assert.deepEqual({ ...FIREFOX_POINTER_PREFS }, { 'ui.primaryPointerCapabilities': 6, 'ui.allPointerCapabilities': 6 })
	assert.equal(FIREFOX_POINTER_PREFS['ui.primaryPointerCapabilities'] & 2, 2, 'fine')
	assert.equal(FIREFOX_POINTER_PREFS['ui.primaryPointerCapabilities'] & 4, 4, 'hover')
	const o = firefoxLaunchOptions()
	assert.deepEqual(o, { firefoxUserPrefs: { ...FIREFOX_POINTER_PREFS } })
	assert.notEqual(o.firefoxUserPrefs, firefoxLaunchOptions().firefoxUserPrefs)
	assert.ok(FIREFOX_TIMEOUT_MS >= 30000)
})

test('stage1.mjs E24 uses the rules: Firefox prefs + timeout + uiMode note, WebKit waitIdle before board 2 and its own error check (R2, R3)', () => {
	const src = read('scenarios/stage1.mjs')
	const wk = src.slice(src.indexOf('async function webkitPart('), src.indexOf('async function firefoxReport('))
	const ff = src.slice(src.indexOf('async function firefoxReport('), src.indexOf('// ── E25'))
	assert.ok(wk.length > 100 && ff.length > 100, 'both parts found')
	assert.match(ff, /firefox\.launch\(firefoxLaunchOptions\(\)\)/)
	assert.doesNotMatch(src, /firefox\.launch\(\s*\)/, 'no Firefox without pointer prefs')
	assert.match(ff, /newActor\(browser, 'alice-firefox', \{[^}]*timeout: FIREFOX_TIMEOUT_MS/)
	assert.match(ff, /uiMode/)
	assert.match(ff, /f\.errors/)
	// WebKit: idle before leaving board 1, the navigation is a recorded window, then the error check on both paths
	const goto = wk.indexOf('await p.goto(`${APP}/b/${b2}`')
	assert.ok(goto > 0)
	assert.match(wk.slice(0, goto), /await K\.waitIdle\(p\)\s*\n\s*const navFrom = w\.errors\.length\s*\n\s*$/)
	assert.match(wk, /nav\.push\(\[navFrom, w\.errors\.length\]\)/)
	// (returns of page callbacks sit deeper than three tabs)
	assert.doesNotMatch(wk.slice(0, wk.indexOf('} catch (e) {')), /^\t{1,3}return\b/m, 'no early return past the error check')
	assert.match(wk, /const errs = countedErrors\(w\.errors, nav\)\s*\n\s*t\.check\(errs\.length === 0, '\[C\] WebKit: keine Seitenfehler/)
	// the Actor watches its whole context (pB of E24 needs no own listener)
	assert.match(read('lib/harness.mjs'), /watchContext\(ctx, page, this\.errors\)/)
})

// Playwright's message of the two Firefox aborts on nf (SPEC-M1 §21), shape as Playwright 1.49 prints it
const PW_TIMEOUT = [
	'page.click: Timeout 30000ms exceeded.',
	'Call log:',
	'  - waiting for locator(\'button[type=submit]\')',
	'  -   locator resolved to <button type="submit" class="button-vue">…</button>',
	'  - attempting click action',
	'  -   waiting for element to be visible, enabled and stable',
	'  -   element is visible, enabled and stable',
	'  -   scrolling into view if needed',
	'  -   done scrolling',
	'  -   <div class="login-box">…</div> intercepts pointer events',
	'  - retrying click action, attempt #57',
	'',
].join('\n')

test('abortNote (R10): step, first line and the last lines of the call log – not only split(\'\\n\')[0]', () => {
	const n = abortNote(new Error(PW_TIMEOUT), 'Nextcloud-Anmeldung')
	assert.match(n, /^abgebrochen bei „Nextcloud-Anmeldung“: page\.click: Timeout 30000ms exceeded\./)
	assert.match(n, /Aufruf-Log \(letzte 5 von 9 Zeilen\): element is visible, enabled and stable \/ scrolling into view if needed \/ done scrolling \/ <div class="login-box">…<\/div> intercepts pointer events \/ retrying click action, attempt #57$/)
	assert.doesNotMatch(n, /locator resolved/, 'only the last five lines')
	assert.match(abortNote(new Error(PW_TIMEOUT), 'x', { lines: 1 }), /letzte 1 von 9 Zeilen\): retrying click action, attempt #57$/)
	// no call log: the last lines after the first; a plain value; a missing message
	assert.equal(abortNote(new Error('eins\nzwei\ndrei'), 'S', { lines: 1 }), 'abgebrochen bei „S“: eins | Aufruf-Log (letzte 1 von 2 Zeilen): drei')
	assert.equal(abortNote('nur Text', 'S'), 'abgebrochen bei „S“: nur Text')
	assert.equal(abortNote(undefined, 'S'), 'abgebrochen bei „S“: (ohne Meldung)')
	assert.ok(abortNote(new Error('x'.repeat(2000)), 'S').length <= 900, 'bounded')
})

test('retryOnce (R10): one more attempt after a failure, the first error kept; a second failure is thrown with firstError', async () => {
	const calls = []
	const ok = await retryOnce(async (n) => { calls.push(n); return 'a' })
	assert.deepEqual(ok, { value: 'a', attempts: 1, firstError: null })
	const seen = []
	const second = await retryOnce(async (n) => { calls.push(n); if (n === 1) throw new Error('Timeout'); return 'b' }, { onRetry: (e) => seen.push(e.message) })
	assert.equal(second.value, 'b')
	assert.equal(second.attempts, 2)
	assert.equal(second.firstError.message, 'Timeout')
	assert.deepEqual(seen, ['Timeout'])
	await assert.rejects(retryOnce(async (n) => { throw new Error('fail ' + n) }), (e) => e.message === 'fail 2' && e.firstError.message === 'fail 1')
	assert.deepEqual(calls, [1, 1, 2])
})

test('stage1.mjs, Firefox part of E24 (R10): the running step is tracked, an abort note comes from abortNote, the login goes through retryOnce', () => {
	const src = read('scenarios/stage1.mjs')
	const ff = src.slice(src.indexOf('async function firefoxReport('), src.indexOf('// ── E25'))
	assert.match(ff, /let step = '/)
	assert.ok((ff.match(/\n\t\tstep = '/g) || []).length >= 6, 'step set before every phase')
	assert.match(ff, /retryOnce\(\(\) => login\(p, 'alice'\), \{/)
	assert.match(ff, /zweiter Anmeldeversuch: ok/)
	assert.match(ff, /\} catch \(e\) \{\n\t\tout\.push\(abortNote\(e, step\)\)/)
	assert.doesNotMatch(ff, /split\('\\n'\)\[0\]/, 'no longer just the first line')
	assert.match(ff, /newActor\(browser, 'alice-firefox', \{ timeout: FIREFOX_TIMEOUT_MS \}\)/, 'the actor logs in through retryOnce, not inside newActor')
})

test('harness helpers of round 1b: transformer vs. "+"/end handles, nearest handle, point on a box border, put.connector', async () => {
	const { TRANSFORM_HANDLES, END_HANDLES, PLUS_HANDLES, handleNames, pickHandle, extraHandles, nearestHandle, onBorder, nearPt, put } = await import('./lib/harness.mjs')
	const geo = await import('./lib/geom.mjs')
	assert.deepEqual([...TRANSFORM_HANDLES], ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'rot'])
	// R11: the frozen names come from lib/geom.mjs (one definition, re-exported by the harness)
	assert.equal(TRANSFORM_HANDLES, geo.TRANSFORM_HANDLES)
	assert.deepEqual([END_HANDLES, PLUS_HANDLES].map((x) => [...x]), [['start', 'end'], ['plus-t', 'plus-r', 'plus-b', 'plus-l']])
	assert.equal(pickHandle, geo.pickHandle)
	assert.equal(handleNames, geo.handleNames)
	const hs = [{ name: 'tl', x: 0, y: 0 }, { name: 'rot', x: 50, y: -28 }, { name: 'plus-b', x: 50, y: 130 }, { name: 'plus-r', x: 130, y: 50 }, { name: 'end', x: 300, y: 50 }]
	assert.deepEqual(extraHandles(hs).map((h) => h.name), ['plus-b', 'plus-r', 'end'])
	assert.deepEqual(extraHandles(null), [])
	const n = nearestHandle(extraHandles(hs), { x: 52, y: 120 })
	assert.equal(n.name, 'plus-b')
	assert.ok(Math.abs(n.dist - Math.hypot(2, 10)) < 1e-9)
	assert.equal(nearestHandle([], { x: 0, y: 0 }), null)
	const box = { x: 100, y: 50, w: 160, h: 160 }
	assert.equal(onBorder({ x: 260, y: 130 }, box), true, 'right side midpoint')
	assert.equal(onBorder({ x: 261.9, y: 130 }, box, 2), true, 'within the tolerance outside')
	assert.equal(onBorder({ x: 180, y: 130 }, box), false, 'the centre is not on the border')
	assert.equal(onBorder({ x: 265, y: 130 }, box), false, 'beyond the tolerance')
	assert.equal(onBorder(null, box), false)
	assert.equal(nearPt({ x: 1, y: 1 }, { x: 2.9, y: -0.9 }, 2), true)
	assert.equal(nearPt({ x: 1, y: 1 }, { x: 3.1, y: 1 }, 2), false)
	const c = put.connector('01KN0RKEK0000000000000000K', { item: 'A' }, { x: 1, y: 2 }, { data: { label: 'x' }, style: { dash: 'dashed' } })
	assert.equal(c.t, 'connector')
	assert.deepEqual([c.p.x, c.p.y, c.p.w, c.p.h, c.p.r, c.p.parent], [0, 0, 0, 0, 0, null], 'placement none (rule 12)')
	assert.deepEqual(c.p.data, { route: 'straight', label: 'x', start: { item: 'A' }, end: { x: 1, y: 2 } })
	assert.deepEqual(c.p.style, { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow', dash: 'dashed' })
	assert.equal(typeof c.p.z, 'string')
})
