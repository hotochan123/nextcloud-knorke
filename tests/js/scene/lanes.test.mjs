/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 199 (AK4): swimlanes in the scene, on the real SceneManager,
 * InputController, TextEditor and TransformController with the recording
 * renderer stub (sceneHarness.mjs):
 * - stats().lanes; the frame node (fake Konva) with the head, the lines and
 *   the names, the name of the open editor hidden
 * - the head hits the frame (a click selects it; job 208: a drag moves the
 *   lane, the title band the frame); the inside of a lane is empty canvas
 * - a lane border: the cursor row-resize only at the one selected,
 *   unlocked frame; a drag previews the frame and the children below, ONE
 *   intent laneHeight at the release, none with Esc
 * - the handle lane-add only at the one selected, unlocked frame with lanes
 * - a double click on a head opens the editor kind lane (no lease: the
 *   frame stays free); the menu intent carries the lane under W, also from
 *   a finger held on a head of the selected frame
 * - the transformer: the top and bottom handles keep the changed lane at
 *   LANE_MIN_H, the frame at least 220 wide; the frame tool's option lanes
 *   gives the create intent with lanes, and every tool change puts it back
 * - (round 1) the handle lane-add looks like every other "+" (a round, filled
 *   dot), not like the square resize handle b above it
 *
 * Factory job 208 (AK4): the columns in the scene: stats().lanes with head,
 * top and cols; the node with the head row, the lines and the names; the
 * head row hits the frame; a dragged head of a lane or a column (ghost,
 * stats().headDrag, laneMove/colMove at the release, none with Esc; a
 * finger at a frame not selected before moves the frame; the corner moves
 * the frame); a column edge (col-resize, live preview, ONE colWidth, none
 * with Esc); col-add; the editor of a column's name; the menu intent's col;
 * the transformer's least width; no head for a single lane without a name.
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, rcalls, setupScene } from './sceneHarness.mjs'
import { dispatch } from './fakeDom.mjs'
import { frame as frameSpec } from '../../../src/scene/nodes/frame.js'
import { TABLE_BORDER_PX } from '../../../src/scene/SceneManager.js'
import { handleLook } from '../../../src/scene/KonvaRenderer.js'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { laneTones } from '../../../src/model/tokens.js'
import { nameFontSize } from '../../../src/model/lanes.js'

const F = '01JA00000000000000000000F1'
const A = '01JA00000000000000000000N1'
const B = '01JA00000000000000000000N2'
const L1 = 'l00000001'
const L2 = 'l00000002'
const L3 = 'l00000003'

/** A frame 600 × 300 at (100, 100) with three lanes of 100 (head 48 wide). */
function frameItem(o = {}) {
	return {
		id: F, t: 'frame', x: 100, y: 100, w: 600, h: 300, r: 0, z: 'a0', parent: null,
		data: { title: 'Prozess', lanes: { [L1]: { o: 'i0', h: 100, t: 'Sales' }, [L2]: { o: 'i1', h: 100, t: 'Support' }, [L3]: { o: 'i2', h: 100 } } },
		style: { fill: '#ffffff' },
		...o,
	}
}

/** Notes in lane 2 and lane 3 (relative to the frame). */
const kids = () => [
	{ id: A, t: 'sticky', x: 300, y: 120, w: 50, h: 50, r: 0, z: 'i1', parent: F, data: { text: 'a' }, style: {} },
	{ id: B, t: 'sticky', x: 300, y: 220, w: 50, h: 50, r: 0, z: 'i2', parent: F, data: { text: 'b' }, style: {} },
]

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

function setup(items = [frameItem(), ...kids()], opts = {}) {
	h = setupScene(items, opts)
	h.frame()
	return h
}

/** Selects the frame with a click on its head. */
function selectFrame() {
	h.pointer('pointerdown', 120, 150)
	h.pointer('pointerup', 120, 150)
	h.frame()
	assert.deepEqual(h.scene.getSelection(), [F])
}

const cursor = () => h.scene.renderer.contentEl.style.cursor
const handleNames = () => h.scene.handles().map((x) => x.name)
const editor = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null

describe('job 199 AK4: stats().lanes and the node', () => {
	test('stats().lanes: every frame with lanes, its bands relative to the frame; a plain frame none', () => {
		setup([frameItem(), { ...frameItem(), id: '01JA00000000000000000000F2', x: 2000, data: { title: '' } }])
		// (job 225) gw, cg, g, groups and cgroups too
		assert.deepEqual(h.scene.stats().lanes, [{ id: F, head: 48, top: 0, gw: 0, cg: 0, lanes: [
			{ key: L1, y: 0, h: 100, title: 'Sales', g: null, fs: 16 }, { key: L2, y: 100, h: 100, title: 'Support', g: null, fs: 16 },
			{ key: L3, y: 200, h: 100, title: '', g: null, fs: 16 },
		], cols: [], groups: [], cgroups: [] }])
	})

	test('node: the head in the tab tone (job 264), a line between lanes, the names; the open editor\'s name hidden; a plain frame without', () => {
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
		const e = frameSpec.build(ctx, frameItem(), { x: 100, y: 100, w: 600, h: 300, r: 0 }, 0, false)
		const head = e.parts.lanes.kids[0]
		assert.deepEqual([head.attrs.fill, head.attrs.width, head.attrs.height], [laneTones('#ffffff').head, 48, 300])
		const lines = []
		e.parts.lanes.kids[1].attrs.sceneFunc({ beginPath() {}, moveTo: (x, y) => lines.push(['m', x, y]), lineTo: (x, y) => lines.push(['l', x, y]), strokeShape() {} })
		// (job 264) none along the head
		assert.deepEqual(lines, [['m', 0, 100], ['l', 600, 100], ['m', 0, 200], ['l', 600, 200]])
		const names = [...e.parts.laneTitles.values()]
		// (job 234) turned by -90° about the bottom left corner of its cell: as long as the lane, as high as the head, one line
		assert.deepEqual(names.map((t) => [t.attrs.text, t.attrs.x, t.attrs.y, t.attrs.width, t.attrs.height, t.attrs.rotation, t.attrs.fontStyle,
			t.attrs.wrap, t.attrs.align, t.attrs.fontSize]), [
			['Sales', 0, 100, 100, 48, -90, 'bold', 'none', 'center', 16], ['Support', 0, 200, 100, 48, -90, 'bold', 'none', 'center', 16],
			['', 0, 300, 100, 48, -90, 'bold', 'none', 'center', 16],
		])
		frameSpec.setTextHidden(e, L2)
		assert.deepEqual(names.map((t) => t.attrs.visible), [true, false, true])
		assert.equal(e.parts.text.attrs.visible, true, 'the frame\'s title stays')
		assert.equal(frameSpec.update(ctx, e, frameItem(), { x: 100, y: 100, w: 600, h: 300 }, new Set(['data'])), true, 'a change of the lanes builds anew')
		const plain = frameSpec.build(ctx, frameItem({ data: { title: 'x' } }), { x: 0, y: 0, w: 600, h: 300, r: 0 }, 0, false)
		assert.equal(plain.parts.lanes, undefined)
	})
})

