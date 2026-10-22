/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * VoteState (SPEC-M1 §6.5.5, stage 3): the client's view of the dot vote.
 * Pure (no DOM, no texts, no timers), so every rule is checked in Node.
 *
 * Sources:
 * - meta.vote (§3.11) through setSession(): sid, state, cfg {per, perItem,
 *   scope, types}, startedAt, endsAt, by, show and, after the close, results,
 *   total, voters, closedAt. A new sid resets mine, left, vt and voters
 *   (R2, R16 SRV-01: vt = 0 and voters = 0); meta.vote missing → no session.
 * - the votes blocks of snapshot/join (setMine) and of sync answers (ack):
 *   {sid, mine, left} for the own votes (mine = item id → n ≥ 1, an empty
 *   map is {}), {sid, voters, vt} for moderators. A block whose sid is not
 *   the sid of meta.vote is dropped (R16 SRV-03): the next tick brings it
 *   again.
 *
 * Own votes are optimistic: propose() checks the budget locally and keeps
 * the proposal as PENDING until the server state that contains it arrives.
 * mine/left = the last server state with the pending proposals on top
 * ("Server-Stand gewinnt": ack() replaces the server part, and the session
 * passes the vote ops that are still queued or in flight, so a later click
 * is not undone by the answer to an earlier one). left from the server
 * counts only live items (R16 SRV-06); a pending change moves it by its
 * difference.
 *
 * propose(id, n, nowMs, {tap}) → {ok, reason}: 'closed' (no open session,
 * or past endsAt), 'limit' (n > perItem, or more than per in all), 'repeat'
 * (only with tap, R22 P7-10: the toggle tap on the canvas at perItem = 1 for
 * the same item again within REPEAT_MS of the last tap: a double tap must
 * not take the vote back, R2), else ok. The vote list and the stepper
 * propose without tap: two quick "+" are two votes, and the second one that
 * goes over the budget says so ('limit', B14). (R17 K1) Only an increase checks the
 * budget: lowering or keeping a number never answers 'limit', also when the
 * voter is overdrawn (an undo revived voted items, B1). The budget is never
 * more than per, so an overdrawn voter who lowered one item still cannot
 * raise another one until the sum is below per again (as the server).
 *
 * badges() (R16, values exactly as SceneVoteState §6.3): Map<id, {mine,
 * total}> with integers ≥ 0 and total an integer or null (never undefined):
 * while open the own votes (total null); after the close, when the results
 * are shown on the board (meta.vote.show), the totals (mine 0). votable(item)
 * is a real boolean (S-13); missReason(item) says why an item cannot get
 * votes ('type' before 'scope': a tap on the scope frame itself names the
 * type, not the frame).
 */

/** Item types that can ever get votes (registry `votable`, §4.8). */
export const VOTABLE_TYPES = Object.freeze(['sticky', 'shape', 'text'])
/** A second canvas tap on the same item within this time is a double tap (R2; taps only, R22). */
export const REPEAT_MS = 400
/** Most votes per person and per item (VOTE_PER_MAX, §4.8). */
export const VOTE_PER_MAX = 99

/**
 * @param {unknown} v value
 * @return {boolean} an integer ≥ 0
 */
const isCount = (v) => Number.isInteger(v) && v >= 0

/**
 * @param {unknown} v value
 * @return {boolean} a plain map (also the empty list PHP may send for {})
 */
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * @param {unknown} m `mine` of a votes block
 * @return {Record<string, number>|null} item id → n ≥ 1, null when not a map ([] counts as {})
 */
export function mineOf(m) {
	if (Array.isArray(m) && m.length === 0) {
		return {}
	}
	if (!isMap(m)) {
		return null
	}
	const out = {}
	for (const [id, n] of Object.entries(m)) {
		if (typeof id === 'string' && Number.isInteger(n) && n >= 1) {
			out[id] = n
		}
	}
	return out
}

/**
 * @param {unknown} cfg meta.vote.cfg
 * @return {{per: number, perItem: number, scope: (string|null), types: string[]}} with the §4.12.1 defaults
 */
