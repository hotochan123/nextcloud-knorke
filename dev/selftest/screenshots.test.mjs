/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Store screenshots (factory job 132, docs/ENTWICKLUNG.md §11 "Hochladen"):
 * appinfo/info.xml points with fixed https addresses at docs/screenshots/ on
 * main of the public repository hotochan123/nextcloud-knorke; the image files
 * live in this repository under exactly that path.
 * No network, no Git, no Docker: info.xml, dev/release.sh and the image files
 * are read from this copy.
 *
 * - (a) 3 to 5 <screenshot> elements without attributes; each text is a
 *   raw.githubusercontent.com address on main under docs/screenshots/, at
 *   most 256 characters (secure-url of info.xsd) and unique
 * - (b) with comments and CDATA sections removed, the <screenshot> elements
 *   follow <repository> without a gap among the children of <info>, and the
 *   next element is <donation> or <dependencies> (the order of info.xsd)
 * - (c) every path of (a) is a regular file, not a symlink, and
 *   docs/screenshots/ holds exactly these files
 * - (d) every file: at most 2 MiB, PNG signature, IHDR first with 1920 × 1200,
 *   the chunks walked by their length fields: each inside the file, only the
 *   types of ALLOWED (no text, time or Exif chunks: a tool can write paths,
 *   host names or dates there, and the private value check reads no pixels),
 *   IEND last and no byte after it; the CRC is not checked
 * - (e) no path lies in a folder of RUNTIME_DIRS of dev/release.sh, so the
 *   images never reach the release archive
 * - (f) the PNG reader itself, on buffers built here
 *
 * Run: node --test 'dev/selftest/*.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const INFO = fs.readFileSync(path.join(ROOT, 'appinfo/info.xml'), 'utf8')
const RELEASE = fs.readFileSync(path.join(ROOT, 'dev/release.sh'), 'utf8')
const DIR = 'docs/screenshots'
const URL_RE = /^https:\/\/raw\.githubusercontent\.com\/hotochan123\/nextcloud-knorke\/main\/(docs\/screenshots\/[a-z0-9-]+\.png)$/
const MAX_URL = 256
const MAX_BYTES = 2097152
const WIDTH = 1920
const HEIGHT = 1200
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// critical chunks plus colour and pixel-size information; nothing that carries text, a time or Exif
const ALLOWED = new Set(['IHDR', 'PLTE', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'pHYs', 'IDAT', 'IEND'])

// ── PNG structure ────────────────────────────────────────────────────────

const showType = (t) => (/^[A-Za-z]{4}$/.test(t) ? t : JSON.stringify(t))

/**
 * Walks a PNG file by its chunk length fields. Returns {width, height,
 * chunks} (chunk types in file order); throws an Error naming the reason when
 * the signature, the first chunk, a chunk type, a length or the end is wrong.
 * CRCs are not checked.
 */
function readPng(buf) {
	if (buf.length < SIGNATURE.length || !buf.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error('no PNG signature')
	const chunks = []
	let width = null
	let height = null
	let off = SIGNATURE.length
	while (off < buf.length) {
		if (off + 12 > buf.length) throw new Error(`chunk header at byte ${off} runs past the end of the file`)
		const len = buf.readUInt32BE(off)
		const type = buf.toString('latin1', off + 4, off + 8)
		if (off + 12 + len > buf.length) throw new Error(`chunk ${showType(type)} at byte ${off} runs past the end of the file`)
		if (chunks.length === 0) {
			if (type !== 'IHDR') throw new Error(`first chunk is ${showType(type)}, not IHDR`)
			if (len !== 13) throw new Error(`IHDR has ${len} bytes, not 13`)
			width = buf.readUInt32BE(off + 8)
			height = buf.readUInt32BE(off + 12)
		}
		if (!ALLOWED.has(type)) throw new Error(`chunk ${showType(type)} not allowed`)
		chunks.push(type)
		off += 12 + len
		if (type === 'IEND') {
			const rest = buf.length - off
			if (rest > 0) throw new Error(`${rest} byte${rest === 1 ? '' : 's'} after IEND`)
			return { width, height, chunks }
		}
	}
	throw new Error('no IEND chunk')
}

/** null when the bytes of rel are a store screenshot, else "<rel>: <reason>". */
function screenshotProblem(rel, buf) {
	if (buf.length > MAX_BYTES) return `${rel}: ${buf.length} bytes, more than ${MAX_BYTES}`
	let png
	try {
		png = readPng(buf)
	} catch (e) {
		return `${rel}: ${e.message}`
	}
	if (png.width !== WIDTH || png.height !== HEIGHT) return `${rel}: ${png.width} × ${png.height} pixels, not ${WIDTH} × ${HEIGHT}`
	return null
}

// ── info.xml ─────────────────────────────────────────────────────────────

/**
 * The child elements of <info> in document order: {name, attrs, text}, text
 * = everything between start and end tag. Comments, CDATA sections and
 * processing instructions are removed first, so markup inside them counts
 * nowhere.
 */
function infoChildren(xml) {
	const s = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '')
	const stack = []
	const out = []
	let child = null
	for (const m of s.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
		const [tag, close, name, attrs, self] = m
		if (close) {
			assert.equal(stack.pop(), name, `info.xml: </${name}> closes another element`)
			if (stack.length === 1 && child) {
				child.text = s.slice(child.textStart, m.index)
				out.push(child)
				child = null
			}
			continue
		}
		if (stack.length === 0) assert.equal(name, 'info', 'info.xml: the root element is <info>')
		if (stack.length === 1) {
			const c = { name, attrs: attrs.trim(), text: '', textStart: m.index + tag.length }
			if (self) out.push(c)
			else child = c
		}
		if (!self) stack.push(name)
	}
	assert.equal(stack.length, 0, 'info.xml: every element is closed')
	return out.map(({ name, attrs, text }) => ({ name, attrs, text }))
}

