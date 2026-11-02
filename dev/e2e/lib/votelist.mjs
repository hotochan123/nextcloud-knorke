/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Measurement M01 of factory job 214, its pure part (scenarios/votelist.mjs
 * runs it in the browser): the board of 3000 notes in 20 frames as ops, z
 * keys beyond nextZ's range, the frame statistics of the scroll, medians,
 * the verdicts of the vote list thresholds and the report table. No harness
 * import, so dev/e2e/votelist.test.mjs runs it without a stack.
 *
 * Thresholds: M1 names no number for the vote list (SPEC-M1 §1.2 CLIENT-6,
 * "the long task appears only with ≈ 3000 notes on a phone"); job 214 takes
 * the nearest M1 thresholds (spec.md "Annahmen"): opening the list and a tap
 * on "+" like the first render of the whole board (≤ 250 ms, G14), the
 * scroll like the pan (≥ 45 fps, §8.8 point 6) and the zoom (≤ 25 % missed).
 * A value equal to its limit passes, a missing one fails.
 */

export const NOTES = 3000
export const FRAMES = 20
/** Ops per /sync of the seeding (dev/ipad/moderate.mjs writes 200 as well). */
export const BATCH = 200
/** Repetitions of the measurement, each after a reload (SPEC-M1 §8.8 point 4). */
export const REPS = 3
/** Frames of the scroll from the top to the bottom of the list. */
export const SCROLL_FRAMES = 120

export const VOTE_LIST_THRESHOLDS = Object.freeze([
	Object.freeze({ id: 'V1', name: 'Liste öffnen', like: 'S1', checks: Object.freeze([Object.freeze({ key: 'openMs', label: 'ms', op: '<=', limit: 250 })]) }),
	Object.freeze({
		id: 'V2', name: 'Liste scrollen', like: 'S4/S3',
		checks: Object.freeze([Object.freeze({ key: 'scrollFps', label: 'fps', op: '>=', limit: 45 }), Object.freeze({ key: 'scrollMissed', label: 'verpasst %', op: '<=', limit: 25 })]),
	}),
	Object.freeze({ id: 'V3', name: 'Abstimmen (Tipp auf +)', like: 'S1', checks: Object.freeze([Object.freeze({ key: 'tapMs', label: 'ms', op: '<=', limit: 250 })]) }),
])

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Strictly increasing valid z keys for n = 0 … 47 691 (i0…iz, j00…jzz,
 * k000…kzzz), like dev/sim/lib/gen.mjs zKey.
 *
 * @param {number} n position
 * @return {string}
 */
export function zKey(n) {
	if (!Number.isInteger(n) || n < 0) throw new Error(`zKey: ${n}`)
	if (n < 36) return 'i' + B36[n]
	n -= 36
	if (n < 36 * 36) return 'j' + B36[Math.floor(n / 36)] + B36[n % 36]
	n -= 36 * 36
	if (n < 36 ** 3) return 'k' + B36[Math.floor(n / 1296)] + B36[Math.floor(n / 36) % 36] + B36[n % 36]
	throw new Error('zKey: Folge erschöpft')
}

const WORDS = ['Idee', 'Kunde', 'Ziel', 'Risiko', 'Feedback', 'Prozess', 'schneller', 'einfacher', 'Daten', 'Team', 'Termin', 'Budget']

/**
 * The board of the measurement: 20 frames (5 × 4, 3700 × 2500) with 150
 * notes each (15 × 10, 200 × 200), texts of 2–7 words.
 *
 * @param {() => string} newId id factory (ULID)
 * @param {number} [notes] notes
 * @return {object[]} put ops, frames first
 */
export function boardOps(newId, notes = NOTES) {
	const frames = Array.from({ length: FRAMES }, (_, f) => ({
		o: 'put', id: newId(), t: 'frame',
		p: { x: (f % 5) * 4000, y: Math.floor(f / 5) * 2800, w: 3700, h: 2500, r: 0, z: zKey(f), parent: null, data: { title: `Phase ${f + 1}` }, style: { fill: '#ffffff' } },
	}))
	const per = Math.ceil(notes / FRAMES)
	const sticky = Array.from({ length: notes }, (_, i) => {
		const f = i % FRAMES
		const k = Math.floor(i / FRAMES)
		const words = Array.from({ length: 2 + (i % 6) }, (_, j) => WORDS[(i + j * 5) % WORDS.length]).join(' ')
		return {
			o: 'put', id: newId(), t: 'sticky',
			p: { x: 40 + (k % 15) * 230, y: 80 + Math.floor(k / 15) * 230, w: 200, h: 200, r: 0, z: zKey(FRAMES + i), parent: frames[f].id, data: { text: `Notiz ${i + 1}: ${words}` }, style: { fill: '#fff59d' } },
		}
	})
	if (per > 150) throw new Error(`boardOps: ${per} Notizen je Frame passen nicht`)
	return [...frames, ...sticky]
}