describe('job 199 AK4: the head, the borders and the "+"', () => {
	test('the head hits the frame: a click selects it, a drag moves the lane (job 208), the title the frame; the inside of a lane is empty canvas', () => {
		setup()
		h.pointer('pointerdown', 500, 350)
		h.pointer('pointerup', 500, 350)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [], 'inside a lane: nothing')
		h.pointer('pointerdown', 120, 250)
		h.pointer('pointerup', 120, 250)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [F], 'a click on the head selects the frame')
		h.pointer('pointerdown', 120, 250)
		h.pointer('pointermove', 180, 280)
		h.pointer('pointermove', 210, 310)
		h.pointer('pointerup', 210, 310)
		assert.deepEqual(h.intents('move'), [], 'job 208: the head no longer moves the frame')
		assert.deepEqual(h.intents('laneMove'), [{ type: 'laneMove', id: F, lane: L2, to: 2 }])
		h.pointer('pointerdown', 250, 90)
		h.pointer('pointermove', 280, 120)
		h.pointer('pointermove', 310, 150)
		h.pointer('pointerup', 310, 150)
		const [m] = h.intents('move')
		assert.ok(m && m.ids.includes(F), 'the frame is dragged by its title')
		assert.deepEqual([m.dx, m.dy], [60, 60])
	})

	test('a lane border: row-resize at the selected frame; drag: frame and children below live; release: ONE laneHeight; Esc: none', () => {
		setup()
		h.pointer('pointermove', 300, 200, { buttons: 0 })
		assert.notEqual(cursor(), 'row-resize', 'not selected: no border')
		selectFrame()
		h.pointer('pointermove', 300, 200 + TABLE_BORDER_PX - 1, { buttons: 0 })
		assert.equal(cursor(), 'row-resize')
		h.pointer('pointermove', 300, 200 + TABLE_BORDER_PX + 3, { buttons: 0 })
		assert.notEqual(cursor(), 'row-resize')
		h.pointer('pointermove', 300, 400, { buttons: 0 })
		assert.equal(cursor(), 'row-resize', 'the frame\'s bottom edge is the last lane\'s border')
		// the border below lane 1 by +60
		h.pointer('pointerdown', 300, 200)
		h.pointer('pointermove', 300, 230)
		h.pointer('pointermove', 300, 260)
		h.frame()
		assert.deepEqual(h.scene.stats().lanes[0].lanes.map((l) => l.h), [160, 100, 100], 'live in the scene')
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, { id: F, key: L1, h: 160, lane: true }], 'and in the renderer')
		const previews = callsOf('setPreviews').at(-1)[0]
		assert.deepEqual([previews.get(A), previews.get(B)], [{ x: 400, y: 280 }, { x: 400, y: 380 }], 'the children below follow')
		assert.deepEqual(h.intents('laneHeight'), [])
		h.pointer('pointerup', 300, 260)
		assert.deepEqual(h.intents('laneHeight'), [{ type: 'laneHeight', id: F, lane: L1, h: 160 }], 'one intent')
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, null], 'the preview ends')
		assert.equal(callsOf('setPreviews').at(-1)[0].size, 0)
		// Esc: no intent, the height springs back
		h.pointer('pointerdown', 300, 300)
		h.pointer('pointermove', 300, 340)
		h.frame()
		assert.equal(h.scene.stats().lanes[0].lanes[1].h, 140)
		h.key('Escape')
		h.pointer('pointerup', 300, 340)
		assert.equal(h.intents('laneHeight').length, 1)
		assert.deepEqual(h.scene.stats().lanes[0].lanes.map((l) => l.h), [100, 100, 100])
		// at least LANE_MIN_H
		h.pointer('pointerdown', 300, 200)
		h.pointer('pointermove', 300, 120)
		h.pointer('pointerup', 300, 120)
		assert.equal(h.intents('laneHeight').at(-1).h, 60)
	})

	test('a locked frame has no border, no "+"; lane-add only at the one selected frame with lanes; a click asks for a lane', () => {
		setup([frameItem({ lock: { by: 'x', name: 'X' } })])
		h.scene.setSelection([F])
		h.frame()
		assert.ok(!handleNames().includes('lane-add'))
		h.pointer('pointermove', 300, 200, { buttons: 0 })
		assert.notEqual(cursor(), 'row-resize')
		h.restore()
		setup([frameItem({ data: { title: 'plain' } })])
		h.scene.setSelection([F])
		h.frame()
		assert.ok(!handleNames().includes('lane-add'), 'a plain frame')
		h.restore()
		setup()
		selectFrame()
		const add = h.scene.handles().find((x) => x.name === 'lane-add')
		assert.ok(add && Math.abs(add.x - 400) < 0.01 && add.y > 400, 'bottom middle, below the frame')
		h.pointer('pointerdown', add.x, add.y)
		h.pointer('pointerup', add.x, add.y)
		assert.deepEqual(h.intents('laneAdd'), [{ type: 'laneAdd', id: F }])
	})

	test('round 1: lane-add is drawn like the other "+" buttons (round, filled), not like the square resize handle br (job 231: nor like a hollow connection point)', () => {
		const plus = handleLook('lane-add')
		// job 262: a pill with its word, otherwise like the other "+" buttons
		assert.deepEqual({ ...plus, w: 24, label: '' }, handleLook('table-row'))
		assert.deepEqual(handleLook('table-row'), handleLook('mm-child'))
		assert.equal(plus.label, '+ Lane')
		assert.ok(plus.w > plus.size)
		assert.equal(plus.round, true)
		assert.equal(plus.fill, handleLook('plus-b').stroke, 'filled in the selection color')
		assert.notDeepEqual(plus, handleLook('plus-b'))
		assert.notDeepEqual(plus, handleLook('br'))
		assert.equal(handleLook('br').plus, false)
	})
})

