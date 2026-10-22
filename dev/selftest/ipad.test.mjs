/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The R-B tooling without a device (SPEC-M1 §8.8 (2), (5), Revision 19
 * T4-13; the session itself comes after stage 4):
 * - dev/ipad/relay.mjs: binds only <lanHost>:18612 → 127.0.0.1:18611 (lanHost
 *   a private IPv4 host address, neutral 192.168.1.20 here), refuses 0.0.0.0,
 *   ::, any other address or port, the command line takes only --hours
 *   (default 2); the CLI (run from a sandbox copy) takes lanHost only from
 *   dev/.state/ipad/env.json with .ipad.profile = true and otherwise exits 2
 *   without listening; the address rule equals the one of dev/lib.sh
 *   (valid_lan_host) and of the session server (allowedHost); a relay on
 *   127.0.0.1 (the self-test's only other address) forwards bytes both ways
 *   to a local echo server, ends by itself after its hours and closes open
 *   connections; a start on an address this host lacks (EADDRNOTAVAIL) says
 *   to correct KD_LAN_HOST in dev/local.env and how to restart the stack
 * - dev/up.sh KD_IPAD_PROFILE: only 0/1, 1 only with KD_NS=ipad and a valid
 *   KD_LAN_HOST (exit 1, no docker call); a whole up.sh against the fake
 *   docker with the switch: knorke_dev off after the setup, trusted_domains
 *   9 = KD_LAN_HOST, env.json .ipad – and without it nothing of that
 * - dev/ipad/moderate.mjs against the fake protocol-2 server
 *   (lib/fakeKnorke.mjs): board with notes and both links (URLs through the
 *   relay on env.ipad.lanHost, without .ipad on env.baseHost), vote
 *   start/end, timer start/stop, "Alle zu mir" with a moving
 *   view v and the summon removed at the end; its strict argument parser;
 *   (R20, K2) started with a protected namespace (KD_PROTECT_NS, default
 *   try) it refuses with exit 2 before loadEnv and any docker call,
 *   KD_FORCE=1 passes (run from a sandbox copy with the fake docker)
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { Sandbox, REPO } from './lib/sandbox.mjs'
import { startFakeKnorke } from './lib/fakeKnorke.mjs'
import { refusal, parseArgs, startRelay, startFailure, lanHostValid, lanHostOf, RELAY_PORT, TARGET_HOST, TARGET_PORT, HOURS_DEFAULT } from '../ipad/relay.mjs'
import { parseArgs as modArgs, runAction, viewAt, linkBase } from '../ipad/moderate.mjs'
import { allowedHost } from '../scene-lab/ipad/session.mjs'

const PLACEHOLDER = path.join(REPO, 'dev/selftest/placeholder')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** A neutral LAN address (the real one lives in dev/local.env only). */
const LAN = '192.168.1.20'
const ADDRESSES = ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.0.1', '10.255.255.254',
	'0.0.0.0', '::', '::1', '127.0.0.1', '127.0.0.2', 'localhost', 'tower', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1',
	'192.168.1.0', '192.168.1.255', '192.168.1.256', '192.168.1.057', '192.168.01.20', '10.0.0', '10.0.0.5.1', ' 10.0.0.5', '', undefined]

