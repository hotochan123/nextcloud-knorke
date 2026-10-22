/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Text item node (SPEC-M1 §3.10, §6.3): a Konva.Text with width = w (the wrap
 * width), wrap 'word', style.fontSize as the primary size, style.color and
 * style.align, all read through fieldValue (rule 18). The height is not set
 * on the node (Konva measures it); the stored h is the measured height of
 * the writer (rule 13, SceneManager.measureTextHeight), used for the box.
 *
 * Levels (the renderer asks levelOf for every live entry when the scale
 * changes inside LOD 1, scaleSensitive):
 * - 0: the text (LOD 0, and LOD 1 while fontSize · scale ≥ TEXT_MIN_PX)
 * - 1: grey line bars (one per text line, estimated from h), one Konva.Shape
 * An entry holds only the part of its level: a level change destroys the
 * other part and builds this one, so no visible() setter runs when a cached
 * entry re-enters the viewport (lab gate "Herausnehmen"); visible() is only
 * used while the text editor hides the text.
 */
import { fieldValue } from '../../model/registry.js'
import { FONT_FAMILY, LINE_HEIGHT, TEXT_BAR_COLOR, TEXT_MIN_PX } from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

/**
 * Konva text attributes of a text item (also used to measure it).
 *
 * @param {object} item WireItem
 * @param {number} w wrap width
 * @return {object}
 */
export function textItemAttrs(item, w) {
	return {
		width: positive(w),
		text: str(fieldValue(item, 'data.text')),
		fontSize: fieldValue(item, 'style.fontSize'),
		fill: fieldValue(item, 'style.color'),
		align: fieldValue(item, 'style.align'),
	}
}

/**
 * sceneFunc of the bars: one bar per estimated line, the last one shorter.
 *
 * @param {object} ctx Konva context
 * @param {object} shape the Konva.Shape (attrs width, lines, step)
 */
function drawBars(ctx, shape) {
	const n = shape.getAttr('lines')
	const step = shape.getAttr('step')
	const w = shape.width()
	ctx.beginPath()
	for (let i = 0; i < n; i++) {
		const bw = i === n - 1 && n > 1 ? w * 0.6 : w
		ctx.rect(0, i * step + step * 0.25, bw, step * 0.5)
	}
	ctx.closePath()
	ctx.fillShape(shape)
}

/**
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 * @return {object} attributes of the bars node
 */
export function barAttrs(item, abs) {
	const step = fieldValue(item, 'style.fontSize') * LINE_HEIGHT
	const empty = str(fieldValue(item, 'data.text')) === ''
	return { width: positive(abs.w), lines: empty ? 0 : Math.max(1, Math.round(abs.h / step)), step }
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
		...textItemAttrs(item, abs.w),
		fontFamily: FONT_FAMILY,
		wrap: 'word',
		lineHeight: LINE_HEIGHT,
		visible: !entry.textHidden,
	})
	text.transformsEnabled('position')
	entry.root.add(text)
	entry.parts.text = text
}

/**
 * @param {object} ctx builder context
 * @param {object} entry node entry
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 */
function addBars(ctx, entry, item, abs) {
	const bars = new ctx.Shape({
		...SHAPE_BASE,
		...barAttrs(item, abs),
		fill: TEXT_BAR_COLOR,
		sceneFunc: drawBars,
		visible: !entry.textHidden,
	})
	bars.transformsEnabled('position')
	entry.root.add(bars)
	entry.parts.bars = bars
}

export const text = {
	/** The level depends on the scale inside LOD 1 (TEXT_MIN_PX). */
	scaleSensitive: true,

	/**
	 * @param {object} item WireItem
	 * @param {0|1} lod renderer level of detail
	 * @param {number} scale camera scale
	 * @return {0|1} 0 = text, 1 = line bars
	 */
	levelOf(item, lod, scale) {
		if (lod === 0) return 0
		return fieldValue(item, 'style.fontSize') * scale >= TEXT_MIN_PX ? 0 : 1
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} level 0 = text, 1 = bars
	 * @param {boolean} [textHidden] text is being edited
	 * @return {object} entry
	 */
	build(ctx, item, abs, level, textHidden = false) {
		const root = makeGroup(ctx)
		const entry = { root, parts: { text: null, bars: null }, lod: level, transforms: null, textHidden }
		if (level === 0) addText(ctx, entry, item, abs)
		else addBars(ctx, entry, item, abs)
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
		const { text, bars } = entry.parts
		if (text && (fields.has('geom') || fields.has('style') || fields.has('text'))) {
			text.setAttrs(textItemAttrs(item, abs.w))
		}
		if (bars && (fields.has('geom') || fields.has('style') || fields.has('text'))) {
			bars.setAttrs(barAttrs(item, abs))
		}
		return false
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} level new level
	 */
	setLod(ctx, entry, item, abs, level) {
		entry.lod = level
		const { text, bars } = entry.parts
		if (level === 0) {
			if (bars) {
				bars.destroy()
				entry.parts.bars = null
			}
			if (!text) addText(ctx, entry, item, abs)
		} else {
			if (text) {
				text.destroy()
				entry.parts.text = null
			}
			if (!bars) addBars(ctx, entry, item, abs)
		}
	},

	/**
	 * @param {object} entry node entry
	 * @param {boolean} hidden true while the text editor is open
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = hidden
		entry.parts.text?.visible(!hidden && entry.lod === 0)
		entry.parts.bars?.visible(!hidden && entry.lod !== 0)
	},
}
