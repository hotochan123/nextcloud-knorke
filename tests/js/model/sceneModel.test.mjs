/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/SceneModel.js (SPEC-M0 §6.2, §9.3): load/apply/removes, cascade
 * when a container moves, orphan → root → parent arrives, hitTest (frame edge
 * vs. inside, rotated note, placeholder), queryRect, topContainerAt,
 * moveLocal, ChangeSummary content, maxZ/minZ skipping invalid keys.
 * M1 round 1b: the connector index (connectorsOf, geometryOf, routing over
 * moves, frame cascade, setBoxesLocal and the box resolver, unknown and
 * vanished targets, rbush entry, hit mode 'line', queryRect/boundsOf by the
 * route box, local free-end shift and end overrides that never touch get()).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { routeConnector } from '../../../src/model/connectors.js'
import { FRAME_TITLE_BAND, FRAME_TITLE_SIZE, SHADOW } from '../../../src/model/tokens.js'

const frame = (id, x, y, w = 800, h = 600, z = 'a0', extra = {}) =>
	({ id, t: 'frame', x, y, w, h, r: 0, z, parent: null, data: { title: id }, style: { fill: '#ffffff' }, ...extra })
const note = (id, x, y, parent = null, z = 'a1', extra = {}) =>
	({ id, t: 'sticky', x, y, w: 200, h: 200, r: 0, z, parent, data: { text: id }, style: { fill: '#a8d8f8' }, ...extra })

/** @param {SceneModel} m model @param {number[]} b box @return {boolean} rbush finds the id at the box centre */
const indexed = (m, id) => {
	const a = m.abs(id)
	return m.query(a.x + a.w / 2, a.y + a.h / 2, a.x + a.w / 2, a.y + a.h / 2).some((e) => e.id === id)
}

describe('load', () => {
	test('absolute boxes through parents, independent of load order', () => {
		const items = [note('S', 10, 20, 'F'), frame('F', 100, 50)]
		for (const order of [items, items.slice().reverse()]) {
			const m = new SceneModel()
			m.load(order)
			assert.equal(m.size, 2)
			assert.deepEqual(m.abs('S'), { x: 110, y: 70, w: 200, h: 200, r: 0 })
			assert.deepEqual(m.abs('F'), { x: 100, y: 50, w: 800, h: 600, r: 0 })
			assert.ok(indexed(m, 'S'))
		}
	})

	test('load replaces everything and keeps unknown fields; the model owns copies', () => {
		const m = new SceneModel()
		m.load([note('A', 0, 0)])
		const src = note('B', 0, 0, null, 'a1', { future: { x: 1 } })
		m.load([src])
		assert.equal(m.has('A'), false)
		assert.deepEqual(m.get('B').future, { x: 1 })
		src.x = 999
		src.data.text = 'changed'
		assert.equal(m.get('B').x, 0)
		assert.equal(m.get('B').data.text, 'B')
	})

	test('missing fields are normalised, items without id skipped', () => {
		const m = new SceneModel()
		m.load([{ id: 'X', t: 'sticky', z: 'a0' }, { t: 'sticky' }, null])
		assert.equal(m.size, 1)
		const it = m.get('X')
		assert.equal(it.x, 0)
		assert.equal(it.parent, null)
		assert.deepEqual(it.data, {})
		assert.deepEqual(m.abs('X'), { x: 0, y: 0, w: 0, h: 0, r: 0 })
	})

	test('parent that is no container, unknown parent, cycles and depth', () => {
		const m = new SceneModel()
		m.load([
			note('N', 10, 10),
			note('C', 5, 5, 'N'), // a note is no container → root
			note('O', 7, 8, 'MISSING'), // unknown parent → root
			frame('F1', 100, 100, 800, 600, 'a0', { parent: 'F2' }),
			frame('F2', 1000, 1000, 800, 600, 'a1', { parent: 'F1' }), // cycle → root
		])
		assert.deepEqual(m.abs('C'), { x: 5, y: 5, w: 200, h: 200, r: 0 })
		assert.deepEqual(m.abs('O'), { x: 7, y: 8, w: 200, h: 200, r: 0 })
		assert.equal(m.abs('F1').x, 100)
		assert.equal(m.abs('F2').x, 1000)
		// a chain of 10 containers is resolved for 8 levels at most
		const chain = []
		for (let i = 0; i < 10; i++) chain.push(frame('K' + i, 1, 1, 100, 100, 'a0', { parent: i === 0 ? null : 'K' + (i - 1) }))
		const m2 = new SceneModel()
		m2.load(chain)
		assert.equal(m2.abs('K9').x, 9) // own 1 + 8 ancestors
		assert.equal(m2.abs('K3').x, 4)
	})
})

