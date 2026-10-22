/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * LOD 2 painter (src/scene/nodes/coarse.js; SPEC-M1 §6.3 LOD 2, R13 (a),
 * (b); §8.5 G14 (4)), pure in Node with the real SceneModel and a recording
 * 2D context:
 * - lodFor: LOD 0/1/2 by scale with the hysteresis LOD2_ENTER/LOD2_LEAVE;
 *   0.1 ± 0.004 never switches, from either side
 * - coarseLook: notes and shapes as boxes in their fill (fillOpacity as
 *   alpha, the stroke color without fill, nothing without both), text items
 *   as a grey bar, unknown types as a grey box, frames with fill and title,
 *   connectors never; invalid stored values draw as their defaults (rule
 *   18); cached per item object
 * - planCoarse: the culled ids in compareOrder (one rank sort), frames
 *   first, content grouped by color, rotated items as their bounding box,
 *   the activeGroup ids and every connector left out; a stale order is
 *   reported (null)
 * - paintCoarse: frame fill, 1-px border and the 12-px title (only from
 *   40 px width on, ellipsis at the width, fits remembered), then one
 *   fillStyle per color group; everything in world units of the camera;
 *   (R14-13) the rectangle of every painted title (shortened width, 15 px
 *   above the top edge), also from remembered fits
 * - coarseTitleHit: the last painted title rectangle under a point, widened
 *   by the tolerance to the left, the right and the top, never below the
 *   top edge
 * - buildCoarse: one Konva.Shape without hit graph whose sceneFunc paints
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import {
	COARSE_BORDER_PX, COARSE_TITLE_BOX_PX, COARSE_TITLE_GAP_PX, COARSE_TITLE_MIN_PX, COARSE_TITLE_PX, buildCoarse, coarseLook,
	coarseOrder, coarseTitleHit, fitTitle, lodFor, paintCoarse, planCoarse,
} from '../../../src/scene/nodes/coarse.js'
import { withAlpha } from '../../../src/scene/nodes/shape.js'
import {
	DEFAULT_STICKY_FILL, FONT_FAMILY, FRAME_STROKE, FRAME_TITLE_COLOR, LOD2_ENTER, LOD2_LEAVE, LOD_COARSE_SCALE, LOD_TEXT_SCALE,
	PLACEHOLDER_STROKE, TEXT_BAR_COLOR,
} from '../../../src/model/tokens.js'
import { frameItem, note, shapeItem, textItem } from './sceneHarness.mjs'

const id = (n) => '01JC' + String(n).padStart(22, '0')
const conn = (cid, start, end) => ({
	id: cid, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b0', parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2 },
})

describe('lodFor: levels and hysteresis', () => {
	test('LOD 0 from LOD_TEXT_SCALE on, LOD 1 below, LOD 2 below LOD2_ENTER, left only above LOD2_LEAVE', () => {
		const cases = [
			[1, 0, 0], [LOD_TEXT_SCALE, 0, 0], [0.2999, 0, 1], [0.2, 1, 1], [LOD2_ENTER, 1, 1], [0.0949, 1, 2], [0.05, 0, 2],
			[0.1, 2, 2], [LOD2_LEAVE, 2, 2], [0.1051, 2, 1], [0.5, 2, 0], [4, 2, 0], [0.08, 2, 2],
		]
		for (const [scale, prev, want] of cases) assert.equal(lodFor(scale, prev), want, `${scale} from ${prev}`)
	})

	test('G14 (4): 0.1 ± 0.004 never switches, from LOD 1 and from LOD 2', () => {
		assert.ok(LOD_COARSE_SCALE - 0.004 > LOD2_ENTER && LOD_COARSE_SCALE + 0.004 < LOD2_LEAVE)
		for (const start of [1, 2]) {
			let lod = start
			for (let i = 0; i <= 400; i++) {
				const s = LOD_COARSE_SCALE + 0.004 * Math.sin(i / 7)
				lod = lodFor(s, lod)
				assert.equal(lod, start, `step ${i} (${s})`)
			}
		}
	})

	test('a scale that is no positive number keeps the level', () => {
		for (const prev of [0, 1, 2]) {
			for (const s of [NaN, 0, -1, undefined]) assert.equal(lodFor(s, prev), prev)
		}
	})
})

