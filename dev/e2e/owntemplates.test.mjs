/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E72 (template suggestions, factory job 182), no browser, no
 * stack:
 * - scenarios/index.mjs: E72 once, directly after E71 (job 184's), before
 *   E09 (own boards, no instance setting); the flake gate --only E72
 *   --repeat 3 named
 * - E72: one board of alice through the world, bob's and the admin's boards
 *   created and deleted by their owners, the edit link for the guest; the
 *   steps (a)–(g); every template deleted before the case and in its
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
const src = read('scenarios/owntemplates.mjs')

test('index: E72 once, directly after E71, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E72').length, 1)
	assert.equal(list.indexOf('E72'), list.indexOf('E71') + 1, 'directly after E71')
	assert.ok(list.indexOf('E72') < list.indexOf('E09'), 'before E09 (own boards)')
	assert.match(idx, /^import \{ E72 \} from '\.\/owntemplates\.mjs'$/m)
	assert.ok(idx.includes('is --only E72 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E72 = \{\n\tid: 'E72',/)
})

test('E72: one board of alice; bob\'s and the admin\'s boards deleted by them; the guest through the edit link; every template deleted before and after', () => {
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board of alice through the world')
	assert.match(src, /const own = await createBoard\('bob', /)
	assert.match(src, /const adminBoard = await createBoard\(ENV\.admin\.user, /)
	const fin = src.slice(src.lastIndexOf('} finally {'))
	assert.match(fin, /await cleanup\(\)/, 'the templates go in the finally')
	assert.match(fin, /api\('bob', 'DELETE', `\/api\/v1\/boards\/\$\{own\}`\)/)
	assert.match(fin, /api\(ENV\.admin\.user, 'DELETE', `\/api\/v1\/boards\/\$\{adminBoard\}`\)/)
	assert.ok(src.indexOf('await cleanup()') < src.indexOf('world.board('), 'and before the case starts')
	const cleanup = src.match(/async function cleanup\(\) \{[\s\S]*?\n\}/)[0]
	assert.match(cleanup, /api\(ENV\.admin\.user, 'GET', '\/api\/v1\/templates\/review'\)/)
	assert.match(cleanup, /\.\.\.\(r\.data\?\.suggestions \?\? \[\]\), \.\.\.\(r\.data\?\.templates \?\? \[\]\)/, 'suggestions and adopted ones')
	assert.match(cleanup, /api\(ENV\.admin\.user, 'DELETE', `\/api\/v1\/templates\/\$\{e\.id\}`\)/)
	assert.match(src, /\/p\/\$\{token\}/, 'Gina joins through the edit link')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 4, 'alice, bob, the admin and Gina')
})

test('E72: the steps (a)–(g)', () => {
	for (const step of ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.match(src, /menuAction\(pb, 'save-template', \{ menus: BOARD_MENUS \}\)/, '(a) through the board menu')
	assert.match(src, /\$\{SUGGEST\} \[data-knorke-template-note\]`\)\.first\(\)\.fill\(NOTE_A\)/, '(a) with a note')
	assert.match(src, /entries\[entries\.indexOf\('export-csv'\) \+ 1\] === 'save-template'/, '(a) the context menu entry after export-csv')
	assert.match(src, /nameB\.press\('Enter'\)/, '(a) Enter sends')
	assert.match(src, /'Waiting for approval'/, '(b) waiting')
	assert.match(src, /\[data-knorke-template-withdraw="\$\{eB\.id\}"\]/, '(b) the withdraw button')
	assert.match(src, /\$\{WITHDRAW\} \[data-knorke-action=confirm\]/, '(b) after the question')
	assert.match(src, /notificationsOf\(user\)|noteOf\(ENV\.admin\.user, eA\.id\)/, '(c) the admin\'s OCS list')
	assert.match(src, /\/ocs\/v2\.php\/apps\/notifications\/api\/v2\/notifications/)
	assert.match(src, /settings\/admin\/knorke/, '(c) the admin section')
	assert.match(src, /\[data-knorke-action=template-adopt\]/, '(c) Adopt')
	assert.match(src, /\[data-knorke-own-template="\$\{eA\.id\}"\]`\)\.first\(\)\.click\(\)[\s\S]*?getAttribute\('data-knorke-picked'\)[\s\S]*?\$\{DIALOG\} \[data-knorke-action=confirm\]`\)\.first\(\)\.click\(\)/, '(d) job 237: the click picks, "Insert" inserts')
	assert.match(src, /pa\.keyboard\.press\('Control\+z'\)/, '(d) Ctrl+Z')
	assert.match(src, /nameField\.press\('Enter'\)/, '(e) rename with Enter')
	assert.match(src, /\[data-knorke-dialog=template-delete\] \[data-knorke-action=confirm\]/, '(e) delete after the question')
	assert.match(src, /\[data-knorke-dialog=template-reject\] \[data-knorke-action=confirm\]/, '(f) reject after the question')
	assert.match(src, /count\(pg, '\[data-knorke-action=save-template\]'\)\) === 0/, '(g) the guest has no entry')
	assert.match(src, /count\(pg, `\$\{DIALOG\} \$\{BUILTIN\}`\)\) === 4/, '(g) exactly 4 tiles')
	for (const name of ['NAME_A', 'NAME_A2', 'NAME_B', 'NAME_C', 'NAME_D', 'NOTE_A']) {
		assert.ok(src.match(new RegExp(`^export const ${name} = '([^']+)'$`, 'm'))?.[1].startsWith('E72 '), `${name} starts with E72`)
	}
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
})

test('E72: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 60, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
