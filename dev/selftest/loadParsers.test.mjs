/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The pure parts of the load run (SPEC-M1 §8.7, stage 4 phase 0, row 4.1),
 * without a stack:
 *
 * - dev/load/lib/edge.mjs: the spike's edge model, pinned on fixed arrival
 *   traces (a burst of 500 at t = 0, steady 150/s and 250/s for 10 s) with
 *   the numbers that follow from the token bucket 200/s, burst 400,
 *   maxDelay 2.5 ms; its code is the spike's byte for byte below the added
 *   provenance comment (checked when the spike folder exists)
 * - dev/load/lib/metrics.mjs: every parser on the fixtures in
 *   dev/selftest/fixtures/load/ (cgroup cpu.stat, memory.current, Apache
 *   server-status, pg_stat_database, pg_stat_statements, Redis INFO,
 *   nextcloud.log, /proc/loadavg, occ app:list)
 * - dev/load/lib/plan.mjs: scenario table, actor counts (130 mirrors in S4),
 *   report names (§9.0 point 2 with KD_RUN_LABEL), seeded streams
 * - dev/load/lib/gates.mjs: S4 rules green/red/not measured, SC model
 * - dev/load/lib/summary.mjs: run reports with label and copy, summary.md
 * - Revision 19 (SPEC-M1 §8.7, phase 1): the write-budget counters w:/wo:
 *   per pid and window (calibration source, T4-09), rule 7 over
 *   r:/p:/vt:/w:/wo: (T4-19), the board-lock report with its [B] threshold
 *   (T4-16), the Apache access log per time window (page requests for SC,
 *   T4-11), measureSF and the new report lines
 * - Revision 20 (phase 2, K2/K3): dev/load/lib/pageload.mjs takes the one
 *   shared protectedNs of dev/sim/lib/env.mjs and refuses a protected
 *   namespace before loadEnv and any docker call (run from a sandbox copy
 *   with the fake docker); its Playwright container runs without --ipc=host
 * - fix round [D] of stage 4 phase 2 (W3 r1w3, F2–F6): the collectors start
 *   every window fresh (two before()/summary() cycles on one instance, no
 *   docker: injected command runner and status reader); the seeding's
 *   counters (fixture budget-keys.txt) stay out of maxPerPid and go to
 *   budget.seed; the S5 gate at 45 counts the errors of S4 rule 2 (a step
 *   with `bad` is red); the S5 report and the summary carry one row per step
 *   and the T4-10 verdict; a negative cgroup delta is a gap; parseNcLog
 *   redacts auth= and password parameters; SF rule 3 reading (a): a 401
 *   counts when its request was SENT after the end of the Redis restart
 *   window, 401s sent during it are reported apart
 * - fix round p2d (W3 r2w3, G1–G8): every run names the pooled sync p95 and
 *   the class of the maximum, the S5 gate keeps the maximum of the class p95
 *   (G1); SF rule 3 counts per device and session the first 401 (G2), rule 2
 *   is red for a device that never recovers, re-logged devices apart (G3);
 *   the CPU mean is time-weighted, readings with an interval ≈ 0 are
 *   dropped, intervals above the cap named (G5); the budget is read on its
 *   own 5-s clock, an expired key is "nicht vorhanden" (G6); the board lock
 *   says "0 Aufrufe", S5 one line per step (G7); no "auth=" stays in a
 *   written report (G8)
 * - close-out of stage 4 (R21): the CPU cap is the container's cpu.max or
 *   cpuset first, the host's CPUs without the generator's affinity only
 *   without either (W3V-01); a 401 line says "zählt für Regel 3" only when
 *   it was sent after the restart window (W3V-02); the page measurement
 *   names every request other than 200 as nonOk {status, method, path}
 *   (W3V-03); the knee counts the errors of S4 rule 2 without busy, the
 *   definition of the S5 gate at 45 (P2B-01)
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './lib/sandbox.mjs'
import * as E from '../load/lib/edge.mjs'
import * as M from '../load/lib/metrics.mjs'
import { BOARD, FAULT_IDS, GATE_S4, LABEL_RE, SCENARIOS, SCENARIO_IDS, STEM_RE, actorCounts, coldStartArrivals, decisionTrace, reportStem, rngFor, timeline } from '../load/lib/plan.mjs'
import { evaluate, evaluateS4, evaluateS5, evaluateSF, kneeErrors, rule2Errors } from '../load/lib/gates.mjs'
import { Collectors, CpuSampler, cgroupCap, cpusetCount } from '../load/lib/collect.mjs'
import { measureSF } from '../load/lib/faults.mjs'
import { REPORT_FILE_RE, outDir, writeRunReports, writeSummary } from '../load/lib/summary.mjs'
import { coldStartModel, stepKnee } from '../load/lib/generator.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIX = path.join(ROOT, 'dev/selftest/fixtures/load')
const fx = (f) => fs.readFileSync(path.join(FIX, f), 'utf8')
const SPIKE_EDGE = path.resolve(ROOT, '../knorke-spike/poll/load/edge.mjs')
const steady = (rps, s) => Array.from({ length: rps * s }, (_, i) => (i * 1000) / rps)

// --- edge model ----------------------------------------------------------------

test('edge model: token bucket 200/s, burst 400, maxDelay 2.5 ms on fixed arrival traces', () => {
	assert.deepEqual(E.EDGE_GLOBAL, { name: 'ratelimit-global', average: 200, periodS: 1, burst: 400 })
	assert.equal(E.maxDelayMs(200), 2.5)
	assert.equal(E.maxDelayMs(2), 250)
	assert.equal(E.maxDelayMs(0.5), 500)
	// 500 at once: the burst lets 400 through, the rest find no token
	assert.deepEqual(E.replayBucket(new Array(500).fill(0)), { requests: 500, rejected: 100, rejectedShare: 0.2, delayed: 0, minTokens: 0, firstRejectAfterS: 0 })
	// 150/s stays below the refill: one token used, refilled before the next
	assert.deepEqual(E.replayBucket(steady(150, 10)), { requests: 1500, rejected: 0, rejectedShare: 0, delayed: 0, minTokens: 399, firstRejectAfterS: null })
	// 250/s drains 0.2 tokens per request: the burst is gone after 2000 requests = 8 s, then ≈ 1 − 200/250 of the rest fail
	const r = E.replayBucket(steady(250, 10))
	assert.equal(r.firstRejectAfterS, 8)
	assert.equal(r.rejected, 101)
	assert.equal(r.delayed, 202)
	const v = E.edgeVerdict(steady(250, 10), 250)
	assert.equal(v.meanHeadroom, -0.2)
	assert.equal(v.longRunRejectShare, 0.2)
	assert.equal(v.drainSecs, 8)
	assert.equal(v.max10sRps, 250)
	assert.equal(E.slidingMaxRate([0, 10, 20, 1500, 1501], 1000), 3)
	// windowStarts: arrival = end time − latency, measurement rows only
	assert.deepEqual(E.windowStarts({ samples: { columns: ['tMs', 'key', 'who', 'kind', 'status', 'ms', 'bytes', 'phase'], rows: [[100, 'sync', 'e', '', 200, 30, 1, 'measure'], [90, 'join', 't', '', 200, 10, 1, 'warmup']] } }), [70])
})

test('edge.mjs is the spike\'s model unchanged (only the provenance comment added)', { skip: !fs.existsSync(SPIKE_EDGE) && 'spike folder not on this host' }, () => {
	const ours = fs.readFileSync(path.join(ROOT, 'dev/load/lib/edge.mjs'), 'utf8').split('\n')
	const spike = fs.readFileSync(SPIKE_EDGE, 'utf8').split('\n')
	const added = ours.filter((l, i) => !(spike.includes(l)))
	assert.ok(added.every((l) => l === '' || l.startsWith('//')), `only comment lines added: ${added.filter((l) => !l.startsWith('//')).join(' | ')}`)
	assert.deepEqual(ours.filter((l) => !l.startsWith('//')), spike.filter((l) => !l.startsWith('//')), 'every code line equal and in order')
})

// --- metrics parsers -------------------------------------------------------------

test('metrics: cgroup cpu.stat, memory.current, cores between two readings, cgroup dirs', () => {
	assert.equal(M.parseCpuStat(fx('cpu.stat')), 123456789)
	assert.equal(M.parseCpuStat('user_usec 5\n'), null)
	assert.equal(M.parseMemoryCurrent(fx('memory.current')), 700)
	assert.equal(M.parseMemoryCurrent(''), null)
	assert.equal(M.coresBetween(1_000_000, 3_500_000, 1000), 2.5, '2.5 s CPU in 1 s = 2.5 cores')
	assert.equal(M.coresBetween(null, 5, 1000), null)
	const id = 'a'.repeat(64)
	assert.deepEqual(M.cgroupDirs(id), [`/sys/fs/cgroup/docker/${id}`, `/sys/fs/cgroup/system.slice/docker-${id}.scope`])
	assert.deepEqual(M.cgroupDirs('../etc'), [], 'only a 64-hex id builds a path')
})

test('metrics: Apache server-status, pg_stat_database delta, pg_stat_statements', () => {
	assert.deepEqual(M.parseApacheStatus(fx('server-status.txt')), { busy: 7, idle: 3, W: 5, K: 2, R: 1, open: 43, slots: 54 })
	assert.equal(M.parseApacheStatus('<html>Forbidden</html>'), null)
	const a = M.parsePgDatabase(fx('pg-database-0.txt'))
	const b = M.parsePgDatabase(fx('pg-database-1.txt'))
	assert.equal(a.numbackends, 7)
	const d = M.pgDelta(a, b, 10, 100)
	assert.equal(d.delta.xact_commit, 900)
	assert.equal(d.perSec.xact_commit, 90)
	assert.equal(d.perRequest.tup_inserted, 0.6)
	assert.equal(d.numbackendsAfter, 11)
	assert.equal('numbackends' in d.delta, false)
	assert.equal(M.parsePgDatabase('ERROR: relation'), null)
	assert.equal(M.parsePgStatements(fx('pg-statements.txt'))[0].calls, 900)
	assert.equal(M.parsePgStatements('x'), null)
})

test('metrics: Redis INFO commandstats and delta', () => {
	const r = M.parseRedisInfo(fx('redis-info.txt'))
	assert.deepEqual(r.cmd.get, { calls: 8000, usec: 16000 })
	assert.deepEqual(r.cmd['client|setname'], { calls: 5, usec: 5 })
	assert.equal(r.total_commands_processed, 15000)
	assert.equal(r.used_memory, 2097152)
	assert.equal(M.parseRedisInfo('NOAUTH Authentication required.'), null)
	const before = { cmd: { get: { calls: 6000, usec: 10000 } }, total_commands_processed: 10000, keyspace_hits: 6000, keyspace_misses: 1000, total_connections_received: 300 }
	const d = M.redisDelta(before, r, 10, 500)
	assert.equal(d.commandsPerSec, 500)
	assert.equal(d.commandsPerRequest, 10)
	assert.equal(d.hitRate, 1, '3000 hits, 0 misses in between')
	assert.deepEqual(d.perCommand.get, { calls: 2000, perSec: 200, perRequest: 4, usecPerCall: 3 })
	assert.equal(d.usedMemoryMB, 2)
	assert.equal(d.connectionsPerSec, 4)
})

test('metrics: nextcloud.log ≥ 2 grouped, Knorke entries by level, too many clients, unparsed lines counted', () => {
	const l = M.parseNcLog(fx('nextcloud.log'))
	assert.equal(l.entries, 5, 'level 1 is below the threshold')
	assert.deepEqual(l.byLevel, { 2: 3, 3: 2 })
	assert.equal(l.knorke.total, 2)
	assert.equal(l.knorke.atLeast3, 1, 'rule 7: one Knorke entry ≥ 3')
	assert.equal(l.tooManyClients, 1, 'rule 6: PostgreSQL ran out of connections')
	assert.equal(l.unparsed, 1)
	assert.deepEqual(l.top[0], { n: 2, m: 'L2 core: Login failed: x' })
	assert.equal(M.parseNcLog('').entries, 0)
})

test('metrics: loadavg, STRLEN, app list, stats/pct', () => {
	assert.deepEqual(M.parseLoadavg(fx('loadavg')), { one: 3.42, five: 2.1, fifteen: 1.05 })
	assert.equal(M.parseLoadavg('garbage'), null)
	assert.equal(M.parseStrlen('(integer) 15360'), 15360)
	assert.equal(M.parseStrlen('4096\n'), 4096)
	assert.equal(M.parseStrlen('ERR'), null)
	assert.deepEqual(M.parseAppList(fx('app-list.json')), [['admincockpit', '1.4.5'], ['circles', '34.0.0'], ['knorke', '0.2.0']])
	assert.deepEqual(M.stats([5, 1, 3, 2, 4]), { n: 5, mean: 3, p50: 3, p95: 5, p99: 5, max: 5 })
	assert.deepEqual(M.stats([]), { n: 0, mean: null, p50: null, p95: null, p99: null, max: null })
	assert.equal(M.pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10)
})

// --- plan ---------------------------------------------------------------------

