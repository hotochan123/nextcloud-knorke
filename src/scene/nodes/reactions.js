/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The reaction row under a sticky note (factory job 172, pattern of
 * locks.js): ONE Konva.Shape in the uiGroup (buildReactions, listening
 * false, below every other child of the uiGroup) whose sceneFunc paints, in
 * WORLD units (tokens.js REACT_*), the row of every note in view, in the
 * note's own coordinates: REACT_GAP below its bottom edge, left aligned,
 * rotated with it. No DOM per note.
 *
 * What a row holds (rowOf, from the model and a ReactState):
 * - the pills of model/reactions.js rowPlan (summarize: count descending,
 *   then e), "+n" for the kinds that did not fit, and the smiley-plus
 *   button; the width of the button is kept free whenever one may react
 *   (canReact), so the row stays the same while the button hides
 * - the button is drawn when one may react and the note is not hidden
 *   (dragged, transformed or in the own text editor) and the note has a row
 *   already, or a mouse or hovering pen is over the note or its band
 *   (hover), or it is the one selected note (selected), or (job 183) it
 *   stands at every note (everyNote: a touch screen in mode vote or view);
 *   without reactions it stands where the row starts
 * - no row at all for other types, without anything to draw, and below
 *   LOD_TEXT_SCALE (neither row nor hit)
 *
 * reactionAt() is the hit test of the scene (pills, "+n", the button, in
 * the note's rotated axes; a hit through the tolerance alone never counts
 * inside a note, job 183), bandAt() the note whose band (REACT_BAND below
 * it, as wide as the note or its row) holds a point, reactionBand() the
 * band a single selected note's selection frame adds below (REACT_BAND
 * while it shows a row, else 0). planReactions() and paintReactions() are
 * pure and unit tested in Node (tests/js/scene/reactions.test.mjs);
 * rowStat() is the form of stats().reactions: {id, shown: [[e, n, mine]],
 * more, add}.
 */
import { toLocal } from '../../model/geometry.js'
import { fromHex, rowPlan, summarize } from '../../model/reactions.js'
import {
	FONT_FAMILY, LOD_TEXT_SCALE, REACT_ADD, REACT_BAND, REACT_BORDER, REACT_COUNT_SIZE, REACT_EMOJI, REACT_EMOJI_GAP,
	REACT_FILL, REACT_GAP, REACT_H, REACT_MINE_BORDER, REACT_MINE_FILL, REACT_MINE_STROKE, REACT_PAD, REACT_STROKE, REACT_TEXT,
} from '../../model/tokens.js'
import { icons } from '../../components/icons.js'
import { SHAPE_BASE } from './common.js'
import { roundedRect } from './locks.js'

/** Font of the emoji: the colour emoji fonts of the platforms first. */
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", ' + FONT_FAMILY

/**
 * @typedef {{canReact:boolean, me:(string|null), hover:(string|null), selected:(string|null),
 *            hidden:(Set<string>|null), scale:number, everyNote?:boolean}} ReactState
 *   canReact: one may react now (role, not frozen, mode; the scene's own rule: in mode edit only with
 *   the select tool); me: the own pid (mine); hover: the note under a mouse or hovering pen (its box or
 *   band); selected: the one selected note (else null); hidden: notes whose button hides (dragged,
 *   transformed, in the own text editor); scale: camera scale (LOD); everyNote (job 183): the button
 *   at every note that is not hidden (canReact on a touch screen in mode vote or view; only true counts)
 * @typedef {{id:string, x:number, y:number, w:number, h:number, r:number,
 *            plan:ReturnType<typeof rowPlan>, add:boolean}} ReactRow
 *   x, y, w, h, r: the note's absolute box; plan: its row (x from the note's left edge); add: the button is drawn
 * @typedef {{id:string, kind:('pill'|'more'|'add'), e:(string|null), x:number, w:number, row:ReactRow}} ReactHit
 */

