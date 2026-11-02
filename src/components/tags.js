/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The pure part of the tag panels (factory job 191, TagPanels.vue and
 * TagFilterChip.vue), checked in Node:
 * - createOffer: the name the row "Create “…”" offers (the cleaned search,
 *   only when no tag has that name without regard to case)
 * - ariaChecked: the three states of a box as aria-checked
 * - filterNames: the names of the chosen tags in the panel's order (the chip)
 * - tagTextColor: the text colour on a tag colour (tokens.js contrastTextOn)
 * - tagPanelPlace (job 213): where the tag panel goes; once above its box it
 *   stays there while it fits, so a shorter panel does not jump below it
 */
import { cleanTagName, findTagByName, matchTags } from '../model/tags.js'
import { contrastTextOn } from '../model/tokens.js'
import { REACT_POP_GAP, REACT_POP_MARGIN, popoverPlace } from './reactions.js'

/**
 * @param {Array<{name: string}>} tags the board's tags
 * @param {string} query the search field
 * @return {string|null} the name a new tag would get; null: empty, invalid or taken
 */
export function createOffer(tags, query) {
	const name = cleanTagName(query)
	return name === null || findTagByName(tags, name) !== null ? null : name
}

/**
 * @param {Array<{id: string, name: string}>} tags the board's tags
 * @param {string} query the search field
 * @return {Array<object>} the tags the panel lists (name contains the search, sorted by name)
 */
export function shownTags(tags, query) {
	return matchTags(tags, query)
}

/**
 * @param {'on'|'mixed'|'off'|boolean} state a box's state
 * @return {'true'|'mixed'|'false'} its aria-checked
 */
export function ariaChecked(state) {
	if (state === 'mixed') {
		return 'mixed'
	}
	return state === 'on' || state === true ? 'true' : 'false'
}

/**
 * @param {Array<{id: string, name: string}>} tags the board's tags (the view's order)
 * @param {string[]} filter chosen tag ids
 * @return {string[]} the names of the chosen tags
 */
export function filterNames(tags, filter) {
	const chosen = new Set(filter ?? [])
	return (tags ?? []).filter((tg) => chosen.has(tg.id)).map((tg) => tg.name)
}

/**
 * @param {string} color a tag's #rrggbb
 * @return {string} '#000000' or '#ffffff'
 */
export function tagTextColor(color) {
	return contrastTextOn(color)
}

/**
 * Where the tag panel goes (its top-left corner, board px): reactions.js
 * popoverPlace, except that a panel standing above its box keeps standing
 * there, its bottom at the box, while it fits there (the editor closing,
 * the search shortening the list) and the box is still inside the board
 * (a board that got lower, e.g. by a screen keyboard: popoverPlace pushes
 * the panel back in).
 *
 * @param {{x:number, y:number, w:number, h:number}|null} rect the box (board px)
 * @param {{w:number, h:number}|null} size the panel (null before it is measured)
 * @param {{w:number, h:number}|null} board the board (null: no clamping)
 * @param {boolean} above the panel stood above the box so far
 * @return {{x:number, y:number, above:boolean}} above: it stands above the box now
 */
export function tagPanelPlace(rect, size, board, above) {
	const p = popoverPlace(rect, size, board)
	if (!rect || !size || !board) {
		return { x: p.x, y: p.y, above: false }
	}
	const top = rect.y - REACT_POP_GAP - size.h
	if (above && top >= REACT_POP_MARGIN && rect.y - REACT_POP_GAP <= board.h - REACT_POP_MARGIN) {
		return { x: p.x, y: top, above: true }
	}
	return { x: p.x, y: p.y, above: p.y + size.h <= rect.y }
}
