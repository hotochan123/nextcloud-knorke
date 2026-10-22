/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENE_TEXTS, check } from '../../../build/l10n-check.mjs'
import { n, t } from '../../../src/util/l10n.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('l10n:check is green for the repository (de.json complete, no orphans)', () => {
	const { ok, lines } = check(ROOT)
	assert.ok(ok, lines.join('\n'))
})

test('de.json carries the scene texts of §6.9 with the given German', () => {
	const de = JSON.parse(readFileSync(join(ROOT, 'l10n', 'de.json'), 'utf8')).translations
	assert.equal(de['{name} is editing…'], '{name} bearbeitet …')
	assert.equal(de['Take over'], 'Übernehmen')
	assert.equal(de['{name} (guest)'], '{name} (Gast)')
	assert.equal(de['Unknown item type: {type}'], 'Unbekannter Objekttyp: {type}')
	assert.equal(SCENE_TEXTS.length, 4)
})

test('l10n/de.js is generated from de.json (no drift)', () => {
	const de = JSON.parse(readFileSync(join(ROOT, 'l10n', 'de.json'), 'utf8'))
	const js = readFileSync(join(ROOT, 'l10n', 'de.js'), 'utf8')
	let registered = null
	const OC = { L10N: { register: (app, tr, plural) => { registered = { app, tr, plural } } } }
	// eslint-disable-next-line no-new-func
	new Function('OC', js)(OC)
	assert.equal(registered.app, 'knorke')
	assert.deepEqual(registered.tr, de.translations)
	assert.equal(registered.plural, de.pluralForm)
})

test('the check finds missing, orphaned and mismatched entries', () => {
	const dir = mkdtempSync(join(tmpdir(), 'knorke-l10n-'))
	try {
		mkdirSync(join(dir, 'src'))
		mkdirSync(join(dir, 'l10n'))
		writeFileSync(join(dir, 'src', 'a.js'), "t('knorke', 'Hello {name}', { name })\nn('knorke', '%n item', '%n items', c)\nt('other', 'Not ours')\n")
		const tr = { 'Hello {name}': 'Hallo {nom}', Orphan: 'Waise', 'Take over': 'Übernehmen', '{name} is editing…': 'x {name}', '{name} (guest)': '{name} (Gast)', 'Unknown item type: {type}': 'U {type}' }
		writeFileSync(join(dir, 'l10n', 'de.json'), JSON.stringify({ translations: tr, pluralForm: 'nplurals=2; plural=(n != 1);' }))
		const { ok, lines } = check(dir)
		assert.equal(ok, false)
		const text = lines.join('\n')
		assert.match(text, /MISSING\s+"_%n item_::_%n items_"/)
		assert.match(text, /ORPHANED\s+"Orphan"/)
		assert.match(text, /PLACEHOLDERS "Hello \{name\}"/)
		assert.ok(!/Not ours/.test(text), 'other app ids are ignored')
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('t/n: escape and sanitize are off (names are data, rendered as text)', () => {
	assert.equal(t('knorke', '{name} (guest)', { name: 'Tom & Jerry <b>' }), 'Tom & Jerry <b> (guest)')
	assert.equal(n('knorke', '%n selected', '%n selected', 3), '3 selected')
})