test('plan: the scenarios of §8.7, 130 mirrors in S4, scaled timeline, SF fault order', () => {
	assert.deepEqual(SCENARIO_IDS, ['S1', 'S4', 'S4e', 'S4d', 'S5', 'SF', 'SC'])
	assert.deepEqual(BOARD, { notes: 3000, shapes: 500, connectors: 800, frames: 20 })
	const c = actorCounts(SCENARIOS.S4)
	assert.deepEqual(c, { editors: 30, moderator: 1, accounts: 24, guests: 5, tablets: 100 })
	assert.equal(c.editors + c.tablets, 130, 'K1: all 130 mirrors')
	assert.deepEqual(actorCounts(SCENARIOS.S1), { editors: 30, moderator: 0, accounts: 25, guests: 5, tablets: 100 })
	assert.deepEqual(actorCounts(SCENARIOS.S5, { editors: 90 }), { editors: 90, moderator: 1, accounts: 84, guests: 5, tablets: 100 })
	assert.deepEqual(SCENARIOS.S5.steps, [30, 45, 60, 75, 90])
	assert.deepEqual(timeline(SCENARIOS.S4, 90), { k: 1, windowMs: 90000, voteOpenMs: 20000, voteCloseMs: 80000 })
	assert.deepEqual(timeline(SCENARIOS.S4, 9), { k: 0.1, windowMs: 9000, voteOpenMs: 2000, voteCloseMs: 8000 })
	assert.equal(SCENARIOS.S4d.requiresVariant, 'dbpersistent')
	assert.equal(SCENARIOS.SF.knorkeDev, true)
	assert.deepEqual(FAULT_IDS, ['skip-bump', 'rev-del', 'rev-lower', 'presence-del', 'gens-del', 'all-del', 'epoch-rotate', 'redis-restart', 'db-pause'])
	assert.equal(GATE_S4.edge.meanRpsMax, 153.8, '≥ 30 % headroom below 200/s')
})

test('plan: report names <scenario>-<variant>[-<label>] (§9.0 point 2), label regex', () => {
	assert.deepEqual(reportStem({ scenario: 'S4' }), { stem: 's4-base', latest: 's4-base' })
	assert.deepEqual(reportStem({ scenario: 'S4d', variant: 'dbpersistent', label: 'r1w3' }), { stem: 's4d-dbpersistent-r1w3', latest: 's4d-dbpersistent' })
	assert.deepEqual(reportStem({ scenario: 'S4', variant: 'app-off-admincockpit', label: 'e1' }), { stem: 's4-app-off-admincockpit-e1', latest: 's4-app-off-admincockpit' })
	for (const bad of ['R1', 'r1_w', 'a'.repeat(25), 'x y', '../x']) assert.throws(() => reportStem({ scenario: 'S4', label: bad }), /KD_RUN_LABEL/, bad)
	assert.throws(() => reportStem({ scenario: 'S9' }), /unbekannt/)
	assert.throws(() => reportStem({ scenario: 'S4', variant: 'x' }), /Variante/)
	assert.ok(LABEL_RE.test('a'.repeat(24)) && !LABEL_RE.test(''))
	for (const s of ['s4-base', 's4d-dbpersistent-r1w3', 's4-app-off-user_oidc-e1']) assert.match(s, STEM_RE)
	const m = REPORT_FILE_RE.exec('s4-app-off-user_oidc-e1.json')
	assert.deepEqual([m[1], m[2], m[3]], ['s4', 'app-off-user_oidc', 'e1'], 'app ids carry no dash: variant and label part unambiguously')
	assert.equal(REPORT_FILE_RE.exec('s4-base.json')[3], undefined)
	assert.equal(REPORT_FILE_RE.test('summary.json'), false)
})

test('plan: one seeded stream per actor – same seed, same decisions; seeded ULIDs and client ids', () => {
	assert.deepEqual(decisionTrace(42, 3), decisionTrace(42, 3))
	assert.notDeepEqual(decisionTrace(42, 3), decisionTrace(43, 3))
	assert.notDeepEqual(decisionTrace(42, 3), decisionTrace(42, 4))
	const a = rngFor(7, 1)
	const b = rngFor(7, 1)
	const u = a.ulid(1760000000000)
	assert.match(u, /^[0-9A-HJKMNP-TV-Z]{26}$/)
	assert.equal(u, b.ulid(1760000000000))
	assert.match(a.clientId(), /^c[A-Za-z0-9]{9}$/)
	assert.deepEqual(coldStartArrivals({ editors: 2, tablets: 3, spreadS: 60, seed: 5 }), coldStartArrivals({ editors: 2, tablets: 3, spreadS: 60, seed: 5 }))
	assert.equal(coldStartArrivals({ editors: 30, tablets: 100, spreadS: 60, seed: 5 }).length, 30 * 85 + 100 * 34)
})

// --- gates ----------------------------------------------------------------------

function greenS4() {
	return {
		scenario: 'S4', protocolErrors: [], opCodes: { ok: 900, locked: 3, gone: 2 }, budget: { busy: 0 },
		checks: { k1: { ok: true, equal: 130, clients: 130 }, k2: { ok: true }, k3: { ok: true, checked: 900, failures: 0 }, votes: { ok: true } },
		totals: { requests: 11000, status5xx: 0, status4xx: 0, timeouts: 0, netErrors: 0, bytesPerSec: 500000, bytesPlainPerSec: 3000000 },
		edge: { rejected: 0, meanRps: 122, max10sRps: 140, minTokens: 377 },
		latency: { 'sync-empty': { n: 5000, p95: 30, p99: 50, max: 300 }, 'sync-items': { n: 3000, p95: 60, p99: 100, max: 400 }, 'sync-ops': { n: 1000, p95: 90, p99: 150, max: 600 }, 'sync-vote': { n: 300, p95: 70, p99: 100, max: 200 }, snapshot: { n: 130, p95: 400, p99: 480, max: 700 } },
		metrics: { ncPgCoresMean: 5.5, msPerRequest: 30, apache: { busy: { max: 40 } }, postgres: { numbackends: { max: 30 } }, nextcloudLog: { tooManyClients: 0, knorke: { atLeast3: 0 } } },
		hygiene: { noTtl: 0 },
		presence: { cursorLagMs: { p95: 900 }, blobBytes: { max: 40000 }, followLagMs: { p95: 2100, max: 2400 } },
		config: { tablets: 100, workshop: {} },
	}
}

test('gates: S4 rules 1–9 green, one red rule, a missing collector is never green', () => {
	const g = evaluateS4(greenS4())
	assert.equal(g.ok, true, JSON.stringify(g.rules.filter((r) => r.ok !== true)))
	assert.deepEqual(g.rules.map((r) => r.rule), [1, 2, 3, 4, 5, 6, 7, 8, 9])
	assert.equal(g.rules[4].value.targetMet, false, '5.5 cores: between the target 5.0 and the hard 6.6 (E1 decides)')
	const red = greenS4()
	red.budget.busy = 1
	red.opCodes.bad = 1
	const r2 = evaluateS4(red)
	assert.equal(r2.ok, false)
	assert.equal(r2.rules[1].ok, false)
	const missing = greenS4()
	delete missing.metrics
	const r3 = evaluateS4(missing)
	assert.equal(r3.ok, false)
	assert.equal(r3.rules[4].ok, null, 'CPU not measured')
	const slow = greenS4()
	slow.latency.snapshot.p95 = 600
	assert.equal(evaluateS4(slow).rules[3].ok, false)
	const edge = greenS4()
	edge.edge.minTokens = 250
	assert.equal(evaluateS4(edge).rules[2].ok, false, 'bucket below 280/400')
	const bw = greenS4()
	bw.totals.bytesPerSec = 3 * 1024 * 1024
	const r4 = evaluateS4(bw)
	assert.equal(r4.ok, true, 'rule 9 only warns')
	assert.equal(r4.rules[8].warn, true)
	assert.equal(evaluate({ scenario: 'S1' }).ok, null, 'S1 is report only')
	assert.equal(evaluate({ scenario: 'S4d' }).ok, null, 'S4d is report only')
})

test('gates: SC judges the model at 60 s; S5 needs its 45-editor step', () => {
	const sc = SCENARIOS.SC
	const model = coldStartModel(sc, actorCounts(sc), 3)
	assert.deepEqual(model.map((m) => m.spreadS), [30, 60, 120])
	assert.deepEqual(model.map((m) => m.requests), [5950, 5950, 5950], '30 × 85 + 100 × 34 requests in every spread')
	assert.equal(model[1].rejected, 0, 'seed 3: 60 s spread passes the bucket')
	assert.equal(evaluate({ scenario: 'SC', coldStart: model }).ok, true)
	assert.equal(evaluate({ scenario: 'SC', coldStart: [{ spreadS: 60, rejected: 3 }] }).ok, false)
	assert.equal(evaluate({ scenario: 'S5', steps: [{ config: { editors: 30 }, checks: { ok: true }, totals: { status5xx: 0, timeouts: 0, netErrors: 0, status429: 0 }, endpoints: {}, edge: { rejected: 0 } }] }).ok, false, 'no 45-editor step: not proven')
})

// --- reports ---------------------------------------------------------------------

test('reports: <stem>[-<label>].{json,md} plus the unlabelled copy; summary.md with seed, variant, uptime, versions, apps', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const rep = (seed, extra = {}) => ({
		scenario: 'S4', variant: 'base', seed, title: 'S4', finishedAt: `2026-10-13T16:0${seed % 10}:00Z`,
		host: { before: { uptime: '16:00 up 3 days, load average: 1.00' }, after: { uptime: '16:02 up 3 days, load average: 9.00' } },
		versions: { nextcloud: '34.0.1', php: '8.3.26', db: 'pgsql 17.6', redis: '7.4.1', image: 'nextcloud:34-apache' },
		apps: [['admincockpit', '1.4.5'], ['knorke', '0.2.0']], totals: { requests: 10, rps: 122.4, status5xx: 0, status4xx: 0, timeouts: 0, netErrors: 0 },
		gate: { kind: 's4', ok: true, rules: [] }, ...extra,
	})
	let files = writeRunReports(dir, rep(1), 'r1')
	assert.deepEqual(files.map((f) => path.basename(f)).sort(), ['s4-base-r1.json', 's4-base-r1.md', 's4-base.json', 's4-base.md'])
	files = writeRunReports(dir, rep(2), '')
	assert.deepEqual(files.map((f) => path.basename(f)).sort(), ['s4-base.json', 's4-base.md'])
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's4-base.json'), 'utf8')).seed, 2, 'the copy is the LAST run')
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's4-base-r1.json'), 'utf8')).seed, 1, 'the labelled run stays')
	writeRunReports(dir, { ...rep(3), scenario: 'S4d', variant: 'dbpersistent', gate: { ok: null, rules: [] } }, 'r1')
	const out = writeSummary(dir, 'r1')
	assert.deepEqual(out.map((f) => path.basename(f)).sort(), ['summary-r1.json', 'summary-r1.md', 'summary.json', 'summary.md'])
	const md = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8')
	assert.match(md, /^# Lastlauf – Übersicht$/m)
	assert.match(md, /^\| S4 \| base \| 2 \| — \| grün \| 122,4 \| — \| — \| 16:00 up 3 days, load average: 1\.00 \| 16:02 up 3 days, load average: 9\.00 \| s4-base\.json \|$/m)
	assert.match(md, /^\| S4d \| dbpersistent \| 3 \| r1 \| Bericht \|/m)
	assert.match(md, /Nextcloud 34\.0\.1, PHP 8\.3\.26, DB pgsql 17\.6, Redis 7\.4\.1, Image nextcloud:34-apache/)
	assert.match(md, /admincockpit 1\.4\.5, knorke 0\.2\.0/)
	const labelled = JSON.parse(fs.readFileSync(path.join(dir, 'summary-r1.json'), 'utf8'))
	assert.deepEqual(labelled.rows.map((r) => r.file).sort(), ['s4-base-r1.json', 's4d-dbpersistent-r1.json'])
	assert.match(fs.readFileSync(path.join(dir, 's4-base-r1.md'), 'utf8'), /Uptime vorher: 16:00 up 3 days/)
	assert.equal(outDir('load', '/x'), '/x/load')
	assert.throws(() => outDir('out'), /reserviert/)
	assert.throws(() => outDir('../x'), /ungültig/)
	assert.match(outDir('load'), /dev\/load\/out\/load$/, 'P2 of §10: dev/load/out/load/summary.md')
})

// --- Revision 19 (SPEC-M1 §8.7, stage 4 phase 1) ------------------------------------

test('R19 T4-09: write-budget counters w:/wo: → the maximum per pid and window, merged over samples; other boards and forms ignored', () => {
	const e = (k, v) => [`d38b/knorke/k3x9a0b2/${k}`, String(v)]
	const a = M.parseBudgetKeys([e('w:7:u-alice:1791000', 12), e('wo:7:u-alice:1791000', 300), e('w:7:g1a2b3c4d5e6f7a8:1791000', 4), e('wo:7:g1a2b3c4d5e6f7a8:1791001', 2500), e('w:8:u-alice:1791000', 59), ['junk', '1'], e('w:7:u-bob:x', 3)], 7)
	assert.deepEqual(a.maxPerPid, { syncs: 12, ops: 2500 })
	assert.deepEqual(a.byPid, { 'u-alice': { syncs: 12, ops: 300 }, g1a2b3c4d5e6f7a8: { syncs: 4, ops: 2500 } })
	assert.equal(a.keys, 4)
	const b = M.parseBudgetKeys([e('w:7:u-alice:1791001', 30), e('wo:7:u-carol:1791001', 10)], 7)
	const m = M.mergeBudget(a, b)
	assert.deepEqual(m.maxPerPid, { syncs: 30, ops: 2500 })
	assert.deepEqual(m.byPid['u-alice'], { syncs: 30, ops: 300 })
	assert.deepEqual(m.byPid['u-carol'], { syncs: 0, ops: 10 })
	assert.deepEqual(M.parseBudgetKeys([], 7).maxPerPid, { syncs: null, ops: null }, 'no counter: not measured')
	assert.equal(M.mergeBudget(null, b), b)
})