describe('job 199 AK4: the name editor and the menu', () => {
	test('a double click on a head opens the editor kind lane over it; no lease; its text intent carries the lane', () => {
		setup()
		const p = { clientX: 120, clientY: 250, pointerType: 'mouse', pointerId: 1 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		const ta = editor()
		assert.ok(ta)
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'lane')
		assert.equal(ta.getAttribute('data-knorke-lane'), L2)
		assert.equal(ta.value, 'Support')
		assert.match(ta.style.getPropertyValue('transform'), /translate\(74px, 226px\) rotate\(-90deg\)/, 'job 234: turned by -90° over the head of lane 2')
		assert.equal(ta.style.getPropertyValue('width'), '100px')
		assert.equal(h.scene.isActive(F), false, 'the frame stays free')
		assert.deepEqual(callsOf('setTextHidden').at(-1), [F, true, L2])
		ta.value = 'Service'
		dispatch(ta, 'input')
		dispatch(ta, 'keydown', { key: 'Enter' })
		const t = h.intents('text').at(-1)
		assert.deepEqual([t.id, t.cell, t.path, t.value, t.final], [F, L2, `data.lanes.${L2}.t`, 'Service', true])
		assert.equal(editor(), null, 'Enter ends it')
		// a double click inside a lane opens nothing, one on the title band the title
		dispatch(h.container, 'dblclick', { clientX: 500, clientY: 250, pointerType: 'mouse', pointerId: 1 })
		assert.equal(editor(), null)
		assert.equal(h.scene.openTextEditor(F, { cell: 'l99999999' }), false, 'no such lane')
	})

	test('the menu intent carries the lane under W; Shift+F10 the lane under the selection\'s middle', () => {
		setup()
		h.pointer('pointerdown', 120, 350, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 120, clientY: 350, button: 2, pointerId: 1, pointerType: 'mouse' })
		h.pointer('pointerup', 120, 350, { button: 2 })
		assert.deepEqual(h.intents('contextMenu')[0], { type: 'contextMenu', id: F, at: [120, 350], cell: L3 })
		h.focusCanvas()
		h.key('F10', { shiftKey: true })
		const k = h.intents('contextMenu').at(-1)
		assert.equal(k.cell, L2, 'the middle (400, 250) lies in lane 2')
	})
})

describe('job 199 AK4: a finger held on a head of the selected frame', () => {
	test('held LONG_PRESS_MS: the menu intent with that lane; inside a lane nothing', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			setup()
			selectFrame()
			const touch = (type, x, y, id = 7) => h.pointer(type, x, y, { pointerType: 'touch', pointerId: id })
			touch('pointerdown', 120, 350)
			mock.timers.tick(LONG_PRESS_MS)
			assert.deepEqual(h.intents('contextMenu'), [{ type: 'contextMenu', id: F, at: [120, 350], cell: L3 }])
			touch('pointerup', 120, 350)
			touch('pointerdown', 120, 100 - 10, 8)
			mock.timers.tick(LONG_PRESS_MS)
			touch('pointerup', 120, 90, 8)
			assert.equal(h.intents('contextMenu').length, 1, 'the title band: no lane menu')
		} finally {
			mock.timers.reset()
		}
	})
})

describe('job 199 AK4: the transformer and the tool', () => {
	test('the bottom and top handles keep the changed lane at LANE_MIN_H; at least 220 wide; the lanes follow live', () => {
		setup()
		selectFrame()
		// (job 231) only corners: br moved straight down changes the bottom edge alone
		const b = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', b.x, b.y)
		h.pointer('pointermove', b.x, b.y + 50)
		h.frame()
		assert.deepEqual(h.scene.stats().lanes[0].lanes.map((l) => l.h), [100, 100, 150], 'live: the last lane takes it')
		h.pointer('pointermove', b.x, b.y - 500)
		h.pointer('pointerup', b.x, b.y - 500)
		assert.equal(h.intents('transform').at(-1).after.get(F).h, 260, 'the last lane keeps 60')
		h.model.apply({ upserts: [frameItem()] })
		h.frame()
		const t = h.scene.handles().find((x) => x.name === 'tr')
		h.pointer('pointerdown', t.x, t.y)
		h.pointer('pointermove', t.x, t.y - 40)
		h.frame()
		assert.deepEqual(h.scene.stats().lanes[0].lanes.map((l) => l.h), [140, 100, 100], 'live: the first lane takes it')
		h.pointer('pointerup', t.x, t.y - 40)
		const r = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', r.x, r.y)
		h.pointer('pointermove', r.x - 2000, r.y)
		h.pointer('pointerup', r.x - 2000, r.y)
		assert.equal(h.intents('transform').at(-1).after.get(F).w, 220)
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, null], 'the preview ends with the transform')
	})

	test('the frame tool with frameKind lanes creates with lanes: true; a tool change puts it back to frame', () => {
		setup([])
		h.scene.setTool('frame', { frameKind: 'lanes' })
		assert.deepEqual(h.scene.getToolOptions('frame'), { frameKind: 'lanes' })
		h.pointer('pointerdown', 100, 100)
		h.pointer('pointermove', 300, 250)
		h.pointer('pointermove', 500, 400)
		h.pointer('pointerup', 500, 400)
		const c = h.intents('create').at(-1)
		assert.deepEqual([c.t, c.lanes, c.rect], ['frame', true, { x: 100, y: 100, w: 400, h: 300 }])
		assert.deepEqual(h.scene.getToolOptions('frame'), { frameKind: 'frame' }, 'back to select: back to frame')
		h.scene.setTool('frame', { frameKind: 'lanes' })
		h.scene.setTool('sticky')
		h.scene.setTool('frame')
		h.pointer('pointerdown', 100, 600)
		h.pointer('pointerup', 100, 600)
		assert.equal(h.intents('create').at(-1).lanes, undefined, 'a plain frame again')
		assert.ok(rcalls.length > 0)
	})
})

// ---- Job 208: columns ------------------------------------------------------

const C1 = 'c00000001'
const C2 = 'c00000002'

/** The frame 600 × 356 at (100, 100): the head row (56, job 264: before 60), three lanes of 100, columns of 312 and 240 right of the head (job 234: 48 wide). */
function gridItem(o = {}) {
	const f = frameItem({ h: 356 })
	f.data.cols = { [C1]: { o: 'i0', w: 200, t: 'Phase 1' }, [C2]: { o: 'i1', w: 240 } }
	return { ...f, ...o }
}

