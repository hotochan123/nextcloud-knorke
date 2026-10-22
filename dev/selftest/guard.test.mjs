/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Guards of the dev scripts.
 *
 * 1. Production (SPEC-M0 §8.1 R3): KD_APP_DIR refuses every path in the
 *    production stack. On Unraid the prod folder is also reachable through a
 *    second view, the user share (shfs, other device and inode), which the
 *    first guard missed. On this host (KD_PROD_STACK_DIR resolved by
 *    dev/lib.sh from the environment or dev/local.env; skipped when it is
 *    empty or the path does not exist) up.sh is run for a namespace nobody
 *    uses and must stop at the guard – before any container, network or
 *    state directory exists. Only reads the prod folders (test -d, cd, pwd).
 *    In the sandbox with neutral paths: the tail rule …/docker/stacks/
 *    nextcloud/… always, KD_PROD_STACK_DIR and everything below it only
 *    when set (an empty one never refuses every path), KD_PROD_APPS=1
 *    needs it.
 * 2. SPEC-M1 §0, §8.1 – run in a sandbox (lib/sandbox.mjs: a throwaway copy of
 *    the scripts and a fake docker on PATH), so not even a broken guard could
 *    reach a real container or the user's dev/.state/try:
 *    - protected namespaces: every dev script (also dev/sim/run.sh,
 *      dev/e2e/run.sh and, since stage 4, dev/load/run.sh and
 *      dev/load/variant.sh) refuses KD_NS=try without KD_FORCE=1 with exit 2,
 *      before its first docker call; KD_PROTECT_NS lists, KD_FORCE=1 passes
 *      (shown on a made-up protected namespace, never on try)
 *    - reserved names, the port table, KD_PORT=18590 only for try; the host
 *      ports 18601, 18612 and 18613 (load run's Traefik, tablet session
 *      server R-A / app relay R-B, session server R-B) are refused for every
 *      namespace, also for ipad
 *    - the stack cap with simulated networks (count + 2 > 2·KD_MAX_STACKS + 1),
 *      the shared lock, "fully subnetted" as a clear message; the default
 *      lock dir next to the copy (beside_root: /.knorke-dev, not
 *      //.knorke-dev, for a copy directly under / such as a CI bind mount)
 *    - dev/build.sh busts only running namespaces that mount its own copy
 *      (not protected, env.json .appDir and the container mount = $ROOT)
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Sandbox, devScripts } from './lib/sandbox.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NS = 'dguard'
/** PROD_STACK_DIR as dev/lib.sh resolves it on this host (KD_PROD_STACK_DIR: environment or dev/local.env), '' when unset. */
function hostProdDir() {
	const r = spawnSync('bash', ['-c', `. "${ROOT}/dev/lib.sh"; printf '%s' "$PROD_STACK_DIR"`], { env: { ...process.env, KD_NS: NS }, encoding: 'utf8' })
	assert.equal(r.status, 0, `dev/lib.sh loads on this host: ${r.stderr}`)
	return r.stdout
}
/** The second Unraid view of a pool path: the same folder as a user share (second path part "user"). */
function userShare(p) {
	const parts = p.split('/')
	return parts.length > 3 ? ['', parts[1], 'user', ...parts.slice(3)].join('/') : p
}
const PROD_DIR = hostProdDir()
const PROD = PROD_DIR
	? [...new Set([`${PROD_DIR}/nextcloud_html/custom_apps/pulse`, `${userShare(PROD_DIR)}/nextcloud_html/custom_apps/pulse`, `${userShare(PROD_DIR)}/nextcloud_html/custom_apps`])]
	: []
