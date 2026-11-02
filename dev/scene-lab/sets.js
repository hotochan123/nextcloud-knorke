/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The scene sets of the measurement mode (run.mjs --set, lab.js ?set=).
 * m1 and noconn are the boards of SPEC-M1 §8.5 (scene-gen.js); factory job
 * 214 adds two boards with what came after M1, measured against the M1
 * thresholds (thresholds.js):
 *
 * - m2notes: the m1 board item for item (same ids, boxes and texts), plus
 *   12 tags in the board's meta (every second note carries 1–3), 300 locked
 *   notes and shapes, 100 groups of 3–6 neighbouring notes in a frame and
 *   300 notes with 1–4 reactions; the grid is on
 * - m2diagrams: a board full of diagrams on the same area: 28 BPMN pools
 *   (frames with 4 named lanes and 3 named columns, 36 BPMN shapes of all
 *   four groups, 40 elbow connectors: sequence and message flows), 16
 *   flowchart frames (30 flowchart and basic shapes, 15 symbols with a
 *   label, 45 elbow connectors), 20 mind maps of 100 nodes (5 per layout),
 *   20 tables of 5 × 8 cells, 10 note pads, 30 own shapes (a small SVG),
 *   600 notes (every second with tags, 100 with reactions), 100 text items,
 *   60 groups, 10 % of the shapes and 4 pools locked, the grid on. In each
 *   pool and flowchart a third of the connectors skip the shape between
 *   their ends, so their elbow route has to run around it (job 197).
 *
 * The additions of m2notes come from their own random streams, so the m1
 * items stay as they are. The items the measurement drags and presses
 * (meta.centerNoteIds, meta.hubNoteId and the hub's neighbours) are never
 * locked or grouped. In m2diagrams meta.centerNoteIds are tasks of the pool
 * nearest the middle of the board and meta.hubNoteId is a task with exactly
 * six connectors (gate G12); the meta keys keep their M1 names.
 *
 * Pure: the lab page (Vite) and the node tests import it; run.mjs runs in a
 * container that sees only dev/scene-lab and keeps its own list of the sets.
 */
import { MM_LAYOUTS, mindmapFromOutline, mindmapLayout, nodesOf } from '../../src/model/mindmap.js'
import { newKey, tableLayout } from '../../src/model/table.js'
import { BASIC_KINDS, BPMN_GROUPS, FLOWCHART_KINDS } from '../../src/model/shapes.js'
import { ENUMS } from '../../src/model/registry.js'
import { CONNECTOR_COLORS, SHAPE_PALETTE, STICKY_COLORS, TAG_COLORS } from '../../src/model/tokens.js'
import { keysBetween } from '../../src/model/zorder.js'
import { createRng } from './prng.js'
import { BOARD, DEFAULT_COUNTS, DEFAULT_SEED, SCENE_SETS, generateScene, item, makeIdFactory, makeText } from './scene-gen.js'

/** Every set of the measurement mode; run.mjs keeps the same list (it cannot import this file). */
export const MEASURE_SETS = Object.freeze(['m1', 'noconn', 'm2notes', 'm2diagrams', 'mdnotes'])

/** The locker of every locked item of the M2 sets. */
export const LAB_LOCK = Object.freeze({ by: 'a1b2c3d4e5f60718', name: 'Lena Lab' })
const TAG_NAMES = ['Idee', 'Frage', 'Risiko', 'Kunde', 'Team', 'Dringend', 'Später', 'Daten', 'Prozess', 'Entscheidung', 'Feedback', 'Blocker']
const EMOJI = ['1f44d', '2764-fe0f', '1f389', '1f914', '1f680', '1f440']
/** A small own shape (job 203): a blue disc with a tick, as an SVG data URI. */
export const LAB_PICTURE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiMyZjZmZGIiLz48cGF0aCBkPSJNNyAxMmwzIDMgNy03IiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjwvc3ZnPg=='

/** Counts of the diagram board (sets.js file comment). */
export const DIAGRAM_COUNTS = Object.freeze({
	pools: 28, poolShapes: 36, poolConnectors: 40, flowcharts: 16, flowShapes: 30, flowSymbols: 15, flowConnectors: 45,
	mindmaps: 20, mindNodes: 100, tables: 20, pads: 10, pictures: 30, notes: 600, texts: 100, groups: 60, lockedPools: 4,
})

/**
 * @param {string} set one of MEASURE_SETS
 * @param {{seed?: number}} [opts] seed
 * @return {{items: object[], meta: object}} the board of the set
 */
export function generateSet(set, { seed = DEFAULT_SEED } = {}) {
	if (set === 'm1' || set === 'noconn') return generateScene({ counts: SCENE_SETS[set], seed })
	if (set === 'm2notes') return generateM2Notes({ seed })
	if (set === 'm2diagrams') return generateDiagrams({ seed })
	if (set === 'mdnotes') return generateMdNotes({ seed })
	throw new Error(`unknown set ${set} (${MEASURE_SETS.join('|')})`)
}

/**
 * @param {object} rng generator
 * @param {Array} list list
 * @return {Array} a shuffled copy
 */
function shuffled(rng, list) {
	const a = list.slice()
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1))
		const t = a[i]
		a[i] = a[j]
		a[j] = t
	}
	return a
}

