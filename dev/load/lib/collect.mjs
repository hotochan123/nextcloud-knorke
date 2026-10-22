/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Thin collectors of the load run (SPEC-M1 §8.7 "Metriken"): they only read
 * raw text and hand it to the pure parsers of metrics.mjs. Every side channel
 * goes to the containers of ONE namespace (Stack of dev/sim/lib/env.mjs,
 * names checked by loadEnv against knorke-dev-<ns>-*), read-only:
 *
 *   cgroup CPU    /sys/fs/cgroup/…/<container id>/cpu.stat (docker inspect -f {{.Id}})
 *   Apache        GET <env.load.statusUrl> (mod_status on :8081, KD_APACHE_STATUS=1)
 *   PostgreSQL    pg_stat_database, pg_stat_statements (psql in knorke-dev-<ns>-db);
 *                 after the window the lock statement of lockBoard and the
 *                 statements on knorke_votes/knorke_vote_sessions (board-lock
 *                 report, §8.7 R19, T4-16)
 *   Redis         INFO all (commandstats), STRLEN of the presence blob p:<b>,
 *                 every 5 s the write-budget counters w:<b>:* and wo:<b>:*
 *                 (SCAN + MGET, the calibration source of §8.7 R19, T4-09),
 *                 after the run the TTL of r:/p:/vt:/w:/wo: (rule 7, T4-19)
 *   Nextcloud     nextcloud.log lines >= level 2 since the window start, occ app:list
 *   host          /proc/loadavg, uptime; the generator's own CPU (process.cpuUsage)
 *
 * The one write is pg_stat_statements_reset() at the window start (the
 * spike did the same; it touches only the throwaway stack's statistics).
 *
 * Fix round p2d (W3 r2w3): the CPU mean is time-weighted (Δusage / Δtime
 * over the valid intervals), a reading closer than MIN_INTERVAL_MS to the
 * previous one is dropped (the previous one stays), and intervals above the
 * container's cap (cgroup cpu.max, cpuset, host CPUs) are named (G5,
 * W3B-06); the write-budget counters are read on their own 5-s clock
 * (startBudget, G6/W3B-07) – a slow 1-s sample no longer stretches them to
 * 13–19 s. Mini-fix p2e (review of p2d, finding 1): one read is SCAN + ONE
 * MGET per key kind (4 docker exec instead of one GET per key, 197–277 keys
 * took 7–11 s); between two reads at least budgetMinGapMs (never a spin);
 * a read that ends after the window end (endBudget) is dropped and counted.
 * Close-out of stage 4 (R21, W3V-01): the cap is the container's own cpu.max
 * and cpuset first; only a cgroup with neither falls back to the host's CPUs,
 * counted without the generator's affinity (os.cpus(), not
 * os.availableParallelism(), which follows `taskset -c 4-7` and gave 4).
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { run, rkeyIn } from '../../sim/lib/env.mjs'
import * as M from './metrics.mjs'

const NC_LOG = '/var/www/html/data/nextcloud.log'
const PG_DB_SQL = "SELECT row_to_json(t) FROM (SELECT xact_commit, xact_rollback, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, blks_hit, blks_read, sessions, numbackends, deadlocks FROM pg_stat_database WHERE datname = 'nextcloud') t"
const PG_TOP_SQL = "SELECT coalesce(json_agg(t), '[]') FROM (SELECT calls, round(total_exec_time::numeric, 1) AS total_ms, round(mean_exec_time::numeric, 3) AS mean_ms, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'nextcloud') ORDER BY calls DESC LIMIT 25) t"
const PG_BACKENDS_SQL = "SELECT numbackends FROM pg_stat_database WHERE datname = 'nextcloud'"
/** Board-lock report (T4-16): calls, mean and max execution time of lockBoard's UPDATE and of the vote statements. */
export const PG_LOCK_SQL = "SELECT coalesce(json_agg(t), '[]') FROM (SELECT calls, round(mean_exec_time::numeric, 3) AS mean_ms, round(max_exec_time::numeric, 3) AS max_ms, round(total_exec_time::numeric, 1) AS total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'nextcloud') AND (query ILIKE 'UPDATE %knorke_boards SET acl_gen = acl_gen%' OR query ILIKE '%knorke_votes%' OR query ILIKE '%knorke_vote_sessions%') ORDER BY max_exec_time DESC LIMIT 20) t"

/** G5 (p2d, W3B-06): a reading closer than this to the previous one is no interval – dropped, the previous one stays. */
export const MIN_INTERVAL_MS = 200

