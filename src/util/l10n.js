/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Translation for Knorke: a thin wrapper around @nextcloud/l10n (port of the
 * Pulse helper). This module is the ONLY place in src/ that may import
 * @nextcloud/l10n; the shell and the scene both import `t`/`n` from here.
 *
 * The only difference to the library: escape/sanitize are OFF. All output goes
 * through Vue interpolation, bound attributes, `textContent` or Konva text,
 * which never interpret markup. With the library default, a guest named
 * "Tom & Jerry" would be shown as "Tom &amp; Jerry". src/ has no raw-HTML sinks
 * at all (guarded by the noHtml tests), so nothing here is ever parsed as HTML.
 *
 * Call form (same as Nextcloud and Pulse; the app id is always 'knorke' and is
 * written out so that build/l10n-check.mjs can find every source text):
 *
 *   t('knorke', <English text>, { name })
 *   n('knorke', <singular with %n>, <plural with %n>, count)
 *
 * German comes from l10n/de.json (maintained by hand) via the generated
 * l10n/de.js, which Nextcloud loads before the bundle. Without a registered
 * bundle (English UI, Node tests, scene lab) the English source text is
 * returned with its placeholders filled in.
 */
import { translate, translatePlural } from '@nextcloud/l10n'

const OPTIONS = Object.freeze({ escape: false, sanitize: false })

/**
 * @param {string} app app id, always 'knorke'
 * @param {string} text English source text
 * @param {Record<string, string|number>} [vars] values for {placeholders}
 * @return {string} translated text, never HTML-escaped
 */
export function t(app, text, vars) {
	return translate(app, text, vars, OPTIONS)
}

/**
 * @param {string} app app id, always 'knorke'
 * @param {string} singular English text for 1 (may contain %n)
 * @param {string} plural English text for any other count (may contain %n)
 * @param {number} count count, also replaces %n
 * @param {Record<string, string|number>} [vars] values for {placeholders}
 * @return {string} translated text in the matching plural form, never HTML-escaped
 */
export function n(app, singular, plural, count, vars) {
	return translatePlural(app, singular, plural, count, vars, OPTIONS)
}
