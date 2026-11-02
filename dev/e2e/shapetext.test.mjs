/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E66 (the text of a shape without fill grabs the shape,
 * factory job 177), no browser, no stack:
 * - scenarios/index.mjs: E66 once, directly after E65 (job 175's), before
 *   E09 (own board, no instance setting); the flake gate --only E66
 *   --repeat 3 named
 * - E66: one board, alice alone; the shape of AK7 (400 × 240, fillOpacity
 *   0, "Hello" at 32) at 100 %; real input (mouse.click, dragPath,
 *   mouse.dblclick, no synthetic events); its text font and mouse tolerance
 *   match the app's (tokens FONT_FAMILY, InputController HIT_TOL_MOUSE_PX)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_FAMILY } from '../../src/model/tokens.js'
import { HIT_TOL_MOUSE_PX } from '../../src/scene/InputController.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/shapetext.mjs')

test('index: E66 once, directly after E65, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E66').length, 1)
	assert.equal(list.indexOf('E66'), list.indexOf('E65') + 1, 'directly after E65')
	assert.ok(list.indexOf('E66') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E66 \} from '\.\/shapetext\.mjs'$/m)
	assert.ok(idx.includes('is --only E66 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E66 = \{\n\tid: 'E66',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E66: the shape of AK7 at 100 %, real mouse input, the font and tolerance of the app', () => {
	assert.match(src, /x: 0, y: 0, w: 400, h: 240,\n\t\t\tdata: \{ kind: 'rect', text: TEXT \},\n\t\t\tstyle: \{ fill: '#ffffff', fillOpacity: 0, stroke: '#1a1a1a', strokeWidth: 2, fontSize: 32 \},/)
	assert.match(src, /const TEXT = 'Hello'/)
	assert.match(src, /const CAM = Object\.freeze\(\{ x: -200, y: -260, scale: 1 \}\)/, 'opened at 100 %')
	assert.match(src, /pa\.mouse\.click\(text\.x, text\.y\)/, '(1) a click on the text')
	assert.match(src, /pa\.mouse\.click\(empty\.x, empty\.y\)/, '(2) a click on empty canvas')
	assert.match(src, /dragPath\(pa, text, \{ x: text\.x \+ 100, y: text\.y \}\)/, '(2) a drag from the text, 100 px to the right')
	assert.match(src, /serverMap\('alice', board\)\)\.get\(S\)/, '(2) the server is asked')
	assert.match(src, /K\.w2s\(pa, s1\.x \+ 0\.75 \* s1\.w, s1\.y \+ s1\.h \/ 2\)/, '(3) 3/4 of the width, half the height')
	assert.match(src, /pa\.mouse\.click\(inside\.x, inside\.y\)/)
	assert.match(src, /pa\.mouse\.dblclick\(text2\.x, text2\.y\)/, '(4) a double click on the text')
	assert.match(src, /e\.id === S && e\.kind === 'shape'/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	// read as text: the scenario imports the harness, which needs the stack's env.json
	assert.equal(src.match(/^export const TEXT_FONT = '(.+)'$/m)?.[1], `32px ${FONT_FAMILY}`)
	assert.equal(Number(src.match(/^export const TOL_PX = (\d+)$/m)?.[1]), HIT_TOL_MOUSE_PX)
	for (const step of ['(1)', '(2)', '(3)', '(4)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E66: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 12, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
