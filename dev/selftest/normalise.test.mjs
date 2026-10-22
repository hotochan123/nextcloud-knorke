/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * normalise_ns (dev/lib.sh) and normalise() (dev/sim/contract.mjs), SPEC-M1
 * §8.1: before a run they delete (= default) Nextcloud's sharing policy keys
 * of §7.4 (core shareapi_*), the Knorke app config keys of the harness
 * (HARNESS_APP_CONFIG: budget_syncs, budget_ops, tombstone_days,
 * tombstone_cap, changes_cap – the same list in both files), switch Circles
 * back on and wait 4 s for the app-config cache when something was really
 * changed. Stage 2 (SPEC-M1 §8.1/§8.4): normalise_ns also puts the harness
 * groups of env.json back (exactly their harness accounts, a deleted group
 * comes back) and destroys the harness teams (knorke-e2e-…, nothing else) –
 * the counterparts of the bridge actions group-member and team-create. Runs
 * normalise_ns in a sandbox (lib/sandbox.mjs, fake docker).
 * Stage 2, phase 1 (SPEC-M1 §8.1, §24 R13): both also delete the system keys
 * sharing.minSearchStringLength and sharing.maxAutocompleteResults (SRV-14,
 * the same list in both files), Nextcloud booleans are defaults as
 * yes|true|1 and no|false|0, and normalise() of contract.mjs puts the harness
 * groups back and destroys the harness teams like normalise_ns (planners in
 * dev/sim/lib/normalise.mjs, pinned here with the same cases as the shell).
 * P7-C (SPEC-M1 §33.1 j, ED-22/ED-25): HARNESS_APP_CONFIG has nine keys (also
 * budget_bytes_board_day, budget_bytes_user_day, changes_bytes_cap,
 * link_limit); the dev profile's values HARNESS_APP_PROFILE
 * (budget_bytes_board_day=0, budget_bytes_user_day=0, link_limit=1000) are
 * the same in dev/lib.sh and contract.mjs. Both bring every key to its
 * baseline – the profile value in the dev profile (set when missing or
 * different), else not set (deleted) – with the profile taken from env.json
 * (.load.profile prod → prod, .ipad.profile → ipad, else dev), and both
 * delete a leftover public_url. up.sh sets the profile values right after
 * create_limit, in the dev profile only.
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './lib/sandbox.mjs'
import { groupFixes, harnessTeams, occJson, HARNESS_TEAM_PREFIX, harnessProfile, appConfigFixes } from '../sim/lib/normalise.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const lib = fs.readFileSync(path.join(ROOT, 'dev/lib.sh'), 'utf8')
const contract = fs.readFileSync(path.join(ROOT, 'dev/sim/contract.mjs'), 'utf8')

/** HARNESS_APP_CONFIG of dev/lib.sh (blank-separated) and of contract.mjs (array literal). */
function harnessLists() {
	const sh = lib.match(/^HARNESS_APP_CONFIG="([^"]*)"$/m)[1].split(/\s+/).filter(Boolean)
	const js = JSON.parse(contract.match(/^const HARNESS_APP_CONFIG = (\[[^\]]*\])$/m)[1].replace(/'/g, '"'))
	return { sh, js }
}

