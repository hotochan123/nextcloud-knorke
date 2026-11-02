/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Tables and lanes of the scene (factory job 258, out of SceneManager): the
 * layouts of the stored tables, a table's column borders (job 173), the
 * borders of lanes, of lane and column groups and of a frame's columns
 * (jobs 199, 208, 225) and the drag of a lane's or column's head (jobs 208,
 * 225). SceneManager keeps the input wiring (its InputController host calls
 * these methods), the cursor and stats(); this module reaches the scene only
 * through the host it is given, which reads the scene's state at the time of
 * each call.
 *
 * The one local preview slot the renderer draws a table, a frame with lanes
 * or a mind map with (KonvaRenderer.setTablePreview) lives here: preview,
 * setPreview(p) and clearPreview(match). The mind maps, the transformer and
 * the text editor of SceneManager read and write it only through these three.
 *
 * This module does not import SceneManager.
 */
import {
	COL_GROUP_SIZE, COL_MAX_W, COL_MIN_W, FRAME_MAX, LANE_MAX_H, LANE_MIN_H, colBands, colGroupH, colIndexAt, colMembers, colRuns, colTop,
	groupUnits, hasCols, hasLanes, laneBands, laneGroupW, laneHeadW, laneIndexAt, laneMembers, laneRuns, nameFontSize, previewLanes,
} from '../model/lanes.js'
import { isLocked } from '../model/locks.js'
import { TABLE_COL_MAX, TABLE_COL_MIN, cellAtLayout, previewTable, tableLayout } from '../model/table.js'

/** (job 173) Reach of a table's column border (screen px): mouse and pen, finger. */
export const TABLE_BORDER_PX = 4
export const TABLE_BORDER_TOUCH_PX = 11

/**
 * @typedef {object} StructureHost what the controller reads and calls of the scene, at the time of each call
 * @property {import('../model/SceneModel.js').SceneModel} model the scene model
 * @property {object} renderer the renderer (setTablePreview, setNodeDragPreview)
 * @property {object} camera the camera (get())
 * @property {object} selection the selection (values())
 * @property {string} tool the active tool
 * @property {boolean} viewOnly anything but mode edit
 * @property {function(): boolean} canGrabBorder mounted, edit mode, the select tool, no editor, no hanging connector,
 *   no drag, transform, connect, gesture, and not coarse (LOD 2)
 * @property {function(): void} cursor sets the cursor style again
 * @property {function(): void} wake asks for a frame
 * @property {function(string, *): void} call hands a callback (onIntent) to the scene's owner
 * @property {function(): void} presence draws the presence again (children following a lane border)
 * @property {function(): void} dirtyHandles the handles are drawn again with the next frame
 * @property {function(string, number, boolean): number} measureCell SceneManager.measureTableCell
 */

export class StructureController {
	/** @type {StructureHost} */
	#h
	/** (job 173) the table preview the renderer draws: {id, col, w} (a column border drag) or {id, cell, text} (cell editor) */
	#tablePreview = null
	/** (job 173) a column border being dragged: {id, col, x0 (its left edge, world), w0, w}, else null */
	#colDrag = null
	/** (job 173) the layouts of the stored tables (item object → layout) */
	#tableLayouts = new WeakMap()
	/** (job 208) the head of a lane or column being dragged: {id, key, ax, from, to, w0, ghost}, else null */
	#headDrag = null

	/** @param {StructureHost} host the scene */
	constructor(host) {
		this.#h = host
	}

	/** @return {object|null} the one local preview the renderer draws (a table, a frame with lanes, a mind map), null: none */
	get preview() {
		return this.#tablePreview
	}

	/** @return {object|null} the border being dragged (a table's column, a lane, a group's edge, a frame's column), else null */
	get colDrag() {
		return this.#colDrag
	}

	/** @return {object|null} the head of a lane or column being dragged, else null */
	get headDrag() {
		return this.#headDrag
	}