test('relay: fixed ports of §8.1/§8.8 (LAN 18612 → 127.0.0.1:18611 of the namespace ipad) on the given lanHost, 0.0.0.0 and :: refused, only --hours on the command line', () => {
	assert.deepEqual([RELAY_PORT, TARGET_HOST, TARGET_PORT, HOURS_DEFAULT], [18612, '127.0.0.1', 18611, 2])
	assert.match(fs.readFileSync(path.join(REPO, 'dev/lib.sh'), 'utf8'), /ipad\) echo 18611 ;;/, 'the published port of ipad in dev/lib.sh')
	const ok = { lanHost: LAN, listenHost: LAN, listenPort: RELAY_PORT, targetHost: TARGET_HOST, targetPort: TARGET_PORT }
	assert.equal(refusal(ok), null)
	for (const [o, re] of [
		[{ listenHost: '0.0.0.0' }, /von überall erreichbar/],
		[{ listenHost: '::' }, /von überall erreichbar/],
		[{ listenHost: '' }, /von überall erreichbar/],
		// no string at all: Node would bind a falsy host to every address
		[{ listenHost: null }, /von überall erreichbar/],
		[{ listenHost: undefined }, /von überall erreichbar/],
		[{ listenHost: 0 }, /von überall erreichbar/],
		[{ listenHost: ['192.168.1.20'] }, /von überall erreichbar/],
		[{ lanHost: undefined, listenHost: null }, /von überall erreichbar/],
		[{ lanHost: 'x', listenHost: null }, /von überall erreichbar/],
		[{ lanHost: null, listenHost: null }, /von überall erreichbar/],
		[{ listenHost: '192.168.1.21' }, /verweigert \(nur 192\.168\.1\.20/],
		[{ listenHost: '10.0.0.1' }, /verweigert/],
		[{ listenPort: 18611 }, /nur Port 18612/],
		[{ targetHost: LAN }, /Ziel 192\.168\.1\.20 verweigert/],
		[{ targetPort: 18590 }, /Ziel nur 127\.0\.0\.1:18611/],
		// an unusable lanHost allows nothing but the self-test's 127.0.0.1
		[{ lanHost: '0.0.0.0', listenHost: '0.0.0.0' }, /von überall erreichbar/],
		[{ lanHost: '8.8.8.8', listenHost: '8.8.8.8' }, /verweigert \(nur die LAN-Adresse aus env\.json/],
		[{ lanHost: undefined, listenHost: LAN }, /verweigert/],
	]) {
		assert.match(refusal({ ...ok, ...o }) ?? '', re, JSON.stringify(o))
	}
	assert.equal(refusal({ ...ok, lanHost: undefined, listenHost: '127.0.0.1', listenPort: 0, targetPort: 5000 }), null, '127.0.0.1 for the self-test, without lanHost')
	// the address rule: the same as dev/lib.sh valid_lan_host and the session server's allowedHost (minus its 127.0.0.1)
	const sb = new Sandbox()
	try {
		const r = sb.lib(`for h in ${ADDRESSES.filter((h) => h !== undefined).map((h) => `'${h}'`).join(' ')}; do if valid_lan_host "$h"; then echo "1$h"; else echo "0$h"; fi; done`)
		assert.equal(r.status, 0, r.stderr)
		const bash = Object.fromEntries(r.stdout.split('\n').filter(Boolean).map((l) => [l.slice(1), l[0] === '1']))
		for (const h of ADDRESSES) {
			if (h !== undefined) assert.equal(lanHostValid(h), bash[h], `relay and dev/lib.sh agree on '${h}'`)
			assert.equal(lanHostValid(h), h !== '127.0.0.1' && allowedHost(h), `relay and session server agree on '${h}'`)
		}
	} finally {
		sb.cleanup()
	}
	assert.deepEqual(ADDRESSES.filter(lanHostValid), ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.0.1', '10.255.255.254'])
	assert.equal(lanHostOf({ ipad: { profile: true, lanHost: LAN, relayPort: 18612 } }), LAN)
	for (const env of [null, {}, { ipad: null }, { ipad: { lanHost: LAN } }, { ipad: { profile: 'true', lanHost: LAN } }, { ipad: { profile: true } }, { ipad: { profile: true, lanHost: '0.0.0.0' } }]) {
		assert.throws(() => lanHostOf(env), /KD_IPAD_PROFILE=1/, JSON.stringify(env))
	}
	assert.deepEqual(parseArgs([]), { hours: 2 })
	assert.deepEqual(parseArgs(['--hours', '0.5']), { hours: 0.5 })
	for (const bad of [['--hours', '0.01'], ['--hours', '9'], ['--hours'], ['--listen', '0.0.0.0'], ['--port', '18612'], ['--target', '127.0.0.1:18590'], ['x']]) {
		assert.throws(() => parseArgs(bad), /ungültig|unbekanntes Argument/, bad.join(' '))
	}
	const src = fs.readFileSync(path.join(REPO, 'dev/ipad/relay.mjs'), 'utf8')
	assert.match(src, /r = await startRelay\(\{ lanHost, hours: args\.hours \}\)/, 'the CLI starts with the address of env.json and the fixed ports only')
	assert.match(src, /lanHost = readLanHost\(\)/, 'lanHost from dev/.state/ipad/env.json')
})

test('relay start failure: EADDRNOTAVAIL names KD_LAN_HOST in dev/local.env and the restart of the stack, any other error its own message; main() prints it', () => {
	const msg = startFailure(Object.assign(new Error('x'), { code: 'EADDRNOTAVAIL' }), LAN)
	for (const part of [LAN, 'KD_LAN_HOST', 'dev/local.env', 'KD_NS=ipad dev/down.sh', 'KD_NS=ipad KD_IPAD_PROFILE=1 dev/up.sh']) {
		assert.ok(msg.includes(part), `names ${part}: ${msg}`)
	}
	assert.equal(startFailure(new Error('anders'), LAN), 'anders')
	const src = fs.readFileSync(path.join(REPO, 'dev/ipad/relay.mjs'), 'utf8')
	assert.match(src, /r = await startRelay\(\{ lanHost, hours: args\.hours \}\)\n\t\} catch \(e\) \{\n\t\tconsole\.error\(`\[relay\] \$\{startFailure\(e, lanHost\)\}`\)\n\t\treturn 1\n/, 'the failed start of the CLI prints startFailure(e, lanHost) and exits 1')
})

test('relay CLI: without a stack with the iPad profile (no env.json, no .ipad, profile not true, invalid lanHost) exit 2 and the hint, nothing listens', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.copyDev('ipad')
	const envFile = path.join(sb.dev, '.state', 'ipad', 'env.json')
	const cases = [
		['no env.json', null],
		['no .ipad', { ns: 'ipad', baseHost: 'http://127.0.0.1:18611' }],
		['profile not true', { ns: 'ipad', ipad: { profile: false, lanHost: LAN, relayPort: 18612 } }],
		['profile "true"', { ns: 'ipad', ipad: { profile: 'true', lanHost: LAN, relayPort: 18612 } }],
		['lanHost 0.0.0.0', { ns: 'ipad', ipad: { profile: true, lanHost: '0.0.0.0', relayPort: 18612 } }],
		['public lanHost', { ns: 'ipad', ipad: { profile: true, lanHost: '8.8.8.8', relayPort: 18612 } }],
		['no lanHost', { ns: 'ipad', ipad: { profile: true, relayPort: 18612 } }],
	]
	for (const [what, env] of cases) {
		fs.rmSync(path.join(sb.dev, '.state'), { recursive: true, force: true })
		if (env) sb.writeEnv('ipad', env)
		assert.equal(fs.existsSync(envFile), env !== null)
		const r = sb.node('ipad/relay.mjs', ['--hours', '0.05'], {}, { timeout: 10000 })
		assert.equal(r.status, 2, `${what}: ${r.stderr}`)
		assert.match(r.stderr, /KD_NS=ipad KD_IPAD_PROFILE=1 dev\/up\.sh/, what)
		assert.doesNotMatch(r.stdout, /→/, `${what}: no "listening" line`)
	}
})

test('relay on 127.0.0.1: bytes both ways to the target, a refused start for 0.0.0.0, the end after its hours closes open connections', { timeout: 20000 }, async (t) => {
	const echo = net.createServer((s) => s.pipe(s))
	await new Promise((r) => echo.listen(0, '127.0.0.1', r))
	t.after(() => echo.close())
	await assert.rejects(startRelay({ listenHost: '0.0.0.0', listenPort: 0, targetPort: echo.address().port, log: () => {} }), /von überall erreichbar/)
	await assert.rejects(startRelay({ listenHost: null, listenPort: 0, targetPort: echo.address().port, log: () => {} }), /von überall erreichbar/, 'null never reaches server.listen')
	await assert.rejects(startRelay({ listenPort: 0, targetPort: echo.address().port, log: () => {} }), /von überall erreichbar/, 'neither lanHost nor listenHost')
	const lines = []
	const r = await startRelay({ listenHost: '127.0.0.1', listenPort: 0, targetHost: '127.0.0.1', targetPort: echo.address().port, hours: 1.5 / 3600, log: (s) => lines.push(s) })
	assert.equal(r.address, '127.0.0.1')
	const sock = net.connect(r.port, '127.0.0.1')
	const got = await new Promise((resolve) => {
		sock.once('data', (d) => resolve(String(d)))
		sock.write('knorke-relay')
	})
	assert.equal(got, 'knorke-relay', 'echo through the relay')
	const closed = new Promise((resolve) => sock.on('close', resolve))
	const t0 = Date.now()
	await r.done
	await closed
	assert.ok(Date.now() - t0 < 4000, 'ended by its hours (1.5 s here)')
	assert.ok(lines.some((l) => /abgelaufen/.test(l)), lines.join('\n'))
	await assert.rejects(new Promise((resolve, reject) => { const s = net.connect(r.port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve() }); s.on('error', reject) }), /ECONNREFUSED/, 'no longer listening')
})