/** key → defaults of KD_SHAREAPI_KEYS (dev/lib.sh) and SHAREAPI_DEFAULTS (contract.mjs). */
function shareapiLists() {
	const shText = lib.match(/^KD_SHAREAPI_KEYS="([^"]*)"$/ms)[1].replace(/\\\n/g, ' ')
	const sh = Object.fromEntries(shText.split(/\s+/).filter(Boolean).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1).split('|')]))
	const block = contract.match(/^const SHAREAPI_DEFAULTS = \{\n([\s\S]*?)\n\}$/m)[1]
	const js = Object.fromEntries([...block.matchAll(/^\t(\w+): (\[.*\]),?$/gm)].map((m) => [m[1], JSON.parse(m[2].replace(/'/g, '"')).filter((v) => v !== '')]))
	return { sh, js }
}

test('HARNESS_APP_CONFIG: the same nine keys in dev/lib.sh and dev/sim/contract.mjs (SPEC-M1 §8.1, §33.1 j); public_url is not on it', () => {
	const { sh, js } = harnessLists()
	assert.deepEqual(sh, ['budget_syncs', 'budget_ops', 'tombstone_days', 'tombstone_cap', 'changes_cap', 'budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap', 'link_limit'])
	assert.deepEqual(js, sh)
	assert.ok(!sh.includes('public_url'), 'public_url is no number and no bridge key (ED-25)')
	const bytes = lib.match(/^HARNESS_BYTE_KEYS="([^"]*)"$/m)[1].split(/\s+/).filter(Boolean)
	assert.deepEqual(bytes, ['budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap'], 'the byte keys (0 = off, ED-23)')
	assert.ok(bytes.every((k) => sh.includes(k)))
})

test('HARNESS_APP_PROFILE: budget_bytes_board_day=0 budget_bytes_user_day=0 link_limit=1000, the same in dev/lib.sh and dev/sim/contract.mjs (SPEC-M1 §33.1 j)', () => {
	const sh = Object.fromEntries(lib.match(/^HARNESS_APP_PROFILE="([^"]*)"$/m)[1].split(/\s+/).filter(Boolean).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]))
	const js = JSON.parse(contract.match(/^const HARNESS_APP_PROFILE = (\{[^}]*\})$/m)[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":'))
	assert.deepEqual(sh, { budget_bytes_board_day: '0', budget_bytes_user_day: '0', link_limit: '1000' })
	assert.deepEqual(js, sh)
	const { sh: keys } = harnessLists()
	assert.ok(Object.keys(sh).every((k) => keys.includes(k)), 'profile keys are HARNESS_APP_CONFIG keys')
	// up.sh: right after create_limit, only outside the prod and iPad profiles
	const up = fs.readFileSync(path.join(ROOT, 'dev/up.sh'), 'utf8')
	const i = up.indexOf('occ config:app:set knorke create_limit --value=1000 >/dev/null')
	const block = up.slice(i, up.indexOf('\nfi\n', i) + 4)
	assert.ok(i > 0, 'create_limit 1000')
	assert.match(block, /if \[ "\$LOAD_PROFILE" != prod \] && \[ "\$IPAD_PROFILE" != 1 \]; then\n/, 'the dev profile only')
	assert.match(block, /for kv in \$HARNESS_APP_PROFILE; do\n\s+occ config:app:set knorke "\$\{kv%%=\*\}" --value="\$\{kv#\*=\}"/, 'every profile value through occ config:app:set')
	assert.ok(up.indexOf('occ app:enable knorke') < i, 'after the app is enabled')
})

test('harness_profile / harness_baseline (dev/lib.sh) and harnessProfile (lib/normalise.mjs): prod, ipad or dev from env.json; the baseline is the profile value in dev only', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	const probe = (env) => {
		if (env) sb.writeEnv('dzprof', { ns: 'dzprof', ...env })
		const r = sb.lib('printf "%s|%s|%s|%s\\n" "$(harness_profile)" "$(harness_baseline link_limit)" "$(harness_baseline budget_bytes_user_day)" "$(harness_baseline budget_ops)"', { KD_NS: 'dzprof' })
		assert.equal(r.status, 0, r.stderr)
		return r.stdout.trim()
	}
	assert.equal(probe(null), 'dev|1000|0|', 'no env.json: dev')
	assert.equal(probe({ db: { kind: 'pgsql' } }), 'dev|1000|0|')
	assert.equal(probe({ load: { profile: null, users: [] } }), 'dev|1000|0|', 'a load stack without the prod profile is dev')
	assert.equal(probe({ load: { profile: 'prod' } }), 'prod|||', 'prod: no profile values')
	assert.equal(probe({ ipad: { profile: true, lanHost: 'x', relayPort: 1 } }), 'ipad|||', 'ipad: no profile values')
	for (const [env, want] of [[{}, 'dev'], [{ load: { profile: null } }, 'dev'], [{ load: { profile: 'prod' } }, 'prod'], [{ ipad: { profile: true } }, 'ipad'], [null, 'dev']]) {
		assert.equal(harnessProfile(env), want, JSON.stringify(env))
	}
})

test('the sharing policy keys of SPEC-M1 §7.4 with the same defaults in both files', () => {
	const { sh, js } = shareapiLists()
	assert.deepEqual(Object.keys(sh).sort(), Object.keys(js).sort())
	for (const k of Object.keys(sh)) assert.deepEqual(sh[k], js[k], k)
	for (const k of ['shareapi_enabled', 'shareapi_exclude_groups', 'shareapi_exclude_groups_list', 'shareapi_allow_group_sharing',
		'shareapi_only_share_with_group_members', 'shareapi_allow_links', 'shareapi_allow_links_exclude_groups',
		'shareapi_enforce_links_password', 'shareapi_default_expire_date', 'shareapi_enforce_expire_date', 'shareapi_expire_after_n_days']) {
		assert.ok(k in sh, `${k} (§7.4) is normalised`)
	}
})

const NC = 'knorke-dev-dznorm-nc'
/** The values of a clean dev stack (up.sh sets them; P7-C, SPEC-M1 §33.1 j). */
const PROFILE_VALUES = { budget_bytes_board_day: '0', budget_bytes_user_day: '0', link_limit: '1000' }
const occ = (args) => `exec -u www-data ${NC} php occ ${args}`
const list = (app, values) => [0, occ(`config:list ${app}`), JSON.stringify({ apps: { [app]: values } }) + '\n']

test('normalise_ns deletes leftovers, warns for non-defaults, switches Circles back on, waits 4 s', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.rules([
		[1, occ('config:system:get knorke_dev_skip_bump'), ''],
		list('knorke', { installed_version: '0.2.0', epoch: 'k3x9a0b2', budget_syncs: '5', changes_cap: '50', public_template: 'public', public_url: 'https://knorke-harness.example.org/', link_limit: '20', budget_bytes_board_day: '0', privacy_notice: '{"default":{"text":"T0","url":""},"languages":{}}' }),
		list('core', { shareapi_enabled: 'no', shareapi_allow_links: 'yes', shareapi_expire_after_n_days: '7', shareapi_exclude_groups_list: '["x"]', shareapi_allow_group_sharing: true, shareapi_enforce_expire_date: true, vendor: 'nextcloud' }),
		list('theming', { imprintUrl: 'https://example.org/knorke-harness/impressum', privacyUrl: 'https://example.org/eigene' }),
		[0, occ('app:list --output=json'), JSON.stringify({ enabled: { knorke: '0.2.0' }, disabled: { circles: '34.0.0' } }) + '\n'],
		[0, occ('config:app:delete *'), ''],
		[0, occ('config:app:set *'), ''],
		[0, occ('app:enable circles'), ''],
		[0, occ('circles:manage:list --output=json'), '[]\n'],
	])
	const t0 = Date.now()
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	const calls = sb.calls().filter((c) => /config:app:(delete|set)|app:enable/.test(c)).map((c) => c.replace(`exec -u www-data ${NC} php occ `, '')).sort()
	assert.deepEqual(calls, [
		'app:enable circles',
		'config:app:delete core shareapi_allow_group_sharing',
		'config:app:delete core shareapi_allow_links',
		'config:app:delete core shareapi_enabled',
		'config:app:delete core shareapi_enforce_expire_date',
		'config:app:delete core shareapi_exclude_groups_list',
		'config:app:delete core shareapi_expire_after_n_days',
		'config:app:delete knorke budget_syncs',
		'config:app:delete knorke changes_cap',
		'config:app:delete knorke privacy_notice',
		'config:app:delete knorke public_template',
		'config:app:delete knorke public_url',
		'config:app:delete theming imprintUrl',
		'config:app:set knorke budget_bytes_user_day --value=0',
		'config:app:set knorke link_limit --value=1000',
	], 'every leftover (also defaults) deleted, the dev profile values back (a missing one set, link_limit 20 of an aborted C80 back to 1000, budget_bytes_board_day 0 kept); epoch, installed_version, vendor and a foreign privacyUrl stay')
	assert.match(r.stderr, /public_url = https:\/\/knorke-harness\.example\.org\/ lag noch/, 'public_url: any value goes, with a warning')
	assert.match(r.stderr, /privacy_notice lag noch/, 'M2 privacy_notice: any value goes, with a warning')
	assert.match(r.stderr, /knorke link_limit = 20 statt Profilwert 1000 \(Profil dev/)
	assert.match(r.stderr, /knorke budget_bytes_user_day = \(nicht gesetzt\) statt Profilwert 0/)
	assert.match(r.stderr, /core shareapi_enabled = no lag noch/)
	assert.match(r.stderr, /core shareapi_exclude_groups_list = \["x"\] lag noch/)
	assert.doesNotMatch(r.stderr, /shareapi_allow_links = yes lag noch/, 'a default value is deleted without a warning')
	assert.doesNotMatch(r.stderr, /shareapi_allow_group_sharing = true lag noch/, 'a typed boolean default (true) is deleted without a warning')
	assert.match(r.stderr, /core shareapi_enforce_expire_date = true lag noch/, 'a typed boolean non-default (true) warns')
	assert.match(r.stderr, /knorke budget_syncs = 5 lag noch/)
	assert.match(r.stderr, /App circles war aus .* wieder an/)
	assert.match(r.stderr, /4 s für den APCu-Cache/)
	assert.ok(Date.now() - t0 >= 3900, 'waited for the app-config cache')
})

test('normalise_ns on a clean stack: only reads, no delete, no wait', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.rules([
		[1, occ('config:system:get knorke_dev_skip_bump'), ''],
		list('knorke', { installed_version: '0.2.0', epoch: 'k3x9a0b2', ...PROFILE_VALUES }),
		list('core', { vendor: 'nextcloud' }),
		list('theming', {}),
		[0, occ('app:list --output=json'), JSON.stringify({ enabled: { knorke: '0.2.0', circles: '34.0.0' }, disabled: {} }) + '\n'],
		[0, occ('circles:manage:list --output=json'), JSON.stringify([{ id: 'T'.repeat(31), name: 'Team Nord' }]) + '\n'],
	])
	const t0 = Date.now()
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(sb.calls().filter((c) => /delete|enable|destroy|group:/.test(c)), [])
	assert.doesNotMatch(r.stderr, /WARNUNG|4 s/)
	assert.ok(Date.now() - t0 < 3500, 'no wait')
})

const ENV2 = {
	ns: 'dznorm', db: { kind: 'pgsql' },
	users: { alice: 'Alice Adler', bob: 'Bob Berg', carol: 'Carol Clausen' },
	groups: { 'knorke-e2e': ['bob', 'carol'] },
}
/** Rules of a stack whose app config is clean (only groups and teams differ). */
const clean = (groups, teams, circles = 'enabled') => [
	[1, occ('config:system:get knorke_dev_skip_bump'), ''],
	list('knorke', { installed_version: '0.2.0', ...PROFILE_VALUES }),
	list('core', { vendor: 'nextcloud' }),
	list('theming', {}),
	[0, occ('app:list --output=json'), JSON.stringify(circles === null ? { enabled: { knorke: '0.2.0' }, disabled: {} } : { enabled: { knorke: '0.2.0', ...(circles === 'enabled' ? { circles: '34.0.0' } : {}) }, disabled: circles === 'disabled' ? { circles: '34.0.0' } : {} }) + '\n'],
	[0, occ('app:enable circles'), ''],
	[0, occ('group:list --output=json'), JSON.stringify(groups) + '\n'],
	[0, occ('group:* *'), ''],
	[0, occ('circles:manage:list --output=json'), JSON.stringify(teams) + '\n'],
	[0, occ('circles:manage:destroy *'), ''],
]
const changes = (sb) => sb.calls().filter((c) => /group:(add|adduser|removeuser) |destroy|app:enable/.test(c)).map((c) => c.replace(`exec -u www-data ${NC} php occ `, ''))

test('P7-C: in the prod profile (env.json .load.profile prod) normalise_ns deletes every HARNESS_APP_CONFIG key, profile keys included; a clean prod stack stays untouched', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.writeEnv('dznorm', { ns: 'dznorm', db: { kind: 'pgsql' }, load: { profile: 'prod', users: [] } })
	const base = (knorke) => [
		[1, occ('config:system:get knorke_dev_skip_bump'), ''],
		list('knorke', { installed_version: '0.2.0', ...knorke }),
		list('core', { vendor: 'nextcloud' }),
		list('theming', {}),
		[0, occ('app:list --output=json'), JSON.stringify({ enabled: { knorke: '0.2.0' }, disabled: {} }) + '\n'],
		[0, occ('config:app:delete *'), ''],
		[0, occ('config:app:set *'), ''],
		[0, occ('group:list --output=json'), '{}\n'],
	]
	sb.rules(base({ link_limit: '1000', budget_bytes_board_day: '0', changes_bytes_cap: '20000' }))
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	const calls = sb.calls().filter((c) => /config:app:(delete|set)/.test(c)).map((c) => c.replace(`exec -u www-data ${NC} php occ `, '')).sort()
	assert.deepEqual(calls, ['config:app:delete knorke budget_bytes_board_day', 'config:app:delete knorke changes_bytes_cap', 'config:app:delete knorke link_limit'], 'prod: the defaults of the app (nothing set)')
	assert.match(r.stderr, /knorke link_limit = 1000 lag noch .* gelöscht \(Vorgabe, Profil prod\)/)
	sb.rules(base({}))
	const t0 = Date.now()
	const r2 = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r2.status, 0, r2.stderr)
	assert.deepEqual(sb.calls().filter((c) => /config:app:(delete|set)/.test(c)), [], 'a clean prod stack: nothing set, nothing deleted')
	assert.doesNotMatch(r2.stderr, /WARNUNG|4 s/)
	assert.ok(Date.now() - t0 < 3500, 'no wait')
})

