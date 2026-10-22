/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The SQL side channel of the harness talks utf8mb4 on MariaDB and MySQL
 * (P7-D, finding VC-01 of the P7-C code verifier). The mysql client in
 * mysql:8.4 has no locale in its container and falls back to latin1:
 * Stack.sql read 6000 × U+1F600 back as "?", and C81 (a) was red on MySQL
 * although the stored bytes were right. Every client call that reads or
 * writes data – Stack.sql (dev/sim/lib/env.mjs), db_sql (dev/lib.sh) and the
 * interactive client of dev/db.sh – therefore passes
 * --default-character-set=utf8mb4. On a utf8mb3 stack (KD_MYSQL_UTF8MB4=0)
 * the server converts losslessly between the connection and the tables (C48).
 *
 * Without a Docker daemon: Stack.sql, db_sql and dev/db.sh -c run against the
 * fake docker of lib/sandbox.mjs, which records the command line; the
 * interactive branch of dev/db.sh needs a TTY and is checked in its source;
 * a scan of dev/ finds any new mariadb/mysql client call without the flag
 * (only the readiness probe of dev/up.sh, `-e "SELECT 1"`, carries no data).
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Sandbox, REPO } from './lib/sandbox.mjs'
import { Stack, MYSQL_CHARSET_FLAG } from '../sim/lib/env.mjs'

const FLAG = '--default-character-set=utf8mb4'
const NS = 'dzsqlcs'
const DB = `knorke-dev-${NS}-db`
const CONTAINERS = { nc: `knorke-dev-${NS}-nc`, db: DB, redis: `knorke-dev-${NS}-redis` }
const SMILE = '\u{1F600}'

test('MYSQL_CHARSET_FLAG (dev/sim/lib/env.mjs) is --default-character-set=utf8mb4', () => {
	assert.equal(MYSQL_CHARSET_FLAG, FLAG)
})

test('Stack.sql: the mariadb and mysql clients run with utf8mb4, psql and the sqlite PHP without it', async (t) => {
	const sb = new Sandbox()
	const saved = { PATH: process.env.PATH, KD_FAKE_DIR: process.env.KD_FAKE_DIR }
	t.after(() => {
		process.env.PATH = saved.PATH
		if (saved.KD_FAKE_DIR === undefined) delete process.env.KD_FAKE_DIR
		else process.env.KD_FAKE_DIR = saved.KD_FAKE_DIR
		sb.cleanup()
	})
	// Stack.sql spawns `docker` with this process's environment: the fake comes first
	process.env.PATH = `${sb.fake}:${saved.PATH}`
	process.env.KD_FAKE_DIR = sb.fake

	for (const kind of ['mariadb', 'mysql']) {
		sb.rules([[0, `exec -i ${DB} sh -c *`, `1\t${SMILE}\n`]])
		const stack = new Stack({ db: { kind, utf8mb4: true }, containers: CONTAINERS })
		assert.deepEqual(await stack.sql('SELECT 1;'), [['1', SMILE]], `${kind}: rows as before`)
		const calls = sb.calls()
		assert.equal(calls.length, 1, `${kind}: one docker call`)
		assert.ok(calls[0].includes(`exec ${kind} ${FLAG} -u `), `${kind}: the client gets ${FLAG} (VC-01): ${calls[0]}`)
		assert.ok(calls[0].includes(' -N -B -r '), `${kind}: still no header, batch, raw`)
	}
	// a utf8mb3 stack (KD_MYSQL_UTF8MB4=0) uses the same client line
	sb.rules([[0, `exec -i ${DB} sh -c *`, '1\n']])
	await new Stack({ db: { kind: 'mariadb', utf8mb4: false }, containers: CONTAINERS }).sql('SELECT 1;')
	assert.ok(sb.calls()[0].includes(`exec mariadb ${FLAG} -u `), 'utf8mb3 stack: same flag (the server converts losslessly)')

	sb.rules([[0, `exec -i ${DB} psql *`, '1\n']])
	await new Stack({ db: { kind: 'pgsql' }, containers: CONTAINERS }).sql('SELECT 1;')
	assert.ok(!sb.calls()[0].includes('default-character-set'), 'pgsql: psql unchanged')

	sb.rules([[0, `exec -i -u www-data ${CONTAINERS.nc} php -r *`, '1\n']])
	await new Stack({ db: { kind: 'sqlite' }, containers: { ...CONTAINERS, db: null } }).sql('SELECT 1;')
	assert.ok(!sb.calls()[0].includes('default-character-set'), 'sqlite: PHP PDO unchanged')
})

