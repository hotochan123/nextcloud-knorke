/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 258: tables and lanes out of SceneManager (StructureController).
 * AK1/AK2 (written before the move, green on the old code and unchanged
 * after it): stats() snapshots during a column border drag of a table, a
 * lane border drag of a frame and a head drag, with the renderer calls of
 * the drag, read off the old code.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, rcalls, setupScene } from './sceneHarness.mjs'

const T = '01JA00000000000000000000T1'
const F = '01JA00000000000000000000F1'
const A = '01JA00000000000000000000N1'
const B = '01JA00000000000000000000N2'
const C = ['c00000001', 'c00000002', 'c00000003']
const R = ['r00000001', 'r00000002', 'r00000003']
const L1 = 'l00000001'
const L2 = 'l00000002'
const L3 = 'l00000003'

/** A 3 × 3 table at (100, 100), 480 × 108, beside the frame below. */
const tableItem = () => ({
	id: T, t: 'table', x: 100, y: 100, w: 480, h: 108, r: 0, z: 'a5', parent: null,
	data: {
		cols: Object.fromEntries(C.map((k, i) => [k, { o: 'i' + i, w: 160 }])),
		rows: Object.fromEntries(R.map((k, i) => [k, { o: 'i' + i }])),
		cells: { [C[0]]: { [R[0]]: 'Name' } },
	},
	style: {},
})

/** A frame 600 × 300 at (100, 300) with three lanes of 100 and notes in lanes 2 and 3. */
const laneItems = () => [
	{
		id: F, t: 'frame', x: 100, y: 300, w: 600, h: 300, r: 0, z: 'a0', parent: null,
		data: { title: 'Prozess', lanes: { [L1]: { o: 'i0', h: 100, t: 'Sales' }, [L2]: { o: 'i1', h: 100, t: 'Support' }, [L3]: { o: 'i2', h: 100 } } },
		style: { fill: '#ffffff' },
	},
	{ id: A, t: 'sticky', x: 300, y: 120, w: 50, h: 50, r: 0, z: 'i1', parent: F, data: { text: 'a' }, style: {} },
	{ id: B, t: 'sticky', x: 300, y: 220, w: 50, h: 50, r: 0, z: 'i2', parent: F, data: { text: 'b' }, style: {} },
]

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

function setup() {
	h = setupScene([tableItem(), ...laneItems()])
	h.frame()
	return h
}

function click(x, y, id) {
	h.pointer('pointerdown', x, y)
	h.pointer('pointerup', x, y)
	h.frame()
	assert.deepEqual(h.scene.getSelection(), [id])
}

/** @return {object} the parts of stats() the structure drags touch, and the cursor */
function snap() {
	const s = h.scene.stats()
	return { tables: s.tables, lanes: s.lanes, headDrag: s.headDrag, cursor: h.scene.renderer.contentEl.style.cursor }
}

/** @param {number} from index into rcalls @return {Array} the renderer calls since then of the given names */
const since = (from, ...names) => rcalls.slice(from).filter((c) => names.includes(c[0]))

/** The lanes of the frame as stats().lanes shows them, with lane heights h1–h3. */
const lanesSnap = (h1, h2 = 100, h3 = 100) => [{
	id: F, head: 48, top: 0, gw: 0, cg: 0,
	lanes: [
		{ key: L1, y: 0, h: h1, title: 'Sales', g: null, fs: 16 },
		{ key: L2, y: h1, h: h2, title: 'Support', g: null, fs: 16 },
		{ key: L3, y: h1 + h2, h: h3, title: '', g: null, fs: 16 },
	],
	cols: [], groups: [], cgroups: [],
}]
const tablesSnap = (w1) => [{ id: T, cols: [w1, 160, 160], rows: [36, 36, 36], header: true }]

