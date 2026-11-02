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
 * - coarseLook: notes as boxes in their fill, shapes by kind with fill
 *   (fillOpacity as alpha) and border (nothing without both), text items as
 *   a grey bar, unknown types as a grey box, frames with fill and title,
 *   (job 202) connectors as lines, mind maps as trees; invalid stored values
 *   draw as their defaults (rule 18); cached per item object
 * - planCoarse: the culled ids in compareOrder (one rank sort), frames
 *   first, content grouped by color, rotated items as their bounding box,
 *   the activeGroup ids left out; a stale order is reported (null)
 * - (job 202) at a scale: outlines instead of boxes from
 *   COARSE_SHAPE_MIN_PX on (rotated about the centre, one fill() each),
 *   borders and connectors as lines of at least 1 px (one stroke() per
 *   colour and width), caps from COARSE_CAP_MIN_PX on, mind maps as root
 *   box, bars and branches
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
	COARSE_BORDER_PX, COARSE_CAP_MIN_PX, COARSE_LINE_PX, COARSE_SHAPE_MIN_PX, COARSE_TITLE_BOX_PX, COARSE_TITLE_GAP_PX,
	COARSE_TITLE_MIN_PX, COARSE_TITLE_PX, buildCoarse, coarseLook, coarseOrder, coarseTitleHit, fitTitle, lodFor, paintCoarse,
	planCoarse,
} from '../../../src/scene/nodes/coarse.js'
import { SHAPES, iconCommands } from '../../../src/model/shapes.js'
import { mindmapLayout } from '../../../src/model/mindmap.js'
import { withAlpha } from '../../../src/scene/nodes/shape.js'
import {
	DEFAULT_STICKY_FILL, FONT_FAMILY, FRAME_TITLE_COLOR, LOD2_ENTER, LOD2_LEAVE, LOD_COARSE_SCALE, LOD_TEXT_SCALE,
	MM_COARSE, MM_COLORS, PLACEHOLDER_STROKE, TEXT_BAR_COLOR,
} from '../../../src/model/tokens.js'
import { frameItem, note, shapeItem, textItem } from './sceneHarness.mjs'

const id = (n) => '01JC' + String(n).padStart(22, '0')
const conn = (cid, start, end) => ({
	id: cid, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b0', parent: null,
	data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1b', strokeWidth: 2 },
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
		assert.deepEqual({ ...coarseLook(note(id(1), { style: { fill: '#f5d76f' } })) }, { cls: 'box', color: '#f5d76f', title: '' })
		assert.equal(coarseLook(note(id(2), { style: { fill: 'red' } })).color, DEFAULT_STICKY_FILL, 'rule 18: invalid fill → default')
		assert.equal(coarseLook(shapeItem(id(3), { style: { fill: '#ffc9ca', stroke: '#1a1a1b', strokeWidth: 2 } })).color, '#ffc9ca')
		assert.equal(coarseLook(shapeItem(id(4), { style: { fill: '#ffc9ca', fillOpacity: 40 } })).color, withAlpha('#ffc9ca', 40))
		assert.equal(coarseLook(shapeItem(id(5), { style: { fill: '#ffc9ca', fillOpacity: 0, stroke: '#e03132', strokeWidth: 3 } })).color, '#e03132')
		assert.equal(coarseLook(shapeItem(id(6), { style: { fillOpacity: 0, strokeWidth: 0 } })).cls, 'skip')
		assert.deepEqual({ ...coarseLook(textItem(id(7))) }, { cls: 'box', color: TEXT_BAR_COLOR, title: '' })
		assert.deepEqual({ ...coarseLook({ ...note(id(8)), t: 'chart' }) }, { cls: 'box', color: PLACEHOLDER_STROKE, title: '' })
		assert.deepEqual({ ...coarseLook(frameItem(id(9), { data: { title: 'Ideen' }, style: { fill: '#fff6b7' } })) }, { cls: 'frame', color: '#fff6b7', stroke: '#7e6f01', title: 'Ideen' })
		// job 202: shapes by their kind, connectors as lines
		assert.deepEqual({ ...coarseLook(shapeItem(id(11), { data: { kind: 'ellipse' }, style: { fill: '#ffc9ca', fillOpacity: 0, stroke: '#e03132', strokeWidth: 3 } })) },
			{ cls: 'shape', color: '#e03132', title: '', kind: 'ellipse', fill: null, stroke: '#e03132', sw: 3 })
		assert.deepEqual({ ...coarseLook(shapeItem(id(12), { data: { kind: 'nope' }, style: { fill: '#ffc9ca', strokeWidth: 0 } })) },
			{ cls: 'shape', color: '#ffc9ca', title: '', kind: 'rect', fill: '#ffc9ca', stroke: null, sw: 0 })
		assert.deepEqual({ ...coarseLook(conn(id(10), { item: id(1) }, { x: 0, y: 0 })) },
			{ cls: 'line', color: '#1a1a1b', title: '', sw: 2, startCap: 'none', endCap: 'none' })
	})

	test('cached per item object: the same object gives the same look, a new stored state a new one', () => {
		const a = note(id(1), { style: { fill: '#f5d76f' } })
		assert.equal(coarseLook(a), coarseLook(a))
		const b = { ...a, style: { fill: '#b8f0a1' } }
		assert.equal(coarseLook(b).color, '#b8f0a1')
		assert.ok(Object.isFrozen(coarseLook(a)))
	})
})

