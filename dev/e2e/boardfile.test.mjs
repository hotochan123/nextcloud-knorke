/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E70 (board as a file, factory job 181), no browser, no stack:
 * - scenarios/index.mjs: E70 once, directly after E69 (job 180's), before
 *   E09 (own board, no instance setting); the flake gate --only E70
 *   --repeat 3 named
 * - E70: one board shared with bob as "view"; alice and bob; the file name
 *   is the app's (boardFileName); the board menu through menuAction with
 *   BOARD_MENUS, the file picker through Playwright's filechooser; the
 *   steps (a)–(d)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardFileName } from '../../src/board/boardFile.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/boardfile.mjs')

test('index: E70 once, directly after E69, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E70').length, 1)
	assert.equal(list.indexOf('E70'), list.indexOf('E69') + 1, 'directly after E69')
	assert.ok(list.indexOf('E70') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E70 \} from '\.\/boardfile\.mjs'$/m)
	assert.ok(idx.includes('is --only E70 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E70 = \{\n\tid: 'E70',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'view' \}\]\)/, 'bob may only view')
})

test('E70: the file name is the app\'s, the seeded board has N roots with a reaction and a lock', () => {
	// read as text: the scenario imports the harness, which needs the stack's env.json
	const title = src.match(/^const TITLE = '([^']+)'$/m)?.[1]
	assert.equal(src.match(/^export const FILE = '([^']+)'$/m)?.[1], boardFileName(title))
	const n = Number(src.match(/^export const N = (\d+)$/m)?.[1])
	const seeds = src.slice(src.indexOf('seedOps('), src.indexOf('t.must(res.every'))
	assert.equal((seeds.match(/\bput\.(frame|sticky|shape|text|connector)\(/g) || []).length, n, 'N puts')
	assert.doesNotMatch(seeds, /parent:/, 'all roots: all of them are selected after the insert')
	assert.match(seeds, /data\.react\.p\$\{me\.pid\}/, 'a reaction of alice')
	assert.match(seeds, /lock: \{ by: me\.pid, name: me\.name \}/, 'a lock of alice')
})

test('E70: the steps (a)–(d)', () => {
	for (const step of ['(a)', '(b)', '(c)', '(d)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.match(src, /download\(pa, \(\) => menuAction\(pa, 'download-board', \{ menus: BOARD_MENUS \}\)\)/, '(a) through the board menu')
	assert.match(src, /\[me\.name, me\.pid, '"react"', '"lock"', '"board":'\]/, '(a) no name, no pid, no react, no lock, no board key')
	assert.match(src, /\[data-knorke-action=insert-board-file\]'\)\) === 0/, '(b) bob has no insert-board-file')
	assert.match(src, /page\.waitForEvent\('filechooser'/, '(c) the real file picker')
	assert.equal((src.match(/pick\(pa, \(\) => menuAction\(pa, 'insert-board-file', \{ menus: BOARD_MENUS \}\)/g) || []).length, 2, '(c) and (d) through the board menu')
	assert.match(src, /pa\.keyboard\.press\('Control\+z'\)/, '(c) Ctrl+Z')
	assert.match(src, /buffer: Buffer\.from\('\{\}'\)/, '(d) a file holding {}')
	assert.match(src, /\[data-knorke-toast=board-file-invalid\]/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(|setInputFiles/, 'no synthetic events, no file set without the picker')
})

test('E70: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 25, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
