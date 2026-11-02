/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E85 (BPMN files, factory job 205), no browser, no stack:
 * - scenarios/index.mjs: E85 once, directly after E84, before E09 (own
 *   board, no instance setting); the flake gate --only E85 --repeat 3 named
 * - E85: one board; the menus with real clicks (menuAction), the download,
 *   the file picker with the Camunda fixture and with "{}", Ctrl+Z; bob's
 *   menu without insert-bpmn-file; the pictures in light and dark
 * - the fixture it inserts (dev/e2e/fixtures: the container sees only dev/e2e) exists; the unit tests read the same file
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
const src = read('scenarios/bpmnfile.mjs')

test('index: E85 once, directly after E84 (job 204\'s), before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E85').length, 1)
	assert.equal(list.indexOf('E85'), list.indexOf('E84') + 1, 'directly after E84')
	assert.ok(list.indexOf('E85') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E85 \} from '\.\/bpmnfile\.mjs'$/m)
	assert.ok(idx.includes('--only E85 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E85 = \{\n\tid: 'E85',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E85: the menus, the download, the picker with the fixture and "{}", Ctrl+Z, bob without insert; pictures in light and dark', () => {
	assert.match(src, /download\(pa, \(\) => menuAction\(pa, 'export-bpmn', \{ menus: BOARD_MENUS \}\)\)/)
	assert.match(src, /pick\(pa, \(\) => menuAction\(pa, 'insert-bpmn-file', \{ menus: BOARD_MENUS \}\), FIXTURE\)/)
	assert.match(src, /buffer: Buffer\.from\('\{\}'\)/)
	assert.match(src, /count\(pb, '\[data-knorke-action=insert-bpmn-file\]'\)\) === 0/)
	assert.match(src, /keyboard\.press\('Control\+z'\)/)
	assert.match(src, /serverMap\('alice', board\)/)
	assert.match(src, /colorScheme: 'dark'/)
	assert.match(src, /picture\(pa, 'light-inserted'\)/)
	assert.match(src, /picture\(v\.page, 'dark-inserted'\)/)
	const fixture = path.join(DIR, 'fixtures/order-camunda.bpmn')
	assert.ok(fs.existsSync(fixture), 'the fixture')
	assert.match(src, /new URL\('\.\.\/fixtures\/order-camunda\.bpmn', import\.meta\.url\)/)
})

test('E85: every check label names exactly one owner; waits only from Node', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([\s\S]*?'(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 20, 'checks: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[[CBD]\] /, l)
	assert.doesNotMatch(src, /waitForFunction|waitForTimeout/)
})
