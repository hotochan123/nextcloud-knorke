/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 265 (redesign round 4, T3): tables with round clipped corners, a
 * 1.5 screen px border, lighter lines down than across, the header column
 * switch and the cell editor in the theme's selection colour.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from './sceneHarness.mjs'
import { dispatch } from './fakeDom.mjs'
import { table as tableSpec, tableRadius } from '../../../src/scene/nodes/table.js'
import { estimateCellHeight, isHeadCell, tableLayout } from '../../../src/model/table.js'
import { TABLE_FILL, TABLE_HEADER_FILL, TABLE_STROKE, mixColor, tableLines } from '../../../src/model/tokens.js'
import { fieldDefault } from '../../../src/model/registry.js'

const T = '01JA00000000000000000000T1'
const C = ['c00000001', 'c00000002', 'c00000003']
const R = ['r00000001', 'r00000002', 'r00000003']
const cell = (c, r) => C[c] + '.' + R[r]
const LONG = 'abcdefghijklmnop'

/** A 3 × 3 table at (100, 100), 480 × 108; o: overrides, style: its style. */
function tableItem(o = {}) {
	return {
		id: T, t: 'table', x: 100, y: 100, w: 480, h: 108, r: 0, z: 'a5', parent: null,
		data: {
			cols: Object.fromEntries(C.map((k, i) => [k, { o: 'i' + i, w: 160 }])),
			rows: Object.fromEntries(R.map((k, i) => [k, { o: 'i' + i }])),
			cells: { [C[0]]: { [R[0]]: 'Name', [R[1]]: LONG }, [C[1]]: { [R[1]]: 'x' } },
		},
		style: {},
		...o,
	}
}

/** A fake Konva: nodes keep their attrs and children. */
function fakeCtx() {
	class Node {
		constructor(a = {}) {
			this.attrs = { ...a }
			this.kids = []
		}

		setAttrs(a) { Object.assign(this.attrs, a) }
		getAttr(k) { return this.attrs[k] }
		visible(v) { this.attrs.visible = v }
		transformsEnabled() {}
		add(...k) { this.kids.push(...k) }
		destroy() { this.destroyed = true }
	}
	return { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {}, Line: class extends Node {} }
}

