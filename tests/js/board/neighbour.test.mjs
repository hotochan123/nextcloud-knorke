/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Neighbour with one click (job 136), the pure action neighbourItem:
 * - AK1 place and content, unrotated: note (fill, fontSize), shape (diamond,
 *   every style field) on every side; style fields that fail their rule,
 *   unknown fields, lock and group are not copied
 * - job 159 AK1 a text item's neighbour is a copy: its text, style, size and
 *   rotation, nothing measured, the place, moving on and parent as for a
 *   note; an empty text (blanks only) gives no ops
 * - AK2 rotated source (r = 30): r copied, the centre on the rotated normal
 *   at (width or height + SERIES_GAP), to 0.01
 * - AK3 moving on: a row of note, text and shape in the start place → 20
 *   behind the last; touching items, frames and connectors do not move it;
 *   rotated obstacles count with their rotated rectangle; locked, grouped
 *   and unknown items are obstacles too
 * - AK4 parent: the source's frame when the neighbour fits completely, else
 *   none or the frame under its centre
 * - job 148 AK1 with connect: [put N, put C], C at the facing anchors of Q
 *   and N (note on every side, triangle, rotated), z above N, route and end
 *   cap from the options when valid, inverse [remove C, remove N]
 * - job 162 AK1 with connect and a near item X: only [put C] from the anchor
 *   of "+" to X's facing anchor, X selected, inverse [remove C]; every side;
 *   the limits (d 200, d 200.5, a 1-unit overlap across, touching across,
 *   overlapping Q); the choice (least d, then the centre offset across,
 *   then the id); text, shape, locked note and triangle as targets, frames
 *   and connectors never; a connector Q→X, X→Q or with auto ends leaves X
 *   out; rotated Q and rotated X; without connect X is only an obstacle;
 *   a text item never searches
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SERIES_GAP, neighbourItem } from '../../../src/board/actions.js'
import { PLUS_REACH } from '../../../src/model/plus.js'
import { isValidKey } from '../../../src/model/zorder.js'
import { FakeModel, ID, connector, frame, shape, sticky, textItem } from './fakes.mjs'

const Q = ID('Q1')
const NEW = ID('N1')
const F = ID('F1')
const F2 = ID('F2')
const SIDES = ['t', 'r', 'b', 'l']

/**
 * @param {object} m FakeModel
 * @param {string} side side
 * @param {object} [o] options of neighbourItem
 * @return {object} the put of the neighbour
 */
function putOf(m, side, o = {}) {
	const r = neighbourItem(m, { id: Q, side }, o, () => NEW)
	assert.equal(r.ops.length, 1, `one put for side ${side}`)
	assert.deepEqual(r.inverse, [{ o: 'remove', id: NEW }])
	assert.deepEqual(r.selectIds, [NEW])
	assert.equal(r.edit, true)
	return r.ops[0]
}

/**
 * @param {object} put put op (parent null)
 * @return {[number, number]} centre of its box
 */
const centre = (put) => [put.p.x + put.p.w / 2, put.p.y + put.p.h / 2]

test('AK1 note: every side, size of Q, flush with Q, 20 away; fill and fontSize copied, empty text, r 0, on top, no lock, no group', () => {
	const m = new FakeModel([sticky(Q, { x: 100, y: 100, z: 'i5', data: { text: 'Q' }, style: { fill: '#ffd6a5', fontSize: 30 }, lock: { by: 'pidcarol00000001', name: 'Carol' }, group: ID('G1') })])
	const want = { t: [100, -120], r: [320, 100], b: [100, 320], l: [-120, 100] }
	for (const side of SIDES) {
		const put = putOf(m, side)
		assert.equal(put.t, 'sticky')
		assert.equal(put.id, NEW)
		const { z, ...p } = put.p
		assert.deepEqual(p, { x: want[side][0], y: want[side][1], w: 200, h: 200, r: 0, parent: null, data: { text: '' }, style: { fill: '#ffd6a5', fontSize: 30 } }, side)
		assert.ok(isValidKey(z) && z > 'i5', 'on top of the content layer')
	}
})

