/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Presence of the others (SPEC-M0 §6.4, §4.5, §4.11).
 *
 * The server sends the map of every other participant on every sync with
 * pres = 1, also as {} (keys missing from the newest map are gone at once).
 * Entries: n name, k pid, g guest, x/y cursor, s selection, d drag preview
 * (absolute world position of the top-left corner), e item being edited,
 * h = 1 when this entry holds the text lease for e.
 *
 * Interpolation (U16): every new sample starts a glide FROM THE POSITION
 * SHOWN at its arrival TO the new sample, over the observed time between the
 * last two maps (the own poll cadence: 0.4 s active, 1 s idle, 2 s view-only).
 * The cursor then arrives about when the next map is due; a map that comes
 * early starts the next glide from where the cursor is, so it never jumps.
 * The previous rule (a fixed 400 ms delay between the last two samples) was
 * smooth only at 0.4 s: at 1 s and 2 s the cursor jumped 60 % and 80 % of
 * each step on arrival, glided the rest, then stood still.
 * No extrapolation: a glide ends on the newest sample. A new key, a cursor
 * that appears or disappears, and the first map after a gap longer than
 * snapAfterMs (hidden tab) are shown at once.
 * sample() only does arithmetic on segments prepared in update().
 * Entries without a refresh for staleMs disappear (sync stalled or offline).
 *
 * Stage 3 (SPEC-M1 §5.5, §6.4, §6.5.6): v = the participant's viewport
 * [x, y, w, h] in world units (rounded with q(…, 10) by its sender; a missing
 * or invalid v is null). It glides like the cursor and comes out as
 * RemoteSample.view. participants() adds hasView (an entry of that pid has a
 * viewport). For following, viewOf(key) gives the newest v of one entry as it
 * arrived (unglided: the scene glides the camera itself), and
 * youngestViewKey(pid) the key whose v this client saw change last (the
 * arrival time of every v change is kept per key; ties go to the
 * lexicographically smallest key, CLI-16). No new wire field.
 *
 * Factory job 171 (laser pointer): l = the sender's trail [[x, y, d], …,
 * null, [x, y, d], …] (oldest first, d = its age in ms as the server hands
 * it out, null between two strokes; laserOf, an invalid l counts as none).
 * Every point gets the time receivedAt − d. Each key keeps one buffer: a new
 * card keeps the buffered points older than its oldest point (a repeat of a
 * point lies within LASER_SAME_MS of it: the sender stores points at least
 * 30 ms apart), with their stroke breaks, and appends its list; a card
 * without l lets the buffer play to its end; the buffer goes with its key.
 * sample(now) gives every entry laser: the strokes at the play time P = now −
 * laserDelayMs (laserDelay: one poll of the own cadence plus 500 ms), each a
 * list of [x, y, age] with the points of 0 ≤ P − t ≤ LASER_FADE_MS and the
 * tip interpolated at P (age 0); points more than LASER_GAP_MS apart are not
 * joined. hasLaser(): the newest card of some entry carries l (the session
 * keeps the fast cadence meanwhile, like hasDragging()).
 *
 * Factory job 173 (tables): ec = "<col>.<row>", the cell of the table e the
 * entry is editing (anything else counts as none); it comes out as
 * RemoteSample.editingCell (null without one), and h is the lease of that
 * cell. leaseHolder(itemId, cell) names the holder per cell (null: the item
 * itself, a note's text).
 */
import { CELL_RE } from '../model/table.js'
import { NODE_KEY_RE } from '../model/mindmap.js'
import { LASER_FADE_MS, TEN } from '../model/tokens.js'
import { INTERVALS } from './scheduler.js'

/** (Job 171) Laser points further apart than this (ms) belong to two strokes. */
export const LASER_GAP_MS = 300
/** (Job 171) Elements of a valid l (the server's Limits::PRESENCE_LASER). */
const LASER_MAX = 100
/** (Job 171) A buffered point that a new card repeats lies within this of the repeat (ms). */
const LASER_SAME_MS = 15

/**
 * (Job 171) How far behind the sender a receiver plays the others' laser
 * trails: one poll of its own cadence plus 500 ms, so the next card is
 * there before the play time reaches the end of the last one.
 *
 * @param {boolean} viewOnly a view-only device (polls every viewMs)
 * @param {object} [intervals] INTERVALS
 * @return {number} delay in ms (900; 2500 on a view-only device)
 */
export function laserDelay(viewOnly, intervals = INTERVALS) {
	return (viewOnly ? intervals.viewMs : intervals.activeMs) + 500
}

/**
 * The colours of people (job 227): the ten strong tones of the one palette
 * (tokens.TEN), each dark enough for white name tags (contrast ratio ≥ 4.5
 * against #ffffff, checked in presence.test.mjs).
 */
export const PALETTE = TEN

/**
 * Stable color of a participant (FNV-1a over the pid; job 227: mod 10 over
 * TEN). The pid is fixed per board and person (a guest: per guest session),
 * so avatar, cursor, name tag, selection, laser and vote colour agree on
 * every client.
 *
 * @param {string} pid opaque participant id
 * @return {string} #rrggbb
 */
export function colorFor(pid) {
	const s = String(pid ?? '')
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return PALETTE[h % PALETTE.length]
}

/**
 * @param {unknown} v value
 * @return {number|null} finite number or null
 */
function num(v) {
	return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * @param {unknown} d drag list from the server
 * @return {Array<[string, number, number]>} valid entries
 */
function dragList(d) {
	if (!Array.isArray(d)) {
		return []
	}
	const out = []
	for (const e of d) {
		if (Array.isArray(e) && typeof e[0] === 'string' && num(e[1]) !== null && num(e[2]) !== null) {
			out.push([e[0], e[1], e[2]])
		}
	}
	return out
}

/**
 * (Job 171) A laser trail from the server: 1–100 elements, each null (never
 * first, last or twice in a row) or [x, y, d] with finite x, y and an integer
 * d ≥ 0 that never rises.
 *
 * @param {unknown} l presence l
 * @return {Array<[number, number, number]|null>|null} the trail, or null when missing or invalid
 */
export function laserOf(l) {
	if (!Array.isArray(l) || l.length === 0 || l.length > LASER_MAX) {
		return null
	}
	const out = []
	let prevD = Infinity
	for (let i = 0; i < l.length; i++) {
		const p = l[i]
		if (p === null) {
			if (i === 0 || i === l.length - 1 || out[i - 1] === null) {
				return null
			}
			out.push(null)
			continue
		}
		if (!Array.isArray(p) || p.length !== 3 || num(p[0]) === null || num(p[1]) === null || !Number.isInteger(p[2]) || p[2] < 0 || p[2] > prevD) {
			return null
		}
		prevD = p[2]
		out.push([p[0], p[1], p[2]])
	}
	return out
}

/**
 * (Job 171) The buffer of one key after a card (header): the buffered points
 * older than the card's oldest point, with their stroke breaks, then the
 * card's points at receivedAt − d; points older than `from` go. Without a
 * card (no l) the buffer stays.
 *
 * @param {Array<[number, number, number]|null>} old buffer: points [x, y, t] and null between strokes
 * @param {Array<[number, number, number]|null>|null} card laserOf(l)
 * @param {number} at arrival of the card
 * @param {number} from the oldest time still worth keeping
 * @return {Array<[number, number, number]|null>} new buffer
 */
function mergeLaser(old, card, at, from) {
	let all = old
	if (card !== null) {
		const pts = card.map((p) => (p === null ? null : [p[0], p[1], at - p[2]]))
		const first = pts[0][2]
		all = []
		for (const p of old) {
			if (p === null) {
				if (all.length > 0 && all[all.length - 1] !== null) all.push(null)
			} else if (p[2] < first - LASER_SAME_MS) {
				all.push(p)
			} else {
				break
			}
		}
		all.push(...pts)
	}
	const out = []
	for (const p of all) {
		if (p === null ? out.length > 0 && out[out.length - 1] !== null : p[2] >= from) out.push(p)
	}
	if (out.length > 0 && out[out.length - 1] === null) out.pop()
	return out
}

/**
 * (Job 171) The strokes of a buffer at the play time P (header): per stroke
 * the points with 0 ≤ P − t ≤ fade as [x, y, P − t], and where the stroke
 * goes on past P the tip interpolated at P with age 0.
 *
 * @param {Array<[number, number, number]|null>} buf buffer
 * @param {number} P play time
 * @param {number} fade LASER_FADE_MS
 * @return {Array<Array<[number, number, number]>>} strokes, oldest first
 */
function laserAt(buf, P, fade) {
	const strokes = []
	let stroke = []
	let prev = null
	const close = () => {
		if (stroke.length > 0) strokes.push(stroke)
		stroke = []
	}
	for (const p of buf) {
		if (p === null || (prev !== null && p[2] - prev[2] > LASER_GAP_MS)) {
			close()
			prev = null
			if (p === null) continue
		}
		if (p[2] > P) {
			// the play time lies before this point: the tip between it and the one before, the rest is still to come
			if (prev !== null && prev[2] < P) {
				const f = (P - prev[2]) / (p[2] - prev[2])
				stroke.push([lerp(prev[0], p[0], f), lerp(prev[1], p[1], f), 0])
			}
			break
		}
		if (P - p[2] <= fade) stroke.push([p[0], p[1], P - p[2]])
		prev = p
	}
	close()
	return strokes
}

/** Largest |coordinate| and size of a viewport (SPEC-M1 §4.5 me.v). */
const VIEW_MAX = 1e7

/**
 * @param {unknown} v presence v from the server
 * @return {[number, number, number, number]|null} [x, y, w, h] or null (missing or invalid)
 */
export function viewOf(v) {
	if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
		return null
	}
	const [x, y, w, h] = v
	if (Math.abs(x) > VIEW_MAX || Math.abs(y) > VIEW_MAX || !(w > 0) || !(h > 0) || w > VIEW_MAX || h > VIEW_MAX) {
		return null
	}
	return [x, y, w, h]
}

/**
 * @param {Array<number>|null} a viewport
 * @param {Array<number>|null} b viewport
 * @return {boolean} the same four numbers (or both null)
 */
function sameView(a, b) {
	if (a === null || b === null) {
		return a === b
	}
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/**
 * @param {number} a start
 * @param {number} b end
 * @param {number} f fraction 0..1
 * @return {number}
 */
function lerp(a, b, f) {
	return a + (b - a) * f
}

/**
 * @param {object} seg glide segment {t0, dur}
 * @param {number} nowMs time
 * @return {number} progress 0..1
 */
function progress(seg, nowMs) {
	if (!(seg.dur > 0)) {
		return 1
	}
	return Math.min(1, Math.max(0, (nowMs - seg.t0) / seg.dur))
}

/**
 * @param {object} seg glide segment
 * @param {number} f progress
 * @return {Array<number>|null} cursor at f
 */
function cursorAt(seg, f) {
	if (!seg.to) {
		return null
	}
	if (!seg.from || f >= 1) {
		return seg.to
	}
	return [lerp(seg.from[0], seg.to[0], f), lerp(seg.from[1], seg.to[1], f)]
}

/**
 * @param {object} seg glide segment
 * @param {number} f progress
 * @return {Array<number>|null} viewport at f
 */
function viewAt(seg, f) {
	if (!seg.viewTo) {
		return null
	}
	if (!seg.viewFrom || f >= 1) {
		return seg.viewTo
	}
	return seg.viewTo.map((v, i) => lerp(seg.viewFrom[i], v, f))
}

/**
 * @param {object} seg glide segment
 * @param {number} f progress
 * @return {Array<[string, number, number]>} drag previews at f
 */
function dragAt(seg, f) {
	return seg.drag.map((d) => (f >= 1 || d[3] === null
		? [d[0], d[1], d[2]]
		: [d[0], lerp(d[3], d[1], f), lerp(d[4], d[2], f)]))
}

export class PresenceModel {
	/**
	 * @param {{now?: () => number, staleMs?: number, maxGlideMs?: number, snapAfterMs?: number, laserDelayMs?: number}} [o] options:
	 *   maxGlideMs caps one glide, snapAfterMs = longest gap between two maps that still glides,
	 *   laserDelayMs (job 171) = how far behind the senders the laser trails play (laserDelay)
	 */
	constructor({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), staleMs = 10000, maxGlideMs = 3000, snapAfterMs = 4000, laserDelayMs = laserDelay(false) } = {}) {
		this.now = now
		this.staleMs = staleMs
		this.maxGlideMs = maxGlideMs
		this.snapAfterMs = snapAfterMs
		this.laserDelayMs = laserDelayMs
		/** Arrival time of the previous map (the observed cadence). */
		this.lastMapAt = null
		/** @type {Map<string, object>} key → state */
		this.entries = new Map()
	}

	/**
	 * Takes a server map. Keys missing from it are dropped at once.
	 *
	 * @param {Record<string, object>|null} map presence of the others
	 * @param {number} [receivedAt] time of arrival (same clock as now())
	 */
	update(map, receivedAt = this.now()) {
		const m = map !== null && typeof map === 'object' && !Array.isArray(map) ? map : {}
		const gap = this.lastMapAt === null ? Infinity : receivedAt - this.lastMapAt
		this.lastMapAt = receivedAt
		// glide over the observed interval; snap after a long gap
		const dur = gap > this.snapAfterMs || !(gap > 0) ? 0 : Math.min(gap, this.maxGlideMs)
		for (const key of [...this.entries.keys()]) {
			if (!Object.prototype.hasOwnProperty.call(m, key)) {
				this.entries.delete(key)
			}
		}
		for (const key of Object.keys(m)) {
			const e = m[key]
			if (e === null || typeof e !== 'object') {
				continue
			}
			const x = num(e.x)
			const y = num(e.y)
			const sample = { t: receivedAt, cursor: x !== null && y !== null ? [x, y] : null, drag: dragList(e.d), view: viewOf(e.v) }
			const prev = this.entries.get(key)
			const prevView = prev ? prev.samples[prev.samples.length - 1].view : null
			// arrival of the last change of v (CLI-16): kept while v stays the same
			const viewChangedAt = sample.view === null ? null
				: (prev && sameView(prevView, sample.view) && prev.viewChangedAt !== null ? prev.viewChangedAt : receivedAt)
			const samples = prev ? [prev.samples[prev.samples.length - 1], sample] : [sample]
			let seg
			if (prev) {
				// from where the previous glide shows it right now
				const f = progress(prev.seg, receivedAt)
				const shown = cursorAt(prev.seg, f)
				const shownDrag = new Map(dragAt(prev.seg, f).map((d) => [d[0], d]))
				const shownView = viewAt(prev.seg, f)
				seg = {
					t0: receivedAt,
					dur,
					from: shown && sample.cursor ? shown : null,
					to: sample.cursor,
					viewFrom: shownView && sample.view ? shownView : null,
					viewTo: sample.view,
					drag: sample.drag.map((d) => {
						const p = shownDrag.get(d[0])
						return p ? [d[0], d[1], d[2], p[1], p[2]] : [d[0], d[1], d[2], null, null]
					}),
				}
			} else {
				seg = { t0: receivedAt, dur: 0, from: null, to: sample.cursor, viewFrom: null, viewTo: sample.view, drag: sample.drag.map((d) => [d[0], d[1], d[2], null, null]) }
			}
			// job 171: the laser buffer of this key (header); what can no longer be shown goes
			const card = laserOf(e.l)
			const laser = mergeLaser(prev ? prev.laser : [], card, receivedAt, receivedAt - this.laserDelayMs - LASER_FADE_MS - LASER_GAP_MS)
			this.entries.set(key, {
				key,
				pid: typeof e.k === 'string' ? e.k : key.split(':')[0],
				name: typeof e.n === 'string' ? e.n : '',
				guest: e.g === 1 || e.g === true,
				selection: Array.isArray(e.s) ? e.s.filter((id) => typeof id === 'string') : [],
				editing: typeof e.e === 'string' ? e.e : null,
				// job 173: the cell of the table e
				// job 195: or the node of a mind map
				editingCell: typeof e.e === 'string' && typeof e.ec === 'string' && (CELL_RE.test(e.ec) || NODE_KEY_RE.test(e.ec)) ? e.ec : null,
				holder: e.h === 1 || e.h === true,
				seenAt: receivedAt,
				viewChangedAt,
				samples,
				seg,
				laser,
				laserOn: card !== null,
			})
		}
	}

	/**
	 * Interpolated samples for the scene (RemoteSample, §6.3); (job 171)
	 * laser = the entry's laser strokes at nowMs − laserDelayMs (header), [] without.
	 *
	 * @param {number} [nowMs] current time
	 * @return {Array<object>} RemoteSample[]
	 */
	sample(nowMs = this.now()) {
		const out = []
		for (const [key, e] of this.entries) {
			if (nowMs - e.seenAt > this.staleMs) {
				this.entries.delete(key)
				continue
			}
			const f = progress(e.seg, nowMs)
			const cursor = cursorAt(e.seg, f)
			const drag = dragAt(e.seg, f)
			out.push({
				key,
				pid: e.pid,
				name: e.name,
				color: colorFor(e.pid),
				guest: e.guest,
				cursor,
				selection: e.selection,
				drag,
				editing: e.editing,
				editingCell: e.editingCell,
				editingHolder: e.holder,
				view: viewAt(e.seg, f),
				laser: e.laser.length > 0 ? laserAt(e.laser, nowMs - this.laserDelayMs, LASER_FADE_MS) : [],
			})
		}
		return out
	}

	/**
	 * The newest viewport of one entry as it arrived (SPEC-M1 §6.5.6), for
	 * following: not glided (the scene glides the camera itself).
	 *
	 * @param {string} key '<pid>:<client>'
	 * @param {number} [nowMs] current time: an entry older than staleMs counts as gone
	 * @return {{key: string, pid: string, name: string, view: (Array<number>|null), seenAt: number, viewChangedAt: (number|null)}|null}
	 */
	entryView(key, nowMs = this.now()) {
		const e = this.entries.get(key)
		if (!e || nowMs - e.seenAt > this.staleMs) {
			return null
		}
		const last = e.samples[e.samples.length - 1]
		return { key, pid: e.pid, name: e.name, view: last.view, seenAt: e.seenAt, viewChangedAt: e.viewChangedAt }
	}

	/**
	 * The entry of pid this client saw its viewport change last (SPEC-M1
	 * §6.5.6, CLI-16): the key with the newest arrival of a v change; on a tie
	 * the lexicographically smallest key. Entries without v do not count.
	 *
	 * @param {string} pid participant
	 * @param {number} [nowMs] current time (stale entries do not count)
	 * @return {string|null} '<pid>:<client>' or null
	 */
	youngestViewKey(pid, nowMs = this.now()) {
		let best = null
		for (const e of this.entries.values()) {
			if (e.pid !== pid || e.viewChangedAt === null || nowMs - e.seenAt > this.staleMs) {
				continue
			}
			if (best === null || e.viewChangedAt > best.viewChangedAt || (e.viewChangedAt === best.viewChangedAt && e.key < best.key)) {
				best = e
			}
		}
		return best ? best.key : null
	}

	/**
	 * @return {Array<{pid: string, name: string, color: string, guest: boolean, hasView: boolean}>} one per pid, by name;
	 *   hasView: an entry of the pid carries a viewport (stage 3)
	 */
	participants() {
		const byPid = new Map()
		for (const e of this.entries.values()) {
			const hasView = e.samples[e.samples.length - 1].view !== null
			const p = byPid.get(e.pid)
			if (!p) {
				byPid.set(e.pid, { pid: e.pid, name: e.name, color: colorFor(e.pid), guest: e.guest, hasView })
			} else if (hasView) {
				p.hasView = true
			}
		}
		return [...byPid.values()].sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : (p.pid < q.pid ? -1 : 1)))
	}

	/** @return {boolean} someone else is dragging right now */
	hasDragging() {
		for (const e of this.entries.values()) {
			if (e.samples[e.samples.length - 1].drag.length > 0) {
				return true
			}
		}
		return false
	}

	/** @return {boolean} (job 171) the newest card of someone else carries a laser trail */
	hasLaser() {
		for (const e of this.entries.values()) {
			if (e.laserOn) {
				return true
			}
		}
		return false
	}

	/**
	 * @param {string} itemId item id
	 * @param {string|null} [cell] (job 173) the cell of a table; null: the item's own text
	 * @return {{pid: string, name: string}|null} the participant holding the text lease (of that cell)
	 */
	leaseHolder(itemId, cell = null) {
		const want = typeof cell === 'string' ? cell : null
		for (const e of this.entries.values()) {
			if (e.editing === itemId && (e.editingCell ?? null) === want && e.holder) {
				return { pid: e.pid, name: e.name }
			}
		}
		return null
	}

	/** @return {boolean} true when nobody else is present */
	isEmpty() {
		return this.entries.size === 0
	}

	/** Forget everyone (session end). */
	clear() {
		this.entries.clear()
	}
}
