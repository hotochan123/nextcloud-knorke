/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The reaction row under a note (factory job 172, AK5), pure in Node
 * (nodes/reactions.js: the row in the note's coordinates, rotated with it,
 * nothing below LOD_TEXT_SCALE, the hit test, the painting, rowStat) and on
 * the fake DOM with the real SceneManager and InputController
 * (sceneHarness.mjs, recording renderer stub):
 * - a tap on a pill, the button or "+n" reports react, reactPick and
 *   reactList (mode edit with the select tool, and mode vote without a vote)
 * - a long press reports the names, opens no context menu and selects
 *   nothing; its release is no tap; a press that moves on is handed over
 *   (the marquee, the pan, the drag)
 * - the button shows on hover, on the one selected note and at the end of a
 *   row, never while one may not react (view, frozen) or with another tool
 * - the selection frame (handles, the lower "+") of the one selected note
 *   with a band reaches REACT_BAND + 4 px further down; without a band as before
 * - (job 183) with touch in modes vote and view the button stands at every
 *   note (everyNote), where the row starts when it has no reactions; a
 *   finger on it picks and votes nothing; a hit through the tolerance alone
 *   never counts inside a note (B just below A's button votes B)
 * stats().reactions and the drawn outline with the real renderer:
 * tests/js/scene/reactionsRender.test.mjs.
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_PRESS_MS } from '../../../src/scene/GestureController.js'
import { REACT_NAMES_MS } from '../../../src/scene/SceneManager.js'
import { REACT_NONE, bandAt, paintReactions, planReactions, reactionAt, reactionBand, rowOf, rowParts, rowStat } from '../../../src/scene/nodes/reactions.js'
import { EXPORT_REACT } from '../../../src/scene/exportImage.js'
import { HIT_TOL_TOUCH_PX } from '../../../src/scene/InputController.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { LOD_TEXT_SCALE, REACT_ADD, REACT_BAND, REACT_GAP, REACT_H } from '../../../src/model/tokens.js'
import { callsOf, note, setupScene, shapeItem } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const S = '01JA0000000000000000000003'
const ME = 'a1b2c3d4e5f60718'
const REACT = Object.freeze({
	[`p${ME}`]: { e: '1f44d', n: 'Vic' },
	pbbbbbbbbbbbbbbbb: { e: '1f44d', n: 'Bob' },
	pcccccccccccccccc: { e: '2764-fe0f', n: 'Carol' },
})
/** a note at (100, 100), 200 × 200, with 👍 2 (mine) and ❤️ 1 */
const reacted = (id = A, o = {}) => note(id, { x: 100, y: 100, data: { text: 'A', react: structuredClone(REACT) }, ...o })
const state = (o = {}) => ({ canReact: true, me: ME, hover: null, selected: null, hidden: new Set(), scale: 1, ...o })
const model = (items) => {
	const m = new SceneModel()
	m.load(items)
	return m
}
/** the row's y in screen px at camera (0, 0, 1): 100 + 200 + 8 … + 24 */
const ROW_Y = 100 + 200 + REACT_GAP + REACT_H / 2

