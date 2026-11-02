/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 200 (AK5): "Save as PDF" (src/scene/exportPdf.js) for fixed
 * recordings of the VectorContext, read back with dev/e2e/lib/pdf.mjs:
 * - %PDF-1.4, %%EOF, every xref entry on its object, one page, MediaBox =
 *   frame · 0.75 pt (a 30000-unit frame scaled to 14400 pt)
 * - text in Helvetica (bold: Helvetica-Bold), WinAnsi bytes escaped, each
 *   word at its measured x; runs WinAnsi cannot encode as images with a
 *   soft mask (the rasteriser injected), one budget for all of them; a
 *   right-to-left text one image; control characters left out
 * - note shadows: one colour under a luminosity soft mask, shared shadings
 * - valid with and without compression (inflate in Node)
 * Factory job 207 (AK1, AK2): the page size (pdfPage): A4 and A3 portrait
 * or landscape by the frame's shape, fitted inside the margin and centred,
 * enlarged too; the content page as before, byte-equal; the images keep
 * their pixels per pt when the content is enlarged; huge and odd frames
 * stay finite.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VectorContext } from '../../../src/scene/vectorContext.js'
import { PDF_MAX_SIDE, PDF_PAGE_KEYS, PDF_PAGE_MARGIN, PDF_PAGES, PDF_PT_PER_UNIT, PDF_RASTER_BUDGET, PDF_RASTER_SCALE, pdfDocument, pdfPage, pdfScale, pdfString, textPieces, winAnsi } from '../../../src/scene/exportPdf.js'
import { paintShade } from '../../../src/scene/nodes/shade.js'
import { fontsOf, imagesOf, readPdf, shownStrings } from '../../../dev/e2e/lib/pdf.mjs'

const measure = (font, text) => ({ width: 10 * [...text].length, shift: 0 })
const FRAME = Object.freeze({ x: -16, y: -16, w: 432, h: 332 })
const FONT = 'normal normal 24px Arial, "Liberation Sans", Helvetica, sans-serif'

/**
 * @param {Array<[string, number, number]>} texts [text, x, y] to fill
 * @param {string} [font] canvas font
 * @return {Array} the commands
 */
function textOps(texts, font = FONT) {
	const c = new VectorContext({ measure })
	c.font = font
	c.fillStyle = '#1a1a1a'
	for (const [t, x, y] of texts) c.fillText(t, x, y)
	return c.ops
}

/** A rasteriser that records its calls and gives a 4 × 3 image. */
function rasterizer() {
	const calls = []
	const fn = (font, text, color, px) => {
		calls.push({ font, text, color, px })
		return { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4).fill(200), top: 20, left: -2 }
	}
	return { calls, fn }
}

test('AK5 structure: header, %%EOF, every xref entry on its object, one page, MediaBox = frame · 0.75 pt, Helvetica', async () => {
	const { bytes, width, height, scale } = await pdfDocument(textOps([['E81 Grüße', 12, 40]]), FRAME, { measure })
	const buf = Buffer.from(bytes)
	assert.equal(buf.toString('latin1', 0, 9), '%PDF-1.4\n')
	const pdf = readPdf(buf)
	assert.equal(pdf.version, '1.4')
	assert.equal(pdf.pages, 1)
	assert.deepEqual(pdf.mediaBox, [0, 0, 324, 249])
	assert.deepEqual([width, height, scale], [324, 249, 0.75])
	assert.deepEqual(fontsOf(pdf), ['Helvetica'])
	assert.match(pdf.objects.get(5).dict, /^<< \/Producer \(Knorke\) >>$/, 'Info: the producer only')
	assert.match(pdf.content, /^0\.75 0 0 -0\.75 12 237 cm\n1 1 1 rg -16 -16 432 332 re f\n/, 'world units onto the page, the white frame')
	assert.match(pdf.trailer, /\/Root 1 0 R/)
})

test('AK5 a frame 30000 units wide: the page is 14400 pt wide, everything scaled evenly', async () => {
	const frame = { x: 0, y: 0, w: 30000, h: 1000 }
	const k = pdfScale(frame)
	assert.equal(k, PDF_MAX_SIDE / 30000)
	const { bytes, width, height } = await pdfDocument([], frame, { measure })
	const pdf = readPdf(Buffer.from(bytes))
	assert.deepEqual(pdf.mediaBox, [0, 0, 14400, 480])
	assert.deepEqual([width, height], [14400, 480])
	assert.equal(pdfScale({ w: 19200, h: 100 }), 0.75, '14400 pt exactly fits')
})

