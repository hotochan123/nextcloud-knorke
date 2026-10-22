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
 */

/**
 * Twelve cursor colors. Each is dark enough for white name tags (contrast
 * ratio ≥ 4.5 against #ffffff, checked in presence.test.mjs).
 */
export const PALETTE = Object.freeze([
	'#c62828', '#ad1457', '#6a1b9a', '#4527a0', '#283593', '#1565c0',
	'#00695c', '#2e7d32', '#8d5b00', '#bf360c', '#5d4037', '#37474f',
])

/**
 * Stable color of a participant (FNV-1a over the pid).
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
	 * @param {{now?: () => number, staleMs?: number, maxGlideMs?: number, snapAfterMs?: number}} [o] options:
	 *   maxGlideMs caps one glide, snapAfterMs = longest gap between two maps that still glides
	 */
	constructor({ now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), staleMs = 10000, maxGlideMs = 3000, snapAfterMs = 4000 } = {}) {
		this.now = now
		this.staleMs = staleMs
		this.maxGlideMs = maxGlideMs
		this.snapAfterMs = snapAfterMs
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
			this.entries.set(key, {
				key,
				pid: typeof e.k === 'string' ? e.k : key.split(':')[0],
				name: typeof e.n === 'string' ? e.n : '',
				guest: e.g === 1 || e.g === true,
				selection: Array.isArray(e.s) ? e.s.filter((id) => typeof id === 'string') : [],
				editing: typeof e.e === 'string' ? e.e : null,
				holder: e.h === 1 || e.h === true,
				seenAt: receivedAt,
				viewChangedAt,
				samples,
				seg,
			})
		}
	}

	/**
	 * Interpolated samples for the scene (RemoteSample, §6.3).
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
				editingHolder: e.holder,
				view: viewAt(e.seg, f),
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

	/**
	 * @param {string} itemId item id
	 * @return {{pid: string, name: string}|null} the participant holding the text lease
	 */
	leaseHolder(itemId) {
		for (const e of this.entries.values()) {
			if (e.editing === itemId && e.holder) {
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
