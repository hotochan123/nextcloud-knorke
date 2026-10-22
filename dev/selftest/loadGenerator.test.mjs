/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The load generator against a fake server (SPEC-M1 §9.5 row 4.1, WP-D4:
 * "Generator gegen Fake-Server"), no stack, no Docker: dev/load/lib/
 * generator.mjs drives a fake protocol-2 server (lib/fakeKnorke.mjs, node:http
 * on 127.0.0.1, kernel-chosen port) for a few seconds:
 *
 * - S4 (shortened: 6 s window, scale 0.2 = 1 moderator + 4 account editors +
 *   1 guest editor + 20 tablets): login, snapshot, guest join with 429
 *   slow_down, /sync with proto 2 and ep, acks with seq, `busy` + retryMs
 *   (same seq again, nothing lost), timer, "Alle zu mir", voting session,
 *   tablets without `me`; then K1 (every mirror = snapshot), K2 (log replay
 *   = snapshot) and K3 (every ok op in effect) green, the vote result = the
 *   generator's confirmed votes; the report carries seed, latency classes,
 *   edge verdict, cursor and follow lag; written as s4-base[-<label>]
 * - S1: idle editors send no ops, tablets poll every 2 s, editors every 1 s
 * - the abort path: stop.requested ends the run early with `aborted`
 * - S4d refuses a stack whose variant is not dbpersistent (exit code 2),
 *   S4e a stack without the load run's Traefik
 * - load.mjs: its flags (strict parser)
 * - SF (lib/faults.mjs): the fault list in its order, docker actions only
 *   on knorke-dev-<ns>-* (never try, never prod), knorke_dev on for the
 *   window and off again; measureSF (recovery per fault from the devices'
 *   successful syncs sent after the fault, 5xx outside ±5 s, 401 after the
 *   Redis restart)
 * - Revision 19 (SPEC-M1 §8.7, T4-09/T4-10/T4-11): one pid per tab – more
 *   account editors than load accounts is a harness error (exit code 1, not
 *   2); an SF run against the fake server measures every fault's recovery;
 *   S5 aborted after its complete step 45 is judged over the steps up to 45,
 *   aborted before it (and S4) is invalid; SC with --page-requests models
 *   the measured numbers, without them "nicht gemessen" (never green)
 * - fix round [D] of stage 4 phase 2 (W3 r1w3): the drag commit carries the
 *   whole placement group {x, y, parent} (the fake answers an incomplete one
 *   with `bad` like OpValidator), opCodes.bad = 0 in S4 and in every S5 step
 *   (F1); the collectors start fresh in every S5 step (F2); the seeding is
 *   reported apart as budget.seed {syncs, ops, busy} and its windows go to
 *   the collectors (F3); SC names E12 (85/31) and M0 (85/34) apart (F5)
 * - fix round p2d (W3 r2w3, G2–G4): a device's first 401 ends its session
 *   like in the real client – the moderator/owner included –, nothing more
 *   goes out with it, it logs in again and goes on; 412 → one token refresh
 *   and one repeat, a second 412 is logged_out; SF counts the first 401 per
 *   device (in the restart window apart, after it red), a device that never
 *   recovers makes rule 2 red; K1–K3 read through a fresh login
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startFakeKnorke, placementOk } from './lib/fakeKnorke.mjs'
import { runScenario } from '../load/lib/generator.mjs'
import { Actor, dragCommit } from '../load/lib/actors.mjs'
import { rngFor } from '../load/lib/plan.mjs'
import { parseArgs } from '../load/load.mjs'
import { writeRunReports, writeSummary } from '../load/lib/summary.mjs'

const BOARD = { notes: 40, shapes: 6, connectors: 8, frames: 2 }
const envFor = (port, extra = {}) => ({
	ns: 'dzload', ncIp: '127.0.0.1', ncPort: port, host: 'localhost', userPass: 'pw', users: { alice: 'Alice Adler' },
	// one load account per account editor (R19, T4-09: one pid per tab)
	load: { users: Array.from({ length: 12 }, (_, i) => `load${String(i + 1).padStart(2, '0')}`), group: 'workshop', variant: 'base' }, versions: { nextcloud: 'fake' }, ...extra,
})

