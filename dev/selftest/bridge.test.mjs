/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The host bridge (dev/e2e/hostbridge.sh, SPEC-M0 §8.2) runs as root on the
 * host and polls a directory that the Playwright container can write
 * (review finding OPS-3, round 2 U4). Whatever the container plants there –
 * symlinks, directories, odd names – must never make the bridge write,
 * truncate or move anything outside that directory, and a request that is
 * not a plain file must not be answered.
 *
 * No stack and no Docker daemon are needed: the bridge runs from a sandbox
 * copy of the dev scripts (lib/sandbox.mjs) for a throwaway namespace with a
 * fake env.json, and a fake docker comes first on PATH. It answers every exec
 * into the namespace's containers like the daemon does when they are missing
 * ("No such container", exit 1), so nothing reaches a real daemon and the test
 * runs alike on the host, on a CI runner and in a container without docker
 * (stage-0 phase-2 finding: the bridge tests called the docker of whatever
 * machine ran them). The fake's call log shows which requests reached docker
 * at all. The planted entries copy the reproduction of the finding:
 *   1.res.tmp → victim file   (answer written through a symlink)
 *   2.work    → victim dir    (request moved INTO a host directory)
 *   3.err     → victim file   (stderr redirect truncates a host file)
 *   4.req     → host file     (request read through a symlink)
 *   5.res     → victim dir    (answer renamed INTO a host directory)
 *   6.req     directory       (not a regular file)
 *   007.req   non-canonical request name
 *
 * KD_BRIDGE_SCRIPT=<path> runs the same checks against another copy of
 * hostbridge.sh in place, with its own dev/lib.sh and dev/.state (used to show
 * that the round-1 script fails them); the fake docker is on PATH there too.
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Sandbox } from './lib/sandbox.mjs'

const OTHER = process.env.KD_BRIDGE_SCRIPT ? path.resolve(process.env.KD_BRIDGE_SCRIPT) : null
const NS = 'dbrtest'
const GW = '10.255.255.1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The bridge under test for namespace ns: the sandbox's copy of this repo's
 * hostbridge.sh (or KD_BRIDGE_SCRIPT in place), its dev/.state/<ns> with a
 * fake env.json, and an environment with the fake docker first on PATH, in
 * which every container of ns is missing.
 */
function bridgeFor(t, ns) {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const script = OTHER || path.join(sb.dev, 'e2e', 'hostbridge.sh')
	const state = path.join(path.resolve(path.dirname(script), '..', '..'), 'dev', '.state', ns)
	sb.rules(['nc', 'db', 'redis'].map((c) => [1, `exec * knorke-dev-${ns}-${c} *`, '', `Error response from daemon: No such container: knorke-dev-${ns}-${c}\n`]))
	return { sb, script, state, env: sb.env({ KD_NS: ns }) }
}

function lkind(p) {
	try {
		const st = fs.lstatSync(p)
		return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other'
	} catch {
		return null
	}
}