const PLACEHOLDER = path.join(ROOT, 'dev/selftest/placeholder')
const LEGACY = JSON.parse(fs.readFileSync(path.join(ROOT, 'dev/selftest/fixtures/legacy-env.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function up(appDir) {
	return spawnSync('bash', [path.join(ROOT, 'dev/up.sh')], {
		env: { ...process.env, KD_NS: NS, KD_PORT: '18599', KD_APP_DIR: appDir },
		encoding: 'utf8',
		timeout: 20000,
	})
}

function leftovers() {
	const r = spawnSync('docker', ['ps', '-a', '--filter', `name=knorke-dev-${NS}-`, '--format', '{{.Names}}'], { encoding: 'utf8' })
	const n = spawnSync('docker', ['network', 'ls', '--filter', `name=knorke-dev-${NS}-`, '--format', '{{.Name}}'], { encoding: 'utf8' })
	return { containers: (r.stdout || '').trim(), networks: (n.stdout || '').trim(), state: fs.existsSync(path.join(ROOT, 'dev/.state', NS)) }
}

if (!PROD_DIR) test('up.sh refuses KD_APP_DIR in the prod stack of this host', { skip: 'KD_PROD_STACK_DIR is empty on this host' }, () => {})
for (const dir of PROD) {
	test(`up.sh refuses KD_APP_DIR=${dir}`, { skip: !fs.existsSync(dir) && 'path does not exist on this host' }, () => {
		const r = up(dir)
		assert.equal(r.status, 1, r.stderr)
		assert.match(r.stderr, /liegt im Prod-Stack/, 'stopped by the prod guard, not by a later check')
		assert.deepEqual(leftovers(), { containers: '', networks: '', state: false })
	})
}

test('the guard does not refuse the repo itself or the placeholder app (this host)', () => {
	const r = spawnSync('bash', ['-c', `. "${ROOT}/dev/lib.sh"; for p in "$ROOT" "$PLACEHOLDER_DIR"; do in_prod_stack "$p" && echo "refused $p"; done; true`], {
		env: { ...process.env, KD_NS: NS }, encoding: 'utf8',
	})
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout.trim(), '')
})

test('in_prod_stack in the sandbox: the tail rule always, KD_PROD_STACK_DIR only when set, never "/*"', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const probe = (paths, extra) => {
		const r = sb.lib(`for p in ${paths.map((p) => `'${p}'`).join(' ')}; do if in_prod_stack "$p"; then echo "yes $p"; else echo "no $p"; fi; done`, { KD_NS: NS, ...extra })
		assert.equal(r.status, 0, r.stderr)
		return Object.fromEntries(r.stdout.trim().split('\n').map((l) => [l.slice(l.indexOf(' ') + 1), l.startsWith('yes ')]))
	}
	// empty KD_PROD_STACK_DIR (neutral default): only the tail rule
	assert.deepEqual(probe(['/srv/a', '/', '/srv/x/docker/stacks/nextcloud/y', '/srv/x/docker/stacks/nextcloud', '/srv/x/docker/stacks/nextcloud/', '/srv/prodstack'], {}), {
		'/srv/a': false, '/': false, '/srv/x/docker/stacks/nextcloud/y': true, '/srv/x/docker/stacks/nextcloud': true, '/srv/x/docker/stacks/nextcloud/': true, '/srv/prodstack': false,
	})
	assert.equal(sb.lib('printf "[%s]" "$PROD_STACK_DIR"', { KD_NS: NS }).stdout, '[]')
	// set: the folder itself, everything below it and the second view by its tail
	const prod = '/srv/pool/docker/stacks/nextcloud'
	assert.deepEqual(probe([prod, `${prod}/nextcloud_html`, '/srv/share/docker/stacks/nextcloud/nextcloud_html/apps/pulse', '/srv/share/docker/stacks/claude_projects/knorke'], { KD_PROD_STACK_DIR: prod }), {
		[prod]: true, [`${prod}/nextcloud_html`]: true, '/srv/share/docker/stacks/nextcloud/nextcloud_html/apps/pulse': true, '/srv/share/docker/stacks/claude_projects/knorke': false,
	})
	let r = sb.lib('for p in "$ROOT" "$PLACEHOLDER_DIR"; do in_prod_stack "$p" && echo "refused $p"; done; true', { KD_NS: NS, KD_PROD_STACK_DIR: prod })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, '', '$ROOT and the placeholder app are not refused')
	// a prod dir without the tail: only KD_PROD_STACK_DIR catches it, a trailing / is dropped
	assert.deepEqual(probe(['/srv/prodstack', '/srv/prodstack/x/y', '/srv/prodstackx', '/srv'], { KD_PROD_STACK_DIR: '/srv/prodstack/' }), {
		'/srv/prodstack': true, '/srv/prodstack/x/y': true, '/srv/prodstackx': false, '/srv': false,
	})
	assert.equal(sb.lib('printf "[%s]" "$PROD_STACK_DIR"', { KD_NS: NS, KD_PROD_STACK_DIR: '/srv/prodstack/' }).stdout, '[/srv/prodstack]')
})

