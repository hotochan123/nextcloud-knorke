/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Facade v2 of the scene (SPEC-M1 §6.3), deterministic in Node on the fake
 * DOM: setTool(tool, options) / getToolOptions with registry-checked option
 * values, the create intents of the shape and text tools (data from the tool
 * options, rect by dragging, text: the drag sets the wrap width), the
 * connector tool (1b: a click creates nothing; the drags are in
 * connect.test.mjs), the constructor's mode alias, isActive
 * of a transformed frame's children, and transforms dropped without an
 * intent by reset() or by the removal of a transformed item.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../../../src/scene/index.js'
import { TOOL_IDS } from '../../../src/model/tools.js'
import { frameItem, note, setupScene, shapeItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const F = '01JA0000000000000000000009'

let h
afterEach(() => {
	h?.restore()
	h = null
})

describe('tools', () => {
	test('TOOLS of the scene entry = the tool ids of src/model/tools.js', () => {
		assert.deepEqual(TOOLS, TOOL_IDS)
	})

	test('setTool(tool, options): options are kept per tool, unknown values ignored, copies handed out', () => {
		h = setupScene([])
		assert.deepEqual(h.scene.getToolOptions('shape'), { kind: 'rect' })
		assert.deepEqual(h.scene.getToolOptions('connector'), { route: 'straight', endCap: 'arrow' })
		assert.equal(h.scene.getToolOptions('sticky'), null)
		h.scene.setTool('shape', { kind: 'diamond', color: 'x' })
		assert.equal(h.scene.getTool(), 'shape')
		h.scene.setTool('shape', { kind: 'hexagon' })
		assert.deepEqual(h.scene.getToolOptions('shape'), { kind: 'diamond' })
		h.scene.setTool('connector', { route: 'elbow', endCap: 'dot' })
		h.scene.setTool('connector', { route: 'zigzag' })
		assert.deepEqual(h.scene.getToolOptions('connector'), { route: 'elbow', endCap: 'dot' })
		h.scene.getToolOptions('shape').kind = 'ellipse'
		assert.equal(h.scene.getToolOptions('shape').kind, 'diamond')
		h.scene.setTool('pen')
		assert.equal(h.scene.getTool(), 'connector', 'unknown tool ignored')
		assert.equal(h.log.filter((e) => e[0] === 'onTool').length, 0, 'no echo for shell calls')
	})

	test('shape tool: a drag creates with rect and the kind option; a click with rect null; the tool falls back', () => {
		h = setupScene([])
		h.scene.setTool('shape', { kind: 'ellipse' })
		h.pointer('pointerdown', 100, 100)
		h.pointer('pointermove', 200, 160)
		h.pointer('pointermove', 300, 220)
		h.pointer('pointerup', 300, 220)
		h.scene.setTool('shape')
		h.pointer('pointerdown', 500, 500)
		h.pointer('pointerup', 503, 502)
		const c = h.intents('create')
		assert.deepEqual(c[0], { type: 'create', t: 'shape', at: { x: 100, y: 100 }, rect: { x: 100, y: 100, w: 200, h: 120 }, data: { kind: 'ellipse' } })
		assert.deepEqual(c[1].rect, null)
		assert.deepEqual(c[1].data, { kind: 'ellipse' }, 'the option stays')
		assert.deepEqual(h.log.filter((e) => e[0] === 'onTool').map((e) => e[1]), ['select', 'select'])
	})

	test('text tool: a click creates with rect null, a drag sets the wrap width; too small = click', () => {
		h = setupScene([])
		h.scene.setTool('text')
		h.pointer('pointerdown', 100, 100)
		h.pointer('pointerup', 100, 100)
		h.scene.setTool('text')
		h.pointer('pointerdown', 100, 300)
		h.pointer('pointermove', 400, 310)
		h.pointer('pointerup', 400, 310)
		h.scene.setTool('text')
		h.pointer('pointerdown', 100, 500)
		h.pointer('pointermove', 110, 500)
		h.pointer('pointerup', 110, 500)
		const c = h.intents('create')
		assert.deepEqual(c.map((x) => [x.t, x.rect && x.rect.w]), [['text', null], ['text', 300], ['text', null]])
		assert.equal('data' in c[0], false)
	})

	test('connector tool: crosshair; a click creates nothing, selects nothing and keeps the tool; a drag connects', () => {
		h = setupScene([note(A)])
		h.scene.setTool('connector')
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'crosshair')
		h.pointer('pointerdown', 100, 100)
		h.pointer('pointerup', 100, 100)
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.scene.getSelection(), [])
		assert.equal(h.scene.getTool(), 'connector')
		h.pointer('pointerdown', 100, 100)
		h.pointer('pointermove', 400, 400)
		h.pointer('pointerup', 400, 400)
		assert.deepEqual(h.intents().map((i) => [i.type, i.start, i.end]), [['connect', { item: A }, { x: 400, y: 400 }]])
	})
})