test('AK5 text: WinAnsi bytes, escaped, each word at the x the browser measures; bold is Helvetica-Bold', async () => {
	const ops = textOps([['Grüße € (x)\\ ok', 0, 50]], 'bold normal 20px Arial')
	const pdf = readPdf(Buffer.from((await pdfDocument(ops, FRAME, { measure, deflate: null })).bytes))
	assert.deepEqual(fontsOf(pdf), ['Helvetica-Bold'])
	assert.deepEqual(shownStrings(pdf.content), ['Gr\xfc\xdfe ', '\x80 ', '(x)\\ ', 'ok'])
	assert.match(pdf.content, /BT \/F1 20 Tf 0 0 Td \(Gr\\374\\337e \) Tj ET/)
	assert.match(pdf.content, /BT \/F1 20 Tf 60 0 Td \(\\200 \) Tj ET/)
	assert.match(pdf.content, /BT \/F1 20 Tf 80 0 Td \(\\\(x\\\)\\\\ \) Tj ET/)
	assert.match(pdf.content, /q\n1 0 0 1 0 0 cm\n1 0 0 -1 0 50 cm\n\/A\d+ gs 0\.102 0\.102 0\.102 rg/, 'upright at the baseline, in its colour')
	assert.equal(pdfString([0x28, 0x29, 0x5c, 0x41, 0xe4, 0x0a]), '(\\(\\)\\\\A\\344\\012)')
	assert.deepEqual(['€', 'ü', 'A', '\t', 'ł', '👍', '\u0085'].map((ch) => winAnsi(ch.codePointAt(0))), [0x80, 0xfc, 0x41, -2, -1, -1, -2])
})

test('AK5 runs WinAnsi cannot encode are images with a soft mask at their measured place; whole graphemes; control characters left out', async () => {
	const r = rasterizer()
	const ops = textOps([['Привет 👍 ok\u0007', 0, 50]])
	const pdf = readPdf(Buffer.from((await pdfDocument(ops, FRAME, { measure, rasterize: r.fn })).bytes))
	assert.deepEqual(r.calls.map((c) => [c.text, c.color, c.font]), [['Привет', 'rgb(26, 26, 26)', FONT], ['👍', 'rgb(26, 26, 26)', FONT]])
	assert.ok(r.calls.every((c) => c.px === PDF_RASTER_SCALE), '4 px per unit')
	assert.deepEqual(imagesOf(pdf), [{ width: 4, height: 3, mask: true }, { width: 4, height: 3, mask: true }])
	assert.deepEqual(shownStrings(pdf.content), [' ', ' ', 'ok'], 'the spaces and the word, no BEL')
	// "👍" starts after "Привет " (7 characters, 70 units); the image 1 × 0.75 units, its left edge 2 units before, its top 20 above
	assert.match(pdf.content, /q\n\/A\d+ gs\n1 0 0 0\.75 68 19\.25 cm\n\/I2 Do\nQ/)
	assert.deepEqual(textPieces('éx 👨‍👩‍👧 a').map((p) => [p.kind, p.str]), [['raster', 'é'], ['text', 'x '], ['raster', '👨‍👩‍👧'], ['text', ' '], ['text', 'a']])
	assert.deepEqual(textPieces('\u0000\u0001'), [], 'only control characters: nothing')
	const rtl = rasterizer()
	await pdfDocument(textOps([['abc שלום def', 0, 0]]), FRAME, { measure, rasterize: rtl.fn })
	assert.deepEqual(rtl.calls.map((c) => c.text), ['abc שלום def'], 'a right-to-left text is one image')
	const none = await pdfDocument(textOps([['👍', 0, 0]]), FRAME, { measure })
	assert.deepEqual(imagesOf(readPdf(Buffer.from(none.bytes))), [], 'without a rasteriser the run is left out')
})

