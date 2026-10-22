/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pure parts of the context menu (SPEC-M1 §6.6 ContextMenu.vue, §6.12;
 * stage 4, R19 T4-02), so the rules can be checked in Node:
 *
 * - Placement: the top left corner at canvas rect + `at`; when the menu does
 *   not fit, it is mirrored at that axis (it opens to the left of / above
 *   the point), then pushed into the bounds with an 8 px margin. The bounds
 *   are the viewport cut down to the board (the board clips what sticks
 *   out), so the menu always lies wholly inside the viewport. Its outer
 *   height is capped by the same bounds less the margin above and below, so
 *   it fits even a very low window and scrolls what does not fit.
 * - Keyboard (WAI-ARIA APG pattern "Menu"): ↓/↑ wrap around, Home/End,
 *   Enter/Space activate, Esc and Tab close. Every one of these keys is
 *   handled by the menu alone (preventDefault and stopPropagation: the
 *   scene's Esc would otherwise clear the selection); the context-menu key
 *   and Shift+F10 inside the open menu do nothing (no browser menu over it).
 * - Scroll range: noScrollRange tells whether the menu has nothing to scroll
 *   (no scrollbar, classic or overlay); only then does a press on its root
 *   (padding, gap above the count line, border) keep the focus on the
 *   active entry (ContextMenu.vue onRootDown).
 */

/** Distance of the menu from the edges of its bounds (px). */
export const MENU_MARGIN = 8

/**
 * @param {{left: number, top: number, right: number, bottom: number}} a rectangle
 * @param {{left: number, top: number, right: number, bottom: number}} b rectangle
 * @return {{left: number, top: number, right: number, bottom: number}} a ∩ b (may be empty)
 */
export function intersect(a, b) {
	return {
		left: Math.max(a.left, b.left),
		top: Math.max(a.top, b.top),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom),
	}
}

/**
 * One axis: start at the anchor, mirror when the far edge would cross the
 * bound, then clamp into [lo, hi − size] (lo wins when the menu is larger).
 *
 * @param {number} anchor anchor coordinate
 * @param {number} size menu extent on this axis
 * @param {number} lo lowest allowed start (margin included)
 * @param {number} hi highest allowed end (margin included)
 * @return {number} start coordinate
 */
function axis(anchor, size, lo, hi) {
	let p = anchor
	if (p + size > hi) {
		p = anchor - size
	}
	if (p + size > hi) {
		p = hi - size
	}
	if (p < lo) {
		p = lo
	}
	return p
}

/**
 * Where the menu goes (viewport px).
 *
 * @param {object} o input
 * @param {{left: number, top: number}} o.canvas canvas rect (getBoundingClientRect)
 * @param {number[]} o.at [x, y] of the intent, container px
 * @param {{width: number, height: number}} o.size menu size
 * @param {{left: number, top: number, right: number, bottom: number}} o.bounds board rect ∩ viewport
 * @param {number} [o.margin] distance from the bounds
 * @return {{x: number, y: number}} top left corner, viewport px
 */
export function placeMenu({ canvas, at, size, bounds, margin = MENU_MARGIN }) {
	const ax = canvas.left + at[0]
	const ay = canvas.top + at[1]
	return {
		x: axis(ax, size.width, bounds.left + margin, bounds.right - margin),
		y: axis(ay, size.height, bounds.top + margin, bounds.bottom - margin),
	}
}

/**
 * The tallest outer height of the menu (border box: content, padding,
 * border and a horizontal scrollbar) that placeMenu can still push into the
 * bounds with `margin` above and below, in whole px (rounded down, never too
 * large). Reads only bounds.top and bounds.bottom; a bound or margin that is
 * no finite number gives null (the CSS limit applies).
 *
 * @param {{top: number, bottom: number}|null|undefined} bounds board rect ∩ viewport, as for placeMenu
 * @param {number} [margin] distance from the bounds
 * @return {number|null} max(0, floor(bottom − top − 2 × margin)), or null
 */
export function menuMaxHeight(bounds, margin = MENU_MARGIN) {
	if (!bounds || typeof bounds !== 'object') {
		return null
	}
	const { top, bottom } = bounds
	if (![top, bottom, margin].every((v) => Number.isFinite(v))) {
		return null
	}
	return Math.max(0, Math.floor(bottom - top - 2 * margin))
}

/**
 * The menu has nothing to scroll on either axis, so it shows no scrollbar,
 * neither a classic nor an overlay one. A measure that is missing or no
 * finite number counts as "can scroll". Reads only these four properties.
 *
 * @param {{scrollWidth: number, scrollHeight: number, clientWidth: number, clientHeight: number}|null|undefined} el menu root
 * @return {boolean} scrollWidth ≤ clientWidth and scrollHeight ≤ clientHeight, all four finite
 */
export function noScrollRange(el) {
	if (!el || typeof el !== 'object') {
		return false
	}
	const { scrollWidth, scrollHeight, clientWidth, clientHeight } = el
	if (![scrollWidth, scrollHeight, clientWidth, clientHeight].every((v) => Number.isFinite(v))) {
		return false
	}
	return scrollWidth <= clientWidth && scrollHeight <= clientHeight
}

/**
 * What a key does in the open menu (APG "Menu").
 *
 * @param {{key: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} e keydown
 * @param {number} index focused entry
 * @param {number} count entries
 * @return {{handled: boolean, index?: number, activate?: boolean, close?: ('esc'|'tab')}}
 *   handled: the menu calls preventDefault and stopPropagation
 */
export function menuKey(e, index, count) {
	const n = Math.max(0, count)
	const i = Math.min(Math.max(0, index), Math.max(0, n - 1))
	switch (e.key) {
	case 'ArrowDown':
		return { handled: true, index: n === 0 ? 0 : (i + 1) % n }
	case 'ArrowUp':
		return { handled: true, index: n === 0 ? 0 : (i - 1 + n) % n }
	case 'Home':
		return { handled: true, index: 0 }
	case 'End':
		return { handled: true, index: Math.max(0, n - 1) }
	case 'Enter':
	case ' ':
	case 'Spacebar':
		return { handled: true, index: i, activate: n > 0 }
	case 'Escape':
	case 'Esc':
		return { handled: true, close: 'esc' }
	case 'Tab':
		return { handled: true, close: 'tab' }
	case 'ContextMenu':
		return { handled: true, index: i }
	case 'F10':
		return e.shiftKey ? { handled: true, index: i } : { handled: false }
	default:
		return { handled: false }
	}
}
