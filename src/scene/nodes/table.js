/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Table node (factory job 173): Konva only, no DOM per cell. A white ground,
 * the header row (style.header 'on', the default) tinted in
 * style.headerFill, the grid as ONE Konva.Shape of 1-unit lines in
 * style.stroke, and at level 0 one Konva.Text per non-empty cell: left and
 * top in its cell (TABLE_PAD inside), wrapped at the column width −
 * 2 · TABLE_PAD ('word', long words broken too), TABLE_FONT_SIZE, bold in
 * the header, in style.textColor. Level 1 (below LOD_TEXT_SCALE) has no
 * text; LOD 2 paints a box (coarse.js).
 *
 * The rows follow the measured text heights (model/table.js tableLayout with
 * ctx.measureCell, the renderer's measurement, or estimateCellHeight), never
 * the stored h, so a row that grew is drawn whole even while h lags. The
 * entry keeps its layout (entry.layout). textHidden is the cell whose editor
 * is open ("<col>.<row>"), or false.
 *
 * Job 265 (redesign round 4, T3): ground, header row, header column
 * (style.headerCol 'on': the first column over the full height in
 * style.headerFill, its texts bold), the lines and the texts lie in a body
 * group clipped to the box with corners TABLE_RADIUS (at most half a side);
 * the lines are two shapes, across in tableLines(stroke).h and down in
 * .v, 1 unit wide; the outer border (style.stroke, TABLE_BORDER_PX screen
 * px, same corners) lies above the body, outside the clip.
 */
import { fieldValue } from '../../model/registry.js'
import { TABLE_FONT_SIZE, TABLE_PAD, cellKey, cellText, estimateCellHeight, tableLayout } from '../../model/table.js'
import { FONT_FAMILY, LINE_HEIGHT, TABLE_BORDER_PX, TABLE_FILL, TABLE_RADIUS, shownColor, tableLines } from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive } from './common.js'
import { traceFrame } from './frame.js'
import { makeText, setText } from './richText.js'

/**
 * Konva text attributes of a cell (also used to measure it, KonvaRenderer.measureCellHeight).
 *
 * @param {string} text cell text
 * @param {number} width wrap width (column width − 2 · TABLE_PAD)
 * @param {boolean} bold header row
 * @return {object}
 */
export function cellTextAttrs(text, width, bold) {
	return {
		text,
		width: positive(width),
		fontSize: TABLE_FONT_SIZE,
		fontFamily: FONT_FAMILY,
		fontStyle: bold ? 'bold' : 'normal',
		lineHeight: LINE_HEIGHT,
		wrap: 'word',
		padding: 0,
	}
}

/**
 * sceneFunc of the inner lines: down at every xs, across at every ys.
 *
 * @param {object} ctx Konva context
 * @param {object} shape the Konva.Shape (attrs width, height, xs, ys)
 */
export function drawLines(ctx, shape) {
	const w = shape.getAttr('width')
	const h = shape.getAttr('height')
	ctx.beginPath()
	for (const x of shape.getAttr('xs')) {
		ctx.moveTo(x, 0)
		ctx.lineTo(x, h)
	}
	for (const y of shape.getAttr('ys')) {
		ctx.moveTo(0, y)
		ctx.lineTo(w, y)
	}
	ctx.strokeShape(shape)
}

/**
 * @param {object} ctx builder context
 * @return {(text: string, width: number, bold: boolean) => number} the text height of a cell
 */
function measureOf(ctx) {
	return typeof ctx.measureCell === 'function'
		? (text, width, bold) => {
			const h = ctx.measureCell(text, width, bold)
			return Number.isFinite(h) ? h : estimateCellHeight(text, width, bold)
		}
		: estimateCellHeight
}

/**
 * @param {number} w width
 * @param {number} h height
 * @return {number} the corner radius of a table w × h
 */
export function tableRadius(w, h) {
	return Math.max(0, Math.min(TABLE_RADIUS, w / 2, h / 2))
}

/**
 * clipFunc of the body: the box with round corners.
 *
 * @param {object} c context
 * @param {object} g the body group (attrs width, height)
 */
function clipBody(c, g) {
	const w = g.getAttr('width')
	const h = g.getAttr('height')
	traceFrame(c, w, h, 0, tableRadius(w, h))
}

/**
 * The attributes of body, ground, header row, header column, lines and border for a layout.
 *
 * @param {object} item table item
 * @param {object} l its layout
 * @return {{body: object, bg: object, head: object, headCol: object, linesH: object, linesV: object, border: object}}
 */
