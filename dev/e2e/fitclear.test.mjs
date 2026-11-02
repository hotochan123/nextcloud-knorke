/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E90 (show everything clear of the bars, factory job 223), no
 * browser, no stack:
 * - scenarios/index.mjs: E90 once, directly after E88, before E09 (own
 *   board, no instance setting); the flake gate --only E90 --repeat 3 named
 * - E90: one seeded board, alice on 1280 × 800; "Show everything", "Zoom to
 *   selection", the frame list and Shift+1 with the open comment panel, each
 *   checked against the bars' boxes
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
const src = read('scenarios/fitclear.mjs')

test('index: E90 once, directly after E88, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E90').length, 1)
	assert.equal(list.indexOf('E90'), list.indexOf('E88') + 1, 'directly after E88')
	assert.ok(list.indexOf('E90') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E90 \} from '\.\/fitclear\.mjs'$/m)
	assert.ok(idx.includes('--only E90 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E90 = \{\n\tid: 'E90',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
	assert.match(src, /const VIEW = \{ width: 1280, height: 800 \}/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
})

test('E90: the four steps and the bars they check against', () => {
	assert.match(src, /seedOps\('alice', B, \[/)
	assert.equal((src.match(/button\[aria-label="Show everything"\]/g) || []).length, 1, '"Show everything" in (1)')
	assert.match(src, /locator\(CANVAS\)\.first\(\)\.focus\(\)\n\t+await p\.keyboard\.press\('Shift\+Digit1'\)/, 'Shift+1 with the canvas focused in (4)')
	// job 229: both from the zoom menu
	assert.match(src, /menuAction\(p, 'zoom-selection', \{ menus: ZOOM_MENUS \}\)/)
	assert.match(src, /await zoomToFrame\(p, F\)/)
	assert.match(src, /\[data-knorke-action=comments\]/)
	for (const sel of ['[data-knorke-bar=top]', '[data-knorke-toolbar]', '.knorke-zoom', '.knorke-undo', '[data-knorke-comments]']) {
		assert.ok(src.includes(`'${sel}'`), sel)
	}
	assert.match(src, /clearOf\(p, all, \{ \.\.\.BARS, panel: PANEL \}\)/, '(4) with the panel')
	assert.doesNotMatch(src, /page\.evaluate\([^)]*setTimeout|waitForFunction/, 'waits only from Node')
})

test('E90: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 10, `${labels.length} labels`)
	for (const l of labels) {
		assert.match(l, /^\[[CD]\] /, l)
		assert.doesNotMatch(l.slice(3), /\[[A-Z]\]/, l)
	}
})
