/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Where the context bar and its panel stand in the wide layout (factory job
 * 137, components/barPlace.js; AK1 bar, AK2 panel). Start: board W 1000 ×
 * H 800, T 100, U 792, a bar of 400 × 44.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { EDGE, GAP, PANEL_GAP, barLimits, placeBar, placePanel } from '../../../src/components/barPlace.js'

const W = 1000
const H = 800
const ROOM = { W, H, T: 100, U: 792, w: 400, h: 44 }

/** @return {{x:number, y:number, w:number, h:number}} */
const r = (x, y, w, h) => ({ x, y, w, h })

describe('AK1 the bar', () => {
	test('the constants of the rules', () => {
		assert.deepEqual([EDGE, GAP, PANEL_GAP], [8, 8, 6])
	})

	test('limits: L 8, R W − 8, T the deeper chrome edge + 8, U the VoteBar top (else H) − 8', () => {
		assert.deepEqual(barLimits({ W, H, chrome: 92 }), { L: 8, R: 992, T: 100, U: 792 })
		assert.deepEqual(barLimits({ W, H, chrome: 92, vote: 700 }), { L: 8, R: 992, T: 100, U: 692 })
		assert.deepEqual(barLimits({ W, H, chrome: 92, vote: null }).U, 792)
	})

	test('keep {400,300,200,200} with box {430,344,140,120}: left 300, top 248, above', () => {
		assert.deepEqual(placeBar({ box: r(430, 344, 140, 120), keep: r(400, 300, 200, 200) }, ROOM), { place: 'above', left: 300, top: 248 })
	})

	test('keep.y 120: below, top 328', () => {
		assert.deepEqual(placeBar({ box: r(430, 164, 140, 120), keep: r(400, 120, 200, 200) }, ROOM), { place: 'below', left: 300, top: 328 })
	})

	test('keep {0,60,1000,740}: pinned, top 100', () => {
		assert.deepEqual(placeBar({ box: r(30, 100, 940, 660), keep: r(0, 60, 1000, 740) }, ROOM), { place: 'pinned', left: 300, top: 100 })
	})

	test('the middle of the box at x 50: left 8; at x 980: left 592', () => {
		assert.equal(placeBar({ box: r(0, 400, 100, 100), keep: r(0, 340, 100, 160) }, ROOM).left, 8)
		assert.equal(placeBar({ box: r(960, 400, 40, 100), keep: r(940, 340, 80, 160) }, ROOM).left, 592)
	})

	test('a box entirely outside, in each of the four directions: hidden', () => {
		for (const box of [r(-300, 300, 200, 200), r(1100, 300, 200, 200), r(400, -300, 200, 200), r(400, 900, 200, 200), r(-200, 300, 200, 200), r(1000, 300, 200, 200), r(400, 800, 200, 200), r(400, -200, 200, 200)]) {
			assert.equal(placeBar({ box, keep: r(box.x - 66, box.y - 66, box.w + 132, box.h + 132) }, ROOM).place, 'hidden', JSON.stringify(box))
		}
		assert.equal(placeBar(null, ROOM).place, 'hidden', 'no box (nothing selected or a movement)')
	})

	test('box {x −100, w 300} with a bar 100 px wide: left 50 (the middle of the part in view)', () => {
		assert.equal(placeBar({ box: r(-100, 400, 300, 100), keep: r(-166, 334, 432, 232) }, { ...ROOM, w: 100 }).left, 50)
	})

	test('keep {400,120,200,540}: below; with the VoteBar top at 700: pinned', () => {
		const b = { box: r(430, 164, 140, 460), keep: r(400, 120, 200, 540) }
		assert.deepEqual(placeBar(b, ROOM), { place: 'below', left: 300, top: 668 })
		const U = barLimits({ W, H, chrome: 92, vote: 700 }).U
		assert.deepEqual(placeBar(b, { ...ROOM, U }), { place: 'pinned', left: 300, top: 100 })
	})

	test('a bar 990 px wide: left 8', () => {
		assert.equal(placeBar({ box: r(430, 344, 140, 120), keep: r(400, 300, 200, 200) }, { ...ROOM, w: 990 }).left, 8)
	})
})

