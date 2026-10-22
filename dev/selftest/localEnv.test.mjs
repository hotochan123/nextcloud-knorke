/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The local values of the dev scripts (docs/ENTWICKLUNG.md §3.10, SPEC-M1
 * §12.1 R16): dev/lib.sh takes KD_DNS, KD_LAN_HOST and KD_PROD_STACK_DIR from
 * the environment, else from the untracked dev/local.env, else empty. All
 * cases run in the sandbox (lib/sandbox.mjs, KD_LOCAL_ENV='' by default, a
 * fake docker), with neutral values only:
 * - no file, or the all-commented template dev/local.env.example: all empty
 * - the file fills unset variables; a set one wins, also an empty KD_DNS=
 * - comments and blank lines are skipped; an unknown key, a line without =,
 *   a duplicate key, "export", a blank before the = and an invalid value of
 *   each key stop every script with exit 1 and <file>:<line>, before any
 *   docker call; $(…) and backticks are never run; the KD_DNS message says
 *   "ohne Anführungszeichen"
 * - a UTF-8 BOM at the start of line 1 is dropped (also with LC_ALL=C), one
 *   at the start of a later line stays an unknown key
 * - KD_LOCAL_ENV: a missing file is exit 1, a relative path is relative to
 *   $ROOT; without it $ROOT/dev/local.env, in a linked git worktree without
 *   its own file the one of the main working tree, the worktree's own wins
 * - KD_DNS: up.sh creates the Nextcloud container with --dns only for a
 *   non-empty value; neither up.sh nor e2e/run.sh has an address default
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Sandbox, REPO } from './lib/sandbox.mjs'
import { GIT_REDIRECT_VARS } from './lib/privateValues.mjs'

const NS = 'dzlocal'
const PRINT = 'printf "%s|%s|%s\\n" "${KD_DNS-}" "${KD_LAN_HOST-}" "$PROD_STACK_DIR"'
const FULL = 'KD_DNS=192.168.1.1\nKD_LAN_HOST=192.168.1.20\nKD_PROD_STACK_DIR=/srv/pool/docker/stacks/nextcloud/\n'
const FULL_OUT = '192.168.1.1|192.168.1.20|/srv/pool/docker/stacks/nextcloud\n'
/** No git variables of a calling hook may redirect the temp repositories. */
const NO_GIT = Object.fromEntries(GIT_REDIRECT_VARS.map((k) => [k, undefined]))

function sandbox(t) {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.copyDev('local.env.example')
	return sb
}
/** Writes a file below the sandbox root, returns its absolute path. */
function put(sb, rel, text) {
	const f = path.join(sb.root, rel)
	fs.mkdirSync(path.dirname(f), { recursive: true })
	fs.writeFileSync(f, text)
	return f
}
const values = (sb, extra = {}) => sb.lib(PRINT, { KD_NS: NS, ...extra })

test('the sandbox keeps the host file out: KD_LOCAL_ENV is set and empty', (t) => {
	const sb = sandbox(t)
	assert.equal(sb.env().KD_LOCAL_ENV, '')
	assert.equal('KD_DNS' in sb.env(), false, 'no KD_DNS of its own any more (the default is empty now)')
	const r = sb.lib('printf "[%s]" "${KD_LOCAL_ENV-unset}"')
	assert.equal(r.stdout, '[]')
})

test('no file, or the all-commented template: three empty values; uncommented, the template is a valid file', (t) => {
	const sb = sandbox(t)
	for (const extra of [{}, { KD_LOCAL_ENV: 'dev/local.env.example' }, { KD_LOCAL_ENV: path.join(REPO, 'dev/local.env.example') }]) {
		const r = values(sb, extra)
		assert.equal(r.status, 0, r.stderr)
		assert.equal(r.stdout, '||\n', JSON.stringify(extra))
	}
	// the template with its three "# KEY=value" lines uncommented is a valid file
	const text = fs.readFileSync(path.join(REPO, 'dev/local.env.example'), 'utf8').replace(/^# (KD_[A-Z_]+=\S*)$/gm, '$1')
	const r = values(sb, { KD_LOCAL_ENV: put(sb, 'conf/example.env', text) })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, '192.168.1.1|192.168.1.20|/srv/docker/stacks/nextcloud\n', 'the neutral example values')
})