describe('apply and ChangeSummary', () => {
	test('added, removed, updated fields, geometry, reordered', () => {
		const m = new SceneModel()
		m.load([frame('F', 0, 0), note('S', 10, 10, 'F'), note('T', 5000, 5000)])
		let s = m.apply({ upserts: [note('U', 1, 2)], removes: ['T', 'nope'] })
		assert.deepEqual(s.added, ['U'])
		assert.deepEqual(s.removed, ['T'])
		assert.equal(s.updated.size, 0)
		assert.equal(s.geometry.size, 0)
		assert.equal(s.reordered, false)
		assert.equal(m.has('T'), false)
		assert.equal(m.query(5050, 5050, 5100, 5100).length, 0)

		s = m.apply({ upserts: [{ ...note('S', 10, 10, 'F'), data: { text: 'new' } }] })
		assert.deepEqual([...s.updated.get('S')], ['text'])
		s = m.apply({ upserts: [{ ...note('S', 10, 10, 'F'), data: { text: 'new', extra: 1 } }] })
		assert.deepEqual([...s.updated.get('S')], ['data'])
		s = m.apply({ upserts: [{ ...note('S', 10, 10, 'F'), data: { text: 'new', extra: 1 }, style: { fill: '#000000' } }] })
		assert.deepEqual([...s.updated.get('S')], ['style'])
		s = m.apply({ upserts: [{ ...m.get('S'), z: 'a5' }] })
		assert.deepEqual([...s.updated.get('S')], ['z'])
		assert.equal(s.reordered, true)
		s = m.apply({ upserts: [{ ...m.get('S'), w: 300 }] })
		assert.deepEqual([...s.updated.get('S')], ['geom'])
		assert.deepEqual([...s.geometry], ['S'])
		s = m.apply({ upserts: [{ ...m.get('S'), t: 'mystery' }] })
		assert.ok(s.updated.get('S').has('type'))
		assert.equal(s.reordered, true)
		// an identical upsert is no change
		s = m.apply({ upserts: [{ ...m.get('S') }] })
		assert.equal(s.updated.size, 0)
		// empty values count as absent (no change)
		s = m.apply({ upserts: [{ ...m.get('S'), data: { ...m.get('S').data, e: {} } }] })
		assert.equal(s.updated.size, 0)
	})

	test('parent change keeps the absolute box when the client recomputes x/y (no geometry)', () => {
		const m = new SceneModel()
		m.load([frame('F', 100, 100), note('S', 150, 150)])
		const s = m.apply({ upserts: [note('S', 50, 50, 'F')] })
		assert.deepEqual([...s.updated.get('S')].sort(), ['geom', 'parent'])
		assert.equal(s.geometry.size, 0, 'abs unchanged')
		assert.deepEqual(m.childrenOf('F'), ['S'])
	})

	test('cascade: moving a container moves all descendants (abs + rbush)', () => {
		const m = new SceneModel()
		m.load([frame('F', 0, 0), note('A', 10, 10, 'F'), note('B', 300, 10, 'F', 'a2'), note('X', 5000, 5000)])
		const s = m.apply({ upserts: [frame('F', 1000, 2000)] })
		assert.deepEqual([...s.geometry].sort(), ['A', 'B', 'F'])
		assert.deepEqual(m.abs('A'), { x: 1010, y: 2010, w: 200, h: 200, r: 0 })
		assert.ok(indexed(m, 'A') && indexed(m, 'B'))
		assert.equal(m.query(10, 10, 20, 20).length, 0, 'old index entries are gone')
	})

	test('orphan → root → parent arrives → recomputed and reported as geometry', () => {
		const m = new SceneModel()
		m.load([])
		let s = m.apply({ upserts: [note('S', 10, 20, 'F')] })
		assert.deepEqual(s.added, ['S'])
		assert.deepEqual(m.abs('S'), { x: 10, y: 20, w: 200, h: 200, r: 0 })
		s = m.apply({ upserts: [frame('F', 1000, 1000)] })
		assert.deepEqual(s.added, ['F'])
		assert.deepEqual([...s.geometry], ['S'])
		assert.deepEqual(m.abs('S'), { x: 1010, y: 1020, w: 200, h: 200, r: 0 })
		assert.ok(indexed(m, 'S'))
		// parent removed → children back at the root
		s = m.apply({ removes: ['F'] })
		assert.deepEqual(s.removed, ['F'])
		assert.deepEqual([...s.geometry], ['S'])
		assert.deepEqual(m.abs('S'), { x: 10, y: 20, w: 200, h: 200, r: 0 })
	})

	test('child and parent in one apply, any order', () => {
		for (const ups of [[note('S', 1, 2, 'F'), frame('F', 10, 20)], [frame('F', 10, 20), note('S', 1, 2, 'F')]]) {
			const m = new SceneModel()
			m.load([])
			const s = m.apply({ upserts: ups })
			assert.deepEqual(s.added.sort(), ['F', 'S'])
			assert.equal(s.geometry.size, 0)
			assert.deepEqual(m.abs('S'), { x: 11, y: 22, w: 200, h: 200, r: 0 })
		}
	})
})