describe('nodes/reactions.js (pure)', () => {
	test('a row: in the note\'s coordinates, pills by count, "+n", the button while one may react; rowStat; another type or nothing to draw: no row', () => {
		const m = model([reacted(), note(B, { x: 400, y: 100 }), shapeItem(S, { x: 700, data: { kind: 'rect', react: structuredClone(REACT) } })])
		const row = rowOf(m, A, state())
		assert.deepEqual([row.x, row.y, row.w, row.h, row.r], [100, 100, 200, 200, 0])
		assert.deepEqual(row.plan.pills.map((p) => [p.e, p.n, p.mine, p.x, p.w]), [['1f44d', 2, true, 0, 39], ['2764-fe0f', 1, false, 43, 39]])
		assert.deepEqual(row.plan.add, { x: 86, w: 24 })
		assert.equal(row.add, true, 'always at the end of a row')
		assert.deepEqual(rowStat(row), { id: A, shown: [['1f44d', 2, true], ['2764-fe0f', 1, false]], more: 0, add: true })
		assert.equal(rowOf(m, B, state()), null, 'no reaction and neither hovered nor selected')
		assert.equal(rowOf(m, S, state()), null, 'a shape has no row')
		assert.deepEqual(rowStat(rowOf(m, B, state({ hover: B }))), { id: B, shown: [], more: 0, add: true }, 'hovered: the button bottom left')
		assert.deepEqual(rowStat(rowOf(m, B, state({ selected: B }))).add, true, 'the selected note')
		assert.equal(rowOf(m, B, state({ selected: B, canReact: false })), null, 'nobody may react: no button')
		assert.equal(rowOf(m, B, state({ selected: B, hidden: new Set([B]) })), null, 'dragged, transformed or in the editor')
		assert.deepEqual(rowStat(rowOf(m, A, state({ hidden: new Set([A]) }))), { id: A, shown: [['1f44d', 2, true], ['2764-fe0f', 1, false]], more: 0, add: false }, 'the pills stay')
		assert.deepEqual(rowStat(rowOf(m, A, state({ canReact: false }))).add, false, 'view sees the pills')
		assert.deepEqual(rowOf(m, A, state({ canReact: false })).plan.add, null, 'no room kept for a button')
		assert.deepEqual(planReactions(m, [A, B, S], state()).map((r) => r.id), [A])
	})

	test('LOD: below LOD_TEXT_SCALE neither row nor hit nor band', () => {
		const m = model([reacted()])
		assert.equal(planReactions(m, [A], state({ scale: LOD_TEXT_SCALE - 0.01 })).length, 0)
		assert.equal(planReactions(m, [A], state({ scale: LOD_TEXT_SCALE })).length, 1)
		assert.equal(reactionAt(m, { x: 110, y: ROW_Y }, state({ scale: 0.2 })), null)
		assert.equal(reactionBand(m, A, state({ scale: 0.2, selected: A })), 0)
		assert.equal(reactionBand(m, A, state({ selected: A })), REACT_BAND)
		assert.equal(bandAt(m, { x: 110, y: ROW_Y }, state({ scale: 0.2 })), null)
	})

	test('the hit test: pills, "+n", the button, in the rotated axes; the tolerance never reaches into the note', () => {
		const m = model([reacted()])
		const at = (x, y, o = {}) => {
			const hit = reactionAt(m, { x, y }, state(), o)
			return hit ? [hit.id, hit.kind, hit.e] : null
		}
		assert.deepEqual(at(110, ROW_Y), [A, 'pill', '1f44d'])
		assert.deepEqual(at(150, ROW_Y), [A, 'pill', '2764-fe0f'])
		assert.deepEqual(at(195, ROW_Y), [A, 'add', null])
		assert.equal(at(141, ROW_Y), null, 'the gap between two pills')
		assert.deepEqual(at(141, ROW_Y, { tolWorld: 4 }), [A, 'pill', '1f44d'], 'the nearest part within the tolerance')
		assert.equal(at(110, 305), null, 'between the note and its row')
		assert.equal(at(110, 298, { tolWorld: 12 }), null, 'never inside the note')
		assert.deepEqual(at(110, 306, { tolWorld: 12 }), [A, 'pill', '1f44d'])
		// rotated 90° around the centre (200, 200): the row's left end lies at the top right of the note
		const r = model([reacted(A, { r: 90 })])
		const hit = reactionAt(r, { x: 200 - 100 - REACT_GAP - REACT_H / 2, y: 110 }, state())
		assert.deepEqual([hit?.id, hit?.kind, hit?.e], [A, 'pill', '1f44d'], 'the row turns with the note')
		// "+n" when not all fit
		const narrow = model([note(A, { x: 0, y: 0, w: 60, h: 60, data: { react: structuredClone(REACT) } })])
		const row = rowOf(narrow, A, state())
		assert.deepEqual(rowStat(row), { id: A, shown: [], more: 2, add: true })
		const more = reactionAt(narrow, { x: 5, y: 60 + REACT_GAP + 5 }, state())
		assert.equal(more.kind, 'more')
	})

	test('job 183 AK1: everyNote: a note without reactions gets the button where its row starts, rotated with it; hidden, canReact false, LOD, EXPORT_REACT: none', () => {
		const m = model([reacted(), note(B, { x: 400, y: 100 }), note(S, { x: 700, y: 100, r: 90 })])
		const every = (o = {}) => state({ everyNote: true, ...o })
		const row = rowOf(m, B, every())
		assert.deepEqual(rowStat(row), { id: B, shown: [], more: 0, add: true })
		assert.deepEqual(row.plan.add, { x: 0, w: REACT_ADD }, 'left aligned')
		assert.deepEqual(rowParts(row), [{ kind: 'add', e: null, x: 0, w: REACT_ADD }])
		const hitB = reactionAt(m, { x: 400 + REACT_ADD / 2, y: ROW_Y }, every())
		assert.deepEqual([hitB?.id, hitB?.kind], [B, 'add'], 'REACT_GAP below the bottom edge, at x 0')
		assert.equal(reactionAt(m, { x: 400 + REACT_ADD / 2, y: 100 + 200 + REACT_GAP - 1 }, every()), null, 'not above y h + REACT_GAP')
		assert.equal(rowOf(m, A, every()).plan.add.x, 86, 'with reactions: at the end of the row, as before')
		// rotated 90° around its centre (800, 200): the start of the row lies left of the note, at its top
		const turned = rowOf(m, S, every())
		assert.deepEqual([turned.r, turned.add, turned.plan.add.x], [90, true, 0])
		const hitS = reactionAt(m, { x: 800 - 100 - REACT_GAP - REACT_H / 2, y: 100 + REACT_ADD / 2 }, every())
		assert.deepEqual([hitS?.id, hitS?.kind], [S, 'add'], 'the button turns with the note')
		assert.equal(reactionAt(m, { x: 700 + REACT_ADD / 2, y: ROW_Y }, every()), null, 'not where it would stand unrotated')
		assert.deepEqual(planReactions(m, [A, B, S], every()).map((r) => r.id), [A, B, S], 'every note in view')
		// no row at all
		const at = { x: 400 + REACT_ADD / 2, y: ROW_Y }
		assert.equal(rowOf(m, B, every({ hidden: new Set([B]) })), null, 'hidden')
		assert.equal(reactionAt(m, at, every({ hidden: new Set([B]) })), null)
		assert.equal(rowOf(m, B, every({ canReact: false })), null, 'canReact false')
		assert.equal(reactionAt(m, at, every({ canReact: false })), null)
		assert.equal(rowOf(m, B, every({ scale: LOD_TEXT_SCALE - 0.01 })), null, 'below LOD_TEXT_SCALE')
		assert.equal(reactionAt(m, at, every({ scale: LOD_TEXT_SCALE - 0.01 }), { tolWorld: 12 }), null)
		assert.deepEqual(planReactions(m, [A, B, S], every({ scale: LOD_TEXT_SCALE - 0.01 })), [])
		// without everyNote as before
		assert.equal(rowOf(m, B, state()), null, 'no everyNote: neither hovered nor selected, no row')
		assert.equal(rowOf(m, B, state({ everyNote: 'yes' })), null, 'only true counts')
		assert.equal(REACT_NONE.everyNote, false)
		assert.equal(EXPORT_REACT.everyNote, false)
		assert.equal(rowOf(m, B, EXPORT_REACT), null, 'the PNG export paints no button')
		assert.equal(rowOf(m, A, EXPORT_REACT).add, false)
		assert.equal(rowOf(m, B, { ...REACT_NONE, everyNote: true }), null, 'everyNote without canReact paints nothing')
	})

	test('job 183: a hit through the tolerance alone never counts inside any note; an exact hit on the button does', () => {
		// B 20 units below A (as after "+" or sorting): A's button (100…124, 308…332) reaches 12 units into B
		const m = model([note(A, { x: 100, y: 100 }), note(B, { x: 100, y: 320, z: 'a2' })])
		const st = state({ everyNote: true })
		const at = (x, y) => {
			const hit = reactionAt(m, { x, y }, st, { tolWorld: 12 })
			return hit ? [hit.id, hit.kind] : null
		}
		assert.deepEqual(at(110, 326), [A, 'add'], 'exactly on the part of A\'s button over B')
		assert.equal(at(130, 326), null, 'in B, within the tolerance of A\'s button: B\'s')
		assert.equal(at(110, 336), null, 'in B, just below A\'s button')
		assert.deepEqual(at(130, 314), [A, 'add'], 'between the notes the tolerance still counts')
		// the same in mode edit (no everyNote): the hovered note's button
		const hover = state({ hover: A })
		assert.equal(reactionAt(m, { x: 130, y: 326 }, hover, { tolWorld: 4 }), null)
		assert.deepEqual(reactionAt(m, { x: 110, y: 326 }, hover, { tolWorld: 4 })?.id, A)
	})

	test('bandAt: the band below a note (as wide as the note or its row), also without a row', () => {
		const m = model([reacted(), note(B, { x: 400, y: 100 })])
		assert.equal(bandAt(m, { x: 150, y: 320 }, state()), A)
		assert.equal(bandAt(m, { x: 450, y: 320 }, state()), B, 'no reaction: the band of where the button would be')
		assert.equal(bandAt(m, { x: 150, y: 200 }, state()), null, 'on the note itself')
		assert.equal(bandAt(m, { x: 150, y: 340 }, state()), null, 'below the band')
	})

	test('the painting: per row the note\'s transform, the pills with emoji and count, the button; the count of rows', () => {
		const calls = []
		const ctx = new Proxy({}, {
			get(t, name) {
				if (name in t) return t[name]
				return (...args) => calls.push([name, ...args])
			},
			set(t, name, v) {
				calls.push(['set ' + name, v])
				return true
			},
		})
		const m = model([reacted(A, { r: 30 })])
		assert.equal(paintReactions(ctx, planReactions(m, [A], state())), 1)
		assert.deepEqual(calls.find((c) => c[0] === 'rotate'), ['rotate', 30 * Math.PI / 180])
		const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
		assert.deepEqual(texts, ['👍', '2', '❤️', '1'])
		assert.ok(calls.some((c) => c[0] === 'set strokeStyle' && c[1] === '#0082c9'), 'the own pill has a blue edge')
		assert.equal(paintReactions(ctx, []), 0)
	})
})