describe('AK2 the panel', () => {
	/** @return {object} the bar at top `top`, placed `place` (400 × 44 at left 300) */
	const bar = (place, top, left = 300) => ({ place, left, top, w: 400, h: 44 })
	const room = (pw, ph) => ({ W, T: 100, U: 792, pw, ph })

	test('bar above at top 248: a panel of 120 px goes above, one of 150 px below', () => {
		assert.deepEqual(placePanel(bar('above', 248), room(300, 120)), { side: 'above', left: 350, top: 122 })
		assert.deepEqual(placePanel(bar('above', 248), room(300, 150)), { side: 'below', left: 350, top: 298 })
	})

	test('bar below at top 600: 120 px below, 200 px above', () => {
		assert.deepEqual(placePanel(bar('below', 600), room(300, 120)), { side: 'below', left: 350, top: 650 })
		assert.deepEqual(placePanel(bar('below', 600), room(300, 200)), { side: 'above', left: 350, top: 394 })
	})

	test('pinned: below', () => {
		assert.equal(placePanel(bar('pinned', 100), room(300, 120)).side, 'below')
		assert.equal(placePanel(bar('pinned', 100), room(300, 700)).side, 'below', 'even when it does not fit')
	})

	test('no side fits: the one with more room wins (a tie: below)', () => {
		// above 248: room above 142, below 494
		assert.equal(placePanel(bar('above', 248), room(300, 600)).side, 'below')
		// below 600: room above 494, below 142
		assert.equal(placePanel(bar('below', 600), room(300, 600)).side, 'above')
		// room above = top − 6 − 100, below = 792 − (top + 44 + 6): top 422 → 316 / 320, top 426 → 320 / 316
		for (const place of ['above', 'below']) {
			assert.equal(placePanel(bar(place, 422), room(300, 600)).side, 'below', place)
			assert.equal(placePanel(bar(place, 426), room(300, 600)).side, 'above', place)
			// a tie: top 424, 318 on each side
			assert.equal(placePanel(bar(place, 424), room(300, 600)).side, 'below', place)
		}
	})

	test('a panel 560 px wide stays in [8, 992]; centred on the bar where it can', () => {
		for (const left of [8, 300, 592]) {
			const p = placePanel(bar('above', 248, left), room(560, 120))
			assert.ok(p.left >= 8 && p.left + 560 <= 992, `${left}: ${p.left}`)
		}
		assert.equal(placePanel(bar('above', 248, 300), room(560, 120)).left, 220, 'centred: 300 + 200 − 280')
		assert.equal(placePanel(bar('above', 248, 8), room(560, 120)).left, 8)
		assert.equal(placePanel(bar('above', 248, 592), room(560, 120)).left, 432)
		assert.equal(placePanel(bar('above', 248, 300), room(990, 120)).left, 8, 'wider than R − L: from L')
	})
})

describe('job 230 AK3: the panel gives way to the selection and never covers the bar', () => {
	const bar = (place, top, left = 300) => ({ place, left, top, w: 400, h: 44 })
	const room = (pw, ph, keep) => ({ W, T: 100, U: 792, pw, ph, keep })
	/** @return {boolean} the panel shares area with the box */
	const over = (p, pw, ph, b) => p.left < b.x + b.w && b.x < p.left + pw && p.top < b.y + b.h && b.y < p.top + ph
	const barBox = (b) => r(b.left, b.top, b.w, b.h)

	test('(a) the side away from the selection while it fits: a bar above, a panel of 120 px above it', () => {
		const keep = r(400, 300, 200, 200)
		assert.deepEqual(placePanel(bar('above', 248), room(300, 120, keep)), { side: 'above', left: 350, top: 122 })
		assert.deepEqual(placePanel(bar('below', 600), room(300, 120, r(400, 380, 200, 212))), { side: 'below', left: 350, top: 650 })
	})

	test('(b) right of keep when (a) does not fit: top at keep.y, pushed into [T, U − ph]', () => {
		const keep = r(400, 300, 200, 200)
		assert.deepEqual(placePanel(bar('above', 248), room(300, 150, keep)), { side: 'right', left: 608, top: 300 })
		assert.deepEqual(placePanel(bar('below', 600), room(300, 200, r(400, 380, 200, 212))), { side: 'right', left: 608, top: 380 })
		// a low selection, the bar beside it at the left edge: the panel rises to U − ph, still right of keep
		assert.deepEqual(placePanel(bar('above', 100, 8), room(300, 450, r(400, 600, 200, 180))), { side: 'right', left: 608, top: 342 })
	})

	test('(c) left of keep when the right side has no room', () => {
		const keep = r(700, 300, 250, 200)
		assert.deepEqual(placePanel(bar('above', 248, 592), room(300, 150, keep)), { side: 'left', left: 392, top: 300 })
	})

	test('(d) neither side: the rule of job 137 (it may cover the selection, never the bar)', () => {
		const keep = r(50, 300, 900, 200)
		assert.deepEqual(placePanel(bar('above', 248), room(300, 150, keep)), { side: 'below', left: 350, top: 298 })
		// a pinned bar over a tall selection: beside it would cover the bar, so below the bar
		const pinned = bar('pinned', 100)
		const p = placePanel(pinned, room(300, 150, r(400, 60, 200, 700)))
		assert.deepEqual(p, { side: 'below', left: 350, top: 150 })
	})

	test('never over the bar, for every place, panel size and keep box of a grid of cases', () => {
		for (const place of ['above', 'below', 'pinned']) {
			for (const top of [100, 248, 424, 600]) {
				for (const [pw, ph] of [[300, 120], [300, 150], [336, 420], [560, 600]]) {
					for (const keep of [r(400, 300, 200, 200), r(700, 300, 250, 200), r(50, 300, 900, 200), r(400, 60, 200, 700), null]) {
						const b = bar(place, top)
						const p = placePanel(b, room(pw, ph, keep))
						assert.ok(!over(p, pw, ph, barBox(b)), JSON.stringify({ place, top, pw, ph, keep, p }))
						if (p.side === 'right' || p.side === 'left') {
							assert.ok(!over(p, pw, ph, keep), 'beside keep: never over it')
							assert.ok(p.left >= 8 && p.left + pw <= 992 && p.top >= 100 && p.top + ph <= 792, 'wholly inside')
						}
					}
				}
			}
		}
	})

	test('the bar passes the keep box of the scene (else its box)', async () => {
		const { readFileSync } = await import('node:fs')
		const src = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
		assert.match(src, /placePanel\([^)]*\{ W: r\.W, T: r\.T, U: r\.U, pw: ps\.w, ph: ps\.h, keep: props\.at\?\.keep \?\? props\.at\?\.box \?\? null \}\)/)
	})
})
