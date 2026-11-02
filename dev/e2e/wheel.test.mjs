/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E55 (the mouse wheel zooms, factory job 154), no browser, no
 * stack:
 * - scenarios/index.mjs: E55 once, directly after E54, before E09 (own
 *   board, no instance setting); the flake gate --only E55 --repeat 3 named
 * - E55: alice alone; the menu entry wheel between grid and cursors, the
 *   toast hook, scene().wheel, localStorage knorke.wheel, a reload, the
 *   wheel deltas 100 (a notch of Chrome on Windows), 40 (a trackpad step of
 *   Chrome on macOS) and 40.00244140625 (ten macOS notches), the zoom factor
 *   exp(−0.15), Shift+0 at the end
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * - lib/harness.mjs newActor option wheel ('zoom' | 'pan', wheelInit before
 *   every page); E33 and E48 give it 'pan' to every actor that pans with the
 *   wheel (a Playwright wheel event is a notch under Automatic)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WHEEL_ZOOM, isNotchedWheel } from '../../src/scene/GestureController.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/wheel.mjs')

// harness.mjs reads env.json on import: a throwaway one
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-wheel-'))
fs.writeFileSync(path.join(TMP, 'env.json'), JSON.stringify({ baseNet: 'http://kd.invalid', userPass: 'x', ns: 'd' }))
process.env.KD_ENV_JSON = path.join(TMP, 'env.json')
process.env.KD_E2E_OUT = TMP
const { newActor, wheelInit } = await import('./lib/harness.mjs')
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('index: E55 once, directly after E54, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E55').length, 1)
	assert.equal(list.indexOf('E55'), list.indexOf('E54') + 1, 'directly after E54')
	assert.ok(list.indexOf('E55') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E55 \} from '\.\/wheel\.mjs'$/m)
	assert.ok(idx.includes('gate is --only E55 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E55 = \{\n\tid: 'E55',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E55: the menu entry, the toast, the stage, the key, a reload, the wheel deltas, Shift+0', () => {
	for (const hook of ['[data-knorke-toast=wheel]', '[data-knorke-menu=context]', '[data-knorke-menu-item="wheel"]', '[data-knorke-menu-item]']) {
		assert.ok(src.includes(hook), hook)
	}
	// job 230: wheel first in the board menu, before grid; no cursors entry
	assert.match(src, /names\[0\] === 'wheel' && names\.indexOf\('grid'\) > 0/)
	assert.match(src, /!names\.includes\('cursors'\)/)
	assert.match(src, /getAttribute\('role'\)\) === 'menuitem'/)
	assert.match(src, /getAttribute\('aria-checked'\)\) === null/)
	assert.match(src, /\?\.wheel \?\? null/, 'scene().wheel')
	assert.match(src, /localStorage\.getItem\('knorke\.wheel'\)/)
	assert.match(src, /pa\.reload\(/)
	assert.match(src, /mouse\.wheel\(0, dy\)/)
	assert.match(src, /wheelAt\(pa, P, 100\)/)
	assert.match(src, /const NOTCHES = 40\.00244140625\n/)
	assert.match(src, /wheelAt\(pa, P, NOTCHES\)/)
	assert.match(src, /const WIN_NOTCH = 100\n/)
	assert.match(src, /wheelAt\(pa, P, WIN_NOTCH\)/)
	assert.match(src, /const TRACKPAD = 40\n/)
	assert.match(src, /wheelAt\(pa, P, TRACKPAD\)/)
	// what the app makes of these events as Chromium sends them (wheelDeltaY −120 each)
	assert.equal(isNotchedWheel({ deltaMode: 0, deltaX: 0, deltaY: 40.00244140625, wheelDeltaY: -120 }), true, 'ten macOS notches zoom')
	assert.equal(isNotchedWheel({ deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 }), true, 'a Windows notch zooms')
	assert.equal(isNotchedWheel({ deltaMode: 0, deltaX: 0, deltaY: 40, wheelDeltaY: -120 }), false, 'a macOS trackpad step pans')
	assert.match(src, /const WHEEL_ZOOM = 0\.0015\n/)
	assert.equal(WHEEL_ZOOM, 0.0015, 'the scenario\'s WHEEL_ZOOM is the controller\'s')
	assert.match(src, /keyboard\.press\('Shift\+Digit0'\)/)
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E55: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 30, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})

test('newActor option wheel: only zoom or pan, wheelInit stores knorke.wheel and never throws', async () => {
	const h = read('lib/harness.mjs')
	assert.match(h, /locale = 'en-US', wheel = null, deviceScaleFactor = null, fine = false \} = \{\}\) \{/)
	assert.match(h, /if \(wheel !== null\) await ctx\.addInitScript\(wheelInit, wheel\)/)
	await assert.rejects(newActor(null, 'x', { wheel: 'auto' }), /wheel 'auto' ist ungültig/)
	const saved = globalThis.window
	try {
		const store = new Map()
		globalThis.window = { localStorage: { setItem: (k, v) => store.set(k, v) } }
		wheelInit('pan')
		assert.deepEqual([...store], [['knorke.wheel', 'pan']])
		globalThis.window = { localStorage: { setItem: () => { throw new Error('blocked') } } }
		assert.doesNotThrow(() => wheelInit('zoom'))
	} finally {
		globalThis.window = saved
	}
})

test('E33 and E48: every actor that pans with the wheel has the stage Pan', () => {
	const s3 = read('scenarios/stage3.mjs')
	const e33 = s3.slice(s3.indexOf('export const E33 = {'), s3.indexOf('/** A viewport pass of E33'))
	const opts33 = Object.fromEntries([...e33.matchAll(/const (\w+) = await world\.actor\('[^']+', \{([^}]*)\}\)/g)].map((m) => [m[1], m[2]]))
	assert.deepEqual(Object.keys(opts33), ['a', 'b', 'g'])
	for (const who of ['a', 'b']) {
		assert.match(e33, new RegExp(`(wheelPan|centerOn)\\(${who}\\.page`), who + ' pans with the wheel')
		assert.match(opts33[who], /wheel: 'pan'/, who)
	}
	assert.match(e33, /a\.page\.mouse\.wheel\(0, /, 'alice wheels in the vote loop')
	assert.doesNotMatch(e33, /g\.page\.mouse\.wheel|wheelPan\(g\.page|centerOn\(g\.page/, 'Gina (touch) does not wheel')
	const pl = read('scenarios/place.mjs')
	const actors = [...pl.matchAll(/world\.actor\(([^)]*)\)/g)].map((m) => m[1])
	const wheeled = actors.filter((o) => /'alice-leiste'|'bob-leiste'|alice-leiste-\$\{TABLET\.width\}/.test(o))
	assert.equal(wheeled.length, 3, 'E48 alice and bob, the tablet pass')
	assert.ok(wheeled.every((o) => /wheel: 'pan'/.test(o)), wheeled.join(' | '))
	const phone = pl.slice(pl.indexOf('export const E48_PHONE = {'))
	assert.doesNotMatch(phone, /mouse\.wheel|panTo\(/, 'the phone pass does not wheel')
})
