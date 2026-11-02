/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 212) AK2: a drag from "+" of a BPMN task, start event or gateway gives
 * the connect intent with the triangle of a sequence flow, deterministic in
 * Node on the fake DOM with the real SceneManager, InputController and
 * ConnectController (renderer stubbed). Camera (0, 0, 1), so container px =
 * world units. Covered:
 * - task, start event, gateway onto a note and onto empty canvas: route
 *   elbow, endCap triangle
 * - a rect, a BPMN data object and a note: endCap arrow
 * - the connector tool from the task onto the note: arrow
 * - an end tip chosen in the connector tool ('dot') stays at the task, and
 *   the tool options keep the arrow after a sequence flow (the next drag
 *   from the note)
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { note, setupScene, shapeItem } from './sceneHarness.mjs'

const P = '01JA0000000000000000000011'
const E = '01JA0000000000000000000012'
const G = '01JA0000000000000000000013'
const R = '01JA0000000000000000000014'
const D = '01JA0000000000000000000015'
const B = '01JA0000000000000000000016'

const bpmn = (id, kind, o) => shapeItem(id, { data: { kind, text: '' }, ...o })
const items = () => [
	bpmn(P, 'bpmnTask', { x: 100, y: 100, w: 180, h: 120 }),
	bpmn(E, 'bpmnStart', { x: 100, y: 300, w: 64, h: 64 }),
	bpmn(G, 'bpmnExclusive', { x: 100, y: 420, w: 80, h: 80 }),
	shapeItem(R, { x: 100, y: 560, w: 200, h: 120 }),
	bpmn(D, 'bpmnDataObject', { x: 400, y: 560, w: 80, h: 100 }),
	note(B, { x: 600, y: 100 }),
]
const B_MID = [700, 200]
const EMPTY = [900, 720]

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

/**
 * Selects `id` and drags with the mouse from its "+" `name` to `to`.
 *
 * @param {string} id item
 * @param {[number, number]} to container point of the release
 * @param {string} [name] handle
 * @return {object[]} the intents of the drag
 */
function dragFromPlus(id, to, name = 'plus-r') {
	h.scene.setSelection([id])
	h.frame()
	const plus = h.scene.handles().find((x) => x.name === name)
	assert.ok(plus, `${id} has ${name}`)
	h.log.length = 0
	h.pointer('pointerdown', plus.x, plus.y)
	h.pointer('pointermove', plus.x + 4, plus.y, { buttons: 1 })
	h.frame()
	h.pointer('pointermove', ...to, { buttons: 1 })
	h.frame()
	h.pointer('pointerup', ...to)
	h.frame()
	return h.intents()
}

/** (job 261) The connector tool set to the open arrow (the default end until 0.4.0), the tip job 212 turns into the triangle at BPMN items. */
function arrowTool() {
	h.scene.setTool('connector', { endCap: 'arrow' })
	h.scene.setTool('select')
}

describe('job 212 AK2 a drag from "+"', () => {
	test('a BPMN task, start event and gateway onto a note and onto empty canvas: elbow with the triangle', () => {
		h = setupScene(items())
		for (const id of [P, E, G]) {
			for (const to of [B_MID, EMPTY]) {
				const got = dragFromPlus(id, to)
				assert.equal(got.length, 1, `${id} → ${to}`)
				assert.equal(got[0].type, 'connect')
				assert.equal(got[0].start.item, id)
				assert.deepEqual([got[0].route, got[0].endCap], ['elbow', 'triangle'], `${id} → ${to}`)
				assert.equal('item' in got[0].end, to === B_MID, `${id} → ${to}: bound only on the note`)
			}
		}
	})

	test('a rect, a BPMN data object and a note keep the arrow', () => {
		h = setupScene(items())
		arrowTool()
		for (const [id, name] of [[R, 'plus-r'], [D, 'plus-r'], [B, 'plus-b']]) {
			const got = dragFromPlus(id, EMPTY, name)
			assert.deepEqual(got.map((i) => [i.type, i.route, i.endCap]), [['connect', 'elbow', 'arrow']], id)
		}
		// the task's "+" drawn onto the rect: the start counts, not the end
		const onto = dragFromPlus(P, [200, 620], 'plus-b')
		assert.deepEqual(onto.map((i) => [i.end.item, i.endCap]), [[R, 'triangle']])
		// and the rect's "+" onto the task keeps the arrow
		const back = dragFromPlus(R, [190, 160], 'plus-t')
		assert.deepEqual(back.map((i) => [i.end.item, i.endCap]), [[P, 'arrow']])
	})

	test('the connector tool from the task onto the note keeps the arrow', () => {
		h = setupScene(items())
		arrowTool()
		h.scene.setTool('connector')
		h.log.length = 0
		h.pointer('pointerdown', 190, 160)
		h.pointer('pointermove', 400, 180, { buttons: 1 })
		h.frame()
		h.pointer('pointermove', ...B_MID, { buttons: 1 })
		h.frame()
		h.pointer('pointerup', ...B_MID)
		h.frame()
		assert.deepEqual(h.intents().map((i) => [i.type, i.start.item, i.end.item, i.endCap]), [['connect', P, B, 'arrow']])
	})

	test('a tip chosen in the connector tool stays at the task; after a sequence flow the note still draws the arrow', () => {
		h = setupScene(items())
		arrowTool()
		assert.deepEqual(dragFromPlus(P, B_MID).map((i) => i.endCap), ['triangle'])
		assert.deepEqual(dragFromPlus(B, EMPTY, 'plus-b').map((i) => i.endCap), ['arrow'], 'the tool options kept the arrow')
		h.scene.setTool('connector', { endCap: 'dot' })
		h.scene.setTool('select')
		assert.deepEqual(dragFromPlus(P, B_MID).map((i) => i.endCap), ['dot'])
	})
})
