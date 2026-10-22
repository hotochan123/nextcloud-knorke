/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shapes are data (SPEC-M1 §6.2, retrofit rules §3.10): one entry per
 * data.kind of the `shape` type, used by the renderer, the hit test, the
 * LOD-2 painter and the "+" handles alike. All coordinates are normalised to
 * the unrotated item box (multiply x by w and y by h):
 *
 * - hit:     'box' (the whole box), 'ellipse' (ellipse formula) or 'polygon'
 *            (pointInPolygon over the outline); the inside always hits, also
 *            with fillOpacity 0
 * - outline: null (the box itself), 'ellipse', or a flat polygon [x0, y0, …]
 * - radius:  corner radius as a share of min(w, h) (rect, roundRect)
 * - text:    the text box [x, y, w, h] inside the shape
 * - anchors: the four docking points of the "+" handles (top, right, bottom,
 *            left), each [ax, ay] like a connector anchor end (§3.10)
 *
 * A later shape pack adds entries here plus the kind to the enum lists of the
 * PHP and JS registries (registry golden). A kind this client does not know
 * (newer version) is drawn as rect: shapeOf() never fails.
 */
import { deepFreeze } from './freeze.js'

export const SHAPES = deepFreeze({
	rect: { hit: 'box', outline: null, radius: 0, text: [0, 0, 1, 1], anchors: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
	roundRect: { hit: 'box', outline: null, radius: 0.15, text: [0, 0, 1, 1], anchors: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
	ellipse: { hit: 'ellipse', outline: 'ellipse', text: [0.146, 0.146, 0.707, 0.707], anchors: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
	diamond: { hit: 'polygon', outline: [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5], text: [0.25, 0.25, 0.5, 0.5], anchors: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
	triangle: { hit: 'polygon', outline: [0.5, 0, 1, 1, 0, 1], text: [0.25, 0.5, 0.5, 0.45], anchors: [[0.5, 0], [0.75, 0.5], [0.5, 1], [0.25, 0.5]] },
	arrowRight: {
		hit: 'polygon',
		outline: [0, 0.25, 0.65, 0.25, 0.65, 0, 1, 0.5, 0.65, 1, 0.65, 0.75, 0, 0.75],
		text: [0, 0.25, 0.65, 0.5],
		anchors: [[0.5, 0.25], [1, 0.5], [0.5, 0.75], [0, 0.5]],
	},
})

/** Segments of the polygon that stands in for an ellipse in outlinePoints(). */
export const ELLIPSE_SEGMENTS = 32

/**
 * @param {unknown} kind data.kind of a shape
 * @return {object} SHAPES[kind], or SHAPES.rect for a missing or unknown kind
 *   (own keys only: 'constructor' is an unknown kind, too)
 */
export function shapeOf(kind) {
	return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(SHAPES, kind) ? SHAPES[kind] : SHAPES.rect
}

/**
 * The outline as a flat point list in item coordinates (origin top-left of
 * the unrotated box). rect and roundRect give the four box corners (the
 * renderer rounds the corners of roundRect itself), ellipse a regular
 * ELLIPSE_SEGMENTS-gon starting at the top and running clockwise, the
 * polygon kinds their outline scaled by w and h. geometry.shapePolygon
 * delegates here for the polygon kinds.
 *
 * @param {unknown} kind data.kind (unknown kinds count as rect)
 * @param {number} w width
 * @param {number} h height
 * @return {number[]} [x0, y0, x1, y1, …], a new array
 */
export function outlinePoints(kind, w, h) {
	const outline = shapeOf(kind).outline
	if (Array.isArray(outline)) {
		return outline.map((v, i) => (i % 2 === 0 ? v * w : v * h))
	}
	if (outline === 'ellipse') {
		const out = []
		const rx = w / 2
		const ry = h / 2
		for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
			const t = -Math.PI / 2 + (2 * Math.PI * i) / ELLIPSE_SEGMENTS
			out.push(rx + rx * Math.cos(t), ry + ry * Math.sin(t))
		}
		return out
	}
	return [0, 0, w, 0, w, h, 0, h]
}
