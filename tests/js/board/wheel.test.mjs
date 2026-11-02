/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 154 (the mouse wheel zooms), AK5, the session part:
 * - localStorage knorke.wheel, read when the board opens: 'zoom' and 'pan'
 *   reach the scene as its option wheel, anything else (missing too) 'auto';
 *   the menu payload carries wheel
 * - menuAction('wheel') closes the menu, switches Automatic → Zoom → Pan →
 *   Automatic, stores 'zoom' / 'pan' / removes the key, focuses the canvas and
 *   shows the toast wheel with the new stage, hiding the previous one; no op,
 *   no undo step, no poke; following goes on
 * - over a localStorage that throws (the real storage helpers) the scene is
 *   switched anyway and nothing throws
 * - outside mode edit the result is false and nothing changes
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { debugApi } from '../../../src/board/debug.js'
import { webStorage } from '../../../src/util/storage.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

const A = ID(1)
const T0 = 1760100000000
const KEY = 'knorke.wheel'
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIC = { pid: 'pidvic0000000001', name: 'Vic View', role: 'view', guest: false, mod: false, source: 'share' }
const VERA = { pid: 'pidvera000000001', name: 'Vera Vogt', role: 'vote', guest: false, mod: false, source: 'share' }
const CAROL = 'pidcarol0000001'
const PRESENCE = { [CAROL + ':cC1']: { n: 'Carol', k: CAROL, g: 0, x: 50, y: 60, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] } }
const TEXT = Object.freeze({
	zoom: 'Mouse wheel: zoom. Scrolling zooms, also on a trackpad.',
	pan: 'Mouse wheel: pan. Ctrl + wheel zooms.',
	panApple: 'Mouse wheel: pan. ⌘ + wheel zooms.',
	auto: 'Mouse wheel: automatic. A wheel zooms, a trackpad pans.',
})

