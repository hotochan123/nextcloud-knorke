/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Harness self-test without a stack (round 2): which env.json the contract
 * suite and the convergence run accept (lib/env.mjs loadEnv), what the
 * Stack knows about 4-byte text, and how report.mjs counts skipped cases.
 * SPEC-M1 §8.6: the convergence run accepts every KD_DB kind (loadEnv with
 * anyDb, dev/sim/run.sh without require_pgsql); the default loadEnv() stays
 * pgsql-only for callers that need psql. The Redis key patterns follow the
 * epoch prefix of SPEC-M1 §5.1. run() survives a child that exits before
 * reading stdin (no uncaught EPIPE; the result is the child's).
 * Works in throwaway namespaces "simtesta"/"simtestb" (dev/.state/<ns>/ and
 * dev/sim/out/<ns>/ are removed afterwards).
 *
 * Run: node --test 'dev/sim/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, Stack, ROOT, SIM_DIR, rkey, rkeyIn, epochOfKey, run } from './lib/env.mjs'
import { Suite } from './lib/report.mjs'

const NS = 'simtesta'
const STATE = path.join(ROOT, 'dev', '.state', NS)

function writeEnv(over) {
	const env = {
		ns: NS,
		ncIp: '10.255.0.2',
		gatewayIp: '10.255.0.1',
		containers: { nc: `knorke-dev-${NS}-nc`, db: `knorke-dev-${NS}-db`, redis: `knorke-dev-${NS}-redis` },
		...over,
	}
	fs.mkdirSync(STATE, { recursive: true, mode: 0o700 })
	fs.writeFileSync(path.join(STATE, 'env.json'), JSON.stringify(env))
	return env
}

test('loadEnv: pgsql by default, every kind with anyDb, sqlite without a db container', async (t) => {
	assert.ok(!fs.existsSync(STATE), `${STATE} exists – another run of this test? remove it first`)
	t.after(() => fs.rmSync(STATE, { recursive: true, force: true }))

	writeEnv({})
	assert.equal(new Stack(loadEnv(NS)).kind, 'pgsql', 'env.json without db.kind (pre-round-2 stack) = pgsql')

	writeEnv({ db: { kind: 'mariadb', utf8mb4: false } })
	assert.throws(() => loadEnv(NS), /braucht KD_DB=pgsql/, 'the default loadEnv() (psql callers) refuses mariadb')
	const m = new Stack(loadEnv(NS, { anyDb: true }))
	assert.equal(m.kind, 'mariadb')
	assert.equal(m.supports4Byte, false, 'mariadb with utf8mb4 false has no 4-byte text')
	writeEnv({ db: { kind: 'mysql', utf8mb4: true } })
	assert.equal(new Stack(loadEnv(NS, { anyDb: true })).supports4Byte, true, 'mysql with utf8mb4 keeps 4-byte text')

	writeEnv({ db: { kind: 'sqlite' }, containers: { nc: `knorke-dev-${NS}-nc`, db: null, redis: `knorke-dev-${NS}-redis` } })
	const s = new Stack(loadEnv(NS, { anyDb: true }))
	assert.equal(s.kind, 'sqlite')
	assert.equal(s.supports4Byte, true)
	await assert.rejects(() => s.psql('SELECT 1'), /nur mit KD_DB=pgsql/, 'psql refuses sqlite before any docker call')

	writeEnv({ db: { kind: 'sqlite' } })
	assert.throws(() => loadEnv(NS, { anyDb: true }), /containers\.db/, 'sqlite with a db container name is refused')
	writeEnv({ db: { kind: 'oracle' } })
	assert.throws(() => loadEnv(NS, { anyDb: true }), /unbekannt/, 'unknown kind is refused')
	writeEnv({ containers: { nc: 'nextcloud-nextcloud-1', db: `knorke-dev-${NS}-db`, redis: `knorke-dev-${NS}-redis` } })
	assert.throws(() => loadEnv(NS, { anyDb: true }), /containers\.nc/, 'a container outside the namespace is refused')
})

test('Suite: skipped cases are counted on their own and never change the exit code', async (t) => {
	const ns = 'simtestb'
	const dir = path.join(SIM_DIR, 'out', ns)
	assert.ok(!fs.existsSync(dir), `${dir} exists – remove it first`)
	const before = process.env.KD_NS
	process.env.KD_NS = ns
	const log = console.log
	t.after(() => {
		console.log = log
		if (before === undefined) delete process.env.KD_NS
		else process.env.KD_NS = before
		fs.rmSync(dir, { recursive: true, force: true })
	})
	console.log = () => {}
	const suite = new Suite('selftest')
	await suite.run('X01', 'grün', async (c) => { c.check(true, 'eins') })
	suite.skip('X02', 'nicht hier', 'braucht pgsql')
	assert.deepEqual([suite.summary().green, suite.summary().red, suite.summary().skipped], [1, 0, 1])
	assert.equal(suite.finish(), 0, 'green + skipped → exit 0')
	const md = fs.readFileSync(path.join(dir, 'selftest.md'), 'utf8')
	assert.match(md, /1 ok \/ 0 fehlgeschlagen \/ 1 übersprungen/)
	assert.match(md, /\| X02 \| nicht hier \| übersprungen \| braucht pgsql \|/)
	const json = JSON.parse(fs.readFileSync(path.join(dir, 'selftest.json'), 'utf8'))
	assert.equal(json.skipped, 1)
	assert.equal(json.cases.find((c) => c.id === 'X02').skipped, 'braucht pgsql')

	const red = new Suite('selftest')
	await red.run('X03', 'rot', async (c) => { c.check(false, 'zwei') })
	red.skip('X04', 'nicht hier', 'braucht pgsql')
	assert.equal(red.finish(), 1, 'a red case still fails the run')
})

test('converge runs on every KD_DB kind (SPEC-M1 §8.6): loadEnv with anyDb, run.sh without require_pgsql', () => {
	const conv = fs.readFileSync(path.join(SIM_DIR, 'converge.mjs'), 'utf8')
	assert.match(conv, /loadEnv\(undefined, \{ anyDb: true \}\)/, 'converge.mjs loads any kind')
	assert.match(conv, /stack\.changesJson\(board\)/, 'converge.mjs reads the log through the exact PHP reader')
	assert.doesNotMatch(conv, /stack\.changes\(board\)/, 'not through the tab-separated client output')
	assert.match(conv, /checkOps\(rows, batches, \{ fourByte: stack\.supports4Byte, purges, onPurged: /, 'the oracle knows about utf8mb3 and the purged ids (R19)')
	assert.match(conv, /onFolgen: \(x\) => \{ folgen\[x\.code\]\+\+ \}/, 'K3 counts the ops on purged ids whose code is the one of §4.13.7 "Folgen" (R20, K1)')
	// stage 4 (SPEC-M1 §8.6 R19, T4-14): the fault purge every 10 s in --faults full, through Stack.purgeTombstones(b, 0)
	assert.match(conv, /const PURGE_EVERY_MS = 10000/)
	assert.match(conv, /await stack\.purgeTombstones\(board, 0\)/)
	assert.match(conv, /if \(FAULTS === 'full' && Date\.now\(\) >= nextPurge && Date\.now\(\) < tEnd\)/, 'only in --faults full')
	assert.match(conv, /purges\.some\(\(p\) => p\.minRev > p\.minRevBefore\)/, 'K0: at least one purge with a risen min_rev')
	assert.match(conv, /stack\.kind === 'sqlite' \? '45' : '30'/, 'SQLite: --secs defaults to 45')
	assert.match(conv, /okOps >= 50/, 'K0 still wants ≥ 50 ok ops')
	const run = fs.readFileSync(path.join(SIM_DIR, 'run.sh'), 'utf8')
	assert.doesNotMatch(run, /^[^#]*require_pgsql/m, 'dev/sim/run.sh refuses no kind')
	for (const k of ['mariadb', 'mysql', 'sqlite']) {
		const env = k === 'sqlite'
			? { db: { kind: k }, containers: { nc: `knorke-dev-${NS}-nc`, db: null, redis: `knorke-dev-${NS}-redis` } }
			: { db: { kind: k, utf8mb4: true } }
		writeEnv(env)
		assert.equal(new Stack(loadEnv(NS, { anyDb: true })).kind, k)
	}
	fs.rmSync(STATE, { recursive: true, force: true })
})

test('Redis key patterns carry the epoch segment (SPEC-M1 §5.1)', () => {
	assert.equal(rkey('r:7'), '*/knorke/*/r:7')
	assert.equal(rkeyIn('k3x9a0b2', 'g:7:*'), '*/knorke/k3x9a0b2/g:7:*')
	assert.throws(() => rkeyIn('*', 'r:7'), /ungültig/, 'an epoch is never a glob')
	assert.equal(epochOfKey('a1b2c3/knorke/k3x9a0b2/r:7'), 'k3x9a0b2')
	assert.equal(epochOfKey('a1b2c3/knorke/r:7'), null, 'an M0 key has no epoch')
	// every sim/e2e/dev source uses the epoch form for board keys
	const files = ['converge.mjs', 'contract.mjs', 'lib/env.mjs'].map((f) => path.join(SIM_DIR, f))
		.concat([path.join(ROOT, 'dev/e2e/hostbridge.sh'), path.join(ROOT, 'dev/redis-keys.sh')])
	for (const f of files) {
		const src = fs.readFileSync(f, 'utf8')
		assert.doesNotMatch(src, /\*\/knorke\/(r|a|g|p|vt|w|wo|pwf):/, `${path.relative(ROOT, f)}: no M0 pattern */knorke/<key> left`)
	}
})

test('converge, SPEC-M1 §8.6 round 1a: M1 mix by default; keep at op time (R9) – no fence, the membership patches of transformItems follow the keep patch, K0 counts them', () => {
	const conv = fs.readFileSync(path.join(SIM_DIR, 'converge.mjs'), 'utf8')
	assert.match(conv, /const MIX = String\(opt\('mix', 'm1'\)\)/, '--mix defaults to m1')
	for (const fn of ['createShape()', 'createText()', 'transform(touched)', 'frameResize(touched)', 'badOp(touched)', 'membership(id, f, a, kept, touched)']) assert.ok(conv.includes(fn), `workload has ${fn}`)
	// the fence of round 1a, phase 1 is gone: a client places items into a frame, moves or deletes it while its keep patch waits
	assert.doesNotMatch(conv, /keepPending/, 'no keep fence (lib/oracle.mjs models keep in op order)')
	assert.match(conv, /pickItem\(touched, t = null, hot = true\) \{\n\t\tlet pool = this\.live\(t\)\.filter\(\(\[id\]\) => !touched\.has\(id\)\)/, 'pickItem excludes only the items of this act')
	// keep patch first, then the membership patches in the same act (the order of transformItems, §6.5.2)
	const fr = conv.slice(conv.indexOf('\tframeResize(touched) {'), conv.indexOf('\tmembership(id, f, a, kept, touched) {'))
	assert.match(fr, /op\.keep = true\n\t\t\tthis\.keepOps\.add\(op\)\n\t\t\}\n\t\tthis\.enqueue\(op\)\n\t\tconst n = this\.membership\(id, f, \{ x: p\.x, y: p\.y, w, h \}, op\.keep === true, touched\)/, 'frameResize: frame patch, then membership')
	assert.match(fr, /parent: id \} \}, id\)/, 'an extra adoption into the new box after a keep patch without membership')
	const mb = conv.slice(conv.indexOf('\tmembership(id, f, a, kept, touched) {'), conv.indexOf('\tmember(op, frame) {'))
	assert.match(mb, /const base = kept \? f : a/, 'with keep the children stay at the old frame position plus their relative one')
	assert.match(mb, /p: \{ x: round2\(ax\), y: round2\(ay\), parent: null \}/, 'release: absolute position, parent null')
	assert.match(mb, /p: \{ x: round2\(it\.x - a\.x\), y: round2\(it\.y - a\.y\), parent: id \}/, 'adoption relative to the NEW frame position')
	assert.match(conv, /'patch transform', 'patch keep'\]\.every/, 'K0 proves the M1 mix ran')
	assert.match(conv, /t\.check\(kt\.followed > 0, 'keep-patch, danach Übernahme oder Freigabe/, 'K0 proves the order of transformItems occurred')
})

test('converge, SPEC-M1 §8.6 round 1b: connectors are part of --mix m1 (--no-connectors turns them off) with the client release before the remove', () => {
	const conv = fs.readFileSync(path.join(SIM_DIR, 'converge.mjs'), 'utf8')
	assert.match(conv, /const CONNECTORS = MIX === 'm1' && !args\.includes\('--no-connectors'\)/, 'on by default with the M1 mix')
	assert.doesNotMatch(conv, /const CONNECTORS = args\.includes\('--connectors'\)/, 'no longer opt-in')
	for (const fn of ['createConnector()', 'retarget(touched)', 'connectorStyle(touched)', 'endpoint()', 'delBound(touched)', 'bindRemoved(touched)', 'keepConnector(touched)', 'releaseEnds(id, it, touched)']) assert.ok(conv.includes(fn), `workload has ${fn}`)
	assert.match(conv, /const a = mixAction\(x, CONNECTORS\)/, 'the M1 actions come from lib/workload.mjs')
	assert.match(conv, /the client's own release \(deleteItems v2\)[^\n]*\n\t\tif \(CONNECTORS && it\.t !== 'connector' && rnd\.chance\(0\.5\)\) this\.releaseEnds\(id, it, touched\)\n\t\tthis\.removeItem\(id, it\.t\)/, 'del: client release, then the remove')
	assert.match(conv, /this\.pickItem\(touched, CONNECTORS && rnd\.chance\(0\.1\) \? \['connector'\] : types, false\)/, 'del picks connectors now and then')
	// bindRemoved: the remove first, then the end onto the removed item in the same act (same batch)
	const br = conv.slice(conv.indexOf('\tbindRemoved(touched) {'), conv.indexOf('\tkeepConnector(touched) {'))
	assert.ok(br.indexOf('this.removeItem(id, it.t)') > 0 && br.indexOf('this.removeItem(id, it.t)') < br.indexOf("'bind-removed')"), 'remove before the end onto it')
	// keepConnector: both orders around the keep patch
	const kc = conv.slice(conv.indexOf('\tkeepConnector(touched) {'), conv.indexOf('\tdelRevive(touched, sameBatch'))
	assert.match(kc, /if \(removeFirst\) \{\n\t\t\tremoveE\(\)\n[\s\S]*?'keep-conn:bind-removed'\)\n\t\t\}\n\t\tthis\.tag\(keepOp, 'keep-conn:keep'\)\n\t\tif \(!removeFirst\) removeE\(\)/, 'remove before or after the keep patch; after a remove first, sometimes an end bound to the removed child before the keep')
	assert.match(kc, /keep: true \}/, 'the frame patch carries keep')
	// endpoint: tombstones of this and other clients, hot items for concurrent removes
	assert.match(conv, /for \(const id of r\.data\.removed \|\| \[\]\) if \(CONTENT\.includes\(this\.mirror\.items\.get\(id\)\?\.t\)\) this\.noteRemoved\(id\)\n\t\t\tthis\.mirror\.apply\(r\.data\)/, 'tombstones from sync answers, read before the mirror drops them')
	assert.match(conv, /if \(rnd\.chance\(0\.35\)\) pool = hotOf\(pool\)/, 'a third of the bound ends go to hot items')
	// K0 fails the run when a connector kind never happened
	for (const k of ['cs.ontoRemovedInBatch > 0', 'cs.ontoTombstone > 0 && cs.ontoTombstoneForeign > 0', 'cs.releasedDerived > 0', "tags.ops['client-release']", 'tags.keepConn.first > 0 && tags.keepConn.after > 0']) assert.ok(conv.includes(k), `K0 checks ${k}`)
})

test('lib/workload.mjs: M1_MIX keeps round 1a at 92 and adds 23 for connectors; mixAction leaves them out without connectors; hotOf = five smallest ids', async () => {
	const { M1_MIX, CONNECTOR_ACTIONS, mixAction, hotOf } = await import('./lib/workload.mjs')
	const sum = (rows) => rows.reduce((a, [w]) => a + w, 0)
	assert.equal(sum(M1_MIX.filter(([, , c]) => !c)), 92)
	assert.equal(sum(M1_MIX.filter(([, , c]) => c)), 23)
	assert.deepEqual([...CONNECTOR_ACTIONS], ['createConnector', 'retarget', 'connectorStyle', 'delBound', 'bindRemoved', 'keepConnector'])
	const count = (connectors) => {
		const n = {}
		for (let i = 0; i < 11500; i++) {
			const a = mixAction((i + 0.5) / 11500, connectors)
			n[a] = (n[a] || 0) + 1
		}
		return n
	}
	const off = count(false)
	assert.ok(CONNECTOR_ACTIONS.every((a) => !off[a]), 'no connector action without connectors')
	assert.equal(off.createSticky, Math.round(11500 * 12 / 92))
	const on = count(true)
	assert.equal(on.createConnector, 700, '7 of 115')
	assert.equal(on.keepConnector, 400, '4 of 115: both keep orders reach K0 in every run')
	assert.equal(Object.values(on).reduce((a, b) => a + b, 0), 11500)
	assert.equal(mixAction(0, true), 'createSticky')
	assert.equal(mixAction(0.999999, true), 'keepConnector')
	assert.equal(mixAction(0.999999, false), 'badOp')
	const pool = ['E', 'B', 'G', 'A', 'F', 'C', 'D'].map((id) => [id, {}])
	assert.deepEqual(hotOf(pool).map(([id]) => id), ['A', 'B', 'C', 'D', 'E'])
	assert.equal(pool[0][0], 'E', 'hotOf does not sort in place')
})

test('Stack.voteExpire (SPEC-M1 §8.4 R16): one transaction on the open session only, boards untouched, vt:<b> after the commit; no open session → throws, no DEL', async () => {
	const env = { ns: 'simtestv', db: { kind: 'pgsql' }, containers: { nc: 'knorke-dev-simtestv-nc', db: 'knorke-dev-simtestv-db', redis: 'knorke-dev-simtestv-redis' } }
	const s = new Stack(env)
	const sent = []
	const dels = []
	let rows = [['vs', '12', '1791833639521'], ['bd', '44', '40']]
	s.sql = async (sql) => { sent.push(sql); return rows }
	s.redisDel = async (...p) => { dels.push(p); return ['d38b/knorke/k3x9a0b2/vt:7'] }
	const t0 = Date.now()
	const r = await s.voteExpire(7)
	const lines = sent[0].split('\n')
	assert.equal(lines[0], 'BEGIN;')
	assert.equal(lines.at(-1), 'COMMIT;')
	const upd = lines.find((l) => l.startsWith('UPDATE'))
	const m = /^UPDATE oc_knorke_vote_sessions SET ends_at = (\d+) WHERE board_id = 7 AND state = 'open';$/.exec(upd)
	assert.ok(m, upd)
	assert.ok(Number(m[1]) === r.now - 1 && r.now >= t0, 'ends_at = now − 1 ms')
	assert.equal(lines.filter((l) => /^UPDATE/.test(l)).length, 1, 'boards (meta, rev, meta_rev) untouched')
	assert.ok(lines.some((l) => l.startsWith("SELECT 'bd', rev, meta_rev FROM oc_knorke_boards WHERE id = 7;")), 'rev/meta_rev read in the same transaction')
	assert.deepEqual(dels, [['*/knorke/*/vt:7']])
	assert.deepEqual({ sid: r.sid, endsAt: r.endsAt, rev: r.rev, metaRev: r.metaRev, keys: r.keys }, { sid: 12, endsAt: 1791833639521, rev: 44, metaRev: 40, keys: ['d38b/knorke/k3x9a0b2/vt:7'] })
	rows = [['bd', '44', '40']]
	dels.length = 0
	await assert.rejects(() => s.voteExpire(7), /keine offene Abstimmung/)
	assert.deepEqual(dels, [], 'no DEL without an open session')
	await assert.rejects(() => s.voteExpire('7; DROP TABLE x'), /Board-ID/)
})

test('run(): a child that exits without reading stdin – no uncaught EPIPE, the result comes from exit code and stderr', async () => {
	// 1 MiB is far above the 64 KiB pipe buffer: part of the write is still pending when the child exits
	const BIG = 'x'.repeat(1 << 20)
	for (let i = 0; i < 3; i++) {
		assert.deepEqual(await run('sh', ['-c', 'echo boom >&2; exit 3'], { input: BIG }), { ok: false, code: 3, out: '', err: 'boom\n' }, `exit 3, run ${i + 1}: only the child's stderr, no EPIPE text`)
	}
	assert.deepEqual(await run('sh', ['-c', 'exit 0'], { input: BIG }), { ok: true, code: 0, out: '', err: '' }, 'exit 0 without reading stdin is ok')
	assert.deepEqual(await run('cat', [], { input: 'SELECT 1;\n' }), { ok: true, code: 0, out: 'SELECT 1;\n', err: '' }, 'a child that reads stdin still gets all of it')
	// a late stdin error is still blamed on this case, not the next one
	await new Promise((r) => setImmediate(r))
})
