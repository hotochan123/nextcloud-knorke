/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Save as CSV" (factory job 179), the pure part: which items become rows,
 * in which order, and what stands in them. The session
 * (BoardSession.exportBoardCsv) picks the items (scene/exportImage.js
 * exportIds: the whole board, or a selection with the content of its
 * frames), the votes (closedVotes) and the separator (model/table.js
 * csvSeparator of the language), and downloads the text.
 *
 * - rows (csvRowIds): every note (also an empty one), every text item,
 *   every shape whose data.text is not empty after trimming, every table;
 *   frames, connectors, unknown types and shapes without text get none
 * - order: one group per parent frame, the frames in the reading order of
 *   their hulls, then the group without a frame; inside a group the reading
 *   order of "Sort by color" (board/actions.js readingOrder: rows as "Tidy
 *   up", in a row by the centre x), ties in stacking order
 * - (job 267) an AI card gets a row too: Type "AI summary", Text its
 *   Markdown (data.md) as it is, no colour
 * - columns (csvRow): Type ("Note", "Text", "Shape", "Table", translated);
 *   Text (data.text as it is, job 279: notes, shapes, text items and cells
 *   without their Markdown marks (model/richText.js plainText); a table's cells row by row, each row in
 *   column order, joined by " | ", empty cells too); Color (a note's
 *   style.fill, a text item's style.color, a shape's style.fill or, with
 *   fillOpacity 0, its style.stroke, all through fieldValue; components/
 *   labels.js colorName: the palette name, else (job 186) the name of the
 *   nearest palette colour, never a hex code; empty for a table); Frame
 *   (the parent frame's data.title); Reactions (notes only: summarize(item,
 *   null) as "<emoji> <count>" joined by ", ", no names); Votes (the item's
 *   total of the last finished vote, empty without one; job 186: "0" for an
 *   item without votes that could get votes in it – its type in cfg.types,
 *   in cfg.scope unless that is null, type and parent as they are now –
 *   while the ranking is complete, total ≤ the entries of results; empty
 *   for every other item); (job 191) Tags, the last column (notes only: the
 *   names of the note's valid tags in its order, joined by ", "; empty for
 *   every other item)
 * - boardCsv: UTF-8 with BOM, the translated header row first, every field
 *   through csvField (formulas defused, quoted for ", the separator, CR or
 *   LF), CRLF after every row
 */
import { colorName } from '../components/labels.js'
import { fromHex, summarize } from '../model/reactions.js'
import { fieldValue } from '../model/registry.js'
import { isCovered } from '../model/privateWriting.js'
import { noteTagIds, tagMap } from '../model/tags.js'
import { cellText, csvField, orderedCols, orderedRows } from '../model/table.js'
import { plainText } from '../model/richText.js'
import { t } from '../util/l10n.js'
import { readingOrder } from './actions.js'
import { cfgOf } from './votes.js'

/** The item types that can get a row, in the order of the Type column's texts. */
export const CSV_TYPES = Object.freeze(['sticky', 'text', 'shape', 'table', 'ai'])

/**
 * @param {object|null|undefined} it item
 * @return {boolean} it gets a row (see the file comment)
 */
export function hasCsvRow(it) {
	// job 275: a covered note of private writing has no row
	if (!it || !CSV_TYPES.includes(it.t) || isCovered(it)) {
		return false
	}
	return it.t !== 'shape' || String(fieldValue(it, 'data.text') ?? '').trim() !== ''
}

/**
 * @param {object} model SceneModel
 * @param {string} id item
 * @return {string|null} its parent frame, null without one
 */
function frameOf(model, id) {
	const p = model.get(id)?.parent ?? null
	return typeof p === 'string' && model.has(p) && model.get(p).t === 'frame' ? p : null
}

/**
 * The items with a row, in the CSV's order (see the file comment).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids the exported items (exportIds)
 * @return {string[]}
 */
export function csvRowIds(model, ids) {
	const rows = model.sortByOrder([...new Set(ids)].filter((id) => model.has(id) && hasCsvRow(model.get(id))))
	const groups = new Map()
	for (const id of rows) {
		const f = frameOf(model, id)
		if (!groups.has(f)) {
			groups.set(f, [])
		}
		groups.get(f).push(id)
	}
	const frames = readingOrder(model, model.sortByOrder([...groups.keys()].filter((f) => f !== null)))
	const out = []
	for (const f of [...frames, null]) {
		if (groups.has(f)) {
			out.push(...readingOrder(model, groups.get(f)))
		}
	}
	return out
}

/**
 * @param {string} type item type (CSV_TYPES)
 * @return {string} the Type column's text
 */
function typeLabel(type) {
	switch (type) {
	case 'sticky': return t('knorke', 'Note')
	case 'text': return t('knorke', 'Text')
	case 'shape': return t('knorke', 'Shape')
	case 'table': return t('knorke', 'Table')
	// job 267: an AI card
	case 'ai': return t('knorke', 'AI summary')
	default: return String(type)
	}
}

