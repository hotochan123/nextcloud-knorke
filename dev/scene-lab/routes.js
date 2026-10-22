/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Route cases of gate G13 (SPEC-M1 §8.5): deterministic route snapshots of
 * src/model/connectors.js routeConnector for straight, elbow (all 16 side
 * combinations in three layouts, plus close, free, rotated and interior
 * ends and a self loop) and curved routes. The expected point lists live in
 * routes-expected.json; tests/js/scene/labRoutes.test.mjs checks them in
 * Node together with the route properties (orthogonal, stubs along the
 * normals, no segment through an end box, at most 4 bends), the lab (run.mjs
 * G13) checks the same snapshots in Chromium, through the pure function and
 * through a SceneModel loaded with the cases.
 *
 * Pure data and one helper, no DOM: imported by lab.js (Vite) and by the
 * Node test.
 */

export const ROUTE_A = '01JF5Q4T0V9W8X7Y6Z5A4B3C2D'
export const ROUTE_B = '01JF5Q4T0V9W8X7Y6Z5A4B3C2E'

/** Box of the start target in every case (absolute, unrotated unless the case says so). */
export const BOX_A = Object.freeze({ x: 0, y: 0, w: 200, h: 120, r: 0 })
/** Positions of the end target: right-below, left with vertical overlap, below with horizontal overlap, close right. */
export const LAYOUTS = Object.freeze({
	rightBelow: Object.freeze({ x: 400, y: 300, w: 160, h: 100, r: 0 }),
	leftOverlap: Object.freeze({ x: -500, y: -40, w: 160, h: 100, r: 0 }),
	below: Object.freeze({ x: 50, y: 300, w: 160, h: 100, r: 0 }),
	close: Object.freeze({ x: 230, y: 30, w: 100, h: 60, r: 0 }),
})
/** Side anchors and their outward normals (unrotated). */
export const SIDES = Object.freeze({
	top: Object.freeze({ a: [0.5, 0], n: [0, -1] }),
	right: Object.freeze({ a: [1, 0.5], n: [1, 0] }),
	bottom: Object.freeze({ a: [0.5, 1], n: [0, 1] }),
	left: Object.freeze({ a: [0, 0.5], n: [-1, 0] }),
})

const anchor = (item, side) => ({ item, ax: SIDES[side].a[0], ay: SIDES[side].a[1] })

/**
 * @return {Array<{name:string, route:string, a:object, b:object, sides?:[string, string]}>}
 *   a/b = RouteEnd {box, ep, point}; sides = the two anchored sides of the 16-combination cases
 */