/** Scene fake with the stage-3 facade the session calls (setMode, setVoteState, followTo, …). */
class WheelScene extends FakeScene {
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
async function open({ stored = undefined, storage = memoryStorage(), me = ALICE, meta = {}, viewOnly = false, win = null } = {}) {
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
			SceneManager: WheelScene,
			transport: tr,
			storage,
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win,
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
	let pokes = 0
	const poke = s.sync.poke.bind(s.sync)
	s.sync.poke = () => { pokes++; poke() }
	return {
		s, clock, tr, storage, scene: s.scene, menus, infos,
		pokes: () => pokes,
		menu: () => s.scene.callbacks.onIntent({ type: 'contextMenu', id: null, at: [640, 400] }),
	}
}

test('AK5: knorke.wheel missing, "zoom", "pan", "x": the scene gets auto, zoom, pan, auto; the board menu payload carries wheel; nothing written, no toast', async () => {
	for (const [stored, want] of [[undefined, 'auto'], ['zoom', 'zoom'], ['pan', 'pan'], ['x', 'auto'], ['', 'auto'], ['auto', 'auto'], ['Zoom', 'auto']]) {
		const h = await open({ stored })
		const what = JSON.stringify(stored ?? null)
		assert.equal(h.scene.opts.wheel, want, what + ': the option')
		h.menu()
		assert.equal(h.menus.at(-1).wheel, want, what + ': the payload')
		assert.equal(h.storage.data.local.get(KEY), stored, what + ': left as it was')
		assert.deepEqual(h.infos, [], what + ': no toast on opening')
	}
})

test('AK5: three menuAction("wheel") cycle Automatic → Zoom → Pan → Automatic: the menu closes, the scene switches, "zoom" / "pan" stored, the key removed; focusCanvas; each toast wheel hides the previous one', async () => {
	const h = await open()
	const sent = h.tr.calls.length
	const steps = [['zoom', 'zoom', TEXT.zoom], ['pan', 'pan', TEXT.pan], ['auto', undefined, TEXT.auto]]
	for (const [i, [stage, key, text]] of steps.entries()) {
		h.menu()
		assert.notEqual(h.menus.at(-1), null)
		const calls = h.scene.calls.length
		assert.equal(h.s.menuAction('wheel'), true, stage)
		assert.equal(h.menus.at(-1), null, stage + ': the menu is closed')
		assert.equal(h.scene.getWheel(), stage)
		assert.deepEqual(h.scene.calls.slice(calls), [['setWheel', stage], ['focusCanvas']], stage)
		assert.equal(h.storage.data.local.get(KEY), key, stage + ': stored')
		assert.equal(h.storage.data.local.has(KEY), key !== undefined)
		assert.equal(h.infos.length, i + 1, stage + ': one toast each')
		assert.equal(h.infos[i].text, text)
		assert.deepEqual(h.infos[i].o, { hook: 'wheel' })
		assert.equal(h.infos[i].hidden, 0, stage + ': the new toast stays')
		if (i > 0) assert.equal(h.infos[i - 1].hidden, 1, stage + ': the previous toast is hidden')
		h.menu()
		assert.equal(h.menus.at(-1).wheel, stage, stage + ': the next payload carries the new stage')
		h.s.closeMenu()
	}
	assert.equal(h.pokes(), 0, 'no poke')
	await h.clock.advance(200)
	assert.deepEqual(h.tr.calls.slice(sent).flatMap((b) => b.ops ?? []), [], 'no op')
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.equal(h.s.menuAction('wheel'), false, 'without an open menu nothing')
	assert.equal(h.scene.getWheel(), 'auto')
})

test('AK5: on Apple the pan toast names ⌘; the switch itself leaves following alone (opening the menu ends it, §6.5.6)', async () => {
	const h = await open({ stored: 'zoom', win: { navigator: { platform: 'MacIntel' } } })
	h.menu()
	assert.equal(h.s.menuAction('wheel'), true)
	assert.equal(h.scene.getWheel(), 'pan')
	assert.equal(h.infos.at(-1).text, TEXT.panApple)
	assert.equal(h.s.followParticipant(CAROL), true, 'following Carol')
	const pokes = h.pokes()
	assert.equal(h.s.cycleWheel(), true)
	assert.equal(h.scene.getWheel(), 'auto')
	assert.equal(debugApi(h.s).state().following, CAROL, 'following goes on')
	assert.equal(h.pokes(), pokes, 'no poke')
	assert.equal(h.infos.at(-1).text, TEXT.auto)
})

test('AK5: over a localStorage that throws (the real storage helpers) the scene switches anyway, nothing throws', async () => {
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
	const calls = []
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (k) => { calls.push(['get', k]); throw new Error('SecurityError') },
			setItem: (k) => { calls.push(['set', k]); throw new Error('QuotaExceededError') },
			removeItem: (k) => { calls.push(['remove', k]); throw new Error('SecurityError') },
		},
	})
	try {
		const h = await open({ storage: webStorage() })
		assert.equal(h.scene.opts.wheel, 'auto', 'a failed read is automatic')
		for (const stage of ['zoom', 'pan', 'auto']) {
			h.menu()
			assert.doesNotThrow(() => assert.equal(h.s.menuAction('wheel'), true))
			assert.equal(h.scene.getWheel(), stage, stage + ': switched anyway')
			assert.equal(h.infos.at(-1).o.hook, 'wheel')
		}
		assert.deepEqual(calls.filter((c) => c[1] === KEY), [['get', KEY], ['set', KEY], ['set', KEY], ['remove', KEY]])
	} finally {
		if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
		else delete globalThis.localStorage
	}
})

test('AK5: outside mode edit the result is false: no menu, no switch, nothing stored; the stored stage acts there too', async () => {
	const cases = [
		{ me: VERA, meta: openVote(), mode: 'vote' },
		{ me: VIC, mode: 'view' },
		{ viewOnly: true, mode: 'view' },
	]
	for (const { mode, ...o } of cases) {
		const h = await open({ ...o, stored: 'pan' })
		const what = mode + (o.viewOnly ? ' (view-only device)' : '')
		assert.equal(h.s.clientMode, mode, what)
		assert.equal(h.scene.opts.wheel, 'pan', what + ': the stored stage reaches the scene')
		h.menu()
		assert.equal(h.menus.at(-1) ?? null, null, what + ': no menu')
		assert.equal(h.s.menuAction('wheel'), false, what)
		assert.equal(h.scene.getWheel(), 'pan', what)
		assert.equal(h.storage.data.local.get(KEY), 'pan', what)
		assert.deepEqual(h.infos, [], what)
	}
	const frozen = await open()
	frozen.menu()
	frozen.s.onStatus('gone')
	assert.equal(frozen.s.frozen, true)
	assert.equal(frozen.s.menuAction('wheel'), false, 'frozen')
	assert.equal(frozen.scene.getWheel(), 'auto')
	assert.equal(frozen.storage.data.local.has(KEY), false)
	const pre = new BoardSession({ container: {}, mode: 'user', boardId: 7, ui: {}, deps: { storage: memoryStorage() } })
	assert.equal(pre.cycleWheel(), false, 'before open')
})
