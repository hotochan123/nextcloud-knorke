/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Simulated workshop devices of the load run (SPEC-M1 §8.7), built on the
 * harness's protocol-2 client (dev/sim/lib/http.mjs: login, snapshot,
 * guest join, POST …/sync with `proto` and `ep`) and its independent oracle
 * mirror (dev/sim/lib/mirror.mjs). No request code of their own.
 *
 *   moderator  the board owner (alice): running timer, "Alle zu mir", the
 *              voting session; moves its viewport `v` (the tablets follow it);
 *              in mode vote, as the presenting tab, it sends only {v}
 *   editor     account (group share `workshop`, role edit) or guest (edit
 *              link); workshop mix of plan.mjs WORKSHOP; while a session is
 *              open, editorsVoteShare of them switch to mode vote: no `me`,
 *              they vote instead
 *   tablet     guest through the vote link: pres:1 every viewMs (2 s), no
 *              `me`; votes every 15–45 s while a session is open
 *
 * One request per tick; the next tick is planned from the request START
 * (spike lesson 4, SPEC-M0 §6.4). `busy` keeps the batch in flight and
 * repeats it with the same seq after retryMs (+ 0–20 %); 429 slow_down on a
 * snapshot or join waits max(retryMs, 2000) (+ 0–20 %), doubling up to 60 s
 * (SPEC-M1 §4.2); 5xx, timeouts and network errors back off along
 * INTERVALS.backoffMs and keep the batch.
 *
 * Sessions like the real client (SPEC-M0 error table, §6.4; fix round p2d
 * G2, W3B-05): the first 401 on /sync or a snapshot ends the device's
 * session – logged_out for accounts (moderator/owner included), guest_token
 * for guests and tablets. The device sends nothing more with that session:
 * its batch and queue are dropped (a re-login is a page load) and counted as
 * lost, then it logs in again (simulated user: a fresh cookie jar, login or
 * re-join, snapshot) and goes on; a failed re-login backs off. 412 (CSRF):
 * one GET /index.php/csrftoken, the same request once more, a second 412 is
 * logged_out as well.
 */
import { Client } from '../../sim/lib/http.mjs'
import { Mirror, getPath } from '../../sim/lib/mirror.mjs'
import { INTERVALS, WORKSHOP, seedZ } from './plan.mjs'

const WORDS = 'Idee Ziel Risiko Kunde Termin Budget Team Frage Plan Test Doku Wunsch Fokus Lernen Retro Markt'.split(' ')
const COLORS = ['#fff59d', '#ffcc80', '#a5d6a7', '#90caf9', '#ce93d8', '#ef9a9a', '#ffffff', '#b0bec5']
const SHAPE_KINDS = ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight']
const r2 = (v) => Math.round(v * 100) / 100
const r1 = (v) => Math.round(v * 10) / 10
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** p2e (review finding 4): the HTTP status of a failed Client.login ("Login <uid>: <status> …"), a number where it is one. */
export const loginStatus = (e) => {
	const m = /^Login \S+: (\S+)/.exec(String(e?.message || ''))
	return m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : m[1]) : 'error'
}

/**
 * The drag commit (SPEC-M0 Op-Tabelle, §4.7 rule 2a; W3E-01/AUD-02 of
 * stage 4 phase 2): the placement group {x, y, parent} is ONE register, so
 * the patch always carries all three – the item's CURRENT parent (from the
 * mirror at release) with coordinates relative to it. Unchanged parent: the
 * end position of the drag. Another parent meanwhile (or the item gone from
 * the mirror): the drag's delta on the current relative position, so the
 * triple still belongs to one writer.
 * @param {{x: number, y: number, x0: number, y0: number, parent: string|null}} t  the drag task
 * @param {object|undefined} cur  the item in the mirror now
 */
export function dragCommit(t, cur) {
	const parent = cur ? (cur.parent ?? null) : (t.parent ?? null)
	if (!cur || parent === (t.parent ?? null)) return { x: r2(t.x), y: r2(t.y), parent }
	return { x: r2(Number(cur.x) + (t.x - t.x0)), y: r2(Number(cur.y) + (t.y - t.y0)), parent }
}