describe('M2 data foundation: group and lock', () => {
	test('load keeps group and lock; missing or invalid ones become null', () => {
		const m = new SceneModel()
		const lock = { by: '3f9a1c0b7d2e4a51', name: 'Alice Adler' }
		m.load([
			note('A', 0, 0, null, 'a1', { group: 'G1', lock }),
			note('B', 0, 0),
			note('C', 0, 0, null, 'a1', { group: 5, lock: 'x' }),
			note('D', 0, 0, null, 'a1', { group: null, lock: [] }),
			note('E', 0, 0, null, 'a1', { lock: { by: null, name: null } }),
		])
		assert.equal(m.get('A').group, 'G1')
		assert.deepEqual(m.get('A').lock, lock)
		assert.notEqual(m.get('A').lock, lock, 'the model owns a copy')
		assert.deepEqual([m.get('B').group, m.get('B').lock], [null, null], 'missing → null')
		assert.deepEqual([m.get('C').group, m.get('C').lock], [null, null], 'group 5 → null, lock "x" → null')
		assert.deepEqual([m.get('D').group, m.get('D').lock], [null, null], 'lock [] → null')
		assert.deepEqual(m.get('E').lock, { by: null, name: null }, 'locked, locker unknown: stays a map')
	})

	test('apply stores an upsert that only changes group or lock and reports exactly that field', () => {
		const m = new SceneModel()
		m.load([note('S', 10, 10)])
		let s = m.apply({ upserts: [{ ...note('S', 10, 10), group: 'G1' }] })
		assert.equal(m.get('S').group, 'G1')
		assert.deepEqual([...s.updated.get('S')], ['group'])
		assert.equal(s.geometry.size, 0)
		assert.equal(s.reordered, false)
		s = m.apply({ upserts: [{ ...m.get('S'), lock: { by: 'p1', name: 'Alice' } }] })
		assert.deepEqual(m.get('S').lock, { by: 'p1', name: 'Alice' })
		assert.deepEqual([...s.updated.get('S')], ['lock'])
		s = m.apply({ upserts: [{ ...m.get('S'), lock: { by: null, name: 'Alice' } }] })
		assert.deepEqual([...s.updated.get('S')], ['lock'], 'lock.by counts')
		s = m.apply({ upserts: [{ ...m.get('S'), lock: null }] })
		assert.equal(m.get('S').lock, null)
		assert.deepEqual([...s.updated.get('S')], ['lock'])
		// an unchanged upsert reports nothing
		s = m.apply({ upserts: [{ ...m.get('S') }] })
		assert.equal(s.updated.size, 0)
		s = m.apply({ upserts: [{ ...note('S', 10, 10), group: 'G1' }] })
		assert.equal(s.updated.size, 0, 'missing lock = null')
	})

	test('job 026 (AK5): the group index follows load, a group change and a remove (membersOf in stacking order)', () => {
		const m = new SceneModel()
		m.load([note('S', 0, 0, null, 'a2', { group: 'G1' }), note('T', 0, 0, null, 'a1', { group: 'G1' }), note('U', 0, 0)])
		assert.deepEqual(m.membersOf('G1'), ['T', 'S'], 'stacking order, not load order')
		m.apply({ upserts: [{ ...m.get('U'), group: 'G1' }] })
		assert.deepEqual(m.membersOf('G1'), ['T', 'U', 'S'], 'U (z a1, id after T) before S (z a2)')
		m.apply({ upserts: [{ ...m.get('S'), group: 'G2' }], removes: ['T'] })
		assert.deepEqual([m.membersOf('G1'), m.membersOf('G2')], [['U'], ['S']])
		assert.deepEqual(m.membersOf('nope'), [])
	})
})

describe('moveLocal', () => {
	test('moves items and descendants, returns geometry ids, no-op for zero', () => {
		const m = new SceneModel()
		m.load([frame('F', 0, 0), note('A', 10, 10, 'F'), note('B', 900, 900)])
		let g = m.moveLocal(['F'], 100, 50)
		assert.deepEqual([...g].sort(), ['A', 'F'])
		assert.equal(m.get('F').x, 100)
		assert.equal(m.get('A').x, 10, 'children keep relative coordinates')
		assert.deepEqual(m.abs('A'), { x: 110, y: 60, w: 200, h: 200, r: 0 })
		assert.ok(indexed(m, 'A'))
		g = m.moveLocal(['B', 'missing'], -1, 0)
		assert.deepEqual([...g], ['B'])
		assert.equal(m.moveLocal(['B'], 0, 0).size, 0)
		assert.equal(m.moveLocal(['B'], NaN, 1).size, 0)
	})
})

