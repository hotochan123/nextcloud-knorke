/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E67 (save as image, factory job 178), no browser, no stack:
 * - scenarios/index.mjs: E67 once, directly after E66 (job 177's), before
 *   E09 (own board, the legal links put back); the flake gate --only E67
 *   --repeat 3 named
 * - E67: one board; alice, bob, the guest Gina, carol at 500 × 800; the
 *   image's constants match the app's (EXPORT_MARGIN, EXPORT_SCALE,
 *   SELECTION_GAP_PX, the lock square of nodes/locks.js); the board menu
 *   through menuAction with BOARD_MENUS, the frame's context menu by a
 *   right click; the steps (a)–(g)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10); the legal links are cleared in `finally`
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPORT_MARGIN, EXPORT_SCALE } from '../../src/scene/exportImage.js'
import { lockSquare } from '../../src/scene/nodes/locks.js'
import { SELECTION_GAP_PX } from '../../src/model/tokens.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/exportpng.mjs')
const num = (name) => Number(src.match(new RegExp(`^export const ${name} = (\\d+(?:\\.\\d+)?)$`, 'm'))?.[1])

test('index: E67 once, directly after E66, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E67').length, 1)
	assert.equal(list.indexOf('E67'), list.indexOf('E66') + 1, 'directly after E66')
	assert.ok(list.indexOf('E67') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E67 \} from '\.\/exportpng\.mjs'$/m)
	assert.ok(idx.includes('is --only E67 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E67 = \{\n\tid: 'E67',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 4, 'alice, bob, Gina, carol')
	assert.match(src, /world\.actor\('carol-png', \{ user: 'carol', viewport: \{ width: 500, height: 800 \} \}\)/, '(g) 500 px wide')
})

test('E67: the image\'s constants are the app\'s (read as text: the scenario imports the harness, which needs env.json)', () => {
	assert.equal(num('MARGIN'), EXPORT_MARGIN)
	assert.equal(num('SCALE'), EXPORT_SCALE)
	assert.equal(num('SELECTION_GAP'), SELECTION_GAP_PX)
	const sq = lockSquare('inside', 1)
	assert.equal(num('LOCK_MID'), sq.x + sq.size / 2, 'the middle of a note\'s lock square at 100 %')
	assert.equal(sq.x, sq.y)
})

test('E67: the setup of AK8 and the steps (a)–(g)', () => {
	assert.match(src, /put\.frame\(F, \{ x: 400, y: -100, w: 500, h: 450, data: \{ title: 'E67 Frame' \} \}\)/)
	assert.match(src, /put\.sticky\(C, \{ x: 50, y: 100, parent: F,/, 'a frame with a child')
	assert.match(src, /put\.connector\(KC, \{ item: N1 \}, \{ item: N2 \}\)/, 'a connector')
	assert.match(src, /\[data-knorke-react="\$\{THUMBS\}"\]/, 'a note with a reaction')
	assert.match(src, /pa\.keyboard\.press\('g'\)[\s\S]*pa\.keyboard\.press\('Control\+Shift\+L'\)/, 'the grid on, N2 locked')
	assert.match(src, /pb\.mouse\.move\([\s\S]*\(await K\.scene\(pa\)\)\?\.cursors/, 'bob\'s cursor on the board')
	assert.match(src, /bridge\('legal-links', 'set'\)/)
	assert.match(src, /\} finally \{[\s\S]*bridge\('legal-links', 'clear'\)/, 'the legal links cleared in finally')
	assert.match(src, /world\.touchedLegal = true/, 'World.cleanup puts them back too')
	assert.match(src, /menuAction\(pa, 'export-png', \{ menus: BOARD_MENUS \}\)/, '(a) through the board menu')
	assert.match(src, /isPng\(fa\.bytes\)/, '(b) the signature')
	assert.match(src, /Math\.ceil\(\(la\.bounds\.w \+ 2 \* MARGIN\) \* SCALE\)/, '(b) ⌈(bounds + 32) · 2⌉')
	assert.match(src, /decodePng\(fa\.bytes\)/, '(c) the pixels')
	assert.match(src, /for \(const scale of \[0\.1, 1\.5\]\)/, '(d) 10 % and 150 %')
	assert.match(src, /bytesAt\[0\]\.equals\(bytesAt\[1\]\)/, '(d) byte-equal')
	assert.match(src, /pa\.mouse\.click\(title\.x, title\.y, \{ button: 'right' \}\)/, '(e) a right click on the frame')
	assert.match(src, /\[data-knorke-menu-item=export-png\]/)
	assert.match(src, /joinAsGuest\(g, L, 'Gina', board\)/, '(f) a guest through the link')
	assert.match(src, /used\?\.menu === '\[data-knorke-menu=overflow\]'/, '(g) the overflow menu')
	for (const step of ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
})

test('E67: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 40, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
