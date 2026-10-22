/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Auto-fit font size for notes (SPEC-M0 §6.2), port of autoFontSize from the
 * engine spike's scene.js. The size is COMPUTED, never stored (retrofit rule):
 * style.fontSize is only a manual override without UI in M0.
 *
 * Deterministic on purpose (no canvas measuring), so every client, the scene
 * lab and the tests agree: an area estimate, "the longest word fits on one
 * line" and "one line fits the height", snapped down to a FONT_STEPS step.
 *
 * Difference to the spike: words are split on any whitespace and explicit
 * line breaks count as lines, because notes are multi-line plain text (the
 * spike generator only produced single-line texts).
 *
 * Also here: the width estimate of connector labels (labelGlyphWidth,
 * wrapLabel; SPEC-M1 §6.3, round 1b), deterministic in the same way.
 */
import { FONT_STEPS, LINE_HEIGHT, STICKY_PADDING } from './tokens.js'

/**
 * @param {unknown} text note text (non-strings count as empty)
 * @param {number} w box width
 * @param {number} h box height
 * @param {number} [pad] inner padding on every side
 * @return {number} one of FONT_STEPS
 */
export function autoFontSize(text, w, h, pad = STICKY_PADDING) {
	const s = typeof text === 'string' ? text : ''
	const aw = Math.max(10, w - 2 * pad)
	const ah = Math.max(10, h - 2 * pad)
	const chars = Math.max(1, s.length)
	let longest = 1
	for (const word of s.split(/\s+/)) {
		longest = Math.max(longest, word.length)
	}
	const lines = s.split('\n').length
	let fs = Math.sqrt((aw * ah) / (chars * 0.55 * LINE_HEIGHT * 1.3))
	fs = Math.min(fs, aw / (longest * 0.62), ah / (lines * LINE_HEIGHT))
	let pick = FONT_STEPS[0]
	for (const step of FONT_STEPS) {
		if (step <= fs) pick = step
	}
	return pick
}

/**
 * Font size a note is drawn with: a valid manual override (integer 8–200,
 * the server's style.fontSize rule) wins, otherwise the auto-fit size.
 *
 * @param {object} item WireItem
 * @param {number} [pad] inner padding
 * @return {number} font size in world units
 */
export function noteFontSize(item, pad = STICKY_PADDING) {
	const o = item?.style?.fontSize
	if (Number.isInteger(o) && o >= 8 && o <= 200) {
		return o
	}
	return autoFontSize(item?.data?.text, item?.w ?? 0, item?.h ?? 0, pad)
}

// ---------------------------------------------------------------- label width estimate

/*
 * Connector labels ([S]-internal, SPEC-M1 §6.3; review finding S-1b-01): the
 * estimated label box must be an UPPER BOUND of what Konva.Text draws inside
 * it, otherwise Konva wraps a word onto a line the box has no room for. No
 * canvas measuring (hit test, rbush padding, renderer and label editor agree
 * on every client): every code point gets a width in whole px at the label
 * font size, rounded UP, so the bound also holds where a renderer rounds
 * glyph advances to whole pixels:
 * - U+0020–U+007E and U+00A0–U+00FF: advance widths of Liberation Sans
 *   Regular, metric-compatible with Arial (the first FONT_FAMILY entry)
 * - LABEL_WIDE_EM for every astral code point (emoji: Noto Color Emoji
 *   advances 1.245 em), the East-Asian wide and fullwidth blocks (CJK fonts:
 *   1.0 em) and U+2190–U+2BFF (arrows, technical, geometric, symbols and
 *   dingbats: the emoji of the BMP such as ⌚ ☔ ✅ ❌ ⭐)
 * - LABEL_OTHER_EM for any other code point (Arial: Cyrillic Љ 1.057 em,
 *   ₧ 1.094 em). Joiners, variation selectors and combining marks count as
 *   well, which only over-estimates and keeps a text symbol drawn as emoji
 *   in bounds (™ + U+FE0F = 2 × 1.1 em ≥ one emoji glyph)
 * wrapLabel breaks lines exactly as Konva.Text 10.7 does with a fixed width
 * and wrap 'word' (Text._setTextData): graphemes as in Konva's segmenter
 * fallback, a paragraph that fits stays whole (untrimmed), otherwise the
 * longest prefix that fits is cut back to its last space or dash (a word
 * wider than the line breaks between graphemes), trailing whitespace is
 * trimmed and the next line starts after the whitespace. With an upper
 * bound per grapheme, Konva at the estimated width never needs more lines
 * than the estimate.
 */

/** Advance widths of Liberation Sans Regular (= Arial) in 1/2048 em, U+0020–U+007E. */
const ADV_ASCII = [
	569, 569, 727, 1139, 1139, 1821, 1366, 391, 682, 682, 797, 1196, 569, 682, 569, 569,
	1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 569, 569, 1196, 1196, 1196, 1139,
	2079, 1366, 1366, 1479, 1479, 1366, 1251, 1593, 1479, 569, 1024, 1366, 1139, 1706, 1479, 1593,
	1366, 1593, 1479, 1366, 1251, 1479, 1366, 1933, 1366, 1366, 1251, 569, 569, 569, 961, 1139,
	682, 1139, 1139, 1024, 1139, 1139, 569, 1139, 1139, 455, 455, 1024, 455, 1706, 1139, 1139,
	1139, 1139, 682, 1024, 569, 1139, 1024, 1479, 1024, 1024, 1024, 684, 532, 684, 1196,
]

