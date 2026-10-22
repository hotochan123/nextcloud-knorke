/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Where the vote stepper stands and what "Show on the board" keeps free
 * (SPEC-M1 §6.6 VoteStepper/VotePanel, §33.1 i, R22 P7-08 and P7-11), pure.
 *
 * Stepper (P7-08, CLIENT-5): centred at the item (horizontally at its
 * middle, vertically in its top part, at most 120 px down), clamped into
 * the board container: the centre stays at least half the stepper's width
 * + STEPPER_MARGIN_PX from each side edge, its top and bottom edge at least
 * STEPPER_MARGIN_PX inside. A container too small for that gets the
 * stepper in its middle. Before the stepper is measured it stands at the
 * item unclamped (the component measures right after mounting).
 *
 * "Show on the board" (P7-11, CLIENT-4): in the narrow layout the list is a
 * bottom sheet over the board, so a tap on a row text closes it first (it
 * opens again over the vote bar) and the item is shown on the free canvas.
 * With the side panel (wider layouts) the sheet stays and the screen px the
 * panel covers at the left or right edge of the board are kept free
 * (BoardSession.zoomToItem(id, {left, right})).
 */

/** Distance of the stepper from the edges of the board container (px). */
export const STEPPER_MARGIN_PX = 8
/** The stepper stands at most this far down the item (half of it). */
export const STEPPER_ITEM_TOP_PX = 120

/**
 * @param {number} want wanted centre on one axis
 * @param {number} own the stepper's size on that axis
 * @param {number} box the container's size on that axis
 * @return {number} whole px, kept inside [own/2 + margin, box − own/2 − margin]
 *   (bounds rounded inwards, so rounding never costs the margin half a pixel)
 */
function clampAxis(want, own, box) {
	const lo = Math.ceil(own / 2 + STEPPER_MARGIN_PX)
	const hi = Math.floor(box - own / 2 - STEPPER_MARGIN_PX)
	if (lo > hi) {
		return Math.round(box / 2)
	}
	return Math.min(hi, Math.max(lo, Math.round(want)))
}

/**
 * @param {unknown} v value
 * @return {boolean} a finite number ≥ 0
 */
const size = (v) => Number.isFinite(v) && v >= 0

/**
 * Centre of the vote stepper in container px (its CSS translate(-50%, -50%)
 * puts its middle there).
 *
 * @param {{x: number, y: number, w: number, h: number}|null} rect the item's screen rectangle (container px)
 * @param {{w: number, h: number, bw: number, bh: number}|null} measured the stepper (w, h) and the
 *   container (bw, bh) in px; null before the first measurement
 * @return {{x: number, y: number}|null} centre in whole px; null: no rect and nothing measured (CSS centre)
 */
export function stepperCentre(rect, measured) {
	const m = measured && size(measured.w) && size(measured.h) && size(measured.bw) && size(measured.bh) && measured.bw > 0 && measured.bh > 0 ? measured : null
	let x
	let y
	if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.w) && Number.isFinite(rect.h)) {
		x = rect.x + rect.w / 2
		y = rect.y + Math.min(Math.max(rect.h, 0), STEPPER_ITEM_TOP_PX) / 2
	} else if (m) {
		x = m.bw / 2
		y = m.bh / 2
	} else {
		return null
	}
	if (m) {
		return { x: clampAxis(x, m.w, m.bw), y: clampAxis(y, m.h, m.bh) }
	}
	return { x: Math.round(x), y: Math.round(y) }
}

/**
 * Screen px a side panel covers at the left and right edge of the board
 * (only a panel that touches one edge region counts; in RTL the panel
 * stands on the left).
 *
 * @param {{left: number, right: number, width: number}|null} board the board container's rectangle
 * @param {{left: number, right: number, width: number}|null} panel the panel's rectangle (null: none)
 * @return {{left: number, right: number}}
 */
export function panelReserve(board, panel) {
	const none = { left: 0, right: 0 }
	if (!board || !panel || !(board.width > 0) || !(panel.width > 0)) {
		return none
	}
	const left = Math.max(board.left, panel.left)
	const right = Math.min(board.right, panel.right)
	if (!(right > left)) {
		return none
	}
	const mid = board.left + board.width / 2
	// the panel's middle decides the edge it is docked to
	if ((panel.left + panel.right) / 2 >= mid) {
		return { left: 0, right: Math.round(board.right - left) }
	}
	return { left: Math.round(right - board.left), right: 0 }
}

/**
 * What a tap on a row text ("Show on the board") does before zoomToItem.
 *
 * @param {boolean} narrow the narrow layout (bottom sheet)
 * @param {{left: number, right: number, width: number}|null} board the board container's rectangle
 * @param {{left: number, right: number, width: number}|null} panel the panel's rectangle
 * @return {{closeSheet: boolean, reserve: {left: number, right: number}}}
 */
export function focusPlan(narrow, board, panel) {
	if (narrow) {
		return { closeSheet: true, reserve: { left: 0, right: 0 } }
	}
	return { closeSheet: false, reserve: panelReserve(board, panel) }
}
