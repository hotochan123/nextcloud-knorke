/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 217: the lazy parts of a fake bundle on disk for the tests of
 * build/check-bundle.mjs (bundle.test.mjs, fresh.test.mjs): per part of
 * LAZY_CHUNKS one chunk js/<name>-L<name>1.chunk.mjs importing vendor, its
 * map naming the part's roots (with their text as sourcesContent, as vite
 * writes it), and those roots under src/ with the same text; plus the
 * dynamic imports main must hold.
 */
import { LAZY_CHUNKS } from '../../../build/check-bundle.mjs'

/**
 * @param {string} name part
 * @return {string} its chunk file (below js/)
 */
export function lazyFile(name) {
	return `${name}-L${name}1.chunk.mjs`
}

/**
 * @param {string[]} sources paths relative to the app root
 * @param {string[]} [extra] further map sources (relative to js/, no content checked: outside src/)
 * @return {string} a source map like vite writes it
 */
export function rootMap(sources, extra = []) {
	return JSON.stringify({
		version: 3,
		sources: [...sources.map((s) => '../' + s), ...extra],
		sourcesContent: [...sources.map((s) => '// ' + s + '\n'), ...extra.map(() => '')],
		names: [],
		mappings: '',
	})
}

/** The dynamic imports of every lazy part, as main holds them. */
export const LAZY_IMPORTS = Object.keys(LAZY_CHUNKS).map((n) => `()=>import("./${lazyFile(n)}")`).join(';')

/**
 * @param {string} [vendor] the vendor chunk the parts import
 * @return {Record<string, string>} path → content
 */
export function lazyTree(vendor = 'vendor-AbC123.chunk.mjs') {
	const files = {}
	for (const [name, roots] of Object.entries(LAZY_CHUNKS)) {
		files['js/' + lazyFile(name)] = `import{v}from"./${vendor}";export const ${name}=v`
		files['js/' + lazyFile(name) + '.map'] = rootMap(roots)
		for (const r of roots) {
			files[r] = '// ' + r + '\n'
		}
	}
	return files
}