describe('hitTest', () => {
	const m = new SceneModel()
	m.load([
		frame('F', 0, 0, 800, 600, 'a0'),
		note('S', 100, 100, 'F', 'a1'),
		note('R', 2000, 0, null, 'a2', { r: 45 }),
		{ id: 'P', t: 'mystery', x: 3000, y: 0, w: 100, h: 100, r: 0, z: 'a3', parent: null, data: {}, style: {} },
	])

	test('frame: edge band and title band hit, the inside is empty canvas', () => {
		assert.equal(m.hitTest(400, 300), null, 'inside')
		assert.equal(m.hitTest(3, 300), 'F', 'left edge band (8 world units at scale 1)')
		assert.equal(m.hitTest(-5, 300), 'F', 'just outside the left edge')
		assert.equal(m.hitTest(400, 597), 'F', 'bottom edge')
		assert.equal(m.hitTest(400, -FRAME_TITLE_BAND + 2), 'F', 'title band')
		assert.equal(m.hitTest(400, -FRAME_TITLE_BAND - 5), null, 'above the title band')
		assert.equal(m.hitTest(20, 300, 0, { edgeWorld: 2 }), null, 'band shrinks with edgeWorld (scale)')
		assert.equal(m.hitTest(20, 300, 0, { edgeWorld: 40 }), 'F')
	})

	test('topmost item first: note over frame', () => {
		assert.equal(m.hitTest(150, 150), 'S')
		assert.equal(m.hitTest(105, 105), 'S')
	})

	test('rotated note: precise test in local coordinates', () => {
		// centre (2100, 100); rotated 45°: the unrotated corner (2005, 5) lies outside
		assert.equal(m.hitTest(2100, 100), 'R')
		assert.equal(m.hitTest(2005, 5), null)
		// a point outside the unrotated box but inside the rotated one
		assert.equal(m.hitTest(2100, -30), 'R')
	})

	test('placeholder hits as a box; tolerance widens', () => {
		assert.equal(m.hitTest(3050, 50), 'P')
		assert.equal(m.hitTest(3103, 50), null)
		assert.equal(m.hitTest(3103, 50, 4), 'P')
	})

	test('equal z keys: id breaks the tie', () => {
		const m2 = new SceneModel()
		m2.load([note('B', 0, 0, null, 'a5'), note('A', 0, 0, null, 'a5')])
		assert.equal(m2.hitTest(10, 10), 'B')
		assert.ok(m2.compareOrder('A', 'B') < 0)
	})
})

describe('queries', () => {
	const m = new SceneModel()
	m.load([
		frame('F', 0, 0, 800, 600, 'a0'),
		frame('G', 100, 100, 200, 200, 'a1'),
		note('S', 50, 50, 'F', 'a2'),
		note('T', 2000, 2000, null, 'a3'),
	])

	test('queryRect intersect vs. contain, negative sizes, stacking order', () => {
		assert.deepEqual(m.queryRect({ x: 0, y: 0, w: 120, h: 120 }), ['F', 'G', 'S'])
		assert.deepEqual(m.queryRect({ x: 120, y: 120, w: -120, h: -120 }), ['F', 'G', 'S'])
		assert.deepEqual(m.queryRect({ x: 40, y: 40, w: 300, h: 300 }, 'contain'), ['G', 'S'])
		assert.deepEqual(m.queryRect({ x: 5000, y: 5000, w: 10, h: 10 }), [])
	})

	test('topContainerAt: topmost container containing the point, excludes', () => {
		assert.equal(m.topContainerAt(150, 150), 'G')
		assert.equal(m.topContainerAt(150, 150, new Set(['G'])), 'F')
		assert.equal(m.topContainerAt(150, 150, ['G', 'F']), null)
		assert.equal(m.topContainerAt(700, 500), 'F')
		assert.equal(m.topContainerAt(2100, 2100), null, 'notes are no containers')
		assert.equal(m.topContainerAt(400, -10), null, 'title band is not inside')
	})

	test('childrenOf, descendantsOf, sortByOrder, compareOrder by layer', () => {
		assert.deepEqual(m.childrenOf('F'), ['S'])
		assert.deepEqual(m.childrenOf('T'), [])
		assert.deepEqual(m.descendantsOf('F'), ['S'])
		assert.deepEqual(m.sortByOrder(['T', 'S', 'G', 'F']), ['F', 'G', 'S', 'T'])
		const m2 = new SceneModel()
		m2.load([note('N', 0, 0, null, 'a0'), frame('Z', 0, 0, 100, 100, 'zz')])
		assert.ok(m2.compareOrder('Z', 'N') < 0, 'frames lie behind content regardless of z')
	})

	test('maxZ/minZ per layer, skipping invalid keys', () => {
		const m2 = new SceneModel()
		m2.load([
			note('A', 0, 0, null, 'a0'),
			note('B', 0, 0, null, 'i1'),
			note('C', 0, 0, null, 'zz'), // invalid ('z' head needs 19 characters)
			note('D', 0, 0, null, 'i0V'), // invalid (upper case)
			note('E', 0, 0, null, null),
			frame('F', 0, 0, 100, 100, 'j00'),
		])
		assert.equal(m2.maxZ('content'), 'i1')
		assert.equal(m2.minZ('content'), 'i1', "'a0' is invalid as well (head 'a' needs 11 integer digits)")
		assert.equal(m2.maxZ('back'), 'j00')
		const empty = new SceneModel()
		assert.equal(empty.maxZ('content'), null)
		assert.equal(empty.minZ('back'), null)
	})

	test('boundsOf / allBounds', () => {
		assert.deepEqual(m.boundsOf(['S', 'T']), { x: 50, y: 50, w: 2150, h: 2150 })
		assert.equal(m.boundsOf(['nope']), null)
		assert.equal(new SceneModel().allBounds(), null)
		assert.deepEqual(m.allBounds(), { x: 0, y: 0, w: 2200, h: 2200 })
	})

	test('index padding: note shadow, frame title band; placeholder none', () => {
		const pad = SHADOW.blur * 1.5 + Math.abs(SHADOW.y)
		assert.deepEqual(m.bboxOf('T'), { minX: 2000 - pad, minY: 2000 - pad, maxX: 2200 + pad, maxY: 2200 + pad })
		const f = m.bboxOf('F')
		assert.ok(f.minY <= -FRAME_TITLE_SIZE * 1.5)
		const m2 = new SceneModel()
		m2.load([{ id: 'P', t: 'x', x: 1, y: 2, w: 3, h: 4, r: 0, z: 'a0', parent: null }])
		assert.deepEqual(m2.bboxOf('P'), { minX: 1, minY: 2, maxX: 4, maxY: 6 })
		assert.equal(m2.bboxOf('nope'), null)
	})
})

