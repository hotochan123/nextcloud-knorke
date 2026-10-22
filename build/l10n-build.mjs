/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Generates the matching l10n/<lang>.js from every l10n/<lang>.json
 * (ESM port of the Pulse script build/l10n-build.js).
 *
 * Nextcloud reads both formats: PHP takes the .json, the browser gets the .js,
 * which Util::addScript loads automatically before the app bundle. Only the
 * .json is maintained by hand; the .js is generated so the two never drift.
 *
 *   npm run l10n:build
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ID = 'knorke'
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'l10n')
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()

let failed = false
for (const file of files) {
	const lang = file.replace(/\.json$/, '')
	let data
	try {
		data = JSON.parse(readFileSync(join(dir, file), 'utf8'))
	} catch (e) {
		console.error(`${file}: invalid JSON (${e.message})`)
		failed = true
		continue
	}
	const tr = data.translations
	if (tr === null || typeof tr !== 'object' || Array.isArray(tr) || typeof data.pluralForm !== 'string') {
		console.error(`${file}: needs an object "translations" and a string "pluralForm"`)
		failed = true
		continue
	}
	const body = JSON.stringify(tr, null, 4).replace(/\n/g, '\n    ')
	const js = 'OC.L10N.register(\n    ' + JSON.stringify(APP_ID) + ',\n    ' + body
		+ ',\n' + JSON.stringify(data.pluralForm) + ');\n'
	writeFileSync(join(dir, lang + '.js'), js)
	console.log(`${lang}.js  ${Object.keys(tr).length} strings`)
}
process.exit(failed ? 1 : 0)