/**
 * How far a row reaches out of its note's box at most (world): its band
 * below, and to the right "+n" and the button of a row in which no pill
 * fits (moreWidth(999) + REACT_SPACING + REACT_ADD beyond the smallest note).
 */
const ROW_REACH = REACT_BAND + 64

/** The state without a row anywhere. */
export const REACT_NONE = Object.freeze({ canReact: false, me: null, hover: null, selected: null, hidden: null, scale: 1, everyNote: false })

/**
 * The row of one note (see the file comment).
 *
 * @param {object} model SceneModel
 * @param {string} id item id
 * @param {ReactState} state state
 * @param {((id:string) => ({dx:number, dy:number}|null))|null} [offsetOf] remote drag preview offset
 * @return {ReactRow|null}
 */
export function rowOf(model, id, state, offsetOf = null) {
	const it = model.get(id)
	if (!it || it.t !== 'sticky' || !(state?.scale >= LOD_TEXT_SCALE)) return null
	const a = model.abs(id)
	if (!a) return null
	const summary = summarize(it, state.me)
	const canReact = state.canReact === true
	const hidden = state.hidden?.has(id) === true
	const add = canReact && !hidden && (summary.length > 0 || state.everyNote === true || state.hover === id || state.selected === id)
	if (summary.length === 0 && !add) return null
	const off = offsetOf ? offsetOf(id) : null
	return {
		id,
		x: off ? a.x + off.dx : a.x,
		y: off ? a.y + off.dy : a.y,
		w: a.w,
		h: a.h,
		r: a.r || 0,
		plan: rowPlan(summary, a.w, { add: canReact }),
		add,
	}
}

/**
 * The rows of the notes in view, in the order of ids.
 *
 * @param {object} model SceneModel
 * @param {Iterable<string>} ids item ids in view
 * @param {ReactState} state state
 * @param {((id:string) => ({dx:number, dy:number}|null))|null} [offsetOf] remote drag preview offset
 * @return {ReactRow[]}
 */
export function planReactions(model, ids, state, offsetOf = null) {
	const out = []
	if (!(state?.scale >= LOD_TEXT_SCALE)) return out
	for (const id of ids) {
		const row = rowOf(model, id, state, offsetOf)
		if (row) out.push(row)
	}
	return out
}

/**
 * @param {ReactRow} row row
 * @return {{id:string, shown:Array<[string, number, boolean]>, more:number, add:boolean}} the form of stats().reactions
 */
export function rowStat(row) {
	return { id: row.id, shown: row.plan.pills.map((p) => [p.e, p.n, p.mine]), more: row.plan.more ? row.plan.more.n : 0, add: row.add }
}

/**
 * The parts of a row as drawn (local x from the note's left edge): pills,
 * "+n" and, when drawn, the button.
 *
 * @param {ReactRow} row row
 * @return {Array<{kind:('pill'|'more'|'add'), e:(string|null), x:number, w:number}>}
 */
export function rowParts(row) {
	const out = row.plan.pills.map((p) => ({ kind: 'pill', e: p.e, x: p.x, w: p.w }))
	if (row.plan.more) out.push({ kind: 'more', e: null, x: row.plan.more.x, w: row.plan.more.w })
	if (row.add && row.plan.add) out.push({ kind: 'add', e: null, x: row.plan.add.x, w: row.plan.add.w })
	return out
}

/**
 * The candidates near a world point: stickies whose box lies within reach,
 * topmost first.
 *
 * @param {object} model SceneModel
 * @param {{x:number, y:number}} w world point
 * @param {number} reach half the side of the square around w (world)
 * @return {string[]}
 */
function nearNotes(model, w, reach) {
	const ids = model.query(w.x - reach, w.y - reach, w.x + reach, w.y + reach)
		.map((e) => e.id)
		.filter((id) => model.get(id)?.t === 'sticky')
	return ids.sort((a, b) => model.compareOrder(b, a))
}

/**
 * @param {object} model SceneModel
 * @param {{x:number, y:number}} w world point
 * @param {string[]} ids candidate stickies (nearNotes)
 * @return {boolean} w lies in the (rotated) box of one of them
 */
