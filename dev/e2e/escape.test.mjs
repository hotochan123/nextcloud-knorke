/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E40 (Esc clears the selection for a signed-in user, factory
 * job 018), no browser, no stack:
 * - scenarios/index.mjs: E40 once, directly after E39, before E09 (own
 *   board, no instance setting); its flake gate --only E40 --repeat 8 named
 * - E40: alice signed in (no guest), one Esc press and one held Esc
 *   (keyboard.down again = auto-repeat) on the canvas; the precondition that
 *   a listener before the scene cancelled the Esc is a [D] check, the
 *   selection results are hard [S] checks, no note in their place
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
const src = read('scenarios/escape.mjs')

test('index: E40 once, directly after E39, before E09; flake gate --only E40 --repeat 8', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E40').length, 1)
	assert.equal(list.indexOf('E40'), list.indexOf('E39') + 1, 'directly after E39')
	assert.ok(list.indexOf('E40') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E40 \} from '\.\/escape\.mjs'$/m)
	assert.ok(idx.includes('its flake gate\n * is --only E40 --repeat 8.'), 'flake gate named')
})

test('E40: alice signed in on her own board; one Esc press, then Esc held with auto-repeats; hard [S] checks for the selection', () => {
	assert.match(src, /export const E40 = \{\n\tid: 'E40',/)
	assert.match(src, /world\.board\('E40 Esc'\)/)
	assert.match(src, /world\.actor\('alice-esc', \{ user: 'alice' \}\)/, 'a signed-in user (header menus of Nextcloud)')
	assert.doesNotMatch(src, /\/p\/\$\{/, 'not the guest page')
	assert.match(src, /await p\.keyboard\.press\('Escape'\)/, 'pressed once')
	assert.match(src, /await p\.keyboard\.down\('Escape'\)[\s\S]*for \(let i = 0; i < E40_REPEATS; i\+\+\) \{[\s\S]*await p\.keyboard\.down\('Escape'\)[\s\S]*await p\.keyboard\.up\('Escape'\)/, 'held: down, repeats, up')
	assert.match(src, /'\[D\] \(1\) Vorbedingung: das Esc auf der Leinwand war am Ende der window-Phase defaultPrevented/, 'the precondition is a check')
	assert.match(src, /t\.check\(cleared, '\[S\] \(1\) ein Esc mit Leinwand-Fokus leert die Auswahl'/)
	assert.match(src, /'\[S\] \(2\) schon der erste keydown \(keine Wiederholung\) leert die Auswahl'/, 'held: the first keydown, not a repeat')
	assert.match(src, /log2\[0\]\.repeat === false && log2\.slice\(1\)\.every\(\(x\) => x\.repeat === true\)/, 'the repeats are real auto-repeats')
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /t\.note\([^)]*leert/, 'no note in place of a selection check')
})

test('E40: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 10, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})