// ---------------------------------------------------------------- M1 v2 (SPEC-M1 §6.2, round 1a)

const shape = (id, x, y, kind = 'rect', extra = {}) => ({
	id, t: 'shape', x, y, w: 200, h: 100, r: 0, z: 'a5', parent: null,
	data: { kind, text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 4 }, ...extra,
})
const text = (id, x, y, extra = {}) => ({
	id, t: 'text', x, y, w: 240, h: 30, r: 0, z: 'a6', parent: null, data: { text: 'T' }, style: { fontSize: 24 }, ...extra,
})

describe('v2: hit mode shape (SHAPES[kind].hit)', () => {
	test('ellipse: the corners of the box miss, the inside hits', () => {
		const m = new SceneModel()
		m.load([shape('E', 0, 0, 'ellipse')])
		assert.equal(m.hitTest(100, 50), 'E')
		assert.equal(m.hitTest(5, 5), null, 'corner of the box')
		assert.equal(m.hitTest(199, 50), 'E', 'right end of the ellipse')
	})

	test('triangle and diamond: polygon test, tolerance and half the stroke widen the outline', () => {
		const m = new SceneModel()
		m.load([shape('T', 0, 0, 'triangle'), shape('D', 400, 0, 'diamond')])
		assert.equal(m.hitTest(100, 80), 'T')
		assert.equal(m.hitTest(10, 10), null, 'top-left corner outside the triangle')
		assert.equal(m.hitTest(410, 10), null)
		assert.equal(m.hitTest(500, 50), 'D')
		// left slope of the triangle (100,0)–(0,100) at y = 50 is x = 50; distance = dx · sin 45°
		assert.equal(m.hitTest(48.5, 50), 'T', '1.06 outside: within half the stroke (2)')
		assert.equal(m.hitTest(46, 50), null, '2.83 outside')
		assert.equal(m.hitTest(46, 50, 4), 'T', 'tolerance')
	})

	test('the inside hits with fillOpacity 0; unknown kinds hit like rect; rotated shapes in local coordinates', () => {
		const m = new SceneModel()
		m.load([
			shape('O', 0, 0, 'ellipse', { style: { fillOpacity: 0 } }),
			shape('U', 300, 0, 'hexagon'),
			shape('R', 600, 0, 'triangle', { r: 180 }),
		])
		assert.equal(m.hitTest(100, 50), 'O')
		assert.equal(m.hitTest(305, 5), 'U')
		// rotated by 180°: the tip points down, the old top-left corner region (now bottom-right) is outside
		assert.equal(m.hitTest(700, 90), 'R')
		assert.equal(m.hitTest(795, 95), null)
		assert.equal(m.hitTest(610, 10), 'R', 'the base is at the top now')
	})
})

