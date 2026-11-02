/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The text part of notes, shapes, text items and table cells (factory job
 * 279). A text without marks (model/richText.js hasMarks) stays the
 * Konva.Text it always was; a text with marks becomes ONE Konva.Shape with
 * the same attributes (x, y, width, height, text, fontSize, fontFamily,
 * fontStyle, fill, align, verticalAlign, lineHeight, visible) whose
 * sceneFunc paints the laid-out runs: bold and italic fonts, code in a
 * monospace font on a box in the text colour at CODE_BOX_OPACITY, a line
 * through struck text and under links. It measures with the context it
 * draws into (like nodes/ai.js), so PNG, SVG and PDF get the same picture
 * with text kept as text. The layout is computed when one of its inputs
 * changed (richLayout keeps it on the shape with its key), never per frame.
 *
 * makeText builds the right one, setText changes the attributes and swaps
 * the node in place (same parent, same index) when a text gains or loses
 * its marks; the caller keeps the returned node.
 */
import { hasMarks, layoutRich, linkAtLayout, parseRich, CODE_BOX_OPACITY } from '../../model/richText.js'
import { withAlpha } from '../../model/tokens.js'
import { SHAPE_BASE } from './common.js'

/** Attributes of a text part a rich shape takes over when swapped in. */
const KEYS = ['x', 'y', 'width', 'height', 'text', 'fontSize', 'fontFamily', 'fontStyle', 'fill', 'align', 'verticalAlign', 'lineHeight', 'visible']

/**
 * @param {object} node a text part
 * @return {boolean} it is the rich shape
 */
export function isRich(node) {
	return node?.getAttr?.('rich') === true
}

/**
 * @param {object} attrs text attributes
 * @return {string} the key of the layout they give
 */
function keyOf(attrs) {
	return [attrs.text, attrs.width, attrs.height, attrs.fontSize, attrs.fontFamily, attrs.fontStyle, attrs.align, attrs.verticalAlign, attrs.lineHeight].join('\u0001')
}

/**
 * The layout of a rich shape (or of plain attributes), computed once per
 * change of its inputs.
 *
 * @param {object} shape rich shape (or null: compute from attrs)
 * @param {(text: string, font: string) => number} measure width of a text in a CSS font
 * @param {object} [attrs] attributes (default: the shape's)
 * @return {object} model/richText.js layoutRich
 */
export function richLayout(shape, measure, attrs = shape.getAttrs()) {
	const key = keyOf(attrs)
	if (shape && shape._richKey === key && shape._richLayout) return shape._richLayout
	const h = attrs.height
	const lay = layoutRich(parseRich(attrs.text), {
		width: attrs.width,
		height: Number.isFinite(h) ? h : undefined,
		fontSize: attrs.fontSize ?? 12,
		lineHeight: attrs.lineHeight ?? 1,
		align: attrs.align,
		valign: attrs.verticalAlign,
		family: attrs.fontFamily ?? 'sans-serif',
		bold: typeof attrs.fontStyle === 'string' && attrs.fontStyle.includes('bold'),
		measure,
	})
	if (shape) {
		shape._richKey = key
		shape._richLayout = lay
	}
	return lay
}

/**
 * sceneFunc of the rich shape.
 *
 * @param {object} c Konva context
 * @param {object} shape the shape
 */
