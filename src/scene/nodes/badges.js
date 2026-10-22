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
 */
import { typeInfo } from '../../model/registry.js'
import {
	FONT_FAMILY, VOTE_DOT_BORDER, VOTE_DOT_BORDER_PX, VOTE_DOT_FONT_PX, VOTE_DOT_GAP_PX, VOTE_DOT_INSET_PX, VOTE_DOT_PAD_PX,
	VOTE_DOT_PX, VOTE_RING_PX, VOTE_RING_STROKE_PX, VOTE_SCOPE_COLOR, VOTE_SCOPE_STROKE_PX, VOTE_TOTAL_FILL, contrastTextOn,
} from '../../model/tokens.js'
import { SHAPE_BASE } from './common.js'

/** Counters while nothing was drawn (stats().voteState, R16). */
export const BADGES_NONE = Object.freeze({ rings: 0, badges: 0, totals: 0, outline: null })

/**
 * @typedef {{badges:Map<string, {mine:number, total:(number|null)}>, votable:(id:string) => boolean,
 *            markVotable:boolean, scope:(string|null), color:string}} BadgeState
 *   what the renderer paints from (SceneManager hands it over, votable already a
 *   safe boolean predicate: SceneVoteState.votable(id) === true, cached)
 * @typedef {{id:string, x:number, y:number, r:number, mine:number, total:(number|null), ring:boolean}} BadgeItem
 *   x, y: the item's top-right corner (world, rotated with the item), r: its rotation in degrees
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
 * What the badge painting draws now.
 *
 * @param {object} model SceneModel
 * @param {Iterable<string>} ids the item ids in view (the renderer's culled set); items
 *   outside it get nothing, connectors never (they have no box)
 * @param {BadgeState} state voting state
 * @param {{rings?:boolean, offsetOf?:((id:string) => ({dx:number, dy:number}|null))}} [opts] rings:
 *   empty rings allowed (false at LOD 2); offsetOf: remote drag preview offset of an item
 * @return {BadgePlan} items in the order of ids, the scope outline, the counters of exactly this plan
 */
export function planBadges(model, ids, state, { rings = true, offsetOf = null } = {}) {
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
		items.push({ id, x: c.x, y: c.y, r: a.r || 0, mine, total, ring })
		if (mine > 0) counts.badges++
		if (total !== null) counts.totals++
		if (ring) counts.rings++
	}
	return { items, outline, counts }
}

/**
 * Layout of one pill (a circle for one digit) with its right edge at
 * `right`: two half circles of radius r around (left + r, cy) and
 * (right − r, cy), joined by straight edges.
 *
 * @param {number} right right edge (world)
 * @param {number} cy centre y (world)
 * @param {number} n number
 * @param {number} px world units per screen px
 * @param {number} digitW width of one digit (world, the font is set)
 * @return {{left:number, right:number, cy:number, r:number, text:string}} pill (world)
 */
function pillBox(right, cy, n, px, digitW) {
	const text = String(n)
	const h = VOTE_DOT_PX * px
	const w = Math.max(h, text.length * digitW + 2 * VOTE_DOT_PAD_PX * px)
	return { left: right - w, right, cy, r: h / 2, text }
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
 * Paints the empty rings, no stroke either: per ring a disc in the own color
 * with the ring's outer radius, then a VOTE_DOT_BORDER disc a ring width
 * smaller – the pixels of a white disc edged with a VOTE_RING_STROKE_PX
 * stroke just inside the outer radius.
 *
 * @param {object} ctx 2D context
 * @param {Array<{cx:number, cy:number, rr:number}>} rings centres and outer radii (world)
 * @param {string} color own color
 * @param {number} width ring width (world)
 */
function paintRings(ctx, rings, color, width) {
	if (rings.length === 0) return
	ctx.fillStyle = color
	for (const g of rings) fillDisc(ctx, g.cx, g.cy, g.rr)
	ctx.fillStyle = VOTE_DOT_BORDER
	for (const g of rings) fillDisc(ctx, g.cx, g.cy, g.rr - width)
}

/**
 * Paints a plan into a 2D context that already carries the camera transform
 * (world units): the scope outline, then per item its own circle (or the
 * empty ring) at the corner and the total circle to the left of it. The
 * layout is per item; the painting goes by groups (own pills, rings, total
 * pills), so a fill style is set a few times per painting, not per badge.
 *
 * @param {object} ctx 2D context (Konva.Context or a canvas context)
 * @param {BadgePlan} plan plan
 * @param {number} scale camera scale (screen px = world × scale)
 * @param {string} color #rrggbb of the own badges (SceneVoteState.color)
 */
export function paintBadges(ctx, plan, scale, color) {
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
	ctx.font = `bold ${VOTE_DOT_FONT_PX * px}px ${FONT_FAMILY}`
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	// one digit's width in this font (digits are tabular in the UI fonts)
	const digitW = ctx.measureText('0').width
	const inset = VOTE_DOT_INSET_PX * px
	const dot = VOTE_DOT_PX * px
	const gap = VOTE_DOT_GAP_PX * px
	const own = []
	const rings = []
	const totals = []
	for (const it of plan.items) {
		// the first circle's centre sits `inset` inside the corner, on the item
		const cy = it.y + inset
		let right = it.x - inset + dot / 2
		if (it.mine > 0) {
			const p = pillBox(right, cy, it.mine, px, digitW)
			own.push(p)
			right = p.left - gap
		} else if (it.ring) {
			const rr = (VOTE_RING_PX / 2) * px
			const cx = right - dot / 2
			rings.push({ cx, cy, rr })
			right = cx - rr - gap
		}
		if (it.total !== null) totals.push(pillBox(right, cy, it.total, px, digitW))
	}
	const border = VOTE_DOT_BORDER_PX * px
	paintPills(ctx, own, color, border)
	paintRings(ctx, rings, color, VOTE_RING_STROKE_PX * px)
	paintPills(ctx, totals, VOTE_TOTAL_FILL, border)
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
