/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Board as a file (factory job 181), pure: the format of a ".knorke" file,
 * its name and the check of a file that is to be inserted.
 * BoardSession.exportBoardFile downloads it, BoardSession.insertBoardFile
 * pastes a checked file with actions.pasteItems (board null).
 *
 * Format: UTF-8 JSON without indentation,
 *   {"knorke": 1, "kind": "board", "title": "<board title>", "origin": [x, y], "items": [...], "tags": [...]}
 * items is actions.copyPayload(model, every id of the local model).items in
 * stacking order: roots absolute, children relative to their frame, group
 * per item, tables with data.cols/data.rows, every connector (an end at an
 * item that is not in the model becomes a free end). No board key, no
 * data.react (copyPayload leaves it out), no lock, no votes, no meta, no
 * pid and no name: only what the items are. (Job 191) tags is the board's
 * whole tag list [{id, name, color}] (meta.tags); inserting maps the notes'
 * data.tags onto the target board's tags (model/tags.js planPasteTags).
 *
 * readBoardFile checks the text of a file, in this order:
 * 1. more than BOARD_FILE_MAX_BYTES as UTF-8, no JSON, no object,
 *    knorke !== 1, kind !== 'board', title no string, items no list or an
 *    empty one: invalid
 * 2. clipboard.js validatePayload without an item limit and with
 *    BOARD_FILE_MAX_BYTES: ok false or no item that passes: invalid
 * 3. size + the items that pass > maxItemsOf(limits): full
 * Else ok with skipped, the items validatePayload left out (an unknown type
 * of a newer version, a double id, a broken value): since job 187 they no
 * longer make the file invalid. insertBoardFile pastes the rest and says
 * how many are missing; an own template (job 182) stays all or nothing.
 */
import { titledFileName } from '../scene/exportImage.js'
import { copyPayload, maxItemsOf } from './actions.js'
import { utf8Bytes, validatePayload } from './clipboard.js'

/** Largest board file (bytes as UTF-8), checked before reading and again on its text. */
export const BOARD_FILE_MAX_BYTES = 16 * 1024 * 1024
/** Extension of a board file (without the dot). */
export const BOARD_FILE_EXT = 'knorke'
/** Type of the downloaded Blob: browsers keep the extension and offer the file again. */
export const BOARD_FILE_TYPE = 'application/octet-stream'

/*
 * (Job 205) A .bpmn file (board/bpmnFile.js): job 217 keeps these here, so
 * the board view and the session know them before the lazy BPMN part is
 * loaded.
 */
/** Largest .bpmn file (bytes as UTF-8). */
export const BPMN_FILE_MAX_BYTES = 16 * 1024 * 1024
/** Extension of a BPMN file (without the dot). */
export const BPMN_FILE_EXT = 'bpmn'
/** Type of the downloaded Blob: browsers keep the extension. */
export const BPMN_FILE_TYPE = 'application/octet-stream'
/** (Job 220) Largest CSV file that is read (bytes; board/csvFile.js, the lazy part csv). */
export const CSV_FILE_MAX_BYTES = 16 * 1024 * 1024

/**
 * @param {unknown} title board title
 * @return {string} "<board title>.knorke", cleaned and cut like exportFileName (no date); "Board.knorke" without a title
 */
export function boardFileName(title) {
	return titledFileName(title, '.' + BOARD_FILE_EXT)
}

/**
 * The content of a board file (see the file comment).
 *
 * @param {object} model SceneModel
 * @param {unknown} title board title
 * @param {Array<{id: string, name: string, color: string}>} [tags] (job 191) the board's tags (tagsOf(meta))
 * @return {{knorke: 1, kind: 'board', title: string, origin: [number, number], items: object[], tags: object[]}}
 */
export function boardFileData(model, title, tags = []) {
	const p = copyPayload(model, [...model.ids()])
	const list = Array.isArray(tags) ? tags.map((tg) => ({ id: tg.id, name: tg.name, color: tg.color })) : []
	return { knorke: 1, kind: 'board', title: typeof title === 'string' ? title : '', origin: p.origin, items: p.items, tags: list }
}

/**
 * @param {object} model SceneModel
 * @param {unknown} title board title
 * @param {Array<{id: string, name: string, color: string}>} [tags] (job 191) the board's tags
 * @return {string} the text of the board file (JSON without indentation)
 */
export function boardFileText(model, title, tags = []) {
	return JSON.stringify(boardFileData(model, title, tags))
}

/**
 * @param {string} text text
 * @return {boolean} more than BOARD_FILE_MAX_BYTES as UTF-8
 */
function tooLarge(text) {
	// one UTF-16 unit is one to three bytes
	if (text.length > BOARD_FILE_MAX_BYTES) {
		return true
	}
	return text.length * 3 > BOARD_FILE_MAX_BYTES && utf8Bytes(text) > BOARD_FILE_MAX_BYTES
}

/**
 * Checks the text of a board file (see the file comment).
 *
 * @param {unknown} text the file's text (anything but a string is invalid)
 * @param {{size?: number, limits?: (object|null)}} [o] size: items on the board now; limits: the initial state's
 * @return {{ok: true, payload: object, title: string, skipped: number}|{ok: false, reason: 'invalid'}|{ok: false, reason: 'full', max: number}}
 *   payload: validated, `knorke:1` with board null, for actions.pasteItems (job 191: with its cleaned tags);
 *   skipped: the items left out of it
 */
export function readBoardFile(text, { size = 0, limits = null } = {}) {
	const invalid = { ok: false, reason: 'invalid' }
	if (typeof text !== 'string' || tooLarge(text)) {
		return invalid
	}
	let raw
	try {
		raw = JSON.parse(text)
	} catch (e) {
		return invalid
	}
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.knorke !== 1 || raw.kind !== 'board'
		|| typeof raw.title !== 'string' || !Array.isArray(raw.items) || raw.items.length === 0) {
		return invalid
	}
	const v = validatePayload(raw, { maxItems: Infinity, maxBytes: BOARD_FILE_MAX_BYTES })
	if (!v.ok || v.payload.items.length === 0) {
		return invalid
	}
	const max = maxItemsOf(limits)
	if (size + v.payload.items.length > max) {
		return { ok: false, reason: 'full', max }
	}
	return { ok: true, payload: { ...v.payload, board: null }, title: raw.title, skipped: v.skipped }
}
