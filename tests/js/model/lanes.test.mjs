/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 199 (AK1, AK3, risks): src/model/lanes.js against
 * tests/fixtures/lanes-golden.json (the PHP LanesTest reads it as well):
 * the verdict on data.lanes and the order of the lanes; the bands (exact and
 * in proportion when the heights do not add up to the frame's h); which
 * children lie in which lane (centre in the band, above and below the
 * frame, a group over two bands); the op builders on a real SceneModel:
 * their paths, the children they move, their inverses, the errors (30
 * lanes, too tall, a locked child, the only lane) and the race of two
 * border drags on the same state.
 *
 * Factory job 208 (AK1, AK3, risks): the same for the columns (data.cols,
 * golden colChecks and colOrders), the head row above the lanes, the head
 * column hidden for a single lane without a name, the members by column,
 * the column ops (first, "+", left, right, width, move, delete, rename),
 * moving a lane or a column to an index, the transformer's columns, the
 * race of two column edges and 500 children right of a widened column.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	COLS_MAX, COL_HEAD_H, COL_KEY_RE, COL_MIN_W, COL_NEW_W, FRAME_MAX, LANES_MAX, LANE_FRAME_H, LANE_FRAME_W, LANE_HEAD_W, LANE_KEY_RE,
	LANE_MIN_H, LANE_NEW_H, addCol, addLane, checkCols, checkLanes, colBands, colIndexAt, colMembers, colTop, deleteCol, deleteLane,
	frameWForInner, hasCols, hasLanes, headWidth, laneBands, laneHeadW, laneIndexAt, laneMembers, minColFrameW, minLaneFrameH, moveCol,
	moveColTo, moveLane, moveLaneTo, newLanes, orderedCols, orderedLanes, previewLanes, renameCol, renameLane, resizeLanes, setColWidth,
	setLaneHeight,
	// job 225
	CGROUP_KEY_RE, COL_GROUP_H, GROUPS_MAX, LANE_GROUP_W, LGROUP_KEY_RE, checkGroups, colGroupH, colRuns, groupCol, groupLane, groupUnits,
	laneGroupW, laneRuns, moveGroupTo, renameGroup, spanGroup, ungroup,
	// job 234
	LANE_NAME_MIN_SIZE, LANE_TITLE_SIZE, nameFontSize, nameLine,
} from '../../../src/model/lanes.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { setPath } from '../../../src/model/paths.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { boldLineWidth, labelGlyphWidth } from '../../../src/model/text.js'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/lanes-golden.json', import.meta.url), 'utf8'))

const F = '01JA00000000000000000000F1'
const L1 = 'l00000001'
const L2 = 'l00000002'
const L3 = 'l00000003'
const id = (n) => '01JA0000000000000000000N' + String(n).padStart(2, '0')

/** A frame 1200 × 600 at (100, 100) with three lanes of 200. */
function frame(p = {}) {
	return {
		id: F, t: 'frame', x: 100, y: 100, w: 1200, h: 600, r: 0, z: 'a0', parent: null,
		data: { title: '', lanes: { [L1]: { o: 'i0', h: 200, t: 'Sales' }, [L2]: { o: 'i1', h: 200, t: 'Support' }, [L3]: { o: 'i2', h: 200 } } },
		style: {}, ...p,
	}
}

/** A note child of the frame at relative (x, y), 100 × 100. */
function note(n, x, y, p = {}) {
	return { id: id(n), t: 'sticky', x, y, w: 100, h: 100, r: 0, z: 'i' + n, parent: F, data: { text: String(n) }, style: {}, ...p }
}

function model(items) {
	const m = new SceneModel()
	m.load(items)
	return m
}

/** Applies ops to a copy of the items (patches only), like the server would. */
function applied(items, ops) {
	const byId = new Map(items.map((it) => [it.id, structuredClone(it)]))
	for (const op of ops) {
		let it = byId.get(op.id)
		for (const [path, v] of Object.entries(op.p)) it = setPath(it, path, v)
		byId.set(op.id, it)
	}
	return [...byId.values()]
}

describe('job 199 AK1: the form and the order (golden, shared with PHP)', () => {
	test('the verdict of every golden case', () => {
		assert.ok(golden.checks.length >= 25)
		const wrong = golden.checks.filter((c) => checkLanes(c.lanes) !== c.ok).map((c) => c.name)
		assert.deepEqual(wrong, [])
		const names = Object.fromEntries(golden.checks.map((c) => [c.name, c.ok]))
		for (const [name, ok] of Object.entries({
			'three lanes': true, 'a lane without t': true, '0 lanes': false, '31 lanes': false, 'h 59': false, 'h 100001': false,
			'h as text': false, 'lane key L1234567a': false, 'extra key in a lane': false, 't 201 code points': false, 't empty': false,
		})) assert.equal(names[name], ok, name)
	})

	test('the order: o in byte order, then the key', () => {
		for (const o of golden.orders) {
			assert.ok(checkLanes(o.lanes), o.name)
			assert.deepEqual(orderedLanes(o.lanes).map((l) => l.key), o.keys, o.name)
		}
	})

	test('hasLanes: only a frame whose data.lanes has the form', () => {
		assert.ok(hasLanes(frame()))
		assert.equal(hasLanes({ ...frame(), t: 'sticky' }), false)
		assert.equal(hasLanes(frame({ data: { title: '' } })), false, 'a plain frame')
		assert.equal(hasLanes(frame({ data: { lanes: {} } })), false, 'no lane: drawn as a plain frame')
	})

	test('newLanes: equal heights, the last takes the rounding; random free keys; the names', () => {
		let n = 0
		const rand = () => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8][n++ % 8]
		const lanes = newLanes(500, ['A', 'B', ''], rand)
		assert.ok(checkLanes(lanes))
		const list = orderedLanes(lanes)
		assert.deepEqual(list.map((l) => l.h), [166.67, 166.67, 166.66])
		assert.deepEqual(list.map((l) => l.t), ['A', 'B', ''])
		assert.equal(Object.prototype.hasOwnProperty.call(lanes[list[2].key], 't'), false, 'no name: no t')
		assert.ok(list.every((l) => LANE_KEY_RE.test(l.key) && isValidKey(l.o)))
		assert.equal(new Set(list.map((l) => l.key)).size, 3, 'a repeating random source still gives free keys')
		assert.deepEqual([LANE_FRAME_W, LANE_FRAME_H, LANES_MAX, LANE_MIN_H, LANE_NEW_H, LANE_HEAD_W, FRAME_MAX], [1200, 600, 30, 60, 200, 48, 100000])
	})
})

