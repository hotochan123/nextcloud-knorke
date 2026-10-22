/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shape node (SPEC-M1 §3.10, §6.3): one Group with the outline as a
 * Konva.Shape (sceneFunc: rect, rounded rect, ellipse or polygon from the
 * SHAPES table, then ctx.fillStrokeShape) and the text as a Konva.Text in
 * the shape's text box. Every field is read through fieldValue (rule 18: a
 * missing, invalid or unknown stored value draws as its §3.10 default; an
 * unknown kind draws as rect).
 *
 * - fill with fillOpacity as rgba(); fillOpacity 0 = no fill (the inside
 *   still hits, SceneModel)
 * - stroke in world units (it scales with the zoom like the shape), width 0
 *   = no stroke; dashed/dotted scale with the stroke width
 * - text: style.fontSize when stored, else auto-fit in the text box
 *   (autoFontSize, computed, never stored), align/valign, textColor
 *
 * LOD 1 (scale < LOD_TEXT_SCALE): outline only, like the note. The text node
 * is built at LOD 0 only (measuring text is the expensive part).
 */
import { fieldValue } from '../../model/registry.js'
import { shapeOf } from '../../model/shapes.js'
import { autoFontSize } from '../../model/text.js'
import { FONT_FAMILY, LINE_HEIGHT, SHAPE_TEXT_PADDING } from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

/**
 * @param {string} hex #rrggbb (fieldValue guarantees it)
 * @param {number} pct opacity 0..100
 * @return {string} the color with alpha
 */
export function withAlpha(hex, pct) {
	if (pct >= 100) return hex
	const n = parseInt(hex.slice(1), 16)
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, pct) / 100})`
}

/**
 * Dash pattern in world units for a stroke width.
 *
 * @param {string} dash solid | dashed | dotted
 * @param {number} sw stroke width
 * @return {number[]|null} null for solid
 */
export function dashFor(dash, sw) {
	const w = Math.max(1, sw)
	if (dash === 'dashed') return [4 * w, 3 * w]
	if (dash === 'dotted') return [0.001, 2.5 * w]
	return null
}

/**
 * Traces the outline of a shape kind into a (Konva) 2D context, origin
 * top-left of the unrotated box. Pure canvas path calls, so the hit test
 * (SceneModel) and the drawing share the SHAPES table.
 *
 * @param {object} ctx canvas context (beginPath, rect, moveTo, lineTo, arcTo, ellipse, closePath)
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 */
export function traceOutline(ctx, kind, w, h) {
	const s = shapeOf(kind)
	ctx.beginPath()
	if (s.outline === 'ellipse') {
		ctx.ellipse(w / 2, h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2)
	} else if (Array.isArray(s.outline)) {
		const o = s.outline
		ctx.moveTo(o[0] * w, o[1] * h)
		for (let i = 2; i < o.length; i += 2) ctx.lineTo(o[i] * w, o[i + 1] * h)
	} else if (s.radius > 0) {
		const r = Math.min(s.radius * Math.min(w, h), w / 2, h / 2)
		ctx.moveTo(r, 0)
		ctx.lineTo(w - r, 0)
		ctx.arcTo(w, 0, w, r, r)
		ctx.lineTo(w, h - r)
		ctx.arcTo(w, h, w - r, h, r)
		ctx.lineTo(r, h)
		ctx.arcTo(0, h, 0, h - r, r)
		ctx.lineTo(0, r)
		ctx.arcTo(0, 0, r, 0, r)
	} else {
		ctx.rect(0, 0, w, h)
	}
	ctx.closePath()
}

/**
 * sceneFunc of the outline node: kind, width and height are attributes of
 * the node, so an update is a setAttrs.
 *
 * @param {object} ctx Konva context
 * @param {object} shape the Konva.Shape
 */
function drawOutline(ctx, shape) {
	traceOutline(ctx, shape.getAttr('kind'), shape.width(), shape.height())
	ctx.fillStrokeShape(shape)
}

/**
 * Attributes of the outline node.
 *
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 * @return {object}
 */
export function bodyAttrs(item, abs) {
	const op = fieldValue(item, 'style.fillOpacity')
	const sw = fieldValue(item, 'style.strokeWidth')
	const dash = dashFor(fieldValue(item, 'style.dash'), sw)
	return {
		width: abs.w,
		height: abs.h,
		kind: fieldValue(item, 'data.kind'),
		fill: withAlpha(fieldValue(item, 'style.fill'), op),
		fillEnabled: op > 0,
		stroke: fieldValue(item, 'style.stroke'),
		strokeWidth: sw,
		strokeEnabled: sw > 0,
		dash: dash ?? [],
		dashEnabled: dash !== null,
		lineCap: fieldValue(item, 'style.dash') === 'dotted' ? 'round' : 'butt',
	}
}

/**
 * Text box and type of a shape in item coordinates (also the editor layout,
 * SceneManager): SHAPES[kind].text scaled by the box, minus the padding.
 *
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box (w, h)
 * @param {string} [text] text to fit (default: the stored text)
 * @return {{x:number, y:number, w:number, h:number, pad:number, fontSize:number,
 *           align:string, valign:string, color:string}} box incl. padding
 */
export function shapeTextBox(item, abs, text = fieldValue(item, 'data.text')) {
	const [tx, ty, tw, th] = shapeOf(fieldValue(item, 'data.kind')).text
	const w = tw * abs.w
	const h = th * abs.h
	const pad = SHAPE_TEXT_PADDING
	const stored = fieldValue(item, 'style.fontSize')
	return {
		x: tx * abs.w,
		y: ty * abs.h,
		w,
		h,
		pad,
		fontSize: typeof stored === 'number' ? stored : autoFontSize(str(text), w, h, pad),
		align: fieldValue(item, 'style.align'),
		valign: fieldValue(item, 'style.valign'),
		color: fieldValue(item, 'style.textColor'),
	}
}

/**
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 * @return {object} attributes of the text node
 */
function textAttrs(item, abs) {
	const b = shapeTextBox(item, abs)
	return {
		x: b.x + b.pad,
		y: b.y + b.pad,
		width: positive(b.w - 2 * b.pad),
		height: positive(b.h - 2 * b.pad),
		text: str(fieldValue(item, 'data.text')),
		fontSize: b.fontSize,
		fill: b.color,
		align: b.align,
		verticalAlign: b.valign,
	}
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
		...textAttrs(item, abs),
		fontFamily: FONT_FAMILY,
		wrap: 'word',
		ellipsis: true,
		lineHeight: LINE_HEIGHT,
		visible: !entry.textHidden,
	})
	text.transformsEnabled('position')
	entry.root.add(text)
	entry.parts.text = text
}

export const shape = {
	/**
	 * @param {object} ctx builder context ({Group, Rect, Text, Shape, Line, shadows})
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @param {boolean} [textHidden] text is being edited
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod, textHidden = false) {
		const root = makeGroup(ctx)
		const body = new ctx.Shape({
			...SHAPE_BASE,
			...bodyAttrs(item, abs),
			sceneFunc: drawOutline,
			shadowForStrokeEnabled: false,
		})
		body.transformsEnabled('position')
		root.add(body)
		const entry = { root, parts: { body, text: null }, lod, transforms: null, textHidden }
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
		const { body, text } = entry.parts
		if (fields.has('geom') || fields.has('style') || fields.has('data')) {
			body.setAttrs(bodyAttrs(item, abs))
		}
		if (text && (fields.has('geom') || fields.has('style') || fields.has('data') || fields.has('text'))) {
			text.setAttrs(textAttrs(item, abs))
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