test('AK1 shape: data.kind of Q and every valid style field; a value that fails its rule and an unknown field stay out', () => {
	const style = {
		fill: '#ff0000', fillOpacity: 40, stroke: '#00ff00', strokeWidth: 6, dash: 'dashed', textColor: '#0000ff',
		fontSize: 18, align: 'left', valign: 'bottom',
	}
	const m = new FakeModel([shape(Q, { x: 0, y: 0, w: 200, h: 120, data: { kind: 'diamond', text: 'Q' }, style: { ...style, glow: 'yes' } })])
	const want = { t: [0, -140], r: [220, 0], b: [0, 140], l: [-220, 0] }
	for (const side of SIDES) {
		const put = putOf(m, side)
		assert.equal(put.t, 'shape')
		assert.deepEqual([put.p.x, put.p.y, put.p.w, put.p.h, put.p.r], [...want[side], 200, 120, 0], side)
		assert.deepEqual(put.p.data, { kind: 'diamond', text: '' })
		assert.deepEqual(put.p.style, style)
	}
	// a stored value that fails its rule is not copied: the default stays
	const bad = new FakeModel([shape(Q, { data: { kind: 'diamond', text: '' }, style: { fill: 'red', stroke: '#00ff00', strokeWidth: 99 } })])
	assert.deepEqual(putOf(bad, 'r').p.style, { fill: '#ffffff', stroke: '#00ff00', strokeWidth: 2 })
})

// ---------------------------------------------------------------- job 159: a text item's neighbour is a copy

/** T of job 159 AK1: (100, 100), 300 × 45, "Hallo", fontSize 32, color #c0392b, align center. */
const COPY_STYLE = Object.freeze({ fontSize: 32, color: '#c0392b', align: 'center' })
const textT = (o = {}) => textItem(Q, { x: 100, y: 100, w: 300, h: 45, z: 'i5', data: { text: 'Hallo' }, style: { ...COPY_STYLE }, ...o })

/**
 * @param {object} m FakeModel
 * @param {string} side side
 * @return {object} the put of the copy (asserted: one put, inverse [remove K], selection [K], no editor)
 */
function copyOf(m, side) {
	const r = neighbourItem(m, { id: Q, side }, {}, () => NEW)
	assert.equal(r.ops.length, 1, `one put for side ${side}`)
	assert.deepEqual(r.inverse, [{ o: 'remove', id: NEW }])
	assert.deepEqual(r.selectIds, [NEW])
	assert.equal(r.edit, false, 'the copy needs no editor')
	return r.ops[0]
}

test('job 159 AK1 text copy on side r: one put, text and style of T, w 300, h 45, x 420, y 100, on top; inverse [remove K], selection [K]; nothing measured; side b gives y 165', () => {
	const m = new FakeModel([textT({ lock: { by: 'pidcarol00000001', name: 'Carol' }, group: ID('G1') }), sticky(ID(1), { x: 2000, y: 2000, z: 'i7' })])
	let measured = 0
	const r = neighbourItem(m, { id: Q, side: 'r' }, { measure: () => { measured++; return 99 } }, () => NEW)
	assert.equal(measured, 0, 'measure is never called')
	assert.deepEqual(r.inverse, [{ o: 'remove', id: NEW }])
	assert.deepEqual(r.selectIds, [NEW])
	assert.equal(r.ops.length, 1)
	const { z, ...p } = r.ops[0].p
	assert.deepEqual([r.ops[0].o, r.ops[0].id, r.ops[0].t], ['put', NEW, 'text'])
	assert.deepEqual(p, { x: 420, y: 100, w: 300, h: 45, r: 0, parent: null, data: { text: 'Hallo' }, style: { ...COPY_STYLE } }, 'no lock, no group')
	assert.ok(isValidKey(z) && m.ids().every((id) => z > m.get(id).z), 'z above all')
	assert.deepEqual([copyOf(m, 'b').p.x, copyOf(m, 'b').p.y], [100, 165])
	assert.deepEqual([copyOf(m, 'l').p.x, copyOf(m, 't').p.y], [-220, 35])
	// a multi-line text keeps its height (the copy is not measured anew)
	const two = new FakeModel([textT({ h: 76.8, data: { text: 'two\nlines' } })])
	assert.deepEqual([copyOf(two, 'b').p.h, copyOf(two, 'b').p.data.text], [76.8, 'two\nlines'])
})

