/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E51 (filter the selection, factory job 144), no browser, no
 * stack:
 * - scenarios/index.mjs: E51 once, directly after E50, before E09 (own
 *   board, no instance setting); the flake gate --only E51 --repeat 3 named
 * - E51: a tablet 1280 × 800 with touch and a fine pointer, Ctrl+A, CDP
 *   taps on the count button and on the entry group, the sizes (44 px), the
 *   focus and the group at the server
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
const src = read('scenarios/filter.mjs')

test('index: E51 once, directly after E50, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E51').length, 1)
	assert.equal(list.indexOf('E51'), list.indexOf('E50') + 1, 'directly after E50')
	assert.ok(list.indexOf('E51') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E51 \} from '\.\/filter\.mjs'$/m)
	assert.ok(idx.includes('its flake gate is --only E51 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E51 = \{\n\tid: 'E51',/)
	assert.match(src, /world\.board\('E51 Auswahl filtern'\)/)
})

test('E51: a tablet 1280 × 800 with touch and a fine pointer; Ctrl+A, CDP taps on the count button and the entry group; the hooks and sizes of the spec', () => {
	assert.match(src, /const TAB = Object\.freeze\(\{ width: 1280, height: 800 \}\)/)
	assert.match(src, /touch: true, viewport: TAB, fine: true/)
	assert.match(src, /keyboard\.press\('Control\+a'\)/)
	assert.match(src, /Input\.dispatchTouchEvent/)
	for (const hook of ['[data-knorke-action=filter]', '[data-knorke-panel=filter]', '[data-knorke-filter=group]', '.knorke-contextbar__count']) {
		assert.ok(src.includes(hook), hook)
	}
	assert.match(src, /btn\.x \+ btn\.width <= vp\.vw && btn\.y \+ btn\.height <= vp\.vh/, 'wholly in the viewport')
	assert.match(src, /btn\.width >= TOUCH - 0\.5 && btn\.height >= TOUCH - 0\.5/)
	assert.match(src, /entries\.every\(\(e\) => e\.h >= TOUCH - 0\.5\)/)
	assert.match(src, /const TOUCH = 44/)
	assert.match(src, /'sticky,shape,group'/)
	assert.match(src, /sameIds\(\(await K\.selection\(p\)\) \|\| \[\], \[N3, N4\]\)/)
	assert.match(src, /await canvasFocused\(p\)/)
	assert.match(src, /after\.get\(N3\)\?\.group === G && after\.get\(N4\)\?\.group === G/)
	for (const step of ['(1)', '(2)', '(3)', '(4)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E51: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 15, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})