/**
 * @param {object} rng generator
 * @param {Array<{id: string}>} tags the board's tags
 * @return {string[]} 1–3 different tag ids
 */
function someTags(rng, tags) {
	const k = rng.int(1, 3)
	const ids = []
	while (ids.length < k) {
		const id = rng.pick(tags).id
		if (!ids.includes(id)) ids.push(id)
	}
	return ids
}

/**
 * @param {object} rng generator
 * @return {object} data.react with 1–4 reactions of different people
 */
function someReactions(rng) {
	const out = {}
	const n = rng.int(1, 4)
	for (let i = 0; i < n; i++) {
		const pid = (0xb000 + rng.int(0, 0xfff)).toString(16).padStart(16, '0')
		out['p' + pid] = { e: rng.pick(EMOJI), n: `Gast ${i + 1}` }
	}
	return out
}

/**
 * @param {() => string} nextId ULID factory
 * @return {Array<{id: string, name: string, color: string}>} the 12 tags of a board (meta.tags)
 */
function makeTags(nextId) {
	return TAG_NAMES.map((name, i) => ({ id: nextId(), name, color: TAG_COLORS[i % TAG_COLORS.length] }))
}

/** (Job 279) The Markdown a note of mdnotes gets, by its index: bold, italic, a list, a link, code, struck. */
const MD_FORMS = Object.freeze([
	(w) => '**' + w[0] + '** ' + w.slice(1).join(' '),
	(w) => w.slice(0, -1).join(' ') + ' *' + w.at(-1) + '*',
	(w) => w.map((x) => '- ' + x).slice(0, 4).join('\n'),
	(w) => w.join(' ') + ' https://example.org/' + w[0],
	(w) => '`' + w[0] + '` ' + w.slice(1).join(' '),
	(w) => '~~' + w[0] + '~~ **' + w.slice(1).join(' ') + '**',
])

/**
 * (Job 279) The m1 board item for item, every second note's text with
 * Markdown (MD_FORMS in turn: bold, italic, a list, a link, code, struck),
 * the other notes as they are: the speed of formatted next to plain text.
 *
 * @param {{seed?: number}} [opts] seed
 * @return {{items: object[], meta: object}}
 */
export function generateMdNotes({ seed = DEFAULT_SEED } = {}) {
	const { items, meta } = generateScene({ counts: DEFAULT_COUNTS, seed })
	let n = 0
	const out = items.map((it) => {
		if (it.t !== 'sticky') return it
		const k = n++
		const words = String(it.data?.text ?? '').split(/\s+/).filter((x) => x !== '')
		if (k % 2 === 1 || words.length === 0) return it
		return { ...it, data: { ...it.data, text: MD_FORMS[(k / 2) % MD_FORMS.length](words) } }
	})
	return { items: out, meta }
}

