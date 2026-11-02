/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Small helpers of the user actions (board/actions.js and
 * board/arrangeActions.js, job 254): rounding, numbers, absolute positions,
 * the container under a point and the placement patch. A leaf: it imports
 * neither actions.js nor arrangeActions.js.
 */
import { q } from '../model/geometry.js'
import { canBeChildOf, typeInfo } from '../model/registry.js'

/**
 * @param {number} v value
 * @return {number} rounded to 0.01
 */
export function round2(v) {
	return Math.round(v * 100) / 100
}

/**
 * @param {number} v value
 * @return {number} q(v, 100): the 0.01 grid of client positions (§4.7)
 */
export function q2(v) {
	return q(v, 100)
}

export const clone = (v) => structuredClone(v)

/**
 * @param {unknown} v value
 * @return {boolean} finite number
 */
export function isNum(v) {
	return typeof v === 'number' && Number.isFinite(v)
}

/**
 * @param {object} model SceneModel
 * @param {string|null} id container id or null
 * @return {{x: number, y: number}|null} absolute top-left, {0,0} for null, null when unknown
 */
export function absOf(model, id) {
	if (id === null || id === undefined) {
		return { x: 0, y: 0 }
	}
	if (!model.has(id)) {
		return null
	}
	const a = model.abs(id)
	return a ? { x: a.x, y: a.y } : null
}

/**
 * Container that would receive an item of type t whose box has its center at
 * (cx, cy), or null.
 *
 * @param {object} model SceneModel
 * @param {string} t type of the item
 * @param {number} cx center x (world)
 * @param {number} cy center y (world)
 * @param {Set<string>} exclude ids that cannot be the parent
 * @return {string|null}
 */
export function containerFor(model, t, cx, cy, exclude) {
	if (typeInfo(t).container || typeInfo(t).placement === 'none') {
		return null
	}
	const c = model.topContainerAt(cx, cy, exclude)
	if (c === null || c === undefined || !model.has(c)) {
		return null
	}
	return canBeChildOf(t, model.get(c).t) ? c : null
}

/**
 * Placement patch for an absolute position under a parent (M0 rounding).
 *
 * @param {object} model SceneModel
 * @param {{x: number, y: number}} absPos absolute top-left
 * @param {string|null} parent parent id or null
 * @return {{x: number, y: number, parent: string|null}}
 */
export function placement(model, absPos, parent) {
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	return { x: round2(absPos.x - pa.x), y: round2(absPos.y - pa.y), parent }
}

/**
 * @param {string} t type
 * @param {number} v width or height
 * @return {number} v clamped into TYPES[t].size
 */
export function clampSize(t, v) {
	const size = typeInfo(t).size
	return Math.min(size[1], Math.max(size[0], v))
}
