/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The picture of an own shape (factory job 203), the mirror of
 * lib/Service/ShapeImage.php (a node test reads its constants).
 *
 * A picture is a data URI data:image/<png|jpeg|gif|webp|svg+xml>;base64,…
 * of at most IMAGE_MAX characters, base64 with padding (length a multiple of
 * 4). An SVG decodes to a text with "<svg" and without a script or
 * foreignObject element (any prefix, any case): pictures are only ever drawn
 * as images (canvas, <img>, SVG <image>), where neither runs, but a
 * foreignObject would taint the canvas of the PNG export on Safari.
 *
 * On the board a shape of kind 'image' carries it in data.img as a list of
 * 1–IMAGE_CHUNKS strings of 1–IMAGE_CHUNK characters (the generic string
 * limit of the sync, Limits::MAX_STRING, stays as it is); the picture is
 * their concatenation. A library entry carries it as one string.
 */

/** Characters of a picture's data URI (48 KiB). */
export const IMAGE_MAX = 49152
/** Characters of one piece of data.img (Limits::MAX_STRING). */
export const IMAGE_CHUNK = 6000
/** Pieces of data.img. */
export const IMAGE_CHUNKS = Math.ceil(IMAGE_MAX / IMAGE_CHUNK)

const URI_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/
const SVG_BAD_RE = /<([A-Za-z_][\w.-]*:)?(script|foreignobject)\b/i

/**
 * @param {string} b64 base64
 * @return {string|null} the decoded bytes as a binary string, null when it does not decode
 */
function decode(b64) {
	try {
		return atob(b64)
	} catch (e) {
		return null
	}
}

/**
 * @param {unknown} uri value
 * @return {boolean} a picture by the rule of the file comment
 */
export function isImageUri(uri) {
	if (typeof uri !== 'string' || uri.length > IMAGE_MAX) return false
	const m = URI_RE.exec(uri)
	if (!m || m[2].length % 4 !== 0) return false
	if (m[1] !== 'svg+xml') return true
	const text = decode(m[2])
	return text !== null && /<svg/i.test(text) && !SVG_BAD_RE.test(text)
}

/**
 * @param {unknown} v data.img
 * @return {string|null} the picture of a valid piece list, else null
 */
export function joinImage(v) {
	if (!Array.isArray(v) || v.length === 0 || v.length > IMAGE_CHUNKS) return null
	for (const s of v) {
		if (typeof s !== 'string' || s.length === 0 || s.length > IMAGE_CHUNK) return null
	}
	const uri = v.join('')
	return isImageUri(uri) ? uri : null
}

/**
 * @param {string} uri a picture
 * @return {string[]} its pieces for data.img
 */
export function splitImage(uri) {
	const out = []
	for (let i = 0; i < uri.length; i += IMAGE_CHUNK) out.push(uri.slice(i, i + IMAGE_CHUNK))
	return out
}

/**
 * @param {string} uri a picture
 * @return {string} its media type (image/png …)
 */
export function imageType(uri) {
	const m = /^data:([^;,]+)/.exec(uri)
	return m ? m[1] : ''
}

/** Longer side of a new own shape without a dragged box (the size of a new symbol). */
export const PICTURE_SIDE = 96
/** Most proportions of a new own shape (long side : short side). */
export const PICTURE_RATIO_MAX = 8

/**
 * The box of a new own shape: the proportions of its library entry (at most
 * PICTURE_RATIO_MAX : 1), the longer side PICTURE_SIDE.
 *
 * @param {unknown} w the entry's width
 * @param {unknown} h the entry's height
 * @return {{w: number, h: number}} the box (a square for anything unreadable)
 */
export function pictureSize(w, h) {
	if (!(typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) {
		return { w: PICTURE_SIDE, h: PICTURE_SIDE }
	}
	const r = Math.min(PICTURE_RATIO_MAX, Math.max(1 / PICTURE_RATIO_MAX, w / h))
	return r >= 1
		? { w: PICTURE_SIDE, h: Math.round(PICTURE_SIDE / r * 100) / 100 }
		: { w: Math.round(PICTURE_SIDE * r * 100) / 100, h: PICTURE_SIDE }
}

/**
 * @param {unknown} p a picture to place, {uri, w, h} (shapes panel, shape tool)
 * @return {{uri: string, w: number, h: number}|null} p when its uri is a picture and w, h are positive numbers
 */
export function placeablePicture(p) {
	if (!p || typeof p !== 'object' || !isImageUri(p.uri)) return null
	const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
	return ok(p.w) && ok(p.h) ? { uri: p.uri, w: p.w, h: p.h } : null
}
