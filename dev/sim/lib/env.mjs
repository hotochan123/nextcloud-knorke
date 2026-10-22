/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Dev-stack access for the HTTP contract tests and the convergence run
 * (SPEC-M0 §8.3). Everything here talks to ONE namespace (KD_NS, default
 * main): env.json from dev/.state/<ns>/ (written by dev/up.sh) names the
 * containers, and the only side channels are `docker exec` into exactly
 * those containers – the database client in knorke-dev-<ns>-db, redis-cli in
 * knorke-dev-<ns>-redis, occ in knorke-dev-<ns>-nc. The names are checked
 * against the namespace before any call, so a hand-edited env.json cannot
 * point the harness at a production container.
 *
 * Database side channel (round 2 U2/U7): Stack.sql() runs portable SQL on
 * every KD_DB kind – psql (pgsql), the mariadb/mysql client (credentials from
 * the database container's own env, never on a command line) or PHP PDO on
 * Nextcloud's database file (sqlite) – and returns rows of strings (NULL →
 * null). The helpers boardRow/itemRow/changes/… use only that. psql(),
 * psqlJson() and pg_stat_statements stay PostgreSQL-only and throw elsewhere.
 *
 * loadEnv() refuses non-pgsql stacks unless the caller passes {anyDb: true}.
 * Both suites pass it (SPEC-M1 §8.6): the contract suite skips its
 * PostgreSQL-only cases visibly, and the convergence run reads the change log
 * through Nextcloud's own database connection (Stack.changesJson, PHP in the
 * Nextcloud container), on every KD_DB kind.
 *
 * Redis keys (SPEC-M1 §5.1): <global prefix>/knorke/<epoch>/<key>. The
 * helpers take patterns built by rkey() – "*" + "/knorke/*" + "/" + key –
 * or, for one epoch, rkeyIn(epoch, key).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SIM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ROOT = path.resolve(SIM_DIR, '..', '..')
export const APP = '/index.php/apps/knorke'
export const DB_KINDS = Object.freeze(['pgsql', 'mariadb', 'mysql', 'sqlite'])

/**
 * Nextcloud's ILimiter state in Redis (SPEC-M1 §8.4 R13, SRV-07): keys
 * <global prefix>/OC\Security\RateLimiting\Backend\MemoryCacheBackend<sha512>
 * (the dev stacks always run with memcache.distributed = Redis). The same
 * pattern as RATELIMIT_PATTERN in dev/e2e/hostbridge.sh (ratelimit-reset).
 */
export const RATELIMIT_PATTERN = '*/OC*RateLimiting*MemoryCacheBackend*'

/**
 * The daily byte counters of P7-01 (SPEC-M1 §33.1 b): wd:<b>:<tag> per board
 * and wu:<uh>:<tag> per account, under every epoch. ratelimitReset() clears
 * them with the ILimiter state (§33.1 j, ED-24), like the bridge action
 * ratelimit-reset (dev/e2e/hostbridge.sh WD_PATTERN, WU_PATTERN).
 */
export const BYTE_COUNTER_PATTERNS = Object.freeze(['*/knorke/*/wd:*', '*/knorke/*/wu:*'])

/** Redis pattern of one Knorke key under any epoch (SPEC-M1 §5.1), e.g. rkey('r:7'). */
export const rkey = (key) => `*/knorke/*/${key}`
/** Redis pattern of one Knorke key under the given epoch. */
export function rkeyIn(epoch, key) {
	if (!/^[a-z0-9]{1,16}$/.test(String(epoch))) throw new Error(`Epoche '${epoch}' ist ungültig`)
	return `*/knorke/${epoch}/${key}`
}
/** The epoch segment of a real key "<prefix>/knorke/<epoch>/<key>", or null. */
export function epochOfKey(key) {
	const m = /\/knorke\/([a-z0-9]{1,16})\/[a-z]+:/.exec(String(key))
	return m ? m[1] : null
}

/**
 * Is `ns` a protected namespace that a node entry point must refuse – before
 * loadEnv and before any docker call, with exit 2 (SPEC-M1 §8.1 "Geschützte
 * Namensräume", R20 K2; the same rule as guard_ns in dev/lib.sh)? The list is
 * KD_PROTECT_NS (default try; an explicitly empty value protects nothing),
 * KD_FORCE=1 passes. The one shared check of dev/load/lib/pageload.mjs,
 * dev/selftest/lib/restore-probe.mjs and dev/ipad/moderate.mjs.
 * @param {string} ns
 * @param {Record<string, string|undefined>} [env] process.env
 */
