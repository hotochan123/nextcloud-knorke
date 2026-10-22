/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Checks the shape of the bundle after every `npm run build` (SPEC-M0 §7.4).
 * Exit 1 when:
 * - js/ holds other .mjs files than exactly knorke-main.mjs, one
 *   vendor-*.chunk.mjs and one canvas-*.chunk.mjs (a lazy chunk would mean
 *   extra requests on a cold page)
 * - css/knorke-style.css is missing
 * - the canvas chunk holds more of Konva than Core plus Rect/Text/Line
 *   (marker: none of the class names "Ellipse", "Arrow", "Star", "Wedge",
 *   "RegularPolygon"; "Transformer" and Filters are no markers, Konva core
 *   mentions them itself)
 * - the three JS files together exceed 350 KiB with gzip -9
 * - the bundle does not match src/ on disk (build/check-fresh.mjs: a source
 *   saved while vite was bundling, or no source maps to tell)
 * - (SPEC-M1 §24, R13) a bundled package without a LICENSE file of its own
 *   is not credited in js/vendor-*.chunk.mjs.license: qrcode-generator 1.5.2
 *   ships none, so the generated notice must name the package, its licence
 *   (MIT) and its author (Kazuhiko Arase) as soon as src/ imports it
 * Prints the sizes either way.
 *
 *   node build/check-bundle.mjs [rootDir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, gzipSync } from 'node:zlib'
import { checkFresh } from './check-fresh.mjs'

export const GZIP_BUDGET = 350 * 1024
export const FORBIDDEN_SHAPES = Object.freeze(['Ellipse', 'Arrow', 'Star', 'Wedge', 'RegularPolygon'])
/**
 * Bundled packages that bring no LICENSE file: the vendor notice must credit
 * them (name, licence, author) once src/ imports them (SPEC-M1 §24, R13).
 */
export const ATTRIBUTIONS = Object.freeze([
	Object.freeze({ name: 'qrcode-generator', license: 'MIT', author: 'Kazuhiko Arase' }),
])

/**
 * @param {string} s text
 * @return {string} s as a literal part of a RegExp
 */
function reEscape(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Checks the generated licence notice of the vendor chunk (the format of
 * @nextcloud/vite-config: "- <package>" followed by "\t- version: …" and
 * "\t- license: …" lines; authors as "SPDX-FileCopyrightText: …").
 *
 * @param {string} text content of js/vendor-*.chunk.mjs.license
 * @param {Array<{name: string, license: string, author: string}>} [list] required credits
 * @return {string[]} problems, empty when every package is credited
 */
export function checkAttribution(text, list = ATTRIBUTIONS) {
	const errors = []
	for (const a of list) {
		const block = new RegExp('^- ' + reEscape(a.name) + '\\r?\\n((?:\\t- .*(?:\\r?\\n|$))*)', 'm').exec(text)
		if (!block) {
			errors.push(`${a.name} is not named`)
		} else if (!new RegExp('^\\t- license: ' + reEscape(a.license) + '\\s*$', 'm').test(block[1])) {
			errors.push(`${a.name}: licence ${a.license} is not named`)
		}
		if (!text.includes(a.author)) {
			errors.push(`${a.name}: author ${a.author} is not named`)
		}
	}
	return errors
}

/**
 * @param {string} dir directory
 * @param {string[]} [out] accumulator
 * @return {string[]} .js/.mjs/.vue files below dir
 */
function sources(dir, out = []) {
	if (!existsSync(dir)) {
		return out
	}
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, e.name)
		if (e.isDirectory()) {
			sources(full, out)
		} else if (/\.(js|mjs|vue)$/.test(e.name)) {
			out.push(full)
		}
	}
	return out
}

/**
 * @param {string} root app root
 * @return {Array<{name: string, license: string, author: string}>} credits src/ needs (its imports)
 */
export function requiredAttributions(root) {
	const files = sources(join(root, 'src')).map((f) => readFileSync(f, 'utf8'))
	return ATTRIBUTIONS.filter((a) => files.some((src) => src.includes("from '" + a.name + "'")))
}

/**
 * @param {number} n bytes
 * @return {string} human readable KiB
 */
function kib(n) {
	return (n / 1024).toFixed(1) + ' KiB'
}

/**
 * @param {string} text chunk source
 * @param {string} name class name
 * @return {boolean} the class name occurs as a string literal
 */
function hasLiteral(text, name) {
	return text.includes('"' + name + '"') || text.includes('\'' + name + '\'') || text.includes('`' + name + '`')
}

