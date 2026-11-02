/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * "Sort by color" (factory job 139): actions.sortNotesByColor and its
 * helpers sortableNotes and sortBlockName on the fake model. AK1 (loose
 * notes of a selection), AK2 (the notes of a frame, the frame grows).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SORT_BLOCK_GAP, SORT_GAP, SORT_MARGIN, SORT_NAME_GAP, sortBlockName, sortNotesByColor, sortableNotes } from '../../../src/board/actions.js'
import { rotatedBBox } from '../../../src/model/geometry.js'
import { applyPatch } from '../../../src/model/paths.js'
import { TYPES } from '../../../src/model/registry.js'
import { FakeModel, ID, frame, shape, sticky } from './fakes.mjs'

const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map((n) => ID(n))
const S = ID('S1')
const L = ID('L1')
const G = ID('G1')
const G2 = ID('G2')
const R = ID('R1')
const IN = ID('N1')
/** (Job 227) Yellow and Indigo of the one palette: yellow comes first in its order. */
const BLUE = '#b9c8fc'
const YELLOW = '#faea89'
const CUSTOM = '#123456'

/** A 200 × 200 note at (x, y) in a fill. */
const note = (id, x, y, fill, extra = {}) => sticky(id, { x, y, style: { fill }, ...extra })

/**
 * @param {FakeModel} model model
 * @param {object[]} ops patches and puts
 */
function applyOps(model, ops) {
	for (const op of ops) {
		if (op.o === 'patch') {
			applyPatch(model.get(op.id), op.p)
		}
	}
}

/** @return {Map<string, object>} a deep copy of every item */
const snapshot = (model) => new Map([...model.items].map(([id, it]) => [id, structuredClone(it)]))

/** The board of AK1: six notes in reading order A–F, plus a shape, a locked, a grouped note and a note in a frame. */
function ak1Model() {
	return new FakeModel([
		note(A, 0, 0, BLUE), note(B, 300, 0, YELLOW), note(C, 600, 0, BLUE),
		note(D, 0, 300, CUSTOM), note(E, 300, 300, YELLOW), note(F, 600, 300, YELLOW),
		shape(S, { x: 2000, y: 0 }),
		note(L, 2000, 300, YELLOW, { lock: { by: 'pidalice00000001', name: 'Alice' } }),
		note(G, 2300, 300, BLUE, { group: '01JGA0000000000000000000G1' }),
		note(G2, 2600, 300, BLUE, { group: '01JGA0000000000000000000G1' }),
		frame(R, { x: 3000, y: 0, w: 800, h: 600 }),
		note(IN, 10, 10, YELLOW, { parent: R }),
	])
}

test('job 139 AK1: loose notes in one block per colour (palette order, custom colours after it), reading order, near-square blocks; every other item stays; blocks; a second call gives no op; the inverse restores everything', () => {
	const model = ak1Model()
	const before = snapshot(model)
	// the selection order does not decide (only ties): everything selected, shuffled
	const sel = [F, S, C, IN, A, L, E, D, G, B, R]
	assert.deepEqual(sortableNotes(model, sel), [F, C, A, E, D, B], 'notes only: no shape, no locked, no grouped note, no note in a frame')
	const r = sortNotesByColor(model, sel)
	const want = { [B]: [0, 0], [E]: [220, 0], [F]: [0, 220], [A]: [520, 0], [C]: [740, 0], [D]: [1040, 0] }
	assert.deepEqual(r.ops.map((o) => o.id), [B, E, F, A, C, D], 'block by block, each in reading order')
	for (const op of r.ops) {
		assert.equal(op.o, 'patch')
		assert.deepEqual(op.p, { x: want[op.id][0], y: want[op.id][1], parent: null }, op.id)
	}
	assert.deepEqual(r.inverse, r.ops.map((o) => ({ o: 'patch', id: o.id, p: { x: before.get(o.id).x, y: before.get(o.id).y, parent: null } })))
	assert.deepEqual(r.blocks, [
		{ color: YELLOW, x: 0, y: 0, w: 420, h: 420, parent: null },
		{ color: BLUE, x: 520, y: 0, w: 420, h: 200, parent: null },
		{ color: CUSTOM, x: 1040, y: 0, w: 200, h: 200, parent: null },
	])
	applyOps(model, r.ops)
	for (const [id, it] of model.items) {
		const old = before.get(id)
		assert.equal(it.parent ?? null, old.parent ?? null, 'parent ' + id)
		assert.equal(it.w, old.w)
		assert.equal(it.h, old.h)
		assert.equal(it.r, old.r)
		assert.deepEqual(it.style, old.style)
		if (!(id in want)) {
			assert.deepEqual(it, old, 'not moved: ' + id)
		}
	}
	// sorted already: no op, the same blocks
	const again = sortNotesByColor(model, sel)
	assert.deepEqual(again.ops, [])
	assert.deepEqual(again.blocks, r.blocks)
	// the inverse puts everything back
	applyOps(model, r.inverse)
	assert.deepEqual(snapshot(model), before)
})

