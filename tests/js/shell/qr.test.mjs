/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * QR code of a link (SPEC-M1 §6.6 QrCode, R2) and the licence notice of the
 * built vendor chunk (SPEC-M1 §24, R13: qrcode-generator 1.5.2 ships no
 * LICENSE file; js/vendor-*.chunk.mjs.license must name it, MIT and
 * Kazuhiko Arase once QrCode.vue imports the package). R14-11: the text goes
 * into byte mode as UTF-8, the library's global stringToBytes untouched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import qrcode from 'qrcode-generator'
import { checkAttribution, requiredAttributions } from '../../../build/check-bundle.mjs'
import { QR_MARGIN, qrPath, utf8Binary } from '../../../src/components/qr.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const URL1 = 'http://knorke-dev-c-nc/index.php/apps/knorke/p/Ab3dEf6hIj9kLm2nOp5qRs8t'
/** A host with "ü" (IDN written as Unicode) and a webroot with "ü" (R14-11). */
const URL_UE = 'https://büro.example/wörkshop/index.php/apps/knorke/p/Ab3dEf6hIj9kLm2nOp5qRs8t'

/**
 * @param {string} data byte-mode input
 * @param {(s: string) => number[]} [toBytes] stringToBytes for this build only (restored afterwards)
 * @return {object} made qrcode-generator instance (ECL M, automatic version)
 */
function reference(data, toBytes = null) {
	const saved = qrcode.stringToBytes
	try {
		if (toBytes) {
			qrcode.stringToBytes = toBytes
		}
		const ref = qrcode(0, 'M')
		ref.addData(data, 'Byte')
		ref.make()
		return ref
	} finally {
		qrcode.stringToBytes = saved
	}
}

/**
 * @param {object} q qrPath result
 * @param {object} ref qrcode-generator instance
 * @return {boolean} the path paints exactly the modules of ref
 */
function samePicture(q, ref) {
	const n = ref.getModuleCount()
	if (q.modules !== n) {
		return false
	}
	const m = paint(q)
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (m[r + QR_MARGIN][c + QR_MARGIN] !== ref.isDark(r, c)) {
				return false
			}
		}
	}
	return true
}

/**
 * Paints the path back into a module matrix (each subpath is one horizontal run).
 *
 * @param {{size: number, d: string}} q qrPath result
 * @return {boolean[][]} dark modules
 */
function paint(q) {
	const m = Array.from({ length: q.size }, () => Array(q.size).fill(false))
	const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g
	let x
	let total = 0
	while ((x = re.exec(q.d)) !== null) {
		const [c, r, w, back] = x.slice(1).map(Number)
		assert.equal(w, back, 'closed run')
		for (let i = 0; i < w; i++) {
			m[r][c + i] = true
		}
		total += x[0].length
	}
	assert.equal(total, q.d.length, 'nothing but runs in the path')
	return m
}

test('qrPath: the path paints exactly the modules of qrcode-generator (ECL M, automatic version), with a 4-module quiet zone', () => {
	const q = qrPath(URL1)
	const ref = qrcode(0, 'M')
	ref.addData(URL1, 'Byte')
	ref.make()
	const n = ref.getModuleCount()
	assert.equal(q.modules, n)
	assert.equal(q.size, n + 2 * QR_MARGIN)
	const m = paint(q)
	for (let r = 0; r < q.size; r++) {
		for (let c = 0; c < q.size; c++) {
			const inside = r >= QR_MARGIN && c >= QR_MARGIN && r < n + QR_MARGIN && c < n + QR_MARGIN
			assert.equal(m[r][c], inside ? ref.isDark(r - QR_MARGIN, c - QR_MARGIN) : false, `${r},${c}`)
		}
	}
	// the three finder patterns: a 7-module dark ring at the corners
	for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
		for (let i = 0; i < 7; i++) {
			assert.equal(m[QR_MARGIN + r0][QR_MARGIN + c0 + i], true)
			assert.equal(m[QR_MARGIN + r0 + 6][QR_MARGIN + c0 + i], true)
		}
	}
})

test('qrPath: deterministic, empty for an empty value, never markup (only M/h/v/z and numbers)', () => {
	assert.deepEqual(qrPath(URL1), qrPath(URL1))
	assert.deepEqual(qrPath(''), { size: 0, modules: 0, d: '' })
	assert.deepEqual(qrPath(null), { size: 0, modules: 0, d: '' })
	assert.match(qrPath('<script>"&</script>').d, /^[Mhvz0-9 -]+$/)
	assert.ok(qrPath(URL1 + '?x').modules >= qrPath(URL1).modules)
})