test('up.sh in the sandbox: KD_APP_DIR on the second view is refused, KD_PROD_APPS=1 needs KD_PROD_STACK_DIR – both before any docker call', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.rules([[0, '*', '']])
	let r = sb.run('up.sh', [], { KD_NS: NS, KD_PORT: '18609', KD_PROD_STACK_DIR: '/srv/pool/docker/stacks/nextcloud', KD_APP_DIR: '/srv/share/docker/stacks/nextcloud/nextcloud_html/apps/pulse' })
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /liegt im Prod-Stack/)
	assert.deepEqual(sb.calls(), [], 'no docker call')
	sb.rules([[0, '*', '']])
	r = sb.run('up.sh', [], { KD_NS: NS, KD_PORT: '18609', KD_PROD_APPS: '1', KD_APP_DIR: PLACEHOLDER })
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /KD_PROD_APPS=1 braucht KD_PROD_STACK_DIR/)
	assert.deepEqual(sb.calls(), [], 'no docker call')
	assert.equal(fs.existsSync(path.join(sb.dev, '.state', NS)), false, 'no state')
})

// --- protected namespaces ------------------------------------------------------

// Every dev script with arguments that would make it work (and touch docker)
// if the guard let it through.
const CALLS = {
	'up.sh': [],
	'down.sh': [],
	'restart.sh': [],
	'bust.sh': [],
	'occ.sh': ['app:list'],
	'db.sh': ['-c', 'SELECT 1'],
	'psql.sh': ['-Atc', 'SELECT 1'],
	'redis-keys.sh': [],
	'logs.sh': [],
	'sim/run.sh': ['contract'],
	'e2e/run.sh': ['--list'],
	'e2e/hostbridge.sh': ['/nonexistent-kd-bridge'],
	'e2e/selftest-fixtures.sh': ['up'],
	'selftest/isolation.sh': [],
	'selftest/updown.sh': ['nextcloud:34-apache'],
	'selftest/upgrade.sh': ['--db', 'pgsql'],
	// SPEC-M1 §8.1 R2, §8.7 (stage 4): the load run and its variants
	'load/run.sh': ['S4'],
	'load/variant.sh': ['dbpersistent'],
	// SPEC-M1 §10 P5 R19 (stage 4): the restore probe
	'selftest/restore.sh': [],
}
// Scripts that work across namespaces instead of on KD_NS.
const CROSS_NS = ['build.sh', 'clean-reports.sh', 'release.sh']