test('job 139 AK2: the notes in a frame from its corner + 60, the frame grows to 1060 × 320 (x/y kept, patch first), the shape stays; a large frame keeps its size', () => {
	const Fr = ID('F7')
	const [G1n, Y1, G2n, Y2, Sh] = [ID(11), ID(12), ID(13), ID(14), ID(15)]
	const kids = (fr) => [
		note(G1n, 10, 10, '#febf87', { parent: fr }), note(Y1, 250, 10, '#faea89', { parent: fr }),
		note(G2n, 10, 260, '#febf87', { parent: fr }), note(Y2, 250, 260, '#faea89', { parent: fr }),
		shape(Sh, { x: 300, y: 100, parent: fr }),
	]
	const model = new FakeModel([frame(Fr, { x: 1000, y: 1000, w: 500, h: 300 }), ...kids(Fr)])
	const before = snapshot(model)
	assert.deepEqual(sortableNotes(model, [], { frame: Fr }).sort(), [G1n, Y1, G2n, Y2].sort())
	const r = sortNotesByColor(model, [Fr], { frame: Fr })
	assert.deepEqual(r.ops[0], { o: 'patch', id: Fr, p: { w: 1060, h: 320 } }, 'the frame first, only w and h')
	assert.deepEqual(r.inverse[0], { o: 'patch', id: Fr, p: { w: 500, h: 300 } })
	const at = Object.fromEntries(r.ops.slice(1).map((o) => [o.id, [o.p.x, o.p.y, o.p.parent]]))
	assert.deepEqual(at, { [Y1]: [60, 60, Fr], [Y2]: [280, 60, Fr], [G1n]: [580, 60, Fr], [G2n]: [800, 60, Fr] }, 'relative to the frame, the frame stays the parent')
	assert.deepEqual(r.ops.slice(1).map((o) => o.id), [Y1, Y2, G1n, G2n], '#faea89 before #febf87 (palette order)')
	assert.ok(!r.ops.some((o) => o.id === Sh), 'the shape stays')
	assert.deepEqual(r.blocks, [
		{ color: '#faea89', x: 1060, y: 1060, w: 420, h: 200, parent: Fr },
		{ color: '#febf87', x: 1580, y: 1060, w: 420, h: 200, parent: Fr },
	], 'world coordinates')
	applyOps(model, r.ops)
	assert.equal(model.get(Fr).x, 1000)
	assert.equal(model.get(Fr).y, 1000)
	assert.deepEqual(sortNotesByColor(model, [Fr], { frame: Fr }).ops, [], 'sorted already')
	applyOps(model, r.inverse)
	assert.deepEqual(snapshot(model), before)
	// a frame large enough: no size patch, it never shrinks
	const big = new FakeModel([frame(Fr, { x: 1000, y: 1000, w: 3000, h: 2000 }), ...kids(Fr)])
	const rb = sortNotesByColor(big, [], { frame: Fr })
	assert.ok(!rb.ops.some((o) => o.id === Fr), 'no patch of the frame')
	assert.equal(rb.ops.length, 4)
	// only the side that is too small grows
	const wide = new FakeModel([frame(Fr, { x: 1000, y: 1000, w: 3000, h: 300 }), ...kids(Fr)])
	assert.deepEqual(sortNotesByColor(wide, [], { frame: Fr }).ops[0], { o: 'patch', id: Fr, p: { h: 320 } })
})

