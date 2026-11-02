/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Save as PDF" (factory job 200): the commands of a VectorContext
 * (scene/vectorContext.js) as a PDF 1.4 file of one page, written here
 * without a library.
 *
 * - The page is the frame at PDF_PT_PER_UNIT pt per world unit (one CSS px
 *   at 96 dpi); when a side would exceed PDF_MAX_SIDE pt, everything is
 *   scaled down evenly until it fits (pdfScale). One matrix maps world units
 *   (y down) onto the page (y up); the frame is filled with the background.
 * - (Job 207) Or the page is A4 or A3 (PDF_PAGES), portrait, landscape when
 *   the frame is wider than high: the frame is fitted inside PDF_PAGE_MARGIN
 *   on every side, larger or smaller, and centred; the whole page is filled
 *   with the background first (pdfPage). The images below keep their
 *   pixels per pt when the content is enlarged.
 * - A path is drawn in world units: rg/RG colours, the alpha through an
 *   ExtGState (ca/CA), line width, caps, joins, miter limit and dashes; a
 *   clip chain is the paths with W n inside q … Q. A gradient becomes a
 *   shading (type 2 linear, type 3 radial; Function type 2, or type 3 over
 *   several stops) under the matrix it was filled with, clipped to the path
 *   (a gradient of one colour: the path filled in it); its alpha, when the
 *   stops differ in it (the note shadows), a luminosity soft mask with the
 *   same geometry in grey. A shading is written once per geometry and stops. A gradient stroke or text
 *   takes the colour of its first stop.
 * - Text is set in the standard fonts Helvetica, -Bold, -Oblique,
 *   -BoldOblique (from the canvas font) with WinAnsiEncoding, at the size of
 *   the font. textPieces splits a text into words and into runs that
 *   WinAnsi can or cannot encode (whole graphemes); each piece stands at the
 *   x the browser measures for the text before it, so the text keeps the
 *   layout the board shows even where the browser's font is not Arial
 *   (Android). A run WinAnsi cannot encode (emoji, Greek, Cyrillic, CJK, ł,
 *   č …), and a whole text with a right-to-left script, becomes an image
 *   (RGB plus an alpha soft mask) from opts.rasterize at its place:
 *   PDF_RASTER_SCALE px per unit, at most PDF_RASTER_MAX_SIDE px per side,
 *   all of them together at most PDF_RASTER_BUDGET px (else at an evenly
 *   lower resolution). Control characters are left out.
 * - (Job 203) The picture of an own shape becomes an image (RGB plus an
 *   alpha soft mask) from opts.rasterizeImage, stretched over its box under
 *   its matrix, at the resolution of the text images (PDF_RASTER_SCALE px
 *   per unit, at most PDF_RASTER_MAX_SIDE px per side), sharing their
 *   budget; no image from there (not decoded): nothing is drawn.
 * - Streams are deflated (FlateDecode) when opts.deflate gives bytes (by
 *   default CompressionStream('deflate') where the browser has it), else
 *   stored as they are. The file ends with a cross-reference table and a
 *   trailer; its Info holds only /Producer (Knorke).
 */
import { EXPORT_BACKGROUND, PDF_PAGE_KEYS } from './exportImage.js'
import { num } from './exportSvg.js'
import { parseColor } from './vectorContext.js'

/** Points per world unit (1 CSS px at 96 dpi). */
export const PDF_PT_PER_UNIT = 0.75
/** Longest side of a page (pt), the limit of common PDF readers. */
export const PDF_MAX_SIDE = 14400
/** (Job 207) Paper sizes (pt, portrait): A4 210 × 297 mm, A3 297 × 420 mm. */
export const PDF_PAGES = Object.freeze({ a4: Object.freeze([595.276, 841.89]), a3: Object.freeze([841.89, 1190.551]) })
/** (Job 207) The page sizes of "Save as PDF…" (job 217: kept in exportImage.js, which the start loads). */
export { PDF_PAGE_KEYS }
/** (Job 207) White border of a paper page on every side (pt, 10 mm). */
export const PDF_PAGE_MARGIN = 28.346
/** Pixels per world unit of a text run drawn as an image. */
export const PDF_RASTER_SCALE = 4
/** Longest side of one such image (px). */
export const PDF_RASTER_MAX_SIDE = 2048
/** All such images together (px). */
export const PDF_RASTER_BUDGET = 2 ** 25