describe('v2: rbush padding from the registry (pad)', () => {
	test('stroke: half the stroke width; none for text; it follows a style change', () => {
		const m = new SceneModel()
		m.load([shape('S', 0, 0), text('X', 0, 300)])
		assert.deepEqual(m.bboxOf('S'), { minX: -2, minY: -2, maxX: 202, maxY: 102 })
		assert.deepEqual(m.bboxOf('X'), { minX: 0, minY: 300, maxX: 240, maxY: 330 })
		m.apply({ upserts: [shape('S', 0, 0, 'rect', { style: { strokeWidth: 20 } })] })
		assert.deepEqual(m.bboxOf('S'), { minX: -10, minY: -10, maxX: 210, maxY: 110 })
		m.apply({ upserts: [shape('S', 0, 0, 'rect', { style: { strokeWidth: 'thick' } })] })
		assert.deepEqual(m.bboxOf('S'), { minX: -1, minY: -1, maxX: 201, maxY: 101 }, 'invalid → default 2 (rule 18)')
	})

	test('connectors (1b): the rbush entry is the route box padded with cap size + strokeWidth/2, joined with the label box', () => {
		const m = new SceneModel()
		const conn = { id: 'L', t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'a9', parent: null, data: { start: { x: 10, y: 10 }, end: { x: 90, y: 90 } }, style: {} }
		m.load([conn])
		// capSize(2) = 10, + 1
		assert.deepEqual(m.bboxOf('L'), { minX: -1, minY: -1, maxX: 101, maxY: 101 })
		m.apply({ upserts: [{ ...conn, data: { ...conn.data, label: 'x'.repeat(30) } }] })
		const b = m.bboxOf('L')
		assert.ok(b.minX < -1 && b.maxX > 101, 'a wide label widens the entry')
	})
})

