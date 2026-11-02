/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 273, the pen tool in the scene (real SceneManager,
 * InputController, GestureController and SceneModel on the fake DOM, the
 * renderer stubbed):
 * - AK3: a stroke with the mouse or the pen is one intent stroke with the
 *   tool's kind, colour and width and its points in world units; the tool
 *   stays, nothing is selected; the options per kind; key P.
 * - AK4: the finger draws until a pen was seen, then it pans; Esc,
 *   pointercancel and a second finger drop the stroke without an intent;
 *   Esc without a stroke chooses select.
 * - AK5: the eraser deletes exactly the strokes its path touches, in one
 *   intent, never a locked one or another type; Esc deletes nothing.
 * - hit mode 'ink': a click on the line selects the stroke, beside it in its
 *   box hits nothing.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, setupScene, shapeItem } from './sceneHarness.mjs'

const S1 = '01JA0000000000000000000011'
const S2 = '01JA0000000000000000000012'
const S3 = '01JA0000000000000000000013'
const SH = '01JA0000000000000000000014'

const MOUSE = Object.freeze({ pointerType: 'mouse', pointerId: 1 })
const PEN = Object.freeze({ pointerType: 'pen', pointerId: 9 })
const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })

/** A horizontal stroke from (x, y) 200 long, 4 wide. */
const stroke = (id, x, y, o = {}) => ({
	id, t: 'pen', x: x - 2, y: y - 2, w: 204, h: 4, r: 0, z: 'b' + id.slice(-2), parent: null,
	data: { kind: 'pen', points: [2, 2, 202, 2] }, style: { stroke: '#191b1d', strokeWidth: 4 }, ...o,
})

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

function setup(items = [], options = null) {
	h = setupScene(items)
	h.scene.setTool('pen', options)
	h.log.length = 0
	return h
}

/** Down at path[0], a move and a frame per further point, up at the last. */
function draw(dev, path) {
	h.pointer('pointerdown', path[0][0], path[0][1], dev)
	h.frame()
	for (const [x, y] of path.slice(1)) {
		h.pointer('pointermove', x, y, dev)
		h.frame()
	}
	const [x1, y1] = path[path.length - 1]
	h.pointer('pointerup', x1, y1, dev)
	h.frame()
}

const of = (name) => h.log.filter((e) => e[0] === name)

describe('job 273 AK3: a stroke is one intent, the tool stays', () => {
	for (const [name, dev] of [['mouse', MOUSE], ['pen', PEN]]) {
		test(`${name}: points in world units, black medium pen, nothing selected`, () => {
			setup()
			h.scene.setCamera({ x: 100, y: 50, scale: 2 })
			h.frame()
			h.log.length = 0
			draw(dev, [[100, 100], [140, 100], [140, 160]])
			const s = h.intents('stroke')
			assert.equal(s.length, 1)
			assert.deepEqual(s[0], { type: 'stroke', points: [150, 100, 170, 100, 170, 130], kind: 'pen', stroke: '#191b1d', strokeWidth: 4 })
			assert.equal(h.intents().length, 1, 'no other intent')
			assert.equal(h.scene.getTool(), 'pen')
			assert.deepEqual(of('onSelection'), [])
			assert.equal(h.scene.stats().ink, null)
		})
	}

	test('a tap gives a single point', () => {
		setup()
		draw(MOUSE, [[300, 300]])
		assert.deepEqual(h.intents('stroke')[0].points, [300, 300])
	})

	test('the highlighter and the options per kind; a width or colour outside the kind\'s list is ignored', () => {
		setup([], { penKind: 'marker' })
		draw(MOUSE, [[10, 10], [60, 10]])
		assert.deepEqual(h.intents('stroke')[0], { type: 'stroke', points: [10, 10, 60, 10], kind: 'marker', stroke: '#faea89', strokeWidth: 20 })
		h.scene.setTool('pen', { markerWidth: 32, markerColor: '#a2d9fe', penWidth: 5, penColor: '#123456' })
		assert.deepEqual(h.scene.getToolOptions('pen'), { penKind: 'marker', penColor: '#191b1d', penWidth: 4, markerColor: '#a2d9fe', markerWidth: 32 })
		h.scene.setTool('pen', { penKind: 'pen', penWidth: 8, penColor: '#c43e45' })
		h.log.length = 0
		draw(PEN, [[10, 10], [60, 10]])
		assert.deepEqual(h.intents('stroke')[0], { type: 'stroke', points: [10, 10, 60, 10], kind: 'pen', stroke: '#c43e45', strokeWidth: 8 })
		assert.equal(h.scene.getToolOptions('pen').penKind, 'pen', 'the kind stays after a stroke')
	})

	test('while it runs: stats().ink, the crosshair; key P chooses the pen', () => {
		h = setupScene([])
		h.focusCanvas()
		h.key('p')
		assert.equal(h.scene.getTool(), 'pen')
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'crosshair')
		h.pointer('pointerdown', 10, 10, MOUSE)
		h.pointer('pointermove', 30, 10, MOUSE)
		assert.deepEqual(h.scene.stats().ink, { kind: 'pen', points: 2, erasing: [] })
		h.pointer('pointerup', 30, 10, MOUSE)
		assert.equal(h.scene.stats().ink, null)
	})

	test('a long scribble reaches the session with at most 500 points', () => {
		setup()
		const path = []
		for (let i = 0; i < 3000; i++) path.push([10 + (i % 300) * 3, 10 + Math.floor(i / 300) * 7 + (i % 2) * 3])
		h.pointer('pointerdown', path[0][0], path[0][1], MOUSE)
		for (const [x, y] of path.slice(1)) h.pointer('pointermove', x, y, MOUSE)
		h.pointer('pointerup', path.at(-1)[0], path.at(-1)[1], MOUSE)
		const pts = h.intents('stroke')[0].points
		assert.ok(pts.length >= 4 && pts.length <= 1000, String(pts.length))
	})
})

