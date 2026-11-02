/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Frames as slides (factory job 272). A presentation is a "Bring everyone
 * here" (meta.summon) that also names the shown frame (meta.summon.frame);
 * meta.slides is the saved order of the frames. Everybody else follows the
 * presenter as before (board/follow.js), but fits the shown frame instead of
 * the presenter's viewport.
 *
 * Pure helpers (order, steps, swipe) and SlideShow, the presenter's side:
 * which frame is shown, the moves to the server (at most one PUT in flight,
 * then the newest frame), the saved order, and what happens when the shown
 * frame is deleted. No DOM, no texts: the session gives the frames, the
 * reading order, the meta, the calls and the camera.
 */

/** A horizontal move at least this long (screen px) is a swipe. */
export const SWIPE_MIN_PX = 60

/**
 * The slide order: the saved ids that are still frames, in their order, then
 * the other frames in reading order.
 *
 * @param {unknown} saved meta.slides
 * @param {{id: string, title: string}[]} frames the frames of the board (session.frames())
 * @param {(ids: string[]) => string[]} reading the ids in reading order (arrangeActions readingOrder)
 * @return {{id: string, title: string}[]} the slides
 */
export function slideOrder(saved, frames, reading) {
	const byId = new Map(frames.map((f) => [f.id, f]))
	const out = []
	const seen = new Set()
	if (Array.isArray(saved)) {
		for (const id of saved) {
			if (typeof id === 'string' && byId.has(id) && !seen.has(id)) {
				seen.add(id)
				out.push(byId.get(id))
			}
		}
	}
	const rest = frames.filter((f) => !seen.has(f.id)).map((f) => f.id)
	for (const id of reading(rest)) {
		if (byId.has(id) && !seen.has(id)) {
			seen.add(id)
			out.push(byId.get(id))
		}
	}
	return out
}

/**
 * The slide `dir` steps away from `cur` ('first' and 'last' go to the ends).
 *
 * @param {string[]} ids slide order
 * @param {string|null} cur shown frame
 * @param {number|'first'|'last'} dir +1, -1, 'first', 'last'
 * @return {string|null} the target; null when there is none (at the edge, no slides)
 */
export function stepSlide(ids, cur, dir) {
	if (ids.length === 0) {
		return null
	}
	if (dir === 'first' || dir === 'last') {
		const id = dir === 'first' ? ids[0] : ids[ids.length - 1]
		return id === cur ? null : id
	}
	const i = ids.indexOf(cur)
	if (i < 0) {
		return ids[0]
	}
	const j = i + dir
	return j >= 0 && j < ids.length ? ids[j] : null
}

/**
 * The order with `id` moved to index `to` (clamped).
 *
 * @param {string[]} ids slide order
 * @param {string} id the moved slide
 * @param {number} to its new index
 * @return {string[]} the new order (the same order when nothing moves)
 */
export function moveSlide(ids, id, to) {
	const i = ids.indexOf(id)
	if (i < 0 || !Number.isFinite(to)) {
		return ids
	}
	const j = Math.max(0, Math.min(ids.length - 1, Math.round(to)))
	if (i === j) {
		return ids
	}
	const out = ids.filter((x) => x !== id)
	out.splice(j, 0, id)
	return out
}

/**
 * (Round 2) The slide list takes room from the slide (an inset at the right)
 * only when it is at most half as wide as the board; on a narrow screen it
 * lies over the slide and closes after a pick.
 *
 * @param {number} panelW width of the list (px)
 * @param {number} boardW width of the board (px)
 * @return {boolean} the list lies over the slide
 */
export function panelOverlays(panelW, boardW) {
	return !(panelW > 0 && boardW > 0 && panelW * 2 <= boardW)
}

/**
 * A swipe: at least SWIPE_MIN_PX sideways and more than twice as far
 * sideways as up or down.
 *
 * @param {number} dx horizontal move (screen px)
 * @param {number} dy vertical move (screen px)
 * @return {1|-1|0} +1 next (to the left), -1 previous (to the right), 0 no swipe
 */
export function swipeDir(dx, dy) {
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= 2 * Math.abs(dy)) {
		return 0
	}
	return dx < 0 ? 1 : -1
}

/**
 * The presenter's side of a presentation.
 */
export class SlideShow {
	/**
	 * @param {object} o wiring
	 * @param {() => {id: string, title: string}[]} o.frames the frames of the board
	 * @param {(ids: string[]) => string[]} o.reading reading order
	 * @param {() => object} o.meta board meta
	 * @param {() => boolean} o.presenting this tab presents (meta.summon = this tab)
	 * @param {{start: (frame: string) => Promise<{ok: boolean}>, move: (frame: string) => Promise<{ok: boolean}>, save: (order: string[]) => Promise<{ok: boolean}>, end: () => Promise<{ok: boolean}>}} o.api calls
	 * @param {(frame: string) => void} o.show camera to the frame
	 * @param {() => void} [o.onChange] state changed
	 */
	constructor({ frames, reading, meta, presenting, api, show, onChange = () => {} }) {
		this.frames = frames
		this.reading = reading
		this.meta = meta
		this.presenting = presenting
		this.api = api
		this.show = show
		this.onChange = onChange
		/** the shown frame (this tab's choice, ahead of the server) */
		this.cur = null
		/** the frame last confirmed by the server */
		this.sent = null
		/** the frame still to send */
		this.want = null
		this.inflight = false
		/** an order being saved (shown until the call ends) */
		this.localOrder = null
		/** the order last shown (where to go when the shown frame is deleted) */
		this.lastIds = []
		this.starting = false
	}

