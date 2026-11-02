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
 *   still hits, SceneModel; with the select tool only the border band and,
 *   job 177, the block of the drawn text lines, shapeTextBlock)
 * - stroke in world units (it scales with the zoom like the shape), width 0
 *   = no stroke; dashed/dotted scale with the stroke width
 * - text: style.fontSize when stored, else auto-fit in the text box
 *   (autoFontSize, computed, never stored), align/valign, textColor
 *
 * LOD 1 (scale < LOD_TEXT_SCALE): outline only, like the note. The text node
 * is built at LOD 0 only (measuring text is the expensive part).
 *
 * Job 201: a symbol kind traces its icon (SHAPES[kind].icon, scaled from its
 * 24 × 24 grid to the box) instead of the box, filled and bordered like any
 * outline; an icon that cannot be read draws nothing. Job 244: first its
 * light layer (SHAPES[kind].duo, Phosphor Duotone) in the fill at DUO_SHARE
 * of its opacity (the attribute duoFill), without a border; none at fill
 * opacity 0. The inner lines of a
 * kind (SHAPES[kind].lines) follow fill and border, stroked only, with the
 * border's colour, width and dash (none without a border).
 *
 * Job 203: the kind image draws its picture (scene/imageCache.js pictureOf,
 * the node's attribute picture) stretched over the box, without fill,
 * border or text inside; while the picture loads, or when it cannot be decoded,
 * a box in PLACEHOLDER_FILL with a 1-unit PLACEHOLDER_STROKE border.
 *
 * Job 204 (BPMN): the mark or badge of a kind (shapes.js markPlace) follows
 * the inner lines, filled in the border's colour (the attribute markColor,
 * style.stroke), also without a border; a thick kind's border is twice
 * style.strokeWidth wide (its dashes too).
 *
 * Job 211: a symbol, BPMN event or gateway (job 235: an own shape too) draws
 * its text as a label below the box instead (shapeTextAttrs on the label box of SceneModel
 * shapeLabelOf): as wide as that box, no height, centred lines in
 * style.textColor; it is part of the group, so it moves and turns with it.
 */
import { shapeLabelOf } from '../../model/SceneModel.js'
import { fieldValue } from '../../model/registry.js'
import {
	DUO_SHARE, boxRadius, duoCommands, hasLabel, iconCommands, isImageKind, markCommands, markPlace, shapeOf, shownBorder, textPad,
} from '../../model/shapes.js'
import { traceCommands } from '../../model/svgPath.js'
import { autoFontSize } from '../../model/text.js'
import { FONT_FAMILY, LINE_HEIGHT, PLACEHOLDER_FILL, PLACEHOLDER_STROKE, shownColor } from '../../model/tokens.js'
import { imageFor, pictureOf } from '../imageCache.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'
import { makeText, setText } from './richText.js'
import { shownText } from '../../model/richText.js'

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
	ctx.beginPath()
	addOutline(ctx, kind, w, h)
}

/**
 * (Job 202) traceOutline without beginPath: adds the outline as a new
 * subpath to the open path, so the LOD-2 painter strokes many outlines at
 * once (the ellipse starts with a moveTo to its first point: no line from
 * the subpath before).
 *
 * @param {object} ctx canvas context (rect, moveTo, lineTo, arcTo, ellipse, closePath)
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 */
export function addOutline(ctx, kind, w, h) {
	const s = shapeOf(kind)
	if (typeof s.icon === 'string') {
		// job 201: a symbol is its icon, stretched over the box
		const cmds = iconCommands(kind)
		if (cmds) traceCommands(ctx, cmds, w / 24, h / 24)
		return
	}
	if (s.outline === 'ellipse') {
		ctx.moveTo(w, h / 2)
		ctx.ellipse(w / 2, h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2)
	} else if (Array.isArray(s.outline)) {
		const o = s.outline
		if (s.corner > 0) {
			addRoundedPolygon(ctx, o, w, h, s.corner)
		} else {
			ctx.moveTo(o[0] * w, o[1] * h)
			for (let i = 2; i < o.length; i += 2) ctx.lineTo(o[i] * w, o[i + 1] * h)
		}
	} else if (boxRadius(kind, w, h) > 0) {
		const r = boxRadius(kind, w, h)
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
 * (Job 260) A closed polygon with rounded corners as a new subpath: it starts
 * in the middle of the last edge, and each corner is an arcTo of radius
 * min(corner, half of its shorter neighbouring edge), so short edges (the
 * steps of a curve) stay as they are and nothing overlaps. A degenerate
 * corner (an edge of length 0) gets radius 0.
 *
 * @param {object} ctx canvas context (moveTo, arcTo)
 * @param {number[]} o flat outline in the unit box
 * @param {number} w width
 * @param {number} h height
 * @param {number} corner radius in world units
 */
function addRoundedPolygon(ctx, o, w, h, corner) {
	const n = o.length / 2
	const p = (i) => [o[2 * (i % n)] * w, o[2 * (i % n) + 1] * h]
	let [ax, ay] = p(n - 1)
	let [bx, by] = p(0)
	ctx.moveTo((ax + bx) / 2, (ay + by) / 2)
	for (let i = 1; i <= n; i++) {
		const [cx, cy] = p(i)
		ctx.arcTo(bx, by, cx, cy, Math.min(corner, Math.hypot(bx - ax, by - ay) / 2, Math.hypot(cx - bx, cy - by) / 2))
		;[ax, ay, bx, by] = [bx, by, cx, cy]
	}
}

/**
 * (Job 201) Traces the inner lines of a kind (SHAPES[kind].lines) as open
 * polylines, origin top-left of the unrotated box.
 *
 * @param {object} ctx canvas context (beginPath, moveTo, lineTo)
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 * @return {boolean} false when the kind has no inner lines (nothing traced)
 */
export function traceLines(ctx, kind, w, h) {
	const lines = shapeOf(kind).lines
	if (!Array.isArray(lines) || lines.length === 0) return false
	ctx.beginPath()
	addLines(ctx, kind, w, h)
	return true
}

/**
 * (Job 202) traceLines without beginPath: the inner lines added to the open path.
 *
 * @param {object} ctx canvas context (moveTo, lineTo)
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 */
export function addLines(ctx, kind, w, h) {
	const lines = shapeOf(kind).lines
	if (!Array.isArray(lines)) return
	for (const l of lines) {
		ctx.moveTo(l[0] * w, l[1] * h)
		for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i] * w, l[i + 1] * h)
	}
}

