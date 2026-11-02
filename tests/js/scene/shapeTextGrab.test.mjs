/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The text of a shape without fill grabs the shape (factory job 177), with
 * the real SceneManager, InputController and GestureController on the fake
 * DOM (sceneHarness.mjs, camera {0, 0, 1}). Rectangle S (100, 100, 200 ×
 * 120), fillOpacity 0, stroke width 2, text "Hello" at fontSize 20, center
 * and middle. The stubbed measureShapeLines wraps at the inner text box
 * (184 wide) with GLYPH · 20 = 10 per character, so the block is (175,
 * 148)–(225, 172), the text zone (171, 144)–(229, 176) for the mouse and pen
 * and (163, 136)–(237, 184) for a finger. M = (200, 160) lies on the text,
 * P = (250, 160) in the empty inside beside it. Move ids are compared as
 * sets.
 * - shapeTextBlock: the block by align and valign, none without a line
 * - AK1 mouse and pen, with and without a selection, the edge of the zone,
 *   scale 2
 * - AK2 Shift
 * - AK3 two lines, left/top, a rotated S, a blank text, LOD 1, a text that
 *   arrives by sync
 * - AK4 a note N under S, the double click, the context menu
 * - AK5 a finger (the real GestureController)
 * - AK6 the vote (hitAt) and LOD 2 keep the whole inside
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { InputController } from '../../../src/scene/InputController.js'
import { shapeTextBlock } from '../../../src/scene/nodes/shape.js'
import { LINE_HEIGHT } from '../../../src/model/tokens.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setStubLod, setupScene, shapeItem } from './sceneHarness.mjs'

const S = '01JA00000000000000000000S1'
const N = '01JA00000000000000000000N1'
const A = '01JA0000000000000000000001'
const M = [200, 160]
const P = [250, 160]
const HOLLOW = Object.freeze({ fill: '#ffffff', fillOpacity: 0, stroke: '#1a1a1a', strokeWidth: 2, fontSize: 20 })

let h = null
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
	mock.restoreAll()
})

/**
 * @param {object} [o] fields of S (style and data are merged into the defaults)
 * @return {object} the shape S
 */
const shapeS = (o = {}) => shapeItem(S, {
	x: 100, y: 100, w: 200, h: 120, z: 'a2',
	...o,
	data: { kind: 'rect', text: 'Hello', ...(o.data || {}) },
	style: { ...HOLLOW, ...(o.style || {}) },
})
/** @return {object} the note N (150, 130, 60 × 60) under S */
const noteN = () => note(N, { x: 150, y: 130, w: 60, h: 60, z: 'a1' })
/** @return {object} the note A (400, 100, 200 × 200) beside S */
const noteA = () => note(A, { x: 400, y: 100, w: 200, h: 200, z: 'a3' })

/**
 * A fresh scene with the selection sel.
 *
 * @param {object[]} items WireItems
 * @param {string[]} [sel] selection
 * @param {object} [opts] setupScene options
 * @return {object} sceneHarness
 */
function scene(items, sel = [], opts = {}) {
	h?.restore()
	h = setupScene(items, opts)
	h.scene.setSelection(sel)
	h.frame()
	h.log.length = 0
	return h
}

/** non-null setMarquee calls */
const marquees = () => callsOf('setMarquee').filter((c) => c[0] !== null)
const sorted = (ids) => [...ids].sort()
/** @return {Array<[string[], number, number]>} the move intents: sorted ids, dx, dy */
const moves = () => h.intents('move').map((m) => [sorted(m.ids), m.dx, m.dy])
const sel = () => h.scene.getSelection()
const unpanned = () => assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the camera did not pan')

/**
 * A press at (x, y), moved by (dx, dy) in four frames, released.
 *
 * @param {number} x container x
 * @param {number} y container y
 * @param {number} dx move x
 * @param {number} [dy] move y
 * @param {object} [props] pointer props (pointerType, shiftKey, …)
 */