function paint(c, shape) {
	const measure = (text, font) => {
		c.setAttr('font', font)
		return c.measureText(text).width
	}
	const lay = richLayout(shape, measure)
	if (lay.lines.length === 0) return
	const fs = shape.getAttr('fontSize') ?? 12
	const fill = shape.getAttr('fill') ?? '#000000'
	// the baseline as Konva.Text puts it: the font's middle in the middle of the line
	c.setAttr('font', lay.lines[0].marker?.font ?? lay.lines[0].runs[0]?.font ?? (fs + 'px sans-serif'))
	const m = c.measureText('M')
	const asc = m?.fontBoundingBoxAscent ?? m?.actualBoundingBoxAscent
	const desc = m?.fontBoundingBoxDescent ?? m?.actualBoundingBoxDescent
	const shift = Number.isFinite(asc) && Number.isFinite(desc) ? (asc - desc) / 2 : fs * 0.35
	c.setAttr('textBaseline', 'alphabetic')
	c.setAttr('textAlign', 'left')
	const bar = (x, y, w, t) => {
		c.beginPath()
		c.rect(x, y, w, t)
		c.closePath()
		c.setAttr('fillStyle', fill)
		c.fill()
	}
	const thick = Math.max(0.5, fs * 0.07)
	for (const line of lay.lines) {
		const base = line.y + line.h / 2 + shift
		if (line.marker) {
			c.setAttr('font', line.marker.font)
			c.setAttr('fillStyle', fill)
			c.fillText(line.marker.text, line.marker.x, base)
		}
		for (const r of line.runs) {
			if (r.c) {
				c.beginPath()
				c.rect(r.x - 1, line.y + line.h / 2 - fs * 0.6, r.w + 2, fs * 1.2)
				c.closePath()
				c.setAttr('fillStyle', withAlpha(fill, CODE_BOX_OPACITY))
				c.fill()
			}
			c.setAttr('font', r.font)
			c.setAttr('fillStyle', fill)
			c.fillText(r.text, r.x, base)
			if (r.s) bar(r.x, base - fs * 0.3 - thick / 2, r.w, thick)
			if (r.href) bar(r.x, base + fs * 0.12, r.w, thick)
		}
	}
}

/**
 * @param {object} ctx builder context (Shape)
 * @param {object} attrs text attributes
 * @return {object} the rich shape
 */
function richNode(ctx, attrs) {
	const n = new ctx.Shape({ ...SHAPE_BASE, ...attrs, rich: true, sceneFunc: paint })
	n.transformsEnabled('position')
	return n
}

/**
 * A text part: Konva.Text without marks, the rich shape with.
 *
 * @param {object} ctx builder context (Text, Shape)
 * @param {object} attrs text attributes (Konva.Text's)
 * @return {object} node
 */
export function makeText(ctx, attrs) {
	if (hasMarks(attrs.text)) return richNode(ctx, attrs)
	const n = new ctx.Text({ ...SHAPE_BASE, ...attrs })
	n.transformsEnabled('position')
	return n
}

/**
 * Sets a text part's attributes; swaps it for the other kind in place when
 * the text gained or lost its marks.
 *
 * @param {object} ctx builder context
 * @param {object} node the text part
 * @param {object} attrs changed attributes (Konva.Text's)
 * @param {object} [all] every attribute of a new node (default: the node's own plus attrs)
 * @return {object} the node now in its place
 */
export function setText(ctx, node, attrs, all = null) {
	const text = 'text' in attrs ? attrs.text : node.getAttr('text')
	if (hasMarks(text) === isRich(node)) {
		node.setAttrs(attrs)
		return node
	}
	// only what was really set (job 282): getAttr('height') of a Konva.Text
	// without a height is its measured height (one line before the marks
	// came), of the rich shape Konva's default 0; either would cut the text
	const own = {}
	if (all === null) {
		for (const k of [...KEYS, 'wrap', 'ellipsis']) {
			const v = node.attrs[k]
			if (v !== undefined) own[k] = v
		}
	}
	const next = makeText(ctx, { ...(all ?? own), ...attrs })
	const parent = node.getParent()
	const index = node.zIndex()
	node.destroy()
	if (parent) {
		parent.add(next)
		next.zIndex(Math.min(index, parent.getChildren().length - 1))
	}
	return next
}

/**
 * The link under a point in a text part's own coordinates.
 *
 * @param {object} node text part
 * @param {number} x point (node coordinates)
 * @param {number} y point
 * @param {(text: string, font: string) => number} measure for a layout not yet drawn
 * @return {string|null} the address
 */
export function textLinkAt(node, x, y, measure) {
	if (!isRich(node)) return null
	return linkAtLayout(richLayout(node, measure), x, y)
}
