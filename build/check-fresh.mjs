/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Checks that the built bundle in js/ matches the sources in src/ on disk:
 * every src/ entry of every js/*.map must carry `sourcesContent` that is
 * byte-identical to the file it names. A bundle built before a later edit of
 * a source (another package saved a file after the last dev/build.sh, or
 * during it) fails with the list of differing files. Run it before every
 * E2E run or wave on a shared copy, and check-bundle.mjs runs it after
 * every `npm run build` (a file saved while vite was bundling).
 *
 * Exit 1 when a src/ entry differs, is gone from disk or has no
 * sourcesContent, or when js/ holds no .map at all. Entries outside src/
 * (node_modules, virtual modules) and entries with a query (`?vue&type=…`,
 * only part of a file) are not compared. src/ files that no map names are
 * listed as a note (re-export barrels such as src/scene/index.js carry no
 * code of their own).
 *
 * CSS (SPEC-M1 §9.5 WP-C4 (b), R19 T4-26): css/knorke-style.css has no map,
 * so the build records a SHA-256 of every src/styles/*.css in
 * js/knorke-style.fresh.json (build/style-fresh.mjs, the plugin of
 * vite.config.js: hook `transform`, the text vite translates, never read
 * again after the build). Every
 * src/styles/*.css on disk must match its entry; a missing file or entry, an
 * entry whose source is gone and an unreadable record fail as well. The
 * record is no .mjs (not one of the three bundle files) and does not change
 * the shipped js/ or css/. The first output line stays as it was; an
 * indented line "css: <n> src/styles entries, <k> differing, <m> missing"
 * follows it.
 *
 *   node build/check-fresh.mjs [rootDir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLE_RECORD, STYLE_SOURCE, styleHash } from './style-fresh.mjs'

const CODE_FILE = /\.(?:m?js|vue|ts)$/

/**
 * The CSS part (SPEC-M1 §9.5 WP-C4 (b)): every src/styles/*.css against its
 * entry in js/knorke-style.fresh.json.
 *
 * @param {string} root app root
 * @return {{checked: number, differ: string[], missing: string[], errors: string[]}}
 */
export function checkStyles(root) {
	const dir = join(root, 'src', 'styles')
	const files = existsSync(dir)
		? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => 'src/styles/' + e.name).filter((r) => STYLE_SOURCE.test(r)).sort()
		: []
	const differ = []
	const missing = []
	const errors = []
	const record = join(root, 'js', STYLE_RECORD)
	let entries = null
	if (existsSync(record)) {
		try {
			const raw = JSON.parse(readFileSync(record, 'utf8'))
			entries = raw && typeof raw.files === 'object' && raw.files !== null && !Array.isArray(raw.files) ? raw.files : null
			if (entries === null) {
				errors.push(`js/${STYLE_RECORD} has no "files" map`)
			}
		} catch (e) {
			errors.push(`js/${STYLE_RECORD} is not valid JSON (${e.message})`)
		}
	} else if (files.length > 0) {
		errors.push(`no js/${STYLE_RECORD}: cannot tell which CSS sources css/knorke-style.css was built from`)
	}
	for (const rel of files) {
		const want = entries !== null && Object.prototype.hasOwnProperty.call(entries, rel) ? entries[rel] : undefined
		if (typeof want !== 'string') {
			missing.push(rel)
			errors.push(`stale CSS: ${rel} has no entry in js/${STYLE_RECORD}`)
		} else if (styleHash(readFileSync(join(root, rel), 'utf8')) !== want) {
			differ.push(rel)
			errors.push(`stale CSS: ${rel} differs from the source of css/knorke-style.css`)
		}
	}
	for (const rel of Object.keys(entries ?? {}).sort()) {
		if (!files.includes(rel)) {
			missing.push(rel)
			errors.push(`stale CSS: ${rel} is recorded in js/${STYLE_RECORD} but gone from disk`)
		}
	}
	return { checked: files.length, differ, missing, errors }
}