function buildCases() {
	const out = []
	const B = LAYOUTS.rightBelow
	// straight
	out.push({ name: 'straight auto-auto', route: 'straight', a: { box: BOX_A, ep: { item: ROUTE_A } }, b: { box: B, ep: { item: ROUTE_B } } })
	out.push({ name: 'straight anchor-free', route: 'straight', a: { box: BOX_A, ep: anchor(ROUTE_A, 'top') }, b: { box: null, ep: { x: 700.5, y: -80.25 } } })
	out.push({ name: 'straight free-free', route: 'straight', a: { box: null, ep: { x: -10, y: 20 } }, b: { box: null, ep: { x: 300, y: 260 } } })
	out.push({ name: 'straight auto to rotated 30', route: 'straight', a: { box: BOX_A, ep: { item: ROUTE_A } }, b: { box: { ...B, r: 30 }, ep: { item: ROUTE_B } } })
	// elbow: all 16 side combinations in three layouts (+ the close one)
	for (const layout of ['rightBelow', 'leftOverlap', 'below', 'close']) {
		for (const sa of Object.keys(SIDES)) {
			for (const sb of Object.keys(SIDES)) {
				out.push({
					name: `elbow ${layout} ${sa}-${sb}`,
					route: 'elbow',
					sides: [sa, sb],
					a: { box: BOX_A, ep: anchor(ROUTE_A, sa) },
					b: { box: LAYOUTS[layout], ep: anchor(ROUTE_B, sb) },
				})
			}
		}
	}
	// elbow: auto ends, free ends, rotated targets, an interior anchor, a self loop
	out.push({ name: 'elbow auto-auto', route: 'elbow', a: { box: BOX_A, ep: { item: ROUTE_A } }, b: { box: B, ep: { item: ROUTE_B } } })
	out.push({ name: 'elbow auto-auto below', route: 'elbow', a: { box: BOX_A, ep: { item: ROUTE_A } }, b: { box: LAYOUTS.below, ep: { item: ROUTE_B } } })
	out.push({ name: 'elbow free-free', route: 'elbow', a: { box: null, ep: { x: -10, y: 20 } }, b: { box: null, ep: { x: 300, y: 260 } } })
	out.push({ name: 'elbow free-box', route: 'elbow', a: { box: null, ep: { x: -300, y: -200 } }, b: { box: B, ep: anchor(ROUTE_B, 'left') } })
	out.push({ name: 'elbow box-free ahead', route: 'elbow', a: { box: BOX_A, ep: anchor(ROUTE_A, 'right') }, b: { box: null, ep: { x: 210, y: 200 } } })
	for (const r of [30, 90, -45]) {
		out.push({ name: `elbow rotated ${r} auto`, route: 'elbow', a: { box: { ...BOX_A, r }, ep: { item: ROUTE_A } }, b: { box: B, ep: { item: ROUTE_B } } })
		out.push({ name: `elbow rotated ${r} anchor`, route: 'elbow', a: { box: { ...BOX_A, r }, ep: anchor(ROUTE_A, 'right') }, b: { box: { ...LAYOUTS.leftOverlap, r: -r }, ep: anchor(ROUTE_B, 'bottom') } })
	}
	out.push({ name: 'elbow interior anchor', route: 'elbow', a: { box: BOX_A, ep: { item: ROUTE_A, ax: 0.3, ay: 0.6 } }, b: { box: B, ep: { item: ROUTE_B } } })
	out.push({ name: 'elbow self loop right-top', route: 'elbow', a: { box: BOX_A, ep: anchor(ROUTE_A, 'right') }, b: { box: BOX_A, ep: anchor(ROUTE_A, 'top') } })
	// curved
	out.push({ name: 'curved auto-auto', route: 'curved', a: { box: BOX_A, ep: { item: ROUTE_A } }, b: { box: B, ep: { item: ROUTE_B } } })
	out.push({ name: 'curved top-left', route: 'curved', a: { box: BOX_A, ep: anchor(ROUTE_A, 'top') }, b: { box: LAYOUTS.leftOverlap, ep: anchor(ROUTE_B, 'left') } })
	out.push({ name: 'curved anchor-free', route: 'curved', a: { box: BOX_A, ep: anchor(ROUTE_A, 'bottom') }, b: { box: null, ep: { x: 500, y: 40 } } })
	out.push({ name: 'curved short (40 minimum)', route: 'curved', a: { box: BOX_A, ep: anchor(ROUTE_A, 'right') }, b: { box: LAYOUTS.close, ep: anchor(ROUTE_B, 'left') } })
	out.push({ name: 'curved rotated -45', route: 'curved', a: { box: { ...BOX_A, r: -45 }, ep: { item: ROUTE_A } }, b: { box: B, ep: anchor(ROUTE_B, 'top') } })
	return out
}

export const ROUTE_CASES = Object.freeze(buildCases())

/**
 * Routes every case with the given router (connectors.routeConnector).
 *
 * @param {Function} routeConnector router
 * @return {Record<string, {kind:string, points:number[]}>} name → kind and points
 */
export function routeAll(routeConnector) {
	const out = {}
	for (const c of ROUTE_CASES) {
		const g = routeConnector(c.a, c.b, c.route)
		out[c.name] = g ? { kind: g.kind, points: g.points } : null
	}
	return out
}

/**
 * The cases as wire items of one board, for the model check of G13: the
 * SceneModel must route exactly like the pure function. Every case gets its
 * own targets (shapes) at its own offset; checks carry the shifted route
 * ends, so the lab compares geometryOf(id) with routeConnector(a, b, route)
 * of the same shifted input.
 *
 * @param {(n:number) => string} ulidOf a ULID for the n-th item
 * @return {{items:object[], checks:Array<{name:string, id:string, route:string, a:object, b:object}>}}
 */
export function routeItems(ulidOf) {
	const items = []
	const checks = []
	let n = 0
	ROUTE_CASES.forEach((c, i) => {
		const dx = (i % 10) * 4000
		const dy = Math.floor(i / 10) * 4000
		const ids = new Map()
		const shifted = (e) => {
			if (e.box === null) return { box: null, ep: { x: e.ep.x + dx, y: e.ep.y + dy } }
			if (!ids.has(e.ep.item)) {
				const id = ulidOf(n++)
				ids.set(e.ep.item, id)
				items.push({
					id, t: 'shape', x: e.box.x + dx, y: e.box.y + dy, w: e.box.w, h: e.box.h, r: e.box.r,
					z: 'a' + String(n).padStart(4, '0'), parent: null, data: { kind: 'rect', text: '' }, style: {},
				})
			}
			const id = ids.get(e.ep.item)
			const box = { x: e.box.x + dx, y: e.box.y + dy, w: e.box.w, h: e.box.h, r: e.box.r }
			return { box, ep: 'ax' in e.ep ? { item: id, ax: e.ep.ax, ay: e.ep.ay } : { item: id } }
		}
		const a = shifted(c.a)
		const b = shifted(c.b)
		const id = ulidOf(n++)
		items.push({
			id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: 'b' + String(n).padStart(4, '0'), parent: null,
			data: { start: a.ep, end: b.ep, route: c.route }, style: {},
		})
		checks.push({ name: c.name, id, route: c.route, a, b })
	})
	return { items, checks }
}
