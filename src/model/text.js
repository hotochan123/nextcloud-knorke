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
 * Job 224: the estimate never looked at the wrapped lines, so a 180 × 90
 * rectangle drew "Check payment" at 32 as "Check…". From the estimated step
 * down, the first step whose wrapped lines fit is taken (fitsBox: Konva's
 * word wrap over the label width estimate below, no word cut, the lines'
 * height within the box); below the smallest step Konva cuts with "…" as
 * before. The estimate stays the upper limit, so a text never gets larger.
 *
 * Job 227: notes draw through noteTextLayout: a chosen size (S, M, L) is an
 * upper limit like the "Auto" estimate, a long word shrinks the text at most
 * down to NOTE_SIZE_S and is then split with a hyphen where the line is full
 * (wrapLines with hyphen). Shapes keep autoFontSize.
 *
 * Also here: the width estimate of connector labels (labelGlyphWidth,
 * wrapLabel; SPEC-M1 §6.3, round 1b), deterministic in the same way.
 */
import { hasMarks, shownText } from './richText.js'
import { FONT_STEPS, LINE_HEIGHT, NOTE_LINE_HEIGHT, NOTE_SIZE_S, STICKY_PADDING } from './tokens.js'

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
	let i = 0
	while (i < FONT_STEPS.length - 1 && FONT_STEPS[i + 1] <= fs) i++
	// job 224: down from the estimated step until the wrapped lines fit
	while (i > 0 && !fitsBox(s, aw, ah, FONT_STEPS[i])) i--
	return FONT_STEPS[i]
}

/**
 * (Job 224) The text, wrapped like Konva.Text at fs, fits the inner box: no
 * line ends inside a word (wrapLines' cut), and the line heights, added up
 * as Konva adds them, stay within ah (Konva draws the next line only when it
 * ends inside the height, otherwise it cuts the line before with "…").
 *
 * @param {string} s text
 * @param {number} aw inner width
 * @param {number} ah inner height
 * @param {number} fs font size
 * @return {boolean}
 */
function fitsBox(s, aw, ah, fs) {
	const lh = LINE_HEIGHT * fs
	let used = 0
	let fits = true
	wrapLines(s, aw, fs, (gs, ws, a, b, cut) => {
		used += lh
		fits = !cut && used <= ah
		return fits
	})
	return fits
}

/**
 * (Job 227) The text of a note as it is drawn: its font size and the text
 * Konva gets. One rule for a chosen size (S, M, L or any valid stored
 * style.fontSize, integer 8–200) and for "Auto" (no stored size):
 * - the upper limit C is the chosen size; for "Auto" the estimate of
 *   autoFontSize, except that the longest word lowers it at most down to
 *   NOTE_SIZE_S, snapped down to a FONT_STEPS step;
 * - from C down (C, then every FONT_STEPS step below it) the first size
 *   whose wrapped lines fit the height is taken; above NOTE_SIZE_S no line
 *   may end inside a word (the text gets smaller instead), from NOTE_SIZE_S
 *   down a word wider than the line is split where the line is full and
 *   that line ends in "-" (wrapLines with hyphen: part and hyphen fit the
 *   width estimate, a grapheme is never split). When no size fits, the
 *   smallest one is drawn with splitting, and Konva cuts with "…" as before;
 * - text is the note's text itself when nothing was split, else the wrapped
 *   lines with their hyphens joined by "\n" (Konva wraps nothing further:
 *   the widths are upper bounds). Nothing of it is ever stored.
 * (Job 259) Lines are NOTE_LINE_HEIGHT high (1.25; every other item 1.2).
 * (Job 279) A text with Markdown marks (model/richText.js) is sized as it
 * is shown (shownText) and returned as it is: the rich text node wraps it.
 * (Job 191) reserve is the band at the bottom a note with tags keeps free
 * for its labels (scene/nodes/tags.js tagReserve): the text fits above it.
 *
 * @param {object} item WireItem
 * @param {number} [pad] inner padding
 * @param {number} [reserve] height kept free at the bottom (world units)
 * @return {{fontSize: number, text: string}} font size in world units and the text to draw
 */