test('every dev script sources dev/lib.sh, whose namespace guard runs while it is sourced', () => {
	const scripts = devScripts()
	assert.deepEqual(scripts.filter((s) => !CROSS_NS.includes(s)).sort(), Object.keys(CALLS).sort(),
		'every dev/**.sh is in the refusal table below (a new script needs a row)')
	for (const s of scripts) {
		const src = fs.readFileSync(path.join(ROOT, 'dev', s), 'utf8')
		assert.match(src, /^\. "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/(\.\.\/)*lib\.sh"$/m, `${s} sources dev/lib.sh`)
		const before = src.slice(0, src.search(/^\. "\$\(dirname/m))
		assert.doesNotMatch(before, /^\s*docker /m, `${s}: no docker call before sourcing dev/lib.sh`)
	}
	const lib = fs.readFileSync(path.join(ROOT, 'dev/lib.sh'), 'utf8')
	assert.match(lib, /^KD_PROTECT_NS="\$\{KD_PROTECT_NS-try\}"$/m, 'default protected namespace try, "-" keeps an explicit empty value')
	const guardAt = lib.search(/^guard_ns$/m)
	assert.ok(guardAt > 0, 'lib.sh calls guard_ns at top level')
	assert.ok(lib.slice(0, guardAt).split('\n').every((l) => !/^\s*docker /.test(l)), 'no docker call in lib.sh before the guard')
	const build = fs.readFileSync(path.join(ROOT, 'dev/build.sh'), 'utf8')
	assert.match(build, /^unset KD_NS$/m, 'build.sh ignores KD_NS')
	for (const s of CROSS_NS) {
		const src = fs.readFileSync(path.join(ROOT, 'dev', s), 'utf8')
		assert.ok(src.search(/^unset KD_NS$/m) >= 0 && src.search(/^unset KD_NS$/m) < src.search(/^\. "\$\(dirname/m), `${s}: unset KD_NS before sourcing dev/lib.sh`)
	}
	const upg = fs.readFileSync(path.join(ROOT, 'dev/selftest/upgrade.sh'), 'utf8')
	assert.match(upg, /^export KD_NS="\$\{KD_NS:-br\}"$/m, 'upgrade.sh: namespace br by default, the guard still sees an exported KD_NS=try')
	for (const s of ['load/run.sh', 'load/variant.sh']) {
		assert.match(fs.readFileSync(path.join(ROOT, 'dev', s), 'utf8'), /^export KD_NS="\$\{KD_NS:-load\}"$/m, `${s}: namespace load by default, the guard still sees an exported KD_NS=try`)
	}
	assert.match(build, /env -u KD_FORCE KD_NS="\$ns" "\$DEV\/bust\.sh"/, 'build.sh never passes KD_FORCE on to bust.sh')
})

test('KD_NS=try is refused with exit 2 by every dev script without KD_FORCE=1, before any docker call', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	// The user's state as it exists in $ROOT – it must survive every refusal.
	const envFile = sb.writeEnv('try', { ...LEGACY, appDir: sb.root })
	const before = fs.readFileSync(envFile, 'utf8')
	for (const [script, args] of Object.entries(CALLS)) {
		for (const force of [undefined, '0', 'yes', 'true', ' 1']) {
			sb.rules([[0, '*', 'true\n']]) // a broken guard would find a "running" try
			const extra = { KD_NS: 'try' }
			if (force !== undefined) extra.KD_FORCE = force
			const r = sb.run(script, args, extra)
			const what = `${script} KD_FORCE=${force}`
			assert.equal(r.status, 2, `${what}: exit 2 (${r.stderr})`)
			assert.match(r.stderr, /VERWEIGERT: Namensraum 'try' ist geschützt \(KD_PROTECT_NS='try'\)/, what)
			assert.match(r.stderr, new RegExp(`KD_FORCE=1 KD_NS=try dev/${script.replace('.', '\\.')}`), `${what}: names the script`)
			assert.deepEqual(sb.calls(), [], `${what}: no docker call`)
		}
	}
	assert.equal(fs.readFileSync(envFile, 'utf8'), before, 'dev/.state/try untouched')
	assert.deepEqual(fs.readdirSync(path.join(sb.dev, '.state')).sort(), ['try'], 'no state for anything else')
	assert.equal(fs.existsSync(sb.lockDir), false, 'up.sh stopped before the stack lock')
})

test('KD_PROTECT_NS lists namespaces; KD_FORCE=1 passes; an empty list protects nothing; a malformed one stops everything', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const occOk = [
		[0, 'container inspect -f {{.State.Running}} knorke-dev-*-nc', 'true\n'],
		[0, 'exec -i -u www-data knorke-dev-*-nc php occ app:list', 'fake-occ\n'],
	]
	for (const list of ['try,dzprot', 'try dzprot', 'dzprot', ' dzprot ,try']) {
		sb.rules(occOk)
		const r = sb.run('occ.sh', ['app:list'], { KD_NS: 'dzprot', KD_PROTECT_NS: list })
		assert.equal(r.status, 2, `KD_PROTECT_NS='${list}': ${r.stderr}`)
		assert.match(r.stderr, /VERWEIGERT: Namensraum 'dzprot' ist geschützt/)
		assert.deepEqual(sb.calls(), [])
	}
	// KD_FORCE=1 – only ever shown on a made-up protected namespace
	sb.rules(occOk)
	let r = sb.run('occ.sh', ['app:list'], { KD_NS: 'dzprot', KD_PROTECT_NS: 'try dzprot', KD_FORCE: '1' })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, 'fake-occ\n')
	assert.match(r.stderr, /WARNUNG: Namensraum 'dzprot' ist geschützt .* KD_FORCE=1, weiter/)
	assert.deepEqual(sb.calls(), ['container inspect -f {{.State.Running}} knorke-dev-dzprot-nc', 'exec -i -u www-data knorke-dev-dzprot-nc php occ app:list'])
	// an unprotected namespace passes silently, also with an explicitly empty list
	for (const env of [{ KD_NS: 'dzfree' }, { KD_NS: 'dzfree', KD_PROTECT_NS: '' }]) {
		sb.rules(occOk)
		r = sb.run('occ.sh', ['app:list'], env)
		assert.equal(r.status, 0, r.stderr)
		assert.doesNotMatch(r.stderr, /geschützt/)
	}
	// the default protects try only
	r = sb.lib('is_protected try && echo try; is_protected main || echo main-free; is_protected tr || echo tr-free')
	assert.equal(r.stdout, 'try\nmain-free\ntr-free\n', r.stderr)
	// malformed lists stop before anything else (exit 1), never a silent "no protection"
	for (const bad of ['Try', 'try;rm', 'tr*', 'averyverylongname', 'try/x']) {
		sb.rules(occOk)
		r = sb.run('occ.sh', ['app:list'], { KD_NS: 'dzfree', KD_PROTECT_NS: bad })
		assert.equal(r.status, 1, `KD_PROTECT_NS='${bad}': ${r.stderr}`)
		assert.match(r.stderr, /KD_PROTECT_NS/)
		assert.deepEqual(sb.calls(), [])
	}
})

test('reserved names are no namespace (lib.sh and both outDir())', async (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	for (const ns of ['shots', 'report', 'bridge', 'out']) {
		const r = sb.run('occ.sh', ['app:list'], { KD_NS: ns })
		assert.equal(r.status, 1, r.stderr)
		assert.match(r.stderr, new RegExp(`KD_NS='${ns}' ist reserviert`))
		assert.deepEqual(sb.calls(), [])
	}
	const lib = fs.readFileSync(path.join(ROOT, 'dev/lib.sh'), 'utf8')
	const shList = lib.match(/^KD_RESERVED_NS="([^"]+)"$/m)[1].split(' ')
	const bridge = await import(path.join(ROOT, 'dev/e2e/lib/bridge.mjs'))
	const report = await import(path.join(ROOT, 'dev/sim/lib/report.mjs'))
	assert.deepEqual([...bridge.RESERVED_NS], shList, 'dev/e2e/lib/bridge.mjs = dev/lib.sh')
	assert.deepEqual([...report.RESERVED_NS], shList, 'dev/sim/lib/report.mjs = dev/lib.sh')
	for (const ns of shList) {
		assert.throws(() => bridge.outDir({ KD_NS: ns }), /reserviert/)
		assert.throws(() => report.outDir(ns), /reserviert/)
	}
	assert.equal(bridge.outDir({ KD_NS: 'd' }), path.join(ROOT, 'dev/e2e/out/d'))
	assert.equal(report.outDir('d'), path.join(ROOT, 'dev/sim/out/d'))
})

