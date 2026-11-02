/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 173 (AK5): tables in the scene, on the real SceneManager,
 * InputController and TextEditor with the recording renderer stub
 * (sceneHarness.mjs; text heights from estimateCellHeight):
 * - stats().tables with the header on and off, at LOD 1 and LOD 2; the node
 *   builder (fake Konva) with and without text, the LOD-2 box
 * - the handles table-col / table-row only at one selected, unlocked table in
 *   mode edit with the select tool, without an editor and not at LOD 2; a
 *   table never gets the connector "+"; a click on them asks for a column
 *   or a row
 * - a column border: hover cursor, live preview, ONE intent at the release,
 *   Esc without one
 * - a double click opens the editor kind cell over its cell; a cell someone
 *   else holds opens nothing and its chip offers "Take over"; Tab moves row
 *   by row; Enter opens the top-left cell; a cell editor leaves its table
 *   free (isActive)
 * - the intent contextMenu carries the cell under W (pointer and keyboard);
 *   (round 1) a finger held on a cell of the selected table opens it too
 *
 * Factory job 174 (AK2), the cell editor's keys and paste:
 * - Tab in the last cell asks for a row (tableAppend with open) after its
 *   final text; the left cell of the session's new row is then open; no row
 *   from the session (50 rows): closed, the canvas has the focus; under a
 *   notice no row is asked for
 * - the arrows at the start / end of the text open the cell beside it
 *   (preventDefault, caret at the end); in the middle, with a selection, a
 *   modifier, during IME composition, under a notice and at the edge
 *   neither a jump nor preventDefault; a held neighbour: "Take over"
 * - Esc closes, the table stays selected
 * - paste: a grid ends the editor (preventDefault, final text first) with
 *   the intent tablePaste (table, cell, grid); no grid or a notice: the
 *   browser's; Excel's 1 × 1 ("Name\r\n" with a table) goes in at the caret
 *
 * Factory job 185 (AK2): ↑/↓ jump from the first / last line of the text
 * (the fake DOM has no layout, so only "\n" counts): from the middle of one
 * line both jump, the final text first, ← and → stay; in "ab\ncd" ↑ only
 * from the first line, ↓ only from the last; a selection, a modifier, IME
 * composition, a notice and the table's edge as before; a held cell above
 * offers "Take over"; with a stand-in layout (getComputedStyle and the
 * marker's box faked) the mirror decides on wrapped lines, takes the
 * styles, holds the text only through textContent, is gone at once and
 * leaves focus and selection; a marker of height 0 falls back to "\n".
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, note, setStubLod, setupScene } from './sceneHarness.mjs'
import { FakeElement, dispatch } from './fakeDom.mjs'
import { coarseLook } from '../../../src/scene/nodes/coarse.js'
import { table as tableSpec } from '../../../src/scene/nodes/table.js'
import { nodeSpecFor } from '../../../src/scene/nodes/index.js'
import { TABLE_BORDER_PX, TABLE_BORDER_TOUCH_PX } from '../../../src/scene/SceneManager.js'
import { LONG_PRESS_MS, TAP_SLOP_PX } from '../../../src/scene/GestureController.js'
import { TABLE_HEADER_FILL, TABLE_STROKE } from '../../../src/model/tokens.js'

const T = '01JA00000000000000000000T1'
const N = '01JA00000000000000000000N1'
const C = ['c00000001', 'c00000002', 'c00000003']
const R = ['r00000001', 'r00000002', 'r00000003']
const cell = (c, r) => C[c] + '.' + R[r]

/** A 3 × 3 table at (100, 100), 480 × 108, with a header text and one long text. */
function tableItem(o = {}) {
	return {
		id: T, t: 'table', x: 100, y: 100, w: 480, h: 108, r: 0, z: 'a5', parent: null,
		data: {
			cols: Object.fromEntries(C.map((k, i) => [k, { o: 'i' + i, w: 160 }])),
			rows: Object.fromEntries(R.map((k, i) => [k, { o: 'i' + i }])),
			cells: { [C[0]]: { [R[0]]: 'Name' } },
		},
		style: {},
		...o,
	}
}

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

/** @param {object[]} items WireItems @param {object} [opts] setupScene options */
function setup(items = [tableItem()], opts = {}) {
	h = setupScene(items, opts)
	h.frame()
	return h
}

/** Selects the table with a click on its top-left cell and settles. */
function selectTable() {
	h.pointer('pointerdown', 120, 110)
	h.pointer('pointerup', 120, 110)
	h.frame()
	assert.deepEqual(h.scene.getSelection(), [T])
}

const handleNames = () => h.scene.handles().map((x) => x.name)
const editor = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null
const editing = () => h.log.filter((e) => e[0] === 'onEditing').map((e) => e.slice(1))

