/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E58 (link previews and the Smart Picker, factory job 157), no
 * browser, no stack:
 * - scenarios/index.mjs: E58 once, after E57, before E09 (own board, no
 *   instance setting)
 * - E58: one board, no browser actor, no bridge call; only core's OCS
 *   endpoints search, references/resolve and references/providers with
 *   Basic auth and OCS-APIRequest: true, plus Knorke's API for the setup
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
const src = read('scenarios/references.mjs')

test('index: E58 once, after E57, before E09', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E58').length, 1)
	assert.ok(list.indexOf('E58') > list.indexOf('E57'), 'after E57')
	assert.ok(list.indexOf('E58') < list.indexOf('E09'), 'before E09 (own board, no instance setting)')
	assert.match(idx, /^import \{ E58 \} from '\.\/references\.mjs'$/m)
	assert.match(src, /export const E58 = \{\n\tid: 'E58',/)
})

test('E58: one board, only HTTP, no instance setting', () => {
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.doesNotMatch(src, /\bworld\.(actor|switch|limiterReset)\(|\bbridge\(|setAppConfig/, 'no browser actor, no switched setting')
	assert.match(src, /'OCS-APIRequest': 'true'/)
	assert.match(src, /Authorization: 'Basic '/)
	for (const p of ['/search/providers/knorke/search?term=', '/references/resolve?reference=', '/references/providers']) {
		assert.ok(src.includes(p), p)
	}
	assert.match(src, /role: 'view'/, 'the share "Can view" for bob')
	assert.match(src, /`\$\{app\}\/p\/\$\{token\}`, `\$\{app\}\/join\/\$\{token\}`/, 'both link forms')
	assert.match(src, /for \(const user of \['alice', 'bob'\]\)/, 'both accounts for the link forms')
	assert.match(src, /cardOk\(a2\.ref, U\)/, 'the other form keeps link U')
})

test('E58: the card\'s picture is the board\'s sketch (job 236), without the notes\' texts', () => {
	assert.match(src, /const SKETCH = 'data:image\/svg\+xml;base64,'/)
	assert.match(src, /const NOTES = \['Gut', 'Schlecht', 'Ideen'\]/)
	for (const w of ['Gut', 'Schlecht', 'Ideen']) {
		assert.ok(src.includes(`data: { text: '${w}' }`), `the seeded note "${w}"`)
	}
	assert.match(src, /\(svg\.match\(\/<rect \/g\) \|\| \[\]\)\.length === 4/, 'the board colour and the 3 notes')
	assert.match(src, /&& sketchOk\(og\.thumb\) &&/, 'cardOk asks for the sketch')
	assert.doesNotMatch(src, /board-card\.svg'\)/, 'no longer the symbol of an empty board')
})

test('E58: every check label names exactly one owner [S], [C], [B] or [D]', () => {
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 12, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