test('AK5 the images of all runs share one budget of 2^25 px', async () => {
	const r = rasterizer()
	const long = 'Ж'.repeat(3000)
	const texts = Array.from({ length: 40 }, (_, i) => [long, 0, i * 30])
	await pdfDocument(textOps(texts), FRAME, { measure, rasterize: r.fn })
	const area = 40 * 30000 * 24 * 1.5
	const px = Math.sqrt(PDF_RASTER_BUDGET / area)
	assert.ok(px < PDF_RASTER_SCALE)
	assert.equal(r.calls.length, 40)
	for (const c of r.calls) assert.ok(Math.abs(c.px - Math.min(px, 2048 / 30000)) < 1e-12, 'evenly lower, at most 2048 px per side')
})

test('AK5 note shadows: one colour under a luminosity soft mask; the shadings are shared; a clip is W n', async () => {
	const c = new VectorContext({ measure })
	for (const x of [0, 300]) {
		c.save()
		c.translate(x, 0)
		paintShade(c, 200, 200, 0)
		c.restore()
	}
	c.save()
	c.beginPath()
	c.rect(0, 0, 50, 50)
	c.clip()
	c.fillStyle = 'rgba(168, 216, 248, 0.5)'
	c.fillRect(0, 0, 100, 100)
	c.restore()
	const pdf = readPdf(Buffer.from((await pdfDocument(c.ops, { x: -16, y: -16, w: 532, h: 232 }, { measure })).bytes))
	const objs = [...pdf.objects.values()]
	const shadings = objs.filter((o) => /\/ShadingType [23]/.test(o.dict))
	assert.deepEqual(shadings.map((o) => /\/ShadingType (\d)/.exec(o.dict)[1] + /\/ColorSpace \/(\w+)/.exec(o.dict)[1]).sort(), ['2DeviceGray', '2DeviceGray', '3DeviceGray', '3DeviceGray'], 'per shadow (job 259: two) one band and one corner shading, grey, for both notes')
	assert.equal(objs.filter((o) => /\/S \/Luminosity/.test(o.dict)).length, 32, 'a soft mask per shadow piece')
	assert.equal(objs.filter((o) => /\/Subtype \/Form/.test(o.dict) && /\/Group << \/S \/Transparency \/CS \/DeviceGray >>/.test(o.dict)).length, 32)
	assert.equal((pdf.content.match(/\nW n\n\/M\d+ gs\n0 0 0 rg\n/g) ?? []).length, 32, 'clipped to the piece, black under the mask')
	assert.match(pdf.content, /q\n0 0 m\n50 0 l\n50 50 l\n0 50 l\nh\nW n\nq\n\/A\d+ gs 0\.659 0\.847 0\.973 rg\n0 0 m\n100 0 l\n100 100 l\n0 100 l\nh\nf\nQ\nQ/)
	assert.match(pdf.resources, /\/ExtGState << [^>]*\/A\d+ \d+ 0 R/)
	const half = objs.find((o) => /\/ca 0\.5 \/CA 0\.5/.test(o.dict))
	assert.ok(half, 'alpha 0.5 as an ExtGState')
})

test('AK5 with and without compression: the same content, valid either way', async () => {
	const ops = textOps([['Grüße', 0, 20]])
	const packed = Buffer.from((await pdfDocument(ops, FRAME, { measure })).bytes)
	const plain = Buffer.from((await pdfDocument(ops, FRAME, { measure, deflate: null })).bytes)
	assert.equal(typeof CompressionStream, 'function', 'Node has CompressionStream')
	assert.match(packed.toString('latin1'), /\/Filter \/FlateDecode/)
	assert.doesNotMatch(plain.toString('latin1'), /\/Filter/)
	assert.equal(readPdf(packed).content, readPdf(plain).content)
})

// ---- Job 207: the page size ---------------------------------------------------

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
/** The frame lies inside the margin, centred, and touches it on the tighter axis. */
function assertFitted(p, frame, label) {
	const M = PDF_PAGE_MARGIN
	const right = p.W - p.ox - frame.w * p.k
	const bottom = p.H - p.oy - frame.h * p.k
	for (const v of [p.ox, p.oy, right, bottom]) assert.ok(v >= M - 1e-6, label + ': inside the margin ' + v)
	assert.ok(near(p.ox, right) && near(p.oy, bottom), label + ': centred')
	assert.ok(near(Math.min(p.ox, p.oy), M), label + ': the tighter axis at the margin')
	assert.ok(near(p.tx, p.ox - frame.x * p.k) && near(p.ty, p.H - p.oy + frame.y * p.k), label + ': the matrix')
}

