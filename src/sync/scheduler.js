/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Adaptive sync tick (SPEC-M0 §6.4), pure.
 *
 * The tick is measured from the START of the previous request (t0), not from
 * its answer (correction 4): a slow answer does not stretch the cadence.
 *
 *   more        → 0 (the page was full, ask again at once)
 *   failures    → backoff[min(f-1, 4)] * (1 + rand * 0.2), from now
 *   otherwise   base = hidden ? hiddenMs : viewOnly ? viewMs
 *                    : active ? activeMs ± jitterMs : idleMs
 *               active = own action or remote change within activeWindowMs,
 *                        or someone else is dragging
 *               urgent (final ops waiting) → min(base, commitGapMs)
 *               delay = max(0, t0 + base − now)
 *
 * Only FINAL ops are urgent (release after a drag, create, delete, color,
 * order, undo/redo, closing the editor). Intermediate text states (1 Hz) ride
 * the normal tick, otherwise a typing user would drive 3–6 requests/s.
 */

export const INTERVALS = Object.freeze({
	activeMs: 400,
	jitterMs: 50,
	idleMs: 1000,
	viewMs: 2000,
	hiddenMs: 5000,
	activeWindowMs: 5000,
	commitGapMs: 150,
	backoffMs: Object.freeze([1000, 2000, 4000, 8000, 15000]),
})

/**
 * @typedef {{t0:number, lastLocalAt:number, lastRemoteAt:number, remoteDragging:boolean,
 *            hidden:boolean, viewOnly:boolean, failures:number, more:boolean, urgent:boolean}} TickState
 */

/**
 * @param {TickState} state scheduler inputs
 * @param {number} nowMs current time (same clock as t0)
 * @param {object} [intervals] INTERVALS
 * @return {boolean} true when the session counts as active
 */
export function isActive(state, nowMs, intervals = INTERVALS) {
	return !!state.remoteDragging
		|| nowMs - (state.lastLocalAt ?? -Infinity) < intervals.activeWindowMs
		|| nowMs - (state.lastRemoteAt ?? -Infinity) < intervals.activeWindowMs
}

/**
 * Delay until the next request.
 *
 * @param {TickState} state scheduler inputs
 * @param {number} nowMs current time
 * @param {object} [intervals] INTERVALS
 * @param {() => number} [rand] random source in [0, 1)
 * @return {number} delay in ms (≥ 0)
 */
export function nextDelay(state, nowMs, intervals = INTERVALS, rand = Math.random) {
	if (state.more) {
		return 0
	}
	if (state.failures > 0) {
		const steps = intervals.backoffMs
		return steps[Math.min(state.failures - 1, steps.length - 1)] * (1 + rand() * 0.2)
	}
	let base
	if (state.hidden) {
		base = intervals.hiddenMs
	} else if (state.viewOnly) {
		base = intervals.viewMs
	} else if (isActive(state, nowMs, intervals)) {
		base = intervals.activeMs + (rand() * 2 - 1) * intervals.jitterMs
	} else {
		base = intervals.idleMs
	}
	if (state.urgent) {
		base = Math.min(base, intervals.commitGapMs)
	}
	return Math.max(0, state.t0 + base - nowMs)
}

/**
 * Delay after a poke (user activity): like nextDelay, but a poke never sends
 * before t0 + activeMs (it only switches the cadence to "active"). Urgent ops,
 * a full page and failures follow nextDelay unchanged.
 *
 * @param {TickState} state scheduler inputs (lastLocalAt already updated)
 * @param {number} nowMs current time
 * @param {object} [intervals] INTERVALS
 * @param {() => number} [rand] random source
 * @return {number} delay in ms (≥ 0)
 */
export function pokeDelay(state, nowMs, intervals = INTERVALS, rand = Math.random) {
	const d = nextDelay(state, nowMs, intervals, rand)
	if (state.more || state.failures > 0 || state.urgent) {
		return d
	}
	return Math.max(d, state.t0 + intervals.activeMs - nowMs)
}