function inNote(model, w, ids) {
	for (const id of ids) {
		const a = model.abs(id)
		if (!a) continue
		const [lx, ly] = toLocal(w.x, w.y, a.x, a.y, a.w, a.h, a.r || 0)
		if (lx >= 0 && lx <= a.w && ly >= 0 && ly <= a.h) return true
	}
	return false
}

/**
 * The part of a row under a world point (the hit test of the scene). Exact
 * hits first (the topmost note), then the nearest part within tolWorld,
 * never inside the note's own box and (job 183) never inside any note: a
 * point in a note just below another note's row belongs to that note.
 *
 * @param {object} model SceneModel
 * @param {{x:number, y:number}} w world point
 * @param {ReactState} state state
 * @param {{tolWorld?:number, offsetOf?:((id:string) => ({dx:number, dy:number}|null))|null, exact?:boolean}} [o]
 *   tolerance (world units); exact: no tolerance at all
 * @return {ReactHit|null}
 */
export function reactionAt(model, w, state, { tolWorld = 0, offsetOf = null, exact = false } = {}) {
	if (!w || !(state?.scale >= LOD_TEXT_SCALE)) return null
	const tol = exact ? 0 : Math.max(0, tolWorld || 0)
	let best = null
	let bestD = Infinity
	const near = nearNotes(model, w, ROW_REACH + tol)
	for (const id of near) {
		const row = rowOf(model, id, state, offsetOf)
		if (!row) continue
		const [lx, ly] = toLocal(w.x, w.y, row.x, row.y, row.w, row.h, row.r)
		const y0 = row.h + REACT_GAP
		const dy = ly < y0 ? y0 - ly : ly > y0 + REACT_H ? ly - y0 - REACT_H : 0
		// the tolerance never reaches into the note itself
		if (dy > tol || ly < row.h) continue
		for (const p of rowParts(row)) {
			const dx = lx < p.x ? p.x - lx : lx > p.x + p.w ? lx - p.x - p.w : 0
			if (dx > tol) continue
			if (dx === 0 && dy === 0) return { id, kind: p.kind, e: p.e, x: p.x, w: p.w, row }
			const d = Math.hypot(dx, dy)
			if (d < bestD) {
				bestD = d
				best = { id, kind: p.kind, e: p.e, x: p.x, w: p.w, row }
			}
		}
	}
	return best !== null && inNote(model, w, near) ? null : best
}

/**
 * The note whose band holds a world point: REACT_BAND below its bottom
 * edge, as wide as the note or its row (whichever is wider), in its rotated
 * axes; the topmost one. Notes without a row count with their own width.
 *
 * @param {object} model SceneModel
 * @param {{x:number, y:number}} w world point
 * @param {ReactState} state state (the row width when canReact)
 * @return {string|null}
 */
export function bandAt(model, w, state) {
	if (!w || !(state?.scale >= LOD_TEXT_SCALE)) return null
	for (const id of nearNotes(model, w, ROW_REACH)) {
		const a = model.abs(id)
		if (!a) continue
		const row = rowOf(model, id, { ...state, hover: id })
		const width = Math.max(a.w, row ? row.plan.width : 0)
		const [lx, ly] = toLocal(w.x, w.y, a.x, a.y, a.w, a.h, a.r || 0)
		if (lx >= 0 && lx <= width && ly >= a.h && ly <= a.h + REACT_BAND) return id
	}
	return null
}

/**
 * The band a note's selection frame adds below it (job 172): REACT_BAND
 * while the note shows a row (pills or the button), else 0.
 *
 * @param {object} model SceneModel
 * @param {string|null} id item id
 * @param {ReactState} state state
 * @return {number} world units
 */
export function reactionBand(model, id, state) {
	return typeof id === 'string' && rowOf(model, id, state) !== null ? REACT_BAND : 0
}

