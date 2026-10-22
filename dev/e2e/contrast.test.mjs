/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Host-side self-test of the contrast arithmetic behind E15/E16 (SPEC-M1
 * §8.4: empty guest states ≥ 4.5:1 against the card background, composited
 * over black and white, light and dark scheme). No browser, no stack. Run:
 *   node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseColor, over, luminance, contrastRatio, worstContrast, fmtColor, MIN_RATIO } from './lib/contrast.mjs'

const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const BLACK = { r: 0, g: 0, b: 0, a: 1 }
const hex = (h) => parseColor(h)
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps

test('computed colour forms of Chromium parse; unknown forms give null', () => {
	assert.deepEqual(parseColor('rgb(34, 34, 34)'), { r: 34, g: 34, b: 34, a: 1 })
	assert.deepEqual(parseColor('rgba(255, 255, 255, 0.85)'), { r: 255, g: 255, b: 255, a: 0.85 })
	assert.deepEqual(parseColor('rgb(34 34 34 / 0.5)'), { r: 34, g: 34, b: 34, a: 0.5 })
	assert.deepEqual(parseColor('rgb(34 34 34 / 50%)'), { r: 34, g: 34, b: 34, a: 0.5 })
	assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 })
	assert.deepEqual(parseColor('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 })
	assert.deepEqual(parseColor('#fff'), WHITE)
	assert.deepEqual(parseColor('#FFFFFF80'), { r: 255, g: 255, b: 255, a: 128 / 255 })
	const c = parseColor('color(srgb 0.1 0.2 0.3 / 0.4)')
	assert.ok(near(c.r, 25.5) && near(c.g, 51) && near(c.b, 76.5) && near(c.a, 0.4), JSON.stringify(c))
	for (const bad of ['oklch(0.5 0.1 200)', 'lab(50 20 30)', 'red', '', 'rgb(1, 2)', 'rgb(1 2 3 4 5)', 'rgb(1, 2, 3 / 0.5)', '#12', null, undefined, 42]) {
		assert.equal(parseColor(bad), null, `${bad} → null`)
	}
})

test('WCAG luminance and ratio match the reference values', () => {
	assert.equal(luminance(BLACK), 0)
	assert.ok(near(luminance(WHITE), 1, 1e-9))
	assert.ok(near(contrastRatio(BLACK, WHITE), 21, 1e-9))
	assert.equal(contrastRatio(WHITE, BLACK), contrastRatio(BLACK, WHITE), 'symmetric')
	// #777 is the classic just-fail grey on white, #767676 the darkest pass
	assert.ok(near(contrastRatio(hex('#777777'), WHITE), 4.48, 0.01), String(contrastRatio(hex('#777777'), WHITE)))
	assert.ok(contrastRatio(hex('#777777'), WHITE) < MIN_RATIO)
	assert.ok(contrastRatio(hex('#767676'), WHITE) >= MIN_RATIO)
	// Nextcloud 34 defaults named in src/styles/knorke.css (light and dark)
	assert.ok(contrastRatio(hex('#222222'), WHITE) > 15)
	assert.ok(near(contrastRatio(hex('#6b6b6b'), WHITE), 5.33, 0.01))
	assert.ok(contrastRatio(hex('#999999'), hex('#171717')) >= MIN_RATIO)
	assert.ok(contrastRatio(hex('#ebebeb'), hex('#171717')) >= MIN_RATIO)
})

test('source-over compositing', () => {
	assert.deepEqual(over({ r: 255, g: 255, b: 255, a: 0.5 }, BLACK), { r: 127.5, g: 127.5, b: 127.5, a: 1 })
	assert.deepEqual(over({ r: 10, g: 20, b: 30, a: 1 }, WHITE), { r: 10, g: 20, b: 30, a: 1 })
	assert.deepEqual(over({ r: 10, g: 20, b: 30, a: 0 }, WHITE), WHITE)
	assert.equal(fmtColor({ r: 127.5, g: 0, b: 0, a: 1 }), 'rgb(128, 0, 0)')
	assert.equal(fmtColor({ r: 0, g: 0, b: 0, a: 0.25 }), 'rgba(0, 0, 0, 0.25)')
})

