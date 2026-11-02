/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 221: the sketches of the board list (components/sketch.js,
 * components/boardSketches.js, components/BoardSketch.vue,
 * views/BoardList.vue).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useSfc } from './sfc.mjs'

useSfc()
// @nextcloud/router needs a web root outside a browser (board-list hrefs)
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const { MAX_PARALLEL, createSketches, sketches } = await import('../../../src/components/boardSketches.js')
const sketch = await import('../../../src/components/sketch.js')
const ownTemplates = await import('../../../src/board/ownTemplates.js')
const boardsApi = await import('../../../src/api/boards.js')
const BoardSketch = (await import('../../../src/components/BoardSketch.vue')).default
const BoardList = (await import('../../../src/views/BoardList.vue')).default

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
/** Lets every pending promise settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** A route 57 stand-in whose answers the test hands out one by one. */
function fakeFetch() {
	const pending = []
	const fn = (id) => new Promise((resolve, reject) => pending.push({ id, resolve, reject }))
	return { fn, pending }
}

test('job 221 AK5: at most 3 requests at once for 10 rows, the rest follow in order', async () => {
	assert.equal(MAX_PARALLEL, 3)
	const f = fakeFetch()
	const s = createSketches({ fetch: f.fn })
	for (let id = 1; id <= 10; id++) {
		s.want(id, 100 + id)
	}
	await settle()
	assert.deepEqual(f.pending.map((p) => p.id), [1, 2, 3], 'three at once')
	f.pending[0].resolve([[4, 4, 10, 10, '#ffeb3b']])
	await settle()
	assert.deepEqual(f.pending.map((p) => p.id), [1, 2, 3, 4], 'the next one starts when one ends')
	f.pending[1].reject(new Error('offline'))
	f.pending[2].resolve([])
	await settle()
	assert.deepEqual(f.pending.map((p) => p.id), [1, 2, 3, 4, 5, 6])
	for (let i = 3; i < 10; i++) {
		f.pending[i].resolve([])
		await settle()
	}
	assert.deepEqual(f.pending.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
	assert.deepEqual(s.rectsOf(1, 101), [{ x: 4, y: 4, w: 10, h: 10, frame: false, fill: '#ffeb3b' }])
	assert.deepEqual(s.rectsOf(1, 999), [], 'another updatedAt: nothing')
})

test('job 221 AK5: asked once per updatedAt (a failure too, no retry); a new updatedAt asks again; a late answer for an old updatedAt is dropped', async () => {
	const f = fakeFetch()
	const s = createSketches({ fetch: f.fn })
	s.want(1, 10)
	s.want(1, 10)
	await settle()
	assert.equal(f.pending.length, 1, 'asked while asked: no second request')
	f.pending[0].reject(new Error('500'))
	await settle()
	assert.deepEqual(s.rectsOf(1, 10), [], 'a failure: the icon')
	s.want(1, 10)
	await settle()
	assert.equal(f.pending.length, 1, 'no retry for the same updatedAt')
	s.want(1, 20)
	await settle()
	assert.equal(f.pending.length, 2, 'the board changed: ask again')
	s.want(1, 30)
	await settle()
	f.pending[1].resolve([[1, 1, 1, 1, '#111111']])
	f.pending[2].resolve([[2, 2, 2, 2, '#222222']])
	await settle()
	assert.deepEqual(s.rectsOf(1, 20), [], 'the answer for an old updatedAt is gone')
	assert.deepEqual(s.rectsOf(1, 30), [{ x: 2, y: 2, w: 2, h: 2, frame: false, fill: '#222222' }])
})

test('job 221 AK5: only the server\'s form passes (numbers inside the box, \'\' or #rrggbb, at most 40)', async () => {
	const f = fakeFetch()
	const s = createSketches({ fetch: f.fn })
	s.want(5, 1)
	await settle()
	f.pending[0].resolve([
		[0, 0, 120, 80, ''],
		[4, 4, 10, 10, '#ABCDEF'],
		[121, 0, 1, 1, '#ffffff'],
		[0, 81, 1, 1, '#ffffff'],
		[0, 0, -1, 1, '#ffffff'],
		[Number.NaN, 0, 1, 1, '#ffffff'],
		['1', 0, 1, 1, '#ffffff'],
		[1, 1, 1, 1, 'red'],
		[1, 1, 1, 1, '</svg><script>alert(1)</script>'],
		[1, 1, 1, 1],
		'<rect/>',
		null,
	])
	await settle()
	assert.deepEqual(s.rectsOf(5, 1), [
		{ x: 0, y: 0, w: 120, h: 80, frame: true, fill: null },
		{ x: 4, y: 4, w: 10, h: 10, frame: false, fill: '#abcdef' },
	])
	s.want(6, 1)
	await settle()
	f.pending[1].resolve(Array.from({ length: 50 }, (_, i) => [i, 0, 1, 1, '#000000']))
	await settle()
	assert.equal(s.rectsOf(6, 1).length, sketch.TEMPLATE_SKETCH_MAX)
	assert.equal(sketch.TEMPLATE_SKETCH_MAX, 40)
	assert.deepEqual([sketch.SKETCH_W, sketch.SKETCH_H, sketch.SKETCH_PAD, sketch.SKETCH_FILL], [120, 80, 4, '#d0d0d0'])
})

/**
 * @param {string} html SSR HTML
 * @return {string[]} the names of all elements inside the first svg, the svg included
 */
function svgTags(html) {
	const svg = html.match(/<svg[\s\S]*?<\/svg>/)
	assert.ok(svg, 'an svg')
	return [...svg[0].matchAll(/<([a-zA-Z][\w-]*)/g)].map((m) => m[1])
}

test('job 221 AK6: a row with a sketch shows svg[data-knorke-sketch] (aria-hidden, only rects, no text); without one the board icon', async () => {
	const rects = [{ x: 4, y: 4, w: 50, h: 30, frame: true, fill: null }, { x: 10, y: 10, w: 8, h: 8, frame: false, fill: '#ffeb3b' }]
	const loader = { want: () => {}, rectsOf: (id, at) => (id === 1 && at === 5 ? rects : []) }
	const html = await renderToString(createSSRApp(BoardSketch, { boardId: 1, updatedAt: 5, loader }))
	assert.match(html, /<span class="knorke-list__icon" aria-hidden="true">/)
	assert.match(html, /<svg[^>]*data-knorke-sketch/)
	assert.match(html, /<svg[^>]*class="knorke-templates__sketch knorke-list__sketch"/)
	assert.match(html, /<svg[^>]*aria-hidden="true"/)
	assert.match(html, /viewBox="0 0 120 80"/i)
	assert.deepEqual(svgTags(html), ['svg', 'rect', 'rect'], 'nothing but rects: no text, no image, no link')
	assert.match(html, /fill="#ffeb3b"/)
	assert.doesNotMatch(html, /data-stub="NcIconSvgWrapper"/)
	for (const props of [{ boardId: 1, updatedAt: 6 }, { boardId: 2, updatedAt: 5 }]) {
		const icon = await renderToString(createSSRApp(BoardSketch, { ...props, loader }))
		assert.doesNotMatch(icon, /<svg/, 'no sketch for another board or updatedAt')
		assert.match(icon, /data-stub="NcIconSvgWrapper"/, 'the board icon')
	}
})

test('job 221 AK6: the board list shows the sketch inside the link, before the title; the link text stays; an empty board keeps the icon', async () => {
	globalThis._nc_auth_requestToken = 'tok1'
	boardsApi.deps.urlOf = (p) => '/index.php/apps/knorke' + p
	const asked = []
	boardsApi.deps.request = async (method, url) => {
		asked.push(method + ' ' + url)
		return url.endsWith('/1/sketch') ? { sketch: [[4, 4, 112, 72, ''], [20, 20, 10, 10, '#ffeb3b']] } : { sketch: [] }
	}
	sketches.want(1, 500)
	sketches.want(2, 600)
	await settle()
	assert.deepEqual(asked, ['GET /index.php/apps/knorke/api/v1/boards/1/sketch', 'GET /index.php/apps/knorke/api/v1/boards/2/sketch'])
	const boards = [
		{ id: 1, title: 'Retro', role: 'owner', source: 'own', updatedAt: 500, favorite: false },
		{ id: 2, title: 'Empty', role: 'owner', source: 'own', updatedAt: 600, favorite: false },
	]
	const html = await renderToString(createSSRApp(BoardList, { boards, loading: false, error: '', filter: 'all', favoriteBusy: [] }))
	const row = (id) => html.match(new RegExp(`<li[^>]*data-knorke-board="${id}"[\\s\\S]*?</li>`))[0]
	const link1 = row(1).match(/<a class="knorke-list__link"[\s\S]*?<\/a>/)[0]
	assert.ok(link1.indexOf('data-knorke-sketch') > 0 && link1.indexOf('data-knorke-sketch') < link1.indexOf('Retro'), 'in the link, before the title')
	assert.deepEqual(svgTags(link1), ['svg', 'rect', 'rect'])
	assert.equal(link1.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().startsWith('Retro'), true, 'the link text starts with the title, as before')
	assert.doesNotMatch(row(2), /data-knorke-sketch/, 'an empty board: no sketch')
	assert.match(row(2), /data-stub="NcIconSvgWrapper"/, 'the board icon')
})

/**
 * @param {string} file absolute path of a module
 * @return {string[]} absolute paths of its relative static imports
 */
function importsOf(file) {
	const src = readFileSync(file, 'utf8')
	return [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/gm)].map((m) => resolve(dirname(file), m[1]))
}

test('job 221 AK7: the board list\'s sketch code pulls nothing of the board into the main bundle; ownTemplates.js re-exports the form', () => {
	const seen = new Set()
	const walk = (file) => {
		if (seen.has(file) || !existsSync(file)) {
			return
		}
		seen.add(file)
		importsOf(file).forEach(walk)
	}
	for (const f of ['src/components/BoardSketch.vue', 'src/components/boardSketches.js', 'src/components/sketch.js']) {
		walk(resolve(ROOT, f))
	}
	const board = [...seen].filter((f) => f.includes('/src/board/') || f.includes('/src/scene/'))
	assert.deepEqual(board, [], 'no module of the board or the scene')
	assert.equal(importsOf(resolve(ROOT, 'src/components/sketch.js')).length, 0, 'sketch.js imports nothing')
	for (const k of ['SKETCH_W', 'SKETCH_H', 'SKETCH_PAD', 'SKETCH_FILL', 'TEMPLATE_SKETCH_MAX', 'sketchRects']) {
		assert.equal(ownTemplates[k], sketch[k], k)
	}
})
