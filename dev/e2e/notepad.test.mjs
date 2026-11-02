/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E74 (note pads, factory job 188), no browser, no stack:
 * - scenarios/index.mjs: E74 once, directly after E73@820x1180 (job
 *   189's), before E09 (own board, no instance setting); the flake gate
 *   --only E74 --repeat 3 named
 * - E74: one board, alice, bob (a guest of the edit link) and a tablet with
 *   touch; real input for every step (a)–(i) of AK9: the options menu of the
 *   note tool, clicks, drags, a double click, typing, Esc, Enter, Ctrl+Z,
 *   Ctrl+Shift+L, a finger through CDP, a right click and the menu entry
 *   pad-here; the 3 s of AK9 (b); (job 193) the padTitle editor of a new
 *   pad: Esc in (a), "Mehr" and a click beside it, then Ctrl+Z in (i)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/notepad.mjs')

test('index: E74 once, directly after E73_TABLET, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E74').length, 1)
	assert.equal(list.indexOf('E74'), list.indexOf('E73_TABLET') + 1, 'directly after E73_TABLET (E73@820x1180)')
	assert.ok(list.indexOf('E74') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E74 \} from '\.\/notepad\.mjs'$/m)
	assert.ok(idx.includes('--only E74 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E74 = \{\n\tid: 'E74',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 3, 'alice, bob and the tablet')
	assert.match(src, /world\.actor\('tina-pad', \{ touch: true, fine: true \}\)/)
	assert.match(src, /world\.actor\('bob-pad'\)/, 'bob without an account: a guest')
})

test('E74: real input for every step of AK9, the 3 s, the hooks of the note tool and the menu', () => {
	assert.match(src, /\[data-knorke-tool=sticky\]'\)\.first\(\)\.click\(\{ button: 'right'/, 'job 229: the variants by a right-click')
	assert.match(src, /\[data-knorke-tool-option=pad\]/)
	assert.match(src, /press\('n'\)/)
	assert.match(src, /const SEEN_MS = 3000/)
	assert.match(src, /press\('Control\+z'\)/)
	assert.match(src, /press\('Control\+Shift\+L'\)/)
	assert.match(src, /press\('Enter'\)/)
	assert.match(src, /mouse\.dblclick\(/)
	assert.match(src, /'padTitle'/)
	assert.match(src, /Input\.dispatchTouchEvent/)
	assert.match(src, /button: 'right'/)
	// job 230: the menu of the empty canvas no longer lists pad-here; the tool option places the pad
	assert.match(src, /!names\.includes\('pad-here'\)/)
	assert.match(src, /keyboard\.type\('Mehr'\)/, 'job 193: the title of a new pad typed in (i)')
	assert.match(src, /\/vote`/)
	assert.match(src, /notePreview/)
	assert.doesNotMatch(src, /dispatchEvent\(|waitForFunction/, 'no synthetic DOM events, no waitForFunction')
	for (const step of ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)', '(h)', '(i)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E74: every check label names exactly one owner', () => {
	const calls = (src.match(/\bt\.(?:check|must)\(/g) || []).length
	const labels = (src.match(/['`]\[[SCBD]\] /g) || []).length
	assert.ok(calls >= 40, String(calls))
	assert.equal(labels, calls, 'one owner label per check')
	assert.doesNotMatch(src, /['`]\[[A-Z][A-Z]+\] |['`]\[[^SCBD\]]\] /, 'never two owners, never another one')
})
