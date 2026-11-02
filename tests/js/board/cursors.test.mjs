/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 147 (hide other people's cursors), the session part:
 * - AK2: localStorage knorke.cursors, read when the board opens: '0' hides
 *   (the sampler gives cursor null from the start, no toast), anything else
 *   shows; the menu payload carries cursors.
 * - AK3: menuAction('cursors') closes the menu, stores ('0' / removed),
 *   calls scene.presenceChanged() and focuses the canvas; only the cursor
 *   field goes null; twice restores; no op, no undo step, no poke; the
 *   scene's onCursors (the key C) the same in modes vote and view and while
 *   frozen.
 * - AK4: the toast cursors (hidden with the key C, shown), a new one hides
 *   the previous one first.
 * - AK5: the person followed and the presenter of meta.summon keep their
 *   cursors (every tab of that pid), until following or presenting ends.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const T0 = 1760100000000
const KEY = 'knorke.cursors'
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIC = { pid: 'pidvic0000000001', name: 'Vic View', role: 'view', guest: false, mod: false, source: 'share' }
const VERA = { pid: 'pidvera000000001', name: 'Vera Vogt', role: 'vote', guest: false, mod: false, source: 'share' }
const BOB = 'pidbob000000001'
const CAROL = 'pidcarol0000001'
/** Bob in two tabs (one editing A, with a selection and a drag), Carol in one. */
const PRESENCE = {
	[BOB + ':cB1']: { n: 'Bob', k: BOB, g: 0, x: 10, y: 20, s: [A], d: [[A, 5, 6]], e: A, h: 1, v: [0, 0, 1000, 500] },
	[BOB + ':cB2']: { n: 'Bob', k: BOB, g: 0, x: 30, y: 40, s: [], d: [], e: null, h: 0, v: [0, 0, 800, 400] },
	[CAROL + ':cC1']: { n: 'Carol', k: CAROL, g: 0, x: 50, y: 60, s: [A], d: [], e: null, h: 0, v: [0, 0, 1000, 500] },
}

/** Scene fake with the stage-3 facade the session calls (setMode, setVoteState, followTo, …). */
class CursorScene extends FakeScene {
	setMode(mode, o = {}) {
		this.log('setMode', mode, o)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	followTo(cam, ms) {
		this.log('followTo', cam, ms)
		return Promise.resolve(true)
	}

	stopFollow() {
		this.log('stopFollow')
	}

	cameraForRect(rect, pad = 0) {
		return { x: rect.x, y: rect.y, scale: 1, rect, pad }
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

const openVote = () => ({ vote: { sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false } })

const sessions = []
afterEach(() => {
	for (const s of sessions.splice(0)) s.destroy()
})

/**
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ stored = undefined, me = ALICE, meta = {}, viewOnly = false } = {}) {
	const storage = memoryStorage()
	if (stored !== undefined) storage.data.local.set(KEY, stored)
	const clock = new FakeClock(10000)
	const menus = []
	const infos = []
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: 5, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items: [sticky(A, { x: 0, y: 0 })] }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) return {}
			tr.calls.push(structuredClone(body))
			return { rev: body.since, presence: PRESENCE }
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		viewOnly,
		ui: { onContextMenu: (m) => menus.push(m) },
		deps: {
			SceneModel: FakeModel,
			SceneManager: CursorScene,
			transport: tr,
			storage,
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: () => {},
			info: (text, o) => {
				const rec = { text, o, hidden: 0 }
				infos.push(rec)
				return { hideToast: () => { rec.hidden++ } }
			},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	sessions.push(s)
	await s.open()
	await clock.advance(1000)
	const scene = s.scene
	let pokes = 0
	const poke = s.sync.poke.bind(s.sync)
	s.sync.poke = () => { pokes++; poke() }
	return {
		s, clock, tr, storage, scene, menus, infos,
		pokes: () => pokes,
		/** @return {Record<string, object>} the scene's samples by key */
		samples: () => Object.fromEntries(scene.sampler(clock.now()).map((x) => [x.key, x])),
		/** @return {Record<string, (number[]|null)>} the cursor of every sample by key */
		cursors() {
			return Object.fromEntries(Object.entries(this.samples()).map(([k, x]) => [k, x.cursor]))
		},
		menu: () => s.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] }),
	}
}

const ALL_SHOWN = { [BOB + ':cB1']: [10, 20], [BOB + ':cB2']: [30, 40], [CAROL + ':cC1']: [50, 60] }
const NONE = { [BOB + ':cB1']: null, [BOB + ':cB2']: null, [CAROL + ':cC1']: null }
/** @param {object} x a sample @return {object} it without the cursor */
const rest = ({ cursor, ...x }) => x

