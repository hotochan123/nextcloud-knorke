/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Undo/redo of own actions only (SPEC-M0 §1.1, §6.5): at most 50 steps, not
 * across a reload. A text session (several intermediate states plus the final
 * one) merges into ONE step through a shared mergeKey; the first step's
 * inverse survives.
 *
 * Job 155: undo and redo keep what someone else changed since the step.
 * planHistory() splits a step into parts per item: its existence (created or
 * deleted), the placement {x, y, parent}, the size {w, h} (a text item: only
 * w) and every other path on its own (r, z, group, lock, data.<k>…,
 * style.<k>…; a connector end is one part). "Expected" is the value the step
 * left (undo: the last value in its ops; redo: in its inverse), "target" the
 * one undo/redo puts back. Each part is checked once against the visible
 * state (decide): equal to the target → nothing; equal to the expected value
 * → it goes out; anything else → skipped, and its item counts for the notice.
 * Compared canonically as diffPatch does (empty = absent, key order ignored);
 * a lock only by who holds it (free or the locker's pid); an existence by
 * every field of the item. An item whose existence is skipped stays exactly
 * as it is, and so do placements that expect it as parent and connector ends
 * that expect to hang on it (not counted again). A text item's h is no part:
 * when its text, w or font size goes out, the height of the target state is
 * measured (rule 13) and travels in the same op. The step then moves to the
 * other stack trimmed to the parts that went out, or vanishes when nothing
 * did.
 *
 * Job 167: the undo of a create (the item is there after the step, the undo
 * removes it) compares only the item's text (the value at textPathOf of its
 * type, canonical, an empty string counts as absent): equal → the remove goes
 * out whatever else someone changed, without a notice; else the item stays
 * as above. When the visible state differs from the one the step left, the
 * trimmed step for the redo stack carries, in place of the item's ops, one
 * put of that visible state (the form of the revive puts of deleteItems,
 * without lock) at the place of its first op; redo then brings the item back
 * as it was right before the undo.
 *
 * Job 176: the redo of a delete (the item is there after the inverse, the
 * redo removes it) follows the same rule; the trimmed step for the undo
 * stack then carries that put in its inverse, with revive (sendHistory sets
 * it only on a redo), and the undo brings the item back as it was right
 * before the redo. A table's text is its cells (data.cells), for both rules;
 * (job 195) a mind map's its node texts (data.texts).
 *
 * Job 206: a step may carry a tag part, tag = {id, before, after, notes?}
 * (before/after: {id, name, color} as meta.tags stored it, or null when the
 * tag was not there): creating (before null), renaming and recolouring
 * (one field differs), deleting (after null; notes: the notes that carried
 * it). planTagHistory() decides it against the board's tags as above: a
 * removal (undo of a create, redo of a delete) goes out while the tag still
 * has the step's name (whatever its colour), and the trimmed step then
 * holds the tag as it was right before; a restore goes out while the id is
 * missing; a name or colour while it still has the value the step left.
 * The session writes it through the tag route (BoardSession.sendTagHistory).
 */
import { q } from '../model/geometry.js'
import { applyPatch, canon, getPath, itemFromPut, setPath } from '../model/paths.js'
import { textPathOf, typeInfo } from '../model/registry.js'

/** Part keys besides plain paths. */
const LIFE = 'life'
const PLACE = 'place'
const SIZE = 'size'
/** Parts of a text item whose change re-measures its height, and their paths. */
const TEXT_PARTS = ['data.text', SIZE, 'style.fontSize']
const TEXT_PATHS = ['data.text', 'w', 'style.fontSize']
const ABSENT = 'absent'
const NONE = Object.freeze({ life: false, state: null, paths: new Map() })

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === undefined || v === null ? 0 : v)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const clone = (v) => structuredClone(v)

/**
 * @param {unknown} lock lock value
 * @return {string} '' when free, else the locker's pid (only that counts)
 */
function lockKey(lock) {
	return isMap(lock) ? 'by:' + JSON.stringify(lock.by ?? null) : ''
}

/**
 * @param {string} path patch path
 * @param {boolean} text the item is a text item
 * @return {string|null} the part the path belongs to; null for a text item's h
 */
export function partOf(path, text) {
	if (path === 'x' || path === 'y' || path === 'parent') {
		return PLACE
	}
	if (path === 'w') {
		return SIZE
	}
	if (path === 'h') {
		return text ? null : SIZE
	}
	return path
}

/**
 * @param {object} item WireItem
 * @param {string} part part of a patched item
 * @return {string} comparison key of the part
 */
