/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E91 (lane and column groups, factory job 225), no browser,
 * no stack:
 * - scenarios/index.mjs: E91 once, directly after E86, before E09 (own
 *   board, no instance setting); the flake gate --only E91 --repeat 3 named
 * - E91: one board, alice and bob; real input for every step of AK8: right
 *   clicks and the menu entries lane-group, lane-ungroup and column-group,
 *   typing the name, drags of the group's edge and cell, Ctrl+Z; the 3 s
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
const src = read('scenarios/lanegroups.mjs')

test('index: E91 once, directly after E86, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E91').length, 1)
	assert.equal(list.indexOf('E91'), list.indexOf('E86') + 1, 'directly after E86')
	assert.ok(list.indexOf('E91') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E91 \} from '\.\/lanegroups\.mjs'$/m)
	assert.ok(idx.includes('--only E91 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E91 = \{\n\tid: 'E91',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
})

test('E91: real input for every step of AK8, the 3 s, the menu entries, the edge and the cell', () => {
	assert.match(src, /const SEEN_MS = 3000/)
	assert.match(src, /button: 'right'/)
	assert.match(src, /menuItem\(pa, 'lane-group'\)/)
	assert.match(src, /menuItem\(pa, 'lane-ungroup'\)/)
	assert.match(src, /menuItem\(pa, 'column-group'\)/)
	assert.match(src, /keyboard\.type\('Team'\)/)
	assert.match(src, /dragPath\(pa, edge/, 'alice drags the group edge')
	assert.match(src, /dragPath\(pa, cell/, 'alice drags the group cell')
	assert.match(src, /press\('Control\+z'\)/)
	assert.match(src, /serverMap\('alice', board\)/)
})

test('E91: every check label starts with exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, 'labels found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.ok(!/waitForFunction|waitForTimeout/.test(src), 'no waits in the page (CSP)')
})
