/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E101 (Markdown in notes, factory job 279), no browser, no
 * stack: registered once after E100 and before E09 with its flake gate; one
 * board, alice alone; real clicks and keys, no synthetic events; the hooks
 * it reads exist in the app.
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/markdown.mjs')

test('index: E101 once, after E100, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E101').length, 1)
	assert.ok(list.indexOf('E101') > list.indexOf('E100'), 'after E100')
	assert.ok(list.indexOf('E101') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E101 \} from '\.\/markdown\.mjs'$/m)
	assert.ok(idx.includes('--only E101 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E101 = \{\n\tid: 'E101',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E101: real clicks and keys, no synthetic events; the app has the hooks it reads', () => {
	assert.ok(src.includes("pa.keyboard.press('Escape')"), 'Esc as a key')
	assert.ok(src.includes("pa.keyboard.press('ControlOrMeta+i')"), 'Ctrl+I as a key')
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	const app = ['../../src/components/ContextBar.vue', '../../src/board/debug.js'].map(read).join('\n')
	for (const hook of [':data-knorke-format="item"', 'data-knorke-action="open-link"', 'drawnText(id)']) {
		assert.ok(app.includes(hook), hook)
	}
	for (const m of src.match(/'\[[SUDB]\][^']*'/g) ?? []) assert.match(m, /^'\[[SUDB]\] /, 'one owner per label')
})
