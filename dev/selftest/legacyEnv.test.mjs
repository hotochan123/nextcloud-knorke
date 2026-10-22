/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The pre-R5 env.json (SPEC-M1 §3.8, §8.1). The user's try stack was started
 * before SPEC-M0 round 5; its dev/.state/try/env.json has exactly the keys
 * admin, appDir, baseHost, baseNet, containers, gatewayIp, host, ncIp,
 * network, ns, port, userPass, users, versions – no db, networks, redis, and
 * one network. After stage 0 the user runs occ.sh, bust.sh and restart.sh
 * against it (KD_FORCE=1 KD_NS=try …, §3.8), so dev/lib.sh, occ.sh, bust.sh
 * and restart.sh must read the missing keys with a fallback: db.kind = pgsql,
 * networks = [network], Redis container = containers.redis.
 *
 * The fixture dev/selftest/fixtures/legacy-env.json has exactly that key set
 * with placeholder values (no real password). The scripts run in a sandbox
 * (lib/sandbox.mjs: throwaway copy, fake docker) against a copy of the
 * fixture renamed to the made-up namespace dzleg – never against try. The
 * JS side (dev/sim/lib/env.mjs) reads it from dev/.state/dzlegjs/ of this
 * copy, which is removed afterwards.
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './lib/sandbox.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURE = path.join(ROOT, 'dev/selftest/fixtures/legacy-env.json')
const LEGACY_KEYS = ['admin', 'appDir', 'baseHost', 'baseNet', 'containers', 'gatewayIp', 'host', 'ncIp', 'network', 'ns', 'port', 'userPass', 'users', 'versions']
const NS = 'dzleg'

/** The fixture, renamed from try to another namespace (same keys, same shape). */
function legacyFor(ns) {
	const raw = fs.readFileSync(FIXTURE, 'utf8').replaceAll('knorke-dev-try-', `knorke-dev-${ns}-`)
	return { ...JSON.parse(raw), ns }
}

test('the fixture has exactly the pre-R5 key set and only placeholder secrets', () => {
	const env = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
	assert.deepEqual(Object.keys(env).sort(), LEGACY_KEYS)
	for (const k of ['db', 'networks', 'redis']) assert.equal(k in env, false, `no ${k}`)
	assert.deepEqual(Object.keys(env.containers).sort(), ['db', 'nc', 'redis'])
	assert.equal(env.network, 'knorke-dev-try-net', 'one network')
	assert.equal(env.ns, 'try')
	assert.equal(env.port, 18590)
	for (const secret of [env.admin.pass, env.userPass]) assert.match(secret, /^PLACEHOLDER/, 'placeholder, not a password')
	assert.deepEqual(Object.keys(legacyFor(NS)).sort(), LEGACY_KEYS, 'the renamed copy keeps the key set')
})

test('dev/lib.sh: db.kind = pgsql, networks = [network], Redis from containers.redis', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const show = 'printf "kind=%s\\nfront=%s\\nback=%s\\nredis=%s\\n" "$(db_kind)" "$(env_front_net)" "$(env_back_net)" "$(env_redis_container)"'
	// pre-R5: no knorke.db label on its container either (docker prints "<no value>")
	sb.rules([[0, 'container inspect -f {{index .Config.Labels "knorke.db"}} *', '<no value>\n']])
	sb.writeEnv(NS, legacyFor(NS))
	let r = sb.lib(show, { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, `kind=pgsql\nfront=knorke-dev-${NS}-net\nback=\nredis=knorke-dev-${NS}-redis\n`)
	assert.doesNotMatch(r.stderr, /WARNUNG/)

	// an R5 env.json still wins with its own keys
	sb.writeEnv(NS, { ...legacyFor(NS), db: { kind: 'mariadb' }, networks: { front: `knorke-dev-${NS}-net`, back: `knorke-dev-${NS}-back` }, redis: { host: `knorke-dev-${NS}-redis` } })
	r = sb.lib(show, { KD_NS: NS })
	assert.equal(r.stdout, `kind=mariadb\nfront=knorke-dev-${NS}-net\nback=knorke-dev-${NS}-back\nredis=knorke-dev-${NS}-redis\n`, r.stderr)

	// env.json can only confirm names, never point elsewhere
	sb.writeEnv(NS, { ...legacyFor(NS), network: 'nextcloud_default', containers: { nc: 'nextcloud-nextcloud-1', db: 'nextcloud-db-1', redis: 'nextcloud-redis-1' } })
	r = sb.lib(show, { KD_NS: NS })
	assert.equal(r.stdout, `kind=pgsql\nfront=knorke-dev-${NS}-net\nback=\nredis=knorke-dev-${NS}-redis\n`)
	assert.match(r.stderr, /env\.json nennt 'nextcloud_default' – gehört nicht zum Namensraum dzleg/)
	assert.match(r.stderr, /env\.json nennt 'nextcloud-redis-1'/)

	// no env.json at all: the derived names
	fs.rmSync(path.join(sb.dev, '.state', NS), { recursive: true })
	r = sb.lib(show, { KD_NS: NS })
	assert.equal(r.stdout, `kind=pgsql\nfront=knorke-dev-${NS}-net\nback=\nredis=knorke-dev-${NS}-redis\n`, r.stderr)
})