test('R19 T4-19: rule 7 looks at r:, p:, vt:, w:, wo: of the board', () => {
	assert.deepEqual(M.hygienePatterns(7), ['*/knorke/*/r:7', '*/knorke/*/p:7', '*/knorke/*/vt:7', '*/knorke/*/w:7:*', '*/knorke/*/wo:7:*'])
	const g = evaluateS4({ checks: {}, totals: {}, metrics: { nextcloudLog: { knorke: { atLeast3: 0 } } }, hygiene: { noTtl: 1 } })
	assert.equal(g.rules[6].ok, false, 'one key without TTL: rule 7 red')
	assert.match(g.rules[6].threshold, /r:\/p:\/vt:\/w:\/wo:/)
})

test('R19 T4-16: board-lock report – lockBoard and the vote statements from pg_stat_statements, vote-sync p95; finding [B] above 50 ms or 120 ms', () => {
	const rows = [
		{ calls: 900, mean_ms: 1.2, max_ms: 38.5, total_ms: 1080, query: 'UPDATE oc_knorke_boards SET acl_gen = acl_gen + $1, link_gen = link_gen + $2, vote_link_gen = vote_link_gen + $3 WHERE id = $4' },
		{ calls: 400, mean_ms: 0.4, max_ms: 3, total_ms: 160, query: 'INSERT INTO oc_knorke_votes (session_id, voter, item_id, n, ts) VALUES ($1, $2, $3, $4, $5)' },
		{ calls: 100, mean_ms: 0.2, max_ms: 1, total_ms: 20, query: 'SELECT * FROM oc_knorke_vote_sessions WHERE board_id = $1' },
		{ calls: 50, mean_ms: 0.1, max_ms: 90, total_ms: 5, query: 'UPDATE oc_knorke_boards SET rev = rev + $1 WHERE id = $2' },
	]
	const ok = M.boardLockReport(rows, { n: 300, p95: 80, max: 140 })
	assert.deepEqual(ok.lock, { calls: 900, meanMs: 1.2, maxMs: 38.5 }, 'only the lock statement of lockBoard')
	assert.equal(ok.votes.length, 2)
	assert.equal(ok.finding, null)
	assert.equal(M.boardLockReport([{ ...rows[0], max_ms: 51 }], { n: 1, p95: 10 }).finding, '[B]', 'lock above 50 ms')
	assert.equal(M.boardLockReport(rows, { n: 9, p95: 121 }).finding, '[B]', 'vote-sync p95 above 120 ms')
	const none = M.boardLockReport(null, null)
	assert.deepEqual([none.measured, none.lock, none.finding], [false, null, null])
	// the regex matches the statement of BoardStore::lockBoard as pg_stat_statements normalises it ([B] owns the PHP)
	const php = fs.readFileSync(path.join(ROOT, 'lib/Db/BoardStore.php'), 'utf8').match(/'(UPDATE \*PREFIX\*knorke_boards SET acl_gen = acl_gen \+ \?[^']*)'/)?.[1]
	assert.ok(php, 'lockBoard UPDATE found in lib/Db/BoardStore.php')
	let k = 0
	assert.match(php.replace('*PREFIX*', 'oc_').replace(/\?/g, () => `$${++k}`), M.LOCK_STATEMENT_RE)
})

test('R19 T4-11: Apache access log → server-side requests of one client per time window', () => {
	const log = [
		'172.30.0.9 - - [13/Oct/2026:16:40:01 +0000] "GET /index.php/apps/knorke/b/7 HTTP/1.1" 200 1234 "-" "Mozilla"',
		'172.30.0.9 - - [13/Oct/2026:16:40:02 +0000] "GET /custom_apps/knorke/js/knorke-main.mjs?v=1 HTTP/1.1" 200 99 "-" "Mozilla"',
		'172.30.0.8 - - [13/Oct/2026:16:40:02 +0000] "GET /status.php HTTP/1.1" 200 9 "-" "curl"',
		'172.30.0.9 - - [13/Oct/2026:18:40:30 +0200] "POST /index.php/apps/knorke/api/v1/boards/7/sync HTTP/1.1" 304 0 "-" "Mozilla"',
		'garbage',
		'172.30.0.9 - - [13/Oct/2026:16:41:10 +0000] "GET /index.php/apps/knorke/p/AbCd HTTP/1.1" 200 1 "-" "Mozilla"',
	].join('\n')
	const w = M.countAccessLog(log, '172.30.0.9', [
		{ name: 'board', from: '2026-10-13T16:40:00.500Z', to: '2026-10-13T16:40:59Z' },
		{ name: 'vote', from: '2026-10-13T16:41:00Z', to: '2026-10-13T16:41:59Z' },
	])
	assert.deepEqual(w, [
		{ name: 'board', requests: 3, statuses: { 200: 2, 304: 1 }, nonOk: [{ status: 304, method: 'POST', path: '/index.php/apps/knorke/api/v1/boards/7/sync' }] },
		{ name: 'vote', requests: 1, statuses: { 200: 1 }, nonOk: [] },
	], 'the window start rounds down to the second; +0200 converted; other clients ignored; R21: every status other than 200 in nonOk')
})

test('R19: measureSF – recovery = the slowest device\'s first successful sync sent after the fault ended; 5xx outside ±5 s; 401 after the Redis restart', async () => {
	const { measureSF } = await import('../load/lib/faults.mjs')
	const W = 1_000_000
	const played = [{ id: 'rev-del', atMs: 10000, endMs: 10000 }, { id: 'redis-restart', atMs: 30000, endMs: 30000 }, { id: 'db-pause', atMs: 50000, endMs: 53000 }]
	const ok = new Map([['tablet-001', [W + 9000, W + 11000, W + 31000, W + 54000]], ['editor-01', [W + 10400, W + 32500, W + 53500]], ['editor-02', []]])
	const offset = 2000
	const sample = (wMs, status) => [wMs + offset, 'sync-empty', 'editor', '', status, 10, 0, 'measure']
	const r = measureSF(played, [sample(12000, 500), sample(20000, 503), sample(31000, 401), sample(25000, 401), sample(56000, 502)], offset, ok, W)
	assert.deepEqual(r.played.map((p) => [p.id, p.recoveryS, p.devices]), [['rev-del', 1, 2], ['redis-restart', 2.5, 2], ['db-pause', 1, 2]])
	assert.equal(r.fiveXxOutside, 1, 'only the 503 at 20 s lies outside every ±5-s window')
	assert.equal(r.unauthorizedAfterRedis, 1, 'the 401 at 31 s (the one at 25 s came before the restart)')
	assert.equal(measureSF([{ id: 'rev-del', atMs: 1, endMs: 1 }], [], 0, new Map(), W).played[0].recoveryS, null, 'no device answered: not measured (never green)')
})

test('R19: the run report names tabs per account, budget.maxPerPid, the board-lock report, SC\'s page sources, SF recovery and an invalid run', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const rep = {
		scenario: 'S4', variant: 'base', seed: 1, title: 'S4', finishedAt: '2026-10-13T16:00:00Z', config: { editors: 30, tabsPerAccount: 1 },
		budget: { busy: 0, maxPerPid: { syncs: 26, ops: 410 } },
		boardLock: M.boardLockReport([{ calls: 9, mean_ms: 1, max_ms: 60, query: 'UPDATE oc_knorke_boards SET acl_gen = acl_gen + $1' }], { n: 3, p95: 70, max: 90 }),
		gate: { kind: 'aborted', ok: false, invalid: true, rules: [], note: 'Abbruch durch den Lastschutz (Last): Lauf ungültig' },
	}
	writeRunReports(dir, rep, '')
	const md = fs.readFileSync(path.join(dir, 's4-base.md'), 'utf8')
	assert.match(md, /Ergebnis: \*\*ungültig\*\* \(Abbruch durch den Lastschutz\)/)
	assert.match(md, /Tabs je Konto: 1/)
	assert.match(md, /höchster Zähler je pid und Fenster: 26 Anfragen mit Ops, 410 Ops/)
	assert.match(md, /Board-Lock.*max 60,000 ms.*\*\*Befund an \[B\]\*\*/)
	writeRunReports(dir, { scenario: 'SC', variant: 'base', seed: 2, pageRequests: { editor: 85, tablet: 34, measured: false, source: 'nicht gemessen (Vorgabe 85/34 aus M0) – P2 ist für SC nicht belegt', reference: { editor: 85, tablet: 34 } }, gate: { ok: false, rules: [] } }, '')
	assert.match(fs.readFileSync(path.join(dir, 'sc-base.md'), 'utf8'), /Seitenzahlen SC: Bearbeiter 85, Tablet 34 – nicht gemessen/)
	writeRunReports(dir, { scenario: 'SF', variant: 'base', seed: 3, faults: { played: [{ id: 'rev-del', title: 'r:<b> löschen', recoveryS: 1.5, devices: 130, note: '1 Schlüssel' }], fiveXxOutside: 0, unauthorizedAfterRedis: 0 }, gate: { ok: true, rules: [] } }, '')
	assert.match(fs.readFileSync(path.join(dir, 'sf-base.md'), 'utf8'), /r:<b> löschen: Erholung 1\.5 s \(130 Geräte\)/)
})

test('R19 T4-11: pageload – container name with the namespace prefix, protected namespaces refused, the --page-requests value from the windows', async () => {
	const P = await import('../load/lib/pageload.mjs')
	assert.equal(P.containerName('load', 7), 'knorke-e2e-load-pageload-7', 'the prefix knorke-e2e-<ns>- (assert_own, dev/down.sh)')
	assert.throws(() => P.containerName('../x', 7), /ungültig/)
	// R20 K2: the one shared protectedNs lives in dev/sim/lib/env.mjs (pageload, restore probe, moderate.mjs)
	const { protectedNs } = await import('../sim/lib/env.mjs')
	assert.equal(protectedNs('try', {}), true)
	assert.equal(protectedNs('try', { KD_FORCE: '1' }), false)
	assert.equal(protectedNs('load', {}), false)
	assert.equal(protectedNs('load', { KD_PROTECT_NS: 'try,load' }), true)
	assert.equal(protectedNs('try', { KD_PROTECT_NS: '' }), false, 'an explicitly empty list protects nothing (like dev/lib.sh)')
	assert.equal(P.protectedNs, undefined, 'no second copy in pageload.mjs')
	assert.equal(P.pageRequestsValue([{ name: 'board', requests: 85 }, { name: 'vote', requests: 31 }]), '85,31')
	assert.equal(P.pageRequestsValue([{ name: 'board', requests: 85 }, { name: 'vote', requests: 0 }]), null, 'a window without requests: no value')
	assert.deepEqual([P.TABLET, P.IMAGE], [{ width: 820, height: 1180 }, 'mcr.microsoft.com/playwright:v1.49.1-jammy'])
	const src = fs.readFileSync(path.join(ROOT, 'dev/load/lib/pageload.mjs'), 'utf8')
	assert.match(src, /'--network', front/, 'the namespace\'s front network')
	assert.match(src, /hasTouch: true, isMobile: true/)
	assert.match(src, /docker', \['rm', '-fv', name\]/, 'removed with rm -fv in every case')
	assert.match(src, /const \{ loadEnv, Stack, run, protectedNs \} = await import\('\.\.\/\.\.\/sim\/lib\/env\.mjs'\)/, 'the shared guard (R20 K2)')
	assert.ok(src.indexOf('if (protectedNs(ns))') > 0 && src.indexOf('if (protectedNs(ns))') < src.indexOf('loadEnv(ns'), 'refused before loadEnv')
	// R20 K3 (BD-03): the throwaway Playwright container shares no IPC namespace with the host (prod runs there too);
	// Chromium does without a large /dev/shm
	const runArgs = src.slice(src.indexOf("run('docker', ['run', '-d'"), src.indexOf("IMAGE, 'sleep', '900']"))
	assert.ok(runArgs.length > 0, 'the docker run of the Playwright container')
	assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ''), /--ipc/, 'no --ipc=host (or any --ipc)')
	assert.match(runArgs, /'--cpus', '2',\s+'--user', '47001:47001'/, 'the argument list without --ipc=host')
	assert.match(src, /chromium\.launch\(\{ args: \['--disable-dev-shm-usage'\] \}\)/, '--disable-dev-shm-usage stays')
	assert.doesNotMatch(src.replace(/^\s*\*.*$/gm, ''), /__knorke/, 'no __knorke (knorke_dev = false in load)')
})