let zCounter = 0
/** z keys for items created during the run: indices 20000–47987 of zKey (the seed board uses the first ones); ties are harmless. */
const nextZ = () => seedZ(20000 + (zCounter++ % 27988))

export class Actor {
	/**
	 * @param {object} run   the generator's run context (generator.mjs Run)
	 * @param {{kind: 'moderator'|'editor'|'tablet', guest?: boolean, idx: number, rng: object, label: string, uid?: string}} o
	 */
	constructor(run, { kind, guest = false, idx, rng, label, uid = null }) {
		this.run = run
		this.kind = kind
		this.guest = guest || kind === 'tablet'
		this.idx = idx
		this.rng = rng
		this.label = label
		this.uid = uid
		this.who = kind === 'editor' ? (guest ? 'guest' : 'editor') : kind
		this.http = new Client(run.env, label, { kind: this.guest ? 'guest' : 'user' })
		this.cid = rng.clientId()
		this.mirror = new Mirror()
		this.seq = 0
		this.queue = []
		this.inflight = null
		this.acks = []
		this.role = null
		this.mod = false
		this.pid = null
		this.meta = {}
		this.metaRev = -1
		this.mode = 'edit'
		this.ready = false
		this.error = null
		this.errorStreak = 0
		this.task = null
		this.nextActionAt = 0
		this.nextVoteAt = 0
		this.voteSid = null
		this.vt = 0
		this.vtAt = 0
		this.mine = new Map()
		this.mineAt = 0
		this.left = null
		this.own = []
		this.cursor = [r1(rng.range(0, 6000)), r1(rng.range(0, 4000))]
		this.viewport = [r1(rng.range(-500, 3000)), r1(rng.range(-500, 2000)), 1600, 900]
		this.lastLocalAt = 0
		this.remoteDragging = false
		this.seenCursor = new Map()
		this.seenView = ''
		this.dragger = false
		this.voter = false
		// G2 (p2d): session number (1 = the first login), the logged_out mark, re-logins and the ops lost with a dead session
		this.sess = 1
		this.loggedOut = null
		this.stats = { requests: 0, ok: 0, busy: 0, slowDown: 0, resyncs: 0, failures: 0, codes: {}, opsSent: 0, voteOps: 0, actions: {}, logouts: 0, relogins: 0, lostOps: 0 }
	}

	get board() { return this.run.board.id }

	// ── joining ──────────────────────────────────────────────────────────────

	/**
	 * Login (accounts) or guest join, then the first state; retries 429 slow_down like the client.
	 * Every account without a session logs in with its uid – the moderator too (uid = the owner,
	 * G2 p2d); at the start the moderator shares the owner's logged-in client and skips it.
	 * @param {{guest?: string|null}} [o]  the stored guest token of a re-join (SPEC-M0: re-join with the stored entry)
	 */
	async join({ guest = undefined } = {}) {
		let wait = 2000
		for (let attempt = 0; attempt < 8 && this.run.running; attempt++) {
			let r
			if (this.guest) {
				const token = this.kind === 'tablet' ? this.run.board.voteToken : this.run.board.editToken
				r = await this.http.joinGuest(token, this.label, { client: this.cid, ...(guest !== undefined ? { guest } : {}) })
				this.run.record('join', this.who, r, '', this)
			} else {
				if (!this.http.requestToken) {
					if (!this.uid) throw new Error(`${this.label}: keine uid für die Anmeldung`)
					const t0 = Date.now()
					try {
						await this.http.login(this.uid)
					} catch (e) {
						// p2e: the real status (5xx → SF 5xx rule, 401 → rule 3), never 'error'
						const lr = { status: loginStatus(e), ms: Date.now() - t0, bytes: 0, text: '' }
						this.run.record('login', this.who, lr, '', this)
						if (lr.status === 401) this.reloginUnauthorized(lr, 'login')
						throw e
					}
					this.run.record('login', this.who, { status: 200, ms: Date.now() - t0, bytes: 0 }, '', this)
				}
				r = await this.http.snapshot(this.board)
				this.run.record('snapshot', this.who, r, '', this)
			}
			if (r.status === 200 && r.data) { this.takeSnapshot(r.data); this.ready = true; return true }
			if (r.status === 401) this.reloginUnauthorized(r, this.guest ? 'join' : 'snapshot')
			if (r.status === 429) {
				this.stats.slowDown++
				await this.run.nap(Math.max(Number(r.data?.retryMs) || 0, wait) * (1 + this.rng.range(0, 0.2)))
				wait = Math.min(wait * 2, 60000)
				continue
			}
			throw new Error(`${this.label}: Beitritt ${r.status} ${String(r.text).slice(0, 160)}`)
		}
		return false
	}