describe('job 173 AK5: stats().tables, levels and the node', () => {
	test('stats().tables: measured columns and rows, header on and off; at LOD 1 and LOD 2 too', () => {
		setup()
		assert.deepEqual(h.scene.stats().tables, [{ id: T, cols: [160, 160, 160], rows: [36, 36, 36], header: true }])
		h.model.apply({ upserts: [tableItem({ style: { header: 'off' }, data: { ...tableItem().data, cells: { [C[1]]: { [R[2]]: 'a\nb\nc' } } } })] })
		h.scene.update({ added: [], removed: [], updated: new Map([[T, new Set(['data', 'style'])]]), geometry: new Set(), reordered: false })
		const st = h.scene.stats().tables[0]
		assert.equal(st.header, false)
		assert.deepEqual(st.rows, [36, 36, 3 * 16 * 1.2 + 16], 'the row of the longest cell grows: three lines + 2 · 8')
		for (const lod of [1, 2]) {
			setStubLod(lod)
			h.frame()
			assert.equal(h.scene.stats().tables.length, 1, 'LOD ' + lod)
		}
	})

	test('node: white ground, header tint, lines and border; texts only at level 0; LOD 2 a box', () => {
		const built = []
		class Node {
			constructor(a = {}) {
				this.attrs = { ...a }
				this.kids = []
				built.push(this)
			}

			setAttrs(a) { Object.assign(this.attrs, a) }
			getAttr(k) { return this.attrs[k] }
			visible(v) { this.attrs.visible = v }
			transformsEnabled() {}
			add(...k) { this.kids.push(...k) }
			destroy() { this.destroyed = true }
		}
		const ctx = { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {}, Line: class extends Node {}, shadows: true }
		assert.equal(nodeSpecFor('table'), tableSpec)
		const it = tableItem()
		const e = tableSpec.build(ctx, it, { x: 100, y: 100, w: 480, h: 108, r: 0 }, 0, false)
		const { bg, head, linesH, linesV, border, texts } = e.parts
		assert.deepEqual([bg.attrs.fill, bg.attrs.width, bg.attrs.height], ['#ffffff', 480, 108])
		assert.deepEqual([head.attrs.fill, head.attrs.height, head.attrs.visible], [TABLE_HEADER_FILL, 36, true])
		assert.deepEqual([linesV.attrs.xs, linesH.attrs.ys, border.attrs.stroke], [[160, 320], [36, 72], TABLE_STROKE], 'job 265: lines down and across, the border in style.stroke')
		assert.equal(texts.size, 1)
		const name = texts.get(cell(0, 0))
		assert.deepEqual([name.attrs.text, name.attrs.x, name.attrs.y, name.attrs.width, name.attrs.fontStyle, name.attrs.wrap], ['Name', 8, 8, 144, 'bold', 'word'])
		tableSpec.setTextHidden(e, cell(0, 0))
		assert.equal(name.attrs.visible, false, 'the cell of the open editor')
		tableSpec.setLod(ctx, e, it, null, 1)
		assert.equal(e.parts.texts.size, 0, 'below LOD_TEXT_SCALE no text')
		tableSpec.update(ctx, e, tableItem({ style: { header: 'off' } }), null, new Set(['style']))
		assert.equal(e.parts.head.attrs.visible, false, 'header off: no tint')
		assert.deepEqual(coarseLook(tableItem()), { cls: 'box', color: TABLE_STROKE, title: '' }, 'LOD 2: a box')
	})
})

describe('job 173 AK5: handles table-col and table-row', () => {
	test('one selected, unlocked table in mode edit: table-col right, table-row below; never the connector "+"', () => {
		setup()
		selectTable()
		assert.deepEqual(handleNames().sort(), ['table-col', 'table-row'])
		const [col] = h.scene.handles().filter((x) => x.name === 'table-col')
		const [row] = h.scene.handles().filter((x) => x.name === 'table-row')
		assert.ok(col.x > 580 && Math.abs(col.y - 154) < 0.01, 'right middle, outside the box')
		assert.ok(Math.abs(row.x - 340) < 0.01 && row.y > 208, 'bottom middle, outside the box')
		// a click on them asks for a column and a row
		for (const [hdl, axis] of [[col, 'col'], [row, 'row']]) {
			h.pointer('pointerdown', hdl.x, hdl.y)
			h.pointer('pointerup', hdl.x, hdl.y)
		}
		assert.deepEqual(h.intents('tableAppend'), [{ type: 'tableAppend', id: T, axis: 'col' }, { type: 'tableAppend', id: T, axis: 'row' }])
	})

	test('none locked, in modes vote and view, with another tool, with an editor, at LOD 2; a note keeps its "+"', () => {
		setup([tableItem({ lock: { by: 'x', name: 'X' } })])
		h.scene.setSelection([T])
		h.frame()
		assert.deepEqual(handleNames(), [], 'locked: nothing')
		h.restore()
		setup()
		selectTable()
		h.scene.setTool('sticky')
		h.frame()
		assert.deepEqual(handleNames(), [], 'another tool')
		h.scene.setTool('select')
		h.frame()
		assert.equal(handleNames().length, 2)
		setStubLod(2)
		h.scene.setCamera({ x: 0, y: 0, scale: 0.05 })
		h.frame()
		assert.deepEqual(handleNames(), [], 'LOD 2')
		setStubLod(0)
		h.scene.setCamera({ x: 0, y: 0, scale: 1 })
		h.frame()
		assert.equal(h.scene.openTextEditor(T), true)
		h.frame()
		assert.deepEqual(handleNames(), [], 'editor open')
		h.restore()
		setup([tableItem()], { scene: { mode: 'vote' } })
		h.scene.setSelection([T])
		h.frame()
		assert.deepEqual(handleNames(), [], 'mode vote')
		h.restore()
		setup([note(N, { x: 700 })])
		h.scene.setSelection([N])
		h.frame()
		assert.deepEqual(handleNames().filter((x) => x.startsWith('plus-')).length, 4, 'a note keeps its four "+"')
	})
})

