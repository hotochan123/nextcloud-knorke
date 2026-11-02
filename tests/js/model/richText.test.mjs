/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 279: Markdown in notes, shapes, text items and cells – the
 * parser (AK1), the text without marks (AK2, the vectors the PHP test reads
 * too), the layout (AK3), the editor's buttons (AK6), the links (AK7) and
 * the Markdown of the outline (AK8, risks).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	hasMarks, layoutRich, linkAllowed, linkAtLayout, linksOf, parseRich, plainText, shownText, toggleList, toggleMarks,
} from '../../../src/model/richText.js'
import { itemLinks } from '../../../src/model/itemLinks.js'
import { mdEscape, mdKeep } from '../../../src/board/outline.js'

/** The runs of the first line as [text, flags]. */
const runs = (s, n = 0) => parseRich(s).lines[n].runs.map((r) => [r.text, (r.b ? 'b' : '') + (r.i ? 'i' : '') + (r.s ? 's' : '') + (r.c ? 'c' : '') + (r.href ? '@' + r.href : '')])

describe('job 279 AK1: the parser', () => {
	test('each mark, nested, code without anything inside', () => {
		assert.deepEqual(runs('**f** *k* ~~s~~ `c`'), [['f', 'b'], [' ', ''], ['k', 'i'], [' ', ''], ['s', 's'], [' ', ''], ['c', 'c']])
		assert.deepEqual(runs('**a *b* c**'), [['a ', 'b'], ['b', 'bi'], [' c', 'b']])
		assert.deepEqual(runs('~~**x**~~'), [['x', 'bs']])
		assert.deepEqual(runs('`**no** *mark*`'), [['**no** *mark*', 'c']])
		assert.deepEqual(runs('***both***'), [['both', 'bi']])
	})

	test('marks without a partner, with spaces inside, and escapes stay literal', () => {
		assert.deepEqual(runs('** a**'), [['** a**', '']])
		assert.deepEqual(runs('*a *'), [['*a *', '']])
		assert.deepEqual(runs('a ~~b'), [['a ~~b', '']])
		assert.deepEqual(runs('``'), [['``', '']])
		assert.deepEqual(runs('\\*a\\* \\` \\[ \\\\'), [['*a* ` [ \\', '']])
		assert.equal(parseRich('\\*a\\*').marks, true, 'an escape shows differently')
	})

	test('lists: "- " and "N. " after at most three spaces, one level', () => {
		const p = parseRich('- a\n   - b\n    - c\n12. d\n1234. e\n-x\n1.x')
		assert.deepEqual(p.lines.map((l) => l.list && l.list.marker), ['•', '•', null, '12.', null, null, null])
		assert.deepEqual(p.lines.map((l) => l.runs.map((r) => r.text).join('')), ['a', 'b', '    - c', 'd', '1234. e', '-x', '1.x'])
	})

	test('links: [text](address) only with http, https, mailto; bare addresses without trailing punctuation', () => {
		assert.deepEqual(runs('[Doku](https://x.de/a?b=1)'), [['Doku', '@https://x.de/a?b=1']])
		assert.deepEqual(runs('[**B** c](HTTP://x.de)'), [['B', 'b@HTTP://x.de'], [' c', '@HTTP://x.de']])
		assert.deepEqual(runs('[m](mailto:a@b.de)'), [['m', '@mailto:a@b.de']])
		assert.deepEqual(runs('[x](javascript:alert(1))'), [['[x](javascript:alert(1))', '']])
		assert.deepEqual(runs('[x](data:text/html,hi)'), [['[x](data:text/html,hi)', '']])
		assert.deepEqual(runs('[x]( https://a.de)'), [['[x]( ', ''], ['https://a.de', '@https://a.de'], [')', '']], 'no [x] link, the bare address is one')
		assert.deepEqual(runs('see https://a.de/b.'), [['see ', ''], ['https://a.de/b', '@https://a.de/b'], ['.', '']])
		assert.deepEqual(runs('(https://a.de/x)!'), [['(', ''], ['https://a.de/x', '@https://a.de/x'], [')!', '']])
		assert.deepEqual(runs('xhttps://a.de'), [['xhttps://a.de', '']], 'inside a word: none')
		assert.deepEqual(runs('https://'), [['https://', '']])
		for (const bad of ['javascript:x', 'JAVASCRIPT:alert(1)', 'data:x', 'ftp://a', 'https://a b', '//a.de', 'https://a"b']) {
			assert.equal(linkAllowed(bad), false, bad)
		}
	})

	test('no marks in everyday text; marks never across a line', () => {
		for (const s of ['5 * 3', 'a - b', 'snake_case and _x_', 'Preis: 3 * 4 = 12', 'a~b', '1.5 kg', '-5 °C', '']) {
			assert.equal(hasMarks(s), false, s)
		}
		assert.equal(hasMarks('**a\nb**'), false)
		assert.equal(hasMarks(null), false)
		assert.equal(hasMarks('**a**'), true)
		assert.equal(hasMarks('- a'), true)
	})
})