const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$KD_FAKE_DIR/curl.log"
case "$*" in
    *'%{http_code}'*) printf '401' ;;
    *status.php*) printf '{"installed":true,"versionstring":"34.0.1"}' ;;
esac
exit 0
`
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
function upSandbox(t) {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	fs.writeFileSync(path.join(sb.fake, 'curl'), FAKE_CURL, { mode: 0o755 })
	fs.mkdirSync(path.join(sb.dev, 'load'), { recursive: true })
	fs.copyFileSync(path.join(REPO, 'dev/load/knorke-status.conf'), path.join(sb.dev, 'load/knorke-status.conf'))
	return sb
}
const occCalls = (calls) => calls.filter((c) => / php occ /.test(c)).map((c) => c.replace(/^exec (-u www-data )?(-e OC_PASS )?knorke-dev-[a-z]+-nc php occ /, ''))

test('up.sh KD_IPAD_PROFILE: only 0 or 1, 1 only in the namespace ipad and with a valid KD_LAN_HOST – refused before any docker call (exit 1)', (t) => {
	const sb = upSandbox(t)
	for (const [extra, re] of [
		[{ KD_NS: 'dzipad', KD_PORT: '18609', KD_IPAD_PROFILE: '1', KD_LAN_HOST: LAN }, /KD_IPAD_PROFILE=1 gilt nur für KD_NS=ipad \(hier dzipad\)/],
		[{ KD_NS: 'ipad', KD_IPAD_PROFILE: '2', KD_LAN_HOST: LAN }, /KD_IPAD_PROFILE='2' ist ungültig \(leer, 0 oder 1\)/],
		[{ KD_NS: 'ipad', KD_IPAD_PROFILE: 'yes', KD_LAN_HOST: LAN }, /KD_IPAD_PROFILE='yes' ist ungültig/],
		[{ KD_NS: 'ipad', KD_IPAD_PROFILE: '1' }, /KD_IPAD_PROFILE=1 braucht KD_LAN_HOST .*dev\/local\.env/],
		[{ KD_NS: 'ipad', KD_IPAD_PROFILE: '1', KD_LAN_HOST: '' }, /KD_IPAD_PROFILE=1 braucht KD_LAN_HOST/],
		...['0.0.0.0', '8.8.8.8', '192.168.1.255', '127.0.0.1', '192.168.01.20'].map((h) => [{ KD_NS: 'ipad', KD_IPAD_PROFILE: '1', KD_LAN_HOST: h }, new RegExp(`KD_LAN_HOST='${h.replace(/\./g, '\\.')}' \\(aus der Umgebung\\) ist ungültig`)]),
	]) {
		sb.rules([])
		const r = sb.run('up.sh', [], { KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1', ...extra })
		assert.equal(r.status, 1, `${JSON.stringify(extra)}: ${r.stderr}`)
		assert.match(r.stderr, re)
		assert.deepEqual(sb.calls(), [], 'no docker call')
	}
})

test('up.sh KD_NS=ipad KD_IPAD_PROFILE=1 KD_LAN_HOST=192.168.1.20: knorke_dev off after the setup, trusted_domains 9 = KD_LAN_HOST, env.json .ipad; without it none of that', (t) => {
	const sb = upSandbox(t)
	sb.rules(upRules())
	let r = sb.run('up.sh', [], { KD_NS: 'ipad', KD_IPAD_PROFILE: '1', KD_LAN_HOST: LAN, KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1' }, { timeout: 60000 })
	assert.equal(r.status, 0, r.stderr)
	let occ = occCalls(sb.calls())
	const on = occ.indexOf('config:system:set knorke_dev --value=true --type=boolean')
	const off = occ.lastIndexOf('config:system:set knorke_dev --value=false --type=boolean')
	assert.ok(on >= 0 && off > on, 'knorke_dev true during the setup, false after it')
	assert.ok(occ.includes('config:system:set trusted_domains 9 --value=192.168.1.20'), occ.join('\n'))
	assert.match(sb.calls().find((c) => c.startsWith('create --name knorke-dev-ipad-nc')), / -p 127\.0\.0\.1:18611:80 /, 'published on 127.0.0.1 only, port 18611')
	let env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/ipad/env.json'), 'utf8'))
	assert.deepEqual(env.ipad, { profile: true, lanHost: '192.168.1.20', relayPort: 18612 })
	assert.match(env.userPass, /^[A-Za-z0-9]{24}$/, 'random account password (not a harness default)')
	sb.rules(upRules())
	r = sb.run('up.sh', [], { KD_NS: 'dzipad', KD_PORT: '18609', KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1' }, { timeout: 60000 })
	assert.equal(r.status, 0, r.stderr)
	occ = occCalls(sb.calls())
	assert.ok(!occ.some((c) => /trusted_domains|knorke_dev --value=false/.test(c)), 'unset: nothing of the profile')
	env = JSON.parse(fs.readFileSync(path.join(sb.dev, '.state/dzipad/env.json'), 'utf8'))
	assert.equal('ipad' in env, false)
})

test('moderate.mjs: strict arguments', () => {
	assert.deepEqual(modArgs(['board']), { action: 'board' })
	assert.deepEqual(modArgs(['board', '--notes', '50']), { action: 'board', notes: 50 })
	assert.deepEqual(modArgs(['vote-start', '7', '--minutes', '10']), { action: 'vote-start', board: 7, minutes: 10 })
	assert.deepEqual(modArgs(['timer', '7', '5']), { action: 'timer', board: 7, minutes: 5 })
	assert.deepEqual(modArgs(['present', '7', '--secs', '30']), { action: 'present', board: 7, secs: 30 })
	for (const bad of [[], ['drop'], ['vote-end'], ['vote-end', 'x'], ['timer', '7'], ['timer', '7', '100'], ['board', '--notes', '0'], ['board', '--notes', '4001'], ['present', '7', '--secs', '901'], ['board', '7'], ['board', '--color', 'red']]) {
		assert.throws(() => modArgs(bad), Error, bad.join(' '))
	}
	assert.deepEqual(viewAt(0), [0, 0, 2400, 1500])
	assert.deepEqual(viewAt(10), viewAt(1), 'a 3 × 3 tour, then again')
})

test('moderate.mjs against the fake server: board with notes and both links through the relay, vote, timer, "Alle zu mir" with a moving view, summon removed at the end', { timeout: 60000 }, async (t) => {
	const fake = await startFakeKnorke({ userPass: 'pw' })
	t.after(() => fake.close())
	const env = { ns: 'dzipad', ncIp: '127.0.0.1', ncPort: fake.port, host: 'localhost', baseHost: 'http://127.0.0.1:18609', userPass: 'pw', users: { alice: 'Alice Adler' }, versions: { nextcloud: 'fake' }, ipad: { profile: true, lanHost: LAN, relayPort: 18612 } }
	const b = await runAction({ action: 'board', notes: 50 }, env)
	assert.equal(b.notes, 50)
	assert.equal(b.frames, 20)
	assert.equal(linkBase(env), 'http://192.168.1.20:18612/index.php/apps/knorke')
	assert.match(b.voteUrl, /^http:\/\/192\.168\.1\.20:18612\/index\.php\/apps\/knorke\/p\/[A-Za-z0-9]{24}$/, 'vote link through the relay')
	assert.match(b.editUrl, /^http:\/\/192\.168\.1\.20:18612\/index\.php\/apps\/knorke\/p\/[A-Za-z0-9]{24}$/)
	// a dry run against another namespace (no .ipad): the stack's own baseHost
	const { ipad, ...dry } = env
	assert.equal(ipad.lanHost, LAN)
	const d = await runAction({ action: 'board', notes: 1 }, dry)
	assert.match(d.voteUrl, /^http:\/\/127\.0\.0\.1:18609\/index\.php\/apps\/knorke\/p\/[A-Za-z0-9]{24}$/, 'vote link on baseHost')
	assert.match(d.editUrl, /^http:\/\/127\.0\.0\.1:18609\/index\.php\/apps\/knorke\/p\/[A-Za-z0-9]{24}$/, 'edit link on baseHost')
	assert.equal(linkBase({ ...dry, ipad: { profile: true, lanHost: '0.0.0.0' } }), 'http://127.0.0.1:18609/index.php/apps/knorke', 'an unusable lanHost gives no relay link')
	assert.deepEqual(fake.stats.badRequests, [])
	const v = await runAction({ action: 'vote-start', board: b.board, minutes: 10 }, env)
	assert.equal(v.vote?.state, 'open')
	assert.deepEqual(v.vote?.cfg, { per: 5, perItem: 1, scope: null, types: ['sticky'] })
	const e = await runAction({ action: 'vote-end', board: b.board }, env)
	assert.equal(e.vote?.state, 'closed')
	const tm = await runAction({ action: 'timer', board: b.board, minutes: 5 }, env)
	assert.equal(tm.timer?.state, 'running')
	assert.equal(tm.timer?.dur, 300000)
	const ts = await runAction({ action: 'timer-stop', board: b.board }, env)
	assert.equal(ts.timer, null)
	const p = await runAction({ action: 'present', board: b.board, secs: 5 }, env)
	assert.ok(p.ticks >= 3 && p.views >= 2, `presence with a moving view (${p.ticks} ticks, ${p.views} views)`)
	const snap = await fetch(`http://127.0.0.1:${fake.port}/index.php/csrftoken`, { headers: { Authorization: 'Basic ' + Buffer.from('alice:pw').toString('base64') } })
	assert.equal(snap.status, 200)
	await assert.rejects(runAction({ action: 'vote-end', board: b.board }, env), /Route 23: 409/, 'the server says no → an error')
	await sleep(10)
})