/**
 * @param {number[]} deltas consecutive rAF intervals (ms)
 * @param {number} refreshMs idle rAF interval
 * @return {{frames: number, fps: (number|null), pctMissed: (number|null)}} like dev/scene-lab/metrics.js frameStats: missed = interval > 1.5 × idle
 */
export function frameSummary(deltas, refreshMs) {
	const d = deltas.filter((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)
	const sum = d.reduce((a, b) => a + b, 0)
	const base = refreshMs > 0 ? refreshMs : 1000 / 60
	return {
		frames: d.length,
		fps: d.length && sum > 0 ? Math.round((d.length * 10000) / sum) / 10 : null,
		pctMissed: d.length ? Math.round((10000 * d.filter((x) => x > 1.5 * base).length) / d.length) / 100 : null,
	}
}

/**
 * @param {Array<number|null|undefined>} values values
 * @return {number|null} the median of the numbers (two middles: their mean), null without one
 */
export function median(values) {
	const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
	if (v.length === 0) return null
	const m = Math.floor(v.length / 2)
	return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 10) / 10
}

/**
 * @param {Array<object>} reps one {openMs, scrollFps, scrollMissed, tapMs, …} per repetition
 * @return {object} the median of every numeric key
 */
export function medians(reps) {
	const keys = [...new Set(reps.flatMap((r) => Object.keys(r).filter((k) => typeof r[k] === 'number')))]
	return Object.fromEntries(keys.map((k) => [k, median(reps.map((r) => r[k]))]))
}

/**
 * @param {object} m medians (or one repetition)
 * @return {Array<{id: string, name: string, like: string, ok: boolean, checks: Array<{label: string, value: (number|null), op: string, limit: number, ok: boolean}>}>}
 */
export function judge(m) {
	return VOTE_LIST_THRESHOLDS.map((t) => {
		const checks = t.checks.map((c) => {
			const v = m?.[c.key]
			const value = typeof v === 'number' && Number.isFinite(v) ? v : null
			const ok = value !== null && (c.op === '<=' ? value <= c.limit : value >= c.limit)
			return { label: c.label, value, op: c.op, limit: c.limit, ok }
		})
		return { id: t.id, name: t.name, like: t.like, ok: checks.every((c) => c.ok), checks }
	})
}

/**
 * @param {Array<object>} reps the repetitions
 * @param {object} setup facts of the run (viewport, throttle, rows)
 * @return {string} markdown section of the report
 */
export function reportMarkdown(reps, setup) {
	const med = medians(reps)
	const n = (v) => (v === null || v === undefined ? '–' : String(v))
	const verdicts = judge(med)
	return [
		'### M01 Stimmliste am Handy (Job 214)',
		'',
		`- ${setup}`,
		'',
		'| Lauf | Öffnen ms | längster Long Task beim Öffnen ms | Scrollen fps | verpasst % | längster Long Task beim Scrollen ms | Abstimmen ms | Zeilen |',
		'|---|---|---|---|---|---|---|---|',
		...reps.map((r, i) => `| ${i + 1} | ${n(r.openMs)} | ${n(r.openLongest)} | ${n(r.scrollFps)} | ${n(r.scrollMissed)} | ${n(r.scrollLongest)} | ${n(r.tapMs)} | ${n(r.rows)} |`),
		`| Median | ${n(med.openMs)} | ${n(med.openLongest)} | ${n(med.scrollFps)} | ${n(med.scrollMissed)} | ${n(med.scrollLongest)} | ${n(med.tapMs)} | ${n(med.rows)} |`,
		'',
		'| Schwelle | wie | Werte (Median) | Urteil |',
		'|---|---|---|---|',
		...verdicts.map((v) => `| ${v.id} ${v.name} | ${v.like} | ${v.checks.map((c) => `${c.label} ${n(c.value)} (${c.op === '<=' ? '≤' : '≥'} ${c.limit})`).join('; ')} | ${v.ok ? 'PASS' : '**FAIL**'} |`),
		'',
	].join('\n')
}