test('R14-11: utf8Binary — one char per UTF-8 byte ("ü" → C3 BC), ASCII unchanged, lone surrogate → U+FFFD', () => {
	const codes = (s) => [...s].map((c) => c.charCodeAt(0))
	assert.deepEqual(codes(utf8Binary('ü')), [0xc3, 0xbc])
	assert.deepEqual(codes(utf8Binary('€')), [0xe2, 0x82, 0xac])
	assert.deepEqual(codes(utf8Binary('😀')), [0xf0, 0x9f, 0x98, 0x80], 'surrogate pair → 4 bytes')
	assert.deepEqual(codes(utf8Binary('\ud800')), [0xef, 0xbf, 0xbd], 'lone surrogate → U+FFFD')
	assert.equal(utf8Binary(URL1), URL1, 'ASCII URLs are unchanged')
	assert.ok(codes(utf8Binary(URL_UE)).every((c) => c < 256))
	assert.deepEqual(codes(utf8Binary(URL_UE)), [...new TextEncoder().encode(URL_UE)])
})

test('R14-11: a URL with "ü" is encoded as its UTF-8 bytes; the global qrcode.stringToBytes stays the library default', () => {
	const before = qrcode.stringToBytes
	assert.equal(before, qrcode.stringToBytesFuncs.default, 'precondition: the default (cuts each UTF-16 unit to its low byte)')
	const q = qrPath(URL_UE)
	assert.equal(qrcode.stringToBytes, before, 'qrPath leaves the global alone')
	assert.equal(qrcode.stringToBytes, qrcode.stringToBytesFuncs.default)
	// expected: the same symbol as qrcode-generator's own UTF-8 conversion …
	assert.ok(samePicture(q, reference(URL_UE, qrcode.stringToBytesFuncs['UTF-8'])), 'the modules of the UTF-8 bytes of the URL')
	// … and as the explicit byte list (C3 BC for each "ü", F6 → C3 B6 for "ö")
	const bytes = [...new TextEncoder().encode(URL_UE)]
	assert.ok(bytes.includes(0xc3) && bytes.includes(0xbc) && bytes.includes(0xb6))
	assert.ok(samePicture(q, reference(URL_UE, (s) => (s === URL_UE ? bytes : before(s)))), 'the explicit UTF-8 byte list')
	// the old way (the default on the raw text: "ü" U+00FC → FC, one byte) is a different symbol
	assert.equal(samePicture(q, reference(URL_UE)), false, 'not the truncated Latin-1 bytes')
	// ASCII-only URLs are unchanged against the plain library call
	assert.ok(samePicture(qrPath(URL1), reference(URL1)))
	// a character beyond Latin-1 ("€" → E2 82 AC, the default would keep only AC)
	const euro = URL1 + '?e=€'
	assert.ok(samePicture(qrPath(euro), reference(euro, qrcode.stringToBytesFuncs['UTF-8'])))
	assert.equal(samePicture(qrPath(euro), reference(euro)), false)
})

test('R13: QrCode.vue uses the package (through qr.js) → the vendor notice of the build credits qrcode-generator, MIT, Kazuhiko Arase', (t) => {
	const qrVue = readFileSync(join(ROOT, 'src/components/QrCode.vue'), 'utf8')
	assert.match(qrVue, /import \{ qrPath \} from '\.\/qr\.js'/)
	assert.match(readFileSync(join(ROOT, 'src/components/qr.js'), 'utf8'), /^import qrcode from 'qrcode-generator'$/m)
	assert.deepEqual(requiredAttributions(ROOT).map((a) => a.name), ['qrcode-generator'])
	const jsDir = join(ROOT, 'js')
	const notices = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => /^vendor-[A-Za-z0-9_-]+\.chunk\.mjs\.license$/.test(f)) : []
	if (notices.length === 0) {
		// build/check-bundle.mjs (the build gate) fails without it; nothing built here yet
		t.skip('no build output in js/ (run dev/build.sh)')
		return
	}
	assert.equal(notices.length, 1)
	const text = readFileSync(join(jsDir, notices[0]), 'utf8')
	assert.deepEqual(checkAttribution(text), [])
	assert.match(text, /^- qrcode-generator\n\t- version: 1\.5\.2\n\t- license: MIT$/m)
	assert.match(text, /Kazuhiko Arase/)
})