test('job 159 AK1 text copy rotated (r = 30): r 30, the centre on the rotated normal at width + 20; an obstacle on the right moves it on; T in a frame K fits into: the frame is parent', () => {
	const a = 30 * Math.PI / 180
	const rot = new FakeModel([textT({ r: 30 })])
	const put = copyOf(rot, 'r')
	assert.deepEqual([put.p.r, put.p.w, put.p.h, put.p.data.text], [30, 300, 45, 'Hallo'])
	const [cx, cy] = centre(put)
	assert.ok(Math.abs(cx - (250 + Math.cos(a) * 320)) <= 0.01 && Math.abs(cy - (122.5 + Math.sin(a) * 320)) <= 0.01, `centre ${cx}, ${cy}`)
	const blocked = new FakeModel([textT(), sticky(ID(1), { x: 500, y: 50, w: 100, h: 100 })])
	assert.deepEqual([copyOf(blocked, 'r').p.x, copyOf(blocked, 'r').p.y], [620, 100], 'moved on past the note, 20 behind it')
	const framed = new FakeModel([frame(F, { x: 0, y: 0, w: 1000, h: 600, z: 'a0' }), textT({ parent: F })])
	const inside = copyOf(framed, 'r')
	assert.deepEqual([inside.p.parent, inside.p.x, inside.p.y], [F, 420, 100], 'the frame is parent, positions relative to it')
})

test('job 159 AK1 an empty text (also blanks only) gives no ops', () => {
	for (const text of ['', '  ', '\n\t ']) {
		const m = new FakeModel([textT({ data: { text } })])
		for (const side of SIDES) {
			assert.deepEqual(neighbourItem(m, { id: Q, side }, {}, () => NEW), { ops: [], inverse: [], selectIds: [], edit: false }, JSON.stringify(text))
		}
	}
})

test('job 241: a text copy takes the alignment T shows: left without a stored one (not the centred create default), centred and right as stored', () => {
	const style = (o) => copyOf(new FakeModel([textT(o)]), 'r').p.style.align
	assert.equal(style({ style: { fontSize: 24, color: '#191b1d' } }), 'left')
	assert.equal(style({ style: { fontSize: 24, align: 'justify' } }), 'left', 'an invalid stored value shows left')
	assert.equal(style({ style: { fontSize: 24, align: 'center' } }), 'center')
	assert.equal(style({ style: { fontSize: 24, align: 'right' } }), 'right')
})

test('AK1 no neighbour of a frame, a connector, an unknown item or side, or a missing item', () => {
	const m = new FakeModel([frame(F), sticky(Q), connector(ID('C1'), { x: 0, y: 0 }, { x: 100, y: 0 })])
	assert.equal(neighbourItem(m, { id: F, side: 'r' }).ops.length, 0)
	assert.equal(neighbourItem(m, { id: ID('C1'), side: 'r' }).ops.length, 0)
	assert.equal(neighbourItem(m, { id: ID('X'), side: 'r' }).ops.length, 0)
	assert.equal(neighbourItem(m, { id: Q, side: 'x' }).ops.length, 0)
	assert.equal(neighbourItem(m, { id: Q, side: 'constructor' }).ops.length, 0)
})

test('AK2 rotated source (r = 30): r copied, the centre lies on the rotated normal at width or height + 20, to 0.01', () => {
	const a = 30 * Math.PI / 180
	const normal = { t: [Math.sin(a), -Math.cos(a)], r: [Math.cos(a), Math.sin(a)], b: [-Math.sin(a), Math.cos(a)], l: [-Math.cos(a), -Math.sin(a)] }
	for (const [item, w, h] of [[sticky(Q, { x: 100, y: 100, r: 30 }), 200, 200], [shape(Q, { x: 100, y: 100, w: 200, h: 120, r: 30 }), 200, 120]]) {
		const m = new FakeModel([item])
		const qc = [100 + w / 2, 100 + h / 2]
		for (const side of SIDES) {
			const put = putOf(m, side)
			assert.equal(put.p.r, 30)
			assert.deepEqual([put.p.w, put.p.h], [w, h])
			const d = (side === 'r' || side === 'l' ? w : h) + SERIES_GAP
			const [cx, cy] = centre(put)
			assert.ok(Math.abs(cx - (qc[0] + normal[side][0] * d)) <= 0.01, `${item.t} ${side}: x ${cx}`)
			assert.ok(Math.abs(cy - (qc[1] + normal[side][1] * d)) <= 0.01, `${item.t} ${side}: y ${cy}`)
		}
	}
})

