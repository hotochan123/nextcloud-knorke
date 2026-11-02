/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PALETTE, PresenceModel, colorFor, laserDelay, laserOf, viewOf } from '../../../src/sync/presence.js'
import { TEN } from '../../../src/model/tokens.js'

const N1 = '01JA0000000000000000000001'
const N2 = '01JA0000000000000000000002'

/**
 * @param {object} o entry fields
 * @return {object} server presence entry
 */
function entry(o = {}) {
	return { n: 'Bob Berg', k: 'pidbob0000000001', g: 0, x: 0, y: 0, s: [], d: [], e: null, h: 0, ...o }
}

/**
 * @param {string} hex #rrggbb
 * @return {number} relative luminance
 */
function luminance(hex) {
	const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

test('colorFor: stable, from the palette, spread over pids', () => {
	assert.equal(colorFor('abc'), colorFor('abc'))
	assert.ok(PALETTE.includes(colorFor('3f9a1c0b7d2e4a51')))
	const seen = new Set()
	for (let i = 0; i < 200; i++) {
		seen.add(colorFor('pid' + i.toString(16).padStart(13, '0')))
	}
	assert.ok(seen.size >= 9, 'uses most of the palette: ' + seen.size)
	assert.equal(PALETTE.length, 10)
})

test('job 227 AK7: the colour of a person is one of the ten strong tones (TEN), the same for the same pid, in participants() and sample() alike', () => {
	assert.deepEqual(PALETTE, TEN)
	let x = 12345
	const rnd = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x.toString(16).padStart(8, '0') }
	const seen = new Set()
	for (let i = 0; i < 1000; i++) {
		const pid = rnd() + rnd()
		const c = colorFor(pid)
		assert.ok(TEN.includes(c), pid + ': ' + c)
		assert.equal(colorFor(pid), c)
		seen.add(c)
	}
	assert.equal(seen.size, 10, 'all ten in use')
	const p = new PresenceModel({ now: () => 0 })
	p.update({ 'p1:c1': entry({ k: 'p1', n: 'Alice' }), 'p1:c2': entry({ k: 'p1', n: 'Alice' }), 'g7:c1': entry({ k: 'g7', n: 'Gast', g: 1 }) }, 1000)
	const bySample = new Map(p.sample(1000).map((e) => [e.pid, e.color]))
	for (const q of p.participants()) assert.equal(q.color, bySample.get(q.pid), q.pid)
	assert.equal(bySample.get('p1'), colorFor('p1'))
	assert.equal(bySample.get('g7'), colorFor('g7'))
})

test('palette: every color has contrast ≥ 4.5 against white name tags', () => {
	for (const c of PALETTE) {
		const ratio = (1 + 0.05) / (luminance(c) + 0.05)
		assert.ok(ratio >= 4.5, `${c}: ${ratio.toFixed(2)}`)
	}
})

test('interpolation: glides from the shown position to the newest sample over the observed interval, no extrapolation', () => {
	const p = new PresenceModel({ now: () => 0 })
	p.update({ 'a:c1': entry({ x: 0, y: 0, d: [[N1, 100, 100]] }) }, 1000)
	p.update({ 'a:c1': entry({ x: 100, y: 200, d: [[N1, 200, 300]] }) }, 1400)
	let s = p.sample(1400)
	assert.deepEqual(s[0].cursor, [0, 0], 'the glide starts where the cursor was shown')
	s = p.sample(1600)
	assert.deepEqual(s[0].cursor, [50, 100])
	assert.deepEqual(s[0].drag, [[N1, 150, 200]])
	s = p.sample(1800)
	assert.deepEqual(s[0].cursor, [100, 200])
	s = p.sample(5000)
	assert.deepEqual(s[0].cursor, [100, 200], 'no extrapolation')
	assert.equal(s[0].key, 'a:c1')
	assert.equal(s[0].name, 'Bob Berg')
	assert.equal(s[0].color, colorFor('pidbob0000000001'))
	assert.equal(s[0].guest, false)
	// cursor null on one side → the newest value
	p.update({ 'a:c1': entry({ x: null, y: null }) }, 6000)
	assert.equal(p.sample(6000)[0].cursor, null)
})