describe('constructor and isActive', () => {
	test('mode: view → view-only, edit → editable; viewOnly stays the M0 alias', () => {
		h = setupScene([], { scene: { mode: 'view' } })
		assert.equal(h.scene.stats().viewOnly, true)
		h.restore()
		h = setupScene([], { scene: { mode: 'edit' } })
		assert.equal(h.scene.stats().viewOnly, false)
		h.restore()
		h = setupScene([], { scene: { viewOnly: true, mode: 'edit' } })
		assert.equal(h.scene.stats().viewOnly, true)
	})

	test('a transformed frame: the frame and its children are active until the transform ends', () => {
		h = setupScene([frameItem(F, { x: 0, y: 100 }), note(A, { x: 10, y: 10, parent: F })])
		h.scene.setSelection([F])
		const br = h.scene.handles().find((x) => x.name === 'br')
		h.pointer('pointerdown', br.x, br.y)
		h.pointer('pointermove', br.x + 30, br.y + 30)
		h.frame()
		assert.ok(h.scene.isActive(F) && h.scene.isActive(A))
		h.pointer('pointerup', br.x + 30, br.y + 30)
		assert.ok(!h.scene.isActive(F) && !h.scene.isActive(A))
	})
})

describe('transform dropped without an intent', () => {
	test('reset() (resync) during a transform: no intent, activity ends, the press is gone', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.pointer('pointerdown', 300, 220)
		h.pointer('pointermove', 340, 260)
		h.frame()
		h.model.load([shapeItem(A, { x: 100, y: 100 })])
		h.scene.reset()
		h.pointer('pointermove', 380, 300)
		h.pointer('pointerup', 380, 300)
		assert.deepEqual(h.intents('transform'), [])
		assert.deepEqual(h.log.filter((e) => e[0] === 'onActivity').map((e) => [e[1].kind, e[1].active]), [['transform', true], ['transform', false]])
		assert.equal(h.scene.stats().transforming, false)
	})

	test('the transformed item is removed remotely: no intent, activity ends', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.pointer('pointerdown', 300, 220)
		h.pointer('pointermove', 340, 260)
		h.frame()
		h.scene.update(h.model.apply({ removes: [A] }))
		h.pointer('pointerup', 340, 260)
		assert.deepEqual(h.intents('transform'), [])
		assert.equal(h.scene.stats().transforming, false)
		assert.deepEqual(h.scene.handles(), [])
	})

	test('setViewOnly(true) during a transform cancels it like Esc (model back)', () => {
		h = setupScene([shapeItem(A, { x: 100, y: 100 })])
		h.scene.setSelection([A])
		h.pointer('pointerdown', 300, 220)
		h.pointer('pointermove', 340, 260)
		h.frame()
		h.scene.setViewOnly(true)
		h.pointer('pointerup', 340, 260)
		assert.deepEqual(h.intents('transform'), [])
		assert.equal(h.model.get(A).w, 200)
	})
})
