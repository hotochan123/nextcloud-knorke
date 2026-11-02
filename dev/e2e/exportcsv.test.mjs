/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E68 (save as CSV, factory job 179), no browser, no stack:
 * - scenarios/index.mjs: E68 once, directly after E67 (job 178's), before
 *   E09 (own board, no instance setting); the flake gate --only E68
 *   --repeat 3 named
 * - E68: one board shared with bob as "view"; alice, bob and bob at
 *   500 × 800; the expected header and rows match the app's (csvHeader,
 *   colorName of the seeded fills, the defused '=1+1, the reaction 👍); the
 *   board menu through menuAction with BOARD_MENUS, the frame's context
 *   menu by a right click; the steps (a)–(c)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { csvHeader } from '../../src/board/exportCsv.js'
import { colorName } from '../../src/components/labels.js'
import { csvField } from '../../src/model/table.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/exportcsv.mjs')

/** @param {string} name an exported string constant of the scenario @return {string} its value */
const str = (name) => {
	const m = src.match(new RegExp(`^export const ${name} = '([^']*)'$`, 'm'))
	return m ? m[1] : null
}

/** @return {string[]} the scenario's ROWS (read as text: the scenario imports the harness, which needs env.json) */
function rows() {
	const block = src.match(/^export const ROWS = Object\.freeze\(\[\n([\s\S]*?)\n\]\)$/m)?.[1] ?? ''
	return block.split('\n').map((l) => l.trim().replace(/,$/, '')).map((l) => (l.startsWith('"') ? JSON.parse(l) : l.slice(1, -1)))
}

test('index: E68 once, directly after E67, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E68').length, 1)
	assert.equal(list.indexOf('E68'), list.indexOf('E67') + 1, 'directly after E67')
	assert.ok(list.indexOf('E68') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E68 \} from '\.\/exportcsv\.mjs'$/m)
	assert.ok(idx.includes('is\n * --only E68 --repeat 3.') || idx.includes('is --only E68 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E68 = \{\n\tid: 'E68',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 3, 'alice, bob, bob at 500 px')
	assert.match(src, /world\.actor\('bob-csv-500', \{ user: 'bob', viewport: \{ width: 500, height: 800 \} \}\)/, '(c) 500 px wide')
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'view' \}\]\)/, 'bob may only view')
})

test('E68: the expected file is the app\'s (header, colour names of the seeded fills, \'=1+1, 👍 1)', () => {
	assert.equal(str('HEADER'), csvHeader().join(','))
	assert.match(src, /const TITLE = 'E68 Liste'/)
	assert.match(src, /const FRAME = 'E68 Frame'/)
	const fills = [...src.matchAll(/put\.sticky\((N1|N2|X), \{ [^}]*data: \{ text: '([^']*)' \}, style: \{ fill: '(#[0-9a-f]{6})' \} \}\)/g)].map((m) => [m[1], m[2], m[3]])
	assert.deepEqual(fills.map((f) => f[0]), ['N1', 'N2', 'X'])
	// job 191: and the empty Tags column
	const want = fills.map(([id, text, fill]) => ['Note', csvField(text), colorName(fill), id === 'X' ? '' : 'E68 Frame', id === 'N1' ? '👍 1' : '', '', ''].join(','))
	assert.deepEqual(rows(), want)
	assert.equal(rows()[2].split(',')[1], "'=1+1")
	assert.match(src, /put\.frame\(F, \{ x: 0, y: 0, w: 400, h: 600, data: \{ title: FRAME \} \}\)/)
	assert.match(src, /put\.sticky\(N1, \{ x: 100, y: 60, parent: F,/, 'N1 in the frame, above N2')
	assert.match(src, /put\.sticky\(N2, \{ x: 100, y: 320, parent: F,/)
	assert.match(src, /put\.sticky\(X, \{ x: 600, y: 60, data/, 'X loose, right of the frame')
})

test('E68: the steps (a)–(c)', () => {
	assert.match(src, /\[data-knorke-react="\$\{THUMBS\}"\]/, 'N1 gets 👍 through the picker')
	assert.match(src, /menuAction\(pa, 'export-csv', \{ menus: BOARD_MENUS \}\)/, '(a) through the board menu')
	assert.match(src, /fa\.name === `\$\{TITLE\} \$\{day\}\.csv`/, '(a) the file name')
	assert.match(src, /hasBom\(fa\.bytes\)/, '(a) the BOM')
	assert.match(src, /same\(ra\.slice\(1\), ROWS\)/, '(a) the rows in order')
	assert.match(src, /pa\.mouse\.click\(title\.x, title\.y, \{ button: 'right' \}\)/, '(b) a right click on the frame')
	assert.match(src, /\[data-knorke-menu-item=export-csv\]/)
	assert.match(src, /same\(rb, \[HEADER, \.\.\.ROWS\.slice\(0, 2\)\]\)/, '(b) exactly the two frame notes')
	assert.match(src, /exportEntries\(pb, '\[data-knorke-menu=board\]'\)/, '(c) the wide board menu')
	assert.match(src, /exportEntries\(pn, '\[data-knorke-menu=overflow\]'\)/, '(c) the overflow menu at 500 px')
	for (const step of ['(a)', '(b)', '(c)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
})

test('E68: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 20, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
