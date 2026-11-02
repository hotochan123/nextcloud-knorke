/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E87 (board list favorites, factory job 219), no browser, no
 * stack:
 * - scenarios/index.mjs: E87 once, directly after E86, before E09 (own
 *   board, no instance setting); the flake gate --only E87 --repeat 3 named
 * - E87: two boards, alice on a laptop and on a phone (touch); real clicks on
 *   the star, the filters and the sort menu, a tap and the 44 px hit areas;
 *   route 5 as the server's view; the reload steps
 * - every check label names exactly one owner (SPEC-M1 §9.6)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/favorites.mjs')

test('index: E87 once, directly after E86, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E87').length, 1)
	// job 225: E91 (lane groups) between them
	assert.equal(list.indexOf('E87'), list.indexOf('E91') + 1, 'directly after E86 and E91')
	assert.ok(list.indexOf('E87') < list.indexOf('E09'), 'before E09 (own boards)')
	assert.match(idx, /^import \{ E87 \} from '\.\/favorites\.mjs'$/m)
	assert.ok(idx.includes('--only E87 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E87 = \{\n\tid: 'E87',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 2, 'two boards')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice on a laptop and (round 1) on a phone with touch')
	assert.match(src, /world\.actor\('alice-favorites-phone', \{ user: 'alice', touch: true, viewport: PHONE \}\)/)
	assert.match(src, /const TOUCH = 44/)
})

test('E87: real clicks on star, filters and sort menu; route 5 checks; reloads', () => {
	assert.match(src, /\[data-knorke-action=favorite\]/)
	assert.match(src, /pickFilter\(pa, 'favorites'\)/)
	assert.match(src, /pickSort\(pa, 'name'\)/)
	assert.match(src, /pickSort\(pa, 'opened'\)/)
	assert.match(src, /listBoards\('alice'\)/)
	assert.equal((src.match(/await openList\(pa\)/g) || []).length, 4, 'first load, two reloads, back from the board')
	assert.doesNotMatch(src, /page\.evaluate\([^)]*setTimeout|waitForFunction/, 'waits only from Node')
})

test('E87: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, `${labels.length} labels`)
	for (const l of labels) {
		assert.match(l, /^\[[CBD]\] /, l)
		assert.doesNotMatch(l.slice(3), /\[[A-Z]\]/, l)
	}
})
