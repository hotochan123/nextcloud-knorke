/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Generators of the HTTP harness: ULIDs, client ids, valid z keys and a
 * seeded PRNG. Independent of src/model/ on purpose (the harness is the
 * oracle, §8.3); crypto randomness for ids, the PRNG only drives the random
 * workload of converge.mjs, so a run can be repeated with --seed.
 */
import { randomBytes } from 'node:crypto'

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** ULID: 10 time characters + 16 random characters, Crockford base32. */
export function ulid(now = Date.now()) {
	let t = now
	let s = ''
	for (let i = 0; i < 10; i++) { s = CROCK[t % 32] + s; t = Math.floor(t / 32) }
	const r = randomBytes(16)
	for (let i = 0; i < 16; i++) s += CROCK[r[i] % 32]
	return s
}

/** 'c' + 9 alphanumerics, matching ^[A-Za-z][A-Za-z0-9]{0,15}$ (§4.5). */
export function clientId(prefix = 'c') {
	const r = randomBytes(9)
	let s = prefix
	for (let i = 0; i < 9; i++) s += ALNUM[r[i] % ALNUM.length]
	return s.slice(0, 16)
}

export const TOKEN_RE = /^[A-Za-z0-9]{24}$/

/**
 * A link token that is guaranteed to DIFFER from `tok` but still matches the
 * route requirement [A-Za-z0-9]{24}: the last character moves one step on in
 * the alphanumeric alphabet (wrapping). Needed by C38: Nextcloud merges a JSON
 * body key `token` into the request parameters, so a body token EQUAL to the
 * route token cannot be told apart (§4.1 JsonBody step 3 compares values);
 * only a differing one must be refused with 400.
 */
export function otherToken(tok) {
	if (typeof tok !== 'string' || !TOKEN_RE.test(tok)) throw new Error(`otherToken: kein Link-Token: ${tok}`)
	const last = tok[tok.length - 1]
	return tok.slice(0, -1) + ALNUM[(ALNUM.indexOf(last) + 1) % ALNUM.length]
}

/**
 * The n-th valid z key (fractional-indexing 4.0, base 36): heads i, j, k have
 * 2, 3, 4 integer characters and no fraction, so every key below is valid and
 * the sequence is strictly increasing: i0..iz (36), j00..jzz (1296), k000…
 */
export function zKey(n) {
	if (n < 36) return 'i' + B36[n]
	n -= 36
	if (n < 36 * 36) return 'j' + B36[Math.floor(n / 36)] + B36[n % 36]
	n -= 36 * 36
	if (n < 36 ** 3) return 'k' + B36[Math.floor(n / 1296)] + B36[Math.floor(n / 36) % 36] + B36[n % 36]
	throw new Error('zKey: Folge erschöpft')
}

/** Counter-backed z keys, unique per process. */
let zSeq = 0
export function nextZ() { return zKey(zSeq++) }

/** mulberry32 – small seeded PRNG for the random workload. */
export function prng(seed) {
	let a = seed >>> 0
	const next = () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	return {
		next,
		int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
		range: (lo, hi) => lo + next() * (hi - lo),
		pick: (arr) => arr[Math.floor(next() * arr.length)],
		chance: (p) => next() < p,
	}
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
export const round2 = (v) => Math.round(v * 100) / 100