test('R20 K2: pageload.mjs refuses a protected namespace before loadEnv and any docker call (exit 2); KD_FORCE=1 passes (SPEC-M1 §8.1)', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.copyDev('sim/lib', 'load/lib')
	fs.mkdirSync(path.join(sb.dev, '.state', 'try'), { recursive: true })
	fs.writeFileSync(path.join(sb.dev, '.state', 'try', 'env.json'), 'kaputt')
	sb.rules([[0, '*', '']])
	let r = sb.node('load/lib/pageload.mjs', [], { KD_NS: 'try' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /^\[pageload\] VERWEIGERT: Namensraum 'try' ist geschützt \(KD_PROTECT_NS\)$/m)
	assert.doesNotMatch(r.stderr, /env\.json/, 'refused before loadEnv')
	assert.deepEqual(sb.calls(), [], 'no docker call')
	r = sb.node('load/lib/pageload.mjs', [], { KD_NS: 'try', KD_FORCE: '1' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /env\.json fehlt oder ist kaputt/, 'KD_FORCE=1 passes the guard; loadEnv refuses the broken file')
	assert.deepEqual(sb.calls(), [], 'still no docker call')
})

// --- fix round [D], stage 4 phase 2 (W3 r1w3: W3E-02..10, AUD-01/03..06) ---------------

test('F2: one Collectors instance over two windows (S5 steps) – the second summary holds only its own samples and keys', async () => {
	const env = { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' }, load: { statusUrl: 'http://fake/server-status?auto' } }
	let keys = {}
	let backends = 0
	const stack = {
		psql: async (sql) => [/numbackends FROM/.test(sql) && !/xact_commit/.test(sql) ? String(++backends) : /row_to_json/.test(sql) ? '{"xact_commit": 1, "numbackends": 3}' : /json_agg/.test(sql) ? '[]' : ''],
		redis: async (cmd, ...rest) => (cmd === 'MGET' ? rest.map((key) => String(keys[key] ?? '')).join('\n') : cmd === 'GET' ? String(keys[rest[0]] ?? '') : cmd === 'STRLEN' ? '1234' : ''),
		redisScan: async (pattern) => (pattern.includes('/p:') ? ['d38b/knorke/k3x9a0b2/p:7'] : Object.keys(keys).filter((k) => k.includes(pattern.includes('/wo:') ? '/wo:' : '/w:'))),
		occ: async () => '{}',
	}
	const docker = []
	const cmd = async (bin, args) => { docker.push([bin, ...args].join(' ')); return { ok: true, out: '0', err: '' } }
	let busy = 0
	const status = async () => ({ busy: ++busy, idle: 1, W: 0, K: 0, R: 0, open: 0, slots: 1 })
	const c = new Collectors(env, stack, { cmd, status })
	const k = (kind, pid, win) => `d38b/knorke/k3x9a0b2/${kind}:7:${pid}:${win}`
	// window 1: the seeder s1 seeds up to window 100, editors e1/e2 work
	keys = { [k('w', 's1', 99)]: 10, [k('wo', 's1', 99)]: 2000, [k('w', 's1', 100)]: 2, [k('wo', 's1', 100)]: 320, [k('w', 'e1', 101)]: 4, [k('wo', 'e1', 101)]: 4, [k('w', 'e2', 101)]: 9, [k('wo', 'e2', 101)]: 9 }
	await c.before({ seed: { pid: 's1', win: 100 } })
	for (let i = 0; i < 3; i++) await c.sample(7, 'k3x9a0b2')
	await c.after()
	const a = c.summary(3, 30)
	assert.equal(a.apache.samples, 3)
	assert.equal(a.postgres.numbackends.n, 3)
	assert.equal(a.presenceBlobBytes.n, 1)
	assert.deepEqual(a.budget.maxPerPid, { syncs: 9, ops: 9 }, 'F3: the seeding windows of s1 are not in maxPerPid')
	assert.deepEqual(a.budget.seed, { syncs: 10, ops: 2000, keys: 4 })
	assert.deepEqual(Object.keys(a.budget.byPid).sort(), ['e1', 'e2'])
	// window 2 (the next S5 step: its own board keys, its own seeding)
	keys = { [k('w', 's2', 200)]: 2, [k('wo', 's2', 200)]: 320, [k('w', 'e3', 201)]: 5, [k('wo', 'e3', 201)]: 6 }
	await c.before({ seed: { pid: 's2', win: 200 } })
	for (let i = 0; i < 2; i++) await c.sample(7, 'k3x9a0b2')
	await c.after()
	const b = c.summary(2, 20)
	assert.equal(b.apache.samples, 2, 'Apache: only the second window (W3E-04: 29 → 51 → 61 before)')
	assert.equal(b.postgres.numbackends.n, 2, 'PG backends: only the second window')
	assert.equal(b.apache.busy.max, 5, 'the busy readings 4 and 5 of window 2, not the 3 of window 1')
	assert.equal(b.presenceBlobBytes.n, 1, 'blob: the second window samples again at its first tick')
	assert.deepEqual(Object.keys(b.budget.byPid), ['e3'], 'budget: only the keys of the second window')
	assert.deepEqual(b.budget.maxPerPid, { syncs: 5, ops: 6 })
	assert.deepEqual(b.budget.seed, { syncs: 2, ops: 320, keys: 2 })
	assert.ok(docker.length > 0 && docker.every((d) => /^docker (inspect -f \{\{\.Id\}\}|exec) knorke-dev-dzload-/.test(d)), `every docker call went to the injected runner, own names only: ${JSON.stringify(docker.slice(0, 3))}`)
})

test('F3: write-budget fixture with seeding and workload – the seeder\'s windows up to the last seed batch go to seed, its later windows and every other pid to maxPerPid', () => {
	const entries = fx('budget-keys.txt').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' '))
	const all = M.parseBudgetKeys(entries, 11)
	assert.deepEqual(all.maxPerPid, { syncs: 11, ops: 2200 }, 'without the seed windows the seeding is the maximum (W3E-05: SC {11, 2200})')
	const b = M.parseBudgetKeys(entries, 11, { seed: { pid: 'a71c1f2cf4e27670', win: 179043992 } })
	assert.deepEqual(b.maxPerPid, { syncs: 6, ops: 7 }, 'the workload maximum')
	assert.deepEqual(b.byPid, { a71c1f2cf4e27670: { syncs: 3, ops: 3 }, '0b00d1f3e3cccc3f': { syncs: 4, ops: 4 }, '355824a98fb47a0d': { syncs: 6, ops: 7 }, c63a4e9713fedcdb: { syncs: 5, ops: 5 } })
	assert.deepEqual(b.seed, { syncs: 11, ops: 2200, keys: 6 })
	assert.equal(b.keys, 8)
	const m = M.mergeBudget(b, M.parseBudgetKeys([['d38b/knorke/k3x9a0b2/w:11:a71c1f2cf4e27670:179043992', '3']], 11, { seed: { pid: 'a71c1f2cf4e27670', win: 179043992 } }))
	assert.deepEqual([m.maxPerPid, m.seed], [{ syncs: 6, ops: 7 }, { syncs: 11, ops: 2200, keys: 6 }], 'merged over samples, seed apart')
})

test('F4: the S5 gate at 45 counts the errors of S4 rule 2 – a step with bad, busy or an unexpected 4xx is red (W3E-06, AUD-01)', () => {
	const step = (editors, extra = {}) => ({ config: { editors }, checks: { ok: true }, totals: { requests: 9373, status5xx: 0, status4xx: 0, status429: 0, timeouts: 0, netErrors: 0 }, opCodes: { ok: 491, locked: 7 }, budget: { busy: 0 }, endpoints: { 'sync-empty': { p95: 95.8 } }, edge: { rejected: 0 }, ...extra })
	const g = (s45) => evaluateS5({ scenario: 'S5', steps: [step(30), s45] })
	assert.equal(g(step(45)).ok, true, 'clean step 45: green')
	const bad = g(step(45, { opCodes: { ok: 491, bad: 32, locked: 7 } }))
	assert.equal(bad.rules[0].ok, false, 'r1w3 step 45 (32 × bad) is red')
	assert.deepEqual([bad.rules[0].value.errors, bad.rules[0].value.errorsBy.unexpectedCodes], [32, 32])
	assert.equal(bad.ok, false)
	assert.equal(g(step(45, { budget: { busy: 1 } })).rules[0].ok, false, 'busy at 45 (§8.7: 0 × busy wie S4 Regel 2)')
	assert.equal(g(step(45, { totals: { ...step(45).totals, status4xx: 1 } })).rules[0].ok, false, 'an unexpected 4xx')
	assert.equal(g(step(45, { opCodes: { ok: 9, locked: 1, gone: 1, dup: 1, limit: 1, closed: 1 } })).rules[0].ok, true, 'locked/gone/dup/limit/closed are allowed')
	// the same through the T4-10 path (abort after the complete step 45)
	const ab = evaluate({ scenario: 'S5', aborted: { reason: 'Last' }, steps: [step(30), step(45, { opCodes: { ok: 491, bad: 32 } }), step(60, { aborted: { reason: 'Last' } })] })
	assert.deepEqual([ab.abortedAfter45, ab.ok], [true, false])
})

test('F5: S5 report and summary – one row per step and the T4-10 verdict (complete steps, knee, gate up to 45, P2)', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const host = (a, b) => ({ before: { uptime: `${a} up 106 days` }, after: { uptime: `${b} up 106 days` } })
	const step = (editors, extra = {}) => ({
		config: { editors }, checks: { ok: true }, totals: { requests: 9000, rps: editors * 3.5, status5xx: 0, status4xx: 0, status429: 0, timeouts: 0, netErrors: 0 }, opCodes: { ok: 400 }, budget: { busy: 0, maxPerPid: { syncs: 7, ops: 7 } },
		endpoints: { 'sync-empty': { p95: editors * 2 }, 'sync-ops': { p95: editors * 2.1 } }, edge: { rejected: 0 }, host: host(`02:2${editors / 15}:00`, `02:2${editors / 15}:59`),
		metrics: { ncPgCoresMean: editors / 10, apache: { busy: { max: editors / 2 } }, postgres: { numbackends: { max: editors / 3 } } }, ...extra,
	})
	const steps = [step(30), step(45, { opCodes: { ok: 491, bad: 32 } }), step(60, { aborted: { reason: '1-min-Last über 20' }, checks: undefined })]
	const rep = { scenario: 'S5', variant: 'base', seed: 9, title: 'S5', finishedAt: '2026-10-14T00:25:02Z', steps, knee: { editors: null, aboveEditors: 45, abortedByGuard: true, text: '> 45 (Abbruch durch Lastschutz)' }, completeSteps: [30, 45], config: { steps: [30, 45, 60, 75, 90], secs: 60 }, aborted: { reason: '1-min-Last über 20' }, host: { before: steps[0].host.before, after: steps[2].host.after } }
	rep.gate = evaluate(rep)
	writeRunReports(dir, rep, 'r9')
	const md = fs.readFileSync(path.join(dir, 's5-base-r9.md'), 'utf8')
	assert.match(md, /^- Wertung nach T4-10 \(§8\.7 „Weitere“\): vollständige Stufen 30, 45; Knie > 45 \(Abbruch durch Lastschutz\); Gate bei 45: \*\*rot\*\*; P2 „Knie ≥ 45“: \*\*nicht erfüllt\*\*$/m)
	assert.match(md, /^\| Stufe \(Bearbeiter\) \| vollständig \| Anfragen\/s \| Sync p95 ms \(Max der Klassen, Urteil\) \| Klasse des Max \| Sync p95 gepoolt \(nur Bericht\) \| Fehler wie S4 Regel 2 \|/m)
	assert.match(md, /^\| 30 \| ja \| 105,0 \| 63,0 \| sync-ops \| — \| 0 \| 0 \| 0 \| 0 \| ok \| 3,00 \| 15 \| 10 \| 7\/7 \|$/m)
	assert.match(md, /^\| 45 \| ja \| 157,5 \| 94,5 \| sync-ops \| — \| 32 \| 32 \| 0 \| 0 \| ok \| 4,50 \|/m)
	assert.match(md, /^\| 60 \| \*\*abgebrochen\*\* \(1-min-Last über 20\) \|/m)
	assert.match(md, /^- Uptime vorher: 02:22:00 up 106 days$/m)
	assert.match(md, /^- Stufen: 30 → 45 → 60 → 75 → 90 Bearbeiter je 60 s/m)
	writeSummary(dir, 'r9')
	const sum = fs.readFileSync(path.join(dir, 'summary-r9.md'), 'utf8')
	assert.match(sum, /^\| S5 \| base \| 9 \| r9 \| \*\*rot\*\* – vollständige Stufen 30, 45; Knie > 45 \(Abbruch durch Lastschutz\); Gate bei 45: \*\*rot\*\*; P2 „Knie ≥ 45“: \*\*nicht erfüllt\*\* \(Lastschutz: 1-min-Last über 20\) \|/m)
	assert.match(sum, /^\| S5 · 30 \| base \| 9 \| r9 \| Stufe vollständig; Fehler wie S4 Regel 2: 0; Sync p95 63,0 ms \(Max der Klassen: sync-ops; gepoolt — ms, nur Bericht\); K1–K3 ok; Board-Lock — Aufrufe \| 105,0 \| 0 \| 3,00 \| 02:22:00 up 106 days \| 02:22:59 up 106 days \| s5-base-r9\.json \|$/m)
	assert.match(sum, /^\| S5 · 45 \| .*Fehler wie S4 Regel 2: 32;/m)
	assert.match(sum, /^\| S5 · 60 \| .*Stufe abgebrochen \(1-min-Last über 20\)/m)
	const json = JSON.parse(fs.readFileSync(path.join(dir, 'summary-r9.json'), 'utf8'))
	const s5 = json.rows.find((r) => r.scenario === 'S5')
	assert.deepEqual(s5.steps.map((x) => [x.editors, x.complete, x.errors]), [[30, true, 0], [45, true, 32], [60, false, 0]])
	assert.equal(s5.s5.p2, false)
	// green step 45: P2 holds
	const green = { ...rep, steps: [step(30), step(45), steps[2]] }
	green.gate = evaluate(green)
	writeRunReports(dir, green, 'r9')
	assert.match(fs.readFileSync(path.join(dir, 's5-base-r9.md'), 'utf8'), /Gate bei 45: grün; P2 „Knie ≥ 45“: erfüllt$/m)
})

