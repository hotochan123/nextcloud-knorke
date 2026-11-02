/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The tag row of a note (factory job 191): ONE Konva.Shape in the note's
 * own node (nodes/sticky.js, above the text), so the tags rotate with the
 * note, lie in its stacking order (an item above the note covers them) and
 * move with it in every drag, preview and image. Its sceneFunc paints, in
 * the note's own coordinates and WORLD units (tokens.js TAG_*):
 * - LOD 0: the labels of the note's valid tags (model/tags.js noteTagIds:
 *   ids of the board's meta.tags only), in their order, in one row TAG_INSET
 *   above the bottom edge and inside the left and right edge; each in its
 *   tag colour with the name in contrastTextOn, "…" at the end of a name
 *   that does not fit TAG_LABEL_MAX_W (or the room left); the labels that
 *   do not fit become ONE "+n" chip (white, edged) at the end of the row
 * - LOD 1: one coloured stroke per tag (TAG_STROKE_W × TAG_STROKE_H) along
 *   the bottom edge, no text
 * - LOD 2: nothing (the coarse painting has no tags)
 * The widths are estimates (model/text.js labelGlyphWidth: an upper bound
 * per code point, the same on every client), so the scene's hit test of
 * "+n" (tagMoreAt) and the painting agree without measuring.
 *
 * tagRowPlan() and paintTagRow() are pure and unit tested in Node
 * (tests/js/scene/tags.test.mjs); tagReserve() is the band the text area of
 * a note with tags leaves free (display, auto font size and editor);
 * tagStat() is the form of stats().tags: {id, shown: [ids], more}.
 *
 * (Job 259) A note's dog ear (tokens.noteEar) takes its bottom right
 * corner: labels, "+n" and strokes end TAG_GAP left of it (tagRoom), and
 * noteTextReserve() keeps the text clear of it without tags.
 */
import { toLocal } from '../../model/geometry.js'
import { noteTagIds } from '../../model/tags.js'
import { labelGlyphWidth } from '../../model/text.js'
import {
	FONT_FAMILY, LOD_TEXT_SCALE, REACT_BORDER, REACT_TEXT, TAG_FONT_SIZE, TAG_GAP, TAG_H, TAG_INSET, TAG_LABEL_MAX_W, TAG_PAD_X,
	STICKY_PADDING, TAG_RADIUS, TAG_RESERVE, TAG_STROKE_H, TAG_STROKE_W, contrastTextOn, noteEar,
} from '../../model/tokens.js'
import { SHAPE_BASE } from './common.js'
import { roundedRect } from './locks.js'

const ELLIPSIS = '…'
/** The smallest label: its padding and about two characters. */
const MIN_LABEL_W = 2 * TAG_PAD_X + 2 * labelGlyphWidth(0x6d, TAG_FONT_SIZE)

/**
 * @typedef {{id: string, x: number, w: number, text: string, fill: string, color: string}} TagLabel
 * @typedef {{ids: string[], colors: string[], y: number, labels: TagLabel[], more: ({n: number, x: number, w: number}|null)}} TagPlan
 *   ids: the note's valid tags in order; colors: their colours; y: the top of the row (note coordinates)
 */

/**
 * (Job 259) The width of a note's tag row: from TAG_INSET to TAG_GAP left of
 * the dog ear (TAG_INSET from the right edge without one).
 *
 * @param {number} w the note's width
 * @param {number} h the note's height
 * @return {number} room (world units, ≥ 0)
 */
export function tagRoom(w, h) {
	const ear = noteEar(w, h)
	return Math.max(0, w - TAG_INSET - (ear > 0 ? ear + TAG_GAP : TAG_INSET))
}

/**
 * @param {string} s text
 * @return {number} its estimated width at TAG_FONT_SIZE (world units)
 */
export function tagTextWidth(s) {
	let w = 0
	for (const ch of s) w += labelGlyphWidth(ch.codePointAt(0), TAG_FONT_SIZE)
	return w
}

/**
 * @param {string} name a tag name
 * @param {number} maxW room for the text
 * @return {string} the name, or its longest prefix with "…" that fits ('' when not even that)
 */
