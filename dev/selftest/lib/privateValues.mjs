/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Private host values that must not reach the public repository (SPEC-M1
 * §12.1 R16, docs/ENTWICKLUNG.md §3.10): the LAN of the development host,
 * its host paths and its private domain. The dev scripts take such values
 * from the environment or the untracked dev/local.env instead.
 *
 * Two kinds of check:
 * - PRIVATE_PATTERNS: generic regular expressions (the router's LAN, the
 *   host's mount root, its appdata layout), case-insensitive. Their own
 *   source text does not match them (an escaped dot or slash is no dot or
 *   slash).
 * - PRIVATE_DOMAIN_DIGESTS: the private domain of the development host is
 *   known here only as the SHA-256 of its lower-case registrable name, so
 *   the public tree never names it. Every host-name-like token of a path or
 *   line (labels of a–z, 0–9 and "-", joined by dots) is lower-cased, and
 *   every run of at least two consecutive labels in it is hashed and compared:
 *   any subdomain matches, and so does the name inside a longer token (a
 *   file name with an extension), because the name would be readable there.
 *   For the same reason a dot written the way a regular expression writes it
 *   counts as a dot: name\.tld, name\\.tld (any number of backslashes, as in
 *   a JS or JSON string) and name[.]tld.
 *
 * scanTree(root) checks every file git would publish from root – tracked
 * files and untracked ones that are not ignored (git ls-files --cached
 * --others --exclude-standard) – except the paths below factory/ and .claude/
 * (not part of the public repository). Deleted files, symlinks and anything
 * that is no regular file are skipped. It checks the path itself (line 0) and
 * every line of the content read as UTF-8. No other exception, not even for
 * this file or its test, which builds its examples at run time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

/** Case-insensitive, generic (no name of this installation in them). */
export const PRIVATE_PATTERNS = Object.freeze([
	/192\.168\.178\./i,
	/\/mnt\//i,
	/appdata\/docker/i,
])

/** SHA-256 (hex) of the private domain of the development host, lower case, registrable name. */
export const PRIVATE_DOMAIN_DIGESTS = Object.freeze([
	'59df654b4251f250cfe4ea5550db957f54ffb19aa709cc77c7ec162f7ffdb482',
])

/** Top-level folders that are not part of the public repository. */
export const EXCLUDED = Object.freeze(['factory/', '.claude/'])

/** Longest label run that is hashed (a domain of up to this many labels is found). */
const MAX_LABELS = 8

/**
 * Git variables dropped from the environment of every git call that must
 * reach a given repository (scannedFiles, the self-tests): a calling git hook
 * sets them, and they would redirect git to the hook's repository.
 */
export const GIT_REDIRECT_VARS = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'])

/** @param {string} s @return {string} SHA-256 of s, hex */
export function sha256(s) {
	return createHash('sha256').update(s).digest('hex')
}

/**
 * Every run of 2–MAX_LABELS consecutive labels of every host-name-like token
 * in text, lower case; "\.", "\\." (any number of backslashes) and "[.]"
 * count as "." (backslashes first, then brackets, so "[\.]" and "[\\.]" do too).
 * @param {string} text
 * @return {Set<string>}
 */
export function labelRuns(text) {
	const runs = new Set()
	const dotted = text.replace(/\\+\./g, '.').replace(/\[\.\]/g, '.')
	for (const [token] of dotted.matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
		const labels = token.toLowerCase().split('.')
		for (let i = 0; i < labels.length; i++) {
			for (let j = i + 2; j <= Math.min(labels.length, i + MAX_LABELS); j++) runs.add(labels.slice(i, j).join('.'))
		}
	}
	return runs
}

/**
 * The checks of one path or line that hit: the source of each matching
 * pattern, "domain sha256:<first 12 hex>" for each matching digest.
 * @param {string} text
 * @param {{patterns?: RegExp[], digests?: string[]}} [o]
 * @return {string[]}
 */
export function scanText(text, { patterns = PRIVATE_PATTERNS, digests = PRIVATE_DOMAIN_DIGESTS } = {}) {
	const hits = patterns.filter((re) => re.test(text)).map((re) => re.source)
	if (digests.length) {
		const found = new Set([...labelRuns(text)].map(sha256))
		for (const d of digests) if (found.has(d)) hits.push(`domain sha256:${d.slice(0, 12)}`)
	}
	return hits
}

/**
 * The files scanTree checks (paths relative to root, in git's order).
 * Throws when git ls-files fails, so an empty list never passes unnoticed.
 * @param {string} root a git working tree
 * @return {string[]}
 */
export function scannedFiles(root) {
	// -C root is the repository meant: git variables of a calling hook must not redirect it
	const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_REDIRECT_VARS.includes(k)))
	const r = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env })
	if (r.error || r.status !== 0) {
		throw new Error(`git ls-files in ${root} ist gescheitert: ${r.error?.message ?? String(r.stderr).trim()}`)
	}
	const all = r.stdout.toString('utf8').split('\0').filter(Boolean)
	return [...new Set(all)].filter((f) => !EXCLUDED.some((d) => f.startsWith(d)))
}

/**
 * Every hit below root: {file, line, pattern} with line 0 for a hit in the
 * path itself; pattern as scanText names it.
 * @param {string} root a git working tree
 * @param {{patterns?: RegExp[], digests?: string[]}} [o] the checks (default: this host's)
 * @return {{file: string, line: number, pattern: string}[]}
 */
export function scanTree(root, o = {}) {
	const hits = []
	const match = (file, line, text) => {
		for (const pattern of scanText(text, o)) hits.push({ file, line, pattern })
	}
	for (const file of scannedFiles(root)) {
		match(file, 0, file)
		let st
		try {
			st = fs.lstatSync(path.join(root, file))
		} catch {
			continue // deleted in the working tree
		}
		if (!st.isFile()) continue // symlink, submodule, anything else
		fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((text, i) => match(file, i + 1, text))
	}
	return hits
}
