/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E54 (live vote count for moderators, factory job 149), no
 * browser, no stack:
 * - scenarios/index.mjs: E54 once, directly after E53, before E09 (own
 *   board, no instance setting); the flake gate --only E54 --repeat 3 named
 * - E54: alice, bob (edit share) and Gina (guest, 390 × 844 with touch) on
 *   one board; the hooks of the switch, the button, the notices, the toast,
 *   the tabs; route 22 with live; bob's /sync answers watched for "tally";
 *   the 6-s limit for a new vote; a second session without live
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
const src = read('scenarios/live.mjs')

test('index: E54 once, directly after E53, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E54').length, 1)
	assert.equal(list.indexOf('E54'), list.indexOf('E53') + 1, 'directly after E53')
	assert.ok(list.indexOf('E54') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E54 \} from '\.\/live\.mjs'$/m)
	assert.ok(idx.includes('gate is --only E54 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E54 = \{\n\tid: 'E54',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E54: alice, bob and Gina on a phone; the hooks; route 22 with live; bob\'s answers without tally; ≤ 6 s; a session without live', () => {
	assert.match(src, /shareWith\(board, \[\{ kind: 'user', id: 'bob', role: 'edit' \}\]\)/)
	assert.match(src, /world\.actor\('gina-live', \{ touch: true, viewport: PHONE \}\)/)
	for (const hook of ['[data-knorke-field=vote-live]', '[data-knorke-action=vote-live]', '[data-knorke-vote-live-note=bar]', '[data-knorke-vote-live-note=panel]',
		'[data-knorke-toast=vote-live-note]', '[data-knorke-vote-tab=vote]', '[data-knorke-vote-tab=live]', 'ol[data-knorke-vote-live]', '[data-knorke-vote-live-item]']) {
		assert.ok(src.includes(hook), hook)
	}
	assert.match(src, /sent\.live === true/)
	assert.match(src, /aria-checked/, 'job 233: the check entry behind "⋯"')
	assert.match(src, /data-knorke-action=vote-more/)
	assert.match(src, /eye\.tap\(/)
	assert.match(src, /bobSync\.tally === 0/)
	assert.match(src, /timeout: 6000/)
	assert.match(src, /apiStart\(board\)/)
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)', '(9)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E54: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 40, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
