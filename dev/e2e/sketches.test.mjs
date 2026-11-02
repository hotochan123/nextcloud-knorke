/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E88 (board list sketches, factory job 221), no browser, no
 * stack:
 * - scenarios/index.mjs: E88 once, directly after E87, before E09 (own
 *   boards, no instance setting); the flake gate --only E88 --repeat 3 named
 * - E88: two boards, one seeded through /sync; route 57 as alice, as bob and
 *   for an unknown id; alice on a laptop and on a phone (touch)
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
const src = read('scenarios/sketches.mjs')

test('index: E88 once, directly after E87, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E88').length, 1)
	assert.equal(list.indexOf('E88'), list.indexOf('E87') + 1, 'directly after E87')
	assert.ok(list.indexOf('E88') < list.indexOf('E09'), 'before E09 (own boards)')
	assert.match(idx, /^import \{ E88 \} from '\.\/sketches\.mjs'$/m)
	assert.ok(idx.includes('--only E88 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E88 = \{\n\tid: 'E88',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 2, 'two boards')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice on a laptop and on a phone with touch')
	assert.match(src, /world\.actor\('alice-sketches-phone', \{ user: 'alice', touch: true, viewport: PHONE \}\)/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
})

test('E88: seeded board, route 57 for alice, bob and an unknown id, the sketch in the row, the icon for the empty board', () => {
	assert.match(src, /seedOps\('alice', S, \[/)
	assert.match(src, /put\.connector\(/, 'a connector that must not show')
	assert.equal((src.match(/api\('alice', 'GET', `\/api\/v1\/boards\/\$\{[SE]\}\/sketch`\)/g) || []).length, 2)
	assert.match(src, /api\('bob', 'GET', `\/api\/v1\/boards\/\$\{S\}\/sketch`\)/)
	assert.match(src, /api\('bob', 'GET', '\/api\/v1\/boards\/999999999\/sketch'\)/)
	assert.match(src, /svg\[data-knorke-sketch\]/)
	// job 232: the card's picture instead of the 48 × 32 place
	assert.match(src, /const CARD = \{ minW: 240, ratio: 240 \/ 150 \}/)
	assert.doesNotMatch(src, /page\.evaluate\([^)]*setTimeout|waitForFunction/, 'waits only from Node')
})

test('E88: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, `${labels.length} labels`)
	for (const l of labels) {
		assert.match(l, /^\[[CBD]\] /, l)
		assert.doesNotMatch(l.slice(3), /\[[A-Z]\]/, l)
	}
})