test('occ.sh, bust.sh, db.sh and redis-keys.sh work on a pre-R5 stack', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.writeEnv(NS, legacyFor(NS))
	const base = [
		[0, `container inspect -f {{.State.Running}} knorke-dev-${NS}-*`, 'true\n'],
		[0, 'container inspect -f {{index .Config.Labels "knorke.db"}} *', '<no value>\n'],
	]
	sb.rules([...base, [0, `exec -i -u www-data knorke-dev-${NS}-nc php occ config:system:get appstoreenabled`, 'false\n']])
	let r = sb.run('occ.sh', ['config:system:get', 'appstoreenabled'], { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, 'false\n')

	sb.rules([...base,
		[0, `exec -u www-data knorke-dev-${NS}-nc php occ config:app:get theming cachebuster`, '41\n'],
		[0, `exec -u www-data knorke-dev-${NS}-nc php occ config:app:set theming cachebuster --value=42`, ''],
	])
	r = sb.run('bust.sh', [], { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, '42\n')
	assert.ok(sb.calls().includes(`exec -u www-data knorke-dev-${NS}-nc php occ config:app:set theming cachebuster --value=42`))

	sb.rules(base)
	r = sb.run('db.sh', ['--kind'], { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, 'pgsql\n', 'pre-R5 = pgsql')

	sb.rules([...base, [0, `exec knorke-dev-${NS}-redis redis-cli --scan --pattern */knorke/*`, '']])
	r = sb.run('redis-keys.sh', [], { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /0 Schlüssel/)
	assert.ok(sb.calls().every((c) => !/nextcloud-|knorke-dev-try-/.test(c)), 'only containers of the namespace')
})

test('restart.sh on a pre-R5 stack: port from the container, IP on .network, env.json keeps its keys', async (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	// stands in for the restarted Nextcloud: status.php installed, the app route 401
	const server = http.createServer((req, res) => {
		if (req.url === '/status.php') { res.end('{"installed":true,"maintenance":false}'); return }
		res.statusCode = req.url === '/index.php/apps/knorke/api/v1/boards' ? 401 : 404
		res.end()
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	const port = server.address().port
	const file = sb.writeEnv(NS, legacyFor(NS))
	const rules = (ip) => [
		[0, `container inspect -f {{.State.Running}} knorke-dev-${NS}-nc`, 'true\n'],
		[0, `port knorke-dev-${NS}-nc 80/tcp`, `127.0.0.1:${port}\n`],
		[0, `restart knorke-dev-${NS}-nc`, `knorke-dev-${NS}-nc\n`],
		[0, `container inspect -f {{(index .NetworkSettings.Networks "knorke-dev-${NS}-net").IPAddress}} knorke-dev-${NS}-nc`, `${ip}\n`],
	]
	// same address as before: env.json stays byte for byte
	const before = fs.readFileSync(file, 'utf8')
	sb.rules(rules('10.255.0.2'))
	let r = await sb.runAsync('restart.sh', [], { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /401-Probe grün/)
	assert.equal(fs.readFileSync(file, 'utf8'), before)
	// a new address: only ncIp changes, read on the legacy .network
	sb.rules(rules('10.255.0.9'))
	r = await sb.runAsync('restart.sh', [], { KD_NS: NS })
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /Container-IP hat sich geändert: 10\.255\.0\.2 → 10\.255\.0\.9 \(env\.json nachgeführt, Netz knorke-dev-dzleg-net\)/)
	const after = JSON.parse(fs.readFileSync(file, 'utf8'))
	assert.deepEqual(Object.keys(after).sort(), LEGACY_KEYS, 'no key added or lost')
	assert.deepEqual(after, { ...legacyFor(NS), ncIp: '10.255.0.9' })
	assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600')
})

test('dev/sim/lib/env.mjs accepts a pre-R5 env.json as pgsql', async (t) => {
	const ns = 'dzlegjs'
	const dir = path.join(ROOT, 'dev/.state', ns)
	assert.ok(!fs.existsSync(dir), `${dir} exists – another run of this test? remove it first`)
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	fs.writeFileSync(path.join(dir, 'env.json'), JSON.stringify(legacyFor(ns)), { mode: 0o600 })
	const { loadEnv, Stack } = await import(path.join(ROOT, 'dev/sim/lib/env.mjs'))
	const env = loadEnv(ns)
	assert.equal(new Stack(env).kind, 'pgsql')
	assert.equal(env.containers.redis, `knorke-dev-${ns}-redis`)
})
