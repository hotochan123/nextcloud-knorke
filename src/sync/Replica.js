/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Client replica (SPEC-M0 §6.4): the confirmed server state plus the own
 * pending ops, which take precedence (no flicker of own unconfirmed changes).
 *
 *   visible(id) = clone(confirmed[id]) ⊕ waiting ops ⊕ in-flight batch ⊕ queue
 *
 * Pending ops live in four stages:
 *   queue     not sent by the loop yet; the only stage that is compacted
 *             (entries a keepalive flush sent are behind a barrier, below)
 *   held      (U8) single ops the loop set aside while it isolates a batch
 *             the server keeps answering with 500: they wait outside the
 *             queue, and every queued op on the same id (or naming it as
 *             parent or, SPEC-M1 rule 14, as a bound connector end, refsOf)
 *             waits behind them; everything else keeps flowing.
 *             releaseHeld() puts the oldest back in flight, alone
 *   inflight  the one batch on the wire; after a network error the SAME batch
 *             with the SAME seq is sent again (it may already be committed)
 *   waiting   acked `ok`, kept until the cursor reaches acks.rev, so the own
 *             change stays visible until the server state that contains it
 *             has arrived
 *
 * Compaction in the queue (port of the poll spike's enqueue, plus R2):
 *   put + patch            → patch folded into the put (setPath on p)
 *   remove of an unsent put → both dropped
 *   patch + patch          → mergePatch (ancestor/descendant aware)
 *   patch/put + remove     → remove
 *   remove + put(revive)   → ONE patch = diffPatch(state before the remove,
 *                            state of the put); nothing when equal. Without
 *                            this, the batch would be [put revive → dup,
 *                            remove] and an undone delete would still delete.
 *
 * Compaction barrier (T15): a keepalive flush (tab hidden, pagehide) sends
 * queued ops WITHOUT taking them out of the queue, so the server may already
 * have applied them. markMaybeSent() marks those entries; a new op on the
 * same id is then appended behind them instead of being merged into them
 * (compacting [remove, put revive] to nothing would re-delete an undone
 * delete, folding text into an applied put would come back 'dup'). Resending
 * them is safe: every op is idempotent (§4.6). The marks leave with the
 * entries when takeBatch() moves them in flight.
 *
 * takeBatch() orders stably; two ops on the same id never swap places:
 *   1. a put of a container moves to the front (topologically by parent),
 *      only when no earlier queued op has the same id
 *   2. a remove moves to the end, only when no later op has the same id or
 *      names it (parent or bound connector end, refsOf)
 *   3. everything else keeps queue order
 *
 * Vote ops (SPEC-M1 §6.4, §4.6; behebt Befund F1): {o:'vote', s, id, n} sets
 * MY number of votes on item `id` in session `s`. Their queue key is
 * `vote:<s>:<id>` (never the item id), a newer vote op on the same key
 * replaces the queued one (set semantics, the last one wins), and they never
 * act on visible()/allIds()/pendingIds(): votes are no item state. They ride
 * in takeBatch() like every other op; an acked vote op is done at once (votes
 * have no rev). Any other op kind is a programming error: dropped with a
 * warning instead of silently (M0 dropped it without a word).
 *
 * Container keep (SPEC-M1 §4.6, §4.7 rule 15): a patch with keep: true on a
 * container leaves its children at their absolute place; the server shifts
 * them by the container's move (x −= dx, y −= dy) in the same rev. Until the
 * server state that contains this arrives, visible() does the same for the
 * children (keepShift: every pending keep patch of the parent after the
 * child's own last placement op, replayed on the confirmed parent, so a
 * keep that is confirmed already shifts nothing twice). A keep patch is
 * never compacted with another op on the same id (the flag belongs to that
 * one move; merged, it would apply to the other move as well or get lost).
 *
 * Lock patches (M2, SPEC-M1 §1.2 "(R20) Sperren"): a patch whose p has the
 * key 'lock' ({lock: {by, name}} locks, {lock: null} unlocks) must reach
 * the server alone ('lock' beside another path is bad). It always stays an
 * op of its own: never folded into a queued put, never merged with a patch
 * before it; every later op on the same id (patch, put, remove) is appended
 * behind it, never merged into it, and none replaces it, not even a remove
 * (the order decides on the server: a remove after a lock is itemlocked). A
 * lock patch after a queued remove is dropped like every patch.
 *
 * Result codes (ack): 'ok' → waiting (item ops) or done (vote ops);
 * 'busy' (SPEC-M1 §4.6, stage 4 on the server) → NOT dropped: when every op
 * of the answer is busy (the server applied nothing) the batch stays in
 * flight and goes out again with the same seq; busy never comes mixed
 * (SPEC-M1 §4.5, R19 T4-18: all results busy or none), so a busy op in a
 * mixed answer only meets a defensive path: it goes back to the front of the
 * queue; 'closed' (vote session not open) and
 * every other code → reported in `failed` and dropped.
 */
import { applyPatch, diffPatch, itemFromPut, setPath } from '../model/paths.js'
import { typeInfo } from '../model/registry.js'

/** Most ops per request (Limits::MAX_OPS). */
export const MAX_OPS = 200

/** Result code of the write budget (SPEC-M1 §4.6): nothing was applied, repeat later. */
export const BUSY = 'busy'

/** Op kinds the replica knows. */
const ITEM_OPS = new Set(['put', 'patch', 'remove'])

/**
 * @param {object|null|undefined} op op
 * @return {boolean} a lock or unlock patch (p has the key lock, M2 R20)
 */
export function isLockPatch(op) {
	return !!op && op.o === 'patch' && isMap(op.p) && Object.prototype.hasOwnProperty.call(op.p, 'lock')
}

/**
 * @param {object} op op
 * @return {boolean} a vote op (SPEC-M1 §4.6)
 */
export function isVoteOp(op) {
	return !!op && op.o === 'vote'
}

/**
 * Queue key of an op: the item id, or `vote:<s>:<id>` for a vote op, so a
 * vote never compacts with (or waits behind) an op on the item itself.
 *
 * @param {object} op op
 * @return {string} key
 */
export function keyOf(op) {
	return isVoteOp(op) ? 'vote:' + op.s + ':' + op.id : op.id
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v))