test('F5: a negative cgroup delta (counter reset by a restart) is a gap, never negative cores (W3E-10)', () => {
	assert.equal(M.coresBetween(5_000_000, 1_000, 1000), null, 'counter went down: gap')
	assert.equal(M.counterReset(5, 1), true)
	assert.equal(M.counterReset(1, 5), false)
	assert.equal(M.coresBetween(1_000_000, 2_000_000, 1000), 1, 'normal interval unchanged')
	const s = new CpuSampler({ redis: 'knorke-dev-dzload-redis' }, { cmd: async () => ({ ok: true, out: '', err: '' }) })
	s.dirs = { redis: '/x' }
	s.series = { redis: [] }
	s.mem = { redis: [] }
	s.gaps = { redis: 0 }
	const reads = [[0, 4_000_000], [1000, 4_500_000], [2000, 3_000], [3000, 503_000]]
	let i = 0
	s.read = () => { const [t, u] = reads[i++]; return { t, redis: u } }
	s.prev = s.read()
	for (let j = 0; j < 3; j++) s.sample()
	const c = s.summary().containers.redis
	assert.deepEqual([c.samples, c.gaps, c.coresMean], [2, 1, 0.5], 'two intervals of 0.5 cores, the restart interval left out')
})

test('F5: parseNcLog redacts auth= and password parameters before the cut (W3E-08)', () => {
	const pw = 'Zx9-SECRET-redis-pw'
	const lines = [
		{ level: 2, app: 'PHP', message: `session_start(): Failed to read session data: redis (path: tcp://knorke-dev-load-redis:6379?auth=${pw}) at /var/www/html/lib/private/Session/Internal.php#214` },
		{ level: 3, app: 'core', message: 'connect failed', exception: { Message: `redis://:${pw}@knorke-dev-load-redis:6379 password=${pw}&x=1` } },
		{ level: 2, app: 'PHP', message: 'x'.repeat(150) + `?auth=${pw}` },
	].map((j) => JSON.stringify(j)).join('\n')
	const r = M.parseNcLog(lines)
	const all = JSON.stringify(r)
	assert.equal(all.includes(pw), false, 'no part of the password in the summary')
	assert.equal(/Zx9|SECRET/.test(all), false, 'not even a cut piece of it')
	// G8 (p2d, W3B-10): auth= goes completely, key included – no "auth=" stays
	assert.match(all, /6379\?\[REDACTED\]\)/)
	assert.equal(/auth=/.test(all), false, 'no auth= left')
	assert.match(all, /redis:\/\/:<redacted>@knorke-dev-load-redis/)
	assert.match(all, /password=<redacted>&x=1/)
	assert.equal(M.redactSecrets('tcp://h:6379?auth=<redacted>'), 'tcp://h:6379?[REDACTED]', 'an old redaction auth=<redacted> goes as well')
	assert.equal(M.redactSecrets('tcp://h:6379?[REDACTED]'), 'tcp://h:6379?[REDACTED]', 'already redacted stays')
	assert.equal(M.redactSecrets('Redis connection not available'), 'Redis connection not available')
})

test('F6: SF rule 3, reading (a) – a 401 counts when its request was SENT after the end of the Redis restart window; 401s sent during it are reported apart', (t) => {
	const W = 1_000_000
	const offset = 30554
	const played = [{ id: 'redis-restart', atMs: 192008, endMs: 192301 }, { id: 'db-pause', atMs: 216000, endMs: 219068 }]
	// [answer tMs since t0, …, ms]: sent = tMs − ms − offset (window time); the r1w3 case: sent 192.06/192.29/192.08 s, the last answered at 193.17 s
	const ev = (sentW, ms, who) => ({ tMs: sentW + ms + offset, ms, key: 'sync-empty', who, phase: 'measure', body: '{"message":"Current user is not logged in"}' })
	const during = [ev(192062.4, 38.6, 'editor'), ev(192288.6, 34.4, 'editor'), ev(192078.5, 1090.5, 'editor')]
	const rows = during.map((e) => [e.tMs, e.key, e.who, '', 401, e.ms, 0, 'measure'])
	const ok = measureSF(played, rows, offset, new Map(), W, during)
	assert.deepEqual([ok.unauthorizedAfterRedis, ok.unauthorizedDuringRedis, ok.unauthorizedBeforeRedis], [0, 3, 0], 'all three sent during the restart (the third answered after it)')
	assert.deepEqual(ok.unauthorized.map((u) => [u.when, u.sentMs, u.recvMs]), [['während', 192062.4, 192101], ['während', 192288.6, 192323], ['während', 192078.5, 193169]])
	assert.match(ok.unauthorized[0].body, /Current user is not logged in/)
	const sf = (faults) => evaluateSF({ scenario: 'SF', checks: { k1: { ok: true }, k2: { ok: true }, k3: { ok: true } }, faults: { ...faults, played: played.map((p) => ({ ...p, recoveryS: 1 })) } })
	assert.equal(sf(ok).rules[2].ok, true, '401 only during the restart: rule 3 green …')
	assert.equal(sf(ok).rules[2].value.unauthorizedDuringRedis, 3, '… and reported')
	const after = [...during, ev(192301.5, 20, 'tablet')]
	const red = measureSF(played, after.map((e) => [e.tMs, e.key, e.who, '', 401, e.ms, 0, 'measure']), offset, new Map(), W, after)
	assert.deepEqual([red.unauthorizedAfterRedis, red.unauthorizedDuringRedis], [1, 3], 'sent 0.5 ms after the end of the window: counts')
	assert.equal(sf(red).rules[2].ok, false, 'a 401 after the restart: rule 3 red')
	// without the event list (old reports): the 401 rows of the samples, same split
	assert.deepEqual([measureSF(played, rows, offset, new Map(), W).unauthorizedDuringRedis, measureSF(played, rows, offset, new Map(), W).unauthorized[0].body], [3, null])
	// the report names count, times and short body
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, { scenario: 'SF', variant: 'base', seed: 3, faults: { ...ok, played: played.map((p) => ({ ...p, title: p.id, recoveryS: 1, devices: 9 })) }, gate: sf(ok) }, '')
	const md = fs.readFileSync(path.join(dir, 'sf-base.md'), 'utf8')
	assert.match(md, /401 nach dem Redis-Neustart 0 \(gesendet nach dem Ende des Neustart-Fensters, zählt\); 401 auf Anfragen, die während des Neustarts gesendet wurden: 3 \(zählen nicht\) \(Neustart-Fenster 192,008–192,301 s\)/)
	assert.match(md, /^ {2}- 401 während: gesendet 192,062 s, Antwort 192,101 s, sync-empty · editor – \{"message":"Current user is not logged in"\}$/m)
})

test('P2B-02: redactSecrets – every form of a secret in a log text (invented values only)', () => {
	const r = M.redactSecrets
	const cases = [
		['tcp://h:6379?auth[]=user1&auth[]=s3cr3t&x=1', '?[REDACTED]&[REDACTED]&x=1', 'phpredis auth[]=user&auth[]=pw (G8: key and value)'],
		['connect dbpassword=s3cr3t failed', 'dbpassword=<redacted>', 'prefix dbpassword='],
		['redis_password=s3cr3t;', 'redis_password=<redacted>;', 'prefix redis_password='],
		['auth_token=s3cr3t', 'auth_token=<redacted>', 'suffix auth_token='],
		['requesttoken=s3cr3t&a=1', 'requesttoken=<redacted>&a=1', 'requesttoken='],
		['{"password":"s3cr3t","u":"x"}', '{"password":"<redacted>","u":"x"}', 'JSON'],
		['[\'password\' => \'s3cr3t\']', '[\'password\' => \'<redacted>\']', 'PHP array'],
		['Authorization: Bearer s3cr3t.abc', 'Authorization: Bearer <redacted>', 'Bearer'],
		['Authorization: Basic czNjcjN0', 'Authorization: Basic <redacted>', 'Basic'],
		['db error, password: s3cr3t at line 3', 'password: <redacted> at line 3', 'password: …'],
		['tcp://h:6379?auth=s3cr3t', 'tcp://h:6379?[REDACTED]', 'auth= stays covered (G8: completely)'],
		['redis_auth=s3cr3t;x', '[REDACTED];x', 'G8: a prefixed …auth= as well'],
	]
	for (const [input, want, name] of cases) {
		const out = r(input)
		assert.equal(out.includes('s3cr3t') || out.includes('czNjcjN0'), false, `${name}: secret gone: ${out}`)
		assert.ok(out.includes(want), `${name}: ${out}`)
		assert.equal(r(out), out, `${name}: idempotent`)
		assert.equal(/auth(\[\])?=/i.test(out), false, `${name}: no auth= left (G8): ${out}`)
	}
	assert.equal(r('Redis connection not available'), 'Redis connection not available')
})

test('P2B-03: writeRunReports redacts nextcloudLog.top[].m in JSON and md (also when re-rendering an old JSON)', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const mk = () => ({ scenario: 'S4', variant: 'base', seed: 1, metrics: { nextcloudLog: { top: [{ n: 3, m: 'L2 PHP: x dbpassword=s3cr3t y' }] } }, gate: { ok: null, rules: [] } })
	writeRunReports(dir, mk(), '')
	const j = fs.readFileSync(path.join(dir, 's4-base.json'), 'utf8')
	const md = fs.readFileSync(path.join(dir, 's4-base.md'), 'utf8')
	assert.equal(j.includes('s3cr3t') || md.includes('s3cr3t'), false)
	assert.match(j, /dbpassword=<redacted>/)
	// re-render of an old JSON that still holds the secret
	const old = JSON.parse(fs.readFileSync(path.join(dir, 's4-base.json'), 'utf8'))
	old.metrics.nextcloudLog.top[0].m = 'old redis_password=s3cr3t'
	writeRunReports(dir, old, '')
	assert.equal(fs.readFileSync(path.join(dir, 's4-base.json'), 'utf8').includes('s3cr3t'), false)
	assert.equal(fs.readFileSync(path.join(dir, 's4-base.md'), 'utf8').includes('s3cr3t'), false)
})

test('P2B-04: the budget line says "ohne das Säen" only with budget.seed.counters, else "inkl. Säen (nicht getrennt)"', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const mk = (seed) => ({ scenario: 'S4', variant: 'base', seed: 1, budget: { maxPerPid: { syncs: 5, ops: 50 }, busy: 0, ...(seed ? { seed } : {}) }, gate: { ok: null, rules: [] } })
	const line = () => fs.readFileSync(path.join(dir, 's4-base.md'), 'utf8').split('\n').find((l) => l.includes('Schreibbudget'))
	writeRunReports(dir, mk({ syncs: 2, ops: 9, busy: 0, batches: 1, counters: { syncs: 1, ops: 3 } }), '')
	assert.match(line(), /, ohne das Säen; busy/)
	writeRunReports(dir, mk({ syncs: 2, ops: 9, busy: 0, batches: 1 }), '')
	assert.match(line(), /inkl\. Säen \(nicht getrennt\); busy/)
	assert.doesNotMatch(line(), /ohne das Säen/)
	writeRunReports(dir, mk(null), '')
	assert.match(line(), /inkl\. Säen \(nicht getrennt\)/)
})

