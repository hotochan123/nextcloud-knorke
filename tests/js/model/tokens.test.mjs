/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/tokens.js, the parts the shell imports by name (SPEC-M1 §6.2,
 * §6.5.1, arbiter decision on the token gap of stage-1 phase 0):
 * FRAME_FILL stays the string, FRAME_FILLS = [FRAME_FILL, ...STICKY_COLORS],
 * contrastTextOn (higher WCAG 2.x contrast, '#000000' on a tie),
 * SHAPE_PALETTE and CONNECTOR_COLORS (frozen lowercase #rrggbb lists with the
 * required entries). Job 135: noteTextColor (white on a dark note fill, else
 * TEXT_COLOR; every note colour keeps TEXT_COLOR). Job 186: labOf (CIELAB,
 * D65) and nearestColor (smallest CIE76 distance, the earlier entry on a tie).
 * Job 227: the one palette (AK1), shownColor and shownLine (AK2), the look
 * of notes, canvas, frames and lanes (AK10).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as tokens from '../../../src/model/tokens.js'
import { TYPES } from '../../../src/model/registry.js'

const { FRAME_FILL, FRAME_FILLS, STICKY_COLORS, SHAPE_PALETTE, CONNECTOR_COLORS, TEXT_COLOR, contrastTextOn, labOf, nearestColor, noteTextColor } = tokens

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

	test('(job 227) the defaults of new notes, shapes and texts are tones of the one palette; connectors take CONNECTOR_STROKE', () => {
		const s = TYPES.shape.defaults.style
		// job 260 (design round 3, F4): the border is the default line #3d4044, offered first as "Default"
		assert.ok(tokens.LIGHT.includes(s.fill) && s.stroke === tokens.SHAPE_BORDER)
		assert.deepEqual([s.fill, s.stroke, s.strokeWidth], ['#ffffff', '#3d4044', 2], 'F4: #3d4044, 2 px')
		assert.equal(TYPES.text.defaults.style.color, '#191b1d')
		assert.deepEqual([TYPES.connector.defaults.style.stroke, TYPES.connector.defaults.style.strokeWidth], ['#3d4044', 2], 'tokens.css --connector-stroke, 2 px')
		assert.equal(tokens.CONNECTOR_STROKE, '#3d4044')
		assert.deepEqual(TYPES.sticky.defaults.style, { fill: '#a2d9fe', fontSize: 22 }, 'Light blue, text size M')
		assert.equal(TYPES.pad.defaults.style.fill, '#a2d9fe')
	})
})

