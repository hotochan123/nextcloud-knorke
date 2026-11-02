/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E57 (right-drag pans, factory job 156), no browser, no stack:
 * - scenarios/index.mjs: E57 once, after E55, before E09 (own board, no
 *   instance setting); the flake gate --only E57 --repeat 3 named
 * - E57: one board, alice alone; real input with the right button
 *   (mouse.down/up with button 'right', mouse.click with button 'right'), the
 *   way (−200, −100) in 10 steps, the waits of AK8 (400 ms after a drag,
 *   300 ms held), the vote session over route 22, votes().mine
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
const src = read('scenarios/rightdrag.mjs')

test('index: E57 once, after E55, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E57').length, 1)
	assert.ok(list.indexOf('E57') > list.indexOf('E55'), 'after E55')
	assert.ok(list.indexOf('E57') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E57 \} from '\.\/rightdrag\.mjs'$/m)
	assert.ok(idx.includes('--only E57 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E57 = \{\n\tid: 'E57',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E57: real right-button input, the way, the waits, the vote session', () => {
	assert.match(src, /mouse\.down\(\{ button: 'right' \}\)/)
	assert.match(src, /mouse\.up\(\{ button: 'right' \}\)/)
	assert.match(src, /mouse\.click\(p3b\.x, p3b\.y, \{ button: 'right' \}\)/)
	assert.match(src, /const WAY = Object\.freeze\(\{ x: -200, y: -100 \}\)/)
	assert.match(src, /\{ steps: 10 \}/)
	assert.match(src, /await sleep\(400\)/)
	assert.match(src, /await sleep\(300\)\n\t\t\tconst held = /)
	assert.match(src, /`\/api\/v1\/boards\/\$\{board\}\/vote`/)
	assert.match(src, /v3\.mine\?\.\[N\]/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	for (const step of ['(1)', '(2)', '(3)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E57: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 20, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