function drag(x, y, dx, dy = 0, props = {}) {
	h.pointer('pointerdown', x, y, props)
	for (let i = 1; i <= 4; i++) {
		h.pointer('pointermove', x + (dx * i) / 4, y + (dy * i) / 4, props)
		h.frame()
	}
	h.pointer('pointerup', x + dx, y + dy, props)
	h.frame()
}

/**
 * A click at (x, y) without a move.
 *
 * @param {number} x container x
 * @param {number} y container y
 * @param {object} [props] pointer props
 */
function click(x, y, props = {}) {
	h.pointer('pointerdown', x, y, props)
	h.pointer('pointerup', x, y, props)
	h.frame()
}

/**
 * A mouse double click as Chromium sends it: two press pairs, then dblclick.
 *
 * @param {number} x container x
 * @param {number} y container y
 */
function dblclick(x, y) {
	click(x, y)
	click(x, y)
	dispatch(h.container, 'dblclick', { clientX: x, clientY: y, button: 0 })
	h.frame()
}

/**
 * A right click of the mouse: pointerdown (button 2), contextmenu, pointerup.
 *
 * @param {number} x container x
 * @param {number} y container y
 */
function rightClick(x, y) {
	h.pointer('pointerdown', x, y, { button: 2 })
	dispatch(h.container, 'contextmenu', { clientX: x, clientY: y, button: 2, pointerId: 1, pointerType: 'mouse' })
	h.pointer('pointerup', x, y, { button: 2 })
	h.frame()
}

/**
 * The selection a click at (x, y) gives on a fresh scene.
 *
 * @param {object[]} items WireItems
 * @param {number} x container x
 * @param {number} y container y
 * @param {object} [props] pointer props
 * @return {string[]} the selection after the click
 */
function clickOn(items, x, y, props = {}) {
	scene(items)
	click(x, y, props)
	return sel()
}

describe('shapeTextBlock: the block of the drawn lines in the inner text box', () => {
	// text box (0, 0, 200, 120) with padding 8: the inner box (8, 8)–(192, 112), 184 × 104
	const box = (align, valign) => ({ x: 0, y: 0, w: 200, h: 120, pad: 8, fontSize: 20, align, valign })
	const H = 2 * 20 * LINE_HEIGHT

	test('as wide as the widest line, lines × fontSize × LINE_HEIGHT high, placed by align and valign', () => {
		assert.deepEqual(shapeTextBlock(box('left', 'top'), [50, 90]), { x: 8, y: 8, w: 90, h: H })
		assert.deepEqual(shapeTextBlock(box('center', 'middle'), [50, 90]), { x: 55, y: 60 - H / 2, w: 90, h: H })
		assert.deepEqual(shapeTextBlock(box('right', 'bottom'), [50, 90]), { x: 102, y: 112 - H, w: 90, h: H })
	})

	test('the text box of an ellipse is offset; no line gives null', () => {
		assert.deepEqual(shapeTextBlock({ x: 30, y: 20, w: 140, h: 80, pad: 8, fontSize: 10, align: 'left', valign: 'top' }, [40]), { x: 38, y: 28, w: 40, h: 10 * LINE_HEIGHT })
		assert.equal(shapeTextBlock(box('center', 'middle'), []), null)
		assert.equal(shapeTextBlock(box('center', 'middle'), null), null)
	})
})

