/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E41 (lock items, factory job 023), no browser, no stack:
 * - scenarios/index.mjs: E41 once, directly after E40, before E09 (own
 *   board, no instance setting), its pass E41@390x844 right behind it; the
 *   flake gate --only E41 --repeat 3 named
 * - E41: alice on her own board, bob as an account through the edit link;
 *   the ten steps with their hooks (lock/unlock actions, the badge, the
 *   menu entry, the toasts lock-delete and lock-undo, Ctrl+Shift+L, LOD 2
 *   and scene().locks; job 044: step (9), bob's board menu without and
 *   alice's with unlock-all, the toast unlock-all, Ctrl+Z; job 062: step
 *   (10), bob's locks on A and C over the API, unlock-by on A, the board
 *   menu inside F ending on unlock-frame, unlock-all)
 * - E41@390x844: a 60-character locker name, the badge cut and in the
 *   viewport, Unlock at least 44 × 44; bob's display name put back in
 *   `finally`
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
const src = read('scenarios/locks.mjs')

test('index: E41 once, directly after E40, before E09; the pass E41@390x844 right behind it; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E41').length, 1)
	assert.equal(list.indexOf('E41'), list.indexOf('E40') + 1, 'directly after E40')
	assert.equal(list.indexOf('E41_PHONE'), list.indexOf('E41') + 1, 'the pass behind its case')
	assert.ok(list.indexOf('E41_PHONE') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E41, E41_PHONE \} from '\.\/locks\.mjs'$/m)
	assert.ok(idx.includes('its flake gate is\n * --only E41 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E41 = \{\n\tid: 'E41',/)
	assert.match(src, /export const E41_PHONE = \{\n\tid: 'E41',\n\tpass: `\$\{PHONE\.width\}x\$\{PHONE\.height\}`,/, 'a pass reporting as E41@390x844')
})

test('E41: alice on her own board, bob as an account through the edit link; the ten steps with their hooks', () => {
	assert.match(src, /world\.board\('E41 Sperren'\)/)
	assert.match(src, /world\.actor\('alice-sperren', \{ user: 'alice' \}\)/)
	assert.match(src, /world\.actor\('bob-sperren', \{ user: 'bob' \}\)/)
	assert.match(src, /await joinAsMember\(bob, L\)/, 'bob joins through the edit link')
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)', '(9)', '(10)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	for (const hook of ['[data-knorke-action=lock]', '[data-knorke-action=unlock]', '[data-knorke-lock-badge=name]', '[data-knorke-lock-badge=mine]',
		'[data-knorke-menu-item=unlock]', '[data-knorke-toast=lock-delete]', '[data-knorke-toast=lock-undo]',
		'[data-knorke-menu-item=unlock-all]', '[data-knorke-toast=unlock-all]', '[data-knorke-menu=context]',
		'[data-knorke-menu-item=unlock-by]', '[data-knorke-menu-item=unlock-frame]']) {
		assert.ok(src.includes(hook), hook)
	}
	// job 044, step (9): after (8), in the same board; bob locks everything, alice unlocks all, Ctrl+Z
	const nine = src.slice(src.indexOf("t.step('(9) "), src.indexOf("t.step('(10) "))
	assert.ok(src.indexOf("t.step('(9) ") > src.indexOf("t.step('(8) "), '(9) after (8)')
	assert.ok(nine.length > 0 && !nine.includes('world.board('), 'the same board')
	assert.match(nine, /pb\.keyboard\.press\('Control\+a'\)\n\t\tawait pb\.keyboard\.press\('Control\+Shift\+L'\)/, 'bob: Ctrl+A, then Ctrl+Shift+L')
	assert.match(nine, /pb\.locator\('\[data-knorke-menu-item=unlock-all\]'\)\.count\(\) === 0/, 'bob has no unlock-all')
	assert.match(nine, /pa\.locator\('\[data-knorke-menu-item=unlock-all\]'\)\.first\(\)\.click\(\)/, 'alice clicks unlock-all')
	assert.match(nine, /\.locks \?\? -1\) === 0/, 'bob: scene().locks = 0')
	assert.match(nine, /pa\.keyboard\.press\('Control\+z'\)[\s\S]*i\.lock\?\.by === alicePid/, 'Ctrl+Z locks in alice\'s name')
	// job 062, step (10): after (9), in the same board
	const ten = src.slice(src.indexOf("t.step('(10) "), src.indexOf('await world.drop(bob)'))
	assert.ok(src.indexOf("t.step('(10) ") > src.indexOf("t.step('(9) "), '(10) after (9)')
	assert.ok(ten.length > 0 && !ten.includes('world.board('), 'the same board')
	assert.match(ten, /seedOps\('alice', board, \[A, C\]\.map\(\(id\) => \(\{ o: 'patch', id, p: \{ lock: null \} \}\)\)\)/, 'alice unlocks A and C over the API')
	assert.match(ten, /seedOps\('bob', board, \[lockOp\(A\), lockOp\(C\)\]\)/, 'bob locks A and C over the API')
	assert.match(ten, /\[B\] \(10\) A und C tragen lock\.by = bobs pid/)
	assert.match(ten, /\[B\] \(10\) F und die übrigen lebenden Objekte tragen lock\.by = alices pid/)
	assert.match(ten, /keyboard\.press\('Escape'\)[\s\S]*centerOf\(pa, A\)[\s\S]*\{ button: 'right' \}/, 'Esc, then a right click on the middle of A')
	assert.match(ten, /getAttribute\('data-knorke-menu-target'\)\) === A,/, 'the menu has the target A')
	assert.match(ten, /byText\.includes\(bobName\)/, 'unlock-by names bob')
	assert.match(ten, /pa\.locator\('\[data-knorke-menu-item=unlock-by\]'\)\.first\(\)\.click\(\)[\s\S]*\[data-knorke-toast=unlock-all\]/, 'a click, then the toast unlock-all')
	assert.match(ten, /screenOf\(pa, 1300, 400\)[\s\S]*canvasAt\(pa, inF\.x, inF\.y\)[\s\S]*\{ button: 'right' \}/, 'the free inside of F at world (1300, 400), checked first')
	assert.match(ten, /getAttribute\('data-knorke-menu-target'\)\) === '',/, 'the board menu')
	assert.match(ten, /names10\.slice\(-2\)\.join\(','\) === 'unlock-frame,unlock-all'/, 'the last two entries')
	assert.match(ten, /pa\.locator\('\[data-knorke-menu-item=unlock-frame\]'\)\.first\(\)\.click\(\)[\s\S]*get\(F\)\?\.lock === null/, 'unlock-frame unlocks F')
	assert.match(src, /keyboard\.press\('Control\+Shift\+L'\)/)
	assert.match(src, /keyboard\.press\('Control\+z'\)[\s\S]*keyboard\.press\('Control\+Shift\+z'\)/)
	assert.match(src, /\{ button: 'right' \}/, 'a real right click')
	assert.match(src, /s && s\.lod === 2/, 'LOD 2 like E36')
	assert.match(src, /\.locks \?\? 0\) >= 1/, 'scene().locks ≥ 1')
})

test('E41@390x844: a 60-character locker name, put back in finally; badge in the viewport and cut; Unlock ≥ 44 × 44', () => {
	assert.match(src, /export const E41_NAME_LEN = 60/)
	assert.match(src, /viewport: PHONE/)
	assert.match(src, /try \{\n\t\t\tconst set = await setDisplayName\('bob', long\)[\s\S]*\} finally \{\n\t\t\tconst back = await setDisplayName\('bob', before\)/, 'the name goes back in finally')
	assert.match(src, /m\.scrollWidth > m\.clientWidth/)
	assert.match(src, /m\.left >= 0 && m\.top >= 0 && m\.right <= m\.vw && m\.bottom <= m\.vh/)
	assert.match(src, /ub\.width >= 44 && ub\.height >= 44/)
})

test('E41: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 30, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})
