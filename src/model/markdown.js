/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The Markdown of an AI card (factory job 267, item type `ai`, data.md): a
 * small subset, drawn on the canvas and never turned into HTML.
 *
 * parseMarkdown(md) → blocks:
 * - `# `, `## `, `### ` at the start of a line: a heading of level 1–3
 * - `- `, `* `, `+ ` a bullet, `1. ` / `1) ` a numbered item; two or more
 *   leading spaces make it one level deeper (at most one)
 * - an empty line ends a paragraph; other lines of a paragraph join with a
 *   space
 * - inline: `**bold**` (also `__bold__`), `*italic*` and `_italic_` (an
 *   underscore inside a word stays), a backslash before * or _ keeps it
 * Everything else stays literal text (`#### x`, `> quote`, `code`, links).
 *
 * layoutMarkdown(blocks, width, measure) → {lines, height}: greedy word
 * wrap at `width` (a word longer than the line is broken by characters),
 * every line {y, size, runs: [{x, text, bold, italic}], marker?: {x, text}}
 * with y = the line's top; measure(text, font) gives the width of a text in
 * a CSS font (the canvas's measureText, tests their own).
 */

/** Font sizes (world units) of body text and the three heading levels. */
export const MD_BODY_SIZE = 15
export const MD_HEADING_SIZES = Object.freeze([20, 17, 15])
export const MD_LINE_HEIGHT = 1.4
/** Space after a paragraph or a list, before a heading (not the first block). */
export const MD_BLOCK_GAP = 8
export const MD_HEADING_GAP = 6
/** Indent per list level and the place of the marker inside it. */
export const MD_INDENT = 18

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/
const NUMBER_RE = /^(\s*)(\d{1,3})[.)]\s+(.*)$/

/**
 * @param {string} text inline Markdown
 * @param {boolean} [bold] already bold
 * @param {boolean} [italic] already italic
 * @return {{text: string, bold: boolean, italic: boolean}[]} runs (adjacent runs of the same look merged)
 */
export function parseInline(text, bold = false, italic = false) {
	const out = []
	const push = (t, b, i) => {
		if (t === '') return
		const last = out[out.length - 1]
		if (last && last.bold === b && last.italic === i) last.text += t
		else out.push({ text: t, bold: b, italic: i })
	}
	const s = String(text ?? '')
	let plain = ''
	let k = 0
	while (k < s.length) {
		const c = s[k]
		if (c === '\\' && (s[k + 1] === '*' || s[k + 1] === '_' || s[k + 1] === '\\')) {
			plain += s[k + 1]
			k += 2
			continue
		}
		const two = s.slice(k, k + 2)
		if ((two === '**' || two === '__') && !bold) {
			const end = s.indexOf(two, k + 2)
			if (end > k + 2) {
				push(plain, bold, italic)
				plain = ''
				for (const r of parseInline(s.slice(k + 2, end), true, italic)) push(r.text, r.bold, r.italic)
				k = end + 2
				continue
			}
		}
		if ((c === '*' || c === '_') && !italic && s[k + 1] !== undefined && s[k + 1] !== ' ' && s[k + 1] !== c) {
			// an underscore inside a word (snake_case) is no emphasis
			const wordBefore = c === '_' && k > 0 && /[\p{L}\p{N}]/u.test(s[k - 1])
			let end = -1
			for (let j = k + 1; j < s.length; j++) {
				if (s[j] === c && s[j - 1] !== ' ' && s[j + 1] !== c && !(c === '_' && /[\p{L}\p{N}]/u.test(s[j + 1] ?? ''))) {
					end = j
					break
				}
			}
			if (!wordBefore && end > k + 1) {
				push(plain, bold, italic)
				plain = ''
				for (const r of parseInline(s.slice(k + 1, end), bold, true)) push(r.text, r.bold, r.italic)
				k = end + 1
				continue
			}
		}
		plain += c
		k++
	}
	push(plain, bold, italic)
	return out
}

/**
 * @param {unknown} md the Markdown of a card
 * @return {Array<{kind: 'h', level: number, runs: object[]}|{kind: 'p', runs: object[]}|{kind: 'li', depth: number, marker: string, runs: object[]}>}
 */
