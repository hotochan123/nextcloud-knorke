/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Gate G13 in Node (SPEC-M1 §8.5): the route cases of dev/scene-lab/routes.js
 * (straight, elbow with all 16 side combinations in four layouts, free,
 * rotated and interior ends, a self loop, curved) routed by
 * src/model/connectors.js equal the snapshots in routes-expected.json, and
 * every snapshot has the properties the snapshot alone cannot prove:
 * - elbow: orthogonal, leaves along the start normal and arrives against the
 *   end normal (anchored sides), stubs ≥ 20 except where the gap forces them
 *   shorter (close layout), no segment through the open box of either end
 *   (its own box only for the stub segment), at most 4 bends
 * - straight: one segment between the docking points
 * - curved: bezier with 17 hit points that start and end at the docking points
 * The lab runs the same snapshots in Chromium (run.mjs G13), plus the model
 * check below (SceneModel routes like the pure function).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { anchorPoint, routeConnector } from '../../../src/model/connectors.js'
import { rotatedBBox } from '../../../src/model/geometry.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { ROUTE_CASES, SIDES, routeAll, routeItems } from '../../../dev/scene-lab/routes.js'

const expected = JSON.parse(readFileSync(new URL('../../../dev/scene-lab/routes-expected.json', import.meta.url), 'utf8'))

/**
 * @param {object} end RouteEnd
 * @return {{x:number, y:number}} its docking point for an anchored or free end
 */
const dock = (end) => anchorPoint(end.box, end.ep)

/**
 * @param {number[]} p flat points
 * @return {number} direction changes
 */
function bends(p) {
	let n = 0
	for (let i = 2; i + 3 < p.length; i += 2) {
		const d0 = [Math.sign(p[i] - p[i - 2]), Math.sign(p[i + 1] - p[i - 1])]
		const d1 = [Math.sign(p[i + 2] - p[i]), Math.sign(p[i + 3] - p[i + 1])]
		if (d0[0] !== d1[0] || d0[1] !== d1[1]) n++
	}
	return n
}

/**
 * @param {number[]} seg [x0, y0, x1, y1] axis-parallel
 * @param {number[]} r [minX, minY, maxX, maxY]
 * @return {boolean} the segment runs through the open rectangle
 */
function crosses([x0, y0, x1, y1], r) {
	if (y0 === y1) return y0 > r[1] && y0 < r[3] && Math.max(x0, x1) > r[0] && Math.min(x0, x1) < r[2]
	return x0 > r[0] && x0 < r[2] && Math.max(y0, y1) > r[1] && Math.min(y0, y1) < r[3]
}

