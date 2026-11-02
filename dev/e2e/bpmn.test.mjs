/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E84 (BPMN, factory job 204), no browser, no stack:
 * - scenarios/index.mjs: E84 once, directly after E83, before E09 (own
 *   board, no instance setting); the flake gate --only E84 --repeat 3 named
 * - E84: one board; real input for every step of AK8: the drag of the user
 *   task and of the pool with the mouse, the click on the gateway tile and
 *   on the board, the clicks that select and "Connect", "Tips" and "Message
 *   flow", Ctrl+Z; the pictures in light and dark
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
const src = read('scenarios/bpmn.mjs')

test('index: E84 once, directly after E83 (job 203\'s), before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E84').length, 1)
	assert.equal(list.indexOf('E84'), list.indexOf('E83') + 1, 'directly after E83')
	assert.ok(list.indexOf('E84') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E84 \} from '\.\/bpmn\.mjs'$/m)
	assert.ok(idx.includes('--only E84 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E84 = \{\n\tid: 'E84',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E84: real input for every step of AK8; the pictures in light and dark', () => {
	assert.match(src, /\[data-knorke-tool=shape\]'\)\.first\(\)\.click\(/, 'job 229: the shape tool opens the panel')
	assert.match(src, /mouse\.down\(\)[\s\S]*mouse\.up\(\)/, 'a drag with the mouse')
	assert.match(src, /drag\(pa, await centre\(pa, TILE\('bpmn\.userTask'\)\), to2\)/)
	assert.match(src, /drag\(pa, await centre\(pa, TILE\('bpmn\.pool'\)\), to4\)/)
	assert.match(src, /TILE\('bpmn\.exclusive'\)\)\.first\(\)\.click\(/)
	assert.match(src, /mouse\.click\(at3\.x, at3\.y\)/)
	assert.match(src, /keyboard\.down\('Shift'\)/)
	// job 230: "Connect" is an entry of the bar's "…"
	assert.match(src, /barMore\(pa, 'connect'/)
	assert.match(src, /\[data-knorke-section=caps\]:visible'\)\.first\(\)\.click\(/)
	assert.match(src, /\[data-knorke-action=flow-message\]:visible'\)\.first\(\)\.click\(/)
	assert.match(src, /keyboard\.press\('Control\+z'\)/)
	assert.match(src, /serverMap\('alice', board\)/)
	assert.match(src, /\['dark', 'dark'\]\]\) \{[\s\S]*colorScheme: scheme/, 'a fresh page in the dark theme')
	assert.match(src, /picture\(pa, 'light-bpmn'/)
	assert.match(src, /picture\(v\.page, 'dark-bpmn'/)
	assert.match(src, /K\.scene\(pa\)/, 'the lanes of the pool from the scene')
})

test('E84: every check label names exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 15, 'checks: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.doesNotMatch(src, /waitForFunction/, 'no waits in the page (CSP)')
})
