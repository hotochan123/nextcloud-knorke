/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The inside of a shape without fill is empty canvas (factory job 170), with
 * the real SceneManager, InputController and GestureController on the fake
 * DOM (sceneHarness.mjs, camera {0, 0, 1}). Rectangle S (100, 100, 200 ×
 * 120), fillOpacity 0, stroke width 2: its border band is b = (8 + 4) / s + 1
 * for the mouse and pen (13 at scale 1), (8 + 12) / s + 1 for a finger (21),
 * so the empty inside for the mouse is (113, 113)–(287, 207); M = (200, 160).
 * Move ids are compared as sets.
 * - AK1 S selected alone: a drag from M draws a marquee and clears the
 *   selection at the press, a click there clears it; the border band and the
 *   gap (job 140) still move S, also with a pen and at scale 2
 * - AK2 S not selected: M is empty canvas, the band selects S, no gap
 * - AK3 the ellipse and diamond kinds, a rotated S; fillOpacity 25 or none
 *   still grab S from M
 * - AK4 a note N under S: clicked, dragged and double clicked through S; a
 *   double click on the empty inside opens S's editor; the marquee leaves S
 *   out while S's outline holds it, and takes S once it reaches past it
 * - AK5 a multi-selection [S, A]: the selection frame of job 163 as before
 * - AK6 a finger: pans from M, a hold draws the marquee, a tap changes
 *   nothing; the finger's band (21) still grabs S
 * - AK7 the context menu at M is the one of empty canvas; LOD 2, the vote
 *   (hitAt) and another tool keep the whole inside
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { InputController } from '../../../src/scene/InputController.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setStubLod, setupScene, shapeItem } from './sceneHarness.mjs'

const S = '01JA00000000000000000000S1'
const N = '01JA00000000000000000000N1'
const A = '01JA0000000000000000000001'
const L = '01JA00000000000000000000L1'
const E = '01JA00000000000000000000E1'
const D = '01JA00000000000000000000D1'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const M = [200, 160]
const HOLLOW = Object.freeze({ fill: '#ffffff', fillOpacity: 0, stroke: '#1a1a1a', strokeWidth: 2 })

let h = null
afterEach(() => {
	h?.restore()
	h = null
	mock.timers.reset()
	mock.restoreAll()
})

/**
 * @param {object} [o] fields of S
 * @return {object} the shape S
 */
const shapeS = (o = {}) => shapeItem(S, { x: 100, y: 100, w: 200, h: 120, z: 'a2', style: { ...HOLLOW }, ...o })
/** @return {object} the note N (150, 130, 60 × 60) under S */
const noteN = () => note(N, { x: 150, y: 130, w: 60, h: 60, z: 'a1' })

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
const at = (id) => [h.model.get(id).x, h.model.get(id).y]

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
 * The container point of S's local point (lx, ly) for S rotated by deg around its centre (200, 160).
 *
 * @param {number} lx local x
 * @param {number} ly local y
 * @param {number} deg rotation
 * @return {[number, number]}
 */
function rotated(lx, ly, deg) {
	const r = deg * Math.PI / 180
	const dx = lx - 100
	const dy = ly - 60
	return [200 + dx * Math.cos(r) - dy * Math.sin(r), 160 + dx * Math.sin(r) + dy * Math.cos(r)]
}