test('keys missing from the newest map disappear at once; {} clears everything', () => {
	const p = new PresenceModel({ now: () => 0 })
	p.update({ 'a:c1': entry(), 'b:c2': entry({ k: 'pidgina000000001', n: 'Gina', g: 1 }) }, 0)
	assert.equal(p.sample(0).length, 2)
	p.update({ 'b:c2': entry({ k: 'pidgina000000001', n: 'Gina', g: 1 }) }, 10)
	assert.deepEqual(p.sample(10).map((x) => x.key), ['b:c2'])
	assert.equal(p.sample(10)[0].guest, true)
	p.update({}, 20)
	assert.deepEqual(p.sample(20), [])
	assert.equal(p.isEmpty(), true)
})

test('entries without refresh for more than 10 s fall away', () => {
	const p = new PresenceModel({ now: () => 0, staleMs: 10000 })
	p.update({ 'a:c1': entry() }, 1000)
	assert.equal(p.sample(11000).length, 1)
	assert.equal(p.sample(11001).length, 0)
})

test('participants: deduplicated by pid, sorted by name; hasDragging', () => {
	const p = new PresenceModel({ now: () => 0 })
	p.update({
		'pidbob:c1': entry({ k: 'pidbob', n: 'Bob Berg' }),
		'pidbob:c2': entry({ k: 'pidbob', n: 'Bob Berg', d: [[N1, 1, 2]] }),
		'pidgina:c3': entry({ k: 'pidgina', n: 'Gina', g: 1 }),
		'pidal:c4': entry({ k: 'pidal', n: 'Alice Adler' }),
	}, 0)
	assert.deepEqual(p.participants().map((x) => [x.pid, x.name, x.guest]), [
		['pidal', 'Alice Adler', false], ['pidbob', 'Bob Berg', false], ['pidgina', 'Gina', true],
	])
	assert.equal(p.hasDragging(), true)
	p.update({ 'pidal:c4': entry({ k: 'pidal', n: 'Alice Adler' }) }, 5)
	assert.equal(p.hasDragging(), false)
})

test('leaseHolder: the entry with e == id and h == 1; editingHolder in samples', () => {
	const p = new PresenceModel({ now: () => 0 })
	p.update({
		'pidal:c1': entry({ k: 'pidal', n: 'Alice Adler', e: N1, h: 1 }),
		'pidbob:c2': entry({ k: 'pidbob', n: 'Bob Berg', e: N1, h: 0 }),
		'pidgina:c3': entry({ k: 'pidgina', n: 'Gina', e: N2, h: 0 }),
	}, 0)
	assert.deepEqual(p.leaseHolder(N1), { pid: 'pidal', name: 'Alice Adler' })
	assert.equal(p.leaseHolder(N2), null)
	const samples = p.sample(0)
	assert.equal(samples.find((x) => x.pid === 'pidal').editingHolder, true)
	assert.equal(samples.find((x) => x.pid === 'pidbob').editingHolder, false)
	assert.equal(samples.find((x) => x.pid === 'pidal').editing, N1)
})

/**
 * U16: a remote cursor (and drag preview) moving 1000 units per sample,
 * samples arriving every T ms; the scene samples every 16 ms.
 *
 * @param {number} T arrival interval (poll cadence of the observer)
 * @return {{maxStep: number, afterArrival: number, end: number, min: number, max: number}}
 */
function glide(T) {
	const p = new PresenceModel({ now: () => 0 })
	const t0 = 100000
	const steps = 8
	let prev = null
	let maxStep = 0
	let afterArrival = 0
	let min = Infinity
	let max = -Infinity
	for (let k = 0; k <= steps; k++) {
		p.update({ 'a:c1': entry({ x: k * 1000, y: 0, d: [[N1, k * 1000, 5]] }) }, t0 + k * T)
		for (let t = t0 + k * T; t < t0 + (k + 1) * T; t += 16) {
			const s = p.sample(t)[0]
			const x = s.cursor[0]
			assert.equal(s.drag[0][1], x, 'the drag preview moves like the cursor')
			min = Math.min(min, x)
			max = Math.max(max, x)
			if (prev !== null) {
				maxStep = Math.max(maxStep, Math.abs(x - prev))
				if (t === t0 + k * T) {
					afterArrival = Math.max(afterArrival, Math.abs(x - prev))
				}
			}
			prev = x
		}
	}
	const end = p.sample(t0 + (steps + 2) * T)[0].cursor[0]
	return { maxStep, afterArrival, end, min, max }
}