test('S4 against the fake server: joins with slow_down, busy retried with the same seq, moderation, votes, K1–K3 green', { timeout: 90000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw', busyEvery: 7, slowDownJoins: 2 })
	t.after(() => fake.close())
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S4', seed: 42, secs: 6, warmupS: 1, scale: 0.2, board: BOARD, deps: { changes: async (id) => fake.log(id) } })
	assert.equal(rep.error, undefined, rep.error)
	assert.equal(rep.seed, 42)
	assert.equal(rep.variant, 'base')
	assert.deepEqual([rep.config.editors, rep.config.moderator, rep.config.accounts, rep.config.guests, rep.config.tablets], [6, 1, 4, 1, 20])
	assert.equal(rep.config.fullLength, false, 'a shortened window is marked')
	assert.deepEqual(rep.config.seeded, { frames: 2, notes: 40, shapes: 6, connectors: 8, batches: 1 })
	assert.deepEqual(fake.stats.badRequests, [], 'every body the generator sent was valid protocol 2 (proto, ep, seq, ≤ 200 ops)')
	assert.deepEqual(rep.protocolErrors, [])
	assert.deepEqual(rep.clientErrors, [])
	assert.equal(fake.stats.slowDown, 2, 'two guest joins got 429 slow_down …')
	const c = rep.checks
	assert.equal(c.k1.clients, 26, '… and still all 26 devices joined (1 + 4 + 1 + 20)')
	assert.equal(c.k1.ok, true, JSON.stringify(c.k1.samples))
	assert.equal(c.k2.ok, true, JSON.stringify(c.k2))
	assert.equal(c.k3.ok, true, JSON.stringify(c.k3.samples))
	assert.ok(c.k3.checked > 0, 'K3 checked ok ops')
	assert.equal(c.drained, true, 'every queue drained: busy batches were sent again, nothing lost')
	assert.ok(fake.stats.busy > 0 && rep.budget.busyAll === fake.stats.busy, `busy answers counted (${fake.stats.busy})`)
	assert.equal(c.votes.ok, true, JSON.stringify(c.votes))
	assert.ok(c.votes.votesSent > 0, 'tablets and editors in mode vote voted')
	assert.ok(rep.opCodes.ok > 0)
	// F1 (W3E-01): the fake answers an incomplete placement group with bad – the generator sends none
	assert.equal(rep.opCodes.bad ?? 0, 0, `no bad op code (${JSON.stringify(rep.opCodes)})`)
	assert.ok(rep.actions.drag > 0, 'editors dragged')
	const moves = fake.log(rep.board.id).filter((row) => row.op === 'patch' && 'x' in JSON.parse(row.patch))
	assert.ok(moves.length > 0 && moves.every((row) => Object.keys(JSON.parse(row.patch)).sort().join() === 'parent,x,y'), `drag commits landed as {x, y, parent} (${moves.length})`)
	// F3 (W3E-05): the seeding apart – one batch, no busy (busyEvery 7 hits workload batches)
	assert.deepEqual([rep.budget.seed.syncs, rep.budget.seed.ops, rep.budget.seed.busy, rep.budget.seed.batches], [1, 56, 0, 1])
	assert.equal(rep.budget.seed.pid, 'u-alice000000000', 'the owner\'s pid from the first snapshot')
	assert.deepEqual(rep.moderation.map((e) => [e.what, e.status]), [['timer start', 200], ['summon', 200], ['vote start', 200], ['vote end', 200]])
	for (const k of ['sync-items', 'sync-ops', 'snapshot']) assert.ok(rep.latency[k].n > 0, `latency class ${k} measured`)
	assert.ok(rep.presence.cursorLagMs.n > 0, 'cursor lag measured between editors')
	assert.ok(rep.presence.followLagMs.n > 0, 'tablets followed the presenter\'s viewport')
	assert.equal(rep.edge.rejected, 0)
	assert.deepEqual(rep.samples.columns, ['tMs', 'key', 'who', 'kind', 'status', 'ms', 'bytes', 'phase'])
	assert.equal(rep.gate.kind, 's4')
	assert.equal(rep.gate.rules[0].ok, true, 'rule 1 correctness')
	assert.equal(rep.gate.rules[4].ok, null, 'rule 5 CPU: no collector here, not measured …')
	assert.equal(rep.gate.ok, false, '… so the gate is not proven')
	// tablets never send `me` (no presence entry under a tablet's name)
	const b = fake.board(rep.board.id)
	assert.ok(![...b.presence.values()].some((e) => /^tablet-/.test(e.n)), 'no tablet in the presence blob')
	assert.ok([...b.presence.values()].some((e) => /^load\d{2}$/.test(e.n)), 'account editors are')
	// report files
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, rep, 'selftest')
	writeSummary(dir, 'selftest')
	assert.deepEqual(fs.readdirSync(dir).sort(), ['s4-base-selftest.json', 's4-base-selftest.md', 's4-base.json', 's4-base.md', 'summary-selftest.json', 'summary-selftest.md', 'summary.json', 'summary.md'])
	assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /^\| S4 \| base \| 42 \| selftest \| \*\*rot\*\* \|/m)
})

test('S1 against the fake server: idle editors send no ops, cadence editors 1 s, tablets 2 s', { timeout: 60000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S1', seed: 7, secs: 4, warmupS: 0.5, scale: 0.2, board: BOARD, deps: {} })
	assert.equal(rep.error, undefined, rep.error)
	assert.deepEqual(rep.opCodes, {}, 'no ops in S1')
	assert.equal(rep.checks, undefined, 'S1 has no K checks')
	assert.equal(rep.gate.ok, null, 'S1 is report only')
	const per = (who, n) => (rep.byWho[`sync-empty · ${who}`]?.rps ?? 0) / n + (rep.byWho[`sync-items · ${who}`]?.rps ?? 0) / n
	const editor = per('editor', rep.config.accounts)
	const tablet = per('tablet', rep.config.tablets)
	assert.ok(editor > 0.6 && editor < 1.4, `account editor ≈ 1 sync/s (${editor})`)
	assert.ok(tablet > 0.3 && tablet < 0.75, `tablet ≈ 0.5 sync/s (${tablet})`)
})

test('the abort path: stop.requested ends a run early with `aborted`; S4d needs the variant dbpersistent', { timeout: 60000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const stop = { requested: false, reason: null }
	const t0 = Date.now()
	setTimeout(() => { stop.requested = true; stop.reason = '1-min-Last des Hosts über 20 (Test)'; stop.onStop?.() }, 2500)
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S4', seed: 1, secs: 30, warmupS: 0.5, scale: 0.1, board: BOARD, deps: {}, stop })
	assert.deepEqual(rep.aborted, { reason: '1-min-Last des Hosts über 20 (Test)' })
	assert.equal(rep.checks, undefined, 'no K checks after an abort')
	assert.ok(Date.now() - t0 < 15000, `stopped early (${Date.now() - t0} ms of a 30-s window)`)
	await assert.rejects(runScenario({ env: envFor(fake.port), scenario: 'S4d', seed: 1, deps: {} }), (e) => e.code === 2 && /variant\.sh dbpersistent/.test(e.message))
	await assert.rejects(runScenario({ env: envFor(fake.port), scenario: 'S4e', seed: 1, deps: {} }), (e) => e.code === 2 && /Traefik/.test(e.message), 'S4e needs the Traefik of the load run')
})

test('load.mjs flags: strict, frozen names; --page-requests only for SC (R19, T4-11)', () => {
	assert.deepEqual(parseArgs(['--scenario', 'S5', '--seed', '9', '--secs', '60', '--steps', '30,45', '--board', '30,5,8,2', '--scale', '0.5', '--warmup', '1', '--abort-file', '/x']),
		{ scenario: 'S5', seed: 9, secs: 60, warmupS: 1, scale: 0.5, board: { notes: 30, shapes: 5, connectors: 8, frames: 2 }, steps: [30, 45], abortFile: '/x' })
	assert.deepEqual(parseArgs(['--scenario', 'SC', '--page-requests', '91,31']).pageRequests, [91, 31])
	for (const bad of [['--scenario', 'S4', '--page-requests', '91,31'], ['--scenario', 'SC', '--page-requests', '91'], ['--scenario', 'SC', '--page-requests', '0,31'], ['--scenario', 'SC', '--page-requests', '91,x']]) {
		assert.throws(() => parseArgs(bad), Error, JSON.stringify(bad))
	}
	for (const bad of [[], ['--scenario', 'S9'], ['--scenario', 'S4', '--bogus', '1'], ['--scenario', 'S4', '--seed'], ['--scenario', 'S4', '--board', '1,2,3'], ['--scenario', 'S4', '--scale', '0'], ['S4']]) {
		assert.throws(() => parseArgs(bad), Error, JSON.stringify(bad))
	}
})

