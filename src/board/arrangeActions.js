/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Align", "Distribute", "Tidy up" and "Sort by color" (job 254: moved out
 * of board/actions.js, which re-exports every export of this module). Pure
 * like actions.js: reads the SceneModel, returns {ops, inverse}.
 *
 * M2 (SPEC-M1 §1.2 "Ausrichten"): alignItems moves the topmost non-connector
 * items of the selection to one edge or centre line of their union
 * (ALIGN_EDGES), with frame membership like moveItems.
 *
 * M2 (SPEC-M1 §1.2 "Verteilen"): distributeItems spreads the same items
 * (alignableIds, at least three) along one axis (DISTRIBUTE_AXES) to equal
 * gaps between neighbouring hulls; the two outermost stay put. With too
 * little room for that, equal steps between the centres instead.
 *
 * M2 (SPEC-M1 §1.2 "Aufräumen"): tidyItems snaps the same items
 * (alignableIds, at least two) to an exact grid: rows and columns from the
 * hull centres (order kept, empty cells stay empty), one whole-unit gap per
 * axis from today's mean track centres, each hull centred in its cell; the
 * top-left corner of the selection stays (rounded to whole units).
 *
 * Job 139 (sort notes by colour): sortNotesByColor lays the sortable notes
 * (sortableNotes: notes that are neither locked nor grouped; the loose ones
 * of the selection, or the direct children of one frame) out in one
 * near-square block per fill, the blocks side by side in the palette's
 * order; a frame grows until they fit. sortBlockName puts the name of one
 * block as a text item above it.
 *
 * Job 179 (save as CSV): readingOrder is the reading order of "Sort by
 * color", exported for the board's CSV (board/exportCsv.js).
 */
import { rotatedBBox } from '../model/geometry.js'
import { blocksOf, groupOf, movableIds } from '../model/groups.js'
import { ulid } from '../model/ids.js'
import { isLocked } from '../model/locks.js'
import { isCovered } from '../model/privateWriting.js'
import { checkField, fieldValue, typeInfo, TYPES } from '../model/registry.js'
import { LIGHT, shownColor } from '../model/tokens.js'
import { keyBetween } from '../model/zorder.js'
import { absOf, clampSize, clone, containerFor, isNum, placement, q2, round2 } from './actionsBase.js'

/** Edges and centre lines of "Align" (alignItems); the context bar reads this list. */
export const ALIGN_EDGES = Object.freeze(['left', 'center', 'right', 'top', 'middle', 'bottom'])
/** Axes of "Distribute" (distributeItems); the context bar reads this list. */
export const DISTRIBUTE_AXES = Object.freeze(['horizontal', 'vertical'])
/** Gap between the notes of one colour block of "Sort by color" (job 139). */
export const SORT_GAP = 20
/** Gap between two colour blocks of "Sort by color". */
export const SORT_BLOCK_GAP = 100
/** Margin between a frame's edges and its sorted notes ("Sort notes by color"). */
export const SORT_MARGIN = 60
/** Gap between the bottom edge of a block's name text and the block's top edge. */
export const SORT_NAME_GAP = 10
/**
 * An item whose shift of "Align", "Distribute" or "Tidy up" (alignItems,
 * distributeItems, tidyItems) is at most this (world units, plus float
 * noise) on both axes already counts as in place (withinTolerance). For
 * "Align" this only decides whether the click is empty (every item in
 * place); within an effective click such an item snaps onto the target as
 * well (shiftBlock with snap: a group block as a whole, a single item
 * through shiftItem). Positions sit on the 0.01 grid, so the
 * hull of a rotated item (or the centre of an odd width) only reaches its
 * target to ±0.005; without the tolerance a second click on the same command
 * would move some item by 0.01 again, and again (one invisible undo step per
 * click). The float margin is 1e-6: at |v| ≈ 1e7 (the server's limit)
 * neighbouring doubles lie about 1.9e-9 apart (3.7e-9 for hull edges up to
 * 2e7), and hull, sum with the parent and round2 add a few such steps of
 * noise; 1e-6 lies far above that and far below anything visible.
 */
