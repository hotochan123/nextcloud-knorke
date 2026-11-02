/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Private writing and reveal (factory job 275), pure. The server keeps
 * meta.private = {scope: 'board'|'frame', frame?, at, by, seq} while it runs
 * and sends every note someone else wrote since then as a covered note:
 * a sticky with data {covered: true} and style {} (lib/Service/
 * PrivateWriting.php). The server enforces every rule; this module only
 * mirrors them for the client:
 *
 * - privateOf(meta): meta.private when well formed, else null
 * - isCovered(item): a covered note (grey card, no text; not selectable,
 *   not copied, left out of outline, search and text exports)
 * - wantsResync(before, after, hasCovered): after the reveal (meta.private
 *   gone, or another seq) the texts come with a new snapshot, since the
 *   notes' rows did not change
 */

/** Fill of a covered note (a neutral grey in both themes). */
export const COVERED_FILL = '#bfc3c8'

/**
 * @param {unknown} v value
 * @return {boolean} a plain map
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {unknown} meta board meta
 * @return {{scope: string, frame: (string|null), seq: number, by: string}|null}
 */
export function privateOf(meta) {
	const p = isMap(meta) ? meta.private : null
	if (!isMap(p) || (p.scope !== 'board' && p.scope !== 'frame')) {
		return null
	}
	const frame = p.scope === 'frame' && typeof p.frame === 'string' ? p.frame : null
	if (p.scope === 'frame' && frame === null) {
		return null
	}
	return { scope: p.scope, frame, seq: Number.isInteger(p.seq) ? p.seq : 0, by: typeof p.by === 'string' ? p.by : '' }
}

/**
 * @param {object|null|undefined} item WireItem
 * @return {boolean} a covered note of someone else
 */
export function isCovered(item) {
	return item?.t === 'sticky' && isMap(item.data) && item.data.covered === true
}

/**
 * @param {unknown} before meta before the change
 * @param {unknown} after meta after it
 * @param {boolean} hasCovered the model holds covered notes
 * @return {boolean} ask for a new snapshot
 */
export function wantsResync(before, after, hasCovered) {
	if (!hasCovered) {
		return false
	}
	const a = privateOf(before)
	const b = privateOf(after)
	return a !== null && (b === null || b.seq !== a.seq)
}
