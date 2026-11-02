/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A small PDF reader for the vector export (E81, factory job 200; the unit
 * tests of src/scene/exportPdf.js use it too), no dependency beyond
 * node:zlib. It reads what the export writes, strictly: the header, the
 * classic cross-reference table (every entry must point at "<n> 0 obj"),
 * the trailer, each object's dictionary and stream (its /Length direct,
 * FlateDecode inflated), the page tree and the first page's MediaBox,
 * resources and content. Anything else throws.
 */
import zlib from 'node:zlib'

/**
 * @param {Buffer} buf file bytes
 * @return {boolean} the file starts like a PDF
 */
export function isPdf(buf) {
	return Buffer.isBuffer(buf) && buf.length >= 8 && buf.toString('latin1', 0, 5) === '%PDF-'
}

/**
 * @param {string} dict a dictionary's text
 * @param {string} key a key without the slash
 * @return {number|null} the object number of "/key n 0 R"
 */
export function refOf(dict, key) {
	const m = new RegExp('/' + key + ' (\\d+) 0 R').exec(dict)
	return m ? Number(m[1]) : null
}

/**
 * @typedef {{dict: string, data: (Buffer|null)}} PdfObject
 *   dict: the dictionary (or the whole object) as text; data: the stream, inflated
 */

/**
 * Reads a PDF (see the file comment).
 *
 * @param {Buffer} buf file bytes
 * @return {{version: string, objects: Map<number, PdfObject>, trailer: string, pages: number,
 *   mediaBox: number[], resources: string, content: string}}
 */
export function readPdf(buf) {
	if (!isPdf(buf)) throw new Error('not a PDF')
	const s = buf.toString('latin1')
	const version = /^%PDF-(\d\.\d)\n/.exec(s)?.[1]
	if (!version) throw new Error('header')
	if (!s.endsWith('%%EOF\n')) throw new Error('no %%EOF at the end')
	const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(s)
	if (!sx) throw new Error('startxref')
	const at = Number(sx[1])
	const head = /^xref\n0 (\d+)\n/.exec(s.slice(at))
	if (!head) throw new Error('xref table at startxref')
	const n = Number(head[1])
	let p = at + head[0].length
	if (s.slice(p, p + 20) !== '0000000000 65535 f \n') throw new Error('xref entry 0')
	const objects = new Map()
	for (let i = 1; i < n; i++) {
		p += 20
		const e = /^(\d{10}) 00000 n \n$/.exec(s.slice(p, p + 20))
		if (!e) throw new Error('xref entry ' + i)
		const off = Number(e[1])
		const open = `${i} 0 obj\n`
		if (!s.startsWith(open, off)) throw new Error(`xref entry ${i} points at ${off}, not at its object`)
		const body = off + open.length
		const end = s.indexOf('\nendobj\n', body)
		if (end < 0) throw new Error('endobj ' + i)
		const st = s.indexOf('>>\nstream\n', body)
		if (st >= 0 && st < end) {
			const dict = s.slice(body, st + 2)
			const len = /\/Length (\d+)/.exec(dict)
			if (!len) throw new Error('stream length ' + i)
			const from = st + '>>\nstream\n'.length
			const raw = buf.subarray(from, from + Number(len[1]))
			if (s.slice(from + raw.length, from + raw.length + 11) !== '\nendstream\n') throw new Error('stream end ' + i)
			objects.set(i, { dict, data: /\/Filter \/FlateDecode/.test(dict) ? zlib.inflateSync(raw) : Buffer.from(raw) })
		} else {
			objects.set(i, { dict: s.slice(body, end), data: null })
		}
	}
	const trailer = /trailer\n(<<[^]*?>>)\nstartxref/.exec(s)?.[1]
	if (!trailer || Number(/\/Size (\d+)/.exec(trailer)?.[1]) !== n) throw new Error('trailer /Size')
	const root = objects.get(refOf(trailer, 'Root'))
	if (!root || !/\/Type \/Catalog/.test(root.dict)) throw new Error('catalog')
	const tree = objects.get(refOf(root.dict, 'Pages'))
	if (!tree || !/\/Type \/Pages/.test(tree.dict)) throw new Error('page tree')
	const kids = [.../\/Kids \[([^\]]*)\]/.exec(tree.dict)?.[1].matchAll(/(\d+) 0 R/g) ?? []].map((m) => Number(m[1]))
	const count = Number(/\/Count (\d+)/.exec(tree.dict)?.[1])
	if (kids.length !== count || count < 1) throw new Error('page count')
	const page = objects.get(kids[0])
	if (!page || !/\/Type \/Page\b/.test(page.dict)) throw new Error('page')
	const box = /\/MediaBox \[([^\]]*)\]/.exec(page.dict)?.[1].trim().split(/\s+/).map(Number)
	if (!box || box.length !== 4 || box.some((v) => !Number.isFinite(v))) throw new Error('MediaBox')
	const contents = objects.get(refOf(page.dict, 'Contents'))
	if (!contents?.data) throw new Error('page content')
	const resources = /\/Resources (<<[^]*>>) >>$/.exec(page.dict)?.[1] ?? ''
	return { version, objects, trailer, pages: count, mediaBox: box, resources, content: contents.data.toString('latin1') }
}

/**
 * @param {ReturnType<typeof readPdf>} pdf a read PDF
 * @return {string[]} the BaseFont of every font object
 */
export function fontsOf(pdf) {
	return [...pdf.objects.values()].map((o) => /\/Type \/Font .*\/BaseFont \/([\w-]+)/.exec(o.dict)?.[1]).filter(Boolean)
}

/**
 * @param {ReturnType<typeof readPdf>} pdf a read PDF
 * @return {{width: number, height: number, mask: boolean}[]} the colour images (not their soft masks)
 */
export function imagesOf(pdf) {
	return [...pdf.objects.values()]
		.filter((o) => /\/Subtype \/Image/.test(o.dict) && /\/ColorSpace \/DeviceRGB/.test(o.dict))
		.map((o) => ({ width: Number(/\/Width (\d+)/.exec(o.dict)[1]), height: Number(/\/Height (\d+)/.exec(o.dict)[1]), mask: /\/SMask \d+ 0 R/.test(o.dict) }))
}

/**
 * @param {string} content a content stream
 * @return {string[]} the strings shown with Tj, decoded from their escapes to WinAnsi bytes as latin1 text
 */
export function shownStrings(content) {
	return [...content.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\([0-7]{3}|.)/g, (x, e) => (e.length === 3 ? String.fromCharCode(parseInt(e, 8)) : e)))
}