const CHILDREN = infoChildren(INFO)
const SHOTS = CHILDREN.filter((c) => c.name === 'screenshot')
const PATHS = SHOTS.map((c) => (URL_RE.exec(c.text) || [])[1]).filter(Boolean)

test('(a) info.xml: 3 to 5 <screenshot> elements, no attribute, raw.githubusercontent.com on main under docs/screenshots/, unique', () => {
	assert.ok(SHOTS.length >= 3 && SHOTS.length <= 5, `${SHOTS.length} <screenshot> elements, wanted 3 to 5`)
	const stripped = INFO.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
	assert.equal((stripped.match(/<screenshot[\s/>]/g) || []).length, SHOTS.length, 'every <screenshot> is a child of <info>')
	for (const s of SHOTS) {
		assert.equal(s.attrs, '', `<screenshot> without attributes (${s.attrs})`)
		assert.match(s.text, URL_RE)
		assert.ok(s.text.length <= MAX_URL, `${s.text}: ${s.text.length} characters, more than ${MAX_URL}`)
	}
	assert.equal(new Set(SHOTS.map((s) => s.text)).size, SHOTS.length, 'no address twice')
	assert.equal(PATHS.length, SHOTS.length)
})

test('(b) info.xml: the <screenshot> elements follow <repository> without a gap, then <donation> or <dependencies>', () => {
	const names = CHILDREN.map((c) => c.name)
	const at = names.indexOf('repository')
	assert.ok(at >= 0, '<repository> exists')
	assert.equal(names.lastIndexOf('repository'), at, 'one <repository>')
	const n = SHOTS.length
	assert.deepEqual(names.slice(at + 1, at + 1 + n), Array(n).fill('screenshot'), `children after <repository>: ${names.slice(at + 1, at + 2 + n).join(', ')}`)
	assert.equal(names.filter((x) => x === 'screenshot').length, n)
	assert.ok(['donation', 'dependencies'].includes(names[at + 1 + n]), `after the screenshots comes <${names[at + 1 + n]}>, not <donation> or <dependencies>`)
})

test('(b) the element walk ignores markup inside comments and CDATA sections', () => {
	const xml = '<?xml version="1.0"?>\n<!-- <screenshot>x</screenshot> -->\n<info a="1">\n<id>k</id>\n<description><![CDATA[<dependencies> <b>x</b>]]></description>\n<repository type="git">r</repository>\n<!--<donation>d</donation>-->\n<screenshot>s</screenshot>\n<dependencies><php min-version="8.2"/></dependencies>\n<empty/>\n</info>\n'
	assert.deepEqual(infoChildren(xml), [
		{ name: 'id', attrs: '', text: 'k' },
		{ name: 'description', attrs: '', text: '' },
		{ name: 'repository', attrs: 'type="git"', text: 'r' },
		{ name: 'screenshot', attrs: '', text: 's' },
		{ name: 'dependencies', attrs: '', text: '<php min-version="8.2"/>' },
		{ name: 'empty', attrs: '', text: '' },
	])
})

// ── the files ────────────────────────────────────────────────────────────

test('(c) every screenshot is a regular file in docs/screenshots/, and the folder holds nothing else', () => {
	assert.ok(PATHS.length >= 3)
	for (const p of PATHS) {
		const st = fs.lstatSync(path.join(ROOT, p), { throwIfNoEntry: false })
		assert.ok(st, `${p} is missing`)
		assert.ok(!st.isSymbolicLink(), `${p} is a symlink`)
		assert.ok(st.isFile(), `${p} is not a regular file`)
	}
	const listed = fs.readdirSync(path.join(ROOT, DIR)).map((f) => `${DIR}/${f}`).sort()
	assert.deepEqual(listed, [...PATHS].sort(), `${DIR}/ holds exactly the files of the <screenshot> elements`)
})