export function cfgOf(cfg) {
	const c = isMap(cfg) ? cfg : {}
	const per = Number.isInteger(c.per) && c.per >= 1 ? Math.min(c.per, VOTE_PER_MAX) : 5
	const perItem = Number.isInteger(c.perItem) && c.perItem >= 1 ? Math.min(c.perItem, per) : 1
	const scope = typeof c.scope === 'string' && c.scope !== '' ? c.scope : null
	const types = Array.isArray(c.types) ? c.types.filter((t) => VOTABLE_TYPES.includes(t)) : []
	return { per, perItem, scope, types: types.length > 0 ? [...new Set(types)] : ['sticky'] }
}

/**
 * @param {unknown} r meta.vote.results
 * @return {Array<[string, number]>|null} [[id, n], …] (descending as sent), null when missing
 */
function resultsOf(r) {
	if (!Array.isArray(r)) {
		return null
	}
	const out = []
	for (const e of r) {
		if (Array.isArray(e) && typeof e[0] === 'string' && isCount(e[1])) {
			out.push([e[0], e[1]])
		}
	}
	return out
}

export class VoteState {
	constructor() {
		this.reset()
	}

	/** No session (meta.vote missing). */
	reset() {
		/** @type {number|null} */
		this._sid = null
		/** @type {'open'|'closed'|null} */
		this._state = null
		this._cfg = cfgOf(null)
		this._endsAt = null
		this._startedAt = null
		this._by = ''
		this._show = false
		this._results = null
		this._total = null
		this._closedVoters = null
		this._closedAt = null
		this.resetCounts()
	}

	/** Own votes, tally progress and the double-tap memory of the current sid start from zero. */
	resetCounts() {
		/** Last server state of the own votes (item id → n ≥ 1). */
		this._serverMine = {}
		/** Server left, null until a votes block or snapshot said it. */
		this._serverLeft = null
		/** Proposals the server has not confirmed yet (item id → n). */
		this._pending = new Map()
		this._vt = 0
		this._voters = 0
		/** {id, at} of the last proposal (double tap). */
		this._last = null
	}

	/**
	 * Takes meta.vote (§3.11). A new sid resets mine, left, vt and voters.
	 *
	 * @param {object|undefined|null} metaVote meta.vote, missing = no session
	 * @param {object|null} [me] {pid, mod} of this client (kept for the moderator part)
	 * @return {{changed: boolean, newSid: boolean, opened: boolean, closed: boolean, cleared: boolean}}
	 *   opened: this sid is open now and was not before; closed: this sid turned closed
	 */
	setSession(metaVote, me = null) {
		this._me = me && typeof me === 'object' ? me : null
		const before = { sid: this._sid, state: this._state, endsAt: this._endsAt, show: this._show, results: this._results }
		if (!isMap(metaVote) || !Number.isInteger(metaVote.sid) || metaVote.sid < 1) {
			const had = this._sid !== null
			this.reset()
			return { changed: had, newSid: false, opened: false, closed: false, cleared: had }
		}
		const newSid = metaVote.sid !== this._sid
		if (newSid) {
			this._sid = metaVote.sid
			this.resetCounts()
		}
		this._state = metaVote.state === 'closed' ? 'closed' : metaVote.state === 'open' ? 'open' : null
		this._cfg = cfgOf(metaVote.cfg)
		this._endsAt = Number.isFinite(metaVote.endsAt) ? metaVote.endsAt : null
		this._startedAt = Number.isFinite(metaVote.startedAt) ? metaVote.startedAt : null
		this._by = typeof metaVote.by === 'string' ? metaVote.by : ''
		this._show = metaVote.show === true
		this._results = this._state === 'closed' ? (resultsOf(metaVote.results) ?? []) : null
		this._total = this._state === 'closed' && isCount(metaVote.total) ? metaVote.total : null
		this._closedVoters = this._state === 'closed' && isCount(metaVote.voters) ? metaVote.voters : null
		this._closedAt = this._state === 'closed' && Number.isFinite(metaVote.closedAt) ? metaVote.closedAt : null
		if (this._state !== 'open') {
			// the server deleted the vote rows: no own votes, nothing pending any more
			this._pending.clear()
			this._serverMine = {}
			this._serverLeft = null
		}
		const opened = this._state === 'open' && (newSid || before.state !== 'open')
		const closed = this._state === 'closed' && !newSid && before.state === 'open'
		const changed = newSid || before.state !== this._state || before.endsAt !== this._endsAt || before.show !== this._show ||
			JSON.stringify(before.results) !== JSON.stringify(this._results)
		return { changed, newSid, opened, closed, cleared: false }
	}

