/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Stage 3 shell helpers (SPEC-M1 §6.6, §6.8, §6.12): countdowns
 * (data-knorke-timer-left rounded up to whole seconds, R16 TST-09; "Time's
 * up" as the pair (seq, end), R16 SRV-04; milestones), the banner strips of
 * the narrow layout (R16 (3)), "Copy results", the end sound and the wake
 * lock without the browser APIs, toast hooks.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NARROW_QUERY, bannerStrips, excerpt, resultsText } from '../../../src/components/bars.js'
import { TIME_UP_SHOW_MS, ceilSeconds, formatClock, milestone, nextTickMs, timeUpShown, timerKey, timerOf, timerView, voteClock } from '../../../src/components/countdown.js'
import { createSound } from '../../../src/util/sound.js'
import { createWakeLock } from '../../../src/util/wakelock.js'

const NOW = 1760100000000

test('timerOf: running/paused forms of meta.timer; anything else is no timer', () => {
	assert.deepEqual(timerOf({ state: 'running', dur: 60000, end: NOW + 60000, left: null, by: 'A', seq: 3 }), { state: 'running', dur: 60000, end: NOW + 60000, left: null, by: 'A', seq: 3 })
	assert.deepEqual(timerOf({ state: 'paused', dur: 60000, end: null, left: 12000, seq: 4 }), { state: 'paused', dur: 60000, end: null, left: 12000, by: '', seq: 4 })
	assert.equal(timerOf(null), null)
	assert.equal(timerOf({ state: 'running' }), null)
	assert.equal(timerOf({ state: 'stopped', end: 1 }), null)
})

test('timerView: the rest rounded UP to whole seconds (data-knorke-timer-left, R16 TST-09); ≤ 0 → done; paused shows left', () => {
	const t = timerOf({ state: 'running', dur: 60000, end: NOW + 59200, seq: 1 })
	assert.deepEqual(timerView(t, NOW), { state: 'running', leftMs: 60000, text: '01:00' })
	assert.deepEqual(timerView(t, NOW + 59199), { state: 'running', leftMs: 1000, text: '00:01' })
	assert.deepEqual(timerView(t, NOW + 59200), { state: 'done', leftMs: 0, text: '00:00' })
	assert.deepEqual(timerView(t, NOW + 99999), { state: 'done', leftMs: 0, text: '00:00' }, 'a run-out timer stays running on the server, done here')
	assert.deepEqual(timerView(timerOf({ state: 'paused', left: 125500, seq: 2 }), NOW), { state: 'paused', leftMs: 126000, text: '02:06' })
	assert.equal(timerView(null, NOW), null)
	assert.equal(ceilSeconds(-5), 0)
	assert.equal(ceilSeconds(1), 1000)
	assert.equal(formatClock(5999000), '99:59')
	assert.equal(formatClock(3600000 + 61000), '61:01', 'mm:ss below 100 minutes')
	assert.equal(formatClock(6000000 + 61000), '1:41:01', 'vote rests from 100 minutes on')
	assert.equal(voteClock(null, NOW), null)
	assert.equal(voteClock(NOW + 90000, NOW), '01:30')
})

test('nextTickMs: the display changes exactly at the next whole second of the rest', () => {
	assert.equal(nextTickMs(59200), 200)
	assert.equal(nextTickMs(60000), 1000)
	assert.equal(nextTickMs(10), 20, 'never a busy loop')
	assert.equal(nextTickMs(0), 1000)
})

test('"Time\'s up": after the end for TIME_UP_SHOW_MS, until dismissed; the memory belongs to the pair (seq, end) (R16 SRV-04)', () => {
	const t = timerOf({ state: 'running', dur: 3000, end: NOW, seq: 5 })
	assert.equal(timeUpShown(t, NOW - 1, null), false)
	assert.equal(timeUpShown(t, NOW, null), true)
	assert.equal(timeUpShown(t, NOW + TIME_UP_SHOW_MS - 1, null), true)
	assert.equal(timeUpShown(t, NOW + TIME_UP_SHOW_MS, null), false, 'gone after 30 s')
	assert.equal(timerKey(t), '5:' + NOW)
	assert.equal(timeUpShown(t, NOW + 1, timerKey(t)), false, 'clicked away')
	const again = timerOf({ state: 'running', dur: 3000, end: NOW + 5000, seq: 1 })
	assert.equal(timeUpShown(again, NOW + 5001, timerKey(t)), true, 'a new pair (even seq 1 after a stop) shows again')
	assert.equal(timeUpShown(timerOf({ state: 'paused', left: 0, seq: 6 }), NOW, null), false)
	assert.equal(timerKey(null), null)
})