export function protectedNs(ns, env = process.env) {
	const list = String(env.KD_PROTECT_NS ?? 'try').split(/[\s,]+/).filter(Boolean)
	return list.includes(ns) && env.KD_FORCE !== '1'
}

/**
 * Reads dev/.state/<ns>/env.json and checks that every name belongs to the namespace.
 * @param {string} [ns] namespace (KD_NS, default main)
 * @param {{anyDb?: boolean}} [o] anyDb: accept every KD_DB kind (default: pgsql only)
 */
export function loadEnv(ns = process.env.KD_NS || 'main', { anyDb = false } = {}) {
	if (!/^[a-z]{1,8}$/.test(ns)) throw new Error(`KD_NS='${ns}' ist ungültig`)
	const file = path.join(ROOT, 'dev', '.state', ns, 'env.json')
	let env
	try {
		env = JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch (e) {
		throw new Error(`${file} fehlt oder ist kaputt – erst KD_NS=${ns} dev/up.sh (${e.message})`)
	}
	const kind = env.db?.kind ?? 'pgsql'
	if (!DB_KINDS.includes(kind)) throw new Error(`env.json: db.kind = '${kind}' ist unbekannt`)
	// SQLite has no database container (env.json containers.db = null)
	const want = { nc: `knorke-dev-${ns}-nc`, db: kind === 'sqlite' ? null : `knorke-dev-${ns}-db`, redis: `knorke-dev-${ns}-redis` }
	for (const [k, v] of Object.entries(want)) {
		if ((env.containers?.[k] ?? null) !== v) throw new Error(`env.json: containers.${k} = '${env.containers?.[k]}', erwartet '${v}'`)
	}
	if (env.ns !== ns) throw new Error(`env.json gehört zu '${env.ns}', nicht zu '${ns}'`)
	if (kind !== 'pgsql' && !anyDb) throw new Error(`dieser Aufruf braucht KD_DB=pgsql (psql); Namensraum ${ns} hat ${kind} (alle Arten: loadEnv(ns, {anyDb: true}))`)
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(env.ncIp || '')) throw new Error('env.json: ncIp fehlt')
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(env.gatewayIp || '')) throw new Error('env.json: gatewayIp fehlt')
	return env
}

/**
 * Runs a command without a shell. Resolves {ok, code, out, err}; never rejects, not even on a
 * stdin error (EPIPE is dropped, any other one is appended to err).
 * input: string written to stdin (the database clients read their SQL from there, so no quoting).
 */
export function run(cmd, args, { input = null, timeoutMs = 30000 } = {}) {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
		let out = ''
		let err = ''
		let done = false
		const timer = setTimeout(() => {
			if (!done) { err += `\n[timeout nach ${timeoutMs} ms]`; p.kill('SIGKILL') }
		}, timeoutMs)
		p.stdout.on('data', (c) => { out += c })
		p.stderr.on('data', (c) => { err += c })
		p.on('error', (e) => { err += String(e) })
		p.on('close', (code) => {
			done = true
			clearTimeout(timer)
			resolve({ ok: code === 0, code, out, err })
		})
		// A child that exits before reading all of stdin makes the pending write fail with EPIPE;
		// without a listener Node throws it as an uncaught exception and node:test blames whatever
		// case is running. EPIPE says nothing the exit code and stderr do not, so it is dropped;
		// any other stdin error goes to err on a line of its own (ok stays the exit code's).
		p.stdin.on('error', (e) => {
			if (e.code !== 'EPIPE') err += `${err && !err.endsWith('\n') ? '\n' : ''}${String(e)}\n`
		})
		if (input !== null) p.stdin.end(input)
		else p.stdin.end()
	})
}

/** Marker for SQL NULL in the tab-separated output of every client. */
const NULL = '\\N'

/**
 * Connection charset of the mariadb/mysql client in Stack.sql (P7-D, VC-01);
 * dev/lib.sh db_sql and dev/db.sh pass the same flag (dev/sim/env.test.mjs).
 */
export const MYSQL_CHARSET_FLAG = '--default-character-set=utf8mb4'

