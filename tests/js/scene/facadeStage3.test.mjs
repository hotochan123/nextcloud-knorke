/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Stage-3 facade of the scene (SPEC-M1 §6.3, §9.4 phase 0 rows 3.1 and
 * 3.1b = Revision 16, behaviour of WP-S3), deterministic in Node on the fake
 * DOM with the recording renderer stub of sceneHarness.mjs: setVoteState
 * checks a SceneVoteState strictly, values and color included (TypeError,
 * the old state stays) and null clears it; stats().voteState has the R16
 * shape {scope, markVotable, rings, badges, totals, outline} with the
 * counters of the renderer's last painting (the stub paints nothing unless
 * a test sets setStubVoteDrawn); followTo glides over the CSS path for a
 * finite ms > 0 (exactly to the target, onCamera, no onUserCamera, no
 * gesture activity), ms <= 0 and a non-finite ms jump, a target equal to
 * the confirmed camera draws nothing, false for invalid targets, before
 * mount, after destroy and while a user camera gesture runs; stopFollow is
 * safe at any time; getViewport is the world rectangle of the confirmed
 * camera; cameraForRect has no 100 % limit and honours padPx. The last group
 * pins the stage-3 types of the JSDoc (frozen cross-contracts). The glide
 * itself: cameraPaths.test.mjs; vote, voteMiss, press: voteMode.test.mjs.
 */
import { test, describe, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WHEEL_END_MS } from '../../../src/scene/GestureController.js'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { MAX_SCALE } from '../../../src/model/tokens.js'
import { PALETTE, colorFor } from '../../../src/sync/presence.js'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setStubVoteDrawn, setupScene } from './sceneHarness.mjs'
import { ROOT } from './sourceScan.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const F = '01JA0000000000000000000009'

let h
afterEach(() => {
	h?.restore()
	h = null
})

/**
 * Mounted scene (1000 × 800, camera {0, 0, 1}) that records every onCamera in h.cams.
 *
 * @param {object[]} [items] WireItems
 * @return {object} sceneHarness plus cams
 */
function setup(items = [note(A), note(B, { x: 300 })]) {
	const cams = []
	const hh = setupScene(items, { on: { onCamera: (c) => cams.push(c) } })
	cams.length = 0
	hh.cams = cams
	return hh
}

/**
 * @param {object} [o] fields that replace the defaults
 * @return {object} a valid SceneVoteState
 */
const voteState = (o = {}) => ({
	votable: (id) => id === A,
	scope: null,
	badges: new Map([[A, { mine: 1, total: null }]]),
	markVotable: true,
	color: '#c62828',
	...o,
})

/**
 * stats().voteState while the renderer has drawn nothing (the stub): every counter 0, outline null.
 *
 * @param {string|null} scope scope of the state
 * @param {boolean} markVotable markVotable of the state
 * @return {object} the expected stats().voteState
 */
const drawnNone = (scope, markVotable) => ({ scope, markVotable, rings: 0, badges: 0, totals: 0, outline: null })

/** One frame 100 ms later: the camera is applied and a throttled onCamera is out. */
const settle = () => h.frame(100)

/**
 * Runs frames of 16 ms until a followTo promise settles (a glide of up to 3 s).
 *
 * @param {Promise<boolean>} p followTo promise
 * @return {Promise<boolean|null>} its value (null when it never settled)
 */
async function arrive(p) {
	let v = null
	let done = false
	p.then((x) => {
		v = x
		done = true
	})
	await Promise.resolve()
	for (let i = 0; i < 200 && !done; i++) {
		h.frame(16)
		await Promise.resolve()
	}
	return v
}

