/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Server time (SPEC-M1 §6.5.7, stage 0). Every 2xx sync answer (and every
 * snapshot) carries `now` = the server's wall clock in ms when it built the
 * answer. SyncClient hands it over with t0/t1 = the monotonic clock
 * (performance.now) right before and after the request.
 *
 *   sample({now, t0, t1})  keeps the 8 youngest samples and uses the one with
 *                          the smallest round trip: the server built that
 *                          answer at most (t1 − t0)/2 away from the middle.
 *                          offset = now − (Date.now() at t1 − (t1 − t0)/2)
 *   now()                  Date.now() + offset
 *
 * Timer and vote countdowns (stage 3) compute only with now(); the display
 * ticks on its own setTimeout to the next full second inside the component,
 * never on the scene's rAF. Without a sample the offset is 0 (local clock).
 */

/** Samples kept (the youngest). */
export const CLOCK_SAMPLES = 8

const defaultMono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export class Clock {
	/**
	 * @param {object} [o] injection points (tests)
	 * @param {() => number} [o.wall] wall clock in ms (Date.now)
	 * @param {() => number} [o.mono] monotonic clock in ms, the same one the
	 *   sync client measures t0/t1 with (performance.now)
	 */
	constructor({ wall = Date.now, mono = defaultMono } = {}) {
		this.wall = wall
		this.mono = mono
		/** @type {Array<{offset: number, rtt: number}>} youngest last */
		this.samples = []
		this._offset = 0
	}

	/**
	 * One measurement. Ignored when a value is not finite or t1 < t0.
	 *
	 * @param {{now: number, t0: number, t1: number}} s server time and the request window
	 * @return {boolean} the sample was taken
	 */
	sample({ now, t0, t1 } = {}) {
		if (!Number.isFinite(now) || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) {
			return false
		}
		// Date.now() at the moment t1 was taken (the caller samples right after it)
		const wallAtT1 = this.wall() - (this.mono() - t1)
		const rtt = t1 - t0
		this.samples.push({ offset: now - (wallAtT1 - rtt / 2), rtt })
		if (this.samples.length > CLOCK_SAMPLES) {
			this.samples.splice(0, this.samples.length - CLOCK_SAMPLES)
		}
		let best = this.samples[0]
		for (const x of this.samples) {
			if (x.rtt < best.rtt) {
				best = x
			}
		}
		this._offset = best.offset
		return true
	}

	/** @return {number} server time minus local wall clock in ms (0 without samples) */
	get offset() {
		return this._offset
	}

	/** @return {number} the server's wall clock now, in ms */
	now() {
		return this.wall() + this._offset
	}
}
