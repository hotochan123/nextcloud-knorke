/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Vote badges (src/scene/nodes/badges.js; SPEC-M1 §6.3 "Modus vote", R16
 * CLI-03, CLI-04, decisions S-9, S-13), pure in Node with the real
 * SceneModel and a recording 2D context:
 * - topRight: the item's own top-right corner, rotated with it
 * - planBadges: per item in view its own votes (mine > 0), its total
 *   (total !== null) and, with markVotable, an empty ring on a votable item
 *   (votable(id) === true) without an own vote; no rings at LOD 2 (rings:
 *   false); the outline of the scope frame with markVotable; connectors and
 *   items outside the given ids get nothing; the counters are exactly what
 *   the plan draws (stats().voteState counts what is drawn)
 * - paintBadges: the outline 2 px wide, the own circle in the state color
 *   with the digits in contrastTextOn(color) (≥ 4.5:1 for every PALETTE
 *   entry, also with upper-case hex, S-9), the empty ring, the total circle
 *   left of it, pills for longer numbers; all sizes in screen px. (Stage 4,
 *   WP-S4 WebKit fixes) fills only: the white edge of a circle or pill is a
 *   fill grown by half VOTE_DOT_BORDER_PX under a body shrunk by half of it,
 *   the ring a disc in the own color under a VOTE_DOT_BORDER disc one ring
 *   width smaller – exactly the pixels of the former stroke; no stroke at
 *   all besides the scope outline, and the fill styles are set once per
 *   group (edges, bodies, digits; ring, inside), however many badges
 * - (K7, RSC-02, SPEC-M1 §6.3 R20) the batching is a recorded decision: two
 *   overlapping own pills at LOD 2 are painted edge, edge, body, body,
 *   digit, digit, so their bodies merge and digits may overlap
 * - buildBadges: one Konva.Shape without hit graph whose sceneFunc paints
 * - (job 233) the badge: a VOTE_BADGE_PX circle for the own count, a white
 *   "+" circle for a votable item without one; its centre on the top-right
 *   corner moved out by max(0, VOTE_BADGE_CLEAR_PX − pad · scale) px per
 *   axis, so it never covers the text box (notes, shapes, text, rotated,
 *   zoom 0.1–4); badgeAt hits 16 px (mouse) / 22 px (pen, finger) around a
 *   drawn badge, never through another item, the topmost of several
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { BADGES_NONE, badgeAt, badgeCentre, badgeShapes, buildBadges, padOf, paintBadges, planBadges, topRight } from '../../../src/scene/nodes/badges.js'
import {
	FONT_FAMILY, LOD2_ENTER, SHAPE_TEXT_PADDING, STICKY_PADDING, VOTE_BADGE_CLEAR_PX, VOTE_BADGE_FONT_PX, VOTE_BADGE_HIT_MOUSE_PX,
	VOTE_BADGE_HIT_TOUCH_PX, VOTE_BADGE_PLUS_PX, VOTE_BADGE_PX, VOTE_BADGE_RING_PX, VOTE_DOT_BORDER, VOTE_DOT_BORDER_PX, VOTE_DOT_GAP_PX,
	VOTE_DOT_PAD_PX, VOTE_DOT_PX, VOTE_RING_STROKE_PX, VOTE_SCOPE_COLOR, VOTE_SCOPE_STROKE_PX, VOTE_TOTAL_FILL, contrastTextOn,
} from '../../../src/model/tokens.js'
import { PALETTE } from '../../../src/sync/presence.js'
import { frameItem, note } from './sceneHarness.mjs'