describe('coarseLook', () => {
	test('notes, shapes, text items, unknown types, frames, connectors', () => {
		assert.deepEqual({ ...coarseLook(note(id(1), { style: { fill: '#f5d76e' } })) }, { cls: 'box', color: '#f5d76e', title: '' })
		assert.equal(coarseLook(note(id(2), { style: { fill: 'red' } })).color, DEFAULT_STICKY_FILL, 'rule 18: invalid fill → default')
		assert.equal(coarseLook(shapeItem(id(3), { style: { fill: '#ffc9c9', stroke: '#1a1a1a', strokeWidth: 2 } })).color, '#ffc9c9')
		assert.equal(coarseLook(shapeItem(id(4), { style: { fill: '#ffc9c9', fillOpacity: 40 } })).color, withAlpha('#ffc9c9', 40))
		assert.equal(coarseLook(shapeItem(id(5), { style: { fill: '#ffc9c9', fillOpacity: 0, stroke: '#e03131', strokeWidth: 3 } })).color, '#e03131')
		assert.equal(coarseLook(shapeItem(id(6), { style: { fillOpacity: 0, strokeWidth: 0 } })).cls, 'skip')
		assert.deepEqual({ ...coarseLook(textItem(id(7))) }, { cls: 'box', color: TEXT_BAR_COLOR, title: '' })
		assert.deepEqual({ ...coarseLook({ ...note(id(8)), t: 'mindmap' }) }, { cls: 'box', color: PLACEHOLDER_STROKE, title: '' })
		assert.deepEqual({ ...coarseLook(frameItem(id(9), { data: { title: 'Ideen' }, style: { fill: '#fff6b6' } })) }, { cls: 'frame', color: '#fff6b6', title: 'Ideen' })
		assert.equal(coarseLook(conn(id(10), { item: id(1) }, { x: 0, y: 0 })).cls, 'skip')
	})

	test('cached per item object: the same object gives the same look, a new stored state a new one', () => {
		const a = note(id(1), { style: { fill: '#f5d76e' } })
		assert.equal(coarseLook(a), coarseLook(a))
		const b = { ...a, style: { fill: '#b8f0a0' } }
		assert.equal(coarseLook(b).color, '#b8f0a0')
		assert.ok(Object.isFrozen(coarseLook(a)))
	})
})

/** A board: frame F with two notes (yellow, blue), a rotated note, a shape, a text item, an unknown type, a connector. */
function board() {
	const F = id(100)
	const list = [
		frameItem(F, { x: 0, y: 0, w: 2000, h: 1000, z: 'a0', data: { title: 'Phase 1' } }),
		note(id(1), { x: 100, y: 100, z: 'a1', parent: F, style: { fill: '#fff6b6' } }),
		note(id(2), { x: 400, y: 100, z: 'a2', parent: F, style: { fill: '#a8d8f8' } }),
		note(id(3), { x: 3000, y: 0, z: 'a3', r: 90, w: 200, h: 100, style: { fill: '#fff6b6' } }),
		shapeItem(id(4), { x: 3000, y: 500, z: 'a4', style: { fill: '#ffc9c9', stroke: '#1a1a1a', strokeWidth: 2 } }),
		textItem(id(5), { x: 3500, y: 500, z: 'a5' }),
		{ ...note(id(6), { x: 4000, y: 0, z: 'a6' }), t: 'pen' },
		conn(id(7), { item: id(1) }, { item: id(2) }),
		frameItem(id(101), { x: 0, y: 2000, w: 500, h: 500, z: 'a01', data: { title: '' } }),
	]
	const m = new SceneModel()
	m.load(list)
	return { m, F }
}