describe('v2: connector index (round 1b)', () => {
	const N1 = '01JA0000000000000000000001'
	const N2 = '01JA0000000000000000000002'
	const N3 = '01JA0000000000000000000003'
	const FR = '01JA0000000000000000000009'
	const C1 = '01JA00000000000000000000C1'
	const C2 = '01JA00000000000000000000C2'
	const conn = (id, start, end, extra = {}) => ({ id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + id.slice(-2), parent: null, data: { start, end, route: 'straight' }, style: { stroke: '#1a1a1a', strokeWidth: 2 }, ...extra })
	/** two notes 200 × 200 at (0, 0) and (400, 0), connector auto–auto: right side → left side */
	const board = () => [note(N1, 0, 0), note(N2, 400, 0), conn(C1, { item: N1 }, { item: N2 })]

	test('load: geometryOf = routeConnector over the absolute boxes; connectorsOf by id; abs stays the stored 0 × 0 box', () => {
		const m = new SceneModel()
		m.load(board())
		const g = m.geometryOf(C1)
		const want = routeConnector({ box: m.abs(N1), ep: { item: N1 } }, { box: m.abs(N2), ep: { item: N2 } }, 'straight')
		assert.deepEqual(g, want)
		assert.deepEqual(g.points, [200, 100, 400, 100])
		assert.deepEqual([...m.connectorsOf([N1])], [C1])
		assert.deepEqual([...m.connectorsOf([N2, N1])], [C1])
		assert.deepEqual([...m.connectorsOf([C1])], [])
		assert.deepEqual(m.abs(C1), { x: 0, y: 0, w: 0, h: 0, r: 0 })
		assert.equal(m.geometryOf(N1), null)
		assert.equal(m.routeOf(C1).label, null)
	})

	test('a moved target (apply) re-routes and reports the connector in geometry; data and style changes re-route too', () => {
		const m = new SceneModel()
		m.load(board())
		const s = m.apply({ upserts: [note(N2, 400, 300)] })
		assert.deepEqual([...s.geometry].sort(), [N2, C1].sort())
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 400], 'centres 400 apart in x, 300 in y: still right → left')
		const s2 = m.apply({ upserts: [conn(C1, { item: N1, ax: 1, ay: 0 }, { item: N2 }, { data: { start: { item: N1, ax: 1, ay: 0 }, end: { item: N2 }, route: 'elbow' } })] })
		assert.ok(s2.updated.get(C1).has('data'))
		assert.ok(s2.geometry.has(C1))
		assert.equal(m.geometryOf(C1).points[0], 200)
		assert.equal(m.geometryOf(C1).points[1], 0)
		const s3 = m.apply({ upserts: [note(N3, 900, 900)] })
		assert.deepEqual([...s3.geometry], [], 'unrelated items do not re-route')
	})

	test('re-binding an end moves the connector in the index', () => {
		const m = new SceneModel()
		m.load([...board(), note(N3, 0, 600)])
		m.apply({ upserts: [conn(C1, { item: N1 }, { item: N3 })] })
		assert.deepEqual([...m.connectorsOf([N2])], [])
		assert.deepEqual([...m.connectorsOf([N3])], [C1])
		assert.deepEqual(m.geometryOf(C1).points, [100, 200, 100, 600])
	})

	test('frame cascade: connectors of a moved frame\'s children follow; connectorsOf sees descendants', () => {
		const m = new SceneModel()
		m.load([frame(FR, 1000, 0), note(N1, 10, 10, FR), note(N2, 0, 0), conn(C1, { item: N2 }, { item: N1 })])
		assert.deepEqual([...m.connectorsOf([FR])], [C1])
		const before = m.geometryOf(C1).points
		const s = m.apply({ upserts: [frame(FR, 1100, 50)] })
		assert.ok(s.geometry.has(C1))
		assert.deepEqual(m.geometryOf(C1).points, [before[0], before[1], before[2] + 100, before[3] + 50])
	})

	test('a target that never arrived: no geometry, no entry, never dropped; it routes when the target comes', () => {
		const m = new SceneModel()
		m.load([note(N1, 0, 0), conn(C1, { item: N1 }, { item: N2 })])
		assert.equal(m.geometryOf(C1), null)
		assert.equal(m.bboxOf(C1), null)
		assert.equal(m.hitTest(300, 100, 2), null)
		assert.ok(m.has(C1))
		assert.deepEqual(m.queryRect({ x: -1000, y: -1000, w: 3000, h: 3000 }), [N1])
		const s = m.apply({ upserts: [note(N2, 400, 0)] })
		assert.ok(s.geometry.has(C1), 'appearing route reported')
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 100])
		assert.notEqual(m.bboxOf(C1), null)
	})

	test('a target that vanishes: the end stays at its last docked point until the server frees it', () => {
		const m = new SceneModel()
		m.load(board())
		const s = m.apply({ removes: [N2] })
		assert.deepEqual([...s.geometry], [], 'the route did not change')
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 100])
		assert.deepEqual([...m.connectorsOf([N2])], [C1], 'still indexed by the id it names')
		// the server's release: a free end at the docking point
		m.apply({ upserts: [conn(C1, { item: N1 }, { x: 400, y: 100 })] })
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 100])
		assert.deepEqual([...m.connectorsOf([N2])], [])
	})

	test('removing a connector cleans the index and its state; load replaces everything', () => {
		const m = new SceneModel()
		m.load(board())
		m.apply({ removes: [C1] })
		assert.equal(m.geometryOf(C1), null)
		assert.deepEqual([...m.connectorsOf([N1, N2])], [])
		m.load(board())
		assert.deepEqual([...m.connectorsOf([N1])], [C1])
	})

	test('hit mode line: within tol + strokeWidth/2 of the route, the caps, the label box; not the empty area beside it', () => {
		const m = new SceneModel()
		m.load([note(N1, 0, 0), note(N2, 400, 0), conn(C1, { item: N1 }, { item: N2 }, { style: { strokeWidth: 4, endCap: 'triangle' }, data: { start: { item: N1 }, end: { item: N2 }, label: 'ja' } })])
		assert.equal(m.hitTest(260, 102, 0), C1, 'on the line (half stroke 2)')
		assert.equal(m.hitTest(260, 105, 0), null)
		assert.equal(m.hitTest(260, 105, 4), C1, 'with tolerance')
		const l = m.routeOf(C1).label
		assert.equal(m.hitTest(l.x + 1, l.y + 1, 0), C1, 'label box')
		// capSize(4) = 16 → radius 8 around the end point (400, 100), which also lies on N2
		assert.equal(m.hitTest(395, 106, 0), C1, 'the connector lies above its target (z) and its cap hits')
		assert.equal(m.hitTest(380, 160, 0), null, 'empty canvas between the notes')
		assert.equal(m.hitTest(260, 102, 0, { accept: (id) => id !== C1 }), null, 'accept filters')
		assert.equal(m.hitTest(100, 100, 0, { accept: (id) => id !== C1 }), N1)
	})

	test('queryRect and boundsOf use the route box; tab-free connectors without a route are skipped', () => {
		const m = new SceneModel()
		m.load(board())
		assert.deepEqual(m.queryRect({ x: 190, y: 90, w: 220, h: 20 }, 'contain'), [C1])
		assert.deepEqual(m.queryRect({ x: 300, y: 99, w: 1, h: 2 }), [C1])
		assert.deepEqual(m.boundsOf([C1]), { x: 200, y: 100, w: 200, h: 0 })
		assert.deepEqual(m.allBounds(), { x: 0, y: 0, w: 600, h: 200 })
	})

	test('moveLocal re-routes attached connectors; a connector id shifts only its free ends, get() stays stored', () => {
		const m = new SceneModel()
		m.load([note(N1, 0, 0), conn(C1, { item: N1 }, { x: 500, y: 100 }), conn(C2, { x: 0, y: 500 }, { x: 100, y: 500 })])
		const g = m.moveLocal([N1], 10, 0)
		assert.deepEqual([...g].sort(), [N1, C1].sort())
		assert.deepEqual(m.geometryOf(C1).points, [210, 100, 500, 100])
		const g2 = m.moveLocal([C1, C2], 5, 7)
		assert.deepEqual([...g2].sort(), [C1, C2].sort())
		assert.deepEqual(m.geometryOf(C1).points, [210, 100, 505, 107], 'bound start stays, free end shifted')
		assert.deepEqual(m.geometryOf(C2).points, [5, 507, 105, 507])
		assert.deepEqual(m.get(C2).data.start, { x: 0, y: 500 }, 'stored data untouched ([C] reads it)')
		assert.deepEqual(m.abs(C2), { x: 0, y: 0, w: 0, h: 0, r: 0 })
		// an upsert of the connector ends the local shift
		m.apply({ upserts: [conn(C2, { x: 5, y: 507 }, { x: 105, y: 507 })] })
		assert.deepEqual(m.geometryOf(C2).points, [5, 507, 105, 507])
		// clearLocal ends the rest
		const g3 = m.clearLocal([C1])
		assert.deepEqual([...g3], [C1])
		assert.deepEqual(m.geometryOf(C1).points, [210, 100, 500, 100])
		assert.deepEqual([...m.clearLocal()], [])
	})

	test('setBoxesLocal reports the attached connectors whose route changed', () => {
		const m = new SceneModel()
		m.load(board())
		const g = m.setBoxesLocal(new Map([[N2, { x: 400, y: 0, w: 300, h: 300 }], [C1, { x: 5 }]]))
		assert.deepEqual([...g].sort(), [N2, C1].sort())
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 150])
		assert.equal(m.get(C1).x, 0, 'connectors have no box to set')
	})

	test('setEndsLocal: an end override routes instead of the stored end; null removes it; get() untouched', () => {
		const m = new SceneModel()
		m.load([...board(), note(N3, 0, 600)])
		const g = m.setEndsLocal(new Map([[C1, { end: { item: N3, ax: 0.5, ay: 0 } }]]))
		assert.deepEqual([...g], [C1])
		assert.deepEqual(m.geometryOf(C1).points, [100, 200, 100, 600])
		assert.deepEqual(m.get(C1).data.end, { item: N2 })
		m.setEndsLocal(new Map([[C1, { end: { x: 900, y: 100 } }]]))
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 900, 100])
		m.setEndsLocal(new Map([[C1, { end: null }], [N1, { end: { x: 0, y: 0 } }], ['nope', {}]]))
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 100])
	})

	test('setBoxResolver: preview boxes route the attached connectors after reroute(ids)', () => {
		const m = new SceneModel()
		m.load(board())
		let preview = null
		m.setBoxResolver((id) => (id === N2 && preview ? preview : null))
		preview = { x: 400, y: 400, w: 200, h: 200, r: 0 }
		const g = m.reroute([N2])
		assert.deepEqual([...g], [C1])
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 500], 'docked at the preview box')
		preview = null
		assert.deepEqual([...m.reroute([N2])], [C1])
		assert.deepEqual(m.geometryOf(C1).points, [200, 100, 400, 100])
		m.setBoxResolver('nope')
		assert.deepEqual([...m.reroute([N1])], [])
	})

	test('a connector with an invalid stored end has no route; type changes to and from connector keep the index right', () => {
		const m = new SceneModel()
		m.load([note(N1, 0, 0), conn(C1, { item: N1 }, { item: 'not-a-ulid' })])
		assert.equal(m.geometryOf(C1), null)
		m.apply({ upserts: [{ ...note(C1, 600, 0), t: 'sticky' }] })
		assert.equal(m.geometryOf(C1), null)
		assert.deepEqual([...m.connectorsOf([N1])], [])
		assert.ok(m.bboxOf(C1), 'now a note with a box')
	})
})

