/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pure parsers of the load run's metrics (SPEC-M1 §8.7 "Metriken"), tested
 * on fixtures in dev/selftest/fixtures/load/ without a stack. The thin
 * collectors in collect.mjs only read the raw text (cgroup files, Apache
 * server-status, psql, redis-cli, nextcloud.log, /proc/loadavg) and hand it here.
 *
 * Ported from the spike (knorke-spike/poll/load/load.mjs: CpuSampler,
 * apacheStatus, pgDelta, redisInfo/redisDelta, ncLogSince) and split into
 * parser and collector.
 */

/** Nearest-rank percentile of a SORTED list (null when empty). */
export function pct(sorted, p) {
	if (!sorted.length) return null
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

/** {n, mean, p50, p95, p99, max} of a list of numbers, rounded to 0.1. */
export function stats(values) {
	const s = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
	const r = (v) => (v === null ? null : Math.round(v * 10) / 10)
	const sum = s.reduce((a, b) => a + b, 0)
	return { n: s.length, mean: s.length ? r(sum / s.length) : null, p50: r(pct(s, 50)), p95: r(pct(s, 95)), p99: r(pct(s, 99)), max: r(s.length ? s[s.length - 1] : null) }
}

/** /proc/loadavg → {one, five, fifteen} (null for anything else). */
export function parseLoadavg(text) {
	const m = /^\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(\s|$)/.exec(String(text ?? ''))
	return m ? { one: Number(m[1]), five: Number(m[2]), fifteen: Number(m[3]) } : null
}

/** cgroup v2 cpu.stat → usage_usec (the counter docker stats reads), or null. */
export function parseCpuStat(text) {
	const m = /^usage_usec (\d+)$/m.exec(String(text ?? ''))
	return m ? Number(m[1]) : null
}

/** cgroup v2 memory.current → MiB, or null. */
export function parseMemoryCurrent(text) {
	const v = Number(String(text ?? '').trim())
	return String(text ?? '').trim() !== '' && Number.isFinite(v) ? Math.round((v / 1048576) * 10) / 10 : null
}

/**
 * Cores used between two usage_usec readings dtMs apart (null if either is
 * missing). A counter that went down was reset by a container restart (SF's
 * Redis restart): that interval is a gap (null), never negative cores (W3E-10).
 */
export function coresBetween(usecA, usecB, dtMs) {
	if (usecA === null || usecB === null || !(dtMs > 0) || counterReset(usecA, usecB)) return null
	return Math.round(((usecB - usecA) / (dtMs * 1000)) * 1000) / 1000
}

/** True when a cumulative counter went down between two readings (restart: a gap in the series). */
export function counterReset(a, b) {
	return typeof a === 'number' && typeof b === 'number' && b < a
}

/** Candidate cgroup v2 directories of a container id (cgroupfs driver like this host, systemd driver like CI). */
export function cgroupDirs(id) {
	if (!/^[0-9a-f]{64}$/.test(String(id))) return []
	return [`/sys/fs/cgroup/docker/${id}`, `/sys/fs/cgroup/system.slice/docker-${id}.scope`]
}

/**
 * Apache mod_status ?auto → {busy, idle, W, K, R, open, slots}; null when it
 * is no status page. Scoreboard: W sending, K keepalive, R reading, . open slot.
 */
export function parseApacheStatus(text) {
	const t = String(text ?? '')
	const get = (k) => { const m = new RegExp('^' + k + ': (\\S+)', 'm').exec(t); return m ? m[1] : null }
	const busy = get('BusyWorkers')
	if (busy === null) return null
	const sb = get('Scoreboard') || ''
	const cnt = (ch) => sb.split('').filter((c) => c === ch).length
	return { busy: Number(busy), idle: Number(get('IdleWorkers')), W: cnt('W'), K: cnt('K'), R: cnt('R'), open: cnt('.'), slots: sb.length }
}

/** One row_to_json line of pg_stat_database (psql -Atc) → object of numbers, or null. */
export function parsePgDatabase(text) {
	try {
		const o = JSON.parse(String(text ?? '').trim())
		if (!o || typeof o !== 'object' || Array.isArray(o)) return null
		return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]))
	} catch { return null }
}

