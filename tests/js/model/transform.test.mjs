/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/transform.js (SPEC-M1 §6.2): the frozen exports and their
 * contracts – selection frame (one item: box and r; several: axis-parallel
 * union, r = 0), handles per type, corner resize with and without ratio,
 * centred resize, minimum without mirroring, rotation snapping, uniform
 * mapping of several boxes, clampFactor. Round 1a adds the transformer
 * scenarios of §8.2 on top. Job 140 (AK1): gapFrame, the selection frame
 * SELECTION_GAP_PX (4) screen px outside a box at every scale. Job 231
 * (AK1, AK2): four corners per box item, the rotation handle beyond the
 * top right corner, shownHandles (what the mouse reveals), the rotation
 * relative to the press (rotationOffset).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as tr from '../../../src/model/transform.js'
import { HANDLE_PX, POINT_REVEAL_PX, ROT_HANDLE_OFFSET_PX, ROT_REVEAL_PX, SELECTION_GAP_PX } from '../../../src/model/tokens.js'

const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`)
const closeBox = (got, want, msg) => {
	for (const k of Object.keys(want)) close(got[k], want[k], `${msg ?? ''} ${k}`)
}

/**
 * @param {Record<string, object>} items id → {t, abs}
 * @param {Record<string, object>} [geoms] id → ConnGeom-like {bbox}
 * @return {object} minimal model: get, abs, geometryOf
 */
function fakeModel(items, geoms = {}) {
	return {
		get: (id) => (items[id] ? { id, t: items[id].t } : undefined),
		abs: (id) => (items[id]?.abs ? { ...items[id].abs } : null),
		geometryOf: (id) => geoms[id] ?? null,
	}
}

describe('transform: exports', () => {
	test('the exported names of §6.2 (+ getCursor of the Konva port)', () => {
		assert.deepEqual(Object.keys(tr).sort(), ['ANCHORS', 'clampFactor', 'gapFrame', 'getCursor', 'handlesFor', 'mapBoxes', 'resizeFrame', 'rotateFrame', 'rotationOffset', 'selectionFrame', 'shownHandles'])
		assert.deepEqual(tr.ANCHORS, ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'rot'])
		assert.ok(Object.isFrozen(tr.ANCHORS))
	})
})

describe('selectionFrame', () => {
	const model = fakeModel({
		a: { t: 'sticky', abs: { x: 0, y: 0, w: 100, h: 100, r: 30 } },
		b: { t: 'shape', abs: { x: 200, y: 50, w: 50, h: 20, r: 0 } },
		c: { t: 'connector', abs: { x: 0, y: 0, w: 0, h: 0, r: 0 } },
		d: { t: 'connector', abs: { x: 0, y: 0, w: 0, h: 0, r: 0 } },
	}, { c: { bbox: [-50, -60, 10, 20] } })

	test('one item: its box and r', () => {
		assert.deepEqual(tr.selectionFrame(model, ['a']), { x: 0, y: 0, w: 100, h: 100, r: 30, n: 1 })
	})

	test('several: axis-parallel union of the rotated boxes, r = 0', () => {
		const f = tr.selectionFrame(model, ['a', 'b', 'zzz'])
		const h = 50 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6))
		closeBox(f, { x: 50 - h, y: 50 - h, w: 250 - (50 - h), h: 50 + h - (50 - h), r: 0, n: 2 })
	})

	test('connectors count with their route box, without one not at all; nothing → null', () => {
		assert.deepEqual(tr.selectionFrame(model, ['c']), { x: -50, y: -60, w: 60, h: 80, r: 0, n: 1 })
		assert.equal(tr.selectionFrame(model, ['d']), null)
		assert.equal(tr.selectionFrame(model, []), null)
		assert.equal(tr.selectionFrame(fakeModel({ c: { t: 'connector' } }), ['c']), null, 'model without geometryOf (M0)')
	})
})

describe('gapFrame (job 140, AK1)', () => {
	const box = { x: 100, y: 100, w: 200, h: 200, r: 0 }
	const xywh = (f) => [f.x, f.y, f.w, f.h, f.r]

	test('SELECTION_GAP_PX is 4; scale 1: 4 world units on every side, scale 2: 2', () => {
		assert.equal(SELECTION_GAP_PX, 4)
		assert.deepEqual(xywh(tr.gapFrame(box, 1)), [96, 96, 208, 208, 0])
		assert.deepEqual(xywh(tr.gapFrame(box, 2)), [98, 98, 204, 204, 0])
		assert.deepEqual(xywh(tr.gapFrame(box, 0.5)), [92, 92, 216, 216, 0])
	})

	test('rotated: same centre, same r; other keys (n) stay; null and a bad scale', () => {
		const f = tr.gapFrame({ ...box, r: 30, n: 1 }, 1)
		assert.equal(f.r, 30)
		assert.equal(f.n, 1)
		close(f.x + f.w / 2, 200, 'centre x')
		close(f.y + f.h / 2, 200, 'centre y')
		assert.deepEqual([f.w, f.h], [208, 208])
		assert.equal(tr.gapFrame(null, 1), null)
		assert.deepEqual(xywh(tr.gapFrame({ x: 0, y: 0, w: 10, h: 10 }, 0)), [-4, -4, 18, 18, 0], 'scale 0 counts as 1, r defaults to 0')
		assert.deepEqual(box, { x: 100, y: 100, w: 200, h: 200, r: 0 }, 'the input stays')
	})

	test('handlesFor on the gap frame: the corners and rot keep their screen distance to the box at scale 2', () => {
		const hs = tr.handlesFor(tr.gapFrame({ ...box, n: 1 }, 2), new Set(['sticky']), 2)
		const at = (n) => hs.find((h) => h.name === n)
		assert.deepEqual([at('tl').x, at('tl').y], [98, 98])
		assert.deepEqual([at('br').x, at('br').y], [302, 302])
		assert.deepEqual([at('rot').x, at('rot').y], [302 + ROT_HANDLE_OFFSET_PX / 2, 98 - ROT_HANDLE_OFFSET_PX / 2])
	})

	test('job 172 (AK5): below – the band of a reaction row (32 units) at the bottom, in the frame\'s axes; top and sides stay; 0, negative or no option: as before', () => {
		const band = 32
		assert.deepEqual(xywh(tr.gapFrame(box, 1, { below: band })), [96, 96, 208, 240, 0], 'down to 4 px below the band')
		assert.deepEqual(xywh(tr.gapFrame(box, 2, { below: band })), [98, 98, 204, 236, 0])
		for (const below of [0, -5, NaN, undefined, '32']) {
			assert.deepEqual(xywh(tr.gapFrame(box, 1, { below })), [96, 96, 208, 208, 0], String(below))
		}
		// rotated 90°: the bottom points to -x in the world; the frame grows that way, its top edge stays
		const f = tr.gapFrame({ ...box, r: 90, n: 1 }, 1, { below: band })
		assert.deepEqual([f.w, f.h, f.r, f.n], [208, 240, 90, 1])
		close(f.x + f.w / 2, 200 - band / 2, 'centre x moves along the rotated downward axis')
		close(f.y + f.h / 2, 200, 'centre y')
		// the bottom handles sit on the extended frame
		const hs = tr.handlesFor(tr.gapFrame({ ...box, n: 1 }, 1, { below: band }), new Set(['sticky']), 1)
		const at = (n) => hs.find((h) => h.name === n)
		assert.deepEqual([at('br').x, at('br').y], [304, 336])
		assert.deepEqual([at('bl').x, at('bl').y], [96, 336])
		assert.deepEqual([at('tl').x, at('tl').y], [96, 96], 'the top stays')
	})
})

describe('handlesFor', () => {
	const frame = { x: 0, y: 0, w: 200, h: 100, r: 0, n: 1 }
	const names = (f, types, s = 1) => tr.handlesFor(f, new Set(types), s).map((h) => h.name)

	test('job 231 (AK1) by type: shape and note four corners + rot, text corners + l/r + rot, frame and pad four corners, connector none', () => {
		assert.deepEqual(names(frame, ['shape']), ['tl', 'tr', 'br', 'bl', 'rot'])
		// keepRatio decides how a corner drags (Shift frees a note's), not which handles exist
		assert.deepEqual(names(frame, ['sticky']), ['tl', 'tr', 'br', 'bl', 'rot'])
		assert.deepEqual(names(frame, ['text']), ['tl', 'tr', 'r', 'br', 'bl', 'l', 'rot'])
		assert.deepEqual(names(frame, ['frame']), ['tl', 'tr', 'br', 'bl'])
		assert.deepEqual(names(frame, ['pad']), ['tl', 'tr', 'br', 'bl'])
		assert.deepEqual(names(frame, ['connector']), [])
		assert.deepEqual(names(frame, ['brush']), [], 'placeholders are not resized')
	})

	test('several items: four corners, no rotation (multi rotation dropped, §12.1)', () => {
		assert.deepEqual(names({ ...frame, n: 3 }, ['shape', 'sticky']), ['tl', 'tr', 'br', 'bl'])
		assert.deepEqual(names({ ...frame, n: 2 }, ['frame', 'sticky']), ['tl', 'tr', 'br', 'bl'])
	})

	test('job 231 (AK1) positions in world coordinates, rotated with the frame; rot 16/16 screen px beyond the top right corner', () => {
		assert.equal(ROT_HANDLE_OFFSET_PX, 16)
		const h = Object.fromEntries(tr.handlesFor(frame, new Set(['shape']), 2).map((x) => [x.name, [x.x, x.y]]))
		assert.deepEqual(h.tl, [0, 0])
		assert.deepEqual(h.br, [200, 100])
		assert.deepEqual(h.tr, [200, 0])
		assert.deepEqual(h.rot, [200 + ROT_HANDLE_OFFSET_PX / 2, -ROT_HANDLE_OFFSET_PX / 2])
		const r90 = Object.fromEntries(tr.handlesFor({ ...frame, r: 90 }, new Set(['shape']), 1).map((x) => [x.name, [x.x, x.y]]))
		close(r90.tl[0], 150, 'tl x')
		close(r90.tl[1], -50, 'tl y')
		// turned by 90° the top right corner lies bottom right; rot goes on along both rotated axes
		close(r90.tr[0], 150, 'tr x')
		close(r90.tr[1], 150, 'tr y')
		close(r90.rot[0], 150 + ROT_HANDLE_OFFSET_PX, 'rot x')
		close(r90.rot[1], 150 + ROT_HANDLE_OFFSET_PX, 'rot y')
	})

	test('no frame → no handles; bad scale counts as 1', () => {
		assert.deepEqual(tr.handlesFor(null, new Set(['shape']), 1), [])
		const h = tr.handlesFor(frame, new Set(['shape']), 0).find((x) => x.name === 'rot')
		assert.equal(h.y, -ROT_HANDLE_OFFSET_PX)
	})
})

describe('shownHandles (job 231, AK2)', () => {
	// a drawn frame of 200 × 100 at scale 1 with the handles of a note and its four points on the edges
	const f = { x: 0, y: 0, w: 200, h: 100, r: 0 }
	const points = [
		{ name: 'plus-t', x: 100, y: 0 }, { name: 'plus-r', x: 200, y: 50 },
		{ name: 'plus-b', x: 100, y: 100 }, { name: 'plus-l', x: 0, y: 50 },
	]
	const list = (fr = f, s = 1) => [...tr.handlesFor(fr, new Set(['sticky']), s), ...points]
	const shown = (p, o = {}, fr = f, s = 1, l = list(fr, s)) => [...tr.shownHandles(l, fr, p, s, o)].sort()
	const corners = ['bl', 'br', 'tl', 'tr']

	test('the constants: 24 px to the corner, 16 px to an edge, a hit circle inside each zone', () => {
		assert.deepEqual([ROT_REVEAL_PX, POINT_REVEAL_PX], [24, 16])
		assert.ok(HANDLE_PX <= POINT_REVEAL_PX)
		// the far side of the rotation handle's hit circle still shows it (on the handle itself)
		assert.ok(Math.hypot(ROT_HANDLE_OFFSET_PX, ROT_HANDLE_OFFSET_PX) + HANDLE_PX > ROT_REVEAL_PX)
	})

	test('the pointer 20 px from the top right corner: rot, no point', () => {
		assert.deepEqual(shown({ x: 214, y: -14 }), [...corners, 'rot'].sort())
		assert.deepEqual(shown({ x: 190, y: 12 }), [...corners, 'rot'].sort(), 'inside the frame near the corner too')
	})

	test('on the rotation handle (22.6 px from the corner) and on the far side of its hit circle: rot', () => {
		assert.deepEqual(shown({ x: 216, y: -16 }), [...corners, 'rot'].sort())
		assert.deepEqual(shown({ x: 216 + 5, y: -16 - 5 }), [...corners, 'rot'].sort())
	})

	test('30 px from the corner outside: no rot', () => {
		assert.deepEqual(shown({ x: 230, y: -30 }), corners)
	})

	test('10 px right of the right edge at half height: plus-r only; 10 px inside the top edge: plus-t only', () => {
		assert.deepEqual(shown({ x: 210, y: 50 }), [...corners, 'plus-r'].sort())
		assert.deepEqual(shown({ x: 100, y: 10 }), [...corners, 'plus-t'].sort())
		assert.deepEqual(shown({ x: 100, y: 117 }), corners, '17 px below the bottom edge: nothing')
		assert.deepEqual(shown({ x: 100, y: 50 }), corners, 'the middle of a large note: nothing')
	})

	test('near the bottom left corner: both points of its edges; along an edge only within ± 16 px of its ends', () => {
		assert.deepEqual(shown({ x: 5, y: 95 }), [...corners, 'plus-b', 'plus-l'].sort())
		assert.deepEqual(shown({ x: -20, y: 50 }), corners, '20 px left of the left edge')
		assert.deepEqual(shown({ x: -10, y: 112 }), [...corners, 'plus-b', 'plus-l'].sort())
		assert.deepEqual(shown({ x: -10, y: 120 }), corners)
	})

	test('a point off its edge (below a label) shows within 16 px of itself', () => {
		const l = [...tr.handlesFor(f, new Set(['shape']), 1), { name: 'plus-b', x: 100, y: 140 }]
		assert.deepEqual(shown({ x: 100, y: 130 }, {}, f, 1, l), [...corners, 'plus-b'].sort())
	})

	test('without a pointer: no rot, no point; a running rotation keeps rot', () => {
		assert.deepEqual(shown(null), corners)
		assert.deepEqual(shown(null, { rotating: true }), [...corners, 'rot'].sort())
	})

	test('a pen or a finger (touch): every handle', () => {
		assert.deepEqual(shown(null, { touch: true }), list().map((h) => h.name).sort())
		assert.deepEqual(shown({ x: 100, y: 50 }, { touch: true }), list().map((h) => h.name).sort())
	})

	test('without a rotation handle the corner zone shows the points of its edges', () => {
		const l = [...tr.handlesFor(f, new Set(['frame']), 1), ...points]
		assert.deepEqual(shown({ x: 205, y: -5 }, {}, f, 1, l), [...corners, 'plus-r', 'plus-t'].sort())
	})

	test('scale 2: the zones stay in screen px; turned by 90° they turn with the frame', () => {
		// 8 world units right of the right edge = 16 screen px: still shown; 9 units = 18 px: not
		const l2 = list(f, 2)
		assert.deepEqual(shown({ x: 208, y: 50 }, {}, f, 2, l2), [...corners, 'plus-r'].sort())
		assert.deepEqual(shown({ x: 209, y: 50 }, {}, f, 2, l2), corners)
		// turned by 90° the frame's right edge lies at the bottom in the world (centre 100, 50)
		const fr = { ...f, r: 90 }
		const l90 = [...tr.handlesFor(fr, new Set(['sticky']), 1), { name: 'plus-r', x: 100, y: 150 }]
		assert.deepEqual(shown({ x: 100, y: 160 }, {}, fr, 1, l90), [...corners, 'plus-r'].sort())
		// its top right corner lies at (150, 150) in the world
		assert.deepEqual(shown({ x: 160, y: 160 }, {}, fr, 1, l90), [...corners, 'rot'].sort())
	})

	test('handles other than rot and the points always show (connector ends, text sides, "+" buttons)', () => {
		const l = [{ name: 'start', x: 0, y: 0 }, { name: 'end', x: 300, y: 0 }]
		assert.deepEqual([...tr.shownHandles(l, null, null, 1)].sort(), ['end', 'start'])
		const t = tr.handlesFor(f, new Set(['text']), 1)
		assert.deepEqual([...tr.shownHandles([...t, { name: 'table-col', x: 248, y: 50 }], f, null, 1)].sort(), [...corners, 'l', 'r', 'table-col'].sort())
	})
})

describe('resizeFrame', () => {
	const f = { x: 100, y: 100, w: 200, h: 100, r: 0, n: 1 }

	test('edges and corners follow the pointer, the opposite side stays', () => {
		closeBox(tr.resizeFrame(f, 'br', 10, 20), { x: 100, y: 100, w: 210, h: 120, r: 0 })
		closeBox(tr.resizeFrame(f, 'tl', 10, 20), { x: 110, y: 120, w: 190, h: 80 })
		closeBox(tr.resizeFrame(f, 'r', 10, 999), { x: 100, y: 100, w: 210, h: 100 }, 'side handles ignore the other axis')
		closeBox(tr.resizeFrame(f, 't', 999, -30), { x: 100, y: 70, w: 200, h: 130 })
		assert.equal(tr.resizeFrame(f, 'br', 1, 1).n, 1, 'other keys kept')
	})

	test('keepRatio on a corner: projection onto the ratio diagonal', () => {
		const g = tr.resizeFrame(f, 'br', 100, 0, { keepRatio: true })
		close(g.w / g.h, 2, 'ratio')
		closeBox(g, { x: 100, y: 100, w: 280, h: 140 })
		const t = tr.resizeFrame(f, 'tl', -40, -20, { keepRatio: true })
		closeBox(t, { x: 60, y: 80, w: 240, h: 120 }, 'tl: the bottom-right corner stays')
	})

	test('centered: the centre stays, the size changes twice', () => {
		closeBox(tr.resizeFrame(f, 'r', 10, 0, { centered: true }), { x: 90, y: 100, w: 220, h: 100 })
		closeBox(tr.resizeFrame(f, 'br', 20, 10, { keepRatio: true, centered: true }), { x: 80, y: 90, w: 240, h: 120 }, 'corner offset (120, 60) from the centre = new half size')
	})

	test('minimum and maximum: the dragged side stops, never mirrors', () => {
		closeBox(tr.resizeFrame(f, 'r', -500, 0, { min: 10 }), { x: 100, y: 100, w: 10, h: 100 })
		closeBox(tr.resizeFrame(f, 'l', 500, 0, { min: 10 }), { x: 290, y: 100, w: 10, h: 100 })
		closeBox(tr.resizeFrame(f, 'br', 5000, 0, { max: 1000 }), { x: 100, y: 100, w: 1000, h: 100 })
		closeBox(tr.resizeFrame(f, 'br', -5000, 0, { keepRatio: true, min: 20 }), { x: 100, y: 100, w: 40, h: 20 })
	})

	test('rotated frame: the offset is taken in the frame axes, the opposite corner stays in the world', () => {
		const r = { x: 0, y: 0, w: 100, h: 50, r: 90 }
		// world (0, 30) is local (+30, 0) for r = 90: the right edge moves out by 30
		const g = tr.resizeFrame(r, 'r', 0, 30)
		closeBox(g, { w: 130, h: 50, r: 90 })
		// the left edge's midpoint (local (0, 25)) stays where it was in the world
		// rotate((-w/2, 0), 90°) = (0, -w/2): the left edge's midpoint sits above the centre
		const leftMid = (b) => [b.x + b.w / 2, b.y + b.h / 2 - b.w / 2]
		const [ax, ay] = leftMid(r)
		const [bx, by] = leftMid(g)
		close(ax, bx, 'x')
		close(ay, by, 'y')
	})

	test('unknown anchor or bad numbers: no throw, frame unchanged', () => {
		assert.deepEqual(tr.resizeFrame(f, 'rot', 10, 10), f)
		assert.deepEqual(tr.resizeFrame(f, 'zz', 10, 10), f)
		closeBox(tr.resizeFrame(f, 'br', NaN, undefined), { x: 100, y: 100, w: 200, h: 100 })
	})
})

describe('rotateFrame', () => {
	const f = { x: 0, y: 0, w: 100, h: 100, r: 0 }

	test('angle from the centre: up = 0°, right = 90°, clockwise; x/y/w/h stay', () => {
		assert.deepEqual(tr.rotateFrame(f, { x: 50, y: -100 }), { ...f, r: 0 })
		assert.deepEqual(tr.rotateFrame(f, { x: 200, y: 50 }), { ...f, r: 90 })
		assert.deepEqual(tr.rotateFrame(f, { x: 50, y: 300 }), { ...f, r: 180 })
		assert.deepEqual(tr.rotateFrame(f, { x: -100, y: 50 }), { ...f, r: 270 })
	})

	test('snaps every 45° within 5°, else free; stepDeg rounds to its multiples', () => {
		const at = (deg) => {
			const t = (deg - 90) * Math.PI / 180
			return { x: 50 + 100 * Math.cos(t), y: 50 + 100 * Math.sin(t) }
		}
		assert.equal(tr.rotateFrame(f, at(48)).r, 45)
		assert.equal(tr.rotateFrame(f, at(357)).r, 0)
		close(tr.rotateFrame(f, at(30)).r, 30, 'free', 1e-9)
		assert.equal(tr.rotateFrame(f, at(37), { stepDeg: 15 }).r, 30)
		close(tr.rotateFrame(f, at(48), { snaps: [], tolDeg: 5 }).r, 48, 'no snaps', 1e-9)
	})

	test('pointer at the centre or missing: r unchanged', () => {
		assert.deepEqual(tr.rotateFrame({ ...f, r: 12 }, { x: 50, y: 50 }), { ...f, r: 12 })
		assert.deepEqual(tr.rotateFrame({ ...f, r: 12 }, null), { ...f, r: 12 })
	})

	test('job 231: rotationOffset of a press at the top right corner; with fromDeg the press turns nothing, a move turns by its angle', () => {
		assert.equal(tr.rotationOffset(f, { x: 50, y: -100 }), 0, 'straight above the centre')
		close(tr.rotationOffset(f, { x: 116, y: -16 }), 45, 'the rotation handle of a square, 45°')
		close(tr.rotationOffset({ ...f, r: 90 }, { x: 116, y: 116 }), 45, 'turned by 90°: still 45° from its top')
		close(tr.rotationOffset(f, { x: -16, y: -16 }), -45, 'left of the top: negative')
		assert.equal(tr.rotationOffset(f, { x: 50, y: 50 }), 0, 'the centre')
		const from = tr.rotationOffset(f, { x: 116, y: -16 })
		assert.equal(tr.rotateFrame(f, { x: 116, y: -16 }, { fromDeg: from }).r, 0, 'the press itself')
		// a quarter turn of the pointer around the centre: 90°
		assert.equal(tr.rotateFrame(f, { x: 116, y: 116 }, { fromDeg: from }).r, 90)
		close(tr.rotateFrame(f, { x: 116, y: 116 }, { fromDeg: from, snaps: [] }).r, 90, 'free', 1e-9)
	})
})

describe('mapBoxes', () => {
	test('one item: the box follows the frame (resize and rotation)', () => {
		const before = { x: 10, y: 20, w: 100, h: 50, r: 0 }
		const boxes = new Map([['a', { ...before }]])
		closeBox(tr.mapBoxes(before, { x: 0, y: 20, w: 110, h: 60, r: 0 }, boxes).get('a'), { x: 0, y: 20, w: 110, h: 60, r: 0 })
		closeBox(tr.mapBoxes(before, { ...before, r: 30 }, boxes).get('a'), { ...before, r: 30 })
	})

	test('several items scale uniformly around the frame; points (zero boxes) map too', () => {
		const before = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		const after = { x: 0, y: 0, w: 400, h: 200, r: 0 }
		const boxes = new Map([['a', { x: 0, y: 0, w: 100, h: 50, r: 15 }], ['p', { x: 200, y: 100, w: 0, h: 0, r: 0 }]])
		const out = tr.mapBoxes(before, after, boxes, { uniform: true })
		closeBox(out.get('a'), { x: 0, y: 0, w: 200, h: 100, r: 15 })
		closeBox(out.get('p'), { x: 400, y: 200, w: 0, h: 0 })
		const u = tr.mapBoxes(before, { x: 0, y: 0, w: 400, h: 100, r: 0 }, boxes, { uniform: true }).get('a')
		close(u.w / u.h, 2, 'uniform keeps the ratio of each box')
	})

	test('fixed boxes (frames in a multi selection, resize none) keep their size; only their centre maps (§6.2 R8)', () => {
		const before = { x: 0, y: 0, w: 200, h: 100, r: 0 }
		const after = { x: 0, y: 0, w: 400, h: 200, r: 0 }
		const boxes = new Map([['f', { x: 100, y: 50, w: 40, h: 20, r: 0 }], ['n', { x: 0, y: 0, w: 20, h: 20, r: 0 }]])
		for (const fixed of [new Set(['f']), ['f']]) {
			const out = tr.mapBoxes(before, after, boxes, { uniform: true, fixed })
			closeBox(out.get('f'), { x: 240 - 20, y: 120 - 10, w: 40, h: 20, r: 0 }, 'centre (120, 60) → (240, 120)')
			closeBox(out.get('n'), { x: 0, y: 0, w: 40, h: 40 })
		}
	})
})

describe('clampFactor', () => {
	const boxes = new Map([['n', { w: 200, h: 200 }], ['s', { w: 10, h: 100 }], ['c', { w: 0, h: 0 }]])
	const types = new Map([['n', 'sticky'], ['s', 'shape'], ['c', 'connector']])

	test('largest k′ ≤ k within every size range; shrinking stops at the first minimum', () => {
		assert.equal(tr.clampFactor(boxes, types, 1.5), 1.5)
		assert.equal(tr.clampFactor(boxes, types, 20), 10, 'note 200 · 10 = 2000 = max')
		assert.equal(tr.clampFactor(boxes, types, 0.5), 1, 'shape w 10 = min')
		assert.equal(tr.clampFactor(new Map([['n', { w: 200, h: 200 }]]), (id) => types.get(id), 0.05), 0.1)
		assert.equal(tr.clampFactor(new Map([['n', { w: 200, h: 200 }]]), { n: 'sticky' }, 0.5), 0.5)
	})

	test('no common factor (already invalid size) → 1', () => {
		assert.equal(tr.clampFactor(new Map([['n', { w: 5, h: 5000 }]]), new Map([['n', 'sticky']]), 2), 1)
	})
})

describe('getCursor', () => {
	test('Konva mapping, turning with the frame', () => {
		assert.equal(tr.getCursor('t', 0), 'ns-resize')
		assert.equal(tr.getCursor('r', 0), 'ew-resize')
		assert.equal(tr.getCursor('tr', 0), 'nesw-resize')
		assert.equal(tr.getCursor('tl', 0), 'nwse-resize')
		assert.equal(tr.getCursor('t', 90), 'ew-resize')
		assert.equal(tr.getCursor('rot', 0), 'crosshair')
	})
})