export function parseMarkdown(md) {
	const lines = String(typeof md === 'string' ? md : '').replace(/\r\n?/g, '\n').split('\n')
	const blocks = []
	let para = null
	const flush = () => {
		if (para !== null) {
			blocks.push({ kind: 'p', runs: parseInline(para) })
			para = null
		}
	}
	for (const raw of lines) {
		const line = raw.replace(/\s+$/, '')
		if (line.trim() === '') {
			flush()
			continue
		}
		let m = HEADING_RE.exec(line)
		if (m) {
			flush()
			blocks.push({ kind: 'h', level: m[1].length, runs: parseInline(m[2]) })
			continue
		}
		m = BULLET_RE.exec(line)
		if (m) {
			flush()
			blocks.push({ kind: 'li', depth: m[1].length >= 2 ? 1 : 0, marker: '•', runs: parseInline(m[2]) })
			continue
		}
		m = NUMBER_RE.exec(line)
		if (m) {
			flush()
			blocks.push({ kind: 'li', depth: m[1].length >= 2 ? 1 : 0, marker: m[2] + '.', runs: parseInline(m[3]) })
			continue
		}
		para = para === null ? line.trim() : para + ' ' + line.trim()
	}
	flush()
	return blocks
}

/**
 * @param {{bold: boolean, italic: boolean}} r a run
 * @param {number} size font size
 * @param {string} family font family
 * @return {string} the CSS font of the run
 */
export function runFont(r, size, family) {
	return (r.italic ? 'italic ' : 'normal ') + (r.bold ? 'bold ' : 'normal ') + size + 'px ' + family
}

/**
 * @param {object[]} blocks parseMarkdown
 * @param {number} width line width
 * @param {(text: string, font: string) => number} measure width of a text in a font
 * @param {string} [family] font family
 * @return {{lines: object[], height: number}}
 */
export function layoutMarkdown(blocks, width, measure, family = 'sans-serif') {
	const lines = []
	let y = 0
	let prev = null
	for (const b of blocks) {
		const heading = b.kind === 'h'
		const size = heading ? MD_HEADING_SIZES[b.level - 1] : MD_BODY_SIZE
		const lh = size * MD_LINE_HEIGHT
		if (prev !== null && (heading || b.kind !== prev.kind || prev.kind === 'p')) {
			y += heading ? MD_BLOCK_GAP + MD_HEADING_GAP : MD_BLOCK_GAP
		}
		const indent = b.kind === 'li' ? (b.depth + 1) * MD_INDENT : 0
		const avail = Math.max(1, width - indent)
		const runs = heading ? b.runs.map((r) => ({ ...r, bold: true })) : b.runs
		// words with their run's look; spaces stay with the word before them
		const words = []
		for (const r of runs) {
			for (const part of r.text.split(/(?<=\s)/)) {
				if (part !== '') words.push({ text: part, bold: r.bold, italic: r.italic })
			}
		}
		let cur = { y, size, runs: [], marker: b.kind === 'li' ? { x: indent - MD_INDENT + 2, text: b.marker } : null }
		let x = 0
		const newLine = () => {
			lines.push(cur)
			y += lh
			cur = { y, size, runs: [], marker: null }
			x = 0
		}
		const place = (w) => {
			const font = runFont(w, size, family)
			const last = cur.runs[cur.runs.length - 1]
			const ww = measure(w.text, font)
			if (last && last.bold === w.bold && last.italic === w.italic) last.text += w.text
			else cur.runs.push({ x: indent + x, text: w.text, bold: w.bold, italic: w.italic })
			x += ww
		}
		for (const w of words) {
			const font = runFont(w, size, family)
			const wt = w.text.replace(/\s+$/, '')
			const ww = measure(wt, font)
			if (x > 0 && x + ww > avail) newLine()
			if (ww > avail) {
				// a word longer than the line: by characters
				let chunk = ''
				for (const ch of w.text) {
					if (chunk !== '' && x + measure(chunk + ch, font) > avail) {
						place({ ...w, text: chunk })
						newLine()
						chunk = ''
					}
					chunk += ch
				}
				if (chunk !== '') place({ ...w, text: chunk })
				continue
			}
			place(w)
		}
		lines.push(cur)
		y += lh
		prev = b
	}
	for (const l of lines) {
		for (const r of l.runs) r.text = r.text.replace(/\s+$/, (m) => (r === l.runs[l.runs.length - 1] ? '' : m))
	}
	return { lines: lines.filter((l) => l.runs.length > 0 || l.marker), height: Math.ceil(y) }
}