const ALIGN_TOLERANCE = 0.01 + 1e-6
/**
 * Float noise of the gap of "Distribute": equal gaps from g ≥ −this on.
 * Items packed edge to edge (g = 0 in decimals) give g = ±3e-14 in floats,
 * and the sign may change once the inner items have moved; at a plain g ≥ 0
 * a second click would then switch to equal centre steps and move items
 * again (and back on the next). Unrotated items on the 0.01 grid give
 * g = 0 or |g| ≥ 0.01 / (n − 1), so no real overlap falls inside the margin.
 */
const GAP_NOISE = 1e-6

/**
 * @param {number} dx shift of "Align", "Distribute" or "Tidy up"
 * @param {number} dy shift
 * @return {boolean} both within ALIGN_TOLERANCE: the item counts as in place
 */
function withinTolerance(dx, dy) {
	return Math.abs(dx) <= ALIGN_TOLERANCE && Math.abs(dy) <= ALIGN_TOLERANCE
}

/**
 * The blocks of a selection that "Align" moves: known ids (each once), no
 * connectors (placement 'none'; unknown types count, as when moving), only
 * the topmost ones (parent null or not selected itself, like
 * BoardSession.nudge: a child of a selected frame moves with its frame)
 * and only movable ones (M2, R20: model/groups.js movableIds, no locked
 * item, no member of a group with a locked member). Grouped into blocks
 * (blocksOf): a fully selected group is ONE block, every other item a
 * block of its own. Selection v2 `alignable` is the number of blocks.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @return {string[][]} blocks in selection order, each with its ids in selection order
 */
export function alignableIds(model, ids) {
	const sel = new Set((ids ?? []).filter((id) => model.has(id)))
	const top = [...sel].filter((id) => {
		const it = model.get(id)
		if (typeInfo(it.t).placement === 'none') {
			return false
		}
		const p = it.parent ?? null
		return p === null || !sel.has(p)
	})
	return blocksOf(model, movableIds(model, top))
}

/**
 * @param {object} model SceneModel
 * @param {string[][]} blocks blocks (alignableIds)
 * @return {Array<{block: string[], b: number[]}>} each block with its hull [x0, y0, x1, y1], the
 *   axis-parallel union of the members' rotated absolute boxes (blocks without a box are left out)
 */
function blockHulls(model, blocks) {
	const out = []
	for (const block of blocks) {
		let b = null
		for (const id of block) {
			const a = model.abs(id)
			if (!a) {
				continue
			}
			const r = rotatedBBox(a.x, a.y, a.w, a.h, a.r || 0)
			b = b === null ? r : [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])]
		}
		if (b !== null) {
			out.push({ block, b })
		}
	}
	return out
}

/**
 * "Align" (SPEC-M1 §1.2 M2): every alignable item (alignableIds) to one edge
 * or centre line of U, the axis-parallel union of their rotated boxes
 * (rotatedBBox, like selectionFrame without connectors). Only one axis moves.
 *
 * - shift (dx, dy) = target minus the edge or centre of the item's hull;
 *   empty when every shift lies within ALIGN_TOLERANCE (an aligned
 *   selection: no op, no undo step, no parent chosen again)
 * - otherwise every item in selection order (shiftItem with snap):
 *   - shift above ALIGN_TOLERANCE: new absolute position = abs + (dx, dy);
 *     new parent = topmost fitting container under the new centre,
 *     excluding the aligned items and their descendants (as moveItems): an
 *     item may leave or enter a frame that is not aligned itself, an aligned
 *     frame is never a parent
 *   - shift within ALIGN_TOLERANCE: snapped as well (abs + (dx, dy), rounded
 *     relative to its current parent, which stays), an invisible move of at
 *     most 0.01 in the same undo step. Afterwards every item lies within
 *     0.005 of the target, so the next target moves by at most 0.005 and the
 *     next click on the same edge is empty, also after items were added to
 *     an aligned selection
 * - one patch {x, y, parent} per item (rule 2a, round2 like moveItems), no
 *   keep: a frame takes its children along; inverse = the stored placement;
 *   no patch when the rounded placement stays the same
 * - connectors neither count for U nor move (bound ends follow by routing)
 * - empty for an edge outside ALIGN_EDGES or fewer than two alignable items
 * - (M2, R20 Gruppieren) per block (alignableIds): a fully selected group
 *   is measured by its hull (the union of its members' rotated boxes) and
 *   every member gets the same shift, with one parent for the block
 *   (shiftBlock); "fewer than two" counts blocks
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {string} edge one of ALIGN_EDGES
 * @return {{ops: object[], inverse: object[]}}
 */
