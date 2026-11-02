/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 223 (show everything clear of the bars), AK3 (session part):
 * zoomFit ("Show everything"), zoomToSelection (button and the context
 * menu's zoom-selection) and zoomToItem (frame list, vote list) hand the
 * scene the insets of ui.viewInsets; an explicit left/right reserve of the
 * vote list counts per side with the larger value; the scene's callback
 * viewInsets (Shift+1, Shift+2) answers the same. Without ui.viewInsets or
 * with a throw: null; invalid values go to the scene as they are, where
 * Camera.js freePart counts them as 0 (the camera of before, AK2).
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession, ZOOM_PAD_PX } from '../../../src/board/BoardSession.js'
import { freePart } from '../../../src/scene/Camera.js'
import { MAX_SCALE } from '../../../src/model/tokens.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, frame, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const F = ID(9)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }

/** Scene fake with the facade the session calls; fit and cameraForRect log their arguments. */
class FitScene extends FakeScene {
	setMode(mode) {
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	followTo() {
		return Promise.resolve(true)
	}

	stopFollow() {}

	fit(rect, pad, insets) {
		this.log('fit', rect, pad, insets)
	}

	cameraForRect(rect, pad = 0, insets = null, maxScale = undefined) {
		this.log('cameraForRect', rect, pad, insets, maxScale)
		return { x: rect.x, y: rect.y, scale: 1 }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

/**
 * @param {object} [o] options
 * @param {Function} [o.viewInsets] ui.viewInsets (none: the key is left out)
 * @return {Promise<object>} {s, scene}
 */
async function open({ viewInsets } = {}) {
	const clock = new FakeClock(10000)
	const tr = {
		kind: 'user',
		async snapshot() {
			const items = [sticky(A, { x: 0, y: 0 }), sticky(B, { x: 900, y: 500 }), frame(F, { x: 2000, y: 0, w: 800, h: 600 })]
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: 'owner', metaRev: 3, meta: {} }, me: ALICE, items }
		},
		async sync(body, opts = {}) {
			return opts.keepalive ? {} : { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: viewInsets ? { viewInsets } : {},
		deps: {
			SceneModel: FakeModel,
			SceneManager: FitScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	sessions.push(s)
	await s.open()
	await clock.advance(1000)
	return { s, scene: s.scene }
}

const BARS = { top: 58, right: 368, bottom: 58, left: 58 }

test('AK3 "Show everything": scene.fit(everything, 48, the measured insets)', async () => {
	const h = await open({ viewInsets: () => ({ ...BARS }) })
	h.s.zoomFit()
	assert.deepEqual(h.scene.callsOf('fit').at(-1), ['fit', undefined, 48, BARS])
})

test('AK3 "Zoom to selection" (button and context menu): cameraForRect(the selection, ZOOM_PAD_PX, the measured insets)', async () => {
	const h = await open({ viewInsets: () => ({ ...BARS }) })
	h.scene.callbacks.onSelection([A, B])
	assert.equal(h.s.zoomToSelection(), true)
	const sel = h.s.boundsOf([A, B])
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1), ['cameraForRect', sel, ZOOM_PAD_PX, BARS, MAX_SCALE], 'job 242: up to 1000 %')
	const n = h.scene.callsOf('cameraForRect').length
	h.scene.callbacks.onIntent({ type: 'contextMenu', id: A, at: [1, 1] })
	h.s.menuAction('zoom-selection')
	assert.equal(h.scene.callsOf('cameraForRect').length, n + 1)
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1), ['cameraForRect', sel, ZOOM_PAD_PX, BARS, MAX_SCALE], 'the menu entry the same')
})

test('AK3 the frame list\'s jump: cameraForRect(the frame, ZOOM_PAD_PX, the measured insets)', async () => {
	const h = await open({ viewInsets: () => ({ ...BARS }) })
	assert.equal(h.s.zoomToItem(F), true)
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1), ['cameraForRect', h.s.model.abs(F), ZOOM_PAD_PX, BARS, undefined], 'job 242: no maxScale, the scene keeps 400 %')
})