test('the file fills unset variables; a set variable wins, also an empty KD_DNS=; comments, blank lines and outer blanks do not count', (t) => {
	const sb = sandbox(t)
	const f = put(sb, 'conf/a.env', `# local values\n\n   # indented comment\n   \nKD_DNS=  192.168.1.1 \r\n${FULL.split('\n').slice(1).join('\n')}`)
	let r = values(sb, { KD_LOCAL_ENV: f })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, FULL_OUT)
	for (const [extra, out] of [
		[{ KD_DNS: '' }, '|192.168.1.20|/srv/pool/docker/stacks/nextcloud\n'],
		[{ KD_DNS: '10.0.0.1' }, '10.0.0.1|192.168.1.20|/srv/pool/docker/stacks/nextcloud\n'],
		[{ KD_LAN_HOST: '10.0.0.5' }, '192.168.1.1|10.0.0.5|/srv/pool/docker/stacks/nextcloud\n'],
		[{ KD_LAN_HOST: '' }, '192.168.1.1||/srv/pool/docker/stacks/nextcloud\n'],
		[{ KD_PROD_STACK_DIR: '/srv/other' }, '192.168.1.1|192.168.1.20|/srv/other\n'],
		[{ KD_PROD_STACK_DIR: '' }, '192.168.1.1|192.168.1.20|\n'],
	]) {
		r = values(sb, { KD_LOCAL_ENV: f, ...extra })
		assert.equal(r.status, 0, r.stderr)
		assert.equal(r.stdout, out, JSON.stringify(extra))
	}
	// IPv6 for the DNS server, a file without a trailing newline
	r = values(sb, { KD_LOCAL_ENV: put(sb, 'conf/b.env', 'KD_DNS=fd00::53') })
	assert.equal(r.stdout, 'fd00::53||\n', r.stderr)
})