	/**
	 * Own votes of a snapshot/join answer: {sid, mine, left}. Dropped when
	 * the sid is not the current one.
	 *
	 * @param {number} sid session of the block
	 * @param {unknown} mine item id → n ≥ 1 ({} when empty)
	 * @param {unknown} left votes left
	 * @return {boolean} taken
	 */
	setMine(sid, mine, left) {
		if (this._sid === null || sid !== this._sid) {
			return false
		}
		const m = mineOf(mine)
		if (m === null) {
			return false
		}
		this._serverMine = m
		this._serverLeft = isCount(left) ? left : null
		return true
	}

	/**
	 * A vote proposal (optimistic). The caller sends {o:'vote', s: sid, id, n} when ok.
	 *
	 * @param {string} id item id
	 * @param {number} n my new number of votes on it (0 = none)
	 * @param {number} nowMs current time (server clock: endsAt is compared with it, and the double tap)
	 * @param {{tap?: boolean}} [o] tap: the toggle tap on the canvas (perItem = 1), the only
	 *   proposal with the double-tap lock (R22, P7-10)
	 * @return {{ok: boolean, reason: ('limit'|'closed'|'repeat'|null)}}
	 */
	propose(id, n, nowMs, { tap = false } = {}) {
		if (!this.open || (this._endsAt !== null && Number.isFinite(nowMs) && nowMs >= this._endsAt)) {
			return { ok: false, reason: 'closed' }
		}
		if (typeof id !== 'string' || !Number.isInteger(n) || n < 0) {
			return { ok: false, reason: 'limit' }
		}
		if (tap && this._last && this._last.id === id && Number.isFinite(nowMs) && nowMs - this._last.at < REPEAT_MS && nowMs >= this._last.at) {
			return { ok: false, reason: 'repeat' }
		}
		const mine = this.mine
		const others = Object.entries(mine).reduce((sum, [k, v]) => (k === id ? sum : sum + v), 0)
		const now = mine[id] ?? 0
		// lowering is always allowed (a vote can be taken back even over a stale budget)
		if (n > now && (n > this._cfg.perItem || others + n > this.budget())) {
			return { ok: false, reason: 'limit' }
		}
		this._pending.set(id, n)
		if (tap) {
			this._last = { id, at: nowMs }
		}
		return { ok: true, reason: null }
	}

	/**
	 * @return {number} votes this person may hold in all: per, or – when the
	 *   server said left – what the server counts (left + server mine): items
	 *   deleted meanwhile do not count (R16 SRV-06). (R17 K1) Capped at per:
	 *   the server's left is never negative (B1), so for an overdrawn voter
	 *   left + mine is more than per and would let an increase through that
	 *   the server answers with 'limit'.
	 */
	budget() {
		if (this._serverLeft === null) {
			return this._cfg.per
		}
		const server = Object.values(this._serverMine).reduce((a, b) => a + b, 0)
		return Math.min(this._cfg.per, this._serverLeft + server)
	}

	/**
	 * Server answer (§4.5 votes block) after a request with vote ops, or after
	 * vote ops failed: the server state wins; pending = the vote ops still
	 * queued or in flight (they stay on top).
	 *
	 * @param {string[]|null} res result codes of the vote ops of this answer (or null)
	 * @param {object|null} votes votes block of the answer (or null)
	 * @param {Map<string, number>|null} [pending] item id → n of the vote ops still pending for this sid
	 * @return {{taken: boolean, limit: boolean, closed: boolean, denied: boolean}}
	 *   taken: the block belonged to this sid and was applied
	 */
	ack(res, votes, pending = null) {
		const codes = Array.isArray(res) ? res : []
		let taken = false
		if (isMap(votes) && this._sid !== null && votes.sid === this._sid) {
			taken = true
			const m = 'mine' in votes ? mineOf(votes.mine) : null
			if (m !== null) {
				this._serverMine = m
				this._serverLeft = isCount(votes.left) ? votes.left : this._serverLeft
			}
			if (isCount(votes.voters)) {
				this._voters = votes.voters
			}
			if (isCount(votes.vt)) {
				this._vt = votes.vt
			}
		}
		if (pending instanceof Map) {
			this._pending = new Map([...pending].filter(([id, n]) => typeof id === 'string' && isCount(n)))
		}
		return { taken, limit: codes.includes('limit'), closed: codes.includes('closed'), denied: codes.includes('denied') }
	}