/** Delta of two pg_stat_database readings (spike pgDelta): per second and per request. */
export function pgDelta(a, b, secs, requests) {
	if (!a || !b) return null
	const delta = {}
	for (const k of Object.keys(b)) if (k !== 'numbackends') delta[k] = Number(b[k]) - Number(a[k])
	const perSec = {}
	const perRequest = {}
	for (const [k, v] of Object.entries(delta)) {
		perSec[k] = Math.round((v / secs) * 10) / 10
		perRequest[k] = requests ? Math.round((v / requests) * 100) / 100 : null
	}
	return { delta, perSec, perRequest, numbackendsAfter: Number(b.numbackends) }
}

/** json_agg of pg_stat_statements rows (psql -Atc) → list, or null. */
export function parsePgStatements(text) {
	try {
		const v = JSON.parse(String(text ?? '').trim())
		return Array.isArray(v) ? v : null
	} catch { return null }
}

/** redis-cli INFO all → {cmd: {name: {calls, usec}}, totals…}, or null when it is no INFO output. */
export function parseRedisInfo(text) {
	const t = String(text ?? '')
	if (!/^# Server/m.test(t) && !/^cmdstat_/m.test(t)) return null
	const out = { cmd: {} }
	for (const line of t.split(/\r?\n/)) {
		let m = /^cmdstat_([\w|]+):calls=(\d+),usec=(\d+)/.exec(line)
		if (m) { out.cmd[m[1]] = { calls: Number(m[2]), usec: Number(m[3]) }; continue }
		m = /^(total_commands_processed|keyspace_hits|keyspace_misses|total_connections_received|used_memory|connected_clients):(\d+)/.exec(line)
		if (m) out[m[1]] = Number(m[2])
	}
	return out
}

/** Delta of two Redis INFO readings (spike redisDelta). */
export function redisDelta(a, b, secs, requests) {
	if (!a || !b) return null
	const perCommand = {}
	for (const [k, v] of Object.entries(b.cmd)) {
		const calls = v.calls - (a.cmd[k] ? a.cmd[k].calls : 0)
		const usec = v.usec - (a.cmd[k] ? a.cmd[k].usec : 0)
		if (calls > 0) perCommand[k] = { calls, perSec: Math.round((calls / secs) * 10) / 10, perRequest: requests ? Math.round((calls / requests) * 100) / 100 : null, usecPerCall: Math.round((usec / calls) * 10) / 10 }
	}
	const total = (b.total_commands_processed ?? 0) - (a.total_commands_processed ?? 0)
	const hits = (b.keyspace_hits ?? 0) - (a.keyspace_hits ?? 0)
	const misses = (b.keyspace_misses ?? 0) - (a.keyspace_misses ?? 0)
	return {
		commandsPerSec: Math.round((total / secs) * 10) / 10,
		commandsPerRequest: requests ? Math.round((total / requests) * 100) / 100 : null,
		connectionsPerSec: Math.round((((b.total_connections_received ?? 0) - (a.total_connections_received ?? 0)) / secs) * 10) / 10,
		hitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 1000) / 1000 : null,
		usedMemoryMB: b.used_memory === undefined ? null : Math.round((b.used_memory / 1048576) * 10) / 10,
		perCommand,
	}
}

/**
 * `auth=…` and `auth[]=…` with any prefix (redis_auth=, phpredis auth[]=user&auth[]=pw):
 * key AND value become [REDACTED], so no "auth=" stays in a report (G8 p2d, W3B-10). The value
 * stops at white space, & ) " ' , ; and a backslash – safe on serialised JSON (escapes stay whole).
 */
export const AUTH_PARAM_RE = /[\w.-]*auth(?:\[\])?=[^\s&)"',;\\]*/gi

/** Only the auth= rule of redactSecrets – the last pass over a whole report text (JSON and md). */
export function redactAuth(text) {
	return String(text ?? '').replace(AUTH_PARAM_RE, '[REDACTED]')
}

/**
 * Secrets out of a log text for the report (W3E-08): `auth=…` (the Redis
 * password in a session_start() message, tcp://host:6379?auth=…; key and value
 * become [REDACTED], G8 p2d) and the other password parameters (password,
 * passwd, pass, pwd, secret, token, as query or key=value), and the password
 * in user:password@ of a URL. Their value becomes <redacted>; an already
 * redacted value stays as it is.
 */