describe('setVoteState (SceneVoteState, §6.3, values R16)', () => {
	test('accepts a SceneVoteState and keeps a checked copy; null clears it; no callback fires', () => {
		h = setup()
		assert.equal(h.scene.stats().voteState, null, 'none before the first call')
		h.scene.setVoteState(voteState())
		assert.deepEqual(h.scene.stats().voteState, drawnNone(null, true))
		h.scene.setVoteState(voteState({
			scope: F,
			badges: new Map([[A, { mine: 0, total: 3 }], [B, { mine: 2, total: 5 }]]),
			markVotable: false,
			color: '#1565C0',
		}))
		assert.deepEqual(h.scene.stats().voteState, drawnNone(F, false))
		const m = new Map()
		h.scene.setVoteState(voteState({ badges: m }))
		// the check runs at the call: a later (even invalid) change of the caller's Map throws nothing
		m.set(A, { mine: -1, total: 'x' })
		assert.deepEqual(h.scene.stats().voteState, drawnNone(null, true))
		h.scene.setVoteState({ ...voteState(), extra: 'ignored', rings: 'ignored' })
		assert.deepEqual(h.scene.stats().voteState, drawnNone(null, true), 'keys beyond the typedef are ignored')
		h.scene.setVoteState(null)
		assert.equal(h.scene.stats().voteState, null)
		h.frame()
		assert.deepEqual(h.log, [], 'no intent, no activity, no camera: setVoteState only keeps and hands on the state')
		assert.ok(callsOf('setVoteBadges').length >= 1, 'handed to the renderer')
		assert.equal(callsOf('setVoteBadges').at(-1)[0], null, 'null clears the renderer too')
	})

	test('accepted values: counts 0 and up, total null, an empty Map, any colour [C] can pass (colorFor over PALETTE), either case', () => {
		h = setup()
		const ok = [
			['mine 0, total 0', voteState({ badges: new Map([[A, { mine: 0, total: 0 }]]) })],
			['mine 0, total null', voteState({ badges: new Map([[A, { mine: 0, total: null }]]) })],
			['large counts', voteState({ badges: new Map([[A, { mine: 99, total: 1000000 }]]) })],
			['empty badges', voteState({ badges: new Map() })],
			['scope a frame id', voteState({ scope: F })],
			['color upper case', voteState({ color: '#C62828' })],
			['color mixed case', voteState({ color: '#aBcDeF' })],
			['color black', voteState({ color: '#000000' })],
			['color white', voteState({ color: '#ffffff' })],
			...PALETTE.map((c) => [`PALETTE ${c}`, voteState({ color: c })]),
			...['', 'u1', 'guest:7f3a', 'alice'].map((pid) => [`colorFor(${JSON.stringify(pid)})`, voteState({ color: colorFor(pid) })]),
		]
		for (const [label, value] of ok) {
			assert.doesNotThrow(() => h.scene.setVoteState(value), label)
			assert.deepEqual(h.scene.stats().voteState, drawnNone(value.scope, value.markVotable), label)
		}
	})

	test('every deviation throws a TypeError naming the field, and the previous state stays', () => {
		h = setup()
		h.scene.setVoteState(voteState({ scope: F }))
		const fine = { mine: 1, total: null }
		const color = '#c62828'
		const badge = (b) => voteState({ badges: new Map([[A, b]]) })
		const cases = [
			['undefined', undefined, 'state'],
			['string', 'vote', 'state'],
			['number', 42, 'state'],
			['boolean', true, 'state'],
			['array', [], 'state'],
			['function', () => true, 'state'],
			['empty object', {}, 'votable'],
			['votable missing', { scope: null, badges: new Map(), markVotable: true, color }, 'votable'],
			['votable not a function', voteState({ votable: true }), 'votable'],
			['votable null', voteState({ votable: null }), 'votable'],
			['scope missing', { votable: () => true, badges: new Map(), markVotable: true, color }, 'scope'],
			['scope a number', voteState({ scope: 7 }), 'scope'],
			['scope an object', voteState({ scope: { id: F } }), 'scope'],
			['badges missing', { votable: () => true, scope: null, markVotable: true, color }, 'badges'],
			['badges a plain object', voteState({ badges: { [A]: fine } }), 'badges'],
			['badges an array of pairs', voteState({ badges: [[A, fine]] }), 'badges'],
			['badges null', voteState({ badges: null }), 'badges'],
			['markVotable missing', { votable: () => true, scope: null, badges: new Map(), color }, 'markVotable'],
			['markVotable a string', voteState({ markVotable: 'true' }), 'markVotable'],
			['markVotable a number', voteState({ markVotable: 1 }), 'markVotable'],
			['markVotable null', voteState({ markVotable: null }), 'markVotable'],
			// (R16) color #rrggbb
			['color missing', { votable: () => true, scope: null, badges: new Map(), markVotable: true }, 'color'],
			['color undefined', voteState({ color: undefined }), 'color'],
			['color null', voteState({ color: null }), 'color'],
			['color a number', voteState({ color: 0xc62828 }), 'color'],
			['color a String object', voteState({ color: Object('#c62828') }), 'color'],
			['color empty', voteState({ color: '' }), 'color'],
			['color #rgb', voteState({ color: '#fff' }), 'color'],
			['color #rrggbbaa', voteState({ color: '#c62828ff' }), 'color'],
			['color five digits', voteState({ color: '#c6282' }), 'color'],
			['color without #', voteState({ color: 'c62828' }), 'color'],
			['color not hex', voteState({ color: '#gggggg' }), 'color'],
			['color a name', voteState({ color: 'red' }), 'color'],
			['color rgb()', voteState({ color: 'rgb(198, 40, 40)' }), 'color'],
			['color leading space', voteState({ color: ' #c62828' }), 'color'],
			['color trailing newline', voteState({ color: '#c62828\n' }), 'color'],
			// badges: keys and values
			['badge key a number', voteState({ badges: new Map([[1, fine]]) }), 'badge keys'],
			['badge value null', badge(null), '{mine, total}'],
			['badge value a number', badge(1), '{mine, total}'],
			['badge mine missing', badge({ total: null }), 'mine'],
			['badge mine a string', badge({ mine: '1', total: null }), 'mine'],
			['badge mine NaN', badge({ mine: NaN, total: null }), 'mine'],
			['badge mine Infinity', badge({ mine: Infinity, total: null }), 'mine'],
			['badge mine negative', badge({ mine: -1, total: null }), 'mine'],
			['badge mine fractional', badge({ mine: 1.5, total: null }), 'mine'],
			['badge mine null', badge({ mine: null, total: null }), 'mine'],
			['badge mine a boolean', badge({ mine: true, total: null }), 'mine'],
			['badge total missing', badge({ mine: 1 }), 'total'],
			['badge total undefined', badge({ mine: 1, total: undefined }), 'total'],
			['badge total a string', badge({ mine: 1, total: '3' }), 'total'],
			['badge total Infinity', badge({ mine: 1, total: Infinity }), 'total'],
			['badge total NaN', badge({ mine: 1, total: NaN }), 'total'],
			['badge total negative', badge({ mine: 1, total: -1 }), 'total'],
			['badge total fractional', badge({ mine: 1, total: 2.5 }), 'total'],
			['badge total a boolean', badge({ mine: 1, total: false }), 'total'],
		]
		for (const [label, value, field] of cases) {
			assert.throws(() => h.scene.setVoteState(value), (e) => e instanceof TypeError && e.message.includes(field), label)
			assert.deepEqual(h.scene.stats().voteState, drawnNone(F, true), `${label}: previous state kept`)
		}
		// a bad badge after good ones: nothing of the call is taken over
		assert.throws(() => h.scene.setVoteState(voteState({ markVotable: false, badges: new Map([[A, fine], [B, { mine: 1, total: 'x' }]]) })), TypeError)
		assert.deepEqual(h.scene.stats().voteState, drawnNone(F, true))
	})

	test('before mount the state is kept; after destroy a valid one is ignored, a wrong one still throws', () => {
		h = setup()
		const s = new SceneManager(h.dom.doc.createElement('div'), new SceneModel(), { callbacks: {} })
		s.setVoteState(voteState({ scope: F }))
		assert.deepEqual(s.stats().voteState, drawnNone(F, true))
		s.destroy()
		s.setVoteState(null)
		assert.deepEqual(s.stats().voteState, drawnNone(F, true), 'ignored after destroy')
		assert.throws(() => s.setVoteState({}), TypeError)
		assert.throws(() => s.setVoteState(voteState({ color: '#fff' })), TypeError, 'the colour is checked after destroy too')
	})
})

