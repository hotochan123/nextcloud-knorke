/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Identity stub for src/util/l10n.js in the scene lab (SPEC-M0 §6.9: allowed
 * via a Vite alias). Same signatures as the real module: t(app, text, vars),
 * n(app, singular, plural, count, vars); returns the English source text with
 * {placeholders} (and %n) filled in, never escaped.
 */

/**
 * @param {string} text source text
 * @param {Record<string, string|number>} [vars] values
 * @return {string}
 */
function fill(text, vars) {
	if (!vars) return text
	return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m))
}

/**
 * @param {string} app app id
 * @param {string} text source text
 * @param {Record<string, string|number>} [vars] values
 * @return {string}
 */
export function t(app, text, vars) {
	return fill(text, vars)
}

/**
 * @param {string} app app id
 * @param {string} singular text for 1
 * @param {string} plural text otherwise
 * @param {number} count count
 * @param {Record<string, string|number>} [vars] values
 * @return {string}
 */
export function n(app, singular, plural, count, vars) {
	return fill(count === 1 ? singular : plural, vars).replace('%n', String(count))
}
