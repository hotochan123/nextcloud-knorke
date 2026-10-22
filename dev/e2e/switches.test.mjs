/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Cleanup pairing of the host bridge (SPEC-M1 §8.4: "Jede schaltende Aktion hat
 * ihr Gegenstück im World.cleanup und in normalise_ns"), without a stack:
 * - every action on the list of dev/e2e/hostbridge.sh (arg_spec) is classified
 *   – read-only, resetting, switching or creating – so a new action cannot slip in
 *   without a decision; stage 4 (SPEC-M1 §8.4 R19, T4-07): app-config is
 *   switching (counterpart app-config <key> default), purge-tombstones creating
 * - lib/switches.mjs restoreCalls(): the counterpart of every switching
 *   action, each once, group members back to env.json .groups
 * - World uses it (switch() records before it calls, cleanup() runs the
 *   counterparts; limiterReset() clears the ILimiter state and cleanup()
 *   does it once more, SPEC-M1 §8.4 R13) and dev/lib.sh normalise_ns covers
 *   every switching action (its behaviour: dev/selftest/normalise.test.mjs)
 * - ncTrue/ncFalse: Nextcloud booleans compared tolerantly (R13)
 * - P7-C (SPEC-M1 §33.1 j): HARNESS_APP_PROFILE of lib/switches.mjs equals
 *   dev/lib.sh's; harnessProfile/baselineOf give the baseline that
 *   app-config <key> default stores; ratelimit-reset also clears the daily
 *   byte counters wd:/wu: (the same patterns as Stack.ratelimitReset), and the
 *   bridge takes 0 only for the byte keys (app_pair_ok)
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SWITCHING, CREATING, RESETTING, restoreCalls, memberByDefault, ncTrue, ncFalse, HARNESS_APP_PROFILE, harnessProfile, baselineOf } from './lib/switches.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(DIR, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Actions without a lasting instance setting: statistics, caches, one board's row. */
const READ_ONLY = ['pgss-reset', 'pgss-count', 'redis-del-rev', 'redis-get-rev', 'redis-del-access', 'set-min-rev']

/** The action names of hostbridge.sh arg_spec(). */
function bridgeActions() {
	const src = read('dev/e2e/hostbridge.sh')
	const body = src.slice(src.indexOf('arg_spec() {'), src.indexOf('# arg_ok KIND VALUE'))
	return [...body.matchAll(/^ {8}([a-z|-]+)\) echo /gm)].flatMap((m) => m[1].split('|'))
}

const ENV = { users: { alice: 'Alice Adler', bob: 'Bob Berg', carol: 'Carol Clausen' }, groups: { 'knorke-e2e': ['bob', 'carol'] } }

test('every bridge action is classified: read-only, resetting, switching (with a counterpart) or creating', () => {
	const actions = bridgeActions()
	assert.ok(actions.length >= 17, `arg_spec parsed (${actions.join(' ')})`)
	assert.deepEqual([...actions].sort(), [...READ_ONLY, ...RESETTING, ...SWITCHING, ...CREATING].sort())
	assert.deepEqual([...RESETTING].sort(), ['bruteforce-reset', 'ratelimit-reset'], 'ratelimit-reset (R13, SRV-07) is on the list')
	assert.deepEqual([...SWITCHING].sort(), ['app-config', 'circles', 'group-member', 'legal-links', 'links-policy', 'share-policy'], 'app-config (stage 4, R19) switches and has a counterpart')
	assert.deepEqual([...CREATING].sort(), ['link-expire', 'purge-tombstones', 'seed-board', 'team-create', 'team-member', 'vote-expire'], 'vote-expire (stage 3, R16) and purge-tombstones (stage 4, R19) need no counterpart')
	for (const now of ['purge-tombstones', 'app-config']) assert.ok(actions.includes(now), `${now} (stage 4, R19) is on the list`)
})