	takeSnapshot(d) {
		this.mirror.load(d)
		this.pid = d.me?.pid ?? this.pid
		this.role = d.me?.role ?? this.role
		this.mod = !!d.me?.mod
		this.takeMeta(d.board)
		if (d.votes?.sid) this.takeVotes(d.votes)
	}

	takeMeta(b) {
		if (!isObj(b) || typeof b.metaRev !== 'number' || b.metaRev <= this.metaRev) return
		this.metaRev = b.metaRev
		this.meta = isObj(b.meta) ? b.meta : {}
		const sid = this.meta.vote?.sid ?? null
		if (sid !== this.voteSid) {
			this.voteSid = sid
			this.vt = 0
			this.mine = new Map()
			this.left = this.meta.vote?.cfg?.per ?? null
		}
	}

	takeVotes(v) {
		if (!isObj(v) || v.sid !== this.voteSid && this.voteSid !== null) return
		if (isObj(v.mine)) { this.mine = new Map(Object.entries(v.mine).map(([k, n]) => [k, Number(n)])); this.mineAt = Date.now() }
		if (typeof v.left === 'number') this.left = v.left
		if (typeof v.vt === 'number') this.vt = v.vt
		if (typeof v.voters === 'number') this.run.voters = v.voters
	}

	get voteOpen() { return this.meta.vote?.state === 'open' && typeof this.meta.vote.sid === 'number' }

	// ── the loop ─────────────────────────────────────────────────────────────

	async loop() {
		while (this.run.running && !this.error) {
			const t0 = Date.now()
			// G2 (p2d): a logged-out device logs in again first; nothing goes out with the dead session
			if (this.loggedOut && !(await this.relogin())) { await this.run.nap(this.delayFrom(t0)); continue }
			if (this.run.acting) this.act(t0)
			const more = await this.tick()
			if (more) continue
			await this.run.nap(this.delayFrom(t0))
		}
	}

	/**
	 * The session ended (G2 p2d, SPEC-M0 error table: 401 → logged_out, polling stops; guests:
	 * 401 guest_token → re-join). Drops the batch in flight and the queue (the server applied
	 * nothing of a 401; a re-login is a page load) and marks the device; loop() logs in again.
	 */
	endSession(r, key) {
		const lost = (this.inflight?.ops?.length || 0) + this.queue.length
		this.stats.logouts++
		this.stats.lostOps += lost
		this.run.loggedOut?.(this, { key, r, lost })
		this.inflight = null
		this.queue = []
		this.task = null
		this.ready = false
		this.loggedOut = { at: Date.now(), sess: this.sess }
	}

	/**
	 * p2e (review finding 4): a 401 while logging in again (login, snapshot or join of the new
	 * session) is that new session's first 401 – reported through run.loggedOut once per attempt
	 * series (sess + 1, series = the session that died); nothing outside a re-login.
	 */
	reloginUnauthorized(r, key) {
		if (!this.loggedOut || this.reloginReported === this.sess + 1) return
		this.reloginReported = this.sess + 1
		this.run.loggedOut?.(this, { key, r, lost: 0, sess: this.sess + 1, series: this.sess, relogin: true })
	}

	/**
	 * The simulated user logs in again: a fresh client (new cookie jar, new session), login or
	 * re-join, snapshot. The client id stays (sessionStorage of the tab), seq keeps counting.
	 * The moderator's new client becomes the run's owner client (its moderation goes on).
	 * @return {Promise<boolean>} false: not (yet) possible, the caller backs off
	 */
	async relogin() {
		const old = this.http
		this.http = new Client(this.run.env, this.label, { kind: this.guest ? 'guest' : 'user' })
		const t0 = Date.now()
		try {
			if (!(await this.join(this.guest ? { guest: old.guestToken || null } : {}))) { this.http = old; return false }
		} catch (e) {
			this.http = old
			this.errorStreak++
			this.run.reloginFailed?.(this, String(e?.message || e).slice(0, 200))
			return false
		}
		this.sess++
		this.stats.relogins++
		this.loggedOut = null
		this.errorStreak = 0
		if (this.kind === 'moderator') this.run.owner = this.http
		this.run.relogged?.(this, { ms: Date.now() - t0 })
		return true
	}

