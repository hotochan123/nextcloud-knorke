/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "New comment" in the scene (factory job 189, setPick): while it is on, a
 * click (mouse) or tap (finger, pen) without a drag gives {type: 'pick', at,
 * world, touch} in every mode – nothing is selected, moved or voted; a drag
 * beyond the threshold pans instead; the cursor is a crosshair. Off again,
 * a click selects (edit) or votes (vote) as before. The touchend of a
 * finger's or pen's pick tap is cancelled (ENTWICKLUNG trap 9.46: its
 * compatibility mousedown would take the focus from the comment field that
 * opens there); a mouse click keeps everything. Real SceneManager,
 * GestureController and InputController on the fake DOM of sceneHarness.mjs.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { note, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

let h
afterEach(() => {
	h?.restore()
	h = null
})

function setup(mode = 'edit') {
	h = setupScene([note(A), note(B, { x: 300 })], { scene: { mode } })
	if (mode === 'vote') {
		h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: true, color: '#c62828' })
	}
	h.frame()
	h.log.length = 0
	return h
}

function tap(x, y, { type = 'mouse', id = 1, moves = [], ms = 50 } = {}) {
	h.pointer('pointerdown', x, y, { pointerType: type, pointerId: id })
	for (const [mx, my] of moves) h.pointer('pointermove', mx, my, { pointerType: type, pointerId: id })
	h.dom.clock.t += ms
	h.pointer('pointerup', moves.length > 0 ? moves.at(-1)[0] : x, moves.length > 0 ? moves.at(-1)[1] : y, { pointerType: type, pointerId: id })
}

for (const mode of ['edit', 'vote', 'view']) {
	for (const type of ['mouse', 'touch', 'pen']) {
		test(`mode ${mode}, ${type}: a tap picks (world point, container px), nothing selected, moved or voted`, () => {
			setup(mode)
			h.scene.setPick(true)
			assert.equal(h.scene.getPick(), true)
			tap(100, 120, { type })
			assert.deepEqual(h.intents(), [{ type: 'pick', at: [100, 120], world: { x: 100, y: 120 }, touch: type === 'touch' }])
			assert.deepEqual(h.scene.getSelection(), [])
			assert.equal(h.model.get(A).x, 0, 'not moved')
		})
	}
}

test('a drag in pick mode pans the canvas and picks nothing; off again a click selects as before', () => {
	setup('edit')
	h.scene.setPick(true)
	tap(100, 100, { moves: [[140, 100], [200, 100]] })
	assert.deepEqual(h.intents(), [], 'no pick for a drag')
	assert.deepEqual(h.scene.getSelection(), [], 'nothing selected')
	assert.equal(h.model.get(A).x, 0, 'the note did not move')
	assert.notDeepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the canvas panned')
	h.scene.setPick(false)
	assert.equal(h.scene.getPick(), false)
	h.log.length = 0
	h.scene.setCamera({ x: 0, y: 0, scale: 1 })
	h.frame()
	tap(350, 100)
	assert.deepEqual(h.scene.getSelection(), [B], 'a click selects again')
	assert.equal(h.intents('pick').length, 0)
})

/** The touchend the browser sends after the pointerup (cancelable, like a real one). */
const touchEnd = () => dispatch(h.container, 'touchend', { cancelable: true })

for (const type of ['touch', 'pen']) {
	test(`${type}: the touchend of the pick tap is cancelled (no ghost mousedown), the next one is not; a touchstart forgets the flag`, () => {
		setup('edit')
		h.scene.setPick(true)
		tap(100, 120, { type })
		assert.equal(h.intents('pick').length, 1)
		assert.equal(touchEnd().defaultPrevented, true, 'the pick tap\'s touchend')
		assert.equal(touchEnd().defaultPrevented, false, 'a later touchend keeps its click')
		h.scene.setPick(true)
		tap(100, 120, { type })
		dispatch(h.container, 'touchstart', { cancelable: true })
		assert.equal(touchEnd().defaultPrevented, false, 'a new touch forgot a flag whose touchend never came')
	})
}

test('mouse: a pick click cancels no touchend', () => {
	setup('edit')
	h.scene.setPick(true)
	tap(100, 120)
	assert.equal(h.intents('pick').length, 1)
	assert.equal(touchEnd().defaultPrevented, false)
})
