/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Connector node (SPEC-M1 §3.10, §6.3 "Knoten", LOD table). Unlike the box
 * types it has no place(): the root Group stays at (0, 0) with
 * transformsEnabled('position') and the parts draw the ROUTED geometry of the
 * model (SceneModel.routeOf: ConnGeom + estimated label box) in world
 * coordinates. The renderer passes that route where other specs get the
 * absolute box, and calls place(ctx, entry, item, route) whenever the route
 * or the item changes (spec.routed).
 *
 * - line: ONE Konva.Shape whose sceneFunc strokes the path (moveTo/lineTo, or
 *   bezierCurveTo for 'curved') with style.stroke, style.strokeWidth (world
 *   units) and the dash pattern of style.dash, then draws the caps SOLID
 *   (setLineDash([]): the dash never runs over a cap). Caps (capSize =
 *   3·strokeWidth + 4) point along ConnGeom.start/end.angle (bezier: end −
 *   last control point, like Konva's Arrow): 'arrow' an open chevron,
 *   'triangle' and 'diamond' filled, 'dot' a filled circle; the line is
 *   shortened under a filled cap so a thick stroke never pokes through it
 * - label (LOD 0 only, when data.label is set): a BOARD_BACKGROUND Rect on
 *   the estimated label box and a centred Konva.Text in it, laid out at the
 *   box width with automatic height and no ellipsis, so Konva never cuts it
 *   (finding S-1b-01); settleLabelText centres it in the box
 * Every field is read through fieldValue (rule 18: missing or unknown values
 * draw as the §3.10 defaults: straight, #1a1a1a, 2, solid, no caps).
 *
 * LOD 1: line and caps, no label (the label parts are destroyed, not hidden:
 * no visible() setter on re-entry, lab gate "Herausnehmen"); visible() is
 * only used while the label editor hides the label.
 */
import { fieldValue } from '../../model/registry.js'
import { capSize } from '../../model/connectors.js'
import {
	BOARD_BACKGROUND, CONNECTOR_LABEL_FONT_SIZE, CONNECTOR_LABEL_PAD, FONT_FAMILY, LINE_HEIGHT, TEXT_COLOR,
} from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, positive, str } from './common.js'
import { dashFor } from './shape.js'

/**
 * How far the line ends before a cap's tip (so a filled cap covers its end).
 *
 * @param {string} cap cap name
 * @param {number} size capSize
 * @param {number} sw stroke width
 * @return {number}
 */
export function capCut(cap, size, sw) {
	switch (cap) {
	case 'arrow': return sw / 2
	case 'triangle': return size * 0.8
	case 'diamond': return size * 1.2
	default: return 0
	}
}

/**
 * Path points with both ends pulled back along their cap directions (a
 * polyline end moves along its last segment, a bezier end moves with its
 * control point, which keeps the tangent).
 *
 * @param {number[]} pts route points
 * @param {boolean} bezier [p0, c1, c2, p1]
 * @param {number} cutStart pull-back at the start
 * @param {number} cutEnd pull-back at the end
 * @param {number} a0 start cap angle (away from the line)
 * @param {number} a1 end cap angle
 * @return {number[]} a new list
 */
export function shortened(pts, bezier, cutStart, cutEnd, a0, a1) {
	const p = pts.slice()
	const n = p.length
	if (bezier && n === 8) {
		if (cutStart > 0) {
			const dx = Math.cos(a0) * cutStart
			const dy = Math.sin(a0) * cutStart
			p[0] -= dx
			p[1] -= dy
			p[2] -= dx
			p[3] -= dy
		}
		if (cutEnd > 0) {
			const dx = Math.cos(a1) * cutEnd
			const dy = Math.sin(a1) * cutEnd
			p[6] -= dx
			p[7] -= dy
			p[4] -= dx
			p[5] -= dy
		}
		return p
	}
	const pull = (i, j, cut) => {
		// move point i towards point j by cut (at most to 1 % of the segment)
		const dx = p[j] - p[i]
		const dy = p[j + 1] - p[i + 1]
		const len = Math.hypot(dx, dy)
		if (!(len > 0) || !(cut > 0)) return
		const t = Math.min(cut, len * 0.99) / len
		p[i] += dx * t
		p[i + 1] += dy * t
	}
	if (n >= 4) {
		pull(0, 2, cutStart)
		pull(n - 2, n - 4, cutEnd)
	}
	return p
}

/**
 * Traces and fills/strokes one cap at (x, y) pointing along `angle`.
 *
 * @param {object} ctx canvas (Konva) context
 * @param {string} cap cap name
 * @param {number} x tip x
 * @param {number} y tip y
 * @param {number} angle direction away from the line (radians)
 * @param {number} size capSize
 * @param {number} sw stroke width
 * @param {string} color stroke color
 */
export function drawCap(ctx, cap, x, y, angle, size, sw, color) {
	if (cap !== 'arrow' && cap !== 'triangle' && cap !== 'diamond' && cap !== 'dot') return
	const ux = Math.cos(angle)
	const uy = Math.sin(angle)
	const vx = -uy
	const vy = ux
	ctx.beginPath()
	if (cap === 'dot') {
		ctx.arc(x, y, size * 0.4, 0, Math.PI * 2, false)
	} else if (cap === 'diamond') {
		ctx.moveTo(x, y)
		ctx.lineTo(x - ux * size * 0.7 + vx * size * 0.45, y - uy * size * 0.7 + vy * size * 0.45)
		ctx.lineTo(x - ux * size * 1.4, y - uy * size * 1.4)
		ctx.lineTo(x - ux * size * 0.7 - vx * size * 0.45, y - uy * size * 0.7 - vy * size * 0.45)
		ctx.closePath()
	} else {
		ctx.moveTo(x - ux * size + vx * size * 0.5, y - uy * size + vy * size * 0.5)
		ctx.lineTo(x, y)
		ctx.lineTo(x - ux * size - vx * size * 0.5, y - uy * size - vy * size * 0.5)
		if (cap === 'triangle') ctx.closePath()
	}
	if (cap === 'arrow') {
		ctx.setAttr('strokeStyle', color)
		ctx.setAttr('lineWidth', sw)
		ctx.setAttr('lineCap', 'round')
		ctx.setAttr('lineJoin', 'round')
		ctx.stroke()
	} else {
		ctx.setAttr('fillStyle', color)
		ctx.fill()
	}
}

/**
 * sceneFunc of the line node: path (dashed per style), then the caps solid.
 * Everything comes from the node's attributes, so an update is a setAttrs.
 *
 * @param {object} ctx Konva context
 * @param {object} shape the Konva.Shape
 */
export function drawConnector(ctx, shape) {
	const pts = shape.getAttr('pts')
	if (!Array.isArray(pts) || pts.length < 4) return
	const sw = shape.strokeWidth()
	const size = capSize(sw)
	const sc = shape.getAttr('startCap')
	const ec = shape.getAttr('endCap')
	const a0 = shape.getAttr('startAngle')
	const a1 = shape.getAttr('endAngle')
	const bezier = shape.getAttr('bezier') === true
	const p = shortened(pts, bezier, capCut(sc, size, sw), capCut(ec, size, sw), a0, a1)
	ctx.beginPath()
	ctx.moveTo(p[0], p[1])
	if (bezier && p.length === 8) {
		ctx.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7])
	} else {
		for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i], p[i + 1])
	}
	ctx.strokeShape(shape)
	if (sc === 'none' && ec === 'none') return
	ctx.setLineDash([])
	const color = shape.stroke()
	const n = pts.length
	drawCap(ctx, sc, pts[0], pts[1], a0, size, sw, color)
	drawCap(ctx, ec, pts[n - 2], pts[n - 1], a1, size, sw, color)
}

