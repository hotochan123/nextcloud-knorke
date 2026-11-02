/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E65 (voting only with an account, factory job 175) and E71
 * (the accounts-only note in the name dialog, factory job 184), no browser,
 * no stack:
 * - scenarios/index.mjs: E65 once, directly after E64 (job 174's), before E09
 *   (own board, no instance setting); the flake gate --only E65 --repeat 3
 *   named; E71 once, directly after E70 (job 181's), before E09; its flake
 *   gate --only E71 --repeat 3 named
 * - E65: alice, bob (edit share), Vera (voting link, desktop) and Gina (edit
 *   link, 390 × 844 with touch) on one board; the hooks of the switch, the
 *   notices, "Sign in" and the toast; route 22 with accountsOnly; Vera's
 *   vote ops watched; the sign-in as carol; a second session without the
 *   option
 * - E71: its own board; route 22 with accountsOnly; the dialog hooks; a
 *   desktop guest on the voting link, a phone guest on the edit link (44 px,
 *   no overflow, joins as a guest); the sign-in as carol with canVote; no
 *   note without the option or with a link password
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
const src = read('scenarios/accounts.mjs')
const e65 = src.slice(src.indexOf('export const E65 = {'), src.indexOf('// ---- E71'))
const e71 = src.slice(src.indexOf('// ---- E71'))

test('index: E65 once, directly after E64, before E09; E71 once, directly after E70, before E09; flake gates named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E65').length, 1)
	assert.equal(list.indexOf('E65'), list.indexOf('E64') + 1, 'directly after E64')
	assert.ok(list.indexOf('E65') < list.indexOf('E09'), 'before E09 (own board)')
	assert.equal(list.filter((x) => x === 'E71').length, 1)
	assert.equal(list.indexOf('E71'), list.indexOf('E70') + 1, 'directly after E70')
	assert.ok(list.indexOf('E71') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E65, E71 \} from '\.\/accounts\.mjs'$/m)
	assert.ok(idx.includes('is --only E65 --repeat 3.'), 'flake gate named')
	assert.ok(idx.includes('is --only E71 --repeat 3.'), 'flake gate E71 named')
	assert.match(src, /export const E65 = \{\n\tid: 'E65',/)
	assert.match(src, /export const E71 = \{\n\tid: 'E71',/)
	assert.ok(e65.length > 0 && e71.length > 0)
	assert.equal((e65.match(/\bworld\.board\(/g) || []).length, 1, 'E65: one board')
	assert.equal((e71.match(/\bworld\.board\(/g) || []).length, 1, 'E71: its own board')
})

test('E65: alice, bob, Vera on the voting link and Gina on a phone; the hooks; route 22 with accountsOnly; no vote op from Vera; the sign-in as carol; a session without the option', () => {
	assert.match(e65, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(e65, /linkOf\(board, 'votelink'\)/)
	assert.match(e65, /world\.actor\('gina-accounts', \{ touch: true, viewport: PHONE \}\)/)
	assert.equal((e65.match(/\bworld\.actor\(/g) || []).length, 4, 'alice, bob, Vera, Gina')
	for (const hook of ['[data-knorke-field=vote-accounts]', '[data-knorke-vote-accounts=note]', '[data-knorke-vote-accounts=guest]', '[data-knorke-action=vote-signin]', '[data-knorke-toast=vote-accounts-note]']) {
		assert.ok(src.includes(hook), hook)
	}
	assert.match(e65, /sent\.accountsOnly === true/)
	assert.match(e65, /veraVotes\.n === before/)
	assert.match(e65, /scroll <= fit\.client \+ 1/)
	assert.match(e65, /inBox\.height >= 44/)
	assert.match(e65, /loginHere\(v\.page, 'carol'\)/)
	assert.match(e65, /redirect_url/)
	assert.match(e65, /apiStart\(board\)/)
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)']) {
		assert.ok(e65.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E71: route 22 with accountsOnly; the dialog hooks; desktop guest on the voting link, phone guest on the edit link; the sign-in as carol; no note without the option or with a password', () => {
	assert.match(e71, /apiStart\(board, \{ accountsOnly: true \}\)/)
	assert.match(e71, /linkOf\(board, 'link'\)/)
	assert.match(e71, /linkOf\(board, 'votelink'\)/)
	for (const hook of ["'[data-knorke=accounts-vote]'", '[data-knorke-action=guest-signin]', "'[data-knorke-field=guest-name]'", '[data-knorke-field=guest-password]', 'GUEST, 6000']) {
		assert.ok(e71.includes(hook), hook)
	}
	assert.match(e71, /fresh\('vera-dialog', LV\)/, 'a fresh desktop guest on the voting link')
	assert.match(e71, /fresh\('gina-dialog', LE, \{ touch: true, viewport: PHONE \}\)/, 'a fresh phone guest with touch on the edit link')
	assert.match(e71, /nameFocused\(v\.page\)/, 'the focus in the name field')
	assert.match(e71, /DIALOG_TEXT\.anonymous/)
	assert.match(e71, /inBox\.height >= 44/)
	assert.match(e71, /m\.scroll <= m\.client \+ 1/)
	assert.match(e71, /action\(g\.page, 'guest-join'\)/)
	assert.match(e71, /loginHere\(v\.page, 'carol'\)/)
	assert.match(e71, /redirect\.includes\(`\/apps\/knorke\/p\/\$\{LV\}`\)/)
	assert.match(e71, /canVote === true/)
	assert.match(e71, /apiEnd\(board\)[\s\S]*apiStart\(board\)[\s\S]*password: E71_PW[\s\S]*apiStart\(board, \{ accountsOnly: true \}\)/, 'without the option, then a password and accountsOnly again')
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)']) {
		assert.ok(e71.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E65, E71: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 60, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
