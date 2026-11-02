/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 231 (redesign V8, AK4, AK5): the lighter selection in the
 * scene, with the real SceneManager, InputController and GestureController
 * on the fake DOM (sceneHarness.mjs, camera {0, 0, 1}).
 * - the mouse reveals the rotation handle near the top right corner and a
 *   connection point near its edge; handles() lists every usable handle
 *   with shown and size, the renderer gets only the drawn ones
 * - a pen or a finger shows every handle at 14 px (setHandles touch);
 *   before the first event matchMedia('(pointer: coarse)') decides
 * - a text item: sides l/r, no plus-l/plus-r
 * - the connector tool: the four points of the one selected note, drawn,
 *   never hit as handles (its press snaps to the anchor)
 * - a rotation keeps the rotation handle, a resize hides it
 * - the color: --color-primary-element of the container (selectionColorOf)
 * - risks: a finger in the middle of a selected note still drags it; the
 *   corner br of a note 40 px on screen stays reachable
 */
import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { SELECTION_COLOR } from '../../../src/model/tokens.js'
import { callsOf, note, setupScene, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const T = '01JA0000000000000000000004'

let h = null
const saved = {}
afterEach(() => {
	h?.restore()
	h = null
	for (const k of ['getComputedStyle', 'matchMedia']) {
		if (k in saved) {
			if (saved[k]) Object.defineProperty(globalThis, k, saved[k])
			else delete globalThis[k]
			delete saved[k]
		}
	}
})

/** Sets a global for one test (getComputedStyle, matchMedia). */
function stubGlobal(k, v) {
	if (!(k in saved)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k)
	Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
}

/** A note A (100, 100, 200 × 200) selected, a note B (600, 100): A's drawn frame is (96, 96)–(304, 304). */
function setup(items = [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100 })], sel = [A]) {
	h = setupScene(items)
	h.scene.setSelection(sel)
	h.frame()
}

const hover = (x, y, props = {}) => {
	h.pointer('pointermove', x, y, { buttons: 0, ...props })
	h.frame()
}
/** @return {string[]} the names handles() reports as drawn, sorted */
const shown = () => h.scene.handles().filter((x) => x.shown).map((x) => x.name).sort()
/** @return {object} the last setHandles argument */
const lastDrawn = () => callsOf('setHandles').at(-1)[0]
const CORNERS = ['bl', 'br', 'tl', 'tr']

describe('AK4: the mouse reveals rot and the points', () => {
	test('no hover: the four corners drawn, rot and the points usable but not drawn; the renderer gets the corners', () => {
		setup()
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['tl', 'tr', 'br', 'bl', 'rot', 'plus-t', 'plus-r', 'plus-b', 'plus-l'])
		assert.deepEqual(shown(), CORNERS)
		assert.deepEqual(lastDrawn().handles.map((x) => x.name), ['tl', 'tr', 'br', 'bl'])
		assert.equal(lastDrawn().touch, false)
		// job 262: the transformer handles 12 px, the points 10
		assert.ok(h.scene.handles().every((x) => x.size === (x.name.startsWith('plus-') ? 10 : 12)), 'the mouse size')
	})

	test('10 px right of the right edge: plus-r drawn, plus-l not; near the top right corner: rot, no point; the middle: corners only', () => {
		setup()
		hover(314, 200)
		assert.deepEqual(shown(), [...CORNERS, 'plus-r'].sort())
		assert.deepEqual(lastDrawn().handles.map((x) => x.name).sort(), [...CORNERS, 'plus-r'].sort())
		hover(314, 86)
		assert.deepEqual(shown(), [...CORNERS, 'rot'].sort())
		hover(200, 200)
		assert.deepEqual(shown(), CORNERS)
	})

	test('the renderer hears of the hover only when what is drawn changes', () => {
		setup()
		hover(314, 200)
		const n = callsOf('setHandles').length
		hover(312, 190)
		hover(310, 210)
		assert.equal(callsOf('setHandles').length, n, 'still plus-r only')
		// off the edge, outside the note (its reaction row would sync the handles on its own)
		hover(330, 380)
		assert.equal(callsOf('setHandles').length, n + 1)
		assert.deepEqual(lastDrawn().handles.map((x) => x.name), ['tl', 'tr', 'br', 'bl'])
	})

	test('leaving the canvas hides rot and the points again', () => {
		setup()
		hover(314, 200)
		assert.ok(shown().includes('plus-r'))
		h.pointer('pointerleave', 900, 200, { buttons: 0 })
		h.frame()
		assert.deepEqual(shown(), CORNERS)
	})

	test('a click on the revealed plus-r still gives the neighbour', () => {
		setup()
		hover(304, 200)
		h.pointer('pointerdown', 304, 200)
		h.pointer('pointerup', 304, 200)
		h.frame()
		assert.deepEqual(h.intents().map((i) => [i.type, i.id, i.side]), [['neighbour', A, 'r']])
	})

	test('a rotation keeps rot drawn; a resize from tr does not show it', () => {
		setup()
		hover(320, 80)
		h.pointer('pointerdown', 320, 80)
		h.pointer('pointermove', 400, 200)
		h.frame()
		assert.equal(h.scene.stats().transforming, true)
		assert.ok(lastDrawn().handles.some((x) => x.name === 'rot'), 'rot during the rotation')
		h.pointer('pointerup', 400, 200)
		h.frame()
		assert.equal(h.intents('transform').length, 1)
		h.restore()
		setup()
		hover(304, 96)
		assert.ok(shown().includes('rot'), 'tr lies in the zone of rot')
		h.pointer('pointerdown', 304, 96)
		h.pointer('pointermove', 340, 60)
		h.frame()
		assert.equal(h.scene.stats().transforming, true)
		assert.equal(lastDrawn().handles.some((x) => x.name === 'rot'), false, 'no rot during a resize')
	})
})

