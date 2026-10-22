/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Focus after clicks on bar buttons (SPEC-M1 §6.5.1, R2; WCAG 2.1.4): single
 * keys (V, N, S, T, arrows, Del) work only while the canvas has the focus.
 * When a button of the toolbar, the context bar or the zoom controls is
 * triggered with a POINTER, the shell puts the focus back on the canvas
 * (scene.focusCanvas()); a keyboard user keeps the focus on the button.
 *
 * Pointer = event.detail > 0 (a click from a mouse, pen or touch counts its
 * clicks; Enter/Space on a button gives 0) or a pointerType. A `change` of a
 * radio in a menu has neither, so a pointerdown shortly before counts too
 * (pointerRecently, fed by a capturing pointerdown listener of the view).
 */

/** A pointerdown this recent turns a change/selection into a pointer action. */
export const POINTER_RECENT_MS = 800

let lastPointerDown = -Infinity

/**
 * Records a pointerdown (BoardView installs this as a capturing listener).
 *
 * @param {number} [now] ms (tests)
 */
export function notePointerDown(now = Date.now()) {
	lastPointerDown = now
}

/**
 * @param {number} [now] ms (tests)
 * @return {boolean} a pointerdown happened within POINTER_RECENT_MS
 */
export function pointerRecently(now = Date.now()) {
	return now - lastPointerDown <= POINTER_RECENT_MS
}

/**
 * @param {Event|object|null|undefined} e the event of the activation
 * @param {number} [now] ms (tests)
 * @return {boolean} it came from a pointer (mouse, pen, touch), not the keyboard
 */
export function isPointerActivation(e, now = Date.now()) {
	if (e && typeof e === 'object') {
		if (typeof e.pointerType === 'string' && e.pointerType !== '') {
			return true
		}
		if (typeof e.detail === 'number') {
			return e.detail > 0
		}
	}
	return pointerRecently(now)
}

/**
 * Gives the focus back to the canvas after a pointer activation.
 *
 * @param {Event|object|null|undefined} e activation event
 * @param {{focusCanvas?: Function}|null} session board session
 * @param {number} [now] ms (tests)
 * @return {boolean} the focus went to the canvas
 */
export function refocusAfter(e, session, now = Date.now()) {
	if (!session || typeof session.focusCanvas !== 'function' || !isPointerActivation(e, now)) {
		return false
	}
	session.focusCanvas()
	return true
}