/**
 * The m1 board with the M2 additions (file comment).
 *
 * @param {{seed?: number}} [opts] seed
 * @return {{items: object[], meta: object}}
 */
export function generateM2Notes({ seed = DEFAULT_SEED } = {}) {
	const { items, meta } = generateScene({ counts: DEFAULT_COUNTS, seed })
	const rng = createRng(seed).fork(214)
	const nextId = makeIdFactory(rng.fork(1))
	const tags = makeTags(nextId)
	const byId = new Map(items.map((it) => [it.id, it]))
	// what the measurement drags and presses stays free
	const keep = new Set([...meta.centerNoteIds, meta.hubNoteId])
	for (const cid of meta.hubConnectorIds) {
		const c = byId.get(cid)
		keep.add(c.data.start.item)
		keep.add(c.data.end.item)
	}
	const notes = items.filter((it) => it.t === 'sticky')

	const tRng = rng.fork(2)
	let tagged = 0
	notes.forEach((n, i) => {
		if (i % 2 === 1) return
		n.data.tags = someTags(tRng, tags)
		tagged++
	})

	// groups: runs of 3–6 consecutive notes of one frame (placeCluster lays
	// them out in a grid, so consecutive notes are neighbours), dense frame left out
	const gRng = rng.fork(3)
	const framed = notes.filter((n) => n.parent !== null && n.parent !== meta.denseFrameId && !keep.has(n.id))
	const groups = []
	for (let i = 0; i < framed.length && groups.length < 100;) {
		const size = gRng.int(3, 6)
		const run = framed.slice(i, i + size)
		if (run.length === size && run.every((n) => n.parent === run[0].parent)) {
			const g = nextId()
			for (const n of run) n.group = g
			groups.push(run.map((n) => n.id))
			i += size + gRng.int(3, 12)
		} else {
			i++
		}
	}

	const lRng = rng.fork(4)
	const lockable = items.filter((it) => (it.t === 'sticky' || it.t === 'shape') && !keep.has(it.id) && !it.group)
	const locked = shuffled(lRng, lockable).slice(0, 300)
	for (const it of locked) it.lock = { ...LAB_LOCK }

	const rRng = rng.fork(5)
	const reacted = shuffled(rRng, notes.filter((n) => !keep.has(n.id))).slice(0, 300)
	for (const n of reacted) n.data.react = someReactions(rRng)

	meta.tags = tags
	meta.grid = true
	meta.reactions = true
	meta.extras = { tags: tags.length, tagged, groups: groups.length, grouped: groups.flat().length, locked: locked.length, reacted: reacted.length }
	return { items, meta }
}

// ---------------------------------------------------------------- the diagram board

/** A pool: head column, three columns, four lanes (lanes.js), 2440 × 1580. */
const POOL = Object.freeze({ lanes: 4, cols: 3, laneH: 380, colW: 760, head: 160, colHead: 60 })
const POOL_W = POOL.head + POOL.cols * POOL.colW
const POOL_H = POOL.colHead + POOL.lanes * POOL.laneH
/** The nine shapes of a lane, three per column. */
const POOL_ROLES = Object.freeze(['start', 'task', 'gateway', 'task', 'task', 'gateway', 'task', 'data', 'end'])
const POOL_SLOT_X = Object.freeze([130, 380, 630])
const ROLE_SIZE = Object.freeze({ start: [64, 64], end: [64, 64], task: [180, 120], gateway: [80, 80], data: [80, 100] })
const ROLE_KINDS = Object.freeze({
	start: BPMN_GROUPS.events.slice(0, 6), end: BPMN_GROUPS.events.slice(6), task: BPMN_GROUPS.tasks,
	gateway: BPMN_GROUPS.gateways, data: BPMN_GROUPS.data,
})
/** Sequence flows of a lane: six between neighbours, three that skip the shape between their ends. */
const LANE_NEAR = Object.freeze([[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8]])
const LANE_SKIP = Object.freeze([[2, 4], [5, 7], [1, 3]])
/** Message flows of a pool [lane, slot, lane]: two lanes apart, across the shape of the lane between. */
const POOL_MESSAGES = Object.freeze([[0, 4, 2], [1, 1, 3], [0, 7, 2], [1, 6, 3]])
const LANE_NAMES = ['Kunde', 'Vertrieb', 'Fertigung', 'Versand', 'Einkauf', 'Service']
const COL_NAMES = ['Planen', 'Umsetzen', 'Prüfen']

