/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Markdown in the texts of notes, shapes, text items and table cells
 * (factory job 279): pure functions, no DOM. The text is stored as it is
 * typed (plain text with the marks in it); only drawing, search, CSV, the
 * AI and the outline read it through here. The AI card has its own,
 * different subset (model/markdown.js).
 *
 * Syntax, line by line ("\n" stays a line break, nothing is joined):
 * - a line starting (after at most 3 spaces) with "- " is a bullet "•",
 *   with "N. " (1–3 digits) a numbered item "N.";
 * - inline, never across a line: **bold**, *italic*, ~~strike~~, `code`
 *   (nothing inside code), nestable outside code. An opening mark needs a
 *   non-space after it, a closing one a non-space before it; a mark without
 *   its partner stays literal. A backslash before * ~ ` [ ] \ gives the
 *   character itself;
 * - links: [text](address) and a bare http:// or https:// address (ending
 *   . , ; : ! ? ) are not part of it); only http, https and mailto (any
 *   case) become links, anything else stays literal text.
 *
 * parseRich(text) → {lines: [{list: null|{marker, raw}, runs}], marks}
 * with runs {text, b, i, s, c, href, lk} (lk: number of the link, -1 none)
 * and marks = the text shows differently from how it is typed.
 * layoutRich(parsed, opts) lays it out for drawing (greedy word wrap with
 * a measure function); toggleMarks / toggleList are the editor's buttons.
 */

const LIST_RE = /^ {0,3}(?:(-)|(\d{1,3})\.) (.*)$/
const LINK_RE = /^\[([^\]\n]+)\]\(([^()\s]+)\)/
const BARE_RE = /^https?:\/\/[^\s<>"]+/i
const SCHEME_RE = /^(?:https?:\/\/|mailto:)/i
const ESCAPABLE = '*~`[]\\'
/** Something that may be a mark; without it a text has none (the fast path). */
const MAYBE_RE = /[*~`[\\]|https?:\/\/|^ {0,3}(?:-|\d{1,3}\.) /im

/** Monospace family of code runs. */
export const CODE_FAMILY = 'ui-monospace, Menlo, Consolas, monospace'
/** Code is drawn at this part of the text size. */
export const CODE_SCALE = 0.9
/** Opacity of the box behind code (in the text colour). */
export const CODE_BOX_OPACITY = 0.12

/**
 * @param {unknown} url address
 * @return {boolean} it may become a link (http, https, mailto)
 */
export function linkAllowed(url) {
	return typeof url === 'string' && SCHEME_RE.test(url) && !/[\s<>"]/.test(url)
}

/**
 * Inline parse of one line.
 *
 * @param {string} s line
 * @param {{b: boolean, i: boolean, s: boolean, href: (string|null), lk: number}} st current look
 * @param {{n: number, marks: boolean}} acc link counter, marks seen
 * @param {object[]} out runs
 */
function inline(s, st, acc, out) {
	const push = (text, look) => {
		if (text === '') return
		const last = out[out.length - 1]
		if (last && last.b === look.b && last.i === look.i && last.s === look.s && last.c === look.c && last.lk === look.lk) last.text += text
		else out.push({ text, b: look.b, i: look.i, s: look.s, c: look.c, href: look.href, lk: look.lk })
	}
	const plain = { ...st, c: false }
	// per mark the first opening position from which no partner was found (closing)
	const memo = {}
	let k = 0
	while (k < s.length) {
		const ch = s[k]
		if (ch === '\\' && k + 1 < s.length && ESCAPABLE.includes(s[k + 1])) {
			acc.marks = true
			push(s[k + 1], plain)
			k += 2
			continue
		}
		if (ch === '`') {
			const end = s.indexOf('`', k + 1)
			if (end > k + 1) {
				acc.marks = true
				push(s.slice(k + 1, end), { ...st, c: true })
				k = end + 1
				continue
			}
		}
		if (ch === '[' && st.href === null) {
			const m = LINK_RE.exec(s.slice(k))
			if (m && linkAllowed(m[2])) {
				acc.marks = true
				const lk = acc.n++
				inline(m[1], { ...st, href: m[2], lk }, acc, out)
				k += m[0].length
				continue
			}
		}
		if ((ch === 'h' || ch === 'H') && st.href === null && !(k > 0 && /[\p{L}\p{N}]/u.test(s[k - 1]))) {
			const m = BARE_RE.exec(s.slice(k))
			if (m) {
				const url = m[0].replace(/[.,;:!?)]+$/, '')
				if (/^https?:\/\/[^/]/i.test(url)) {
					acc.marks = true
					const lk = acc.n++
					push(url, { ...plain, href: url, lk })
					k += url.length
					continue
				}
			}
		}
		const two = s.slice(k, k + 2)
		if ((two === '**' && !st.b) || (two === '~~' && !st.s)) {
			const end = closing(s, k + 2, two, memo)
			if (end > 0) {
				acc.marks = true
				inline(s.slice(k + 2, end), two === '**' ? { ...st, b: true } : { ...st, s: true }, acc, out)
				k = end + 2
				continue
			}
		}
		if (ch === '*' && two !== '**' && !st.i) {
			const end = closing(s, k + 1, '*', memo)
			if (end > 0) {
				acc.marks = true
				inline(s.slice(k + 1, end), { ...st, i: true }, acc, out)
				k = end + 1
				continue
			}
		}
		push(ch, plain)
		k++
	}
}

