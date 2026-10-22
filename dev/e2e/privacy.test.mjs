/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E43/E44 (privacy notice, factory job 032), no browser, no
 * stack:
 * - scenarios/index.mjs: E43 and E44 once each, directly after E42_PHONE,
 *   before E09 (instance settings, reset in `finally`); since factory job
 *   049 E45 stands between E44 and E09
 * - lib/harness.mjs: newActor knows the option locale; the admin logs in
 *   (and calls the API) with ENV.admin.pass
 * - E43/E44 put the notice back (PUT {} in finally), E43 also the theming
 *   URLs; World.cleanup resets the notice once more
 * - every check label names exactly one owner (SPEC-M1 §9.6); no
 *   waitForFunction (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/privacy.mjs')

test('index: E43 and E44 once, directly after E42_PHONE, before E09 (not directly: E45 may stand between)', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E43').length, 1)
	assert.equal(list.filter((x) => x === 'E44').length, 1)
	assert.equal(list.indexOf('E43'), list.indexOf('E42_PHONE') + 1, 'E43 directly after E42@390x844')
	assert.equal(list.indexOf('E44'), list.indexOf('E43') + 1)
	assert.ok(list.indexOf('E09') > list.indexOf('E44'), 'before E09 (since factory job 049 E45 stands between them)')
	assert.match(idx, /^import \{ E43, E44 \} from '\.\/privacy\.mjs'$/m)
	assert.match(src, /export const E43 = \{\n\tid: 'E43',/)
	assert.match(src, /export const E44 = \{\n\tid: 'E44',/)
})

test('harness: newActor option locale (default en-US); the admin logs in and calls the API with ENV.admin.pass', () => {
	const h = read('lib/harness.mjs')
	assert.match(h, /export async function newActor\(browser, name, \{[^}]*locale = 'en-US',[^}]*\} = \{\}\)/)
	assert.match(h, /const opts = \{ locale, viewport:/)
	assert.match(h, /export const passOf = \(user\) => \(user === ENV\.admin\?\.user \? ENV\.admin\.pass : ENV\.userPass\)/)
	assert.match(h, /export async function login\(page, user, pass = passOf\(user\)\)/)
	assert.match(h, /Buffer\.from\(`\$\{user\}:\$\{passOf\(user\)\}`\)/, 'api() with the admin password for the admin')
})

test('E43/E44: settings reset in finally; locales de-DE and fr-FR; the steps of AK11–AK15', () => {
	const e43 = src.slice(src.indexOf('export const E43'), src.indexOf('export const E44'))
	const e44 = src.slice(src.indexOf('export const E44'))
	assert.match(e43, /\} finally \{\n\t\t\tawait putNotice\(\{\}\)\.catch\(\(\) => \{\}\)\n\t\t\tawait bridge\('legal-links', 'clear'\)\.catch\(\(\) => \{\}\)/)
	assert.match(e44, /\} finally \{\n\t\t\tawait putNotice\(\{\}\)\.catch\(\(\) => \{\}\)/)
	assert.match(src, /await sleep\(SETTLE_MS\)/)
	assert.match(src, /const SETTLE_MS = 4500/, 'trap 25: 4.5 s after an app-config change')
	for (const loc of ["'de-DE'", "'fr-FR'", "'en-US'"]) {
		assert.ok(e43.includes(loc), loc)
	}
	assert.match(e43, /input\[type=checkbox\]/)
	assert.match(e43, /g\.ctx\.newPage\(\)/, 'a second tab of the same context')
	assert.match(e43, /sessionStorage\.getItem\('knorke\.privacy\.' \+ id\)/)
	for (const step of ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)']) {
		assert.ok(e44.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.match(e44, /linkToken\(B1, true\)/, '(f) the link is renewed')
	assert.match(e44, /\{ user: 'bob', touch: true, viewport: PHONE \}/, '(g) with a coarse pointer')
	assert.match(e44, /on\(cx, cy - 21\)/, '(g) measures the 44 px hit area')
	assert.match(e43, /\/api\/v1\/boards\/\$\{board\}\/votelink/, 'round 1: the voting link\'s dialog')
	assert.match(e43, /BUILT_IN_VOTE/)
	assert.match(e43, /\{ touch: true, viewport: PHONE \}/, 'round 1: the long text at 390 × 844')
	assert.match(e43, /inside: text\.contains\(legal\)/)
	assert.match(e44, /\/index\.php\/settings\/admin\/knorke/)
	assert.match(e44, /api\('bob', 'PUT', '\/api\/v1\/settings\/privacy'/)
	assert.match(read('scenarios/world.mjs'), /if \(this\.touchedPrivacy\) \{\n\t\t\tconst r = await api\(ENV\.admin\.user, 'PUT', '\/api\/v1\/settings\/privacy', \{\}\)/)
})

test('every check label names exactly one owner; waits only from Node', () => {
	for (const m of src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)) {
		assert.match(m[1], /^\[(B|C|D|S)\] /, m[1])
	}
	assert.doesNotMatch(src, /waitForFunction/)
})
