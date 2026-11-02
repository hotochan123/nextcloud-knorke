/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E69 (board templates, factory job 180), no browser, no stack:
 * - scenarios/index.mjs: E69 once, after E67 (job 178's), before E09 (own
 *   board, no instance setting); the flake gate --only E69 --repeat 3 named
 * - E69: one board, alice and bob (view); its constants match the app's
 *   (FRAME_TITLE_BAND, TEMPLATE_KEYS); the steps (a)–(e), (e) at 390 × 844
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEMPLATE_KEYS } from '../../src/board/templates.js'
import { FRAME_TITLE_BAND } from '../../src/model/tokens.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/templates.mjs')

test('index: E69 once, after E67, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E69').length, 1)
	assert.ok(list.indexOf('E69') > list.indexOf('E67'), 'after E67')
	assert.ok(list.indexOf('E69') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E69 \} from '\.\/templates\.mjs'$/m)
	assert.ok(idx.includes('is --only E69 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E69 = \{\n\tid: 'E69',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
	assert.match(src, /\{ kind: 'user', id: 'bob', role: 'view' \}/)
})

test('E69: the constants of the app, the steps (a)–(e)', () => {
	// read as text: the scenario imports the harness, which needs the stack's env.json
	assert.equal(Number(src.match(/^export const TITLE_BAND = (\d+)$/m)?.[1]), FRAME_TITLE_BAND)
	assert.equal(src.match(/^export const KEYS = Object\.freeze\((\[[^\]]+\])\)$/m)?.[1], JSON.stringify(TEMPLATE_KEYS).replace(/"/g, '\'').replace(/,/g, ', '))
	for (const step of ['(a)', '(b)', '(c)', '(d)', '(e)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.match(src, /pa\.keyboard\.press\('Control\+z'\)/, 'Ctrl+Z')
	assert.match(src, /pa\.mouse\.click\(p\.x, p\.y, \{ button: 'right' \}\)/, 'a right click on the empty canvas')
	assert.match(src, /menuAction\(pa, 'insert-template', \{ menus: BOARD_MENUS \}\)/, 'the board menu')
	// job 237: (c) Enter with nothing picked inserts nothing; (d) a click picks, the arrow key picks SWOT, Enter inserts
	assert.match(src, /insertOff\(pa\)\) === true[\s\S]*?pa\.keyboard\.press\('Enter'\)[\s\S]*?pa\.keyboard\.press\('Escape'\)/, '(c) Enter without a pick')
	assert.match(src, /\[data-knorke-template=kanban\]`\)\.first\(\)\.click\(\)[\s\S]*?pa\.keyboard\.press\('ArrowLeft'\)[\s\S]*?pa\.keyboard\.press\('Enter'\)/, '(d) click, arrow key and Enter')
	assert.match(src, /pa\.setViewportSize\(\{ width: 390, height: 844 \}\)/, '(e) the phone size')
})

test('E69: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) || /&&\s*$/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 30, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