	/**
	 * Badges for the scene (SceneVoteState.badges, §6.3 R16).
	 *
	 * @return {Map<string, {mine: number, total: (number|null)}>}
	 */
	badges() {
		const out = new Map()
		if (this._state === 'open') {
			for (const [id, n] of Object.entries(this.mine)) {
				out.set(id, { mine: n, total: null })
			}
		} else if (this._state === 'closed' && this._show && this._results) {
			for (const [id, n] of this._results) {
				if (n > 0) {
					out.set(id, { mine: 0, total: n })
				}
			}
		}
		return out
	}

	/**
	 * @param {object|null|undefined} item live item of the model
	 * @return {boolean} it can get votes in the open session (type and scope; a real boolean)
	 */
	votable(item) {
		return this._state === 'open' && !!item && typeof item === 'object' && typeof item.t === 'string' &&
			this._cfg.types.includes(item.t) && (this._cfg.scope === null || (item.parent ?? null) === this._cfg.scope)
	}

	/**
	 * @param {object|null|undefined} item item that was hit in mode vote
	 * @return {'scope'|'type'|null} why it cannot get votes; null: it can (or no item)
	 */
	missReason(item) {
		if (!item || typeof item !== 'object' || typeof item.t !== 'string') {
			return null
		}
		if (!this._cfg.types.includes(item.t)) {
			return 'type'
		}
		if (this._cfg.scope !== null && (item.parent ?? null) !== this._cfg.scope) {
			return 'scope'
		}
		return null
	}

	/** @return {number|null} sid of meta.vote */
	get sid() {
		return this._sid
	}

	/** @return {string|null} frame ULID of the voting area, null = whole board */
	get scope() {
		return this._cfg.scope
	}

	/** @return {{per: number, perItem: number, scope: (string|null), types: string[]}} settings of the session */
	get cfg() {
		return { ...this._cfg, types: [...this._cfg.types] }
	}

	/** @return {number} last seen seq of the tally of the current sid (0 after a change) */
	get vt() {
		return this._vt
	}

	/** @return {number|null} distinct voters: live (moderators, votes block) while open, meta.vote.voters after the close */
	get voters() {
		if (this._state === 'closed') {
			return this._closedVoters
		}
		return this._state === 'open' ? this._voters : null
	}

	/** @return {Record<string, number>} my votes: the server state with the pending proposals on top (n ≥ 1) */
	get mine() {
		const out = { ...this._serverMine }
		for (const [id, n] of this._pending) {
			if (n > 0) {
				out[id] = n
			} else {
				delete out[id]
			}
		}
		return out
	}

	/**
	 * @return {number|null} votes left while open (server left moved by the
	 *   pending changes, never more than the budget allows: an overdrawn voter
	 *   who lowers one item still has 0 left while the sum is ≥ per, R17 K1),
	 *   else null
	 */
	get left() {
		if (this._state !== 'open') {
			return null
		}
		const total = Object.values(this.mine).reduce((a, b) => a + b, 0)
		return Math.max(0, this.budget() - total)
	}

	/** @return {boolean} meta.vote.state === 'open' */
	get open() {
		return this._state === 'open'
	}

	/** @return {'open'|'closed'|null} */
	get state() {
		return this._state
	}

	/** @return {Array<[string, number]>|null} ranking after the close (descending), else null */
	get results() {
		return this._results ? this._results.map((e) => [e[0], e[1]]) : null
	}

	/** @return {number|null} items with votes (also beyond the capped results), after the close */
	get total() {
		return this._total
	}

	/** @return {number|null} meta.vote.endsAt (server ms) or null (no time limit) */
	get endsAt() {
		return this._endsAt
	}

	/** @return {boolean} meta.vote.show (totals on the board, only after the close) */
	get show() {
		return this._show
	}

	/** @return {string} display name of who started it */
	get by() {
		return this._by
	}

	/** @return {Map<string, number>} pending proposals (copy) */
	get pending() {
		return new Map(this._pending)
	}
}
