/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Save as image (PNG)" (factory job 178), the pure parts: which items go
 * into the image, what is painted over them, how large the picture is and
 * what the file is called. The renderer (KonvaRenderer.renderImage) draws
 * the result in a detached Konva group of its own; the session
 * (BoardSession.exportPng) puts the steps together. Nothing here reads the
 * camera, the LOD or devicePixelRatio: the same board gives the same image
 * at every zoom.
 *
 * - exportIds: the whole board (every drawable item of the model) or a
 *   selection with the descendants of its items (descendantsOf: the content
 *   of a selected frame) and every connector whose two ends hang at items
 *   of that set; always in stacking order (compareOrder), only items with an
 *   index box (bboxOf; a connector that was never routed has none).
 * - exportPlan: what is painted over the items. Reaction rows like under a
 *   note at LOD 0 (nodes/reactions.js rowOf), with EXPORT_REACT: no
 *   smiley-plus button and no own reaction marked (the picture is passed
 *   on), at every export scale. Vote badges like planBadges with the tab's
 *   SceneVoteState (BoardSession.sceneVoteState: own votes, totals only
 *   while shown, live totals only while this tab shows them), but with
 *   markVotable off: no empty rings, no outline of the voting area. The
 *   badges keep their size at 100 % (EXPORT_BADGE_SCALE world units per
 *   screen px), so they grow and shrink with the items.
 * - exportBounds: the union of the items' bboxOf, the reaction rows and the
 *   badges (their width estimated with BADGE_DIGIT_W per digit).
 * - exportLayout: the bounds grown by EXPORT_MARGIN on every side (the
 *   frame); scale EXPORT_SCALE (2 px per unit, as sharp as 200 %) unless a
 *   side would exceed EXPORT_MAX_SIDE px or the area EXPORT_MAX_PIXELS px,
 *   then the largest scale that keeps both limits after rounding up
 *   (exportScale); the image is ⌈w · s⌉ × ⌈h · s⌉ px; scaled: s < 2.
 *   The session's second try passes s ÷ √2.
 * - exportFileName: "<board title> <YYYY-MM-DD>.png" with the local date,
 *   \ / : * ? " < > | and control characters as "_", the title trimmed and
 *   cut so the name has at most EXPORT_NAME_MAX characters (code points);
 *   without a title "Board <YYYY-MM-DD>.png". (Job 179) The extension is a
 *   parameter: the board's CSV is "<board title> <YYYY-MM-DD>.csv".
 *   (Job 181) titledFileName is its cleaning and cut with any suffix: the
 *   board file is "<board title>.knorke" (board/boardFile.js).
 */
import { fieldValue, typeInfo } from '../model/registry.js'
import { REACT_GAP, REACT_H, REACT_STROKE, VOTE_BADGE_FONT_PX, VOTE_DOT_BORDER_PX, VOTE_DOT_FONT_PX } from '../model/tokens.js'
import { badgeShapes, planBadges } from './nodes/badges.js'
import { rowOf } from './nodes/reactions.js'

/** Pixels per world unit of a full-size image (as sharp as the board at 200 %). */
export const EXPORT_SCALE = 2
/** White margin around the content, world units per side. */
export const EXPORT_MARGIN = 16
/** Longest side of an image (px), a cautious limit for tablets. */
export const EXPORT_MAX_SIDE = 16384
/** Largest area of an image (px), 2²⁵ (128 MB as RGBA). */
export const EXPORT_MAX_PIXELS = 2 ** 25
/** Longest file name (characters, code points). */
export const EXPORT_NAME_MAX = 100
/** Background of the image. */
export const EXPORT_BACKGROUND = '#ffffff'
/**
 * (Job 207) The page sizes of "Save as PDF…", in dialog order (job 217: here,
 * not in exportPdf.js, so the session and the dialog know them before the
 * lazy vector part is loaded).
 */
export const PDF_PAGE_KEYS = Object.freeze(['a4', 'a3', 'content'])
/** Camera scale the vote badges are painted at (their screen px are world units: their size at 100 %). */
export const EXPORT_BADGE_SCALE = 1
/** Width of a badge digit (bold VOTE_DOT_FONT_PX px), an upper estimate for the bounds (px at scale 1). */
export const BADGE_DIGIT_W = 0.6 * VOTE_DOT_FONT_PX

/**
 * The reaction state of an export (nodes/reactions.js ReactState): rows as
 * at LOD 0, without the button (canReact and everyNote false) and without an own
 * reaction (me null).
 */
export const EXPORT_REACT = Object.freeze({ canReact: false, me: null, hover: null, selected: null, hidden: null, scale: 1, everyNote: false })

/** The limits of exportScale. */
const LIMITS = Object.freeze({ maxSide: EXPORT_MAX_SIDE, maxPixels: EXPORT_MAX_PIXELS })