/** A in lane 2 and column 1, B in lane 3 and column 2 (relative to the frame). */
const gridKids = () => [
	{ id: A, t: 'sticky', x: 180, y: 170, w: 50, h: 50, r: 0, z: 'i1', parent: F, data: { text: 'a' }, style: {} },
	{ id: B, t: 'sticky', x: 400, y: 270, w: 50, h: 50, r: 0, z: 'i2', parent: F, data: { text: 'b' }, style: {} },
]

const gridSetup = (items = [gridItem(), ...gridKids()]) => setup(items)

describe('job 208 AK4: the grid in the scene', () => {
	test('stats().lanes with head, top and cols; the node: the head row, the lines, the names; no head for a single lane without a name', () => {
		gridSetup()
		assert.deepEqual(h.scene.stats().lanes, [{ id: F, head: 48, top: 56, gw: 0, cg: 0, lanes: [
			{ key: L1, y: 56, h: 100, title: 'Sales', g: null, fs: 16 }, { key: L2, y: 156, h: 100, title: 'Support', g: null, fs: 16 },
			{ key: L3, y: 256, h: 100, title: '', g: null, fs: 16 },
		], cols: [{ key: C1, x: 48, w: 312, title: 'Phase 1', g: null }, { key: C2, x: 360, w: 240, title: '', g: null }], groups: [], cgroups: [] }])
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
		const e = frameSpec.build(ctx, gridItem(), { x: 100, y: 100, w: 600, h: 356, r: 0 }, 0, false)
		const [head, row, shape, cshape] = e.parts.lanes.kids
		// (job 264) the head row 56 high in the tab tone; dividers only between lanes and between columns
		assert.deepEqual([head.attrs.x, head.attrs.width, head.attrs.height, row.attrs.x, row.attrs.width, row.attrs.height, row.attrs.fill],
			[0, 48, 356, 48, 552, 56, laneTones('#ffffff').head])
		const lines = []
		const rec = { beginPath() {}, moveTo: (x, y) => lines.push(['m', x, y]), lineTo: (x, y) => lines.push(['l', x, y]), strokeShape() {} }
		shape.attrs.sceneFunc(rec)
		cshape.attrs.sceneFunc(rec)
		assert.deepEqual(lines, [['m', 0, 156], ['l', 600, 156], ['m', 0, 256], ['l', 600, 256], ['m', 360, 0], ['l', 360, 356]])
		assert.deepEqual([shape.attrs.opacity, cshape.attrs.opacity], [1, 0.7])
		const names = e.parts.laneTitles
		assert.deepEqual([names.get(C1).attrs.text, names.get(C1).attrs.x, names.get(C1).attrs.width, names.get(C1).attrs.height, names.get(C1).attrs.align],
			['Phase 1', 48, 312, 56, 'left'])
		frameSpec.setTextHidden(e, C1)
		assert.deepEqual([names.get(C1).attrs.visible, names.get(C2).attrs.visible, names.get(L1).attrs.visible], [false, true, true])
		const solo = gridItem({ data: { title: '', lanes: { [L1]: { o: 'i0', h: 300 } }, cols: { [C1]: { o: 'i0', w: 300 }, [C2]: { o: 'i1', w: 300 } } } })
		const s = frameSpec.build(ctx, solo, { x: 0, y: 0, w: 600, h: 360, r: 0 }, 0, false)
		assert.equal(s.parts.lanes.kids[0].attrs.x, 0, 'no head column: the first rect is the head row from the left edge')
		assert.equal(s.parts.lanes.kids[0].attrs.width, 600)
		assert.deepEqual([...s.parts.laneTitles.keys()], [C1, C2], 'no lane name drawn')
	})

	test('the head row hits the frame; the inside of a cell is empty canvas; a single lane without a name has no head to hit', () => {
		gridSetup()
		h.pointer('pointerdown', 600, 200)
		h.pointer('pointerup', 600, 200)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [])
		h.pointer('pointerdown', 300, 130)
		h.pointer('pointerup', 300, 130)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [F], 'the head of column 1')
		h.restore()
		setup([gridItem({ data: { title: '', lanes: { [L1]: { o: 'i0', h: 300 } }, cols: { [C1]: { o: 'i0', w: 300 }, [C2]: { o: 'i1', w: 300 } } } })])
		h.pointer('pointerdown', 120, 300)
		h.pointer('pointerup', 120, 300)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [], 'where the head would be: a cell')
		h.pointer('pointerdown', 120, 130)
		h.pointer('pointerup', 120, 130)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [F], 'the head of column 1 from the left edge')
	})
})

describe('job 208 AK4: dragging a head', () => {
	test('the head of a lane: ghost and bar, stats().headDrag, laneMove at the release; Esc none', () => {
		gridSetup()
		h.pointer('pointerdown', 120, 210)
		h.pointer('pointermove', 120, 300)
		h.pointer('pointermove', 120, 400)
		h.frame()
		assert.deepEqual(h.scene.stats().headDrag, { id: F, key: L1, to: 2 })
		const prev = callsOf('setNodeDragPreview').at(-1)[0]
		assert.deepEqual(prev.ghost, { x: 100, y: 346, w: 600, h: 100 }, 'the band follows in y')
		assert.deepEqual(prev.target, { x: 100, y: 356, w: 600, h: 100, where: 'after', beside: false })
		h.pointer('pointerup', 120, 400)
		assert.deepEqual(h.intents('laneMove'), [{ type: 'laneMove', id: F, lane: L1, to: 2 }])
		assert.deepEqual(h.intents('move'), [], 'the frame stays')
		assert.deepEqual(callsOf('setNodeDragPreview').at(-1), [null])
		assert.equal(h.scene.stats().headDrag, null)
		h.pointer('pointerdown', 120, 410)
		h.pointer('pointermove', 120, 300)
		h.pointer('pointermove', 120, 200)
		h.key('Escape')
		h.pointer('pointerup', 120, 200)
		assert.equal(h.intents('laneMove').length, 1, 'Esc: no intent')
		assert.deepEqual(callsOf('setNodeDragPreview').at(-1), [null])
		// back on its own band: no intent
		h.pointer('pointerdown', 120, 210)
		h.pointer('pointermove', 120, 230)
		h.pointer('pointermove', 120, 250)
		h.pointer('pointerup', 120, 250)
		assert.equal(h.intents('laneMove').length, 1)
	})

	test('the head of a column: the band follows in x, colMove at the release; the corner moves the frame', () => {
		gridSetup()
		h.pointer('pointerdown', 300, 130)
		h.pointer('pointermove', 400, 130)
		h.pointer('pointermove', 600, 130)
		h.frame()
		assert.deepEqual(h.scene.stats().headDrag, { id: F, key: C1, to: 1 })
		const prev = callsOf('setNodeDragPreview').at(-1)[0]
		assert.deepEqual(prev.ghost, { x: 448, y: 100, w: 312, h: 356 })
		assert.deepEqual(prev.target, { x: 460, y: 100, w: 240, h: 356, where: 'after', beside: true })
		h.pointer('pointerup', 600, 130)
		assert.deepEqual(h.intents('colMove'), [{ type: 'colMove', id: F, col: C1, to: 1 }])
		h.pointer('pointerdown', 120, 130)
		h.pointer('pointermove', 180, 160)
		h.pointer('pointermove', 210, 190)
		h.pointer('pointerup', 210, 190)
		const [m] = h.intents('move')
		assert.ok(m && m.ids.includes(F), 'the corner drags the frame')
		assert.equal(h.intents('colMove').length + h.intents('laneMove').length, 1)
	})

	test('a finger: at a frame not selected before the press it moves the frame; at the selected one the lane', () => {
		gridSetup()
		const touch = (type, x, y, id = 7) => h.pointer(type, x, y, { pointerType: 'touch', pointerId: id })
		touch('pointerdown', 120, 210)
		touch('pointermove', 120, 260)
		touch('pointermove', 120, 320)
		touch('pointerup', 120, 320)
		assert.deepEqual(h.intents('laneMove'), [])
		assert.ok(h.intents('move').some((m) => m.ids.includes(F)), 'not selected before: the frame moves')
		h.restore()
		gridSetup()
		selectFrame()
		touch('pointerdown', 120, 210, 8)
		touch('pointermove', 120, 260, 8)
		touch('pointermove', 120, 320, 8)
		touch('pointerup', 120, 320, 8)
		assert.deepEqual(h.intents('laneMove'), [{ type: 'laneMove', id: F, lane: L1, to: 1 }])
	})
})

