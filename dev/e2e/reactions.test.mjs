/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E62 (emoji reactions on notes, factory job 172), no browser,
 * no stack:
 * - scenarios/index.mjs: E62 once, after E61, before E09 (own board, no
 *   instance setting); the flake gate --only E62 --repeat 3 named
 * - E62: one board, five actors (alice, the guest Gina, carol, bob and,
 *   job 183, the tablet guest Tina over the vote link), the steps (1)–(5);
 *   real input only (page.mouse, page.keyboard, page.touchscreen, locator
 *   clicks and taps), no synthetic events
 * - E12 checks that no cold page asks for the emoji chunk
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
const src = read('scenarios/reactions.mjs')

test('index: E62 once, after E61, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E62').length, 1)
	assert.ok(list.indexOf('E62') > list.indexOf('E61'), 'after E61')
	assert.ok(list.indexOf('E62') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E62 \} from '\.\/reactions\.mjs'$/m)
	assert.ok(idx.includes('--only E62 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E62 = \{\n\tid: 'E62',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 5, 'alice, Gina, carol, bob, Tina')
	assert.match(src, /role: 'vote'/)
	assert.match(src, /role: 'view'/)
	assert.match(src, /joinAsGuest\(g, L, 'Gina', board\)/)
	// job 183: Tina, a tablet, over the vote link (route 17)
	assert.match(src, /world\.actor\('tina-react', \{ touch: true \}\)/)
	assert.match(src, /\/votelink`/)
	assert.match(src, /joinAsGuest\(tina, vl\.data\.link\.token, 'Tina', board, TCAM\)/)
})

test('E62: the steps (1)–(5), real input, the emoji chunk only after "More…"; E12 asks for no emoji chunk', () => {
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	assert.match(src, /\[data-knorke-react=more\]/)
	assert.match(src, /search\.fill\('rocket'\)/)
	assert.match(src, /emojiChunk\.length === 0/)
	assert.match(src, /Control\+z/)
	assert.match(src, /Control\+d/)
	assert.match(read('scenarios/coldstart.mjs'), /keine Anfrage an js\/emoji-\*\.chunk\.mjs/)
})

test('E62: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 30, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})

test('E50 knows the band of a selected note\'s reaction row: E50_BAND = REACT_BAND of src/model/tokens.js', async () => {
	const { REACT_BAND } = await import('../../src/model/tokens.js')
	// gap.mjs imports the harness, which needs a stack: read its constants from the source
	const gap = read('scenarios/gap.mjs')
	assert.equal(Number(gap.match(/^export const E50_BAND = (\d+)$/m)?.[1]), REACT_BAND)
	assert.equal(Number(gap.match(/^export const E50_GAP = (\d+)$/m)?.[1]), 4)
	assert.match(gap, /const below = name === 'N' \? E50_BAND \* s : 0/)
})