/**
 * The index of the closing mark for an opening one that ends at `from`:
 * the content starts and ends with a non-space; code spans and escapes
 * are skipped; a single * never closes on a ** (that one is bold, its
 * two stars are passed over). Round 1 of job 279: linear per mark and
 * line – the result depends only on `from`, so a search that found no
 * partner from `from` on is remembered in memo, and every later opening
 * of that mark gives up at once (before, a line of 6000 characters like
 * "*x **y **y …" took seconds).
 *
 * @param {string} s line
 * @param {number} from first index of the content
 * @param {string} mark '**', '~~' or '*'
 * @param {object} memo per mark the first `from` without a partner
 * @return {number} index of the closing mark, -1 none
 */
function closing(s, from, mark, memo) {
	if (from >= s.length || /\s/.test(s[from])) return -1
	if (from >= (memo[mark] ?? Infinity)) return -1
	for (let j = from + 1; j < s.length; j++) {
		const c = s[j]
		if (c === '\\') {
			j++
			continue
		}
		if (c === '`') {
			const end = s.indexOf('`', j + 1)
			if (end > j + 1) {
				j = end
				continue
			}
		}
		if (mark === '*') {
			if (c === '*') {
				if (s[j + 1] === '*') {
					// a ** inside: pass over its two stars
					j++
					continue
				}
				if (!/\s/.test(s[j - 1])) return j
			}
		} else if (s.startsWith(mark, j) && !/\s/.test(s[j - 1])) {
			// "***" closes bold after an italic inside: the last two stars
			while (mark === '**' && s[j + 2] === '*') j++
			return j
		}
	}
	memo[mark] = Math.min(memo[mark] ?? Infinity, from)
	return -1
}

const CACHE = new Map()
const CACHE_MAX = 1000

/**
 * @param {unknown} text stored text
 * @return {{lines: {list: (null|{marker: string, raw: string}), runs: object[]}[], marks: boolean}} cached, do not change
 */
export function parseRich(text) {
	const src = typeof text === 'string' ? text : ''
	let p = CACHE.get(src)
	if (p) return p
	const acc = { n: 0, marks: false }
	const lines = src.replace(/\r\n?/g, '\n').split('\n').map((line) => {
		let list = null
		let body = line
		const m = MAYBE_RE.test(line) ? LIST_RE.exec(line) : null
		if (m) {
			acc.marks = true
			list = m[1] ? { marker: '•', raw: '- ' } : { marker: m[2] + '.', raw: m[2] + '. ' }
			body = m[3]
		}
		const runs = []
		if (MAYBE_RE.test(body)) inline(body, { b: false, i: false, s: false, href: null, lk: -1 }, acc, runs)
		else if (body !== '') runs.push({ text: body, b: false, i: false, s: false, c: false, href: null, lk: -1 })
		return { list, runs }
	})
	p = { lines, marks: acc.marks }
	if (CACHE.size >= CACHE_MAX) CACHE.clear()
	CACHE.set(src, p)
	return p
}

/**
 * @param {unknown} text stored text
 * @return {boolean} the text shows formatted (a mark, a link, a list, an escape)
 */
export function hasMarks(text) {
	return typeof text === 'string' && MAYBE_RE.test(text) && parseRich(text).marks
}

/**
 * The text as the board shows it, without marks: link text for a link,
 * "• " for "- ". Used to size a note's text.
 *
 * @param {unknown} text stored text
 * @return {string}
 */
