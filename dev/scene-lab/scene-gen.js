/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Deterministic workshop board in the wire format (SPEC-M0 §9.4), port of the
 * engine spike's generator (scene.js): notes, frames, 1 % unknown types that
 * must show up as placeholders, and (SPEC-M1 §8.5) the M1 set: 500 shapes
 * (all six kinds, fills with opacity, strokes, dashes, rotations, text with
 * alignments), 100 text items (font sizes 16–64, wrap widths, line breaks)
 * and 800 connectors between nearby notes and shapes (all routes, caps,
 * dashes, some labels; their stored box is 0 × 0, rule 12). Six of them hang
 * at one note of the dense frame (meta.hubNoteId, the "note with 6
 * connectors" of gate G12, away from the eight notes the M0 gates press
 * on), the other 794 between random neighbours OUTSIDE the dense frame, so
 * no line crosses the notes the gates click (tests/js/scene/labScene.test.mjs).
 *
 * The notes, frames and placeholders are generated exactly as in M0 (same
 * random streams), so the M0 gates keep their items; shapes and text items
 * only go to free space outside the frames, connectors add no box.
 *
 * Output items are WireItems {id, t, x, y, w, h, r, z, parent, data, style}:
 * x/y relative to the parent frame, z from src/model/zorder.js (one global
 * key space, frames first), no stored font size on notes; text items carry
 * an estimated h (the lab's G18 measures the real one).
 */
import { keysBetween } from '../../src/model/zorder.js'
import { CONNECTOR_COLORS, SHAPE_PALETTE, STICKY_COLORS } from '../../src/model/tokens.js'
import { ENUMS } from '../../src/model/registry.js'
import { createRng } from './prng.js'

export const DEFAULT_COUNTS = Object.freeze({ sticky: 3000, shape: 500, connector: 800, text: 100, frame: 20, unknown: 30 })
/** The M0 board (gates of stage 0 compare against it). */
export const M0_COUNTS = Object.freeze({ sticky: 3000, shape: 0, connector: 0, text: 0, frame: 20, unknown: 30 })
/**
 * Scene sets of the measurement mode (run.mjs --set, lab.js ?set=): m1 is the
 * board of SPEC-M1 §8.5; noconn is the same board without its connectors.
 * The connectors come last, from their own stream and after every other id,
 * so all other items are identical (only their z keys are spread over fewer
 * items, in the same order): the A/B of the camera step with 800 connectors.
 */
export const SCENE_SETS = Object.freeze({ m1: DEFAULT_COUNTS, noconn: Object.freeze({ ...DEFAULT_COUNTS, connector: 0 }) })
export const BOARD = Object.freeze({ w: 40000, h: 25000 })
export const DEFAULT_SEED = 20261010

/** Rank (distance from the dense centre) of the G12 hub note: well away from the eight gate notes. */
const HUB_RANK = 40
const CELL_COLS = 5
const CELL_W = BOARD.w / CELL_COLS
const CELL_H = BOARD.h / 4
const ZONE_W = 1200
const ZONE_H = 1000
const GAP = 30
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BASE_TIME = Date.UTC(2026, 9, 10, 12, 0, 0)

const WORDS = (
	'Ziel Kunde Idee Problem Lösung Risiko Nutzen Feedback Workshop Team Prozess Daten Termin Budget ' +
	'Onboarding Retrospektive Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung Schnittstelle ' +
	'what went well improve keep stop start more less maybe because users need faster simpler clearer ' +
	'Abstimmung Prototyp Hypothese Experiment Messgröße Annahme Zielgruppe Persona Journey Schmerzpunkt ' +
	'Release Backlog Sprint Story Akzeptanzkriterien Abhängigkeit Blocker Owner Entscheidung Frage ' +
	'und oder nicht mit ohne für gegen bei nach vor über unter alle keine viele wenige heute morgen'
).split(/\s+/)

const FRAME_NAMES = [
	'Check-in', 'Brainstorming', 'Clustering', 'Dot Voting', 'Retro: Gut', 'Retro: Besser', 'Story Map',
	'SWOT', 'Persona', 'Customer Journey', 'Risiken', 'Maßnahmen', 'Parkplatz', 'Agenda', 'Fragen',
	'Hypothesen', 'Experimente', 'Roadmap Q1', 'Roadmap Q2', 'Check-out',
]

/**
 * Item types the registry does not know; they render as placeholders.
 * SPEC-M1 §8.5: shape, text and connector are registry types from stage 1 on.
 */
const UNKNOWN_TYPES = ['image', 'pen', 'mindmap', 'sticker']

/**
 * @param {object} rng generator
 * @return {() => string} deterministic ULID factory
 */
function makeIdFactory(rng) {
	let n = 0
	return () => {
		let t = BASE_TIME + n++
		let time = ''
		for (let i = 0; i < 10; i++) {
			time = CROCKFORD[t % 32] + time
			t = Math.floor(t / 32)
		}
		let rand = ''
		for (let i = 0; i < 16; i++) rand += CROCKFORD[Math.floor(rng.next() * 32)]
		return time + rand
	}
}

/**
 * @param {object} rng generator
 * @param {number} minWords minimum
 * @param {number} maxWords maximum
 * @param {number} [skew] bias towards short texts
 * @return {string}
 */
function makeText(rng, minWords, maxWords, skew = 2.2) {
	const n = minWords + Math.floor((maxWords - minWords + 1) * Math.pow(rng.next(), skew))
	const words = []
	for (let i = 0; i < n; i++) words.push(rng.pick(WORDS))
	const s = words.join(' ')
	return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * @param {string} id item id
 * @param {string} t type
 * @param {string|null} parent parent id
 * @param {number} x relative x
 * @param {number} y relative y
 * @param {number} w width
 * @param {number} h height
 * @param {number} r rotation
 * @param {object} data data
 * @param {object} style style
 * @return {object} WireItem without z
 */
function item(id, t, parent, x, y, w, h, r, data, style) {
	return { id, t, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), r, z: null, parent, data, style }
}

/**
 * @param {{counts?:object, seed?:number}} [opts] counts per kind, seed
 * @return {{items:object[], meta:object}}
 */
export function generateScene({ counts = DEFAULT_COUNTS, seed = DEFAULT_SEED } = {}) {
	const rng = createRng(seed)
	const nextId = makeIdFactory(rng.fork(1))

	// frames: one per board cell (5 × 4), frame 0 is the dense one
	const frRng = rng.fork(2)
	const frames = []
	for (let k = 0; k < counts.frame; k++) {
		const col = k % CELL_COLS
		const row = Math.floor(k / CELL_COLS) % 4
		const dense = k === 0
		const w = dense ? 7200 : frRng.int(4800, 7200)
		const h = dense ? 5400 : frRng.int(3600, 5400)
		const x = col * CELL_W + (dense ? 400 : frRng.int(200, CELL_W - w - 200))
		const y = row * CELL_H + (dense ? 425 : frRng.int(250, CELL_H - h - 250))
		frames.push(item(nextId(), 'frame', null, x, y, w, h, 0,
			{ title: `${k + 1}. ${FRAME_NAMES[k % FRAME_NAMES.length]}` }, { fill: '#ffffff' }))
	}
	const dense = frames[0]
	const frameWeights = frames.map((f, k) => (k === 0 ? 3 : frRng.range(0.7, 1.3)))

	const content = []
	const stRng = rng.fork(3)
	const inFrames = Math.round(counts.sticky * 0.8)
	const perFrame = new Array(frames.length).fill(0)
	for (let i = 0; i < inFrames; i++) perFrame[stRng.weighted(frameWeights)]++

	const makeSticky = (parent, x, y, w, h) => {
		const text = makeText(stRng, 1, 40)
		const r = stRng.chance(0.04) ? Math.round(stRng.range(-3, 3) * 10) / 10 : 0
		return item(nextId(), 'sticky', parent, x, y, w, h, r, { text }, { fill: stRng.pick(STICKY_COLORS) })
	}

	const placeCluster = (parentId, ox, oy, n, maxW, maxH) => {
		const rect = stRng.chance(0.3)
		const w = rect ? 300 : 200
		const h = 200
		const maxCols = Math.max(1, Math.floor((maxW + GAP) / (w + GAP)))
		const maxRows = Math.max(1, Math.floor((maxH + GAP) / (h + GAP)))
		const cols = Math.min(maxCols, stRng.int(Math.min(2, maxCols), maxCols))
		const count = Math.min(n, cols * maxRows)
		for (let i = 0; i < count; i++) {
			const c = i % cols
			const r = Math.floor(i / cols)
			content.push(makeSticky(parentId, ox + c * (w + GAP) + stRng.range(-8, 8), oy + r * (h + GAP) + stRng.range(-8, 8), w, h))
		}
		return count
	}

	frames.forEach((f, k) => {
		let budget = perFrame[k]
		const zx = Math.max(1, Math.floor((f.w - 200) / ZONE_W))
		const zy = Math.max(1, Math.floor((f.h - 200) / ZONE_H))
		const zones = []
		for (let j = 0; j < zy; j++) for (let i = 0; i < zx; i++) zones.push([i, j])
		for (let i = zones.length - 1; i > 0; i--) {
			const j = Math.floor(stRng.next() * (i + 1))
			const tmp = zones[i]
			zones[i] = zones[j]
			zones[j] = tmp
		}
		let zi = 0
		let pass = 0
		while (budget > 0) {
			const [i, j] = zones[zi % zones.length]
			const jitter = pass > 0 ? stRng.range(-300, 300) : 0
			const n = Math.min(budget, stRng.int(k === 0 ? 8 : 4, 20))
			budget -= placeCluster(f.id, 100 + i * ZONE_W + 20 + jitter, 100 + j * ZONE_H + 20 + jitter, n, ZONE_W - 40, ZONE_H - 40)
			zi++
			if (zi % zones.length === 0) pass++
		}
	})

	const insideAnyFrame = (x, y, pad = 0) => frames.some((f) =>
		x > f.x - pad && x < f.x + f.w + pad && y > f.y - pad && y < f.y + f.h + pad)
	const freePoint = (r, w, h) => {
		let x = 0
		let y = 0
		for (let t = 0; t < 40; t++) {
			x = r.range(200, BOARD.w - w - 200)
			y = r.range(200, BOARD.h - h - 200)
			if (!insideAnyFrame(x, y, 100) && !insideAnyFrame(x + w, y + h, 100)) break
		}
		return [x, y]
	}

	let freeBudget = counts.sticky - inFrames
	while (freeBudget > 0) {
		const n = Math.min(freeBudget, stRng.int(3, 10))
		const [x, y] = freePoint(stRng, 800, 700)
		freeBudget -= placeCluster(null, x, y, n, 1000, 700)
	}

	// unknown types (placeholders): always at the root (§4.7 rule 8)
	const unRng = rng.fork(4)
	const unknownIds = []
	for (let i = 0; i < counts.unknown; i++) {
		const w = unRng.int(120, 320)
		const h = unRng.int(90, 260)
		const [x, y] = freePoint(unRng, w, h)
		const t = UNKNOWN_TYPES[i % UNKNOWN_TYPES.length]
		const it = item(nextId(), t, null, x, y, w, h, 0, { kind: 'future', n: i }, { stroke: '#2f6fdb' })
		unknownIds.push(it.id)
		content.push(it)
	}

	// M1 shapes: clusters in free space, every kind and style variant
	const shRng = rng.fork(5)
	const shapes = []
	const light = SHAPE_PALETTE.slice(0, 8)
	const strong = SHAPE_PALETTE.slice(8)
	while (shapes.length < (counts.shape ?? 0)) {
		const n = Math.min((counts.shape ?? 0) - shapes.length, shRng.int(4, 12))
		const [ox, oy] = freePoint(shRng, 1300, 900)
		const cols = shRng.int(2, 4)
		for (let i = 0; i < n; i++) {
			const k = shapes.length
			const w = shRng.int(150, 260)
			const h = shRng.int(90, 180)
			const r = shRng.chance(0.1) ? shRng.pick([15, 30, 45, -20]) : 0
			const style = {
				fill: shRng.pick(light),
				stroke: shRng.pick(strong),
				strokeWidth: shRng.pick([0, 1, 2, 2, 4]),
			}
			if (shRng.chance(0.3)) style.fillOpacity = shRng.pick([0, 40, 70])
			if (shRng.chance(0.3)) style.dash = shRng.pick(ENUMS.dashes)
			if (shRng.chance(0.2)) style.align = shRng.pick(ENUMS.aligns)
			if (shRng.chance(0.2)) style.valign = shRng.pick(ENUMS.valigns)
			if (shRng.chance(0.15)) style.fontSize = shRng.pick([12, 16, 24, 32])
			if (shRng.chance(0.2)) style.textColor = shRng.pick(strong)
			const data = { kind: ENUMS.shapeKinds[k % ENUMS.shapeKinds.length], text: shRng.chance(0.6) ? makeText(shRng, 1, 8) : '' }
			const c = i % cols
			const rr = Math.floor(i / cols)
			shapes.push(item(nextId(), 'shape', null, ox + c * 320, oy + rr * 220, w, h, r, data, style))
		}
	}
	content.push(...shapes)

	// M1 text items: headings and paragraphs in free space; h estimated (G18 measures)
	const txRng = rng.fork(6)
	const texts = []
	for (let i = 0; i < (counts.text ?? 0); i++) {
		const fontSize = txRng.pick([16, 20, 24, 24, 32, 48, 64])
		const w = txRng.int(200, 600)
		const para = txRng.chance(0.25)
		const body = makeText(txRng, 1, para ? 30 : 6)
		const text = para && txRng.chance(0.5) ? body.replace(/ (\S+) /, ' $1\n') : body
		const perLine = Math.max(1, Math.floor(w / (fontSize * 0.55)))
		const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
		const h = Math.round(lines * fontSize * 1.2 * 10) / 10
		const [x, y] = freePoint(txRng, w, h)
		const style = { fontSize, color: txRng.pick(['#1a1a1a', '#1a1a1a', ...SHAPE_PALETTE.slice(9)]), align: txRng.pick(ENUMS.aligns) }
		const it = item(nextId(), 'text', null, x, y, w, 0, txRng.chance(0.05) ? 10 : 0, { text }, style)
		it.h = h
		texts.push(it)
	}
	content.push(...texts)

	// the notes of the dense frame by distance from its centre (gates pick from them)
	const frameById = new Map(frames.map((f) => [f.id, f]))
	const absCenter = (it) => {
		const f = it.parent ? frameById.get(it.parent) : null
		return [(f ? f.x : 0) + it.x + it.w / 2, (f ? f.y : 0) + it.y + it.h / 2]
	}
	const denseCenter = { x: dense.x + dense.w / 2, y: dense.y + dense.h / 2 }
	const denseNotes = content.filter((it) => it.t === 'sticky' && it.parent === dense.id && it.r === 0)
	const byDistance = denseNotes.slice().sort((a, b) => {
		const [ax, ay] = absCenter(a)
		const [bx, by] = absCenter(b)
		return Math.hypot(ax - denseCenter.x, ay - denseCenter.y) - Math.hypot(bx - denseCenter.x, by - denseCenter.y)
	})

	// G12 hub: a note of the dense frame away from the eight gate notes (the
	// first eight from the centre), with connectors to its six nearest
	// neighbours (none of the eight), without drawing from the random stream
	const gateNotes = new Set(byDistance.slice(0, 8))
	const connectors = []
	const hub = (counts.connector ?? 0) >= 6 ? byDistance[HUB_RANK] ?? null : null
	if (hub) {
		const [hx, hy] = absCenter(hub)
		const near = denseNotes.filter((n) => n !== hub && !gateNotes.has(n)).map((n) => {
			const [x, y] = absCenter(n)
			return { n, d: Math.hypot(x - hx, y - hy) }
		}).sort((a, b) => a.d - b.d || (a.n.id < b.n.id ? -1 : 1)).slice(0, 6)
		near.forEach(({ n }, i) => {
			const data = { start: { item: hub.id }, end: { item: n.id }, route: ENUMS.routes[i % ENUMS.routes.length] }
			if (i === 0) data.label = 'Hub'
			const style = { stroke: CONNECTOR_COLORS[i % CONNECTOR_COLORS.length], strokeWidth: 2, endCap: ENUMS.caps[1 + (i % 4)] }
			if (i % 2 === 1) style.startCap = 'dot'
			if (i === 5) style.dash = 'dashed'
			connectors.push(item(nextId(), 'connector', null, 0, 0, 0, 0, 0, data, style))
		})
	}

	// M1 connectors between neighbours (notes of one frame, shapes of one
	// cluster) outside the dense frame; lage none (rule 12)
	const coRng = rng.fork(7)
	const bindable = content.filter((it) => (it.t === 'sticky' || it.t === 'shape') && it.parent !== dense.id)
	for (let i = connectors.length; i < (counts.connector ?? 0) && bindable.length > 1; i++) {
		const a = coRng.pick(bindable)
		const near = bindable.filter((b) => b !== a && b.parent === a.parent && Math.abs(b.x - a.x) < 700 && Math.abs(b.y - a.y) < 700)
		const b = near.length > 0 ? coRng.pick(near) : coRng.pick(bindable.filter((x) => x !== a))
		const start = coRng.chance(0.4) ? { item: a.id, ax: coRng.pick([0, 0.5, 1]), ay: coRng.pick([0, 0.5, 1]) } : { item: a.id }
		const data = { start, end: { item: b.id }, route: ENUMS.routes[i % ENUMS.routes.length] }
		if (coRng.chance(0.2)) data.label = makeText(coRng, 1, 3)
		const style = { stroke: coRng.pick(CONNECTOR_COLORS), strokeWidth: coRng.pick([1, 2, 2, 3]), endCap: coRng.pick(ENUMS.caps) }
		if (coRng.chance(0.2)) style.startCap = coRng.pick(ENUMS.caps)
		if (coRng.chance(0.2)) style.dash = coRng.pick(ENUMS.dashes)
		connectors.push(item(nextId(), 'connector', null, 0, 0, 0, 0, 0, data, style))
	}
	content.push(...connectors)

	const items = [...frames, ...content]
	const keys = keysBetween(null, null, items.length)
	items.forEach((it, i) => {
		it.z = keys[i]
	})

	return {
		items,
		meta: {
			seed,
			counts: {
				sticky: content.filter((i) => i.t === 'sticky').length,
				shape: shapes.length,
				text: texts.length,
				connector: connectors.length,
				frame: frames.length,
				unknown: unknownIds.length,
				total: items.length,
			},
			board: BOARD,
			denseFrameId: dense.id,
			denseRect: { x: dense.x, y: dense.y, w: dense.w, h: dense.h },
			denseCenter,
			centerNoteIds: byDistance.slice(0, 8).map((it) => it.id),
			unknownIds,
			frameIds: frames.map((f) => f.id),
			shapeIds: shapes.map((it) => it.id),
			textIds: texts.map((it) => it.id),
			connectorIds: connectors.map((it) => it.id),
			hubNoteId: hub ? hub.id : null,
			hubConnectorIds: hub ? connectors.slice(0, 6).map((it) => it.id) : [],
		},
	}
}
