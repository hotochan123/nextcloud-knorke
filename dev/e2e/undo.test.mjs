/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E56 (undo keeps other people's changes, factory job 155), no
 * browser, no stack:
 * - scenarios/index.mjs: E56 once, directly after E55, before E09 (own
 *   board, no instance setting); the flake gate --only E56 --repeat 3 named
 * - E56: alice and bob on one board; bob recolours A through the context
 *   bar and drags B; Ctrl+Z twice and Ctrl+Shift+Z; the toast hook
 *   undo-changed with its text; the checks read the server's snapshot
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
const src = read('scenarios/undo.mjs')
const de = JSON.parse(fs.readFileSync(path.join(DIR, '../../l10n/de.json'), 'utf8')).translations

test('index: E56 once, directly after E55, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E56').length, 1)
	assert.equal(list.indexOf('E56'), list.indexOf('E55') + 1, 'directly after E55')
	assert.ok(list.indexOf('E56') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E56 \} from '\.\/undo\.mjs'$/m)
	assert.ok(idx.includes('gate is --only E56 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E56 = \{\n\tid: 'E56',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E56: alice and bob, bob recolours A and drags B, Ctrl+Z twice, Ctrl+Shift+Z, the toast undo-changed; checks on the server', () => {
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(src, /styleButton\(pb, 'style\.fill', BOB_FILL\)/)
	assert.match(src, /dragItem\(pb, B,/)
	assert.equal((src.match(/pa\.keyboard\.press\('Control\+z'\)/g) || []).length, 2, 'two undos')
	assert.equal((src.match(/pa\.keyboard\.press\('Control\+Shift\+z'\)/g) || []).length, 1, 'one redo')
	assert.ok(src.includes("const TOAST = '[data-knorke-toast=undo-changed]'"))
	const text = src.match(/const TEXT = '([^']+)'/)[1]
	assert.ok(Object.keys(de).some((k) => k.startsWith(`_${text.replace(/^1 /, '%n ')}_::`)), 'the toast text is the source text of the plural')
	assert.match(src, /serverMap\('alice', board\)/)
	for (const step of ['(1)', '(2)', '(3)', '(4)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E56: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 12, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