describe('job 258 AK1: stats() snapshot during a border drag', () => {
	test('a column border of the selected table, +60, then the release', () => {
		setup()
		click(120, 110, T)
		const at = rcalls.length
		h.pointer('pointermove', 261, 150, { buttons: 0 })
		h.pointer('pointerdown', 261, 150)
		h.pointer('pointermove', 290, 150)
		h.pointer('pointermove', 321, 150)
		h.frame()
		assert.deepEqual(snap(), { tables: tablesSnap(220), lanes: lanesSnap(100), headDrag: null, cursor: 'col-resize' })
		assert.deepEqual(since(at, 'setTablePreview'), [
			['setTablePreview', T, { id: T, col: C[0], w: 189 }],
			['setTablePreview', T, { id: T, col: C[0], w: 220 }],
		])
		assert.deepEqual(h.intents('tableWidth'), [], 'nothing before the release')
		h.pointer('pointerup', 321, 150)
		h.frame()
		assert.deepEqual(h.intents('tableWidth'), [{ type: 'tableWidth', id: T, col: C[0], w: 220 }])
		assert.deepEqual(snap(), { tables: tablesSnap(160), lanes: lanesSnap(100), headDrag: null, cursor: 'col-resize' })
		assert.deepEqual(since(at, 'setTablePreview').slice(2), [['setTablePreview', T, null]])
	})

	test('a lane border of the selected frame, +60, then the release', () => {
		setup()
		click(120, 350, F)
		const at = rcalls.length
		h.pointer('pointermove', 300, 400, { buttons: 0 })
		h.pointer('pointerdown', 300, 400)
		h.pointer('pointermove', 300, 430)
		h.pointer('pointermove', 300, 460)
		h.frame()
		assert.deepEqual(snap(), { tables: tablesSnap(160), lanes: lanesSnap(160), headDrag: null, cursor: 'row-resize' })
		assert.deepEqual(since(at, 'setTablePreview'), [
			['setTablePreview', F, { id: F, key: L1, h: 130, lane: true }],
			['setTablePreview', F, { id: F, key: L1, h: 160, lane: true }],
		])
		assert.deepEqual([...callsOf('setPreviews').at(-1)[0]], [[A, { x: 400, y: 480 }], [B, { x: 400, y: 580 }]], 'the children below follow')
		h.pointer('pointerup', 300, 460)
		h.frame()
		assert.deepEqual(h.intents('laneHeight'), [{ type: 'laneHeight', id: F, lane: L1, h: 160 }])
		assert.deepEqual(snap(), { tables: tablesSnap(160), lanes: lanesSnap(100), headDrag: null, cursor: 'row-resize' })
		assert.deepEqual(since(at, 'setTablePreview').slice(2), [['setTablePreview', F, null]])
		assert.equal(callsOf('setPreviews').at(-1)[0].size, 0)
	})
})

describe('job 258 AK2: stats() snapshot during a head drag', () => {
	test('the head of lane 1 dragged down, Esc, then again with a release', () => {
		setup()
		click(120, 350, F)
		const at = rcalls.length
		h.pointer('pointerdown', 120, 340)
		h.pointer('pointermove', 120, 450)
		h.pointer('pointermove', 120, 560)
		h.frame()
		assert.deepEqual(snap(), { tables: tablesSnap(160), lanes: lanesSnap(100), headDrag: { id: F, key: L1, to: 2 }, cursor: 'default' })
		assert.deepEqual(since(at, 'setNodeDragPreview').at(-1), ['setNodeDragPreview', {
			ghost: { x: 100, y: 520, w: 600, h: 100 },
			target: { x: 100, y: 500, w: 600, h: 100, where: 'after', beside: false },
		}])
		h.key('Escape')
		h.pointer('pointerup', 120, 560)
		h.frame()
		assert.deepEqual(snap(), { tables: tablesSnap(160), lanes: lanesSnap(100), headDrag: null, cursor: 'default' })
		assert.deepEqual(h.intents('laneMove'), [], 'Esc: no intent')
		h.pointer('pointerdown', 120, 340)
		h.pointer('pointermove', 120, 450)
		h.pointer('pointermove', 120, 560)
		h.pointer('pointerup', 120, 560)
		h.frame()
		assert.deepEqual(h.intents('laneMove'), [{ type: 'laneMove', id: F, lane: L1, to: 2 }])
		assert.deepEqual(snap(), { tables: tablesSnap(160), lanes: lanesSnap(100), headDrag: null, cursor: 'default' })
		assert.deepEqual(since(at, 'setNodeDragPreview').at(-1), ['setNodeDragPreview', null])
	})
})

describe('job 258 AK4/AK6: the module and its preview slot', () => {
	test('AK4 StructureController.js does not import SceneManager.js', async () => {
		const { readFileSync } = await import('node:fs')
		const src = readFileSync(new URL('../../../src/scene/StructureController.js', import.meta.url), 'utf8')
		assert.doesNotMatch(src, /from '\.\/SceneManager\.js'/)
		const sm = await import('../../../src/scene/SceneManager.js')
		const sc = await import('../../../src/scene/StructureController.js')
		assert.equal(sm.TABLE_BORDER_PX, sc.TABLE_BORDER_PX, 'still exported by SceneManager')
		assert.equal(sm.TABLE_BORDER_TOUCH_PX, sc.TABLE_BORDER_TOUCH_PX)
	})

	test('AK6 setPreview drops the old preview of another id first; clearPreview only on a match', async () => {
		const { StructureController } = await import('../../../src/scene/StructureController.js')
		const calls = []
		const s = new StructureController({ renderer: { setTablePreview: (...a) => calls.push(a) } })
		assert.equal(s.preview, null)
		const pa = { id: 'a', col: 'c', w: 100 }
		const pb = { id: 'b', col: 'c', w: 120 }
		s.setPreview(pa)
		s.setPreview(pb)
		assert.deepEqual(calls, [['a', pa], ['a', null], ['b', pb]])
		assert.equal(s.preview, pb)
		s.clearPreview((p) => p.id === 'x')
		assert.equal(s.preview, pb, 'no match: it stays')
		assert.equal(calls.length, 3)
		s.clearPreview((p) => p.id === 'b')
		assert.equal(s.preview, null)
		assert.deepEqual(calls.at(-1), ['b', null])
		let asked = 0
		s.clearPreview(() => ++asked > 0)
		assert.equal(asked, 0, 'no preview: match is not asked')
		assert.equal(s.colDrag, null)
		assert.equal(s.headDrag, null)
	})
})