test('AK3 the vote list\'s reserve: per side the larger of the reserve and the measured inset', async () => {
	let measured = { ...BARS, right: 370 }
	const h = await open({ viewInsets: () => measured })
	h.s.zoomToItem(A, { right: 300 })
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1)[3], { ...BARS, right: 370 }, 'the measured 370')
	measured = { ...BARS, right: 0 }
	h.s.zoomToItem(A, { right: 300 })
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1)[3], { ...BARS, right: 300 }, 'the reserve 300')
	assert.equal(h.scene.callsOf('cameraForRect').at(-1)[4], undefined, 'job 242: the vote list\'s jump keeps the scene\'s 400 %')
	h.s.zoomToItem(A, { left: 360 })
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1)[3], { ...BARS, right: 0, left: 360 }, 'RTL: the left reserve')
	h.s.zoomToItem(A, { left: Number.NaN, right: -4 })
	assert.deepEqual(h.scene.callsOf('cameraForRect').at(-1)[3], { ...BARS, right: 0 }, 'an invalid reserve counts as 0')
})

test('AK4 (session part) the scene\'s callback viewInsets answers the measured insets, fresh at each call', async () => {
	let measured = { ...BARS }
	const h = await open({ viewInsets: () => measured })
	assert.equal(typeof h.scene.callbacks.viewInsets, 'function')
	assert.deepEqual(h.scene.callbacks.viewInsets(), BARS)
	measured = { top: 58, right: 0, bottom: 58, left: 58 }
	assert.deepEqual(h.scene.callbacks.viewInsets(), measured, 'measured again, where the bars stand now')
})

test('AK3 without ui.viewInsets or when it throws: null, so the scene takes the whole canvas (the camera of before)', async () => {
	const plain = await open()
	plain.s.zoomFit()
	assert.deepEqual(plain.scene.callsOf('fit').at(-1), ['fit', undefined, 48, null])
	plain.scene.callbacks.onSelection([A])
	plain.s.zoomToSelection()
	assert.equal(plain.scene.callsOf('cameraForRect').at(-1)[3], null)
	assert.equal(plain.scene.callbacks.viewInsets(), null)
	// the frame list without a measurement: no inset at any edge
	plain.s.zoomToItem(F)
	assert.deepEqual(freePart(1280, 800, ZOOM_PAD_PX, plain.scene.callsOf('cameraForRect').at(-1)[3]), { x: 0, y: 0, w: 1280, h: 800 })
	const errors = []
	const orig = console.error
	console.error = (...args) => errors.push(args)
	try {
		const bad = await open({ viewInsets: () => { throw new Error('layout') } })
		bad.s.zoomFit()
		assert.deepEqual(bad.scene.callsOf('fit').at(-1), ['fit', undefined, 48, null])
		assert.equal(bad.scene.callbacks.viewInsets(), null, 'the scene\'s callback does not throw')
		assert.ok(errors.some((e) => String(e[0]).includes('viewInsets failed')), 'logged')
	} finally {
		console.error = orig
	}
})

test('AK3 invalid values reach the scene as they are; freePart counts them as 0', async () => {
	const odd = await open({ viewInsets: () => ({ top: '5', right: Number.NaN, bottom: 20, left: -3 }) })
	odd.s.zoomFit()
	const ins = odd.scene.callsOf('fit').at(-1)[3]
	assert.deepEqual(freePart(1280, 800, 48, ins), { x: 0, y: 0, w: 1280, h: 780 }, 'only the bottom 20 px count')
	odd.s.zoomToItem(F)
	assert.deepEqual(freePart(1280, 800, ZOOM_PAD_PX, odd.scene.callsOf('cameraForRect').at(-1)[3]), { x: 0, y: 0, w: 1280, h: 780 })
})
