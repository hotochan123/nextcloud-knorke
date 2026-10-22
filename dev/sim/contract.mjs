/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * HTTP contract tests C01–C40 (SPEC-M0 §8.3) plus C41–C44 (regressions of the
 * R4 review fixes T1, T4, T9/T10, T11; SPEC-M0 §15), C45–C48 (round 2:
 * Nextcloud's link policy U11 incl. group exclusion, legal links U10, 4-byte
 * text without utf8mb4 U7) and C49–C52 (SPEC-M1 §8.3, stage 0: protocol 2,
 * meta channel, board epoch, forward keys and `now`) and C53–C59 (SPEC-M1
 * §8.3, stage 1: shapes, text items, connectors with their ends, the release
 * of bound ends, the end registers, container `keep`, M0 compatibility; the
 * server part is complete from round 1a on) and C60–C68 (SPEC-M1 §8.3,
 * stage 2, Revision 13: the shares API with every rule and `at`, effective
 * roles and origins, live revocation, the sharee search, the vote link, link
 * password and expiry in the owner's calendar day, the fast path of share
 * users, the board list and teams) and C69–C75 (SPEC-M1 §8.3, stage 3,
 * Revision 16: the voting session's life cycle and codes, the vote op with
 * the R16 shape of the votes block, vote secrecy with the vt rule of step 9,
 * expiry over Stack.voteExpire in three sub-cases (vote op, moderator poll,
 * VoteCloseJob), the timer, "everyone to me" and presence v) and C76–C79
 * (SPEC-M1 §8.3, stage 4, Revision 19: the write budget in sub-cases aligned
 * to the 10-s window, the snapshot throttle of routes 12/14/15, the tombstone
 * purge over Stack.purgeTombstones and once over the CleanupJob, the changes
 * cap) and C80–C83 (SPEC-M1 §33.1 k, P7-C, Revision 22: the link throttle
 * link_limit after the owner check, the daily byte quotas, the tombstone
 * without payload and the byte cap of the change log, the presence cap with
 * the lease holder and the presenter kept, public_url for link URLs; keys set
 * through the stack helper, put back to the baseline of the profile in
 * `finally`) and C84–C85 (factory job 023, M2 SPEC-M1 §1.2 "(R20) Sperren":
 * the rights matrix of locking and unlocking over the roles owner,
 * moderate, edit, vote, view and the guest of the edit link, own and
 * foreign locks, a gone guest identity, a lost right, what stays free
 * around locks; the locker emptied by occ user:delete and by occ
 * knorke:orphans) and C86 (factory job 026, M2 SPEC-M1 §1.2 "(R20)
 * Gruppieren": the wire form of `group` for every role, the dissolve of a
 * group with one member left, also over separate batches of two clients,
 * a revive with its group, a locked member), deterministic, against the
 * dev stack of ONE namespace (KD_NS).
 *
 * C87 (factory job 028, M2 SPEC-M1 §1.2 (R23), §34 D8): end states with
 * HTTP 200. A request with `X-Knorke-End-State: 1` to routes 13, 14 and 16
 * gets guest_token, not_logged_in, link_revoked, link_expired and
 * links_disabled as 200 {end, message}; without the header (Client sends it
 * only when a case names it) the 401/403 that C03, C45, C65, C66 … check.
 *
 * Stage 4 (R19, T4-01): Nextcloud's ILimiter state is cleared before EVERY
 * case (Stack.ratelimitReset() in C(); inside C44 never, inside C77 only at
 * the points C77 names). Routes 12, 14 and 15 throttle snapshots (30 per
 * account or gid and 60 s, 300 per board and IP); snap() stays strict. The
 * harness counts its own snapshots per account and gid in a sliding 60-s
 * window (countSnapshots) and fails a case – except C77, which tests the
 * throttle – that would need more than 30, so such a case shows up before
 * the server throttles it. C44 waits 61 s after the 301st join (R19), so
 * knorke-snapip-<board> has emptied before the returning guest and L2.
 *
 * Stage 3 (R16, TST-13): the moderation budget knorke-moderate (120 per
 * 600 s, an ILimiter key in Redis) is cleared before each of C69–C75 with
 * the same Stack.ratelimitReset(); expiry goes through Stack.voteExpire
 * (lib/env.mjs, the same SQL as the bridge action vote-expire). Revision 17
 * (K2): C70 also votes on a note in the scope frame, lets an editor move it
 * out of the frame and takes the vote back (ok, left + n); an increase on it
 * stays bad.
 *
 * Stage 2 (R13, SRV-07): Nextcloud's ILimiter budgets of routes 20/21 live in
 * Redis across runs; Stack.ratelimitReset() (lib/env.mjs, the same SCAN + DEL
 * as the bridge action ratelimit-reset) clears them before each of C60–C68,
 * and the sub-cases with 61 new recipients (C60, owner carol) and 61 searches
 * (C63) run last in their case. Policies, Circles and group memberships are
 * switched through occ and put back in `finally`; normalise() also restores
 * the harness groups, deletes harness teams (knorke-e2e-…) and the system keys
 * sharing.minSearchStringLength / sharing.maxAutocompleteResults left behind
 * by an interrupted run. Boards of carol and bob are deleted by them at the end.
 *
 * Connector geometry (C55, C56) comes from lib/geom.mjs, the harness's own
 * copy of q/anchorPoint written from the spec and pinned by
 * dev/sim/geom.test.mjs against tests/fixtures/connector-golden.json; free
 * ends of rotated targets are compared with ±0.01, unrotated ones exactly
 * (§4.7 rule 14). C55 replays every golden case that fits a shape on a
 * tombstone.
 *
 * Protocol 2 (SPEC-M1 §4.3): every sync carries `ep`. Clients keep the epoch
 * of their last snapshot/join; env.epoch (read through occ at the start, and
 * again after C51 rotates it) stands in until the server sends one.
 * Redis keys carry the epoch segment (SPEC-M1 §5.1): patterns via rkey(). Port of knorke-spike/poll/load/probe.mjs, rewritten for
 * /sync. Every case builds its own board(s), so one red case does not drag
 * others along; boards are deleted at the end.
 *
 *   KD_NS=d dev/sim/run.sh contract [--only C05,C23] [--keep]
 *
 * Side channels (database client, redis-cli, occ) go through `docker exec`
 * into the namespace's own containers only (lib/env.mjs). Cases that touch the
 * brute-force counters (C27, C39, C44, C45) reset them in `finally` for the gateway
 * address of the dev network (env.json gatewayIp).
 *
 * Every KD_DB kind (round 2 U2/U13): the database side channel is portable
 * SQL (Stack.sql). A case that cannot apply to this stack is reported as
 * "übersprungen" with its reason, never as green or red: C24 needs
 * pg_stat_statements (pgsql only), C37 needs 4-byte UTF-8 in the database,
 * C48 exactly the opposite (KD_DB=mariadb|mysql with KD_MYSQL_UTF8MB4=0).
 *
 * Cases that change instance settings (C41 max_board_bytes, C45/C46 the link
 * policy, C47 theming imprintUrl/privacyUrl) restore them in `finally` and
 * wait for Nextcloud's 3-s app-config cache; normalise() removes what an
 * interrupted run left behind.
 *
 * Before the first case the namespace is normalised (round 2 U5): a
 * knorke_dev_skip_bump or public_template that an interrupted run left behind
 * is deleted (dev/sim/run.sh does it already and sets KD_NORMALISED=1; a direct
 * `node dev/sim/contract.mjs` does it here).
 *
 * Exit 0 = all cases green, 1 = at least one red, 2 = harness could not start.
 */
import { loadEnv, Stack, APP, run, rkey, rkeyIn, epochOfKey, COMPACT_KEYS } from './lib/env.mjs'
import { Client, brief, PROTOCOL, initialState } from './lib/http.mjs'
import { Suite } from './lib/report.mjs'
import { ulid, clientId, nextZ, sleep, otherToken } from './lib/gen.mjs'
import { isObj, getPath } from './lib/mirror.mjs'
import { anchorPoint, endsEqual, endpointOf, q } from './lib/geom.mjs'
import { groupFixes, harnessTeams, occJson, HARNESS_TEAM_PREFIX, harnessProfile, appConfigFixes } from './lib/normalise.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/env.mjs'

const args = process.argv.slice(2)
const ONLY = (() => {
	const i = args.indexOf('--only')
	return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',').map((s) => s.trim().toUpperCase())) : null
})()
const KEEP = args.includes('--keep')

const env = loadEnv(undefined, { anyDb: true })
const stack = new Stack(env)
const suite = new Suite('contract')
const created = []

/**
 * Knorke app config keys the harness sets (bridge app-config, stage 4; P7-C:
 * the byte quotas, the byte cap of the change log and the link throttle,
 * SPEC-M1 §33.1 j) and normalise() brings back to their baseline after an
 * interrupted run. SPEC-M1 §8.1: the same list as HARNESS_APP_CONFIG in
 * dev/lib.sh (dev/selftest checks it).
 */
const HARNESS_APP_CONFIG = ['budget_syncs', 'budget_ops', 'tombstone_days', 'tombstone_cap', 'changes_cap', 'budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap', 'link_limit']

/**
 * Profile values of the dev profile (SPEC-M1 §33.1 j, ED-22): the baseline of
 * these keys in a dev stack (up.sh sets them; the prod and iPad profiles have
 * none). The same values as HARNESS_APP_PROFILE in dev/lib.sh
 * (dev/selftest/normalise.test.mjs compares both).
 */
const HARNESS_APP_PROFILE = { budget_bytes_board_day: '0', budget_bytes_user_day: '0', link_limit: '1000' }
/** The profile of this namespace (env.json: prod, ipad or dev, §33.1 j). */
const PROFILE = harnessProfile(env)

/**
 * The baseline of a HARNESS_APP_CONFIG key in this namespace: its profile
 * value, or null (= not set). Cases that change a key put it back here in
 * `finally` (C79–C81, SPEC-M1 §33.1 j), then wait for the app-config cache.
 */
const baselineOf = (key) => (PROFILE === 'dev' && Object.prototype.hasOwnProperty.call(HARNESS_APP_PROFILE, key) ? HARNESS_APP_PROFILE[key] : null)
async function toBaseline(key) {
	const want = baselineOf(key)
	if (want === null) await stack.occ('config:app:delete', 'knorke', key)
	else await stack.occ('config:app:set', 'knorke', key, `--value=${want}`)
}

/**
 * Nextcloud's sharing policy keys of SPEC-M1 §7.4 (core shareapi_*) with their
 * defaults: normalise() deletes every one of them (= default) and says so when
 * a value other than the default stood (typed booleans may read as
 * true/false or 1/0, SPEC-M1 §24 R13). Same list as KD_SHAREAPI_KEYS in dev/lib.sh.
 */
const SHAREAPI_DEFAULTS = {
	shareapi_enabled: ['yes', 'true', '1'],
	shareapi_exclude_groups: ['no', 'false', '0'],
	shareapi_exclude_groups_list: ['', '[]'],
	shareapi_allow_group_sharing: ['yes', 'true', '1'],
	shareapi_only_share_with_group_members: ['no', 'false', '0'],
	shareapi_only_share_with_group_members_exclude_group_list: ['', '[]'],
	shareapi_allow_links: ['yes', 'true', '1'],
	shareapi_allow_links_exclude_groups: ['', '[]'],
	shareapi_enforce_links_password: ['no', 'false', '0'],
	shareapi_enforce_links_password_excluded_groups: ['', '[]'],
	shareapi_default_expire_date: ['no', 'false', '0'],
	shareapi_enforce_expire_date: ['no', 'false', '0'],
	shareapi_expire_after_n_days: ['7'],
}

/**
 * Nextcloud system config (config.php) a case sets: C63 sets
 * sharing.minSearchStringLength (SPEC-M1 §8.1/§8.3 R13, SRV-14); normalise()
 * deletes both keys when set (no APCu cache: no wait). The same list as
 * KD_HARNESS_SYSTEM_KEYS in dev/lib.sh.
 */
const HARNESS_SYSTEM_KEYS = ['sharing.minSearchStringLength', 'sharing.maxAutocompleteResults']

/**
 * Instance settings the cases change and normalise() removes after an
 * interrupted run: [app, key, harmless]. harmless is either a list of values
 * that are simply deleted without a word, or a function that says whether a
 * value is the harness's own (theming URLs the instance itself has set are
 * never touched; every URL of C47 contains "knorke-harness").
 */
const HARNESS_TAG = 'knorke-harness'
const HARNESS_SETTINGS = [
	...Object.entries(SHAREAPI_DEFAULTS).map(([key, harmless]) => ['core', key, harmless]),
	['theming', 'imprintUrl', (v) => v.includes(HARNESS_TAG)],
	['theming', 'privacyUrl', (v) => v.includes(HARNESS_TAG)],
]

/**
 * Deletes a leftover fault injection, public_template, public_url (C83; dev
 * stacks never set it, SPEC-M1 §33.1 j), privacy_notice (M2: E43/E44 set it,
 * C47 needs it unset), the harness system keys and the
 * harness settings (see above), brings HARNESS_APP_CONFIG to the baseline of
 * the namespace's profile (appConfigFixes, P7-C), switches Circles back on, puts the
 * harness groups of env.json back (exactly their harness accounts) and
 * destroys the harness teams knorke-e2e-… (SPEC-M1 §8.1, §24 R13: the same as
 * dev/lib.sh normalise_ns, so C60–C68 also start from a known state when
 * contract.mjs runs without dev/sim/run.sh; planners in lib/normalise.mjs);
 * says so when something was set.
 */
async function normalise() {
	let appConfig = false
	const circles = await stack.occ('app:list', '--output=json').then((o) => JSON.parse(o.slice(o.indexOf('{')))).catch(() => null)
	if (circles && circles.disabled && 'circles' in circles.disabled) {
		await stack.occ('app:enable', 'circles')
		console.log('Normalisiert: App circles war aus (abgebrochener Lauf?) – wieder an')
		appConfig = true
	}
	for (const [get, del, harmless] of [
		[['config:system:get', 'knorke_dev_skip_bump'], ['config:system:delete', 'knorke_dev_skip_bump'], ['0', '0.0']],
		...HARNESS_SYSTEM_KEYS.map((key) => [['config:system:get', key], ['config:system:delete', key], []]),
		[['config:app:get', 'knorke', 'public_template'], ['config:app:delete', 'knorke', 'public_template'], ['public']],
		[['config:app:get', 'knorke', 'public_url'], ['config:app:delete', 'knorke', 'public_url'], []],
		[['config:app:get', 'knorke', 'privacy_notice'], ['config:app:delete', 'knorke', 'privacy_notice'], []],
		...HARNESS_SETTINGS.map(([app, key, harmless]) => [['config:app:get', app, key], ['config:app:delete', app, key], harmless]),
	]) {
		const v = await stack.occ(...get).catch(() => '')
		if (v === '') continue
		if (typeof harmless === 'function') {
			// a setting of the instance itself (theming URLs): only the harness's own values go
			if (!harmless(v)) continue
		} else if (harmless.includes(v)) {
			await stack.occ(...del)
			continue
		}
		await stack.occ(...del)
		console.log(`Normalisiert: ${get.slice(1).join(' ')} = ${v} lag noch (abgebrochener Lauf?) – gelöscht`)
		if (get[0] === 'config:app:get') appConfig = true
	}
	// HARNESS_APP_CONFIG to the baseline of the profile (SPEC-M1 §33.1 j: profile value set, else deleted)
	const current = {}
	for (const key of HARNESS_APP_CONFIG) current[key] = await stack.occ('config:app:get', 'knorke', key).catch(() => '')
	for (const fix of appConfigFixes(HARNESS_APP_CONFIG, HARNESS_APP_PROFILE, PROFILE, current)) {
		await stack.occ(...fix.call)
		console.log(`Normalisiert: knorke ${fix.key} = ${fix.from || '(nicht gesetzt)'} → ${fix.to ?? '(gelöscht, Vorgabe)'} (Profil ${PROFILE}; abgebrochener Lauf?)`)
		appConfig = true
	}
	// harness groups (bridge group-member, C60/C62 group:adduser/removeuser) and teams (C68)
	const groups = occJson(await stack.occ('group:list', '--output=json').catch(() => ''))
	if (groups && typeof groups === 'object') {
		for (const call of groupFixes(env, groups)) {
			await stack.occ(...call)
			console.log(`Normalisiert: occ ${call.join(' ')} (Harness-Gruppe wie env.json .groups; abgebrochener Lauf?)`)
		}
	} else {
		console.log('Normalisieren: occ group:list --output=json lieferte kein JSON – Harness-Gruppen nicht geprüft')
	}
	if (circles && ((circles.enabled && 'circles' in circles.enabled) || (circles.disabled && 'circles' in circles.disabled))) {
		const teams = occJson(await stack.occ('circles:manage:list', '--output=json').catch(() => ''))
		for (const team of harnessTeams(teams)) {
			await stack.occ('circles:manage:destroy', team.id)
			console.log(`Normalisiert: Team ${team.id} (${team.name}) aus einem Testlauf lag noch – gelöscht`)
		}
	}
	if (appConfig) await sleep(4000) // app config: 3 s APCu cache of the web server (C41)
}

let alice
let bob
try {
	if (process.env.KD_NORMALISED !== '1') await normalise()
	// stand-in epoch for clients without a snapshot yet (lib/http.mjs)
	env.epoch = (await stack.epoch()) || undefined
	alice = await new Client(env, 'alice').login('alice')
	bob = await new Client(env, 'bob').login('bob')
} catch (e) {
	console.error(`Harness startet nicht: ${e.message}`)
	process.exit(2)
}
alice.client = clientId()
bob.client = clientId()
const pidCache = new Map()

// ── helpers ──────────────────────────────────────────────────────────────

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const randTok = () => {
	const al = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
	let s = ''
	for (let i = 0; i < 24; i++) s += al[Math.floor(Math.random() * al.length)]
	return s
}

async function newBoard(title = 'contract') {
	const r = await alice.createBoard(title)
	if (r.status !== 201 || !r.data?.board?.id) throw new Error(`Board anlegen: ${brief(r)}`)
	created.push(r.data.board.id)
	return r.data.board.id
}

async function snap(c, b) {
	const r = await c.snapshot(b)
	if (r.status !== 200 || !Array.isArray(r.data?.items)) throw new Error(`Snapshot ${c.name} Board ${b}: ${brief(r)}`)
	return r.data
}

async function pidOf(c, b) {
	const k = c.name + ':' + b
	if (!pidCache.has(k)) pidCache.set(k, (await snap(c, b)).me?.pid)
	return pidCache.get(k)
}

const itemIn = (s, id) => (s.items || []).find((i) => i.id === id) || null

/** Current rev of a board as the client sees it (snapshot). */
async function revOf(c, b) { return (await snap(c, b)).rev }

/** Raw sync; fills client/since unless given. Never throws on HTTP errors. */
async function rawSync(c, b, body = {}) {
	const since = body.since ?? (await revOf(c, b))
	return c.sync(b, { client: c.client, since, pres: 0, ...body })
}

let seqN = 0
/** Sync with ops; throws unless 200 with acks. Returns the answer. */
async function ops(c, b, list, extra = {}) {
	const r = await rawSync(c, b, { ops: list, seq: ++seqN, ...extra })
	if (r.status !== 200 || !r.data?.acks) throw new Error(`Sync ${c.name} (${list.length} Ops): ${brief(r)}`)
	return r.data
}

/**
 * Sync with ops at since 0 (SPEC-M1 §8.3 R19): no snapshot for the cursor, so
 * a case with many op batches stays below the snapshot budget of route 12
 * (30 per account and 60 s). Only for boards whose min_rev is 0 (no purge, no
 * set-min-rev), where since 0 never resyncs; the answer carries the items
 * since 0, the checks read acks and SQL.
 */
async function opsNoSnap(c, b, list, extra = {}) {
	return ops(c, b, list, { since: 0, ...extra })
}

function sticky(id, p = {}) {
	return { o: 'put', id, t: 'sticky', p: { x: 0, y: 0, w: 200, h: 200, r: 0, z: nextZ(), parent: null, data: { text: '' }, style: { fill: '#a8d8f8' }, ...p } }
}
function frame(id, p = {}) {
	return { o: 'put', id, t: 'frame', p: { x: 0, y: 0, w: 800, h: 600, r: 0, z: nextZ(), parent: null, data: { title: '' }, style: { fill: '#ffffff' }, ...p } }
}
const patch = (id, p) => ({ o: 'patch', id, p })
const remove = (id) => ({ o: 'remove', id })

function resIs(t, data, want, label) {
	return t.check(deepEq(data?.acks?.res, want), `${label}: ${JSON.stringify(want)}`, data?.acks)
}

async function link(b, rotate = false) {
	const r = await alice.enableLink(b, rotate)
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Link ${b}: ${brief(r)}`)
	return r.data.link.token
}

async function member(c, token) {
	const r = await c.joinLink(token)
	if (r.status !== 200) throw new Error(`Link-Beitritt ${c.name}: ${brief(r)}`)
	return r.data.boardId
}

async function guest(name, token) {
	const g = new Client(env, name, { kind: 'guest' })
	g.client = clientId()
	const r = await g.joinGuest(token, name, { client: g.client })
	if (r.status !== 200 || !g.guestToken) throw new Error(`Gast-Beitritt ${name}: ${brief(r)}`)
	g.pid = r.data.me?.pid
	g.joinAnswer = r.data
	return g
}

const errIs = (r, status, code) => r.status === status && r.data?.error === code

function b64urlDecode(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') }
function b64urlEncode(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }

const want = (id) => !ONLY || ONLY.has(id)

/**
 * Snapshot budget of stage 4 (SPEC-M1 §4.1 routes 12, 15 and the join 14 with
 * an old token: 30 per account or gid and 60 s). countSnapshots wraps
 * Client.snapshot and Client.joinGuest (a join with an old token counts for
 * its gid) and keeps the times per key; snapPeak() is the highest count in
 * any 60-s window since the case started. C() fails a case above the limit
 * (except C77) – the server would answer its 31st call with 429 slow_down.
 */
const SNAP_LIMIT = 30
const SNAP_WINDOW_MS = 60000
const snapTimes = new Map()
const gidOf = (tok) => { try { return JSON.parse(b64urlDecode(String(tok).split('.')[0])).g || '?' } catch { return '?' } }
function countSnap(key) {
	const list = snapTimes.get(key) || []
	list.push(Date.now())
	snapTimes.set(key, list)
}
function snapPeak() {
	const out = {}
	for (const [key, list] of snapTimes) {
		let peak = 0
		for (let i = 0, j = 0; i < list.length; i++) {
			while (list[i] - list[j] >= SNAP_WINDOW_MS) j++
			peak = Math.max(peak, i - j + 1)
		}
		out[key] = peak
	}
	return out
}
const origSnapshot = Client.prototype.snapshot
Client.prototype.snapshot = function (id) {
	countSnap(this.kind === 'guest' ? `gid:${gidOf(this.guestToken)}` : `user:${this.name}`)
	return origSnapshot.call(this, id)
}
const origJoinGuest = Client.prototype.joinGuest
Client.prototype.joinGuest = function (linkToken, name, o = {}) {
	const old = o.guest === undefined ? (this.guestToken || null) : o.guest
	if (old) countSnap(`gid:${gidOf(old)}`)
	return origJoinGuest.call(this, linkToken, name, o)
}

/**
 * Runs case id unless --only leaves it out. skipIf() → reason|null: a case
 * that cannot apply to this stack is reported as "übersprungen" (report.mjs).
 * Stage 4 (R19, T4-01): Stack.ratelimitReset() before every case, and the
 * snapshot count of the case checked against SNAP_LIMIT (not in C77).
 */
async function C(id, title, fn, { skipIf = null } = {}) {
	if (!want(id)) return
	const why = skipIf ? skipIf() : null
	if (why) {
		suite.skip(id, title, why)
		return
	}
	await stack.ratelimitReset()
	snapTimes.clear()
	await suite.run(id, title, async (t) => {
		try {
			await fn(t)
		} finally {
			if (id !== 'C77') {
				const peak = snapPeak()
				const over = Object.entries(peak).filter(([, n]) => n > SNAP_LIMIT)
				t.check(over.length === 0, `Harness: höchstens ${SNAP_LIMIT} Snapshots/Wiederbeitritte je Konto bzw. gid in 60 s (Routen 12, 14, 15 drosseln ab Stufe 4)`, Object.fromEntries(over))
			}
		}
	})
}

/** C24: pg_stat_statements exists only on PostgreSQL. */
const PG_ONLY = () => (stack.kind === 'pgsql' ? null : `braucht pg_stat_statements (nur KD_DB=pgsql); dieser Stack: ${stack.dbLabel}`)
/** C37: the database must keep 4-byte UTF-8 (otherwise C48 checks the U+FFFD contract). */
const NEEDS_4BYTE = () => (stack.supports4Byte ? null : `Datenbank ohne 4-Byte-UTF-8 (${stack.dbLabel}): dort gilt C48`)
/** C48: only on MariaDB/MySQL with mysql.utf8mb4 = false. */
const NO_4BYTE = () => (stack.supports4Byte
	? `Datenbank speichert 4-Byte-UTF-8 (${stack.dbLabel}); C48 gilt nur für KD_DB=mariadb|mysql mit KD_MYSQL_UTF8MB4=0`
	: null)

// Leftover throttle state from earlier runs would turn 404 into 429.
await stack.bruteforceReset().catch(() => {})

// ── cases ────────────────────────────────────────────────────────────────

await C('C01', 'Sync ohne Login → 401 von Nextcloud ({message}, kein error)', async (t) => {
	// No board needed: Nextcloud answers before the app sees the request.
	const b = 1
	const anon = new Client(env, 'anon')
	const r = await anon.request('POST', `${APP}/api/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: 'cAnon', since: 0, ep: anon.ep } })
	t.check(r.status === 401, 'Status 401', brief(r))
	t.check(isObj(r.data) && typeof r.data.message === 'string', 'JSON mit message', brief(r))
	t.check(isObj(r.data) && !('error' in r.data), 'kein error-Schlüssel', brief(r))
	const s = await anon.request('GET', `${APP}/api/v1/boards/${b}/snapshot`)
	t.check(s.status === 401 && isObj(s.data) && typeof s.data.message === 'string', 'Snapshot ohne Login ebenso 401 {message}', brief(s))
})

await C('C02', 'Gast-POST ohne X-Requested-With/Sec-Fetch-Site → 403 cross_site', async (t) => {
	// No board needed: refuseCrossSite runs before any lookup (§4.2).
	const b = 1
	const g = new Client(env, 'x', { kind: 'guest' })
	const tok = randTok()
	let r = await g.request('POST', `${APP}/pub/v1/${tok}/join`, { body: { client: 'cX', name: 'X', guest: null }, xrw: false, guest: false })
	t.check(errIs(r, 403, 'cross_site'), 'join ohne Header → 403 cross_site', brief(r))
	r = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: 'cX', since: 0, ep: g.ep }, xrw: false })
	t.check(errIs(r, 403, 'cross_site'), 'sync ohne Header → 403 cross_site', brief(r))
	r = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: 'cX', since: 0, ep: g.ep }, xrw: false, headers: { 'Sec-Fetch-Site': 'cross-site' } })
	t.check(errIs(r, 403, 'cross_site'), 'Sec-Fetch-Site: cross-site → 403 cross_site', brief(r))
	r = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: 'cX', since: 0, ep: g.ep }, xrw: false, headers: { 'Sec-Fetch-Site': 'same-origin' } })
	t.check(r.data?.error !== 'cross_site' && r.status !== 403, 'Sec-Fetch-Site: same-origin geht durch (dann 401 guest_token)', brief(r))
	t.check(errIs(r, 401, 'guest_token'), 'ohne Token → 401 guest_token', brief(r))
	r = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: 'cX', since: 0, ep: g.ep }, xrw: false, headers: { 'X-Requested-With': 'xmlhttprequest' } })
	t.check(r.data?.error !== 'cross_site', 'X-Requested-With ohne Groß-/Kleinschreibung', brief(r))
})

await C('C03', 'gefälschtes Gast-Token (Signatur, Claims, > 1024 Byte) → 401 guest_token', async (t) => {
	const b = await newBoard('C03')
	const tok = await link(b)
	const g = await guest('Gina', tok)
	const real = g.guestToken
	const ok = await g.snapshot(b)
	t.check(ok.status === 200, 'Kontrolle: echtes Token → 200', brief(ok))
	const [payload, sig] = real.split('.')
	const flip = (s) => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')
	const claims = JSON.parse(b64urlDecode(payload))
	t.check(claims.b === b && claims.v === 1 && typeof claims.g === 'string', 'Claims {v:1, b, g}', claims)
	const forged = {
		signatur: `${payload}.${flip(sig)}`,
		claims: `${b64urlEncode(JSON.stringify({ ...claims, lg: (claims.lg || 1) + 7 }))}.${sig}`,
		rolle: `${b64urlEncode(JSON.stringify({ ...claims, r: 'owner' }))}.${sig}`,
		lang: `${b64urlEncode(JSON.stringify({ ...claims, n: 'x'.repeat(1100) }))}.${sig}`,
		drei: `${payload}.${sig}.${sig}`,
		muell: 'abc',
	}
	for (const [label, ft] of Object.entries(forged)) {
		g.guestToken = ft
		const s = await g.snapshot(b)
		t.check(errIs(s, 401, 'guest_token'), `Snapshot mit ${label} → 401 guest_token`, brief(s))
		const y = await g.sync(b, { client: g.client, since: 0, pres: 0 })
		t.check(errIs(y, 401, 'guest_token'), `Sync mit ${label} → 401 guest_token`, brief(y))
	}
	t.check(forged.lang.length > 1024, 'Testtoken ist wirklich > 1024 Byte')
	g.guestToken = real
})

await C('C03b', 'Gast-Token von Board A gilt nicht für Board B ohne Link', async (t) => {
	const a = await newBoard('C03b-A')
	const tokA = await link(a)
	const g = await guest('Gina', tokA)
	const b = await newBoard('C03b-B')
	const before = await stack.boardRow(b)
	t.check(before && before.link_gen === 1, 'Board B hat link_gen 1 (nie ein Link)', before)
	const s = await g.request('GET', `${APP}/pub/v1/boards/${b}/snapshot`)
	t.check(errIs(s, 401, 'guest_token'), 'Snapshot B → 401 guest_token', brief(s))
	const y = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: g.client, since: 0, ep: g.ep, seq: 1, ops: [sticky(ulid())] } })
	t.check(errIs(y, 401, 'guest_token'), 'Sync B mit put → 401 guest_token', brief(y))
	const after = await stack.boardRow(b)
	t.check(after && after.rev === before.rev && after.item_count === 0, 'Board B unverändert', { before, after })
})

await C('C04', 'proto: 1 → 409 protocol (SPEC-M1 §12.3: 2 ist jetzt gültig)', async (t) => {
	const b = await newBoard('C04')
	const r = await alice.sync(b, { proto: 1, client: alice.client, since: 0 })
	t.check(errIs(r, 409, 'protocol'), 'proto 1 → 409 protocol', brief(r))
	const r9 = await alice.sync(b, { proto: 9, client: alice.client, since: 0 })
	t.check(errIs(r9, 409, 'protocol'), 'proto 9 → 409 protocol', brief(r9))
	const ok = await alice.sync(b, { client: alice.client, since: 0 })
	t.check(ok.status === 200 && Number.isInteger(ok.data?.rev), `Kontrolle: proto ${PROTOCOL} mit ep → 200`, brief(ok))
})

await C('C05', 'put ok; derselbe put → dup', async (t) => {
	const b = await newBoard('C05')
	const op = sticky(ulid(), { x: 10, y: 20 })
	resIs(t, await ops(alice, b, [op]), ['ok'], 'erster put')
	resIs(t, await ops(alice, b, [op]), ['dup'], 'derselbe put')
})

await C('C06', "put t:'pen' (unbekannter Typ; SPEC-M1 §12.3: shape/text/connector sind jetzt bekannt) → bad", async (t) => {
	const b = await newBoard('C06')
	const d = await ops(alice, b, [{ o: 'put', id: ulid(), t: 'pen', p: { x: 0, y: 0, w: 100, h: 100, z: nextZ() } }])
	resIs(t, d, ['bad'], 'put pen')
})

await C('C07', 'put Frame mit r:5 → bad', async (t) => {
	const b = await newBoard('C07')
	resIs(t, await ops(alice, b, [frame(ulid(), { r: 5 })]), ['bad'], 'Frame r 5')
	resIs(t, await ops(alice, b, [frame(ulid(), { r: 0 })]), ['ok'], 'Kontrolle: Frame r 0')
})

await C('C08', 'patch data.foo.bar = [1,{"a":2}] (unbekanntes Feld, Liste) → ok, erhalten', async (t) => {
	const b = await newBoard('C08')
	const id = ulid()
	await ops(alice, b, [sticky(id, { data: { text: 'bleibt' } })])
	resIs(t, await ops(alice, b, [patch(id, { 'data.foo.bar': [1, { a: 2 }] })]), ['ok'], 'patch')
	const it = itemIn(await snap(alice, b), id)
	t.check(deepEq(getPath(it, 'data.foo.bar'), [1, { a: 2 }]), 'im Snapshot erhalten', it?.data)
	t.check(it?.data?.text === 'bleibt', 'Nachbarfeld data.text unberührt', it?.data)
})

await C('C09', "patch style.fill = 'red' → bad", async (t) => {
	const b = await newBoard('C09')
	const id = ulid()
	await ops(alice, b, [sticky(id)])
	resIs(t, await ops(alice, b, [patch(id, { 'style.fill': 'red' })]), ['bad'], "style.fill 'red'")
	resIs(t, await ops(alice, b, [patch(id, { 'style.fill': '#FFAA00' })]), ['ok'], 'Kontrolle #FFAA00')
	const it = itemIn(await snap(alice, b), id)
	t.check(it?.style?.fill === '#ffaa00', 'Farbe in Kleinbuchstaben gespeichert', it?.style)
})

await C('C10', 'Text mit 6001 Zeichen → bad; 6000 → ok', async (t) => {
	const b = await newBoard('C10')
	const id = ulid()
	await ops(alice, b, [sticky(id)])
	resIs(t, await ops(alice, b, [patch(id, { 'data.text': 'x'.repeat(6001) })]), ['bad'], '6001 Zeichen')
	resIs(t, await ops(alice, b, [patch(id, { 'data.text': 'y'.repeat(6000) })]), ['ok'], '6000 Zeichen')
	const it = itemIn(await snap(alice, b), id)
	t.check(it?.data?.text === 'y'.repeat(6000), 'Text vollständig gespeichert', it?.data?.text?.length)
})

await C('C11', 'LWW gleicher Pfad: der Spätere gewinnt', async (t) => {
	const b = await newBoard('C11')
	await member(bob, await link(b))
	const id = ulid()
	await ops(alice, b, [sticky(id)])
	resIs(t, await ops(alice, b, [patch(id, { 'data.text': 'von alice' })]), ['ok'], 'alice')
	resIs(t, await ops(bob, b, [patch(id, { 'data.text': 'von bob' })]), ['ok'], 'bob danach')
	t.check(itemIn(await snap(alice, b), id)?.data?.text === 'von bob', 'bob gewinnt')
})

await C('C12', 'LWW verschiedene Pfade: beide bleiben', async (t) => {
	const b = await newBoard('C12')
	await member(bob, await link(b))
	const id = ulid()
	await ops(alice, b, [sticky(id)])
	const since = await revOf(alice, b)
	resIs(t, await ops(alice, b, [patch(id, { 'data.text': 'Text A' })], { since }), ['ok'], 'alice Text')
	resIs(t, await ops(bob, b, [patch(id, { 'style.fill': '#112233' })], { since }), ['ok'], 'bob Farbe (gleiches Fenster)')
	const it = itemIn(await snap(alice, b), id)
	t.check(it?.data?.text === 'Text A' && it?.style?.fill === '#112233', 'beide Pfade erhalten', it)
})

await C('C13', 'No-op-Patch: ok, keine changes-Zeile, rev unverändert, Rollback', async (t) => {
	const b = await newBoard('C13')
	const id = ulid()
	await ops(alice, b, [sticky(id, { x: 10, y: 20, data: { text: 'gleich' } })])
	const ch0 = await stack.changeCount(b)
	const it0 = await stack.itemRow(b, id)
	const b0 = await stack.boardRow(b)
	const d = await ops(alice, b, [patch(id, { 'data.text': 'gleich' }), patch(id, { x: 10, y: 20, parent: null })])
	resIs(t, d, ['ok', 'ok'], 'No-op Text + No-op Lage')
	const ch1 = await stack.changeCount(b)
	const it1 = await stack.itemRow(b, id)
	const b1 = await stack.boardRow(b)
	t.check(ch1 === ch0, 'keine neue changes-Zeile', { ch0, ch1 })
	t.check(it1?.rev === it0?.rev && it1?.version === it0?.version, 'Objekt-rev/version unverändert', { it0, it1 })
	t.check(b1?.rev === b0?.rev, 'Board-rev unverändert (Rollback)', { b0, b1 })
	t.check(d.acks.rev === b1?.rev, 'acks.rev = Board-rev', { acks: d.acks, board: b1 })
})

await C('C14', 'remove; patch/remove/put danach → gone ×3', async (t) => {
	const b = await newBoard('C14')
	const id = ulid()
	const put = sticky(id)
	await ops(alice, b, [put])
	resIs(t, await ops(alice, b, [remove(id)]), ['ok'], 'remove')
	resIs(t, await ops(alice, b, [patch(id, { 'data.text': 'zu spät' }), remove(id), put]), ['gone', 'gone', 'gone'], 'danach')
	t.check(!itemIn(await snap(alice, b), id), 'nicht im Snapshot')
})

await C('C15', 'put mit revive auf Grabstein → ok, lebt wieder', async (t) => {
	const b = await newBoard('C15')
	const id = ulid()
	await ops(alice, b, [sticky(id, { data: { text: 'alt' } })])
	await ops(alice, b, [remove(id)])
	const rv = sticky(id, { data: { text: 'wieder da' } })
	rv.revive = true
	resIs(t, await ops(alice, b, [rv]), ['ok'], 'put revive')
	const it = itemIn(await snap(alice, b), id)
	t.check(it?.data?.text === 'wieder da', 'lebt mit dem put-Stand', it)
	const rv2 = sticky(ulid())
	rv2.revive = true
	resIs(t, await ops(alice, b, [rv2]), ['ok'], 'revive auf nie existierende ID = normaler put')
})

await C('C16', 'Elternregeln: Notiz→Frame ok; Notiz→Notiz, Frame→Frame, nie existierend bad; Grabstein → Wurzel', async (t) => {
	const b = await newBoard('C16')
	const [F, S1, S2, F2, S3, F3, S4] = [ulid(), ulid(), ulid(), ulid(), ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(F, { x: 1000, y: 500 }), sticky(S1), sticky(S2), frame(F2, { x: -2000 }), sticky(S3), frame(F3, { x: 300, y: 400 }), sticky(S4)])
	resIs(t, await ops(alice, b, [patch(S1, { x: 10, y: 20, parent: F })]), ['ok'], 'Notiz → Frame')
	resIs(t, await ops(alice, b, [patch(S2, { x: 1, y: 1, parent: S1 })]), ['bad'], 'Notiz → Notiz')
	resIs(t, await ops(alice, b, [patch(F2, { x: 0, y: 0, parent: F })]), ['bad'], 'Frame → Frame')
	resIs(t, await ops(alice, b, [patch(S3, { x: 0, y: 0, parent: ulid() })]), ['bad'], 'nie existierender parent (patch)')
	resIs(t, await ops(alice, b, [sticky(ulid(), { parent: ulid() })]), ['bad'], 'nie existierender parent (put)')
	await ops(alice, b, [remove(F3)])
	resIs(t, await ops(alice, b, [patch(S4, { x: 5, y: 6, parent: F3 })]), ['ok'], 'Grabstein-parent (patch)')
	const S5 = ulid()
	resIs(t, await ops(alice, b, [sticky(S5, { x: 7, y: 8, parent: F3 })]), ['ok'], 'Grabstein-parent (put)')
	const s = await snap(alice, b)
	const i1 = itemIn(s, S1)
	t.check(i1?.parent === F && i1?.x === 10 && i1?.y === 20, 'S1 in F bei (10,20)', i1)
	const i4 = itemIn(s, S4)
	t.check(i4?.parent === null && i4?.x === 305 && i4?.y === 406, 'S4 an der Wurzel bei (305,406)', i4)
	const i5 = itemIn(s, S5)
	t.check(i5?.parent === null && i5?.x === 307 && i5?.y === 408, 'S5 an der Wurzel bei (307,408)', i5)
	t.check(itemIn(s, S2)?.parent === null && itemIn(s, F2)?.parent === null, 'abgelehnte Elternwechsel ohne Wirkung')
})

await C('C17', 'Frame entfernen mit 2 Kindern (DB + im Batch verschoben) → frei, je eine changes-Zeile', async (t) => {
	const b = await newBoard('C17')
	const [F, C1, C2] = [ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(F, { x: 100, y: 100 })])
	await ops(alice, b, [sticky(C1, { parent: F, x: 10, y: 10 }), sticky(C2, { parent: F, x: 20, y: 20 })])
	const d = await ops(alice, b, [patch(C2, { x: 30, y: 40, parent: F }), remove(F)])
	resIs(t, d, ['ok', 'ok'], 'patch Kind + remove Frame')
	const s = await snap(alice, b)
	const c1 = itemIn(s, C1)
	const c2 = itemIn(s, C2)
	t.check(c1?.parent === null && c1?.x === 110 && c1?.y === 110, 'C1 frei bei (110,110)', c1)
	t.check(c2?.parent === null && c2?.x === 130 && c2?.y === 140, 'C2 frei bei (130,140)', c2)
	t.check(!itemIn(s, F), 'Frame weg')
	const rows = (await stack.changes(b)).filter((r) => r.rev === d.acks.rev)
	const per = {}
	for (const r of rows) per[r.item_id] = (per[r.item_id] || 0) + 1
	t.check(per[C1] === 1 && per[C2] === 1 && per[F] === 1, 'genau eine changes-Zeile je Objekt', rows.map((r) => [r.item_id, r.op]))
	t.check(rows.find((r) => r.item_id === F)?.op === 'remove', 'Frame-Zeile ist remove')
	t.check(rows.filter((r) => r.item_id !== F).every((r) => r.op === 'patch'), 'Kinder-Zeilen sind patch')
})

await C('C18', 'Batch nur aus bad → acks.rev null, Board-rev unverändert', async (t) => {
	const b = await newBoard('C18')
	const b0 = await stack.boardRow(b)
	const d = await ops(alice, b, [{ o: 'put', id: ulid(), t: 'pen', p: { z: 'i0' } }, { o: 'patch', id: 'kein-ulid', p: { x: 1 } }, sticky(ulid(), { z: 'a' })])
	resIs(t, d, ['bad', 'bad', 'bad'], 'Ergebnis')
	t.check(d.acks.rev === null, 'acks.rev === null', d.acks)
	const b1 = await stack.boardRow(b)
	t.check(b1?.rev === b0?.rev, 'Board-rev unverändert (DB)', { b0, b1 })
})

await C('C19', 'leerer Sync: genau {rev,now,presence:{}} bzw. {rev,now} (SPEC-M1 §4.5)', async (t) => {
	const b = await newBoard('C19')
	await ops(alice, b, [sticky(ulid())])
	const n = await revOf(alice, b)
	const nowOk = (d) => Number.isInteger(d?.now) && Math.abs(d.now - Date.now()) <= 5000
	const r1 = await alice.sync(b, { client: alice.client, since: n, pres: 1 })
	t.check(r1.status === 200 && deepEq(Object.keys(r1.data || {}).sort(), ['now', 'presence', 'rev']) && r1.data.rev === n && deepEq(r1.data.presence, {}) && nowOk(r1.data),
		`pres 1 → {"rev":${n},"now":T,"presence":{}}`, r1.text)
	const r0 = await alice.sync(b, { client: alice.client, since: n, pres: 0 })
	t.check(r0.status === 200 && deepEq(Object.keys(r0.data || {}).sort(), ['now', 'rev']) && r0.data.rev === n && nowOk(r0.data), `pres 0 → {"rev":${n},"now":T}`, r0.text)
	t.check(/^\{"rev":\d+,"now":\d+(,"presence":\{\})?\}$/.test(r1.text) && /^\{"rev":\d+,"now":\d+\}$/.test(r0.text), 'wörtlich: rev, now[, presence] in dieser Reihenfolge (§4.13.8 Schritt 10)', [r1.text, r0.text])
})

await C('C20', '3 Patches auf ein Objekt zwischen zwei Syncs → ein Eintrag', async (t) => {
	const b = await newBoard('C20')
	await member(bob, await link(b))
	const id = ulid()
	await ops(alice, b, [sticky(id)])
	const c0 = await revOf(bob, b)
	for (const txt of ['eins', 'zwei', 'drei']) await ops(alice, b, [patch(id, { 'data.text': txt })])
	const r = await bob.sync(b, { client: bob.client, since: c0, pres: 0 })
	t.check(r.status === 200, '200', brief(r))
	t.check(r.data?.items?.length === 1 && r.data.items[0].id === id, 'genau ein Eintrag', r.data?.items?.map((i) => i.id))
	t.check(r.data?.items?.[0]?.data?.text === 'drei', 'mit dem letzten Stand', r.data?.items?.[0]?.data)
	t.check(!r.data?.removed, 'kein removed')
})

await C('C21', 'Paging: 3 × 200 puts → Seite 1 = 400 (2 revs) + more, Seite 2 = 200', async (t) => {
	const b = await newBoard('C21')
	const c0 = await revOf(alice, b)
	const batches = []
	const revs = []
	for (let k = 0; k < 3; k++) {
		const list = []
		for (let i = 0; i < 200; i++) list.push(sticky(ulid(), { x: i * 10, y: k * 300, w: 50, h: 50 }))
		batches.push(list.map((o) => o.id))
		const d = await ops(alice, b, list)
		revs.push(d.acks.rev)
		t.check(d.acks.res.every((x) => x === 'ok'), `Batch ${k + 1} alle ok`)
	}
	const p1 = await alice.sync(b, { client: clientId(), since: c0, pres: 0 })
	const ids1 = new Set((p1.data?.items || []).map((i) => i.id))
	t.check(p1.data?.items?.length === 400, 'Seite 1: 400 Objekte', p1.data?.items?.length)
	t.check(p1.data?.more === true, 'Seite 1: more', p1.data?.more)
	t.check(p1.data?.rev === revs[1], 'Seite 1: rev = rev von Batch 2', { rev: p1.data?.rev, revs })
	t.check([...batches[0], ...batches[1]].every((id) => ids1.has(id)), 'Seite 1 = Batch 1 + 2 vollständig')
	const p2 = await alice.sync(b, { client: clientId(), since: p1.data?.rev ?? c0, pres: 0 })
	t.check(p2.data?.items?.length === 200 && !p2.data?.more && p2.data?.rev === revs[2], 'Seite 2: 200 Objekte, kein more, rev Batch 3', { n: p2.data?.items?.length, more: p2.data?.more, rev: p2.data?.rev })
	t.check(batches[2].every((id) => (p2.data?.items || []).some((i) => i.id === id)), 'Seite 2 = Batch 3')
})

await C('C22', 'eigener Schreibvorgang: rev ≥ acks.rev, eigene Objekte in items', async (t) => {
	const b = await newBoard('C22')
	const id = ulid()
	const d = await ops(alice, b, [sticky(id, { data: { text: 'meins' } })])
	t.check(Number.isInteger(d.acks.rev) && d.rev >= d.acks.rev, 'rev ≥ acks.rev', { rev: d.rev, acks: d.acks })
	t.check((d.items || []).some((i) => i.id === id && i.data?.text === 'meins'), 'eigenes Objekt in items derselben Antwort', d.items)
})

await C('C23', 'Präsenz: Self aus, n/k, Drossel, fremde pid, 10-s-Verfall, 3 je pid, p:-TTL', async (t) => {
	const b = await newBoard('C23')
	const tok = await link(b)
	await member(bob, tok)
	const alicePid = await pidOf(alice, b)
	const bobPid = await pidOf(bob, b)
	t.check(/^[0-9a-f]{16}$/.test(alicePid || '') && /^[0-9a-f]{16}$/.test(bobPid || '') && alicePid !== bobPid, 'pids opak, 16 hex, verschieden', { alicePid, bobPid })
	const since = await revOf(alice, b)
	const a1 = clientId()
	const b1 = clientId()
	const pres = (c, client, me, extra = {}) => c.sync(b, { client, since, pres: 1, ...(me ? { me } : {}), ...extra })
	let r = await pres(alice, a1, { c: [10, 20], s: [], d: [], e: null })
	t.check(r.status === 200 && isObj(r.data?.presence) && Object.keys(r.data.presence).length === 0, 'erste Präsenz: presence {} (nur ich)', brief(r))
	r = await pres(bob, b1, { c: [1, 1], s: [], d: [], e: null })
	const aKey = `${alicePid}:${a1}`
	const ae = r.data?.presence?.[aKey]
	t.check(ae && ae.n === 'Alice Adler' && ae.k === alicePid && ae.g === 0 && ae.x === 10 && ae.y === 20, 'bob sieht alice: n, k, g, x, y', r.data?.presence)
	t.check(ae && !('t' in ae) && !('es' in ae) && 'h' in ae, 'ohne t/es, mit h', ae)
	t.check(!Object.keys(r.data?.presence || {}).some((k) => k.startsWith(bobPid + ':')), 'bob sieht sich nicht')
	t.check(!JSON.stringify(r.data?.presence || {}).includes('alice'), 'keine uid in der Präsenz')
	r = await pres(alice, a1, null)
	t.check(r.data?.presence?.[`${bobPid}:${b1}`] && !r.data.presence[aKey], 'alice sieht bob, nicht sich', r.data?.presence)
	// throttle: second write of the same key < 250 ms is dropped
	await sleep(300)
	await pres(alice, a1, { c: [30, 30], s: [], d: [], e: null })
	await pres(alice, a1, { c: [40, 40], s: [], d: [], e: null })
	r = await pres(bob, b1, null)
	t.check(r.data?.presence?.[aKey]?.x === 30, 'zweites Schreiben < 250 ms verworfen (x bleibt 30)', r.data?.presence?.[aKey])
	await sleep(300)
	await pres(alice, a1, { c: [50, 50], s: [], d: [], e: null })
	r = await pres(bob, b1, null)
	t.check(r.data?.presence?.[aKey]?.x === 50, 'nach 300 ms wieder geschrieben (x 50)', r.data?.presence?.[aKey])
	// foreign pid: bob uses alice's client id and claims her name/pid
	await pres(bob, a1, { c: [99, 99], s: [], d: [], e: null, n: 'Alice Adler', k: alicePid })
	const g = await guest('Gina', tok)
	r = await g.sync(b, { client: g.client, since, pres: 1, me: { c: [5, 5], s: [], d: [], e: null } })
	t.check(r.status === 200, 'Gast-Sync 200', brief(r))
	const p = r.data?.presence || {}
	t.check(p[aKey]?.x === 50 && p[aKey]?.n === 'Alice Adler', 'alices Eintrag unberührt', p[aKey])
	const forged = p[`${bobPid}:${a1}`]
	t.check(forged && forged.k === bobPid && forged.n === 'Bob Berg', 'bobs Versuch landet unter bobs pid und Namen', forged)
	// k stable over re-join, g = 1 for guests
	const gpid = g.pid
	const again = await g.joinGuest(tok, 'Gina', { client: g.client })
	t.check(again.status === 200 && again.data?.me?.pid === gpid, 'Neu-Beitritt mit Token → gleiche pid', { gpid, again: again.data?.me })
	r = await pres(bob, b1, null)
	const ge = r.data?.presence?.[`${gpid}:${g.client}`]
	t.check(ge && ge.k === gpid && ge.g === 1 && ge.n === 'Gina', 'Gast-Eintrag: k = pid, g 1, n = Name', ge)
	// three entries per pid
	const extra = [clientId(), clientId(), clientId()]
	for (const c of extra) {
		await sleep(40)
		await pres(alice, c, { c: [1, 2], s: [], d: [], e: null })
	}
	r = await g.sync(b, { client: g.client, since, pres: 1 })
	const keys = Object.keys(r.data?.presence || {})
	const aliceKeys = keys.filter((k) => k.startsWith(alicePid + ':'))
	t.check(aliceKeys.length === 3 && !aliceKeys.includes(aKey) && extra.every((c) => aliceKeys.includes(`${alicePid}:${c}`)), 'höchstens 3 je pid, der älteste (a1) fliegt', aliceKeys)
	t.check(keys.includes(`${bobPid}:${b1}`) && keys.includes(`${bobPid}:${a1}`), 'fremde Einträge (bob) bleiben', keys)
	const ttl = await stack.redisGet(rkey(`p:${b}`))
	t.check(ttl && ttl.ttl >= 55 && ttl.ttl <= 60, 'p:-TTL nach dem Schreiben 55–60 s', ttl && { key: ttl.key, ttl: ttl.ttl })
	// stale after 10 s
	await sleep(10500)
	r = await g.sync(b, { client: g.client, since, pres: 1, me: { c: [6, 6], s: [], d: [], e: null } })
	const left = Object.keys(r.data?.presence || {})
	t.check(r.status === 200 && left.length === 0, 'nach 10 s ohne Schreiben: alle fremden Einträge weg', left)
	const ttl2 = await stack.redisGet(rkey(`p:${b}`))
	t.check(ttl2 && ttl2.ttl >= 55 && ttl2.ttl <= 60, 'p:-TTL nach erneutem Schreiben wieder 55–60 s', ttl2 && ttl2.ttl)
})

await C('C24', 'Fastpath mit Aufwärmen: 20 leere Syncs → 0 oc_knorke_-Aufrufe', async (t) => {
	const b = await newBoard('C24')
	const tok = await link(b)
	const g = await guest('Gina', tok)
	const d = await ops(alice, b, [sticky(ulid())])
	const rev = d.rev
	await stack.redisDel(rkey(`a:${b}`), rkey(`g:${b}:*`))
	const wa = await alice.sync(b, { client: alice.client, since: rev, pres: 1 })
	const wg = await g.sync(b, { client: g.client, since: rev, pres: 1 })
	t.check(wa.status === 200 && wg.status === 200, 'Aufwärmen: je ein leerer Sync', brief(wa) + ' / ' + brief(wg))
	await stack.pgssReset()
	const t0 = Date.now()
	let bad = 0
	for (let i = 0; i < 20; i++) {
		const c = i % 2 ? g : alice
		const r = await c.sync(b, { client: c.client, since: rev, pres: 1, me: { c: [i, i], s: [], d: [], e: null } })
		if (r.status !== 200 || r.data?.rev !== rev || r.data?.items) bad++
		await sleep(250)
	}
	const ms = Date.now() - t0
	const pg = await stack.pgssCount()
	t.check(bad === 0, '20 leere Syncs fehlerfrei mit rev unverändert', bad)
	t.check(ms <= 15000, 'innerhalb von 15 s', ms)
	t.check(pg && Number(pg.total) === 0, '0 Aufrufe von Statements mit oc_knorke_', pg)
}, { skipIf: PG_ONLY })

/**
 * Boards whose items a case writes past the app (raw SQL, C25): their
 * item_bytes no longer match the stored data by design, so CINV leaves them out.
 */
const rawBoards = new Set()

/** Raises a board's rev in the DB without the app (no r: bump); returns the new rev. */
async function bumpRevRaw(b) {
	rawBoards.add(b)
	const row = await stack.sqlRow(`UPDATE oc_knorke_boards SET rev = rev + 1 WHERE id = ${b};\nSELECT rev FROM oc_knorke_boards WHERE id = ${b};`)
	return Number(row?.[0])
}

await C('C25', 'Sicherheitsnetz r: (Löschen, Senken mit TTL, since > cached)', async (t) => {
	const b = await newBoard('C25')
	const S = ulid()
	const d = await ops(alice, b, [sticky(S, { data: { text: 'start' } })])
	const R = d.rev
	// (a) delete r: → next sync reads the DB and seeds again
	const del = await stack.redisDel(rkey(`r:${b}`))
	t.check(del.length === 1, 'r: war gesetzt und ist gelöscht', del)
	let r = await alice.sync(b, { client: alice.client, since: R, pres: 0 })
	t.check(r.status === 200 && r.data?.rev === R, 'Sync nach Löschen liefert rev aus der DB', brief(r))
	const seeded = await stack.redisGet(rkey(`r:${b}`))
	t.check(seeded && Number(seeded.value) === R && seeded.ttl > 0 && seeded.ttl <= 30, 'r: neu gesät mit TTL ≤ 30', seeded)
	if (!seeded) return
	// (b) write without bump + r: lowered (= old rev) with TTL → delivered after the TTL at the latest
	const R1 = await bumpRevRaw(b)
	await stack.sql(`UPDATE oc_knorke_items SET data = '{"text":"ohne bump"}', rev = ${R1}, version = version + 1 WHERE board_id = ${b} AND id = '${S}';`)
	await stack.redis('SET', seeded.key, String(R), 'EX', '30')
	const tb = Date.now()
	let got = null
	let early = null
	while (Date.now() - tb < 33000) {
		r = await alice.sync(b, { client: alice.client, since: R, pres: 0 })
		if (early === null) early = r.data
		const it = (r.data?.items || []).find((i) => i.id === S)
		if (it?.data?.text === 'ohne bump') { got = Date.now() - tb; break }
		await sleep(1000)
	}
	t.check(got !== null && got <= 31000, 'Schreiben ohne Bump spätestens nach TTL-Ablauf geliefert', { ms: got })
	t.note(`ohne Bump geliefert nach ${got} ms; erste Antwort ${JSON.stringify(early)}`)
	// (c) since > cached → immediate DB check
	const R2 = await bumpRevRaw(b)
	await stack.sql(`UPDATE oc_knorke_items SET data = '{"text":"sofort"}', rev = ${R2}, version = version + 1 WHERE board_id = ${b} AND id = '${S}';`)
	const key = (await stack.redisScan(rkey(`r:${b}`)))[0] || seeded.key
	await stack.redis('SET', key, String(R1 - 1), 'EX', '30')
	r = await alice.sync(b, { client: alice.client, since: R1, pres: 0 })
	t.check(r.status === 200 && r.data?.rev === R2 && (r.data?.items || []).some((i) => i.id === S && i.data?.text === 'sofort'), 'since > cached → sofort aus der DB', brief(r))
	const after = await stack.redisGet(rkey(`r:${b}`))
	t.check(after && Number(after.value) === R2, 'r: auf den DB-rev angehoben', after)
})

await C('C26', 'Resync: since > rev; set-min-rev; Snapshot rev = minRev beendet die Schleife', async (t) => {
	const b = await newBoard('C26')
	const d = await ops(alice, b, [sticky(ulid())])
	const R = d.rev
	let r = await alice.sync(b, { client: alice.client, since: R + 5, pres: 0 })
	t.check(r.status === 200 && r.data?.resync === true, 'since = rev + 5 → resync', brief(r))
	const m = await stack.setMinRev(b)
	t.check(m.row && m.row.rev === R + 1 && m.row.min_rev === R + 1, 'set-min-rev: rev = min_rev = rev + 1', m.row)
	r = await alice.sync(b, { client: alice.client, since: R, pres: 0 })
	t.check(r.status === 200 && r.data?.resync === true, 'altes since → resync', brief(r))
	const s = await snap(alice, b)
	t.check(s.rev === R + 1 && s.minRev === R + 1, 'Snapshot rev = minRev', { rev: s.rev, minRev: s.minRev })
	r = await alice.sync(b, { client: alice.client, since: s.rev, pres: 0 })
	t.check(r.status === 200 && !r.data?.resync && r.data?.rev === s.rev, 'Sync mit Snapshot-rev → kein resync', brief(r))
})

await C('C27', 'Link: Name leer, gleiche pid, erneuern, Mitglied 404, /p alt, Fehlversuche', async (t) => {
	await stack.bruteforceReset()
	try {
		const b = await newBoard('C27')
		const L1 = await link(b)
		const n = new Client(env, 'leer', { kind: 'guest' })
		let r = await n.joinGuest(L1, '', { client: clientId() })
		t.check(errIs(r, 400, 'name_required'), 'Name leer → 400 name_required', brief(r))
		r = await n.joinGuest(L1, '  \u0007​ ', { client: clientId() })
		t.check(errIs(r, 400, 'name_required'), 'Name nur Leer-/Steuerzeichen → 400 name_required', brief(r))
		const g = await guest('Gina', L1)
		const T1 = g.guestToken
		r = await g.joinGuest(L1, 'Gina', { client: g.client })
		t.check(r.status === 200 && r.data?.me?.pid === g.pid, 'Neu-Beitritt mit Token → gleiche pid', r.data?.me)
		g.guestToken = T1
		t.check(r.data?.me?.guest === true && r.data?.guest?.exp > Date.now() / 1000, 'Antwort mit me.guest und guest.exp', r.data?.me)
		await member(bob, L1)
		t.check((await bob.snapshot(b)).status === 200, 'bob ist Link-Mitglied')
		const p0 = await new Client(env, 'p').publicPage(L1)
		t.check(p0.status === 200 && p0.state.linkState === 'ok' && p0.state.boardId === b && p0.state.page === 'public', '/p/L1 → linkState ok, boardId', p0.state)
		const att0 = await stack.bruteforceAttempts()
		const L2 = await link(b, true)
		t.check(L2 !== L1, 'erneuern gibt neuen Token')
		r = await g.sync(b, { client: g.client, since: 0, pres: 0 })
		t.check(errIs(r, 403, 'link_revoked'), 'altes Gast-Token → 403 link_revoked (sync)', brief(r))
		r = await g.snapshot(b)
		t.check(errIs(r, 403, 'link_revoked'), 'altes Gast-Token → 403 link_revoked (snapshot)', brief(r))
		r = await bob.sync(b, { client: bob.client, since: 0, pres: 0 })
		t.check(errIs(r, 404, 'not_found'), 'Link-Mitglied → 404', brief(r))
		const p1 = await new Client(env, 'p').publicPage(L1)
		t.check(p1.status === 200 && p1.state.linkState === 'revoked' && p1.state.boardId === null, '/p/L1 → 200 linkState revoked, boardId null', { status: p1.status, state: p1.state })
		r = await new Client(env, 'neu', { kind: 'guest' }).joinGuest(L1, 'Neu', { client: clientId() })
		t.check(errIs(r, 403, 'link_revoked'), 'Beitritt mit altem Link → 403 link_revoked', brief(r))
		const att1 = await stack.bruteforceAttempts()
		t.check(att1 === att0, 'kein Fehlversuch gezählt (oc_bruteforce_attempts unverändert)', { att0, att1 })
		const bobJoin = await bob.joinLink(L1)
		t.check(errIs(bobJoin, 403, 'link_revoked'), 'angemeldeter Beitritt mit altem Link → 403 link_revoked', brief(bobJoin))
		// never-issued token: 10 × 404, then 429
		const unknown = randTok()
		const codes = []
		for (let i = 0; i < 11; i++) {
			const x = await new Client(env, 'u', { kind: 'guest' }).joinGuest(unknown, 'Unbekannt', { client: clientId() })
			codes.push(x.status)
		}
		t.check(codes.slice(0, 10).every((c) => c === 404), 'unbekannter Token 10× → 404', codes)
		t.check(codes[10] === 429, '11. → 429', codes)
	} finally {
		await stack.bruteforceReset().catch(() => {})
	}
})

await C('C28', 'Grenzen: 201 Ops → 400, Body > 1 MiB → 413, ohne Content-Length → 411', async (t) => {
	const b = await newBoard('C28')
	const many = []
	for (let i = 0; i < 201; i++) many.push(sticky(ulid()))
	let r = await alice.sync(b, { client: alice.client, since: 0, seq: 1, ops: many, pres: 0 })
	t.check(errIs(r, 400, 'too_many_ops'), '201 Ops → 400 too_many_ops', brief(r))
	const big = JSON.stringify({ proto: PROTOCOL, client: alice.client, since: 0, ep: alice.ep, seq: 2, ops: [patch(ulid(), { 'data.text': 'x'.repeat(1100000) })] })
	r = await alice.request('POST', `${APP}/api/v1/boards/${b}/sync`, { rawBody: big })
	t.check(errIs(r, 413, 'too_large'), 'Body > 1 MiB → 413 too_large', brief(r))
	r = await alice.request('POST', `${APP}/api/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: alice.client, since: 0, ep: alice.ep }, chunked: true })
	t.check(errIs(r, 411, 'length_required'), 'chunked ohne Content-Length → 411 length_required', brief(r))
	const g = await guest('Gina', await link(b))
	r = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: g.client, since: 0, ep: g.ep }, chunked: true })
	t.check(errIs(r, 411, 'length_required'), 'Gast-Sync chunked → 411', brief(r))
	r = await alice.request('POST', `${APP}/api/v1/boards`, { body: { title: 'chunked' }, chunked: true })
	t.check(errIs(r, 411, 'length_required'), 'Board anlegen chunked → 411', brief(r))
})

await C('C29', 'gzip: Content-Encoding gzip, Body entpackt zu JSON', async (t) => {
	const b = await newBoard('C29')
	for (let k = 0; k < 2; k++) await ops(alice, b, Array.from({ length: 50 }, () => sticky(ulid(), { data: { text: 'gzip '.repeat(20) } })))
	const s = await alice.request('GET', `${APP}/api/v1/boards/${b}/snapshot`, { gzip: true })
	t.check(s.status === 200 && /gzip/i.test(s.headers['content-encoding'] || ''), 'Snapshot: Content-Encoding gzip', s.headers['content-encoding'])
	t.check(Array.isArray(s.data?.items) && s.data.items.length === 100, 'Snapshot entpackt zu gültigem JSON', s.data?.items?.length)
	t.check(s.bytes < s.text.length, 'komprimiert kleiner als entpackt', { gz: s.bytes, raw: s.text.length })
	const y = await alice.sync(b, { client: alice.client, since: 0, pres: 0 }, { gzip: true })
	t.check(y.status === 200 && /gzip/i.test(y.headers['content-encoding'] || '') && Array.isArray(y.data?.items), 'Sync: gzip + gültiges JSON', brief(y).slice(0, 80))
})

await C('C30', 'Board löschen → alle Syncs 404 (auch Fastpath), /p → revoked', async (t) => {
	const b = await newBoard('C30')
	const tok = await link(b)
	const g = await guest('Gina', tok)
	await ops(alice, b, [sticky(ulid())])
	const rev = await revOf(alice, b)
	await alice.sync(b, { client: alice.client, since: rev, pres: 1 })
	await g.sync(b, { client: g.client, since: rev, pres: 1 })
	const del = await alice.deleteBoard(b)
	t.check(del.status === 200 && del.data?.deleted === true, 'DELETE → {deleted:true}', brief(del))
	for (let i = 0; i < 2; i++) {
		const ra = await alice.sync(b, { client: alice.client, since: rev, pres: 1 })
		t.check(errIs(ra, 404, 'not_found'), `alice Sync ${i + 1} → 404`, brief(ra))
		const rg = await g.sync(b, { client: g.client, since: rev, pres: 1 })
		t.check(errIs(rg, 404, 'not_found'), `Gast Sync ${i + 1} → 404`, brief(rg))
	}
	t.check((await alice.snapshot(b)).status === 404 && (await g.snapshot(b)).status === 404, 'Snapshots → 404')
	const a = await stack.redisGet(rkey(`a:${b}`))
	t.check(!a || a.value.replace(/\s/g, '') === '[-1,-1,-1]', 'a: ist [-1,-1,-1] oder fehlt', a)
	const p = await new Client(env, 'p').publicPage(tok)
	t.check(p.status === 200 && p.state.linkState === 'revoked', '/p des gelöschten Boards → linkState revoked', { status: p.status, state: p.state })
	created.splice(created.indexOf(b), 1)
})

await C('C31', 'Lagegruppe: nur {x} bad, nur {parent} bad, {x,y,parent} ok', async (t) => {
	const b = await newBoard('C31')
	const S = ulid()
	await ops(alice, b, [sticky(S)])
	resIs(t, await ops(alice, b, [patch(S, { x: 5 })]), ['bad'], 'nur x')
	resIs(t, await ops(alice, b, [patch(S, { parent: null })]), ['bad'], 'nur parent')
	resIs(t, await ops(alice, b, [patch(S, { x: 5, y: 6 })]), ['bad'], 'x, y ohne parent')
	resIs(t, await ops(alice, b, [patch(S, { x: 5, y: 6, parent: null })]), ['ok'], 'x, y, parent')
	const it = itemIn(await snap(alice, b), S)
	t.check(it?.x === 5 && it?.y === 6, 'Lage gesetzt', it)
})

await C('C32', 'gleichzeitiges Umhängen: Endzustand = Tripel eines Schreibers', async (t) => {
	const b = await newBoard('C32')
	await member(bob, await link(b))
	const [F, S1, S2] = [ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(F, { x: 1000, y: 1000 }), sticky(S1), sticky(S2)])
	const since = await revOf(alice, b)
	await ops(alice, b, [patch(S1, { x: 100, y: 100, parent: F })], { since })
	await ops(bob, b, [patch(S1, { x: 2000, y: 500, parent: null })], { since })
	await ops(bob, b, [patch(S2, { x: 2000, y: 500, parent: null })], { since })
	await ops(alice, b, [patch(S2, { x: 100, y: 100, parent: F })], { since })
	const s = await snap(alice, b)
	const i1 = itemIn(s, S1)
	const i2 = itemIn(s, S2)
	t.check(i1?.x === 2000 && i1?.y === 500 && i1?.parent === null, 'A dann B → Bs Tripel', i1)
	t.check(i2?.x === 100 && i2?.y === 100 && i2?.parent === F, 'B dann A → As Tripel', i2)
})

await C('C33', 'Frame löschen, während ein Kind darin verschoben wird', async (t) => {
	const b = await newBoard('C33')
	await member(bob, await link(b))
	const [F1, S1, F2, S2] = [ulid(), ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(F1, { x: 400, y: 300 }), frame(F2, { x: -400, y: -300 })])
	await ops(alice, b, [sticky(S1, { parent: F1, x: 10, y: 10 }), sticky(S2, { parent: F2, x: 10, y: 10 })])
	const since = await revOf(alice, b)
	resIs(t, await ops(alice, b, [remove(F1)], { since }), ['ok'], 'A entfernt F1')
	resIs(t, await ops(bob, b, [patch(S1, { x: 50, y: 60, parent: F1 })], { since }), ['ok'], 'B verschiebt S1 in F1 danach')
	resIs(t, await ops(bob, b, [patch(S2, { x: 50, y: 60, parent: F2 })], { since }), ['ok'], 'B verschiebt S2 in F2 zuerst')
	resIs(t, await ops(alice, b, [remove(F2)], { since }), ['ok'], 'A entfernt F2 danach')
	const s = await snap(alice, b)
	const i1 = itemIn(s, S1)
	const i2 = itemIn(s, S2)
	t.check(i1?.parent === null && i1?.x === 450 && i1?.y === 360, 'S1 an der Wurzel bei (450,360)', i1)
	t.check(i2?.parent === null && i2?.x === -350 && i2?.y === -240, 'S2 an der Wurzel bei (-350,-240)', i2)
})

await C('C34', 'z-Schlüssel aus zorder-golden.json', async (t) => {
	const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'zorder-golden.json'), 'utf8'))
	const b = await newBoard('C34')
	const bad = golden.invalid.map((z) => sticky(ulid(), { z }))
	const d1 = await ops(alice, b, bad)
	golden.invalid.forEach((z, i) => t.check(d1.acks.res[i] === 'bad', `ungültig ${JSON.stringify(z)} → bad`, d1.acks.res[i]))
	const good = golden.valid.map((z) => sticky(ulid(), { z }))
	const d2 = await ops(alice, b, good)
	golden.valid.forEach((z, i) => t.check(d2.acks.res[i] === 'ok', `gültig ${JSON.stringify(z)} → ok`, d2.acks.res[i]))
	resIs(t, await ops(alice, b, [patch(good[0].id, { z: 'a' })]), ['bad'], "patch z:'a'")
	resIs(t, await ops(alice, b, [patch(good[0].id, { z: 'i5' })]), ['ok'], "Kontrolle patch z:'i5'")
})

await C('C35', 'leere Werte: {} und [] löschen, Listen ohne null/{}, Schlüsselregel, {"0":…} → Liste', async (t) => {
	const b = await newBoard('C35')
	const S = ulid()
	await ops(alice, b, [sticky(S, { data: { text: 't', x: 'v', y: [1] } })])
	resIs(t, await ops(alice, b, [patch(S, { 'data.x': {} }), patch(S, { 'data.y': [] })]), ['ok', 'ok'], 'data.x = {}, data.y = []')
	resIs(t, await ops(alice, b, [patch(S, { 'data.e': { k: {} } })]), ['ok'], 'data.e = {"k":{}}')
	resIs(t, await ops(alice, b, [patch(S, { 'data.l': [1, null] })]), ['bad'], 'data.l = [1,null]')
	resIs(t, await ops(alice, b, [patch(S, { 'data.l': [1, {}] })]), ['bad'], 'data.l = [1,{}]')
	resIs(t, await ops(alice, b, [patch(S, { 'data.n': { a: { 1: 'x' } } })]), ['bad'], 'data.n = {"a":{"1":"x"}}')
	resIs(t, await ops(alice, b, [patch(S, { 'data.o': { 0: 'a' } })]), ['ok'], 'data.o = {"0":"a"}')
	const it = itemIn(await snap(alice, b), S)
	t.check(it && !('x' in it.data) && !('y' in it.data) && !('e' in it.data) && !('l' in it.data) && !('n' in it.data), 'x, y, e, l, n fehlen im Snapshot', it?.data)
	t.check(deepEq(it?.data?.o, ['a']), 'data.o ist die Liste ["a"] (dokumentierte PHP-Grenze)', it?.data?.o)
	t.check(it?.data?.text === 't', 'data.text unberührt', it?.data)
})

await C('C36', 'Text-Lease: locked, Farbe frei, Übernahme mit tk, Verfall nach 11 s', async (t) => {
	const b = await newBoard('C36')
	await member(bob, await link(b))
	const N = ulid()
	await ops(alice, b, [sticky(N, { data: { text: 'start' } })])
	const a1 = clientId()
	const b1 = clientId()
	const since = await revOf(alice, b)
	const meA = { c: null, s: [N], d: [], e: N }
	const meB = { c: null, s: [N], d: [], e: N }
	let r = await alice.sync(b, { client: a1, since, pres: 1, me: meA })
	t.check(r.status === 200, 'alice hält die Lease (me.e = N)', brief(r))
	let d = await ops(bob, b, [patch(N, { 'data.text': 'bob1' })], { client: b1, since })
	resIs(t, d, ['locked'], 'bob data.text → locked')
	d = await ops(bob, b, [patch(N, { 'style.fill': '#123456' })], { client: b1, since })
	resIs(t, d, ['ok'], 'bob style.fill → ok')
	d = await ops(bob, b, [patch(N, { 'data.text': 'bob2' })], { client: b1, since, pres: 1, me: { ...meB, tk: 1 } })
	resIs(t, d, ['ok'], 'bob me {e:N, tk:1} + data.text im selben Sync → ok')
	d = await ops(alice, b, [patch(N, { 'data.text': 'alice2' })], { client: a1, since, pres: 1, me: meA })
	resIs(t, d, ['locked'], 'danach alice data.text → locked')
	const holder = Object.entries(d.presence || {}).find(([, e]) => e.e === N && e.h === 1)
	t.check(holder && holder[1].n === 'Bob Berg', 'alice sieht bob als Halter (h = 1)', d.presence)
	// alice quiet for 11 s, bob keeps his presence fresh
	for (let i = 0; i < 6; i++) {
		await sleep(1900)
		await bob.sync(b, { client: b1, since, pres: 0, me: meB })
	}
	d = await ops(bob, b, [patch(N, { 'data.text': 'bob3' })], { client: b1, since, pres: 0, me: meB })
	resIs(t, d, ['ok'], 'nach 11 s: bobs Lease bleibt')
	d = await ops(alice, b, [patch(N, { 'data.text': 'alice3' })], { client: a1, since, pres: 1, me: meA })
	resIs(t, d, ['locked'], 'alice kommt zurück: ohne Lease (steht hinten an)')
	const it = itemIn(await snap(alice, b), N)
	t.check(it?.data?.text === 'bob3' && it?.style?.fill === '#123456', 'Endstand: bobs Text und Farbe', it)
})

await C('C37', 'Text-Bytes: 6000 × 漢 / 😀 / < → ok', async (t) => {
	const b = await newBoard('C37')
	const S = ulid()
	await ops(alice, b, [sticky(S)])
	for (const ch of ['漢', '😀', '<']) {
		const txt = ch.repeat(6000)
		resIs(t, await ops(alice, b, [patch(S, { 'data.text': txt })]), ['ok'], `6000 × ${ch}`)
		const it = itemIn(await snap(alice, b), S)
		t.check(it?.data?.text === txt, `6000 × ${ch} unverändert gespeichert`, it?.data?.text?.length)
	}
}, { skipIf: NEEDS_4BYTE })

await C('C38', 'Body-Schlüssel: foo → 400; id eines anderen Boards → 400; abweichender token im Beitritt → 400', async (t) => {
	const b = await newBoard('C38')
	const other = await newBoard('C38-anderes')
	let r = await alice.sync(b, { client: alice.client, since: 0, foo: 1 })
	t.check(errIs(r, 400, 'bad_request'), 'Sync mit foo → 400 bad_request', brief(r))
	r = await alice.sync(b, { client: alice.client, since: 0, id: other })
	t.check(errIs(r, 400, 'bad_request'), 'Sync-Body mit id eines anderen Boards → 400', brief(r))
	r = await alice.sync(b, { client: alice.client, since: 0, id: b })
	t.check(r.status === 400 || r.status === 200, 'Sync-Body mit gleicher id: 400 oder 200 (Routenwert gleich)', brief(r))
	const tok = await link(b)
	const g = new Client(env, 'g', { kind: 'guest' })
	// Nextcloud merges the JSON body into the request parameters, so only a
	// body token that DIFFERS from the route token is detectable (§4.1 step 3
	// compares values). The differing token is derived, not random.
	const bodyTok = otherToken(tok)
	if (!t.check(bodyTok !== tok && /^[A-Za-z0-9]{24}$/.test(bodyTok), 'Body-Token weicht vom Routen-Token ab und passt zur Route', { tok, bodyTok })) return
	r = await g.request('POST', `${APP}/pub/v1/${tok}/join`, { body: { client: clientId(), name: 'Gina', guest: null, token: bodyTok }, guest: false })
	t.check(errIs(r, 400, 'bad_request'), 'Beitritt mit abweichendem token im Body → 400', brief(r))
	r = await g.request('POST', `${APP}/pub/v1/${tok}/join`, { body: { client: clientId(), name: 'Gina', guest: null, token: tok }, guest: false })
	t.check(r.status === 200, 'Beitritt mit token = Routen-Token → 200 (über IRequest nicht erkennbar, angenommen, §4.1 R3)', brief(r))
	r = await g.request('POST', `${APP}/pub/v1/${tok}/join?foo=1`, { body: { client: clientId(), name: 'Gina', guest: null }, guest: false })
	t.check(errIs(r, 400, 'bad_request'), 'Query-Parameter foo → 400', brief(r))
	r = await alice.request('POST', `${APP}/api/v1/boards`, { body: { title: 'x', owner: 'bob' } })
	t.check(errIs(r, 400, 'bad_request'), 'Anlegen mit owner → 400', brief(r))
})

await C('C39', 'Workshop-NAT nach Erneuern: 15 Gäste mit L1, danach L2 ohne 429', async (t) => {
	await stack.bruteforceReset()
	try {
		const b = await newBoard('C39')
		const L1 = await link(b)
		const guests = []
		for (let i = 1; i <= 15; i++) guests.push(await guest(`Gast${String(i).padStart(2, '0')}`, L1))
		t.check(guests.length === 15, '15 Gäste beigetreten')
		const L2 = await link(b, true)
		let pages = 0
		let revoked = 0
		for (const g of guests) {
			const p = await new Client(env, g.name).publicPage(L1)
			if (p.status === 200 && p.state.linkState === 'revoked') pages++
			const r = await g.joinGuest(L1, g.name, { client: g.client })
			if (errIs(r, 403, 'link_revoked')) revoked++
		}
		t.check(pages === 15, '15 × /p/L1 → 200 linkState revoked', pages)
		t.check(revoked === 15, '15 × Beitritt mit L1 → 403 link_revoked', revoked)
		const p2 = await new Client(env, 'neu').publicPage(L2)
		t.check(p2.status === 200 && p2.state.linkState === 'ok', '/p/L2 → 200 (kein 429)', { status: p2.status, state: p2.state })
		const n = new Client(env, 'neu', { kind: 'guest' })
		const r = await n.joinGuest(L2, 'Neu', { client: clientId() })
		t.check(r.status === 200, 'Beitritt mit L2 → 200', brief(r))
		const back = await guests[0].joinGuest(L2, guests[0].name, { client: guests[0].client })
		t.check(back.status === 200 && back.data?.me?.pid === guests[0].pid, 'Gast kommt mit L2 und altem Token zurück: gleiche pid', back.data?.me)
	} finally {
		await stack.bruteforceReset().catch(() => {})
	}
})

await C('C40', 'Batch ohne Wirkung (dup/gone/No-op) → rev, acks.rev, r: unverändert', async (t) => {
	const b = await newBoard('C40')
	const S = ulid()
	const put = sticky(S, { data: { text: 'x' } })
	const D = ulid()
	await ops(alice, b, [put, sticky(D)])
	await ops(alice, b, [remove(D)])
	const b0 = await stack.boardRow(b)
	const r0 = await stack.redisGet(rkey(`r:${b}`))
	const d = await ops(alice, b, [put, patch(ulid(), { 'data.text': 'nie da' }), remove(D), patch(S, { 'data.text': 'x' })])
	resIs(t, d, ['dup', 'gone', 'gone', 'ok'], 'Ergebnis')
	const b1 = await stack.boardRow(b)
	const r1 = await stack.redisGet(rkey(`r:${b}`))
	t.check(b1?.rev === b0?.rev, 'Board-rev unverändert', { b0, b1 })
	t.check(d.acks.rev === b0?.rev, 'acks.rev = Board-rev', { acks: d.acks, b0 })
	t.check(r0 && r1 && r0.value === r1.value, 'r: unverändert', { r0, r1 })
})

// ── R4 review fixes (SPEC-M0 §15): optional [D] cases ──────────────────────

/**
 * Nextcloud 34/35 keeps the app config in the local cache (APCu) for 3 s
 * (AppConfig::LOCAL_CACHE_TTL); occ (CLI) cannot clear the web server's copy.
 * After a change through occ, wait until every web request reads it anew.
 */
const APPCONFIG_SETTLE_MS = 4500

/** JSON with sorted object keys (order-free comparison of stored states). */
function canon(v) {
	if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
	if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
	return JSON.stringify(v)
}

/** put + revive of an item exactly as the snapshot shows it (undo of a delete). */
function reviveOf(it) {
	return { o: 'put', id: it.id, t: it.t, revive: true, p: { x: it.x, y: it.y, w: it.w, h: it.h, r: it.r, z: it.z, parent: it.parent, data: it.data, style: it.style } }
}

await C('C41', 'Byte-Budget (T1): item_bytes = Σ data+style; wachsende Op über dem Budget → limit, schrumpfende/neutrale immer ok', async (t) => {
	const b = await newBoard('C41')
	const KEY = 'max_board_bytes'
	const acct = () => stack.byteAccount(b)
	const inv = async (label) => {
		const a = await acct()
		t.check(a && Number(a.bytes) === Number(a.sum) && Number(a.count) === Number(a.live), `${label}: item_bytes = Σ octet_length(data)+octet_length(style) der lebenden Objekte, item_count = lebende`, a)
		return { bytes: Number(a?.bytes), count: Number(a?.count) }
	}
	const setBudget = async (n) => {
		await stack.occ('config:app:set', 'knorke', KEY, `--value=${n}`)
		await sleep(APPCONFIG_SETTLE_MS)
	}
	const x = (n) => 'x'.repeat(n)
	try {
		t.check((await stack.occ('config:app:get', 'knorke', KEY).catch(() => '')) === '', `Vorbedingung: ${KEY} nicht gesetzt (Vorgabe 8 MiB)`)
		// 1) accounting with the default budget (nothing hits it)
		const [A, B, F, K1, K2, D] = [ulid(), ulid(), ulid(), ulid(), ulid(), ulid()]
		resIs(t, await ops(alice, b, [sticky(A, { data: { text: 'a' } }), sticky(B, { data: { text: 'b' } }), frame(F, { x: 100, y: 100 })]), ['ok', 'ok', 'ok'], 'put A, B, Frame F')
		resIs(t, await ops(alice, b, [sticky(K1, { parent: F, x: 10, y: 10, data: { text: x(300) } }), sticky(K2, { parent: F, x: 20, y: 20 })]), ['ok', 'ok'], 'put zwei Kinder in F')
		await inv('nach put')
		resIs(t, await ops(alice, b, [patch(A, { 'data.text': x(1000) })]), ['ok'], 'patch A wächst')
		await inv('nach Wachsen')
		resIs(t, await ops(alice, b, [patch(A, { 'data.text': x(10) })]), ['ok'], 'patch A schrumpft')
		await inv('nach Schrumpfen')
		// stored 1.0 (JSON_PRESERVE_ZERO_FRACTION); the no-op patch data.v = 1, repeated, must not drift item_bytes
		const body = JSON.stringify({ proto: PROTOCOL, client: alice.client, since: await revOf(alice, b), ep: alice.ep, pres: 0, seq: ++seqN, ops: [sticky(D, { data: { text: 'd', v: 4242424242 } })] })
		const rr = await alice.request('POST', `${APP}/api/v1/boards/${b}/sync`, { rawBody: body.replace('4242424242', '1.0') })
		t.check(rr.status === 200 && deepEq(rr.data?.acks?.res, ['ok']), 'put D mit data.v = 1.0 (roh) → ok', brief(rr))
		const stored = (await stack.itemStored(b, D))?.data
		t.note(`D gespeichert als ${stored}`)
		await inv('nach put D')
		// the first patch may legitimately store 1 instead of 1.0; repeating it must change nothing
		resIs(t, await ops(alice, b, [patch(D, { 'data.v': 1 })]), ['ok'], 'patch data.v = 1 auf gespeichertes 1.0')
		const b0 = await inv('nach dem ersten data.v = 1')
		for (let i = 2; i <= 5; i++) resIs(t, await ops(alice, b, [patch(D, { 'data.v': 1 })]), ['ok'], `dasselbe noch einmal (#${i})`)
		const b1 = await inv('nach 5 × data.v = 1')
		t.check(b1.bytes === b0.bytes, 'Wiederholung driftet item_bytes nicht', { nachDemErsten: b0.bytes, nachDemFuenften: b1.bytes })
		resIs(t, await ops(alice, b, [remove(A)]), ['ok'], 'remove A')
		await inv('nach remove')
		const ra = sticky(A, { data: { text: x(10) } })
		ra.revive = true
		resIs(t, await ops(alice, b, [ra]), ['ok'], 'put + revive A')
		await inv('nach revive')
		resIs(t, await ops(alice, b, [remove(F)]), ['ok'], 'remove F (Kinder frei, Beitrag 0)')
		await inv('nach Frame-Freigabe')

		// 2) budget = current + 300 bytes
		const s0 = await inv('vor dem Budget')
		await setBudget(s0.bytes + 300)
		const [E, G, H, I] = [ulid(), ulid(), ulid(), ulid()]
		resIs(t, await ops(alice, b, [sticky(E, { data: { text: x(200) } })]), ['ok'], 'put E (≈ 229 Byte) passt')
		resIs(t, await ops(alice, b, [sticky(G, { data: { text: x(200) } })]), ['limit'], 'put G (≈ 229 Byte) → limit')
		resIs(t, await ops(alice, b, [sticky(H, { data: { text: x(10) } }), sticky(I, { data: { text: x(100) } })]), ['ok', 'limit'], 'ein Batch: H passt, I → limit (laufende Summe)')
		resIs(t, await ops(alice, b, [patch(E, { 'data.text': x(400) })]), ['limit'], 'patch E wächst über das Budget → limit')
		let s = await snap(alice, b)
		t.check(!itemIn(s, G) && !itemIn(s, I) && itemIn(s, H), 'G und I nicht angelegt, H angelegt')
		t.check(itemIn(s, E)?.data?.text === x(200), 'E unverändert (Arbeitskopie unberührt)', itemIn(s, E)?.data?.text?.length)
		const s1 = await inv('mit Budget')
		t.check(s1.bytes <= s0.bytes + 300, 'item_bytes ≤ Budget', { bytes: s1.bytes, budget: s0.bytes + 300 })

		// 3) budget lowered below the current total: cleaning up must work, growing must not
		const low = Math.max(1, Math.floor(s1.bytes / 2))
		await setBudget(low)
		resIs(t, await ops(alice, b, [patch(B, { x: 50, y: 60, parent: null })]), ['ok'], 'über dem Budget: Verschieben (größenneutral) → ok')
		resIs(t, await ops(alice, b, [patch(B, { 'style.fill': '#000000' })]), ['ok'], 'über dem Budget: Farbe gleicher Länge → ok')
		resIs(t, await ops(alice, b, [patch(B, { 'data.text': 'bb' })]), ['limit'], 'über dem Budget: Text +1 Byte → limit')
		resIs(t, await ops(alice, b, [patch(K1, { 'data.text': 'k' })]), ['ok'], 'über dem Budget: Text kürzen → ok')
		resIs(t, await ops(alice, b, [remove(B)]), ['ok'], 'über dem Budget: remove → ok')
		const rb = sticky(B, { data: { text: 'b' } })
		rb.revive = true
		resIs(t, await ops(alice, b, [rb]), ['limit'], 'über dem Budget: put + revive → limit')
		resIs(t, await ops(alice, b, [sticky(ulid())]), ['limit'], 'über dem Budget: neuer put → limit')
		s = await snap(alice, b)
		t.check(!itemIn(s, B), 'B bleibt gelöscht')
		const s2 = await inv('nach dem Aufräumen')
		t.check(s2.bytes < s1.bytes, 'item_bytes gesunken', { vorher: s1.bytes, nachher: s2.bytes })
	} finally {
		await stack.occ('config:app:delete', 'knorke', KEY).catch(() => {})
		await sleep(APPCONFIG_SETTLE_MS)
	}
})

/**
 * Throwaway accounts of one case (occ user:add like dev/up.sh, same password).
 * C42 needs them: knorke-linkjoin allows 60 joins per account and 600 s, and
 * bob's budget belongs to the other cases and to the E2E run that may follow.
 */
async function tempUsers(prefix, n) {
	const tag = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')
	const uids = []
	for (let i = 0; i < n; i++) {
		const uid = `${prefix}${tag}${i}`
		const r = await run('docker', ['exec', '-e', `OC_PASS=${env.userPass}`, '-u', 'www-data', env.containers.nc,
			'php', 'occ', 'user:add', '--password-from-env', `--display-name=${uid}`, uid], { timeoutMs: 60000 })
		if (!r.ok) throw new Error(`occ user:add ${uid}: ${(r.err || r.out).trim()}`)
		uids.push(uid)
	}
	return uids
}

async function dropUsers(uids) {
	for (const uid of uids) await stack.occ('user:delete', uid).catch(() => {})
}

await C('C42', 'Beitritt gegen Erneuern (T4, 20 Runden): kein Mitglied überlebt; Mitgliedschaft auf zurückgezogenem Link gewährt nichts', async (t) => {
	const uids = await tempUsers('cz', 2)
	try {
		const b = await newBoard('C42')
		let L = await link(b)
		// two sessions per account, so the joins really run beside alice's rotation
		const sessions = []
		for (const uid of uids) for (let i = 0; i < 2; i++) sessions.push(await new Client(env, `${uid}#${i}`).login(uid))
		const probe = sessions[0]
		const st = { joinOk: 0, join403: 0, mixed: 0, other: [], rows: [], access: [], listed: [] }
		const inList = uids.map((u) => `'${u}'`).join(',')
		const memberRows = async () => (await stack.sql(`SELECT m.user_id, m.link_id, CASE WHEN l.revoked_at IS NULL THEN 0 ELSE 1 END
			FROM oc_knorke_members m LEFT JOIN oc_knorke_links l ON l.id = m.link_id WHERE m.board_id = ${b} AND m.user_id IN (${inList});`))
			.map(([user, linkId, revoked]) => ({ user, link_id: linkId === null ? null : Number(linkId), revoked: revoked === '1' }))
		const jitter = () => Math.floor(Math.random() * 40)
		for (let round = 1; round <= 20; round++) {
			const old = L
			const rot = sleep(jitter()).then(() => alice.enableLink(b, true))
			const joins = sessions.map((c) => sleep(jitter()).then(() => c.joinLink(old)))
			const [rr, ...jr] = await Promise.all([rot, ...joins])
			if (rr.status !== 200 || !rr.data?.link?.token) throw new Error(`Runde ${round}: Erneuern ${brief(rr)}`)
			L = rr.data.link.token
			let ok = 0
			let rev = 0
			for (const r of jr) {
				if (r.status === 200) ok++
				else if (errIs(r, 403, 'link_revoked')) rev++
				else st.other.push(`R${round}: ${brief(r)}`)
			}
			st.joinOk += ok
			st.join403 += rev
			if (ok && rev) st.mixed++
			const rows = await memberRows()
			if (rows.length) st.rows.push({ round, rows })
			for (const uid of uids) {
				const c = sessions.find((x) => x.uid === uid)
				const s = await c.snapshot(b)
				if (s.status !== 404) st.access.push({ round, uid, status: s.status })
				const l = await c.listBoards()
				if ((l.data?.boards || []).some((x) => x.id === b)) st.listed.push({ round, uid })
			}
		}
		t.note(`Beitritte: ${st.joinOk} × 200 (vor dem Erneuern), ${st.join403} × 403 link_revoked; Runden mit beidem: ${st.mixed}/20`)
		t.check(st.other.length === 0, 'jeder Beitritt → 200 oder 403 link_revoked', st.other.slice(0, 3))
		t.check(st.rows.length === 0, 'nach jeder Runde keine Mitgliedszeile (kein Mitglied überlebt)', st.rows.slice(0, 3))
		t.check(st.access.length === 0, 'nach jeder Runde: Snapshot → 404', st.access.slice(0, 3))
		t.check(st.listed.length === 0, 'nach jeder Runde: Board fehlt in der Liste', st.listed.slice(0, 3))

		// backstop: a membership on a revoked link (legacy row) grants nothing; joining the active link replaces it
		const uid = uids[0]
		const [oldLink] = await stack.sqlRow(`SELECT id FROM oc_knorke_links WHERE board_id = ${b} AND revoked_at IS NOT NULL ORDER BY id LIMIT 1;`)
		// replace the row (portable: no ON CONFLICT on MySQL/MariaDB)
		await stack.sql(`DELETE FROM oc_knorke_members WHERE board_id = ${b} AND user_id = '${uid}';
			INSERT INTO oc_knorke_members (board_id, user_id, role, link_id, created_at) VALUES (${b}, '${uid}', 'edit', ${Number(oldLink)}, 0);`)
		let r = await probe.snapshot(b)
		t.check(errIs(r, 404, 'not_found'), 'Zeile auf zurückgezogenem Link: Snapshot → 404', brief(r))
		r = await probe.sync(b, { client: clientId(), since: 0, pres: 0 })
		t.check(errIs(r, 404, 'not_found'), 'Zeile auf zurückgezogenem Link: Sync → 404', brief(r))
		r = await probe.listBoards()
		t.check(r.status === 200 && !(r.data?.boards || []).some((x) => x.id === b), 'Zeile auf zurückgezogenem Link: Board fehlt in der Liste', r.data?.boards?.map((x) => x.id))
		r = await probe.joinLink(L)
		t.check(r.status === 200 && r.data?.boardId === b, 'Beitritt mit dem aktiven Link → 200', brief(r))
		r = await probe.snapshot(b)
		t.check(r.status === 200, 'danach Snapshot → 200 (Zeile ersetzt)', brief(r))
		const rows = (await memberRows()).filter((x) => x.user === uid)
		t.check(rows.length === 1 && rows[0].revoked === false, 'genau eine Mitgliedszeile, auf dem aktiven Link', rows)
		await link(b, true)
		t.check((await memberRows()).length === 0 && (await probe.snapshot(b)).status === 404, 'erneuern entfernt sie wieder')
	} finally {
		await dropUsers(uids)
	}
})

await C('C43', 'revive behält den Typ (T9); Patches bauen nur put-fähige Stände (T10)', async (t) => {
	const b = await newBoard('C43')
	// T9: stored frame, revived as sticky
	const [F, S] = [ulid(), ulid()]
	await ops(alice, b, [frame(F, { x: 100, y: 100 })])
	await ops(alice, b, [sticky(S, { parent: F, x: 10, y: 10 })])
	await ops(alice, b, [remove(F)])
	const asSticky = sticky(F)
	asSticky.revive = true
	resIs(t, await ops(alice, b, [asSticky]), ['bad'], 'Frame als Notiz wiederbeleben → bad')
	let s = await snap(alice, b)
	t.check(!itemIn(s, F), 'F bleibt gelöscht')
	const sc = itemIn(s, S)
	t.check(sc?.parent === null && sc?.x === 110 && sc?.y === 110, 'Kind frei an der Wurzel bei (110,110)', sc)
	const asFrame = frame(F, { x: 100, y: 100 })
	asFrame.revive = true
	resIs(t, await ops(alice, b, [asFrame]), ['ok'], 'Frame als Frame wiederbeleben → ok')
	// T9 in one batch: created + removed, then the id as another type
	const [F2, S2] = [ulid(), ulid()]
	resIs(t, await ops(alice, b, [frame(F2, { x: 500, y: 0 }), sticky(S2, { parent: F2, x: 5, y: 6 }), remove(F2), sticky(F2)]), ['ok', 'ok', 'ok', 'bad'], 'Batch [Frame F2, S2 in F2, remove F2, F2 als Notiz]')
	s = await snap(alice, b)
	const s2 = itemIn(s, S2)
	t.check(!itemIn(s, F2) && s2?.parent === null && s2?.x === 505 && s2?.y === 6, 'F2 fehlt, S2 frei bei (505,6)', { f2: itemIn(s, F2), s2 })

	// T10: root keys of data after a patch stay ≤ 100
	const N = ulid()
	const keys = {}
	for (let i = 0; i < 60; i++) keys['k' + i] = i
	resIs(t, await ops(alice, b, [sticky(N, { data: { text: 'n', ...keys } })]), ['ok'], 'put mit 61 Wurzelschlüsseln in data')
	const more = (from, n) => {
		const p = {}
		for (let i = from; i < from + n; i++) p['data.m' + i] = 1
		return p
	}
	resIs(t, await ops(alice, b, [patch(N, more(0, 39))]), ['ok'], 'patch auf 100 Wurzelschlüssel → ok')
	resIs(t, await ops(alice, b, [patch(N, more(39, 1))]), ['bad'], 'patch auf 101 Wurzelschlüssel → bad')
	// T10 depth: put takes 6 nested maps under a root key (isWireValue, MAX_DEPTH 6);
	// a patch path (≤ 4 keys) must not stack a value below that into a 7th
	const N2 = ulid()
	resIs(t, await ops(alice, b, [sticky(N2, { data: { text: 'n2' } })]), ['ok'], 'put N2')
	resIs(t, await ops(alice, b, [patch(N2, { 'data.q': { a: { b: { c: { d: { e: { f: 1 } } } } } } })]), ['ok'], 'patch data.q mit 6 verschachtelten Maps → ok (wie put)')
	resIs(t, await ops(alice, b, [patch(N2, { 'data.q.a.b.c': { d: { e: { f: { g: 1 } } } } })]), ['bad'], 'patch data.q.a.b.c ergäbe 7 Ebenen → bad')
	resIs(t, await ops(alice, b, [patch(N2, { 'data.q.a.b.c': { d: { e: { f: 2 } } } })]), ['ok'], 'patch data.q.a.b.c mit 6 Ebenen → ok')
	// invariant: every stored item can be put again with revive (undo of a delete)
	const s3 = await snap(alice, b)
	for (const id of [N, N2]) {
		const n0 = itemIn(s3, id)
		resIs(t, await ops(alice, b, [remove(id)]), ['ok'], `remove ${id === N ? 'N' : 'N2'}`)
		resIs(t, await ops(alice, b, [reviveOf(n0)]), ['ok'], `Rückgängig: put + revive des gespeicherten Stands von ${id === N ? 'N' : 'N2'} → ok`)
		const n1 = itemIn(await snap(alice, b), id)
		t.check(n1 && canon(n1.data) === canon(n0.data) && canon(n1.style) === canon(n0.style), `${id === N ? 'N' : 'N2'}: Stand nach dem Wiederbeleben = gespeicherter Stand`, { vorher: n0?.data && Object.keys(n0.data).length, nachher: n1?.data && Object.keys(n1.data).length })
	}
})

await C('C44', 'Gast-Budget je Board und Link (T11): 300 neue Gäste, Rückkehrer frei, Erneuern gibt frisches Budget (Stufe 4, R19: 61 s Pause nach dem 301. Beitritt, kein ratelimitReset im Fall)', async (t) => {
	await stack.bruteforceReset()
	try {
		const b = await newBoard('C44')
		const L1 = await link(b)
		const first = await guest('Erster', L1)
		let ok = 1
		let limitedAt = null
		const other = []
		for (let i = 2; i <= 320 && limitedAt === null; i++) {
			const r = await new Client(env, `g${i}`, { kind: 'guest' }).joinGuest(L1, `G${i}`, { client: clientId() })
			if (r.status === 200) ok++
			else if (errIs(r, 429, 'rate_limited')) limitedAt = i
			else other.push(`#${i}: ${brief(r)}`)
		}
		t.check(other.length === 0, 'jeder Beitritt → 200 oder 429', other.slice(0, 3))
		t.check(ok === 300 && limitedAt === 301, '300 neue Gäste → 200, der 301. → 429 rate_limited', { ok, limitedAt })
		// stage 4 (R19, T4-01): every join counted in knorke-snapip-<board> (300 per 60 s);
		// after 61 s those entries are gone, the guest budget (600 s) stays used up
		await sleep(61000)
		const back = await first.joinGuest(L1, 'Erster', { client: first.client })
		t.check(back.status === 200 && back.data?.me?.pid === first.pid, 'zurückkehrender Gast (Token dieses Boards) bleibt ausgenommen', brief(back))
		const L2 = await link(b, true)
		const r2 = await new Client(env, 'neu', { kind: 'guest' }).joinGuest(L2, 'Neu', { client: clientId() })
		t.check(r2.status === 200, 'nach dem Erneuern: neuer Gast mit L2 → 200 (frisches Budget)', brief(r2))
		const r1 = await new Client(env, 'alt', { kind: 'guest' }).joinGuest(L1, 'Alt', { client: clientId() })
		t.check(errIs(r1, 403, 'link_revoked'), 'neuer Gast mit L1 → 403 link_revoked (nicht 429)', brief(r1))
	} finally {
		await stack.bruteforceReset().catch(() => {})
	}
})


// ── round 2 (SPEC-M0 §15): link policy, legal links, 4-byte text ──────────

/**
 * Nextcloud's "Allow users to share via link" (core shareapi_allow_links).
 * Off = 'no'; on = key deleted (default 'yes'). Waits for the 3-s app-config
 * cache of the web server (APPCONFIG_SETTLE_MS).
 */
async function setLinksAllowed(on) {
	if (on) await stack.occ('config:app:delete', 'core', 'shareapi_allow_links')
	else await stack.occ('config:app:set', 'core', 'shareapi_allow_links', '--value=no')
	await sleep(APPCONFIG_SETTLE_MS)
}

/** a:<board> parsed ([aclGen, linkGen, minRev, links, voteLinkGen] or [-1,-1,-1], SPEC-M1 §5.1) with its TTL, or null. */
async function gensOf(b) {
	const g = await stack.redisGet(rkey(`a:${b}`))
	if (!g) return null
	let v = null
	try { v = JSON.parse(g.value) } catch { /* not JSON */ }
	return { value: v, ttl: g.ttl, raw: g.value }
}

/** Drops a: and the grants g: of a board: the next request takes the full path at once. */
const dropGens = (b) => stack.redisDel(rkey(`a:${b}`), rkey(`g:${b}:*`))

const LINKS_DISABLED = (r) => errIs(r, 403, 'links_disabled') && typeof r.data?.message === 'string'
const listed = (r, b) => (r.data?.boards || []).find((x) => x.id === b) || null

await C('C45', 'Link-Richtlinie (U11): verboten → 403 links_disabled (Link, Erneuern, Gast-Beitritt/-Snapshot/-Sync, Konto-Beitritt), Link-Mitglieder 404, linksAllowed; Erlauben stellt alles wieder her', async (t) => {
	await stack.bruteforceReset()
	const b = await newBoard('C45')
	const L = await link(b)
	await member(bob, L)
	const g = await guest('Gina', L)
	const b2 = await newBoard('C45-ohne-Link')
	const b3 = await newBoard('C45-abschalten')
	const L3 = await link(b3)
	const g3 = await guest('Greta', L3)
	// control while links are allowed
	let r = await alice.listBoards()
	t.check(r.status === 200 && listed(r, b)?.linksAllowed === true && listed(r, b2)?.linksAllowed === true, 'Kontrolle: Liste mit linksAllowed true', listed(r, b))
	let s = await snap(alice, b)
	t.check(s.board?.linksAllowed === true && s.board?.links?.edit?.token === L, 'Kontrolle: Besitzer-Snapshot mit links.edit und linksAllowed true (SPEC-M1 §4.4)', s.board)
	const sb = await snap(bob, b)
	t.check(isObj(sb.board) && !('linksAllowed' in sb.board) && !('links' in sb.board) && !('link' in sb.board), 'Mitglied-Snapshot ohne links und linksAllowed', sb.board)
	const gs = await g.snapshot(b)
	t.check(gs.status === 200 && isObj(gs.data?.board) && !('linksAllowed' in gs.data.board) && !('links' in gs.data.board) && !('link' in gs.data.board), 'Gast-Snapshot ohne links und linksAllowed', gs.data?.board)
	const rev = await revOf(alice, b)
	await g.sync(b, { client: g.client, since: rev, pres: 0 })
	await bob.sync(b, { client: bob.client, since: rev, pres: 0 })
	const a0 = await gensOf(b)
	t.check(Array.isArray(a0?.value) && a0.value.length === 5 && a0.value[3] === 1 && a0.ttl > 0 && a0.ttl <= 120, 'a: = [aclGen, linkGen, minRev, 1, voteLinkGen], TTL ≤ 120 s (SPEC-M1 §5.1)', a0)
	const att0 = await stack.bruteforceAttempts()
	const rowB0 = await stack.boardRow(b)
	try {
		await setLinksAllowed(false)
		// documented lag: a warm a: still says links 1 until it expires (≤ 120 s)
		const lag = await g.sync(b, { client: g.client, since: rev, pres: 0 })
		t.note(`Fastpath mit warmem a: direkt nach dem Umschalten: Gast-Sync ${lag.status}${lag.data?.error ? ' ' + lag.data.error : ''} (Verzögerung bis zum Ablauf von a:, ≤ 120 s, dokumentiert)`)
		await dropGens(b)
		await dropGens(b3)

		// the owner
		r = await alice.enableLink(b2)
		t.check(LINKS_DISABLED(r), 'Link anlegen → 403 links_disabled mit message', brief(r))
		r = await alice.enableLink(b, true)
		t.check(LINKS_DISABLED(r), 'Link erneuern → 403 links_disabled', brief(r))
		r = await alice.enableLink(b, false)
		t.check(LINKS_DISABLED(r), 'Link einschalten (rotate false) bei bestehendem Link → 403 links_disabled', brief(r))
		t.check(!('linksAllowed' in (r.data || {})), 'die 403-Antwort trägt kein linksAllowed', r.data)
		r = await bob.enableLink(b2)
		t.check(errIs(r, 404, 'not_found'), 'Fremder schaltet Link an → 404 (Besitzprüfung zuerst, kein 403)', brief(r))
		s = await snap(alice, b)
		t.check(s.board?.linksAllowed === false && s.board?.links?.edit?.token === L, 'Besitzer-Snapshot: linksAllowed false, links.edit bleibt (nicht zurückgezogen)', s.board)
		r = await alice.listBoards()
		t.check(listed(r, b)?.linksAllowed === false && listed(r, b2)?.linksAllowed === false, 'Liste des Besitzers: linksAllowed false', [listed(r, b), listed(r, b2)])
		r = await alice.renameBoard(b2, 'C45 umbenannt')
		t.check(r.status === 200 && r.data?.board?.linksAllowed === false && r.data.board.title === 'C45 umbenannt', 'Umbenennen → Board-Objekt mit linksAllowed false', brief(r))
		r = await alice.createBoard('C45-neu')
		if (r.status === 201 && r.data?.board?.id) created.push(r.data.board.id)
		t.check(r.status === 201 && r.data?.board?.linksAllowed === false, 'Anlegen → Board-Objekt mit linksAllowed false', brief(r))
		r = await alice.joinLink(L)
		t.check(r.status === 200 && r.data?.boardId === b, 'Besitzer über den eigenen Link → 200 {boardId}', brief(r))
		const row3 = await stack.boardRow(b3)
		r = await alice.disableLink(b3)
		t.check(r.status === 200, 'Link abschalten geht weiter → 200', brief(r))

		// the link member
		r = await bob.snapshot(b)
		t.check(errIs(r, 404, 'not_found'), 'Link-Mitglied: Snapshot → 404', brief(r))
		r = await bob.sync(b, { client: bob.client, since: rev, pres: 0 })
		t.check(errIs(r, 404, 'not_found'), 'Link-Mitglied: Sync → 404', brief(r))
		r = await bob.listBoards()
		t.check(r.status === 200 && !listed(r, b), 'Link-Mitglied: Board fehlt in der Liste', (r.data?.boards || []).map((x) => x.id))
		r = await bob.renameBoard(b, 'von bob')
		t.check(errIs(r, 404, 'not_found'), 'Link-Mitglied: Umbenennen → 404 (nicht 403)', brief(r))
		r = await bob.deleteBoard(b)
		t.check(errIs(r, 404, 'not_found'), 'Link-Mitglied: Löschen → 404 (nicht 403)', brief(r))
		r = await bob.joinLink(L)
		t.check(LINKS_DISABLED(r), 'angemeldeter Beitritt → 403 links_disabled', brief(r))

		// guests
		r = await g.snapshot(b)
		t.check(LINKS_DISABLED(r), 'Gast: Snapshot → 403 links_disabled', brief(r))
		const a1 = await gensOf(b)
		t.check(Array.isArray(a1?.value) && a1.value.length === 5 && a1.value[3] === 0 && a1.ttl > 0 && a1.ttl <= 120, 'a: neu gesät mit links 0 (5 Zahlen), TTL ≤ 120 s', a1)
		r = await g.sync(b, { client: g.client, since: rev, pres: 0 })
		t.check(LINKS_DISABLED(r), 'Gast: Sync (Fastpath, a:[3] = 0) → 403 links_disabled', brief(r))
		await dropGens(b)
		r = await g.sync(b, { client: g.client, since: rev, pres: 0 })
		t.check(LINKS_DISABLED(r), 'Gast: Sync (voller Weg) → 403 links_disabled', brief(r))
		r = await g.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: g.client, since: rev, ep: g.ep, seq: ++seqN, ops: [sticky(ulid())] } })
		t.check(LINKS_DISABLED(r), 'Gast: Sync mit put → 403 links_disabled', brief(r))
		const gpid = g.pid
		const tok = g.guestToken
		r = await g.joinGuest(L, 'Gina', { client: g.client })
		t.check(LINKS_DISABLED(r), 'Gast: Neu-Beitritt mit Token → 403 links_disabled', brief(r))
		g.guestToken = tok
		const n = new Client(env, 'neu', { kind: 'guest' })
		r = await n.joinGuest(L, 'Neu', { client: clientId() })
		t.check(LINKS_DISABLED(r) && !n.guestToken, 'neuer Gast: Beitritt → 403 links_disabled, kein Token', brief(r))
		r = await n.joinGuest(L, '', { client: clientId() })
		t.check(LINKS_DISABLED(r), 'neuer Gast ohne Namen → 403 links_disabled (vor name_required)', brief(r))
		// order: a revoked link stays link_revoked
		r = await g3.snapshot(b3)
		t.check(errIs(r, 403, 'link_revoked'), 'Gast eines abgeschalteten Links: 403 link_revoked vor links_disabled', brief(r))
		r = await new Client(env, 'alt', { kind: 'guest' }).joinGuest(L3, 'Alt', { client: clientId() })
		t.check(errIs(r, 403, 'link_revoked'), 'Beitritt über abgeschalteten Link → 403 link_revoked', brief(r))
		const after3 = await stack.boardRow(b3)
		t.check(after3 && row3 && after3.link_gen === row3.link_gen + 1, 'Abschalten hat link_gen erhöht (wie immer)', { row3, after3 })
		// the public page has no own state for this
		const p = await new Client(env, 'p').publicPage(L)
		t.check(p.status === 200 && p.state.linkState === 'ok' && p.state.boardId === b, '/p/L → 200 linkState ok (kein eigener Zustand)', { status: p.status, state: p.state.linkState })
		const att1 = await stack.bruteforceAttempts()
		t.check(att1 === att0, 'kein Fehlversuch gezählt', { att0, att1 })
		const rowB = await stack.boardRow(b)
		t.check(rowB && rowB0 && rowB.link_gen === rowB0.link_gen && rowB.acl_gen === rowB0.acl_gen, 'Board b: link_gen und acl_gen unverändert (nichts zurückgezogen)', { vorher: rowB0, nachher: rowB })

		// allowed again: everything comes back
		await setLinksAllowed(true)
		await dropGens(b)
		r = await bob.snapshot(b)
		t.check(r.status === 200, 'wieder erlaubt: Link-Mitglied Snapshot → 200', brief(r))
		r = await bob.listBoards()
		t.check(!!listed(r, b) && listed(r, b).linksAllowed === true, 'wieder erlaubt: Board in bobs Liste, linksAllowed true', listed(r, b))
		r = await g.snapshot(b)
		t.check(r.status === 200, 'wieder erlaubt: altes Gast-Token → Snapshot 200', brief(r))
		r = await g.joinGuest(L, 'Gina', { client: g.client })
		t.check(r.status === 200 && r.data?.me?.pid === gpid, 'wieder erlaubt: Gast kommt mit altem Token zurück, gleiche pid', r.data?.me)
		r = await new Client(env, 'neu2', { kind: 'guest' }).joinGuest(L, 'Neu', { client: clientId() })
		t.check(r.status === 200, 'wieder erlaubt: neuer Gast → 200', brief(r))
		r = await alice.enableLink(b, false)
		t.check(r.status === 200 && r.data?.link?.token === L, 'wieder erlaubt: derselbe Link L ist aktiv', brief(r))
		s = await snap(alice, b)
		t.check(s.board?.linksAllowed === true, 'wieder erlaubt: Besitzer-Snapshot linksAllowed true', s.board)
		const a2 = await gensOf(b)
		t.check(a2 && Array.isArray(a2.value) && a2.value.length === 5 && a2.value[3] === 1, 'a: wieder mit links 1', a2)
	} finally {
		await setLinksAllowed(true).catch(() => {})
		await dropGens(b).catch(() => {})
		await stack.bruteforceReset().catch(() => {})
	}
})

/** Throwaway Nextcloud group (occ group:add); returns its gid. */
async function tempGroup(prefix) {
	const gid = `${prefix}-${Math.random().toString(36).slice(2, 8)}`
	await stack.occ('group:add', gid)
	return gid
}

await C('C46', 'Gruppen-Ausnahme der Link-Richtlinie (U11): die Gruppen des Besitzers entscheiden, nie die des Besuchers', async (t) => {
	const [owner, visitor] = await tempUsers('cl', 2)
	let gid = null
	try {
		gid = await tempGroup('knorke-sim')
		await stack.occ('group:adduser', gid, owner)
		const o = await new Client(env, owner).login(owner)
		o.client = clientId()
		let r = await o.createBoard('C46-Besitzer')
		if (r.status !== 201) throw new Error(`Board anlegen (${owner}): ${brief(r)}`)
		const bo = r.data.board.id
		r = await o.createBoard('C46-Besitzer-2')
		const bo2 = r.data?.board?.id
		r = await o.enableLink(bo)
		if (r.status !== 200) throw new Error(`Link ${bo}: ${brief(r)}`)
		const Lo = r.data.link.token
		const ba = await newBoard('C46-alice')
		const La = await link(ba)
		await stack.occ('config:app:set', 'core', 'shareapi_allow_links_exclude_groups', `--value=${JSON.stringify([gid])}`)
		await sleep(APPCONFIG_SETTLE_MS)
		await dropGens(bo)
		await dropGens(ba)
		// the owner is in an excluded group
		r = await o.enableLink(bo2)
		t.check(LINKS_DISABLED(r), 'Besitzer in ausgenommener Gruppe: Link anlegen → 403 links_disabled', brief(r))
		r = await o.enableLink(bo, true)
		t.check(LINKS_DISABLED(r), 'Besitzer in ausgenommener Gruppe: Erneuern → 403 links_disabled', brief(r))
		r = await new Client(env, 'g', { kind: 'guest' }).joinGuest(Lo, 'Gast', { client: clientId() })
		t.check(LINKS_DISABLED(r), 'Gast über den Link dieses Besitzers → 403 links_disabled', brief(r))
		r = await o.listBoards()
		t.check(listed(r, bo)?.linksAllowed === false, 'Liste des Besitzers: linksAllowed false', listed(r, bo))
		// alice is not in the group: her links work
		r = await alice.enableLink(await newBoard('C46-alice-2'))
		t.check(r.status === 200 && /^[A-Za-z0-9]{24}$/.test(r.data?.link?.token || ''), 'Besitzerin außerhalb der Gruppe: Link anlegen → 200', brief(r))
		r = await alice.listBoards()
		t.check(listed(r, ba)?.linksAllowed === true, 'Liste von alice: linksAllowed true', listed(r, ba))
		// the visitor's groups do not matter
		await stack.occ('group:adduser', gid, visitor)
		const v = await new Client(env, visitor).login(visitor)
		r = await v.joinLink(La)
		t.check(r.status === 200 && r.data?.boardId === ba, 'Besucher in ausgenommener Gruppe tritt dem Link von alice bei → 200', brief(r))
		r = await v.snapshot(ba)
		t.check(r.status === 200, 'und öffnet das Board → 200', brief(r))
		r = await new Client(env, 'g2', { kind: 'guest' }).joinGuest(La, 'Gast', { client: clientId() })
		t.check(r.status === 200, 'Gast über den Link von alice → 200', brief(r))
		// the owner's own group membership ends: links work again for him
		await stack.occ('group:removeuser', gid, owner)
		await dropGens(bo)
		r = await new Client(env, 'g3', { kind: 'guest' }).joinGuest(Lo, 'Gast', { client: clientId() })
		t.check(r.status === 200, 'Besitzer aus der Gruppe entfernt: Gast-Beitritt → 200', brief(r))
	} finally {
		await stack.occ('config:app:delete', 'core', 'shareapi_allow_links_exclude_groups').catch(() => {})
		await sleep(APPCONFIG_SETTLE_MS)
		if (gid) await stack.occ('group:delete', gid).catch(() => {})
		await dropUsers([owner, visitor])
	}
})

/** The initial-state keys of every Knorke page (PageController::INITIAL_STATE_KEYS, SPEC-M1 §4.11.3: 10 with linkInfo; M2 privacy notice: 12). */
const STATE_KEYS = ['page', 'boardId', 'joinToken', 'linkToken', 'linkState', 'debug', 'protocol', 'limits', 'legal', 'linkInfo', 'privacy', 'privacyAdmin']

/** M2 privacy notice: privacy = {text, url} with nothing set by the admin (text null = built-in text, url = theming privacyUrl), privacyAdmin null. */
const privacyOk = (state, url) => isObj(state.privacy) && deepEq(Object.keys(state.privacy), ['text', 'url']) && state.privacy.text === null
	&& state.privacy.url === url && state.privacyAdmin === null

/** linkInfo (SPEC-M1 §4.11.3): {role, password} at linkState ok (null until stage 2), else null. */
const linkInfoOk = (state) => (state.linkState === 'ok'
	? state.linkInfo === null || (isObj(state.linkInfo) && ['edit', 'vote'].includes(state.linkInfo.role) && typeof state.linkInfo.password === 'boolean')
	: state.linkInfo === null)

/** theming imprintUrl/privacyUrl through occ ('' deletes), then the app-config wait. */
async function setLegal(imprint, privacy) {
	for (const [key, v] of [['imprintUrl', imprint], ['privacyUrl', privacy]]) {
		if (v === '') await stack.occ('config:app:delete', 'theming', key)
		else await stack.occ('config:app:set', 'theming', key, `--value=${v}`)
	}
	await sleep(APPCONFIG_SETTLE_MS)
}

await C('C47', 'Rechtslinks auf der Gastseite (U10): Initial-State legal = theming imprintUrl/privacyUrl, nur absolute http(s)-URLs, auf jeder /p-Variante, null für Angemeldete; M2: privacy = {text: null, url: legal.privacyUrl}, privacyAdmin null', async (t) => {
	const before = { imprint: await stack.occ('config:app:get', 'theming', 'imprintUrl').catch(() => ''), privacy: await stack.occ('config:app:get', 'theming', 'privacyUrl').catch(() => '') }
	if (!t.check(before.imprint === '' && before.privacy === '', 'Vorbedingung: theming imprintUrl/privacyUrl nicht gesetzt', before)) return
	const notice = await stack.occ('config:app:get', 'knorke', 'privacy_notice').catch(() => '')
	if (!t.check(notice === '', 'Vorbedingung: knorke privacy_notice nicht gesetzt (M2)', notice.slice(0, 120))) return
	const b = await newBoard('C47')
	const L = await link(b)
	const anon = () => new Client(env, 'p')
	let p = await anon().publicPage(L)
	t.check(p.status === 200 && deepEq(Object.keys(p.state).sort(), [...STATE_KEYS].sort()), 'Gastseite: genau die 12 Initial-State-Schlüssel (SPEC-M1 §4.11.3, M2)', Object.keys(p.state))
	t.check(p.state.protocol === PROTOCOL, `Initial-State protocol = ${PROTOCOL}`, p.state.protocol)
	t.check(linkInfoOk(p.state), 'linkInfo bei linkState ok: null oder {role, password}', p.state.linkInfo)
	t.check(deepEq(p.state.legal, { imprintUrl: '', privacyUrl: '' }), 'nicht gesetzt → {imprintUrl: "", privacyUrl: ""}', p.state.legal)
	t.check(privacyOk(p.state, ''), 'M2: privacy = {text: null, url: ""}, privacyAdmin null', { privacy: p.state.privacy, privacyAdmin: p.state.privacyAdmin })
	const H = 'https://example.org/' + HARNESS_TAG
	// [stored value, expected in legal]
	const pairs = [
		[H + '/impressum', H + '/impressum'],
		['http://example.org/' + HARNESS_TAG + '/datenschutz?x=1#y', 'http://example.org/' + HARNESS_TAG + '/datenschutz?x=1#y'],
		['  ' + H + '/getrimmt  ', H + '/getrimmt'],
		['javascript:alert("' + HARNESS_TAG + '")', ''],
		['data:text/html,' + HARNESS_TAG, ''],
		['/' + HARNESS_TAG + '/relativ', ''],
		['//example.org/' + HARNESS_TAG, ''],
		['mailto:' + HARNESS_TAG + '@example.org', ''],
		['ftp://example.org/' + HARNESS_TAG, ''],
		['https://#' + HARNESS_TAG, ''],
		['https://exa mple.org/' + HARNESS_TAG, ''],
		[H + '/' + 'x'.repeat(2100), ''],
	]
	try {
		for (let i = 0; i < pairs.length; i += 2) {
			const [[i1, w1], [p1, w2]] = [pairs[i], pairs[i + 1]]
			await setLegal(i1, p1)
			p = await anon().publicPage(L)
			const want = { imprintUrl: w1, privacyUrl: w2 }
			t.check(p.status === 200 && deepEq(p.state.legal, want), `imprintUrl ${JSON.stringify(i1.slice(0, 60))} / privacyUrl ${JSON.stringify(p1.slice(0, 60))} → ${JSON.stringify(want).slice(0, 160)}`, p.state.legal)
			t.check(privacyOk(p.state, w2), `M2: privacy.url = legal.privacyUrl ${JSON.stringify(w2.slice(0, 60))}`, p.state.privacy)
		}
		await setLegal(H + '/impressum', H + '/datenschutz')
		const want = { imprintUrl: H + '/impressum', privacyUrl: H + '/datenschutz' }
		p = await anon().publicPage(L)
		t.check(p.state.linkState === 'ok' && deepEq(p.state.legal, want), 'linkState ok: beide Links', p.state.legal)
		t.check(privacyOk(p.state, want.privacyUrl), 'linkState ok: privacy.url = theming privacyUrl (M2)', p.state.privacy)
		p = await anon().publicPage(randTok())
		t.check(p.status === 200 && p.state.linkState === 'invalid' && deepEq(p.state.legal, want), 'linkState invalid: legal ebenso', { status: p.status, state: p.state })
		t.check(p.state.linkInfo === null, 'linkState invalid: linkInfo null', p.state.linkInfo)
		t.check(privacyOk(p.state, want.privacyUrl), 'linkState invalid: privacy ebenso (M2)', p.state.privacy)
		await link(b, true)
		p = await anon().publicPage(L)
		t.check(p.status === 200 && p.state.linkState === 'revoked' && deepEq(p.state.legal, want), 'linkState revoked: legal ebenso', { status: p.status, state: p.state })
		t.check(p.state.linkInfo === null, 'linkState revoked: linkInfo null', p.state.linkInfo)
		t.check(privacyOk(p.state, want.privacyUrl), 'linkState revoked: privacy ebenso (M2)', p.state.privacy)
		const u = await alice.request('GET', `${APP}/`, { headers: { Accept: 'text/html' }, xrw: false })
		const us = initialState(u.text)
		t.check(u.status === 200 && 'legal' in us && us.legal === null, 'Seite für Angemeldete: legal = null', { status: u.status, legal: us.legal, keys: Object.keys(us) })
		t.check(deepEq(Object.keys(us).sort(), [...STATE_KEYS].sort()), 'Seite für Angemeldete: die 12 Schlüssel (M2)', Object.keys(us))
		t.check(isObj(us.privacy) && 'text' in us.privacy && typeof us.privacy.url === 'string' && us.privacyAdmin === null, 'Seite für Angemeldete: privacy ein Objekt {text, url}, privacyAdmin null (M2)', { privacy: us.privacy, privacyAdmin: us.privacyAdmin })
	} finally {
		await setLegal('', '').catch(() => {})
	}
})

await C('C48', '4-Byte-UTF-8 ohne utf8mb4 (U7): Emoji → U+FFFD gespeichert, nie 500, der Schreiber bekommt den gespeicherten Stand in derselben Antwort', async (t) => {
	const R = '�'
	const sys = await stack.occ('config:system:get', 'mysql.utf8mb4').catch(() => '')
	t.check(sys === 'false', 'Vorbedingung: Nextcloud läuft mit mysql.utf8mb4 = false', sys)
	// board titles
	let r = await alice.createBoard('Retro 👍')
	if (r.status === 201 && r.data?.board?.id) created.push(r.data.board.id)
	if (!t.check(r.status === 201 && r.data?.board?.title === 'Retro ' + R, 'Anlegen „Retro 👍“ → 201 mit Titel „Retro U+FFFD“ (kein 500)', brief(r))) return
	const b = r.data.board.id
	t.check((await stack.boardTitle(b)) === 'Retro ' + R, 'Titel in der DB mit U+FFFD')
	r = await alice.renameBoard(b, '🎯 Plan 😀 Q4 𝄞')
	t.check(r.status === 200 && r.data?.board?.title === `${R} Plan ${R} Q4 ${R}`, 'Umbenennen mit drei 4-Byte-Zeichen → 200, Antwort trägt den gespeicherten Titel', brief(r))
	r = await alice.renameBoard(b, '€ ü 中 ✓ Plan')
	t.check(r.status === 200 && r.data?.board?.title === '€ ü 中 ✓ Plan', 'Kontrolle: 2-/3-Byte-Zeichen bleiben unverändert', brief(r))
	// one batch: plain + emoji sticky + frame title + nested values (lists, maps, style)
	const [P, E, F, N] = [ulid(), ulid(), ulid(), ulid()]
	const since = await revOf(alice, b)
	const batch = [
		sticky(P, { data: { text: 'plain € ü 中' } }),
		sticky(E, { data: { text: 'great idea 👍' } }),
		frame(F, { data: { title: '🎯 Ziel' } }),
		sticky(N, { data: { text: 'n', foo: { bar: ['😀', { a: 'x𝄞y' }], k: '🦊' } }, style: { fill: '#a8d8f8', label: '🏷 tag' } }),
	]
	r = await rawSync(alice, b, { ops: batch, seq: ++seqN, since })
	if (!t.check(r.status === 200 && r.data?.acks, 'Batch mit Emoji → 200 (kein 500)', brief(r))) return
	resIs(t, r.data, ['ok', 'ok', 'ok', 'ok'], 'alle vier Ops (auch die ohne Emoji)')
	const own = (id) => (r.data.items || []).find((i) => i.id === id)
	t.check(Number.isInteger(r.data.acks.rev) && r.data.acks.rev > since && r.data.rev >= r.data.acks.rev, 'acks.rev > since, rev ≥ acks.rev', { since, rev: r.data.rev, acks: r.data.acks })
	t.check(own(E)?.data?.text === 'great idea ' + R, 'eigene Antwort: Notiz mit U+FFFD statt 👍', own(E)?.data)
	t.check(own(F)?.data?.title === R + ' Ziel', 'eigene Antwort: Frame-Titel mit U+FFFD', own(F)?.data)
	t.check(deepEq(own(N)?.data?.foo, { bar: [R, { a: 'x' + R + 'y' }], k: R }), 'eigene Antwort: in Listen und Maps jeder Tiefe ersetzt', own(N)?.data)
	t.check(own(N)?.style?.label === R + ' tag' && own(N)?.style?.fill === '#a8d8f8', 'eigene Antwort: Zeichenkette in style ersetzt', own(N)?.style)
	t.check(own(P)?.data?.text === 'plain € ü 中', 'eigene Antwort: Notiz ohne 4-Byte-Zeichen unverändert', own(P)?.data)
	let snapItems = await snap(alice, b)
	t.check(itemIn(snapItems, E)?.data?.text === 'great idea ' + R && itemIn(snapItems, F)?.data?.title === R + ' Ziel', 'Snapshot = gespeicherter Stand', [itemIn(snapItems, E)?.data, itemIn(snapItems, F)?.data])
	const stored = await stack.itemStored(b, E)
	let parsed = null
	try { parsed = JSON.parse(stored?.data ?? 'null') } catch { /* reported below */ }
	t.check(parsed?.text === 'great idea ' + R, 'DB-Spalte data hält U+FFFD', stored)
	// a patch, read by another participant
	await member(bob, await link(b))
	const bobSince = await revOf(bob, b)
	r = await rawSync(alice, b, { ops: [patch(E, { 'data.text': 'neu 🚀🚀' })], seq: ++seqN })
	resIs(t, r.data, ['ok'], 'patch mit zwei Emoji')
	t.check((r.data?.items || []).find((i) => i.id === E)?.data?.text === 'neu ' + R + R, 'eigene Antwort auf den patch: gespeicherter Text', r.data?.items)
	const rb = await bob.sync(b, { client: bob.client, since: bobSince, pres: 0 })
	t.check(rb.status === 200 && (rb.data?.items || []).find((i) => i.id === E)?.data?.text === 'neu ' + R + R, 'bob liest den gespeicherten Text', brief(rb))
	// code points stay code points: the 6000-character limit still holds
	r = await rawSync(alice, b, { ops: [patch(E, { 'data.text': '😀'.repeat(6000) })], seq: ++seqN })
	resIs(t, r.data, ['ok'], '6000 × 😀 → ok')
	snapItems = await snap(alice, b)
	t.check(itemIn(snapItems, E)?.data?.text === R.repeat(6000), '6000 × 😀 als 6000 × U+FFFD gespeichert', itemIn(snapItems, E)?.data?.text?.length)
	r = await rawSync(alice, b, { ops: [patch(E, { 'data.text': '😀'.repeat(6001) })], seq: ++seqN })
	resIs(t, r.data, ['bad'], '6001 × 😀 → bad (Grenze in Zeichen, wie vorher)')
	// byte budget and change log count the stored form
	const a = await stack.byteAccount(b)
	t.check(a && a.bytes === a.sum && a.count === a.live, 'item_bytes = Σ der gespeicherten Bytes, item_count = lebende', a)
	const log = (await stack.changes(b)).filter((c) => c.item_id === E)
	const has4 = (x) => /[\u{10000}-\u{10FFFF}]/u.test(String(x ?? ''))
	t.check(log.length >= 3 && log.every((c) => !has4(c.patch)), 'changes-Log hält nur die gespeicherte Form (kein 4-Byte-Zeichen)', log.map((c) => String(c.patch).slice(0, 60)))
	// guest names are not stored in the database: unchanged
	const g = await guest('Gina 🦊', await link(b, false))
	const gp = await g.sync(b, { client: g.client, since: await revOf(alice, b), pres: 1, me: { c: [1, 1], s: [], d: [], e: null } })
	const rp = await alice.sync(b, { client: alice.client, since: await revOf(alice, b), pres: 1 })
	const ge = Object.values(rp.data?.presence || {}).find((x) => x.g === 1)
	t.check(gp.status === 200 && ge?.n === 'Gina 🦊', 'Gastname (nicht in der DB) bleibt mit 🦊', ge)
}, { skipIf: NO_4BYTE })

// ── SPEC-M1 stage 0 (§8.3): protocol 2, meta channel, board epoch, forward keys ──

/**
 * Link form of SPEC-M1 §4.4 for a fresh edit link without password or expiry.
 * password/expiresAt/expiresOn belong to link passwords and expiry (stage 2):
 * until then they may be absent (SPEC-M1 §0: a key a later stage fills is
 * missing, the client reads it as its default) – present, they must be the
 * defaults false/null.
 */
const plainEditLink = (l, token) => isObj(l) && l.token === token && l.role === 'edit' && typeof l.url === 'string'
	&& l.url.endsWith(`/p/${token}`) && (l.password ?? false) === false && (l.expiresAt ?? null) === null && (l.expiresOn ?? null) === null
	&& Object.keys(l).every((k) => ['token', 'role', 'url', 'password', 'expiresAt', 'expiresOn'].includes(k))

/** board.linkPolicy, if present (stage 2), has the four keys of §4.4. */
const policyShape = (bd) => !('linkPolicy' in bd) || (isObj(bd.linkPolicy)
	&& deepEq(Object.keys(bd.linkPolicy).sort(), ['expireDefaultDays', 'expireEnforced', 'expireMaxDays', 'passwordEnforced']))

await C('C49', 'Protokoll 2 (SPEC-M1 §4.3/§4.4): proto 1 → 409 mit proto 2, auch ohne ep (Reihenfolge); ohne ep → 400; Snapshot v2 mit epoch, now, board.meta/metaRev, board.links, me.mod/me.source', async (t) => {
	const b = await newBoard('C49')
	const L = await link(b)
	await member(bob, L)
	const g = await guest('Gina', L)
	const ep = await stack.epoch()
	t.check(/^[a-z0-9]{6,16}$/.test(ep), 'Vorbedingung: App-Config knorke/epoch gesetzt (InitEpoch)', ep)
	// SyncRequest::fromBody checks proto first, then ep (§4.3 R2)
	let r = await alice.sync(b, { proto: 1, client: alice.client, since: 0 })
	t.check(errIs(r, 409, 'protocol') && r.data?.proto === PROTOCOL, `proto 1 mit ep → 409 protocol, Body proto ${PROTOCOL}`, brief(r))
	r = await alice.sync(b, { proto: 1, client: alice.client, since: 0, ep: undefined })
	t.check(errIs(r, 409, 'protocol') && r.data?.proto === PROTOCOL, 'proto 1 OHNE ep → 409 mit proto (nicht 400)', brief(r))
	r = await alice.sync(b, { client: alice.client, since: 0, ep: undefined })
	t.check(errIs(r, 400, 'bad_request'), `proto ${PROTOCOL} ohne ep → 400 bad_request`, brief(r))
	for (const bad of ['', 'ABC', 'a-b', 'x'.repeat(17), 7, null]) {
		r = await alice.sync(b, { client: alice.client, since: 0, ep: bad })
		t.check(errIs(r, 400, 'bad_request'), `ep ${JSON.stringify(bad)} → 400 bad_request (^[a-z0-9]{1,16}$)`, brief(r))
	}
	r = await g.sync(b, { proto: 1, client: g.client, since: 0, ep: undefined })
	t.check(errIs(r, 409, 'protocol') && r.data?.proto === PROTOCOL, 'Gast: proto 1 ohne ep → 409 mit proto', brief(r))
	r = await g.sync(b, { client: g.client, since: 0, ep: undefined })
	t.check(errIs(r, 400, 'bad_request'), 'Gast: ohne ep → 400', brief(r))

	// owner snapshot
	const t0 = Date.now()
	const s = await snap(alice, b)
	const t1 = Date.now()
	t.check(s.proto === PROTOCOL, `Snapshot proto ${PROTOCOL}`, s.proto)
	t.check(s.epoch === ep, 'Snapshot epoch = App-Config knorke/epoch', { snapshot: s.epoch, appConfig: ep })
	t.check(Number.isInteger(s.now) && s.now >= t0 - 2000 && s.now <= t1 + 2000, 'Snapshot now: Serverzeit in ms (±2 s um die Anfrage)', { now: s.now, t0, t1 })
	t.check(Number.isInteger(s.rev) && s.minRev === 0 && s.schema === 1, 'rev, minRev, schema wie M0', { rev: s.rev, minRev: s.minRev, schema: s.schema })
	const bd = s.board || {}
	t.check(bd.id === b && bd.title === 'C49' && bd.role === 'owner', 'board: id, title, role owner', bd)
	t.check(Number.isInteger(bd.metaRev) && bd.metaRev >= 0 && bd.metaRev <= s.rev, 'board.metaRev: Ganzzahl ≥ 0, ≤ rev', { metaRev: bd.metaRev, rev: s.rev })
	t.check(isObj(bd.meta) && Object.keys(bd.meta).length === 0, 'board.meta = {} (Objekt, leer)', bd.meta)
	t.check(!('link' in bd), 'kein M0-Schlüssel board.link mehr (§4.4)', Object.keys(bd))
	t.check(isObj(bd.links) && deepEq(Object.keys(bd.links).sort(), ['edit', 'vote']) && bd.links.vote === null, 'board.links = {edit, vote: null} für den Besitzer', bd.links)
	t.check(plainEditLink(bd.links?.edit, L), 'links.edit: {token, role edit, url …/p/<token>} – password false, expiresAt/expiresOn null oder (bis Stufe 2) fehlend', bd.links?.edit)
	if (isObj(bd.links?.edit) && !('expiresOn' in bd.links.edit)) t.note('links.edit ohne password/expiresAt/expiresOn (füllt Stufe 2; SPEC-M1 §0: fehlend = Vorgabe)')
	t.check(bd.linksAllowed === true && policyShape(bd), 'linksAllowed (Besitzer); linkPolicy fehlt bis Stufe 2 oder hat die vier Schlüssel', bd)
	const me = s.me || {}
	t.check(me.role === 'owner' && me.guest === false && me.mod === true && me.source === 'own' && /^[0-9a-f]{16}$/.test(me.pid || ''),
		'me: role owner, guest false, mod true, source own', me)

	// link member
	const sb = await snap(bob, b)
	t.check(sb.proto === PROTOCOL && sb.epoch === ep && Number.isInteger(sb.now), 'Mitglied: proto, epoch, now', { proto: sb.proto, epoch: sb.epoch, now: sb.now })
	t.check(sb.me?.role === 'edit' && sb.me?.mod === false && sb.me?.source === 'link' && sb.me?.guest === false, 'Mitglied über den Link: me.role edit, mod false, source link', sb.me)
	t.check(isObj(sb.board) && !('links' in sb.board) && !('linksAllowed' in sb.board) && !('linkPolicy' in sb.board) && !('link' in sb.board),
		'Mitglied: weder links noch linksAllowed noch linkPolicy', sb.board)
	t.check(Number.isInteger(sb.board?.metaRev) && isObj(sb.board?.meta), 'Mitglied: meta und metaRev (betrachterunabhängig)', sb.board)

	// guest: join answer and snapshot
	const j = g.joinAnswer || {}
	t.check(j.proto === PROTOCOL && j.epoch === ep && Number.isInteger(j.now) && isObj(j.guest) && typeof j.guest.token === 'string' && Number.isInteger(j.guest.exp),
		'Gast-Beitritt: Snapshot-Form v2 plus guest {token, exp}', { proto: j.proto, epoch: j.epoch, now: j.now, guest: j.guest && Object.keys(j.guest) })
	t.check(j.me?.source === 'guest' && j.me?.mod === false && j.me?.guest === true, 'Gast-Beitritt: me.source guest, mod false', j.me)
	const gs = await g.snapshot(b)
	t.check(gs.status === 200 && gs.data?.proto === PROTOCOL && gs.data?.epoch === ep, 'Gast-Snapshot: proto, epoch', brief(gs).slice(0, 120))
	const gm = gs.data?.me
	t.check(gm?.guest === true && gm?.mod === false && gm?.source === 'guest' && gm?.role === 'edit', 'Gast: me.guest, role edit, mod false, source guest', gm)
	t.check(isObj(gs.data?.board) && !('links' in gs.data.board) && !('linksAllowed' in gs.data.board) && isObj(gs.data.board.meta), 'Gast: ohne links/linksAllowed, mit meta', gs.data?.board)

	// a regular sync with the snapshot's epoch
	r = await alice.sync(b, { client: alice.client, since: s.rev, pres: 0 })
	t.check(r.status === 200 && !r.data?.resync && Number.isInteger(r.data?.now), 'Sync mit der Snapshot-Epoche → 200, kein resync, now', brief(r))
})

await C('C50', 'Meta-Kanal (SPEC-M1 §4.13.4/§4.13.8): Umbenennen → meta_rev = rev, keine changes-Zeile, Antwort mit metaRev und meta (R4); altes since bekommt board mit neuem Titel, since = rev nicht; 20 leere Syncs ohne board; Snapshot mit Titel und metaRev', async (t) => {
	const b = await newBoard('C50')
	const L = await link(b)
	await member(bob, L)
	const g = await guest('Gina', L)
	await ops(alice, b, [sticky(ulid())])
	const row0 = await stack.sqlRow(`SELECT rev, meta_rev, title FROM oc_knorke_boards WHERE id = ${b};`)
	const since0 = Number(row0[0])
	const ch0 = await stack.changeCount(b)
	const TITLE = 'C50 umbenannt'
	const rn = await alice.renameBoard(b, TITLE)
	t.check(rn.status === 200 && rn.data?.board?.title === TITLE, 'Umbenennen → 200 mit neuem Titel', brief(rn))
	const row1 = await stack.sqlRow(`SELECT rev, meta_rev, title FROM oc_knorke_boards WHERE id = ${b};`)
	const rev1 = Number(row1[0])
	const meta1 = Number(row1[1])
	t.check(rev1 === since0 + 1 && meta1 === rev1 && row1[2] === TITLE, 'SQL: rev + 1, meta_rev = rev, Titel gespeichert', { vorher: row0, nachher: row1 })
	const ch1 = await stack.changeCount(b)
	t.check(ch1 === ch0, 'keine changes-Zeile für die Meta-Änderung', { ch0, ch1 })
	// SPEC-M1 §15 (R4, WP-B0 Phase 2) and §6.5.1: the rename answer carries metaRev and
	// meta from MetaService::write, so the own rename takes the onMeta path (the client
	// reads them from `board`, src/api/boards.js renameBoard); empty meta is {} on the wire
	const meta0 = Number(row0[1])
	const ab = rn.data?.board
	t.check(isObj(ab) && ab.metaRev === rev1 && ab.metaRev === meta1 && ab.metaRev > meta0,
		`Antwort des Umbenennens: board.metaRev = rev nach dem Umbenennen (${rev1}, SQL meta_rev ${meta1}) > voriger metaRev ${meta0} (R4)`, { metaRev: ab?.metaRev, rev1, meta1, meta0 })
	t.check(isObj(ab?.meta) && Object.keys(ab.meta).length === 0, 'Antwort des Umbenennens: board.meta = {} (leere Meta-Map auf dem Draht, R4)', ab?.meta)

	// old cursors (account, link member, guest) get board with exactly the new title
	for (const c of [alice, bob, g]) {
		const r = await c.sync(b, { client: c.client, since: since0, pres: 0 })
		const bd = r.data?.board
		t.check(r.status === 200 && r.data?.rev === rev1 && isObj(bd), `${c.name}: altes since → board`, brief(r))
		t.check(bd?.title === TITLE && bd?.metaRev === meta1 && isObj(bd?.meta), `${c.name}: board = {title: „${TITLE}“, meta, metaRev ${meta1}}`, bd)
		t.check(!r.data?.items && !r.data?.removed, `${c.name}: keine items (nur Meta geändert)`, r.data?.items)
	}
	// a cursor at rev: no board
	let r = await alice.sync(b, { client: alice.client, since: rev1, pres: 0 })
	t.check(r.status === 200 && !('board' in (r.data || {})), 'since = rev → kein board', brief(r))
	// 20 empty syncs afterwards: no board
	let withBoard = 0
	let bad = 0
	for (let i = 0; i < 20; i++) {
		const c = [alice, bob, g][i % 3]
		const x = await c.sync(b, { client: c.client, since: rev1, pres: i % 2 })
		if (x.status !== 200 || x.data?.rev !== rev1) bad++
		if (x.data && 'board' in x.data) withBoard++
	}
	t.check(bad === 0 && withBoard === 0, '20 leere Syncs danach: 200, rev unverändert, nie board', { bad, withBoard })
	// snapshot
	const s = await snap(bob, b)
	t.check(s.board?.title === TITLE && s.board?.metaRev === meta1 && s.rev === rev1, 'Snapshot trägt Titel und metaRev', { title: s.board?.title, metaRev: s.board?.metaRev, rev: s.rev })
	// a second rename: one more rev, the cursor of the first rename sees it again
	const rn2 = await alice.renameBoard(b, TITLE + ' 2')
	r = await bob.sync(b, { client: bob.client, since: rev1, pres: 0 })
	t.check(rn2.status === 200 && r.data?.rev === rev1 + 1 && r.data?.board?.title === TITLE + ' 2' && r.data?.board?.metaRev === rev1 + 1, 'zweites Umbenennen: board mit Titel 2, metaRev = rev', brief(r))
	const ab2 = rn2.data?.board
	t.check(ab2?.title === TITLE + ' 2' && ab2?.metaRev === rev1 + 1 && ab2.metaRev > meta1 && isObj(ab2?.meta),
		`Antwort des zweiten Umbenennens: board.metaRev = ${rev1 + 1} > ${meta1} (voriger metaRev), meta (R4)`, { title: ab2?.title, metaRev: ab2?.metaRev, meta: ab2?.meta })
	// an item write afterwards does not resend board to a cursor past meta_rev
	const d = await ops(alice, b, [sticky(ulid())])
	r = await bob.sync(b, { client: bob.client, since: rev1 + 1, pres: 0 })
	t.check(r.status === 200 && r.data?.rev === d.rev && (r.data?.items || []).length === 1 && !('board' in r.data), 'Objekt-Änderung nach meta_rev: items, aber kein board', brief(r))
})

/** {key: ttl} of the given Redis keys (TTL: -2 gone, -1 no TTL). */
async function ttlsOf(keys) {
	const out = {}
	for (const k of keys) out[k] = Number(await stack.redis('TTL', k))
	return out
}

/** Board keys of one board under one epoch (r:, a:, p:, g:…). */
async function boardKeysIn(epoch, b) {
	const keys = []
	for (const k of [`r:${b}`, `a:${b}`, `p:${b}`, `g:${b}:*`]) keys.push(...await stack.redisScan(rkeyIn(epoch, k)))
	return keys.sort()
}

await C('C51', 'Board-Epoche (SPEC-M1 §5.4): falsches ep → resync, Ops wirken; nach knorke:epoch:rotate (≥ 4 s) resynct jeder Client mit altem ep genau einmal; neue Schlüssel nur unter dem neuen Präfix, alte nicht erneuert (TTL fällt)', async (t) => {
	const b = await newBoard('C51')
	const L = await link(b)
	await member(bob, L)
	const g = await guest('Gina', L)
	const ep0 = await stack.epoch()
	if (!t.check(/^[a-z0-9]{6,16}$/.test(ep0), 'Vorbedingung: Epoche gesetzt', ep0)) return
	// (a) a wrong ep: resync, the ops of the request still apply
	const X = ulid()
	const wrong = ep0 === 'zzzzzzzz' ? 'yyyyyyyy' : 'zzzzzzzz'
	let r = await rawSync(alice, b, { ep: wrong, seq: ++seqN, ops: [sticky(X, { data: { text: 'trotz falscher Epoche' } })] })
	t.check(r.status === 200 && r.data?.resync === true, 'falsches ep → 200 mit resync: true', brief(r))
	t.check(deepEq(r.data?.acks?.res, ['ok']), 'Ops der Anfrage trotzdem angewendet (acks ok)', r.data?.acks)
	t.check(itemIn(await snap(alice, b), X)?.data?.text === 'trotz falscher Epoche', 'Objekt im Snapshot')

	// warm r:, a:, g:, p: under the current epoch
	const clients = [alice, bob, g]
	const me = { c: [1, 1], s: [], d: [], e: null }
	const rev0 = await revOf(alice, b)
	for (const c of clients) await c.sync(b, { client: c.client, since: rev0, pres: 1, me })
	const old0 = await boardKeysIn(ep0, b)
	t.check(old0.some((k) => k.endsWith(`/r:${b}`)) && old0.some((k) => k.endsWith(`/a:${b}`)), 'vorher: r: und a: unter der alten Epoche', old0)

	// (b) rotate, then wait for Nextcloud's local app-config cache (APCu, 3 s)
	const rot = await stack.rotateEpoch()
	const ep1 = rot.after
	t.check(rot.before === ep0 && /^[a-z0-9]{6,16}$/.test(ep1) && ep1 !== ep0, 'occ knorke:epoch:rotate setzt eine neue Epoche', { before: rot.before, after: ep1, out: rot.out.slice(0, 120) })
	t.note(`Epoche ${ep0} → ${ep1}`)
	await sleep(APPCONFIG_SETTLE_MS)
	env.epoch = ep1
	const rev1 = (await stack.boardRow(b)).rev
	for (const c of clients) {
		c.epoch = ep0 // the open tab still holds the old epoch
		const first = await c.sync(b, { client: c.client, since: rev1, pres: 0 })
		t.check(first.status === 200 && first.data?.resync === true, `${c.name}: altes ep → resync`, brief(first))
		const sn = await c.snapshot(b)
		t.check(sn.status === 200 && sn.data?.epoch === ep1 && c.epoch === ep1, `${c.name}: Snapshot liefert die neue Epoche`, { status: sn.status, epoch: sn.data?.epoch })
		const second = await c.sync(b, { client: c.client, since: sn.data?.rev, pres: 0 })
		const third = await c.sync(b, { client: c.client, since: sn.data?.rev, pres: 0 })
		t.check(second.status === 200 && !second.data?.resync && third.status === 200 && !third.data?.resync, `${c.name}: danach kein resync mehr (genau einmal)`, [brief(second), brief(third)])
	}

	// (c) new writes land under the new prefix only; old keys are not renewed
	const Y = ulid()
	const d = await ops(alice, b, [sticky(Y)])
	for (const c of clients) await c.sync(b, { client: c.client, since: d.rev, pres: 1, me })
	const new1 = await boardKeysIn(ep1, b)
	t.check(['r', 'a', 'p'].every((k) => new1.some((x) => x.endsWith(`/${k}:${b}`))), 'neue Schreibvorgänge: r:, a:, p: unter der neuen Epoche', new1)
	t.check(new1.some((x) => x.includes(`/g:${b}:`)), 'Grants g: unter der neuen Epoche (volle Prüfung je Konto)', new1)
	const all = []
	for (const k of [`r:${b}`, `a:${b}`, `p:${b}`, `g:${b}:*`]) all.push(...await stack.redisScan(rkey(k)))
	const foreign = all.filter((k) => ![ep0, ep1].includes(epochOfKey(k)))
	t.check(foreign.length === 0, 'keine Board-Schlüssel unter einer dritten Epoche', foreign)
	const old1 = await boardKeysIn(ep0, b)
	t.check(old1.every((k) => old0.includes(k)), 'unter der alten Epoche kein neuer Schlüssel', { vorher: old0, nachher: old1 })
	const ttl1 = await ttlsOf(old1)
	const tA = Date.now()
	// more writes and presence while the 5 s run
	for (let i = 0; i < 4; i++) {
		const di = await ops(alice, b, [sticky(ulid())])
		for (const c of clients) await c.sync(b, { client: c.client, since: di.rev, pres: 1, me: { ...me, c: [i, i] } })
		await sleep(400)
	}
	await sleep(Math.max(0, 5000 - (Date.now() - tA)))
	const ttl2 = await ttlsOf(old1)
	const renewed = Object.keys(ttl1).filter((k) => ttl2[k] !== -2 && !(ttl2[k] > 0 && ttl2[k] <= ttl1[k] - 4 && ttl1[k] <= 300))
	t.check(renewed.length === 0, 'alte Schlüssel: TTL fällt (zweimal gemessen, 5 s Abstand), kein -1, ≤ 300 s – oder schon verfallen', Object.fromEntries(Object.keys(ttl1).map((k) => [k.slice(k.indexOf('/knorke/')), [ttl1[k], ttl2[k]]])))
	t.note(`alte Schlüssel ${old1.length}, neue ${new1.length}; TTL ${Object.keys(ttl1).map((k) => `${k.slice(k.lastIndexOf('/') + 1)} ${ttl1[k]}→${ttl2[k]}`).join(', ')}`)
})

await C('C52', 'Vorwärts-Schlüssel und now (SPEC-M1 §4.5): role, vt, me.v angenommen (kein 400), unbekannte role → 400 (R3); now ±2 s um die Host-Uhr, monoton über 5 Antworten', async (t) => {
	const b = await newBoard('C52')
	const L = await link(b)
	const g = await guest('Gina', L)
	const rev = await revOf(alice, b)
	let r = await alice.sync(b, { client: alice.client, since: rev, pres: 1, role: 'owner', vt: 0, me: { c: [1, 2], s: [], d: [], e: null, v: [-200, -150, 1600, 900] } })
	t.check(r.status === 200, 'role owner, vt 0, me.v → 200', brief(r))
	for (const role of ['owner', 'moderate', 'edit', 'vote', 'view', null]) {
		r = await alice.sync(b, { client: alice.client, since: rev, pres: 0, role })
		t.check(r.status === 200, `role ${JSON.stringify(role)} → 200 (angenommen)`, brief(r))
	}
	r = await alice.sync(b, { client: alice.client, since: rev, pres: 0, role: 'admin' })
	t.check(errIs(r, 400, 'bad_request'), 'unbekannte role → 400 bad_request (SPEC-M1 §14)', brief(r))
	r = await alice.sync(b, { client: alice.client, since: rev, pres: 0, vt: 31 })
	t.check(r.status === 200, 'vt 31 → 200', brief(r))
	r = await alice.sync(b, { client: alice.client, since: rev, pres: 1, me: { c: [1, 2], s: [], d: [], e: null, v: [0, 0, 0, 10] } })
	t.check(r.status === 200, 'ungültiges me.v (w = 0) → kein 400', brief(r))
	r = await g.sync(b, { client: g.client, since: rev, pres: 1, role: 'edit', vt: 5, me: { c: [3, 4], s: [], d: [], e: null, v: [0, 0, 10, 10] } })
	t.check(r.status === 200, 'Gast mit role, vt, me.v → 200', brief(r))
	const seen = []
	for (let i = 0; i < 5; i++) {
		const c = i % 2 ? g : alice
		const t0 = Date.now()
		const x = await c.sync(b, { client: c.client, since: rev, pres: 0 })
		const t1 = Date.now()
		seen.push({ status: x.status, now: x.data?.now, mid: Math.round((t0 + t1) / 2), half: Math.ceil((t1 - t0) / 2) })
		await sleep(25)
	}
	t.check(seen.every((x) => x.status === 200 && Number.isInteger(x.now)), 'now in jeder Antwort (ganze ms)', seen)
	t.check(seen.every((x) => Math.abs(x.now - x.mid) <= 2000 + x.half), 'now ±2 s um die Host-Uhr', seen.map((x) => x.now - x.mid))
	t.check(seen.every((x, i) => i === 0 || x.now > seen[i - 1].now), 'now steigt monoton über 5 Antworten', seen.map((x) => x.now))
	t.note(`Abstand now − Host-Uhr: ${seen.map((x) => x.now - x.mid).join(', ')} ms`)
})

// ── SPEC-M1 stage 1 (§8.3): shapes, text, connectors (server complete in 1a), keep, M0 compatibility ──

/** Types an end may bind to (§4.8 bindable: sticky, shape, text). */
const BINDABLE = ['sticky', 'shape', 'text']
const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight']

/** put of a shape with the creation defaults of §6.2 (TYPES.shape.defaults). */
function shape(id, p = {}) {
	return { o: 'put', id, t: 'shape', p: { x: 0, y: 0, w: 200, h: 120, r: 0, z: nextZ(), parent: null, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }, ...p } }
}
/** put of a text item (§3.10: w = wrap width, h measured by the writer). */
function textItem(id, p = {}) {
	return { o: 'put', id, t: 'text', p: { x: 0, y: 0, w: 240, h: 31.2, r: 0, z: nextZ(), parent: null, data: { text: '' }, style: { fontSize: 24, color: '#1a1a1a', align: 'left' }, ...p } }
}
/** put of a connector (§3.10: placement none, x = y = w = h = r = 0, parent null). */
function connector(id, start, end, p = {}) {
	const data = { route: 'straight' }
	if (start !== undefined) data.start = start
	if (end !== undefined) data.end = end
	return { o: 'put', id, t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, z: nextZ(), parent: null, data, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: 'arrow' }, ...p } }
}
/** patch with the op-level marker keep (§4.6, §4.7 rule 15). */
const keepPatch = (id, p, keep = true) => ({ o: 'patch', id, p, keep })

/** The frozen golden file of §9.2 (anchor points of rule 14). */
const CONNECTOR_GOLDEN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'connector-golden.json'), 'utf8')).cases

/** Change rows of one rev, counted per item: {id: [rows]}. */
async function rowsAt(b, rev) {
	const per = {}
	for (const r of (await stack.changes(b)).filter((x) => x.rev === rev)) (per[r.item_id] ||= []).push(r)
	return per
}
const patchOf = (row) => {
	try { return typeof row?.patch === 'string' ? JSON.parse(row.patch) : row?.patch ?? null } catch { return null }
}

await C('C53', 'Formen (SPEC-M1 §3.10, §4.8): put je kind ok; kind star, fillOpacity 101, strokeWidth 25, dash wavy, w 9 → bad; r 45 ok; Frame als Elternteil ok; Enums streng (R8), Farben klein, patch nach denselben Regeln', async (t) => {
	const b = await newBoard('C53')
	const F = ulid()
	await ops(alice, b, [frame(F, { x: 1000, y: 1000 })])
	const ids = SHAPE_KINDS.map(() => ulid())
	resIs(t, await ops(alice, b, SHAPE_KINDS.map((kind, i) => shape(ids[i], { x: i * 250, data: { kind, text: kind } }))), SHAPE_KINDS.map(() => 'ok'), `put je kind (${SHAPE_KINDS.join(', ')})`)
	const FULL = ulid()
	const R45 = ulid()
	const CHILD = ulid()
	const NOKIND = ulid()
	resIs(t, await ops(alice, b, [
		shape(FULL, { x: 0, y: 400, data: { kind: 'roundRect', text: 'Idee' }, style: { fill: '#FFFFFF', fillOpacity: 40, stroke: '#1A1A1A', strokeWidth: 0, dash: 'dashed', textColor: '#AbCdEf', fontSize: 24, align: 'right', valign: 'bottom' } }),
		shape(R45, { x: 400, y: 400, r: 45 }),
		shape(CHILD, { x: 20, y: 30, parent: F }),
		shape(NOKIND, { x: 800, y: 400, data: { text: 'ohne kind' } }),
	]), ['ok', 'ok', 'ok', 'ok'], 'alle Stil-Felder; r 45; Frame als Elternteil; ohne data.kind (fehlt = rect, §3.10)')
	const bads = [
		['kind star', { data: { kind: 'star' } }],
		['kind true (Enum streng, R8)', { data: { kind: true } }],
		['kind ["rect"]', { data: { kind: ['rect'] } }],
		['kind Rect (Groß-/Kleinschreibung)', { data: { kind: 'Rect' } }],
		['fillOpacity 101', { style: { fillOpacity: 101 } }],
		['fillOpacity -1', { style: { fillOpacity: -1 } }],
		['fillOpacity 50.5 (int)', { style: { fillOpacity: 50.5 } }],
		['strokeWidth 25', { style: { strokeWidth: 25 } }],
		['dash wavy', { style: { dash: 'wavy' } }],
		['align justify', { style: { align: 'justify' } }],
		['valign center', { style: { valign: 'center' } }],
		['fontSize 7', { style: { fontSize: 7 } }],
		['fontSize 201', { style: { fontSize: 201 } }],
		['stroke red', { style: { stroke: 'red' } }],
		['textColor #fff', { style: { textColor: '#fff' } }],
		['w 9', { w: 9 }],
		['h 9', { h: 9 }],
		['w 20001', { w: 20001 }],
	]
	const d = await ops(alice, b, bads.map(([, p]) => {
		const op = shape(ulid(), {})
		op.p = { ...op.p, ...p, data: { ...op.p.data, ...(p.data || {}) }, style: { ...op.p.style, ...(p.style || {}) } }
		return op
	}))
	for (let i = 0; i < bads.length; i++) t.check(d.acks.res[i] === 'bad', `put ${bads[i][0]} → bad`, d.acks.res[i])
	const S = ulid()
	resIs(t, await ops(alice, b, [shape(S), shape(ulid(), { parent: S })]), ['ok', 'bad'], 'Form ist kein Container: Form in Form → bad')
	const s = await snap(alice, b)
	t.check(SHAPE_KINDS.every((kind, i) => itemIn(s, ids[i])?.t === 'shape' && itemIn(s, ids[i])?.data?.kind === kind), 'je kind gespeichert (t shape, data.kind)', ids.map((id) => itemIn(s, id)?.data?.kind))
	const full = itemIn(s, FULL)
	t.check(deepEq(full?.style, { fill: '#ffffff', fillOpacity: 40, stroke: '#1a1a1a', strokeWidth: 0, dash: 'dashed', textColor: '#abcdef', fontSize: 24, align: 'right', valign: 'bottom' }), 'Stil gespeichert, Farben klein, strokeWidth 0 bleibt (kein Rand)', full?.style)
	t.check(itemIn(s, R45)?.r === 45, 'r 45 gespeichert', itemIn(s, R45)?.r)
	const ch = itemIn(s, CHILD)
	t.check(ch?.parent === F && ch?.x === 20 && ch?.y === 30, 'Kind von F bei (20, 30) relativ', ch)
	t.check(itemIn(s, NOKIND) && !('kind' in (itemIn(s, NOKIND).data || {})), 'ohne data.kind gespeichert (kein Feld erfunden)', itemIn(s, NOKIND)?.data)
	// patch follows the same rules (rule 18: unknown enum values → bad on patch too)
	const P = ids[0]
	const pd = await ops(alice, b, [
		patch(P, { 'data.kind': 'ellipse' }), patch(P, { 'data.kind': 'star' }), patch(P, { 'style.fillOpacity': 101 }),
		patch(P, { 'style.stroke': '#00FF00' }), patch(P, { w: 9 }), patch(P, { r: 30 }), patch(P, { 'style.dash': 'dotted' }), patch(P, { 'style.valign': 'top' }),
	])
	resIs(t, pd, ['ok', 'bad', 'bad', 'ok', 'bad', 'ok', 'ok', 'ok'], 'patch: kind ellipse ok, star bad, fillOpacity 101 bad, stroke ok, w 9 bad, r 30 ok, dash dotted ok, valign top ok')
	const p2 = itemIn(await snap(alice, b), P)
	t.check(p2?.data?.kind === 'ellipse' && p2?.style?.stroke === '#00ff00' && p2?.r === 30 && p2?.w === 200 && p2?.style?.dash === 'dotted', 'patch-Ergebnis: ellipse, #00ff00, r 30, w unverändert 200', p2)
})

await C('C54', 'Text-Objekt (SPEC-M1 §3.10, §4.7 Regel 13): fontSize 400 ok, 401 bad; patch {data.text, h} gemeinsam ok; Text-Lease greift auf data.text (wie C36), Schrift/Breite mit h bleiben frei', async (t) => {
	const b = await newBoard('C54')
	await member(bob, await link(b))
	const T = ulid()
	const T2 = ulid()
	resIs(t, await ops(alice, b, [textItem(T, { data: { text: 'Überschrift' }, style: { fontSize: 400, color: '#1A1A1A', align: 'center' }, w: 600, h: 520, r: 15 }), textItem(T2)]), ['ok', 'ok'], 'put fontSize 400 (Obergrenze), r 15; put mit Vorgaben')
	const bads = [['fontSize 401', { style: { fontSize: 401 } }], ['fontSize 7', { style: { fontSize: 7 } }], ['color blue', { style: { color: 'blue' } }],
		['align justify', { style: { align: 'justify' } }], ['w 3', { w: 3 }], ['h 50001', { h: 50001 }], ['text 6001', { data: { text: 'x'.repeat(6001) } }]]
	const d = await ops(alice, b, bads.map(([, p]) => {
		const op = textItem(ulid())
		op.p = { ...op.p, ...p, data: { ...op.p.data, ...(p.data || {}) }, style: { ...op.p.style, ...(p.style || {}) } }
		return op
	}))
	for (let i = 0; i < bads.length; i++) t.check(d.acks.res[i] === 'bad', `put ${bads[i][0]} → bad`, d.acks.res[i])
	let s = await snap(alice, b)
	t.check(itemIn(s, T)?.style?.fontSize === 400 && itemIn(s, T)?.style?.color === '#1a1a1a' && itemIn(s, T)?.r === 15, 'gespeichert: fontSize 400, Farbe klein, r 15', itemIn(s, T))
	resIs(t, await ops(alice, b, [patch(T2, { 'data.text': 'Zeile 1\nZeile 2\nZeile 3', h: 93.6 })]), ['ok'], 'patch {data.text, h} gemeinsam → ok')
	s = await snap(alice, b)
	t.check(itemIn(s, T2)?.data?.text === 'Zeile 1\nZeile 2\nZeile 3' && itemIn(s, T2)?.h === 93.6, 'Text und gemessenes h gespeichert (der Server rechnet h nie)', itemIn(s, T2))
	// text lease on data.text, like C36: alice holds it
	const a1 = clientId()
	const b1 = clientId()
	const since = await revOf(alice, b)
	const r = await alice.sync(b, { client: a1, since, pres: 1, me: { c: null, s: [T2], d: [], e: T2 } })
	t.check(r.status === 200, 'alice hält die Lease (me.e = T2)', brief(r))
	resIs(t, await ops(bob, b, [patch(T2, { 'data.text': 'bob', h: 31.2 })], { client: b1, since }), ['locked'], 'bob {data.text, h} → locked')
	resIs(t, await ops(bob, b, [patch(T2, { 'style.fontSize': 48, h: 187.2 })], { client: b1, since }), ['ok'], 'bob {style.fontSize, h} → ok (LWW, trägt sein h mit)')
	resIs(t, await ops(bob, b, [patch(T2, { w: 120, h: 249.6 })], { client: b1, since }), ['ok'], 'bob {w, h} → ok')
	resIs(t, await ops(alice, b, [patch(T2, { 'data.text': 'alice', h: 62.4 })], { client: a1, since, pres: 1, me: { c: null, s: [T2], d: [], e: T2 } }), ['ok'], 'Halterin alice {data.text, h} → ok')
	const it = itemIn(await snap(alice, b), T2)
	t.check(it?.data?.text === 'alice' && it?.style?.fontSize === 48 && it?.w === 120 && it?.h === 62.4, 'Endstand: Text der Halterin, Schrift und Breite von bob, h vom letzten Schreiber', it)
	// shapes have their text under the lease as well (textPath data.text)
	const S = ulid()
	await ops(alice, b, [shape(S, { data: { kind: 'rect', text: 'Form' } })])
	const since2 = await revOf(alice, b)
	await alice.sync(b, { client: a1, since: since2, pres: 1, me: { c: null, s: [S], d: [], e: S } })
	resIs(t, await ops(bob, b, [patch(S, { 'data.text': 'bob' }), patch(S, { 'style.fill': '#112233' })], { client: b1, since: since2 }), ['locked', 'ok'], 'Form: data.text unter Lease → locked, Füllung frei')
})

await C('C55', 'Verbinder anlegen (SPEC-M1 §3.10, §4.7 Regeln 12/14/19): gültige Enden ok; ohne data.end, x 5, patch {x,y,parent} → bad; Ende an Frame/Verbinder/sich selbst/nie existierend → bad; an Grabstein → ok, freier Punkt = Ankerpunkt (connector-golden.json); start_item/end_item = data.*.item', async (t) => {
	const b = await newBoard('C55')
	const [A, B2, F, K0] = [ulid(), ulid(), ulid(), ulid()]
	await ops(alice, b, [shape(A, { x: 100, y: 40 }), textItem(B2, { x: 600, y: 40 }), frame(F, { x: -2000, y: -2000 }), connector(K0, { item: A }, { item: B2 })])
	const [K1, K2, K3, K4] = [ulid(), ulid(), ulid(), ulid()]
	resIs(t, await ops(alice, b, [
		connector(K1, { item: A }, { item: B2, ax: 0, ay: 0.5 }),
		connector(K2, { x: 1234.5, y: -80 }, { item: A, ax: 0.123456, ay: 0.987654 }),
		connector(K3, { ay: 0.25, ax: 0.75, item: A }, { y: 2, x: 1 }, { data: { start: { ay: 0.25, ax: 0.75, item: A }, end: { y: 2, x: 1 }, route: 'elbow', label: 'ja' }, style: { stroke: '#00FF00', strokeWidth: 1, dash: 'dotted', startCap: 'dot', endCap: 'diamond' } }),
		connector(K4, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: undefined, y: undefined, w: undefined, h: undefined, r: undefined, parent: undefined }),
	]), ['ok', 'ok', 'ok', 'ok'], 'Enden {item}, {item, ax, ay}, {x, y}; Route/Spitzen/Beschriftung; put ohne Lagefelder (Vorgabe 0/null)')
	const s = await snap(alice, b)
	const k2 = itemIn(s, K2)
	t.check(JSON.stringify(k2?.data?.end) === JSON.stringify({ item: A, ax: 0.1235, ay: 0.9877 }), 'ax/ay normalisiert mit q(v, 10000), Schlüsselreihenfolge item, ax, ay', k2?.data?.end)
	t.check(JSON.stringify(k2?.data?.start) === JSON.stringify({ x: 1234.5, y: -80 }), 'freies Ende wie gesendet', k2?.data?.start)
	const k3 = itemIn(s, K3)
	t.check(JSON.stringify(k3?.data?.start) === JSON.stringify({ item: A, ax: 0.75, ay: 0.25 }) && JSON.stringify(k3?.data?.end) === JSON.stringify({ x: 1, y: 2 }), 'gespeicherte Reihenfolge item, ax, ay bzw. x, y (§3.10 R8)', k3?.data)
	t.check(k3?.data?.route === 'elbow' && k3?.data?.label === 'ja' && deepEq(k3?.style, { stroke: '#00ff00', strokeWidth: 1, dash: 'dotted', startCap: 'dot', endCap: 'diamond' }), 'Route, Beschriftung, Stil (Farbe klein)', k3)
	t.check([K1, K2, K3, K4].every((k) => { const i = itemIn(s, k); return i && i.x === 0 && i.y === 0 && i.w === 0 && i.h === 0 && i.r === 0 && i.parent === null }), 'Lage immer 0, parent null (Regel 12)')

	const bad = [
		['ohne data.end', connector(ulid(), { item: A }, undefined)],
		['ohne data.start', connector(ulid(), undefined, { item: A })],
		['x 5', connector(ulid(), { item: A }, { item: B2 }, { x: 5 })],
		['w 10', connector(ulid(), { item: A }, { item: B2 }, { w: 10 })],
		['r 30', connector(ulid(), { item: A }, { item: B2 }, { r: 30 })],
		['parent F', connector(ulid(), { item: A }, { item: B2 }, { parent: F })],
		['Ende an Frame', connector(ulid(), { item: A }, { item: F })],
		['Ende an Verbinder', connector(ulid(), { item: K0 }, { item: A })],
		['Ende an nie existierendes Objekt', connector(ulid(), { item: A }, { item: ulid() })],
		['ax 1.00004 (vor q geprüft, R8)', connector(ulid(), { item: A, ax: 1.00004, ay: 0.5 }, { item: B2 })],
		['item keine ULID', connector(ulid(), { item: 'not-a-ulid' }, { item: B2 })],
		['route bezier', connector(ulid(), { item: A }, { item: B2 }, { data: { start: { item: A }, end: { item: B2 }, route: 'bezier' } })],
		['label 201 Zeichen', connector(ulid(), { item: A }, { item: B2 }, { data: { start: { item: A }, end: { item: B2 }, label: 'x'.repeat(201) } })],
		['strokeWidth 0', connector(ulid(), { item: A }, { item: B2 }, { style: { strokeWidth: 0 } })],
	]
	const SELF = ulid()
	bad.push(['Ende an sich selbst', connector(SELF, { item: SELF }, { item: A })])
	const d = await ops(alice, b, bad.map(([, op]) => op))
	for (let i = 0; i < bad.length; i++) t.check(d.acks.res[i] === 'bad', `${bad[i][0]} → bad`, d.acks.res[i])
	const pd = await ops(alice, b, [patch(K1, { x: 5, y: 5, parent: null }), patch(K1, { w: 3 }), patch(K1, { r: 10 }), patch(K1, { 'data.start': null }), patch(K1, { 'data.end': {} }), patch(K1, { 'data.route': 'curved', 'data.label': 'neu' })])
	resIs(t, pd, ['bad', 'bad', 'bad', 'bad', 'bad', 'ok'], 'patch {x,y,parent}, {w}, {r} → bad (Regel 12); data.start null, data.end {} → bad (Regel 19); Route/Beschriftung ok')

	// end on a tombstone: ok, the end becomes the anchor point of the removed item (golden)
	const cases = CONNECTOR_GOLDEN.filter((c) => c.box.w >= 10 && c.box.h >= 10 && c.box.w <= 20000 && c.box.h <= 20000)
	const setup = []
	const plan = cases.map((c) => {
		const target = ulid()
		const parent = c.parent ? ulid() : null
		if (parent) setup.push(frame(parent, { x: c.parent.x, y: c.parent.y }))
		setup.push(shape(target, { x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h, r: c.box.r, parent }))
		return { c, target, conn: ulid() }
	})
	for (let i = 0; i < setup.length; i += 150) await ops(alice, b, setup.slice(i, i + 150))
	resIs(t, await ops(alice, b, plan.map((p) => remove(p.target))), plan.map(() => 'ok'), `${plan.length} Ziele entfernt (Grabsteine)`)
	const ends = plan.map((p) => connector(p.conn, { ...p.c.ep, item: p.target }, { x: 0, y: 0 }))
	resIs(t, await ops(alice, b, ends), plan.map(() => 'ok'), `${plan.length} Verbinder mit einem Ende an einem Grabstein → ok`)
	const s2 = await snap(alice, b)
	let exact = 0
	let rotated = 0
	for (const p of plan) {
		const got = itemIn(s2, p.conn)?.data?.start
		const want = { x: p.c.expect[0], y: p.c.expect[1] }
		const rot = Number(p.c.box.r) !== 0 && 'ax' in p.c.ep
		if (rot) rotated++
		else exact++
		t.check(endsEqual(got, want, rot), `Grabstein „${p.c.name}“: Ende = ${JSON.stringify(want)} ${rot ? '(±0,01)' : '(exakt)'}`, got)
	}
	t.note(`${plan.length} Golden-Fälle an Grabsteinen (${exact} exakt, ${rotated} gedreht ±0,01); ausgelassen ${CONNECTOR_GOLDEN.length - plan.length} (Box < 10, keine Form möglich)`)
	// tombstone of a non-bindable type stays bad
	const FG = ulid()
	await ops(alice, b, [frame(FG, { x: 5000 })])
	await ops(alice, b, [remove(FG)])
	resIs(t, await ops(alice, b, [connector(ulid(), { item: FG }, { x: 0, y: 0 })]), ['bad'], 'Ende an einem Frame-Grabstein → bad (nicht bindbar)')

	// derived columns
	const rows = await stack.sql(`SELECT id, start_item, end_item FROM oc_knorke_items WHERE board_id = ${b} AND type = 'connector' AND deleted = 0;`)
	const s3 = await snap(alice, b)
	const wrong = rows.filter(([id, st, en]) => {
		const it = itemIn(s3, id)
		return !it || (it.data?.start?.item ?? null) !== st || (it.data?.end?.item ?? null) !== en
	})
	t.check(rows.length === 5 + plan.length && wrong.length === 0, `SQL: start_item/end_item = data.start/end.item (${rows.length} Verbinder; freie Enden NULL)`, wrong.slice(0, 3))
	const k1row = rows.find(([id]) => id === K1)
	t.check(k1row && k1row[1] === A && k1row[2] === B2, 'K1: start_item A, end_item B', k1row)
	const k4row = rows.find(([id]) => id === K4)
	t.check(k4row && k4row[1] === null && k4row[2] === null, 'K4 (zwei freie Enden): beide Spalten NULL', k4row)
})

await C('C56', 'Verbinder-Freigabe (SPEC-M1 §4.7 Regel 14): Objekt mit 2 gebundenen Verbindern entfernen → freie Punkte (exakt ungedreht, ±0,01 gedreht), je eine changes-Zeile; im selben Batch patch auf ein vorher entferntes Ziel → ok, freier Punkt; Client-Lösung vor dem remove → Server gibt nichts frei', async (t) => {
	const b = await newBoard('C56')
	const [A, B2, C3, D, E, K1, K2, K3, K4, K5, K6, X] = Array.from({ length: 12 }, () => ulid())
	const boxA = { x: 100, y: 40, w: 200, h: 120, r: 30 }
	const boxC = { x: 900, y: -300, w: 80, h: 60, r: 0 }
	const boxE = { x: -500, y: 700, w: 160, h: 100, r: 0 }
	await ops(alice, b, [
		shape(A, boxA), shape(B2, { x: 600, y: 40 }), shape(C3, boxC), shape(D, { x: 1500, y: 0 }), shape(E, boxE), shape(X, { x: 3000, y: 0 }),
		connector(K1, { item: A, ax: 1, ay: 0.5 }, { item: B2 }),
		connector(K2, { x: 10, y: 10 }, { item: A }),
		connector(K3, { item: B2 }, { x: 0, y: 0 }),
		connector(K4, { item: D, ax: 0, ay: 0 }, { item: B2 }),
		connector(K5, { item: E, ax: 0, ay: 0 }, { item: E, ax: 1, ay: 1 }),
		connector(K6, { item: X }, { item: B2 }),
	])
	// (a) remove A: K1.start and K2.end become free points, one change row each
	let d = await ops(alice, b, [remove(A)])
	resIs(t, d, ['ok'], 'remove A')
	let s = await snap(alice, b)
	const wantK1 = anchorPoint(boxA, null, { ax: 1, ay: 0.5 })
	const wantK2 = anchorPoint(boxA, null, {})
	t.check(endsEqual(itemIn(s, K1)?.data?.start, { x: wantK1[0], y: wantK1[1] }, true), `K1.start = Ankerpunkt (1, 0.5) des um 30° gedrehten A = ${JSON.stringify(wantK1)} (±0,01)`, itemIn(s, K1)?.data?.start)
	t.check(endsEqual(itemIn(s, K2)?.data?.end, { x: wantK2[0], y: wantK2[1] }, false), `K2.end (auto) = Mitte von A = ${JSON.stringify(wantK2)} (exakt)`, itemIn(s, K2)?.data?.end)
	t.check(deepEq(itemIn(s, K1)?.data?.end, { item: B2 }) && deepEq(itemIn(s, K2)?.data?.start, { x: 10, y: 10 }), 'die anderen Enden unverändert')
	let per = await rowsAt(b, d.acks.rev)
	t.check(per[K1]?.length === 1 && per[K2]?.length === 1 && per[A]?.length === 1 && Object.keys(per).length === 3, 'je genau eine changes-Zeile für K1, K2 und A beim rev des remove', Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.map((r) => r.op)])))
	t.check(per[K1]?.[0]?.op === 'patch' && deepEq(Object.keys(patchOf(per[K1]?.[0]) || {}), ['data.start']) && per[K2]?.[0]?.op === 'patch' && deepEq(Object.keys(patchOf(per[K2]?.[0]) || {}), ['data.end']),
		'Zeilen: patch {"data.start": …} bzw. {"data.end": …}', [per[K1]?.[0]?.patch, per[K2]?.[0]?.patch])
	t.check(deepEq(patchOf(per[K1]?.[0])?.['data.start'], itemIn(s, K1)?.data?.start), 'Zeile trägt den gespeicherten freien Punkt', per[K1]?.[0]?.patch)
	t.check(itemIn(s, K1)?.data?.start && !('item' in itemIn(s, K1).data.start), 'kein halbes Ende (nur x, y)', itemIn(s, K1)?.data?.start)
	const kRows = await stack.sql(`SELECT id, start_item, end_item FROM oc_knorke_items WHERE board_id = ${b} AND id IN ('${K1}', '${K2}');`)
	t.check(kRows.find(([id]) => id === K1)?.[1] === null && kRows.find(([id]) => id === K2)?.[2] === null, 'abgeleitete Spalten nach der Freigabe NULL', kRows)

	// (b) same batch: remove C, then patch K3.end onto C → ok, free point (unrotated: exact)
	d = await ops(alice, b, [remove(C3), patch(K3, { 'data.end': { item: C3, ax: 0, ay: 0 } })])
	resIs(t, d, ['ok', 'ok'], 'remove C + patch K3.end auf C im selben Batch → ok, ok')
	s = await snap(alice, b)
	const wantK3 = anchorPoint(boxC, null, { ax: 0, ay: 0 })
	t.check(endsEqual(itemIn(s, K3)?.data?.end, { x: wantK3[0], y: wantK3[1] }, false), `K3.end = Ankerpunkt (0, 0) von C = ${JSON.stringify(wantK3)} (exakt)`, itemIn(s, K3)?.data?.end)
	per = await rowsAt(b, d.acks.rev)
	t.check(per[K3]?.length === 1 && per[C3]?.length === 1, 'eine zusammengeführte Zeile für K3', Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.map((r) => r.patch)])))

	// (c) client release before the remove: the server releases nothing
	d = await ops(alice, b, [patch(K4, { 'data.start': { x: 7.5, y: 8.5 } }), remove(D)])
	resIs(t, d, ['ok', 'ok'], 'Client löst K4 (patch data.start) vor remove D')
	s = await snap(alice, b)
	t.check(JSON.stringify(itemIn(s, K4)?.data?.start) === JSON.stringify({ x: 7.5, y: 8.5 }), 'K4.start = der Punkt des Clients (nicht der Ankerpunkt von D)', itemIn(s, K4)?.data?.start)
	per = await rowsAt(b, d.acks.rev)
	t.check(per[K4]?.length === 1 && deepEq(patchOf(per[K4][0]), { 'data.start': { x: 7.5, y: 8.5 } }), 'genau eine Zeile für K4 mit dem Wert des Clients', per[K4]?.map((r) => r.patch))

	// (d) both ends on the same removed item: one merged row with both paths
	d = await ops(alice, b, [remove(E)])
	s = await snap(alice, b)
	const e0 = anchorPoint(boxE, null, { ax: 0, ay: 0 })
	const e1 = anchorPoint(boxE, null, { ax: 1, ay: 1 })
	t.check(endsEqual(itemIn(s, K5)?.data?.start, { x: e0[0], y: e0[1] }, false) && endsEqual(itemIn(s, K5)?.data?.end, { x: e1[0], y: e1[1] }, false), 'K5: beide Enden frei an (0,0) und (1,1) von E', itemIn(s, K5)?.data)
	per = await rowsAt(b, d.acks.rev)
	t.check(per[K5]?.length === 1 && deepEq(Object.keys(patchOf(per[K5][0]) || {}).sort(), ['data.end', 'data.start']), 'eine zusammengeführte Zeile mit data.start und data.end', per[K5]?.map((r) => r.patch))

	// (e) a connector removed in the same batch as its target is not released
	d = await ops(alice, b, [remove(K6), remove(X)])
	resIs(t, d, ['ok', 'ok'], 'remove K6 + remove X')
	per = await rowsAt(b, d.acks.rev)
	t.check(per[K6]?.length === 1 && per[K6][0].op === 'remove', 'gelöschter Verbinder: nur seine remove-Zeile, keine Freigabe', per[K6]?.map((r) => [r.op, r.patch]))
})

await C('C57', 'Register der Enden (SPEC-M1 §4.7 Regel 14): patch data.start.item → bad; A patcht data.start, B patcht data.end im selben Fenster → beide bleiben; gleiches Ende nacheinander → der Spätere gewinnt', async (t) => {
	const b = await newBoard('C57')
	await member(bob, await link(b))
	const [A, B2, X, K] = [ulid(), ulid(), ulid(), ulid()]
	await ops(alice, b, [shape(A), shape(B2, { x: 400 }), sticky(X, { x: 800 }), connector(K, { item: A }, { item: B2 })])
	resIs(t, await ops(alice, b, [patch(K, { 'data.start.item': X }), patch(K, { 'data.start.ax': 0.5 }), patch(K, { 'data.end.x': 1 })]), ['bad', 'bad', 'bad'], 'Unterpfad eines Endes → bad (ein Register)')
	const since = await revOf(alice, b)
	resIs(t, await ops(alice, b, [patch(K, { 'data.start': { item: X, ax: 0.123456, ay: 1 } })], { since }), ['ok'], 'alice: data.start')
	resIs(t, await ops(bob, b, [patch(K, { 'data.end': { x: -40.25, y: 12 } })], { since }), ['ok'], 'bob: data.end (gleiches Fenster)')
	let it = itemIn(await snap(alice, b), K)
	t.check(JSON.stringify(it?.data?.start) === JSON.stringify({ item: X, ax: 0.1235, ay: 1 }) && JSON.stringify(it?.data?.end) === JSON.stringify({ x: -40.25, y: 12 }), 'beide Enden bleiben (verschiedene Register)', it?.data)
	resIs(t, await ops(alice, b, [patch(K, { 'data.start': { x: 1, y: 1 } })], { since }), ['ok'], 'alice: data.start frei')
	resIs(t, await ops(bob, b, [patch(K, { 'data.start': { item: A } })], { since }), ['ok'], 'bob danach: data.start an A')
	it = itemIn(await snap(alice, b), K)
	t.check(deepEq(it?.data?.start, { item: A }) && deepEq(it?.data?.end, { x: -40.25, y: 12 }), 'gleiches Ende nacheinander: bob (der Spätere) gewinnt, ganzer Wert', it?.data)
	const row = await stack.sqlRow(`SELECT start_item, end_item FROM oc_knorke_items WHERE board_id = ${b} AND id = '${K}';`)
	t.check(row && row[0] === A && row[1] === null, 'abgeleitete Spalten folgen dem Endzustand (start_item A, end_item NULL)', row)
})

await C('C58', 'Frame keep (SPEC-M1 §4.7 Regel 15): patch {x−100, y−50, parent, w+100, h+50} mit keep → absolute Lage aller Kinder (3 DB, 1 im Batch verschoben) unverändert, eine Zeile je Kind; ohne keep wandern sie mit; keep auf einer Notiz ignoriert; (R9) Reihenfolge: vor dem keep-patch verschoben → mitverschoben, danach relativ zur neuen Lage übernommen/freigegeben/verschoben (auch in einen anderen Frame) → wie gesendet, danach entfernt → entfernt; 600 Kinder → Bündelweg, Anfrage < 1 s', async (t) => {
	// stage 4 (R19): more than 30 op batches in this case – no snapshot per batch (route 12 budget)
	const ops = opsNoSnap
	const b = await newBoard('C58')
	const [F, C1, C2, C3, C4] = [ulid(), ulid(), ulid(), ulid(), ulid()]
	const f0 = { x: 1000, y: 1000, w: 800, h: 600 }
	await ops(alice, b, [frame(F, f0)])
	await ops(alice, b, [sticky(C1, { parent: F, x: 10, y: 10 }), shape(C2, { parent: F, x: 100, y: 100 }), textItem(C3, { parent: F, x: 700, y: 500 }), sticky(C4, { parent: F, x: 50, y: 50 })])
	const abs = (it) => ({ x: it.x + (it.parent ? f0.x : 0), y: it.y + (it.parent ? f0.y : 0) })
	const before = await snap(alice, b)
	const absBefore = Object.fromEntries([C1, C2, C3].map((id) => [id, abs(itemIn(before, id))]))
	const d = await ops(alice, b, [patch(C4, { x: 200, y: 300, parent: F }), keepPatch(F, { x: 900, y: 950, parent: null, w: 900, h: 650 })])
	resIs(t, d, ['ok', 'ok'], 'patch Kind C4 (im Batch), dann Frame-patch mit keep')
	const s = await snap(alice, b)
	const fr = itemIn(s, F)
	t.check(fr?.x === 900 && fr?.y === 950 && fr?.w === 900 && fr?.h === 650, 'Frame: neue Lage und Größe', fr)
	const absOf = (it) => ({ x: it.x + fr.x, y: it.y + fr.y })
	for (const id of [C1, C2, C3]) {
		const it = itemIn(s, id)
		t.check(it?.parent === F && deepEq(absOf(it), absBefore[id]), `${id === C1 ? 'C1' : id === C2 ? 'C2' : 'C3'}: Kind bleibt, absolute Lage unverändert ${JSON.stringify(absBefore[id])}`, { rel: it && { x: it.x, y: it.y }, abs: it && absOf(it) })
	}
	const c4 = itemIn(s, C4)
	t.check(c4?.parent === F && deepEq(absOf(c4), { x: 1200, y: 1300 }), 'C4 (im Batch VOR dem keep-patch verschoben → mitverschoben): absolute Lage = Absicht des patch (1200, 1300)', { rel: c4 && { x: c4.x, y: c4.y } })
	const per = await rowsAt(b, d.acks.rev)
	t.check([F, C1, C2, C3, C4].every((id) => per[id]?.length === 1) && Object.keys(per).length === 5, 'eine Zeile je Kind (C4 zusammengeführt) plus der Frame', Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.length])))
	t.check([C1, C2, C3].every((id) => { const p = patchOf(per[id]?.[0]) || {}; return per[id]?.[0]?.op === 'patch' && 'x' in p && 'y' in p && p.parent === F }), 'Kinder-Zeilen: patch mit ganzer Lagegruppe (parent unverändert)', [C1, C2, C3].map((id) => per[id]?.[0]?.patch))
	// undo: the inverse carries keep, too (§6.5.2) – children stay again
	resIs(t, await ops(alice, b, [keepPatch(F, { x: f0.x, y: f0.y, parent: null, w: f0.w, h: f0.h })]), ['ok'], 'inverser patch mit keep')
	const su = await snap(alice, b)
	t.check([C1, C2, C3].every((id) => deepEq({ x: itemIn(su, id).x + f0.x, y: itemIn(su, id).y + f0.y }, absBefore[id])), 'nach dem Rückgängig-patch: absolute Lage weiter unverändert', [C1, C2, C3].map((id) => itemIn(su, id)))
	// without keep: the children move with the frame (M0)
	const [G, G1] = [ulid(), ulid()]
	await ops(alice, b, [frame(G, { x: 5000, y: 0 })])
	await ops(alice, b, [sticky(G1, { parent: G, x: 30, y: 40 })])
	resIs(t, await ops(alice, b, [patch(G, { x: 4900, y: -50, parent: null, w: 900, h: 650 })]), ['ok'], 'Frame-patch ohne keep')
	let g1 = itemIn(await snap(alice, b), G1)
	t.check(g1?.parent === G && g1?.x === 30 && g1?.y === 40, 'ohne keep: relative Lage gleich, das Kind wandert mit', g1)
	const dk = await ops(alice, b, [keepPatch(G, { x: 4800, y: -50, parent: null }, 1)])
	g1 = itemIn(await snap(alice, b), G1)
	t.check(dk.acks.res[0] === 'bad' || (dk.acks.res[0] === 'ok' && g1?.x === 30 && g1?.y === 40), 'keep: 1 ist nicht das Literal true → wirkt nicht (ok ohne Kinder-Verschiebung, oder bad)', { res: dk.acks.res, g1 })
	const dz = await ops(alice, b, [keepPatch(G, { w: 1000, h: 700 })])
	t.check(dz.acks.res[0] === 'ok' && !(await rowsAt(b, dz.acks.rev))[G1], 'keep ohne Lageänderung (nur w/h): keine Kinder-Zeile', dz.acks)
	// keep on a note: ignored
	const N = ulid()
	await ops(alice, b, [sticky(N, { x: 7000, y: 0 })])
	const dn = await ops(alice, b, [keepPatch(N, { x: 7100, y: 50, parent: null })])
	resIs(t, dn, ['ok'], 'keep auf einer Notiz → ok (ignoriert)')
	const pn = await rowsAt(b, dn.acks.rev)
	t.check(itemIn(await snap(alice, b), N)?.x === 7100 && deepEq(Object.keys(pn), [N]), 'nur die Notiz selbst geändert', Object.keys(pn))
	// (R9) keep acts at the time of its op: the batch of transformItems (§6.5.2) – keep patch first, then the
	// membership patches relative to the NEW frame position; a later op on a child wins, a later remove stays
	const [P, P1, P2, P3, P4, R] = [ulid(), ulid(), ulid(), ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(P, { x: 9000, y: 0, w: 800, h: 600 })])
	await ops(alice, b, [sticky(P1, { parent: P, x: 10, y: 10 }), sticky(P2, { parent: P, x: 600, y: 400 }), sticky(P3, { parent: P, x: 300, y: 300 }), sticky(P4, { parent: P, x: 400, y: 100 }), sticky(R, { x: 9050, y: 100 })])
	const dr = await ops(alice, b, [
		patch(P2, { x: 550, y: 330, parent: P }), // BEFORE the keep patch (relative to the old position 9000, 0; absolute 9550, 330)
		keepPatch(P, { x: 8900, y: -50, parent: null, w: 900, h: 650 }), // dx −100, dy −50
		patch(R, { x: 150, y: 150, parent: P }), // root item adopted AFTER it, relative to the new position (absolute 9050, 100)
		patch(P1, { x: 9010, y: 10, parent: null }), // released AFTER it at its absolute position
		patch(P3, { x: 50, y: 60, parent: P }), // a later op on a child's placement wins
		remove(P4), // a child removed after the keep patch
	])
	resIs(t, dr, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'], '(R9) ein Batch: Kind verschoben, Frame-patch mit keep, Übernahme, Freigabe, Kind verschoben, Kind entfernt')
	const sr = await snap(alice, b)
	const pr = itemIn(sr, P)
	t.check(pr?.x === 8900 && pr?.y === -50 && pr?.w === 900 && pr?.h === 650, '(R9) Frame: neue Lage und Größe', pr)
	const rr = itemIn(sr, R)
	t.check(rr?.parent === P && rr?.x === 150 && rr?.y === 150, '(R9) R, nach dem keep-patch relativ zur neuen Lage übernommen: wie gesendet (150, 150), nicht verschoben – absolute Lage (9050, 100) gleich', rr && { parent: rr.parent === P ? 'P' : rr.parent, x: rr.x, y: rr.y })
	const r2 = itemIn(sr, P2)
	t.check(r2?.parent === P && r2?.x === 650 && r2?.y === 380, '(R9) P2, VOR dem keep-patch verschoben: mitverschoben (650, 380) – absolute Lage = Absicht des patch (9550, 330)', r2 && { x: r2.x, y: r2.y })
	const r1 = itemIn(sr, P1)
	t.check(r1?.parent === null && r1?.x === 9010 && r1?.y === 10, '(R9) P1, nach dem keep-patch freigegeben: wie gesendet (9010, 10), Wurzel', r1 && { parent: r1.parent, x: r1.x, y: r1.y })
	const r3 = itemIn(sr, P3)
	t.check(r3?.parent === P && r3?.x === 50 && r3?.y === 60, '(R9) P3, nach dem keep-patch verschoben: die spätere Op gewinnt (50, 60)', r3 && { x: r3.x, y: r3.y })
	t.check(itemIn(sr, P4) === null, '(R9) P4, nach dem keep-patch entfernt: entfernt')
	const prr = await rowsAt(b, dr.acks.rev)
	t.check([P, P1, P2, P3, P4, R].every((id) => prr[id]?.length === 1) && Object.keys(prr).length === 6 && prr[P4][0].op === 'remove', '(R9) eine Zeile je Objekt (P4: remove), keine weitere', Object.fromEntries(Object.entries(prr).map(([k, v]) => [k, v.map((x) => x.op)])))
	const rp = patchOf(prr[R]?.[0]) || {}
	t.check(prr[R]?.[0]?.op === 'patch' && rp.x === 150 && rp.y === 150 && rp.parent === P, '(R9) Zeile von R: {x 150, y 150, parent P} wie gesendet', prr[R]?.[0]?.patch)
	// (R9) a child shifted by the keep patch and put into ANOTHER frame by a later op of the same batch: the
	// later op wins the whole placement group (rule 2a, rule 15) – snapshot, the stored parent_id and the
	// change row agree, and removing that other frame releases the child (rule 6). W1 of round 1a: the server
	// wrote x/y but kept parent_id of the old frame while its change row named the new one (dl, K3 rev 140).
	const [Q, Q2, QK] = [ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(Q, { x: 12000, y: 0, w: 800, h: 600 }), frame(Q2, { x: 14000, y: 0, w: 800, h: 600 })])
	await ops(alice, b, [sticky(QK, { parent: Q, x: 10, y: 10 })])
	const dq = await ops(alice, b, [
		keepPatch(Q, { x: 11900, y: -50, parent: null, w: 900, h: 650 }), // shifts QK to (110, 60) in Q
		patch(QK, { x: 50, y: 60, parent: Q2 }), // AFTER it: into the other frame Q2 (absolute 14050, 60)
	])
	resIs(t, dq, ['ok', 'ok'], '(R9) Frame-patch mit keep, danach das Kind QK in einen anderen Frame Q2 gesetzt')
	const qName = (id) => (id === Q ? 'Q (alter Frame)' : id === Q2 ? 'Q2' : id)
	const qk = itemIn(await snap(alice, b), QK)
	t.check(qk?.parent === Q2 && qk?.x === 50 && qk?.y === 60, '(R9) QK im Snapshot: in Q2 bei (50, 60) wie gesendet (die spätere Op gewinnt die ganze Lagegruppe)', qk && { parent: qName(qk.parent), x: qk.x, y: qk.y })
	const qrow = await stack.itemRow(b, QK)
	t.check(qrow?.parent_id === Q2 && qrow?.x === 50 && qrow?.y === 60, '(R9) QK in der DB: parent_id = Q2, x 50, y 60 (gleich der Änderungszeile)', qrow && { parent_id: qName(qrow.parent_id), x: qrow.x, y: qrow.y })
	const qp = patchOf((await rowsAt(b, dq.acks.rev))[QK]?.[0]) || {}
	t.check(qp.parent === Q2 && qp.x === 50 && qp.y === 60, '(R9) Änderungszeile von QK: {x 50, y 60, parent Q2}', { ...qp, parent: qName(qp.parent) })
	resIs(t, await ops(alice, b, [remove(Q2)]), ['ok'], '(R9) danach Q2 entfernen')
	const qk2 = itemIn(await snap(alice, b), QK)
	t.check(qk2?.parent === null && qk2?.x === 14050 && qk2?.y === 60, '(R9) Q2 entfernt → QK freigegeben an der Wurzel bei (14050, 60) (Regel 6)', qk2 && { parent: qName(qk2.parent), x: qk2.x, y: qk2.y })

	// 600 children: the bundled write path, the request stays < 1 s
	const H = ulid()
	await ops(alice, b, [frame(H, { x: 0, y: 5000, w: 6000, h: 3000 })])
	const kids = Array.from({ length: 600 }, () => ulid())
	for (let i = 0; i < 600; i += 200) {
		await ops(alice, b, kids.slice(i, i + 200).map((id, j) => sticky(id, { parent: H, x: ((i + j) % 30) * 200, y: Math.floor((i + j) / 30) * 150, data: { text: '' } })))
	}
	// since = the current rev: the timed request carries no snapshot read, only the write and its own answer
	const sinceH = await revOf(alice, b)
	const t0 = Date.now()
	const dh = await ops(alice, b, [keepPatch(H, { x: -100, y: 4950, parent: null, w: 6100, h: 3050 })], { since: sinceH })
	const ms = Date.now() - t0
	resIs(t, dh, ['ok'], 'keep auf Frame mit 600 Kindern')
	t.check(ms < 1000, `Anfrage < 1 s (obere Schranke der Lock-Haltezeit): ${ms} ms`, ms)
	const ph = await rowsAt(b, dh.acks.rev)
	t.check(Object.keys(ph).length === 601 && kids.every((id) => ph[id]?.length === 1), 'Bündelweg: 600 Kinder-Zeilen + 1 Frame-Zeile', Object.keys(ph).length)
	const sh = await snap(alice, b)
	const moved = kids.filter((id, k) => { const it = itemIn(sh, id); return !(it && it.parent === H && it.x === (k % 30) * 200 + 100 && it.y === Math.floor(k / 30) * 150 + 50) })
	t.check(moved.length === 0, '600 Kinder: relative Lage + (100, 50), absolute Lage gleich', moved.slice(0, 3).map((id) => itemIn(sh, id)))
	t.note(`keep mit 600 Kindern: ${ms} ms`)
})

await C('C59', 'Rückwärts-Verträglichkeit (SPEC-M1 §3.10, §4.7 Regel 18): M0-Objekte unverändert patchbar; put t pen → bad; gespeicherter unbekannter Typ (per SQL) nicht bindbar (bad), patch/remove generisch erlaubt', async (t) => {
	const b = await newBoard('C59')
	const [S, F, U] = [ulid(), ulid(), ulid()]
	await ops(alice, b, [sticky(S, { data: { text: 'M0' } }), frame(F, { x: 1000 })])
	resIs(t, await ops(alice, b, [patch(S, { 'data.text': 'noch M0', 'style.fill': '#FFADAD', 'style.fontSize': 32 }), patch(S, { x: 20, y: 30, parent: F }), patch(F, { 'data.title': 'Phase 1', 'style.fill': '#FFFFFF' }), patch(S, { w: 250, h: 250, r: 5 })]),
		['ok', 'ok', 'ok', 'ok'], 'M0-Notiz und -Frame: Text, Farbe, Schrift, Lage, Größe, Drehung')
	resIs(t, await ops(alice, b, [{ o: 'put', id: ulid(), t: 'pen', p: { x: 0, y: 0, w: 100, h: 100, r: 0, z: nextZ(), parent: null, data: { points: [[0, 0], [10, 10]] }, style: {} } }]), ['bad'], 'put t pen (unbekannter Typ, §12.3) → bad')
	// an item of a later version, written into the database directly
	rawBoards.add(b)
	const rev = (await stack.boardRow(b)).rev
	await stack.sql(`INSERT INTO oc_knorke_items (board_id, id, type, parent_id, z, x, y, w, h, rotation, data, style, version, rev, deleted, created_by, created_at, modified_by, modified_at) VALUES (${b}, '${U}', 'pen', NULL, '${nextZ()}', 300, 40, 120, 80, 0, '{"points":[[0,0],[10,10]]}', NULL, 1, ${rev}, 0, 'u:alice', 0, 'u:alice', 0);`)
	const s0 = await snap(alice, b)
	t.check(itemIn(s0, U)?.t === 'pen', 'Snapshot liefert den unbekannten Typ unverändert (Platzhalter beim Client)', itemIn(s0, U))
	resIs(t, await ops(alice, b, [connector(ulid(), { item: U }, { x: 0, y: 0 }), connector(ulid(), { x: 0, y: 0 }, { item: U, ax: 0, ay: 0 })]), ['bad', 'bad'], 'Verbinder-Ende an einem unbekannten gespeicherten Typ → bad (nicht bindbar)')
	resIs(t, await ops(alice, b, [patch(U, { 'data.color': 'rot', 'style.width': 3 }), patch(U, { x: 310, y: 50, parent: null }), patch(U, { x: 0, y: 0, parent: F })]), ['ok', 'ok', 'bad'], 'patch generisch: Felder ok, Lage an der Wurzel ok, in einen Frame → bad (GENERIC childOf [])')
	const u = itemIn(await snap(alice, b), U)
	t.check(u?.t === 'pen' && deepEq(u?.data, { points: [[0, 0], [10, 10]], color: 'rot' }) && u?.x === 310, 'Typ und unbekannte Daten bleiben erhalten (Regel 18)', u)
	resIs(t, await ops(alice, b, [remove(U)]), ['ok'], 'remove generisch → ok')
	resIs(t, await ops(alice, b, [connector(ulid(), { item: U }, { x: 0, y: 0 })]), ['bad'], 'auch sein Grabstein ist nicht bindbar → bad')
})

// ── SPEC-M1 stage 2 (§8.3, Revision 13): shares, effective roles, revocation, sharee search, vote link, link password and expiry, fast path, board list and teams ──

/** The harness group of up.sh (env.json .groups, members bob and carol). */
const HGROUP = 'knorke-e2e'
/** A password Nextcloud's password_policy accepts (length, not common). */
const LINK_PW = 'Knorke-Harness-Pw-7319!'
const LINK_PW2 = 'Knorke-Harness-Pw-8423?'
/** The six keys of a Link object from stage 2 on (SPEC-M1 §4.4, §15 R4: always present from WP-B2). */
const LINK_KEYS = ['expiresAt', 'expiresOn', 'password', 'role', 'token', 'url']

let carolC = null
/** carol (KD_EXTRA_USERS, in knorke-e2e), logged in on first use. */
async function carolClient() {
	if (!carolC) {
		carolC = await new Client(env, 'carol').login('carol')
		carolC.client = clientId()
	}
	return carolC
}

/** Boards of other owners (carol, bob, throwaway accounts): [client, id], deleted by their owner at the end. */
const createdBy = []
async function newBoardOf(c, title) {
	const r = await c.createBoard(title)
	if (r.status !== 201 || !r.data?.board?.id) throw new Error(`Board anlegen (${c.name}): ${brief(r)}`)
	createdBy.push([c, r.data.board.id])
	return r.data.board.id
}

/**
 * Clears Nextcloud's ILimiter state before each of C60–C68 (SPEC-M1 §8.4
 * R13, SRV-07: the budgets of routes 20/21 live in Redis across runs) – the
 * stack helper, without the bridge.
 */
async function limiterReset() {
	return stack.ratelimitReset()
}

/** core share policy through occ ({key: value|null}, null = delete = default), then the app-config wait. */
async function policy(pairs) {
	for (const [k, v] of Object.entries(pairs)) {
		if (v === null) await stack.occ('config:app:delete', 'core', k)
		else await stack.occ('config:app:set', 'core', k, `--value=${v}`)
	}
	await sleep(APPCONFIG_SETTLE_MS)
}

/** Circles on or off (app config: then the wait). */
async function circles(on) {
	await stack.occ(on ? 'app:enable' : 'app:disable', 'circles')
	await sleep(APPCONFIG_SETTLE_MS)
}

/** Is Circles enabled in this image (both NC images have it on by default)? */
async function circlesEnabled() {
	const o = occJson(await stack.occ('app:list', '--output=json').catch(() => ''))
	return !!(o && o.enabled && 'circles' in o.enabled)
}

const u = (id, role) => ({ kind: 'user', id, role })
const g = (id, role) => ({ kind: 'group', id, role })
const tm = (id, role) => ({ kind: 'team', id, role })
/** "kind:id:role" of the shares of a GET/PUT answer, sorted. */
const shareKeys = (r) => (Array.isArray(r?.data?.shares) ? r.data.shares.map((s) => `${s.kind}:${s.id}:${s.role}`).sort() : null)
/** The stored share rows of a board (SQL), "kind:recipient:role", sorted. */
async function shareRows(b) {
	return (await stack.sql(`SELECT kind, recipient, role FROM oc_knorke_shares WHERE board_id = ${b} ORDER BY kind, recipient;`)).map((r) => r.join(':')).sort()
}
/** PUT shares that must answer 200 (setup); returns the answer. */
async function saveOk(c, b, shares) {
	const r = await c.saveShares(b, shares)
	if (r.status !== 200) throw new Error(`PUT shares ${b} (${c.name}): ${brief(r)}`)
	return r
}
/** A 400 with this code and `at` (SPEC-M1 §4.2). */
const errAt = (r, code, at) => errIs(r, 400, code) && r.data?.at === at
/** 429 slow_down with retryMs and a matching Retry-After header (SPEC-M1 §4.2). */
const slowDown = (r) => r.status === 429 && r.data?.error === 'slow_down' && Number.isInteger(r.data?.retryMs) && r.data.retryMs > 0
	&& String(r.headers?.['retry-after']) === String(Math.ceil(r.data.retryMs / 1000))
/** The GET answer of an owner: shares, policy, links, linksAllowed, linkPolicy (R14-04: with `today`; the snapshot's linkPolicy has none). */
const ownerAnswer = (d) => isObj(d) && Array.isArray(d.shares) && isObj(d.policy)
	&& deepEq(Object.keys(d.policy).sort(), ['groupMembersOnly', 'groups', 'sharing', 'teams'])
	&& isObj(d.links) && 'edit' in d.links && 'vote' in d.links && typeof d.linksAllowed === 'boolean'
	&& isObj(d.linkPolicy) && deepEq(Object.keys(d.linkPolicy).sort(), ['expireDefaultDays', 'expireEnforced', 'expireMaxDays', 'passwordEnforced', 'today'])
	&& /^\d{4}-\d{2}-\d{2}$/.test(d.linkPolicy.today)
/** A complete Link object (SPEC-M1 §4.4, stage 2: all six keys). */
const linkOk = (l, { token, role = 'edit', password = false } = {}) => isObj(l) && deepEq(Object.keys(l).sort(), LINK_KEYS)
	&& /^[A-Za-z0-9]{24}$/.test(l.token) && (token === undefined || l.token === token) && l.role === role
	&& typeof l.url === 'string' && l.url.endsWith(`/p/${l.token}`) && l.password === password
/** Link id of the non-revoked row of a role (SQL). */
async function linkIdOf(b, role) {
	const row = await stack.sqlRow(`SELECT id FROM oc_knorke_links WHERE board_id = ${b} AND role = '${role}' AND revoked_at IS NULL ORDER BY id DESC;`)
	return row ? Number(row[0]) : null
}
/** {link_id, role} of a member row, or null. */
async function memberRow(b, uid) {
	const row = await stack.sqlRow(`SELECT link_id, role FROM oc_knorke_members WHERE board_id = ${b} AND user_id = '${uid}';`)
	return row ? { link_id: row[0] === null ? null : Number(row[0]), role: row[1] } : null
}
/**
 * The grants g:<b>:* of a board as stored values "<acl>|<role>|<o>" with their
 * TTL (FastCache keeps strings JSON-encoded in Redis: one JSON.parse).
 */
async function grantsOf(b) {
	const out = []
	for (const k of await stack.redisScan(rkey(`g:${b}:*`))) {
		const raw = await stack.redis('GET', k)
		let v = raw
		try { v = JSON.parse(raw) } catch { /* plain */ }
		out.push({ v: String(v), ttl: Number(await stack.redis('TTL', k)) })
	}
	return out
}

/** Guest claims (payload of the token). */
const claimsOf = (tok) => JSON.parse(b64urlDecode(String(tok).split('.')[0]))

// calendar days in the owner's zone (SPEC-M1 §4.11.2 R13: harness accounts have no stored zone → default_timezone, '' = UTC)
function zonedParts(ms, tz) {
	const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
	return Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
}
const dayIn = (ms, tz) => { const p = zonedParts(ms, tz); return `${p.year}-${p.month}-${p.day}` }
function addDays(day, n) {
	const d = new Date(`${day}T00:00:00Z`)
	d.setUTCDate(d.getUTCDate() + n)
	return d.toISOString().slice(0, 10)
}
/** Offset of tz at ms (wall clock − UTC), whole seconds. */
function offsetMs(ms, tz) {
	const p = zonedParts(ms, tz)
	return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}
/** 23:59:59.999 of a calendar day in tz, as epoch ms. */
function endOfDayMs(day, tz) {
	const [y, m, d] = day.split('-').map(Number)
	const wall = Date.UTC(y, m - 1, d, 23, 59, 59, 999)
	let ms = wall - offsetMs(wall, tz)
	ms = wall - offsetMs(ms, tz)
	return ms
}
async function ownerZone() {
	const tz = (await stack.occ('config:system:get', 'default_timezone').catch(() => '')).trim()
	return tz || 'UTC'
}

await C('C60', 'Freigaben-API (SPEC-M1 §4.10, R13): GET/PUT nur Besitzer (Mitglied 403, Fremder 404), PUT idempotent, Formfehler 400, jede Regel mit at, nichts gespeichert bei Fehlern; Teilen gesperrt (shareapi_enabled, Ausschlussgruppe) → 403 sharing_disabled für Neues, Hochstufen und Links, Herabstufen/Entfernen/Verschärfen/DELETE erlaubt; BOB → bob; 21 neue → at 20; Moderator nur links; 61. neuer Empfänger → 429 (carol, zuletzt)', async (t) => {
	await limiterReset()
	const c = await carolClient()
	const b = await newBoard('C60')
	const b2 = await newBoard('C60-ohne-Link')
	let r = await alice.listShares(b)
	t.check(r.status === 200 && ownerAnswer(r.data) && r.data.shares.length === 0, 'GET (Besitzer): 200 mit shares [], policy, links, linksAllowed, linkPolicy (§4.10.1)', brief(r))
	t.check(r.data?.policy?.sharing === true && r.data?.policy?.groups === true && r.data?.policy?.groupMembersOnly === false && typeof r.data?.policy?.teams === 'boolean',
		'policy der Vorgabe: sharing, groups, groupMembersOnly false, teams bool', r.data?.policy)
	t.check(r.data?.links?.edit === null && r.data?.links?.vote === null && r.data?.linksAllowed === true, 'links {edit: null, vote: null}, linksAllowed true', r.data)

	// owner only: a stranger 404 everywhere, a member 403
	for (const [label, rr] of [['GET', await bob.listShares(b)], ['PUT', await bob.saveShares(b, [])], ['sharees', await bob.searchSharees(b, 'carol')]]) {
		t.check(errIs(rr, 404, 'not_found'), `Fremder (bob): ${label} → 404 not_found`, brief(rr))
	}
	const L = await link(b)
	await member(bob, L)
	for (const [label, rr] of [['GET', await bob.listShares(b)], ['PUT', await bob.saveShares(b, [u('carol', 'view')])], ['sharees', await bob.searchSharees(b, 'carol')]]) {
		t.check(errIs(rr, 403, 'forbidden'), `Mitglied über den Link (bob): ${label} → 403 forbidden`, brief(rr))
	}
	t.check(deepEq(await shareRows(b), []), 'nichts gespeichert (Mitglied)')

	// idempotent PUT
	const acl0 = (await stack.boardRow(b)).acl_gen
	r = await alice.saveShares(b, [u('bob', 'view')])
	t.check(r.status === 200 && ownerAnswer(r.data) && deepEq(shareKeys(r), ['user:bob:view']), 'PUT [bob view] → 200, Antwort wie GET', brief(r))
	const sb = r.data?.shares?.[0]
	t.check(sb?.name === 'Bob Berg' && sb?.available === true, 'Eintrag: name live aufgelöst (Bob Berg), available true', sb)
	const acl1 = (await stack.boardRow(b)).acl_gen
	t.check(acl1 === acl0 + 1, 'Hinzufügen: acl_gen + 1 im selben Schreibvorgang (§4.10.2 Schritt 5)', { acl0, acl1 })
	const again = await alice.saveShares(b, [u('bob', 'view')])
	t.check(again.status === 200 && deepEq(shareKeys(again), ['user:bob:view']) && deepEq(await shareRows(b), ['user:bob:view']), 'PUT idempotent: dieselbe Liste noch einmal → 200, eine Zeile', brief(again))
	t.note(`acl_gen nach dem gleichen PUT: ${(await stack.boardRow(b)).acl_gen} (vorher ${acl1})`)

	// shape errors (§4.10.2 step 1): 400 bad_request, nothing stored
	const shape = [
		['Body ohne shares', { raw: {} }],
		['shares kein Array', { raw: { shares: 'bob' } }],
		['fremder Body-Schlüssel', { raw: { shares: [], extra: 1 } }],
		['Eintrag ohne role', [{ kind: 'user', id: 'carol' }]],
		['Eintrag mit zusätzlichem Schlüssel', [{ kind: 'user', id: 'carol', role: 'view', x: 1 }]],
		['kind email', [{ kind: 'email', id: 'carol', role: 'view' }]],
		['role owner', [u('carol', 'owner')]],
		['id leer', [u('', 'view')]],
		['id mit 65 Zeichen', [u('x'.repeat(65), 'view')]],
		['id mit Steuerzeichen', [u('ca\u0007rol', 'view')]],
		['id keine Zeichenkette', [{ kind: 'user', id: 7, role: 'view' }]],
		['doppelt (kind, id)', [u('bob', 'view'), u('bob', 'edit')]],
	]
	for (const [label, body] of shape) {
		const rr = Array.isArray(body) ? await alice.saveShares(b, body) : await alice.saveShares(b, null, body)
		t.check(errIs(rr, 400, 'bad_request'), `Form: ${label} → 400 bad_request`, brief(rr))
	}
	t.check(deepEq(await shareRows(b), ['user:bob:view']), 'nach allen Formfehlern unverändert [bob view]')
	await limiterReset() // the route budget knorke-share (30 per 10 min) holds only so many PUTs

	// rules with `at` (§4.10.2 step 4), first violation, nothing stored
	r = await alice.saveShares(b, [u('bob', 'view'), u(`knorke-nope-${randTok().slice(0, 8)}`, 'view')])
	t.check(errAt(r, 'recipient_not_found', 1), 'unbekannter Nutzer an Index 1 → 400 recipient_not_found, at 1', brief(r))
	r = await alice.saveShares(b, [u('bob', 'view'), g('knorke-nope-gruppe', 'view')])
	t.check(errAt(r, 'recipient_not_found', 1), 'unbekannte Gruppe → 400 recipient_not_found, at 1', brief(r))
	r = await alice.saveShares(b, [u('bob', 'view'), u('alice', 'edit')])
	t.check(errAt(r, 'self_share', 1), 'an sich selbst → 400 self_share, at 1', brief(r))
	const teamsOn = await circlesEnabled()
	if (teamsOn) {
		r = await alice.saveShares(b, [u('bob', 'view'), tm('Z'.repeat(31), 'view')])
		t.check(errAt(r, 'recipient_not_found', 1), 'Team, in dem die Besitzerin nicht ist → 400 recipient_not_found, at 1', brief(r))
	}
	try {
		await policy({ shareapi_allow_group_sharing: 'no' })
		r = await alice.saveShares(b, [u('bob', 'view'), g(HGROUP, 'view')])
		t.check(errAt(r, 'group_sharing_disabled', 1), 'Gruppenfreigabe aus → 400 group_sharing_disabled, at 1', brief(r))
		r = await alice.listShares(b)
		t.check(r.data?.policy?.groups === false, 'GET: policy.groups false', r.data?.policy)
	} finally {
		await policy({ shareapi_allow_group_sharing: null })
	}
	try {
		await policy({ shareapi_only_share_with_group_members: 'yes' })
		r = await alice.saveShares(b, [u('bob', 'view'), u('carol', 'view')])
		t.check(errAt(r, 'group_members_only', 1), 'nur mit Gruppenmitgliedern: carol (keine gemeinsame Gruppe) → 400 group_members_only, at 1', brief(r))
		r = await alice.saveShares(b, [u('bob', 'view'), g(HGROUP, 'view')])
		t.check(errAt(r, 'group_members_only', 1), 'nur mit Gruppenmitgliedern: Gruppe ohne die Besitzerin → 400 group_members_only, at 1', brief(r))
		r = await alice.listShares(b)
		t.check(r.data?.policy?.groupMembersOnly === true, 'GET: policy.groupMembersOnly true', r.data?.policy)
	} finally {
		await policy({ shareapi_only_share_with_group_members: null })
	}
	if (teamsOn) {
		try {
			await circles(false)
			r = await alice.saveShares(b, [u('bob', 'view'), tm('Z'.repeat(31), 'view')])
			t.check(errAt(r, 'teams_unavailable', 1), 'Circles aus → Team → 400 teams_unavailable, at 1', brief(r))
			r = await alice.listShares(b)
			t.check(r.data?.policy?.teams === false, 'GET: policy.teams false', r.data?.policy)
		} finally {
			await circles(true)
		}
	} else {
		t.note('Circles ist in diesem Image nicht aktiv: Team-Regeln übersprungen')
	}
	t.check(deepEq(await shareRows(b), ['user:bob:view']), 'nach allen Regelverstößen unverändert [bob view]')

	// MAX_SHARES + 1 (step 1, before counting) and MAX_NEW_SHARES + 1 (step 2 c)
	const tag = randTok().slice(0, 6).toLowerCase()
	r = await alice.saveShares(b, Array.from({ length: 201 }, (_, i) => u(`knorke-nope-${tag}-${i}`, 'view')))
	t.check(errIs(r, 400, 'too_many_shares') && r.data?.max === 200, '201 Einträge → 400 too_many_shares mit max 200 (R13)', brief(r))
	t.check(r.data?.at === 200, 'too_many_shares: at = 200 (Index des 201. Eintrags, §4.2)', r.data)
	r = await alice.saveShares(b, Array.from({ length: 21 }, (_, i) => u(`knorke-nope-${tag}-n${i}`, 'view')))
	t.check(errAt(r, 'too_many_new_shares', 20) && r.data?.max === 20, '21 neue Einträge (erfundene ids) → 400 too_many_new_shares, at 20, max 20', brief(r))
	t.check(deepEq(await shareRows(b), ['user:bob:view']), 'unverändert [bob view]')

	// canonical ids (R2): BOB is stored as bob, BOB + bob → 400
	await saveOk(alice, b, [])
	r = await alice.saveShares(b, [u('BOB', 'view')])
	t.check(r.status === 200 && deepEq(shareKeys(r), ['user:bob:view']) && deepEq(await shareRows(b), ['user:bob:view']), "id 'BOB' → gespeichert als 'bob' (kanonisch)", brief(r))
	r = await alice.saveShares(b, [u('BOB', 'view'), u('bob', 'view')])
	t.check(errIs(r, 400, 'bad_request') && [0, 1].includes(r.data?.at), "'BOB' + 'bob' → 400 bad_request mit at (Doppelte nach der Kanonisierung)", brief(r))
	await limiterReset()

	// sharing disabled for the owner (shareapi_enabled no): new and promotion 403, demotion/removal 200; links
	await saveOk(alice, b, [u('bob', 'edit')])
	const g0 = await guest('Gina', L)
	try {
		await policy({ shareapi_enabled: 'no' })
		r = await alice.listShares(b)
		t.check(r.status === 200 && r.data?.policy?.sharing === false, 'Teilen gesperrt: GET 200, policy.sharing false', r.data?.policy)
		r = await alice.saveShares(b, [u('bob', 'edit'), u('carol', 'view')])
		t.check(errIs(r, 403, 'sharing_disabled'), 'Teilen gesperrt: neuer Eintrag → 403 sharing_disabled', brief(r))
		r = await alice.saveShares(b, [u('bob', 'moderate')])
		t.check(errIs(r, 403, 'sharing_disabled'), 'Teilen gesperrt: Hochstufen edit → moderate → 403 sharing_disabled', brief(r))
		r = await alice.saveShares(b, [u('bob', 'view')])
		t.check(r.status === 200 && deepEq(shareKeys(r), ['user:bob:view']), 'Teilen gesperrt: Herabstufen edit → view → 200', brief(r))
		r = await alice.saveShares(b, [])
		t.check(r.status === 200 && deepEq(shareKeys(r), []), 'Teilen gesperrt: Entfernen → 200', brief(r))
		// links (§4.11.2 step 2): create, rotate, loosen 403; tighten and DELETE allowed; the existing link keeps working
		const gs = await g0.snapshot(b)
		t.check(gs.status === 200, 'Teilen gesperrt: bestehender Link funktioniert weiter (Gast-Snapshot 200)', brief(gs))
		const ng = new Client(env, 'neu', { kind: 'guest' })
		r = await ng.joinGuest(L, 'Neu', { client: clientId() })
		t.check(r.status === 200, 'Teilen gesperrt: neuer Gast über den bestehenden Link → 200', brief(r))
		r = await alice.postLink(b2, {})
		t.check(errIs(r, 403, 'sharing_disabled'), 'Teilen gesperrt: Link anlegen → 403 sharing_disabled', brief(r))
		r = await alice.postLink(b2, {}, 'vote')
		t.check(errIs(r, 403, 'sharing_disabled'), 'Teilen gesperrt: Abstimm-Link anlegen (Route 17) → 403 sharing_disabled', brief(r))
		r = await alice.postLink(b, { rotate: true })
		t.check(errIs(r, 403, 'sharing_disabled'), 'Teilen gesperrt: Link erneuern → 403 sharing_disabled', brief(r))
		r = await alice.postLink(b, { password: LINK_PW })
		t.check(r.status === 200 && r.data?.link?.password === true && r.data?.link?.token === L, 'Teilen gesperrt: Passwort setzen (Verschärfen) → 200, gleicher Token', brief(r))
		r = await alice.postLink(b, { password: null })
		t.check(errIs(r, 403, 'sharing_disabled'), 'Teilen gesperrt: Passwort entfernen (Lockern) → 403 sharing_disabled', brief(r))
		r = await alice.deleteLink(b)
		t.check(r.status === 200 && r.data?.link === null, 'Teilen gesperrt: DELETE → 200 {link: null}', brief(r))
	} finally {
		await policy({ shareapi_enabled: null })
	}
	// the same through the exclusion groups (D-4: Nextcloud blocks only users with ≥ 1 group, all excluded)
	try {
		await stack.occ('group:adduser', HGROUP, 'alice')
		await policy({ shareapi_exclude_groups: 'yes', shareapi_exclude_groups_list: JSON.stringify([HGROUP]) })
		r = await alice.saveShares(b, [u('bob', 'view')])
		t.check(errIs(r, 403, 'sharing_disabled'), 'Ausschlussgruppe (alice in knorke-e2e, ausgeschlossen) → 403 sharing_disabled', brief(r))
		r = await alice.postLink(b2, {})
		t.check(errIs(r, 403, 'sharing_disabled'), 'Ausschlussgruppe: Link anlegen → 403 sharing_disabled', brief(r))
	} finally {
		await stack.occ('group:removeuser', HGROUP, 'alice').catch(() => {})
		await policy({ shareapi_exclude_groups: null, shareapi_exclude_groups_list: null })
	}
	r = await alice.saveShares(b, [u('bob', 'view')])
	t.check(r.status === 200 && deepEq(shareKeys(r), ['user:bob:view']), 'wieder erlaubt: PUT [bob view] → 200', brief(r))

	// moderator (share role moderate): GET only {links}, PUT 403
	await saveOk(alice, b, [u('bob', 'moderate')])
	await link(b)
	r = await bob.listShares(b)
	t.check(r.status === 200 && deepEq(Object.keys(r.data || {}), ['links']) && isObj(r.data?.links) && 'edit' in r.data.links && 'vote' in r.data.links,
		'Moderator (bob, moderate): GET → 200 nur {links} (keine Freigaben, keine Richtlinie)', brief(r))
	t.check(linkOk(r.data?.links?.edit), 'Moderator: links.edit in der Link-Form (§4.4)', r.data?.links)
	r = await bob.saveShares(b, [u('bob', 'moderate'), u('carol', 'view')])
	t.check(errIs(r, 403, 'forbidden'), 'Moderator: PUT → 403 forbidden', brief(r))
	r = await bob.searchSharees(b, 'carol')
	t.check(errIs(r, 403, 'forbidden'), 'Moderator: Suche → 403 forbidden (nur Besitzer)', brief(r))
	t.check(deepEq(await shareRows(b), ['user:bob:moderate']), 'gespeichert: [bob moderate]')

	// last (R13): carol on her own board – three PUTs with 20 new each, the fourth with one new → 429
	const bc = await newBoardOf(c, 'C60-carol')
	const cTag = randTok().slice(0, 6).toLowerCase()
	for (let k = 0; k < 3; k++) {
		r = await c.saveShares(bc, Array.from({ length: 20 }, (_, i) => u(`knorke-nope-${cTag}-${k}-${i}`, 'view')))
		t.check(errAt(r, 'recipient_not_found', 0), `carol PUT ${k + 1} mit 20 neuen (erfunden) → 400 recipient_not_found, at 0 (gezählt bleibt gezählt)`, brief(r))
	}
	r = await c.saveShares(bc, [u(`knorke-nope-${cTag}-x`, 'view')])
	t.check(slowDown(r), 'carol PUT 4 mit einem neuen = 61. neuer Empfänger in 10 min → 429 slow_down mit retryMs und Retry-After', { status: r.status, body: r.text?.slice(0, 200), retryAfter: r.headers?.['retry-after'] })
	t.check(r.data?.retryMs === 10000, 'retryMs = ceil(600 · 1000 / 60) = 10000 (§4.2 ILimiter)', r.data)
	t.check(deepEq(await shareRows(bc), []), 'carol: nichts gespeichert')
	await limiterReset()
})

await C('C61', 'Wirksame Rolle (SPEC-M1 §4.9, §4.13.1, R13): Freigabe view → Ops denied, me ignoriert; Gruppe edit → ok; Link edit + Freigabe view → edit (link); Links aus (Instanz + dropGens) → view (share), Grant s auf dem Fastpath; moderate → me.mod, Grant f, Snapshot mit links ohne linksAllowed/linkPolicy; moderate → edit live; Rolle vote: s/d leer', async (t) => {
	await limiterReset()
	const c = await carolClient()
	// user share view
	const b = await newBoard('C61')
	const X = ulid()
	await ops(alice, b, [sticky(X, { data: { text: 'C61' } })])
	await saveOk(alice, b, [u('bob', 'view')])
	let s = await snap(bob, b)
	t.check(s.me?.role === 'view' && s.me?.mod === false && s.me?.source === 'share' && s.me?.guest === false, 'Nutzer-Freigabe view: Snapshot me.role view, mod false, source share', s.me)
	t.check(isObj(s.board) && !('links' in s.board) && !('linksAllowed' in s.board) && !('linkPolicy' in s.board), 'Mitglied ohne Moderation: weder links noch linksAllowed noch linkPolicy', s.board)
	let d = await rawSync(bob, b, { seq: ++seqN, ops: [sticky(ulid()), patch(X, { 'data.text': 'von bob' })] })
	t.check(d.status === 200 && deepEq(d.data?.acks?.res, ['denied', 'denied']), 'view: put und patch → denied', brief(d))
	const bobPid = s.me?.pid
	await rawSync(bob, b, { since: s.rev, pres: 1, me: { c: [7, 7], s: [X], d: [], e: null } })
	d = await rawSync(alice, b, { since: s.rev, pres: 1 })
	t.check(d.status === 200 && !Object.keys(d.data?.presence || {}).some((k) => k.startsWith(`${bobPid}:`)), 'view: me wird ignoriert (kein Präsenz-Eintrag von bob)', d.data?.presence)
	let l = listed(await bob.listBoards(), b)
	t.check(l?.source === 'share' && l?.role === 'view' && l?.mod === false && l?.viaLink === false, 'Board-Liste von bob: source share, role view, mod false', l)

	// group share edit through the membership
	const b2 = await newBoard('C61-Gruppe')
	await saveOk(alice, b2, [g(HGROUP, 'edit')])
	s = await snap(c, b2)
	t.check(s.me?.role === 'edit' && s.me?.mod === false && s.me?.source === 'share', 'Gruppen-Freigabe edit: carol (Mitglied) role edit, mod false, source share', s.me)
	d = await ops(c, b2, [sticky(ulid())])
	t.check(deepEq(d.acks?.res, ['ok']), 'Gruppen-Freigabe edit: Op ok', d.acks)

	// link edit + share view → edit (origin link); links off → view (origin share), fast path stays
	const L = await link(b)
	await member(bob, L)
	s = await snap(bob, b)
	t.check(s.me?.role === 'edit' && s.me?.source === 'link' && s.me?.mod === false, 'Link edit + Freigabe view → role edit, source link (Maximum, Gleichstand share vor link)', s.me)
	l = listed(await bob.listBoards(), b)
	t.check(l?.source === 'link' && l?.role === 'edit' && l?.viaLink === true, 'Board-Liste: source link, role edit, viaLink', l)
	try {
		await setLinksAllowed(false)
		await dropGens(b) // a: holds the links bit up to 120 s (R13)
		s = await snap(bob, b)
		t.check(s.me?.role === 'view' && s.me?.source === 'share', 'Links instanzweit aus (+ dropGens): zurück auf view, source share', s.me)
		const rev = s.rev
		d = await rawSync(bob, b, { since: rev, pres: 0 })
		t.check(d.status === 200 && d.data?.rev === rev, 'Freigabe-Nutzer synct weiter (200)', brief(d))
		const grants = await grantsOf(b)
		t.check(grants.some((x) => /^\d+\|view\|s$/.test(x.v)), 'Grant "<acl>|view|s" (Herkunft share, gilt ohne links-Bit: Fastpath bleibt aktiv, §4.13.1)', grants)
		if (stack.kind === 'pgsql') {
			await stack.pgssReset()
			let bad = 0
			for (let i = 0; i < 5; i++) {
				const x = await rawSync(bob, b, { since: rev, pres: 0 })
				if (x.status !== 200 || x.data?.rev !== rev) bad++
			}
			const pg = await stack.pgssCount()
			t.check(bad === 0 && Number(pg?.total) === 0, 'Fastpath: 5 leere Syncs des Freigabe-Nutzers ohne oc_knorke_-Aufruf (Links aus)', { bad, pg })
		} else {
			t.note(`Fastpath ohne App-SQL nur auf pgsql gemessen (C67); hier ${stack.dbLabel}`)
		}
	} finally {
		await setLinksAllowed(true)
		await dropGens(b)
	}

	// moderate (R2): me.mod, grant f, links in the snapshot without linksAllowed/linkPolicy
	const b3 = await newBoard('C61-moderate')
	const L3 = await link(b3)
	await saveOk(alice, b3, [u('bob', 'moderate'), g(HGROUP, 'edit')])
	s = await snap(bob, b3)
	t.check(s.me?.role === 'edit' && s.me?.mod === true && s.me?.source === 'share', 'Nutzer-Freigabe moderate: role edit, mod true, source share', s.me)
	t.check(isObj(s.board?.links) && linkOk(s.board.links.edit, { token: L3 }) && s.board.links.vote === null && !('linksAllowed' in s.board) && !('linkPolicy' in s.board),
		'Moderator-Snapshot: links {edit, vote: null}, ohne linksAllowed und linkPolicy', s.board)
	const gr = await grantsOf(b3)
	t.check(gr.some((x) => /^\d+\|edit\|f$/.test(x.v)), 'Grant "<acl>|edit|f" (Freigabe mit moderate)', gr)
	const sc = await snap(c, b3)
	t.check(sc.me?.role === 'edit' && sc.me?.mod === false && sc.me?.source === 'share', 'Gruppen-Freigabe edit (carol): mod false', sc.me)
	l = listed(await bob.listBoards(), b3)
	t.check(l?.mod === true && l?.role === 'edit' && l?.source === 'share', 'Board-Liste von bob: mod true, role edit, source share', l)
	d = await rawSync(bob, b3, { since: s.rev, pres: 0, role: 'moderate' })
	t.check(d.status === 200 && !('me' in (d.data || {})), 'Sync mit role moderate (stimmt) → kein me', brief(d))
	await saveOk(alice, b3, [u('bob', 'edit'), g(HGROUP, 'edit')])
	d = await rawSync(bob, b3, { since: s.rev, pres: 0, role: 'moderate' })
	t.check(d.status === 200 && deepEq(d.data?.me, { role: 'edit', mod: false }), 'moderate → edit herabgestuft: nächste Antwort me {role: edit, mod: false}', brief(d))

	// role vote: the server empties s and d (§5.5)
	const b4 = await newBoard('C61-vote')
	const V = ulid()
	await ops(alice, b4, [sticky(V)])
	await saveOk(alice, b4, [u('carol', 'vote')])
	s = await snap(c, b4)
	t.check(s.me?.role === 'vote' && s.me?.source === 'share', 'Nutzer-Freigabe vote: role vote, source share', s.me)
	const cPid = s.me?.pid
	d = await rawSync(c, b4, { since: s.rev, pres: 1, me: { c: [11, 12], s: [V], d: [[V, 30, 40]], e: null } })
	t.check(d.status === 200, 'vote schickt me mit s und d → 200', brief(d))
	d = await rawSync(alice, b4, { since: s.rev, pres: 1 })
	const ce = Object.entries(d.data?.presence || {}).find(([k]) => k.startsWith(`${cPid}:`))?.[1]
	t.check(ce && deepEq(ce.s, []) && deepEq(ce.d, []) && ce.x === 11 && ce.y === 12, 'öffentlicher Eintrag der Rolle vote: s [], d [], Cursor bleibt', ce)
})

await C('C62', 'Entzug live (SPEC-M1 §4.10.2, §4.13.9): Freigabe entfernen → nächster Sync 404; edit → view → me.role view in der nächsten Antwort, Ops denied; occ group:removeuser → Zugriff weg in ≤ 1 Anfrage (Listener)', async (t) => {
	await limiterReset()
	const c = await carolClient()
	const b = await newBoard('C62')
	await saveOk(alice, b, [u('bob', 'edit')])
	let s = await snap(bob, b)
	let d = await rawSync(bob, b, { since: s.rev, pres: 0 })
	t.check(d.status === 200 && s.me?.role === 'edit', 'Vorbedingung: bob edit, Sync 200 (Grant warm)', brief(d))
	await saveOk(alice, b, [])
	d = await rawSync(bob, b, { since: s.rev, pres: 0 })
	t.check(errIs(d, 404, 'not_found'), 'Freigabe entfernt → nächster Sync 404 not_found', brief(d))
	t.check(errIs(await bob.snapshot(b), 404, 'not_found') && !listed(await bob.listBoards(), b), 'Snapshot 404, Board fehlt in der Liste')

	const b2 = await newBoard('C62-herab')
	const X = ulid()
	await ops(alice, b2, [sticky(X)])
	await saveOk(alice, b2, [u('bob', 'edit')])
	s = await snap(bob, b2)
	d = await rawSync(bob, b2, { since: s.rev, pres: 0, role: 'edit' })
	t.check(d.status === 200 && !('me' in (d.data || {})), 'Vorbedingung: role edit stimmt, kein me', brief(d))
	await saveOk(alice, b2, [u('bob', 'view')])
	d = await rawSync(bob, b2, { since: s.rev, pres: 0, role: 'edit' })
	t.check(d.status === 200 && deepEq(d.data?.me, { role: 'view', mod: false }), 'edit → view: nächste Antwort me {role: view, mod: false}', brief(d))
	d = await rawSync(bob, b2, { since: s.rev, pres: 0, role: 'view', seq: ++seqN, ops: [patch(X, { 'data.text': 'zu spät' })] })
	t.check(d.status === 200 && deepEq(d.data?.acks?.res, ['denied']), 'folgende Ops → denied', brief(d))

	const b3 = await newBoard('C62-Gruppe')
	await saveOk(alice, b3, [g(HGROUP, 'edit')])
	try {
		s = await snap(c, b3)
		d = await rawSync(c, b3, { since: s.rev, pres: 0 })
		t.check(d.status === 200 && s.me?.role === 'edit', 'Vorbedingung: carol über die Gruppe edit, Sync 200 (Grant warm)', brief(d))
		const acl0 = (await stack.boardRow(b3)).acl_gen
		await stack.occ('group:removeuser', HGROUP, 'carol')
		const acl1 = (await stack.boardRow(b3)).acl_gen
		t.check(acl1 === acl0 + 1, 'UserRemovedEvent: acl_gen + 1 (Listener, §4.13.9)', { acl0, acl1 })
		d = await rawSync(c, b3, { since: s.rev, pres: 0 })
		t.check(errIs(d, 404, 'not_found'), 'aus der Gruppe genommen → nächster Sync 404 (≤ 1 Anfrage)', brief(d))
	} finally {
		await stack.occ('group:adduser', HGROUP, 'carol').catch(() => {})
	}
	d = await c.snapshot(b3)
	t.check(d.status === 200, 'wieder in der Gruppe: Snapshot 200 (kein Negativ-Cache)', brief(d))
})

await C('C63', 'Empfängersuche (SPEC-M1 §4.10.3, R13): Besitzer findet bob und knorke-e2e; Mitglied 403, Fremder 404; q unter minSearchStringLength → leer; Teilen gesperrt → leer; deaktivierte Nutzerin und Besitzerin fehlen; keine Circle-Objekte; 61. Suche in 60 s → 429 (zuletzt)', async (t) => {
	await limiterReset()
	const b = await newBoard('C63')
	let r = await alice.searchSharees(b, 'bob')
	const keysOk = (list) => Array.isArray(list) && list.every((x) => isObj(x) && Object.keys(x).every((k) => ['kind', 'id', 'name', 'sub'].includes(k)) && ['user', 'group', 'team'].includes(x.kind) && typeof x.id === 'string' && typeof x.name === 'string')
	const bobHit = (r.data?.sharees || []).find((x) => x.kind === 'user' && x.id === 'bob')
	t.check(r.status === 200 && typeof r.data?.more === 'boolean' && keysOk(r.data?.sharees), 'q bob → 200 {sharees, more}, je Treffer nur kind/id/name/sub (keine Circle-Objekte)', brief(r))
	t.check(bobHit?.name === 'Bob Berg' && typeof bobHit?.sub === 'string' && bobHit.sub.length > 0, 'bob gefunden: name Bob Berg, sub (E-Mail oder uid)', bobHit)
	r = await alice.searchSharees(b, 'knorke')
	t.check(r.status === 200 && (r.data?.sharees || []).some((x) => x.kind === 'group' && x.id === HGROUP) && keysOk(r.data?.sharees), 'q knorke → Gruppe knorke-e2e', brief(r))
	r = await alice.searchSharees(b, 'alice')
	t.check(r.status === 200 && !(r.data?.sharees || []).some((x) => x.kind === 'user' && x.id === 'alice'), 'die Besitzerin selbst fehlt', brief(r))
	// member 403, stranger 404
	const L = await link(b)
	r = await bob.searchSharees(b, 'carol')
	t.check(errIs(r, 404, 'not_found'), 'Fremder → 404', brief(r))
	await member(bob, L)
	r = await bob.searchSharees(b, 'carol')
	t.check(errIs(r, 403, 'forbidden'), 'Mitglied → 403 forbidden', brief(r))
	// minimum search length (system config, R13: set through occ, deleted in finally)
	try {
		await stack.occ('config:system:set', 'sharing.minSearchStringLength', '--value=3', '--type=integer')
		r = await alice.searchSharees(b, 'bo')
		t.check(r.status === 200 && deepEq(r.data?.sharees, []) && r.data?.more === false, 'minSearchStringLength 3: q bo → {sharees: [], more: false}', brief(r))
		r = await alice.searchSharees(b, 'bob')
		t.check(r.status === 200 && (r.data?.sharees || []).some((x) => x.id === 'bob'), 'minSearchStringLength 3: q bob findet bob', brief(r))
	} finally {
		await stack.occ('config:system:delete', 'sharing.minSearchStringLength').catch(() => {})
	}
	// sharing disabled → empty
	try {
		await policy({ shareapi_enabled: 'no' })
		r = await alice.searchSharees(b, 'bob')
		t.check(r.status === 200 && deepEq(r.data?.sharees, []) && r.data?.more === false, 'Teilen gesperrt → {sharees: [], more: false}', brief(r))
	} finally {
		await policy({ shareapi_enabled: null })
	}
	// a disabled account is never offered
	try {
		await stack.occ('user:disable', 'carol')
		r = await alice.searchSharees(b, 'carol')
		t.check(r.status === 200 && !(r.data?.sharees || []).some((x) => x.kind === 'user' && x.id === 'carol'), 'deaktivierte carol fehlt', brief(r))
	} finally {
		await stack.occ('user:enable', 'carol').catch(() => {})
	}
	r = await alice.searchSharees(b, 'carol')
	t.check(r.status === 200 && (r.data?.sharees || []).some((x) => x.kind === 'user' && x.id === 'carol' && x.name === 'Carol Clausen'), 'wieder aktiv: carol gefunden', brief(r))
	// last (R13): the 61st search in 60 s → 429
	await limiterReset()
	let first429 = null
	let other = []
	for (let i = 1; i <= 61; i++) {
		r = await alice.searchSharees(b, 'bob')
		if (r.status === 429) { first429 = first429 ?? i; break }
		if (r.status !== 200) other.push(`${i}: ${brief(r)}`)
	}
	t.check(other.length === 0, 'Suchen 1–60 → 200', other.slice(0, 3))
	t.check(first429 === 61 && slowDown(r), '61. Suche in 60 s → 429 slow_down mit retryMs und Retry-After', { first429, body: r.text?.slice(0, 200), retryAfter: r.headers?.['retry-after'] })
	t.check(r.data?.retryMs === 1000, 'retryMs = ceil(60 · 1000 / 60) = 1000 (§4.2 ILimiter)', r.data)
	await limiterReset()
})

await C('C64', 'Abstimm-Link (SPEC-M1 §4.11, R2): Link-Form; Gast über den Abstimm-Link vote, Ops denied; Erneuern trifft nur die eigene Rolle; Konto über den Abstimm-Link vote; edit-Mitglied bleibt edit; vote-Mitglied über den Bearbeitungslink → ersetzt (link_id, edit), mit Passwort nur mit Passwort; nur Besitzer', async (t) => {
	await limiterReset()
	const c = await carolClient()
	const b = await newBoard('C64')
	let r = await bob.postLink(b, {}, 'vote')
	t.check(errIs(r, 404, 'not_found'), 'Fremder: POST votelink → 404', brief(r))
	const LE = await link(b)
	r = await alice.postLink(b, {}, 'vote')
	t.check(r.status === 200 && linkOk(r.data?.link, { role: 'vote' }) && r.data.link.expiresAt === null && r.data.link.expiresOn === null && r.data.link.token !== LE,
		'POST votelink → {link: {token, role vote, url, password false, expiresAt null, expiresOn null}}', brief(r))
	let LV = r.data?.link?.token
	r = await alice.listShares(b)
	t.check(linkOk(r.data?.links?.edit, { token: LE }) && linkOk(r.data?.links?.vote, { token: LV, role: 'vote' }), 'GET shares: links.edit und links.vote', r.data?.links)
	const s0 = await snap(alice, b)
	t.check(linkOk(s0.board?.links?.vote, { token: LV, role: 'vote' }), 'Besitzer-Snapshot: board.links.vote', s0.board?.links)

	// guests per role
	const gv = await guest('Vera', LV)
	t.check(gv.joinAnswer?.me?.role === 'vote' && gv.joinAnswer?.me?.source === 'guest' && gv.joinAnswer?.me?.mod === false, 'Gast über den Abstimm-Link: role vote, source guest', gv.joinAnswer?.me)
	t.check(claimsOf(gv.guestToken).r === 'vote', 'Gast-Token r = vote', claimsOf(gv.guestToken))
	let d = await ops(gv, b, [sticky(ulid())])
	t.check(deepEq(d.acks?.res, ['denied']), 'Abstimm-Gast: Objekt-Op → denied', d.acks)
	const ge = await guest('Eddi', LE)
	r = await alice.postLink(b, { rotate: true }, 'vote')
	t.check(r.status === 200 && r.data?.link?.token !== LV && r.data?.link?.role === 'vote', 'Abstimm-Link erneuern → neuer Token', brief(r))
	LV = r.data?.link?.token
	d = await gv.sync(b, { client: gv.client, since: 0, pres: 0 })
	t.check(errIs(d, 403, 'link_revoked'), 'Abstimm-Gast nach dem Erneuern → 403 link_revoked', brief(d))
	d = await ge.sync(b, { client: ge.client, since: 0, pres: 0 })
	t.check(d.status === 200, 'Bearbeitungs-Gast unberührt → 200', brief(d))
	const gv2 = await guest('Vera2', LV)
	r = await alice.postLink(b, { rotate: true })
	const LE2 = r.data?.link?.token
	t.check(r.status === 200 && LE2 !== LE, 'Bearbeitungslink erneuern → neuer Token', brief(r))
	d = await ge.sync(b, { client: ge.client, since: 0, pres: 0 })
	t.check(errIs(d, 403, 'link_revoked'), 'Bearbeitungs-Gast nach dem Erneuern → 403 link_revoked', brief(d))
	d = await gv2.sync(b, { client: gv2.client, since: 0, pres: 0 })
	t.check(d.status === 200, 'Abstimm-Gast unberührt → 200', brief(d))

	// accounts
	r = await c.joinLink(LV)
	t.check(r.status === 200 && r.data?.boardId === b, 'carol öffnet den Abstimm-Link → 200 {boardId}', brief(r))
	let s = await snap(c, b)
	t.check(s.me?.role === 'vote' && s.me?.source === 'link', 'carol: Mitglied vote, source link', s.me)
	const idE = await linkIdOf(b, 'edit')
	const idV = await linkIdOf(b, 'vote')
	t.check(deepEq(await memberRow(b, 'carol'), { link_id: idV, role: 'vote' }), 'SQL: carol → link_id des Abstimm-Links, role vote', await memberRow(b, 'carol'))
	await member(bob, LE2)
	r = await bob.joinLink(LV)
	t.check(r.status === 200 && r.data?.boardId === b, 'bob (edit-Mitglied) öffnet den Abstimm-Link → 200', brief(r))
	t.check(deepEq(await memberRow(b, 'bob'), { link_id: idE, role: 'edit' }) && (await snap(bob, b)).me?.role === 'edit', 'bob bleibt edit (Mitgliedschaft unverändert)', await memberRow(b, 'bob'))
	r = await bob.postLink(b, {}, 'vote')
	t.check(errIs(r, 403, 'forbidden'), 'Mitglied: POST votelink → 403 forbidden', brief(r))
	r = await bob.deleteLink(b, 'vote')
	t.check(errIs(r, 403, 'forbidden'), 'Mitglied: DELETE votelink → 403 forbidden', brief(r))
	// R2: vote member joins the edit link → replaced
	r = await c.joinLink(LE2)
	t.check(r.status === 200 && r.data?.boardId === b, 'carol (vote-Mitglied) tritt über den Bearbeitungslink bei → 200', brief(r))
	t.check(deepEq(await memberRow(b, 'carol'), { link_id: idE, role: 'edit' }), 'SQL: Mitgliedschaft ersetzt (link_id Bearbeitungslink, role edit)', await memberRow(b, 'carol'))
	s = await snap(c, b)
	t.check(s.me?.role === 'edit' && s.me?.source === 'link', 'carol jetzt edit', s.me)
	// with a password on the edit link: only with the password
	r = await alice.postLink(b, { password: LINK_PW })
	t.check(r.status === 200 && r.data?.link?.password === true, 'Passwort auf den Bearbeitungslink → 200', brief(r))
	t.check(await memberRow(b, 'carol') === null, 'Passwort gesetzt: Mitglieder des Bearbeitungslinks gelöscht', await memberRow(b, 'carol'))
	await member(c, LV)
	t.check((await memberRow(b, 'carol'))?.role === 'vote', 'carol wieder vote-Mitglied')
	r = await c.joinLink(LE2)
	t.check(errIs(r, 403, 'password_required'), 'vote-Mitglied über den Bearbeitungslink ohne Passwort → 403 password_required', brief(r))
	t.check((await memberRow(b, 'carol'))?.role === 'vote', 'Mitgliedschaft unverändert vote')
	r = await c.joinLink(LE2, LINK_PW)
	t.check(r.status === 200 && deepEq(await memberRow(b, 'carol'), { link_id: idE, role: 'edit' }), 'mit Passwort → 200, ersetzt (edit)', brief(r))
	// DELETE votelink
	r = await alice.deleteLink(b, 'vote')
	t.check(r.status === 200 && r.data?.link === null, 'DELETE votelink → {link: null}', brief(r))
	d = await gv2.sync(b, { client: gv2.client, since: 0, pres: 0 })
	t.check(errIs(d, 403, 'link_revoked'), 'Abstimm-Gast nach DELETE → 403 link_revoked', brief(d))
	r = await alice.listShares(b)
	t.check(r.data?.links?.vote === null && r.data?.links?.edit?.token === LE2, 'GET shares: links.vote null, links.edit bleibt', r.data?.links)
})

await C('C65', 'Link-Passwort (SPEC-M1 §4.11.2, §4.11.4, R2/R13): erzwungen → 400 password_enforced; gegen die Richtlinie → 400 password_policy; Beitritt ohne → password_required, falsch → password_wrong, richtig → 200 (Gast und Konto); altes gültiges Token ohne Passwort; Passwort ändern → link_revoked, Mitglieder weg, Neu-Beitritt → password_required; Erneuern behält das Passwort; 21. Fehlversuch → 429 slow_down reason password', async (t) => {
	await limiterReset()
	await stack.bruteforceReset()
	const b = await newBoard('C65')
	// enforced (§4.11.2)
	try {
		await policy({ shareapi_enforce_links_password: 'yes' })
		let r = await alice.postLink(b, {})
		t.check(errIs(r, 400, 'password_enforced'), 'Passwort erzwungen: Link ohne Passwort anlegen → 400 password_enforced', brief(r))
		r = await alice.listShares(b)
		t.check(r.data?.linkPolicy?.passwordEnforced === true, 'GET shares: linkPolicy.passwordEnforced true', r.data?.linkPolicy)
		r = await alice.postLink(b, { password: LINK_PW })
		t.check(r.status === 200 && linkOk(r.data?.link, { password: true }), 'mit Passwort → 200, link.password true', brief(r))
		r = await alice.postLink(b, { password: null })
		t.check(errIs(r, 400, 'password_enforced'), 'Passwort entfernen bei Erzwingung → 400 password_enforced', brief(r))
	} finally {
		await policy({ shareapi_enforce_links_password: null })
	}
	const L = (await alice.listShares(b)).data?.links?.edit?.token
	// policy of the password (password_policy app)
	const apps = occJson(await stack.occ('app:list', '--output=json').catch(() => ''))
	if (apps?.enabled && 'password_policy' in apps.enabled) {
		const r = await alice.postLink(b, { password: 'a' })
		t.check(errIs(r, 400, 'password_policy') && typeof r.data?.message === 'string' && r.data.message.length > 0, 'Passwort gegen die Richtlinie (password_policy) → 400 password_policy mit Hinweis', brief(r))
	} else {
		t.note('App password_policy ist aus: password_policy nicht prüfbar (jedes Passwort gilt, §7.5)')
	}
	// joins with the password
	const n = new Client(env, 'pw', { kind: 'guest' })
	let r = await n.joinGuest(L, 'Paula', { client: clientId() })
	t.check(errIs(r, 403, 'password_required') && !n.guestToken, 'Gast ohne Passwort → 403 password_required', brief(r))
	r = await n.joinGuest(L, 'Paula', { client: clientId(), password: 'falsch-falsch' })
	t.check(errIs(r, 403, 'password_wrong'), 'Gast mit falschem Passwort → 403 password_wrong', brief(r))
	r = await n.joinGuest(L, 'Paula', { client: clientId(), password: LINK_PW })
	t.check(r.status === 200 && !!n.guestToken, 'Gast mit richtigem Passwort → 200', brief(r))
	const pid = r.data?.me?.pid
	n.client = clientId()
	r = await n.joinGuest(L, 'Paula', { client: n.client })
	t.check(r.status === 200 && r.data?.me?.pid === pid, 'altes gültiges Token → Neu-Beitritt ohne Passwort, gleiche pid', brief(r))
	r = await bob.joinLink(L)
	t.check(errIs(r, 403, 'password_required'), 'Konto ohne Passwort → 403 password_required', brief(r))
	r = await bob.joinLink(L, 'falsch-falsch')
	t.check(errIs(r, 403, 'password_wrong'), 'Konto mit falschem Passwort → 403 password_wrong', brief(r))
	r = await bob.joinLink(L, LINK_PW)
	t.check(r.status === 200 && r.data?.boardId === b, 'Konto mit richtigem Passwort → 200', brief(r))
	t.check((await bob.snapshot(b)).status === 200, 'bob ist Mitglied')
	// password changed: tokens and members of this link go
	const idL = await linkIdOf(b, 'edit')
	r = await alice.postLink(b, { password: LINK_PW2 })
	t.check(r.status === 200 && r.data?.link?.token === L && r.data?.link?.password === true, 'Passwort ändern → 200, Token bleibt', brief(r))
	const d = await n.sync(b, { client: n.client, since: 0, pres: 0 })
	t.check(errIs(d, 403, 'link_revoked'), 'Gast-Sync nach der Passwortänderung → 403 link_revoked', brief(d))
	const [cnt] = await stack.sqlRow(`SELECT count(*) FROM oc_knorke_members WHERE link_id = ${idL};`)
	t.check(Number(cnt) === 0, 'Mitglieder dieses Links gelöscht', cnt)
	t.check(errIs(await bob.snapshot(b), 404, 'not_found'), 'bob → 404')
	r = await n.joinGuest(L, 'Paula', { client: n.client })
	t.check(errIs(r, 403, 'password_required'), 'Neu-Beitritt mit altem Link- und Gast-Token ohne Passwort → 403 password_required', brief(r))
	r = await n.joinGuest(L, 'Paula', { client: n.client, password: LINK_PW2 })
	t.check(r.status === 200, 'mit dem neuen Passwort → 200', brief(r))
	// rotating a link with a password keeps the password (R2)
	r = await alice.postLink(b, { rotate: true })
	const L2 = r.data?.link?.token
	t.check(r.status === 200 && L2 && L2 !== L && r.data?.link?.password === true, 'Erneuern → neuer Token, password true (übernommen)', brief(r))
	r = await new Client(env, 'pw2', { kind: 'guest' }).joinGuest(L2, 'Pia', { client: clientId() })
	t.check(errIs(r, 403, 'password_required'), 'neuer Token ohne Passwort → 403 password_required', brief(r))
	r = await new Client(env, 'pw3', { kind: 'guest' }).joinGuest(L2, 'Pia', { client: clientId(), password: LINK_PW2 })
	t.check(r.status === 200, 'neuer Token mit dem bisherigen Passwort → 200', brief(r))
	// 21st wrong password → 429 slow_down reason password (own link, counter per link and net)
	const bx = await newBoard('C65-Sperre')
	let rx = await alice.postLink(bx, { password: LINK_PW })
	const LX = rx.data?.link?.token
	// do not straddle the 10-minute window of the counter (pwf:<link>:<net>:<floor(now/600000)>)
	const left = 600000 - (Date.now() % 600000)
	if (left < 45000) await sleep(left + 500)
	try {
		const wrong = []
		for (let i = 1; i <= 20; i++) {
			rx = await new Client(env, `x${i}`, { kind: 'guest' }).joinGuest(LX, 'Xaver', { client: clientId(), password: `falsch-${i}-xxxx` })
			if (!errIs(rx, 403, 'password_wrong')) wrong.push(`${i}: ${brief(rx)}`)
		}
		t.check(wrong.length === 0, 'Fehlversuche 1–20 → je 403 password_wrong', wrong.slice(0, 3))
		rx = await new Client(env, 'x21', { kind: 'guest' }).joinGuest(LX, 'Xaver', { client: clientId(), password: 'falsch-21-xxxx' })
		t.check(slowDown(rx) && rx.data?.reason === 'password', '21. Fehlversuch → 429 slow_down mit reason password (R13), retryMs, Retry-After', { status: rx.status, body: rx.text?.slice(0, 200), retryAfter: rx.headers?.['retry-after'] })
		t.check(Number.isInteger(rx.data?.retryMs) && rx.data.retryMs <= 600000, 'retryMs bis zum Fensterende (≤ 10 min)', rx.data)
		rx = await new Client(env, 'x22', { kind: 'guest' }).joinGuest(LX, 'Xaver', { client: clientId(), password: LINK_PW })
		t.check(slowDown(rx) && rx.data?.reason === 'password', 'gesperrt: auch das richtige Passwort → 429 (ohne Prüfung)', brief(rx))
		rx = await bob.joinLink(LX, LINK_PW)
		t.check(slowDown(rx) && rx.data?.reason === 'password', 'gesperrt: auch der Konto-Beitritt → 429 reason password', brief(rx))
		rx = await new Client(env, 'y1', { kind: 'guest' }).joinGuest(L2, 'Yvo', { client: clientId(), password: LINK_PW2 })
		t.check(rx.status === 200, 'ein anderer Link desselben Netzes ist nicht gesperrt (Zähler je Link)', brief(rx))
	} finally {
		await stack.redisDel(rkey('pwf:*')).catch(() => {})
		await stack.bruteforceReset().catch(() => {})
	}
})

await C('C66', 'Link-Ablauf (SPEC-M1 §4.11.2, §4.11.4, R2/R13): Kalendertag in der Zone des Besitzers (default_timezone); gestern → expiry_past; ms-Zahl → bad_request; erzwungen 7 Tage: +8 → expiry_too_far (maxDays 7), Vorgabe heute + 7, null → expiry_required; abgelaufen (SQL) → /p expired, Beitritt link_expired ohne Fehlversuch; POST ohne rotate/Erneuern eines abgelaufenen Links → neu, Mitglieder weg; Ablauf verkürzt → link_revoked, Neu-Beitritt mit neuem exp, Mitglieder bleiben; Grant endet mit dem Ablauf', async (t) => {
	await limiterReset()
	await stack.bruteforceReset()
	const tz = await ownerZone()
	const today = dayIn(Date.now(), tz)
	t.note(`Zone des Besitzers: ${tz} (occ default_timezone, Harness-Konten ohne eigene Zone), heute ${today}`)
	const b = await newBoard('C66')
	// R14-04: route 19 (owner, no stored zone) carries linkPolicy.today = today in default_timezone; the snapshot's linkPolicy has no today
	let r = await alice.listShares(b)
	t.check(r.status === 200 && r.data?.linkPolicy?.today === today, `Route 19 (Besitzer): linkPolicy.today = heute in ${tz} (${today})`, r.data?.linkPolicy)
	const sn = await snap(alice, b)
	t.check(isObj(sn.board?.linkPolicy) && !('today' in sn.board.linkPolicy), 'Snapshot: board.linkPolicy ohne today', sn.board?.linkPolicy)
	r = await alice.postLink(b, { expiresAt: addDays(today, -1) })
	t.check(errIs(r, 400, 'expiry_past'), 'expiresAt gestern → 400 expiry_past', brief(r))
	r = await alice.postLink(b, { expiresAt: Date.now() + 86400000 })
	t.check(errIs(r, 400, 'bad_request'), 'expiresAt als ms-Zahl → 400 bad_request (nur "YYYY-MM-DD")', brief(r))
	const day3 = addDays(today, 3)
	r = await alice.postLink(b, { expiresAt: day3 })
	t.check(r.status === 200 && linkOk(r.data?.link) && r.data.link.expiresOn === day3 && r.data.link.expiresAt === endOfDayMs(day3, tz),
		`expiresAt "${day3}" → expiresOn gleich, expiresAt = Tagesende (23:59:59.999, ${tz})`, { link: r.data?.link, want: endOfDayMs(day3, tz) })
	const L = r.data?.link?.token
	const [stored] = await stack.sqlRow(`SELECT expires_at FROM oc_knorke_links WHERE board_id = ${b} AND revoked_at IS NULL;`)
	t.check(Number(stored) === endOfDayMs(day3, tz), 'SQL expires_at = Tagesende', stored)
	const g1 = await guest('Gina', L)
	const exp1 = claimsOf(g1.guestToken).exp
	t.check(Number.isInteger(exp1) && exp1 <= Math.floor(endOfDayMs(day3, tz) / 1000) && exp1 === g1.joinAnswer?.guest?.exp, 'Gast-Token exp ≤ expires_at / 1000', { exp1, max: Math.floor(endOfDayMs(day3, tz) / 1000) })

	// enforced with 7 days (and the default without enforcement, R13 SRV-05)
	const be = await newBoard('C66-erzwungen')
	try {
		await policy({ shareapi_default_expire_date: 'yes', shareapi_expire_after_n_days: '5' })
		r = await alice.listShares(be)
		t.check(deepEq(r.data?.linkPolicy, { passwordEnforced: false, expireDefaultDays: 5, expireEnforced: false, expireMaxDays: null, today }), 'Vorgabe 5 Tage ohne Erzwingung: linkPolicy {expireDefaultDays 5, expireEnforced false, expireMaxDays null, today}', r.data?.linkPolicy)
		r = await alice.postLink(be, {})
		t.check(r.status === 200 && r.data?.link?.expiresOn === addDays(today, 5), 'Anlegen ohne Angabe → Ablauf heute + 5 (Vorgabe)', brief(r))
		await alice.deleteLink(be)
		await policy({ shareapi_enforce_expire_date: 'yes', shareapi_expire_after_n_days: '7' })
		r = await alice.listShares(be)
		t.check(deepEq(r.data?.linkPolicy, { passwordEnforced: false, expireDefaultDays: 7, expireEnforced: true, expireMaxDays: 7, today }), 'erzwungen 7 Tage: linkPolicy {expireDefaultDays 7, expireEnforced true, expireMaxDays 7, today}', r.data?.linkPolicy)
		r = await alice.postLink(be, { expiresAt: addDays(today, 8) })
		t.check(errIs(r, 400, 'expiry_too_far') && r.data?.maxDays === 7, 'erzwungen: heute + 8 → 400 expiry_too_far mit maxDays 7', brief(r))
		r = await alice.postLink(be, {})
		t.check(r.status === 200 && r.data?.link?.expiresOn === addDays(today, 7), 'erzwungen: Anlegen ohne Angabe → heute + 7', brief(r))
		r = await alice.postLink(be, { expiresAt: null })
		t.check(errIs(r, 400, 'expiry_required'), 'erzwungen: Ablauf entfernen → 400 expiry_required', brief(r))
		r = await alice.postLink(be, { expiresAt: addDays(today, 7) })
		t.check(r.status === 200 && r.data?.link?.expiresOn === addDays(today, 7), 'erzwungen: heute + 7 → 200', brief(r))
	} finally {
		await policy({ shareapi_default_expire_date: null, shareapi_enforce_expire_date: null, shareapi_expire_after_n_days: null })
	}

	// expired link (SQL into the past)
	const bx = await newBoard('C66-abgelaufen')
	const LX = await link(bx)
	await member(bob, LX)
	const gx = await guest('Greta', LX)
	await stack.sql(`UPDATE oc_knorke_links SET expires_at = ${Date.now() - 60000} WHERE board_id = ${bx} AND revoked_at IS NULL;`)
	await dropGens(bx)
	const att0 = await stack.bruteforceAttempts()
	const p = await new Client(env, 'p').publicPage(LX)
	t.check(p.status === 200 && p.state.linkState === 'expired' && p.state.linkInfo === null, '/p → linkState expired, linkInfo null', { status: p.status, state: p.state })
	r = await new Client(env, 'neu', { kind: 'guest' }).joinGuest(LX, 'Neu', { client: clientId() })
	t.check(errIs(r, 403, 'link_expired'), 'neuer Gast → 403 link_expired', brief(r))
	r = await gx.joinGuest(LX, 'Greta', { client: gx.client })
	t.check(errIs(r, 403, 'link_expired'), 'Gast mit altem Token → 403 link_expired', brief(r))
	r = await bob.joinLink(LX)
	t.check(errIs(r, 403, 'link_expired'), 'Konto-Beitritt → 403 link_expired', brief(r))
	t.check(errIs(await bob.snapshot(bx), 404, 'not_found'), 'Link-Mitglied → 404 (Mitgliedschaft nur bei gültigem Link)')
	t.check(await stack.bruteforceAttempts() === att0, 'kein Fehlversuch gezählt (oc_bruteforce_attempts unverändert)')
	r = await alice.listShares(bx)
	t.check(r.data?.links?.edit?.token === LX && typeof r.data?.links?.edit?.expiresOn === 'string' && r.data.links.edit.expiresOn <= today && r.data.links.edit.expiresAt < Date.now(),
		'Besitzer sieht den abgelaufenen Link (nicht widerrufen) mit Ablauf in der Vergangenheit', r.data?.links?.edit)
	// POST without rotate on an expired link = renewal (R2), old members gone
	r = await alice.postLink(bx, {})
	const LX2 = r.data?.link?.token
	t.check(r.status === 200 && LX2 && LX2 !== LX && r.data.link.expiresAt === null, 'POST ohne rotate auf abgelaufenen Link → neuer Token, ohne Ablauf (Anlege-Vorgaben)', brief(r))
	const [mc] = await stack.sqlRow(`SELECT count(*) FROM oc_knorke_members WHERE board_id = ${bx};`)
	t.check(Number(mc) === 0, 'alte Mitglieder weg', mc)
	t.check(errIs(await bob.joinLink(LX), 403, 'link_revoked'), 'alter Token jetzt link_revoked')
	// rotate an expired link: the new one is not expired already
	await stack.sql(`UPDATE oc_knorke_links SET expires_at = ${Date.now() - 60000} WHERE board_id = ${bx} AND revoked_at IS NULL;`)
	r = await alice.postLink(bx, { rotate: true })
	t.check(r.status === 200 && r.data?.link?.token !== LX2 && (r.data?.link?.expiresAt === null || r.data.link.expiresAt > Date.now()), 'Erneuern eines abgelaufenen Links → neuer Link, nicht schon abgelaufen', brief(r))

	// expiry shortened: guest tokens go (generation), members stay
	const bk = await newBoard('C66-verkuerzt')
	r = await alice.postLink(bk, { expiresAt: addDays(today, 5) })
	const LK = r.data?.link?.token
	await member(bob, LK)
	const gk = await guest('Kira', LK)
	const day2 = addDays(today, 2)
	r = await alice.postLink(bk, { expiresAt: day2 })
	t.check(r.status === 200 && r.data?.link?.token === LK && r.data.link.expiresOn === day2, 'Ablauf früher → 200, Token bleibt', brief(r))
	let d = await gk.sync(bk, { client: gk.client, since: 0, pres: 0 })
	t.check(errIs(d, 403, 'link_revoked'), 'Gast-Token nach der Verkürzung → 403 link_revoked', brief(d))
	r = await gk.joinGuest(LK, 'Kira', { client: gk.client })
	t.check(r.status === 200 && r.data?.guest?.exp <= Math.floor(endOfDayMs(day2, tz) / 1000), 'Neu-Beitritt ohne Passwort → 200 mit neuem exp ≤ neuem Ablauf', brief(r))
	t.check((await bob.snapshot(bk)).status === 200, 'Mitglieder bleiben (bob → 200)')

	// a link member's grant ends with the expiry (R13: snapshot after the SQL)
	const bg = await newBoard('C66-Grant')
	const LG = await link(bg)
	await member(bob, LG)
	await stack.sql(`UPDATE oc_knorke_links SET expires_at = ${Date.now() + 3000} WHERE board_id = ${bg} AND revoked_at IS NULL;`)
	const sg = await bob.snapshot(bg)
	t.check(sg.status === 200, 'Link-Mitglied: Snapshot (Grant mit TTL ≈ 3 s)', brief(sg))
	const grants = await grantsOf(bg)
	t.check(grants.some((x) => /^\d+\|edit\|l$/.test(x.v) && x.ttl >= 1 && x.ttl <= 4), 'Grant "<acl>|edit|l" mit TTL ≤ Restlaufzeit (≈ 3 s, §4.11.4)', grants)
	await sleep(4000)
	d = await bob.sync(bg, { client: bob.client, since: sg.data?.rev ?? 0, pres: 0 })
	t.check(errIs(d, 404, 'not_found'), 'nach 4 s: Sync → 404 (Grant mit dem Link abgelaufen)', brief(d))
	await stack.bruteforceReset().catch(() => {})
})

await C('C67', 'Fastpath mit Freigaben (SPEC-M1 §4.13.1): Freigabe-Nutzer, Links instanzweit aus: nach Aufwärmen 20 leere Syncs → 0 oc_knorke_-Aufrufe', async (t) => {
	await limiterReset()
	const b = await newBoard('C67')
	await ops(alice, b, [sticky(ulid())])
	await saveOk(alice, b, [u('bob', 'edit')])
	try {
		await setLinksAllowed(false)
		await dropGens(b)
		const s = await snap(bob, b)
		const rev = s.rev
		const w = await rawSync(bob, b, { since: rev, pres: 1 })
		t.check(w.status === 200 && s.me?.source === 'share', 'Aufwärmen: Snapshot + ein leerer Sync (source share)', brief(w))
		await stack.pgssReset()
		let bad = 0
		for (let i = 0; i < 20; i++) {
			const r = await rawSync(bob, b, { since: rev, pres: 1, me: { c: [i, i], s: [], d: [], e: null } })
			if (r.status !== 200 || r.data?.rev !== rev || r.data?.items) bad++
			await sleep(260)
		}
		const pg = await stack.pgssCount()
		t.check(bad === 0, '20 leere Syncs fehlerfrei, rev unverändert', bad)
		t.check(pg && Number(pg.total) === 0, '0 Aufrufe von Statements mit oc_knorke_ (Grant s gilt ohne links-Bit)', pg)
	} finally {
		await setLinksAllowed(true)
		await dropGens(b)
	}
}, { skipIf: PG_ONLY })

await C('C68', 'Board-Liste und Teams (SPEC-M1 §4.10.4, §4.13.1, R13): source/role/mod je Herkunft; Gruppenmitglied sieht das Board, Nicht-Mitglied nicht (Snapshot 404); Team: Mitglied (auch über eine Gruppe im Team) sieht es, Nicht-Mitglied 404; Circles aus → Team-Freigabe gewährt nichts (Snapshot 404, Liste ohne Board), GET available false', async (t) => {
	await limiterReset()
	const c = await carolClient()
	const [u1, u2, u3] = await tempUsers('cv', 3)
	let tg = null
	let team = null
	try {
		// by origin, at bob
		const bo = await newBoardOf(bob, 'C68-bob-eigen')
		const bA = await newBoard('C68-share-view')
		const bB = await newBoard('C68-link')
		const bC = await newBoard('C68-moderate')
		const bD = await newBoard('C68-link+view')
		await saveOk(alice, bA, [u('bob', 'view')])
		await member(bob, await link(bB))
		await saveOk(alice, bC, [u('bob', 'moderate')])
		await saveOk(alice, bD, [u('bob', 'view')])
		await member(bob, await link(bD))
		let r = await bob.listBoards()
		const row = (id) => listed(r, id)
		const pick = (x) => (x ? { source: x.source, role: x.role, mod: x.mod, viaLink: x.viaLink } : null)
		t.check(deepEq(pick(row(bo)), { source: 'own', role: 'owner', mod: true, viaLink: false }), 'eigenes Board: own, owner, mod true', row(bo))
		t.check(deepEq(pick(row(bA)), { source: 'share', role: 'view', mod: false, viaLink: false }), 'Freigabe view: share, view, mod false', row(bA))
		t.check(deepEq(pick(row(bB)), { source: 'link', role: 'edit', mod: false, viaLink: true }), 'Link: link, edit, viaLink', row(bB))
		t.check(deepEq(pick(row(bC)), { source: 'share', role: 'edit', mod: true, viaLink: false }), 'Freigabe moderate: share, edit, mod true', row(bC))
		t.check(deepEq(pick(row(bD)), { source: 'link', role: 'edit', mod: false, viaLink: true }), 'Link edit + Freigabe view: link, edit (Maximum)', row(bD))

		// group: member sees it, non-member does not
		const bG = await newBoard('C68-Gruppe')
		await saveOk(alice, bG, [g(HGROUP, 'view')])
		r = await c.listBoards()
		t.check(deepEq(pick(listed(r, bG)), { source: 'share', role: 'view', mod: false, viaLink: false }), 'Gruppenmitglied carol: Board in der Liste (share, view)', listed(r, bG))
		const v1 = await new Client(env, u1).login(u1)
		r = await v1.listBoards()
		t.check(r.status === 200 && !listed(r, bG), 'Nicht-Mitglied: Board fehlt in der Liste', (r.data?.boards || []).map((x) => x.id))
		t.check(errIs(await v1.snapshot(bG), 404, 'not_found'), 'Nicht-Mitglied: Snapshot 404 (kein Besitz-Orakel)')

		// teams (Circles)
		if (!(await circlesEnabled())) {
			t.note('Circles ist in diesem Image nicht aktiv: Team-Teil übersprungen (§8.3 skipIf)')
			return
		}
		const name = `${HARNESS_TEAM_PREFIX}c68${randTok().slice(0, 6).toLowerCase()}`
		const created = occJson(await stack.occ('circles:manage:create', '--type', 'user', '--output=json', 'alice', name))
		team = created?.id
		if (!t.check(/^[A-Za-z0-9]{31}$/.test(team || ''), `Team ${name} angelegt (Besitzerin alice), singleId`, created)) return
		await stack.occ('circles:members:add', team, 'carol', '--type', 'user')
		tg = await tempGroup('knorke-c68')
		await stack.occ('group:adduser', tg, u2)
		await stack.occ('circles:members:add', team, tg, '--type', 'group')
		const bT = await newBoard('C68-Team')
		r = await alice.saveShares(bT, [tm(team, 'view')])
		t.check(r.status === 200 && deepEq(shareKeys(r), [`team:${team}:view`]), 'PUT [team view] → 200', brief(r))
		const te = r.data?.shares?.[0]
		t.check(te?.name === name && te?.available === true, 'Team-Eintrag: name, available true', te)
		r = await c.listBoards()
		t.check(deepEq(pick(listed(r, bT)), { source: 'share', role: 'view', mod: false, viaLink: false }), 'Team-Mitglied carol: Board in der Liste (share, view)', listed(r, bT))
		t.check((await c.snapshot(bT)).status === 200, 'Team-Mitglied carol: Snapshot 200')
		const v2 = await new Client(env, u2).login(u2)
		r = await v2.listBoards()
		t.check(!!listed(r, bT), 'Mitglied über eine Gruppe im Team: Board in der Liste', (r.data?.boards || []).map((x) => x.id))
		t.check((await v2.snapshot(bT)).status === 200, 'Mitglied über eine Gruppe im Team: Snapshot 200')
		const v3 = await new Client(env, u3).login(u3)
		r = await v3.listBoards()
		t.check(r.status === 200 && !listed(r, bT), 'Nicht-Mitglied des Teams: Board fehlt in der Liste')
		t.check(errIs(await v3.snapshot(bT), 404, 'not_found'), 'Nicht-Mitglied des Teams: Snapshot 404')
		// Circles off: the team share grants nothing (snapshot and list; the fast path may grant ≤ 120 s, §7.7)
		try {
			await circles(false)
			t.check(errIs(await c.snapshot(bT), 404, 'not_found'), 'Circles aus: carol Snapshot 404 (Team-Freigabe gewährt nichts)')
			r = await c.listBoards()
			t.check(r.status === 200 && !listed(r, bT), 'Circles aus: Board fehlt in carols Liste')
			r = await alice.listShares(bT)
			const off = (r.data?.shares || []).find((x) => x.kind === 'team' && x.id === team)
			t.check(off && off.available === false, 'Circles aus: GET shares zeigt die Team-Freigabe mit available false', r.data?.shares)
		} finally {
			await circles(true)
		}
		t.check((await c.snapshot(bT)).status === 200, 'Circles wieder an: carol Snapshot 200')
	} finally {
		if (team) await stack.occ('circles:manage:destroy', team).catch(() => {})
		if (tg) await stack.occ('group:delete', tg).catch(() => {})
		await dropUsers([u1, u2, u3])
	}
})

// ── SPEC-M1 stage 3 (§8.3, Revision 16): moderation – voting sessions, the vote op, secrecy, expiry, timer, summon, presence v ──

/** The session config of §4.12.1 with its defaults, changed by `over`. */
const voteCfg = (over = {}) => ({ per: 5, perItem: 1, scope: null, types: ['sticky'], minutes: null, ...over })
/** The answer of routes 22–26 (§4.12): {board: {title, meta, metaRev}, now}. */
const modOk = (r) => r.status === 200 && isObj(r.data?.board) && typeof r.data.board.title === 'string' && isObj(r.data.board.meta)
	&& Number.isInteger(r.data.board.metaRev) && Number.isInteger(r.data.now)
/** The keys a votes block may carry (§4.5; R2: never tally). */
const VOTES_KEYS = ['left', 'mine', 'sid', 'voters', 'vt']
/**
 * A votes block in the R16 shape (§4.5): sid always set, mine an object of
 * item → n ≥ 1 (empty as {}, never []), left and vt integers, nothing else.
 */
function votesShape(v) {
	if (!isObj(v) || !Number.isInteger(v.sid) || v.sid < 1) return false
	if (Object.keys(v).some((k) => !VOTES_KEYS.includes(k))) return false
	if ('mine' in v && (!isObj(v.mine) || Object.entries(v.mine).some(([id, n]) => !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || !Number.isInteger(n) || n < 1))) return false
	for (const k of ['left', 'voters', 'vt']) if (k in v && (!Number.isInteger(v[k]) || v[k] < 0)) return false
	return true
}
/** Same plain object regardless of key order. */
const sameObj = (a, b) => isObj(a) && isObj(b) && deepEq(Object.entries(a).sort(), Object.entries(b).sort())
/** The fields of a public presence entry (§5.5: M0 plus v). */
const PRESENCE_FIELDS = ['d', 'e', 'g', 'h', 'k', 'n', 's', 'v', 'x', 'y']
/** One vote op (§4.6). */
const vote = (s, id, n) => ({ o: 'vote', s, id, n })
/** A sync with ops and a fresh seq; raw (never throws). */
function voteSync(c, b, list, extra = {}) {
	return rawSync(c, b, { ops: list, seq: ++seqN, ...extra })
}
/** Starts a session as `c` (setup); returns the answer's meta.vote. */
async function startOk(c, b, cfg) {
	const r = await c.startVote(b, cfg)
	if (!modOk(r) || r.data.board.meta.vote?.state !== 'open') throw new Error(`Abstimmung starten (${c.name}, Board ${b}): ${brief(r)}`)
	return r.data.board.meta.vote
}
/** The vote link of a board (route 17, setup); returns its token. */
async function voteLink(b) {
	const r = await alice.postLink(b, {}, 'vote')
	if (r.status !== 200 || !r.data?.link?.token) throw new Error(`Abstimm-Link ${b}: ${brief(r)}`)
	return r.data.link.token
}
/** A value of vt:<b> as stored ("<sid>:<seq>", FastCache JSON-encodes strings): the plain string. */
function vtValue(raw) {
	try {
		const v = JSON.parse(raw)
		return typeof v === 'string' ? v : String(v)
	} catch {
		return String(raw)
	}
}
/** Display name of a harness account (env.json .users), e.g. carol → "Carol Clausen". */
const nameOf = (uid) => env.users?.[uid] ?? uid

await C('C69', 'Sitzungs-Lebenszyklus (SPEC-M1 §4.12, §4.12.1, R2/R16): Link-Bearbeiter 403, Fremde 404; Start → meta.vote open beim nächsten Sync aller; zweiter Start 409 vote_open; clear auf offener 409; Codes (vote_config, bad_request); extend; end → results/total/voters in meta, Stimmzeilen gelöscht; show/hide (No-op ohne Schreiben); clear → meta.vote weg; show/hide/clear ohne meta.vote 409; extend bzw. Start auf abgelaufener offener Sitzung → geschlossen + 409; Gruppe edit 403, Gruppe moderate 200; Antworten mit board.title', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C69')
	const L = await link(b)
	await member(bob, L)
	const gi = await guest('Gina', L)
	const [N1, N2] = [ulid(), ulid()]
	await ops(alice, b, [sticky(N1), sticky(N2, { x: 300 })])
	const rev0 = await revOf(alice, b)

	// rights: a link editor is no moderator (§4.9), a stranger gets 404
	let r = await bob.startVote(b, voteCfg())
	t.check(errIs(r, 403, 'forbidden'), 'Link-Bearbeiter (bob, kein Moderator): Start → 403 forbidden', brief(r))
	r = await bob.updateVote(b, { action: 'end' })
	t.check(errIs(r, 403, 'forbidden'), 'Link-Bearbeiter: PATCH vote → 403 forbidden', brief(r))
	const c = await carolClient()
	r = await c.startVote(b, voteCfg())
	t.check(errIs(r, 404, 'not_found'), 'Fremde (carol, keine Rolle): Start → 404 not_found (kein Besitz-Orakel)', brief(r))

	// start
	r = await alice.startVote(b, voteCfg({ per: 3, minutes: 10 }))
	const v = r.data?.board?.meta?.vote
	t.check(modOk(r) && r.data.board.title === 'C69', 'Start → 200 {board: {title, meta, metaRev}, now}, board.title = C69', brief(r))
	t.check(isObj(v) && v.state === 'open' && Number.isInteger(v.sid) && deepEq(v.cfg, { per: 3, perItem: 1, scope: null, types: ['sticky'] }) && v.show === false && v.by === 'Alice Adler',
		'meta.vote = {sid, state open, cfg, show false, by = Anzeigename}', v)
	t.check(isObj(v) && Number.isInteger(v.startedAt) && Math.abs(v.startedAt - r.data.now) <= 1000 && Number.isInteger(v.endsAt) && Math.abs(v.endsAt - v.startedAt - 600000) <= 1000,
		'startedAt ≈ now, endsAt = now + 10 min', v && { startedAt: v.startedAt, endsAt: v.endsAt, now: r.data.now })
	t.check(isObj(v) && !('results' in v) && !('total' in v) && !('voters' in v), 'offene Sitzung: kein results/total/voters in meta (§7.2)', v)
	const sid = v?.sid
	let rows = await stack.voteSessions(b)
	t.check(rows.length === 1 && rows[0].id === sid && rows[0].state === 'open' && rows[0].ends_at === v?.endsAt, 'SQL: eine offene Sitzung, id = sid, ends_at = endsAt', rows)
	for (const [who, cl] of [['bob', bob], ['Gina (Gast)', gi]]) {
		const s = await rawSync(cl, b, { since: rev0 })
		t.check(s.status === 200 && s.data?.board?.meta?.vote?.state === 'open' && s.data.board.meta.vote.sid === sid, `${who}: der nächste Sync trägt board.meta.vote (open, sid)`, brief(s))
	}
	r = await alice.startVote(b, voteCfg())
	t.check(errIs(r, 409, 'vote_open'), 'zweiter Start → 409 vote_open', brief(r))
	r = await alice.updateVote(b, { action: 'clear' })
	t.check(errIs(r, 409, 'vote_closed'), 'clear auf offener Sitzung → 409 vote_closed', brief(r))
	// codes of route 23 (R16 §4.12)
	r = await alice.updateVote(b, { action: 'extend' })
	t.check(errIs(r, 400, 'vote_config'), 'extend ohne minutes → 400 vote_config (R16)', brief(r))
	r = await alice.updateVote(b, { action: 'extend', minutes: 1441 })
	t.check(errIs(r, 400, 'vote_config'), 'extend mit 1441 min (> VOTE_MINUTES_MAX) → 400 vote_config', brief(r))
	r = await alice.updateVote(b, { action: 'pause' })
	t.check(errIs(r, 400, 'bad_request'), 'unbekannte action → 400 bad_request (R16)', brief(r))
	r = await alice.updateVote(b, {})
	t.check(errIs(r, 400, 'bad_request'), 'fehlende action → 400 bad_request (R16)', brief(r))
	// extend
	r = await alice.updateVote(b, { action: 'extend', minutes: 5 })
	t.check(modOk(r) && r.data.board.meta.vote?.state === 'open' && r.data.board.meta.vote.endsAt === v.endsAt + 300000, 'extend 5 → endsAt + 5 min (offene Sitzung, ends_at > now)', r.data?.board?.meta?.vote)
	// two voters, then end
	const rb = await voteSync(bob, b, [vote(sid, N1, 1)], { since: rev0 })
	const rg = await voteSync(gi, b, [vote(sid, N2, 1)], { since: rev0 })
	t.check(deepEq(rb.data?.acks?.res, ['ok']) && deepEq(rg.data?.acks?.res, ['ok']), 'bob und Gina stimmen ab → ok, ok', [brief(rb), brief(rg)])
	t.check((await stack.voteRowCount(sid)) === 2, 'SQL: zwei Stimmzeilen, solange die Sitzung offen ist')
	r = await alice.updateVote(b, { action: 'end' })
	const ve = r.data?.board?.meta?.vote
	const want = [[N1, 1], [N2, 1]].sort((x, y) => (x[0] < y[0] ? -1 : 1))
	t.check(modOk(r) && ve?.state === 'closed' && ve.sid === sid && deepEq(ve.results, want) && ve.total === 2 && ve.voters === 2 && Number.isInteger(ve.closedAt),
		'end → meta.vote closed: results (absteigend nach n, dann id), total 2, voters 2, closedAt', ve)
	rows = await stack.voteSessions(b)
	t.check(rows[0]?.state === 'closed' && rows[0].voters === 2 && Number.isInteger(rows[0].closed_at), 'SQL: Sitzung closed, voters 2, closed_at gesetzt', rows)
	t.check((await stack.voteRowCount(sid)) === 0, 'SQL: Stimmzeilen beim Schließen gelöscht (§3.7, §7.2)')
	r = await alice.updateVote(b, { action: 'end' })
	t.check(errIs(r, 409, 'vote_closed'), 'end auf geschlossener Sitzung → 409 vote_closed', brief(r))
	r = await alice.updateVote(b, { action: 'extend', minutes: 5 })
	t.check(errIs(r, 409, 'vote_closed'), 'extend auf geschlossener Sitzung → 409 vote_closed', brief(r))
	// show / hide (no-op without a write, R16)
	r = await alice.updateVote(b, { action: 'show' })
	const m1 = r.data?.board?.metaRev
	t.check(modOk(r) && r.data.board.meta.vote?.show === true, 'show → meta.vote.show true', r.data?.board?.meta?.vote)
	r = await alice.updateVote(b, { action: 'show' })
	t.check(modOk(r) && r.data.board.metaRev === m1 && r.data.board.meta.vote?.show === true, 'show bei show = true → 200 ohne Schreiben (gleicher metaRev, R16)', r.data?.board)
	r = await alice.updateVote(b, { action: 'hide' })
	t.check(modOk(r) && r.data.board.meta.vote?.show === false && r.data.board.metaRev > m1, 'hide → show false (neuer metaRev)', r.data?.board)
	// clear
	r = await alice.updateVote(b, { action: 'clear' })
	t.check(modOk(r) && !('vote' in r.data.board.meta), 'clear auf geschlossener Sitzung → meta.vote weg', r.data?.board?.meta)
	t.check((await stack.voteSessions(b)).length === 1, 'SQL: die Sitzungszeile bleibt nach clear')
	for (const action of ['show', 'hide', 'clear']) {
		r = await alice.updateVote(b, { action })
		t.check(errIs(r, 409, 'vote_closed'), `${action} ohne meta.vote → 409 vote_closed (R16)`, brief(r))
	}

	// expired, not closed yet (Stack.voteExpire): extend closes it and answers 409 (R2, R16: the close is committed first)
	const v2 = await startOk(alice, b, voteCfg({ minutes: 10 }))
	await voteSync(gi, b, [vote(v2.sid, N1, 1)], { since: rev0 })
	const ex = await stack.voteExpire(b)
	t.check(ex.sid === v2.sid && ex.endsAt === ex.now - 1, 'Stack.voteExpire: offene Sitzung, ends_at = jetzt − 1 ms', ex)
	r = await alice.updateVote(b, { action: 'extend', minutes: 5 })
	t.check(errIs(r, 409, 'vote_closed'), 'extend auf abgelaufener offener Sitzung → 409 vote_closed', brief(r))
	rows = await stack.voteSessions(b)
	t.check(rows.find((x) => x.id === v2.sid)?.state === 'closed', 'SQL: dabei geschlossen (vor der 409 committet, R16)', rows)
	let sn = await snap(alice, b)
	t.check(sn.board?.meta?.vote?.state === 'closed' && sn.board.meta.vote.sid === v2.sid && deepEq(sn.board.meta.vote.results, [[N1, 1]]), 'Snapshot: meta.vote closed mit results [[N1, 1]]', sn.board?.meta?.vote)
	// start while an open session has expired: close (committed), then 409 vote_open (R16)
	const v3 = await startOk(alice, b, voteCfg({ minutes: 10 }))
	await stack.voteExpire(b)
	r = await alice.startVote(b, voteCfg())
	t.check(errIs(r, 409, 'vote_open'), 'Start während einer abgelaufenen offenen Sitzung → 409 vote_open (R16)', brief(r))
	sn = await snap(alice, b)
	t.check(sn.board?.meta?.vote?.state === 'closed' && sn.board.meta.vote.sid === v3.sid && Array.isArray(sn.board.meta.vote.results), '… die Sitzung ist danach geschlossen, Ergebnisse in meta', sn.board?.meta?.vote)

	// config errors and the group rule (R2): edit through a group → 403, moderate through a group → 200
	const b2 = await newBoard('C69-Gruppe')
	const S = ulid()
	await ops(alice, b2, [sticky(S)])
	for (const [cfg, what] of [
		[{ per: 0 }, 'per 0'], [{ per: 100 }, 'per 100 (> VOTE_PER_MAX)'], [{ per: 3, perItem: 4 }, 'perItem > per'], [{ perItem: 0 }, 'perItem 0'],
		[{ types: [] }, 'types leer'], [{ types: ['frame'] }, 'types frame (nicht abstimmbar)'], [{ scope: S }, 'scope = Notiz (kein Frame)'],
		[{ scope: ulid() }, 'scope = nie existierender Frame'], [{ minutes: 0 }, 'minutes 0'], [{ minutes: 1441 }, 'minutes 1441'],
	]) {
		r = await alice.startVote(b2, voteCfg(cfg))
		t.check(errIs(r, 400, 'vote_config'), `Start mit ${what} → 400 vote_config`, brief(r))
	}
	t.check((await stack.voteSessions(b2)).length === 0, 'SQL: keine Sitzung nach den 400ern')
	await saveOk(alice, b2, [g(HGROUP, 'edit')])
	for (const [what, call] of [
		['Start', () => c.startVote(b2, voteCfg())],
		['Timer', () => c.timer(b2, { action: 'start', ms: 60000 })],
		['Summon', () => c.summon(b2, { client: c.client })],
	]) {
		r = await call()
		t.check(errIs(r, 403, 'forbidden'), `Mitglied der Gruppe mit edit (carol): ${what} → 403 forbidden (R2)`, brief(r))
	}
	await saveOk(alice, b2, [g(HGROUP, 'moderate')])
	r = await c.startVote(b2, voteCfg())
	t.check(modOk(r) && r.data.board.meta.vote?.state === 'open' && r.data.board.meta.vote.by === nameOf('carol') && r.data.board.title === 'C69-Gruppe',
		'Mitglied der Gruppe mit moderate (carol): Start → 200, by = carols Anzeigename', brief(r))
	r = await c.updateVote(b2, { action: 'end' })
	t.check(modOk(r) && r.data.board.meta.vote?.state === 'closed' && r.data.board.meta.vote.voters === 0 && deepEq(r.data.board.meta.vote.results, []),
		'… end ohne Stimmen → closed, voters 0, results []', r.data?.board?.meta?.vote)
})

await C('C70', 'Stimm-Op (SPEC-M1 §4.6, §4.13.5, R16/R17): n 2 zweimal → einmal gezählt; dieselbe seq → gleicher Stand; per-/perItem-Grenze → limit; falscher Typ/Bereich → bad; Formfehler → bad; gelöschtes Objekt → gone; view → denied; Board-rev unverändert, Fastpath anderer ohne App-SQL (pgsql); votes {sid, mine, left}, mine als Objekt ({} nie []); gemischter Batch positionsgleich; eigene Stimme auf gelöschtem Objekt: left + n, mine ohne es, n 0 → ok; (R17, K2) Stimme auf N, ein Bearbeiter schiebt N aus dem Bereichs-Frame, n 0 → ok, left + n', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C70')
	const L = await link(b)
	const F = ulid()
	const [N1, N2, N3, N4, N5, S1] = [ulid(), ulid(), ulid(), ulid(), ulid(), ulid()]
	await ops(alice, b, [frame(F, { w: 2000, h: 1200 }),
		sticky(N1, { parent: F, x: 20, y: 80 }), sticky(N2, { parent: F, x: 260, y: 80 }), sticky(N3, { parent: F, x: 500, y: 80 }), sticky(N4, { parent: F, x: 740, y: 80 }),
		shape(S1, { parent: F, x: 20, y: 400 }), sticky(N5, { x: 2400, y: 0 })])
	await saveOk(alice, b, [u('bob', 'view')])
	const v = await startOk(alice, b, voteCfg({ per: 3, perItem: 2, scope: F }))
	const sid = v.sid
	const gi = await guest('Gina', L)
	const rev = await revOf(alice, b)
	const row0 = await stack.boardRow(b)
	const ch0 = await stack.changeCount(b)
	const seen = []
	const go = async (c, list, extra = {}) => {
		const r = await voteSync(c, b, list, { since: rev, ...extra })
		if (r.data?.votes) seen.push(r.data.votes)
		return r
	}

	let r = await go(gi, [vote(sid, N1, 2)])
	t.check(r.status === 200 && deepEq(r.data?.acks?.res, ['ok']), 'n 2 auf N1 → ok', brief(r))
	t.check(votesShape(r.data?.votes) && r.data.votes.sid === sid && sameObj(r.data.votes.mine, { [N1]: 2 }) && r.data.votes.left === 1,
		'votes = {sid, mine {N1: 2}, left 1} (R16: sid in jedem Block, mine als Objekt)', r.data?.votes)
	const seq1 = seqN
	r = await go(gi, [vote(sid, N1, 2)])
	t.check(deepEq(r.data?.acks?.res, ['ok']) && sameObj(r.data?.votes?.mine, { [N1]: 2 }) && r.data.votes.left === 1, 'n 2 noch einmal (neue seq) → ok, einmal gezählt (Mengen-Semantik)', r.data)
	r = await rawSync(gi, b, { since: rev, ops: [vote(sid, N1, 2)], seq: seq1 })
	t.check(r.status === 200 && deepEq(r.data?.acks?.res, ['ok']) && sameObj(r.data?.votes?.mine, { [N1]: 2 }) && r.data.votes.left === 1, 'dieselbe seq wiederholt → gleicher Stand', r.data)
	r = await go(gi, [vote(sid, N2, 2)])
	t.check(deepEq(r.data?.acks?.res, ['limit']) && sameObj(r.data?.votes?.mine, { [N1]: 2 }) && r.data.votes.left === 1, 'per-Grenze (2 + 2 > 3) → limit, Stand unverändert', r.data)
	r = await go(gi, [vote(sid, N3, 3)])
	t.check(deepEq(r.data?.acks?.res, ['limit']), 'perItem-Grenze (3 > 2) → limit', r.data?.acks)
	r = await go(gi, [vote(sid, S1, 1), vote(sid, N5, 1)])
	t.check(deepEq(r.data?.acks?.res, ['bad', 'bad']), 'Form (Typ nicht in cfg.types) → bad; Notiz außerhalb des Bereichs → bad', r.data?.acks)
	r = await go(gi, [vote(sid, N2, 100), vote(sid, N2, -1), vote(sid, N2, 1.5), { o: 'vote', s: sid, id: 'nope', n: 1 }, vote(0, N2, 1)])
	t.check(deepEq(r.data?.acks?.res, ['bad', 'bad', 'bad', 'bad', 'bad']), 'Formfehler (n 100, n −1, n 1,5, id keine ULID, s 0) → bad (§4.6, vor dem Lock)', r.data?.acks)
	const row1 = await stack.boardRow(b)
	t.check(row1.rev === row0.rev && (await stack.changeCount(b)) === ch0, 'Stimm-Ops erhöhen den Board-rev nicht, keine changes-Zeile', { row0, row1 })

	// the others stay on the fast path while people vote (pgsql: pg_stat_statements)
	if (stack.kind === 'pgsql') {
		for (let i = 0; i < 2; i++) await rawSync(alice, b, { since: row1.rev, pres: 0 })
		r = await go(gi, [vote(sid, N2, 1)])
		t.check(deepEq(r.data?.acks?.res, ['ok']) && r.data.votes?.left === 0, 'eine weitere Stimme (N2: 1) → ok, left 0', r.data)
		await stack.pgssReset()
		let bad = 0
		for (let i = 0; i < 20; i++) {
			const x = await rawSync(alice, b, { since: row1.rev, pres: 0 })
			if (x.status !== 200 || x.data?.rev !== row1.rev || x.data?.items || x.data?.board || x.data?.votes) bad++
		}
		const pg = await stack.pgssCount()
		t.check(bad === 0, 'nach der Stimme: 20 leere Syncs der Besitzerin, rev unverändert, ohne items/board/votes', bad)
		t.check(pg && Number(pg.total) === 0, 'Fastpath anderer Clients ohne App-SQL: 0 oc_knorke_-Aufrufe (pgsql)', pg)
		r = await go(gi, [vote(sid, N2, 0)])
		t.check(deepEq(r.data?.acks?.res, ['ok']) && sameObj(r.data?.votes?.mine, { [N1]: 2 }), 'Rücknahme (n 0) → ok, mine {N1: 2}', r.data?.votes)
	} else {
		t.note(`Fastpath-Teil übersprungen: braucht pg_stat_statements (nur KD_DB=pgsql); dieser Stack: ${stack.dbLabel}`)
	}

	// deleted item → gone; view → denied
	await ops(alice, b, [remove(N4)])
	r = await go(gi, [vote(sid, N4, 1)])
	t.check(deepEq(r.data?.acks?.res, ['gone']), 'gelöschtes Objekt (n 1) → gone', r.data?.acks)
	const bs = await snap(bob, b)
	t.check(bs.me?.role === 'view', 'Vorbedingung: bob hat die Rolle view (Freigabe)', bs.me)
	r = await rawSync(bob, b, { since: bs.rev, ops: [vote(sid, N2, 1)], seq: ++seqN })
	t.check(r.status === 200 && deepEq(r.data?.acks?.res, ['denied']), 'Rolle view (bob) → denied', brief(r))
	t.check(r.status === 200 && !('votes' in r.data), 'view: kein votes-Block (vor dem Lock abgelehnt)', r.data)

	// mixed batch: object ops first, then vote ops; res positional (§4.6)
	const N7 = ulid()
	r = await rawSync(alice, b, { since: rev, seq: ++seqN, ops: [vote(sid, N3, 1), sticky(N7, { parent: F, x: 980, y: 80 }), vote(sid, N7, 1), patch(N2, { 'data.text': 'gemischt' })] })
	if (r.data?.votes) seen.push(r.data.votes)
	t.check(r.status === 200 && deepEq(r.data?.acks?.res, ['ok', 'ok', 'ok', 'ok']), 'gemischter Batch (Stimme, put, Stimme auf das neue Objekt, patch) → res positionsgleich, alles ok', brief(r))
	t.check(votesShape(r.data?.votes) && sameObj(r.data.votes.mine, { [N3]: 1, [N7]: 1 }) && r.data.votes.left === 1, 'votes der Besitzerin: mine {N3: 1, N7: 1}, left 1', r.data?.votes)
	t.check(Number.isInteger(r.data?.acks?.rev) && itemIn(await snap(alice, b), N2)?.data?.text === 'gemischt', 'der Objekt-Teil wirkt (acks.rev, Text gespeichert)', r.data?.acks)

	// no own vote: mine {} (never []), left = per
	const h = await guest('Hans', L)
	r = await go(h, [vote(sid, N2, 0)])
	t.check(deepEq(r.data?.acks?.res, ['ok']) && isObj(r.data?.votes?.mine) && Object.keys(r.data.votes.mine).length === 0 && /"mine":\{\}/.test(r.text) && r.data.votes.left === 3,
		'ohne eigene Stimme: mine {} (nie []), left 3 (R16)', r.text.slice(0, 300))

	// (R16) an item with an own vote is deleted: left goes up by n, mine without it; n 0 on it → ok, n 1 → gone
	r = await go(gi, [vote(sid, N3, 0)])
	const before = r.data?.votes
	t.check(sameObj(before?.mine, { [N1]: 2 }) && before.left === 1, 'Vorbedingung: Gina hat mine {N1: 2}, left 1', before)
	await ops(alice, b, [remove(N1)])
	r = await go(gi, [vote(sid, N3, 0)])
	t.check(sameObj(r.data?.votes?.mine, {}) && r.data.votes.left === before.left + 2, 'eigene Stimme (n 2) auf einem gelöschten Objekt: nächste Antwort left + 2, mine ohne das Objekt (R16)', { before, after: r.data?.votes })
	r = await go(gi, [vote(sid, N1, 0)])
	t.check(deepEq(r.data?.acks?.res, ['ok']), 'n 0 auf das gelöschte Objekt → ok (R16)', r.data?.acks)
	r = await go(gi, [vote(sid, N1, 1)])
	t.check(deepEq(r.data?.acks?.res, ['gone']), 'n 1 auf das gelöschte Objekt → gone', r.data?.acks)

	// (R17, K2) session with a scope frame: a vote (n) on note N, an editor moves N out of the
	// frame by patch, n 0 on N → ok and left goes up by n (§4.13.5: lowering and taking back
	// never fail on type, scope or budget; rows on live items outside the scope keep counting)
	r = await go(gi, [vote(sid, N2, 2)])
	const k2 = r.data?.votes
	t.check(deepEq(r.data?.acks?.res, ['ok']) && sameObj(k2?.mine, { [N2]: 2 }) && k2.left === 1, 'K2: Gina stimmt n 2 auf N2 im Bereichs-Frame → ok, mine {N2: 2}, left 1', r.data)
	const mv = await ops(h, b, [patch(N2, { x: 2400, y: 400, parent: null })])
	const n2 = itemIn(await snap(alice, b), N2)
	t.check(deepEq(mv.acks?.res, ['ok']) && n2?.parent === null && n2.deleted !== true, 'K2: ein Bearbeiter (Hans, Bearbeitungslink) schiebt N2 per patch aus dem Frame → ok, N2 lebt mit parent null', { acks: mv.acks, n2 })
	r = await go(gi, [vote(sid, N3, 0)])
	t.check(deepEq(r.data?.acks?.res, ['ok']) && sameObj(r.data?.votes?.mine, { [N2]: 2 }) && r.data.votes.left === k2.left, 'K2: die Zeile auf N2 außerhalb des Bereichs zählt weiter (mine {N2: 2}, left unverändert)', r.data?.votes)
	r = await go(gi, [vote(sid, N2, 0)])
	t.check(deepEq(r.data?.acks?.res, ['ok']) && sameObj(r.data?.votes?.mine, {}) && r.data.votes.left === k2.left + 2, 'K2: n 0 auf N2 außerhalb des Frames → ok, mine ohne N2, left um n (2) höher (R17)', { before: k2, after: r.data?.votes, acks: r.data?.acks })
	r = await go(gi, [vote(sid, N2, 1)])
	t.check(deepEq(r.data?.acks?.res, ['bad']) && sameObj(r.data?.votes?.mine, {}), 'K2: eine Erhöhung auf N2 außerhalb des Bereichs prüft den Bereich weiter → bad', r.data)
	t.check(seen.length >= 10 && seen.every(votesShape), `jeder votes-Block (${seen.length}): sid gesetzt, mine als Objekt, nur erlaubte Schlüssel (R16)`, seen.filter((x) => !votesShape(x)).slice(0, 3))
})

await C('C71', 'Stimm-Geheimnis (SPEC-M1 §4.5, §4.13.8 Schritt 9, §7.2, R2/R16): Nicht-Moderator mit vt → nie voters; Moderatorin → voters = Zahl der pids, vt = seq; vt = Stand → kein Block; keine Antwort mit tally oder Summe je Objekt, keine pid neben einer Stimme; Gast mit altem Token → gleiche mine; zwei gleichzeitige Stimm-Batches → vt: auf dem höheren seq; neue Sitzung → Moderatorin mit vt (≥ 1) der alten bekommt voters; Form der votes-Blöcke', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C71')
	const L = await link(b)
	const LV = await voteLink(b)
	await member(bob, L)
	const gi = await guest('Gina', L)
	const vv = await guest('Vera', LV)
	const [N1, N2, N3] = [ulid(), ulid(), ulid()]
	await ops(alice, b, [sticky(N1), sticky(N2, { x: 300 }), sticky(N3, { x: 600 })])
	const v = await startOk(alice, b, voteCfg({ per: 5, perItem: 1 }))
	const sid = v.sid
	const rev = await revOf(alice, b)
	const pids = [await pidOf(alice, b), await pidOf(bob, b), gi.pid, vv.pid]
	t.check(pids.every((p) => /^[0-9a-f]{16}$/.test(p || '')), 'Vorbedingung: vier pids (alice, bob, Gina, Vera)', pids)
	const answers = []
	const sync = async (c, body = {}) => {
		const r = await rawSync(c, b, { since: rev, ...body })
		answers.push(r)
		return r
	}

	let r = await sync(bob, { vt: 0 })
	t.check(r.status === 200 && !('votes' in r.data), 'Link-Bearbeiter (kein Moderator) mit vt 0 ohne Stimm-Op → kein votes-Block', r.data)
	r = await sync(bob, { vt: 0, ops: [vote(sid, N1, 1)], seq: ++seqN })
	t.check(deepEq(r.data?.acks?.res, ['ok']) && votesShape(r.data?.votes) && !('voters' in r.data.votes) && !('vt' in r.data.votes),
		'Nicht-Moderator mit vt und Stimme: votes ohne voters/vt', r.data?.votes)
	r = await sync(alice, { vt: 0 })
	let rows = await stack.voteSessions(b)
	t.check(votesShape(r.data?.votes) && r.data.votes.sid === sid && r.data.votes.voters === 1 && rows[0]?.seq >= 1 && r.data.votes.vt === rows[0].seq,
		'Moderatorin mit vt 0: votes {sid, voters 1, vt = seq der Sitzung (SQL)}', { votes: r.data?.votes, seq: rows[0]?.seq })
	const vt1 = r.data?.votes?.vt ?? 0
	r = await sync(gi, { ops: [vote(sid, N1, 1)], seq: ++seqN })
	t.check(deepEq(r.data?.acks?.res, ['ok']), 'Gina (Gast, Bearbeitungslink) stimmt ab → ok', r.data?.acks)
	r = await sync(vv, { ops: [vote(sid, N2, 1)], seq: ++seqN })
	t.check(deepEq(r.data?.acks?.res, ['ok']), 'Vera (Gast, Abstimm-Link, Rolle vote) stimmt ab → ok', r.data?.acks)
	r = await sync(alice, { vt: vt1 })
	rows = await stack.voteSessions(b)
	t.check(r.data?.votes?.voters === 3 && r.data.votes.vt === rows[0]?.seq && r.data.votes.sid === sid, 'drei Wählende → voters 3 (Zahl der pids), vt = seq', { votes: r.data?.votes, seq: rows[0]?.seq })
	const vt3 = r.data?.votes?.vt ?? 0
	r = await sync(alice, { vt: vt3 })
	t.check(r.status === 200 && !('votes' in r.data), 'vt = aktueller Stand → kein votes-Block (Schritt 9 (i), ohne Abfrage)', r.data)
	// presence of an editor during the session carries no vote fields
	await sync(bob, { pres: 1, me: { c: [5, 6], s: [N1], d: [], e: null } })
	r = await sync(alice, { pres: 1 })
	const be = Object.entries(r.data?.presence || {}).find(([k]) => k.startsWith(`${pids[1]}:`))?.[1]
	t.check(be && deepEq(Object.keys(be).sort(), PRESENCE_FIELDS), 'Präsenz eines Bearbeitenden: genau n, k, g, x, y, s, d, e, h, v (keine Stimmfelder)', be)

	// a guest rejoins with its old token: same pid, same mine (snapshot/join: votes {sid, mine, left})
	const rj = await vv.joinGuest(LV, 'Vera', { client: vv.client, guest: vv.guestToken })
	t.check(rj.status === 200 && rj.data?.me?.pid === vv.pid, 'Vera tritt mit altem Token neu bei → gleiche pid', brief(rj))
	t.check(votesShape(rj.data?.votes) && rj.data.votes.sid === sid && sameObj(rj.data.votes.mine, { [N2]: 1 }) && rj.data.votes.left === 4,
		'Beitritts-Antwort: votes {sid, mine {N2: 1}, left 4}', rj.data?.votes)
	r = await sync(vv, { ops: [vote(sid, N3, 0)], seq: ++seqN })
	t.check(sameObj(r.data?.votes?.mine, { [N2]: 1 }) && r.data.votes.left === 4, '… und die nächste Antwort mit Stimm-Op nennt dieselbe mine', r.data?.votes)

	// two concurrent vote batches: vt: ends on the higher seq (cas maximum, §4.13.5)
	const [ra, rb] = await Promise.all([sync(bob, { ops: [vote(sid, N2, 1)], seq: ++seqN }), sync(gi, { ops: [vote(sid, N2, 1)], seq: ++seqN })])
	t.check(deepEq(ra.data?.acks?.res, ['ok']) && deepEq(rb.data?.acks?.res, ['ok']), 'zwei gleichzeitige Stimm-Batches → ok, ok', [brief(ra), brief(rb)])
	rows = await stack.voteSessions(b)
	const vtKey = await stack.redisGet(rkey(`vt:${b}`))
	t.check(vtKey && vtValue(vtKey.value) === `${sid}:${rows[0]?.seq}` && vtKey.ttl > 0 && vtKey.ttl <= 120, 'vt: steht danach auf dem höheren seq ("<sid>:<seq>" = SQL), TTL ≤ 120 s', { vt: vtKey, seq: rows[0]?.seq })

	// nothing of the session's answers reveals a distribution or a voter
	const bad = []
	for (const x of answers.concat([rj])) {
		if (!x?.data) continue
		if (/"tally"/.test(x.text)) bad.push('tally')
		if (x.data.votes && !votesShape(x.data.votes)) bad.push(['votes', x.data.votes])
		const mv = x.data.board?.meta?.vote
		if (mv && mv.state === 'open' && ('results' in mv || 'total' in mv || 'voters' in mv)) bad.push(['meta.vote', mv])
		const vj = JSON.stringify(x.data.votes ?? null) + JSON.stringify(mv ?? null)
		for (const p of pids) if (vj.includes(p)) bad.push(['pid', p])
		for (const [k, e] of Object.entries(x.data.presence || {})) if (!deepEq(Object.keys(e).sort(), PRESENCE_FIELDS)) bad.push(['presence', k, e])
	}
	t.check(answers.length >= 10 && bad.length === 0, `${answers.length + 1} Antworten während der Sitzung: kein tally, keine Summe je Objekt, keine pid in votes/meta.vote, Präsenz ohne Stimmfelder`, bad.slice(0, 5))

	// a new session: the moderator still sends the vt of the old one (≥ 1, R16) and gets voters
	t.check(vt3 >= 1, 'Vorbedingung: die alte Sitzung hatte Stimmen (vt ≥ 1, R16)', vt3)
	r = await alice.updateVote(b, { action: 'end' })
	t.check(modOk(r) && r.data.board.meta.vote?.state === 'closed' && r.data.board.meta.vote.voters === 3, 'end → closed, voters 3', r.data?.board?.meta?.vote)
	r = await sync(alice, { vt: vt3 })
	t.check(r.status === 200 && !(r.data?.votes && 'voters' in r.data.votes), 'ohne offene Sitzung: keine voters', r.data?.votes)
	const v2 = await startOk(alice, b, voteCfg())
	r = await sync(alice, { vt: vt3 })
	t.check(votesShape(r.data?.votes) && r.data.votes.sid === v2.sid && r.data.votes.voters === 0 && r.data.votes.vt === 0,
		'neue Sitzung: Moderatorin mit vt der alten (≥ 1) → votes {sid neu, voters 0, vt 0} (R16)', r.data?.votes)
})

await C('C72', 'Ablauf (SPEC-M1 §4.12.1, §8.3 R16, Stack.voteExpire): (1) Stimme, vote-expire, Stimm-Op → closed, SQL closed, nächster Sync mit results; (2) neue Sitzung, Stimme, vote-expire, Moderator-Sync mit vt 0 → geschlossen, Antwort ohne voters, folgender Sync closed; (3) neue Sitzung, vote-expire, occ background-job:execute VoteCloseJob --force-execute → geschlossen (SQL und nächster Sync)', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C72')
	const L = await link(b)
	const gi = await guest('Gina', L)
	const [N1, N2] = [ulid(), ulid()]
	await ops(alice, b, [sticky(N1), sticky(N2, { x: 300 })])
	const rev = await revOf(alice, b)
	const stateOf = async (sid) => (await stack.voteSessions(b)).find((x) => x.id === sid)?.state ?? null

	// (1) path (a): the vote op sees the expiry
	let v = await startOk(alice, b, voteCfg({ minutes: 10 }))
	let r = await voteSync(gi, b, [vote(v.sid, N1, 1)], { since: rev })
	t.check(deepEq(r.data?.acks?.res, ['ok']), '(1) Gina stimmt ab → ok', brief(r))
	let ex = await stack.voteExpire(b)
	t.check(ex.sid === v.sid && ex.endsAt === ex.now - 1 && (await stack.redisGet(rkey(`vt:${b}`))) === null, '(1) vote-expire: ends_at = jetzt − 1 ms, vt: danach weg', ex)
	const s0 = await snap(alice, b)
	t.check(s0.board?.meta?.vote?.state === 'open' && s0.board.meta.vote.endsAt === v.endsAt, '(1) vote-expire lässt meta stehen (open, endsAt unverändert)', s0.board?.meta?.vote)
	r = await voteSync(gi, b, [vote(v.sid, N2, 1)], { since: rev })
	t.check(r.status === 200 && deepEq(r.data?.acks?.res, ['closed']), '(1) Stimm-Op nach dem Ablauf → closed', brief(r))
	t.check(r.status === 200 && (!r.data.votes || (!('mine' in r.data.votes) && !('left' in r.data.votes))), '(1) Sitzung nicht mehr offen: votes ohne mine/left (R16)', r.data?.votes)
	t.check((await stateOf(v.sid)) === 'closed', '(1) SQL: state = closed (Weg a)')
	r = await rawSync(alice, b, { since: rev })
	t.check(r.data?.board?.meta?.vote?.state === 'closed' && r.data.board.meta.vote.sid === v.sid && deepEq(r.data.board.meta.vote.results, [[N1, 1]]) && r.data.board.meta.vote.voters === 1,
		'(1) nächster Sync: meta.vote closed mit results [[N1, 1]], voters 1', r.data?.board?.meta?.vote)

	// (2) path (b): a moderator poll with vt 0 (vt: deleted, so step 9 reads the session)
	v = await startOk(alice, b, voteCfg({ minutes: 10 }))
	r = await voteSync(gi, b, [vote(v.sid, N1, 1)], { since: rev })
	t.check(deepEq(r.data?.acks?.res, ['ok']), '(2) Gina stimmt in der neuen Sitzung ab → ok', brief(r))
	ex = await stack.voteExpire(b)
	t.check(ex.sid === v.sid, '(2) vote-expire', ex)
	r = await rawSync(alice, b, { since: rev, vt: 0 })
	t.check(r.status === 200 && !(r.data?.votes && 'voters' in r.data.votes), '(2) Moderator-Sync mit vt 0 nach dem Ablauf → 200, diese Antwort ohne voters', brief(r))
	t.check((await stateOf(v.sid)) === 'closed', '(2) SQL: dabei geschlossen (Weg b)')
	const r2 = await rawSync(alice, b, { since: r.data?.rev ?? rev })
	t.check(r2.data?.board?.meta?.vote?.state === 'closed' && r2.data.board.meta.vote.sid === v.sid && deepEq(r2.data.board.meta.vote.results, [[N1, 1]]),
		'(2) der folgende Sync trägt meta.vote.state closed (mit results)', r2.data?.board?.meta?.vote)

	// (3) path (d): VoteCloseJob without any request
	v = await startOk(alice, b, voteCfg({ minutes: 10 }))
	ex = await stack.voteExpire(b)
	t.check(ex.sid === v.sid, '(3) vote-expire', ex)
	const listed = await stack.occ('background-job:list', '--class=OCA\\Knorke\\BackgroundJob\\VoteCloseJob', '--output=json').catch((e) => `FEHLER ${e.message}`)
	let jobs = null
	try { jobs = JSON.parse(listed.slice(listed.search(/[[{]/))) } catch { /* not JSON */ }
	const job = (Array.isArray(jobs) ? jobs : Object.values(jobs || {})).find((j) => isObj(j) && /VoteCloseJob$/.test(String(j.class ?? '')))
	t.check(job && /^\d+$/.test(String(job.id)), '(3) occ background-job:list --class=…VoteCloseJob → id', listed.slice(0, 300))
	if (job) {
		const out = await stack.occ('background-job:execute', String(job.id), '--force-execute').catch((e) => `FEHLER ${e.message}`)
		t.check(!/^FEHLER/.test(out), '(3) occ background-job:execute <id> --force-execute läuft', out.slice(0, 300))
	}
	t.check((await stateOf(v.sid)) === 'closed', '(3) SQL: VoteCloseJob hat geschlossen (Weg d, ohne Anfrage)')
	r = await rawSync(alice, b, { since: rev })
	t.check(r.data?.board?.meta?.vote?.state === 'closed' && r.data.board.meta.vote.sid === v.sid && r.data.board.meta.vote.voters === 0,
		'(3) nächster Sync: meta.vote closed (voters 0)', r.data?.board?.meta?.vote)
})

await C('C73', 'Timer (SPEC-M1 §4.12.2, R16): start 60 000 → end − now ≈ 60 000 (±1 s); pause/resume/add/stop mit seq; falsche Vorbedingung → 409 timer_state; Nicht-Moderator 403; ms 0, < 1000, > 99:59, add > 1 h, ohne ms, unbekannte action → 400 bad_request; abgelaufener Timer: pause 409, add ab jetzt; start ersetzt; add gekappt', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C73')
	const L = await link(b)
	await member(bob, L)
	const tm = (body) => alice.timer(b, body)
	const timerOf = (r) => r.data?.board?.meta?.timer
	let r = await tm({ action: 'start', ms: 60000 })
	let x = timerOf(r)
	t.check(modOk(r) && r.data.board.title === 'C73' && isObj(x) && x.state === 'running' && x.dur === 60000 && x.left === null && x.by === 'Alice Adler' && Number.isInteger(x.seq),
		'start 60 000 → {state running, dur, left null, by, seq}', x)
	t.check(isObj(x) && Math.abs(x.end - r.data.now - 60000) <= 1000, 'end − now ≈ 60 000 (±1 s)', x && { end: x.end, now: r.data.now })
	const seq0 = x?.seq ?? 0
	let s = await rawSync(bob, b, { since: 0 })
	t.check(s.data?.board?.meta?.timer?.end === x?.end, 'andere sehen den Timer im nächsten Sync (board.meta.timer)', s.data?.board?.meta)
	const bobRev = s.data?.rev
	r = await bob.timer(b, { action: 'pause' })
	t.check(errIs(r, 403, 'forbidden'), 'Nicht-Moderator (Link-Bearbeiter) → 403 forbidden', brief(r))
	r = await tm({ action: 'resume' })
	t.check(errIs(r, 409, 'timer_state'), 'resume auf laufendem Timer → 409 timer_state', brief(r))
	await sleep(400)
	r = await tm({ action: 'pause' })
	x = timerOf(r)
	t.check(modOk(r) && x?.state === 'paused' && x.end === null && Number.isInteger(x.left) && x.left <= 60000 - 300 && x.left >= 55000 && x.seq === seq0 + 1,
		'pause → {state paused, end null, left = end − now, seq + 1}', x)
	const left = x?.left
	// a client on the fast path (since = current rev) gets the change in its next sync: r: is raised after the commit (§4.13.4)
	s = await rawSync(bob, b, { since: bobRev })
	t.check(s.status === 200 && s.data?.board?.meta?.timer?.state === 'paused' && s.data.board.metaRev === r.data?.board?.metaRev, 'bob mit since = rev vor der Pause (Fastpath) bekommt den board-Block mit dem pausierten Timer im nächsten Sync', s.data)
	r = await tm({ action: 'pause' })
	t.check(errIs(r, 409, 'timer_state'), 'pause auf pausiertem Timer → 409 timer_state', brief(r))
	r = await tm({ action: 'add', ms: 60000 })
	x = timerOf(r)
	t.check(modOk(r) && x?.state === 'paused' && x.left === left + 60000 && x.dur === 120000 && x.seq === seq0 + 2, 'add 60 000 (pausiert) → left + 60 000, dur + 60 000', x)
	r = await tm({ action: 'resume' })
	x = timerOf(r)
	t.check(modOk(r) && x?.state === 'running' && x.left === null && Math.abs(x.end - r.data.now - (left + 60000)) <= 1000 && x.seq === seq0 + 3,
		'resume → {state running, end = now + left (±1 s), left null}', x && { x, now: r.data.now })
	const end1 = x?.end
	r = await tm({ action: 'add', ms: 60000 })
	x = timerOf(r)
	t.check(modOk(r) && x?.end === end1 + 60000 && x.dur === 180000, 'add 60 000 (laufend) → end + 60 000, dur + 60 000', x)
	r = await tm({ action: 'start', ms: 30000 })
	x = timerOf(r)
	t.check(modOk(r) && x?.state === 'running' && x.dur === 30000 && Math.abs(x.end - r.data.now - 30000) <= 1000, 'start auf laufendem Timer ersetzt ihn (dur 30 000)', x)
	// codes (R16 §4.12)
	for (const [body, what] of [
		[{ action: 'start', ms: 0 }, 'start ms 0'], [{ action: 'start', ms: 999 }, 'start ms 999'], [{ action: 'start', ms: 5999001 }, 'start ms > 99:59'],
		[{ action: 'start' }, 'start ohne ms'], [{ action: 'add', ms: 3600001 }, 'add ms > 1 h'], [{ action: 'add', ms: 500 }, 'add ms 500'],
		[{ action: 'reset' }, 'unbekannte action'], [{}, 'ohne action'],
	]) {
		r = await tm(body)
		t.check(errIs(r, 400, 'bad_request'), `${what} → 400 bad_request (R16)`, brief(r))
	}
	// cap: start at the maximum, add → still at most TIMER_MAX_MS left
	r = await tm({ action: 'start', ms: 5999000 })
	r = await tm({ action: 'add', ms: 3600000 })
	x = timerOf(r)
	t.check(modOk(r) && x?.end - r.data.now <= 5999000 + 1000 && x.end - r.data.now >= 5999000 - 2000, 'add über 99:59 → auf TIMER_MAX_MS Restzeit gekappt', x && { rest: x.end - r.data.now })
	// stop
	r = await tm({ action: 'stop' })
	t.check(modOk(r) && !('timer' in r.data.board.meta), 'stop → meta.timer entfernt', r.data?.board?.meta)
	for (const action of ['stop', 'pause', 'resume']) {
		r = await tm({ action, ms: 1000 })
		t.check(errIs(r, 409, 'timer_state'), `${action} ohne Timer → 409 timer_state`, brief(r))
	}
	r = await tm({ action: 'add', ms: 1000 })
	t.check(errIs(r, 409, 'timer_state'), 'add ohne Timer → 409 timer_state', brief(r))
	// an expired timer stays running with end ≤ now: pause → 409, add → end = now + ms (R16)
	r = await tm({ action: 'start', ms: 1000 })
	await sleep(1400)
	r = await tm({ action: 'pause' })
	t.check(errIs(r, 409, 'timer_state'), 'pause auf abgelaufenem Timer → 409 timer_state (R16)', brief(r))
	s = await snap(alice, b)
	t.check(s.board?.meta?.timer?.state === 'running' && s.board.meta.timer.end <= s.now, 'ein abgelaufener Timer bleibt running mit end ≤ now', s.board?.meta?.timer)
	r = await tm({ action: 'add', ms: 2000 })
	x = timerOf(r)
	t.check(modOk(r) && x?.state === 'running' && Math.abs(x.end - r.data.now - 2000) <= 1000 && x.dur === 3000, 'add 2000 auf abgelaufenem Timer → end = now + 2000, dur + 2000 (R16)', x && { x, now: r.data.now })
	await tm({ action: 'stop' })
})

await C('C74', '„Alle zu mir“ (SPEC-M1 §4.12.3, R2/R16): POST {client} → meta.summon {pid, client, name, seq, at}, seq + 1 je Aufruf, andere sehen es im nächsten Sync; Nicht-Moderator 403; ohne/ungültiger client → 400 bad_request; DELETE entfernt (jeder Moderator), DELETE ohne summon → 200 ohne Schreiben; danach beginnt seq wieder bei 1', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C74')
	const L = await link(b)
	await member(bob, L)
	const c = await carolClient()
	await saveOk(alice, b, [u('carol', 'moderate')])
	const rev0 = await revOf(alice, b)
	const alicePid = await pidOf(alice, b)
	const carolPid = await pidOf(c, b)
	let r = await alice.summon(b, { client: alice.client })
	let sm = r.data?.board?.meta?.summon
	t.check(modOk(r) && r.data.board.title === 'C74' && isObj(sm) && sm.pid === alicePid && sm.client === alice.client && sm.name === 'Alice Adler' && sm.seq === 1 && Math.abs(sm.at - r.data.now) <= 1000,
		'POST summon {client} → meta.summon {pid, client, name, seq 1, at ≈ now}', sm)
	t.check(deepEq(Object.keys(sm || {}).sort(), ['at', 'client', 'name', 'pid', 'seq']), 'meta.summon trägt genau diese Schlüssel (keine uid, §3.11)', sm)
	r = await rawSync(bob, b, { since: rev0 })
	t.check(r.data?.board?.meta?.summon?.pid === alicePid && r.data.board.meta.summon.seq === 1, 'bob sieht meta.summon im nächsten Sync', r.data?.board?.meta)
	const c2 = clientId()
	r = await alice.summon(b, { client: c2 })
	t.check(modOk(r) && r.data.board.meta.summon?.seq === 2 && r.data.board.meta.summon.client === c2 && r.data.board.meta.summon.pid === alicePid, 'zweiter Aufruf (anderer Tab) → seq 2, client dieses Tabs', r.data?.board?.meta?.summon)
	r = await bob.summon(b, { client: bob.client })
	t.check(errIs(r, 403, 'forbidden'), 'Nicht-Moderator (Link-Bearbeiter): POST → 403 forbidden', brief(r))
	r = await bob.endSummon(b)
	t.check(errIs(r, 403, 'forbidden'), 'Nicht-Moderator: DELETE → 403 forbidden', brief(r))
	r = await alice.summon(b, {})
	t.check(errIs(r, 400, 'bad_request'), 'ohne client → 400 bad_request (R2)', brief(r))
	r = await alice.summon(b, { client: 'x y!' })
	t.check(errIs(r, 400, 'bad_request'), 'client außerhalb der Regex von sync.client → 400 bad_request', brief(r))
	// any moderator ends it
	r = await c.endSummon(b)
	const mr = r.data?.board?.metaRev
	t.check(modOk(r) && !('summon' in r.data.board.meta), 'DELETE durch eine andere Moderatorin (carol, moderate) → summon entfernt', r.data?.board?.meta)
	r = await c.endSummon(b)
	t.check(modOk(r) && r.data.board.metaRev === mr && !('summon' in r.data.board.meta), 'DELETE ohne summon → 200 ohne Schreiben (gleicher metaRev, R16)', r.data?.board)
	r = await c.summon(b, { client: c.client })
	sm = r.data?.board?.meta?.summon
	t.check(modOk(r) && sm?.pid === carolPid && sm.name === nameOf('carol') && sm.seq === 1, 'nach DELETE: neuer Aufruf (carol) beginnt wieder bei seq 1 (Paar seq/at, R16)', sm)
	await c.endSummon(b)
})

await C('C75', 'Präsenz v (SPEC-M1 §4.5, §5.5, R2/R16): gültiges v wird je q(…, 10) gerundet ausgeliefert; ungültige v ([0,0,0,100], fünf Elemente, null, String, Betrag > 1e7) → v null, Rest des Eintrags bleibt; Rolle view schreibt nichts; Rolle vote mit s, d, e → nur c und v', async (t) => {
	await stack.ratelimitReset()
	const b = await newBoard('C75')
	const L = await link(b)
	const LV = await voteLink(b)
	await member(bob, L)
	const c = await carolClient()
	await saveOk(alice, b, [u('carol', 'view')])
	const N = ulid()
	await ops(alice, b, [sticky(N)])
	const rev = await revOf(alice, b)
	const alicePid = await pidOf(alice, b)
	const read = async (key) => {
		const r = await bob.sync(b, { client: bob.client, since: rev, pres: 1 })
		return { all: r.data?.presence || {}, e: r.data?.presence?.[key] }
	}
	const a1 = clientId()
	let r = await alice.sync(b, { client: a1, since: rev, pres: 1, me: { c: [1, 2], s: [], d: [], e: null, v: [-200.04, -150.06, 1600.14, 900.96] } })
	t.check(r.status === 200, 'me mit v → 200', brief(r))
	let e = (await read(`${alicePid}:${a1}`)).e
	const wantV = [q(-200.04, 10), q(-150.06, 10), q(1600.14, 10), q(900.96, 10)]
	t.check(deepEq(wantV, [-200, -150.1, 1600.1, 901]), 'Vorbedingung: q(…, 10) der Harness rechnet wie §4.7', wantV)
	t.check(e && deepEq(e.v, wantV) && e.x === 1 && e.y === 2, 'gültiges v → ausgeliefert, je q(…, 10) gerundet', e)
	let i = 0
	for (const [v, what] of [
		[[0, 0, 0, 100], 'w = 0'],
		[[0, 0, 10, 10, 5], 'fünf Elemente'],
		[[0, null, 10, 10], 'ein Element null (so kommt NaN über JSON an)'],
		[['0', 0, 10, 10], 'ein String-Element'],
		[[2e7, 0, 10, 10], 'Betrag > 1e7'],
	]) {
		i++
		const cl = clientId()
		r = await alice.sync(b, { client: cl, since: rev, pres: 1, me: { c: [10 + i, 20 + i], s: [], d: [], e: null, v } })
		e = (await read(`${alicePid}:${cl}`)).e
		t.check(r.status === 200 && e && e.v === null && e.x === 10 + i && e.y === 20 + i && e.n === 'Alice Adler',
			`ungültiges v (${what}) → 200, v null, der Rest des Eintrags bleibt`, { status: r.status, e })
	}
	// role view writes nothing
	const cs = await snap(c, b)
	t.check(cs.me?.role === 'view', 'Vorbedingung: carol hat die Rolle view', cs.me)
	r = await c.sync(b, { client: c.client, since: rev, pres: 1, me: { c: [5, 5], s: [], d: [], e: null, v: [0, 0, 100, 100] } })
	const all = (await read('')).all
	t.check(r.status === 200 && !Object.keys(all).some((k) => k.startsWith(`${cs.me?.pid}:`)), 'Rolle view (carol) schreibt keine Präsenz', all)
	// role vote: only c and v public (§5.5)
	const vg = await guest('Vera', LV)
	r = await vg.sync(b, { client: vg.client, since: rev, pres: 1, me: { c: [7, 8], s: [N], d: [[N, 30, 40]], e: N, v: [0, 0, 640, 480] } })
	e = (await read(`${vg.pid}:${vg.client}`)).e
	t.check(r.status === 200 && e && deepEq(e.s, []) && deepEq(e.d, []) && e.e === null && e.h === 0 && e.x === 7 && e.y === 8 && deepEq(e.v, [0, 0, 640, 480]) && e.g === 1,
		'Rolle vote (Gast über den Abstimm-Link) mit s, d, e → öffentlicher Eintrag nur mit c (x, y) und v', e)
	t.check(e && deepEq(Object.keys(e).sort(), PRESENCE_FIELDS), 'Eintrag mit genau den Feldern n, k, g, x, y, s, d, e, h, v', e)
})

// ── stage 4 (SPEC-M1 §8.3, Revision 19): write budget, snapshot throttle, tombstone purge, changes cap ──

/** Fixed window of the write budget (§4.13.6). */
const WIN_MS = 10000
const winOf = (now) => Math.floor(now / WIN_MS)
/** acks.retryMs of a busy answer from `now` of the same answer (§4.13.6, §8.3 C76 R19). */
const busyRetry = (now) => (winOf(now) + 1) * WIN_MS - now + 100

/**
 * Sync with ops that waits out `busy` (retryMs of the answer, then the same
 * seq) – only for setup traffic that is not what a case checks (C76 (c),
 * C79). `since` must be given (rawSync would take a snapshot otherwise).
 */
async function opsPaced(c, b, list, extra) {
	if (!Number.isInteger(extra?.since)) throw new Error('opsPaced braucht since (sonst ein Snapshot je Aufruf)')
	const seq = ++seqN
	for (let i = 0; i < 8; i++) {
		const r = await rawSync(c, b, { ops: list, seq, ...extra })
		if (r.status !== 200 || !r.data?.acks) throw new Error(`Sync ${c.name} (${list.length} Ops): ${brief(r)}`)
		if (!(r.data.acks.res || []).includes('busy')) return r.data
		await sleep(Math.min(Math.max(Number(r.data.acks.retryMs) || 1000, 100), 11000))
	}
	throw new Error(`Sync ${c.name}: busy nach 8 Versuchen`)
}

/**
 * C76 (R19, T4-17): waits until the estimated server time (now of an empty
 * poll plus the locally elapsed time) lies 50–1000 ms into a 10-s window and
 * returns that window.
 */
async function alignWindow(c, b, since) {
	for (let i = 0; i < 4; i++) {
		const r = await c.sync(b, { client: c.client, since, pres: 0 })
		const local = Date.now()
		if (r.status !== 200 || !Number.isInteger(r.data?.now)) throw new Error(`Fensterausrichtung: ${brief(r)}`)
		const m = r.data.now % WIN_MS
		const wait = (m <= 150 ? 150 - m : WIN_MS - m + 150) - (Date.now() - local)
		if (wait > 0) await sleep(wait)
		const est = r.data.now + (Date.now() - local)
		if (est % WIN_MS >= 50 && est % WIN_MS <= 1000) return winOf(est)
	}
	throw new Error('Fensterausrichtung: 4 Versuche ohne Fensteranfang')
}

/**
 * Runs a C76 sub-case in one window (R19): attempt(rec) records its checks
 * in rec.checks and the `now` of every answer in rec.nows and returns the
 * start window. Only an attempt whose answers all carry that window counts;
 * otherwise it is repeated exactly once in the next window (noted in the
 * report), a second miss is red.
 */
async function inOneWindow(t, label, attempt) {
	for (let n = 1; n <= 2; n++) {
		const rec = { checks: [], nows: [] }
		rec.check = (cond, l, info) => { rec.checks.push([!!cond, l, info]); return !!cond }
		const start = await attempt(rec, n)
		const wins = [...new Set(rec.nows.map(winOf))]
		if (rec.nows.length > 0 && wins.length === 1 && wins[0] === start) {
			if (n > 1) t.note(`${label}: im zweiten Fenster wiederholt (Versuch 1 lag über einer Fenstergrenze)`)
			for (const [cond, l, info] of rec.checks) t.check(cond, `${label} ${l}`, info)
			t.check(true, `${label}: alle ${rec.nows.length} Antworten im Startfenster ${start}`)
			return
		}
		t.note(`${label}: Versuch ${n} nicht in einem Fenster (Start ${start}, Antworten in ${wins.join(', ')})${n === 1 ? ' – einmal im nächsten Fenster wiederholt' : ''}`)
	}
	t.check(false, `${label}: zweimal nicht in einem Fenster – rot (R19)`)
}

/** The busy answer of §4.13.6: every result busy, acks.rev null, retryMs from now of the same answer. */
function busyOk(rec, r, n, label) {
	const a = r.data?.acks
	return rec.check(r.status === 200 && deepEq(a?.res, Array(n).fill('busy')) && a?.rev === null && a?.retryMs === busyRetry(r.data?.now),
		`${label}: busy für alle ${n} Ops, acks.rev null, retryMs = (floor(now/10000) + 1)·10000 − now + 100`, { status: r.status, acks: a, now: r.data?.now, want: busyRetry(r.data?.now) })
}

/** Values of the write-budget keys w:<b>:* of a board (any epoch), key → value. */
async function wKeys(b) {
	const out = {}
	for (const k of await stack.redisScan(rkey(`w:${b}:*`))) out[k] = await stack.redis('GET', k)
	return out
}

await C('C76', 'Schreibbudget (SPEC-M1 §4.13.6, §8.3 R19): je Teilfall eigenes Board am Fensteranfang; (a) 61 Anfragen mit je 1 Op → die 61. busy mit retryMs, nichts angewendet (SQL), Präsenz und items geliefert; (b) 10 × 200 Ops ok, die 11. mit 1 Op busy; (c) keep-patch auf einen Frame mit 2500 Kindern ok, die nächste Anfrage busy; (d) leerer Poll während busy → normale Antwort, kein neuer Schlüssel w:<b>:*; nach Fensterende wieder ok', async (t) => {
	// (a)
	await inOneWindow(t, '(a)', async (rec) => {
		const b = await newBoard('C76a')
		await member(bob, await link(b))
		const rev0 = (await snap(alice, b)).rev
		const bobPid = await pidOf(bob, b)
		const start = await alignWindow(alice, b, rev0)
		// bob is present on the board: his entry must reach alice in the busy answer
		const pb = await bob.sync(b, { client: bob.client, since: rev0, pres: 1, me: { c: [11, 22], s: [], d: [], e: null } })
		rec.nows.push(pb.data?.now)
		const ids = []
		let since = rev0
		let okN = 0
		for (let i = 1; i <= 60; i++) {
			const id = ulid()
			ids.push(id)
			const r = await alice.sync(b, { client: alice.client, since, seq: ++seqN, pres: 0, ops: [sticky(id, { x: i * 10 })] })
			rec.nows.push(r.data?.now)
			if (r.status === 200 && deepEq(r.data?.acks?.res, ['ok'])) okN++
			since = r.data?.acks?.rev ?? since
		}
		rec.check(okN === 60, '60 Anfragen mit je 1 Op → ok', okN)
		const X = ulid()
		const r = await alice.sync(b, { client: alice.client, since: rev0, seq: ++seqN, pres: 1, ops: [sticky(X)] })
		rec.nows.push(r.data?.now)
		busyOk(rec, r, 1, 'die 61.')
		rec.check((await stack.itemRow(b, X)) === null, 'die 61.: nichts angewendet (SQL: Objekt fehlt)')
		rec.check(Array.isArray(r.data?.items) && r.data.items.length === 60 && ids.every((id) => r.data.items.some((it) => it.id === id)), 'die 61.: items trotzdem geliefert (die 60 Notizen seit rev0)', r.data?.items?.length)
		rec.check(isObj(r.data?.presence) && Object.keys(r.data.presence).some((k) => k.startsWith(`${bobPid}:`)), 'die 61.: Präsenz trotzdem geliefert (bobs Eintrag)', r.data?.presence)
		return start
	})
	// (b)
	await inOneWindow(t, '(b)', async (rec) => {
		const b = await newBoard('C76b')
		const rev0 = (await snap(alice, b)).rev
		const start = await alignWindow(alice, b, rev0)
		let since = rev0
		let okN = 0
		for (let i = 0; i < 10; i++) {
			const list = Array.from({ length: 200 }, (_, k) => sticky(ulid(), { x: (k % 20) * 210, y: (i * 10 + Math.floor(k / 20)) * 210 }))
			const r = await alice.sync(b, { client: alice.client, since, seq: ++seqN, pres: 0, ops: list })
			rec.nows.push(r.data?.now)
			if (r.status === 200 && r.data?.acks?.res?.length === 200 && r.data.acks.res.every((x) => x === 'ok')) okN++
			since = r.data?.acks?.rev ?? since
		}
		rec.check(okN === 10, '10 Anfragen mit je 200 Ops → ok (2000 Ops)', okN)
		const X = ulid()
		const r = await alice.sync(b, { client: alice.client, since, seq: ++seqN, pres: 0, ops: [sticky(X)] })
		rec.nows.push(r.data?.now)
		busyOk(rec, r, 1, 'die 11. mit 1 Op')
		const [[live]] = await stack.sql(`SELECT count(*) FROM oc_knorke_items WHERE board_id = ${b} AND deleted = 0;`)
		rec.check(Number(live) === 2000 && (await stack.itemRow(b, X)) === null, 'SQL: genau die 2000 Objekte, die 11. nicht angewendet', live)
		return start
	})
	// (c): bob (share edit) creates the frame and its 2500 children over two windows
	const bc = await newBoard('C76c')
	await saveOk(alice, bc, [u('bob', 'edit')])
	const F = ulid()
	const f0 = { x: 0, y: 0, w: 5200, h: 5200 }
	let d = await opsPaced(bob, bc, [frame(F, f0)], { since: 0 })
	let since = d.acks.rev
	const kids = Array.from({ length: 2500 }, (_, k) => sticky(ulid(), { parent: F, x: 10 + (k % 50) * 100, y: 10 + Math.floor(k / 50) * 100, w: 90, h: 90 }))
	for (let i = 0; i < kids.length; i += 200) {
		d = await opsPaced(bob, bc, kids.slice(i, i + 200), { since })
		if (!d.acks.res.every((x) => x === 'ok')) throw new Error(`C76 (c): Kinder anlegen ${i}: ${JSON.stringify(d.acks.res.filter((x) => x !== 'ok').slice(0, 3))}`)
		since = d.acks.rev ?? since
	}
	const [[nk]] = await stack.sql(`SELECT count(*) FROM oc_knorke_items WHERE board_id = ${bc} AND parent_id = '${F}' AND deleted = 0;`)
	t.check(Number(nk) === 2500, '(c) Vorbedingung: bob hat 2500 Kinder im Frame angelegt (über zwei Fenster)', nk)
	let attemptN = 0
	await inOneWindow(t, '(c)', async (rec) => {
		attemptN++
		const start = await alignWindow(alice, bc, since)
		// a repeat moves the frame back to where the first attempt took it from (keep again)
		const target = attemptN % 2 === 1 ? { x: f0.x - 100, y: f0.y - 50, parent: null, w: f0.w + 100, h: f0.h + 50 } : { ...f0, parent: null }
		const k = await alice.sync(bc, { client: alice.client, since, seq: ++seqN, pres: 0, ops: [keepPatch(F, target)] })
		rec.nows.push(k.data?.now)
		rec.check(k.status === 200 && deepEq(k.data?.acks?.res, ['ok']), 'alice: keep-patch auf den Frame mit 2500 Kindern → ok', brief(k))
		const r = await alice.sync(bc, { client: alice.client, since: k.data?.acks?.rev ?? since, seq: ++seqN, pres: 0, ops: [sticky(ulid())] })
		rec.nows.push(r.data?.now)
		busyOk(rec, r, 1, 'gleich danach 1 Op (2501 abgeleitete Zeilen über BUDGET_OPS)')
		if (Number.isInteger(k.data?.acks?.rev)) {
			const [[rows]] = await stack.sql(`SELECT count(*) FROM oc_knorke_changes WHERE board_id = ${bc} AND rev = ${k.data.acks.rev};`)
			rec.check(Number(rows) === 2501, 'keep-patch: eine changes-Zeile je Kind plus der Frame (2501)', rows)
			since = k.data.acks.rev
		}
		return start
	})
	// (d): an empty poll during busy is answered normally and creates no w: key
	await inOneWindow(t, '(d)', async (rec) => {
		const b = await newBoard('C76d')
		await member(bob, await link(b))
		const rev0 = (await snap(alice, b)).rev
		await snap(bob, b)
		const start = await alignWindow(alice, b, rev0)
		let since = rev0
		for (let i = 1; i <= 61; i++) {
			const r = await alice.sync(b, { client: alice.client, since, seq: ++seqN, pres: 0, ops: [sticky(ulid())] })
			rec.nows.push(r.data?.now)
			if (i === 61) busyOk(rec, r, 1, 'Vorbedingung: alices 61. Anfrage')
			else since = r.data?.acks?.rev ?? since
		}
		const k0 = await wKeys(b)
		const pa = await alice.sync(b, { client: alice.client, since, pres: 0 })
		rec.nows.push(pa.data?.now)
		rec.check(pa.status === 200 && pa.data?.acks === undefined && Number.isInteger(pa.data?.rev) && Number.isInteger(pa.data?.now) && pa.data?.resync !== true,
			'leerer Poll von alice während busy → normale Antwort (rev, now, keine acks)', brief(pa))
		const pbob = await bob.sync(b, { client: bob.client, since, pres: 0 })
		rec.nows.push(pbob.data?.now)
		rec.check(pbob.status === 200 && pbob.data?.acks === undefined, 'leerer Poll von bob (ohne eigene Ops) → normale Antwort', brief(pbob))
		const k1 = await wKeys(b)
		rec.check(Object.keys(k0).length >= 1 && deepEq(k1, k0), 'kein neuer Schlüssel */knorke/*/w:<b>:* und keiner verändert (leere Polls kosten nichts)', { before: k0, after: k1 })
		return start
	})
	// after the window: ok again (requests until busy, then retryMs, then the next request)
	const b = await newBoard('C76e')
	const rev0 = (await snap(alice, b)).rev
	let s2 = rev0
	let busyAt = null
	for (let i = 1; i <= 130 && busyAt === null; i++) {
		const r = await alice.sync(b, { client: alice.client, since: s2, seq: ++seqN, pres: 0, ops: [sticky(ulid())] })
		if (r.data?.acks?.res?.[0] === 'busy') busyAt = r
		else s2 = r.data?.acks?.rev ?? s2
	}
	if (t.check(busyAt !== null, 'nach Fensterende: Vorbedingung busy (≤ 130 Anfragen)')) {
		await sleep(Math.min(Math.max(busyAt.data.acks.retryMs, 100), 11000))
		const again = await alice.sync(b, { client: alice.client, since: s2, seq: ++seqN, pres: 0, ops: [sticky(ulid())] })
		t.check(again.status === 200 && deepEq(again.data?.acks?.res, ['ok']) && winOf(again.data.now) > winOf(busyAt.data.now), 'nach Fensterende (retryMs abgewartet) wieder ok', { first: busyAt.data?.acks, again: again.data?.acks })
	}
})

await C('C77', 'Snapshot-Drossel (SPEC-M1 §4.11.4 Schritt 6, §8.3 R19): (0) ratelimitReset davor und im finally; (a) 30 Snapshots von alice → 200, der 31. → 429 slow_down, retryMs 2000, Retry-After 2; (b) 30 Wiederbeitritte mit altem Token → 200, der 31. → 429; ebenso mit abgelaufenem Token (gleiche pid); (c) (Board, IP): 11 Beitritte + 289 Gast-Snapshots = 300, der 301. → 429 slow_down, nicht rate_limited', async (t) => {
	await stack.ratelimitReset() // (0)
	try {
		// (a) account, route 12
		const ba = await newBoard('C77a')
		let okN = 0
		const bad = []
		for (let i = 1; i <= 30; i++) {
			const r = await alice.snapshot(ba)
			if (r.status === 200) okN++
			else bad.push(`#${i}: ${brief(r)}`)
		}
		t.check(okN === 30, '(a) 30 Snapshots von alice in 60 s → 200', bad.slice(0, 3))
		const a31 = await alice.snapshot(ba)
		t.check(slowDown(a31) && a31.data.retryMs === 2000 && String(a31.headers?.['retry-after']) === '2', '(a) der 31. → 429 slow_down, retryMs 2000, Retry-After: 2', { status: a31.status, data: a31.data, retryAfter: a31.headers?.['retry-after'] })
		// (b) join with an old token (route 14): knorke-snap-<gid>
		const bb = await newBoard('C77b')
		const L = await link(bb)
		const g = await guest('Bea', L)
		const tok0 = g.guestToken
		let okJ = 0
		const badJ = []
		for (let i = 1; i <= 30; i++) {
			const r = await g.joinGuest(L, 'Bea', { client: g.client, guest: tok0 })
			if (r.status === 200 && r.data?.me?.pid === g.pid) okJ++
			else badJ.push(`#${i}: ${brief(r)}`)
		}
		t.check(okJ === 30, '(b) 30 Wiederbeitritte mit dem alten Token → 200, gleiche pid', badJ.slice(0, 3))
		const j31 = await g.joinGuest(L, 'Bea', { client: g.client, guest: tok0 })
		t.check(slowDown(j31), '(b) der 31. Wiederbeitritt → 429 slow_down (retryMs, Retry-After)', brief(j31))
		// (b) expired token: the link ends in 2 s, a new guest joins, the link is unlimited again
		const end = Date.now() + 2000
		await stack.sql(`UPDATE oc_knorke_links SET expires_at = ${end} WHERE board_id = ${bb} AND role = 'edit' AND revoked_at IS NULL;`)
		const e = await guest('Eva', L)
		const expTok = e.guestToken
		const exp = claimsOf(expTok).exp
		t.check(Number.isInteger(exp) && exp <= Math.floor(end / 1000), '(b) Token des neuen Gasts: exp ≤ Link-Ende', { exp, end })
		await stack.sql(`UPDATE oc_knorke_links SET expires_at = NULL WHERE board_id = ${bb} AND role = 'edit' AND revoked_at IS NULL;`)
		await sleep(3000)
		t.check(exp < Date.now() / 1000, '(b) Vorbedingung: das Token ist abgelaufen', { exp, now: Date.now() })
		await stack.ratelimitReset() // (b) after expires_at went back (R19)
		let okE = 0
		const badE = []
		for (let i = 1; i <= 30; i++) {
			const r = await e.joinGuest(L, 'Eva', { client: e.client, guest: expTok })
			if (r.status === 200 && r.data?.me?.pid === e.pid) okE++
			else badE.push(`#${i}: ${brief(r)}`)
		}
		t.check(okE === 30, '(b) 30 Wiederbeitritte mit dem abgelaufenen Token → 200 mit derselben pid', badE.slice(0, 3))
		const e31 = await e.joinGuest(L, 'Eva', { client: e.client, guest: expTok })
		t.check(slowDown(e31), '(b) der 31. mit dem abgelaufenen Token → 429 slow_down', brief(e31))
		// (c) (board, IP): knorke-snapip-<board>, 300 per 60 s over all gids
		const bcc = await newBoard('C77c')
		const L3 = await link(bcc)
		const gs = []
		for (let i = 0; i < 11; i++) gs.push(await guest(`Gc${i}`, L3))
		const per = new Map(gs.map((x) => [x, 0]))
		let calls = 11
		let okS = 0
		const badS = []
		for (let i = 0; calls < 300; i++) {
			const gg = gs[i % gs.length]
			if (per.get(gg) >= 27) continue
			const r = await gg.snapshot(bcc)
			per.set(gg, per.get(gg) + 1)
			calls++
			if (r.status === 200) okS++
			else badS.push(`#${calls}: ${brief(r)}`)
		}
		t.check(okS === 289 && Math.max(...per.values()) <= 27, '(c) 11 Beitritte + 289 Gast-Snapshots (Route 15, reihum, ≤ 27 je gid) → 200', { okS, bad: badS.slice(0, 3), max: Math.max(...per.values()) })
		const last = gs.find((x) => per.get(x) < 27) || gs[0]
		const s301 = await last.snapshot(bcc)
		t.check(slowDown(s301) && s301.data?.error !== 'rate_limited', '(c) der 301. Aufruf (Snapshot einer dieser gids) → 429 slow_down, nicht rate_limited', brief(s301))
	} finally {
		await stack.ratelimitReset().catch(() => {}) // (0)
	}
})

await C('C78', 'Grabstein-Bereinigung (SPEC-M1 §4.13.7, §8.3 R19): Grabsteine per SQL älter als die Frist, occ knorke:compact --board (Stack.purgeTombstones) → Zeilen weg, min_rev = X; since < X → resync, since ≥ X nicht; item_count/item_bytes unverändert; put + revive eines bereinigten Objekts → ok (neu angelegt), patch → gone; einmal über den Job-Weg (background-job:execute CleanupJob --force-execute) auf einem zweiten Board', async (t) => {
	const b = await newBoard('C78')
	const [A, B, K] = [ulid(), ulid(), ulid()]
	const d0 = await ops(alice, b, [sticky(A, { data: { text: 'a' } }), sticky(B, { x: 300 }), sticky(K, { x: 600 })], { since: 0 })
	const rm = await ops(alice, b, [remove(A), remove(B)], { since: d0.acks.rev })
	resIs(t, rm, ['ok', 'ok'], 'remove A, B → zwei Grabsteine')
	const X = rm.acks.rev
	const d2 = await ops(alice, b, [patch(K, { 'data.text': 'k' })], { since: X })
	const before = await stack.boardRow(b)
	t.check(before && before.min_rev < X && before.rev === d2.acks.rev, 'Vorbedingung: min_rev < X < rev', { before, X })
	let p = null
	try {
		p = await stack.purgeTombstones(b, 0)
	} catch (e) {
		t.check(false, 'Stack.purgeTombstones(b, 0): Rückdatierung + occ knorke:compact --board läuft (WP-B4)', String(e.message).slice(0, 300))
		return
	}
	t.check(COMPACT_KEYS.every((k) => Number.isInteger(p[k])) && p.board === Number(b), 'compact --board: eine JSON-Zeile mit board, blocks, tombstones, changes, minRevBefore, minRev (§4.13.7 (d))', p)
	t.check(p.backdated === 2 && p.tombstones === 2 && p.minRev === X && p.minRevBefore === before.min_rev, 'zwei Grabsteine rückdatiert und bereinigt, minRev = X', { p, X })
	const gone = await stack.sql(`SELECT id FROM oc_knorke_items WHERE board_id = ${b} AND id IN ('${A}', '${B}');`)
	t.check(gone.length === 0, 'SQL: die Zeilen von A und B sind weg', gone)
	const after = await stack.boardRow(b)
	t.check(after?.min_rev === X && after.rev === before.rev, 'SQL: min_rev = X, rev unverändert', { after, X })
	t.check(after?.item_count === before.item_count && after?.item_bytes === before.item_bytes, 'item_count/item_bytes unverändert', { before, after })
	let r = await rawSync(alice, b, { since: X - 1 })
	t.check(r.status === 200 && r.data?.resync === true, 'Client mit since < X → resync', brief(r))
	r = await rawSync(alice, b, { since: X })
	t.check(r.status === 200 && r.data?.resync !== true, 'Client mit since = X → kein resync', brief(r))
	const rv = sticky(A, { data: { text: 'wieder da' } })
	rv.revive = true
	const pr = await ops(alice, b, [rv], { since: after.rev })
	resIs(t, pr, ['ok'], 'put + revive des bereinigten A → ok (neu angelegt)')
	const ra = await stack.itemRow(b, A)
	t.check(ra && ra.deleted === 0 && ra.version === 1, 'SQL: A lebt wieder, Version 1 (neu angelegt)', ra)
	resIs(t, await ops(alice, b, [patch(B, { 'data.text': 'b' })], { since: pr.acks.rev }), ['gone'], 'patch auf das bereinigte B → gone')
	// the job path (R19, T4-06): a second board, backdated tombstones, CleanupJob
	const b2 = await newBoard('C78job')
	const [E, G] = [ulid(), ulid()]
	const e0 = await ops(alice, b2, [sticky(E), sticky(G, { x: 300 })], { since: 0 })
	const e1 = await ops(alice, b2, [remove(E)], { since: e0.acks.rev })
	const X2 = e1.acks.rev
	const bd = await stack.backdateTombstones(b2, 0)
	t.check(bd.backdated === 1, 'Job-Weg: Grabstein von E rückdatiert (SQL)', bd)
	// the job's clock is ITimeFactory::getTime() (whole seconds): one second later its cut lies beyond the backdated row
	await sleep(1100)
	const listed = await stack.occ('background-job:list', '--class=OCA\\Knorke\\BackgroundJob\\CleanupJob', '--output=json').catch((e) => `FEHLER ${e.message}`)
	let jobs = null
	try { jobs = JSON.parse(listed.slice(listed.search(/[[{]/))) } catch { /* not JSON */ }
	const job = (Array.isArray(jobs) ? jobs : Object.values(jobs || {})).find((j) => isObj(j) && /CleanupJob$/.test(String(j.class ?? '')))
	t.check(job && /^\d+$/.test(String(job.id)), 'Job-Weg: occ background-job:list --class=…CleanupJob → id', listed.slice(0, 300))
	if (job) {
		const out = await stack.occ('background-job:execute', String(job.id), '--force-execute').catch((e) => `FEHLER ${e.message}`)
		t.check(!/^FEHLER/.test(out), 'Job-Weg: occ background-job:execute <id> --force-execute läuft', out.slice(0, 300))
	}
	const row2 = await stack.boardRow(b2)
	const eRow = await stack.itemRow(b2, E)
	t.check(eRow === null && row2?.min_rev === X2, 'Job-Weg: Zeile von E weg, min_rev = X2 (SQL)', { eRow, row2, X2 })
	r = await rawSync(alice, b2, { since: X2 - 1 })
	t.check(r.status === 200 && r.data?.resync === true, 'Job-Weg: Client mit since < X2 → resync', brief(r))
})

await C('C79', 'changes-Deckel (SPEC-M1 §4.13.7, §8.3 R19): changes_cap = 50 über den Stack-Helfer (occ config:app:set), 120 Anfragen mit je einem patch (eine Zeile je rev), occ knorke:compact --board → genau 50 Zeilen, ihre revs sind die 50 höchsten (SQL); im finally gelöscht und 4 s Pause', async (t) => {
	const b = await newBoard('C79')
	try {
		await stack.occ('config:app:set', 'knorke', 'changes_cap', '--value=50')
		const N = ulid()
		let d = await opsPaced(alice, b, [sticky(N)], { since: 0 })
		let since = d.acks.rev
		let okN = 0
		for (let i = 1; i <= 120; i++) {
			d = await opsPaced(alice, b, [patch(N, { 'data.text': `v${i}` })], { since })
			if (deepEq(d.acks.res, ['ok'])) okN++
			since = d.acks.rev ?? since
		}
		t.check(okN === 120, '120 Anfragen mit je einem patch → ok (busy abgewartet)', okN)
		const all = (await stack.sql(`SELECT rev FROM oc_knorke_changes WHERE board_id = ${b} ORDER BY rev DESC;`)).map(([x]) => Number(x))
		t.check(all.length === 121 && new Set(all).size === 121, 'Vorbedingung: 121 changes-Zeilen, eine je rev (put + 120 patches)', all.length)
		let lines = null
		try {
			lines = await stack.compact(`--board=${b}`)
		} catch (e) {
			t.check(false, 'occ knorke:compact --board läuft (WP-B4)', String(e.message).slice(0, 300))
			return
		}
		const line = lines.find((l) => String(l.board) === String(b))
		t.check(line && line.changes === 71 && line.tombstones === 0, 'compact --board: JSON-Zeile mit changes 71, tombstones 0', lines)
		const left = (await stack.sql(`SELECT rev FROM oc_knorke_changes WHERE board_id = ${b} ORDER BY rev DESC;`)).map(([x]) => Number(x))
		t.check(left.length === 50 && deepEq(left, all.slice(0, 50)), 'genau 50 Zeilen, ihre revs sind die 50 höchsten (SQL)', { left: left.length, first: left[0], last: left[left.length - 1], want: [all[0], all[49]] })
	} finally {
		await stack.occ('config:app:delete', 'knorke', 'changes_cap').catch(() => {})
		await sleep(4000)
	}
})

// ── P7-C (SPEC-M1 §33.1 k, Revision 22): link throttle, byte limits, presence cap, public_url ──

/** Link rows of a board as comparable lines (id, role, created_at, revoked_at, expires_at, password set) – never the token or the hash. */
async function linkRows(b) {
	return (await stack.sql(`SELECT id, role, created_at, revoked_at, expires_at, CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END FROM oc_knorke_links WHERE board_id = ${b} ORDER BY id;`))
		.map((r) => r.map((v) => (v === null ? 'NULL' : v)).join('|'))
}

await C('C80', 'Link-Drossel link_limit (P7-03, SPEC-M1 §33.1 d, k): (0) link_limit = 20 über den Stack-Helfer, 4 s, ratelimitReset; (a) bob 25 × Route 9 auf alices Board → je 404, nie 429, danach bob auf seinem eigenen Board → 200; (b) alice 20 schreibende Link-Aufrufe (Routen 9, 10, 17, 18 gemischt) → je 200, der 21. (Route 9) → 429 {slow_down, retryMs 30000}, Retry-After 30, Link-Zeilen unverändert (SQL); (c) alice 3 × GET shares → 200; finally Grundstand, 4 s, ratelimitReset', async (t) => {
	try {
		// (0)
		await stack.occ('config:app:set', 'knorke', 'link_limit', '--value=20')
		await sleep(APPCONFIG_SETTLE_MS)
		await stack.ratelimitReset()
		const b = await newBoard('C80')
		// (a) strangers are answered 404 by the owner check (§4.11.2 step 1) and use up nothing
		const seen = {}
		for (let i = 0; i < 25; i++) {
			const r = await bob.postLink(b, {})
			seen[r.status] = (seen[r.status] || 0) + 1
		}
		t.check(seen[404] === 25, '(a) bob (fremd) 25 × Route 9 auf alices Board → je 404, nie 429 (gezählt wird erst nach der Besitzerprüfung)', seen)
		const own = await newBoardOf(bob, 'C80 bob')
		const ro = await bob.postLink(own, {})
		t.check(ro.status === 200 && /^[A-Za-z0-9]{24}$/.test(String(ro.data?.link?.token ?? '')), '(a) danach bob Route 9 auf seinem eigenen Board → 200 (sein Budget ist unberührt)', brief(ro))
		// (b) 20 writing calls of alice, routes 9, 17, 9 rotate, 10, 18 in turn
		const calls = [
			['Route 9 POST {}', () => alice.postLink(b, {})],
			['Route 17 POST {}', () => alice.postLink(b, {}, 'vote')],
			['Route 9 POST {rotate: true}', () => alice.postLink(b, { rotate: true })],
			['Route 10 DELETE', () => alice.deleteLink(b)],
			['Route 18 DELETE', () => alice.deleteLink(b, 'vote')],
		]
		const bad = []
		for (let i = 0; i < 20; i++) {
			const [label, call] = calls[i % calls.length]
			const r = await call()
			if (r.status !== 200) bad.push(`#${i + 1} ${label}: ${r.status} ${r.data?.error ?? ''}`)
		}
		t.check(bad.length === 0, '(b) alice: 20 schreibende Link-Aufrufe (9, 17, 9 rotate, 10, 18 im Wechsel) → je 200', bad.slice(0, 3))
		const rows0 = await linkRows(b)
		const r21 = await alice.postLink(b, {})
		t.check(r21.status === 429 && r21.data?.error === 'slow_down' && r21.data?.retryMs === 30000 && String(r21.headers?.['retry-after']) === '30' && !('reason' in (r21.data || {})),
			'(b) der 21. (Route 9 POST {}) → 429 {error: slow_down, retryMs: 30000}, Retry-After: 30, kein reason', { status: r21.status, error: r21.data?.error, retryMs: r21.data?.retryMs, retryAfter: r21.headers?.['retry-after'] })
		const rows1 = await linkRows(b)
		t.check(rows0.length > 0 && deepEq(rows1, rows0), '(b) die Link-Zeilen des Boards sind unverändert (SQL: id, role, created_at, revoked_at, expires_at, Passwort ja/nein)', { before: rows0, after: rows1 })
		// (c) reading is never throttled
		const reads = []
		for (let i = 0; i < 3; i++) reads.push((await alice.listShares(b)).status)
		t.check(deepEq(reads, [200, 200, 200]), '(c) danach alice 3 × GET shares (Route 19) → je 200 (Lesen wird nie gedrosselt)', reads)
	} finally {
		await toBaseline('link_limit').catch(() => {})
		await sleep(4000)
		await stack.ratelimitReset().catch(() => {})
	}
})

/** Fixed day window of the byte quotas (§33.1 b). */
const DAY_MS = 86400000
/** acks.retryMs of a quota answer from `now` of the same answer: min(rest of the UTC day, 60000) + 100 (§33.1 b). */
const dayRetry = (now) => Math.min((Math.floor(now / DAY_MS) + 1) * DAY_MS - now, 60000) + 100

/**
 * A sync with ops whose request body is exactly `size` bytes (the quotas count
 * the raw body, §33.1 b): one sticky put, its text padded. Client.sync sends
 * {proto, ep, …body}; the same object is measured here. Never throws.
 */
async function sizedSync(c, b, size, since) {
	const id = ulid()
	const op = sticky(id, { data: { text: '' } })
	const body = { client: c.client, since, pres: 0, seq: ++seqN, ops: [op] }
	const bytes = () => Buffer.byteLength(JSON.stringify({ proto: PROTOCOL, ep: c.ep, ...body }), 'utf8')
	op.p.data.text = 'q'.repeat(Math.max(0, size - bytes()))
	const sent = bytes()
	const r = await c.sync(b, body)
	return { r, id, bytes: sent }
}

/** The quota answer of §33.1 b: every result busy, acks.rev null, retryMs from `now` of the same answer. */
function dayBusy(r, n) {
	const a = r.data?.acks
	return r.status === 200 && deepEq(a?.res, Array(n).fill('busy')) && a?.rev === null && Number.isInteger(r.data?.now) && a?.retryMs === dayRetry(r.data.now) && a.retryMs <= 60100
}
const busyInfo = (q) => ({ status: q.r.status, acks: q.r.data?.acks, now: q.r.data?.now, want: Number.isInteger(q.r.data?.now) ? dayRetry(q.r.data.now) : null, bytes: q.bytes })

await C('C81', 'Byte-Grenzen (P7-01, SPEC-M1 §33.1 b, c, k): (a) Notiz mit ≥ 50 000 Byte data + style, remove → Grabstein mit octet_length(data) + octet_length(style) = 4, type, Lage, parent_id, z unverändert, put-Zeile im Protokoll ≥ 50 000 Byte, put + revive → ok und vollständig; (b) budget_bytes_board_day = 4000: zwei Anfragen à 1500 Byte ok, die 3. busy (retryMs = min(Tagesrest, 60000) + 100), nichts angewendet, leerer Poll normal, anderes Board ok; (c) budget_bytes_user_day = 4000: alice 2 × ok auf B1, die nächste auf B2 busy, bob ok; (d) changes_bytes_cap = 20000, 40 patches à ≈ 1000 Byte, compact --board → Rest ≤ 20000 aus den neuesten revs, die nächstältere Zeile hätte nicht mehr gepasst, changes = gelöschte Zeilen; finally Grundstand, 4 s, ratelimitReset', async (t) => {
	try {
		// (a) a tombstone keeps no payload (§33.1 c); the payload stays in the put row of the change log
		const ba = await newBoard('C81a')
		const [F, X] = [ulid(), ulid()]
		// 6000 four-byte characters where the database keeps them (three-byte ones otherwise, C48), plus unknown style keys
		const ch = stack.supports4Byte ? '\u{1F600}' : '€'
		const bigData = { text: ch.repeat(6000) }
		const bigStyle = { fill: '#a8d8f8' }
		for (let k = 0; k < 7; k++) bigStyle[`kdPad${k}`] = 'z'.repeat(4800)
		const full = (p = {}) => sticky(X, { parent: F, x: 40, y: 60, w: 300, h: 300, data: bigData, style: bigStyle, ...p })
		const d0 = await ops(alice, ba, [frame(F, { x: 0, y: 0, w: 800, h: 600 }), full()], { since: 0 })
		resIs(t, d0, ['ok', 'ok'], '(a) put Frame F und Notiz X in F (≥ 50 000 Byte data + style)')
		const cols = "type, x, y, w, h, rotation, parent_id, z, deleted, octet_length(coalesce(data, '')) + octet_length(coalesce(style, ''))"
		const before = await stack.sqlRow(`SELECT ${cols} FROM oc_knorke_items WHERE board_id = ${ba} AND id = '${X}';`)
		t.check(before && Number(before[9]) >= 50000 && Number(before[8]) === 0, '(a) Vorbedingung: X gespeichert mit ≥ 50 000 Byte data + style (SQL)', before && { deleted: before[8], bytes: before[9] })
		const d1 = await ops(alice, ba, [remove(X)], { since: d0.acks.rev })
		resIs(t, d1, ['ok'], '(a) remove X → ok')
		const after = await stack.sqlRow(`SELECT ${cols} FROM oc_knorke_items WHERE board_id = ${ba} AND id = '${X}';`)
		t.check(after && Number(after[8]) === 1 && Number(after[9]) === 4, '(a) Grabstein: deleted = 1, octet_length(data) + octet_length(style) = 4 (data = style = {})', after && { deleted: after[8], bytes: after[9] })
		t.check(before && after && deepEq(after.slice(0, 8), before.slice(0, 8)), '(a) Grabstein: type, x, y, w, h, rotation, parent_id und z unverändert (SQL)', { before: before?.slice(0, 8), after: after?.slice(0, 8) })
		const putRow = await stack.sqlRow(`SELECT count(*), max(octet_length(patch)) FROM oc_knorke_changes WHERE board_id = ${ba} AND item_id = '${X}' AND op = 'put';`)
		t.check(putRow && Number(putRow[0]) === 1 && Number(putRow[1]) >= 50000, '(a) die put-Zeile von X in oc_knorke_changes behält ≥ 50 000 Byte patch (die Nutzlast bleibt im Protokoll)', putRow)
		const rv = full()
		rv.revive = true
		const d2 = await ops(alice, ba, [rv], { since: d1.acks.rev })
		resIs(t, d2, ['ok'], '(a) put + revive mit dem vollen Objekt → ok')
		const stored = await stack.itemStored(ba, X)
		let same = false
		try { same = JSON.parse(stored.data).text === bigData.text && canon(JSON.parse(stored.style)) === canon(bigStyle) } catch { /* not JSON */ }
		const back = await stack.sqlRow(`SELECT deleted, octet_length(coalesce(data, '')) + octet_length(coalesce(style, '')) FROM oc_knorke_items WHERE board_id = ${ba} AND id = '${X}';`)
		t.check(same && back && Number(back[0]) === 0 && Number(back[1]) === Number(before?.[9]), '(a) nach revive: X lebt, data und style wieder vollständig (SQL, gleiche Byte-Zahl)', back)

		// (b) board quota: 4000 bytes per board and UTC day
		await stack.occ('config:app:set', 'knorke', 'budget_bytes_board_day', '--value=4000')
		await sleep(APPCONFIG_SETTLE_MS)
		await stack.ratelimitReset()
		const bb = await newBoard('C81b')
		const q1 = await sizedSync(alice, bb, 1500, 0)
		const q2 = await sizedSync(alice, bb, 1500, q1.r.data?.acks?.rev ?? 0)
		t.check(q1.bytes === 1500 && q2.bytes === 1500 && deepEq(q1.r.data?.acks?.res, ['ok']) && deepEq(q2.r.data?.acks?.res, ['ok']),
			'(b) budget_bytes_board_day = 4000: die 1. und 2. Anfrage (je 1500 Byte Body) → ok', { q1: q1.r.data?.acks, q2: q2.r.data?.acks, bytes: [q1.bytes, q2.bytes] })
		const sinceB = q2.r.data?.acks?.rev ?? 0
		const q3 = await sizedSync(alice, bb, 1500, sinceB)
		t.check(dayBusy(q3.r, 1), '(b) die 3. (4500 > 4000) → busy für alle Ops, acks.rev null, acks.retryMs = min((⌊now/86400000⌋ + 1)·86400000 − now, 60000) + 100 mit now derselben Antwort (≤ 60 100)', busyInfo(q3))
		t.check((await stack.itemRow(bb, q3.id)) === null, '(b) die 3.: nichts angewendet (SQL: Objekt fehlt)')
		const poll = await alice.sync(bb, { client: alice.client, since: sinceB, pres: 0 })
		t.check(poll.status === 200 && poll.data?.acks === undefined && Number.isInteger(poll.data?.rev) && Number.isInteger(poll.data?.now) && poll.data?.resync !== true,
			'(b) ein leerer Poll danach → normale Antwort (rev, now, keine acks)', brief(poll))
		const bb2 = await newBoard('C81b2')
		const q4 = await sizedSync(alice, bb2, 1500, 0)
		t.check(deepEq(q4.r.data?.acks?.res, ['ok']), '(b) dasselbe Konto auf einem anderen Board → ok (Quote je Board)', q4.r.data?.acks)

		// (c) account quota: 4000 bytes per account and UTC day over all boards
		await toBaseline('budget_bytes_board_day')
		await stack.occ('config:app:set', 'knorke', 'budget_bytes_user_day', '--value=4000')
		await sleep(APPCONFIG_SETTLE_MS)
		await stack.ratelimitReset()
		const [c1, c2] = [await newBoard('C81c1'), await newBoard('C81c2')]
		const u1 = await sizedSync(alice, c1, 1500, 0)
		const u2 = await sizedSync(alice, c1, 1500, u1.r.data?.acks?.rev ?? 0)
		t.check(deepEq(u1.r.data?.acks?.res, ['ok']) && deepEq(u2.r.data?.acks?.res, ['ok']), '(c) budget_bytes_user_day = 4000: alice zweimal (je 1500 Byte) auf B1 → ok', { u1: u1.r.data?.acks, u2: u2.r.data?.acks })
		const u3 = await sizedSync(alice, c2, 1500, 0)
		t.check(dayBusy(u3.r, 1), '(c) die nächste Anfrage von alice auf B2 → busy (Kontoquote über alle Boards), acks.rev null, retryMs wie (b)', busyInfo(u3))
		t.check((await stack.itemRow(c2, u3.id)) === null, '(c) auf B2 nichts angewendet (SQL)')
		const bobB = await newBoardOf(bob, 'C81 bob')
		const ub = await sizedSync(bob, bobB, 1500, 0)
		t.check(deepEq(ub.r.data?.acks?.res, ['ok']), '(c) bob auf seinem eigenen Board → ok (Quote je Konto)', ub.r.data?.acks)

		// (d) byte cap of the change log: 20000 bytes per board after compact
		await toBaseline('budget_bytes_user_day')
		await stack.occ('config:app:set', 'knorke', 'changes_bytes_cap', '--value=20000')
		await sleep(APPCONFIG_SETTLE_MS)
		await stack.ratelimitReset()
		const bd = await newBoard('C81d')
		const N = ulid()
		let d = await opsPaced(alice, bd, [sticky(N)], { since: 0 })
		let since = d.acks.rev
		let okN = 0
		for (let i = 1; i <= 40; i++) {
			d = await opsPaced(alice, bd, [patch(N, { 'data.text': `v${i}-` + 'p'.repeat(1000) })], { since })
			if (deepEq(d.acks.res, ['ok'])) okN++
			since = d.acks.rev ?? since
		}
		t.check(okN === 40, '(d) 40 Anfragen mit je einem patch von ≈ 1000 Byte → ok', okN)
		const sizes = async () => (await stack.sql(`SELECT rev, coalesce(octet_length(patch), 0) FROM oc_knorke_changes WHERE board_id = ${bd} ORDER BY rev DESC;`)).map(([r, n]) => [Number(r), Number(n)])
		const all = await sizes()
		const revs = all.map(([r]) => r)
		if (!t.check(all.length === 41 && new Set(revs).size === 41 && all.every(([, n]) => n > 0), '(d) Vorbedingung: 41 changes-Zeilen, eine je rev (put + 40 patches), jede mit patch (SQL davor)', all.length)) return
		// what §33.1 c keeps: the newest revs whose sum stays ≤ the cap (the newest rev always)
		let keep = 0
		let sum = 0
		while (keep < all.length && (keep === 0 || sum + all[keep][1] <= 20000)) sum += all[keep++][1]
		let lines = null
		try {
			lines = await stack.compact(`--board=${bd}`)
		} catch (e) {
			t.check(false, '(d) occ knorke:compact --board läuft', String(e.message).slice(0, 300))
			return
		}
		const line = lines.find((l) => String(l.board) === String(bd))
		const left = await sizes()
		const leftSum = left.reduce((s, [, n]) => s + n, 0)
		t.check(left.length > 0 && leftSum <= 20000, '(d) nach compact --board: Σ octet_length(patch) der verbliebenen Zeilen ≤ 20000 (SQL danach)', { rows: left.length, sum: leftSum })
		t.check(deepEq(left.map(([r]) => r), revs.slice(0, left.length)), '(d) die verbliebenen Zeilen sind die neuesten revs', { left: left.map(([r]) => r), newest: revs.slice(0, left.length) })
		t.check(left.length < all.length && leftSum + all[left.length][1] > 20000, '(d) mit der nächstälteren gelöschten Zeile läge die Summe über 20000', { sum: leftSum, next: all[left.length]?.[1] })
		t.check(left.length === keep, `(d) genau die ${keep} neuesten Zeilen bleiben (größte Menge neuester revs mit Summe ≤ 20000)`, { kept: left.length, want: keep })
		t.check(line && line.changes === all.length - left.length, '(d) compact --board: JSON-Zeile mit changes = Zahl der gelöschten Zeilen', { line, deleted: all.length - left.length })
	} finally {
		for (const key of ['budget_bytes_board_day', 'budget_bytes_user_day', 'changes_bytes_cap']) await toBaseline(key).catch(() => {})
		await sleep(4000)
		await stack.ratelimitReset().catch(() => {})
	}
})

await C('C82', 'Präsenz-Kappung (P7-04, SPEC-M1 §33.1 f, k): alice hält die Text-Lease auf X (Client A1), Client A2 startet „Alle zu mir“ (Route 25) und schreibt {v}; 70 Gäste über den Abstimm-Link, danach je ein Sync mit me {c} kurz hintereinander, dann je ein Keepalive von A1 und A2; bob (Freigabe edit): Text-patch auf X → locked, bobs presence enthält A1 mit e = X und h = 1 und den Schlüssel <pid>:<client> aus meta.summon, höchstens 50 Einträge mit g = 1', async (t) => {
	const b = await newBoard('C82')
	await saveOk(alice, b, [u('bob', 'edit')])
	const X = ulid()
	const d0 = await ops(alice, b, [sticky(X, { data: { text: 'alice tippt' } })], { since: 0 })
	const rev0 = d0.acks.rev
	const [A1, A2] = [clientId(), clientId()]
	const meA1 = { c: [10, 10], s: [X], d: [], e: X }
	const view = { v: [0, 0, 1600, 900] }
	// A1 opens the editor on X: the text lease (me.e = X, tk)
	let r = await alice.sync(b, { client: A1, since: rev0, pres: 1, me: { ...meA1, tk: 1 } })
	if (!t.check(r.status === 200, 'Vorbedingung: A1 (alice) schreibt me.e = X mit tk (Text-Lease)', brief(r))) return
	const ctl = await bob.sync(b, { client: bob.client, since: rev0, pres: 1, seq: ++seqN, ops: [patch(X, { 'data.text': 'bob (Kontrolle)' })] })
	if (!t.check(deepEq(ctl.data?.acks?.res, ['locked']), 'Kontrolle: bobs Text-patch auf X, solange A1 die Lease hält → locked', ctl.data?.acks)) return
	const sm = await alice.summon(b, { client: A2 })
	const sum = sm.data?.board?.meta?.summon
	if (!t.check(modOk(sm) && isObj(sum) && sum.client === A2 && typeof sum.pid === 'string' && sum.pid.length > 0, 'Vorbedingung: A2 startet „Alle zu mir“ (Route 25) → meta.summon {pid, client A2}', brief(sm))) return
	const summonKey = `${sum.pid}:${sum.client}`
	const a1Key = `${sum.pid}:${A1}`
	r = await alice.sync(b, { client: A2, since: rev0, pres: 1, me: view })
	if (!t.check(r.status === 200, 'Vorbedingung: A2 schreibt {v} (Präsentierender)', brief(r))) return
	// 70 guests through the voting link (below the guest budget of 300 and the join throttle of 300 per 60 s)
	const vt = await voteLink(b)
	const guests = []
	for (let i = 1; i <= 70; i++) guests.push(await guest(`Wähler ${i}`, vt))
	t.check(guests.length === 70 && guests.every((x) => typeof x.pid === 'string'), '70 Gäste treten über den Abstimm-Link bei → 200', guests.length)
	// one presence write each, in quick succession (ten at a time)
	const t0 = Date.now()
	const st = {}
	for (let i = 0; i < guests.length; i += 10) {
		const part = await Promise.all(guests.slice(i, i + 10).map((x, k) => x.sync(b, { client: x.client, since: x.joinAnswer?.rev ?? rev0, pres: 0, me: { c: [100 + i + k, 100] } })))
		for (const p of part) st[p.status] = (st[p.status] || 0) + 1
	}
	const writeMs = Date.now() - t0
	t.check(st[200] === 70, '70 Gäste: je ein Sync mit me {c} → 200', st)
	t.note(`70 Präsenz-Schreibvorgänge der Gäste in ${writeMs} ms`)
	// one keepalive each of A1 (the same me, no tk) and A2 ({v})
	const k1 = await alice.sync(b, { client: A1, since: rev0, pres: 1, me: meA1 })
	const k2 = await alice.sync(b, { client: A2, since: rev0, pres: 1, me: view })
	t.check(k1.status === 200 && k2.status === 200, 'Keepalive von A1 und A2 → 200', [k1.status, k2.status])
	const after = await bob.sync(b, { client: bob.client, since: rev0, pres: 1, seq: ++seqN, ops: [patch(X, { 'data.text': 'bob nach der Flut' })] })
	t.note(`bobs Prüfung ${Date.now() - t0} ms nach dem ersten Präsenz-Schreibvorgang der Gäste`)
	t.check(deepEq(after.data?.acks?.res, ['locked']), 'bob: Text-patch auf X → locked (A1 hält die Lease weiter)', after.data?.acks)
	const pres = isObj(after.data?.presence) ? after.data.presence : {}
	const e1 = pres[a1Key]
	t.check(isObj(e1) && e1.e === X && e1.h === 1, 'bobs presence enthält A1 (<pid>:<A1>) mit e = X und h = 1', { found: isObj(e1), e: e1?.e === X, h: e1?.h, entries: Object.keys(pres).length })
	t.check(isObj(pres[summonKey]), 'bobs presence enthält den Schlüssel <pid>:<client> aus meta.summon (A2)', { summonKey: summonKey.split(':')[1], entries: Object.keys(pres).length })
	const guestsSeen = Object.values(pres).filter((x) => isObj(x) && x.g === 1).length
	t.check(guestsSeen <= 50, 'höchstens 50 Einträge mit g = 1 (Teil-Limit der Nicht-Bearbeiter, PresenceStore::MAX_VOTE_ENTRIES)', { guests: guestsSeen, entries: Object.keys(pres).length })
	t.note(`bobs presence: ${Object.keys(pres).length} Einträge, davon ${guestsSeen} mit g = 1`)
})

/** A link URL with the token cut to its first 4 characters (reports never carry whole tokens). */
const cutUrl = (url) => (typeof url === 'string' ? url.replace(/\/p\/([A-Za-z0-9]{4})[A-Za-z0-9]*/, '/p/$1…') : url)

await C('C83', 'public_url (P7-16, SPEC-M1 §33.1 h, k): (a) ohne Schlüssel links.edit.url und links.vote.url (Route 19) mit dem Ursprung der Anfrage; (b) public_url = https://knorke-harness.example.org/ (Stack-Helfer, 4 s): Route 19, Route 9 (POST ohne Änderung) und board.links im Snapshot → https://knorke-harness.example.org + Pfad aus (a), ohne den Host der Anfrage; (c) ungültig (ohne Schema, ftp://, mit Pfad /x) → wie (a); (d) gelöscht → wie (a); finally gelöscht, 4 s', async (t) => {
	const PUB = 'https://knorke-harness.example.org'
	const setPub = async (v) => {
		if (v === null) await stack.occ('config:app:delete', 'knorke', 'public_url').catch(() => {})
		else await stack.occ('config:app:set', 'knorke', 'public_url', `--value=${v}`)
		await sleep(APPCONFIG_SETTLE_MS)
	}
	try {
		const b = await newBoard('C83')
		const LE = await link(b)
		const LV = await voteLink(b)
		const urls = async () => {
			const r = await alice.listShares(b)
			return { status: r.status, edit: r.data?.links?.edit?.url ?? null, vote: r.data?.links?.vote?.url ?? null }
		}
		const show = (x) => ({ ...x, edit: cutUrl(x.edit), vote: cutUrl(x.vote) })
		const parts = (url) => { try { const x = new URL(url); return { origin: x.origin, host: x.host, path: x.pathname + x.search } } catch { return null } }
		// (a)
		const a = await urls()
		const pe = parts(a.edit)
		const pv = parts(a.vote)
		const reqHost = env.host || 'localhost'
		if (!t.check(a.status === 200 && pe && pv && pe.host === reqHost && pv.host === reqHost && pe.path.endsWith(`/p/${LE}`) && pv.path.endsWith(`/p/${LV}`),
			'(a) ohne public_url: links.edit.url und links.vote.url (Route 19) mit dem Ursprung der Anfrage (Host localhost), Pfad …/p/<token>', show(a))) return
		const wantE = PUB + pe.path
		const wantV = PUB + pv.path
		// (b)
		await setPub(`${PUB}/`)
		const s19 = await urls()
		t.check(s19.status === 200 && s19.edit === wantE && s19.vote === wantV, '(b) public_url = https://knorke-harness.example.org/: Route 19 liefert url = https://knorke-harness.example.org + Pfad aus (a) für edit und vote', { got: show(s19), want: { edit: cutUrl(wantE), vote: cutUrl(wantV) } })
		const r9 = await alice.postLink(b, {})
		t.check(r9.status === 200 && r9.data?.link?.token === LE && r9.data?.link?.url === wantE, '(b) Route 9 (POST ohne Änderung): derselbe Link, url mit dem öffentlichen Ursprung', { status: r9.status, url: cutUrl(r9.data?.link?.url) })
		const sn = await alice.snapshot(b)
		const bl = sn.data?.board?.links
		t.check(sn.status === 200 && bl?.edit?.url === wantE && bl?.vote?.url === wantV, '(b) Snapshot: board.links.edit.url und .vote.url mit dem öffentlichen Ursprung', { edit: cutUrl(bl?.edit?.url), vote: cutUrl(bl?.vote?.url) })
		const all = [s19.edit, s19.vote, r9.data?.link?.url, bl?.edit?.url, bl?.vote?.url]
		t.check(all.every((x) => typeof x === 'string' && parts(x)?.host === 'knorke-harness.example.org' && !x.includes(reqHost)), '(b) keine dieser URLs trägt den Host der Anfrage', all.map(cutUrl))
		// (c) invalid values: as (a)
		for (const bad of ['knorke-harness.example.org', 'ftp://knorke-harness.example.org', `${PUB}/x`]) {
			await setPub(bad)
			const c = await urls()
			t.check(c.status === 200 && c.edit === a.edit && c.vote === a.vote, `(c) public_url = ${bad} (ungültig) → url wie (a), Host der Anfrage`, show(c))
		}
		// (d) deleted: as (a)
		await setPub(null)
		const dd = await urls()
		t.check(dd.status === 200 && dd.edit === a.edit && dd.vote === a.vote, '(d) public_url gelöscht → url wie (a)', show(dd))
	} finally {
		await stack.occ('config:app:delete', 'knorke', 'public_url').catch(() => {})
		await sleep(4000)
	}
})

// ── Job 023 (M2, SPEC-M1 §1.2 "(R20) Sperren"): locked items ────────────────

/** The lock op as a client sends it (the server never reads its content) and the unlock op. */
const lockOp = (id) => patch(id, { lock: { by: 'not-read', name: 'not read' } })
const unlockOp = (id) => patch(id, { lock: null })
const whoCache = new Map()
/** {pid, name} of a client on a board (its snapshot `me`, cached per client and board). */
async function whoOf(c, b) {
	const k = c.name + ':' + (c.guestToken ? gidOf(c.guestToken) : '') + ':' + b
	if (!whoCache.has(k)) {
		const me = (await snap(c, b)).me ?? {}
		whoCache.set(k, { pid: me.pid ?? null, name: me.name ?? null })
	}
	return whoCache.get(k)
}
/** The comparable parts of an item: placement, size, z, data, style (the lock left out). */
const bodyOf = (it) => (it ? JSON.stringify([it.x, it.y, it.w, it.h, it.r, it.z, it.parent, it.data, it.style]) : null)

await C('C84', 'Rechte-Matrix Sperren (Job 023, M2 R20): (a) owner, „Darf moderieren“, edit und Gast des Bearbeitungslinks sperren → ok, jede Rolle (auch vote, view, Gast) sieht lock {by: pid, name}; vote/view → denied; (b) jeder entsperrt die eigene Sperre; (c) fremde Sperre: edit/Gast → itemlocked, owner/Moderation → ok, vote/view → denied; (d) jede Änderung (Lage, Größe, Stil, Text, z, remove) an einer gesperrten Notiz → itemlocked für alle, Objekt unverändert; (e) Gast-Identität weg (neuer Browser) → itemlocked, owner → ok; Wiederbeitritt mit altem Token nach erneuertem Link → dieselbe gid, eigene Sperre → ok; (f) Recht verloren (bob → view) → denied, carol entsperrt; (g) gesperrter Frame als Elternteil, gesperrte Notiz als Verbinder-Ende, Stimme auf gesperrte Notiz → ok', async (t) => {
	const temps = await tempUsers('cl', 2)
	try {
		const carol = await carolClient()
		const b = await newBoard('C84')
		const shares = (bobRole) => [u('carol', 'moderate'), u('bob', bobRole), u(temps[0], 'vote'), u(temps[1], 'view')]
		await saveOk(alice, b, shares('edit'))
		const voter = await new Client(env, temps[0]).login(temps[0])
		voter.client = clientId()
		const viewer = await new Client(env, temps[1]).login(temps[1])
		viewer.client = clientId()
		const L = await link(b)
		const gina = await guest('Gina', L)
		const [NA, NC, NB, NG, NM, N0, NP, F, K] = Array.from({ length: 9 }, () => ulid())
		resIs(t, await opsNoSnap(alice, b, [sticky(NA, { x: 0 }), sticky(N0, { x: 300 }), frame(F, { x: 2000, y: 0 })]), ['ok', 'ok', 'ok'], 'alice legt NA, N0 und den Frame F an')
		resIs(t, await opsNoSnap(carol, b, [sticky(NC, { x: 600 })]), ['ok'], 'carol legt NC an')
		resIs(t, await opsNoSnap(bob, b, [sticky(NB, { x: 900 }), sticky(NP, { x: 1200 })]), ['ok', 'ok'], 'bob legt NB und NP an')
		resIs(t, await opsNoSnap(gina, b, [sticky(NG, { x: 1500 }), sticky(NM, { x: 1800 })]), ['ok', 'ok'], 'Gina legt NG und NM an')
		const lockers = [['alice', alice, NA], ['carol', carol, NC], ['bob', bob, NB], ['Gina', gina, NG]]
		// (a)
		for (const [who, c, id] of lockers) resIs(t, await opsNoSnap(c, b, [lockOp(id)]), ['ok'], `(a) ${who} sperrt die eigene Notiz`)
		for (const [who, c] of [['vote', voter], ['view', viewer]]) resIs(t, await opsNoSnap(c, b, [lockOp(N0), unlockOp(NA)]), ['denied', 'denied'], `(a) ${who} sperrt und entsperrt → denied`)
		const want = {}
		for (const [, c, id] of lockers) want[id] = await whoOf(c, b)
		for (const [who, c] of [['alice', alice], ['carol', carol], ['bob', bob], ['Gina', gina], ['vote', voter], ['view', viewer]]) {
			const s = await snap(c, b)
			const got = Object.fromEntries(Object.keys(want).map((id) => [id, itemIn(s, id)?.lock ?? null]))
			const ok = Object.entries(want).every(([id, w]) => deepEq(got[id], { by: w.pid, name: w.name }))
			t.check(ok && itemIn(s, N0)?.lock === null, `(a) der Snapshot von ${who} zeigt lock.by = pid und lock.name = Anzeigename des Sperrenden; N0 bleibt null`, { got, want, N0: itemIn(s, N0)?.lock })
		}
		t.check(deepEq(Object.keys(itemIn(await snap(alice, b), NA)?.lock ?? {}), ['by', 'name']), '(a) lock hat die Schlüssel in der Reihenfolge by, name')
		// (b)
		for (const [who, c, id] of lockers) resIs(t, await opsNoSnap(c, b, [unlockOp(id)]), ['ok'], `(b) ${who} entsperrt die eigene Sperre`)
		const sb = await snap(alice, b)
		t.check(lockers.every(([, , id]) => itemIn(sb, id)?.lock === null), '(b) danach ist keine der vier Notizen gesperrt', lockers.map(([, , id]) => itemIn(sb, id)?.lock))
		// (c)
		resIs(t, await opsNoSnap(bob, b, [lockOp(NB)]), ['ok'], '(c) bob sperrt NB')
		resIs(t, await opsNoSnap(gina, b, [lockOp(NG)]), ['ok'], '(c) Gina sperrt NG')
		resIs(t, await opsNoSnap(gina, b, [unlockOp(NB)]), ['itemlocked'], '(c) bobs Sperre: Gina entsperrt → itemlocked')
		resIs(t, await opsNoSnap(bob, b, [unlockOp(NG)]), ['itemlocked'], '(c) Ginas Sperre: bob entsperrt → itemlocked')
		for (const [who, c] of [['vote', voter], ['view', viewer]]) resIs(t, await opsNoSnap(c, b, [unlockOp(NB), unlockOp(NG)]), ['denied', 'denied'], `(c) ${who} entsperrt fremde Sperren → denied`)
		resIs(t, await opsNoSnap(alice, b, [unlockOp(NB)]), ['ok'], '(c) bobs Sperre: alice (owner) entsperrt → ok')
		resIs(t, await opsNoSnap(carol, b, [unlockOp(NG)]), ['ok'], '(c) Ginas Sperre: carol (Darf moderieren) entsperrt → ok')
		// (d)
		resIs(t, await opsNoSnap(bob, b, [lockOp(NB)]), ['ok'], '(d) bob sperrt NB wieder')
		const before = itemIn(await snap(alice, b), NB)
		const edits = [
			['x/y/parent', patch(NB, { x: 5, y: 5, parent: null })], ['w/h', patch(NB, { w: 300, h: 300 })], ['style.fill', patch(NB, { 'style.fill': '#ffffff' })],
			['data.text', patch(NB, { 'data.text': 'changed' })], ['z', patch(NB, { z: nextZ() })], ['remove', remove(NB)],
		]
		for (const [who, c] of [['bob', bob], ['alice', alice], ['carol', carol], ['Gina', gina]]) {
			const res = []
			for (const [, op] of edits) res.push((await opsNoSnap(c, b, [op])).acks.res[0])
			t.check(res.every((x) => x === 'itemlocked'), `(d) ${who}: ${edits.map(([n]) => n).join(', ')} auf bobs gesperrte Notiz → je itemlocked`, res)
		}
		const after = itemIn(await snap(alice, b), NB)
		t.check(after !== null && bodyOf(after) === bodyOf(before) && deepEq(after.lock, before.lock), '(d) die Notiz ist im Snapshot unverändert (Lage, Größe, z, data, style, Sperre)', { before, after })
		// (e)
		resIs(t, await opsNoSnap(gina, b, [lockOp(NG), lockOp(NM)]), ['ok', 'ok'], '(e) Gina sperrt NG und NM')
		const gina2 = await guest('Gina', L)
		t.check(gidOf(gina2.guestToken) !== gidOf(gina.guestToken), '(e) ein neuer Beitritt mit demselben Namen ohne altes Token hat eine neue gid', { alt: gidOf(gina.guestToken), neu: gidOf(gina2.guestToken) })
		resIs(t, await opsNoSnap(gina2, b, [unlockOp(NG)]), ['itemlocked'], '(e) die neue Gast-Identität entsperrt NG → itemlocked')
		resIs(t, await opsNoSnap(alice, b, [unlockOp(NG)]), ['ok'], '(e) alice entsperrt NG → ok')
		const gid = gidOf(gina.guestToken)
		const L2 = await link(b, true)
		const rj = await gina.joinGuest(L2, 'Gina', { client: gina.client })
		t.check(rj.status === 200 && gidOf(gina.guestToken) === gid, '(e) Gina tritt nach dem erneuerten Link mit ihrem alten Token wieder bei und behält die gid', { status: rj.status, gid, jetzt: gidOf(gina.guestToken) })
		resIs(t, await opsNoSnap(gina, b, [unlockOp(NM)]), ['ok'], '(e) Gina entsperrt ihre Sperre auf NM → ok')
		// (f)
		resIs(t, await opsNoSnap(bob, b, [lockOp(NP)]), ['ok'], '(f) bob sperrt NP')
		await saveOk(alice, b, shares('view'))
		const fb = await rawSync(bob, b, { since: 0, ops: [unlockOp(NP)], seq: ++seqN })
		t.check(fb.status === 200 && deepEq(fb.data?.acks?.res, ['denied']), '(f) bob hat nur noch view: sein Entsperren → denied', fb.data?.acks ?? brief(fb))
		t.check(itemIn(await snap(alice, b), NP)?.lock !== null, '(f) NP bleibt gesperrt')
		resIs(t, await opsNoSnap(carol, b, [unlockOp(NP)]), ['ok'], '(f) carol (Darf moderieren) entsperrt NP → ok')
		await saveOk(alice, b, shares('edit'))
		// (g)
		resIs(t, await opsNoSnap(alice, b, [lockOp(F), lockOp(NA)]), ['ok', 'ok'], '(g) alice sperrt den Frame F und NA')
		const NF = ulid()
		resIs(t, await opsNoSnap(bob, b, [sticky(NF, { x: 50, y: 80, parent: F })]), ['ok'], '(g) bob legt im gesperrten Frame eine Notiz an (parent = F)')
		resIs(t, await opsNoSnap(bob, b, [patch(NP, { x: 100, y: 200, parent: F })]), ['ok'], '(g) bob zieht NP in den gesperrten Frame')
		resIs(t, await opsNoSnap(bob, b, [patch(NP, { x: 1200, y: 0, parent: null })]), ['ok'], '(g) und wieder hinaus')
		resIs(t, await opsNoSnap(bob, b, [connector(K, { item: NB }, { item: NA })]), ['ok'], '(g) bob legt einen Verbinder an zwei gesperrte Notizen an')
		const sg = await snap(alice, b)
		t.check(itemIn(sg, NF)?.parent === F && itemIn(sg, NP)?.parent === null && itemIn(sg, F)?.lock !== null && itemIn(sg, K) !== null, '(g) Snapshot: NF in F, NP an der Wurzel, F weiter gesperrt, der Verbinder lebt',
			{ NF: itemIn(sg, NF)?.parent, NP: itemIn(sg, NP)?.parent, F: itemIn(sg, F)?.lock })
		const v = await startOk(alice, b, voteCfg())
		const vr = await voteSync(voter, b, [vote(v.sid, NA, 1)], { since: 0 })
		t.check(vr.status === 200 && deepEq(vr.data?.acks?.res, ['ok']), '(g) offene Abstimmung: eine Stimme auf die gesperrte Notiz NA → ok', vr.data?.acks ?? brief(vr))
		await alice.updateVote(b, { action: 'end' })
	} finally {
		await dropUsers(temps)
	}
})

await C('C85', 'Sperrender wird geleert (Job 023, M2 R20): (a) ein Temp-Konto mit edit sperrt eine Notiz, occ user:delete → Snapshot von alice zeigt lock {by: null, name: null}, rev des Objekts höher, Sync mit altem since liefert es; bob entsperrt → itemlocked, alice → ok; (b) Sperre eines Kontos, das es nicht gibt (SQL): occ knorke:orphans --dry-run → Exit 0, fünf Zeilen + Dry-run-Zeile, Zeile unverändert; occ knorke:orphans → Exit 0, genau fünf Zeilen, danach locked_by/locked_name NULL, locked 1, Snapshot {by: null, name: null}', async (t) => {
	const temps = await tempUsers('ck', 1)
	let dropped = false
	try {
		const b = await newBoard('C85')
		await saveOk(alice, b, [u('bob', 'edit'), u(temps[0], 'edit')])
		const tc = await new Client(env, temps[0]).login(temps[0])
		tc.client = clientId()
		const [N, G] = [ulid(), ulid()]
		resIs(t, await opsNoSnap(alice, b, [sticky(N), sticky(G, { x: 300 })]), ['ok', 'ok'], 'alice legt N und G an')
		resIs(t, await opsNoSnap(tc, b, [lockOp(N)]), ['ok'], '(a) das Temp-Konto sperrt N')
		const s1 = await snap(alice, b)
		const row1 = await stack.sqlRow(`SELECT rev, locked_by FROM oc_knorke_items WHERE board_id = ${b} AND id = '${N}';`)
		t.check(itemIn(s1, N)?.lock?.name === temps[0] && row1?.[1] === `u:${temps[0]}`, '(a) gesperrt: lock.name = Anzeigename, locked_by = u:<uid>', { lock: itemIn(s1, N)?.lock, row: row1 })
		await dropUsers(temps)
		dropped = true
		const s2 = await snap(alice, b)
		const row2 = await stack.sqlRow(`SELECT rev, locked, locked_by, locked_name FROM oc_knorke_items WHERE board_id = ${b} AND id = '${N}';`)
		t.check(deepEq(itemIn(s2, N)?.lock, { by: null, name: null }), '(a) nach occ user:delete zeigt der Snapshot von alice "lock":{"by":null,"name":null}', itemIn(s2, N)?.lock)
		t.check(row2 && Number(row2[0]) > Number(row1?.[0]) && Number(row2[1]) === 1 && row2[2] === null && row2[3] === null, '(a) die Zeile: rev höher als vorher, locked 1, locked_by und locked_name NULL', { vorher: row1, nachher: row2 })
		const sy = await rawSync(alice, b, { since: s1.rev })
		t.check(sy.status === 200 && (sy.data?.items ?? []).some((i) => i.id === N && deepEq(i.lock, { by: null, name: null })), '(a) ein Sync mit dem alten since liefert N in items', { status: sy.status, items: (sy.data?.items ?? []).map((i) => [i.id, i.lock]) })
		resIs(t, await opsNoSnap(bob, b, [unlockOp(N)]), ['itemlocked'], '(a) bob (edit) entsperrt → itemlocked')
		resIs(t, await opsNoSnap(alice, b, [unlockOp(N)]), ['ok'], '(a) alice (owner) entsperrt → ok')
		// (b)
		const ghost = `c85-ghost-${randTok().slice(0, 8).toLowerCase()}`
		await stack.sql(`UPDATE oc_knorke_items SET locked = 1, locked_by = 'u:${ghost}', locked_name = 'Ghost' WHERE board_id = ${b} AND id = '${G}';`)
		const rowOf = async () => await stack.sqlRow(`SELECT locked, locked_by, locked_name, rev FROM oc_knorke_items WHERE board_id = ${b} AND id = '${G}';`)
		const g0 = await rowOf()
		const lines = (out) => out.split('\n').map((l) => l.trim()).filter((l) => l !== '')
		const KINDS = ['user-shares', 'group-shares', 'link-members', 'open-votes', 'owned-boards']
		const fiveOk = (ls) => ls.length >= 5 && KINDS.every((k, i) => new RegExp(`^${k}: \\d+$`).test(ls[i]))
		const dry = await run('docker', ['exec', '-u', 'www-data', env.containers.nc, 'php', 'occ', 'knorke:orphans', '--dry-run'], { timeoutMs: 120000 })
		const dl = lines(dry.out)
		t.check(dry.ok && dl.length === 6 && fiveOk(dl) && dl[5] === 'Dry run: nothing was changed.', '(b) occ knorke:orphans --dry-run: Exit 0, die fünf Zeilen plus "Dry run: nothing was changed."', { ok: dry.ok, out: dl, err: dry.err })
		t.check(deepEq(await rowOf(), g0), '(b) die Zeile ist nach dem Trockenlauf unverändert', { vorher: g0, nachher: await rowOf() })
		const real = await run('docker', ['exec', '-u', 'www-data', env.containers.nc, 'php', 'occ', 'knorke:orphans'], { timeoutMs: 120000 })
		const rl = lines(real.out)
		t.check(real.ok && rl.length === 5 && fiveOk(rl), '(b) occ knorke:orphans: Exit 0, genau fünf Zeilen', { ok: real.ok, out: rl, err: real.err })
		const g1 = await rowOf()
		t.check(g1 && Number(g1[0]) === 1 && g1[1] === null && g1[2] === null && Number(g1[3]) > Number(g0?.[3]), '(b) danach: locked 1, locked_by und locked_name NULL, rev höher', { vorher: g0, nachher: g1 })
		t.check(deepEq(itemIn(await snap(alice, b), G)?.lock, { by: null, name: null }), '(b) der Snapshot zeigt {"by":null,"name":null}')
	} finally {
		if (!dropped) await dropUsers(temps)
	}
})

// ── Job 026 (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): group items ──────────────

await C('C86', 'Gruppieren (Job 026, M2 R20): (a) alice legt A und B mit p.group G an → ok, die Snapshots von alice, bob (edit), view und Gina (Bearbeitungslink) zeigen group G bei beiden; (b) bob patcht A {group: null} → ok, B hat danach group null im selben rev (aufgelöst, Änderungszeile {"group":null}), ein Sync mit dem alten since liefert A und B; (c) ungültig → bad: put/patch mit "x", ULID in Kleinbuchstaben, "", 5, {}; Frame mit Gruppe → bad, Verbinder-patch {group: G} → bad; view → denied; (d) zwei Clients entfernen in getrennten Batches je ein Mitglied von G2 = {C, D, E} → E hat danach group null; (e) put mit revive und group G2 für C → ok, group G2 im Snapshot; (f) Gina sperrt E, bob patcht E {group: null} → itemlocked', async (t) => {
	const temps = await tempUsers('cg', 1)
	try {
		const b = await newBoard('C86')
		await saveOk(alice, b, [u('bob', 'edit'), u(temps[0], 'view')])
		const viewer = await new Client(env, temps[0]).login(temps[0])
		viewer.client = clientId()
		const gina = await guest('Gina', await link(b))
		const [A, B, C2, D, E, F, K] = Array.from({ length: 7 }, () => ulid())
		const [G, G2] = [ulid(), ulid()]
		const groupsOf = (s, ids) => ids.map((id) => itemIn(s, id)?.group ?? null)
		const rowOf = async (id) => await stack.sqlRow(`SELECT rev, group_id FROM oc_knorke_items WHERE board_id = ${b} AND id = '${id}';`)
		// (a)
		resIs(t, await opsNoSnap(alice, b, [sticky(A, { group: G }), sticky(B, { x: 300, group: G })]), ['ok', 'ok'], '(a) alice legt A und B mit p.group G an')
		for (const [who, c] of [['alice', alice], ['bob', bob], ['view', viewer], ['Gina', gina]]) {
			const s = await snap(c, b)
			t.check(deepEq(groupsOf(s, [A, B]), [G, G]), `(a) der Snapshot von ${who} zeigt group G bei A und B`, groupsOf(s, [A, B]))
		}
		// (b)
		const since = (await snap(alice, b)).rev
		resIs(t, await opsNoSnap(bob, b, [patch(A, { group: null })]), ['ok'], '(b) bob patcht A {group: null}')
		const [ra, rb] = [await rowOf(A), await rowOf(B)]
		t.check(ra?.[1] === null && rb?.[1] === null && Number(ra?.[0]) === Number(rb?.[0]), '(b) A und B haben group_id NULL, B im selben rev wie A (aufgelöst)', { A: ra, B: rb })
		const rows = await rowsAt(b, Number(ra?.[0]))
		t.check(rows[B]?.length === 1 && rows[B][0].patch === '{"group":null}', '(b) die eine Änderungszeile von B ist {"group":null}', rows[B])
		const sy = await rawSync(alice, b, { since })
		const got = Object.fromEntries((sy.data?.items ?? []).filter((i) => i.id === A || i.id === B).map((i) => [i.id, i.group]))
		t.check(sy.status === 200 && Object.keys(got).length === 2 && got[A] === null && got[B] === null, '(b) ein Sync mit dem alten since liefert A und B mit group null', { status: sy.status, got })
		// (c)
		resIs(t, await opsNoSnap(alice, b, [connector(K, { x: 0, y: 900 }, { x: 300, y: 900 })]), ['ok'], '(c) alice legt einen Verbinder K an')
		const bad = ['x', G.toLowerCase(), '', 5, {}]
		const putsBad = bad.map((v) => sticky(ulid(), { x: 600, group: v }))
		const patchesBad = bad.map((v) => patch(A, { group: v }))
		resIs(t, await opsNoSnap(bob, b, [...putsBad, ...patchesBad]), Array(10).fill('bad'), '(c) put und patch mit "x", ULID in Kleinbuchstaben, "", 5, {} → je bad')
		resIs(t, await opsNoSnap(alice, b, [frame(F, { x: 2000, group: G }), patch(K, { group: G })]), ['bad', 'bad'], '(c) Frame mit Gruppe und Verbinder-patch {group: G} → bad')
		resIs(t, await opsNoSnap(viewer, b, [sticky(ulid(), { group: G }), patch(A, { group: G })]), ['denied', 'denied'], '(c) view → denied')
		t.check((await rowOf(A))?.[1] === null, '(c) A hat weiter keine Gruppe')
		// (d)
		resIs(t, await opsNoSnap(alice, b, [sticky(C2, { x: 0, y: 400, group: G2 }), sticky(D, { x: 300, y: 400, group: G2 }), sticky(E, { x: 600, y: 400, group: G2 })]), ['ok', 'ok', 'ok'], '(d) alice legt C, D und E in G2 an')
		resIs(t, await opsNoSnap(bob, b, [remove(C2)]), ['ok'], '(d) bob entfernt C')
		t.check(deepEq(groupsOf(await snap(alice, b), [D, E]), [G2, G2]), '(d) zwei Mitglieder übrig: D und E behalten G2')
		resIs(t, await opsNoSnap(gina, b, [remove(D)]), ['ok'], '(d) Gina entfernt D in einem eigenen Batch')
		const sd = await snap(alice, b)
		t.check(itemIn(sd, E) !== null && itemIn(sd, E).group === null, '(d) das letzte Mitglied E hat group null', itemIn(sd, E)?.group)
		// (e)
		resIs(t, await opsNoSnap(alice, b, [{ ...sticky(C2, { x: 0, y: 400, group: G2 }), revive: true }]), ['ok'], '(e) put mit revive und group G2 für C')
		t.check(itemIn(await snap(alice, b), C2)?.group === G2, '(e) der Snapshot zeigt C mit group G2')
		// (f)
		resIs(t, await opsNoSnap(alice, b, [patch(E, { group: G2 })]), ['ok'], '(f) alice setzt E wieder in G2')
		resIs(t, await opsNoSnap(gina, b, [lockOp(E)]), ['ok'], '(f) Gina sperrt E')
		resIs(t, await opsNoSnap(bob, b, [patch(E, { group: null })]), ['itemlocked'], '(f) bob patcht E {group: null} → itemlocked')
		t.check((await rowOf(E))?.[1] === G2, '(f) E bleibt in G2')
	} finally {
		await dropUsers(temps)
	}
})

/** C87: the request header of a client that reads end states in a 200 body (SPEC-M1 §1.2 (R23)). */
const END_HDR = { 'X-Knorke-End-State': '1' }
/**
 * End answer X (C87): status 200, JSON body with exactly the keys end and
 * message, end = X, message a non-empty string; no Retry-After.
 */
const endIs = (r, code) => r.status === 200 && isObj(r.data) && deepEq(Object.keys(r.data), ['end', 'message']) && r.data.end === code
	&& typeof r.data.message === 'string' && r.data.message !== '' && /^application\/json/.test(String(r.headers?.['content-type'] || '')) && !('retry-after' in (r.headers || {}))

await C('C87', 'Endzustände mit 200 (Job 028, M2 R23): mit X-Knorke-End-State: 1 antworten Gast-Sync, Gast-Beitritt und Konto-Sync guest_token, link_revoked, link_expired, links_disabled mit 200 {end, message}, ohne Header wie bisher 401/403; (a) gefälschtes Token; (b) Erneuern: Sync und Neu-Beitritt link_revoked; (c) abgelaufen: Beitritt link_expired ohne Fehlversuch; (d) Links verboten: links_disabled; (e) Passwort: Sync link_revoked, Beitritt password_required/password_wrong bleiben 403; (f) cross_site, 409 protocol, 404, Snapshot, Konto-Beitritt und Nextclouds 401 unverändert; (g) Header 0/true → 403', async (t) => {
	await stack.bruteforceReset()
	const b = await newBoard('C87')
	const L = await link(b)
	try {
		// (b) Gina joins with the header: the same snapshot answer as without
		const gina = new Client(env, 'Gina', { kind: 'guest' })
		gina.client = clientId()
		let r = await gina.joinGuest(L, 'Gina', { client: gina.client, headers: END_HDR })
		t.check(r.status === 200 && r.data?.proto === PROTOCOL && typeof r.data?.guest?.token === 'string' && !('end' in (r.data || {})), '(b) Gina tritt mit Header bei → 200 mit proto und guest.token', brief(r))
		const plain = await new Client(env, 'Ohne', { kind: 'guest' }).joinGuest(L, 'Ohne', { client: clientId() })
		t.check(plain.status === 200 && plain.data?.proto === PROTOCOL && typeof plain.data?.guest?.token === 'string', '(b) Kontrolle: Beitritt ohne Header → 200 mit proto und guest.token', brief(plain))
		const rev = await revOf(alice, b)
		r = await gina.sync(b, { client: gina.client, since: rev, pres: 0 }, { headers: END_HDR })
		t.check(r.status === 200 && Number.isInteger(r.data?.rev) && !('end' in (r.data || {})), '(b) Kontrolle: Ginas Sync mit Header → normale Antwort', brief(r))

		// (a) a forged guest token
		const [payload, sig] = gina.guestToken.split('.')
		const fake = new Client(env, 'Falsch', { kind: 'guest' })
		fake.guestToken = `${payload}.${sig.startsWith('A') ? 'B' : 'A'}${sig.slice(1)}`
		r = await fake.sync(b, { client: clientId(), since: rev, pres: 0 }, { headers: END_HDR })
		t.check(endIs(r, 'guest_token'), '(a) Gast-Sync mit gefälschtem Token, mit Header → 200 {end: guest_token, message}', { status: r.status, body: r.data, ct: r.headers?.['content-type'] })
		r = await fake.sync(b, { client: clientId(), since: rev, pres: 0 })
		t.check(errIs(r, 401, 'guest_token'), '(a) ohne Header → 401 guest_token', brief(r))

		// (b) alice renews the link
		const oldTok = gina.guestToken
		const L2 = await link(b, true)
		t.check(L2 !== L, '(b) alice erneuert den Link', { L, L2 })
		r = await gina.sync(b, { client: gina.client, since: rev, pres: 0 }, { headers: END_HDR })
		t.check(endIs(r, 'link_revoked'), '(b) Ginas Sync mit Header → 200 {end: link_revoked, message}', { status: r.status, body: r.data })
		t.check(r.data?.message === 'This link has been revoked.', '(b) message = der englische Text der Fehlerform', r.data)
		r = await gina.sync(b, { client: gina.client, since: rev, pres: 0 })
		t.check(errIs(r, 403, 'link_revoked'), '(b) ohne Header → 403 link_revoked', brief(r))
		r = await gina.joinGuest(L, 'Gina', { client: gina.client, headers: END_HDR })
		t.check(endIs(r, 'link_revoked') && gina.guestToken === oldTok, '(b) Ginas Neu-Beitritt mit dem alten Link-Token, mit Header → 200 {end: link_revoked}, kein neues Token', { status: r.status, body: r.data })
		r = await gina.joinGuest(L, 'Gina', { client: gina.client })
		t.check(errIs(r, 403, 'link_revoked'), '(b) ohne Header → 403 link_revoked', brief(r))

		// (g) other values of the header
		for (const v of ['0', 'true']) {
			r = await gina.sync(b, { client: gina.client, since: rev, pres: 0 }, { headers: { 'X-Knorke-End-State': v } })
			t.check(errIs(r, 403, 'link_revoked'), `(g) Header mit dem Wert ${v} → 403 link_revoked`, brief(r))
		}

		// (f) unchanged with the header
		r = await gina.request('POST', `${APP}/pub/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: gina.client, since: rev, ep: gina.ep, pres: 0 }, xrw: false, headers: { ...END_HDR, 'Sec-Fetch-Site': 'cross-site' } })
		t.check(errIs(r, 403, 'cross_site'), '(f) Gast-Sync ohne X-Requested-With, Sec-Fetch-Site: cross-site → 403 cross_site', brief(r))
		r = await new Client(env, 'x', { kind: 'guest' }).request('POST', `${APP}/pub/v1/${L2}/join`, { body: { client: clientId(), name: 'X', guest: null }, xrw: false, guest: false, headers: { ...END_HDR, 'Sec-Fetch-Site': 'cross-site' } })
		t.check(errIs(r, 403, 'cross_site'), '(f) Beitritt ohne X-Requested-With, Sec-Fetch-Site: cross-site → 403 cross_site', brief(r))
		r = await gina.sync(b, { proto: 1, client: gina.client, since: rev, pres: 0 }, { headers: END_HDR })
		t.check(errIs(r, 409, 'protocol') && r.data?.proto === PROTOCOL, '(f) Sync mit proto 1 (Token widerrufen) → 409 protocol zuerst', brief(r))
		r = await new Client(env, 'y', { kind: 'guest' }).joinGuest(randTok(), 'Y', { client: clientId(), headers: END_HDR })
		t.check(errIs(r, 404, 'not_found'), '(f) Beitritt mit unbekanntem Link-Token → 404 not_found', brief(r))
		const old = new Client(env, 'Alt', { kind: 'guest' })
		old.guestToken = oldTok
		r = await old.request('GET', `${APP}/pub/v1/boards/${b}/snapshot`, { headers: END_HDR })
		t.check(errIs(r, 403, 'link_revoked'), '(f) Gast-Snapshot (Route 15) mit dem Token von vor dem Erneuern → 403 link_revoked', brief(r))
		r = await bob.request('POST', `${APP}/api/v1/links/${L}/join`, { headers: END_HDR })
		t.check(errIs(r, 403, 'link_revoked'), '(f) Konto-Beitritt (Route 11) über den alten Link → 403 link_revoked', brief(r))
		const anon = new Client(env, 'anon')
		r = await anon.request('POST', `${APP}/api/v1/boards/${b}/sync`, { body: { proto: PROTOCOL, client: 'cAnon', since: 0, ep: anon.ep }, headers: END_HDR })
		t.check(r.status === 401 && isObj(r.data) && typeof r.data.message === 'string' && !('error' in r.data) && !('end' in r.data), '(f) Konto-Sync (Route 13) ohne Sitzung → 401 von Nextcloud ohne error', brief(r))

		// (e) a password on the renewed link
		r = await gina.joinGuest(L2, 'Gina', { client: gina.client, headers: END_HDR })
		t.check(r.status === 200 && gina.guestToken !== oldTok, '(e) Gina tritt über den neuen Link wieder bei', brief(r))
		const tokL2 = gina.guestToken
		r = await alice.postLink(b, { password: LINK_PW })
		t.check(r.status === 200 && r.data?.link?.token === L2 && r.data.link.password === true, '(e) alice setzt ein Passwort', brief(r))
		r = await gina.sync(b, { client: gina.client, since: rev, pres: 0 }, { headers: END_HDR })
		t.check(endIs(r, 'link_revoked'), '(e) Ginas Sync mit Header → 200 {end: link_revoked}', { status: r.status, body: r.data })
		r = await gina.joinGuest(L2, 'Gina', { client: gina.client, headers: END_HDR })
		t.check(errIs(r, 403, 'password_required') && gina.guestToken === tokL2, '(e) Neu-Beitritt mit Header ohne Passwort → 403 password_required (bleibt 403)', brief(r))
		r = await gina.joinGuest(L2, 'Gina', { client: gina.client, headers: END_HDR, password: 'falsch-falsch' })
		t.check(errIs(r, 403, 'password_wrong'), '(e) mit falschem Passwort → 403 password_wrong (bleibt 403)', brief(r))
		r = await gina.joinGuest(L2, 'Gina', { client: gina.client, headers: END_HDR, password: LINK_PW })
		t.check(r.status === 200 && r.data?.proto === PROTOCOL && typeof r.data?.guest?.token === 'string' && Array.isArray(r.data?.items) && !('end' in r.data), '(e) mit richtigem Passwort → 200 Snapshot', brief(r))
	} finally {
		await stack.redisDel(rkey('pwf:*')).catch(() => {})
		await stack.bruteforceReset().catch(() => {})
	}

	// (c) an expired link (SQL into the past, as in C66)
	const bx = await newBoard('C87-abgelaufen')
	const LX = await link(bx)
	const gx = await guest('Greta', LX)
	await stack.sql(`UPDATE oc_knorke_links SET expires_at = ${Date.now() - 60000} WHERE board_id = ${bx} AND revoked_at IS NULL;`)
	await dropGens(bx)
	const att0 = await stack.bruteforceAttempts()
	let r = await new Client(env, 'neu', { kind: 'guest' }).joinGuest(LX, 'Neu', { client: clientId(), headers: END_HDR })
	t.check(endIs(r, 'link_expired'), '(c) neuer Gast mit Header → 200 {end: link_expired}', { status: r.status, body: r.data })
	r = await new Client(env, 'neu2', { kind: 'guest' }).joinGuest(LX, 'Neu', { client: clientId() })
	t.check(errIs(r, 403, 'link_expired'), '(c) neuer Gast ohne Header → 403 link_expired', brief(r))
	const tokX = gx.guestToken
	r = await gx.joinGuest(LX, 'Greta', { client: gx.client, headers: END_HDR })
	t.check(endIs(r, 'link_expired') && gx.guestToken === tokX, '(c) Gast mit altem Token, mit Header → 200 {end: link_expired}', { status: r.status, body: r.data })
	r = await gx.joinGuest(LX, 'Greta', { client: gx.client })
	t.check(errIs(r, 403, 'link_expired'), '(c) Gast mit altem Token ohne Header → 403 link_expired', brief(r))
	const att1 = await stack.bruteforceAttempts()
	t.check(att1 === att0, '(c) kein Fehlversuch gezählt (oc_bruteforce_attempts unverändert)', { att0, att1 })

	// (d) the policy forbids links (as in C45)
	const bd = await newBoard('C87-verboten')
	const LD = await link(bd)
	const gd = await guest('Dora', LD)
	const revD = await revOf(alice, bd)
	try {
		await setLinksAllowed(false)
		await dropGens(bd)
		r = await gd.sync(bd, { client: gd.client, since: revD, pres: 0 }, { headers: END_HDR })
		t.check(endIs(r, 'links_disabled'), '(d) Gast-Sync (voller Weg, nach dropGens) mit Header → 200 {end: links_disabled}', { status: r.status, body: r.data })
		r = await gd.sync(bd, { client: gd.client, since: revD, pres: 0 })
		t.check(errIs(r, 403, 'links_disabled'), '(d) ohne Header → 403 links_disabled', brief(r))
		const n = new Client(env, 'neu3', { kind: 'guest' })
		r = await n.joinGuest(LD, 'Neu', { client: clientId(), headers: END_HDR })
		t.check(endIs(r, 'links_disabled') && !n.guestToken, '(d) Beitritt mit Header → 200 {end: links_disabled}, kein Token', { status: r.status, body: r.data })
	} finally {
		await setLinksAllowed(true).catch(() => {})
		await dropGens(bd).catch(() => {})
		await stack.bruteforceReset().catch(() => {})
	}
})

// Run-wide invariant (T1 accounting, every KD_DB kind): after all cases, every
// board this run still has keeps item_bytes = Σ stored data+style bytes and
// item_count = live items. Not a spec case; runs on a full run or with --only …,CINV.
if (!ONLY || ONLY.has('CINV')) {
	await C('CINV', 'Invariante aller Boards des Laufs: item_bytes = Σ octet_length(data)+octet_length(style), item_count = lebende Objekte; SPEC-M1 §8.3: Verbinder-Spalten = data.*.item (Stufe 1: Endenform, Lage none, Ziele lebend und bindbar, Spalten nur bei Verbindern), keine Stimmzeile einer geschlossenen Sitzung, ≤ 1 offene Sitzung je Board, meta_rev ≤ rev', async (t) => {
		let seen = 0
		for (const b of created) {
			if (rawBoards.has(b)) continue
			const a = await stack.byteAccount(b)
			if (!a) continue // deleted inside its case
			seen++
			t.check(a.bytes === a.sum && a.count === a.live, `Board ${b}: item_bytes ${a.bytes} = Σ ${a.sum}, item_count ${a.count} = lebende ${a.live}`, a)
		}
		t.note(`${seen} Boards geprüft (${stack.dbLabel})${rawBoards.size ? `; ausgenommen ${rawBoards.size} mit Schreibzugriffen am Server vorbei (C25)` : ''}`)
		if (seen === 0) t.check(true, 'keine Boards übrig (nichts zu prüfen)')
		// SPEC-M1 additions, over every board of the run that still exists (raw boards included)
		const ids = created.filter((b) => /^\d{1,18}$/.test(String(b)))
		for (let i = 0; i < ids.length; i += 200) {
			const list = ids.slice(i, i + 200).join(',')
			const metaBad = await stack.sql(`SELECT id, rev, meta_rev FROM oc_knorke_boards WHERE id IN (${list}) AND meta_rev > rev;`)
			t.check(metaBad.length === 0, `meta_rev ≤ rev (${ids.slice(i, i + 200).length} Boards)`, metaBad.slice(0, 5))
			// connector columns (SPEC-M1 §3.10, §4.7 rules 12/14), stage 1: one row per live connector with its two targets
			const conns = await stack.sql(`SELECT c.board_id, c.id, c.data, c.start_item, c.end_item, c.x, c.y, c.w, c.h, c.rotation, c.parent_id, s.type, s.deleted, e.type, e.deleted
				FROM oc_knorke_items c LEFT JOIN oc_knorke_items s ON s.board_id = c.board_id AND s.id = c.start_item LEFT JOIN oc_knorke_items e ON e.board_id = c.board_id AND e.id = c.end_item
				WHERE c.board_id IN (${list}) AND c.deleted = 0 AND c.type = 'connector';`)
			const parsed = conns.map(([board, id, data, st, en, x, y, w, h, r, parent, sType, sDel, eType, eDel]) => {
				let d = null
				try { d = JSON.parse(data ?? 'null') } catch { d = undefined }
				return { board, id, d, st, en, box: [x, y, w, h, r].map(Number), parent, targets: [[st, sType, sDel], [en, eType, eDel]] }
			})
			const connBad = parsed.filter(({ d, st, en }) => d === undefined || (d?.start?.item ?? null) !== st || (d?.end?.item ?? null) !== en)
			t.check(connBad.length === 0, `lebende Verbinder: start_item/end_item = data.start/end.item (${conns.length} Verbinder)`, connBad.slice(0, 3))
			const formBad = parsed.filter(({ d }) => !d || [d.start, d.end].some((ep) => JSON.stringify(endpointOf(ep)) !== JSON.stringify(ep)))
			t.check(formBad.length === 0, `lebende Verbinder: beide Enden in gespeicherter Form (eine der drei Formen, ax/ay auf q(v, 10000), Reihenfolge, kein -0)`, formBad.slice(0, 3).map((x) => [x.id, x.d?.start, x.d?.end]))
			const placeBad = parsed.filter(({ box, parent }) => box.some((v) => v !== 0) || parent !== null)
			t.check(placeBad.length === 0, `lebende Verbinder: Lage none – x = y = w = h = r = 0, parent NULL (Regel 12)`, placeBad.slice(0, 3).map((x) => [x.id, x.box, x.parent]))
			const targetBad = parsed.filter(({ targets }) => targets.some(([ref, type, del]) => ref !== null && (!BINDABLE.includes(type) || Number(del) !== 0)))
			t.check(targetBad.length === 0, `gebundene Enden zeigen auf lebende, bindbare Objekte (Regel 14: Löschen gibt frei)`, targetBad.slice(0, 3).map((x) => [x.id, x.targets]))
			const strayCols = await stack.sql(`SELECT board_id, id, type FROM oc_knorke_items WHERE board_id IN (${list}) AND type <> 'connector' AND (start_item IS NOT NULL OR end_item IS NOT NULL);`)
			t.check(strayCols.length === 0, `start_item/end_item nur bei Verbindern gesetzt`, strayCols.slice(0, 3))
			const closedVotes = await stack.sqlRow(`SELECT count(*) FROM oc_knorke_votes v JOIN oc_knorke_vote_sessions s ON s.id = v.session_id WHERE s.board_id IN (${list}) AND s.state <> 'open';`)
			t.check(Number(closedVotes?.[0]) === 0, 'keine Stimmzeile gehört zu einer geschlossenen Sitzung', closedVotes)
			const open = await stack.sql(`SELECT board_id, count(*) FROM oc_knorke_vote_sessions WHERE board_id IN (${list}) AND state = 'open' GROUP BY board_id HAVING count(*) > 1;`)
			t.check(open.length === 0, 'höchstens eine offene Sitzung je Board', open)
		}
	})
}

// ── cleanup + report ─────────────────────────────────────────────────────

if (!KEEP) {
	let gone = 0
	for (const b of created) {
		const r = await alice.deleteBoard(b).catch(() => null)
		if (r && r.status === 200) gone++
	}
	// boards of other owners (stage 2: carol, bob); those of throwaway accounts went with the account
	for (const [c, b] of createdBy) {
		const r = await c.deleteBoard(b).catch(() => null)
		if (r && (r.status === 200 || r.status === 404)) gone++
	}
	const all = created.length + createdBy.length
	if (all) console.log(`Aufräumen: ${gone}/${all} Boards gelöscht`)
}
await stack.ratelimitReset().catch(() => {})
await stack.bruteforceReset().catch(() => {})
process.exit(suite.finish({ ns: env.ns, nextcloud: env.versions?.nextcloud, image: env.versions?.image }))