export function shownText(text) {
	if (!hasMarks(text)) return typeof text === 'string' ? text : ''
	return parseRich(text).lines.map((l) => (l.list ? l.list.marker + ' ' : '') + l.runs.map((r) => r.text).join('')).join('\n')
}

/**
 * The text for search, CSV and the AI: the marks left out, a link as
 * "text (address)" (only its text when both are the same), list items as
 * typed ("- ", "1. ").
 *
 * @param {unknown} text stored text
 * @return {string}
 */
export function plainText(text) {
	if (!hasMarks(text)) return typeof text === 'string' ? text : ''
	return parseRich(text).lines.map((l) => {
		let out = l.list ? l.list.raw : ''
		const runs = l.runs
		for (let k = 0; k < runs.length; k++) {
			const r = runs[k]
			out += r.text
			if (r.lk >= 0 && runs[k + 1]?.lk !== r.lk) {
				let t = ''
				for (let j = k; j >= 0 && runs[j].lk === r.lk; j--) t = runs[j].text + t
				if (t !== r.href) out += ' (' + r.href + ')'
			}
		}
		return out
	}).join('\n')
}

/**
 * The links of a text, in order.
 *
 * @param {unknown} text stored text
 * @return {{text: string, href: string}[]}
 */
export function linksOf(text) {
	if (!hasMarks(text)) return []
	const out = []
	for (const l of parseRich(text).lines) {
		for (const r of l.runs) {
			if (r.lk < 0) continue
			const last = out[out.length - 1]
			if (last && last.lk === r.lk) last.text += r.text
			else out.push({ text: r.text, href: r.href, lk: r.lk })
		}
	}
	return out.map(({ text: t, href }) => ({ text: t, href }))
}

/**
 * The CSS font of a run.
 *
 * @param {{b: boolean, i: boolean, c: boolean}} r run (or {} for plain)
 * @param {number} size text size
 * @param {string} family family of plain text
 * @return {string}
 */
export function richFont(r, size, family) {
	const sz = r.c ? Math.round(size * CODE_SCALE * 100) / 100 : size
	return (r.i ? 'italic ' : 'normal ') + (r.b ? 'bold ' : 'normal ') + sz + 'px ' + (r.c ? CODE_FAMILY : family)
}

/**
 * @param {string} s text
 * @return {string[]} its graphemes (code points without Intl.Segmenter)
 */
function graphemes(s) {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (g) => g.segment)
	}
	return Array.from(s)
}

/**
 * Lays a parsed text out for drawing.
 *
 * @param {{lines: object[]}} parsed parseRich
 * @param {object} o options
 * @param {number} o.width wrap width
 * @param {number} [o.height] box height (undefined: no limit, no "…")
 * @param {number} o.fontSize text size
 * @param {number} o.lineHeight line height factor
 * @param {string} [o.align] 'left' | 'center' | 'right'
 * @param {string} [o.valign] 'top' | 'middle' | 'bottom'
 * @param {string} o.family font family
 * @param {boolean} [o.bold] every run bold (a header cell)
 * @param {(text: string, font: string) => number} o.measure width of a text in a CSS font
 * @return {{lines: {y: number, h: number, w: number, runs: object[], marker: (null|{x: number, text: string, font: string})}[], height: number, textHeight: number, cut: boolean}}
 *   runs {x, w, text, font, b, i, s, c, href, lk}; y = the line's top; height = all lines; textHeight = the shown lines
 */
