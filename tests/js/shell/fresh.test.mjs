/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * build/check-fresh.mjs: the bundle in js/ must match src/ on disk (review
 * finding C-1b-01: js/ was built at 16:35, four scene/model sources were
 * saved at 16:38, and every E run used the stale bundle). Also wired into
 * check-bundle.mjs, so `npm run build` fails when a source changes while
 * vite bundles.
 *
 * SPEC-M1 §9.5 WP-C4 (b), R19 T4-26 (A-02): CSS through the record
 * js/knorke-style.fresh.json that the build plugin (build/style-fresh.mjs,
 * wired in vite.config.js) writes; all on fixtures in a temporary
 * directory, never on the app's own js/ or css/.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkFresh } from '../../../build/check-fresh.mjs'
import { checkBundle } from '../../../build/check-bundle.mjs'
import { styleFreshness, styleHash, styleRecord } from '../../../build/style-fresh.mjs'

const A = 'export const a = 1\n'
const SFC = '<template><div /></template>\n<script>\nexport default { name: \'B\' }\n</script>\n'

/**
 * @param {object} opts map fields
 * @return {string} a source map like vite writes it (sources relative to js/)
 */
function map(opts = {}) {
	return JSON.stringify({
		version: 3,
		file: 'knorke-main.mjs',
		sources: ['../src/a.js', '../src/views/B.vue', '../node_modules/vue/x.js', '\0plugin-vue:export-helper', '../src/views/B.vue?vue&type=style&index=0&lang.css'],
		sourcesContent: [A, SFC, 'vendor code', 'helper', '.b{}'],
		names: [],
		mappings: '',
		...opts,
	})
}

/**
 * @param {Record<string, string>} files path → content
 * @param {(dir: string) => void} fn check
 */
function withTree(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), 'knorke-fresh-'))
	try {
		for (const [p, c] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, p)), { recursive: true })
			writeFileSync(join(dir, p), c)
		}
		fn(dir)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const TREE = {
	'src/a.js': A,
	'src/views/B.vue': SFC,
	'src/scene/index.js': 'export { a } from \'../a.js\'\n',
	'js/knorke-main.mjs': '/* bundle */',
	'js/knorke-main.mjs.map': map(),
	'js/vendor-x.chunk.mjs.map': JSON.stringify({ version: 3, sources: ['../node_modules/vue/y.js'], sourcesContent: ['v'], names: [], mappings: '' }),
}

test('check-fresh: a bundle built from the files on disk passes; node_modules, virtual and ?query entries are skipped', () => {
	withTree(TREE, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, true, r.errors.join('\n'))
		assert.equal(r.checked, 2)
		assert.deepEqual(r.maps, ['knorke-main.mjs.map', 'vendor-x.chunk.mjs.map'])
		assert.deepEqual(r.unmapped, ['src/scene/index.js'])
		assert.match(r.lines.join('\n'), /2 src\/ entries in 2 maps, 0 differing/)
	})
})

test('check-fresh: a source saved after the build fails and names the file (C-1b-01)', () => {
	withTree({ ...TREE, 'src/a.js': 'export const a = fieldValue(it, \'data.\' + which)\n' }, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.deepEqual(r.differ, ['src/a.js [js/knorke-main.mjs.map]'])
		assert.match(r.errors.join('\n'), /stale bundle: src\/a\.js \[js\/knorke-main\.mjs\.map\] differs/)
		assert.match(r.lines.join('\n'), /1 differing/)
	})
	// a one-byte difference (trailing newline) counts as well
	withTree({ ...TREE, 'src/views/B.vue': SFC.trimEnd() }, (dir) => {
		assert.deepEqual(checkFresh(dir).differ, ['src/views/B.vue [js/knorke-main.mjs.map]'])
	})
})

test('check-fresh: a deleted source, a missing sourcesContent and missing maps fail', () => {
	withTree(TREE, (dir) => {
		unlinkSync(join(dir, 'src/a.js'))
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.deepEqual(r.missing, ['src/a.js [js/knorke-main.mjs.map]'])
	})
	withTree({ ...TREE, 'js/knorke-main.mjs.map': map({ sourcesContent: [A, null] }) }, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.deepEqual(r.unverifiable, ['src/views/B.vue [js/knorke-main.mjs.map]'])
	})
	const noMaps = { ...TREE }
	delete noMaps['js/knorke-main.mjs.map']
	delete noMaps['js/vendor-x.chunk.mjs.map']
	withTree(noMaps, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.match(r.errors.join('\n'), /no js\/\*\.mjs\.map/)
	})
	withTree({ ...TREE, 'js/knorke-main.mjs.map': '{not json' }, (dir) => {
		assert.match(checkFresh(dir).errors.join('\n'), /not valid JSON/)
	})
})

