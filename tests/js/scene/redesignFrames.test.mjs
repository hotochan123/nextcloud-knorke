/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 262 (design round 4 R4): frames with a border in the strong
 * tone of their fill and corners of 8, the selection outline round frame and
 * tab, round handles, the big "+" buttons.
 * - AK1 frameStroke, mixColor
 * - AK3 FRAME_RADIUS 8 in traceFrame / traceTabTop / the title hint
 * - AK4 frameOutline: 4 px outside, the tab 8 wider, radius 12 at 100 %
 * - AK5 the tint of the tab (frame.setTint), the title keeps its colour
 * - AK6 handleLook of the handles and the "+" buttons, drawStructPlus
 * - AK7 the "+" of a table and of lanes 36 screen px outside, the mouse hits
 *   a 24-px button within 12 px of its centre
 * (AK2 and AK8 with the real Konva in redesignFramesRender.test.mjs)
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, setupScene } from './sceneHarness.mjs'
import {
	FRAME_FILLS, FRAME_RADIUS, FRAME_SELECTED_TAB_MIX, FRAME_TITLE_BAND, PALETTE, SELECTION_COLOR, STRUCT_PLUS_OFFSET_PX, STRUCT_PLUS_PX,
	frameStroke, frameTabFill, mixColor, nearestColor, LIGHT, shownColor,
} from '../../../src/model/tokens.js'
import { frameOutline, traceFrame, traceTabTop } from '../../../src/scene/nodes/frame.js'
import { drawStructPlus, onStructPlus, structPlusSize } from '../../../src/scene/nodes/plusButton.js'
import { handleLook } from '../../../src/scene/KonvaRenderer.js'
import { plusOffset } from '../../../src/scene/ConnectController.js'

