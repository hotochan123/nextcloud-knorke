/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Job 197: elbow connectors run around the items between their ends
 * (connectors.elbowPlan, SceneModel obstacles and watch index):
 * - the pure route: around one item, around a wall, enclosed ends keep the
 *   old route, straight and curved untouched, order of the answers
 *   irrelevant, more than OBSTACLE_MAX items
 * - the model: frames, connectors, the targets and a background under both
 *   ends are no obstacles; moves, resizes, upserts, new and removed items
 *   and a frame cascade re-route live; after any sequence of changes the
 *   route equals the one of a model loaded fresh; timing of a full board
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { OBSTACLE_MAX, elbowPlan, routeConnector } from '../../../src/model/connectors.js'

const U = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'
const V = '01JF5Q4T0V9W8X7Y6Z5A4B3C2E'
const end = (box, ep) => ({ box, ep, point: null })
const A = { x: 0, y: 0, w: 200, h: 200, r: 0 }
const B = { x: 800, y: 0, w: 200, h: 200, r: 0 }

/** id n as a ULID (26 characters, Crockford digits only) */
const id = (n) => '01JA' + String(n).padStart(22, '0')
const note = (i, x, y, o = {}) => ({ id: i, t: 'sticky', x, y, w: 200, h: 200, r: 0, z: 'a' + i.slice(-4), parent: null, data: { text: '' }, style: {}, ...o })
const shape = (i, x, y, w, h, o = {}) => ({ id: i, t: 'shape', x, y, w, h, r: 0, z: 'a' + i.slice(-4), parent: null, data: { kind: 'rect', text: '' }, style: { strokeWidth: 0 }, ...o })
const frame = (i, x, y, w, h) => ({ id: i, t: 'frame', x, y, w, h, r: 0, z: 'a' + i.slice(-4), parent: null, data: { title: '' }, style: {} })
const elbow = (i, from, to, route = 'elbow') => ({
	id: i, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + i.slice(-4), parent: null,
	data: { start: { item: from }, end: { item: to }, route }, style: { strokeWidth: 2 },
})

/**
 * @param {number[]} pts flat orthogonal points
 * @param {number[]} r [x0, y0, x1, y1]
 * @return {boolean} a segment runs through the open rectangle
 */
function crossesRect(pts, r) {
	for (let i = 0; i + 3 < pts.length; i += 2) {
		const [x0, y0, x1, y1] = pts.slice(i, i + 4)
		if (y0 === y1) {
			if (y0 > r[1] && y0 < r[3] && Math.max(x0, x1) > r[0] && Math.min(x0, x1) < r[2]) return true
		} else if (x0 > r[0] && x0 < r[2] && Math.max(y0, y1) > r[1] && Math.min(y0, y1) < r[3]) return true
	}
	return false
}

/** @param {number[]} pts flat points @return {boolean} every segment axis-parallel */
const orthogonal = (pts) => pts.every((v, i) => i < 2 || i % 2 === 1 || pts[i] === pts[i - 2] || pts[i + 1] === pts[i - 1])