describe('stats().voteState (§6.3, §6.7, R16)', () => {
	test('null without a SceneVoteState, else exactly {scope, markVotable, rings, badges, totals, outline}; counters 0 and outline null while nothing is drawn', () => {
		h = setup([note(A), note(B, { x: 300 })])
		const keys = ['badges', 'markVotable', 'outline', 'rings', 'scope', 'totals']
		assert.equal(h.scene.stats().voteState, null)
		h.scene.setMode('vote')
		h.scene.setVoteState(voteState({
			scope: F,
			badges: new Map([[A, { mine: 2, total: 4 }], [B, { mine: 0, total: 1 }]]),
			markVotable: true,
		}))
		h.frame()
		settle()
		const v = h.scene.stats().voteState
		assert.deepEqual(Object.keys(v).sort(), keys, 'no color, no votable, no badge Map in the stats')
		assert.deepEqual(v, drawnNone(F, true), 'the stub renderer drew nothing, even with badges, totals, markVotable and a scope')
		assert.deepEqual(JSON.parse(JSON.stringify(v)), v, 'JSON-serialisable (__knorke.scene())')
		assert.notEqual(h.scene.stats().voteState, v, 'a fresh object per call')
		h.scene.setMode('view')
		assert.deepEqual(h.scene.stats().voteState, drawnNone(F, true), 'independent of the mode')
		h.scene.setVoteState(null)
		assert.equal(h.scene.stats().voteState, null)
		const s = new SceneManager(h.dom.doc.createElement('div'), new SceneModel(), { callbacks: {} })
		assert.equal(s.stats().voteState, null, 'before mount without a state')
		s.setVoteState(voteState())
		assert.deepEqual(s.stats().voteState, drawnNone(null, true), 'before mount with a state')
		s.destroy()
	})
})

