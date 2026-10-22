/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/tools.js: the one tool table of SPEC-M1 §6.2 (frozen contract of
 * stage 1, used by scene and toolbar), literally.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS, TOOL_IDS } from '../../../src/model/tools.js'
import { TYPES, fieldRule } from '../../../src/model/registry.js'

describe('tools', () => {
	test('TOOLS is the table of §6.2, in toolbar order', () => {
		assert.deepEqual(TOOLS, [
			{ id: 'select', key: 'v' },
			{ id: 'hand', key: 'h' },
			{ id: 'sticky', key: 'n', create: 'click' },
			{ id: 'shape', key: 's', create: 'drag', options: ['kind'] },
			{ id: 'text', key: 't', create: 'click' },
			{ id: 'connector', key: 'l', create: 'connect', options: ['route', 'endCap'] },
			{ id: 'frame', key: 'f', create: 'drag' },
		])
		assert.deepEqual(TOOL_IDS, ['select', 'hand', 'sticky', 'shape', 'text', 'connector', 'frame'])
	})

	test('ids and keys are unique single lower-case letters; creating tools are registry types', () => {
		assert.equal(new Set(TOOLS.map((t) => t.key)).size, TOOLS.length)
		for (const t of TOOLS) {
			assert.match(t.key, /^[a-z]$/)
			if (t.create) assert.ok(Object.prototype.hasOwnProperty.call(TYPES, t.id), t.id)
			assert.ok(t.create === undefined || ['click', 'drag', 'connect'].includes(t.create))
		}
		assert.deepEqual(TOOLS.filter((t) => t.create).map((t) => t.id).sort(), Object.keys(TYPES).sort(), 'one tool per type')
	})

	test('tool options are typed fields of their type (kind → data.kind, route → data.route, endCap → style.endCap)', () => {
		const pathOf = { kind: 'data.kind', route: 'data.route', endCap: 'style.endCap' }
		for (const t of TOOLS.filter((x) => x.options)) {
			for (const o of t.options) assert.equal(fieldRule(t.id, pathOf[o])?.[0], 'enum', `${t.id}.${o}`)
		}
	})

	test('frozen', () => {
		assert.ok(Object.isFrozen(TOOLS) && Object.isFrozen(TOOL_IDS))
		assert.throws(() => { TOOLS[0].key = 'x' }, TypeError)
		assert.throws(() => { TOOLS[3].options.push('x') }, TypeError)
		assert.throws(() => { TOOL_IDS.push('pen') }, TypeError)
	})
})
