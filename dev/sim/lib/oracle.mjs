/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Check 3 of the convergence run (SPEC-M0 §8.3): every acknowledged `ok` op
 * is in effect in the replayed change log at its rev, after server
 * normalisation:
 *   - colours lowercase: the typed colour fields of the item's type
 *     (COLOR_PATHS, SPEC-M1 §3.10/§4.8: sticky/frame style.fill, shape
 *     style.fill/stroke/textColor, text style.color, connector style.stroke;
 *     without a type every path ending in "fill", the M0 reading); strings
 *     cleaned like §4.8 (NUL and C0 control characters except \t/\n removed,
 *     \r\n → \n)
 *   - option fourByte = false (a database without 4-byte UTF-8, MariaDB/MySQL
 *     with mysql.utf8mb4 = false; SPEC-M0 §4.8, SPEC-M1 §8.6): every code
 *     point above U+FFFF in a string, at any depth, becomes U+FFFD, like the
 *     server's Input::bmp
 *   - empty values (null, {}, []) are absence, at every depth
 *   - a parent that is a tombstone at the time of the op releases the item at
 *     once (§4.7 rule 6): parent null, x/y plus the parent's position
 *   - a parent that is alive at the time of the op but removed at the END of
 *     the batch releases its children the same way (and does not if the same
 *     batch revives it); a child the batch did not place (a "derived" row of
 *     the server) is checked as well: parent null, x/y plus the container's
 *     last working position
 *   - container keep (SPEC-M1 §4.6, §4.7 rule 15 as of Revision 9): an ok
 *     patch with the literal keep: true on a container moves it by
 *     (dx, dy) = new − old position (working copy before/after the op); every
 *     item that is a live child of that container AT THE TIME OF THE KEEP OP
 *     gets x −= dx, y −= dy at once. Modelled per op order: each container
 *     keeps a list of its keep shifts [op index, dx, dy] in batch order; the
 *     expectation of an op that placed an item into the container is shifted
 *     only by the keep ops that come AFTER it (a placement after the keep op
 *     – the client's membership patches of transformItems, §6.5.2, relative
 *     to the new frame position – stays as sent); a later op of the batch on
 *     a child's placement group wins (it skips the earlier expectation, see
 *     below); a child the batch removes stays removed. Every child the batch
 *     did not place (derived rows) is shifted by all keep shifts of its
 *     container: post = pre − Σ(dx, dy), then released if the container
 *     ended removed. keep on a non-container is ignored.
 *   - connector ends (SPEC-M1 §4.7 rule 14; round 1b of the workload, opt-in
 *     --connectors in 1a): an end is stored in its normal form (endpointOf:
 *     q(v, 10000) for ax/ay, free ends as sent); an end bound to an item that
 *     is dead at the time of the op becomes the free point at its anchor; a
 *     connector that is live at the end of the batch and bound to an item the
 *     batch removed (and did not revive) has that end released to the free
 *     point at the anchor of the item's last working state – also when no op
 *     of the batch touched the connector (derived row). An item the batch
 *     created and removed counts as removed in the batch (R9). The release
 *     anchor comes from the working copies at the END of the batch (target
 *     and container: a container moved after the target's removal counts
 *     with its end position, R9). Free ends of rotated targets (anchor ends)
 *     are compared with ±0.01, all others exactly. The working state shifts
 *     children at the keep op (as the server does).
 * A path that a later op of the same batch overwrote is skipped (for the
 * placement group: any of x, y, parent); a later remove/put of the same id
 * skips the op entirely.
 *
 * Rolled-back batches (only dup/gone/locked/no-op, §4.7 rule 9) report the
 * observed board rev in acks.rev; their `ok` ops are no-ops and are checked
 * against the state at that rev. A committed rev belongs to exactly one
 * batch: the one of the client named in its change rows (lowest seq).
 *
 * Ids the fault `purge` of the convergence run removed for good (SPEC-M1
 * §8.6 R19, T4-14): an op on them must get the code of §4.13.7 "Folgen"
 * (folgenCode, R20 K1); only then is a deviation about them not counted
 * (checkOps).
 */
import { isObj, isEmpty, canon, getPath, setPath, normItem, NUM_FIELDS, PLACEMENT } from './mirror.mjs'
import { anchorPoint, endpointOf, endsEqual } from './geom.mjs'

const C0_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g // eslint-disable-line no-control-regex

/** Typed colour fields per type (§3.10, §4.8): stored lower case. */
export const COLOR_PATHS = Object.freeze({
	sticky: ['style.fill'],
	frame: ['style.fill'],
	shape: ['style.fill', 'style.stroke', 'style.textColor'],
	text: ['style.color'],
	connector: ['style.stroke'],
})

/** Containers (§4.8: container true) – keep only acts on these. */
export const CONTAINERS = Object.freeze(['frame'])

