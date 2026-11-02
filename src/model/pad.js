/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Note pads (factory job 188), the measures: a pad of type `pad` is a pile
 * of blank notes. Its box (x, y, w, h) is the top sheet; job 263 (redesign
 * round 4, B4): PAD_SHEETS sheets lie behind it, each PAD_SHEET_OFFSET lower
 * (not to the right), and the binding with the title lies on top of the box
 * (padLayout). So a pad covers (0, 0)–(w, h + 12) of its own coordinates
 * (origin top-left of its box): that is its hit area (plus the tolerance,
 * SceneModel hit mode 'pad') and its index box (rbush padding 'band', plus
 * the note shadow of the bottom sheet), and so the bounds of the PNG export.
 *
 * Its parts under a point: the binding down to the tear line ('band',
 * ly ≤ bind + tear gap: it selects, moves and opens the title like any
 * item) and the pile below it ('stack', the sheet below the tear line and
 * the sheet edges: a drag from it takes a note off, scene/InputController.js).
 */
import { toLocal } from './geometry.js'
import {
	PAD_BIND_H, PAD_FULL_H, PAD_SHEET_OFFSET, PAD_SHEETS, PAD_TEAR_GAP, PAD_TEAR_INSET, PAD_TITLE_PAD, PAD_TITLE_SIZE,
} from './tokens.js'

/** How far the sheets reach beyond the box to the right (world units): 0 (job 263: straight down). */
export const PAD_SHEETS_REACH = 0
/** How far a pad reaches below its box: the bottom edge of its lowest sheet (world units): 12. */
export const PAD_BELOW = PAD_SHEETS * PAD_SHEET_OFFSET

/**
 * @param {number} w width of the box
 * @param {number} h height of the box
 * @return {{w: number, h: number}} the area a pad covers from the top-left of its box: w × (h + 12)
 */
export function padExtent(w, h) {
	return { w: w + PAD_SHEETS_REACH, h: h + PAD_BELOW }
}

/**
 * (Job 263) The measures of a pad's top: the B4 values for a pad PAD_FULL_H
 * high or higher, scaled by h / PAD_FULL_H for a lower one.
 *
 * @param {number} w width of the box
 * @param {number} h height of the box
 * @return {{k: number, bind: number, tear: number, tearX0: number, tearX1: number, font: number, pad: number}}
 *   the scale, the binding's height, the tear line's y, its ends, the title's size and its inner padding
 */
export function padLayout(w, h) {
	const k = Number.isFinite(h) && h > 0 ? Math.min(1, h / PAD_FULL_H) : 1
	const bind = PAD_BIND_H * k
	const inset = Math.min(PAD_TEAR_INSET * k, Math.max(0, w) / 2)
	return {
		k,
		bind,
		tear: bind + PAD_TEAR_GAP * k,
		tearX0: inset,
		tearX1: Math.max(inset, w - inset),
		font: PAD_TITLE_SIZE * k,
		pad: PAD_TITLE_PAD * k,
	}
}

/**
 * @param {number} w width of the box
 * @param {number} h height of the box
 * @return {{x: number, y: number, w: number, h: number}} the binding (the title's place) in the pad's own coordinates
 */
export function padBand(w, h) {
	return { x: 0, y: 0, w, h: padLayout(w, h).bind }
}

/**
 * @param {number} ly y from the top-left of the box
 * @param {number} w width of the box
 * @param {number} h height of the box
 * @return {'stack'|'band'} the grip down to the tear line, the pile below it
 */
function partOf(ly, w, h) {
	return ly <= padLayout(w, h).tear ? 'band' : 'stack'
}

/**
 * The part of a pad under a point of its own coordinates.
 *
 * @param {number} lx x from the top-left of the box
 * @param {number} ly y from the top-left of the box
 * @param {number} w width of the box
 * @param {number} h height of the box
 * @param {number} [tol] tolerance on every side (world units)
 * @return {'stack'|'band'|null} the binding down to the tear line ('band'), the pile below it ('stack'),
 *   null outside (0, 0)–(w, h + 12) grown by tol
 */
export function padPartAt(lx, ly, w, h, tol = 0) {
	const t = Number.isFinite(tol) && tol > 0 ? tol : 0
	const e = padExtent(w, h)
	if (!(lx >= -t && ly >= -t && lx <= e.w + t && ly <= e.h + t)) {
		return null
	}
	return partOf(ly, w, h)
}

/**
 * The part of a pad a world point lies on, by the rule of padPartAt but
 * without bounds: the hit test (with its tolerance and the selection gap)
 * already decided that the pad is hit there.
 *
 * @param {object} model SceneModel (get, abs)
 * @param {string|null} id item id
 * @param {{x: number, y: number}} w world point
 * @return {'stack'|'band'|null} null when id is no pad of the model
 */
export function padPart(model, id, w) {
	const it = typeof id === 'string' ? model.get(id) : null
	const a = it?.t === 'pad' ? model.abs(id) : null
	if (!a) {
		return null
	}
	const [, ly] = toLocal(w.x, w.y, a.x, a.y, a.w, a.h, a.r || 0)
	return partOf(ly, a.w, a.h)
}