const id = (n) => '01JB' + String(n).padStart(22, '0')
const A = id(1)
const B = id(2)
const C = id(3)
const D = id(4)
const F = id(9)
const L = id(8)
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/** @return {SceneModel} notes A–D in a row, frame F, a connector L */
function board() {
	const m = new SceneModel()
	m.load([
		frameItem(F, { x: -100, y: -100, w: 2000, h: 600 }),
		note(A, { x: 0, y: 0 }), note(B, { x: 300, y: 0 }), note(C, { x: 600, y: 0 }), note(D, { x: 900, y: 0, r: 90 }),
		{ id: L, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b0', parent: null, data: { start: { item: A }, end: { item: B }, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2 } },
	])
	return m
}

/**
 * @param {object} [o] fields replacing the defaults
 * @return {object} BadgeState
 */
const state = (o = {}) => ({
	badges: new Map(),
	votable: (x) => [A, B, C, D, L].includes(x),
	markVotable: true,
	scope: F,
	color: '#c62828',
	...o,
})

/** Recording 2D context: every call and property set in order; measureText 0.6 em per character. */
function recorder() {
	const calls = []
	const ctx = { calls, font: '10px sans-serif' }
	for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'textAlign', 'textBaseline']) {
		let v
		Object.defineProperty(ctx, p, { get: () => v, set: (x) => { v = x; calls.push(['set', p, x]) } })
	}
	let font = ctx.font
	Object.defineProperty(ctx, 'font', { get: () => font, set: (x) => { font = x; calls.push(['set', 'font', x]) } })
	for (const m of ['beginPath', 'closePath', 'arc', 'lineTo', 'fill', 'stroke', 'strokeRect', 'fillText', 'fillRect']) {
		ctx[m] = (...args) => calls.push([m, ...args, m === 'fill' || m === 'fillText' || m === 'fillRect' ? ctx.fillStyle : m === 'stroke' || m === 'strokeRect' ? ctx.strokeStyle : undefined])
	}
	ctx.measureText = (s) => ({ width: String(s).length * 0.6 * Number(/([\d.]+)px/.exec(font)[1]) })
	return ctx
}

