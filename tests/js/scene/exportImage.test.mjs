/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Save as image (PNG)" (factory job 178), the pure parts of
 * src/scene/exportImage.js with the real SceneModel:
 * - AK1 the items: the whole board in stacking order; a selected frame with
 *   its descendants; a connector between two exported notes comes along,
 *   one with a single such end does not
 * - AK2 the size: bboxOf 200 × 200 at s = 2 is 464 × 464 px; a board of
 *   20 000 × 10 000 units gives s < 2, scaled, every side ≤ 16 384 px and the
 *   area ≤ 2²⁵ px, with the largest such s
 * - AK3 the plan: reaction rows without the button and without an own
 *   reaction, also when the image is drawn below LOD_TEXT_SCALE; markVotable
 *   gives neither rings nor the outline; total null no total; own votes and
 *   live totals follow the SceneVoteState; rows and badges widen the bounds
 * - AK4 the file name
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	EXPORT_MARGIN, EXPORT_MAX_PIXELS, EXPORT_MAX_SIDE, EXPORT_NAME_MAX, EXPORT_SCALE, exportBounds, exportFileName, exportIds, exportLayout,
	exportPlan, exportScale, localDay,
} from '../../../src/scene/exportImage.js'
import { STICKY_PAD, SceneModel } from '../../../src/model/SceneModel.js'
import { LOD_TEXT_SCALE, REACT_GAP, REACT_H, VOTE_BADGE_CLEAR_PX, VOTE_BADGE_PX, VOTE_DOT_BORDER_PX } from '../../../src/model/tokens.js'
import { ID, connector, frame, sticky, textItem } from '../board/fakes.mjs'

const ME = 'a1b2c3d4e5f60718'
const REACT = Object.freeze({
	[`p${ME}`]: { e: '1f44d', n: 'Vic' },
	pbbbbbbbbbbbbbbbb: { e: '1f44d', n: 'Bob' },
})