/** A board: frame F with two notes (yellow, blue), a rotated note, a shape, a text item, an unknown type, a connector. */
function board() {
	const F = id(100)
	const list = [
		frameItem(F, { x: 0, y: 0, w: 2000, h: 1000, z: 'a0', data: { title: 'Phase 1' } }),
		note(id(1), { x: 100, y: 100, z: 'a1', parent: F, style: { fill: '#fff6b7' } }),
		note(id(2), { x: 400, y: 100, z: 'a2', parent: F, style: { fill: '#a8d8f9' } }),
		note(id(3), { x: 3000, y: 0, z: 'a3', r: 90, w: 200, h: 100, style: { fill: '#fff6b7' } }),
		shapeItem(id(4), { x: 3000, y: 500, z: 'a4', style: { fill: '#ffc9ca', stroke: '#1a1a1b', strokeWidth: 2 } }),
		textItem(id(5), { x: 3500, y: 500, z: 'a5' }),
		{ ...note(id(6), { x: 4000, y: 0, z: 'a6' }), t: 'brush' },
		conn(id(7), { item: id(1) }, { item: id(2) }),
		frameItem(id(101), { x: 0, y: 2000, w: 500, h: 500, z: 'a01', data: { title: '' } }),
	]
	const m = new SceneModel()
	m.load(list)
	return { m, F }
}

