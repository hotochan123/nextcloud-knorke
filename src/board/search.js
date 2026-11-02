/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Search on the board (factory job 271): pure functions, no DOM. The text
 * comes only from what the client already holds (the model and the loaded
 * comment threads), so a person finds only what they may see.
 *
 * searchBoard(model, threads, query, {anchorOf}) gives {hits, more}:
 * - sources: data.text of sticky, shape and text, data.title of frame, every
 *   cell of a table (one hit per table, the snippet from its first matching
 *   cell in row, then column order) and the comments of every loaded thread
 *   (open and resolved; one hit per thread, the snippet from its first
 *   matching comment). Connector labels, pads, mind maps and AI items are
 *   not searched.
 * - match: the trimmed query as a substring, without case (NFC, then
 *   toLocaleLowerCase per code point, so the snippet's indices stay those of
 *   the original text); an empty query finds nothing.
 * - order: items by reading order of their absolute box (top to bottom,
 *   tops within READ_ROW_TOL count as one row, then left to right, then id),
 *   then the threads the same way by their anchor (anchorOf(thread), else
 *   the item's box corner or the thread's x/y).
 * - at most SEARCH_MAX hits; more: true when there were more.
 *
 * snippet(text, start, end) cuts SNIPPET_MAX code points around a match,
 * line breaks as spaces, "…" where it cut. stepHit(i, n, dir) is the
 * next/previous index with wrap-around (i = -1: none yet).
 */
import { orderedCols, orderedRows, cellText } from '../model/table.js'
import { plainText } from '../model/richText.js'
import { partsText } from './comments.js'

export const SEARCH_MAX = 200
export const SNIPPET_MAX = 60
const READ_ROW_TOL = 1

/** Types searched by their one text field. */
const TEXT_FIELD = Object.freeze({ sticky: 'text', shape: 'text', text: 'text', frame: 'title' })

/**
 * @param {string} s text
 * @return {{low: string[], cps: string[]}} code points of s (NFC) and their lower-case forms
 */
function fold(s) {
	const cps = Array.from(String(s).normalize('NFC'))
	return { cps, low: cps.map((c) => c.toLocaleLowerCase()) }
}

/**
 * @param {string} q query
 * @return {string[]|null} the folded query, code point by code point (null: empty)
 */
export function foldQuery(q) {
	const t = typeof q === 'string' ? q.trim() : ''
	if (t === '') {
		return null
	}
	return fold(t).low
}

/**
 * @param {string} text text
 * @param {string[]} q folded query (foldQuery)
 * @return {{cps: string[], start: number, end: number}|null} the first match, as code point indices of the NFC text
 */
export function findIn(text, q) {
	if (typeof text !== 'string' || text === '' || !q) {
		return null
	}
	const { cps, low } = fold(text)
	// compare joined lower-case code points: a lower-case form may be longer than one unit
	const needle = q.join('')
	for (let i = 0; i < low.length; i++) {
		let acc = ''
		for (let j = i; j < low.length && acc.length < needle.length; j++) {
			acc += low[j]
			if (acc === needle) {
				return { cps, start: i, end: j + 1 }
			}
			if (!needle.startsWith(acc)) {
				break
			}
		}
	}
	return null
}

/**
 * @param {string[]} cps code points of the text
 * @param {number} start first code point of the match
 * @param {number} end code point after the match
 * @param {number} [max] longest snippet in code points (without the "…")
 * @return {{before: string, match: string, after: string}} the snippet in three parts
 */
export function snippet(cps, start, end, max = SNIPPET_MAX) {
	const flat = (a) => a.join('').replace(/[\r\n\t]+/g, ' ')
	const len = end - start
	let from = start
	let to = end
	if (len >= max) {
		to = start + max
	} else {
		const room = max - len
		from = Math.max(0, start - Math.floor(room / 3))
		to = Math.min(cps.length, end + (room - (start - from)))
		from = Math.max(0, Math.min(from, to - max))
	}
	return {
		before: (from > 0 ? '…' : '') + flat(cps.slice(from, start)),
		match: flat(cps.slice(start, Math.min(end, to))),
		after: flat(cps.slice(Math.min(end, to), to)) + (to < cps.length ? '…' : ''),
	}
}