test('a broken file stops every script with exit 1 and <file>:<line>, before any docker call; nothing in it is run', (t) => {
	const sb = sandbox(t)
	const marker = path.join(sb.root, 'marker')
	const cases = [
		['unknown key', 'KD_DNS=192.168.1.1\n# ok\nKD_FOO=1\n', 3, /unbekannter Schlüssel 'KD_FOO'/],
		['no =', '\nKD_DNS\n', 2, /Zeile ohne '='/],
		['duplicate', 'KD_DNS=192.168.1.1\nKD_LAN_HOST=192.168.1.20\nKD_DNS=192.168.1.1\n', 3, /KD_DNS steht doppelt/],
		['export', 'export KD_DNS=192.168.1.1\n', 1, /unbekannter Schlüssel 'export KD_DNS'/],
		['blank before =', 'KD_DNS =192.168.1.1\n', 1, /unbekannter Schlüssel 'KD_DNS '/],
		['lower case key', 'kd_dns=192.168.1.1\n', 1, /unbekannter Schlüssel/],
		['KD_DNS name', 'KD_DNS=resolver.example\n', 1, /KD_DNS='resolver\.example' .* ist ungültig/],
		['KD_DNS 256', 'KD_DNS=192.168.1.256\n', 1, /KD_DNS='192\.168\.1\.256' .* ist ungültig/],
		['KD_DNS quoted', 'KD_DNS="192.168.1.1"\n', 1, /KD_DNS='"192\.168\.1\.1"' .* ist ungültig \(leer, IPv4 oder IPv6-Literal, ohne Anführungszeichen\)/],
		['KD_LAN_HOST public', 'KD_LAN_HOST=8.8.8.8\n', 1, /KD_LAN_HOST='8\.8\.8\.8' .* ist ungültig/],
		['KD_LAN_HOST broadcast', 'KD_LAN_HOST=192.168.1.255\n', 1, /KD_LAN_HOST='192\.168\.1\.255' .* ist ungültig/],
		['KD_LAN_HOST leading zero', 'KD_LAN_HOST=192.168.01.20\n', 1, /KD_LAN_HOST='192\.168\.01\.20' .* ist ungültig/],
		['KD_PROD_STACK_DIR relative', 'KD_PROD_STACK_DIR=srv/stack\n', 1, /KD_PROD_STACK_DIR='srv\/stack' .* ist ungültig/],
		['KD_PROD_STACK_DIR root', 'KD_PROD_STACK_DIR=/\n', 1, /KD_PROD_STACK_DIR='\/' .* ist ungültig/],
		['KD_PROD_STACK_DIR ..', 'KD_PROD_STACK_DIR=/srv/../etc\n', 1, /KD_PROD_STACK_DIR='\/srv\/\.\.\/etc' .* ist ungültig/],
		['$(…) in KD_DNS', `KD_DNS=$(touch ${marker})\n`, 1, /KD_DNS='\$\(touch .*\)' .* ist ungültig/],
		['backticks in KD_LAN_HOST', `KD_LAN_HOST=\`touch ${marker}\`\n`, 1, /KD_LAN_HOST='`touch .*`' .* ist ungültig/],
		['$(…) in KD_PROD_STACK_DIR', `KD_PROD_STACK_DIR=/srv/$(touch ${marker})\n`, 1, /KD_PROD_STACK_DIR='\/srv\/\$\(touch .*\)' .* ist ungültig/],
		['backticks in KD_PROD_STACK_DIR', `KD_PROD_STACK_DIR=/srv/\`touch ${marker}\`\n`, 1, /KD_PROD_STACK_DIR=.* ist ungültig/],
	]
	for (const [what, text, line, re] of cases) {
		const f = put(sb, 'conf/bad.env', text)
		for (const script of ['down.sh', 'up.sh']) {
			sb.rules([[0, '*', '']])
			const r = sb.run(script, [], { KD_NS: NS, KD_PORT: '18609', KD_LOCAL_ENV: f })
			assert.equal(r.status, 1, `${what} (${script}): ${r.stderr}`)
			assert.ok(r.stderr.includes(`${f}:${line}`), `${what} (${script}) names ${f}:${line}: ${r.stderr}`)
			assert.match(r.stderr, re, what)
			assert.match(r.stderr, /KD_LOCAL_ENV= liest keine Datei/, `${what}: names the way around the file`)
			assert.deepEqual(sb.calls(), [], `${what} (${script}): no docker call`)
		}
		assert.equal(fs.existsSync(marker), false, `${what}: nothing was run`)
	}
	// the same values from the environment are checked as well (source: the environment), never run
	for (const [key, value] of [['KD_DNS', `$(touch ${marker})`], ['KD_LAN_HOST', '0.0.0.0'], ['KD_PROD_STACK_DIR', `/srv/\`touch ${marker}\``]]) {
		sb.rules([[0, '*', '']])
		const r = sb.run('down.sh', [], { KD_NS: NS, [key]: value })
		assert.equal(r.status, 1, r.stderr)
		assert.match(r.stderr, new RegExp(`${key}='.*' \\(aus der Umgebung\\) ist ungültig`))
		assert.doesNotMatch(r.stderr, /KD_LOCAL_ENV=/, 'no file hint for a value of the environment')
		assert.deepEqual(sb.calls(), [])
	}
	assert.equal(fs.existsSync(marker), false)
	// KD_LOCAL_ENV= bypasses a broken file
	const r = values(sb, { KD_LOCAL_ENV: '' })
	assert.equal(r.stdout, '||\n', r.stderr)
})

