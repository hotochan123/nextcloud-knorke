/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The sync loop (SPEC-M0 §6.4): ONE POST /sync per tick carries ops, acks,
 * compacted changes and piggy-backed presence. Always exactly one request in
 * flight; the next tick is scheduled from the start of the previous request
 * (scheduler.js).
 *
 * Errors are decided on the STATUS where Nextcloud or a proxy answers (§4.2).
 * End answers (SPEC-M1 §1.2 (R23)): /sync and the re-join send
 * `X-Knorke-End-State: 1`, the server answers guest_token, not_logged_in,
 * link_revoked, link_expired and links_disabled with 200 {"end", "message"},
 * and the transport throws them as the old HttpError (401 guest_token and
 * not_logged_in, else 403, fromApp): the rows below apply to both forms.
 *   proxy 429/503       wait Retry-After or 2–10 s, failures unchanged, not offline
 *   403/404 without the app body (fromApp false: a proxy or firewall answered,
 *                       SPEC-M1 §6.4, R22, P7-07) like 0/5xx below: the batch
 *                       stays (same seq), failures++ (from 2 on 'offline'),
 *                       backoff; never final, never the 2–10 s of 429/503
 *   404                 'gone', stop
 *   401 (user)          first bridged, 2nd in a row 'logged_out'; a 2xx resets
 *                       (SPEC-M1 §1.2, R21: a Redis restart answers a valid
 *                       session 401 for a moment). The first 401 on /sync
 *                       takes the 0/5xx path below (the batch stays with the
 *                       same seq, failures++, backoff); a second one with no
 *                       2xx in between: 'logged_out', stop. Every 401 counts
 *                       (Nextcloud {message} without `error`, and the 401 the
 *                       transport builds, e.g. after a second 412); other
 *                       errors keep the count. /sync only: a 401 on the
 *                       resync snapshot is 'logged_out' at once (M0 table)
 *   401 (guest)         exactly one re-join per failure streak (_rejoin)
 *   403 link_revoked    guest: exactly one re-join per failure streak (SPEC-M1
 *                       §6.4, R2: the link generation changed – renewed,
 *                       password set or expiry moved earlier); user: 'revoked'
 *   403 link_expired    'link_expired', stop (SPEC-M1 §4.2)
 *   403 password_*      'password_required', stop (SPEC-M1 §4.2)
 *   403 links_disabled  (U12) 'links_disabled', stop: the admin turned link
 *                       sharing off (guest sync, or a guest re-join)
 *   403 other           'gone', stop (only with the app body, see above)
 *   409                 'reload', stop; the server's protocol from the body
 *                       (`proto`, '?' when missing) is kept in serverProto
 *                       for the per-version reload marker (SPEC-M1 §4.3)
 *   413                 split the batch, at once
 *   400                 drop the batch (acked as 'bad') + resync
 *   429 slow_down       (SPEC-M1 §4.2) never final: wait like a proxy 429
 *                       (does not happen on /sync; snapshot and join, below)
 *   429 (app, other)    'rate_limited', stop (R3): final, never repeated
 *                       automatically, not even by a keepalive flush
 *   500 with ops        failures++ and backoff like below, plus isolation (U8)
 *   0/411/5xx/other     failures++ (from 2 on 'offline'), backoff
 *
 * Re-join of a guest tab (_rejoin, SPEC-M1 §6.4, replaces the M0 mapping):
 * at most ONE join per failure streak, with the stored link token and name.
 *   2xx                      new token, go on (e.g. after a shortened expiry)
 *   403 password_required/_wrong  'password_required' (the guest view hands over
 *                            to the name and password phase of PublicApp)
 *   403 link_revoked, 404    'revoked'
 *   403 link_expired         'link_expired'
 *   403 links_disabled       'links_disabled'
 *   app 429 rate_limited     'revoked' with reason RATE_LIMITED (banner text)
 *   429 slow_down / proxy    wait, then the same one attempt
 *   403/404 without app body the same one attempt after a growing wait
 *                            (backoff 1/2/4/8/15 s, R22 P7-07), never final
 *   429 slow_down with reason 'password' (R13, the link password lock-out)
 *                            'password_required' at once with reason 'password'
 *                            (finalError = the answer), never repeated
 *   0/411/5xx                another attempt later (failures++)
 * A join answer with another protocol than this bundle counts as a 409.
 *
 * Protocol 2 (SPEC-M1 §4.3–§4.6), understood from stage 0 on:
 *   request  {proto, client, since, ep, role?, pres, seq?, ops?, me?, vt?}:
 *            ep = board epoch (every request, keepalive too), role = access
 *            level the client knows (owner|moderate|edit|vote|view), vt only
 *            for moderators (stage 3)
 *   answer   now → onClock({now, t0, t1}) on every 2xx; board → onMeta (before
 *            onChanges, also on the resync path); me → onRole; votes → onVotes
 *            (after onAcks and, R16 SRV-03, after onMeta and onRole of the
 *            same answer: a votes block of a new sid finds the session that
 *            meta.vote names); unknown keys are ignored
 *   busy     every op of the answer 'busy' (write budget, stage 4): nothing
 *            was applied; the batch stays in flight and goes out again with
 *            the same seq after acks.retryMs × (1 + 0–20 % random). Reads and
 *            presence go on at the normal cadence meanwhile; failures and
 *            status stay unchanged (no 'offline'). The session shows a toast
 *            after 30 s of it.
 *
 * Isolation of a batch the server keeps answering with 500 (U8): an op the
 * server cannot store (a server bug for one input) used to block the loop
 * forever, because the same batch was resent on every retry and every later
 * op queued behind it.
 *   - 3 consecutive 500 answers for the same batch make its ops suspects
 *     (proxy 429/502/503/504 never count; they keep the rules above).
 *   - A failing batch with suspects is split in half (the first half stays
 *     in flight, the rest goes back to the queue behind the compaction
 *     barrier: a 500 can come after the commit); the next attempt follows
 *     after the first backoff step.
 *   - A single suspect op that fails is set aside (Replica.holdInflight):
 *     everything else keeps flowing (only ops on its id, or naming it as
 *     parent, wait behind it). After the next successful request it goes
 *     out again, alone.
 *   - It is dropped only after failing alone 3 times, each time right after
 *     a successful request (evidence that the server works and this op is
 *     the problem; during an outage nothing is ever dropped). Dropping acks
 *     it with the client-side code 'internal': the session shows a toast and
 *     sends text ops to the text rescue (§6.5), so nothing is lost silently.
 *
 * Presence (SPEC-M1 §6.4, R16 SRV-05): getPresence() is asked on every
 * visible tick, also on a view-only device (the cadence stays viewMs): the
 * session decides (null outside mode edit, the presenting tab's {v} in every
 * mode). An unchanged me goes out again after PRESENCE_KEEPALIVE_MS.
 * (R22, P7-09) A hidden tab asks getHiddenPresence() instead: only the
 * presenting tab answers ({v}), so "Bring everyone here" stays fresh on the
 * server while the presenter shows slides in another tab (the hidden cadence
 * hiddenMs = 5 s is below the 10 s staleness, as far as the browser lets
 * timers of hidden tabs run). Every other hidden tab sends no me (M0 rule).
 * sentMe = a copy of the me CANDIDATE of the last request that went out
 * (getPresence() before that keepalive filter; null when there was none),
 * for __knorke.sentPresence() (§6.7, CLI-01).
 *
 * After a final status the loop is over: flushKeepalive() sends nothing more
 * (the server refuses it anyway, and after an app 429 it must not be asked again).
 *
 * Resync brake (§4.10.3): the third resync within 10 s waits 2 s first, every
 * further one twice as long, up to 30 s.
 */
