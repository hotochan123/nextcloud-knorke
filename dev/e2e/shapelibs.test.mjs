/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E83 (own shape libraries, factory job 203), no browser, no
 * stack:
 * - scenarios/index.mjs: E83 once, directly after E82, before E09 (own
 *   boards, no instance setting); the flake gate --only E83 --repeat 3 named
 * - E83: the files go through the panel's file input (the runner sees only
 *   dev/e2e, so they are built in the scenario); the steps of AK9: import,
 *   Enter on a tile, the suggestion, the admin's "Adopt", bob's panel, the
 *   guest's panel without import; it cleans up the libraries it made
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/shapelibs.mjs')

test('index: E83 once, directly after E82 (job 201\'s), before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E83').length, 1)
	assert.equal(list.indexOf('E83'), list.indexOf('E82') + 1, 'directly after E82')
	assert.ok(list.indexOf('E83') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E83 \} from '\.\/shapelibs\.mjs'$/m)
	assert.ok(idx.includes('--only E83 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E83 = \{\n\tid: 'E83',/)
})

test('E83: the steps of AK9 through the real interface; no file outside dev/e2e; clean-up', () => {
	assert.match(src, /\[data-knorke-shapes-file\]'\)\.first\(\)\.setInputFiles\(\[/)
	assert.doesNotMatch(src, /tests\/fixtures\/shapes\/'/, 'the runner mounts only dev/e2e')
	assert.match(src, /await tile\.focus\(\)\s+await pa\.keyboard\.press\('Enter'\)/)
	// round 2: a tile dragged with the real mouse
	assert.match(src, /pa\.mouse\.down\(\)[\s\S]*pa\.mouse\.move\(to\.x, to\.y, \{ steps: 16 \}\)[\s\S]*pa\.mouse\.up\(\)/)
	assert.match(src, /\[data-knorke-shape-lib-action=suggest\]'\)\.first\(\)\.click\(/)
	assert.match(src, /settings\/admin\/knorke/)
	assert.match(src, /\[data-knorke-action=shapelib-adopt\]`\)\.first\(\)\.click\(/)
	assert.match(src, /\[data-knorke-action=shapes-import\]'\)\.count\(\)\) === 0/)
	assert.match(src, /finally \{[\s\S]*await cleanup\(\)/)
})