describe('elbowPlan (pure)', () => {
	test('AK1: around one item in the way; docking points and cap angles stay', () => {
		const plain = routeConnector(end(A, { item: U }), end(B, { item: V }), 'elbow')
		assert.deepEqual(plain.points, [200, 100, 800, 100])
		const obstacle = [400, 50, 600, 250]
		const g = routeConnector(end(A, { item: U }), end(B, { item: V }), 'elbow', { obstacles: [obstacle] })
		assert.equal(crossesRect(g.points, obstacle), false, g.points.join(','))
		assert.ok(orthogonal(g.points))
		assert.deepEqual(g.start, plain.start)
		assert.deepEqual(g.end, plain.end)
		assert.ok(Array.isArray(g.watch), 'an elbow route with obstacles carries its watch rectangle')
		assert.equal(plain.watch, undefined, 'without obstacles nothing changes, no watch either')
	})

	test('a route that crosses nothing is bit for bit the old one', () => {
		const g = routeConnector(end(A, { item: U }), end(B, { item: V }), 'elbow', { obstacles: [[400, 400, 600, 600]] })
		assert.deepEqual(g.points, [200, 100, 800, 100])
	})

	test('AK3: straight and curved ignore obstacles', () => {
		for (const route of ['straight', 'curved']) {
			const plain = routeConnector(end(A, { item: U }), end(B, { item: V }), route)
			const g = routeConnector(end(A, { item: U }), end(B, { item: V }), route, { obstacles: [[400, 50, 600, 250]] })
			assert.deepEqual(g, plain, route)
		}
	})

	test('AK4: around a wall of 5 notes; an enclosed end keeps the old route without throwing', () => {
		const wall = [0, 1, 2, 3, 4].map((i) => [400, -300 + i * 150, 600, -300 + i * 150 + 140])
		const g = routeConnector(end(A, { item: U }), end(B, { item: V }), 'elbow', { obstacles: wall })
		for (const r of wall) assert.equal(crossesRect(g.points, r), false, `${r} / ${g.points}`)
		assert.ok(orthogonal(g.points))
		const ring = [[-300, -300, 500, -100], [-300, 300, 500, 500], [-300, -300, -100, 500], [300, -300, 500, 500]]
		const e = routeConnector(end(A, { item: U }), end(B, { item: V }), 'elbow', { obstacles: ring })
		assert.deepEqual(e.points, [200, 100, 800, 100])
	})

	test('AK5: the order of the obstacles does not matter', () => {
		const rects = [[400, 50, 600, 250], [300, -200, 500, 20], [650, 150, 760, 400], [250, 260, 700, 330]]
		const a = elbowPlan({ x: 200, y: 100, nx: 1, ny: 0, box: A }, { x: 800, y: 100, nx: -1, ny: 0, box: B }, { obstacles: rects })
		const b = elbowPlan({ x: 200, y: 100, nx: 1, ny: 0, box: A }, { x: 800, y: 100, nx: -1, ny: 0, box: B }, { obstacles: rects.slice().reverse() })
		assert.deepEqual(a, b)
		for (const r of rects) assert.equal(crossesRect(a.points, r), false, `${r} / ${a.points}`)
	})

	test('AK10: a wall of more than OBSTACLE_MAX items keeps the old route; a field of 100 notes routes fast and the same twice', () => {
		const wall = []
		for (let i = 0; i < OBSTACLE_MAX + 8; i++) wall.push([400, -3000 + i * 150, 600, -3000 + i * 150 + 140])
		const g = routeConnector(end(A, { item: U }), end(B, { item: V }), 'elbow', { obstacles: wall })
		assert.deepEqual(g.points, [200, 100, 800, 100])
		const field = []
		for (let i = 0; i < 10; i++) {
			for (let j = 0; j < 10; j++) field.push([300 + i * 300, -1400 + j * 300, 500 + i * 300, -1200 + j * 300])
		}
		const far = { x: 3600, y: 0, w: 200, h: 200, r: 0 }
		const t0 = performance.now()
		const g1 = routeConnector(end(A, { item: U }), end(far, { item: V }), 'elbow', { obstacles: field })
		const ms = performance.now() - t0
		const g2 = routeConnector(end(A, { item: U }), end(far, { item: V }), 'elbow', { obstacles: field.slice().reverse() })
		assert.deepEqual(g1, g2)
		assert.ok(ms < 200, 'took ' + ms + ' ms')
	})
})

