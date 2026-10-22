/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The load generator of SPEC-M1 §8.7: a port of the spike's
 * knorke-spike/poll/load/load.mjs onto the protocol-2 harness (dev/sim/lib).
 * One call of runScenario() = one scenario run against ONE board:
 *
 *   setup     the owner (alice) creates the board, seeds it (3000 notes, 500
 *             shapes, 800 connectors, 20 frames by default; through /sync in
 *             batches of 200, honouring `busy`), shares it with the group
 *             `workshop` (role edit), turns on the edit and the vote link,
 *             starts the timer and "Alle zu mir" (S4 family)
 *   warm-up   the devices join spread over the warm-up (accounts: login +
 *             snapshot; guests and tablets: join); the window opens once all
 *             joined (at most 60 s later)
 *   window    the workload of plan.mjs; S4: voting session t = 20–80 s
 *             (scaled with --secs); the collectors sample once a second
 *   quiet     stop acting, drain every queue, then K1 (every mirror equals the
 *             snapshot), K2 (the change log replays to the snapshot), K3
 *             (every `ok` op is in effect at its rev), vote result = the sum
 *             of the generator's confirmed votes
 *
 * Stage 4, phase 1 (SPEC-M1 §8.7 Revision 19): one pid per tab – a run whose
 * account editors would share an account (tabsPerAccount > 1, KD_USERS too
 * small) is a harness error (exit 1, T4-09); the report carries
 * budget.maxPerPid {syncs, ops} from the w:/wo: counters (calibration
 * source), the board-lock report (T4-16), SC's page requests with their
 * source (--page-requests, else 85/34 "nicht gemessen", T4-11), and an abort
 * by the load guard is judged as §8.7 "Weitere" says (S5 after a complete
 * step 45: only S5 ends; any other abort: the run is invalid, T4-10).
 *
 * Fix round p2d (W3 r2w3, W3B-02..07): a device's first 401 ends its
 * session like in the real client and it logs in again (actors.mjs; the
 * report lists every logged-out device with time and role, G2); SF's
 * recovery sees the devices after the window too and names devices that
 * never recover (faults.mjs, G3); K1–K3 read the snapshot through a FRESH
 * login, never through a possibly dead client (G4); every run names the
 * pooled sync p95 beside the class maximum that S5 judges (G1); the
 * write-budget counters are read on their own 5-s clock (collect.mjs, G6).
 *
 * Everything outside HTTP is injected (deps): metrics (collect.mjs
 * Collectors), changes (the change log, Stack.changesJson), epoch, faults
 * (faults.mjs), host facts. Without them the report says notRun – this is
 * how dev/selftest/loadGenerator.test.mjs runs the generator against a fake
 * protocol-2 server without a stack.
 */
import { Client, brief } from '../../sim/lib/http.mjs'
import { canon, diffKeys, getPath, isObj, normItem, replayChanges, replayKeys, setPath, snapshotKeys, NUM_FIELDS } from '../../sim/lib/mirror.mjs'
import { sleep } from '../../sim/lib/gen.mjs'
import { Actor } from './actors.mjs'
import { EDGE_GLOBAL, edgeVerdict } from './edge.mjs'
import { stats, boardLockReport } from './metrics.mjs'
import { BOARD, BUDGET_WINDOW_MS, GATE_S5, SCENARIOS, WORKSHOP, actorCounts, coldStartArrivals, rngFor, seedZ, timeline, PAGE_REQUESTS_E12, PAGE_REQUESTS_M0 } from './plan.mjs'
import { evaluate, completeSteps, kneeErrors } from './gates.mjs'

const OWNER = 'alice'
/** A timeout that does not keep the process alive (the 20-s grace below must not hold a finished run). */
const graceful = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref() })
const SAMPLE_CAP = 400000
const SYNC_KEYS = ['sync-empty', 'sync-items', 'sync-ops', 'sync-vote']

/** G1 (p2d): the sync class with the highest p95 of the window samples m – the value S5 judges, with its class. */
export function classMax(m) {
	let best = null
	for (const k of SYNC_KEYS) {
		const p = stats(m.filter((s) => s[1] === k).map((s) => s[5])).p95
		if (typeof p === 'number' && (!best || p > best.p95)) best = { p95: p, class: k }
	}
	return best ?? { p95: null, class: null }
}

export class Run {
	constructor({ env, scenarioId, sc, seed, secs, warmupS, counts, boardSize, deps = {}, stop = { requested: false, reason: null }, log = () => {} }) {
		this.env = env
		this.scenarioId = scenarioId
		this.sc = sc
		this.seed = seed
		this.secs = secs
		this.warmupS = warmupS
		this.counts = counts
		this.boardSize = boardSize
		this.deps = deps
		this.stop = stop
		this.log = log
		this.workload = sc.workload
		this.timeline = timeline(sc, secs)
		this.t0 = Date.now()
		this.phase = 'setup'
		this.running = true
		this.acting = true
		this.summoning = false
		this.samples = []
		this.acks = []
		this.busyEvents = []
		this.protocolErrors = []
		this.actions = {}
		this.hotOps = 0
		this.resyncs = 0
		this.voters = null
		this.cursorSent = new Map()
		this.viewSent = new Map()
		this.cursorLag = []
		this.followLag = []
		this.bytesPlain = 0
		this.actors = []
		this.notes = []
		this.wakers = new Set()
		this.events = []
		// SF (T4-10 phase 1): per device the send times of its successful /sync answers in the window
		this.okLog = new Map()
		// SF rule 3 (stage 4 phase 2, W3E-02, reading (a)): every 401 with its times and a short body
		this.unauthorized = []
		// G2 (p2d): sessions ended by a 401 (per device and session the first 401), re-logins, failed re-login attempts
		this.logouts = []
		this.relogins = []
		this.reloginFailures = []
		// the seeding (W3E-05): requests, ops and busy answers of the owner before the run; {pid, win} for the collectors
		this.seedStats = null
		this.seedBudget = null
	}

	// ── run context used by the actors ───────────────────────────────────────

	/** Sleeps, but wakes at once when the run stops. */
	nap(ms) {
		if (!this.running) return Promise.resolve()
		return new Promise((resolve) => {
			const done = () => { clearTimeout(t); this.wakers.delete(done); resolve() }
			const t = setTimeout(done, Math.max(0, ms))
			this.wakers.add(done)
		})
	}

