/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The board as an outline (factory job 274): pure functions, no DOM. The
 * outline comes only from the local model, so a person sees only what their
 * client already holds.
 *
 * boardOutline(model, frames) gives {sections: [{frame, title, items}]}:
 * - points: notes (sticky), text items and shapes whose data.text is not
 *   empty after trim(); the text trimmed, CRLF/CR as LF. Tables, mind maps,
 *   AI cards, pads, connectors and strokes are left out.
 * - a point belongs to its parent when that is a frame (exportCsv.js
 *   frameOf), else it is loose; frames never lie in frames.
 * - order: the frames in the reading order of their boxes, each with its
 *   points in reading order (arrangeActions.js readingOrder, as csvRowIds),
 *   every frame even without points; then one section with frame null for
 *   the loose points, only when there are any.
 * - titles: from `frames` (BoardSession.frames(): the trimmed title, an
 *   empty one as "Frame {n}").
 *
 * outlineText(outline, title) is the plain text of "Copy as text",
 * outlineMarkdown(outline, title, looseTitle) the Markdown of "Download as
 * Markdown" with every user text through mdEscape, so no text becomes HTML,
 * a link, a heading or a list item. A point is "- <text>", its further lines
 * indented by two spaces; sections apart by an empty line; LF line ends and
 * one at the end.
 * (Job 279) Points carry their text as typed: outlineText (and the view)
 * show it without Markdown marks (model/richText.js plainText),
 * outlineMarkdown keeps the marks and links it knows (mdKeep) and escapes
 * the rest as before.
 */
import { readingOrder } from './arrangeActions.js'
import { hasMarks, parseRich, plainText } from '../model/richText.js'

/** Types that give a point, all with their text in data.text. */
export const OUTLINE_TYPES = Object.freeze(['sticky', 'text', 'shape'])

/**
 * @param {unknown} s text
 * @return {string} trimmed, line ends as LF
 */
function clean(s) {
	return typeof s === 'string' ? s.replace(/\r\n?/g, '\n').trim() : ''
}

/**
 * @param {object} model SceneModel (ids, get, has, abs)
 * @param {string} id item
 * @return {string|null} its parent frame, null without one
 */
function frameOf(model, id) {
	const p = model.get(id)?.parent ?? null
	return typeof p === 'string' && model.has(p) && model.get(p)?.t === 'frame' ? p : null
}

/**
 * @param {object} model SceneModel
 * @param {{id: string, title: string}[]} frames the frames with their shown titles (BoardSession.frames())
 * @return {{sections: {frame: (string|null), title: string, items: {id: string, kind: string, text: string}[]}[]}}
 *   title is '' for the loose section (the view names it)
 */
export function boardOutline(model, frames) {
	if (!model) {
		return { sections: [] }
	}
	const titles = new Map((Array.isArray(frames) ? frames : []).map((f) => [f.id, f.title]))
	const groups = new Map()
	const frameIds = []
	const texts = new Map()
	for (const id of model.ids()) {
		const it = model.get(id)
		if (!it) {
			continue
		}
		if (it.t === 'frame') {
			frameIds.push(id)
			continue
		}
		if (!OUTLINE_TYPES.includes(it.t)) {
			continue
		}
		const text = clean(it.data?.text)
		if (text === '') {
			continue
		}
		texts.set(id, text)
		const f = frameOf(model, id)
		if (!groups.has(f)) {
			groups.set(f, [])
		}
		groups.get(f).push(id)
	}
	const order = (ids) => readingOrder(model, typeof model.sortByOrder === 'function' ? model.sortByOrder(ids) : ids)
	const points = (f) => order(groups.get(f) ?? []).map((id) => ({ id, kind: model.get(id).t, text: texts.get(id) }))
	const sections = order(frameIds).map((f) => ({
		frame: f,
		title: titles.get(f) ?? clean(model.get(f)?.data?.title),
		items: points(f),
	}))
	if (groups.has(null)) {
		sections.push({ frame: null, title: '', items: points(null) })
	}
	return { sections }
}

/**
 * Escapes a user text for Markdown: the characters that start markup get a
 * backslash, and at the start of a line a list or heading marker
 * ("1." "1)" "-" "+" "=") does too.
 *
 * @param {string} s user text
 * @return {string}
 */
