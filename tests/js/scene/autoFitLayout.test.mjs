/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The automatic font size of notes and shapes in the REAL Konva.Text layout
 * (konva 10.7.1, Text._setTextData; factory job 224): a 180 × 90 rectangle
 * drew "Check payment" at 32 as "Check…", because the estimate never looked
 * at the wrapped lines. Konva measures through getDummyContext(); a fake
 * document hands it a 2D context whose measureText answers from the font
 * model of labelLayout.test.mjs:
 * - exact: advance widths of LiberationSans-Regular.ttf (= Arial) for
 *   U+0020–U+00FF, Noto Color Emoji 1.2451 em, anything else 1.0571 em
 *   (the widest Cyrillic glyph, Љ); joiners and variation selectors 0
 * - hinted: the same advances rounded to whole px per glyph
 * The note and shape nodes at LOD 0 then must draw every text that fits at
 * a step above the smallest one uncut: no '…', every character kept, every
 * line within the width, the lines within the height.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { FONT_STEPS } from '../../../src/model/tokens.js'

/** LiberationSans-Regular.ttf advances (1/2048 em), U+0020–U+007E then U+00A0–U+00FF. */
const LIB_ASCII = [
	569, 569, 727, 1139, 1139, 1821, 1366, 391, 682, 682, 797, 1196, 569, 682, 569, 569,
	1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 569, 569, 1196, 1196, 1196, 1139,
	2079, 1366, 1366, 1479, 1479, 1366, 1251, 1593, 1479, 569, 1024, 1366, 1139, 1706, 1479, 1593,
	1366, 1593, 1479, 1366, 1251, 1479, 1366, 1933, 1366, 1366, 1251, 569, 569, 569, 961, 1139,
	682, 1139, 1139, 1024, 1139, 1139, 569, 1139, 1139, 455, 455, 1024, 455, 1706, 1139, 1139,
	1139, 1139, 682, 1024, 569, 1139, 1024, 1479, 1024, 1024, 1024, 684, 532, 684, 1196,
]
const LIB_LATIN1 = [
	569, 682, 1139, 1139, 1139, 1139, 532, 1139, 682, 1509, 758, 1139, 1196, 682, 1509, 1131,
	819, 1124, 682, 682, 682, 1180, 1100, 569, 682, 682, 748, 1139, 1708, 1708, 1708, 1251,
	1366, 1366, 1366, 1366, 1366, 1366, 2048, 1479, 1366, 1366, 1366, 1366, 569, 569, 569, 569,
	1479, 1479, 1593, 1593, 1593, 1593, 1593, 1196, 1593, 1479, 1479, 1479, 1479, 1366, 1366, 1251,
	1139, 1139, 1139, 1139, 1139, 1139, 1821, 1024, 1139, 1139, 1139, 1139, 569, 569, 569, 569,
	1139, 1139, 1139, 1139, 1139, 1139, 1139, 1124, 1251, 1139, 1139, 1139, 1139, 1024, 1139, 1024,
]

/** Font model in use: 'exact' or 'hinted'. */
let model = 'exact'

/**
 * @param {number} cp code point
 * @return {number} advance in em
 */
function advanceEm(cp) {
	if (cp >= 0x20 && cp <= 0x7e) return LIB_ASCII[cp - 0x20] / 2048
	if (cp >= 0xa0 && cp <= 0xff) return LIB_LATIN1[cp - 0xa0] / 2048
	if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
	if (cp >= 0x1f300 || (cp >= 0x2190 && cp <= 0x2bff)) return 2550 / 2048
	return 2165 / 2048
}

const ctx2d = {
	font: '10px sans-serif',
	fontKerning: 'auto',
	save() {},
	restore() {},
	clearRect() {},
	fillRect() {},
	// Konva's canvas farbling probe at import: an unmodified 10 × 10 read-back
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
	measureText(text) {
		const fs = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
		let w = 0
		for (const ch of text) {
			const px = advanceEm(ch.codePointAt(0)) * fs
			w += model === 'hinted' ? Math.round(px) : px
		}
		return { width: w, fontBoundingBoxAscent: 0.9 * fs, fontBoundingBoxDescent: 0.2 * fs }
	},
}

