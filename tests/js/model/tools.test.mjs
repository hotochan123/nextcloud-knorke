/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/tools.js: the one tool table of SPEC-M1 §6.2 (frozen contract of
 * stage 1, used by scene and toolbar), literally; (job 188 AK6) the note
 * tool's option type with the values NOTE_TOOL_TYPES, note and note pad;
 * (job 199 AK5) the frame tool's option frameKind with FRAME_TOOL_KINDS,
 * frame and swimlanes.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FRAME_TOOL_KINDS, NOTE_TOOL_TYPES, TOOLS, TOOL_IDS } from '../../../src/model/tools.js'
import { TYPES, fieldRule, isKnownType } from '../../../src/model/registry.js'
import { PEN_TOOL_KINDS } from '../../../src/model/ink.js'
import { frameKindLabel, noteTypeLabel } from '../../../src/components/labels.js'

describe('tools', () => {
	test('TOOLS is the table of §6.2, in toolbar order; (job 171 AK1) the laser pointer, (job 273) then the pen last; (job 173) table (B) after text; (job 188) the note tool has the option type; (job 195) mind map (M) after table; (job 199) the frame tool has the option frameKind', () => {
		assert.deepEqual(TOOLS, [
			{ id: 'select', key: 'v' },
			{ id: 'hand', key: 'h' },
			{ id: 'sticky', key: 'n', create: 'click', options: ['type'] },
			{ id: 'shape', key: 's', create: 'drag', options: ['kind'] },
			{ id: 'text', key: 't', create: 'click' },
			{ id: 'table', key: 'b', create: 'click' },
			{ id: 'mindmap', key: 'm', create: 'click' },
			{ id: 'connector', key: 'l', create: 'connect', options: ['route', 'endCap'] },
			{ id: 'frame', key: 'f', create: 'drag', options: ['frameKind'] },
			{ id: 'laser', key: 'k' },
			{ id: 'pen', key: 'p', create: 'stroke', options: ['penKind'] },
		])
		assert.deepEqual(TOOL_IDS, ['select', 'hand', 'sticky', 'shape', 'text', 'table', 'mindmap', 'connector', 'frame', 'laser', 'pen'])
		assert.deepEqual(TOOLS.at(-2), { id: 'laser', key: 'k' })
	})

	test('ids and keys are unique single lower-case letters; creating tools are registry types', () => {
		assert.equal(new Set(TOOLS.map((t) => t.key)).size, TOOLS.length)
		for (const t of TOOLS) {
			assert.match(t.key, /^[a-z]$/)
			if (t.create) assert.ok(Object.prototype.hasOwnProperty.call(TYPES, t.id), t.id)
			// job 273: 'stroke' (the pen)
			assert.ok(t.create === undefined || ['click', 'drag', 'connect', 'stroke'].includes(t.create))
		}
		// job 188: the note pad has no tool of its own, the note tool makes it (option type 'pad')
		const made = new Set([...TOOLS.filter((t) => t.create).map((t) => t.id), ...NOTE_TOOL_TYPES])
		assert.deepEqual([...made].sort(), Object.keys(TYPES).filter((t) => t !== 'ai').sort(), 'one tool per type, the pad through the note tool; (job 267) the AI card only from the AI')
	})

	test('tool options are typed fields of their type (kind → data.kind, route → data.route, endCap → style.endCap); (job 188) the note tool\'s type names registry types', () => {
		const pathOf = { kind: 'data.kind', route: 'data.route', endCap: 'style.endCap' }
		for (const t of TOOLS.filter((x) => x.options)) {
			for (const o of t.options) {
				// job 188 type, job 199 frameKind: what the tool creates, no field
				// job 273 penKind: pen, highlighter (data.kind) or the eraser (no item), checked below
				if (o === 'type' || o === 'frameKind' || o === 'penKind') continue
				assert.equal(fieldRule(t.id, pathOf[o])?.[0], 'enum', `${t.id}.${o}`)
			}
		}
		assert.deepEqual(TOOLS.find((t) => t.id === 'sticky').options, ['type'])
		// job 273: the kinds that draw are the enum of data.kind, then the eraser
		assert.deepEqual([...PEN_TOOL_KINDS], [...fieldRule('pen', 'data.kind')[1], 'eraser'])
		for (const v of NOTE_TOOL_TYPES) assert.ok(isKnownType(v), v)
	})

	test('job 188 AK6: the note tool offers sticky "Note" and pad "Note pad" (default first), in German "Notiz" and "Notizblock"', () => {
		assert.deepEqual([...NOTE_TOOL_TYPES], ['sticky', 'pad'])
		assert.ok(Object.isFrozen(NOTE_TOOL_TYPES))
		assert.deepEqual(NOTE_TOOL_TYPES.map(noteTypeLabel), ['Note', 'Note pad'])
		const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
		assert.deepEqual([de.Note, de['Note pad']], ['Notiz', 'Notizblock'])
	})

	test('job 199 AK5: the frame tool offers frame "Frame" and lanes "Swimlanes" (default first), in German "Frame" and "Swimlanes"', () => {
		assert.deepEqual([...FRAME_TOOL_KINDS], ['frame', 'lanes'])
		assert.ok(Object.isFrozen(FRAME_TOOL_KINDS))
		assert.deepEqual(FRAME_TOOL_KINDS.map(frameKindLabel), ['Frame', 'Swimlanes'])
		const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
		assert.deepEqual([de.Frame, de.Swimlanes], ['Frame', 'Swimlanes'])
	})

	test('frozen', () => {
		assert.ok(Object.isFrozen(TOOLS) && Object.isFrozen(TOOL_IDS))
		assert.throws(() => { TOOLS[0].key = 'x' }, TypeError)
		assert.throws(() => { TOOLS[3].options.push('x') }, TypeError)
		assert.throws(() => { TOOL_IDS.push('brush') }, TypeError)
	})
})
