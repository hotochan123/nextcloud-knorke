/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 240 (AK1): the tick "1:1" of "Arrange" as it acts (model/shapes.js
 * squareOn): style.square as stored, else ticked only for a square shape of
 * a kind that begins square (SQUARE_KINDS); only shapes have it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BPMN_GROUPS, SHAPES, SQUARE_KINDS, squareOn } from '../../../src/model/shapes.js'
import { fieldDefault } from '../../../src/model/registry.js'

const shape = (kind, w, h, style = {}) => ({ id: 'S', t: 'shape', x: 0, y: 0, w, h, r: 0, data: { kind, text: '' }, style })

test('job 240 (AK1): SQUARE_KINDS are the kinds with a square create, without the own shape: symbols, BPMN events, gateways, data store, off-page reference', () => {
	const icons = Object.keys(SHAPES).filter((k) => k.startsWith('icon'))
	assert.deepEqual([...SQUARE_KINDS].sort(), [...icons, ...BPMN_GROUPS.events, ...BPMN_GROUPS.gateways, 'bpmnDataStore', 'offPage'].sort())
	for (const k of SQUARE_KINDS) {
		assert.equal(SHAPES[k].create.w, SHAPES[k].create.h, k)
	}
	assert.equal(SQUARE_KINDS.includes('image'), false)
	assert.equal(SQUARE_KINDS.includes('rect'), false)
	assert.equal(fieldDefault('shape', 'style.square'), null, 'missing: derived')
})

test('job 240 (AK1): squareOn: on and off as stored; missing: only a square shape of a square kind; never another type', () => {
	assert.equal(squareOn(shape('rect', 200, 120, { square: 'on' })), true, 'on, also not square')
	assert.equal(squareOn(shape('iconStar', 96, 96, { square: 'off' })), false, 'off, also square')
	assert.equal(squareOn(shape('iconStar', 96, 96)), true)
	assert.equal(squareOn(shape('bpmnStart', 64, 64)), true)
	assert.equal(squareOn(shape('bpmnExclusive', 80, 80.004)), true, 'equal on the 0.01 grid')
	assert.equal(squareOn(shape('bpmnDataStore', 120, 150)), false, 'not square: unticked')
	assert.equal(squareOn(shape('rect', 120, 120)), false, 'a rectangle without the field')
	assert.equal(squareOn(shape('image', 96, 96)), false, 'an own shape without the field')
	assert.equal(squareOn(shape('offPage', 120, 120, { square: 'yes' })), true, 'an invalid stored value counts as missing')
	assert.equal(squareOn(shape('rect', 120, 120), 'on'), true, 'a value to judge instead of the stored one')
	assert.equal(squareOn(shape('iconStar', 96, 96, { square: 'on' }), 'off'), false)
	for (const t of ['sticky', 'frame', 'text']) {
		assert.equal(squareOn({ id: 'X', t, x: 0, y: 0, w: 200, h: 200, r: 0, data: {}, style: { square: 'on' } }), false, t)
	}
	assert.equal(squareOn(null), false)
})