let ctx
let sticky
let shape

before(async () => {
	globalThis.document = { createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	const { Text } = await import('konva/lib/shapes/Text')
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	;({ sticky } = await import('../../../src/scene/nodes/sticky.js'))
	;({ shape } = await import('../../../src/scene/nodes/shape.js'))
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true }
})

const TEXTS = [
	'Check payment', 'Pack and ship', 'Receive order', 'Hallo Welt', 'WICHTIG', 'WICHTIG WICHTIG WICHTIG',
	'MMMM WWWW', 'Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung', 'ÄÖÜ äöü ß Straße',
	'Grüße aus Köln 👍🎉', 'eins\nzwei\ndrei', 'self-service check-in', 'Привет, мир',
	'what went well improve keep stop start more less maybe because users need faster simpler clearer',
	'Ein sehr langer Satz mit vielen kurzen Wörtern, der über mehrere Zeilen geht',
]

/**
 * @param {string} text data.text
 * @param {number} w width
 * @param {number} h height
 * @param {object} [style] style fields
 * @return {object} note WireItem
 */
const note = (text, w, h, style = {}) => ({ id: 'N', t: 'sticky', x: 0, y: 0, w, h, r: 0, data: { text }, style: { fill: '#fff59d', ...style } })

/**
 * @param {string} text data.text
 * @param {number} w width
 * @param {number} h height
 * @param {object} [style] style fields
 * @return {object} rectangle WireItem
 */
const rect = (text, w, h, style = {}) => ({ id: 'S', t: 'shape', x: 0, y: 0, w, h, r: 0, data: { kind: 'rect', text }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2, ...style } })

/**
 * @param {object} kind sticky or shape node module
 * @param {object} it WireItem
 * @return {object} the Konva.Text of its node at LOD 0
 */
function textOf(kind, it) {
	return kind.build(ctx, it, { x: it.x, y: it.y, w: it.w, h: it.h, r: it.r }, 0).parts.text
}

/** @param {string} s @return {string} the characters without whitespace */
const ink = (s) => s.replace(/\s+/g, '')

/**
 * Konva drew the whole text: no '…', every character, every line within the
 * width, the lines within the height.
 *
 * @param {object} t Konva.Text
 * @param {string} text the item's text
 * @param {string} at message prefix
 */
function assertWhole(t, text, at) {
	const rows = t.textArr.map((r) => r.text)
	assert.ok(rows.every((r) => !r.includes('…')), `${at}: ${JSON.stringify(rows)}`)
	assert.equal(ink(rows.join('')), ink(text), `${at}: ${JSON.stringify(rows)}`)
	assert.ok(t.textArr.every((r) => r.width <= t.width() + 1e-9), `${at}: a line wider than ${t.width()}`)
	assert.ok(rows.length * t.fontSize() * t.lineHeight() <= t.height() + 1e-9, `${at}: ${rows.length} lines in ${t.height()}`)
}