/** Types a connector end may bind to (§4.8 bindable). */
export const BINDABLE = Object.freeze(['sticky', 'shape', 'text'])

/** A stored end as the log has it (already normalized by the server), in key order. */
function canonEnd(ep) {
	if (!isObj(ep)) return ep
	if ('item' in ep) return 'ax' in ep ? { item: ep.item, ax: ep.ax, ay: ep.ay } : { item: ep.item }
	return { x: ep.x, y: ep.y }
}

/** Is `path` a typed colour field of type `type`? Without a type: every path ending in "fill" (M0). */
export function isColorPath(path, type) {
	if (type === undefined || type === null) return /(^|\.)fill$/.test(path)
	return (COLOR_PATHS[type] || []).includes(path)
}

/** Code points above U+FFFF (a surrogate pair in a JS string). */
const ASTRAL_RE = /[\u{10000}-\u{10FFFF}]/gu

export function normString(s, { fourByte = true } = {}) {
	const c = s.replace(/\r\n/g, '\n').replace(C0_RE, '')
	return fourByte ? c : c.replace(ASTRAL_RE, '\uFFFD')
}

/**
 * Server normal form of a value written to `path`.
 * @param {{fourByte?: boolean, type?: string}} [o] fourByte false: the database keeps no 4-byte UTF-8
 *   (U+FFFD, see header); type: the item's type (typed colour fields, COLOR_PATHS)
 */
export function normValue(path, v, o = {}) {
	if (typeof v === 'string') {
		const s = normString(v, o)
		return isColorPath(path, o.type) ? s.toLowerCase() : s
	}
	if (Array.isArray(v)) return v.map((x) => normValue(path, x, o))
	if (isObj(v)) {
		const out = {}
		for (const [k, x] of Object.entries(v)) out[k] = normValue(path + '.' + k, x, o)
		return out
	}
	return v
}

/** Same path, ancestor or descendant. */
export const related = (a, b) => a === b || a.startsWith(b + '.') || b.startsWith(a + '.')

const fieldOf = (k) => (k === 'rotation' ? 'r' : k === 'parent_id' ? 'parent' : k)

/** Applies change rows of one rev to the live/dead maps (tombstones keep their last state). */
export function applyRows(state, rows) {
	for (const row of rows) {
		let patch = row.patch
		if (typeof patch === 'string') {
			try { patch = JSON.parse(patch) } catch { patch = null }
		}
		const id = row.item_id
		if (row.op === 'put') {
			state.live.set(id, normItem(patch || {}))
			state.dead.delete(id)
		} else if (row.op === 'remove') {
			const it = state.live.get(id)
			state.live.delete(id)
			if (it) state.dead.set(id, it)
		} else if (row.op === 'patch') {
			const it = state.live.get(id)
			if (!it || !isObj(patch)) continue
			for (const [k, v] of Object.entries(patch)) {
				const f = fieldOf(k)
				setPath(it, f, NUM_FIELDS.includes(f) ? Number(v) : v)
			}
		}
	}
}

function cloneState(s) {
	return {
		live: new Map([...s.live].map(([k, v]) => [k, structuredClone(v)])),
		dead: new Map([...s.dead].map(([k, v]) => [k, structuredClone(v)])),
	}
}

/**
 * Verifies one acknowledged batch {rev, res, ops, name}.
 * pre = state before the batch, post = state after it (both {live, dead}).
 * @param {{fourByte?: boolean}} [opts] see normValue
 * @returns {Array<object>} deviations
 */
