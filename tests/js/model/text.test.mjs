/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/text.js: autoFontSize is deterministic, matches the spike for
 * single-line texts (golden values from knorke-spike/engine/src/scene.js) and
 * also respects explicit line breaks; noteFontSize honours a valid override.
 * Job 224: the size steps down until the wrapped lines fit (the real Konva
 * layout against it: tests/js/scene/autoFitLayout.test.mjs).
 * Connector labels (finding S-1b-01): labelGlyphWidth is a whole-px upper
 * bound per code point, wrapLabel breaks lines like Konva.Text (the real
 * Konva layout against it: tests/js/scene/labelLayout.test.mjs).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { autoFontSize, labelGlyphWidth, noteFontSize, noteTextLayout, wrapLabel } from '../../../src/model/text.js'
import { FONT_STEPS, LINE_HEIGHT, SHAPE_TEXT_PADDING, STICKY_PADDING } from '../../../src/model/tokens.js'
import { shapeTextBox } from '../../../src/scene/nodes/shape.js'

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
			// the spike's padding 12 (job 227: notes have 16 now)
			assert.equal(autoFontSize(text, w, h, 12), want, text)
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
		// job 227: padding 16, so 48 where the spike had 56
		assert.equal(noteFontSize(item), 48)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 12 } }), 12)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 7 } }), 48)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 201 } }), 48)
		assert.equal(noteFontSize({ ...item, style: { fontSize: 12.5 } }), 48)
		assert.equal(noteFontSize({ ...item, style: { fontSize: '12' } }), 48)
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

