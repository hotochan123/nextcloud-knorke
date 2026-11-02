/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 226 (redesign foundation, docs/redesign/ V13, variant b):
 * while Nextcloud shows a dark theme, <body> carries data-knorke-dark="b"
 * and knorke.css turns Knorke's bars, menus, panels and dialogs dark grey
 * (#2b2c30) with light text; the canvas stays light. Contrast themes keep
 * Nextcloud's own colours (no mark). No DOM besides the element it is
 * given, so the rules can be checked in Node.
 */

/** The attribute on <body>. */
export const DARK_ATTR = 'data-knorke-dark'

/**
 * Nextcloud's own test (NcVue isDarkTheme): its dark themes set
 * --background-invert-if-dark to invert(100%).
 *
 * @param {object} el the element (<body>)
 * @param {Function} [style] getComputedStyle
 * @return {boolean} a dark theme is shown
 */
export function isDarkTheme(el, style = globalThis.getComputedStyle) {
	return style(el).getPropertyValue('--background-invert-if-dark').trim() === 'invert(100%)'
}

/**
 * @param {boolean} dark Nextcloud shows a dark theme (NcVue isDarkTheme)
 * @param {string|undefined} themes <body data-themes>, e.g. "dark" or "dark-highcontrast"
 * @return {string|null} the mark ('b'), null for none
 */
export function darkMark(dark, themes) {
	return dark === true && !String(themes ?? '').includes('highcontrast') ? 'b' : null
}

/**
 * @param {object} el the element (<body>)
 * @param {string|null} mark darkMark's result
 */
export function applyDarkMark(el, mark) {
	if (mark === null) {
		el.removeAttribute(DARK_ATTR)
	} else {
		el.setAttribute(DARK_ATTR, mark)
	}
}