export function verifyBatch(batch, pre, post, opts = {}) {
	const out = []
	const status = new Map() // id → live | dead | none, as of the op being looked at
	const pos = new Map() // id → {x, y}, working position (containers are roots in M0)
	const types = new Map() // id → type (pre state, or the put of this batch)
	const shifts = new Map() // container id → [{i, dx, dy}…]: keep shifts of this batch in op order (rule 15)
	const placed = new Set() // ids an ok op of this batch placed (put, or patch of the placement group)
	const work = new Map() // id → working copy (geometry of connector targets, SPEC-M1 §4.7 rule 14)
	const ends = new Map() // connector id → {start?, end?}: expected end set by an op of this batch
	const st = (id) => {
		if (!status.has(id)) {
			const it = pre.live.get(id) ?? pre.dead.get(id)
			status.set(id, pre.live.has(id) ? 'live' : pre.dead.has(id) ? 'dead' : 'none')
			if (it) {
				pos.set(id, { x: it.x, y: it.y })
				types.set(id, it.t)
				work.set(id, structuredClone(it))
			}
		}
		return status.get(id)
	}
	const dev = (i, op, problem, detail = {}) => out.push({ rev: batch.rev, client: batch.name, op: i, o: op.o, id: op.id, problem, ...detail })
	/** Position of an item's container in the working state, or null at the root. */
	const parentPos = (it) => {
		if (!it || it.parent === null || it.parent === undefined) return null
		st(it.parent)
		return pos.get(it.parent) || null
	}
	/**
	 * Expected stored form of an end written at this point of the batch: the
	 * normalized end, or – bound to an item that is dead now – the free point at
	 * its anchor (rule 14). rotated: compare with ±0.01.
	 */
	const endNow = (v) => {
		const ep = endpointOf(v)
		if (!ep || !('item' in ep)) return { ep, rotated: false }
		if (st(ep.item) === 'dead') {
			const it = work.get(ep.item)
			const [x, y] = anchorPoint(it, parentPos(it), ep)
			return { ep: { x, y }, rotated: Number(it.r) !== 0 && 'ax' in ep, from: ep.item }
		}
		return { ep, rotated: false }
	}

	// pass 1: op-time expectations for the placement group
	const exps = []
	batch.ops.forEach((op, i) => {
		if (batch.res[i] !== 'ok') return
		st(op.id)
		const e = { i, op, placement: null }
		let pl = null
		if (op.o === 'put') pl = { x: op.p?.x ?? 0, y: op.p?.y ?? 0, parent: op.p?.parent ?? null }
		else if (op.o === 'patch' && PLACEMENT.some((k) => k in op.p)) pl = { x: op.p.x, y: op.p.y, parent: op.p.parent }
		if (pl) {
			placed.add(op.id)
			if (pl.parent === null) {
				e.placement = pl
			} else {
				const ps = st(pl.parent)
				const pp = pos.get(pl.parent) || { x: 0, y: 0 }
				if (ps === 'dead') e.placement = { x: pl.x + pp.x, y: pl.y + pp.y, parent: null }
				else if (ps === 'live') e.placement = { ...pl, liveParent: true }
				else dev(i, op, 'ok trotz nie existierendem Elternteil', { parent: pl.parent })
			}
		}
		exps.push(e)
		// connector ends written by this op (rule 14), checked against the working state now
		const type = op.o === 'put' ? op.t : types.get(op.id)
		if (type === 'connector' && op.o !== 'remove') {
			const src = op.o === 'put' ? { 'data.start': op.p?.data?.start, 'data.end': op.p?.data?.end } : op.p
			// a put (also a revive) replaces both ends; a patch only the paths it names
			if (op.o === 'put' || !ends.has(op.id)) ends.set(op.id, {})
			for (const side of ['start', 'end']) {
				const path = 'data.' + side
				if (!(path in src) || src[path] === undefined) continue
				const x = endNow(src[path])
				if (!x.ep) { dev(i, op, `ok trotz ungültigem Ende ${path}`, { value: src[path] }); continue }
				if ('item' in x.ep) {
					const tt = types.get(x.ep.item)
					if (st(x.ep.item) === 'none' || !BINDABLE.includes(tt) || x.ep.item === op.id) dev(i, op, `ok trotz nicht bindbarem Ziel (${path})`, { target: x.ep.item, type: tt })
				}
				ends.get(op.id)[side] = { ...x, op: i }
			}
		} else if (type === 'connector' && op.o === 'remove') {
			ends.delete(op.id)
		}
		// keep (rule 15): only the literal true, only on a container, only when the position changes;
		// it shifts the live children of THIS point of the batch (R9), recorded with its op index
		let keepShift = null
		if (op.o === 'patch' && op.keep === true && CONTAINERS.includes(types.get(op.id)) && 'x' in op.p && 'y' in op.p) {
			const old = pos.get(op.id) || { x: 0, y: 0 }
			const dx = Number(op.p.x) - old.x
			const dy = Number(op.p.y) - old.y
			if (dx !== 0 || dy !== 0) {
				if (!shifts.has(op.id)) shifts.set(op.id, [])
				shifts.get(op.id).push({ i, dx, dy })
				keepShift = { dx, dy }
			}
		}
		// working copies (geometry only): the op itself, then the keep shift of the children now
		if (op.o === 'put') {
			const it = normItem({ ...(op.p || {}), t: op.t })
			if (e.placement) Object.assign(it, { x: e.placement.x, y: e.placement.y, parent: e.placement.parent })
			work.set(op.id, it)
		} else if (op.o === 'patch') {
			const it = work.get(op.id)
			if (it) {
				for (const [k, v] of Object.entries(op.p)) if (!PLACEMENT.includes(k)) setPath(it, k, NUM_FIELDS.includes(k) ? Number(v) : v)
				if (e.placement) Object.assign(it, { x: e.placement.x, y: e.placement.y, parent: e.placement.parent })
			}
		}
		if (keepShift) {
			for (const [id, before] of pre.live) if (before.parent === op.id) st(id)
			for (const [id, w] of work) {
				if (w.parent === op.id && status.get(id) === 'live') {
					w.x -= keepShift.dx
					w.y -= keepShift.dy
				}
			}
		}
		if (op.o === 'put') {
			status.set(op.id, 'live')
			pos.set(op.id, { x: op.p?.x ?? 0, y: op.p?.y ?? 0 })
			types.set(op.id, op.t)
		} else if (op.o === 'remove') {
			status.set(op.id, 'dead')
		} else if (op.o === 'patch' && ('x' in op.p || 'y' in op.p)) {
			pos.set(op.id, { x: op.p.x, y: op.p.y })
		}
	})
	/**
	 * Where an item placed into container c at op index `from` (−1: before the batch) ends:
	 * shifted by every keep op of c AFTER `from`, one after the other like the server
	 * (rule 15, R9), then released if c ended removed (rule 6: parent null, plus c's
	 * last working position). Returns {x, y, parent, shifted}.
	 */
	const endOfChild = (c, x, y, from) => {
		let shifted = false
		for (const s of shifts.get(c) || []) {
			if (s.i <= from) continue
			x -= s.dx
			y -= s.dy
			shifted = true
		}
		if (status.get(c) === 'dead') {
			const pp = pos.get(c) || { x: 0, y: 0 }
			return { x: x + pp.x, y: y + pp.y, parent: null, shifted }
		}
		return { x, y, parent: c, shifted }
	}

	// pass 2: compare with the state after the batch
	for (const e of exps) {
		const { op, i } = e
		const later = batch.ops.filter((o, j) => j > i && batch.res[j] === 'ok' && o.id === op.id)
		if (later.some((o) => o.o !== 'patch')) continue
		const laterPaths = later.flatMap((o) => Object.keys(o.p || {}))
		const it = post.live.get(op.id)
		if (op.o === 'remove') {
			if (it) dev(i, op, 'entfernt laut ok, lebt aber im Log-Zustand')
			continue
		}
		if (!it) {
			dev(i, op, 'ok, fehlt aber im Log-Zustand')
			continue
		}
		if (e.placement && !laterPaths.some((p) => PLACEMENT.includes(p))) {
			// a live container: keep ops after this op shift it, a removal at the end releases it
			const w = e.placement.liveParent ? endOfChild(e.placement.parent, e.placement.x, e.placement.y, i) : e.placement
			if (Math.abs(it.x - w.x) > 1e-6 || Math.abs(it.y - w.y) > 1e-6 || it.parent !== w.parent) {
				dev(i, op, `Lagegruppe weicht ab${w.shifted ? ' (mit keep-Verschiebung des Containers nach dieser Op)' : ''}`, { want: { x: w.x, y: w.y, parent: w.parent }, got: { x: it.x, y: it.y, parent: it.parent } })
			}
		}
		let fields
		if (op.o === 'put') {
			fields = [['t', op.t], ['w', op.p?.w ?? 0], ['h', op.p?.h ?? 0], ['r', op.p?.r ?? 0], ['z', op.p?.z]]
			for (const [k, v] of Object.entries(op.p?.data || {})) fields.push(['data.' + k, v])
			for (const [k, v] of Object.entries(op.p?.style || {})) fields.push(['style.' + k, v])
		} else {
			fields = Object.entries(op.p).filter(([k]) => !PLACEMENT.includes(k))
		}
		const type = op.o === 'put' ? op.t : types.get(op.id)
		for (const [path, v] of fields) {
			if (laterPaths.some((p) => related(p, path))) continue
			// connector ends: checked below against their stored form (q, free point, release)
			if (type === 'connector' && (path === 'data.start' || path === 'data.end')) continue
			let got
			let want
			if (path === 't' || path === 'z') {
				got = it[path]
				want = v
			} else if (NUM_FIELDS.includes(path)) {
				got = it[path]
				want = Number(v)
			} else {
				got = canon(getPath(it, path))
				want = canon(normValue(path, v, { ...opts, type }))
				if (isEmpty(got) && isEmpty(want)) continue
			}
			if (JSON.stringify(got) !== JSON.stringify(want)) dev(i, op, `Pfad ${path} weicht ab`, { want, got })
		}
	}

	// derived rows (rule 15 keep, rule 6 release): the stored children the batch did not place are
	// live children at every keep op of their container (all its shifts apply) and go to the root
	// when the container ended removed
	const derived = new Set(shifts.keys())
	for (const [c, s] of status) if (s === 'dead' && pre.live.has(c) && CONTAINERS.includes(types.get(c))) derived.add(c)
	for (const c of derived) {
		for (const [id, before] of pre.live) {
			if (before.parent !== c || placed.has(id) || status.get(id) === 'dead') continue
			const it = post.live.get(id)
			const want = endOfChild(c, before.x, before.y, -1)
			if (!it || Math.abs(it.x - want.x) > 1e-6 || Math.abs(it.y - want.y) > 1e-6 || it.parent !== want.parent) {
				const problem = want.parent === null
					? `Kind des entfernten Containers nicht freigegeben${want.shifted ? ' (nach seiner keep-Verschiebung)' : ''} (abgeleitete Zeile)`
					: 'Kind des keep-Containers nicht verschoben (abgeleitete Zeile)'
				out.push({ rev: batch.rev, client: batch.name, op: null, o: want.parent === null ? 'release' : 'keep', id, problem, container: c, want: { x: want.x, y: want.y, parent: want.parent }, got: it ? { x: it.x, y: it.y, parent: it.parent } : null })
			}
		}
	}

	// connector ends (rule 14): every connector live at the end of the batch – written by an op
	// or untouched – has its ends in stored form, and a bound end whose item ended removed
	// is a free point at the anchor of that item's last working state (one derived row)
	const conns = new Set([...ends.keys()])
	for (const [id, it] of pre.live) if (it.t === 'connector') conns.add(id)
	for (const k of conns) {
		if (st(k) !== 'live') continue
		const it = post.live.get(k)
		if (!it) continue // reported above (an ok op) or a server removal outside this batch's ops
		for (const side of ['start', 'end']) {
			const byOp = ends.get(k)?.[side] ?? null
			let x = byOp
			if (!x) {
				const ep = pre.live.get(k)?.data?.[side]
				if (ep === undefined) continue // a connector put by this batch without this end: put was bad, never here
				x = { ep: canonEnd(ep), rotated: false }
			}
			if (x.ep && 'item' in x.ep && status.get(x.ep.item) === 'dead' && (pre.live.has(x.ep.item) || byOp)) {
				// anchor of the working copies at the END of the batch (R9): the target as it was
				// removed, its container with its end position
				const target = work.get(x.ep.item)
				const [ax, ay] = anchorPoint(target, parentPos(target), x.ep)
				x = { ep: { x: ax, y: ay }, rotated: Number(target.r) !== 0 && 'ax' in x.ep, from: x.ep.item }
			}
			const got = it.data?.[side]
			const ok = x.ep && 'item' in x.ep
				? JSON.stringify(got) === JSON.stringify(x.ep)
				: endsEqual(got, x.ep, x.rotated)
			if (!ok) {
				out.push({ rev: batch.rev, client: batch.name, op: byOp ? byOp.op : null, o: byOp ? 'end' : 'release', id: k, problem: `Verbinder-Ende data.${side} weicht ab${x.from ? ` (freier Punkt am Ankerpunkt von ${x.from}${x.rotated ? ', ±0,01' : ''})` : ''}`, want: x.ep, got })
			}
		}
	}
	return out
}

