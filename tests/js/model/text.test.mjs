/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/text.js: autoFontSize is deterministic, matches the spike for
 * single-line texts (golden values from knorke-spike/engine/src/scene.js) and
 * also respects explicit line breaks; noteFontSize honours a valid override.
 * Connector labels (finding S-1b-01): labelGlyphWidth is a whole-px upper
 * bound per code point, wrapLabel breaks lines like Konva.Text (the real
 * Konva layout against it: tests/js/scene/labelLayout.test.mjs).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { autoFontSize, labelGlyphWidth, noteFontSize, wrapLabel } from '../../../src/model/text.js'
import { FONT_STEPS, STICKY_PADDING } from '../../../src/model/tokens.js'

const SPIKE_CASES = [
	['Hallo Welt', 200, 200, 56],
	['', 200, 200, 64],
	['Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung', 200, 200, 14],
	['what went well improve keep stop start more less maybe because users need faster simpler clearer', 300, 200, 24],
	['a b c d e f g h i j k l m n o p q r s t u v w x y z', 200, 200, 24],
]

describe('autoFontSize', () => {
	test('same results as the spike for single-line texts', () => {
		for (const [text, w, h, want] of SPIKE_CASES) {
			assert.equal(autoFontSize(text, w, h), want, text)
		}
	})

	test('deterministic and always a FONT_STEPS value', () => {
		const texts = ['x', 'Ein etwas längerer Text mit mehreren Wörtern', 'z'.repeat(500), 'a\nb\nc', '😀😀😀']
		for (const text of texts) {
			for (const [w, h] of [[200, 200], [300, 200], [20, 20], [2000, 2000]]) {
				const a = autoFontSize(text, w, h)
				assert.equal(autoFontSize(text, w, h), a)
				assert.ok(FONT_STEPS.includes(a), `${a} for ${text}`)
			}
		}
	})

	test('more text never gets a larger font', () => {
		let last = Infinity
		for (let n = 1; n <= 60; n++) {
			const fs = autoFontSize('wort '.repeat(n).trim(), 200, 200)
			assert.ok(fs <= last, `n=${n}`)
			last = fs
		}
	})

	test('explicit line breaks count as lines (port extension)', () => {
		const one = autoFontSize('a b c d e f g h', 200, 200)
		const lines = autoFontSize('a\nb\nc\nd\ne\nf\ng\nh', 200, 200)
		assert.ok(lines < one, `${lines} < ${one}`)
		// 8 lines at 1.2 line height must fit into 200 - 2 × padding
		assert.ok(lines * 8 * 1.2 <= 200 - 2 * STICKY_PADDING)
	})

	test('non-string text counts as empty', () => {
		assert.equal(autoFontSize(null, 200, 200), autoFontSize('', 200, 200))
		assert.equal(autoFontSize(42, 200, 200), autoFontSize('', 200, 200))
	})
})

describe('noteFontSize', () => {
	test('manual override wins only when it is an integer 8–200', () => {
		const item = { w: 200, h: 200, data: { text: 'Hallo Welt' }, style: {} }
		assert.equal(noteFontSize(item), 56)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 12 } }), 12)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 7 } }), 56)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 201 } }), 56)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 12.5 } }), 56)
		assert.equal(noteFontSize({ ...item, style: { fontSize: '12' } }), 56)
	})
})

