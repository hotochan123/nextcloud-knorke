/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The tablet session's texts name only what exists (SPEC-M1 §8.8, §16, §17):
 * every label of the send page appears on the start page and in
 * ipad/ANLEITUNG-R-A.md and passes session.mjs's pattern; every control
 * quoted with „…“ on the start page or in the sheet is a real button, option
 * or status text of the lab panel (panel.js), the spike bench (when its
 * build is there), the send page or the session server, or a named screen
 * of Android/Chrome/Safari outside the package.
 *
 * Some bench names exist only at runtime (the engine option is
 * `Konva ${version}`, the repetitions come from a list, the status counts the
 * runs) or would match any source (a bare „1“). Those are compared with the
 * live bench by ipad/check.mjs (SHEET_BENCH, SHEET_SCENARIOS, SHEET_DONE);
 * here they only have to be on that list, and the list has to be what the
 * sheet and the start page say.
 *
 *   node --test 'dev/scene-lab/test/*.test.mjs'
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LABEL_RE, MAX_BODY } from '../ipad/session.mjs'

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(LAB, p), 'utf8')
const BENCH = process.env.KNORKE_BENCH_HTML || join(LAB, '../../../knorke-spike/engine/dist/bench-standalone.html')

const LABELS = [
	'bench-lauf-1', 'bench-lauf-2', 'bench-lauf-3', 'labor-lauf-1', 'labor-lauf-2', 'labor-lauf-3',
	'waerme-labor-schwenk', 'waerme-bench-schwenken', 'geraet-notiz',
]
/** Screens and words outside the package (Android, Chrome, Safari, macOS, the terminal). */
const OUTSIDE = new Set(['Nicht sicher', 'adaptiv', 'Downloads', 'ok', 'Funktionen für Webentwickler', 'port 18612 is in use'])
const PAGES = ['ipad/session-start.html', 'ipad/ANLEITUNG-R-A.md']
const quotes = (text) => [...text.matchAll(/„([^“]+)“/g)].map((m) => m[1])

/** @param {string} js minified bench @return {string} with \uXXXX and \xXX escapes resolved */
const unescapeJs = (js) => js.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
	.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

/** The bench settings ipad/check.mjs compares with the live page. */
function checkLists() {
	const check = read('ipad/check.mjs')
	const block = (name, close) => {
		const i = check.indexOf(`const ${name} = `)
		return i < 0 ? '' : check.slice(i, check.indexOf(close, i))
	}
	const bench = [...block('SHEET_BENCH', '\n}').matchAll(/(\w+): \['([^']*)', '([^']*)'\]/g)].map((m) => ({ id: m[1], value: m[2], text: m[3] }))
	const scenarios = [...block('SHEET_SCENARIOS', ']\n').matchAll(/'([^']+)'/g)].map((m) => m[1])
	const done = /^const SHEET_DONE = '([^']+)'$/m.exec(check)?.[1] ?? null
	return { bench, scenarios, done, all: new Set([...bench.map((b) => b.text), ...scenarios, done]) }
}

describe('labels of the send page', () => {
	const send = read('ipad/session-send.html')
	const options = [...send.matchAll(/<option value="([^"]+)">/g)].map((m) => m[1])

	test('the labels of the session, in the order of the run, all valid for POST /result', () => {
		assert.deepEqual(options, LABELS)
		for (const l of LABELS) assert.ok(LABEL_RE.test(l), l)
	})

	test('start page and sheet name every label', () => {
		for (const page of PAGES) {
			const text = read(page)
			for (const l of LABELS) assert.ok(text.includes(l), `${page}: ${l}`)
		}
	})

	test('the send page refuses text above session.mjs MAX_BODY itself (4 MiB, before any request)', () => {
		assert.equal(MAX_BODY, 4 * 1024 * 1024)
		assert.match(send, /const MAX_BYTES = 4 \* 1024 \* 1024\n/)
		assert.match(send, /if \(new Blob\(\[text\]\)\.size > MAX_BYTES\) \{/)
		assert.match(send, /'Zu groß \(höchstens 4 MiB\) – nichts gesendet'/)
	})
})

describe('quoted controls exist', () => {
	const sources = [read('panel.js'), read('ipad/session-send.html'), read('ipad/session.mjs')]
	const bench = existsSync(BENCH) ? unescapeJs(readFileSync(BENCH, 'utf8')) : null
	if (bench) sources.push(bench)
	const lists = checkLists()
	// built at runtime or matching anything: only the runtime comparison of ipad/check.mjs counts
	const runtimeOnly = (q) => q.length <= 3 || q.startsWith('Konva ') || /^([2-9]|\d{2,}) Messungen fertig\.$/.test(q)
	const found = (q) => {
		if (OUTSIDE.has(q) || lists.all.has(q)) return true
		if (runtimeOnly(q)) return false
		// the bench counts its runs into the status: `${n} Messungen fertig.` (n = 1 for one scenario, one repetition, one engine)
		const core = q.replace(/^…\s*/, '').replace(/\s*…$/, '').replace(/^1 (Messungen fertig\.)$/, '$1')
		return sources.some((s) => s.includes(core))
	}

	for (const page of PAGES) {
		test(`${page}: every „…“ is a real control or status text${bench ? '' : ' (bench build missing: bench names unchecked)'}`, () => {
			const qs = quotes(read(page))
			assert.ok(qs.length > 8, 'quotes found')
			const missing = qs.filter((q) => !found(q))
			if (!bench) {
				// without the bench build only the bench's own literal names may be missing
				const benchOnly = /^(100 %|Alle Szenarien|[1-8] |Messung starten|JSON speichern|1 Messungen fertig)/
				assert.deepEqual(missing.filter((q) => !benchOnly.test(q)), [])
			} else {
				assert.deepEqual(missing, [])
			}
		})
	}

	test('the bench settings of sheet and start page are the ones ipad/check.mjs compares with the live bench', () => {
		assert.deepEqual(lists.bench.map((b) => b.id), ['engine', 'scenario', 'scale', 'reps'])
		assert.equal(lists.scenarios.length, 4)
		assert.match(lists.done ?? '', /^\d+ Messungen fertig\.$/)
		for (const page of PAGES) {
			const qs = new Set(quotes(read(page)))
			for (const b of lists.bench) assert.ok(qs.has(b.text), `${page}: „${b.text}“ (${b.id})`)
			assert.ok(qs.has(lists.done), `${page}: „${lists.done}“`)
		}
		const sheet = new Set(quotes(read('ipad/ANLEITUNG-R-A.md')))
		for (const s of lists.scenarios) assert.ok(sheet.has(s), `sheet: „${s}“`)
	})

	test('the bench literals the sheet asks for are in the bench build', { skip: !bench && 'bench build missing' }, () => {
		for (const s of [...lists.scenarios, 'Alle Szenarien', '100 % (voll)', 'Messung starten', 'JSON kopieren', 'JSON speichern', 'Messungen fertig.']) {
			assert.ok(bench.includes(s), s)
		}
	})
})