describe('planCoarse', () => {
	test('frames first, then content per color in compareOrder; connectors never; rotated items as their bounding box', () => {
		const { m, F } = board()
		const hits = m.query(-1e6, -1e6, 1e6, 1e6)
		const order = coarseOrder(m)
		assert.deepEqual(order.ids, m.sortByOrder(m.ids()))
		const plan = planCoarse(m, hits, () => false, order)
		assert.deepEqual(plan.frames.map((f) => [f.id, f.title, f.fill]), [[F, 'Phase 1', '#ffffff'], [id(101), '', '#ffffff']])
		assert.deepEqual([...plan.groups.keys()], ['#fff6b6', '#a8d8f8', '#ffc9c9', TEXT_BAR_COLOR, PLACEHOLDER_STROKE])
		// note 3 (200 × 100, rotated 90°) is painted as its 100 × 200 bounding box
		assert.deepEqual(plan.groups.get('#fff6b6'), [100, 100, 200, 200, 3050, -50, 100, 200])
		assert.deepEqual(plan.groups.get('#a8d8f8'), [400, 100, 200, 200])
		assert.deepEqual(plan.painted, [F, id(101), id(1), id(2), id(3), id(4), id(5), id(6)])
		assert.ok(!plan.painted.includes(id(7)), 'R13 (b): the connector is not painted')
	})

	test('R13 (a): ids in the activeGroup are left out (a dragged frame with its children)', () => {
		const { m, F } = board()
		const active = new Set([F, id(1), id(2), id(7)])
		const plan = planCoarse(m, m.query(-1e6, -1e6, 1e6, 1e6), (x) => active.has(x), coarseOrder(m))
		assert.deepEqual(plan.painted, [id(101), id(3), id(4), id(5), id(6)])
		assert.deepEqual(plan.groups.get('#fff6b6'), [3050, -50, 100, 200])
		assert.equal(plan.groups.has('#a8d8f8'), false)
	})

	test('only the culled ids; an id without a rank (stale order) gives null; a removed id is skipped', () => {
		const { m, F } = board()
		const order = coarseOrder(m)
		const left = planCoarse(m, m.query(-100, -100, 1000, 1000), () => false, order)
		assert.deepEqual(left.painted, [F, id(1), id(2)])
		m.apply({ upserts: [note(id(50), { x: 50, y: 50, z: 'zz' })] })
		assert.equal(planCoarse(m, m.query(-100, -100, 1000, 1000), () => false, order), null)
		const hits = m.query(-100, -100, 1000, 1000)
		const fresh = coarseOrder(m)
		m.apply({ removes: [id(2)] })
		assert.deepEqual(planCoarse(m, hits, () => false, fresh).painted, [F, id(1), id(50)])
	})
})

describe('fitTitle', () => {
	const measure = (s) => Array.from(s).length * 10
	test('whole title when it fits, else the longest prefix with an ellipsis, whole code points', () => {
		assert.equal(fitTitle(measure, 'Ideen', 50), 'Ideen')
		assert.equal(fitTitle(measure, 'Ideensammlung', 50), 'Idee…')
		assert.equal(fitTitle(measure, '👍👍👍👍👍👍', 40), '👍👍👍…')
		assert.equal(fitTitle(measure, 'Ideen', 15), '')
		assert.equal(fitTitle(measure, '', 5), '')
	})
})

/** A 2D context that records calls and the state at each fill. */
function recorder() {
	const calls = []
	const ctx = {
		fillStyle: null, strokeStyle: null, lineWidth: null, font: null, textBaseline: null, textAlign: null, measured: 0,
		fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
		strokeRect: (...a) => calls.push(['strokeRect', ctx.strokeStyle, ctx.lineWidth, ...a]),
		fillText: (...a) => calls.push(['fillText', ctx.fillStyle, ctx.font, ctx.textBaseline, ...a]),
		measureText: (s) => {
			ctx.measured++
			return { width: Array.from(s).length * (parseFloat(ctx.font) * 0.5) }
		},
	}
	return { ctx, calls }
}

