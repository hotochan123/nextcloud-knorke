/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Source guard over src/model/** and src/scene/** (SPEC-M0 §0, §6.9, §9.3):
 * - no HTML sinks (innerHTML, outerHTML, insertAdjacentHTML)
 * - no direct import of @nextcloud/l10n (t only from src/util/l10n.js)
 * - no translated source texts except the four of §6.9, always in the form
 *   t('knorke', '<text>' …) so that build/l10n-check.mjs finds them
 * - no stage.scale( / stage.position( (the camera is one setAttrs)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROOT, stripComments, walk } from './sourceScan.mjs'

const DIRS = ['src/model', 'src/scene']

/** The only source texts the scene may translate (§6.9). */
const ALLOWED_TEXTS = Object.freeze([
	'{name} is editing…',
	'Take over',
	'{name} (guest)',
	'Unknown item type: {type}',
])

const files = DIRS.flatMap((d) => walk(join(ROOT, d), /\.(m?js|vue)$/))
const sources = files.map((p) => ({ path: relative(ROOT, p), raw: readFileSync(p, 'utf8') }))

describe('noHtml (src/model, src/scene)', () => {
	test('the guard sees the scene and model files', () => {
		const names = sources.map((s) => s.path)
		for (const f of ['src/scene/SceneManager.js', 'src/scene/CursorLayer.js', 'src/scene/TextEditor.js',
			'src/scene/nodes/placeholder.js', 'src/model/SceneModel.js']) {
			assert.ok(names.includes(f), f)
		}
	})

	test('no HTML sinks', () => {
		for (const s of sources) {
			assert.doesNotMatch(s.raw, /innerHTML|outerHTML|insertAdjacentHTML|v-html/, s.path)
		}
	})

	test('no direct @nextcloud/l10n import; t only from src/util/l10n.js', () => {
		for (const s of sources) {
			assert.doesNotMatch(s.raw, /@nextcloud\/l10n/, s.path)
			for (const m of s.raw.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
				const names = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0])
				if (names.includes('t') || names.includes('n')) {
					assert.match(m[2], /(^|\/)util\/l10n\.js$/, `${s.path}: ${m[0]}`)
				}
			}
		}
	})

	test("only the §6.9 texts, always as t('knorke', '…')", () => {
		const used = new Set()
		for (const s of sources) {
			const code = stripComments(s.raw)
			for (const m of code.matchAll(/(?<![\w$])t\(/g)) {
				const rest = code.slice(m.index)
				const call = rest.match(/^t\(\s*'knorke'\s*,\s*'((?:[^'\\]|\\.)*)'/)
				assert.ok(call, `${s.path}: t( call without a literal knorke text: ${rest.slice(0, 60)}`)
				assert.ok(ALLOWED_TEXTS.includes(call[1]), `${s.path}: text outside §6.9: ${call[1]}`)
				used.add(call[1])
			}
			assert.doesNotMatch(code, /(?<![\w$.])n\(\s*'knorke'/, `${s.path}: plural texts are not allowed`)
		}
		assert.deepEqual([...used].sort(), [...ALLOWED_TEXTS].sort(), 'every §6.9 text is used (l10n:check)')
	})

	test('the four texts are in l10n/de.json', () => {
		const de = JSON.parse(readFileSync(join(ROOT, 'l10n/de.json'), 'utf8'))
		for (const text of ALLOWED_TEXTS) {
			assert.equal(typeof de.translations[text], 'string', text)
		}
	})

	test('no stage.scale( / stage.position(', () => {
		for (const s of sources) {
			assert.doesNotMatch(s.raw, /stage\.(scale|position)\(/, s.path)
		}
	})

	test('stripComments keeps strings and drops comments', () => {
		const src = "a('//x') // c\nb(`/*y*/`) /* d\n e */ f('\\'')"
		assert.equal(stripComments(src), "a('//x') \nb(`/*y*/`) \n f('\\'')")
	})
})