describe('job 173 AK5: column borders', () => {
	test('hover: col-resize; drag: live preview; release: ONE intent tableWidth; Esc: none', () => {
		setup()
		selectTable()
		// the border between column 1 and 2 lies at x = 100 + 160
		h.pointer('pointermove', 260 + TABLE_BORDER_PX - 1, 150, { buttons: 0 })
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'col-resize')
		h.pointer('pointermove', 260 + TABLE_BORDER_PX + 3, 150, { buttons: 0 })
		assert.notEqual(h.scene.renderer.contentEl.style.cursor, 'col-resize')
		h.pointer('pointermove', 580, 150, { buttons: 0 })
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'col-resize', 'the right outer edge counts')
		// drag the first border by +60
		h.pointer('pointerdown', 261, 150)
		h.pointer('pointermove', 290, 150)
		h.pointer('pointermove', 321, 150)
		h.frame()
		assert.deepEqual(h.scene.stats().tables[0].cols, [220, 160, 160], 'live in the scene')
		assert.deepEqual(callsOf('setTablePreview').at(-1), [T, { id: T, col: C[0], w: 220 }], 'and in the renderer')
		assert.deepEqual(h.intents('tableWidth'), [], 'nothing before the release')
		h.pointer('pointerup', 321, 150)
		assert.deepEqual(h.intents('tableWidth'), [{ type: 'tableWidth', id: T, col: C[0], w: 220 }], 'one intent')
		assert.deepEqual(callsOf('setTablePreview').at(-1), [T, null], 'the preview ends')
		// Esc: no intent, the width springs back
		h.pointer('pointerdown', 421, 150)
		h.pointer('pointermove', 500, 150)
		h.frame()
		assert.equal(h.scene.stats().tables[0].cols[1], 239)
		h.key('Escape')
		h.pointer('pointerup', 500, 150)
		assert.equal(h.intents('tableWidth').length, 1, 'Esc: no second intent')
		assert.deepEqual(h.scene.stats().tables[0].cols, [160, 160, 160], 'the stored widths again')
		// the bounds 40–1000
		h.pointer('pointerdown', 261, 150)
		h.pointer('pointermove', 50, 150)
		h.pointer('pointerup', 50, 150)
		assert.equal(h.intents('tableWidth').at(-1).w, 40)
	})

	test('a finger reaches a border within TABLE_BORDER_TOUCH_PX; not without the selection', () => {
		setup()
		assert.equal(TABLE_BORDER_TOUCH_PX, 11)
		h.pointer('pointermove', 261, 150, { buttons: 0 })
		assert.notEqual(h.scene.renderer.contentEl.style.cursor, 'col-resize', 'not selected: no border')
		selectTable()
		h.pointer('pointerdown', 270, 150, { pointerType: 'touch', pointerId: 5 })
		h.pointer('pointermove', 300, 150, { pointerType: 'touch', pointerId: 5 })
		h.pointer('pointermove', 330, 150, { pointerType: 'touch', pointerId: 5 })
		h.pointer('pointerup', 330, 150, { pointerType: 'touch', pointerId: 5 })
		assert.deepEqual(h.intents('tableWidth').map((i) => [i.col, i.w]), [[C[0], 220]])
	})
})

