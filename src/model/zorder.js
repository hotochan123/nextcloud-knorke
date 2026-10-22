/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Stacking order keys (SPEC-M0 §6.2, §4.8).
 *
 * Order is ONE global key space with a layer rank in front: frames (layer
 * 'back') always lie behind content. Items compare by (rank, z, id); the id
 * breaks ties between equal keys that two clients created at the same time.
 * Keys are fractional-indexing 4.0 keys over the base-36 alphabet 0-9a-z,
 * used both as fraction digits and as integer-part heads, compared by code
 * unit (= byte order, because the alphabet is ASCII).
 *
 * isValidKey() is a port of the library's validateOrderKey (CC0) and mirrors
 * lib/Service/ZOrder.php; both are pinned by tests/fixtures/zorder-golden.json.
 * Without it a single stored key such as 'a' would make generateKeyBetween
 * throw on every client, so nobody could create or reorder on that board.
 */
import { generateKeyBetween } from 'fractional-indexing'

/** Key alphabet, ascending by code unit: fraction digits and integer heads. */
export const Z_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Allowed characters and length of a stored key. */
export const Z_RE = /^[0-9a-z]{1,64}$/

/** Longest key the server stores (§3.4 items.z STRING(64)). */
const Z_MAX = 64

const HALF = Z_DIGITS.length / 2

/** The smallest integer ('0' + 18 zeros) is not a valid key by itself. */
const SMALLEST_INTEGER = Z_DIGITS[0] + Z_DIGITS[0].repeat(HALF)

/**
 * Length of the integer part announced by a head character.
 *
 * @param {string} head first character of a key
 * @return {number} integer-part length, or 0 for a character outside Z_DIGITS
 */
function integerLength(head) {
	const i = Z_DIGITS.indexOf(head)
	if (head.length !== 1 || i < 0) {
		return 0
	}
	return i < HALF ? HALF - i + 1 : i - HALF + 2
}

/**
 * True when k is a key that fractional-indexing accepts as a bound
 * (validateOrderKey with digits = intDigits = Z_DIGITS) and that fits the
 * server column. Never throws.
 *
 * @param {unknown} k candidate key
 * @return {boolean}
 */
export function isValidKey(k) {
	if (typeof k !== 'string' || !Z_RE.test(k)) {
		return false
	}
	if (k === SMALLEST_INTEGER) {
		return false
	}
	const n = integerLength(k[0])
	if (n === 0 || k.length < n) {
		return false
	}
	// The fraction must not end in the zero digit (it would have a shorter twin).
	const fraction = k.slice(n)
	return fraction.length === 0 || fraction[fraction.length - 1] !== Z_DIGITS[0]
}

/**
 * Pure code-unit comparison (no locale), the order the server uses for z.
 *
 * @param {string} a first string
 * @param {string} b second string
 * @return {-1|0|1}
 */
export function cmpBytes(a, b) {
	if (a === b) {
		return 0
	}
	return a < b ? -1 : 1
}

/**
 * Total stacking order of two items: layer rank, then z, then id.
 * SceneModel.compareOrder() resolves ids to these tuples and calls this.
 *
 * @param {{rank:number, z:string, id:string}} a first item
 * @param {{rank:number, z:string, id:string}} b second item
 * @return {number} negative when a lies below b, positive when above, 0 when equal
 */
export function cmpOrder(a, b) {
	if (a.rank !== b.rank) {
		return a.rank < b.rank ? -1 : 1
	}
	const z = cmpBytes(a.z ?? '', b.z ?? '')
	if (z !== 0) {
		return z
	}
	return cmpBytes(a.id ?? '', b.id ?? '')
}

/**
 * Turns a raw library result into a storable key.
 *
 * @param {string} key result of generateKeyBetween(lo, hi)
 * @param {string|null} lo the valid lower bound it was generated from
 * @param {string|null} hi the valid upper bound it was generated from
 * @return {string} valid key with lo <= key <= hi
 */