describe('AK1: mouse and pen', () => {
	for (const pointerType of ['mouse', 'pen']) {
		const props = { pointerType, pointerId: pointerType === 'pen' ? 9 : 1 }

		test(`${pointerType}, nothing selected: a click at M selects [S]; a drag from M by (40, 20) moves {S}, no marquee`, () => {
			assert.deepEqual(clickOn([shapeS()], ...M, props), [S])
			scene([shapeS()])
			drag(...M, 40, 20, props)
			assert.deepEqual(moves(), [[[S], 40, 20]])
			assert.deepEqual(marquees(), [])
		})

		test(`${pointerType}, nothing selected: a click at P selects nothing, a drag from P draws a marquee without a move`, () => {
			assert.deepEqual(clickOn([shapeS()], ...P, props), [])
			scene([shapeS()])
			drag(...P, 40, 20, props)
			assert.ok(marquees().length > 0, 'a marquee')
			assert.deepEqual(h.intents('move'), [])
		})

		test(`${pointerType}: the zone ends 4 px beside the block: (227, 160) selects [S], (232, 160) nothing`, () => {
			assert.deepEqual(clickOn([shapeS()], 227, 160, props), [S])
			assert.deepEqual(clickOn([shapeS()], 232, 160, props), [])
		})

		test(`${pointerType}, S selected: a drag from M moves {S}, a click at P clears the selection`, () => {
			scene([shapeS()], [S])
			drag(...M, 40, 20, props)
			assert.deepEqual(moves(), [[[S], 40, 20]])
			assert.deepEqual(marquees(), [])
			scene([shapeS()], [S])
			click(...P, props)
			assert.deepEqual(sel(), [])
		})
	}

	test('T counts in screen px: at scale 2 a click at screen (456, 320) (world (228, 160)) selects nothing, at scale 1 world (228, 160) selects [S]', () => {
		scene([shapeS()])
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		click(456, 320)
		assert.deepEqual(sel(), [])
		assert.deepEqual(clickOn([shapeS()], 228, 160), [S])
	})
})

describe('AK2: Shift', () => {
	test('[A]: Shift+click at M gives [A, S]; Shift+drag from P draws a marquee, A stays selected, S does not join', () => {
		scene([shapeS(), noteA()], [A])
		click(...M, { shiftKey: true })
		assert.deepEqual(sel(), [A, S])
		scene([shapeS(), noteA()], [A])
		drag(...P, 40, 20, { shiftKey: true })
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(sel(), [A])
	})
})

describe('AK3: where the text lies', () => {
	test('"Hello\\nBig world" (lines 50 and 90, block (155, 136)–(245, 184)): (240, 148) beside "Hello" selects [S], (255, 160) nothing', () => {
		const two = () => shapeS({ data: { text: 'Hello\nBig world' } })
		assert.deepEqual(clickOn([two()], 240, 148), [S])
		assert.deepEqual(clickOn([two()], 255, 160), [])
	})

	test('align left, valign top: (130, 120) selects [S], M nothing', () => {
		const corner = () => shapeS({ style: { align: 'left', valign: 'top' } })
		assert.deepEqual(clickOn([corner()], 130, 120), [S])
		assert.deepEqual(clickOn([corner()], ...M), [])
	})

	test('S rotated by 90°: (200, 180) selects [S], (220, 160) nothing; unrotated the other way round', () => {
		const turned = () => shapeS({ r: 90 })
		assert.deepEqual(clickOn([turned()], 200, 180), [S])
		assert.deepEqual(clickOn([turned()], 220, 160), [])
		assert.deepEqual(clickOn([shapeS()], 200, 180), [])
		assert.deepEqual(clickOn([shapeS()], 220, 160), [S])
	})

	test('a text of three blanks: a click at M selects nothing and measures nothing', () => {
		assert.deepEqual(clickOn([shapeS({ data: { text: '   ' } })], ...M), [])
		assert.deepEqual(callsOf('measureShapeLines'), [])
	})

	test('LOD 1 (no shape text painted): a click at M selects nothing', () => {
		scene([shapeS()])
		setStubLod(1)
		click(...M)
		assert.deepEqual(sel(), [])
	})

	test('a text that arrives by sync counts at once (no cache)', () => {
		scene([shapeS({ data: { text: '' } })])
		click(...M)
		assert.deepEqual(sel(), [])
		h.scene.update(h.model.apply({ upserts: [shapeS()] }))
		h.frame()
		click(...M)
		assert.deepEqual(sel(), [S])
	})

	test('only the text of a shape without fill under the point is measured: a filled shape and the border band measure nothing', () => {
		scene([shapeS({ style: { fillOpacity: 100 } })])
		click(...M)
		assert.deepEqual(sel(), [S])
		click(110, 128)
		assert.deepEqual(callsOf('measureShapeLines'), [])
		scene([shapeS()])
		click(110, 128)
		assert.deepEqual(sel(), [S], 'the border band')
		assert.deepEqual(callsOf('measureShapeLines'), [])
		click(...P)
		assert.ok(callsOf('measureShapeLines').length > 0, 'the empty inside asks for the text')
		assert.ok(callsOf('measureShapeLines').every((c) => c[0].id === S))
	})
})

