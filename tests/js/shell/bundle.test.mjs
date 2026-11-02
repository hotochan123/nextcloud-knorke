/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ATTRIBUTIONS, EMOJI_BUDGET, EMOJI_MARKER, GZIP_BUDGET, LAZY_BUDGET, LAZY_CHUNKS, checkAttribution, checkBundle, hasEmojiMarker, importsStatically, requiredAttributions } from '../../../build/check-bundle.mjs'
import { LAZY_AREAS } from '../../../build/lazy-areas.mjs'
import { LAZY_IMPORTS, lazyFile, lazyTree, rootMap } from './bundleTree.mjs'

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
			mkdirSync(dirname(join(dir, p)), { recursive: true })
			writeFileSync(join(dir, p), c)
		}
		fn(dir)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const GOOD = {
	// job 217: main also holds the dynamic import of each lazy part
	'js/knorke-main.mjs': 'import "./vendor-AbC123.chunk.mjs";const more=()=>import("./emoji-gHi789.chunk.mjs");' + LAZY_IMPORTS,
	'js/vendor-AbC123.chunk.mjs': 'export const v = 1',
	'js/canvas-dEf456.chunk.mjs': 'class Rect{};Rect.prototype.className="Rect";class Text{};Text.prototype.className="Text";',
	'js/emoji-gHi789.chunk.mjs': 'import{v}from"./vendor-AbC123.chunk.mjs";const s={emojiIndex:1};export{s as default}',
	'js/knorke-main.mjs.map': '{}',
	'css/knorke-style.css': '.x{}',
	...lazyTree(),
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

test('check-bundle: gzip budget 506 KiB over the three JS files (350 until factory job 155, 360 until job 172, 370 until job 173, 380 until job 178, 390 until job 182, 400 until job 189, 410 until job 191, 420 until job 195, 434 until job 199, 438 until job 198, 442 until job 200, 452 until job 201, 460 until job 203, 470 until job 204, 476 until job 205, 482 until job 208, 485 until jobs 210 and 211, 486 until job 216, 487 until job 217, whose lazy parts lowered it, 446 until job 219, 447 until job 220, 448 until job 223, 449 until job 225, 453 until job 226, 456 until job 227, 457 until job 228, 459 until job 230, 460 until job 229, 462 until job 231, 464 until job 232, 466 until job 233, 469 until job 240, 470 until job 243, 472 until job 244, 475 until job 253, 476 until job 255, 477 until job 257, 478 until job 259, 479 until job 260, 480 until job 262, 481 until job 264, 482 until job 266, 484 until job 267, 489 until job 268, 491 until job 272, 496 until job 273, 499 until job 274, 500 until job 279, 505 until job 279)', () => {
	// random bytes do not compress: 506 KiB of them exceed the budget
	assert.equal(GZIP_BUDGET, 506 * 1024)
	withTree({ ...GOOD, 'js/vendor-AbC123.chunk.mjs': randomBytes(506 * 1024) }, (dir) => {
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
		for (const [p, c] of Object.entries({ ...GOOD, ...src, ...files })) {
			mkdirSync(dirname(join(dir, p)), { recursive: true })
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
		assert.match(r.lines.join('\n'), /licence notice js\/vendor-AbC123\.chunk\.mjs\.license credits qrcode-generator \(MIT, Kazuhiko Arase\)/)
	})
	withTree(GOOD, (dir) => {
		assert.deepEqual(requiredAttributions(dir), [], 'without the import nothing is required')
	})
})

test('job 172 AK7: exactly one lazy emoji chunk; main, vendor and canvas count against GZIP_BUDGET without it', () => {
	withTree(GOOD, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
		assert.equal(r.sizes.emoji.file, 'emoji-gHi789.chunk.mjs')
		assert.ok(!Object.keys(r.sizes.files).includes('emoji-gHi789.chunk.mjs'), 'the emoji chunk is not part of the three')
	})
	const none = { ...GOOD }
	delete none['js/emoji-gHi789.chunk.mjs']
	withTree(none, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /expected exactly one js\/emoji-\*\.chunk\.mjs, found 0/)
	})
	withTree({ ...GOOD, 'js/emoji-zZz000.chunk.mjs': 'emojiIndex' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /expected exactly one js\/emoji-\*\.chunk\.mjs, found 2/)
	})
	// a big emoji chunk does not count against GZIP_BUDGET, only against EMOJI_BUDGET
	assert.equal(EMOJI_BUDGET, 160 * 1024)
	withTree({ ...GOOD, 'js/emoji-gHi789.chunk.mjs': Buffer.concat([Buffer.from('emojiIndex;'), randomBytes(150 * 1024)]) }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
	})
	withTree({ ...GOOD, 'js/emoji-gHi789.chunk.mjs': Buffer.concat([Buffer.from('emojiIndex;'), randomBytes(170 * 1024)]) }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /emoji-gHi789\.chunk\.mjs gzip -9 .* exceeds 160\.0 KiB/)
	})
})