describe('the scene (fake DOM)', () => {
	let h
	afterEach(() => {
		h?.restore()
		h = null
		mock.timers.reset()
	})

	/**
	 * @param {object[]} items WireItems
	 * @param {object} [o] scene options, canReact, touch (job 183)
	 * @return {object} harness
	 */
	function setup(items = [reacted(), note(B, { x: 400, y: 100 })], { scene = {}, canReact = true, touch = false } = {}) {
		h = setupScene(items, { scene })
		h.scene.setReactions({ canReact, me: ME, touch })
		h.frame()
		h.log.length = 0
		return h
	}
	const lastState = () => callsOf('setReactions').at(-1)?.[0] ?? null
	const tap = (x, y, type = 'mouse', id = 1) => {
		h.pointer('pointerdown', x, y, { pointerType: type, pointerId: id })
		h.pointer('pointerup', x, y, { pointerType: type, pointerId: id })
	}
	const selections = () => h.log.filter((e) => e[0] === 'onSelection')

	for (const type of ['mouse', 'pen', 'touch']) {
		test(`${type}: a tap on a pill reacts, on the button picks, on "+n" lists; nothing is selected`, () => {
			setup([reacted(), note(B, { x: 400, y: 100, w: 60, h: 60, data: { react: structuredClone(REACT) } })])
			tap(110, ROW_Y, type)
			assert.deepEqual(h.intents(), [{ type: 'react', id: A, e: '1f44d' }])
			tap(195, ROW_Y, type)
			const pick = h.intents().at(-1)
			assert.equal(pick.type, 'reactPick')
			assert.equal(pick.id, A)
			assert.deepEqual(pick.rect, { x: 186, y: 308, w: 24, h: 24 })
			tap(405, 100 + 60 + REACT_GAP + 5, type)
			assert.deepEqual([h.intents().at(-1).type, h.intents().at(-1).id], ['reactList', B])
			assert.deepEqual(selections(), [], 'no click on the canvas')
		})
	}

	test('mode vote: a tap on a pill reacts and votes nothing; viewers (canReact false) get no react, the list still opens', () => {
		setup(undefined, { scene: { mode: 'vote' } })
		h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
		h.frame()
		h.log.length = 0
		tap(110, ROW_Y)
		assert.deepEqual(h.intents(), [{ type: 'react', id: A, e: '1f44d' }])
		tap(150, 150)
		assert.equal(h.intents().at(-1).type, 'vote', 'the note itself still votes')
		h.scene.setReactions({ canReact: false, me: ME })
		h.frame()
		h.log.length = 0
		tap(110, ROW_Y)
		assert.deepEqual(h.intents(), [], 'a tap does nothing for viewers, and votes nothing either')
		assert.equal(lastState().canReact, false)
	})

	test('job 183 AK2: with touch everyNote holds in modes vote and view, not in mode edit, without touch or canReact; a switch hands the renderer a new state', () => {
		setup(undefined, { touch: true })
		assert.equal(lastState().everyNote, false, 'mode edit')
		const before = callsOf('setReactions').length
		h.scene.setMode('vote')
		h.frame()
		assert.equal(callsOf('setReactions').length, before + 1, 'edit → vote: a new state')
		assert.equal(lastState().everyNote, true, 'mode vote')
		assert.equal(lastState().canReact, true)
		h.scene.setMode('view')
		h.frame()
		assert.equal(lastState().everyNote, true, 'mode view')
		h.scene.setReactions({ canReact: true, me: ME, touch: false })
		h.frame()
		assert.equal(lastState().everyNote, false, 'touch false')
		h.scene.setReactions({ canReact: false, me: ME, touch: true })
		h.frame()
		assert.equal(lastState().everyNote, false, 'canReact false (view role, frozen)')
		h.scene.setReactions({ canReact: true, me: ME })
		h.frame()
		assert.equal(lastState().everyNote, false, 'touch missing')
		h.scene.setReactions({ canReact: true, me: ME, touch: true })
		h.frame()
		assert.equal(lastState().everyNote, true)
		h.scene.setMode('edit')
		h.frame()
		assert.equal(lastState().everyNote, false, 'back in mode edit')
	})

	test('job 183 AK3: mode vote with touch: a finger on the button of a note without reactions picks and votes nothing; in B beside A\'s button it votes B; exactly on A\'s button over B it picks A', () => {
		// B 20 units below A (as after "+" or sorting): A's button (100…124, 308…332) reaches 12 units into B
		setup([note(A, { x: 100, y: 100 }), note(B, { x: 100, y: 320, z: 'a2' })], { scene: { mode: 'vote' }, touch: true })
		h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
		h.frame()
		h.log.length = 0
		assert.equal(lastState().everyNote, true)
		tap(112, 520 + REACT_GAP + REACT_H / 2, 'touch')
		assert.deepEqual(h.intents(), [{ type: 'reactPick', id: B, rect: { x: 100, y: 528, w: 24, h: 24 } }], 'B\'s button: the picker, no vote')
		h.log.length = 0
		tap(124 + HIT_TOL_TOUCH_PX - 2, 326, 'touch')
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['vote', B]], 'in B, within the touch tolerance of A\'s button: a vote for B')
		h.log.length = 0
		tap(112, 326, 'touch')
		assert.deepEqual(h.intents().map((i) => [i.type, i.id]), [['reactPick', A]], 'exactly on A\'s button where it lies over B')
	})

	test('a long press on a pill shows the names (hold), no context menu, no selection, no touch marquee; its release is no tap', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		setup()
		for (const type of ['touch', 'pen', 'mouse']) {
			h.log.length = 0
			h.pointer('pointerdown', 110, ROW_Y, { pointerType: type, pointerId: 3 })
			mock.timers.tick(LONG_PRESS_MS)
			const names = h.intents('reactNames')
			assert.equal(names.length, 1, type)
			assert.deepEqual([names[0].id, names[0].e, names[0].hold], [A, '1f44d', true])
			const menu = h.pointer('contextmenu', 110, ROW_Y, { pointerType: type, pointerId: 3 })
			assert.equal(menu.defaultPrevented, true, 'the browser menu stays shut')
			h.pointer('pointerup', 110, ROW_Y, { pointerType: type, pointerId: 3 })
			assert.deepEqual(h.intents().map((i) => i.type), ['reactNames'], type + ': no contextMenu, no react')
			assert.deepEqual(selections(), [])
			assert.equal(h.scene.stats().holdRing, null)
		}
	})

	test('a press that moves on beyond the threshold is handed over: the marquee in mode edit, the pan in mode view', () => {
		setup()
		h.pointer('pointerdown', 110, ROW_Y)
		h.pointer('pointermove', 112, ROW_Y)
		assert.equal(callsOf('setMarquee').filter((c) => c[0] !== null).length, 0, 'within the threshold nothing happens')
		h.pointer('pointermove', 160, ROW_Y + 60)
		h.frame()
		assert.ok(callsOf('setMarquee').some((c) => c[0] !== null), 'the marquee from the press point')
		h.pointer('pointerup', 160, ROW_Y + 60)
		assert.deepEqual(h.intents('react'), [])
		h.restore()
		setup(undefined, { scene: { mode: 'view' } })
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 110, ROW_Y)
		h.pointer('pointermove', 150, ROW_Y + 40)
		h.frame()
		h.pointer('pointerup', 150, ROW_Y + 40)
		h.frame()
		const now = h.scene.getCamera()
		assert.deepEqual([now.x, now.y], [cam.x - 40, cam.y - 40], 'it panned the whole way since the press')
		assert.deepEqual(h.intents('react'), [])
	})

	test('a resting mouse shows the names after REACT_NAMES_MS and hides them when it leaves the pill; hover over a note or its band shows the button', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		setup()
		h.pointer('pointermove', 450, 200)
		h.frame()
		assert.equal(lastState().hover, B, 'over the note')
		h.pointer('pointermove', 450, 320)
		h.frame()
		assert.equal(lastState().hover, B, 'over its band')
		assert.equal(h.scene.stats().reactHover, B)
		h.pointer('pointermove', 110, ROW_Y)
		mock.timers.tick(REACT_NAMES_MS - 1)
		assert.deepEqual(h.intents('reactNames'), [])
		mock.timers.tick(1)
		assert.deepEqual(h.intents('reactNames').map((i) => [i.id, i.e, i.hold]), [[A, '1f44d', false]])
		h.pointer('pointermove', 112, ROW_Y)
		assert.equal(h.intents('reactNames').length, 1, 'the same pill')
		h.pointer('pointermove', 160, ROW_Y)
		assert.deepEqual(h.intents('reactNames').at(-1), { type: 'reactNames', id: null }, 'another pill: the names go')
		h.pointer('pointerleave', 0, 0)
		h.frame()
		assert.equal(lastState().hover, null)
		h.pointer('pointermove', 450, 200, { pointerType: 'touch' })
		h.frame()
		assert.equal(lastState().hover, null, 'a finger never hovers')
	})

	test('the button: on the one selected note, never with another tool, for viewers or while the note is dragged', () => {
		setup()
		h.scene.setSelection([B])
		h.frame()
		assert.equal(lastState().selected, B)
		assert.equal(lastState().canReact, true)
		h.scene.setTool('sticky')
		h.frame()
		assert.equal(lastState().canReact, false, 'mode edit: only the select tool')
		h.scene.setTool('select')
		h.scene.setReactions({ canReact: false, me: ME })
		h.frame()
		assert.equal(lastState().canReact, false)
		h.scene.setReactions({ canReact: true, me: ME })
		h.frame()
		h.pointer('pointerdown', 450, 200)
		h.pointer('pointermove', 470, 220)
		h.frame()
		assert.deepEqual([...lastState().hidden], [B], 'dragged')
		h.pointer('pointerup', 470, 220)
		h.frame()
		assert.deepEqual([...lastState().hidden], [])
	})

	test('the frame of the one selected note with a band: handles and the lower point 32 units further down (job 231: on the frame); without a band as before', () => {
		setup()
		const at = (list, name) => list.find((x) => x.name === name)
		h.scene.setSelection([A])
		h.frame()
		const withBand = h.scene.handles()
		assert.deepEqual([at(withBand, 'plus-b').x, at(withBand, 'plus-b').y], [200, 300 + REACT_BAND + 4])
		assert.deepEqual([at(withBand, 'br').x, at(withBand, 'br').y], [304, 300 + REACT_BAND + 4])
		assert.deepEqual([at(withBand, 'tl').x, at(withBand, 'tl').y], [96, 96], 'the top stays')
		h.scene.setReactions({ canReact: false, me: ME })
		h.scene.setSelection([B])
		h.frame()
		const plain = h.scene.handles()
		assert.deepEqual([at(plain, 'plus-b').x, at(plain, 'plus-b').y], [500, 304], 'no band: on the frame')
		assert.deepEqual([at(plain, 'br').x, at(plain, 'br').y], [604, 304])
		// the band counts like the gap: a press there drags the note
		h.scene.setReactions({ canReact: true, me: ME })
		h.frame()
		h.log.length = 0
		h.pointer('pointerdown', 480, 300 + REACT_GAP + 12)
		h.pointer('pointermove', 520, 340)
		h.frame()
		assert.ok(h.log.some((e) => e[0] === 'onActivity' && e[1].kind === 'drag' && e[1].active), 'the note is dragged from its band')
		h.pointer('pointerup', 520, 340)
	})
})