	/** @param {function(object): boolean} match the preview to drop: none when there is none or it does not match */
	clearPreview(match) {
		if (this.#tablePreview !== null && match(this.#tablePreview)) this.setPreview(null)
	}

	/**
	 * @param {string} id table id
	 * @return {ReturnType<typeof tableLayout>|null} its layout as drawn (measured rows, the local preview
	 *   included), null for anything but a table
	 */
	tableLayoutOf(id) {
		const it = this.#h.model.get(id)
		if (!it || it.t !== 'table') return null
		const measure = (text, w, bold) => this.#h.measureCell(text, w, bold)
		const p = this.#tablePreview !== null && this.#tablePreview.id === id ? this.#tablePreview : null
		if (p !== null) return tableLayout(previewTable(it, p), measure)
		let l = this.#tableLayouts.get(it)
		if (!l) {
			l = tableLayout(it, measure)
			this.#tableLayouts.set(it, l)
		}
		return l
	}

	/** @return {Array<{id:string, cols:number[], rows:number[], header:boolean}>} stats().tables */
	tableStats() {
		const out = []
		for (const id of this.#h.model.ids()) {
			const l = this.tableLayoutOf(id)
			if (l) out.push({ id, cols: l.cols.map((c) => c.w), rows: l.rows.map((r) => r.h), header: l.header })
		}
		return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	}

	/**
	 * @param {string} id table id
	 * @param {{x:number, y:number}} w world point
	 * @return {string|null} the cell under w, null outside its cells (or for anything but a table)
	 */
	cellAt(id, w) {
		const a = this.#h.model.abs(id)
		const l = this.tableLayoutOf(id)
		return a && l && w ? cellAtLayout(l, w.x - a.x, w.y - a.y) : null
	}

	/**
	 * The column border under a container point: only at the one selected,
	 * unlocked table in mode edit with the select tool, without an editor, a
	 * hanging connector, a drag, a transform, a gesture and not at LOD 2;
	 * TABLE_BORDER_PX (coarse: TABLE_BORDER_TOUCH_PX) screen px on either
	 * side of the right edge of a column (the outer edge too), over the
	 * table's height.
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {boolean} coarse a finger (or a pen)
	 * @return {{id:string, col:string, x0:number, w0:number}|null} the table, the column, its left edge (world) and width
	 */
	tableBorderAt(sp, coarse) {
		if (!this.#h.canGrabBorder()) return null
		const sel = this.#h.selection.values()
		const it = sel.length === 1 ? this.#h.model.get(sel[0]) : null
		if (!it || it.t !== 'table' || isLocked(it)) return null
		const a = this.#h.model.abs(it.id)
		const l = this.tableLayoutOf(it.id)
		if (!a || !l) return null
		const c = this.#h.camera.get()
		const tol = (coarse ? TABLE_BORDER_TOUCH_PX : TABLE_BORDER_PX) / c.scale
		const wx = c.x + sp.x / c.scale
		const wy = c.y + sp.y / c.scale
		if (wy < a.y - tol || wy > a.y + Math.max(a.h, l.h) + tol) return null
		let best = null
		let bestD = Infinity
		for (const col of l.cols) {
			const d = Math.abs(wx - (a.x + col.x + col.w))
			if (d <= tol && d < bestD) {
				best = col
				bestD = d
			}
		}
		return best ? { id: it.id, col: best.key, x0: a.x + best.x, w0: best.w } : null
	}

	/**
	 * @param {{id:string, col:string, x0:number, w0:number}} b a border of tableBorderAt
	 * @return {boolean} the drag of that border started
	 */
	beginColumn(b) {
		if (!b || !this.#h.model.has(b.id) || this.#colDrag !== null) return false
		if (typeof b.gspan === 'string') return this.beginSpan(b)
		if (typeof b.lane === 'string') return this.beginLane(b)
		if (typeof b.fcol === 'string') return this.beginFrameCol(b)
		this.#colDrag = { id: b.id, col: b.col, x0: b.x0, w0: b.w0, w: b.w0 }
		this.#h.cursor()
		return true
	}

	/**
	 * @param {number} dx world x of the pointer minus that of the press: the column's width grows by it (TABLE_COL_MIN–TABLE_COL_MAX, whole units)
	 * @param {number} [dy] (job 199) world y of the pointer minus that of the press: the lane's height grows by it
	 */
	moveColumn(dx, dy) {
		const d = this.#colDrag
		if (d !== null && typeof d.gspan === 'string') {
			this.moveSpan(d.ax === 'y' ? dy : dx)
			return
		}
		if (d !== null && typeof d.lane === 'string') {
			this.moveLane(dy)
			return
		}
		if (d !== null && typeof d.fcol === 'string') {
			this.moveFrameCol(dx)
			return
		}
		if (d === null || !Number.isFinite(dx)) return
		const w = Math.round(Math.min(TABLE_COL_MAX, Math.max(TABLE_COL_MIN, d.w0 + dx)))
		if (w === d.w) return
		d.w = w
		this.setPreview({ id: d.id, col: d.col, w })
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/** @param {boolean} commit released (one intent tableWidth when the width changed); false: Esc, cancel */
	endColumn(commit) {
		const d = this.#colDrag
		if (d === null) return
		if (typeof d.gspan === 'string') {
			this.endSpan(commit)
			return
		}
		if (typeof d.lane === 'string') {
			this.endLane(commit)
			return
		}
		if (typeof d.fcol === 'string') {
			this.endFrameCol(commit)
			return
		}
		this.#colDrag = null
		if (commit && d.w !== d.w0 && this.#h.model.has(d.id)) {
			this.#h.call('onIntent', { type: 'tableWidth', id: d.id, col: d.col, w: d.w })
		}
		if (this.#tablePreview !== null && this.#tablePreview.id === d.id && typeof this.#tablePreview.col === 'string') this.setPreview(null)
		this.#h.cursor()
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/** @param {object|null} p the one table preview the renderer draws ({id, col, w} or {id, cell, text}), null: none */
	setPreview(p) {
		const prev = this.#tablePreview
		this.#tablePreview = p
		if (prev !== null && (p === null || prev.id !== p.id)) this.#h.renderer.setTablePreview(prev.id, null)
		if (p !== null) this.#h.renderer.setTablePreview(p.id, p)
	}

	// ---------------------------------------------------------------- internals: lanes (job 199)

	/**
	 * @param {string} id frame
	 * @return {object|null} the frame as drawn (the local preview of a dragged lane border included), null without lanes
	 */
	laneItemOf(id) {
		const it = this.#h.model.get(id)
		if (!hasLanes(it)) return null
		const p = this.#tablePreview
		return p !== null && p.id === id && p.lane === true ? previewLanes(it, p) : it
	}

	/**
	 * @return {Array<{id:string, head:number, top:number, lanes:Array<{key:string, y:number, h:number, title:string}>,
	 *   cols:Array<{key:string, x:number, w:number, title:string}>}>} stats().lanes (job 208: head, top, cols; job 225:
	 *   gw, cg, g of each lane and column, groups and cgroups, one per run; job 234: fs, the font size of the name of each
	 *   lane and run)
	 */
	laneStats() {
		const out = []
		for (const id of this.#h.model.ids()) {
			const it = this.laneItemOf(id)
			if (it) {
				out.push({
					id,
					head: laneHeadW(it),
					top: colTop(it),
					gw: laneGroupW(it),
					cg: colGroupH(it),
					lanes: laneBands(it).map((b) => ({ key: b.key, y: b.y, h: b.h, title: b.title, g: b.g, fs: nameFontSize(b.title, b.h) })),
					cols: colBands(it).map((b) => ({ key: b.key, x: b.x, w: b.w, title: b.title, g: b.g })),
					groups: laneRuns(it).map((r) => ({ key: r.key, y: r.y, h: r.h, title: r.title, lanes: r.keys, fs: nameFontSize(r.title, r.h) })),
					cgroups: colRuns(it).map((r) => ({ key: r.key, x: r.x, w: r.w, title: r.title, cols: r.keys, fs: COL_GROUP_SIZE })),
				})
			}
		}
		return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	}

	/**
	 * @param {string} id frame
	 * @param {{x:number, y:number}} w world point
	 * @return {string|null} the lane whose band holds w.y (clamped to the first and the last), null without lanes
	 */
	laneAt(id, w) {
		const it = this.#h.model.get(id)
		const a = this.#h.model.abs(id)
		const bands = laneBands(it)
		if (!a || !w || bands.length === 0) return null
		return bands[laneIndexAt(bands, w.y - a.y)].key
	}

	/**
	 * @param {string} id frame
	 * @param {{x:number, y:number}} w world point
	 * @return {string|null} (job 208) the column whose band holds w.x (clamped to the first and the last), null without columns
	 */
	colAt(id, w) {
		const it = this.#h.model.get(id)
		const a = this.#h.model.abs(id)
		const bands = colBands(it)
		if (!a || !w || bands.length === 0) return null
		return bands[colIndexAt(bands, w.x - a.x)].key
	}

	/**
	 * @param {string} id frame
	 * @param {{x:number, y:number}} w world point
	 * @return {boolean} w lies in the head column of a frame with lanes (job 208: below the head row of its columns)
	 */
	inLaneHead(id, w) {
		const it = this.#h.model.get(id)
		const a = this.#h.model.abs(id)
		const hw = laneHeadW(it)
		return hasLanes(it) && !!a && hw > 0 && w.x >= a.x && w.x <= a.x + hw && w.y >= a.y + colTop(it) && w.y <= a.y + a.h
	}

	/**
	 * @param {string} id frame
	 * @param {{x:number, y:number}} w world point
	 * @return {boolean} (job 208) w lies in the head row of a frame's columns, right of the head column
	 */
	inColHead(id, w) {
		const it = this.#h.model.get(id)
		const a = this.#h.model.abs(id)
		return hasCols(it) && !!a && w.x >= a.x + laneHeadW(it) && w.x <= a.x + a.w && w.y >= a.y && w.y <= a.y + colTop(it)
	}

	/**
	 * @param {string} id frame
	 * @param {{x:number, y:number}} w world point
	 * @return {{lane:string}|{col:string}|null} (job 208) the head of a lane or a column under w, null elsewhere;
	 *   (job 225) in a group's cell also lgroup (cgroup), the group
	 */
	headAt(id, w) {
		if (!w || this.#h.model.get(id)?.t !== 'frame') return null
		const it = this.#h.model.get(id)
		const a = this.#h.model.abs(id)
		if (this.inLaneHead(id, w)) {
			const lane = this.laneAt(id, w)
			const g = w.x < a.x + laneGroupW(it) ? laneBands(it).find((b) => b.key === lane)?.g ?? null : null
			return g !== null ? { lane, lgroup: g } : { lane }
		}
		if (this.inColHead(id, w)) {
			const col = this.colAt(id, w)
			const g = w.y < a.y + colGroupH(it) ? colBands(it).find((b) => b.key === col)?.g ?? null : null
			return g !== null ? { col, cgroup: g } : { col }
		}
		return null
	}

	/**
	 * The border below a lane under a container point: only at the one
	 * selected, unlocked frame with lanes, under the conditions of a table's
	 * column border (#tableBorderAt); TABLE_BORDER_PX (coarse:
	 * TABLE_BORDER_TOUCH_PX) screen px on either side, over the frame's
	 * width; the frame's bottom edge is the last lane's border.
	 *
	 * @param {{x:number, y:number}} sp container point
	 * @param {boolean} coarse a finger (or a pen)
	 * @return {{id:string, lane:string, h0:number}|null} the frame, the lane and its drawn height
	 */
	laneBorderAt(sp, coarse) {
		if (!this.#h.canGrabBorder()) return null
		const sel = this.#h.selection.values()
		const it = sel.length === 1 ? this.#h.model.get(sel[0]) : null
		if (!hasLanes(it) || isLocked(it)) return null
		const a = this.#h.model.abs(it.id)
		if (!a) return null
		const c = this.#h.camera.get()
		const tol = (coarse ? TABLE_BORDER_TOUCH_PX : TABLE_BORDER_PX) / c.scale
		const wx = c.x + sp.x / c.scale
		const wy = c.y + sp.y / c.scale
		if (wx < a.x - tol || wx > a.x + a.w + tol || wy < a.y - tol || wy > a.y + a.h + tol) return null
		// (job 225) in a group's cell: the edges of its run go first
		const span = this.groupEdgeAt(it, a, wx, wy, tol)
		if (span !== null) return span
		let best = null
		let bestD = Infinity
		// (job 225) inside a group's cell the border between two of its lanes (columns) is no border: the cell is one
		const inCell = wx < a.x + laneGroupW(it)
		const inCellRow = wy < a.y + colGroupH(it)
		const lanes = laneBands(it)
		lanes.forEach((b, i) => {
			if (inCell && b.g !== null && lanes[i + 1]?.g === b.g) return
			const d = Math.abs(wy - (a.y + b.y + b.h))
			if (d <= tol && d < bestD) {
				best = b
				bestD = d
			}
		})
		// (job 208) the right edge of a column, when it is nearer
		let col = null
		const cols = colBands(it)
		cols.forEach((b, i) => {
			if (inCellRow && b.g !== null && cols[i + 1]?.g === b.g) return
			const d = Math.abs(wx - (a.x + b.x + b.w))
			if (d <= tol && d < bestD) {
				col = b
				bestD = d
			}
		})
		if (col !== null) return { id: it.id, fcol: col.key, w0: col.w }
		return best ? { id: it.id, lane: best.key, h0: best.h } : null
	}

	/**
	 * (Job 225) The top or bottom edge of a lane group's run within its cell
	 * column ([0, laneGroupW]), or the left or right edge of a column group's
	 * run within its cell row ([0, colGroupH]), the nearest within tol.
	 *
	 * @param {object} it frame with lanes
	 * @param {{x:number, y:number}} a its absolute box
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {number} tol world units on either side
	 * @return {{id:string, gspan:string, ax:('x'|'y'), edge:('start'|'end'), from:number, to:number, at:number}|null} at: the
	 *   edge's place relative to the frame
	 */
	groupEdgeAt(it, a, wx, wy, tol) {
		let best = null
		let bestD = Infinity
		const gw = laneGroupW(it)
		if (gw > 0 && wx >= a.x - tol && wx <= a.x + gw) {
			for (const r of laneRuns(it)) {
				for (const [edge, at] of [['start', r.y], ['end', r.y + r.h]]) {
					const d = Math.abs(wy - (a.y + at))
					if (d <= tol && d < bestD) {
						best = { id: it.id, gspan: r.key, ax: 'y', edge, from: r.from, to: r.to, at }
						bestD = d
					}
				}
			}
		}
		const cg = colGroupH(it)
		if (best === null && cg > 0 && wy >= a.y - tol && wy <= a.y + cg) {
			for (const r of colRuns(it)) {
				for (const [edge, at] of [['start', r.x], ['end', r.x + r.w]]) {
					const d = Math.abs(wx - (a.x + at))
					if (d <= tol && d < bestD) {
						best = { id: it.id, gspan: r.key, ax: 'x', edge, from: r.from, to: r.to, at }
						bestD = d
					}
				}
			}
		}
		return best
	}

	/**
	 * (Job 225) The drag of a group's edge: it snaps to the borders of the
	 * lanes (columns), keeps at least one and stops at another group; the cell
	 * follows (the preview {id, span, lane: true}); one intent laneGroupSpan
	 * (colGroupSpan) {id, group, from, to} at the release when the range
	 * changed.
	 *
	 * @param {{id:string, gspan:string, ax:('x'|'y'), edge:('start'|'end'), from:number, to:number, at:number}} b an edge of #groupEdgeAt
	 * @return {boolean} the drag started
	 */
	beginSpan(b) {
		const it = this.#h.model.get(b.id)
		const bands = b.ax === 'y' ? laneBands(it) : colBands(it)
		if (bands.length === 0) return false
		this.#colDrag = { id: b.id, gspan: b.gspan, ax: b.ax, edge: b.edge, at: b.at, from0: b.from, to0: b.to, from: b.from, to: b.to }
		this.#h.cursor()
		return true
	}

	/** @param {number} d world units the pointer moved along the edge's axis since the press */
	moveSpan(d) {
		const D = this.#colDrag
		if (D === null || !Number.isFinite(d)) return
		const it = this.#h.model.get(D.id)
		const bands = D.ax === 'y' ? laneBands(it) : colBands(it)
		const pos = D.ax === 'y' ? 'y' : 'x'
		const size = D.ax === 'y' ? 'h' : 'w'
		const free = (j) => j >= 0 && j < bands.length && (bands[j].g === null || bands[j].g === D.gspan)
		const want = D.at + d
		let from = D.from0
		let to = D.to0
		let bestD = Infinity
		if (D.edge === 'end') {
			for (let j = D.from0; free(j) || j === D.from0; j++) {
				if (j >= bands.length) break
				const dd = Math.abs(bands[j][pos] + bands[j][size] - want)
				if (dd < bestD) {
					to = j
					bestD = dd
				}
			}
		} else {
			for (let j = D.to0; free(j) || j === D.to0; j--) {
				if (j < 0) break
				const dd = Math.abs(bands[j][pos] - want)
				if (dd < bestD) {
					from = j
					bestD = dd
				}
			}
		}
		if (from === D.from && to === D.to) return
		D.from = from
		D.to = to
		this.setPreview({ id: D.id, span: { g: D.gspan, from, to, ax: D.ax }, lane: true })
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/** @param {boolean} commit released (one intent laneGroupSpan or colGroupSpan when the range changed); false: Esc, cancel */
	endSpan(commit) {
		const D = this.#colDrag
		this.#colDrag = null
		if (commit && (D.from !== D.from0 || D.to !== D.to0) && hasLanes(this.#h.model.get(D.id))) {
			this.#h.call('onIntent', { type: D.ax === 'y' ? 'laneGroupSpan' : 'colGroupSpan', id: D.id, group: D.gspan, from: D.from, to: D.to })
		}
		if (this.#tablePreview !== null && this.#tablePreview.id === D.id && this.#tablePreview.lane === true) this.setPreview(null)
		this.#h.cursor()
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/**
	 * @param {{id:string, lane:string, h0:number}} b a border of laneBorderAt
	 * @return {boolean} the drag of that border started
	 */
	beginLane(b) {
		const it = this.#h.model.get(b.id)
		const bands = laneBands(it)
		const i = bands.findIndex((x) => x.key === b.lane)
		if (i < 0) return false
		// the children of the lanes below follow live (their previews), at their places of the press
		const members = laneMembers(this.#h.model, b.id, bands)
		const below = new Map()
		for (let j = i + 1; j < bands.length; j++) {
			for (const k of members.get(bands[j].key) ?? []) {
				const ka = this.#h.model.abs(k)
				if (ka) below.set(k, { x: ka.x, y: ka.y })
			}
		}
		this.#colDrag = { id: b.id, lane: b.lane, h0: bands[i].h, h: bands[i].h, fh: it.h, below }
		this.#h.cursor()
		return true
	}

	/** @param {number} dy world y of the pointer minus that of the press: the lane's height grows by it (whole units) */
	moveLane(dy) {
		const d = this.#colDrag
		if (d === null || !Number.isFinite(dy)) return
		const max = Math.min(LANE_MAX_H, d.h0 + FRAME_MAX - d.fh)
		const h = Math.round(Math.min(max, Math.max(LANE_MIN_H, d.h0 + dy)))
		if (h === d.h) return
		d.h = h
		this.setPreview({ id: d.id, key: d.lane, h, lane: true })
		this.#h.presence()
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/** @param {boolean} commit released (one intent laneHeight when the height changed); false: Esc, cancel */
	endLane(commit) {
		const d = this.#colDrag
		this.#colDrag = null
		if (commit && d.h !== d.h0 && this.#h.model.has(d.id)) {
			this.#h.call('onIntent', { type: 'laneHeight', id: d.id, lane: d.lane, h: d.h })
		}
		if (this.#tablePreview !== null && this.#tablePreview.id === d.id && this.#tablePreview.lane === true) this.setPreview(null)
		this.#h.presence()
		this.#h.cursor()
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/**
	 * @return {Map<string, {x:number, y:number}>} the absolute places of the children that follow a dragged lane
	 *   border (job 208: or a column's)
	 */
	laneMoves() {
		const d = this.#colDrag
		const out = new Map()
		if (d !== null && typeof d.fcol === 'string' && d.w !== d.w0) {
			for (const [k, at] of d.right) {
				if (this.#h.model.has(k)) out.set(k, { x: at.x + d.w - d.w0, y: at.y })
			}
			return out
		}
		if (d === null || typeof d.lane !== 'string' || d.h === d.h0) return out
		for (const [k, at] of d.below) {
			if (this.#h.model.has(k)) out.set(k, { x: at.x, y: at.y + d.h - d.h0 })
		}
		return out
	}

	/**
	 * (Job 208) The drag of a column's right edge, as #beginLane.
	 *
	 * @param {{id:string, fcol:string, w0:number}} b a border of laneBorderAt
	 * @return {boolean} the drag of that border started
	 */
	beginFrameCol(b) {
		const it = this.#h.model.get(b.id)
		const bands = colBands(it)
		const i = bands.findIndex((x) => x.key === b.fcol)
		if (i < 0) return false
		// the children of the columns right of it follow live, at their places of the press
		const members = colMembers(this.#h.model, b.id, bands)
		const right = new Map()
		for (let j = i + 1; j < bands.length; j++) {
			for (const k of members.get(bands[j].key) ?? []) {
				const ka = this.#h.model.abs(k)
				if (ka) right.set(k, { x: ka.x, y: ka.y })
			}
		}
		this.#colDrag = { id: b.id, fcol: b.fcol, w0: bands[i].w, w: bands[i].w, fw: it.w, right }
		this.#h.cursor()
		return true
	}

	/** @param {number} dx world x of the pointer minus that of the press: the column's width grows by it (whole units) */
	moveFrameCol(dx) {
		const d = this.#colDrag
		if (d === null || !Number.isFinite(dx)) return
		const max = Math.min(COL_MAX_W, d.w0 + FRAME_MAX - d.fw)
		const w = Math.round(Math.min(max, Math.max(COL_MIN_W, d.w0 + dx)))
		if (w === d.w) return
		d.w = w
		this.setPreview({ id: d.id, col: d.fcol, w, lane: true })
		this.#h.presence()
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/** @param {boolean} commit released (one intent colWidth when the width changed); false: Esc, cancel */
	endFrameCol(commit) {
		const d = this.#colDrag
		this.#colDrag = null
		if (commit && d.w !== d.w0 && this.#h.model.has(d.id)) {
			this.#h.call('onIntent', { type: 'colWidth', id: d.id, col: d.fcol, w: d.w })
		}
		if (this.#tablePreview !== null && this.#tablePreview.id === d.id && this.#tablePreview.lane === true) this.setPreview(null)
		this.#h.presence()
		this.#h.cursor()
		this.#h.dirtyHandles()
		this.#h.wake()
	}

	/**
	 * (Job 208) A press on the head of a lane or a column moved beyond its
	 * threshold: the ghost of its band follows the pointer along its axis, the
	 * bar marks where it lands (the band under the pointer). Nothing goes to
	 * the others.
	 *
	 * @param {string} id frame
	 * (Job 225) A group's cell (head.lgroup, head.cgroup): the ghost of its run,
	 * the bar where it lands among the other units (model/lanes.js groupUnits,
	 * by the ghost's centre), {type:'laneGroupMove'|'colGroupMove', id, group,
	 * to} at the release.
	 *
	 * @param {string} id frame
	 * @param {{lane?:string, col?:string, lgroup?:string, cgroup?:string}} head the head (headAt)
	 * @param {{x:number, y:number}} w world point of the press
	 * @return {boolean} the drag runs (mode edit, the select tool, an unlocked frame with that lane or column)
	 */
	beginHeadDrag(id, head, w) {
		if (this.#h.viewOnly || this.#h.tool !== 'select' || this.#headDrag !== null || !w) return false
		const it = this.#h.model.get(id)
		if (!hasLanes(it) || isLocked(it) || !this.#h.model.abs(id)) return false
		const ax = typeof head?.col === 'string' ? 'x' : 'y'
		const g = ax === 'x' ? head.cgroup : head?.lgroup
		if (typeof g === 'string') {
			const units = groupUnits(it, g, ax)
			const i = (ax === 'x' ? colBands(it) : laneBands(it)).findIndex((b) => b.key === (ax === 'x' ? head.col : head.lane))
			const run = (ax === 'x' ? colRuns(it) : laneRuns(it)).find((r) => r.key === g && r.from <= i && i <= r.to)
			if (!units || !run) return false
			this.#headDrag = { id, key: g, ax, group: true, run, units: units.units, from: units.at, to: units.at, w0: { x: w.x, y: w.y } }
			this.moveHeadDrag(w)
			return true
		}
		const key = ax === 'x' ? head.col : head?.lane
		const from = (ax === 'x' ? colBands(it) : laneBands(it)).findIndex((b) => b.key === key)
		if (from < 0) return false
		this.#headDrag = { id, key, ax, from, to: from, w0: { x: w.x, y: w.y } }
		this.moveHeadDrag(w)
		return true
	}

	/** @param {{x:number, y:number}} w world point of the pointer */
	moveHeadDrag(w) {
		const D = this.#headDrag
		if (D === null || !w) return
		if (D.group) {
			this.moveGroupDrag(w)
			return
		}
		const it = this.#h.model.get(D.id)
		const a = this.#h.model.abs(D.id)
		const bands = D.ax === 'x' ? colBands(it) : laneBands(it)
		const b = bands[D.from]
		if (!a || !b) return
		let ghost
		if (D.ax === 'y') {
			ghost = { x: a.x, y: a.y + b.y + w.y - D.w0.y, w: a.w, h: b.h }
			D.to = laneIndexAt(bands, w.y - a.y)
		} else {
			ghost = { x: a.x + b.x + w.x - D.w0.x, y: a.y, w: b.w, h: a.h }
			D.to = colIndexAt(bands, w.x - a.x)
		}
		const t = bands[D.to]
		const where = D.to < D.from ? 'before' : 'after'
		const target = D.to === D.from ? null : D.ax === 'y'
			? { x: a.x, y: a.y + t.y, w: a.w, h: t.h, where, beside: false }
			: { x: a.x + t.x, y: a.y, w: t.w, h: a.h, where, beside: true }
		this.#h.renderer.setNodeDragPreview({ ghost, target })
		this.#h.wake()
	}

	/** @param {boolean} commit released (the intent laneMove or colMove to another index); false: Esc, cancel */
	endHeadDrag(commit) {
		const D = this.#headDrag
		if (D === null) return
		this.#headDrag = null
		this.#h.renderer.setNodeDragPreview(null)
		this.#h.wake()
		if (!commit || D.to === D.from || !hasLanes(this.#h.model.get(D.id))) return
		if (D.group) {
			this.#h.call('onIntent', { type: D.ax === 'y' ? 'laneGroupMove' : 'colGroupMove', id: D.id, group: D.key, to: D.to })
			return
		}
		this.#h.call('onIntent', D.ax === 'y' ? { type: 'laneMove', id: D.id, lane: D.key, to: D.to } : { type: 'colMove', id: D.id, col: D.key, to: D.to })
	}

	/**
	 * (Job 225) A group's cell dragged: the ghost is its run's band, moved with
	 * the pointer along the axis; to is the number of the other units whose
	 * centre lies before the ghost's centre.
	 *
	 * @param {{x:number, y:number}} w world point of the pointer
	 */
	moveGroupDrag(w) {
		const D = this.#headDrag
		const a = this.#h.model.abs(D.id)
		if (!a) return
		const y = D.ax === 'y'
		const d = y ? w.y - D.w0.y : w.x - D.w0.x
		const start = (y ? D.run.y : D.run.x) + d
		const size = y ? D.run.h : D.run.w
		const ghost = y ? { x: a.x, y: a.y + start, w: a.w, h: size } : { x: a.x + start, y: a.y, w: size, h: a.h }
		const mid = start + size / 2
		D.to = D.units.filter((u) => (u.a + u.b) / 2 < mid).length
		let target = null
		if (D.to !== D.from && D.units.length > 0) {
			const u = D.units[Math.min(D.to, D.units.length - 1)]
			const where = D.to < D.units.length ? 'before' : 'after'
			target = y ? { x: a.x, y: a.y + u.a, w: a.w, h: u.b - u.a, where, beside: false } : { x: a.x + u.a, y: a.y, w: u.b - u.a, h: a.h, where, beside: true }
		}
		this.#h.renderer.setNodeDragPreview({ ghost, target })
		this.#h.wake()
	}
}