describe('job 279 AK2: the text without marks', () => {
	test('the shared vectors (also tests/php/unit/RichTextTest.php)', () => {
		const doc = JSON.parse(readFileSync(new URL('../../fixtures/rich-plain.json', import.meta.url), 'utf8'))
		assert.ok(doc.vectors.length >= 10)
		for (const v of doc.vectors) assert.equal(plainText(v.in), v.plain, JSON.stringify(v.in))
	})

	test('shownText: what the board shows (bullets as •, link text only)', () => {
		assert.equal(shownText('- **a** [b](https://b.de)\n2. c'), '• a b\n2. c')
		assert.equal(shownText('plain'), 'plain')
		assert.equal(shownText(undefined), '')
	})
})

/** 0.5 em per code point, bold 0.6 em. */
const measure = (text, font) => Array.from(text).length * (/ bold /.test(font) ? 0.6 : 0.5) * Number(/([\d.]+)px/.exec(font)[1])
const lay = (s, o) => layoutRich(parseRich(s), { width: 100, fontSize: 10, lineHeight: 1.2, family: 'A', measure, align: 'left', ...o })

describe('job 279 AK3: the layout', () => {
	test('word wrap with the runs\' fonts, no space at a line end', () => {
		const l = lay('aaaa bbbb cccc dddd eeee')
		assert.deepEqual(l.lines.map((x) => x.runs.map((r) => r.text).join('')), ['aaaa bbbb cccc dddd', 'eeee'])
		assert.equal(l.lines[0].w, 95)
		assert.equal(l.height, 24)
		const b = lay('**aaaa** bbbb cccc dddd', { width: 96 })
		assert.equal(b.lines[0].runs[0].font, 'normal bold 10px A')
		assert.deepEqual(b.lines.map((x) => x.runs.map((r) => r.text).join('')), ['aaaa bbbb cccc', 'dddd'])
	})

	test('a word longer than the line is broken by graphemes, an emoji never split', () => {
		const l = lay('**' + '😀'.repeat(30) + '**', { width: 60 })
		for (const line of l.lines) {
			for (const r of line.runs) assert.ok(!/[\uD800-\uDBFF]$/.test(r.text), 'no lone surrogate')
			assert.ok(line.w <= 60)
		}
		assert.equal(l.lines.map((x) => x.runs.map((r) => r.text).join('')).join(''), '😀'.repeat(30))
	})

	test('hanging indent when left; each line on its own when centred or right', () => {
		const l = lay('- aaaa bbbb cccc dddd eeee')
		assert.equal(l.lines[0].marker.x, 0)
		assert.equal(l.lines[0].runs[0].x, 10, 'the text after "• "')
		assert.equal(l.lines[1].runs[0].x, 10, 'the next line under the text')
		const c = lay('aa\nbbbb', { align: 'center' })
		assert.equal(c.lines[0].runs[0].x, 45)
		assert.equal(c.lines[1].runs[0].x, 40)
		const r = lay('aa', { align: 'right' })
		assert.equal(r.lines[0].runs[0].x, 90)
	})

	test('too little height: the last shown line ends with "…"; middle and bottom', () => {
		const l = lay('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj', { width: 50, height: 30, valign: 'middle' })
		assert.equal(l.cut, true)
		assert.equal(l.lines.length, 2)
		assert.ok(l.lines[1].runs.at(-1).text.endsWith('…'))
		assert.ok(l.lines[1].w <= 50)
		assert.equal(l.lines[0].y, 3, '(30 − 24) / 2')
		const ok = lay('aa', { height: 30, valign: 'bottom' })
		assert.equal(ok.cut, false)
		assert.equal(ok.lines[0].y, 18)
		assert.equal(lay('a\n\nb').height, 36, 'an empty line counts')
	})

	test('a header cell: every run bold', () => {
		assert.equal(lay('*a*', { bold: true }).lines[0].runs[0].font, 'italic bold 10px A')
	})
})

