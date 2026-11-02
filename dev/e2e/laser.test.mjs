/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E61 (the laser pointer, factory job 171), no browser, no
 * stack:
 * - scenarios/index.mjs: E61 once, directly after E60, before E09 (own
 *   board, no instance setting); the flake gate --only E61 --repeat 3 named
 * - E61: alice and bob on one board, real input (the key K, the left button
 *   held for 1.5 s, the key C), the limits 2.5 s and 4 s of AK9
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
const src = read('scenarios/laser.mjs')

test('index: E61 once, directly after E60, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E61').length, 1)
	assert.equal(list.indexOf('E61'), list.indexOf('E60') + 1, 'directly after E60')
	assert.ok(list.indexOf('E61') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E61 \} from '\.\/laser\.mjs'$/m)
	assert.ok(idx.includes('gate is --only E61 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E61 = \{\n\tid: 'E61',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E61: real input (K, the left button held 1.5 s, C), lasers of the scene, the limits of AK9', () => {
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(src, /pb\.keyboard\.press\('k'\)/)
	assert.match(src, /pa\.keyboard\.press\('c'\)/)
	assert.match(src, /mouse\.down\(\)/)
	assert.match(src, /mouse\.up\(\)/)
	assert.match(src, /const HOLD_MS = 1500/)
	assert.match(src, /const SHOW_MS = 2500/)
	assert.match(src, /const GONE_MS = 4000/)
	assert.match(src, /\.lasers/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	for (const step of ['(1)', '(2)', '(3)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E61: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 15, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