export function layoutRich(parsed, o) {
	const width = Math.max(1, o.width)
	const fs = o.fontSize
	const lh = fs * o.lineHeight
	const base = richFont({ b: o.bold === true }, fs, o.family)
	const out = []
	for (const pl of parsed.lines) {
		const marker = pl.list ? pl.list.marker : null
		const indent = marker === null ? 0 : o.measure(marker + ' ', base)
		const avail = Math.max(1, width - indent)
		// atoms: pieces of one look, split at white space
		const atoms = []
		for (const r of pl.runs) {
			for (const part of r.text.split(/(\s+)/)) {
				if (part !== '') atoms.push({ ...r, b: r.b || o.bold === true, text: part, space: /^\s/.test(part) })
			}
		}
		let cur = []
		let x = 0
		let first = true
		const flush = () => {
			// no white space at the end of a line (it would count for the alignment)
			while (cur.length > 0) {
				const last = cur[cur.length - 1]
				const t = last.text.replace(/\s+$/, '')
				if (t === last.text) break
				if (t === '') {
					x -= last.w
					cur.pop()
					continue
				}
				const w = o.measure(t, last.font)
				x -= last.w - w
				last.text = t
				last.w = w
				break
			}
			out.push({ runs: cur, w: x, indent, marker: first ? marker : null })
			cur = []
			x = 0
			first = false
		}
		const put = (a, w) => {
			const font = richFont(a, fs, o.family)
			const last = cur[cur.length - 1]
			if (last && last.font === font && last.s === a.s && last.lk === a.lk && last.c === a.c) {
				last.text += a.text
				last.w += w
			} else {
				cur.push({ x, w, text: a.text, font, b: a.b, i: a.i, s: a.s, c: a.c, href: a.href, lk: a.lk, space: a.space })
			}
			if (!a.space && last) last.space = false
			x += w
		}
		let k = 0
		while (k < atoms.length) {
			if (atoms[k].space) {
				if (x > 0) put(atoms[k], o.measure(atoms[k].text, richFont(atoms[k], fs, o.family)))
				k++
				continue
			}
			// a word: the atoms up to the next space
			let e = k
			let ww = 0
			const widths = []
			while (e < atoms.length && !atoms[e].space) {
				const w = o.measure(atoms[e].text, richFont(atoms[e], fs, o.family))
				widths.push(w)
				ww += w
				e++
			}
			if (x > 0 && x + ww > avail) {
				flush()
			}
			if (ww > avail) {
				// longer than a line: by graphemes, their widths added up (round 1: one measure per
				// grapheme, not per growing chunk; a long word was quadratic)
				for (let j = k; j < e; j++) {
					const a = atoms[j]
					const font = richFont(a, fs, o.family)
					let chunk = ''
					let cw = 0
					for (const g of graphemes(a.text)) {
						const gw = o.measure(g, font)
						if (chunk !== '' && x + cw + gw > avail) {
							put({ ...a, text: chunk }, cw)
							flush()
							chunk = ''
							cw = 0
						} else if (chunk === '' && x > 0 && x + gw > avail) {
							flush()
						}
						chunk += g
						cw += gw
					}
					if (chunk !== '') put({ ...a, text: chunk }, cw)
				}
			} else {
				for (let j = k; j < e; j++) put(atoms[j], widths[j - k])
			}
			k = e
		}
		flush()
	}
	// alignment, rows, the cut
	const align = o.align === 'center' || o.align === 'right' ? o.align : 'left'
	let shown = out.length
	let cut = false
	if (Number.isFinite(o.height)) {
		const fit = Math.max(1, Math.floor((o.height + 1e-6) / lh))
		if (fit < out.length) {
			shown = fit
			cut = true
		}
	}
	const lines = []
	for (let n = 0; n < shown; n++) {
		const l = out[n]
		if (cut && n === shown - 1) ellipsis(l, width - l.indent, fs, o)
		const full = l.w + (l.marker !== null ? l.indent : 0)
		let x0 = 0
		if (align === 'center') x0 = (width - full) / 2
		else if (align === 'right') x0 = width - full
		// left: every line of an item under its text (hanging indent); else each line on its own
		const tx = align === 'left' ? x0 + l.indent : x0 + (l.marker !== null ? l.indent : 0)
		lines.push({
			y: n * lh,
			h: lh,
			w: full,
			runs: l.runs.map((r) => ({ x: tx + r.x, w: r.w, text: r.text, font: r.font, b: r.b, i: r.i, s: r.s, c: r.c, href: r.href, lk: r.lk })),
			marker: l.marker !== null ? { x: x0, text: l.marker, font: base } : null,
		})
	}
	const textHeight = shown * lh
	let dy = 0
	if (Number.isFinite(o.height)) {
		if (o.valign === 'middle') dy = (o.height - textHeight) / 2
		else if (o.valign === 'bottom') dy = o.height - textHeight
	}
	if (dy !== 0) for (const l of lines) l.y += dy
	return { lines, height: out.length * lh, textHeight, cut }
}

/**
 * Ends a line with "…" within avail: cuts graphemes from its end.
 *
 * @param {object} l line (runs with x, w, text, font)
 * @param {number} avail width
 * @param {number} fs text size
 * @param {object} o layout options (measure, family)
 */