test('SF faults: docker actions only on the namespace\'s own containers, knorke_dev on for the window and off again', async () => {
	const { FaultInjector, assertOwn } = await import('../load/lib/faults.mjs')
	const env = { ns: 'dzflt', containers: { nc: 'knorke-dev-dzflt-nc', db: 'knorke-dev-dzflt-db', redis: 'knorke-dev-dzflt-redis' } }
	const calls = []
	const stack = {
		occ: async (...a) => { calls.push(['occ', ...a]); return '' },
		redisDel: async (...p) => { calls.push(['del', ...p]); return ['k'] },
		redisScan: async (p) => { calls.push(['scan', p]); return ['x/knorke/e1/r:7'] },
		redis: async (...a) => { calls.push(['redis', ...a]); return '12' },
		rotateEpoch: async () => { calls.push(['rotate']); return { before: 'a', after: 'b' } },
	}
	const docker = async (args) => { calls.push(['docker', ...args]); return { ok: true, out: '', err: '' } }
	const f = new FaultInjector(env, stack, { docker, sleep: async () => {} })
	const run = { timeline: { windowMs: 1000, k: 1 }, board: { id: 7 }, running: true, stop: { requested: false }, windowMs: 0, until: async (ms) => { run.windowMs = ms } }
	await f.play(run)
	assert.deepEqual(f.report().played.map((p) => p.id), ['skip-bump', 'rev-del', 'rev-lower', 'presence-del', 'gens-del', 'all-del', 'epoch-rotate', 'redis-restart', 'db-pause'])
	const dockerCalls = calls.filter((c) => c[0] === 'docker').map((c) => c.slice(1).join(' '))
	assert.deepEqual(dockerCalls, ['restart knorke-dev-dzflt-redis', 'pause knorke-dev-dzflt-db', 'unpause knorke-dev-dzflt-db'])
	const occ = calls.filter((c) => c[0] === 'occ').map((c) => c.slice(1).join(' '))
	assert.equal(occ[0], 'config:system:set knorke_dev --value=true --type=boolean', 'knorke_dev on first')
	assert.equal(occ[occ.length - 1], 'config:system:set knorke_dev --value=false --type=boolean', 'and off at the end')
	assert.ok(occ.includes('config:system:set knorke_dev_skip_bump --value=0.2 --type=float') && occ.includes('config:system:delete knorke_dev_skip_bump'))
	assert.deepEqual(calls.find((c) => c[0] === 'redis' && c[1] === 'SET'), ['redis', 'SET', 'x/knorke/e1/r:7', '7', 'KEEPTTL'], 'r: lowered by 5, TTL kept')
	// foreign names never get that far
	for (const bad of ['nextcloud-nextcloud-db-1', 'knorke-dev-try-db', 'knorke-dev-dzfltx-db', 'knorke-lab-1']) {
		assert.throws(() => new FaultInjector({ ...env, containers: { ...env.containers, db: bad } }, stack, { docker }), /gehört nicht zum Namensraum dzflt/, bad)
		assert.throws(() => assertOwn(bad, 'dzflt'), /interner Schutz/)
	}
})

// ── Revision 19 (SPEC-M1 §8.7, T4-09/T4-10/T4-11) ────────────────────────────

test('R19 T4-09: more account editors than load accounts (tabsPerAccount > 1) is a harness error – exit code 1, not 2', { timeout: 30000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const rep = await runScenario({ env: envFor(fake.port, { load: { users: ['load01', 'load02'], group: 'workshop', variant: 'base' } }), scenario: 'S4', seed: 3, secs: 2, warmupS: 0.5, scale: 0.2, board: BOARD, deps: {} })
	assert.match(String(rep.error), /Harness-Fehler: 4 Konto-Bearbeiter, aber nur 2 Lastkonten \(tabsPerAccount 2 > 1\)/)
	assert.notEqual(rep.notApplicable, true, 'a harness error (exit 1), not "nicht anwendbar" (exit 2)')
	const ok = await runScenario({ env: envFor(fake.port), scenario: 'S1', seed: 3, secs: 2, warmupS: 0.5, scale: 0.2, board: BOARD, deps: {} })
	assert.equal(ok.error, undefined, ok.error)
	assert.equal(ok.config.tabsPerAccount, 1, 'one pid per tab')
})