	/** Next tick relative to the request start (SPEC-M0 §6.4); error backoff on failures. */
	delayFrom(t0) {
		if (this.errorStreak > 0) return INTERVALS.backoffMs[Math.min(this.errorStreak - 1, INTERVALS.backoffMs.length - 1)]
		let base
		if (this.kind === 'tablet') base = INTERVALS.viewMs
		else if (this.run.workload === 'idle') base = INTERVALS.idleMs
		else if (this.mode === 'vote' && this.kind !== 'moderator') base = INTERVALS.idleMs
		else {
			const active = Date.now() - this.lastLocalAt < INTERVALS.activeWindowMs || this.remoteDragging
			base = active ? INTERVALS.activeMs + this.rng.range(-INTERVALS.jitterMs, INTERVALS.jitterMs) : INTERVALS.idleMs
		}
		if (this.inflight && this.inflight.notBefore > Date.now()) return Math.max(0, this.inflight.notBefore - Date.now())
		return Math.max(0, t0 + base - Date.now())
	}

	/** The presence of this tick (SPEC-M1 §4.5, §5.5, §6.4): null = no `me`. */
	presence() {
		if (this.kind === 'tablet') return null
		const presenting = this.kind === 'moderator' && this.run.summoning
		if (this.mode !== 'edit') return presenting ? { v: this.viewport } : null
		const d = this.task?.kind === 'drag' ? [[this.task.id, r2(this.task.x), r2(this.task.y)]] : []
		const s = this.task?.id ? [this.task.id] : []
		const e = this.task?.kind === 'text' ? this.task.id : null
		return { c: this.cursor, s, d, e, v: this.viewport }
	}

	moveCursor(x, y) {
		this.cursor = [r1(x), r1(y)]
		this.run.noteCursor(this.cid, this.cursor)
	}

	/** One request: ops (if any), presence, catch-up. Returns true when the server said `more`. */
	async tick() {
		if (!this.inflight && this.queue.length) this.inflight = { seq: ++this.seq, ops: this.queue.splice(0, 200), notBefore: 0 }
		const body = { client: this.cid, since: this.mirror.rev, pres: 1 }
		if (this.role) body.role = this.mod && this.role === 'edit' ? 'moderate' : this.role
		const sendOps = this.inflight && this.inflight.notBefore <= Date.now()
		if (sendOps) { body.seq = this.inflight.seq; body.ops = this.inflight.ops }
		const me = this.presence()
		if (me) body.me = me
		if (this.mod && this.voteOpen && Date.now() - this.vtAt >= 2000) { body.vt = this.vt; this.vtAt = Date.now() }
		const objOps = sendOps ? this.inflight.ops.filter((o) => o.o !== 'vote').length : 0
		const voteOps = sendOps ? this.inflight.ops.length - objOps : 0
		this.stats.requests++
		// gzip like a browser: bytes = what crosses the wire (rule 9 of §8.7)
		let r = await this.http.sync(this.board, body, { timeoutMs: 10000, gzip: true })
		const keyOf = (dd) => (objOps ? 'sync-ops' : voteOps ? 'sync-vote' : dd && (dd.items?.length || dd.removed?.length) ? 'sync-items' : 'sync-empty')
		if (r.status === 412 && !this.guest) {
			// SPEC-M0 error table 412: one GET /index.php/csrftoken, the same request once more (a second 412 → logged_out)
			this.run.record(keyOf(null), this.who, r, '', this)
			const t = await this.http.refreshToken()
			this.run.record('csrftoken', this.who, t, '', this)
			this.stats.requests++
			r = await this.http.sync(this.board, body, { timeoutMs: 10000, gzip: true })
		}
		const d = r.status === 200 && isObj(r.data) ? r.data : null
		const key = keyOf(d)
		const busy = d && sendOps && Array.isArray(d.acks?.res) && d.acks.res.includes('busy')
		this.run.record(key, this.who, r, busy ? 'busy' : '', this)
		// G2 (p2d): the first 401 (or a second 412) ends this session – no further request with it
		if (r.status === 401 || (r.status === 412 && !this.guest)) { this.stats.failures++; this.endSession(r, key); return false }
		if (!d) return this.failed(r)
		this.errorStreak = 0
		this.stats.ok++
		this.run.noteOk?.(this, Date.now() - (r.ms ?? 0))
		if (sendOps) {
			const a = d.acks
			if (!isObj(a) || !Array.isArray(a.res) || a.res.length !== this.inflight.ops.length || a.seq !== this.inflight.seq) {
				this.run.protocolError(this, 'acks fehlen oder passen nicht', { acks: a, n: this.inflight.ops.length })
				this.inflight = null
			} else if (busy) {
				this.stats.busy++
				this.run.busy(this, a)
				const wait = (Number(a.retryMs) || 1000) * (1 + this.rng.range(0, 0.2))
				this.inflight.notBefore = Date.now() + wait
			} else {
				for (const c of a.res) this.stats.codes[c] = (this.stats.codes[c] || 0) + 1
				this.run.acked(this, { seq: this.inflight.seq, rev: a.rev, res: a.res, ops: this.inflight.ops })
				this.stats.opsSent += objOps
				this.stats.voteOps += voteOps
				this.inflight = null
			}
		}
		this.takeMeta(d.board)
		if (isObj(d.me) && typeof d.me.role === 'string') { this.role = d.me.role; this.mod = !!d.me.mod }
		if (d.votes) this.takeVotes(d.votes)
		if (isObj(d.presence)) this.observe(d.presence)
		if (d.resync || (typeof d.rev === 'number' && d.rev < this.mirror.rev)) {
			this.stats.resyncs++
			this.run.resyncs++
			await this.reload()
			return false
		}
		this.mirror.apply(d)
		return !!d.more
	}