test('P7-C: contract.mjs normalise() plans the same app-config fixes as normalise_ns (appConfigFixes) and deletes a leftover public_url', () => {
	const keys = ['budget_syncs', 'budget_ops', 'tombstone_days', 'tombstone_cap', 'changes_cap', 'budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap', 'link_limit']
	const prof = { budget_bytes_board_day: '0', budget_bytes_user_day: '0', link_limit: '1000' }
	// the case of the first shell test: budget_syncs 5, changes_cap 50, link_limit 20, board quota 0, user quota missing
	assert.deepEqual(appConfigFixes(keys, prof, 'dev', { budget_syncs: '5', changes_cap: '50', link_limit: '20', budget_bytes_board_day: '0' }).map((x) => x.call.join(' ')), [
		'config:app:delete knorke budget_syncs',
		'config:app:delete knorke changes_cap',
		'config:app:set knorke budget_bytes_user_day --value=0',
		'config:app:set knorke link_limit --value=1000',
	])
	assert.deepEqual(appConfigFixes(keys, prof, 'dev', { ...prof }), [], 'a clean dev stack')
	assert.deepEqual(appConfigFixes(keys, prof, 'prod', { link_limit: '1000', budget_bytes_board_day: '0', changes_bytes_cap: '20000' }).map((x) => x.call.join(' ')), [
		'config:app:delete knorke budget_bytes_board_day',
		'config:app:delete knorke changes_bytes_cap',
		'config:app:delete knorke link_limit',
	], 'prod: everything deleted')
	assert.deepEqual(appConfigFixes(keys, prof, 'ipad', {}), [], 'a clean iPad stack')
	assert.deepEqual(appConfigFixes(keys, prof, 'dev', { link_limit: '' })[0], { key: 'budget_bytes_board_day', from: '', to: '0', call: ['config:app:set', 'knorke', 'budget_bytes_board_day', '--value=0'] })
	const fn = contract.slice(contract.indexOf('async function normalise() {'), contract.indexOf('let alice\n'))
	assert.match(fn, /\[\['config:app:get', 'knorke', 'public_url'\], \['config:app:delete', 'knorke', 'public_url'\], \[\]\]/, 'public_url: any value deleted, with a message')
	assert.match(fn, /\[\['config:app:get', 'knorke', 'privacy_notice'\], \['config:app:delete', 'knorke', 'privacy_notice'\], \[\]\]/, 'M2 privacy_notice: any value deleted (C47 needs it unset)')
	assert.match(fn, /for \(const fix of appConfigFixes\(HARNESS_APP_CONFIG, HARNESS_APP_PROFILE, PROFILE, current\)\) \{\n\t\tawait stack\.occ\(\.\.\.fix\.call\)/)
	assert.match(contract, /^const PROFILE = harnessProfile\(env\)$/m)
	assert.doesNotMatch(contract, /\.\.\.HARNESS_APP_CONFIG\.map\(\(key\) => \['knorke', key, \[\]\]\)/, 'no longer "delete every key"')
})

test('stage 2: normalise_ns puts the harness group back to env.json .groups (harness accounts only) and destroys only knorke-e2e-… teams, without waiting', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.writeEnv('dznorm', ENV2)
	const A = 'A'.repeat(31)
	const B = 'B'.repeat(31)
	const C = 'C'.repeat(31)
	sb.rules(clean(
		// alice was added, carol removed, admin (no harness account) is a member and stays
		{ admin: ['admin'], 'knorke-e2e': ['admin', 'alice', 'bob'] },
		[{ id: A, name: 'knorke-e2e-selftest' }, { id: B, name: 'Team Nord' }, { id: C, name: 'knorke-e2e-nord' }, { id: 'short', name: 'knorke-e2e-bad' }],
	))
	const t0 = Date.now()
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(changes(sb), [
		'group:removeuser knorke-e2e alice',
		'group:adduser knorke-e2e carol',
		`circles:manage:destroy ${A}`,
		`circles:manage:destroy ${C}`,
	], 'alice out, carol back in, admin untouched; the two harness teams go, Team Nord and an id that is no singleId stay')
	assert.match(r.stderr, /alice war in Gruppe knorke-e2e .* entfernt/)
	assert.match(r.stderr, /carol fehlte in Gruppe knorke-e2e .* wieder Mitglied/)
	assert.match(r.stderr, /Team A{31} \(knorke-e2e-selftest\) aus einem Testlauf lag noch – gelöscht/)
	assert.doesNotMatch(r.stderr, /4 s für den APCu-Cache/, 'memberships and teams are no app config')
	assert.ok(Date.now() - t0 < 3500, 'no wait')
})