test('a UTF-8 BOM at the start of line 1 is dropped, also with LC_ALL=C; one at the start of a later line is an unknown key', (t) => {
	const sb = sandbox(t)
	const BOM = '\uFEFF' // written to the file as the bytes EF BB BF
	const f = put(sb, 'conf/bom.env', BOM + FULL)
	assert.deepEqual([...fs.readFileSync(f).subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the file starts with the three BOM bytes')
	for (const extra of [{}, { LC_ALL: 'C' }]) {
		const r = values(sb, { KD_LOCAL_ENV: f, ...extra })
		assert.equal(r.status, 0, `${JSON.stringify(extra)}: ${r.stderr}`)
		assert.equal(r.stdout, FULL_OUT, JSON.stringify(extra))
	}
	let r = values(sb, { KD_LOCAL_ENV: put(sb, 'conf/bom-comment.env', `${BOM}# Kommentar\n${FULL}`) })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, FULL_OUT, 'a comment right after the BOM')
	r = values(sb, { KD_LOCAL_ENV: put(sb, 'conf/bom-only.env', BOM) })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, '||\n', 'a file of nothing but the BOM')
	const later = put(sb, 'conf/bom-later.env', `KD_DNS=192.168.1.1\n${BOM}KD_LAN_HOST=192.168.1.20\n`)
	r = values(sb, { KD_LOCAL_ENV: later })
	assert.equal(r.status, 1, r.stderr)
	assert.ok(r.stderr.includes(`${later}:2`), r.stderr)
	assert.match(r.stderr, /unbekannter Schlüssel/)
})

test('KD_LOCAL_ENV: a missing file is exit 1, a relative path is relative to $ROOT', (t) => {
	const sb = sandbox(t)
	for (const missing of ['conf/none.env', path.join(sb.root, 'conf/none.env'), 'dev']) {
		sb.rules([[0, '*', '']])
		const r = sb.run('down.sh', [], { KD_NS: NS, KD_LOCAL_ENV: missing })
		assert.equal(r.status, 1, r.stderr)
		assert.match(r.stderr, /KD_LOCAL_ENV='.*': .* fehlt oder ist keine lesbare Datei/)
		assert.deepEqual(sb.calls(), [])
	}
	put(sb, 'conf/rel.env', FULL)
	// the test runs with cwd = the real repo, so a cwd-relative lookup would miss it
	const r = spawnSync('bash', ['-c', `. "${sb.dev}/lib.sh"\n${PRINT}`], { cwd: REPO, env: sb.env({ KD_NS: NS, KD_LOCAL_ENV: 'conf/rel.env' }), encoding: 'utf8' })
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, FULL_OUT)
})

test('without KD_LOCAL_ENV: $ROOT/dev/local.env; in a linked git worktree without its own file the one of the main working tree; the worktree\'s own wins', (t) => {
	const sb = sandbox(t)
	const unset = { KD_NS: NS, KD_LOCAL_ENV: undefined, GIT_CEILING_DIRECTORIES: path.dirname(sb.root), ...NO_GIT }
	// the sandbox copy is no git repository: only its own dev/local.env counts
	let r = values(sb, unset)
	assert.equal(r.stdout, '||\n', r.stderr)
	put(sb, 'dev/local.env', FULL)
	r = values(sb, unset)
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, FULL_OUT)
	// a main working tree with a linked worktree, both with dev/lib.sh
	const main = path.join(sb.root, 'repo', 'main')
	const wt = path.join(sb.root, 'repo', 'wt')
	fs.mkdirSync(path.join(main, 'dev'), { recursive: true })
	fs.copyFileSync(path.join(REPO, 'dev/lib.sh'), path.join(main, 'dev/lib.sh'))
	const git = (...args) => {
		const g = spawnSync('git', ['-C', main, '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', '-c', 'commit.gpgsign=false', ...args],
			{ env: sb.env(NO_GIT), encoding: 'utf8' })
		assert.equal(g.status, 0, `git ${args.join(' ')}: ${g.stderr}`)
	}
	git('init', '-q')
	git('add', 'dev/lib.sh')
	git('commit', '-q', '-m', 'lib')
	git('worktree', 'add', '-q', wt)
	const inWt = (extra = {}) => spawnSync('bash', ['-c', `. "${wt}/dev/lib.sh"\nprintf '%s\\n' "$ROOT"\n${PRINT}`], { env: sb.env({ ...unset, ...extra }), encoding: 'utf8' })
	r = inWt()
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, `${fs.realpathSync(wt)}\n||\n`, 'no file in either tree')
	fs.writeFileSync(path.join(main, 'dev/local.env'), FULL)
	r = inWt()
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, `${fs.realpathSync(wt)}\n${FULL_OUT}`, 'the main working tree\'s file')
	r = inWt({ KD_LOCAL_ENV: '' })
	assert.equal(r.stdout.split('\n')[1], '||', 'KD_LOCAL_ENV= reads none, also in a worktree')
	fs.writeFileSync(path.join(wt, 'dev/local.env'), 'KD_DNS=10.0.0.53\n')
	r = inWt()
	assert.equal(r.status, 0, r.stderr)
	assert.equal(r.stdout, `${fs.realpathSync(wt)}\n10.0.0.53||\n`, 'the worktree\'s own file wins (and is the only one read)')
	// a broken file of the main working tree stops the worktree's scripts, too (named with its path)
	fs.rmSync(path.join(wt, 'dev/local.env'))
	fs.writeFileSync(path.join(main, 'dev/local.env'), 'KD_NOPE=1\n')
	r = inWt()
	assert.equal(r.status, 1)
	assert.ok(r.stderr.includes(`${fs.realpathSync(main)}/dev/local.env:1`), r.stderr)
})