describe('v2: setBoxesLocal (transformer preview)', () => {
	test('relative boxes; descendants follow; geometry reports what moved; fontSize set and removed', () => {
		const m = new SceneModel()
		m.load([frame('F', 100, 100), note('S', 10, 20, 'F'), text('X', 0, 800, { style: {} })])
		const g = m.setBoxesLocal(new Map([['F', { x: 50, y: 60, w: 900, h: 700 }], ['X', { w: 300, fontSize: 40 }]]))
		assert.deepEqual([...g].sort(), ['F', 'S', 'X'])
		assert.deepEqual(m.abs('S'), { x: 60, y: 80, w: 200, h: 200, r: 0 })
		assert.equal(m.get('X').style.fontSize, 40)
		assert.equal(m.get('X').w, 300)
		assert.ok(indexed(m, 'X'))
		const g2 = m.setBoxesLocal(new Map([['X', { fontSize: null }], ['nope', { x: 1 }], ['S', { x: NaN, r: 15 }]]))
		assert.deepEqual([...g2].sort(), ['S', 'X'])
		assert.equal('fontSize' in m.get('X').style, false)
		assert.equal(m.get('S').x, 10, 'non-finite values are ignored')
		assert.equal(m.abs('S').r, 15)
		assert.deepEqual([...m.setBoxesLocal(new Map([['X', { fontSize: null }]]))], [], 'nothing changed')
	})
})