function partKey(item, part) {
	switch (part) {
	case PLACE:
		return JSON.stringify([num(item.x), num(item.y), item.parent ?? null])
	case SIZE:
		return JSON.stringify([num(item.w), num(item.h)])
	case 'r':
		return JSON.stringify(num(item.r))
	case 'lock':
		return lockKey(item.lock)
	default:
		return JSON.stringify(canon(getPath(item, part)))
	}
}

/**
 * @param {object|null} item WireItem or null
 * @return {string} comparison key of the whole item (its existence)
 */
function stateKey(item) {
	if (!item) {
		return ABSENT
	}
	return JSON.stringify([item.t ?? null, num(item.x), num(item.y), num(item.w), num(item.h), num(item.r),
		typeof item.z === 'string' ? item.z : null, item.parent ?? null, canon(item.data), canon(item.style),
		item.group ?? null, lockKey(item.lock)])
}

/**
 * @param {object} item WireItem
 * @param {unknown} t type whose text path counts
 * @return {string} comparison key of its text (job 167; empty = absent; a table: its cells, job 176)
 */
function textKey(item, t) {
	const path = t === 'table' ? 'data.cells' : t === 'mindmap' ? 'data.texts' : textPathOf(t)
	const v = path === null ? null : canon(getPath(item, path))
	return JSON.stringify(v === '' ? null : v)
}

/**
 * @param {string} id item
 * @param {object} item its visible state
 * @return {object} a put of that state (the form of the revive puts of actions.deleteItems, without lock)
 */
function putOf(id, item) {
	return {
		o: 'put',
		id,
		t: item.t,
		p: {
			x: num(item.x),
			y: num(item.y),
			w: num(item.w),
			h: num(item.h),
			r: num(item.r),
			z: item.z,
			parent: item.parent ?? null,
			data: clone(item.data ?? {}),
			style: clone(item.style ?? {}),
			group: typeof item.group === 'string' ? item.group : null,
		},
	}
}

/**
 * The decision for one part (pure).
 *
 * @param {string} now key of the part in the visible state
 * @param {string} expected key of the value the step left
 * @param {string} target key of the value undo/redo puts back
 * @return {'same'|'send'|'changed'} nothing to do, it goes out, or skipped (someone else changed it)
 */
export function decide(now, expected, target) {
	if (now === target) {
		return 'same'
	}
	return now === expected ? 'send' : 'changed'
}

/**
 * Per item of an op list: whether a put or remove names it (life), with the
 * whole state after every op of the list on it (null: removed), and the
 * last value of every patched path.
 *
 * @param {object[]} list ops in order
 * @return {Map<string, {life: boolean, state: object|null, paths: Map<string, unknown>}>}
 */
function collect(list) {
	const out = new Map()
	for (const op of list ?? []) {
		if (!op || typeof op.id !== 'string' || !['put', 'patch', 'remove'].includes(op.o)) {
			continue
		}
		let e = out.get(op.id)
		if (!e) {
			e = { life: false, state: null, paths: new Map() }
			out.set(op.id, e)
		}
		if (op.o === 'put') {
			e.life = true
			e.state = e.state ?? itemFromPut(op)
		} else if (op.o === 'remove') {
			e.life = true
			e.state = null
		} else if (isMap(op.p)) {
			if (e.state) {
				applyPatch(e.state, clone(op.p))
			}
			for (const k of Object.keys(op.p)) {
				e.paths.set(k, op.p[k])
			}
		}
	}
	return out
}

/**
 * @param {object} item visible state
 * @param {string} part part
 * @param {Map<string, unknown>} paths last values of one side
 * @param {boolean} text text item
 * @return {object} the visible state with that side's value of the part
 */
function overlay(item, part, paths, text) {
	const out = clone(item)
	for (const [k, v] of paths) {
		if (partOf(k, text) === part) {
			setPath(out, k, clone(v))
		}
	}
	return out
}

/**
 * @param {string} part part
 * @param {Map<string, unknown>} expected expected values of the item
 * @param {Set<string>} stays items whose existence was skipped
 * @return {boolean} the part expects to hang on such an item (parent or bound end)
 */
function hangsOn(part, expected, stays) {
	if (part === PLACE) {
		return stays.has(expected.get('parent'))
	}
	if (part === 'data.start' || part === 'data.end') {
		const ep = expected.get(part)
		return isMap(ep) && stays.has(ep.item)
	}
	return false
}