describe('AK1: S selected alone', () => {
	for (const pointerType of ['mouse', 'pen']) {
		const props = { pointerType, pointerId: pointerType === 'pen' ? 9 : 1 }

		test(`${pointerType}: a drag from M by (40, 20) draws a marquee, no move; the selection is empty from the press on`, () => {
			scene([shapeS()], [S])
			h.pointer('pointerdown', ...M, props)
			assert.deepEqual(h.scene.getSelection(), [], 'the press clears the selection')
			for (let i = 1; i <= 4; i++) {
				h.pointer('pointermove', 200 + 10 * i, 160 + 5 * i, props)
				h.frame()
			}
			h.pointer('pointerup', 240, 180, props)
			h.frame()
			assert.ok(marquees().length > 0, 'a marquee')
			assert.deepEqual(h.intents('move'), [])
			assert.deepEqual(h.scene.getSelection(), [], 'the marquee in the empty inside takes nothing')
			assert.deepEqual(at(S), [100, 100])
		})

		test(`${pointerType}: a click at M gives []`, () => {
			scene([shapeS()], [S])
			click(...M, props)
			assert.deepEqual(h.scene.getSelection(), [])
		})

		test(`${pointerType}: a drag from the border band (110, 128) and from the gap (93, 128) moves {S} by dx 40`, () => {
			scene([shapeS()], [S])
			drag(110, 128, 40, 0, props)
			assert.deepEqual(moves(), [[[S], 40, 0]])
			scene([shapeS()], [S])
			drag(93, 128, 40, 0, props)
			assert.deepEqual(moves(), [[[S], 40, 0]])
		})
	}

	test('at scale 2 the band is 7 world units: screen (210, 256) moves S, screen (220, 256) draws a marquee', () => {
		scene([shapeS()], [S])
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		drag(210, 256, 40)
		assert.deepEqual(moves(), [[[S], 20, 0]], '40 screen px are dx 20')
		scene([shapeS()], [S])
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		h.frame()
		drag(220, 256, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
	})
})

describe('AK2: S not selected', () => {
	test('a click at M selects nothing; a drag from M draws a marquee, no move, S stays unselected', () => {
		scene([shapeS()])
		click(...M)
		assert.deepEqual(h.scene.getSelection(), [])
		drag(...M, 40, 20)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(h.scene.getSelection(), [])
	})

	test('a click at (110, 128) selects [S]; a drag from (93, 128) draws a marquee (no gap without a selection)', () => {
		scene([shapeS()])
		click(110, 128)
		assert.deepEqual(h.scene.getSelection(), [S])
		scene([shapeS()])
		drag(93, 128, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(h.scene.getSelection(), [S], 'it starts outside the outline, so it takes S')
	})
})

describe('AK3: kinds and fill', () => {
	test('ellipse E and diamond D with fillOpacity 0: their middle selects nothing, their border band selects them', () => {
		const hollow = (id, kind) => shapeItem(id, { x: kind === 'ellipse' ? 400 : 700, y: 300, w: 200, h: 120, data: { kind, text: '' }, style: { ...HOLLOW } })
		scene([hollow(E, 'ellipse'), hollow(D, 'diamond')])
		click(500, 360)
		assert.deepEqual(h.scene.getSelection(), [], 'the middle of E')
		click(402, 360)
		assert.deepEqual(h.scene.getSelection(), [E])
		click(800, 360)
		assert.deepEqual(h.scene.getSelection(), [], 'the middle of D')
		click(704, 360)
		assert.deepEqual(h.scene.getSelection(), [D])
	})

	test('S rotated by 45°: a click in the middle of its box selects nothing, 5 px inside an edge selects S', () => {
		scene([shapeS({ r: 45 })])
		click(...M)
		assert.deepEqual(h.scene.getSelection(), [])
		click(...rotated(5, 60, 45))
		assert.deepEqual(h.scene.getSelection(), [S], '5 px inside the left edge')
		scene([shapeS({ r: 45 })])
		click(...rotated(100, 115, 45))
		assert.deepEqual(h.scene.getSelection(), [S], '5 px inside the bottom edge')
	})

	for (const [name, style] of [['fillOpacity 25', { ...HOLLOW, fillOpacity: 25 }], ['no fillOpacity', { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }]]) {
		test(`${name}: a drag from M moves {S} as before, selected or not`, () => {
			scene([shapeS({ style })])
			drag(...M, 40)
			assert.deepEqual(moves(), [[[S], 40, 0]])
			scene([shapeS({ style })], [S])
			drag(...M, 40)
			assert.deepEqual(moves(), [[[S], 40, 0]])
		})
	}
})

describe('AK4: items in the inside', () => {
	test('N under S: a click at (180, 160) selects [N], a drag there moves {N}', () => {
		scene([noteN(), shapeS()])
		click(180, 160)
		assert.deepEqual(h.scene.getSelection(), [N])
		scene([noteN(), shapeS()])
		drag(180, 160, 40)
		assert.deepEqual(moves(), [[[N], 40, 0]])
		assert.deepEqual(at(S), [100, 100])
	})

	test('a double click on N opens the editor of N; on the empty inside (250, 160) the editor of S', () => {
		scene([noteN(), shapeS()])
		dblclick(180, 160)
		assert.equal(h.scene.stats().editing, N)
		scene([noteN(), shapeS()])
		dblclick(250, 160)
		assert.equal(h.scene.stats().editing, S)
	})

	test('a marquee (130, 125)–(240, 200) takes [N] without S; one from M to (350, 200) takes S', () => {
		scene([noteN(), shapeS()])
		drag(130, 125, 110, 75)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.scene.getSelection(), [N])
		// M lies on N (150–210): a press there would drag N, so this one runs without N
		scene([shapeS()])
		drag(...M, 150, 40)
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.scene.getSelection(), [S], 'past the outline it takes S')
	})
})

describe('AK5: the selection frame of a multi-selection (job 163)', () => {
	const noteA = () => note(A, { x: 400, y: 100, w: 200, h: 200, z: 'a3' })

	test('[S, A]: a drag from M moves {S, A}; a click at M clears the selection', () => {
		scene([shapeS(), noteA()], [S, A])
		drag(...M, 40)
		assert.deepEqual(moves(), [[sorted([S, A]), 40, 0]])
		assert.deepEqual(marquees(), [])
		scene([shapeS(), noteA()], [S, A])
		click(...M)
		assert.deepEqual(h.scene.getSelection(), [])
	})

	test('[S, A]: Shift+drag from M draws a marquee, S and A stay selected', () => {
		scene([shapeS(), noteA()], [S, A])
		drag(...M, 40, 20, { shiftKey: true })
		assert.ok(marquees().length > 0, 'a marquee')
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(sorted(h.scene.getSelection()), sorted([S, A]))
	})

	test('[S, A] and a locked, unselected note L under S: a drag from L moves {S, A}', () => {
		scene([note(L, { x: 150, y: 130, w: 60, h: 60, z: 'a1', lock: LOCK }), shapeS(), noteA()], [S, A])
		drag(180, 160, 40)
		assert.deepEqual(moves(), [[sorted([S, A]), 40, 0]])
		assert.deepEqual(at(L), [150, 130])
	})
})