/** The smiley-plus icon as a Path2D, once per realm (null where the realm has none, e.g. Node). */
let iconPath
/** @return {object|null} Path2D of icons.emoticonPlus (24 × 24 units) */
function addIcon() {
	if (iconPath === undefined) {
		iconPath = typeof Path2D === 'function' ? new Path2D(icons.emoticonPlus) : null
	}
	return iconPath
}

/**
 * One pill shape: REACT_FILL with a REACT_BORDER edge, or for the own one
 * REACT_MINE_FILL with a REACT_MINE_BORDER edge.
 *
 * @param {object} ctx 2D context
 * @param {number} x left (local)
 * @param {number} y top (local)
 * @param {number} w width
 * @param {boolean} mine the own reaction
 */
function pill(ctx, x, y, w, mine) {
	roundedRect(ctx, x, y, w, REACT_H, REACT_H / 2)
	ctx.fillStyle = mine ? REACT_MINE_FILL : REACT_FILL
	ctx.fill()
	ctx.strokeStyle = mine ? REACT_MINE_BORDER : REACT_BORDER
	ctx.lineWidth = mine ? REACT_MINE_STROKE : REACT_STROKE
	ctx.stroke()
}

/**
 * Paints rows into a 2D context that already carries the camera transform
 * (world units): per row, in the note's coordinates, the pills with emoji
 * and count, "+n" and the button with its icon.
 *
 * @param {object} ctx 2D context (Konva.Context or a canvas context)
 * @param {ReactRow[]} rows rows (planReactions)
 * @return {number} rows painted
 */
export function paintReactions(ctx, rows) {
	if (!Array.isArray(rows) || rows.length === 0) return 0
	for (const row of rows) {
		ctx.save()
		ctx.translate(row.x + row.w / 2, row.y + row.h / 2)
		if (row.r) ctx.rotate(row.r * Math.PI / 180)
		ctx.translate(-row.w / 2, -row.h / 2)
		const y0 = row.h + REACT_GAP
		const mid = y0 + REACT_H / 2
		ctx.textBaseline = 'middle'
		ctx.textAlign = 'left'
		for (const p of row.plan.pills) {
			pill(ctx, p.x, y0, p.w, p.mine)
			ctx.fillStyle = REACT_TEXT
			ctx.font = `${REACT_EMOJI}px ${EMOJI_FONT}`
			ctx.fillText(fromHex(p.e), p.x + REACT_PAD, mid + 1)
			ctx.font = `${REACT_COUNT_SIZE}px ${FONT_FAMILY}`
			ctx.fillText(String(p.n), p.x + REACT_PAD + REACT_EMOJI + REACT_EMOJI_GAP, mid)
		}
		const more = row.plan.more
		if (more) {
			pill(ctx, more.x, y0, more.w, false)
			ctx.fillStyle = REACT_TEXT
			ctx.font = `${REACT_COUNT_SIZE}px ${FONT_FAMILY}`
			ctx.fillText('+' + more.n, more.x + REACT_PAD, mid)
		}
		const add = row.add ? row.plan.add : null
		if (add) {
			pill(ctx, add.x, y0, REACT_ADD, false)
			const icon = addIcon()
			const s = (REACT_ADD - 2 * 4) / 24
			ctx.save()
			ctx.translate(add.x + 4, y0 + 4)
			ctx.scale(s, s)
			ctx.fillStyle = REACT_TEXT
			if (icon) {
				ctx.fill(icon)
			} else {
				ctx.fillRect(11, 5, 2, 14)
				ctx.fillRect(5, 11, 14, 2)
			}
			ctx.restore()
		}
		ctx.restore()
	}
	return rows.length
}

/**
 * The one reaction node of the uiGroup.
 *
 * @param {{Shape:Function}} ctx builder context
 * @param {(context:object) => void} paint paints the rows into the Konva context
 * @return {object} Konva.Shape without hit graph
 */
export function buildReactions(ctx, paint) {
	const node = new ctx.Shape({
		...SHAPE_BASE,
		sceneFunc: (context) => paint(context),
	})
	node.transformsEnabled('position')
	return node
}
