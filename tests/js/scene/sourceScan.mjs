/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Helpers for the source guards (noHtml.test.mjs, guards.test.mjs). Not a
 * test file itself (the glob only runs *.test.mjs).
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root ($ROOT). */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * @param {string} dir absolute directory
 * @param {RegExp} re file name filter
 * @return {string[]} files below dir (node_modules, dist and out skipped)
 */
export function walk(dir, re) {
	if (!existsSync(dir)) return []
	const out = []
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'dist' || name === 'out') continue
		const p = join(dir, name)
		if (statSync(p).isDirectory()) out.push(...walk(p, re))
		else if (re.test(name)) out.push(p)
	}
	return out
}

/**
 * Removes // and /* *\/ comments outside string literals (simple lexer:
 * quotes and template literals; good enough for this code base).
 *
 * @param {string} src source
 * @return {string} source without comments (newlines kept)
 */
export function stripComments(src) {
	let out = ''
	let i = 0
	let quote = null
	while (i < src.length) {
		const c = src[i]
		const n = src[i + 1]
		if (quote) {
			out += c
			if (c === '\\') {
				out += n ?? ''
				i += 2
				continue
			}
			if (c === quote) quote = null
			i++
			continue
		}
		if (c === '\'' || c === '"' || c === '`') {
			quote = c
			out += c
			i++
			continue
		}
		if (c === '/' && n === '/') {
			while (i < src.length && src[i] !== '\n') i++
			continue
		}
		if (c === '/' && n === '*') {
			const end = src.indexOf('*/', i + 2)
			const block = src.slice(i, end < 0 ? src.length : end + 2)
			out += block.replace(/[^\n]/g, '')
			i = end < 0 ? src.length : end + 2
			continue
		}
		out += c
		i++
	}
	return out
}
