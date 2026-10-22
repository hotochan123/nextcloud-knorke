/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Host-side self-test of the bars check (lib/bars.mjs) that E28, E31 and E33
 * run at 390 × 844 and 820 × 1180 (SPEC-M1 §6.6 narrow layout (5), R16):
 * pairs that contain each other are skipped (timer ⊂ top, list ⊂ vote, the
 * phase-0 finding CLI-02/TST-02 that made the old check unsatisfiable),
 * overlaps over 0.5 px and boxes outside the viewport are found, the vote
 * bar must end at the bottom in every width (R17 K7: 390 × 844 and
 * 820 × 1180; with requireVote it must be there), the narrow rules (one
 * banner, panel open at the start) apply only at ≤ 600 px, hidden bars are
 * not checked. No browser. Run:
 *   node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkBars, collectBars, overlap, BAR_NAMES, BOTTOM_SLACK } from './lib/bars.mjs'

const box = (x, y, w, h) => ({ x, y, w, h })
/** A phone layout that holds: top with the timer inside, one banner, the vote bar at the bottom with "List" inside. */
function phone() {
	return {
		vw: 390,
		vh: 844,
		bars: [
			{ i: 0, name: 'top', visible: true, rect: box(0, 0, 390, 50), contains: [1] },
			{ i: 1, name: 'timer', visible: true, rect: box(300, 8, 80, 34), contains: [] },
			{ i: 2, name: 'banner', visible: true, rect: box(0, 50, 390, 40), contains: [] },
			{ i: 3, name: 'vote', visible: true, rect: box(0, 790, 390, 54), contains: [4] },
			{ i: 4, name: 'list', visible: true, rect: box(300, 796, 80, 44), contains: [] },
		],
	}
}

test('a layout that holds has no problem; contained pairs (timer in top, list in vote) are skipped', () => {
	assert.deepEqual(checkBars(phone()), [])
	assert.deepEqual(checkBars(phone(), { panelOpenAtStart: true }), [])
	assert.deepEqual([...BAR_NAMES].sort(), ['banner', 'list', 'timer', 'top', 'vote'])
})

