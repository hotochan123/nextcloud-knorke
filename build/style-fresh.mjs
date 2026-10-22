/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Freshness record of the CSS sources (SPEC-M1 §9.5 WP-C4 (b), R19 T4-26).
 * css/knorke-style.css has no source map, so build/check-fresh.mjs could not
 * tell a stylesheet built from older sources. The vite plugin below (wired
 * in vite.config.js) hashes (SHA-256) every src/styles/*.css in its
 * `transform` hook, i.e. exactly the text vite translates (enforce 'pre':
 * after loading, before vite's own CSS plugin), never by reading the file
 * again after the build and never in check-bundle.mjs. The hashes go to
 * js/knorke-style.fresh.json: no .mjs (not one of the three bundle files),
 * js/ is gitignored and left out of the flow-back, the release directory of
 * P9 leaves the file out. The hook returns no code, so the shipped js/ and
 * css/ stay byte for byte what they are without it. The record is emitted in
 * generateBundle, written with the bundle: @nextcloud/vite-config's
 * EmptyJSDir (which empties js/ in its own generateBundle) cannot remove it.
 *
 * check-fresh.mjs compares every src/styles/*.css on disk with its entry
 * (styleHash below on the UTF-8 text, the way vite reads it).
 */
import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'

/** File name of the record below js/ (check-fresh.mjs reads it). */
export const STYLE_RECORD = 'knorke-style.fresh.json'
/** Sources the record covers: plain .css files directly in src/styles/ (repo-relative). */
export const STYLE_SOURCE = /^src\/styles\/[^/]+\.css$/

/**
 * @param {string} text file content as vite reads it (UTF-8 text)
 * @return {string} hex SHA-256 of its UTF-8 bytes
 */
export function styleHash(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * @param {Map<string, string>|Iterable<[string, string]>} hashes repo path → hash
 * @return {string} the record (stable key order, trailing newline)
 */
export function styleRecord(hashes) {
	const files = Object.fromEntries([...hashes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
	return JSON.stringify({ version: 1, algorithm: 'sha256', files }, null, '\t') + '\n'
}

/**
 * The vite plugin (vite.config.js `plugins`).
 *
 * @param {string} [root] app root (the build runs there)
 * @return {object} vite plugin
 */
export function styleFreshness(root = resolve('.')) {
	const hashes = new Map()
	return {
		name: 'knorke-style-fresh',
		enforce: 'pre',
		buildStart() {
			hashes.clear()
		},
		transform(code, id) {
			if (typeof code !== 'string' || typeof id !== 'string' || id.includes('?') || id.includes('\0')) {
				return null
			}
			const rel = relative(root, id).split(sep).join('/')
			if (STYLE_SOURCE.test(rel)) {
				hashes.set(rel, styleHash(code))
			}
			// never a change of the code: the shipped CSS stays as it is
			return null
		},
		generateBundle() {
			this.emitFile({ type: 'asset', fileName: 'js/' + STYLE_RECORD, source: styleRecord(hashes) })
		},
	}
}
