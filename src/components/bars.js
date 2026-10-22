/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Layout rules of the board's bars (SPEC-M1 §6.6 narrow layout, R16 (1)–(6)),
 * pure.
 *
 * (1) Narrow layout = window width ≤ 600 CSS px (matchMedia NARROW_QUERY),
 *     whatever the pointer; "phone" in §6.6/§8.4 means exactly this layout.
 * (2) The VoteBar docks at the bottom in every layout (no banner strip).
 * (3) Banner strips stand at the top under the TopBar; in the narrow layout
 *     at most one. Precedence: final states/connection > FollowBanner/
 *     FollowChip > "Time's up" > vote_ready/device_vote/view_role; lower
 *     ones wait. bannerStrips() gives the order.
 * (4) At the start of a session the narrow layout opens the VotePanel as a
 *     bottom sheet at once.
 * Every bar carries [data-knorke-bar=top|banner|vote|timer|list].
 *
 * Also the plain-text ranking of "Copy results" (§6.6 VotePanel) and the
 * text excerpt of an item in lists.
 */

/** The narrow layout (R16 (1)). */
export const NARROW_QUERY = '(max-width: 600px)'
/** Characters of an item text in the vote list and the ranking. */
export const EXCERPT_CHARS = 80

/**
 * @param {object} o what wants to show
 * @param {string|null} o.status kind of the status banner (banner.js bannerFor(...).kind) or null
 * @param {boolean} o.follow following someone (FollowBanner)
 * @param {boolean} o.chip the chip "{name} is presenting · Follow"
 * @param {boolean} o.timeUp "Time's up"
 * @param {string|null} o.role role/device banner kind (mode.js bannerFor) or null
 * @param {boolean} o.frozen the board is frozen (no role banner then)
 * @param {boolean} narrow narrow layout
 * @return {string[]} strips to show, in order: 'status', 'follow', 'chip', 'time_up', 'role'
 */
export function bannerStrips({ status = null, follow = false, chip = false, timeUp = false, role = null, frozen = false } = {}, narrow = false) {
	const out = []
	if (status) {
		out.push('status')
	}
	if (follow) {
		out.push('follow')
	} else if (chip) {
		out.push('chip')
	}
	if (timeUp) {
		out.push('time_up')
	}
	if (role && !frozen) {
		out.push('role')
	}
	return narrow ? out.slice(0, 1) : out
}

/**
 * @param {string} text item text
 * @param {number} [max] characters
 * @return {string} first line, shortened with an ellipsis
 */
export function excerpt(text, max = EXCERPT_CHARS) {
	const line = String(text ?? '').replace(/\s+/g, ' ').trim()
	const chars = Array.from(line)
	return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line
}

/**
 * "Copy results" (§6.6 VotePanel): "1. {text} – {n}" per line.
 *
 * @param {Array<[string, number]>} results ranking [[id, n], …]
 * @param {(id: string) => string} textOf item text (empty: the fallback)
 * @param {string} fallback text of an item without text
 * @return {string} plain text
 */
export function resultsText(results, textOf, fallback) {
	return (results ?? []).map(([id, n], i) => (i + 1) + '. ' + (excerpt(textOf(id)) || fallback) + ' – ' + n).join('\n')
}