describe('stats().voteState counts what the renderer drew (CLI-03)', () => {
	test('the counters of the last badge painting, in the R16 key order; scope and markVotable from the state; NONE after destroy', () => {
		h = setup()
		h.scene.setVoteState(voteState({ scope: F }))
		setStubVoteDrawn({ rings: 3, badges: 2, totals: 1, outline: F })
		const v = h.scene.stats().voteState
		assert.deepEqual(Object.keys(v), ['scope', 'markVotable', 'rings', 'badges', 'totals', 'outline'])
		assert.deepEqual(v, { scope: F, markVotable: true, rings: 3, badges: 2, totals: 1, outline: F })
		setStubVoteDrawn({ rings: 0, badges: 0, totals: 0, outline: null, extra: 9 })
		assert.deepEqual(h.scene.stats().voteState, drawnNone(F, true), 'only the four counters')
		setStubVoteDrawn(null)
		assert.deepEqual(h.scene.stats().voteState, drawnNone(F, true), 'nothing painted yet')
		h.scene.setVoteState(null)
		setStubVoteDrawn({ rings: 1, badges: 1, totals: 1, outline: F })
		assert.equal(h.scene.stats().voteState, null, 'no state: null, whatever the renderer says')
		h.scene.setVoteState(voteState())
		h.scene.destroy()
		assert.deepEqual(h.scene.stats().voteState, drawnNone(null, true), 'after destroy nothing is drawn')
	})

	test('setVoteState hands the renderer the badges, a boolean votable (=== true only, S-13), markVotable, scope and color', () => {
		h = setup()
		let throws = 0
		const answers = new Map([[A, true], [B, 1]])
		h.scene.setVoteState(voteState({ votable: (id) => {
			if (id === F) {
				throws++
				throw new Error('boom')
			}
			return answers.get(id)
		}, scope: F, color: '#1565C0' }))
		const [arg] = callsOf('setVoteBadges').at(-1)
		assert.deepEqual([arg.markVotable, arg.scope, arg.color, [...arg.badges.keys()]], [true, F, '#1565C0', [A]])
		assert.equal(arg.votable(A), true)
		assert.equal(arg.votable(B), false, 'a truthy 1 is not votable')
		assert.equal(arg.votable('unknown'), false, 'undefined is not votable')
		const errs = []
		const saved = globalThis.reportError
		globalThis.reportError = (e) => errs.push(e)
		try {
			assert.equal(arg.votable(F), false, 'a throwing votable counts as false')
			assert.equal(arg.votable(F), false)
		} finally {
			globalThis.reportError = saved
		}
		assert.equal(throws, 1, 'cached until the next state or model change')
		assert.equal(errs.length, 1, 'reported once')
		h.scene.update(h.model.apply({ upserts: [note(B, { x: 10 })] }))
		assert.equal(arg.votable(F), false)
		assert.equal(throws, 2, 'a model change clears the cache')
	})
})

