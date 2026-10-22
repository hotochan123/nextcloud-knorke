/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Small seeded PRNG (mulberry32) plus helpers, port of the engine spike's
 * prng.js. Every random decision of the scene generator goes through one of
 * these, so every lab run sees byte-identical data.
 */

/**
 * @param {number} seed 32-bit seed
 * @return {object} generator with next/range/int/pick/chance/gauss/weighted/fork
 */
export function createRng(seed) {
	let s = seed >>> 0
	const next = () => {
		s = (s + 0x6D2B79F5) >>> 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	return {
		next,
		/** float in [a, b) */
		range: (a, b) => a + (b - a) * next(),
		/** integer in [a, b] */
		int: (a, b) => a + Math.floor(next() * (b - a + 1)),
		pick: (arr) => arr[Math.floor(next() * arr.length)],
		chance: (p) => next() < p,
		/** approx. normal distribution (Irwin-Hall, 4 samples) */
		gauss: (mean = 0, sd = 1) => mean + sd * ((next() + next() + next() + next() - 2) * 1.732),
		/** weighted pick over an array of weights */
		weighted: (weights) => {
			let sum = 0
			for (const w of weights) sum += w
			let r = next() * sum
			for (let i = 0; i < weights.length; i++) {
				r -= weights[i]
				if (r < 0) return i
			}
			return weights.length - 1
		},
		/** independent stream, stable regardless of call order elsewhere */
		fork: (salt) => createRng((seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0),
	}
}