test('P2B-06: SF rule 3 – sent exactly at endMs counts as "während"; Run.record collects 401s and FaultInjector.report hands them over', async () => {
	const played = [{ id: 'redis-restart', atMs: 1000, endMs: 1300 }]
	const offset = 30000
	const ev = (sentW, ms) => ({ tMs: sentW + ms + offset, ms, key: 'sync-empty', who: 'editor', phase: 'measure', body: '{"message":"x"}' })
	const exact = measureSF(played, [], offset, new Map(), 0, [ev(1300, 50)])
	assert.deepEqual([exact.unauthorizedAfterRedis, exact.unauthorizedDuringRedis], [0, 1], 'sent at endMs exactly: during, not after')
	const next = measureSF(played, [], offset, new Map(), 0, [ev(1300.5, 50)])
	assert.deepEqual([next.unauthorizedAfterRedis, next.unauthorizedDuringRedis], [1, 0], 'sent 0.5 ms later: after')

	const { Run } = await import('../load/lib/generator.mjs')
	const { FaultInjector } = await import('../load/lib/faults.mjs')
	const mkRun = () => new Run({ env: {}, scenarioId: 'SF', sc: SCENARIOS.SF, seed: 1, secs: 10, warmupS: 0, counts: {}, boardSize: {} })
	const faults = new FaultInjector({ ns: 'dzload', containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' } }, {}, { docker: async () => ({ ok: true, out: '', err: '' }), sleep: async () => {} })
	faults.played = played.map((p) => ({ ...p }))
	const round = (sentW) => {
		const run = mkRun()
		run.windowStart = run.t0 + offset
		run.phase = 'measure'
		// the answer comes 50 ms after sending: the record is made "now", so shift t0
		run.t0 = Date.now() - (offset + sentW + 50)
		run.windowStart = run.t0 + offset
		run.record('sync-empty', 'editor', { status: 401, ms: 50, text: '{"message":"Current user is not logged in"}' })
		run.record('sync-empty', 'editor', { status: 200, ms: 5, text: '{}' })
		assert.equal(run.unauthorized.length, 1, 'only the 401 is collected')
		assert.equal(run.unauthorized[0].key, 'sync-empty')
		assert.match(run.unauthorized[0].body, /not logged in/)
		const f = faults.report(run)
		const sf = evaluateSF({ scenario: 'SF', checks: { k1: { ok: true }, k2: { ok: true }, k3: { ok: true } }, faults: { ...f, played: played.map((p) => ({ ...p, recoveryS: 1 })) } })
		return [f, sf.rules[2]]
	}
	const [fa, ra] = round(1600)
	assert.deepEqual([fa.unauthorizedAfterRedis, fa.unauthorizedDuringRedis], [1, 0])
	assert.equal(ra.ok, false, 'a 401 after the window: rule 3 red')
	const [fd, rd] = round(1100)
	assert.deepEqual([fd.unauthorizedAfterRedis, fd.unauthorizedDuringRedis], [0, 1])
	assert.equal(rd.ok, true, 'a 401 in the window: rule 3 green …')
	assert.equal(rd.value.unauthorizedDuringRedis, 1, '… and reported as "während"')
	assert.equal(fd.unauthorized[0].when, 'während')
})

// --- fix round p2d, stage 4 phase 2 (W3 r2w3: W3B-02..10, G1–G8) ---------------------------

test('G1 (p2d, W3B-02): every run names the pooled sync p95 and the class of the maximum; the S5 gate keeps the maximum of the class p95', async (t) => {
	const { Run, classMax } = await import('../load/lib/generator.mjs')
	const run = new Run({ env: {}, scenarioId: 'S5', sc: SCENARIOS.S5, seed: 1, secs: 60, warmupS: 0, counts: {}, boardSize: {} })
	run.windowStart = run.t0
	run.windowEnd = run.t0 + 60000
	// 100 × sync-empty 40 ms, sync-ops 9 × 60 ms and 1 × 120 ms: class p95 sync-ops 120, pooled p95 60
	for (let i = 0; i < 100; i++) run.samples.push([i * 10, 'sync-empty', 'editor', '', 200, 40, 100, 'measure'])
	for (let i = 0; i < 9; i++) run.samples.push([i * 10, 'sync-ops', 'editor', '', 200, 60, 100, 'measure'])
	run.samples.push([5000, 'sync-ops', 'editor', '', 200, 120, 100, 'measure'])
	run.samples.push([5000, 'sync-ops', 'editor', '', 200, 900, 100, 'setup'])
	const rep = run.report()
	assert.deepEqual(rep.latency.syncMax, { p95: 120, class: 'sync-ops' }, 'the class of the maximum')
	assert.equal(rep.latency.syncPooled.p95, 60, 'all sync classes pooled (window samples only)')
	assert.equal(rep.latency.syncPooled.n, 110)
	assert.deepEqual(classMax([]), { p95: null, class: null })
	// S5 at 45: the verdict is the maximum of the classes (red at 120 > 100) although the pooled p95 is 60
	const base = (editors, extra = {}) => ({ config: { editors }, checks: { ok: true }, totals: { requests: 110, rps: 1.8, status5xx: 0, status4xx: 0, status429: 0, timeouts: 0, netErrors: 0 }, opCodes: { ok: 1 }, budget: { busy: 0 }, edge: { rejected: 0 }, ...extra })
	const step30 = base(30, { endpoints: { 'sync-empty': { p95: 50 } }, latency: { syncPooled: { p95: 50 } } })
	const step45 = base(45, { endpoints: rep.endpoints, latency: rep.latency })
	const g = evaluateS5({ scenario: 'S5', steps: [step30, step45] })
	assert.equal(g.rules[0].ok, false, 'sync-ops p95 120 > 100: red – no switch to the pooled reading (user decision 14.10.)')
	assert.deepEqual([g.rules[0].value.syncP95, g.rules[0].value.syncP95Class, g.rules[0].value.syncP95Pooled], [120, 'sync-ops', 60])
	assert.match(g.rules[0].threshold, /Maximum der Klassen-p95; gepoolter p95 nur Bericht/)
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const s5 = { scenario: 'S5', variant: 'base', seed: 2, title: 'S5', steps: [step30, step45], knee: null, completeSteps: [30, 45], config: { steps: [30, 45], secs: 60 } }
	s5.gate = evaluate(s5)
	writeRunReports(dir, s5, 'g1')
	const md = fs.readFileSync(path.join(dir, 's5-base-g1.md'), 'utf8')
	assert.match(md, /^\| 45 \| ja \| 1,8 \| 120,0 \| sync-ops \| 60,0 \| 0 \|/m, 'S5 row: max of the classes, its class, the pooled p95')
	writeSummary(dir, 'g1')
	assert.match(fs.readFileSync(path.join(dir, 'summary-g1.md'), 'utf8'), /^\| S5 · 45 \| .*Sync p95 120,0 ms \(Max der Klassen: sync-ops; gepoolt 60,0 ms, nur Bericht\)/m)
})

test('G2/G3 (p2d, W3B-05/W3B-03): measureSF – per device and session the first 401 counts (sent after the window: counts, in it: apart); a device that never recovers is red; re-logged devices apart', (t) => {
	const W = 1_000_000
	const offset = 30000
	const played = [{ id: 'redis-restart', title: 'Redis-Neustart (einmal)', atMs: 192000, endMs: 192300, note: 'neu gestartet' }, { id: 'db-pause', title: 'DB 3 s pausieren (docker pause)', atMs: 216000, endMs: 219000, note: 'pausiert' }]
	const ok = new Map([
		['editor-01', [W + 191000, W + 192500, W + 216500, W + 219500]],
		['moderator', [W + 191500, W + 194000, W + 219200]],
		['editor-02', [W + 191800, W + 195000, W + 219400]],
		['editor-03', [W + 191000, W + 193000, W + 215000]],
	])
	// tMs = answer since t0 (sent = tMs − ms − offset in window time)
	const lo = (sentW, ms, who, device) => ({ tMs: sentW + ms + offset, ms, key: 'sync-empty', who, device, sess: 1, body: '{"message":"Current user is not logged in"}' })
	const logouts = [lo(192100, 30, 'moderator', 'moderator'), lo(192400, 20, 'editor', 'editor-02')]
	// every 401 answer: the two above plus a follow-up of the moderator's dead session after the window (old harness) – not counted per device
	const unauthorized = [...logouts, lo(193000, 30, 'moderator', 'moderator')]
	const r = measureSF(played, [], offset, ok, W, unauthorized, { logouts })
	assert.deepEqual([r.unauthorizedDuringRedis, r.unauthorizedAfterRedis, r.unauthorizedTotal], [1, 1, 3], 'moderator during (apart), editor-02 after (counts); the follow-up does not count')
	assert.match(r.countedBy, /je Gerät und Sitzung das erste 401/)
	assert.deepEqual(r.loggedOut, [{ sentMs: 192100, device: 'moderator', role: 'moderator', sess: 1, status: 401, relogin: false, counted: true, when: 'während' }, { sentMs: 192400, device: 'editor-02', role: 'editor', sess: 1, status: 401, relogin: false, counted: true, when: 'nach' }], 'logged-out devices: time, device, role')
	const [redis, pause] = r.played
	assert.deepEqual([redis.recoveryS, redis.devices, redis.notRecovered, redis.relogged], [0.7, 2, 0, 2], 'editor-01 0.2 s, editor-03 0.7 s; moderator and editor-02 apart')
	assert.deepEqual(redis.reloggedDevices, [{ device: 'moderator', recoveryS: 1.7 }, { device: 'editor-02', recoveryS: 2.7 }], 're-logged: until the first successful sync after the new login')
	assert.deepEqual([pause.recoveryS, pause.devices, pause.notRecovered, pause.notRecoveredDevices], [0.5, 3, 1, ['editor-03']], 'editor-03 has no successful sync after the pause: not recovered (never skipped)')
	const sf = (faults) => evaluateSF({ scenario: 'SF', checks: { k1: { ok: true }, k2: { ok: true }, k3: { ok: true } }, faults })
	const g = sf(r)
	assert.equal(g.rules[1].ok, false, 'rule 2 red: a device never recovered (W3B-03: 129 of 130 was green before)')
	assert.equal(g.rules[2].ok, false, 'rule 3 red: editor-02\'s first 401 was sent after the restart window')
	// the same devices, editor-03 recovers and nobody is logged out after the window: both rules green
	ok.set('editor-03', [W + 191000, W + 193000, W + 215000, W + 220000])
	const green = measureSF(played, [], offset, ok, W, logouts.slice(0, 1), { logouts: logouts.slice(0, 1) })
	assert.equal(sf(green).rules[1].ok, true, 'every device recovered ≤ 35 s; the re-logged moderator is reported, not judged by the 35 s')
	assert.deepEqual([green.unauthorizedDuringRedis, green.unauthorizedAfterRedis, sf(green).rules[2].ok], [1, 0, true], 'only the moderator, in the window: green and reported')
	// a 401 without a device (moderation call, setup) counts on its own
	const mod = measureSF(played, [], offset, ok, W, [...logouts.slice(0, 1), { tMs: 200000 + offset, ms: 10, key: 'moderate', who: 'moderator', device: null }], { logouts: logouts.slice(0, 1) })
	assert.equal(mod.unauthorizedAfterRedis, 1, 'a device-less 401 after the window counts')
	// the report: logged-out devices, never recovered, re-logged apart
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, { scenario: 'SF', variant: 'base', seed: 3, faults: r, gate: g }, '')
	const md = fs.readFileSync(path.join(dir, 'sf-base.md'), 'utf8')
	assert.match(md, /^- SF abgemeldete Geräte \(Zeit, Gerät, Rolle\): 192,100 s moderator \(moderator, während\); 192,400 s editor-02 \(editor, nach\)$/m)
	assert.match(md, /DB 3 s pausieren \(docker pause\): Erholung 0\.5 s \(3 Geräte\), pausiert; \*\*nicht erholt: 1\*\* \(editor-03\)/)
	assert.match(md, /Redis-Neustart \(einmal\): Erholung 0\.7 s \(2 Geräte\), neu gestartet; neu angemeldet \(getrennt, .*\): moderator 1,7 s, editor-02 2,7 s/)
	assert.match(md, /gezählt: je Gerät und Sitzung das erste 401/)
})

test('G5 (p2d, W3B-06): the CPU mean is time-weighted, a reading with an interval ≈ 0 is dropped, intervals above the cap are named', () => {
	assert.equal(cpusetCount('0-3,8,10-11'), 7)
	assert.equal(cpusetCount(''), 0)
	const files = { '/c/cpu.max': '1200000 100000\n', '/c/cpuset.cpus.effective': '0-15\n', '/d/cpu.max': 'max 100000\n', '/d/cpuset.cpus.effective': '0-3\n' }
	const read = (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p] }
	assert.equal(cgroupCap('/c', read, 32), 12, 'cpu.max quota/period')
	assert.equal(cgroupCap('/d', read, 32), 4, 'no quota: the cpuset')
	assert.equal(cgroupCap('/x', read, 32), 32, 'nothing readable: the host')
	const s = new CpuSampler({ nc: 'knorke-dev-dzload-nc' }, { cmd: async () => ({ ok: true, out: '', err: '' }), readFile: read, hostCpus: 32 })
	s.dirs = { nc: '/c' }
	s.caps = { nc: cgroupCap('/c', read, 32) }
	s.series = { nc: [] }
	s.mem = { nc: [] }
	s.gaps = { nc: 0 }
	// t (ms), usage_usec: the first reading 3 ms after the start is dropped; 2 cores, 14.8 cores (> cap 12), 1 core over 3 s
	const reads = [[0, 0], [3, 50_000], [1000, 2_000_000], [2000, 16_800_000], [5000, 19_800_000]]
	let i = 0
	s.read = () => { const [tt, u] = reads[i++]; return { t: tt, nc: u } }
	s.prev = s.read()
	for (let j = 0; j < 4; j++) s.sample()
	const c = s.summary().containers.nc
	assert.equal(s.summary().droppedReadings, 1, 'the 3-ms reading')
	assert.equal(c.samples, 3)
	assert.equal(c.coresMean, 3.96, 'Δusage / Δtime = 19.8 s CPU / 5 s (the unweighted mean of the intervals would be 5.933)')
	assert.equal(c.cap, 12)
	assert.deepEqual([c.overCap.n, c.overCap.max, c.overCap.samples], [1, 14.8, [{ cores: 14.8, dtMs: 1000 }]], 'the interval above the cap is named')
	assert.equal(c.coresMax, 14.8, 'kept in the series (reported, not hidden)')
})