test('restoreCalls: the counterpart of every switching action, each once, in a fixed order', () => {
	const touched = [
		['circles', 'off'],
		['share-policy', 'shareapi_enabled', 'no'],
		['group-member', 'add', 'alice', 'knorke-e2e'],
		['share-policy', 'shareapi_exclude_groups_list', 'knorke-e2e'],
		['group-member', 'remove', 'bob', 'knorke-e2e'],
		['share-policy', 'shareapi_enabled', 'yes'],
		['links-policy', 'off'],
		['legal-links', 'set'],
		['group-member', 'remove', 'alice', 'knorke-e2e'],
		['circles', 'on'],
		['team-create', 'knorke-e2e-nord'],
		['team-member', 'A'.repeat(31), 'bob'],
		['link-expire', '7', 'edit'],
		['seed-board', '7', '3000'],
		['app-config', 'changes_cap', '50'],
		['purge-tombstones', '7', '0'],
		['app-config', 'budget_ops', '5'],
		['app-config', 'changes_cap', 'default'],
	]
	assert.deepEqual(restoreCalls(touched, ENV), [
		['links-policy', 'on'],
		['legal-links', 'clear'],
		['share-policy', 'shareapi_enabled', 'default'],
		['share-policy', 'shareapi_exclude_groups_list', 'default'],
		['app-config', 'changes_cap', 'default'],
		['app-config', 'budget_ops', 'default'],
		['group-member', 'remove', 'alice', 'knorke-e2e'],
		['group-member', 'add', 'bob', 'knorke-e2e'],
		['circles', 'on'],
	])
	assert.deepEqual(restoreCalls([], ENV), [], 'nothing switched, nothing to do')
	assert.deepEqual(restoreCalls([['team-create', 'knorke-e2e-x']], ENV), [], 'creating actions have no counterpart here (normalise_ns)')
	assert.throws(() => restoreCalls([['drop-all']], ENV), /kein Gegenstück/)
})

test('group members go back to env.json .groups; a group without a list holds no harness account', () => {
	assert.equal(memberByDefault(ENV, 'bob', 'knorke-e2e'), true)
	assert.equal(memberByDefault(ENV, 'alice', 'knorke-e2e'), false)
	assert.equal(memberByDefault({}, 'bob', 'knorke-e2e'), false)
	assert.deepEqual(restoreCalls([['group-member', 'add', 'carol', 'other']], ENV), [['group-member', 'remove', 'carol', 'other']])
})

