/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * A flowchart from a prompt (factory job 269), pure: the AI gives only steps
 * and arrows (route 59 flow {nodes: [{type, text}], edges: [{from, to,
 * label}]}, ends as indexes, AiLayout::flow); Knorke lays them out from top
 * to bottom and builds the payload "Insert" pastes. Part of the lazy part
 * ai (util/parts.js aiFlow; the preview, components/aiPreview.js, uses
 * flowLayout too).
 *
 * flowLayout:
 * - a type is a flowchart shape of FLOW_SHAPES with its size;
 * - back arrows: a depth-first search from the nodes without an incoming
 *   arrow (in answer order), then from every node not reached yet; an arrow
 *   to a node on the current path is a back arrow (so every cycle has one);
 * - the layer of a node is the longest path over the forward arrows from a
 *   node of layer 0; the rows run top to bottom, GAP_Y apart, the nodes of a
 *   row top-aligned, GAP_X apart, the row centred on x = 0;
 * - within a row: layer 0 in answer order, every other row by the mean of
 *   the centres of its forward predecessors (each such node has one), ties
 *   in answer order. Deterministic: the same flow, the same boxes.
 *
 * flowPayload: one shape per node (registry defaults, the text as data.text)
 * and one elbow connector per arrow (registry defaults, the label as
 * data.label when not empty), both ends bound to the anchor of the shape
 * nearest to the bottom middle (start) and the top middle (end); a back
 * arrow from the right to the right. The payload goes through
 * validatePayload, as every pasted one does.
 */
import { anchorsFor } from '../model/connectors.js'
import { ulid } from '../model/ids.js'
import { TYPES } from '../model/registry.js'
import { validatePayload } from './clipboard.js'

// (job 276) the workshop from a prompt comes in the same part
export { workshopPayload } from './aiWorkshop.js'

/** The shape kind and size of each step type (AiLayout::FLOW_TYPES). */
export const FLOW_SHAPES = Object.freeze({
	start: Object.freeze({ kind: 'terminal', w: 160, h: 60 }),
	end: Object.freeze({ kind: 'terminal', w: 160, h: 60 }),
	step: Object.freeze({ kind: 'rect', w: 180, h: 80 }),
	decision: Object.freeze({ kind: 'diamond', w: 180, h: 110 }),
	document: Object.freeze({ kind: 'document', w: 180, h: 90 }),
	data: Object.freeze({ kind: 'parallelogram', w: 180, h: 80 }),
})
/** Gap between the boxes of a row, and between two rows (room for labels). */
export const GAP_X = 60
export const GAP_Y = 80
/** Most nodes and arrows (AiLayout::DIAGRAM_NODES, FLOW_EDGES). */
const NODES_MAX = 50
const EDGES_MAX = 100

/**
 * @param {unknown} flow {nodes, edges} of route 59
 * @return {{nodes: object[], edges: object[], x: number, y: number, w: number, h: number}|null} boxes
 *   {type, kind, text, x, y, w, h, layer} and arrows {from, to, label, back}; x/y/w/h the hull; null: not a flow
 *   of at least two nodes and one arrow
 */