/** WinAnsiEncoding of the code points 0x80–0x9F it places elsewhere. */
const WIN_ANSI_HIGH = new Map([
	[0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
	[0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91],
	[0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98],
	[0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
])

/** Characters of right-to-left scripts (Hebrew to Arabic presentation forms). */
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/

/**
 * @param {number} cp a code point
 * @return {number} its WinAnsi byte; -1 when WinAnsi has none; -2 for a control character (left out)
 */
export function winAnsi(cp) {
	if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) return -2
	if (cp <= 0x7E || (cp >= 0xA0 && cp <= 0xFF)) return cp
	return WIN_ANSI_HIGH.get(cp) ?? -1
}

/**
 * @param {string} s text
 * @return {string[]} its grapheme clusters (code points where Intl.Segmenter is missing)
 */
function graphemes(s) {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (g) => g.segment)
	}
	return Array.from(s)
}

/**
 * @typedef {{kind: 'text'|'raster', start: number, str: string, bytes: number[]}} TextPiece
 *   start: UTF-16 index in the text; bytes: WinAnsi (text pieces)
 */

/**
 * The pieces of a text (see the file comment): words (a word keeps the
 * spaces after it) of encodable graphemes, and runs of graphemes WinAnsi
 * cannot encode.
 *
 * @param {string} s text
 * @return {TextPiece[]}
 */
export function textPieces(s) {
	const out = []
	let cur = null
	let at = 0
	for (const g of graphemes(String(s))) {
		const start = at
		at += g.length
		const bytes = []
		let kind = 'text'
		for (const ch of g) {
			const b = winAnsi(ch.codePointAt(0))
			if (b === -1) {
				kind = 'raster'
				break
			}
			if (b >= 0) bytes.push(b)
		}
		if (kind === 'text' && bytes.length === 0) {
			// only control characters: nothing to draw, the next piece starts after them
			cur = null
			continue
		}
		const space = /^\s+$/u.test(g)
		const split = !cur || cur.kind !== kind || (kind === 'text' && cur.spaceEnd && !space)
		if (split) {
			cur = { kind, start, str: '', bytes: [], spaceEnd: false }
			out.push(cur)
		}
		cur.str += g
		if (kind === 'text') cur.bytes.push(...bytes)
		cur.spaceEnd = space
	}
	return out.map(({ kind, start, str, bytes }) => ({ kind, start, str, bytes }))
}

/**
 * @param {number[]} bytes WinAnsi bytes
 * @return {string} a PDF literal string, ASCII only
 */
export function pdfString(bytes) {
	let out = '('
	for (const b of bytes) {
		if (b === 0x28 || b === 0x29 || b === 0x5C) out += '\\' + String.fromCharCode(b)
		else if (b < 0x20 || b > 0x7E) out += '\\' + b.toString(8).padStart(3, '0')
		else out += String.fromCharCode(b)
	}
	return out + ')'
}

/**
 * @param {{w:number, h:number}} frame the drawn world rectangle
 * @return {number} pt per world unit: PDF_PT_PER_UNIT, less when a side would exceed PDF_MAX_SIDE
 */
export function pdfScale(frame) {
	const side = Math.max(frame.w, frame.h)
	return side * PDF_PT_PER_UNIT > PDF_MAX_SIDE ? PDF_MAX_SIDE / side : PDF_PT_PER_UNIT
}

/**
 * (Job 207) The page of an export (see the file comment).
 *
 * @param {{x:number, y:number, w:number, h:number}} frame the drawn world rectangle
 * @param {string} [page] a PDF_PAGE_KEYS key; any other value: 'content'
 * @return {{W: number, H: number, k: number, ox: number, oy: number, tx: number, ty: number, paper: boolean}}
 *   the page W × H pt, k pt per unit, the frame's top left corner ox, oy pt from the page's; tx, ty the offset
 *   of the matrix k 0 0 -k tx ty from world units onto the page; paper: an A4 or A3 page
 */
export function pdfPage(frame, page = 'content') {
	const size = Object.hasOwn(PDF_PAGES, page) ? PDF_PAGES[page] : null
	if (!size) {
		const k = pdfScale(frame)
		const W = Math.round(frame.w * k * 1000) / 1000
		const H = Math.round(frame.h * k * 1000) / 1000
		return { W, H, k, ox: 0, oy: 0, tx: -frame.x * k, ty: (frame.y + frame.h) * k, paper: false }
	}
	const [W, H] = frame.w > frame.h ? [size[1], size[0]] : size
	const k = Math.min((W - 2 * PDF_PAGE_MARGIN) / Math.max(frame.w, 1e-6), (H - 2 * PDF_PAGE_MARGIN) / Math.max(frame.h, 1e-6))
	const ox = (W - frame.w * k) / 2
	const oy = (H - frame.h * k) / 2
	return { W, H, k, ox, oy, tx: ox - frame.x * k, ty: H - oy + frame.y * k, paper: true }
}

