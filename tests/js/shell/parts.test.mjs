/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 217 (AK5): util/parts.js loadPart, the lazy parts most
 * visitors never use.
 * - a loader that rejects (an old tab after an update asks for a chunk that
 *   is gone): null, one console.error, the toast "This part of Knorke could
 *   not be loaded. Reload the page." with the hook part-load-failed, nothing
 *   thrown; the next call asks the loader again
 * - a loaded part is kept: one import for every later call, also for two
 *   calls at the same time; an unknown name is a failure like a rejection
 * - every import() of PARTS goes to a root of build/lazy-areas.mjs (the
 *   chunk the build makes of it), and the vector part gives the four pieces
 *   KonvaRenderer.renderVector draws with
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { posix } from 'node:path'
import { LAZY_AREAS } from '../../../build/lazy-areas.mjs'
import { PARTS, loadPart } from '../../../src/util/parts.js'

const FAILED = 'This part of Knorke could not be loaded. Reload the page.'

test('job 217 AK5: a rejecting loader gives null, one console.error and the toast part-load-failed; the next call tries again', async (t) => {
	t.mock.method(console, 'error', () => {})
	const toasts = []
	const toast = (m, o) => toasts.push([m, o?.hook ?? null])
	let calls = 0
	const loaders = { bpmn: async () => { calls++; throw new TypeError('Failed to fetch dynamically imported module') } }
	assert.equal(await loadPart('bpmn', { loaders, toast }), null)
	assert.deepEqual(toasts, [[FAILED, 'part-load-failed']])
	assert.equal(console.error.mock.callCount(), 1)
	assert.match(String(console.error.mock.calls[0].arguments[0]), /\[knorke\] part bpmn could not be loaded/)
	assert.equal(await loadPart('bpmn', { loaders, toast }), null)
	assert.equal(calls, 2, 'a failure is not kept')
	assert.equal(toasts.length, 2)
	// a loader that throws at once is the same
	assert.equal(await loadPart('share', { loaders: { share: () => { throw new Error('sync') } }, toast }), null)
	assert.equal(await loadPart('nope', { loaders, toast }), null, 'unknown part')
	assert.equal(toasts.length, 4)
})

test('job 217 AK5: a loaded part is kept, two calls at once share one import', async () => {
	let calls = 0
	const mod = { default: 'x' }
	const loaders = { admin: async () => { calls++; return mod } }
	const toast = () => assert.fail('no toast')
	const [a, b] = await Promise.all([loadPart('admin', { loaders, toast }), loadPart('admin', { loaders, toast })])
	assert.equal(a, mod)
	assert.equal(b, mod)
	assert.equal(await loadPart('admin', { loaders, toast }), mod)
	assert.equal(calls, 1)
	// another loader table keeps its own parts (tests, sessions with deps.parts)
	let other = 0
	assert.deepEqual(await loadPart('admin', { loaders: { admin: async () => { other++; return { default: 'y' } } }, toast }), { default: 'y' })
	assert.equal(other, 1)
})

test('job 217: every import() of PARTS goes to a root of its lazy chunk; the vector part gives what renderVector draws with', async () => {
	assert.deepEqual(Object.keys(PARTS), ['vector', 'pdfDialog', 'bpmn', 'csv', 'shapelib', 'shapeLibDialog', 'admin', 'share', 'aiDialog', 'aiFlow', 'search', 'shortcuts', 'outline', 'privateDialog', 'voteDialog', 'timerDialog'], 'job 220: csv after bpmn; job 268: aiDialog; job 269: aiFlow; job 271: search and shortcuts; job 274: outline; job 275: the moderators\' dialogs last')
	const roots = new Set(Object.values(LAZY_AREAS).flat())
	const src = readFileSync(new URL('../../../src/util/parts.js', import.meta.url), 'utf8')
	const targets = [...src.matchAll(/import\('\.\.\/([^']+)'\)/g)].map((m) => 'src/' + m[1])
	assert.equal(targets.length, 18, 'job 275: privateDialog, voteDialog, timerDialog')
	for (const x of targets) {
		assert.ok(roots.has(x), x + ' is a root of build/lazy-areas.mjs')
	}
	const vector = await loadPart('vector')
	assert.deepEqual(Object.keys(vector).sort(), ['VectorContext', 'parseFont', 'pdfDocument', 'svgDocument'])
	for (const f of Object.values(vector)) {
		assert.equal(typeof f, 'function')
	}
	assert.equal(typeof (await loadPart('bpmn')).readBpmnFile, 'function')
	assert.equal(typeof (await loadPart('csv')).readCsvFile, 'function', 'job 220')
	assert.equal(typeof (await loadPart('shapelib')).importShapes, 'function')
})

/**
 * @param {string} dir directory below the app root
 * @param {string[]} [out] accumulator
 * @return {string[]} .js/.vue files below it, relative to the app root
 */
function sources(dir, out = []) {
	for (const e of readdirSync(new URL('../../../' + dir, import.meta.url), { withFileTypes: true })) {
		const rel = dir + '/' + e.name
		if (e.isDirectory()) sources(rel, out)
		else if (/\.(js|vue)$/.test(e.name)) out.push(rel)
	}
	return out
}

test('job 217: no module outside the lazy parts imports one of their roots statically (only util/parts.js reaches them, by import())', () => {
	const roots = new Set(Object.values(LAZY_AREAS).flat())
	const lazy = new Set(roots)
	for (const file of sources('src')) {
		if (lazy.has(file)) continue
		const text = readFileSync(new URL('../../../' + file, import.meta.url), 'utf8')
		for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"()]*?(?:from\s*)?'(\.[^']+)'/gm)) {
			const target = posix.normalize(posix.join(posix.dirname(file), m[1]))
			assert.ok(!roots.has(target), `${file} imports ${target} statically`)
		}
	}
})

test('job 217 wiring: the share dialog, the PDF dialog and the dialog of an own shape library open once their part is loaded; the file fields still open in the click', () => {
	const read = (f) => readFileSync(new URL('../../../src/' + f, import.meta.url), 'utf8')
	const view = read('views/BoardView.vue')
	assert.match(view, /@share="openShare"/)
	assert.match(view, /const ShareDialog = partComponent\('share'\)/)
	assert.match(view.match(/async function openShare\(\) \{[\s\S]*?\n\}/)?.[0] ?? '', /if \(await loadPart\('share'\)\) \{\s+shareOpen\.value = isOwner\.value \|\| isMod\.value\s+\}/, 'opens only while the right still holds')
	assert.match(view, /<ShareDialog v-if="shareOpen && board"/)
	const panel = read('components/ShapesPanel.vue')
	assert.match(panel, /const ShapeLibDialog = partComponent\('shapeLibDialog'\)/)
	assert.equal([...panel.matchAll(/@click="openDialog\(\{ mode: '(rename|suggest|delete)', lib: sec\.lib \}\)"/g)].length, 3)
	assert.doesNotMatch(panel, /dialog = \{ mode:/, 'every dialog goes through openDialog')
	assert.match(panel.match(/async function openDialog\(d\) \{[\s\S]*?\n\}/)?.[0] ?? '', /if \(await loadPart\('shapeLibDialog'\)\) \{\s+dialog\.value = d/)
	const files = panel.match(/async function onFiles\(ev\) \{[\s\S]*?\n\}/)?.[0] ?? ''
	assert.ok(files.indexOf('await f.text()') < files.indexOf("loadPart('shapelib')"), 'the files are read first, the part comes after the pick')
	assert.match(files, /const lib = await loadPart\('shapelib'\)\s+if \(!lib\) return\s+const draft = await lib\.importShapes\(/)
})