describe('job 199 AK1: bands and members', () => {
	test('exact bands: the stored heights from the top; the head is at most half the frame', () => {
		assert.deepEqual(laneBands(frame()).map((b) => [b.key, b.y, b.h, b.title]), [[L1, 0, 200, 'Sales'], [L2, 200, 200, 'Support'], [L3, 400, 200, '']])
		assert.equal(headWidth(1200), 48)
		assert.equal(headWidth(60), 30)
		assert.deepEqual(laneBands(frame({ data: { title: '' } })), [])
	})

	test('heights that do not add up to h: the bands in proportion, without a gap to the bottom', () => {
		const b = laneBands(frame({ h: 900 }))
		assert.deepEqual(b.map((x) => x.h), [300, 300, 300])
		assert.equal(b[2].y + b[2].h, 900)
		const c = laneBands(frame({ h: 500 }))
		assert.ok(Math.abs(c.reduce((s, x) => s + x.h, 0) - 500) < 1e-9)
	})

	test('laneIndexAt clamps to the first and the last lane', () => {
		const b = laneBands(frame())
		assert.deepEqual([-50, 0, 199.9, 200, 450, 600, 900].map((y) => laneIndexAt(b, y)), [0, 0, 0, 1, 2, 2, 2])
		assert.equal(laneIndexAt([], 10), -1)
	})

	test('members: the centre of the box decides; above and below the frame count for the first and last lane', () => {
		const m = model([frame(), note(1, 200, 50), note(2, 200, 160), note(3, 400, 450), note(4, 400, -80), note(5, 400, 700),
			{ ...note(6, 0, 0), parent: null }])
		const g = laneMembers(m, F)
		assert.deepEqual(g.get(L1).sort(), [id(1), id(4)])
		assert.deepEqual(g.get(L2), [id(2)], 'centre 210: the second lane')
		assert.deepEqual(g.get(L3).sort(), [id(3), id(5)])
		assert.ok(![...g.values()].flat().includes(id(6)), 'not a child: in no lane')
	})

	test('members: a group counts by the centre of its joint hull', () => {
		const m = model([frame(), note(1, 200, 20, { group: '01JA0000000000000000000G01' }), note(2, 200, 300, { group: '01JA0000000000000000000G01' })])
		const g = laneMembers(m, F)
		// hull 20–400, centre 210: both in the second lane
		assert.deepEqual(g.get(L2).sort(), [id(1), id(2)])
		assert.deepEqual(g.get(L1), [])
	})
})

describe('job 199 AK3: the op builders', () => {
	test('setLaneHeight: the lane, the frame and the children below; the inverse back', () => {
		const items = [frame(), note(1, 200, 50), note(2, 200, 250), note(3, 200, 450)]
		const m = model(items)
		const r = setLaneHeight(m, F, L1, 300)
		assert.deepEqual(r.ops[0], { o: 'patch', id: F, p: { [`data.lanes.${L1}.h`]: 300, h: 700 } })
		assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p]), [[id(2), { x: 200, y: 350, parent: F }], [id(3), { x: 200, y: 550, parent: F }]])
		const back = applied(applied(items, r.ops), r.inverse)
		assert.deepEqual(back, items)
		assert.deepEqual(setLaneHeight(m, F, L1, 200), { error: 'same' })
		assert.equal(setLaneHeight(m, F, L1, 10).ops[0].p[`data.lanes.${L1}.h`], LANE_MIN_H, 'at least LANE_MIN_H')
		assert.deepEqual(setLaneHeight(m, F, 'l99999999', 300), { error: 'gone' })
		const tall = model([frame({ h: 99950, data: { lanes: { [L1]: { o: 'i0', h: 99890 }, [L2]: { o: 'i1', h: 60 } } } })])
		assert.deepEqual(setLaneHeight(tall, F, L1, 100000), { error: 'tall' }, 'the frame would be 100060 high')
	})

	test('a locked child that would move: nothing (locked); one above the border: fine', () => {
		const locked = { lock: { by: 'p1', name: 'Bob' } }
		assert.deepEqual(setLaneHeight(model([frame(), note(2, 200, 250, locked)]), F, L1, 300), { error: 'locked' })
		assert.ok(setLaneHeight(model([frame(), note(1, 200, 50, locked)]), F, L1, 300).ops)
	})

	test('addLane: at the end, above and below; the frame grows, the children below move, the new lane is in place', () => {
		const items = [frame(), note(1, 200, 50), note(2, 200, 250), note(3, 200, 450)]
		const m = model(items)
		const end = addLane(m, F, {}, () => 0.5)
		assert.ok(LANE_KEY_RE.test(end.key))
		assert.equal(end.ops.length, 1, 'at the end nothing moves')
		assert.equal(end.ops[0].p.h, 800)
		const above = addLane(m, F, { at: L2, where: 'above' }, () => 0.5)
		const after = applied(items, above.ops)
		const f = after.find((x) => x.id === F)
		assert.ok(checkLanes(f.data.lanes))
		assert.deepEqual(orderedLanes(f.data.lanes).map((l) => l.key), [L1, above.key, L2, L3])
		assert.deepEqual(above.ops.slice(1).map((o) => [o.id, o.p.y]), [[id(2), 450], [id(3), 650]])
		const below = addLane(m, F, { at: L2, where: 'below' }, () => 0.5)
		assert.deepEqual(orderedLanes(applied(items, below.ops).find((x) => x.id === F).data.lanes).map((l) => l.key), [L1, L2, below.key, L3])
		assert.deepEqual(below.ops.slice(1).map((o) => o.id), [id(3)])
		assert.deepEqual(applied(applied(items, above.ops), above.inverse), items)
	})

	test('addLane: 30 lanes give max; a frame that would get too tall gives tall', () => {
		const lanes = {}
		for (let i = 0; i < 30; i++) lanes['l' + String(i).padStart(8, '0')] = { o: 'i' + '0123456789abcdefghijklmnopqrstuvwxyz'[i], h: 100 }
		assert.deepEqual(addLane(model([frame({ h: 3000, data: { lanes } })]), F), { error: 'max' })
		assert.deepEqual(addLane(model([frame({ h: 99900, data: { lanes: { [L1]: { o: 'i0', h: 99900 } } } })]), F), { error: 'tall' })
	})

	test('addLane: two lanes with the same o (two inserts at once): every lane gets a new o in the new order', () => {
		const items = [frame({ data: { lanes: { [L1]: { o: 'i0', h: 200 }, [L2]: { o: 'i1', h: 200 }, [L3]: { o: 'i1', h: 200 } } } })]
		const r = addLane(model(items), F, { at: L2, where: 'below' }, () => 0.5)
		const f = applied(items, r.ops)[0]
		assert.ok(checkLanes(f.data.lanes))
		assert.deepEqual(orderedLanes(f.data.lanes).map((l) => l.key), [L1, L2, r.key, L3])
	})

	test('moveLane: up and down swap with the neighbour, the children of both move', () => {
		const items = [frame({ data: { lanes: { [L1]: { o: 'i0', h: 100 }, [L2]: { o: 'i1', h: 300 }, [L3]: { o: 'i2', h: 200 } } } }),
			note(1, 200, 0), note(2, 200, 150), note(3, 200, 450)]
		const m = model(items)
		const up = moveLane(m, F, L2, -1)
		const after = applied(items, up.ops)
		assert.deepEqual(orderedLanes(after.find((x) => x.id === F).data.lanes).map((l) => l.key), [L2, L1, L3])
		// lane 2 (300 high) goes up by 100, lane 1 down by 300
		assert.deepEqual(up.ops.slice(1).map((o) => [o.id, o.p.y]).sort(), [[id(1), 300], [id(2), 50]])
		const down = moveLane(m, F, L2, 1)
		assert.deepEqual(orderedLanes(applied(items, down.ops).find((x) => x.id === F).data.lanes).map((l) => l.key), [L1, L3, L2])
		assert.deepEqual(down.ops.slice(1).map((o) => [o.id, o.p.y]).sort(), [[id(2), 350], [id(3), 150]])
		assert.deepEqual(moveLane(m, F, L1, -1), { error: 'gone' }, 'the first lane has no lane above')
		assert.deepEqual(moveLane(m, F, L3, 1), { error: 'gone' })
		assert.deepEqual(applied(applied(items, up.ops), up.inverse), items)
	})

	test('moveLane: equal neighbour o gives every lane a new o', () => {
		const items = [frame({ data: { lanes: { [L1]: { o: 'i1', h: 200 }, [L2]: { o: 'i1', h: 200 }, [L3]: { o: 'i2', h: 200 } } } })]
		const r = moveLane(model(items), F, L3, -1)
		const f = applied(items, r.ops)[0]
		assert.deepEqual(orderedLanes(f.data.lanes).map((l) => l.key), [L1, L3, L2])
	})

	test('deleteLane: its band goes to the lane above (the first lane\'s below); nothing moves or goes', () => {
		const items = [frame(), note(1, 200, 50), note(2, 200, 250)]
		const m = model(items)
		const r = deleteLane(m, F, L2)
		assert.equal(r.ops.length, 1)
		assert.deepEqual(r.ops[0].p, { [`data.lanes.${L2}`]: null, [`data.lanes.${L1}.h`]: 400 })
		const first = deleteLane(m, F, L1)
		assert.deepEqual(first.ops[0].p, { [`data.lanes.${L1}`]: null, [`data.lanes.${L2}.h`]: 400 })
		assert.deepEqual(applied(applied(items, r.ops), r.inverse), items)
		assert.deepEqual(deleteLane(model([frame({ data: { lanes: { [L1]: { o: 'i0', h: 600 } } } })]), F, L1), { error: 'last' })
	})

	test('renameLane: one path, "" as null', () => {
		const m = model([frame()])
		assert.deepEqual(renameLane(m, F, L1, 'Ops'), { ops: [{ o: 'patch', id: F, p: { [`data.lanes.${L1}.t`]: 'Ops' } }], inverse: [{ o: 'patch', id: F, p: { [`data.lanes.${L1}.t`]: 'Sales' } }] })
		assert.deepEqual(renameLane(m, F, L1, '').ops[0].p, { [`data.lanes.${L1}.t`]: null })
		assert.deepEqual(renameLane(m, F, L3, 'New').inverse[0].p, { [`data.lanes.${L3}.t`]: null })
		assert.deepEqual(renameLane(m, F, L1, 'Sales'), { error: 'same' })
	})

	test('risk: two border drags on the same state; the bands stay in the frame, the next op writes every height', () => {
		const items = [frame(), note(3, 200, 450)]
		const m = model(items)
		const a = setLaneHeight(m, F, L1, 250)
		const b = setLaneHeight(m, F, L2, 230)
		const both = applied(applied(items, a.ops), b.ops)
		const f = both.find((x) => x.id === F)
		assert.equal(f.h, 630, 'the h written last')
		assert.ok(checkLanes(f.data.lanes))
		const bands = laneBands(f)
		assert.ok(Math.abs(bands.at(-1).y + bands.at(-1).h - 630) < 1e-9, 'no lane beyond the frame')
		const next = renameLane(model(both), F, L1, 'x')
		assert.ok(next.ops, 'a rename does not care')
		const fix = setLaneHeight(model(both), F, L3, 300)
		const p = fix.ops[0].p
		assert.ok([L1, L2, L3].every((k) => Number.isFinite(p[`data.lanes.${k}.h`])), 'every height is written')
		const g = applied(both, fix.ops).find((x) => x.id === F)
		assert.ok(Math.abs(orderedLanes(g.data.lanes).reduce((s, l) => s + l.h, 0) - g.h) <= 0.01, 'the heights add up again')
	})

	test('resizeLanes (transformer): the top edge changes the first lane, the bottom edge the last; minLaneFrameH', () => {
		const f = frame()
		assert.deepEqual(resizeLanes(f, { y: 100, h: 600 }, { y: 50, h: 650 }).p, { [`data.lanes.${L1}.h`]: 250 })
		assert.deepEqual(resizeLanes(f, { y: 100, h: 600 }, { y: 100, h: 500 }).p, { [`data.lanes.${L3}.h`]: 100 })
		assert.equal(resizeLanes(f, { y: 100, h: 600 }, { y: 100, h: 600 }), null, 'only the width')
		assert.equal(resizeLanes(frame({ data: { title: '' } }), { y: 0, h: 600 }, { y: 0, h: 700 }), null)
		assert.equal(minLaneFrameH(f, 'top'), 460)
		assert.equal(minLaneFrameH(f, 'bottom'), 460)
	})

	test('previewLanes: a dragged border grows the frame; with edge the first or last lane takes the live height', () => {
		const p = previewLanes(frame(), { key: L1, h: 260 })
		assert.equal(p.h, 660)
		assert.deepEqual(laneBands(p).map((b) => b.h), [260, 200, 200])
		const e = previewLanes(frame({ h: 700 }), { edge: 'bottom', h0: 600 })
		assert.deepEqual(laneBands(e).map((b) => b.h), [200, 200, 300])
		const t = previewLanes(frame({ h: 700 }), { edge: 'top', h0: 600 })
		assert.deepEqual(laneBands(t).map((b) => b.h), [300, 200, 200])
	})
})