/** A flowchart frame: 9 × 5 places, every third a symbol. */
const FLOW = Object.freeze({ cols: 9, rows: 5, dx: 300, dy: 280, pad: 100 })
const FLOW_W = FLOW.cols * FLOW.dx + 2 * FLOW.pad
const FLOW_H = FLOW.rows * FLOW.dy + 2 * FLOW.pad
const FLOW_KINDS = Object.freeze([...FLOWCHART_KINDS, ...BASIC_KINDS])
const SYMBOL_KINDS = Object.freeze(ENUMS.shapeKinds.filter((k) => k.startsWith('icon')))

const GAP = 400
const NOTE = 200
const NOTE_GAP = 30

/**
 * @param {string} prefix 'l' or 'c'
 * @param {object} rng generator
 * @param {object} taken keys so far
 * @return {string} a lane or column key (lanes.js LANE_KEY_RE, COL_KEY_RE)
 */
function laneKey(prefix, rng, taken) {
	for (;;) {
		let k = prefix
		for (let i = 0; i < 8; i++) k += '0123456789abcdefghijklmnopqrstuvwxyz'[rng.int(0, 35)]
		if (!Object.hasOwn(taken, k)) return k
	}
}

/**
 * @param {number} k pool number
 * @param {object} rng generator
 * @return {object} data of a pool frame: title, four named lanes, three named columns
 */
function poolData(k, rng) {
	const lanes = {}
	keysBetween(null, null, POOL.lanes).forEach((o, i) => {
		lanes[laneKey('l', rng, lanes)] = { o, h: POOL.laneH, t: LANE_NAMES[(k + i) % LANE_NAMES.length] }
	})
	const cols = {}
	keysBetween(null, null, POOL.cols).forEach((o, i) => {
		cols[laneKey('c', rng, cols)] = { o, w: POOL.colW, t: COL_NAMES[i] }
	})
	return { title: `Prozess ${k + 1}`, lanes, cols }
}

/**
 * @param {object} rng generator
 * @param {number} k mind map number
 * @return {{root: string, lines: Array<{depth: number, text: string}>}} 100 nodes: 5 branches, 20 children, 74 grandchildren
 */
function mindOutline(rng, k) {
	const lines = []
	for (let b = 0; b < 5; b++) {
		lines.push({ depth: 1, text: makeText(rng, 1, 3) })
		for (let c = 0; c < 4; c++) {
			lines.push({ depth: 2, text: makeText(rng, 1, 4) })
			const n = b * 4 + c < 14 ? 4 : 3
			for (let g = 0; g < n; g++) lines.push({ depth: 3, text: makeText(rng, 1, 5) })
		}
	}
	return { root: `Thema ${k + 1}`, lines }
}

/**
 * Lays blocks out row by row (shelves) over the board, GAP apart.
 *
 * @param {Array<{w: number, h: number}>} blocks in order
 * @return {Array<{x: number, y: number}>} the top-left corner of each
 */
