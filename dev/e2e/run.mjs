/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Entry of the browser acceptance (SPEC-M0 §8.2). Runs INSIDE
 * mcr.microsoft.com/playwright:v1.49.1-jammy (dev/e2e/run.sh) as pwuser, with
 * dev/e2e mounted READ-ONLY at /work, env.json at /state/env.json and the
 * namespace's output dir (dev/e2e/out/<ns>) at /out = KD_E2E_OUT.
 *
 *   node run.mjs [--only E01,E03] [--repeat N] [--list]
 *   node run.mjs --selftest            host bridge, every action, no browser
 *
 * --repeat N (1–20) runs the selection N times, each repetition in a FRESH
 * world (new board, new contexts; the world is cleaned up after every
 * repetition), e.g. the E04b flake gate
 *   KD_NS=<ns> dev/e2e/run.sh --only E03,E04,E04b --repeat 8
 * The report lists every run (E04b #3) plus a per-scenario summary
 * "green/runs"; exit 1 if any run is red. A scenario may define
 * onRed(t, world, {rep}), called after a red run before the world goes away
 * (E04b writes its /sync trace into the report there).
 *
 * Actors: alice, bob (accounts, core lang en), guest "Gina"; one Chromium
 * context each, 1440×900, locale en-US. Scenarios share one board ("world")
 * where the spec's flow builds on the previous step; E09 (link rotation)
 * runs last because it ends the world. Result line in Pulse style
 * "N ok / M fehlgeschlagen", report in <out>/report.{md,json}, exit 1 on any
 * failure.
 *
 * Viewport passes (SPEC-M1 §8.4 R16, TST-10): a scenario object with
 * `pass: '<w>x<h>'` is a pass of the case `id` and reports as "<id>@<pass>"
 * (E31@390x844); --only E31 runs the case and all its passes.
 *
 * Stage 4 (SPEC-M1 §8.4 R19, T4-01): every case starts with
 * World.limiterReset() (bridge ratelimit-reset): the snapshot and join
 * throttles of routes 12, 14 and 15 (30 per account or gid and 60 s, 300 per
 * board and IP) live in Redis and would otherwise carry over from case to
 * case; World.cleanup() clears them once more at the end.
 *
 * A scenario may define skipIf(ENV) → reason|null: a case that cannot run on
 * this stack (E06 needs pg_stat_statements, i.e. KD_DB=pgsql) is reported as
 * "übersprungen" with the reason – never as passed, never as failed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { ENV, sleep } from './lib/harness.mjs'
import { SCENARIOS } from './scenarios/index.mjs'
import { World } from './scenarios/world.mjs'
import { parseArgs, selectScenarios, flakeSummary, reportId } from './lib/cli.mjs'
import { outDir } from './lib/bridge.mjs'

const OUT = outDir()
let ARGS
try {
	ARGS = parseArgs(process.argv.slice(2))
} catch (e) {
	console.error(`Argumente: ${e.message}`)
	process.exit(2)
}

if (ARGS.selftest) {
	const { selftest } = await import('./lib/selftest.mjs')
	process.exit(await selftest())
}
if (ARGS.list) {
	for (const s of SCENARIOS) console.log(`${reportId(s)}\t${s.title}${s.phase === 2 ? '  (Phase 2)' : ''}`)
	process.exit(0)
}
const SELECTION = selectScenarios(SCENARIOS, ARGS.only)
if (SELECTION.unknown.length || !SELECTION.ids.length) {
	console.error(`--only: unbekannte Fälle ${SELECTION.unknown.join(', ') || '(keiner gewählt)'}; bekannt: ${SCENARIOS.map(reportId).join(', ')}`)
	process.exit(2)
}
const REPEAT = ARGS.repeat
const SELECTED = new Set(SELECTION.ids)
const ON_RED_TIMEOUT_MS = 30000

const SCENARIO_TIMEOUT_MS = 240000
const results = []
const extraReport = []

function makeT(rec) {
	return {
		check(cond, label, info) {
			if (cond) { rec.ok++; return true }
			const msg = info === undefined ? label : `${label} :: ${typeof info === 'string' ? info : safe(info)}`
			rec.failed.push(msg.slice(0, 900))
			console.log(`    FEHLER ${msg.slice(0, 400)}`)
			return false
		},
		/** Like check, but stops the scenario when it fails (prerequisite). */
		must(cond, label, info) {
			if (!this.check(cond, label, info)) throw new Error(`Voraussetzung fehlt: ${label}`)
		},
		note(s) { rec.notes.push(String(s)); console.log(`    · ${s}`) },
		report(md) { extraReport.push(md) },
		step(s) { console.log(`  … ${s}`) },
	}
}

function safe(v) { try { return JSON.stringify(v) } catch { return String(v) } }

/** Runs a promise against a time limit; rejects with "Zeitlimit …". */
function withTimeout(p, ms) {
	let timer
	return Promise.race([
		p,
		new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`Zeitlimit ${ms / 1000} s`)), ms) }),
	]).finally(() => clearTimeout(timer))
}

