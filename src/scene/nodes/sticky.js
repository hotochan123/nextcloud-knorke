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
 * the §3.10 default). The text color follows the fill (job 135,
 * tokens.noteTextColor): white on a dark custom color, else TEXT_COLOR; it is
 * set when the text is built and on every style update.
 *
 * LOD 1 (scale < LOD_TEXT_SCALE): no text, no shadow. Below LOD the text node
 * is not even built (measuring text is the most expensive part of building a
 * node); it is built when the scene zooms back in. A text node that already
 * exists is hidden with visible(false), as in the spike.
 *
 * (Job 191) Tags: ctx.tags is the board's tag map (model/tags.js tagMap,
 * the renderer's setTags). A note with a valid tag gets ONE tag shape above
 * its text (nodes/tags.js: labels at LOD 0, strokes at LOD 1), built when
 * the first tag comes; its text area (and the auto font size) ends
 * tagReserve above the bottom edge. update() renews the row for the fields
 * geom, data and 'tags' (the renderer's field for a change of the tag list).
 *
 * (Job 227) The fill is drawn through tokens.shownColor (an old palette
 * colour as its new tone); font size and drawn text come from
 * text.noteTextLayout (a long word split with a hyphen from S down).
 *
 * (Job 259, redesign round 3 N4 + N2c) Two shadows (shade.js), a fine edge
 * in the strong tone of the note's colour (tokens.noteStrongTone, at
 * NOTE_EDGE_OPACITY; none on black) that stays at LOD 1, and a dog ear at
 * the bottom right (tokens.noteEar): the body is a Konva.Shape whose
 * outline is cut there (notePath), the flap a Shape above it (paintEar:
 * its small shadow at LOD 0 with shadows on, the fill, the strong tone at
 * NOTE_EAR_TONE_OPACITY). The text area ends noteTextReserve above the
 * bottom (tags.js): clear of the flap without tags, above the tag row with.
 *
 * (Job 279) The text part is nodes/richText.js makeText: the Konva.Text as
 * before, the rich shape for a text with Markdown marks (swapped on update).
 */
import { fieldValue } from '../../model/registry.js'
import { COVERED_FILL, isCovered } from '../../model/privateWriting.js'
import { noteTextLayout } from '../../model/text.js'
import {
	FONT_FAMILY, NOTE_EAR_SHADOW, NOTE_EAR_TONE_OPACITY, NOTE_EDGE_OPACITY, NOTE_EDGE_WIDTH, NOTE_LINE_HEIGHT, STICKY_PADDING, STICKY_RADIUS,
	noteEar, noteStrongTone, noteTextColor, shownColor, withAlpha,
} from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'
import { makeText, setText } from './richText.js'
import { paintShade } from './shade.js'
import { buildTagShape, noteTextReserve, tagRowPlan } from './tags.js'

/**
 * (Job 227) The fill a note is drawn in: an old palette colour as its new tone.
 *
 * @param {object} item WireItem
 * @return {unknown} #rrggbb
 */
function fillOf(item) {
	// job 275: a covered note (private writing) is a grey card
	return isCovered(item) ? COVERED_FILL : shownColor(fieldValue(item, 'style.fill'))
}

/**
 * (Job 259) The outline of a w × h note: a rounded rectangle (STICKY_RADIUS,
 * as far as the size allows) cut at the bottom right by a straight edge
 * from (w, h − ear) to (w − ear, h).
 *
 * @param {object} c 2D context (Konva.Context)
 * @param {number} w width
 * @param {number} h height
 * @param {number} ear the dog ear's leg (tokens.noteEar), 0 = none
 */
export function notePath(c, w, h, ear) {
	const r = Math.min(STICKY_RADIUS, w / 2, h / 2)
	const e = ear > 0 ? Math.min(ear, w - r, h - r) : 0
	c.beginPath()
	c.moveTo(r, 0)
	c.arcTo(w, 0, w, h, r)
	if (e > 0) {
		c.lineTo(w, h - e)
		c.lineTo(w - e, h)
	} else {
		c.arcTo(w, h, 0, h, r)
	}
	c.arcTo(0, h, 0, 0, r)
	c.arcTo(0, 0, w, 0, r)
	c.closePath()
}

/**
 * (Job 259) Paints the dog-ear flap of a w × h note: the triangle (w, h − e),
 * (w − e, h − e + 2), (w − e, h); first its small shadow (moved down by
 * NOTE_EAR_SHADOW.y, black, no shadowBlur) when shadow is set, then the
 * fill, then the strong tone over it (none when tone is null).
 *
 * @param {object} c 2D context (Konva.Context)
 * @param {number} w width
 * @param {number} h height
 * @param {{fill: string, tone: (string|null)}} look the note's fill and strong tone
 * @param {boolean} shadow paint the flap's shadow
 * @return {number} fills painted
 */
export function paintEar(c, w, h, look, shadow) {
	const e = noteEar(w, h)
	if (!(e > 0)) return 0
	const tri = (dy) => {
		c.beginPath()
		c.moveTo(w, h - e + dy)
		c.lineTo(w - e, h - e + 2 + dy)
		c.lineTo(w - e, h + dy)
		c.closePath()
	}
	let n = 0
	if (shadow) {
		tri(NOTE_EAR_SHADOW.y)
		c.fillStyle = `rgba(0,0,0,${NOTE_EAR_SHADOW.opacity})`
		c.fill()
		n++
	}
	tri(0)
	c.fillStyle = look.fill
	c.fill()
	n++
	if (look.tone) {
		c.fillStyle = withAlpha(look.tone, NOTE_EAR_TONE_OPACITY)
		c.fill()
		n++
	}
	return n
}

