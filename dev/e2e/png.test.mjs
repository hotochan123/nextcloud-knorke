/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of the PNG reader of E67 (lib/png.mjs, factory job 178), no
 * browser: images written here (RGBA and RGB, every row filter, two IDAT
 * chunks) read back pixel for pixel; a file without the signature and an
 * unsupported form are refused.
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { PNG_SIGNATURE, decodePng, isPng, pixelIs, pngHeader } from './lib/png.mjs'

/** @return {Buffer} one chunk (CRC left 0: the reader does not check it) */
function chunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
}

/**
 * Writes a PNG with the given rows, each row with its own filter.
 *
 * @param {number} w width
 * @param {number} h height
 * @param {number} bpp 3 (RGB) or 4 (RGBA)
 * @param {(x: number, y: number) => number[]} at the pixel
 * @param {number[]} filters filter per row (0–4)
 * @return {Buffer}
 */
function writePng(w, h, bpp, at, filters) {
	const stride = w * bpp
	const px = Buffer.alloc(h * stride)
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) at(x, y).slice(0, bpp).forEach((v, i) => { px[y * stride + x * bpp + i] = v })
	const paeth = (a, b, c) => {
		const p = a + b - c
		const pa = Math.abs(p - a)
		const pb = Math.abs(p - b)
		const pc = Math.abs(p - c)
		return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
	}
	const raw = []
	for (let y = 0; y < h; y++) {
		const f = filters[y % filters.length]
		raw.push(f)
		for (let i = 0; i < stride; i++) {
			const v = px[y * stride + i]
			const a = i >= bpp ? px[y * stride + i - bpp] : 0
			const b = y > 0 ? px[(y - 1) * stride + i] : 0
			const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0
			const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]
			raw.push((v - pred) & 0xff)
		}
	}
	const z = zlib.deflateSync(Buffer.from(raw))
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8
	ihdr[9] = bpp === 4 ? 6 : 2
	const half = Math.floor(z.length / 2)
	return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, half)), chunk('IDAT', z.subarray(half)), chunk('IEND', Buffer.alloc(0))])
}

const colour = (x, y) => [(x * 37 + y * 11) & 0xff, (x * 5 + y * 71) & 0xff, (x * 113 + y) & 0xff, (x + y * 3) & 0xff]

test('png: RGBA and RGB with every row filter and two IDAT chunks read back pixel for pixel', () => {
	for (const bpp of [4, 3]) {
		const buf = writePng(7, 10, bpp, colour, [0, 1, 2, 3, 4])
		assert.equal(isPng(buf), true)
		assert.deepEqual(pngHeader(buf), { width: 7, height: 10, depth: 8, color: bpp === 4 ? 6 : 2, interlace: 0 })
		const img = decodePng(buf)
		assert.deepEqual([img.width, img.height], [7, 10])
		for (let y = 0; y < 10; y++) {
			for (let x = 0; x < 7; x++) {
				const want = colour(x, y)
				assert.deepEqual(img.pixel(x, y), bpp === 4 ? want : [...want.slice(0, 3), 255], `${bpp} ${x},${y}`)
			}
		}
		assert.deepEqual(img.pixel(-5, 99), img.pixel(0, 9), 'clamped to the image')
	}
})

test('png: pixelIs compares opaque colours with a tolerance; a file without the signature and other forms are refused', () => {
	assert.equal(pixelIs([255, 214, 165, 255], '#ffd6a5'), true)
	assert.equal(pixelIs([253, 216, 163, 255], '#ffd6a5'), true)
	assert.equal(pixelIs([250, 214, 165, 255], '#ffd6a5'), false)
	assert.equal(pixelIs([255, 214, 165, 100], '#ffd6a5'), false, 'not opaque')
	assert.equal(isPng(Buffer.from('GIF89a......')), false)
	assert.throws(() => pngHeader(Buffer.from('not a png file')), /keine PNG-Signatur/)
	const grey = writePng(2, 2, 4, colour, [0])
	grey[8 + 8 + 8] = 16
	assert.throws(() => decodePng(grey), /nicht unterstützt/)
})
