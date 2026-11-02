/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A small PNG reader for the image export case (E67, factory job 178), no
 * dependency beyond node:zlib: the signature, IHDR (width, height, bit
 * depth, colour type) and the pixels of a non-interlaced 8-bit RGB or RGBA
 * image (what a browser's canvas.toBlob('image/png') writes), with the five
 * row filters of the PNG standard (None, Sub, Up, Average, Paeth).
 * dev/e2e/png.test.mjs pins it with images written here in Node.
 */
import zlib from 'node:zlib'

/** The 8 bytes every PNG starts with. */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * @param {Buffer} buf file bytes
 * @return {boolean} the file starts with the PNG signature
 */
export function isPng(buf) {
	return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)
}

/**
 * @param {Buffer} buf file bytes
 * @return {Array<{type: string, data: Buffer}>} the chunks in file order (no CRC check)
 */
function chunksOf(buf) {
	const out = []
	let at = 8
	while (at + 8 <= buf.length) {
		const len = buf.readUInt32BE(at)
		const type = buf.toString('latin1', at + 4, at + 8)
		out.push({ type, data: buf.subarray(at + 8, at + 8 + len) })
		at += 12 + len
		if (type === 'IEND') break
	}
	return out
}

/**
 * @param {Buffer} buf file bytes
 * @return {{width: number, height: number, depth: number, color: number, interlace: number}} IHDR
 * @throws {Error} without the signature or IHDR
 */
export function pngHeader(buf) {
	if (!isPng(buf)) throw new Error('keine PNG-Signatur')
	const ihdr = chunksOf(buf)[0]
	if (!ihdr || ihdr.type !== 'IHDR' || ihdr.data.length < 13) throw new Error('kein IHDR am Anfang')
	const d = ihdr.data
	return { width: d.readUInt32BE(0), height: d.readUInt32BE(4), depth: d[8], color: d[9], interlace: d[12] }
}

/** @return {number} the Paeth predictor of a, b, c */
function paeth(a, b, c) {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Decodes a PNG (8-bit RGB or RGBA, not interlaced).
 *
 * @param {Buffer} buf file bytes
 * @return {{width: number, height: number, pixel: (x: number, y: number) => number[]}} pixel: [r, g, b, a]
 * @throws {Error} for anything else
 */
export function decodePng(buf) {
	const h = pngHeader(buf)
	if (h.depth !== 8 || (h.color !== 2 && h.color !== 6) || h.interlace !== 0) {
		throw new Error(`PNG-Form nicht unterstützt (Tiefe ${h.depth}, Farbtyp ${h.color}, Interlace ${h.interlace})`)
	}
	const bpp = h.color === 6 ? 4 : 3
	const raw = zlib.inflateSync(Buffer.concat(chunksOf(buf).filter((c) => c.type === 'IDAT').map((c) => c.data)))
	const stride = h.width * bpp
	if (raw.length < h.height * (stride + 1)) throw new Error(`IDAT zu kurz: ${raw.length} < ${h.height * (stride + 1)}`)
	const px = Buffer.alloc(h.height * stride)
	for (let y = 0; y < h.height; y++) {
		const f = raw[y * (stride + 1)]
		const src = y * (stride + 1) + 1
		const row = y * stride
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? px[row + i - bpp] : 0
			const b = y > 0 ? px[row - stride + i] : 0
			const c = i >= bpp && y > 0 ? px[row - stride + i - bpp] : 0
			const v = raw[src + i]
			let out
			if (f === 0) out = v
			else if (f === 1) out = v + a
			else if (f === 2) out = v + b
			else if (f === 3) out = v + ((a + b) >> 1)
			else if (f === 4) out = v + paeth(a, b, c)
			else throw new Error(`unbekannter Zeilenfilter ${f} in Zeile ${y}`)
			px[row + i] = out & 0xff
		}
	}
	return {
		width: h.width,
		height: h.height,
		pixel(x, y) {
			const xi = Math.min(h.width - 1, Math.max(0, Math.floor(x)))
			const yi = Math.min(h.height - 1, Math.max(0, Math.floor(y)))
			const o = yi * stride + xi * bpp
			return bpp === 4 ? [px[o], px[o + 1], px[o + 2], px[o + 3]] : [px[o], px[o + 1], px[o + 2], 255]
		},
	}
}

/**
 * @param {number[]} p pixel [r, g, b, a]
 * @param {string} hex #rrggbb
 * @param {number} [tol] largest difference per channel
 * @return {boolean} the pixel is that colour, opaque
 */
export function pixelIs(p, hex, tol = 2) {
	const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
	return Array.isArray(p) && p[3] >= 250 && want.every((v, i) => Math.abs(p[i] - v) <= tol)
}