test('R19: SF against the fake server – every fault played, its recovery measured from the devices\' successful syncs', { timeout: 90000 }, async (t) => {
	const { FaultInjector } = await import('../load/lib/faults.mjs')
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const env = envFor(fake.port, { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' } })
	const stack = { occ: async () => '', redisDel: async () => [], redisScan: async () => [], redis: async () => '1', rotateEpoch: async () => ({ before: 'a', after: 'b' }) }
	const faults = new FaultInjector(env, stack, { docker: async () => ({ ok: true, out: '', err: '' }), sleep: async () => {} })
	const rep = await runScenario({ env, scenario: 'SF', seed: 5, secs: 10, warmupS: 0.5, scale: 0.1, board: BOARD, deps: { faults, changes: async (id) => fake.log(id) } })
	assert.equal(rep.error, undefined, rep.error)
	const f = rep.faults
	assert.deepEqual(f.played.map((p) => p.id), ['skip-bump', 'rev-del', 'rev-lower', 'presence-del', 'gens-del', 'all-del', 'epoch-rotate', 'redis-restart', 'db-pause'])
	assert.ok(f.played.every((p) => typeof p.recoveryS === 'number' && p.recoveryS >= 0 && p.recoveryS <= 5 && p.devices > 0), JSON.stringify(f.played.map((p) => [p.id, p.recoveryS, p.devices])))
	assert.equal(f.fiveXxOutside, 0)
	assert.equal(f.unauthorizedAfterRedis, 0)
	const rule = (n) => rep.gate.rules.find((x) => x.rule === n)
	assert.equal(rule(2).ok, true, 'recovery ≤ 35 s')
	assert.equal(rule(3).ok, true, '5xx/401 rule measured')
})

test('R19 T4-10: an aborted S4 is invalid; S5 aborted after its complete step 45 is judged over the steps up to 45, aborted before it is invalid', async () => {
	const { evaluate } = await import('../load/lib/gates.mjs')
	const s4 = evaluate({ scenario: 'S4', aborted: { reason: 'Last' } })
	assert.deepEqual([s4.ok, s4.invalid], [false, true])
	assert.match(s4.note, /Lauf ungültig/)
	const step = (editors, extra = {}) => ({ config: { editors }, checks: { ok: true }, totals: { requests: 100, status5xx: 0, timeouts: 0, netErrors: 0, status429: 0 }, endpoints: { 'sync-empty': { p95: 40 } }, edge: { rejected: 0 }, ...extra })
	const after45 = evaluate({ scenario: 'S5', aborted: { reason: 'Last' }, steps: [step(30), step(45), step(60, { aborted: { reason: 'Last' } })], knee: { text: '> 45 (Abbruch durch Lastschutz)' } })
	assert.equal(after45.ok, true, 'step 45 complete and green: P2 "Knie ≥ 45" holds')
	assert.equal(after45.abortedAfter45, true)
	assert.match(after45.note, /nach der vollständigen Stufe 45/)
	const red45 = evaluate({ scenario: 'S5', aborted: { reason: 'Last' }, steps: [step(30), step(45, { endpoints: { 'sync-empty': { p95: 140 } } }), step(60, { aborted: { reason: 'Last' } })] })
	assert.equal(red45.ok, false, 'step 45 complete but red')
	const before45 = evaluate({ scenario: 'S5', aborted: { reason: 'Last' }, steps: [step(30), step(45, { aborted: { reason: 'Last' } })] })
	assert.deepEqual([before45.ok, before45.invalid], [false, true], 'aborted inside step 45: invalid')
})

test('R19 T4-11: SC with measured page requests models them; without, 85/34 "nicht gemessen" is never green', { timeout: 60000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const measured = await runScenario({ env: envFor(fake.port), scenario: 'SC', seed: 3, secs: 2, warmupS: 1, scale: 0.1, board: BOARD, pageRequests: [91, 31], deps: {} })
	assert.equal(measured.error, undefined, measured.error)
	assert.deepEqual([measured.pageRequests.editor, measured.pageRequests.tablet, measured.pageRequests.measured], [91, 31, true])
	assert.equal(measured.coldStart[0].requests, measured.config.editors * 91 + measured.config.tablets * 31, 'the model counts the measured numbers')
	const rule = (rep, n) => rep.gate.rules.find((x) => x.rule === n)
	assert.equal(rule(measured, 3).ok, true)
	// F5 (W3E-09): E12 (85/31) and the M0 reference (85/34) apart, never one pair "E12/M0"
	assert.deepEqual(measured.pageRequests.e12, { editor: 85, tablet: 31 })
	assert.deepEqual(measured.pageRequests.reference, { editor: 85, tablet: 34 })
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdload-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	writeRunReports(dir, measured, '')
	const md = fs.readFileSync(path.join(dir, 'sc-base.md'), 'utf8')
	assert.match(md, /Seitenzahlen SC: Bearbeiter 91, Tablet 31 – gemessen .*; E12 \(Stufe 4, M1-Bündel\): 85\/31; M0-Referenz: 85\/34$/m)
	assert.doesNotMatch(md, /E12\/M0/)
	const plain = await runScenario({ env: envFor(fake.port), scenario: 'SC', seed: 3, secs: 2, warmupS: 1, scale: 0.1, board: BOARD, deps: {} })
	assert.deepEqual([plain.pageRequests.editor, plain.pageRequests.tablet, plain.pageRequests.measured], [85, 34, false])
	assert.match(plain.pageRequests.source, /nicht gemessen/)
	assert.equal(rule(plain, 1).ok, null, 'not measured: never green')
	assert.equal(plain.gate.ok, false)
})

// ── fix round [D], stage 4 phase 2 (W3 r1w3: W3E-01/04/05, AUD-02/04/05) ──────────

test('F1: every patch the workload makes with x or y carries the whole placement group {x, y, parent} (current parent, relative coordinates)', () => {
	// a board with a frame and children (x/y relative to the frame) and root items, as the seed board has them
	const items = new Map()
	const put = (id, t, x, y, parent) => items.set(id, { id, t, x, y, w: 200, h: 200, r: 0, z: 'a', parent, data: { text: id }, style: {} })
	put('F1', 'frame', 0, 0, null)
	for (let i = 0; i < 12; i++) put(`N${i}`, 'sticky', 40 + i * 10, 80, i % 3 ? 'F1' : null)
	for (let i = 0; i < 4; i++) put(`S${i}`, 'shape', 500 + i * 10, 900, null)
	const ids = [...items.keys()].filter((id) => id !== 'F1')
	const run = { env: {}, board: { id: 1 }, timeline: { k: 1 }, workload: 'workshop', hot: ids.slice(0, 4), pool: ids, hotOps: 0, noteCursor() {}, countAction() {} }
	let drags = 0
	let patches = 0
	for (const seed of [1, 2, 3, 42]) {
		for (const dragger of [true, false]) {
			const a = new Actor(run, { kind: 'editor', idx: 1, rng: rngFor(seed, 1), label: 'editor-01', uid: 'load01' })
			for (const [id, it] of items) a.mirror.items.set(id, structuredClone(it))
			a.dragger = dragger
			let now = 1_000_000
			for (let i = 0; i < 3000; i++) { now += 400; a.act(now) }
			for (const op of a.queue.filter((o) => o.o === 'patch')) {
				patches++
				assert.ok(placementOk(op.p), `placement group complete or absent: ${JSON.stringify(op)}`)
				if ('x' in op.p || 'y' in op.p) {
					drags++
					assert.deepEqual(Object.keys(op.p).sort(), ['parent', 'x', 'y'], JSON.stringify(op))
					assert.equal(op.p.parent, items.get(op.id).parent, `the item's current parent (${op.id})`)
				}
			}
		}
	}
	assert.ok(drags > 20 && patches > drags, `drag commits ${drags} of ${patches} patches`)
	// the commit itself: unchanged parent → end position; another parent meanwhile → the drag's delta on the current relative position
	const t = { x: 130.004, y: 75, x0: 100, y0: 50, parent: 'F1' }
	assert.deepEqual(dragCommit(t, { x: 100, y: 50, parent: 'F1' }), { x: 130, y: 75, parent: 'F1' })
	assert.deepEqual(dragCommit(t, { x: 10, y: 20, parent: 'F2' }), { x: 40, y: 45, parent: 'F2' })
	assert.deepEqual(dragCommit({ ...t, parent: null }, { x: 1, y: 2, parent: null }), { x: 130, y: 75, parent: null })
	assert.deepEqual(dragCommit(t, undefined), { x: 130, y: 75, parent: 'F1' }, 'item gone from the mirror: the server answers gone, the group stays whole')
})

test('F1/F2/F3: S5 against the fake server – no bad op code in any step, every step its own board, the collectors start fresh with the step\'s seed windows', { timeout: 120000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const before = []
	let samples = 0
	const metrics = {
		before: async (o) => { before.push({ ...o, at: Date.now() }); samples = 0 },
		sample: async () => { samples++ },
		after: async () => {},
		summary: () => ({ cpu: { containers: { nc: { coresMean: null }, db: { coresMean: null } } }, budget: { maxPerPid: { syncs: samples, ops: samples }, byPid: {}, keys: 0, seed: null }, boardLockRows: null }),
	}
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S5', seed: 11, secs: 3, warmupS: 0.5, scale: 0.2, steps: [6, 8], board: BOARD, deps: { metrics, changes: async (id) => fake.log(id) } })
	assert.equal(rep.steps.length, 2, JSON.stringify(rep.steps.map((x) => x.error)))
	for (const x of rep.steps) {
		assert.equal(x.error, undefined, x.error)
		assert.equal(x.opCodes.bad ?? 0, 0, `step ${x.config.editors}: no bad op code (${JSON.stringify(x.opCodes)})`)
		assert.ok(x.actions.drag > 0, `step ${x.config.editors}: editors dragged`)
		assert.equal(x.checks.ok, true, JSON.stringify(x.checks))
		assert.equal(x.budget.seed.syncs, 1, 'every step seeds its own board')
	}
	assert.notEqual(rep.steps[0].board.id, rep.steps[1].board.id, 'one board per step (§8.7)')
	assert.equal(before.length, 2, 'before() once per step')
	for (const b of before) {
		assert.equal(b.seed.pid, 'u-alice000000000')
		assert.ok(Number.isInteger(b.seed.win) && b.seed.win <= Math.floor(b.at / 10000), 'the window of the last seed batch, not later than the window start')
	}
	assert.ok(rep.host && 'before' in rep.host && 'after' in rep.host, 'S5 names uptime before/after (from its steps)')
})

test('F3: seeding with busy – budget.seed counts every seed request (busy ones too), ops sent and busy answers; the workload budget stays apart', { timeout: 60000 }, async (t) => {
	// busyEvery 2: seed batch 1 ok, batch 2 busy, batch 2 again ok
	const fake = await startFakeKnorke({ userPass: 'pw', busyEvery: 2 })
	t.after(() => fake.close())
	let got = null
	const metrics = {
		before: async (o) => { got = o },
		sample: async () => {},
		after: async () => {},
		summary: () => ({ cpu: { containers: { nc: { coresMean: null }, db: { coresMean: null } } }, budget: { maxPerPid: { syncs: 5, ops: 7 }, byPid: { p1: { syncs: 5, ops: 7 } }, keys: 2, seed: { syncs: 11, ops: 2200, keys: 2 } }, boardLockRows: null }),
	}
	const t0 = Date.now()
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S1', seed: 4, secs: 1, warmupS: 0.3, scale: 0.1, board: { notes: 250, shapes: 0, connectors: 0, frames: 2 }, deps: { metrics } })
	assert.equal(rep.error, undefined, rep.error)
	assert.deepEqual(rep.budget.seed, { syncs: 3, ops: 304, busy: 1, batches: 2, pid: 'u-alice000000000', lastWindow: got.seed.win, counters: { syncs: 11, ops: 2200, keys: 2 } })
	assert.ok(got.seed.win >= Math.floor(t0 / 10000) && got.seed.win <= Math.floor(Date.now() / 10000))
	assert.deepEqual(rep.budget.maxPerPid, { syncs: 5, ops: 7 }, 'maxPerPid is the collectors\' workload maximum, the seeding is not in it')
	assert.equal(rep.budget.busyAll, 0, 'the seeding\'s busy is not a workload busy (§8.7: it does not count for rule 2)')
})

test('P2B-05: the fake answers like the server to placement patches – {x,y} without parent bad, {x,y,parent} ok, empty p bad, parent null or an existing frame ok, an unknown id bad', async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const base = `http://127.0.0.1:${fake.port}`
	const login = await fetch(`${base}/index.php/csrftoken`, { headers: { Authorization: `Basic ${Buffer.from('alice:pw').toString('base64')}` } })
	const cookie = login.headers.get('set-cookie').split(';')[0]
	const token = (await login.json()).token
	const hdr = { 'Content-Type': 'application/json', Cookie: cookie, requesttoken: token, 'X-Requested-With': 'XMLHttpRequest' }
	const bid = (await (await fetch(`${base}/index.php/apps/knorke/api/v1/boards`, { method: 'POST', headers: hdr, body: JSON.stringify({ title: 'B' }) })).json()).board.id
	let seq = 0
	const sync = async (ops) => (await (await fetch(`${base}/index.php/apps/knorke/api/v1/boards/${bid}/sync`, { method: 'POST', headers: hdr, body: JSON.stringify({ proto: 2, ep: 'fakeep1', client: 'c', since: 0, seq: ++seq, ops }) })).json()).acks.res
	assert.deepEqual(await sync([
		{ o: 'put', id: 'F1', t: 'frame', p: { x: 0, y: 0, w: 100, h: 100, r: 0, z: 'a', parent: null, data: {}, style: {} } },
		{ o: 'put', id: 'N1', t: 'sticky', p: { x: 5, y: 5, w: 10, h: 10, r: 0, z: 'b', parent: null, data: {}, style: {} } },
	]), ['ok', 'ok'])
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: { x: 1, y: 2 } }]), ['bad'], '{x,y} without parent')
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: { x: 1, y: 2, parent: null } }]), ['ok'], '{x,y,parent: null}')
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: { x: 1, y: 2, parent: 'F1' } }]), ['ok'], 'existing frame')
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: { x: 1, y: 2, parent: 'NOPE' } }]), ['bad'], 'unknown parent id')
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: { x: 1, y: 2, parent: 'N1' } }]), ['bad'], 'parent is not a frame')
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: {} }]), ['bad'], 'empty p')
	assert.deepEqual(await sync([{ o: 'patch', id: 'N1', p: { 'data.text': 'hi' } }]), ['ok'], 'a patch without placement keys stays ok')
})

