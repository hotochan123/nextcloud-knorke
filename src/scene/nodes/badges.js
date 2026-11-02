/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Vote badges of mode vote (SPEC-M1 §6.3 "Modus vote", stage 3): ONE
 * Konva.Shape in the uiGroup (buildBadges) whose sceneFunc paints, in world
 * units of the camera and with sizes in screen px:
 * - the 2-px outline of the voting area (the scope frame), when markVotable
 *   is set and the frame exists; also at LOD 2
 * - per item in view, at its top-right corner (rotated with the item):
 *   its own votes as a circle in SceneVoteState.color with the number in
 *   contrastTextOn(color) (a number, never the color alone: WCAG 1.4.1);
 *   the total as a VOTE_TOTAL_FILL circle beside it while totals are shown
 *   (total !== null); with markVotable an EMPTY ring instead of the own
 *   circle on a votable item without an own vote (not at LOD 2)
 * - (job 149) with live the totals are a moderator's live count: the same
 *   pill at the same place, but hollow (the white edge, the pill in
 *   VOTE_TOTAL_FILL, a white body VOTE_RING_STROKE_PX smaller, the digits in
 *   VOTE_TOTAL_FILL), so it reads as "live", not as a result
 * Circles become pills for numbers with more digits. Nothing is a DOM
 * element and nothing is a node per badge: during a CSS gesture the badges
 * move and scale with the canvas, and a camera step costs one overlay draw.
 * (Stage 4, WebKit fixes) circles, pills and rings are fills only, edges
 * included (a stroke per badge was most of a badge painting in WebKit), and
 * each fill style is set once per group, not per badge.
 * Recorded decision (SPEC-M1 §6.3 "Stimm-Abzeichen" R20, K7 / RSC-02): the
 * painting goes by groups (own pills, then rings, then totals), and within a
 * pill group all white edges come first, then all bodies, then all digits.
 * Overlapping badges of one group therefore share one edge pass: their
 * bodies merge without a white edge between them and their digits may
 * overlap. This happens only where badges overlap (e.g. adjacent items at
 * LOD 2); it stays because of the measured WebKit win (revisit in the R-B
 * round if the overview looks wrong on the device). The call order is
 * pinned in tests/js/scene/badges.test.mjs.
 *
 * planBadges() decides what is drawn (and counts it: stats().voteState
 * counts what the last frame DREW, R16); paintBadges() draws a plan into a
 * 2D context. Both are pure (model and a context in, canvas calls out) and
 * unit tested in Node (tests/js/scene/badges.test.mjs).
 *
 * Factory job 233 (redesign docs/redesign/ P7, P11): the own count is a
 * VOTE_BADGE_PX circle in the own color, and the empty ring of a votable
 * item without an own vote a white VOTE_BADGE_PX circle with a ring and a
 * "+" in the own color. Their centre (BadgeItem cx, cy) lies on the top-right
 * corner, moved outwards along the corner's diagonal (rotated with the item)
 * by d = max(0, VOTE_BADGE_CLEAR_PX − pad · scale) screen px per axis, pad =
 * the item's text inset (padOf): the circle with its white edge stays off
 * the text box at every zoom. The total pill keeps the VOTE_DOT_* size and
 * stands one gap left of the badge on its centre line, or in its place
 * without one (badgeShapes, shared with the export bounds). badgeAt() is the
 * hit test of mode vote: VOTE_BADGE_HIT_MOUSE_PX / _TOUCH_PX around a drawn
 * badge, never through another item.
 */
import { typeInfo } from '../../model/registry.js'
import {
	FONT_FAMILY, SHAPE_TEXT_PADDING, STICKY_PADDING, VOTE_BADGE_CLEAR_PX, VOTE_BADGE_FONT_PX, VOTE_BADGE_PLUS_PX, VOTE_BADGE_PX,
	VOTE_BADGE_RING_PX, VOTE_DOT_BORDER, VOTE_DOT_BORDER_PX, VOTE_DOT_FONT_PX, VOTE_DOT_GAP_PX, VOTE_DOT_PAD_PX, VOTE_DOT_PX,
	VOTE_RING_STROKE_PX, VOTE_SCOPE_COLOR, VOTE_SCOPE_STROKE_PX, VOTE_TOTAL_FILL, contrastTextOn,
} from '../../model/tokens.js'
import { SHAPE_BASE } from './common.js'

