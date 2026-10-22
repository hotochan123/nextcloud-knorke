/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/tokens.js, the parts the shell imports by name (SPEC-M1 §6.2,
 * §6.5.1, arbiter decision on the token gap of stage-1 phase 0):
 * FRAME_FILL stays the string, FRAME_FILLS = [FRAME_FILL, ...STICKY_COLORS],
 * nearestFrameFill (smallest squared sRGB distance, first entry on a tie,
 * FRAME_FILL for invalid input), contrastTextOn (higher WCAG 2.x contrast,
 * '#000000' on a tie), SHAPE_PALETTE and CONNECTOR_COLORS (frozen lowercase
 * #rrggbb lists with the required entries).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as tokens from '../../../src/model/tokens.js'
import { TYPES } from '../../../src/model/registry.js'

const { FRAME_FILL, FRAME_FILLS, STICKY_COLORS, SHAPE_PALETTE, CONNECTOR_COLORS, nearestFrameFill, contrastTextOn } = tokens

const LOWER_HEX = /^#[0-9a-f]{6}$/
const INVALID = [null, undefined, '', '#fff', 'ffffff', '#gggggg', '#ffffff ', ' #ffffff', '#fffffff', 0xffffff, ['#ffffff'], {}]

/**
 * @param {string} h #rrggbb
 * @return {number[]} channels 0..255
 */
function rgb(h) {
	return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/**
 * @param {string} h #rrggbb
 * @return {number} WCAG 2.x relative luminance, written independently of tokens.js
 */
function luminance(h) {
	const [r, g, b] = rgb(h).map((v) => {
		const c = v / 255
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * @param {string} a color
 * @param {string} b color
 * @return {number} WCAG contrast ratio
 */
function ratio(a, b) {
	const la = luminance(a)
	const lb = luminance(b)
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * @param {number} r red
 * @param {number} g green
 * @param {number} b blue
 * @return {string} #rrggbb
 */
function hex(r, g, b) {
	return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

describe('palettes', () => {
	test('FRAME_FILL stays the string; FRAME_FILLS = [FRAME_FILL, ...STICKY_COLORS]', () => {
		assert.equal(FRAME_FILL, '#ffffff')
		assert.equal(TYPES.frame.defaults.style.fill, FRAME_FILL)
		assert.deepEqual(FRAME_FILLS, [FRAME_FILL, ...STICKY_COLORS])
		assert.ok(Object.isFrozen(FRAME_FILLS))
	})

	for (const [name, list, must] of [
		['FRAME_FILLS', FRAME_FILLS, ['#ffffff']],
		['SHAPE_PALETTE', SHAPE_PALETTE, ['#ffffff', '#1a1a1a']],
		['CONNECTOR_COLORS', CONNECTOR_COLORS, ['#1a1a1a']],
	]) {
		test(`${name}: frozen, lowercase #rrggbb, no duplicates, contains ${must.join(', ')}`, () => {
			assert.ok(Array.isArray(list) && list.length >= 2)
			assert.ok(Object.isFrozen(list))
			for (const c of list) assert.match(c, LOWER_HEX)
			assert.equal(new Set(list).size, list.length)
			for (const c of must) assert.ok(list.includes(c), c)
		})
	}

	test('the defaults of new shapes, texts and connectors are palette entries', () => {
		const s = TYPES.shape.defaults.style
		assert.ok(SHAPE_PALETTE.includes(s.fill) && SHAPE_PALETTE.includes(s.stroke))
		assert.ok(SHAPE_PALETTE.includes(TYPES.text.defaults.style.color))
		assert.ok(CONNECTOR_COLORS.includes(TYPES.connector.defaults.style.stroke))
		assert.equal(CONNECTOR_COLORS[0], TYPES.connector.defaults.style.stroke, 'the default first')
	})
})

describe('nearestFrameFill', () => {
	test('identity on every frame color (so on every note color: M0 behaviour for notes + frames)', () => {
		for (const c of FRAME_FILLS) assert.equal(nearestFrameFill(c), c)
		for (const c of STICKY_COLORS) assert.equal(nearestFrameFill(c), c)
	})

	test('invalid input → FRAME_FILL; upper-case hex is accepted, the result is lower case', () => {
		for (const v of INVALID) assert.equal(nearestFrameFill(v), FRAME_FILL, String(v))
		assert.equal(nearestFrameFill(STICKY_COLORS[3].toUpperCase()), STICKY_COLORS[3])
		assert.equal(nearestFrameFill('#FFFFFE'), FRAME_FILL)
	})

	test('smallest squared sRGB distance, first entry on a tie (grid sweep against a reference)', () => {
		const pal = FRAME_FILLS.map(rgb)
		let checked = 0
		for (let r = 0; r < 256; r += 15) {
			for (let g = 0; g < 256; g += 15) {
				for (let b = 0; b < 256; b += 15) {
					const d = pal.map(([pr, pg, pb]) => (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2)
					const want = FRAME_FILLS[d.indexOf(Math.min(...d))]
					assert.equal(nearestFrameFill(hex(r, g, b)), want, hex(r, g, b))
					checked++
				}
			}
		}
		assert.equal(checked, 18 ** 3)
	})

	test('an exact tie picks the earlier entry', () => {
		// #00ff00 is equally far from FRAME_FILLS[4] and FRAME_FILLS[6]
		const [a, b] = [rgb(FRAME_FILLS[4]), rgb(FRAME_FILLS[6])]
		const dist = (p) => (p[0] - 0) ** 2 + (p[1] - 255) ** 2 + (p[2] - 0) ** 2
		assert.equal(dist(a), dist(b), 'precondition: a real tie')
		assert.equal(nearestFrameFill('#00ff00'), FRAME_FILLS[4])
	})
})

describe('contrastTextOn', () => {
	test('known colors', () => {
		assert.equal(contrastTextOn('#ffffff'), '#000000')
		assert.equal(contrastTextOn('#000000'), '#ffffff')
		assert.equal(contrastTextOn('#1a1a1a'), '#ffffff')
		assert.equal(contrastTextOn('#fff6b6'), '#000000')
		assert.equal(contrastTextOn('#0082c9'), '#000000', '5.04 : 1 against black, 4.17 : 1 against white')
		assert.equal(contrastTextOn('#0082C9'), '#000000', 'upper case accepted')
	})

	test('invalid input → #000000', () => {
		for (const v of INVALID) assert.equal(contrastTextOn(v), '#000000', String(v))
	})

	test('the higher WCAG ratio wins and is always ≥ 4.5 : 1 (grid sweep, every palette color)', () => {
		const colors = [...FRAME_FILLS, ...SHAPE_PALETTE, ...CONNECTOR_COLORS]
		for (let r = 0; r < 256; r += 17) {
			for (let g = 0; g < 256; g += 17) {
				for (let b = 0; b < 256; b += 17) colors.push(hex(r, g, b))
			}
		}
		for (const c of colors) {
			const got = contrastTextOn(c)
			const other = got === '#000000' ? '#ffffff' : '#000000'
			assert.ok(ratio(c, got) >= ratio(c, other), `${c}: ${got}`)
			assert.ok(ratio(c, got) >= 4.5, `${c}: ${ratio(c, got)}`)
		}
	})

	test('greys switch from white to black text exactly once', () => {
		const seq = []
		for (let v = 0; v < 256; v++) seq.push(contrastTextOn(hex(v, v, v)))
		const first = seq.indexOf('#000000')
		assert.ok(first > 0)
		assert.ok(seq.slice(0, first).every((x) => x === '#ffffff') && seq.slice(first).every((x) => x === '#000000'))
	})
})
