/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Checks the shape of the bundle after every `npm run build` (SPEC-M0 §7.4).
 * Exit 1 when:
 * - js/ holds other .mjs files than exactly knorke-main.mjs, one
 *   vendor-*.chunk.mjs, one canvas-*.chunk.mjs, (factory job 172) one
 *   emoji-*.chunk.mjs and (factory job 217) one chunk of each lazy part of
 *   build/lazy-areas.mjs, LAZY_CHUNKS (vector, bpmn, shapelib, admin,
 *   share, ai); any other chunk would mean extra requests on a cold page
 * - (job 217) a lazy part's chunk exceeds LAZY_BUDGET with gzip -9, its
 *   source map lacks one of the part's roots, a map of main, vendor or
 *   canvas names one of them (the part would load with the page), main,
 *   vendor or canvas import the chunk statically, or main has no dynamic
 *   import("./<chunk>") of it
 * - (job 217) any other file imports js/knorke-main.mjs: Nextcloud loads it
 *   with ?v=…, so the import would run a second copy of the app
 * - (job 172) the emoji chunk (emoji-mart-vue-fast with its data and
 *   NcEmojiPicker, loaded by "More…" of the reaction picker) exceeds
 *   EMOJI_BUDGET with gzip -9, or does not hold the marker EMOJI_MARKER
 *   (EmojiIndex, compared case-insensitively: the minifier keeps the
 *   property emojiIndex), or main, vendor or canvas hold that marker, or one
 *   of them imports the emoji chunk statically, or main has no dynamic
 *   import("./emoji-…") of it
 * - css/knorke-style.css is missing
 * - the canvas chunk holds more of Konva than Core plus Rect/Text/Line
 *   (marker: none of the class names "Ellipse", "Arrow", "Star", "Wedge",
 *   "RegularPolygon"; "Transformer" and Filters are no markers, Konva core
 *   mentions them itself)
 * - the three JS files main, vendor and canvas together exceed 506 KiB
 *   with gzip -9 (350 until factory job 155, whose undo rule needed the
 *   room: main stood at 349.8; 360 until factory job 172, reactions: 364.2;
 *   370 until factory job 173, tables: 374.9 after the merge with job 172;
 *   380 until factory job 178, save as image: 378.1 before it, 380.5 with it;
 *   390 until factory job 182, template suggestions: 385.7 before it, 390.6
 *   with it; 400 until factory job 189, comments: 391.1 before it, 401.2
 *   with it; 410 until factory job 191, tags: 403.5 before it, 411.6 with
 *   it; 420 until factory job 195, mind maps: 427.6 with it; 434 until
 *   factory job 199, swimlanes: 437.1 with it; 438 until factory job 198,
 *   org charts and trees: 439.0 after the merge with job 199; 442 until
 *   factory job 200, SVG and PDF export: 449.6 with it; 452 until factory
 *   job 201, shapes panel (ten flowchart shapes, 20 symbols, the panel):
 *   458.3 after the merge with job 200; 460 until factory job 203, own shape
 *   libraries (import, panel, admin section, pictures on the board): 466.9
 *   with it, 468.0 after the merge with job 202; 476 until factory job 205, BPMN
 *   files (export, import, XML reader): 472.3 before it, 479.2 with it; 482
 *   until factory job 208, swimlane columns: 480.2 before it, 483.4 with it,
 *   484.6 after the merge with jobs 206 and 209; 485 until factory job 210,
 *   shrinking pictures at import: 485.1 after the merge with job 208; 486
 *   until factory job 216, votes from two tabs: 486.0 before it, 486.3 with
 *   it; 487 until factory job 217, rarely used parts loaded on first use:
 *   486.3 before it, 445.1 after the merge with job 216; 446 until factory
 *   job 219, board list favorites and sort order: 445.1 before it, 446.3
 *   with it; 447 until factory job 220, CSV import: 447.1 after the merge
 *   with job 219; 448 until factory job 223, show everything clear of the
 *   bars: 447.7 before it, 448.0 with it; 449 until factory job 225, lane
 *   and column groups: 451.8 with it, 452.2 after the merge with job 223;
 *   453 until factory job 226, redesign foundation (MDI outline icons,
 *   longer paths): 452.2 before it, 455.2 after the merge with job 225;
 *   456 until factory job 227, one palette and note text sizes: 455.2
 *   before it, 456.4 with it; 457 until factory job 228, redesign header
 *   (two islands, the submenus of "More", one closable notice): 457.06
 *   with it, 458.3 after the merge with job 227; 459 until factory job
 *   230, redesign context bar ("…" as NcActions, the colour panel's tabs,
 *   grouped right-click menu, narrowing by tag): 458.3 before it, 459.8
 *   with it; 460 until factory job 229, redesign tool and zoom bars
 *   (variant popovers, zoom menu, undo island): 460.0 with it, 461.9 after
 *   the merge with job 230; 462 until factory job 231, redesign selection
 *   (rotation handle and connection points near the pointer, the look of a
 *   pen or a finger, the primary color): 461.9 before it, 463.2 with it;
 *   464 until factory job 232, redesign board list (cards, switch "Grid /
 *   List", the phone's sheet, one template grid for "New board", the
 *   empty board and "Insert template"): 464.0 with it, 465.3 after the
 *   merge with job 231; 466 until factory job 233, redesign session bar
 *   (one bar for timer, vote and presenting, the "+" badges with their hit
 *   test, "Edit voting", the two-line fallback when one line does not fit):
 *   463.2 before it, 466.2 with it, 468.2 after the merge with job 232;
 *   469 until factory job 240, the tick "1:1" in "Arrange": 469.5 with it;
 *   470 until factory job 243, the frame title as a tab (its tones, their
 *   OKLCH rule, the outline round tab and frame, the dashed hint): 471.4 with it;
 *   472 until factory job 244, Phosphor icons (about a hundred paths of
 *   the shell and the 20 symbols with their Duotone layer, verbatim): 471.4
 *   before it, 474.3 with it after the merge with job 243; 475 until factory
 *   job 253, export and file insert in their own module (the host callbacks
 *   and the session's thin methods): 474.6 before it, 475.5 with it; 476
 *   until factory job 255, comments, reactions and the laser in their own
 *   module (40 thin methods of the session): 475.5 before it, 476.5 with it;
 *   477 until factory job 257, tags in their own module (28 thin methods of
 *   the session): 476.5 before it, 477.0 with it; 478 until factory job
 *   259, notes in the look of redesign round 3 (two shadows, edge, dog
 *   ear): 477.5 before it, 478.6 with it; 479 until factory job 260,
 *   shapes in the look of design round 3: 479.2 after the merge with job
 *   259; 480 until factory job 262, frames in the look of design round 4
 *   (outline in the strong tone, the selection round frame and tab, round
 *   handles, the 24-px "+" buttons): 480.5 with it; 481 until factory job
 *   264, swimlanes in the look of design round 4: 481.0 before it, 481.1
 *   with it; 482 until factory job 266, mind maps, org charts and trees in
 *   the look of design round 4 (tapering branches, "+n" badges, cards with
 *   bands, "+" off the text): 481.6 before it, 483.0 with it; 484 until
 *   factory job 267, AI summaries and clustering (the card, its Markdown,
 *   the bar buttons, the notice and the chip): 483.0 before it, 488.2 with it;
 *   489 until factory job 268, a mind map, org chart or tree from a prompt
 *   (the tool bar button, the diagram flow and the insert; the window and
 *   its preview in the lazy part ai): 488.3 before it, 490.2 with it;
 *   491 until factory job 272, frames as slides (the presentation layer,
 *   the slide list, the presenter's slide show): 490.5 before it, 495.1
 *   with it; 496 until factory job 273, pen, highlighter and eraser (the
 *   stroke type, its node and preview layer, the input and the tool's
 *   variants): 490.2 before it, 494.0 with it, 498.6 after the merge with
 *   job 272; 499 until factory job 274, board as an outline: 499.4 after
 *   the merge with job 273; 500 until factory job 279, Markdown in notes,
 *   shapes, text items and cells (the parser, the rich text node, the
 *   editor's buttons, "Open link"): 499.4 before it, 504.3 with it; 505
 *   until factory job 279, Markdown in texts: 505.2 after the merge with
 *   job 278)
 * - the bundle does not match src/ on disk (build/check-fresh.mjs: a source
 *   saved while vite was bundling, or no source maps to tell)
 * - (SPEC-M1 §24, R13) a bundled package without a LICENSE file of its own
 *   is not credited in js/vendor-*.chunk.mjs.license: qrcode-generator 1.5.2
 *   ships none, so the generated notice must name the package, its licence
 *   (MIT) and its author (Kazuhiko Arase) as soon as src/ imports it; (job
 *   217) the notice of the chunk that holds it (its source map names the
 *   package), since then js/share-*.chunk.mjs
 * Prints the sizes either way.
 *
 *   node build/check-bundle.mjs [rootDir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, gzipSync } from 'node:zlib'
import { checkFresh } from './check-fresh.mjs'
import { LAZY_AREAS } from './lazy-areas.mjs'

export const GZIP_BUDGET = 506 * 1024
/** (job 172) gzip -9 budget of the one lazy emoji chunk. */
export const EMOJI_BUDGET = 160 * 1024
/** (job 217) The lazy parts: chunk name → the roots it must hold (build/lazy-areas.mjs). */
export const LAZY_CHUNKS = LAZY_AREAS
/** (job 217) gzip -9 budget of each lazy part's chunk. */
export const LAZY_BUDGET = 32 * 1024
/** (job 172) The marker of the emoji list, compared case-insensitively. */
export const EMOJI_MARKER = 'EmojiIndex'
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
 * @param {string} text chunk source
 * @return {boolean} it holds EMOJI_MARKER (case-insensitive)
 */
export function hasEmojiMarker(text) {
	return text.toLowerCase().includes(EMOJI_MARKER.toLowerCase())
}

/**
 * @param {string} text chunk source
 * @param {string} file name of the emoji chunk
 * @return {boolean} a static import of it (import … from "./file", import "./file", export … from "./file")
 */
export function importsStatically(text, file) {
	const name = reEscape('./' + file)
	return new RegExp('(?:\\bimport|\\bexport)\\s*(?:[^;()"\'`]*?\\bfrom\\s*)?["\'`]' + name + '["\'`]').test(text)
}

/**
 * The rules of the emoji chunk (job 172, header).
 *
 * @param {string} jsDir js/
 * @param {{main: string[], vendor: string[], canvas: string[], emoji: string[]}} f the bundle files
 * @param {object} sizes sizes so far (gets sizes.emoji)
 * @param {string[]} lines report lines (gets the size line)
 * @return {string[]} errors
 */
function checkEmoji(jsDir, f, sizes, lines) {
	const errors = []
	const read = (x) => readFileSync(join(jsDir, x), 'utf8')
	for (const x of [...f.main, ...f.vendor, ...f.canvas]) {
		if (hasEmojiMarker(read(x))) {
			errors.push(`js/${x} holds the emoji list (marker ${EMOJI_MARKER})`)
		}
	}
	if (f.emoji.length !== 1) {
		return errors
	}
	const e = f.emoji[0]
	const buf = readFileSync(join(jsDir, e))
	const gz = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }).length
	sizes.emoji = { file: e, raw: buf.length, gzip: gz }
	lines.push(`  js/${e.padEnd(34)} ${kib(buf.length).padStart(11)}  gzip -9 ${kib(gz).padStart(10)} (lazy, budget ${kib(EMOJI_BUDGET)})`)
	if (gz > EMOJI_BUDGET) {
		errors.push(`js/${e} gzip -9 ${kib(gz)} exceeds ${kib(EMOJI_BUDGET)}`)
	}
	if (!hasEmojiMarker(buf.toString('utf8'))) {
		errors.push(`js/${e} does not hold the emoji list (marker ${EMOJI_MARKER})`)
	}
	for (const x of [...f.main, ...f.vendor, ...f.canvas]) {
		if (importsStatically(read(x), e)) {
			errors.push(`js/${x} imports js/${e} statically`)
		}
	}
	for (const x of f.main) {
		if (!read(x).includes('import("./' + e + '")')) {
			errors.push(`js/${x} has no dynamic import("./${e}")`)
		}
	}
	return errors
}

/**
 * @param {string} root app root
 * @param {string} jsDir js/
 * @param {string} file a bundle file
 * @return {string[]|null} the sources its map names, relative to root with forward slashes; null without a readable map
 */
function mapSources(root, jsDir, file) {
	try {
		const map = JSON.parse(readFileSync(join(jsDir, file + '.map'), 'utf8'))
		return Array.isArray(map.sources) ? map.sources.map((x) => relative(root, resolve(jsDir, String(x))).split(sep).join('/')) : null
	} catch {
		return null
	}
}

/**
 * The rules of the lazy parts (job 217, header).
 *
 * @param {string} root app root
 * @param {string} jsDir js/
 * @param {{main: string[], vendor: string[], canvas: string[], lazy: Object<string, string[]>}} f the bundle files
 * @param {object} sizes sizes so far (gets sizes.lazy)
 * @param {string[]} lines report lines (gets the size lines)
 * @return {string[]} errors
 */
function checkLazy(root, jsDir, f, sizes, lines) {
	const errors = []
	const read = (x) => readFileSync(join(jsDir, x), 'utf8')
	const eager = [...f.main, ...f.vendor, ...f.canvas]
	const eagerSources = eager.map((x) => [x, new Set(mapSources(root, jsDir, x) ?? [])])
	sizes.lazy = {}
	for (const [name, roots] of Object.entries(LAZY_CHUNKS)) {
		for (const [x, set] of eagerSources) {
			for (const r of roots.filter((y) => set.has(y))) {
				errors.push(`js/${x} holds ${r} (lazy part ${name})`)
			}
		}
		if (f.lazy[name].length !== 1) {
			continue
		}
		const c = f.lazy[name][0]
		const buf = readFileSync(join(jsDir, c))
		const gz = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }).length
		sizes.lazy[name] = { file: c, raw: buf.length, gzip: gz }
		lines.push(`  js/${c.padEnd(34)} ${kib(buf.length).padStart(11)}  gzip -9 ${kib(gz).padStart(10)} (lazy, budget ${kib(LAZY_BUDGET)})`)
		if (gz > LAZY_BUDGET) {
			errors.push(`js/${c} gzip -9 ${kib(gz)} exceeds ${kib(LAZY_BUDGET)}`)
		}
		const own = mapSources(root, jsDir, c)
		if (own === null) {
			errors.push(`js/${c}.map missing or unreadable`)
		} else {
			for (const r of roots.filter((y) => !own.includes(y))) {
				errors.push(`js/${c} does not hold ${r}`)
			}
		}
		for (const x of eager.filter((y) => importsStatically(read(y), c))) {
			errors.push(`js/${x} imports js/${c} statically`)
		}
		for (const x of f.main.filter((y) => !read(y).includes('import("./' + c + '")'))) {
			errors.push(`js/${x} has no dynamic import("./${c}")`)
		}
	}
	return errors
}