export function alignItems(model, ids, edge) {
	if (!ALIGN_EDGES.includes(edge)) {
		return { ops: [], inverse: [] }
	}
	const blocks = alignableIds(model, ids)
	const boxes = blockHulls(model, blocks)
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const { b } of boxes) {
		minX = Math.min(minX, b[0])
		minY = Math.min(minY, b[1])
		maxX = Math.max(maxX, b[2])
		maxY = Math.max(maxY, b[3])
	}
	if (boxes.length < 2) {
		return { ops: [], inverse: [] }
	}
	const exclude = withDescendants(model, blocks.flat())
	const shift = ([x0, y0, x1, y1]) => {
		switch (edge) {
		case 'left': return [minX - x0, 0]
		case 'center': return [(minX + maxX) / 2 - (x0 + x1) / 2, 0]
		case 'right': return [maxX - x1, 0]
		case 'top': return [0, minY - y0]
		case 'middle': return [0, (minY + maxY) / 2 - (y0 + y1) / 2]
		default: return [0, maxY - y1]
		}
	}
	const out = { ops: [], inverse: [] }
	const shifts = boxes.map(({ b }) => shift(b))
	if (shifts.every(([dx, dy]) => withinTolerance(dx, dy))) {
		// already aligned: no op, no undo step
		return out
	}
	boxes.forEach(({ block, b }, i) => {
		shiftBlock(model, block, b, shifts[i][0], shifts[i][1], exclude, out, true)
	})
	return out
}

/**
 * "Distribute" (SPEC-M1 §1.2 M2): the distributable items (alignableIds, at
 * least three) along one axis, by the axis-parallel hulls of their rotated
 * boxes (rotatedBBox, as alignItems). Only that axis moves.
 *
 * - order: by hull centre on the axis, stable (equal centres keep the
 *   selection order); the first (A) and the last (Z) never move
 * - equal gaps g = (Z.start − A.end − Σ inner lengths) / (n − 1); each inner
 *   item starts at the end of the previous TARGET + g (targets, not rounded
 *   positions, so a second click finds the same targets)
 * - g < 0 (the items overlap too much for equal gaps; below −GAP_NOISE):
 *   equal steps between the centres from A to Z instead; negative gaps could
 *   swap the order and move items again on every further click
 * - placement, frame membership, rounding and ALIGN_TOLERANCE as alignItems
 *   (shiftItem), but an item within ALIGN_TOLERANCE is not snapped; ops and
 *   inverses in the sorted order
 * - empty for an axis outside DISTRIBUTE_AXES, fewer than three
 *   distributable items or a distributed selection
 * - (M2, R20 Gruppieren) per block like alignItems: a fully selected group
 *   is one item with its hull, all members shift alike (shiftBlock)
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @param {string} axis one of DISTRIBUTE_AXES
 * @return {{ops: object[], inverse: object[]}}
 */
export function distributeItems(model, ids, axis) {
	if (!DISTRIBUTE_AXES.includes(axis)) {
		return { ops: [], inverse: [] }
	}
	const horizontal = axis === 'horizontal'
	const blocks = alignableIds(model, ids)
	const boxes = []
	for (const { block, b } of blockHulls(model, blocks)) {
		const s = horizontal ? b[0] : b[1]
		const e = horizontal ? b[2] : b[3]
		boxes.push({ block, b, s, e, w: e - s, c: (s + e) / 2 })
	}
	const n = boxes.length
	if (n < 3) {
		return { ops: [], inverse: [] }
	}
	// Array.prototype.sort is stable: equal centres keep the selection order
	boxes.sort((u, v) => u.c - v.c)
	const first = boxes[0]
	const last = boxes[n - 1]
	const inner = boxes.slice(1, -1)
	const g = (last.s - first.e - inner.reduce((sum, b) => sum + b.w, 0)) / (n - 1)
	const step = (last.c - first.c) / (n - 1)
	const exclude = withDescendants(model, blocks.flat())
	const gapped = g >= -GAP_NOISE
	const out = { ops: [], inverse: [] }
	// end of the previous target (equal gaps only)
	let end = first.e
	inner.forEach((b, i) => {
		const start = gapped ? end + g : first.c + (i + 1) * step - b.w / 2
		end = start + b.w
		const d = start - b.s
		shiftBlock(model, b.block, b.b, horizontal ? d : 0, horizontal ? 0 : d, exclude, out)
	})
	return out
}

