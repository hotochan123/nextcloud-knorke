/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * DOM safety of the shell (SPEC-M0 §0, §9.3): grep over src/ without
 * src/model and src/scene (those belong to [S] and have their own test).
 * Text reaches the DOM only through Vue interpolation or textContent.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SRC = join(ROOT, 'src')
const SKIP = new Set([join(SRC, 'model'), join(SRC, 'scene')])

/**
 * @param {string} dir directory
 * @param {string[]} [out] accumulator
 * @return {string[]} .js/.mjs/.vue files below dir, without the [S] folders
 */
function files(dir, out = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, e.name)
		if (e.isDirectory()) {
			if (!SKIP.has(full)) {
				files(full, out)
			}
		} else if (/\.(js|mjs|vue)$/.test(e.name)) {
			out.push(full)
		}
	}
	return out
}

/**
 * Source without comments, so a comment explaining the rule is no hit.
 *
 * @param {string} src file content
 * @return {string} code only (strings kept)
 */
function code(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
}

const all = files(SRC)

test('the shell sources are found', () => {
	const rel = all.map((f) => relative(ROOT, f))
	for (const f of ['src/main.js', 'src/App.vue', 'src/PublicApp.vue', 'src/board/BoardSession.js', 'src/sync/SyncClient.js', 'src/views/BoardView.vue']) {
		assert.ok(rel.includes(f), f)
	}
	assert.ok(!rel.some((f) => f.startsWith('src/model/') || f.startsWith('src/scene/')))
})

test('no HTML sinks: innerHTML, outerHTML, insertAdjacentHTML, v-html, document.write', () => {
	const bad = []
	for (const f of all) {
		const c = code(readFileSync(f, 'utf8'))
		for (const sink of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bv-html\b/, /\bdocument\.write\b/, /\bcreateContextualFragment\b/]) {
			if (sink.test(c)) {
				bad.push(relative(ROOT, f) + ': ' + sink)
			}
		}
	}
	assert.deepEqual(bad, [])
})

test('@nextcloud/l10n is imported only by src/util/l10n.js', () => {
	const bad = all.filter((f) => /from '@nextcloud\/l10n'/.test(readFileSync(f, 'utf8')))
		.map((f) => relative(ROOT, f))
		.filter((f) => f !== 'src/util/l10n.js')
	// BoardList uses getLanguage() for Intl.RelativeTimeFormat only (no translation)
	assert.deepEqual(bad.filter((f) => !/BoardList\.vue$/.test(f)), [])
	for (const f of bad) {
		const src = readFileSync(join(ROOT, f), 'utf8')
		assert.match(src, /import \{ getLanguage \} from '@nextcloud\/l10n'/, f + ' may only take getLanguage')
	}
})

test('secure-context APIs are guarded: navigator.clipboard only behind isSecureContext, no crypto.randomUUID/subtle', () => {
	for (const f of all) {
		const c = code(readFileSync(f, 'utf8'))
		const rel = relative(ROOT, f)
		assert.ok(!/crypto\s*\.\s*randomUUID/.test(c), rel + ': crypto.randomUUID')
		assert.ok(!/crypto\s*\.\s*subtle/.test(c), rel + ': crypto.subtle')
		// property access only (navigator.clipboard, x?.clipboard, deps.clipboard); an
		// import of board/clipboard.js (SPEC-M1 §6.5.3) is no clipboard access
		if (/\.\s*clipboard\b(?!\.js)/.test(c)) {
			assert.match(c, /isSecureContext\(\)\s*\?\s*globalThis\.navigator\?\.clipboard\s*:\s*null/, rel + ': clipboard without guard')
			assert.match(c, /try\s*\{[\s\S]*writeText/, rel + ': writeText without try')
		}
	}
})

test('M1 stage 4 (R19 T4-03): reading the clipboard ("Paste here") goes only through clipboard.js clipboardReader, behind window.isSecureContext === true', () => {
	const direct = []
	const viaReader = []
	for (const f of all) {
		const c = code(readFileSync(f, 'utf8'))
		const rel = relative(ROOT, f)
		// a read straight off navigator.clipboard (no guard possible in between)
		if (/clipboard\s*\??\.\s*read(Text)?\b/.test(c) || /\breadText\s*\(/.test(c)) {
			direct.push(rel)
		}
		if (/\bclipboardReader\s*\(/.test(c)) {
			viaReader.push(rel)
		}
	}
	assert.deepEqual(direct, [], 'never navigator.clipboard.read/readText directly')
	assert.deepEqual(viaReader.sort(), ['src/board/BoardSession.js', 'src/board/clipboard.js'], 'the session reads through clipboardReader only')
	const c = code(readFileSync(join(ROOT, 'src/board/clipboard.js'), 'utf8'))
	const fn = c.slice(c.indexOf('export function clipboardReader'), c.indexOf('export function canReadClipboard'))
	assert.match(fn, /win\.isSecureContext !== true\)\s*\{\s*return null/, 'no secure context → no reader')
	assert.ok(fn.indexOf('isSecureContext') < fn.indexOf('navigator'), 'the guard comes before navigator.clipboard')
	assert.match(fn, /typeof cb\.read === 'function'/)
	const session = code(readFileSync(join(ROOT, 'src/board/BoardSession.js'), 'utf8'))
	const paste = session.slice(session.indexOf('\tpasteHere(world) {'), session.indexOf('\tpasteBlocked() {'))
	assert.ok(paste.indexOf('clipboardReader(') < paste.indexOf('.read()'), 'read() only on what clipboardReader returned')
	assert.ok(paste.indexOf('.read()') < paste.indexOf('.then('), 'read() synchronously in the click, before any await or then')
	assert.doesNotMatch(paste.slice(0, paste.indexOf('.read()')), /await/, 'no await before read()')
})