describe('AK4: below, double click, menu', () => {
	test('N under S: (180, 160) on the text selects [S], (160, 185) beside it [N]', () => {
		assert.deepEqual(clickOn([noteN(), shapeS()], 180, 160), [S])
		assert.deepEqual(clickOn([noteN(), shapeS()], 160, 185), [N])
	})

	test('a double click at M opens the editor of S, at (160, 185) the one of N', () => {
		scene([noteN(), shapeS()])
		dblclick(...M)
		assert.equal(h.scene.stats().editing, S)
		scene([noteN(), shapeS()])
		dblclick(160, 185)
		assert.equal(h.scene.stats().editing, N)
	})

	test('nothing selected: a right click at M selects S with the menu of S; one at P then gives id null and clears it', () => {
		scene([shapeS()])
		rightClick(...M)
		assert.deepEqual(h.log, [
			['onSelection', [S]],
			['onIntent', { type: 'contextMenu', id: S, at: [200, 160] }],
		])
		h.log.length = 0
		rightClick(...P)
		assert.deepEqual(h.log, [
			['onSelection', []],
			['onIntent', { type: 'contextMenu', id: null, at: [250, 160] }],
		])
	})
})

describe('AK5: a finger (the real GestureController)', () => {
	const finger = () => ({ pointerType: 'touch', pointerId: 5 })
	/** @return {object} the scene [S] without a selection, with fake timers (the hold timer) */
	function touchScene() {
		h?.restore()
		h = null
		mock.timers.reset()
		mock.restoreAll()
		mock.timers.enable({ apis: ['setTimeout'] })
		return scene([shapeS()])
	}

	/**
	 * One finger from (x, y) moved by dx in four steps, released.
	 *
	 * @param {number} x container x
	 * @param {number} y container y
	 * @param {number} dx move x
	 */
	function swipe(x, y, dx) {
		h.pointer('pointerdown', x, y, finger())
		for (let i = 1; i <= 4; i++) {
			h.pointer('pointermove', x + (dx * i) / 4, y, finger())
			h.frame()
		}
		h.pointer('pointerup', x + dx, y, finger())
		h.frame()
	}

	test('(235, 160) in the finger zone, 40 px: move {S}, no pan; the mouse there draws a marquee', () => {
		touchScene()
		swipe(235, 160, 40)
		assert.deepEqual(moves(), [[[S], 40, 0]])
		unpanned()
		touchScene()
		drag(235, 160, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})

	test('a tap at M selects [S]', () => {
		touchScene()
		h.pointer('pointerdown', ...M, finger())
		h.pointer('pointerup', ...M, finger())
		h.frame()
		assert.deepEqual(sel(), [S])
	})

	test('P, 40 px: the camera pans, no move', () => {
		touchScene()
		swipe(...P, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the finger panned')
	})
})

describe('AK6: unchanged', () => {
	test('mode vote: hitAt(P, false) gives S, a click at P votes for S', () => {
		h = setupScene([shapeS()], { scene: { mode: 'vote' } })
		h.scene.setVoteState({ votable: (id) => id === S, scope: null, badges: new Map(), markVotable: true, color: '#c62828' })
		h.frame()
		h.log.length = 0
		const spy = mock.method(InputController.prototype, 'hitAt')
		h.pointer('pointerdown', ...P)
		h.dom.clock.t += 50
		h.pointer('pointerup', ...P)
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['vote', S]])
		assert.equal(spy.mock.calls[0].this.hitAt({ x: 250, y: 160 }, false), S)
	})

	test('LOD 2 (painted filled): a click at P selects [S]', () => {
		scene([shapeS()])
		setStubLod(2)
		click(...P)
		assert.deepEqual(sel(), [S])
	})
})