function finish(key, lo, hi) {
	// generateKeyBetween(null, b) can decrement b's integer part down to the
	// smallest integer, which the library itself refuses as a bound later. The
	// smallest integer plus the middle digit is still below b and valid.
	if (key === SMALLEST_INTEGER) {
		key += Z_DIGITS[HALF]
	}
	// Exhausted key space (INPUT-1). Clients only get here after 310-370 inserts
	// at one spot or about 225 bring-to-front steps from 'z'x19, but any
	// edit-link holder can store a valid 64-character key at an end of the key
	// space with one sync: nothing of at most 64 characters lies above 'z'x64,
	// below '0'x63+'1' or between two adjacent 64-character keys. No validator
	// rule can remove that wall (every set of keys up to 64 characters has a
	// largest element), so instead of throwing on every client the result falls
	// back to the nearest valid bound: lo when going up or between, hi when going
	// down. The server accepts that existing key, and cmpOrder() breaks the tie
	// by id.
	if (key.length > Z_MAX) {
		return lo ?? hi
	}
	return key
}

/**
 * Key strictly between a and b (generateKeyBetween over Z_DIGITS).
 *
 * Never throws, for any inputs, because stored keys come from other clients:
 * - an invalid bound (wrong alphabet, too long, not a key at all) counts as null
 * - a >= b (two clients produced the same key, or the caller swapped them)
 *   gives keyBetween(a, null), a key above a
 * - when no key of at most 64 characters fits (the library's key would be
 *   longer), it returns the nearest valid bound instead: a when going up or
 *   between, b when going down (see finish()). The result then equals a bound
 *   rather than lying strictly between, so lo <= result <= hi always holds.
 *
 * @param {string|null|undefined} a lower bound or null for "before everything"
 * @param {string|null|undefined} b upper bound or null for "after everything"
 * @return {string} new key
 */
export function keyBetween(a, b) {
	const lo = isValidKey(a) ? a : null
	let hi = isValidKey(b) ? b : null
	if (lo !== null && hi !== null && cmpBytes(lo, hi) >= 0) {
		hi = null
	}
	return finish(generateKeyBetween(lo, hi, Z_DIGITS), lo, hi)
}

/**
 * n ascending keys between a and b (distinct and strictly between while the
 * key space has room), with the same fallbacks as keyBetween(). Mirrors
 * generateNKeysBetween: integer steps towards an open end, balanced midpoints
 * between two bounds. Never throws: once the key space is exhausted the
 * remaining positions repeat the clamped bound, so the keys are only
 * non-decreasing there and always stay within the bounds.
 *
 * @param {string|null|undefined} a lower bound or null
 * @param {string|null|undefined} b upper bound or null
 * @param {number} n how many keys; anything but a positive integer gives []
 * @return {string[]} ascending (non-decreasing at an exhausted end) keys
 */
export function keysBetween(a, b, n) {
	if (!Number.isInteger(n) || n <= 0) {
		return []
	}
	const lo = isValidKey(a) ? a : null
	let hi = isValidKey(b) ? b : null
	if (lo !== null && hi !== null && cmpBytes(lo, hi) >= 0) {
		hi = null
	}
	return nKeys(lo, hi, n)
}

/**
 * @param {string|null} a valid lower bound or null
 * @param {string|null} b valid upper bound above a, or null
 * @param {number} n count >= 0
 * @return {string[]} non-decreasing keys within [a, b]
 */
function nKeys(a, b, n) {
	if (n === 0) {
		return []
	}
	if (n === 1) {
		return [keyBetween(a, b)]
	}
	if (b === null) {
		let c = keyBetween(a, null)
		const out = [c]
		while (out.length < n) {
			const next = keyBetween(c, null)
			if (next === c) {
				// Clamped at the top: the same key for the rest.
				return out.concat(Array(n - out.length).fill(c))
			}
			c = next
			out.push(c)
		}
		return out
	}
	if (a === null) {
		let c = keyBetween(null, b)
		const out = [c]
		while (out.length < n) {
			const next = keyBetween(null, c)
			if (next === c) {
				// Clamped at the bottom: the same key for the rest.
				return out.concat(Array(n - out.length).fill(c)).reverse()
			}
			c = next
			out.push(c)
		}
		return out.reverse()
	}
	const mid = Math.floor(n / 2)
	const c = keyBetween(a, b)
	if (c === a) {
		// Clamped: no key fits strictly between a and b. Recursing on (a, a)
		// would fall back to keyBetween(a, null) and could jump above b.
		return Array(n).fill(c)
	}
	return [...nKeys(a, c, mid), c, ...nKeys(c, b, n - mid - 1)]
}
