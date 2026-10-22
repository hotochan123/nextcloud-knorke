/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * src/model/connectors.js (SPEC-M1 §3.10, §4.7 rule 14, §6.2):
 * - anchorPoint against tests/fixtures/connector-golden.json (owned by [B];
 *   the PHP ConnectorsTest reads the same file): exact for r = 0 (including
 *   the half boundaries and the (R7) "never -0" cases), ±0.01 for rotated
 *   boxes (sin/cos of V8 and libm may differ in the last bit, §4.7)
 * - q (geometry.js) against the half-boundary table of the PHP test (§8.2 (1), §18)
 * - endpointForm / normalizeEndpoint (mirror of Connectors::endpoint),
 *   including the ULID rule for `item` (arbiter V-SG1, golden #150, #190–#193),
 *   remapEndpoint, capSize
 * - routeConnector / elbowRoute (round 1b): M0 parity of auto ends at r = 0,
 *   anchors, free ends, the fewest-bends rule (two free ends: one L), stubs
 *   shortened between facing ends and towards a free end ahead, stubs
 *   lengthened out of the box of a rotated or interior anchor, U-turns,
 *   bezier control points and cap angles, determinism; labelBox, anchorsFor.
 *   The 16 side combinations and the G13 snapshots: tests/js/scene/labRoutes.test.mjs
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as c from '../../../src/model/connectors.js'
import { q, routeConnector as routeM0 } from '../../../src/model/geometry.js'
import { Q_TABLE } from './qTable.mjs'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/connector-golden.json', import.meta.url), 'utf8'))
const U = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'
const V = '01JF5Q4T0V9W8X7Y6Z5A4B3C2E'
// paste targets of the remapEndpoint tests (ULIDs as well: remapEndpoint uses the same item rule)
const NEW1 = '01JF5Q4T0V9W8X7Y6Z5A4B3C2F'
const NEW2 = '01JF5Q4T0V9W8X7Y6Z5A4B3C2G'
const GONE = '01JF5Q4T0V9W8X7Y6Z5A4B3C2H'

describe('q (geometry.js, §4.7 + R7)', () => {
	for (const [v, k, want] of Q_TABLE) {
		test(`q(${Object.is(v, -0) ? '-0' : v}, ${k}) = ${want}`, () => {
			const r = q(v, k)
			assert.ok(Object.is(r, want), `got ${Object.is(r, -0) ? '-0' : r}`)
		})
	}

	test('never -0, while the raw formula gives -0 (why R7 exists); JSON writes 0 either way', () => {
		const raw = (v, k) => (v < 0 ? -1 : 1) * Math.floor(Math.abs(v) * k + 0.5) / k
		assert.ok(Object.is(raw(-0.001, 100), -0))
		assert.ok(Object.is(q(-0.001, 100), 0))
		assert.equal(JSON.stringify(q(-0.001, 100)), '0')
	})

	test('q differs from Math.round-based rounding exactly where PHP round differs', () => {
		assert.equal(Math.sign(1.005) * Math.round(Math.abs(1.005) * 100) / 100, 1)
		assert.equal(q(1.005, 100), 1, 'not 1.01 like PHP round(1.005, 2)')
		assert.equal(q(51.945, 100), 51.95)
	})

	test('NaN and Infinity pass through (callers validate first; JSON has neither)', () => {
		assert.ok(Number.isNaN(q(NaN, 100)))
		assert.equal(q(Infinity, 100), Infinity)
		assert.equal(q(-Infinity, 100), -Infinity)
	})
})

describe('anchorPoint against connector-golden.json', () => {
	test('golden format: ≥ 20 cases, half boundaries only at r = 0, at least one R7 case', () => {
		assert.ok(golden.cases.length >= 20)
		for (const g of golden.cases) {
			assert.deepEqual(Object.keys(g).sort(), ['box', 'ep', 'expect', 'name', 'parent'])
			assert.deepEqual(Object.keys(g.box).sort(), ['h', 'r', 'w', 'x', 'y'])
			assert.equal(g.expect.length, 2)
		}
		assert.ok(golden.cases.some((g) => /R7/.test(g.name) && g.box.r === 0))
		for (const r of [30, 90, -45]) assert.ok(golden.cases.some((g) => g.box.r === r), `rotated ${r}°`)
		assert.ok(golden.cases.some((g) => g.parent !== null), 'parent offset')
	})

	for (const g of golden.cases) {
		test(g.name, () => {
			// The golden box is relative to `parent` (PHP anchorPoint(row, parent, ep));
			// connectors.js takes the absolute box: X = x + parent.x, Y = y + parent.y.
			const box = g.parent === null
				? { ...g.box }
				: { ...g.box, x: g.box.x + g.parent.x, y: g.box.y + g.parent.y }
			const p = c.anchorPoint(box, g.ep)
			assert.deepEqual(Object.keys(p), ['x', 'y'])
			if (g.box.r === 0) {
				assert.ok(Object.is(p.x, g.expect[0]) && Object.is(p.y, g.expect[1]),
					`exact for r = 0: got [${p.x}, ${p.y}], want [${g.expect}]`)
			} else {
				assert.ok(Math.abs(p.x - g.expect[0]) <= 0.01 && Math.abs(p.y - g.expect[1]) <= 0.01,
					`±0.01 for r ≠ 0: got [${p.x}, ${p.y}], want [${g.expect}]`)
				assert.ok(!Object.is(p.x, -0) && !Object.is(p.y, -0))
			}
			// the golden ends are stored forms
			assert.deepStrictEqual(c.normalizeEndpoint(g.ep), g.ep)
		})
	}

	test('rotated golden cases are bit-identical here as well (they lie far from the half boundary)', () => {
		const off = golden.cases.filter((g) => g.box.r !== 0).filter((g) => {
			const box = g.parent === null ? g.box : { ...g.box, x: g.box.x + g.parent.x, y: g.box.y + g.parent.y }
			const p = c.anchorPoint(box, g.ep)
			return !(Object.is(p.x, g.expect[0]) && Object.is(p.y, g.expect[1]))
		}).map((g) => g.name)
		assert.deepEqual(off, [])
	})
})

describe('anchorPoint beyond the golden', () => {
	test('auto ignores r; free end returns its own point; no box → null', () => {
		const box = { x: 100, y: 40, w: 200, h: 120, r: 45 }
		assert.deepEqual(c.anchorPoint(box, { item: U }), { x: 200, y: 100 })
		assert.deepEqual(c.anchorPoint(box, { x: 1.234567, y: -2 }), { x: 1.234567, y: -2 })
		assert.equal(c.anchorPoint(null, { item: U }), null)
		assert.equal(c.anchorPoint(undefined, { item: U, ax: 0, ay: 0 }), null)
	})

	test('a missing r counts as 0', () => {
		assert.deepEqual(c.anchorPoint({ x: 0, y: 0, w: 10, h: 10 }, { item: U, ax: 1, ay: 1 }), { x: 10, y: 10 })
	})
})

describe('endpointForm / normalizeEndpoint (= Connectors::endpoint)', () => {
	test('forms', () => {
		assert.equal(c.endpointForm({ item: U }), 'auto')
		assert.equal(c.endpointForm({ item: U, ax: 0, ay: 1 }), 'anchor')
		assert.equal(c.endpointForm({ ay: 1, item: U, ax: 0 }), 'anchor')
		assert.equal(c.endpointForm({ x: -1e7, y: 1e7 }), 'free')
		for (const v of [null, undefined, 5, U, [U], [1, 2], {}, { item: '' }, { item: 7 }, { item: U, ax: 0.5 }, { item: U, ax: 1.00004, ay: 0 },
			{ item: U, ax: -0.00001, ay: 0 }, { item: U, ax: '0.5', ay: 0.5 }, { item: U, ax: NaN, ay: 0.5 }, { x: 1 }, { x: 1, y: 2, z: 3 },
			{ x: 10000000.5, y: 0 }, { x: Infinity, y: 0 }, { x: '1', y: 2 }, { item: U, x: 1, y: 2 }, { item: U, side: 'top' }]) {
			assert.equal(c.endpointForm(v), null, JSON.stringify(v) ?? String(v))
			assert.equal(c.normalizeEndpoint(v), null)
		}
	})

	test('item is a ULID (OpValidator::ULID_RE = ids.js ULID_RE), in the auto and the anchor form', () => {
		for (const item of ['not-a-ulid', U.toLowerCase(), U.slice(0, 25), U + 'X', U + '\n', '\n' + U, ' ' + U, U.slice(0, 25) + 'U',
			U.slice(0, 25) + 'I', U.slice(0, 25) + 'L', U.slice(0, 25) + 'O', '', 26, null]) {
			assert.equal(c.endpointForm({ item }), null, JSON.stringify(item))
			assert.equal(c.endpointForm({ item, ax: 0.5, ay: 0.5 }), null, JSON.stringify(item))
			assert.equal(c.normalizeEndpoint({ item }), null)
		}
		assert.equal(c.endpointForm({ item: '00000000000000000000000000' }), 'auto')
		assert.equal(c.endpointForm({ item: '7ZZZZZZZZZZZZZZZZZZZZZZZZZ', ax: 1, ay: 0 }), 'anchor')
	})

	test('normalised: fixed key order, ax/ay on the 1e-4 grid, free ends as given, never -0', () => {
		const a = c.normalizeEndpoint({ ay: 0.654321, ax: 0.123456, item: U })
		assert.deepStrictEqual(a, { item: U, ax: 0.1235, ay: 0.6543 })
		assert.deepEqual(Object.keys(a), ['item', 'ax', 'ay'])
		const f = c.normalizeEndpoint({ y: -80, x: 1234.5678 })
		assert.deepStrictEqual(f, { x: 1234.5678, y: -80 })
		assert.deepEqual(Object.keys(f), ['x', 'y'])
		const z = c.normalizeEndpoint({ x: -0, y: -0 })
		assert.ok(Object.is(z.x, 0) && Object.is(z.y, 0))
		const za = c.normalizeEndpoint({ item: U, ax: -0, ay: 0.00004 })
		assert.ok(Object.is(za.ax, 0) && Object.is(za.ay, 0))
		const src = { item: U }
		assert.notEqual(c.normalizeEndpoint(src), src, 'a new object')
	})

	test('constants', () => {
		assert.equal(c.ANCHOR_GRID, 10000)
		assert.equal(c.POINT_GRID, 100)
		assert.equal(c.ELBOW_STUB, 20)
	})
})

describe('remapEndpoint and capSize', () => {
	const ids = new Map([[U, NEW1], [V, V]])

	test('mapped ids keep their form; mapping an id to itself keeps the binding', () => {
		assert.deepStrictEqual(c.remapEndpoint({ item: U }, ids, { x: 0, y: 0 }), { item: NEW1 })
		assert.deepStrictEqual(c.remapEndpoint({ item: U, ax: 1, ay: 0.5 }, ids, null), { item: NEW1, ax: 1, ay: 0.5 })
		assert.deepStrictEqual(c.remapEndpoint({ item: V }, ids), { item: V })
		assert.deepStrictEqual(c.remapEndpoint({ item: U }, { [U]: NEW2 }), { item: NEW2 }, 'a plain object works as map')
	})

	test('everything else becomes the free point; a function is called only when needed', () => {
		assert.deepStrictEqual(c.remapEndpoint({ item: GONE }, ids, { x: 5, y: -6 }), { x: 5, y: -6 })
		assert.deepStrictEqual(c.remapEndpoint({ x: 1, y: 2 }, ids, { x: 21, y: 22 }), { x: 21, y: 22 }, 'free end after the paste offset')
		let calls = 0
		const fp = (ep) => {
			calls++
			return { x: ep.x + 20, y: ep.y + 20 }
		}
		assert.deepStrictEqual(c.remapEndpoint({ x: 1, y: 2 }, ids, fp), { x: 21, y: 22 })
		assert.deepStrictEqual(c.remapEndpoint({ item: U }, ids, fp), { item: NEW1 })
		assert.equal(calls, 1)
		assert.deepStrictEqual(c.remapEndpoint({ x: 1, y: 2 }, ids), { x: 1, y: 2 }, 'without freePoint a free end stays')
		assert.equal(c.remapEndpoint({ item: GONE }, ids), null, 'unmapped bound end without freePoint')
		assert.equal(c.remapEndpoint({ item: GONE }, ids, { x: NaN, y: 0 }), null)
		assert.equal(c.remapEndpoint(null, ids), null)
	})

	test('an item or a mapped id that is not a ULID counts as unmapped', () => {
		const bad = new Map([[U, 'NEW1'], ['old-id', NEW1]])
		assert.deepStrictEqual(c.remapEndpoint({ item: U }, bad, { x: 3, y: 4 }), { x: 3, y: 4 }, 'mapped to a non-ULID')
		assert.deepStrictEqual(c.remapEndpoint({ item: 'old-id' }, bad, { x: 3, y: 4 }), { x: 3, y: 4 }, 'a non-ULID source item')
		assert.equal(c.remapEndpoint({ item: U, ax: 0, ay: 0 }, bad), null)
	})

	test('capSize = 3·strokeWidth + 4; invalid widths count as the default 2', () => {
		assert.equal(c.capSize(2), 10)
		assert.equal(c.capSize(1), 7)
		assert.equal(c.capSize(24), 76)
		for (const v of [undefined, null, NaN, -1, '3']) assert.equal(c.capSize(v), 10, String(v))
	})
})

describe('routeConnector', () => {
	const A = { x: 0, y: 0, w: 100, h: 100, r: 0 }
	const B = { x: 300, y: 50, w: 100, h: 100, r: 0 }
	const end = (box, ep) => ({ box, ep, point: null })
	const keys = ['kind', 'points', 'hitPts', 'bbox', 'start', 'end', 'labelAt']

	test('ConnGeom shape; auto–auto at r = 0 picks the sides like the M0 router', () => {
		for (const [b, route] of [[B, 'straight'], [B, 'elbow'], [{ x: 50, y: 400, w: 100, h: 100, r: 0 }, 'elbow'], [{ x: -300, y: -20, w: 80, h: 60, r: 0 }, 'curved']]) {
			const g = c.routeConnector(end(A, { item: U }), end(b, { item: V }), route)
			assert.deepEqual(Object.keys(g), keys)
			const m0 = routeM0(A, b, route)
			assert.equal(g.kind, m0.kind)
			assert.deepEqual(g.points, m0.points, route)
			assert.deepEqual(g.bbox, g.kind === 'bezier' ? g.bbox : m0.bbox.map((v, i) => v + (i < 2 ? 10 : -10)), 'unpadded route box')
			assert.deepEqual([g.start.x, g.start.y, g.end.x, g.end.y], [m0.points[0], m0.points[1], m0.points.at(-2), m0.points.at(-1)])
		}
	})

	test('straight: cap angles point away from the line; label in the middle', () => {
		const g = c.routeConnector(end(A, { item: U }), end(B, { item: V }), 'straight')
		assert.deepEqual(g.points, [100, 50, 300, 100])
		assert.equal(g.hitPts, g.points)
		assert.deepEqual(g.labelAt, { x: 200, y: 75 })
		assert.ok(Math.abs(g.end.angle - Math.atan2(50, 200)) < 1e-12)
		assert.ok(Math.abs(g.start.angle - Math.atan2(-50, -200)) < 1e-12)
	})

	test('anchor and free ends dock where they say; unknown route = straight', () => {
		const g = c.routeConnector(end(A, { item: U, ax: 0.5, ay: 0 }), end(null, { x: 500, y: -40 }), 'zigzag')
		assert.equal(g.kind, 'poly')
		assert.deepEqual(g.points, [50, 0, 500, -40])
	})

	test('elbow from top anchor to top anchor runs above both boxes (20 px stubs, no U-turn into a box)', () => {
		const g = c.routeConnector(end(A, { item: U, ax: 0.5, ay: 0 }), end(B, { item: V, ax: 0.5, ay: 0 }), 'elbow')
		assert.deepEqual(g.points, [50, 0, 50, -20, 350, -20, 350, 50])
		for (let i = 0; i + 3 < g.points.length; i += 2) {
			assert.ok(g.points[i] === g.points[i + 2] || g.points[i + 1] === g.points[i + 3], 'orthogonal segments')
		}
	})

	test('rotated target: auto side chosen in the box frame, normal rounded to an axis', () => {
		// B rotated by 90°: its local "left" side faces up in the world, local
		// "top" faces right; A lies to the left of B → the local side is "bottom"
		const rb = { ...B, r: 90 }
		const g = c.routeConnector(end(A, { item: U }), end(rb, { item: V }), 'elbow')
		assert.deepEqual(g.points.slice(-2), [300, 100], 'midpoint of the side that faces A (world left)')
		assert.equal(g.points.at(-3), 100, 'arrives horizontally …')
		assert.ok(g.points.at(-4) <= 280, '… from the left, after at least the 20 px stub')
		assert.deepEqual(g.points, [100, 50, 200, 50, 200, 100, 300, 100])
	})

	test('curved: bezier with control points p ± n·max(40, 0.4·d) and 17 hit points', () => {
		const g = c.routeConnector(end(A, { item: U }), end(B, { item: V }), 'curved')
		assert.equal(g.kind, 'bezier')
		assert.equal(g.points.length, 8)
		assert.equal(g.hitPts.length, 34)
		const d = Math.max(40, 0.4 * Math.hypot(200, 50))
		assert.deepEqual(g.points, [100, 50, 100 + d, 50, 300 - d, 100, 300, 100])
	})

	test('an end without box and point → null (not drawn until the target arrives)', () => {
		assert.equal(c.routeConnector(end(null, { item: U }), end(B, { item: V }), 'straight'), null)
		const g = c.routeConnector({ box: null, ep: { item: U }, point: { x: 10, y: 10 } }, end(B, { item: V }), 'straight')
		assert.deepEqual(g.points.slice(0, 2), [10, 10], 'fallback point')
	})

	test('elbowRoute: free ends have no stub; the fewest bends win (two free ends: one L, dominant axis first); collinear points are merged', () => {
		assert.deepEqual(c.elbowRoute({ x: 0, y: 0 }, { x: 100, y: 0 }), [0, 0, 100, 0])
		assert.deepEqual(c.elbowRoute({ x: 0, y: 0 }, { x: 100, y: 40 }), [0, 0, 100, 0, 100, 40])
		assert.deepEqual(c.elbowRoute({ x: 0, y: 0 }, { x: 40, y: 100 }), [0, 0, 0, 100, 40, 100])
		assert.deepEqual(c.elbowRoute({ x: 0, y: 0, nx: 1, ny: 0 }, { x: 100, y: 100, nx: 0, ny: -1 }), [0, 0, 100, 0, 100, 100])
	})
})

describe('routeConnector round 1b: elbow rules', () => {
	const A = { x: 0, y: 0, w: 200, h: 120, r: 0 }
	const end = (box, ep) => ({ box, ep, point: null })
	const anchor = (item, ax, ay) => ({ item, ax, ay })
	/** @param {number[]} p points @return {number} direction changes */
	const bends = (p) => {
		let n = 0
		for (let i = 2; i + 3 < p.length; i += 2) {
			const d0 = [Math.sign(p[i] - p[i - 2]), Math.sign(p[i + 1] - p[i - 1])]
			const d1 = [Math.sign(p[i + 2] - p[i]), Math.sign(p[i + 3] - p[i + 1])]
			if (d0[0] !== d1[0] || d0[1] !== d1[1]) n++
		}
		return n
	}

	test('U-turn: right side to the right side of a box on the left goes around both boxes', () => {
		const B = { x: -400, y: -40, w: 160, h: 100, r: 0 }
		const g = c.routeConnector(end(A, anchor(U, 1, 0.5)), end(B, anchor(V, 1, 0.5)), 'elbow')
		// up at the stub, over the top of A (B's obstacle ends at x −230), down into B's right side
		assert.deepEqual(g.points, [200, 60, 220, 60, 220, -20, -220, -20, -220, 10, -240, 10])
		assert.equal(bends(g.points), 4)
	})

	test('facing ends closer than two stubs: each stub gets half the gap (straight, or a tight Z)', () => {
		const B = { x: 230, y: 30, w: 100, h: 60, r: 0 }
		assert.deepEqual(c.routeConnector(end(A, anchor(U, 1, 0.5)), end(B, anchor(V, 0, 0.5)), 'elbow').points, [200, 60, 230, 60])
		const B2 = { x: 230, y: 50, w: 100, h: 60, r: 0 }
		assert.deepEqual(c.routeConnector(end(A, anchor(U, 1, 0.5)), end(B2, anchor(V, 0, 0.5)), 'elbow').points, [200, 60, 215, 60, 215, 80, 230, 80])
	})

	test('a free end straight ahead closer than a stub: the stub ends level with it (one bend)', () => {
		const g = c.routeConnector(end(A, anchor(U, 1, 0.5)), end(null, { x: 210, y: 200 }), 'elbow')
		assert.deepEqual(g.points, [200, 60, 210, 60, 210, 200])
	})

	test('an interior anchor leaves the box: the stub is measured from the box edge', () => {
		// (0.3, 0.6) → normal left; the box edge is 60 left of the docking point
		const g = c.routeConnector(end(A, anchor(U, 0.3, 0.6)), end(null, { x: -300, y: 72 }), 'elbow')
		assert.deepEqual(g.points.slice(0, 4), [60, 72, -300, 72])
	})

	test('a rotated box: the stub leaves its axis-aligned bounds; no segment crosses them', () => {
		const R = { ...A, r: 45 }
		const g = c.routeConnector(end(R, anchor(U, 1, 0.5)), end({ x: 400, y: 300, w: 160, h: 100, r: 0 }, { item: V }), 'elbow')
		// axis-aligned bounds of a 200 × 120 box at 45°: x from 100 − 113.14 to 100 + 113.14
		const x1 = 100 + (200 + 120) * Math.SQRT1_2 / 2
		assert.ok(g.points[2] >= x1 + 20 - 0.01, 'first stub ends 20 right of the rotated box bounds')
		assert.equal(g.points[1], g.points[3], 'leaves horizontally (normal rounded to the axis)')
		for (let i = 0; i + 3 < g.points.length; i += 2) {
			assert.ok(g.points[i] === g.points[i + 2] || g.points[i + 1] === g.points[i + 3], 'orthogonal')
		}
	})

	test('a self loop (both ends on one box) goes around its corner', () => {
		const g = c.routeConnector(end(A, anchor(U, 1, 0.5)), end(A, anchor(U, 0.5, 0)), 'elbow')
		assert.deepEqual(g.points, [200, 60, 220, 60, 220, -20, 100, -20, 100, 0])
	})

	test('deterministic: the same input gives the same output, a different stub length is honoured', () => {
		const a = end(A, { item: U })
		const b = end({ x: 400, y: 300, w: 160, h: 100, r: 30 }, anchor(V, 0, 0.5))
		for (const route of ['straight', 'elbow', 'curved']) {
			assert.deepStrictEqual(c.routeConnector(a, b, route), c.routeConnector(structuredClone(a), structuredClone(b), route))
		}
		const g = c.routeConnector(end(A, anchor(U, 0.5, 0)), end(null, { x: 500, y: 0 }), 'elbow', { stub: 50 })
		assert.deepEqual(g.points, [100, 0, 100, -50, 500, -50, 500, 0])
	})

	test('curved: control points along the rounded normals; free ends have none; cap angles = end − last control point', () => {
		const B = { x: 400, y: 300, w: 160, h: 100, r: 0 }
		const g = c.routeConnector(end(A, anchor(U, 0.5, 1)), end(B, anchor(V, 0, 0.5)), 'curved')
		const d = Math.max(40, 0.4 * Math.hypot(300, 230))
		assert.deepEqual(g.points, [100, 120, 100, 120 + d, 400 - d, 350, 400, 350])
		assert.equal(g.hitPts.length, 34)
		assert.deepEqual(g.hitPts.slice(0, 2), [100, 120])
		assert.deepEqual(g.hitPts.slice(-2), [400, 350])
		assert.ok(Math.abs(g.end.angle - 0) < 1e-12, 'end cap points right (from c2 to p1)')
		assert.ok(Math.abs(g.start.angle - (-Math.PI / 2)) < 1e-12, 'start cap points up (from c1 to p0)')
		const f = c.routeConnector(end(null, { x: 0, y: 0 }), end(null, { x: 100, y: 0 }), 'curved')
		assert.deepEqual(f.points, [0, 0, 0, 0, 100, 0, 100, 0])
		assert.ok(Math.abs(f.end.angle) < 1e-12, 'falls back to the next distinct point')
		assert.deepEqual(f.labelAt, { x: 50, y: 0 })
	})

	test('bbox is the unpadded box of hitPts; labelAt halves the arc length of the elbow', () => {
		const g = c.routeConnector(end(null, { x: 0, y: 0 }), end(null, { x: 100, y: 40 }), 'elbow')
		assert.deepEqual(g.bbox, [0, 0, 100, 40])
		assert.deepEqual(g.labelAt, { x: 70, y: 0 })
	})
})

describe('anchorsFor, anchorNormal, labelBox ([S]-internal)', () => {
	test('anchors: SHAPES[kind].anchors for shapes (unknown kind → rect), side midpoints for the other types', () => {
		assert.deepEqual(c.anchorsFor('sticky'), [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])
		assert.deepEqual(c.anchorsFor('text'), c.anchorsFor('sticky'))
		assert.deepEqual(c.anchorsFor('shape', 'triangle'), [[0.5, 0], [0.75, 0.5], [0.5, 1], [0.25, 0.5]])
		assert.deepEqual(c.anchorsFor('shape', 'star'), c.anchorsFor('shape', 'rect'))
		assert.deepEqual(c.anchorNormal(0.75, 0.5), [1, 0])
		assert.deepEqual(c.anchorNormal(0.5, 0.25), [0, -1])
		assert.deepEqual(c.anchorNormal(0.5, 0.5), [0, 0])
	})

	test('labelBox: glyph upper bounds (whole px at 16), words wrap at 240 − 2·4 like Konva, long words break, \n breaks; centred at labelAt', () => {
		assert.equal(c.labelBox('', { x: 0, y: 0 }), null)
		assert.equal(c.labelBox(null, { x: 0, y: 0 }), null)
		assert.equal(c.labelBox('ja', null), null)
		// j = ceil(455·16/2048) = 4, a = ceil(1139·16/2048) = 9
		const one = c.labelBox('ja', { x: 100, y: 50 })
		assert.deepEqual(one, { x: 100 - (13 + 8) / 2, y: 50 - (16 * 1.2 + 8) / 2, w: 13 + 8, h: 16 * 1.2 + 8, lines: 1 })
		// a = b = 9, c = 8, space = 5: 'aaaaaaaaaa bbbbbbbbbb' = 185 fits 232, the third word does not
		const wrap = c.labelBox('aaaaaaaaaa bbbbbbbbbb cccccccccc', { x: 0, y: 0 })
		assert.deepEqual([wrap.lines, wrap.w], [2, 185 + 8])
		assert.deepEqual([c.labelBox('x'.repeat(60), { x: 0, y: 0 }).lines, c.labelBox('x'.repeat(60), { x: 0, y: 0 }).w], [3, 240], 'a 480 px word breaks into 29 + 29 + 2 glyphs')
		assert.equal(c.labelBox('a\nb', { x: 0, y: 0 }).lines, 2)
		assert.ok(c.labelBox('y'.repeat(200), { x: 0, y: 0 }).w <= 240)
		assert.equal(c.labelBox('.', { x: 0, y: 0 }).w, 10 + 8, 'at least CONNECTOR_LABEL_MIN_W')
	})

	test('labelBox (finding S-1b-01): capitals, emoji and CJK get at least their Arial / Noto / CJK advance, on one line', () => {
		// real advances at 16 px: Liberation Sans (= Arial) 'OK' 23.1, 'TODO' 46.2, 'WICHTIG' 69.3;
		// Noto Color Emoji 19.9; CJK 4 × 16 = 64. The old estimate (0.6 em) gave 19.2, 38.4, 67.2, 9.6, 38.4.
		const real = { OK: 23.12, TODO: 46.2, WICHTIG: 69.3, '👍': 19.93, '会议记录': 64 }
		for (const [text, min] of Object.entries(real)) {
			const b = c.labelBox(text, { x: 0, y: 0 })
			assert.equal(b.lines, 1, text)
			assert.ok(b.w - 8 >= min, `${text}: text width ${b.w - 8} ≥ ${min}`)
			assert.ok(b.w - 8 <= min * 1.4 + 4, `${text}: not wildly over (${b.w - 8})`)
		}
		assert.deepEqual(['OK', 'TODO', 'WICHTIG', '👍', '会议记录'].map((t) => c.labelBox(t, { x: 0, y: 0 }).w - 8), [24, 48, 73, 21, 84])
	})
})
