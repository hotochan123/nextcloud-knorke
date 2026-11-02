/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E81 (save as SVG and PDF, factory job 200), no browser, no
 * stack:
 * - scenarios/index.mjs: E81 once, directly after E80, before E09 (own
 *   board, no instance setting); the flake gate --only E81 --repeat 3 named
 * - E81: one board, alice and carol; real input for every step: the board
 *   menu (menuAction) for PNG, SVG and PDF, a right click on the frame's
 *   title and a click on the menu entries; the SVG compared with the PNG in
 *   a blank page, the PDF read back with lib/pdf.mjs; 10 % and 150 %
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * - (job 207) every PDF through the dialog [data-knorke-dialog=export-pdf]
 *   (savePdf: Save); step (f) picks A4, reloads, checks it is remembered
 *   and that Esc saves nothing; carol's dialog rows at least 44 px
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/exportvector.mjs')

test('index: E81 once, directly after E80, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E81').length, 1)
	assert.equal(list.indexOf('E81'), list.indexOf('E80') + 1, 'directly after E80')
	assert.ok(list.indexOf('E81') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E81 \} from '\.\/exportvector\.mjs'$/m)
	assert.ok(idx.includes('--only E81 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E81 = \{\n\tid: 'E81',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and carol')
})

test('E81: real input for every step, the SVG against the PNG, the PDF read back, 10 % and 150 %', () => {
	for (const key of ['export-png', 'export-svg', 'export-pdf']) assert.match(src, new RegExp(`menuAction\\(pa, '${key}', \\{ menus: BOARD_MENUS \\}\\)`), key)
	assert.match(src, /button: 'right'/)
	assert.match(src, /\$\{MENU\} \[data-knorke-menu-item=\$\{key\}\]/)
	assert.match(src, /for \(const key of \['export-svg', 'export-pdf'\]\)/)
	assert.match(src, /newPage\(\)/, 'a blank page draws the SVG (no CSP)')
	assert.match(src, /export const DIFF_SHARE = 0\.02/)
	assert.match(src, /from '\.\.\/lib\/pdf\.mjs'/)
	assert.match(src, /readPdf\(bytes\)/)
	assert.match(src, /for \(const scale of \[0\.1, 1\.5\]\)/)
	assert.match(src, /bytes\.equals\(fs1\.bytes\)/)
	assert.match(src, /bytes\.equals\(fd\.bytes\)/)
	assert.match(src, /viewport: \{ width: 500, height: 800 \}/)
	assert.match(src, /'\[data-knorke-menu=overflow\]'/)
})

test('E81: every check label starts with exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?['`](\[[A-Z]\][^'`]*)['`]/g)].map((m) => m[1])
	assert.ok(labels.length >= 30, 'labels found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.ok(!/waitForFunction|waitForTimeout/.test(src), 'no waits in the page (CSP)')
})

test('E81 (job 207): every PDF through the page-size dialog; A4 picked, remembered after a reload, Esc saves nothing', () => {
	assert.match(src, /const PDF_DIALOG = '\[data-knorke-dialog=export-pdf\]'/)
	assert.match(src, /\[data-knorke-action=export-pdf-save\]/)
	assert.match(src, /savePdf\(pa, \(\) => menuAction\(pa, 'export-pdf', \{ menus: BOARD_MENUS \}\)\)/, '(b), (c): the board menu, then Save')
	assert.match(src, /key === 'export-pdf' \? savePdf\(pa, pick\) : pick\(\)/, '(d): the context menu, then Save')
	assert.match(src, /key === 'export-pdf' \? savePdf\(pc, start\) : start\(\)/, '(e): the overflow menu, then Save')
	assert.match(src, /savePdf\(pa, \(\) => menuAction\(pa, 'export-pdf', \{ menus: BOARD_MENUS \}\), 'a4'\)/, '(f): A4')
	assert.match(src, /near\(pa4\.mediaBox\[2\], 841\.89\) && near\(pa4\.mediaBox\[3\], 595\.276\)/)
	assert.match(src, /await reopenAt\(a, board, CAM\)\n\t+const quiet = pa\.waitForEvent\('download'/, 'remembered across a reload')
	assert.match(src, /none === 'a4'/)
	assert.match(src, /h >= 44/)
	assert.equal((src.match(/t\.step\(/g) || []).length, 6, 'steps (a)–(f)')
})