/**
 * Undo or redo of one step against the visible state (job 155, see above).
 * The lock safety net runs before: every part on an item of `held` is
 * skipped and never counted, except its lock.
 *
 * @param {{ops: object[], inverse: object[]}} step the step (not changed)
 * @param {'undo'|'redo'} dir direction
 * @param {{visible: (id: string) => (object|null), held?: Set<string>, measure?: ((item: object) => (number|null))|null}} env
 *   visible state (confirmed plus own pending ops), the items the safety net holds, text measurement
 * @return {{send: object[], step: ({ops: object[], inverse: object[]}|null), changed: string[]}}
 *   the ops to send, the step trimmed to the parts that went out (null:
 *   nothing did) and the items skipped because someone else changed them
 */
export function planHistory(step, dir, { visible, held = new Set(), measure = null }) {
	const back = dir === 'undo' ? step.inverse : step.ops
	const target = collect(back)
	const expected = collect(dir === 'undo' ? step.ops : step.inverse)
	const key = (id, part) => id + ' ' + part
	const sent = new Set()
	const changed = new Set()
	const stays = new Set()
	const life = new Set()
	const texts = new Set()
	const parts = []
	// items the undo of a create or the redo of a delete removes from a state
	// other than the step's (jobs 167, 176)
	const again = new Map()
	for (const id of new Set([...expected.keys(), ...target.keys()])) {
		const t = target.get(id) ?? NONE
		const e = expected.get(id) ?? NONE
		const now = visible(id)
		if (t.life || e.life) {
			life.add(id)
			if (held.has(id)) {
				continue
			}
			// undo of a create, redo of a delete: only the text keeps the item (jobs 167, 176)
			const removes = t.life && t.state === null && e.state !== null
			const v = removes
				? decide(now === null ? ABSENT : textKey(now, e.state.t), textKey(e.state, e.state.t), ABSENT)
				: decide(stateKey(now), stateKey(e.state), stateKey(t.state))
			if (v === 'send') {
				sent.add(key(id, LIFE))
				if (removes && stateKey(now) !== stateKey(e.state)) {
					again.set(id, dir === 'redo' ? { ...putOf(id, now), revive: true } : putOf(id, now))
				}
			} else if (v === 'changed') {
				changed.add(id)
				stays.add(id)
			}
			continue
		}
		const text = now?.t === 'text'
		if (text) {
			texts.add(id)
		}
		const seen = new Set()
		for (const k of [...e.paths.keys(), ...t.paths.keys()]) {
			const part = partOf(k, text)
			if (part !== null && !seen.has(part)) {
				seen.add(part)
				parts.push({ id, part, now, t, e, text })
			}
		}
	}
	for (const { id, part, now, t, e, text } of parts) {
		if ((held.has(id) && part !== 'lock') || hangsOn(part, e.paths, stays)) {
			continue
		}
		if (now === null) {
			changed.add(id)
			continue
		}
		const v = decide(partKey(now, part), partKey(overlay(now, part, e.paths, text), part), partKey(overlay(now, part, t.paths, text), part))
		if (v === 'send') {
			sent.add(key(id, part))
		} else if (v === 'changed') {
			changed.add(id)
		}
	}
	// a text item's h goes along with its text, width or font size
	const withH = new Set([...texts].filter((id) => TEXT_PARTS.some((part) => sent.has(key(id, part)))))
	const trim = (list, instead = new Map()) => {
		const out = []
		const placed = new Set()
		for (const op of list ?? []) {
			if (!op || typeof op.id !== 'string') {
				continue
			}
			if (instead.has(op.id)) {
				// one put of the visible state at the place of the item's first op
				if (!placed.has(op.id)) {
					placed.add(op.id)
					out.push(clone(instead.get(op.id)))
				}
				continue
			}
			if (op.o === 'put' || op.o === 'remove' || life.has(op.id)) {
				if (sent.has(key(op.id, LIFE))) {
					out.push(clone(op))
				}
				continue
			}
			if (op.o !== 'patch' || !isMap(op.p)) {
				continue
			}
			const p = {}
			for (const k of Object.keys(op.p)) {
				const part = partOf(k, texts.has(op.id))
				if (part === null ? withH.has(op.id) : sent.has(key(op.id, part))) {
					p[k] = clone(op.p[k])
				}
			}
			if (Object.keys(p).length > 0) {
				out.push({ ...clone(op), p })
			}
		}
		return out
	}
	const send = trim(back)
	for (const id of withH) {
		measureInto(send, id, visible(id), measure)
	}
	const out = send.filter((op) => op.o !== 'patch' || Object.keys(op.p).length > 0)
	// the put of the visible state replaces the item's ops on the side the step left
	const kept = () => (dir === 'undo'
		? { ops: trim(step.ops, again), inverse: trim(step.inverse) }
		: { ops: trim(step.ops), inverse: trim(step.inverse, again) })
	return {
		send: out,
		step: out.length > 0 ? kept() : null,
		changed: [...changed].filter((id) => !held.has(id)),
	}
}

