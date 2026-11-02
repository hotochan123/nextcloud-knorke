/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E78 (elbow connectors run around items, factory job 197), no
 * browser, no stack:
 * - scenarios/index.mjs: E78 once, after E76, before E09 (own board, no
 *   instance setting); the flake gate --only E78 --repeat 3 named
 * - E78: one board, alice and bob; real mouse input (no synthetic events);
 *   the drag is checked while the button is still down and after release
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
const src = read('scenarios/routearound.mjs')

test('index: E78 once, after E76, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E78').length, 1)
	assert.ok(list.indexOf('E78') > list.indexOf('E76'), 'after E76')
	assert.ok(list.indexOf('E78') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E78 \} from '\.\/routearound\.mjs'$/m)
	assert.ok(idx.includes('--only E78 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E78 = \{\n\tid: 'E78',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E78: real mouse input, checked while the button is down and after release', () => {
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	const down = src.indexOf('pa.mouse.down()')
	const mid = src.indexOf("'[S] (2) alice: C läuft beim Ziehen nicht durch N3'")
	const up = src.indexOf('pa.mouse.up()')
	assert.ok(down > 0 && mid > down && up > mid, 'the check of step (2) runs between mouse.down and mouse.up')
	assert.match(src, /put\.connector\(C, \{ item: N1 \}, \{ item: N2 \}, \{ data: \{ route: 'elbow' \} \}\)/)
	assert.match(src, /const CAM = Object\.freeze\(\{ x: -200, y: -260, scale: 1 \}\)/, 'opened at 100 %')
})

test('E78: every check label names exactly one owner; no in-page polling', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 6, 'labels found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SBD]\] /, l)
	assert.doesNotMatch(src, /waitForFunction/)
})
