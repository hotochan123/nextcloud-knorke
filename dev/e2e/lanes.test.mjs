/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E80 (swimlanes, factory job 199), no browser, no stack:
 * - scenarios/index.mjs: E80 once, directly after E78, before E09 (own
 *   board, no instance setting); the flake gate --only E80 --repeat 3 named
 * - E80: one board, alice and bob; real input for every step of AK7: the
 *   options menu of the frame tool, a drag, a double click, typing, Enter,
 *   a right click and the menu entries lane-down and lane-delete, Ctrl+Z,
 *   bob's drag of a lane border, the handle lane-add; the 3 s of AK7 (1)
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
const src = read('scenarios/lanes.mjs')

test('index: E80 once, directly after E79 (job 198\'s, after E78), before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E80').length, 1)
	assert.equal(list.indexOf('E80'), list.indexOf('E79') + 1, 'directly after E79 (job 198\'s, right after E78)')
	assert.ok(list.indexOf('E80') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E80 \} from '\.\/lanes\.mjs'$/m)
	assert.ok(idx.includes('--only E80 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E80 = \{\n\tid: 'E80',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E80: real input for every step of AK7, the 3 s, the hooks of the frame tool, the editor and the menu', () => {
	assert.match(src, /\[data-knorke-tool=frame\]'\)\.first\(\)\.click\(\{ button: 'right'/, 'job 229: the variants by a right-click')
	assert.match(src, /\[data-knorke-tool-option=lanes\]/)
	assert.match(src, /const SEEN_MS = 3000/)
	assert.match(src, /mouse\.dblclick\(/)
	assert.match(src, /data-knorke-editor-kind="lane"/)
	assert.match(src, /keyboard\.type\('Sales'\)/)
	assert.match(src, /press\('Enter'\)/)
	assert.match(src, /button: 'right'/)
	assert.match(src, /menuItem\(pa, 'lane-down'\)/)
	assert.match(src, /menuItem\(pa, 'lane-delete'\)/)
	assert.match(src, /press\('Control\+z'\)/)
	assert.match(src, /dragPath\(pb, line/, 'bob drags a lane border')
	assert.match(src, /'lane-add'/)
	assert.match(src, /scene\(\)\.lanes|\.lanes\b/)
	assert.match(src, /serverMap\('alice', board\)/)
})

test('E80: every check label starts with exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, 'labels found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.ok(!/waitForFunction|waitForTimeout/.test(src), 'no waits in the page (CSP)')
})