/** @param {string} h #rrggbb @return {number} WCAG 2.x relative luminance (independent of tokens.js) */
function luminance(h) {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

describe('topRight', () => {
	test('unrotated: (x + w, y); rotated items carry the corner around the centre (clockwise)', () => {
		assert.deepEqual(topRight({ x: 10, y: 20, w: 200, h: 100, r: 0 }), { x: 210, y: 20 })
		const r90 = topRight({ x: 0, y: 0, w: 200, h: 100, r: 90 })
		assert.ok(near(r90.x, 150) && near(r90.y, 150), JSON.stringify(r90))
		const r180 = topRight({ x: 0, y: 0, w: 200, h: 100, r: 180 })
		assert.ok(near(r180.x, 0) && near(r180.y, 100))
	})
})

describe('planBadges', () => {
	test('own votes, totals and empty rings per item in view; the counters are what the plan draws', () => {
		const m = board()
		const badges = new Map([[A, { mine: 2, total: null }], [B, { mine: 0, total: 5 }], [C, { mine: 1, total: 3 }]])
		const plan = planBadges(m, [A, B, C, D, L, F], state({ badges }))
		assert.deepEqual(plan.items.map((i) => [i.id, i.mine, i.total, i.ring]), [
			[A, 2, null, false], [B, 0, 5, true], [C, 1, 3, false], [D, 0, null, true],
		])
		assert.deepEqual(plan.counts, { rings: 2, badges: 2, totals: 2, outline: F })
		assert.deepEqual([plan.items[0].x, plan.items[0].y], [200, 0], 'top-right corner of A')
		const d = plan.items[3]
		assert.ok(near(d.x, 1100) && near(d.y, 200) && d.r === 90, 'rotated D: its corner turned with it')
		assert.deepEqual(plan.outline, { id: F, x: -100, y: -100, w: 2000, h: 600, r: 0 })
	})

	test('items outside the given ids, connectors and frames without a badge get nothing; an empty plan counts nothing', () => {
		const m = board()
		const plan = planBadges(m, [C, L], state({ badges: new Map([[A, { mine: 1, total: 1 }], [L, { mine: 1, total: 1 }]]) }))
		assert.deepEqual(plan.items.map((i) => i.id), [C], 'A is outside, L is a connector')
		const none = planBadges(m, [], state({ markVotable: false }))
		assert.deepEqual(none, { items: [], outline: null, counts: { ...BADGES_NONE } })
	})

	test('rings and outline only with markVotable; rings: false (LOD 2) keeps badges, totals and the outline', () => {
		const m = board()
		const badges = new Map([[A, { mine: 1, total: 2 }]])
		const off = planBadges(m, [A, B, C], state({ badges, markVotable: false }))
		assert.deepEqual(off.counts, { rings: 0, badges: 1, totals: 1, outline: null })
		const lod2 = planBadges(m, [A, B, C], state({ badges }), { rings: false })
		assert.deepEqual(lod2.counts, { rings: 0, badges: 1, totals: 1, outline: F })
		const noScope = planBadges(m, [B], state({ scope: null }))
		assert.equal(noScope.outline, null)
		assert.equal(planBadges(m, [B], state({ scope: id(77) })).counts.outline, null, 'a scope that is not on the board')
	})

	test('only votable(id) === true gets a ring (S-13)', () => {
		const m = board()
		const answers = new Map([[A, 1], [B, 'yes'], [C, true], [D, undefined]])
		const plan = planBadges(m, [A, B, C, D], state({ votable: (x) => answers.get(x) }))
		assert.deepEqual(plan.items.map((i) => i.id), [C])
	})

	test('a remote drag preview moves the badge and the outline with the item', () => {
		const m = board()
		const offsetOf = (x) => (x === A || x === F ? { dx: 50, dy: -20 } : null)
		const plan = planBadges(m, [A], state({ badges: new Map([[A, { mine: 1, total: null }]]) }), { offsetOf })
		assert.deepEqual([plan.items[0].x, plan.items[0].y], [250, -20])
		assert.deepEqual([plan.outline.x, plan.outline.y], [-50, -120])
	})
})

describe('paintBadges', () => {
	const scale = 0.5
	const px = 1 / scale

	test('outline: strokeRect of the scope frame, 2 screen px, VOTE_SCOPE_COLOR', () => {
		const m = board()
		const ctx = recorder()
		paintBadges(ctx, planBadges(m, [], state()), scale, '#c62828')
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'strokeRect'), [['strokeRect', -100, -100, 2000, 600, VOTE_SCOPE_COLOR]])
		assert.ok(ctx.calls.some((c) => c[0] === 'set' && c[1] === 'lineWidth' && c[2] === VOTE_SCOPE_STROKE_PX * px))
		assert.ok(!ctx.calls.some((c) => c[0] === 'fillText'), 'no text without items')
	})

	test('(job 233) the own count: a VOTE_BADGE_PX circle in the state color at the badge centre, digits in contrastTextOn(color); the total pill one gap to its left in VOTE_TOTAL_FILL', () => {
		const m = board()
		const ctx = recorder()
		const color = '#1565c0'
		const plan = planBadges(m, [A], state({ badges: new Map([[A, { mine: 3, total: 12 }]]), markVotable: false }), { scale })
		paintBadges(ctx, plan, scale, color)
		assert.ok(ctx.calls.some((c) => c[0] === 'set' && c[1] === 'font' && c[2] === `bold ${VOTE_BADGE_FONT_PX * px}px ${FONT_FAMILY}`), 'the badge font')
		assert.ok(ctx.calls.some((c) => c[0] === 'set' && c[1] === 'font' && c[2] === `bold ${12 * px}px ${FONT_FAMILY}`), 'the total font')
		// per pill: the white edge (grown by half the border), then the body (shrunk by half of it)
		const fills = ctx.calls.filter((c) => c[0] === 'fill').map((c) => c[1])
		assert.deepEqual(fills, [VOTE_DOT_BORDER, color, VOTE_DOT_BORDER, VOTE_TOTAL_FILL])
		const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => [c[1], c[4]])
		assert.deepEqual(texts, [['3', contrastTextOn(color)], ['12', contrastTextOn(VOTE_TOTAL_FILL)]])
		assert.ok(!ctx.calls.some((c) => c[0] === 'stroke'), 'no stroke: the edge is a fill')
		const arcs = ctx.calls.filter((c) => c[0] === 'arc')
		assert.equal(arcs.length, 8, 'two half circles per fill')
		const R = (VOTE_BADGE_PX / 2) * px
		const b = VOTE_DOT_BORDER_PX * px
		// a note at 50 %: d = 11 − 16 · 0.5 = 3 px out from the corner (200, 0) on each axis
		const d = (VOTE_BADGE_CLEAR_PX - STICKY_PADDING * scale) * px
		const cx = 200 + d
		const cy = -d
		assert.ok(near(plan.items[0].cx, cx) && near(plan.items[0].cy, cy), JSON.stringify(plan.items[0]))
		for (const [i, rad] of [[0, R + b / 2], [1, R + b / 2], [2, R - b / 2], [3, R - b / 2]]) {
			assert.ok(near(arcs[i][1], cx) && near(arcs[i][2], cy) && near(arcs[i][3], rad), `one digit: a circle around the centre, arc ${i}`)
		}
		assert.ok(near(arcs[0][3] - arcs[2][3], b) && near((arcs[0][3] + arcs[2][3]) / 2, R))
		// total pill: two digits, VOTE_DOT_PX high, right edge one gap left of the badge
		const r = (VOTE_DOT_PX / 2) * px
		const right = cx - R - VOTE_DOT_GAP_PX * px
		const w = Math.max(2 * r, 2 * 0.6 * 12 * px + 2 * VOTE_DOT_PAD_PX * px)
		for (const [i, rad] of [[4, r + b / 2], [6, r - b / 2]]) {
			assert.ok(near(arcs[i][1], right - w + r) && near(arcs[i][2], cy) && near(arcs[i][3], rad), `left half circle of the total pill, arc ${i}`)
			assert.ok(near(arcs[i + 1][1], right - r) && near(arcs[i + 1][3], rad), `right half circle of the total pill, arc ${i + 1}`)
		}
		assert.deepEqual(arcs.map((a) => [a[4], a[5]]), Array(4).fill([[Math.PI / 2, 3 * Math.PI / 2], [-Math.PI / 2, Math.PI / 2]]).flat())
		assert.equal(ctx.calls.filter((c) => c[0] === 'closePath').length, 4, 'every pill outline is closed')
	})

	test('(job 233) a votable item without an own vote: a white VOTE_BADGE_PX circle with a VOTE_BADGE_RING_PX ring and a "+" in the state color (fills only); the total moves left of it', () => {
		const m = board()
		const ctx = recorder()
		const plan = planBadges(m, [B], state({ badges: new Map([[B, { mine: 0, total: 4 }]]) }), { scale })
		paintBadges(ctx, plan, scale, '#c62828')
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'stroke' || c[0] === 'strokeRect').map((c) => c[0]), ['strokeRect'], 'only the scope outline is a stroke')
		const fills = ctx.calls.filter((c) => c[0] === 'fill').map((c) => c[1])
		assert.deepEqual(fills, ['#c62828', VOTE_DOT_BORDER, VOTE_DOT_BORDER, VOTE_TOTAL_FILL])
		const arcs = ctx.calls.filter((c) => c[0] === 'arc')
		const R = (VOTE_BADGE_PX / 2) * px
		const sw = VOTE_BADGE_RING_PX * px
		const { cx, cy } = plan.items[0]
		assert.ok(near(arcs[0][3], R) && near(arcs[1][3], R - sw), JSON.stringify(arcs.slice(0, 2)))
		for (const a of arcs.slice(0, 2)) assert.ok(near(a[1], cx) && near(a[2], cy) && a[4] === 0 && near(a[5], 2 * Math.PI))
		// the "+": two bars of VOTE_BADGE_PLUS_PX, a ring width thick, in the state color, centred
		const P = VOTE_BADGE_PLUS_PX * px
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'fillRect').map((c) => c.slice(1).map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))), [
			[cx - P / 2, cy - sw / 2, P, sw, '#c62828'], [cx - sw / 2, cy - P / 2, sw, P, '#c62828'],
		].map((c) => c.map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))))
		// the total sits one gap left of the circle
		const rightTotal = cx - R - VOTE_DOT_GAP_PX * px
		assert.ok(near(arcs[3][1], rightTotal - (VOTE_DOT_PX / 2) * px), 'right half circle of the total pill')
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), ['4'], 'the "+" circle has no number')
	})

	test('(job 233) without a badge the total takes its place: centred on the badge centre', () => {
		const m = board()
		const plan = planBadges(m, [B], state({ badges: new Map([[B, { mine: 0, total: 4 }]]), markVotable: false }), { scale })
		const sh = badgeShapes(plan.items[0], px, 0.6 * VOTE_BADGE_FONT_PX * px, 0.6 * 12 * px)
		assert.equal(sh.own, null)
		assert.equal(sh.plus, null)
		assert.ok(near((sh.total.left + sh.total.right) / 2, plan.items[0].cx) && near(sh.total.cy, plan.items[0].cy))
	})

	test('G16 contrast in Node: for every PALETTE entry (and its upper-case form, S-9) the digits reach ≥ 4.5:1 on the own circle', () => {
		const m = board()
		for (const c of [...PALETTE, ...PALETTE.map((x) => x.toUpperCase()), '#ffffff', '#000000', '#777777']) {
			const ctx = recorder()
			paintBadges(ctx, planBadges(m, [A], state({ badges: new Map([[A, { mine: 1, total: null }]]) })), 1, c)
			// the fill right before the digits is the circle they sit on (as the lab gate G16 reads it)
			const t = ctx.calls.findIndex((x) => x[0] === 'fillText')
			const fill = ctx.calls.slice(0, t).filter((x) => x[0] === 'fill').at(-1)[1]
			const digits = ctx.calls[t][4]
			assert.equal(fill, c)
			assert.ok(ratio(fill.toLowerCase(), digits) >= 4.5, `${c}: ${ratio(fill.toLowerCase(), digits)}`)
		}
		assert.ok(ratio(VOTE_TOTAL_FILL, contrastTextOn(VOTE_TOTAL_FILL)) >= 4.5, 'total circle')
	})

	test('(stage 4, WebKit) many badges: no stroke, fill styles set once per group, one small path per fill', () => {
		const m = board()
		const ctx = recorder()
		const badges = new Map([[A, { mine: 2, total: 5 }], [B, { mine: 0, total: 7 }], [C, { mine: 12, total: 30 }]])
		paintBadges(ctx, planBadges(m, [A, B, C, D], state({ badges })), scale, '#2e7d32')
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'stroke' || c[0] === 'strokeRect').map((c) => c[0]), ['strokeRect'], 'only the scope outline')
		const sets = ctx.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2])
		// own: edge, body, digits; "+" circles (B, D votable without a vote): own color, inside, the bars; totals: edge, body, digits
		assert.deepEqual(sets, [VOTE_DOT_BORDER, '#2e7d32', contrastTextOn('#2e7d32'), '#2e7d32', VOTE_DOT_BORDER, '#2e7d32', VOTE_DOT_BORDER, VOTE_TOTAL_FILL, contrastTextOn(VOTE_TOTAL_FILL)])
		assert.equal(ctx.calls.filter((c) => c[0] === 'fillRect').length, 4, 'two bars per "+"')
		// one beginPath per fill: own 2 × 2, rings 2 × 2 (B and D), totals 3 × 2
		assert.equal(ctx.calls.filter((c) => c[0] === 'fill').length, 14)
		assert.equal(ctx.calls.filter((c) => c[0] === 'beginPath').length, 14)
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), ['2', '12', '5', '7', '30'])
		// the counters of the plan are unchanged by the painting order
		assert.deepEqual(planBadges(m, [A, B, C, D], state({ badges })).counts, { rings: 2, badges: 2, totals: 3, outline: F })
	})

	test('(K7, RSC-02) two overlapping own pills (LOD 2) share one edge pass: 2 edge fills, then 2 body fills, then 2 fillText', () => {
		const m = board()
		const ctx = recorder()
		const low = 0.05
		assert.ok(low < LOD2_ENTER, 'a scale of the LOD 2 overview')
		const color = '#6a1b9a'
		const badges = new Map([[A, { mine: 1, total: null }], [B, { mine: 2, total: null }]])
		const plan = planBadges(m, [A, B], state({ badges, markVotable: false }), { rings: false, scale: low })
		paintBadges(ctx, plan, low, color)
		const wpx = 1 / low
		const r = (VOTE_BADGE_PX / 2) * wpx
		const b = VOTE_DOT_BORDER_PX * wpx
		const cxA = plan.items[0].cx
		const cxB = plan.items[1].cx
		// the two pills really overlap: their centres are closer than the sum of their body radii
		assert.ok(cxB - cxA < 2 * (r - b / 2), `bodies overlap: ${cxB - cxA} < ${2 * (r - b / 2)}`)
		// the drawing calls in order: fills with their style, the centre x and radius of their first arc; texts with theirs
		const ops = []
		let arc = null
		for (const c of ctx.calls) {
			if (c[0] === 'beginPath') arc = null
			else if (c[0] === 'arc' && arc === null) arc = c
			else if (c[0] === 'fill') ops.push({ op: 'fill', style: c[1], x: arc[1], r: arc[3] })
			else if (c[0] === 'fillText') ops.push({ op: 'fillText', style: c[4], x: c[2], text: c[1] })
		}
		assert.deepEqual(ops.map((o) => o.op), ['fill', 'fill', 'fill', 'fill', 'fillText', 'fillText'], 'all edges, then all bodies, then all digits')
		assert.deepEqual(ops.map((o) => o.style), [VOTE_DOT_BORDER, VOTE_DOT_BORDER, color, color, contrastTextOn(color), contrastTextOn(color)])
		const at = [cxA, cxB, cxA, cxB, cxA, cxB]
		ops.forEach((o, i) => assert.ok(near(o.x, at[i]), `call ${i} belongs to ${i % 2 ? 'B' : 'A'}: ${o.x}`))
		const radii = [r + b / 2, r + b / 2, r - b / 2, r - b / 2]
		ops.slice(0, 4).forEach((o, i) => assert.ok(near(o.r, radii[i]), `fill ${i}: ${i < 2 ? 'edge' : 'body'} radius ${o.r}`))
		assert.deepEqual(ops.slice(4).map((o) => o.text), ['1', '2'])
		// hence no white edge between the merged bodies and no body over a digit; one fill style per pass
		assert.deepEqual(ctx.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2]), [VOTE_DOT_BORDER, color, contrastTextOn(color)])
		assert.ok(!ctx.calls.some((c) => c[0] === 'stroke' || c[0] === 'strokeRect'), 'no stroke, no outline without markVotable')
	})

	test('rotated scope frame: a closed polygon of its four turned corners', () => {
		const m = board()
		m.apply({ upserts: [frameItem(F, { x: 0, y: 0, w: 200, h: 100, r: 90 })] })
		const ctx = recorder()
		paintBadges(ctx, planBadges(m, [], state()), 1, '#c62828')
		const pts = ctx.calls.filter((c) => c[0] === 'lineTo').map((c) => [Math.round(c[1]), Math.round(c[2])])
		assert.deepEqual(pts, [[150, -50], [150, 150], [50, 150], [50, -50]])
		assert.ok(ctx.calls.some((c) => c[0] === 'stroke' && c[1] === VOTE_SCOPE_COLOR))
	})

	test('job 149: with live the totals are hollow pills at the same place: white edge, pill in VOTE_TOTAL_FILL, white body VOTE_RING_STROKE_PX smaller, digits in VOTE_TOTAL_FILL; fills only, one style per group', () => {
		const m = board()
		const badges = new Map([[A, { mine: 2, total: 12 }], [B, { mine: 0, total: 7 }]])
		const plan = planBadges(m, [A, B], state({ badges, markVotable: false }))
		const solid = recorder()
		paintBadges(solid, plan, scale, '#1565c0')
		const ctx = recorder()
		paintBadges(ctx, plan, scale, '#1565c0', { live: true })
		assert.deepEqual(plan.counts, { rings: 0, badges: 1, totals: 2, outline: null }, 'the plan is the same, live or not')
		const sets = ctx.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2])
		// own: edge, body, digits; live totals: edge, pill, inside, digits
		assert.deepEqual(sets, [VOTE_DOT_BORDER, '#1565c0', contrastTextOn('#1565c0'), VOTE_DOT_BORDER, VOTE_TOTAL_FILL, VOTE_DOT_BORDER, VOTE_TOTAL_FILL])
		assert.ok(!ctx.calls.some((c) => c[0] === 'stroke' || c[0] === 'strokeRect'), 'fills only')
		// the drawing calls of the totals in order: fill style, first arc's centre x and radius
		const ops = []
		let arc = null
		for (const c of ctx.calls) {
			if (c[0] === 'beginPath') arc = null
			else if (c[0] === 'arc' && arc === null) arc = c
			else if (c[0] === 'fill') ops.push({ op: 'fill', style: c[1], x: arc[1], r: arc[3] })
			else if (c[0] === 'fillText') ops.push({ op: 'fillText', style: c[4], text: c[1] })
		}
		// the own pill of A comes first: edge, body, digits
		const totals = ops.slice(3)
		assert.deepEqual(totals.map((o) => [o.op, o.style]), [
			['fill', VOTE_DOT_BORDER], ['fill', VOTE_DOT_BORDER],
			['fill', VOTE_TOTAL_FILL], ['fill', VOTE_TOTAL_FILL],
			['fill', VOTE_DOT_BORDER], ['fill', VOTE_DOT_BORDER],
			['fillText', VOTE_TOTAL_FILL], ['fillText', VOTE_TOTAL_FILL],
		], 'all edges, then all pills, then all insides, then all digits')
		assert.deepEqual(totals.slice(6).map((o) => o.text), ['12', '7'])
		const r = (VOTE_DOT_PX / 2) * px
		const b = VOTE_DOT_BORDER_PX * px
		const sw = VOTE_RING_STROKE_PX * px
		for (const [i, rad] of [[0, r + b / 2], [2, r - b / 2], [4, r - b / 2 - sw]]) {
			assert.ok(near(totals[i].r, rad) && near(totals[i + 1].r, rad), `radius of fill pass ${i / 2}: ${totals[i].r} ≈ ${rad}`)
		}
		// same size and place as the solid total pill: its edge and body arcs are the live ones
		const arcsOf = (c) => c.calls.filter((x) => x[0] === 'arc').map((x) => x.slice(1, 4))
		assert.deepEqual(arcsOf(ctx).slice(4, 12), arcsOf(solid).slice(4, 12), 'edge and pill of the totals match the result pills')
		assert.deepEqual(solid.calls.filter((c) => c[0] === 'fillText').map((c) => [c[1], c[4]]), [['2', contrastTextOn('#1565c0')], ['12', contrastTextOn(VOTE_TOTAL_FILL)], ['7', contrastTextOn(VOTE_TOTAL_FILL)]], 'without live: unchanged')
		assert.ok(ratio(VOTE_DOT_BORDER, VOTE_TOTAL_FILL) >= 4.5, 'live digits on the white inside')
		// live without totals paints exactly what the solid painting does
		const own = planBadges(m, [A], state({ badges: new Map([[A, { mine: 1, total: null }]]), markVotable: false }))
		const p1 = recorder()
		const p2 = recorder()
		paintBadges(p1, own, scale, '#1565c0')
		paintBadges(p2, own, scale, '#1565c0', { live: true })
		assert.deepEqual(p2.calls, p1.calls)
	})
})

