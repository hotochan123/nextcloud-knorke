/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Connector labels in the REAL Konva.Text layout (konva 10.7.1,
 * Text._setTextData) – review finding S-1b-01: the old estimate (0.6 em per
 * glyph) gave a box narrower than the drawn text, and Konva, laid out in that
 * box with a fixed height and an ellipsis, drew 'O…' for 'OK' or nothing for
 * an emoji. Konva measures through getDummyContext(); a fake document hands it
 * a 2D context whose measureText answers from font models:
 * - exact: advance widths of LiberationSans-Regular.ttf (= Arial) for
 *   U+0020–U+00FF (read from the font file of the lab image
 *   mcr.microsoft.com/playwright:v1.49.1-jammy, hmtx/cmap), Noto Color Emoji
 *   1.2451 em, CJK (WenQuanYi Zen Hei) 1.0 em, anything else 1.0571 em (the
 *   widest Cyrillic glyph of Liberation Sans, Љ); joiners, variation
 *   selectors and skin tone modifiers after a base 0
 * - hinted: the same advances rounded to whole px per glyph
 * - wide: emoji 1.5 em (wider than any estimate: the safety net)
 * The connector node then must show every label uncut: no '…', every
 * character kept, at most labelBox().lines lines (exactly as many for the
 * one-line labels of the finding), every line within the box.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { labelBox, routeConnector } from '../../../src/model/connectors.js'
import { CONNECTOR_LABEL_PAD, LINE_HEIGHT } from '../../../src/model/tokens.js'

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

/**
 * @param {number} cp code point
 * @param {number} emoji emoji advance in em
 * @return {number} advance in em
 */
function advanceEm(cp, emoji) {
	if (cp >= 0x20 && cp <= 0x7e) return LIB_ASCII[cp - 0x20] / 2048
	if (cp >= 0xa0 && cp <= 0xff) return LIB_LATIN1[cp - 0xa0] / 2048
	if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
	if (cp >= 0x1f300 || (cp >= 0x2190 && cp <= 0x2bff)) return emoji
	if ((cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xff00 && cp <= 0xff60)) return 1
	return 2165 / 2048
}

/** Font model in use: 'exact', 'hinted' or 'wide'. */
let model = 'exact'

/**
 * measureText of the fake context: sum of the model's advances; a skin
 * tone modifier after another code point and a second regional indicator
 * of a pair add nothing (one glyph).
 *
 * @param {string} text text
 * @param {string} font CSS font of the context
 * @return {number} width in px
 */
function measure(text, font) {
	const fs = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)
	const emoji = model === 'wide' ? 1.5 : 2550 / 2048
	let w = 0
	let prev = 0
	let riOpen = false
	for (const ch of text) {
		const cp = ch.codePointAt(0)
		let em = advanceEm(cp, emoji)
		if (prev && cp >= 0x1f3fb && cp <= 0x1f3ff) em = 0
		if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
			if (riOpen) em = 0
			riOpen = !riOpen
		} else {
			riOpen = false
		}
		const px = em * fs
		w += model === 'hinted' ? Math.round(px) : px
		prev = cp
	}
	return w
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
		return { width: measure(text, this.font), fontBoundingBoxAscent: 14.5, fontBoundingBoxDescent: 3.4 }
	},
}

let connector
let ctx
let Text

before(async () => {
	globalThis.document = { createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	Text = (await import('konva/lib/shapes/Text')).Text
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	connector = (await import('../../../src/scene/nodes/connector.js')).connector
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true }
})

const U = '01JA0000000000000000000001'
const V = '01JA0000000000000000000002'
const A = { x: 0, y: 0, w: 200, h: 200, r: 0 }
const B = { x: 600, y: 0, w: 200, h: 200, r: 0 }

/**
 * @param {string} label data.label
 * @return {{item:object, route:object}}
 */
function labelled(label) {
	const item = { id: 'C', t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, data: { start: { item: U }, end: { item: V }, route: 'straight', label }, style: {} }
	const geom = routeConnector({ box: A, ep: { item: U } }, { box: B, ep: { item: V } }, 'straight')
	return { item, route: { geom, label: labelBox(label, geom.labelAt) } }
}

/** @param {string} s @return {number} characters without whitespace */
const ink = (s) => s.replace(/\s+/g, '').length

/**
 * Builds the connector node at LOD 0 and reads its label layout.
 *
 * @param {string} label label
 * @return {{box:object, t:object, rows:Array<{text:string, width:number}>}}
 */
function layout(label) {
	const { item, route } = labelled(label)
	const e = connector.build(ctx, item, route, 0)
	const t = e.parts.text
	return { box: route.label, t, e, item, rows: t.textArr.map((r) => ({ text: r.text, width: r.width })) }
}

const FINDING = ['OK', 'TODO', 'WICHTIG', '👍', '会议记录']
const MORE = [
	'ja', 'Hub', 'ÄÖÜ äöü ß', 'Привет, мир', 'Ω Σ ω',
	'Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung',
	'x'.repeat(60), 'W'.repeat(40), 'a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z',
	'  vorne und hinten  ', 'zwei\nZeilen', 'eins\n\ndrei',
	'会议记录'.repeat(8), '👍'.repeat(20), 'mixed 会议 👍 WWW',
	// ❤ + VS16, ✅, 👍 + skin tone, flag DE, family (ZWJ sequence)
	[[0x2764, 0xfe0f], [0x2705], [0x1f44d, 0x1f3fd], [0x1f1e9, 0x1f1ea], [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]]
		.map((cps) => String.fromCodePoint(...cps)).join(' '),
	'Ein sehr langer Satz mit vielen kurzen Wörtern, der über mehrere Zeilen geht und am Ende noch ein Emoji trägt 🎉',
]