/**
 * "Tidy up" (SPEC-M1 §1.2 M2): the alignable items (alignableIds, at least
 * two) onto an exact grid, by the axis-parallel hulls of their rotated boxes
 * (rotatedBBox, as alignItems).
 *
 * - rows (tidyTracks): stable by hull centre y (equal centres keep the
 *   selection order); an item joins the last row when its centre lies above
 *   the row's lowest bottom edge or its top edge above the centre of the
 *   row's last item, otherwise it opens the next row
 * - columns: the same on x, but never into a column that already holds an
 *   item of the same row (at most one item per cell)
 * - column width = widest hull, row height = highest hull; one gap per axis
 *   from the mean centres of the tracks (tidyGrid: a loose grid stays loose,
 *   a dense one dense), whole units, never negative, 0 for a single track;
 *   the grid starts at the top-left of the union, rounded
 * - each hull centred in its cell; empty cells stay empty, rows and columns
 *   keep their order. Whole-unit gaps and corner make a second click find
 *   the same grid (empty within ALIGN_TOLERANCE, no creeping)
 * - placement, frame membership, rounding and ALIGN_TOLERANCE as alignItems
 *   (shiftItem), but an item within ALIGN_TOLERANCE is not snapped; ops and
 *   inverses row by row, each row left to right
 * - empty for fewer than two alignable items or a tidy selection
 * - (M2, R20 Gruppieren) per block like alignItems: a fully selected group
 *   takes one cell with its hull, all members shift alike (shiftBlock)
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items
 * @return {{ops: object[], inverse: object[]}}
 */
export function tidyItems(model, ids) {
	const blocks = alignableIds(model, ids)
	const boxes = []
	for (const { block, b } of blockHulls(model, blocks)) {
		const [x0, y0, x1, y1] = b
		boxes.push({ block, b, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, row: 0, col: 0 })
	}
	if (boxes.length < 2) {
		return { ops: [], inverse: [] }
	}
	const rows = tidyTracks(boxes, 'y', null)
	const cols = tidyTracks(boxes, 'x', 'row')
	const top = tidyGrid(rows, Math.round(Math.min(...boxes.map((b) => b.y0))))
	const left = tidyGrid(cols, Math.round(Math.min(...boxes.map((b) => b.x0))))
	const exclude = withDescendants(model, blocks.flat())
	const out = { ops: [], inverse: [] }
	boxes.sort((u, v) => u.row - v.row || u.col - v.col)
	for (const b of boxes) {
		const dx = left[b.col] + (cols[b.col].size - (b.x1 - b.x0)) / 2 - b.x0
		const dy = top[b.row] + (rows[b.row].size - (b.y1 - b.y0)) / 2 - b.y0
		shiftBlock(model, b.block, b.b, dx, dy, exclude, out)
	}
	return out
}

/**
 * Rows or columns of "Tidy up": the boxes stably sorted by their centre on
 * the axis, each one joins the last track when its centre lies before the
 * track's far edge or its near edge before the centre of the track's last
 * box, otherwise it opens the next track. Writes the track index into the
 * box (`row` for y, `col` for x).
 *
 * @param {object[]} boxes hulls {x0, y0, x1, y1, cx, cy, row, col}
 * @param {'x'|'y'} axis axis
 * @param {string|null} apart a box never joins a track that already holds a
 *   box with the same value of this field (columns: one item per row)
 * @return {{size: number, centre: number}[]} tracks in order: size (largest
 *   extent of a box) and centre (mean centre of its boxes)
 */
