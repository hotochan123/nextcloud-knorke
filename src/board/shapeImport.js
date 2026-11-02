/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Import of own shape libraries (factory job 203), pure: the files a person
 * picked become one library {name, entries: [{name, img, w, h}], skipped}.
 * No DOM: the files are read as text with regular expressions, so node
 * tests run the same code as the browser.
 *
 * - An SVG file (.svg, or text whose first element is <svg>) is one entry:
 *   its text as a base64 data URI, its name the file name without the
 *   extension, its proportions from width/height of the root, else its
 *   viewBox, else a square.
 * - A draw.io library (<mxlibrary>[…JSON…]</mxlibrary>, XML entities
 *   decoded) gives an entry per element that is a picture: one with `data`
 *   (a data URI of a picture), or one with `xml` (plain, or compressed:
 *   base64 → raw deflate → URI-encoded) whose model has exactly one vertex
 *   with image=data:image/<type>,<data> in its style (draw.io drops the
 *   ";base64" there, the ";" separates the style's keys). Its name is the
 *   title, else the library's name and its number; its proportions w and h.
 *   Elements made of shapes are skipped.
 * - Every picture goes through model/shapeImage.js isImageUri (type, size,
 *   no script or foreignObject); one that fails is skipped. A data URI that
 *   is not base64 (an SVG as text) becomes base64 first.
 * - (Job 210) A PNG or JPEG of a draw.io element over IMAGE_MAX is drawn
 *   smaller until it fits (shrinkPicture: the same type, at most
 *   SHRINK_TRIES sizes, the long side from SHRINK_MAX_SIDE down to
 *   SHRINK_MIN_SIDE); only one that still does not fit is skipped. The entry
 *   keeps the library's w and h. Drawing needs a browser (openPicture, passed
 *   in like inflate); elsewhere such a picture is skipped as before.
 * - At most LIB_ENTRIES_MAX entries and LIB_MAX_BYTES of request body
 *   (JSON): the entries beyond are skipped. skipped counts every element or
 *   file that gave no entry.
 * The name of the library: the file name of the one draw.io library picked
 * alone, else the fallback (the caller's "My shapes"); at most NAME_MAX
 * characters. Names of entries: white space collapsed, at most NAME_MAX
 * characters, never empty.
 *
 * The limits are lib/Service/ShapeLibStore.php's (a node test compares the
 * numbers).
 */
import { IMAGE_MAX, imageType, isImageUri } from '../model/shapeImage.js'

/** Own libraries per account. */
export const LIB_OWN_MAX = 20
/** Open suggestions per account. */
export const LIB_PENDING_MAX = 10
/** Entries of one library. */
export const LIB_ENTRIES_MAX = 300
/** Request body of a new library (4 MiB). */
export const LIB_MAX_BYTES = 4194304
/** Characters of a name (library or entry). */
export const NAME_MAX = 100
/** Characters of the note to the admins. */
export const NOTE_MAX = 200
/** Largest width or height of an entry. */
export const SIDE_MAX = 4000
/** Proportions of an entry without any. */
const SIDE_DEFAULT = 96
/** (Job 210) Longest side of a picture drawn smaller. */
export const SHRINK_MAX_SIDE = 1024
/** (Job 210) Shortest long side of a picture drawn smaller (unless its own is shorter). */
export const SHRINK_MIN_SIDE = 32
/** (Job 210) Sizes tried per picture. */
export const SHRINK_TRIES = 6
/** (Job 210) Most pixels of a picture that is drawn smaller (a guard against huge declared sizes). */
export const SHRINK_MAX_PIXELS = 25000000
/** (Job 210) Quality of a JPEG drawn smaller. */
const JPEG_QUALITY = 0.85
/** (Job 210) A PNG or JPEG that may be drawn smaller. */
const SHRINKABLE_RE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/

const TYPES = Object.freeze({ png: 'png', jpeg: 'jpeg', jpg: 'jpeg', gif: 'gif', webp: 'webp', 'svg+xml': 'svg+xml' })
const ENTITIES = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })

/**
 * @param {string} s XML text
 * @return {string} with its entities decoded
 */
export function decodeXml(s) {
	return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (all, e) => {
		if (e[0] === '#') {
			const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
			return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
		}
		return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : all
	})
}

/**
 * @param {Uint8Array} bytes bytes
 * @return {string} base64
 */
function bytesToBase64(bytes) {
	let bin = ''
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(bin)
}

/**
 * @param {string} text text
 * @return {string} its UTF-8 bytes as base64
 */
export function textToBase64(text) {
	return bytesToBase64(new TextEncoder().encode(text))
}