describe('labelGlyphWidth and wrapLabel (connector labels, finding S-1b-01)', () => {
	const cp = (s) => s.codePointAt(0)
	const W = (s) => labelGlyphWidth(cp(s), 16)

	test('Latin-1: Liberation Sans (= Arial) advances rounded UP to whole px at 16', () => {
		// 'O' 1593/2048 em = 12.45 px, 'K' 10.67, ' ' 4.45, 'W' 15.10, 'i' 3.55, 'é' 8.90, 'Æ' 16 exactly
		assert.deepEqual(['O', 'K', ' ', 'W', 'i', 'é', 'Æ', 'ÿ', String.fromCodePoint(0xa0)].map(W), [13, 11, 5, 16, 4, 9, 16, 8, 5])
		// every printable Latin-1 glyph: at least its advance, at most one px more
		for (let c = 0x20; c <= 0xff; c++) {
			if (c > 0x7e && c < 0xa0) continue
			const w = labelGlyphWidth(c, 16)
			assert.ok(Number.isInteger(w) && w >= 3 && w <= 17, `U+${c.toString(16)}: ${w}`)
		}
	})

	test('other code points 1.1 em, wide ones (CJK, Hangul, fullwidth, BMP symbols/emoji, astral) 1.3 em', () => {
		assert.deepEqual(['Љ', 'Ж', 'Ω', '€', '…', 'ẞ', String.fromCodePoint(0xfe0f), String.fromCodePoint(0x200d)].map(W), [18, 18, 18, 18, 18, 18, 18, 18])
		assert.deepEqual(['会', 'あ', '한', 'Ａ', String.fromCodePoint(0x3000), '✅', '⭐', '⌚', '☀', '→'].map(W), [21, 21, 21, 21, 21, 21, 21, 21, 21, 21])
		assert.deepEqual([0x1f44d, 0x1f600, 0x1f1e9, 0x20000].map((c) => labelGlyphWidth(c, 16)), [21, 21, 21, 21])
		assert.equal(labelGlyphWidth(cp('O'), 32), Math.ceil(1593 * 32 / 2048), 'scales with the font size')
	})

	test('wrapLabel: a paragraph that fits stays whole and untrimmed; \n splits paragraphs', () => {
		assert.deepEqual(wrapLabel('OK', 232, 16), [{ text: 'OK', width: 24 }])
		assert.deepEqual(wrapLabel('  a ', 232, 16), [{ text: '  a ', width: 5 + 5 + 9 + 5 }])
		assert.deepEqual(wrapLabel('a\n\nb', 232, 16).map((r) => r.text), ['a', '', 'b'])
		assert.deepEqual(wrapLabel('', 232, 16), [{ text: '', width: 0 }])
	})

	test('wrapLabel: Konva rules: back to the last space or dash, trailing whitespace trimmed, next line after the whitespace', () => {
		// a = 9, space = 5, '-' = 6
		assert.deepEqual(wrapLabel('aaa aaa', 40, 16), [{ text: 'aaa', width: 27 }, { text: 'aaa', width: 27 }])
		assert.deepEqual(wrapLabel('aaa-aaa', 40, 16), [{ text: 'aaa-', width: 33 }, { text: 'aaa', width: 27 }])
		assert.deepEqual(wrapLabel('aaa     aaa', 40, 16).map((r) => r.text), ['aaa', 'aaa'])
		// a word wider than the line breaks between graphemes
		assert.deepEqual(wrapLabel('aaaaaaaaaa', 40, 16).map((r) => r.text), ['aaaa', 'aaaa', 'aa'])
		// a grapheme (emoji with skin tone, flag) is never split
		const thumbs = String.fromCodePoint(0x1f44d, 0x1f3fd)
		const flag = String.fromCodePoint(0x1f1e9, 0x1f1ea)
		assert.deepEqual(wrapLabel(thumbs.repeat(3), 50, 16).map((r) => r.text), [thumbs, thumbs, thumbs])
		assert.deepEqual(wrapLabel(flag + flag, 50, 16).map((r) => r.text), [flag, flag])
		// deterministic
		const t = 'Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung'
		assert.deepEqual(wrapLabel(t, 232, 16), wrapLabel(t, 232, 16))
		assert.deepEqual(wrapLabel(t, 232, 16).map((r) => r.text), ['Kundenzufriedenheit', 'Barrierefreiheit', 'Datenschutzerklärung'])
		assert.ok(wrapLabel(t, 232, 16).every((r) => r.width <= 232))
	})
})
