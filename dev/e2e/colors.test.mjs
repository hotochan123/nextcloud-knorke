/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E46 (colour picker in the context bar, factory job 135), no
 * browser, no stack:
 * - scenarios/index.mjs: E46 once, directly after E45, before E09 (own
 *   board, no instance setting); the flake gate --only E46 --repeat 3 named
 * - E46: alice on her own board, bob as an account through the edit link;
 *   the five steps of the spec with their hooks (the fill toggle and its
 *   dot, the "#" field with Enter, Backspace and aria-invalid, the row "On
 *   this board", the system picker through locator.fill); one board, so
 *   MAX_BOARDS_PER_RUN stays 56 (53 + 1 = 54; 64 since factory job 140, 72 since factory job 157, 80 since factory job 177, 88 since factory job 189, 96 since factory job 198)
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
const src = read('scenarios/colors.mjs')
/** The code without comments. */
const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')

test('index: E46 once, directly after E45, before E09; import and flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E46').length, 1)
	assert.equal(list.indexOf('E46'), list.indexOf('E45') + 1, 'directly after E45')
	assert.ok(list.indexOf('E46') < list.indexOf('E09'), 'before E09 (own board, no instance setting)')
	assert.match(idx, /^import \{ E46 \} from '\.\/colors\.mjs'$/m)
	const head = idx.slice(idx.indexOf('/*\n'), idx.indexOf('*/', idx.indexOf('/*\n')))
	assert.ok(head.replace(/\n \* /g, ' ').includes('--only E46 --repeat 3'), 'flake gate named')
	assert.match(src, /export const E46 = \{\n\tid: 'E46',/)
})

test('E46: one board of its own; alice on it, bob through the edit link; the board cap stays 96 (factory jobs 157, 177, 189, 198); no instance setting', () => {
	assert.equal((code.match(/world\.board\(/g) || []).length, 1)
	assert.match(src, /world\.board\('E46 Farbwähler'\)/)
	assert.match(src, /world\.actor\('alice-farben', \{ user: 'alice' \}\)/)
	assert.match(src, /world\.actor\('bob-farben', \{ user: 'bob' \}\)/)
	assert.match(src, /await joinAsMember\(bob, L\)/, 'bob joins through the edit link')
	assert.match(read('scenarios/world.mjs'), /^export const MAX_BOARDS_PER_RUN = 120$/m)
	assert.doesNotMatch(code, /world\.switch\(|bridge\(|setAppConfig|touched/, 'no instance setting')
})

test('E46: the five steps with their hooks – fill toggle and dot, "#" field with Enter, Backspace, aria-invalid, the board row, the system picker', () => {
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	for (const hook of ['[data-knorke-section=fill]', '[data-knorke-fill-current]', '[data-knorke-panel=fill]', 'input[data-knorke-hex="style.fill"]',
		'[data-knorke-board-colors] [data-knorke-value="#1f3a5f"]', 'input[data-knorke-system-color="style.fill"]']) {
		assert.ok(src.includes(hook), hook)
	}
	assert.match(src, /keyboard\.type\('#1f3a5f'/)
	assert.match(src, /keyboard\.press\('Enter'\)[\s\S]*keyboard\.press\('Backspace'\)[\s\S]*keyboard\.type\('zz'/, 'Enter, then Backspace, then zz')
	assert.match(src, /getAttribute\('aria-invalid'\)\) === 'true'/)
	assert.match(src, /locator\(SYSTEM\)\.first\(\)\.fill\('#ff8800'\)/, 'the system picker through locator.fill')
	assert.match(src, /serverMap\('alice', board\)\)\.get\(F\)\?\.style\?\.fill === '#ff8800'/, 'the frame keeps #ff8800 at the server')
	assert.match(src, /fillIn\(pb, B\)\) === '#1f3a5f'/, 'bob colours B')
})

test('E46: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 25, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [])
})
