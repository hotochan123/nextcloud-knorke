/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 264 (design round 4, S4): swimlanes in the tone of their
 * frame. The heads in the tab tone at 45 % over the fill (the empty corner
 * too), group cells at 75 %, dividers only between lanes and columns in the
 * tab tone darkened with black (columns at 70 %), names in the tab text
 * colour of their fill; the head row 56, the column groups' cell 44, names
 * 16 (column groups 14); frames stored with the old head row keep their
 * borders.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { frame as frameSpec } from '../../../src/scene/nodes/frame.js'
import {
	COL_GROUP_H, COL_GROUP_SIZE, COL_HEAD_H, LANE_FRAME_H, LANE_FRAME_W, LANE_HEAD_W, LANE_NEW_H, LANE_TITLE_SIZE, LANES_NEW,
	colTop, laneBands, ungroup,
} from '../../../src/model/lanes.js'
import { frameTabFill, frameTabText, laneTones, mixColor } from '../../../src/model/tokens.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const F = '01JA00000000000000000000F1'
const L1 = 'l00000001'
const L2 = 'l00000002'
const L3 = 'l00000003'
const C1 = 'c00000001'
const C2 = 'c00000002'
const G1 = 'g00000001'
const H1 = 'h00000001'

class Node {
	constructor(a = {}) {
		this.attrs = { ...a }
		this.kids = []
	}

	setAttrs(a) { Object.assign(this.attrs, a) }
	visible(v) { this.attrs.visible = v }
	transformsEnabled() {}
	add(...k) { this.kids.push(...k) }
	destroy() {}
}
const ctx = { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {} }

/**
 * A frame 600 wide with three lanes of 100, L1 and L2 in G1, columns C1 (in H1) and C2 of 276, the head row with
 * the group cell (44 + 56) on top.
 */
function grid(fill = '#ffffff', p = {}) {
	return {
		id: F, t: 'frame', x: 100, y: 100, w: 600, h: 400, r: 0, z: 'a0', parent: null,
		data: {
			title: 'Ablauf',
			lanes: { [L1]: { o: 'i0', h: 100, t: 'Sales', g: G1 }, [L2]: { o: 'i1', h: 100, t: 'Support', g: G1 }, [L3]: { o: 'i2', h: 100, t: 'Lager' } },
			lgroups: { [G1]: 'Team' },
			cols: { [C1]: { o: 'i0', w: 252, t: 'Planen', g: H1 }, [C2]: { o: 'i1', w: 252, t: 'Bauen' } },
			cgroups: { [H1]: 'Phase' },
		},
		style: { fill },
		...p,
	}
}

const build = (it) => frameSpec.build(ctx, it, { x: it.x, y: it.y, w: it.w, h: it.h, r: 0 }, 0, false)
const rects = (e) => e.parts.lanes.kids.filter((k) => k instanceof ctx.Rect)
const shapes = (e) => e.parts.lanes.kids.filter((k) => k instanceof ctx.Shape)
const path = (shape) => {
	const p = []
	shape.attrs.sceneFunc({ beginPath() {}, moveTo: (x, y) => p.push(['m', x, y]), lineTo: (x, y) => p.push(['l', x, y]), strokeShape() {} }, shape)
	return p
}

