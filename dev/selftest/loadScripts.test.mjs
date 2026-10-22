/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The shell side of the load run (SPEC-M1 §8.1 R2, §8.7, §9.5 row 4.1), in
 * the sandbox of lib/sandbox.mjs (a throwaway copy of the dev scripts, a fake
 * docker first on PATH, here also a fake curl and a fake generator
 * dev/load/load.mjs) – no stack, no real container, prod only ever named:
 *
 * - dev/load/run.sh: arguments and knobs refused with exit 2 before any
 *   docker call; one load run at a time (flock on $KD_LOCK_DIR/load.lock);
 *   the start preflights (host load, prod containers inspectable and
 *   healthy, read with `docker inspect` only); the abort rule while the
 *   generator runs – the 1-min load above KD_LOAD_ABORT at 3 readings in a
 *   row (2 are not enough), a prod RestartCount that rises, a prod health
 *   other than healthy – SIGTERM to the generator, reason in its abort file,
 *   exit 3; the label, namespace and cpuset reach the generator
 * - dev/load/variant.sh: usage, not a load stack, lock held, app outside the
 *   prod set, wrong starting variant → exit 2; dbpersistent touches only the
 *   namespace's own containers (name and label) and records the variant
 * - dev/up.sh: the load switches (KD_LOAD_PROFILE, KD_APACHE_STATUS,
 *   KD_USERS, KD_PG_CPUS, KD_GEN_CPUSET) validated before anything; a whole
 *   up.sh against the fake docker: unset switches = the stack of before,
 *   set switches = cpuset on PostgreSQL, mod_status mounted but never
 *   published, firstrunwizard on, knorke_dev off after the setup, accounts
 *   load01 … in group workshop, env.json .load
 * The protected namespace try is covered for run.sh and variant.sh by
 * guard.test.mjs (every dev script).
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Sandbox, REPO } from './lib/sandbox.mjs'

const PLACEHOLDER = path.join(REPO, 'dev/selftest/placeholder')
const PROD = ['nextcloud-nextcloud-1', 'nextcloud-nextcloud-db-1', 'nextcloud-nextcloud-redis-1']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CPUS = os.availableParallelism ? os.availableParallelism() : os.cpus().length

const FAKE_CURL = `#!/usr/bin/env bash
# Fake curl of the load self-tests: status.php installed, the 401 probe, mod_status.
printf '%s\\n' "$*" >>"$KD_FAKE_DIR/curl.log"
case "$*" in
    *'%{http_code}'*) printf '401' ;;
    *server-status*) printf 'BusyWorkers: 1\\nIdleWorkers: 4\\nScoreboard: W____\\n' ;;
    *status.php*) printf '{"installed":true,"versionstring":"34.0.1"}' ;;
esac
exit 0
`

const FAKE_GEN = `// Fake generator of the load self-tests: logs its start, ends after KD_FAKE_GEN_MS,
// on SIGTERM logs the reason from --abort-file and exits 3 (with a reason) or 143.
import fs from 'node:fs'
const log = process.env.KD_FAKE_GEN_LOG
const i = process.argv.indexOf('--abort-file')
const abortFile = i >= 0 ? process.argv[i + 1] : null
fs.appendFileSync(log, 'START ' + JSON.stringify({ argv: process.argv.slice(2), ns: process.env.KD_NS, label: process.env.KD_RUN_LABEL || '' }) + '\\n')
process.on('SIGTERM', () => {
	let r = ''
	try { r = fs.readFileSync(abortFile, 'utf8').trim() } catch { /* none */ }
	fs.appendFileSync(log, 'TERM ' + r + '\\n')
	process.exit(r ? 3 : 143)
})
setTimeout(() => { fs.appendFileSync(log, 'END\\n'); process.exit(Number(process.env.KD_FAKE_GEN_RC || 0)) }, Number(process.env.KD_FAKE_GEN_MS || 3000))
`

/** A sandbox with fake curl, fake generator, the status conf and a loadavg file. */
function loadSandbox() {
	const sb = new Sandbox()
	fs.writeFileSync(path.join(sb.fake, 'curl'), FAKE_CURL, { mode: 0o755 })
	fs.mkdirSync(path.join(sb.dev, 'load'), { recursive: true })
	fs.writeFileSync(path.join(sb.dev, 'load', 'load.mjs'), FAKE_GEN)
	fs.copyFileSync(path.join(REPO, 'dev/load/knorke-status.conf'), path.join(sb.dev, 'load', 'knorke-status.conf'))
	sb.loadavg = path.join(sb.root, 'loadavg')
	sb.genLog = path.join(sb.root, 'gen.log')
	setLoad(sb, '1.00')
	return sb
}
const setLoad = (sb, one) => fs.writeFileSync(sb.loadavg, `${one} 1.00 1.00 2/300 12345\n`)
const genLog = (sb) => (fs.existsSync(sb.genLog) ? fs.readFileSync(sb.genLog, 'utf8') : '')