describe('SceneModel: obstacles', () => {
	const N1 = id(1)
	const N2 = id(2)
	const N3 = id(3)
	const C1 = id(901)
	const plainOf = (m) => routeConnector({ box: m.abs(N1), ep: { item: N1 } }, { box: m.abs(N2), ep: { item: N2 } }, 'elbow').points

	test('AK1 in the model: a note between two connected notes is avoided', () => {
		const m = new SceneModel()
		m.load([note(N1, 0, 0), note(N2, 800, 0), note(N3, 400, 0), elbow(C1, N1, N2)])
		const pts = m.geometryOf(C1).points
		assert.notDeepEqual(pts, plainOf(m))
		assert.equal(crossesRect(pts, [400, 0, 600, 200]), false, pts.join(','))
	})

	test('AK5 in the model: the same items loaded in reverse order give bit for bit the same routes', () => {
		let seed = 5
		const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
		const items = []
		for (let i = 0; i < 120; i++) items.push(note(id(300 + i), Math.round(rnd() * 3000), Math.round(rnd() * 3000)))
		const lines = []
		for (let i = 0; i < 40; i++) {
			lines.push(id(700 + i))
			items.push(elbow(id(700 + i), id(300 + i), id(419 - i)))
		}
		const a = new SceneModel()
		a.load(items)
		const b = new SceneModel()
		b.load(items.slice().reverse())
		let detours = 0
		for (const c of lines) {
			assert.deepEqual(b.geometryOf(c).points, a.geometryOf(c).points, c)
			const it = a.get(c)
			const plain = routeConnector({ box: a.abs(it.data.start.item), ep: it.data.start }, { box: a.abs(it.data.end.item), ep: it.data.end }, 'elbow').points
			if (JSON.stringify(plain) !== JSON.stringify(a.geometryOf(c).points)) detours++
		}
		assert.ok(detours >= 5, 'connectors with a detour: ' + detours)
	})

	test('AK6: frames, other connectors, a background under both ends and the targets are no obstacles', () => {
		const F = id(10)
		const BG = id(11)
		const C2 = id(902)
		const m = new SceneModel()
		m.load([
			frame(F, 300, -100, 400, 400), shape(BG, -100, -100, 1200, 400), note(N1, 0, 0), note(N2, 800, 0),
			note(id(4), 400, -600), note(id(5), 400, 600), elbow(C2, id(4), id(5), 'straight'), elbow(C1, N1, N2),
		])
		assert.deepEqual(m.geometryOf(C1).points, plainOf(m))
	})

	test('AK7: moveLocal into the line re-routes live, back out it is the old route again', () => {
		const m = new SceneModel()
		m.load([note(N1, 0, 0), note(N2, 800, 0), note(N3, 400, 600), elbow(C1, N1, N2)])
		const before = m.geometryOf(C1).points
		const moved = m.moveLocal([N3], 0, -600)
		assert.ok(moved.has(C1), 'the connector is reported')
		assert.equal(crossesRect(m.geometryOf(C1).points, [400, 0, 600, 200]), false)
		const back = m.moveLocal([N3], 0, 600)
		assert.ok(back.has(C1))
		assert.deepEqual(m.geometryOf(C1).points, before)
	})

	test('AK7: setBoxesLocal (growing into the line), apply move, a new note, a removal and a frame cascade', () => {
		const F = id(20)
		const N4 = id(4)
		const m = new SceneModel()
		m.load([note(N1, 0, 0), note(N2, 800, 0), note(N3, 400, 300), frame(F, 300, 600, 400, 400), note(N4, 50, 100, { parent: F }), elbow(C1, N1, N2)])
		const before = m.geometryOf(C1).points
		// resize: N3 grows up into the line
		assert.ok(m.setBoxesLocal(new Map([[N3, { y: 50, h: 450 }]])).has(C1))
		assert.equal(crossesRect(m.geometryOf(C1).points, [400, 50, 600, 500]), false)
		assert.ok(m.setBoxesLocal(new Map([[N3, { y: 300, h: 200 }]])).has(C1))
		assert.deepEqual(m.geometryOf(C1).points, before)
		// a remote move
		let s = m.apply({ upserts: [note(N3, 400, 0)] })
		assert.ok(s.geometry.has(C1))
		assert.equal(crossesRect(m.geometryOf(C1).points, [400, 0, 600, 200]), false)
		// removed again
		s = m.apply({ removes: [N3] })
		assert.ok(s.geometry.has(C1))
		assert.deepEqual(m.geometryOf(C1).points, before)
		// a new note put on the line
		const N5 = id(5)
		s = m.apply({ upserts: [note(N5, 450, 20)] })
		assert.ok(s.geometry.has(C1))
		assert.equal(crossesRect(m.geometryOf(C1).points, [450, 20, 650, 220]), false)
		m.apply({ removes: [N5] })
		assert.deepEqual(m.geometryOf(C1).points, before)
		// the frame moves its child N4 (at 350, 700) into the line
		const g = m.moveLocal([F], 0, -650)
		assert.ok(g.has(C1))
		const a4 = m.abs(N4)
		assert.equal(crossesRect(m.geometryOf(C1).points, [a4.x, a4.y, a4.x + 200, a4.y + 200]), false)
	})

	test('AK8: after 200 random changes every route equals the one of a fresh model', () => {
		let seed = 197
		const rnd = () => {
			seed = (seed + 0x6D2B79F5) | 0
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
		const at = () => Math.round(rnd() * 3000)
		const items = []
		const notes = []
		for (let i = 0; i < 30; i++) {
			notes.push(id(100 + i))
			items.push(note(id(100 + i), at(), at()))
		}
		const lines = []
		for (let i = 0; i < 10; i++) {
			lines.push(id(500 + i))
			items.push(elbow(id(500 + i), notes[i], notes[29 - i]))
		}
		const targets = new Set(notes.slice(0, 10).concat(notes.slice(20)))
		const m = new SceneModel()
		m.load(items)
		let extra = 0
		const loose = notes.filter((n) => !targets.has(n))
		for (let step = 0; step < 200; step++) {
			const k = Math.floor(rnd() * 5)
			const n = notes[Math.floor(rnd() * notes.length)]
			if (k === 0) m.moveLocal([n], at() - 1500, at() - 1500)
			else if (k === 1) m.setBoxesLocal(new Map([[n, { w: 50 + Math.round(rnd() * 400), h: 50 + Math.round(rnd() * 400) }]]))
			else if (k === 2) m.apply({ upserts: [{ ...m.get(n), x: at(), y: at() }] })
			else if (k === 3) {
				const nid = id(800 + extra++)
				loose.push(nid)
				m.apply({ upserts: [note(nid, at(), at())] })
			} else if (loose.length > 0) {
				const gone = loose.splice(Math.floor(rnd() * loose.length), 1)[0]
				m.apply({ removes: [gone] })
				const at2 = notes.indexOf(gone)
				if (at2 >= 0) notes.splice(at2, 1)
			}
			const fresh = new SceneModel()
			fresh.load(m.ids().map((i) => m.get(i)))
			for (const c of lines) {
				assert.deepEqual(m.geometryOf(c)?.points, fresh.geometryOf(c)?.points, `step ${step}, connector ${c}`)
			}
		}
	})

	test('AK11: 400 notes and 100 elbow connectors load in under 1000 ms; a note dragged across them takes under 16 ms per step', () => {
		const items = []
		const grid = (r, c) => id(1000 + r * 20 + c)
		for (let r = 0; r < 20; r++) {
			for (let c = 0; c < 20; c++) items.push(note(grid(r, c), c * 300, r * 300))
		}
		let n = 0
		for (let r = 0; r < 20; r++) {
			for (const c of [0, 4, 8, 12, 16]) items.push(elbow(id(5000 + n++), grid(r, c), grid(r, c + 3)))
		}
		const m = new SceneModel()
		let t0 = performance.now()
		m.load(items)
		const loadMs = performance.now() - t0
		for (let i = 0; i < 100; i++) {
			const pts = m.geometryOf(id(5000 + i)).points
			const r = Math.floor(i / 5)
			const c = [0, 4, 8, 12, 16][i % 5]
			for (const k of [c + 1, c + 2]) assert.equal(crossesRect(pts, [k * 300, r * 300, k * 300 + 200, r * 300 + 200]), false, `connector ${i}`)
		}
		const dragged = grid(0, 2)
		t0 = performance.now()
		for (let s = 0; s < 50; s++) m.moveLocal([dragged], 0, 110)
		const stepMs = (performance.now() - t0) / 50
		console.log(`job 197 timing: load ${loadMs.toFixed(1)} ms, drag step ${stepMs.toFixed(2)} ms`)
		assert.ok(loadMs < 1000, 'load took ' + loadMs + ' ms')
		assert.ok(stepMs < 16, 'a drag step took ' + stepMs + ' ms')
	})
})
