/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Sticky note node (port of the spike builder). Body rectangle with an
 * optional drop shadow, plus the text. (Stage 4, WebKit fixes) the shadow
 * is a Konva.Shape below the body that paints it with gradients
 * (shade.js), no canvas shadowBlur. The font size is computed from the text
 * (src/model/text.js), never stored. Fill and text are read through
 * fieldValue (SPEC-M1 §6.2 R8, rule 18: an invalid stored value draws as
 * the §3.10 default).
 *
 * LOD 1 (scale < LOD_TEXT_SCALE): no text, no shadow. Below LOD the text node
 * is not even built (measuring text is the most expensive part of building a
 * node); it is built when the scene zooms back in. A text node that already
 * exists is hidden with visible(false), as in the spike.
 */
import { fieldValue } from '../../model/registry.js'
import { noteFontSize } from '../../model/text.js'
import { FONT_FAMILY, LINE_HEIGHT, STICKY_PADDING, STICKY_RADIUS, TEXT_COLOR } from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'
import { paintShade } from './shade.js'

/**
 * @param {object} ctx builder context ({Group, Rect, Text, shadows})
 * @param {object} entry node entry
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 */
function addText(ctx, entry, item, abs) {
	const p = STICKY_PADDING
	const text = new ctx.Text({
		...SHAPE_BASE,
		x: p,
		y: p,
		width: positive(abs.w - 2 * p),
		height: positive(abs.h - 2 * p),
		text: str(fieldValue(item, 'data.text')),
		fontSize: noteFontSize(item),
		fontFamily: FONT_FAMILY,
		fill: TEXT_COLOR,
		align: 'center',
		verticalAlign: 'middle',
		wrap: 'word',
		ellipsis: true,
		lineHeight: LINE_HEIGHT,
		visible: !entry.textHidden,
	})
	text.transformsEnabled('position')
	entry.root.add(text)
	entry.parts.text = text
}

export const sticky = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @param {boolean} [textHidden] text is being edited
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod, textHidden = false) {
		const root = makeGroup(ctx)
		const body = new ctx.Rect({
			...SHAPE_BASE,
			width: abs.w,
			height: abs.h,
			fill: fieldValue(item, 'style.fill'),
			cornerRadius: STICKY_RADIUS,
			shadowForStrokeEnabled: false,
		})
		body.transformsEnabled('position')
		const entry = { root, parts: { body, text: null, shade: null }, lod, transforms: null, textHidden }
		if (ctx.shadows) {
			// the drop shadow (LOD 0 only) is painted by shade.js, below the body
			const shade = new ctx.Shape({
				...SHAPE_BASE,
				visible: lod === 0,
				sceneFunc: (context) => paintShade(context, body.width(), body.height(), root.rotation()),
			})
			shade.transformsEnabled('position')
			root.add(shade)
			entry.parts.shade = shade
		}
		root.add(body)
		if (lod === 0) {
			addText(ctx, entry, item, abs)
		}
		place(entry, abs)
		return entry
	},

	/**
	 * Updates parts in place; placement is the renderer's job.
	 *
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem (new state)
	 * @param {object} abs absolute box
	 * @param {Set<string>} fields changed fields (ChangeSummary)
	 * @return {boolean} true = rebuild the node
	 */
	update(ctx, entry, item, abs, fields) {
		if (fields.has('type')) {
			return true
		}
		const { body, text } = entry.parts
		if (fields.has('geom')) {
			body.setAttrs({ width: abs.w, height: abs.h })
		}
		if (fields.has('style')) {
			body.fill(fieldValue(item, 'style.fill'))
		}
		if (text && (fields.has('geom') || fields.has('style') || fields.has('text'))) {
			const p = STICKY_PADDING
			text.setAttrs({
				width: positive(abs.w - 2 * p),
				height: positive(abs.h - 2 * p),
				text: str(fieldValue(item, 'data.text')),
				fontSize: noteFontSize(item),
			})
		}
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
		if (entry.parts.shade) {
			entry.parts.shade.visible(lod === 0)
		}
		const text = entry.parts.text
		if (lod === 0) {
			if (!text) {
				addText(ctx, entry, item, abs)
			} else if (!entry.textHidden) {
				text.visible(true)
			}
		} else if (text) {
			text.visible(false)
		}
	},

	/**
	 * @param {object} entry node entry
	 * @param {boolean} hidden true while the text editor is open
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = hidden
		if (entry.parts.text) {
			entry.parts.text.visible(!hidden && entry.lod === 0)
		}
	},
}