describe('followTo / stopFollow (§6.3 "Folgen", R16)', () => {
	test('a glide resolves true exactly at the target: the CSS path (no direct draw), onCamera, no onUserCamera, no gesture activity', async () => {
		h = setup()
		const target = { x: -321.5, y: 87.25, scale: 1.75 }
		const p = h.scene.followTo(target, 600)
		assert.ok(p instanceof Promise)
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the confirmed camera stays while gliding')
		assert.equal(h.scene.stats().gliding, true)
		const directBefore = callsOf('setCamera').length
		assert.equal(await arrive(p), true)
		assert.deepEqual(h.scene.getCamera(), target)
		assert.equal(callsOf('setCamera').length, directBefore, 'no direct draw')
		assert.equal(callsOf('beginGesture').length, 1)
		assert.ok(callsOf('gestureFrame').length >= 30, 'CSS steps')
		assert.deepEqual(callsOf('endGesture'), [[target]], 'one end, at the target')
		assert.deepEqual(h.cams.at(-1), target, 'the last onCamera is the target')
		assert.deepEqual(h.log, [], 'neither onUserCamera nor onActivity (gesture or any other)')
		assert.equal(h.scene.stats().gestureActive, false)
		assert.equal(h.scene.stats().gliding, false)
	})

	test('(1) ms <= 0 and a non-finite ms jump and resolve true at once; a finite ms > 0 glides', async () => {
		h = setup()
		const msList = [0, -5, -Infinity, NaN, Infinity, undefined, null, '600']
		for (const [i, ms] of msList.entries()) {
			const cam = { x: 10 * (i + 1), y: -20 * (i + 1), scale: 0.5 + i / 10 }
			assert.equal(await h.scene.followTo(cam, ms), true, `ms ${String(ms)}`)
			assert.deepEqual(h.scene.getCamera(), cam, `ms ${String(ms)}: at the target at once`)
		}
		settle()
		assert.equal(callsOf('beginGesture').length + callsOf('gestureFrame').length + callsOf('endGesture').length, 0, 'no CSS path for a jump')
		for (const [i, ms] of [1, 300, 2000].entries()) {
			const cam = { x: 7 * (i + 1), y: 3, scale: 1 + i / 10 }
			const p = h.scene.followTo(cam, ms)
			assert.equal(h.scene.stats().gliding, true, `ms ${ms} glides`)
			assert.equal(await arrive(p), true)
			assert.deepEqual(h.scene.getCamera(), cam)
		}
		assert.equal(callsOf('endGesture').length, 3)
		assert.equal(h.log.filter((e) => e[0] === 'onUserCamera' || e[0] === 'onActivity').length, 0)
	})

	test('(3) a target equal to the confirmed camera (< 0.5 screen px, scale ±0.1 %, after clamping) draws nothing, no onCamera, true', async () => {
		h = setup()
		settle()
		const draws = () => callsOf('setCamera').length
		let n = draws()
		assert.equal(await h.scene.followTo({ x: 0, y: 0, scale: 1 }, 600), true, 'the same camera')
		assert.equal(await h.scene.followTo({ x: 0.3, y: -0.3, scale: 1.0009 }, 600), true, '0.42 px away, scale +0.09 %')
		assert.equal(await h.scene.followTo({ x: 0, y: 0, scale: 0.9991 }, 0), true, 'scale −0.09 %, ms 0')
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'the camera stays exactly as it was')
		settle()
		assert.equal(draws(), n, 'nothing drawn')
		assert.deepEqual(h.cams, [], 'no onCamera')

		assert.equal(await h.scene.followTo({ x: 0.4, y: 0.4, scale: 1 }, 0), true, '0.57 px away (0.4 px on each axis, the distance counts): moves')
		assert.deepEqual(h.scene.getCamera(), { x: 0.4, y: 0.4, scale: 1 })
		settle()
		assert.equal(draws(), ++n)
		assert.equal(await h.scene.followTo({ x: 1, y: 0.4, scale: 1 }, 0), true, '0.6 px away: moves')
		assert.deepEqual(h.scene.getCamera(), { x: 1, y: 0.4, scale: 1 })
		settle()
		assert.equal(draws(), ++n)
		assert.equal(await h.scene.followTo({ x: 1, y: 0.4, scale: 1.002 }, 0), true, 'scale +0.2 %: moves')
		assert.deepEqual(h.scene.getCamera(), { x: 1, y: 0.4, scale: 1.002 })
		settle()
		assert.equal(draws(), ++n)

		// the distance counts in screen px at the confirmed scale
		h.scene.setCamera({ x: 0, y: 0, scale: 2 })
		settle()
		n = draws()
		h.cams.length = 0
		assert.equal(await h.scene.followTo({ x: 0.2, y: 0, scale: 2 }, 600), true, '0.2 world = 0.4 px at scale 2')
		settle()
		assert.equal(draws(), n, 'nothing drawn')
		assert.deepEqual(h.cams, [])
		assert.equal(await h.scene.followTo({ x: 0.3, y: 0, scale: 2 }, 0), true, '0.3 world = 0.6 px at scale 2')
		assert.deepEqual(h.scene.getCamera(), { x: 0.3, y: 0, scale: 2 })
		settle()
		assert.equal(draws(), ++n)

		// (6) the scale is clamped first: beyond MAX_SCALE at the same corner is the same camera
		h.scene.setCamera({ x: 5, y: 6, scale: MAX_SCALE })
		settle()
		n = draws()
		h.cams.length = 0
		assert.equal(await h.scene.followTo({ x: 5, y: 6, scale: 100 * MAX_SCALE }, 600), true)
		settle()
		assert.equal(draws(), n, 'nothing drawn')
		assert.deepEqual(h.cams, [])
		assert.deepEqual(h.scene.getCamera(), { x: 5, y: 6, scale: MAX_SCALE })
		assert.deepEqual(h.log, [], 'never onUserCamera or onActivity')
	})

	test('an invalid target resolves false (never rejects) and leaves the camera alone', async () => {
		h = setup()
		const cases = [
			null, undefined, 'cam', [0, 0, 1], {}, { x: 0, y: 0 }, { x: NaN, y: 0, scale: 1 }, { x: 0, y: Infinity, scale: 1 },
			{ x: 0, y: 0, scale: 0 }, { x: 0, y: 0, scale: -1 }, { x: '1', y: 0, scale: 1 }, { x: 0, y: 0, scale: NaN },
		]
		for (const cam of cases) {
			assert.equal(await h.scene.followTo(cam, 600), false, JSON.stringify(cam) ?? String(cam))
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		}
		settle()
		assert.deepEqual(h.cams, [], 'no onCamera')
		assert.deepEqual(h.log, [])
	})

	test('a scale beyond the zoom range is clamped exactly as setCamera clamps it', async () => {
		h = setup()
		assert.equal(await arrive(h.scene.followTo({ x: 5, y: 6, scale: 100 }, 600)), true)
		const viaFollow = h.scene.getCamera()
		h.scene.setCamera({ x: 0, y: 0, scale: 1 })
		h.scene.setCamera({ x: 5, y: 6, scale: 100 })
		assert.deepEqual(viaFollow, h.scene.getCamera())
		assert.equal(viaFollow.scale, MAX_SCALE)
	})

	test('a running user camera gesture wins: during a wheel gesture and a hand-tool pan followTo resolves false', async () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			h = setup()
			const target = { x: 400, y: 400, scale: 2 }
			dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 30, deltaMode: 0 })
			assert.equal(h.scene.stats().gestureActive, true)
			const users = () => h.log.filter((e) => e[0] === 'onUserCamera').length
			const before = users()
			assert.equal(await h.scene.followTo(target, 600), false, 'wheel gesture (CSS path) runs')
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'confirmed camera untouched')
			assert.equal(h.scene.stats().gestureActive, true, 'the gesture is not cut off')
			assert.equal(h.scene.stats().liveCamera.y, 30)
			mock.timers.tick(WHEEL_END_MS)
			assert.equal(h.scene.stats().gestureActive, false)
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 30, scale: 1 }, 'the wheel camera is kept')
			assert.equal(await arrive(h.scene.followTo(target, 600)), true, 'after the gesture')
			assert.deepEqual(h.scene.getCamera(), target)

			h.scene.setTool('hand')
			h.pointer('pointerdown', 500, 400)
			assert.equal(await h.scene.followTo({ x: 0, y: 0, scale: 1 }, 600), false, 'pan pressed, not moved yet')
			h.pointer('pointermove', 450, 400)
			h.frame()
			const panned = h.scene.getCamera()
			assert.equal(await h.scene.followTo({ x: 0, y: 0, scale: 1 }, 600), false, 'pan moving')
			assert.deepEqual(h.scene.getCamera(), panned)
			h.pointer('pointerup', 450, 400)
			assert.equal(await arrive(h.scene.followTo({ x: 0, y: 0, scale: 1 }, 600)), true, 'after the pan')
			assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
			assert.equal(users() - before, 1, 'only the pan (a user camera change) reported onUserCamera, followTo never')
		} finally {
			mock.timers.reset()
		}
	})

	test('not mounted or destroyed: followTo resolves false', async () => {
		h = setup()
		const s = new SceneManager(h.dom.doc.createElement('div'), new SceneModel(), { callbacks: {} })
		assert.equal(await s.followTo({ x: 1, y: 2, scale: 1 }, 600), false, 'before mount')
		s.destroy()
		h.scene.destroy()
		assert.equal(await h.scene.followTo({ x: 1, y: 2, scale: 1 }, 600), false, 'after destroy')
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
	})

	test('stopFollow is safe at any time: without a follow, after one, twice, unmounted, after destroy', async () => {
		h = setup()
		assert.equal(h.scene.stopFollow(), undefined)
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 })
		const target = { x: 50, y: 60, scale: 0.75 }
		assert.equal(await arrive(h.scene.followTo(target, 600)), true)
		h.scene.stopFollow()
		h.scene.stopFollow()
		settle()
		assert.deepEqual(h.scene.getCamera(), target, 'a finished glide stays')
		const ends = callsOf('endGesture').length
		const p = h.scene.followTo({ x: 0, y: 0, scale: 1 }, 600)
		h.frame(16)
		h.frame(16)
		h.scene.stopFollow()
		assert.equal(await p, false, 'a running glide ends false')
		assert.equal(callsOf('endGesture').length, ends + 1, 'with one end draw')
		const stopped = h.scene.getCamera()
		assert.ok(stopped.x > 0 && stopped.x < 50, 'at the camera shown, part of the way back')
		h.scene.stopFollow()
		assert.equal(callsOf('endGesture').length, ends + 1, 'a second stopFollow does nothing')
		assert.deepEqual(h.log, [])
		const s = new SceneManager(h.dom.doc.createElement('div'), new SceneModel(), { callbacks: {} })
		s.stopFollow()
		s.destroy()
		s.stopFollow()
		h.scene.destroy()
		h.scene.stopFollow()
	})
})