test('AK3 a row of note, text and shape in the start place: the neighbour lands 20 behind the last; locked and grouped items count', () => {
	const m = new FakeModel([
		sticky(Q, { x: 0, y: 0 }),
		sticky(ID(1), { x: 230, y: 0, lock: { by: 'pidcarol00000001', name: 'Carol' } }),
		textItem(ID(2), { x: 440, y: 50, w: 100, h: 30, group: ID('G1') }),
		shape(ID(3), { x: 600, y: 100, w: 200, h: 120 }),
	])
	const put = putOf(m, 'r')
	assert.deepEqual([put.p.x, put.p.y], [820, 0])
	// the same to the left: an unknown type in the way counts too
	const m2 = new FakeModel([sticky(Q, { x: 0, y: 0 }), { id: ID(4), t: 'widget', x: -150, y: 150, w: 100, h: 100, r: 0, z: 'i1', parent: null, data: {}, style: {} }])
	assert.deepEqual([putOf(m2, 'l').p.x, putOf(m2, 'l').p.y], [-150 - 20 - 200, 0])
})

test('AK3 an item that only touches (also within 0.01), a frame and a connector in the way do not move it', () => {
	const m = new FakeModel([
		sticky(Q, { x: 0, y: 0 }),
		sticky(ID(1), { x: 420, y: 0 }),
		sticky(ID(2), { x: 220, y: 199.995, w: 100, h: 100 }),
		frame(F, { x: 380, y: -100, w: 400, h: 400 }),
		connector(ID('C1'), { x: 250, y: 50 }, { x: 400, y: 150 }, { x: 250, y: 50, w: 150, h: 100 }),
	])
	const put = putOf(m, 'r')
	assert.deepEqual([put.p.x, put.p.y, put.p.parent], [220, 0, null])
})

test('AK3 rotated obstacles count with their rotated rectangle: a hull in the way moves nothing, the rotated box moves it past its far corner', () => {
	// D: 100 × 100 at 45°, centre (470, 250): its hull reaches into the start place (220..420, 0..200), its diamond does not
	const hullOnly = new FakeModel([sticky(Q, { x: 0, y: 0 }), sticky(ID(1), { x: 420, y: 200, w: 100, h: 100, r: 45 })])
	assert.deepEqual([putOf(hullOnly, 'r').p.x, putOf(hullOnly, 'r').p.y], [220, 0])
	// E: 100 × 100 at 45°, centre (430, 100): its left corner lies in the start place, its right corner at 430 + 50·√2
	const covering = new FakeModel([sticky(Q, { x: 0, y: 0 }), sticky(ID(2), { x: 380, y: 50, w: 100, h: 100, r: 45 })])
	const put = putOf(covering, 'r')
	assert.deepEqual([put.p.x, put.p.y], [Math.round((430 + 50 * Math.SQRT2 + 20) * 100) / 100, 0])
	// a rotated source moves along its rotated normal: the neighbour of a 90° note to its "right" goes down on screen
	const turned = new FakeModel([sticky(Q, { x: 0, y: 0, r: 90 }), sticky(ID(3), { x: 0, y: 230 })])
	const down = putOf(turned, 'r')
	assert.deepEqual([down.p.x, down.p.y, down.p.r], [0, 450, 90])
})