test('check-fresh: sourceRoot is honoured, paths outside src/ (also ../src-old/) are not compared', () => {
	const m = map({ sourceRoot: '../src/', sources: ['a.js', '../src-old/a.js', '../srcx.js'], sourcesContent: [A, 'old', 'x'] })
	withTree({ ...TREE, 'js/knorke-main.mjs.map': m }, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, true, r.errors.join('\n'))
		assert.equal(r.checked, 1)
	})
	withTree({ ...TREE, 'js/knorke-main.mjs.map': m, 'src/a.js': 'changed' }, (dir) => {
		assert.deepEqual(checkFresh(dir).differ, ['src/a.js [js/knorke-main.mjs.map]'])
	})
})

test('check-bundle: a stale bundle fails the build check (source saved while vite bundled)', () => {
	const bundle = {
		'js/knorke-main.mjs': 'import "./vendor-AbC123.chunk.mjs"',
		'js/vendor-AbC123.chunk.mjs': 'export const v = 1',
		'js/canvas-dEf456.chunk.mjs': 'class Rect{};Rect.prototype.className="Rect";',
		'css/knorke-style.css': '.x{}',
		'src/a.js': A,
		'src/views/B.vue': SFC,
		'js/knorke-main.mjs.map': map(),
	}
	withTree(bundle, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
	})
	withTree({ ...bundle, 'src/a.js': 'export const a = 2\n' }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /ERROR stale bundle: src\/a\.js/)
	})
	const noMap = { ...bundle }
	delete noMap['js/knorke-main.mjs.map']
	withTree(noMap, (dir) => {
		assert.match(checkBundle(dir).lines.join('\n'), /ERROR no js\/\*\.mjs\.map/)
	})
})

// ---- SPEC-M1 §9.5 WP-C4 (b), R19 T4-26: CSS through js/knorke-style.fresh.json ----

const CSS = '.knorke-board { color: red; }\n'

/**
 * @param {Record<string, string>} hashes repo path → css text the build saw
 * @return {string} the record the build plugin writes
 */
function record(hashes) {
	return styleRecord(new Map(Object.entries(hashes).map(([p, text]) => [p, styleHash(text)])))
}

const STYLED = { ...TREE, 'src/styles/knorke.css': CSS, 'js/knorke-style.fresh.json': record({ 'src/styles/knorke.css': CSS }) }

test('A-02 check-fresh CSS: a stylesheet built from the CSS on disk passes; the first line stays, an indented css line follows', () => {
	withTree(STYLED, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, true, r.errors.join('\n'))
		assert.equal(r.lines[0], '  2 src/ entries in 2 maps, 0 differing, 0 missing, 0 without sourcesContent', 'the JS line is unchanged')
		assert.equal(r.lines[1], '  css: 1 src/styles entries, 0 differing, 0 missing')
		assert.deepEqual(r.css, { checked: 1, differ: [], missing: [], errors: [] })
	})
	// no src/styles at all (older fixtures, other apps): nothing to compare, no record needed
	withTree(TREE, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, true, r.errors.join('\n'))
		assert.equal(r.lines[1], '  css: 0 src/styles entries, 0 differing, 0 missing')
	})
})

test('A-02 check-fresh CSS: a CSS source changed after the hash makes the gate red (stale css/knorke-style.css)', () => {
	withTree({ ...STYLED, 'src/styles/knorke.css': CSS.replace('red', 'blue') }, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.deepEqual(r.css.differ, ['src/styles/knorke.css'])
		assert.match(r.errors.join('\n'), /stale CSS: src\/styles\/knorke\.css differs from the source of css\/knorke-style\.css/)
		assert.equal(r.lines[1], '  css: 1 src/styles entries, 1 differing, 0 missing')
		assert.match(r.lines.join('\n'), /rebuild with dev\/build\.sh/)
		assert.deepEqual(r.differ, [], 'the JS maps are still fresh: only the CSS line turns red')
	})
	// one byte (a trailing newline) counts, as for the JS sources
	withTree({ ...STYLED, 'src/styles/knorke.css': CSS.trimEnd() }, (dir) => {
		assert.deepEqual(checkFresh(dir).css.differ, ['src/styles/knorke.css'])
	})
})

