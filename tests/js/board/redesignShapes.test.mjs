/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 260 (design round 3, variant F4): the default border, tone on tone
 * borders from the fill, the sizes on a click, and BPMN keeping its look.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createItem, setStyle } from '../../../src/board/actions.js'
import { readBpmnFile } from '../../../src/board/bpmnFile.js'
import { paletteName } from '../../../src/components/labels.js'
import { applyPatch } from '../../../src/model/paths.js'
import { REDESIGN_KINDS, SQUARE_KINDS, fillBorder, shownBorder, squareOn } from '../../../src/model/shapes.js'
import { LIGHT, PALETTE, SHAPE_BORDER } from '../../../src/model/tokens.js'
import { FakeModel, ID, shape, sticky } from './fakes.mjs'

const S = ID(1)
const FIXTURE = readFileSync(new URL('../../../dev/e2e/fixtures/order-camunda.bpmn', import.meta.url), 'utf8')

test('AK1: a click creates the basic kinds in their F4 size, white with the border #3d4044 width 2; BPMN keeps #191b1d', () => {
	const m = new FakeModel([])
	const sizes = { rect: [200, 120], roundRect: [200, 120], ellipse: [160, 160], diamond: [160, 160], triangle: [160, 140], arrowRight: [200, 100] }
	for (const [kind, [w, h]] of Object.entries(sizes)) {
		const p = createItem(m, { t: 'shape', at: { x: 0, y: 0 }, data: { kind } }, () => S).ops[0].p
		assert.deepEqual([p.w, p.h, p.x, p.y], [w, h, -w / 2, -h / 2], kind)
		assert.deepEqual(p.style, { fill: '#ffffff', stroke: '#3d4044', strokeWidth: 2 }, kind)
	}
	assert.equal(createItem(m, { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'bpmnTask' } }, () => S).ops[0].p.style.stroke, '#191b1d')
	assert.equal(createItem(m, { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'bpmnStart' } }, () => S).ops[0].p.style.stroke, '#191b1d')
	const r = readBpmnFile(FIXTURE)
	const shapes = r.payload.items.filter((it) => it.t === 'shape')
	assert.ok(shapes.length > 5)
	for (const it of shapes) assert.equal(it.style.stroke, '#191b1d', it.data.kind)
})

test('AK2: shownBorder draws the old default border as #3d4044 on the basic and flowchart kinds only', () => {
	assert.equal(shownBorder('rect', '#191b1d'), '#3d4044')
	assert.equal(shownBorder('rect', '#191B1D'), '#3d4044')
	assert.equal(shownBorder('offPage', '#191b1d'), '#3d4044')
	assert.equal(shownBorder('rect', '#1a1a1a'), '#3d4044', 'the default of 0.1.0 (drawn as Black) too')
	assert.equal(shownBorder('bpmnTask', '#191b1d'), '#191b1d')
	assert.equal(shownBorder('iconStar', '#191b1d'), '#191b1d')
	assert.equal(shownBorder('rect', '#0275a9'), '#0275a9')
	assert.equal(shownBorder('rect', 'kaputt'), 'kaputt', 'not a colour: as shownColor gives it')
	assert.equal(new Set(REDESIGN_KINDS).size, 16, 'six basic kinds and the twelve of the flowchart (rect and diamond in both)')
})

test('AK3: a palette fill brings its strong tone as border in the same op; white the default; custom, BPMN and notes keep theirs', () => {
	const hb = PALETTE.find((e) => e.key === 'hellblau')
	const m = new FakeModel([
		shape(ID(1), { style: { fill: '#ffffff', stroke: '#191b1d', strokeWidth: 2 } }),
		shape(ID(2), { data: { kind: 'bpmnTask', text: '' }, style: { fill: '#ffffff', stroke: '#191b1d', strokeWidth: 2 } }),
		shape(ID(3), { data: { kind: 'ellipse', text: '' }, style: { fill: '#ffffff' } }),
		sticky(ID(4)),
	])
	const r = setStyle(m, [ID(1), ID(2), ID(3), ID(4)], 'style.fill', hb.light)
	assert.deepEqual(r.ops, [
		{ o: 'patch', id: ID(1), p: { 'style.fill': '#a2d9fe', 'style.stroke': '#0275a9' } },
		{ o: 'patch', id: ID(2), p: { 'style.fill': '#a2d9fe' } },
		{ o: 'patch', id: ID(3), p: { 'style.fill': '#a2d9fe', 'style.stroke': '#0275a9' } },
		{ o: 'patch', id: ID(4), p: { 'style.fill': '#a2d9fe' } },
	])
	assert.deepEqual(r.inverse[0], { o: 'patch', id: ID(1), p: { 'style.fill': '#ffffff', 'style.stroke': '#191b1d' } })
	assert.deepEqual(r.inverse[2], { o: 'patch', id: ID(3), p: { 'style.fill': '#ffffff', 'style.stroke': null } }, 'a missing border comes back missing')
	// undo puts both fields back
	const it = structuredClone(m.get(ID(1)))
	applyPatch(it, r.ops[0].p)
	applyPatch(it, r.inverse[0].p)
	assert.deepEqual(it.style, { fill: '#ffffff', stroke: '#191b1d', strokeWidth: 2 })
	// white → the default border; a custom colour → only the fill
	const blue = new FakeModel([shape(ID(1), { style: { fill: '#a2d9fe', stroke: '#0275a9', strokeWidth: 2 } })])
	assert.deepEqual(setStyle(blue, [ID(1)], 'style.fill', '#FFFFFF').ops[0].p, { 'style.fill': '#ffffff', 'style.stroke': SHAPE_BORDER })
	assert.deepEqual(setStyle(blue, [ID(1)], 'style.fill', '#123456').ops[0].p, { 'style.fill': '#123456' })
	// the border already the target tone: only the fill
	const toned = new FakeModel([shape(ID(1), { style: { fill: '#ffffff', stroke: '#0275a9', strokeWidth: 2 } })])
	assert.deepEqual(setStyle(toned, [ID(1)], 'style.fill', '#a2d9fe').ops[0].p, { 'style.fill': '#a2d9fe' })
	// the border stays free: setting it later is not touched
	assert.deepEqual(setStyle(blue, [ID(1)], 'style.stroke', '#c43e45').ops[0].p, { 'style.stroke': '#c43e45' })
	// every light tone has its strong tone (white: the default)
	for (const e of PALETTE) assert.equal(fillBorder('rect', e.light), e.key === 'weiss' ? SHAPE_BORDER : e.strong, e.key)
	assert.equal(LIGHT.length, 13)
	assert.equal(fillBorder('bpmnTask', hb.light), null)
	assert.equal(fillBorder('iconStar', hb.light), null)
	assert.equal(fillBorder('image', hb.light), null)
})

test('AK4: the default border is named "Default" in the palette', () => {
	assert.equal(paletteName('#3d4044'), 'Default')
})

test('AK7: ellipse and diamond begin square but resize freely', () => {
	assert.ok(!SQUARE_KINDS.includes('ellipse'))
	assert.ok(!SQUARE_KINDS.includes('diamond'))
	assert.ok(SQUARE_KINDS.includes('offPage'), 'the other square kinds stay')
	const m = new FakeModel([])
	const p = createItem(m, { t: 'shape', at: { x: 0, y: 0 }, data: { kind: 'ellipse' } }, () => S).ops[0].p
	assert.equal(squareOn({ t: 'shape', ...p }), false)
})