/** Number of CPUs in a cpuset list like 0-3,8 (0 when it is none). */
export function cpusetCount(text) {
	let n = 0
	for (const part of String(text ?? '').trim().split(',')) {
		const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
		if (m) n += m[2] === undefined ? 1 : Math.max(0, Number(m[2]) - Number(m[1]) + 1)
	}
	return n
}

/**
 * The CPU cap of a cgroup in cores (G5; R21 W3V-01): the container's own limits first – the smaller of
 * cpu.max (quota/period) and the cpuset; only without either the host's CPUs (hostCpus). read(file)
 * returns the text or throws.
 */
export function cgroupCap(dir, read, hostCpus) {
	let cap = null
	const lower = (v) => { if (v > 0 && (cap === null || v < cap)) cap = v }
	if (dir) {
		try {
			const [q, p] = String(read(`${dir}/cpu.max`)).trim().split(/\s+/)
			if (q !== 'max' && Number(q) > 0 && Number(p) > 0) lower(Number(q) / Number(p))
		} catch { /* no cpu.max */ }
		try { lower(cpusetCount(read(`${dir}/cpuset.cpus.effective`))) } catch { /* no cpuset */ }
	}
	// W3V-01: the host only when the container names no limit of its own
	if (cap === null && hostCpus > 0) cap = hostCpus
	return cap === null ? null : Math.round(cap * 1000) / 1000
}

/** cgroup CPU and memory of the namespace's containers, sampled by the caller once a second. */
export class CpuSampler {
	/**
	 * @param {Record<string, string|null>} names e.g. {nc, db, redis} → container names
	 * @param {{cmd?: Function, readFile?: (p: string) => string, hostCpus?: number}} [o]  cmd = run of dev/sim/lib/env.mjs
	 *   (the self-test injects a fake, no docker); readFile for cpu.max/cpuset; hostCpus = the cap without a cgroup limit:
	 *   all CPUs of the host, never the generator's affinity (W3V-01: availableParallelism() under taskset 4-7 = 4)
	 */
	constructor(names, { cmd = run, readFile = (p) => fs.readFileSync(p, 'utf8'), hostCpus = os.cpus().length } = {}) {
		this.names = names
		this.cmd = cmd
		this.readFile = readFile
		this.hostCpus = hostCpus
		this.dirs = {}
		this.series = {}
		this.mem = {}
		this.gaps = {}
		// G5: the time-weighted sums of the valid intervals, the caps, the intervals above them, the dropped readings
		this.usec = {}
		this.ms = {}
		this.caps = {}
		this.overCap = {}
		this.dropped = 0
	}

	async init() {
		this.dropped = 0
		for (const [k, name] of Object.entries(this.names)) {
			this.series[k] = []
			this.mem[k] = []
			this.gaps[k] = 0
			this.usec[k] = 0
			this.ms[k] = 0
			this.overCap[k] = []
			if (!name) { this.dirs[k] = null; this.caps[k] = null; continue }
			const id = (await this.cmd('docker', ['inspect', '-f', '{{.Id}}', name])).out.trim()
			this.dirs[k] = M.cgroupDirs(id).find((d) => fs.existsSync(`${d}/cpu.stat`)) || null
			this.caps[k] = cgroupCap(this.dirs[k], this.readFile, this.hostCpus)
		}
		this.prev = this.read()
	}

	read() {
		const out = { t: performance.now() }
		for (const [k, d] of Object.entries(this.dirs)) {
			out[k] = null
			if (!d) continue
			try {
				out[k] = M.parseCpuStat(fs.readFileSync(`${d}/cpu.stat`, 'utf8'))
				out[k + 'Mem'] = M.parseMemoryCurrent(fs.readFileSync(`${d}/memory.current`, 'utf8'))
			} catch { out[k] = null }
		}
		return out
	}

	sample() {
		const cur = this.read()
		const dtMs = cur.t - this.prev.t
		// G5: a reading right after the previous one (the first sample after init) is no interval – dropped, prev stays
		if (!(dtMs >= MIN_INTERVAL_MS)) { this.dropped++; return }
		for (const k of Object.keys(this.dirs)) {
			// a counter that went down (container restart, e.g. SF's Redis restart) is a gap, never negative cores (W3E-10)
			if (M.counterReset(this.prev[k], cur[k])) this.gaps[k] = (this.gaps[k] || 0) + 1
			const c = M.coresBetween(this.prev[k], cur[k], dtMs)
			if (c !== null) {
				this.series[k].push(c)
				this.usec[k] = (this.usec[k] ?? 0) + (cur[k] - this.prev[k])
				this.ms[k] = (this.ms[k] ?? 0) + dtMs
				const cap = this.caps[k] ?? null
				if (cap !== null && c > cap) (this.overCap[k] ||= []).push({ cores: c, dtMs: Math.round(dtMs) })
			}
			if (cur[k + 'Mem'] !== undefined && cur[k + 'Mem'] !== null) this.mem[k].push(cur[k + 'Mem'])
		}
		this.prev = cur
	}