// ---- Job 208: columns -------------------------------------------------------

const C1 = 'c00000001'
const C2 = 'c00000002'
const C3 = 'c00000003'

/** The frame above (1200 wide, head 160) with the head row (h 656, job 264: before 660) and columns of 300, 400 and 340. */
function grid(p = {}) {
	const f = frame({ h: 656 })
	f.data.cols = { [C1]: { o: 'i0', w: 412, t: 'Discover' }, [C2]: { o: 'i1', w: 400, t: 'Buy' }, [C3]: { o: 'i2', w: 340 } }
	return { ...f, ...p }
}

/** Every patch of the ops by item id. */
const byId = (ops) => Object.fromEntries(ops.map((o) => [o.id, o.p]))

/** 30 columns of 100. */
function thirty() {
	const cols = {}
	for (let i = 1; i <= 30; i++) cols['c' + String(i).padStart(8, '0')] = { o: 'i' + i.toString(36).padStart(2, '0'), w: 100 }
	return cols
}

describe('job 208 AK1: the form of data.cols (golden, shared with PHP)', () => {
	test('the verdict of every golden column case, the named ones, the order', () => {
		assert.ok(golden.colChecks.length >= 20)
		const wrong = golden.colChecks.filter((c) => checkCols(c.cols) !== c.ok).map((c) => c.name)
		assert.deepEqual(wrong, [])
		const names = Object.fromEntries(golden.colChecks.map((c) => [c.name, c.ok]))
		for (const [name, ok] of Object.entries({
			'three columns': true, 'a column without t': true, '0 columns': false, '31 columns': false, 'w 99': false, 'w 100001': false,
			'w as text': false, 'column key C1234567a': false, 'column key l1234567a': false, 'extra key in a column': false,
			't 201 code points': false, 't empty': false,
		})) assert.equal(names[name], ok, name)
		for (const o of golden.colOrders) assert.deepEqual(orderedCols(o.cols).map((c) => c.key), o.keys, o.name)
		for (const v of [null, 'x', 5, true, []]) assert.equal(checkCols(v), false)
		assert.deepEqual([COLS_MAX, COL_MIN_W, COL_NEW_W, COL_HEAD_H], [30, 100, 300, 56])
	})

	test('hasCols: only a frame with lanes and data.cols of the form', () => {
		assert.ok(hasCols(grid()))
		assert.equal(hasCols(frame()), false)
		assert.equal(hasCols({ ...grid(), data: { cols: grid().data.cols } }), false, 'columns without lanes: a plain frame')
		assert.equal(hasCols(grid({ data: { ...grid().data, cols: {} } })), false)
	})
})