/** Counters while nothing was drawn (stats().voteState, R16). */
export const BADGES_NONE = Object.freeze({ rings: 0, badges: 0, totals: 0, outline: null })

/**
 * @typedef {{badges:Map<string, {mine:number, total:(number|null)}>, votable:(id:string) => boolean,
 *            markVotable:boolean, scope:(string|null), color:string, live?:boolean}} BadgeState
 *   what the renderer paints from (SceneManager hands it over, votable already a
 *   safe boolean predicate: SceneVoteState.votable(id) === true, cached; live: job 149)
 * @typedef {{id:string, x:number, y:number, r:number, cx:number, cy:number, mine:number, total:(number|null), ring:boolean}} BadgeItem
 *   x, y: the item's top-right corner (world, rotated with the item), r: its rotation in degrees;
 *   cx, cy (job 233): the badge's centre (world) for the scale of the plan
 * @typedef {{items:BadgeItem[], outline:({id:string, x:number, y:number, w:number, h:number, r:number}|null),
 *            counts:{rings:number, badges:number, totals:number, outline:(string|null)}}} BadgePlan
 */

/**
 * The top-right corner of a box rotated (degrees, clockwise) around its centre.
 *
 * @param {{x:number, y:number, w:number, h:number, r:number}} a absolute box
 * @return {{x:number, y:number}} world point
 */
export function topRight(a) {
	if (!a.r) return { x: a.x + a.w, y: a.y }
	const t = a.r * Math.PI / 180
	const dx = a.w / 2
	const dy = -a.h / 2
	return { x: a.x + a.w / 2 + dx * Math.cos(t) - dy * Math.sin(t), y: a.y + a.h / 2 + dx * Math.sin(t) + dy * Math.cos(t) }
}

/**
 * (Job 233) The text inset of an item type: the badge keeps clear of the box inside it.
 *
 * @param {string} t item type
 * @return {number} world units
 */
export function padOf(t) {
	if (t === 'sticky') return STICKY_PADDING
	return t === 'shape' ? SHAPE_TEXT_PADDING : 0
}

/**
 * (Job 233) The centre of an item's badge: the top-right corner moved
 * outwards along the corner's diagonal (rotated with the item) by
 * d = max(0, VOTE_BADGE_CLEAR_PX − pad · scale) screen px per axis.
 *
 * @param {{x:number, y:number, w:number, h:number, r:number}} a absolute box
 * @param {number} pad text inset (world, padOf)
 * @param {number} scale camera scale
 * @return {{x:number, y:number}} world point
 */
export function badgeCentre(a, pad, scale) {
	const c = topRight(a)
	const d = Math.max(0, VOTE_BADGE_CLEAR_PX - pad * scale) / scale
	if (d === 0) return c
	const t = (a.r || 0) * Math.PI / 180
	return { x: c.x + d * Math.cos(t) + d * Math.sin(t), y: c.y + d * Math.sin(t) - d * Math.cos(t) }
}

/**
 * What the badge painting draws now.
 *
 * @param {object} model SceneModel
 * @param {Iterable<string>} ids the item ids in view (the renderer's culled set); items
 *   outside it get nothing, connectors never (they have no box)
 * @param {BadgeState} state voting state
 * @param {{rings?:boolean, offsetOf?:((id:string) => ({dx:number, dy:number}|null)), scale?:number}} [opts] rings:
 *   empty rings allowed (false at LOD 2); offsetOf: remote drag preview offset of an item; scale (job 233):
 *   camera scale of the badges' centres (default 1)
 * @return {BadgePlan} items in the order of ids, the scope outline, the counters of exactly this plan
 */
