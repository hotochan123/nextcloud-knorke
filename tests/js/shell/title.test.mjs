/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §1.4 / §6.6: the title is live; an open rename field is never
 * overwritten, and closing an untouched field must not send the old title
 * back (it would undo the rename of another tab).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renameTarget } from '../../../src/components/title.js'

test('renameTarget: only a draft changed against the title the field started with is sent', () => {
	assert.equal(renameTarget('Retro', 'Retro'), null, 'untouched')
	// another tab renamed to "Retro KW42" while the field was open: untouched draft → nothing
	assert.equal(renameTarget('Retro', 'Retro'), null)
	assert.equal(renameTarget('  Retro neu ', 'Retro'), 'Retro neu')
	assert.equal(renameTarget('   ', 'Retro'), null, 'empty never renames')
	assert.equal(renameTarget('A\uD800B', 'x'), 'A\uFFFDB', 'well-formed UTF-16 like every title')
})

test('TopBar keeps the start title and decides with renameTarget (never against the live prop)', () => {
	const src = readFileSync(new URL('../../../src/components/TopBar.vue', import.meta.url), 'utf8')
	assert.match(src, /startTitle = props\.title/)
	assert.match(src, /const next = renameTarget\(draft\.value, startTitle\)/)
	assert.doesNotMatch(src, /next !== props\.title/)
	assert.match(src, /v-model="draft"/, 'the field is bound to its own draft, not to the live title')
})

test('M1 §6.5.1/§15 an open rename field is never overwritten: only opening the field writes the draft (no watcher on the title, the own rename answer only reaches the title prop)', () => {
	const src = readFileSync(new URL('../../../src/components/TopBar.vue', import.meta.url), 'utf8')
	const script = src.slice(src.indexOf('<script setup>')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
	const writes = script.match(/\bdraft\.value\s*=(?!=)/g) ?? []
	assert.equal(writes.length, 1, 'exactly one write of the draft')
	const start = script.indexOf('async function startEdit()')
	assert.ok(start >= 0)
	const startEdit = script.slice(start, script.indexOf('\n}\n', start))
	assert.match(startEdit, /draft\.value = props\.title/, 'and it is in startEdit')
	assert.doesNotMatch(script, /\bwatch(Effect)?\s*\(/, 'nothing reacts to a title change while the field is open')
	assert.doesNotMatch(src, /:value="title"|v-model="title"/, 'the input is never bound to the live title')
})