/** Rewrites the fake docker's rule table WITHOUT clearing the call log (mid-run changes). */
function writeRules(sb, list) {
	const US = '\x1f'
	const enc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
	fs.writeFileSync(path.join(sb.fake, 'docker.rules'), list.map(([c, g, o = '', e = '']) => [String(c), g, enc(o), enc(e)].join(US)).join('\n') + '\n')
}

const prodRules = (state = {}) => PROD.map((c) => {
	const s = state[c] === undefined ? '0 healthy' : state[c]
	return s === null ? [1, `inspect -f {{.RestartCount}}* ${c}`, '', 'Error: No such object\n'] : [0, `inspect -f {{.RestartCount}}* ${c}`, s + '\n']
})
const runRules = (state) => [...prodRules(state), [0, 'container inspect -f {{.State.Running}} knorke-dev-dzload-*', 'true\n'], [0, 'exec *', '']]
const loadEnvJson = (sb, extra = {}) => sb.writeEnv('dzload', {
	ns: 'dzload', appDir: sb.root, containers: { nc: 'knorke-dev-dzload-nc', db: 'knorke-dev-dzload-db', redis: 'knorke-dev-dzload-redis' },
	db: { kind: 'pgsql' }, load: { variant: 'base', genCpuset: null }, ...extra,
})
const runEnv = (sb, extra = {}) => ({ KD_NS: 'dzload', KD_LOAD_AVG_FILE: sb.loadavg, KD_LOAD_WATCH_SECS: '0.2', KD_GEN_CPUSET: '', KD_FAKE_GEN_LOG: sb.genLog, ...extra })
const onlyReadsProd = (calls) => calls.filter((c) => /nextcloud-nextcloud/.test(c)).every((c) => /^inspect -f \{\{\.RestartCount\}\} \S.* nextcloud-nextcloud-(1|db-1|redis-1)$/.test(c))

/**
 * run.sh in the background; resolves {status, stderr, ms}. `during({waitFor})`
 * runs once the fake generator started; waitFor(re) resolves true as soon as
 * run.sh's stderr matches (false after 10 s), so a test can react to a
 * reading of the watchdog instead of guessing its timing.
 */
function runLoad(sb, args, env, during = null) {
	return new Promise((resolve) => {
		const t0 = Date.now()
		const p = spawn('bash', [path.join(sb.dev, 'load/run.sh'), ...args], { env: sb.env(env) })
		let stderr = ''
		let waiters = []
		const check = () => { waiters = waiters.filter((w) => { if (!w.re.test(stderr)) return true; w.resolve(true); return false }) }
		p.stdout.on('data', () => {})
		p.stderr.on('data', (c) => { stderr += c; check() })
		const timer = setTimeout(() => p.kill('SIGKILL'), 30000)
		p.on('close', (status) => { clearTimeout(timer); resolve({ status, stderr, ms: Date.now() - t0 }) })
		const waitFor = (re, ms = 10000) => new Promise((res) => { waiters.push({ re, resolve: res }); check(); setTimeout(() => res(false), ms) })
		if (during) {
			(async () => {
				const tw = Date.now()
				while (!genLog(sb).includes('START') && Date.now() - tw < 15000) await sleep(50)
				await during({ waitFor })
			})()
		}
	})
}

// --- dev/load/run.sh ---------------------------------------------------------------

test('run.sh refuses bad arguments and knobs with exit 2 before any docker call and before the lock', (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	const cases = [
		[[], {}, /usage: KD_NS=<ns> dev\/load\/run\.sh <S1\|S4\|S4e\|S4d\|S5\|SF\|SC\|--check>/],
		[['S9'], {}, /bekommen: 'S9'/],
		[['--check', 'x'], {}, /--check nimmt keine weiteren Argumente/],
		[['S4'], { KD_RUN_LABEL: 'R1' }, /KD_RUN_LABEL 'R1' ist ungültig/],
		[['S4'], { KD_RUN_LABEL: 'a'.repeat(25) }, /KD_RUN_LABEL/],
		[['S4'], { KD_LOAD_ABORT: 'x' }, /KD_LOAD_ABORT 'x' ist ungültig/],
		[['S4'], { KD_LOAD_ABORT: '0' }, /KD_LOAD_ABORT '0' ist ungültig/],
		[['S4'], { KD_LOAD_WATCH_SECS: '0' }, /KD_LOAD_WATCH_SECS '0' ist ungültig/],
		[['S4'], { KD_LOAD_WATCH_SECS: '61' }, /KD_LOAD_WATCH_SECS/],
		[['S4'], { KD_GEN_CPUSET: 'x' }, /KD_GEN_CPUSET 'x' ist ungültig/],
		[['S4'], { KD_GEN_CPUSET: '0-999' }, /KD_GEN_CPUSET '0-999' ist ungültig/],
	]
	for (const [args, extra, re] of cases) {
		sb.rules(runRules())
		const r = sb.run('load/run.sh', args, runEnv(sb, extra))
		assert.equal(r.status, 2, `${JSON.stringify([args, extra])}: ${r.stderr}`)
		assert.match(r.stderr, re)
		assert.deepEqual(sb.calls(), [], 'no docker call')
		assert.equal(fs.existsSync(path.join(sb.lockDir, 'load.lock')), false, 'refused before the lock')
	}
	assert.equal(genLog(sb), '', 'the generator never started')
})

