/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Client-generated identifiers (SPEC-M0 §6.2).
 *
 * - Item ids are ULIDs: 10 characters of millisecond time plus 16 random
 *   characters, Crockford base32. The server only checks the shape (ULID_RE),
 *   so ids sort by creation time but nothing relies on that.
 * - Client ids name one tab on one board ('c' + 9 alphanumerics) and must
 *   match the server rule ^[A-Za-z][A-Za-z0-9]{0,15}$ (§4.5).
 *
 * Randomness comes from crypto.getRandomValues, which every browser offers even
 * in an insecure context (http://knorke-dev-*), unlike crypto.randomUUID (§0).
 * Node 22 provides the same global for the tests. There is deliberately no
 * Math.random fallback: colliding ids would silently merge two objects.
 */

/** Shape of an item id (Crockford base32 without I, L, O, U). */
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Crockford base32 alphabet; index = digit value. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Alphabet of client ids after the leading 'c'. */
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Largest time a ULID can carry (48 bit). */
const MAX_TIME = 2 ** 48 - 1

/**
 * @param {Uint8Array} bytes buffer to fill
 * @return {Uint8Array} the same buffer
 */
function fillRandom(bytes) {
	const c = globalThis.crypto
	if (!c || typeof c.getRandomValues !== 'function') {
		throw new Error('crypto.getRandomValues is not available')
	}
	return c.getRandomValues(bytes)
}

/**
 * New item id.
 *
 * @param {number} [now] time in ms; clamped to the 48-bit ULID range
 * @return {string} 26-character ULID
 */
export function ulid(now = Date.now()) {
	let t = Number.isFinite(now) ? Math.floor(now) : Date.now()
	t = Math.min(MAX_TIME, Math.max(0, t))
	let time = ''
	for (let i = 0; i < 10; i++) {
		time = CROCKFORD[t % 32] + time
		t = Math.floor(t / 32)
	}
	// 256 is a multiple of 32, so the low five bits of a byte are unbiased.
	const bytes = fillRandom(new Uint8Array(16))
	let rand = ''
	for (let i = 0; i < 16; i++) {
		rand += CROCKFORD[bytes[i] & 31]
	}
	return time + rand
}

/**
 * New client id for one tab on one board.
 *
 * @return {string} 'c' followed by 9 characters from [A-Za-z0-9]
 */
export function clientId() {
	let out = 'c'
	// 62 does not divide 256: reject bytes >= 248 (= 4 * 62) to stay unbiased.
	while (out.length < 10) {
		const bytes = fillRandom(new Uint8Array(16))
		for (let i = 0; i < bytes.length && out.length < 10; i++) {
			if (bytes[i] < 248) {
				out += ALNUM[bytes[i] % 62]
			}
		}
	}
	return out
}