/** A free end {x, y} (stored form). */
const isFree = (v) => isObj(v) && 'x' in v && 'y' in v && !('item' in v)

/** The value of `data.<side>` a change row carries, or undefined (put rows: the whole item). */
function rowSide(row, side) {
	if (!row) return undefined
	let p = row.patch
	if (typeof p === 'string') {
		try { p = JSON.parse(p) } catch { return undefined }
	}
	if (!isObj(p)) return undefined
	if (row.op === 'put') return isObj(p.data) ? p.data[side] : undefined
	if (('data.' + side) in p) return p['data.' + side]
	return isObj(p.data) ? p.data[side] : undefined
}

/**
 * What the connector workload of the convergence run reached (K0, SPEC-M1
 * §8.6 round 1b), from the acknowledged batches and the change rows their
 * client wrote at their rev (one merged row per item and rev):
 *   puts, retargets       ok connector puts; ok patches of data.start/data.end
 *   boundEnds             ends sent bound ({item…}) by an ok op that is the last
 *                         writer of that side in its batch
 *   ontoRemovedInBatch    … whose item an EARLIER ok op of the batch removed:
 *                         stored as a free point (rule 14, at op time)
 *   releasedInBatch       … whose item a LATER ok op of the batch removed (and
 *                         did not revive): freed at the end of the batch
 *   ontoTombstone         … stored as a free point although the batch did not
 *                         remove the item: it was a tombstone already;
 *                         ontoTombstoneForeign: its last remove row came from
 *                         another client; ontoTombstoneStale: sourceOf(op, side)
 *                         is 'live' – the client took the item from its live
 *                         mirror, so a concurrent batch removed it first
 *   releasedDerived       sides freed in rows of connectors no ok op of the
 *                         batch wrote that side of (a bound item removed by
 *                         this batch, the connector untouched: derived row)
 * @param {Array<{rev, item_id, op, patch, client}>} rows
 * @param {Array<{rev:(number|null), client, res, ops}>} batches
 * @param {{sourceOf?: (op: object, side: string) => (string|null)}} [o]
 */