test('the host bridge never follows, moves into or answers planted entries', { timeout: 60000 }, async (t) => {
	const { sb, script, state: STATE, env } = bridgeFor(t, NS)
	assert.ok(!fs.existsSync(STATE), `${STATE} exists – another run of this test? remove it first`)
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdbridge-'))
	const bridge = path.join(root, 'bridge')
	const ctl = path.join(root, 'ctl')
	const v = path.join(root, 'victims')
	for (const d of [bridge, ctl, v, path.join(v, 'dir2'), path.join(v, 'dir5')]) fs.mkdirSync(d, { recursive: true })
	fs.mkdirSync(STATE, { recursive: true, mode: 0o700 })
	fs.writeFileSync(path.join(STATE, 'env.json'), JSON.stringify({ ns: NS, gatewayIp: GW, db: { kind: 'pgsql' } }))

	const req = (name, obj) => fs.writeFileSync(path.join(bridge, name), JSON.stringify(obj))
	fs.writeFileSync(path.join(v, 'res.txt'), 'ORIGINAL-RES')
	fs.symlinkSync(path.join(v, 'res.txt'), path.join(bridge, '1.res.tmp'))
	req('1.req', { action: 'drop-all', args: [] })
	fs.symlinkSync(path.join(v, 'dir2'), path.join(bridge, '2.work'))
	req('2.req', { action: 'drop-all', args: [], x: 'ATTACKER CONTENT' })
	fs.writeFileSync(path.join(v, 'err.txt'), 'ORIGINAL-ERR')
	fs.symlinkSync(path.join(v, 'err.txt'), path.join(bridge, '3.err'))
	req('3.req', { action: 'bruteforce-reset', args: [] })
	fs.writeFileSync(path.join(v, 'host.json'), JSON.stringify({ action: 'bruteforce-reset', args: [] }))
	fs.symlinkSync(path.join(v, 'host.json'), path.join(bridge, '4.req'))
	fs.symlinkSync(path.join(v, 'dir5'), path.join(bridge, '5.res'))
	req('5.req', { action: 'drop-all', args: [] })
	fs.mkdirSync(path.join(bridge, '6.req'))
	req('007.req', { action: 'drop-all', args: [] })

	const p = spawn('bash', [script, bridge, ctl], { env, stdio: ['ignore', 'pipe', 'pipe'] })
	let log = ''
	p.stdout.on('data', (c) => { log += c })
	p.stderr.on('data', (c) => { log += c })
	const exited = new Promise((r) => p.on('close', r))
	try {
		// 1, 2, 3 and 5 are answered (3 after a failing docker exec); then let it idle a little.
		const t0 = Date.now()
		while (Date.now() - t0 < 20000) {
			if (['1.res', '2.res', '3.res'].every((n) => lkind(path.join(bridge, n)) === 'file')) break
			await sleep(100)
		}
		await sleep(1500)
	} finally {
		fs.writeFileSync(path.join(ctl, 'stop'), '')
		const stopped = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)])
		if (!stopped) {
			p.kill('SIGTERM')
			await exited
		}
		fs.rmSync(STATE, { recursive: true, force: true })
	}
	const answer = (n) => JSON.parse(fs.readFileSync(path.join(bridge, n), 'utf8'))
	const ctx = `\n--- bridge log ---\n${log}`
	try {
		assert.equal(fs.readFileSync(path.join(v, 'res.txt'), 'utf8'), 'ORIGINAL-RES', 'answer not written through a planted <n>.res.tmp symlink' + ctx)
		assert.deepEqual(fs.readdirSync(path.join(v, 'dir2')), [], 'request not moved into the directory a planted <n>.work points to' + ctx)
		assert.equal(fs.readFileSync(path.join(v, 'err.txt'), 'utf8'), 'ORIGINAL-ERR', 'stderr not redirected through a planted <n>.err symlink' + ctx)
		assert.deepEqual(fs.readdirSync(path.join(v, 'dir5')), [], 'answer not renamed into the directory a planted <n>.res points to' + ctx)
		assert.equal(lkind(path.join(bridge, '1.res')), 'file', '1 answered with a regular file' + ctx)
		assert.equal(answer('1.res').ok, false, '1: unknown action refused')
		assert.equal(lkind(path.join(bridge, '3.res')), 'file', '3 answered' + ctx)
		assert.equal(answer('3.res').ok, false, '3: docker exec into a missing container fails')
		assert.match(answer('3.res').error, new RegExp(`No such container: knorke-dev-${NS}-nc`), '3: the error of docker exec comes back')
		assert.deepEqual(sb.calls(), [`exec -u www-data knorke-dev-${NS}-nc php occ security:bruteforce:reset ${GW}`],
			'only request 3 reached docker – the fake one; the symlinked 4.req (also bruteforce-reset) was never run' + ctx)
		assert.equal(lkind(path.join(bridge, '5.res')), 'file', '5: the planted symlink is replaced by the answer file' + ctx)
		assert.equal(answer('5.res').ok, false, '5: unknown action refused')
		assert.equal(lkind(path.join(bridge, '4.res')), null, 'a symlinked request is never answered' + ctx)
		assert.equal(fs.readFileSync(path.join(v, 'host.json'), 'utf8'), JSON.stringify({ action: 'bruteforce-reset', args: [] }), 'the symlink target is untouched')
		assert.equal(lkind(path.join(bridge, '6.res')), null, 'a directory named <n>.req is never answered' + ctx)
		assert.equal(lkind(path.join(bridge, '007.res')), null, 'a non-canonical request name is never answered' + ctx)
		assert.equal(lkind(path.join(bridge, '7.res')), null, 'a non-canonical request name is never answered as its number' + ctx)
		const stray = fs.readdirSync(bridge).filter((n) => /\.(work|err|tmp)$/.test(n) && lkind(path.join(bridge, n)) !== 'link')
		assert.deepEqual(stray, [], 'the bridge leaves no own work/err/tmp files in the container-writable directory' + ctx)
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

test('the bridge reads up to four arguments and checks each one and their count (SPEC-M1 §8.1)', { timeout: 60000 }, async (t) => {
	const ns = 'dbrargs'
	const { sb, script, state, env } = bridgeFor(t, ns)
	assert.ok(!fs.existsSync(state), `${state} exists – another run of this test? remove it first`)
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdbridge-'))
	const bridge = path.join(root, 'bridge')
	const ctl = path.join(root, 'ctl')
	for (const d of [bridge, ctl]) fs.mkdirSync(d, { recursive: true })
	fs.mkdirSync(state, { recursive: true, mode: 0o700 })
	fs.writeFileSync(path.join(state, 'env.json'), JSON.stringify({ ns, gatewayIp: GW, db: { kind: 'pgsql' } }))
	// [request, expected error] – all refused before any docker call
	const cases = [
		[{ action: 'redis-get-rev', args: ['1', 'x'] }, /^2 Argumente statt 1 für redis-get-rev$/],
		[{ action: 'redis-get-rev', args: [] }, /^0 Argumente statt 1 für redis-get-rev$/],
		[{ action: 'redis-get-rev' }, /^0 Argumente statt 1/],
		[{ action: 'bruteforce-reset', args: ['1'] }, /^1 Argumente statt 0 für bruteforce-reset$/],
		[{ action: 'links-policy', args: ['on', 'off', 'on', 'off', 'on'] }, /höchstens vier/],
		[{ action: 'links-policy', args: [{ x: 1 }] }, /höchstens vier Zeichenketten oder Zahlen/],
		[{ action: 'links-policy', args: 'on' }, /höchstens vier/],
		[{ action: 'links-policy', args: ['on\noff'] }, /^Argument ungültig: on/],
		[{ action: 'links-policy', args: [''] }, /^Argument ungültig: $/],
		[{ action: 'legal-links', args: ['set|clear'] }, /^Argument ungültig: set\|clear$/],
		[{ action: 'set-min-rev', args: ['1; DROP TABLE oc_knorke_boards'] }, /^Board-ID ungültig: 1; DROP TABLE/],
		[{ action: 'set-min-rev', args: ['1\n2'] }, /^Board-ID ungültig: 1/],
		[{ action: 'set-min-rev', args: ['12345678901234567890'] }, /^Board-ID ungültig/],
		[{ action: 'drop-all', args: [] }, /steht nicht auf der Liste/],
		// accepted: they reach their docker call (the fake has no container) – never a shell error like an unbound $2
		[{ action: 'bruteforce-reset', args: [] }, /No such container: knorke-dev-dbrargs-nc/],
		[{ action: 'pgss-reset' }, /No such container: knorke-dev-dbrargs-db/],
		[{ action: 'links-policy', args: ['off'] }, /No such container: knorke-dev-dbrargs-nc/],
	]
	cases.forEach(([obj], i) => fs.writeFileSync(path.join(bridge, `${i + 1}.req`), JSON.stringify(obj)))
	const p = spawn('bash', [script, bridge, ctl], { env, stdio: ['ignore', 'pipe', 'pipe'] })
	let log = ''
	p.stdout.on('data', (c) => { log += c })
	p.stderr.on('data', (c) => { log += c })
	const exited = new Promise((r) => p.on('close', r))
	try {
		const t0 = Date.now()
		while (Date.now() - t0 < 30000 && !cases.every((_, i) => lkind(path.join(bridge, `${i + 1}.res`)) === 'file')) await sleep(100)
	} finally {
		fs.writeFileSync(path.join(ctl, 'stop'), '')
		const stopped = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)])
		if (!stopped) {
			p.kill('SIGTERM')
			await exited
		}
		fs.rmSync(state, { recursive: true, force: true })
	}
	try {
		cases.forEach(([obj, re], i) => {
			const f = path.join(bridge, `${i + 1}.res`)
			assert.equal(lkind(f), 'file', `${JSON.stringify(obj)} answered\n${log}`)
			const a = JSON.parse(fs.readFileSync(f, 'utf8'))
			assert.equal(a.ok, false, JSON.stringify(obj))
			assert.match(a.error, re, `${JSON.stringify(obj)} → ${a.error}`)
			assert.doesNotMatch(a.error, /unbound variable|syntax error/, `${JSON.stringify(obj)}: no shell error`)
		})
		// the refused requests never reached docker; each accepted one made exactly its one call
		assert.deepEqual(sb.calls().sort(), [
			`exec -i knorke-dev-${ns}-db psql -U nextcloud -d nextcloud -X -q -A -t -v ON_ERROR_STOP=1`,
			`exec -u www-data knorke-dev-${ns}-nc php occ config:app:set core shareapi_allow_links --value=no`,
			`exec -u www-data knorke-dev-${ns}-nc php occ security:bruteforce:reset ${GW}`,
		], `docker calls\n${log}`)
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

// ── stage 2 (SPEC-M1 §8.4): share-policy, group-member, circles, team-create,
// team-member, link-expire, seed-board ─────────────────────────────────────

/** env.json of a stage-2 stack: the harness accounts and the group of up.sh. */
const STAGE2_ENV = (ns) => ({
	ns, gatewayIp: GW, db: { kind: 'pgsql' }, port: 18999, userPass: 'Pw0123456789abcdefABCDEF',
	users: { alice: 'Alice Adler', bob: 'Bob Berg', carol: 'Carol Clausen' },
	groups: { 'knorke-e2e': ['bob', 'carol'] },
})

/**
 * Runs the sandbox bridge for namespace ns over `requests` ([{action, args}]),
 * with the fake docker's rule table `rules` (the default: every exec into a
 * container of ns fails like a missing container). Resolves the answers (in
 * request order), the fake's docker calls and the bridge log.
 */
async function runBridge(t, ns, requests, rules = null, envExtra = {}) {
	const { sb, script, state, env } = bridgeFor(t, ns)
	if (rules) sb.rules(rules)
	assert.ok(!fs.existsSync(state), `${state} exists – another run of this test? remove it first`)
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdbridge-'))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	const bridge = path.join(root, 'bridge')
	const ctl = path.join(root, 'ctl')
	for (const d of [bridge, ctl]) fs.mkdirSync(d, { recursive: true })
	fs.mkdirSync(state, { recursive: true, mode: 0o700 })
	fs.writeFileSync(path.join(state, 'env.json'), JSON.stringify({ ...STAGE2_ENV(ns), ...envExtra }))
	requests.forEach((obj, i) => fs.writeFileSync(path.join(bridge, `${i + 1}.req`), JSON.stringify(obj)))
	const p = spawn('bash', [script, bridge, ctl], { env, stdio: ['ignore', 'pipe', 'pipe'] })
	let log = ''
	p.stdout.on('data', (c) => { log += c })
	p.stderr.on('data', (c) => { log += c })
	const exited = new Promise((r) => p.on('close', r))
	try {
		const t0 = Date.now()
		while (Date.now() - t0 < 40000 && !requests.every((_, i) => lkind(path.join(bridge, `${i + 1}.res`)) === 'file')) await sleep(100)
	} finally {
		fs.writeFileSync(path.join(ctl, 'stop'), '')
		const stopped = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)])
		if (!stopped) {
			p.kill('SIGTERM')
			await exited
		}
		fs.rmSync(state, { recursive: true, force: true })
	}
	const answers = requests.map((obj, i) => {
		const f = path.join(bridge, `${i + 1}.res`)
		assert.equal(lkind(f), 'file', `${JSON.stringify(obj)} answered\n${log}`)
		return JSON.parse(fs.readFileSync(f, 'utf8'))
	})
	assert.deepEqual(fs.readdirSync(ctl).filter((n) => /^seed\./.test(n)), [], 'no seed work files left in the control dir')
	return { answers, calls: sb.calls(), log }
}