export function fitTagName(name, maxW) {
	if (tagTextWidth(name) <= maxW) return name
	const cps = Array.from(name)
	const room = maxW - tagTextWidth(ELLIPSIS)
	let w = 0
	let n = 0
	while (n < cps.length && w + tagTextWidth(cps[n]) <= room) {
		w += tagTextWidth(cps[n])
		n++
	}
	return n === 0 ? '' : cps.slice(0, n).join('') + ELLIPSIS
}

/**
 * @param {number} n tags not shown
 * @return {number} the width of the chip "+n"
 */
export function moreWidth(n) {
	return 2 * TAG_PAD_X + tagTextWidth('+' + n)
}

/**
 * The tag row of a note (see the file comment).
 *
 * @param {object} item WireItem (a note)
 * @param {Map<string, {name: string, color: string}>|null} byId the board's tags (model/tags.js tagMap)
 * @param {number} w the note's width
 * @param {number} h the note's height
 * @return {TagPlan|null} null without a valid tag
 */
export function tagRowPlan(item, byId, w, h) {
	const ids = byId instanceof Map ? noteTagIds(item, byId) : []
	if (ids.length === 0) return null
	const room = tagRoom(w, h)
	const labels = []
	let x = 0
	let i = 0
	for (; i < ids.length; i++) {
		const tg = byId.get(ids[i])
		const left = ids.length - i - 1
		const avail = room - x - (left > 0 ? TAG_GAP + moreWidth(left) : 0)
		const want = Math.min(TAG_LABEL_MAX_W, 2 * TAG_PAD_X + tagTextWidth(tg.name))
		const lw = Math.min(want, avail)
		if (lw < Math.min(want, MIN_LABEL_W)) break
		const text = fitTagName(tg.name, lw - 2 * TAG_PAD_X)
		if (text === '') break
		labels.push({ id: tg.id, x: TAG_INSET + x, w: lw, text, fill: tg.color, color: contrastTextOn(tg.color) })
		x += lw + TAG_GAP
	}
	const n = ids.length - i
	const more = n > 0 ? { n, x: TAG_INSET + x, w: moreWidth(n) } : null
	return { ids, colors: ids.map((id) => byId.get(id).color), y: h - TAG_INSET - TAG_H, labels, more }
}

/**
 * Paints a plan in the note's own coordinates (the node's sceneFunc).
 *
 * @param {object} ctx 2D context (Konva.Context or a canvas context)
 * @param {TagPlan|null} plan the note's row
 * @param {number} lod level of detail (0 labels, 1 strokes, 2 nothing)
 * @param {number} w the note's width
 * @param {number} h the note's height
 * @return {number} labels, chips or strokes painted
 */
export function paintTagRow(ctx, plan, lod, w, h) {
	if (!plan || lod >= 2) return 0
	if (lod === 1) {
		const n = Math.min(plan.ids.length, 8)
		const room = tagRoom(w, h)
		const sw = Math.max(1, Math.min(TAG_STROKE_W, (room - (n - 1) * TAG_GAP) / n))
		for (let i = 0; i < n; i++) {
			ctx.fillStyle = plan.colors[i]
			ctx.fillRect(TAG_INSET + i * (sw + TAG_GAP), h - TAG_INSET - TAG_STROKE_H, sw, TAG_STROKE_H)
		}
		return n
	}
	const mid = plan.y + TAG_H / 2
	ctx.font = `${TAG_FONT_SIZE}px ${FONT_FAMILY}`
	ctx.textBaseline = 'middle'
	ctx.textAlign = 'left'
	for (const l of plan.labels) {
		roundedRect(ctx, l.x, plan.y, l.w, TAG_H, TAG_RADIUS)
		ctx.fillStyle = l.fill
		ctx.fill()
		ctx.fillStyle = l.color
		ctx.fillText(l.text, l.x + TAG_PAD_X, mid)
	}
	const more = plan.more
	if (more) {
		roundedRect(ctx, more.x, plan.y, more.w, TAG_H, TAG_RADIUS)
		ctx.fillStyle = '#ffffff'
		ctx.fill()
		ctx.lineWidth = 1
		ctx.strokeStyle = REACT_BORDER
		ctx.stroke()
		ctx.fillStyle = REACT_TEXT
		ctx.fillText('+' + more.n, more.x + TAG_PAD_X, mid)
	}
	return plan.labels.length + (more ? 1 : 0)
}