// ── fix round p2d, stage 4 phase 2 (W3 r2w3: W3B-03/04/05, G2–G4) ───────────────

test('G2 (p2d): one device – 412 fetches a token and repeats once; a second 412 or a 401 ends the session at once: batch and queue dropped and counted, the device marked', async () => {
	const calls = []
	const run = {
		env: {}, board: { id: 7 }, running: true, acting: false, timeline: { k: 1 },
		record: (key, who, r, kind, actor) => calls.push(['record', key, r.status, actor?.label]),
		loggedOut: (a, o) => calls.push(['loggedOut', a.label, o.key, o.lost, o.r.status]),
		noteOk() {}, protocolError: (a, p) => calls.push(['protocolError', p]), nap: async () => {}, acked() {}, busy() {}, countAction() {}, noteCursor() {},
	}
	const mk = (label, answers) => {
		const a = new Actor(run, { kind: 'editor', idx: 1, rng: rngFor(1, 1), label, uid: 'load01' })
		a.stub = { syncs: 0, refresh: 0 }
		a.http = { sync: async () => { a.stub.syncs++; return answers.shift() }, refreshToken: async () => { a.stub.refresh++; return { status: 200, ms: 1, text: '' } } }
		a.ready = true
		return a
	}
	const twice = mk('editor-01', [{ status: 412, ms: 5, text: '' }, { status: 412, ms: 5, text: '' }])
	twice.queue = [{ o: 'patch', id: 'x', p: { 'data.text': 'a' } }, { o: 'remove', id: 'y' }]
	assert.equal(await twice.tick(), false)
	assert.deepEqual([twice.stub.syncs, twice.stub.refresh], [2, 1], 'one token refresh, the same request once more')
	assert.ok(twice.loggedOut, 'a second 412: logged_out (SPEC-M0 error table)')
	assert.deepEqual([twice.inflight, twice.queue.length, twice.ready, twice.stats.lostOps, twice.stats.logouts], [null, 0, false, 2, 1])
	assert.deepEqual(calls.find((c) => c[0] === 'loggedOut'), ['loggedOut', 'editor-01', 'sync-ops', 2, 412])
	assert.ok(calls.some((c) => c[0] === 'record' && c[1] === 'csrftoken' && c[3] === 'editor-01'), 'the token refresh is recorded')
	const once = mk('editor-02', [{ status: 412, ms: 5, text: '' }, { status: 200, ms: 5, text: '{}', data: { rev: 0, now: 1 } }])
	await once.tick()
	assert.deepEqual([once.stub.syncs, once.stub.refresh, once.loggedOut], [2, 1, null], '412 then 200: on with the same session')
	const gone = mk('editor-03', [{ status: 401, ms: 5, text: '{"message":"Current user is not logged in"}' }])
	gone.queue = [{ o: 'remove', id: 'z' }]
	await gone.tick()
	assert.deepEqual([gone.stub.syncs, gone.stub.refresh, !!gone.loggedOut, gone.stats.lostOps], [1, 0, true, 1], '401: logged_out at once, no refresh')
	assert.equal(calls.filter((c) => c[0] === 'protocolError').length, 0, 'a logout is no protocol error')
})