describe('job 173 AK5: the cell editor', () => {
	test('a double click opens the editor kind cell over its cell; onEditing names the cell; the table stays free', () => {
		setup()
		const p = { clientX: 300, clientY: 160, pointerType: 'mouse', pointerId: 1 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		const ta = editor()
		assert.ok(ta)
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'cell')
		assert.equal(ta.getAttribute('data-knorke-cell'), cell(1, 1))
		assert.match(ta.style.getPropertyValue('transform'), /translate\(260px, 136px\)/, 'over the cell (100 + 160, 100 + 36)')
		assert.equal(ta.style.getPropertyValue('width'), '160px')
		assert.deepEqual(editing(), [[T, false, cell(1, 1)]])
		assert.equal(h.scene.isActive(T), false, 'the others\' cells arrive meanwhile')
		assert.equal(h.scene.stats().editingCell, cell(1, 1))
		assert.deepEqual(callsOf('setTextHidden').at(-1), [T, true, cell(1, 1)])
		// the row grows while typing
		ta.value = 'one\ntwo\nthree'
		dispatch(ta, 'input')
		h.frame()
		assert.equal(h.scene.stats().tables[0].rows[1], 3 * 16 * 1.2 + 16)
		assert.equal(ta.style.getPropertyValue('height'), (3 * 16 * 1.2 + 16) + 'px')
		// the header row is bold
		dispatch(ta, 'keydown', { key: 'Escape' })
		assert.equal(h.intents('text').at(-1).cell, cell(1, 1))
		assert.equal(h.intents('text').at(-1).path, `data.cells.${C[1]}.${R[1]}`)
		assert.equal(h.scene.openTextEditor(T, { cell: cell(0, 0) }), true)
		assert.equal(editor().style.getPropertyValue('font-weight'), 'bold')
	})

	test('Tab and Shift+Tab move row by row; after the last cell the editor ends', () => {
		setup()
		assert.equal(h.scene.openTextEditor(T, { cell: cell(2, 1) }), true)
		dispatch(editor(), 'keydown', { key: 'Tab' })
		assert.equal(editor().getAttribute('data-knorke-cell'), cell(0, 2), 'next row')
		dispatch(editor(), 'keydown', { key: 'Tab', shiftKey: true })
		assert.equal(editor().getAttribute('data-knorke-cell'), cell(2, 1), 'back')
		h.scene.openTextEditor(T, { cell: cell(2, 2) })
		dispatch(editor(), 'keydown', { key: 'Tab' })
		assert.equal(editor(), null, 'after the last cell')
		h.scene.setSelection([T])
		h.focusCanvas()
		h.key('Enter')
		assert.equal(editor()?.getAttribute('data-knorke-cell'), cell(0, 0), 'Enter: the top-left cell')
	})

	test('a cell someone else holds opens nothing; its chip sits at the cell and offers "Take over" for 5 s', () => {
		setup()
		const bob = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#1565c0', guest: false, cursor: null, selection: [], drag: [], editing: T, editingCell: cell(1, 0), editingHolder: true }
		h.scene.setRemoteSampler(() => [bob])
		h.frame()
		const chip = () => h.container.descendants().find((el) => el.getAttribute('data-knorke-editing') === T) ?? null
		assert.ok(chip())
		assert.equal(chip().getAttribute('data-knorke-cell'), cell(1, 0))
		assert.match(chip().style.transform, /translate\(260px, 96px\)/, 'above the cell (y 100 − 4)')
		assert.equal(h.scene.openTextEditor(T, { cell: cell(1, 0) }), false)
		h.frame()
		assert.equal(editor(), null)
		const btn = chip().descendants().find((el) => el.getAttribute('data-knorke-action') === 'take-over')
		assert.ok(btn, 'Take over')
		assert.equal(h.scene.openTextEditor(T, { cell: cell(2, 0) }), true, 'another cell is free')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		dispatch(btn, 'click')
		assert.equal(editor()?.getAttribute('data-knorke-cell'), cell(1, 0))
		assert.deepEqual(editing().at(-1), [T, true, cell(1, 0)], 'taken over')
	})
})

describe('job 173 AK5: the menu intent carries the cell under W', () => {
	test('right click on a cell; Shift+F10 the cell under the selection\'s middle', () => {
		setup()
		h.pointer('pointerdown', 450, 190, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 450, clientY: 190, button: 2, pointerId: 1, pointerType: 'mouse' })
		h.pointer('pointerup', 450, 190, { button: 2 })
		const [m] = h.intents('contextMenu')
		assert.deepEqual(m, { type: 'contextMenu', id: T, at: [450, 190], cell: cell(2, 2) })
		h.focusCanvas()
		h.key('F10', { shiftKey: true })
		const k = h.intents('contextMenu').at(-1)
		assert.deepEqual([k.id, k.cell], [T, cell(1, 1)], 'the middle (340, 154) lies in the middle cell')
		// a note gets no cell
		h.restore()
		setup([note(N)])
		h.pointer('pointerdown', 50, 50, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 50, clientY: 50, button: 2, pointerId: 1, pointerType: 'mouse' })
		h.pointer('pointerup', 50, 50, { button: 2 })
		assert.equal('cell' in h.intents('contextMenu')[0], false)
	})
})

describe('job 173: no cell in the menu intent at LOD 2', () => {
	test('LOD 2: the intent has no cell (the structure rules end there)', () => {
		setup()
		setStubLod(2)
		h.frame()
		h.pointer('pointerdown', 450, 190, { button: 2 })
		dispatch(h.container, 'contextmenu', { clientX: 450, clientY: 190, button: 2, pointerId: 1, pointerType: 'mouse' })
		h.pointer('pointerup', 450, 190, { button: 2 })
		const [m] = h.intents('contextMenu')
		assert.equal(m.id, T)
		assert.equal('cell' in m, false)
	})
})