describe('job 208 AK1: the grid', () => {
	test('the head row on top: the lanes below it, the columns from the head column to the right edge', () => {
		const g = grid()
		assert.equal(colTop(g), 56)
		assert.equal(colTop(frame()), 0, 'no columns: no head row')
		assert.deepEqual(laneBands(g).map((b) => [b.key, b.y, b.h]), [[L1, 56, 200], [L2, 256, 200], [L3, 456, 200]])
		assert.deepEqual(colBands(g).map((b) => [b.key, b.x, b.w, b.title]), [[C1, 48, 412, 'Discover'], [C2, 460, 400, 'Buy'], [C3, 860, 340, '']])
		assert.deepEqual(colBands(frame()), [])
	})

	test('widths that do not add up to the room: the columns in proportion, up to the right edge; heights below the head row too', () => {
		const c = colBands(grid({ w: 1776 }))
		assert.deepEqual(c.map((x) => x.w), [618, 600, 510])
		assert.equal(c[2].x + c[2].w, 1776)
		const l = laneBands(grid({ h: 956 }))
		assert.deepEqual(l.map((x) => [x.y, x.h]), [[56, 300], [356, 300], [656, 300]])
	})

	test('a single lane without a name: no head column, the columns from the left edge', () => {
		const g = grid({ data: { title: '', lanes: { [L1]: { o: 'i0', h: 600 } }, cols: { [C1]: { o: 'i0', w: 600 }, [C2]: { o: 'i1', w: 600 } } } })
		assert.equal(laneHeadW(g), 0)
		assert.deepEqual(colBands(g).map((b) => [b.x, b.w]), [[0, 600], [600, 600]])
		assert.equal(laneHeadW(frame({ data: { lanes: { [L1]: { o: 'i0', h: 600, t: 'A' } } } })), 48, 'with a name: the head')
		assert.equal(laneHeadW(frame({ data: { lanes: { [L1]: { o: 'i0', h: 300 }, [L2]: { o: 'i1', h: 300 } } } })), 48, 'two lanes without names: the head')
		assert.equal(frameWForInner(g, 900), 900)
		assert.equal(frameWForInner(grid(), 900), 948)
		assert.equal(frameWForInner(grid(), 40), 80, 'a head of half the frame')
	})

	test('colIndexAt clamps; members by column: the centre of the box, outside left and right, a group by its hull', () => {
		const b = colBands(grid())
		assert.deepEqual([-50, 0, 459.9, 460, 900, 1300].map((x) => colIndexAt(b, x)), [0, 0, 0, 1, 2, 2])
		assert.equal(colIndexAt([], 5), -1)
		const m = model([grid(), note(1, 200, 100), note(2, 470, 300), note(3, 1100, 500), note(4, -300, 100), note(5, 1400, 100),
			note(6, 400, 100, { group: 'g1' }), note(7, 520, 100, { group: 'g1' })])
		const g = colMembers(m, F)
		assert.deepEqual(g.get(C1).sort(), [id(1), id(4)])
		assert.deepEqual(g.get(C2).sort(), [id(2), id(6), id(7)], 'the hull 400–620 has its centre 510 in C2')
		assert.deepEqual(g.get(C3).sort(), [id(3), id(5)])
		assert.deepEqual(laneMembers(m, F).get(L1).sort(), [id(1), id(4), id(5), id(6), id(7)], 'a centre in the head row counts for the first lane')
	})
})

describe('job 208 AK3: the column ops', () => {
	test('the first column: as wide as the room, the head row on top, the lanes and their children move down by it', () => {
		const items = [frame(), note(1, 200, 50), note(2, 600, 450)]
		const m = model(items)
		let n = 0
		const r = addCol(m, F, {}, () => [0.1, 0.2, 0.3][n++ % 3])
		assert.ok(COL_KEY_RE.test(r.key))
		assert.deepEqual(r.ops[0].p, { 'data.cols': { [r.key]: { o: 'i0', w: 1152 } }, h: 656 })
		assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p]), [[id(1), { x: 200, y: 106, parent: F }], [id(2), { x: 600, y: 506, parent: F }]])
		const after = applied(items, r.ops)
		const f = after.find((x) => x.id === F)
		assert.ok(hasCols(f))
		assert.deepEqual(laneBands(f).map((b) => [b.y, b.h]), [[56, 200], [256, 200], [456, 200]], 'the lanes keep their heights')
		assert.deepEqual(applied(after, r.inverse), items)
		assert.deepEqual(addCol(model([frame({ h: 99990 })]), F), { error: 'tall' })
	})

	test('a column at the end ("+"), left and right of one: the frame grows by COL_NEW_W, the children right of it move', () => {
		const items = [grid(), note(1, 200, 100), note(2, 500, 100), note(3, 900, 100)]
		const m = model(items)
		const end = addCol(m, F)
		assert.equal(end.ops.length, 1, 'nothing right of the last column')
		assert.equal(end.ops[0].p.w, 1500)
		assert.equal(end.ops[0].p[`data.cols.${end.key}`].w, 300)
		assert.deepEqual(orderedCols(applied(items, end.ops)[0].data.cols).map((c) => c.key), [C1, C2, C3, end.key])
		const left = addCol(m, F, { at: C2, where: 'left' })
		assert.equal(byId(left.ops)[F].w, 1500)
		assert.deepEqual([byId(left.ops)[id(1)], byId(left.ops)[id(2)].x, byId(left.ops)[id(3)].x], [undefined, 800, 1200])
		const f = applied(items, left.ops).find((x) => x.id === F)
		assert.deepEqual(orderedCols(f.data.cols).map((c) => c.key), [C1, left.key, C2, C3])
		assert.deepEqual(applied(applied(items, left.ops), left.inverse), items)
		const right = addCol(m, F, { at: C2, where: 'right' })
		assert.deepEqual([byId(right.ops)[id(2)], byId(right.ops)[id(3)].x], [undefined, 1200])
		assert.deepEqual(addCol(m, F, { at: 'c99999999' }), { error: 'gone' })
	})

	test('30 columns give max, a frame that would get too wide gives wide', () => {
		assert.deepEqual(addCol(model([grid({ w: 3048, data: { ...grid().data, cols: thirty() } })]), F), { error: 'max' })
		const wide = grid({ w: 99900, data: { ...grid().data, cols: { [C1]: { o: 'i0', w: 99852 } } } })
		assert.deepEqual(addCol(model([wide]), F), { error: 'wide' })
		assert.deepEqual(setColWidth(model([wide]), F, C1, 99990), { error: 'wide' })
	})

	test('setColWidth: the column, the frame and the children right of it; the inverse back; same, least width, locked', () => {
		const items = [grid(), note(1, 200, 100), note(2, 500, 300), note(3, 900, 500)]
		const m = model(items)
		const r = setColWidth(m, F, C1, 512)
		assert.deepEqual(r.ops[0].p, { [`data.cols.${C1}.w`]: 512, w: 1300 })
		assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p]), [[id(2), { x: 600, y: 300, parent: F }], [id(3), { x: 1000, y: 500, parent: F }]])
		assert.deepEqual(applied(applied(items, r.ops), r.inverse), items)
		assert.deepEqual(setColWidth(m, F, C1, 412), { error: 'same' })
		assert.equal(setColWidth(m, F, C1, 10).ops[0].p[`data.cols.${C1}.w`], COL_MIN_W)
		assert.deepEqual(setColWidth(m, F, 'c99999999', 300), { error: 'gone' })
		assert.deepEqual(setColWidth(model([grid(), note(3, 900, 500, { lock: { by: 'p1', name: 'Bob' } })]), F, C1, 512), { error: 'locked' })
	})

	test('a column moves to an index (a dragged head, left and right in the menu): its children by the columns it passes, theirs back', () => {
		const items = [grid(), note(1, 200, 100), note(2, 500, 300), note(3, 900, 500)]
		const m = model(items)
		const r = moveColTo(m, F, C1, 2)
		const f = applied(items, r.ops).find((x) => x.id === F)
		assert.deepEqual(orderedCols(f.data.cols).map((c) => c.key), [C2, C3, C1])
		assert.deepEqual([byId(r.ops)[id(1)].x, byId(r.ops)[id(2)].x, byId(r.ops)[id(3)].x], [940, 88, 488])
		assert.equal(byId(r.ops)[id(1)].y, 100, 'a column move keeps y')
		assert.deepEqual(applied(applied(items, r.ops), r.inverse), items)
		const right = moveCol(m, F, C1, 1)
		assert.deepEqual([byId(right.ops)[id(1)].x, byId(right.ops)[id(2)].x, byId(right.ops)[id(3)]], [600, 88, undefined])
		assert.deepEqual(moveCol(m, F, C1, -1), { error: 'gone' })
		assert.deepEqual(moveColTo(m, F, C2, 1), { error: 'same' })
		assert.deepEqual(moveColTo(m, F, C2, 3), { error: 'gone' })
	})

	test('a lane moves to an index (a dragged head): its children by the lanes it passes, theirs back; with the head row too', () => {
		const items = [grid(), note(1, 600, 100), note(2, 600, 300), note(3, 600, 500)]
		const m = model(items)
		const r = moveLaneTo(m, F, L1, 2)
		const f = applied(items, r.ops).find((x) => x.id === F)
		assert.deepEqual(orderedLanes(f.data.lanes).map((l) => l.key), [L2, L3, L1])
		assert.deepEqual([byId(r.ops)[id(1)].y, byId(r.ops)[id(2)].y, byId(r.ops)[id(3)].y], [500, 100, 300])
		assert.deepEqual(applied(applied(items, r.ops), r.inverse), items)
		const plain = [frame(), note(1, 600, 50), note(2, 600, 250)]
		assert.deepEqual(moveLaneTo(model(plain), F, L1, 1).ops, moveLane(model(plain), F, L1, 1).ops, 'the menu entry is a move by one')
	})

	test('deleteCol: its band goes to the column left (the first one\'s right); the last one takes the head row to the first lane; nothing moves', () => {
		const items = [grid(), note(1, 200, 100), note(2, 500, 300)]
		const m = model(items)
		const mid = deleteCol(m, F, C2)
		assert.deepEqual(mid.ops, [{ o: 'patch', id: F, p: { [`data.cols.${C2}`]: null, [`data.cols.${C1}.w`]: 812 } }])
		assert.deepEqual(applied(applied(items, mid.ops), mid.inverse), items)
		assert.deepEqual(deleteCol(m, F, C1).ops[0].p, { [`data.cols.${C1}`]: null, [`data.cols.${C2}.w`]: 812 })
		const one = [grid({ data: { ...grid().data, cols: { [C1]: { o: 'i0', w: 1152 } } } }), note(1, 200, 100)]
		const last = deleteCol(model(one), F, C1)
		assert.deepEqual(last.ops, [{ o: 'patch', id: F, p: { 'data.cols': null, [`data.lanes.${L1}.h`]: 256 } }])
		const f = applied(one, last.ops).find((x) => x.id === F)
		assert.equal(hasCols(f), false)
		assert.deepEqual(laneBands(f).map((b) => [b.y, b.h]), [[0, 256], [256, 200], [456, 200]], 'every lane where it was')
		assert.deepEqual(applied(applied(one, last.ops), last.inverse), one)
	})

	test('renameCol: one path, "" as null', () => {
		const m = model([grid()])
		assert.deepEqual(renameCol(m, F, C3, 'Use').ops, [{ o: 'patch', id: F, p: { [`data.cols.${C3}.t`]: 'Use' } }])
		assert.deepEqual(renameCol(m, F, C1, '').ops[0].p, { [`data.cols.${C1}.t`]: null })
		assert.deepEqual(renameCol(m, F, C1, 'Discover'), { error: 'same' })
		assert.deepEqual(renameCol(model([frame()]), F, C1, 'x'), { error: 'gone' })
	})

	test('risk: two column edges dragged on the same state; the bands stay in the frame, the next op writes every width', () => {
		const items = [grid(), note(3, 900, 500)]
		const m = model(items)
		const both = applied(applied(items, setColWidth(m, F, C1, 350).ops), setColWidth(m, F, C2, 420).ops)
		const f = both.find((x) => x.id === F)
		assert.equal(f.w, 1220, 'the w written last')
		const bands = colBands(f)
		assert.ok(Math.abs(bands.at(-1).x + bands.at(-1).w - 1220) < 1e-9, 'no column beyond the frame')
		const fix = setColWidth(model(both), F, C3, 400)
		assert.ok([C1, C2, C3].every((k) => Number.isFinite(fix.ops[0].p[`data.cols.${k}.w`])), 'every width is written')
		const g = applied(both, fix.ops).find((x) => x.id === F)
		assert.ok(Math.abs(orderedCols(g.data.cols).reduce((s, c) => s + c.w, 0) - (g.w - laneHeadW(g))) <= 0.01, 'the widths add up again')
	})

	test('risk: 500 children right of a widened first column of 30: one step with 501 patches', () => {
		const items = [grid({ w: 3048, data: { ...grid().data, cols: thirty() } })]
		for (let i = 0; i < 500; i++) items.push(note(10 + i, 300 + (i % 20) * 140, 100 + Math.floor(i / 20) * 20))
		const r = setColWidth(model(items), F, 'c00000001', 200)
		assert.equal(r.ops.length, 501)
		assert.ok(r.ops.slice(1).every((o) => o.p.x === items.find((x) => x.id === o.id).x + 100))
	})
})

