/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of E89 (team resources, factory job 222), no browser, no stack:
 * - scenarios/index.mjs: E89 once, after E36, before M01 (it switches
 *   Circles, so it runs with the cases after E16)
 * - E89: one board, no browser actor; only core's OCS team API with Basic
 *   auth and OCS-APIRequest: true, plus Knorke's API for the setup; Circles
 *   and the harness team only through world.switch (cleanup puts Circles
 *   back on)
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
const src = read('scenarios/teamresources.mjs')

test('index: E89 once, after E36, before M01', () => {
	const idx = read('scenarios/index.mjs')
	const list = idx.match(/SCENARIOS = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim())
	assert.equal(list.filter((x) => x === 'E89').length, 1)
	assert.ok(list.indexOf('E89') > list.indexOf('E36'), 'after E36 (switches Circles: with the cases after E16)')
	assert.ok(list.indexOf('E89') > list.indexOf('E16'), 'after E16')
	assert.ok(list.indexOf('E89') < list.indexOf('M01'), 'before M01')
	assert.match(idx, /^import \{ E89 \} from '\.\/teamresources\.mjs'$/m)
	assert.match(src, /export const E89 = \{\n\tid: 'E89',/)
})

test('E89: one board, only HTTP, Circles and the team through world.switch', () => {
	assert.equal((src.match(/\bworld\.board\(/g) || []).length, 1, 'one board')
	assert.doesNotMatch(src, /\bworld\.(actor|limiterReset)\(|\bbridge\(|setAppConfig/, 'no browser actor, no bridge call outside world.switch')
	assert.match(src, /'OCS-APIRequest': 'true'/)
	assert.match(src, /Authorization: 'Basic '/)
	for (const p of ['/teams/${encodeURIComponent(team)}/resources', '/teams/resources/knorke/${board}']) {
		assert.ok(src.includes(p), p)
	}
	assert.match(src, /world\.switch\('team-create', TEAM\)/)
	assert.match(src, /const TEAM = 'knorke-e2e-/, 'a harness team (normalise_ns destroys it)')
	assert.match(src, /world\.switch\('team-member', T, 'bob'\)/)
	assert.match(src, /world\.switch\('circles', 'off'\)[\s\S]*world\.switch\('circles', 'on'\)/, 'Circles off, then on again')
	assert.match(src, /kind: 'team', id: T, role: 'view'/, 'the team share "Can view"')
	for (const user of ['bob', 'alice', 'carol']) assert.ok(src.includes(`knorkeResources('${user}', T)`), user)
})

test('E89: every check label names exactly one owner [S], [C], [B] or [D]', () => {
	const lines = src.split('\n')
	const calls = lines.flatMap((l, i) => (/\bt\.(check|must)\(/.test(l) ? [/,\s*$/.test(l) || /\($/.test(l) ? l + ' ' + lines[i + 1] : l] : []))
	assert.ok(calls.length >= 14, `${calls.length} checks found`)
	const bad = calls.filter((l) => !/(['`])\[(S|C|B|D)\] /.test(l) || (l.match(/['`]\[(S|C|B|D)\] /g) || []).length !== 1).map((l) => l.trim().slice(0, 140))
	assert.deepEqual(bad, [], 'checks without exactly one label that starts with one owner')
})
