/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The probes OPS-1 (dev/selftest/ops1-orphans.mjs, occ knorke:orphans) and
 * OPS-3 (dev/selftest/ops3-templates.mjs, templates not executable) of
 * SPEC-M1 §33.1 m (P7-C), without a stack:
 * - both take the namespace only from KD_NS: without it exit 2, a protected
 *   namespace (KD_PROTECT_NS, default try) exit 2 before loadEnv and before
 *   any docker call (SPEC-M1 §8.1 R20); KD_FORCE=1 passes the guard
 * - OPS-1 parses the five lines of occ knorke:orphans (§33.1 e) in their
 *   order, the dry-run sentence, and prints the decisive lines of §33.1 m
 * - OPS-3 counts only server file paths as a leak (ED-41), never the
 *   requested URL, and wants 404 without "Fatal error"
 * - neither probe prints the password: OPS-1 hands it to occ user:add only
 *   through OC_PASS (--password-from-env)
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './lib/sandbox.mjs'
import { parseOrphans, countsLine, allAre, KINDS, DRY_RUN_LINE, USERS, GROUPS, ENABLE_SETTLE_MS } from './ops1-orphans.mjs'
import { OPS3_PATHS, hasFatal, hasServerPath, lineOf, answerOk } from './ops3-templates.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8')

for (const [probe, label] of [['selftest/ops1-orphans.mjs', 'OPS-1'], ['selftest/ops3-templates.mjs', 'OPS-3']]) {
	test(`${label}: KD_NS only from the environment; missing or protected → exit 2 before loadEnv and any docker call; KD_FORCE=1 passes the guard (SPEC-M1 §8.1 R20, §33.1 m)`, (t) => {
		const sb = new Sandbox()
		t.after(() => sb.cleanup())
		sb.copyDev('sim/lib', probe)
		// a broken env.json of try: loadEnv would fail with its own message, so the refusal must come first
		fs.mkdirSync(path.join(sb.dev, '.state', 'try'), { recursive: true })
		fs.writeFileSync(path.join(sb.dev, '.state', 'try', 'env.json'), 'kaputt')
		sb.rules([[0, '*', '']])
		let r = sb.node(probe, [], {})
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, new RegExp(`^${label}: KD_NS fehlt`, 'm'))
		assert.deepEqual(sb.calls(), [], 'no docker call without KD_NS')
		r = sb.node(probe, [], { KD_NS: 'try' })
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, new RegExp(`^${label}: VERWEIGERT: Namensraum 'try' ist geschützt \\(KD_PROTECT_NS\\)$`, 'm'))
		assert.doesNotMatch(r.stderr, /env\.json/, 'refused before loadEnv')
		assert.deepEqual(sb.calls(), [], 'no docker call for try')
		r = sb.node(probe, [], { KD_NS: 'dzops', KD_PROTECT_NS: 'try dzops' })
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, /VERWEIGERT: Namensraum 'dzops' ist geschützt/)
		r = sb.node(probe, [], { KD_NS: 'try', KD_FORCE: '1' })
		assert.equal(r.status, 2, r.stderr)
		assert.match(r.stderr, /env\.json fehlt oder ist kaputt/, 'KD_FORCE=1 passes the guard; loadEnv refuses the broken file')
		assert.deepEqual(sb.calls(), [], 'still no docker call')
	})
}

test('OPS-1: parseOrphans reads the five lines of §33.1 e in their order, the dry-run sentence; anything else is null', () => {
	assert.deepEqual(KINDS, ['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards'])
	assert.equal(DRY_RUN_LINE, 'Dry run: nothing was changed.')
	const out = 'user-shares: 1\ngroup-shares: 1\nlink-members: 1\nopen-votes: 1\nowned-boards: 1\n'
	assert.deepEqual(parseOrphans(out), { counts: { 'user-shares': 1, 'group-shares': 1, 'link-members': 1, 'open-votes': 1, 'owned-boards': 1 }, dryRun: false })
	assert.deepEqual(parseOrphans(`${out}${DRY_RUN_LINE}\n`).dryRun, true)
	assert.equal(parseOrphans('Notice: x\n' + out.replace('open-votes: 1\n', '')), null, 'a missing line')
	assert.equal(parseOrphans('group-shares: 1\nuser-shares: 1\nlink-members: 1\nopen-votes: 1\nowned-boards: 1'), null, 'the wrong order')
	assert.equal(parseOrphans(''), null)
	assert.equal(parseOrphans(null), null)
	assert.equal(countsLine(parseOrphans(out).counts), 'user-shares: 1, group-shares: 1, link-members: 1, open-votes: 1, owned-boards: 1')
	assert.equal(countsLine(null), 'user-shares: ?, group-shares: ?, link-members: ?, open-votes: ?, owned-boards: ?')
	assert.equal(allAre(parseOrphans(out).counts, 1), true)
	assert.equal(allAre(parseOrphans(out.replace('owned-boards: 1', 'owned-boards: 2')).counts, 1), false)
	assert.equal(allAre(null, 0), false)
})

