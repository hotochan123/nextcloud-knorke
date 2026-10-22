/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Copy dialog of the text rescue (T6): every rescued text is kept, one block
 * per text, newest last; the list empties when the dialog closes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addRescue, rescueDialog } from '../../../src/components/rescue.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('two onRescue calls: both texts are kept, newest last, each with its own key', () => {
	let list = []
	list = addRescue(list, { id: 'A', text: 'Notes from interview 1', gone: true })
	list = addRescue(list, { id: 'B', text: 'Notes from interview 2', gone: true })
	assert.deepEqual(list.map((r) => r.text), ['Notes from interview 1', 'Notes from interview 2'])
	assert.notEqual(list[0].key, list[1].key)
	assert.deepEqual(rescueDialog(list), { name: 'These items were deleted', message: 'Your texts:' })
})

test('dialog texts: one deleted item, texts of items that still exist', () => {
	const one = addRescue([], { id: 'A', text: 'x', gone: true })
	assert.deepEqual(rescueDialog(one), { name: 'This item was deleted', message: 'Your text:' })
	const kept = addRescue([], { id: 'A', text: 'x', gone: false })
	assert.deepEqual(rescueDialog(kept), { name: 'Text not saved', message: 'Your text:' })
	const mixed = addRescue(one, { text: 'y' })
	assert.deepEqual(rescueDialog(mixed), { name: 'Text not saved', message: 'Your texts:' })
	assert.equal(mixed[1].id, null)
	assert.equal(mixed[1].gone, false)
})

test('empty or non-string texts are not added', () => {
	assert.deepEqual(addRescue([], { text: '' }), [])
	assert.deepEqual(addRescue([], null), [])
	assert.deepEqual(addRescue([], { text: 5 }), [])
})

test('BoardView renders every rescued text and empties the list on close', () => {
	const src = readFileSync(join(ROOT, 'src', 'views', 'BoardView.vue'), 'utf8')
	assert.match(src, /onRescue: \(x\) => \{ rescues\.value = addRescue\(rescues\.value, x\) \}/)
	assert.match(src, /v-for="r in rescues"/)
	assert.match(src, /:key="r\.key"/)
	assert.match(src, /@confirm="closeRescues"/)
	assert.match(src, /@cancel="closeRescues"/)
	// closing empties the list (and hands a guest over after password_required, SPEC-M1 §6.4)
	assert.match(src, /function closeRescues\(\) \{\s*rescues\.value = \[\]/)
	assert.ok(!/rescueText/.test(src), 'no single slot left')
})