describe('AK3: the points on the frame', () => {
	for (const scale of [1, 0.5]) {
		test(`zoom ${scale}: each point SELECTION_GAP_PX outside the middle of its edge; none inside a note 20 units beside`, () => {
			setup([note(A, { x: 100, y: 100 }), note(B, { x: 320, y: 100 })])
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.frame()
			const at = Object.fromEntries(h.scene.handles().map((x) => [x.name, [x.x, x.y]]))
			const s = (v) => v * scale
			assert.deepEqual(at['plus-r'], [s(300) + 4, s(200)])
			assert.deepEqual(at['plus-l'], [s(100) - 4, s(200)])
			assert.deepEqual(at['plus-t'], [s(200), s(100) - 4])
			assert.deepEqual(at['plus-b'], [s(200), s(300) + 4])
			// B covers x ≥ 320 (screen s(320)): no point of A lies in it
			for (const [name, [x, y]] of Object.entries(at)) {
				if (!name.startsWith('plus-')) continue
				assert.ok(!(x >= s(320) && x <= s(520) && y >= s(100) && y <= s(300)), `${name} not on B`)
			}
		})
	}
})

describe('AK4: pen and finger', () => {
	test('a pen hovering: every handle drawn at 16 px, the points at 14 (touch, job 262); the mouse again: back to the mouse look', () => {
		setup()
		hover(700, 600, { pointerType: 'pen', pointerId: 3 })
		assert.deepEqual(shown(), ['bl', 'br', 'plus-b', 'plus-l', 'plus-r', 'plus-t', 'rot', 'tl', 'tr'])
		assert.ok(h.scene.handles().every((x) => x.size === (x.name.startsWith('plus-') ? 14 : 16)))
		assert.equal(lastDrawn().touch, true)
		assert.equal(lastDrawn().handles.length, 9)
		hover(700, 600)
		assert.deepEqual(shown(), CORNERS)
		assert.equal(lastDrawn().touch, false)
	})

	test('a finger tap on the selected note: every handle drawn at 16 px, the points at 14 (job 262)', () => {
		setup()
		h.pointer('pointerdown', 200, 200, { pointerType: 'touch', pointerId: 5 })
		h.pointer('pointerup', 200, 200, { pointerType: 'touch', pointerId: 5 })
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.equal(shown().length, 9)
		assert.ok(h.scene.handles().every((x) => x.size === (x.name.startsWith('plus-') ? 14 : 16)))
	})

	test('matchMedia (pointer: coarse) before the first event: the touch look at once', () => {
		stubGlobal('matchMedia', (q) => ({ matches: q === '(pointer: coarse)' }))
		setup()
		assert.equal(shown().length, 9)
		assert.equal(lastDrawn().touch, true)
	})

	test('risk: a finger in the middle of the selected note still drags the note, no connector', () => {
		setup()
		const f = { pointerType: 'touch', pointerId: 5 }
		h.pointer('pointerdown', 200, 200, f)
		h.pointer('pointermove', 260, 230, f)
		h.frame()
		h.pointer('pointermove', 300, 260, f)
		h.frame()
		h.pointer('pointerup', 300, 260, f)
		h.frame()
		assert.equal(h.intents('connect').length, 0)
		assert.equal(h.intents('neighbour').length, 0)
		assert.equal(h.intents('move').length, 1)
	})

	test('risk: a note 40 px on screen (scale 0.2): a finger on br resizes it', () => {
		setup()
		h.scene.setCamera({ x: 0, y: 0, scale: 0.2 })
		h.frame()
		const br = h.scene.handles().find((x) => x.name === 'br')
		const f = { pointerType: 'touch', pointerId: 5 }
		h.pointer('pointerdown', br.x, br.y, f)
		h.pointer('pointermove', br.x + 20, br.y + 20, f)
		h.frame()
		assert.equal(h.scene.stats().transforming, true)
		h.pointer('pointerup', br.x + 20, br.y + 20, f)
		h.frame()
		assert.ok(h.intents('transform')[0].after.get(A).w > 200)
	})
})