describe('automatic font size in the real Konva.Text layout (job 224)', () => {
	test('the harness reproduces the defect: at the old 32, Konva cuts "Check payment" in a 180 × 90 rectangle', () => {
		model = 'exact'
		const t = textOf(shape, rect('Check payment', 180, 90, { fontSize: 32 }))
		assert.equal(t.textArr.length, 1)
		assert.match(t.textArr[0].text, /…$/)
	})

	for (const m of ['exact', 'hinted']) {
		test(`AK4, ${m} advances: a 180 × 90 rectangle draws "Check payment" and "Pack and ship" whole at 24 (job 260: padding 12; was 28 with 8)`, () => {
			model = m
			for (const text of ['Check payment', 'Pack and ship']) {
				const t = textOf(shape, rect(text, 180, 90))
				assert.equal(t.fontSize(), 24, text)
				assertWhole(t, text, text)
				assert.ok(t.textArr.length <= 2, text)
			}
		})

		test(`AK4, ${m} advances: notes and rectangles draw every text whole above the smallest step`, () => {
			model = m
			const boxes = [[note, sticky, 200, 200], [note, sticky, 100, 100], [note, sticky, 200, 100], [rect, shape, 180, 90], [rect, shape, 120, 60], [rect, shape, 60, 200]]
			let checked = 0
			for (const text of TEXTS) {
				for (const [make, kind, w, h] of boxes) {
					const t = textOf(kind, make(text, w, h))
					if (t.fontSize() === FONT_STEPS[0]) continue
					// job 227: a note from S down may split a word with a hyphen; it draws its layout's text whole
					assertWhole(t, kind === sticky ? t.text() : text, `${JSON.stringify(text)} in ${w} × ${h} at ${t.fontSize()}`)
					if (kind === sticky) assert.equal(ink(t.text()).replace(/-/g, ''), ink(text).replace(/-/g, ''), text)
					checked++
				}
			}
			assert.ok(checked > 60, `${checked} layouts checked`)
		})
	}

	test('AK5: a text that does not fit even at 10 ends with "…" as before', () => {
		model = 'exact'
		const text = 'Wort '.repeat(400).trim()
		const t = textOf(sticky, note(text, 100, 100))
		assert.equal(t.fontSize(), FONT_STEPS[0])
		assert.match(t.textArr.at(-1).text, /…$/)
	})

	test('AK6: a stored size stays for shapes, the node cuts the text then; (job 227) a note gets smaller instead', () => {
		model = 'exact'
		const long = 'Ein sehr langer Satz mit vielen kurzen Wörtern, der über mehrere Zeilen geht'
		const s = textOf(shape, rect(long, 180, 90, { fontSize: 40 }))
		assert.equal(s.fontSize(), 40)
		assert.match(s.textArr.at(-1).text, /…$/)
		const n = textOf(sticky, note(long, 100, 100, { fontSize: 40 }))
		assert.ok(n.fontSize() < 40, String(n.fontSize()))
	})
})

describe('job 227: note text sizes and the hyphen in the real Konva.Text layout', () => {
	for (const m of ['exact', 'hinted']) {
		test(`AK9 ${m} advances: a word too long for one line at S is split with "-" where the line is full; Konva wraps nothing further`, () => {
			model = m
			for (const [text, style] of [['Donaudampfschifffahrtsgesellschaftskapitän', { fontSize: 22 }], ['Donaudampfschifffahrtsgesellschaftskapitän', {}], ['WWWWWWWWWWWWWWWWWWWW', { fontSize: 16 }]]) {
				const t = textOf(sticky, note(text, 200, 200, style))
				const rows = t.textArr.map((r) => r.text)
				const at = `${text} ${JSON.stringify(style)}: ${JSON.stringify(rows)}`
				assert.equal(t.fontSize(), 16, at)
				assert.ok(rows.length >= 2 && rows.slice(0, -1).every((r) => r.endsWith('-')), at)
				assert.equal(rows.length, t.text().split('\n').length, 'Konva keeps the lines of the layout: ' + at)
				assert.equal(rows.join('').replace(/-/g, ''), text, at)
				assertWhole(t, t.text(), at)
			}
		})

		test(`AK9 ${m} advances: "Monatliche Kundeninterviews" at M gets smaller, but not below S, and stays unsplit`, () => {
			model = m
			const t = textOf(sticky, note('Monatliche Kundeninterviews', 200, 200, { fontSize: 22 }))
			assert.ok(t.fontSize() >= 16 && t.fontSize() <= 22, String(t.fontSize()))
			assert.equal(t.text(), 'Monatliche Kundeninterviews')
			assertWhole(t, 'Monatliche Kundeninterviews', 'Monatliche Kundeninterviews')
		})
	}
})
