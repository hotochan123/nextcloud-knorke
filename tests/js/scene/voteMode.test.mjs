/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Mode vote of the scene (SPEC-M1 §6.3 "Modus vote", R16 CLI-06, CLI-13,
 * CLI-18, decision S-13), deterministic in Node on the fake DOM with the
 * real SceneManager, GestureController and InputController and the
 * recording renderer stub of sceneHarness.mjs:
 * - a mouse click or a finger/pen tap on an item with votable(id) === true
 *   → {type:'vote', id, rect}, rect = itemScreenRect(id) at that moment
 *   (container px, confirmed camera); any other answer (false, 1, 'yes',
 *   undefined, a throw) → {type:'voteMiss', id}; empty canvas → nothing;
 *   no selection, no drag, no onUserCamera for a vote
 * - a press that moves beyond the threshold pans instead (mouse 3 px, finger
 *   and pen 10 px); a finger held longer than 500 ms is no tap
 * - the hand tool or a held space bar keeps the mouse and pen threshold;
 *   the middle button pans at once (no threshold) and never votes
 * - small-target zoom: a finger or pen on a votable item smaller than 44 px
 *   zooms (onUserCamera, no vote) until the zoom can no longer enlarge it;
 *   a mouse click always votes; a non-votable item never zooms
 * - 'press' per canvas in modes vote and view: on with the first pointer,
 *   off with the last (also outside the canvas), never in edit, ended by a
 *   switch to edit; a vote intent comes before the press ends
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { SMALL_TARGET_GOAL_PX, SMALL_TARGET_PX } from '../../../src/scene/SceneManager.js'
import { MAX_SCALE } from '../../../src/model/tokens.js'
import { frameItem, note, setStubLod, setupScene, textItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const T = '01JA0000000000000000000003'
const F = '01JA0000000000000000000009'

let h
afterEach(() => {
	h?.restore()
	h = null
})

/**
 * Scene in mode vote: note A (votable) at (0, 0), note B (not votable) at
 * (300, 0), text T at (0, 400), frame F at (0, 1000); vote state with
 * votable = the given predicate (default: A only).
 *
 * @param {object} [o] {mode, votable, items}
 * @return {object} sceneHarness
 */
function setup({ mode = 'vote', votable = (id) => id === A, items = null } = {}) {
	h = setupScene(items ?? [note(A), note(B, { x: 300 }), textItem(T, { x: 0, y: 400 }), frameItem(F, { x: 0, y: 1000 })], { scene: { mode } })
	h.scene.setVoteState({ votable, scope: null, badges: new Map(), markVotable: true, color: '#c62828' })
	h.frame()
	h.log.length = 0
	return h
}

/** @param {string} [kind] activity kind @return {Array} onActivity entries of that kind */
const acts = (kind) => h.log.filter((e) => e[0] === 'onActivity' && (!kind || e[1].kind === kind)).map((e) => e[1])
const users = () => h.log.filter((e) => e[0] === 'onUserCamera').length

/**
 * A tap or click: pointerdown, optional moves, pointerup.
 *
 * @param {number} x container x
 * @param {number} y container y
 * @param {object} [o] {type: pointerType, id: pointerId, moves: [[x, y]], ms: duration, up: [x, y]}
 */
function tap(x, y, { type = 'mouse', id = 1, moves = [], ms = 50, up = null } = {}) {
	h.pointer('pointerdown', x, y, { pointerType: type, pointerId: id })
	for (const [mx, my] of moves) h.pointer('pointermove', mx, my, { pointerType: type, pointerId: id })
	h.dom.clock.t += ms
	h.pointer('pointerup', up ? up[0] : x, up ? up[1] : y, { pointerType: type, pointerId: id })
}

describe('vote and voteMiss (§6.3, R16)', () => {
	for (const type of ['mouse', 'touch', 'pen']) {
		test(`${type}: a click/tap on a votable item → vote {id, rect = itemScreenRect}; nothing selected, no camera change`, () => {
			setup()
			tap(100, 100, { type })
			assert.deepEqual(h.intents(), [{ type: 'vote', id: A, rect: { x: 0, y: 0, w: 200, h: 200 } }])
			assert.deepEqual(h.scene.getSelection(), [])
			assert.equal(users(), 0)
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		})
	}

	test('vote.rect = itemScreenRect at the click: container px of the confirmed camera, axis-aligned (CLI-18)', () => {
		setup()
		h.scene.setCamera({ x: -40, y: 20, scale: 0.75 })
		h.frame()
		h.log.length = 0
		tap(130, 50)
		const [v] = h.intents('vote')
		assert.deepEqual(v.rect, h.scene.itemScreenRect(A))
		assert.deepEqual(v.rect, { x: 30, y: -15, w: 150, h: 150 })
		h.scene.update(h.model.apply({ upserts: [note(A, { r: 45 })] }))
		h.log.length = 0
		tap(105, 60)
		const rot = h.intents('vote')[0].rect
		const d = 200 * Math.SQRT2 * 0.75
		assert.ok(Math.abs(rot.w - d) < 1e-9 && Math.abs(rot.h - d) < 1e-9, 'a rotated item: its axis-aligned screen box')
	})

	test('an item that is not votable → voteMiss {id}; only votable(id) === true counts (S-13); empty canvas → nothing', () => {
		const answers = new Map([[A, 1], [B, 'yes'], [T, undefined]])
		setup({ votable: (id) => answers.get(id) })
		tap(100, 100)
		tap(400, 100, { type: 'touch', id: 7 })
		tap(50, 410, { type: 'pen', id: 3 })
		tap(700, 700)
		assert.deepEqual(h.intents(), [{ type: 'voteMiss', id: A }, { type: 'voteMiss', id: B }, { type: 'voteMiss', id: T }])
		answers.set(A, true)
		tap(100, 100)
		assert.equal(h.intents().at(-1).type, 'vote')
	})

	test('a votable() that throws counts as not votable (voteMiss), reported once; the frame title is a hit, its inside is not', () => {
		setup({ votable: (id) => { if (id === B) throw new Error('adapter'); return false } })
		const errs = []
		const saved = globalThis.reportError
		globalThis.reportError = (e) => errs.push(e)
		try {
			tap(400, 100)
			tap(400, 100)
		} finally {
			globalThis.reportError = saved
		}
		assert.deepEqual(h.intents().map((i) => i.type), ['voteMiss', 'voteMiss'])
		assert.equal(errs.length, 1)
		h.log.length = 0
		tap(100, 1000 - 20)
		tap(400, 1300)
		assert.deepEqual(h.intents(), [{ type: 'voteMiss', id: F }], 'title band hits, the empty inside does not')
	})

	test('no vote intents without a vote state, in mode view, or in mode edit (there a click selects)', () => {
		setup()
		h.scene.setVoteState(null)
		tap(100, 100)
		tap(100, 100, { type: 'touch', id: 4 })
		h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#000000' })
		h.scene.setMode('view')
		tap(100, 100)
		tap(100, 100, { type: 'touch', id: 5 })
		h.scene.setMode('edit')
		tap(100, 100)
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.scene.getSelection(), [A], 'edit: the click selects')
	})

	test('a press that moves beyond its threshold pans and never votes: mouse > 3 px, finger and pen > 10 px; a finger held > 500 ms is no tap', () => {
		setup()
		tap(100, 100, { moves: [[102, 101]] })
		assert.equal(h.intents().length, 1, 'mouse within 3 px: a click')
		h.log.length = 0
		tap(100, 100, { moves: [[104, 100], [120, 100]] })
		assert.deepEqual(h.intents(), [])
		assert.equal(users(), 1, 'the pan is a user camera change')
		assert.ok(acts('gesture').length === 2, 'gesture activity of the pan')
		h.log.length = 0
		tap(100, 100, { type: 'touch', id: 8, moves: [[108, 104]] })
		tap(100, 100, { type: 'pen', id: 9, moves: [[106, 106]] })
		assert.equal(h.intents('vote').length, 2, 'finger and pen within 10 px: taps')
		h.log.length = 0
		tap(100, 100, { type: 'touch', id: 10, moves: [[112, 100]] })
		tap(100, 100, { type: 'pen', id: 11, moves: [[100, 115]] })
		tap(100, 100, { type: 'touch', id: 12, ms: 600 })
		assert.deepEqual(h.intents(), [])
	})

	for (const held of ['hand tool', 'space bar']) {
		test(`the threshold holds with the ${held} too: below it a click or pen tap votes, beyond it the press pans from its pointerdown`, () => {
			setup()
			if (held === 'hand tool') {
				h.scene.setTool('hand')
				assert.equal(h.scene.getTool(), 'hand')
			} else {
				h.focusCanvas()
				assert.ok(dispatch(h.container, 'keydown', { key: ' ', code: 'Space' }).defaultPrevented, 'the space bar is held')
			}
			tap(100, 100, { moves: [[102, 101]] })
			tap(100, 100, { type: 'pen', id: 9, moves: [[106, 106]] })
			assert.deepEqual(h.intents().map((i) => i.type), ['vote', 'vote'], 'mouse within 3 px, pen within 10 px')
			assert.deepEqual(acts('gesture'), [])
			assert.equal(users(), 0)
			h.log.length = 0
			h.pointer('pointerdown', 100, 100)
			assert.deepEqual(acts('gesture'), [], 'no pan at the pointerdown')
			h.pointer('pointermove', 104, 100)
			h.pointer('pointermove', 120, 100)
			h.pointer('pointerup', 120, 100)
			tap(100, 100, { type: 'pen', id: 11, moves: [[100, 115]] })
			h.frame()
			assert.deepEqual(h.intents(), [])
			assert.equal(users(), 2)
			assert.deepEqual(h.scene.getCamera(), { x: -20, y: -15, scale: 1 }, 'each pan covers the whole way since its pointerdown')
		})
	}

	test('the middle button pans at once in mode vote (no threshold) and never votes', () => {
		setup()
		h.pointer('pointerdown', 100, 100, { button: 1 })
		assert.deepEqual(acts('gesture'), [{ kind: 'gesture', active: true, ids: [] }], 'the pan starts at the pointerdown')
		h.pointer('pointermove', 101, 100, { button: 1 })
		h.pointer('pointerup', 101, 100, { button: 1 })
		h.frame()
		assert.deepEqual(h.scene.getCamera(), { x: -1, y: 0, scale: 1 }, 'a 1 px move pans')
		assert.equal(users(), 1)
		h.pointer('pointerdown', 100, 100, { button: 1 })
		h.pointer('pointerup', 100, 100, { button: 1 })
		assert.deepEqual(h.intents(), [])
	})

	test('Shift+2 works in mode vote (zoom to the selection, onUserCamera)', () => {
		setup()
		h.scene.setSelection([B])
		h.focusCanvas()
		h.key('@', { shiftKey: true, code: 'Digit2' })
		h.frame()
		const c = h.scene.getCamera()
		assert.ok(Math.abs(c.x + 500 / c.scale - 400) < 1e-9 && Math.abs(c.y + 400 / c.scale - 100) < 1e-9, 'B centred')
		assert.equal(users(), 1)
	})
})

