/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Keeping the static layer in stacking order (SPEC-M0 §6.3), the pure part.
 * The layer's children are always sorted by SceneModel.compareOrder; a node
 * that enters is inserted at the position found by binary search (port of the
 * spike's endDrag search, on the 'kid' attribute instead of an orderIndex).
 */

/**
 * Insert position for id in an ordered list: the first index whose element
 * lies above id (so equal elements keep their place in front of it).
 *
 * @param {ArrayLike<any>} kids elements in layer order (bottom first)
 * @param {string} id id to insert
 * @param {(a:string, b:string) => number} compare stacking order of two ids
 * @param {(el:any) => string} [keyOf] id of an element (default: the element itself)
 * @return {number} index in [0, kids.length]
 */
export function insertIndex(kids, id, compare, keyOf = (el) => el) {
	let lo = 0
	let hi = kids.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (compare(keyOf(kids[mid]), id) <= 0) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}

/**
 * True when so many nodes enter at once (a jump while zooming out) that
 * detaching everything, sorting and re-adding is cheaper than one binary
 * insert per node: more than 50 % of the attached count.
 *
 * @param {number} enterCount nodes entering now
 * @param {number} attachedCount nodes attached before
 * @return {boolean}
 */
export function shouldBulkReattach(enterCount, attachedCount) {
	return enterCount > 0 && enterCount > 0.5 * attachedCount
}
