/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The shell's part of emoji reactions (factory job 172), pure so the rules
 * can be checked in Node: the keys of the quick row (ReactionPicker.vue),
 * where a popover goes at a screen box (picker, names, list), and the line
 * of a name ("{name} (you)" for the own one).
 */
import { t } from '../util/l10n.js'

/** Distance of a popover from the box it opens at (px). */
export const REACT_POP_GAP = 6
/** Least distance of a popover from the board's edges (px). */
export const REACT_POP_MARGIN = 8

/**
 * The quick row's keys: the arrows wander (wrapping), Home and End jump.
 * Enter and Space are the buttons' own.
 *
 * @param {string} key KeyboardEvent.key
 * @param {number} index the focused button (-1: none)
 * @param {number} count buttons in the row
 * @return {number|null} the button to focus, null for any other key
 */
export function quickKey(key, index, count) {
	if (!(count > 0)) {
		return null
	}
	const i = index >= 0 && index < count ? index : -1
	switch (key) {
	case 'ArrowRight':
	case 'ArrowDown':
		return i < 0 ? 0 : (i + 1) % count
	case 'ArrowLeft':
	case 'ArrowUp':
		return i < 0 ? count - 1 : (i - 1 + count) % count
	case 'Home':
		return 0
	case 'End':
		return count - 1
	default:
		return null
	}
}

/**
 * Where a popover goes (its top-left corner, board px): below the box,
 * left aligned with it; above it when it does not fit below but does
 * above; pushed into the board with REACT_POP_MARGIN. Without a box: the
 * board's centre.
 *
 * @param {{x:number, y:number, w:number, h:number}|null} rect the box (board px)
 * @param {{w:number, h:number}|null} size the popover (null before it is measured: 0 × 0)
 * @param {{w:number, h:number}|null} board the board (null: no clamping)
 * @return {{x:number, y:number}}
 */
export function popoverPlace(rect, size, board) {
	const w = size?.w ?? 0
	const h = size?.h ?? 0
	if (!rect) {
		return { x: Math.max(0, ((board?.w ?? 0) - w) / 2), y: Math.max(0, ((board?.h ?? 0) - h) / 2) }
	}
	let x = rect.x
	let y = rect.y + rect.h + REACT_POP_GAP
	if (board) {
		const below = y + h <= board.h - REACT_POP_MARGIN
		const above = rect.y - REACT_POP_GAP - h >= REACT_POP_MARGIN
		if (!below && above) {
			y = rect.y - REACT_POP_GAP - h
		}
		x = Math.min(Math.max(x, REACT_POP_MARGIN), Math.max(REACT_POP_MARGIN, board.w - w - REACT_POP_MARGIN))
		y = Math.min(Math.max(y, REACT_POP_MARGIN), Math.max(REACT_POP_MARGIN, board.h - h - REACT_POP_MARGIN))
	}
	return { x, y }
}

/**
 * @param {{name: string, mine: boolean}} p one person of a reaction
 * @return {string} the name, the own one as "{name} (you)"
 */
export function nameLine(p) {
	return p.mine ? t('knorke', '{name} (you)', { name: p.name }) : p.name
}
