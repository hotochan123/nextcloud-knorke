/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Timer and vote countdowns (SPEC-M1 §4.12.2, §6.5.7, §6.6, §6.8), pure.
 * Every time is server time: the shell passes session.clock.now() as nowMs,
 * so all clients show the same rest (±1 s) also after a reload. The display
 * ticks on its own timeout to the next full second (nextTickMs), never on
 * the scene's animation frames.
 *
 * meta.timer (§3.11): {state: 'running', dur, end, left: null, by, seq} or
 * {state: 'paused', dur, end: null, left, by, seq}; missing = no timer. A
 * running timer with end ≤ now has run out: it stays 'running' on the
 * server and shows 'done' here ("Time's up") until someone stops or starts
 * it (§4.12.2).
 *
 * [data-knorke-timer-left] = the shown rest in ms rounded UP to whole
 * seconds (R16 TST-09), ≤ 0 → state 'done'. The "Time's up" banner shows for
 * TIME_UP_SHOW_MS after the end or until it is clicked away; that memory
 * belongs to the PAIR (seq, end) of the timer (R16 SRV-04): a new start or
 * "+1 min" is a new pair and may show it again.
 */

/** How long the "Time's up" banner stays at most (§6.6 TimerChip). */
export const TIME_UP_SHOW_MS = 30000
/** Shortest timeout of the display ticker. */
const MIN_TICK_MS = 20

/**
 * @param {unknown} raw meta.timer
 * @return {{state: 'running'|'paused', dur: number, end: (number|null), left: (number|null), by: string, seq: number}|null}
 */
export function timerOf(raw) {
	if (!raw || typeof raw !== 'object') {
		return null
	}
	const seq = Number.isInteger(raw.seq) ? raw.seq : 0
	const dur = Number.isFinite(raw.dur) ? raw.dur : 0
	const by = typeof raw.by === 'string' ? raw.by : ''
	if (raw.state === 'running' && Number.isFinite(raw.end)) {
		return { state: 'running', dur, end: raw.end, left: null, by, seq }
	}
	if (raw.state === 'paused' && Number.isFinite(raw.left)) {
		return { state: 'paused', dur, end: null, left: raw.left, by, seq }
	}
	return null
}

/**
 * @param {number} ms rest in ms
 * @return {number} rounded up to whole seconds, never below 0
 */
export function ceilSeconds(ms) {
	if (!Number.isFinite(ms) || ms <= 0) {
		return 0
	}
	return Math.ceil(ms / 1000) * 1000
}

/**
 * @param {number} ms rest in ms (rounded up to seconds for the display)
 * @return {string} "mm:ss" up to 99:59 (the longest timer), beyond that "h:mm:ss" (a vote may last 24 h)
 */
export function formatClock(ms) {
	const total = ceilSeconds(ms) / 1000
	const pad = (n) => String(n).padStart(2, '0')
	if (total < 6000) {
		return pad(Math.floor(total / 60)) + ':' + pad(total % 60)
	}
	const h = Math.floor(total / 3600)
	return h + ':' + pad(Math.floor((total % 3600) / 60)) + ':' + pad(total % 60)
}

/**
 * @param {object|null} timer timerOf(meta.timer)
 * @param {number} nowMs server time now
 * @return {{state: 'running'|'paused'|'done', leftMs: number, text: string}|null} what the chip shows
 */
export function timerView(timer, nowMs) {
	if (!timer) {
		return null
	}
	const raw = timer.state === 'paused' ? timer.left : timer.end - nowMs
	const leftMs = ceilSeconds(raw)
	const state = leftMs <= 0 ? 'done' : timer.state
	return { state, leftMs, text: formatClock(leftMs) }
}

/**
 * @param {number|null} endsAt meta.vote.endsAt (server ms) or null
 * @param {number} nowMs server time now
 * @return {string|null} the rest of a vote with a time limit as "mm:ss", null without one
 */
export function voteClock(endsAt, nowMs) {
	return Number.isFinite(endsAt) ? formatClock(endsAt - nowMs) : null
}

/**
 * @param {number} restMs exact rest in ms (end − now)
 * @return {number} ms until the shown (rounded up) second changes
 */
export function nextTickMs(restMs) {
	if (!Number.isFinite(restMs) || restMs <= 0) {
		return 1000
	}
	const r = restMs % 1000
	return Math.max(MIN_TICK_MS, r === 0 ? 1000 : r)
}

/**
 * @param {object|null} timer timerOf(meta.timer)
 * @return {string|null} the pair (seq, end) of a running timer, the memory key of its "Time's up"
 */
export function timerKey(timer) {
	return timer && timer.state === 'running' ? timer.seq + ':' + timer.end : null
}

/**
 * @param {object|null} timer timerOf(meta.timer)
 * @param {number} nowMs server time now
 * @param {string|null} dismissed key of the banner the user clicked away
 * @return {boolean} the "Time's up" banner shows
 */
export function timeUpShown(timer, nowMs, dismissed) {
	if (!timer || timer.state !== 'running' || timer.end > nowMs) {
		return false
	}
	return nowMs - timer.end < TIME_UP_SHOW_MS && timerKey(timer) !== dismissed
}

/**
 * Screen reader milestones of a running timer (§6.12): never every second.
 *
 * @param {number|null} prevMs shown rest at the previous tick (null: first tick)
 * @param {number} leftMs shown rest now
 * @return {'minute'|'seconds'|'end'|null} crossed 60 s, 10 s or 0
 */
export function milestone(prevMs, leftMs) {
	if (prevMs === null || !Number.isFinite(prevMs) || leftMs >= prevMs) {
		return null
	}
	if (leftMs <= 0 && prevMs > 0) {
		return 'end'
	}
	if (leftMs <= 10000 && prevMs > 10000) {
		return 'seconds'
	}
	if (leftMs <= 60000 && prevMs > 60000) {
		return 'minute'
	}
	return null
}
