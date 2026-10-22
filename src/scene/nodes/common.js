/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shared helpers of the node builders (SPEC-M0 §6.3).
 *
 * Every item is one Konva.Group (the entry root) at its ABSOLUTE position in
 * the world; parent frames are not Konva parents, the static layer is a flat,
 * ordered list. place() is the one placement helper for all types: it handles
 * rotation (around the box centre, via offset) and switches
 * transformsEnabled between 'position' (cheap, unrotated) and 'all'
 * (fixes spike shortcomings §8.4 and §8.6).
 *
 * An Entry is {root, parts, lod, ...builder state}; the renderer owns entries.
 * Builders read item fields through registry.fieldValue (SPEC-M1 §6.2 R8).
 */

/** @typedef {{x:number, y:number, w:number, h:number, r:number}} AbsBox */

/** Attributes every shape gets: no hit graph, no perfect-draw buffer. */
export const SHAPE_BASE = Object.freeze({ listening: false, perfectDrawEnabled: false })

/**
 * Places an entry root at an absolute box.
 *
 * @param {{root:object, transforms?:string}} entry node entry
 * @param {AbsBox} a absolute box (top-left, size, rotation in degrees)
 */
export function place(entry, a) {
	const root = entry.root
	if (a.r) {
		root.setAttrs({ x: a.x + a.w / 2, y: a.y + a.h / 2, offsetX: a.w / 2, offsetY: a.h / 2, rotation: a.r })
		if (entry.transforms !== 'all') {
			root.transformsEnabled('all')
			entry.transforms = 'all'
		}
	} else {
		root.setAttrs({ x: a.x, y: a.y, offsetX: 0, offsetY: 0, rotation: 0 })
		if (entry.transforms !== 'position') {
			root.transformsEnabled('position')
			entry.transforms = 'position'
		}
	}
}

/**
 * @param {{Group:Function}} ctx builder context
 * @return {object} new non-listening group
 */
export function makeGroup(ctx) {
	return new ctx.Group({ listening: false })
}

/**
 * @param {unknown} v value
 * @return {string} the string, or '' for anything else
 */
export function str(v) {
	return typeof v === 'string' ? v : ''
}

/**
 * @param {number} v length
 * @return {number} at least 1 (Konva text needs a positive box)
 */
export function positive(v) {
	return Number.isFinite(v) && v > 1 ? v : 1
}