describe('job 208 AK4: a column edge, the "+", the editor, the menu, the transformer', () => {
	test('a column edge: col-resize at the selected frame; drag: frame and children right live; release: ONE colWidth; Esc: none', () => {
		gridSetup()
		h.pointer('pointermove', 460, 300, { buttons: 0 })
		assert.notEqual(cursor(), 'col-resize', 'not selected: no edge')
		selectFrame()
		h.pointer('pointermove', 460 + TABLE_BORDER_PX - 1, 300, { buttons: 0 })
		assert.equal(cursor(), 'col-resize')
		h.pointer('pointermove', 700, 300, { buttons: 0 })
		assert.equal(cursor(), 'col-resize', 'the frame\'s right edge is the last column\'s')
		h.pointer('pointerdown', 460, 300)
		h.pointer('pointermove', 480, 300)
		h.pointer('pointermove', 510, 300)
		h.frame()
		assert.deepEqual(h.scene.stats().lanes[0].cols.map((c) => c.w), [362, 240], 'live in the scene')
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, { id: F, col: C1, w: 362, lane: true }])
		const previews = callsOf('setPreviews').at(-1)[0]
		assert.deepEqual([previews.get(A), previews.get(B)], [undefined, { x: 550, y: 370 }], 'the children right of it follow')
		h.pointer('pointerup', 510, 300)
		assert.deepEqual(h.intents('colWidth'), [{ type: 'colWidth', id: F, col: C1, w: 362 }])
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, null])
		h.pointer('pointerdown', 460, 300)
		h.pointer('pointermove', 400, 300)
		h.frame()
		h.key('Escape')
		h.pointer('pointerup', 400, 300)
		assert.equal(h.intents('colWidth').length, 1)
		assert.deepEqual(h.scene.stats().lanes[0].cols.map((c) => c.w), [312, 240])
		h.pointer('pointerdown', 460, 300)
		h.pointer('pointermove', 200, 300)
		h.pointer('pointerup', 200, 300)
		assert.equal(h.intents('colWidth').at(-1).w, 100, 'at least COL_MIN_W')
	})

	test('col-add only at the one selected, unlocked frame with columns; a click asks for a column; it looks like lane-add', () => {
		setup()
		selectFrame()
		assert.ok(!handleNames().includes('col-add'), 'lanes without columns')
		h.restore()
		setup([gridItem({ lock: { by: 'x', name: 'X' } })])
		h.scene.setSelection([F])
		h.frame()
		assert.ok(!handleNames().includes('col-add'), 'locked')
		h.restore()
		gridSetup()
		selectFrame()
		const add = h.scene.handles().find((x) => x.name === 'col-add')
		assert.ok(add && add.x > 700 && Math.abs(add.y - 278) < 0.01, 'right middle, right of the frame')
		h.pointer('pointerdown', add.x, add.y)
		h.pointer('pointerup', add.x, add.y)
		assert.deepEqual(h.intents('colAdd'), [{ type: 'colAdd', id: F }])
		assert.deepEqual(handleLook('col-add'), handleLook('table-col'))
	})

	test('a double click on a column head opens the editor kind lane over it; the menu intent carries lane and column under W', () => {
		gridSetup()
		const p = { clientX: 300, clientY: 130, pointerType: 'mouse', pointerId: 1 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		const ta = editor()
		assert.ok(ta)
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'lane')
		assert.equal(ta.getAttribute('data-knorke-lane'), C1)
		assert.equal(ta.value, 'Phase 1')
		assert.match(ta.style.getPropertyValue('transform'), /translate\(148px, 100px\)/, 'over the head of column 1')
		assert.equal(ta.style.getPropertyValue('width'), '312px')
		// (job 264) on the head's fill, left like the name
		assert.deepEqual([ta.style.getPropertyValue('text-align'), ta.style.getPropertyValue('background'), ta.style.getPropertyValue('font-size')],
			['left', laneTones('#ffffff').head, '16px'])
		ta.value = 'Explore'
		dispatch(ta, 'input')
		dispatch(ta, 'keydown', { key: 'Enter' })
		const t = h.intents('text').at(-1)
		assert.deepEqual([t.cell, t.path, t.value, t.final], [C1, `data.cols.${C1}.t`, 'Explore', true])
		h.pointer('pointerdown', 600, 130, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 600, clientY: 130, button: 2, pointerId: 1, pointerType: 'mouse' })
		h.pointer('pointerup', 600, 130, { button: 2 })
		assert.deepEqual(h.intents('contextMenu').at(-1), { type: 'contextMenu', id: F, at: [600, 130], cell: L1, col: C2 }, 'the head of column 2: the first lane, clamped')
		h.pointer('pointerdown', 120, 410, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 120, clientY: 410, button: 2, pointerId: 1, pointerType: 'mouse' })
		h.pointer('pointerup', 120, 410, { button: 2 })
		assert.deepEqual(h.intents('contextMenu').at(-1), { type: 'contextMenu', id: F, at: [120, 410], cell: L3, col: C1 }, 'the head of lane 3: the first column, clamped')
	})

	test('the transformer: the changed column keeps COL_MIN_W; the head row stays above the first lane', () => {
		gridSetup()
		selectFrame()
		// (job 231) only corners: bl and br moved sideways, tr moved down
		const l = h.scene.handles().find((x) => x.name === 'bl')
		h.pointer('pointerdown', l.x, l.y)
		h.pointer('pointermove', l.x + 2000, l.y)
		h.pointer('pointerup', l.x + 2000, l.y)
		assert.equal(h.intents('transform').at(-1).after.get(F).w, 48 + 100 + 240)
		h.model.apply({ upserts: [gridItem()] })
		h.frame()
		const r = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', r.x, r.y)
		h.pointer('pointermove', r.x - 2000, r.y)
		h.pointer('pointerup', r.x - 2000, r.y)
		assert.equal(h.intents('transform').at(-1).after.get(F).w, 48 + 312 + 100)
		h.model.apply({ upserts: [gridItem()] })
		h.frame()
		const t = h.scene.handles().find((x) => x.name === 'tr')
		h.pointer('pointerdown', t.x, t.y)
		h.pointer('pointermove', t.x, t.y + 2000)
		h.pointer('pointerup', t.x, t.y + 2000)
		assert.equal(h.intents('transform').at(-1).after.get(F).h, 56 + 60 + 200, 'the head row and the first lane at LANE_MIN_H')
	})
})