describe('autoFontSize: the wrapped lines fit (job 224)', () => {
	const TEXTS = [
		'Check payment', 'Pack and ship', 'Receive order', 'Hallo Welt', '', 'x', 'WICHTIG',
		'WICHTIG WICHTIG WICHTIG', 'MMMM WWWW', 'Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung',
		'Donaudampfschifffahrtsgesellschaftskapitän', 'ÄÖÜ äöü ß Straße', 'Grüße aus Köln 👍🎉',
		'eins\nzwei\ndrei', 'a\n\nb', 'self-service check-in', 'Привет, мир',
		'what went well improve keep stop start more less maybe because users need faster simpler clearer',
		'Ein sehr langer Satz mit vielen kurzen Wörtern, der über mehrere Zeilen geht',
	]
	// note boxes with STICKY_PADDING, shape boxes with SHAPE_TEXT_PADDING (rect: text box = box)
	const BOXES = [[200, 200, STICKY_PADDING], [100, 100, STICKY_PADDING], [180, 90, SHAPE_TEXT_PADDING], [120, 60, SHAPE_TEXT_PADDING], [60, 200, SHAPE_TEXT_PADDING]]

	/** The estimate before job 224 (snapped down to a step), the upper limit. */
	function oldEstimate(s, w, h, pad) {
		const aw = Math.max(10, w - 2 * pad)
		const ah = Math.max(10, h - 2 * pad)
		let longest = 1
		for (const word of s.split(/\s+/)) longest = Math.max(longest, word.length)
		let fs = Math.sqrt((aw * ah) / (Math.max(1, s.length) * 0.55 * LINE_HEIGHT * 1.3))
		fs = Math.min(fs, aw / (longest * 0.62), ah / (s.split('\n').length * LINE_HEIGHT))
		return FONT_STEPS.filter((x) => x <= fs).at(-1) ?? FONT_STEPS[0]
	}

	/** Pieces Konva may wrap between: words, split after a dash, and (job 227: Konva wraps before a dash that does not fit) before it. */
	const pieces = (s) => s.split(/\s+/).flatMap((t) => t.split(/(?<=-)|(?=-)/)).filter(Boolean)

	test('AK1: a 180 × 90 rectangle draws "Check payment" and "Pack and ship" at 28 (was 32: two lines of 38.4 in 74)', () => {
		for (const text of ['Check payment', 'Pack and ship']) {
			assert.equal(oldEstimate(text, 180, 90, SHAPE_TEXT_PADDING), 32, 'the defect')
			assert.equal(autoFontSize(text, 180, 90, SHAPE_TEXT_PADDING), 28, text)
			const rect = { id: 'S', t: 'shape', x: 0, y: 0, w: 180, h: 90, r: 0, data: { kind: 'rect', text }, style: {} }
			// job 260: a rectangle has the padding 12 since design round 3
			assert.equal(shapeTextBox(rect, { w: 180, h: 90 }).fontSize, autoFontSize(text, 180, 90, 12), `${text}: shape text box`)
		}
	})

	test('AK2: above the smallest step, the lines fit the height and no word is cut', () => {
		for (const text of TEXTS) {
			for (const [w, h, pad] of BOXES) {
				const fs = autoFontSize(text, w, h, pad)
				if (fs === FONT_STEPS[0]) continue
				const aw = w - 2 * pad
				const rows = wrapLabel(text, aw, fs)
				const at = `${JSON.stringify(text)} in ${w} × ${h} at ${fs}`
				assert.ok(rows.length * fs * LINE_HEIGHT <= h - 2 * pad, `${at}: ${rows.length} lines`)
				assert.ok(rows.every((r) => r.width <= aw), `${at}: a line wider than ${aw}`)
				const whole = new Set(pieces(text))
				for (const r of rows) {
					for (const p of pieces(r.text)) assert.ok(whole.has(p), `${at}: "${p}" is a cut word`)
				}
			}
		}
	})

	test('AK3: never larger than the old estimate, always a step, more text never larger', () => {
		for (const text of TEXTS) {
			for (const [w, h, pad] of BOXES) {
				const fs = autoFontSize(text, w, h, pad)
				assert.ok(FONT_STEPS.includes(fs), `${fs}`)
				assert.ok(fs <= oldEstimate(text, w, h, pad), `${JSON.stringify(text)} in ${w} × ${h}`)
			}
		}
		for (const [w, h, pad] of BOXES) {
			let last = Infinity
			for (let n = 1; n <= 40; n++) {
				const fs = autoFontSize('Wort '.repeat(n).trim(), w, h, pad)
				assert.ok(fs <= last, `n=${n} in ${w} × ${h}`)
				last = fs
			}
		}
	})

	test('AK5: a text that does not fit even at 10 gets 10 (Konva cuts it with "…")', () => {
		const text = 'Wort '.repeat(400).trim()
		assert.equal(autoFontSize(text, 100, 100), FONT_STEPS[0])
		assert.ok(wrapLabel(text, 100 - 2 * STICKY_PADDING, 10).length * 10 * LINE_HEIGHT > 100 - 2 * STICKY_PADDING)
		// a word wider than the box at 10 as well: 10, Konva breaks it as before
		assert.equal(autoFontSize('W'.repeat(40), 100, 100), FONT_STEPS[0])
	})

	test('AK6: a valid stored size stays for shapes, even when the text is cut then; (job 227) a note gets smaller instead', () => {
		const long = 'Ein sehr langer Satz mit vielen kurzen Wörtern, der über mehrere Zeilen geht'
		assert.ok(noteFontSize({ w: 100, h: 100, data: { text: long }, style: { fontSize: 40 } }) < 40)
		const rect = { id: 'S', t: 'shape', x: 0, y: 0, w: 180, h: 90, r: 0, data: { kind: 'rect', text: long }, style: { fontSize: 40 } }
		assert.equal(shapeTextBox(rect, { w: 180, h: 90 }).fontSize, 40)
	})

	test('AK7: the editor path (text passed in) gets the same size as the node', () => {
		const rect = { id: 'S', t: 'shape', x: 0, y: 0, w: 180, h: 90, r: 0, data: { kind: 'rect', text: '' }, style: {} }
		assert.equal(shapeTextBox(rect, { w: 180, h: 90 }, 'Check payment').fontSize, shapeTextBox({ ...rect, data: { kind: 'rect', text: 'Check payment' } }, { w: 180, h: 90 }).fontSize)
		const note = { w: 200, h: 100, data: { text: 'Pack and ship' }, style: {} }
		assert.equal(noteFontSize({ ...note, data: { text: 'Pack and ship' } }), noteFontSize(note))
		assert.equal(noteFontSize(note), autoFontSize('Pack and ship', 200, 100))
	})

	test('risk: a 500-character word in 20 × 20 and 2000 notes of 80 characters stay quick', () => {
		assert.equal(autoFontSize('z'.repeat(500), 20, 20), FONT_STEPS[0])
		const words = ['Idee', 'Kunde', 'Prozess', 'verbessern', 'schneller', 'Team', 'Feedback', 'Workshop']
		const t0 = performance.now()
		for (let i = 0; i < 2000; i++) {
			let s = ''
			for (let k = i; s.length < 80; k += 3) s += words[k % words.length] + ' '
			autoFontSize(s.trim(), 200, 200)
		}
		assert.ok(performance.now() - t0 < 2000, 'far below a millisecond per note')
	})
})