test('stage 2: normalise_ns brings back a deleted harness group with its members; Circles off → on first, then the teams; no Circles in the image → no team step', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.writeEnv('dznorm', ENV2)
	sb.rules(clean({ admin: ['admin'] }, [{ id: 'D'.repeat(31), name: 'knorke-e2e-x' }], 'disabled'))
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	assert.deepEqual(changes(sb), [
		'app:enable circles',
		'group:add knorke-e2e',
		'group:adduser knorke-e2e bob',
		'group:adduser knorke-e2e carol',
		`circles:manage:destroy ${'D'.repeat(31)}`,
	])
	assert.match(r.stderr, /Gruppe knorke-e2e fehlte – wieder angelegt/)
	assert.match(r.stderr, /4 s für den APCu-Cache/, 'Circles back on is app config: wait')

	sb.rules(clean({ admin: ['admin'], 'knorke-e2e': ['bob', 'carol'] }, [], null))
	const r2 = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r2.status, 0, r2.stderr)
	assert.deepEqual(changes(sb), [], 'clean groups, no Circles: nothing changed')
	assert.ok(!sb.calls().some((c) => /circles:/.test(c)), 'no circles:* command without Circles in the image')
	assert.doesNotMatch(r2.stderr, /WARNUNG/)
})

test('stage 2: a failing group or team listing warns and does not stop the run', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.writeEnv('dznorm', ENV2)
	sb.rules(clean({}, []).map((r) => (/group:list|circles:manage:list/.test(r[1]) ? [1, r[1], '', 'boom\n'] : r)))
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /group:list --output=json lieferte kein JSON – Harness-Gruppen nicht geprüft/)
	assert.match(r.stderr, /circles:manage:list --output=json lieferte keine Liste – Harness-Teams nicht geprüft/)
	assert.deepEqual(changes(sb), [])
})