test('port table (SPEC-M1 §8.1), KD_PORT=18590 only for try, 18601/18612/18613 never', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const table = { main: 18580, b: 18581, c: 18582, d: 18583, br: 18584, try: 18590, rm: 18591, rs: 18592, rx: 18593, ry: 18594,
		dm: 18595, dy: 18596, dq: 18597, dl: 18598, load: 18599, nf: 18600, ipad: 18611, x: '', n5: '' }
	const r = sb.lib(Object.keys(table).map((ns) => `printf '%s=%s\\n' ${ns} "$(default_port ${ns})"`).join('\n'))
	assert.equal(r.stdout, Object.entries(table).map(([k, v]) => `${k}=${v}\n`).join(''), r.stderr)
	const ports = Object.values(table).filter(Boolean)
	assert.equal(new Set(ports).size, ports.length, 'no port twice')
	// no default port is a reserved host port
	for (const p of [18601, 18612, 18613]) assert.ok(!ports.includes(p), `default_port never ${p}`)
	const r2 = sb.lib('printf "%s\\n" "$KD_NON_NC_PORTS"')
	assert.equal(r2.stdout, '18601 18612 18613\n', r2.stderr)
	for (const [ns, port] of [['dzport', '18590'], ['main', '18590'], ['nf', '18590'], ['dzport', '18601'], ['dzport', '18612'],
		['dzport', '18613'], ['ipad', '18612'], ['ipad', '18613'], ['load', '18601']]) {
		sb.rules([])
		const u = sb.run('up.sh', [], { KD_NS: ns, KD_PORT: port, KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1' })
		assert.equal(u.status, 2, `${ns}:${port} ${u.stderr}`)
		assert.match(u.stderr, port === '18590' ? /KD_PORT=18590 gehört dem Nutzer-Stack try/ : new RegExp(`KD_PORT=${port} ist reserviert`))
		if (port === '18612' || port === '18613') assert.match(u.stderr, /18612 Sitzungsserver R-A bzw\. App-Relais R-B, 18613 Sitzungsserver R-B/, 'the refusal names both session ports')
		assert.deepEqual(sb.calls(), [], 'refused before any docker call')
	}
})

// --- stack cap -------------------------------------------------------------------

/** Rules for up.sh in namespace dzcap with the given `docker network ls` listing. */
function capRules(listing, create = [[1, 'network create *', '', 'fake: network create stopped here\n']]) {
	return [
		[1, 'network inspect *', '', 'Error: No such network\n'],
		[1, 'container inspect *', '', 'Error: No such container\n'],
		[0, 'ps -aq --filter label=*', ''],
		[0, 'network ls -q --filter label=*', ''],
		[0, 'network ls --format *', listing.map((l) => l + '\n').join('')],
		...create,
	]
}
const knorkeNets = (n) => Array.from({ length: n }, (_, i) => i === 0 ? 'knorke-dev-try-net|knorke=dev-try' : `knorke-dev-s${i}-net|knorke=dev-s${i}`)
const otherNets = ['bridge|', 'host|', 'none|', 'crowdsec|com.docker.compose.network=crowdsec,com.docker.compose.project=traefik-crowdsec',
	'nextcloud_default|com.docker.compose.project=nextcloud,com.docker.compose.network=default', 'x|maintainer=knorke']
const upCap = (sb, extra = {}) => sb.run('up.sh', [], { KD_NS: 'dzcap', KD_PORT: '18609', KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1', ...extra })
const created = (sb) => sb.calls().filter((c) => c.startsWith('network create'))

test('stack cap: count + 2 > 2·KD_MAX_STACKS + 1 is refused before any network exists', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	// try + 4 stacks = 9 networks: a 5th stack still fits (11)
	sb.rules(capRules([...knorkeNets(9), ...otherNets]))
	let r = upCap(sb)
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /9 von 11 Knorke-Netzen belegt/)
	assert.deepEqual(created(sb), ['network create --label knorke=dev-dzcap knorke-dev-dzcap-net'], 'allowed: up.sh went on to create its network')
	assert.ok(fs.existsSync(path.join(sb.lockDir, 'stacks.lock')), 'the shared lock file lives in KD_LOCK_DIR')

	// try + 5 stacks = 11: a 6th is refused
	for (const listing of [knorkeNets(10), knorkeNets(11), [...knorkeNets(8), 'spike-a|knorke-spike=1', 'spike-b|knorke-spike.run=a,other=b', ...otherNets]]) {
		sb.rules(capRules(listing))
		r = upCap(sb)
		const n = listing.filter((l) => /\|(.*,)?knorke/.test(l)).length
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, new RegExp(`VERWEIGERT: Stack-Deckel: ${n} Knorke-Netze belegt, ein Stack braucht 2, erlaubt sind 11 \\(KD_MAX_STACKS=5`))
		assert.match(r.stderr, /knorke-dev-try-net/, 'lists the networks it counted')
		assert.deepEqual(created(sb), [], 'no network created')
	}
	assert.equal(fs.existsSync(path.join(sb.dev, '.state', 'dzcap')), false, 'no state directory after a refusal')

	// the cap is a knob
	sb.rules(capRules(knorkeNets(10)))
	r = upCap(sb, { KD_MAX_STACKS: '6' })
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /10 von 13 Knorke-Netzen belegt/)
	assert.equal(created(sb).length, 1)
	for (const bad of ['0', 'x', '-1', '100']) {
		sb.rules(capRules([]))
		r = upCap(sb, { KD_MAX_STACKS: bad })
		assert.equal(r.status, 1, `KD_MAX_STACKS=${bad}`)
		assert.match(r.stderr, /KD_MAX_STACKS='.*' ist ungültig/)
		assert.deepEqual(created(sb), [])
	}
})