export function redactSecrets(text) {
	return redactAuth(text)
		// key=value with a prefix/suffix (dbpassword, redis_password, auth_token, requesttoken …)
		.replace(/\b(\w*(?:pass|pwd|secret|token)\w*|auth)=([^\s&)"',;]+)/gi, (_m, k) => `${k}=<redacted>`)
		// JSON "password":"…" and PHP 'password' => '…'
		.replace(/(["'])(\w*(?:pass|pwd|secret|token)\w*|auth)\1(\s*(?::|=>)\s*)(["'])(?:\\.|(?!\4).)*\4/gi, (_m, q, k, sep, q2) => `${q}${k}${q}${sep}${q2}<redacted>${q2}`)
		// Authorization: Bearer|Basic …
		.replace(/\b(Authorization\s*[:=]\s*)(Bearer|Basic)\s+[^\s"',;]+/gi, (_m, h, s) => `${h}${s} <redacted>`)
		// password: …  (value up to the end of the line / separator)
		.replace(/\b(\w*(?:passw(?:or)?d|pwd)\w*)(\s*:\s*)(?!<redacted>)([^\s"',;]+)/gi, (_m, k, sep) => `${k}${sep}<redacted>`)
		.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]*):([^\s/@]+)@/gi, (_m, scheme, user) => `${scheme}${user}:<redacted>@`)
}

/**
 * nextcloud.log lines (JSON per line) → entries with level >= minLevel,
 * grouped by message; `knorke` counts the app's own entries by level (gate
 * rule 7: 0 Knorke entries >= 3); `tooManyClients` the PostgreSQL
 * "too many clients" errors (gate rule 6). Lines that are no JSON are counted
 * in `unparsed`, never silently dropped.
 */
export function parseNcLog(text, minLevel = 2) {
	const byMsg = new Map()
	const byLevel = {}
	const knorke = { total: 0, byLevel: {} }
	let entries = 0
	let unparsed = 0
	let tooManyClients = 0
	for (const line of String(text ?? '').split('\n')) {
		if (!line.trim()) continue
		let j
		try { j = JSON.parse(line) } catch { unparsed++; continue }
		const level = Number(j.level ?? 0)
		const ex = j.exception && typeof j.exception === 'object' ? String(j.exception.Message || '') : ''
		if (/too many clients/i.test(String(j.message || '') + ' ' + ex)) tooManyClients++
		if (level < minLevel) continue
		entries++
		byLevel[level] = (byLevel[level] || 0) + 1
		if (j.app === 'knorke') {
			knorke.total++
			knorke.byLevel[level] = (knorke.byLevel[level] || 0) + 1
		}
		// secrets out BEFORE the cut, so no part of a password survives in the report (W3E-08)
		const msg = redactSecrets(`L${level} ${j.app ? j.app + ': ' : ''}${String(j.message || '')}${ex ? ' | ' + ex : ''}`).slice(0, 200)
		byMsg.set(msg, (byMsg.get(msg) || 0) + 1)
	}
	const top = [...byMsg].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m, n]) => ({ n, m }))
	const knorkeAtLeast3 = Object.entries(knorke.byLevel).reduce((a, [l, n]) => a + (Number(l) >= 3 ? n : 0), 0)
	return { minLevel, entries, byLevel, knorke: { ...knorke, atLeast3: knorkeAtLeast3 }, tooManyClients, unparsed, top }
}

/** redis-cli STRLEN output → bytes (null if it is no integer). */
export function parseStrlen(text) {
	const t = String(text ?? '').trim().replace(/^\(integer\)\s*/, '')
	return /^\d+$/.test(t) ? Number(t) : null
}

/** `occ app:list --output=json` → [[id, version], …] of the enabled apps, sorted (null if no JSON). */
export function parseAppList(text) {
	try {
		const o = JSON.parse(String(text ?? '').trim())
		if (!o || typeof o.enabled !== 'object') return null
		return Object.entries(o.enabled).map(([k, v]) => [k, String(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
	} catch { return null }
}

// --- stage 4, phase 1 (SPEC-M1 §8.7 Revision 19) -----------------------------------

/**
 * Write-budget counters of one board (T4-09, calibration source of §8.7):
 * entries [[key, value], …] of the keys <prefix>/knorke/<epoch>/w:<b>:<pid>:<win>
 * (requests with ops) and wo:<b>:<pid>:<win> (ops incl. derived rows), read
 * with SCAN + GET. Returns the highest value per pid (over the windows seen)
 * and over all pids: {maxPerPid: {syncs, ops}, byPid: {pid: {syncs, ops}}, keys, seed}.
 * Keys of another board or another form are ignored.
 *
 * Seeding (W3E-05, AUD-05): with o.seed = {pid, win} the counters of the
 * seeding owner's pid in the 10-s windows up to and including win (the window
 * of the last seed batch) are the seeding, not the workload: they stay out of
 * maxPerPid and byPid and are reported as seed {syncs, ops, keys} (highest
 * counter per window seen); the same pid's later windows count as workload.
 * @param {Array<[string, string|number]>} entries
 * @param {number|string} board
 * @param {{seed?: {pid: string, win: number}|null}} [o]
 */
export function parseBudgetKeys(entries, board, { seed = null } = {}) {
	const byPid = {}
	const seeded = { syncs: 0, ops: 0, keys: 0 }
	let keys = 0
	// G6 (p2d, W3B-07): a key that expired between SCAN and GET answers nil – "nicht vorhanden", never a 0
	let missing = 0
	const re = new RegExp(`/knorke/[a-z0-9]{1,16}/(w|wo):${String(board)}:([^:/]+):(\\d+)$`)
	for (const [key, value] of entries || []) {
		const m = re.exec(String(key))
		if (!m) continue
		const raw = String(value ?? '').trim()
		if (!/^\d+$/.test(raw)) { missing++; continue }
		const v = Number(raw)
		if (seed && m[2] === seed.pid && Number(m[3]) <= seed.win) {
			seeded.keys++
			if (m[1] === 'w') seeded.syncs = Math.max(seeded.syncs, v)
			else seeded.ops = Math.max(seeded.ops, v)
			continue
		}
		keys++
		const p = (byPid[m[2]] ||= { syncs: 0, ops: 0 })
		if (m[1] === 'w') p.syncs = Math.max(p.syncs, v)
		else p.ops = Math.max(p.ops, v)
	}
	return { maxPerPid: maxOf(byPid), byPid, keys, missing, seed: seed ? seeded : null }
}

const maxOf = (byPid) => {
	const all = Object.values(byPid)
	return { syncs: all.length ? Math.max(...all.map((p) => p.syncs)) : null, ops: all.length ? Math.max(...all.map((p) => p.ops)) : null }
}

/** Two parseBudgetKeys results merged (the maximum of every pid and of all, and of the seed counters). */
export function mergeBudget(a, b) {
	if (!a) return b
	if (!b) return a
	const byPid = { ...a.byPid }
	for (const [pid, v] of Object.entries(b.byPid)) {
		const cur = byPid[pid] || { syncs: 0, ops: 0 }
		byPid[pid] = { syncs: Math.max(cur.syncs, v.syncs), ops: Math.max(cur.ops, v.ops) }
	}
	const sa = a.seed ?? null
	const sb = b.seed ?? null
	const seed = sa && sb ? { syncs: Math.max(sa.syncs, sb.syncs), ops: Math.max(sa.ops, sb.ops), keys: Math.max(sa.keys, sb.keys) } : (sa || sb)
	return { maxPerPid: maxOf(byPid), byPid, keys: Math.max(a.keys, b.keys), missing: (a.missing ?? 0) + (b.missing ?? 0), seed }
}

/** Key kinds rule 7 checks for a TTL (T4-19): r:<b>, p:<b>, vt:<b>, w:<b>:*, wo:<b>:*. */
export function hygienePatterns(board) {
	return [`*/knorke/*/r:${board}`, `*/knorke/*/p:${board}`, `*/knorke/*/vt:${board}`, `*/knorke/*/w:${board}:*`, `*/knorke/*/wo:${board}:*`]
}

/** Thresholds of the board-lock report (§8.7 R19, T4-16): above them the finding goes to [B]. */
export const BOARD_LOCK = Object.freeze({ maxExecMs: 50, voteSyncP95Ms: 120 })

/** The lock statement of BoardStore::lockBoard as pg_stat_statements normalises it. */
export const LOCK_STATEMENT_RE = /^UPDATE \S*knorke_boards SET acl_gen = acl_gen \+/i

/**
 * Board-lock report (T4-16, report only): rows of pg_stat_statements
 * ({calls, mean_ms, max_ms, total_ms, query}) → the lock statement(s) of
 * lockBoard (their execution time includes the wait for the row lock) and
 * the statements on knorke_votes / knorke_vote_sessions, with the vote-sync
 * latency of rule 4 beside them. finding = '[B]' when the lock's max_exec_time
 * is above 50 ms or the vote-sync p95 above 120 ms, else null; a missing
 * measurement gives finding null and measured false.
 * @param {Array<object>|null} rows
 * @param {{p95?: number|null, max?: number|null, n?: number}|null} voteSync
 */
export function boardLockReport(rows, voteSync) {
	const list = Array.isArray(rows) ? rows : []
	const lockRows = list.filter((r) => LOCK_STATEMENT_RE.test(String(r.query || '')))
	const voteRows = list.filter((r) => /knorke_vote(s|_sessions)\b/i.test(String(r.query || '')))
	// G7 (p2d, W3B-08): measured without a lock row = 0 calls ("0 Aufrufe"), not null; null only when not measured
	const lock = lockRows.length ? {
		calls: lockRows.reduce((a, r) => a + Number(r.calls || 0), 0),
		meanMs: Math.max(...lockRows.map((r) => Number(r.mean_ms ?? 0))),
		maxMs: Math.max(...lockRows.map((r) => Number(r.max_ms ?? 0))),
	} : Array.isArray(rows) ? { calls: 0, meanMs: null, maxMs: null } : null
	const vs = voteSync && voteSync.n ? { p95: voteSync.p95 ?? null, max: voteSync.max ?? null, n: voteSync.n } : null
	const over = (lock && lock.maxMs > BOARD_LOCK.maxExecMs) || (vs && typeof vs.p95 === 'number' && vs.p95 > BOARD_LOCK.voteSyncP95Ms)
	return {
		measured: Array.isArray(rows),
		lock,
		votes: voteRows.map((r) => ({ calls: Number(r.calls || 0), meanMs: Number(r.mean_ms ?? 0), maxMs: Number(r.max_ms ?? 0), query: String(r.query || '').slice(0, 160) })),
		voteSync: vs,
		thresholds: BOARD_LOCK,
		finding: over ? '[B]' : null,
	}
}

/**
 * Server-side page requests from Apache's access log (T4-11, port of the
 * spike's pageload.sh): lines "<ip> - - [13/Oct/2026:16:40:01 +0000] "GET /p HTTP/1.1" 200 …"
 * of ONE client ip, counted per time window {name, from, to} (ISO times).
 * R21 (W3V-03): nonOk names every request of the window with a status other
 * than 200 – status, method and path without the query – in log order.
 * @return {Array<{name: string, requests: number, statuses: object, nonOk: Array<{status: number, method: string, path: string}>}>}
 */
export function countAccessLog(text, ip, windows) {
	const mon = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
	const reqs = []
	for (const line of String(text ?? '').split('\n')) {
		if (!line.startsWith(`${ip} `)) continue
		const m = /\[(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+) ([+-])(\d{2})(\d{2})\] "(\S+) (\S+)[^"]*" (\d{3})/.exec(line)
		if (!m || mon[m[2]] === undefined) continue
		const off = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 60000
		const t = Date.UTC(+m[3], mon[m[2]], +m[1], +m[4], +m[5], +m[6]) - off
		reqs.push({ t, status: Number(m[12]), method: m[10], path: m[11].split('?')[0] })
	}
	return (windows || []).map((w) => {
		const a = Math.floor(Date.parse(w.from) / 1000) * 1000
		const b = Date.parse(w.to)
		const inW = reqs.filter((r) => r.t >= a && r.t <= b)
		const statuses = {}
		for (const r of inW) statuses[r.status] = (statuses[r.status] || 0) + 1
		const nonOk = inW.filter((r) => r.status !== 200).map((r) => ({ status: r.status, method: r.method, path: r.path }))
		return { name: w.name, requests: inW.length, statuses, nonOk }
	})
}