test('G6 (p2d, W3B-07): the budget is read on its own 5-s clock however slow a 1-s sample is; an expired key is "nicht vorhanden", never 0', async () => {
	const k = (kind, pid, win) => `d38b/knorke/k3x9a0b2/${kind}:7:${pid}:${win}`
	const b = M.parseBudgetKeys([[k('w', 'p1', 100), '5'], [k('wo', 'p1', 100), ''], [k('w', 'p2', 100), '(nil)'], [k('wo', 'p2', 100), null]], 7)
	assert.deepEqual(Object.keys(b.byPid), ['p1'], 'p2 had only expired keys: not a pid with 0')
	assert.equal(b.missing, 3)
	assert.deepEqual(b.maxPerPid, { syncs: 5, ops: 0 })
	assert.equal(M.mergeBudget(b, b).missing, 6)
	const env = { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' }, load: { statusUrl: 'http://fake/server-status?auto' } }
	let gets = 0
	const stack = {
		psql: async () => [''],
		redis: async (cmd, ...keys) => { if (cmd === 'MGET') { gets++; return keys.map(() => '4').join('\n') } return '' },
		redisScan: async (pattern) => (pattern.includes('/w:') ? [k('w', 'e1', 101)] : pattern.includes('/wo:') ? [k('wo', 'e1', 101)] : []),
		occ: async () => '{}',
	}
	// a slow 1-s sample (Apache answers after 450 ms), like under load
	const status = () => new Promise((resolve) => setTimeout(() => resolve({ busy: 1, idle: 1, W: 0, K: 0, R: 0, open: 0, slots: 1 }), 450))
	const c = new Collectors(env, stack, { cmd: async () => ({ ok: true, out: '0', err: '' }), status, budgetEveryMs: 100, budgetMinGapMs: 20 })
	await c.before({})
	c.startBudget(7, () => 'k3x9a0b2')
	const t0 = Date.now()
	let samples = 0
	while (Date.now() - t0 < 1200) { await c.sample(7, 'k3x9a0b2'); samples++ }
	await c.after()
	const sm = c.summary(1.2, 10).budget.sampling
	assert.ok(samples <= 3, `the 1-s samples were slow (${samples})`)
	assert.ok(sm.reads >= 9, `the budget kept its own clock: ${sm.reads} reads in 1.2 s at 100 ms`)
	assert.ok(sm.maxGapMs < 300, `no gap stretched by a slow sample (max ${sm.maxGapMs} ms)`)
	assert.equal(sm.clock, 'eigener Takt')
	const n = gets
	await new Promise((r) => setTimeout(r, 250))
	assert.equal(gets, n, 'after() stopped the clock')
})

test('G7 (p2d, W3B-08): the board lock says "0 Aufrufe" when measured without a call (not null/empty); S5 one line per step; SC as well', (t) => {
	const zero = M.boardLockReport([], null)
	assert.deepEqual([zero.measured, zero.lock, zero.finding], [true, { calls: 0, meanMs: null, maxMs: null }, null])
	assert.deepEqual([M.boardLockReport(null, null).measured, M.boardLockReport(null, null).lock], [false, null], 'not measured stays null')
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, { scenario: 'SC', variant: 'base', seed: 2, boardLock: zero, gate: { ok: null, rules: [] } }, '')
	assert.match(fs.readFileSync(path.join(dir, 'sc-base.md'), 'utf8'), /^- Board-Lock \(nur Bericht, §8\.7 R19\): lockBoard 0 Aufrufe; Stimm-Sync: keine Anfragen$/m)
	// an old report (r2w3: measured, lock null) renders the same
	writeRunReports(dir, { scenario: 'SC', variant: 'base', seed: 2, boardLock: { measured: true, lock: null, votes: [], voteSync: null, thresholds: M.BOARD_LOCK, finding: null }, gate: { ok: null, rules: [] } }, '')
	assert.match(fs.readFileSync(path.join(dir, 'sc-base.md'), 'utf8'), /lockBoard 0 Aufrufe/)
	const busy = M.boardLockReport([{ calls: 243, mean_ms: 0.222, max_ms: 6.693, query: 'UPDATE oc_knorke_boards SET acl_gen = acl_gen + $1' }], { n: 240, p95: 56.9, max: 67.9 })
	const step = (editors, boardLock) => ({ config: { editors }, checks: { ok: true }, totals: { requests: 10, rps: 1, status5xx: 0, status4xx: 0, status429: 0, timeouts: 0, netErrors: 0 }, opCodes: {}, budget: { busy: 0 }, endpoints: { 'sync-empty': { p95: 40 } }, edge: { rejected: 0 }, boardLock })
	const s5 = { scenario: 'S5', variant: 'base', seed: 3, title: 'S5', steps: [step(30, zero), step(45, busy), step(60, null)], knee: null, completeSteps: [30, 45, 60], config: { steps: [30, 45, 60], secs: 60 } }
	s5.gate = evaluate(s5)
	writeRunReports(dir, s5, '')
	const md = fs.readFileSync(path.join(dir, 's5-base.md'), 'utf8')
	assert.match(md, /^- Board-Lock je Stufe \(nur Bericht, §8\.7 R19\):$/m)
	assert.match(md, /^ {2}- Stufe 30: lockBoard 0 Aufrufe; Stimm-Sync: keine Anfragen$/m)
	assert.match(md, /^ {2}- Stufe 45: lockBoard 243 Aufrufe, Mittel 0,222 ms, max 6,693 ms; Stimm-Sync p95 56,9 ms, max 67,9 ms$/m)
	assert.match(md, /^ {2}- Stufe 60: nicht gemessen$/m)
	writeSummary(dir, '')
	assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /^\| S5 · 30 \| .*Board-Lock 0 Aufrufe/m)
})

test('G8 (p2d, W3B-10): no "auth=" stays in a written report – key and value become [REDACTED], wherever the text came from', (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	const pw = 'Zx9-SECRET-pw'
	const rep = {
		scenario: 'SF', variant: 'base', seed: 1, error: `connect tcp://knorke-dev-load-redis:6379?auth=${pw} failed`,
		metrics: { nextcloudLog: { top: [{ n: 28, m: 'L2 PHP: session_start(): Failed to read session data: redis (path: tcp://knorke-dev-load-redis:6379?auth=<redacted>) at x' }] } },
		protocolErrors: [{ actor: 'moderator', problem: 'HTTP 500', body: `{"message":"tcp://r:6379?auth[]=default&auth[]=${pw}"}` }],
		faults: { played: [], unauthorized: [{ when: 'nach', sentMs: 1, recvMs: 2, key: 'sync-empty', who: 'editor', body: `x redis_auth=${pw}` }] },
		gate: { ok: false, rules: [] },
	}
	writeRunReports(dir, rep, 'g8')
	writeSummary(dir, 'g8')
	for (const f of fs.readdirSync(dir)) {
		const text = fs.readFileSync(path.join(dir, f), 'utf8')
		assert.equal((text.match(/auth=/g) || []).length, 0, `${f}: grep -c 'auth=' = 0`)
		assert.equal(/auth\[\]=/.test(text) || text.includes(pw) || /Zx9|SECRET/.test(text), false, `${f}: no secret, no part of it`)
		if (f.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(text), `${f}: still valid JSON`)
	}
	assert.match(fs.readFileSync(path.join(dir, 'sf-base-g8.json'), 'utf8'), /6379\?\[REDACTED\]\) at x/)
})

test('G3 (p2d, W3B-03): SF keeps a device\'s successful syncs after the window too (quiet, check) – a late recovery is seen, not "nicht erholt"', async () => {
	const { Run } = await import('../load/lib/generator.mjs')
	const mk = (id) => new Run({ env: {}, scenarioId: id, sc: SCENARIOS[id], seed: 1, secs: 10, warmupS: 0, counts: {}, boardSize: {} })
	const run = mk('SF')
	const a = { label: 'editor-01' }
	run.windowStart = Date.now() - 5000
	run.noteOk(a, run.windowStart - 1)
	for (const phase of ['measure', 'after', 'quiet', 'check']) { run.phase = phase; run.noteOk(a, Date.now()) }
	assert.equal(run.okLog.get('editor-01').length, 4, 'window, after, quiet and check kept; before the window not')
	const s4 = mk('S4')
	s4.windowStart = Date.now() - 5000
	s4.phase = 'measure'
	s4.noteOk(a, Date.now())
	assert.equal(s4.okLog.size, 0, 'only SF keeps the log')
})

// --- mini-fix p2e (independent review of p2d, findings 1–5) ---------------------------------

const p2eSleep = (ms) => new Promise((r) => setTimeout(r, ms))
const p2eKey = (kind, pid, win) => `d38b/knorke/k3x9a0b2/${kind}:7:${pid}:${win}`
/** A fake stack for the budget: nKeys per kind, MGET takes mgetMs; values grow with every MGET, the first key is nil. */
const p2eStack = (nKeys, mgetMs, calls) => ({
	psql: async () => [''],
	redisScan: async (pattern) => {
		const kind = pattern.includes('/wo:') ? 'wo' : pattern.includes('/w:') ? 'w' : null
		if (kind) calls.push(['SCAN', Date.now()])
		return kind ? Array.from({ length: nKeys }, (_, i) => p2eKey(kind, `p${i}`, 101)) : []
	},
	redis: async (cmd, ...keys) => {
		calls.push([cmd, Date.now()])
		if (cmd !== 'MGET') return ''
		await p2eSleep(mgetMs)
		calls.mgets = (calls.mgets || 0) + 1
		return keys.map((_, i) => (i === 0 ? '' : String(calls.mgets))).join('\n')
	},
	occ: async () => '{}',
})
const p2eEnv = { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' }, load: { statusUrl: 'http://fake/server-status?auto' } }
const p2eOpts = (o) => ({ cmd: async () => ({ ok: true, out: '0', err: '' }), status: async () => null, ...o })

test('p2e-1 (review finding 1): a budget read is SCAN + one MGET per kind whatever the key count; a nil is "nicht vorhanden"', async (t) => {
	for (const nKeys of [10, 240]) {
		const calls = []
		const c = new Collectors(p2eEnv, p2eStack(nKeys, 0, calls), p2eOpts({ budgetEveryMs: 100, budgetMinGapMs: 50 }))
		t.after(() => c.stopBudget())
		await c.before({})
		c.startBudget(7, () => 'k3x9a0b2')
		await p2eSleep(330)
		await c.after()
		const sm = c.summary(1, 10).budget.sampling
		const n = (cmd) => calls.filter((x) => x[0] === cmd).length
		assert.ok(sm.reads >= 3, `${nKeys} keys: ${sm.reads} reads`)
		assert.deepEqual([n('GET'), n('MGET'), n('SCAN')], [0, 2 * sm.reads + 2 * sm.droppedAfterEnd, 2 * sm.reads + 2 * sm.droppedAfterEnd], `${nKeys} keys: 4 docker exec per read, no GET per key`)
		assert.equal(c.budget.missing, 2 * sm.reads, 'the nil of every MGET is "nicht vorhanden"')
		assert.equal(Object.keys(c.budget.byPid).length, nKeys - 1, 'p0 had only nil values: no pid with 0')
	}
})

test('p2e-1 (review finding 1): a slow read never makes the 5-s clock spin (at least budgetMinGapMs between reads); a read that ends after the window end is dropped', async (t) => {
	const calls = []
	const c = new Collectors(p2eEnv, p2eStack(50, 250, calls), p2eOpts({ budgetEveryMs: 100, budgetMinGapMs: 150 }))
	// a failing assertion must not leave the clock running (the process would never end)
	t.after(() => c.stopBudget())
	await c.before({})
	c.startBudget(7, () => 'k3x9a0b2')
	// two reads of ≈ 500 ms (2 × MGET 250 ms), each longer than the 100-ms clock
	// bounded waits: a broken clock fails here instead of hanging
	const until = async (cond, what) => { const d = Date.now() + 5000; while (!cond()) { assert.ok(Date.now() < d, `timeout: ${what}`); await p2eSleep(10) } }
	await until(() => c.budgetTimes.length >= 2, 'two reads')
	const keep = JSON.stringify(c.budget.maxPerPid)
	// the third read starts after the least gap – end the window while it runs
	const n0 = calls.filter((x) => x[0] === 'MGET').length
	await until(() => calls.filter((x) => x[0] === 'MGET').length > n0, 'the third read starts')
	c.endBudget(Date.now())
	await c.after()
	const sm = c.summary(1, 10).budget.sampling
	const gaps = c.budgetTimes.slice(1).map((t, i) => t - (c.budgetTimes[i] + c.budgetReadMs[i]))
	assert.ok(gaps.every((g) => g >= 140), `between two reads at least the least gap, never back to back: ${JSON.stringify(gaps)} (reads ${JSON.stringify(c.budgetReadMs)})`)
	assert.ok(sm.readMsMax >= 450, `the reads were slow (${sm.readMsMax} ms)`)
	assert.equal(sm.droppedAfterEnd, 1, 'the read that ended after the window end is dropped')
	assert.equal(JSON.stringify(c.budget.maxPerPid), keep, 'no counter from after the window end flowed in')
	const n = calls.filter((x) => x[0] === 'MGET').length
	await p2eSleep(400)
	assert.equal(calls.filter((x) => x[0] === 'MGET').length, n, 'the clock stopped')
})

test('p2e-2 (review finding 2): without a fault injection every logout is a protocol error (any phase); in SF it is not', async () => {
	const { Run } = await import('../load/lib/generator.mjs')
	const mk = (id) => new Run({ env: {}, scenarioId: id, sc: SCENARIOS[id], seed: 1, secs: 10, warmupS: 0, counts: {}, boardSize: {} })
	const actor = { label: 'editor-02', who: 'editor', sess: 1 }
	for (const [id, phase, n] of [['S4', 'quiet', 1], ['S4', 'check', 1], ['S5', 'measure', 1], ['S4d', 'quiet', 1], ['SF', 'quiet', 0]]) {
		const run = mk(id)
		run.phase = phase
		run.loggedOut(actor, { key: 'sync-empty', r: { status: 401, ms: 3, text: '' } })
		assert.equal(run.protocolErrors.length, n, `${id} ${phase}`)
		if (n) assert.match(run.protocolErrors[0].problem, /abgemeldet \(HTTP 401\) ohne Fehlereinspielung/)
		assert.equal(run.logouts.length, 1, 'still in the session report')
	}
})

test('p2e-3/4 (review findings 3, 4): SF rule 3 counts only 401 – a logout after a second 412 apart; per device and series once (a session end and the 401 of its re-login attempt)', (t) => {
	const W = 1_000_000
	const offset = 30000
	const played = [{ id: 'redis-restart', title: 'Redis-Neustart (einmal)', atMs: 192000, endMs: 192300, note: 'neu gestartet' }]
	const ok = new Map([['editor-01', [W + 191000, W + 193000]]])
	const lo = (sentW, who, device, o = {}) => ({ tMs: sentW + 20 + offset, ms: 20, key: 'sync-empty', status: 401, who, device, sess: 1, series: 1, ...o })
	const logouts = [
		lo(194000, 'editor', 'editor-05', { status: 412 }), // a second 412 after the window: apart, not counted
		lo(192100, 'editor', 'editor-06'), // in the window …
		lo(195000, 'editor', 'editor-06', { key: 'login', sess: 2, series: 1, relogin: true }), // … its re-login refused after it: counts (once)
		lo(196000, 'editor', 'editor-07'), // after the window …
		lo(197000, 'editor', 'editor-07', { key: 'login', sess: 2, series: 1, relogin: true }), // … and its re-login: still one
	]
	const r = measureSF(played, [], offset, ok, W, logouts, { logouts })
	assert.deepEqual([r.unauthorizedDuringRedis, r.unauthorizedAfterRedis], [0, 2], 'editor-06 (first 401 after the window: its re-login) and editor-07 once each; the 412 not')
	assert.equal(r.loggedOut412, 1)
	assert.deepEqual(r.loggedOut412List.map((x) => [x.device, x.status, x.when]), [['editor-05', 412, 'nach']])
	assert.deepEqual(r.loggedOut.map((x) => [x.device, x.relogin, x.counted, x.when]), [['editor-06', false, false, 'während'], ['editor-06', true, true, 'nach'], ['editor-07', false, true, 'nach'], ['editor-07', true, false, 'nach']])
	const g = evaluateSF({ scenario: 'SF', checks: { k1: { ok: true }, k2: { ok: true }, k3: { ok: true } }, faults: r })
	assert.equal(g.rules[2].ok, false)
	// only the 412 logout after the window: rule 3 green
	const only412 = measureSF(played, [], offset, ok, W, logouts.slice(0, 1), { logouts: logouts.slice(0, 1) })
	assert.deepEqual([only412.unauthorizedAfterRedis, only412.loggedOut412], [0, 1])
	assert.equal(evaluateSF({ scenario: 'SF', checks: { k1: { ok: true }, k2: { ok: true }, k3: { ok: true } }, faults: only412 }).rules[2].ok, true, 'a 412 logout is no "401 nach dem Redis-Neustart"')
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, { scenario: 'SF', variant: 'base', seed: 3, faults: r, gate: g }, '')
	const md = fs.readFileSync(path.join(dir, 'sf-base.md'), 'utf8')
	assert.match(md, /^- SF Abmeldungen nach zweitem 412 \(CSRF; getrennt, zählen nicht für Regel 3\): 1 – 194,000 s editor-05 \(editor, nach\)$/m)
	assert.match(md, /195,000 s editor-06 \(editor, nach, Neuanmeldung\)/)
	assert.match(md, /197,000 s editor-07 \(editor, nach, Neuanmeldung, nicht gezählt\)/)
})