export function planBadges(model, ids, state, { rings = true, offsetOf = null, scale = 1 } = {}) {
	const counts = { rings: 0, badges: 0, totals: 0, outline: null }
	let outline = null
	const box = (id) => {
		const a = model.abs(id)
		if (!a) return null
		const off = offsetOf ? offsetOf(id) : null
		return off ? { ...a, x: a.x + off.dx, y: a.y + off.dy } : a
	}
	if (state.markVotable && typeof state.scope === 'string' && model.has(state.scope)) {
		const a = box(state.scope)
		if (a) {
			outline = { id: state.scope, ...a }
			counts.outline = state.scope
		}
	}
	const withRings = rings && state.markVotable
	const items = []
	for (const id of ids) {
		const it = model.get(id)
		if (!it || typeInfo(it.t).hit === 'line') continue
		const b = state.badges.get(id)
		const mine = b ? b.mine : 0
		const total = b ? b.total : null
		const ring = withRings && mine === 0 && state.votable(id) === true
		if (mine === 0 && total === null && !ring) continue
		const a = box(id)
		if (!a) continue
		const c = topRight(a)
		const m = badgeCentre(a, padOf(it.t), scale > 0 ? scale : 1)
		items.push({ id, x: c.x, y: c.y, r: a.r || 0, cx: m.x, cy: m.y, mine, total, ring })
		if (mine > 0) counts.badges++
		if (total !== null) counts.totals++
		if (ring) counts.rings++
	}
	return { items, outline, counts }
}

/**
 * Width of one pill (a circle for one digit): two half circles of radius
 * h / 2 joined by straight edges, VOTE_DOT_PAD_PX beside the digits.
 *
 * @param {string} text the number
 * @param {number} h height (world)
 * @param {number} px world units per screen px
 * @param {number} digitW width of one digit (world, in the pill's font)
 * @return {number} width (world)
 */
function pillW(text, h, px, digitW) {
	return Math.max(h, text.length * digitW + 2 * VOTE_DOT_PAD_PX * px)
}

/**
 * (Job 233) Where one item's badge and total stand (world), the layout of
 * paintBadges and of the export bounds: the own count as a VOTE_BADGE_PX
 * pill centred on (cx, cy), else with ring the "+" circle there; the total
 * as a VOTE_DOT_PX pill one gap left of either on the same centre line, or
 * centred on (cx, cy) without one.
 *
 * @param {BadgeItem} it plan item
 * @param {number} px world units per screen px
 * @param {number} badgeDigit width of one digit in the badge's font (world)
 * @param {number} totalDigit width of one digit in the total's font (world)
 * @return {{own: ({left:number, right:number, cy:number, r:number, text:string}|null),
 *           plus: ({cx:number, cy:number, r:number}|null),
 *           total: ({left:number, right:number, cy:number, r:number, text:string}|null)}}
 */
export function badgeShapes(it, px, badgeDigit, totalDigit) {
	const b = VOTE_BADGE_PX * px
	let own = null
	let plus = null
	let left = null
	if (it.mine > 0) {
		const text = String(it.mine)
		const w = pillW(text, b, px, badgeDigit)
		own = { left: it.cx - w / 2, right: it.cx + w / 2, cy: it.cy, r: b / 2, text }
		left = own.left
	} else if (it.ring) {
		plus = { cx: it.cx, cy: it.cy, r: b / 2 }
		left = it.cx - b / 2
	}
	let total = null
	if (it.total !== null) {
		const text = String(it.total)
		const h = VOTE_DOT_PX * px
		const w = pillW(text, h, px, totalDigit)
		const right = left !== null ? left - VOTE_DOT_GAP_PX * px : it.cx + h / 2
		total = { left: right - w, right, cy: it.cy, r: h / 2, text }
	}
	return { own, plus, total }
}

/**
 * Fills one pill outline, grown by d (shrunk for a negative d): the same two
 * half circles with radius r + d and the straight edges between them.
 *
 * @param {object} ctx 2D context
 * @param {{left:number, right:number, cy:number, r:number}} p pill
 * @param {number} d offset of the outline (world)
 */
function fillPill(ctx, p, d) {
	const r = Math.max(0, p.r + d)
	ctx.beginPath()
	ctx.arc(p.left + p.r, p.cy, r, Math.PI / 2, 3 * Math.PI / 2)
	ctx.arc(p.right - p.r, p.cy, r, -Math.PI / 2, Math.PI / 2)
	ctx.closePath()
	ctx.fill()
}

/**
 * Fills one circle.
 *
 * @param {object} ctx 2D context
 * @param {number} cx centre x (world)
 * @param {number} cy centre y (world)
 * @param {number} r radius (world)
 */
function fillDisc(ctx, cx, cy, r) {
	ctx.beginPath()
	ctx.arc(cx, cy, Math.max(0, r), 0, 2 * Math.PI)
	ctx.closePath()
	ctx.fill()
}

