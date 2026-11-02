/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The sketches of the board list (factory job 221): each row asks for the
 * sketch of its board (route 57) when it comes into view
 * (components/BoardSketch.vue). One cache per page (the module's
 * `sketches`, so it outlives leaving the list) keyed by board id; an entry
 * holds while the board's updatedAt is the same (every write on a board
 * raises it). At most MAX_PARALLEL requests run at once, the rest wait in
 * order; each id is asked at most once per updatedAt, a failed request
 * too (it shows the icon until updatedAt changes or the page reloads: no
 * retry loop). An answer passes sketchRects, which drops anything that is
 * not the server's form; (job 227) an old palette colour becomes its new
 * tone (tokens.shownColor), as on the board.
 */
import { shallowReactive } from 'vue'
import { boardSketch } from '../api/boards.js'
import { shownColor } from '../model/tokens.js'
import { sketchRects } from './sketch.js'

/** Requests at once. */
export const MAX_PARALLEL = 3

/**
 * @param {unknown} sketch an answer of route 57
 * @return {Array<object>} (job 227) sketchRects with the fills as they are drawn
 */
export function shownRects(sketch) {
	return sketchRects(sketch).map((r) => (r.fill === null ? r : { ...r, fill: shownColor(r.fill) }))
}

/**
 * @param {object} [opts] injection points (tests)
 * @param {(id: number) => Promise<unknown>} [opts.fetch] route 57
 * @param {number} [opts.max] requests at once
 * @return {{want: (id: number, updatedAt: number) => void, rectsOf: (id: number, updatedAt: number) => Array}} the loader
 */
export function createSketches({ fetch = boardSketch, max = MAX_PARALLEL } = {}) {
	/** id → {updatedAt, rects}; rects null while asked */
	const cache = shallowReactive(new Map())
	const queue = []
	let running = 0

	const current = (id, updatedAt) => cache.get(id)?.updatedAt === updatedAt

	function pump() {
		while (running < max && queue.length > 0) {
			const { id, updatedAt } = queue.shift()
			if (!current(id, updatedAt)) {
				continue
			}
			running++
			Promise.resolve()
				.then(() => fetch(id))
				.then(shownRects, () => [])
				.then((rects) => {
					if (current(id, updatedAt)) {
						cache.set(id, Object.freeze({ updatedAt, rects: Object.freeze(rects) }))
					}
				})
				.finally(() => {
					running--
					pump()
				})
		}
	}

	return {
		/**
		 * The row of board id shows: ask for its sketch unless it is known
		 * (or asked) for this updatedAt.
		 *
		 * @param {number} id board id
		 * @param {number} updatedAt the board's updatedAt
		 */
		want(id, updatedAt) {
			if (current(id, updatedAt)) {
				return
			}
			cache.set(id, Object.freeze({ updatedAt, rects: null }))
			queue.push({ id, updatedAt })
			pump()
		},
		/**
		 * @param {number} id board id
		 * @param {number} updatedAt the board's updatedAt
		 * @return {Array<{x: number, y: number, w: number, h: number, frame: boolean, fill: (string|null)}>}
		 *   the rectangles of its sketch; [] while asked, after a failure, for an empty board or another updatedAt
		 */
		rectsOf(id, updatedAt) {
			const e = cache.get(id)
			return e?.updatedAt === updatedAt && e.rects ? e.rects : []
		},
	}
}

/** The board list's loader (one per page). */
export const sketches = createSketches({ fetch: (id) => boardSketch(id) })
