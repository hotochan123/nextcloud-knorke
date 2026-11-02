/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 182 (AK9, from round 1 on): board/ownTemplates.js with the
 * real SceneModel.
 * - the content of the whole board and of a selection: a board file with
 *   title "", without react, lock, pids or names, accepted by readBoardFile
 * - the sketch: frames '' first, notes with their colour, other fills grey,
 *   children at their absolute place, no connectors, at most 40 entries,
 *   every number inside the 120 × 80 box
 * - 1001 objects or more than 2 MiB: too-large; an empty board: empty
 * - the limits equal lib/Service/TemplateStore.php's (round 2: 10 open
 *   suggestions, a note of 200)
 * - the tiles of the dialog and the admin section (templateTile,
 *   sketchRects), the start name
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readBoardFile } from '../../../src/board/boardFile.js'
import {
	SKETCH_FILL, SKETCH_H, SKETCH_PAD, SKETCH_W, TEMPLATE_MAX_BYTES, TEMPLATE_MAX_ITEMS, TEMPLATE_MAX_PENDING, TEMPLATE_NAME_MAX, TEMPLATE_NOTE_MAX,
	TEMPLATE_SKETCH_MAX, cleanName, ownSketch, sketchRects, templateData, templateDraft, templateName, templateTile, templateTiles,
} from '../../../src/board/ownTemplates.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const ANNA = 'a1b2c3d4e5f60718'
const BOB = 'b0b1b2b3b4b5b6b7'
const F = ID(1)
const C = ID(2)
const N = ID(3)
const S = ID(4)
const T = ID(5)
const K = ID(6)
const G = ID(7)

/** A frame with a child, a note with Anna's reaction, a shape locked by Bob, a text and a connector. */
const ITEMS = Object.freeze([
	frame(F, { x: -900, y: 0, w: 700, h: 500, data: { title: 'Rahmen' } }),
	sticky(C, { x: 40, y: 60, z: 'i1', parent: F, data: { text: 'Kind' }, style: { fill: '#C9F0C9' } }),
	sticky(N, { x: 0, y: 0, z: 'i2', data: { text: 'Notiz', react: { ['p' + ANNA]: { e: '1f44d', n: 'Anna' } } }, style: { fill: '#ffd5a8' } }),
	shape(S, { x: 400, y: 0, z: 'i3', data: { kind: 'ellipse', text: 'Form' }, lock: { by: BOB, name: 'Bob' } }),
	textItem(T, { x: 0, y: 400, z: 'i4', data: { text: 'Freier Text' } }),
	connector(K, { item: N }, { item: S }, { z: 'i5' }),
])

/** @param {object[]} items WireItems @return {SceneModel} */
function modelOf(items) {
	const m = new SceneModel()
	m.load(structuredClone(items))
	return m
}

const inBox = (e) => e.length === 5 && e[0] >= 0 && e[0] <= SKETCH_W && e[2] >= 0 && e[2] <= SKETCH_W && e[1] >= 0 && e[1] <= SKETCH_H && e[3] >= 0 && e[3] <= SKETCH_H
	&& e.slice(0, 4).every((v) => typeof v === 'number' && Number.isFinite(v) && Math.round(v * 100) / 100 === v)

test('AK9 the whole board: a board file with title "", without react, lock, pids or names; readBoardFile accepts it', () => {
	const m = modelOf(ITEMS)
	assert.equal(m.get(N).data.react['p' + ANNA].n, 'Anna', 'precondition: the reaction')
	assert.deepEqual(m.get(S).lock, { by: BOB, name: 'Bob' }, 'precondition: the lock')
	const d = templateDraft(m, 'board')
	assert.equal(d.ok, true)
	const f = JSON.parse(d.content)
	assert.deepEqual(Object.keys(f), ['knorke', 'kind', 'title', 'origin', 'items', 'tags'], 'job 191: with tags')
	assert.deepEqual([f.knorke, f.kind, f.title, f.items.length], [1, 'board', '', ITEMS.length])
	for (const word of ['Anna', 'Bob', ANNA, BOB, '"react"', '"lock"', '"board":']) {
		assert.ok(!d.content.includes(word), `no ${word} in the content`)
	}
	const r = readBoardFile(d.content)
	assert.equal(r.ok, true, 'readBoardFile accepts it')
	assert.equal(r.payload.items.length, ITEMS.length)
	assert.deepEqual(templateData(m, 'board'), f)
})

