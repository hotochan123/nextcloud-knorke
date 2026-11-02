/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E99 (search on the board, factory job 271), no browser, no
 * stack: registered once after E98 and before E09 with its flake gate; one
 * board, alice alone; real keys (Control+f, typing, Enter, Escape), no
 * synthetic events; the hooks it reads exist in the app.
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/search.mjs')

test('index: E99 once, after E98, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E99').length, 1)
	assert.ok(list.indexOf('E99') > list.indexOf('E98'), 'after E98')
	assert.ok(list.indexOf('E99') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E99 \} from '\.\/search\.mjs'$/m)
	assert.ok(idx.includes('--only E99 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E99 = \{\n\tid: 'E99',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E99: real keys, no synthetic events; the app has the hooks it reads', () => {
	for (const k of ["press('Control+f')", "type('coffee')", "press('Enter')", "press('Escape')"]) assert.ok(src.includes('pa.keyboard.' + k), k)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	const app = ['../../src/components/SearchPanel.vue', '../../src/components/TopBar.vue', '../../src/board/debug.js'].map(read).join('\n')
	for (const hook of ['data-knorke-search', 'data-knorke-field="search"', 'data-knorke-search-count', 'data-knorke-search-hit', 'data-knorke-action="search"', 'searchHit()']) {
		assert.ok(app.includes(hook), hook)
	}
	for (const m of src.match(/'\[[SUDB]\][^']*'/g) ?? []) assert.match(m, /^'\[[SUDB]\] /, 'one owner per label')
})