// --- close-out of stage 4 (R21) ---------------------------------------------

test('R21 (W3V-01): the CPU cap is the container\'s cpu.max or cpuset first, the host only without either; the default host count ignores the generator\'s affinity', () => {
	const files = {
		'/nc/cpu.max': '1200000 100000\n', '/nc/cpuset.cpus.effective': '0-15\n',
		'/q/cpu.max': '1200000 100000\n',
		'/db/cpu.max': 'max 100000\n', '/db/cpuset.cpus.effective': '0-3\n',
	}
	const read = (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p] }
	// r3w3: the generator ran under taskset -c 4-7, availableParallelism() gave 4 – nc (cpu.max 12) and redis showed "Deckel 4"
	assert.equal(cgroupCap('/nc', read, 4), 12, 'cpu.max 1200000 100000 → 12, also with an affinity-limited host value below it')
	assert.equal(cgroupCap('/q', read, 4), 12, 'cpu.max alone (no cpuset file) → 12 over a host value of 4')
	assert.equal(cgroupCap('/nc', read, 16), 12, 'cpu.max 12 on a host of 16 → 12')
	assert.equal(cgroupCap('/db', read, 2), 4, 'the cpuset 0-3 → 4, also over a smaller host value')
	assert.equal(cgroupCap('/none', read, 16), 16, 'neither cpu.max nor cpuset: the host')
	assert.equal(cgroupCap(null, read, 16), 16, 'no cgroup directory: the host')
	assert.equal(cgroupCap('/none', read, 0), null, 'nothing known: no cap')
	// the default: every CPU of the host, whatever the affinity of the process says (availableParallelism() stubbed)
	const real = os.availableParallelism
	const fake = os.cpus().length > 1 ? 1 : 2
	os.availableParallelism = () => fake
	try {
		assert.equal(new CpuSampler({}).hostCpus, os.cpus().length, 'hostCpus = os.cpus().length, not availableParallelism()')
	} finally {
		os.availableParallelism = real
	}
})

test('R21 (W3V-02): a 401 line says "zählt für Regel 3" only when the request was sent after the restart window; no other 401 line reads as counted', (t) => {
	const W = 1_000_000
	const offset = 31000
	const played = [{ id: 'redis-restart', title: 'Redis-Neustart (einmal)', atMs: 192000, endMs: 192307, note: 'neu gestartet' }]
	const ok = new Map([['editor-01', [W + 191000, W + 193000]]])
	const lo = (sentW, who, device, o = {}) => ({ tMs: sentW + 20 + offset, ms: 20, key: 'sync-empty', status: 401, who, device, sess: 1, series: 1, ...o })
	const logouts = [
		lo(192069, 'editor', 'editor-12'), // in the window: the first of its series, does not count (r3w3 printed ", gezählt")
		lo(192291, 'moderator', 'moderator'), // in the window as well
		lo(193000, 'editor', 'editor-20'), // after the window: counts for rule 3
		lo(194000, 'editor', 'editor-20', { key: 'login', sess: 2, relogin: true }), // its re-login, the same series: not again
	]
	const r = measureSF(played, [], offset, ok, W, logouts, { logouts })
	assert.deepEqual([r.unauthorizedDuringRedis, r.unauthorizedAfterRedis], [2, 1])
	const g = evaluateSF({ scenario: 'SF', checks: { k1: { ok: true }, k2: { ok: true }, k3: { ok: true } }, faults: r })
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, { scenario: 'SF', variant: 'base', seed: 3, faults: r, gate: g }, '')
	const md = fs.readFileSync(path.join(dir, 'sf-base.md'), 'utf8')
	const lines = md.split('\n').filter((l) => l.startsWith('  - 401 '))
	assert.equal(lines.length, 4, 'one line per 401')
	for (const l of lines) assert.doesNotMatch(l, /gezählt/, `no 401 line says "gezählt": ${l}`)
	assert.match(md, /^ {2}- 401 während: gesendet 192,069 s, .* \(editor-12, Sitzung 1, erstes der Serie, zählt nicht\)$/m)
	assert.match(md, /^ {2}- 401 während: gesendet 192,291 s, .* \(moderator, Sitzung 1, erstes der Serie, zählt nicht\)$/m)
	assert.match(md, /^ {2}- 401 nach: gesendet 193,000 s, .* \(editor-20, Sitzung 1, zählt für Regel 3\)$/m)
	assert.match(md, /^ {2}- 401 nach: gesendet 194,000 s, .* \(editor-20, Sitzung 2, Neuanmeldung\)$/m)
	const counted = lines.filter((l) => /zählt für Regel 3/.test(l))
	assert.equal(counted.length, r.unauthorizedAfterRedis, 'as many "zählt für Regel 3" as rule 3 counts')
	assert.ok(counted.every((l) => l.startsWith('  - 401 nach: ')), 'only lines sent after the window')
})

test('R21 (W3V-03): the page measurement names every request other than 200 per window as nonOk {status, method, path}, the path without its query', async () => {
	const P = await import('../load/lib/pageload.mjs')
	// the r3w3 board window had 96 × 200, 1 × 206, 1 × 302, 1 × 404 without paths; the paths here are invented
	const log = [
		'172.23.0.3 - - [14/Oct/2026:08:15:41 +0000] "GET /index.php/apps/knorke/b/7 HTTP/1.1" 200 5120 "-" "Mozilla"',
		'172.23.0.3 - - [14/Oct/2026:08:15:41 +0000] "GET /index.php/apps/files/ HTTP/1.1" 302 0 "-" "Mozilla"',
		'172.23.0.3 - - [14/Oct/2026:08:15:42 +0000] "GET /apps/theming/img/missing.svg?v=3 HTTP/1.1" 404 210 "-" "Mozilla"',
		'172.23.0.3 - - [14/Oct/2026:08:15:43 +0000] "GET /custom_apps/knorke/fonts/x.woff2 HTTP/1.1" 206 900 "-" "Mozilla"',
		'172.23.0.9 - - [14/Oct/2026:08:15:43 +0000] "GET /missing HTTP/1.1" 404 9 "-" "curl"',
		'172.23.0.3 - - [14/Oct/2026:08:15:49 +0000] "POST /index.php/apps/knorke/api/v1/p/AbCd/join HTTP/1.1" 200 1 "-" "Mozilla"',
	].join('\n')
	const windows = [
		{ name: 'board', from: '2026-10-14T08:15:40.038Z', to: '2026-10-14T08:15:46.640Z', browserRequests: 4, title: 'Knorke - Nextcloud' },
		{ name: 'vote', from: '2026-10-14T08:15:48.169Z', to: '2026-10-14T08:15:54.004Z', browserRequests: 1, title: 'Nextcloud' },
	]
	const counted = M.countAccessLog(log, '172.23.0.3', windows)
	assert.deepEqual(counted[0].nonOk, [
		{ status: 302, method: 'GET', path: '/index.php/apps/files/' },
		{ status: 404, method: 'GET', path: '/apps/theming/img/missing.svg' },
		{ status: 206, method: 'GET', path: '/custom_apps/knorke/fonts/x.woff2' },
	], 'the 302 and the 404 (and the 206) of the window in log order; the other client\'s 404 not')
	assert.deepEqual(counted[1].nonOk, [], 'a window with only 200: empty')
	const out = P.reportWindows(windows, counted)
	assert.deepEqual(out[0], { ...windows[0], serverRequests: 4, statuses: { 200: 1, 206: 1, 302: 1, 404: 1 }, nonOk: counted[0].nonOk }, 'the printed window carries nonOk beside the statuses')
	assert.deepEqual(out[1], { ...windows[1], serverRequests: 1, statuses: { 200: 1 }, nonOk: [] })
	const src = fs.readFileSync(path.join(ROOT, 'dev/load/lib/pageload.mjs'), 'utf8')
	assert.match(src, /windows: reportWindows\(windows, counted\)/, 'the host part prints its windows through reportWindows')
})

test('R21 (P2B-01): the knee counts the errors of S4 rule 2 without busy (the definition of the S5 gate at 45); p95 stays the maximum of the classes', () => {
	const step = (x = {}) => ({
		config: { editors: 60 }, checks: { ok: true },
		totals: { requests: 1000, status5xx: 0, status4xx: 0, status429: 0, timeouts: 0, netErrors: 0, ...x.totals },
		opCodes: { ok: 900, locked: 5, ...x.opCodes }, budget: { busy: 0, ...x.budget },
		endpoints: { 'sync-empty': { p95: 40 }, 'sync-ops': { p95: 90 }, ...x.endpoints },
	})
	assert.deepEqual(kneeErrors(step()), { errors: 0, requests: 1000, share: 0 })
	assert.equal(stepKnee(60, step()), null, 'below both thresholds: no knee')
	// errors the old definition (5xx, timeouts, network errors, 429) did not see
	assert.deepEqual(stepKnee(60, step({ totals: { status4xx: 10 } })), { editors: 60, p95: 90, errorShare: 0.01 }, '1 % unexpected 4xx (e.g. 401, 412): the knee')
	assert.deepEqual(stepKnee(60, step({ opCodes: { bad: 10 } })), { editors: 60, p95: 90, errorShare: 0.01 }, '1 % unexpected op codes (bad): the knee')
	assert.equal(stepKnee(60, step({ totals: { status4xx: 9 } })), null, '0.9 %: no knee')
	assert.equal(stepKnee(60, step({ opCodes: { locked: 50, dup: 20 } })), null, 'the allowed codes are no errors')
	// what counted before still counts
	assert.equal(stepKnee(60, step({ totals: { status5xx: 4, timeouts: 3, netErrors: 3 } })).errorShare, 0.01)
	assert.equal(stepKnee(60, step({ totals: { status4xx: 10, status429: 10 } })).errorShare, 0.01, 'a 429 is one of the 4xx – counted once')
	// busy is no knee error: the gate at 45 counts it, the knee does not
	assert.deepEqual(kneeErrors(step({ budget: { busy: 50 } })), { errors: 0, requests: 1000, share: 0 })
	assert.equal(stepKnee(60, step({ budget: { busy: 50 } })), null, '5 % busy: no knee')
	// one definition: rule2Errors (S4 rule 2, S5 gate at 45) minus busy
	const s = step({ totals: { status5xx: 1, status4xx: 2 }, opCodes: { bad: 3, dup: 4 }, budget: { busy: 7 } })
	const r2 = rule2Errors(s)
	assert.equal(kneeErrors(s).errors, r2.total - r2.busy)
	assert.equal(kneeErrors(s).errors, 6, '5xx 1 + 4xx 2 + bad 3 (dup allowed); busy 7 left out')
	// p95 = the maximum of the class p95 (R2)
	assert.deepEqual(stepKnee(60, step({ endpoints: { 'sync-vote': { p95: 310 } } })), { editors: 60, p95: 310, errorShare: 0 })
	assert.equal(stepKnee(60, step({ endpoints: { 'sync-ops': { p95: 300 } } })), null, 'p95 300 is not above 300')
	// a step without a request is the knee, as before
	assert.deepEqual(kneeErrors({ totals: { requests: 0 } }), { errors: null, requests: 0, share: 1 })
	assert.equal(stepKnee(60, { config: { editors: 60 }, totals: { requests: 0 }, endpoints: {} }).errorShare, 1)
	// the S5 loop decides through stepKnee
	const gen = fs.readFileSync(path.join(ROOT, 'dev/load/lib/generator.mjs'), 'utf8')
	assert.match(gen, /\n\t\t\tknee = stepKnee\(editors, rep\)\n\t\t\tif \(knee\) break\n/, 'the S5 loop takes the knee from stepKnee')
	assert.doesNotMatch(gen, /status429\) \/ rep\.totals\.requests/, 'no second, older error definition in the loop')
})
