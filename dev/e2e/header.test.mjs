/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E93 (the redesigned header, factory job 228), no browser, no
 * stack:
 * - scenarios/index.mjs: E93 once, directly after E92, before E09 (own
 *   board, no instance setting); the flake gate --only E93 --repeat 3 named
 * - E93: one board open by link, alice with a mouse (1280 × 800) and at
 *   800 px, bob with a finger, a guest on a phone; what it measures
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
const src = read('scenarios/header.mjs')

test('index: E93 once, directly after E92, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E93').length, 1)
	assert.equal(list.indexOf('E93'), list.indexOf('E92') + 1, 'directly after E92')
	assert.ok(list.indexOf('E93') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E93 \} from '\.\/header\.mjs'$/m)
	assert.ok(idx.includes('--only E93 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E93 = \{\n\tid: 'E93',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 5, 'alice, bob with a finger, alice at 800 px, the guest and (round 3) the owner on a phone')
	assert.match(src, /const VIEW = \{ width: 1280, height: 800 \}/)
	assert.match(src, /world\.actor\('bob-header', \{ user: 'bob', touch: true, viewport: VIEW \}\)/)
	assert.match(src, /world\.actor\('alice-header-800', \{ user: 'alice', viewport: \{ width: 800, height: 800 \} \}\)/)
	assert.match(src, /world\.actor\('gast-header-phone', \{ touch: true, viewport: \{ width: 390, height: 844 \} \}\)/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
})

test('E93: what it measures', () => {
	for (const sel of ['[data-knorke-island=left]', '[data-knorke-island=right]', '#knorke-menus', '.knorke-banners > [data-knorke-bar=banner]']) assert.ok(src.includes(`'${sel}'`), sel)
	assert.match(src, /near\(left\.h, 44\) && near\(right\.h, 44\)/)
	assert.match(src, /'back,export-png,export-svg,export-pdf,export-bpmn,export-csv,download-board'/)
	assert.match(src, /'back,insert-template,insert-board-file,insert-bpmn-file,import-csv'/)
	assert.match(src, /\[data-knorke-share-room\] \[data-knorke-present=edit\]/)
	assert.match(src, /near\(panel\.w, 296\)/)
	assert.match(src, /\[data-knorke-banner=following\] \[data-knorke-action=notice-close\]/)
	assert.match(src, /button\[aria-label="Show everything"\]/)
	assert.match(src, /sub === 'Guest · Open by link'/)
	assert.match(src, /badge\.h >= 44 - TOL/, 'round 3: the guest\'s title target')
	assert.match(src, /rename\.h >= 44 - TOL && !!icon && icon\.w >= 44 - TOL/, 'round 3: the owner\'s two targets')
	assert.match(src, /near\(isl\.x \+ isl\.w, gb\.x \+ gb\.w - 8\)/)
	assert.doesNotMatch(src, /page\.evaluate\([^)]*setTimeout|waitForFunction|waitForTimeout/, 'waits only from Node with until()')
})

test('E93: every check label names exactly one owner', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 30, `${labels.length} labels`)
	for (const l of labels) {
		assert.match(l, /^\[[CD]\] /, l)
		assert.doesNotMatch(l.slice(4), /\[[A-Z]\]/, l)
	}
})
