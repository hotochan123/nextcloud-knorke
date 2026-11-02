/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The measurement sets of factory job 214 (dev/scene-lab/sets.js), checked
 * in Node with the real SceneModel and the app's own checkers:
 * - m2notes (AK1): deterministic, every m1 item unchanged apart from the
 *   additions (tags, reactions, group, lock), the additions in their numbers,
 *   the items the measurement drags never locked or grouped
 * - m2diagrams (AK2): 4000–5000 items on the m1 area, every part in its
 *   number, every item passes the field rules and checkLanes / checkCols /
 *   checkMindmap / checkTable (an invalid one would be drawn as a plain
 *   frame or a placeholder and measure too kind), at least a quarter of the
 *   connectors with an item on the straight line between their ends, the
 *   G12 hub with exactly six connectors, a press on the centre notes hits them
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DIAGRAM_COUNTS, LAB_LOCK, MEASURE_SETS, generateSet } from '../../../dev/scene-lab/sets.js'
import { BOARD, generateScene } from '../../../dev/scene-lab/scene-gen.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { TYPES, checkField, isKnownType } from '../../../src/model/registry.js'
import { checkCols, checkLanes, hasCols, orderedCols, orderedLanes } from '../../../src/model/lanes.js'
import { checkMindmap, nodesOf } from '../../../src/model/mindmap.js'
import { checkTable, orderedCols as tableCols, orderedRows } from '../../../src/model/table.js'
import { BPMN_GROUPS } from '../../../src/model/shapes.js'
import { REACT_KEY_RE, isEmoji } from '../../../src/model/reactions.js'
import { tagsOf } from '../../../src/model/tags.js'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * @param {object} it WireItem
 * @return {string[]} why the item would not pass the app's rules (empty: it passes)
 */
function problems(it) {
	const out = []
	if (!isKnownType(it.t)) return [`unknown type ${it.t}`]
	const [min, max] = TYPES[it.t].size
	if (it.t !== 'connector' && (it.w < min || it.w > max || it.h < min || it.h > max)) out.push(`size ${it.w} × ${it.h}`)
	for (const part of ['data', 'style']) {
		for (const [k, v] of Object.entries(it[part] ?? {})) {
			if (!checkField(it.t, `${part}.${k}`, v).ok) out.push(`${part}.${k}`)
		}
	}
	if (it.t === 'frame' && it.data.lanes !== undefined && !checkLanes(it.data.lanes)) out.push('lanes')
	if (it.t === 'frame' && it.data.cols !== undefined && !checkCols(it.data.cols)) out.push('cols')
	if (it.t === 'mindmap' && !checkMindmap(it.data)) out.push('mindmap')
	if (it.t === 'table' && !checkTable(it.data)) out.push('table')
	if (it.data?.react !== undefined) {
		const r = Object.entries(it.data.react)
		if (r.length < 1 || r.some(([k, v]) => !REACT_KEY_RE.test(k) || !isEmoji(v.e) || typeof v.n !== 'string')) out.push('react')
	}
	if (it.group !== undefined && (typeof it.group !== 'string' || !ULID_RE.test(it.group))) out.push('group')
	if (it.lock !== undefined && JSON.stringify(it.lock) !== JSON.stringify(LAB_LOCK)) out.push('lock')
	return out
}

/**
 * @param {number[]} p segment start
 * @param {number[]} q segment end
 * @param {{x: number, y: number, w: number, h: number}} b box
 * @return {boolean} the segment runs through the box (Liang–Barsky)
 */
function crosses([x0, y0], [x1, y1], b) {
	let t0 = 0
	let t1 = 1
	const dx = x1 - x0
	const dy = y1 - y0
	for (const [p, q] of [[-dx, x0 - b.x], [dx, b.x + b.w - x0], [-dy, y0 - b.y], [dy, b.y + b.h - y0]]) {
		if (p === 0) {
			if (q < 0) return false
		} else {
			const r = q / p
			if (p < 0) t0 = Math.max(t0, r)
			else t1 = Math.min(t1, r)
		}
	}
	return t0 < t1
}