describe('paintCoarse', () => {
	test('frames (fill, 1-px border, 12-px title above, ≥ 40 px only), then one fill run per color; world units', () => {
		const scale = 0.05
		const plan = {
			frames: [
				{ id: 'f1', x: 0, y: 0, w: 4000, h: 2000, fill: '#ffffff', title: 'Phase 1' },
				{ id: 'f2', x: 0, y: 3000, w: 700, h: 700, fill: '#fff6b6', title: 'Klein' },
			],
			groups: new Map([['#a8d8f8', [10, 10, 200, 200, 300, 10, 200, 200]], ['#c6cacf', [600, 10, 240, 30]]]),
			painted: [],
		}
		const { ctx, calls } = recorder()
		paintCoarse(ctx, plan, scale)
		const px = 1 / scale
		assert.deepEqual(calls, [
			['fillRect', '#ffffff', 0, 0, 4000, 2000],
			['strokeRect', FRAME_STROKE, COARSE_BORDER_PX * px, 0, 0, 4000, 2000],
			['fillText', FRAME_TITLE_COLOR, `${COARSE_TITLE_PX * px}px ${FONT_FAMILY}`, 'bottom', 'Phase 1', 0, -COARSE_TITLE_GAP_PX * px],
			['fillRect', '#fff6b6', 0, 3000, 700, 700],
			['strokeRect', FRAME_STROKE, COARSE_BORDER_PX * px, 0, 3000, 700, 700],
			['fillRect', '#a8d8f8', 10, 10, 200, 200],
			['fillRect', '#a8d8f8', 300, 10, 200, 200],
			['fillRect', '#c6cacf', 600, 10, 240, 30],
		])
		assert.ok(700 * scale < COARSE_TITLE_MIN_PX && 4000 * scale >= COARSE_TITLE_MIN_PX)
	})

	test('a long title gets an ellipsis at the frame width; the fit is remembered per title and px width', () => {
		const plan = { frames: [{ id: 'f', x: 0, y: 0, w: 1000, h: 500, fill: '#ffffff', title: 'Eine sehr lange Überschrift' }], groups: new Map(), painted: [] }
		const titles = new Map()
		const { ctx, calls } = recorder()
		// 12-px font at 0.05 = 240 world units, glyph 120 → 8 glyphs fit in 1000 with the ellipsis (7 + …)
		paintCoarse(ctx, plan, 0.05, titles)
		const text = calls.find((c) => c[0] === 'fillText')[4]
		assert.equal(text, 'Eine se…')
		const measured = ctx.measured
		paintCoarse(ctx, plan, 0.05, titles)
		assert.equal(ctx.measured, measured, 'second paint: no measuring')
		assert.equal(titles.size, 1)
	})

	test('(R14-13) every painted title leaves its rectangle: shortened width, COARSE_TITLE_BOX_PX px above the top edge; remembered fits alike', () => {
		const scale = 0.05
		const px = 1 / scale
		const plan = {
			frames: [
				{ id: 'f1', x: 0, y: 0, w: 4000, h: 2000, fill: '#ffffff', title: 'Phase 1' },
				{ id: 'f2', x: 0, y: 3000, w: 700, h: 700, fill: '#ffffff', title: 'Klein' },
				{ id: 'f3', x: 5000, y: 100, w: 1000, h: 500, fill: '#ffffff', title: 'Eine sehr lange Überschrift' },
				{ id: 'f4', x: 7000, y: 100, w: 1000, h: 500, fill: '#ffffff', title: '' },
			],
			groups: new Map(),
			painted: [],
		}
		const titles = new Map()
		const { ctx } = recorder()
		const rects = []
		paintCoarse(ctx, plan, scale, titles, rects)
		assert.equal(COARSE_TITLE_BOX_PX, COARSE_TITLE_PX + COARSE_TITLE_GAP_PX)
		// glyph 120 world units (12-px font at 0.05, half its size): "Phase 1" 7 glyphs, "Eine se…" 8
		const want = [
			{ id: 'f1', x: 0, y: -COARSE_TITLE_BOX_PX * px, w: 7 * 120, h: COARSE_TITLE_BOX_PX * px },
			{ id: 'f3', x: 5000, y: 100 - COARSE_TITLE_BOX_PX * px, w: 8 * 120, h: COARSE_TITLE_BOX_PX * px },
		]
		assert.deepEqual(rects, want)
		const measured = ctx.measured
		const again = []
		paintCoarse(ctx, plan, scale, titles, again)
		assert.equal(ctx.measured, measured, 'remembered fits: no measuring')
		assert.deepEqual(again, want)
		// another scale with the same px width class keeps the px width: the rectangle scales with the camera
		const at = []
		paintCoarse(recorder().ctx, { ...plan, frames: [{ ...plan.frames[0], w: 4000 * 0.05 / 0.06 }] }, 0.06, new Map(), at)
		assert.ok(Math.abs(at[0].w * 0.06 - 7 * 6) < 1e-9 && Math.abs(at[0].h * 0.06 - COARSE_TITLE_BOX_PX) < 1e-9, JSON.stringify(at))
		// without a list nothing is recorded and nothing breaks
		paintCoarse(ctx, plan, scale, titles)
	})
})