describe('job 173 round 1: a finger held on a cell of the selected table opens the cell menu', () => {
	test('held LONG_PRESS_MS within TAP_SLOP_PX: the intent with the cell, no drag, the touchend cancelled', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			setup()
			selectTable()
			const touch = (type, x, y, id = 7) => h.pointer(type, x, y, { pointerType: 'touch', pointerId: id })
			touch('pointerdown', 450, 190)
			touch('pointermove', 455, 194)
			mock.timers.tick(LONG_PRESS_MS - 1)
			assert.deepEqual(h.intents('contextMenu'), [], 'not before LONG_PRESS_MS')
			mock.timers.tick(1)
			assert.deepEqual(h.intents('contextMenu'), [{ type: 'contextMenu', id: T, at: [450, 190], cell: cell(2, 2) }])
			touch('pointermove', 520, 260)
			touch('pointerup', 520, 260)
			assert.deepEqual(h.intents('move'), [], 'the press ended: no drag')
			const te = dispatch(h.container, 'touchend', { cancelable: true })
			assert.equal(te.defaultPrevented, true, 'no compatibility click on the menu')
			assert.deepEqual(h.scene.getSelection(), [T])
			// a finger that moves beyond TAP_SLOP_PX drags the table, no menu
			touch('pointerdown', 450, 190, 8)
			touch('pointermove', 450 + TAP_SLOP_PX + 2, 190, 8)
			mock.timers.tick(LONG_PRESS_MS)
			touch('pointermove', 500, 190, 8)
			touch('pointerup', 500, 190, 8)
			assert.equal(h.intents('contextMenu').length, 1, 'no second menu')
			assert.equal(h.intents('move').length, 1, 'a drag')
		} finally {
			mock.timers.reset()
		}
	})

	test('not on a table that was not selected, not on a locked one, not on a note, not at LOD 2', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			const hold = (x, y) => {
				h.pointer('pointerdown', x, y, { pointerType: 'touch', pointerId: 9 })
				mock.timers.tick(LONG_PRESS_MS + 10)
				h.pointer('pointerup', x, y, { pointerType: 'touch', pointerId: 9 })
			}
			setup()
			hold(450, 190)
			assert.deepEqual(h.intents('contextMenu'), [], 'the first touch only selects')
			h.restore()
			setup([tableItem({ lock: { by: 'x', name: 'X' } })])
			h.scene.setSelection([T])
			h.frame()
			hold(450, 190)
			assert.deepEqual(h.intents('contextMenu'), [], 'locked')
			h.restore()
			setup([note(N, { x: 700, y: 100 })])
			h.scene.setSelection([N])
			h.frame()
			hold(800, 200)
			assert.deepEqual(h.intents('contextMenu'), [], 'a note: rule 4 as before')
			h.restore()
			setup()
			selectTable()
			setStubLod(2)
			h.frame()
			hold(450, 190)
			assert.deepEqual(h.intents('contextMenu'), [], 'LOD 2')
		} finally {
			mock.timers.reset()
		}
	})
})