test('(d) every screenshot: at most 2 MiB, PNG 1920 × 1200, only allowed chunks, IEND last', () => {
	assert.ok(PATHS.length >= 3)
	const problems = []
	for (const p of PATHS) {
		const problem = screenshotProblem(p, fs.readFileSync(path.join(ROOT, p)))
		if (problem) problems.push(problem)
	}
	assert.deepEqual(problems, [])
})

test('(e) no screenshot lies in a runtime folder of dev/release.sh (never in the archive)', () => {
	const lines = RELEASE.split('\n').filter((l) => /^RUNTIME_DIRS=/.test(l))
	assert.equal(lines.length, 1, 'dev/release.sh sets RUNTIME_DIRS exactly once')
	const m = /^RUNTIME_DIRS="([^"]*)"$/.exec(lines[0])
	assert.ok(m, `RUNTIME_DIRS="…": ${lines[0]}`)
	const dirs = m[1].split(/\s+/).filter(Boolean)
	assert.ok(dirs.length > 0, 'RUNTIME_DIRS is not empty')
	assert.ok(PATHS.length >= 3)
	for (const p of PATHS) {
		for (const d of dirs) assert.ok(!p.startsWith(`${d}/`), `${p} lies in the runtime folder ${d}/`)
	}
})

// ── (f) the reader itself ────────────────────────────────────────────────

/** A chunk with a correct length field and a CRC of zeros (the reader checks no CRC). */
function chunk(type, data = Buffer.alloc(0)) {
	const head = Buffer.alloc(8)
	head.writeUInt32BE(data.length, 0)
	head.write(type, 4, 'latin1')
	return Buffer.concat([head, data, Buffer.alloc(4)])
}
function ihdr(w, h) {
	const d = Buffer.alloc(13)
	d.writeUInt32BE(w, 0)
	d.writeUInt32BE(h, 4)
	d[8] = 8 // bit depth
	d[9] = 6 // RGBA
	return chunk('IHDR', d)
}
const IDAT = chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00]))
const IEND = chunk('IEND')
const png = (...chunks) => Buffer.concat([SIGNATURE, ...chunks])

test('(f) a minimal PNG (signature, IHDR, IDAT, IEND) is accepted with its width and height', () => {
	assert.deepEqual(readPng(png(ihdr(3, 2), IDAT, IEND)), { width: 3, height: 2, chunks: ['IHDR', 'IDAT', 'IEND'] })
	assert.deepEqual(readPng(png(ihdr(1920, 1200), chunk('sRGB', Buffer.from([0])), chunk('pHYs', Buffer.alloc(9)), IDAT, IDAT, IEND)).chunks, ['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IDAT', 'IEND'])
	assert.equal(screenshotProblem('docs/screenshots/x.png', png(ihdr(1920, 1200), IDAT, IEND)), null)
})

test('(f) the reader rejects every violation and names it', () => {
	const ok = png(ihdr(1920, 1200), IDAT, IEND)
	const badSig = Buffer.from(ok)
	badSig[1] = 0x51
	const tooLong = Buffer.from(ok)
	tooLong.writeUInt32BE(1000, SIGNATURE.length + 25) // length field of IDAT
	const cases = [
		[badSig, /^no PNG signature$/],
		[Buffer.from('GIF89a'), /^no PNG signature$/],
		[png(chunk('sRGB', Buffer.from([0])), ihdr(1920, 1200), IDAT, IEND), /^first chunk is sRGB, not IHDR$/],
		[png(IDAT, IEND), /^first chunk is IDAT, not IHDR$/],
		...['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].map((t) => [png(ihdr(1920, 1200), chunk(t, Buffer.from('Software\0x')), IDAT, IEND), new RegExp(`^chunk ${t} not allowed$`)]),
		[tooLong, /^chunk IDAT at byte 33 runs past the end of the file$/],
		[ok.subarray(0, ok.length - 3), /^chunk header at byte \d+ runs past the end of the file$/],
		[png(ihdr(1920, 1200), IDAT), /^no IEND chunk$/],
		[Buffer.concat([ok, Buffer.from([0])]), /^1 byte after IEND$/],
		[Buffer.concat([ok, IEND]), /^12 bytes after IEND$/],
	]
	for (const [buf, re] of cases) assert.throws(() => readPng(buf), { message: re })
	// the message of a real file names the file and the reason
	assert.equal(screenshotProblem('docs/screenshots/voting.png', png(ihdr(1920, 1200), chunk('tEXt', Buffer.from('a\0b')), IDAT, IEND)), 'docs/screenshots/voting.png: chunk tEXt not allowed')
	assert.equal(screenshotProblem('docs/screenshots/x.png', png(ihdr(1920, 1201), IDAT, IEND)), 'docs/screenshots/x.png: 1920 × 1201 pixels, not 1920 × 1200')
	assert.equal(screenshotProblem('docs/screenshots/x.png', Buffer.alloc(MAX_BYTES + 1)), `docs/screenshots/x.png: ${MAX_BYTES + 1} bytes, more than ${MAX_BYTES}`)
})