/**
 * The height of a text item in the ops that go out (rule 13): measured on
 * its visible state with those ops applied, in the last op that carries its
 * text, width or font size; without a measurement the stored target value.
 *
 * @param {object[]} send ops to send (mutated)
 * @param {string} id text item
 * @param {object} now its visible state
 * @param {((item: object) => (number|null))|null} measure text measurement
 */
function measureInto(send, id, now, measure) {
	const state = clone(now)
	let last = null
	let stored
	for (const op of send) {
		if (op.id !== id || op.o !== 'patch') {
			continue
		}
		if (has(op.p, 'h')) {
			stored = op.p.h
			delete op.p.h
		}
		applyPatch(state, clone(op.p))
		if (TEXT_PATHS.some((k) => has(op.p, k))) {
			last = op
		}
	}
	const m = measure ? measure(state) : null
	const size = typeInfo('text').size
	const h = typeof m === 'number' && Number.isFinite(m) && m > 0 ? q(Math.min(size[1], Math.max(size[0], m)), 100) : stored
	if (last !== null && h !== undefined) {
		last.p.h = h
	}
}

/**
 * The tag part of a step against the board's tags (job 206, see above; pure).
 *
 * @param {{id: string, before: object|null, after: object|null, notes?: string[]}} tag the step's tag part
 * @param {'undo'|'redo'} dir direction
 * @param {{id: string, name: string, color: string}|null} now the tag with that id in meta.tags, or null
 * @param {string[]|null} [carrying] the notes that carry its id now (a delete step's removal keeps them)
 * @return {{body: object|null, tag: object|null, changed: boolean}} the write of the tag route
 *   (null: nothing goes out), the tag part trimmed to it (null: nothing went out) and whether it
 *   was skipped because someone else changed the tag
 */
export function planTagHistory(tag, dir, now, carrying = null) {
	const target = dir === 'undo' ? tag.before : tag.after
	const expected = dir === 'undo' ? tag.after : tag.before
	const nothing = (changed) => ({ body: null, tag: null, changed })
	if (target === null) {
		if (now === null) {
			return nothing(false)
		}
		if (expected === null || now.name !== expected.name) {
			return nothing(true)
		}
		const right = { id: tag.id, name: now.name, color: now.color }
		const kept = dir === 'undo' ? { ...clone(tag), after: right } : { ...clone(tag), before: right }
		if (Array.isArray(tag.notes)) {
			kept.notes = [...(carrying ?? tag.notes)]
		}
		return { body: { action: 'delete', tag: tag.id }, tag: kept, changed: false }
	}
	if (expected === null) {
		return now === null
			? { body: { action: 'add', tags: [{ id: tag.id, name: target.name, color: target.color }] }, tag: clone(tag), changed: false }
			: nothing(false)
	}
	const body = { action: 'update', tag: tag.id }
	const kept = clone(tag)
	let changed = false
	for (const f of ['name', 'color']) {
		if (expected[f] === target[f]) {
			continue
		}
		const v = now === null ? 'changed' : decide(now[f], expected[f], target[f])
		if (v === 'send') {
			body[f] = target[f]
			continue
		}
		changed = changed || v === 'changed'
		// a field that did not go out leaves the trimmed step
		kept.before[f] = kept.after[f] = now?.[f] ?? target[f]
	}
	return has(body, 'name') || has(body, 'color') ? { body, tag: kept, changed } : nothing(changed)
}

export class UndoStack {
	/**
	 * @param {number} [limit] most steps kept
	 */
	constructor(limit = 50) {
		this.limit = limit
		this.done = []
		this.undone = []
		/** Counts pushes and clears (job 206: a tag step's write sees whether a new step came meanwhile). */
		this.gen = 0
	}

	/**
	 * Records a step. Same mergeKey as the top step → merged into it. A step
	 * with a tag part (job 206) needs no ops and is never merged.
	 *
	 * @param {{ops: object[], inverse: object[], mergeKey?: string|null, tag?: object|null}} step action
	 */
	push({ ops, inverse, mergeKey = null, tag = null }) {
		if (!tag && (!Array.isArray(ops) || ops.length === 0)) {
			return
		}
		this.gen++
		const top = this.done[this.done.length - 1]
		if (!tag && mergeKey !== null && top && top.mergeKey === mergeKey && !top.tag) {
			top.ops = [...top.ops, ...structuredClone(ops)]
			top.inverse = [...structuredClone(inverse ?? []), ...top.inverse]
		} else {
			this.done.push(entry({ ops: ops ?? [], inverse: inverse ?? [], tag }, tag ? null : mergeKey))
			this.cap()
		}
		this.undone = []
	}

