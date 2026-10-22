/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replaceLoneSurrogates, wellFormed } from '../../../src/util/unicode.js'

const CASES = [
	['', ''],
	['plain', 'plain'],
	['a\uD83Db', 'a�b'],
	['\uDE00', '�'],
	['\uD83D', '�'],
	['\uDE00\uD83D', '��'],
	['😀', '😀'],
	['x😀\uD83D😀\uDE00', 'x😀�😀�'],
	['\uD83D😀', '�😀'],
]

test('wellFormed and its fallback replace unpaired surrogates with U+FFFD, keep pairs (T14)', () => {
	for (const [input, out] of CASES) {
		assert.equal(wellFormed(input), out, JSON.stringify(input))
		assert.equal(replaceLoneSurrogates(input), out, 'fallback: ' + JSON.stringify(input))
		assert.equal(out.isWellFormed(), true)
	}
})

test('wellFormed leaves non-strings alone', () => {
	assert.equal(wellFormed(null), null)
	assert.equal(wellFormed(5), 5)
	assert.equal(wellFormed(undefined), undefined)
})