test('milestones for the live region: 1 minute, 10 seconds, end – each once when crossed, never every second', () => {
	assert.equal(milestone(null, 50000), null)
	assert.equal(milestone(61000, 60000), 'minute')
	assert.equal(milestone(60000, 59000), null)
	assert.equal(milestone(11000, 10000), 'seconds')
	assert.equal(milestone(1000, 0), 'end')
	assert.equal(milestone(30000, 90000), null, '+1 min is no milestone')
})

test('banner strips (R16 (3)): precedence status > follow/chip > time up > role; one in the narrow layout; no role banner while frozen', () => {
	assert.equal(NARROW_QUERY, '(max-width: 600px)')
	const all = { status: 'offline', follow: true, chip: false, timeUp: true, role: 'device_vote', frozen: false }
	assert.deepEqual(bannerStrips(all, false), ['status', 'follow', 'time_up', 'role'])
	assert.deepEqual(bannerStrips(all, true), ['status'])
	assert.deepEqual(bannerStrips({ ...all, status: null }, true), ['follow'], 'following beats Time\'s up and role on a phone')
	assert.deepEqual(bannerStrips({ status: null, follow: false, chip: true, timeUp: true, role: 'vote_ready' }, true), ['chip'])
	assert.deepEqual(bannerStrips({ timeUp: true, role: 'vote_ready' }, true), ['time_up'], 'R16: Time\'s up before the role banners')
	assert.deepEqual(bannerStrips({ role: 'vote_ready' }, true), ['role'])
	assert.deepEqual(bannerStrips({ status: 'gone', role: 'view_role', frozen: true }, false), ['status'])
	assert.deepEqual(bannerStrips({}, false), [])
})

test('"Copy results": "1. {text} – {n}" per line, excerpts, a fallback for items without text', () => {
	const texts = { a: 'First idea\nwith two lines', b: '', c: 'x'.repeat(200) }
	const out = resultsText([['a', 7], ['b', 5], ['c', 1]], (id) => texts[id] ?? '', '(no text)')
	const lines = out.split('\n')
	assert.equal(lines[0], '1. First idea with two lines – 7')
	assert.equal(lines[1], '2. (no text) – 5')
	assert.ok(lines[2].startsWith('3. xxx') && lines[2].includes('… – 1'))
	assert.equal(excerpt('  a   b  '), 'a b')
	assert.equal(resultsText(null, () => '', '-'), '')
})

test('sound: muted in localStorage knorke.mute; silent before a gesture unlocked the context; three beeps after', () => {
	const store = new Map()
	const storage = { getItem: (k, key) => store.get(key) ?? null, setItem: (k, key, v) => store.set(key, v), removeItem: (k, key) => store.delete(key) }
	const oscs = []
	class Ctx {
		constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
		createOscillator() { const o = { frequency: {}, connect() {}, start(t) { this.t = t }, stop() {} }; oscs.push(o); return o }
		createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} } }
		resume() { return Promise.resolve() }
	}
	const s = createSound({ win: { AudioContext: Ctx }, storage })
	assert.equal(s.muted(), false)
	assert.equal(s.play(), false, 'no gesture yet: no context')
	assert.equal(s.unlock(), true)
	assert.equal(s.play(), true)
	assert.equal(oscs.length, 3)
	s.setMuted(true)
	assert.equal(store.get('knorke.mute'), '1')
	assert.equal(s.play(), false)
	s.setMuted(false)
	assert.equal(s.muted(), false)
	assert.equal(createSound({ win: {}, storage }).unlock(), false, 'without WebAudio: nothing')
})

test('wake lock: requested while wanted and visible, released when not wanted or hidden, again when visible; nothing without the API', async () => {
	const listeners = {}
	const doc = { visibilityState: 'visible', addEventListener: (t, fn) => { listeners[t] = fn }, removeEventListener: (t) => { delete listeners[t] } }
	let requests = 0
	let releases = 0
	const nav = { wakeLock: { request: async () => { requests++; return { release: async () => { releases++ }, addEventListener() {} } } } }
	const w = createWakeLock({ nav, doc })
	w.want(true)
	await new Promise((r) => setImmediate(r))
	assert.equal(requests, 1)
	assert.equal(w.held(), true)
	doc.visibilityState = 'hidden'
	listeners.visibilitychange()
	assert.equal(w.held(), false)
	doc.visibilityState = 'visible'
	listeners.visibilitychange()
	await new Promise((r) => setImmediate(r))
	assert.equal(requests, 2)
	w.want(false)
	assert.equal(releases, 2)
	w.destroy()
	assert.equal(listeners.visibilitychange, undefined)
	const none = createWakeLock({ nav: {}, doc })
	none.want(true)
	assert.equal(none.held(), false)
})
