/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 275 (private writing and reveal), the client side:
 * - model/privateWriting.js: privateOf, isCovered, wantsResync
 * - a covered note is never picked or caught (SceneModel.hitTest,
 *   queryRect) and never selected (Selection.accept as SceneManager sets it)
 * - it is left out of the CSV rows and has no outline point
 * - the sticky node draws it as a grey card without text, and the reveal
 *   (data changes, style {} stays) gives it its colour back
 * - SyncClient.requestResync: the next answer is followed by a snapshot
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COVERED_FILL, isCovered, privateOf, wantsResync } from '../../../src/model/privateWriting.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { Selection } from '../../../src/scene/Selection.js'
import { hasCsvRow } from '../../../src/board/exportCsv.js'
import { boardOutline } from '../../../src/board/outline.js'
import { sticky } from '../../../src/scene/nodes/sticky.js'
import { Replica } from '../../../src/sync/Replica.js'
import { SyncClient } from '../../../src/sync/SyncClient.js'
import { PROTOCOL } from '../../../src/sync/protocol.js'
import { FakeClock, fakeTransport } from '../sync/fakeClock.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const F = '01JA0000000000000000000009'
const note = (id, extra = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 100, h: 100, r: 0, z: 'a' + id.slice(-1), parent: null, data: { text: 'Idee' }, style: {}, group: null, lock: null, ...extra })
const covered = (id, extra = {}) => note(id, { data: { covered: true }, ...extra })

test('privateOf: the well-formed meta.private, else null', () => {
	assert.deepEqual(privateOf({ private: { scope: 'board', at: 5, by: 'Alice', seq: 2 } }), { scope: 'board', frame: null, seq: 2, by: 'Alice' })
	assert.deepEqual(privateOf({ private: { scope: 'frame', frame: F, at: 5, by: 'A', seq: 1 } }), { scope: 'frame', frame: F, seq: 1, by: 'A' })
	assert.equal(privateOf({ private: { scope: 'frame', at: 5 } }), null, 'a frame scope without frame')
	assert.equal(privateOf({ private: { scope: 'x' } }), null)
	assert.equal(privateOf({ privateSeq: 1 }), null, 'after the reveal')
	assert.equal(privateOf(null), null)
})

test('isCovered: only a sticky with data.covered true', () => {
	assert.equal(isCovered(covered(A)), true)
	assert.equal(isCovered(note(A)), false)
	assert.equal(isCovered({ t: 'shape', data: { covered: true } }), false)
	assert.equal(isCovered(null), false)
})

test('wantsResync: after the reveal or a new round with covered notes, never otherwise', () => {
	const on = { private: { scope: 'board', at: 1, seq: 1 } }
	assert.equal(wantsResync(on, { privateSeq: 1 }, true), true, 'revealed')
	assert.equal(wantsResync(on, { private: { scope: 'board', at: 9, seq: 2 } }, true), true, 'revealed and started again in between')
	assert.equal(wantsResync(on, on, true), false, 'still running')
	assert.equal(wantsResync(on, { privateSeq: 1 }, false), false, 'nothing covered')
	assert.equal(wantsResync({}, on, true), false, 'a start')
	assert.equal(wantsResync({}, {}, true), false, 'a snapshot without private writing (notes written during the stream): the next sync brings them')
})

test('a covered note is never picked, caught by a marquee or selected', () => {
	const m = new SceneModel()
	m.load([note(A), covered(B, { x: 200 })])
	assert.equal(m.hitTest(50, 50), A)
	assert.equal(m.hitTest(250, 50), null, 'clicks pass through')
	assert.deepEqual(m.queryRect({ x: -10, y: -10, w: 400, h: 200 }), [A])
	assert.deepEqual(m.queryRect({ x: -10, y: -10, w: 400, h: 200 }, 'contain'), [A])
	const sel = new Selection()
	sel.accept = (id) => !isCovered(m.get(id))
	sel.set([A, B])
	assert.deepEqual(sel.values(), [A])
	sel.toggle(B)
	assert.deepEqual(sel.values(), [A])
})

