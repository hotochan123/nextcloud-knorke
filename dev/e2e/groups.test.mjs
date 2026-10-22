/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E42 (group items, factory job 026), no browser, no stack:
 * - scenarios/index.mjs: E42 once, directly after E41_PHONE, before E09
 *   (own board, no instance setting), its pass E42@390x844 right behind it;
 *   the flake gate --only E42 --repeat 3 named
 * - E42: alice on her own board, bob as an account through the edit link;
 *   the eight steps of the spec with their hooks (Ctrl+G, groupOutlines,
 *   the four corners, the blocked group button and its toast, Ctrl+D, Del
 *   and Ctrl+Z, the menu entry ungroup, Ctrl+Shift+L)
 * - E42@390x844: a touch context with a fine pointer (E39), a CDP tap,
 *   Ungroup in the viewport and at least 44 × 44, a tap on it
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
const src = read('scenarios/groups.mjs')

test('index: E42 once, directly after E41_PHONE, before E09; the pass E42@390x844 right behind it; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E42').length, 1)
	assert.equal(list.indexOf('E42'), list.indexOf('E41_PHONE') + 1, 'directly after E41_PHONE')
	assert.equal(list.indexOf('E42_PHONE'), list.indexOf('E42') + 1, 'the pass behind its case')
	assert.ok(list.indexOf('E42_PHONE') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E42, E42_PHONE \} from '\.\/groups\.mjs'$/m)
	assert.ok(idx.includes('its flake\n * gate is --only E42 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E42 = \{\n\tid: 'E42',/)
	assert.match(src, /export const E42_PHONE = \{\n\tid: 'E42',\n\tpass: `\$\{PHONE\.width\}x\$\{PHONE\.height\}`,/, 'a pass reporting as E42@390x844')
})

test('E42: alice on her own board, bob as an account through the edit link; the eight steps with their hooks', () => {
	assert.match(src, /world\.board\('E42 Gruppieren'\)/)
	assert.match(src, /world\.actor\('alice-gruppen', \{ user: 'alice' \}\)/)
	assert.match(src, /world\.actor\('bob-gruppen', \{ user: 'bob' \}\)/)
	assert.match(src, /await joinAsMember\(bob, L\)/, 'bob joins through the edit link')
	for (const step of ['(1)', '(2)', '(3)', '(4)', '(5)', '(6)', '(7)', '(8)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	for (const hook of ['[data-knorke-action=group]', '[data-knorke-toast=group-blocked]', '[data-knorke-menu-item=ungroup]']) {
		assert.ok(src.includes(hook), hook)
	}
	assert.match(src, /keyboard\.press\('Control\+g'\)/)
	assert.match(src, /keyboard\.press\('Control\+d'\)/)
	assert.match(src, /keyboard\.press\('Delete'\)[\s\S]*keyboard\.press\('Control\+z'\)/)
	assert.match(src, /keyboard\.press\('Control\+Shift\+L'\)/)
	assert.match(src, /\{ button: 'right' \}/, 'a real right click')
	assert.match(src, /groupOutlines \?\? 0\) === 1/, 'scene().groupOutlines = 1')
	assert.match(src, /\['bl', 'br', 'tl', 'tr'\]/, 'exactly the four corners')
	assert.match(src, /getAttribute\('aria-disabled'\)/)
	assert.match(src, /editing === B/, 'a double click on B edits B')
	assert.match(src, /mods: \['Control'\]/, 'the group drag without snapping')
})

test('E42@390x844: a touch context with a fine pointer, a CDP tap on a member, Ungroup in the viewport and ≥ 44 × 44, a tap dissolves the group', () => {
	assert.match(src, /touch: true, viewport: PHONE, fine: true/)
	assert.match(src, /Input\.dispatchTouchEvent/)
	assert.match(src, /ub\.width >= 44 && ub\.height >= 44/)
	assert.match(src, /ub\.x \+ ub\.width <= vp\.vw && ub\.y \+ ub\.height <= vp\.vh/)
	assert.match(src, /\[data-knorke-action=ungroup\]'\)\.first\(\)\.tap\(\)/)
})

test('E42: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 30, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
	const dual = lines.flatMap((l, i) => (/\[(S|C|B|D)\s*[/,&+|]\s*(S|C|B|D)\]/.test(l) ? [`${i + 1}: ${l.trim().slice(0, 100)}`] : []))
	assert.deepEqual(dual, [], 'labels with two owners')
})