const t0 = Date.now()
console.log(`E2E gegen ${ENV.baseNet} (NC ${ENV.versions?.nextcloud}, ${ENV.versions?.image}), Namensraum ${ENV.ns}${REPEAT > 1 ? `, ${REPEAT} Durchläufe von ${SELECTION.ids.join(',')}` : ''}`)
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
try {
	for (let rep = 1; rep <= REPEAT; rep++) {
		if (REPEAT > 1) console.log(`\n── Durchlauf ${rep}/${REPEAT} ──`)
		// a fresh world per repetition: E03 builds on an empty board
		const world = new World(browser)
		try {
			for (const sc of SCENARIOS) {
				const rid = reportId(sc)
				if (!SELECTED.has(rid)) continue
				const rec = { id: rid, rep, title: sc.title, phase: sc.phase || 1, ok: 0, failed: [], notes: [], error: null, ms: 0 }
				results.push(rec)
				console.log(`${rid}${REPEAT > 1 ? ` #${rep}` : ''} ${sc.title}${sc.phase === 2 ? ' (Phase 2)' : ''}`)
				const skip = typeof sc.skipIf === 'function' ? sc.skipIf(ENV) : null
				if (skip) {
					rec.skipped = String(skip)
					rec.green = false
					console.log(`  → ÜBERSPRUNGEN: ${rec.skipped}`)
					continue
				}
				const t = makeT(rec)
				const ts = Date.now()
				world.resetErrors()
				try {
					// R19 (T4-01): Nextcloud's ILimiter state cleared at the start of every case
					await world.limiterReset()
					await withTimeout(sc.run(t, world), SCENARIO_TIMEOUT_MS)
				} catch (e) {
					rec.error = String(e?.message || e).split('\n')[0].slice(0, 500)
				}
				const pageErrors = world.pageErrors()
				if (pageErrors.length) {
					rec.failed.push('Seitenfehler: ' + pageErrors.slice(0, 3).join(' | ').slice(0, 600))
				}
				rec.ms = Date.now() - ts
				rec.green = !rec.error && rec.failed.length === 0 && rec.ok > 0
				if (!rec.green) {
					rec.shots = await world.screenshots(path.join(OUT, 'shots'), REPEAT > 1 ? `${rid}-r${rep}` : rid)
					if (typeof sc.onRed === 'function') {
						await withTimeout(sc.onRed(t, world, { rep }), ON_RED_TIMEOUT_MS)
							.catch((e) => rec.notes.push(`onRed: ${String(e?.message || e).slice(0, 200)}`))
					}
				}
				if (!rec.error && !rec.failed.length && rec.ok === 0) rec.error = 'keine einzige Prüfung gelaufen'
				console.log(`  → ${rec.green ? 'ok' : 'FEHLGESCHLAGEN'} (${rec.ok} Prüfungen ok, ${rec.failed.length} rot${rec.error ? ', Abbruch: ' + rec.error : ''}, ${Math.round(rec.ms / 1000)} s)`)
			}
		} finally {
			await world.cleanup().catch((e) => console.log(`Aufräumen: ${e.message}`))
		}
	}
} finally {
	await browser.close().catch(() => {})
}

// ── report ───────────────────────────────────────────────────────────────
const order = (id) => SCENARIOS.findIndex((s) => reportId(s) === id)
results.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }) || order(a.id) - order(b.id) || a.rep - b.rep)
const green = results.filter((r) => r.green).length
const skipped = results.filter((r) => r.skipped).length
const red = results.length - green - skipped
const skipText = skipped ? ` / ${skipped} übersprungen` : ''
const flakes = flakeSummary(results)
fs.mkdirSync(OUT, { recursive: true })
const at = new Date().toISOString()
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at, ns: ENV.ns, nextcloud: ENV.versions?.nextcloud, image: ENV.versions?.image, db: ENV.db?.kind ?? 'pgsql', repeat: REPEAT, green, red, skipped, ms: Date.now() - t0, summary: flakes, results }, null, 2))
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 600)
fs.writeFileSync(path.join(OUT, 'report.md'), [
	`# E2E – ${at}`,
	'',
	`**${green} ok / ${red} fehlgeschlagen${skipText}** · Namensraum ${ENV.ns} · Nextcloud ${ENV.versions?.nextcloud} (${ENV.versions?.image}) · DB ${ENV.versions?.db ?? 'pgsql'} · ${Math.round((Date.now() - t0) / 1000)} s${REPEAT > 1 ? ` · ${REPEAT} Durchläufe` : ''}`,
	'',
	...(REPEAT > 1 ? [
		'| Fall | grün / Läufe | rot in Durchlauf |',
		'|---|---|---|',
		...flakes.map((f) => `| ${f.id} | ${f.green}/${f.runs - f.skipped}${f.skipped ? ` (${f.skipped} übersprungen)` : ''} | ${f.redReps.join(', ') || '–'} |`),
		'',
	] : []),
	'| Fall | Titel | Ergebnis | Details |',
	'|---|---|---|---|',
	...results.map((r) => `| ${r.id}${REPEAT > 1 ? ` #${r.rep}` : ''}${r.phase === 2 ? ' (P2)' : ''} | ${cell(r.title)} | ${r.skipped ? 'übersprungen' : r.green ? 'ok' : '**rot**'} | ${cell([...(r.skipped ? [r.skipped] : []), ...r.failed, ...(r.error ? ['Abbruch: ' + r.error] : []), ...r.notes].join('; '))} |`),
	'',
	...extraReport,
	'',
].join('\n'))
if (REPEAT > 1) console.log(`\nWiederholungen: ${flakes.map((f) => `${f.id} ${f.green}/${f.runs - f.skipped}`).join(' · ')}`)
console.log(`\n==== E2E: ${green} ok / ${red} fehlgeschlagen${skipText} · ${Math.round((Date.now() - t0) / 1000)} s ====`)
await sleep(10)
process.exit(red ? 1 : 0)
