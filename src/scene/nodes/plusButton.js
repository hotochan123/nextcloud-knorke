/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (Job 262, design round 4 R4) The "+" buttons of tables (table-col,
 * table-row), frames with lanes (lane-add, col-add) and mind maps (mm-*): a
 * STRUCT_PLUS_PX circle in the selection colour with a white ring and a
 * white plus; "+ Lane" is a pill of the same height with its word instead of
 * the plus. Sizes in screen px; the renderer draws them in the uiGroup
 * (world units), so drawStructPlus takes the world size of one screen px.
 */
import { boldLineWidth } from '../../model/text.js'
import {
	FONT_FAMILY, HANDLE_STROKE_PX, STRUCT_PLUS_BAR_PX, STRUCT_PLUS_FONT_PX, STRUCT_PLUS_PAD_X, STRUCT_PLUS_PX,
} from '../../model/tokens.js'
import { t } from '../../util/l10n.js'

/**
 * @param {unknown} name handle name
 * @return {boolean} a "+" button of a table, a frame with lanes or a mind map
 */
export function isStructPlus(name) {
	return typeof name === 'string' && (name.startsWith('table-') || name.startsWith('mm-') || name === 'lane-add' || name === 'col-add')
}

/**
 * @param {string} name handle name
 * @return {string} the word of the button ('' for a round "+")
 */
export function structPlusLabel(name) {
	return name === 'lane-add' ? t('knorke', '+ Lane') : ''
}

/**
 * The size of a "+" button in screen px: a STRUCT_PLUS_PX circle, the pill
 * of a labelled one as wide as its word (bold, estimated per glyph) plus
 * STRUCT_PLUS_PAD_X on both sides.
 *
 * @param {string} name handle name
 * @return {{w: number, h: number, label: string}}
 */
export function structPlusSize(name) {
	const label = structPlusLabel(name)
	const w = label === '' ? STRUCT_PLUS_PX : Math.max(STRUCT_PLUS_PX, Math.ceil(boldLineWidth(label, STRUCT_PLUS_FONT_PX)) + 2 * STRUCT_PLUS_PAD_X)
	return { w, h: STRUCT_PLUS_PX, label }
}

/**
 * Whether a point lies on a "+" button: a mouse within the circle (radius
 * STRUCT_PLUS_PX / 2) or, for a pill, within its rectangle plus 2 px.
 *
 * @param {string} name handle name
 * @param {number} dx screen px from the button's centre
 * @param {number} dy screen px from the button's centre
 * @return {boolean}
 */
export function onStructPlus(name, dx, dy) {
	const s = structPlusSize(name)
	if (s.label !== '') return Math.abs(dx) <= s.w / 2 + 2 && Math.abs(dy) <= s.h / 2 + 2
	return Math.hypot(dx, dy) <= s.w / 2
}

/**
 * Paints a "+" button into the box (0, 0, w, h) of a Konva shape: the pill or
 * circle filled with fill and ringed in ring (HANDLE_STROKE_PX), then the
 * white plus or the word.
 *
 * @param {object} c Konva context
 * @param {{w: number, h: number, px: number, fill: string, ring: string, label: string}} b world box, world
 *   units per screen px, colours and word
 */
export function drawStructPlus(c, b) {
	const r = Math.min(b.w, b.h) / 2
	c.beginPath()
	c.moveTo(r, 0)
	c.lineTo(b.w - r, 0)
	c.arc(b.w - r, r, r, -Math.PI / 2, Math.PI / 2)
	c.lineTo(r, b.h)
	c.arc(r, r, r, Math.PI / 2, Math.PI * 1.5)
	c.closePath()
	c.setAttr('fillStyle', b.fill)
	c.fill()
	c.setAttr('strokeStyle', b.ring)
	c.setAttr('lineWidth', HANDLE_STROKE_PX * b.px)
	c.stroke()
	if (b.label !== '') {
		c.setAttr('fillStyle', b.ring)
		c.setAttr('font', `bold ${STRUCT_PLUS_FONT_PX * b.px}px ${FONT_FAMILY}`)
		c.setAttr('textAlign', 'center')
		c.setAttr('textBaseline', 'middle')
		c.fillText(b.label, b.w / 2, b.h / 2)
		return
	}
	const half = (STRUCT_PLUS_BAR_PX / 2) * b.px
	c.beginPath()
	c.moveTo(b.w / 2 - half, b.h / 2)
	c.lineTo(b.w / 2 + half, b.h / 2)
	c.moveTo(b.w / 2, b.h / 2 - half)
	c.lineTo(b.w / 2, b.h / 2 + half)
	c.setAttr('lineCap', 'round')
	c.stroke()
}