test('AK2: no key: the sampler gives the cursors unchanged, the board menu reports cursors: true, no toast', async () => {
	const h = await open()
	assert.equal(h.storage.data.local.has(KEY), false)
	assert.deepEqual(h.cursors(), ALL_SHOWN)
	h.menu()
	assert.equal(h.menus.at(-1).cursors, true)
	assert.deepEqual(h.infos, [], 'no toast on opening')
})

test('AK2: knorke.cursors "0" before opening: null from the first sample on, the payload cursors: false, no toast; every other value shows', async () => {
	const h = await open({ stored: '0' })
	assert.deepEqual(h.cursors(), NONE)
	h.menu()
	assert.equal(h.menus.at(-1).cursors, false)
	assert.deepEqual(h.infos, [], 'no toast on opening')
	assert.equal(h.storage.data.local.get(KEY), '0', 'nothing written on opening')
	for (const v of ['1', '', 'false', 'off', '00']) {
		const o = await open({ stored: v })
		assert.deepEqual(o.cursors(), ALL_SHOWN, JSON.stringify(v))
		o.menu()
		assert.equal(o.menus.at(-1).cursors, true, JSON.stringify(v))
		assert.equal(o.storage.data.local.get(KEY), v, 'left as it was')
	}
})

test('AK3: menuAction("cursors") closes the menu, stores "0", presenceChanged, focusCanvas; only the cursor goes null; again: the key removed and everything back; no op, undo step or poke', async () => {
	const h = await open()
	const before = h.samples()
	const sent = h.tr.calls.length
	h.menu()
	const changed = h.scene.presenceChangedCount
	const calls = h.scene.calls.length
	assert.equal(h.s.menuAction('cursors'), true)
	assert.equal(h.menus.at(-1), null, 'the menu is closed')
	assert.equal(h.storage.data.local.get(KEY), '0')
	assert.equal(h.scene.presenceChangedCount, changed + 1)
	assert.deepEqual(h.scene.calls.slice(calls).map((c) => c[0]), ['focusCanvas'])
	const hidden = h.samples()
	assert.deepEqual(Object.fromEntries(Object.entries(hidden).map(([k, x]) => [k, x.cursor])), NONE)
	for (const k of Object.keys(before)) {
		assert.deepEqual(rest(hidden[k]), rest(before[k]), k + ': selection, drag, editing, editingHolder, view stay')
	}
	assert.deepEqual(hidden[BOB + ':cB1'].selection, [A])
	assert.equal(hidden[BOB + ':cB1'].editing, A)
	assert.equal(hidden[BOB + ':cB1'].editingHolder, true)
	h.menu()
	assert.equal(h.menus.at(-1).cursors, false, 'the payload carries the new state')
	assert.equal(h.s.menuAction('cursors'), true)
	assert.equal(h.storage.data.local.has(KEY), false, 'the key is gone')
	assert.equal(h.scene.presenceChangedCount, changed + 2)
	assert.deepEqual(h.samples(), before, 'twice: everything as before')
	assert.equal(h.pokes(), 0, 'no poke')
	await h.clock.advance(200)
	assert.deepEqual(h.tr.calls.slice(sent).flatMap((b) => b.ops ?? []), [], 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.equal(h.s.menuAction('cursors'), false, 'without an open menu nothing')
	assert.equal(h.storage.data.local.has(KEY), false)
})

test('AK3: the scene\'s onCursors (the key C) switches the same way in modes edit, vote and view and on a frozen board; following and the selection stay; without a scene false', async () => {
	const pre = new BoardSession({ container: {}, mode: 'user', boardId: 7, ui: {}, deps: { storage: memoryStorage() } })
	assert.equal(pre.toggleCursors(), false, 'before open')
	const cases = [
		{ mode: 'edit' },
		{ me: VERA, meta: openVote(), mode: 'vote' },
		{ me: VIC, mode: 'view' },
		{ viewOnly: true, mode: 'view' },
		{ frozen: true, mode: 'edit' },
	]
	for (const { mode, frozen, ...o } of cases) {
		const h = await open(o)
		const what = mode + (frozen ? ' frozen' : '') + (o.viewOnly ? ' view-only device' : '')
		assert.equal(h.s.clientMode, mode, what)
		h.s.scene.callbacks.onSelection([A])
		assert.equal(h.s.followParticipant(CAROL), true, what + ': following Carol')
		if (frozen) {
			h.s.onStatus('gone')
			assert.equal(h.s.frozen, true)
		}
		const changed = h.scene.presenceChangedCount
		const pokes = h.pokes()
		h.scene.callbacks.onCursors()
		assert.equal(h.storage.data.local.get(KEY), '0', what)
		assert.equal(h.scene.presenceChangedCount, changed + 1, what)
		assert.deepEqual(h.cursors(), { ...NONE, [CAROL + ':cC1']: [50, 60] }, what + ': Carol is followed')
		assert.equal(debugApi(h.s).state().following, CAROL, what + ': following goes on')
		assert.deepEqual(h.s.selection, [A], what + ': the selection stays')
		assert.equal(h.infos.length, 1, what + ': the toast')
		h.scene.callbacks.onCursors()
		assert.equal(h.storage.data.local.has(KEY), false, what)
		assert.deepEqual(h.cursors(), ALL_SHOWN, what)
		assert.equal(h.pokes(), pokes, what + ': no poke (the selection before may have poked)')
		assert.equal(h.s.undoStack.canUndo(), false, what + ': no undo step')
		h.s.destroy()
		assert.equal(h.s.toggleCursors(), false, what + ': after destroy')
	}
})

test('AK4: hiding shows "Other people\'s cursors hidden – C shows them again", showing "Other people\'s cursors shown", hook cursors; each new toast hides the previous one', async () => {
	const h = await open()
	h.s.toggleCursors()
	assert.equal(h.infos.length, 1)
	assert.equal(h.infos[0].text, 'Other people\'s cursors hidden – C shows them again')
	assert.deepEqual(h.infos[0].o, { hook: 'cursors' })
	assert.equal(h.infos[0].hidden, 0)
	h.s.toggleCursors()
	assert.equal(h.infos.length, 2)
	assert.equal(h.infos[1].text, 'Other people\'s cursors shown')
	assert.deepEqual(h.infos[1].o, { hook: 'cursors' })
	assert.equal(h.infos[0].hidden, 1, 'the first toast was hidden')
	assert.equal(h.infos[1].hidden, 0)
	h.s.toggleCursors()
	assert.deepEqual(h.infos.map((x) => x.hidden), [1, 1, 0], 'at most one at a time')
	assert.equal(h.infos[2].text, h.infos[0].text)
})

test('AK5: while hidden, every tab of the person followed keeps its cursor, the others not; when following ends that person is null too', async () => {
	const h = await open({ stored: '0' })
	assert.equal(h.s.followParticipant(BOB), true)
	assert.deepEqual(h.cursors(), { [BOB + ':cB1']: [10, 20], [BOB + ':cB2']: [30, 40], [CAROL + ':cC1']: null })
	h.s.stopFollow()
	assert.equal(debugApi(h.s).state().following, null)
	assert.deepEqual(h.cursors(), NONE, 'with the next sample')
})

test('AK5: meta.summon of Q: Q keeps the cursor, also without following; after the summon ends Q is null', async () => {
	const h = await open({ stored: '0' })
	h.s.onMeta({ metaRev: 4, meta: { summon: { pid: CAROL, client: 'cC1', name: 'Carol', seq: 1, at: T0 } } })
	await h.clock.advance(0)
	assert.deepEqual(h.cursors(), { ...NONE, [CAROL + ':cC1']: [50, 60] }, 'the presenter')
	h.s.stopFollow()
	assert.equal(debugApi(h.s).state().following, null, 'not following')
	assert.deepEqual(h.cursors(), { ...NONE, [CAROL + ':cC1']: [50, 60] }, 'still the presenter')
	h.s.onMeta({ metaRev: 5, meta: {} })
	assert.deepEqual(h.cursors(), NONE, 'the summon ended')
	// following someone else during a summon: both stay
	h.s.onMeta({ metaRev: 6, meta: { summon: { pid: CAROL, client: 'cC1', name: 'Carol', seq: 2, at: T0 + 1 } } })
	assert.equal(h.s.followParticipant(BOB), true)
	assert.deepEqual(h.cursors(), ALL_SHOWN, 'Bob followed, Carol presenting')
})

test('job 171 AK7: with the cursors hidden (C) the sampler keeps the laser of every sample; only cursor goes null', async () => {
	const h = await open({ stored: '0' })
	const now = h.clock.now()
	// Carol's card: points 300 and 100 ms old on arrival
	h.s.onPresence({ ...PRESENCE, [CAROL + ':cC1']: { ...PRESENCE[CAROL + ':cC1'], l: [[100, 100, 300], [120, 110, 100]] } })
	// 800 ms later the play time (now − 900) is 100 ms before the arrival: both points are drawn
	const later = Object.fromEntries(h.scene.sampler(now + 800).map((x) => [x.key, x]))
	assert.equal(later[CAROL + ':cC1'].cursor, null, 'the cursor is hidden')
	assert.deepEqual(later[CAROL + ':cC1'].laser, [[[100, 100, 200], [120, 110, 0]]], 'the laser stays')
	assert.deepEqual(Object.values(later).map((x) => x.cursor), [null, null, null])
	assert.deepEqual(later[BOB + ':cB1'].laser, [], 'no l: no trail')
	assert.deepEqual(later[CAROL + ':cC1'].laser, h.s.presence.sample(now + 800).find((x) => x.key === CAROL + ':cC1').laser, 'as the presence model gives it')
})
