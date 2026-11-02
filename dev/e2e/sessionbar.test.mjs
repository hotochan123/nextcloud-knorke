/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E98 (the session bar, factory job 233), no browser, no stack:
 * - scenarios/index.mjs: E98 once, directly after E97 (job 232's), before E09 (own
 *   board, no instance setting); the flake gate named
 * - E98: the routes it starts with, real input (clicks in the bar, the
 *   badge click outside the note, the bubble), the bars check on the phone
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
const src = read('scenarios/sessionbar.mjs')

test('index: E98 once, directly after E97 (job 232\'s), before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E98').length, 1)
	assert.equal(list.indexOf('E98'), list.indexOf('E97') + 1, 'directly after E97')
	assert.ok(list.indexOf('E98') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E98 \} from '\.\/sessionbar\.mjs'$/m)
	assert.ok(idx.includes('--only E98 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E98 = \{\n\tid: 'E98',/)
	assert.doesNotMatch(src, /world\.switch\(|bridge\(|setAppConfig/, 'no instance setting')
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
})

test('E98: routes 22, 24 and 36, real clicks, the badge outside the note, the phone bars check', () => {
	assert.match(src, /'PUT', `\/api\/v1\/boards\/\$\{B\}\/timer`, \{ action: 'start'/)
	assert.match(src, /'POST', `\/api\/v1\/boards\/\$\{B\}\/vote`/)
	assert.match(src, /'POST', `\/api\/v1\/boards\/\$\{B\}\/comments`, \{ text: 'E98 Blase', item: M/)
	assert.match(src, /const VIEW = \{ width: 1024, height: 768 \}/)
	assert.match(src, /\[data-knorke-bar=top\] \[data-knorke-timer\]/, 'no timer in the header')
	assert.match(src, /Math\.abs\(panel\.w - 296\) <= 1/)
	assert.match(src, /const at = \{ x: corner\.x \+ d \+ 11, y: corner\.y - d - 11 \}/, '15.6 px from the badge centre: only its 32 px target hits')
	assert.match(src, /p\.mouse\.click\(at\.x, at\.y\)/)
	assert.match(src, /\[data-knorke-action=timer-end\]/)
	assert.match(src, /\[data-knorke-action=present-end\]/)
	assert.match(src, /\[data-knorke-menu-caption=running\]/)
	assert.match(src, /p\.setViewportSize\(\{ width: 700, height: 768 \}\)[\s\S]*knorke-sessionbar--compact/, 'round 3: the two-line fallback')
	assert.match(src, /world\.actor\('alice-sessionbar-phone', \{ user: 'alice', touch: true, viewport: PHONE \}\)/)
	assert.match(src, /checkBars\(snap, \{ requireVote: true \}\)/)
	assert.match(src, /x\.w < 43\.5 \|\| x\.h < 43\.5/, 'every button ≥ 44 px')
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E98: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	for (const m of code.matchAll(/t\.(?:check|must)\([\s\S]*?, '(\[[A-Z]\])[^']*'/g)) {
		assert.match(m[1], /^\[(S|C|B|D)\]$/)
	}
	const labels = [...code.matchAll(/t\.(?:check|must)\([^\n]*?['`](\[[A-Z]\][^'`]*)['`]/g)].map((m) => m[1])
	assert.ok(labels.length >= 20, 'checks found: ' + labels.length)
	for (const l of labels) assert.match(l, /^\[(S|C|B|D)\] /, l)
})