	halt() {
		this.running = false
		for (const w of [...this.wakers]) w()
	}

	/**
	 * One answer. actor (optional): the device, so a 401 names device and session (G2 p2d).
	 */
	record(key, who, r, kind = '', actor = null) {
		if (this.samples.length >= SAMPLE_CAP) return
		const tMs = Date.now() - this.t0
		const ms = Math.round((r.ms ?? 0) * 10) / 10
		this.samples.push([tMs, key, who, kind, r.status, ms, r.bytes ?? 0, this.phase])
		// same time base as the samples (ms since t0, at the answer; sent = tMs − ms); body in short form
		if (r.status === 401 && this.unauthorized.length < 1000) this.unauthorized.push({ tMs, ms, key, who, device: actor?.label ?? null, sess: actor?.sess ?? null, phase: this.phase, body: String(r.text ?? '').slice(0, 120) })
		if (this.phase === 'measure' && typeof r.text === 'string') this.bytesPlain += Buffer.byteLength(r.text)
	}

	/**
	 * G2 (p2d): a device's session ended with this answer (401, or a second 412); same time base as record().
	 * setCookie: the cookie NAMES the answer set or deleted (never a value) – probe P1: did Nextcloud drop the session cookie?
	 */
	loggedOut(actor, { key, r, lost = 0, sess = actor.sess, series = actor.sess, relogin = false }) {
		// p2e (review finding 2): without a fault injection every logout is a protocol error (rule 1 / K red), in any phase
		if (!this.sc?.faults) this.protocolError(actor, `abgemeldet (HTTP ${r.status}) ohne Fehlereinspielung`, { key, phase: this.phase })
		if (this.logouts.length >= 2000) return
		const setCookie = [].concat(r.headers?.['set-cookie'] || []).map((c) => {
			const nv = String(c).split(';')[0]
			const name = nv.slice(0, Math.max(0, nv.indexOf('=')))
			return `${name}=${/max-age=0|expires=thu, 01-jan-1970/i.test(c) || nv.endsWith('=deleted') ? 'gelöscht' : 'gesetzt'}`
		})
		this.logouts.push({ tMs: Date.now() - this.t0, ms: Math.round((r.ms ?? 0) * 10) / 10, key, status: r.status, who: actor.who, device: actor.label, sess, series, relogin, phase: this.phase, lostOps: lost, setCookie, body: String(r.text ?? '').slice(0, 120) })
	}

	/** G2 (p2d): the device logged in again (new session); ms = the re-login's duration. */
	relogged(actor, { ms }) {
		if (this.relogins.length < 2000) this.relogins.push({ tMs: Date.now() - this.t0, device: actor.label, who: actor.who, sess: actor.sess, ms: Math.round(ms), phase: this.phase })
	}

	reloginFailed(actor, error) {
		if (this.reloginFailures.length < 200) this.reloginFailures.push({ tMs: Date.now() - this.t0, device: actor.label, who: actor.who, phase: this.phase, error })
	}

	noteCursor(cid, [x, y]) {
		const k = `${cid}|${x}|${y}`
		if (!this.cursorSent.has(k)) this.cursorSent.set(k, Date.now())
	}

	/** Rule 8 "eigener Cursor beim anderen": observed by another editor (tablets show no cursors and poll every 2 s). */
	seenCursor(cid, x, y, observer) {
		if (observer.kind === 'tablet') return
		const t = this.cursorSent.get(`${cid}|${x}|${y}`)
		if (t !== undefined && this.phase === 'measure' && this.cursorLag.length < 200000) this.cursorLag.push(Date.now() - t)
	}

	noteView(v) { if (!this.viewSent.has(v)) this.viewSent.set(v, Date.now()) }

	seenView(v, actor) {
		const t = this.viewSent.get(v)
		if (t !== undefined && this.phase === 'measure' && actor.kind === 'tablet') this.followLag.push(Date.now() - t)
	}

	acked(actor, ack) {
		this.acks.push({ actor: actor.label, pid: actor.pid, phase: this.phase, ...ack })
	}

	busy(actor, acks) {
		this.busyEvents.push({ actor: actor.label, pid: actor.pid, at: Date.now() - this.t0, retryMs: acks.retryMs ?? null, phase: this.phase })
	}

	protocolError(actor, problem, info = {}) {
		if (this.protocolErrors.length < 200) this.protocolErrors.push({ actor: actor.label, phase: this.phase, problem, ...info })
	}

	countAction(name) { if (this.phase === 'measure') this.actions[name] = (this.actions[name] || 0) + 1 }

	/**
	 * A device got a 200 for a /sync it sent at sentAt (absolute ms); SF measures recovery with it.
	 * From the window start to the end of the run (quiet and check included, G3 p2d): a device that
	 * recovers only after the window is seen, one that never recovers has no entry after the fault.
	 */
	noteOk(actor, sentAt) {
		if (!this.sc?.faults || !Number.isFinite(this.windowStart) || sentAt < this.windowStart) return
		const list = this.okLog.get(actor.label) || []
		if (list.length < 20000) list.push(Math.round(sentAt))
		this.okLog.set(actor.label, list)
	}

	get windowMs() { return Date.now() - this.windowStart }

	// ── setup ────────────────────────────────────────────────────────────────

	async setup() {
		if (this.deps.epoch) this.env.epoch = (await this.deps.epoch()) || undefined
		this.owner = new Client(this.env, 'owner', { kind: 'user' })
		await this.owner.login(OWNER)
		const cr = await this.owner.createBoard(`Last ${this.scenarioId} ${new Date().toISOString().slice(0, 19)} seed ${this.seed}`)
		if (cr.status !== 201 || !cr.data?.board?.id) throw new Error(`Board anlegen: ${brief(cr)}`)
		this.board = { id: cr.data.board.id }
		// the board epoch (`ep` of every /sync) comes with the first snapshot, like in the client
		const sr0 = await this.owner.snapshot(this.board.id)
		this.record('setup', 'owner', sr0)
		if (sr0.status !== 200) throw new Error(`erster Snapshot: ${brief(sr0)}`)
		this.ownerPid = typeof sr0.data?.me?.pid === 'string' ? sr0.data.me.pid : null
		await this.seedBoard()
		if (this.counts.accounts > 0) {
			const group = this.env.load?.group || 'workshop'
			const sr = await this.owner.saveShares(this.board.id, [{ kind: 'group', id: group, role: 'edit' }])
			if (sr.status !== 200) throw new Error(`Freigabe an ${group}: ${brief(sr)}`)
		}
		if (this.counts.guests > 0) {
			const lr = await this.owner.postLink(this.board.id, {}, 'edit')
			if (lr.status !== 200 || !lr.data?.link?.token) throw new Error(`Bearbeitungslink: ${brief(lr)}`)
			this.board.editToken = lr.data.link.token
		}
		if (this.counts.tablets > 0) {
			const vr = await this.owner.postLink(this.board.id, {}, 'vote')
			if (vr.status !== 200 || !vr.data?.link?.token) throw new Error(`Abstimm-Link: ${brief(vr)}`)
			this.board.voteToken = vr.data.link.token
		}
	}