test('R20 K2: moderate.mjs refuses a protected namespace before loadEnv and any docker call (exit 2); KD_FORCE=1 passes, KD_PROTECT_NS lists namespaces (SPEC-M1 §8.1)', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.copyDev('sim/lib', 'ipad')
	// a broken env.json of try in the sandbox: loadEnv would fail with its own message, so the refusal must come first
	fs.mkdirSync(path.join(sb.dev, '.state', 'try'), { recursive: true })
	fs.writeFileSync(path.join(sb.dev, '.state', 'try', 'env.json'), 'kaputt')
	sb.rules([[0, '*', '']])
	let r = sb.node('ipad/moderate.mjs', ['board', '--notes', '10'], { KD_NS: 'try' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /^\[moderate\] VERWEIGERT: Namensraum 'try' ist geschützt \(KD_PROTECT_NS\)$/m)
	assert.doesNotMatch(r.stderr, /env\.json/, 'refused before loadEnv')
	assert.equal(r.stdout, '', 'no action ran')
	assert.deepEqual(sb.calls(), [], 'no docker call')
	r = sb.node('ipad/moderate.mjs', ['board'], { KD_NS: 'try', KD_FORCE: '1' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /env\.json fehlt oder ist kaputt/, 'KD_FORCE=1 passes the guard; loadEnv refuses the broken file')
	assert.doesNotMatch(r.stderr, /VERWEIGERT/)
	r = sb.node('ipad/moderate.mjs', ['board'], { KD_NS: 'dzipad', KD_PROTECT_NS: 'try,dzipad' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /VERWEIGERT: Namensraum 'dzipad' ist geschützt/)
	assert.deepEqual(sb.calls(), [], 'still no docker call')
})