test('run.sh: one load run at a time – a held load.lock refuses with exit 2, before any docker call', async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	fs.mkdirSync(sb.lockDir, { recursive: true })
	const holder = spawn('flock', ['-x', '-o', path.join(sb.lockDir, 'load.lock'), 'sleep', '20'], { stdio: 'ignore', detached: true })
	const release = () => { try { process.kill(-holder.pid, 'SIGKILL') } catch { /* gone */ } }
	t.after(release)
	await sleep(300)
	sb.rules(runRules())
	const r = await sb.runAsync('load/run.sh', ['S4'], runEnv(sb))
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /VERWEIGERT: ein anderer Lastlauf hält .*load\.lock – immer nur einer auf diesem Host/)
	assert.deepEqual(sb.calls(), [])
	release()
	await sleep(300)
	sb.rules(runRules())
	const ok = await sb.runAsync('load/run.sh', ['--check'], runEnv(sb))
	assert.equal(ok.status, 0, ok.stderr)
	assert.match(ok.stderr, /bereit: Sperre .*load\.lock, Stack dzload/)
})

test('run.sh --check: prod read with docker inspect only; unhealthy, missing prod or a busy host refuse with exit 2', (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	sb.rules(runRules())
	let r = sb.run('load/run.sh', ['--check'], runEnv(sb))
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /Start: 1-min-Last 1\.00 \(Abbruch über 20 bei 3 Messungen in Folge\), Prod: nextcloud-nextcloud-1 rc=0 nextcloud-nextcloud-db-1 rc=0 nextcloud-nextcloud-redis-1 rc=0/)
	assert.deepEqual(sb.calls().filter((c) => /nextcloud-nextcloud/.test(c)).map((c) => c.split(' ').pop()), PROD, 'all three prod containers, nothing else of prod')
	assert.ok(onlyReadsProd(sb.calls()), sb.calls().join('\n'))
	for (const [state, re] of [
		[{ 'nextcloud-nextcloud-db-1': '0 unhealthy' }, /nextcloud-nextcloud-db-1 ist 'unhealthy' – kein Lastlauf/],
		[{ 'nextcloud-nextcloud-1': '0 starting' }, /nextcloud-nextcloud-1 ist 'starting'/],
		[{ 'nextcloud-nextcloud-redis-1': null }, /nextcloud-nextcloud-redis-1 antwortet nicht auf docker inspect/],
	]) {
		sb.rules(runRules(state))
		r = sb.run('load/run.sh', ['--check'], runEnv(sb))
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, re)
		assert.ok(onlyReadsProd(sb.calls()))
	}
	sb.rules(runRules({ 'nextcloud-nextcloud-1': '0 none' }))
	assert.equal(sb.run('load/run.sh', ['--check'], runEnv(sb)).status, 0, 'a container without healthcheck counts by its RestartCount only')
	setLoad(sb, '20.50')
	sb.rules(runRules())
	r = sb.run('load/run.sh', ['--check'], runEnv(sb))
	assert.equal(r.status, 2)
	assert.match(r.stderr, /1-min-Last 20\.50 liegt schon über KD_LOAD_ABORT=20/)
	r = sb.run('load/run.sh', ['--check'], runEnv(sb, { KD_LOAD_ABORT: '25' }))
	assert.equal(r.status, 0, 'KD_LOAD_ABORT is the threshold')
	setLoad(sb, '1.00')
	r = sb.run('load/run.sh', ['--check'], runEnv(sb, { KD_NS: 'dznone' }))
	assert.equal(r.status, 2)
	assert.match(r.stderr, /dev\/\.state\/dznone\/env\.json fehlt/)
})

test('run.sh abort rule: 3 readings above KD_LOAD_ABORT in a row stop the generator (SIGTERM, reason, exit 3)', { timeout: 40000 }, async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	sb.rules(runRules())
	const r = await runLoad(sb, ['S4', '--seed', '5'], runEnv(sb, { KD_FAKE_GEN_MS: '20000' }), async () => { setLoad(sb, '25.00') })
	assert.equal(r.status, 3, r.stderr)
	assert.match(r.stderr, /1-min-Last 25\.00 über 20 \(1 von 3 in Folge\)[\s\S]*\(2 von 3 in Folge\)[\s\S]*\(3 von 3 in Folge\)/)
	assert.match(r.stderr, /ABBRUCHREGEL: 1-min-Last des Hosts über 20 bei 3 Messungen in Folge \(zuletzt 25\.00\)/)
	assert.match(genLog(sb), /^TERM 1-min-Last des Hosts über 20 bei 3 Messungen in Folge \(zuletzt 25\.00\)$/m, 'the generator got SIGTERM and read the reason')
	assert.ok(r.ms < 15000, `stopped long before the generator's 20 s (${r.ms} ms)`)
	assert.ok(onlyReadsProd(sb.calls()))
	const start = JSON.parse(genLog(sb).match(/^START (.*)$/m)[1])
	assert.deepEqual(start.argv.slice(0, 2), ['--scenario', 'S4'])
	assert.ok(start.argv.includes('--abort-file') && start.argv.includes('--seed'), 'abort file and the flags reach the generator')
})