/** A context that records its path calls. */
function recorder() {
	const calls = []
	const rec = (name) => (...a) => calls.push([name, ...a])
	return { calls, beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'), closePath: rec('closePath'), rect: rec('rect'), strokeShape: rec('strokeShape') }
}

const build = (item) => tableSpec.build(fakeCtx(), item, { x: 100, y: 100, w: item.w, h: item.h, r: 0 }, 0, false)

describe('job 265 AK1–AK3: clip, border and lines', () => {
	test('the body is clipped to the box with corners 6 (at most half a side), the ground has the same radius', () => {
		const e = build(tableItem())
		const { body, bg, border } = e.parts
		assert.equal(typeof body.attrs.clipFunc, 'function')
		const c = recorder()
		body.attrs.clipFunc(c, body)
		const arcs = c.calls.filter((x) => x[0] === 'arc')
		assert.equal(arcs.length, 4)
		assert.ok(arcs.every((x) => x[3] === 6), 'radius 6')
		assert.deepEqual([bg.attrs.cornerRadius, bg.attrs.fill], [6, TABLE_FILL])
		assert.equal(tableRadius(480, 10), 5, 'a low table: half its height')
		assert.ok(body.kids.includes(bg) && !body.kids.includes(border), 'the border is outside the clip')
		assert.deepEqual(e.root.kids, [body, border], 'the border above the body')
	})

	test('the outer border: style.stroke (default #a9adb2), 1.5 screen px, round corners', () => {
		const { border } = build(tableItem()).parts
		assert.equal(TABLE_STROKE, '#a9adb2')
		assert.deepEqual([border.attrs.stroke, border.attrs.strokeWidth, border.attrs.strokeScaleEnabled, border.attrs.cornerRadius, border.attrs.fill],
			['#a9adb2', 1.5, false, 6, undefined])
	})

	test('lines across #d5d8dc at the row bounds, down #e9ebee at the column bounds, 1 unit; another border colour mixes', () => {
		const e = build(tableItem())
		const { linesH, linesV } = e.parts
		const rows = e.layout.rows.slice(1).map((r) => r.y)
		assert.deepEqual([linesH.attrs.stroke, linesH.attrs.strokeWidth, linesH.attrs.ys, linesH.attrs.xs], ['#d5d8dc', 1, rows, []])
		assert.deepEqual([linesV.attrs.stroke, linesV.attrs.strokeWidth, linesV.attrs.xs, linesV.attrs.ys], ['#e9ebee', 1, [160, 320], []])
		const c = recorder()
		linesV.attrs.sceneFunc(c, linesV)
		assert.deepEqual(c.calls.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo'), [['moveTo', 160, 0], ['lineTo', 160, e.layout.h], ['moveTo', 320, 0], ['lineTo', 320, e.layout.h]])
		assert.equal(c.calls.some((x) => x[0] === 'rect'), false, 'no outer rectangle in the lines')
		assert.deepEqual(tableLines('#ff0000'), { h: mixColor('#ff0000', '#ffffff', 0.47), v: mixColor('#ff0000', '#ffffff', 0.24) })
		const red = build(tableItem({ style: { stroke: '#ff0000' } })).parts
		assert.deepEqual([red.border.attrs.stroke, red.linesH.attrs.stroke, red.linesV.attrs.stroke], ['#ff0000', tableLines('#ff0000').h, tableLines('#ff0000').v])
	})
})

describe('job 265 AK4, AK8: the header column', () => {
	test('on: the first column over the full height in the header fill, its texts bold and measured bold', () => {
		const item = tableItem({ style: { headerCol: 'on', headerFill: '#fff6b6' } })
		const e = build(item)
		const { headCol, head, texts } = e.parts
		assert.deepEqual([headCol.attrs.visible, headCol.attrs.width, headCol.attrs.height, headCol.attrs.fill], [true, 160, e.layout.h, head.attrs.fill])
		assert.equal(texts.get(cell(0, 1)).attrs.fontStyle, 'bold')
		assert.equal(texts.get(cell(1, 1)).attrs.fontStyle, 'normal')
		const on = tableLayout(item).rows[1].h
		const off = tableLayout(tableItem()).rows[1].h
		assert.equal(off, 36)
		assert.equal(on, 2 * 16 * 1.2 + 16, 'the long word breaks in bold: two lines')
		assert.ok(estimateCellHeight(LONG, 144, true) > estimateCellHeight(LONG, 144, false))
		assert.equal(isHeadCell(tableLayout(item), cell(0, 2)), true)
		assert.equal(isHeadCell(tableLayout(item), cell(1, 2)), false)
	})

	test('off or missing (an old table, an old border #c6cacf): no header column, normal texts, no error', () => {
		assert.equal(fieldDefault('table', 'style.headerCol'), 'off')
		for (const style of [{}, { headerCol: 'off' }, { stroke: '#c6cacf' }]) {
			const e = build(tableItem({ style }))
			assert.equal(e.parts.headCol.attrs.visible, false)
			assert.equal(e.parts.texts.get(cell(0, 1)).attrs.fontStyle, 'normal')
			assert.equal(e.parts.head.attrs.fill, TABLE_HEADER_FILL)
		}
		const old = build(tableItem({ style: { stroke: '#c6cacf' } })).parts
		assert.deepEqual([old.border.attrs.stroke, old.linesH.attrs.stroke], ['#c6cacf', tableLines('#c6cacf').h])
	})

	test('update switches the header column on and off', () => {
		const ctx = fakeCtx()
		const e = tableSpec.build(ctx, tableItem(), { x: 100, y: 100, w: 480, h: 108, r: 0 }, 0, false)
		tableSpec.update(ctx, e, tableItem({ style: { headerCol: 'on' } }), null, new Set(['style']))
		assert.equal(e.parts.headCol.attrs.visible, true)
		assert.equal(e.parts.texts.get(cell(0, 1)).attrs.fontStyle, 'bold')
		tableSpec.update(ctx, e, tableItem(), null, new Set(['style']))
		assert.equal(e.parts.headCol.attrs.visible, false)
	})
})

describe('job 265 AK7: the cell editor in the selection colour', () => {
	let h = null
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
	afterEach(() => {
		h?.restore()
		h = null
		if (saved) Object.defineProperty(globalThis, 'getComputedStyle', saved)
		else delete globalThis.getComputedStyle
	})
	const editor = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null

	test('a cell: 8 % of the theme colour over white and a 2 px inner border in it; a header column cell bold on its tint', () => {
		const primary = '#7a2e8c'
		Object.defineProperty(globalThis, 'getComputedStyle', {
			value: () => ({ getPropertyValue: (n) => (n === '--color-primary-element' ? primary : '') }), configurable: true, writable: true,
		})
		h = setupScene([tableItem({ style: { headerCol: 'on' } })])
		h.frame()
		assert.equal(h.scene.openTextEditor(T, { cell: cell(1, 2) }), true)
		h.frame()
		const ta = editor()
		assert.equal(ta.style.getPropertyValue('background'), mixColor(primary, TABLE_FILL, 0.08))
		assert.equal(ta.style.getPropertyValue('outline'), '2px solid ' + primary)
		assert.equal(ta.style.getPropertyValue('outline-offset'), '-2px')
		assert.equal(ta.style.getPropertyValue('font-weight'), 'normal')
		dispatch(ta, 'keydown', { key: 'Escape' })
		assert.equal(h.scene.openTextEditor(T, { cell: cell(0, 2) }), true)
		h.frame()
		assert.equal(editor().style.getPropertyValue('font-weight'), 'bold')
		assert.equal(editor().style.getPropertyValue('background'), mixColor(primary, TABLE_HEADER_FILL, 0.08))
	})
})