describe('AK4: text item and connector tool', () => {
	test('a text item: corners, sides l/r and rot; the points t/b only', () => {
		setup([textItem(T, { x: 100, y: 100, w: 300, h: 45 })], [T])
		const names = h.scene.handles().map((x) => x.name)
		assert.deepEqual(names, ['tl', 'tr', 'r', 'br', 'bl', 'l', 'rot', 'plus-t', 'plus-b'])
		assert.ok(shown().includes('l') && shown().includes('r'), 'the sides always drawn')
	})

	test('the connector tool: exactly the four points of the selected note, drawn; a click there creates nothing, a drag connects from that anchor', () => {
		setup()
		h.scene.setTool('connector')
		h.frame()
		assert.deepEqual(h.scene.handles().map((x) => [x.name, x.x, x.y, x.shown]),
			[['plus-t', 200, 96, true], ['plus-r', 304, 200, true], ['plus-b', 200, 304, true], ['plus-l', 96, 200, true]])
		assert.deepEqual(lastDrawn().handles.map((x) => x.name), ['plus-t', 'plus-r', 'plus-b', 'plus-l'])
		h.pointer('pointerdown', 304, 200)
		h.pointer('pointerup', 304, 200)
		h.frame()
		assert.deepEqual(h.intents(), [], 'a click with the connector tool creates nothing (no neighbour)')
		h.pointer('pointerdown', 304, 200)
		h.pointer('pointermove', 500, 210)
		h.frame()
		h.pointer('pointermove', 700, 200)
		h.frame()
		h.pointer('pointerup', 700, 200)
		h.frame()
		const c = h.intents('connect')
		assert.equal(c.length, 1)
		assert.deepEqual([c[0].start, c[0].end.item], [{ item: A, ax: 1, ay: 0.5 }, B])
	})

	test('the connector tool with a text item: all four points; several items or none: nothing', () => {
		setup([textItem(T, { x: 100, y: 100, w: 300, h: 45 }), note(A, { x: 100, y: 400 })], [T])
		h.scene.setTool('connector')
		assert.deepEqual(h.scene.handles().map((x) => x.name), ['plus-t', 'plus-r', 'plus-b', 'plus-l'])
		h.scene.setSelection([T, A])
		assert.deepEqual(h.scene.handles(), [])
		h.scene.setTool('hand')
		h.scene.setSelection([A])
		assert.deepEqual(h.scene.handles(), [])
	})
})

describe('AK5: the selection color', () => {
	test('--color-primary-element of the container goes to the renderer at mount', () => {
		stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n) => (n === '--color-primary-element' ? ' #00679e' : '') }))
		setup()
		assert.deepEqual(callsOf('setSelectionColor'), [['#00679e']])
	})

	test('a light primary color (dark theme) and no getComputedStyle: SELECTION_COLOR', () => {
		stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#a0c8e0' }))
		setup()
		assert.deepEqual(callsOf('setSelectionColor'), [[SELECTION_COLOR]])
		h.restore()
		delete globalThis.getComputedStyle
		setup()
		assert.deepEqual(callsOf('setSelectionColor'), [[SELECTION_COLOR]])
	})
})
