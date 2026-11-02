/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Note pad node (factory job 188, model/pad.js); job 263 (redesign round 4,
 * B4): the box is the top sheet, in style.fill with the corners of a note;
 * PAD_SHEETS sheets lie behind it, each PAD_SHEET_OFFSET lower, in the same
 * fill. Every sheet and the box have a fine edge in the strong tone at
 * PAD_EDGE_ALPHA; only the bottom sheet casts the note shadow (shade.js,
 * LOD 0, no dog ear). On top of the box lies the binding (padLayout) in the
 * frame tab tone of the fill with rounded top corners, a line below it
 * (strong tone at PAD_BIND_LINE_ALPHA) and the dashed tear line (strong tone
 * at PAD_TEAR_ALPHA). The title stands on the binding in one bold line,
 * left, in frameTabText of the tab tone, cut with "…". Fill and title are
 * read through fieldValue (SPEC-M1 §6.2 R8). The strong tone is
 * noteStrongTone (white: gray's), black: PAD_STRONG_BLACK.
 *
 * LOD 1 (scale < LOD_TEXT_SCALE): no title text and no shadow (built when
 * the scene zooms back in, like a note's text). LOD 2 paints a box in the
 * fill (nodes/coarse.js). The renderer places the root at the box; the
 * sheets reach below it, inside the item's index box (rbush padding 'band').
 */
import { padLayout } from '../../model/pad.js'
import { fieldValue } from '../../model/registry.js'
import {
	FONT_FAMILY, PAD_BIND_LINE_ALPHA, PAD_EDGE_ALPHA, PAD_SHEET_OFFSET, PAD_SHEETS, PAD_STRONG_BLACK, PAD_TEAR_ALPHA, PAD_TEAR_DASH,
	STICKY_RADIUS, frameTabFill, frameTabText, noteStrongTone, shownColor, withAlpha,
} from '../../model/tokens.js'
import { paintShade } from './shade.js'
import { SHAPE_BASE, makeGroup, place, positive, str } from './common.js'

/**
 * (Job 263) The colours of a pad from its fill.
 *
 * @param {object} item WireItem
 * @return {{fill: string, tab: string, title: string, edge: string, line: string, tear: string}} its tones
 */
export function padLook(item) {
	const fill = shownColor(fieldValue(item, 'style.fill'))
	const tab = frameTabFill(fill)
	const strong = noteStrongTone(fill) ?? PAD_STRONG_BLACK
	return {
		fill,
		tab,
		title: frameTabText(tab),
		edge: withAlpha(strong, PAD_EDGE_ALPHA),
		line: withAlpha(strong, PAD_BIND_LINE_ALPHA),
		tear: withAlpha(strong, PAD_TEAR_ALPHA),
	}
}

/**
 * @param {{w:number, h:number}} abs absolute box
 * @return {object} attributes of the title (place and size)
 */
function titleAttrs(abs) {
	const l = padLayout(abs.w, abs.h)
	return { x: l.pad, y: 0, width: positive(abs.w - 2 * l.pad), height: l.bind, fontSize: l.font }
}

/**
 * @param {object} ctx builder context ({Text})
 * @param {object} entry node entry
 * @param {object} item WireItem
 * @param {{w:number, h:number}} abs absolute box
 */
function addTitle(ctx, entry, item, abs) {
	const title = new ctx.Text({
		...SHAPE_BASE,
		...titleAttrs(abs),
		text: str(fieldValue(item, 'data.title')),
		fontFamily: FONT_FAMILY,
		fontStyle: 'bold',
		fill: padLook(item).title,
		align: 'left',
		verticalAlign: 'middle',
		wrap: 'none',
		ellipsis: true,
		padding: 0,
		visible: !entry.textHidden,
	})
	title.transformsEnabled('position')
	entry.root.add(title)
	entry.parts.text = title
}

/**
 * @param {{w:number, h:number}} abs absolute box
 * @param {number} i sheet, 1 = the one right behind the box
 * @return {{x:number, y:number, width:number, height:number}} its attributes
 */
function sheetAttrs(abs, i) {
	return { x: 0, y: i * PAD_SHEET_OFFSET, width: abs.w, height: abs.h }
}

/**
 * @param {{w:number, h:number}} abs absolute box
 * @return {{band: object, line: object, tear: object}} attributes of the binding, its line and the tear line
 */
function topAttrs(abs) {
	const l = padLayout(abs.w, abs.h)
	const r = Math.min(STICKY_RADIUS, l.bind, abs.w / 2)
	return {
		band: { x: 0, y: 0, width: abs.w, height: l.bind, cornerRadius: [r, r, 0, 0] },
		line: { points: [0, l.bind, abs.w, l.bind] },
		tear: { points: [l.tearX0, l.tear, l.tearX1, l.tear] },
	}
}

export const pad = {
	/**
	 * @param {object} ctx builder context
	 * @param {object} item WireItem
	 * @param {object} abs absolute box
	 * @param {0|1} lod level of detail
	 * @param {boolean} [textHidden] the title is being edited
	 * @return {object} entry
	 */
	build(ctx, item, abs, lod, textHidden = false) {
		const root = makeGroup(ctx)
		const look = padLook(item)
		const sheets = []
		for (let i = PAD_SHEETS; i >= 1; i--) {
			const sheet = new ctx.Rect({
				...SHAPE_BASE,
				...sheetAttrs(abs, i),
				fill: look.fill,
				stroke: look.edge,
				strokeWidth: 1,
				cornerRadius: STICKY_RADIUS,
				shadowForStrokeEnabled: false,
			})
			sheet.transformsEnabled('position')
			sheets.push(sheet)
		}
		let shade = null
		if (ctx.shadows) {
			// the note shadow (LOD 0 only) under the bottom sheet, painted by shade.js
			shade = new ctx.Shape({
				...SHAPE_BASE,
				x: 0,
				y: PAD_SHEETS * PAD_SHEET_OFFSET,
				visible: lod === 0,
				sceneFunc: (context) => paintShade(context, body.width(), body.height(), 0, 0),
			})
			shade.transformsEnabled('position')
		}
		const body = new ctx.Rect({
			...SHAPE_BASE,
			width: abs.w,
			height: abs.h,
			fill: look.fill,
			stroke: look.edge,
			strokeWidth: 1,
			cornerRadius: STICKY_RADIUS,
			shadowForStrokeEnabled: false,
		})
		body.transformsEnabled('position')
		const t = topAttrs(abs)
		const band = new ctx.Rect({ ...SHAPE_BASE, ...t.band, fill: look.tab })
		band.transformsEnabled('position')
		const line = new ctx.Line({ ...SHAPE_BASE, ...t.line, stroke: look.line, strokeWidth: 1 })
		line.transformsEnabled('position')
		const tear = new ctx.Line({ ...SHAPE_BASE, ...t.tear, stroke: look.tear, strokeWidth: 1, dash: [...PAD_TEAR_DASH] })
		tear.transformsEnabled('position')
		if (shade) root.add(shade)
		root.add(...sheets, body, band, line, tear)
		const entry = { root, parts: { shade, sheets, body, band, line, tear, text: null }, lod, transforms: null, textHidden }
		if (lod === 0) {
			addTitle(ctx, entry, item, abs)
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
		const { sheets, body, band, line, tear, text } = entry.parts
		if (fields.has('geom')) {
			sheets.forEach((sheet, k) => sheet.setAttrs(sheetAttrs(abs, sheets.length - k)))
			body.setAttrs({ width: abs.w, height: abs.h })
			const t = topAttrs(abs)
			band.setAttrs(t.band)
			line.setAttrs(t.line)
			tear.setAttrs(t.tear)
			text?.setAttrs(titleAttrs(abs))
		}
		if (fields.has('style')) {
			const look = padLook(item)
			for (const sheet of sheets) sheet.setAttrs({ fill: look.fill, stroke: look.edge })
			body.setAttrs({ fill: look.fill, stroke: look.edge })
			band.setAttrs({ fill: look.tab })
			line.setAttrs({ stroke: look.line })
			tear.setAttrs({ stroke: look.tear })
			text?.setAttrs({ fill: look.title })
		}
		if (text && fields.has('text')) {
			text.text(str(fieldValue(item, 'data.title')))
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
		entry.parts.shade?.visible(lod === 0)
		const text = entry.parts.text
		if (lod === 0) {
			if (!text) {
				addTitle(ctx, entry, item, abs)
			} else if (!entry.textHidden) {
				text.visible(true)
			}
		} else if (text) {
			text.visible(false)
		}
	},

	/**
	 * @param {object} entry node entry
	 * @param {boolean} hidden true while the title editor is open
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = hidden
		if (entry.parts.text) {
			entry.parts.text.visible(!hidden && entry.lod === 0)
		}
	},
}