/*
 * Factory job 225 (AK4): lane and column groups in the scene: stats().lanes
 * with gw, cg, g, groups and cgroups; the node with the group cell, the
 * turned name and the lines that start at the cell inside a run; the cell
 * hits the frame; a dragged cell (ghost of the run, the target by the
 * centre, laneGroupMove; Esc none); a dragged group edge (row-resize in
 * the cell column, snapping, the preview, at least one lane, a stop at
 * another group, laneGroupSpan; Esc none; outside the cell the lane
 * border); a double click on the cell opens the group's editor turned by
 * -90°; a column group's cell above the column names.
 */
const G1 = 'g00000001'
const G2 = 'g00000002'
const H1 = 'h00000001'

/** frameItem 648 wide (head 48 + 48, job 234) with L1 and L2 in G1 "Team". */
function groupItem(o = {}, lanes = { [L1]: G1, [L2]: G1 }, lgroups = { [G1]: 'Team' }) {
	const f = frameItem({ w: 648 })
	for (const [k, g] of Object.entries(lanes)) f.data.lanes[k].g = g
	f.data.lgroups = lgroups
	return { ...f, ...o }
}
const groupKids = () => kids().map((k) => ({ ...k, x: k.x + 48 }))

describe('job 225 AK4: lane groups in the scene', () => {
	test('stats().lanes with gw, g and groups; the node: the cell, the turned name, the names right of it, the lines', () => {
		setup([groupItem(), ...groupKids()])
		const [st] = h.scene.stats().lanes
		assert.deepEqual([st.head, st.gw, st.cg], [96, 48, 0])
		assert.deepEqual(st.lanes.map((l) => l.g), [G1, G1, null])
		assert.deepEqual(st.groups, [{ key: G1, y: 0, h: 200, title: 'Team', lanes: [L1, L2], fs: 16 }])
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
		const e = frameSpec.build(ctx, groupItem(), { x: 100, y: 100, w: 648, h: 300, r: 0 }, 0, G1)
		const names = e.parts.laneTitles
		const cell = names.get(G1 + ':0')
		assert.deepEqual([cell.attrs.x, cell.attrs.y, cell.attrs.width, cell.attrs.height, cell.attrs.rotation, cell.attrs.text], [0, 200, 200, 48, -90, 'Team'])
		assert.equal(cell.attrs.visible, false, 'its editor is open')
		// (job 234) a lane's name turned in its cell: right of the group's, over the full head without a group
		assert.deepEqual([names.get(L1).attrs.x, names.get(L1).attrs.height, names.get(L1).attrs.rotation, names.get(L3).attrs.x, names.get(L3).attrs.height],
			[48, 48, -90, 0, 96])
		const lines = e.parts.lanes.kids.find((k) => typeof k.attrs.sceneFunc === 'function')
		const path = []
		lines.attrs.sceneFunc({ beginPath() {}, moveTo: (x, y) => path.push(['m', x, y]), lineTo: (x, y) => path.push(['l', x, y]), strokeShape() {} }, lines)
		assert.ok(!path.some(([k, x, y]) => k === 'm' && x === 48 && y === 0), '(job 264) no line right of the cell')
		assert.ok(path.some(([k, x, y]) => k === 'm' && x === 48 && y === 100), 'between two lanes of the run: from the cell on')
		assert.ok(path.some(([k, x, y]) => k === 'm' && x === 0 && y === 200), 'below the run: the full width')
	})

	test('the cell hits the frame; a dragged cell: the ghost of its run, the target by its centre, laneGroupMove; Esc none', () => {
		setup([groupItem(), ...groupKids()])
		h.pointer('pointerdown', 120, 150)
		h.pointer('pointerup', 120, 150)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [F])
		h.pointer('pointerdown', 120, 150)
		h.pointer('pointermove', 120, 250)
		h.pointer('pointermove', 120, 380)
		h.frame()
		assert.deepEqual(h.scene.stats().headDrag, { id: F, key: G1, to: 1 })
		const prev = callsOf('setNodeDragPreview').at(-1)[0]
		assert.deepEqual(prev.ghost, { x: 100, y: 330, w: 648, h: 200 })
		assert.deepEqual(prev.target, { x: 100, y: 300, w: 648, h: 100, where: 'after', beside: false })
		h.pointer('pointerup', 120, 380)
		assert.deepEqual(h.intents('laneGroupMove'), [{ type: 'laneGroupMove', id: F, group: G1, to: 1 }])
		assert.deepEqual(h.intents('laneMove'), [])
		h.pointer('pointerdown', 120, 150)
		h.pointer('pointermove', 120, 250)
		h.pointer('pointermove', 120, 380)
		h.key('Escape')
		h.pointer('pointerup', 120, 380)
		assert.equal(h.intents('laneGroupMove').length, 1, 'Esc: none')
		// the name of a lane in the group still moves the lane
		h.pointer('pointerdown', 170, 150)
		h.pointer('pointermove', 170, 250)
		h.pointer('pointermove', 170, 260)
		h.pointer('pointerup', 170, 260)
		assert.deepEqual(h.intents('laneMove'), [{ type: 'laneMove', id: F, lane: L1, to: 1 }])
	})

	test('the selected frame: inside the cell the border between two lanes of the run is no border (E2E E91)', () => {
		setup([groupItem(), ...groupKids()])
		selectFrame()
		h.pointer('pointermove', 120, 200, { buttons: 0 })
		assert.notEqual(cursor(), 'row-resize')
		h.pointer('pointerdown', 120, 200)
		h.pointer('pointermove', 120, 300)
		h.pointer('pointermove', 120, 420)
		h.pointer('pointerup', 120, 420)
		assert.deepEqual(h.intents('laneHeight'), [])
		assert.deepEqual(h.intents('laneGroupMove'), [{ type: 'laneGroupMove', id: F, group: G1, to: 1 }])
	})

	test('a finger on the cell: at a frame not selected before the press it moves the frame; at the selected one the group', () => {
		setup([groupItem(), ...groupKids()])
		const touch = (type, x, y, id = 7) => h.pointer(type, x, y, { pointerType: 'touch', pointerId: id })
		touch('pointerdown', 120, 150)
		touch('pointermove', 120, 250)
		touch('pointermove', 120, 380)
		touch('pointerup', 120, 380)
		assert.deepEqual(h.intents('laneGroupMove'), [])
		assert.ok(h.intents('move').some((m) => m.ids.includes(F)), 'not selected before: the frame moves')
		h.restore()
		setup([groupItem(), ...groupKids()])
		selectFrame()
		touch('pointerdown', 120, 150, 8)
		touch('pointermove', 120, 250, 8)
		touch('pointermove', 120, 380, 8)
		touch('pointerup', 120, 380, 8)
		assert.deepEqual(h.intents('laneGroupMove'), [{ type: 'laneGroupMove', id: F, group: G1, to: 1 }])
		assert.deepEqual(h.intents('move').filter((m) => m.ids.includes(F)), [], 'the frame stays')
	})

	test('a group edge: row-resize in the cell column; it snaps, keeps one lane, stops at another group; laneGroupSpan; Esc none', () => {
		setup([groupItem(), ...groupKids()])
		selectFrame()
		h.pointer('pointermove', 120, 300 + TABLE_BORDER_PX - 1, { buttons: 0 })
		assert.equal(cursor(), 'row-resize')
		h.pointer('pointerdown', 120, 300)
		h.pointer('pointermove', 120, 340)
		h.pointer('pointermove', 120, 390)
		h.frame()
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, { id: F, span: { g: G1, from: 0, to: 2, ax: 'y' }, lane: true }])
		assert.deepEqual(h.scene.stats().lanes[0].groups[0].lanes, [L1, L2, L3], 'the cell follows')
		h.pointer('pointerup', 120, 390)
		assert.deepEqual(h.intents('laneGroupSpan'), [{ type: 'laneGroupSpan', id: F, group: G1, from: 0, to: 2 }])
		assert.deepEqual(callsOf('setTablePreview').at(-1), [F, null])
		h.pointer('pointerdown', 120, 300)
		h.pointer('pointermove', 120, 100)
		h.pointer('pointermove', 120, 50)
		h.frame()
		assert.deepEqual(h.scene.stats().lanes[0].groups[0].lanes, [L1], 'at least one lane')
		h.key('Escape')
		h.pointer('pointerup', 120, 50)
		assert.equal(h.intents('laneGroupSpan').length, 1, 'Esc: none')
		assert.equal(h.intents('laneHeight').length, 0)
		// outside the cell the same y is the border of lane 2
		h.pointer('pointerdown', 400, 300)
		h.pointer('pointermove', 400, 320)
		h.pointer('pointermove', 400, 340)
		h.pointer('pointerup', 400, 340)
		assert.deepEqual(h.intents('laneHeight'), [{ type: 'laneHeight', id: F, lane: L2, h: 140 }])
		h.restore()
		setup([groupItem({}, { [L1]: G1, [L3]: G2 }, { [G1]: 'A', [G2]: 'B' })])
		selectFrame()
		h.pointer('pointerdown', 120, 200)
		h.pointer('pointermove', 120, 300)
		h.pointer('pointermove', 120, 400)
		h.pointer('pointerup', 120, 400)
		assert.deepEqual(h.intents('laneGroupSpan'), [{ type: 'laneGroupSpan', id: F, group: G1, from: 0, to: 1 }], 'stops at G2')
	})

	test('a double click on the cell opens the group\'s editor turned by -90° over it; Enter gives its name', () => {
		setup([groupItem()])
		const p = { clientX: 124, clientY: 150, pointerType: 'mouse', pointerId: 1 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		const ta = editor()
		assert.ok(ta)
		assert.equal(ta.getAttribute('data-knorke-lane'), G1)
		assert.equal(ta.value, 'Team')
		assert.match(ta.style.getPropertyValue('transform'), /translate\(24px, 176px\) rotate\(-90deg\)/)
		assert.equal(ta.style.getPropertyValue('width'), '200px')
		ta.value = 'Org'
		dispatch(ta, 'input')
		dispatch(ta, 'keydown', { key: 'Enter' })
		const t = h.intents('text').at(-1)
		assert.deepEqual([t.cell, t.path, t.value, t.final], [G1, `data.lgroups.${G1}`, 'Org', true])
	})

	test('a column group: cg, its cell above the names hits the frame, its edge col-resize, its cell dragged colGroupMove', () => {
		const g = gridItem({ h: 400 })
		g.data.cols[C1].g = H1
		g.data.cgroups = { [H1]: 'Phase' }
		setup([g])
		const [st] = h.scene.stats().lanes
		assert.deepEqual([st.cg, st.top, st.cols.map((c) => c.g)], [44, 100, [H1, null]])
		assert.deepEqual(st.cgroups, [{ key: H1, x: 48, w: 312, title: 'Phase', cols: [C1], fs: 14 }])
		// (job 264) the group's editor: 14, left, on the group's fill
		assert.equal(h.scene.openTextEditor(F, { cell: H1 }), true)
		h.frame()
		const ta = editor()
		assert.deepEqual([ta.style.getPropertyValue('font-size'), ta.style.getPropertyValue('text-align'), ta.style.getPropertyValue('background')],
			['14px', 'left', laneTones('#ffffff').group])
		dispatch(ta, 'keydown', { key: 'Escape' })
		selectFrame()
		h.pointer('pointermove', 460, 120, { buttons: 0 })
		assert.equal(cursor(), 'col-resize')
		h.pointer('pointerdown', 460, 120)
		h.pointer('pointermove', 560, 120)
		h.pointer('pointermove', 690, 120)
		h.pointer('pointerup', 690, 120)
		assert.deepEqual(h.intents('colGroupSpan'), [{ type: 'colGroupSpan', id: F, group: H1, from: 0, to: 1 }])
		h.pointer('pointerdown', 350, 120)
		h.pointer('pointermove', 450, 120)
		h.pointer('pointermove', 700, 120)
		h.pointer('pointerup', 700, 120)
		assert.deepEqual(h.intents('colGroupMove'), [{ type: 'colGroupMove', id: F, group: H1, to: 1 }])
	})

	test('the node of a column group: (job 264) no line below the cell; between two columns of the run from the cell down', () => {
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
		const pathOf = (item) => {
			const e = frameSpec.build(ctx, item, { x: 100, y: 100, w: 600, h: 400, r: 0 }, 0, false)
			const path = []
			for (const k of e.parts.lanes.kids.filter((x) => typeof x.attrs.sceneFunc === 'function')) {
				k.attrs.sceneFunc({ beginPath() {}, moveTo: (x, y) => path.push(['m', x, y]), lineTo: (x, y) => path.push(['l', x, y]), strokeShape() {} }, k)
			}
			return { e, path }
		}
		const both = gridItem({ h: 400 })
		both.data.cols[C1].g = H1
		both.data.cols[C2].g = H1
		both.data.cgroups = { [H1]: 'Phase' }
		const a = pathOf(both)
		assert.ok(!a.path.some(([k, , y]) => k === 'l' && (y === 44 || y === 100)), 'no line below the cell nor below the head row')
		assert.ok(a.path.some(([k, x, y]) => k === 'm' && x === 360 && y === 44), 'between the two columns of the run: from the cell down')
		assert.ok(!a.path.some(([k, x, y]) => k === 'm' && x === 360 && y === 0))
		const cell = a.e.parts.laneTitles.get(H1 + ':48')
		assert.deepEqual([cell.attrs.x, cell.attrs.y, cell.attrs.width, cell.attrs.height, cell.attrs.rotation, cell.attrs.text], [48, 0, 552, 44, 0, 'Phase'])
		assert.deepEqual([cell.attrs.fontSize, cell.attrs.align], [14, 'left'], '(job 264) bold 14, left')
		assert.deepEqual([a.e.parts.laneTitles.get(C1).attrs.y, a.e.parts.laneTitles.get(C1).attrs.height], [44, 56], 'the column name below the cell')
		const one = gridItem({ h: 400 })
		one.data.cols[C1].g = H1
		one.data.cgroups = { [H1]: 'Phase' }
		const b = pathOf(one)
		assert.ok(b.path.some(([k, x, y]) => k === 'm' && x === 360 && y === 0), 'the end of the run: the full height')
		assert.deepEqual([b.e.parts.laneTitles.get(C2).attrs.y, b.e.parts.laneTitles.get(C2).attrs.height], [0, 100], 'a column without a group over the full head row')
	})
})

