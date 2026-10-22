/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frame statistics of the measurement mode (dev/scene-lab/metrics.js,
 * SPEC-M1 §8.5 and §8.8 point 5): the columns of the round-1b report
 * (p50/p95/p99, % > 16,7 ms, % > 33,4 ms, % verpasst) from a fixed list of
 * frame times, with the thresholds of the engine spike's frameStats.
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { FrameMeter, frameStats, percentile, summarize } from '../metrics.js'

const VSYNC = 16.665

describe('frameStats', () => {
	// 20 frames: 16 on time, one a little late, two one vsync over, one two over
	const deltas = [...Array(16).fill(VSYNC), 16.8, 33.33, 33.5, 50]

	test('fixed thresholds 16,7 and 33,4 ms, "verpasst" relative to the idle interval', () => {
		const f = frameStats(deltas, 400, VSYNC, [55, 61.25])
		assert.equal(f.frames, 20)
		assert.equal(f.wallMs, 400)
		assert.equal(f.fps, 50)
		assert.equal(f.pctOver16, 20, '16.8, 33.33, 33.5, 50')
		assert.equal(f.pctOver33, 10, '33.5, 50 (33.33 is one vsync, not over 33.4)')
		assert.equal(f.pctMissed, 15, '> 1.5 × 16.665 = 24.9975: 33.33, 33.5, 50')
		assert.equal(f.pctMissed2, 5, '> 2.5 × 16.665 = 41.6625: 50')
		assert.equal(f.p50, VSYNC)
		assert.equal(f.p95, 33.5)
		assert.equal(f.p99, 50)
		assert.equal(f.max, 50)
		assert.equal(f.longTasks, 2)
		assert.equal(f.longTaskMs, 116.3)
	})

	test('a frame of exactly 16,7 ms is not over; whole-millisecond stamps (WebKit) count 17 ms as over', () => {
		assert.equal(frameStats([16.7, 16.7], 33.4, VSYNC).pctOver16, 0)
		const webkit = frameStats([16, 17, 17, 16, 17, 17], 100, 16.5)
		assert.equal(webkit.pctOver16, 66.67)
		assert.equal(webkit.pctMissed, 0, 'the relative threshold keeps whole-ms jitter out of "verpasst"')
	})

	test('no frames: nulls; no refresh interval: 60 Hz base; long tasks unsupported: null', () => {
		const empty = frameStats([], 0, VSYNC)
		for (const k of ['fps', 'p50', 'p95', 'p99', 'max', 'pctOver16', 'pctOver33', 'pctMissed', 'pctMissed2']) assert.equal(empty[k], null, k)
		const f = frameStats([25, 26], 51)
		assert.equal(f.pctMissed, 50, '> 25 ms at the 60 Hz base')
		assert.equal(f.longTasks, null)
		assert.equal(f.longTaskMs, null)
	})

	test('percentile and summarize (nearest rank)', () => {
		assert.equal(percentile([1, 2, 3, 4], 50), 2)
		assert.equal(percentile([], 50), null)
		assert.deepEqual(summarize([3, 1, 2]), { n: 3, mean: 2, p50: 2, p95: 3, p99: 3, max: 3 })
	})
})

describe('FrameMeter', () => {
	const raf = globalThis.requestAnimationFrame
	after(() => {
		globalThis.requestAnimationFrame = raf
	})

	test('stop() reports frameStats of the recorded stamps (no own threshold logic)', () => {
		globalThis.requestAnimationFrame = () => 0
		const meter = new FrameMeter()
		meter.start()
		meter.stamps = [0, VSYNC, 2 * VSYNC, 2 * VSYNC + 33.5, 2 * VSYNC + 50]
		const f = meter.stop(VSYNC)
		const ref = frameStats([VSYNC, VSYNC, 33.5, 16.5], f.wallMs, VSYNC, meter.longTasks)
		for (const k of ['frames', 'p50', 'p95', 'p99', 'max', 'pctOver16', 'pctOver33', 'pctMissed', 'pctMissed2']) assert.equal(f[k], ref[k], k)
		assert.equal(f.pctOver33, 25)
	})
})
