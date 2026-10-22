/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PALETTE, PresenceModel, colorFor, viewOf } from '../../../src/sync/presence.js'

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
	assert.ok(seen.size >= 10, 'uses most of the palette: ' + seen.size)
	assert.equal(PALETTE.length, 12)
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