/**
 * @param {string} dir directory
 * @return {string[]} absolute paths of all files below dir
 */
function walk(dir) {
	const out = []
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name)
		if (e.isDirectory()) {
			out.push(...walk(p))
		} else if (e.isFile()) {
			out.push(p)
		}
	}
	return out
}

/**
 * @param {string} root app root (contains js/ and src/)
 * @return {{ok: boolean, lines: string[], errors: string[], checked: number, differ: string[], missing: string[], unverifiable: string[], unmapped: string[], maps: string[],
 *   css: {checked: number, differ: string[], missing: string[], errors: string[]}}}
 */
export function checkFresh(root) {
	const jsDir = join(root, 'js')
	const srcDir = join(root, 'src')
	const maps = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.mjs.map')).sort() : []
	const differ = []
	const missing = []
	const unverifiable = []
	const errors = []
	const seen = new Set()
	let checked = 0
	if (maps.length === 0) {
		errors.push('no js/*.mjs.map: cannot tell which sources the bundle was built from')
	}
	for (const f of maps) {
		let map
		try {
			map = JSON.parse(readFileSync(join(jsDir, f), 'utf8'))
		} catch (e) {
			errors.push(`js/${f} is not valid JSON (${e.message})`)
			continue
		}
		const sources = Array.isArray(map.sources) ? map.sources : []
		const base = resolve(jsDir, typeof map.sourceRoot === 'string' ? map.sourceRoot : '')
		sources.forEach((s, i) => {
			if (typeof s !== 'string' || s.includes('?') || s.includes('\0')) {
				return
			}
			const abs = resolve(base, s)
			if (abs !== srcDir && !abs.startsWith(srcDir + sep)) {
				return
			}
			const rel = relative(root, abs).split(sep).join('/')
			seen.add(rel)
			checked++
			const content = Array.isArray(map.sourcesContent) ? map.sourcesContent[i] : undefined
			if (typeof content !== 'string') {
				unverifiable.push(`${rel} [js/${f}]`)
				return
			}
			if (!existsSync(abs)) {
				missing.push(`${rel} [js/${f}]`)
				return
			}
			if (readFileSync(abs, 'utf8') !== content) {
				differ.push(`${rel} [js/${f}]`)
			}
		})
	}
	const unmapped = existsSync(srcDir)
		? walk(srcDir).map((p) => relative(root, p).split(sep).join('/')).filter((r) => CODE_FILE.test(r) && !seen.has(r)).sort()
		: []
	for (const d of differ) {
		errors.push(`stale bundle: ${d} differs from the file on disk`)
	}
	for (const m of missing) {
		errors.push(`stale bundle: ${m} no longer exists`)
	}
	for (const u of unverifiable) {
		errors.push(`cannot verify ${u}: no sourcesContent`)
	}
	const css = checkStyles(root)
	errors.push(...css.errors)
	const lines = [
		`  ${checked} src/ entries in ${maps.length} maps, ${differ.length} differing, ${missing.length} missing, ${unverifiable.length} without sourcesContent`,
		`  css: ${css.checked} src/styles entries, ${css.differ.length} differing, ${css.missing.length} missing`,
	]
	if (unmapped.length > 0) {
		lines.push(`  note: in no map (no code of their own or not imported): ${unmapped.join(', ')}`)
	}
	if (differ.length + missing.length + css.differ.length + css.missing.length > 0) {
		lines.push('  rebuild with dev/build.sh once the sources are final')
	}
	return { ok: errors.length === 0, lines, errors, checked, differ, missing, unverifiable, unmapped, maps, css }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const root = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), '..')
	if (!statSync(root).isDirectory()) {
		console.error('not a directory: ' + root)
		process.exit(1)
	}
	const { ok, lines, errors } = checkFresh(root)
	console.log('check-fresh ' + (ok ? 'OK' : 'FAILED'))
	for (const l of lines) {
		console.log(l)
	}
	for (const e of errors) {
		console.log('  ERROR ' + e)
	}
	process.exit(ok ? 0 : 1)
}