for (const T of [400, 1000, 2000]) {
	test(`U16 interpolation at a ${T} ms cadence: no jump at arrival, smooth glide, reaches the newest sample, no overshoot`, () => {
		const r = glide(T)
		const perFrame = 1000 * 16 / T
		assert.ok(r.afterArrival <= perFrame * 1.5 + 1, `jump right after an arrival: ${r.afterArrival.toFixed(1)} of 1000 (per frame ≈ ${perFrame.toFixed(1)})`)
		assert.ok(r.maxStep <= perFrame * 1.5 + 1, `largest frame-to-frame step: ${r.maxStep.toFixed(1)}`)
		assert.equal(r.end, 8000, 'ends exactly on the newest sample')
		assert.ok(r.min >= 0 && r.max <= 8000, 'no extrapolation beyond the samples')
	})
}

test('U16 interpolation: a sample after a long gap (hidden tab, > 4 s) is shown at once; a new key appears at once; cursor null clears at once', () => {
	const p = new PresenceModel({ now: () => 0 })
	p.update({ 'a:c1': entry({ x: 0, y: 0 }) }, 1000)
	assert.deepEqual(p.sample(1000)[0].cursor, [0, 0], 'first sample: at once')
	p.update({ 'a:c1': entry({ x: 500, y: 0 }) }, 10000)
	assert.deepEqual(p.sample(10000)[0].cursor, [500, 0], 'after a long gap: snap')
	p.update({ 'a:c1': entry({ x: 900, y: 0 }), 'b:c2': entry({ k: 'pidgina000000001', x: 7, y: 8 }) }, 10400)
	assert.deepEqual(p.sample(10400).find((s) => s.key === 'b:c2').cursor, [7, 8], 'new key: at once')
	assert.deepEqual(p.sample(10600).find((s) => s.key === 'a:c1').cursor, [700, 0], 'glides over the observed interval (400 ms)')
	p.update({ 'a:c1': entry({ x: null, y: null }) }, 10800)
	assert.equal(p.sample(10800)[0].cursor, null)
})

// ---- SPEC-M1 stage 3: presence v (§5.5, §6.4, §6.5.6) ---------------------------

test('M1 v: viewport glides like the cursor and comes out as RemoteSample.view; invalid v is null; participants().hasView', () => {
	let now = 1000
	const p = new PresenceModel({ now: () => now })
	const e = (v) => ({ n: 'Alice', k: 'pa', g: 0, x: 0, y: 0, s: [], d: [], e: null, h: 0, v })
	p.update({ 'pa:c1': e([0, 0, 1000, 500]) }, now)
	assert.deepEqual(p.sample(now)[0].view, [0, 0, 1000, 500])
	now = 1400
	p.update({ 'pa:c1': e([400, 0, 1000, 500]) }, now)
	assert.deepEqual(p.sample(now + 200)[0].view, [200, 0, 1000, 500], 'halfway over the observed 400 ms')
	assert.deepEqual(p.sample(now + 400)[0].view, [400, 0, 1000, 500])
	assert.deepEqual(p.entryView('pa:c1', now).view, [400, 0, 1000, 500], 'entryView: unglided, as it arrived')
	assert.equal(p.participants()[0].hasView, true)
	for (const bad of [[0, 0, 0, 100], [1, 2, 3], [1, 2, 3, 4, 5], [null, 0, 10, 10], ['1', 0, 10, 10], [2e7, 0, 10, 10], 'x', null]) {
		assert.equal(viewOf(bad), null, JSON.stringify(bad))
	}
	p.update({ 'pa:c1': e(null) }, now + 1000)
	assert.equal(p.sample(now + 1000)[0].view, null)
	assert.equal(p.participants()[0].hasView, false)
})