/**
 * A data URI of a known picture type as base64, its size and content not checked.
 *
 * @param {unknown} raw data:image/<type>[;params],<data>
 * @param {boolean} [base64] the data is base64 even without ";base64" (a draw.io style)
 * @return {string|null}
 */
function base64Uri(raw, base64 = false) {
	if (typeof raw !== 'string') return null
	const m = /^data:image\/([a-z+.-]+)((?:;[^,;]*)*),([\s\S]*)$/i.exec(raw.trim())
	const type = m ? TYPES[m[1].toLowerCase()] : null
	if (!type) return null
	let data = m[3]
	if (base64 || /;base64(;|$)/i.test(m[2])) {
		data = data.replace(/\s+/g, '')
		// URL-safe base64 and missing padding, as some tools write it
		data = data.replace(/-/g, '+').replace(/_/g, '/')
		while (data.length % 4 !== 0) data += '='
	} else if (type === 'svg+xml') {
		try {
			data = textToBase64(decodeURIComponent(data))
		} catch (e) {
			return null
		}
	} else {
		return null
	}
	return `data:image/${type};base64,${data}`
}

/**
 * A picture as a base64 data URI of a known type, or null.
 *
 * @param {unknown} raw data:image/<type>[;params],<data>
 * @param {boolean} [base64] the data is base64 even without ";base64" (a draw.io style)
 * @return {string|null}
 */
export function pictureUri(raw, base64 = false) {
	const uri = base64Uri(raw, base64)
	return uri !== null && uri.length <= IMAGE_MAX && isImageUri(uri) ? uri : null
}

/**
 * (Job 210) Default picture opener: the data URI loaded into an Image (its
 * size known on load), drawn onto a canvas of its own per size. Null outside
 * a browser, for a picture that does not load, and for one over
 * SHRINK_MAX_PIXELS (never drawn).
 *
 * @param {string} uri a PNG or JPEG data URI
 * @return {Promise<{w: number, h: number, encode: (w: number, h: number) => string|null}|null>}
 */
export async function openPicture(uri) {
	if (typeof Image !== 'function' || typeof document === 'undefined') return null
	const img = new Image()
	const loaded = await new Promise((resolve) => {
		img.onload = () => resolve(true)
		img.onerror = () => resolve(false)
		img.src = uri
	})
	const w = img.naturalWidth
	const h = img.naturalHeight
	if (!loaded || !(w > 0 && h > 0) || w * h > SHRINK_MAX_PIXELS) return null
	const type = imageType(uri)
	return {
		w,
		h,
		encode(cw, ch) {
			const canvas = document.createElement('canvas')
			try {
				canvas.width = cw
				canvas.height = ch
				const ctx = canvas.getContext('2d')
				if (!ctx) return null
				ctx.imageSmoothingEnabled = true
				ctx.imageSmoothingQuality = 'high'
				ctx.drawImage(img, 0, 0, cw, ch)
				return canvas.toDataURL(type, type === 'image/jpeg' ? JPEG_QUALITY : undefined)
			} catch (e) {
				return null
			} finally {
				// Safari keeps a canvas' memory until its size is 0
				canvas.width = 0
				canvas.height = 0
			}
		},
	}
}

/**
 * (Job 210) A PNG or JPEG over IMAGE_MAX drawn smaller until it fits.
 *
 * The first long side is the picture's scaled by 0.9 · √(IMAGE_MAX / length
 * of the URI), at most SHRINK_MAX_SIDE; each further try takes 0.7 of the one
 * before, at most SHRINK_TRIES tries and never below SHRINK_MIN_SIDE (or the
 * picture's own long side when that is shorter, so a small picture in a large
 * file is drawn once at its own size).
 *
 * @param {string} uri a base64 data URI
 * @param {(uri: string) => Promise<{w: number, h: number, encode: (w: number, h: number) => string|null}|null>} [open] picture opener
 * @return {Promise<string|null>} a picture of the same type within IMAGE_MAX; null for anything else
 */
export async function shrinkPicture(uri, open = openPicture) {
	const m = typeof uri === 'string' && uri.length > IMAGE_MAX ? SHRINKABLE_RE.exec(uri) : null
	if (!m || m[2].length % 4 !== 0) return null
	const pic = await open(uri)
	if (!pic || !(pic.w > 0 && pic.h > 0)) return null
	const type = imageType(uri)
	const long = Math.max(pic.w, pic.h)
	const floor = Math.min(SHRINK_MIN_SIDE, long)
	let side = Math.max(floor, Math.min(SHRINK_MAX_SIDE, Math.floor(long * Math.min(1, 0.9 * Math.sqrt(IMAGE_MAX / uri.length)))))
	for (let i = 0; i < SHRINK_TRIES && side >= floor; i++) {
		const k = side / long
		const out = pictureUri(pic.encode(Math.max(1, Math.round(pic.w * k)), Math.max(1, Math.round(pic.h * k))))
		if (out !== null && imageType(out) === type) return out
		side = Math.floor(side * 0.7)
	}
	return null
}

