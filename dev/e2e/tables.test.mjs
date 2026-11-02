/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E63 (tables, factory job 173), no browser, no stack:
 * - scenarios/index.mjs: E63 once, directly after E62 (job 172's),
 *   before E09 (own board, no instance setting); the flake gate
 *   --only E63 --repeat 3 named
 * - E63: alice and bob on one board, real input (the key B, clicks, double
 *   clicks, typing, a right click, Ctrl+Z, a border drag, the context bar,
 *   the connector tool L, a download); the 3 s of AK8
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Self-test of E64 (factory job 174) in the same file: once, directly after
 * E63, before E09, flake gate named; real input but for the one paste event
 * with a DataTransfer (Excel-like text with a <table>, a quoted cell with a
 * line break; job 185: 5 × 5, wider than the table); the 3 s; Ctrl+Z, Tab,
 * the arrows (job 185: ↑ from the middle of one line, ↑/↓ in wrapped text
 * with the caret set by setSelectionRange), Esc; one owner per check label.
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const all = read('scenarios/tables.mjs')
// E63's part (job 173) and E64's (job 174)
const src = all.slice(0, all.indexOf('/** E64:'))
const src64 = all.slice(all.indexOf('/** E64:'))

test('index: E63 once, directly after E62, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E63').length, 1)
	assert.equal(list.indexOf('E63'), list.indexOf('E62') + 1, 'directly after E62')
	assert.ok(list.indexOf('E63') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E63, E64 \} from '\.\/tables\.mjs'$/m)
	assert.ok(idx.includes('is --only E63 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E63 = \{\n\tid: 'E63',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E63: real input for every step of AK8, scene().tables, the download', () => {
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(src, /pa\.keyboard\.press\('b'\)/)
	assert.match(src, /const SEEN_MS = 3000/)
	assert.match(src, /\.tables/)
	assert.match(src, /mouse\.dblclick\(/)
	assert.match(src, /take-over/)
	assert.match(src, /table-col/)
	assert.match(src, /table-row/)
	assert.match(src, /'col-delete'/)
	assert.match(src, /press\('Control\+z'\)/)
	assert.match(src, /data-knorke-section=header/)
	assert.match(src, /data-knorke-style="style\.header"/)
	assert.match(src, /press\('l'\)/)
	assert.match(src, /'table-csv'/)
	assert.match(src, /waitForEvent\('download'/)
	assert.match(src, /- Table\.csv/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E63: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 25, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})

test('index: E64 once, directly after E63, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((x) => x.trim())
	assert.equal(list.filter((x) => x === 'E64').length, 1)
	assert.equal(list.indexOf('E64'), list.indexOf('E63') + 1, 'directly after E63')
	assert.ok(list.indexOf('E64') < list.indexOf('E09'), 'before E09 (own board)')
	assert.ok(idx.includes('is --only E64 --repeat 3.'), 'flake gate named')
	assert.match(src64, /export const E64 = \{\n\tid: 'E64',/)
	assert.equal((src64.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src64.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E64: the paste event with a DataTransfer (Excel text, a <table>, 5 × 5, a quoted cell with a line break), the rest real input', () => {
	assert.match(src64, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(src64, /pa\.keyboard\.press\('b'\)/)
	assert.match(src64, /new DataTransfer\(\)/)
	assert.match(src64, /setData\('text\/plain', text\)/)
	assert.match(src64, /setData\('text\/html', html\)/)
	assert.match(src64, /<table>/)
	assert.match(src64, /new ClipboardEvent\('paste'/)
	assert.match(src64, /'two\\nlines'/, 'a cell with a line break')
	assert.match(src64, /c\.includes\('\\n'\) \? '"' \+ c \+ '"'/, 'quoted')
	assert.equal((src64.match(/dispatchEvent\(/g) || []).length, 1, 'the paste is the only synthetic event')
	assert.match(src64, /SEEN_MS/)
	assert.match(src64, /\.tables/)
	assert.match(src64, /press\('Control\+z'\)/)
	assert.match(src64, /mouse\.dblclick\(/)
	assert.match(src64, /keyboard\.type\('x'\)/)
	assert.match(src64, /press\('Tab'\)/)
	assert.match(src64, /press\('ArrowUp'\)/)
	assert.match(src64, /press\('ArrowRight'\)/)
	// job 185: five columns into a 3 × 3 table, ↑/↓ in a wrapped text, the caret set without an event
	assert.equal((src64.match(/^\t\[('[^']*', ){4}'[^']*'\],$/gm) || []).length, 5, 'EXCEL_ROWS: 5 rows of 5 cells')
	assert.match(src64, /=== '\[5,5\]'/)
	assert.match(src64, /press\('ArrowDown'\)/)
	assert.match(src64, /setSelectionRange\(/)
	assert.match(src64, /linesOf\(pa\)\) >= 2/)
	assert.match(src64, /press\('Escape'\)/)
	assert.match(src64, /textarea\[data-knorke-editor\]/)
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)']) {
		assert.ok(src64.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E64: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src64.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src64.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 15, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