	/** The seed board through /sync (batches of 200, `busy` honoured: the owner's write budget applies). */
	async seedBoard() {
		const r = rngFor(this.seed, 0)
		const { notes, shapes, connectors, frames } = this.boardSize
		const ops = []
		let z = 0
		const frameIds = []
		for (let f = 0; f < frames; f++) {
			const id = r.ulid(Date.now())
			frameIds.push(id)
			ops.push({ o: 'put', id, t: 'frame', p: { x: (f % 5) * 2000, y: Math.floor(f / 5) * 1600, w: 1900, h: 1500, r: 0, z: seedZ(z++), parent: null, data: { title: `Phase ${f + 1}` }, style: { fill: '#ffffff' } } })
		}
		const noteIds = []
		for (let i = 0; i < notes; i++) {
			const id = r.ulid(Date.now())
			noteIds.push(id)
			const f = frames ? i % frames : -1
			const slot = frames ? Math.floor(i / frames) : i
			const x = (f >= 0 ? (f % 5) * 2000 : 0) + 40 + (slot % 8) * 230
			const y = (f >= 0 ? Math.floor(f / 5) * 1600 : 0) + 80 + (Math.floor(slot / 8) % 6) * 230
			ops.push({ o: 'put', id, t: 'sticky', p: { x, y, w: 200, h: 200, r: 0, z: seedZ(z++), parent: f >= 0 ? frameIds[f] : null, data: { text: `Notiz ${i}` }, style: { fill: '#fff59d' } } })
		}
		const shapeIds = []
		for (let i = 0; i < shapes; i++) {
			const id = r.ulid(Date.now())
			shapeIds.push(id)
			ops.push({ o: 'put', id, t: 'shape', p: { x: (i % 25) * 400, y: 7000 + Math.floor(i / 25) * 300, w: 240, h: 140, r: 0, z: seedZ(z++), parent: null, data: { kind: 'roundRect', text: `Form ${i}` }, style: { fill: '#90caf9' } } })
		}
		for (let i = 0; i < connectors && noteIds.length > 1; i++) {
			const a = noteIds[i % noteIds.length]
			const b = noteIds[(i * 7 + 1) % noteIds.length]
			if (a === b) continue
			ops.push({ o: 'put', id: r.ulid(Date.now()), t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, z: seedZ(z++), parent: null, data: { start: { item: a }, end: { item: b } }, style: { endCap: 'arrow' } } })
		}
		const cid = r.clientId('s')
		let seq = 0
		let rev = 0
		// what the seeding cost the owner's write budget (WriteBudget counts every request with ops, busy ones too)
		const seedStats = { syncs: 0, ops: 0, busy: 0, batches: 0 }
		this.seedStats = seedStats
		for (let i = 0; i < ops.length; i += 200) {
			const batch = ops.slice(i, i + 200)
			const s = ++seq
			for (let attempt = 0; ; attempt++) {
				if (!this.running || this.stop.requested) throw new Error('Abbruch während des Säens')
				seedStats.syncs++
				seedStats.ops += batch.length
				const res = await this.owner.sync(this.board.id, { client: cid, since: rev, seq: s, ops: batch, pres: 0 }, { timeoutMs: 60000 })
				this.record('setup', 'owner', res)
				// the server counted this request in the 10-s window of its clock, at the latest of now (same host clock)
				this.seedBudget = this.ownerPid ? { pid: this.ownerPid, win: Math.floor(Date.now() / BUDGET_WINDOW_MS) } : null
				const a = res.data?.acks
				if (res.status === 200 && a?.res?.includes('busy')) { seedStats.busy++; await this.nap((Number(a.retryMs) || 1000) + 50); continue }
				if (res.status !== 200 || !Array.isArray(a?.res) || a.res.some((c) => c !== 'ok')) throw new Error(`Säen (Batch ${s}): ${brief(res)}`)
				rev = Math.max(rev, a.rev ?? rev)
				seedStats.batches++
				break
			}
		}
		const sorted = noteIds.slice().sort()
		this.hot = sorted.slice(0, WORKSHOP.hot.count)
		this.pool = [...noteIds, ...shapeIds]
		this.votable = noteIds
		this.seeded = { frames, notes: noteIds.length, shapes: shapeIds.length, connectors: ops.length - frames - noteIds.length - shapeIds.length, batches: seq }
	}

	// ── actors ───────────────────────────────────────────────────────────────

	makeActors() {
		const { moderator, accounts, guests, tablets } = this.counts
		const users = Array.isArray(this.env.load?.users) ? this.env.load.users : []
		if (accounts > 0 && users.length === 0) throw new Error('keine Lastkonten in env.json .load.users – dev/up.sh mit KD_USERS=<n> (SPEC-M1 §8.7)')
		let idx = 1
		const add = (o) => { const a = new Actor(this, { ...o, idx, rng: rngFor(this.seed, idx) }); idx++; this.actors.push(a); return a }
		if (moderator) {
			// the moderator is the owner's tab: it starts on the owner's logged-in client and logs in as the owner again after a 401 (G2 p2d)
			const m = add({ kind: 'moderator', label: 'moderator', uid: OWNER })
			m.http = this.owner
			this.moderator = m
		}
		const editors = []
		for (let i = 0; i < accounts; i++) editors.push(add({ kind: 'editor', label: `editor-${String(i + 1).padStart(2, '0')}`, uid: users[i % users.length] }))
		for (let i = 0; i < guests; i++) editors.push(add({ kind: 'editor', guest: true, label: `guest-${String(i + 1).padStart(2, '0')}` }))
		for (let i = 0; i < tablets; i++) add({ kind: 'tablet', label: `tablet-${String(i + 1).padStart(3, '0')}` })
		// roles of the workshop mix, fixed per seed: every 3rd editor drags, every 3rd (offset) votes in mode vote
		const pick = rngFor(this.seed, 7777)
		const order = editors.map((e) => [pick.next(), e]).sort((a, b) => a[0] - b[0]).map(([, e]) => e)
		order.forEach((e, i) => {
			e.dragger = i < Math.round(order.length * WORKSHOP.draggerShare)
			e.voter = i >= order.length - Math.round(order.length * WORKSHOP.editorsVoteShare)
		})
		this.tabsPerAccount = accounts ? Math.ceil(accounts / Math.min(accounts, users.length)) : 0
		if (this.tabsPerAccount > 1) {
			// SPEC-M1 §8.7 R19 (T4-09): one pid per tab – shared accounts would share one write budget
			const e = new Error(`Harness-Fehler: ${accounts} Konto-Bearbeiter, aber nur ${users.length} Lastkonten (tabsPerAccount ${this.tabsPerAccount} > 1) – Stack mit KD_USERS ≥ ${accounts} aufbauen (§8.7: KD_USERS=90)`)
			e.code = 1
			throw e
		}
	}

	/** SC: the moderator joins before the window opens (it starts timer and summon). */
	async joinModerator() {
		if (this.moderator && !this.moderator.ready) await this.moderator.join()
	}

	async joinAll(spreadMs) {
		this.loops = this.actors.map(async (a) => {
			await this.nap(a.kind === 'moderator' ? 0 : a.rng.range(0, spreadMs))
			if (!this.running) return
			try {
				if (!a.ready && !(await a.join())) return
				await a.loop()
			} catch (e) {
				a.error = String(e?.message || e).slice(0, 300)
				this.protocolError(a, 'Gerät gestoppt', { error: a.error })
			}
		})
	}

	// ── moderation timeline ──────────────────────────────────────────────────

	async moderate(what, fn) {
		const r = await fn()
		this.record('moderate', 'moderator', r)
		this.events.push({ at: this.windowStart ? this.windowMs : null, what, status: r.status })
		if (r.status === 200 && r.data?.board && this.moderator) this.moderator.takeMeta(r.data.board)
		if (r.status !== 200) this.protocolError(this.moderator || { label: 'moderator' }, `Moderation ${what}: HTTP ${r.status}`, { body: String(r.text).slice(0, 200) })
		return r
	}

	async startModeration() {
		if (!this.sc.moderator || !this.moderator) return
		await this.moderate('timer start', () => this.owner.timer(this.board.id, { action: 'start', ms: WORKSHOP.timerMs }))
		await this.moderate('summon', () => this.owner.summon(this.board.id, { client: this.moderator.cid }))
		this.summoning = true
	}

	async voteWindow() {
		const tl = this.timeline
		if (tl.voteOpenMs === null || !this.moderator) return
		await this.until(tl.voteOpenMs)
		if (!this.running || this.stop.requested) return
		const v = WORKSHOP.vote
		await this.moderate('vote start', () => this.owner.startVote(this.board.id, { per: v.per, perItem: v.perItem, scope: v.scope, types: v.types, minutes: v.minutes }))
		this.moderator.mode = 'vote'
		for (const a of this.actors) if (a.voter) { a.mode = 'vote'; a.task = null }
		await this.until(tl.voteCloseMs)
		if (!this.running || this.stop.requested) return
		const r = await this.moderate('vote end', () => this.owner.updateVote(this.board.id, { action: 'end' }))
		this.voteClosed = r.data?.board?.meta?.vote || null
		for (const a of this.actors) if (a.mode === 'vote') a.mode = 'edit'
	}

	async until(windowMs) {
		while (this.running && !this.stop.requested && this.windowMs < windowMs) await this.nap(Math.min(250, windowMs - this.windowMs))
	}

	async endModeration() {
		if (!this.sc.moderator || !this.moderator) return
		this.summoning = false
		await this.owner.endSummon(this.board.id).catch(() => null)
		await this.owner.timer(this.board.id, { action: 'stop' }).catch(() => null)
	}

	// ── measurement ──────────────────────────────────────────────────────────

	async beginMeasure() {
		this.host0 = this.deps.host ? await this.deps.host() : null
		if (this.deps.metrics) await this.deps.metrics.before({ seed: this.seedBudget })
		this.genCpu0 = process.cpuUsage()
		this.phase = 'measure'
		this.windowStart = Date.now()
		// G6 (p2d, W3B-07): the write-budget counters on their own 5-s clock, never late behind a slow 1-s sample
		this.deps.metrics?.startBudget?.(this.board.id, () => this.moderator?.http?.epoch ?? this.env.epoch)
		this.sampler = (async () => {
			while (this.phase === 'measure') {
				const t = Date.now()
				if (this.deps.metrics) await this.deps.metrics.sample(this.board.id, this.moderator?.http?.epoch ?? this.env.epoch).catch(() => {})
				await sleep(Math.max(0, 1000 - (Date.now() - t)))
			}
		})()
	}

	async endMeasure() {
		this.windowEnd = Date.now()
		// p2e (review finding 1): the budget clock stops at the window end; a read that ends later is dropped
		this.deps.metrics?.endBudget?.(this.windowEnd)
		this.phase = 'after'
		await this.sampler
		this.genCpu = process.cpuUsage(this.genCpu0)
		if (this.deps.metrics) await this.deps.metrics.after()
		this.host1 = this.deps.host ? await this.deps.host() : null
	}

	// ── quiet + checks K1–K3 ─────────────────────────────────────────────────

	async quietAndCheck() {
		this.phase = 'quiet'
		this.acting = false
		for (const a of this.actors) { a.task = null; a.mode = 'edit' }
		const tq = Date.now()
		const busy = () => this.actors.some((a) => a.ready && !a.error && (a.queue.length || a.inflight))
		while (Date.now() - tq < 30000 && busy()) await sleep(200)
		const drained = !busy()
		this.phase = 'check'
		// G4 (p2d, W3B-04): the reference snapshot through a FRESH session (own login as the owner),
		// never through a client whose session may have died during the run (SF: Redis restart)
		const checker = new Client(this.env, 'checker', { kind: 'user' })
		try {
			await checker.login(OWNER)
		} catch (e) {
			return { ok: false, error: `Prüf-Anmeldung: ${String(e?.message || e).slice(0, 200)}`, session: 'frisch (eigene Anmeldung)' }
		}
		let snap = null
		let target = -1
		const live = () => this.actors.filter((a) => a.ready && !a.error && !a.loggedOut)
		const tc = Date.now()
		for (let round = 0; round < 8 && Date.now() - tc < 70000; round++) {
			const s = await checker.snapshot(this.board.id)
			this.record('snapshot', 'checker', s)
			if (s.status !== 200) return { ok: false, error: `Snapshot: ${brief(s)}`, session: 'frisch (eigene Anmeldung)' }
			snap = s.data
			if (snap.rev === target && live().every((a) => a.mirror.rev === target)) break
			target = snap.rev
			while (Date.now() - tc < 70000 && live().some((a) => a.mirror.rev < target)) await sleep(250)
			await sleep(500)
		}
		const keys = snapshotKeys(snap)
		// K1: every mirror (editors and tablets) equals the snapshot
		const k1 = { clients: 0, equal: 0, samples: [] }
		for (const a of live()) {
			k1.clients++
			const d = diffKeys(a.mirror.keys(), keys, a.label, 'snapshot')
			if (!d.length && a.mirror.rev === snap.rev) k1.equal++
			else if (k1.samples.length < 10) k1.samples.push({ actor: a.label, rev: a.mirror.rev, snapRev: snap.rev, diff: d.slice(0, 3) })
		}
		k1.stopped = this.actors.filter((a) => a.error).map((a) => `${a.label}: ${a.error}`).slice(0, 10)
		// G2/G4 (p2d): devices still logged out at the check have no mirror to compare – named, judged by SF rule 2 (never recovered)
		k1.loggedOut = this.actors.filter((a) => a.loggedOut && !a.error).map((a) => a.label).slice(0, 20)
		k1.ok = k1.clients > 0 && k1.equal === k1.clients && k1.stopped.length === 0
		// p2e (review finding 2): without a fault injection a device that is logged out at the check makes K1 red
		if (!this.sc?.faults && k1.loggedOut.length) k1.ok = false
		// K2 + K3 need the change log
		let k2 = { ok: null, notRun: 'kein Änderungslog (deps.changes fehlt)' }
		let k3 = { ok: null, notRun: 'kein Änderungslog (deps.changes fehlt)' }
		if (this.deps.changes) {
			const rows = await this.deps.changes(this.board.id)
			const rep = replayChanges(rows)
			const d = diffKeys(replayKeys(rep), keys, 'replay', 'snapshot')
			k2 = { ok: d.length === 0 && rep.problems.length === 0, rows: rows.length, diff: d.slice(0, 5), problems: rep.problems.slice(0, 5) }
			k3 = verifyAcks(rows, this.acks)
		}
		const votes = this.checkVotes(snap)
		return { ok: drained && k1.ok && k2.ok !== false && k3.ok !== false && votes.ok !== false && this.protocolErrors.length === 0, drained, snapRev: snap.rev, items: snap.items.length, session: 'frisch (eigene Anmeldung)', k1, k2, k3, votes }
	}

	/** Result of the session = the sum of the generator's confirmed votes (votes.mine per pid) on live items. */
	checkVotes(snap) {
		if (!this.voteClosed) return { ok: this.timeline.voteOpenMs === null ? null : false, notRun: this.timeline.voteOpenMs === null ? 'keine Abstimmung in diesem Szenario' : undefined, error: this.timeline.voteOpenMs === null ? undefined : 'Abstimmung nicht beendet' }
		const live = new Set((snap.items || []).map((it) => it.id))
		const byPid = new Map()
		for (const a of this.actors) {
			if (!a.pid || a.voteSid !== this.voteClosed.sid) continue
			const cur = byPid.get(a.pid)
			if (!cur || a.mineAt > cur.mineAt) byPid.set(a.pid, a)
		}
		const want = new Map()
		for (const a of byPid.values()) for (const [id, n] of a.mine) if (live.has(id) && n > 0) want.set(id, (want.get(id) || 0) + n)
		const got = new Map((this.voteClosed.results || []).map(([id, n]) => [id, Number(n)]))
		const capped = typeof this.voteClosed.total === 'number' && this.voteClosed.total > got.size
		const diff = []
		for (const [id, n] of want) if (got.get(id) !== n && !(capped && !got.has(id))) diff.push({ id, want: n, got: got.get(id) ?? 0 })
		for (const [id, n] of got) if (!want.has(id)) diff.push({ id, want: 0, got: n })
		return { ok: diff.length === 0, sid: this.voteClosed.sid, voters: this.voteClosed.voters ?? null, items: got.size, capped, votesSent: this.actors.reduce((s, a) => s + a.stats.voteOps, 0), diff: diff.slice(0, 10) }
	}

	// ── report ───────────────────────────────────────────────────────────────

	/**
	 * G2 (p2d): the sessions of the run – every device whose session a 401 ended (per device and
	 * session the first 401: sent/answered in ms since the window start, device, role), the
	 * re-logins, failed re-login attempts, ops lost with a dead session, devices still logged out.
	 */
	sessionReport() {
		const off = Number.isFinite(this.windowStart) ? this.windowStart - this.t0 : null
		const w = (tMs, ms = 0) => (off === null ? null : Math.round((tMs - ms - off) * 10) / 10)
		return {
			logouts: this.logouts.length,
			loggedOut: this.logouts.slice(0, 50).map((x) => ({ device: x.device, role: x.who, sess: x.sess, sentMs: w(x.tMs, x.ms), recvMs: w(x.tMs), key: x.key, status: x.status, phase: x.phase, lostOps: x.lostOps, relogin: x.relogin ?? false, setCookie: x.setCookie ?? [] })),
			relogins: this.relogins.length,
			relogged: this.relogins.slice(0, 50).map((x) => ({ device: x.device, role: x.who, sess: x.sess, atMs: w(x.tMs), ms: x.ms, phase: x.phase })),
			reloginFailures: this.reloginFailures.length,
			reloginFailureSamples: this.reloginFailures.slice(0, 5).map((x) => ({ device: x.device, atMs: w(x.tMs), error: x.error })),
			lostOps: this.logouts.reduce((a, x) => a + (x.lostOps || 0), 0),
			stillLoggedOut: this.actors.filter((a) => a.loggedOut).map((a) => a.label).slice(0, 20),
		}
	}

	report(extra = {}) {
		const secs = ((this.windowEnd ?? Date.now()) - (this.windowStart ?? Date.now())) / 1000 || this.secs
		const m = this.samples.filter((s) => s[7] === 'measure')
		const group = (fn) => {
			const g = {}
			for (const s of m) { const k = fn(s); if (k !== null) (g[k] ||= []).push(s) }
			return Object.fromEntries(Object.entries(g).map(([k, list]) => {
				const codes = {}
				for (const s of list) codes[s[4]] = (codes[s[4]] || 0) + 1
				return [k, { ...stats(list.map((s) => s[5])), rps: Math.round((list.length / secs) * 10) / 10, status: codes, bytesMean: Math.round(list.reduce((a, s) => a + s[6], 0) / list.length) }]
			}))
		}
		const count = (pred) => m.filter(pred).length
		const total = m.length
		const rps = total / secs
		const codes = {}
		for (const a of this.acks.filter((x) => x.phase === 'measure')) for (const c of a.res) codes[c] = (codes[c] || 0) + 1
		const busyInWindow = this.busyEvents.filter((b) => b.phase === 'measure')
		const perPid = {}
		for (const b of busyInWindow) perPid[b.pid] = (perPid[b.pid] || 0) + 1
		const metrics = this.deps.metrics ? this.deps.metrics.summary(secs, total) : null
		const cpu = metrics?.cpu?.containers
		const genCores = this.genCpu ? Math.round(((this.genCpu.user + this.genCpu.system) / 1e6 / secs) * 100) / 100 : null
		const ncPg = cpu && cpu.nc?.coresMean !== null && cpu.db?.coresMean !== null ? Math.round((cpu.nc.coresMean + cpu.db.coresMean) * 1000) / 1000 : null
		const rep = {
			scenario: this.scenarioId,
			title: this.sc.title,
			seed: this.seed,
			startedAt: new Date(this.t0).toISOString(),
			finishedAt: new Date().toISOString(),
			host: { before: this.host0, after: this.host1 },
			config: {
				...this.counts, secs: this.secs, warmupS: this.warmupS, board: this.boardSize, seeded: this.seeded,
				timeScale: Math.round(this.timeline.k * 1000) / 1000, fullLength: this.secs === this.sc.windowS,
				tabsPerAccount: this.tabsPerAccount, workshop: this.workload === 'workshop' ? WORKSHOP : null,
			},
			board: this.board ? { id: this.board.id } : null,
			measureSecs: Math.round(secs * 10) / 10,
			totals: {
				requests: total, rps: Math.round(rps * 10) / 10,
				status5xx: count((s) => typeof s[4] === 'number' && s[4] >= 500),
				status4xx: count((s) => typeof s[4] === 'number' && s[4] >= 400 && s[4] < 500),
				status429: count((s) => s[4] === 429),
				timeouts: count((s) => s[4] === 'timeout'),
				netErrors: count((s) => s[4] === 'neterr'),
				bytesPerSec: Math.round(m.reduce((a, s) => a + s[6], 0) / secs),
				bytesPlainPerSec: Math.round(this.bytesPlain / secs),
			},
			endpoints: group((s) => s[1]),
			// rule 4: the sync classes in the window; snapshots and joins (a join answer is a snapshot) wherever devices took them
			latency: {
				...Object.fromEntries(SYNC_KEYS.map((k) => [k, stats(m.filter((s) => s[1] === k).map((s) => s[5]))])),
				snapshot: stats(this.samples.filter((s) => (s[1] === 'snapshot' || s[1] === 'join') && s[4] === 200 && s[7] !== 'setup').map((s) => s[5])),
				// G1 (p2d, W3B-02): report only – all sync classes pooled, computed here before S5 drops the samples;
				// S5 judges the maximum of the class p95 (syncMax names the class)
				syncPooled: stats(m.filter((s) => SYNC_KEYS.includes(s[1])).map((s) => s[5])),
				syncMax: classMax(m),
			},
			// G2 (p2d, W3B-05): sessions ended by a 401 (time since the window start, device, role) and the re-logins
			sessions: this.sessionReport(),
			byWho: group((s) => `${s[1]} · ${s[2]}`),
			opCodes: codes,
			budget: {
				busy: busyInWindow.length, busyByPid: perPid, busyAll: this.busyEvents.length,
				// T4-09: the calibration source – the highest w:/wo: counter per pid and window (incl. derived rows), WITHOUT the seeding
				maxPerPid: metrics?.budget?.maxPerPid ?? null,
				byPid: metrics?.budget?.byPid ?? null,
				// G6 (p2d): reads on the own 5-s clock (count, gaps) and the keys that had expired by the GET ("nicht vorhanden")
				sampling: metrics?.budget?.sampling ?? null,
				missing: metrics?.budget?.missing ?? null,
				// W3E-05/AUD-05: the seeding apart – requests, ops and busy answers of the owner before the run (§8.7: it does not count for rule 2)
				seed: this.seedStats ? { ...this.seedStats, pid: this.seedBudget?.pid ?? null, lastWindow: this.seedBudget?.win ?? null, counters: metrics?.budget?.seed ?? null } : null,
			},
			// T4-16: report only; finding [B] above 50 ms lock or 120 ms vote-sync p95
			boardLock: metrics ? boardLockReport(metrics.boardLockRows ?? null, stats(m.filter((s) => s[1] === 'sync-vote').map((s) => s[5]))) : null,
			actions: this.actions,
			hotOps: this.hotOps,
			resyncs: this.resyncs,
			presence: { cursorLagMs: stats(this.cursorLag), followLagMs: stats(this.followLag), blobBytes: metrics?.presenceBlobBytes ?? null },
			metrics: metrics ? { ...metrics, ncPgCoresMean: ncPg, msPerRequest: ncPg !== null && rps ? Math.round(((ncPg * 1000) / rps) * 10) / 10 : null } : { notRun: 'keine Kollektoren (deps.metrics fehlt)' },
			generator: { cpuCores: genCores },
			moderation: this.events,
			edge: total ? { limits: EDGE_GLOBAL, ...edgeVerdict(m.map((s) => s[0] - s[5]), rps) } : null,
			protocolErrors: this.protocolErrors,
			clientErrors: this.actors.filter((a) => a.error).map((a) => `${a.label}: ${a.error}`).slice(0, 20),
			samples: { columns: ['tMs', 'key', 'who', 'kind', 'status', 'ms', 'bytes', 'phase'], rows: this.samples },
			...extra,
		}
		return rep
	}
}

