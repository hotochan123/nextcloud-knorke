/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Live title and the rename field of the top bar (SPEC-M1 §1.4, §6.6
 * TopBar: "ein offenes Umbenennen-Feld wird nicht überschrieben"). Pure, so
 * the decision can be checked in Node.
 *
 * The title changes live while the owner may have the rename field open
 * (another tab renamed). The field keeps its draft (it is bound to its own
 * value, not to the title). When it closes, a rename is sent only when the
 * user changed the draft against the title the field STARTED with; comparing
 * with the current (live) title would send the old title back and undo the
 * other tab's rename just by tabbing out of an untouched field.
 */
import { wellFormed } from '../util/unicode.js'

/**
 * @param {string} draft text in the rename field
 * @param {string} startTitle title when the field opened
 * @return {string|null} the new title to send, null: nothing to rename
 */
export function renameTarget(draft, startTitle) {
	const next = wellFormed(String(draft ?? '').trim())
	return next !== '' && next !== startTitle ? next : null
}