/**
 * Paints pills of one color (SPEC-M1 §9.5 WP-S4, WebKit fixes): no stroke.
 * The white edge is a fill of each pill grown by half the border width, the
 * body a fill of each pill shrunk by half of it – the pixels of a body with
 * radius r edged by a border-wide stroke on that outline, which in the lab
 * cost WebKit about three quarters of a badge painting. Fill styles are set
 * once per group (edges, bodies, digits in contrastTextOn(fill)), not per
 * badge; every fill stays a small path of its own. Overlapping pills of one
 * call share this one edge pass, so their bodies merge and their digits may
 * overlap (recorded decision K7, see the file header).
 *
 * @param {object} ctx 2D context
 * @param {Array<{left:number, right:number, cy:number, r:number, text:string}>} pills pills
 * @param {string} fill body color
 * @param {number} border edge width (world)
 */
function paintPills(ctx, pills, fill, border) {
	if (pills.length === 0) return
	ctx.fillStyle = VOTE_DOT_BORDER
	for (const p of pills) fillPill(ctx, p, border / 2)
	ctx.fillStyle = fill
	for (const p of pills) fillPill(ctx, p, -border / 2)
	ctx.fillStyle = contrastTextOn(fill)
	for (const p of pills) ctx.fillText(p.text, (p.left + p.right) / 2, p.cy)
}

/**
 * Paints the hollow "live" pills of a moderator's live count (job 149):
 * the same layout as paintPills, fills only, one fill style per group –
 * the white edge, the pill in `fill`, a white body `width` smaller (the
 * pixels of a `width`-wide outline in `fill`), then the digits in `fill`
 * (VOTE_TOTAL_FILL on white keeps the contrast of the result digits).
 *
 * @param {object} ctx 2D context
 * @param {Array<{left:number, right:number, cy:number, r:number, text:string}>} pills pills
 * @param {string} fill outline and digit color
 * @param {number} border edge width (world)
 * @param {number} width outline width (world)
 */
function paintLivePills(ctx, pills, fill, border, width) {
	if (pills.length === 0) return
	ctx.fillStyle = VOTE_DOT_BORDER
	for (const p of pills) fillPill(ctx, p, border / 2)
	ctx.fillStyle = fill
	for (const p of pills) fillPill(ctx, p, -border / 2)
	ctx.fillStyle = VOTE_DOT_BORDER
	for (const p of pills) fillPill(ctx, p, -border / 2 - width)
	ctx.fillStyle = fill
	for (const p of pills) ctx.fillText(p.text, (p.left + p.right) / 2, p.cy)
}

/**
 * Paints the "+" circles (job 233; before: empty rings), no stroke either:
 * per circle a disc in the own color with the outer radius, then a
 * VOTE_DOT_BORDER disc a ring width smaller – the pixels of a white disc
 * edged with a VOTE_BADGE_RING_PX ring – then the "+" in the own color as
 * two VOTE_BADGE_PLUS_PX bars, a ring width thick.
 *
 * @param {object} ctx 2D context
 * @param {Array<{cx:number, cy:number, r:number}>} rings centres and outer radii (world)
 * @param {string} color own color
 * @param {number} width ring and bar width (world)
 * @param {number} plus length of a bar (world)
 */
function paintPlus(ctx, rings, color, width, plus) {
	if (rings.length === 0) return
	ctx.fillStyle = color
	for (const g of rings) fillDisc(ctx, g.cx, g.cy, g.r)
	ctx.fillStyle = VOTE_DOT_BORDER
	for (const g of rings) fillDisc(ctx, g.cx, g.cy, g.r - width)
	ctx.fillStyle = color
	for (const g of rings) {
		ctx.fillRect(g.cx - plus / 2, g.cy - width / 2, plus, width)
		ctx.fillRect(g.cx - width / 2, g.cy - plus / 2, width, plus)
	}
}

/**
 * Paints a plan into a 2D context that already carries the camera transform
 * (world units): the scope outline, then per item its badge (own count or
 * "+" circle, job 233) at its centre and the total pill to the left of it
 * (badgeShapes). The
 * layout is per item; the painting goes by groups (own pills, rings, total
 * pills), so a fill style is set a few times per painting, not per badge.
 * With live (job 149) the total pills are the hollow live pills.
 *
 * @param {object} ctx 2D context (Konva.Context or a canvas context)
 * @param {BadgePlan} plan plan
 * @param {number} scale camera scale (screen px = world × scale)
 * @param {string} color #rrggbb of the own badges (SceneVoteState.color)
 * @param {{live?: boolean}} [o] live: the totals are a moderator's live count
 */