/**
 * K3: every `ok` object op of every batch is in effect in the state after all
 * change-log rows up to its batch's rev (spike verifyAcks, on the oracle's
 * path semantics). Votes have no rev and are checked by checkVotes.
 */
export function verifyAcks(rows, acks) {
	const live = new Map()
	const byRev = new Map()
	for (const a of acks) {
		if (a.rev === null || a.rev === undefined) continue
		if (!byRev.has(a.rev)) byRev.set(a.rev, [])
		byRev.get(a.rev).push(a)
	}
	const revs = [...byRev.keys()].sort((x, y) => x - y)
	let ai = 0
	let checked = 0
	const fails = []
	const verify = (rev) => {
		for (const a of byRev.get(rev)) {
			a.ops.forEach((op, i) => {
				if (a.res[i] !== 'ok' || op.o === 'vote') return
				checked++
				const it = live.get(op.id)
				let fail = null
				if (op.o === 'remove') { if (it) fail = 'noch da' } else if (!it) fail = 'fehlt'
				else if (op.o === 'put') { if (it.t !== op.t) fail = 'Typ weicht ab' } else {
					for (const [p, v] of Object.entries(op.p)) {
						const field = p
						const got = NUM_FIELDS.includes(field) ? Number(it[field]) : canon(getPath(it, field))
						const want = NUM_FIELDS.includes(field) ? Number(v) : canon(v)
						if (JSON.stringify(got ?? null) !== JSON.stringify(want ?? null)) fail = `Pfad ${p}`
					}
				}
				if (fail) fails.push({ rev, actor: a.actor, id: op.id, op: op.o, fail })
			})
		}
	}
	const below = (limit) => { while (ai < revs.length && revs[ai] < limit) verify(revs[ai++]) }
	let cur = null
	for (const row of rows) {
		const rev = Number(row.rev)
		if (rev !== cur) { below(rev); cur = rev }
		let p = row.patch
		if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
		if (row.op === 'put' && isObj(p)) live.set(row.item_id, normItem(p))
		else if (row.op === 'remove') live.delete(row.item_id)
		else if (row.op === 'patch' && isObj(p)) {
			const it = live.get(row.item_id)
			if (it) for (const [path, v] of Object.entries(p)) setPath(it, path, NUM_FIELDS.includes(path) ? Number(v) : v)
		}
	}
	below(Infinity)
	return { ok: fails.length === 0, checked, failures: fails.length, samples: fails.slice(0, 10) }
}