describe('job 227 AK9: noteTextLayout (S 16, M 22, L 32; a long word at most down to S, then split with "-")', () => {
	const note = (text, fontSize, w = 200, h = 200) => ({ w, h, data: { text }, style: fontSize === undefined ? {} : { fontSize } })
	const aw = (w) => w - 2 * STICKY_PADDING
	/** the drawn lines without the hyphens the layout added (the trailing "-" of a line that ends inside a word) */
	const unsplit = (r) => r.text.split('\n').map((l, i, all) => (i < all.length - 1 && r.text !== '' && l.endsWith('-') ? l.slice(0, -1) : l)).join('')

	test('(a) "Monatliche Kundeninterviews" at M: at least S, no hyphen, the text as it is', () => {
		const r = noteTextLayout(note('Monatliche Kundeninterviews', 22))
		assert.ok(r.fontSize >= 16 && r.fontSize <= 22, String(r.fontSize))
		assert.equal(r.text, 'Monatliche Kundeninterviews')
	})

	test('(b) a word that does not fit at S: 16, split where the line is full, every line within the width; without the hyphens the lines give the text', () => {
		for (const fs of [22, 32, undefined]) {
			const word = 'Donaudampfschifffahrtsgesellschaftskapitän'
			const r = noteTextLayout(note(word, fs))
			const lines = r.text.split('\n')
			assert.equal(r.fontSize, 16, String(fs))
			assert.ok(lines.length >= 2 && lines.slice(0, -1).every((l) => l.endsWith('-')), JSON.stringify(lines))
			assert.ok(lines.every((l) => wrapLabel(l, aw(200), 16).length === 1), 'every line fits: ' + JSON.stringify(lines))
			assert.equal(lines.map((l, i) => (i < lines.length - 1 ? l.slice(0, -1) : l)).join(''), word)
		}
	})

	test('(c) much text at M gets smaller than 22, never larger than the chosen size; S and L stay when the text fits', () => {
		const long = 'Ein sehr langer Satz mit vielen kurzen Wörtern, der über mehrere Zeilen geht und noch weiter und weiter'
		const r = noteTextLayout(note(long, 22))
		assert.ok(r.fontSize < 22 && FONT_STEPS.includes(r.fontSize), String(r.fontSize))
		for (const fs of [16, 22, 32]) assert.equal(noteTextLayout(note('Hi', fs)).fontSize, fs)
		for (const text of ['Hi', 'Hallo Welt', long, 'a b c']) {
			for (const fs of [16, 22, 32]) assert.ok(noteTextLayout(note(text, fs)).fontSize <= fs, `${text} at ${fs}`)
		}
	})

	test('(d) "Auto" without long words is at most the size autoFontSize gives and at most one step below (job 259: notes 1.25 line height, autoFontSize 1.2), for a table of texts and boxes (a long word: its estimate aw / (letters · 0.62) is below S)', () => {
		let checked = 0
		const texts = ['', 'Hi', 'Hallo Welt', 'Check payment', 'eins\nzwei\ndrei', 'a b c d e f g h i j k l m n o p', 'what went well improve keep stop start more less maybe because users need faster simpler clearer', 'Grüße aus Köln 👍🎉']
		for (const text of texts) {
			for (const [w, h] of [[200, 200], [100, 100], [300, 150], [400, 400]]) {
				const longest = Math.max(1, ...text.split(/\s+/).map((x) => x.length))
				if (aw(w) / (longest * 0.62) < 16) continue
				const fs = noteTextLayout(note(text, undefined, w, h)).fontSize
				const auto = autoFontSize(text, w, h)
				const below = [...FONT_STEPS].reverse().find((f) => f < auto) ?? auto
				assert.ok(fs <= auto && fs >= below, `${JSON.stringify(text)} in ${w} × ${h}: ${fs} vs ${auto}`)
				checked++
			}
		}
		assert.ok(checked >= 25, String(checked))
		// "Check payment" in 100 × 100: "payment" counts as long there, so Auto stops at S instead of 14
		assert.equal(noteTextLayout(note('Check payment', undefined, 100, 100)).fontSize, 16)
		assert.equal(autoFontSize('Check payment', 100, 100), 14)
	})

	test('(e) a break at "-" or a space gets no extra hyphen', () => {
		for (const text of ['self-service check-in desk opening', 'Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung']) {
			const r = noteTextLayout(note(text, 22))
			assert.equal(unsplit(r).replace(/\s/g, ''), text.replace(/\s/g, ''), JSON.stringify(r))
			assert.ok(!r.text.includes('--'), r.text)
		}
		const dash = noteTextLayout(note('self-service', 32, 120, 200))
		assert.ok(!/[^-]-\n/.test(dash.text.replace('self-\n', '')), JSON.stringify(dash))
	})

	test('(f) emoji, flags and ZWJ sequences are never split', () => {
		const text = '👍🎉🇩🇪👨‍👩‍👧‍👦'.repeat(6)
		const r = noteTextLayout(note(text, 22))
		const graphemes = (s) => s.match(/\p{RI}\p{RI}|\P{M}(?:\p{M}|\p{Emoji_Modifier}|️|‍\P{M})*|\p{M}+/gu) ?? []
		for (const line of r.text.split('\n')) {
			const body = line.endsWith('-') ? line.slice(0, -1) : line
			for (const g of graphemes(body)) assert.ok(['👍', '🎉', '🇩🇪', '👨‍👩‍👧‍👦'].includes(g), JSON.stringify(g) + ' in ' + JSON.stringify(line))
		}
		assert.equal(unsplit(r), text)
	})

	test('the tag band is left free (reserve), and nothing of the layout is stored: the item stays as it is', () => {
		const it = note('Donaudampfschifffahrtsgesellschaftskapitän', 22)
		const before = JSON.stringify(it)
		const free = noteTextLayout(it)
		const tagged = noteTextLayout(it, STICKY_PADDING, 150)
		assert.ok(tagged.fontSize <= free.fontSize)
		assert.equal(JSON.stringify(it), before)
	})

	test('risk: 6000 characters without a space at L, and 2000 notes of 80 characters at M, stay quick', () => {
		let t0 = performance.now()
		const r = noteTextLayout(note('x'.repeat(6000), 32))
		assert.ok(performance.now() - t0 < 50, `${(performance.now() - t0).toFixed(1)} ms`)
		assert.ok(r.fontSize <= 16)
		const words = ['Idee', 'Kunde', 'Prozess', 'verbessern', 'schneller', 'Team', 'Feedback', 'Workshop']
		t0 = performance.now()
		for (let i = 0; i < 2000; i++) {
			let s = ''
			for (let k = i; s.length < 80; k += 3) s += words[k % words.length] + ' '
			noteTextLayout(note(s.trim(), 22))
		}
		assert.ok(performance.now() - t0 < 2000, 'far below a millisecond per note')
	})
})