describe('job 279 AK6: B, I, S and the list button', () => {
	test('toggleMarks: around the selection, away again (inside or right outside), an empty pair at the caret', () => {
		assert.deepEqual(toggleMarks('ab cd ef', 3, 5, 'bold'), { value: 'ab **cd** ef', start: 5, end: 7 })
		assert.deepEqual(toggleMarks('ab **cd** ef', 5, 7, 'bold'), { value: 'ab cd ef', start: 3, end: 5 })
		assert.deepEqual(toggleMarks('ab **cd** ef', 3, 9, 'bold'), { value: 'ab cd ef', start: 3, end: 5 })
		assert.deepEqual(toggleMarks('ab', 1, 1, 'italic'), { value: 'a**b', start: 2, end: 2 })
		assert.deepEqual(toggleMarks('ab cd', 2, 5, 'strike'), { value: 'ab ~~cd~~', start: 5, end: 7 }, 'the space stays outside')
		assert.deepEqual(toggleMarks('a **b** c', 4, 5, 'italic'), { value: 'a ***b*** c', start: 5, end: 6 }, 'bold and italic')
		assert.deepEqual(toggleMarks('a ***b*** c', 5, 6, 'italic'), { value: 'a **b** c', start: 4, end: 5 })
		assert.deepEqual(toggleMarks('a **b** c', 4, 5, 'italic').value.length, 11)
		assert.equal(hasMarks(toggleMarks('x y', 0, 3, 'bold').value), true)
	})

	test('toggleList: the lines the selection touches', () => {
		assert.deepEqual(toggleList('a\nb\nc', 0, 3), { value: '- a\n- b\nc', start: 2, end: 7 })
		assert.deepEqual(toggleList('- a\n- b', 2, 7), { value: 'a\nb', start: 0, end: 3 })
		assert.deepEqual(toggleList('- a\nb', 0, 5), { value: '- a\n- b', start: 0, end: 7 }, 'mixed: the missing ones get it')
		assert.deepEqual(toggleList('x', 1, 1), { value: '- x', start: 3, end: 3 })
		assert.deepEqual(toggleList('a\nb', 2, 2), { value: 'a\n- b', start: 4, end: 4 })
	})
})

