/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Result bookkeeping of the HTTP harness: cases with checks, Pulse-style
 * summary line "N ok / M fehlgeschlagen", a JSON and a Markdown report in
 * dev/sim/out/<ns>/ (one directory per namespace, round 2 U3, so runs in two
 * namespaces never overwrite each other's report). A case is green only if it ran to the end without an
 * exception and every check held; an exception is reported as such, never
 * swallowed. A case that cannot run on this stack (suite.skip, e.g. a
 * PostgreSQL-only case on MariaDB) is reported as "übersprungen" with its
 * reason – counted on its own, never green, never red, no effect on the exit code.
 *
 * Run-evidence names (SPEC-M1 §9.0 R15 point 2, R16): KD_REPORT_STEM, when
 * set, replaces the suite name as the file stem of the report – the way
 * dev/selftest/upgrade.sh writes upgrade-<db>-{contract,seed,verify}[-<label>]
 * itself, so a second run of the same namespace never overwrites the first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { SIM_DIR } from './env.mjs'

/**
 * Namespaces that are no namespace (SPEC-M1 §8.1): the folders of the pre-R5
 * report layout. Same list as KD_RESERVED_NS in dev/lib.sh and RESERVED_NS in
 * dev/e2e/lib/bridge.mjs.
 */
export const RESERVED_NS = Object.freeze(['shots', 'report', 'bridge', 'out'])

/** File stems KD_REPORT_STEM may name (lower case, digits, dashes; no path). */
export const REPORT_STEM_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

/**
 * The file stem of a suite's report: KD_REPORT_STEM when set (checked against
 * REPORT_STEM_RE), else the suite name.
 * @param {string} name suite name
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 */
export function reportStem(name, env = process.env) {
	const s = env.KD_REPORT_STEM
	if (s === undefined || s === '') return name
	if (!REPORT_STEM_RE.test(s)) throw new Error(`KD_REPORT_STEM='${s}' ist ungültig (${REPORT_STEM_RE})`)
	return s
}

/** dev/sim/out/<ns> for KD_NS (default main). */
export function outDir(ns = process.env.KD_NS || 'main') {
	if (!/^[a-z]{1,8}$/.test(ns)) throw new Error(`KD_NS='${ns}' ist ungültig`)
	if (RESERVED_NS.includes(ns)) throw new Error(`KD_NS='${ns}' ist reserviert (nicht erlaubt: ${RESERVED_NS.join(' ')})`)
	return path.join(SIM_DIR, 'out', ns)
}

export class Suite {
	constructor(name) {
		this.name = name
		this.cases = []
		this.t0 = Date.now()
	}

	/**
	 * Runs one case. fn(t) gets t.check(cond, label, info?) and t.note(text).
	 * @returns {Promise<object>} the case record
	 */
	async run(id, title, fn) {
		const rec = { id, title, ok: 0, failed: [], notes: [], error: null, ms: 0 }
		this.cases.push(rec)
		const t = {
			check(cond, label, info) {
				if (cond) { rec.ok++; return true }
				const msg = info === undefined ? label : `${label} :: ${typeof info === 'string' ? info : safeJson(info)}`
				rec.failed.push(msg.slice(0, 900))
				return false
			},
			note(s) { rec.notes.push(String(s)) },
		}
		const t0 = Date.now()
		process.stdout.write(`${id} ${title} … `)
		try {
			await fn(t)
		} catch (e) {
			rec.error = (e && e.stack) ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e)
		}
		rec.ms = Date.now() - t0
		rec.green = !rec.error && rec.failed.length === 0 && rec.ok > 0
		if (!rec.error && rec.failed.length === 0 && rec.ok === 0) rec.error = 'keine einzige Prüfung gelaufen'
		console.log(rec.green ? `ok (${rec.ok} Prüfungen, ${rec.ms} ms)` : 'FEHLGESCHLAGEN')
		for (const f of rec.failed) console.log(`    FEHLER ${f}`)
		if (rec.error) console.log(`    AUSNAHME ${rec.error}`)
		for (const n of rec.notes) console.log(`    · ${n}`)
		return rec
	}

	/** Records a case that does not apply to this stack (visible in console and report). */
	skip(id, title, reason) {
		const rec = { id, title, ok: 0, failed: [], notes: [], error: null, ms: 0, green: false, skipped: String(reason) }
		this.cases.push(rec)
		console.log(`${id} ${title} … ÜBERSPRUNGEN: ${rec.skipped}`)
		return rec
	}

	summary() {
		const green = this.cases.filter((c) => c.green).length
		const skipped = this.cases.filter((c) => c.skipped).length
		const red = this.cases.length - green - skipped
		const checksOk = this.cases.reduce((a, c) => a + c.ok, 0)
		const checksBad = this.cases.reduce((a, c) => a + c.failed.length + (c.error ? 1 : 0), 0)
		return { green, red, skipped, checksOk, checksBad, ms: Date.now() - this.t0 }
	}

	/** Prints the summary, writes out/<name>.json + .md, returns the exit code. */
	finish(extra = {}) {
		const s = this.summary()
		const dir = outDir()
		const stem = reportStem(this.name)
		fs.mkdirSync(dir, { recursive: true })
		const report = { suite: this.name, at: new Date().toISOString(), ...s, ...extra, cases: this.cases }
		fs.writeFileSync(path.join(dir, `${stem}.json`), JSON.stringify(report, null, 2))
		const md = [
			`# ${this.name} – ${report.at}`,
			'',
			`**${s.green} ok / ${s.red} fehlgeschlagen${s.skipped ? ` / ${s.skipped} übersprungen` : ''}** (Fälle); Prüfungen ${s.checksOk} ok / ${s.checksBad} fehlgeschlagen; ${Math.round(s.ms / 1000)} s`,
			'',
			...Object.entries(extra).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : safeJson(v)}`),
			'',
			'| Fall | Titel | Ergebnis | Details |',
			'|---|---|---|---|',
			...this.cases.map((c) => `| ${c.id} | ${c.title} | ${c.skipped ? 'übersprungen' : c.green ? 'ok' : '**rot**'} | ${mdCell([...(c.skipped ? [c.skipped] : []), ...c.failed, ...(c.error ? ['Ausnahme: ' + c.error] : []), ...c.notes].join('; '))} |`),
			'',
		].join('\n')
		fs.writeFileSync(path.join(dir, `${stem}.md`), md)
		console.log(`\n==== ${this.name}: ${s.green} ok / ${s.red} fehlgeschlagen${s.skipped ? ` / ${s.skipped} übersprungen` : ''} (Fälle) · Prüfungen ${s.checksOk} ok / ${s.checksBad} fehlgeschlagen · ${Math.round(s.ms / 1000)} s ====`)
		console.log(`Bericht: ${path.join(dir, stem + '.md')}`)
		return s.red ? 1 : 0
	}
}

export function safeJson(v) {
	try { return JSON.stringify(v) } catch { return String(v) }
}

function mdCell(s) {
	return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 700)
}
