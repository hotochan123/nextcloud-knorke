/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The copy dialog of the text rescue (SPEC-M0 §6.5, T6). Pure, so it can be
 * checked in Node.
 *
 * Every rescued text is kept: several can arrive at once (two text ops
 * rejected in one answer) or one after the other (answers ~150 ms apart after
 * offline edits) while the dialog is still open. Before, the dialog had one
 * slot and only the last text survived. The list grows newest last and is
 * emptied when the dialog closes.
 *
 * An entry is {key, id, text, gone}: `key` for v-for, `id` the item (null
 * when unknown), `gone` true when the item no longer exists (otherwise the
 * text could not be saved and no rescue editor could be opened for it,
 * e.g. because another editor is open).
 */
import { t } from '../util/l10n.js'

let seq = 0

/**
 * @param {Array<object>} list current entries
 * @param {{id?: (string|null), text: string, gone?: boolean}|null} x rescued text from the session
 * @return {Array<object>} new list with x appended (unchanged for an empty text)
 */
export function addRescue(list, x) {
	if (!x || typeof x.text !== 'string' || x.text === '') {
		return list
	}
	seq++
	return [...list, { key: seq, id: typeof x.id === 'string' ? x.id : null, text: x.text, gone: x.gone === true }]
}

/**
 * @param {Array<object>} list entries (at least one)
 * @return {{name: string, message: string}} dialog title and message
 */
export function rescueDialog(list) {
	const one = list.length === 1
	let name
	if (list.every((r) => r.gone)) {
		name = one ? t('knorke', 'This item was deleted') : t('knorke', 'These items were deleted')
	} else {
		name = t('knorke', 'Text not saved')
	}
	return { name, message: one ? t('knorke', 'Your text:') : t('knorke', 'Your texts:') }
}
