/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 267 (AK8): the Markdown subset of an AI card (model/markdown.js):
 * headings, bold, italics, lists, paragraphs; anything else literal, never HTML;
 * the word wrap of layoutMarkdown.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MD_BODY_SIZE, MD_INDENT, layoutMarkdown, parseInline, parseMarkdown } from '../../../src/model/markdown.js'

const plain = (text) => ({ text, bold: false, italic: false })
const W = (text) => Array.from(text).length * 10

test('headings 1–3, paragraphs joined, lists with depth and numbers', () => {
	assert.deepEqual(parseMarkdown('# A\n## B\n### C\n#### D\nline one\nline two\n\n- x\n  * y\n3) z'), [
		{ kind: 'h', level: 1, runs: [plain('A')] },
		{ kind: 'h', level: 2, runs: [plain('B')] },
		{ kind: 'h', level: 3, runs: [plain('C')] },
		{ kind: 'p', runs: [plain('#### D line one line two')] },
		{ kind: 'li', depth: 0, marker: '•', runs: [plain('x')] },
		{ kind: 'li', depth: 1, marker: '•', runs: [plain('y')] },
		{ kind: 'li', depth: 0, marker: '3.', runs: [plain('z')] },
	])
	assert.deepEqual(parseMarkdown(null), [])
	assert.deepEqual(parseMarkdown('a\r\n\r\nb').map((b) => b.runs[0].text), ['a', 'b'])
})

test('inline: bold, italics, nested, snake_case and escapes stay', () => {
	assert.deepEqual(parseInline('a **b *c* d** e'), [
		plain('a '), { text: 'b ', bold: true, italic: false }, { text: 'c', bold: true, italic: true }, { text: ' d', bold: true, italic: false }, plain(' e'),
	])
	assert.deepEqual(parseInline('__b__ _i_'), [{ text: 'b', bold: true, italic: false }, plain(' '), { text: 'i', bold: false, italic: true }])
	assert.deepEqual(parseInline('snake_case_name and 2 * 3 * 4'), [plain('snake_case_name and 2 * 3 * 4')])
	assert.deepEqual(parseInline('\\*not\\* **open'), [plain('*not* **open')])
	assert.deepEqual(parseInline('<b>x</b> `code` [l](u)'), [plain('<b>x</b> `code` [l](u)')], 'no HTML, no other syntax')
})

test('layout: greedy wrap, a long word broken by characters, list indent and marker, heading gap', () => {
	const L = layoutMarkdown(parseMarkdown('aa bb cc\n\n- dd'), 60, W)
	assert.deepEqual(L.lines.map((l) => l.runs.map((r) => r.text).join('|')), ['aa bb', 'cc', 'dd'])
	assert.equal(L.lines[2].runs[0].x, MD_INDENT)
	assert.deepEqual(L.lines[2].marker, { x: 2, text: '•' })
	assert.equal(L.lines[0].size, MD_BODY_SIZE)
	const long = layoutMarkdown(parseMarkdown('abcdefghij'), 40, W)
	assert.deepEqual(long.lines.map((l) => l.runs[0].text), ['abcd', 'efgh', 'ij'])
	const h = layoutMarkdown(parseMarkdown('# T\ntext'), 400, W)
	assert.equal(h.lines[1].y, 20 * 1.4 + 8, "the block gap below a heading")
	assert.equal(layoutMarkdown(parseMarkdown("x\n# T"), 400, W).lines[1].y, 15 * 1.4 + 8 + 6, "a heading gets more room above it")
	assert.ok(h.height > h.lines[1].y)
})