describe('job 279 AK7: links', () => {
	test('linksOf and itemLinks (a table by its cells, at most 10)', () => {
		assert.deepEqual(linksOf('[a **b**](https://a.de) und https://c.de'), [{ text: 'a b', href: 'https://a.de' }, { text: 'https://c.de', href: 'https://c.de' }])
		assert.deepEqual(linksOf('none'), [])
		assert.deepEqual(itemLinks({ t: 'sticky', data: { text: '[x](https://x.de)' } }), [{ text: 'x', href: 'https://x.de' }])
		assert.deepEqual(itemLinks({ t: 'frame', data: { title: 'https://x.de' } }), [], 'frame titles stay plain')
		const cells = {}
		for (let i = 0; i < 12; i++) cells['c' + String(i).padStart(8, '0')] = { r00000001: 'https://h' + i + '.de' }
		const table = { t: 'table', data: { cols: Object.fromEntries(Object.keys(cells).map((k, i) => [k, { o: 'a' + String(i).padStart(2, '0'), w: 100 }])), rows: { r00000001: { o: 'a' } }, cells } }
		const links = itemLinks(table)
		assert.equal(links.length, 10)
		assert.deepEqual(links[0], { text: 'https://h0.de', href: 'https://h0.de' })
	})

	test('linkAtLayout: the run under the point, nothing beside it', () => {
		const l = lay('ab [cd](https://c.de) ef')
		assert.equal(linkAtLayout(l, 16, 5), 'https://c.de')
		assert.equal(linkAtLayout(l, 2, 5), null)
		assert.equal(linkAtLayout(l, 16, 30), null)
	})
})

describe('job 279 AK8: the Markdown of the outline keeps the marks and stays safe', () => {
	const keep = (s) => mdKeep(s, mdEscape)
	test('marks and allowed links stay, everything else escaped', () => {
		assert.equal(keep('**fett** und *k* ~~s~~ `c`'), '**fett** und *k* ~~s~~ `c`')
		assert.equal(keep('[Doku](https://x.de)'), '[Doku](https://x.de)')
		assert.equal(keep('siehe https://a.de/b'), 'siehe https://a.de/b')
		assert.equal(keep('- a\n1. b'), '- a\n1. b')
		assert.equal(keep('**a *b* c**'), '**a *b* c**')
	})

	test('risk: HTML, foreign links and headings stay inert', () => {
		assert.equal(keep('<img src=x onerror=alert(1)> **x**'), '\\<img src=x onerror=alert(1)\\> **x**')
		assert.equal(keep('[a](javascript:alert(1)) **x**'), '\\[a\\](javascript:alert(1)) **x**')
		assert.equal(keep('# h **x**'), '\\# h **x**')
		assert.equal(keep('<b>plain</b>'), mdEscape('<b>plain</b>'), 'a text without marks as before')
	})
})

describe('job 279: a note with marks is sized as shown', () => {
	test('noteTextLayout keeps the text as typed, a list stays a list (no recursion)', async () => {
		const { noteTextLayout } = await import('../../../src/model/text.js')
		const it = (text) => ({ t: 'sticky', w: 240, h: 240, data: { text }, style: {} })
		const r = noteTextLayout(it('- one\n2. two'))
		assert.equal(r.text, '- one\n2. two')
		assert.equal(noteTextLayout(it('**' + 'word '.repeat(5).trim() + '**')).fontSize, noteTextLayout(it('word '.repeat(5).trim())).fontSize, 'the marks take no room')
	})
})

describe('job 279 round 1: long texts stay fast', () => {
	test('a line of 6000 characters full of marks without partners parses in linear time', () => {
		for (const p of ['*x **y ', '**a *b ', '~~a **b *c `d ', '*a ', '[a ', '* ** ']) {
			const s = p.repeat(Math.ceil(6000 / p.length)).slice(0, 6000) + ' end' + p.length
			const t = performance.now()
			parseRich(s)
			assert.ok(performance.now() - t < 100, p)
		}
	})

	test('a word of 6000 characters is measured once per grapheme, not per growing piece', () => {
		let calls = 0
		const counting = (text, font) => {
			calls++
			return measure(text, font)
		}
		const l = layoutRich(parseRich('**' + 'x'.repeat(6000) + '**'), { width: 100, fontSize: 10, lineHeight: 1.2, family: 'A', measure: counting, align: 'left' })
		assert.ok(calls <= 2 * 6000 + 10, String(calls))
		assert.equal(l.lines.map((x) => x.runs.map((r) => r.text).join('')).join(''), 'x'.repeat(6000))
		for (const line of l.lines) assert.ok(line.w <= 100)
	})
})