test('db_sql (dev/lib.sh) and dev/db.sh -c: the mariadb and mysql clients run with utf8mb4', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	for (const kind of ['mariadb', 'mysql']) {
		sb.writeEnv(NS, { ns: NS, db: { kind } })
		sb.rules([[0, `exec -i ${DB} sh -c *`, `1\t${SMILE}\n`]])
		const r = sb.lib("printf '%s\\n' 'SELECT 1;' | db_sql", { KD_NS: NS })
		assert.equal(r.status, 0, r.stderr)
		assert.equal(r.stdout, `1\t${SMILE}\n`)
		const calls = sb.calls()
		assert.equal(calls.length, 1, `${kind}: one docker call (db_kind reads env.json): ${calls.join(' | ')}`)
		assert.ok(calls[0].includes(`exec ${kind} ${FLAG} -u `), `db_sql ${kind}: ${calls[0]}`)

		sb.rules([
			[0, `container inspect -f * ${DB}`, 'true\n'],
			[0, `exec -i ${DB} sh -c *`, '1\n'],
		])
		const d = sb.run('db.sh', ['-c', 'SELECT 1'], { KD_NS: NS })
		assert.equal(d.status, 0, d.stderr)
		const exec = sb.calls().filter((c) => c.startsWith('exec '))
		assert.equal(exec.length, 1, `db.sh -c ${kind}: one exec: ${sb.calls().join(' | ')}`)
		assert.ok(exec[0].includes(`exec ${kind} ${FLAG} -u `), `db.sh -c ${kind}: ${exec[0]}`)
	}
})

test('dev/db.sh interactive client: mariadb and mysql with utf8mb4 (source; the branch needs a TTY)', () => {
	const src = fs.readFileSync(path.join(REPO, 'dev/db.sh'), 'utf8')
	for (const kind of ['mariadb', 'mysql']) {
		const line = src.split('\n').find((l) => l.trimStart().startsWith(`${kind}) exec docker exec "\${TTY[@]}"`))
		assert.ok(line, `dev/db.sh: interactive ${kind} line`)
		assert.ok(line.includes(`exec ${kind} ${FLAG} -u `), `dev/db.sh interactive ${kind}: ${line.trim()}`)
	}
})

test('every mariadb/mysql client call under dev/ passes the flag (only the readiness probe of up.sh is exempt)', () => {
	const skipDirs = new Set(['node_modules', 'out', '.state', 'placeholder'])
	const files = []
	const walk = (rel) => {
		for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
			const p = path.join(rel, e.name)
			if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(p) } else if (/\.(sh|mjs|js)$/.test(e.name) && p !== 'dev/selftest/sqlCharset.test.mjs') files.push(p)
		}
	}
	walk('dev')
	const found = []
	const missing = []
	for (const f of files) {
		fs.readFileSync(path.join(REPO, f), 'utf8').split('\n').forEach((line, i) => {
			if (!/\bexec (mariadb|mysql)\b/.test(line) || /^\s*(#|\*|\/\/)/.test(line)) return
			found.push(`${f}:${i + 1}`)
			const probe = f === 'dev/up.sh' && line.includes('-e "SELECT 1"')
			if (!probe && !line.includes(FLAG) && !line.includes('{MYSQL_CHARSET_FLAG}')) missing.push(`${f}:${i + 1}: ${line.trim()}`)
		})
	}
	// Stack.sql (2), db_sql (2), db.sh interactive (2), up.sh readiness probe (2)
	assert.ok(found.length >= 8, `client calls found: ${found.join(', ')}`)
	assert.deepEqual(missing, [], 'mariadb/mysql client calls without --default-character-set=utf8mb4')
})