/**
 * @param {Uint8Array} bytes data
 * @return {Promise<Uint8Array|null>} zlib-deflated, null without CompressionStream
 */
export async function deflateStream(bytes) {
	if (typeof CompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') return null
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * @param {string} s text of chars 0–255
 * @return {Uint8Array} its bytes
 */
function latin1(s) {
	const out = new Uint8Array(s.length)
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF
	return out
}

/**
 * @param {number[]} rgb [r, g, b] 0–255
 * @return {string} three PDF numbers 0–1
 */
function rgbOps(rgb) {
	return rgb.map((v) => num(v / 255)).join(' ')
}

/**
 * (Job 207) A number of the matrix of a paper page: a huge board fitted onto
 * A4 has a scale far below 1/1000, which num would round to 0.
 *
 * @param {number} n number
 * @return {string} n with 6 significant digits (at least 3 decimals), never an exponent
 */
function fine(n) {
	if (!Number.isFinite(n) || n === 0) return '0'
	const s = n.toFixed(Math.min(12, Math.max(3, 5 - Math.floor(Math.log10(Math.abs(n)))))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
	return s === '-0' ? '0' : s
}

/**
 * @param {Array} d device path
 * @return {string} its PDF path operators
 */
function pathOps(d) {
	const out = []
	for (const s of d) {
		if (s[0] === 'M') out.push(`${num(s[1])} ${num(s[2])} m`)
		else if (s[0] === 'L') out.push(`${num(s[1])} ${num(s[2])} l`)
		else if (s[0] === 'C') out.push(`${s.slice(1).map(num).join(' ')} c`)
		else out.push('h')
	}
	return out.join('\n')
}

/**
 * @param {Array} d device path
 * @return {number[]} its control box [x0, y0, x1, y1]
 */
function pathBox(d) {
	const b = [Infinity, Infinity, -Infinity, -Infinity]
	for (const s of d) {
		for (let i = 1; i + 1 < s.length; i += 2) {
			b[0] = Math.min(b[0], s[i])
			b[1] = Math.min(b[1], s[i + 1])
			b[2] = Math.max(b[2], s[i])
			b[3] = Math.max(b[3], s[i + 1])
		}
	}
	return b
}

/**
 * @param {number[]} m matrix
 * @return {string} its cm operator
 */
function cm(m) {
	return `${m.map(num).join(' ')} cm`
}

/** Font resource per [bold, italic]. */
const FONTS = Object.freeze({ '00': 'Helvetica', '10': 'Helvetica-Bold', '01': 'Helvetica-Oblique', '11': 'Helvetica-BoldOblique' })

/**
 * A PDF function over gradient stops (see the file comment).
 *
 * @param {{t:number}[]} stops sorted stops
 * @param {(s: object) => number[]} value the components of a stop
 * @return {string} a function dictionary
 */
function stopFunction(stops, value) {
	const s = stops.slice()
	if (s[0].t > 0) s.unshift({ ...s[0], t: 0 })
	if (s[s.length - 1].t < 1) s.push({ ...s[s.length - 1], t: 1 })
	if (s.length === 1) s.push({ ...s[0], t: 1 })
	const two = (a, b) => `<< /FunctionType 2 /Domain [0 1] /C0 [${value(a).map(num).join(' ')}] /C1 [${value(b).map(num).join(' ')}] /N 1 >>`
	if (s.length === 2) return two(s[0], s[1])
	const fns = []
	for (let i = 0; i + 1 < s.length; i++) fns.push(two(s[i], s[i + 1]))
	const bounds = s.slice(1, -1).map((x) => num(x.t)).join(' ')
	const encode = fns.map(() => '0 1').join(' ')
	return `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${bounds}] /Encode [${encode}] >>`
}

/**
 * The PDF file of an export (see the file comment).
 *
 * @param {Array} ops VectorContext commands
 * @param {{x:number, y:number, w:number, h:number}} frame the drawn world rectangle (exportLayout's frame)
 * @param {object} [opts] what the writer needs from outside
 * @param {(font: string, text: string) => {width: number}} [opts.measure] the browser's width of text in a canvas font
 * @param {(font: string, text: string, color: string, px: number) => ({width: number, height: number,
 *   data: Uint8ClampedArray, top: number, left?: number}|null)} [opts.rasterize] text drawn at px per unit; top: units from the
 *   baseline up to the image's top edge; left: units from the run's x to its left edge (default 0)
 * @param {(src: string, width: number, height: number) => ({width: number, height: number, data: Uint8ClampedArray}|null)} [opts.rasterizeImage]
 *   (job 203) a picture drawn at width × height px
 * @param {((bytes: Uint8Array) => Promise<Uint8Array|null>)|null} [opts.deflate] zlib deflate; null: no compression
 * @param {string} [opts.background] colour of the page
 * @param {string} [opts.page] (job 207) a PDF_PAGE_KEYS key, default 'content' (pdfPage)
 * @return {Promise<{bytes: Uint8Array, width: number, height: number, scale: number}>} the file; the page in pt
 */
export async function pdfDocument(ops, frame, {
	measure = null,
	rasterize = null,
	rasterizeImage = null,
	deflate = deflateStream,
	background = EXPORT_BACKGROUND,
	page = 'content',
} = {}) {
	const { W, H, k, tx, ty, paper } = pdfPage(frame, page)
	const width = (font, s) => (s === '' ? 0 : (measure ? measure(font, s).width : 0))

	// objects: 1 catalog, 2 pages, 3 page, 4 contents, 5 info; the rest as they come
	const objects = [null, null, null, null, null]
	const add = (o) => {
		objects.push(o)
		return objects.length
	}
	const fonts = new Map()
	const states = new Map()
	const shadings = []
	const xobjects = []

	const fontRes = (bold, italic) => {
		const key = (bold ? '1' : '0') + (italic ? '1' : '0')
		if (!fonts.has(key)) {
			fonts.set(key, { name: 'F' + (fonts.size + 1), ref: add({ dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[key]} /Encoding /WinAnsiEncoding >>` }) })
		}
		return fonts.get(key).name
	}
	const alphaRes = (a) => {
		const v = num(Math.max(0, Math.min(1, a)))
		if (!states.has(v)) states.set(v, { name: 'A' + (states.size + 1), ref: add({ dict: `<< /Type /ExtGState /ca ${v} /CA ${v} >>` }) })
		return states.get(v).name
	}
	const shadingKeys = new Map()
	/** a shading per geometry and stops, shared (the note shadows of a board use two) */
	const shadingRes = (paint, gray) => {
		const key = JSON.stringify([gray, paint.kind, paint.coords, paint.stops, gray ? paint.a : 1])
		if (shadingKeys.has(key)) return shadingKeys.get(key)
		const c = paint.coords
		const type = paint.kind === 'linear' ? 2 : 3
		const fn = gray ? stopFunction(paint.stops, (s) => [s.a * paint.a]) : stopFunction(paint.stops, (s) => s.rgb.map((v) => v / 255))
		const ref = add({ dict: `<< /ShadingType ${type} /ColorSpace /${gray ? 'DeviceGray' : 'DeviceRGB'} /Coords [${c.map(num).join(' ')}] /Function ${fn} /Extend [true true] >>` })
		const res = { name: 'S' + (shadings.length + 1), ref }
		shadings.push(res)
		shadingKeys.set(key, res)
		return res
	}
	const imageRes = async (img) => {
		const n = img.width * img.height
		const rgb = new Uint8Array(n * 3)
		const alpha = new Uint8Array(n)
		let opaque = true
		for (let i = 0; i < n; i++) {
			rgb[3 * i] = img.data[4 * i]
			rgb[3 * i + 1] = img.data[4 * i + 1]
			rgb[3 * i + 2] = img.data[4 * i + 2]
			alpha[i] = img.data[4 * i + 3]
			if (alpha[i] !== 255) opaque = false
		}
		const head = `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8`
		const mask = opaque ? '' : ` /SMask ${add({ stream: alpha, dict: `${head} /ColorSpace /DeviceGray` })} 0 R`
		const ref = add({ stream: rgb, dict: `${head} /ColorSpace /DeviceRGB${mask}` })
		const name = 'I' + (xobjects.length + 1)
		xobjects.push({ name, ref })
		return name
	}

	// text pieces first: the images of runs WinAnsi cannot encode share one budget
	const texts = new Map()
	let area = 0
	for (const op of ops) {
		if (op.op === 'image') {
			// job 203: a picture's size on the page in units
			area += Math.hypot(op.m[0], op.m[1]) * op.w * Math.hypot(op.m[2], op.m[3]) * op.h
			continue
		}
		if (op.op !== 'text') continue
		const whole = RTL.test(op.text)
		const pieces = whole ? [{ kind: 'raster', start: 0, str: op.text, bytes: [] }] : textPieces(op.text)
		for (const p of pieces) {
			p.dx = width(op.font, op.text.slice(0, p.start))
			if (p.kind === 'raster') {
				p.w = width(op.font, p.str)
				area += Math.max(1, p.w) * op.size * 1.5
			}
		}
		texts.set(op, pieces)
	}
	// job 207: enlarged onto paper, the images keep their pixels per pt
	const rasterScale = Math.min(PDF_RASTER_SCALE * Math.max(1, k / PDF_PT_PER_UNIT), Math.sqrt(PDF_RASTER_BUDGET / Math.max(1, area)))

	const out = []
	const bg = parseColor(background) ?? { rgb: [255, 255, 255], a: 1 }
	if (paper) {
		out.push(`${rgbOps(bg.rgb)} rg 0 0 ${num(W)} ${num(H)} re f`, `${fine(k)} 0 0 ${fine(-k)} ${fine(tx)} ${fine(ty)} cm`)
	} else {
		out.push(`${num(k)} 0 0 ${num(-k)} ${num(tx)} ${num(ty)} cm`)
	}
	out.push(`${rgbOps(bg.rgb)} rg ${num(frame.x)} ${num(frame.y)} ${num(frame.w)} ${num(frame.h)} re f`)

	let openClip = null
	const useClip = (chain) => {
		if (chain === openClip) return
		if (openClip) out.push('Q')
		openClip = null
		if (chain && chain.length > 0) {
			out.push('q')
			for (const c of chain) out.push(pathOps(c.d), c.rule === 'evenodd' ? 'W* n' : 'W n')
			openClip = chain
		}
	}
	const solid = (paint) => (paint.kind === 'color' ? paint : { kind: 'color', rgb: paint.stops[0].rgb, a: paint.stops[0].a * paint.a })
	const strokeOps = (s) => {
		const p = solid(s.paint)
		const cap = { butt: 0, round: 1, square: 2 }[s.cap] ?? 0
		const join = { miter: 0, round: 1, bevel: 2 }[s.join] ?? 0
		const dash = s.dash.length > 0 && s.dash.some((v) => v > 0) ? `[${s.dash.map(num).join(' ')}] ${num(s.offset)} d` : '[] 0 d'
		return `/${alphaRes(p.a)} gs ${rgbOps(p.rgb)} RG ${num(s.width)} w ${cap} J ${join} j ${num(s.miter)} M ${dash}`
	}

	for (const op of ops) {
		if (op.op === 'path') {
			useClip(op.clip)
			const d = pathOps(op.d)
			const even = op.rule === 'evenodd'
			if (op.fill && op.fill.kind === 'color') {
				out.push('q', `/${alphaRes(op.fill.a)} gs ${rgbOps(op.fill.rgb)} rg`, d, even ? 'f*' : 'f', 'Q')
			} else if (op.fill) {
				const p = op.fill
				const alphas = p.stops.map((s) => s.a * p.a)
				// one colour (the shadows): the path in that colour under the alpha
				const rgb = p.stops.every((x) => x.rgb.join() === p.stops[0].rgb.join()) ? p.stops[0].rgb : null
				const color = rgb ? null : shadingRes(p, false)
				out.push('q', d, even ? 'W* n' : 'W n')
				if (alphas.every((a) => a === alphas[0])) {
					out.push(`/${alphaRes(alphas[0])} gs`)
				} else {
					const mask = shadingRes(p, true)
					const box = pathBox(op.d)
					const form = add({
						stream: latin1(`${cm(p.m)}\n/${mask.name} sh`),
						dict: `/Type /XObject /Subtype /Form /BBox [${box.map(num).join(' ')}] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Shading << /${mask.name} ${mask.ref} 0 R >> >>`,
					})
					const gs = add({ dict: `<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R >> >>` })
					const name = 'M' + (states.size + 1)
					states.set('mask' + gs, { name, ref: gs })
					out.push(`/${name} gs`)
				}
				if (color) out.push(cm(p.m), `/${color.name} sh`, 'Q')
				else out.push(`${rgbOps(rgb)} rg`, d, even ? 'f*' : 'f', 'Q')
			}
			if (op.stroke) {
				out.push('q', strokeOps(op.stroke), d, 'S', 'Q')
			}
		} else if (op.op === 'image') {
			if (!rasterizeImage) continue
			const sx = Math.hypot(op.m[0], op.m[1]) * op.w
			const sy = Math.hypot(op.m[2], op.m[3]) * op.h
			const px = Math.min(rasterScale, PDF_RASTER_MAX_SIDE / Math.max(1, sx), PDF_RASTER_MAX_SIDE / Math.max(1, sy))
			const img = rasterizeImage(op.src, Math.max(1, Math.round(sx * px)), Math.max(1, Math.round(sy * px)))
			if (!img || !(img.width > 0 && img.height > 0)) continue
			useClip(op.clip)
			const name = await imageRes(img)
			out.push('q', `/${alphaRes(op.alpha)} gs`, cm(op.m), `${num(op.w)} 0 0 ${num(-op.h)} ${num(op.x)} ${num(op.y + op.h)} cm`, `/${name} Do`, 'Q')
		} else if (op.op === 'text') {
			const pieces = texts.get(op) ?? []
			if (pieces.length === 0) continue
			useClip(op.clip)
			const font = fontRes(op.bold, op.italic)
			const paint = op.fill ? solid(op.fill) : solid(op.stroke.paint)
			out.push('q', cm(op.m), `1 0 0 -1 ${num(op.x)} ${num(op.y)} cm`)
			out.push(op.fill ? `/${alphaRes(paint.a)} gs ${rgbOps(paint.rgb)} rg` : strokeOps(op.stroke))
			for (const p of pieces) {
				if (p.kind === 'text') {
					out.push(`BT /${font} ${num(op.size)} Tf ${op.fill ? '' : '1 Tr '}${num(p.dx)} 0 Td ${pdfString(p.bytes)} Tj ET`)
					continue
				}
				if (!rasterize) continue
				const px = Math.min(rasterScale, PDF_RASTER_MAX_SIDE / Math.max(1, p.w), PDF_RASTER_MAX_SIDE / Math.max(1, op.size * 1.5))
				const css = `rgb(${paint.rgb.join(', ')})`
				const img = rasterize(op.font, p.str, css, px)
				if (!img || !(img.width > 0 && img.height > 0)) continue
				const name = await imageRes(img)
				const w = img.width / px
				const h = img.height / px
				out.push('q', `/${alphaRes(paint.a)} gs`, `${num(w)} 0 0 ${num(h)} ${num(p.dx + (img.left ?? 0))} ${num(img.top - h)} cm`, `/${name} Do`, 'Q')
			}
			out.push('Q')
		}
	}
	useClip(null)

	const res = (label, list) => (list.length > 0 ? ` /${label} << ${list.map((r) => `/${r.name} ${r.ref} 0 R`).join(' ')} >>` : '')
	objects[0] = { dict: '<< /Type /Catalog /Pages 2 0 R >>' }
	objects[1] = { dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' }
	objects[2] = {
		dict: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Contents 4 0 R /Group << /S /Transparency /CS /DeviceRGB >>`
			+ ` /Resources <<${res('Font', [...fonts.values()])}${res('ExtGState', [...states.values()])}${res('Shading', shadings)}${res('XObject', xobjects)} >> >>`,
	}
	objects[3] = { stream: latin1(out.join('\n')), dict: '' }
	objects[4] = { dict: '<< /Producer (Knorke) >>' }

	const chunks = []
	let size = 0
	const push = (b) => {
		chunks.push(b)
		size += b.length
	}
	push(latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'))
	const offsets = []
	for (let i = 0; i < objects.length; i++) {
		const o = objects[i]
		offsets.push(size)
		if (o.stream) {
			const packed = deflate ? await deflate(o.stream) : null
			const data = packed ?? o.stream
			push(latin1(`${i + 1} 0 obj\n<< ${o.dict}${o.dict ? ' ' : ''}/Length ${data.length}${packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`))
			push(data)
			push(latin1('\nendstream\nendobj\n'))
		} else {
			push(latin1(`${i + 1} 0 obj\n${o.dict}\nendobj\n`))
		}
	}
	const xref = size
	let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
	for (const off of offsets) table += String(off).padStart(10, '0') + ' 00000 n \n'
	table += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	push(latin1(table))

	const bytes = new Uint8Array(size)
	let at = 0
	for (const c of chunks) {
		bytes.set(c, at)
		at += c.length
	}
	return { bytes, width: W, height: H, scale: k }
}