describe('job 208: the transformer and the previews', () => {
	test('resizeLanes: the left edge changes the first column, the right edge the last; minColFrameW; minLaneFrameH below the head row', () => {
		const g = grid()
		assert.deepEqual(resizeLanes(g, { x: 100, y: 100, w: 1200, h: 656 }, { x: 50, y: 100, w: 1250, h: 656 }).p, { [`data.cols.${C1}.w`]: 462 })
		assert.deepEqual(resizeLanes(g, { x: 100, y: 100, w: 1200, h: 656 }, { x: 100, y: 100, w: 1100, h: 656 }).p, { [`data.cols.${C3}.w`]: 240 })
		assert.deepEqual(resizeLanes(g, { x: 100, y: 100, w: 1200, h: 656 }, { x: 100, y: 100, w: 1300, h: 756 }).p,
			{ [`data.lanes.${L3}.h`]: 300, [`data.cols.${C3}.w`]: 440 }, 'a corner: both')
		assert.equal(resizeLanes(frame(), { x: 0, y: 0, w: 1200, h: 600 }, { x: 0, y: 0, w: 1300, h: 600 }), null, 'no columns: the width alone none')
		assert.equal(minColFrameW(g, 'left'), 48 + 100 + 400 + 340)
		assert.equal(minColFrameW(g, 'right'), 48 + 412 + 400 + 100)
		assert.equal(minColFrameW(frame(), 'right'), 0)
		assert.equal(minLaneFrameH(g, 'top'), 56 + 60 + 400)
	})

	test('previewLanes: a dragged column edge widens the frame; with xedge the first or last column takes the live width', () => {
		const p = previewLanes(grid(), { col: C1, w: 472 })
		assert.equal(p.w, 1260)
		assert.deepEqual(colBands(p).map((b) => b.w), [472, 400, 340])
		const r = previewLanes(grid({ w: 1300 }), { xedge: 'right', w0: 1200 })
		assert.deepEqual(colBands(r).map((b) => b.w), [412, 400, 440])
		const l = previewLanes(grid({ w: 1300, h: 756 }), { xedge: 'left', w0: 1200, edge: 'top', h0: 656 })
		assert.deepEqual(colBands(l).map((b) => b.w), [512, 400, 340])
		assert.deepEqual(laneBands(l).map((b) => b.h), [300, 200, 200])
	})
})

/*
 * Factory job 225 (AK1, AK3, risks): lane and column groups. The golden
 * groupChecks (shared with PHP), the head metrics with a group cell, the
 * runs, and the group ops (create, dissolve, rename, span, move) as well as
 * the rule of a moved lane, the group of an inserted lane and a deleted
 * group's last lane, with their inverses.
 */
const G1 = 'g00000001'
const G2 = 'g00000002'
const H1 = 'h00000001'