describe('job 174 AK2: the cell editor – Tab in the last cell, the arrows, Esc, paste', () => {
	const R4 = 'r00000004'
	// the caret as a browser keeps it: setSelectionRange sets selectionStart / selectionEnd
	const caret = () => mock.method(FakeElement.prototype, 'setSelectionRange', function (a, b) {
		this.selectionStart = a
		this.selectionEnd = b
	})
	afterEach(() => mock.restoreAll())
	const withCells = () => tableItem({ data: { ...tableItem().data, cells: { [C[0]]: { [R[0]]: 'Name' }, [C[1]]: { [R[1]]: 'ab' } } } })
	const at = () => editor()?.getAttribute('data-knorke-cell') ?? null
	const key = (k, props = {}) => dispatch(editor(), 'keydown', { key: k, isComposing: false, ...props })
	const clip = (data) => ({ getData: (t) => data[t] ?? '' })

	test('Tab in the last cell: its final text, then tableAppend (row, open); the left cell of the new row opens', () => {
		caret()
		setup([tableItem()], {
			on: {
				onIntent: (i) => {
					if (i.type !== 'tableAppend') return
					// the session: the row at the end, then the editor of its left cell
					const it = h.model.get(T)
					h.model.apply({ upserts: [{ ...it, h: 144, data: { ...it.data, rows: { ...it.data.rows, [R4]: { o: 'i3' } } } }] })
					h.scene.update({ added: [], removed: [], updated: new Map([[T, new Set(['data', 'h'])]]), geometry: new Set([T]), reordered: false })
					h.scene.openTextEditor(T, { cell: C[0] + '.' + R4 })
				},
			},
		})
		h.scene.setSelection([T])
		assert.equal(h.scene.openTextEditor(T, { cell: cell(2, 2) }), true)
		editor().value = 'x'
		dispatch(editor(), 'input')
		const e = key('Tab')
		assert.equal(e.defaultPrevented, true)
		const log = h.log.filter((x) => x[0] === 'onIntent').map((x) => x[1])
		const iText = log.findIndex((i) => i.type === 'text' && i.final && i.value === 'x' && i.cell === cell(2, 2))
		const iRow = log.findIndex((i) => i.type === 'tableAppend')
		assert.ok(iText >= 0 && iRow > iText, 'the text first, then the row')
		assert.deepEqual(log[iRow], { type: 'tableAppend', id: T, axis: 'row', open: true })
		assert.equal(at(), C[0] + '.' + R4, 'the left cell of the new row')
		assert.equal(h.dom.doc.activeElement, editor(), 'the editor keeps the focus')
		assert.deepEqual(editing().at(-1), [T, false, C[0] + '.' + R4])
	})

	test('no row from the session (50 rows): the editor is closed, the canvas has the focus; under a notice no row is asked for; not after any other cell', () => {
		setup()
		h.scene.openTextEditor(T, { cell: cell(2, 2) })
		key('Tab')
		assert.equal(h.intents('tableAppend').length, 1)
		assert.equal(editor(), null)
		assert.equal(h.dom.doc.activeElement, h.container, 'focus on the canvas')
		h.scene.openTextEditor(T, { cell: cell(2, 2) })
		h.scene.setEditorNotice(T, 'Not saved.', cell(2, 2))
		key('Tab')
		assert.equal(h.intents('tableAppend').length, 1, 'under a notice: as before, no row')
		assert.equal(editor(), null)
		h.scene.openTextEditor(T, { cell: cell(1, 2) })
		key('Tab')
		assert.equal(at(), cell(2, 2), 'any other cell: the next one')
		assert.equal(h.intents('tableAppend').length, 1)
		key('Tab', { shiftKey: true })
		h.scene.openTextEditor(T, { cell: cell(0, 0) })
		key('Tab', { shiftKey: true })
		assert.equal(editor(), null, 'Shift+Tab in the first cell ends it')
		assert.equal(h.intents('tableAppend').length, 1)
	})

	test('the arrows at the start or end of the text open the cell beside it (preventDefault, the final text, the caret at the end)', () => {
		caret()
		setup([withCells()])
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		assert.equal(editor().selectionStart, 2, 'the caret at the end')
		editor().value = 'abc'
		dispatch(editor(), 'input')
		editor().setSelectionRange(3, 3)
		let e = key('ArrowRight')
		assert.equal(e.defaultPrevented, true)
		assert.equal(at(), cell(2, 1), '→ at the end: right')
		assert.deepEqual(h.intents('text').filter((i) => i.final).map((i) => [i.cell, i.value]), [[cell(1, 1), 'abc']], 'the editor ended with its text')
		e = key('ArrowUp')
		assert.deepEqual([e.defaultPrevented, at()], [true, cell(2, 0)], '↑ at the start (empty cell): up')
		e = key('ArrowDown')
		assert.deepEqual([e.defaultPrevented, at()], [true, cell(2, 1)], '↓ at the end: down')
		e = key('ArrowLeft')
		assert.deepEqual([e.defaultPrevented, at()], [true, cell(1, 1)], '← at the start: left')
		// no session here: the cell still holds its stored text
		assert.deepEqual([editor().value, editor().selectionStart, editor().selectionEnd], ['ab', 2, 2], 'the neighbour opens with the caret at the end')
		e = key('ArrowLeft')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 1)], '← at the end: in the text')
		editor().setSelectionRange(0, 0)
		e = key('ArrowLeft')
		assert.deepEqual([e.defaultPrevented, at()], [true, cell(0, 1)])
	})

	test('no jump and no preventDefault: caret in the middle, a selection, a modifier, IME composition, a notice, the table\'s edge; ↓ in the last row appends nothing', () => {
		caret()
		setup([withCells()])
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		const none = (label, k, props = {}) => {
			const e = key(k, props)
			assert.equal(e.defaultPrevented, false, label)
			assert.equal(at(), cell(1, 1), label)
		}
		// job 185: in one line ↑ and ↓ jump from the middle too (the next test); ← and → do not
		editor().setSelectionRange(1, 1)
		for (const k of ['ArrowLeft', 'ArrowRight']) none('middle ' + k, k)
		editor().setSelectionRange(0, 2)
		for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) none('selection ' + k, k)
		editor().setSelectionRange(0, 0)
		for (const m of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) none(m, 'ArrowLeft', { [m]: true })
		none('isComposing', 'ArrowLeft', { isComposing: true })
		editor().setSelectionRange(1, 1)
		for (const k of ['ArrowUp', 'ArrowDown']) {
			for (const m of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) none(m + ' ' + k, k, { [m]: true })
			none('isComposing ' + k, k, { isComposing: true })
		}
		h.scene.setEditorNotice(T, 'Not saved.', cell(1, 1))
		none('notice', 'ArrowLeft')
		for (const k of ['ArrowUp', 'ArrowDown']) none('notice ' + k, k)
		h.scene.setEditorNotice(T, null, cell(1, 1))
		key('Escape')
		h.scene.openTextEditor(T, { cell: cell(0, 1) })
		editor().setSelectionRange(0, 0)
		let e = key('ArrowLeft')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(0, 1)], 'the left edge')
		h.scene.openTextEditor(T, { cell: cell(2, 2) })
		e = key('ArrowDown')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(2, 2)], '↓ in the last row')
		e = key('ArrowRight')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(2, 2)], 'the bottom right corner')
		assert.deepEqual(h.intents('tableAppend'), [], '↓ in the last row appends nothing')
		h.scene.openTextEditor(T, { cell: cell(1, 0) })
		editor().value = 'abc'
		editor().setSelectionRange(1, 1)
		e = key('ArrowUp')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 0)], '↑ in the first row (job 185: caret in the middle of one line)')
	})

	test('a neighbour someone else holds: the editor ends, the chip offers "Take over"', () => {
		caret()
		setup([withCells()])
		const bob = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#1565c0', guest: false, cursor: null, selection: [], drag: [], editing: T, editingCell: cell(2, 1), editingHolder: true }
		h.scene.setRemoteSampler(() => [bob])
		h.frame()
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		const e = key('ArrowRight')
		assert.equal(e.defaultPrevented, true)
		h.frame()
		assert.equal(editor(), null)
		const chip = h.container.descendants().find((el) => el.getAttribute('data-knorke-editing') === T && el.getAttribute('data-knorke-cell') === cell(2, 1))
		assert.ok(chip?.descendants().some((el) => el.getAttribute('data-knorke-action') === 'take-over'), 'Take over')
		assert.equal(h.dom.doc.activeElement, h.container)
	})

	test('Esc closes the cell editor; the table stays selected, the canvas has the focus', () => {
		setup()
		selectTable()
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		key('Escape')
		assert.equal(editor(), null)
		assert.deepEqual(h.scene.getSelection(), [T])
		assert.equal(h.dom.doc.activeElement, h.container)
	})

	test('paste of a grid: preventDefault, the final text, then tablePaste with table, cell and grid; the editor is closed', () => {
		setup()
		selectTable()
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		editor().value = 'typed'
		dispatch(editor(), 'input')
		const e = dispatch(editor(), 'paste', { clipboardData: clip({ 'text/plain': 'a\tb\r\n"c\nd"\te\r\n' }) })
		assert.equal(e.defaultPrevented, true)
		assert.equal(editor(), null)
		const log = h.log.filter((x) => x[0] === 'onIntent').map((x) => x[1])
		const iText = log.findIndex((i) => i.type === 'text' && i.final && i.value === 'typed')
		const iPaste = log.findIndex((i) => i.type === 'tablePaste')
		assert.ok(iText >= 0 && iPaste > iText, 'the editor ends with its text first')
		assert.deepEqual(log[iPaste], { type: 'tablePaste', id: T, cell: cell(1, 1), grid: [['a', 'b'], ['c\nd', 'e']] })
		assert.deepEqual(h.scene.getSelection(), [T])
		assert.equal(h.dom.doc.activeElement, h.container)
	})

	test('paste without a grid or under a notice: no preventDefault, the editor stays', () => {
		setup()
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		let e = dispatch(editor(), 'paste', { clipboardData: clip({ 'text/plain': 'two\nlines', 'text/html': '<p>two</p>' }) })
		assert.equal(e.defaultPrevented, false)
		assert.equal(at(), cell(1, 1))
		h.scene.setEditorNotice(T, 'Not saved.', cell(1, 1))
		e = dispatch(editor(), 'paste', { clipboardData: clip({ 'text/plain': 'a\tb' }) })
		assert.equal(e.defaultPrevented, false)
		assert.equal(at(), cell(1, 1))
		e = dispatch(editor(), 'paste', {})
		assert.equal(e.defaultPrevented, false, 'no clipboardData')
		assert.deepEqual(h.intents('tablePaste'), [])
	})

	test('Excel 1 × 1 ("Name\\r\\n" with a table): Name at the caret, replacing the selection, within maxLength', () => {
		caret()
		setup()
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		const ta = editor()
		ta.value = 'ab'
		ta.setSelectionRange(1, 1)
		const excel = clip({ 'text/plain': 'Name\r\n', 'text/html': '<html><body><table><tr><td>Name</td></tr></table></body></html>' })
		let e = dispatch(ta, 'paste', { clipboardData: excel })
		assert.equal(e.defaultPrevented, true)
		assert.deepEqual([ta.value, ta.selectionStart, ta.selectionEnd], ['aNameb', 5, 5])
		assert.equal(editor(), ta, 'the editor stays open')
		ta.setSelectionRange(0, 1)
		dispatch(ta, 'paste', { clipboardData: excel })
		assert.equal(ta.value, 'NameNameb', 'the selection replaced')
		ta.value = 'x'.repeat(998)
		ta.setSelectionRange(998, 998)
		dispatch(ta, 'paste', { clipboardData: excel })
		assert.equal(ta.value, 'x'.repeat(998) + 'Na', 'cut at maxLength')
		assert.deepEqual(h.intents('tablePaste'), [])
	})
})