export function paintBadges(ctx, plan, scale, color, { live = false } = {}) {
	const px = 1 / scale
	const o = plan.outline
	if (o) {
		ctx.lineWidth = VOTE_SCOPE_STROKE_PX * px
		ctx.strokeStyle = VOTE_SCOPE_COLOR
		if (o.r) {
			const t = o.r * Math.PI / 180
			const cx = o.x + o.w / 2
			const cy = o.y + o.h / 2
			ctx.beginPath()
			for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
				const lx = dx * o.w / 2
				const ly = dy * o.h / 2
				ctx.lineTo(cx + lx * Math.cos(t) - ly * Math.sin(t), cy + lx * Math.sin(t) + ly * Math.cos(t))
			}
			ctx.closePath()
			ctx.stroke()
		} else {
			ctx.strokeRect(o.x, o.y, o.w, o.h)
		}
	}
	if (plan.items.length === 0) return
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	// one digit's width in each font (digits are tabular in the UI fonts)
	const badgeFont = `bold ${VOTE_BADGE_FONT_PX * px}px ${FONT_FAMILY}`
	const totalFont = `bold ${VOTE_DOT_FONT_PX * px}px ${FONT_FAMILY}`
	ctx.font = totalFont
	const totalDigit = ctx.measureText('0').width
	ctx.font = badgeFont
	const badgeDigit = ctx.measureText('0').width
	const own = []
	const rings = []
	const totals = []
	for (const it of plan.items) {
		const s = badgeShapes(it, px, badgeDigit, totalDigit)
		if (s.own) own.push(s.own)
		if (s.plus) rings.push(s.plus)
		if (s.total) totals.push(s.total)
	}
	const border = VOTE_DOT_BORDER_PX * px
	paintPills(ctx, own, color, border)
	paintPlus(ctx, rings, color, VOTE_BADGE_RING_PX * px, VOTE_BADGE_PLUS_PX * px)
	if (totals.length > 0) ctx.font = totalFont
	if (live === true) {
		paintLivePills(ctx, totals, VOTE_TOTAL_FILL, border, VOTE_RING_STROKE_PX * px)
	} else {
		paintPills(ctx, totals, VOTE_TOTAL_FILL, border)
	}
}

/**
 * (Job 233) The hit test of the badges in mode vote: the item whose drawn
 * badge (own count or "+") has its centre within radiusPx screen px of the
 * press. A press inside another item (hit, InputController.hitAt) belongs to
 * that item: then only its own badge counts. Of several badges the one of
 * the topmost item wins (compare: the model's paint order).
 *
 * @param {BadgePlan|null} plan the plan last painted
 * @param {{x:number, y:number}} w world point of the press
 * @param {number} scale camera scale
 * @param {number} radiusPx VOTE_BADGE_HIT_MOUSE_PX or VOTE_BADGE_HIT_TOUCH_PX
 * @param {string|null} hit the item under the press, else null
 * @param {((a:string, b:string) => number)|null} [compare] paint order (< 0: a below b)
 * @return {string|null} item id
 */
export function badgeAt(plan, w, scale, radiusPx, hit, compare = null) {
	let best = null
	for (const it of plan?.items ?? []) {
		if (!(it.mine > 0 || it.ring)) continue
		if (Math.hypot(it.cx - w.x, it.cy - w.y) * scale > radiusPx) continue
		if (hit !== null) {
			if (it.id === hit) return hit
			continue
		}
		if (best === null || (compare ? compare(best, it.id) < 0 : true)) best = it.id
	}
	return best
}

/**
 * The one badge node of the uiGroup.
 *
 * @param {{Shape:Function}} ctx builder context
 * @param {(context:object) => void} paint paints the badges into the Konva context
 * @return {object} Konva.Shape without hit graph
 */
export function buildBadges(ctx, paint) {
	const node = new ctx.Shape({
		...SHAPE_BASE,
		sceneFunc: (context) => paint(context),
	})
	node.transformsEnabled('position')
	return node
}