	/** @return {{id: string, title: string}[]} the slides */
	list() {
		const frames = this.frames()
		if (this.localOrder) {
			return slideOrder(this.localOrder, frames, this.reading)
		}
		return slideOrder(this.meta()?.slides, frames, this.reading)
	}

	/** @return {boolean} this tab presents frames */
	get active() {
		return this.presenting() && typeof this.meta()?.summon?.frame === 'string'
	}

	/**
	 * Starts presenting.
	 *
	 * @param {string|null} [at] the frame to start with (a selected frame)
	 * @return {Promise<boolean>} started
	 */
	async start(at = null) {
		const ids = this.list().map((s) => s.id)
		if (ids.length === 0 || this.starting) {
			return false
		}
		const first = at !== null && ids.includes(at) ? at : ids[0]
		this.starting = true
		this.cur = first
		this.want = null
		this.lastIds = ids
		this.show(first)
		let r
		try {
			r = await this.api.start(first)
		} finally {
			this.starting = false
		}
		if (r?.ok) {
			this.sent = first
			if (this.cur !== first) {
				this.queue(this.cur)
			}
		}
		this.onChange()
		return !!r?.ok
	}

	/**
	 * Shows a frame (the camera at once, the server soon).
	 *
	 * @param {string} id frame
	 * @return {boolean} moved
	 */
	go(id) {
		if (!this.active || typeof id !== 'string' || id === this.cur) {
			return false
		}
		if (!this.list().some((s) => s.id === id)) {
			return false
		}
		this.cur = id
		this.show(id)
		this.queue(id)
		this.onChange()
		return true
	}

	/**
	 * @param {number|'first'|'last'} dir +1, -1, 'first', 'last'
	 * @return {boolean} moved
	 */
	step(dir) {
		const id = stepSlide(this.list().map((s) => s.id), this.current(), dir)
		return id !== null && this.go(id)
	}

	/** @return {string|null} the shown frame */
	current() {
		if (!this.active) {
			return null
		}
		return this.cur ?? this.meta()?.summon?.frame ?? null
	}

	/** @param {string} id the frame to send */
	queue(id) {
		this.want = id
		this.flush()
	}

	async flush() {
		if (this.inflight) {
			return
		}
		while (this.want !== null && this.active) {
			const f = this.want
			this.want = null
			if (f === this.sent) {
				continue
			}
			this.inflight = true
			let r
			try {
				r = await this.api.move(f)
			} catch (e) {
				r = { ok: false }
			}
			this.inflight = false
			if (r?.ok) {
				this.sent = f
			}
		}
	}

	/**
	 * Moves a slide to another place and saves the order.
	 *
	 * @param {string} id slide
	 * @param {number} to new index
	 * @return {Promise<boolean>} saved
	 */
	async reorder(id, to) {
		const ids = this.list().map((s) => s.id)
		const next = moveSlide(ids, id, to)
		if (next === ids) {
			return false
		}
		this.localOrder = next
		this.lastIds = next
		this.onChange()
		let r
		try {
			r = await this.api.save(next)
		} catch (e) {
			r = { ok: false }
		}
		if (this.localOrder === next) {
			this.localOrder = null
		}
		this.onChange()
		return !!r?.ok
	}

	/**
	 * The board's items or meta changed: the shown frame may be gone (then the
	 * next slide, else the previous one; none left: the end), or another tab
	 * of the presenter moved the slide.
	 *
	 * @return {boolean} something changed
	 */
	sync() {
		if (this.starting) {
			return false
		}
		if (!this.active) {
			const had = this.cur !== null
			this.cur = null
			this.sent = null
			this.want = null
			this.localOrder = null
			return had
		}
		const ids = this.list().map((s) => s.id)
		const server = this.meta()?.summon?.frame ?? null
		if (this.cur === null) {
			this.cur = server
			this.sent = server
		}
		let changed = false
		if (!ids.includes(this.cur)) {
			const old = this.lastIds
			const i = old.indexOf(this.cur)
			const after = i < 0 ? [] : old.slice(i + 1).filter((x) => ids.includes(x))
			const before = i < 0 ? [] : old.slice(0, i).filter((x) => ids.includes(x))
			const next = after[0] ?? before[before.length - 1] ?? ids[0] ?? null
			if (next === null) {
				this.cur = null
				this.api.end()
				this.lastIds = ids
				return true
			}
			this.cur = next
			this.show(next)
			this.queue(next)
			changed = true
		}
		this.lastIds = ids
		return changed
	}

	/** @return {Promise<boolean>} ended */
	async end() {
		this.want = null
		const r = await this.api.end()
		this.cur = null
		this.onChange()
		return !!r?.ok
	}
}