/**
 * @param {object} model SceneModel
 * @param {string} id item id
 * @return {boolean} a connector (routed, hit mode 'line')
 */
function isConnector(model, id) {
	return typeInfo(model.get(id)?.t).hit === 'line'
}

/**
 * The items of an image (see the file comment).
 *
 * @param {object} model SceneModel (get, has, ids, bboxOf, descendantsOf, sortByOrder)
 * @param {Iterable<string>|null} [selection] the selected ids; null: the whole board
 * @return {string[]} ids in stacking order (bottom first)
 */
export function exportIds(model, selection = null) {
	const drawable = (id) => model.has(id) && model.bboxOf(id) !== null
	if (selection === null || selection === undefined) {
		return model.sortByOrder([...model.ids()].filter(drawable))
	}
	const set = new Set()
	for (const id of selection) {
		if (!model.has(id)) continue
		set.add(id)
		for (const d of model.descendantsOf(id)) set.add(d)
	}
	for (const id of model.ids()) {
		if (set.has(id) || !isConnector(model, id)) continue
		const it = model.get(id)
		const ends = ['start', 'end'].map((w) => fieldValue(it, 'data.' + w)?.item)
		if (ends.every((x) => typeof x === 'string' && set.has(x))) set.add(id)
	}
	return model.sortByOrder([...set].filter(drawable))
}

/**
 * @typedef {{reactions: import('./nodes/reactions.js').ReactRow[], badges: (import('./nodes/badges.js').BadgePlan|null),
 *            color: (string|null), live: boolean}} ExportPlan
 *   reactions: the rows (add false, nothing mine); badges: the vote badges (null without a vote state;
 *   never a ring nor the outline of the voting area);
 *   color: #rrggbb of the own badges; live: the totals are a moderator's live count (hollow)
 */

/**
 * What is painted over the items (see the file comment).
 *
 * @param {object} model SceneModel
 * @param {string[]} ids the image's items (exportIds)
 * @param {object|null} vote the tab's SceneVoteState (BoardSession.sceneVoteState), null without a session
 * @return {ExportPlan}
 */
export function exportPlan(model, ids, vote) {
	const reactions = []
	for (const id of ids) {
		const row = rowOf(model, id, EXPORT_REACT)
		if (row) reactions.push(row)
	}
	if (!vote || !(vote.badges instanceof Map)) {
		return { reactions, badges: null, color: null, live: false }
	}
	const state = { badges: vote.badges, votable: () => false, markVotable: false, scope: null, color: vote.color }
	return { reactions, badges: planBadges(model, ids, state, { rings: false, scale: EXPORT_BADGE_SCALE }), color: vote.color, live: vote.live === true }
}

/**
 * Grows [minX, minY, maxX, maxY] by a rectangle rotated around a centre.
 *
 * @param {number[]} b the bounds so far (changed)
 * @param {{x:number, y:number, w:number, h:number, r:number}} a the note's absolute box (centre, rotation)
 * @param {number[]} rect [x0, y0, x1, y1] in the note's own coordinates (origin top-left)
 */
function addRotated(b, a, rect) {
	const t = (a.r || 0) * Math.PI / 180
	const cos = Math.cos(t)
	const sin = Math.sin(t)
	const cx = a.x + a.w / 2
	const cy = a.y + a.h / 2
	for (const [lx, ly] of [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]]) {
		const dx = lx - a.w / 2
		const dy = ly - a.h / 2
		add(b, cx + dx * cos - dy * sin, cy + dx * sin + dy * cos)
	}
}

/**
 * @param {number[]} b bounds [minX, minY, maxX, maxY] (changed)
 * @param {number} x x
 * @param {number} y y
 */
function add(b, x, y) {
	b[0] = Math.min(b[0], x)
	b[1] = Math.min(b[1], y)
	b[2] = Math.max(b[2], x)
	b[3] = Math.max(b[3], y)
}

/**
 * The content bounds of an image (see the file comment): the items' bboxOf,
 * the reaction rows and the vote badges.
 *
 * @param {object} model SceneModel
 * @param {string[]} ids the image's items
 * @param {ExportPlan|null} [plan] what is painted over them
 * @return {{x:number, y:number, w:number, h:number}|null} world rectangle, null without anything
 */