	summary() {
		const out = { source: `cgroup v2 cpu.stat usage_usec, sampled every 1 s; mean time-weighted, readings < ${MIN_INTERVAL_MS} ms after the previous one dropped`, droppedReadings: this.dropped, containers: {} }
		for (const k of Object.keys(this.dirs)) {
			const s = this.series[k].slice().sort((a, b) => a - b)
			const over = this.overCap[k] || []
			out.containers[k] = {
				name: this.names[k], cgroup: this.dirs[k], samples: s.length, gaps: this.gaps[k] || 0,
				// G5: Δusage / Δtime over the valid intervals (time-weighted), not the mean of the interval values
				coresMean: this.ms[k] > 0 ? Math.round(((this.usec[k] ?? 0) / (this.ms[k] * 1000)) * 1000) / 1000 : null,
				coresP95: M.pct(s, 95), coresMax: s.length ? s[s.length - 1] : null,
				cap: this.caps[k] ?? null,
				overCap: { n: over.length, max: over.length ? Math.max(...over.map((x) => x.cores)) : null, samples: over.slice(0, 5) },
				memMBMax: this.mem[k].length ? Math.max(...this.mem[k]) : null,
			}
		}
		return out
	}
}

/** GET of a mod_status URL (?auto) without keep-alive; null when it does not answer 200. */
export function apacheStatus(url) {
	return new Promise((resolve) => {
		if (!url) { resolve(null); return }
		const u = new URL(url)
		const req = http.request({ host: u.hostname, port: Number(u.port || 80), path: u.pathname + u.search, method: 'GET', agent: false, timeout: 2000 }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve(res.statusCode === 200 ? M.parseApacheStatus(Buffer.concat(chunks).toString('utf8')) : null))
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', () => resolve(null))
		req.end()
	})
}

/** All collectors of one run, behind the interface the generator expects (deps.metrics). */
export class Collectors {
	/**
	 * @param {object} env    env.json of the namespace (loadEnv)
	 * @param {import('../../sim/lib/env.mjs').Stack} stack
	 */
	/**
	 * @param {{cmd?: Function, status?: Function, budgetEveryMs?: number, budgetMinGapMs?: number}} [o]  budgetEveryMs: the clock
	 *   of the write-budget reads (§8.7 R19 "alle 5 s"; the self-test shortens it); budgetMinGapMs: the least pause between
	 *   two reads when one ran long (p2e: never back to back)
	 */
	constructor(env, stack, { cmd = run, status = apacheStatus, budgetEveryMs = 5000, budgetMinGapMs = 1000 } = {}) {
		this.env = env
		this.stack = stack
		this.cmd = cmd
		this.status = status
		this.budgetEveryMs = budgetEveryMs
		this.budgetMinGapMs = budgetMinGapMs
		this.budgetLoop = null
		this.reset()
		this.cpu = new CpuSampler({ nc: env.containers.nc, db: env.containers.db, redis: env.containers.redis }, { cmd })
	}

	/**
	 * Forgets everything of the previous window. One instance serves every
	 * window of a process – the S5 steps run one after another on it – so
	 * before() starts each window fresh: Apache, PG backends, blob, budget,
	 * the statements and the log are per step, never cumulative (W3E-04).
	 */
	reset() {
		this.apache = []
		this.backends = []
		this.blob = []
		this.budget = null
		this.budgetTimes = []
		this.budgetReadMs = []
		this.budgetCutoff = null
		this.budgetDropped = 0
		this.seed = null
		this.ticks = 0
		this.pg0 = null
		this.pg1 = null
		this.pgTop = null
		this.pgLock = null
		this.redis0 = null
		this.redis1 = null
		this.ncLog = null
		this.logLine0 = 0
	}

	async psqlText(sql) {
		try { return (await this.stack.psql(sql)).join('\n') } catch { return '' }
	}

	/** Static facts of the run: versions are in env.json; here the enabled apps. */
	async apps() {
		try { return M.parseAppList(await this.stack.occ('app:list', '--output=json')) } catch { return null }
	}