export function frameAttrs(item, l) {
	const first = l.rows[0] ?? null
	const col = l.cols[0] ?? null
	const w = positive(l.w)
	const h = positive(l.h)
	const r = tableRadius(w, h)
	const fill = shownColor(fieldValue(item, 'style.headerFill'))
	const stroke = shownColor(fieldValue(item, 'style.stroke'))
	const lines = tableLines(stroke)
	const xs = l.cols.slice(1).map((c) => c.x)
	const ys = l.rows.slice(1).map((r) => r.y)
	return {
		body: { width: w, height: h },
		bg: { width: w, height: h, fill: TABLE_FILL, cornerRadius: r },
		head: { width: w, height: first ? first.h : 0, fill, visible: l.header && first !== null },
		headCol: { width: col ? col.w : 0, height: h, fill, visible: l.headerCol === true && col !== null },
		linesH: { width: w, height: h, stroke: lines.h, strokeWidth: 1, xs: [], ys },
		linesV: { width: w, height: h, stroke: lines.v, strokeWidth: 1, xs, ys: [] },
		border: { width: w, height: h, cornerRadius: r, stroke, strokeWidth: TABLE_BORDER_PX, strokeScaleEnabled: false },
	}
}

/** @param {object} entry node entry @param {object} a frameAttrs */
function setFrame(entry, a) {
	for (const k of ['body', 'bg', 'head', 'headCol', 'linesH', 'linesV', 'border']) entry.parts[k].setAttrs(a[k])
}

/**
 * Builds, updates and removes the text nodes of the cells for a layout.
 *
 * @param {object} ctx builder context
 * @param {object} entry node entry
 * @param {object} item table item
 */
function syncTexts(ctx, entry, item) {
	const l = entry.layout
	const texts = entry.parts.texts
	const color = shownColor(fieldValue(item, 'style.textColor'))
	const seen = new Set()
	if (entry.lod === 0) {
		l.rows.forEach((r, i) => {
			l.cols.forEach((c, j) => {
				const bold = (l.header && i === 0) || (l.headerCol && j === 0)
				const text = cellText(item.data, c.key, r.key)
				if (text === '') return
				const key = cellKey(c.key, r.key)
				seen.add(key)
				const attrs = {
					...cellTextAttrs(text, c.w - 2 * TABLE_PAD, bold), x: c.x + TABLE_PAD, y: r.y + TABLE_PAD, fill: color,
					visible: entry.textHidden !== key,
				}
				// job 279: a Konva.Text, or the rich shape for a cell with Markdown marks
				let node = texts.get(key)
				if (node) {
					node = setText(ctx, node, attrs, attrs)
				} else {
					node = makeText(ctx, attrs)
					entry.parts.body.add(node)
				}
				texts.set(key, node)
			})
		})
	}
	for (const [key, node] of texts) {
		if (!seen.has(key)) {
			node.destroy()
			texts.delete(key)
		}
	}
}

export const table = {
	/**
	 * @param {object} ctx builder context (measureCell: the renderer's text measurement)
	 * @param {object} item table item
	 * @param {object} abs absolute box
	 * @param {0|1} level 0 = with text, 1 = without
	 * @param {string|boolean} [textHidden] the cell whose editor is open
	 * @return {object} entry
	 */
	build(ctx, item, abs, level, textHidden = false) {
		const root = makeGroup(ctx)
		const layout = tableLayout(item, measureOf(ctx))
		const a = frameAttrs(item, layout)
		const body = new ctx.Group({ ...SHAPE_BASE, ...a.body, clipFunc: clipBody })
		const bg = new ctx.Rect({ ...SHAPE_BASE, ...a.bg })
		const head = new ctx.Rect({ ...SHAPE_BASE, ...a.head })
		const headCol = new ctx.Rect({ ...SHAPE_BASE, ...a.headCol })
		const linesH = new ctx.Shape({ ...SHAPE_BASE, ...a.linesH, sceneFunc: drawLines })
		const linesV = new ctx.Shape({ ...SHAPE_BASE, ...a.linesV, sceneFunc: drawLines })
		const border = new ctx.Rect({ ...SHAPE_BASE, ...a.border })
		for (const n of [body, bg, head, headCol, linesH, linesV, border]) n.transformsEnabled('position')
		body.add(bg, head, headCol, linesV, linesH)
		root.add(body, border)
		const entry = {
			root, parts: { body, bg, head, headCol, linesH, linesV, border, texts: new Map() },
			lod: level, transforms: null, textHidden: typeof textHidden === 'string' ? textHidden : false, layout,
		}
		// the texts come after the lines (above them), in the body
		syncTexts(ctx, entry, item)
		place(entry, abs)
		return entry
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item table item (new state)
	 * @param {object} abs absolute box
	 * @param {Set<string>} fields changed fields
	 * @return {boolean} true = rebuild
	 */
	update(ctx, entry, item, abs, fields) {
		if (fields.has('type')) return true
		if (fields.has('data') || fields.has('style') || fields.has('geom') || fields.has('text')) {
			entry.layout = tableLayout(item, measureOf(ctx))
			setFrame(entry, frameAttrs(item, entry.layout))
			syncTexts(ctx, entry, item)
		}
		return false
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item table item
	 * @param {object} abs absolute box
	 * @param {0|1} level new level
	 */
	setLod(ctx, entry, item, abs, level) {
		entry.lod = level
		syncTexts(ctx, entry, item)
	},

	/**
	 * @param {object} entry node entry
	 * @param {string|boolean} hidden the cell whose editor opened, false when it closed
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = typeof hidden === 'string' ? hidden : false
		for (const [key, node] of entry.parts.texts) node.visible(entry.textHidden !== key)
	},
}