// ── stage 2, phase 1 (SPEC-M1 §8.1, §24 R13) ─────────────────────────────

test('R13: the system keys sharing.minSearchStringLength and sharing.maxAutocompleteResults – the same list in dev/lib.sh and contract.mjs', () => {
	const sh = lib.match(/^KD_HARNESS_SYSTEM_KEYS="([^"]*)"$/m)[1].split(/\s+/).filter(Boolean)
	const js = JSON.parse(contract.match(/^const HARNESS_SYSTEM_KEYS = (\[[^\]]*\])$/m)[1].replace(/'/g, '"'))
	assert.deepEqual(sh, ['sharing.minSearchStringLength', 'sharing.maxAutocompleteResults'])
	assert.deepEqual(js, sh)
	assert.match(contract, /\.\.\.HARNESS_SYSTEM_KEYS\.map\(\(key\) => \[\['config:system:get', key\], \['config:system:delete', key\], \[\]\]\)/, 'normalise() deletes them')
})

test('R13: Nextcloud booleans are defaults as yes|true|1 and no|false|0 in both files', () => {
	const { sh } = shareapiLists()
	for (const [k, v] of Object.entries(sh)) {
		if (v[0] === 'yes') assert.deepEqual(v, ['yes', 'true', '1'], k)
		if (v[0] === 'no') assert.deepEqual(v, ['no', 'false', '0'], k)
	}
})