test('M1 youngestViewKey (CLI-16): the key whose v this client saw change last; a tie → the smallest key; entries without v and stale ones do not count', () => {
	let now = 0
	const p = new PresenceModel({ now: () => now })
	const e = (v) => ({ n: 'A', k: 'pa', v })
	p.update({ 'pa:c2': e([0, 0, 10, 10]), 'pa:c1': e([0, 0, 10, 10]), 'pa:c3': e(null) }, now)
	assert.equal(p.youngestViewKey('pa', now), 'pa:c1')
	now = 400
	p.update({ 'pa:c2': e([5, 0, 10, 10]), 'pa:c1': e([0, 0, 10, 10]), 'pa:c3': e(null) }, now)
	assert.equal(p.youngestViewKey('pa', now), 'pa:c2', 'c2 changed, c1 did not')
	now = 800
	p.update({ 'pa:c2': e([5, 0, 10, 10]), 'pa:c1': e([0, 0, 10, 10]), 'pa:c3': e(null) }, now)
	assert.equal(p.youngestViewKey('pa', now), 'pa:c2', 'an unchanged v keeps its arrival time')
	assert.equal(p.youngestViewKey('pb', now), null)
	assert.equal(p.youngestViewKey('pa', now + 20000), null, 'stale')
	assert.equal(p.entryView('pa:c2', now + 20000), null)
})

test('M1 [B] entry shape: a presenter that sent only {v} arrives with x = y = null (v after h): no cursor is drawn, the viewport is there; a cursor that was shown disappears at once', () => {
	let now = 1000
	const p = new PresenceModel({ now: () => now })
	// the full public entry of a presenter in mode vote (R16 SRV-05: only {v} sent)
	const vOnly = { n: 'Alice', k: 'pa', g: 0, x: null, y: null, s: [], d: [], e: null, h: 0, v: [0, 0, 1000, 500] }
	p.update({ 'pa:c1': vOnly }, now)
	let s = p.sample(now)[0]
	assert.equal(s.cursor, null, 'no cursor for a null x/y')
	assert.deepEqual(s.view, [0, 0, 1000, 500])
	assert.deepEqual(p.entryView('pa:c1', now).view, [0, 0, 1000, 500], 'followable')
	assert.equal(p.participants()[0].hasView, true)
	now = 1400
	p.update({ 'pa:c1': { ...vOnly, x: 50, y: 60 } }, now)
	assert.deepEqual(p.sample(now)[0].cursor, [50, 60], 'a cursor without a previous one appears at once')
	now = 1800
	p.update({ 'pa:c1': vOnly }, now)
	s = p.sample(now + 100)[0]
	assert.equal(s.cursor, null, 'back to {v} only: the cursor is gone at once, nothing glides towards null')
	// missing x/y keys behave like null; v null (not sent or invalid) is no viewport
	p.update({ 'pa:c1': { n: 'Alice', k: 'pa', g: 0, s: [], d: [], e: null, h: 0, v: null } }, now + 400)
	s = p.sample(now + 400)[0]
	assert.equal(s.cursor, null)
	assert.equal(s.view, null)
	assert.equal(p.entryView('pa:c1', now + 400).view, null)
})

// ---- factory job 171: the laser trail l (AK7) ----

/** Where the test sender's pen is at sender time t (ms): 0.5 units per ms to the right, 0.2 down. */
const penAt = (t) => [0.5 * t, 100 + 0.2 * t]

/**
 * The l of a card built at b, as the session sends it ("Senden"): the sender's points every 30 ms
 * from `from` to `to`, those of the last 2500 ms, at most the newest 80, [r1(x), r1(y), b − t].
 *
 * @param {number} b build time
 * @param {number} [from] first point
 * @param {number} [to] last point
 * @return {Array<number[]>|undefined} l, undefined without a point
 */
function laserCard(b, from = 0, to = 1e9) {
	const r1 = (v) => Math.round(v * 10) / 10
	const out = []
	for (let t = from; t <= Math.min(b, to); t += 30) {
		if (b - t <= 2500) out.push([r1(penAt(t)[0]), r1(penAt(t)[1]), Math.round(b - t)])
	}
	const l = out.slice(-80)
	return l.length > 0 ? l : undefined
}