/**
 * PHP for SQL against an SQLite stack (the Nextcloud image has no sqlite3 CLI;
 * same idea as dev/lib.sh db_sql): statements separated by ";" at the end of a
 * line, run with PDO on Nextcloud's database file as www-data, rows
 * tab-separated, NULL as \N. Exit 1 on the first error.
 */
const SQLITE_PHP = `
$CONFIG = [];
require "/var/www/html/config/config.php";
if (!in_array($CONFIG["dbtype"] ?? "", ["sqlite", "sqlite3"], true)) { fwrite(STDERR, "dbtype ist nicht sqlite\\n"); exit(1); }
$file = rtrim($CONFIG["datadirectory"] ?? "/var/www/html/data", "/") . "/" . ($CONFIG["dbname"] ?? "owncloud") . ".db";
try {
    $pdo = new PDO("sqlite:" . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 30]);
    foreach (preg_split("/;[ \\t]*(\\r?\\n|$)/", stream_get_contents(STDIN)) as $sql) {
        if (trim($sql) === "") { continue; }
        $st = $pdo->query($sql);
        if ($st->columnCount() === 0) { continue; }
        while (($row = $st->fetch(PDO::FETCH_NUM)) !== false) {
            echo implode("\\t", array_map(static fn ($v) => $v === null ? "\\\\N" : (string)$v, $row)), "\\n";
        }
    }
} catch (Throwable $e) { fwrite(STDERR, $e->getMessage() . "\\n"); exit(1); }
`

/**
 * PHP for the exact change-log reader (SPEC-M1 §8.6): boots Nextcloud
 * (lib/base.php, as www-data) and reads oc_knorke_changes of one board through
 * Nextcloud's own database connection, ordered (rev, item_id), plus a
 * COUNT(*) through the same connection. Output: one JSON document
 * {count, rows: [{rev, item_id, op, patch, actor, client}]}. The board id
 * comes from the environment (KD_BOARD), never from the code string.
 */
const CHANGES_PHP = `
require_once "/var/www/html/lib/base.php";
$b = getenv("KD_BOARD");
if (!is_string($b) || !preg_match("/^[0-9]{1,18}$/", $b)) { fwrite(STDERR, "KD_BOARD fehlt\\n"); exit(1); }
$db = \\OCP\\Server::get(\\OCP\\IDBConnection::class);
$qb = $db->getQueryBuilder();
$qb->select("rev", "item_id", "op", "patch", "actor", "client")->from("knorke_changes")
    ->where($qb->expr()->eq("board_id", $qb->createNamedParameter((int) $b, \\OCP\\DB\\QueryBuilder\\IQueryBuilder::PARAM_INT)))
    ->orderBy("rev")->addOrderBy("item_id");
$res = $qb->executeQuery();
$rows = [];
while (($r = $res->fetch()) !== false) {
    $rows[] = ["rev" => (int) $r["rev"], "item_id" => (string) $r["item_id"], "op" => (string) $r["op"],
        "patch" => $r["patch"] === null ? null : (string) $r["patch"], "actor" => $r["actor"], "client" => $r["client"]];
}
$res->closeCursor();
$cq = $db->getQueryBuilder();
$cq->select($cq->func()->count("*", "n"))->from("knorke_changes")
    ->where($cq->expr()->eq("board_id", $cq->createNamedParameter((int) $b, \\OCP\\DB\\QueryBuilder\\IQueryBuilder::PARAM_INT)));
$c = $cq->executeQuery();
$n = (int) $c->fetchOne();
$c->closeCursor();
echo json_encode(["count" => $n, "rows" => $rows], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`

/** Side channels into the dev stack of one namespace (database, redis-cli, occ). */
export class Stack {
	constructor(env) {
		this.env = env
		this.kind = env.db?.kind ?? 'pgsql'
		this.db = env.containers.db
		this.redisName = env.containers.redis
		this.nc = env.containers.nc
	}

	/**
	 * Does Nextcloud store 4-byte UTF-8 on this stack (IDBConnection::supports4ByteText)?
	 * false only for MariaDB/MySQL with mysql.utf8mb4 = false (KD_MYSQL_UTF8MB4=0).
	 */
	get supports4Byte() {
		return !((this.kind === 'mariadb' || this.kind === 'mysql') && this.env.db?.utf8mb4 === false)
	}