test('stack cap: an exhausted address pool becomes a clear message, a half-made pair is removed', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const pool = 'Error response from daemon: all predefined address pools have been fully subnetted\n'
	sb.rules(capRules(knorkeNets(3), [[1, 'network create *', '', pool], [0, 'network ls -q', 'a\nb\nc\n']]))
	let r = upCap(sb)
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /VERWEIGERT: Docker hat keine freien Adress-Pools mehr \(Error response from daemon: all predefined address pools have been fully subnetted\)/)
	assert.match(r.stderr, /Knorke belegt 3 von 11 Netzen \(Deckel KD_MAX_STACKS=5 neben try\)/)
	assert.match(r.stderr, /auch Netze anderer Projekte füllen die Pools \(3 Netze insgesamt/)
	// front network made, internal one fails: the front one goes again
	sb.rules(capRules(knorkeNets(3), [
		[1, 'network create --internal *', '', pool],
		[0, 'network create --label knorke=dev-dzcap knorke-dev-dzcap-net', 'abc\n'],
		[0, 'network rm knorke-dev-dzcap-net', 'knorke-dev-dzcap-net\n'],
		[0, 'network ls -q', 'a\n'],
	]))
	r = upCap(sb)
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /keine freien Adress-Pools/)
	assert.deepEqual(sb.calls().filter((c) => /^network (create|rm)/.test(c)), [
		'network create --label knorke=dev-dzcap knorke-dev-dzcap-net',
		'network create --internal --label knorke=dev-dzcap knorke-dev-dzcap-back',
		'network rm knorke-dev-dzcap-net',
	])
	assert.equal(fs.existsSync(path.join(sb.dev, '.state', 'dzcap')), false)
})