/**
 * sceneFunc of the outline node: kind, width and height are attributes of
 * the node, so an update is a setAttrs.
 *
 * @param {object} ctx Konva context
 * @param {object} shape the Konva.Shape
 */
function drawOutline(ctx, shape) {
	const kind = shape.getAttr('kind')
	// job 203: the picture of an own shape, once it is decoded
	const img = isImageKind(kind) ? imageFor(shape.getAttr('picture')) : null
	if (img) {
		ctx.drawImage(img, 0, 0, shape.width(), shape.height())
		return
	}
	// job 244: a symbol's light layer under its icon (none without a fill)
	if (shape.getAttr('fillEnabled') !== false) traceDuo(ctx, kind, shape.width(), shape.height(), shape.getAttr('duoFill'))
	traceOutline(ctx, kind, shape.width(), shape.height())
	ctx.fillStrokeShape(shape)
	// job 201: inner lines in the border's look
	if (shape.getAttr('strokeEnabled') !== false && traceLines(ctx, kind, shape.width(), shape.height())) ctx.strokeShape(shape)
	// job 204: the mark or badge, filled in the border's colour
	traceMark(ctx, kind, shape.width(), shape.height(), shape.getAttr('markColor'))
}

/**
 * (Job 204) Traces and fills the mark or badge of a kind (shapes.js
 * markPlace), origin top-left of the unrotated box; nothing for a kind
 * without one or an unreadable icon.
 *
 * @param {object} ctx canvas (Konva) context (beginPath, moveTo, lineTo, bezierCurveTo, closePath, setAttr, fill)
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 * @param {string} color fill colour
 * @return {boolean} something was drawn
 */
export function traceMark(ctx, kind, w, h, color) {
	const m = markPlace(kind, w, h)
	const cmds = m ? markCommands(kind) : null
	if (!cmds) return false
	ctx.beginPath()
	traceCommands(ctx, cmds, m.s / 24, m.s / 24, m.x, m.y)
	ctx.setAttr('fillStyle', color)
	ctx.fill()
	return true
}

/**
 * (Job 244) Traces and fills the light layer of a symbol kind (shapes.js
 * duo) stretched over the box like its icon, origin top-left of the
 * unrotated box; nothing for any other kind.
 *
 * @param {object} ctx canvas (Konva) context (beginPath, moveTo, lineTo, bezierCurveTo, closePath, setAttr, fill)
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 * @param {string} color fill colour (the fill at DUO_SHARE of its opacity)
 * @return {boolean} something was drawn
 */
export function traceDuo(ctx, kind, w, h, color) {
	const cmds = duoCommands(kind)
	if (!cmds || typeof color !== 'string') return false
	ctx.beginPath()
	traceCommands(ctx, cmds, w / 24, h / 24)
	ctx.setAttr('fillStyle', color)
	ctx.fill()
	return true
}

/**
 * Attributes of the outline node.
 *
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 * @return {object}
 */