test('A-02 check-fresh CSS: no record, a CSS file without entry, an entry whose file is gone, a broken record → red', () => {
	const noRecord = { ...STYLED }
	delete noRecord['js/knorke-style.fresh.json']
	withTree(noRecord, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.match(r.errors.join('\n'), /no js\/knorke-style\.fresh\.json/)
		assert.deepEqual(r.css.missing, ['src/styles/knorke.css'])
		assert.equal(r.lines[1], '  css: 1 src/styles entries, 0 differing, 1 missing')
	})
	withTree({ ...STYLED, 'src/styles/extra.css': '.x{}' }, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.deepEqual(r.css.missing, ['src/styles/extra.css'])
		assert.match(r.errors.join('\n'), /src\/styles\/extra\.css has no entry/)
	})
	withTree({ ...STYLED, 'js/knorke-style.fresh.json': record({ 'src/styles/knorke.css': CSS, 'src/styles/old.css': '.o{}' }) }, (dir) => {
		const r = checkFresh(dir)
		assert.equal(r.ok, false)
		assert.deepEqual(r.css.missing, ['src/styles/old.css'])
		assert.match(r.errors.join('\n'), /src\/styles\/old\.css is recorded in js\/knorke-style\.fresh\.json but gone from disk/)
	})
	withTree({ ...STYLED, 'js/knorke-style.fresh.json': '{not json' }, (dir) => {
		assert.match(checkFresh(dir).errors.join('\n'), /knorke-style\.fresh\.json is not valid JSON/)
	})
	withTree({ ...STYLED, 'js/knorke-style.fresh.json': '{"files": []}' }, (dir) => {
		assert.match(checkFresh(dir).errors.join('\n'), /has no "files" map/)
	})
	// only plain files directly in src/styles count (no nested folders, no other types)
	withTree({ ...STYLED, 'src/styles/sub/deep.css': '.d{}', 'src/styles/notes.md': '# x' }, (dir) => {
		assert.equal(checkFresh(dir).ok, true)
	})
})

test('A-02 check-bundle: a stale CSS source fails the build check too', () => {
	const bundle = {
		'js/knorke-main.mjs': 'import "./vendor-AbC123.chunk.mjs"',
		'js/vendor-AbC123.chunk.mjs': 'export const v = 1',
		'js/canvas-dEf456.chunk.mjs': 'class Rect{};Rect.prototype.className="Rect";',
		'css/knorke-style.css': '.knorke-board{color:red}',
		'src/a.js': A,
		'src/views/B.vue': SFC,
		'src/styles/knorke.css': CSS,
		'js/knorke-main.mjs.map': map(),
		'js/knorke-style.fresh.json': record({ 'src/styles/knorke.css': CSS }),
	}
	withTree(bundle, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, true, r.lines.join('\n'))
		assert.doesNotMatch(r.lines.join('\n'), /unexpected file/, 'the record is no .mjs: still exactly three bundle files')
	})
	withTree({ ...bundle, 'src/styles/knorke.css': '.knorke-board { color: green; }\n' }, (dir) => {
		const r = checkBundle(dir)
		assert.equal(r.ok, false)
		assert.match(r.lines.join('\n'), /ERROR stale CSS: src\/styles\/knorke\.css/)
	})
})

test('A-02 build plugin: transform hashes exactly the text vite hands it (only src/styles/*.css, no query, no virtual id), changes no code; generateBundle emits js/knorke-style.fresh.json', () => {
	withTree(STYLED, (dir) => {
		const p = styleFreshness(dir)
		assert.equal(p.enforce, 'pre', 'before vite:css (which turns the CSS into a module)')
		p.buildStart()
		const abs = (rel) => join(dir, ...rel.split('/'))
		assert.equal(p.transform(CSS, abs('src/styles/knorke.css')), null, 'no code change: js/ and css/ stay as they are')
		assert.equal(p.transform('.q{}', abs('src/styles/knorke.css') + '?inline'), null)
		assert.equal(p.transform('.v{}', '\0virtual:' + abs('src/styles/v.css')), null)
		assert.equal(p.transform('.n{}', abs('src/styles/sub/n.css')), null)
		assert.equal(p.transform('export const a = 1', abs('src/a.js')), null)
		assert.equal(p.transform('.o{}', join(dir, '..', 'other', 'src', 'styles', 'o.css')), null)
		const emitted = []
		p.generateBundle.call({ emitFile: (f) => emitted.push(f) })
		assert.equal(emitted.length, 1)
		assert.equal(emitted[0].type, 'asset')
		assert.equal(emitted[0].fileName, 'js/knorke-style.fresh.json')
		const rec = JSON.parse(emitted[0].source)
		assert.deepEqual(rec, { version: 1, algorithm: 'sha256', files: { 'src/styles/knorke.css': styleHash(CSS) } }, 'only the plain src/styles/*.css, hashed from the transformed text')
		assert.equal(styleHash(CSS), createHash('sha256').update(Buffer.from(CSS, 'utf8')).digest('hex'))
		// the record the plugin wrote proves the CSS on disk fresh; a later edit turns it red
		writeFileSync(join(dir, 'js', 'knorke-style.fresh.json'), emitted[0].source)
		assert.equal(checkFresh(dir).ok, true)
		writeFileSync(join(dir, 'src', 'styles', 'knorke.css'), CSS + '.later { margin: 0; }\n')
		assert.deepEqual(checkFresh(dir).css.differ, ['src/styles/knorke.css'])
		// a new build starts from an empty set
		p.buildStart()
		const again = []
		p.generateBundle.call({ emitFile: (f) => again.push(f) })
		assert.deepEqual(JSON.parse(again[0].source).files, {})
	})
})