/**
 * Attributes of the line node for an item and its route (no route: an
 * empty path, nothing drawn).
 *
 * @param {object} item connector WireItem
 * @param {{geom:object}|null} route SceneModel.routeOf
 * @return {object}
 */
export function lineAttrs(item, route) {
	const sw = fieldValue(item, 'style.strokeWidth')
	const dashName = fieldValue(item, 'style.dash')
	const dash = dashFor(dashName, sw)
	const g = route?.geom ?? null
	return {
		pts: g ? g.points : [],
		bezier: g?.kind === 'bezier',
		startAngle: g ? g.start.angle : 0,
		endAngle: g ? g.end.angle : 0,
		startCap: fieldValue(item, 'style.startCap'),
		endCap: fieldValue(item, 'style.endCap'),
		stroke: fieldValue(item, 'style.stroke'),
		strokeWidth: sw,
		dash: dash ?? [],
		dashEnabled: dash !== null,
		lineCap: dashName === 'dotted' ? 'round' : 'butt',
		lineJoin: 'round',
	}
}

/**
 * @param {object} item connector WireItem
 * @param {{label:object}} route route with a label box
 * @return {{bg:object, text:object}} attributes of the label parts (the text
 *   has a width but NO height: a fixed height makes Konva drop lines)
 */
export function labelAttrs(item, route) {
	const l = route.label
	const pad = CONNECTOR_LABEL_PAD
	return {
		bg: { x: l.x, y: l.y, width: l.w, height: l.h },
		text: {
			x: l.x + pad,
			y: l.y + pad,
			width: positive(l.w - 2 * pad),
			text: str(fieldValue(item, 'data.label')),
		},
	}
}

/**
 * @param {unknown} s text
 * @return {number} its characters without whitespace
 */
function inkChars(s) {
	return typeof s === 'string' ? s.replace(/\s+/g, '').length : 0
}