	failed(r) {
		this.stats.failures++
		const st = r.status
		if (st === 429 || st === 'neterr' || st === 'timeout' || (typeof st === 'number' && st >= 500)) {
			this.errorStreak++
			return false
		}
		if (st === 409 && r.data?.error === 'protocol') {
			this.run.protocolError(this, '409 protocol', { body: String(r.text).slice(0, 200) })
			this.error = '409 protocol'
			return false
		}
		this.run.protocolError(this, `HTTP ${st}`, { body: String(r.text).slice(0, 200), ops: this.inflight?.ops?.length || 0 })
		this.inflight = null
		this.errorStreak++
		return false
	}

	/** Resync: a fresh snapshot (guests through the public route), with the slow_down waits of §4.2. */
	async reload() {
		let wait = 2000
		for (let attempt = 0; attempt < 8 && this.run.running; attempt++) {
			const r = await this.http.snapshot(this.board)
			this.run.record('snapshot', this.who, r, '', this)
			if (r.status === 200 && r.data) { this.takeSnapshot(r.data); return }
			if (r.status === 401) { this.endSession(r, 'snapshot'); return }
			if (r.status === 429) { this.stats.slowDown++; await this.run.nap(Math.max(Number(r.data?.retryMs) || 0, wait) * (1 + this.rng.range(0, 0.2))); wait = Math.min(wait * 2, 60000); continue }
			this.errorStreak++
			await this.run.nap(INTERVALS.backoffMs[Math.min(attempt, INTERVALS.backoffMs.length - 1)])
		}
	}

	/** Presence of the others: cursor lag, follow lag of the presenter's v, remote drags (fast cadence). */
	observe(presence) {
		let dragging = false
		const summon = this.meta.summon
		for (const [key, e] of Object.entries(presence)) {
			if (!isObj(e)) continue
			const client = key.slice(key.indexOf(':') + 1)
			if (client === this.cid) continue
			if (Array.isArray(e.d) && e.d.length) dragging = true
			if (typeof e.x === 'number' && typeof e.y === 'number') {
				const v = `${e.x}|${e.y}`
				if (this.seenCursor.get(key) !== v) { this.seenCursor.set(key, v); this.run.seenCursor(client, e.x, e.y, this) }
			}
			if (summon && key === `${summon.pid}:${summon.client}` && Array.isArray(e.v)) {
				const v = e.v.join(',')
				if (v !== this.seenView) { this.seenView = v; this.run.seenView(v, this) }
			}
		}
		this.remoteDragging = dragging
	}