function tidyTracks(boxes, axis, apart) {
	const [s, e, c, key] = axis === 'x' ? ['x0', 'x1', 'cx', 'col'] : ['y0', 'y1', 'cy', 'row']
	const tracks = []
	// Array.prototype.sort is stable: equal centres keep the selection order
	for (const b of [...boxes].sort((u, v) => u[c] - v[c])) {
		const t = tracks.at(-1)
		if (t && (b[c] < t.end || b[s] < t.mid) && !(apart && t.taken.has(b[apart]))) {
			t.end = Math.max(t.end, b[e])
			t.size = Math.max(t.size, b[e] - b[s])
			t.mid = b[c]
			t.sum += b[c]
			t.n++
		} else {
			tracks.push({ end: b[e], size: b[e] - b[s], mid: b[c], sum: b[c], n: 1, taken: apart ? new Set() : null })
		}
		b[key] = tracks.length - 1
		if (apart) {
			tracks.at(-1).taken.add(b[apart])
		}
	}
	return tracks.map((t) => ({ size: t.size, centre: t.sum / t.n }))
}

/**
 * The track starts of "Tidy up" with one gap between all tracks: the mean
 * over neighbours of (centre distance − half of both sizes), rounded to
 * whole units, never negative (0 for a single track). From the centres, not
 * from the bands (smallest start to largest end): every hand-placed offset
 * widens a band and shrinks the gap measured between bands, so a loose grid
 * came out much denser (in AK1 60/80 became 40/50, larger grids down to 0).
 * Once tidied, each centre lies within ALIGN_TOLERANCE of its cell centre,
 * so a second click measures gap ± 0.02 and rounds to the same gap.
 *
 * @param {{size: number, centre: number}[]} tracks rows or columns (tidyTracks)
 * @param {number} origin start of the first track (whole units)
 * @return {number[]} start of every track
 */
function tidyGrid(tracks, origin) {
	let sum = 0
	for (let i = 1; i < tracks.length; i++) {
		sum += tracks[i].centre - tracks[i - 1].centre - (tracks[i - 1].size + tracks[i].size) / 2
	}
	const gap = tracks.length < 2 ? 0 : Math.max(0, Math.round(sum / (tracks.length - 1)))
	const starts = [origin]
	for (let i = 1; i < tracks.length; i++) {
		starts.push(starts[i - 1] + tracks[i - 1].size + gap)
	}
	return starts
}

/**
 * The reading order of "Sort by color" (job 139), also the order of the
 * board's CSV (job 179, board/exportCsv.js): rows as "Tidy up" (tidyTracks
 * on y of the axis-parallel hulls, rotatedBBox of model.abs), within a row
 * by hull centre x; ties keep the order of ids. Ids without a box follow in
 * their order.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @return {string[]} the same ids in reading order
 */
export function readingOrder(model, ids) {
	const boxes = []
	const rest = []
	for (const id of ids) {
		const a = model.has(id) ? model.abs(id) : null
		if (!a) {
			rest.push(id)
			continue
		}
		const [x0, y0, x1, y1] = rotatedBBox(a.x, a.y, a.w, a.h, a.r || 0)
		boxes.push({ id, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, row: 0 })
	}
	return [...readingSort(boxes).map((b) => b.id), ...rest]
}

/**
 * @param {object[]} boxes hulls {x0, y0, x1, y1, cx, cy, row} (tidyTracks writes row)
 * @return {object[]} the boxes in reading order (readingOrder); Array.prototype.sort
 *   is stable, so equal places keep the order of boxes
 */
function readingSort(boxes) {
	tidyTracks(boxes, 'y', null)
	return [...boxes].sort((u, v) => u.row - v.row || u.cx - v.cx)
}

/**
 * The notes "Sort by color" moves (job 139): notes (type sticky) that are
 * neither locked nor in a group (groupOf null). Without a frame the loose
 * ones (parent null) of ids, in that order; with a frame its direct
 * children (childrenOf order), and none when it is no frame or locked.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items (ignored with a frame)
 * @param {{frame?: string|null}} [o] the frame whose notes are sorted
 * @return {string[]} the sortable notes, each once
 */