describe('job 273 AK4: fingers, Esc, cancel', () => {
	test('without a pen seen the finger draws; after a pen hover it pans', () => {
		setup()
		draw(finger(5), [[100, 100], [150, 120]])
		assert.equal(h.intents('stroke').length, 1, 'the finger drew')
		h.log.length = 0
		h.pointer('pointermove', 500, 500, PEN)
		const cam = h.scene.getCamera()
		draw(finger(6), [[100, 100], [150, 120], [200, 140]])
		assert.deepEqual(h.intents(), [], 'no stroke')
		assert.notDeepEqual(h.scene.getCamera(), cam, 'the finger panned')
	})

	test('Esc during a stroke drops it, the tool stays; Esc again chooses select', () => {
		setup()
		h.pointer('pointerdown', 100, 100, MOUSE)
		h.pointer('pointermove', 160, 100, MOUSE)
		h.key('Escape')
		assert.equal(h.scene.stats().ink, null)
		h.pointer('pointerup', 160, 100, MOUSE)
		assert.deepEqual(h.intents(), [])
		assert.equal(h.scene.getTool(), 'pen')
		h.focusCanvas()
		h.key('Escape')
		assert.equal(h.scene.getTool(), 'select')
	})

	test('pointercancel and a second finger drop the stroke without an intent', () => {
		setup()
		h.pointer('pointerdown', 100, 100, MOUSE)
		h.pointer('pointermove', 160, 100, MOUSE)
		h.pointer('pointercancel', 160, 100, MOUSE)
		h.pointer('pointerup', 160, 100, MOUSE)
		h.pointer('pointerdown', 100, 100, finger(5))
		h.pointer('pointermove', 150, 100, finger(5))
		h.pointer('pointerdown', 400, 400, finger(6))
		h.pointer('pointerup', 150, 100, finger(5))
		h.pointer('pointerup', 400, 400, finger(6))
		assert.deepEqual(h.intents(), [])
	})

	test('another tool or mode vote during a stroke drops it', () => {
		setup()
		h.pointer('pointerdown', 100, 100, MOUSE)
		h.pointer('pointermove', 160, 100, MOUSE)
		h.scene.setTool('select')
		h.pointer('pointerup', 160, 100, MOUSE)
		h.scene.setTool('pen')
		h.pointer('pointerdown', 100, 100, MOUSE)
		h.pointer('pointermove', 160, 100, MOUSE)
		h.scene.setMode('vote')
		h.pointer('pointerup', 160, 100, MOUSE)
		assert.deepEqual(h.intents(), [])
	})
})

describe('job 273 AK5: the eraser', () => {
	const items = () => [stroke(S1, 100, 300), stroke(S2, 100, 400), shapeItem(SH, { x: 100, y: 500, z: 'b9' }),
		stroke(S3, 100, 450, { lock: { by: 'p1', name: 'Al' } })]

	test('a path over two strokes, a locked one and a shape deletes exactly the two, in one intent; the renderer hides them meanwhile', () => {
		setup(items(), { penKind: 'eraser' })
		draw(MOUSE, [[200, 250], [200, 350], [200, 430], [200, 470], [200, 560], [200, 700]])
		assert.deepEqual(h.intents(), [{ type: 'delete', ids: [S1, S2] }])
		const hidden = callsOf('setErasing').map((c) => c[0])
		assert.deepEqual(hidden.filter((x) => x !== null).at(-1), [S1, S2])
		assert.equal(hidden.at(-1), null, 'shown again at the release')
	})

	test('a path beside every stroke deletes nothing; Esc deletes nothing', () => {
		setup(items(), { penKind: 'eraser' })
		draw(MOUSE, [[400, 250], [400, 350]])
		assert.deepEqual(h.intents(), [])
		h.pointer('pointerdown', 200, 250, MOUSE)
		h.pointer('pointermove', 200, 350, MOUSE)
		assert.deepEqual(h.scene.stats().ink.erasing, [S1])
		h.key('Escape')
		h.pointer('pointerup', 200, 350, MOUSE)
		assert.deepEqual(h.intents(), [])
		assert.equal(callsOf('setErasing').at(-1)[0], null)
	})
})

describe('job 273: hit mode ink', () => {
	test('with select a click on the line selects the stroke, beside it in its box nothing', () => {
		h = setupScene([stroke(S1, 100, 300, { h: 100, data: { kind: 'pen', points: [2, 2, 202, 2, 202, 98] } })])
		h.log.length = 0
		h.pointer('pointerdown', 150, 301, MOUSE)
		h.pointer('pointerup', 150, 301, MOUSE)
		assert.deepEqual(h.scene.getSelection(), [S1])
		h.pointer('pointerdown', 150, 360, MOUSE)
		h.pointer('pointerup', 150, 360, MOUSE)
		assert.deepEqual(h.scene.getSelection(), [], 'inside the box but far from the line: empty canvas')
	})
})