export function noteTextLayout(item, pad = STICKY_PADDING, reserve = 0) {
	const t = item?.data?.text
	// job 279: a text with Markdown marks is sized as shown (shownText; it may still look like a list, so never
	// through here again) and returned as it is: the rich text wraps itself, nothing is split here
	const marks = hasMarks(t)
	const s = marks ? shownText(t) : typeof t === 'string' ? t : ''
	const aw = Math.max(10, (item?.w ?? 0) - 2 * pad)
	const ah = Math.max(10, Math.max(0, (item?.h ?? 0) - (reserve > 0 ? reserve : 0)) - 2 * pad)
	const o = item?.style?.fontSize
	const cap = Number.isInteger(o) && o >= 8 && o <= 200 ? o : noteEstimate(s, aw, ah)
	const sizes = [cap, ...FONT_STEPS.filter((f) => f < cap).reverse()]
	for (const fs of sizes) {
		const r = noteLines(s, aw, ah, fs, fs <= NOTE_SIZE_S)
		if (r.fits) {
			return { fontSize: fs, text: marks ? t : r.split ? r.text : s }
		}
	}
	const fs = sizes[sizes.length - 1]
	if (marks) return { fontSize: fs, text: t }
	const r = noteLines(s, aw, ah, fs, true)
	return { fontSize: fs, text: r.split ? r.text : s }
}

/**
 * (Job 227) The "Auto" upper limit of a note: autoFontSize's estimate with
 * the longest word's term at least NOTE_SIZE_S, snapped down to a step.
 *
 * @param {string} s text
 * @param {number} aw inner width
 * @param {number} ah inner height
 * @return {number} one of FONT_STEPS
 */
function noteEstimate(s, aw, ah) {
	const chars = Math.max(1, s.length)
	let longest = 1
	for (const word of s.split(/\s+/)) {
		longest = Math.max(longest, word.length)
	}
	const lines = s.split('\n').length
	let fs = Math.sqrt((aw * ah) / (chars * 0.55 * NOTE_LINE_HEIGHT * 1.3))
	fs = Math.min(fs, Math.max(aw / (longest * 0.62), NOTE_SIZE_S), ah / (lines * NOTE_LINE_HEIGHT))
	let i = 0
	while (i < FONT_STEPS.length - 1 && FONT_STEPS[i + 1] <= fs) i++
	return FONT_STEPS[i]
}

/**
 * (Job 227) A note's text wrapped at fs: fits = the lines' heights stay
 * within ah and (without split) no line ends inside a word; split = some
 * line was split with a hyphen; text = the lines joined by "\n".
 *
 * @param {string} s text
 * @param {number} aw inner width
 * @param {number} ah inner height
 * @param {number} fs font size
 * @param {boolean} split words wider than the line may be split
 * @return {{fits: boolean, split: boolean, text: string}}
 */
function noteLines(s, aw, ah, fs, split) {
	const lh = NOTE_LINE_HEIGHT * fs
	let used = 0
	let fits = true
	let hyphened = false
	const rows = []
	wrapLines(s, aw, fs, (gs, ws, a, b, cut, hyphen) => {
		used += lh
		fits = (split || !cut) && used <= ah
		if (hyphen) hyphened = true
		rows.push(gs.slice(a, b).join('') + (hyphen ? '-' : ''))
		return fits || split
	}, split)
	return { fits, split: hyphened, text: rows.join('\n') }
}

/**
 * Font size a note is drawn with: noteTextLayout's (job 227; before, a
 * stored size won even when the text did not fit).
 *
 * @param {object} item WireItem
 * @param {number} [pad] inner padding
 * @param {number} [reserve] height kept free at the bottom (world units)
 * @return {number} font size in world units
 */