/**
 * @param {object} it table item
 * @return {string} its cells row by row, each row in column order, joined by " | "
 */
function tableText(it) {
	const cols = orderedCols(it.data)
	const cells = []
	for (const r of orderedRows(it.data)) {
		for (const c of cols) {
			cells.push(plainText(cellText(it.data, c.key, r.key)))
		}
	}
	return cells.join(' | ')
}

/**
 * @param {object} it item with a row
 * @return {string} the Color column (empty for a table)
 */
function colorOf(it) {
	switch (it.t) {
	case 'sticky': return colorName(fieldValue(it, 'style.fill'))
	case 'text': return colorName(fieldValue(it, 'style.color'))
	case 'shape': return colorName(fieldValue(it, fieldValue(it, 'style.fillOpacity') === 0 ? 'style.stroke' : 'style.fill'))
	default: return ''
	}
}

/**
 * The header row (translated).
 *
 * @return {string[]}
 */
export function csvHeader() {
	return [t('knorke', 'Type'), t('knorke', 'Text'), t('knorke', 'Color'), t('knorke', 'Frame'), t('knorke', 'Reactions'), t('knorke', 'Votes'), t('knorke', 'Tags')]
}

/**
 * @param {object} it item with a row
 * @param {string} id its id
 * @param {object|null} votes closedVotes
 * @return {string} the Votes column: its total, "0" when it could get votes
 *   and the ranking is complete (job 186), else empty
 */
function votesOf(it, id, votes) {
	if (!votes) {
		return ''
	}
	if (votes.totals.has(id)) {
		return String(votes.totals.get(id))
	}
	const could = votes.types.includes(it.t) && (votes.scope === null || (it.parent ?? null) === votes.scope)
	return votes.complete && could ? '0' : ''
}

/**
 * The fields of one row (see the file comment), not yet escaped.
 *
 * @param {object} model SceneModel
 * @param {string} id item with a row
 * @param {object|null} votes the last finished vote (closedVotes), null without one
 * @param {Map<string, {name: string}>} [byId] (job 191) the board's tags (model/tags.js tagMap)
 * @return {string[]} Type, Text, Color, Frame, Reactions, Votes, Tags
 */
export function csvRow(model, id, votes, byId = new Map()) {
	const it = model.get(id)
	const f = frameOf(model, id)
	// job 267: an AI card's Markdown as it is
	// job 279: notes, shapes, text items and cells without their Markdown marks
	const raw = it.t === 'table' ? tableText(it) : String(fieldValue(it, it.t === 'ai' ? 'data.md' : 'data.text') ?? '')
	const text = it.t === 'sticky' || it.t === 'shape' || it.t === 'text' ? plainText(raw) : raw
	const reactions = it.t === 'sticky' ? summarize(it, null).map((g) => fromHex(g.e) + ' ' + g.n).join(', ') : ''
	const tags = noteTagIds(it, byId).map((tid) => byId.get(tid).name).join(', ')
	return [typeLabel(it.t), text, colorOf(it), f !== null ? String(fieldValue(model.get(f), 'data.title') ?? '') : '', reactions, votesOf(it, id, votes), tags]
}

/**
 * The rows of the exported items, in order (csvRowIds, csvRow).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids the exported items (exportIds)
 * @param {object|null} [votes] closedVotes
 * @param {Array<{id: string, name: string}>} [tags] (job 191) the board's tags (tagsOf(meta))
 * @return {string[][]} empty when no item gets a row
 */
export function csvRows(model, ids, votes = null, tags = []) {
	const byId = tagMap(tags)
	return csvRowIds(model, ids).map((id) => csvRow(model, id, votes, byId))
}

/**
 * The CSV file: BOM, the header row, the rows; each field through csvField,
 * CRLF after every row.
 *
 * @param {string[][]} rows csvRows
 * @param {string} [sep] separator (model/table.js csvSeparator)
 * @return {string}
 */
export function boardCsv(rows, sep = ',') {
	return '﻿' + [csvHeader(), ...rows].map((r) => r.map((x) => csvField(x, sep)).join(sep) + '\r\n').join('')
}

/**
 * The last finished vote (VoteState state 'closed'): totals (item id → its
 * total in results), the types and the scope it was about (cfgOf: types
 * never 'table', scope null = the whole board) and whether the ranking is
 * complete (job 186: total known and not more than the entries of results,
 * which the server caps at 500); null while a vote is open, without one and
 * after "Close results" (meta.vote gone). Whether the totals are shown on
 * the board (show) does not matter; live counts never count.
 *
 * @param {object|null|undefined} vote VoteState
 * @return {{totals: Map<string, number>, types: string[], scope: (string|null), complete: boolean}|null}
 */
export function closedVotes(vote) {
	if (!vote || vote.state !== 'closed') {
		return null
	}
	const results = Array.isArray(vote.results) ? vote.results : []
	const { types, scope } = cfgOf(vote.cfg)
	const complete = Number.isInteger(vote.total) && vote.total <= results.length
	return { totals: new Map(results), types, scope, complete }
}