/** frame() with lane groups: g a map lane → group, groups the names. */
function gframe(g = {}, groups = { [G1]: 'Team' }, p = {}) {
	const f = frame(p)
	for (const [k, v] of Object.entries(g)) f.data.lanes[k].g = v
	if (groups !== null) f.data.lgroups = groups
	return f
}

/** A frame 1248 wide (head 96) with L1 and L2 in G1 "Team". */
const team = (p = {}) => gframe({ [L1]: G1, [L2]: G1 }, { [G1]: 'Team' }, { w: 1248, ...p })

describe('job 225 AK1: the form of the groups (golden, shared with PHP)', () => {
	test('the verdict of every golden group case and the named ones', () => {
		assert.ok(golden.groupChecks.length >= 20)
		const wrong = golden.groupChecks.filter((c) => (c.kind === 'cols' ? checkCols : checkLanes)(c.map, c.groups) !== c.ok).map((c) => c.name)
		assert.deepEqual(wrong, [])
		const names = Object.fromEntries(golden.groupChecks.map((c) => [c.name, c.ok]))
		for (const [name, ok] of Object.entries({
			'lanes with a group': true, 'a group without a name': true, 'a group without a lane': true, 'g names a missing group': false,
			'g without lgroups': false, 'group key G1234567a': false, 'group key h1234567a in lgroups': false, '0 groups': false,
			'31 groups': false, 'a group as a map': false, 'group name 201 code points': false, 'columns with a group': true,
			'column g names a lane group': false,
		})) assert.equal(names[name], ok, name)
		assert.ok(LGROUP_KEY_RE.test(G1) && CGROUP_KEY_RE.test(H1) && !CGROUP_KEY_RE.test(G1))
		assert.deepEqual([LANE_GROUP_W, COL_GROUP_H, GROUPS_MAX], [48, 44, 30])
		for (const v of [null, 'x', 5, [], {}]) assert.equal(checkGroups(v), false)
	})

	test('hasLanes and hasCols follow the groups; a lane naming a missing group: a plain frame', () => {
		assert.ok(hasLanes(team()))
		assert.equal(hasLanes(gframe({ [L1]: G2 })), false)
		assert.equal(hasLanes(gframe({ [L1]: G1 }, null)), false)
		const g = grid()
		g.data.cols[C1].g = H1
		assert.equal(hasCols(g), false)
		g.data.cgroups = { [H1]: 'Phase' }
		assert.ok(hasCols(g))
	})
})

describe('job 225 AK1: the head with group cells, the runs', () => {
	test('a lane group: the cell left of the names, frameWForInner counts it', () => {
		const f = team()
		assert.equal(laneGroupW(f), 48)
		assert.equal(laneHeadW(f), 96)
		assert.equal(laneGroupW(frame()), 0)
		assert.equal(frameWForInner(f, 1040), 1136)
		assert.equal(frameWForInner(f, 100), 196)
		// a single lane without a name but in a group keeps its head
		const one = { ...frame(), data: { lanes: { [L1]: { o: 'i0', h: 600, g: G1 } }, lgroups: { [G1]: '' } } }
		assert.equal(laneHeadW(one), 96)
	})

	test('a column group: the cell above the names in the head row', () => {
		const g = grid({ h: 700 })
		g.data.cols[C2].g = H1
		g.data.cgroups = { [H1]: 'Phase' }
		assert.equal(colGroupH(g), 44)
		assert.equal(colTop(g), 100)
		assert.deepEqual(laneBands(g).map((b) => [b.y, b.h]), [[100, 200], [300, 200], [500, 200]])
		assert.deepEqual(colRuns(g).map((r) => [r.key, r.from, r.to, r.x, r.w, r.title]), [[H1, 1, 1, 460, 400, 'Phase']])
		assert.deepEqual(colBands(g).map((b) => b.g), [null, H1, null])
	})

	test('runs: neighbours of one group; a group split by a race gives two runs', () => {
		assert.deepEqual(laneRuns(team()).map((r) => [r.key, r.from, r.to, r.y, r.h, r.keys, r.title]), [[G1, 0, 1, 0, 400, [L1, L2], 'Team']])
		const split = gframe({ [L1]: G1, [L3]: G1 })
		assert.deepEqual(laneRuns(split).map((r) => [r.from, r.to]), [[0, 0], [2, 2]])
		assert.deepEqual(groupUnits(team(), G1, 'y'), { units: [{ a: 400, b: 600 }], at: 0 })
		assert.equal(groupUnits(team(), G2, 'y'), null)
	})
})