/**
 * (Job 210) The picture of a draw.io element: as pictureUri, but a PNG or JPEG
 * over IMAGE_MAX is drawn smaller (shrinkPicture).
 *
 * @param {unknown} raw data:image/<type>[;params],<data>
 * @param {boolean} base64 the data is base64 even without ";base64" (a draw.io style)
 * @param {Function} open picture opener
 * @return {Promise<string|null>}
 */
async function fitPicture(raw, base64, open) {
	const uri = base64Uri(raw, base64)
	if (uri === null) return null
	if (uri.length <= IMAGE_MAX) return isImageUri(uri) ? uri : null
	return shrinkPicture(uri, open)
}

/**
 * @param {unknown} v name
 * @param {string} fallback name without one
 * @return {string} collapsed, at most NAME_MAX characters, never empty
 */
export function cleanName(v, fallback) {
	// eslint-disable-next-line no-control-regex
	const s = (typeof v === 'string' ? v : '').replace(/<[^>]*>/g, ' ').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()
	const out = Array.from(s || fallback).slice(0, NAME_MAX).join('').trim()
	return out || Array.from(fallback).slice(0, NAME_MAX).join('')
}

/**
 * @param {unknown} v a size
 * @return {number|null} a number in [1, SIDE_MAX] (clamped), null for anything else
 */
function side(v) {
	const n = typeof v === 'string' ? parseFloat(v) : v
	return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(SIDE_MAX, Math.max(1, Math.round(n * 100) / 100)) : null
}

/**
 * @param {string} name file name
 * @return {string} without its extension
 */
export function baseName(name) {
	const s = String(name ?? '').replace(/^.*[\\/]/, '')
	const dot = s.lastIndexOf('.')
	return dot > 0 ? s.slice(0, dot) : s
}

/**
 * @param {string} text an XML text
 * @return {string} without its prolog, comments, doctype and processing instructions at the start
 */
function stripProlog(text) {
	let s = text.replace(/^﻿/, '')
	for (;;) {
		const t = s.trimStart()
		const m = /^(<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>)/i.exec(t)
		if (!m) return t
		s = t.slice(m[0].length)
	}
}

/**
 * @param {string} tag the text of a start tag
 * @param {string} name attribute name
 * @return {string|null} its value
 */
function attr(tag, name) {
	const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
	return m ? decodeXml(m[2] ?? m[3]) : null
}

/**
 * One SVG file as an entry.
 *
 * @param {string} name file name
 * @param {string} text its content
 * @return {{name: string, img: string, w: number, h: number}|null} null when it is no usable SVG
 */