test('R13: normalise_ns deletes a leftover sharing.minSearchStringLength (C63) and sharing.maxAutocompleteResults, without waiting', (t) => {
	const sb = new Sandbox()
	t.after(() => sb.cleanup())
	sb.rules([
		[1, occ('config:system:get knorke_dev_skip_bump'), ''],
		[0, occ('config:system:get sharing.minSearchStringLength'), '3\n'],
		[0, occ('config:system:get sharing.maxAutocompleteResults'), '0\n'],
		[0, occ('config:system:delete *'), ''],
		list('knorke', { installed_version: '0.2.0', ...PROFILE_VALUES }),
		list('core', { shareapi_enabled: '1', shareapi_exclude_groups: '0' }),
		list('theming', {}),
		[0, occ('app:list --output=json'), JSON.stringify({ enabled: { knorke: '0.2.0' }, disabled: {} }) + '\n'],
		[0, occ('config:app:delete *'), ''],
	])
	const t0 = Date.now()
	const r = sb.lib('normalise_ns', { KD_NS: 'dznorm' })
	assert.equal(r.status, 0, r.stderr)
	const calls = sb.calls().map((c) => c.replace(`exec -u www-data ${NC} php occ `, '')).filter((c) => /delete/.test(c)).sort()
	assert.deepEqual(calls, [
		'config:app:delete core shareapi_enabled',
		'config:app:delete core shareapi_exclude_groups',
		'config:system:delete sharing.maxAutocompleteResults',
		'config:system:delete sharing.minSearchStringLength',
	])
	assert.match(r.stderr, /System-Schlüssel sharing\.minSearchStringLength = 3 lag noch/)
	assert.match(r.stderr, /System-Schlüssel sharing\.maxAutocompleteResults = 0 lag noch/)
	assert.doesNotMatch(r.stderr, /shareapi_enabled = 1 lag noch|shareapi_exclude_groups = 0 lag noch/, '1 and 0 are typed defaults: deleted without a warning')
	assert.doesNotMatch(r.stderr, /4 s für den APCu-Cache/, 'config.php is not cached: no wait')
	assert.ok(Date.now() - t0 < 3500, 'no wait')
})