test('AK9 a selection: the same envelope with copyPayload\'s items (a frame with its child); readBoardFile accepts it', () => {
	const m = modelOf(ITEMS)
	const d = templateDraft(m, 'selection', [F, S])
	assert.equal(d.ok, true)
	const f = JSON.parse(d.content)
	assert.deepEqual(Object.keys(f), ['knorke', 'kind', 'title', 'origin', 'items', 'tags'], 'job 191: with tags')
	assert.deepEqual(f.items.map((it) => it.id).sort(), [F, C, S].sort(), 'the frame, its child and the shape')
	assert.equal(f.title, '')
	assert.ok(!d.content.includes('"lock"') && !d.content.includes('Bob'))
	assert.equal(readBoardFile(d.content).ok, true)
	assert.equal(d.sketch.length, 3)
	assert.deepEqual(templateDraft(m, 'selection', []), { ok: false, reason: 'empty' }, 'nothing selected')
})

test('AK9 the sketch: frames first with \'\', notes with their colour (lower case), others grey; children at their absolute place; no connector; numbers in the box, to scale and centred', () => {
	const sk = templateDraft(modelOf(ITEMS), 'board').sketch
	assert.equal(sk.length, ITEMS.length - 1, 'every item but the connector')
	assert.ok(sk.every(inBox), 'every number inside the box, rounded to 0.01')
	// the union of the boxes: x −900 … 600, y 0 … 500 → s = min(112 / 1500, 72 / 500)
	const s = Math.min((SKETCH_W - 2 * SKETCH_PAD) / 1500, (SKETCH_H - 2 * SKETCH_PAD) / 500)
	const ox = (SKETCH_W - 1500 * s) / 2
	const oy = (SKETCH_H - 500 * s) / 2
	const at = (x, y, w, h) => [x, y, w, h].map((v, i) => Math.round((i === 0 ? ox + (v + 900) * s : i === 1 ? oy + v * s : v * s) * 100) / 100)
	assert.deepEqual(sk[0], [...at(-900, 0, 700, 500), ''], 'the frame first, without fill')
	assert.deepEqual(sk[1], [...at(-860, 60, 200, 200), '#c9f0c9'], 'the child at its absolute place (frame + 40, 60)')
	assert.deepEqual(sk[2], [...at(0, 0, 200, 200), '#ffd5a8'], 'the note in its colour')
	assert.deepEqual(sk[3], [...at(400, 0, 200, 120), '#ffffff'], 'the shape\'s #rrggbb fill')
	assert.deepEqual(sk[4], [...at(0, 400, 240, 28.8), SKETCH_FILL], 'no #rrggbb fill: grey')
	assert.equal(sk[0][0], 4, 'the wide side touches the margin')
	assert.equal(SKETCH_FILL, '#d0d0d0')
})

test('AK9 the sketch: at most 40 entries, the frames first even when they come last', () => {
	const notes = Array.from({ length: 45 }, (_, i) => sticky(ID(100 + i), { x: (i % 9) * 220, y: Math.floor(i / 9) * 220, z: 'i' + String(i).padStart(2, '0'), style: { fill: '#faea89' } }))
	const frames = [frame(ID(200), { x: 0, y: 1200, z: 'k1' }), frame(ID(201), { x: 900, y: 1200, z: 'k2' })]
	const sk = templateDraft(modelOf([...notes, ...frames]), 'board').sketch
	assert.equal(sk.length, TEMPLATE_SKETCH_MAX)
	assert.deepEqual(sk.slice(0, 2).map((e) => e[4]), ['', ''], 'the two frames first')
	assert.ok(sk.slice(2).every((e) => e[4] === '#faea89'))
	assert.ok(sk.every(inBox))
	assert.deepEqual(ownSketch([]), [])
	assert.deepEqual(ownSketch([connector(K, { x: 0, y: 0 }, { x: 10, y: 10 })]), [], 'only connectors: an empty sketch')
	const dot = ownSketch([textItem(T, { w: 0, h: 0, x: 5, y: 5 })])
	assert.ok(dot.length === 1 && inBox(dot[0]), 'a box without size stays in the box')
})

