/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Factory job 254 (align and sort out of actions.js, board/arrangeActions.js
 * and board/actionsBase.js): nothing visible changes.
 *
 * - AK1: every name BoardSession and SessionFiles call as `actions.<name>`
 *   and every name a module under src/ imports from actions.js still exists
 *   in actions.js (moved names are re-exported).
 * - AK3: no import cycle: arrangeActions.js never imports actions.js,
 *   actionsBase.js imports neither of them; actions.js hands out the very
 *   functions of arrangeActions.js.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as actions from '../../../src/board/actions.js'
import * as arrange from '../../../src/board/arrangeActions.js'

const ROOT = new URL('../../../', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/**
 * @param {string} dir directory under the repo root
 * @return {string[]} every .js and .vue file below it (repo-relative)
 */
function sources(dir) {
	const out = []
	for (const name of readdirSync(join(ROOT, dir))) {
		const p = join(dir, name)
		if (statSync(join(ROOT, p)).isDirectory()) {
			out.push(...sources(p))
		} else if (/\.(js|vue)$/.test(name)) {
			out.push(p)
		}
	}
	return out
}

test('AK1: every actions.<name> of BoardSession and SessionFiles exists in actions.js', () => {
	for (const file of ['src/board/BoardSession.js', 'src/board/sessionFiles.js']) {
		const names = new Set([...read(file).matchAll(/\bactions\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]).filter((n) => n !== 'js'))
		assert.ok(names.size > 0, file + ' calls actions.*')
		for (const n of names) {
			assert.notEqual(actions[n], undefined, file + ': actions.' + n)
		}
	}
})

test('AK1: every name imported from actions.js under src/ exists in actions.js', () => {
	let seen = 0
	const files = new Set()
	for (const file of sources('src')) {
		for (const m of read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*\/board\/actions\.js'|import\s*\{([^}]*)\}\s*from\s*'\.\/actions\.js'/g)) {
			files.add(file)
			for (const part of (m[1] ?? m[2]).split(',')) {
				const n = part.trim().split(/\s+as\s+/)[0]
				if (n) {
					seen++
					assert.notEqual(actions[n], undefined, file + ': ' + n)
				}
			}
		}
	}
	assert.ok(files.has('src/components/ContextBar.vue'), 'ContextBar.vue: ' + [...files].join(', '))
	assert.ok(seen >= 7, 'named imports found: ' + seen)
})

/**
 * @param {string} file repo-relative path
 * @return {string[]} the module specifiers of its import and export-from lines
 */
function specifiers(file) {
	return [...read(file).matchAll(/^(?:import|export)\b[^\n]*?\bfrom\s*'([^']+)'/gm)].map((m) => m[1])
}

test('AK3: arrangeActions.js and actionsBase.js never import actions.js', () => {
	const fromArrange = specifiers('src/board/arrangeActions.js')
	assert.ok(fromArrange.includes('./actionsBase.js'))
	assert.ok(!fromArrange.some((s) => /(^|\/)actions\.js$/.test(s)), fromArrange.join(', '))
	const fromBase = specifiers('src/board/actionsBase.js')
	assert.ok(fromBase.length > 0)
	assert.ok(fromBase.every((s) => s.startsWith('../model/')), fromBase.join(', '))
})

test('AK3: actions.js re-exports every export of arrangeActions.js unchanged', () => {
	const names = Object.keys(arrange)
	assert.ok(names.includes('alignItems') && names.includes('sortNotesByColor') && names.includes('ALIGN_EDGES'))
	for (const n of names) {
		assert.equal(actions[n], arrange[n], n)
	}
})