	/** "pgsql 17.10", "mariadb 11.8.9 (utf8mb3)" – for messages and reports. */
	get dbLabel() {
		const v = this.env.versions?.db || this.kind
		return this.supports4Byte ? v : `${v} (utf8mb3, KD_MYSQL_UTF8MB4=0)`
	}

	/**
	 * Runs SQL (one or more statements, each ending with ";" at the end of a
	 * line) on any KD_DB kind; returns the result rows as arrays of strings,
	 * NULL as null. Throws on an error. Write only portable SQL here.
	 */
	async sql(sql) {
		let r
		if (this.kind === 'pgsql') {
			r = await run('docker', ['exec', '-i', this.db, 'psql', '-U', 'nextcloud', '-d', 'nextcloud',
				'-X', '-q', '-A', '-t', '-F', '\t', '-P', `null=${NULL}`, '-v', 'ON_ERROR_STOP=1'], { input: sql })
		} else if (this.kind === 'mariadb' || this.kind === 'mysql') {
			// -r: no escaping of \ and tabs in values; NULL prints as NULL.
			// --default-character-set=utf8mb4 (P7-D, VC-01): without it the mysql
			// client in mysql:8.4 talks latin1 (no locale in the container) and reads
			// every 4-byte character back as "?". On a utf8mb3 stack (KD_MYSQL_UTF8MB4=0)
			// the server converts losslessly, so the flag is right for every stack.
			const client = this.kind === 'mariadb'
				? `MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb ${MYSQL_CHARSET_FLAG} -u "$MARIADB_USER" -N -B -r "$MARIADB_DATABASE"`
				: `MYSQL_PWD="$MYSQL_PASSWORD" exec mysql ${MYSQL_CHARSET_FLAG} -u "$MYSQL_USER" -N -B -r "$MYSQL_DATABASE"`
			r = await run('docker', ['exec', '-i', this.db, 'sh', '-c', client], { input: sql })
		} else {
			r = await run('docker', ['exec', '-i', '-u', 'www-data', this.nc, 'php', '-r', SQLITE_PHP], { input: sql })
		}
		if (!r.ok) throw new Error(`SQL (${this.kind}): ${r.err.trim() || r.out.trim()}`)
		const nullText = this.kind === 'mariadb' || this.kind === 'mysql' ? 'NULL' : NULL
		return r.out.split('\n').filter((l) => l !== '').map((l) => l.split('\t').map((v) => (v === nullText ? null : v)))
	}

	/** First row of sql(), or null. */
	async sqlRow(sql) {
		return (await this.sql(sql))[0] ?? null
	}

	/** Refuses PostgreSQL-only calls on other kinds with a clear message. */
	requirePgsql(what) {
		if (this.kind !== 'pgsql') throw new Error(`${what} gibt es nur mit KD_DB=pgsql (dieser Stack: ${this.kind})`)
	}