describe('coarseTitleHit (R14-13)', () => {
	const rects = [
		{ id: 'low', x: 0, y: -300, w: 840, h: 300 },
		{ id: 'high', x: 600, y: -300, w: 600, h: 300 },
	]
	test('a point in a rectangle hits its frame; the last painted wins where two overlap', () => {
		assert.equal(coarseTitleHit(rects, 100, -150), 'low')
		assert.equal(coarseTitleHit(rects, 700, -150), 'high')
		assert.equal(coarseTitleHit(rects, 1100, -1), 'high')
		assert.equal(coarseTitleHit([], 100, -150), null)
	})
	test('the tolerance widens left, right and top, never below the top edge of the frame', () => {
		assert.equal(coarseTitleHit(rects, -10, -150), null)
		assert.equal(coarseTitleHit(rects, -10, -150, 20), 'low')
		assert.equal(coarseTitleHit(rects, 1210, -150, 20), 'high')
		assert.equal(coarseTitleHit(rects, 100, -310), null)
		assert.equal(coarseTitleHit(rects, 100, -310, 20), 'low')
		assert.equal(coarseTitleHit(rects, 100, 0, 20), null, 'the top edge belongs to the border band')
		assert.equal(coarseTitleHit(rects, 100, 5, 20), null)
		assert.equal(coarseTitleHit(rects, 100, -150, -5), 'low', 'a negative tolerance counts as 0')
		assert.equal(coarseTitleHit(rects, -1, -150, Number.NaN), null)
	})
})

describe('buildCoarse', () => {
	test('one Konva.Shape without hit graph, position transforms only; its sceneFunc paints', () => {
		const made = []
		class Shape {
			constructor(attrs) {
				this.attrs = attrs
				made.push(this)
			}

			transformsEnabled(v) { this.transforms = v }
		}
		const painted = []
		const node = buildCoarse({ Shape }, (c) => painted.push(c))
		assert.equal(made.length, 1)
		assert.equal(node.attrs.listening, false)
		assert.equal(node.attrs.perfectDrawEnabled, false)
		assert.equal(node.transforms, 'position')
		node.attrs.sceneFunc('ctx')
		assert.deepEqual(painted, ['ctx'])
	})
})