test('stage 2: every new action checks each argument, the pair key/value and the count – refused requests never reach docker', { timeout: 60000 }, async (t) => {
	const ns = 'dbrstwo'
	const single = 'Ab3' + 'x'.repeat(28)
	// [request, expected error]
	const cases = [
		// share-policy: keys of KD_SHAREAPI_KEYS only, the value by the key's kind
		[{ action: 'share-policy', args: ['shareapi_allow_resharing', 'no'] }, /^Richtlinien-Schlüssel ungültig: shareapi_allow_resharing$/],
		[{ action: 'share-policy', args: ['shareapi_enabled|shareapi_allow_links', 'no'] }, /^Richtlinien-Schlüssel ungültig/],
		[{ action: 'share-policy', args: ['core shareapi_enabled', 'no'] }, /^Richtlinien-Schlüssel ungültig/],
		[{ action: 'share-policy', args: ['shareapi_enabled', 'maybe'] }, /^Richtlinien-Wert ungültig: maybe$/],
		[{ action: 'share-policy', args: ['shareapi_enabled', '3'] }, /^Wert 3 passt nicht zu shareapi_enabled \(bool\)$/],
		[{ action: 'share-policy', args: ['shareapi_enabled', 'knorke-e2e'] }, /^Wert knorke-e2e passt nicht zu shareapi_enabled \(bool\)$/],
		[{ action: 'share-policy', args: ['shareapi_expire_after_n_days', 'yes'] }, /^Wert yes passt nicht zu shareapi_expire_after_n_days \(number\)$/],
		[{ action: 'share-policy', args: ['shareapi_expire_after_n_days', '07'] }, /^Richtlinien-Wert ungültig: 07$/],
		[{ action: 'share-policy', args: ['shareapi_expire_after_n_days', '10000'] }, /^Richtlinien-Wert ungültig: 10000$/],
		[{ action: 'share-policy', args: ['shareapi_expire_after_n_days', '-1'] }, /^Richtlinien-Wert ungültig: -1$/],
		[{ action: 'share-policy', args: ['shareapi_exclude_groups_list', 'admin'] }, /^Richtlinien-Wert ungültig: admin$/],
		[{ action: 'share-policy', args: ['shareapi_exclude_groups_list', '["admin"]'] }, /^Richtlinien-Wert ungültig/],
		[{ action: 'share-policy', args: ['shareapi_exclude_groups_list', 'no'] }, /^Wert no passt nicht zu shareapi_exclude_groups_list \(list\)$/],
		[{ action: 'share-policy', args: ['shareapi_enabled'] }, /^1 Argumente statt 2 für share-policy$/],
		[{ action: 'share-policy', args: ['shareapi_enabled', 'no', 'x'] }, /^3 Argumente statt 2 für share-policy$/],
		// group-member: harness accounts and groups of env.json only, whole words
		[{ action: 'group-member', args: ['add', 'admin', 'knorke-e2e'] }, /^Konto ungültig \(kein Harness-Konto\): admin$/],
		[{ action: 'group-member', args: ['add', 'ali', 'knorke-e2e'] }, /^Konto ungültig/],
		[{ action: 'group-member', args: ['add', 'alice bob', 'knorke-e2e'] }, /^Konto ungültig/],
		[{ action: 'group-member', args: ['add', 'alice', 'admin'] }, /^Gruppe ungültig \(keine Harness-Gruppe\): admin$/],
		[{ action: 'group-member', args: ['add', 'alice', 'knorke'] }, /^Gruppe ungültig/],
		[{ action: 'group-member', args: ['join', 'alice', 'knorke-e2e'] }, /^Argument ungültig: join$/],
		[{ action: 'group-member', args: ['add', 'alice'] }, /^2 Argumente statt 3 für group-member$/],
		// circles
		[{ action: 'circles', args: ['toggle'] }, /^Argument ungültig: toggle$/],
		[{ action: 'circles', args: [] }, /^0 Argumente statt 1 für circles$/],
		// team-create / team-member
		[{ action: 'team-create', args: ['Team Nord'] }, /^Team-Name ungültig/],
		[{ action: 'team-create', args: ['knorke-e2e-'] }, /^Team-Name ungültig/],
		[{ action: 'team-create', args: ['knorke-e2e-Nord'] }, /^Team-Name ungültig/],
		[{ action: 'team-create', args: ['knorke-e2e-' + 'a'.repeat(17)] }, /^Team-Name ungültig/],
		[{ action: 'team-member', args: [single.slice(1), 'bob'] }, /^singleId ungültig/],
		[{ action: 'team-member', args: [single + 'x', 'bob'] }, /^singleId ungültig/],
		[{ action: 'team-member', args: [single, 'admin'] }, /^Konto ungültig/],
		// link-expire / seed-board
		[{ action: 'link-expire', args: ['7', 'owner'] }, /^Argument ungültig: owner$/],
		[{ action: 'link-expire', args: ['7; DELETE FROM oc_knorke_links', 'edit'] }, /^Board-ID ungültig/],
		[{ action: 'link-expire', args: ['7'] }, /^1 Argumente statt 2 für link-expire$/],
		[{ action: 'seed-board', args: ['7', '0'] }, /^Anzahl ungültig \(1–5000\): 0$/],
		[{ action: 'seed-board', args: ['7', '5001'] }, /^Anzahl ungültig/],
		[{ action: 'seed-board', args: ['7', '0100'] }, /^Anzahl ungültig/],
		[{ action: 'seed-board', args: ['7', '1e3'] }, /^Anzahl ungültig/],
		// stage 3 (R16): vote-expire takes exactly one board id
		[{ action: 'vote-expire', args: [] }, /^0 Argumente statt 1 für vote-expire$/],
		[{ action: 'vote-expire', args: ['7', 'open'] }, /^2 Argumente statt 1 für vote-expire$/],
		[{ action: 'vote-expire', args: ['7; UPDATE oc_knorke_vote_sessions SET state = 1'] }, /^Board-ID ungültig/],
		[{ action: 'vote-expire', args: ['*'] }, /^Board-ID ungültig/],
		// stage 4 (SPEC-M1 §8.4 R19, T4-07): purge-tombstones <board> <age 0–2592000000>
		[{ action: 'purge-tombstones', args: ['7'] }, /^1 Argumente statt 2 für purge-tombstones$/],
		[{ action: 'purge-tombstones', args: ['7', '0', 'x'] }, /^3 Argumente statt 2 für purge-tombstones$/],
		[{ action: 'purge-tombstones', args: ['7', '-1'] }, /^Alter ungültig \(0–2592000000 ms\): -1$/],
		[{ action: 'purge-tombstones', args: ['7', '2592000001'] }, /^Alter ungültig/],
		[{ action: 'purge-tombstones', args: ['7', '01000'] }, /^Alter ungültig/],
		[{ action: 'purge-tombstones', args: ['7', '1e3'] }, /^Alter ungültig/],
		[{ action: 'purge-tombstones', args: ['7', '99999999999'] }, /^Alter ungültig/],
		[{ action: 'purge-tombstones', args: ['7; DELETE FROM oc_knorke_items', '0'] }, /^Board-ID ungültig/],
		// app-config <key of HARNESS_APP_CONFIG> <0–1000000000 | default>, 0 only for the byte keys (P7-C, §33.1 j)
		[{ action: 'app-config', args: ['max_items_per_board', '5'] }, /^App-Config-Schlüssel ungültig \(nur budget_syncs budget_ops tombstone_days tombstone_cap changes_cap budget_bytes_board_day budget_bytes_user_day changes_bytes_cap link_limit\): max_items_per_board$/],
		[{ action: 'app-config', args: ['public_url', 'default'] }, /^App-Config-Schlüssel ungültig/],
		[{ action: 'app-config', args: ['epoch', 'default'] }, /^App-Config-Schlüssel ungültig/],
		[{ action: 'app-config', args: ['budget_ops budget_syncs', '5'] }, /^App-Config-Schlüssel ungültig/],
		[{ action: 'app-config', args: ['budget', '5'] }, /^App-Config-Schlüssel ungültig/],
		[{ action: 'app-config', args: ['budget_ops', '0'] }, /^App-Config-Wert 0 gilt nur für die Byte-Schlüssel \(budget_bytes_board_day budget_bytes_user_day changes_bytes_cap\), nicht für budget_ops$/],
		[{ action: 'app-config', args: ['link_limit', '0'] }, /^App-Config-Wert 0 gilt nur für die Byte-Schlüssel \(budget_bytes_board_day budget_bytes_user_day changes_bytes_cap\), nicht für link_limit$/],
		[{ action: 'app-config', args: ['budget_bytes_board_day', '-1'] }, /^App-Config-Wert ungültig \(0–1000000000 oder default\): -1$/],
		[{ action: 'app-config', args: ['budget_bytes_board_day', '00'] }, /^App-Config-Wert ungültig/],
		[{ action: 'app-config', args: ['changes_bytes_cap', '1000000001'] }, /^App-Config-Wert ungültig/],
		[{ action: 'app-config', args: ['budget_ops', '1000000001'] }, /^App-Config-Wert ungültig/],
		[{ action: 'app-config', args: ['budget_ops', '-5'] }, /^App-Config-Wert ungültig/],
		[{ action: 'app-config', args: ['budget_ops', '05'] }, /^App-Config-Wert ungültig/],
		[{ action: 'app-config', args: ['budget_ops', 'yes'] }, /^App-Config-Wert ungültig/],
		[{ action: 'app-config', args: ['budget_ops'] }, /^1 Argumente statt 2 für app-config$/],
	]
	const { answers, calls, log } = await runBridge(t, ns, cases.map(([obj]) => obj))
	cases.forEach(([obj, re], i) => {
		assert.equal(answers[i].ok, false, JSON.stringify(obj))
		assert.match(answers[i].error, re, `${JSON.stringify(obj)} → ${answers[i].error}`)
		assert.doesNotMatch(answers[i].error, /unbound variable|syntax error/, `${JSON.stringify(obj)}: no shell error`)
	})
	assert.deepEqual(calls, [], `no refused request reached docker\n${log}`)
})