describe('noteTextColor (job 135, AK8)', () => {
	test('every note colour keeps TEXT_COLOR; #1a1a1a and #7048e8 get white; upper case accepted', () => {
		assert.equal(STICKY_COLORS.length, 14)
		for (const c of STICKY_COLORS) assert.equal(noteTextColor(c), TEXT_COLOR, c)
		assert.equal(noteTextColor('#1a1a1a'), '#ffffff')
		assert.equal(noteTextColor('#7048e8'), '#ffffff')
		assert.equal(noteTextColor('#1F3A5F'), '#ffffff')
		assert.equal(noteTextColor('#ffffff'), TEXT_COLOR)
	})

	test('white exactly where contrastTextOn picks white; invalid input → TEXT_COLOR', () => {
		for (let v = 0; v < 256; v += 5) {
			const c = hex(v, 255 - v, (v * 7) % 256)
			assert.equal(noteTextColor(c), contrastTextOn(c) === '#ffffff' ? '#ffffff' : TEXT_COLOR, c)
		}
		for (const v of INVALID) assert.equal(noteTextColor(v), TEXT_COLOR, String(v))
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

describe('labOf and nearestColor (job 186)', () => {
	/** @param {number[]} got @param {number[]} want @param {string} msg */
	const near = (got, want, msg) => {
		assert.ok(Array.isArray(got) && got.length === 3, msg)
		for (const i of [0, 1, 2]) assert.ok(Math.abs(got[i] - want[i]) < 0.01, msg + ': ' + got.join(', '))
	}

	test('labOf: CIELAB (D65) of known colours, upper case accepted; invalid input → null', () => {
		near(labOf('#ffffff'), [100, 0, 0], 'white')
		near(labOf('#000000'), [0, 0, 0], 'black')
		near(labOf('#ff0000'), [53.24, 80.09, 67.20], 'red')
		near(labOf('#00FF00'), [87.73, -86.18, 83.18], 'green, upper case')
		near(labOf('#0000ff'), [32.30, 79.19, -107.86], 'blue')
		near(labOf('#808080'), [53.59, 0, 0], 'grey')
		for (const v of INVALID) assert.equal(labOf(v), null, String(v))
	})

	test('nearestColor: the smallest CIE76 distance, an exact entry itself, the earlier entry on a tie, the entry as given', () => {
		const list = ['#ffffff', '#1a1a1a', '#e03131', '#0082c9']
		for (const c of list) assert.equal(nearestColor(c, list), c)
		assert.equal(nearestColor('#000000', list), '#1a1a1a')
		assert.equal(nearestColor('#ff0000', list), '#e03131')
		assert.equal(nearestColor('#3366CC', list), '#0082c9', 'upper case accepted')
		assert.equal(nearestColor('#f0f0f0', list), '#ffffff')
		assert.equal(nearestColor('#123456', ['#FFFFFF', '#ffffff']), '#FFFFFF', 'a tie: the earlier one, as given')
		assert.equal(nearestColor('#123456', ['#1a1a1a', '#1A1A1A']), '#1a1a1a')
		assert.equal(nearestColor('#ffffff', ['red', '#12345', null, '#000000']), '#000000', 'entries that are no colour are skipped')
	})

	test('nearestColor: CIELAB, not RGB (#ffff00 is nearer to #f5d76e than to #f08c00 in CIELAB, the other way round in RGB)', () => {
		const sq = (a, b) => rgb(a).reduce((sum, v, i) => sum + (v - rgb(b)[i]) ** 2, 0)
		assert.ok(sq('#ffff00', '#f08c00') < sq('#ffff00', '#f5d76e'), 'RGB says orange')
		assert.equal(nearestColor('#ffff00', ['#f08c00', '#f5d76e']), '#f5d76e')
		assert.equal(nearestColor('#c0c0c0', ['#c8a5d6', '#e4e4e4']), '#e4e4e4')
	})

	test('nearestColor: null for an invalid colour or a list without one', () => {
		for (const v of INVALID) assert.equal(nearestColor(v, SHAPE_PALETTE), null, String(v))
		assert.equal(nearestColor('#ffffff', []), null)
		assert.equal(nearestColor('#ffffff', ['red']), null)
	})
})

describe('(job 194) the labels of the snapping', () => {
	test('white text on SNAP_LABEL_FILL ≥ 4.5 : 1; the fill is darker than the guides (SNAP_GUIDE_COLOR is not enough)', () => {
		const { SNAP_LABEL_FILL, SNAP_LABEL_TEXT, SNAP_GUIDE_COLOR } = tokens
		assert.match(SNAP_LABEL_FILL, LOWER_HEX)
		assert.equal(SNAP_LABEL_TEXT, '#ffffff')
		assert.ok(ratio(SNAP_LABEL_TEXT, SNAP_LABEL_FILL) >= 4.5, `${ratio(SNAP_LABEL_TEXT, SNAP_LABEL_FILL)}`)
		assert.ok(ratio('#ffffff', SNAP_GUIDE_COLOR) < 4.5, 'the guide magenta alone would be too pale')
		assert.ok(luminance(SNAP_LABEL_FILL) < luminance(SNAP_GUIDE_COLOR))
		// still a magenta: red and blue above green, like the guides
		const [r, g, b] = rgb(SNAP_LABEL_FILL)
		assert.ok(r > g && b > g)
	})
})

// ---- Job 227: the one palette ------------------------------------------------------------

describe('job 227 AK1: the one palette', () => {
	const WANT = [
		['hellblau', 'Light blue', '#a2d9fe', '#0275a9'], ['tuerkis', 'Turquoise', '#8fe7e1', '#087c77'], ['salbei', 'Sage', '#b3e8b3', '#307d37'],
		['gelb', 'Yellow', '#faea89', '#7e6f01'], ['orange', 'Orange', '#febf87', '#a25d04'], ['koralle', 'Coral', '#ffaaa7', '#c43e45'],
		['rosa', 'Pink', '#f9b7d6', '#b94082'], ['lila', 'Purple', '#d9b9ee', '#9550bb'], ['indigo', 'Indigo', '#b9c8fc', '#5165d3'],
		['sand', 'Sand', '#e1ceb0', '#816b46'], ['weiss', 'White', '#ffffff', '#ffffff'], ['grau', 'Gray', '#e0e0dd', '#6f6f6d'],
		['schwarz', 'Black', '#191b1d', '#191b1d'],
	]

	test('13 colours in the order of docs/redesign/tokens.css with the values there; frozen', () => {
		assert.deepEqual(tokens.PALETTE.map((e) => [e.key, e.name, e.light, e.strong]), WANT)
		assert.ok(Object.isFrozen(tokens.PALETTE) && tokens.PALETTE.every((e) => Object.isFrozen(e)))
		const css = readFileSync(new URL('../../../docs/redesign/tokens.css', import.meta.url), 'utf8')
		for (const [key, , light, strong] of WANT) {
			const css1 = css.match(new RegExp('--pal-' + key + '-light:\\s*(#[0-9a-f]{6})'))?.[1]
			assert.equal(css1, light, key + ' light')
			if (key !== 'weiss') assert.equal(css.match(new RegExp('--pal-' + key + '-strong:\\s*(#[0-9a-f]{6})'))?.[1], strong, key + ' strong')
		}
	})

	test('LIGHT, STRONG, STRONG_COLORED (no white) and TEN; tags and branches take them', () => {
		assert.deepEqual(tokens.LIGHT, WANT.map((e) => e[2]))
		assert.deepEqual(tokens.STRONG, WANT.map((e) => e[3]))
		assert.deepEqual(tokens.STRONG_COLORED, WANT.filter((e) => e[0] !== 'weiss').map((e) => e[3]))
		assert.deepEqual(tokens.TEN, WANT.slice(0, 10).map((e) => e[3]))
		assert.deepEqual(tokens.TAG_COLORS, tokens.STRONG_COLORED)
		assert.deepEqual(tokens.MM_COLORS, tokens.TEN)
		assert.equal(tokens.DEFAULT_STICKY_FILL, tokens.LIGHT[0])
	})

	test('contrast: dark text on every light tone but Black ≥ 4.5 : 1 (noteTextColor keeps TEXT_COLOR); Black gets white; white on every tone of TEN ≥ 4.5 : 1', () => {
		for (const c of tokens.LIGHT.filter((x) => x !== '#191b1d')) {
			assert.ok(ratio(c, TEXT_COLOR) >= 4.5, c)
			assert.equal(noteTextColor(c), TEXT_COLOR, c)
		}
		assert.equal(noteTextColor('#191b1d'), '#ffffff')
		for (const c of tokens.TEN) assert.ok(ratio(c, '#ffffff') >= 4.5, c + ' ' + ratio(c, '#ffffff').toFixed(2))
		assert.equal(TEXT_COLOR, '#191b1d')
	})
})

describe('job 227 AK2: shownColor and shownLine', () => {
	const legacyLight = [...STICKY_COLORS, ...SHAPE_PALETTE.slice(0, 8), FRAME_FILL]
	const legacyStrong = [...SHAPE_PALETTE.slice(8), ...CONNECTOR_COLORS, ...tokens.LEGACY_TAG_COLORS, ...tokens.LEGACY_MM_COLORS]

	test('every old light colour is the nearest light tone, every old strong colour the nearest strong tone without white; no old colour is in both rows', () => {
		for (const c of legacyLight) assert.equal(tokens.shownColor(c), nearestColor(c, tokens.LIGHT), c)
		for (const c of legacyStrong) assert.equal(tokens.shownColor(c), nearestColor(c, tokens.STRONG_COLORED), c)
		assert.equal(legacyLight.filter((c) => legacyStrong.includes(c)).length, 0)
	})

	test('samples: #a8d8f8 → Light blue, #fff6b6 → Yellow, #1a1a1a → Black, #e03131 → Coral; upper case too', () => {
		assert.equal(tokens.shownColor('#a8d8f8'), '#a2d9fe')
		assert.equal(tokens.shownColor('#fff6b6'), '#faea89')
		assert.equal(tokens.shownColor('#1a1a1a'), '#191b1d')
		assert.equal(tokens.shownColor('#e03131'), '#c43e45')
		assert.equal(tokens.shownColor('#A8D8F8'), '#a2d9fe')
	})

	test('new tones and custom colours stay (lower case); anything that is no #rrggbb is given back', () => {
		for (const c of [...tokens.LIGHT, ...tokens.STRONG, tokens.CONNECTOR_STROKE, '#123456', '#ff8800']) assert.equal(tokens.shownColor(c), c)
		assert.equal(tokens.shownColor('#ABCDEF'), '#abcdef')
		for (const v of INVALID) assert.equal(tokens.shownColor(v), v)
	})

	test('shownLine: the old default #1a1a1a of a connector is CONNECTOR_STROKE, everything else as shownColor', () => {
		assert.equal(tokens.shownLine('#1a1a1a'), '#3d4044')
		assert.equal(tokens.shownLine('#1A1A1A'), '#3d4044')
		assert.equal(tokens.shownLine('#e03131'), '#c43e45')
		assert.equal(tokens.shownLine('#123456'), '#123456')
		assert.equal(tokens.shownLine('#191b1d'), '#191b1d')
	})
})

describe('job 227 AK10: the look of notes, canvas, frames and lanes', () => {
	test('notes: radius 6, padding 18 and two shadows (job 259); text sizes S 16, M 22, L 32; the canvas keeps Arial', () => {
		assert.equal(tokens.STICKY_RADIUS, 6)
		assert.equal(tokens.STICKY_PADDING, 18)
		assert.deepEqual(tokens.NOTE_SHADOWS.map((s) => ({ ...s })), [{ x: 0, y: 5, blur: 14, opacity: 0.09 }, { x: 0, y: 1, blur: 2, opacity: 0.10 }])
		assert.deepEqual([tokens.NOTE_SIZE_S, tokens.NOTE_SIZE_M, tokens.NOTE_SIZE_L], [16, 22, 32])
		assert.match(tokens.FONT_FAMILY, /^Arial,/)
	})

	test('canvas #f3f2f0 (also in knorke.css); frames and lanes #67686a at 1.5 (job 243); the frame name 22, semibold, dark, its band (the tab) 40', () => {
		assert.equal(tokens.BOARD_BACKGROUND, '#f3f2f0')
		const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
		assert.match(css, /--knorke-board-bg: #f3f2f0;/)
		assert.doesNotMatch(css, /#f1f1ec/i)
		assert.deepEqual([tokens.FRAME_STROKE, tokens.FRAME_STROKE_WIDTH], ['#67686a', 1.5])
		assert.deepEqual([tokens.FRAME_TITLE_SIZE, tokens.FRAME_TITLE_WEIGHT, tokens.FRAME_TITLE_COLOR, tokens.FRAME_TITLE_BAND], [22, '600', '#191b1d', 40])
		assert.ok(ratio(tokens.FRAME_TITLE_HINT_COLOR, tokens.BOARD_BACKGROUND) >= 4.5, 'the title hint stays readable')
	})
})

describe('job 243: the tab of a frame title and the frame outline', () => {
	/** The 4096 colours #rgb doubled: #000000, #000011, … #ffffff. */
	const SWEEP = Array.from({ length: 4096 }, (_, i) => '#' + [8, 4, 0].map((s) => ((i >> s) & 15).toString(16).repeat(2)).join(''))
	const onTab = (fill) => {
		const tab = tokens.frameTabFill(fill)
		return ratio(tab, tokens.frameTabText(tab))
	}

	test('AK1 the three tones of the design exactly: White #d1d1ce, Yellow #e8ce49, Light blue #6bbef2; dark text on them', () => {
		assert.equal(tokens.frameTabFill('#ffffff'), '#d1d1ce')
		assert.equal(tokens.frameTabFill('#faea89'), '#e8ce49')
		assert.equal(tokens.frameTabFill('#A2D9FE'), '#6bbef2', 'upper case too')
		for (const c of ['#d1d1ce', '#e8ce49', '#6bbef2']) assert.equal(tokens.frameTabText(c), TEXT_COLOR)
	})

	test('AK1 every LIGHT tone has its tab tone in FRAME_TAB_FILLS; the other ten are what the rule computes', () => {
		assert.deepEqual(Object.keys(tokens.FRAME_TAB_FILLS).sort(), [...tokens.LIGHT].sort())
		for (const c of tokens.LIGHT) {
			assert.equal(tokens.frameTabFill(c), tokens.FRAME_TAB_FILLS[c], c)
			if (!['#ffffff', '#faea89', '#a2d9fe'].includes(c)) assert.equal(tokens.frameTabRule(c), tokens.FRAME_TAB_FILLS[c], `${c} still matches the rule`)
		}
		assert.ok(Object.isFrozen(tokens.FRAME_TAB_FILLS))
	})

	test('AK1 the title reaches 4.5 : 1 on the tab of every LIGHT tone, every old palette colour and all 4096 #rgb colours', () => {
		for (const c of [...tokens.LIGHT, ...FRAME_FILLS, ...STICKY_COLORS, ...SHAPE_PALETTE, ...SWEEP]) {
			assert.ok(onTab(c) >= tokens.FRAME_TAB_MIN_CONTRAST, `${c}: ${onTab(c)}`)
		}
		assert.equal(tokens.FRAME_TAB_MIN_CONTRAST, 4.5)
	})

	test('AK1 a stronger tone: darker than a light fill, lighter than a dark one; Black gets white text; an old colour as its new tone', () => {
		const lum = (hex) => labOf(hex)[0]
		for (const c of tokens.LIGHT.filter((x) => x !== '#191b1d')) assert.ok(lum(tokens.frameTabFill(c)) < lum(c), c)
		assert.ok(lum(tokens.frameTabFill('#191b1d')) > lum('#191b1d'))
		assert.equal(tokens.frameTabText(tokens.frameTabFill('#191b1d')), '#ffffff')
		assert.equal(tokens.frameTabText(tokens.frameTabFill('#404040')), '#ffffff', 'a dark custom colour')
		// risk: mid grey, where neither text colour reaches 4.5 : 1 without moving the tone
		assert.ok(onTab('#767676') >= 4.5)
		assert.equal(tokens.frameTabFill('#fff6b6'), tokens.frameTabFill(tokens.shownColor('#fff6b6')), 'old yellow of 0.4.0 as the new Yellow')
	})

	test('AK1 no #rrggbb: the tone of White', () => {
		for (const v of [undefined, null, 'none', '', '#fff', 42, 'rgb(0,0,0)']) assert.equal(tokens.frameTabFill(v), '#d1d1ce', String(v))
		assert.equal(tokens.frameTabText('nope'), TEXT_COLOR)
	})

	test('AK2 FRAME_STROKE has at least 3 : 1 to every LIGHT tone and to BOARD_BACKGROUND', () => {
		for (const c of [...tokens.LIGHT, tokens.BOARD_BACKGROUND]) {
			assert.ok(ratio(tokens.FRAME_STROKE, c) >= 3, `${c}: ${ratio(tokens.FRAME_STROKE, c)}`)
		}
		assert.equal(tokens.contrastRatio(tokens.FRAME_STROKE, tokens.BOARD_BACKGROUND), ratio(tokens.FRAME_STROKE, tokens.BOARD_BACKGROUND))
	})

	test('frameTabWidth: text + 2 · 14, ending 24 left of the right edge, at least 12 (a narrower frame: its width)', () => {
		assert.deepEqual([tokens.FRAME_TAB_PAD, tokens.FRAME_TAB_INSET, tokens.FRAME_TAB_MIN_W, tokens.FRAME_RADIUS], [14, 24, 12, 8])
		assert.equal(tokens.frameTabWidth(55, 400), 83)
		assert.equal(tokens.frameTabWidth(1000, 400), 376)
		assert.equal(tokens.frameTabWidth(55, 20), 12)
		assert.equal(tokens.frameTabWidth(55, 8), 8)
		assert.equal(tokens.frameTabWidth(NaN, 400), 28)
		assert.equal(tokens.frameTabWidth(55, NaN), 0)
	})
})
