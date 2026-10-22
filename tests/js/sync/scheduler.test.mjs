/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INTERVALS, isActive, nextDelay, pokeDelay } from '../../../src/sync/scheduler.js'

const base = (over = {}) => ({
	t0: 1000,
	lastLocalAt: -Infinity,
	lastRemoteAt: -Infinity,
	remoteDragging: false,
	hidden: false,
	viewOnly: false,
	failures: 0,
	more: false,
	urgent: false,
	...over,
})
const mid = () => 0.5 // jitter 0

test('more → 0', () => {
	assert.equal(nextDelay(base({ more: true, failures: 3, hidden: true }), 1100), 0)
})

test('failures → backoff steps with up to +20 % random, from now', () => {
	assert.equal(nextDelay(base({ failures: 1 }), 5000, INTERVALS, () => 0), 1000)
	assert.equal(nextDelay(base({ failures: 2 }), 5000, INTERVALS, () => 0), 2000)
	assert.equal(nextDelay(base({ failures: 3 }), 5000, INTERVALS, () => 0), 4000)
	assert.equal(nextDelay(base({ failures: 4 }), 5000, INTERVALS, () => 0), 8000)
	assert.equal(nextDelay(base({ failures: 5 }), 5000, INTERVALS, () => 0), 15000)
	assert.equal(nextDelay(base({ failures: 50 }), 5000, INTERVALS, () => 0), 15000)
	assert.equal(nextDelay(base({ failures: 1 }), 5000, INTERVALS, () => 0.999999), 1000 * (1 + 0.999999 * 0.2))
})

test('base intervals: hidden > viewOnly > active > idle, measured from t0 (request start)', () => {
	assert.equal(nextDelay(base({ hidden: true }), 1000, INTERVALS, mid), 5000)
	assert.equal(nextDelay(base({ viewOnly: true }), 1000, INTERVALS, mid), 2000)
	assert.equal(nextDelay(base(), 1000, INTERVALS, mid), 1000)
	assert.equal(nextDelay(base({ lastLocalAt: 900 }), 1000, INTERVALS, mid), 400)
	// the answer took 300 ms: the next request still starts at t0 + 400
	assert.equal(nextDelay(base({ lastLocalAt: 900 }), 1300, INTERVALS, mid), 100)
	// a slow answer (longer than the interval) → at once
	assert.equal(nextDelay(base({ lastLocalAt: 900 }), 2500, INTERVALS, mid), 0)
	// hidden wins over active and viewOnly
	assert.equal(nextDelay(base({ hidden: true, viewOnly: true, lastLocalAt: 999 }), 1000, INTERVALS, mid), 5000)
})

test('active: own action or remote change within 5 s, or someone dragging; jitter ±50', () => {
	assert.equal(isActive(base({ lastLocalAt: 0 }), 4999), true)
	assert.equal(isActive(base({ lastLocalAt: 0 }), 5000), false)
	assert.equal(isActive(base({ lastRemoteAt: 3000 }), 7000), true)
	assert.equal(isActive(base({ remoteDragging: true }), 99999), true)
	assert.equal(nextDelay(base({ remoteDragging: true }), 1000, INTERVALS, () => 0), 350)
	assert.equal(nextDelay(base({ remoteDragging: true }), 1000, INTERVALS, () => 1), 450)
})

test('urgent → min(base, commitGapMs) from t0', () => {
	assert.equal(nextDelay(base({ urgent: true }), 1000, INTERVALS, mid), 150)
	assert.equal(nextDelay(base({ urgent: true }), 1100, INTERVALS, mid), 50)
	assert.equal(nextDelay(base({ urgent: true, hidden: true }), 1000, INTERVALS, mid), 150)
	assert.equal(nextDelay(base({ urgent: true, viewOnly: true }), 1000, INTERVALS, mid), 150)
})

test('intermediate text states do not shorten the tick (they are not urgent)', () => {
	// a typing user: active, non-urgent ops queued → the normal active tick
	assert.equal(nextDelay(base({ lastLocalAt: 999, urgent: false }), 1000, INTERVALS, mid), 400)
})

test('poke never sends before t0 + activeMs, even with negative jitter', () => {
	// idle, poke at t0 + 380: active now, jitter −50 would give t0 + 350
	const s = base({ lastLocalAt: 1380 })
	assert.equal(nextDelay(s, 1380, INTERVALS, () => 0), 0)
	assert.equal(pokeDelay(s, 1380, INTERVALS, () => 0), 20)
	for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
		for (const now of [1000, 1200, 1399]) {
			const d = pokeDelay(base({ lastLocalAt: now }), now, INTERVALS, () => r)
			assert.ok(now + d >= 1000 + INTERVALS.activeMs, `now ${now} r ${r} → ${now + d}`)
		}
	}
	// urgent, more and failures are not clamped
	assert.equal(pokeDelay(base({ urgent: true, lastLocalAt: 1000 }), 1000, INTERVALS, mid), 150)
	assert.equal(pokeDelay(base({ more: true }), 1000, INTERVALS, mid), 0)
})
