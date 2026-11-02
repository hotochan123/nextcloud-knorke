/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Small constants and helpers of the board session that the modules split
 * off BoardSession.js need too (factory job 255; job 257: metaMapOf and
 * modelItems for the tags). A leaf: it imports
 * nothing of src/board/, so neither BoardSession.js nor its modules form a
 * cycle through it.
 */
/** (Job 171) A laser point closer than this (ms) to the last stored one only moves it. */
export const LASER_MIN_GAP_MS = 30
/** (Job 171) me.l carries the laser points of this many ms … */
export const LASER_WINDOW_MS = 2500
/** … and at most this many elements (points and stroke breaks), the newest. */
export const LASER_WIRE_MAX = 80

/**
 * @param {number} v number
 * @return {number} rounded to 0.1 (presence coordinates)
 */
export function r1(v) {
	return Math.round(v * 10) / 10
}

/**
 * `meta` of a board block as a map (SPEC-M1 §3.11). The wire form of an
 * empty map is {} (§15 R4); an empty JSON list is what PHP's json_encode
 * makes of an empty array, so it counts as {} as well. Anything else that is
 * not a plain object (a non-empty list, a scalar, null) is no meta.
 *
 * @param {unknown} v `meta` of the block
 * @return {object|null} the map, or null: no usable meta in the block
 */
export function metaMapOf(v) {
	if (Array.isArray(v)) {
		return v.length === 0 ? {} : null
	}
	return v !== null && typeof v === 'object' ? v : null
}

/**
 * @param {object} model SceneModel
 * @yield {object} every item of the model (no copy, read only)
 */
export function* modelItems(model) {
	for (const id of model.ids()) {
		yield model.get(id)
	}
}