export function connectorStats(rows, batches, { sourceOf = null } = {}) {
	const out = { puts: 0, retargets: 0, boundEnds: 0, ontoRemovedInBatch: 0, releasedInBatch: 0, ontoTombstone: 0, ontoTombstoneForeign: 0, ontoTombstoneStale: 0, releasedDerived: 0 }
	const byRev = new Map()
	const removes = new Map() // item → [{rev, client}] of its remove rows
	for (const r of rows) {
		const rev = Number(r.rev)
		if (!byRev.has(rev)) byRev.set(rev, [])
		byRev.get(rev).push(r)
		if (r.op === 'remove') {
			if (!removes.has(r.item_id)) removes.set(r.item_id, [])
			removes.get(r.item_id).push({ rev, client: r.client })
		}
	}
	const sidesOf = (op) => {
		if (op.o === 'put' && op.t === 'connector') return ['start', 'end']
		if (op.o === 'patch' && isObj(op.p)) return ['start', 'end'].filter((s) => ('data.' + s) in op.p)
		return []
	}
	const valueOf = (op, side) => (op.o === 'put' ? op.p?.data?.[side] : op.p?.['data.' + side])
	for (const b of batches) {
		if (b.rev === null || b.rev === undefined) continue
		const own = (byRev.get(Number(b.rev)) || []).filter((r) => r.client === b.client)
		if (!own.length) continue
		const rowOf = new Map(own.map((r) => [r.item_id, r]))
		const ok = (i) => b.res[i] === 'ok'
		// the last ok writer of each (connector, side), and every ok remove/put per item in op order
		const lastWriter = new Map()
		b.ops.forEach((op, i) => {
			if (!ok(i)) return
			const sides = sidesOf(op)
			if (op.o === 'put' && op.t === 'connector') out.puts++
			else if (sides.length) out.retargets++
			for (const s of sides) lastWriter.set(op.id + ':' + s, i)
		})
		const removedBefore = (item, i) => {
			let dead = false
			b.ops.forEach((op, j) => {
				if (j >= i || !ok(j) || op.id !== item) return
				if (op.o === 'remove') dead = true
				else if (op.o === 'put') dead = false
			})
			return dead
		}
		const removedAtEnd = (item) => {
			let dead = null
			b.ops.forEach((op, j) => {
				if (!ok(j) || op.id !== item) return
				if (op.o === 'remove') dead = true
				else if (op.o === 'put') dead = false
			})
			return dead === true
		}
		for (const [key, i] of lastWriter) {
			const op = b.ops[i]
			const side = key.slice(key.lastIndexOf(':') + 1)
			const v = valueOf(op, side)
			if (!isObj(v) || typeof v.item !== 'string') continue
			out.boundEnds++
			if (!isFree(rowSide(rowOf.get(op.id), side))) continue
			if (removedBefore(v.item, i)) out.ontoRemovedInBatch++
			else if (removedAtEnd(v.item)) out.releasedInBatch++
			else {
				out.ontoTombstone++
				const prior = (removes.get(v.item) || []).filter((x) => x.rev < Number(b.rev)).sort((a, c) => c.rev - a.rev)[0]
				if (prior && prior.client !== b.client) out.ontoTombstoneForeign++
				if (sourceOf && sourceOf(op, side) === 'live') out.ontoTombstoneStale++
			}
		}
		for (const r of own) {
			if (r.op !== 'patch') continue
			for (const side of ['start', 'end']) {
				const v = rowSide(r, side)
				if (isFree(v) && !lastWriter.has(r.item_id + ':' + side)) out.releasedDerived++
			}
		}
	}
	return out
}

