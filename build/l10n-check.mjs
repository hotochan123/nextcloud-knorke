/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Compares the translatable source texts with l10n/<lang>.json (ESM port of
 * the Pulse script build/l10n-check.js, SPEC-M0 §0, §6.9).
 *
 * The source language is English; German comes from l10n/de.json. A missing
 * entry makes the German UI show English, which is easy to miss while
 * clicking through, but shows up here at once. Exit 1 when anything is
 * missing, orphaned or has mismatched placeholders.
 *
 *   npm run l10n:check
 *
 * Call forms found (the app id is always written out):
 *   t('knorke', 'Text'[, vars])
 *   n('knorke', 'Singular', 'Plural', count[, vars])  → key _Singular_::_Plural_
 * (Nextcloud stores plurals under the combined key; the halves are no keys.)
 *
 * The texts of SPEC-M0 §6.9 belong to the scene [S]. They count as used even
 * while no source file uses them yet, so this check never depends on another
 * package's progress; a scene text outside that list shows up as missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Texts reserved for the scene (SPEC-M0 §6.9). */
export const SCENE_TEXTS = Object.freeze([
	'{name} is editing…',
	'Take over',
	'{name} (guest)',
	'Unknown item type: {type}',
])

const STR = '\'((?:[^\'\\\\]|\\\\.)*)\''
const SINGULAR = [
	new RegExp('\\bt\\(\\s*\'knorke\'\\s*,\\s*' + STR, 'g'),
	new RegExp('->t\\(\\s*' + STR, 'g'),
]
const PLURAL = [
	new RegExp('\\bn\\(\\s*\'knorke\'\\s*,\\s*' + STR + '\\s*,\\s*' + STR, 'g'),
	new RegExp('->n\\(\\s*' + STR + '\\s*,\\s*' + STR, 'g'),
]

/**
 * @param {string} dir directory
 * @param {string[]} exts file extensions
 * @param {string[]} [out] accumulator
 * @return {string[]} files below dir
 */
function walk(dir, exts, out = []) {
	if (!existsSync(dir)) {
		return out
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			walk(full, exts, out)
		} else if (exts.some((e) => entry.name.endsWith(e))) {
			out.push(full)
		}
	}
	return out
}

/**
 * @param {string} s source literal content
 * @return {string} unescaped text
 */
function unescape(s) {
	return s.replace(/\\(['\\])/g, '$1')
}

/**
 * @param {string} s text
 * @return {string} sorted placeholders ({name}, %n) as one string
 */
function placeholders(s) {
	return [...new Set(s.match(/\{[a-zA-Z0-9_]+\}|%n/g) ?? [])].sort().join(',')
}

/**
 * Scans the sources.
 *
 * @param {string} [base] repository root
 * @return {Map<string, Set<string>>} key → files
 */
export function scan(base = root) {
	const found = new Map()
	const note = (key, rel) => {
		if (!found.has(key)) {
			found.set(key, new Set())
		}
		found.get(key).add(rel)
	}
	const files = [
		...walk(join(base, 'src'), ['.vue', '.js', '.mjs']),
		...walk(join(base, 'lib'), ['.php']),
	]
	for (const file of files) {
		if (!statSync(file).isFile()) {
			continue
		}
		const src = readFileSync(file, 'utf8')
		const rel = relative(base, file)
		for (const re of PLURAL) {
			re.lastIndex = 0
			let m
			while ((m = re.exec(src)) !== null) {
				note('_' + unescape(m[1]) + '_::_' + unescape(m[2]) + '_', rel)
			}
		}
		for (const re of SINGULAR) {
			re.lastIndex = 0
			let m
			while ((m = re.exec(src)) !== null) {
				note(unescape(m[1]), rel)
			}
		}
	}
	return found
}

/**
 * @param {string} [base] repository root
 * @return {{ok: boolean, lines: string[]}} result and report lines
 */
export function check(base = root) {
	const found = scan(base)
	const lines = []
	let bad = 0
	const known = new Set([...found.keys(), ...SCENE_TEXTS])
	const dir = join(base, 'l10n')
	const langs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []
	if (langs.length === 0) {
		lines.push('no l10n/*.json found')
		bad++
	}
	for (const file of langs) {
		const lang = file.replace(/\.json$/, '')
		const translations = JSON.parse(readFileSync(join(dir, file), 'utf8')).translations ?? {}
		const missing = [...known].filter((s) => !(s in translations))
		const orphan = Object.keys(translations).filter((s) => !known.has(s))
		const mismatched = Object.keys(translations).filter((s) => known.has(s)).filter((s) => {
			const v = translations[s]
			if (typeof v === 'string') {
				return placeholders(s) !== placeholders(v)
			}
			if (Array.isArray(v)) {
				return v.some((x) => typeof x !== 'string' || placeholders(x) !== placeholders(s.replace(/^_|_$/g, '')))
			}
			return true
		})
		const empty = Object.keys(translations).filter((s) => {
			const v = translations[s]
			return typeof v === 'string' ? v.trim() === '' : !Array.isArray(v) || v.some((x) => String(x).trim() === '')
		})
		lines.push(`${lang}: ${found.size} source texts (+${SCENE_TEXTS.filter((s) => !found.has(s)).length} reserved for the scene), `
			+ `${missing.length} missing, ${orphan.length} orphaned, ${mismatched.length} placeholder mismatches, ${empty.length} empty`)
		for (const s of missing) {
			lines.push(`  MISSING   ${JSON.stringify(s)}  (${[...(found.get(s) ?? ['§6.9'])].join(', ')})`)
		}
		for (const s of orphan) {
			lines.push(`  ORPHANED  ${JSON.stringify(s)}`)
		}
		for (const s of mismatched) {
			lines.push(`  PLACEHOLDERS ${JSON.stringify(s)} → ${JSON.stringify(translations[s])}`)
		}
		for (const s of empty) {
			lines.push(`  EMPTY     ${JSON.stringify(s)}`)
		}
		bad += missing.length + orphan.length + mismatched.length + empty.length
	}
	if (found.size === 0) {
		lines.push('No translatable texts found. Does the pattern still match?')
		bad++
	}
	return { ok: bad === 0, lines }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const { ok, lines } = check()
	for (const l of lines) {
		console.log(l)
	}
	process.exit(ok ? 0 : 1)
}