export function svgEntry(name, text) {
	const body = stripProlog(String(text ?? ''))
	const m = /^<svg\b[^>]*>/i.exec(body)
	if (!m) return null
	const img = pictureUri('data:image/svg+xml;base64,' + textToBase64(String(text)))
	if (!img) return null
	const tag = m[0]
	let w = /%/.test(attr(tag, 'width') ?? '') ? null : side(attr(tag, 'width'))
	let h = /%/.test(attr(tag, 'height') ?? '') ? null : side(attr(tag, 'height'))
	if (w === null || h === null) {
		const vb = (attr(tag, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
		if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
			w = side(vb[2])
			h = side(vb[3])
		}
	}
	// without both sides: a square
	const both = w !== null && h !== null
	return { name: cleanName(baseName(name), 'Shape'), img, w: both ? w : SIDE_DEFAULT, h: both ? h : SIDE_DEFAULT }
}

/**
 * Default inflate: raw deflate through the browser's DecompressionStream.
 *
 * @param {Uint8Array} bytes compressed
 * @return {Promise<Uint8Array|null>} inflated, null where the browser cannot
 */
async function inflateRaw(bytes) {
	if (typeof DecompressionStream !== 'function') return null
	try {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
		return new Uint8Array(await new Response(stream).arrayBuffer())
	} catch (e) {
		return null
	}
}

/**
 * The graph model of a draw.io element's xml.
 *
 * @param {string} xml plain or compressed
 * @param {(bytes: Uint8Array) => Promise<Uint8Array|null>} inflate raw inflate
 * @return {Promise<string|null>}
 */
async function graphOf(xml, inflate) {
	const s = xml.trim()
	if (s.startsWith('<')) return s
	try {
		const bin = atob(s.replace(/\s+/g, ''))
		const out = await inflate(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
		if (!out) return null
		return decodeURIComponent(new TextDecoder().decode(out))
	} catch (e) {
		return null
	}
}

/**
 * The picture of a graph model with exactly one vertex whose style has image=data:….
 *
 * @param {string} graph mxGraphModel XML
 * @return {string|null} the style's image value, not checked yet
 */
function graphPicture(graph) {
	const cells = graph.match(/<mxCell\b[^>]*>/g) ?? []
	const vertices = cells.filter((c) => attr(c, 'vertex') === '1')
	if (vertices.length !== 1) return null
	const style = attr(vertices[0], 'style') ?? ''
	for (const part of style.split(';')) {
		const eq = part.indexOf('=')
		if (eq > 0 && part.slice(0, eq).trim() === 'image') return part.slice(eq + 1).trim()
	}
	return null
}

/**
 * The elements of a draw.io library file as entries.
 *
 * @param {string} name file name
 * @param {string} text its content
 * @param {(bytes: Uint8Array) => Promise<Uint8Array|null>} [inflate] raw inflate
 * @param {Function} [open] picture opener of shrinkPicture
 * @return {Promise<{entries: Array<{name: string, img: string, w: number, h: number}>, skipped: number}|null>}
 *   null when the text is no draw.io library
 */
export async function drawioEntries(name, text, inflate = inflateRaw, open = openPicture) {
	const m = /<mxlibrary\b[^>]*>([\s\S]*)<\/mxlibrary>/i.exec(String(text ?? ''))
	if (!m) return null
	let list
	try {
		list = JSON.parse(decodeXml(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')))
	} catch (e) {
		return null
	}
	if (!Array.isArray(list)) return null
	const lib = cleanName(baseName(name), 'Shape')
	const entries = []
	let skipped = 0
	for (let i = 0; i < list.length; i++) {
		const e = list[i]
		let img = null
		if (e && typeof e === 'object') {
			if (typeof e.data === 'string') img = await fitPicture(e.data, false, open)
			else if (typeof e.xml === 'string') {
				const graph = await graphOf(e.xml, inflate)
				const raw = graph ? graphPicture(graph) : null
				img = raw !== null ? await fitPicture(raw, true, open) : null
			}
		}
		if (!img) {
			skipped++
			continue
		}
		entries.push({ name: cleanName(e.title, `${lib} ${i + 1}`), img, w: side(e.w) ?? SIDE_DEFAULT, h: side(e.h) ?? SIDE_DEFAULT })
	}
	return { entries, skipped }
}

/**
 * @param {{name: string, entries: object[]}} lib a library
 * @return {number} bytes of its request body (route 47)
 */
export function bodyBytes(lib) {
	return new TextEncoder().encode(JSON.stringify({ name: lib.name, entries: lib.entries })).length
}

/**
 * The picked files as one library (see the file comment).
 *
 * @param {Array<{name: string, text: string}>} files the picked files, read as text
 * @param {string} fallback the library's name unless one draw.io library is picked alone
 * @param {(bytes: Uint8Array) => Promise<Uint8Array|null>} [inflate] raw inflate
 * @param {Function} [open] picture opener of shrinkPicture
 * @return {Promise<{name: string, entries: Array<{name: string, img: string, w: number, h: number}>, skipped: number}>}
 */
export async function importShapes(files, fallback, inflate = inflateRaw, open = openPicture) {
	const entries = []
	let skipped = 0
	let drawio = 0
	for (const f of files) {
		const lib = /<mxlibrary\b/i.test(f.text) ? await drawioEntries(f.name, f.text, inflate, open) : null
		if (lib) {
			drawio++
			entries.push(...lib.entries)
			skipped += lib.skipped
			continue
		}
		const e = svgEntry(f.name, f.text)
		if (e) entries.push(e)
		else skipped++
	}
	const name = cleanName(files.length === 1 && drawio === 1 ? baseName(files[0].name) : fallback, fallback)
	const kept = entries.slice(0, LIB_ENTRIES_MAX)
	skipped += entries.length - kept.length
	// the body stays within LIB_MAX_BYTES: entries from the end go first
	const size = (list) => bodyBytes({ name, entries: list })
	let bytes = size(kept)
	while (kept.length > 0 && bytes > LIB_MAX_BYTES) {
		const e = kept.pop()
		skipped++
		bytes -= new TextEncoder().encode(JSON.stringify(e)).length + 1
	}
	return { name, entries: kept, skipped }
}