/**
 * SPEC-M1 §8.6 (R19, T4-14; R20, K1): the ids the fault `purge` removed for
 * good, as of a batch – every id of a purge whose board rev (read right
 * after it) lies below the batch's rev. With rowRevs, an id the change log
 * shows a row of after that purge – a row the batch saw – is no longer
 * purged: a put created it anew (§4.13.7 "Folgen") and it is an ordinary
 * item again. Of several purges of one id the latest before the batch counts.
 * @param {{rev: number}} batch
 * @param {Array<{rev: number, ids: Iterable<string>}>} purges
 * @param {Map<string, number[]>} [rowRevs] id → revs of its change rows (checkOps builds it)
 * @param {boolean} [writer] the batch wrote the rows of its own rev, so they
 *        are not "seen" (default true); false for a batch checked against
 *        the state after its rev (a rolled-back batch)
 * @return {Set<string>}
 */
export function purgedBefore(batch, purges, rowRevs = null, writer = true) {
	const last = new Map() // id → rev of the latest purge before the batch that removed it
	for (const p of purges || []) {
		if (!(batch.rev > p.rev)) continue
		for (const id of p.ids) if (!(last.get(id) >= p.rev)) last.set(id, p.rev)
	}
	const s = new Set()
	for (const [id, at] of last) {
		const seen = (rowRevs?.get(id) || []).some((r) => r > at && (r < batch.rev || (!writer && r === batch.rev)))
		if (!seen) s.add(id)
	}
	return s
}