describe('getViewport (confirmed camera, §6.3)', () => {
	test('container size / scale, origin from the camera: at start, after setCamera, after followTo', async () => {
		h = setup()
		assert.deepEqual(h.scene.getViewport(), { x: 0, y: 0, w: 1000, h: 800 })
		h.scene.setCamera({ x: 100, y: -50, scale: 2 })
		assert.deepEqual(h.scene.getViewport(), { x: 100, y: -50, w: 500, h: 400 }, 'at once')
		settle()
		assert.deepEqual(h.scene.getViewport(), { x: 100, y: -50, w: 500, h: 400 })
		assert.equal(await arrive(h.scene.followTo({ x: -300, y: 200, scale: 0.5 }, 600)), true)
		assert.deepEqual(h.scene.getViewport(), { x: -300, y: 200, w: 2000, h: 1600 })
		h.scene.zoomBy(2, { x: 0, y: 0 })
		assert.deepEqual(h.scene.getViewport(), { x: -300, y: 200, w: 1000, h: 800 })
	})

	test('during a CSS gesture it stays at the confirmed camera, like getCamera()', () => {
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			h = setup()
			dispatch(h.container, 'wheel', { deltaX: 0, deltaY: 30, deltaMode: 0 })
			assert.equal(h.scene.stats().liveCamera.y, 30)
			assert.deepEqual(h.scene.getViewport(), { x: 0, y: 0, w: 1000, h: 800 })
			mock.timers.tick(WHEEL_END_MS)
			assert.deepEqual(h.scene.getViewport(), { x: 0, y: 30, w: 1000, h: 800 })
		} finally {
			mock.timers.reset()
		}
	})

	test('before mount: camera origin, w = h = 0', () => {
		h = setup()
		const s = new SceneManager(h.dom.doc.createElement('div'), new SceneModel(), { callbacks: {} })
		assert.deepEqual(s.getViewport(), { x: 0, y: 0, w: 0, h: 0 })
		s.destroy()
	})
})

