/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Self-test of lib/pdf.mjs (E81, factory job 200), no browser: it reads a
 * file of src/scene/exportPdf.js, and it refuses a file whose xref entry
 * misses its object, without %%EOF, with a wrong stream length or without
 * a page.
 * Run: node --test 'dev/e2e/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { VectorContext } from '../../src/scene/vectorContext.js'
import { pdfDocument } from '../../src/scene/exportPdf.js'
import { fontsOf, imagesOf, isPdf, readPdf, refOf, shownStrings } from './lib/pdf.mjs'

const measure = (font, text) => ({ width: 10 * [...text].length, shift: 0 })

/** @return {Promise<Buffer>} a PDF with one text and one image run */
async function sample() {
	const c = new VectorContext({ measure })
	c.font = 'bold 20px Arial'
	c.fillStyle = '#1a1a1a'
	c.fillText('E81 Grüße 👍', 0, 30)
	const raster = () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(9), top: 20 })
	return Buffer.from((await pdfDocument(c.ops, { x: 0, y: 0, w: 400, h: 100 }, { measure, rasterize: raster })).bytes)
}

test('lib/pdf.mjs reads the export: version, one page, MediaBox, fonts, shown strings, images', async () => {
	const buf = await sample()
	assert.equal(isPdf(buf), true)
	assert.equal(isPdf(Buffer.from('<?xml')), false)
	const pdf = readPdf(buf)
	assert.equal(pdf.version, '1.4')
	assert.equal(pdf.pages, 1)
	assert.deepEqual(pdf.mediaBox, [0, 0, 300, 75])
	assert.deepEqual(fontsOf(pdf), ['Helvetica-Bold'])
	assert.deepEqual(shownStrings(pdf.content), ['E81 ', 'Gr\xfc\xdfe '])
	assert.deepEqual(imagesOf(pdf), [{ width: 2, height: 2, mask: true }])
	assert.equal(refOf(pdf.trailer, 'Root'), 1)
})

test('lib/pdf.mjs refuses a broken file: an xref entry off its object, no %%EOF, a wrong stream length, no page', async () => {
	const buf = await sample()
	const s = buf.toString('latin1')
	const xref = s.lastIndexOf('\nxref\n')
	const shifted = s.slice(0, xref) + s.slice(xref).replace(/\n(\d{10}) 00000 n \n/, (m, off) => `\n${String(Number(off) + 1).padStart(10, '0')} 00000 n \n`)
	assert.throws(() => readPdf(Buffer.from(shifted, 'latin1')), /points at/)
	assert.throws(() => readPdf(Buffer.from(s.replace(/%%EOF\n$/, ''), 'latin1')), /%%EOF/)
	const len = s.replace(/\/Length (\d+)/, (m, n) => `/Length ${Number(n) - 1}`)
	assert.throws(() => readPdf(Buffer.from(len, 'latin1')), /stream end|incorrect header|unexpected end|invalid/i)
	assert.throws(() => readPdf(Buffer.from(s.replace('/Count 1', '/Count 2'), 'latin1')), /page count/)
	assert.throws(() => readPdf(Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')), /startxref/)
})