	// ── workload ─────────────────────────────────────────────────────────────

	enqueue(op) {
		if (op.o === 'remove') this.queue = this.queue.filter((q) => !(q.id === op.id && q.o === 'patch'))
		this.queue.push(op)
		if (op.o !== 'vote') this.lastLocalAt = Date.now()
	}

	count(name) { this.stats.actions[name] = (this.stats.actions[name] || 0) + 1; this.run.countAction(name) }

	/** Advances this device's workload by one tick. */
	act(now) {
		const k = this.run.timeline.k
		if (this.kind === 'tablet' || this.mode === 'vote') return this.actVote(now, k)
		if (this.kind === 'moderator') return this.actModerator(now, k)
		if (this.run.workload !== 'workshop') { this.moveCursor(this.cursor[0] + this.rng.range(-20, 20), this.cursor[1] + this.rng.range(-20, 20)); return }
		const t = this.task
		if (t?.kind === 'drag') {
			if (now < t.until) {
				t.x += t.dx
				t.y += t.dy
				this.moveCursor(t.x + 80, t.y + 80)
				return
			}
			// commit on release (§8.7): one patch with the end position
			this.enqueue({ o: 'patch', id: t.id, p: dragCommit(t, this.mirror.items.get(t.id)) })
			this.task = null
			this.nextActionAt = now + this.period(k)
			return
		}
		if (t?.kind === 'text') {
			if (now >= t.nextAt) {
				t.text = (t.text + ' ' + this.rng.pick(WORDS)).slice(-300).trim()
				this.enqueue({ o: 'patch', id: t.id, p: { 'data.text': t.text } })
				if (--t.left <= 0) { this.task = null; this.nextActionAt = now + this.period(k) } else t.nextAt = now + this.rng.range(...WORKSHOP.textGapMs)
			}
			return
		}
		this.moveCursor(this.cursor[0] + this.rng.range(-40, 40), this.cursor[1] + this.rng.range(-40, 40))
		if (now < this.nextActionAt) return
		if (this.dragger) return this.startDrag(now, k)
		const what = this.rng.weighted(WORKSHOP.mix)
		if (what === 'text') this.startText(now)
		else if (what === 'createDelete') this.createOrDelete(now)
		else if (what === 'transform') this.transform()
		else this.restyle()
		if (!this.task) this.nextActionAt = now + this.period(k)
	}

	/** Pause before the next action: draggers 60 / (2–4) s, the others actionEveryMs; scaled with the window. */
	period(k) {
		if (this.dragger) return (60000 / this.rng.range(...WORKSHOP.dragsPerMin)) * k
		return this.rng.range(...WORKSHOP.actionEveryMs) * k
	}

	/** An existing item of one of the types; ≈ 30 % from the 20 hot objects (§8.7). */
	target(types) {
		if (this.rng.chance(WORKSHOP.hot.share)) {
			const hot = this.run.hot.filter((id) => types.includes(this.mirror.items.get(id)?.t))
			if (hot.length) { this.run.hotOps++; return this.rng.pick(hot) }
		}
		const pool = this.run.pool.filter((id) => types.includes(this.mirror.items.get(id)?.t))
		return pool.length ? this.rng.pick(pool) : null
	}

	startDrag(now, k) {
		const id = this.target(['sticky', 'shape'])
		if (!id) return
		const it = this.mirror.items.get(id)
		const ms = this.rng.range(...WORKSHOP.dragMs) * Math.max(k, 0.05)
		const steps = Math.max(1, ms / INTERVALS.activeMs)
		// x/y are relative to the item's parent (SPEC-M0 §4.7 rule 2a): remember both, the commit sends the whole group
		this.task = { kind: 'drag', id, until: now + ms, x: it.x, y: it.y, x0: it.x, y0: it.y, parent: it.parent ?? null, dx: this.rng.range(-300, 300) / steps, dy: this.rng.range(-300, 300) / steps }
		this.count('drag')
	}

	startText(now) {
		const id = this.target(['sticky', 'shape'])
		if (!id) return
		this.task = { kind: 'text', id, text: String(getPath(this.mirror.items.get(id), 'data.text') || ''), left: this.rng.int(...WORKSHOP.textEdits), nextAt: now }
		this.count('text')
	}