describe('AK6: a finger (the real GestureController), S selected', () => {
	const finger = () => ({ pointerType: 'touch', pointerId: 5 })
	/** @return {object} the scene [S] with fake timers (the hold timer) and a spy on taps */
	function touchScene() {
		h?.restore()
		h = null
		mock.timers.reset()
		mock.restoreAll()
		mock.timers.enable({ apis: ['setTimeout'] })
		scene([shapeS()], [S])
		return { taps: mock.method(InputController.prototype, 'tap') }
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

	test('M, 40 px: the camera pans, no move', () => {
		touchScene()
		swipe(...M, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the finger panned')
		assert.deepEqual(at(S), [100, 100])
	})

	test('M held LONG_PRESS_MS, then dragged: a marquee, no move', () => {
		touchScene()
		h.pointer('pointerdown', ...M, finger())
		mock.timers.tick(LONG_PRESS_MS)
		h.pointer('pointermove', 250, 190, finger())
		h.frame()
		assert.ok(marquees().length > 0, 'a marquee')
		h.pointer('pointerup', 250, 190, finger())
		h.frame()
		assert.deepEqual(h.intents('move'), [])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
	})

	test('a tap at M: the selection stays [S], no intent', () => {
		const { taps } = touchScene()
		h.pointer('pointerdown', ...M, finger())
		h.pointer('pointerup', ...M, finger())
		h.frame()
		assert.equal(taps.mock.callCount(), 1, 'the tap reached the input controller')
		assert.deepEqual(h.scene.getSelection(), [S])
		assert.deepEqual(h.intents(), [])
	})

	test('(118, 128), 40 px: move {S} (in the finger band of 21); (124, 128): the camera pans', () => {
		touchScene()
		swipe(118, 128, 40)
		assert.deepEqual(moves(), [[[S], 40, 0]])
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		touchScene()
		swipe(124, 128, 40)
		assert.deepEqual(h.intents('move'), [])
		assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the finger panned')
	})
})

describe('AK7: context menu, LOD 2, vote, another tool', () => {
	test('S selected: a right click at M clears the selection, menu with id null; at (110, 128) id S', () => {
		scene([shapeS()], [S])
		rightClick(...M)
		assert.deepEqual(h.log, [
			['onSelection', []],
			['onIntent', { type: 'contextMenu', id: null, at: [200, 160] }],
		])
		scene([shapeS()], [S])
		rightClick(110, 128)
		assert.deepEqual(h.intents('contextMenu'), [{ type: 'contextMenu', id: S, at: [110, 128] }])
		assert.deepEqual(h.scene.getSelection(), [S])
	})

	test('LOD 2 (painted filled): a click at M selects S as before', () => {
		scene([shapeS()])
		setStubLod(2)
		click(...M)
		assert.deepEqual(h.scene.getSelection(), [S])
	})

	test('a marquee from a locked note above S, all inside S: LOD 0 leaves S out, LOD 2 takes it', () => {
		for (const lod of [0, 2]) {
			scene([shapeS(), note(L, { x: 150, y: 130, w: 60, h: 60, z: 'a3', lock: LOCK })])
			setStubLod(lod)
			drag(180, 160, 40, 20)
			assert.ok(marquees().length > 0, `LOD ${lod}: a marquee`)
			assert.deepEqual(h.scene.getSelection(), lod === 2 ? [S] : [], `LOD ${lod}`)
		}
	})

	test('mode vote: hitAt(M, false) gives S, a click at M votes for S', () => {
		h = setupScene([shapeS()], { scene: { mode: 'vote' } })
		h.scene.setVoteState({ votable: (id) => id === S, scope: null, badges: new Map(), markVotable: true, color: '#c62828' })
		h.frame()
		h.log.length = 0
		const spy = mock.method(InputController.prototype, 'hitAt')
		h.pointer('pointerdown', ...M)
		h.dom.clock.t += 50
		h.pointer('pointerup', ...M)
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['vote', S]])
		assert.equal(spy.mock.callCount(), 1)
		assert.equal(spy.mock.calls[0].arguments[1], false, 'a mouse')
		assert.equal(spy.mock.calls[0].result, S)
		assert.equal(spy.mock.calls[0].this.hitAt({ x: 200, y: 160 }, false), S)
	})

	test('only with the select tool: a right click at M with the sticky tool gives the menu of S', () => {
		scene([shapeS()])
		h.scene.setTool('sticky')
		rightClick(...M)
		assert.deepEqual(h.intents('contextMenu'), [{ type: 'contextMenu', id: S, at: [200, 160] }])
	})
})