/**
 * The tag shape of a note's node.
 *
 * @param {{Shape: Function}} ctx builder context
 * @param {object} entry the note's entry (tagPlan, lod, parts.body)
 * @return {object} Konva.Shape without hit graph
 */
export function buildTagShape(ctx, entry) {
	const node = new ctx.Shape({
		...SHAPE_BASE,
		sceneFunc: (context) => {
			const body = entry.parts.body
			paintTagRow(context, entry.tagPlan, entry.lod, body.width(), body.height())
		},
	})
	node.transformsEnabled('position')
	return node
}

/**
 * @param {object} item WireItem
 * @param {Map<string, object>|null} byId the board's tags
 * @return {number} the band at the bottom of a note the text leaves free: TAG_RESERVE with a valid tag, else 0
 */
export function tagReserve(item, byId) {
	return byId instanceof Map && item?.t === 'sticky' && noteTagIds(item, byId).length > 0 ? TAG_RESERVE : 0
}

/**
 * (Job 259) The band at the bottom of a note its text area leaves free (in
 * addition to STICKY_PADDING): tagReserve, at least what keeps the text
 * clear of the dog ear (noteEar − STICKY_PADDING). Display, auto font size
 * and editor use it.
 *
 * @param {object} item WireItem (a note)
 * @param {Map<string, object>|null} byId the board's tags
 * @param {number} w the note's width
 * @param {number} h the note's height
 * @return {number} world units ≥ 0
 */
export function noteTextReserve(item, byId, w, h) {
	return Math.max(tagReserve(item, byId), noteEar(w, h) - STICKY_PADDING, 0)
}

/**
 * The "+n" chip of the topmost note at a world point (only an exact hit,
 * only at LOD 0).
 *
 * @param {object} model SceneModel
 * @param {{x: number, y: number}} w world point
 * @param {Map<string, object>|null} byId the board's tags
 * @param {number} scale camera scale
 * @return {{id: string, n: number, corners: Array<[number, number]>}|null} the note, the hidden count and the
 *   chip's four corners (world units)
 */
export function tagMoreAt(model, w, byId, scale) {
	if (!(byId instanceof Map) || byId.size === 0 || !(scale >= LOD_TEXT_SCALE)) return null
	const id = model.hitTest(w.x, w.y)
	const it = id === null ? null : model.get(id)
	if (!it || it.t !== 'sticky') return null
	const a = model.abs(id)
	const plan = a ? tagRowPlan(it, byId, a.w, a.h) : null
	const m = plan?.more
	if (!m) return null
	const [lx, ly] = toLocal(w.x, w.y, a.x, a.y, a.w, a.h, a.r || 0)
	if (lx < m.x || lx > m.x + m.w || ly < plan.y || ly > plan.y + TAG_H) return null
	const t = (a.r || 0) * Math.PI / 180
	const cos = Math.cos(t)
	const sin = Math.sin(t)
	const corners = [[m.x, plan.y], [m.x + m.w, plan.y], [m.x, plan.y + TAG_H], [m.x + m.w, plan.y + TAG_H]].map(([px, py]) => {
		const dx = px - a.w / 2
		const dy = py - a.h / 2
		return [a.x + a.w / 2 + dx * cos - dy * sin, a.y + a.h / 2 + dx * sin + dy * cos]
	})
	return { id, n: m.n, corners }
}

/**
 * @param {string} id note
 * @param {TagPlan} plan its row
 * @param {number} lod level of detail it is painted at (0 or 1)
 * @return {{id: string, shown: string[], more: number}} the form of stats().tags (LOD 1: every stroke shown)
 */
export function tagStat(id, plan, lod) {
	if (lod === 1) return { id, shown: plan.ids.slice(0, 8), more: 0 }
	return { id, shown: plan.labels.map((l) => l.id), more: plan.more ? plan.more.n : 0 }
}