	/** PostgreSQL only: runs SQL (ON_ERROR_STOP), returns the unaligned, tuples-only output lines. */
	async psql(sql) {
		this.requirePgsql('psql')
		const r = await run('docker', ['exec', '-i', this.db, 'psql', '-U', 'nextcloud', '-d', 'nextcloud',
			'-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql })
		if (!r.ok) throw new Error(`psql: ${r.err.trim() || r.out.trim()}`)
		return r.out.split('\n').filter((l) => l !== '')
	}

	/** PostgreSQL only: one SELECT that yields a single JSON value (json_agg/json_build_object). */
	async psqlJson(sql) {
		const lines = await this.psql(sql)
		if (!lines.length) return null
		return JSON.parse(lines.join('\n'))
	}

	async redis(...args) {
		const r = await run('docker', ['exec', this.redisName, 'redis-cli', ...args.map(String)])
		if (!r.ok) throw new Error(`redis-cli ${args[0]}: ${r.err.trim()}`)
		return r.out.replace(/\n$/, '')
	}

	/** Keys matching a glob (SCAN, never KEYS). */
	async redisScan(pattern) {
		const out = await this.redis('--scan', '--pattern', pattern)
		return out.split('\n').filter(Boolean).sort()
	}

	/** Deletes every key matching one of the patterns; returns the deleted keys. */
	async redisDel(...patterns) {
		const keys = []
		for (const p of patterns) keys.push(...await this.redisScan(p))
		for (const k of keys) await this.redis('DEL', k)
		return keys
	}

	/** {key, value, ttl} of the first key matching pattern, or null. Values are returned raw (string). */
	async redisGet(pattern) {
		const [key] = await this.redisScan(pattern)
		if (!key) return null
		const value = await this.redis('GET', key)
		const ttl = Number(await this.redis('TTL', key))
		return { key, value, ttl }
	}

	/**
	 * The exact change log of a board through Nextcloud's own connection (PHP in
	 * the Nextcloud container, every KD_DB kind; SPEC-M1 §8.6):
	 * {count, rows: [{rev, item_id, op, patch, actor, client}]}, rows ordered
	 * (rev, item_id), patch as the stored JSON text (or null). Throws when the
	 * COUNT(*) of the same connection differs from the number of rows read.
	 */
	async changesJson(board) {
		assertId(board)
		const r = await run('docker', ['exec', '-i', '-e', `KD_BOARD=${board}`, '-u', 'www-data', this.nc, 'php', '-r', CHANGES_PHP], { timeoutMs: 120000 })
		if (!r.ok) throw new Error(`changesJson(${board}): ${(r.err || r.out).trim().slice(0, 400)}`)
		let doc
		try {
			doc = JSON.parse(r.out.slice(r.out.indexOf('{')))
		} catch (e) {
			throw new Error(`changesJson(${board}): Ausgabe ist kein JSON (${e.message}): ${r.out.slice(0, 200)}`)
		}
		if (!Array.isArray(doc?.rows) || !Number.isInteger(doc?.count)) throw new Error(`changesJson(${board}): Form {count, rows} fehlt`)
		if (doc.count !== doc.rows.length) throw new Error(`changesJson(${board}): COUNT(*) = ${doc.count}, gelesen ${doc.rows.length} Zeilen`)
		return doc
	}

	/** The board epoch of the instance (IAppConfig knorke/epoch), '' when unset. */
	async epoch() {
		return (await this.occ('config:app:get', 'knorke', 'epoch').catch(() => '')).trim()
	}

	/** occ knorke:epoch:rotate (SPEC-M1 §5.4); returns {before, after} read back through occ. */
	async rotateEpoch() {
		const before = await this.epoch()
		const out = await this.occ('knorke:epoch:rotate')
		const after = await this.epoch()
		return { before, after, out }
	}

	async occ(...args) {
		const r = await run('docker', ['exec', '-u', 'www-data', this.nc, 'php', 'occ', ...args.map(String)], { timeoutMs: 60000 })
		if (!r.ok) throw new Error(`occ ${args.join(' ')}: ${(r.err || r.out).trim()}`)
		return r.out.trim()
	}

	/**
	 * Clears Nextcloud's ILimiter state (SCAN + DEL of RATELIMIT_PATTERN), the
	 * stack helper of SPEC-M1 §8.4 (R13): the budgets of routes 20/21
	 * (knorke-share, knorke-share-new, knorke-sharees), knorke-linkjoin and
	 * (P7-C) knorke-link outlive a run otherwise. P7-C (SPEC-M1 §33.1 j,
	 * ED-24): also the daily byte counters wd:/wu: (BYTE_COUNTER_PATTERNS), so
	 * every case starts with empty counters. contract.mjs calls it before every
	 * case (R19).
	 * @return {Promise<number>} deleted keys
	 */
	async ratelimitReset() {
		return (await this.redisDel(RATELIMIT_PATTERN, ...BYTE_COUNTER_PATTERNS)).length
	}

	/** occ security:bruteforce:reset <gateway> – the address every request of the harness comes from. */
	async bruteforceReset() {
		return this.occ('security:bruteforce:reset', this.env.gatewayIp)
	}

	/** Rows of oc_bruteforce_attempts for the gateway (the link throttle counts there). */
	async bruteforceAttempts() {
		const [n] = await this.sqlRow(`SELECT count(*) FROM oc_bruteforce_attempts WHERE ip = '${this.env.gatewayIp}';`)
		return Number(n)
	}

	/** {id, rev, min_rev, item_count, item_bytes, acl_gen, link_gen} of a board, or null. */
	async boardRow(board) {
		assertId(board)
		const row = await this.sqlRow(`SELECT id, rev, min_rev, item_count, item_bytes, acl_gen, link_gen FROM oc_knorke_boards WHERE id = ${board};`)
		if (!row) return null
		const [id, rev, minRev, count, bytes, acl, link] = row.map(Number)
		return { id, rev, min_rev: minRev, item_count: count, item_bytes: bytes, acl_gen: acl, link_gen: link }
	}

	/**
	 * Byte accounting of a board (T1): item_bytes and item_count of the board
	 * row next to Σ octet_length(data) + octet_length(style) and the count of
	 * the live items (octet_length: bytes on every kind). null when the board
	 * row does not exist (any more).
	 */
	async byteAccount(board) {
		assertId(board)
		const row = await this.sqlRow(`SELECT
			(SELECT item_bytes FROM oc_knorke_boards WHERE id = ${board}),
			(SELECT item_count FROM oc_knorke_boards WHERE id = ${board}),
			(SELECT coalesce(sum(octet_length(coalesce(data, '')) + octet_length(coalesce(style, ''))), 0) FROM oc_knorke_items WHERE board_id = ${board} AND deleted = 0),
			(SELECT count(*) FROM oc_knorke_items WHERE board_id = ${board} AND deleted = 0);`)
		if (!row || row[0] === null) return null
		const [bytes, count, sum, live] = row.map(Number)
		return { bytes, count, sum, live }
	}

	async itemRow(board, id) {
		assertId(board)
		assertUlid(id)
		const row = await this.sqlRow(`SELECT id, rev, version, deleted, parent_id, x, y FROM oc_knorke_items WHERE board_id = ${board} AND id = '${id}';`)
		if (!row) return null
		return { id: row[0], rev: Number(row[1]), version: Number(row[2]), deleted: Number(row[3]), parent_id: row[4], x: Number(row[5]), y: Number(row[6]) }
	}

	/** data and style of an item exactly as stored (strings), or null. */
	async itemStored(board, id) {
		assertId(board)
		assertUlid(id)
		const row = await this.sqlRow(`SELECT data, style FROM oc_knorke_items WHERE board_id = ${board} AND id = '${id}';`)
		return row ? { data: row[0], style: row[1] } : null
	}

	/** The stored title of a board, or null. */
	async boardTitle(board) {
		assertId(board)
		const row = await this.sqlRow(`SELECT title FROM oc_knorke_boards WHERE id = ${board};`)
		return row ? row[0] : null
	}

	async changeCount(board) {
		assertId(board)
		const [n] = await this.sqlRow(`SELECT count(*) FROM oc_knorke_changes WHERE board_id = ${board};`)
		return Number(n)
	}

	/**
	 * The whole change log of a board, ordered (rev, item_id): [{rev, item_id,
	 * op, patch, actor, client}], patch as the stored JSON text (or null).
	 * PostgreSQL keeps the json_agg path the convergence run was measured with.
	 */
	async changes(board) {
		assertId(board)
		if (this.kind === 'pgsql') {
			return (await this.psqlJson(`SELECT coalesce(json_agg(c ORDER BY c.rev, c.item_id), '[]'::json) FROM (SELECT rev, item_id, op, patch, actor, client FROM oc_knorke_changes WHERE board_id = ${board}) c`)) || []
		}
		const rows = await this.sql(`SELECT rev, item_id, op, patch, actor, client FROM oc_knorke_changes WHERE board_id = ${board} ORDER BY rev, item_id;`)
		return rows.map(([rev, itemId, op, p, actor, client]) => ({ rev: Number(rev), item_id: itemId, op, patch: p, actor, client }))
	}

	/** pg_stat_statements (PostgreSQL only): reset, and the calls of statements on oc_knorke_* since then. */
	async pgssReset() {
		this.requirePgsql('pg_stat_statements')
		await this.psql('SELECT pg_stat_statements_reset()')
	}

	async pgssCount() {
		this.requirePgsql('pg_stat_statements')
		return this.psqlJson(`SELECT json_build_object(
			'total', coalesce(sum(calls), 0),
			'statements', coalesce(json_agg(json_build_object('calls', calls, 'query', left(query, 160)) ORDER BY calls DESC), '[]'::json))
			FROM pg_stat_statements WHERE query ILIKE '%oc_knorke_%'`)
	}

	/**
	 * Brücken-Aktion set-min-rev (§8.2): rev and min_rev both become rev + 1 in ONE
	 * statement inside one transaction (this assignment order is right on every
	 * kind: MySQL/MariaDB assign left to right, PostgreSQL/SQLite from the old
	 * row), then a: and r: go, so every client with the old since gets resync and
	 * the snapshot ends the loop.
	 */
	async setMinRev(board) {
		assertId(board)
		const r = await this.sqlRow(['BEGIN;',
			`UPDATE oc_knorke_boards SET min_rev = rev + 1, rev = rev + 1 WHERE id = ${board};`,
			`SELECT rev, min_rev FROM oc_knorke_boards WHERE id = ${board};`,
			'COMMIT;'].join('\n'))
		const row = r ? { rev: Number(r[0]), min_rev: Number(r[1]) } : null
		const keys = await this.redisDel(rkey(`a:${board}`), rkey(`r:${board}`))
		return { row, keys }
	}

	/**
	 * Bridge action vote-expire (SPEC-M1 §8.4 R16), the same as in
	 * dev/e2e/hostbridge.sh: in ONE transaction ends_at = now − 1 ms of the
	 * board's open voting session; boards.meta (also meta.vote.endsAt), rev and
	 * meta_rev stay as they are – "expired, not closed yet" (§4.12.1). The
	 * same transaction reads the session and the board's rev/meta_rev back.
	 * Then vt:<b> goes (a moderator poll must not skip the close on a matching
	 * vt:). Throws when the board has no open session (nothing changed).
	 * @return {Promise<{sid: number, endsAt: number, now: number, rev: number|null, metaRev: number|null, keys: string[]}>}
	 */
	async voteExpire(board) {
		assertId(board)
		const now = Date.now()
		const rows = await this.sql(['BEGIN;',
			`UPDATE oc_knorke_vote_sessions SET ends_at = ${now - 1} WHERE board_id = ${board} AND state = 'open';`,
			`SELECT 'vs', id, ends_at FROM oc_knorke_vote_sessions WHERE board_id = ${board} AND state = 'open' ORDER BY id DESC;`,
			`SELECT 'bd', rev, meta_rev FROM oc_knorke_boards WHERE id = ${board};`,
			'COMMIT;'].join('\n'))
		const vs = rows.find((r) => r[0] === 'vs')
		const bd = rows.find((r) => r[0] === 'bd')
		if (!vs) throw new Error(`voteExpire(${board}): keine offene Abstimmung – nichts geändert`)
		const keys = await this.redisDel(rkey(`vt:${board}`))
		return { sid: Number(vs[1]), endsAt: Number(vs[2]), now, rev: bd ? Number(bd[1]) : null, metaRev: bd ? Number(bd[2]) : null, keys }
	}

	/**
	 * Bridge action purge-tombstones (SPEC-M1 §8.4 R19, T4-07), the same as in
	 * dev/e2e/hostbridge.sh: olderThanMs is an AGE (0–2592000000). In ONE SQL
	 * transaction modified_at of every tombstone of the board with
	 * modified_at ≤ now − olderThanMs becomes now − tombstone_days·86400000 − 1
	 * (the effective tombstone_days: app config, else 30); then
	 * `occ knorke:compact --board=<b>` WITHOUT --now. Used by C78 and the
	 * convergence fault `purge` (§8.6, T4-14).
	 * @return {Promise<{board: number, blocks: number, tombstones: number, changes: number, minRevBefore: number, minRev: number, rev: number, backdated: number, olderThanMs: number, tombstoneDays: number, now: number}>}
	 *   compact's JSON line of the board plus the board's rev
	 */
	async purgeTombstones(board, olderThanMs) {
		const { backdated, days, now } = await this.backdateTombstones(board, olderThanMs)
		const out = await this.occ('knorke:compact', `--board=${board}`)
		const line = compactLine(out, board)
		if (!line) throw new Error(`purgeTombstones(${board}): occ knorke:compact --board=${board} lieferte keine JSON-Zeile: ${out.slice(0, 200)}`)
		const [rev] = await this.sqlRow(`SELECT rev FROM oc_knorke_boards WHERE id = ${board};`)
		return { ...line, rev: Number(rev), backdated, olderThanMs, tombstoneDays: days, now }
	}

	/**
	 * The SQL half of purge-tombstones: in ONE transaction modified_at of every
	 * tombstone of the board with modified_at ≤ now − olderThanMs becomes
	 * now − tombstone_days·86400000 − 1 (app config, else 30 days), so the
	 * next compact (or CleanupJob, C78's job path) purges them. Throws when
	 * the board does not exist (nothing changed).
	 * @return {Promise<{backdated: number, days: number, now: number}>}
	 */
	async backdateTombstones(board, olderThanMs) {
		assertId(board)
		if (!Number.isSafeInteger(olderThanMs) || olderThanMs < 0 || olderThanMs > PURGE_AGE_MAX) throw new Error(`purgeTombstones: Alter ${olderThanMs} ungültig (0–${PURGE_AGE_MAX} ms)`)
		const stored = (await this.occ('config:app:get', 'knorke', 'tombstone_days').catch(() => '')).trim()
		const days = /^[1-9][0-9]{0,8}$/.test(stored) ? Number(stored) : TOMBSTONE_DAYS_DEFAULT
		const now = Date.now()
		const back = now - days * 86400000 - 1
		const rows = await this.sql(['BEGIN;',
			`UPDATE oc_knorke_items SET modified_at = ${back} WHERE board_id = ${board} AND deleted = 1 AND modified_at <= ${now - olderThanMs};`,
			`SELECT 'n', count(*) FROM oc_knorke_items WHERE board_id = ${board} AND deleted = 1 AND modified_at = ${back};`,
			`SELECT 'bd', rev, min_rev FROM oc_knorke_boards WHERE id = ${board};`,
			'COMMIT;'].join('\n'))
		if (!rows.some((r) => r[0] === 'bd')) throw new Error(`purgeTombstones(${board}): Board gibt es nicht – nichts geändert`)
		return { backdated: Number(rows.find((r) => r[0] === 'n')?.[1] ?? 0), days, now }
	}

	/**
	 * occ knorke:compact (SPEC-M1 §4.13.7 (a)–(d)) with the given options
	 * (e.g. '--board=7'): the JSON lines it printed, one per processed board.
	 */
	async compact(...opts) {
		const out = await this.occ('knorke:compact', ...opts)
		return compactLines(out)
	}

	/**
	 * State of a board's voting sessions straight from the database (C69–C72):
	 * [{id, state, seq, voters, ends_at, closed_at, results}], oldest first.
	 */
	async voteSessions(board) {
		assertId(board)
		const rows = await this.sql(`SELECT id, state, seq, voters, ends_at, closed_at, results FROM oc_knorke_vote_sessions WHERE board_id = ${board} ORDER BY id;`)
		return rows.map(([id, state, seq, voters, endsAt, closedAt, results]) => ({
			id: Number(id), state, seq: Number(seq), voters: Number(voters),
			ends_at: endsAt === null ? null : Number(endsAt), closed_at: closedAt === null ? null : Number(closedAt), results,
		}))
	}

	/** Number of vote rows (oc_knorke_votes) of a session. */
	async voteRowCount(sid) {
		assertId(sid)
		const [n] = await this.sqlRow(`SELECT count(*) FROM oc_knorke_votes WHERE session_id = ${sid};`)
		return Number(n)
	}
}

/** Highest age purge-tombstones takes (30 days in ms, SPEC-M1 §8.4 R19). */
export const PURGE_AGE_MAX = 2592000000
/** TOMBSTONE_RETENTION_DAYS when the app config tombstone_days is not set (§4.8). */
export const TOMBSTONE_DAYS_DEFAULT = 30
/** The keys of one JSON line of occ knorke:compact (§4.13.7 (d)). */
export const COMPACT_KEYS = Object.freeze(['board', 'blocks', 'tombstones', 'changes', 'minRevBefore', 'minRev'])

/** Every JSON object line of occ knorke:compact output (notices before it are skipped). */
export function compactLines(out) {
	const lines = []
	for (const l of String(out).split('\n')) {
		if (!l.startsWith('{')) continue
		try {
			const o = JSON.parse(l)
			if (o && typeof o === 'object' && !Array.isArray(o)) lines.push(o)
		} catch { /* not JSON */ }
	}
	return lines
}

/** The JSON line of board b in occ knorke:compact output, or null. */
export function compactLine(out, board) {
	const all = compactLines(out).filter((o) => String(o.board) === String(board))
	return all.length ? all[all.length - 1] : null
}

export function assertId(board) {
	if (!/^\d{1,18}$/.test(String(board))) throw new Error(`Board-ID '${board}' ist ungültig`)
}

export function assertUlid(id) {
	if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(String(id))) throw new Error(`'${id}' ist keine ULID`)
}
