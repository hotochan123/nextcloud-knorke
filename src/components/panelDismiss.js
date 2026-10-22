/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Closing the context bar's panel (SPEC-M1 §6.6, R11, finding C-1b-02).
 *
 * The panel (.knorke-contextbar__panel) hangs below the bar over the canvas
 * and can cover the selected connector, so a double click on its line or a
 * press on an end handle would land on the panel. Rule:
 *
 * - A pointerdown on the canvas (.knorke-canvas, the scene's host, incl. its
 *   overlay) closes an open panel. The listener sits in the CAPTURE phase of
 *   the document (before the scene's own listeners, and even when one of
 *   them stops the propagation) and is PASSIVE: it never calls
 *   preventDefault or stopPropagation, so the press itself still reaches the
 *   scene and the first click of a double click is not swallowed.
 * - Presses on the bars, the panel itself or anything else outside the
 *   canvas leave the panel open.
 * - Esc inside the panel closes it and puts the focus on the toggle that
 *   opened it (the bar button with aria-controls = panel id and
 *   aria-expanded = "true"), so the focus does not fall to <body> when the
 *   panel leaves the DOM. Esc on a bar button closes the panel and keeps the
 *   focus where it is.
 * - Esc with the canvas focus (the target is the canvas host itself, not an
 *   element inside it such as the text editor) closes an open panel first:
 *   the usual case after a pointer click on a panel command, which gives the
 *   focus back to the canvas. The same with the focus on <body> (a click
 *   beside a button: the panel's padding, a label, the count). The listener
 *   sits in the CAPTURE phase of the document and stops that one key (no
 *   preventDefault), so neither the scene (window, clear the selection) nor
 *   the session (document bubble, end following) sees it; the selection
 *   stays. The next Esc goes on as before: with the canvas focus it clears
 *   the selection; on <body> a header menu of Nextcloud cancels it first
 *   for signed-in users, and the scene leaves it alone (InputController).
 *   Without an open panel, with Ctrl, ⌘ or Alt, or with another target it
 *   does nothing and stops nothing (Shift+Esc closes, as it clears the
 *   selection today).
 *
 * DOM-light on purpose (addEventListener, closest, matches, contains,
 * querySelectorAll, getAttribute), so the rules run in Node with a fake tree.
 */

/** The canvas host of the board view (SPEC-M1 §6.8, `.knorke-canvas[tabindex="0"]`). */
export const CANVAS_SELECTOR = '.knorke-canvas'

/**
 * @param {EventTarget|null|undefined} target event target
 * @return {boolean} the target is the canvas host or lies inside it
 */
export function isCanvasTarget(target) {
	return !!target && typeof target.closest === 'function' && target.closest(CANVAS_SELECTOR) !== null
}

/**
 * Calls close(e) on every pointerdown on the canvas, in the capture phase of
 * `root`; passive, never cancels or stops the event.
 *
 * @param {EventTarget} root where to listen (the document)
 * @param {(e: PointerEvent) => void} close closes the panel
 * @return {() => void} removes the listener
 */
export function closeOnCanvasPress(root, close) {
	const fn = (e) => {
		if (isCanvasTarget(e?.target)) {
			close(e)
		}
	}
	root.addEventListener('pointerdown', fn, { capture: true, passive: true })
	return () => root.removeEventListener('pointerdown', fn, { capture: true })
}

/**
 * Calls close(e) and stops the key when Esc arrives on the canvas host itself
 * or on <body> (root.body) while isOpen(); capture phase of `root`, never
 * preventDefault.
 *
 * @param {Document} root where to listen (the document)
 * @param {() => boolean} isOpen whether a panel is open (asked on every key)
 * @param {(e: KeyboardEvent) => void} close closes the panel
 * @return {() => void} removes the listener
 */
export function closeOnCanvasEscape(root, isOpen, close) {
	const fn = (e) => {
		const target = e?.target
		if (e?.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) {
			return
		}
		const onCanvas = !!target && typeof target.matches === 'function' && target.matches(CANVAS_SELECTOR)
		const onBody = !!target && target === root.body
		if (!(onCanvas || onBody) || !isOpen()) {
			return
		}
		e.stopPropagation()
		close(e)
	}
	root.addEventListener('keydown', fn, { capture: true })
	return () => root.removeEventListener('keydown', fn, { capture: true })
}

/**
 * Where the focus goes when Esc closes the panel.
 *
 * @param {Element|null|undefined} bar the context bar's root element
 * @param {EventTarget|null|undefined} target target of the Esc keydown
 * @param {string} panelId id of the panel element (aria-controls of its toggles)
 * @return {Element|null} the toggle of the open panel when the key came from
 *   inside the panel; null otherwise (focus stays)
 */
export function toggleForEscape(bar, target, panelId) {
	if (!bar || !target || typeof target.closest !== 'function' || typeof bar.querySelectorAll !== 'function') {
		return null
	}
	const panel = target.closest('#' + panelId)
	if (panel === null || !bar.contains(panel)) {
		return null
	}
	for (const el of bar.querySelectorAll('[aria-controls]')) {
		if (el.getAttribute('aria-controls') === panelId && el.getAttribute('aria-expanded') === 'true') {
			return el
		}
	}
	return null
}