/**
 * One scenario run (S1, S4, S4e, S4d, SF, SC) or the S5 steps.
 * @param {object} o
 * @param {object} o.env       env.json of the namespace (or a fake for the self-test)
 * @param {string} o.scenario  SCENARIOS key
 * @param {number} o.seed
 * @param {number} [o.secs]    window (S5: per step), default from the scenario
 * @param {number} [o.warmupS]
 * @param {number} [o.scale]
 * @param {number[]} [o.steps] S5 editor steps
 * @param {object} [o.board]   {notes, shapes, connectors, frames}
 * @param {object} [o.deps]    metrics, changes, epoch, faults, host
 * @param {object} [o.stop]    {requested, reason}: set by the CLI on SIGTERM (abort rule)
 */
export async function runScenario(o) {
	const sc = SCENARIOS[o.scenario]
	if (!sc) throw new Error(`Szenario '${o.scenario}' ist unbekannt`)
	const variant = o.env.load?.variant || 'base'
	if (sc.requiresVariant && variant !== sc.requiresVariant) {
		const e = new Error(`${o.scenario} braucht die Variante ${sc.requiresVariant} (KD_NS=<ns> dev/load/variant.sh ${sc.requiresVariant}), aktiv ist ${variant}`)
		e.code = 2
		throw e
	}
	if (sc.via === 'traefik') {
		// S4e: the devices talk to the Traefik of the load run on the front network (env.json .load.traefik, WP-D4)
		const tr = o.env.load?.traefik
		if (!tr?.ip) {
			const e = new Error(`${o.scenario} braucht den Traefik des Lastlaufs (env.json .load.traefik, Container knorke-dev-<ns>-traefik; Gerüst, WP-D4 Phase 1)`)
			e.code = 2
			throw e
		}
		o = { ...o, env: { ...o.env, ncIp: tr.ip, ncPort: tr.port ?? 80 } }
	}
	const secs = o.secs ?? sc.windowS
	const warmupS = o.warmupS ?? (o.scenario === 'SC' ? sc.spreadS : sc.warmupS)
	const board = o.board ?? BOARD
	const stop = o.stop ?? { requested: false, reason: null }
	const base = { scenario: o.scenario, variant, seed: o.seed, env: o.env, versions: o.env.versions ?? null }
	if (o.scenario === 'S5') {
		const steps = []
		let knee = null
		for (const editors of o.steps ?? sc.steps) {
			if (stop.requested) break
			const run = new Run({ env: o.env, scenarioId: 'S5', sc, seed: o.seed + steps.length, secs, warmupS, counts: actorCounts(sc, { scale: o.scale, editors }), boardSize: board, deps: o.deps, stop, log: o.log })
			const rep = await oneRun(run, o)
			delete rep.samples
			steps.push(rep)
			if (rep.aborted || rep.error) break
			knee = stepKnee(editors, rep)
			if (knee) break
			await sleep((sc.quietS ?? 10) * 1000 * Math.min(1, secs / sc.windowS))
		}
		const rep = { ...base, title: sc.title, steps, knee, startedAt: steps[0]?.startedAt ?? null, finishedAt: new Date().toISOString(), config: { steps: o.steps ?? sc.steps, secs, warmupS, scale: o.scale ?? 1 }, aborted: stop.requested ? { reason: stop.reason } : null }
		// §8.7 "Jeder Lauf schreibt uptime vorher/nachher, … App-Liste" (W3E-07): S5 from its first and last step
		rep.host = { before: steps[0]?.host?.before ?? null, after: steps[steps.length - 1]?.host?.after ?? null }
		rep.apps = [...steps].reverse().find((x) => Array.isArray(x.apps))?.apps ?? null
		const complete = completeSteps(steps)
		rep.completeSteps = complete.map((x) => x.config?.editors)
		if (rep.aborted && !knee) {
			// §8.7 "Weitere" (R19, T4-10): the knee lies beyond the last complete step
			const last = complete.length ? complete[complete.length - 1].config.editors : null
			rep.knee = { editors: null, aboveEditors: last, abortedByGuard: true, text: last === null ? 'kein vollständiger Schritt (Abbruch durch Lastschutz)' : `> ${last} (Abbruch durch Lastschutz)` }
		}
		delete rep.env
		rep.gate = evaluate(rep)
		return rep
	}
	const run = new Run({ env: o.env, scenarioId: o.scenario, sc, seed: o.seed, secs, warmupS, counts: actorCounts(sc, { scale: o.scale }), boardSize: board, deps: o.deps, stop, log: o.log })
	const rep = { ...base, ...(await oneRun(run, o)) }
	delete rep.env
	if (o.scenario === 'SC') {
		// T4-11: the page requests measured in `load` right before SC (--page-requests), else 85/34 "nicht gemessen"
		const measured = Array.isArray(o.pageRequests) && o.pageRequests.length === 2
		// the report names both sources and the E12 values beside them (§8.7; W3E-09: E12 85/31 and M0 85/34 apart)
		rep.pageRequests = measured
			? { editor: o.pageRequests[0], tablet: o.pageRequests[1], measured: true, source: 'gemessen (load.mjs --page-requests, Apache-Zugriffsprotokoll)', reference: PAGE_REQUESTS_M0, e12: PAGE_REQUESTS_E12 }
			: { editor: PAGE_REQUESTS_M0.editor, tablet: PAGE_REQUESTS_M0.tablet, measured: false, source: 'nicht gemessen (Vorgabe 85/34 aus M0) – P2 ist für SC nicht belegt', reference: PAGE_REQUESTS_M0, e12: PAGE_REQUESTS_E12 }
		rep.coldStart = coldStartModel({ ...sc, editorPageRequests: rep.pageRequests.editor, tabletPageRequests: rep.pageRequests.tablet }, run.counts, o.seed)
	}
	rep.gate = evaluate(rep)
	return rep
}

