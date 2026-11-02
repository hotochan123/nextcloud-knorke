/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E82 (shapes panel, factory job 201), no browser, no stack:
 * - scenarios/index.mjs: E82 once, directly after E81, before E09 (own
 *   board, no instance setting); the flake gate --only E82 --repeat 3 named
 * - E82: one board; real input for every step of AK6: the click on
 *   "Shapes", typing into the search, the drag of a tile with the mouse,
 *   the click on a tile and on the board, the drop on the panel, the check
 *   box of "Symbols", the page loaded again; the pictures in light and dark
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
const src = read('scenarios/shapes.mjs')

test('index: E82 once, directly after E81 (job 200\'s), before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E82').length, 1)
	assert.equal(list.indexOf('E82'), list.indexOf('E81') + 1, 'directly after E81')
	assert.ok(list.indexOf('E82') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E82 \} from '\.\/shapes\.mjs'$/m)
	assert.ok(idx.includes('--only E82 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E82 = \{\n\tid: 'E82',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E82: real input for every step of AK6; the pictures in light and dark', () => {
	assert.match(src, /\[data-knorke-tool=shape\]'\)\.first\(\)\.click\(/, 'job 229: the shape tool opens the panel')
	assert.match(src, /\[data-knorke-shapes-search\]'\)\.first\(\)\.fill\('database'\)/)
	assert.match(src, /mouse\.down\(\)[\s\S]*mouse\.up\(\)/, 'a drag with the mouse')
	assert.match(src, /TILE\('symbols\.person'\)\)\.first\(\)\.click\(/)
	assert.match(src, /mouse\.click\(at4\.x, at4\.y\)/)
	assert.match(src, /\[data-knorke-shape-lib-toggle=symbols\]'\)\.first\(\)\.uncheck\(/)
	assert.match(src, /await openBoard\(a, board\)\n\t\t\tt\.must\(await openPanel\(pa\)/, 'loaded again')
	assert.match(src, /colorScheme: 'dark'/)
	assert.match(src, /picture\(pa, `light-\$\{lib\}`/)
	assert.match(src, /picture\(d\.page, `dark-\$\{lib\}`/)
	assert.match(src, /serverMap\('alice', board\)/)
	// round 2: the tool bar stays usable, the preview sits at the pointer
	assert.match(src, /\[data-knorke-tool=frame\]'\)\.first\(\)\.click\(\{ trial: true/)
	assert.match(src, /near\(ghost\.x, to3\.x\) && near\(ghost\.y, to3\.y\)/)
	// round 3: the context bar of a symbol beside the panel takes a click
	assert.match(src, /\[data-knorke-section=color\]'\)\.first\(\)\.click\(\{ trial: true/)
	// round 5: a guest of the edit link with the panel open: the foot in the panel, "Zoom in" takes a click
	assert.match(src, /joinAsGuest\(g, await linkToken\(board\), 'Gina', board\)/)
	assert.match(src, /\.knorke-zoom button\[aria-label="Zoom in"\]'\)\.first\(\)\.click\(\{ trial: true/)
	assert.match(src, /await world\.drop\(g\)/)
})

test('E82: every check label starts with exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, 'labels found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.ok(!/waitForFunction|waitForTimeout/.test(src), 'no waits in the page (CSP)')
})