test('job 172 AK7: the marker EmojiIndex (case-insensitive) only in the emoji chunk; main loads it only by import(', () => {
	assert.equal(EMOJI_MARKER, 'EmojiIndex')
	assert.ok(hasEmojiMarker('class EmojiIndex{}') && hasEmojiMarker('{emojiIndex:a}') && !hasEmojiMarker('emoji index'))
	for (const f of ['js/knorke-main.mjs', 'js/vendor-AbC123.chunk.mjs', 'js/canvas-dEf456.chunk.mjs']) {
		withTree({ ...GOOD, [f]: GOOD[f] + ';const EmojiIndex=1' }, (dir) => {
			const r = checkBundle(dir)
			assert.equal(r.ok, false, f)
			assert.match(r.lines.join('\n'), new RegExp(f.replace(/[.*]/g, '\\$&') + ' holds the emoji list \\(marker EmojiIndex\\)'))
		})
	}
	withTree({ ...GOOD, 'js/emoji-gHi789.chunk.mjs': 'export const x = 1' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /emoji-gHi789\.chunk\.mjs does not hold the emoji list/)
	})
	// a static import of the emoji chunk, from main or vendor
	withTree({ ...GOOD, 'js/knorke-main.mjs': 'import{a}from"./emoji-gHi789.chunk.mjs";import "./vendor-AbC123.chunk.mjs";()=>import("./emoji-gHi789.chunk.mjs")' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /knorke-main\.mjs imports js\/emoji-gHi789\.chunk\.mjs statically/)
	})
	withTree({ ...GOOD, 'js/vendor-AbC123.chunk.mjs': 'import "./emoji-gHi789.chunk.mjs";export const v = 1' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /vendor-AbC123\.chunk\.mjs imports js\/emoji-gHi789\.chunk\.mjs statically/)
	})
	// no dynamic import at all
	withTree({ ...GOOD, 'js/knorke-main.mjs': 'import "./vendor-AbC123.chunk.mjs"' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /knorke-main\.mjs has no dynamic import\("\.\/emoji-gHi789\.chunk\.mjs"\)/)
	})
	const name = 'emoji-x.chunk.mjs'
	assert.equal(importsStatically('import("./emoji-x.chunk.mjs")', name), false)
	assert.equal(importsStatically('import{a as b}from"./emoji-x.chunk.mjs"', name), true)
	assert.equal(importsStatically('export{a}from"./emoji-x.chunk.mjs"', name), true)
	assert.equal(importsStatically('import "./emoji-x.chunk.mjs"', name), true)
	assert.equal(importsStatically('const deps=["js/emoji-x.chunk.mjs"]', name), false)
})

// ---- factory job 217: the lazy parts ----

test('job 217 AK2: one chunk per lazy part, each within LAZY_BUDGET and holding its roots; the same list as vite.config.js uses', () => {
	assert.equal(LAZY_CHUNKS, LAZY_AREAS)
	assert.deepEqual(Object.keys(LAZY_CHUNKS), ['vector', 'bpmn', 'csv', 'shapelib', 'admin', 'share', 'shortcuts', 'search', 'outline', 'moderate', 'ai'], 'job 220: csv after bpmn; job 268: ai; job 271: shortcuts and search; job 274: outline; job 275: moderate')
	assert.equal(LAZY_BUDGET, 32 * 1024)
	withTree(GOOD, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
		assert.deepEqual(Object.keys(r.sizes.lazy), Object.keys(LAZY_CHUNKS))
		assert.ok(!Object.keys(r.sizes.files).includes(lazyFile('share')), 'a lazy part does not count against GZIP_BUDGET')
	})
	const none = { ...GOOD }
	delete none['js/' + lazyFile('bpmn')]
	withTree(none, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /expected exactly one js\/bpmn-\*\.chunk\.mjs, found 0/)
	})
	withTree({ ...GOOD, 'js/bpmn-zZz000.chunk.mjs': 'export const b = 1' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /expected exactly one js\/bpmn-\*\.chunk\.mjs, found 2/)
	})
	withTree({ ...GOOD, ['js/' + lazyFile('share')]: randomBytes(33 * 1024) }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /js\/share-Lshare1\.chunk\.mjs gzip -9 .* exceeds 32\.0 KiB/)
	})
	withTree({ ...GOOD, ['js/' + lazyFile('vector') + '.map']: rootMap(LAZY_CHUNKS.vector.slice(1)) }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /js\/vector-Lvector1\.chunk\.mjs does not hold src\/scene\/vectorContext\.js/)
	})
	const noMap = { ...GOOD }
	delete noMap['js/' + lazyFile('admin') + '.map']
	withTree(noMap, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /js\/admin-Ladmin1\.chunk\.mjs\.map missing or unreadable/)
	})
})