test('run.sh abort rule: 2 readings above in a row do not abort, the count starts again', { timeout: 40000 }, async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	sb.rules(runRules())
	let saw2 = null
	let again = null
	const r = await runLoad(sb, ['S1'], runEnv(sb, { KD_LOAD_WATCH_SECS: '0.3', KD_FAKE_GEN_MS: '4000' }), async ({ waitFor }) => {
		setLoad(sb, '25.00')
		saw2 = await waitFor(/\(2 von 3 in Folge\)/)
		setLoad(sb, '1.00')
		await sleep(700)
		setLoad(sb, '21.00')
		again = await waitFor(/1-min-Last 21\.00 über 20 \(1 von 3 in Folge\)/)
		setLoad(sb, '1.00')
	})
	assert.equal(saw2, true, 'exactly two readings above were seen …')
	assert.equal(again, true, '… and after a reading below the count started at 1 again')
	assert.equal(r.status, 0, r.stderr)
	assert.doesNotMatch(r.stderr, /3 von 3|ABBRUCHREGEL/)
	assert.match(genLog(sb), /^END$/m, 'the generator ran to its end')
})

test('run.sh abort rule: a prod RestartCount that rises or a prod health ≠ healthy aborts with exit 3', { timeout: 60000 }, async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	for (const [state, re] of [
		[{ 'nextcloud-nextcloud-db-1': '1 healthy' }, /Prod-Container nextcloud-nextcloud-db-1: RestartCount 0 → 1/],
		[{ 'nextcloud-nextcloud-1': '0 unhealthy' }, /Prod-Container nextcloud-nextcloud-1 ist unhealthy/],
		[{ 'nextcloud-nextcloud-redis-1': null }, /Prod-Container nextcloud-nextcloud-redis-1 antwortet nicht auf docker inspect/],
	]) {
		fs.rmSync(sb.genLog, { force: true })
		sb.rules(runRules())
		const r = await runLoad(sb, ['S4'], runEnv(sb, { KD_FAKE_GEN_MS: '20000' }), async () => { writeRules(sb, runRules(state)) })
		assert.equal(r.status, 3, r.stderr)
		assert.match(r.stderr, new RegExp('ABBRUCHREGEL: ' + re.source))
		assert.match(genLog(sb), new RegExp('^TERM ' + re.source, 'm'))
		assert.ok(onlyReadsProd(sb.calls()), 'prod only read')
	}
})

test('run.sh passes namespace, label and cpuset to the generator; the generator\'s exit code is the run\'s', { timeout: 40000 }, async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	loadEnvJson(sb)
	sb.rules(runRules())
	let r = await runLoad(sb, ['S4d'], runEnv(sb, { KD_GEN_CPUSET: '0', KD_RUN_LABEL: 'r1w3', KD_FAKE_GEN_MS: '300' }))
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /Generator: taskset -c 0 node .*\/dev\/load\/load\.mjs --scenario S4d --abort-file .*\/dev\/\.state\/dzload\/load-abort\.txt \(Kennzeichen r1w3\)/)
	const start = JSON.parse(genLog(sb).match(/^START (.*)$/m)[1])
	assert.equal(start.ns, 'dzload')
	assert.equal(start.label, 'r1w3')
	assert.ok(fs.existsSync(path.join(sb.lockDir, 'load.lock')), 'the lock lives in KD_LOCK_DIR, outside the repo copy')
	sb.rules(runRules())
	r = await runLoad(sb, ['S4'], runEnv(sb, { KD_FAKE_GEN_MS: '200', KD_FAKE_GEN_RC: '1' }))
	assert.equal(r.status, 1, 'a red gate stays red')
	assert.match(r.stderr, /KD_GEN_CPUSET leer – der Generator läuft ohne CPU-Bindung/)
})

// --- dev/load/variant.sh -------------------------------------------------------------

const varEnv = (sb, load = { variant: 'base', prodApps: ['admincockpit', 'spreed'], apacheStatus: true }) => sb.writeEnv('dzvar', {
	ns: 'dzvar', appDir: sb.root, port: 18609, containers: { nc: 'knorke-dev-dzvar-nc', db: 'knorke-dev-dzvar-db', redis: 'knorke-dev-dzvar-redis' },
	networks: { front: 'knorke-dev-dzvar-net', back: 'knorke-dev-dzvar-back' }, db: { kind: 'pgsql' }, ncIp: '172.30.0.2', ...(load ? { load } : {}),
})
const varRules = (label = 'dev-dzvar') => [
	[0, 'container inspect -f {{.State.Running}} knorke-dev-dzvar-*', 'true\n'],
	[0, 'container inspect -f {{index .Config.Labels "knorke"}} knorke-dev-dzvar-*', label + '\n'],
	[0, 'container inspect -f {{(index .NetworkSettings.Networks *', '172.30.0.9\n'],
	[0, 'port knorke-dev-dzvar-nc 80/tcp', '127.0.0.1:18609\n'],
	[0, 'exec * psql * SHOW max_connections', '200\n'],
	[0, 'exec *', ''],
	[0, 'restart knorke-dev-dzvar-*', ''],
]

