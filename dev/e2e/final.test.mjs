/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E45 (board page after a final status on opening, factory job
 * 049), no browser, no stack:
 * - scenarios/index.mjs: E45 once, directly after E44 and directly before
 *   E09 (own boards, no instance setting); the flake gate
 *   --only E45 --repeat 3 named
 * - E45: the three steps of the spec with their hooks (a stale list with a
 *   link and the keyboard path, a bookmark, a deleted board on a phone with
 *   touch); two boards, so MAX_BOARDS_PER_RUN stays 56 (51 + 2 = 53)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10); no window.__knorke after a failed open
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/final.mjs')
/** The code without comments. */
const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')

test('index: E45 once, directly after E44 and directly before E09; import and flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E45').length, 1)
	assert.equal(list.indexOf('E45'), list.indexOf('E44') + 1, 'directly after E44')
	assert.equal(list.indexOf('E09'), list.indexOf('E45') + 1, 'directly before E09 (own boards, no instance setting)')
	assert.match(idx, /^import \{ E45 \} from '\.\/final\.mjs'$/m)
	const head = idx.slice(idx.indexOf('/*\n'), idx.indexOf('*/', idx.indexOf('/*\n')))
	assert.ok(head.includes('E45'), 'the head comment names E45')
	assert.ok(head.replace(/\n \* /g, ' ').includes('--only E45 --repeat 3'), 'flake gate named')
	assert.match(src, /export const E45 = \{\n\tid: 'E45',/)
})

test('E45: two boards of its own; the board cap stays 56', () => {
	assert.equal((code.match(/world\.board\(/g) || []).length, 2)
	assert.match(src, /world\.board\('E45 Link'\)/)
	assert.match(src, /world\.board\('E45 Gelöscht'\)/)
	assert.match(read('scenarios/world.mjs'), /^export const MAX_BOARDS_PER_RUN = 56$/m, '51 + 2 = 53 boards')
	assert.doesNotMatch(code, /world\.switch\(|bridge\(|setAppConfig|touched/, 'no instance setting')
})

test('E45 (1): a stale list with a link: join through the API, row source link, the link renewed, 404, the click, banner, empty state, no spinner, no title, keyboard', () => {
	for (const step of ['(1)', '(2)', '(3)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.match(src, /api\('bob', 'POST', `\/api\/v1\/links\/\$\{L\}\/join`\)/, 'bob joins through POST /api/v1/links/<token>/join')
	assert.match(src, /\{ rotate \}/)
	assert.match(src, /await linkToken\(A, true\)/, 'alice renews the link (route 9, rotate: true)')
	assert.match(src, /api\('bob', 'GET', `\/api\/v1\/boards\/\$\{A\}\/snapshot`\)/)
	assert.match(src, /snap\.status === 404/)
	assert.match(src, /getAttribute\('data-knorke-board-source'\)/)
	assert.match(src, /src === 'link'/)
	assert.match(src, /const LINK_TEXT = 'Your access through the link ended\. Open the link again\.'/)
	assert.match(src, /const GONE_TEXT = 'This board is no longer available\.'/)
	assert.match(src, /const EMPTY = '\[data-knorke-empty=board-final\]'/)
	assert.match(src, /const BACK = '\[data-knorke-action=back-to-list\]'/)
	assert.match(src, /const SPINNER = '\.knorke-board__loading'/)
	assert.match(src, /'\[data-knorke-banner=gone\]'/)
	assert.match(src, /'Could not open the board'/)
	assert.match(src, /timeout: 10000 \}\)\n\tconst bt = /, 'the banner within 10 s')
	assert.match(src, /await sleep\(3000\)\n\t\tconst spin3 = /, 'no spinner 3 s later either')
	assert.match(src, /!boardText\.includes\(TITLE_A\)/, 'no title of A')
	assert.match(src, /locator\('\[data-knorke-action=back\]'\)\.first\(\)\.focus\(\)/, 'keyboard from the TopBar back arrow')
	assert.match(src, /while \(tabs < 5 && !reached\)/, 'at most 5 Tab presses')
	assert.match(src, /keyboard\.press\('Tab'\)/)
	assert.match(src, /keyboard\.press\('Enter'\)/)
	assert.match(src, /\/\\\/apps\\\/knorke\\\/\?\$\//, 'the URL ends with /apps/knorke/ or /apps/knorke')
	assert.match(src, /const noA = /, 'the reloaded list has no row A')
})

test('E45 (2) bookmark and (3) phone: page.goto /b/A, the general text; a deleted board, a tap, in the 390 × 844 viewport', () => {
	assert.match(src, /p\.goto\(`\$\{APP\}\/b\/\$\{A\}`/)
	assert.match(src, /finalPage\(t, p, GONE_TEXT, 'Lesezeichen'\)/)
	assert.match(src, /b2\.bt !== LINK_TEXT/)
	assert.match(src, /\{ user: 'alice', touch: true, viewport: PHONE \}/)
	assert.match(src, /api\('alice', 'DELETE', `\/api\/v1\/boards\/\$\{B\}`\)/)
	assert.ok(src.indexOf("api('alice', 'DELETE'") < src.indexOf('.tap()'), 'deleted before the tap, with no session on B open (trap 9.11)')
	assert.match(src, /\$\{rowSel\(B\)\} a`\)\.first\(\)\.tap\(\)/, 'a tap on row B')
	assert.match(src, /finalPage\(t, q, GONE_TEXT, 'Telefon'\)/, 'origin own: the general text')
	assert.match(src, /box\.x \+ box\.width <= vp\.width && box\.y \+ box\.height <= vp\.height/)
	assert.match(src, /q\.locator\(BACK\)\.first\(\)\.tap\(\)/)
	assert.match(src, /const noB = /)
})

test('E45: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node; no window.__knorke', () => {
	assert.doesNotMatch(code, /waitFor[F]unction/)
	assert.doesNotMatch(code, /__knorke|\bK\.|waitReady|openBoard/, 'only DOM checks: a failed open has no window.__knorke')
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 20, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})