/** @param {object} s RemoteSample @return {number[]} the tip [x, y] of its newest stroke */
const tipOf = (s) => s.laser.at(-1).at(-1)

/**
 * Checks the samples of one stroke between two times: the tip where the sender was at now − delay
 * (± 1), one stroke, ages falling strictly (no point twice), every point at most FADE old.
 */
function assertPlays(p, from, to, delay) {
	for (let now = from; now <= to; now += 16) {
		const s = p.sample(now)[0]
		assert.equal(s.laser.length, 1, `one stroke at ${now}`)
		const [x, y, age] = tipOf(s)
		const [ex, ey] = penAt(now - delay)
		assert.ok(Math.abs(x - ex) <= 1 && Math.abs(y - ey) <= 1, `tip at ${now}: ${x}, ${y} instead of ${ex}, ${ey}`)
		assert.equal(age, 0, 'the tip is new')
		const ages = s.laser[0].map((q) => q[2])
		for (let i = 1; i < ages.length; i++) assert.ok(ages[i] < ages[i - 1], `no point twice at ${now}`)
		assert.ok(ages[0] <= 1000, 'nothing older than FADE')
	}
}

test('job 171 AK7: a stroke in cards every 400 ms plays with its tip where the sender was 900 ms ago; nothing twice', () => {
	const p = new PresenceModel({ now: () => 0 })
	assert.equal(p.laserDelayMs, 900, 'laserDelay(false) by default')
	assert.equal(laserDelay(false), 900)
	for (let b = 400; b <= 6000; b += 400) {
		p.update({ 'pb:c1': entry({ k: 'pb', l: laserCard(b) }) }, b)
		assertPlays(p, Math.max(b, 2000), b + 384, 900)
	}
	assert.equal(p.hasLaser(), true)
})

test('job 171 AK7: on a view-only device (cards every 2 s) the tip is where the sender was 2500 ms ago', () => {
	assert.equal(laserDelay(true), 2500)
	const p = new PresenceModel({ now: () => 0, laserDelayMs: laserDelay(true) })
	for (let b = 2000; b <= 12000; b += 2000) {
		p.update({ 'pb:c1': entry({ k: 'pb', l: laserCard(b) }) }, b)
		assertPlays(p, Math.max(b, 4000), b + 1984, 2500)
	}
})

test('job 171 AK7: a jittered repeat of the buffered points comes once', () => {
	const p = new PresenceModel({ now: () => 0 })
	for (let b = 400; b <= 4000; b += 400) {
		// every second card arrives 10 ms late: its points get times 10 ms later than their twins
		p.update({ 'pb:c1': entry({ k: 'pb', l: laserCard(b) }) }, b + ((b / 400) % 2) * 10)
	}
	const s = p.sample(4100)[0]
	const ages = s.laser.flat().map((q) => q[2])
	for (let i = 1; i < ages.length; i++) assert.ok(ages[i] < ages[i - 1] - 10, `points ${i - 1} and ${i} are no twins: ${ages[i - 1]}, ${ages[i]}`)
})

test('job 171 AK7: two strokes and a gap over 300 ms stay apart; the strokes fade out; a card without l lets the buffer play to its end', () => {
	const p = new PresenceModel({ now: () => 0 })
	const R = 10000
	p.update({ 'pb:c1': entry({ k: 'pb', l: [[0, 0, 1000], [10, 0, 970], null, [20, 0, 900], [30, 0, 870], [40, 0, 400], [50, 0, 370]] }) }, R)
	assert.equal(p.hasLaser(), true)
	assert.deepEqual(p.sample(R - 370 + 900)[0].laser, [[[0, 0, 630], [10, 0, 600]], [[20, 0, 530], [30, 0, 500]], [[40, 0, 30], [50, 0, 0]]])
	// the tip between two points of the last stroke
	assert.deepEqual(p.sample(R - 385 + 900)[0].laser.at(-1), [[40, 0, 15], [45, 0, 0]])
	// the next card without l: the buffer plays on, hasLaser ends
	p.update({ 'pb:c1': entry({ k: 'pb' }) }, R + 400)
	assert.equal(p.hasLaser(), false)
	assert.deepEqual(p.sample(R - 370 + 900 + 600)[0].laser, [[[40, 0, 630], [50, 0, 600]]], 'still playing: only the last stroke is younger than FADE')
	assert.deepEqual(p.sample(R - 370 + 900 + 1001)[0].laser, [], 'all faded')
	// the key goes, the buffer with it
	p.update({}, R + 800)
	p.update({ 'pb:c1': entry({ k: 'pb' }) }, R + 1200)
	assert.deepEqual(p.sample(R + 1200)[0].laser, [])
})

