/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E60 (the pen's side button pans, the editor stays open during
 * a right-drag, factory job 168), no browser, no stack:
 * - scenarios/index.mjs: E60 once, after E59, before E09 (own board, no
 *   instance setting); the flake gate --only E60 --repeat 3 named
 * - E60: one board, alice alone; real input (page.mouse with button 'right',
 *   page.keyboard, the pen through CDP Input.dispatchMouseEvent with
 *   pointerType 'pen' and button 'right'), no synthetic events
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
const src = read('scenarios/penbutton.mjs')

test('index: E60 once, after E59, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E60').length, 1)
	assert.ok(list.indexOf('E60') > list.indexOf('E59'), 'after E59')
	assert.ok(list.indexOf('E60') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E60 \} from '\.\/penbutton\.mjs'$/m)
	assert.ok(idx.includes('--only E60 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E60 = \{\n\tid: 'E60',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E60: real input, the pen through CDP with pointerType pen and the right button, the way in 10 steps', () => {
	assert.match(src, /mouse\.down\(\{ button: 'right' \}\)/)
	assert.match(src, /mouse\.up\(\{ button: 'right' \}\)/)
	assert.match(src, /cdp\.send\('Input\.dispatchMouseEvent', \{ type, x: p\.x, y: p\.y, pointerType: 'pen', \.\.\.extra \}\)/)
	assert.match(src, /send\('mousePressed', from, \{ button: 'right', buttons: 2, clickCount: 1 \}\)/)
	assert.match(src, /const WAY = Object\.freeze\(\{ x: -200, y: -100 \}\)/)
	assert.match(src, /\{ steps: 10 \}/)
	assert.match(src, /penRight\(cdp, beside, end, 10\)/)
	assert.match(src, /await sleep\(400\)/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	for (const step of ['(1)', '(2)', '(3)', '(4)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E60: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 20, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