test('job 217 AK2: a root in a map of main, vendor or canvas (the part would load with the page), a static import of a part, main without its import(), any import of main → FAILED', () => {
	for (const f of ['js/knorke-main.mjs', 'js/vendor-AbC123.chunk.mjs', 'js/canvas-dEf456.chunk.mjs']) {
		withTree({ ...GOOD, [f + '.map']: rootMap(['src/board/bpmnFile.js']) }, (dir) => {
			const r = checkBundle(dir)
			assert.equal(r.ok, false, f)
			assert.match(r.lines.join('\n'), new RegExp(f.replace(/[.*]/g, '\\$&') + ' holds src/board/bpmnFile\\.js \\(lazy part bpmn\\)'))
		})
	}
	withTree({ ...GOOD, 'js/knorke-main.mjs': GOOD['js/knorke-main.mjs'] + ';import{s}from"./share-Lshare1.chunk.mjs"' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /js\/knorke-main\.mjs imports js\/share-Lshare1\.chunk\.mjs statically/)
	})
	withTree({ ...GOOD, 'js/vendor-AbC123.chunk.mjs': 'import "./vector-Lvector1.chunk.mjs";export const v = 1' }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /js\/vendor-AbC123\.chunk\.mjs imports js\/vector-Lvector1\.chunk\.mjs statically/)
	})
	withTree({ ...GOOD, 'js/knorke-main.mjs': GOOD['js/knorke-main.mjs'].replace('()=>import("./share-Lshare1.chunk.mjs")', '') }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /js\/knorke-main\.mjs has no dynamic import\("\.\/share-Lshare1\.chunk\.mjs"\)/)
	})
	// Nextcloud loads main with ?v=…: a chunk importing it would run a second copy of the app
	for (const [f, text] of [['js/' + lazyFile('admin'), 'import{t}from"./knorke-main.mjs";export const a=t'], ['js/vendor-AbC123.chunk.mjs', 'import"./knorke-main.mjs";export const v=1'], ['js/' + lazyFile('bpmn'), 'const m=()=>import("./knorke-main.mjs")']]) {
		withTree({ ...GOOD, [f]: text }, (dir) => {
			const r = checkBundle(dir)
			assert.equal(r.ok, false, f)
			assert.match(r.lines.join('\n'), new RegExp(f.replace(/[.*]/g, '\\$&') + ' imports js/knorke-main\\.mjs \\(a second copy of the app\\)'))
		})
	}
})

test('job 217 AK2: the credit of qrcode-generator belongs in the notice of the chunk whose map names the package (the share chunk), else vendor', () => {
	const src = { 'src/qr.js': "import qrcode from 'qrcode-generator'\n" }
	const shareMap = rootMap(LAZY_CHUNKS.share, ['../node_modules/qrcode-generator/qrcode.js'])
	const share = 'js/' + lazyFile('share')
	withTree({ ...GOOD, ...src, [share + '.map']: shareMap, 'js/vendor-AbC123.chunk.mjs.license': NOTICE }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /js\/share-Lshare1\.chunk\.mjs\.license missing \(credits for qrcode-generator\)/, 'the vendor notice does not count')
	})
	withTree({ ...GOOD, ...src, [share + '.map']: shareMap, [share + '.license']: NOTICE.replace('- qrcode-generator\n', '- qrcode\n') }, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /js\/share-Lshare1\.chunk\.mjs\.license: qrcode-generator is not named/)
	})
	withTree({ ...GOOD, ...src, [share + '.map']: shareMap, [share + '.license']: NOTICE }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
		assert.match(r.lines.join('\n'), /licence notice js\/share-Lshare1\.chunk\.mjs\.license credits qrcode-generator \(MIT, Kazuhiko Arase\)/)
	})
})
