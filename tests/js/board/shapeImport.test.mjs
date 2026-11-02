/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 203 (own shape libraries), the import (board/shapeImport.js)
 * and the picture rule (model/shapeImage.js):
 * - AK2 an SVG file (prolog, comment, doctype; proportions from the
 *   viewBox), a draw.io library with a `data` element, a compressed and a
 *   plain `xml` element of one picture (";base64" put back), an element
 *   made of shapes (skipped), a picture too large (skipped), an SVG data URI
 *   as text (made base64), a broken library and a text file (nothing),
 *   an SVG with a script (skipped); the library's name; at most 300
 *   entries and 4 MiB of body
 * - AK4 the limits equal lib/Service/ShapeLibStore.php and ShapeImage.php
 * - the picture rule: pieces, size, types, scripts with a prefix
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	LIB_ENTRIES_MAX, LIB_MAX_BYTES, LIB_OWN_MAX, LIB_PENDING_MAX, NAME_MAX, NOTE_MAX, SHRINK_MAX_PIXELS, SHRINK_MAX_SIDE, SHRINK_MIN_SIDE,
	SHRINK_TRIES, SIDE_MAX, bodyBytes, cleanName, drawioEntries, importShapes, openPicture, pictureUri, shrinkPicture, svgEntry,
} from '../../../src/board/shapeImport.js'
import { IMAGE_CHUNK, IMAGE_CHUNKS, IMAGE_MAX, isImageUri, joinImage, pictureSize, splitImage } from '../../../src/model/shapeImage.js'