test('job 139: a locked frame, no frame or a frame with fewer than two sortable notes sorts nothing; fewer than two loose notes neither', () => {
	const Fr = ID('F8')
	const locked = new FakeModel([frame(Fr, { lock: { by: 'p', name: 'P' } }), note(A, 0, 0, BLUE, { parent: Fr }), note(B, 300, 0, BLUE, { parent: Fr })])
	assert.deepEqual(sortableNotes(locked, [], { frame: Fr }), [])
	assert.deepEqual(sortNotesByColor(locked, [], { frame: Fr }), { ops: [], inverse: [], blocks: [] })
	const m = new FakeModel([note(A, 0, 0, BLUE), shape(S, { x: 300 })])
	assert.deepEqual(sortableNotes(m, [], { frame: A }), [], 'a note is no frame')
	assert.deepEqual(sortNotesByColor(m, [A, S]), { ops: [], inverse: [], blocks: [] }, 'one note')
	assert.deepEqual(sortNotesByColor(m, [A, A]), { ops: [], inverse: [], blocks: [] }, 'one note, twice in the list')
})

test('job 139: rotated notes sit with their hull in the corner of the cell (the largest hull); colours compare in lower case; equal places keep the selection order', () => {
	const m = new FakeModel([note(A, 0, 0, '#FAEA89'), note(B, 0, 0, YELLOW, { r: 30 }), note(C, 0, 0, '#ABCDEF'), note(D, 0, 0, '#abcdef')])
	const hull = rotatedBBox(0, 0, 200, 200, 30)
	const cell = hull[2] - hull[0]
	const r = sortNotesByColor(m, [B, A, D, C])
	assert.deepEqual(r.blocks.map((b) => [b.color, b.x, b.w]), [
		[YELLOW, Math.round(hull[0]), 2 * cell + SORT_GAP],
		['#abcdef', Math.round(hull[0]) + 2 * cell + SORT_GAP + SORT_BLOCK_GAP, 2 * cell + SORT_GAP],
	], 'two blocks: case does not matter')
	applyOps(m, r.ops)
	const box = (id) => {
		const it = m.get(id)
		return rotatedBBox(it.x, it.y, it.w, it.h, it.r)
	}
	const [x0] = [r.blocks[0].x]
	// the tie (same place) keeps the selection order: B first, then A
	assert.ok(Math.abs(box(B)[0] - x0) <= 0.005 && Math.abs(box(B)[1] - r.blocks[0].y) <= 0.005, 'B (rotated) in the first cell: its hull in the corner')
	assert.ok(Math.abs(box(A)[0] - (x0 + cell + SORT_GAP)) <= 0.005, 'A in the second cell')
	assert.equal(m.get(B).r, 30, 'the rotation stays')
	assert.deepEqual(sortNotesByColor(m, [B, A, D, C]).ops, [], 'sorted: no op (no creeping on the 0.01 grid)')
})

test('job 139: custom colours follow the palette colours in the order of their first note; a block of five has three columns', () => {
	const ids = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ID(100 + n))
	const fills = ['#222222', '#111111', '#222222', BLUE, '#111111', '#222222', '#222222', '#222222']
	const m = new FakeModel(ids.map((id, k) => note(id, k * 300, 0, fills[k])))
	const r = sortNotesByColor(m, ids)
	assert.deepEqual(r.blocks.map((b) => b.color), [BLUE, '#222222', '#111111'])
	const five = r.blocks[1]
	assert.equal(five.w, 3 * 200 + 2 * SORT_GAP, 'ceil(√5) = 3 columns')
	assert.equal(five.h, 2 * 200 + SORT_GAP, 'two rows')
	assert.equal(r.blocks[2].x, five.x + five.w + SORT_BLOCK_GAP)
	assert.equal(SORT_MARGIN, 60)
})