/** The same for U+00A0–U+00FF (no-break space … ÿ). */
const ADV_LATIN1 = [
	569, 682, 1139, 1139, 1139, 1139, 532, 1139, 682, 1509, 758, 1139, 1196, 682, 1509, 1131,
	819, 1124, 682, 682, 682, 1180, 1100, 569, 682, 682, 748, 1139, 1708, 1708, 1708, 1251,
	1366, 1366, 1366, 1366, 1366, 1366, 2048, 1479, 1366, 1366, 1366, 1366, 569, 569, 569, 569,
	1479, 1479, 1593, 1593, 1593, 1593, 1593, 1196, 1593, 1479, 1479, 1479, 1479, 1366, 1366, 1251,
	1139, 1139, 1139, 1139, 1139, 1139, 1821, 1024, 1139, 1139, 1139, 1139, 569, 569, 569, 569,
	1139, 1139, 1139, 1139, 1139, 1139, 1139, 1124, 1251, 1139, 1139, 1139, 1139, 1024, 1139, 1024,
]

/** Width of any code point outside the tables and the wide ranges, in em. */
const LABEL_OTHER_EM = 1.1

/** Width of East-Asian wide, symbol/dingbat and astral (emoji) code points, in em. */
const LABEL_WIDE_EM = 1.3

/** [from, to] code point ranges counted as wide (besides everything above U+FFFF). */
const WIDE_RANGES = [
	[0x1100, 0x115f], // Hangul Jamo (leading consonants)
	[0x2190, 0x2bff], // arrows … misc symbols and arrows (BMP emoji)
	[0x2e80, 0xa4cf], // CJK radicals … Yi (ideographic space, kana, CJK unified)
	[0xa960, 0xa97f], // Hangul Jamo extended A
	[0xac00, 0xd7a3], // Hangul syllables
	[0xf900, 0xfaff], // CJK compatibility ideographs
	[0xfe10, 0xfe1f], // vertical forms
	[0xfe30, 0xfe6f], // CJK compatibility and small forms
	[0xff00, 0xff60], // fullwidth forms
	[0xffe0, 0xffe6], // fullwidth signs
]

/**
 * Graphemes like Konva's stringToArray without Intl.Segmenter (identical
 * on every engine): a flag pair, or a code point with its combining marks,
 * skin tone modifiers, U+FE0F and ZWJ joins.
 */
const GRAPHEME = /\p{RI}\p{RI}|\P{M}(?:\p{M}|\p{Emoji_Modifier}|\uFE0F|\u200D\P{M})*|\p{M}+/gu

/**
 * Estimated width of one code point of a connector label: an upper bound of
 * its advance in whole px (see above).
 *
 * @param {number} cp code point
 * @param {number} fs font size in px (world units)
 * @return {number} integer px
 */
export function labelGlyphWidth(cp, fs) {
	if (cp >= 0x20 && cp <= 0x7e) return Math.ceil(ADV_ASCII[cp - 0x20] * fs / 2048)
	if (cp >= 0xa0 && cp <= 0xff) return Math.ceil(ADV_LATIN1[cp - 0xa0] * fs / 2048)
	let em = LABEL_OTHER_EM
	if (cp > 0xffff || WIDE_RANGES.some(([a, b]) => cp >= a && cp <= b)) em = LABEL_WIDE_EM
	return Math.ceil(em * fs)
}

/**
 * @param {string} g grapheme
 * @param {number} fs font size
 * @return {number} sum of its code points' estimated widths
 */
function graphemeWidth(g, fs) {
	let w = 0
	for (const ch of g) w += labelGlyphWidth(ch.codePointAt(0), fs)
	return w
}

/**
 * @param {string} g grapheme
 * @return {boolean} Konva wraps after it (a space or a dash)
 */
function isBreak(g) {
	return g === ' ' || g === '-'
}

/**
 * Lines of a connector label wrapped at maxW the way Konva.Text wraps it
 * (wrap 'word', fixed width, no ellipsis), with estimated widths.
 *
 * @param {string} text label text (\n breaks paragraphs)
 * @param {number} maxW line width in px
 * @param {number} fs font size in px
 * @return {Array<{text:string, width:number}>} one entry per drawn line
 */
export function wrapLabel(text, maxW, fs) {
	const rows = []
	for (const para of String(text).split('\n')) {
		const gs = para.match(GRAPHEME) ?? []
		const ws = gs.map((g) => graphemeWidth(g, fs))
		const n = gs.length
		const total = ws.reduce((a, b) => a + b, 0)
		if (total <= maxW) {
			rows.push({ text: para, width: total })
			continue
		}
		let start = 0
		while (start < n) {
			// longest prefix that fits (at least one grapheme: a grapheme wider
			// than the line, which 1.3 em never is at the label width, gets one)
			let low = start
			let w = 0
			while (low < n && w + ws[low] <= maxW) {
				w += ws[low]
				low++
			}
			if (low === start) low = start + 1
			if (low === n) {
				rows.push({ text: gs.slice(start).join(''), width: sum(ws, start, n) })
				break
			}
			if (!isBreak(gs[low])) {
				// back to the last space or dash of the line
				let j = low - 1
				while (j >= start && !isBreak(gs[j])) j--
				if (j >= start) low = j + 1
			}
			let end = low
			while (end > start && !gs[end - 1].trim()) end--
			rows.push({ text: gs.slice(start, end).join(''), width: sum(ws, start, end) })
			start = low
			while (start < n && !gs[start].trim()) start++
		}
	}
	return rows
}

/**
 * @param {number[]} ws widths
 * @param {number} a first index
 * @param {number} b end index (exclusive)
 * @return {number}
 */
function sum(ws, a, b) {
	let s = 0
	for (let i = a; i < b; i++) s += ws[i]
	return s
}