describe('cameraForRect (§6.3, since 1a; unchanged in stage 3)', () => {
	test('no 100 % limit: a rect smaller than the viewport gets scale > 1, fit() stops at 1; nothing is set', () => {
		h = setup()
		const rect = { x: 0, y: 0, w: 500, h: 400 }
		assert.deepEqual(h.scene.cameraForRect(rect), { x: 0, y: 0, scale: 2 })
		settle()
		assert.deepEqual(h.scene.getCamera(), { x: 0, y: 0, scale: 1 }, 'cameraForRect does not set the camera')
		assert.deepEqual(h.cams, [])
		h.scene.fit(rect, 0)
		assert.equal(h.scene.getCamera().scale, 1, 'fit() keeps its 100 % limit')
	})

	test('padPx: the limiting side keeps exactly padPx, the rect stays centred; the default is 0', () => {
		h = setup()
		const rect = { x: 0, y: 0, w: 500, h: 400 }
		const c = h.scene.cameraForRect(rect, 100)
		assert.equal(c.scale, 1.5, 'min((1000 − 200) / 500, (800 − 200) / 400)')
		const top = (rect.y - c.y) * c.scale
		const left = (rect.x - c.x) * c.scale
		assert.ok(Math.abs(top - 100) < 1e-9, `vertical margin ${top}`)
		assert.ok(Math.abs(left - 125) < 1e-9, `horizontal margin ${left}`)
		const wide = { x: 0, y: 0, w: 800, h: 300 }
		const cw = h.scene.cameraForRect(wide, 100)
		assert.equal(cw.scale, 1, 'width limits: (1000 − 200) / 800')
		assert.ok(Math.abs((wide.x - cw.x) * cw.scale - 100) < 1e-9, 'horizontal margin = padPx')
		assert.ok(Math.abs((wide.y - cw.y) * cw.scale - 250) < 1e-9, 'vertical: centred')
		assert.deepEqual(h.scene.cameraForRect(rect), h.scene.cameraForRect(rect, 0))
		assert.equal(h.scene.cameraForRect({ x: 0, y: 0, w: 50, h: 40 }, 0).scale, MAX_SCALE, 'clamped only by MAX_SCALE')
	})

	test('followTo(cameraForRect(view, 0)) shows the leader\'s view whole and centred (§6.5.6)', async () => {
		h = setup()
		const view = { x: 200, y: 100, w: 1600, h: 900 }
		assert.equal(await arrive(h.scene.followTo(h.scene.cameraForRect(view, 0), 600)), true)
		const vp = h.scene.getViewport()
		assert.ok(Math.abs(vp.x + vp.w / 2 - 1000) < 1e-9 && Math.abs(vp.y + vp.h / 2 - 550) < 1e-9, 'same centre')
		assert.ok(Math.abs(vp.w - view.w) < 1e-9, 'the limiting side fits exactly')
		assert.ok(vp.h >= view.h, 'the other side shows all of it')
	})
})