/**
 * Safety net under the estimated label box (finding S-1b-01). labelBox is an
 * upper bound for Arial/Liberation Sans, emoji and CJK fonts, so Konva lays
 * the label out at the box width in at most box.lines lines. Should a
 * platform font still be wider, an extra line just overflows the box (no
 * fixed height, no ellipsis); and when Konva drops text because a single
 * grapheme is wider than the whole line (its layout keeps fewer characters
 * than the label has), the text falls back to its natural width (one line
 * per paragraph). Either way the text is centred in the box in both axes.
 *
 * @param {object} t the label Konva.Text (attributes from labelAttrs set)
 * @param {{x:number, y:number, w:number, h:number}} l label box
 */
export function settleLabelText(t, l) {
	const kept = Array.isArray(t.textArr) ? t.textArr.reduce((n, row) => n + inkChars(row.text), 0) : null
	if (kept !== null && kept < inkChars(t.getAttr('text'))) {
		t.setAttrs({ width: undefined })
	}
	t.setAttrs({ x: l.x + (l.w - t.width()) / 2, y: l.y + (l.h - t.height()) / 2 })
}

/**
 * @param {object} ctx builder context
 * @param {object} entry node entry
 * @param {object} item connector WireItem
 * @param {object} route route with a label box
 */
function addLabel(ctx, entry, item, route) {
	const a = labelAttrs(item, route)
	const bg = new ctx.Rect({
		...SHAPE_BASE,
		...a.bg,
		fill: BOARD_BACKGROUND,
		cornerRadius: 3,
		visible: !entry.textHidden,
	})
	bg.transformsEnabled('position')
	const text = new ctx.Text({
		...SHAPE_BASE,
		...a.text,
		fontSize: CONNECTOR_LABEL_FONT_SIZE,
		fontFamily: FONT_FAMILY,
		fill: TEXT_COLOR,
		align: 'center',
		wrap: 'word',
		ellipsis: false,
		lineHeight: LINE_HEIGHT,
		visible: !entry.textHidden,
	})
	text.transformsEnabled('position')
	settleLabelText(text, route.label)
	entry.root.add(bg, text)
	entry.parts.bg = bg
	entry.parts.text = text
}

/** @param {object} entry node entry: its label parts go */
function removeLabel(entry) {
	entry.parts.bg?.destroy()
	entry.parts.text?.destroy()
	entry.parts.bg = null
	entry.parts.text = null
}

export const connector = {
	/** Draws the model's route instead of a box (the renderer passes routeOf, calls place). */
	routed: true,

	/**
	 * @param {object} ctx builder context ({Group, Rect, Text, Shape, Line, shadows})
	 * @param {object} item connector WireItem
	 * @param {{geom:object, label:(object|null)}|null} route SceneModel.routeOf
	 * @param {0|1} lod level of detail
	 * @param {boolean} [textHidden] the label is being edited
	 * @return {object} entry
	 */
	build(ctx, item, route, lod, textHidden = false) {
		const root = makeGroup(ctx)
		root.transformsEnabled('position')
		const line = new ctx.Shape({
			...SHAPE_BASE,
			...lineAttrs(item, route),
			sceneFunc: drawConnector,
			shadowForStrokeEnabled: false,
		})
		line.transformsEnabled('position')
		root.add(line)
		const entry = { root, parts: { line, bg: null, text: null }, lod, transforms: 'position', textHidden }
		if (lod === 0 && route?.label) addLabel(ctx, entry, item, route)
		return entry
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item connector WireItem (new state)
	 * @param {object|null} route its route
	 * @param {Set<string>} fields changed fields
	 * @return {boolean} true = rebuild
	 */
	update(ctx, entry, item, route, fields) {
		if (fields.has('type')) {
			return true
		}
		connector.place(ctx, entry, item, route)
		return false
	},

	/**
	 * Re-draws the route: line attributes, label parts (LOD 0 with a label).
	 *
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item connector WireItem
	 * @param {object|null} route its route
	 */
	place(ctx, entry, item, route) {
		entry.parts.line.setAttrs(lineAttrs(item, route))
		if (entry.lod === 0 && route?.label) {
			if (entry.parts.text) {
				const a = labelAttrs(item, route)
				entry.parts.bg.setAttrs(a.bg)
				entry.parts.text.setAttrs(a.text)
				settleLabelText(entry.parts.text, route.label)
			} else {
				addLabel(ctx, entry, item, route)
			}
		} else if (entry.parts.text) {
			removeLabel(entry)
		}
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item connector WireItem
	 * @param {object|null} route its route
	 * @param {0|1} lod new level of detail
	 */
	setLod(ctx, entry, item, route, lod) {
		entry.lod = lod
		connector.place(ctx, entry, item, route)
	},

	/**
	 * @param {object} entry node entry
	 * @param {boolean} hidden true while the label editor is open
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = hidden
		entry.parts.bg?.visible(!hidden)
		entry.parts.text?.visible(!hidden)
	},
}
