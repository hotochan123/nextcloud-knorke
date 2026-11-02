/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 143) The hint "Add title…" above the one selected frame without a
 * title, in the renderer's uiGroup (the scene decides when it shows). A
 * fixed translated text through Konva, never markup; it is no control.
 *
 * (Job 243, design round 2 A2) It is a dashed tab on the frame's top left
 * edge where the tab of a title would stand: the open outline of
 * nodes/frame.js traceTabTop (no bottom edge, no fill), FRAME_TITLE_BAND
 * high and frameTabWidth of the hint's text wide, in
 * FRAME_TITLE_HINT_COLOR, FRAME_STROKE_WIDTH and FRAME_TITLE_HINT_DASH in
 * screen px (strokeScaleEnabled false); in it the text FRAME_TAB_PAD from
 * the left edge in the title's size, regular weight
 * (FRAME_TITLE_HINT_WEIGHT), the hint colour, one line, vertically
 * centred, cut with an ellipsis.
 */
import { t } from '../../util/l10n.js'
import {
	FONT_FAMILY, FRAME_RADIUS, FRAME_STROKE_WIDTH, FRAME_TAB_PAD, FRAME_TITLE_BAND, FRAME_TITLE_HINT_COLOR, FRAME_TITLE_HINT_DASH,
	FRAME_TITLE_HINT_WEIGHT, FRAME_TITLE_SIZE, frameTabWidth,
} from '../../model/tokens.js'
import { SHAPE_BASE, positive } from './common.js'
import { traceTabTop } from './frame.js'

/**
 * @param {{x:number, y:number, w:number}} abs the frame's absolute box
 * @param {number} textW width of the hint's text in one line (world units)
 * @return {{x:number, y:number, tabW:number, textW:number}} where the tab stands (its bottom left
 *   corner on the frame's top left corner), its width and the width its text may take
 */
export function titleHintBox(abs, textW) {
	const tabW = frameTabWidth(textW, abs.w)
	return { x: abs.x, y: abs.y, tabW, textW: tabW - 2 * FRAME_TAB_PAD }
}

/** @return {string} the hint's text (job 158: the scene measures it for the second click) */
export function titleHintText() {
	return t('knorke', 'Add title…')
}

/**
 * @param {object} ctx builder context ({Group, Shape, Text})
 * @return {{node: object, outline: object, text: object, box: object|null}} the hint: its group
 *   (name knorke-title-hint), its dashed outline and its text; placeTitleHint puts it on a frame
 */
export function buildTitleHint(ctx) {
	const hint = { node: null, outline: null, text: null, box: null }
	hint.node = new ctx.Group({ ...SHAPE_BASE, name: 'knorke-title-hint', opacity: 0 })
	hint.outline = new ctx.Shape({
		...SHAPE_BASE,
		stroke: FRAME_TITLE_HINT_COLOR,
		strokeWidth: FRAME_STROKE_WIDTH,
		strokeScaleEnabled: false,
		dash: [...FRAME_TITLE_HINT_DASH],
		sceneFunc: (c, shape) => {
			const b = hint.box
			if (!b || !(b.tabW > 0)) return
			c.beginPath()
			c.moveTo(0, 0)
			traceTabTop(c, b.tabW, FRAME_RADIUS)
			c.strokeShape(shape)
		},
	})
	hint.text = new ctx.Text({
		...SHAPE_BASE,
		x: FRAME_TAB_PAD,
		y: -FRAME_TITLE_BAND,
		width: 1,
		height: FRAME_TITLE_BAND,
		text: titleHintText(),
		fontSize: FRAME_TITLE_SIZE,
		fontStyle: FRAME_TITLE_HINT_WEIGHT,
		fontFamily: FONT_FAMILY,
		fill: FRAME_TITLE_HINT_COLOR,
		verticalAlign: 'middle',
		wrap: 'none',
		ellipsis: true,
	})
	hint.node.add(hint.outline)
	hint.node.add(hint.text)
	return hint
}

/**
 * Puts the hint on a frame, or hides it (abs null).
 *
 * @param {ReturnType<typeof buildTitleHint>} hint the hint
 * @param {{x:number, y:number, w:number}|null} abs the frame's absolute box; null: hidden
 * @param {number} textW width of the hint's text in one line (world units)
 * @return {boolean} something changed
 */
export function placeTitleHint(hint, abs, textW) {
	const b = abs ? titleHintBox(abs, textW) : null
	const was = hint.box
	const same = b === null ? was === null : was !== null && b.x === was.x && b.y === was.y && b.tabW === was.tabW
	if (same && hint.node.getAttr('opacity') === (b ? 1 : 0)) return false
	hint.box = b
	if (b) {
		hint.node.setAttrs({ x: b.x, y: b.y, opacity: 1 })
		hint.text.setAttrs({ width: positive(b.textW), visible: b.textW > 0 })
	} else {
		hint.node.setAttrs({ opacity: 0 })
	}
	return true
}