	/** Keeps at most `limit` steps to undo. */
	cap() {
		if (this.done.length > this.limit) {
			this.done.splice(0, this.done.length - this.limit)
		}
	}

	/**
	 * @param {'undo'|'redo'} dir direction
	 * @return {object|null} the step undo or redo would take next (not a copy) or null
	 */
	peek(dir) {
		const from = dir === 'undo' ? this.done : this.undone
		return from[from.length - 1] ?? null
	}

	/**
	 * Job 206: a step with a tag part after its write. It leaves the stack it
	 * was on (when it is still there), and `kept` (the step trimmed to what
	 * went out; null or empty: nothing) moves to the other: after an undo only
	 * while no new step came since `gen` (a new step ends redo), after a redo
	 * at the place the top had when it started (`at`).
	 *
	 * @param {object} step the step peek() gave
	 * @param {'undo'|'redo'} dir direction
	 * @param {{ops: object[], inverse: object[], tag?: object|null}|null} kept trimmed step
	 * @param {{gen: number, at: number}} start this.gen and this.done.length when the write started
	 */
	settle(step, dir, kept, { gen, at }) {
		const from = dir === 'undo' ? this.done : this.undone
		const i = from.indexOf(step)
		if (i >= 0) {
			from.splice(i, 1)
		}
		if (!kept || ((kept.ops?.length ?? 0) === 0 && (kept.inverse?.length ?? 0) === 0 && !kept.tag)) {
			return
		}
		const e = entry({ ops: kept.ops ?? [], inverse: kept.inverse ?? [], tag: kept.tag ?? null }, step.mergeKey ?? null)
		if (dir === 'undo') {
			if (this.gen === gen) {
				this.undone.push(e)
			}
			return
		}
		this.done.splice(Math.min(at, this.done.length), 0, e)
		this.cap()
	}

	/**
	 * Takes back the last step. Without `cut` the whole step moves to the
	 * redo stack. With it (job 155), `cut` gets the step (fresh copies) and
	 * returns it trimmed to what went out, which moves instead; null or an
	 * empty step: it vanishes.
	 *
	 * @param {((step: {ops: object[], inverse: object[]}) => ({ops: object[], inverse: object[]}|null))|null} [cut] trimming
	 * @return {object[]|null} inverse ops of the last step (fresh copies) or null
	 */
	undo(cut = null) {
		return this.move(this.done, this.undone, 'inverse', cut)
	}

	/**
	 * Brings back the last undone step; `cut` as in undo().
	 *
	 * @param {((step: {ops: object[], inverse: object[]}) => ({ops: object[], inverse: object[]}|null))|null} [cut] trimming
	 * @return {object[]|null} ops of the last undone step (fresh copies) or null
	 */
	redo(cut = null) {
		return this.move(this.undone, this.done, 'ops', cut)
	}

	/**
	 * @param {object[]} from stack the step leaves
	 * @param {object[]} to stack it moves to
	 * @param {'ops'|'inverse'} side the ops returned
	 * @param {Function|null} cut trimming (see undo)
	 * @return {object[]|null} those ops of the step (fresh copies) or null
	 */
	move(from, to, side, cut) {
		const step = from.pop()
		if (!step) {
			return null
		}
		const out = structuredClone(step[side])
		if (cut === null) {
			to.push(step)
			return out
		}
		const kept = cut({ ops: structuredClone(step.ops), inverse: structuredClone(step.inverse) })
		if (kept && (kept.ops?.length > 0 || kept.inverse?.length > 0)) {
			to.push({ ops: structuredClone(kept.ops ?? []), inverse: structuredClone(kept.inverse ?? []), mergeKey: step.mergeKey })
		}
		return out
	}

	/** @return {boolean} */
	canUndo() {
		return this.done.length > 0
	}

	/** @return {boolean} */
	canRedo() {
		return this.undone.length > 0
	}

	/** Forget everything (resync of a different board state is not a reason). */
	clear() {
		this.done = []
		this.undone = []
		this.gen++
	}
}

/**
 * @param {{ops: object[], inverse: object[], tag: object|null}} step step
 * @param {string|null} mergeKey its merge key
 * @return {object} a stack entry of fresh copies (the tag part only when there is one)
 */
function entry({ ops, inverse, tag }, mergeKey) {
	const e = { ops: structuredClone(ops), inverse: structuredClone(inverse), mergeKey }
	if (tag) {
		e.tag = structuredClone(tag)
	}
	return e
}
