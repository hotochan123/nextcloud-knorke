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
 * (3) Banner strips stand at the top under the TopBar. (Job 228, redesign
 *     V16) In every layout exactly one notice at a time, closable;
 *     precedence: final states/connection > "pick a spot for the comment" >
 *     FollowBanner > FollowChip > "Time's up" > tag filter >
 *     vote_ready/device_vote/view_role; lower ones wait. noticeOf() gives the
 *     one, pruneDismissed() keeps the closed ones only while they apply.
 * (4) At the start of a session the narrow layout opens the VotePanel as a
 *     bottom sheet at once.
 * Every bar carries [data-knorke-bar=top|banner|vote|timer|list].
 * (Job 223) Every floating bar and docked side panel the camera keeps clear
 * of carries [data-knorke-chrome]; chromeInsets() turns their screen
 * rectangles into the px they cover at each edge of the board.
 *
 * Also the plain-text ranking of "Copy results" (§6.6 VotePanel) and the
 * text excerpt of an item in lists.
 */

/** The narrow layout (R16 (1)). */
export const NARROW_QUERY = '(max-width: 600px)'
/** (Job 228) Middle width (with NARROW_QUERY false: 601–900 px): the top bar's participants only as "+n". */
export const MID_QUERY = '(max-width: 900px)'
/** Characters of an item text in the vote list and the ranking. */
export const EXCERPT_CHARS = 80

/**
 * (Job 228) The notices that apply, in precedence order, each with the key
 * a closing remembers: a closed notice stays away while it applies without
 * a break (pruneDismissed), another status kind, another followed person, a
 * new presentation or another role kind is a new key. comment, time_up and
 * tags carry no closing key here: their close button cancels the pick, ends
 * the time-up memory of the board view (countdown.js timerKey) or clears
 * the filter.
 *
 * @param {object} o what wants to show
 * @param {string|null} [o.status] kind of the status banner (banner.js bannerFor(...).kind) or null
 * @param {boolean} [o.comment] picking the spot of a new comment
 * @param {string|null} [o.follow] pid this tab follows (FollowBanner), or null
 * @param {{pid: string, client?: string}|null} [o.chip] the presenter of the chip "{name} is presenting · Follow"
 * @param {boolean} [o.timeUp] "Time's up"
 * @param {boolean} [o.tags] this tab filters by tags
 * @param {string|null} [o.role] role/device banner kind (mode.js bannerFor) or null
 * @param {boolean} [o.frozen] the board is frozen (no role banner then)
 * @return {Array<{kind: string, key: (string|null)}>} kinds 'status', 'comment', 'follow', 'chip', 'time_up', 'tags', 'role'
 */
export function noticeCandidates({ status = null, comment = false, follow = null, chip = null, timeUp = false, tags = false, role = null, frozen = false } = {}) {
	const out = []
	if (status) {
		out.push({ kind: 'status', key: 'status:' + status })
	}
	if (comment) {
		out.push({ kind: 'comment', key: null })
	}
	if (follow) {
		out.push({ kind: 'follow', key: 'follow:' + follow })
	} else if (chip) {
		out.push({ kind: 'chip', key: 'chip:' + chip.pid + ':' + (chip.client ?? '') })
	}
	if (timeUp) {
		out.push({ kind: 'time_up', key: null })
	}
	if (tags) {
		out.push({ kind: 'tags', key: null })
	}
	if (role && !frozen) {
		out.push({ kind: 'role', key: 'role:' + role })
	}
	return out
}

/**
 * (Job 228) The one notice to show: the first that applies and was not closed.
 *
 * @param {object} o see noticeCandidates
 * @param {Set<string>} [dismissed] keys of the closed notices
 * @return {{kind: string, key: (string|null)}|null} the notice, or null
 */
export function noticeOf(o, dismissed = new Set()) {
	return noticeCandidates(o).find((c) => c.key === null || !dismissed.has(c.key)) ?? null
}

/**
 * (Job 228) The closed notices that still apply; a notice that went away
 * meanwhile comes back next time.
 *
 * @param {Set<string>} dismissed keys of the closed notices
 * @param {object} o see noticeCandidates
 * @return {Set<string>} the subset of dismissed whose notice applies now
 */
export function pruneDismissed(dismissed, o) {
	const now = new Set(noticeCandidates(o).map((c) => c.key))
	return new Set([...dismissed].filter((k) => now.has(k)))
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

/**
 * (Job 223) The px the bars cover at each edge of the board, from their
 * screen rectangles (any common origin, e.g. getBoundingClientRect). Each
 * rectangle that overlaps the board with an area belongs to the edge it
 * reaches least deep from (ties: top, bottom, left, right) and covers that
 * depth there: a bar along the top → top, a tool bar on the left → left
 * (on the right in RTL → right), zoom controls in the bottom-right corner →
 * bottom, a side panel over the full height → right. Per edge the largest
 * depth counts.
 *
 * @param {{left: number, top: number, right: number, bottom: number}} board the board's rectangle
 * @param {Array<{left: number, top: number, right: number, bottom: number}>} rects the bars' rectangles
 * @return {{top: number, right: number, bottom: number, left: number}} px
 */
export function chromeInsets(board, rects) {
	const out = { top: 0, right: 0, bottom: 0, left: 0 }
	for (const r of rects) {
		// only a rectangle with an area that overlaps the board
		if (r.right <= Math.max(r.left, board.left) || r.left >= board.right || r.bottom <= Math.max(r.top, board.top) || r.top >= board.bottom) {
			continue
		}
		// in the order of the ties; a depth beyond the board's size leaves nothing free (Camera.js freePart then takes the whole canvas)
		const depth = { top: r.bottom - board.top, bottom: board.bottom - r.top, left: r.right - board.left, right: board.right - r.left }
		const edge = Object.keys(depth).reduce((a, k) => (depth[k] < depth[a] ? k : a))
		out[edge] = Math.max(out[edge], depth[edge])
	}
	return out
}

/** (Job 233) Overflow tolerance of the session bar (px): Chrome measures a text a pixel short at times. */
export const SESSION_FIT_SLACK = 2

/**
 * (Job 233, round 3) Whether the one-line session bar does not fit: the bar
 * or one of its text blocks runs over by more than SESSION_FIT_SLACK.
 *
 * @param {{client: number, scroll: number, texts: Array<[number, number]>}} m the bar's clientWidth and
 *   scrollWidth, and [clientWidth, scrollWidth] of each text block
 * @param {number} [slack] tolerance (px)
 * @return {boolean} it overflows: show the two-line bar
 */
export function sessionOverflows(m, slack = SESSION_FIT_SLACK) {
	if (!m) return false
	if (m.scroll > m.client + slack) return true
	return (m.texts ?? []).some(([client, scroll]) => scroll > client + slack)
}