export function noteFontSize(item, pad = STICKY_PADDING, reserve = 0) {
	return noteTextLayout(item, pad, reserve).fontSize
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

/**
 * (Job 234) The same for bold text, U+0020–U+007E: per code point the larger
 * advance of Liberation Sans Bold (= Arial Bold) and Regular.
 */
const ADV_ASCII_BOLD = [
	569, 682, 971, 1139, 1139, 1821, 1479, 487, 682, 682, 797, 1196, 569, 682, 569, 569,
	1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 682, 682, 1196, 1196, 1196, 1251,
	2079, 1479, 1479, 1479, 1479, 1366, 1251, 1593, 1479, 569, 1139, 1479, 1251, 1706, 1479, 1593,
	1366, 1593, 1479, 1366, 1251, 1479, 1366, 1933, 1366, 1366, 1251, 682, 569, 682, 1196, 1139,
	682, 1139, 1251, 1139, 1251, 1139, 682, 1251, 1251, 569, 569, 1139, 569, 1821, 1251, 1251,
	1251, 1251, 797, 1139, 682, 1251, 1139, 1593, 1139, 1139, 1024, 797, 573, 797, 1196,
]

/** (Job 234) The same for U+00A0–U+00FF. */
const ADV_LATIN1_BOLD = [
	569, 682, 1139, 1139, 1139, 1139, 573, 1139, 682, 1509, 758, 1139, 1196, 682, 1509, 1131,
	819, 1124, 682, 682, 682, 1180, 1139, 569, 682, 682, 748, 1139, 1708, 1708, 1708, 1251,
	1479, 1479, 1479, 1479, 1479, 1479, 2048, 1479, 1366, 1366, 1366, 1366, 569, 569, 569, 569,
	1479, 1479, 1593, 1593, 1593, 1593, 1593, 1196, 1593, 1479, 1479, 1479, 1479, 1366, 1366, 1251,
	1139, 1139, 1139, 1139, 1139, 1139, 1821, 1139, 1139, 1139, 1139, 1139, 569, 569, 569, 569,
	1251, 1251, 1251, 1251, 1251, 1251, 1251, 1124, 1251, 1251, 1251, 1251, 1251, 1139, 1251, 1139,
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
 * (Job 234) Estimated width of one line of bold text (the names of lanes and
 * groups): per code point the bold advance above in whole px, rounded up,
 * any other code point as labelGlyphWidth. An upper bound like the label's.
 *
 * @param {string} text one line
 * @param {number} fs font size in px (world units)
 * @return {number} integer px
 */
export function boldLineWidth(text, fs) {
	let w = 0
	for (const ch of String(text)) {
		const cp = ch.codePointAt(0)
		if (cp >= 0x20 && cp <= 0x7e) w += Math.ceil(ADV_ASCII_BOLD[cp - 0x20] * fs / 2048)
		else if (cp >= 0xa0 && cp <= 0xff) w += Math.ceil(ADV_LATIN1_BOLD[cp - 0xa0] * fs / 2048)
		else w += labelGlyphWidth(cp, fs)
	}
	return w
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
	wrapLines(text, maxW, fs, (gs, ws, a, b) => {
		rows.push({ text: gs.slice(a, b).join(''), width: sum(ws, a, b) })
	})
	return rows
}

/**
 * Konva.Text's word wrap over the estimated widths (see above), line by
 * line: row(gs, ws, a, b, cut) gets the graphemes and widths of the
 * paragraph and the line's range [a, b). (Job 224) cut is true when the line
 * ends inside a word (no space or dash to wrap at) or is one grapheme wider
 * than maxW. A row returning false stops the wrap. (Job 227) With hyphen, a
 * line that ends inside a word keeps only as many graphemes (at least one)
 * as fit together with a "-"; the sixth argument of row says whether the
 * line gets that hyphen (false when even one grapheme and "-" are too wide).
 *
 * @param {string} text text (\n breaks paragraphs)
 * @param {number} maxW line width in px
 * @param {number} fs font size in px
 * @param {Function} row callback per drawn line
 * @param {boolean} [hyphen] split words with a hyphen where the line is full
 */
function wrapLines(text, maxW, fs, row, hyphen = false) {
	const hw = hyphen ? graphemeWidth('-', fs) : 0
	for (const para of String(text).split('\n')) {
		const gs = para.match(GRAPHEME) ?? []
		const ws = gs.map((g) => graphemeWidth(g, fs))
		const n = gs.length
		if (sum(ws, 0, n) <= maxW) {
			if (row(gs, ws, 0, n, false) === false) return
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
			let cut = low === start
			if (cut) low = start + 1
			if (low === n) {
				if (row(gs, ws, start, n, cut) === false) return
				break
			}
			let hy = false
			if (!isBreak(gs[low])) {
				// back to the last space or dash of the line
				let j = low - 1
				while (j >= start && !isBreak(gs[j])) j--
				if (j >= start) low = j + 1
				else {
					cut = true
					if (hyphen) {
						// job 227: room for the hyphen at the end of the full line
						while (low - start > 1 && sum(ws, start, low) + hw > maxW) low--
						hy = sum(ws, start, low) + hw <= maxW
					}
				}
			}
			let end = low
			while (end > start && !gs[end - 1].trim()) end--
			if (row(gs, ws, start, end, cut, hy) === false) return
			start = low
			while (start < n && !gs[start].trim()) start++
		}
	}
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