test('job 207 AK1 pdfPage: A4 and A3, landscape when wider than high, else portrait; fitted inside 10 mm, centred', () => {
	assert.deepEqual(PDF_PAGE_KEYS, ['a4', 'a3', 'content'])
	assert.deepEqual([PDF_PAGES.a4, PDF_PAGES.a3], [[595.276, 841.89], [841.89, 1190.551]])
	assert.ok(near(PDF_PAGE_MARGIN, 72 / 2.54, 1e-3), '10 mm')
	const cases = [
		[{ x: -16, y: -16, w: 1000, h: 500 }, 'a4', [841.89, 595.276]],
		[{ x: 0, y: 0, w: 500, h: 1000 }, 'a4', [595.276, 841.89]],
		[{ x: 5, y: 7, w: 500, h: 500 }, 'a4', [595.276, 841.89]],
		[{ x: -16, y: -16, w: 1000, h: 500 }, 'a3', [1190.551, 841.89]],
		[{ x: 300, y: -200, w: 800, h: 1200 }, 'a3', [841.89, 1190.551]],
	]
	for (const [frame, page, size] of cases) {
		const p = pdfPage(frame, page)
		const label = page + ' ' + frame.w + '×' + frame.h
		assert.deepEqual([p.W, p.H], size, label)
		assert.equal(p.paper, true)
		assert.ok(near(p.k, Math.min((p.W - 2 * PDF_PAGE_MARGIN) / frame.w, (p.H - 2 * PDF_PAGE_MARGIN) / frame.h)), label)
		assertFitted(p, frame, label)
	}
	const small = pdfPage({ x: 0, y: 0, w: 100, h: 80 }, 'a4')
	assert.deepEqual([small.W, small.H], [841.89, 595.276])
	assert.ok(small.k > PDF_PT_PER_UNIT * 8, 'a small content is enlarged: ' + small.k)
})

test('job 207 AK1 pdfPage: the size of the content as before (14400 pt limit); any other key is the content', () => {
	const frame = { x: -16, y: -16, w: 432, h: 332 }
	for (const page of ['content', undefined, 'letter', 'A4', '__proto__', 'toString', '']) {
		const p = pdfPage(frame, page)
		assert.deepEqual(p, { W: 324, H: 249, k: 0.75, ox: 0, oy: 0, tx: 12, ty: 237, paper: false }, String(page))
	}
	const wide = pdfPage({ x: 0, y: 0, w: 30000, h: 1000 }, 'content')
	assert.deepEqual([wide.W, wide.H, wide.k], [14400, 480, pdfScale({ w: 30000, h: 1000 })])
})

test('job 207 risks: a board of 3000 notes and a very narrow frame stay finite and inside the margin', async () => {
	for (const frame of [{ x: -30000, y: -20000, w: 60000, h: 40000 }, { x: 0, y: 0, w: 20, h: 3000 }, { x: 0, y: 0, w: 32, h: 32 }]) {
		for (const page of ['a4', 'a3']) {
			const p = pdfPage(frame, page)
			assert.ok([p.W, p.H, p.k, p.ox, p.oy, p.tx, p.ty].every(Number.isFinite), JSON.stringify(frame))
			assert.ok(p.k > 0)
			assertFitted(p, frame, page + ' ' + frame.w + '×' + frame.h)
		}
	}
	assert.equal(pdfPage({ x: 0, y: 0, w: 20, h: 3000 }, 'a4').W, 595.276, 'narrow: portrait')
	// items as far apart as the server allows (|x| ≤ 1e7): the scale stays in the matrix, never rounded to 0
	const huge = { x: -1e7, y: -1e7, w: 2e7, h: 1e7 }
	const hp = pdfPage(huge, 'a4')
	const hf = readPdf(Buffer.from((await pdfDocument([], huge, { page: 'a4', deflate: null })).bytes))
	const hm = hf.content.split('\n')[1].match(/^(\S+) 0 0 (\S+) (\S+) (\S+) cm$/)
	assert.ok(hm, hf.content.slice(0, 80))
	assert.ok(Math.abs(Number(hm[1]) / hp.k - 1) < 1e-5, 'k ' + hm[1] + ' ≈ ' + hp.k)
	assert.ok(!/e/.test(hm[0]), 'no exponent: ' + hm[0])
	const { bytes } = await pdfDocument(textOps([['E81 Grüße', 12, 40]]), { x: -30000, y: -20000, w: 60000, h: 40000 }, { measure, page: 'a4', deflate: null })
	const text = Buffer.from(bytes).toString('latin1')
	assert.ok(!/NaN|Infinity|e[-+]\d/.test(text), 'no NaN, Infinity or exponent in the file')
	assert.ok(!readPdf(Buffer.from(bytes)).error)
})