test('stack cap: counting and creating wait for the shared lock', async (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	fs.mkdirSync(sb.lockDir, { recursive: true })
	// -o: the lock stays with flock itself, not with its sleep child; own process group for the kill
	const holder = spawn('flock', ['-x', '-o', path.join(sb.lockDir, 'stacks.lock'), 'sleep', '20'], { stdio: 'ignore', detached: true })
	const release = (sig) => { try { process.kill(-holder.pid, sig) } catch { /* gone */ } }
	t.after(() => release('SIGKILL'))
	await sleep(300)
	sb.rules(capRules([]))
	let r = await sb.runAsync('up.sh', [], { KD_NS: 'dzcap', KD_PORT: '18609', KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1', KD_LOCK_WAIT: '1' })
	assert.equal(r.status, 2, r.stderr)
	assert.match(r.stderr, /warte auf die Stack-Sperre/)
	assert.match(r.stderr, /VERWEIGERT: die Stack-Sperre .*stacks\.lock ist nach 1 s noch belegt/)
	assert.deepEqual(sb.calls().filter((c) => c.startsWith('network ls --format') || c.startsWith('network create')), [], 'neither counted nor created while another up.sh holds the lock')
	release('SIGTERM')
	await sleep(300)
	sb.rules(capRules([]))
	r = await sb.runAsync('up.sh', [], { KD_NS: 'dzcap', KD_PORT: '18609', KD_APP_DIR: PLACEHOLDER, KD_SKIP_BUILD_CHECK: '1', KD_LOCK_WAIT: '1' })
	assert.equal(r.status, 1, r.stderr)
	assert.match(r.stderr, /0 von 11 Knorke-Netzen belegt/, 'lock free: counted and went on')
})

test('the default lock dir lies next to the repo copy, outside it', () => {
	const r = spawnSync('bash', ['-c', `. "${ROOT}/dev/lib.sh"; printf '%s\\n' "$KD_LOCK_DIR"`], {
		env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('KD_'))), encoding: 'utf8',
	})
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout.trim(), path.join(path.dirname(fs.realpathSync(ROOT)), '.knorke-dev'))
})

test('paths next to the repo copy have no double slash, also for a copy directly under / (CI bind mount /src)', (t) => {
	// A real copy at /src cannot be made here (nothing is written under /), so
	// beside_root runs with ROOT set by hand – the default KD_LOCK_DIR and
	// upgrade.sh's M0 snapshot go through it (checked below).
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const roots = ['/src', '/home/runner/work/nextcloud-knorke/nextcloud-knorke', '/srv/docker/stacks/claude_projects/knorke-m1']
	const r = sb.lib(`for r in ${roots.join(' ')}; do ROOT="$r"; beside_root .knorke-dev; done; ROOT=/src; beside_root .knorke-m1-phase/root-base`)
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(r.stdout.trim().split('\n'), [
		'/.knorke-dev',
		'/home/runner/work/nextcloud-knorke/.knorke-dev',
		'/srv/docker/stacks/claude_projects/.knorke-dev',
		'/.knorke-m1-phase/root-base',
	])
	// the default lock dir is beside_root's (KD_LOCK_DIR unset, the sandbox sets one)
	const d = spawnSync('bash', ['-c', `. "${sb.dev}/lib.sh"; printf '%s\\n' "$KD_LOCK_DIR"; beside_root .knorke-dev`], {
		env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('KD_'))), encoding: 'utf8',
	})
	assert.equal(d.status, 0, d.stderr)
	const [lockDir, beside] = d.stdout.trim().split('\n')
	assert.equal(lockDir, beside)
	assert.equal(lockDir, path.join(path.dirname(sb.root), '.knorke-dev'))
	// no dev script builds such a path by hand ($(dirname "$ROOT")/… gives //… at /src)
	for (const rel of ['lib.sh', ...devScripts()]) {
		assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'dev', rel), 'utf8'), /\$\(dirname "\$\{?ROOT\}?"\)\//, `dev/${rel} uses beside_root`)
	}
})