test('AK9 1001 objects or more than 2 MiB: too-large; an empty board: empty', () => {
	const many = Array.from({ length: TEMPLATE_MAX_ITEMS + 1 }, (_, i) => sticky(ID(1000 + i), { x: i * 10 }))
	assert.deepEqual(templateDraft(modelOf(many), 'board'), { ok: false, reason: 'too-large' })
	assert.equal(templateDraft(modelOf(many.slice(0, TEMPLATE_MAX_ITEMS)), 'board').ok, true, 'exactly 1000 is fine')
	const big = Array.from({ length: 400 }, (_, i) => sticky(ID(3000 + i), { x: i * 10, data: { text: 'ü'.repeat(3000) } }))
	assert.ok(JSON.stringify(big).length < TEMPLATE_MAX_BYTES, 'precondition: below 2 MiB in UTF-16 units')
	assert.deepEqual(templateDraft(modelOf(big), 'board'), { ok: false, reason: 'too-large' }, 'over 2 MiB as UTF-8 (ü is two bytes)')
	assert.deepEqual(templateDraft(modelOf([]), 'board'), { ok: false, reason: 'empty' })
})

test('AK9 the limits equal lib/Service/TemplateStore.php\'s', () => {
	const php = readFileSync(new URL('../../../lib/Service/TemplateStore.php', import.meta.url), 'utf8')
	const c = (name) => Number(new RegExp(`public const ${name} = (\\d+);`).exec(php)?.[1])
	assert.equal(TEMPLATE_MAX_PENDING, c('MAX_PENDING'))
	assert.equal(TEMPLATE_MAX_ITEMS, c('MAX_ITEMS'))
	assert.equal(TEMPLATE_MAX_BYTES, c('MAX_BYTES'))
	assert.equal(TEMPLATE_NAME_MAX, c('NAME_MAX'))
	assert.equal(TEMPLATE_NOTE_MAX, c('NOTE_MAX'))
	assert.equal(TEMPLATE_SKETCH_MAX, c('SKETCH_MAX'))
	assert.equal(SKETCH_W, c('SKETCH_W'))
	assert.equal(SKETCH_H, c('SKETCH_H'))
	assert.deepEqual([TEMPLATE_MAX_PENDING, TEMPLATE_MAX_ITEMS, TEMPLATE_MAX_BYTES, TEMPLATE_NAME_MAX, TEMPLATE_NOTE_MAX, TEMPLATE_SKETCH_MAX], [10, 1000, 2097152, 100, 200, 40])
})

test('the start name: the board title cut to 100 characters (code points); cleanName trims like Input::title', () => {
	assert.equal(templateName('Retro Q3'), 'Retro Q3')
	assert.equal(templateName('😀'.repeat(120)), '😀'.repeat(100))
	assert.equal(templateName(null), '')
	assert.equal(cleanName('  Retro  '), 'Retro')
	assert.equal(cleanName(5), '')
})

test('the tiles: templateTile with id, name, note and the sketch; sketchRects only takes the server\'s form; templateTiles leaves out what is no template', () => {
	const entry = { id: 42, name: 'Retro', note: 'Für Retros', sketch: [[4, 10, 50, 30, ''], [10, 20, 12.5, 12.5, '#faea89'], [121, 0, 1, 1, ''], [0, 0, 1, 1, 'red'], 'x'], created: 1 }
	assert.deepEqual(templateTile(entry), {
		id: 42, name: 'Retro', note: 'Für Retros',
		rects: [{ x: 4, y: 10, w: 50, h: 30, frame: true, fill: null }, { x: 10, y: 20, w: 12.5, h: 12.5, frame: false, fill: '#faea89' }],
	})
	assert.equal(templateTile({ id: 1, name: 'A', sketch: [] }).note, null, 'an adopted template has no note')
	assert.equal(templateTile({ ...entry, note: '' }).note, null)
	for (const bad of [null, {}, { ...entry, id: 0 }, { ...entry, id: 1.5 }, { ...entry, id: '42' }, { ...entry, name: '' }]) {
		assert.equal(templateTile(bad), null, JSON.stringify(bad))
	}
	assert.deepEqual(templateTiles([entry, null, { id: 'x' }, { id: 7, name: 'B', sketch: null }]).map((e) => e.id), [42, 7])
	assert.deepEqual(templateTiles(null), [])
	assert.deepEqual(sketchRects(null), [])
})