describe('job 264: the heads', () => {
	for (const fill of ['#ffffff', '#faea89']) {
		test(`AK1 AK2 ${fill}: head column and head row in the tab tone at 45 % over the fill, the corner with them, group cells at 75 %`, () => {
			const tab = frameTabFill(fill)
			const tone = laneTones(fill)
			assert.deepEqual(tone, { head: mixColor(tab, fill, 0.45), group: mixColor(tab, fill, 0.75), line: mixColor(tab, '#000000', 0.85) })
			const e = build(grid(fill))
			const r = rects(e).map((k) => [k.attrs.x, k.attrs.y, k.attrs.width, k.attrs.height, k.attrs.fill])
			assert.deepEqual(r, [
				[0, 0, 96, 400, tone.head], // the head column over the full height: the corner above the lanes too
				[96, 0, 504, 100, tone.head], // the head row
				[0, 100, 48, 200, tone.group], // the lane group's cell
				[96, 0, 252, 44, tone.group], // the column group's cell
			])
			// the corner (0..96, 0..100) carries no name
			for (const t of e.parts.laneTitles.values()) {
				const [x0, y0] = t.attrs.rotation === -90 ? [t.attrs.x, t.attrs.y - t.attrs.width] : [t.attrs.x, t.attrs.y]
				assert.ok(!(x0 < 96 && y0 < 100), 'no name in the corner: ' + t.attrs.text)
			}
		})
	}

	test('AK3 dividers only between lanes and between columns: 1 screen px in the darkened tab tone, columns at 0.7', () => {
		const tone = laneTones('#faea89')
		const [lanes, cols] = shapes(build(grid('#faea89')))
		for (const s of [lanes, cols]) assert.deepEqual([s.attrs.stroke, s.attrs.strokeWidth, s.attrs.strokeScaleEnabled], [tone.line, 1, false])
		assert.deepEqual([lanes.attrs.opacity, cols.attrs.opacity], [1, 0.7])
		// within G1 from its cell on, below the run over the full width; none along the heads or the cells
		assert.deepEqual(path(lanes), [['m', 48, 200], ['l', 600, 200], ['m', 0, 300], ['l', 600, 300]])
		// C1 is the only column of H1: the border to C2 ends its run, full height
		assert.deepEqual(path(cols), [['m', 348, 0], ['l', 348, 400]])
	})

	test('AK4 names: lanes and lane groups turned, bold 16 down to 12; columns left 16 wrapping; column groups left 14', () => {
		const t = build(grid()).parts.laneTitles
		const a = (k) => [t.get(k).attrs.rotation, t.get(k).attrs.fontStyle, t.get(k).attrs.fontSize, t.get(k).attrs.align, t.get(k).attrs.wrap]
		assert.deepEqual(a(L1), [-90, 'bold', 16, 'center', 'none'])
		assert.deepEqual(a(G1 + ':0'), [-90, 'bold', 16, 'center', 'none'])
		assert.deepEqual(a(C1), [undefined, 'bold', 16, 'left', 'word'])
		assert.equal(t.get(C1).attrs.padding, 12)
		assert.deepEqual(a(H1 + ':96'), [0, 'bold', 14, 'left', 'none'])
		const long = grid()
		long.data.lanes[L3].t = 'Kundenservice Nord und Süd'
		assert.equal(build(long).parts.laneTitles.get(L3).attrs.fontSize, 12, 'smaller down to 12, then "…"')
		assert.equal(build(long).parts.laneTitles.get(L3).attrs.ellipsis, true)
	})

	test('AK7 a black frame: every name in the tab text colour of its fill (white), dividers in its own tone', () => {
		const tone = laneTones('#191b1d')
		const t = build(grid('#191b1d')).parts.laneTitles
		assert.equal(frameTabText(tone.head), '#ffffff')
		for (const [k, n] of t) assert.equal(n.attrs.fill, frameTabText(k.includes(':') ? tone.group : tone.head), k)
		assert.notEqual(tone.line, tone.head)
	})
})

describe('job 264: sizes and old frames', () => {
	test('AK5 the head row 56, the column groups\' cell 44, names 16 and 14, the head 48; a new swimlane 1200 × 600 with 3 lanes of 200', () => {
		assert.deepEqual([COL_HEAD_H, COL_GROUP_H, LANE_TITLE_SIZE, COL_GROUP_SIZE, LANE_HEAD_W], [56, 44, 16, 14, 48])
		assert.deepEqual([LANE_FRAME_W, LANE_FRAME_H, LANES_NEW, LANE_NEW_H], [1200, 600, 3, 200])
		assert.equal(colTop(grid()), 100)
	})

	test('AK6 lanes stored below the old head row (60, with groups 48 + 60): the first lane takes the room, no other border moves', () => {
		const plain = grid('#ffffff', { h: 360 })
		delete plain.data.cgroups
		delete plain.data.cols[C1].g
		assert.deepEqual(laneBands(plain).map((b) => [b.y, b.h]), [[56, 104], [160, 100], [260, 100]])
		const grouped = grid('#ffffff', { h: 408 })
		assert.deepEqual(laneBands(grouped).map((b) => [b.y, b.h]), [[100, 108], [208, 100], [308, 100]])
		// heights that fit neither: in proportion as before
		const odd = grid('#ffffff', { h: 500 })
		assert.deepEqual(laneBands(odd).map((b) => [b.y, b.h]), [[100, 400 / 3], [100 + 400 / 3, 400 / 3], [100 + 800 / 3, 500 - 100 - 800 / 3]])
		// the new sizes: as stored
		assert.deepEqual(laneBands(grid()).map((b) => [b.y, b.h]), [[100, 100], [200, 100], [300, 100]])
	})

	test('risk: the last column group goes on an old frame: the frame shrinks by the drawn cell, the lanes keep their borders', () => {
		const old = grid('#ffffff', { h: 408 })
		const kid = { id: '01JA0000000000000000000N01', t: 'sticky', x: 300, y: 330, w: 50, h: 50, r: 0, z: 'i1', parent: F, data: { text: 'a' }, style: {} }
		const m = new SceneModel()
		m.load([old, kid])
		const r = ungroup(m, F, H1, 'x')
		assert.ok(r && Array.isArray(r.ops), 'no error')
		const p = r.ops.find((o) => o.id === F).p
		assert.equal(p.h, 364)
		const after = structuredClone(old)
		after.h = p.h
		delete after.data.cgroups
		delete after.data.cols[C1].g
		for (const [k, v] of Object.entries(p)) {
			const m2 = /^data\.lanes\.(l[0-9a-z]{8})\.h$/.exec(k)
			if (m2) after.data.lanes[m2[1]].h = v
		}
		const before = laneBands(old)
		const now = laneBands(after)
		const moved = r.ops.find((o) => o.id === kid.id)
		const dy = moved ? moved.p.y - kid.y : 0
		// every border between lanes moved up by what the children moved: the kid stays in its lane
		assert.deepEqual(now.slice(1).map((b) => b.y), before.slice(1).map((b) => b.y + dy))
	})
})
