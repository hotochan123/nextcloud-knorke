/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 272 (frames as slides): the slide order, steps, swipes,
 * moving a slide, and SlideShow (start, moves to the server, saving the
 * order, the shown frame deleted).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SlideShow, moveSlide, panelOverlays, slideOrder, stepSlide, swipeDir } from '../../../src/board/slides.js'

const A = '01HZZZZZZZZZZZZZZZZZZZZZZA'
const B = '01HZZZZZZZZZZZZZZZZZZZZZZB'
const C = '01HZZZZZZZZZZZZZZZZZZZZZZC'
const D = '01HZZZZZZZZZZZZZZZZZZZZZZD'
const fr = (...ids) => ids.map((id) => ({ id, title: 'T' + id.slice(-1) }))
/** reading order of the fake board: C, A, D, B */
const reading = (ids) => [C, A, D, B].filter((x) => ids.includes(x))

test('AK1: slideOrder: saved order first, gone ids and non-frames dropped, new frames appended in reading order', () => {
	assert.deepEqual(slideOrder(undefined, fr(A, B, C), reading).map((s) => s.id), [C, A, B], 'no meta.slides: reading order')
	assert.deepEqual(slideOrder([B, 'x', D, A, B], fr(A, B, C), reading).map((s) => s.id), [B, A, C])
	assert.deepEqual(slideOrder('junk', fr(A), reading).map((s) => s.id), [A])
	assert.deepEqual(slideOrder([A], [], reading), [])
	assert.equal(slideOrder([A], fr(A), reading)[0].title, 'TA')
})

test('AK2: stepSlide stops at the edges; first/last; swipeDir needs 60 px and |dx| > 2·|dy|', () => {
	const ids = [A, B, C]
	assert.equal(stepSlide(ids, A, 1), B)
	assert.equal(stepSlide(ids, C, 1), null, 'past the end: nothing')
	assert.equal(stepSlide(ids, A, -1), null, 'before the start: nothing')
	assert.equal(stepSlide(ids, B, 'first'), A)
	assert.equal(stepSlide(ids, B, 'last'), C)
	assert.equal(stepSlide(ids, C, 'last'), null)
	assert.equal(stepSlide(ids, 'gone', 1), A)
	assert.equal(stepSlide([], A, 1), null)
	assert.equal(swipeDir(-60, 0), 1, 'to the left: next')
	assert.equal(swipeDir(80, 10), -1, 'to the right: previous')
	assert.equal(swipeDir(-59, 0), 0)
	assert.equal(swipeDir(-100, 50), 0, 'not clearly sideways')
	assert.equal(swipeDir(-100, 49), 1)
	assert.equal(swipeDir(NaN, 0), 0)
})

test('AK7: moveSlide moves one slide to an index (clamped), unknown ids change nothing', () => {
	assert.deepEqual(moveSlide([A, B, C], C, 0), [C, A, B])
	assert.deepEqual(moveSlide([A, B, C], A, 1), [B, A, C])
	assert.deepEqual(moveSlide([A, B, C], A, 99), [B, C, A])
	const ids = [A, B]
	assert.equal(moveSlide(ids, A, 0), ids, 'no move: the same array')
	assert.equal(moveSlide(ids, 'x', 1), ids)
})

/** A SlideShow over a fake board; the server answers when `release` is called. */
function harness({ frames = fr(A, B, C), slides = undefined } = {}) {
	const st = { frames, meta: { slides }, client: 'me' }
	const calls = []
	const shown = []
	const pending = []
	const answer = (fn) => new Promise((resolve) => pending.push(() => { fn(); resolve({ ok: true }) }))
	const show = new SlideShow({
		frames: () => st.frames,
		reading,
		meta: () => st.meta,
		presenting: () => st.meta.summon?.client === 'me',
		api: {
			start: (f) => { calls.push(['start', f]); return answer(() => { st.meta = { ...st.meta, summon: { client: 'me', frame: f } } }) },
			move: (f) => { calls.push(['move', f]); return answer(() => { st.meta = { ...st.meta, summon: { ...st.meta.summon, frame: f } } }) },
			save: (o) => { calls.push(['save', o]); return answer(() => { st.meta = { ...st.meta, slides: o } }) },
			end: () => { calls.push(['end']); const { summon, ...rest } = st.meta; st.meta = rest; return Promise.resolve({ ok: true }) },
		},
		show: (f) => shown.push(f),
	})
	const release = async () => {
		while (pending.length) {
			pending.shift()()
			await new Promise((resolve) => setImmediate(resolve))
		}
	}
	return { st, calls, shown, show, release }
}