describe('small-target zoom (§6.3 R16, CLI-06)', () => {
	test(`a finger on a votable item smaller than ${SMALL_TARGET_PX} px zooms (onUserCamera, no vote): its shorter side becomes ${SMALL_TARGET_GOAL_PX} px, centred; the next tap votes`, () => {
		setup()
		h.scene.setCamera({ x: 0, y: 0, scale: 0.1 })
		h.frame()
		h.log.length = 0
		assert.deepEqual(h.scene.itemScreenRect(A), { x: 0, y: 0, w: 20, h: 20 })
		tap(10, 10, { type: 'touch', id: 3 })
		h.frame()
		assert.deepEqual(h.intents(), [])
		assert.equal(users(), 1)
		const r = h.scene.itemScreenRect(A)
		assert.ok(Math.abs(r.w - SMALL_TARGET_GOAL_PX) < 1e-9, `the item is now ${r.w} px`)
		assert.ok(Math.abs(r.x + r.w / 2 - 500) < 1e-9 && Math.abs(r.y + r.h / 2 - 400) < 1e-9, 'centred')
		tap(500, 400, { type: 'touch', id: 4 })
		assert.deepEqual(h.intents(), [{ type: 'vote', id: A, rect: r }])
		assert.equal(users(), 1)
	})

	test('pen zooms like a finger; a mouse click on the same small item always votes; a small item that is not votable gives voteMiss without a zoom', () => {
		setup()
		h.scene.setCamera({ x: 0, y: 0, scale: 0.1 })
		h.frame()
		h.log.length = 0
		tap(10, 10)
		assert.deepEqual(h.intents().map((i) => i.type), ['vote'], 'mouse: votes')
		tap(40, 10, { type: 'touch', id: 2 })
		assert.deepEqual(h.intents().map((i) => i.type), ['vote', 'voteMiss'], 'B: no zoom')
		assert.equal(users(), 0)
		tap(10, 10, { type: 'pen', id: 6 })
		assert.equal(users(), 1, 'pen: zoom')
		assert.equal(h.intents().length, 2)
	})

	test('no endless zoom: when the zoom cannot enlarge the item any more (MAX_SCALE), a small item gets the vote', () => {
		setup({ votable: () => true, items: [textItem(T, { x: 0, y: 0, w: 60, h: 9.6, style: { fontSize: 8, color: '#1a1a1a', align: 'left' } })] })
		h.scene.setCamera({ x: 0, y: 0, scale: MAX_SCALE })
		h.frame()
		h.log.length = 0
		const r = h.scene.itemScreenRect(T)
		assert.ok(r.h < SMALL_TARGET_PX, `${r.h} px`)
		tap(100, 20, { type: 'touch', id: 9 })
		assert.deepEqual(h.intents(), [{ type: 'vote', id: T, rect: r }])
		assert.equal(users(), 0)
	})

	test('a wide item: the zoom keeps it in view (margin), so a second tap votes even when it stays below 44 px', () => {
		setup({ votable: () => true, items: [textItem(T, { x: 0, y: 0, w: 2000, h: 28.8 })] })
		h.scene.setCamera({ x: 0, y: 0, scale: 0.4 })
		h.frame()
		h.log.length = 0
		tap(100, 5, { type: 'touch', id: 1 })
		h.frame()
		assert.equal(users(), 1)
		const r = h.scene.itemScreenRect(T)
		assert.ok(Math.abs(r.w - (1000 - 32)) < 1e-6, 'fits the width with 16 px on each side')
		tap(500, 400, { type: 'touch', id: 2 })
		assert.deepEqual(h.intents().map((i) => i.type), ['vote'])
	})
})