import { HttpError, PASSWORD_LOCK, isPasswordLock, isProxyBlock, isProxyRetry, isSlowDown, slowDownDelay } from './http.js'
import { PROTOCOL } from './protocol.js'
import { BUSY, MAX_OPS, Replica } from './Replica.js'
import { INTERVALS, nextDelay } from './scheduler.js'

/**
 * App 429 (`rate_limited`): the final status of an app 429 on /sync (R3,
 * §6.4), and the reason passed with 'revoked' when a guest re-join is
 * answered with an app 429 (the link itself still works).
 */
export const RATE_LIMITED = 'rate_limited'
/**
 * U12: 403 `links_disabled` (the instance does not allow link sharing for
 * the board owner): the error code and the final status of a guest session.
 */
export const LINKS_DISABLED = 'links_disabled'
/**
 * SPEC-M1 §4.2: a guest re-join answered 403 `link_expired` (the link has
 * expired). Final: banner, polling stops, no new attempt.
 */
export const LINK_EXPIRED = 'link_expired'
/**
 * SPEC-M1 §4.2 (R2, stage 2): the automatic re-join of an open guest tab is
 * answered 403 `password_required` or `password_wrong`. Final: the guest
 * view hands over to the name and password phase of PublicApp.
 */
export const PASSWORD_REQUIRED = 'password_required'
/**
 * Statuses that end the loop for good (`_final`). Frozen list of SPEC-M1
 * §4.2 (same as FROZEN_STATUSES of the session); which answers lead to the
 * two M1 statuses is the re-join mapping of §6.4.
 */
export const FINAL_STATUSES = Object.freeze(['gone', 'revoked', 'logged_out', 'reload', RATE_LIMITED, LINKS_DISABLED, LINK_EXPIRED, PASSWORD_REQUIRED])
/** Board epoch sent when none is known (Epoch::current() without a stored epoch, SPEC-M1 §5.4). */
export const DEFAULT_EPOCH = '0'
/** Same rule as SyncRequest (SPEC-M1 §4.5): an invalid ep would make the server answer 400 and drop the batch. */
export const EPOCH_RE = /^[a-z0-9]{1,16}$/
/** Access levels the request field `role` may carry (SPEC-M1 §4.9, §4.5; R3: anything else is 400). */
export const ACCESS_LEVELS = Object.freeze(['owner', 'moderate', 'edit', 'vote', 'view'])
/** busy without acks.retryMs: wait this long. */
export const BUSY_RETRY_MS = 2000
/** Upper bound of a busy wait (the server sends at most one 10-s window). */
export const BUSY_RETRY_MAX_MS = 60000
/** Protocol marker of a 409 or join answer without `proto` (SPEC-M1 §4.3). */
export const UNKNOWN_PROTO = '?'
/** U8: consecutive 500 answers before a batch is isolated; failures alone before an op is dropped. */
export const SERVER_ERROR_TRIES = 3
/** U8: client-side result code of an op dropped after repeated server errors. */
export const SERVER_ERROR = 'internal'
/** Presence keepalive: resend an unchanged `me` after this long (< 10 s staleness). */
export const PRESENCE_KEEPALIVE_MS = 3000
/** Body limit of a keepalive fetch (browser limit 64 KiB). */
export const KEEPALIVE_MAX_BYTES = 60 * 1024
/** Resync brake. */
export const RESYNC_WINDOW_MS = 10000
export const RESYNC_BRAKE_START_MS = 2000
export const RESYNC_BRAKE_MAX_MS = 30000

