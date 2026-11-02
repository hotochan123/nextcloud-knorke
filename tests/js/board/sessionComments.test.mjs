/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Factory job 255 (comments, reactions and the laser out of BoardSession,
 * board/sessionComments.js): BoardSession keeps thin methods that hand over
 * to SessionComments; nothing visible changes.
 *
 * - AK1: every moved method (and cameraNow, which stays) is still a function
 *   on BoardSession.prototype: BoardView, transport.js and the tests call
 *   them on the session.
 * - AK3: sessionComments.js and sessionConsts.js never import
 *   BoardSession.js; sessionConsts.js imports nothing of src/board/.
 * - AK5: toast and now replaced on the instance after the constructor are
 *   the ones called; the state stays a field of the session (bubbles,
 *   commentPicking, laser, reactPicker).
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

/** The 40 methods of job 255, in the order of the old block. */
const MOVED = Object.freeze([
	'mayReact', 'pushReactions', 'react', 'reactIntent',
	'commentApi', 'mayComment', 'commentsView', 'emitComments', 'setBubbles', 'startCommentPick', 'cancelCommentPick',
	'onCommentPick', 'commentOn', 'composeComment', 'commentCall', 'createThread', 'replyTo', 'editComment',
	'setResolved', 'deleteComment', 'searchMentions', 'commentError', 'commentsOnRemove', 'liveCommentBox',
	'liveCameraNow', 'commentPlaces', 'threadAnchor', 'commentScreen', 'centerOn',
	'openReactionPicker', 'reactFromBar', 'emitReactionPicker', 'closeReactionPicker', 'pickReaction',
	'openReactionPopup', 'emitReactionPopup', 'closeReactionPopup', 'checkReactions',
	'laserPoint', 'laserWire',
])

const A = ID(1)
const T0 = 1760100000000
const BOB = { pid: 'pidbob0000000001', name: 'Bob Berg', role: 'edit', guest: false, mod: false, source: 'share' }

class TalkScene extends FakeScene {
	setMode(mode) {
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	cameraForRect(rect) {
		return { x: rect.x, y: rect.y, scale: 1 }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 720 }
	}

	setLaserColor() {}
}

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

/** @return {Promise<{s: BoardSession, clock: FakeClock}>} Bob (edit) on an open board with one note */
async function open() {
	const clock = new FakeClock(10000)
	const tr = {
		kind: 'user',
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: 'edit', metaRev: 3, meta: {} }, me: BOB, items: [sticky(A)] }
		},
		async sync(body, opts = {}) {
			return opts.keepalive ? {} : { rev: body.since, presence: {} }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
		mode: 'user',
		boardId: 7,
		ui: {},
		deps: {
			SceneModel: FakeModel,
			SceneManager: TalkScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: () => ({ hideToast: () => {} }),
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	sessions.push(s)
	await s.open()
	await clock.advance(1000)
	return { s, clock }
}

test('job 255 AK1 the 40 moved methods and cameraNow are functions on BoardSession.prototype', () => {
	assert.equal(MOVED.length, 40)
	for (const name of [...MOVED, 'cameraNow']) {
		assert.equal(typeof BoardSession.prototype[name], 'function', name)
	}
})

test('job 255 AK3 sessionComments.js and sessionConsts.js never import BoardSession.js; sessionConsts.js is a leaf', () => {
	for (const name of ['sessionComments.js', 'sessionConsts.js']) {
		const src = readFileSync(new URL('../../../src/board/' + name, import.meta.url), 'utf8')
		assert.doesNotMatch(src, /from '\.\/BoardSession\.js'/, name)
		assert.doesNotMatch(src, /import\(['"]\.\/BoardSession\.js['"]\)/, name)
	}
	const consts = readFileSync(new URL('../../../src/board/sessionConsts.js', import.meta.url), 'utf8')
	assert.doesNotMatch(consts, /^import /m, 'sessionConsts.js imports nothing')
})

test('job 255 AK5 toast replaced on the instance after the constructor is the one commentError calls', async () => {
	const { s } = await open()
	const toasts = []
	s.toast = (m, o) => toasts.push([m, o?.hook ?? null])
	s.commentError(new Error('x'))
	assert.deepEqual(toasts, [['Your comment could not be saved.', 'comment-failed']])
})

test('job 255 AK5 now replaced on the instance after the constructor stamps the laser points in the session\'s laser', async () => {
	const { s } = await open()
	let at = 50000
	s.now = () => at
	const laser = s.laser
	s.laserPoint({ x: 10.04, y: 20.06 })
	at += 100
	s.laserPoint({ x: 30, y: 40 })
	assert.equal(s.laser, laser, 'the same array, changed in place')
	assert.deepEqual(s.laser, [[10, 20.1, 50000], [30, 40, 50100]])
	s.laserPoint(null)
	assert.equal(s.laserEnded, true)
	assert.deepEqual(s.laserWire(), [[10, 20.1, 100], [30, 40, 0]])
})

test('job 255 AK5 setBubbles, the comment pick and the reaction picker write the fields of the session', async () => {
	const { s } = await open()
	const seen = []
	s.ui.onComments = (v) => seen.push(v.bubbles)
	s.setBubbles(false)
	assert.equal(s.bubbles, false)
	assert.equal(s.commentPicking, false)
	assert.equal(s.storage.getItem('local', 'knorke.bubbles'), '0')
	assert.deepEqual(seen, [false])
	assert.equal(s.startCommentPick(), true)
	assert.equal(s.commentPicking, true)
	s.cancelCommentPick()
	assert.equal(s.commentPicking, false)
	assert.equal(s.openReactionPicker(A, { x: 1, y: 2, w: 3, h: 4 }), true)
	assert.equal(s.reactPicker.id, A)
	s.closeReactionPicker()
	assert.equal(s.reactPicker, null)
})