const createRules = () => [
	[0, 'network inspect -f {{.Internal}} *', 'true\n'],
	[1, 'network inspect *', '', 'Error: No such network\n'],
	[1, 'container inspect *', '', 'Error: No such container\n'],
	[0, 'ps -aq --filter label=*', ''],
	[0, 'network ls -q --filter label=*', ''],
	[0, 'network ls --format *', ''],
	[0, 'network create *', 'n\n'],
	[0, 'run -d *', 'c\n'],
	// stop right after the Nextcloud container's create call: only its arguments matter here
	[1, 'create *', '', 'fake: stop after create\n'],
	[0, '*', ''],
]

test('KD_DNS: up.sh creates the Nextcloud container with --dns only for a non-empty value (file or environment); no address default in up.sh or e2e/run.sh', (t) => {
	const sb = sandbox(t)
	const f = put(sb, 'conf/dns.env', 'KD_DNS=192.168.1.1\n')
	const create = (extra) => {
		sb.rules(createRules())
		const r = sb.run('up.sh', [], { KD_NS: 'dzdns', KD_PORT: '18609', KD_DB: 'sqlite', KD_APP_DIR: path.join(REPO, 'dev/selftest/placeholder'), KD_SKIP_BUILD_CHECK: '1', ...extra })
		assert.equal(r.status, 1, r.stderr)
		assert.match(r.stderr, /fake: stop after create/, 'up.sh got as far as the create call')
		const c = sb.calls().filter((l) => l.startsWith('create --name knorke-dev-dzdns-nc '))
		assert.equal(c.length, 1, sb.calls().join('\n'))
		return c[0]
	}
	assert.doesNotMatch(create({}), / --dns /, 'without KD_DNS: Docker\'s default')
	assert.match(create({ KD_LOCAL_ENV: f }), / --dns 192\.168\.1\.1 /, 'KD_DNS from the file')
	assert.match(create({ KD_DNS: '192.168.1.1' }), / --dns 192\.168\.1\.1 /, 'KD_DNS from the environment')
	assert.doesNotMatch(create({ KD_LOCAL_ENV: f, KD_DNS: '' }), / --dns /, 'KD_DNS= in the environment beats the file')
	for (const rel of ['dev/up.sh', 'dev/e2e/run.sh']) {
		const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
		assert.doesNotMatch(src, /KD_DNS-[0-9]/, `${rel}: no address default`)
		assert.match(src, /^DNS="\$\{KD_DNS:-\}"$/m, `${rel}: KD_DNS as dev/lib.sh left it`)
	}
})