// --- build.sh --------------------------------------------------------------------

test('dev/build.sh busts only running namespaces that mount its own copy and are not protected', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	fs.mkdirSync(path.join(sb.root, 'js'))
	fs.writeFileSync(path.join(sb.root, 'js/knorke-main.mjs'), '')
	const elsewhere = '/srv/docker/stacks/claude_projects/knorke-elsewhere'
	// try as the user's stack in $ROOT: mounts this copy, but is protected
	sb.writeEnv('try', { ...LEGACY, appDir: sb.root })
	sb.writeEnv('dzown', { ns: 'dzown', appDir: sb.root })
	sb.writeEnv('dzoth', { ns: 'dzoth', appDir: elsewhere })
	sb.writeEnv('dzmnt', { ns: 'dzmnt', appDir: sb.root })
	sb.writeEnv('dzplh', { ns: 'dzplh', appDir: path.join(sb.root, 'dev/selftest/placeholder') })
	// dzfor: running, but its state lives in another copy (none here)
	const mount = (ns, src) => [0, `container inspect -f {{range .Mounts}}* knorke-dev-${ns}-nc`, src + '\n']
	const rules = [
		[0, 'ps --filter label=knorke --format *', 'dev-try\ndev-dzown\ndev-dzoth\ndev-dzfor\ndev-dzmnt\ndev-dzplh\nspike-x\ndev-dzoff\n'],
		[1, 'container inspect -f {{.State.Running}} knorke-dev-dzoff-nc', 'false\n'],
		[0, 'container inspect -f {{.State.Running}} knorke-dev-*-nc', 'true\n'],
		mount('dzmnt', elsewhere),
		mount('*', sb.root),
		[0, 'exec -u www-data knorke-dev-*-nc php occ config:app:get theming cachebuster', '41\n'],
		[0, 'exec -u www-data knorke-dev-*-nc php occ config:app:set theming cachebuster --value=*', ''],
	]
	const PLAN = [
		'skip dzfor kein dev/.state/dzfor/env.json in dieser Kopie (Stack einer anderen Kopie)',
		`skip dzmnt der Container mountet ${elsewhere}, nicht ${sb.root}`,
		`skip dzoth env.json .appDir ist ${elsewhere}, nicht ${sb.root}`,
		'bust dzown',
		`skip dzplh env.json .appDir ist ${sb.root}/dev/selftest/placeholder, nicht ${sb.root}`,
		'skip try geschützt (KD_PROTECT_NS)',
	]
	// --plan: the decision only, no build, no bust
	sb.rules(rules)
	let r = sb.run('build.sh', ['--plan'])
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(r.stdout.trim().split('\n'), PLAN)
	assert.deepEqual(sb.npmCalls(), [])
	assert.deepEqual(sb.calls().filter((c) => c.startsWith('exec')), [], 'no bust in --plan')

	// a real run, in the worst environment: KD_FORCE=1 and KD_NS=try exported
	sb.rules(rules)
	r = sb.run('build.sh', [], { KD_FORCE: '1', KD_NS: 'try' })
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(sb.npmCalls(), ['run build'])
	assert.deepEqual(sb.calls().filter((c) => c.startsWith('exec')), [
		'exec -u www-data knorke-dev-dzown-nc php occ config:app:get theming cachebuster',
		'exec -u www-data knorke-dev-dzown-nc php occ config:app:set theming cachebuster --value=42',
	], 'only dzown was busted')
	assert.ok(sb.calls().every((c) => !/knorke-dev-try-/.test(c) || c === 'container inspect -f {{.State.Running}} knorke-dev-try-nc'),
		'try was only looked at (docker inspect), never exec\'d')
	assert.match(r.stderr, /Cachebuster erhöht in: dzown$/m)
	assert.match(r.stderr, /ausgelassen: try – geschützt/)
	assert.match(r.stderr, /nicht angefasst: dzfor dzmnt dzoth dzplh try/)
	assert.ok(fs.existsSync(path.join(sb.dev, '.state/try/env.json')))

	// nothing running of this copy: builds, busts nothing
	sb.rules([[0, 'ps --filter label=knorke --format *', 'dev-try\n'], ...rules.slice(1)])
	r = sb.run('build.sh')
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(sb.calls().filter((c) => c.startsWith('exec')), [])
	assert.match(r.stderr, /Cachebuster erhöht in: \(kein laufender Namensraum dieser Kopie\)/)
	assert.equal(sb.run('build.sh', ['--bogus']).status, 1)
})