	/**
	 * @param {{seed?: {pid: string, win: number}|null}} [o]  the seeding owner's pid and the last
	 *   10-s budget window of the seeding (generator Run.seedBudget): those counters are the
	 *   seeding, not the workload (W3E-05), and go to budget.seed instead of maxPerPid
	 */
	async before({ seed = null } = {}) {
		this.reset()
		this.seed = seed && typeof seed.pid === 'string' && Number.isFinite(seed.win) ? { pid: seed.pid, win: seed.win } : null
		await this.psqlText('SELECT pg_stat_statements_reset()')
		this.pg0 = M.parsePgDatabase(await this.psqlText(PG_DB_SQL))
		this.redis0 = M.parseRedisInfo(await this.stack.redis('INFO', 'all').catch(() => ''))
		const wc = await this.cmd('docker', ['exec', this.env.containers.nc, 'sh', '-c', `wc -l < ${NC_LOG} 2>/dev/null || echo 0`])
		this.logLine0 = Number(wc.out.trim()) || 0
		await this.cpu.init()
	}

	/** Once a second during the window: CPU, Apache, PG backends; every 5th call the presence blob. */
	async sample(board, epoch) {
		this.cpu.sample()
		const st = await this.status(this.env.load?.statusUrl)
		if (st) this.apache.push(st)
		const n = Number((await this.psqlText(PG_BACKENDS_SQL)).trim())
		if (Number.isFinite(n)) this.backends.push(n)
		this.ticks = (this.ticks || 0) + 1
		if (this.ticks % 5 === 1 && board && epoch) {
			const [key] = await this.stack.redisScan(rkeyIn(epoch, `p:${board}`)).catch(() => [])
			if (key) {
				const b = M.parseStrlen(await this.stack.redis('STRLEN', key).catch(() => ''))
				if (b !== null) this.blob.push(b)
			}
			// without the own clock (a caller that never called startBudget) the budget rides along as before
			if (!this.budgetLoop) await this.budgetSample(board, epoch)
		}
	}