test('job 139: sortBlockName puts a text item of the default style (job 241 AK4: left-aligned) above the block (bottom 10 above it, the block\'s width, the measured height), in the block\'s frame while it exists; nothing for an empty or too long name', () => {
	const Fr = ID('F9')
	const m = new FakeModel([frame(Fr, { x: 1000, y: 1000, w: 1100, h: 400 })])
	const block = { color: YELLOW, x: 1060, y: 1060, w: 420, h: 200, parent: Fr }
	let measured = null
	const r = sortBlockName(m, block, 'Ideas', { measure: (it) => { measured = it; return 28.8 } }, () => ID(77))
	assert.equal(measured.w, 420)
	assert.deepEqual(measured.data, { text: 'Ideas' })
	assert.deepEqual(r.ops, [{
		o: 'put', id: ID(77), t: 'text',
		p: { x: 60, y: 60 - SORT_NAME_GAP - 28.8, w: 420, h: 28.8, r: 0, z: r.ops[0].p.z, parent: Fr, data: { text: 'Ideas' }, style: { ...TYPES.text.defaults.style, align: 'left' } },
	}])
	assert.deepEqual(r.inverse, [{ o: 'remove', id: ID(77) }])
	// the frame is gone: loose, absolute
	const loose = sortBlockName(new FakeModel([]), block, 'Ideas', { measure: () => 28.8 }, () => ID(78))
	assert.equal(loose.ops[0].p.parent, null)
	assert.equal(loose.ops[0].p.x, 1060)
	assert.equal(loose.ops[0].p.y, 1060 - SORT_NAME_GAP - 28.8)
	assert.deepEqual(sortBlockName(m, block, '', {}, () => ID(79)), { ops: [], inverse: [] })
	assert.deepEqual(sortBlockName(m, block, 'x'.repeat(6001), {}, () => ID(79)), { ops: [], inverse: [] })
	// without a measurement: the default height
	assert.equal(sortBlockName(m, block, 'Ideas', {}, () => ID(80)).ops[0].p.h, TYPES.text.defaults.h)
})

test('job 227 AK5: an old and a new Light blue sort into one block; the blocks follow the order of the one palette (Light blue, Yellow, …, Black), custom colours after it', () => {
	const [P, Q, R, S, T] = [ID(71), ID(72), ID(73), ID(74), ID(75)]
	const m = new FakeModel([
		note(P, 0, 0, '#191b1d'), note(Q, 300, 0, '#fff6b6'), note(R, 600, 0, '#a8d8f8'), note(S, 900, 0, '#123456'), note(T, 1200, 0, '#a2d9fe'),
	])
	const r = sortNotesByColor(m, [P, Q, R, S, T])
	assert.deepEqual(r.blocks.map((b) => b.color), ['#a2d9fe', '#faea89', '#191b1d', '#123456'])
	const moved = new Map(r.ops.map((op) => [op.id, op.p]))
	const at = (id) => moved.get(id)?.x ?? m.get(id).x
	assert.ok(at(R) === r.blocks[0].x || at(T) === r.blocks[0].x, 'the Light blue block starts with one of the two')
	assert.equal(new Set([at(R), at(T)].map((x) => x >= r.blocks[0].x && x < r.blocks[1].x)).size, 1, 'both in the first block')
	assert.equal(m.get(R).style.fill, '#a8d8f8', 'sorting writes no colour')
})

test('job 286: a covered note of private writing is not sorted (its colour is unknown), with and without a frame', () => {
	const Fr = ID('F8')
	const [Y1, Y2, H1, H2] = [ID(21), ID(22), ID(23), ID(24)]
	const covered = { data: { covered: true }, style: {} }
	const model = new FakeModel([
		note(Y1, 0, 0, YELLOW), note(Y2, 300, 0, YELLOW), sticky(H1, { x: 600, y: 0, ...covered }),
		frame(Fr, { x: 3000, y: 0, w: 800, h: 600 }),
		note(ID(25), 10, 10, YELLOW, { parent: Fr }), note(ID(26), 250, 10, BLUE, { parent: Fr }), sticky(H2, { x: 10, y: 260, parent: Fr, ...covered }),
	])
	assert.deepEqual(sortableNotes(model, [Y1, Y2, H1]).sort(), [Y1, Y2].sort())
	assert.deepEqual(sortableNotes(model, [], { frame: Fr }).sort(), [ID(25), ID(26)].sort())
	const r = sortNotesByColor(model, [], { frame: Fr })
	assert.equal(r.ops.some((o) => o.id === H2), false, 'no op for the covered note')
})
