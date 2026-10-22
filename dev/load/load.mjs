/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * CLI of the load generator (SPEC-M1 §8.7). Normally started by
 * dev/load/run.sh, which holds the load lock, applies the abort rule of §8.1
 * and pins this process to KD_GEN_CPUSET; run directly only for a dry look:
 *
 *   KD_NS=load node dev/load/load.mjs --scenario S4 [--seed N] [--secs N]
 *       [--warmup N] [--scale F] [--board notes,shapes,connectors,frames]
 *       [--steps 30,45,…] [--abort-file PATH] [--page-requests EDITOR,TABLET]
 *
 *   --scenario  S1 | S4 | S4e | S4d | S5 | SF | SC (required)
 *   --seed      uint32; default a random one; always in the report
 *   --secs      window in s (S5: per step); default of the scenario. A
 *               shorter window scales the workload's timeline (vote t = 20–80 s
 *               of 90 s), never the client cadence, and the report marks it
 *               "nicht gültig für das Gate"
 *   --warmup    join spread / warm-up in s (SC: the spread of the direct part)
 *   --scale     multiplies editors, guests, tablets (default 1)
 *   --board     seed board, default 3000,500,800,20
 *   --steps     S5 editor steps, default 30,45,60,75,90
 *   --abort-file  run.sh writes the abort reason there before its SIGTERM
 *   --page-requests  SC only (SPEC-M1 §8.7 R19, T4-11): requests of one
 *               board page and one vote-link page (tablet), measured in the
 *               namespace right before SC (dev/load/lib/pageload.mjs); without
 *               it SC models 85/34 and says "nicht gemessen" (P2 not proven)
 *
 * Env: KD_NS (default load), KD_RUN_LABEL (^[a-z0-9-]{1,24}$).
 * Reads dev/.state/<ns>/env.json (KD_DB=pgsql only: pg_stat_statements).
 * Writes dev/load/out/<ns>/<scenario>-<variant>[-<label>].{json,md}, the copy
 * <scenario>-<variant>.{json,md} and summary.{md,json} (lib/summary.mjs).
 * Exit: 0 gate green (report-only scenarios: run complete and its checks
 * green), 1 gate red or not proven, a check failed or a harness error,
 * 2 not applicable (arguments, variant, stack), 3 aborted by the abort rule
 * (SIGTERM with a reason in --abort-file), 130/143 interrupted otherwise.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'
import { Stack, loadEnv } from '../sim/lib/env.mjs'
import { Collectors, hostNow } from './lib/collect.mjs'
import { FaultInjector } from './lib/faults.mjs'
import { runScenario } from './lib/generator.mjs'
import { BOARD, LABEL_RE, SCENARIOS, SCENARIO_IDS } from './lib/plan.mjs'
import { outDir, writeRunReports, writeSummary } from './lib/summary.mjs'

const FLAGS = ['scenario', 'seed', 'secs', 'warmup', 'scale', 'board', 'steps', 'abort-file', 'page-requests']

/** Strict flag parser: --name value; unknown flags and missing values are errors. */
export function parseArgs(argv) {
	const out = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		const m = /^--([a-z-]+)$/.exec(a)
		if (!m || !FLAGS.includes(m[1])) throw new Error(`unbekanntes Argument '${a}' (erlaubt: ${FLAGS.map((f) => '--' + f).join(' ')})`)
		if (i + 1 >= argv.length) throw new Error(`--${m[1]} braucht einen Wert`)
		out[m[1]] = argv[++i]
	}
	if (!out.scenario || !SCENARIO_IDS.includes(out.scenario)) throw new Error(`--scenario fehlt oder ist unbekannt (${SCENARIO_IDS.join(' | ')})`)
	const num = (k, re, lo, hi) => {
		if (out[k] === undefined) return undefined
		if (!re.test(out[k]) || Number(out[k]) < lo || Number(out[k]) > hi) throw new Error(`--${k} '${out[k]}' ist ungültig (${lo}–${hi})`)
		return Number(out[k])
	}
	const list = (k, n) => {
		if (out[k] === undefined) return undefined
		if (!/^\d{1,5}(,\d{1,5})*$/.test(out[k]) || (n && out[k].split(',').length !== n)) throw new Error(`--${k} '${out[k]}' ist ungültig`)
		return out[k].split(',').map(Number)
	}
	const board = list('board', 4)
	const pageRequests = list('page-requests', 2)
	if (pageRequests && (out.scenario !== 'SC' || pageRequests.some((v) => v < 1 || v > 1000))) throw new Error(`--page-requests '${out['page-requests']}' gilt nur für SC, je 1–1000 Anfragen`)
	return {
		scenario: out.scenario,
		seed: num('seed', /^\d{1,10}$/, 0, 4294967295),
		secs: num('secs', /^\d+(\.\d+)?$/, 1, 3600),
		warmupS: num('warmup', /^\d+(\.\d+)?$/, 0, 600),
		scale: num('scale', /^\d+(\.\d+)?$/, 0.01, 10),
		board: board ? { notes: board[0], shapes: board[1], connectors: board[2], frames: board[3] } : undefined,
		steps: list('steps'),
		abortFile: out['abort-file'],
		...(pageRequests ? { pageRequests } : {}),
	}
}