test('variant.sh refusals: usage, not a load stack, load run active, app outside the prod set, wrong starting variant', async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	const env = varEnv(sb)
	for (const args of [[], ['bogus'], ['app-off'], ['app-off', 'Bad-Id'], ['base', 'x'], ['dbpersistent', 'x']]) {
		sb.rules(varRules())
		const r = sb.run('load/variant.sh', args, { KD_NS: 'dzvar' })
		assert.equal(r.status, 2, `${args}: ${r.stderr}`)
		assert.deepEqual(sb.calls(), [])
	}
	sb.rules(varRules())
	let r = sb.run('load/variant.sh', ['status'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, 'base\n')
	assert.deepEqual(sb.calls(), [], 'status only reads env.json')
	varEnv(sb, null)
	r = sb.run('load/variant.sh', ['dbpersistent'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /kein Lastlauf-Stack \(env\.json \.load fehlt\)/)
	assert.deepEqual(sb.calls(), [])
	varEnv(sb)
	fs.mkdirSync(sb.lockDir, { recursive: true })
	const holder = spawn('flock', ['-x', '-o', path.join(sb.lockDir, 'load.lock'), 'sleep', '20'], { stdio: 'ignore', detached: true })
	t.after(() => { try { process.kill(-holder.pid, 'SIGKILL') } catch { /* gone */ } })
	await sleep(300)
	r = await sb.runAsync('load/variant.sh', ['base'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /ein Lastlauf hält .*load\.lock – Variante erst nach dem Lauf wechseln/)
	assert.deepEqual(sb.calls(), [])
	try { process.kill(-holder.pid, 'SIGKILL') } catch { /* gone */ }
	await sleep(300)
	sb.rules(varRules())
	r = sb.run('load/variant.sh', ['app-off', 'pulse'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /'pulse' gehört nicht zum Prod-App-Satz dieses Stacks \(env\.json \.load\.prodApps: admincockpit spreed\)/)
	assert.deepEqual(sb.calls().filter((c) => !c.startsWith('container inspect')), [], 'nothing changed')
	sb.writeEnv('dzvar', { ...JSON.parse(fs.readFileSync(env, 'utf8')), load: { variant: 'app-off-spreed', prodApps: ['admincockpit', 'spreed'] } })
	sb.rules(varRules())
	r = sb.run('load/variant.sh', ['dbpersistent'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /aktive Variante ist app-off-spreed – erst KD_NS=dzvar dev\/load\/variant\.sh base/)
})

test('variant.sh dbpersistent: only the namespace\'s own containers (name and label), variant recorded; a foreign label stops it', (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	const env = varEnv(sb)
	sb.rules(varRules())
	let r = sb.run('load/variant.sh', ['dbpersistent'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 0, r.stderr)
	const calls = sb.calls()
	assert.ok(calls.every((c) => /knorke-dev-dzvar-/.test(c)), `every docker call names an own container:\n${calls.join('\n')}`)
	for (const want of [
		'exec -u www-data knorke-dev-dzvar-nc php occ config:system:set dbpersistent --value=true --type=boolean',
		'exec knorke-dev-dzvar-db psql -U nextcloud -d nextcloud -qc ALTER SYSTEM SET max_connections = 200',
		'restart knorke-dev-dzvar-db',
		'restart knorke-dev-dzvar-nc',
	]) assert.ok(calls.includes(want), `${want}\n${calls.join('\n')}`)
	assert.ok(calls.indexOf('restart knorke-dev-dzvar-db') < calls.indexOf('restart knorke-dev-dzvar-nc'))
	const e = JSON.parse(fs.readFileSync(env, 'utf8'))
	assert.equal(e.load.variant, 'dbpersistent')
	assert.equal(e.ncIp, '172.30.0.9', 'the container IP after the restart')
	assert.equal(e.load.statusUrl, 'http://172.30.0.9:8081/server-status?auto')
	assert.equal(fs.statSync(env).mode & 0o777, 0o600)
	// back to base
	sb.rules(varRules())
	r = sb.run('load/variant.sh', ['base'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 0, r.stderr)
	for (const want of ['exec -u www-data knorke-dev-dzvar-nc php occ config:system:delete dbpersistent', 'exec knorke-dev-dzvar-db psql -U nextcloud -d nextcloud -qc ALTER SYSTEM RESET max_connections',
		'exec -u www-data knorke-dev-dzvar-nc php occ app:enable admincockpit', 'exec -u www-data knorke-dev-dzvar-nc php occ app:enable spreed']) {
		assert.ok(sb.calls().includes(want), want)
	}
	assert.equal(JSON.parse(fs.readFileSync(env, 'utf8')).load.variant, 'base')
	// a container of the right name but a foreign label: stop before any restart
	sb.rules(varRules('dev-other'))
	r = sb.run('load/variant.sh', ['dbpersistent'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /interner Schutz: knorke-dev-dzvar-db trägt nicht das Label knorke=dev-dzvar/)
	assert.ok(!sb.calls().some((c) => c.startsWith('restart')), 'no restart')
	// app-off from base
	sb.rules(varRules())
	r = sb.run('load/variant.sh', ['app-off', 'admincockpit'], { KD_NS: 'dzvar' })
	assert.equal(r.status, 0, r.stderr)
	assert.ok(sb.calls().includes('exec -u www-data knorke-dev-dzvar-nc php occ app:disable admincockpit'))
	assert.equal(JSON.parse(fs.readFileSync(env, 'utf8')).load.variant, 'app-off-admincockpit')
})

// --- dev/up.sh load switches ------------------------------------------------------------

test('up.sh validates the load switches before anything else (exit 1, no docker call, no state)', (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	fs.rmSync(path.join(sb.dev, 'load', 'knorke-status.conf'))
	const cases = [
		[{ KD_LOAD_PROFILE: 'dev' }, /KD_LOAD_PROFILE='dev' ist ungültig \(leer oder prod\)/],
		[{ KD_APACHE_STATUS: '2' }, /KD_APACHE_STATUS='2' ist ungültig \(0 oder 1\)/],
		[{ KD_APACHE_STATUS: '1' }, /dev\/load\/knorke-status\.conf fehlt \(KD_APACHE_STATUS=1\)/],
		[{ KD_USERS: '100' }, /KD_USERS='100' ist ungültig \(0–99/],
		[{ KD_USERS: 'x' }, /KD_USERS='x' ist ungültig/],
		[{ KD_USERS: '-1' }, /KD_USERS='-1' ist ungültig/],
		[{ KD_PG_CPUS: 'x' }, /KD_PG_CPUS='x' ist ungültig/],
		[{ KD_PG_CPUS: '3-1' }, /KD_PG_CPUS='3-1' ist ungültig/],
		[{ KD_PG_CPUS: '0-999' }, /KD_PG_CPUS='0-999' ist ungültig/],
		[{ KD_GEN_CPUSET: '1,x' }, /KD_GEN_CPUSET='1,x' ist ungültig/],
		[{ KD_PG_CPUS: '0', KD_GEN_CPUSET: '0' }, /KD_PG_CPUS \(0\) und KD_GEN_CPUSET \(0\) überschneiden sich/],
		[{ KD_PG_CPUS: '0', KD_DB: 'sqlite' }, /KD_PG_CPUS gilt nur für KD_DB=pgsql \(hier sqlite\)/],
	]
	for (const [extra, re] of cases) {
		sb.rules([])
		const r = sb.run('up.sh', [], { KD_NS: 'dzupv', KD_PORT: '18609', KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1', ...extra })
		assert.equal(r.status, 1, `${JSON.stringify(extra)}: ${r.stderr}`)
		assert.match(r.stderr, re)
		assert.deepEqual(sb.calls(), [], 'no docker call')
	}
	assert.equal(fs.existsSync(path.join(sb.dev, '.state', 'dzupv')), false)
	assert.equal(fs.existsSync(sb.lockDir), false, 'refused before the stack lock')
})

/** Fake docker answers for a whole up.sh (pgsql) – nothing reaches a daemon. */
const upRules = () => [
	[0, 'network inspect -f {{.Internal}} *', 'true\n'],
	[0, 'network inspect -f {{range .IPAM.Config}}*', '172.30.0.1 \n'],
	[1, 'network inspect *', '', 'Error: No such network\n'],
	[0, 'container inspect -f {{.State.Running}} *', 'true\n'],
	[0, 'container inspect -f {{(index .NetworkSettings.Networks *', '172.30.0.5\n'],
	[1, 'container inspect *', '', 'Error: No such container\n'],
	[0, 'ps -aq --filter label=*', ''],
	[0, 'network ls -q --filter label=*', ''],
	[0, 'network ls --format *', ''],
	[0, 'network create *', 'n\n'],
	[0, 'network connect *', ''],
	[0, 'run -d *', 'c\n'],
	[0, 'create *', 'c\n'],
	[0, 'start *', ''],
	[0, 'restart *', ''],
	[0, 'exec * pg_isready *', ''],
	[0, 'exec -u www-data * php occ config:system:get memcache.distributed', '\\OC\\Memcache\\Redis\n'],
	[0, 'exec -u www-data * php occ config:system:get redis password', 'x\n'],
	[0, 'exec -u www-data * php occ status --output=json', '{"versionstring":"34.0.1"}\n'],
	[0, 'exec -u www-data * php occ app:list --output=json', '{"enabled":{"knorke":"0.2.0"}}\n'],
	[0, 'exec * psql * SHOW server_version', '17.6\n'],
	[0, 'exec * php -r echo PHP_VERSION;', '8.3.26\n'],
	[0, 'exec * redis-server --version', 'Redis server v=7.4.1 sha=0\n'],
	[0, 'exec *', ''],
]
const upRun = (sb, ns, extra = {}) => {
	sb.rules(upRules())
	fs.rmSync(path.join(sb.fake, 'curl.log'), { force: true })
	return sb.run('up.sh', [], { KD_NS: ns, KD_PORT: '18609', KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1', ...extra }, { timeout: 60000 })
}
const occCalls = (calls) => calls.filter((c) => / php occ /.test(c)).map((c) => c.replace(/^exec (-u www-data )?(-e OC_PASS )?knorke-dev-[a-z]+-nc php occ /, ''))

test('up.sh without load switches: the stack of before (no cpuset, no mod_status, firstrunwizard off, knorke_dev on, env.json without .load)', (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	const r = upRun(sb, 'dzupa')
	assert.equal(r.status, 0, r.stderr)
	const calls = sb.calls()
	assert.ok(!calls.some((c) => c.includes('--cpuset-cpus')), 'no cpuset anywhere')
	assert.ok(!calls.some((c) => c.includes('knorke-status.conf')), 'no mod_status mount')
	const occ = occCalls(calls)
	assert.ok(occ.includes('app:disable firstrunwizard'))
	assert.ok(occ.includes('config:system:set knorke_dev --value=true --type=boolean'))
	assert.ok(!occ.some((c) => c.includes('knorke_dev --value=false')))
	assert.ok(!occ.some((c) => /workshop|load\d\d/.test(c)), 'no load accounts')
	assert.doesNotMatch(fs.readFileSync(path.join(sb.fake, 'curl.log'), 'utf8'), /server-status/)
	const env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/dzupa/env.json'), 'utf8'))
	assert.equal('load' in env, false, 'env.json keeps its pre-stage-4 keys')
	assert.deepEqual(Object.keys(env), ['ns', 'ncIp', 'gatewayIp', 'port', 'host', 'baseHost', 'baseNet', 'appDir', 'containers', 'network', 'networks', 'db', 'redis', 'admin', 'userPass', 'users', 'groups', 'versions'])
})

test('up.sh with the load switches: PG cpuset, mod_status mounted but never published, firstrunwizard on, knorke_dev off, load accounts, env.json .load', (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	const r = upRun(sb, 'dzupl', { KD_LOAD_PROFILE: 'prod', KD_APACHE_STATUS: '1', KD_USERS: '3', KD_PG_CPUS: '0', KD_GEN_CPUSET: '1' })
	assert.equal(r.status, 0, r.stderr)
	const calls = sb.calls()
	const db = calls.find((c) => c.startsWith('run -d --name knorke-dev-dzupl-db'))
	assert.match(db, /^run -d --name knorke-dev-dzupl-db --network knorke-dev-dzupl-back --label knorke=dev-dzupl --cpuset-cpus 0 -e POSTGRES_DB=nextcloud/)
	assert.ok(!calls.find((c) => c.startsWith('run -d --name knorke-dev-dzupl-redis')).includes('--cpuset-cpus'), 'Redis unpinned')
	const create = calls.find((c) => c.startsWith('create --name knorke-dev-dzupl-nc'))
	assert.match(create, / -v \S+\/dev\/load\/knorke-status\.conf:\/etc\/apache2\/conf-enabled\/knorke-status\.conf:ro /)
	assert.deepEqual(create.match(/-p \S+/g), ['-p 127.0.0.1:18609:80'], 'the only published port: 127.0.0.1 → 80, never 8081')
	assert.match(create, / --cpus 4 /, 'NC keeps KD_NC_CPUS')
	const occ = occCalls(calls)
	assert.ok(!occ.includes('app:disable firstrunwizard'), 'firstrunwizard stays on')
	const on = occ.indexOf('config:system:set knorke_dev --value=true --type=boolean')
	const off = occ.indexOf('config:system:set knorke_dev --value=false --type=boolean')
	assert.ok(on >= 0 && off > on, 'knorke_dev true during the setup, false after it')
	assert.ok(off > occ.findIndex((c) => c.startsWith('group:adduser workshop')), 'off after the accounts')
	assert.ok(occ.includes('group:add --display-name=Workshop workshop'))
	for (const u of ['load01', 'load02', 'load03']) {
		assert.ok(occ.includes(`user:add --password-from-env --display-name=Load ${u.slice(4)} ${u}`), u)
		assert.ok(occ.includes(`group:adduser workshop ${u}`), u)
	}
	assert.match(fs.readFileSync(path.join(sb.fake, 'curl.log'), 'utf8'), /^-sf -m 5 http:\/\/172\.30\.0\.5:8081\/server-status\?auto$/m, 'mod_status checked through the container IP')
	const env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/dzupl/env.json'), 'utf8'))
	assert.deepEqual(env.load, { profile: 'prod', apacheStatus: true, statusUrl: 'http://172.30.0.5:8081/server-status?auto', users: ['load01', 'load02', 'load03'], group: 'workshop', pgCpus: '0', genCpuset: '1', prodApps: [], variant: 'base' })
	assert.deepEqual(Object.keys(env.users), ['alice', 'bob', 'carol'], 'load accounts are not harness accounts (normalise_ns leaves them alone)')
	assert.match(r.stderr, /Lastlauf: Profil prod, mod_status http:\/\/172\.30\.0\.5:8081\/server-status\?auto, Lastkonten 3, PG-cpuset 0, Generator-cpuset 1/)
})

test('up.sh in the namespace load: PG 0-3 and generator 4-7 by default, nowhere else; no PG pin without PostgreSQL', { skip: CPUS < 8 && `host has ${CPUS} CPUs (< 8)` }, (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	let r = upRun(sb, 'load')
	assert.equal(r.status, 0, r.stderr)
	assert.match(sb.calls().find((c) => c.startsWith('run -d --name knorke-dev-load-db')), / --cpuset-cpus 0-3 /)
	let env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/load/env.json'), 'utf8'))
	assert.equal(env.load.pgCpus, '0-3')
	assert.equal(env.load.genCpuset, '4-7')
	assert.equal(env.load.profile, null)
	r = upRun(sb, 'load', { KD_DB: 'sqlite', KD_PG_CPUS: undefined })
	assert.equal(r.status, 0, r.stderr)
	env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/load/env.json'), 'utf8'))
	assert.equal(env.load.pgCpus, null, 'the load default needs PostgreSQL')
	r = upRun(sb, 'load', { KD_PG_CPUS: '', KD_GEN_CPUSET: '' })
	assert.equal(r.status, 0, r.stderr)
	assert.ok(!sb.calls().some((c) => c.includes('--cpuset-cpus')), 'explicitly empty: no pinning')
	env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/load/env.json'), 'utf8'))
	assert.equal('load' in env, false, 'nothing of the load run left: no .load')
})

// --- S4e (SPEC-M1 §8.7, WP-D4 phase 1): the load run's Traefik ----------------------

const CURL_200 = `#!/usr/bin/env bash
# Fake curl: Traefik in front of Nextcloud answers status.php with 200.
printf '%s\\n' "$*" >>"$KD_FAKE_DIR/curl.log"
case "$*" in
    *'%{http_code}'*status.php*) printf '200' ;;
esac
exit 0
`

test('run.sh S4e: traefik:3.6.0 only when present locally (never pulled); Traefik on the front network with the edge limits, env.json .load.traefik during the run, removed afterwards', { timeout: 60000 }, async (t) => {
	const sb = loadSandbox()
	t.after(() => sb.cleanup())
	fs.writeFileSync(path.join(sb.fake, 'curl'), CURL_200, { mode: 0o755 })
	loadEnvJson(sb)
	// image missing: refused before anything runs
	sb.rules([[1, 'image inspect traefik:3.6.0', '', 'Error: No such image\n'], ...runRules()])
	let r = await runLoad(sb, ['S4e'], runEnv(sb, { KD_FAKE_GEN_MS: '200' }))
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /traefik:3\.6\.0 liegt nicht lokal vor – S4e zieht kein Bild/)
	assert.ok(!sb.calls().some((c) => /^(pull|run) /.test(c)), 'nothing pulled, nothing started')
	assert.equal(genLog(sb), '', 'no generator')
	// image present
	sb.rules([
		[0, 'image inspect traefik:3.6.0', '[]\n'],
		[0, 'rm -fv knorke-dev-dzload-traefik', ''],
		[0, 'run -d --name knorke-dev-dzload-traefik *', 'c\n'],
		[0, 'container inspect -f {{(index .NetworkSettings.Networks *', '172.30.0.7\n'],
		...runRules(),
	])
	let during = null
	r = await runLoad(sb, ['S4e'], runEnv(sb, { KD_FAKE_GEN_MS: '1500' }), async () => {
		during = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/dzload/env.json'), 'utf8')).load?.traefik ?? null
	})
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(during, { container: 'knorke-dev-dzload-traefik', ip: '172.30.0.7', port: 80, hostPort: null, image: 'traefik:3.6.0' }, 'the generator sees the Traefik')
	const calls = sb.calls()
	const run = calls.find((c) => c.startsWith('run -d --name knorke-dev-dzload-traefik'))
	assert.match(run, /^run -d --name knorke-dev-dzload-traefik --network knorke-dev-dzload-net --label knorke=dev-dzload --cpus 2 -v \S+\/dev\/\.state\/dzload\/traefik:\/etc\/traefik:ro traefik:3\.6\.0$/, 'front network, own label, config read-only, no published port outside load')
	assert.ok(calls.indexOf(run) < calls.length - 1 && calls.slice(calls.indexOf(run) + 1).includes('rm -fv knorke-dev-dzload-traefik'), 'removed again at the end')
	const dyn = fs.readFileSync(path.join(sb.dev, '.state/dzload/traefik/dynamic.yml'), 'utf8')
	for (const re of [/average: 200\n\s+period: 1s\n\s+burst: 400/, /average: 2\n\s+period: 1s\n\s+burst: 10/, /url: "http:\/\/knorke-dev-dzload-nc:80"/, /rule: "PathPrefix\(`\/`\)"/]) assert.match(dyn, re)
	assert.match(fs.readFileSync(path.join(sb.fake, 'curl.log'), 'utf8'), /-H Host: localhost http:\/\/172\.30\.0\.7\/status\.php/, 'waited until Traefik forwards to Nextcloud')
	const after = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/dzload/env.json'), 'utf8'))
	assert.equal('traefik' in (after.load || {}), false, '.load.traefik gone after the run')
	assert.ok(onlyReadsProd(calls), 'prod only read')
})
