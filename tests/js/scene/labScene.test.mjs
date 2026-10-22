/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The lab board of dev/scene-lab/scene-gen.js with routed connectors (SPEC-M1
 * §8.5, round 1b), checked in Node with the real SceneModel:
 * - the M1 set: 3000 notes, 500 shapes, 800 connectors, 100 text items, 20
 *   frames, 30 placeholders; every connector routes (all ends known)
 * - the G12 hub note has exactly six connectors and lies away from the eight
 *   notes the M0 gates press on
 * - no connector (rbush box) lies over the centre of those eight notes, and
 *   a click at each centre hits the note itself: routed connectors cannot
 *   steal the presses of the M0 gates
 * - the M0 board (M0_COUNTS) is unchanged by round 1b: no connectors, no hub
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { M0_COUNTS, generateScene } from '../../../dev/scene-lab/scene-gen.js'
import { SceneModel } from '../../../src/model/SceneModel.js'

const { items, meta } = generateScene()
const model = new SceneModel()
model.load(items)

/** @param {string} id item @return {[number, number]} centre of its box */
function centre(id) {
	const b = model.boundsOf([id])
	return [b.x + b.w / 2, b.y + b.h / 2]
}

describe('lab board (round 1b)', () => {
	test('the M1 set, every connector routed', () => {
		assert.deepEqual(meta.counts, { sticky: 3000, shape: 500, text: 100, connector: 800, frame: 20, unknown: 30, total: 4450 })
		assert.equal(meta.connectorIds.filter((id) => model.geometryOf(id) !== null).length, 800)
	})

	test('the G12 hub: six connectors, ≥ 600 world units from the gate notes', () => {
		assert.equal(meta.hubConnectorIds.length, 6)
		assert.deepEqual([...model.connectorsOf([meta.hubNoteId])].sort(), meta.hubConnectorIds.slice().sort())
		const [hx, hy] = centre(meta.hubNoteId)
		for (const id of meta.centerNoteIds) {
			const [x, y] = centre(id)
			assert.ok(Math.hypot(hx - x, hy - y) >= 600, id)
		}
		assert.ok(model.get(meta.hubConnectorIds[0]).data.label === 'Hub')
	})

	test('no connector over the centres of the gate notes; a click there hits the note (mouse and touch tolerance)', () => {
		for (const id of [...meta.centerNoteIds, meta.hubNoteId]) {
			const [x, y] = centre(id)
			const over = model.query(x - 12, y - 12, x + 12, y + 12).filter((e) => e.t === 'connector').map((e) => e.id)
			if (id !== meta.hubNoteId) assert.deepEqual(over, [], id)
			assert.equal(model.hitTest(x, y, 4), id)
			assert.equal(model.hitTest(x, y, 12), id)
		}
	})

	test('the M0 board stays as it was: no connectors, no hub', () => {
		const m0 = generateScene({ counts: M0_COUNTS })
		assert.equal(m0.meta.counts.connector, 0)
		assert.equal(m0.meta.hubNoteId, null)
		assert.deepEqual(m0.meta.centerNoteIds, meta.centerNoteIds, 'the gate notes do not depend on the M1 items')
	})
})