	createOrDelete() {
		const live = this.own.filter((id) => this.mirror.items.has(id))
		if (live.length && this.rng.chance(0.4)) {
			const id = this.rng.pick(live)
			this.own = this.own.filter((x) => x !== id)
			this.enqueue({ o: 'remove', id })
			this.count('delete')
			return
		}
		const kind = this.rng.weighted(WORKSHOP.createKinds)
		const id = this.rng.ulid(Date.now())
		const [cx, cy] = this.cursor
		if (kind === 'connector') {
			const a = this.target(['sticky'])
			const b = this.target(['sticky'])
			if (!a || !b || a === b) return
			this.enqueue({ o: 'put', id, t: 'connector', p: { x: 0, y: 0, w: 0, h: 0, r: 0, z: nextZ(), parent: null, data: { start: { item: a }, end: { item: b }, route: 'elbow' }, style: { endCap: 'arrow' } } })
		} else if (kind === 'shape') {
			this.enqueue({ o: 'put', id, t: 'shape', p: { x: r2(cx), y: r2(cy), w: 200, h: 120, r: 0, z: nextZ(), parent: null, data: { kind: this.rng.pick(SHAPE_KINDS), text: this.rng.pick(WORDS) }, style: { fill: this.rng.pick(COLORS) } } })
		} else {
			this.enqueue({ o: 'put', id, t: 'sticky', p: { x: r2(cx), y: r2(cy), w: 200, h: 200, r: 0, z: nextZ(), parent: null, data: { text: this.rng.pick(WORDS) }, style: { fill: this.rng.pick(COLORS) } } })
		}
		this.own.push(id)
		this.count('create-' + kind)
	}

	transform() {
		const id = this.target(['shape', 'sticky'])
		if (!id) return
		const it = this.mirror.items.get(id)
		if (it.t === 'shape' && this.rng.chance(0.3)) this.enqueue({ o: 'patch', id, p: { r: this.rng.pick([0, 15, 45, 90]) } })
		else {
			const w = r2(Math.max(40, it.w * this.rng.range(0.8, 1.25)))
			this.enqueue({ o: 'patch', id, p: it.t === 'sticky' ? { w, h: w } : { w, h: r2(Math.max(30, it.h * this.rng.range(0.8, 1.25))) } })
		}
		this.count('transform')
	}

	restyle() {
		const id = this.target(['sticky', 'shape'])
		if (!id) return
		this.enqueue({ o: 'patch', id, p: { 'style.fill': this.rng.pick(COLORS) } })
		this.count('style')
	}

	/** Moderator: viewport moves (the tablets follow), cursor; the timeline drives the moderation routes. */
	actModerator(now, k) {
		if (now >= this.nextActionAt) {
			this.viewport = [r1(this.rng.range(-500, 3000)), r1(this.rng.range(-500, 2000)), 1600, 900]
			this.run.noteView(this.viewport.join(','))
			this.nextActionAt = now + WORKSHOP.viewportEveryMs * k
		}
		this.moveCursor(this.viewport[0] + 800 + this.rng.range(-50, 50), this.viewport[1] + 450 + this.rng.range(-50, 50))
	}

	/** Tablets and editors in mode vote: one vote op every 15–45 s while a session is open (§8.7). */
	actVote(now, k) {
		if (this.kind === 'moderator') return this.actModerator(now, k)
		if (!this.voteOpen) return
		if (!this.nextVoteAt) { this.nextVoteAt = now + this.rng.range(...WORKSHOP.firstVoteS) * 1000 * k; return }
		if (now < this.nextVoteAt) return
		this.nextVoteAt = now + this.rng.range(...WORKSHOP.tabletVoteEveryS) * 1000 * k
		const cfg = this.meta.vote.cfg || WORKSHOP.vote
		const id = this.rng.pick(this.run.votable)
		if (!id) return
		const cur = this.mine.get(id) || 0
		const n = cur > 0 && this.rng.chance(0.2) ? 0 : this.rng.int(1, Math.max(1, cfg.perItem || 1))
		this.enqueue({ o: 'vote', s: this.meta.vote.sid, id, n })
		this.count('vote')
	}
}