test('World records a switch before calling the bridge and runs the counterparts in cleanup (also the stage-0 flags)', () => {
	const src = read('dev/e2e/scenarios/world.mjs')
	const sw = src.slice(src.indexOf('\tasync switch(action, ...args) {'), src.indexOf('\t/** The bridge calls cleanup()'))
	assert.ok(sw.indexOf('this.touched.push(') >= 0 && sw.indexOf('this.touched.push(') < sw.indexOf('return bridge(action, ...args)'), 'recorded before the call (a timed-out call may still have switched)')
	assert.match(sw, /SWITCHING\.includes\(action\) && !CREATING\.includes\(action\)\) throw/, 'switch() only for switching or creating actions')
	assert.match(src, /if \(this\.touchedPolicy\) touched\.push\(\['links-policy', 'off'\]\)/)
	assert.match(src, /if \(this\.touchedLegal\) touched\.push\(\['legal-links', 'set'\]\)/)
	const cl = src.slice(src.indexOf('\tasync cleanup() {'))
	assert.match(cl, /for \(const call of this\.restoreCalls\(\)\) \{\n\t\t\tawait bridge\(\.\.\.call\)\.catch\(/, 'cleanup runs every counterpart, a failing one does not stop the others')
	assert.ok(cl.indexOf('restoreCalls()') > cl.indexOf("api('alice', 'DELETE'"), 'after the boards are gone')
})

test('normalise_ns covers every switching action; e2e/run.sh normalises before and after the run', () => {
	const lib = read('dev/lib.sh')
	const fn = lib.slice(lib.indexOf('normalise_ns() {'))
	const keys = lib.match(/^KD_SHAREAPI_KEYS="([^"]*)"$/ms)[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean).map((e) => e.slice(0, e.indexOf('=')))
	// links-policy and share-policy: their keys are KD_SHAREAPI_KEYS (the bridge takes exactly these, hostbridge.sh POLICY_KEYS)
	assert.ok(keys.includes('shareapi_allow_links'), 'links-policy')
	assert.match(read('dev/e2e/hostbridge.sh'), /sed -n 's\/\^\\\(shareapi_\[a-z_\]\*\\\)=\.\*\/\\1\/p'/, 'share-policy keys come from KD_SHAREAPI_KEYS')
	assert.match(fn, /for key in imprintUrl privacyUrl; do/, 'legal-links')
	assert.match(fn, /occ app:enable circles/, 'circles')
	assert.match(fn, /\n    normalise_groups\n/, 'group-member')
	assert.match(fn, /\n        normalise_teams\n/, 'team-create (destroys knorke-e2e-… teams)')
	assert.match(fn, /for key in \$HARNESS_APP_CONFIG; do/, 'app-config (stage 4): normalise_ns deletes every HARNESS_APP_CONFIG key')
	const hb = read('dev/e2e/hostbridge.sh')
	assert.match(hb, /^ {8}app-key\)\n {12}\[\[ "\$2" =~ \^\[a-z_\]\{1,32\}\$ \]\] && in_words "\$2" "\$HARNESS_APP_CONFIG" && return 0$/m, 'the bridge takes exactly the keys of HARNESS_APP_CONFIG')
	const run = read('dev/e2e/run.sh')
	const pre = run.indexOf('\nnormalise_ns\n')
	const post = run.indexOf('( normalise_ns ) || warn')
	assert.ok(pre > 0 && pre < run.indexOf('trap cleanup EXIT'), 'before the run')
	assert.ok(post > run.indexOf('cleanup() {') && post < run.indexOf('trap cleanup EXIT'), 'after the run, in the EXIT trap, in a subshell')
})