/**
 * Sleep that ends early when the signal aborts.
 *
 * @param {number} ms delay
 * @param {AbortSignal} [signal] abort signal
 * @return {Promise<void>}
 */
export function defaultSleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve()
			return
		}
		const timer = setTimeout(done, Math.max(0, ms))
		function done() {
			clearTimeout(timer)
			signal?.removeEventListener?.('abort', done)
			resolve()
		}
		signal?.addEventListener?.('abort', done, { once: true })
	})
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export class SyncClient {
	/**
	 * @param {object} o options
	 * @param {object} o.transport userTransport or guestTransport
	 * @param {import('./Replica.js').Replica} o.replica replica
	 * @param {string} o.client client id
	 * @param {() => object|null} [o.getPresence] own presence (me) or null
	 * @param {() => object|null} [o.getHiddenPresence] own presence while the tab is hidden (R22: the
	 *   presenting tab's {v}), null: no me
	 * @param {boolean} [o.viewOnly] view-only device: the tick runs at viewMs; getPresence() is still asked
	 *   (SPEC-M1 §6.4: the presenting tab sends {v} there), a keepalive flush never carries me
	 * @param {(items: object[], removed: string[]) => void} [o.onChanges] server changes
	 * @param {(acks: object) => void} [o.onAcks] acks of the own batch
	 * @param {(cursor: number) => void} [o.onSettled] new cursor
	 * @param {(map: object) => void} [o.onPresence] presence of the others
	 * @param {(s: string, reason: (string|null)) => void} [o.onStatus] online|offline|resyncing|gone|revoked|logged_out|reload|rate_limited;
	 *   reason RATE_LIMITED with 'revoked' after a re-join answered by an app 429, else null
	 * @param {() => Promise<number>} [o.onResync] reloads the snapshot, returns the new cursor
	 * @param {(me: object) => void} [o.onPresenceSent] `me` reached the server
	 * @param {() => (string|null)} [o.getEpoch] board epoch for `ep` (every request)
	 * @param {() => (string|null)} [o.getRole] access level for `role` (owner|moderate|edit|vote|view), null: omitted
	 * @param {() => (number|null)} [o.getVoteTally] `vt` (moderators only, stage 3), null: omitted
	 * @param {(board: object) => void} [o.onMeta] board metadata {title?, meta?, metaRev} of the answer
	 * @param {(me: {role: string, mod: boolean}) => void} [o.onRole] new effective role (stage 2)
	 * @param {(votes: object) => void} [o.onVotes] votes block (stage 3), after onAcks
	 * @param {(c: {now: number, t0: number, t1: number}) => void} [o.onClock] server time of a 2xx answer;
	 *   t0/t1 = o.now() around the request
	 * @param {() => number} [o.now] monotonic clock
	 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [o.sleep] sleep
	 * @param {object} [o.intervals] scheduler intervals
	 * @param {() => number} [o.rand] random source
	 */
	constructor({
		transport,
		replica,
		client,
		getPresence = () => null,
		getHiddenPresence = () => null,
		viewOnly = false,
		onChanges = () => {},
		onAcks = () => {},
		onSettled = () => {},
		onPresence = () => {},
		onStatus = () => {},
		onResync = null,
		onPresenceSent = () => {},
		getEpoch = () => null,
		getRole = () => null,
		getVoteTally = () => null,
		onMeta = () => {},
		onRole = () => {},
		onVotes = () => {},
		onClock = () => {},
		now = defaultNow,
		sleep = defaultSleep,
		intervals = INTERVALS,
		rand = Math.random,
	}) {
		this.transport = transport
		this.replica = replica
		this.client = client
		this.getPresence = getPresence
		this.getHiddenPresence = getHiddenPresence
		this.viewOnly = !!viewOnly
		this.onChanges = onChanges
		this.onAcks = onAcks
		this.onSettled = onSettled
		this.onPresence = onPresence
		this.onStatus = onStatus
		this.onResync = onResync ?? (async () => this._cursor)
		this.onPresenceSent = onPresenceSent
		this.getEpoch = getEpoch
		this.getRole = getRole
		this.getVoteTally = getVoteTally
		this.onMeta = onMeta
		this.onRole = onRole
		this.onVotes = onVotes
		this.onClock = onClock
		this.now = now
		this.sleep = sleep
		this.intervals = intervals
		this.rand = rand

		this.running = false
		this._cursor = 0
		this.status = null
		/** The answer behind a final status when the shell needs it (the password lock-out, R13). */
		this.finalError = null
		/** Set by _final(): the loop ended for good (no keepalive flush either). */
		this.finalStatus = null
		this.failures = 0
		this.more = false
		this.hidden = false
		this.remoteDragging = false
		this.t0 = -Infinity
		this.lastLocalAt = -Infinity
		this.lastRemoteAt = -Infinity
		this.jitter = 0.5
		this.waitUntil = null
		this.forceNext = false
		this.pokeFloor = -Infinity
		this.lastMeJson = null
		this.lastMeAt = -Infinity
		/** The me candidate of the last request that went out (getPresence(), before the keepalive filter). */
		this.sentMe = null
		this.joinTried = false
		/** slow_down answers in a row (join, snapshot, /sync): the wait doubles. */
		this.slowStreak = 0
		/** 401 answers on /sync with no 2xx in between (signed-in, R21): the first is bridged, the second is final. */
		this.unauthorizedStreak = 0
		/** Server protocol of the last 409 or join answer with another protocol (SPEC-M1 §4.3). */
		this.serverProto = null
		/** busy (write budget): the in-flight batch waits until then; reads go on. */
		this.busyUntil = -Infinity
		this.resyncStreak = 0
		this.lastResyncAt = -Infinity
		this.busy = false
		this.ticks = 0
		this.cursorEpoch = 0
		this.wakeCtl = null
		this.stopCtl = null
		this.loopPromise = null
		// U8 isolation state
		/** The previous request was answered with 2xx (evidence that the server works). */
		this.lastOk = true
		/** Consecutive 500 answers of the current batch: {seq, ops, n} or null. */
		this.err500 = null
		/** Ops of a batch that failed SERVER_ERROR_TRIES times (identity). */
		this.suspects = new WeakSet()
		/** Failures of a single op, each right after a successful request. */
		this.strikes = new WeakMap()
		/** Ops that were set aside at least once: a keepalive flush leaves them out. */
		this.isolated = new WeakSet()
	}

	/** @return {number} confirmed cursor (last applied server rev) */
	get cursor() {
		return this._cursor
	}

	/**
	 * Starts the loop; the first request goes out at once.
	 *
	 * @param {number} cursor rev of the loaded snapshot
	 */
	start(cursor) {
		if (this.running) {
			return
		}
		this._cursor = cursor
		this.finalStatus = null
		this.busyUntil = -Infinity
		this.running = true
		this.stopCtl = typeof AbortController === 'function' ? new AbortController() : null
		this.forceNext = true
		this.loopPromise = this._loop()
	}

	/** Stops the loop; an answer still on the wire is ignored. */
	stop() {
		this.running = false
		this.wakeCtl?.abort()
		this.stopCtl?.abort()
	}

	/**
	 * Own ops: into the replica, then wake the loop (urgent ops go out at the
	 * latest commitGapMs after the start of the previous request).
	 *
	 * @param {object[]} ops ops
	 * @param {{urgent?: boolean}} [o] urgency
	 * @return {Set<string>} affected ids
	 */
	enqueue(ops, { urgent = true } = {}) {
		const ids = this.replica.addLocal(ops, { urgent })
		this.lastLocalAt = this.now()
		this._wake()
		return ids
	}

	/** User activity: switches to the active cadence, never sends before t0 + activeMs. */
	poke() {
		this.lastLocalAt = this.now()
		this.pokeFloor = Math.max(this.pokeFloor, this.t0 + this.intervals.activeMs)
		this._wake()
	}

	/**
	 * @param {boolean} hidden tab hidden (visibilitychange)
	 */
	setHidden(hidden) {
		const was = this.hidden
		this.hidden = !!hidden
		if (was && !this.hidden) {
			this.forceNext = true
		}
		this._wake()
	}

	/** @param {boolean} dragging someone else is dragging (active cadence) */
	setRemoteDragging(dragging) {
		this.remoteDragging = !!dragging
	}

	/** Browser came back online: end a failure backoff now. */
	retryNow() {
		if (this.failures > 0 || this.waitUntil !== null) {
			this.waitUntil = null
			this.forceNext = true
			this._wake()
		}
	}

	/** Next request at once (debug; BoardSession.prepareLeave). */
	forceTick() {
		this.forceNext = true
		this._wake()
	}

	/**
	 * Debug: overwrite the cursor (E08 provokes a resync this way).
	 *
	 * @param {number} n new cursor
	 */
	setCursor(n) {
		if (Number.isInteger(n) && n >= 0) {
			this._cursor = n
			// An answer already on the wire belongs to the old cursor: it must
			// not overwrite this one.
			this.cursorEpoch++
		}
	}

	/**
	 * Sends the unacknowledged ops once with fetch keepalive (pagehide, tab
	 * hidden). At most 60 KiB of body and at most MAX_OPS ops (the server
	 * rejects a larger request as a whole, T16): only as many ops as fit, in
	 * send order, the in-flight batch first (resending it is idempotent, and
	 * skipping it could reorder ops on the same id). One attempt, no 412
	 * retry. The ops stay in the replica (if the page lives on, the normal
	 * loop sends them again); the queued ones that went out are marked as
	 * maybe sent, so later ops are never compacted into them (T15). Ops the
	 * loop set aside after server errors (U8), and everything waiting behind
	 * them, stay out: one of them would fail the whole keepalive.
	 *
	 * @return {number} number of ops sent
	 */
	flushKeepalive() {
		if (!this.transport || this.finalStatus !== null || this.replica.pendingCount() === 0) {
			return 0
		}
		const all = this.replica.pendingOps()
		const pending = { seq: all.seq, ops: Replica.withoutDependents(all.ops, all.ops.filter((op) => this.isolated.has(op))) }
		const body = this._baseBody(0)
		body.seq = pending.seq
		body.ops = []
		if (!this.viewOnly) {
			// A take-over that has not reached the server yet must precede its
			// text (presence is written before the ops of the same request).
			let me = null
			try {
				me = this.getPresence()
			} catch (e) {
				me = null
			}
			if (me && me.tk === 1) {
				body.me = me
			}
		}
		const size = (v) => utf8Length(JSON.stringify(v))
		let total = size(body)
		for (const op of pending.ops) {
			const s = size(op) + 1
			if (body.ops.length >= MAX_OPS || total + s > KEEPALIVE_MAX_BYTES) {
				break
			}
			body.ops.push(op)
			total += s
		}
		if (body.ops.length === 0) {
			return 0
		}
		this.replica.markMaybeSent(body.ops)
		try {
			const p = this.transport.sync(body, { keepalive: true })
			if (p && typeof p.catch === 'function') {
				p.catch(() => {})
			}
		} catch (e) {
			// one attempt only
		}
		return body.ops.length
	}

	/** Recompute the delay (enqueue, poke, visibility, debug). */
	_wake() {
		this.wakeCtl?.abort()
	}

	/** @return {number} ms until the next request */
	_delay() {
		const now = this.now()
		if (this.forceNext) {
			return 0
		}
		if (this.waitUntil !== null) {
			return Math.max(0, this.waitUntil - now)
		}
		// busy: the in-flight batch waits for busyUntil; until then the loop only
		// reads, at the normal cadence (urgent ops cannot go out earlier anyway)
		const busyHold = this.busyUntil > now && this.replica.hasInflight()
		const state = {
			t0: this.t0,
			lastLocalAt: this.lastLocalAt,
			lastRemoteAt: this.lastRemoteAt,
			remoteDragging: this.remoteDragging,
			hidden: this.hidden,
			viewOnly: this.viewOnly,
			failures: 0,
			more: this.more,
			urgent: busyHold ? false : this.replica.hasUrgent(),
		}
		let d = nextDelay(state, now, this.intervals, () => this.jitter)
		if (!state.more && !state.urgent && this.pokeFloor > now) {
			d = Math.max(d, this.pokeFloor - now)
		}
		if (busyHold) {
			d = Math.min(d, this.busyUntil - now)
		}
		return d
	}

	/**
	 * Fields every request carries (also a keepalive flush).
	 *
	 * @param {0|1} pres presence wanted
	 * @return {object} {proto, client, since, ep, role?, pres}
	 */
	_baseBody(pres) {
		const body = { proto: PROTOCOL, client: this.client, since: this._cursor, ep: this._epoch(), pres }
		const role = this._ask(this.getRole)
		if (typeof role === 'string' && ACCESS_LEVELS.includes(role)) {
			body.role = role
		}
		return body
	}

	/** @return {string} the epoch for `ep`; DEFAULT_EPOCH when none (valid) is known */
	_epoch() {
		const ep = this._ask(this.getEpoch)
		return typeof ep === 'string' && EPOCH_RE.test(ep) ? ep : DEFAULT_EPOCH
	}

	/**
	 * @param {Function} fn getter of the session
	 * @return {unknown} its value, null when it throws
	 */
	_ask(fn) {
		try {
			return fn()
		} catch (e) {
			console.error('[knorke] sync getter failed', e)
			return null
		}
	}

	/**
	 * Calls a callback of the session; a throwing callback is logged and never
	 * counts as a failed request (the answer itself was fine).
	 *
	 * @param {Function} fn callback
	 * @param {unknown} arg argument
	 */
	_emit(fn, arg) {
		try {
			fn(arg)
		} catch (e) {
			console.error('[knorke] sync callback failed', e)
		}
	}

	async _waitNext() {
		while (this.running) {
			const d = this._delay()
			if (d <= 0) {
				return
			}
			this.wakeCtl = typeof AbortController === 'function' ? new AbortController() : null
			const signal = this.wakeCtl?.signal
			await this.sleep(d, signal)
			if (!signal || !signal.aborted) {
				return
			}
		}
	}

	async _loop() {
		while (this.running) {
			await this._waitNext()
			if (!this.running) {
				break
			}
			try {
				await this._tick()
			} catch (e) {
				// A callback threw: never let the loop die silently.
				console.error('[knorke] sync tick failed', e)
				this._fail()
			}
		}
	}

	async _tick() {
		this.t0 = this.now()
		this.waitUntil = null
		this.forceNext = false
		this.pokeFloor = -Infinity
		this.jitter = this.rand()
		const body = this._baseBody(this.hidden ? 0 : 1)
		const vt = this._ask(this.getVoteTally)
		if (Number.isInteger(vt) && vt >= 0) {
			body.vt = vt
		}
		let takeover = false
		let candidate = null
		// R22 (P7-09): a hidden tab asks only for the presenting tab's {v}
		const me = this._ask(this.hidden ? this.getHiddenPresence : this.getPresence)
		if (me && typeof me === 'object') {
			candidate = me
			const json = JSON.stringify(me)
			takeover = me.tk === 1
			// A take-over always goes out, even when the same `me` was sent before.
			if (takeover || json !== this.lastMeJson || this.t0 - this.lastMeAt >= PRESENCE_KEEPALIVE_MS) {
				body.me = me
			}
		}
		// A take-over (me.tk) travels ALONE: the ops follow in the next request,
		// right after the answer. The server writes presence before the ops of
		// one request, but another participant's request that read the lease
		// just before could still commit its text after ours; one round trip
		// between the take-over and the own text closes that window.
		// busy (write budget): the batch waits for busyUntil, this request only reads
		const batch = takeover || this.busyUntil > this.t0 ? null : this.replica.takeBatch(MAX_OPS)
		if (batch) {
			body.seq = batch.seq
			body.ops = batch.ops
		}
		let res
		const epoch = this.cursorEpoch
		const prevOk = this.lastOk
		// __knorke.sentPresence() (SPEC-M1 §6.7): the candidate of this request, sent now
		this.sentMe = candidate === null ? null : structuredClone(candidate)
		this.busy = true
		try {
			res = await this.transport.sync(body)
		} catch (e) {
			this.busy = false
			if (!this.running) {
				return
			}
			this.lastOk = false
			if (batch) {
				this.replica.failInflight()
			}
			await this._onError(e, batch, prevOk, true)
			return
		} finally {
			this.busy = false
		}
		if (!this.running) {
			return
		}
		const t1 = this.now()
		this.lastOk = true
		this.err500 = null
		this.slowStreak = 0
		if (body.me) {
			this.lastMeJson = JSON.stringify(body.me)
			this.lastMeAt = this.t0
			this.onPresenceSent(body.me)
		}
		if (takeover && this.replica.pendingCount() > 0) {
			// the ops held back behind the take-over go out at once
			this.forceNext = true
		}
		this.failures = 0
		this.unauthorizedStreak = 0
		this.joinTried = false
		this._setStatus('online')
		res = res ?? {}
		if (Number.isFinite(res.now)) {
			this._emit(this.onClock, { now: res.now, t0: this.t0, t1 })
		}
		if (res.acks) {
			this.onAcks(res.acks)
			if (batch) {
				this._busy(res.acks, batch)
			}
		}
		if (res.board && typeof res.board === 'object') {
			// before onChanges, and also when the answer asks for a resync
			this._emit(this.onMeta, res.board)
		}
		if (res.me && typeof res.me === 'object') {
			this._emit(this.onRole, res.me)
		}
		if (res.votes !== undefined && res.votes !== null) {
			// SPEC-M1 §6.4 (R16): after onAcks and after onMeta of the same answer
			this._emit(this.onVotes, res.votes)
		}
		if (this.replica.releaseHeld()) {
			// U8: the server works; the oldest op set aside goes out again, alone
			this.forceNext = true
		}
		if (epoch !== this.cursorEpoch) {
			// The cursor was set (debug) while this request was open: keep it.
			if (res.presence !== undefined) {
				this.onPresence(res.presence)
			}
			this.more = false
			this.ticks++
			return
		}
		const rev = Number.isInteger(res.rev) ? res.rev : null
		if (res.resync === true || (rev !== null && rev < body.since)) {
			if (res.presence !== undefined) {
				this.onPresence(res.presence)
			}
			this.more = false
			await this._resync()
			this.ticks++
			return
		}
		const items = Array.isArray(res.items) ? res.items : []
		const removed = Array.isArray(res.removed) ? res.removed : []
		if (items.length > 0 || removed.length > 0) {
			this.lastRemoteAt = this.now()
		}
		this.onChanges(items, removed)
		if (rev !== null) {
			this._cursor = rev
			this.onSettled(rev)
		}
		if (res.presence !== undefined) {
			this.onPresence(res.presence)
		}
		this.more = res.more === true
		this.ticks++
	}

	/**
	 * busy acks (SPEC-M1 §4.6): every op of the batch came back 'busy', the
	 * server applied nothing. The replica keeps the batch in flight (same seq);
	 * it goes out again after acks.retryMs × (1 + 0–20 % random). failures and
	 * the status stay as they are.
	 *
	 * @param {{seq: number, res: string[], retryMs?: number}} acks acks of the answer
	 * @param {{seq: number, ops: object[]}} batch the batch of the request
	 */
	_busy(acks, batch) {
		const all = acks.seq === batch.seq && Array.isArray(acks.res) && acks.res.length > 0 && acks.res.every((c) => c === BUSY)
		if (!all) {
			this.busyUntil = -Infinity
			return
		}
		this.replica.failInflight()
		const retry = Number.isFinite(acks.retryMs) && acks.retryMs >= 0 ? Math.min(acks.retryMs, BUSY_RETRY_MAX_MS) : BUSY_RETRY_MS
		this.busyUntil = this.now() + retry * (1 + this.rand() * 0.2)
	}

	async _resync() {
		const start = this.now()
		if (start - this.lastResyncAt > RESYNC_WINDOW_MS) {
			this.resyncStreak = 0
		}
		this.resyncStreak++
		this._setStatus('resyncing')
		if (this.resyncStreak >= 3) {
			const wait = Math.min(RESYNC_BRAKE_MAX_MS, RESYNC_BRAKE_START_MS * 2 ** (this.resyncStreak - 3))
			await this.sleep(wait, this.stopCtl?.signal)
			if (!this.running) {
				return
			}
		}
		let cursor
		for (let slow = 0, blocked = 0; ;) {
			try {
				cursor = await this.onResync()
				break
			} catch (e) {
				if (isProxyBlock(e) && this.running) {
					// SPEC-M1 §6.4 (R22, P7-07): a proxy or firewall 403/404 on the
					// snapshot is never final; again after a growing wait, the status
					// stays 'resyncing'
					blocked++
					await this.sleep(this._blockDelay(blocked), this.stopCtl?.signal)
					if (!this.running) {
						return
					}
					continue
				}
				if (isSlowDown(e) && this.running) {
					// SPEC-M1 §6.4 (R2): the snapshot is throttled – wait and repeat,
					// the status stays 'resyncing' (never final, the tab does not freeze)
					slow++
					await this.sleep(slowDownDelay(e, slow, this.rand), this.stopCtl?.signal)
					if (!this.running) {
						return
					}
					continue
				}
				this.lastResyncAt = this.now()
				if (this.running) {
					await this._onError(e, null)
				}
				return
			}
		}
		this.lastResyncAt = this.now()
		if (!this.running) {
			return
		}
		if (Number.isInteger(cursor)) {
			this._cursor = cursor
		}
		this._setStatus('online')
	}

	/**
	 * @param {unknown} e error of the request (or of the resync)
	 * @param {{seq:number, ops:object[]}|null} batch batch of the failed request
	 * @param {boolean} [prevOk] the request before this one was answered with 2xx
	 * @param {boolean} [onSync] the error came from /sync in the loop (_tick), not from a resync snapshot
	 */
	async _onError(e, batch, prevOk = false, onSync = false) {
		if (isProxyRetry(e)) {
			const wait = e.retryAfterMs ?? (2000 + this.rand() * 8000)
			this.waitUntil = this.now() + wait
			return
		}
		if (isSlowDown(e)) {
			// not expected on /sync (SPEC-M1 §6.4); if it comes: wait, never final
			this.slowStreak++
			this.waitUntil = this.now() + slowDownDelay(e, this.slowStreak, this.rand)
			return
		}
		if (isProxyBlock(e)) {
			// SPEC-M1 §6.4 (R22, P7-07): 403/404 without the app body came from a
			// proxy or firewall: the failure path like 0/5xx (the batch stays in
			// flight with the same seq, offline from the second failure, backoff),
			// never final and never isolated (U8 counts only 500)
			this._fail()
			return
		}
		const status = e instanceof HttpError ? e.status : 0
		const code = e instanceof HttpError ? e.code : 'network'
		if (status === 404) {
			this._final('gone')
			return
		}
		if (status === 401) {
			if (this.transport.kind !== 'guest') {
				if (onSync && this.unauthorizedStreak === 0) {
					// SPEC-M1 §1.2 (R21): bridge one 401 like a transient failure
					// (the batch stays in flight, backoff); only a second one with
					// no 2xx in between signs out
					this.unauthorizedStreak = 1
					this._fail()
					return
				}
				this._final('logged_out')
				return
			}
			await this._rejoin('token')
			return
		}
		if (status === 403) {
			if (code === 'link_revoked' && this.transport.kind === 'guest') {
				await this._rejoin('revoked')
				return
			}
			this._final(finalOf403(code))
			return
		}
		if (status === 409) {
			this.serverProto = protoOf(e)
			this._final('reload')
			return
		}
		if (status === 413) {
			if (!this.replica.splitInflight() && batch) {
				// A single op that is too large can never pass: drop it.
				this.onAcks({ seq: batch.seq, rev: null, res: batch.ops.map(() => 'bad') })
			}
			this.forceNext = true
			return
		}
		if (status === 400) {
			if (batch) {
				this.onAcks({ seq: batch.seq, rev: null, res: batch.ops.map(() => 'bad') })
			}
			await this._resync()
			return
		}
		if (status === 429 && e instanceof HttpError && e.fromApp) {
			// App rate limit (R3): its own final status, never repeated
			// automatically. The board is not gone; the banner says so.
			this._final(RATE_LIMITED)
			return
		}
		this._fail()
		if (status === 500 && batch) {
			this._isolate(batch, prevOk)
		}
	}

	/**
	 * U8: a request with ops was answered with 500 (see the file comment).
	 *
	 * @param {{seq:number, ops:object[]}} batch the failed batch (the in-flight one)
	 * @param {boolean} prevOk the request before was answered with 2xx
	 */
	_isolate(batch, prevOk) {
		const ops = batch.ops
		if (!ops.some((op) => this.suspects.has(op))) {
			const same = this.err500 !== null && this.err500.seq === batch.seq && this.err500.ops === ops
			this.err500 = { seq: batch.seq, ops, n: same ? this.err500.n + 1 : 1 }
			if (this.err500.n < SERVER_ERROR_TRIES) {
				return
			}
			for (const op of ops) {
				this.suspects.add(op)
			}
		}
		this.err500 = null
		if (ops.length > 1) {
			this.replica.splitInflight({ maybeSent: true })
			// bisect at the pace of the first backoff step, not the growing one
			this.waitUntil = this.now() + this.intervals.backoffMs[0]
			return
		}
		const op = ops[0]
		if (prevOk) {
			const n = (this.strikes.get(op) ?? 0) + 1
			this.strikes.set(op, n)
			if (n >= SERVER_ERROR_TRIES) {
				this.onAcks({ seq: batch.seq, rev: null, res: [SERVER_ERROR] })
				return
			}
		}
		this.isolated.add(op)
		this.replica.holdInflight()
	}

	/**
	 * Guest token rejected (401) or the link generation changed (403
	 * link_revoked): exactly one re-join per failure streak (see the file
	 * comment for the mapping, SPEC-M1 §6.4).
	 *
	 * @param {'token'|'revoked'} trigger what the sync was answered with
	 */
	async _rejoin(trigger) {
		if (this.joinTried || typeof this.transport.join !== 'function') {
			this._final(trigger === 'revoked' ? 'revoked' : 'gone')
			return
		}
		this.joinTried = true
		let res
		for (let slow = 0, blocked = 0; ;) {
			try {
				res = await this.transport.join(null)
				break
			} catch (j) {
				if (!this.running) {
					return
				}
				if (isProxyBlock(j)) {
					// SPEC-M1 §6.4 (R22, P7-07): the same one attempt again after a
					// growing wait; never final
					blocked++
					await this.sleep(this._blockDelay(blocked), this.stopCtl?.signal)
					if (!this.running) {
						return
					}
					continue
				}
				if (isPasswordLock(j)) {
					// SPEC-M1 §6.4 (R13): the password lock-out is never repeated
					// automatically; the guest view hands over to the password phase,
					// which shows the lock-out text (reason PASSWORD_LOCK, the answer
					// stays in finalError for its retryMs)
					this.finalError = j
					this._final(PASSWORD_REQUIRED, PASSWORD_LOCK)
					return
				}
				if (isSlowDown(j)) {
					// SPEC-M1 §6.4 (R2): wait (doubling up to 60 s), then the same
					// one attempt again; never final
					slow++
					await this.sleep(slowDownDelay(j, slow, this.rand), this.stopCtl?.signal)
					if (!this.running) {
						return
					}
					continue
				}
				this._joinFailed(j)
				return
			}
		}
		if (!this.running) {
			return
		}
		if (res?.proto !== PROTOCOL) {
			// the join answer is a snapshot: another protocol counts as a 409 (§4.3)
			this.serverProto = protoValue(res?.proto)
			this._final('reload')
			return
		}
		this.forceNext = true
	}

	/**
	 * A re-join failed for good or for now (see the file comment).
	 *
	 * @param {unknown} j error of the join
	 */
	_joinFailed(j) {
		if (isProxyRetry(j)) {
			this.joinTried = false
			this.waitUntil = this.now() + (j.retryAfterMs ?? (2000 + this.rand() * 8000))
			return
		}
		const st = j instanceof HttpError ? j.status : 0
		if (st === 0 || st === 411 || st >= 500) {
			// The join never got a real answer: allow another one later.
			this.joinTried = false
			this._fail()
			return
		}
		if (st === 403 && j.code !== 'link_revoked') {
			const final = finalOf403(j.code)
			if (final !== 'gone') {
				this._final(final)
				return
			}
		}
		this._final('revoked', st === 429 && j.fromApp ? RATE_LIMITED : null)
	}

	/**
	 * Wait before repeating a snapshot or join a proxy or firewall answered
	 * with 403/404 (R22, P7-07): the failure backoff 1/2/4/8/15 s × (1 + 0–20 %),
	 * then 15 s every time.
	 *
	 * @param {number} n 1 for the first blocked answer of the streak, 2 for the next …
	 * @return {number} delay in ms
	 */
	_blockDelay(n) {
		return nextDelay({ failures: Math.max(1, n), more: false }, this.now(), this.intervals, this.rand)
	}

	/** Transient failure: count, report offline from the second one, back off. */
	_fail() {
		this.failures++
		if (this.failures >= 2) {
			this._setStatus('offline')
		}
		const d = nextDelay({ failures: this.failures, more: false }, this.now(), this.intervals, this.rand)
		this.waitUntil = this.now() + d
	}

	/**
	 * @param {string} status final status (FINAL_STATUSES); the loop stops for good
	 * @param {string|null} [reason] why (RATE_LIMITED), for the banner text
	 */
	_final(status, reason = null) {
		this.finalStatus = status
		this._setStatus(status, reason)
		this.stop()
	}

	/**
	 * @param {string} status new status (reported on change only)
	 * @param {string|null} [reason] detail of a final status (RATE_LIMITED) or null
	 */
	_setStatus(status, reason = null) {
		if (this.status === status) {
			return
		}
		this.status = status
		try {
			this.onStatus(status, reason)
		} catch (e) {
			console.error('[knorke] onStatus failed', e)
		}
	}
}