export function bodyAttrs(item, abs) {
	if (isImageKind(fieldValue(item, 'data.kind'))) {
		// job 203: the attributes of the placeholder; drawOutline draws the picture instead once it is decoded
		return {
			width: abs.w, height: abs.h, kind: 'image', picture: pictureOf(item), fill: PLACEHOLDER_FILL, fillEnabled: true,
			stroke: PLACEHOLDER_STROKE, strokeWidth: 1, strokeEnabled: true, dash: [], dashEnabled: false, lineCap: 'butt', lineJoin: 'miter',
		}
	}
	const op = fieldValue(item, 'style.fillOpacity')
	const kind = fieldValue(item, 'data.kind')
	// job 204: a thick kind (end events, call activity) draws its border twice as wide
	const sw = fieldValue(item, 'style.strokeWidth') * (shapeOf(kind).thick === true ? 2 : 1)
	const dash = dashFor(fieldValue(item, 'style.dash'), sw)
	return {
		width: abs.w,
		height: abs.h,
		kind,
		fill: withAlpha(shownColor(fieldValue(item, 'style.fill')), op),
		fillEnabled: op > 0,
		// job 244: the light layer of a symbol
		duoFill: withAlpha(shownColor(fieldValue(item, 'style.fill')), op * DUO_SHARE),
		// job 260: the old default border drawn as SHAPE_BORDER (shownBorder); rounded joins with the rounded corners
		stroke: shownBorder(kind, fieldValue(item, 'style.stroke')),
		strokeWidth: sw,
		lineJoin: shapeOf(kind).corner > 0 ? 'round' : 'miter',
		strokeEnabled: sw > 0,
		dash: dash ?? [],
		dashEnabled: dash !== null,
		lineCap: fieldValue(item, 'style.dash') === 'dotted' ? 'round' : 'butt',
		markColor: shownBorder(kind, fieldValue(item, 'style.stroke')),
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
	const kind = fieldValue(item, 'data.kind')
	const [tx, ty, tw, th] = shapeOf(kind).text
	const w = tw * abs.w
	const h = th * abs.h
	// job 260: the padding of the kind
	const pad = textPad(kind)
	const stored = fieldValue(item, 'style.fontSize')
	return {
		x: tx * abs.w,
		y: ty * abs.h,
		w,
		h,
		pad,
		fontSize: typeof stored === 'number' ? stored : autoFontSize(shownText(str(text)), w, h, pad),
		align: fieldValue(item, 'style.align'),
		valign: fieldValue(item, 'style.valign'),
		color: shownColor(fieldValue(item, 'style.textColor')),
	}
}

/**
 * (job 177) The block of the lines a shape's text node draws, in item
 * coordinates (origin top-left of the unrotated box): as wide as the widest
 * line, lines × fontSize × LINE_HEIGHT high, placed in the inner text box
 * (the text box minus its padding on every side) by align (left, center,
 * right) and valign (top, middle, bottom) as Konva places the lines. The
 * whole block counts, also beside a shorter line.
 *
 * @param {{x:number, y:number, w:number, h:number, pad:number, fontSize:number,
 *          align:string, valign:string}} b text box of the shape (shapeTextBox)
 * @param {number[]} widths widths of the drawn lines (renderer.measureShapeLines)
 * @return {{x:number, y:number, w:number, h:number}|null} null without a line
 */
export function shapeTextBlock(b, widths) {
	if (!b || !Array.isArray(widths) || widths.length === 0) return null
	let w = 0
	for (const v of widths) {
		if (Number.isFinite(v) && v > w) w = v
	}
	const h = widths.length * b.fontSize * LINE_HEIGHT
	const x0 = b.x + b.pad
	const y0 = b.y + b.pad
	const iw = positive(b.w - 2 * b.pad)
	const ih = positive(b.h - 2 * b.pad)
	return {
		x: b.align === 'right' ? x0 + iw - w : b.align === 'center' ? x0 + (iw - w) / 2 : x0,
		y: b.valign === 'bottom' ? y0 + ih - h : b.valign === 'middle' ? y0 + (ih - h) / 2 : y0,
		w,
		h,
	}
}

/** (job 177) Layout attributes of a shape's text node, also of the renderer's measurer (measureShapeLines). */
export const SHAPE_TEXT_LAYOUT = Object.freeze({ fontFamily: FONT_FAMILY, wrap: 'word', ellipsis: true, lineHeight: LINE_HEIGHT })

/**
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 * @return {object} attributes of the text node (job 177: also of the renderer's measurer)
 */
export function shapeTextAttrs(item, abs) {
	const kind = fieldValue(item, 'data.kind')
	if (hasLabel(kind)) {
		// job 211: the label below the box (empty without one)
		const l = shapeLabelOf(item, abs)
		return {
			x: l ? l.x : 0,
			y: l ? l.y : abs.h,
			width: l ? l.w : positive(abs.w),
			height: undefined,
			text: l ? str(fieldValue(item, 'data.text')) : '',
			fontSize: l ? l.fs : 1,
			fill: shownColor(fieldValue(item, 'style.textColor')),
			align: 'center',
			verticalAlign: 'top',
		}
	}
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
	// job 279: a Konva.Text, or the rich shape for a text with Markdown marks
	const text = makeText(ctx, {
		...shapeTextAttrs(item, abs),
		...SHAPE_TEXT_LAYOUT,
		visible: !entry.textHidden,
	})
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
			entry.parts.text = setText(ctx, text, shapeTextAttrs(item, abs))
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
