/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_KEYS, readState } from '../../../src/util/state.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('STATE_KEYS equals PageController::INITIAL_STATE_KEYS (read as text, one line); 12 keys (SPEC-M1 §4.11.3, M2 privacy notice)', () => {
	const php = readFileSync(join(ROOT, 'lib', 'Controller', 'PageController.php'), 'utf8')
	const m = php.match(/^\s*public const INITIAL_STATE_KEYS = \[([^\]\n]*)\];\s*$/m)
	assert.ok(m, 'INITIAL_STATE_KEYS on one line')
	const keys = [...m[1].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1])
	assert.deepEqual([...STATE_KEYS], keys)
	assert.equal(STATE_KEYS.length, 12)
	assert.deepEqual([...STATE_KEYS], ['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal', 'linkInfo', 'privacy', 'privacyAdmin'])
})

test('readState: every key, missing or failing ones as null', () => {
	const values = { page: 'public', boardId: 7, linkToken: 'x'.repeat(24), linkState: 'ok', debug: true, protocol: 2, limits: { maxText: 6000 }, linkInfo: { role: 'vote', password: true } }
	const asked = []
	const state = readState((app, key, fallback) => {
		asked.push([app, key, fallback])
		if (key === 'joinToken') {
			throw new Error('missing')
		}
		return key in values ? values[key] : fallback
	})
	assert.deepEqual(asked.map((a) => a[1]), [...STATE_KEYS])
	assert.ok(asked.every((a) => a[0] === 'knorke' && a[2] === null))
	assert.equal(state.joinToken, null)
	assert.equal(state.boardId, 7)
	assert.deepEqual(state.linkInfo, { role: 'vote', password: true })
	assert.equal(state.legal, null, 'a key the page did not set is null')
	assert.equal(state.privacy, null)
	assert.equal(state.privacyAdmin, null)
	assert.equal(Object.isFrozen(state), true)
	assert.deepEqual(Object.keys(state), [...STATE_KEYS])
})