describe('job 225 AK3: the group ops', () => {
	const kids = () => [note(1, 300, 50), note(2, 300, 250), note(3, 300, 450)]

	test('the first lane group: the map, the lane, the frame 48 wider, every child 48 right; the inverse back', () => {
		const items = [frame(), ...kids()]
		const r = groupLane(model(items), F, L1)
		assert.ok(LGROUP_KEY_RE.test(r.key))
		assert.deepEqual(r.ops[0].p, { 'data.lgroups': { [r.key]: '' }, [`data.lanes.${L1}.g`]: r.key, w: 1248 })
		assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p.x, o.p.y]), [[id(1), 348, 50], [id(2), 348, 250], [id(3), 348, 450]])
		const after = applied(items, r.ops)
		assert.equal(laneHeadW(after[0]), 96)
		assert.deepEqual(applied(after, r.inverse), items)
		assert.deepEqual(groupLane(model(after), F, L1), { error: 'same' })
		assert.deepEqual(groupLane(model([frame({ w: 99960 })]), F, L1), { error: 'wide' })
		assert.deepEqual(groupLane(model([frame(), note(1, 300, 50, { lock: { by: 'u' } })]), F, L1), { error: 'locked' })
		assert.deepEqual(groupLane(model([frame()]), F, 'l99999999'), { error: 'gone' })
	})

	test('a second group: only its entry and its lane; the column widths stay', () => {
		const items = [team(), ...kids().map((n) => ({ ...n, x: n.x + 48 }))]
		const r = groupLane(model(items), F, L3)
		assert.deepEqual(r.ops, [{ o: 'patch', id: F, p: { [`data.lgroups.${r.key}`]: '', [`data.lanes.${L3}.g`]: r.key } }])
		const g = grid({ w: 1248 })
		g.data.lanes[L1].g = G1
		g.data.lgroups = { [G1]: '' }
		const before = colBands(grid()).map((c) => c.w)
		assert.deepEqual(colBands(g).map((c) => c.w), before)
		const u = applied([g], ungroup(model([g]), F, G1).ops)[0]
		assert.equal(u.w, 1200)
		assert.deepEqual(colBands(u).map((c) => c.w), before)
	})

	test('dissolve: the last group takes the cell along (an exact round trip), another one leaves the frame as it is', () => {
		const items = [frame(), ...kids()]
		const made = applied(items, groupLane(model(items), F, L1).ops)
		const g = Object.keys(made[0].data.lgroups)[0]
		const r = ungroup(model(made), F, g)
		assert.equal(r.ops[0].p['data.lgroups'], null)
		assert.equal(r.ops[0].p.w, 1200)
		assert.deepEqual(applied(made, r.ops), items)
		const two = gframe({ [L1]: G1, [L3]: G2 }, { [G1]: 'A', [G2]: 'B' })
		const r2 = ungroup(model([two]), F, G2)
		assert.deepEqual(r2.ops, [{ o: 'patch', id: F, p: { [`data.lgroups.${G2}`]: null, [`data.lanes.${L3}.g`]: null } }])
		assert.deepEqual(ungroup(model([two]), F, 'g99999999'), { error: 'gone' })
	})

	test('rename: one path, the empty name as ""', () => {
		const r = renameGroup(model([team()]), F, G1, 'Org')
		assert.deepEqual(r.ops[0].p, { [`data.lgroups.${G1}`]: 'Org' })
		assert.deepEqual(r.inverse[0].p, { [`data.lgroups.${G1}`]: 'Team' })
		assert.deepEqual(renameGroup(model([team()]), F, G1, '').ops[0].p, { [`data.lgroups.${G1}`]: '' })
		assert.deepEqual(renameGroup(model([team()]), F, G1, 'Team'), { error: 'same' })
	})

	test('span: the dragged edge takes lanes in and lets them go, never another group\'s, at least one', () => {
		const one = gframe({ [L1]: G1 })
		const r = spanGroup(model([one]), F, G1, 0, 1)
		assert.deepEqual(r.ops, [{ o: 'patch', id: F, p: { [`data.lanes.${L2}.g`]: G1 } }])
		assert.deepEqual(spanGroup(model([team()]), F, G1, 1, 1).ops[0].p, { [`data.lanes.${L1}.g`]: null })
		const two = gframe({ [L1]: G1, [L3]: G2 }, { [G1]: 'A', [G2]: 'B' })
		assert.deepEqual(spanGroup(model([two]), F, G1, 0, 2), { error: 'gone' })
		assert.deepEqual(spanGroup(model([two]), F, G1, 1, 1), { error: 'gone' }, 'none of the group in the range')
		assert.deepEqual(spanGroup(model([team()]), F, G1, 0, 1), { error: 'same' })
		assert.deepEqual(spanGroup(model([team()]), F, G1, 1, 0), { error: 'gone' })
	})

	test('move a group: its lanes together before a unit, the children along, the inverse back', () => {
		const items = [team(), ...kids()]
		const r = moveGroupTo(model(items), F, G1, 1)
		const after = applied(items, r.ops)
		assert.deepEqual(orderedLanes(after[0].data.lanes).map((l) => l.key), [L3, L1, L2])
		assert.deepEqual(r.ops.slice(1).map((o) => [o.id, o.p.y]).sort(), [[id(1), 250], [id(2), 450], [id(3), 50]])
		assert.deepEqual(applied(after, r.inverse), items)
		assert.deepEqual(moveGroupTo(model(items), F, G1, 0), { error: 'same' })
		assert.deepEqual(moveGroupTo(model(items), F, G1, 2), { error: 'gone' })
		// a group split by a race comes together
		const split = gframe({ [L1]: G1, [L3]: G1 })
		const j = applied([split], moveGroupTo(model([split]), F, G1, 1).ops)[0]
		assert.deepEqual(orderedLanes(j.data.lanes).map((l) => [l.key, l.g]), [[L2, null], [L1, G1], [L3, G1]])
	})

	test('a moved lane: joins a group it lands inside, keeps its own beside it or alone, else leaves it', () => {
		const lanesOf = (f, r) => orderedLanes(applied([f], r.ops)[0].data.lanes).map((l) => [l.key, l.g])
		// inside a run: joins
		assert.deepEqual(lanesOf(team(), moveLaneTo(model([team()]), F, L3, 1)), [[L1, G1], [L3, G1], [L2, G1]])
		// the only lane of its group: keeps it
		const one = gframe({ [L1]: G1 })
		assert.deepEqual(lanesOf(one, moveLaneTo(model([one]), F, L1, 2)), [[L2, null], [L3, null], [L1, G1]])
		// a neighbour of its group: keeps it
		assert.deepEqual(lanesOf(team(), moveLaneTo(model([team()]), F, L1, 1)), [[L2, G1], [L1, G1], [L3, null]])
		// out of the group: leaves it ("Move lane down" twice in one)
		assert.deepEqual(lanesOf(team(), moveLaneTo(model([team()]), F, L1, 2)), [[L2, G1], [L3, null], [L1, null]])
		// the only lane of G1 lands inside G2: joins G2, G1 goes
		const two = gframe({ [L1]: G1, [L2]: G2, [L3]: G2 }, { [G1]: 'A', [G2]: 'B' })
		const r = moveLaneTo(model([two]), F, L1, 1)
		assert.equal(r.ops[0].p[`data.lgroups.${G1}`], null)
		assert.deepEqual(lanesOf(two, r), [[L2, G2], [L1, G2], [L3, G2]])
		assert.deepEqual(applied(applied([two], r.ops), r.inverse), [two])
		// one step out of the group with "Move lane down" from the last lane of it
		assert.deepEqual(lanesOf(team(), moveLane(model([team()]), F, L2, 1)), [[L1, G1], [L3, null], [L2, null]])
	})

	test('insert beside a lane of a group: in it; "+" at the end: none', () => {
		const r = addLane(model([team()]), F, { at: L1, where: 'above' })
		assert.equal(r.ops[0].p[`data.lanes.${r.key}`].g, G1)
		const above = addLane(model([team()]), F, { at: L3, where: 'above' })
		assert.deepEqual(Object.keys(above.ops[0].p[`data.lanes.${above.key}`]).sort(), ['h', 'o'], 'beside the group, from a lane without one')
		const end = addLane(model([team()]), F)
		assert.equal(end.ops[0].p[`data.lanes.${end.key}`].g, undefined)
	})

	test('delete the last lane of the last group: the group and its cell go, the children move back', () => {
		const items = [gframe({ [L1]: G1 }, { [G1]: 'A' }, { w: 1248 }), ...kids().map((n) => ({ ...n, x: n.x + 48 }))]
		const r = deleteLane(model(items), F, L1)
		assert.equal(r.ops[0].p['data.lgroups'], null)
		assert.equal(r.ops[0].p.w, 1200)
		assert.deepEqual(r.ops.slice(1).map((o) => o.p.x), [300, 300, 300])
		assert.deepEqual(applied(applied(items, r.ops), r.inverse), items)
		const keep = deleteLane(model([team()]), F, L1)
		assert.equal(keep.ops.length, 1)
		assert.equal(keep.ops[0].p['data.lgroups'], undefined)
		assert.equal(keep.ops[0].p.w, undefined)
	})

	test('column groups: the first one heightens the frame by 44 (job 264: before 48), moving every child down; the ops by column', () => {
		const items = [grid(), note(1, 200, 100), note(2, 600, 300)]
		const r = groupCol(model(items), F, C2)
		assert.ok(CGROUP_KEY_RE.test(r.key))
		assert.deepEqual(r.ops[0].p, { 'data.cgroups': { [r.key]: '' }, [`data.cols.${C2}.g`]: r.key, h: 700 })
		assert.deepEqual(r.ops.slice(1).map((o) => [o.p.x, o.p.y]), [[200, 144], [600, 344]])
		const after = applied(items, r.ops)
		assert.equal(colTop(after[0]), 100)
		assert.deepEqual(laneBands(after[0]).map((b) => b.h), [200, 200, 200])
		assert.deepEqual(applied(after, ungroup(model(after), F, r.key, 'x').ops), items)
		// "Add column right" of a grouped column: in the group; moved out: leaves
		const ac = addCol(model(after), F, { at: C2, where: 'right' })
		assert.equal(ac.ops[0].p[`data.cols.${ac.key}`].g, r.key)
		const mv = moveColTo(model(after), F, C2, 2)
		assert.equal(mv.ops[0].p[`data.cols.${C2}.g`], undefined, 'the only column of its group keeps it')
		// span over C3, then delete C2 and C3: the group and its cell go
		const sp = applied(after, spanGroup(model(after), F, r.key, 1, 2, 'x').ops)
		const d1 = applied(sp, deleteCol(model(sp), F, C2).ops)
		assert.equal(d1[0].h, 700)
		const d2 = deleteCol(model(d1), F, C3)
		assert.equal(d2.ops[0].p['data.cgroups'], null)
		assert.equal(d2.ops[0].p.h, 656)
		// the last column takes the groups along, nothing moves
		const last = { ...after[0], data: { ...after[0].data, cols: { [C2]: { ...after[0].data.cols[C2], w: 1040 } } } }
		const dl = deleteCol(model([last]), F, C2)
		assert.equal(dl.ops.length, 1)
		assert.equal(dl.ops[0].p['data.cgroups'], null)
		assert.equal(dl.ops[0].p['data.cols'], null)
	})

	test('the preview of a dragged edge; 500 children move as one step', () => {
		const p = previewLanes(team(), { span: { g: G1, from: 0, to: 2, ax: 'y' } })
		assert.deepEqual(laneBands(p).map((b) => b.g), [G1, G1, G1])
		assert.deepEqual(laneBands(previewLanes(team(), { span: { g: G1, from: 1, to: 1 } })).map((b) => b.g), [null, G1, null])
		const many = [frame()]
		for (let n = 1; n <= 500; n++) many.push(note(n, 300 + (n % 50) * 10, 50 + Math.floor(n / 50) * 50))
		const r = groupLane(model(many), F, L1)
		assert.equal(r.ops.length, 501)
		assert.equal(r.inverse.length, 501)
	})
})

