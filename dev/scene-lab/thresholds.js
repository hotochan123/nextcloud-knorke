/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The M1 thresholds of a measurement (factory job 214), unchanged from
 * SPEC-M1 §8.5 (G12, G14) and §8.8 point 6 (the decision rule), applied to
 * one measure-*.json of run.mjs (or to the medians of summary.mjs):
 *
 *   S1 first render of the whole board ≤ 250 ms: fit.ms (fit() from 100 %)
 *      and lod2First.plain.ms (cold scene at 5 %, the G14 (3) gate value)
 *   S2 camera step p95 ≤ 2 ms in the zoom series around 8 % and the board pan
 *   S3 zoom over the whole board ≥ 30 fps and ≤ 25 % missed frames
 *   S4 pan at 100 % ≥ 45 fps
 *   S5 dragging the item with six connectors ≥ 55 fps
 *
 * A value equal to its limit passes; a missing value fails. Pure, no
 * imports: run.mjs (in the lab container, which sees only dev/scene-lab),
 * summary.mjs and the self-test load it.
 */

/** @type {ReadonlyArray<{id: string, name: string, source: string, checks: ReadonlyArray<{label: string, path: string, op: '<='|'>=', limit: number}>}>} */
export const THRESHOLDS = Object.freeze([
	Object.freeze({
		id: 'S1', name: 'Erstes Rendern des ganzen Boards', source: 'G14 (3)',
		checks: Object.freeze([
			Object.freeze({ label: 'fit ms', path: 'fit.ms', op: '<=', limit: 250 }),
			Object.freeze({ label: 'kalt bei 5 % ms', path: 'lod2First.plain.ms', op: '<=', limit: 250 }),
		]),
	}),
	Object.freeze({
		id: 'S2', name: 'Kamera-Schritt p95', source: 'G14 (2)',
		checks: Object.freeze([
			Object.freeze({ label: 'Board-Zoom 8 % ms', path: 'lod2Zoom.camera.p95', op: '<=', limit: 2 }),
			Object.freeze({ label: 'Board-Schwenk ms', path: 'boardPan.camera.p95', op: '<=', limit: 2 }),
		]),
	}),
	Object.freeze({
		id: 'S3', name: 'Zoom über das ganze Board', source: '§8.8 Punkt 6',
		checks: Object.freeze([
			Object.freeze({ label: 'fps', path: 'board.frames.fps', op: '>=', limit: 30 }),
			Object.freeze({ label: 'verpasst %', path: 'board.frames.pctMissed', op: '<=', limit: 25 }),
		]),
	}),
	Object.freeze({
		id: 'S4', name: 'Schwenken bei 100 %', source: '§8.8 Punkt 6',
		checks: Object.freeze([Object.freeze({ label: 'fps', path: 'pan.frames.fps', op: '>=', limit: 45 })]),
	}),
	Object.freeze({
		id: 'S5', name: 'Objekt mit 6 Verbindern ziehen', source: 'G12',
		checks: Object.freeze([Object.freeze({ label: 'fps', path: 'connectorDrag.frames.fps', op: '>=', limit: 55 })]),
	}),
])

/**
 * @param {object} m measure-*.json
 * @param {string} path dotted path
 * @return {number|null} the number there, null when missing or not a finite number
 */
export function valueAt(m, path) {
	let v = m
	for (const k of path.split('.')) {
		if (v === null || typeof v !== 'object' || !Object.hasOwn(v, k)) return null
		v = v[k]
	}
	return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * @param {number|null} value measured value
 * @param {'<='|'>='} op comparison
 * @param {number} limit threshold
 * @return {boolean} the value keeps the threshold (equal passes, missing fails)
 */
export function keeps(value, op, limit) {
	if (value === null) return false
	return op === '<=' ? value <= limit : value >= limit
}

/**
 * The verdict of every threshold on one measurement.
 *
 * @param {object} m measure-*.json (or an object of the same paths)
 * @return {Array<{id: string, name: string, source: string, ok: boolean, checks: Array<{label: string, path: string, op: string, limit: number, value: (number|null), ok: boolean}>}>}
 */
export function evaluate(m) {
	return THRESHOLDS.map((t) => {
		const checks = t.checks.map((c) => {
			const value = valueAt(m, c.path)
			return { label: c.label, path: c.path, op: c.op, limit: c.limit, value, ok: keeps(value, c.op, c.limit) }
		})
		return { id: t.id, name: t.name, source: t.source, ok: checks.every((c) => c.ok), checks }
	})
}

/**
 * @param {{value: (number|null), ok: boolean, op: string, limit: number}} c one check of evaluate()
 * @return {string} "12.3 (≤ 250) PASS", "– FAIL (fehlt)"
 */
export function checkText(c) {
	const limit = `${c.op === '<=' ? '≤' : '≥'} ${c.limit}`
	if (c.value === null) return `– (${limit}) FAIL (fehlt)`
	return `${c.value} (${limit}) ${c.ok ? 'PASS' : '**FAIL**'}`
}

/**
 * @param {ReturnType<typeof evaluate>} verdicts evaluate()
 * @return {string[]} markdown lines: a table of S1–S5
 */
export function verdictLines(verdicts) {
	return [
		'| Schwelle | Quelle | Werte | Urteil |',
		'|---|---|---|---|',
		...verdicts.map((v) => `| ${v.id} ${v.name} | ${v.source} | ${v.checks.map((c) => `${c.label}: ${checkText(c)}`).join('; ')} | ${v.ok ? 'PASS' : '**FAIL**'} |`),
	]
}
