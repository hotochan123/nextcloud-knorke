/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The pure parts of the admin page (factory job 281, design A3): which
 * sections open on load, the one line under a closed section's title, and
 * the text of the save bar. AdminSettings.vue holds the state.
 */
import { n, t } from '../util/l10n.js'

/** The sections in page order. */
export const SECTIONS = Object.freeze(['templates', 'shapelibs', 'ai', 'privacy'])

/**
 * The sections to open once both lists have loaded: the first of templates
 * and shape libraries with open suggestions, and every list that failed.
 *
 * @param {{templates: {state: string, suggestions: number}, shapelibs: {state: string, suggestions: number}}} lists
 * @return {string[]|null} section ids, null while a list still loads
 */
export function initialOpen(lists) {
	const keys = ['templates', 'shapelibs']
	if (keys.some((k) => lists[k]?.state === 'loading')) {
		return null
	}
	const out = []
	const first = keys.find((k) => lists[k]?.state === 'ready' && lists[k].suggestions > 0)
	for (const k of keys) {
		if (k === first || lists[k]?.state === 'error') {
			out.push(k)
		}
	}
	return out
}

/**
 * @param {{state: string, suggestions: number, adopted: number}} list a list's load state and counts
 * @param {string} failed the list's load error sentence
 * @return {string} the line of a closed list section
 */
export function listSummary(list, failed) {
	if (list.state === 'loading') {
		return t('knorke', 'Loading …')
	}
	if (list.state === 'error') {
		return failed
	}
	if (list.suggestions === 0 && list.adopted === 0) {
		return t('knorke', 'No open suggestions · none adopted yet')
	}
	return n('knorke', '%n open suggestion', '%n open suggestions', list.suggestions) + ' · ' + n('knorke', '%n adopted', '%n adopted', list.adopted)
}

/**
 * @param {{text: string}} defaults the default of a notice form
 * @param {Array<{text: string}>} entries its languages
 * @return {boolean} the form has a text of its own
 */
export function ownText(defaults, entries) {
	return defaults.text.trim() !== '' || entries.some((e) => e.text.trim() !== '')
}

/**
 * @param {{provider: boolean, enabled: boolean, limit: number, ownNotice: boolean}} s the AI section's values
 * @return {string} the line of the closed AI section
 */
export function aiSummary(s) {
	const parts = []
	if (!s.provider) {
		parts.push(t('knorke', 'No AI provider set up'))
	}
	parts.push(s.enabled ? t('knorke', 'Allowed') : t('knorke', 'Not allowed'))
	parts.push(n('knorke', '%n task per account and day', '%n tasks per account and day', s.limit))
	parts.push(s.ownNotice ? t('knorke', 'Notice: own text') : t('knorke', 'Notice: built-in text'))
	return parts.join(' · ')
}

/**
 * @param {{ownText: boolean, languages: number, url: string, themingUrl: string}} s the privacy form's values
 * @return {string} the line of the closed privacy section
 */
export function privacySummary(s) {
	let text = s.ownText ? t('knorke', 'Own text') : t('knorke', 'Built-in text')
	if (s.languages > 0) {
		text += ', ' + n('knorke', '%n language', '%n languages', s.languages)
	}
	const url = s.url.trim() !== ''
		? t('knorke', 'Own address')
		: (s.themingUrl !== '' ? t('knorke', 'Address from the Theming settings') : t('knorke', 'No address'))
	return text + ' · ' + url
}

/**
 * @param {number} ai open errors in the AI section
 * @param {number} privacy open errors in the privacy section
 * @return {string} the text of the save bar
 */
export function barText(ai, privacy) {
	const parts = []
	if (ai > 0) {
		parts.push(n('knorke', '%n error in {section}', '%n errors in {section}', ai, { section: t('knorke', 'AI') }))
	}
	if (privacy > 0) {
		parts.push(n('knorke', '%n error in {section}', '%n errors in {section}', privacy, { section: t('knorke', 'Privacy notice') }))
	}
	return parts.length > 0 ? parts.join(' · ') : t('knorke', 'Unsaved changes')
}

/**
 * (Round 1) The element that scrolls the page: the nearest ancestor with
 * overflow-y auto or scroll (Nextcloud's #app-content-vue), else the
 * document's scrolling element.
 *
 * @param {Element|null} el the page's root
 * @param {(e: Element) => {overflowY: string}} [styleOf] getComputedStyle (tests)
 * @return {Element|null} the scrolling element
 */
export function scrollParent(el, styleOf = (e) => getComputedStyle(e)) {
	for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
		const o = styleOf(p).overflowY
		if (o === 'auto' || o === 'scroll') {
			return p
		}
	}
	return typeof document === 'undefined' ? null : document.scrollingElement
}

/**
 * (Round 1) Keeps what the browser scrolls into view (the caret while
 * typing, a focused field) above the sticky save bar: the scrolling
 * element gets a bottom scroll padding of the bar's height while the bar
 * shows, and loses it when the bar goes.
 *
 * @param {Element|null} scroller the scrolling element
 * @param {Element|null} bar the save bar, null while hidden
 */
export function padForBar(scroller, bar) {
	if (!scroller?.style) {
		return
	}
	scroller.style.scrollPaddingBottom = bar ? (bar.offsetHeight + 16) + 'px' : ''
}