/** @param {object[]} items @return {SceneModel} */
function modelOf(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

/** A frame F with a note inside, two loose notes, connectors N1–N2, N1–X and F's child–N1. */
function board() {
	const F = ID(1)
	const C = ID(2)
	const N1 = ID(3)
	const N2 = ID(4)
	const X = ID(5)
	const items = [
		frame(F, { x: 0, y: 0, w: 600, h: 400, z: 'a0' }),
		sticky(C, { x: 20, y: 40, parent: F, z: 'i1' }),
		sticky(N1, { x: 1000, y: 0, z: 'i2' }),
		sticky(N2, { x: 1400, y: 0, z: 'i3' }),
		sticky(X, { x: 1800, y: 0, z: 'i0' }),
		connector(ID(6), { item: N1 }, { item: N2 }, { z: 'i8' }),
		connector(ID(7), { item: N1 }, { item: X }, { z: 'i9' }),
		connector(ID(8), { item: C }, { x: 3000, y: 3000 }, { z: 'i7' }),
	]
	return { m: modelOf(items), F, C, N1, N2, X, K12: ID(6), K1X: ID(7), KC: ID(8) }
}

test('AK1 the whole board: every item in stacking order (frames below, then content by z)', () => {
	const b = board()
	const ids = exportIds(b.m)
	assert.deepEqual(ids, b.m.sortByOrder(b.m.ids()))
	assert.deepEqual(ids, [b.F, b.X, b.C, b.N1, b.N2, b.KC, b.K12, b.K1X])
})

test('AK1 a selected frame gives itself and its descendants; a connector with one end outside stays out', () => {
	const b = board()
	assert.deepEqual(exportIds(b.m, [b.F]), [b.F, b.C], 'KC hangs at C with one end only (a free end)')
	assert.deepEqual(exportIds(b.m, [b.N1, b.N2]), [b.N1, b.N2, b.K12], 'the connector between the two exported notes comes along')
	assert.deepEqual(exportIds(b.m, [b.N1]), [b.N1], 'K12 and K1X have one exported end only')
	assert.deepEqual(exportIds(b.m, [b.N2, b.N1, b.X]), [b.X, b.N1, b.N2, b.K12, b.K1X], 'stacking order, not selection order')
	assert.deepEqual(exportIds(b.m, [b.K1X]), [b.K1X], 'a selected connector is exported itself')
	assert.deepEqual(exportIds(b.m, ['01JA9999999999999999999999']), [], 'unknown ids: nothing')
	assert.deepEqual(exportIds(modelOf([])), [], 'an empty board')
})

test('AK1 a connector that was never routed (an unknown target) has no box and is not drawn', () => {
	const m = modelOf([sticky(ID(1)), connector(ID(2), { item: ID(1) }, { item: ID(9) })])
	assert.equal(m.bboxOf(ID(2)), null)
	assert.deepEqual(exportIds(m), [ID(1)])
})

test('AK2 an item whose bboxOf is 200 × 200 gives 464 × 464 px at s = 2 (16 units of margin per side)', () => {
	const T = ID(1)
	const m = modelOf([textItem(T, { x: 50, y: -30, w: 200, h: 200 })])
	const bb = m.bboxOf(T)
	assert.deepEqual([bb.maxX - bb.minX, bb.maxY - bb.minY], [200, 200])
	const ids = exportIds(m)
	const bounds = exportBounds(m, ids, exportPlan(m, ids, null))
	assert.deepEqual(bounds, { x: 50, y: -30, w: 200, h: 200 })
	const lay = exportLayout(bounds)
	assert.equal(EXPORT_MARGIN, 16)
	assert.deepEqual(lay, { frame: { x: 34, y: -46, w: 232, h: 232 }, scale: 2, width: 464, height: 464, scaled: false })
})

test('AK2 a board of 20 000 × 10 000 units: s < 2, scaled, each side ≤ 16 384 px, area ≤ 2²⁵ px; s is the largest that fits', () => {
	const m = modelOf([
		textItem(ID(1), { x: 0, y: 0, w: 100, h: 100 }),
		textItem(ID(2), { x: 19900, y: 9900, w: 100, h: 100 }),
	])
	const ids = exportIds(m)
	const bounds = exportBounds(m, ids, exportPlan(m, ids, null))
	assert.deepEqual(bounds, { x: 0, y: 0, w: 20000, h: 10000 })
	const lay = exportLayout(bounds)
	assert.ok(lay.scale < EXPORT_SCALE)
	assert.equal(lay.scaled, true)
	assert.ok(lay.width <= EXPORT_MAX_SIDE && lay.height <= EXPORT_MAX_SIDE, `${lay.width} × ${lay.height}`)
	assert.ok(lay.width * lay.height <= EXPORT_MAX_PIXELS, `${lay.width * lay.height}`)
	assert.equal(lay.width, Math.ceil(lay.frame.w * lay.scale))
	assert.equal(lay.height, Math.ceil(lay.frame.h * lay.scale))
	const bigger = lay.scale * (1 + 1e-6)
	assert.ok(Math.ceil(lay.frame.w * bigger) * Math.ceil(lay.frame.h * bigger) > EXPORT_MAX_PIXELS, 'a slightly larger s breaks the area')
	assert.ok(lay.scale < LOD_TEXT_SCALE * 2, 'small enough to matter for AK3')
})

test('AK2 exportScale: the side limit, the area limit after rounding up, 2 whenever it fits', () => {
	assert.equal(exportScale(100, 100), 2)
	assert.equal(exportScale(8192, 1024), 2, '16 384 × 2 048 px is exactly 2²⁵')
	assert.ok(exportScale(8192, 1024.5) < 2, 'half a unit more breaks the area')
	const side = exportScale(40000, 100)
	assert.equal(Math.ceil(40000 * side), EXPORT_MAX_SIDE, 'one long side: exactly the side limit')
	for (const [w, h] of [[9000, 9000], [12345.6, 7777.7], [5793, 5793], [30000, 1500]]) {
		const s = exportScale(w, h)
		const a = Math.ceil(w * s)
		const c = Math.ceil(h * s)
		assert.ok(a <= EXPORT_MAX_SIDE && c <= EXPORT_MAX_SIDE && a * c <= EXPORT_MAX_PIXELS, `${w} × ${h}: ${a} × ${c}`)
		const t = s * (1 + 1e-7)
		const ta = Math.ceil(w * t)
		const tc = Math.ceil(h * t)
		assert.ok(ta > EXPORT_MAX_SIDE || tc > EXPORT_MAX_SIDE || ta * tc > EXPORT_MAX_PIXELS, `${w} × ${h}: a larger s would fit`)
	}
	// the second try of the session: s ÷ √2, the size follows
	const lay = exportLayout({ x: 0, y: 0, w: 168, h: 68 }, 2 / Math.SQRT2)
	assert.deepEqual([lay.width, lay.height, lay.scaled], [Math.ceil(200 * Math.SQRT2), Math.ceil(100 * Math.SQRT2), true])
})

test('AK3 reaction rows: no button, no own reaction marked, also when the image is drawn below LOD_TEXT_SCALE', () => {
	const A = ID(1)
	const m = modelOf([
		sticky(A, { x: 0, y: 0, data: { text: 'x', react: REACT } }),
		sticky(ID(2), { x: 400, y: 0 }),
		textItem(ID(3), { x: 30000, y: 20000, w: 100, h: 100 }),
	])
	const ids = exportIds(m)
	const plan = exportPlan(m, ids, null)
	assert.equal(plan.reactions.length, 1, 'only the note with reactions has a row')
	const row = plan.reactions[0]
	assert.equal(row.id, A)
	assert.equal(row.add, false)
	assert.equal(row.plan.add, null, 'no room kept for the button')
	assert.deepEqual(row.plan.pills.map((p) => [p.e, p.n, p.mine]), [['1f44d', 2, false]])
	assert.equal(plan.badges, null, 'no vote state: no badges')
	const bounds = exportBounds(m, ids, plan)
	const lay = exportLayout(bounds)
	assert.ok(lay.scale < LOD_TEXT_SCALE, `the image is drawn at ${lay.scale}`)
	assert.equal(exportPlan(m, ids, null).reactions.length, 1, 'the plan does not depend on the scale')
	// the row widens the bounds below the note
	const only = exportBounds(m, [A], plan)
	assert.ok(only.y + only.h >= 200 + REACT_GAP + REACT_H, 'the row under the note is inside')
	assert.ok(only.y + only.h > m.bboxOf(A).maxY)
})

test('AK3 badges: markVotable gives no ring and no outline; total null no total; own votes and live totals follow the state', () => {
	const F = ID(1)
	const A = ID(2)
	const B = ID(3)
	const C = ID(4)
	const m = modelOf([
		frame(F, { x: -100, y: -100, w: 1200, h: 600 }),
		sticky(A, { x: 0, y: 0, parent: F, z: 'i1' }),
		sticky(B, { x: 300, y: 0, parent: F, z: 'i2' }),
		sticky(C, { x: 600, y: 0, parent: F, z: 'i3' }),
	])
	const ids = exportIds(m)
	const vote = {
		votable: (id) => id !== F,
		scope: F,
		badges: new Map([[A, { mine: 2, total: null }], [B, { mine: 0, total: 7 }]]),
		markVotable: true,
		color: '#e5004d',
		live: false,
	}
	let plan = exportPlan(m, ids, vote)
	assert.equal(plan.badges.counts.rings, 0, 'no empty rings (C is votable without an own vote)')
	assert.equal(plan.badges.outline, null, 'no outline of the voting area')
	assert.equal(plan.badges.counts.outline, null)
	assert.deepEqual(plan.badges.items.map((x) => [x.id, x.mine, x.total, x.ring]), [[A, 2, null, false], [B, 0, 7, false]])
	assert.equal(plan.badges.counts.totals, 1, 'total null: no total on A')
	assert.equal(plan.color, '#e5004d')
	assert.equal(plan.live, false)
	vote.live = true
	vote.badges = new Map([[A, { mine: 0, total: 3 }]])
	plan = exportPlan(m, ids, vote)
	assert.equal(plan.live, true, 'the live count is drawn as this tab draws it')
	assert.deepEqual(plan.badges.items.map((x) => [x.id, x.mine, x.total]), [[A, 0, 3]])
	assert.deepEqual(exportPlan(m, [B, C], vote).badges.items, [], 'only the image\'s items get badges')
	// a badge at the top-right corner of a text item (no index padding) widens the bounds above and to the right
	const T = ID(5)
	const mt = modelOf([textItem(T, { x: 0, y: 0, w: 100, h: 50 })])
	const bt = exportPlan(mt, [T], { ...vote, badges: new Map([[T, { mine: 1, total: 12 }]]) }).badges
	assert.deepEqual(bt.items.map((x) => [x.id, x.x, x.y]), [[T, 100, 0]])
	const one = exportBounds(mt, [T], { reactions: [], badges: bt })
	assert.ok(one.y < 0 && one.x + one.w > 100, 'the badge reaches above and right of the item: ' + JSON.stringify(one))
	// (job 233) a text item has no inset: the badge centre moves VOTE_BADGE_CLEAR_PX out on each axis, its edge 14.75 beyond
	const reach = VOTE_BADGE_CLEAR_PX + VOTE_BADGE_PX / 2 + VOTE_DOT_BORDER_PX / 2
	assert.ok(Math.abs(one.y + reach) < 1e-9 && Math.abs(one.x + one.w - (100 + reach)) < 1e-9, 'by the badge moved out from the corner: ' + JSON.stringify(one))
})

test('AK4 file name: forbidden characters, the local date, no title, a long title', () => {
	const day = new Date(2026, 9, 25, 23, 59)
	assert.equal(localDay(day), '2026-10-25')
	assert.equal(exportFileName('Retro: Q3', day), 'Retro_ Q3 2026-10-25.png')
	assert.equal(exportFileName('', day), 'Board 2026-10-25.png')
	assert.equal(exportFileName('   ', day), 'Board 2026-10-25.png')
	assert.equal(exportFileName(null, day), 'Board 2026-10-25.png')
	assert.equal(exportFileName(' a\\b/c:d*e?f"g<h>i|j\u0000k\u001fl\u007f ', day), 'a_b_c_d_e_f_g_h_i_j_k_l_ 2026-10-25.png')
	const long = exportFileName('x'.repeat(300), day)
	assert.ok(long.length <= EXPORT_NAME_MAX, String(long.length))
	assert.ok(long.endsWith(' 2026-10-25.png'))
	assert.equal(long, 'x'.repeat(EXPORT_NAME_MAX - 15) + ' 2026-10-25.png')
	const emoji = exportFileName('😀'.repeat(200), day)
	assert.equal(Array.from(emoji).length, EXPORT_NAME_MAX, 'cut by code points, no half surrogate pair')
	assert.ok(emoji.endsWith(' 2026-10-25.png'))
	assert.equal(exportFileName('a'.repeat(84) + '  bcd', day), 'a'.repeat(84) + ' 2026-10-25.png', 'no blank before the date after the cut')
})

test('job 179 file name with the extension csv: the same rules', () => {
	const day = new Date(2026, 9, 25, 23, 59)
	assert.equal(exportFileName('Retro: Q3', day, 'csv'), 'Retro_ Q3 2026-10-25.csv')
	assert.equal(exportFileName('', day, 'csv'), 'Board 2026-10-25.csv')
	const long = exportFileName('x'.repeat(300), day, 'csv')
	assert.equal(long, 'x'.repeat(EXPORT_NAME_MAX - 15) + ' 2026-10-25.csv')
	assert.equal(exportFileName('Retro', day), 'Retro 2026-10-25.png', 'png by default')
})

test('job 188 AK7 a note pad: exportIds takes it (with its frame); job 263 AK6: the bounds take in its sheets (h + 12) and the shadow of the bottom one (STICKY_PAD)', () => {
	const F = ID(1)
	const P = ID(2)
	const m = modelOf([
		frame(F, { x: 0, y: 0, w: 800, h: 600 }),
		{ id: P, t: 'pad', x: 260, y: 40, w: 200, h: 200, r: 0, z: 'i3', parent: F, data: { title: 'Ideen' }, style: { fill: '#f5d76e' } },
	])
	assert.deepEqual(exportIds(m, null), [F, P])
	assert.deepEqual(exportIds(m, [F]), [F, P], 'with its frame')
	assert.deepEqual(exportIds(m, [P]), [P])
	const d = STICKY_PAD
	assert.deepEqual(exportBounds(m, [P], exportPlan(m, [P], null)), { x: 260 - d, y: 40 - d, w: 200 + 2 * d, h: 212 + 2 * d })
	const { width, height } = exportLayout(exportBounds(m, [P], exportPlan(m, [P], null)))
	assert.deepEqual([width, height], [(200 + 2 * d + 2 * EXPORT_MARGIN) * EXPORT_SCALE, (212 + 2 * d + 2 * EXPORT_MARGIN) * EXPORT_SCALE])
})
