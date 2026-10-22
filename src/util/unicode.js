/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Well-formed UTF-16 for everything the client sends (T14). JSON.stringify
 * writes a lone surrogate as \udXXX, which is valid JSON, but PHP's
 * json_decode rejects it ("Single unpaired UTF-16 surrogate"), so Nextcloud
 * answers the WHOLE request with 400 and every op of the batch is lost.
 * Lone surrogates come from broken UTF-16 clipboards or IMEs; maxlength never
 * splits a pair. They become U+FFFD, exactly what the browser itself would
 * write when encoding the string as UTF-8.
 */

const PAIR_OR_LONE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g

/**
 * Regex fallback for engines without String.prototype.toWellFormed (no
 * lookbehind, works on code units).
 *
 * @param {string} s string
 * @return {string} s with every unpaired surrogate replaced by U+FFFD
 */
export function replaceLoneSurrogates(s) {
	return s.replace(PAIR_OR_LONE, (m) => (m.length === 2 ? m : '�'))
}

const nativeWellFormed = typeof String.prototype.toWellFormed === 'function'

/**
 * @param {unknown} s value; non-strings are returned unchanged
 * @return {unknown} the string with unpaired surrogates replaced by U+FFFD
 */
export function wellFormed(s) {
	if (typeof s !== 'string') {
		return s
	}
	return nativeWellFormed ? s.toWellFormed() : replaceLoneSurrogates(s)
}