test('stage 2: accepted requests make exactly their docker calls (share-policy forms, group-member, circles, link-expire, seed-board)', { timeout: 60000 }, async (t) => {
	const ns = 'dbrsthr'
	const NC = `knorke-dev-${ns}-nc`
	const occ = (a) => `exec -u www-data ${NC} php occ ${a}`
	const requests = [
		{ action: 'share-policy', args: ['shareapi_enabled', 'no'] },
		{ action: 'share-policy', args: ['shareapi_exclude_groups_list', 'knorke-e2e'] },
		{ action: 'share-policy', args: ['shareapi_expire_after_n_days', '30'] },
		{ action: 'share-policy', args: ['shareapi_enforce_links_password', 'default'] },
		{ action: 'group-member', args: ['remove', 'bob', 'knorke-e2e'] },
		{ action: 'circles', args: ['off'] },
		{ action: 'circles', args: ['on'] },
		{ action: 'link-expire', args: ['7', 'vote'] },
		{ action: 'seed-board', args: ['7', '3000'] },
	]
	const { answers, calls, log } = await runBridge(t, ns, requests)
	// every one failed at its first docker call (the fake has no container) – with docker's error, never a shell error
	answers.forEach((a, i) => {
		assert.equal(a.ok, false, JSON.stringify(requests[i]))
		assert.match(a.error, /No such container: knorke-dev-dbrsthr-(nc|db)/, `${JSON.stringify(requests[i])} → ${a.error}`)
		assert.doesNotMatch(a.error, /unbound variable|syntax error/)
	})
	const psql = `exec -i knorke-dev-${ns}-db psql -U nextcloud -d nextcloud -X -q -A -t -F \t -v ON_ERROR_STOP=1`
	assert.deepEqual(calls, [
		occ('config:app:set core shareapi_enabled --value=no'),
		occ('config:app:set core shareapi_exclude_groups_list --value=["knorke-e2e"]'),
		occ('config:app:set core shareapi_expire_after_n_days --value=30'),
		occ('config:app:delete core shareapi_enforce_links_password'),
		occ('group:removeuser knorke-e2e bob'),
		occ('app:disable circles'),
		occ('app:enable circles'),
		psql,
		psql,
	], `docker calls\n${log}`)
})