describe('stage-3 types in the JSDoc (frozen in phase 0, §6.3)', () => {
	const src = readFileSync(join(ROOT, 'src/scene/SceneManager.js'), 'utf8')

	test('SceneVoteState typedef matches §6.3 (R16: with color)', () => {
		assert.match(src, /@typedef \{\{votable:\(id:string\) => boolean, scope:\(string\|null\),\s*\n\s*\*\s*badges:Map<string, \{mine:number, total:\(number\|null\)\}>,\s*\n\s*\*\s*markVotable:boolean, color:string\}\} SceneVoteState/)
		assert.match(readFileSync(join(ROOT, 'src/scene/index.js'), 'utf8'), /@typedef \{import\('\.\/SceneManager\.js'\)\.SceneVoteState\} SceneVoteState/)
	})

	test('Intent has vote and voteMiss; onActivity kinds include press; RemoteSample has view', () => {
		assert.ok(src.includes("{type:'vote', id:string, rect:{x:number, y:number, w:number, h:number}} |"))
		assert.ok(src.includes("{type:'voteMiss', id:(string|null)} |"))
		assert.ok(src.includes("onActivity(a:{kind:'drag'|'edit'|'gesture'|'transform'|'connect'|'press', active:boolean, ids:string[]}):void"))
		assert.ok(src.includes('view:([number,number,number,number]|null)}} RemoteSample'))
	})

	test('facade signatures of §6.3', () => {
		const p = SceneManager.prototype
		assert.equal(p.setVoteState.length, 1)
		assert.equal(p.followTo.length, 2)
		assert.equal(p.stopFollow.length, 0)
		assert.equal(p.cameraForRect.length, 1, 'cameraForRect(rect, padPx = 0)')
		assert.equal(p.getViewport.length, 0)
	})
})