describe("onActivity 'press' per canvas (§6.3 R16, CLI-13)", () => {
	for (const mode of ['vote', 'view']) {
		test(`${mode}: on with the first pointer, off with the last; a second finger neither starts nor ends it; ids []`, () => {
			setup({ mode })
			h.pointer('pointerdown', 600, 600, { pointerType: 'touch', pointerId: 1 })
			h.pointer('pointerdown', 700, 600, { pointerType: 'touch', pointerId: 2 })
			h.pointer('pointerup', 600, 600, { pointerType: 'touch', pointerId: 1 })
			assert.deepEqual(acts('press'), [{ kind: 'press', active: true, ids: [] }])
			assert.equal(h.scene.stats().pressing, true)
			h.pointer('pointerup', 700, 600, { pointerType: 'touch', pointerId: 2 })
			assert.deepEqual(acts('press'), [{ kind: 'press', active: true, ids: [] }, { kind: 'press', active: false, ids: [] }])
			assert.equal(h.scene.stats().pressing, false)
			tap(600, 600)
			tap(600, 600, { type: 'pen', id: 4 })
			assert.equal(acts('press').length, 6, 'every pointer type')
		})
	}

	test('the vote intent comes before the press ends; the pointerdown that starts the press is the one that ended a glide', async () => {
		setup()
		const order = []
		h.log.length = 0
		const p = h.scene.followTo({ x: 300, y: 300, scale: 1 }, 600)
		h.frame(16)
		h.pointer('pointerdown', 100, 100, { pointerType: 'touch', pointerId: 5 })
		assert.equal(await p, false, 'the glide ended at the pointerdown')
		const cam = h.scene.getCamera()
		h.pointer('pointerup', 100, 100, { pointerType: 'touch', pointerId: 5 })
		for (const e of h.log) {
			if (e[0] === 'onActivity') order.push('press:' + e[1].active)
			if (e[0] === 'onIntent') order.push(e[1].type)
		}
		const hit = h.model.hitTest(cam.x + 100 / cam.scale, cam.y + 100 / cam.scale, 12)
		assert.equal(hit, A, 'the finger is on A at the camera shown')
		assert.deepEqual(order, ['press:true', 'vote', 'press:false'])
	})

	test('not in mode edit; a switch to edit ends an open press once; a pointerup outside the canvas ends it too; overlay controls do not count', () => {
		setup({ mode: 'edit' })
		tap(600, 600, { type: 'touch', id: 1 })
		assert.deepEqual(acts('press'), [])
		h.scene.setMode('vote')
		h.pointer('pointerdown', 600, 600, { pointerType: 'touch', pointerId: 2 })
		h.scene.setMode('edit')
		assert.deepEqual(acts('press').map((a) => a.active), [true, false])
		h.pointer('pointerup', 600, 600, { pointerType: 'touch', pointerId: 2 })
		assert.deepEqual(acts('press').map((a) => a.active), [true, false], 'no second end')
		h.scene.setMode('view')
		h.pointer('pointerdown', 600, 600, { pointerType: 'mouse', pointerId: 1 })
		dispatch(h.dom.doc.body, 'pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 2000, clientY: 2000 })
		assert.deepEqual(acts('press').map((a) => a.active), [true, false, true, false], 'released outside the canvas')
		const overlay = h.container.children.find((c) => c.className === 'knorke-scene-overlay')
		const btn = h.dom.doc.createElement('button')
		overlay.appendChild(btn)
		h.pointer('pointerdown', 10, 10, { target: btn })
		h.pointer('pointerup', 10, 10, { target: btn })
		assert.equal(acts('press').length, 4, 'a press on an overlay control is no press of the canvas')
	})

	test('LOD 2: a tap on a connector line is no hit (not drawn), a note is', () => {
		const C = '01JA0000000000000000000005'
		const conn = { id: C, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b0', parent: null, data: { start: { x: 0, y: 5000 }, end: { x: 8000, y: 5000 }, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2 } }
		setup({ votable: () => true, items: [note(A), conn] })
		h.scene.setCamera({ x: 0, y: 0, scale: 0.08 })
		h.frame()
		setStubLod(2)
		h.log.length = 0
		tap(320, 400)
		tap(8, 8)
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['vote', A]])
	})
})