/**
 * The knee at one complete S5 step, or null (§8.7 "Weitere": p95 sync > 300 ms or ≥ 1 % errors). p95 = the maximum
 * of the class p95 (R2, as the gate at 45); errors = the errors of S4 rule 2 without busy per request (R21, P2B-01:
 * kneeErrors, the definition of the gate at 45 – before, only 5xx, timeouts, network errors and 429 counted).
 */
export function stepKnee(editors, rep) {
	const p95 = syncP95(rep)
	const errShare = kneeErrors(rep).share
	if (p95 === null || p95 > GATE_S5.kneeP95Ms || errShare >= GATE_S5.kneeErrorShare) return { editors, p95, errorShare: Math.round(errShare * 10000) / 10000 }
	return null
}

function syncP95(rep) {
	const all = ['sync-empty', 'sync-items', 'sync-ops', 'sync-vote'].map((k) => rep.endpoints?.[k]?.p95).filter((v) => typeof v === 'number')
	return all.length ? Math.max(...all) : null
}

/** SC model: each spread of §8.7 through the edge bucket. */
export function coldStartModel(sc, counts, seed) {
	return sc.spreadsS.map((spreadS) => {
		const starts = coldStartArrivals({ editors: counts.editors, tablets: counts.tablets, spreadS, editorReqs: sc.editorPageRequests, tabletReqs: sc.tabletPageRequests, seed })
		return { spreadS, requests: starts.length, ...edgeVerdict(starts, starts.length / spreadS) }
	})
}