/**
 * @param {unknown} v value
 * @return {boolean} plain map (not null, not a list)
 */
function isMap(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Merges a newer patch into an older one (both maps path → value). For every
 * path k of the newer patch: if the older one has an ancestor path a of k, k
 * is set inside a's value; otherwise all descendant paths of k are dropped
 * from the older patch and k is appended. The placement group stays complete
 * because both patches carry it whole or not at all.
 *
 * @param {Record<string, unknown>} older earlier patch
 * @param {Record<string, unknown>} newer later patch
 * @return {Record<string, unknown>} new merged patch (inputs untouched)
 */
export function mergePatch(older, newer) {
	const out = {}
	for (const k of Object.keys(older)) {
		out[k] = clone(older[k])
	}
	for (const k of Object.keys(newer)) {
		const value = newer[k]
		const ancestor = Object.keys(out).find((a) => k.startsWith(a + '.'))
		if (ancestor !== undefined) {
			const wrap = { v: isMap(out[ancestor]) ? out[ancestor] : {} }
			setPath(wrap, 'v.' + k.slice(ancestor.length + 1), clone(value))
			out[ancestor] = wrap.v
			continue
		}
		for (const d of Object.keys(out)) {
			if (d.startsWith(k + '.')) {
				delete out[d]
			}
		}
		delete out[k]
		out[k] = clone(value)
	}
	return out
}

/**
 * @param {object|null} obj current state (mutated) or null
 * @param {object} op pending op
 * @return {object|null} state after the op
 */
function applyOp(obj, op) {
	switch (op.o) {
	case 'put':
		// An existing object wins (the server answers `dup`), also for revive
		// while the object exists.
		return obj ?? itemFromPut(op)
	case 'patch':
		if (obj && isMap(op.p)) {
			applyPatch(obj, op.p)
		}
		return obj
	case 'remove':
		return null
	default:
		return obj
	}
}

/**
 * @param {unknown} ep connector end (SPEC-M1 §3.10)
 * @return {string|null} the item a bound end names
 */
function endItem(ep) {
	return isMap(ep) && typeof ep.item === 'string' ? ep.item : null
}

/**
 * Ids an item op names besides its own: the parent and (SPEC-M1 §4.7 rule
 * 14) the items its connector ends are bound to, in a put (p.data.start,
 * p.data.end) or a patch (p['data.start'], p['data.end'], or a whole
 * p['data']). The server checks a bound end against the items of the batch
 * and the board: an end naming an item that has not reached the server yet
 * would come back bad (`never existed`).
 *
 * @param {object} op item op
 * @return {string[]}
 */
export function refsOf(op) {
	if (isVoteOp(op) || !isMap(op?.p)) {
		return []
	}
	const p = op.p
	const out = []
	if (typeof p.parent === 'string') {
		out.push(p.parent)
	}
	const data = p.data
	for (const ep of [p['data.start'], p['data.end'], isMap(data) ? data.start : null, isMap(data) ? data.end : null]) {
		const item = endItem(ep)
		if (item !== null && item !== op.id) {
			out.push(item)
		}
	}
	return out
}

/**
 * @param {object} op op
 * @param {Set<string>} blocked blocked ids
 * @return {boolean} the op touches a blocked id or names one (parent, bound
 *   connector end)
 */
function touches(op, blocked) {
	if (isVoteOp(op)) {
		// votes never depend on item ops (the server applies them after all
		// item ops of the request, in their own transaction)
		return false
	}
	return blocked.has(op.id) || refsOf(op).some((id) => blocked.has(id))
}

export class Replica {
	constructor() {
		/** @type {Map<string, object>} */
		this.confirmed = new Map()
		/** @type {Array<{op: object, urgent: boolean, maybeSent?: boolean}>} */
		this.queue = []
		/** @type {object[]} ops set aside by the loop (U8), oldest first */
		this.held = []
		/** @type {{seq: number, ops: object[]}|null} */
		this.inflight = null
		/** @type {Array<{op: object, rev: number}>} */
		this.waiting = []
		this.nextSeq = 1
	}

	/**
	 * Replaces the confirmed state (first load or resync). Own pending ops
	 * stay; acked ops with ackRev ≤ rev are dropped (the snapshot has them).
	 *
	 * @param {object[]} items WireItems of the snapshot
	 * @param {number} rev snapshot rev
	 * @return {Set<string>} every affected id
	 */
	loadSnapshot(items, rev) {
		const ids = new Set(this.confirmed.keys())
		this.confirmed = new Map()
		for (const it of items ?? []) {
			if (it && typeof it.id === 'string') {
				this.confirmed.set(it.id, clone(it))
				ids.add(it.id)
			}
		}
		this.waiting = this.waiting.filter((w) => {
			if (w.rev <= rev) {
				ids.add(w.op.id)
				return false
			}
			return true
		})
		for (const id of this.pendingIds()) {
			ids.add(id)
		}
		return ids
	}

	/**
	 * Applies server changes (items = full current objects, removed = ids).
	 *
	 * @param {object[]} items WireItems
	 * @param {string[]} removed ids of tombstones
	 * @return {Set<string>} affected ids
	 */
	applyServer(items, removed) {
		const ids = new Set()
		for (const it of items ?? []) {
			if (it && typeof it.id === 'string') {
				this.confirmed.set(it.id, clone(it))
				ids.add(it.id)
			}
		}
		for (const id of removed ?? []) {
			this.confirmed.delete(id)
			ids.add(id)
		}
		return ids
	}

	/**
	 * Adds own ops to the queue, compacting them with queued ops.
	 *
	 * @param {object[]} ops ops (copied)
	 * @param {{urgent?: boolean}} [o] urgent: final ops that shorten the tick
	 * @return {Set<string>} affected ids
	 */
	addLocal(ops, { urgent = true } = {}) {
		const ids = new Set()
		for (const raw of ops ?? []) {
			if (!raw || typeof raw.id !== 'string') {
				continue
			}
			const op = clone(raw)
			if (!isVoteOp(op)) {
				ids.add(op.id)
			}
			this.enqueue(op, !!urgent)
		}
		return ids
	}

	/**
	 * @param {object} op copied op
	 * @param {boolean} urgent urgency flag
	 */
	enqueue(op, urgent) {
		if (!isVoteOp(op) && !ITEM_OPS.has(op.o)) {
			console.warn('[knorke] unknown op kind dropped', op)
			return
		}
		const idx = this.lastIndex(keyOf(op))
		const last = idx >= 0 ? this.queue[idx] : null
		if (isVoteOp(op)) {
			if (last && !last.maybeSent) {
				// set semantics: the newer vote op on the same session and item wins
				this.queue[idx] = { op, urgent: last.urgent || urgent }
				return
			}
			this.queue.push({ op, urgent })
			return
		}
		if (last && last.maybeSent) {
			// Behind the compaction barrier: never merged with, never spliced.
			// After a remove the item is gone for this client: a patch has nothing
			// to change and a second remove nothing to remove (as below).
			if (last.op.o === 'remove' && (op.o === 'patch' || op.o === 'remove')) {
				return
			}
			this.queue.push({ op, urgent })
			return
		}
		if (isLockPatch(op) || (last && isLockPatch(last.op))) {
			// a lock patch stays one op of its own, and nothing merges into it (see above)
			if (op.o === 'patch' && (!isMap(op.p) || (last && last.op.o === 'remove'))) {
				return
			}
			this.queue.push({ op, urgent })
			return
		}
		if (op.o === 'patch' && (op.keep === true || (last && last.op.o === 'patch' && last.op.keep === true))) {
			if (!isMap(op.p) || (last && last.op.o === 'remove')) {
				return
			}
			// a keep patch stays one op of its own (see above)
			this.queue.push({ op, urgent })
			return
		}
		if (op.o === 'put') {
			if (last && last.op.o === 'remove' && op.revive) {
				const before = this.visibleBefore(op.id, idx)
				if (before !== null) {
					const patch = diffPatch(before, itemFromPut(op))
					if (Object.keys(patch).length === 0) {
						this.queue.splice(idx, 1)
					} else {
						this.queue[idx] = { op: { o: 'patch', id: op.id, p: patch }, urgent: last.urgent || urgent }
					}
					return
				}
			}
			this.queue.push({ op, urgent })
			return
		}
		if (op.o === 'patch') {
			if (!isMap(op.p)) {
				return
			}
			if (last && last.op.o === 'put') {
				for (const k of Object.keys(op.p)) {
					setPath(last.op.p, k, clone(op.p[k]))
				}
				last.urgent = last.urgent || urgent
				return
			}
			if (last && last.op.o === 'patch') {
				last.op.p = mergePatch(last.op.p, op.p)
				last.urgent = last.urgent || urgent
				return
			}
			if (last && last.op.o === 'remove') {
				// The object is gone as far as this client is concerned.
				return
			}
			this.queue.push({ op, urgent })
			return
		}
		if (op.o === 'remove') {
			if (!last) {
				this.queue.push({ op, urgent })
				return
			}
			if (last.op.o === 'remove') {
				return
			}
			if (last.op.o === 'put' && this.visibleBefore(op.id, idx) === null) {
				// Never sent: nothing to remove on the server.
				this.queue.splice(idx, 1)
				return
			}
			this.queue[idx] = { op, urgent: last.urgent || urgent }
		}
	}

	/**
	 * Compaction barrier (T15): the given queued ops (default: the whole
	 * queue) went out with a keepalive flush and may already be applied.
	 * Later ops on the same ids are appended, never merged into them.
	 *
	 * @param {object[]} [ops] the sent op objects (identity, as handed out by pendingOps())
	 * @return {number} number of queue entries marked
	 */
	markMaybeSent(ops = null) {
		const sent = ops ? new Set(ops) : null
		let n = 0
		for (const e of this.queue) {
			if (sent === null || sent.has(e.op)) {
				e.maybeSent = true
				n++
			}
		}
		return n
	}

	/**
	 * @param {string} key queue key (item id, or vote:<s>:<id>, keyOf)
	 * @return {number} index of the last queued op with this key, -1 if none
	 */
	lastIndex(key) {
		for (let i = this.queue.length - 1; i >= 0; i--) {
			if (keyOf(this.queue[i].op) === key) {
				return i
			}
		}
		return -1
	}

	/**
	 * Visible state of id from everything before queue position `upto`.
	 *
	 * @param {string} id item id
	 * @param {number} upto queue index (exclusive)
	 * @return {object|null}
	 */
	visibleBefore(id, upto) {
		let obj = this.confirmed.has(id) ? clone(this.confirmed.get(id)) : null
		const on = (op) => op.id === id && !isVoteOp(op)
		for (const w of this.waiting) {
			if (on(w.op)) {
				obj = applyOp(obj, w.op)
			}
		}
		// held ops went out before the current in-flight batch (which never
		// carries an op on a held id) and before everything queued
		for (const op of this.held) {
			if (on(op)) {
				obj = applyOp(obj, op)
			}
		}
		if (this.inflight) {
			for (const op of this.inflight.ops) {
				if (on(op)) {
					obj = applyOp(obj, op)
				}
			}
		}
		for (let i = 0; i < upto && i < this.queue.length; i++) {
			if (on(this.queue[i].op)) {
				obj = applyOp(obj, this.queue[i].op)
			}
		}
		return obj
	}

	/**
	 * @param {string} id item id
	 * @return {object|null} visible WireItem (a copy) or null
	 */
	visible(id) {
		const obj = this.visibleBefore(id, this.queue.length)
		return obj === null ? null : this.keepShift(id, obj)
	}

	/**
	 * Pending ops of every stage in the order the server applies them:
	 * waiting, held (U8), in flight, queue.
	 *
	 * @return {object[]}
	 */
	timeline() {
		return [...this.waiting.map((w) => w.op), ...this.held, ...(this.inflight ? this.inflight.ops : []), ...this.queue.map((e) => e.op)]
	}

	/**
	 * Container keep for a child (SPEC-M1 §4.7 rule 15, see the header): the
	 * pending keep patches of its parent after the child's own last placement
	 * op shift it back by the parent's move.
	 *
	 * @param {string} id child id
	 * @param {object} obj visible state of the child from its own ops (mutated)
	 * @return {object} obj
	 */
	keepShift(id, obj) {
		const parent = obj.parent ?? null
		if (parent === null) {
			return obj
		}
		const ops = this.timeline()
		if (!ops.some((op) => op.id === parent && op.o === 'patch' && op.keep === true)) {
			return obj
		}
		let lastOwn = -1
		ops.forEach((op, i) => {
			if (op.id === id && !isVoteOp(op) && (op.o === 'put' || (op.o === 'patch' && isMap(op.p)
				&& ('x' in op.p || 'y' in op.p || 'parent' in op.p)))) {
				lastOwn = i
			}
		})
		let p = this.confirmed.has(parent) ? clone(this.confirmed.get(parent)) : null
		let dx = 0
		let dy = 0
		ops.forEach((op, i) => {
			if (op.id !== parent || isVoteOp(op)) {
				return
			}
			const bx = p ? (p.x ?? 0) : null
			const by = p ? (p.y ?? 0) : null
			p = applyOp(p, op)
			if (op.o === 'patch' && op.keep === true && i > lastOwn && p && bx !== null && typeInfo(p.t).container) {
				dx += (p.x ?? 0) - bx
				dy += (p.y ?? 0) - by
			}
		})
		if (dx !== 0 || dy !== 0) {
			obj.x = (obj.x ?? 0) - dx
			obj.y = (obj.y ?? 0) - dy
		}
		return obj
	}

	/**
	 * Next batch to send. While a batch is in flight (or failed), the same
	 * batch with the same seq comes back. While ops are held (U8), queued ops
	 * on a held id, or naming one as parent, stay behind (and so does every
	 * later op on their ids); null when nothing else is sendable.
	 *
	 * @param {number} [max] most ops
	 * @return {{seq: number, ops: object[]}|null}
	 */
	takeBatch(max = MAX_OPS) {
		if (this.inflight) {
			return { seq: this.inflight.seq, ops: this.inflight.ops }
		}
		if (this.queue.length === 0) {
			return null
		}
		this.queue = Replica.order(this.queue)
		const limit = Math.max(1, max)
		let take
		if (this.held.length === 0) {
			take = this.queue.splice(0, limit)
		} else {
			const blocked = new Set(this.held.filter((op) => !isVoteOp(op)).map((op) => op.id))
			const keep = []
			take = []
			for (const e of this.queue) {
				if (touches(e.op, blocked)) {
					blocked.add(e.op.id)
					keep.push(e)
				} else if (take.length < limit) {
					take.push(e)
				} else {
					keep.push(e)
				}
			}
			if (take.length === 0) {
				return null
			}
			this.queue = keep
		}
		this.inflight = { seq: this.nextSeq++, ops: take.map((e) => e.op) }
		return { seq: this.inflight.seq, ops: this.inflight.ops }
	}

	/**
	 * U8: sets the in-flight batch aside when it is a single op the server
	 * keeps answering with 500. It waits in `held` (still pending, still
	 * visible) while other ops flow; releaseHeld() sends it again.
	 *
	 * @return {boolean} false when nothing (or more than one op) is in flight
	 */
	holdInflight() {
		if (!this.inflight || this.inflight.ops.length !== 1) {
			return false
		}
		this.held.push(this.inflight.ops[0])
		this.inflight = null
		return true
	}

	/**
	 * U8: the oldest held op goes back in flight, alone, with a new seq.
	 *
	 * @return {{seq: number, ops: object[]}|null} the new in-flight batch, null when
	 *   a batch is in flight already or nothing is held
	 */
	releaseHeld() {
		if (this.inflight || this.held.length === 0) {
			return null
		}
		this.inflight = { seq: this.nextSeq++, ops: [this.held.shift()] }
		return { seq: this.inflight.seq, ops: this.inflight.ops }
	}

	/** @return {number} ops set aside (U8) */
	heldCount() {
		return this.held.length
	}

	/**
	 * The ops in send order without the blocked ones and without every op
	 * that has to wait behind them (same id, or naming one as parent, also
	 * transitively), so the order per id never changes.
	 *
	 * @param {object[]} ops ops in send order
	 * @param {Iterable<object>} blockedOps ops (identity) to leave out
	 * @return {object[]} the rest, in order
	 */
	static withoutDependents(ops, blockedOps) {
		const skip = new Set(blockedOps)
		if (skip.size === 0) {
			return ops
		}
		const blocked = new Set()
		const out = []
		for (const op of ops) {
			if (skip.has(op) || touches(op, blocked)) {
				if (!isVoteOp(op)) {
					blocked.add(op.id)
				}
				continue
			}
			out.push(op)
		}
		return out
	}

	/**
	 * Stable send order (see file comment).
	 *
	 * @param {Array<{op: object, urgent: boolean}>} entries queue entries
	 * @return {Array<{op: object, urgent: boolean}>} reordered copy
	 */
	static order(entries) {
		const n = entries.length
		const front = []
		const tail = []
		const middle = []
		const seen = new Set()
		const isFront = new Array(n).fill(false)
		for (let i = 0; i < n; i++) {
			const op = entries[i].op
			if (op.o === 'put' && typeInfo(op.t).container && !seen.has(op.id)) {
				isFront[i] = true
			}
			seen.add(op.id)
		}
		const isTail = new Array(n).fill(false)
		for (let i = 0; i < n; i++) {
			const op = entries[i].op
			if (op.o !== 'remove') {
				continue
			}
			let referenced = false
			for (let j = i + 1; j < n && !referenced; j++) {
				const later = entries[j].op
				referenced = !isVoteOp(later) && (later.id === op.id || refsOf(later).includes(op.id))
			}
			isTail[i] = !referenced
		}
		for (let i = 0; i < n; i++) {
			if (isFront[i]) {
				front.push(entries[i])
			} else if (isTail[i]) {
				tail.push(entries[i])
			} else {
				middle.push(entries[i])
			}
		}
		return [...Replica.topo(front), ...middle, ...tail]
	}

	/**
	 * Stable topological order of container puts by their parent chain.
	 *
	 * @param {Array<{op: object}>} puts container put entries in queue order
	 * @return {Array<{op: object}>}
	 */
	static topo(puts) {
		if (puts.length < 2) {
			return puts
		}
		const ids = new Set(puts.map((e) => e.op.id))
		const out = []
		const placed = new Set()
		let rest = puts
		// At most 8 levels in practice (M0: containers are root); the guard
		// stops on cycles and keeps the remaining order.
		for (let round = 0; round < puts.length && rest.length > 0; round++) {
			const next = []
			for (const e of rest) {
				const parent = isMap(e.op.p) ? e.op.p.parent : null
				if (parent === null || parent === undefined || !ids.has(parent) || placed.has(parent)) {
					out.push(e)
					placed.add(e.op.id)
				} else {
					next.push(e)
				}
			}
			if (next.length === rest.length) {
				out.push(...next)
				return out
			}
			rest = next
		}
		out.push(...rest)
		return out
	}

	/**
	 * Server answer for the in-flight batch.
	 *
	 * @param {{seq: number, rev: number|null, res: string[]}} acks acks of the answer
	 * @return {{ids: Set<string>, failed: Array<{op: object, code: string}>, busy: boolean}}
	 *   busy: every op came back 'busy', the batch stays in flight (same seq)
	 */
	ack(acks) {
		const ids = new Set()
		const failed = []
		if (!this.inflight || !acks || acks.seq !== this.inflight.seq) {
			return { ids, failed, busy: false }
		}
		const ops = this.inflight.ops
		const codes = ops.map((op, i) => (Array.isArray(acks.res) && typeof acks.res[i] === 'string' ? acks.res[i] : 'bad'))
		if (ops.length > 0 && codes.every((c) => c === BUSY)) {
			// The server applied nothing (write budget): the same batch, same seq, later.
			return { ids, failed, busy: true }
		}
		this.inflight = null
		const rev = Number.isInteger(acks.rev) ? acks.rev : null
		const again = []
		ops.forEach((op, i) => {
			const code = codes[i]
			if (!isVoteOp(op)) {
				ids.add(op.id)
			}
			if (code === 'ok') {
				if (rev !== null && !isVoteOp(op)) {
					this.waiting.push({ op, rev })
				}
			} else if (code === BUSY) {
				again.push(op)
			} else {
				failed.push({ op, code })
			}
		})
		if (again.length > 0) {
			// mixed answer (not expected: busy means nothing of the request was
			// applied); the busy ops were not applied, they go out again first
			this.queue.unshift(...again.map((op) => ({ op, urgent: true })))
		}
		return { ids, failed, busy: false }
	}

	/** The batch failed on the network: it stays for an identical repeat. */
	failInflight() {
		// Nothing to change: takeBatch() hands out the same batch and seq again.
	}

	/**
	 * After 413 (or, U8, while isolating a batch the server answers with
	 * 500): the first half stays in flight (same seq), the rest goes back to
	 * the front of the queue.
	 *
	 * @param {{maybeSent?: boolean}} [o] maybeSent: the server may have applied
	 *   the batch (a 500 can come after the commit), so the returned ops get
	 *   the compaction barrier (T15); a 413 is refused before anything runs
	 * @return {boolean} false when the batch cannot be split (one op)
	 */
	splitInflight({ maybeSent = false } = {}) {
		if (!this.inflight || this.inflight.ops.length < 2) {
			return false
		}
		const ops = this.inflight.ops
		const half = Math.ceil(ops.length / 2)
		this.inflight.ops = ops.slice(0, half)
		this.queue.unshift(...ops.slice(half).map((op) => (maybeSent ? { op, urgent: true, maybeSent: true } : { op, urgent: true })))
		return true
	}

	/**
	 * Drops acked ops that the confirmed state now contains.
	 *
	 * @param {number} cursor confirmed rev
	 * @return {Set<string>} affected ids
	 */
	settle(cursor) {
		const ids = new Set()
		this.waiting = this.waiting.filter((w) => {
			if (w.rev <= cursor) {
				ids.add(w.op.id)
				return false
			}
			return true
		})
		return ids
	}

	/**
	 * Drops the given paths (and their descendants) from the QUEUED patches of
	 * one item; a patch left empty goes. In-flight and acked ops stay (they
	 * may be committed already), and so do puts (an unsent item has no lease
	 * holder but its creator). Used when the text lease is lost: intermediate
	 * text typed before the loss must not be sent later, when the lease may
	 * have come back and the server would accept it over the newer text of
	 * the participant who took over.
	 *
	 * @param {string} id item id
	 * @param {string[]} paths paths to drop (e.g. ['data.text'])
	 * @return {Set<string>} affected ids (empty when nothing was dropped)
	 */
	dropQueuedPaths(id, paths) {
		const ids = new Set()
		const hit = (k) => paths.some((p) => k === p || k.startsWith(p + '.'))
		this.queue = this.queue.filter((e) => {
			if (e.op.id !== id || e.op.o !== 'patch' || !isMap(e.op.p)) {
				return true
			}
			const keys = Object.keys(e.op.p).filter(hit)
			if (keys.length === 0) {
				return true
			}
			ids.add(id)
			const p = { ...e.op.p }
			for (const k of keys) {
				delete p[k]
			}
			if (Object.keys(p).length === 0) {
				return false
			}
			e.op = { ...e.op, p }
			return true
		})
		return ids
	}

	/** @return {boolean} ops waiting in the queue */
	hasQueued() {
		return this.queue.length > 0
	}

	/** @return {boolean} a final op waits in the queue */
	hasUrgent() {
		return this.queue.some((e) => e.urgent)
	}

	/** @return {boolean} a batch is in flight (or failed and waits for repeat) */
	hasInflight() {
		return this.inflight !== null
	}

	/** @return {number} ops the server has not acknowledged yet (queue + held + in flight) */
	pendingCount() {
		return this.queue.length + this.held.length + (this.inflight ? this.inflight.ops.length : 0)
	}

	/** @return {number} acked ops waiting for the cursor */
	waitingCount() {
		return this.waiting.length
	}

	/** @return {Set<string>} ids with any pending op */
	pendingIds() {
		const ids = new Set()
		const add = (op) => {
			if (!isVoteOp(op)) {
				ids.add(op.id)
			}
		}
		for (const w of this.waiting) {
			add(w.op)
		}
		for (const op of this.held) {
			add(op)
		}
		if (this.inflight) {
			for (const op of this.inflight.ops) {
				add(op)
			}
		}
		for (const e of this.queue) {
			add(e.op)
		}
		return ids
	}

	/** @return {Set<string>} every id this replica knows (confirmed or pending) */
	allIds() {
		const ids = this.pendingIds()
		for (const id of this.confirmed.keys()) {
			ids.add(id)
		}
		return ids
	}

	/**
	 * Unacknowledged ops in send order (for fetch keepalive on page hide;
	 * changes nothing): held ops (U8) first, they went out before the
	 * in-flight batch, then the in-flight batch, then the queue. The queued
	 * ops are the queue's own op objects, so a caller can mark the ones it
	 * sent (markMaybeSent).
	 *
	 * @return {{seq: number, ops: object[]}}
	 */
	pendingOps() {
		const queued = Replica.order(this.queue).map((e) => e.op)
		if (this.inflight) {
			return { seq: this.inflight.seq, ops: [...this.held, ...this.inflight.ops, ...queued] }
		}
		return { seq: this.nextSeq, ops: [...this.held, ...queued] }
	}

	/** @return {object[]} copies of the confirmed items (debug) */
	confirmedItems() {
		return [...this.confirmed.values()].map(clone)
	}
}