/**
 * (Job 217) Where a package lives: the bundle file whose source map names it, else the vendor chunk.
 *
 * @param {string} root app root
 * @param {string} jsDir js/
 * @param {string[]} files the .mjs files of js/
 * @param {string} name package name
 * @param {string|undefined} vendor the vendor chunk
 * @return {string|undefined}
 */
function holderOf(root, jsDir, files, name, vendor) {
	const mark = 'node_modules/' + name + '/'
	return files.find((x) => (mapSources(root, jsDir, x) ?? []).some((y) => y.includes(mark))) ?? vendor
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
	const emoji = files.filter((f) => /^emoji-[A-Za-z0-9_-]+\.chunk\.mjs$/.test(f))
	const lazy = Object.fromEntries(Object.keys(LAZY_CHUNKS).map((n) => [n, files.filter((f) => f.startsWith(n + '-') && /^[a-z]+-[A-Za-z0-9_-]+\.chunk\.mjs$/.test(f))]))
	const known = new Set([...main, ...vendor, ...canvas, ...emoji, ...Object.values(lazy).flat()])
	const other = files.filter((f) => !known.has(f))
	if (main.length !== 1) {
		errors.push('js/knorke-main.mjs missing')
	}
	if (vendor.length !== 1) {
		errors.push(`expected exactly one js/vendor-*.chunk.mjs, found ${vendor.length}`)
	}
	if (canvas.length !== 1) {
		errors.push(`expected exactly one js/canvas-*.chunk.mjs, found ${canvas.length}`)
	}
	if (emoji.length !== 1) {
		errors.push(`expected exactly one js/emoji-*.chunk.mjs, found ${emoji.length}`)
	}
	for (const [n, list] of Object.entries(lazy)) {
		if (list.length !== 1) {
			errors.push(`expected exactly one js/${n}-*.chunk.mjs, found ${list.length}`)
		}
	}
	for (const f of other) {
		errors.push(`unexpected file js/${f} (lazy chunk?)`)
	}
	// job 217: nothing may import the entry (Nextcloud loads it with ?v=…: a second copy of the app)
	for (const f of files.filter((x) => !main.includes(x))) {
		const text = readFileSync(join(jsDir, f), 'utf8')
		if (importsStatically(text, 'knorke-main.mjs') || text.includes('import("./knorke-main.mjs")')) {
			errors.push(`js/${f} imports js/knorke-main.mjs (a second copy of the app)`)
		}
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
	lines.push(`  JS total ${kib(sizes.rawTotal)}, gzip -9 ${kib(sizes.gzipTotal)} (budget ${kib(GZIP_BUDGET)}; main, vendor and canvas)`)
	if (sizes.gzipTotal > GZIP_BUDGET) {
		errors.push(`JS gzip -9 total ${kib(sizes.gzipTotal)} exceeds ${kib(GZIP_BUDGET)}`)
	}
	errors.push(...checkEmoji(jsDir, { main, vendor, canvas, emoji }, sizes, lines))
	errors.push(...checkLazy(root, jsDir, { main, vendor, canvas, lazy }, sizes, lines))
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
	// job 217: each credit in the notice of the chunk that holds the package
	for (const a of requiredAttributions(root)) {
		const holder = holderOf(root, jsDir, files, a.name, vendor.length === 1 ? vendor[0] : undefined)
		if (!holder) {
			continue
		}
		const notice = join(jsDir, holder + '.license')
		if (!existsSync(notice)) {
			errors.push(`js/${holder}.license missing (credits for ${a.name})`)
			continue
		}
		const found = checkAttribution(readFileSync(notice, 'utf8'), [a])
		for (const e of found) {
			errors.push(`js/${holder}.license: ${e}`)
		}
		if (found.length === 0) {
			lines.push(`  licence notice js/${holder}.license credits ${a.name} (${a.license}, ${a.author})`)
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