const strip = (it) => {
	const c = structuredClone(it)
	delete c.data.tags
	delete c.data.react
	delete c.group
	delete c.lock
	return c
}

describe('measurement sets (job 214)', () => {
	test('the list of sets, the same in run.mjs (its container cannot import sets.js)', () => {
		assert.deepEqual(MEASURE_SETS, ['m1', 'noconn', 'm2notes', 'm2diagrams', 'mdnotes'])
		const run = readFileSync(new URL('../../../dev/scene-lab/run.mjs', import.meta.url), 'utf8')
		assert.equal(/^const SETS = (\[.*\])$/m.exec(run)?.[1], JSON.stringify(MEASURE_SETS).replaceAll('"', "'").replaceAll(',', ', '))
		assert.throws(() => generateSet('m3'), /unknown set m3/)
		assert.deepEqual(generateSet('m1'), generateScene())
	})

	describe('m2notes (AK1)', () => {
		const { items, meta } = generateSet('m2notes')
		const m1 = generateScene()

		test('deterministic, and every m1 item is there unchanged apart from the additions', () => {
			assert.deepEqual(generateSet('m2notes'), { items, meta })
			assert.equal(items.length, m1.items.length)
			items.forEach((it, i) => assert.deepEqual(strip(it), m1.items[i], it.id))
			assert.deepEqual(meta.counts, m1.meta.counts)
		})

		test('12 tags, every second note with 1–3, 100 groups of 3–6 neighbours, 300 locked, 300 with reactions; grid on', () => {
			assert.equal(tagsOf({ tags: meta.tags }).length, 12)
			const tagIds = new Set(meta.tags.map((t) => t.id))
			const notes = items.filter((it) => it.t === 'sticky')
			notes.forEach((n, i) => {
				if (i % 2 === 1) return assert.equal(n.data.tags, undefined)
				assert.ok(n.data.tags.length >= 1 && n.data.tags.length <= 3 && n.data.tags.every((t) => tagIds.has(t)), n.id)
			})
			const groups = Map.groupBy(items.filter((it) => it.group), (it) => it.group)
			assert.equal(groups.size, 100)
			for (const members of groups.values()) {
				assert.ok(members.length >= 3 && members.length <= 6)
				assert.ok(members.every((m) => m.t === 'sticky' && m.parent === members[0].parent && m.parent !== null && m.parent !== meta.denseFrameId))
			}
			const locked = items.filter((it) => it.lock)
			assert.equal(locked.length, 300)
			assert.ok(locked.every((it) => (it.t === 'sticky' || it.t === 'shape') && !it.group))
			assert.equal(notes.filter((n) => n.data.react).length, 300)
			assert.deepEqual(items.flatMap((it) => problems(it).map((p) => `${it.id} ${p}`)).filter((p) => !/unknown type/.test(p)), [])
			assert.equal(meta.grid, true)
			assert.deepEqual(meta.extras, { tags: 12, tagged: 1500, groups: 100, grouped: [...groups.values()].flat().length, locked: 300, reacted: 300 })
		})

		test('the notes the measurement drags and the hub stay unlocked and ungrouped', () => {
			const byId = new Map(items.map((it) => [it.id, it]))
			const free = [...meta.centerNoteIds, meta.hubNoteId, ...meta.hubConnectorIds.map((c) => byId.get(c).data.end.item)]
			for (const id of free) assert.ok(!byId.get(id).lock && !byId.get(id).group, id)
		})
	})

	describe('m2diagrams (AK2)', () => {
		const { items, meta } = generateSet('m2diagrams')
		const model = new SceneModel()
		model.load(items)
		const C = DIAGRAM_COUNTS
		const byId = new Map(items.map((it) => [it.id, it]))
		const pools = meta.poolIds.map((id) => byId.get(id))
		const flows = meta.flowFrameIds.map((id) => byId.get(id))
		const childrenOf = (id) => items.filter((it) => it.parent === id)
		const connectorsIn = (id) => {
			const kids = new Set(childrenOf(id).map((it) => it.id))
			return items.filter((it) => it.t === 'connector' && kids.has(it.data.start.item) && kids.has(it.data.end.item))
		}

		test('deterministic, 4000–5000 items on the m1 area, every item passes the app\'s rules', () => {
			assert.deepEqual(generateSet('m2diagrams'), { items, meta })
			assert.ok(items.length >= 4000 && items.length <= 5000, String(items.length))
			assert.equal(meta.counts.total, items.length)
			assert.ok(meta.bounds.x0 >= 0 && meta.bounds.y0 >= 0 && meta.bounds.x1 <= BOARD.w && meta.bounds.y1 <= BOARD.h, JSON.stringify(meta.bounds))
			assert.deepEqual(items.flatMap((it) => problems(it).map((p) => `${it.id} ${p}`)), [])
			assert.equal(new Set(items.map((it) => it.id)).size, items.length)
			assert.equal(meta.grid, true)
		})

		test('pools: lanes and columns with names, 36 BPMN shapes of all four groups, 40 elbow connectors with 4 message flows', () => {
			assert.equal(pools.length, C.pools)
			const bpmn = new Set(Object.values(BPMN_GROUPS).flat())
			for (const p of pools) {
				assert.ok(hasCols(p), p.id)
				assert.equal(orderedLanes(p.data.lanes).filter((l) => l.t).length, 4)
				assert.equal(orderedCols(p.data.cols).filter((c) => c.t).length, 3)
				const kids = childrenOf(p.id)
				assert.equal(kids.length, 36)
				assert.ok(kids.every((k) => k.t === 'shape' && bpmn.has(k.data.kind)))
				for (const g of Object.values(BPMN_GROUPS)) assert.ok(kids.some((k) => g.includes(k.data.kind)), p.id)
				const cons = connectorsIn(p.id)
				assert.equal(cons.length, 40)
				assert.ok(cons.every((c) => c.data.route === 'elbow'))
				assert.equal(cons.filter((c) => c.style.endCap === 'triangleOpen' && c.style.startCap === 'circleOpen' && c.style.dash === 'dashed').length, 4)
				// events and gateways carry a label (job 211)
				const labelled = kids.filter((k) => /^bpmn(Start|Intermediate|End|Exclusive|Parallel|Inclusive|EventGateway)/.test(k.data.kind))
				assert.ok(labelled.length > 0 && labelled.every((k) => k.data.text.length > 0))
			}
			assert.equal(pools.filter((p) => p.lock).length, C.lockedPools)
			assert.ok(!byId.get(meta.denseFrameId).lock)
		})

		test('flowcharts: 30 flowchart and basic shapes, 15 symbols with a label, 45 elbow connectors', () => {
			assert.equal(flows.length, C.flowcharts)
			for (const f of flows) {
				assert.equal(f.data.lanes, undefined)
				const kids = childrenOf(f.id)
				const symbols = kids.filter((k) => k.data.kind.startsWith('icon'))
				assert.equal(symbols.length, C.flowSymbols)
				assert.ok(symbols.every((s) => s.data.text.length > 0))
				assert.equal(kids.length - symbols.length, C.flowShapes)
				assert.equal(connectorsIn(f.id).length, C.flowConnectors)
			}
		})

		test('mind maps, tables, note pads, own shapes, notes, texts', () => {
			const mind = items.filter((it) => it.t === 'mindmap')
			assert.equal(mind.length, C.mindmaps)
			assert.ok(mind.every((m) => nodesOf(m.data).size === C.mindNodes))
			for (const layout of ['both', 'right', 'org', 'tree']) assert.equal(mind.filter((m) => m.style.layout === layout).length, 5)
			const tables = items.filter((it) => it.t === 'table')
			assert.equal(tables.length, C.tables)
			assert.ok(tables.every((t) => tableCols(t.data).length === 5 && orderedRows(t.data).length === 8))
			assert.equal(items.filter((it) => it.t === 'pad').length, C.pads)
			assert.equal(items.filter((it) => it.t === 'shape' && it.data.kind === 'image').length, C.pictures)
			const notes = items.filter((it) => it.t === 'sticky')
			assert.equal(notes.length, C.notes)
			assert.equal(notes.filter((n) => n.data.tags).length, C.notes / 2)
			assert.equal(notes.filter((n) => n.data.react).length, 100)
			assert.equal(items.filter((it) => it.t === 'text').length, C.texts)
			assert.equal(meta.tags.length, 12)
		})

		test('60 groups of 3–5 shapes of one frame; a tenth of the shapes locked', () => {
			const groups = Map.groupBy(items.filter((it) => it.group), (it) => it.group)
			assert.equal(groups.size, C.groups)
			for (const m of groups.values()) assert.ok(m.length >= 3 && m.length <= 5 && m.every((s) => s.t === 'shape' && s.parent === m[0].parent))
			const shapes = items.filter((it) => it.t === 'shape')
			assert.equal(shapes.filter((s) => s.lock).length, Math.round(shapes.length / 10))
		})

		test('every connector routes, and at least a quarter has an item on the line between its ends', () => {
			const ids = meta.connectorIds
			assert.equal(ids.filter((id) => model.geometryOf(id) !== null).length, ids.length)
			const centre = (id) => {
				const b = model.boundsOf([id])
				return [b.x + b.w / 2, b.y + b.h / 2]
			}
			let blocked = 0
			for (const id of ids) {
				const c = byId.get(id)
				const a = centre(c.data.start.item)
				const b = centre(c.data.end.item)
				const hits = model.query(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))
					.filter((e) => e.t !== 'connector' && e.t !== 'frame' && e.id !== c.data.start.item && e.id !== c.data.end.item)
					.filter((e) => crosses(a, b, model.boundsOf([e.id])))
				if (hits.length > 0) blocked++
			}
			assert.ok(blocked >= ids.length / 4, `${blocked} of ${ids.length}`)
		})

		test('the G12 hub has exactly six connectors; a press on the centre tasks and the hub hits them', () => {
			assert.equal(meta.hubConnectorIds.length, 6)
			assert.deepEqual([...model.connectorsOf([meta.hubNoteId])].sort(), meta.hubConnectorIds.slice().sort())
			assert.equal(meta.centerNoteIds.length, 8)
			for (const id of [...meta.centerNoteIds, meta.hubNoteId]) {
				const it = byId.get(id)
				assert.ok(!it.lock && !it.group, id)
				const b = model.boundsOf([id])
				assert.equal(model.hitTest(b.x + b.w / 2, b.y + b.h / 2, 4), id)
				assert.equal(model.hitTest(b.x + b.w / 2, b.y + b.h / 2, 12), id)
			}
		})
	})
})

describe('mdnotes (job 279 AK9)', () => {
	test('the m1 board item for item, every second note with Markdown', async () => {
		const { hasMarks } = await import('../../../src/model/richText.js')
		const m1 = generateSet('m1')
		const { items, meta } = generateSet('mdnotes')
		assert.deepEqual(generateSet('mdnotes'), { items, meta }, 'deterministic')
		assert.equal(items.length, m1.items.length)
		assert.deepEqual(items.map((it) => [it.id, it.t, it.x, it.y, it.w, it.h]), m1.items.map((it) => [it.id, it.t, it.x, it.y, it.w, it.h]))
		const notes = items.filter((it) => it.t === 'sticky')
		const marked = notes.filter((it) => hasMarks(it.data.text)).length
		assert.ok(notes.length >= 2000)
		assert.ok(Math.abs(marked - notes.length / 2) <= notes.length * 0.02, `${marked} of ${notes.length}`)
	})
})