describe('connector label in the real Konva.Text layout (finding S-1b-01)', () => {
	test('the harness reproduces the defect: the OLD box (0.6 em, fixed height, ellipsis) cuts "OK" and drops "👍"', () => {
		model = 'exact'
		const old = (text) => {
			const w = [...text].length * 9.6
			const t = new Text({ text, width: w, height: 19.2, fontSize: 16, lineHeight: 1.2, wrap: 'word', ellipsis: true, align: 'center' })
			return t.textArr.map((r) => r.text).join('|')
		}
		assert.notEqual(old('OK'), 'OK')
		assert.notEqual(old('👍'), '👍')
	})

	for (const m of ['exact', 'hinted']) {
		test(`${m} advances: the labels of the finding stay whole on exactly box.lines line(s)`, () => {
			model = m
			for (const label of FINDING) {
				const { box, t, rows } = layout(label)
				const W = box.w - 2 * CONNECTOR_LABEL_PAD
				assert.deepEqual(rows.map((r) => r.text), [label], `${label}: ${JSON.stringify(rows)}`)
				assert.equal(rows.length, box.lines)
				assert.ok(rows.every((r) => r.width <= W && !r.text.includes('…')), label)
				assert.equal(t.getAttr('ellipsis'), false)
				assert.equal(t.attrs.height, undefined, 'automatic height')
				assert.equal(t.width(), W, 'laid out at the box width')
				// centred: as many lines as estimated → the old top-left (box + pad)
				assert.equal(t.x(), box.x + CONNECTOR_LABEL_PAD)
				assert.ok(Math.abs(t.y() - (box.y + CONNECTOR_LABEL_PAD)) < 1e-9, `${label}: y ${t.y()}`)
			}
		})

		test(`${m} advances: longer, wrapped, multi-line, Cyrillic, CJK and emoji labels: nothing cut, ≤ box.lines, inside the box`, () => {
			model = m
			for (const label of MORE) {
				const { box, t, rows } = layout(label)
				const W = box.w - 2 * CONNECTOR_LABEL_PAD
				assert.ok(rows.length >= 1 && rows.length <= box.lines, `${JSON.stringify(label)}: ${rows.length} rows, box ${box.lines}`)
				assert.ok(rows.every((r) => r.width <= W + 1e-9 && !r.text.includes('…')), `${JSON.stringify(label)}: ${JSON.stringify(rows)}`)
				assert.equal(ink(rows.map((r) => r.text).join('')), ink(label), `${JSON.stringify(label)}: every character kept`)
				assert.equal(t.width(), W)
				assert.ok(t.height() <= box.h - 2 * CONNECTOR_LABEL_PAD + 1e-9)
				// centred vertically in the box also when Konva needs fewer lines than estimated
				assert.ok(Math.abs(t.y() + t.height() / 2 - (box.y + box.h / 2)) < 1e-9, `${JSON.stringify(label)}: centred`)
			}
		})
	}

	test('estimate vs layout: with exact advances the wrapped lines are the estimated ones', () => {
		model = 'exact'
		for (const label of ['Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung', 'x'.repeat(60), 'zwei\nZeilen']) {
			const { box, rows } = layout(label)
			assert.equal(rows.length, box.lines, label)
		}
	})

	test('safety net: a glyph wider than any estimate (emoji 1.5 em) is not dropped: natural width, centred', () => {
		model = 'wide'
		const { box, t, rows } = layout('👍')
		assert.deepEqual(rows.map((r) => r.text), ['👍'])
		assert.equal(t.attrs.width, undefined, 'falls back to the natural width')
		assert.equal(t.width(), 24)
		assert.equal(t.x(), box.x + (box.w - 24) / 2)
		assert.ok(Math.abs(t.y() - (box.y + (box.h - 16 * LINE_HEIGHT) / 2)) < 1e-9)
		// a line too narrow for two wide emoji wraps instead (no cut, overflows the box evenly)
		const two = layout('👍👍')
		assert.deepEqual(two.rows.map((r) => r.text), ['👍', '👍'])
		assert.ok(Math.abs(two.t.y() + two.t.height() / 2 - (two.box.y + two.box.h / 2)) < 1e-9)
		model = 'exact'
	})

	test('place(): a new label and a moved route re-lay the text and keep it centred; the box width is restored', () => {
		model = 'wide'
		const { e, item } = layout('👍')
		model = 'exact'
		const next = labelled('WICHTIG')
		connector.place(ctx, e, { ...item, data: { ...item.data, label: 'WICHTIG' } }, next.route)
		const t = e.parts.text
		assert.deepEqual(t.textArr.map((r) => r.text), ['WICHTIG'])
		assert.equal(t.width(), next.route.label.w - 2 * CONNECTOR_LABEL_PAD, 'fixed width again')
		assert.equal(t.x(), next.route.label.x + CONNECTOR_LABEL_PAD)
	})
})