const fixture = (name) => ({ name, text: readFileSync(new URL('../../fixtures/shapes/' + name, import.meta.url), 'utf8') })
const php = (file) => readFileSync(new URL('../../../lib/Service/' + file, import.meta.url), 'utf8')
const constant = (src, name) => Number(new RegExp(`public const ${name} = (\\d+);`).exec(src)?.[1])
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('job 203 AK2: the import', () => {
	test('an SVG file: one entry, base64, its file name, the proportions of its viewBox', () => {
		const e = svgEntry('icons/server.svg', fixture('server.svg').text)
		assert.equal(e.name, 'server')
		assert.deepEqual([e.w, e.h], [48, 24])
		assert.match(e.img, /^data:image\/svg\+xml;base64,/)
		assert.ok(isImageUri(e.img))
		assert.match(new TextDecoder().decode(Uint8Array.from(atob(e.img.split(',')[1]), (c) => c.charCodeAt(0))), /<text x="8" y="16">Ä<\/text>/, 'UTF-8 kept')
		assert.equal(svgEntry('script.svg', fixture('script.svg').text), null, 'a script: no picture')
		assert.equal(svgEntry('notes.txt', 'not a picture'), null)
		assert.deepEqual([svgEntry('w.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="50%"/>').w, svgEntry('w.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>').h], [96, 96],
			'a percentage or nothing: a square')
	})

	test('a draw.io library: data, compressed and plain xml pictures; shapes and too large skipped', async () => {
		const lib = await drawioEntries('AWS icons.xml', fixture('aws.xml').text)
		assert.deepEqual(lib.entries.map((e) => [e.name, e.w, e.h, e.img.slice(0, 26)]), [
			['EC2', 78, 78, 'data:image/png;base64,iVBO'],
			['Load balancer', 80, 40, 'data:image/svg+xml;base64,'],
			['AWS icons 3', 50, 50, 'data:image/png;base64,iVBO'],
			['Plain SVG', 4, 4, 'data:image/svg+xml;base64,'],
		])
		assert.equal(lib.skipped, 2, 'the two boxes and the picture over 48 KiB')
		assert.ok(lib.entries.every((e) => isImageUri(e.img)))
		assert.equal(await drawioEntries('broken.xml', fixture('broken.xml').text), null)
		assert.equal(await drawioEntries('x.xml', '<mxfile/>'), null)
		const noInflate = await drawioEntries('AWS icons.xml', fixture('aws.xml').text, async () => null)
		assert.equal(noInflate.entries.length, 3, 'a browser without raw inflate skips the compressed element')
	})

	test('importShapes: one library of every picked file; its name; skipped counted', async () => {
		const one = await importShapes([fixture('aws.xml')], 'My shapes')
		assert.deepEqual([one.name, one.entries.length, one.skipped], ['aws', 4, 2])
		const many = await importShapes([fixture('server.svg'), fixture('aws.xml'), fixture('script.svg'), fixture('notes.txt'), fixture('broken.xml')], 'My shapes')
		assert.equal(many.name, 'My shapes')
		assert.equal(many.entries.length, 5)
		assert.equal(many.skipped, 2 + 3, 'the script, the text file and the broken library too')
		assert.deepEqual((await importShapes([], 'Meine Formen')).entries, [])
	})

	test('at most 300 entries and 4 MiB of body: the rest is skipped', async () => {
		const svg = (i) => ({ name: `s${i}.svg`, text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${i + 1} 1"/>` })
		const r = await importShapes(Array.from({ length: 305 }, (_, i) => svg(i)), 'Many')
		assert.deepEqual([r.entries.length, r.skipped], [LIB_ENTRIES_MAX, 5])
		const big = 'A'.repeat(IMAGE_MAX - 100)
		const files = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}.svg`, text: `<svg xmlns="http://www.w3.org/2000/svg"><desc>${big.slice(0, 36000)}</desc></svg>` }))
		const b = await importShapes(files, 'Big')
		assert.ok(bodyBytes(b) <= LIB_MAX_BYTES, String(bodyBytes(b)))
		assert.equal(b.entries.length + b.skipped, 100)
		assert.ok(b.skipped > 0)
	})

	test('names and pictures: cleaned, never empty; a data URI as text becomes base64', () => {
		assert.equal(cleanName('  a\n\tb <i>c</i> ', 'x'), 'a b c')
		assert.equal(cleanName('', 'Fallback'), 'Fallback')
		assert.equal(Array.from(cleanName('é'.repeat(150), 'x')).length, NAME_MAX)
		assert.equal(pictureUri(PNG), PNG)
		assert.equal(pictureUri('data:image/jpg;base64,AAAA'), 'data:image/jpeg;base64,AAAA')
		assert.equal(pictureUri('data:image/png;charset=x;base64, AAA A '), 'data:image/png;base64,AAAA')
		assert.equal(pictureUri('data:image/png,AAAA'), null, 'a raster picture as text is none')
		assert.equal(pictureUri('data:image/png,AAAA', true), 'data:image/png;base64,AAAA', 'the draw.io style form')
		assert.equal(pictureUri('data:text/html;base64,AAAA'), null)
		assert.equal(pictureUri('https://example.org/a.png'), null)
		assert.match(pictureUri('data:image/svg+xml;utf8,' + encodeURIComponent('<svg/>')), /^data:image\/svg\+xml;base64,PHN2Zy8\+$/)
	})
})

describe('job 203 AK4: the limits are the server\'s', () => {
	test('shapeImport.js and shapeImage.js equal ShapeLibStore.php and ShapeImage.php', () => {
		const store = php('ShapeLibStore.php')
		assert.equal(LIB_OWN_MAX, constant(store, 'OWN_MAX'))
		assert.equal(LIB_PENDING_MAX, constant(store, 'PENDING_MAX'))
		assert.equal(LIB_ENTRIES_MAX, constant(store, 'ENTRIES_MAX'))
		assert.equal(LIB_MAX_BYTES, constant(store, 'MAX_BODY_BYTES'))
		assert.equal(NAME_MAX, constant(store, 'NAME_MAX'))
		assert.equal(NOTE_MAX, constant(store, 'NOTE_MAX'))
		assert.equal(SIDE_MAX, constant(store, 'SIDE_MAX'))
		const image = php('ShapeImage.php')
		assert.equal(IMAGE_MAX, constant(image, 'MAX'))
		assert.equal(IMAGE_CHUNK, constant(image, 'CHUNK'))
		assert.equal(IMAGE_CHUNKS, constant(image, 'CHUNKS'))
		assert.equal(IMAGE_CHUNK, Number(/public const MAX_STRING = (\d+);/.exec(php('Limits.php'))[1]), 'the generic string limit of the sync')
	})
})

describe('job 203: the picture rule', () => {
	test('pieces, size, types and SVG content', () => {
		const svg = (t) => 'data:image/svg+xml;base64,' + btoa(t)
		assert.equal(joinImage(splitImage(PNG)), PNG)
		assert.equal(joinImage([PNG, '']), null)
		assert.equal(joinImage([]), null)
		assert.equal(joinImage(PNG), null)
		assert.equal(joinImage(Array(IMAGE_CHUNKS + 1).fill('AAAA')), null)
		assert.equal(isImageUri('data:image/png;base64,' + 'A'.repeat(IMAGE_MAX)), false)
		assert.equal(isImageUri(svg('<svg/>')), true)
		assert.equal(isImageUri(svg('<svg><svg:script/></svg>')), false, 'a script with a prefix')
		assert.equal(isImageUri(svg('<svg><foreignObject/></svg>')), false)
		assert.equal(isImageUri(svg('<p/>')), false)
		assert.deepEqual(pictureSize(300, 100), { w: 96, h: 32 })
		assert.deepEqual(pictureSize(1, 100), { w: 12, h: 96 }, 'at most 1 : 8')
		assert.deepEqual(pictureSize(NaN, 1), { w: 96, h: 96 })
	})
})

/*
 * Factory job 210 (shrink large pictures at import), with a fake picture
 * opener whose encode gives a data URI that grows with the pixels:
 * - AK1 shrinkPicture: the first size by its formula (at most 1024), the
 *   proportions kept, the same type, the try that fits, at most 6 tries and
 *   never below 32, an opener without a picture
 * - AK2 the opener is not asked for a small PNG, an SVG, a GIF or a WebP
 *   over 48 KiB or broken base64
 * - AK3 drawioEntries / importShapes: a large PNG (data) and JPEG (an xml
 *   style without ";base64") drawn smaller with the library's names and
 *   sizes, a large SVG skipped
 * - risks: openPicture in a fake browser (the size guard, the canvas set
 *   back to 0, JPEG quality) and without one
 */
const imageTypeOf = (uri) => /^data:image\/([^;]+);/.exec(uri)?.[1]
const uriOf = (type, chars) => `data:image/${type};base64,` + 'A'.repeat(Math.max(4, Math.ceil(chars / 4) * 4))
/** A fake opener: a picture w × h whose encoding takes perPixel characters per pixel. */
function fakeOpen(w, h, perPixel, { type = null, calls = [] } = {}) {
	const opened = []
	const open = async (uri) => {
		opened.push(uri)
		return { w, h, encode: (cw, ch) => { calls.push([cw, ch]); return uriOf(type ?? /^data:image\/(\w+)/.exec(uri)[1], Math.min(cw * ch * perPixel, 2 * IMAGE_MAX)) } }
	}
	return { open, calls, opened }
}

describe('job 210 AK1: shrinkPicture', () => {
	test('a PNG of 2000 × 1000: the first size by the formula, 2 : 1, a PNG within 48 KiB', async () => {
		const uri = uriOf('png', 200000)
		const f = fakeOpen(2000, 1000, 0.1)
		const out = await shrinkPicture(uri, f.open)
		const side = Math.min(SHRINK_MAX_SIDE, Math.floor(2000 * Math.min(1, 0.9 * Math.sqrt(IMAGE_MAX / uri.length))))
		assert.deepEqual(f.calls, [[side, side / 2]])
		assert.match(out, /^data:image\/png;base64,/)
		assert.ok(out.length <= IMAGE_MAX && isImageUri(out))
		const capped = fakeOpen(4000, 4000, 0.001)
		await shrinkPicture(uriOf('png', 60000), capped.open)
		assert.deepEqual(capped.calls, [[SHRINK_MAX_SIDE, SHRINK_MAX_SIDE]], 'at most 1024 on the long side')
	})

	test('a JPEG stays a JPEG; the first try that fits wins; another type does not count', async () => {
		const f = fakeOpen(1000, 1000, 0.4)
		const out = await shrinkPicture(uriOf('jpeg', 100000), f.open)
		assert.match(out, /^data:image\/jpeg;base64,/)
		assert.equal(f.calls.length, 3, String(f.calls))
		assert.ok(f.calls[1][0] * f.calls[1][1] * 0.4 > IMAGE_MAX && f.calls[2][0] * f.calls[2][1] * 0.4 < IMAGE_MAX - 30, String(f.calls))
		assert.deepEqual(f.calls.map((c) => c[0]), [f.calls[0][0], Math.floor(f.calls[0][0] * 0.7), Math.floor(Math.floor(f.calls[0][0] * 0.7) * 0.7)])
		const png = fakeOpen(1000, 1000, 0.001, { type: 'png' })
		assert.equal(await shrinkPicture(uriOf('jpeg', 100000), png.open), null, 'a browser that gives a PNG for a JPEG: skipped')
		assert.equal(png.calls.length, SHRINK_TRIES)
	})

	test('never fits: null after at most 6 tries, never below 32; no picture: null', async () => {
		const f = fakeOpen(3000, 1500, 100)
		assert.equal(await shrinkPicture(uriOf('png', 5000000), f.open), null)
		assert.ok(f.calls.length >= 1 && f.calls.length <= SHRINK_TRIES, String(f.calls))
		assert.ok(f.calls.every(([w, h]) => Math.max(w, h) >= SHRINK_MIN_SIDE), String(f.calls))
		const all = fakeOpen(3000, 1500, 100000)
		assert.equal(await shrinkPicture(uriOf('png', 60000), all.open), null)
		assert.equal(all.calls.length, SHRINK_TRIES)
		assert.equal(await shrinkPicture(uriOf('png', 60000), async () => null), null)
		assert.equal(await shrinkPicture(uriOf('png', 60000), async () => ({ w: 0, h: 10, encode: () => PNG })), null)
		const broken = fakeOpen(800, 800, 0.001)
		broken.open = async () => ({ w: 800, h: 800, encode: () => 'data:,' })
		assert.equal(await shrinkPicture(uriOf('png', 60000), broken.open), null, 'a canvas without an encoding: skipped')
	})

	test('a small picture with a large file is drawn at its own size at least once', async () => {
		const f = fakeOpen(20, 10, 0.1)
		const out = await shrinkPicture(uriOf('png', 60000), f.open)
		assert.deepEqual(f.calls, [[20, 10]])
		assert.ok(isImageUri(out))
		const g = fakeOpen(40, 40, 0.1)
		await shrinkPicture(uriOf('png', 200000), g.open)
		assert.deepEqual(g.calls, [[32, 32]], 'the first try never below 32')
	})
})

describe('job 210 AK2: what is never drawn smaller', () => {
	test('a small PNG, an SVG, a GIF, a WebP over 48 KiB and broken base64 do not reach the opener', async () => {
		const f = fakeOpen(500, 500, 0.01)
		assert.equal(await shrinkPicture(PNG, f.open), null)
		for (const t of ['gif', 'webp', 'svg+xml']) assert.equal(await shrinkPicture(uriOf(t, 60000), f.open), null, t)
		assert.equal(await shrinkPicture('data:image/png;base64,' + '*'.repeat(60000), f.open), null)
		assert.equal(await shrinkPicture('data:image/png;base64,' + 'A'.repeat(60001), f.open), null, 'length not a multiple of 4')
		const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
		const list = [
			{ data: PNG, w: 1, h: 1, title: 'Small' },
			{ data: 'data:image/svg+xml;base64,' + btoa('<svg>' + ' '.repeat(60000) + '</svg>'), w: 2, h: 2, title: 'Big SVG' },
			{ data: uriOf('gif', 60000), w: 2, h: 2, title: 'Big GIF' },
			{ data: uriOf('webp', 60000), w: 2, h: 2, title: 'Big WebP' },
			{ data: 'data:image/png;base64,' + '*'.repeat(60000), w: 2, h: 2, title: 'Broken' },
		]
		const lib = await drawioEntries('x.xml', `<mxlibrary>${esc(JSON.stringify(list))}</mxlibrary>`, undefined, f.open)
		assert.deepEqual([lib.entries.map((e) => e.name), lib.skipped], [['Small'], 4])
		assert.deepEqual(f.opened, [])
	})
})

describe('job 210 AK3: the import draws large PNG and JPEG smaller', () => {
	test('a data PNG and an xml JPEG drawn smaller with the library\'s names and sizes; a large SVG skipped', async () => {
		const graph = (img) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="2" style="shape=image;image=${img};" vertex="1" parent="0"/></root></mxGraphModel>`
		const jpeg = uriOf('jpeg', 90000).replace(';base64', '')
		const list = [
			{ data: uriOf('png', 120000), w: 60, h: 30, title: 'Big PNG' },
			{ xml: graph(jpeg), w: 40, h: 80, title: 'Big JPEG' },
			{ data: 'data:image/svg+xml;base64,' + btoa('<svg>' + ' '.repeat(60000) + '</svg>'), w: 2, h: 2, title: 'Big SVG' },
		]
		const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
		const text = `<mxlibrary>${esc(JSON.stringify(list))}</mxlibrary>`
		const f = fakeOpen(1200, 600, 0.1)
		const lib = await drawioEntries('Big.xml', text, undefined, f.open)
		assert.deepEqual(lib.entries.map((e) => [e.name, e.w, e.h, imageTypeOf(e.img)]), [['Big PNG', 60, 30, 'png'], ['Big JPEG', 40, 80, 'jpeg']])
		assert.ok(lib.entries.every((e) => e.img.length <= IMAGE_MAX && isImageUri(e.img)))
		assert.equal(lib.skipped, 1)
		const all = await importShapes([{ name: 'Big.xml', text }, fixture('server.svg')], 'My shapes', undefined, f.open)
		assert.deepEqual([all.entries.length, all.skipped], [3, 1])
		const node = await importShapes([{ name: 'Big.xml', text }], 'My shapes')
		assert.deepEqual([node.entries.length, node.skipped], [0, 3], 'without a browser (node) skipped as before')
	})
})

describe('job 210 risks: openPicture', () => {
	test('without a browser: null', async () => {
		assert.equal(await openPicture(uriOf('png', 60000)), null)
	})

	test('in a fake browser: its size, a canvas per size set back to 0, JPEG quality 0.85, the pixel guard, a failed load', async () => {
		const saved = { Image: globalThis.Image, document: globalThis.document }
		const canvases = []
		let size = [600, 300]
		let fail = false
		globalThis.Image = class {
			set src(v) {
				this.naturalWidth = fail ? 0 : size[0]
				this.naturalHeight = fail ? 0 : size[1]
				queueMicrotask(() => (fail ? this.onerror() : this.onload()))
			}
		}
		globalThis.document = {
			createElement(tag) {
				assert.equal(tag, 'canvas')
				const c = {
					width: 300,
					height: 150,
					drawn: null,
					getContext: () => ({ drawImage: (img, x, y, w, h) => { c.drawn = [x, y, w, h, c.width, c.height] } }),
					toDataURL: (type, q) => { c.args = [type, q]; return uriOf(type.slice(6), 400) },
				}
				canvases.push(c)
				return c
			},
		}
		try {
			const pic = await openPicture(uriOf('jpeg', 60000))
			assert.deepEqual([pic.w, pic.h], [600, 300])
			assert.match(pic.encode(200, 100), /^data:image\/jpeg;base64,/)
			assert.deepEqual([canvases[0].drawn, canvases[0].args, canvases[0].width, canvases[0].height], [[0, 0, 200, 100, 200, 100], ['image/jpeg', 0.85], 0, 0])
			const png = await openPicture(uriOf('png', 60000))
			png.encode(10, 5)
			assert.deepEqual(canvases[1].args, ['image/png', undefined])
			size = [5001, 5000]
			assert.equal(await openPicture(uriOf('png', 60000)), null, 'over 25 million pixels: never drawn')
			size = [5000, 5000]
			assert.ok(await openPicture(uriOf('png', 60000)))
			fail = true
			assert.equal(await openPicture(uriOf('png', 60000)), null, 'a picture that does not load')
			fail = false
			const thrower = await openPicture(uriOf('png', 60000))
			canvases.length = 0
			globalThis.document.createElement = () => { const c = { width: 0, height: 0, getContext: () => ({ drawImage() { throw new Error('too large') } }) }; canvases.push(c); return c }
			assert.equal(thrower.encode(10, 10), null)
			assert.deepEqual([canvases[0].width, canvases[0].height], [0, 0])
			assert.equal(SHRINK_MAX_PIXELS, 25000000)
		} finally {
			globalThis.Image = saved.Image
			globalThis.document = saved.document
		}
	})
})