/**
 * @param {string} root app root (contains js/ and css/)
 * @return {{ok: boolean, lines: string[], sizes: object}}
 */
export function checkBundle(root) {
	const lines = []
	const errors = []
	const jsDir = join(root, 'js')
	const files = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.mjs')).sort() : []
	const main = files.filter((f) => f === 'knorke-main.mjs')
	const vendor = files.filter((f) => /^vendor-[A-Za-z0-9_-]+\.chunk\.mjs$/.test(f))
	const canvas = files.filter((f) => /^canvas-[A-Za-z0-9_-]+\.chunk\.mjs$/.test(f))
	const other = files.filter((f) => !main.includes(f) && !vendor.includes(f) && !canvas.includes(f))
	if (main.length !== 1) {
		errors.push('js/knorke-main.mjs missing')
	}
	if (vendor.length !== 1) {
		errors.push(`expected exactly one js/vendor-*.chunk.mjs, found ${vendor.length}`)
	}
	if (canvas.length !== 1) {
		errors.push(`expected exactly one js/canvas-*.chunk.mjs, found ${canvas.length}`)
	}
	for (const f of other) {
		errors.push(`unexpected file js/${f} (lazy chunk?)`)
	}
	const css = join(root, 'css', 'knorke-style.css')
	if (!existsSync(css)) {
		errors.push('css/knorke-style.css missing')
	}
	const sizes = { files: {}, gzipTotal: 0, rawTotal: 0 }
	for (const f of [...main, ...vendor, ...canvas]) {
		const buf = readFileSync(join(jsDir, f))
		const gz = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }).length
		sizes.files[f] = { raw: buf.length, gzip: gz }
		sizes.rawTotal += buf.length
		sizes.gzipTotal += gz
		lines.push(`  js/${f.padEnd(34)} ${kib(buf.length).padStart(11)}  gzip -9 ${kib(gz).padStart(10)}`)
	}
	if (existsSync(css)) {
		const buf = readFileSync(css)
		const gz = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }).length
		sizes.css = { raw: buf.length, gzip: gz }
		lines.push(`  css/knorke-style.css${' '.repeat(18)} ${kib(buf.length).padStart(11)}  gzip -9 ${kib(gz).padStart(10)}`)
	}
	lines.push(`  JS total ${kib(sizes.rawTotal)}, gzip -9 ${kib(sizes.gzipTotal)} (budget ${kib(GZIP_BUDGET)})`)
	if (sizes.gzipTotal > GZIP_BUDGET) {
		errors.push(`JS gzip -9 total ${kib(sizes.gzipTotal)} exceeds ${kib(GZIP_BUDGET)}`)
	}
	if (canvas.length === 1) {
		const text = readFileSync(join(jsDir, canvas[0]), 'utf8')
		const found = FORBIDDEN_SHAPES.filter((n) => hasLiteral(text, n))
		if (found.length > 0) {
			errors.push(`canvas chunk contains more Konva shapes than Rect/Text/Line: ${found.join(', ')}`)
		}
		if (!hasLiteral(text, 'Rect')) {
			lines.push('  note: canvas chunk has no "Rect" literal (scene not bundled yet?)')
		}
	}
	const credits = requiredAttributions(root)
	if (credits.length > 0 && vendor.length === 1) {
		const notice = join(jsDir, vendor[0] + '.license')
		if (!existsSync(notice)) {
			errors.push(`js/${vendor[0]}.license missing (credits for ${credits.map((a) => a.name).join(', ')})`)
		} else {
			for (const e of checkAttribution(readFileSync(notice, 'utf8'), credits)) {
				errors.push(`js/${vendor[0]}.license: ${e}`)
			}
			lines.push(`  licence notice credits ${credits.map((a) => `${a.name} (${a.license}, ${a.author})`).join(', ')}`)
		}
	}
	const fresh = checkFresh(root)
	lines.push(...fresh.lines)
	errors.push(...fresh.errors)
	for (const e of errors) {
		lines.push('  ERROR ' + e)
	}
	return { ok: errors.length === 0, lines, sizes }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const root = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), '..')
	if (!statSync(root).isDirectory()) {
		console.error('not a directory: ' + root)
		process.exit(1)
	}
	const { ok, lines } = checkBundle(root)
	console.log('check-bundle ' + (ok ? 'OK' : 'FAILED'))
	for (const l of lines) {
		console.log(l)
	}
	process.exit(ok ? 0 : 1)
}