/** A 2D context that records arc radii and lines. */
function recorder() {
	const ops = []
	const c = { ops, attrs: {} }
	for (const op of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillText']) c[op] = (...a) => ops.push([op, ...a])
	c.arc = (x, y, r, a0, a1) => ops.push(['arc', x, y, r, a0, a1])
	c.setAttr = (k, v) => {
		c.attrs[k] = v
		ops.push(['set', k, v])
	}
	return c
}

describe('AK1 the border in the strong tone of the fill', () => {
	test('white and gray #6f6f6d, black #191b1d, yellow #7e6f01, light blue #0275a9', () => {
		assert.equal(frameStroke('#ffffff'), '#6f6f6d')
		assert.equal(frameStroke('#e0e0dd'), '#6f6f6d')
		assert.equal(frameStroke('#191b1d'), '#191b1d')
		assert.equal(frameStroke('#faea89'), '#7e6f01')
		assert.equal(frameStroke('#a2d9fe'), '#0275a9')
		for (const e of PALETTE) assert.equal(frameStroke(e.light), e.key === 'weiss' || e.key === 'grau' ? '#6f6f6d' : e.strong, e.key)
	})

	test('an old frame colour: the tone of its shown colour; a custom one: of the nearest palette colour; nonsense: gray', () => {
		for (const old of FRAME_FILLS) {
			const e = PALETTE[LIGHT.indexOf(nearestColor(shownColor(old), LIGHT))]
			assert.equal(frameStroke(old), e.key === 'weiss' ? '#6f6f6d' : e.strong, old)
		}
		assert.equal(frameStroke('#ff8800'), PALETTE[LIGHT.indexOf(nearestColor('#ff8800', LIGHT))].strong)
		for (const bad of [null, undefined, '', 'red', 42]) assert.equal(frameStroke(bad), '#6f6f6d', String(bad))
	})

	test('mixColor: channel by channel', () => {
		assert.equal(mixColor('#000000', '#ffffff', 0.5), '#808080')
		assert.equal(mixColor('#0082c9', '#d1d1ce', 0), '#d1d1ce')
		assert.equal(mixColor('#0082c9', '#d1d1ce', 1), '#0082c9')
		assert.equal(mixColor('nope', '#d1d1ce', 0.5), '#d1d1ce')
	})
})

describe('AK3 corners of 8', () => {
	test('FRAME_RADIUS 8: the four corners of a 300 × 200 frame and the two of its tab', () => {
		assert.equal(FRAME_RADIUS, 8)
		const c = recorder()
		traceFrame(c, 300, 200, 100)
		const radii = c.ops.filter((o) => o[0] === 'arc').map((o) => o[3])
		assert.deepEqual(radii, [8, 8, 8, 8, 8], 'two tab corners, three frame corners')
		const r = recorder()
		traceFrame(r, 300, 200, 0)
		assert.deepEqual(r.ops.filter((o) => o[0] === 'arc').map((o) => o[3]), [8, 8, 8, 8])
		const t = recorder()
		traceTabTop(t, 100, FRAME_RADIUS)
		assert.deepEqual(t.ops.filter((o) => o[0] === 'arc').map((o) => o[3]), [8, 8], 'also the dashed hint tab')
	})
})

describe('AK4 the selection outline round frame and tab', () => {
	test('zoom 1: 4 px outside, the tab 8 wider, radius 12; traced, it reaches 4 above the tab', () => {
		const o = frameOutline({ w: 300, h: 200 }, 100, 1)
		assert.deepEqual(o, { w: 308, h: 208, tabW: 108, r: 12 })
		const c = recorder()
		traceFrame(c, o.w, o.h, o.tabW, o.r)
		const ys = c.ops.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo').map((x) => x[2])
		// the node sits 4 above the frame's top edge: the outline's top is 4 above the tab's top
		assert.equal(Math.min(...ys), -FRAME_TITLE_BAND + 12 - 12, 'the tab top (the line between its corners)')
		assert.deepEqual(c.ops.filter((x) => x[0] === 'arc').map((x) => x[3]), [12, 12, 12, 12, 12])
	})

	test('zoom 2: 4 screen px = 2 world units, radius 8 + 2; no title: no tab', () => {
		assert.deepEqual(frameOutline({ w: 300, h: 200 }, 0, 2), { w: 304, h: 204, tabW: 0, r: 10 })
	})
})

describe('AK6 the look of the handles and the "+" buttons', () => {
	test('corners, sides and rot: white circles 12 px (pen, finger 16) in the selection colour', () => {
		for (const name of ['tl', 'tr', 'br', 'bl', 'l', 'r', 'rot']) {
			const m = handleLook(name, false, '#123456')
			assert.deepEqual([m.size, m.w, m.round, m.fill, m.stroke, m.plus], [12, 12, true, '#ffffff', '#123456', false], name)
			assert.equal(handleLook(name, true).size, 16, name)
		}
	})

	test('the connection points and connector ends keep their sizes', () => {
		assert.deepEqual([handleLook('plus-t').size, handleLook('plus-t', true).size], [10, 14])
		assert.deepEqual([handleLook('start').size, handleLook('end', true).size], [12, 14])
		assert.equal(handleLook('plus-t').fill, '#ffffff')
	})

	test('table, column, mind map: 24 px filled in the selection colour, white ring and plus; "+ Lane" a pill with its word', () => {
		for (const name of ['table-col', 'table-row', 'col-add', 'mm-child', 'mm-sibling', 'mm-child-r', 'mm-child-l']) {
			const m = handleLook(name, false, '#123456')
			assert.deepEqual([m.size, m.w, m.fill, m.stroke, m.plus, m.label], [STRUCT_PLUS_PX, 24, '#123456', '#ffffff', true, ''], name)
		}
		const lane = handleLook('lane-add', false, '#123456')
		assert.deepEqual([lane.size, lane.label, lane.fill, lane.plus], [24, '+ Lane', '#123456', true])
		assert.ok(lane.w >= 24 + 20, 'the word with 10 on both sides')
	})

	test('drawStructPlus: the round button and its white plus; the pill and its word', () => {
		const c = recorder()
		drawStructPlus(c, { w: 12, h: 12, px: 0.5, fill: '#123456', ring: '#ffffff', label: '' })
		assert.ok(c.ops.some((o) => o[0] === 'set' && o[1] === 'fillStyle' && o[2] === '#123456'))
		assert.ok(c.ops.some((o) => o[0] === 'set' && o[1] === 'lineWidth' && o[2] === 1), '2 screen px at px 0.5')
		const lines = c.ops.filter((o) => o[0] === 'moveTo' || o[0] === 'lineTo').slice(-4)
		assert.deepEqual(lines, [['moveTo', 3.5, 6], ['lineTo', 8.5, 6], ['moveTo', 6, 3.5], ['lineTo', 6, 8.5]], 'bars of 10 screen px')
		const p = recorder()
		drawStructPlus(p, { w: 62, h: 24, px: 1, fill: '#123456', ring: '#ffffff', label: '+ Lane' })
		assert.deepEqual(p.ops.find((o) => o[0] === 'fillText'), ['fillText', '+ Lane', 31, 12])
		assert.ok(p.ops.some((o) => o[0] === 'set' && o[1] === 'font' && /^bold 12px /.test(o[2])))
	})

	test('onStructPlus: within 12 px of a round button; a pill over its rectangle + 2', () => {
		assert.equal(onStructPlus('table-col', 10, 0), true)
		assert.equal(onStructPlus('table-col', 14, 0), false)
		const w = structPlusSize('lane-add').w
		assert.equal(onStructPlus('lane-add', w / 2 + 1, 13), true)
		assert.equal(onStructPlus('lane-add', w / 2 + 3, 0), false)
	})
})

const T = '01JA00000000000000000000T1'
const F = '01JA00000000000000000000F1'
const C = ['c00000001', 'c00000002']
const R = ['r00000001', 'r00000002']
const table = () => ({
	id: T, t: 'table', x: 100, y: 100, w: 320, h: 72, r: 0, z: 'a5', parent: null,
	data: { cols: Object.fromEntries(C.map((k, i) => [k, { o: 'i' + i, w: 160 }])), rows: Object.fromEntries(R.map((k, i) => [k, { o: 'i' + i }])), cells: {} },
	style: {},
})
const lanes = () => ({
	id: F, t: 'frame', x: 100, y: 100, w: 600, h: 300, r: 0, z: 'a0', parent: null,
	data: { title: 'Prozess', lanes: { l00000001: { o: 'i0', h: 150, t: 'A' }, l00000002: { o: 'i1', h: 150, t: 'B' } } },
	style: { fill: '#ffffff' },
})

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

describe('AK7 the "+" of tables and lanes', () => {
	test('plusOffset: 36 screen px at every zoom', () => {
		assert.equal(STRUCT_PLUS_OFFSET_PX, 36)
		assert.equal(plusOffset(1), 36)
		assert.equal(plusOffset(2), 18)
	})

	for (const scale of [1, 2]) {
		test(`zoom ${scale}: table-col 36 screen px right of the table, lane-add 36 below the frame`, () => {
			h = setupScene([table(), lanes()])
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.scene.setSelection([T])
			h.frame()
			// handles() in container px (camera at the origin)
			const col = h.scene.handles().find((x) => x.name === 'table-col')
			assert.deepEqual([col.x, col.y], [420 * scale + 36, 136 * scale])
			h.scene.setSelection([F])
			h.frame()
			const add = h.scene.handles().find((x) => x.name === 'lane-add')
			assert.deepEqual([add.x, add.y], [400 * scale, 400 * scale + 36])
		})
	}

	test('a mouse click 10 px beside the centre of table-col hits it, 14 px beside it does not', () => {
		h = setupScene([table()])
		h.scene.setSelection([T])
		h.frame()
		const col = h.scene.handles().find((x) => x.name === 'table-col')
		h.pointer('pointerdown', col.x, col.y + 10)
		h.pointer('pointerup', col.x, col.y + 10)
		assert.deepEqual(h.intents('tableAppend'), [{ type: 'tableAppend', id: T, axis: 'col' }])
		h.scene.setSelection([T])
		h.frame()
		h.pointer('pointerdown', col.x, col.y + 14)
		h.pointer('pointerup', col.x, col.y + 14)
		assert.equal(h.intents('tableAppend').length, 1, 'no second column')
	})

	test('the renderer gets the "+" buttons of a selected table', () => {
		h = setupScene([table()])
		h.scene.setSelection([T])
		h.frame()
		const drawn = callsOf('setHandles').at(-1)[0].handles.map((x) => x.name)
		assert.ok(drawn.includes('table-col') && drawn.includes('table-row'))
	})
})

describe('AK5 the tab tint', () => {
	test('22 % of the selection colour over the tab tone', () => {
		assert.equal(FRAME_SELECTED_TAB_MIX, 0.22)
		const tab = frameTabFill('#ffffff')
		assert.equal(tab, '#d1d1ce')
		assert.equal(mixColor(SELECTION_COLOR, tab, 0.22), '#a3c0cd')
	})
})
