/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E86 (swimlane columns, factory job 208), no browser, no stack:
 * - scenarios/index.mjs: E86 once, directly after E85, before E09 (own
 *   board, no instance setting); the flake gate --only E86 --repeat 3 named
 * - E86: one board, alice and bob; real input for every step of AK8: right
 *   clicks and the menu entries column-add, column-right and column-delete,
 *   drags of a column's head, a lane's head and a column's edge, Ctrl+Z;
 *   the 3 s of AK8 (1)
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
const src = read('scenarios/lanecols.mjs')

test('index: E86 once, directly after E85, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E86').length, 1)
	assert.equal(list.indexOf('E86'), list.indexOf('E85') + 1, 'directly after E85')
	assert.ok(list.indexOf('E86') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E86 \} from '\.\/lanecols\.mjs'$/m)
	assert.ok(idx.includes('--only E86 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E86 = \{\n\tid: 'E86',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E86: real input for every step of AK8, the 3 s, the menu entries, the head drags and the edge', () => {
	assert.match(src, /const SEEN_MS = 3000/)
	assert.match(src, /button: 'right'/)
	assert.match(src, /menuItem\(pa, 'column-add'\)/)
	assert.match(src, /menuItem\(pa, 'column-right'\)/)
	assert.match(src, /menuItem\(pa, 'column-delete'\)/)
	assert.match(src, /dragPath\(pa, from2, to2/, 'alice drags a column head')
	assert.match(src, /dragPath\(pa, await laneHead\(pa, F, 0\), await laneHead\(pa, F, 2\)/, 'alice drags a lane head')
	assert.match(src, /dragPath\(pb, edge/, 'bob drags a column edge')
	assert.match(src, /press\('Control\+z'\)/)
	assert.match(src, /\.cols\b/)
	assert.match(src, /serverMap\('alice', board\)/)
})

test('E86: every check label starts with exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, 'labels found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.ok(!/waitForFunction|waitForTimeout/.test(src), 'no waits in the page (CSP)')
})