test('stage 2: team-create replaces a harness team of the same name, team-member only joins harness teams, group-member answers the members', { timeout: 60000 }, async (t) => {
	const ns = 'dbrsfou'
	const NC = `knorke-dev-${ns}-nc`
	const occ = (a) => `exec -u www-data ${NC} php occ ${a}`
	const A = 'A'.repeat(31)
	const B = 'B'.repeat(31)
	const C = 'C'.repeat(31)
	const list = JSON.stringify([{ id: A, name: 'knorke-e2e-nord' }, { id: B, name: 'Team Nord' }], null, 2)
	const rules = [
		[0, occ('circles:manage:list --output=json'), `${list}\n`],
		[0, occ(`circles:manage:destroy ${A}`), ''],
		[0, occ('circles:manage:create --type user --output=json alice knorke-e2e-nord'), JSON.stringify({ id: C, name: 'knorke-e2e-nord' }, null, 2) + '\n'],
		[0, occ(`circles:manage:details ${C}`), JSON.stringify({ id: C, name: 'knorke-e2e-nord' }) + '\n'],
		[0, occ(`circles:manage:details ${B}`), JSON.stringify({ id: B, name: 'Team Nord' }) + '\n'],
		[0, occ(`circles:members:add ${C} carol --type user`), ''],
		[0, occ(`circles:members:list ${C} --output=json`), JSON.stringify([
			{ userId: 'alice', userType: 1, level: 9, status: 'Member' },
			{ userId: 'carol', userType: 1, level: 1, status: 'Member' },
			{ userId: 'knorke-e2e', userType: 2, level: 1, status: 'Member' },
		]) + '\n'],
		[0, occ('group:adduser knorke-e2e alice'), ''],
		// a notice line before the JSON (occ_json skips it)
		[0, occ('group:list --output=json'), 'Notice: something\n' + JSON.stringify({ admin: ['admin'], 'knorke-e2e': ['alice', 'bob', 'carol'] }) + '\n'],
		// the board's owner is no harness account: seed-board refuses before any HTTP
		[0, `exec -i knorke-dev-${ns}-db psql *`, 'mallory\n'],
	]
	const requests = [
		{ action: 'team-create', args: ['knorke-e2e-nord'] },
		{ action: 'team-member', args: [C, 'carol'] },
		{ action: 'team-member', args: [B, 'carol'] },
		{ action: 'group-member', args: ['add', 'alice', 'knorke-e2e'] },
		{ action: 'seed-board', args: ['7', '10'] },
		{ action: 'link-expire', args: ['7', 'edit'] },
	]
	const { answers, calls, log } = await runBridge(t, ns, requests, rules)
	const [tc, tm, tforeign, gm, seed, le] = answers
	assert.equal(tc.ok, true, `team-create ${JSON.stringify(tc)}\n${log}`)
	assert.deepEqual(tc.result, { singleId: C, name: 'knorke-e2e-nord', owner: 'alice', replaced: [A] })
	assert.equal(tm.ok, true, JSON.stringify(tm))
	assert.deepEqual(tm.result.members, [{ user: 'alice', level: 9, status: 'Member' }, { user: 'carol', level: 1, status: 'Member' }], 'user members only')
	assert.equal(tforeign.ok, false)
	assert.match(tforeign.error, /ist kein Harness-Team \(Name 'Team Nord'\)/)
	assert.equal(gm.ok, true, JSON.stringify(gm))
	assert.deepEqual(gm.result, { op: 'add', user: 'alice', group: 'knorke-e2e', members: ['alice', 'bob', 'carol'] })
	assert.equal(seed.ok, false)
	assert.match(seed.error, /Besitzer von Board 7 ist kein Harness-Konto: mallory/)
	assert.equal(le.ok, false)
	assert.match(le.error, /Board 7 hat keinen nicht widerrufenen Link der Rolle edit/)
	const occCalls = calls.filter((c) => c.startsWith(`exec -u www-data ${NC}`)).map((c) => c.slice(occ('').length))
	assert.deepEqual(occCalls, [
		'circles:manage:list --output=json',
		`circles:manage:destroy ${A}`,
		'circles:manage:create --type user --output=json alice knorke-e2e-nord',
		`circles:manage:details ${C}`,
		`circles:members:add ${C} carol --type user`,
		`circles:members:list ${C} --output=json`,
		`circles:manage:details ${B}`,
		'group:adduser knorke-e2e alice',
		'group:list --output=json',
	], `only the harness team of that name is destroyed; nothing joins the foreign team\n${log}`)
	assert.ok(!occCalls.some((c) => c.includes(B) && /destroy|members:add/.test(c)), 'the team of another name is never touched')
	assert.ok(!calls.some((c) => /curl/.test(c)), 'no HTTP for a board of a foreign owner')
})