test('G2/G3/G4 (p2d, W3B-03/04/05): SF against the fake – the first 401 ends a session (moderator/owner included), nothing more goes out with it, re-login and on; in the restart window apart, after it counted per device; a device that never recovers is red; K1–K3 through a fresh login', { timeout: 180000 }, async (t) => {
	const { FaultInjector } = await import('../load/lib/faults.mjs')
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const env = envFor(fake.port, { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' } })
	const stack = { occ: async () => '', redisDel: async () => [], redisScan: async () => [], redis: async () => '1', rotateEpoch: async () => ({ before: 'a', after: 'b' }) }
	const nap = (ms) => new Promise((r) => setTimeout(r, ms))
	const docker = async ([verb]) => {
		// the Redis restart (window 1.3 s): the owner's session dies like the moderator's in r2w3, and every
		// session request answers 401 meanwhile while the sessions survive (probe P1: Redis down)
		if (verb === 'restart') { fake.killSessions((x) => x.uid === 'alice'); fake.outage(1300); await nap(1300) }
		// later (DB pause): load03's and load04's sessions die after the restart window; load04 can never log in again
		if (verb === 'pause') { fake.killSessions((x) => x.uid === 'load03' || x.uid === 'load04'); fake.blockLogin('load04') }
		return { ok: true, out: '', err: '' }
	}
	const faults = new FaultInjector(env, stack, { docker, sleep: (ms) => nap(Math.min(ms, 200)) })
	const rep = await runScenario({ env, scenario: 'SF', seed: 5, secs: 40, warmupS: 0.5, scale: 0.2, board: BOARD, deps: { faults, changes: async (id) => fake.log(id) } })
	assert.equal(rep.error, undefined, rep.error)
	const f = rep.faults
	const ids = (list) => list.map((x) => x.device).sort()
	// G2: the moderator/owner was logged out in the restart window and logged in again (its join path logs in now)
	const mod = f.loggedOut.find((x) => x.device === 'moderator')
	assert.ok(mod && mod.role === 'moderator' && mod.when === 'während', `moderator logged out during the restart: ${JSON.stringify(f.loggedOut)}`)
	assert.ok(rep.sessions.relogged.some((x) => x.device === 'moderator' && x.sess === 2), `moderator re-logged: ${JSON.stringify(rep.sessions.relogged)}`)
	const modOut = rep.sessions.loggedOut.find((x) => x.device === 'moderator')
	assert.ok(modOut && Array.isArray(modOut.setCookie) && typeof modOut.sentMs === 'number', 'the report names time, device, role and the cookie names the 401 set (P1 diagnosis, no values)')
	// rule 3 per device: the first 401 after the window counts (editor-03, editor-04), the ones in it are reported apart
	assert.deepEqual(ids(f.unauthorized.filter((u) => u.counted && u.when === 'nach')), ['editor-03', 'editor-04'], JSON.stringify(f.unauthorized))
	assert.ok(f.unauthorized.some((u) => u.device === 'editor-04' && u.relogin && u.key === 'login' && !u.counted), 'p2e: the 401 of editor-04\'s re-login is listed, counted once with its series')
	assert.equal(f.unauthorizedAfterRedis, 2)
	assert.ok(f.unauthorizedDuringRedis >= 1)
	assert.match(f.countedBy, /je Gerät und Sitzung das erste 401/)
	// G2: no client sent anything more with a session after its first 401
	const hits = fake.hitsAfterFirst401()
	assert.ok(hits.length >= 3, `sessions that got a 401: ${hits.length}`)
	assert.deepEqual(hits.filter((h) => h.after > 0), [], `requests on a dead session: ${JSON.stringify(hits)}`)
	// G3: editor-04 never recovered after the DB pause – rule 2 red; the re-logged moderator reported apart at the restart
	const [restart, pause] = ['redis-restart', 'db-pause'].map((id) => f.played.find((p) => p.id === id))
	assert.ok(pause.notRecovered >= 1 && pause.notRecoveredDevices.includes('editor-04 (abgemeldet)'), JSON.stringify(pause))
	assert.ok(restart.reloggedDevices.some((x) => x.device === 'moderator'), JSON.stringify(restart))
	assert.ok(rep.sessions.stillLoggedOut.includes('editor-04'))
	const rule = (n) => rep.gate.rules.find((x) => x.rule === n)
	assert.equal(rule(2).ok, false, 'a device that never recovered: rule 2 red')
	assert.equal(rule(3).ok, false, 'two first 401 after the restart window: rule 3 red')
	// G4: K1–K3 measured through the check's own login although the owner's first session died
	assert.equal(rep.checks.session, 'frisch (eigene Anmeldung)')
	assert.equal(rep.checks.k1.ok, true, JSON.stringify(rep.checks.k1))
	assert.deepEqual(rep.checks.k1.loggedOut, ['editor-04'], 'the device still logged out is named, not compared')
	assert.equal(rule(1).ok, true, 'K1–K3 green')
	assert.deepEqual(rep.protocolErrors, [], 'logouts and re-logins are no protocol errors')
})

test('G4 (p2d, W3B-04): K1–K3 read the snapshot through the check\'s own login – the owner\'s session dies right before the check, K1–K3 stay measured', { timeout: 90000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	let killedAt = null
	const metrics = {
		before: async () => {},
		sample: async () => {},
		after: async () => { fake.killSessions((x) => x.uid === 'alice'); killedAt = Date.now() },
		summary: () => ({ cpu: { containers: { nc: { coresMean: null }, db: { coresMean: null } } }, budget: null, boardLockRows: null }),
	}
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S4', seed: 8, secs: 4, warmupS: 0.5, scale: 0.2, board: BOARD, deps: { metrics, changes: async (id) => fake.log(id) } })
	assert.equal(rep.error, undefined, rep.error)
	assert.equal(rep.checks.error, undefined, rep.checks.error)
	assert.equal(rep.checks.session, 'frisch (eigene Anmeldung)')
	assert.deepEqual([rep.checks.k2.ok, rep.checks.k3.ok], [true, true], JSON.stringify(rep.checks))
	// p2e (finding 2): the moderator's 401 in quiet is no silent loss – K1 is green after its re-login or red naming it
	assert.ok(rep.checks.k1.ok === true || rep.checks.k1.loggedOut.join() === 'moderator', JSON.stringify(rep.checks.k1))
	// the reference snapshot came from a session created after the owner's died that never synced: the check's own
	const own = fake.sessionLog().filter((x) => x.uid === 'alice' && x.created >= killedAt && x.syncs === 0 && x.snapshots > 0)
	assert.equal(own.length, 1, JSON.stringify(fake.sessionLog().filter((x) => x.uid === 'alice')))
})

// ── mini-fix p2e (independent review of p2d, findings 1, 2, 4, 5) ─────────────────

test('p2e-1 (review finding 1): S1 against the fake with the real Collectors and a slow MGET (1.5 s) – the 1-s sampler stays ≤ 1/s, the budget clock never spins, no read after the window end counts', { timeout: 60000 }, async (t) => {
	const { Collectors } = await import('../load/lib/collect.mjs')
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const env = envFor(fake.port, { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' } })
	const calls = []
	const nap = (ms) => new Promise((r) => setTimeout(r, ms))
	const stack = {
		psql: async (sql) => { calls.push(['psql', Date.now(), /numbackends FROM/.test(sql) && !/xact_commit/.test(sql)]); return ['3'] },
		redisScan: async (p) => {
			const kind = p.includes('/wo:') ? 'wo' : p.includes('/w:') ? 'w' : null
			if (kind) calls.push(['scan', Date.now()])
			return kind ? Array.from({ length: 120 }, (_, i) => `d38b/knorke/fakeep1/${kind}:1:p${i}:1`) : []
		},
		redis: async (cmd, ...keys) => {
			calls.push([cmd, Date.now()])
			if (cmd !== 'MGET') return ''
			await nap(1500)
			calls.push(['MGET-end', Date.now()])
			return keys.map(() => '2').join('\n')
		},
		occ: async () => '{}',
	}
	const metrics = new Collectors(env, stack, { cmd: async () => ({ ok: true, out: '0', err: '' }), status: async () => null, budgetEveryMs: 1000, budgetMinGapMs: 500 })
	const rep = await runScenario({ env, scenario: 'S1', seed: 2, secs: 6, warmupS: 0.3, scale: 0.1, board: BOARD, deps: { metrics, epoch: async () => 'fakeep1' } })
	assert.equal(rep.error, undefined, rep.error)
	const samples = calls.filter((x) => x[0] === 'psql' && x[2]).length
	assert.ok(samples >= 4 && samples <= Math.ceil(rep.measureSecs) + 1, `the 1-s sampler: ${samples} samples in ${rep.measureSecs} s`)
	const at = (kind) => calls.filter((x) => x[0] === kind).map((x) => x[1])
	const [scans, ends] = [at('scan'), at('MGET-end')]
	assert.ok(scans.length >= 4 && ends.length >= 2, `two reads started: ${scans.length} scans, ${ends.length} MGET ends`)
	assert.ok(scans[2] - ends[1] >= 450, `the second read starts at least the least gap after the first ended (${scans[2] - ends[1]} ms), never back to back`)
	assert.equal(at('GET').length, 0, 'no GET per key')
	const sm = rep.budget.sampling
	assert.deepEqual([sm.reads, sm.droppedAfterEnd], [1, 1], `the read running at the window end is dropped: ${JSON.stringify(sm)}`)
})

test('p2e-2 (review finding 2): S4 without faults – a device logged out for good makes K1 red and is a protocol error (no silent loss)', { timeout: 90000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	let n = 0
	const metrics = {
		before: async () => {},
		sample: async () => { if (++n === 2) { fake.killSessions((x) => x.uid === 'load02'); fake.blockLogin('load02') } },
		after: async () => {},
		summary: () => ({ cpu: { containers: { nc: { coresMean: null }, db: { coresMean: null } } }, budget: null, boardLockRows: null }),
	}
	const rep = await runScenario({ env: envFor(fake.port), scenario: 'S4', seed: 9, secs: 5, warmupS: 0.5, scale: 0.2, board: BOARD, deps: { metrics, changes: async (id) => fake.log(id) } })
	assert.equal(rep.error, undefined, rep.error)
	assert.deepEqual(rep.checks.k1.loggedOut, ['editor-02'])
	assert.equal(rep.checks.k1.ok, false, 'K1 red: a device still logged out at the check (no fault injection)')
	assert.ok(rep.protocolErrors.some((p) => p.actor === 'editor-02' && /abgemeldet \(HTTP 401\) ohne Fehlereinspielung/.test(p.problem)), JSON.stringify(rep.protocolErrors))
	assert.equal(rep.gate.rules[0].ok, false, 'S4 rule 1 red')
})

test('p2e-4 (review finding 4): a failed re-login keeps its HTTP status; a 401 while logging in again goes through run.loggedOut, once per series', async () => {
	const { loginStatus } = await import('../load/lib/actors.mjs')
	assert.equal(loginStatus(new Error('Login load01: 401 {"message":"x"}')), 401)
	assert.equal(loginStatus(new Error('Login load01: 503 down')), 503)
	assert.equal(loginStatus(new Error('Login load01: neterr Error: socket')), 'neterr')
	assert.equal(loginStatus(new Error('boom')), 'error')
	const recs = []
	const outs = []
	const run = { env: {}, board: { id: 7 }, running: true, record: (key, who, r) => recs.push([key, r.status]), loggedOut: (a, o) => outs.push([o.key, o.r.status, o.sess, o.series, o.relogin]), nap: async () => {} }
	const a = new Actor(run, { kind: 'editor', idx: 1, rng: rngFor(1, 1), label: 'editor-01', uid: 'load01' })
	let login = 401
	a.http = { requestToken: '', login: async () => { if (login !== 200) throw new Error(`Login load01: ${login} {}`); a.http.requestToken = 't' }, snapshot: async () => ({ status: 401, ms: 2, text: '' }) }
	a.loggedOut = { at: 1, sess: 1 }
	await assert.rejects(a.join())
	await assert.rejects(a.join())
	login = 503
	await assert.rejects(a.join())
	assert.deepEqual(recs, [['login', 401], ['login', 401], ['login', 503]], 'the real status, never "error"')
	assert.deepEqual(outs, [['login', 401, 2, 1, true]], 'the first 401 of the attempt series only')
	// another series (session 2 died): the 401 of the new session's snapshot
	a.sess = 2
	login = 200
	await assert.rejects(a.join(), /Beitritt 401/)
	assert.deepEqual(outs[1], ['snapshot', 401, 3, 2, true])
	// the first join of a run is no re-login: a 401 there is a harness error, not a logout
	a.loggedOut = null
	a.http.requestToken = ''
	await assert.rejects(a.join())
	assert.equal(outs.length, 2)
})

test('p2e-5 (review finding 5): SF – a failing K check is the check\'s error; the fault report is still written', { timeout: 90000 }, async (t) => {
	const { FaultInjector } = await import('../load/lib/faults.mjs')
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const env = envFor(fake.port, { containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' } })
	const stack = { occ: async () => '', redisDel: async () => [], redisScan: async () => [], redis: async () => '1', rotateEpoch: async () => ({ before: 'a', after: 'b' }) }
	const faults = new FaultInjector(env, stack, { docker: async () => ({ ok: true, out: '', err: '' }), sleep: async () => {} })
	const rep = await runScenario({ env, scenario: 'SF', seed: 5, secs: 10, warmupS: 0.5, scale: 0.1, board: BOARD, deps: { faults, changes: async () => { throw new Error('Änderungslog weg') } } })
	assert.equal(rep.error, undefined, rep.error)
	assert.match(rep.checks.error, /^K-Prüfung: Änderungslog weg/)
	assert.equal(rep.checks.ok, false)
	assert.equal(rep.faults.played.length, 9, 'the fault report is there')
	assert.equal(typeof rep.faults.fiveXxOutside, 'number')
	assert.notEqual(rep.gate.rules.find((r) => r.rule === 1).ok, true)
})