/*
 * Factory job 234 (AK1, AK3, AK4, risks): the head column as narrow as the
 * group cell, the font size of a name drawn in one line, the bold width
 * estimate, and a frame whose columns were stored beside the old 160 wide head.
 */
describe('job 234: turned names', () => {
	test('AK1 the head: 48, 96 with a lane group, at most half the frame', () => {
		assert.equal(LANE_HEAD_W, 48)
		assert.equal(laneHeadW(frame()), 48)
		assert.equal(laneHeadW(team()), 96, 'the group cell and the names, as wide as each other')
		assert.equal(laneHeadW(frame({ w: 60 })), 30)
		assert.equal(frameWForInner(frame(), 1152), 1200)
	})

	test('AK3 the font size: LANE_TITLE_SIZE when it fits, else the largest step that does, else LANE_NAME_MIN_SIZE', () => {
		assert.deepEqual([LANE_TITLE_SIZE, LANE_NAME_MIN_SIZE], [16, 12])
		assert.equal(nameFontSize('Vertrieb', 200), 16)
		assert.equal(nameFontSize('', 60), 16, 'no name')
		const mid = 'Kundenservice Nord'
		assert.ok(boldLineWidth(mid, 16) > 180 - 24, 'too wide at 16 (job 264: the largest size)')
		assert.equal(nameFontSize(mid, 180), 14)
		assert.ok(boldLineWidth(mid, 14) <= 156)
		assert.equal(nameFontSize('x'.repeat(200), 200), 12, 'cut at 12')
		assert.equal(nameFontSize('Team', 200), nameFontSize('Team', 200), 'one rule for lanes and groups')
		assert.equal(nameFontSize('Kundenservice', NaN), 12)
		// risk: emoji and CJK in a lane of LANE_MIN_H
		assert.equal(nameFontSize('営業チーム 🚀', 60), 12)
		assert.ok(boldLineWidth('営業チーム 🚀', 12) > 60 - 24, 'Konva cuts it with "…"')
	})

	test('AK3 a name in one line: a line break is a space', () => {
		assert.equal(nameLine('Vertrieb\nNord'), 'Vertrieb Nord')
		assert.equal(nameLine('A\r\nB'), 'A B')
		assert.equal(nameLine(undefined), '')
		assert.equal(nameFontSize('Vertrieb\nNord', 200), nameFontSize('Vertrieb Nord', 200))
	})

	test('AK3 the bold estimate: at least the regular one for every code point of the tables, integer px', () => {
		for (const fs of [12, 14, 16, 18, 20]) {
			for (let cp = 0x20; cp <= 0xff; cp++) {
				if (cp > 0x7e && cp < 0xa0) continue
				const ch = String.fromCodePoint(cp)
				assert.ok(boldLineWidth(ch, fs) >= labelGlyphWidth(cp, fs), `U+${cp.toString(16)} at ${fs}`)
				assert.ok(Number.isInteger(boldLineWidth(ch, fs)))
			}
		}
		assert.equal(boldLineWidth('漢', 20), labelGlyphWidth(0x6f22, 20), 'outside the tables: as a label')
		assert.ok(boldLineWidth('Sales', 20) > [...'Sales'].reduce((s, c) => s + labelGlyphWidth(c.codePointAt(0), 20), 0), 'bold is wider')
	})

	test('AK4 columns stored beside the old 160 wide head: the first one takes the room, no other border moves', () => {
		const old = grid({ data: { ...grid().data, cols: { [C1]: { o: 'i0', w: 300, t: 'Discover' }, [C2]: { o: 'i1', w: 400 }, [C3]: { o: 'i2', w: 340 } } } })
		assert.deepEqual(colBands(old).map((b) => [b.x, b.w]), [[48, 412], [460, 400], [860, 340]])
		assert.deepEqual(colBands(grid()).map((b) => [b.x, b.w]), [[48, 412], [460, 400], [860, 340]], 'stored for the new head: as stored')
		// a child at the old border stays in its column
		const m = model([old, note(1, 405, 100), note(2, 415, 300)])
		const by = colMembers(m, F)
		assert.deepEqual([by.get(C1), by.get(C2)], [[id(1)], [id(2)]])
		// the next op writes every width, the first one with the room: nothing is lost
		const r = setColWidth(m, F, C3, 400)
		assert.deepEqual(r.ops[0].p, { [`data.cols.${C1}.w`]: 412, [`data.cols.${C2}.w`]: 400, [`data.cols.${C3}.w`]: 400, w: 1260 })
		assert.deepEqual(r.inverse[0].p, { [`data.cols.${C1}.w`]: 300, [`data.cols.${C2}.w`]: 400, [`data.cols.${C3}.w`]: 340, w: 1200 })
		const after = applied([old], r.ops)[0]
		assert.deepEqual(colBands(after).map((b) => [b.x, b.w]), [[48, 412], [460, 400], [860, 400]])
		// with a lane group: the old head was 48 + 160
		const g = grid({ w: 1248, data: { ...old.data, lanes: { ...old.data.lanes, [L1]: { ...old.data.lanes[L1], g: G1 } }, lgroups: { [G1]: '' } } })
		assert.deepEqual(colBands(g).map((b) => [b.x, b.w]), [[96, 412], [508, 400], [908, 340]])
		// widths that add up to neither room: in proportion as before
		assert.deepEqual(colBands(grid({ w: 1776 })).map((b) => b.w), [618, 600, 510])
	})

	test('AK4 the transformer on an old frame: the first column keeps the room it gained', () => {
		const old = grid({ data: { ...grid().data, cols: { [C1]: { o: 'i0', w: 300, t: 'Discover' }, [C2]: { o: 'i1', w: 400 }, [C3]: { o: 'i2', w: 340 } } } })
		assert.deepEqual(resizeLanes(old, { x: 100, y: 100, w: 1200, h: 656 }, { x: 100, y: 100, w: 1300, h: 656 }).p,
			{ [`data.cols.${C1}.w`]: 412, [`data.cols.${C2}.w`]: 400, [`data.cols.${C3}.w`]: 440 })
	})
})

test('job 286: a lane move carries a covered note (private writing) along with exactly x, y and parent', () => {
	const hidden = note(2, 600, 300, { data: { covered: true }, style: {} })
	const items = [frame(), note(1, 600, 100), hidden]
	const r = moveLane(model(items), F, L2, -1)
	const op = r.ops.find((o) => o.id === id(2))
	assert.deepEqual(Object.keys(op.p).sort(), ['parent', 'x', 'y'])
	assert.equal(op.p.parent, F)
	assert.equal(op.p.y, 100)
	assert.deepEqual(r.inverse.find((o) => o.id === id(2)).p, { x: 600, y: 300, parent: F })
})