/**
 * Final status of a 403 on /sync or on a guest re-join (SPEC-M1 §4.2, §6.4).
 *
 * @param {string} code app error code
 * @return {string} final status
 */
export function finalOf403(code) {
	switch (code) {
	case 'link_revoked':
		return 'revoked'
	case LINKS_DISABLED:
		return LINKS_DISABLED
	case LINK_EXPIRED:
		return LINK_EXPIRED
	case 'password_required':
	case 'password_wrong':
		return PASSWORD_REQUIRED
	default:
		return 'gone'
	}
}

/**
 * @param {unknown} v `proto` of an answer
 * @return {number|string} the server protocol, UNKNOWN_PROTO when it is missing
 */
export function protoValue(v) {
	return Number.isInteger(v) || (typeof v === 'string' && v !== '' && v.length <= 16) ? v : UNKNOWN_PROTO
}

/**
 * @param {unknown} e error of a 409
 * @return {number|string} server protocol of the 409 body (SPEC-M1 §4.2), '?' when missing
 */
export function protoOf(e) {
	return protoValue(e instanceof HttpError ? e.body?.proto : undefined)
}

/**
 * @param {string} s string
 * @return {number} UTF-8 byte length
 */
function utf8Length(s) {
	return new TextEncoder().encode(s).length
}
