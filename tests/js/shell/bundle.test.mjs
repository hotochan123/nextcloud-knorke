/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ATTRIBUTIONS, GZIP_BUDGET, checkAttribution, checkBundle, requiredAttributions } from '../../../build/check-bundle.mjs'

/**
 * @param {Record<string, string|Buffer>} files path → content
 * @param {(dir: string) => void} fn check
 */
function withTree(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), 'knorke-bundle-'))
	try {
		mkdirSync(join(dir, 'js'))
		mkdirSync(join(dir, 'css'))
		for (const [p, c] of Object.entries(files)) {
			writeFileSync(join(dir, p), c)
		}
		fn(dir)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const GOOD = {
	'js/knorke-main.mjs': 'import "./vendor-AbC123.chunk.mjs"',
	'js/vendor-AbC123.chunk.mjs': 'export const v = 1',
	'js/canvas-dEf456.chunk.mjs': 'class Rect{};Rect.prototype.className="Rect";class Text{};Text.prototype.className="Text";',
	'js/knorke-main.mjs.map': '{}',
	'css/knorke-style.css': '.x{}',
}

test('check-bundle: the expected shape passes', () => {
	withTree(GOOD, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
		assert.ok(r.sizes.gzipTotal > 0)
	})
})

test('check-bundle: extra chunk, missing CSS, forbidden shapes, missing vendor', () => {
	withTree({ ...GOOD, 'js/NcFoo-xyz.chunk.mjs': 'lazy' }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /unexpected file js\/NcFoo-xyz\.chunk\.mjs/)
	})
	const noCss = { ...GOOD }
	delete noCss['css/knorke-style.css']
	withTree(noCss, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /css\/knorke-style\.css missing/)
	})
	withTree({ ...GOOD, 'js/canvas-dEf456.chunk.mjs': 'e.className="Ellipse";a.className=\'Arrow\'' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /Ellipse, Arrow/)
	})
	const noVendor = { ...GOOD }
	delete noVendor['js/vendor-AbC123.chunk.mjs']
	withTree(noVendor, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /exactly one js\/vendor/)
	})
})

test('check-bundle: gzip budget 350 KiB over the three JS files', () => {
	// random bytes do not compress: 400 KiB of them exceed the budget
	withTree({ ...GOOD, 'js/vendor-AbC123.chunk.mjs': randomBytes(400 * 1024) }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.ok(r.sizes.gzipTotal > GZIP_BUDGET)
		assert.match(r.lines.join('\n'), /exceeds/)
	})
})

const NOTICE = 'SPDX-License-Identifier: MIT\nSPDX-FileCopyrightText: Kazuhiko Arase\n\nThis file is generated from multiple sources. Included packages:\n- qrcode-generator\n\t- version: 1.5.2\n\t- license: MIT\n- semver\n\t- version: 7.7.3\n\t- license: ISC\n'

test('M1 §24 (R13) checkAttribution: qrcode-generator must be named with MIT and Kazuhiko Arase', () => {
	assert.deepEqual(ATTRIBUTIONS.map((a) => [a.name, a.license, a.author]), [['qrcode-generator', 'MIT', 'Kazuhiko Arase']])
	assert.deepEqual(checkAttribution(NOTICE), [])
	assert.deepEqual(checkAttribution(NOTICE.replace('- qrcode-generator\n', '- qrcode\n')), ['qrcode-generator is not named'])
	assert.deepEqual(checkAttribution(NOTICE.replace('\t- license: MIT\n- semver', '\t- license: ISC\n- semver')), ['qrcode-generator: licence MIT is not named'], 'the MIT of another package does not count')
	assert.deepEqual(checkAttribution(NOTICE.replace('Kazuhiko Arase', 'Someone')), ['qrcode-generator: author Kazuhiko Arase is not named'])
	assert.deepEqual(checkAttribution(NOTICE.replace(/\n/g, '\r\n')), [], 'CRLF')
})

test('M1 §24 (R13) check-bundle: once src/ imports qrcode-generator the vendor notice must credit it (missing file or credit → FAILED)', () => {
	const src = { 'src/qr.js': "import qrcode from 'qrcode-generator'\n" }
	const withSrc = (files, fn) => withTree({}, (dir) => {
		mkdirSync(join(dir, 'src'))
		for (const [p, c] of Object.entries({ ...GOOD, ...src, ...files })) {
			writeFileSync(join(dir, p), c)
		}
		fn(dir)
	})
	withSrc({}, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /js\/vendor-AbC123\.chunk\.mjs\.license missing \(credits for qrcode-generator\)/)
	})
	withSrc({ 'js/vendor-AbC123.chunk.mjs.license': NOTICE.replace('Kazuhiko Arase', 'X') }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /author Kazuhiko Arase is not named/)
	})
	withSrc({ 'js/vendor-AbC123.chunk.mjs.license': NOTICE }, (dir) => {
		const r = checkBundle(dir)
		assert.doesNotMatch(r.lines.join('\n'), /ERROR.*licen/, r.lines.join('\n'))
		assert.match(r.lines.join('\n'), /licence notice credits qrcode-generator \(MIT, Kazuhiko Arase\)/)
	})
	withTree(GOOD, (dir) => {
		assert.deepEqual(requiredAttributions(dir), [], 'without the import nothing is required')
	})
})