test('job 171 AK7: an invalid l gives laser [] and counts as none; the rest of the entry stays', () => {
	const bad = {
		'a string': 'x',
		'empty': [],
		'101 elements': Array.from({ length: 101 }, () => [1, 2, 3]),
		'd rises': [[1, 2, 3], [4, 5, 6]],
		'null first': [null, [1, 2, 3]],
		'null last': [[1, 2, 3], null],
		'null twice': [[1, 2, 9], null, null, [3, 4, 5]],
		'd a float': [[1, 2, 3.5]],
		'd < 0': [[1, 2, -1]],
		'x a string': [['1', 2, 3]],
		'[x, y]': [[1, 2]],
	}
	for (const [name, l] of Object.entries(bad)) {
		const p = new PresenceModel({ now: () => 0 })
		p.update({ 'pb:c1': entry({ k: 'pb', x: 5, y: 6, s: [N1], l }) }, 1000)
		const s = p.sample(1500)[0]
		assert.deepEqual(s.laser, [], name)
		assert.deepEqual([s.cursor, s.selection], [[5, 6], [N1]], `${name}: the rest stays`)
		assert.equal(p.hasLaser(), false, name)
		assert.equal(laserOf(l), null, name)
	}
	assert.deepEqual(laserOf([[1, 2, 9], null, [3, 4, 0]]), [[1, 2, 9], null, [3, 4, 0]])
	assert.equal(new PresenceModel({ now: () => 0 }).sample(0).length, 0)
})

test('job 173 AK3: the holder per cell of a table (ec); editingCell in samples; another form counts as none', () => {
	const A = 'c00000001.r00000001'
	const B = 'c00000002.r00000001'
	const p = new PresenceModel({ now: () => 0 })
	p.update({
		'pidal:c1': entry({ k: 'pidal', n: 'Alice Adler', e: N1, ec: A, h: 1 }),
		'pidbob:c2': entry({ k: 'pidbob', n: 'Bob Berg', e: N1, ec: B, h: 1 }),
		'pidgina:c3': entry({ k: 'pidgina', n: 'Gina', e: N1, ec: A, h: 0 }),
		'pidmo:c4': entry({ k: 'pidmo', n: 'Mo', e: N2, ec: 'C1.r1', h: 1 }),
		'pidno:c5': entry({ k: 'pidno', n: 'No', e: null, ec: A, h: 0 }),
	}, 0)
	assert.deepEqual(p.leaseHolder(N1, A), { pid: 'pidal', name: 'Alice Adler' })
	assert.deepEqual(p.leaseHolder(N1, B), { pid: 'pidbob', name: 'Bob Berg' })
	assert.equal(p.leaseHolder(N1), null, 'nobody holds the table itself')
	assert.equal(p.leaseHolder(N1, 'c00000003.r00000001'), null)
	assert.deepEqual(p.leaseHolder(N2), { pid: 'pidmo', name: 'Mo' }, 'an invalid ec counts as none: the item itself')
	const samples = p.sample(0)
	const of = (pid) => samples.find((x) => x.pid === pid)
	assert.deepEqual([of('pidal').editingCell, of('pidbob').editingCell, of('pidgina').editingCell], [A, B, A])
	assert.equal(of('pidmo').editingCell, null)
	assert.equal(of('pidno').editingCell, null, 'no ec without e')
})