test('AK6: start at the first slide, or at the selected frame; the camera moves at once', async () => {
	const h = harness()
	const p = h.show.start()
	assert.deepEqual(h.shown, [C], 'reading order: C first')
	await h.release()
	assert.equal(await p, true)
	assert.equal(h.show.active, true)
	assert.equal(h.show.current(), C)
	const h2 = harness()
	const p2 = h2.show.start(B)
	await h2.release()
	await p2
	assert.deepEqual(h2.calls, [['start', B]])
	assert.equal(await harness({ frames: [] }).show.start(), false, 'no frames: no start')
})

test('AK6: fast steps: at most one PUT at a time, and the last chosen frame is sent last', async () => {
	const h = harness({ frames: fr(A, B, C, D) })
	const p = h.show.start()
	await h.release()
	await p
	// reading order C, A, D, B
	assert.equal(h.show.step(1), true)
	assert.equal(h.show.step(1), true)
	assert.equal(h.show.step(1), true)
	assert.equal(h.show.step(1), false, 'at the end nothing happens')
	assert.deepEqual(h.shown, [C, A, D, B])
	assert.deepEqual(h.calls, [['start', C], ['move', A]], 'one move in flight')
	await h.release()
	assert.deepEqual(h.calls, [['start', C], ['move', A], ['move', B]], 'then only the newest')
	assert.equal(h.st.meta.summon.frame, B)
	assert.equal(h.show.step('first'), true)
	assert.equal(h.show.current(), C)
})

test('AK7: reorder saves the whole new order and keeps the shown slide', async () => {
	const h = harness()
	const p = h.show.start()
	await h.release()
	await p
	const r = h.show.reorder(B, 0)
	assert.deepEqual(h.show.list().map((s) => s.id), [B, C, A], 'shown at once')
	await h.release()
	assert.equal(await r, true)
	assert.deepEqual(h.calls.at(-1), ['save', [B, C, A]])
	assert.deepEqual(h.st.meta.slides, [B, C, A])
	assert.equal(h.show.current(), C)
	assert.equal(await h.show.reorder(B, 0), false, 'no move: no call')
})

test('AK6: the shown frame deleted → the next slide (else the previous); no frame left → the end', async () => {
	const h = harness()
	const p = h.show.start()
	await h.release()
	await p
	h.show.sync()
	h.show.go(A)
	await h.release()
	// order C, A, B; A deleted → B
	h.st.frames = fr(B, C)
	assert.equal(h.show.sync(), true)
	assert.equal(h.show.current(), B)
	await h.release()
	assert.equal(h.st.meta.summon.frame, B)
	// B (the last) deleted → C (the previous)
	h.st.frames = fr(C)
	h.show.sync()
	assert.equal(h.show.current(), C)
	await h.release()
	h.st.frames = []
	h.show.sync()
	assert.deepEqual(h.calls.at(-1), ['end'])
	assert.equal(h.show.active, false)
})

test('another moderator takes over: this tab no longer presents and forgets its slide', async () => {
	const h = harness()
	const p = h.show.start()
	await h.release()
	await p
	h.st.meta = { ...h.st.meta, summon: { client: 'other', frame: A } }
	assert.equal(h.show.active, false)
	assert.equal(h.show.sync(), true)
	assert.equal(h.show.current(), null)
	assert.equal(h.show.go(B), false)
})

test('round 2: the slide list takes room only beside a wide board; on a phone it lies over the slide', () => {
	assert.equal(panelOverlays(260, 1366), false, 'laptop: beside the slide')
	assert.equal(panelOverlays(260, 520), false)
	assert.equal(panelOverlays(260, 519), true)
	assert.equal(panelOverlays(260, 390), true, 'phone: over the slide')
	assert.equal(panelOverlays(0, 390), true)
})