describe('planCoarse', () => {
	test('frames first, then content per color in compareOrder; rotated items as their bounding box; without a scale every shape is a box', () => {
		const { m, F } = board()
		const hits = m.query(-1e6, -1e6, 1e6, 1e6)
		const order = coarseOrder(m)
		assert.deepEqual(order.ids, m.sortByOrder(m.ids()))
		const plan = planCoarse(m, hits, () => false, order)
		assert.deepEqual(plan.frames.map((f) => [f.id, f.title, f.fill]), [[F, 'Phase 1', '#ffffff'], [id(101), '', '#ffffff']])
		assert.deepEqual([...plan.groups.keys()], ['#fff6b7', '#a8d8f9', '#ffc9ca', TEXT_BAR_COLOR, PLACEHOLDER_STROKE])
		// note 3 (200 × 100, rotated 90°) is painted as its 100 × 200 bounding box
		assert.deepEqual(plan.groups.get('#fff6b7'), [100, 100, 200, 200, 3050, -50, 100, 200])
		assert.deepEqual(plan.groups.get('#a8d8f9'), [400, 100, 200, 200])
		assert.deepEqual(plan.painted, [F, id(101), id(1), id(2), id(3), id(4), id(5), id(6), id(7)])
		// job 202: the connector is a line along its route (1 px), in paint order
		assert.deepEqual([...plan.lines.keys()], ['#1a1a1b 1'])
		assert.deepEqual(plan.lines.get('#1a1a1b 1').list.map((g) => g.points), [m.geometryOf(id(7)).points])
		assert.deepEqual(plan.colors, [...plan.groups.keys()])
	})

	test('R13 (a): ids in the activeGroup are left out (a dragged frame with its children)', () => {
		const { m, F } = board()
		const active = new Set([F, id(1), id(2), id(7)])
		const plan = planCoarse(m, m.query(-1e6, -1e6, 1e6, 1e6), (x) => active.has(x), coarseOrder(m))
		assert.deepEqual(plan.painted, [id(101), id(3), id(4), id(5), id(6)])
		assert.deepEqual(plan.groups.get('#fff6b7'), [3050, -50, 100, 200])
		assert.equal(plan.groups.has('#a8d8f9'), false)
	})

	test('only the culled ids; an id without a rank (stale order) gives null; a removed id is skipped', () => {
		const { m, F } = board()
		const order = coarseOrder(m)
		const left = planCoarse(m, m.query(-100, -100, 1000, 1000), () => false, order)
		assert.deepEqual(left.painted, [F, id(1), id(2), id(7)])
		m.apply({ upserts: [note(id(50), { x: 50, y: 50, z: 'zz' })] })
		assert.equal(planCoarse(m, m.query(-100, -100, 1000, 1000), () => false, order), null)
		const hits = m.query(-100, -100, 1000, 1000)
		const fresh = coarseOrder(m)
		m.apply({ removes: [id(2)] })
		// the connector keeps its last route (as the board draws it)
		assert.deepEqual(planCoarse(m, hits, () => false, fresh).painted, [F, id(1), id(7), id(50)])
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
	test('frames (fill, 1-px border in the strong tone (job 262), 12-px title above, ≥ 40 px only), then one fill run per color; world units', () => {
		const scale = 0.05
		const plan = {
			frames: [
				{ id: 'f1', x: 0, y: 0, w: 4000, h: 2000, fill: '#ffffff', stroke: '#6f6f6d', title: 'Phase 1' },
				{ id: 'f2', x: 0, y: 3000, w: 700, h: 700, fill: '#fff6b7', stroke: '#7e6f01', title: 'Klein' },
			],
			groups: new Map([['#a8d8f9', [10, 10, 200, 200, 300, 10, 200, 200]], ['#c6cacf', [600, 10, 240, 30]]]),
			painted: [],
		}
		const { ctx, calls } = recorder()
		paintCoarse(ctx, plan, scale)
		const px = 1 / scale
		assert.deepEqual(calls, [
			['fillRect', '#ffffff', 0, 0, 4000, 2000],
			['strokeRect', '#6f6f6d', COARSE_BORDER_PX * px, 0, 0, 4000, 2000],
			['fillText', FRAME_TITLE_COLOR, `${COARSE_TITLE_PX * px}px ${FONT_FAMILY}`, 'bottom', 'Phase 1', 0, -COARSE_TITLE_GAP_PX * px],
			['fillRect', '#fff6b7', 0, 3000, 700, 700],
			['strokeRect', '#7e6f01', COARSE_BORDER_PX * px, 0, 3000, 700, 700],
			['fillRect', '#a8d8f9', 10, 10, 200, 200],
			['fillRect', '#a8d8f9', 300, 10, 200, 200],
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
				{ id: 'f1', x: 0, y: 0, w: 4000, h: 2000, fill: '#ffffff', stroke: '#6f6f6d', title: 'Phase 1' },
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

/*
 * Job 202: shapes keep their outline at LOD 2, shapes without fill show their border, connectors are thin lines,
 * mind maps show their root, bars and branches. A recording context that applies save/restore/translate/rotate to
 * every path point, so a recorded point is where the canvas would put it in world units.
 */
function pathRecorder() {
	const calls = []
	let m = [1, 0, 0, 1, 0, 0]
	const stack = []
	const q = (v) => Math.round(v * 1000) / 1000 + 0
	const pt = (x, y) => [q(m[0] * x + m[2] * y + m[4]), q(m[1] * x + m[3] * y + m[5])]
	const ctx = {
		fillStyle: null, strokeStyle: null, lineWidth: null, lineCap: null, lineJoin: null, font: '10px x', textBaseline: null, textAlign: null,
		save: () => stack.push(m.slice()),
		restore: () => { m = stack.pop() },
		translate: (x, y) => { m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] },
		rotate: (a) => {
			const c = Math.cos(a)
			const s = Math.sin(a)
			m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[2] * c - m[0] * s, m[3] * c - m[1] * s, m[4], m[5]]
		},
		beginPath: () => calls.push(['beginPath']),
		moveTo: (x, y) => calls.push(['moveTo', ...pt(x, y)]),
		lineTo: (x, y) => calls.push(['lineTo', ...pt(x, y)]),
		bezierCurveTo: (a, b, c, d, e, f) => calls.push(['bezierCurveTo', ...pt(a, b), ...pt(c, d), ...pt(e, f)]),
		quadraticCurveTo: (a, b, c, d) => calls.push(['quadraticCurveTo', ...pt(a, b), ...pt(c, d)]),
		arcTo: (a, b, c, d, r) => calls.push(['arcTo', ...pt(a, b), ...pt(c, d), r]),
		arc: (x, y, r) => calls.push(['arc', ...pt(x, y), r]),
		ellipse: (x, y, rx, ry) => calls.push(['ellipse', ...pt(x, y), rx, ry]),
		rect: (x, y, w, h) => calls.push(['rect', ...pt(x, y), w, h]),
		closePath: () => calls.push(['closePath']),
		fill: () => calls.push(['fill', ctx.fillStyle]),
		stroke: () => calls.push(['stroke', ctx.strokeStyle, ctx.lineWidth]),
		fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
		strokeRect: (...a) => calls.push(['strokeRect', ctx.strokeStyle, ctx.lineWidth, ...a]),
		fillText: (...a) => calls.push(['fillText', ...a]),
		measureText: (s) => ({ width: Array.from(s).length * parseFloat(ctx.font) * 0.5 }),
		setLineDash: (d) => calls.push(['setLineDash', d]),
		setAttr: (k, v) => { ctx[k] = v },
	}
	return { ctx, calls, depth: () => stack.length }
}

/** Plans and paints items at a scale; the calls, the plan and the model. */
function paintAt(items, scale) {
	const m = new SceneModel()
	m.load(items)
	const plan = planCoarse(m, m.query(-1e7, -1e7, 1e7, 1e7), () => false, coarseOrder(m), null, scale)
	const rec = pathRecorder()
	paintCoarse(rec.ctx, plan, scale)
	assert.equal(rec.depth(), 0, 'every save has its restore')
	return { calls: rec.calls, plan, m }
}

/** The calls of the paths that end in fill() or stroke() with this colour: one list per path (beginPath … fill/stroke). */
function pathsOf(calls, op, color) {
	const out = []
	let cur = []
	for (const c of calls) {
		if (c[0] === 'beginPath') cur = []
		else if (c[0] === 'fill' || c[0] === 'stroke') {
			if (c[0] === op && c[1] === color) out.push(cur)
			cur = []
		} else cur.push(c)
	}
	return out
}

const pts = (path) => path.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => [c[1], c[2]])
// job 260: a polygon with rounded corners (SHAPES[kind].corner) has one arcTo per corner, through the corner point
const corners = (path) => path.filter((c) => c[0] === 'arcTo').map((c) => [q3(c[1]), q3(c[2])])
const vertices = (kind, path) => (SHAPES[kind].corner > 0 ? corners(path) : pts(path))
const q3 = (v) => Math.round(v * 1000) / 1000 + 0
const unfilled = { fill: '#ffffff', fillOpacity: 0, stroke: '#e03132', strokeWidth: 2 }

describe('job 202: shapes keep their outline at LOD 2', () => {
	test('AK1: ellipse, diamond, database, document and a symbol paint their outline, no box', () => {
		const style = { fill: '#ffc9ca', strokeWidth: 0 }
		const kinds = ['ellipse', 'diamond', 'database', 'document', 'iconPerson']
		const items = kinds.map((kind, i) => shapeItem(id(i + 1), { x: i * 1000, y: 0, w: 200, h: 100, z: 'a' + i, data: { kind }, style }))
		const { calls, plan } = paintAt(items, 0.08)
		assert.equal(calls.filter((c) => c[0] === 'fillRect').length, 0, 'no box')
		const paths = pathsOf(calls, 'fill', '#ffc9ca')
		assert.equal(paths.length, 5, 'one fill per shape')
		// ellipse: a moveTo to its first point, then the ellipse over the box
		assert.deepEqual(paths[0], [['moveTo', 200, 50], ['ellipse', 100, 50, 100, 50], ['closePath']])
		// diamond, database, document: the SHAPES polygon × box, at the item's place
		for (const [i, kind] of [[1, 'diamond'], [2, 'database'], [3, 'document']]) {
			const o = SHAPES[kind].outline
			const want = []
			for (let k = 0; k < o.length; k += 2) want.push([q3(i * 1000 + o[k] * 200), q3(o[k + 1] * 100)])
			assert.deepEqual(vertices(kind, paths[i]), want, kind)
		}
		// the symbol: its icon commands, stretched over the box
		const cmds = iconCommands('iconPerson')
		assert.equal(paths[4].length, cmds.length)
		// job 244: Phosphor user, M21.649 19.875; the light layer of the Duotone weight stays off at LOD 2
		assert.deepEqual(paths[4][0], ['moveTo', q3(4000 + cmds[0][1] * 200 / 24), q3(cmds[0][2] * 100 / 24)], 'the first point of the icon')
		assert.deepEqual(plan.painted, items.map((it) => it.id))
	})

	test('AK1: a diamond rotated by 45° lies rotated about its box centre', () => {
		const { calls } = paintAt([shapeItem(id(1), { x: 0, y: 0, w: 200, h: 100, r: 45, data: { kind: 'diamond' }, style: { fill: '#ffc9ca', strokeWidth: 0 } })], 0.08)
		const [path] = pathsOf(calls, 'fill', '#ffc9ca')
		const c = Math.SQRT1_2
		// corners of the unrotated diamond relative to the centre (100, 50), turned by 45°
		const want = [[0, -50], [100, 0], [0, 50], [-100, 0]].map(([x, y]) => [q3(100 + x * c - y * c), q3(50 + x * c + y * c)])
		assert.deepEqual(vertices('diamond', path), want)
	})

	test('AK2: a shape smaller than COARSE_SHAPE_MIN_PX stays a box in its fill', () => {
		assert.equal(COARSE_SHAPE_MIN_PX, 4)
		const it = shapeItem(id(1), { x: 10, y: 20, w: 60, h: 40, data: { kind: 'ellipse' }, style: { fill: '#ffc9ca', strokeWidth: 2 } })
		const small = paintAt([it], 0.05)
		assert.deepEqual(small.calls.filter((c) => c[0] !== 'setLineDash'), [['fillRect', '#ffc9ca', 10, 20, 60, 40]], '60 × 0.05 = 3 px: a box, no border')
		assert.equal(paintAt([it], 0.08).calls.filter((c) => c[0] === 'ellipse').length, 2, '4.8 px: the outline, filled and bordered')
		// without fill a small one is a box in its border colour, as before
		const hollow = paintAt([{ ...it, style: unfilled }], 0.05)
		assert.deepEqual(hollow.calls, [['fillRect', '#e03132', 10, 20, 60, 40]])
	})

	test('AK3: without fill only the border, at least 1 screen px, thicker when the border is; neither: nothing', () => {
		const thin = paintAt([shapeItem(id(1), { w: 200, h: 100, data: { kind: 'ellipse' }, style: unfilled })], 0.08)
		assert.equal(thin.calls.filter((c) => c[0] === 'fill' || c[0] === 'fillRect').length, 0, 'not filled')
		const strokes = thin.calls.filter((c) => c[0] === 'stroke')
		assert.equal(strokes.length, 1)
		assert.equal(strokes[0][1], '#e03132')
		assert.ok(Math.abs(strokes[0][2] - COARSE_LINE_PX / 0.08) < 1e-9, 'lineWidth = 1 px')
		assert.deepEqual(pathsOf(thin.calls, 'stroke', '#e03132')[0].slice(0, 2), [['moveTo', 200, 50], ['ellipse', 100, 50, 100, 50]])
		assert.ok(thin.calls.some((c) => c[0] === 'setLineDash' && c[1].length === 0), 'solid, never dashed')
		const thick = paintAt([shapeItem(id(1), { w: 200, h: 100, data: { kind: 'ellipse' }, style: { ...unfilled, strokeWidth: 20, dash: 'dashed' } })], 0.08)
		const s = thick.calls.find((c) => c[0] === 'stroke')
		assert.ok(Math.abs(s[2] - 20) < 1e-9, '20 × 0.08 = 1.6 px: the border keeps its width')
		const none = paintAt([shapeItem(id(1), { w: 200, h: 100, style: { fillOpacity: 0, strokeWidth: 0 } })], 0.08)
		assert.deepEqual(none.calls, [])
		assert.deepEqual(none.plan.painted, [])
	})

	test('a filled shape with a border shows both; the inner lines of database and subprocess go with the border', () => {
		const { calls } = paintAt([
			shapeItem(id(1), { x: 0, y: 0, w: 200, h: 100, z: 'a1', data: { kind: 'subprocess' }, style: { fill: '#ffffff', stroke: '#1a1a1b', strokeWidth: 2 } }),
		], 0.08)
		assert.equal(pathsOf(calls, 'fill', '#ffffff').length, 1)
		const [line] = pathsOf(calls, 'stroke', '#1a1a1b')
		// the box, then its two inner lines at 0.1 and 0.9 of the width
		assert.deepEqual(line, [['rect', 0, 0, 200, 100], ['closePath'], ['moveTo', 20, 0], ['lineTo', 20, 100], ['moveTo', 180, 0], ['lineTo', 180, 100]])
	})

	test('AK4: one fill() per shape (overlapping outlines of one colour never share a path), one stroke() per colour and width', () => {
		const fill = { fill: '#ffc9ca', strokeWidth: 0 }
		const two = paintAt([
			shapeItem(id(1), { x: 0, y: 0, w: 200, h: 100, z: 'a1', data: { kind: 'rect' }, style: fill }),
			shapeItem(id(2), { x: 100, y: 0, w: 200, h: 100, z: 'a2', data: { kind: 'ellipse' }, style: fill }),
		], 0.08)
		assert.deepEqual(two.calls.filter((c) => c[0] === 'beginPath' || c[0] === 'fill').map((c) => c[0]), ['beginPath', 'fill', 'beginPath', 'fill'])
		const many = []
		for (let i = 0; i < 50; i++) many.push(shapeItem(id(i + 1), { x: i * 300, y: 0, w: 200, h: 100, z: 'a' + String(i).padStart(2, '0'), data: { kind: 'diamond' }, style: unfilled }))
		const out = paintAt(many, 0.08)
		assert.equal(out.calls.filter((c) => c[0] === 'stroke').length, 1)
		assert.equal(pathsOf(out.calls, 'stroke', '#e03132')[0].filter((c) => c[0] === 'moveTo').length, 50)
	})

	test('fills keep the order of their colours: boxes and outlines of one colour together, first colour first', () => {
		const { plan, calls } = paintAt([
			shapeItem(id(1), { x: 0, y: 0, w: 200, h: 100, z: 'a1', data: { kind: 'ellipse' }, style: { fill: '#ffc9ca', strokeWidth: 0 } }),
			note(id(2), { x: 500, y: 0, z: 'a2', style: { fill: '#a8d8f9' } }),
			note(id(3), { x: 900, y: 0, z: 'a3', style: { fill: '#ffc9ca' } }),
		], 0.08)
		assert.deepEqual(plan.colors, ['#ffc9ca', '#a8d8f9'])
		assert.deepEqual(calls.filter((c) => c[0] === 'fillRect' || c[0] === 'fill').map((c) => [c[0], c[1]]),
			[['fillRect', '#ffc9ca'], ['fill', '#ffc9ca'], ['fillRect', '#a8d8f9']])
	})
})

describe('job 202: connectors at LOD 2', () => {
	const A = id(1)
	const B = id(2)
	const notes = [note(A, { x: 0, y: 0, z: 'a1' }), note(B, { x: 1000, y: 600, z: 'a2' })]
	const line = (cid, route, style = {}, data = {}) => ({
		id: cid, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + cid.slice(-1), parent: null,
		data: { start: { item: A }, end: { item: B }, route, ...data }, style: { stroke: '#2f6fdb', strokeWidth: 2, ...style },
	})

	test('AK5: straight, right-angled and curved along their route, in their colour, 1 px, solid, without label', () => {
		const items = [...notes, line(id(3), 'straight'), line(id(4), 'elbow', { stroke: '#e03132' }), line(id(5), 'curved', { stroke: '#2b7a3a' }, { label: 'Hallo' })]
		const { calls, plan, m } = paintAt(items, 0.08)
		assert.deepEqual(plan.painted.slice(2), [id(3), id(4), id(5)])
		for (const [cid, color] of [[id(3), '#2f6fdb'], [id(4), '#e03132']]) {
			const g = m.geometryOf(cid)
			assert.notEqual(g.kind, 'bezier')
			const [path] = pathsOf(calls, 'stroke', color)
			const want = []
			for (let k = 0; k < g.points.length; k += 2) want.push([q3(g.points[k]), q3(g.points[k + 1])])
			assert.deepEqual(pts(path), want, cid)
		}
		assert.ok(m.geometryOf(id(4)).points.length > 4, 'the elbow has corners')
		const g = m.geometryOf(id(5))
		assert.equal(g.kind, 'bezier')
		const [curve] = pathsOf(calls, 'stroke', '#2b7a3a')
		assert.deepEqual(curve, [['moveTo', q3(g.points[0]), q3(g.points[1])], ['bezierCurveTo', ...g.points.slice(2).map(q3)]])
		for (const s of calls.filter((c) => c[0] === 'stroke')) assert.ok(Math.abs(s[2] - 1 / 0.08) < 1e-9)
		assert.equal(calls.filter((c) => c[0] === 'fillText').length, 0, 'no label')
	})

	test('AK5: a connector without a route paints nothing', () => {
		const lost = { ...line(id(3), 'straight'), data: { start: { item: id(90) }, end: { item: id(91) }, route: 'straight' } }
		const { plan, m } = paintAt([...notes, lost], 0.08)
		assert.equal(m.geometryOf(id(3)), null)
		assert.ok(!plan.painted.includes(id(3)))
		assert.equal(plan.lines.size, 0)
	})

	test('AK5: caps only from COARSE_CAP_MIN_PX on (job 261: capSize 11.7 → 0.9 px and 19.9 → 1.6 px at 0.08: none; 19.9 → 3.2 px at 0.16: drawn)', () => {
		assert.equal(COARSE_CAP_MIN_PX, 3)
		const thin = paintAt([...notes, line(id(3), 'straight', { endCap: 'arrow', startCap: 'dot' })], 0.08)
		assert.deepEqual(thin.plan.caps, [])
		assert.equal(thin.calls.filter((c) => c[0] === 'stroke').length, 1)
		assert.deepEqual(paintAt([...notes, line(id(3), 'straight', { strokeWidth: 12, endCap: 'arrow', startCap: 'dot' })], 0.08).plan.caps, [])
		const thick = paintAt([...notes, line(id(3), 'straight', { strokeWidth: 12, endCap: 'arrow', startCap: 'dot' })], 0.16)
		assert.deepEqual(thick.plan.caps.map((c) => [c.cap, c.size]), [['dot', 6 + 4 * Math.sqrt(12)], ['arrow', 6 + 4 * Math.sqrt(12)]])
		// the dot filled, the chevron stroked in the connector's colour
		assert.equal(thick.calls.filter((c) => c[0] === 'arc').length, 1)
		assert.deepEqual(thick.calls.filter((c) => c[0] === 'fill' || c[0] === 'stroke').map((c) => [c[0], c[1]]),
			[['stroke', '#2f6fdb'], ['fill', '#2f6fdb'], ['stroke', '#2f6fdb']])
		// the line is 12 × 0.16 = 1.92 px (more than COARSE_LINE_PX)
		assert.ok(Math.abs(thick.calls.find((c) => c[0] === 'stroke')[2] - 1.92 / 0.16) < 1e-9)
	})

	test('R13 (a): a connector moving with a drag is left out like its item, the others stay', () => {
		const items = [...notes, line(id(3), 'straight'), line(id(4), 'straight', { stroke: '#e03132' })]
		const m = new SceneModel()
		m.load(items)
		const active = new Set([A, id(3)])
		const plan = planCoarse(m, m.query(-1e7, -1e7, 1e7, 1e7), (x) => active.has(x), coarseOrder(m), null, 0.08)
		assert.deepEqual(plan.painted, [B, id(4)])
	})
})

describe('job 202: mind maps at LOD 2', () => {
	const R = 'n00000000'
	const K = ['n10000000', 'n20000000', 'n40000000']
	const mm = (o = {}) => {
		const nodes = { b0: { [R]: { o: 'i0' } }, b1: { [K[0]]: { o: 'i0', p: R, c: MM_COLORS[0] } }, b2: { [K[1]]: { o: 'i1', p: R } }, b4: { [K[2]]: { o: 'i2', p: R, d: 'l' } } }
		const texts = { b0: { [R]: 'Thema' }, b1: { [K[0]]: 'Alpha' }, b2: { [K[1]]: 'Beta' }, b4: { [K[2]]: 'Links' } }
		const it = { id: id(1), t: 'mindmap', x: 100, y: 100, w: 0, h: 0, r: 0, z: 'a5', parent: null, data: { nodes, texts }, style: {}, ...o }
		const l = mindmapLayout(it)
		return { ...it, w: l.w, h: l.h }
	}

	test('AK6: the root a box in its colour, three bars in their branch colours, three branches; no text', () => {
		const it = mm()
		const l = mindmapLayout(it)
		const { calls } = paintAt([it], 0.08)
		const root = l.byKey.get(R)
		const rects = calls.filter((c) => c[0] === 'fillRect')
		assert.deepEqual(rects[0], ['fillRect', root.color, 100 + root.x, 100 + root.y, root.w, root.h])
		// a third of the node's height, at least 1 px (12.5 at 0.08), across its middle
		const bars = K.map((k) => l.byKey.get(k)).map((n) => {
			const h = Math.max(n.h / 3, 1 / 0.08)
			return ['fillRect', n.color, 100 + n.x, 100 + n.y + (n.h - h) / 2, n.w, h]
		})
		assert.deepEqual(rects.slice(1).sort(), bars.sort())
		assert.equal(new Set(bars.map((b) => b[1])).size, 3, 'three branch colours')
		assert.equal(calls.filter((c) => c[0] === 'bezierCurveTo').length, 3, 'three branches (curves in layout both)')
		for (const s of calls.filter((c) => c[0] === 'stroke')) assert.ok(Math.abs(s[2] - 1 / 0.08) < 1e-9)
		assert.equal(calls.filter((c) => c[0] === 'fillText' || c[0] === 'arc').length, 0, 'no text, no fold dots')
	})

	test('AK6: right-angled branches in org; a bar of a third of a big node; a mind map under COARSE_SHAPE_MIN_PX is the grey box', () => {
		const org = paintAt([mm({ style: { layout: 'org' } })], 0.08)
		assert.equal(org.calls.filter((c) => c[0] === 'bezierCurveTo').length, 0)
		assert.equal(org.calls.filter((c) => c[0] === 'moveTo').length, 3)
		const it = mm()
		const tiny = 3.9 / Math.max(it.w, it.h)
		const small = paintAt([it], tiny)
		assert.deepEqual(small.calls, [['fillRect', MM_COARSE, 100, 100, it.w, it.h]])
		// where a third of a node is more than a pixel, the bar is that third
		const n = mindmapLayout(it).byKey.get(K[0])
		const bar = paintAt([it], 0.095).calls.find((c) => c[0] === 'fillRect' && c[1] === n.color && c[4] === n.w)
		assert.ok(n.h / 3 > 1 / 0.095 || Math.abs(bar[5] - 1 / 0.095) < 1e-9, JSON.stringify(bar))
		const big = paintAt([it], 0.5).calls.find((c) => c[0] === 'fillRect' && c[1] === n.color && c[4] === n.w)
		assert.ok(Math.abs(big[5] - n.h / 3) < 1e-9 && Math.abs(big[3] - (100 + n.y + n.h / 3)) < 1e-9, JSON.stringify(big))
	})
})