test('job 207 AK2 an A4 file: MediaBox, the whole page white, then the matrix of pdfPage and the frame; xref valid', async () => {
	const frame = { x: -16, y: -16, w: 1000, h: 500 }
	const p = pdfPage(frame, 'a4')
	const { bytes, width, height, scale } = await pdfDocument(textOps([['E81 Grüße', 12, 40]]), frame, { measure, page: 'a4' })
	const pdf = readPdf(Buffer.from(bytes))
	assert.ok(!pdf.error, pdf.error)
	assert.equal(pdf.pages, 1)
	assert.deepEqual(pdf.mediaBox, [0, 0, 841.89, 595.276])
	assert.deepEqual([width, height, scale], [841.89, 595.276, p.k])
	const [fill, matrix, frameFill] = pdf.content.split('\n')
	assert.equal(fill, '1 1 1 rg 0 0 841.89 595.276 re f', 'the whole page white first')
	const m = matrix.match(/^(\S+) 0 0 (\S+) (\S+) (\S+) cm$/).slice(1).map(Number)
	assert.ok(near(m[0], p.k) && near(m[1], -p.k) && near(m[2], p.tx, 1e-3) && near(m[3], p.ty, 1e-3), matrix)
	assert.equal(frameFill, '1 1 1 rg -16 -16 1000 500 re f')
	assert.deepEqual(shownStrings(pdf.content), ['E81 ', 'Gr\xfc\xdfe'])
	const a3 = readPdf(Buffer.from((await pdfDocument([], { x: 0, y: 0, w: 400, h: 900 }, { page: 'a3' })).bytes))
	assert.deepEqual(a3.mediaBox, [0, 0, 841.89, 1190.551], 'A3 portrait')
})

test('job 207 AK2 the content page and no page give the same bytes; an unknown page too', async () => {
	const ops = textOps([['Grüße 👍 (x)', 0, 50]])
	const r = rasterizer()
	const files = []
	for (const page of [undefined, 'content', 'letter']) {
		const opts = { measure, rasterize: r.fn, deflate: null }
		if (page !== undefined) opts.page = page
		files.push(Buffer.from((await pdfDocument(ops, FRAME, opts)).bytes))
	}
	assert.ok(files[0].equals(files[1]) && files[0].equals(files[2]))
	assert.ok(r.calls.every((c) => c.px === PDF_RASTER_SCALE), 'the images at 4 px per unit as before')
	assert.ok(!files[0].toString('latin1').includes('0 0 324 249 re f'), 'no extra page fill')
})

test('job 207 AK2 enlarged onto A3 (one note with 👍), the images keep their pixels per pt, within 2048 px', async () => {
	const frame = { x: -16, y: -16, w: 232, h: 232 }
	const p = pdfPage(frame, 'a3')
	assert.ok(p.k > 3)
	const r = rasterizer()
	await pdfDocument(textOps([['ok 👍', 20, 40]]), frame, { measure, rasterize: r.fn, page: 'a3' })
	assert.equal(r.calls.length, 1)
	const want = Math.min(PDF_RASTER_SCALE * p.k / PDF_PT_PER_UNIT, 2048 / (24 * 1.5))
	assert.ok(near(r.calls[0].px, want), r.calls[0].px + ' ≠ ' + want)
	assert.ok(r.calls[0].px > PDF_RASTER_SCALE)
	assert.ok(r.calls[0].px * 24 * 1.5 <= 2048 + 1e-9, 'at most 2048 px per side')
})
