/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (Factory job 279) The links of an item for the context bar's "Open link":
 * a note, shape or text item from its text, a table from its cells row by
 * row (model/richText.js linksOf), at most ITEM_LINKS_MAX.
 */
import { linksOf } from './richText.js'
import { cellText, orderedCols, orderedRows } from './table.js'

/** At most this many links are offered. */
export const ITEM_LINKS_MAX = 10

/**
 * @param {object} it item
 * @return {{text: string, href: string}[]}
 */
export function itemLinks(it) {
	if (!it || typeof it !== 'object') return []
	if (it.t === 'sticky' || it.t === 'shape' || it.t === 'text') {
		return linksOf(it.data?.text).slice(0, ITEM_LINKS_MAX)
	}
	if (it.t === 'table') {
		const out = []
		const cols = orderedCols(it.data)
		for (const row of orderedRows(it.data)) {
			for (const col of cols) {
				for (const l of linksOf(cellText(it.data, col.key, row.key))) {
					out.push(l)
					if (out.length >= ITEM_LINKS_MAX) return out
				}
			}
		}
		return out
	}
	return []
}