export function flowLayout(flow) {
	if (!flow || typeof flow !== 'object' || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) return null
	const nodes = flow.nodes.slice(0, NODES_MAX).map((nd) => {
		const s = FLOW_SHAPES[nd?.type] ?? FLOW_SHAPES.step
		return { type: Object.hasOwn(FLOW_SHAPES, nd?.type) ? nd.type : 'step', kind: s.kind, text: typeof nd?.text === 'string' ? nd.text : '', x: 0, y: 0, w: s.w, h: s.h, layer: 0 }
	})
	const n = nodes.length
	const seen = new Set()
	const edges = []
	for (const e of flow.edges) {
		if (edges.length >= EDGES_MAX) break
		const from = e?.from
		const to = e?.to
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || from === to || seen.has(from + '>' + to)) continue
		seen.add(from + '>' + to)
		edges.push({ from, to, label: typeof e.label === 'string' ? e.label : '', back: false })
	}
	if (n < 2 || edges.length === 0) return null

	// back arrows: iterative depth-first search, roots first
	const out = nodes.map(() => [])
	const indeg = new Array(n).fill(0)
	edges.forEach((e, i) => {
		out[e.from].push(i)
		indeg[e.to]++
	})
	const state = new Array(n).fill(0) // 0 new, 1 on the path, 2 done
	const roots = [...nodes.keys()].filter((i) => indeg[i] === 0).concat([...nodes.keys()])
	for (const r of roots) {
		if (state[r] !== 0) continue
		state[r] = 1
		const stack = [[r, 0]]
		while (stack.length > 0) {
			const top = stack[stack.length - 1]
			const [u, k] = top
			if (k >= out[u].length) {
				state[u] = 2
				stack.pop()
				continue
			}
			top[1]++
			const e = edges[out[u][k]]
			if (state[e.to] === 1) {
				e.back = true
			} else if (state[e.to] === 0) {
				state[e.to] = 1
				stack.push([e.to, 0])
			}
		}
	}

	// layers: longest path over the forward arrows (Kahn, answer order)
	const fin = new Array(n).fill(0)
	const preds = nodes.map(() => [])
	for (const e of edges) {
		if (e.back) continue
		fin[e.to]++
		preds[e.to].push(e.from)
	}
	const queue = [...nodes.keys()].filter((i) => fin[i] === 0)
	for (let qi = 0; qi < queue.length; qi++) {
		const u = queue[qi]
		for (const ei of out[u]) {
			const e = edges[ei]
			if (e.back) continue
			nodes[e.to].layer = Math.max(nodes[e.to].layer, nodes[u].layer + 1)
			if (--fin[e.to] === 0) queue.push(e.to)
		}
	}

	// rows top to bottom, each centred on x = 0
	const rows = []
	nodes.forEach((nd, i) => (rows[nd.layer] ??= []).push(i))
	let y = 0
	for (const row of rows) {
		if (!row) continue
		const key = new Map(row.map((i) => [i, preds[i].length === 0 ? null : preds[i].reduce((s, p) => s + nodes[p].x + nodes[p].w / 2, 0) / preds[i].length]))
		row.sort((a, b) => (key.get(a) === null || key.get(b) === null ? 0 : key.get(a) - key.get(b)) || a - b)
		let x = -(row.reduce((s, i) => s + nodes[i].w, 0) + GAP_X * (row.length - 1)) / 2
		for (const i of row) {
			nodes[i].x = x
			nodes[i].y = y
			x += nodes[i].w + GAP_X
		}
		y += Math.max(...row.map((i) => nodes[i].h)) + GAP_Y
	}
	const x0 = Math.min(...nodes.map((nd) => nd.x))
	const x1 = Math.max(...nodes.map((nd) => nd.x + nd.w))
	const y1 = Math.max(...nodes.map((nd) => nd.y + nd.h))
	return { nodes, edges, x: x0, y: 0, w: x1 - x0, h: y1 }
}

/**
 * @param {string} kind shape kind
 * @param {number} px wanted anchor x (0..1)
 * @param {number} py wanted anchor y (0..1)
 * @return {[number, number]} the anchor of the kind nearest to it
 */
function nearestAnchor(kind, px, py) {
	let best = null
	for (const [ax, ay] of anchorsFor('shape', kind)) {
		const d = Math.hypot(ax - px, ay - py)
		if (best === null || d < best.d) best = { d, ax, ay }
	}
	return [best.ax, best.ay]
}

/**
 * @param {unknown} flow {nodes, edges} of route 59
 * @param {() => string} [newId] id generator
 * @return {object|null} a validated payload knorke:1 (board null): shapes, then connectors; null: no flow
 */
export function flowPayload(flow, newId = ulid) {
	const l = flowLayout(flow)
	if (!l) return null
	const ids = l.nodes.map(() => newId())
	const items = l.nodes.map((nd, i) => ({
		id: ids[i], t: 'shape', x: nd.x, y: nd.y, w: nd.w, h: nd.h, r: 0, parent: null,
		data: { kind: nd.kind, text: nd.text }, style: { ...TYPES.shape.defaults.style }, group: null,
	}))
	const end = (i, px, py) => {
		const [ax, ay] = nearestAnchor(l.nodes[i].kind, px, py)
		return { item: ids[i], ax, ay }
	}
	for (const e of l.edges) {
		const data = e.back
			? { start: end(e.from, 1, 0.5), end: end(e.to, 1, 0.5), route: 'elbow' }
			: { start: end(e.from, 0.5, 1), end: end(e.to, 0.5, 0), route: 'elbow' }
		if (e.label.trim() !== '') data.label = e.label.trim()
		items.push({ id: newId(), t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, parent: null, data, style: { ...TYPES.connector.defaults.style }, group: null })
	}
	const v = validatePayload({ knorke: 1, board: null, origin: [l.x, l.y], items }, { maxItems: Infinity })
	return v.ok && v.skipped === 0 ? { ...v.payload, board: null } : null
}