/**
 * (Job 259) The edge colour of a note: its strong tone at NOTE_EDGE_OPACITY.
 *
 * @param {object} item WireItem
 * @return {string|null} rgba(), null on black
 */
function edgeOf(item) {
	const tone = noteStrongTone(fillOf(item))
	return tone ? withAlpha(tone, NOTE_EDGE_OPACITY) : null
}

/**
 * @param {object} item WireItem
 * @return {{fill: string, tone: (string|null)}} what paintEar needs
 */
function earLookOf(item) {
	const fill = fillOf(item)
	return { fill, tone: noteStrongTone(fill) }
}

/**
 * (Job 227) Font size and drawn text of a note (model/text.js noteTextLayout
 * over the text the note shows).
 *
 * @param {object} item WireItem
 * @param {number} p inner padding
 * @param {number} reserve tag band at the bottom
 * @return {{fontSize: number, text: string}}
 */
function layoutOf(item, p, reserve) {
	const text = str(fieldValue(item, 'data.text'))
	return noteTextLayout({ ...item, data: { ...item.data, text } }, p, reserve)
}

/**
 * @param {object} ctx builder context ({Group, Rect, Text, shadows})
 * @param {object} entry node entry
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 */
function addText(ctx, entry, item, abs) {
	const p = STICKY_PADDING
	const reserve = noteTextReserve(item, ctx.tags, abs.w, abs.h)
	const text = makeText(ctx, {
		x: p,
		y: p,
		width: positive(abs.w - 2 * p),
		height: positive(abs.h - 2 * p - reserve),
		...layoutOf(item, p, reserve),
		fontFamily: FONT_FAMILY,
		fill: noteTextColor(fillOf(item)),
		align: 'center',
		verticalAlign: 'middle',
		wrap: 'word',
		ellipsis: true,
		lineHeight: NOTE_LINE_HEIGHT,
		visible: !entry.textHidden,
	})
	entry.root.add(text)
	entry.parts.text = text
	// the tag row stays above the text
	entry.parts.tags?.moveToTop()
}

/**
 * (Job 191) Renews the tag row of a note; the shape is built with the first tag.
 *
 * @param {object} ctx builder context (tags: the board's tag map)
 * @param {object} entry node entry
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 */
function syncTags(ctx, entry, item, abs) {
	entry.tagPlan = tagRowPlan(item, ctx.tags, abs.w, abs.h)
	if (entry.tagPlan !== null && !entry.parts.tags) {
		entry.parts.tags = buildTagShape(ctx, entry)
		entry.root.add(entry.parts.tags)
	}
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
		const edge = edgeOf(item)
		const body = new ctx.Shape({
			...SHAPE_BASE,
			width: abs.w,
			height: abs.h,
			fill: fillOf(item),
			stroke: edge,
			strokeWidth: NOTE_EDGE_WIDTH,
			strokeEnabled: edge !== null,
			shadowForStrokeEnabled: false,
			sceneFunc: (context, shape) => {
				notePath(context, shape.width(), shape.height(), noteEar(shape.width(), shape.height()))
				context.fillStrokeShape(shape)
			},
		})
		body.transformsEnabled('position')
		const entry = { root, parts: { body, ear: null, text: null, shade: null, tags: null }, lod, transforms: null, textHidden, tagPlan: null, earLook: earLookOf(item) }
		const ear = new ctx.Shape({
			...SHAPE_BASE,
			sceneFunc: (context) => paintEar(context, body.width(), body.height(), entry.earLook, entry.lod === 0 && ctx.shadows === true),
		})
		ear.transformsEnabled('position')
		entry.parts.ear = ear
		if (ctx.shadows) {
			// the drop shadow (LOD 0 only) is painted by shade.js, below the body
			const shade = new ctx.Shape({
				...SHAPE_BASE,
				visible: lod === 0,
				sceneFunc: (context) => paintShade(context, body.width(), body.height(), root.rotation(), noteEar(body.width(), body.height())),
			})
			shade.transformsEnabled('position')
			root.add(shade)
			entry.parts.shade = shade
		}
		root.add(body)
		root.add(ear)
		if (lod === 0) {
			addText(ctx, entry, item, abs)
		}
		syncTags(ctx, entry, item, abs)
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
		if (fields.has('style') || fields.has('data')) {
			// data too: the reveal of a covered note (job 275) may leave style {} as it was
			const edge = edgeOf(item)
			body.setAttrs({ fill: fillOf(item), stroke: edge, strokeEnabled: edge !== null })
			entry.earLook = earLookOf(item)
		}
		if (fields.has('geom') || fields.has('data') || fields.has('tags')) {
			syncTags(ctx, entry, item, abs)
		}
		if (text && (fields.has('geom') || fields.has('style') || fields.has('text') || fields.has('data') || fields.has('tags'))) {
			const p = STICKY_PADDING
			const reserve = noteTextReserve(item, ctx.tags, abs.w, abs.h)
			// job 279: a text that gains or loses its Markdown marks swaps the node
			entry.parts.text = setText(ctx, text, {
				width: positive(abs.w - 2 * p),
				height: positive(abs.h - 2 * p - reserve),
				...layoutOf(item, p, reserve),
				fill: noteTextColor(fillOf(item)),
			})
			entry.parts.tags?.moveToTop()
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
