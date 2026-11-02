/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * AI summary card node (factory job 267, item type `ai`): a white card
 * (AI_CARD_FILL, border AI_CARD_STROKE, radius AI_CARD_RADIUS), a sparkle and
 * the header "AI summary" or "AI summary · <data.title>" (bold, grey, one
 * line, cut with "…"), below it data.md as formatted Markdown
 * (model/markdown.js). Everything is painted by ONE Konva.Shape whose
 * sceneFunc measures with the context it draws into, so the PNG, SVG and
 * PDF exports (vectorContext) get the same picture with text kept as text.
 * The box is the stored w × h; aiCardHeight() is the height the content
 * needs (the session corrects a stored h that differs, BoardSession).
 */
import { fieldValue } from '../../model/registry.js'
import { layoutMarkdown, parseMarkdown, runFont } from '../../model/markdown.js'
import { AI_VIOLET, FONT_FAMILY } from '../../model/tokens.js'
import { t } from '../../util/l10n.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

export const AI_CARD_FILL = '#ffffff'
export const AI_CARD_STROKE = '#e0e0e0'
export const AI_CARD_RADIUS = 12
export const AI_CARD_PAD = 16
/** Header: its font size, its row height and the gap below it. */
export const AI_HEAD_SIZE = 13
export const AI_HEAD_ROW = 20
export const AI_HEAD_GAP = 10
const AI_HEAD_COLOR = '#6b6f73'
const AI_TEXT_COLOR = '#191b1d'
/** Parsed Markdown per text (a card is drawn often, its text rarely changes). */
const PARSED = new Map()
const PARSED_MAX = 200

/**
 * @param {string} md Markdown
 * @return {object[]} parseMarkdown, cached
 */
function parsed(md) {
	let b = PARSED.get(md)
	if (!b) {
		if (PARSED.size >= PARSED_MAX) PARSED.clear()
		b = parseMarkdown(md)
		PARSED.set(md, b)
	}
	return b
}

/**
 * @param {object} item WireItem
 * @return {string} the header text
 */
export function aiHeader(item) {
	const title = str(fieldValue(item, 'data.title')).replace(/\s+/g, ' ').trim()
	return title === '' ? t('knorke', 'AI summary') : t('knorke', 'AI summary · {frame}', { frame: title })
}

/**
 * The Markdown laid out for a card of width w.
 *
 * @param {object} item WireItem
 * @param {number} w card width
 * @param {(text: string, font: string) => number} measure text width
 * @return {{lines: object[], height: number}}
 */
export function aiBody(item, w, measure) {
	return layoutMarkdown(parsed(str(fieldValue(item, 'data.md'))), positive(w - 2 * AI_CARD_PAD), measure, FONT_FAMILY)
}

/**
 * The height a card's content needs.
 *
 * @param {object} item WireItem
 * @param {number} w card width
 * @param {(text: string, font: string) => number} measure text width
 * @return {number}
 */
export function aiCardHeight(item, w, measure) {
	return Math.ceil(AI_CARD_PAD + AI_HEAD_ROW + AI_HEAD_GAP + aiBody(item, w, measure).height + AI_CARD_PAD)
}

/**
 * @param {string} text a line
 * @param {number} max width
 * @param {(s: string) => number} width text width
 * @return {string} the text, cut with "…" to fit
 */
function fit(text, max, width) {
	if (width(text) <= max) return text
	let s = text
	while (s.length > 0 && width(s + '…') > max) s = s.slice(0, -1)
	return s + '…'
}

/**
 * The sparkle: a four-pointed star of size s at (x, y) (top-left).
 *
 * @param {object} c Konva context
 * @param {number} x left
 * @param {number} y top
 * @param {number} s size
 */
function sparkle(c, x, y, s) {
	const cx = x + s / 2
	const cy = y + s / 2
	const r = s / 2
	const k = r * 0.28
	c.beginPath()
	c.moveTo(cx, cy - r)
	c.quadraticCurveTo(cx + k, cy - k, cx + r, cy)
	c.quadraticCurveTo(cx + k, cy + k, cx, cy + r)
	c.quadraticCurveTo(cx - k, cy + k, cx - r, cy)
	c.quadraticCurveTo(cx - k, cy - k, cx, cy - r)
	c.closePath()
	c.setAttr('fillStyle', AI_VIOLET)
	c.fill()
}

/**
 * sceneFunc of the card: box, header, Markdown.
 *
 * @param {object} c Konva context
 * @param {object} shape the Konva.Shape (attrs width, height, item)
 */
function paint(c, shape) {
	const w = shape.width()
	const h = shape.height()
	const item = shape.getAttr('item')
	c.beginPath()
	if (typeof c.roundRect === 'function') c.roundRect(0, 0, w, h, AI_CARD_RADIUS)
	else c.rect(0, 0, w, h)
	c.closePath()
	c.setAttr('fillStyle', AI_CARD_FILL)
	c.fill()
	c.setAttr('strokeStyle', AI_CARD_STROKE)
	c.setAttr('lineWidth', 1)
	c.stroke()
	const measure = (text, font) => {
		c.setAttr('font', font)
		return c.measureText(text).width
	}
	c.setAttr('textBaseline', 'alphabetic')
	c.setAttr('textAlign', 'left')
	// header
	const hs = AI_HEAD_SIZE
	sparkle(c, AI_CARD_PAD, AI_CARD_PAD + (AI_HEAD_ROW - 14) / 2, 14)
	const headFont = 'normal bold ' + hs + 'px ' + FONT_FAMILY
	c.setAttr('font', headFont)
	c.setAttr('fillStyle', AI_HEAD_COLOR)
	const hx = AI_CARD_PAD + 20
	c.fillText(fit(aiHeader(item), positive(w - hx - AI_CARD_PAD), (s) => measure(s, headFont)), hx, AI_CARD_PAD + AI_HEAD_ROW / 2 + hs * 0.35)
	// body, clipped to the box (a stored h below the content until the session corrects it)
	const top = AI_CARD_PAD + AI_HEAD_ROW + AI_HEAD_GAP
	const body = aiBody(item, w, measure)
	c.setAttr('fillStyle', AI_TEXT_COLOR)
	for (const line of body.lines) {
		const base = top + line.y + line.size * 1.05
		if (base > h - 4) break
		if (line.marker) {
			c.setAttr('font', runFont({ bold: false, italic: false }, line.size, FONT_FAMILY))
			c.fillText(line.marker.text, AI_CARD_PAD + line.marker.x, base)
		}
		for (const r of line.runs) {
			c.setAttr('font', runFont(r, line.size, FONT_FAMILY))
			c.fillText(r.text, AI_CARD_PAD + r.x, base)
		}
	}
}

export const ai = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod) {
		const root = makeGroup(ctx)
		const card = new ctx.Shape({
			...SHAPE_BASE,
			width: positive(abs.w),
			height: positive(abs.h),
			item,
			sceneFunc: paint,
		})
		card.transformsEnabled('position')
		root.add(card)
		const entry = { root, parts: { card }, lod, transforms: null, textHidden: false }
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
		entry.parts.card.setAttrs({ width: positive(abs.w), height: positive(abs.h), item })
		return false
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod new level of detail (the card looks the same at both)
	 */
	setLod(ctx, entry, item, abs, lod) {
		entry.lod = lod
	},

	/** A card has no editor. */
	setTextHidden() {},
}
