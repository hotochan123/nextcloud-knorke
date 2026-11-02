/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 226 (redesign foundation): what the shell sets up outside its
 * own DOM, once per app (App.vue, PublicApp.vue):
 * - <div id="knorke-menus" class="knorke-menus"> at the end of <body>, the
 *   container of Knorke's NcActions menus (their container prop), so
 *   knorke.css gives them the panel look without touching Nextcloud's own
 *   menus (the app menu's "More apps" is an NcActions, too);
 * - data-knorke-dark="b" on <body> while Nextcloud shows a dark theme
 *   (util/darkMode.js): read like NcVue's isDarkTheme, again when <body
 *   data-themes> or the system's colour scheme changes; gone when the app
 *   unmounts. Not NcVue's useIsDarkTheme: it reads the DOM on import, and
 *   the Node tests import the shell without one.
 */
import { onBeforeUnmount } from 'vue'
import { applyDarkMark, darkMark, isDarkTheme } from '../util/darkMode.js'

/** The selector of the menus' container (NcActions container="#knorke-menus"). */
export const MENUS = '#knorke-menus'

/** Sets up the menus' container and the dark mark; call in the app's setup. */
export function useTheme() {
	if (typeof document === 'undefined') {
		return
	}
	const body = document.body
	if (!document.getElementById('knorke-menus')) {
		const el = document.createElement('div')
		el.id = 'knorke-menus'
		el.className = 'knorke-menus'
		body.appendChild(el)
	}
	const update = () => applyDarkMark(body, darkMark(isDarkTheme(body), body.dataset.themes))
	update()
	const observer = new MutationObserver(update)
	observer.observe(body, { attributes: true, attributeFilter: ['data-themes'] })
	const scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
	scheme?.addEventListener?.('change', update)
	onBeforeUnmount(() => {
		observer.disconnect()
		scheme?.removeEventListener?.('change', update)
		applyDarkMark(body, null)
	})
}
