/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frame-time recording (port of the engine spike's FrameMeter). Frame time is
 * the delta between consecutive requestAnimationFrame timestamps, i.e. what
 * the user perceives. Long tasks are collected where the browser supports
 * them. Only used by the measurement mode of the lab (report, no gate).
 */

/**
 * @param {number[]} sorted ascending values
 * @param {number} p percentile 0–100
 * @return {number|null}
 */
export function percentile(sorted, p) {
	if (!sorted.length) return null
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
	return sorted[idx]
}

const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

/**
 * @param {number[]} values samples
 * @return {{n:number, mean:number|null, p50:number|null, p95:number|null, p99:number|null, max:number|null}}
 */
export function summarize(values) {
	const s = values.slice().sort((a, b) => a - b)
	const sum = s.reduce((a, b) => a + b, 0)
	return {
		n: s.length,
		mean: round(s.length ? sum / s.length : null, 3),
		p50: round(percentile(s, 50), 3),
		p95: round(percentile(s, 95), 3),
		p99: round(percentile(s, 99), 3),
		max: round(s.length ? s[s.length - 1] : null, 3),
	}
}

/**
 * Frame statistics of one scenario (pure; FrameMeter.stop() and the lab
 * self-test use it). Thresholds as in the engine spike's frameStats
 * (knorke-spike/engine/src/metrics.js) and SPEC-M1 §8.8 point 5:
 * "% > 16,7/33 ms" are fixed thresholds (pctOver16 > 16.7 ms, pctOver33
 * > 33.4 ms); "verpasst" is relative to the idle refresh interval
 * (pctMissed > 1.5 intervals = at least one vsync missed, pctMissed2 > 2.5
 * intervals = at least two).
 *
 * @param {number[]} deltas frame times (ms, consecutive rAF timestamps)
 * @param {number} wallMs wall time of the scenario
 * @param {number} [refreshMs] idle rAF interval of this browser (measureRefresh)
 * @param {number[]|null} [longTasks] long task durations, null when unsupported
 * @return {object} frame statistics
 */
export function frameStats(deltas, wallMs, refreshMs, longTasks = null) {
	const s = summarize(deltas)
	const base = refreshMs || 1000 / 60
	const over = (t) => (deltas.length ? round((100 * deltas.filter((d) => d > t).length) / deltas.length, 2) : null)
	return {
		frames: deltas.length,
		wallMs: round(wallMs, 1),
		fps: round(wallMs ? (deltas.length * 1000) / wallMs : null, 1),
		p50: s.p50,
		p95: s.p95,
		p99: s.p99,
		max: s.max,
		mean: s.mean,
		pctOver16: over(16.7),
		pctOver33: over(33.4),
		pctMissed: over(1.5 * base),
		pctMissed2: over(2.5 * base),
		longTasks: longTasks ? longTasks.length : null,
		longTaskMs: longTasks ? round(longTasks.reduce((a, b) => a + b, 0), 1) : null,
	}
}

const supports = (type) => typeof PerformanceObserver !== 'undefined' &&
	(PerformanceObserver.supportedEntryTypes || []).includes(type)

export class FrameMeter {
	start() {
		this.stamps = []
		this.longTasks = supports('longtask') ? [] : null
		this.observer = null
		if (this.longTasks) {
			this.observer = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) this.longTasks.push(e.duration)
			})
			this.observer.observe({ type: 'longtask' })
		}
		this.running = true
		const loop = (ts) => {
			if (!this.running) return
			this.stamps.push(ts)
			requestAnimationFrame(loop)
		}
		requestAnimationFrame(loop)
		this.t0 = performance.now()
	}

	/**
	 * @param {number} [refreshMs] idle rAF interval of this browser (measureRefresh)
	 * @return {object} frame statistics
	 */
	stop(refreshMs) {
		this.running = false
		const wall = performance.now() - this.t0
		if (this.observer) {
			for (const e of this.observer.takeRecords()) this.longTasks.push(e.duration)
			this.observer.disconnect()
		}
		const deltas = []
		for (let i = 1; i < this.stamps.length; i++) deltas.push(this.stamps[i] - this.stamps[i - 1])
		return frameStats(deltas, wall, refreshMs, this.longTasks)
	}
}

/**
 * Idle rAF interval (median of n frames).
 *
 * @param {number} [n] frames
 * @return {Promise<number>} ms
 */
export function measureRefresh(n = 40) {
	return new Promise((resolve) => {
		const ts = []
		const loop = (t) => {
			ts.push(t)
			if (ts.length <= n) {
				requestAnimationFrame(loop)
			} else {
				const d = []
				for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1])
				d.sort((a, b) => a - b)
				resolve(Math.round(d[d.length >> 1] * 1000) / 1000)
			}
		}
		requestAnimationFrame(loop)
	})
}