/*
 * Factory job 234 (AK2, AK3, AK5): a lane's name turned in its cell, the
 * names of lanes and groups smaller before they are cut, the lane's editor
 * turned over its cell in a frame with lane groups.
 */
describe('job 234: turned lane names in the scene', () => {
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

	test('AK3 a long name of a lane or a group gets smaller, down to 12, in one line; a line break is a space', () => {
		const item = groupItem({}, { [L1]: G1, [L2]: G1 }, { [G1]: 'Customer experience team' })
		item.data.lanes[L3].t = 'Warehouse\nNorth'
		item.data.lanes[L1].t = 'A name far too long for a lane of one hundred'
		const e = frameSpec.build(ctx, item, { x: 100, y: 100, w: 648, h: 300, r: 0 }, 0, false)
		const names = e.parts.laneTitles
		const cell = names.get(G1 + ':0')
		assert.equal(cell.attrs.fontSize, nameFontSize('Customer experience team', 200))
		assert.ok(cell.attrs.fontSize < 16 && cell.attrs.fontSize >= 12, 'the group\'s name smaller')
		assert.deepEqual([names.get(L3).attrs.text, names.get(L3).attrs.fontSize], ['Warehouse North', nameFontSize('Warehouse North', 100)])
		assert.deepEqual([names.get(L1).attrs.fontSize, names.get(L1).attrs.wrap, names.get(L1).attrs.ellipsis], [12, 'none', true], 'cut at 12')
		const col = gridItem({ h: 400 })
		col.data.cols[C1].g = H1
		col.data.cgroups = { [H1]: 'A column group name that is far too long for it' }
		const c = frameSpec.build(ctx, col, { x: 100, y: 100, w: 600, h: 400, r: 0 }, 0, false).parts.laneTitles
		assert.deepEqual([c.get(H1 + ':48').attrs.fontSize, c.get(H1 + ':48').attrs.wrap, c.get(H1 + ':48').attrs.ellipsis], [14, 'none', true],
			'(job 264) a column group\'s name stays 14, cut with "…"')
		assert.deepEqual([c.get(C1).attrs.rotation, c.get(C1).attrs.fontSize, c.get(C1).attrs.wrap], [undefined, 16, 'word'], 'column names stay level')
	})

	test('AK5 the editor of a lane in a frame with groups: turned over its cell, right of the group\'s or over the full head', () => {
		setup([groupItem()])
		assert.equal(h.scene.openTextEditor(F, { cell: L1 }), true)
		h.frame()
		let ta = editor()
		assert.match(ta.style.getPropertyValue('transform'), /translate\(122px, 126px\) rotate\(-90deg\)/)
		assert.deepEqual([ta.style.getPropertyValue('width'), ta.style.getPropertyValue('height')], ['100px', '48px'])
		dispatch(ta, 'keydown', { key: 'Escape' })
		assert.equal(h.scene.openTextEditor(F, { cell: L3 }), true)
		h.frame()
		ta = editor()
		assert.match(ta.style.getPropertyValue('transform'), /translate\(98px, 302px\) rotate\(-90deg\)/)
		assert.deepEqual([ta.style.getPropertyValue('width'), ta.style.getPropertyValue('height')], ['100px', '96px'])
	})
})