// ── stage 2, phase 1 (SPEC-M1 §8.4 R13): ratelimit-reset, link-expire with the generation ──

test('R13: ratelimit-reset takes no argument, SCANs exactly Nextcloud\'s ILimiter keys and DELs each one; a failing SCAN is an error, never "0 keys"', { timeout: 60000 }, async (t) => {
	const ns = 'dbrsfiv'
	const R = `knorke-dev-${ns}-redis`
	const k1 = 'd38b875c/OC\\Security\\RateLimiting\\Backend\\MemoryCacheBackend1e75a37d'
	const k2 = 'd38b875c/OC\\Security\\RateLimiting\\Backend\\MemoryCacheBackendffa0'
	// P7-C (SPEC-M1 §33.1 j, ED-24): also the daily byte counters wd:/wu: of every epoch
	const wd = 'd38b875c/knorke/k3x9a0b2/wd:7:20375'
	const wu = 'd38b875c/knorke/k3x9a0b2/wu:0a1b2c3d4e5f60718293a4b5:20375'
	const rules = [
		[0, `exec ${R} redis-cli --scan --pattern */OC*RateLimiting*MemoryCacheBackend*`, `${k2}\n${k1}\n`],
		[0, `exec ${R} redis-cli --scan --pattern */knorke/*/wd:*`, `${wd}\n`],
		[0, `exec ${R} redis-cli --scan --pattern */knorke/*/wu:*`, `${wu}\n`],
		[0, `exec ${R} redis-cli DEL *`, '1\n'],
	]
	const { answers, calls, log } = await runBridge(t, ns, [
		{ action: 'ratelimit-reset', args: ['x'] },
		{ action: 'ratelimit-reset', args: [] },
	], rules)
	assert.equal(answers[0].ok, false)
	assert.match(answers[0].error, /^1 Argumente statt 0 für ratelimit-reset$/)
	assert.equal(answers[1].ok, true, `${JSON.stringify(answers[1])}\n${log}`)
	assert.deepEqual(answers[1].result, { deleted: 4 }, 'answers the number of deleted keys (ILimiter and byte counters)')
	assert.deepEqual(calls, [
		`exec ${R} redis-cli --scan --pattern */OC*RateLimiting*MemoryCacheBackend*`,
		`exec ${R} redis-cli --scan --pattern */knorke/*/wd:*`,
		`exec ${R} redis-cli --scan --pattern */knorke/*/wu:*`,
		`exec ${R} redis-cli DEL ${k1}`,
		`exec ${R} redis-cli DEL ${k2}`,
		`exec ${R} redis-cli DEL ${wd}`,
		`exec ${R} redis-cli DEL ${wu}`,
	], `one SCAN per pattern (§8.4 and §33.1 j), then one DEL per key (backslashes kept), never KEYS\n${log}`)

	// no Redis container: an error with docker's message, not {deleted: 0}
	const failed = await runBridge(t, 'dbrssix', [{ action: 'ratelimit-reset', args: [] }],
		[[1, 'exec knorke-dev-dbrssix-redis *', '', 'Error response from daemon: No such container: knorke-dev-dbrssix-redis\n']])
	assert.equal(failed.answers[0].ok, false, JSON.stringify(failed.answers[0]))
	assert.match(failed.answers[0].error, /No such container: knorke-dev-dbrssix-redis/)
})

test('R13: link-expire raises the generation of the link\'s role in the same SQL transaction (D-7) and answers it', { timeout: 60000 }, async (t) => {
	const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'e2e', 'hostbridge.sh'), 'utf8')
	const h = src.slice(src.indexOf('        link-expire)\n'), src.indexOf('        seed-board)\n'))
	assert.match(h, /if \[ "\$c" = vote \]; then key=vote_link_gen; else key=link_gen; fi/, 'vote → vote_link_gen, edit → link_gen')
	const sql = h.slice(h.indexOf('"BEGIN;"'), h.indexOf('"COMMIT;"'))
	const bump = sql.indexOf('UPDATE oc_knorke_boards SET $key = $key + 1 WHERE id = $b AND EXISTS (SELECT 1 FROM oc_knorke_links WHERE board_id = $b AND role = \'$c\' AND revoked_at IS NULL);')
	const expire = sql.indexOf('UPDATE oc_knorke_links SET expires_at = $((now - 1)) WHERE board_id = $b AND role = \'$c\' AND revoked_at IS NULL;')
	assert.ok(bump > 0 && expire > bump, 'inside BEGIN … COMMIT: the generation goes up only when such a link exists, before the expiry (same transaction)')
	assert.match(h, /out="\$\(del_keys "\*\/knorke\/\*\/a:\$b" "\*\/knorke\/\*\/g:\$b:\*"\)"/, 'then a: and g: go')

	const ns = 'dbrssev'
	const psql = `exec -i knorke-dev-${ns}-db psql -U nextcloud -d nextcloud -X -q -A -t -F \t -v ON_ERROR_STOP=1`
	const rules = [
		[0, psql, 'gen0\t3\nlink\t11\t1791833639521\ngen1\t4\n'],
		[0, `exec knorke-dev-${ns}-redis redis-cli --scan --pattern *`, ''],
	]
	const { answers, calls, log } = await runBridge(t, ns, [{ action: 'link-expire', args: ['7', 'vote'] }], rules)
	const a = answers[0]
	assert.equal(a.ok, true, `${JSON.stringify(a)}\n${log}`)
	assert.deepEqual(a.result.link, { id: 11, expiresAt: 1791833639521, role: 'vote' })
	assert.deepEqual(a.result.gen, { column: 'vote_link_gen', before: 3, after: 4 })
	assert.equal(a.result.deleted, 0)
	assert.deepEqual(calls, [
		psql,
		`exec knorke-dev-${ns}-redis redis-cli --scan --pattern */knorke/*/a:7`,
		`exec knorke-dev-${ns}-redis redis-cli --scan --pattern */knorke/*/g:7:*`,
	], log)
})

// ── stage 3 (SPEC-M1 §8.4 R16): vote-expire ──────────────────────────────────