test('World.limiterReset() clears the ILimiter state through the bridge and marks the world; cleanup() clears it once more (R13, SRV-07)', () => {
	const src = read('dev/e2e/scenarios/world.mjs')
	const fn = src.slice(src.indexOf('\tasync limiterReset() {'), src.indexOf('\t/** The bridge calls cleanup()'))
	assert.match(fn, /this\.touchedLimiter = true\n\t\treturn bridge\('ratelimit-reset'\)/, 'marks first, then resets')
	const cl = src.slice(src.indexOf('\tasync cleanup() {'))
	assert.match(cl, /if \(this\.touchedLimiter\) await bridge\('ratelimit-reset'\)\.catch\(/, 'cleanup resets once more, a failure does not stop it')
	assert.ok(cl.indexOf('ratelimit-reset') > cl.indexOf('restoreCalls()'), 'after the counterparts')
	const bridgeSrc = read('dev/e2e/hostbridge.sh')
	assert.match(bridgeSrc, /^RATELIMIT_PATTERN="\*\/OC\*RateLimiting\*MemoryCacheBackend\*"$/m, 'the pattern of §8.4')
	assert.match(bridgeSrc, /ratelimit-reset\)\n(?:[ ]+#[^\n]*\n)+\s+out="\$\(del_keys "\$RATELIMIT_PATTERN" "\$WD_PATTERN" "\$WU_PATTERN"\)"/, 'SCAN + DEL of that pattern and of the byte counters (P7-C)')
	const envSrc = read('dev/sim/lib/env.mjs')
	assert.equal(envSrc.match(/^export const RATELIMIT_PATTERN = '([^']+)'$/m)?.[1], '*/OC*RateLimiting*MemoryCacheBackend*', 'contract.mjs helper (Stack.ratelimitReset) uses the same pattern')
	// P7-C (SPEC-M1 §33.1 j, ED-24): the daily byte counters, the same two patterns on both sides
	assert.equal(bridgeSrc.match(/^WD_PATTERN="([^"]+)"$/m)?.[1], '*/knorke/*/wd:*')
	assert.equal(bridgeSrc.match(/^WU_PATTERN="([^"]+)"$/m)?.[1], '*/knorke/*/wu:*')
	assert.match(envSrc, /^export const BYTE_COUNTER_PATTERNS = Object\.freeze\(\['\*\/knorke\/\*\/wd:\*', '\*\/knorke\/\*\/wu:\*'\]\)$/m)
	assert.match(envSrc, /return \(await this\.redisDel\(RATELIMIT_PATTERN, \.\.\.BYTE_COUNTER_PATTERNS\)\)\.length/, 'Stack.ratelimitReset clears them too')
})

test('ncTrue/ncFalse: Nextcloud booleans compared tolerantly – yes|true|1 and no|false|0 (R13)', () => {
	for (const v of ['yes', 'true', '1', 'YES', ' true', true, 1]) assert.equal(ncTrue(v), true, JSON.stringify(v))
	for (const v of ['no', 'false', '0', 'No', false, 0]) assert.equal(ncFalse(v), true, JSON.stringify(v))
	for (const v of [null, undefined, '', 'maybe', '2', '[]', {}]) {
		assert.equal(ncTrue(v), false, JSON.stringify(v))
		assert.equal(ncFalse(v), false, JSON.stringify(v))
	}
	assert.equal(ncTrue('no'), false)
	assert.equal(ncFalse('yes'), false)
})

test('P7-C: HARNESS_APP_PROFILE equals dev/lib.sh; harnessProfile/baselineOf give the baseline of app-config <key> default (SPEC-M1 §33.1 j)', () => {
	const lib = read('dev/lib.sh')
	const sh = Object.fromEntries(lib.match(/^HARNESS_APP_PROFILE="([^"]*)"$/m)[1].split(/\s+/).filter(Boolean).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]))
	assert.deepEqual({ ...HARNESS_APP_PROFILE }, sh)
	assert.deepEqual({ ...HARNESS_APP_PROFILE }, { budget_bytes_board_day: '0', budget_bytes_user_day: '0', link_limit: '1000' })
	assert.equal(harnessProfile({}), 'dev')
	assert.equal(harnessProfile({ load: { profile: null } }), 'dev')
	assert.equal(harnessProfile({ load: { profile: 'prod' } }), 'prod')
	assert.equal(harnessProfile({ ipad: { profile: true } }), 'ipad')
	assert.equal(baselineOf({}, 'link_limit'), '1000')
	assert.equal(baselineOf({}, 'budget_bytes_board_day'), '0')
	assert.equal(baselineOf({}, 'changes_bytes_cap'), null, 'no profile value: not set')
	assert.equal(baselineOf({}, 'budget_ops'), null)
	assert.equal(baselineOf({ load: { profile: 'prod' } }, 'link_limit'), null, 'prod: the app default')
	assert.equal(baselineOf({ ipad: { profile: true } }, 'budget_bytes_user_day'), null, 'ipad: the app default')
	const hb = read('dev/e2e/hostbridge.sh')
	const h = hb.slice(hb.indexOf('        app-config)\n'), hb.indexOf('        seed-board)\n'))
	assert.match(h, /if \[ "\$c" = default \]; then\n\s+val="\$\(harness_baseline "\$b"\)"/, 'default = harness_baseline (dev/lib.sh)')
	assert.match(hb, /if \[ "\$action" = app-config \]; then\n\s+why="\$\(app_pair_ok /, '0 only for the byte keys (pair check)')
	assert.match(hb, /^ {8}app-value\)\n {12}\[ "\$2" = default \] && return 0\n {12}\[\[ "\$2" =~ \^\(0\|\[1-9\]\[0-9\]\{0,9\}\)\$ \]\]/m, 'app-value 0–1000000000 or default')
})

test('P7-C: restoreCalls keeps app-config <key> default for the new keys (the bridge puts the baseline back)', () => {
	assert.deepEqual(restoreCalls([['app-config', 'link_limit', '20'], ['app-config', 'budget_bytes_board_day', '0'], ['app-config', 'link_limit', 'default']], ENV), [
		['app-config', 'link_limit', 'default'],
		['app-config', 'budget_bytes_board_day', 'default'],
	])
})
