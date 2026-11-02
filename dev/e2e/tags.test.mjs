/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E75 (tags on notes, factory job 191), no browser, no stack:
 * - scenarios/index.mjs: E75 once, directly after E74, before E09 (own
 *   boards, no instance setting); the flake gate --only E75 --repeat 3 named
 * - E75: two boards, alice and bob (a guest of the edit link); real input
 *   for every step (a)–(f) of AK9 (clicks, typing, Enter, Esc, Ctrl+Z,
 *   Ctrl+C/V, the board menu); the 3 s of AK9 (a); job 213: step (g) in a
 *   laptop window of 1366 × 768, the editor's buttons and "Cancel"
 * - the "+7" chip E75 clicks is where src/scene/nodes/tags.js draws it
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tagRowPlan } from '../../src/scene/nodes/tags.js'
import { tagMap } from '../../src/model/tags.js'
import { TAG_H } from '../../src/model/tokens.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/tags.mjs')
// the scenario's constants, read as text (importing it would need the stack's env.json)
const EIGHT = Array.from({ length: 8 }, (_, i) => src.match(/`Tagname Nummer \$\{i \+ 1\}`/) ? `Tagname Nummer ${i + 1}` : null)
const MORE = Object.fromEntries([...(src.match(/export const MORE = Object\.freeze\(\{([^}]*)\}\)/)?.[1] ?? '').matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], Number(m[2])]))

test('index: E75 once, directly after E74, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E75').length, 1)
	assert.equal(list.indexOf('E75'), list.indexOf('E74') + 1, 'directly after E74')
	assert.ok(list.indexOf('E75') < list.indexOf('E09'), 'before E09 (own boards)')
	assert.match(idx, /^import \{ E75 \} from '\.\/tags\.mjs'$/m)
	assert.ok(idx.includes('--only E75 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E75 = \{\n\tid: 'E75',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 2, 'the board and the target of the copy')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 2, 'alice and bob')
	assert.match(src, /world\.actor\('bob-tags'\)/, 'bob without an account: a guest')
})

test('E75: the "+7" chip is where nodes/tags.js puts it for a 200 × 200 note with the eight names', () => {
	const tags = EIGHT.map((name, i) => ({ id: '01JT' + String(i + 1).padStart(22, '0'), name, color: '#43a047' }))
	const plan = tagRowPlan({ t: 'sticky', data: { tags: tags.map((x) => x.id) } }, tagMap(tags), 200, 200)
	assert.equal(plan.labels.length, MORE.shown)
	assert.equal(plan.more.n, MORE.n)
	assert.ok(MORE.x > plan.more.x + 2 && MORE.x < plan.more.x + plan.more.w - 2, 'x inside the chip')
	assert.ok(MORE.y > plan.y + 2 && MORE.y < plan.y + TAG_H - 2, 'y inside the chip')
	assert.match(src, /put\.sticky\(N3, \{ x: 0, y: 300, data: \{ text: 'Acht', tags: eight\.map\(\(x\) => x\.id\) \}/, 'N3 at (0, 300), 200 × 200 by default')
	assert.match(src, /at\(pa, 0 \+ MORE\.x, 300 \+ MORE\.y\)/)
})

test('E75: real input for every step of AK9, the 3 s, the hooks of the panels', () => {
	assert.match(src, /const SEEN_MS = 3000/)
	assert.match(src, /\[data-knorke-action=tags\]/)
	assert.match(src, /keyboard\.type\('Kosten'\)/)
	assert.match(src, /press\('Enter'\)/)
	assert.match(src, /press\('Escape'\)/)
	assert.match(src, /press\('Control\+z'\)/)
	// job 206: redo of creating a tag, bob's undo of deleting it
	assert.match(src, /press\('Control\+Shift\+z'\)/)
	assert.match(src, /pb\.keyboard\.press\('Control\+z'\)/)
	assert.match(src, /press\('Control\+c'\)/)
	assert.match(src, /press\('Control\+v'\)/)
	assert.match(src, /\[data-knorke-tag-edit\]/)
	assert.match(src, /\[data-knorke-tag-color=/)
	assert.match(src, /\[data-knorke-tag-name\]/)
	assert.match(src, /\[data-knorke-tag-check\]/)
	assert.match(src, /\[data-knorke-tag-list=/)
	assert.match(src, /menuAction\(pa, 'filter-tags', \{ menus: BOARD_MENUS \}\)/)
	assert.match(src, /\[data-knorke-tag-filter\]/)
	assert.match(src, /tagFilter/)
	assert.match(src, /\[data-knorke-tag-delete\]/)
	assert.doesNotMatch(src, /\[data-knorke-dialog=tag-delete\]/, 'job 206: deleting asks no question')
	assert.match(src, /\/vote`, \{ per: 3/)
	// job 213: the laptop window of the bug, the editor's buttons
	assert.match(src, /const LAPTOP = Object\.freeze\(\{ width: 1366, height: 768 \}\)/)
	assert.match(src, /p3\.setViewportSize\(LAPTOP\)/)
	assert.match(src, /\[data-knorke-tag-save\]/)
	assert.match(src, /\[data-knorke-tag-cancel\]/)
	assert.doesNotMatch(src, /dispatchEvent\(|waitForFunction/, 'no synthetic DOM events, no waitForFunction')
	for (const step of ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)']) {
		assert.ok(src.includes(`t.step('${step}`), step)
	}
})

test('E75: every check names one owner; waits from Node only', () => {
	const labels = [...src.matchAll(/t\.(?:check|must)\([^\n]*?, '(\[[A-Z]\][^']*)'/g)].map((m) => m[1])
	assert.ok(labels.length >= 30, `${labels.length} labels`)
	for (const l of labels) assert.match(l, /^\[[SCBD]\] /, l)
	assert.doesNotMatch(src, /page\.waitForFunction|\.waitForFunction\(/)
})
