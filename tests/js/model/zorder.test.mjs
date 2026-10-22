/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/zorder.js: alphabet, isValidKey against
 * tests/fixtures/zorder-golden.json (owned by the backend package, mirrored by
 * lib/Service/ZOrder.php) and against fractional-indexing 4.0 itself
 * (read-only from $ROOT/node_modules), ordering over layers with the id as
 * tie-breaker, and keyBetween/keysBetween never throwing: not for bad bounds
 * and not at an exhausted end of the key space (INPUT-1, SPEC §6.2 R4).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import {
	Z_DIGITS, Z_RE, isValidKey, cmpBytes, cmpOrder, keyBetween, keysBetween,
} from '../../../src/model/zorder.js'
import { layerRank } from '../../../src/model/registry.js'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/zorder-golden.json', import.meta.url), 'utf8'))

/** Deterministic PRNG (mulberry32). */
function prng(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** True when the library accepts k as a bound (its validateOrderKey). */
function libraryAccepts(k) {
	try {
		generateKeyBetween(k, null, Z_DIGITS)
		return true
	} catch {
		return false
	}
}

const SMALLEST = '0'.repeat(19)

describe('alphabet', () => {
	test('Z_DIGITS is base 36, strictly ascending by code unit', () => {
		assert.equal(Z_DIGITS, '0123456789abcdefghijklmnopqrstuvwxyz')
		for (let i = 1; i < Z_DIGITS.length; i++) {
			assert.ok(Z_DIGITS.charCodeAt(i - 1) < Z_DIGITS.charCodeAt(i))
		}
	})

	test('Z_RE: lowercase base 36, 1-64 characters', () => {
		assert.ok(Z_RE.test('i0'))
		assert.ok(Z_RE.test('z'.repeat(64)))
		assert.ok(!Z_RE.test('z'.repeat(65)))
		assert.ok(!Z_RE.test(''))
		assert.ok(!Z_RE.test('A0'))
		assert.ok(!Z_RE.test('i0\n'))
	})

	test('generated keys use only Z_DIGITS', () => {
		let k = keyBetween(null, null)
		for (let i = 0; i < 300; i++) {
			k = i % 3 === 0 ? keyBetween(null, k) : keyBetween(k, null)
			assert.match(k, /^[0-9a-z]+$/)
		}
	})
})

describe('isValidKey (zorder-golden)', () => {
	test('fixture has the frozen shape and the cases §4.8 requires', () => {
		assert.deepEqual(Object.keys(golden), ['valid', 'invalid'])
		for (const k of ['i0', 'hz', 'j00', 'i0a', 'i1', 'zzzzzzzzzzzzzzzzzzz']) {
			assert.ok(golden.valid.includes(k), k)
		}
		for (const k of ['a', 'zz', '0', 'i10', '', 'i0V', SMALLEST]) {
			assert.ok(golden.invalid.includes(k), JSON.stringify(k))
		}
		assert.ok(golden.invalid.some((k) => k.length === 65), 'a 65-character key')
	})

	for (const k of golden.valid) {
		test(`valid: ${JSON.stringify(k)}`, () => {
			assert.equal(isValidKey(k), true)
			assert.equal(libraryAccepts(k), true, 'fractional-indexing agrees')
		})
	}

	for (const k of golden.invalid) {
		test(`invalid: ${JSON.stringify(k)}`, () => {
			assert.equal(isValidKey(k), false)
		})
	}

	test('isValidKey = Z_RE + fractional-indexing for every golden key', () => {
		for (const k of [...golden.valid, ...golden.invalid]) {
			assert.equal(isValidKey(k), Z_RE.test(k) && libraryAccepts(k), JSON.stringify(k))
		}
	})

	test('isValidKey = Z_RE + fractional-indexing on 20000 seeded random strings', () => {
		const rnd = prng(7)
		const chars = Z_DIGITS + 'AZ-_ä'
		let valid = 0
		for (let i = 0; i < 20000; i++) {
			// Bias towards '0' so that trailing zeros and smallest keys show up.
			const len = 1 + Math.floor(rnd() * 24)
			let k = ''
			for (let j = 0; j < len; j++) {
				k += rnd() < 0.3 ? '0' : chars[Math.floor(rnd() * chars.length)]
			}
			const expected = Z_RE.test(k) && libraryAccepts(k)
			assert.equal(isValidKey(k), expected, JSON.stringify(k))
			if (expected) valid++
		}
		assert.ok(valid > 1000, `enough valid samples (${valid})`)
	})

	test('non-strings are never valid and never throw', () => {
		for (const v of [null, undefined, 0, 1, true, {}, [], ['i0'], new String('i0')]) {
			assert.equal(isValidKey(v), false, String(v))
		}
	})
})

describe('cmpBytes', () => {
	test('returns -1/0/1 by code unit, not by locale', () => {
		assert.equal(cmpBytes('i0', 'i0'), 0)
		assert.equal(cmpBytes('i0', 'i1'), -1)
		assert.equal(cmpBytes('i1', 'i0'), 1)
		assert.equal(cmpBytes('i0', 'i0a'), -1, 'prefix sorts first')
		assert.equal(cmpBytes('9', 'a'), -1)
		assert.equal(cmpBytes('Z', 'a'), -1, 'uppercase before lowercase')
		assert.equal(cmpBytes('a', 'B'), 1)
		assert.equal('a'.localeCompare('B'), -1, 'locale order would differ')
	})

	test('sorting keys with cmpBytes matches the key order', () => {
		const keys = keysBetween(null, null, 50)
		const shuffled = [...keys].reverse()
		assert.deepEqual(shuffled.sort(cmpBytes), keys)
	})
})

describe('order over layers', () => {
	const item = (id, t, z) => ({ id, rank: layerRank(t), z })

	test('frames always lie behind content, whatever their z', () => {
		const frame = item('F', 'frame', 'zzzzzzzzzzzzzzzzzzz')
		const note = item('N', 'sticky', '0000000000000000001')
		assert.ok(cmpOrder(frame, note) < 0)
		assert.ok(cmpOrder(note, frame) > 0)
	})

	test('within a layer z decides, then the id breaks ties', () => {
		const a = item('01JA0000000000000000000000', 'sticky', 'i1')
		const b = item('01JB0000000000000000000000', 'sticky', 'i0')
		assert.ok(cmpOrder(b, a) < 0, 'lower z first')
		const c = item('01JC0000000000000000000000', 'sticky', 'i0')
		assert.ok(cmpOrder(b, c) < 0, 'same z: smaller id first')
		assert.ok(cmpOrder(c, b) > 0)
		assert.equal(cmpOrder(c, { ...c }), 0)
	})

	test('a mixed set sorts to (rank, z, id)', () => {
		const items = [
			item('N3', 'sticky', 'i0'), item('F2', 'frame', 'i1'), item('N1', 'sticky', 'i0'),
			item('X1', 'mystery', 'h'), item('F1', 'frame', 'i1'), item('N2', 'sticky', 'hz'),
		]
		assert.deepEqual(items.sort(cmpOrder).map((i) => i.id), ['F1', 'F2', 'X1', 'N2', 'N1', 'N3'])
	})
})

describe('keyBetween', () => {
	test('first key is i0 and follows the library for valid ordered bounds', () => {
		assert.equal(keyBetween(null, null), 'i0')
		assert.equal(keyBetween(undefined, undefined), 'i0')
		for (const [a, b] of [[null, 'i0'], ['i0', null], ['i0', 'i1'], ['hz', 'i0'], ['i0', 'i0a'], ['j00', null], ['zzzzzzzzzzzzzzzzzzz', null]]) {
			assert.equal(keyBetween(a, b), generateKeyBetween(a, b, Z_DIGITS), `${a}..${b}`)
		}
	})

	test('result lies strictly between valid bounds and is valid', () => {
		const rnd = prng(3)
		let keys = [keyBetween(null, null)]
		for (let i = 0; i < 2000; i++) {
			const at = Math.floor(rnd() * (keys.length + 1))
			const a = at > 0 ? keys[at - 1] : null
			const b = at < keys.length ? keys[at] : null
			const k = keyBetween(a, b)
			assert.ok(isValidKey(k), k)
			if (a !== null) assert.equal(cmpBytes(a, k), -1, `${a} < ${k}`)
			if (b !== null) assert.equal(cmpBytes(k, b), -1, `${k} < ${b}`)
			keys = [...keys.slice(0, at), k, ...keys.slice(at)]
		}
		assert.equal(new Set(keys).size, keys.length)
	})

	test('never throws for invalid bounds; an invalid bound counts as null', () => {
		const bad = [...golden.invalid, undefined, 0, 42, true, {}, [], 'I0', 'i0 ']
		for (const x of bad) {
			for (const y of [null, 'i0', 'i5', ...bad.slice(0, 5)]) {
				const k1 = keyBetween(x, y)
				assert.ok(isValidKey(k1), `keyBetween(${JSON.stringify(x)}, ${JSON.stringify(y)})`)
				const k2 = keyBetween(y, x)
				assert.ok(isValidKey(k2), `keyBetween(${JSON.stringify(y)}, ${JSON.stringify(x)})`)
			}
		}
		assert.equal(keyBetween('a', 'i1'), keyBetween(null, 'i1'))
		assert.equal(keyBetween('i1', 'zz'), keyBetween('i1', null))
		assert.equal(keyBetween('i1', 'zz'), 'i2')
	})

	test('equal or swapped bounds give a key above a (two clients, same key)', () => {
		assert.equal(keyBetween('i1', 'i1'), keyBetween('i1', null))
		assert.equal(cmpBytes(keyBetween('i1', 'i1'), 'i1'), 1)
		assert.equal(keyBetween('i2', 'i1'), keyBetween('i2', null))
		assert.equal(cmpBytes(keyBetween('i2', 'i1'), 'i2'), 1)
		assert.equal(cmpBytes(keyBetween('i0a', 'i0a'), 'i0a'), 1)
	})

	test('every valid golden key works as a bound on both sides', () => {
		for (const k of golden.valid) {
			const above = keyBetween(k, null)
			const below = keyBetween(null, k)
			assert.ok(isValidKey(above) && cmpBytes(k, above) === -1, `above ${k}`)
			assert.ok(isValidKey(below) && cmpBytes(below, k) === -1, `below ${k}`)
		}
	})

	test('below the smallest integer + 1 it never returns the invalid smallest key', () => {
		const b = '0000000000000000001'
		assert.equal(generateKeyBetween(null, b, Z_DIGITS), SMALLEST, 'library edge')
		const k = keyBetween(null, b)
		assert.ok(isValidKey(k), k)
		assert.equal(cmpBytes(k, b), -1)
		assert.equal(cmpBytes(keyBetween(null, k), k), -1, 'and further down')
		let x = b
		for (let i = 0; i < 50; i++) {
			const y = keyBetween(null, x)
			assert.ok(isValidKey(y) && cmpBytes(y, x) === -1, y)
			x = y
		}
	})

	test('300 inserts at the same spot stay within 64 characters', () => {
		let lo = 'i0'
		const hi = 'i1'
		for (let i = 0; i < 300; i++) {
			const k = keyBetween(lo, hi)
			assert.ok(k.length <= 64)
			lo = k
		}
	})
})

describe('keysBetween', () => {
	test('n ascending valid keys strictly between the bounds', () => {
		for (const [a, b] of [[null, null], ['i0', null], [null, 'i0'], ['i0', 'i1'], ['hz', 'j00']]) {
			for (const n of [1, 2, 3, 10, 57]) {
				const keys = keysBetween(a, b, n)
				assert.equal(keys.length, n)
				for (let i = 0; i < n; i++) {
					assert.ok(isValidKey(keys[i]), keys[i])
					if (i > 0) assert.equal(cmpBytes(keys[i - 1], keys[i]), -1)
				}
				if (a !== null) assert.equal(cmpBytes(a, keys[0]), -1)
				if (b !== null) assert.equal(cmpBytes(keys[n - 1], b), -1)
				assert.deepEqual(keys, generateNKeysBetween(a, b, n, Z_DIGITS), `${a}..${b} n=${n}`)
			}
		}
	})

	test('same fallbacks as keyBetween', () => {
		assert.deepEqual(keysBetween('a', 'i1', 3), keysBetween(null, 'i1', 3))
		assert.deepEqual(keysBetween('i1', 'i1', 3), keysBetween('i1', null, 3))
		assert.deepEqual(keysBetween('i2', 'i1', 2), keysBetween('i2', null, 2))
		assert.deepEqual(keysBetween(42, {}, 2), keysBetween(null, null, 2))
	})

	test('non-positive or non-integer counts give []', () => {
		for (const n of [0, -1, 1.5, NaN, Infinity, '3', null, undefined]) {
			assert.deepEqual(keysBetween(null, null, n), [], String(n))
		}
	})
})

/*
 * INPUT-1: any edit-link holder can store a valid 64-character key at an end
 * of the key space with one sync. Above 'z'x64, below '0'x63+'1' and between
 * two adjacent 64-character keys the library only finds 65-character keys.
 * keyBetween/keysBetween must then return the nearest valid bound (ties are
 * broken by id in cmpOrder) instead of throwing on every client.
 */
describe('exhausted key space (INPUT-1)', () => {
	const TOP = 'z'.repeat(64)
	const BELOW_TOP = 'z'.repeat(63) + 'y'
	const BOTTOM = '0'.repeat(63) + '1'
	// Adjacent 64-character keys in the middle of the key space: keyBetween(a, a)
	// would fall back to keyBetween(a, null) = 'i1', far above b.
	const MID_A = 'i0' + 'z'.repeat(61) + 'y'
	const MID_B = 'i0' + 'z'.repeat(62)

	/** Effective bounds as keyBetween() reads them. */
	function bounds(a, b) {
		const lo = isValidKey(a) ? a : null
		let hi = isValidKey(b) ? b : null
		if (lo !== null && hi !== null && cmpBytes(lo, hi) >= 0) {
			hi = null
		}
		return [lo, hi]
	}

	/** Asserts lo <= k <= hi for the effective bounds. */
	function assertWithin(k, lo, hi, label) {
		assert.ok(isValidKey(k), `${label}: valid ${JSON.stringify(k)}`)
		assert.ok(k.length <= 64, `${label}: length ${k.length}`)
		if (lo !== null) assert.ok(cmpBytes(lo, k) <= 0, `${label}: ${lo} <= ${k}`)
		if (hi !== null) assert.ok(cmpBytes(k, hi) <= 0, `${label}: ${k} <= ${hi}`)
	}

	/** Asserts n valid, non-decreasing keys within the effective bounds. */
	function assertKeys(keys, n, a, b, label) {
		const [lo, hi] = bounds(a, b)
		assert.equal(keys.length, n, `${label}: count`)
		for (let i = 0; i < keys.length; i++) {
			assertWithin(keys[i], lo, hi, `${label}[${i}]`)
			if (i > 0) assert.ok(cmpBytes(keys[i - 1], keys[i]) <= 0, `${label}: ${keys[i - 1]} <= ${keys[i]}`)
		}
	}

	test('the edge keys are valid and the library overflows at them', () => {
		for (const k of [TOP, BELOW_TOP, BOTTOM, MID_A, MID_B]) {
			assert.equal(k.length, 64)
			assert.equal(isValidKey(k), true, k)
		}
		assert.equal(generateKeyBetween(TOP, null, Z_DIGITS).length, 65)
		assert.equal(generateKeyBetween(null, BOTTOM, Z_DIGITS).length, 65)
		assert.equal(generateKeyBetween(BELOW_TOP, TOP, Z_DIGITS).length, 65)
		assert.equal(generateKeyBetween(MID_A, MID_B, Z_DIGITS).length, 65)
		assert.equal(generateKeyBetween(BELOW_TOP, null, Z_DIGITS), TOP, 'one below the top still fits')
	})

	test('keyBetween(z x64, null) returns z x64', () => {
		assert.equal(keyBetween(TOP, null), TOP)
	})

	test('keyBetween(null, 0 x63 + 1) returns 0 x63 + 1', () => {
		assert.equal(keyBetween(null, BOTTOM), BOTTOM)
	})

	test('between two adjacent 64-character keys it returns a bound, never a 65-character key', () => {
		for (const [a, b] of [[BELOW_TOP, TOP], [MID_A, MID_B]]) {
			const k = keyBetween(a, b)
			assertWithin(k, a, b, `${a}..${b}`)
			assert.equal(k, a, 'upward or between: the lower bound')
		}
	})

	test('keysBetween at the ends returns n valid, non-decreasing keys', () => {
		const top5 = keysBetween(BELOW_TOP, null, 5)
		assertKeys(top5, 5, BELOW_TOP, null, 'below top')
		assert.deepEqual(top5, [TOP, TOP, TOP, TOP, TOP])
		const top3 = keysBetween(TOP, null, 3)
		assertKeys(top3, 3, TOP, null, 'top')
		assert.deepEqual(top3, [TOP, TOP, TOP])
		const bottom5 = keysBetween(null, BOTTOM, 5)
		assertKeys(bottom5, 5, null, BOTTOM, 'bottom')
		assert.deepEqual(bottom5, [BOTTOM, BOTTOM, BOTTOM, BOTTOM, BOTTOM])
	})

	test('keysBetween in an exhausted gap never jumps above the upper bound', () => {
		for (const [a, b] of [[BELOW_TOP, TOP], [MID_A, MID_B]]) {
			for (let n = 1; n <= 9; n++) {
				const keys = keysBetween(a, b, n)
				assertKeys(keys, n, a, b, `${a}..${b} n=${n}`)
			}
		}
	})

	test('a nearly exhausted gap still uses the keys that fit', () => {
		// 'i0' + 'z'x61 + 'x' .. MID_B: exactly one 64-character key ('...y') fits.
		const a = 'i0' + 'z'.repeat(61) + 'x'
		const keys = keysBetween(a, MID_B, 3)
		assertKeys(keys, 3, a, MID_B, 'nearly exhausted')
		assert.ok(keys.includes(MID_A), 'the one free key is used')
	})

	test('300 bring-to-front / send-to-back steps saturate at the ends and never throw', () => {
		let up = 'zzzzzzzzzzzzzzzzzzz'
		let down = '0000000000000000001'
		for (let i = 0; i < 300; i++) {
			const u = keyBetween(up, null)
			assertWithin(u, up, null, `front ${i}`)
			up = u
			const d = keyBetween(null, down)
			assertWithin(d, null, down, `back ${i}`)
			down = d
		}
		assert.equal(up, TOP)
		assert.equal(down, BOTTOM)
	})

	test('2000 random valid pairs incl. 64-character extremes: never throws, valid, lo <= k <= hi', () => {
		const rnd = prng(64)
		const pick = (s) => s[Math.floor(rnd() * s.length)]
		// Digits biased to both ends of the alphabet, where the walls are.
		const digit = () => {
			const r = rnd()
			return r < 0.3 ? 'z' : r < 0.6 ? '0' : pick(Z_DIGITS)
		}
		const randomKey = () => {
			const r = rnd()
			const head = r < 0.3 ? 'z' : r < 0.6 ? '0' : pick(Z_DIGITS)
			const i = Z_DIGITS.indexOf(head)
			const intLen = i < 18 ? 18 - i + 1 : i - 18 + 2
			let k = head
			while (k.length < intLen) k += digit()
			// Long fractions often, so 64-character keys come up.
			const fracLen = rnd() < 0.5 ? 64 - intLen : Math.floor(rnd() * (64 - intLen + 1))
			for (let j = 0; j < fracLen; j++) k += digit()
			while (k.length > intLen && k.endsWith('0')) k = k.slice(0, -1)
			return isValidKey(k) ? k : null
		}
		const fixed = [TOP, BELOW_TOP, BOTTOM, MID_A, MID_B, '0'.repeat(19) + '1', '0'.repeat(18) + '1', 'z'.repeat(19), ...golden.valid]
		const key = () => {
			const r = rnd()
			if (r < 0.1) return null
			if (r < 0.45) return pick(fixed)
			return randomKey()
		}
		let clamped = 0
		let sixtyFour = 0
		for (let i = 0; i < 2000; i++) {
			let a = key()
			let b = key()
			if (rnd() < 0.5) [a, b] = [b, a]
			// Every fifth pair is two neighbours in one exhausted or nearly exhausted gap.
			if (i % 5 === 0 && a !== null && a.length === 64) {
				b = a.slice(0, -1) + Z_DIGITS[Math.min(35, Z_DIGITS.indexOf(a[63]) + 1 + Math.floor(rnd() * 2))]
			}
			if (a !== null && a.length === 64) sixtyFour++
			const [lo, hi] = bounds(a, b)
			let k
			assert.doesNotThrow(() => { k = keyBetween(a, b) }, `keyBetween(${a}, ${b})`)
			assertWithin(k, lo, hi, `keyBetween(${a}, ${b})`)
			if (k === lo || k === hi) {
				// A bound only comes back when the gap is really exhausted.
				assert.ok(generateKeyBetween(lo, hi, Z_DIGITS).length > 64, `needless clamp ${a}..${b}`)
				clamped++
			} else {
				if (lo !== null) assert.equal(cmpBytes(lo, k), -1)
				if (hi !== null) assert.equal(cmpBytes(k, hi), -1)
			}
			const n = 1 + Math.floor(rnd() * 8)
			let keys
			assert.doesNotThrow(() => { keys = keysBetween(a, b, n) }, `keysBetween(${a}, ${b}, ${n})`)
			assertKeys(keys, n, a, b, `keysBetween(${a}, ${b}, ${n})`)
		}
		assert.ok(clamped > 50, `enough exhausted gaps (${clamped})`)
		assert.ok(sixtyFour > 200, `enough 64-character bounds (${sixtyFour})`)
	})
})