/**
 * Does a deviation name a purged id – the op's own id, a parent or a
 * connector end (§4.13.7 "Folgen": put + revive = creation, patch → gone,
 * parent or end → bad; the replayed log still shows them as tombstones)?
 */
export const touchesPurged = (d, ids) => [d.id, d.parent, d.target].some((x) => typeof x === 'string' && ids.has(x))

/** The item a connector end names ({item, …}), else null. */
const endItem = (ep) => (isObj(ep) && typeof ep.item === 'string' ? ep.item : null)

/**
 * SPEC-M1 §4.13.7 "Folgen" (§8.6 R20, K1): the code the server owes an op
 * that meets an id the fault `purge` removed for good, or null when no rule
 * of "Folgen" applies. A purged id is "none" for the server (no row), in the
 * order of SyncService::writeBatch:
 *   - patch or remove of a purged id                   → 'gone'
 *   - a parent, or a connector end, on a purged id     → 'bad' ("never existed")
 *   - put of a purged id (put + revive, or a put
 *     without revive: the same creation on "none")     → 'ok'
 * The rules hold once the checks that come before them in the server pass
 * (validation, rights, a live id → dup); a code from those is no answer to
 * "Folgen" and contradictsFolgen does not judge it.
 * @param {{o: string, id: string, t?: string, p?: object, revive?: boolean}} op
 * @param {(id: string) => boolean} isPurged purged at this point of the batch
 * @param {(id: string) => (string|undefined)} [typeOf] type of an id at this
 *        point of the batch (the ends of a patch count only on a connector)
 * @return {('ok'|'gone'|'bad'|null)}
 */
export function folgenCode(op, isPurged, typeOf = () => undefined) {
	if (!isObj(op) || typeof op.id !== 'string') return null
	const p = isObj(op.p) ? op.p : {}
	const anyPurged = (refs) => refs.some((r) => typeof r === 'string' && isPurged(r))
	if (op.o === 'patch' || op.o === 'remove') {
		if (isPurged(op.id)) return 'gone'
		if (op.o === 'remove') return null
		const refs = [p.parent]
		if (typeOf(op.id) === 'connector') refs.push(endItem(p['data.start']), endItem(p['data.end']))
		return anyPurged(refs) ? 'bad' : null
	}
	if (op.o === 'put') {
		const refs = [p.parent]
		if (op.t === 'connector') refs.push(endItem(p.data?.start), endItem(p.data?.end))
		if (anyPurged(refs)) return 'bad'
		return isPurged(op.id) ? 'ok' : null
	}
	return null
}

/**
 * Does the server's code contradict the one of "Folgen" (folgenCode)? An
 * `ok` where "Folgen" refuses (patch or remove of a purged id, a purged
 * parent or connector end: the server treated the id as a tombstone or
 * applied the op), or `gone`/`dup` for the creation of a purged id (the
 * server still knew it). Every other code comes from a check before "Folgen"
 * and is not judged here.
 */
export function contradictsFolgen(want, got) {
	if (want === 'gone' || want === 'bad') return got === 'ok'
	if (want === 'ok') return got === 'gone' || got === 'dup'
	return false
}

/**
 * The "Folgen" code of every op of one batch (null where no rule applies):
 * an id stays purged within the batch until an ok put creates it anew (or an
 * ok remove reaches it); from then on the batch's own working state decides,
 * as verifyBatch models it.
 */
function folgenCodes(batch, ids, pre) {
	const left = new Set(ids)
	const types = new Map()
	const typeOf = (id) => types.get(id) ?? pre.live.get(id)?.t ?? pre.dead.get(id)?.t
	return batch.ops.map((op, i) => {
		const want = folgenCode(op, (id) => left.has(id), typeOf)
		if (batch.res[i] === 'ok' && op.o === 'put') types.set(op.id, op.t)
		if (batch.res[i] === 'ok' && (op.o === 'put' || op.o === 'remove')) left.delete(op.id)
		return want
	})
}