test('AK4 parent: Q\'s frame when the neighbour fits completely (also below another frame on top); sticking out: none or the frame under its centre', () => {
	const m = new FakeModel([
		frame(F, { x: 0, y: 0, w: 1000, h: 600, z: 'a0' }),
		frame(F2, { x: 400, y: 0, w: 300, h: 300, z: 'a5' }),
		sticky(Q, { x: 100, y: 100, parent: F }),
	])
	const inside = putOf(m, 'r')
	assert.deepEqual([inside.p.parent, inside.p.x, inside.p.y], [F, 320, 100], 'fits into F: F, although F2 lies on top under its centre')
	const out = putOf(m, 'l')
	assert.deepEqual([out.p.parent, out.p.x, out.p.y], [null, -120, 100], 'sticks out of F, no frame under its centre')
	const m2 = new FakeModel([
		frame(F, { x: 0, y: 0, w: 500, h: 600, z: 'a0' }),
		frame(F2, { x: 500, y: 0, w: 800, h: 600, z: 'a1' }),
		sticky(Q, { x: 250, y: 100, parent: F }),
	])
	const next = putOf(m2, 'r')
	assert.deepEqual([next.p.parent, next.p.x, next.p.y], [F2, -30, 100], 'sticks out of F: the frame under its centre, relative to it')
})

// ---------------------------------------------------------------- job 148: a connector with the neighbour

const CN = ID('C2')
const DEFAULTS = Object.freeze({ route: 'elbow', endCap: 'arrow' })
/** neighbourItem's id generator: N first, then C. */
const ids = () => {
	const left = [NEW, CN]
	return () => left.shift()
}

/**
 * @param {object} m FakeModel
 * @param {string} side side
 * @param {object} [connect] connector options
 * @return {{n: object, c: object}} the two puts (asserted: [put N, put C], inverse [remove C, remove N], selection [N])
 */
function pairOf(m, side, connect = DEFAULTS) {
	const r = neighbourItem(m, { id: Q, side, connect }, {}, ids())
	assert.deepEqual(r.ops.map((op) => [op.o, op.id, op.t]), [['put', NEW, m.get(Q).t], ['put', CN, 'connector']], side)
	assert.deepEqual(r.inverse, [{ o: 'remove', id: CN }, { o: 'remove', id: NEW }])
	assert.deepEqual(r.selectIds, [NEW])
	return { n: r.ops[0], c: r.ops[1] }
}

test('job 148 AK1 note with connect, every side: [put N, put C], C from the anchor of Q on that side to the facing anchor of N, straight with an arrow, x/y/w/h/r 0, parent null, z(C) > z(N) > every other z', () => {
	const m = new FakeModel([
		frame(F, { x: 2000, y: 2000, z: 'i1' }),
		sticky(Q, { x: 100, y: 100, z: 'i5', style: { fill: '#ffd6a5' } }),
		sticky(ID(1), { x: 3000, y: 0, z: 'i7' }),
		connector(ID('C1'), { item: ID(1) }, { x: 0, y: 3000 }, { z: 'i8' }),
	])
	const want = { t: [[0.5, 0], [0.5, 1]], r: [[1, 0.5], [0, 0.5]], b: [[0.5, 1], [0.5, 0]], l: [[0, 0.5], [1, 0.5]] }
	for (const side of SIDES) {
		const { n, c } = pairOf(m, side)
		const [[sx, sy], [ex, ey]] = want[side]
		const { z, ...p } = c.p
		assert.deepEqual(p, {
			x: 0, y: 0, w: 0, h: 0, r: 0, parent: null,
			data: { route: 'elbow', start: { item: Q, ax: sx, ay: sy }, end: { item: NEW, ax: ex, ay: ey } },
			style: { stroke: '#3d4044', strokeWidth: 2, endCap: 'arrow' },
		}, side)
		assert.ok(isValidKey(z) && isValidKey(n.p.z), side)
		assert.ok(z > n.p.z && m.ids().every((id) => n.p.z > m.get(id).z), `${side}: C above N, N above every other item`)
		// the neighbour itself is the same as without connect
		assert.deepEqual(n, neighbourItem(m, { id: Q, side }, {}, () => NEW).ops[0], `${side}: N as without connect`)
	}
})