describe('G13 route snapshots (Node)', () => {
	test('the case table: 86 cases, all 16 side combinations in every layout, unique names', () => {
		assert.equal(ROUTE_CASES.length, 86)
		assert.equal(new Set(ROUTE_CASES.map((c) => c.name)).size, ROUTE_CASES.length)
		for (const layout of ['rightBelow', 'leftOverlap', 'below', 'close']) {
			const combos = ROUTE_CASES.filter((c) => c.name.startsWith(`elbow ${layout} `)).map((c) => c.sides.join('-'))
			assert.equal(new Set(combos).size, 16, layout)
		}
		assert.deepEqual(Object.keys(expected), ROUTE_CASES.map((c) => c.name))
	})

	test('routeConnector gives exactly the snapshot of every case (bit for bit)', () => {
		const got = routeAll(routeConnector)
		const off = Object.keys(expected).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(expected[k]))
		assert.deepEqual(off, [])
	})

	for (const c of ROUTE_CASES) {
		test(`properties: ${c.name}`, () => {
			const { kind, points: p } = expected[c.name]
			const pa = dock(c.a.box && 'item' in c.a.ep ? c.a : { box: null, ep: c.a.ep })
			const pb = dock(c.b.box && 'item' in c.b.ep ? c.b : { box: null, ep: c.b.ep })
			if (c.route === 'curved') {
				assert.equal(kind, 'bezier')
				assert.equal(p.length, 8)
				const g = routeConnector(c.a, c.b, c.route)
				assert.equal(g.hitPts.length, 34)
				assert.deepEqual([g.hitPts[0], g.hitPts[1], g.hitPts.at(-2), g.hitPts.at(-1)], [p[0], p[1], p[6], p[7]])
				return
			}
			assert.equal(kind, 'poly')
			if (c.route === 'straight') {
				assert.equal(p.length, 4)
				if (!('item' in c.a.ep) || 'ax' in c.a.ep) assert.deepEqual([p[0], p[1]], [pa.x, pa.y])
				return
			}
			// elbow
			for (let i = 0; i + 3 < p.length; i += 2) {
				assert.ok(p[i] === p[i + 2] || p[i + 1] === p[i + 3], `orthogonal at ${i}`)
				assert.ok(p[i] !== p[i + 2] || p[i + 1] !== p[i + 3], `no zero-length segment at ${i}`)
			}
			assert.ok(bends(p) <= 4, `${bends(p)} bends`)
			if ('ax' in c.a.ep) assert.deepEqual([p[0], p[1]], [pa.x, pa.y], 'starts at the start anchor')
			if ('ax' in c.b.ep) assert.deepEqual([p.at(-2), p.at(-1)], [pb.x, pb.y], 'ends at the end anchor')
			const n = p.length
			if (c.sides) {
				const [sa, sb] = c.sides
				const na = SIDES[sa].n
				const nb = SIDES[sb].n
				assert.deepEqual([Math.sign(p[2] - p[0]), Math.sign(p[3] - p[1])], na, 'leaves along the start normal')
				assert.deepEqual([Math.sign(p[n - 2] - p[n - 4]), Math.sign(p[n - 1] - p[n - 3])], [-nb[0] || 0, -nb[1] || 0], 'arrives against the end normal')
				if (!c.name.startsWith('elbow close ')) {
					assert.ok(Math.hypot(p[2] - p[0], p[3] - p[1]) >= 20 - 1e-9, 'start stub ≥ 20')
					assert.ok(Math.hypot(p[n - 2] - p[n - 4], p[n - 1] - p[n - 3]) >= 20 - 1e-9, 'end stub ≥ 20')
				}
			}
			const boxes = [c.a.box, c.b.box].map((b) => (b ? rotatedBBox(b.x, b.y, b.w, b.h, b.r || 0) : null))
			const self = c.a.box && c.b.box && c.a.box === c.b.box
			for (let i = 0; i + 3 < n; i += 2) {
				const seg = [p[i], p[i + 1], p[i + 2], p[i + 3]]
				boxes.forEach((r, k) => {
					if (!r) return
					// the stub segment touches its own box; a self loop's two stubs touch the one box
					if ((k === 0 && i === 0) || (k === 1 && i === n - 4) || (self && (i === 0 || i === n - 4))) return
					if (c.name === 'elbow interior anchor' && k === 0 && i === 0) return
					assert.ok(!crosses(seg, r), `segment ${i} crosses box ${k}`)
				})
			}
		})
	}

	test('the SceneModel routes the cases exactly like routeConnector (lab model check)', () => {
		let n = 0
		const ulid = () => '01JF5Q4T0V9W8X7Y6Z5A' + String(n++).padStart(6, '0')
		const { items, checks } = routeItems(ulid)
		const m = new SceneModel()
		m.load(items)
		const off = []
		for (const k of checks) {
			const want = routeConnector(k.a, k.b, k.route)
			const got = m.geometryOf(k.id)
			if (JSON.stringify(got?.points) !== JSON.stringify(want.points) || got?.kind !== want.kind) off.push(k.name)
		}
		assert.deepEqual(off, [])
		assert.equal(checks.length, ROUTE_CASES.length)
	})
})
