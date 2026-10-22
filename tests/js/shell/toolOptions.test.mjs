/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * SPEC-M1 §20 (R9, small finding of round 1a): the shape kinds of the tool
 * options menu come from the frozen ENUMS.shapeKinds of src/model/registry.js
 * (as contextbar.js does), never from a duplicated literal list; the menu
 * order is the registry order.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ENUMS } from '../../../src/model/registry.js'
import { TOOLS } from '../../../src/model/tools.js'

const src = readFileSync(new URL('../../../src/components/ToolOptions.vue', import.meta.url), 'utf8')
const script = src.match(/<script setup>([\s\S]*)<\/script>/)?.[1] ?? ''

test('ToolOptions: the shape kinds are ENUMS.shapeKinds of the registry, not a copy', () => {
	assert.match(script, /import \{ ENUMS \} from '\.\.\/model\/registry\.js'/)
	const table = script.match(/const OPTION_VALUES = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1]
	assert.ok(table, 'OPTION_VALUES table present')
	assert.match(table, /\bkind:\s*ENUMS\.shapeKinds\b/)
	for (const kind of ENUMS.shapeKinds) {
		assert.ok(!new RegExp(`['"\`]${kind}['"\`]`).test(src), `no literal '${kind}' in ToolOptions.vue`)
	}
})

test('ToolOptions: menu order = registry order (unchanged from round 1a)', () => {
	assert.deepEqual([...ENUMS.shapeKinds], ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight'])
	assert.ok(Object.isFrozen(ENUMS.shapeKinds), 'the menu iterates the frozen enum itself')
})

test('ToolOptions (round 1b): route and end tip of the connector tool are ENUMS.routes / ENUMS.caps, never copies; one caption per option group', () => {
	const table = script.match(/const OPTION_VALUES = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1]
	assert.match(table, /\broute:\s*ENUMS\.routes\b/)
	assert.match(table, /\bendCap:\s*ENUMS\.caps\b/)
	for (const v of [...ENUMS.routes, ...ENUMS.caps]) {
		assert.ok(!new RegExp(`['"\`]${v}['"\`]`).test(src), `no literal '${v}' in ToolOptions.vue`)
	}
	// TOOLS (frozen) asks for exactly these options; every one has a value table here
	const connector = TOOLS.find((x) => x.id === 'connector')
	assert.deepEqual([...connector.options], ['route', 'endCap'])
	for (const option of TOOLS.flatMap((x) => x.options ?? [])) {
		assert.match(table, new RegExp(`\\b${option}:`), option)
	}
	assert.match(src, /<NcActionCaption v-if="groups\.length > 1" :name="g\.caption" \/>/)
})

test('ToolOptions (round 1b): a click on the CHECKED entry chooses it too (a checked radio fires no change); one choice is emitted once', () => {
	assert.match(src, /@click="pick\(g\.option, e\.value\)"/)
	assert.match(src, /@update:model-value="\(v\) => choose\(g\.option, v\)"/)
	const pick = script.match(/function pick\(option, value\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
	assert.match(pick, /if \(current\(option\) === value\) \{\s*choose\(option, value\)/, 'only the checked entry is chosen by its click')
	const choose = script.match(/function choose\(option, value\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
	assert.match(choose, /last\.key === key && now - last\.at < SAME_CHOICE_MS/, 'a choice arriving twice (label + input click) is emitted once')
	assert.match(choose, /open\.value = false[\s\S]*emit\('update', \{ \[option\]: value \}\)/)
})