function shelves(blocks) {
	const out = []
	let x = GAP
	let y = GAP
	let rowH = 0
	for (const b of blocks) {
		if (x > GAP && x + b.w > BOARD.w - GAP) {
			x = GAP
			y += rowH + GAP
			rowH = 0
		}
		out.push({ x, y })
		x += b.w + GAP
		rowH = Math.max(rowH, b.h)
	}
	return out
}

/**
 * The diagram board (file comment).
 *
 * @param {{seed?: number}} [opts] seed
 * @return {{items: object[], meta: object}}
 */
export function generateDiagrams({ seed = DEFAULT_SEED } = {}) {
	const C = DIAGRAM_COUNTS
	const rng = createRng(seed).fork(2140)
	const nextId = makeIdFactory(rng.fork(1))
	const tags = makeTags(nextId)
	const txt = rng.fork(2)
	const keyRng = rng.fork(3)
	const items = []
	const frames = []
	const pools = []
	const flows = []
	const shapes = []
	const notes = []
	const texts = []
	const connectors = []
	const others = []
	const add = (list, it) => {
		list.push(it)
		items.push(it)
		return it
	}
	const shape = (parent, kind, cx, cy, w, h, text, style = {}) => add(shapes, item(nextId(), 'shape', parent, cx - w / 2, cy - h / 2, w, h, 0,
		{ kind, text }, { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2, ...style }))
	const connect = (a, b, style, label = null) => {
		const data = { start: { item: a.id }, end: { item: b.id }, route: 'elbow' }
		if (label) data.label = label
		return add(connectors, item(nextId(), 'connector', null, 0, 0, 0, 0, 0, data, { stroke: '#1a1a1a', strokeWidth: 2, ...style }))
	}
	const SEQ = { endCap: 'triangle' }
	const MSG = { dash: 'dashed', startCap: 'circleOpen', endCap: 'triangleOpen', stroke: CONNECTOR_COLORS[2 % CONNECTOR_COLORS.length] }
	const noteGrid = (x, y, n, cols) => {
		for (let i = 0; i < n; i++) {
			const c = i % cols
			const r = Math.floor(i / cols)
			add(notes, item(nextId(), 'sticky', null, x + c * (NOTE + NOTE_GAP), y + r * (NOTE + NOTE_GAP), NOTE, NOTE, 0,
				{ text: makeText(txt, 1, 20) }, { fill: txt.pick(STICKY_COLORS) }))
		}
	}
	const heading = (x, y, text, fontSize = 48) => add(texts, item(nextId(), 'text', null, x, y, 900, Math.round(fontSize * 1.2), 0,
		{ text }, { fontSize, color: '#1a1a1a', align: 'left' }))

	const blocks = []
	// a pool, a heading above it and 15 notes below it
	for (let k = 0; k < C.pools; k++) {
		const notesH = 3 * NOTE + 2 * NOTE_GAP
		blocks.push({
			kind: 'pool', w: POOL_W, h: 100 + POOL_H + 80 + notesH,
			emit: (x, y) => {
				heading(x, y, `Prozess ${k + 1}: ${makeText(txt, 1, 3)}`)
				const f = add(frames, item(nextId(), 'frame', null, x, y + 100, POOL_W, POOL_H, 0, poolData(k, keyRng), { fill: '#ffffff' }))
				const pool = { frame: f, lanes: [] }
				for (let l = 0; l < POOL.lanes; l++) {
					const row = POOL_ROLES.map((role, p) => {
						const [w, h] = ROLE_SIZE[role]
						const kinds = ROLE_KINDS[role]
						const kind = kinds[(k + l + p) % kinds.length]
						const cx = POOL.head + Math.floor(p / 3) * POOL.colW + POOL_SLOT_X[p % 3]
						const cy = POOL.colHead + l * POOL.laneH + POOL.laneH / 2
						return shape(f.id, kind, cx, cy, w, h, makeText(txt, 1, role === 'task' ? 4 : 2))
					})
					pool.lanes.push(row)
				}
				for (const row of pool.lanes) {
					for (const [a, b] of LANE_NEAR) connect(row[a], row[b], SEQ)
					for (const [a, b] of LANE_SKIP) connect(row[a], row[b], SEQ)
				}
				for (const [la, p, lb] of POOL_MESSAGES) connect(pool.lanes[la][p], pool.lanes[lb][p], MSG)
				noteGrid(x, y + 100 + POOL_H + 80, 15, 5)
				pools.push(pool)
			},
		})
	}
	// a flowchart frame, two text items and 10 notes below it
	for (let k = 0; k < C.flowcharts; k++) {
		const notesH = 2 * NOTE + NOTE_GAP
		blocks.push({
			kind: 'flow', w: FLOW_W, h: 100 + FLOW_H + 80 + notesH,
			emit: (x, y) => {
				heading(x, y, `Ablauf ${k + 1}`)
				const f = add(frames, item(nextId(), 'frame', null, x, y + 100, FLOW_W, FLOW_H, 0, { title: `Ablauf ${k + 1}` }, { fill: '#ffffff' }))
				const rows = []
				for (let r = 0; r < FLOW.rows; r++) {
					const row = []
					for (let c = 0; c < FLOW.cols; c++) {
						const n = r * FLOW.cols + c
						const cx = FLOW.pad + c * FLOW.dx + FLOW.dx / 2
						const cy = FLOW.pad + r * FLOW.dy + FLOW.dy / 2 - 20
						row.push(n % 3 === 2
							? shape(f.id, SYMBOL_KINDS[(k + n) % SYMBOL_KINDS.length], cx, cy, 80, 80, makeText(txt, 1, 2), { fill: txt.pick(SHAPE_PALETTE.slice(8)), strokeWidth: 0 })
							: shape(f.id, FLOW_KINDS[(k + n) % FLOW_KINDS.length], cx, cy, 180, 100, makeText(txt, 1, 4), { fill: txt.pick(SHAPE_PALETTE.slice(0, 8)) }))
					}
					rows.push(row)
				}
				for (const row of rows) {
					for (const [a, b] of LANE_NEAR) connect(row[a], row[b], { endCap: 'arrow' })
					for (const [a, b] of LANE_SKIP) connect(row[a], row[b], { endCap: 'arrow' }, txt.chance(0.3) ? makeText(txt, 1, 2) : null)
				}
				// groups: in the first 12 flowcharts, per row the shapes 0 … 2–4 (3, 4, 5, 3, 4 members)
				if (k < C.groups / FLOW.rows) {
					rows.forEach((row, r) => {
						const g = nextId()
						for (const s of row.slice(0, 3 + (r % 3))) s.group = g
					})
				}
				const nx = x
				const ny = y + 100 + FLOW_H + 80
				noteGrid(nx, ny, 10, 5)
				heading(nx + 5 * (NOTE + NOTE_GAP) + 100, ny, makeText(txt, 8, 30), 20)
				flows.push({ frame: f, rows })
			},
		})
	}
	// mind maps, 5 per layout, each with a heading
	for (let k = 0; k < C.mindmaps; k++) {
		const { data } = mindmapFromOutline(mindOutline(txt, k), { rand: () => keyRng.next() })
		const style = { layout: MM_LAYOUTS[k % MM_LAYOUTS.length] }
		const lay = mindmapLayout({ t: 'mindmap', x: 0, y: 0, w: 0, h: 0, parent: null, data, style })
		const w = Math.round(Math.max(20, lay.w))
		const h = Math.round(Math.max(20, lay.h))
		blocks.push({
			kind: 'mind', w: Math.max(w, 900), h: 100 + h,
			emit: (x, y) => {
				heading(x, y, `Mindmap ${k + 1}`)
				add(others, item(nextId(), 'mindmap', null, x, y + 100, w, h, 0, data, style))
			},
		})
	}
	// tables of 5 × 8 filled cells, each with a heading
	for (let k = 0; k < C.tables; k++) {
		const cols = {}
		const rows = {}
		keysBetween(null, null, 5).forEach((o) => {
			cols[newKey('c', cols, () => keyRng.next())] = { o, w: 160 }
		})
		keysBetween(null, null, 8).forEach((o) => {
			rows[newKey('r', rows, () => keyRng.next())] = { o }
		})
		const cells = {}
		for (const c of Object.keys(cols)) {
			cells[c] = {}
			for (const r of Object.keys(rows)) cells[c][r] = makeText(txt, 1, 3)
		}
		const data = { cols, rows, cells }
		const lay = tableLayout({ t: 'table', x: 0, y: 0, w: 0, h: 0, data, style: {} })
		blocks.push({
			kind: 'table', w: Math.max(900, lay.w), h: 100 + lay.h,
			emit: (x, y) => {
				heading(x, y, `Tabelle ${k + 1}`)
				add(others, item(nextId(), 'table', null, x, y + 100, lay.w, lay.h, 0, data, {}))
			},
		})
	}
	// note pads, five in a row
	for (let k = 0; k < C.pads / 5; k++) {
		blocks.push({
			kind: 'pads', w: 5 * 200 + 4 * 120, h: 300,
			emit: (x, y) => {
				for (let i = 0; i < 5; i++) {
					add(others, item(nextId(), 'pad', null, x + i * 320, y, 200, 200, 0, { title: `Block ${k * 5 + i + 1}` }, { fill: STICKY_COLORS[i % STICKY_COLORS.length] }))
				}
			},
		})
	}
	// own shapes, ten in a block (5 × 2)
	for (let k = 0; k < C.pictures / 10; k++) {
		blocks.push({
			kind: 'pictures', w: 5 * 96 + 4 * 60, h: 2 * 96 + 60,
			emit: (x, y) => {
				for (let i = 0; i < 10; i++) {
					add(shapes, item(nextId(), 'shape', null, x + (i % 5) * 156, y + Math.floor(i / 5) * 156, 96, 96, 0,
						{ kind: 'image', text: '', img: [LAB_PICTURE] }, { strokeWidth: 0, fillOpacity: 0 }))
				}
			},
		})
	}
	// the rest of the notes in clusters of 20
	const clusterNotes = C.notes - C.pools * 15 - C.flowcharts * 10
	for (let k = 0; k < clusterNotes / 20; k++) {
		blocks.push({ kind: 'notes', w: 5 * NOTE + 4 * NOTE_GAP, h: 4 * NOTE + 3 * NOTE_GAP, emit: (x, y) => noteGrid(x, y, 20, 5) })
	}
	// the G12 hub: a task with six tasks around it, one connector to each
	let hub = null
	const hubIds = []
	const hubBlock = {
		kind: 'hub', w: 1300, h: 900,
		emit: (x, y) => {
			hub = shape(null, 'bpmnTask', x + 650, y + 450, 180, 120, 'Hub')
			for (const [cx, cy] of [[190, 60], [650, 60], [1110, 60], [190, 840], [650, 840], [1110, 840]]) {
				const t = shape(null, 'bpmnTask', x + cx, y + cy, 180, 120, makeText(txt, 1, 3))
				hubIds.push(connect(hub, t, SEQ, hubIds.length === 0 ? 'Hub' : null).id)
			}
		},
	}

	// rows of similar height (tallest first, stable), so the board keeps the area of m1; the hub in the middle
	const order = blocks.map((b, i) => [b, i]).sort((a, b) => b[0].h - a[0].h || a[1] - b[1]).map(([b]) => b)
	order.splice(Math.floor(order.length / 2), 0, hubBlock)
	shelves(order).forEach((at, i) => order[i].emit(at.x, at.y))

	// the pool nearest the middle of the content: its tasks are the notes the measurement presses
	const bounds = items.filter((it) => it.parent === null && it.t !== 'connector').reduce((b, it) => ({
		x0: Math.min(b.x0, it.x), y0: Math.min(b.y0, it.y), x1: Math.max(b.x1, it.x + it.w), y1: Math.max(b.y1, it.y + it.h),
	}), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
	const mid = { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 }
	const centreOf = (f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 })
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
	const central = pools.slice().sort((a, b) => dist(centreOf(a.frame), mid) - dist(centreOf(b.frame), mid))[0]
	const denseCenter = centreOf(central.frame)
	const absCentre = (s) => ({ x: central.frame.x + s.x + s.w / 2, y: central.frame.y + s.y + s.h / 2 })
	const centerTasks = central.lanes.flat().filter((s) => ROLE_KINDS.task.includes(s.data.kind))
		.sort((a, b) => dist(absCentre(a), denseCenter) - dist(absCentre(b), denseCenter)).slice(0, 8)

	// locks: four pools (never the central one) and a tenth of all shapes, none of the central pool, the hub or a group
	const keep = new Set([...central.lanes.flat().map((s) => s.id), hub.id, ...connectors.filter((c) => hubIds.includes(c.id)).map((c) => c.data.end.item)])
	const lockedPools = pools.filter((p) => p !== central).slice(0, C.lockedPools)
	for (const p of lockedPools) p.frame.lock = { ...LAB_LOCK }
	const lockable = shapes.filter((s) => !keep.has(s.id) && !s.group)
	const lockedShapes = shuffled(rng.fork(5), lockable).slice(0, Math.round(shapes.length / 10))
	for (const s of lockedShapes) s.lock = { ...LAB_LOCK }

	// tags on every second note, reactions on 100 notes
	const tRng = rng.fork(4)
	notes.forEach((n, i) => {
		if (i % 2 === 0) n.data.tags = someTags(tRng, tags)
	})
	const reacted = shuffled(tRng, notes).slice(0, 100)
	for (const n of reacted) n.data.react = someReactions(tRng)

	// z: frames first (one key space, as in scene-gen.js), then everything in creation order
	const ordered = [...frames, ...items.filter((it) => it.t !== 'frame')]
	const keys = keysBetween(null, null, ordered.length)
	ordered.forEach((it, i) => {
		it.z = keys[i]
	})
	const byKind = (t) => ordered.filter((it) => it.t === t).length
	return {
		items: ordered,
		meta: {
			seed,
			set: 'm2diagrams',
			counts: {
				sticky: byKind('sticky'), shape: byKind('shape'), text: byKind('text'), connector: byKind('connector'),
				frame: byKind('frame'), unknown: 0, mindmap: byKind('mindmap'), table: byKind('table'), pad: byKind('pad'),
				total: ordered.length,
			},
			board: BOARD,
			bounds,
			denseFrameId: central.frame.id,
			denseRect: { x: central.frame.x, y: central.frame.y, w: central.frame.w, h: central.frame.h },
			denseCenter,
			centerNoteIds: centerTasks.map((s) => s.id),
			unknownIds: [],
			frameIds: frames.map((f) => f.id),
			poolIds: pools.map((p) => p.frame.id),
			flowFrameIds: flows.map((f) => f.frame.id),
			shapeIds: shapes.map((s) => s.id),
			textIds: texts.map((t) => t.id),
			connectorIds: connectors.map((c) => c.id),
			hubNoteId: hub.id,
			hubConnectorIds: hubIds,
			tags,
			grid: true,
			reactions: true,
			extras: {
				tags: tags.length,
				tagged: notes.filter((n) => n.data.tags).length,
				groups: new Set(shapes.filter((s) => s.group).map((s) => s.group)).size,
				grouped: shapes.filter((s) => s.group).length,
				locked: lockedShapes.length + lockedPools.length,
				lockedPools: lockedPools.length,
				reacted: reacted.length,
				mindNodes: others.filter((o) => o.t === 'mindmap').reduce((n, m) => n + nodesOf(m.data).size, 0),
			},
		},
	}
}
