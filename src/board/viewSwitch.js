/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Board | Outline" (factory job 274): which view the board shows. Only
 * this tab's choice: not stored, not sent, a reload shows the board.
 *
 * nextView(view, event):
 * - 'board' / 'outline': that view (the switch's two buttons)
 * - 'toggle': the other one (the narrow bar's single button)
 * - 'escape' (Esc in the outline), 'jump' (a point or heading was picked),
 *   'search' (the search opens), 'follow' (following someone begins, e.g. a
 *   presentation or "Bring everyone here"), 'thread' (a comment thread opens
 *   from the list): the board, since each of them shows something on it
 * - anything else: unchanged
 */

/** The views. */
export const VIEWS = Object.freeze(['board', 'outline'])

/** Events that bring the board back. */
const TO_BOARD = new Set(['escape', 'jump', 'search', 'follow', 'thread'])

/**
 * @param {'board'|'outline'} view the view now
 * @param {string} event what happened
 * @return {'board'|'outline'} the view after it
 */
export function nextView(view, event) {
	const now = view === 'outline' ? 'outline' : 'board'
	if (event === 'board' || event === 'outline') {
		return event
	}
	if (event === 'toggle') {
		return now === 'outline' ? 'board' : 'outline'
	}
	return TO_BOARD.has(event) ? 'board' : now
}
