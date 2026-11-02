/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E96 (the redesigned selection, factory job 231), no browser,
 * no stack:
 * - scenarios/index.mjs: E96 once, directly after E95, before E09 (own
 *   board, no instance setting); the flake gate named
 * - E96: real input (the mouse moving near the corner and the edge, a drag
 *   on rot and on plus-r, a tap of a tablet with a pen) and the hooks
 *   (handles() with shown and size, stats().selectionColor)
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
const src = read('scenarios/selection.mjs')

test('index: E96 once, directly after E95, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E96').length, 1)
	assert.equal(list.indexOf('E96'), list.indexOf('E95') + 1, 'directly after E95')
	assert.ok(list.indexOf('E96') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E96 \} from '\.\/selection\.mjs'$/m)
	assert.ok(idx.includes('--only E96 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E96 = \{\n\tid: 'E96',/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
})

test('E96: real input and the hooks of AK6', () => {
	assert.match(src, /p\.mouse\.move\(tr\.x \+ 8, tr\.y - 8\)/, 'the mouse near the top right corner')
	assert.match(src, /p\.mouse\.move\(edge\.x \+ 8, edge\.y\)/, 'the mouse near the right edge')
	assert.match(src, /p\.mouse\.down\(\)/, 'real drags')
	assert.match(src, /q\.touchscreen\.tap\(/, 'a tap on the tablet')
	assert.match(src, /touch: true, fine: true/, 'a tablet with a pen')
	assert.match(src, /h\.shown/, 'handles() shown')
	assert.match(src, /h\.size === \(h\.name\.startsWith\('plus-'\) \? 14 : 16\)/, 'the touch size (job 262: 16, the points 14)')
	assert.match(src, /selectionColor/, 'stats().selectionColor')
})

test('E96: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 12, `labels found: ${labels.length}`)
	for (const l of labels) assert.match(l, /^\[(B|C|D|S)\] /, l)
})
