/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOCK_SAMPLES, Clock } from '../../../src/board/clock.js'

/**
 * A clock whose wall and monotonic time are set by the test.
 *
 * @return {{c: Clock, t: {wall: number, mono: number}}}
 */
function fixture() {
	const t = { wall: 1_000_000, mono: 500 }
	const c = new Clock({ wall: () => t.wall, mono: () => t.mono })
	return { c, t }
}

test('SPEC-M1 §6.5.7 Clock: offset = now − (Date.now() at t1 − rtt/2); now() = Date.now() + offset; 0 without samples', () => {
	const { c, t } = fixture()
	assert.equal(c.offset, 0)
	assert.equal(c.now(), 1_000_000)
	// request from mono 400 to 500 (rtt 100); the server stamped 1_005_000
	assert.equal(c.sample({ now: 1_005_000, t0: 400, t1: 500 }), true)
	// Date.now() at t1 = 1_000_000 → middle of the request 999_950 → offset 5050
	assert.equal(c.offset, 5050)
	t.wall += 2000
	assert.equal(c.now(), 1_002_000 + 5050)
})

test('Clock: the sample with the smallest round trip among the 8 youngest wins', () => {
	const { c, t } = fixture()
	c.sample({ now: 1_000_000 + 900, t0: 0, t1: 500 })      // rtt 500 → offset 1150
	c.sample({ now: 1_000_000 + 100, t0: 480, t1: 500 })    // rtt 20 → offset 110
	assert.equal(c.offset, 110)
	c.sample({ now: 1_000_000 + 300, t0: 300, t1: 500 })    // rtt 200, worse
	assert.equal(c.offset, 110)
	// six more slow samples push the good one out of the window of 8
	for (let i = 0; i < CLOCK_SAMPLES - 1; i++) {
		c.sample({ now: 1_000_000 + 400, t0: 400, t1: 500 }) // rtt 100 → offset 450
	}
	assert.equal(c.samples.length, CLOCK_SAMPLES)
	assert.equal(c.offset, 450, 'the rtt-20 sample aged out; the best of the 8 youngest counts')
	void t
})

test('Clock: the wall time at t1 is derived when the sample is taken later than t1', () => {
	const { c, t } = fixture()
	t.mono = 600 // sampled 100 ms after the answer arrived at mono 500
	t.wall = 1_000_100
	c.sample({ now: 1_000_000, t0: 500, t1: 500 })
	assert.equal(c.offset, 0)
})

test('Clock: invalid samples are ignored', () => {
	const { c } = fixture()
	assert.equal(c.sample({ now: Number.NaN, t0: 0, t1: 1 }), false)
	assert.equal(c.sample({ now: 5, t0: 2, t1: 1 }), false, 't1 before t0')
	assert.equal(c.sample({ now: 5, t0: 0 }), false)
	assert.equal(c.sample(), false)
	assert.equal(c.samples.length, 0)
	assert.equal(c.offset, 0)
})