test('OPS-1: the decisive lines and the flow of §33.1 m (ids, order of disable/delete/enable, reconcile before the ids come back, cleanup)', () => {
	const src = read('ops1-orphans.mjs')
	const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
	assert.deepEqual([...USERS], ['ops1dave', 'ops1owen', 'ops1mem', 'ops1ctl', 'ops1new'])
	assert.deepEqual([...GROUPS], ['ops1grp', 'ops1gctl'])
	assert.ok(ENABLE_SETTLE_MS >= 7000, 'at least 7 s after app:enable')
	for (const l of ['`OPS-1 ns=${ns} profile=${harnessProfile(e)} nc=', '`OPS-1 dry-run: ${countsLine(', '`OPS-1 orphans: ${countsLine(', '`OPS-1 rerun: ${countsLine(',
		'`OPS-1 after: G ${after.G}, U/ops1dave ${after.Udave}, U/ops1mem ${after.Umem}, O ${after.O}, shares O ${after.sharesO}, list O ${after.listO}, votes U ${after.votesU}; controls GC ${after.GC}, UC ${after.UC}`',
		"'OPS-1 ok'", '`OPS-1 FAIL: ${red.length} checks red`']) {
		assert.ok(code.includes(l), `line ${l}`)
	}
	const at = (s) => {
		const i = code.indexOf(s)
		assert.ok(i >= 0, s)
		return i
	}
	assert.ok(at("occ('knorke:orphans', '--dry-run')") < at("await addUser(u)"), 'precheck before anything is created')
	assert.ok(at("occOk('group:delete', 'ops1gctl')") < at("occOk('app:disable', 'knorke')"), 'controls deleted while enabled')
	assert.ok(at("occOk('app:disable', 'knorke')") < at("occOk('group:delete', 'ops1grp')") && at("occOk('group:delete', 'ops1grp')") < at("occOk('app:enable', 'knorke')"), 'deleted while disabled')
	assert.ok(at("occOk('app:enable', 'knorke')") < at('await sleep(ENABLE_SETTLE_MS)') && at('await sleep(ENABLE_SETTLE_MS)') < at("const dry = await occ('knorke:orphans', '--dry-run')"), 'reconcile after app:enable and the wait')
	assert.ok(at("const again = await occ('knorke:orphans')") < at("for (const u of ['ops1dave', 'ops1owen', 'ops1mem', 'ops1ctl']) await addUser(u)"), 'ids come back only after the reconcile')
	assert.match(code, /finally \{\n\t\tif \(disabled\) await occ\('app:enable', 'knorke'\)/, 'the app ends enabled even after an abort')
	assert.match(code, /\['exec', '-u', 'www-data', '-e', 'OC_PASS', NC, 'php', 'occ', 'user:add', '--password-from-env', uid\]/, 'the password only through OC_PASS')
	assert.match(code, /env: \{ \.\.\.process\.env, OC_PASS: e\.userPass \}, stdio: \['ignore', 'ignore', 'pipe'\]/, 'occ user:add output is not printed')
	assert.doesNotMatch(code, /console\.(log|error)\([^)]*(userPass|token|OC_PASS)/, 'no password or token in the output')
	assert.doesNotMatch(code, /KD_NS \|\|/, 'no namespace default')
})

test('OPS-3: the three paths; 404 without "Fatal error" and without a server file path passes; the requested URL is no leak (ED-41)', () => {
	assert.deepEqual([...OPS3_PATHS], ['/custom_apps/knorke/templates/guest.php', '/custom_apps/knorke/templates/main.php', '/custom_apps/knorke/templates/public.php'])
	const fatal = '<b>Fatal error</b>:  Uncaught Error: Class &quot;OCP\\Util&quot; not found in /var/www/html/custom_apps/knorke/templates/public.php:8'
	assert.equal(hasFatal(fatal), true)
	assert.equal(hasServerPath(fatal), true)
	assert.equal(answerOk(200, fatal), false)
	assert.equal(lineOf(OPS3_PATHS[2], 200, fatal), 'OPS-3 /custom_apps/knorke/templates/public.php 200 fatal=yes path=yes')
	const nc404 = '<!DOCTYPE html><html><body><h2>Page not found</h2><p>The page could not be found on the server or you may not be allowed to see it.</p></body></html>'
	assert.equal(answerOk(404, nc404), true)
	assert.equal(lineOf(OPS3_PATHS[0], 404, nc404), 'OPS-3 /custom_apps/knorke/templates/guest.php 404 fatal=no path=no')
	const apache404 = '<p>The requested URL /custom_apps/knorke/templates/guest.php was not found on this server.</p>'
	assert.equal(hasServerPath(apache404), false, 'the requested URL in Apache\'s 404 page is no leak')
	assert.equal(answerOk(404, apache404), true)
	for (const leak of ['in /var/www/html/x.php', 'Warning: foo in x.php:12', 'Parse error ... on line 3']) assert.equal(hasServerPath(leak), true, leak)
	assert.equal(answerOk(403, nc404), false, 'anything but 404 is red')
	const src = read('ops3-templates.mjs')
	assert.match(src, /headers: \{ Host: 'localhost'/, 'Host localhost like up.sh\'s probes (a trusted domain of the dev stack)')
	assert.match(src, /console\.log\(`OPS-3 FAIL: \$\{red\.length\} checks red`\)/)
	assert.match(src, /console\.log\('OPS-3 ok'\)/)
})