test('job 148 AK1 triangle on side r: anchors (0.75, 0.5) → (0.25, 0.5); rotated (r = 30) the same anchors', () => {
	for (const r of [0, 30]) {
		const m = new FakeModel([shape(Q, { x: 0, y: 0, w: 200, h: 120, r, data: { kind: 'triangle', text: '' } })])
		const { n, c } = pairOf(m, 'r')
		assert.equal(n.p.data.kind, 'triangle')
		assert.deepEqual([c.p.data.start, c.p.data.end], [{ item: Q, ax: 0.75, ay: 0.5 }, { item: NEW, ax: 0.25, ay: 0.5 }], `r ${r}`)
		assert.equal(c.p.r, 0)
	}
})

test('job 148 AK1 the options: curved and none are taken; zigzag and 7 give the defaults (job 153: elbow); without connect only the put of N', () => {
	const m = new FakeModel([sticky(Q, { x: 0, y: 0 })])
	const { c } = pairOf(m, 'b', { route: 'curved', endCap: 'none' })
	assert.deepEqual([c.p.data.route, c.p.style.endCap], ['curved', 'none'])
	const bad = pairOf(m, 'b', { route: 'zigzag', endCap: 7 }).c
	assert.deepEqual([bad.p.data.route, bad.p.style.endCap, bad.p.style.stroke, bad.p.style.strokeWidth], ['elbow', 'triangle', '#3d4044', 2])
	const empty = pairOf(m, 'b', {}).c
	assert.deepEqual([empty.p.data.route, empty.p.style.endCap], ['elbow', 'triangle'], 'options not given: the defaults')
	for (const connect of [undefined, null, 'yes']) {
		const r = neighbourItem(m, { id: Q, side: 'b', connect }, {}, ids())
		assert.deepEqual(r.ops.map((op) => op.id), [NEW], `connect ${connect}: only N`)
		assert.deepEqual(r.inverse, [{ o: 'remove', id: NEW }])
	}
	// no neighbour, no connector
	assert.deepEqual(neighbourItem(m, { id: Q, side: 'x', connect: DEFAULTS }, {}, ids()).ops, [])
})

// ---------------------------------------------------------------- job 162: a click on "+" connects to a near item

const X = ID('X1')
const Y = ID('Y1')
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

/**
 * @param {object[]} items the items beside Q (a note at (0, 0), 200 × 200, z i5)
 * @param {object} [q] fields of Q
 * @return {object} FakeModel
 */
const board = (items, q = {}) => new FakeModel([sticky(Q, { x: 0, y: 0, z: 'i5', ...q }), ...items])

/**
 * @param {object} m FakeModel
 * @param {string} side side
 * @return {object} the result of a click on that "+" (asserted: only the put of C, inverse [remove C], no editor)
 */
function joinOf(m, side) {
	const r = neighbourItem(m, { id: Q, side, connect: DEFAULTS }, {}, () => CN)
	assert.deepEqual(r.ops.map((op) => [op.o, op.id, op.t]), [['put', CN, 'connector']], `${side}: only the put of C`)
	assert.deepEqual(r.inverse, [{ o: 'remove', id: CN }])
	assert.equal(r.edit, false)
	return r
}

/** @return {[object, object]} the ends of the put of C */
const endsOf = (r) => [r.ops[0].p.data.start, r.ops[0].p.data.end]

/** @param {object} r result of neighbourItem @return {boolean} a neighbour with its connector (no connect to X) */
const madeNeighbour = (r) => r.ops.length === 2 && r.ops[0].t !== 'connector' && r.ops[1].t === 'connector' && r.ops[1].p.data.end.item === r.ops[0].id

