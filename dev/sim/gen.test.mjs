/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the harness generators (lib/gen.mjs) – no stack needed.
 * Pins otherToken(), which C38 relies on: Nextcloud merges a JSON body key
 * `token` into the request parameters, so the case only means something when
 * the body token DIFFERS from the route token (§4.1 JsonBody step 3). Run:
 *   node --test 'dev/sim/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { otherToken, TOKEN_RE, zKey, clientId } from './lib/gen.mjs'

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

test('otherToken differs from the route token and still matches the route requirement', () => {
	for (const last of ALNUM) {
		const tok = 'Ab3'.padEnd(23, 'x') + last
		const o = otherToken(tok)
		assert.notEqual(o, tok, `last character ${last}`)
		assert.match(o, TOKEN_RE)
		assert.equal(o.length, 24)
		assert.equal(o.slice(0, 23), tok.slice(0, 23), 'only the last character changes')
	}
})

test('otherToken wraps at the end of the alphabet and is deterministic', () => {
	assert.equal(otherToken('a'.repeat(23) + '9'), 'a'.repeat(24))
	assert.equal(otherToken('a'.repeat(23) + 'z'), 'a'.repeat(23) + 'A')
	const tok = 'Q7mZ0pX2kL9aB4cD6eF8gH1j'
	assert.equal(otherToken(tok), otherToken(tok))
})

test('otherToken refuses anything that is not a link token', () => {
	for (const bad of ['', 'abc', 'a'.repeat(25), 'a'.repeat(23) + '-', null, 42]) {
		assert.throws(() => otherToken(bad), /kein Link-Token/)
	}
})

test('zKey stays strictly increasing across the head changes, clientId matches §4.5', () => {
	const keys = [0, 35, 36, 36 + 1295, 36 + 1296].map(zKey)
	assert.deepEqual(keys, ['i0', 'iz', 'j00', 'jzz', 'k000'])
	for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i], `${keys[i - 1]} < ${keys[i]}`)
	for (let i = 0; i < 50; i++) assert.match(clientId(), /^[A-Za-z][A-Za-z0-9]{0,15}$/)
})