export function sortableNotes(model, ids, { frame = null } = {}) {
	const ok = (id) => {
		const it = model.get(id)
		// job 286: a covered note (private writing) has no colour here: it stays where it is
		return it.t === 'sticky' && !isLocked(it) && !isCovered(it) && groupOf(model, id) === null
	}
	if (frame !== null && frame !== undefined) {
		const f = model.has(frame) ? model.get(frame) : null
		if (!f || f.t !== 'frame' || isLocked(f)) {
			return []
		}
		return (model.childrenOf(frame) ?? []).filter((id) => model.has(id) && ok(id))
	}
	return [...new Set(ids ?? [])].filter((id) => model.has(id) && (model.get(id).parent ?? null) === null && ok(id))
}

/**
 * "Sort by color" (job 139, like Miro's clustering): the sortable notes
 * (sortableNotes, at least two) in one block per colour.
 *
 * - colour = fieldValue(note, 'style.fill') as it is drawn (job 227:
 *   tokens.shownColor, lower case); one block per exactly equal colour,
 *   the blocks in the order of the light tones (tokens.LIGHT), custom
 *   colours after them in the order of their first note
 * - reading order (before): rows as "Tidy up" (tidyTracks on y of the
 *   axis-parallel hulls), within a row by hull centre x; ties keep the order
 *   of ids (without a frame) or of childrenOf (with one)
 * - a block of k notes has c = ceil(√k) columns and ceil(k / c) rows, filled
 *   row by row in reading order; one cell for all = the widest × the highest
 *   hull of the sorted notes, each hull in the top-left corner of its cell;
 *   SORT_GAP inside a block, SORT_BLOCK_GAP between blocks, all blocks top
 *   aligned from left to right
 * - start: the top-left corner of the hulls' union, rounded to whole units;
 *   with a frame its corner + SORT_MARGIN. The frame gets one patch of w
 *   and/or h only where it is too small (SORT_MARGIN around the blocks,
 *   rounded up, at most the type's size limit); x and y stay, it never shrinks
 * - one patch {x, y, parent} per moved note (rule 2a, round2), the parent
 *   unchanged; none within ALIGN_TOLERANCE or when the rounded place stays.
 *   The frame's patch first, then the notes block by block. A sorted set
 *   gives no op
 * - blocks: one {color, x, y, w, h, parent} per block (world, absolute;
 *   parent = the frame or null), also when nothing moves
 *
 * @param {object} model SceneModel
 * @param {string[]} ids selected items (ignored with a frame)
 * @param {{frame?: string|null}} [o] sort the notes of this frame
 * @return {{ops: object[], inverse: object[], blocks: object[]}}
 */
