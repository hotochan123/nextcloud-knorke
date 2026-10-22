/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/ids.js: ULID shape and time prefix, client ids that match the
 * server rule of §4.5, uniqueness, and that randomness really comes from
 * crypto.getRandomValues.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ULID_RE, ulid, clientId } from '../../../src/model/ids.js'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Server rule for the client field (§4.5). */
const SERVER_CLIENT_RE = /^[A-Za-z][A-Za-z0-9]{0,15}$/

/** @param {string} id ULID @return {number} its time in ms */
function timeOf(id) {
	let t = 0
	for (const ch of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(ch)
	return t
}

/**
 * Replaces crypto.getRandomValues for one test and restores it afterwards.
 *
 * @param {import('node:test').TestContext} t test context
 * @param {(buf: Uint8Array) => Uint8Array} fake replacement
 */
function fakeRandom(t, fake) {
	const c = globalThis.crypto
	const own = Object.getOwnPropertyDescriptor(c, 'getRandomValues')
	t.after(() => {
		if (own) Object.defineProperty(c, 'getRandomValues', own)
		else delete c.getRandomValues
	})
	Object.defineProperty(c, 'getRandomValues', { value: fake, configurable: true, writable: true })
}

describe('ULID_RE', () => {
	test('matches the server column rule (Crockford, 26 characters)', () => {
		assert.equal(String(ULID_RE), String(/^[0-9A-HJKMNP-TV-Z]{26}$/))
		assert.ok(ULID_RE.test('01JA2B3C4D5E6F7G8H9J0KMNPQ'))
		for (const bad of ['01JA2B3C4D5E6F7G8H9J0KMNP', '01JA2B3C4D5E6F7G8H9J0KMNPQR', '01JA2B3C4D5E6F7G8H9J0KMNPI',
			'01JA2B3C4D5E6F7G8H9J0KMNPL', '01JA2B3C4D5E6F7G8H9J0KMNPO', '01JA2B3C4D5E6F7G8H9J0KMNPU',
			'01ja2b3c4d5e6f7g8h9j0kmnpq', '']) {
			assert.ok(!ULID_RE.test(bad), bad)
		}
	})
})

describe('ulid', () => {
	test('shape: 26 Crockford characters', () => {
		for (let i = 0; i < 1000; i++) {
			const id = ulid()
			assert.equal(id.length, 26)
			assert.match(id, ULID_RE)
		}
	})

	test('the first 10 characters encode the time', () => {
		const now = 1760100000000
		assert.equal(timeOf(ulid(now)), now)
		assert.equal(ulid(0).slice(0, 10), '0000000000')
		assert.equal(ulid(2 ** 48 - 1).slice(0, 10), '7ZZZZZZZZZ')
		const before = Date.now()
		const t = timeOf(ulid())
		assert.ok(t >= before && t <= Date.now())
	})

	test('ids sort by time', () => {
		const a = ulid(1000)
		const b = ulid(2000)
		assert.ok(a.slice(0, 10) < b.slice(0, 10))
		assert.ok(a < b)
	})

	test('bad times are clamped, never an invalid id', () => {
		assert.match(ulid(-5), ULID_RE)
		assert.equal(ulid(-5).slice(0, 10), '0000000000')
		assert.equal(ulid(2 ** 60).slice(0, 10), '7ZZZZZZZZZ')
		assert.match(ulid(NaN), ULID_RE)
		assert.match(ulid(12.9), ULID_RE)
		assert.equal(timeOf(ulid(12.9)), 12)
	})

	test('20000 ids in the same millisecond are distinct', () => {
		const ids = new Set()
		for (let i = 0; i < 20000; i++) ids.add(ulid(1760100000000))
		assert.equal(ids.size, 20000)
	})

	test('the random part uses the whole alphabet', () => {
		const seen = new Set()
		for (let i = 0; i < 500; i++) for (const ch of ulid().slice(10)) seen.add(ch)
		assert.equal(seen.size, 32)
	})

	test('randomness comes from crypto.getRandomValues', (t) => {
		let calls = 0
		fakeRandom(t, (buf) => {
			calls++
			return buf.fill(0)
		})
		assert.equal(ulid(0), '0'.repeat(26))
		assert.equal(clientId(), 'c' + 'A'.repeat(9))
		assert.ok(calls >= 2)
	})
})

describe('clientId', () => {
	test("'c' + 9 alphanumerics, accepted by the server rule", () => {
		for (let i = 0; i < 2000; i++) {
			const c = clientId()
			assert.match(c, /^c[A-Za-z0-9]{9}$/)
			assert.match(c, SERVER_CLIENT_RE)
		}
	})

	test('distinct and spread over all 62 characters', () => {
		const ids = new Set()
		const seen = new Set()
		for (let i = 0; i < 5000; i++) {
			const c = clientId()
			ids.add(c)
			for (const ch of c.slice(1)) seen.add(ch)
		}
		assert.equal(ids.size, 5000)
		assert.equal(seen.size, 62)
	})

	test('rejection sampling skips biased bytes (>= 248)', (t) => {
		let round = 0
		// First buffer: only biased bytes; afterwards byte 61 → '9'.
		fakeRandom(t, (buf) => buf.fill(round++ === 0 ? 250 : 61))
		assert.equal(clientId(), 'c' + '9'.repeat(9))
		assert.equal(round, 2)
	})
})
