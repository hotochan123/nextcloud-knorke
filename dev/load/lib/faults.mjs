/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Fault injection of SF (SPEC-M1 §8.7 "Fehlereinspielung"), phase-0
 * scaffold: the fault list and its order are frozen in plan.mjs FAULTS; the
 * actions below run through the Stack side channel (occ, redis-cli) and
 * `docker restart|pause|unpause` – and every docker action only on a
 * container of this namespace (assertOwn: knorke-dev-<ns>-*), never try,
 * never prod. Phase 1 (WP-D4) measures what SF's rules need (measureSF):
 * the recovery after each fault (the slowest live device's first successful
 * /sync that was SENT after the fault ended), 5xx outside ±5 s around the
 * fault windows, and 401 after the Redis restart – phase 2 (W3E-02, reading
 * (a) of "0 × 401 nach dem Redis-Neustart"): a 401 counts when its request
 * was SENT after the end of the restart window; 401s on requests sent during
 * the restart are reported apart (time, count, short body), never counted.
 *
 * SF switches knorke_dev on for its window only (§8.7) and off again in
 * every case (finally), together with knorke_dev_skip_bump and a paused DB.
 *
 * Fix round p2d (W3 r2w3): rule 3 counts per device and session the FIRST
 * 401 (the one that ends the session like in the real client, G2/W3B-05;
 * p2e: only 401 – a logout after a second 412 is reported apart – and per
 * device and series: a session's end and the 401s of its re-login attempts
 * count once, the first one sent after the restart window);
 * rule 2 counts a device without a successful sync after the fault's end as
 * not recovered, and devices that had to log in again apart (G3/W3B-03).
 */
import { run as runCmd, rkey } from '../../sim/lib/env.mjs'
import { FAULTS, GATE_SF } from './plan.mjs'

/** Refuses every container name outside knorke-dev-<ns>-*. */
export function assertOwn(name, ns) {
	if (!/^[a-z]{1,8}$/.test(String(ns))) throw new Error(`Namensraum '${ns}' ist ungültig`)
	if (typeof name !== 'string' || !name.startsWith(`knorke-dev-${ns}-`)) throw new Error(`interner Schutz: '${name}' gehört nicht zum Namensraum ${ns}`)
	return name
}

