/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E53 (hide other people's cursors, factory job 147), no
 * browser, no stack:
 * - scenarios/index.mjs: E53 once, directly after E52@360x780, before E09
 *   (own board, no instance setting); the flake gate --only E53 --repeat 3
 *   named
 * - E53: alice and bob on one board, the key C, the toast hook, a reload,
 *   the menu entry with aria-checked, following through the presence bar
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
const src = read('scenarios/cursors.mjs')

test('index: E53 once, directly after E52@360x780, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E53').length, 1)
	assert.equal(list.indexOf('E53'), list.indexOf('E52_PHONE') + 1, 'directly after E52@360x780')
	assert.ok(list.indexOf('E53') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E53 \} from '\.\/cursors\.mjs'$/m)
	assert.ok(idx.includes('gate is --only E53 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E53 = \{\n\tid: 'E53',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E53: alice and bob, the key C, the toast, a reload, the menu without the check box (job 230), following', () => {
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(src, /keyboard\.press\('c'\)/)
	for (const hook of ['[data-knorke-toast=cursors]', '[data-knorke-menu=context]', '[data-knorke-menu-item="cursors"]', '[data-knorke-cursor]', '[data-knorke-editing=', '[data-knorke-participant=']) {
		assert.ok(src.includes(hook), hook)
	}
	assert.match(src, /pa\.reload\(/)
	// job 230: the board menu lists no cursors entry; the key C shows them again
	assert.match(src, /\[data-knorke-menu-item="cursors"\]`\)\.count\(\)\) === 0/)
	assert.match(src, /\.following === bobPid/)
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E53: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 20, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