export function mdEscape(s) {
	return String(s)
		.replace(/[\\`*_[\]<>#|~]/g, '\\$&')
		.split('\n')
		.map((l) => l.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3').replace(/^(\s*)([-+=])/, '$1\\$2'))
		.join('\n')
}

/**
 * @param {string} text the point's text
 * @return {string} "- <text>" with its further lines indented
 */
function point(text) {
	return '- ' + text.split('\n').map((l, i) => (i === 0 || l === '' ? l : '  ' + l)).join('\n')
}

/**
 * @param {{sections: object[]}} outline boardOutline
 * @param {string} title the board title
 * @param {(s: string) => string} esc user text → output
 * @param {(s: string, level: number) => string} head a heading line (level 1 the board, 2 a section)
 * @param {string} sep between a section's heading and its points
 * @param {string} looseTitle the name of the loose section, ready for output
 * @param {(s: string) => string} pt a point's text → output (job 279)
 * @return {string}
 */
function render(outline, title, esc, head, sep, looseTitle, pt) {
	const blocks = [head(esc(clean(title)), 1)]
	for (const s of outline?.sections ?? []) {
		const name = head(s.frame === null ? looseTitle : esc(s.title), 2)
		blocks.push(s.items.length === 0 ? name : name + sep + s.items.map((p) => point(pt(p.text))).join('\n'))
	}
	return blocks.join('\n\n') + '\n'
}

/**
 * "Copy as text": the board title, an empty line, then each section's title
 * with its points below, sections apart by an empty line. No escaping.
 *
 * @param {{sections: object[]}} outline boardOutline
 * @param {string} title the board title
 * @param {string} looseTitle the name of the loose section ("Not in a frame")
 * @return {string}
 */
export function outlineText(outline, title, looseTitle) {
	// job 279: points without their Markdown marks
	return render(outline, title, (s) => s, (s) => s, '\n', looseTitle, plainText)
}

/**
 * "Download as Markdown": "# <board title>", then "## <section>", an empty
 * line and its points; user text through mdEscape.
 *
 * @param {{sections: object[]}} outline boardOutline
 * @param {string} title the board title
 * @param {string} looseTitle the name of the loose section ("Not in a frame")
 * @return {string}
 */
export function outlineMarkdown(outline, title, looseTitle) {
	// job 279: points keep their Markdown marks (model/richText.js mdKeep), everything else is escaped
	return render(outline, title, mdEscape, (s, level) => '#'.repeat(level) + ' ' + s, '\n\n', mdEscape(looseTitle), (s) => mdKeep(s, mdEscape))
}
/**
 * (Job 279) A point's text with its Markdown marks kept: the marks
 * and allowed links model/richText.js knows stay as typed, every other piece goes
 * through esc (the outline's mdEscape), so nothing else becomes Markdown
 * or HTML.
 *
 * @param {string} text stored text
 * @param {(s: string) => string} esc escape of plain pieces
 * @return {string}
 */
export function mdKeep(text, esc) {
	if (!hasMarks(text)) return esc(text)
	return parseRich(text).lines.map((l) => {
		let out = l.list ? l.list.raw : ''
		const runs = l.runs
		const open = []
		const want = (r) => [r.lk >= 0 ? 'l' + r.lk : null, r.s ? 's' : null, r.b ? 'b' : null, r.i ? 'i' : null].filter(Boolean)
		const close = (m) => {
			if (m[0] === 'l') {
				const r = runs.find((x) => 'l' + x.lk === m)
				out += '](' + r.href.replace(/[()]/g, (c) => encodeURIComponent(c)) + ')'
			} else {
				out += MARK_OF[m]
			}
		}
		for (const [k, r] of runs.entries()) {
			if (r.lk >= 0 && r.text === r.href && !r.b && !r.i && !r.s && runs[k - 1]?.lk !== r.lk && runs[k + 1]?.lk !== r.lk) {
				// a bare address stays bare
				while (open.length > 0) close(open.pop())
				out += r.href
				continue
			}
			const w = want(r)
			// close down to the first mark this run does not have, then open what is missing
			let keep = 0
			while (keep < open.length && w.includes(open[keep])) keep++
			while (open.length > keep) close(open.pop())
			for (const m of w) {
				if (!open.includes(m)) {
					out += m[0] === 'l' ? '[' : MARK_OF[m]
					open.push(m)
				}
			}
			out += r.c ? '`' + r.text + '`' : r.text.replace(/[\\`*_[\]<>#|~]/g, '\\$&')
		}
		while (open.length > 0) close(open.pop())
		// a plain line must not turn into a list or heading by itself (as mdEscape)
		return l.list ? out : out.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3').replace(/^(\s*)([-+=])/, '$1\\$2')
	}).join('\n')
}

const MARK_OF = Object.freeze({ b: '**', i: '*', s: '~~' })
