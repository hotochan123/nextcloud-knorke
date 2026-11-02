/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 194) The labels of the snapping, like Miro: the distance of a gap
 * marker or a measuring line, and the size "240 × 180" of a resize. One Konva
 * group per label in the renderer's uiGroup: a filled rectangle in
 * SNAP_LABEL_FILL with the white text on it, laid out in screen px (the
 * renderer scales the group by 1 / scale, so the label keeps its screen size
 * at every zoom). Digits and "×" only, never markup; it is no control.
 * place says where the label lies at its anchor point (world):
 * - 'below': centred under the point, SNAP_LABEL_OFFSET_PX lower (the middle of a horizontal line)
 * - 'right': vertically centred, SNAP_LABEL_OFFSET_PX right of the point (the middle of a vertical line)
 * - 'corner': its right edge on the point, SIZE_LABEL_GAP_PX lower (the bottom right corner of the
 *   drawn selection frame, clear of the corner handle)
 */
import {
	FONT_FAMILY, SIZE_LABEL_GAP_PX, SNAP_LABEL_FILL, SNAP_LABEL_FONT_PX, SNAP_LABEL_OFFSET_PX, SNAP_LABEL_PAD_X,
	SNAP_LABEL_PAD_Y, SNAP_LABEL_RADIUS, SNAP_LABEL_TEXT,
} from '../../model/tokens.js'
import { SHAPE_BASE } from './common.js'

/**
 * @typedef {{text:string, x:number, y:number, place:('below'|'right'|'corner')}} SnapLabel
 *   a label: its text and its anchor point (world)
 */

/**
 * @param {object} ctx builder context ({Group, Rect, Text})
 * @param {string} name node name (knorke-snap-label, knorke-size-label)
 * @return {object} the label's Konva group (rectangle, text), not yet placed
 */
export function buildSnapLabel(ctx, name) {
	const group = new ctx.Group({ name, listening: false })
	group.add(new ctx.Rect({ ...SHAPE_BASE, fill: SNAP_LABEL_FILL, cornerRadius: SNAP_LABEL_RADIUS }))
	group.add(new ctx.Text({
		...SHAPE_BASE,
		x: SNAP_LABEL_PAD_X,
		y: SNAP_LABEL_PAD_Y,
		fontSize: SNAP_LABEL_FONT_PX,
		fontFamily: FONT_FAMILY,
		fontStyle: 'bold',
		fill: SNAP_LABEL_TEXT,
		lineHeight: 1,
		wrap: 'none',
	}))
	return group
}

/**
 * @param {number} textW width of the text (screen px)
 * @return {{w:number, h:number}} the size of a label (screen px)
 */
export function snapLabelSize(textW) {
	return { w: textW + 2 * SNAP_LABEL_PAD_X, h: SNAP_LABEL_FONT_PX + 2 * SNAP_LABEL_PAD_Y }
}

/**
 * The top-left corner of a label (world) for its anchor, its size and the scale.
 *
 * @param {SnapLabel} label label
 * @param {{w:number, h:number}} size its size (screen px, snapLabelSize)
 * @param {number} scale camera scale (not finite or ≤ 0: 1)
 * @return {{x:number, y:number}}
 */
export function snapLabelPos(label, size, scale) {
	const s = Number.isFinite(scale) && scale > 0 ? scale : 1
	if (label.place === 'right') return { x: label.x + SNAP_LABEL_OFFSET_PX / s, y: label.y - size.h / 2 / s }
	if (label.place === 'corner') return { x: label.x - size.w / s, y: label.y + SIZE_LABEL_GAP_PX / s }
	return { x: label.x - size.w / 2 / s, y: label.y + SNAP_LABEL_OFFSET_PX / s }
}

/**
 * Sets the text of a label group and places it for the scale.
 *
 * @param {object} group the label's group (buildSnapLabel)
 * @param {SnapLabel} label label
 * @param {number} scale camera scale
 */
export function placeSnapLabel(group, label, scale) {
	const s = Number.isFinite(scale) && scale > 0 ? scale : 1
	const [rect, text] = group.getChildren()
	if (text.text() !== label.text) text.text(label.text)
	const size = snapLabelSize(text.width())
	rect.setAttrs({ width: size.w, height: size.h })
	group.setAttrs({ ...snapLabelPos(label, size, s), scaleX: 1 / s, scaleY: 1 / s })
}