test('an overlap over 0.5 px between unrelated bars is found, 0.5 px is not', () => {
	const s = phone()
	s.bars[2].rect = box(0, 49.6, 390, 40) // 0.4 px into top
	assert.deepEqual(checkBars(s), [])
	s.bars[2].rect = box(0, 48, 390, 40) // 2 px into top
	const p = checkBars(s)
	assert.equal(p.length, 1)
	assert.match(p[0], /^top#0 überlappt banner#2 \(390\.0 × 2\.0 px\)$/)
	// the timer overlapping the banner is a problem (timer ⊄ banner)
	const t = phone()
	t.bars[1].rect = box(300, 30, 80, 34)
	assert.ok(checkBars(t).some((x) => /timer#1 überlappt banner#2/.test(x)))
	assert.deepEqual(overlap(box(0, 0, 10, 10), box(10, 0, 10, 10)), { x: 0, y: 10 }, 'edge to edge is no overlap')
})

test('hidden bars are not checked; an unknown name and a missing top are problems', () => {
	const s = phone()
	s.bars.push({ i: 5, name: 'banner', visible: false, rect: box(0, 50, 390, 40), contains: [] })
	assert.deepEqual(checkBars(s), [], 'a hidden second banner counts neither as overlap nor as banner')
	s.bars.push({ i: 6, name: 'toast', visible: true, rect: box(0, 400, 10, 10), contains: [] })
	assert.ok(checkBars(s).some((x) => /unbekannter Bar-Name "toast"/.test(x)))
	const n = phone()
	n.bars[0].visible = false
	n.bars[1].visible = false
	assert.ok(checkBars(n).some((x) => /keine sichtbare \[data-knorke-bar=top\]/.test(x)))
	assert.deepEqual(checkBars(null), ['keine Bars-Messung'])
})

test('every checked bar lies inside the viewport (0.5 px slack)', () => {
	const s = phone()
	s.bars[3].rect = box(0, 800, 390, 54) // 10 px below the bottom
	assert.ok(checkBars(s).some((x) => /^vote#3 liegt nicht ganz im Viewport/.test(x)))
	const w = phone()
	w.bars[0].rect = box(0, 0, 390.4, 50)
	assert.deepEqual(checkBars(w), [], '0.4 px is within the slack')
})

test('narrow layout (≤ 600 px): at most one banner, the panel open at the start; vote at the bottom', () => {
	const s = phone()
	s.bars.push({ i: 5, name: 'banner', visible: true, rect: box(0, 90, 390, 40), contains: [] })
	assert.ok(checkBars(s).some((x) => /2 sichtbare Banner/.test(x)))
	const v = phone()
	v.bars[3].rect = box(0, 700, 390, 54)
	v.bars[4].rect = box(300, 706, 80, 44)
	assert.deepEqual(checkBars(v), ['vote endet bei 754.0 px, nicht unten (390 × 844)'])
	assert.ok(checkBars(phone(), { panelOpenAtStart: false }).some((x) => /beim Sitzungsbeginn nicht offen/.test(x)))
	// the same at 820 × 1180: no narrow rules (two banners, no panel rule)
	const tab = tablet()
	tab.bars.push({ i: 5, name: 'banner', visible: true, rect: box(0, 120, 820, 40), contains: [] })
	assert.deepEqual(checkBars(tab, { panelOpenAtStart: false }), [], 'tablet width: two banners and no panel rule')
})

/** A tablet layout (820 × 1180) that holds: top with the timer, one banner, the vote bar at the bottom. */
function tablet() {
	return {
		vw: 820,
		vh: 1180,
		bars: [
			{ i: 0, name: 'top', visible: true, rect: box(0, 0, 820, 50), contains: [1] },
			{ i: 1, name: 'timer', visible: true, rect: box(700, 8, 80, 34), contains: [] },
			{ i: 2, name: 'banner', visible: true, rect: box(0, 70, 820, 40), contains: [] },
			{ i: 3, name: 'vote', visible: true, rect: box(110, 1124, 600, 56), contains: [4] },
			{ i: 4, name: 'list', visible: true, rect: box(620, 1130, 80, 44), contains: [] },
		],
	}
}

test('R17 K7: the vote bar docks at the bottom in BOTH test viewports (390 × 844 and 820 × 1180, §6.6 (2), (5))', () => {
	assert.equal(BOTTOM_SLACK, 1)
	assert.deepEqual(checkBars(tablet()), [], 'tablet: vote ends at 1180')
	const t = tablet()
	t.bars[3].rect = box(110, 1000, 600, 56) // floats 124 px above the bottom
	t.bars[4].rect = box(620, 1006, 80, 44)
	assert.deepEqual(checkBars(t), ['vote endet bei 1056.0 px, nicht unten (820 × 1180)'], 'tablet width: vote not at the bottom is a problem since R17')
	for (const [vp, bottom, ok] of [[phone(), 843.1, true], [phone(), 842.9, false], [tablet(), 1179.1, true], [tablet(), 1178.9, false]]) {
		const v = vp.bars[3]
		v.rect = { ...v.rect, y: bottom - v.rect.h }
		assert.equal(checkBars(vp).length === 0, ok, `${vp.vw} × ${vp.vh}: bottom ${bottom} (slack 1 px) → ${ok ? 'holds' : 'problem'}`)
	}
	// a hidden vote bar is not checked; with requireVote a missing one is a problem
	const h = tablet()
	h.bars[3].visible = false
	h.bars[4].visible = false
	h.bars[3].rect = box(110, 500, 600, 56)
	assert.deepEqual(checkBars(h), [], 'no session: nothing to check')
	assert.deepEqual(checkBars(h, { requireVote: true }), ['keine sichtbare [data-knorke-bar=vote] (Sitzung offen)'])
	assert.deepEqual(checkBars(phone(), { requireVote: true }), [])
	assert.deepEqual(checkBars(tablet(), { requireVote: true }), [])
})

test('collectBars is self-contained (page.evaluate serialises it) and reads data-knorke-bar', () => {
	const src = collectBars.toString()
	assert.match(src, /document\.querySelectorAll\('\[data-knorke-bar\]'\)/)
	assert.match(src, /el\.contains\(o\)/)
	assert.doesNotMatch(src, /\b(BAR_NAMES|SLACK|NARROW_MAX|checkBars|overlap)\b/, 'no closure over module values')
})