test('an opaque card decides alone: black and white below give the same ratio', () => {
	const probe = { color: 'rgb(107, 107, 107)', chain: [{ bg: 'rgba(0, 0, 0, 0)', opacity: '1' }, { bg: 'rgb(255, 255, 255)', opacity: '1' }] }
	const r = worstContrast(probe)
	assert.equal(r.ok, true)
	assert.ok(near(r.onBlack, r.onWhite, 1e-9))
	assert.ok(near(r.ratio, 5.33, 0.01))
})

test('a translucent card is judged by its worse side (here over black)', () => {
	// main text on a 85 % white card: fine over white, worse over black
	const probe = { color: 'rgb(107, 107, 107)', chain: [{ bg: 'rgba(255, 255, 255, 0.85)', opacity: '1' }] }
	const r = worstContrast(probe)
	assert.ok(r.onBlack < r.onWhite)
	assert.equal(r.ratio, r.onBlack)
	assert.equal(r.ok, r.ratio >= MIN_RATIO)
})

test('the M0 defect stays red: an empty state on the bare theming background (no card colour)', () => {
	// dark-scheme text on a fully transparent chain: over white it is unreadable
	const probe = { color: 'rgb(235, 235, 235)', chain: [{ bg: 'rgba(0, 0, 0, 0)', opacity: '1' }, { bg: 'transparent', opacity: '1' }] }
	const r = worstContrast(probe)
	assert.equal(r.ok, false)
	assert.ok(r.onWhite < 1.3, String(r.onWhite))
	assert.ok(r.onBlack > MIN_RATIO, String(r.onBlack))
})

test('opacity in the chain lowers the contrast (product of opacities)', () => {
	const opaque = worstContrast({ color: 'rgb(34, 34, 34)', chain: [{ bg: 'rgb(255, 255, 255)', opacity: '1' }] })
	const faded = worstContrast({ color: 'rgb(34, 34, 34)', chain: [{ bg: 'rgba(0, 0, 0, 0)', opacity: '0.3' }, { bg: 'rgb(255, 255, 255)', opacity: '1' }] })
	assert.ok(faded.ratio < opaque.ratio)
	assert.equal(faded.ok, false, `${faded.ratio}`)
	// a half-transparent card fades its own background AND the text
	const cardHalf = worstContrast({ color: 'rgb(34, 34, 34)', chain: [{ bg: 'rgb(255, 255, 255)', opacity: '0.5' }] })
	// over black: card 50 % white = grey 127.5, text 50 % #222 on it = grey 80.75 → ≈ 2.0:1
	assert.ok(near(cardHalf.onBlack, 2.0, 0.01), String(cardHalf.onBlack))
	assert.equal(cardHalf.ok, false)
})

test('unreadable input is never a pass', () => {
	assert.equal(worstContrast({ color: 'oklch(0.5 0.1 200)', chain: [{ bg: 'rgb(255, 255, 255)', opacity: '1' }] }).ok, false)
	assert.match(worstContrast({ color: 'oklch(0.5 0.1 200)', chain: [] }).error, /Textfarbe/)
	assert.match(worstContrast({ color: 'rgb(0, 0, 0)', chain: [] }).error, /Hintergrundkette/)
	assert.match(worstContrast({ color: 'rgb(0, 0, 0)', chain: [{ bg: 'lab(1 2 3)', opacity: '1' }] }).error, /Hintergrund/)
	assert.match(worstContrast({ color: 'rgb(0, 0, 0)', chain: [{ bg: 'rgb(255, 255, 255)', opacity: 'x' }] }).error, /opacity/)
	assert.equal(worstContrast(null).ok, false)
})
