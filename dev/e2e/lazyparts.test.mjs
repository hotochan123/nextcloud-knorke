/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the cold start gate for the lazy parts (factory job 217),
 * no browser, no stack: E12 (scenarios/coldstart.mjs) checks that no cold
 * page asks for a lazy chunk; its LAZY_RE names the emoji list (job 172)
 * and exactly the parts of build/lazy-areas.mjs (the container does not see
 * build/, so the list is written out there).
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LAZY_AREAS } from '../../build/lazy-areas.mjs'

const src = readFileSync(new URL('./scenarios/coldstart.mjs', import.meta.url), 'utf8')

test('E12 (job 217): LAZY_RE names the emoji chunk and every lazy part, and the gate checks every page with it', () => {
	const re = src.match(/export const LAZY_RE = \/\^js\\\/\(([a-z|]+)\)-/)
	assert.ok(re, 'LAZY_RE in coldstart.mjs')
	assert.deepEqual(re[1].split('|'), ['emoji', ...Object.keys(LAZY_AREAS)])
	assert.match(src, /for \(const \[label, m\] of rows\) \{[\s\S]*?t\.check\(!m\.assetList\.some\(\(x\) => LAZY_RE\.test\(x\.split\('\?'\)\[0\]\)\), `\[C\] \$\{label\}: keine Anfrage an js\/emoji-\*\.chunk\.mjs/)
	const LAZY_RE = new RegExp(src.match(/export const LAZY_RE = \/(.+)\/\n/)[1])
	for (const f of ['js/share-B_OXyCc8.chunk.mjs', 'js/shapelib--52Dsx5Q.chunk.mjs', 'js/emoji-C8VPrDg0.chunk.mjs', 'js/admin-x.chunk.mjs']) {
		assert.ok(LAZY_RE.test(f), f)
	}
	for (const f of ['js/knorke-main.mjs', 'js/vendor-B_iOaJKQ.chunk.mjs', 'js/canvas-3i8HoVE_.chunk.mjs', 'css/knorke-style.css', 'l10n/de.js']) {
		assert.ok(!LAZY_RE.test(f), f)
	}
})