test('a covered note has no CSV row and no outline point', () => {
	assert.equal(hasCsvRow(covered(A)), false)
	assert.equal(hasCsvRow(note(A)), true)
	const m = new SceneModel()
	m.load([note(A), covered(B, { x: 200 })])
	const o = boardOutline(m, [])
	assert.equal(JSON.stringify(o).includes(B), false)
	assert.equal(JSON.stringify(o).includes('Idee'), true)
})

/** The fake builder context of the sticky node (see tests/js/scene/nodes.test.mjs). */
class FakeNode {
	constructor(attrs = {}) { this.attrs = { ...attrs }; this.children = [] }
	setAttrs(a) { Object.assign(this.attrs, a) }
	visible(v) { if (v === undefined) return this.attrs.visible !== false; this.attrs.visible = v; return this }
	add(c) { this.children.push(c) }
	transformsEnabled() {}
	moveToTop() {}
	position(p) { Object.assign(this.attrs, p) }
	rotation(r) { if (r === undefined) return this.attrs.rotation ?? 0; this.attrs.rotation = r }
	setAttr(k, v) { this.attrs[k] = v }
	getAttr(k) { return this.attrs[k] }
	width() { return this.attrs.width }
	height() { return this.attrs.height }
}
const ctx = { Group: FakeNode, Rect: FakeNode, Text: FakeNode, Shape: FakeNode, Line: FakeNode, shadows: false, tags: new Map() }
const abs = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: it.r })

test('the sticky node draws a covered note as a grey card without text; the reveal brings its colour and text', () => {
	const hidden = covered(A, { w: 200, h: 200 })
	const e = sticky.build(ctx, hidden, abs(hidden), 0)
	assert.equal(e.parts.body.attrs.fill, COVERED_FILL)
	assert.equal(e.parts.text.attrs.text, '')
	assert.equal(e.parts.tags, null)
	const shown = note(A, { w: 200, h: 200, data: { text: 'Geheim' } })
	assert.equal(sticky.update(ctx, e, shown, abs(shown), new Set(['data', 'text'])), false)
	assert.notEqual(e.parts.body.attrs.fill, COVERED_FILL, 'style {} on both sides: data alone recolours')
	assert.equal(e.parts.text.attrs.text, 'Geheim')
})

test('SyncClient.requestResync: the answer of the next tick is followed by one snapshot (onResync), the tick after by none', async () => {
	const clock = new FakeClock(10000)
	const tr = fakeTransport(clock, (b) => ({ proto: PROTOCOL, rev: b.since, now: clock.now() }))
	let resyncs = 0
	const client = new SyncClient({
		transport: tr,
		replica: new Replica(),
		client: 'cTEST00001',
		onResync: async () => {
			resyncs++
			return 7
		},
		now: clock.now,
		sleep: clock.sleep,
		rand: () => 0,
	})
	client.start(7)
	await clock.advance(0)
	assert.equal(resyncs, 0)
	client.requestResync()
	await clock.advance(5000)
	assert.equal(resyncs, 1)
	await clock.advance(10000)
	assert.equal(resyncs, 1, 'once')
	client.stop()
})

test('round 2: copyPayload leaves a covered note out, also as the child of a selected frame (copy, duplicate, board file, own template)', async () => {
	const { copyPayload } = await import('../../../src/board/actions.js')
	const m = new SceneModel()
	m.load([
		{ id: F, t: 'frame', x: 0, y: 0, w: 800, h: 600, r: 0, z: 'a0', parent: null, data: { title: 'F' }, style: {}, group: null, lock: null },
		note(A, { parent: F, x: 10, y: 10 }),
		covered(B, { parent: F, x: 200, y: 10 }),
	])
	const ids = copyPayload(m, [F]).items.map((it) => it.id)
	assert.equal(ids.includes(B), false)
	assert.equal(ids.includes(A), true)
	assert.deepEqual(copyPayload(m, [B]).items, [], 'a covered note alone')
	assert.equal(copyPayload(m, [...m.ids()]).items.some((it) => it.data?.covered), false, 'board file: every id')
})