test('R13: contract.mjs normalise() plans the same group and team fixes as normalise_ns (lib/normalise.mjs)', () => {
	// the case of the shell test above: alice was added, carol removed, admin stays
	assert.deepEqual(groupFixes(ENV2, { admin: ['admin'], 'knorke-e2e': ['admin', 'alice', 'bob'] }), [
		['group:removeuser', 'knorke-e2e', 'alice'],
		['group:adduser', 'knorke-e2e', 'carol'],
	])
	// a deleted harness group comes back with its members
	assert.deepEqual(groupFixes(ENV2, { admin: ['admin'] }), [
		['group:add', 'knorke-e2e'],
		['group:adduser', 'knorke-e2e', 'bob'],
		['group:adduser', 'knorke-e2e', 'carol'],
	])
	assert.deepEqual(groupFixes(ENV2, { 'knorke-e2e': ['carol', 'bob'] }), [], 'clean: nothing')
	assert.deepEqual(groupFixes({ users: { alice: 1 } }, {}), [], 'no harness group: nothing')
	const A = 'A'.repeat(31)
	const C = 'C'.repeat(31)
	assert.deepEqual(harnessTeams([{ id: A, name: 'knorke-e2e-selftest' }, { id: 'B'.repeat(31), name: 'Team Nord' }, { id: C, name: 'knorke-e2e-nord' }, { id: 'short', name: 'knorke-e2e-bad' }]),
		[{ id: A, name: 'knorke-e2e-selftest' }, { id: C, name: 'knorke-e2e-nord' }])
	assert.deepEqual(harnessTeams(null), [])
	assert.equal(HARNESS_TEAM_PREFIX, lib.match(/^KD_HARNESS_TEAM_PREFIX="([^"]*)"$/m)[1], 'the same prefix as dev/lib.sh')
	assert.deepEqual(occJson('Notice: x\n{"a":[1]}\n'), { a: [1] })
	assert.equal(occJson('no json'), null)
	// and normalise() uses them after switching Circles on
	const fn = contract.slice(contract.indexOf('async function normalise() {'), contract.indexOf('let alice\n'))
	assert.match(fn, /for \(const call of groupFixes\(env, groups\)\) \{\n\t\t\tawait stack\.occ\(\.\.\.call\)/)
	assert.match(fn, /for \(const team of harnessTeams\(teams\)\) \{\n\t\t\tawait stack\.occ\('circles:manage:destroy', team\.id\)/)
	assert.ok(fn.indexOf('app:enable') < fn.indexOf('harnessTeams('), 'Circles on before the teams')
})