/**
 * @param {object} item item
 * @param {string[]} q folded query
 * @return {object|null} the first match of the item ({cps, start, end})
 */
function itemMatch(item, q) {
	const field = TEXT_FIELD[item?.t]
	if (field) {
		// job 279: the text without its Markdown marks (frame titles stay as typed)
		return findIn(item.t === 'frame' ? item.data?.[field] : plainText(item.data?.[field]), q)
	}
	if (item?.t === 'table') {
		const cols = orderedCols(item.data)
		for (const row of orderedRows(item.data)) {
			for (const col of cols) {
				const m = findIn(plainText(cellText(item.data, col.key, row.key)), q)
				if (m) {
					return m
				}
			}
		}
	}
	return null
}

/**
 * @param {{x: number, y: number, id: string}} a place
 * @param {{x: number, y: number, id: string}} b place
 * @return {number} reading order
 */
function readOrder(a, b) {
	if (Math.abs(a.y - b.y) > READ_ROW_TOL) {
		return a.y - b.y
	}
	return a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * @param {object} model scene model (ids, get, abs)
 * @param {object[]} threads loaded comment threads
 * @param {string} query the search text
 * @param {{anchorOf?: function(object): ({x: number, y: number}|null), max?: number}} [o] a thread's world anchor; most hits
 * @return {{hits: object[], more: boolean}} hits: {kind, id (item or thread), item (item id or null), resolved?, before, match, after}
 */
export function searchBoard(model, threads, query, { anchorOf = null, max = SEARCH_MAX } = {}) {
	const q = foldQuery(query)
	if (!q) {
		return { hits: [], more: false }
	}
	const items = []
	for (const id of model?.ids?.() ?? []) {
		const it = model.get(id)
		const m = it ? itemMatch(it, q) : null
		if (!m) {
			continue
		}
		const box = model.abs?.(id)
		items.push({
			kind: it.t === 'sticky' ? 'note' : it.t,
			id,
			item: id,
			x: Number.isFinite(box?.x) ? box.x : 0,
			y: Number.isFinite(box?.y) ? box.y : 0,
			...snippet(m.cps, m.start, m.end),
		})
	}
	items.sort(readOrder)
	const notes = []
	for (const th of Array.isArray(threads) ? threads : []) {
		if (!th || typeof th.id !== 'string' || !Array.isArray(th.comments)) {
			continue
		}
		let m = null
		for (const c of th.comments) {
			m = findIn(partsText(c?.parts), q)
			if (m) {
				break
			}
		}
		if (!m) {
			continue
		}
		const item = typeof th.item === 'string' && model?.has?.(th.item) ? th.item : null
		let a = typeof anchorOf === 'function' ? anchorOf(th) : null
		if (!a && item) {
			const b = model.abs?.(item)
			a = b ? { x: b.x + b.w, y: b.y } : null
		}
		if (!a && Number.isFinite(th.x) && Number.isFinite(th.y)) {
			a = { x: th.x, y: th.y }
		}
		notes.push({
			kind: 'comment',
			id: th.id,
			item,
			resolved: th.resolved === true,
			x: a?.x ?? 0,
			y: a?.y ?? 0,
			...snippet(m.cps, m.start, m.end),
		})
	}
	notes.sort(readOrder)
	const all = [...items, ...notes]
	return { hits: all.slice(0, max), more: all.length > max }
}

/**
 * @param {number} i current index (-1: none yet)
 * @param {number} n number of hits
 * @param {1|-1} dir next or previous
 * @return {number} the new index (-1 without hits)
 */
export function stepHit(i, n, dir) {
	if (!(n > 0)) {
		return -1
	}
	if (!(i >= 0 && i < n)) {
		return dir < 0 ? n - 1 : 0
	}
	return (i + (dir < 0 ? n - 1 : 1)) % n
}