export function exportBounds(model, ids, plan = null) {
	const b = [Infinity, Infinity, -Infinity, -Infinity]
	for (const id of ids) {
		const e = model.bboxOf(id)
		if (!e) continue
		add(b, e.minX, e.minY)
		add(b, e.maxX, e.maxY)
	}
	const half = REACT_STROKE / 2
	for (const row of plan?.reactions ?? []) {
		const y0 = row.h + REACT_GAP
		addRotated(b, row, [-half, y0 - half, row.plan.width + half, y0 + REACT_H + half])
	}
	const px = 1 / EXPORT_BADGE_SCALE
	const edge = VOTE_DOT_BORDER_PX * px / 2
	for (const it of plan?.badges?.items ?? []) {
		// nodes/badges.js paintBadges (job 233: badgeShapes), with estimated digits, axis-parallel
		const s = badgeShapes(it, px, BADGE_DIGIT_W * VOTE_BADGE_FONT_PX / VOTE_DOT_FONT_PX * px, BADGE_DIGIT_W * px)
		for (const p of [s.own, s.total]) {
			if (!p) continue
			add(b, p.left - edge, p.cy - p.r - edge)
			add(b, p.right + edge, p.cy + p.r + edge)
		}
	}
	if (b[0] === Infinity) return null
	return { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }
}

/**
 * @param {number} k pixels (a whole number)
 * @param {number} len length (world)
 * @return {number} the largest scale s with ⌈len · s⌉ ≤ k
 */
function largestFor(k, len) {
	let s = k / len
	while (s > 0 && Math.ceil(len * s) > k) s -= s * Number.EPSILON * 4
	return s
}

/**
 * The scale of an image of w × h world units (see the file comment).
 *
 * @param {number} w width (world, the frame)
 * @param {number} h height
 * @param {{maxSide?: number, maxPixels?: number}} [limits] the limits (default EXPORT_MAX_SIDE, EXPORT_MAX_PIXELS)
 * @return {number} px per world unit, at most EXPORT_SCALE
 */
export function exportScale(w, h, limits = LIMITS) {
	const maxSide = limits.maxSide ?? EXPORT_MAX_SIDE
	const maxPixels = limits.maxPixels ?? EXPORT_MAX_PIXELS
	const fits = (s) => {
		const a = Math.ceil(w * s)
		const c = Math.ceil(h * s)
		return a <= maxSide && c <= maxSide && a * c <= maxPixels
	}
	if (!(w > 0 && h > 0) || fits(EXPORT_SCALE)) return EXPORT_SCALE
	let s = Math.min(EXPORT_SCALE, largestFor(maxSide, w), largestFor(maxSide, h), Math.sqrt(maxPixels / (w * h)))
	// rounding up may still break the area: lower one side by a pixel at a time, the larger scale first
	for (let i = 0; i < 1000 && !fits(s); i++) {
		const a = Math.ceil(w * s)
		const c = Math.ceil(h * s)
		s = Math.min(s, Math.max(largestFor(a - 1, w), largestFor(c - 1, h)))
	}
	return s
}

/**
 * @typedef {{frame: {x:number, y:number, w:number, h:number}, scale: number, width: number, height: number,
 *            scaled: boolean}} ExportLayout
 *   frame: the drawn world rectangle (bounds + margin); width, height: the image in px; scaled: scale < EXPORT_SCALE
 */

/**
 * The picture of an image (see the file comment).
 *
 * @param {{x:number, y:number, w:number, h:number}} bounds content bounds (exportBounds)
 * @param {number|null} [scale] a given scale (the second try), else exportScale of the frame
 * @return {ExportLayout}
 */
export function exportLayout(bounds, scale = null) {
	const m = EXPORT_MARGIN
	const frame = { x: bounds.x - m, y: bounds.y - m, w: bounds.w + 2 * m, h: bounds.h + 2 * m }
	const s = Number.isFinite(scale) && scale > 0 ? scale : exportScale(frame.w, frame.h)
	return {
		frame,
		scale: s,
		width: Math.max(1, Math.ceil(frame.w * s)),
		height: Math.max(1, Math.ceil(frame.h * s)),
		scaled: s < EXPORT_SCALE,
	}
}

/**
 * @param {Date} date a date
 * @return {string} its local calendar day YYYY-MM-DD
 */
export function localDay(date) {
	const pad = (n, w = 2) => String(n).padStart(w, '0')
	return pad(date.getFullYear(), 4) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/**
 * The file name of an export (see the file comment).
 *
 * @param {unknown} title board title
 * @param {Date} date the day of the export (local)
 * @param {string} [ext] extension without the dot (job 179: 'csv')
 * @return {string}
 */
export function exportFileName(title, date, ext = 'png') {
	return titledFileName(title, ' ' + localDay(date) + '.' + ext)
}

/**
 * The board title cleaned and cut as in exportFileName, then `suffix`
 * (job 181: the board file's ".knorke", without a date).
 *
 * @param {unknown} title board title
 * @param {string} suffix what follows the title, e.g. " 2026-10-25.png"
 * @return {string} at most EXPORT_NAME_MAX characters; "Board" + suffix without a title
 */
export function titledFileName(title, suffix) {
	// eslint-disable-next-line no-control-regex
	const clean = String(title ?? '').replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, '_').trim()
	const room = EXPORT_NAME_MAX - suffix.length
	const cut = Array.from(clean).slice(0, room).join('').trimEnd()
	return (cut === '' ? 'Board' : cut) + suffix
}