describe('job 185 AK2: ↑/↓ from the first and last line of a cell\'s text (the fake DOM has no layout: only "\\n" counts)', () => {
	const caret = () => mock.method(FakeElement.prototype, 'setSelectionRange', function (a, b) {
		this.selectionStart = a
		this.selectionEnd = b
	})
	afterEach(() => mock.restoreAll())
	const at = () => editor()?.getAttribute('data-knorke-cell') ?? null
	const key = (k, props = {}) => dispatch(editor(), 'keydown', { key: k, isComposing: false, ...props })
	/** Opens cell (1, 1), types text and puts the caret at pos. */
	const write = (text, pos) => {
		h.scene.openTextEditor(T, { cell: cell(1, 1) })
		editor().value = text
		dispatch(editor(), 'input')
		editor().setSelectionRange(pos, pos)
	}
	/** Index in h.log of the first entry that matches. */
	const logIndex = (fn) => h.log.findIndex(fn)

	test('one line "abc", caret at 1: ↑ opens the cell above, ↓ the one below (preventDefault, the final text first); ← and → stay', () => {
		caret()
		setup()
		write('abc', 1)
		for (const k of ['ArrowLeft', 'ArrowRight']) {
			const e = key(k)
			assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 1)], k + ' at 1: in the text')
		}
		for (const [k, to] of [['ArrowUp', cell(1, 0)], ['ArrowDown', cell(1, 2)]]) {
			const from = h.log.length
			const e = key(k)
			assert.deepEqual([e.defaultPrevented, at()], [true, to], k + ': the neighbour')
			const iText = logIndex((x, i) => i >= from && x[0] === 'onIntent' && x[1].type === 'text' && x[1].final && x[1].cell === cell(1, 1))
			const iOpen = logIndex((x, i) => i >= from && x[0] === 'onEditing' && x[3] === to)
			assert.ok(iText >= 0 && iOpen > iText, k + ': the text "abc" goes out first, then the neighbour opens')
			assert.equal(h.log[iText][1].value, 'abc')
			if (k === 'ArrowUp') write('abc', 1)
		}
	})

	test('"ab\\ncd": caret at 4 (second line) ↑ stays, ↓ jumps; caret at 1 (first line) ↑ jumps, ↓ stays', () => {
		caret()
		setup()
		write('ab\ncd', 4)
		let e = key('ArrowUp')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 1)], '↑ in the last line: in the text')
		e = key('ArrowDown')
		assert.deepEqual([e.defaultPrevented, at()], [true, cell(1, 2)], '↓ in the last line: below')
		write('ab\ncd', 1)
		e = key('ArrowDown')
		assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 1)], '↓ in the first line: in the text')
		e = key('ArrowUp')
		assert.deepEqual([e.defaultPrevented, at()], [true, cell(1, 0)], '↑ in the first line: above')
	})

	test('a cell above someone else holds: ↑ from the middle of one line ends the editor, the chip offers "Take over"', () => {
		caret()
		setup()
		const bob = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#1565c0', guest: false, cursor: null, selection: [], drag: [], editing: T, editingCell: cell(1, 0), editingHolder: true }
		h.scene.setRemoteSampler(() => [bob])
		h.frame()
		write('abc', 1)
		const e = key('ArrowUp')
		assert.equal(e.defaultPrevented, true)
		h.frame()
		assert.equal(editor(), null)
		const chip = h.container.descendants().find((el) => el.getAttribute('data-knorke-editing') === T && el.getAttribute('data-knorke-cell') === cell(1, 0))
		assert.ok(chip?.descendants().some((el) => el.getAttribute('data-knorke-action') === 'take-over'), 'Take over')
	})

	test('with a layout (a stand-in: 10 characters a line): the mirror decides, wrapped lines count; it takes the styles, holds the text only as textContent and goes away at once', () => {
		caret()
		setup()
		const mirrors = []
		let height = 18
		// the stand-in layout: the marker sits in line ⌊characters before it / 10⌋ (the text the mirror holds before its marker), 20 px a line
		FakeElement.prototype.getClientRects = function () {
			if (!mirrors.includes(this.parentNode)) mirrors.push(this.parentNode)
			return [{ top: Math.floor(this.parentNode._text.length / 10) * 20, height }]
		}
		window.getComputedStyle = () => ({ getPropertyValue: (k) => (k === 'font-size' ? '16px' : 'x-' + k) })
		try {
			const open = (pos) => {
				write('x'.repeat(25), pos)
				editor().clientWidth = 144
			}
			open(25)
			let e = key('ArrowUp')
			assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 1)], '↑ in the third line: in the text')
			assert.equal(h.dom.doc.activeElement, editor(), 'the measuring leaves the focus')
			assert.deepEqual([editor().selectionStart, editor().selectionEnd], [25, 25], 'and the selection')
			editor().setSelectionRange(5, 5)
			e = key('ArrowDown')
			assert.deepEqual([e.defaultPrevented, at()], [false, cell(1, 1)], '↓ in the first line: in the text')
			e = key('ArrowUp')
			assert.deepEqual([e.defaultPrevented, at()], [true, cell(1, 0)], '↑ in the first line: above')
			open(22)
			e = key('ArrowDown')
			assert.deepEqual([e.defaultPrevented, at()], [true, cell(1, 2)], '↓ in the last (wrapped) line: below')
			assert.ok(mirrors.length >= 4, mirrors.length + ' mirrors')
			for (const m of mirrors) {
				assert.equal(m.parentNode, null, 'the mirror is gone')
				assert.equal(m.getAttribute('aria-hidden'), 'true')
				assert.deepEqual(['visibility', 'pointer-events', 'position', 'width', 'font-size', 'white-space', 'overflow-wrap'].map((k) => m.style.getPropertyValue(k)),
					['hidden', 'none', 'absolute', '144px', '16px', 'x-white-space', 'x-overflow-wrap'])
				assert.ok(m.children.every((c) => c.tagName === 'SPAN' && c.textContent.endsWith('\u200B')), 'text only through textContent: one marker')
			}
			// a marker of height 0: no layout, only "\n" counts (none here: ↑ jumps from the third line)
			height = 0
			open(25)
			e = key('ArrowUp')
			assert.deepEqual([e.defaultPrevented, at()], [true, cell(1, 0)], 'height 0: the "\\n" rule')
		} finally {
			delete FakeElement.prototype.getClientRects
			delete window.getComputedStyle
		}
	})
})