test('R16: vote-expire sets ends_at = now − 1 ms of the open session in ONE transaction, leaves the board row alone, then DELs vt:<b>; no open session = error, nothing deleted', { timeout: 60000 }, async (t) => {
	const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'e2e', 'hostbridge.sh'), 'utf8')
	assert.match(src, /^ {8}vote-expire\) echo "board" ;;$/m, 'arg_spec: exactly one board id')
	const h = src.slice(src.indexOf('        vote-expire)\n'), src.indexOf('        seed-board)\n'))
	const sql = h.slice(h.indexOf('"BEGIN;"'), h.indexOf('"COMMIT;"'))
	assert.ok(sql.includes("UPDATE oc_knorke_vote_sessions SET ends_at = $((now - 1)) WHERE board_id = $b AND state = 'open';"), 'only ends_at of the open session, inside BEGIN … COMMIT')
	assert.doesNotMatch(sql, /UPDATE oc_knorke_boards/, 'boards (meta, rev, meta_rev) untouched')
	assert.ok(sql.indexOf("SELECT 'vs', id, ends_at") > sql.indexOf('UPDATE oc_knorke_vote_sessions'), 'the session is read back in the same transaction')
	assert.ok(sql.includes("SELECT 'bd', rev, meta_rev FROM oc_knorke_boards WHERE id = $b;"), 'rev and meta_rev read in the same transaction')
	assert.ok(h.indexOf('del_keys "*/knorke/*/vt:$b"') > h.indexOf('"COMMIT;"'), 'vt: goes after the commit')
	assert.ok(h.indexOf('keine offene Abstimmung') < h.indexOf('del_keys'), 'no open session: error before any DEL')

	const ns = 'dbrseig'
	const R = `knorke-dev-${ns}-redis`
	const psql = `exec -i knorke-dev-${ns}-db psql -U nextcloud -d nextcloud -X -q -A -t -F \t -v ON_ERROR_STOP=1`
	const rules = [
		[0, psql, 'vs\t12\t1791833639521\nbd\t44\t40\n'],
		[0, `exec ${R} redis-cli --scan --pattern */knorke/*/vt:7`, 'd38b/knorke/k3x9a0b2/vt:7\n'],
		[0, `exec ${R} redis-cli DEL *`, '1\n'],
	]
	const { answers, calls, log } = await runBridge(t, ns, [{ action: 'vote-expire', args: ['7'] }], rules)
	const a = answers[0]
	assert.equal(a.ok, true, `${JSON.stringify(a)}\n${log}`)
	assert.equal(a.result.sid, 12)
	assert.equal(a.result.endsAt, 1791833639521)
	assert.deepEqual([a.result.rev, a.result.metaRev, a.result.deleted, a.result.keys], [44, 40, 1, ['d38b/knorke/k3x9a0b2/vt:7']])
	assert.deepEqual(calls, [psql, `exec ${R} redis-cli --scan --pattern */knorke/*/vt:7`, `exec ${R} redis-cli DEL d38b/knorke/k3x9a0b2/vt:7`], log)

	// no open session: the SELECT finds no 'vs' row → error, no Redis call
	const ns2 = 'dbrsnin'
	const psql2 = `exec -i knorke-dev-${ns2}-db psql -U nextcloud -d nextcloud -X -q -A -t -F \t -v ON_ERROR_STOP=1`
	const none = await runBridge(t, ns2, [{ action: 'vote-expire', args: ['7'] }], [[0, psql2, 'bd\t44\t40\n']])
	assert.equal(none.answers[0].ok, false)
	assert.match(none.answers[0].error, /Board 7 hat keine offene Abstimmung – nichts geändert/)
	assert.deepEqual(none.calls, [psql2], 'no Redis call without an open session')
})

// ── stage 4 (SPEC-M1 §8.4 R19, T4-07): purge-tombstones, app-config ────────────

test('R19: purge-tombstones backdates the board\'s tombstones in ONE transaction, then runs occ knorke:compact --board WITHOUT --now and answers its JSON line plus rev; no board = error, compact never runs', { timeout: 60000 }, async (t) => {
	const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'e2e', 'hostbridge.sh'), 'utf8')
	assert.match(src, /^ {8}purge-tombstones\) echo "board age" ;;$/m, 'arg_spec: board and age')
	const h = src.slice(src.indexOf('        purge-tombstones)\n'), src.indexOf('        app-config)\n'))
	const sql = h.slice(h.indexOf('"BEGIN;"'), h.indexOf('"COMMIT;"'))
	assert.ok(sql.includes('UPDATE oc_knorke_items SET modified_at = $back WHERE board_id = $b AND deleted = 1 AND modified_at <= $((now - c));'), 'only tombstones of the board, at least olderThanMs old, inside BEGIN … COMMIT')
	assert.match(h, /back=\$\(\(now - days \* 86400000 - 1\)\)/, 'backdated to now − tombstone_days·86400000 − 1')
	assert.match(h, /days="\$\(occ_at config:app:get knorke tombstone_days 2>\/dev\/null\)" \|\| days=""\n\s+\[\[ "\$days" =~ \^\[1-9\]\[0-9\]\{0,8\}\$ \]\] \|\| days="\$TOMBSTONE_DAYS_DEFAULT"/, 'effective tombstone_days: app config, else 30')
	assert.match(src, /^TOMBSTONE_DAYS_DEFAULT=30$/m)
	assert.doesNotMatch(h, /--now/, 'compact without --now (§8.4 R19)')
	assert.ok(h.indexOf('knorke:compact --board="$b"') > h.indexOf('"COMMIT;"'), 'compact after the commit')
	assert.ok(h.indexOf('gibt es nicht') < h.indexOf('knorke:compact'), 'no board: error before compact')

	const ns = 'dbrsten'
	const NC = `knorke-dev-${ns}-nc`
	const psql = `exec -i knorke-dev-${ns}-db psql -U nextcloud -d nextcloud -X -q -A -t -F \t -v ON_ERROR_STOP=1`
	const line = { board: 7, blocks: 1, tombstones: 2, changes: 0, minRevBefore: 3, minRev: 40 }
	const rules = [
		[1, `exec -u www-data ${NC} php occ config:app:get knorke tombstone_days`, ''],
		[0, psql, 'n\t2\nbd\t40\t3\nrev\t41\n'],
		[0, `exec -u www-data ${NC} php occ knorke:compact --board=7`, `Some notice\n${JSON.stringify({ ...line, board: 8 })}\n${JSON.stringify(line)}\n`],
	]
	const t0 = Date.now()
	const { answers, calls, log } = await runBridge(t, ns, [{ action: 'purge-tombstones', args: ['7', '0'] }], rules)
	const a = answers[0]
	assert.equal(a.ok, true, `${JSON.stringify(a)}\n${log}`)
	assert.deepEqual(Object.keys(a.result).slice(0, 6), ['board', 'blocks', 'tombstones', 'changes', 'minRevBefore', 'minRev'], 'compact\'s JSON line first (§4.13.7 (d))')
	assert.deepEqual({ ...a.result, now: 0 }, { ...line, rev: 41, backdated: 2, olderThanMs: 0, tombstoneDays: 30, now: 0 }, 'the line of THIS board plus rev')
	assert.ok(a.result.now >= t0 - 1000 && a.result.now <= Date.now() + 1000, 'now of the backdating')
	assert.deepEqual(calls, [
		`exec -u www-data ${NC} php occ config:app:get knorke tombstone_days`,
		psql,
		`exec -u www-data ${NC} php occ knorke:compact --board=7`,
		psql,
	], log)

	// app config tombstone_days = 7 is the effective retention; no such board → error, compact never runs
	const ns2 = 'dbrselv'
	const NC2 = `knorke-dev-${ns2}-nc`
	const psql2 = `exec -i knorke-dev-${ns2}-db psql -U nextcloud -d nextcloud -X -q -A -t -F \t -v ON_ERROR_STOP=1`
	const none = await runBridge(t, ns2, [{ action: 'purge-tombstones', args: ['7', '3600000'] }], [
		[0, `exec -u www-data ${NC2} php occ config:app:get knorke tombstone_days`, '7\n'],
		[0, psql2, 'n\t0\n'],
	])
	assert.equal(none.answers[0].ok, false)
	assert.match(none.answers[0].error, /Board 7 gibt es nicht – nichts geändert/)
	assert.deepEqual(none.calls, [`exec -u www-data ${NC2} php occ config:app:get knorke tombstone_days`, psql2], 'no compact without the board')
})

