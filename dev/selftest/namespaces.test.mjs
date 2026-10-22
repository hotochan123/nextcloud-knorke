/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Every run of dev/e2e and dev/sim belongs to ONE namespace (SPEC-M0 §8.1 R2;
 * review finding OPS-2, round 2 U3). Before, all namespaces shared
 * dev/e2e/out/bridge (one request queue: an E06 pgss gate could be answered
 * by another namespace's Postgres) and one report file each. Now:
 *
 * - the container side of the bridge and the E2E report use
 *   dev/e2e/out/<ns>/ (KD_E2E_OUT inside the container, else KD_NS)
 * - dev/sim reports go to dev/sim/out/<ns>/
 * - dev/e2e/run.sh holds an exclusive lock dev/.state/<ns>/e2e.lock and
 *   refuses a second run in the same namespace with exit 2, before it touches
 *   docker (checked here with a fake namespace and no containers)
 * - dev/up.sh checks KD_DB / KD_MYSQL_UTF8MB4 before anything else (U2)
 *
 * No stack needed. Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('the bridge and the E2E report live in dev/e2e/out/<ns>', async () => {
	const { outDir } = await import(path.join(ROOT, 'dev/e2e/lib/bridge.mjs'))
	assert.equal(outDir({ KD_NS: 'xa' }), path.join(ROOT, 'dev/e2e/out/xa'))
	assert.equal(outDir({ KD_NS: 'xb' }), path.join(ROOT, 'dev/e2e/out/xb'))
	assert.equal(outDir({ KD_E2E_OUT: '/out', KD_NS: 'xa' }), '/out', 'inside the container run.sh mounts the namespace dir at /out')
	assert.equal(outDir({}), path.join(ROOT, 'dev/e2e/out/main'))
	assert.throws(() => outDir({ KD_NS: '../x' }), /ungültig/)
	const runMjs = fs.readFileSync(path.join(ROOT, 'dev/e2e/run.mjs'), 'utf8')
	assert.match(runMjs, /const OUT = outDir\(\)/, 'run.mjs writes report and shots to the same dir')
	const runSh = fs.readFileSync(path.join(ROOT, 'dev/e2e/run.sh'), 'utf8')
	assert.match(runSh, /^OUT="\$E2E\/out\/\$NS"$/m)
	assert.match(runSh, /-v "\$OUT:\/out"/)
	assert.match(runSh, /-e KD_E2E_OUT=\/out/)
	assert.doesNotMatch(runSh, /out\/bridge"/, 'no shared bridge dir')
})

test('dev/sim reports live in dev/sim/out/<ns>', async () => {
	const { outDir } = await import(path.join(ROOT, 'dev/sim/lib/report.mjs'))
	assert.equal(outDir('xa'), path.join(ROOT, 'dev/sim/out/xa'))
	assert.notEqual(outDir('xa'), outDir('xb'))
	assert.throws(() => outDir('X'), /ungültig/)
})

test('a second E2E run in the same namespace is refused with exit 2', { timeout: 30000 }, async () => {
	const ns = 'dlocktst'
	const state = path.join(ROOT, 'dev/.state', ns)
	assert.ok(!fs.existsSync(state), `${state} exists – another run of this test? remove it first`)
	fs.mkdirSync(state, { recursive: true, mode: 0o700 })
	fs.writeFileSync(path.join(state, 'env.json'), JSON.stringify({ ns, gatewayIp: '10.255.255.1' }))
	// -o: the lock stays with flock itself, not with its sleep child; own process group for the kill
	const holder = spawn('flock', ['-x', '-o', path.join(state, 'e2e.lock'), 'sleep', '20'], { stdio: 'ignore', detached: true })
	const release = (sig) => { try { process.kill(-holder.pid, sig) } catch { /* gone */ } }
	try {
		await sleep(300)
		const r = spawnSync('bash', [path.join(ROOT, 'dev/e2e/run.sh'), '--list'], { env: { ...process.env, KD_NS: ns }, encoding: 'utf8', timeout: 20000 })
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, /läuft schon ein E2E-Lauf/)
		release('SIGTERM')
		await sleep(300)
		// lock free: the run gets past the lock and stops at the missing stack (also exit 2), with another message
		const r2 = spawnSync('bash', [path.join(ROOT, 'dev/e2e/run.sh'), '--list'], { env: { ...process.env, KD_NS: ns }, encoding: 'utf8', timeout: 20000 })
		assert.equal(r2.status, 2, r2.stderr)
		assert.doesNotMatch(r2.stderr, /läuft schon ein E2E-Lauf/)
		assert.match(r2.stderr, /läuft nicht/)
	} finally {
		release('SIGKILL')
		fs.rmSync(state, { recursive: true, force: true })
	}
})

test('up.sh refuses an unknown KD_DB and KD_MYSQL_UTF8MB4=0 without mariadb/mysql before anything else', () => {
	const up = (env) => spawnSync('bash', [path.join(ROOT, 'dev/up.sh')], {
		env: { ...process.env, KD_NS: 'dupchk', KD_PORT: '18599', KD_APP_DIR: '/nonexistent-kd', ...env }, encoding: 'utf8', timeout: 20000,
	})
	const a = up({ KD_DB: 'oracle' })
	assert.equal(a.status, 1)
	assert.match(a.stderr, /KD_DB='oracle' ist ungültig/)
	const b = up({ KD_DB: 'pgsql', KD_MYSQL_UTF8MB4: '0' })
	assert.equal(b.status, 1)
	assert.match(b.stderr, /KD_MYSQL_UTF8MB4=0 gilt nur für KD_DB=mariadb\|mysql/)
	const c = up({ KD_DB: 'sqlite', KD_DB_IMAGE: 'mariadb:11.8' })
	assert.equal(c.status, 1)
	assert.match(c.stderr, /KD_DB_IMAGE passt nicht zu KD_DB=sqlite/)
	const d = up({ KD_DB: 'mariadb' })
	assert.equal(d.status, 1)
	assert.match(d.stderr, /existiert nicht/, 'a valid KD_DB reaches the next check')
	assert.ok(!fs.existsSync(path.join(ROOT, 'dev/.state/dupchk')), 'nothing created')
})