describe('job 233: the badge keeps clear of the text and is a big target', () => {
	test('padOf: notes STICKY_PADDING, shapes SHAPE_TEXT_PADDING, others 0', () => {
		assert.deepEqual(['sticky', 'shape', 'text', 'frame'].map(padOf), [STICKY_PADDING, SHAPE_TEXT_PADDING, 0, 0])
	})

	test('AK9: at zoom 0.1–4 and every rotation the circle and its white edge never reach the text box of a note, a shape or a text item', () => {
		const R = VOTE_BADGE_PX / 2 + VOTE_DOT_BORDER_PX / 2
		for (const t of ['sticky', 'shape', 'text']) {
			for (const scale of [0.1, 0.25, 0.3, 0.5, 0.62, 0.7, 1, 1.5, 2, 4]) {
				for (const r of [0, 30, 90, 200]) {
					const a = { x: 100, y: 50, w: 200, h: 160, r }
					const pad = padOf(t)
					const c = badgeCentre(a, pad, scale)
					// the centre in the item's own (unrotated) frame, origin at its centre
					const th = -r * Math.PI / 180
					const dx = c.x - (a.x + a.w / 2)
					const dy = c.y - (a.y + a.h / 2)
					const lx = dx * Math.cos(th) - dy * Math.sin(th)
					const ly = dx * Math.sin(th) + dy * Math.cos(th)
					// the text box: the item less pad on every side; its nearest point to the centre
					const hx = a.w / 2 - pad
					const hy = a.h / 2 - pad
					const nx = Math.max(-hx, Math.min(hx, lx))
					const ny = Math.max(-hy, Math.min(hy, ly))
					const dist = Math.hypot(lx - nx, ly - ny) * scale
					assert.ok(dist >= R - 1e-9, `${t} at ${scale}, ${r}°: ${dist.toFixed(2)} px < ${R}`)
				}
			}
		}
	})

	test('AK9: at 100 % a note\'s badge sits right on its corner (the padding holds it), a text item\'s moves out', () => {
		const a = { x: 0, y: 0, w: 200, h: 200, r: 0 }
		assert.deepEqual(badgeCentre(a, STICKY_PADDING, 1), { x: 200, y: 0 })
		const c = badgeCentre(a, 0, 1)
		assert.ok(near(c.x, 200 + VOTE_BADGE_CLEAR_PX) && near(c.y, -VOTE_BADGE_CLEAR_PX))
		const z = badgeCentre(a, STICKY_PADDING, 0.25)
		assert.ok(near(z.x, 200 + (VOTE_BADGE_CLEAR_PX - STICKY_PADDING * 0.25) / 0.25), 'at 25 % the note moves out by 6.5 px (job 259: padding 18)')
	})

	test('AK10: badgeAt hits within 16 px (mouse) and 22 px (pen, finger) of a drawn badge, also outside its item', () => {
		const m = board()
		const badges = new Map([[A, { mine: 1, total: null }]])
		const plan = planBadges(m, [A, B], state({ badges }), { scale: 1 })
		// A at 100 %: centre on its corner (200, 0)
		const at = (dx, dy) => ({ x: 200 + dx, y: dy })
		assert.equal(badgeAt(plan, at(10, -10), 1, VOTE_BADGE_HIT_MOUSE_PX, null), A, '10 px right and above the corner: 14.1 px')
		assert.equal(badgeAt(plan, at(12, -12), 1, VOTE_BADGE_HIT_MOUSE_PX, null), null, '17 px: no mouse hit')
		assert.equal(badgeAt(plan, at(12, -12), 1, VOTE_BADGE_HIT_TOUCH_PX, null), A, '17 px: a finger hit')
		assert.equal(badgeAt(plan, at(16, -16), 1, VOTE_BADGE_HIT_TOUCH_PX, null), null, '22.6 px: none')
		// B votable without a vote: its "+" circle counts too
		assert.equal(badgeAt(plan, { x: 500, y: 0 }, 1, VOTE_BADGE_HIT_MOUSE_PX, null), B)
		// screen px: at 50 % the same world distance is half as many px
		const half = planBadges(m, [A], state({ badges, markVotable: false }), { scale: 0.5 })
		const c = half.items[0]
		assert.equal(badgeAt(half, { x: c.cx + 30, y: c.cy }, 0.5, VOTE_BADGE_HIT_MOUSE_PX, null), A, '30 world = 15 px')
		assert.equal(badgeAt(half, { x: c.cx + 34, y: c.cy }, 0.5, VOTE_BADGE_HIT_MOUSE_PX, null), null, '34 world = 17 px')
	})

	test('AK10 / risk: a press inside another item belongs to that item; on its own item the badge counts; of two badges the topmost item wins', () => {
		const m = board()
		const badges = new Map([[A, { mine: 1, total: null }], [B, { mine: 2, total: null }]])
		const plan = planBadges(m, [A, B], state({ badges, markVotable: false }), { scale: 1 })
		const w = { x: 195, y: 8 }
		assert.equal(badgeAt(plan, w, 1, VOTE_BADGE_HIT_TOUCH_PX, A), A, 'inside A, on its badge')
		assert.equal(badgeAt(plan, w, 1, VOTE_BADGE_HIT_TOUCH_PX, C), null, 'inside another item C: no badge hit (C wins)')
		// two badges in reach: the paint order decides
		const close = { items: [{ id: A, cx: 0, cy: 0, mine: 1, ring: false }, { id: B, cx: 10, cy: 0, mine: 1, ring: false }] }
		assert.equal(badgeAt(close, { x: 5, y: 0 }, 1, VOTE_BADGE_HIT_MOUSE_PX, null, (a, b) => (a === A ? 1 : -1)), A, 'A above B')
		assert.equal(badgeAt(close, { x: 5, y: 0 }, 1, VOTE_BADGE_HIT_MOUSE_PX, null, (a, b) => (a === A ? -1 : 1)), B, 'B above A')
		// a total alone is no badge
		assert.equal(badgeAt({ items: [{ id: A, cx: 0, cy: 0, mine: 0, ring: false, total: 3 }] }, { x: 0, y: 0 }, 1, 22, null), null)
		assert.equal(badgeAt(null, { x: 0, y: 0 }, 1, 22, null), null)
	})
})

describe('buildBadges', () => {
	test('one Shape without hit graph, transforms only position, its sceneFunc paints with the context', () => {
		let built = null
		const painted = []
		const ctx = {
			Shape: function Shape(attrs) {
				built = { attrs, mode: null, transformsEnabled(v) { this.mode = v } }
				return built
			},
		}
		const node = buildBadges(ctx, (c) => painted.push(c))
		assert.equal(node, built)
		assert.equal(node.attrs.listening, false)
		assert.equal(node.attrs.perfectDrawEnabled, false)
		assert.equal(node.mode, 'position')
		node.attrs.sceneFunc('ctx!')
		assert.deepEqual(painted, ['ctx!'])
	})
})