export function sortNotesByColor(model, ids, { frame = null } = {}) {
	const out = { ops: [], inverse: [], blocks: [] }
	const fid = frame ?? null
	const boxes = []
	for (const id of sortableNotes(model, ids, { frame: fid })) {
		const a = model.abs(id)
		if (!a) {
			continue
		}
		const [x0, y0, x1, y1] = rotatedBBox(a.x, a.y, a.w, a.h, a.r || 0)
		const fill = fieldValue(model.get(id), 'style.fill')
		boxes.push({ id, a, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, row: 0, color: typeof fill === 'string' ? shownColor(fill) : '' })
	}
	if (boxes.length < 2) {
		return out
	}
	// equal places keep the order of ids or childrenOf
	const order = readingSort(boxes)
	const byColor = new Map()
	for (const b of order) {
		if (!byColor.has(b.color)) {
			byColor.set(b.color, [])
		}
		byColor.get(b.color).push(b)
	}
	const rank = (c) => (LIGHT.includes(c) ? LIGHT.indexOf(c) : LIGHT.length)
	// stable as well: custom colours keep the order of their first note
	const colors = [...byColor.keys()].sort((p, r) => rank(p) - rank(r))
	const cw = Math.max(...boxes.map((b) => b.x1 - b.x0))
	const ch = Math.max(...boxes.map((b) => b.y1 - b.y0))
	const fa = fid !== null ? model.abs(fid) : null
	const sx = fa ? fa.x + SORT_MARGIN : Math.round(Math.min(...boxes.map((b) => b.x0)))
	const sy = fa ? fa.y + SORT_MARGIN : Math.round(Math.min(...boxes.map((b) => b.y0)))
	const targets = []
	let x = sx
	let tallest = 0
	for (const color of colors) {
		const list = byColor.get(color)
		const cols = Math.ceil(Math.sqrt(list.length))
		const rows = Math.ceil(list.length / cols)
		list.forEach((b, i) => {
			targets.push({ b, tx: x + (i % cols) * (cw + SORT_GAP), ty: sy + Math.floor(i / cols) * (ch + SORT_GAP) })
		})
		const w = cols * cw + (cols - 1) * SORT_GAP
		const h = rows * ch + (rows - 1) * SORT_GAP
		out.blocks.push({ color, x, y: sy, w, h, parent: fid })
		tallest = Math.max(tallest, h)
		x += w + SORT_BLOCK_GAP
	}
	if (fa) {
		const f = model.get(fid)
		const max = typeInfo('frame').size[1]
		const p = {}
		const inv = {}
		const grow = (key, need) => {
			const v = Math.min(max, Math.ceil(round2(need)))
			if (f[key] < round2(need) && v > f[key]) {
				p[key] = v
				inv[key] = f[key]
			}
		}
		grow('w', x - SORT_BLOCK_GAP - sx + 2 * SORT_MARGIN)
		grow('h', tallest + 2 * SORT_MARGIN)
		if (Object.keys(p).length > 0) {
			out.ops.push({ o: 'patch', id: fid, p })
			out.inverse.push({ o: 'patch', id: fid, p: inv })
		}
	}
	for (const { b, tx, ty } of targets) {
		const dx = tx - b.x0
		const dy = ty - b.y0
		if (withinTolerance(dx, dy)) {
			continue
		}
		const item = model.get(b.id)
		const parent = item.parent ?? null
		const p = placement(model, { x: b.a.x + dx, y: b.a.y + dy }, parent)
		if (p.x === item.x && p.y === item.y) {
			continue
		}
		out.ops.push({ o: 'patch', id: b.id, p })
		out.inverse.push({ o: 'patch', id: b.id, p: { x: item.x, y: item.y, parent } })
	}
	return out
}

/**
 * The name of a sorted block (job 139, "Name this group…"): one text item
 * with the registry's default style, left-aligned (job 241: a new text is
 * centred, the name stays over the block's left edge), and the text, x = the block's x, w = its
 * width (inside the type's size), h = the measured height, its bottom edge
 * SORT_NAME_GAP above the block's top edge; parent = the block's frame while
 * the model still holds it, else null (loose). One put, inverse its remove.
 *
 * @param {object} model SceneModel
 * @param {{x: number, y: number, w: number, parent: (string|null)}} block a block of sortNotesByColor (world)
 * @param {string} text the name (already trimmed); empty or invalid for data.text: nothing
 * @param {{measure?: ((item: object) => (number|null))|null}} [o] measure: height of a text item (scene.measureTextHeight)
 * @param {() => string} [newId] id generator
 * @return {{ops: object[], inverse: object[]}}
 */
export function sortBlockName(model, block, text, { measure = null } = {}, newId = ulid) {
	const value = typeof text === 'string' ? text : ''
	if (value === '' || !block || !isNum(block.x) || !isNum(block.y) || !isNum(block.w) || !checkField('text', 'data.text', value).ok) {
		return { ops: [], inverse: [] }
	}
	const d = TYPES.text.defaults
	const id = newId()
	const w = q2(clampSize('text', block.w))
	const f = block.parent ?? null
	const parent = f !== null && model.has(f) && typeInfo(model.get(f).t).container ? f : null
	const style = { ...clone(d.style), align: 'left' }
	const measured = typeof measure === 'function' ? measure({ id, t: 'text', x: block.x, y: block.y, w, h: d.h, r: 0, data: { text: value }, style: clone(style) }) : null
	const h = q2(clampSize('text', isNum(measured) && measured > 0 ? measured : d.h))
	const pa = absOf(model, parent) ?? { x: 0, y: 0 }
	const put = {
		o: 'put',
		id,
		t: 'text',
		p: {
			x: q2(block.x - pa.x),
			y: q2(block.y - SORT_NAME_GAP - h - pa.y),
			w,
			h,
			r: 0,
			z: keyBetween(model.maxZ(TYPES.text.layer), null),
			parent,
			data: { text: value },
			style,
		},
	}
	return { ops: [put], inverse: [{ o: 'remove', id }] }
}

