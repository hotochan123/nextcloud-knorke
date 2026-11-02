/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E59 (the second click opens a frame title only on its text,
 * factory job 158), no browser, no stack:
 * - scenarios/index.mjs: E59 once, after E58, before E09 (own board, no
 *   instance setting); the flake gate --only E59 --repeat 3 named
 * - E59: one board, alice alone; real input (mouse.click, mouse.dblclick,
 *   no synthetic events); its title font and text zone constants match the
 *   app's (tokens FRAME_TITLE_SIZE and FONT_FAMILY, InputController
 *   TITLE_CLICK_MIN_PX and TITLE_CLICK_PAD_PX)
 * - every check label names exactly one owner (SPEC-M1 §9.6); waits only
 *   from Node (CSP, trap 9.10)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_FAMILY, FRAME_TAB_PAD, FRAME_TITLE_BAND, FRAME_TITLE_SIZE, FRAME_TITLE_WEIGHT } from '../../src/model/tokens.js'
import { TITLE_CLICK_MIN_PX, TITLE_CLICK_PAD_PX } from '../../src/scene/InputController.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')
const src = read('scenarios/titleclick.mjs')

test('index: E59 once, after E58, before E09; flake gate named', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E59').length, 1)
	assert.ok(list.indexOf('E59') > list.indexOf('E58'), 'after E58')
	assert.ok(list.indexOf('E59') < list.indexOf('E09'), 'before E09 (own board)')
	assert.match(idx, /^import \{ E59 \} from '\.\/titleclick\.mjs'$/m)
	assert.ok(idx.includes('--only E59 --repeat 3.'), 'flake gate named')
	assert.match(src, /export const E59 = \{\n\tid: 'E59',/)
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.equal((src.match(/\bworld\.actor\(/g) || []).length, 1, 'alice alone')
})

test('E59: real mouse input, the frame of AK7, the title font and the zone constants of the app', () => {
	assert.match(src, /pa\.mouse\.click\(text\.x, text\.y\)/)
	assert.match(src, /pa\.mouse\.click\(beside\.x, beside\.y\)/)
	assert.match(src, /pa\.mouse\.dblclick\(beside\.x, beside\.y\)/)
	assert.doesNotMatch(src, /dispatchEvent|dispatch\(/, 'no synthetic events')
	assert.match(src, /put\.frame\(F, \{ x: 0, y: 0, w: 800, h: 600, data: \{ title: TITLE \} \}\)/)
	assert.match(src, /const TITLE = 'Retrospective sprint 12'/)
	assert.match(src, /const CAM = Object\.freeze\(\{ x: -200, y: -260, scale: 1 \}\)/, 'opened at 100 %')
	assert.match(src, /K\.w2s\(pa, 600, BAND_Y\)/, 'the click beside the text at 3/4 of 800')
	// read as text: the scenario imports the harness, which needs the stack's env.json
	assert.equal(src.match(/^export const TITLE_FONT = '(.+)'$/m)?.[1], `${FRAME_TITLE_WEIGHT} ${FRAME_TITLE_SIZE}px ${FONT_FAMILY}`)
	assert.equal(Number(src.match(/^const BAND_Y = (-?\d+)$/m)?.[1]), -FRAME_TITLE_BAND / 2, 'the middle of the title band')
	// job 243: the title starts FRAME_TAB_PAD in its tab
	assert.equal(Number(src.match(/^export const TAB_PAD = (\d+)$/m)?.[1]), FRAME_TAB_PAD)
	assert.match(src, /K\.w2s\(pa, TAB_PAD \+ W \/ 2, BAND_Y\)/, 'the middle of the title text in its tab')
	assert.equal(Number(src.match(/^export const MIN_PX = (\d+)$/m)?.[1]), TITLE_CLICK_MIN_PX)
	assert.equal(Number(src.match(/^export const PAD_PX = (\d+)$/m)?.[1]), TITLE_CLICK_PAD_PX)
	for (const step of ['(1)', '(2)', '(3)', '(4)']) {
		assert.ok(src.includes(`t.step('${step} `), `step ${step}`)
	}
})

test('E59: every check label names exactly one owner [S], [C], [B] or [D]; waits only from Node', () => {
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.doesNotMatch(code, /waitFor[F]unction/)
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 12, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
