/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPDX header in every source file of [C] (SPEC-M0 §0): JS as a /** … *\/
 * block, Vue as an HTML comment before <template>. Generated files (l10n/de.js,
 * js/, css/) are exempt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DIRS = ['src/sync', 'src/board', 'src/util', 'src/api', 'src/views', 'src/components', 'src/admin', 'src/styles', 'build', 'tests/js/sync', 'tests/js/board', 'tests/js/shell']
const FILES = ['src/main.js', 'src/App.vue', 'src/PublicApp.vue', 'src/router.js', 'vite.config.js']

/**
 * @param {string} dir directory relative to the root
 * @return {string[]} source files below it
 */
function list(dir) {
	const abs = join(ROOT, dir)
	if (!existsSync(abs)) {
		return []
	}
	const out = []
	for (const e of readdirSync(abs, { withFileTypes: true })) {
		const p = join(abs, e.name)
		if (e.isDirectory()) {
			out.push(...list(relative(ROOT, p)))
		} else if (/\.(js|mjs|vue|css)$/.test(e.name)) {
			out.push(p)
		}
	}
	return out
}

test('every [C] source file starts with the SPDX header', () => {
	const files = [...DIRS.flatMap(list), ...FILES.map((f) => join(ROOT, f))]
	assert.ok(files.length > 40, 'found ' + files.length)
	const bad = []
	for (const f of files) {
		const head = readFileSync(f, 'utf8').split('\n').slice(0, 4).join('\n')
		const ok = f.endsWith('.vue')
			? /^<!--\n {2}- SPDX-FileCopyrightText: 2026 hotochan123\n {2}- SPDX-License-Identifier: AGPL-3\.0-or-later\n-->/.test(head)
			: /^\/\*\*\n \* SPDX-FileCopyrightText: 2026 hotochan123\n \* SPDX-License-Identifier: AGPL-3\.0-or-later\n \*\//.test(head)
		if (!ok) {
			bad.push(relative(ROOT, f))
		}
	}
	assert.deepEqual(bad, [])
})