async function oneRun(run, o) {
	const extra = {}
	let faults = null
	try {
		await run.setup()
		run.makeActors()
		run.stop.onStop = () => run.halt()
		if (run.scenarioId === 'SC') {
			// cold start measured directly: the window opens first, the devices join spread over spreadS, then secs of S4
			await run.joinModerator()
			await run.startModeration()
			await run.beginMeasure()
			await run.joinAll(run.warmupS * 1000)
			await run.until(run.warmupS * 1000 + run.timeline.windowMs)
		} else {
			run.phase = 'warmup'
			await run.joinAll(Math.min(run.warmupS * 600, 10000))
			await run.nap(run.warmupS * 1000)
			const tw = Date.now()
			while (run.running && !run.stop.requested && Date.now() - tw < 60000 && run.actors.some((a) => !a.ready && !a.error)) await sleep(200)
			await run.startModeration()
			await run.beginMeasure()
			faults = run.sc.faults && run.deps.faults ? run.deps.faults.play(run) : null
			await Promise.all([run.voteWindow(), run.until(run.timeline.windowMs), faults])
		}
		await run.endMeasure()
		if (run.sc.faults && !run.deps.faults) extra.faults = { notRun: 'keine Fehlereinspielung (deps.faults fehlt)' }
		if (run.stop.requested) extra.aborted = { reason: run.stop.reason }
		else if (run.sc.checks) {
			// p2e (review finding 5): a failing check is the check's error – it never takes the SF report with it
			try { extra.checks = await run.quietAndCheck() } catch (e) { extra.checks = { ok: false, error: `K-Prüfung: ${String(e?.message || e).slice(0, 300)}` } }
		}
		// SF after the checks (G3 p2d): the devices kept polling through quiet and check, so a device that
		// recovers only after the window is seen and one that never recovers stands out
		if (faults) extra.faults = run.deps.faults.report(run)
		if (run.deps.metrics?.hygiene && !run.stop.requested) extra.hygiene = await run.deps.metrics.hygiene(run.board.id)
		if (run.deps.metrics?.apps) extra.apps = await run.deps.metrics.apps()
	} catch (e) {
		extra.error = String(e?.stack || e).split('\n').slice(0, 4).join(' | ')
		if (e?.code === 2) extra.notApplicable = true
		if (run.stop.requested) extra.aborted = { reason: run.stop.reason }
	} finally {
		if (run.phase === 'measure') await run.endMeasure().catch(() => {})
		// p2e (finding 5): the SF report also when something else threw
		if (faults && !extra.faults) {
			try { extra.faults = run.deps.faults.report(run) } catch (e) { extra.faults = { error: String(e?.message || e).slice(0, 300) } }
		}
		await run.endModeration().catch(() => {})
		run.halt()
		await Promise.race([Promise.allSettled(run.loops || []), graceful(20000)])
	}
	return run.report(extra)
}