test('job 162 AK1 X at (350, 100), side r: exactly [put C] from {Q, 1, 0.5} to {X, 0, 0.5}, elbow, arrow, x/y/w/h/r 0, parent null, z above all; inverse [remove C], X selected; every side 150 away and 100 across gives the facing anchors', () => {
	const m = board([sticky(X, { x: 350, y: 100, z: 'i7' }), frame(F, { x: 3000, y: 0, z: 'i1' }), connector(ID('C1'), { x: 5000, y: 0 }, { x: 5100, y: 0 }, { z: 'i8' })])
	const r = joinOf(m, 'r')
	assert.deepEqual(r.selectIds, [X])
	const { z, ...p } = r.ops[0].p
	assert.deepEqual(p, {
		x: 0, y: 0, w: 0, h: 0, r: 0, parent: null,
		data: { route: 'elbow', start: { item: Q, ax: 1, ay: 0.5 }, end: { item: X, ax: 0, ay: 0.5 } },
		style: { stroke: '#3d4044', strokeWidth: 2, endCap: 'arrow' },
	})
	assert.ok(isValidKey(z) && m.ids().every((id) => z > m.get(id).z), 'z above every item (the frame lies in the back layer)')
	const place = { t: [100, -350], r: [350, 100], b: [100, 350], l: [-350, 100] }
	const want = { t: [[0.5, 0], [0.5, 1]], r: [[1, 0.5], [0, 0.5]], b: [[0.5, 1], [0.5, 0]], l: [[0, 0.5], [1, 0.5]] }
	for (const side of SIDES) {
		const one = board([sticky(X, { x: place[side][0], y: place[side][1] })])
		const [[sx, sy], [ex, ey]] = want[side]
		const j = joinOf(one, side)
		assert.deepEqual(endsOf(j), [{ item: Q, ax: sx, ay: sy }, { item: X, ax: ex, ay: ey }], side)
		assert.deepEqual(j.selectIds, [X], side)
	}
})

