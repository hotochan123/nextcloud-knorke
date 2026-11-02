/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The form of a sketch (factory job 182 templates, factory job 221 board
 * list): a list of at most TEMPLATE_SKETCH_MAX entries [x, y, w, h, fill]
 * in a SKETCH_W × SKETCH_H box, fill '' for a frame, else #rrggbb. The
 * server checks and builds the same form (lib/Service/TemplateStore.php
 * sketchOf, lib/Service/BoardSketch.php). No imports: the board list in the
 * main bundle reads it, board/ownTemplates.js re-exports it.
 */

/** Entries of a sketch. */
export const TEMPLATE_SKETCH_MAX = 40
/** The sketch's box (SVG user units) and the margin inside it. */
export const SKETCH_W = 120
export const SKETCH_H = 80
export const SKETCH_PAD = 4
/** The fill of an item without a #rrggbb fill. */
export const SKETCH_FILL = '#d0d0d0'

export const SKETCH_HEX = /^#[0-9a-f]{6}$/i

/**
 * The rectangles of a stored sketch for an SVG: only entries of the
 * server's form (numbers inside the box, '' or #rrggbb), anything else is
 * left out.
 *
 * @param {unknown} sketch a sketch (route 28, route 57)
 * @return {Array<{x: number, y: number, w: number, h: number, frame: boolean, fill: (string|null)}>}
 */
export function sketchRects(sketch) {
	if (!Array.isArray(sketch)) {
		return []
	}
	const inBox = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
	const out = []
	for (const e of sketch.slice(0, TEMPLATE_SKETCH_MAX)) {
		if (!Array.isArray(e) || e.length !== 5) {
			continue
		}
		const [x, y, w, h, fill] = e
		if (!inBox(x, SKETCH_W) || !inBox(y, SKETCH_H) || !inBox(w, SKETCH_W) || !inBox(h, SKETCH_H) || (fill !== '' && !(typeof fill === 'string' && SKETCH_HEX.test(fill)))) {
			continue
		}
		out.push({ x, y, w, h, frame: fill === '', fill: fill === '' ? null : fill.toLowerCase() })
	}
	return out
}