function ellipsis(l, avail, fs, o) {
	const runs = l.runs
	if (runs.length === 0) {
		l.runs = [{ x: 0, w: o.measure('…', richFont({}, fs, o.family)), text: '…', font: richFont({}, fs, o.family), b: false, i: false, s: false, c: false, href: null, lk: -1 }]
		l.w = l.runs[0].w
		return
	}
	for (;;) {
		const r = runs[runs.length - 1]
		const w = o.measure(r.text + '…', r.font)
		if (r.x + w <= avail || r.text === '') {
			r.text += '…'
			r.w = w
			l.w = r.x + w
			return
		}
		const g = graphemes(r.text)
		g.pop()
		r.text = g.join('').replace(/\s+$/, '')
		if (r.text === '' && runs.length > 1) {
			runs.pop()
		}
	}
}

/**
 * The link under a point of a layout, in the layout's coordinates.
 *
 * @param {{lines: object[]}} layout layoutRich
 * @param {number} x point
 * @param {number} y point
 * @return {string|null} the address
 */
export function linkAtLayout(layout, x, y) {
	for (const l of layout?.lines ?? []) {
		if (y < l.y || y > l.y + l.h) continue
		for (const r of l.runs) {
			if (r.href && x >= r.x && x <= r.x + r.w) return r.href
		}
	}
	return null
}

const MARKS = Object.freeze({ bold: '**', italic: '*', strike: '~~' })

/**
 * The editor's B, I and S: puts a mark pair around the selection, takes it
 * away when the selection already stands in one (inside or right outside),
 * inserts an empty pair with the caret in it without a selection.
 *
 * @param {string} value text
 * @param {number} start selection start
 * @param {number} end selection end
 * @param {'bold'|'italic'|'strike'} kind mark
 * @return {{value: string, start: number, end: number}} new text and selection
 */
export function toggleMarks(value, start, end, kind) {
	const m = MARKS[kind]
	const v = String(value ?? '')
	let a = Math.max(0, Math.min(start, end, v.length))
	let b = Math.max(a, Math.min(Math.max(start, end), v.length))
	// a selection with spaces at its ends: the marks go around the words
	while (a < b && /\s/.test(v[a])) a++
	while (b > a && /\s/.test(v[b - 1])) b--
	const sel = v.slice(a, b)
	const n = m.length
	const wrapped = (s) => s.length >= 2 * n && s.startsWith(m) && s.endsWith(m) && (kind !== 'italic' || !(s.startsWith('**') && !s.startsWith('***')))
	if (sel !== '' && wrapped(sel)) {
		const inner = sel.slice(n, sel.length - n)
		return { value: v.slice(0, a) + inner + v.slice(b), start: a, end: a + inner.length }
	}
	const before = v.slice(a - n, a)
	const after = v.slice(b, b + n)
	const outside = before === m && after === m && (kind !== 'italic' || (v[a - n - 1] !== '*' && v[b + n] !== '*') || (v.slice(a - 3, a) === '***' && v.slice(b, b + 3) === '***'))
	if (outside) {
		return { value: v.slice(0, a - n) + sel + v.slice(b + n), start: a - n, end: b - n }
	}
	return { value: v.slice(0, a) + m + sel + m + v.slice(b), start: a + n, end: b + n }
}

/**
 * The editor's list button: every line the selection touches starts with
 * "- " → they lose it; else the lines without it get it.
 *
 * @param {string} value text
 * @param {number} start selection start
 * @param {number} end selection end
 * @return {{value: string, start: number, end: number}}
 */
export function toggleList(value, start, end) {
	const v = String(value ?? '')
	const a = Math.max(0, Math.min(start, end, v.length))
	const b = Math.max(a, Math.min(Math.max(start, end), v.length))
	const from = v.lastIndexOf('\n', a - 1) + 1
	let to = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b)
	if (to < 0) to = v.length
	const lines = v.slice(from, to).split('\n')
	const all = lines.every((l) => l.startsWith('- '))
	const edits = []
	let pos = from
	const next = lines.map((l) => {
		let out = l
		if (all) {
			out = l.slice(2)
			edits.push({ pos, d: -2 })
		} else if (!l.startsWith('- ')) {
			out = '- ' + l
			edits.push({ pos, d: 2 })
		}
		pos += l.length + 1
		return out
	})
	// a position moves with the prefixes added or taken away before it
	const map = (p) => {
		let q = p
		for (const ed of edits) {
			if (ed.d > 0 && p >= ed.pos) q += ed.d
			else if (ed.d < 0) q -= Math.min(2, Math.max(0, p - ed.pos))
		}
		return q
	}
	const s = map(a)
	const e = Math.max(s, map(b))
	return { value: v.slice(0, from) + next.join('\n') + v.slice(to), start: s, end: e }
}

