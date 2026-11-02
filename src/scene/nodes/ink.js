/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pen stroke node (factory job 273, model/ink.js): one Konva.Shape whose
 * sceneFunc traces the smooth line of data.points (tracePath) and strokes it
 * with style.stroke and style.strokeWidth, round caps and joins. A
 * highlighter stroke (data.kind 'marker') is drawn see-through
 * (MARKER_OPACITY) as one path, so where it crosses itself it does not get
 * darker. The same at every level of detail; the points are relative to the
 * box, so the root sits at the box like every item (place). The exports draw
 * it through the same sceneFunc.
 */
import { fieldValue } from '../../model/registry.js'
import { MARKER_OPACITY, pointsOf, tracePath } from '../../model/ink.js'
import { SHAPE_BASE, makeGroup, place } from './common.js'

/**
 * sceneFunc of a stroke.
 *
 * @param {object} ctx Konva context
 * @param {object} shape the Konva.Shape (attr pts)
 */
export function drawInk(ctx, shape) {
	const pts = shape.getAttr('pts')
	if (!Array.isArray(pts) || pts.length < 2) return
	ctx.beginPath()
	tracePath(ctx, pts)
	ctx.strokeShape(shape)
}

/**
 * @param {object} item WireItem of type pen
 * @return {object} Konva attributes of its line
 */
export function inkAttrs(item) {
	return {
		pts: pointsOf(item.data?.points),
		stroke: fieldValue(item, 'style.stroke'),
		strokeWidth: fieldValue(item, 'style.strokeWidth'),
		opacity: fieldValue(item, 'data.kind') === 'marker' ? MARKER_OPACITY : 1,
		lineCap: 'round',
		lineJoin: 'round',
	}
}

export const ink = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod) {
		const root = makeGroup(ctx)
		const line = new ctx.Shape({ ...SHAPE_BASE, ...inkAttrs(item), sceneFunc: drawInk, shadowForStrokeEnabled: false })
		line.transformsEnabled('position')
		root.add(line)
		const entry = { root, parts: { line }, lod, transforms: null, textHidden: false }
		place(entry, abs)
		return entry
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem (new state)
	 * @param {object} abs absolute box
	 * @param {Set<string>} fields changed fields
	 * @return {boolean} true = rebuild
	 */
	update(ctx, entry, item, abs, fields) {
		if (fields.has('type')) return true
		if (fields.has('data') || fields.has('style') || fields.has('geom')) entry.parts.line.setAttrs(inkAttrs(item))
		return false
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod new level of detail
	 */
	setLod(ctx, entry, item, abs, lod) {
		entry.lod = lod
	},

	/** Strokes have no editable text. */
	setTextHidden() {},
}