test('R19: app-config sets or deletes exactly one HARNESS_APP_CONFIG key of knorke, waits for the app-config cache and answers the stored value', { timeout: 60000 }, async (t) => {
	const ns = 'dbrstwe'
	const NC = `knorke-dev-${ns}-nc`
	const occ = (a) => `exec -u www-data ${NC} php occ ${a}`
	const rules = [
		[0, occ('config:app:set knorke budget_ops --value=5'), ''],
		[0, occ('config:app:get knorke budget_ops'), '5\n'],
		[0, occ('config:app:delete knorke changes_cap'), ''],
		[1, occ('config:app:get knorke changes_cap'), ''],
	]
	const t0 = Date.now()
	const { answers, calls, log } = await runBridge(t, ns, [
		{ action: 'app-config', args: ['budget_ops', '5'] },
		{ action: 'app-config', args: ['changes_cap', 'default'] },
	], rules)
	assert.equal(answers[0].ok, true, `${JSON.stringify(answers[0])}\n${log}`)
	assert.deepEqual(answers[0].result, { key: 'budget_ops', value: '5', stored: '5' })
	assert.equal(answers[1].ok, true, JSON.stringify(answers[1]))
	assert.deepEqual(answers[1].result, { key: 'changes_cap', value: 'default', stored: null }, 'default = key deleted')
	assert.ok(Date.now() - t0 >= 7800, 'each answer only after the 4-s app-config settle')
	assert.deepEqual(calls, [
		occ('config:app:set knorke budget_ops --value=5'),
		occ('config:app:get knorke budget_ops'),
		occ('config:app:delete knorke changes_cap'),
		occ('config:app:get knorke changes_cap'),
	], log)
})

// ── P7-C (SPEC-M1 §33.1 j, ED-22/ED-23): 0 for the byte keys, "default" = the baseline of the profile ──

test('P7-C: app-config takes 0 for a byte key; "default" stores the profile value in the dev profile (link_limit 1000, budget_bytes_user_day 0) and deletes a key without one; in the prod profile every default deletes', { timeout: 90000 }, async (t) => {
	const ns = 'dbrpsev'
	const NC = `knorke-dev-${ns}-nc`
	const occ = (a) => `exec -u www-data ${NC} php occ ${a}`
	const dev = await runBridge(t, ns, [
		{ action: 'app-config', args: ['budget_bytes_board_day', '0'] },
		{ action: 'app-config', args: ['link_limit', 'default'] },
		{ action: 'app-config', args: ['budget_bytes_user_day', 'default'] },
		{ action: 'app-config', args: ['changes_bytes_cap', 'default'] },
	], [
		[0, occ('config:app:set knorke budget_bytes_board_day --value=0'), ''],
		[0, occ('config:app:get knorke budget_bytes_board_day'), '0\n'],
		[0, occ('config:app:set knorke link_limit --value=1000'), ''],
		[0, occ('config:app:get knorke link_limit'), '1000\n'],
		[0, occ('config:app:set knorke budget_bytes_user_day --value=0'), ''],
		[0, occ('config:app:get knorke budget_bytes_user_day'), '0\n'],
		[0, occ('config:app:delete knorke changes_bytes_cap'), ''],
		[1, occ('config:app:get knorke changes_bytes_cap'), ''],
	])
	dev.answers.forEach((a, i) => assert.equal(a.ok, true, `dev #${i}: ${JSON.stringify(a)}\n${dev.log}`))
	assert.deepEqual(dev.answers.map((a) => a.result), [
		{ key: 'budget_bytes_board_day', value: '0', stored: '0' },
		{ key: 'link_limit', value: 'default', stored: '1000' },
		{ key: 'budget_bytes_user_day', value: 'default', stored: '0' },
		{ key: 'changes_bytes_cap', value: 'default', stored: null },
	], 'dev profile: 0 kept for a byte key, default = the profile value or deleted')
	assert.deepEqual(dev.calls, [
		occ('config:app:set knorke budget_bytes_board_day --value=0'), occ('config:app:get knorke budget_bytes_board_day'),
		occ('config:app:set knorke link_limit --value=1000'), occ('config:app:get knorke link_limit'),
		occ('config:app:set knorke budget_bytes_user_day --value=0'), occ('config:app:get knorke budget_bytes_user_day'),
		occ('config:app:delete knorke changes_bytes_cap'), occ('config:app:get knorke changes_bytes_cap'),
	], dev.log)
	const prod = await runBridge(t, ns, [
		{ action: 'app-config', args: ['link_limit', 'default'] },
		{ action: 'app-config', args: ['budget_bytes_board_day', 'default'] },
	], [
		[0, occ('config:app:delete knorke *'), ''],
		[1, occ('config:app:get knorke *'), ''],
	], { load: { profile: 'prod', users: [] } })
	assert.deepEqual(prod.answers.map((a) => a.result), [
		{ key: 'link_limit', value: 'default', stored: null },
		{ key: 'budget_bytes_board_day', value: 'default', stored: null },
	], 'prod profile: every default deletes (the app\'s defaults)')
	assert.deepEqual(prod.calls, [
		occ('config:app:delete knorke link_limit'), occ('config:app:get knorke link_limit'),
		occ('config:app:delete knorke budget_bytes_board_day'), occ('config:app:get knorke budget_bytes_board_day'),
	], prod.log)
})
