/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Placeholder for item types this client does not know (import, newer
 * version, downgrade): a grey dashed box with the type name, never a throw.
 * The label goes through Konva text (no markup) and is one of the four texts
 * the scene may translate (SPEC-M0 §6.9). Like a note's text it is built only
 * at LOD 0.
 */
import { t } from '../../util/l10n.js'
import {
	FONT_FAMILY, PLACEHOLDER_DASH, PLACEHOLDER_FILL, PLACEHOLDER_STROKE, PLACEHOLDER_TEXT_COLOR,
} from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

const PAD = 8
const FONT_SIZE = 14

/**
 * @param {object} item WireItem
 * @return {string} label text
 */
function label(item) {
	return t('knorke', 'Unknown item type: {type}', { type: str(item.t) })
}

/**
 * @param {object} ctx builder context
 * @param {object} entry node entry
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 */
function addText(ctx, entry, item, abs) {
	const text = new ctx.Text({
		...SHAPE_BASE,
		x: PAD,
		y: PAD,
		width: positive(abs.w - 2 * PAD),
		height: positive(abs.h - 2 * PAD),
		text: label(item),
		fontSize: FONT_SIZE,
		fontFamily: FONT_FAMILY,
		fill: PLACEHOLDER_TEXT_COLOR,
		align: 'center',
		verticalAlign: 'middle',
		wrap: 'word',
		ellipsis: true,
	})
	text.transformsEnabled('position')
	entry.root.add(text)
	entry.parts.text = text
}

export const placeholder = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod) {
		const root = makeGroup(ctx)
		const body = new ctx.Rect({
			...SHAPE_BASE,
			width: abs.w,
			height: abs.h,
			fill: PLACEHOLDER_FILL,
			stroke: PLACEHOLDER_STROKE,
			strokeWidth: 1,
			strokeScaleEnabled: false,
			dash: PLACEHOLDER_DASH.slice(),
			shadowForStrokeEnabled: false,
		})
		body.transformsEnabled('position')
		root.add(body)
		const entry = { root, parts: { body, text: null }, lod, transforms: null, textHidden: false }
		if (lod === 0) {
			addText(ctx, entry, item, abs)
		}
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
		if (fields.has('geom')) {
			entry.parts.body.setAttrs({ width: abs.w, height: abs.h })
			entry.parts.text?.setAttrs({ width: positive(abs.w - 2 * PAD), height: positive(abs.h - 2 * PAD) })
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
		const text = entry.parts.text
		if (lod === 0) {
			if (!text) {
				addText(ctx, entry, item, abs)
			} else {
				text.visible(true)
			}
		} else if (text) {
			text.visible(false)
		}
	},

	/** Placeholders have no editable text. */
	setTextHidden() {},
}