export class FaultInjector {
	/**
	 * @param {object} env    env.json (loadEnv: names belong to env.ns)
	 * @param {object} stack  Stack of dev/sim/lib/env.mjs (occ, redis, redisDel, redisScan, rotateEpoch)
	 * @param {{docker?: (args: string[]) => Promise<{ok: boolean, out: string, err: string}>, sleep?: (ms: number) => Promise<void>}} [o]
	 */
	constructor(env, stack, { docker = (args) => runCmd('docker', args), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
		this.ns = env.ns
		this.names = {
			nc: assertOwn(env.containers.nc, env.ns),
			redis: assertOwn(env.containers.redis, env.ns),
			db: env.containers.db === null ? null : assertOwn(env.containers.db, env.ns),
		}
		this.stack = stack
		this.dockerRun = docker
		this.sleep = sleep
		this.played = []
		this.paused = false
	}

	async docker(verb, key) {
		const name = this.names[key]
		if (!name) return { ok: false, out: '', err: `kein Container ${key}` }
		assertOwn(name, this.ns)
		return this.dockerRun([verb, name])
	}

	/** One fault by id; returns a note for the report. */
	async inject(id, board) {
		const s = this.stack
		switch (id) {
			case 'skip-bump': return s.occ('config:system:set', 'knorke_dev_skip_bump', '--value=0.2', '--type=float')
			case 'rev-del': return (await s.redisDel(rkey(`r:${board}`))).length + ' Schlüssel'
			case 'rev-lower': {
				const [key] = await s.redisScan(rkey(`r:${board}`))
				if (!key) return 'r: fehlt'
				const v = Number(await s.redis('GET', key))
				await s.redis('SET', key, String(Math.max(0, v - 5)), 'KEEPTTL')
				return `${v} → ${Math.max(0, v - 5)}`
			}
			case 'presence-del': return (await s.redisDel(rkey(`p:${board}`))).length + ' Schlüssel'
			case 'gens-del': return (await s.redisDel(rkey(`a:${board}`), rkey(`g:${board}:*`))).length + ' Schlüssel'
			case 'all-del': return (await s.redisDel('*/knorke/*')).length + ' Schlüssel'
			case 'epoch-rotate': { const r = await s.rotateEpoch(); return `${r.before} → ${r.after}` }
			case 'redis-restart': return (await this.docker('restart', 'redis')).ok ? 'neu gestartet' : 'Neustart fehlgeschlagen'
			case 'db-pause': {
				if (!this.names.db) return 'SQLite: kein DB-Container'
				this.paused = (await this.docker('pause', 'db')).ok
				return this.paused ? 'pausiert' : 'Pause fehlgeschlagen'
			}
			default: throw new Error(`Fehler '${id}' ist unbekannt`)
		}
	}

	/** Ends a fault that holds (skip bump, paused DB). */
	async release(id) {
		if (id === 'skip-bump') await this.stack.occ('config:system:delete', 'knorke_dev_skip_bump').catch(() => {})
		if (id === 'db-pause' && this.paused) { await this.docker('unpause', 'db'); this.paused = false }
	}

	/** Plays FAULTS evenly over the run's window (generator deps.faults). */
	async play(run) {
		const gap = run.timeline.windowMs / (FAULTS.length + 1)
		try {
			await this.stack.occ('config:system:set', 'knorke_dev', '--value=true', '--type=boolean')
			for (let i = 0; i < FAULTS.length; i++) {
				const f = FAULTS[i]
				await run.until(gap * (i + 1))
				if (!run.running || run.stop.requested) break
				const at = run.windowMs
				let note
				try { note = String(await this.inject(f.id, run.board.id)) } catch (e) { note = `Fehler: ${String(e?.message || e).slice(0, 200)}` }
				if (f.holdS) {
					await this.sleep(f.holdS * 1000 * (f.id === 'db-pause' ? 1 : run.timeline.k))
					await this.release(f.id)
				}
				this.played.push({ id: f.id, title: f.title, atMs: at, endMs: run.windowMs, note, recoveryS: null })
			}
		} finally {
			for (const f of FAULTS) if (f.holdS) await this.release(f.id).catch(() => {})
			await this.stack.occ('config:system:set', 'knorke_dev', '--value=false', '--type=boolean').catch(() => {})
		}
	}

	/** The report of the played faults; with the run, measured (measureSF). */
	report(run = null) {
		if (!run || !Array.isArray(run.samples) || !Number.isFinite(run.windowStart)) {
			return { played: this.played, recoveryLimitS: GATE_SF.recoveryS, note: 'ohne Lauf keine Messung der Erholung' }
		}
		const untilMs = Number.isFinite(run.windowEnd) ? run.windowEnd - run.t0 : null
		return { ...measureSF(this.played, run.samples, run.windowStart - run.t0, run.okLog, run.windowStart, run.unauthorized ?? null, { logouts: run.logouts ?? null, untilMs }), recoveryLimitS: GATE_SF.recoveryS }
	}
}

/**
 * SF measurement (SPEC-M1 §8.7 "Weitere": Erholung ≤ 35 s je Fehler, 5xx nur
 * ±5 s um Fehlerfenster, 0 × 401 nach dem Redis-Neustart), pure.
 *
 * Time bases (W3E-03): a sample's tMs is Date.now() − t0 at the ANSWER
 * (generator.mjs record), its ms the request's duration, so it was SENT at
 * tMs − ms; fault windows count from the window start; offsetMs = window
 * start − t0 turns one into the other.
 *
 * Recovery (G3 p2d, W3B-03): every device with a successful sync in the log
 * must have one SENT at or after the fault's end – the first one is its
 * recovery; a device without one did not recover (notRecovered, rule 2 red),
 * it is never skipped. A device whose session a 401 ended between its last
 * successful sync before the fault's end and that first successful sync
 * recovered only through a new login:
 * its time (to the first successful sync after the re-login) is reported
 * apart (relogged) and stays out of recoveryS.
 *
 * 401 (reading (a), W3E-02/AUD-03; G2 p2d, W3B-05): per device and session
 * the first 401 counts – the one that ends the session (o.logouts, the
 * generator's logged_out list); it counts for rule 3 when its request was
 * sent AFTER the end of the Redis restart window (endMs, when `docker
 * restart` returned); a 401 that names no device (setup, moderation calls)
 * counts on its own; one sent during the restart [atMs, endMs] is reported
 * apart (count, times, device, short body) and does not count; one sent
 * before the restart is outside the rule and reported as well. Without the
 * logged_out list (reports before p2d) every 401 row counts as before.
 * @param {Array<{id: string, atMs: number, endMs: number}>} played  fault windows, ms after the window start
 * @param {Array<Array>} samples  Run.samples rows [tMs since t0 (answer), key, who, kind, status, ms, bytes, phase]
 * @param {number} offsetMs  window start − t0
 * @param {Map<string, number[]>|null} okLog  per device the absolute SEND times of its successful /sync answers
 * @param {number} windowStart  absolute ms of the window start
 * @param {Array<{tMs: number, ms: number, key: string, who: string, device?: string, body?: string}>|null} [unauthorized]
 *   the run's 401 events (Run.unauthorized, with the body); without them the 401 rows of samples
 * @param {{logouts?: Array<{tMs: number, ms: number, key: string, who: string, device: string, sess: number, body?: string}>|null, untilMs?: number|null}} [o]
 *   logouts: Run.logouts (G2); untilMs: the window end since t0 – 5xx are looked for up to it
 */
export function measureSF(played, samples, offsetMs, okLog, windowStart, unauthorized = null, { logouts = null, untilMs = null } = {}) {
	const lo = Array.isArray(logouts) ? logouts : null
	const t0 = windowStart - offsetMs
	const logoutsBy = new Map()
	for (const e of lo || []) {
		if (!e.device) continue
		const list = logoutsBy.get(e.device) || []
		list.push(t0 + e.tMs - (e.ms ?? 0))
		logoutsBy.set(e.device, list)
	}
	const out = (played || []).map((p) => {
		const endAbs = windowStart + (p.endMs ?? p.atMs)
		let worst = null
		let devices = 0
		const notRecovered = []
		const relogged = []
		for (const [device, times] of (okLog instanceof Map ? okLog.entries() : [])) {
			if (!times.length) continue
			const next = times.find((t) => t >= endAbs)
			// logged out between its last successful sync before the fault's end and its recovery: recovered only through a new login
			let prev = -Infinity
			for (const t of times) if (t < endAbs && t > prev) prev = t
			const relog = (logoutsBy.get(device) || []).some((t) => t > prev && t <= (next ?? Infinity))
			if (next === undefined) { notRecovered.push(relog ? `${device} (abgemeldet)` : device); continue }
			if (relog) { relogged.push({ device, recoveryS: Math.round((next - endAbs) / 100) / 10 }); continue }
			devices++
			worst = Math.max(worst ?? 0, next - endAbs)
		}
		return {
			...p, recoveryS: worst === null ? null : Math.round(worst / 100) / 10, devices,
			notRecovered: notRecovered.length, notRecoveredDevices: notRecovered.slice(0, 10),
			relogged: relogged.length, reloggedDevices: relogged.slice(0, 20),
		}
	})
	const windows = (played || []).map((p) => [p.atMs - GATE_SF.fiveXxWindowS * 1000, (p.endMs ?? p.atMs) + GATE_SF.fiveXxWindowS * 1000])
	let fiveXxOutside = 0
	for (const s of samples || []) {
		if (!(typeof s[4] === 'number' && s[4] >= 500)) continue
		if (typeof untilMs === 'number' && s[0] > untilMs) continue
		const w = s[0] - offsetMs
		if (!windows.some(([a, b]) => w >= a && w <= b)) fiveXxOutside++
	}
	const redis = (played || []).find((p) => p.id === 'redis-restart')
	// with the logged_out list: the first 401 of every device session, plus each 401 that names no device (setup, moderation calls)
	// p2e (review finding 3): rule 3 is about 401 – a logout after a second 412 (CSRF) is reported apart, never counted
	const is401 = (e) => e.status === undefined || e.status === null || e.status === 401
	const events = lo
		? [...lo.filter(is401), ...(Array.isArray(unauthorized) ? unauthorized.filter((e) => !e.device) : [])]
		: (Array.isArray(unauthorized)
			? unauthorized
			: (samples || []).filter((s) => s[4] === 401).map((s) => ({ tMs: s[0], ms: s[5], key: s[1], who: s[2], body: null })))
	const shape = (e) => {
		const sentMs = Math.round((e.tMs - (e.ms ?? 0) - offsetMs) * 10) / 10
		const recvMs = Math.round((e.tMs - offsetMs) * 10) / 10
		const when = !redis ? null : sentMs > (redis.endMs ?? redis.atMs) ? 'nach' : sentMs >= redis.atMs ? 'während' : 'vor'
		return { sentMs, recvMs, key: e.key ?? null, who: e.who ?? null, device: e.device ?? null, sess: e.sess ?? null, status: e.status ?? 401, relogin: e.relogin === true, when, body: e.body ?? null }
	}
	const list = events.map(shape)
	// p2e (finding 4): per device and series (a session's end plus the 401s of its re-login attempts) ONE event counts –
	// the first one sent after the restart window, else the first one; a 401 without a device counts on its own
	const groups = new Map()
	events.forEach((e, i) => {
		const k = lo && e.device ? `${e.device}:${e.series ?? e.sess ?? 1}` : `#${i}`
		const g = groups.get(k) || []
		g.push(list[i])
		groups.set(k, g)
	})
	for (const g of groups.values()) (g.find((x) => x.when === 'nach') ?? g[0]).counted = true
	const counted = list.filter((x) => x.counted)
	const n = (w) => (redis ? counted.filter((x) => x.when === w).length : null)
	const lo412 = lo ? lo.filter((e) => !is401(e)).map(shape) : []
	return {
		played: out, fiveXxOutside,
		unauthorizedAfterRedis: n('nach'),
		unauthorizedDuringRedis: n('während'),
		unauthorizedBeforeRedis: n('vor'),
		redisWindowMs: redis ? [redis.atMs, redis.endMs ?? redis.atMs] : null,
		countedBy: lo ? 'je Gerät und Sitzung das erste 401 (Sitzungsende, logged_out; mit den 401 ihrer Neuanmeldeversuche einmal); 401 ohne Gerät (Moderation, Einrichtung) einzeln; Abmeldungen nach 412 getrennt' : '401-Antworten (ohne Gerätezuordnung, Bericht vor p2d)',
		unauthorizedTotal: Array.isArray(unauthorized) ? unauthorized.length : (samples || []).filter((s) => s[4] === 401).length,
		unauthorized: list.slice(0, 20),
		// "Ausgeloggte Geräte (Zeit, Gerät, Rolle)": every session a 401 ended (and the 401s of re-login attempts), counted or not
		loggedOut: lo ? list.filter((x) => x.device).slice(0, 50).map((x) => ({ sentMs: x.sentMs, device: x.device, role: x.who, sess: x.sess, status: x.status, relogin: x.relogin, counted: x.counted === true, when: x.when })) : null,
		// p2e (finding 3): logouts after a second 412 – reported apart, never in rule 3
		loggedOut412: lo ? lo412.length : null,
		loggedOut412List: lo ? lo412.slice(0, 20).map((x) => ({ sentMs: x.sentMs, device: x.device, role: x.who, sess: x.sess, status: x.status, when: x.when })) : null,
	}
}