/**
 * Check 3 over all acknowledged batches; replays the change log once.
 *
 * SPEC-M1 §8.6 (R19, T4-14; R20, K1) – opts.purges, the fault `purge` of the
 * convergence run: an op that meets a purged id (purgedBefore) is judged by
 * §4.13.7 "Folgen" (folgenCode). A deviation of verifyBatch about a purged id
 * goes to opts.onPurged – not counted – only when the server's code is the
 * one of "Folgen" (for the creation also: the item lives after the batch);
 * otherwise it stays a deviation, marked purged: {want, got}. A code that
 * contradicts "Folgen" (contradictsFolgen) is a deviation of its own even
 * when verifyBatch saw nothing: the replayed log still shows a purged id as a
 * tombstone, so e.g. an `ok` release under a purged parent looks right there.
 * opts.onFolgen gets every op whose code is the one of "Folgen".
 * @param {Array<{rev, item_id, op, patch, client}>} rows  change log, any order
 * @param {Array<{rev:(number|null), seq, client, name, res, ops}>} batches
 * @param {{fourByte?: boolean, purges?: Array<{rev: number, ids: Iterable<string>}>,
 *          onPurged?: (d: object) => void, onFolgen?: (x: {rev, client, op, o, id, code}) => void}} [opts]
 *        fourByte false on a database without 4-byte UTF-8 (default true)
 * @returns {Array<object>} deviations
 */
export function checkOps(rows, batches, opts = {}) {
	const out = []
	const purges = opts.purges || []
	const rowRevs = new Map() // id → revs of its change rows (purgedBefore: created anew after a purge)
	/**
	 * Deviations of one batch after the rules of "Folgen" (R19, R20 K1): the
	 * accepted ones go to opts.onPurged, contradicting codes are added.
	 */
	const keep = (b, list, pre, post, isWriter) => {
		if (!purges.length) return list
		const ids = purgedBefore(b, purges, rowRevs, isWriter)
		if (!ids.size) return list
		const want = folgenCodes(b, ids, pre)
		const kept = []
		const marked = new Set() // ops with a kept deviation: no second one for their code
		for (const d of list) {
			const i = Number.isInteger(d.op) ? d.op : null
			const w = i === null ? null : want[i]
			const got = i === null ? null : b.res[i]
			if (touchesPurged(d, ids) && w !== null && got === w && (w !== 'ok' || post.live.has(b.ops[i].id))) {
				if (typeof opts.onPurged === 'function') opts.onPurged(d)
				continue
			}
			kept.push(w === null && !touchesPurged(d, ids) ? d : { ...d, purged: { want: w, got } })
			if (i !== null) marked.add(i)
		}
		want.forEach((w, i) => {
			if (w === null) return
			const op = b.ops[i]
			const got = b.res[i]
			if (got === w) {
				if (typeof opts.onFolgen === 'function') opts.onFolgen({ rev: b.rev, client: b.name, op: i, o: op.o, id: op.id, code: got })
				return
			}
			if (marked.has(i) || !contradictsFolgen(w, got)) return
			kept.push({ rev: b.rev, client: b.name, op: i, o: op.o, id: op.id, problem: `Code ${got} statt ${w} nach §4.13.7 „Folgen“ (bereinigte ID)`, want: w, got })
		})
		return kept
	}
	const byRev = new Map()
	for (const r of rows) {
		const rev = Number(r.rev)
		if (!byRev.has(rev)) byRev.set(rev, [])
		byRev.get(rev).push(r)
		if (!rowRevs.has(r.item_id)) rowRevs.set(r.item_id, [])
		rowRevs.get(r.item_id).push(rev)
	}
	const writer = new Map()
	for (const b of batches) {
		if (b.rev === null) continue
		const rs = byRev.get(b.rev)
		if (!rs || !rs.some((r) => r.client === b.client)) continue
		const cur = writer.get(b.rev)
		if (!cur || (cur.client === b.client && b.seq < cur.seq)) writer.set(b.rev, b)
	}
	const state = { live: new Map(), dead: new Map() }
	const revs = [...byRev.keys()].sort((a, b) => a - b)
	const pending = batches.filter((b) => b.rev !== null).sort((a, b) => a.rev - b.rev)
	let p = 0
	for (const rev of revs) {
		// batches that observed a rev without rows of its own (e.g. 0): state as it is now
		while (p < pending.length && pending[p].rev < rev) {
			const s = cloneState(state)
			const b = pending[p++]
			out.push(...keep(b, verifyBatch(b, s, s, opts), s, s, false))
		}
		const pre = cloneState(state)
		applyRows(state, byRev.get(rev))
		const post = cloneState(state)
		while (p < pending.length && pending[p].rev === rev) {
			const b = pending[p++]
			const own = writer.get(rev) === b
			out.push(...keep(b, verifyBatch(b, own ? pre : post, post, opts), own ? pre : post, post, own))
		}
	}
	while (p < pending.length) {
		const s = cloneState(state)
		const b = pending[p++]
		out.push(...keep(b, verifyBatch(b, s, s, opts), s, s, false))
	}
	return out
}