test('job 162 AK1 limits: d 200 connects, d 200.5 gives [put N, put C] with N at X.x + 220; 1 unit across connects, touching across (X.y 200) and an X overlapping Q by 5 do not; touching Q (d 0, d −0.005) connects', () => {
	assert.equal(PLUS_REACH, 200)
	assert.deepEqual(joinOf(board([sticky(X, { x: 400, y: 0 })]), 'r').selectIds, [X], 'd 200')
	const far = neighbourItem(board([sticky(X, { x: 400.5, y: 0 })]), { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())
	assert.ok(madeNeighbour(far), 'd 200.5: a neighbour with its connector')
	assert.deepEqual([far.ops[0].p.x, far.ops[0].p.y], [400.5 + 220, 0], 'moved on past X')
	assert.deepEqual(joinOf(board([sticky(X, { x: 350, y: 199 })]), 'r').selectIds, [X], '1 unit across')
	for (const [x, y, what] of [[350, 200, 'touching across'], [350, -200, 'touching across above'], [195, 0, 'overlapping Q by 5']]) {
		const r = neighbourItem(board([sticky(X, { x, y })]), { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())
		assert.ok(madeNeighbour(r), what)
	}
	for (const x of [200, 199.995]) {
		assert.deepEqual(joinOf(board([sticky(X, { x, y: 0 })]), 'r').selectIds, [X], `touching at x ${x}`)
	}
})

test('job 162 AK1 the choice: of d 150 and d 50 the nearer wins; at the same d the smaller offset across; at the same d and offset the smaller id', () => {
	assert.deepEqual(joinOf(board([sticky(X, { x: 350, y: 0 }), sticky(Y, { x: 250, y: 100 })]), 'r').selectIds, [Y], 'd 50 before d 150')
	assert.deepEqual(joinOf(board([sticky(Y, { x: 250, y: 100 }), sticky(X, { x: 350, y: 0 })]), 'r').selectIds, [Y], 'in any order')
	assert.deepEqual(joinOf(board([sticky(X, { x: 300, y: 150 }), sticky(Y, { x: 300, y: -100 })]), 'r').selectIds, [Y], 'offset 100 before 150')
	assert.deepEqual(joinOf(board([sticky(Y, { x: 300, y: 100 }), sticky(X, { x: 300, y: -100 })]), 'r').selectIds, [X], 'the same offset: the smaller id')
	// within 0.01 of the least d counts as the same d
	assert.deepEqual(joinOf(board([sticky(X, { x: 300.005, y: 150 }), sticky(Y, { x: 300, y: -140 })]), 'r').selectIds, [Y], 'd within 0.01: the smaller offset')
})

test('job 162 AK1 targets: a text item, a shape and a locked note are targets (left anchor); a triangle gets the end (0.25, 0.5); a frame and a connector in reach give the neighbour', () => {
	const targets = [
		textItem(X, { x: 350, y: 50, data: { text: 'T' } }),
		shape(X, { x: 350, y: 50, data: { kind: 'ellipse', text: '' } }),
		sticky(X, { x: 350, y: 50, lock: LOCK, group: ID('G1') }),
	]
	for (const it of targets) {
		const r = joinOf(board([it]), 'r')
		assert.deepEqual(endsOf(r), [{ item: Q, ax: 1, ay: 0.5 }, { item: X, ax: 0, ay: 0.5 }], it.t)
		assert.deepEqual(r.selectIds, [X], it.t)
	}
	const tri = joinOf(board([shape(X, { x: 350, y: 50, data: { kind: 'triangle', text: '' } })]), 'r')
	assert.deepEqual(endsOf(tri)[1], { item: X, ax: 0.25, ay: 0.5 })
	for (const it of [frame(F, { x: 300, y: -100, w: 400, h: 400 }), connector(ID('C1'), { x: 260, y: 50 }, { x: 400, y: 150 }, { x: 260, y: 50, w: 140, h: 100 })]) {
		assert.ok(madeNeighbour(neighbourItem(board([it]), { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())), it.t)
	}
})

test('job 162 AK1 connected already: a connector Q→X, X→Q or with auto ends leaves X out (X is an obstacle then); an unconnected Y at d 180 becomes the target', () => {
	const joined = [
		connector(ID('C1'), { item: Q, ax: 1, ay: 0.5 }, { item: X, ax: 0, ay: 0.5 }),
		connector(ID('C1'), { item: X, ax: 0, ay: 0.5 }, { item: Q, ax: 1, ay: 0.5 }),
		connector(ID('C1'), { item: Q }, { item: X }),
		connector(ID('C1'), { item: X }, { item: Q, ax: 0.5, ay: 1 }),
	]
	for (const c of joined) {
		const m = board([sticky(X, { x: 250, y: 0 }), c])
		const r = neighbourItem(m, { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())
		assert.ok(madeNeighbour(r), JSON.stringify([c.data.start, c.data.end]))
		assert.equal(r.ops[0].p.x, 470, 'N moves on past X')
		const withY = board([sticky(X, { x: 250, y: 0 }), sticky(Y, { x: 380, y: 0 }), c])
		assert.deepEqual(joinOf(withY, 'r').selectIds, [Y], 'Y at d 180')
	}
	// a connector between X and another item, or from Q to a free point, does not count
	const other = board([sticky(X, { x: 250, y: 0 }), sticky(Y, { x: 0, y: 900 }), connector(ID('C1'), { item: Y }, { item: X }), connector(ID('C2'), { item: Q }, { x: 600, y: 600 })])
	assert.deepEqual(joinOf(other, 'r').selectIds, [X])
})

test('job 162 AK1 rotation: Q at 90° connects X 100 below it with the start (1, 0.5); X at 45° counts with its rotated box (corner at d 150 connects, at d 201 not)', () => {
	const turned = joinOf(board([sticky(X, { x: 0, y: 300 })], { r: 90 }), 'r')
	assert.deepEqual(endsOf(turned), [{ item: Q, ax: 1, ay: 0.5 }, { item: X, ax: 0.5, ay: 0 }])
	// X 200 × 200 at 45°: its left corner lies 100·√2 left of its centre
	const at = (d) => sticky(X, { x: 200 + d + 100 * Math.SQRT2 - 100, y: 0, r: 45 })
	assert.deepEqual(joinOf(board([at(150)]), 'r').selectIds, [X], 'corner at d 150')
	assert.ok(madeNeighbour(neighbourItem(board([at(201)]), { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())), 'corner at d 201')
})

test('job 162 AK1 without connect (Alt/Option+arrow) X at (350, 100) is only an obstacle: one put N at x 570; a text item with connect never connects', () => {
	const m = board([sticky(X, { x: 350, y: 100 })])
	const put = putOf(m, 'r')
	assert.deepEqual([put.p.x, put.p.y], [570, 0])
	const t = new FakeModel([textT(), sticky(X, { x: 450, y: 100 })])
	const r = neighbourItem(t, { id: Q, side: 'r', connect: DEFAULTS }, {}, ids())
	assert.deepEqual(r.ops.map((op) => [op.id, op.t]), [[NEW, 'text'], [CN, 'connector']], 'the copy with its connector, as in job 159')
})
