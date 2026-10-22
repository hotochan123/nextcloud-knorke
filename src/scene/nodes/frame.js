/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frame node (port of the spike builder). The fill comes from the frame's own
 * style.fill, not from a constant (spike shortcoming §8.5), read through
 * fieldValue like the title (SPEC-M1 §6.2 R8). The title sits in
 * the band above the box (FRAME_TITLE_BAND, also the frame's hit area) and
 * stays at every level of detail; it is cut with an ellipsis at the frame
 * width so the render bounds match the index box. The border is drawn in
 * screen pixels (strokeScaleEnabled false) so frames stay visible when zoomed out.
 *
 * Children are NOT Konva children of the frame: every item is a root node at
 * its absolute position, the static layer is one ordered list.
 */
import { fieldValue } from '../../model/registry.js'
import {
	FONT_FAMILY, FRAME_STROKE, FRAME_STROKE_WIDTH, FRAME_TITLE_BAND, FRAME_TITLE_COLOR, FRAME_TITLE_SIZE,
} from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

export const frame = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @param {boolean} [textHidden] title is being edited
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod, textHidden = false) {
		const root = makeGroup(ctx)
		const body = new ctx.Rect({
			...SHAPE_BASE,
			width: abs.w,
			height: abs.h,
			fill: fieldValue(item, 'style.fill'),
			stroke: FRAME_STROKE,
			strokeWidth: FRAME_STROKE_WIDTH,
			strokeScaleEnabled: false,
			shadowForStrokeEnabled: false,
		})
		body.transformsEnabled('position')
		const title = new ctx.Text({
			...SHAPE_BASE,
			x: 0,
			y: -FRAME_TITLE_BAND,
			width: positive(abs.w),
			height: FRAME_TITLE_BAND,
			text: str(fieldValue(item, 'data.title')),
			fontSize: FRAME_TITLE_SIZE,
			fontFamily: FONT_FAMILY,
			fill: FRAME_TITLE_COLOR,
			verticalAlign: 'middle',
			wrap: 'none',
			ellipsis: true,
			visible: !textHidden,
		})
		title.transformsEnabled('position')
		root.add(body, title)
		const entry = { root, parts: { body, text: title }, lod, transforms: null, textHidden }
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
		if (fields.has('type')) {
			return true
		}
		const { body, text } = entry.parts
		if (fields.has('geom')) {
			body.setAttrs({ width: abs.w, height: abs.h })
			text.width(positive(abs.w))
		}
		if (fields.has('style')) {
			body.fill(fieldValue(item, 'style.fill'))
		}
		if (fields.has('text')) {
			text.text(str(fieldValue(item, 'data.title')))
		}
		return false
	},

	/**
	 * The title stays at every level of detail.
	 *
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod new level of detail
	 */
	setLod(ctx, entry, item, abs, lod) {
		entry.lod = lod
	},

	/**
	 * @param {object} entry node entry
	 * @param {boolean} hidden true while the title editor is open
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = hidden
		entry.parts.text.visible(!hidden)
	},
}