/**
 * @param {object} model SceneModel
 * @param {string[]} ids items
 * @return {Set<string>} the items and all their descendants
 */
function withDescendants(model, ids) {
	const set = new Set()
	for (const id of ids) {
		set.add(id)
		for (const d of model.descendantsOf(id) ?? []) {
			set.add(d)
		}
	}
	return set
}

/**
 * One item of "Align", "Distribute" or "Tidy up" by (dx, dy). Within
 * ALIGN_TOLERANCE: nothing without `snap` (Distribute, Tidy up), with `snap`
 * (alignItems) the shifted position rounded relative to the current parent,
 * which stays; the parent is never chosen again there. Otherwise the new
 * parent is the topmost fitting container under the new centre (not in
 * `exclude`, as moveItems). One patch of the whole placement group
 * {x, y, parent} (rule 2a, round2) plus its inverse go to `out`; none when
 * the rounded placement equals the stored one.
 *
 * @param {object} model SceneModel
 * @param {string} id item
 * @param {{x: number, y: number, w: number, h: number}} a its absolute box (model.abs)
 * @param {number} dx shift
 * @param {number} dy shift
 * @param {Set<string>} exclude never a parent (the moved items and their descendants)
 * @param {{ops: object[], inverse: object[]}} out receives the patch and its inverse
 * @param {boolean} [snap] also shift an item within ALIGN_TOLERANCE, keeping its parent
 */
function shiftItem(model, id, a, dx, dy, exclude, out, snap = false) {
	const near = withinTolerance(dx, dy)
	if (near && !snap) {
		// already in place: no patch, and the parent is not chosen again
		return
	}
	const item = model.get(id)
	const oldParent = item.parent ?? null
	const absPos = { x: a.x + dx, y: a.y + dy }
	// snapped (near): the parent stays, containerFor is not asked
	const parent = near ? oldParent : containerFor(model, item.t, absPos.x + a.w / 2, absPos.y + a.h / 2, exclude)
	const p = placement(model, absPos, parent)
	if (p.x === item.x && p.y === item.y && p.parent === oldParent) {
		return
	}
	out.ops.push({ o: 'patch', id, p })
	out.inverse.push({ o: 'patch', id, p: { x: item.x, y: item.y, parent: oldParent } })
}

/**
 * One block of "Align", "Distribute" or "Tidy up" by (dx, dy) (M2, R20
 * Gruppieren): a single item is shiftItem; a group block shifts every
 * member by the same amount, the parent chosen once for the block (the
 * topmost fitting container under the centre of the shifted hull, as
 * shiftItem; within ALIGN_TOLERANCE with `snap` each member keeps its
 * parent), one patch {x, y, parent} per member whose rounded placement
 * changes.
 *
 * @param {object} model SceneModel
 * @param {string[]} block ids of the block
 * @param {number[]} hull its hull [x0, y0, x1, y1] (blockHulls)
 * @param {number} dx shift
 * @param {number} dy shift
 * @param {Set<string>} exclude never a parent (the moved items and their descendants)
 * @param {{ops: object[], inverse: object[]}} out receives the patches and their inverses
 * @param {boolean} [snap] also shift a block within ALIGN_TOLERANCE, keeping the parents
 */
function shiftBlock(model, block, hull, dx, dy, exclude, out, snap = false) {
	if (block.length === 1) {
		shiftItem(model, block[0], model.abs(block[0]), dx, dy, exclude, out, snap)
		return
	}
	const near = withinTolerance(dx, dy)
	if (near && !snap) {
		return
	}
	const parent = near ? undefined : containerFor(model, model.get(block[0]).t, (hull[0] + hull[2]) / 2 + dx, (hull[1] + hull[3]) / 2 + dy, exclude)
	for (const id of block) {
		const item = model.get(id)
		const a = model.abs(id)
		const oldParent = item.parent ?? null
		const p = placement(model, { x: a.x + dx, y: a.y + dy }, parent === undefined ? oldParent : parent)
		if (p.x === item.x && p.y === item.y && p.parent === oldParent) {
			continue
		}
		out.ops.push({ o: 'patch', id, p })
		out.inverse.push({ o: 'patch', id, p: { x: item.x, y: item.y, parent: oldParent } })
	}
}
