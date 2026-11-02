/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E92 (the look of the redesign foundation, factory job 226),
 * no browser, no stack:
 * - scenarios/index.mjs: E92 once, directly after E90, before E09 (own
 *   board, no instance setting); the flake gate --only E92 --repeat 3 named
 * - E92: one seeded board, alice with a mouse (1280 × 800), on a tablet
 *   (touch) and in the dark scheme; the measured bars, menus and dialog
 * - every check label names exactly one owner (SPEC-M1 §9.6)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/look.mjs')

test('index: E92 once, directly after E90, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E92').length, 1)
	assert.equal(list.indexOf('E92'), list.indexOf('E90') + 1, 'directly after E90')
	assert.ok(list.indexOf('E92') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E92 \} from '\.\/look\.mjs'$/m)
	assert.ok(idx.includes('--only E92 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E92 = \{\n\tid: 'E92',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 4, 'mouse, tablet, dark, the touch devices of (4)')
	assert.match(src, /const VIEW = \{ width: 1280, height: 800 \}/)
	assert.match(src, /world\.actor\('alice-look-touch', \{ user: 'alice', touch: true \}\)/)
	assert.match(src, /colorScheme: 'dark'/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
})

test('E92: what it measures', () => {
	for (const sel of ['[data-knorke-bar=top]', '[data-knorke-toolbar]', '.knorke-zoom', '#knorke-menus .v-popper__inner', '[data-knorke-dialog=shortcuts] .modal-container']) {
		assert.ok(src.includes(`'${sel}'`), sel)
	}
	// job 228: both islands of the top bar
	assert.match(src, /near\(top\?\.h, 44\) && near\(right\?\.h, 44\) && near\(zoom\?\.h, 44\)/)
	assert.match(src, /near\(topT\?\.h, 52\)/)
	assert.match(src, /dialog\?\.radius === '16px'/)
	assert.match(src, /topD\?\.bg === 'rgb\(43, 44, 48\)' && topD\.color === 'rgb\(235, 235, 235\)'/)
	assert.match(src, /canvas\?\.bg === 'rgb\(243, 242, 240\)'/)
	// job 229: the variants by a right-click on the tool, the shortcuts from the zoom menu, the undo island
	for (const tool of ['sticky', 'frame', 'connector']) assert.ok(src.includes(`[data-knorke-tool=${tool}]').first().click({ button: 'right' })`), tool)
	assert.ok(src.includes("'[data-knorke-menu=zoom] button'") && src.includes("const UNDO = '.knorke-undo'"))
	assert.doesNotMatch(src, /data-knorke-tool-options/)
	assert.doesNotMatch(src, /page\.evaluate\([^)]*setTimeout|waitForFunction|waitForTimeout/, 'waits only from Node with until()')
})

test('E92: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 24, `${labels.length} labels`)
	for (const l of labels) {
		assert.match(l, /^\[[CD]\] /, l)
		assert.doesNotMatch(l.slice(4), /\[[A-Z]\]/, l)
	}
})