	/**
	 * G6 (p2d, W3B-07): the write-budget counters on their own clock – every budgetEveryMs (5 s) from
	 * the window start, whatever the 1-s sample costs; a late read is not made up in a burst.
	 * p2e: one read = SCAN + one MGET per kind; when a read ran long, the next one still waits at least
	 * budgetMinGapMs (never back to back); a read that ends after the cut-off (endBudget = window end)
	 * is dropped and counted. epochOf: the epoch now (a function – SF rotates it). Stopped by endBudget/after().
	 */
	startBudget(board, epochOf) {
		if (this.budgetLoop) this.budgetLoop.stop()
		this.budgetCutoff = null
		let stopped = false
		let wake = () => {}
		let timer = null
		const done = (async () => {
			let next = Date.now()
			while (!stopped) {
				const epoch = typeof epochOf === 'function' ? epochOf() : epochOf
				if (board && epoch) {
					const t0 = Date.now()
					const entries = await this.budgetRead(board, epoch).catch(() => null)
					const t1 = Date.now()
					if (entries && (this.budgetCutoff === null || t1 <= this.budgetCutoff)) {
						this.budgetTimes.push(t0)
						this.budgetReadMs.push(t1 - t0)
						this.budgetMerge(entries, board)
					} else if (entries) this.budgetDropped++
				}
				if (stopped) break
				next += this.budgetEveryMs
				const now = Date.now()
				// p2e: never spin – a long read pushes the next one out, with at least budgetMinGapMs in between
				if (next < now + this.budgetMinGapMs) next = now + this.budgetMinGapMs
				await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, next - now) })
			}
		})()
		this.budgetLoop = { stop: () => { stopped = true; clearTimeout(timer); wake() }, done }
	}

	/** p2e: the window ended at `at` (generator endMeasure): no read after it counts; the clock stops. */
	endBudget(at = Date.now()) {
		this.budgetCutoff = at
		if (this.budgetLoop) this.budgetLoop.stop()
	}

	async stopBudget() {
		const l = this.budgetLoop
		if (!l) return
		l.stop()
		await l.done
		this.budgetLoop = null
	}

	/** G6: how the budget was read – count, gaps between the reads (the 5-s clock made visible), read time, dropped reads. */
	budgetSampling() {
		const t = this.budgetTimes
		const gaps = t.slice(1).map((x, i) => x - t[i])
		return {
			everyMs: this.budgetEveryMs, minGapMs: this.budgetMinGapMs, reads: t.length,
			meanGapMs: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, maxGapMs: gaps.length ? Math.max(...gaps) : null,
			minGapSeenMs: gaps.length ? Math.min(...gaps) : null, readMsMax: this.budgetReadMs.length ? Math.max(...this.budgetReadMs) : null,
			droppedAfterEnd: this.budgetDropped, clock: this.budgetLoop || t.length ? 'eigener Takt' : 'mit dem Sekundentakt',
		}
	}

	/**
	 * One read (T4-09), read-only: SCAN of the board's w:/wo: keys, then ONE MGET per kind (p2e, review
	 * finding 1: no docker exec per key); a nil (expired between SCAN and MGET) is an empty line, which
	 * parseBudgetKeys counts as "nicht vorhanden". Returns [[key, value], …].
	 */
	async budgetRead(board, epoch) {
		const entries = []
		for (const kind of ['w', 'wo']) {
			const keys = await this.stack.redisScan(rkeyIn(epoch, `${kind}:${board}:*`)).catch(() => [])
			for (let i = 0; i < keys.length; i += 500) {
				const part = keys.slice(i, i + 500)
				const out = await this.stack.redis('MGET', ...part).catch(() => null)
				const vals = out === null ? [] : String(out).split('\n')
				part.forEach((k, j) => entries.push([k, vals[j] ?? '']))
			}
		}
		return entries
	}

	budgetMerge(entries, board) {
		this.budget = M.mergeBudget(this.budget ?? null, M.parseBudgetKeys(entries, board, { seed: this.seed }))
	}

	/** Read + merge in one (the fallback without the own clock, every 5th 1-s sample). */
	async budgetSample(board, epoch) {
		this.budgetMerge(await this.budgetRead(board, epoch), board)
	}

	async after() {
		// p2e: a caller without endBudget cuts here – nothing read after this moment counts
		if (this.budgetLoop && this.budgetCutoff === null) this.budgetCutoff = Date.now()
		await this.stopBudget()
		this.pg1 = M.parsePgDatabase(await this.psqlText(PG_DB_SQL))
		this.pgTop = M.parsePgStatements(await this.psqlText(PG_TOP_SQL))
		this.pgLock = M.parsePgStatements(await this.psqlText(PG_LOCK_SQL))
		this.redis1 = M.parseRedisInfo(await this.stack.redis('INFO', 'all').catch(() => ''))
		const r = await this.cmd('docker', ['exec', this.env.containers.nc, 'sh', '-c', `tail -n +${this.logLine0 + 1} ${NC_LOG} 2>/dev/null | head -n 20000`], { timeoutMs: 30000 })
		this.ncLog = M.parseNcLog(r.out)
	}

	/** Rule 7 of S4 (R19, T4-19): after the run no r:/p:/vt:/w:/wo: key of the board without a TTL (TTL -1). */
	async hygiene(board) {
		const out = { keys: 0, noTtl: 0, samples: [], patterns: M.hygienePatterns(board) }
		for (const pattern of out.patterns) {
			for (const key of await this.stack.redisScan(pattern).catch(() => [])) {
				out.keys++
				const ttl = Number(await this.stack.redis('TTL', key).catch(() => 'NaN'))
				if (ttl === -1) { out.noTtl++; if (out.samples.length < 5) out.samples.push(key) }
			}
		}
		return out
	}

	summary(secs, requests) {
		const apStat = (k) => M.stats(this.apache.map((a) => a[k]))
		return {
			cpu: this.cpu.summary(),
			apache: this.apache.length ? { busy: apStat('busy'), idle: apStat('idle'), sending: apStat('W'), keepalive: apStat('K'), reading: apStat('R'), samples: this.apache.length } : null,
			postgres: { ...(M.pgDelta(this.pg0, this.pg1, secs, requests) || {}), numbackends: M.stats(this.backends), topStatements: this.pgTop },
			redis: M.redisDelta(this.redis0, this.redis1, secs, requests),
			nextcloudLog: this.ncLog || null,
			presenceBlobBytes: M.stats(this.blob),
			budget: this.budget ? { ...this.budget, sampling: this.budgetSampling() } : null,
			boardLockRows: this.pgLock ?? null,
		}
	}
}

/** Host facts of a report: uptime(1) and the 1-min load. */
export async function hostNow(loadavgFile = '/proc/loadavg') {
	const up = await run('uptime', [])
	let load = null
	try { load = M.parseLoadavg(fs.readFileSync(loadavgFile, 'utf8')) } catch { /* no /proc */ }
	return { uptime: up.ok ? up.out.trim() : null, loadavg: load }
}