async function main() {
	let args
	const label = process.env.KD_RUN_LABEL || ''
	try {
		args = parseArgs(process.argv.slice(2))
		if (label && !LABEL_RE.test(label)) throw new Error(`KD_RUN_LABEL '${label}' ist ungültig (${LABEL_RE})`)
	} catch (e) {
		console.error(`[load] ${e.message}`)
		return 2
	}
	const ns = process.env.KD_NS || 'load'
	let env
	try {
		env = loadEnv(ns)
	} catch (e) {
		console.error(`[load] ${e.message}`)
		return 2
	}
	const stack = new Stack(env)
	const metrics = new Collectors(env, stack)
	const deps = {
		metrics,
		changes: async (b) => (await stack.changesJson(b)).rows,
		epoch: () => stack.epoch(),
		host: () => hostNow(),
		faults: SCENARIOS[args.scenario].faults ? new FaultInjector(env, stack) : undefined,
	}
	const stop = { requested: false, reason: null, signal: null }
	const onSignal = (sig) => {
		let reason = null
		try { reason = args.abortFile ? fs.readFileSync(args.abortFile, 'utf8').trim() : null } catch { /* no reason file */ }
		stop.requested = true
		stop.signal = sig
		stop.reason = reason || sig
		console.error(`[load] ${sig}${reason ? ` – Abbruchregel: ${reason}` : ''}; Lauf wird beendet, Bericht folgt`)
		stop.onStop?.()
	}
	process.on('SIGTERM', () => onSignal('SIGTERM'))
	process.on('SIGINT', () => onSignal('SIGINT'))
	const seed = args.seed ?? randomInt(0, 4294967295)
	console.log(`[load] ${args.scenario} in Namensraum ${ns}, Seed ${seed}${label ? `, Kennzeichen ${label}` : ''}, Board ${JSON.stringify(args.board ?? BOARD)}`)
	let rep
	try {
		rep = await runScenario({ env, scenario: args.scenario, seed, secs: args.secs, warmupS: args.warmupS, scale: args.scale, board: args.board, steps: args.steps, pageRequests: args.pageRequests, deps, stop })
	} catch (e) {
		console.error(`[load] ${e.message}`)
		return e.code === 2 ? 2 : 1
	}
	rep.ns = ns
	const dir = outDir(ns)
	const files = writeRunReports(dir, rep, label)
	writeSummary(dir, label)
	console.log(`[load] Bericht: ${files.filter((f) => f.endsWith('.md')).join(', ')}; Übersicht ${dir}/summary.md`)
	console.log(`[load] Ergebnis: ${rep.aborted ? `abgebrochen (${rep.aborted.reason})` : rep.error ? `Fehler: ${rep.error}` : rep.gate?.ok === null ? 'Bericht' : rep.gate?.ok ? 'grün' : 'rot'}`)
	if (stop.requested) return stop.reason && stop.reason !== stop.signal ? 3 : stop.signal === 'SIGINT' ? 130 : 143
	if (rep.error) return rep.notApplicable ? 2 : 1
	if (rep.gate?.ok === true) return 0
	if (rep.gate?.ok === false) return 1
	// report-only scenarios (S1, S4d): complete and their own checks green
	return SCENARIOS[args.scenario].gate ? 1 : rep.checks && rep.checks.ok === false ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().then((code) => process.exit(code), (e) => { console.error('[load] ABBRUCH', e); process.exit(1) })
}
