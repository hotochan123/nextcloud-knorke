/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * BPMN files (factory job 205), pure: "Save as BPMN" turns the BPMN shapes
 * of job 204, the connectors between them and the frames with lanes into
 * BPMN 2.0 XML with its layout (BPMN DI), as bpmn.io and the Camunda Modeler
 * write it; "Insert BPMN file…" turns such a file into a payload `knorke:1`
 * that BoardSession pastes like a board file (board/boardFile.js).
 *
 * Saving (bpmnXml):
 * - a BPMN shape is the element of ELEMENTS (an event with its event
 *   definition), named after its text; its Bounds are its absolute,
 *   unrotated box (2 decimals). (Job 211) The text of an event or gateway
 *   is its label below it, written with the label's box (absolute,
 *   unrotated) as its BPMNLabel. An event or gateway without a text of its
 *   own takes the text of the nearest text item at most BPMN_LABEL_GAP
 *   away (each text item once, the smallest gaps first, ties in board
 *   order), with that item's box as its BPMNLabel.
 * - a note or text item that a connector joins to an exported shape is a
 *   textAnnotation; every other item of another kind is left out.
 * - a frame with lanes that holds a BPMN shape or no child at all is a
 *   participant with a process of its own: Bounds x = frame.x + headWidth −
 *   POOL_HEAD, width = w − headWidth + POOL_HEAD (the BPMN head is 30 wide,
 *   Knorke's column with the lane names 48, job 234), its lanes are lanes with the
 *   flow nodes of laneMembers (job 208: the columns are left out, the first
 *   lane reaches over their head row). (Job 225) A lane group is a lane with
 *   the flowNodeRefs of its lanes and a childLaneSet with them (each run of
 *   a group one such lane, "Lane_<frame>_<g>", then "_2", …); with lane groups
 *   the pool starts 2 · POOL_HEAD left of the content (x = frame.x +
 *   laneHeadW − 2 · POOL_HEAD), a group and a lane without one at + POOL_HEAD,
 *   a lane in a group at + 2 · POOL_HEAD. Column groups are left out.
 *   With a pool the file is a collaboration, and
 *   the BPMN shapes outside every pool go into one more pool without a name
 *   around their hull; without one it is a single process.
 * - a connector with both ends at exported elements (an end goes from start
 *   to end, the other way when only the start has a tip): two flow nodes of
 *   one process a sequenceFlow, of two processes a messageFlow; data →
 *   activity a dataInputAssociation (a property as its target), activity →
 *   data a dataOutputAssociation; anything else (an annotation, data with an
 *   event or gateway) an association. A free end within a pool (± POOL_HIT)
 *   counts as that pool (a message flow only). Its waypoints are the route
 *   as drawn (geometryOf), else the anchor points.
 * - ids are NCNames "<Type>_<Knorke id>", their DI "<id>_di".
 *
 * Inserting (readBpmnFile): util/xmlRead.js reads the text (no entities
 * besides the predefined ones, no DOCTYPE); what the first BPMNPlane draws
 * comes in. Shapes in their DI box (10–20000), (job 211) the name of an
 * event or gateway as its label below it (data.text; the file's BPMNLabel
 * is not read), a textAnnotation is
 * a text item, a participant a frame with lanes (x − 18, w + 18, so the
 * lane names cover the BPMN head), its innermost lanes its lanes (at most
 * LANES_MAX, each at least LANE_MIN_H); (job 225) a lane at the top of the
 * pool with lanes below it a lane group with its innermost lanes (the frame
 * then at x − (LANE_GROUP_W + LANE_HEAD_W − 2 · POOL_HEAD), as much wider),
 * deeper levels flat; the items whose centre lies in it
 * its children. Flows become connectors with the look of FLOWS, bound to
 * the anchor nearest to their first or last waypoint, or a free end there
 * when that element did not come in. Elements Knorke has no shape for are
 * left out and counted (skipped).
 */
import { anchorPoint, anchorsFor, FLOWS } from '../model/connectors.js'
import { q } from '../model/geometry.js'
import { ulid } from '../model/ids.js'
import {
	FRAME_MAX, hasLanes, headWidth, LANE_FRAME_MIN_W, LANE_GROUP_W, LANE_HEAD_W, LANE_MIN_H, LANE_TITLE_MAX, LANES_MAX, laneBands,
	laneGroupW, laneMembers, newGroupKey, newLanes, orderedLanes,
} from '../model/lanes.js'
import { fieldValue, TYPES } from '../model/registry.js'
import { shapeLabelOf } from '../model/SceneModel.js'
import { BPMN_GROUPS } from '../model/shapes.js'
import { wrapLabel } from '../model/text.js'
import { CONNECTOR_STROKE, LINE_HEIGHT, TEXT_COLOR } from '../model/tokens.js'
import { wellFormed } from '../util/unicode.js'
import { childOf, childrenOf, readXml, walkXml } from '../util/xmlRead.js'
import { maxItemsOf } from './actions.js'
import { BPMN_FILE_EXT, BPMN_FILE_MAX_BYTES, BPMN_FILE_TYPE } from './boardFile.js'
import { utf8Bytes, validatePayload } from './clipboard.js'

/** Size, extension and Blob type of a .bpmn file (job 217: kept in boardFile.js, which the start loads). */
export { BPMN_FILE_EXT, BPMN_FILE_MAX_BYTES, BPMN_FILE_TYPE }
/** Largest gap between an event or gateway and the text item that names it (world units). */
export const BPMN_LABEL_GAP = 40
/** Width of the head of a BPMN pool and lane. */
export const POOL_HEAD = 30
/** Margin of the pool around the shapes outside every pool. */
const POOL_MARGIN = 40
/** How far a free end may lie outside a pool and still count as at it. */
const POOL_HIT = 5
/** Font size of the text item of a text annotation. */
const NOTE_FONT = 12
const SHAPE_MIN = 10
const SHAPE_MAX = 20000
const NUM_MAX = 1e7
const TEXT_MAX = 6000
const LABEL_MAX = 200

/** BPMN kind → [element, event definition]. */
const ELEMENTS = Object.freeze({
	bpmnStart: ['startEvent'],
	bpmnStartMessage: ['startEvent', 'message'],
	bpmnStartTimer: ['startEvent', 'timer'],
	bpmnIntermediate: ['intermediateThrowEvent'],
	bpmnIntermediateMessage: ['intermediateCatchEvent', 'message'],
	bpmnIntermediateTimer: ['intermediateCatchEvent', 'timer'],
	bpmnEnd: ['endEvent'],
	bpmnEndMessage: ['endEvent', 'message'],
	bpmnEndError: ['endEvent', 'error'],
	bpmnEndTerminate: ['endEvent', 'terminate'],
	bpmnTask: ['task'],
	bpmnUserTask: ['userTask'],
	bpmnServiceTask: ['serviceTask'],
	bpmnManualTask: ['manualTask'],
	bpmnScriptTask: ['scriptTask'],
	bpmnRuleTask: ['businessRuleTask'],
	bpmnSendTask: ['sendTask'],
	bpmnReceiveTask: ['receiveTask'],
	bpmnSubprocess: ['subProcess'],
	bpmnCallActivity: ['callActivity'],
	bpmnExclusive: ['exclusiveGateway'],
	bpmnParallel: ['parallelGateway'],
	bpmnInclusive: ['inclusiveGateway'],
	bpmnEventGateway: ['eventBasedGateway'],
	bpmnDataObject: ['dataObjectReference'],
	bpmnDataInput: ['dataInput'],
	bpmnDataOutput: ['dataOutput'],
	bpmnDataStore: ['dataStoreReference'],
})

/** Inserting: an event element → its kind by event definition ('' none or another). */
const INTERMEDIATE = { '': 'bpmnIntermediate', message: 'bpmnIntermediateMessage', timer: 'bpmnIntermediateTimer' }
const EVENT_KINDS = Object.freeze({
	startEvent: { '': 'bpmnStart', message: 'bpmnStartMessage', timer: 'bpmnStartTimer' },
	intermediateCatchEvent: INTERMEDIATE,
	intermediateThrowEvent: INTERMEDIATE,
	boundaryEvent: INTERMEDIATE,
	endEvent: { '': 'bpmnEnd', message: 'bpmnEndMessage', error: 'bpmnEndError', terminate: 'bpmnEndTerminate' },
})
/** Inserting: every other element Knorke has a shape for. */
const PLAIN_KINDS = Object.freeze({
	...Object.fromEntries(Object.entries(ELEMENTS).filter(([, [el, def]]) => !def && !el.endsWith('Event')).map(([k, [el]]) => [el, k])),
	transaction: 'bpmnSubprocess',
	adHocSubProcess: 'bpmnSubprocess',
	dataObject: 'bpmnDataObject',
	dataStore: 'bpmnDataStore',
})

const GROUP_OF = new Map(Object.entries({ events: 'event', tasks: 'activity', gateways: 'gateway', data: 'data' })
	.flatMap(([g, name]) => BPMN_GROUPS[g].map((k) => [k, name])))

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const q2 = (v) => q(v, 100)
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * @param {unknown} kind data.kind
 * @return {'event'|'activity'|'gateway'|'data'|null} the BPMN group of a kind
 */
export function bpmnGroup(kind) {
	return GROUP_OF.get(kind) ?? null
}

// ---------------------------------------------------------------- text

/**
 * @param {unknown} v text
 * @param {number} max most code points
 * @return {string} with "\r\n" as "\n", without the C0 controls XML 1.0 forbids (\t and \n stay), lone
 *   surrogates as U+FFFD, U+FFFE/U+FFFF dropped, cut to max code points
 */
export function cleanText(v, max) {
	if (typeof v !== 'string') return ''
	// eslint-disable-next-line no-control-regex
	const s = wellFormed(v.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0B-\x1F￾￿]/g, ''))
	let end = 0
	for (let n = 0; n < max && end < s.length; n++) end += s.codePointAt(end) > 0xffff ? 2 : 1
	return s.slice(0, end)
}

/** @param {string} s text @return {string} escaped as character data */
const esc = (s) => cleanText(s, Infinity).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** @param {string} s text @return {string} escaped as a value in double quotes */
const escAttr = (s) => esc(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')
/** @param {number} v number @return {string} with 2 decimals at most */
const num = (v) => String(q2(v))

// ---------------------------------------------------------------- saving

/**
 * @param {{x: number, y: number, w: number, h: number}} a box
 * @param {{x: number, y: number, w: number, h: number}} b box
 * @return {number} the gap between them (0 when they touch or overlap)
 */
function gap(a, b) {
	const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
	const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
	return Math.hypot(dx, dy)
}

/**
 * @param {Array<{x: number, y: number, w: number, h: number}>} boxes boxes
 * @return {{x: number, y: number, w: number, h: number}} their hull
 */
function hullOf(boxes) {
	let x0 = Infinity
	let y0 = Infinity
	let x1 = -Infinity
	let y1 = -Infinity
	for (const b of boxes) {
		x0 = Math.min(x0, b.x)
		y0 = Math.min(y0, b.y)
		x1 = Math.max(x1, b.x + b.w)
		y1 = Math.max(y1, b.y + b.h)
	}
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * @param {object} model SceneModel
 * @param {string} id connector
 * @return {number[]|null} the waypoints [x0, y0, x1, y1, …] as drawn, else the anchor points of its ends
 */
function waypoints(model, id) {
	const g = typeof model.geometryOf === 'function' ? model.geometryOf(id) : null
	const pts = g ? (g.kind === 'bezier' ? g.hitPts : g.points) : null
	if (Array.isArray(pts) && pts.length >= 4) return pts
	const it = model.get(id)
	const out = []
	for (const which of ['start', 'end']) {
		const ep = fieldValue(it, 'data.' + which)
		const p = anchorPoint(typeof ep?.item === 'string' ? model.abs(ep.item) : null, ep)
		if (!p) return null
		out.push(p.x, p.y)
	}
	return out
}

/**
 * The BPMN 2.0 XML of the items (see the file comment).
 *
 * @param {object} model SceneModel (get, has, abs, childrenOf, geometryOf)
 * @param {Iterable<string>} ids the items to save, in board order (scene/exportImage.js exportIds)
 * @return {string|null} the file's text; null when no BPMN shape is among them
 */
export function bpmnXml(model, ids) {
	const list = [...ids].filter((id) => model.has(id))
	const set = new Set(list)
	const boxOf = (id) => {
		const a = model.abs(id)
		return { x: a.x, y: a.y, w: a.w, h: a.h }
	}
	const nodes = new Map()
	for (const id of list) {
		const it = model.get(id)
		const kind = it.t === 'shape' ? fieldValue(it, 'data.kind') : null
		if (!hasOwn(ELEMENTS, kind)) continue
		const [el, def] = ELEMENTS[kind]
		const group = bpmnGroup(kind)
		const type = group === 'event' ? 'Event' : group === 'activity' ? 'Activity' : group === 'gateway' ? 'Gateway' : el[0].toUpperCase() + el.slice(1)
		const box = boxOf(id)
		// job 211: an event's or gateway's own label, where Knorke draws it
		const l = group === 'event' || group === 'gateway' ? shapeLabelOf(it, box) : null
		nodes.set(id, {
			id, kind, el, def, group, xid: type + '_' + id, box, name: String(fieldValue(it, 'data.text') ?? ''),
			label: l ? { x: box.x + l.x, y: box.y + l.y, w: l.w, h: l.h } : null, proc: null, incoming: [], outgoing: [], inputs: [], outputs: [],
		})
	}
	if (nodes.size === 0) return null

	// pools: frames with lanes that hold a BPMN shape or nothing at all
	const pools = []
	for (const id of list) {
		const it = model.get(id)
		if (!hasLanes(it)) continue
		const kids = (model.childrenOf(id) ?? []).filter((k) => model.has(k))
		if (kids.length > 0 && !kids.some((k) => nodes.has(k))) continue
		const f = boxOf(id)
		// job 225: the cell of the lane groups, a second level of lanes in the file
		const gw = laneGroupW(it, f.w)
		const head = gw + headWidth(f.w - gw)
		const depth = gw > 0 ? 2 : 1
		// job 208: a .bpmn file ignores the columns: the first lane reaches over their head row to the top
		const bands = laneBands(it, f.h).map((b, i) => (i === 0 && b.y > 0 ? { ...b, y: 0, h: b.h + b.y } : b))
		pools.push({
			id, frame: f, name: String(fieldValue(it, 'data.title') ?? ''), xid: 'Process_' + id, part: 'Participant_' + id,
			box: { x: f.x + head - depth * POOL_HEAD, y: f.y, w: f.w - head + depth * POOL_HEAD, h: f.h },
			bands, units: laneUnitsOf(bands, it.data.lgroups, id),
			members: laneMembers(model, id), parts: [], flows: [], artifacts: [],
		})
	}
	const poolOf = new Map(pools.map((p) => [p.id, p]))
	// job 285: the same fields as a pool (no lanes), so the loops over units and members run empty
	const looseOf = (xid, part) => ({ id: null, name: '', xid, part, box: null, bands: [], units: [], members: new Map(), parts: [], flows: [], artifacts: [] })
	const loose = pools.length === 0 ? looseOf('Process_1', null) : looseOf('Process_0', 'Participant_0')
	for (const n of nodes.values()) {
		n.proc = poolOf.get(model.get(n.id).parent) ?? loose
		n.proc.parts.push(n)
	}

	const conns = list.filter((id) => model.get(id).t === 'connector')
	const itemEnd = (c, which) => {
		const ep = fieldValue(model.get(c), 'data.' + which)
		return typeof ep?.item === 'string' ? ep.item : null
	}
	// annotations: notes and text items joined to an exported shape
	const annotations = new Map()
	for (const c of conns) {
		const a = itemEnd(c, 'start')
		const b = itemEnd(c, 'end')
		for (const [x, y] of [[a, b], [b, a]]) {
			const t = x !== null && set.has(x) ? model.get(x).t : null
			if ((t === 'text' || t === 'sticky') && nodes.has(y) && !annotations.has(x)) {
				const ann = { id: x, xid: 'TextAnnotation_' + x, text: String(fieldValue(model.get(x), 'data.text') ?? ''), box: boxOf(x), proc: nodes.get(y).proc }
				annotations.set(x, ann)
				ann.proc.artifacts.push(ann)
			}
		}
	}
	// names of events and gateways from the nearest text item
	const texts = list.filter((id) => model.get(id).t === 'text' && !annotations.has(id) && String(fieldValue(model.get(id), 'data.text') ?? '').trim() !== '')
	const pairs = []
	let ni = 0
	for (const n of nodes.values()) {
		ni++
		if ((n.group !== 'event' && n.group !== 'gateway') || n.name.trim() !== '') continue
		texts.forEach((tid, ti) => {
			const d = gap(n.box, boxOf(tid))
			if (d <= BPMN_LABEL_GAP) pairs.push([d, ni, ti, n, tid])
		})
	}
	pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
	const used = new Set()
	for (const [, , , n, tid] of pairs) {
		if (n.label !== null || used.has(tid)) continue
		used.add(tid)
		n.name = String(fieldValue(model.get(tid), 'data.text'))
		n.label = boxOf(tid)
	}
	// the pool around the shapes outside every pool
	if (loose.part !== null && loose.parts.length > 0) {
		const boxes = [...loose.parts.map((n) => n.box), ...loose.parts.filter((n) => n.label).map((n) => n.label), ...loose.artifacts.map((a) => a.box)]
		const h = hullOf(boxes)
		loose.box = { x: h.x - POOL_MARGIN - POOL_HEAD, y: h.y - POOL_MARGIN, w: h.w + 2 * POOL_MARGIN + POOL_HEAD, h: h.h + 2 * POOL_MARGIN }
	}
	const procs = [...pools, ...(loose.parts.length > 0 || loose.part === null ? [loose] : [])]

	// connectors
	const messages = []
	const edges = []
	const poolAt = (p) => pools.find((pl) => p.x >= pl.box.x - POOL_HIT && p.x <= pl.box.x + pl.box.w + POOL_HIT
		&& p.y >= pl.box.y - POOL_HIT && p.y <= pl.box.y + pl.box.h + POOL_HIT) ?? null
	const endOf = (c, which) => {
		const ep = fieldValue(model.get(c), 'data.' + which)
		if (typeof ep?.item === 'string') {
			if (nodes.has(ep.item)) return { node: nodes.get(ep.item) }
			if (annotations.has(ep.item)) return { ann: annotations.get(ep.item) }
			return null
		}
		const p = ep && Number.isFinite(ep.x) && Number.isFinite(ep.y) ? poolAt(ep) : null
		return p ? { pool: p } : null
	}
	const isFlowNode = (e) => e.node !== undefined && e.node.group !== 'data'
	for (const c of conns) {
		const it = model.get(c)
		let s = endOf(c, 'start')
		let t = endOf(c, 'end')
		const pts = waypoints(model, c)
		if (!s || !t || !pts) continue
		const startCap = fieldValue(it, 'style.startCap')
		const endCap = fieldValue(it, 'style.endCap')
		const reverse = endCap === 'none' && startCap !== 'none'
		let wp = []
		for (let i = 0; i + 1 < pts.length; i += 2) wp.push([pts[i], pts[i + 1]])
		if (reverse) {
			[s, t] = [t, s]
			wp = wp.reverse()
		}
		const name = String(fieldValue(it, 'data.label') ?? '')
		let xid = null
		if (isFlowNode(s) && isFlowNode(t) && s.node.proc === t.node.proc) {
			xid = 'Flow_' + c
			s.node.proc.flows.push({ xid, name, src: s.node.xid, tgt: t.node.xid })
			s.node.outgoing.push(xid)
			t.node.incoming.push(xid)
		} else if ((s.pool || isFlowNode(s)) && (t.pool || isFlowNode(t))) {
			const ps = s.pool ?? s.node.proc
			const pt = t.pool ?? t.node.proc
			if (ps === pt) continue
			xid = 'Flow_' + c
			messages.push({ xid, name, src: s.pool ? s.pool.part : s.node.xid, tgt: t.pool ? t.pool.part : t.node.xid })
		} else if (s.node?.group === 'data' && t.node?.group === 'activity') {
			xid = 'DataInputAssociation_' + c
			t.node.inputs.push({ xid, src: s.node.xid, prop: 'Property_' + c })
		} else if (s.node?.group === 'activity' && t.node?.group === 'data') {
			xid = 'DataOutputAssociation_' + c
			s.node.outputs.push({ xid, tgt: t.node.xid })
		} else if (!s.pool && !t.pool && !(s.ann && t.ann)) {
			xid = 'Association_' + c
			const a = s.ann ?? t.ann ?? null
			const sCap = reverse ? endCap : startCap
			const tCap = reverse ? startCap : endCap
			const dir = sCap !== 'none' && tCap !== 'none' ? 'Both' : tCap !== 'none' ? 'One' : 'None'
			const proc = a ? a.proc : s.node.proc
			proc.artifacts.push({ assoc: true, xid, dir, src: (s.node ?? s.ann).xid, tgt: (t.node ?? t.ann).xid })
		} else {
			continue
		}
		edges.push({ xid, wp })
	}

	// the XML
	const out = []
	const line = (depth, s) => out.push('  '.repeat(depth) + s)
	const named = (name) => name.trim() === '' ? '' : ` name="${escAttr(name)}"`
	line(0, '<?xml version="1.0" encoding="UTF-8"?>')
	line(0, '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"'
		+ ' xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1"'
		+ ' targetNamespace="http://bpmn.io/schema/bpmn" exporter="Knorke">')
	const collab = pools.length > 0
	if (collab) {
		line(1, '<bpmn:collaboration id="Collaboration_1">')
		for (const p of procs) line(2, `<bpmn:participant id="${p.part}"${named(p.name)} processRef="${p.xid}" />`)
		for (const f of messages) line(2, `<bpmn:messageFlow id="${f.xid}"${named(f.name)} sourceRef="${f.src}" targetRef="${f.tgt}" />`)
		line(1, '</bpmn:collaboration>')
	}
	for (const p of procs) {
		line(1, `<bpmn:process id="${p.xid}" isExecutable="false">`)
		const ins = p.parts.filter((n) => n.el === 'dataInput')
		const outs = p.parts.filter((n) => n.el === 'dataOutput')
		if (ins.length + outs.length > 0) {
			line(2, `<bpmn:ioSpecification id="IoSpecification_${p.xid}">`)
			for (const n of [...ins, ...outs]) line(3, `<bpmn:${n.el} id="${n.xid}"${named(n.name)} />`)
			line(3, `<bpmn:inputSet id="InputSet_${p.xid}">`)
			for (const n of ins) line(4, `<bpmn:dataInputRefs>${n.xid}</bpmn:dataInputRefs>`)
			line(3, '</bpmn:inputSet>')
			line(3, `<bpmn:outputSet id="OutputSet_${p.xid}">`)
			for (const n of outs) line(4, `<bpmn:dataOutputRefs>${n.xid}</bpmn:dataOutputRefs>`)
			line(3, '</bpmn:outputSet>')
			line(2, '</bpmn:ioSpecification>')
		}
		if (p.bands.length > 0) {
			const refs = (b, depth) => {
				for (const k of p.members.get(b.key) ?? []) {
					const n = nodes.get(k)
					if (n && n.group !== 'data') line(depth, `<bpmn:flowNodeRef>${n.xid}</bpmn:flowNodeRef>`)
				}
			}
			line(2, `<bpmn:laneSet id="LaneSet_${p.id}">`)
			for (const u of p.units) {
				// job 225: a lane group: a lane with the refs of its lanes and a childLaneSet with them
				const d = u.xid !== null ? 2 : 0
				if (u.xid !== null) {
					line(3, `<bpmn:lane id="${u.xid}"${named(u.title)}>`)
					for (const b of u.bands) refs(b, 4)
					line(4, `<bpmn:childLaneSet id="LaneSet_${u.xid.slice(5)}">`)
				}
				for (const b of u.bands) {
					line(3 + d, `<bpmn:lane id="Lane_${p.id}_${b.key}"${named(b.title)}>`)
					refs(b, 4 + d)
					line(3 + d, '</bpmn:lane>')
				}
				if (u.xid !== null) {
					line(4, '</bpmn:childLaneSet>')
					line(3, '</bpmn:lane>')
				}
			}
			line(2, '</bpmn:laneSet>')
		}
		for (const n of p.parts) {
			if (n.el === 'dataInput' || n.el === 'dataOutput') continue
			if (n.el === 'dataObjectReference') {
				line(2, `<bpmn:dataObjectReference id="${n.xid}"${named(n.name)} dataObjectRef="DataObject_${n.id}" />`)
				line(2, `<bpmn:dataObject id="DataObject_${n.id}" />`)
				continue
			}
			const body = [
				...n.incoming.map((x) => `<bpmn:incoming>${x}</bpmn:incoming>`),
				...n.outgoing.map((x) => `<bpmn:outgoing>${x}</bpmn:outgoing>`),
				...n.inputs.map((a) => `<bpmn:property id="${a.prop}" name="__targetRef_placeholder" />`),
				...n.inputs.map((a) => `<bpmn:dataInputAssociation id="${a.xid}"><bpmn:sourceRef>${a.src}</bpmn:sourceRef><bpmn:targetRef>${a.prop}</bpmn:targetRef></bpmn:dataInputAssociation>`),
				...n.outputs.map((a) => `<bpmn:dataOutputAssociation id="${a.xid}"><bpmn:targetRef>${a.tgt}</bpmn:targetRef></bpmn:dataOutputAssociation>`),
			]
			if (n.def) {
				const d = n.def[0].toUpperCase() + n.def.slice(1) + 'EventDefinition'
				body.push(`<bpmn:${n.def}EventDefinition id="${d}_${n.id}" />`)
			}
			if (body.length === 0) {
				line(2, `<bpmn:${n.el} id="${n.xid}"${named(n.name)} />`)
				continue
			}
			line(2, `<bpmn:${n.el} id="${n.xid}"${named(n.name)}>`)
			for (const b of body) line(3, b)
			line(2, `</bpmn:${n.el}>`)
		}
		for (const f of p.flows) line(2, `<bpmn:sequenceFlow id="${f.xid}"${named(f.name)} sourceRef="${f.src}" targetRef="${f.tgt}" />`)
		for (const a of p.artifacts) {
			if (a.assoc) {
				line(2, `<bpmn:association id="${a.xid}" associationDirection="${a.dir}" sourceRef="${a.src}" targetRef="${a.tgt}" />`)
			} else {
				line(2, `<bpmn:textAnnotation id="${a.xid}">`)
				line(3, `<bpmn:text>${esc(a.text)}</bpmn:text>`)
				line(2, '</bpmn:textAnnotation>')
			}
		}
		line(1, '</bpmn:process>')
	}
	const bounds = (b) => `<dc:Bounds x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" />`
	const shapeDi = (xid, b, extra = '', label = null) => {
		line(3, `<bpmndi:BPMNShape id="${xid}_di" bpmnElement="${xid}"${extra}>`)
		line(4, bounds(b))
		if (label) {
			line(4, '<bpmndi:BPMNLabel>')
			line(5, bounds(label))
			line(4, '</bpmndi:BPMNLabel>')
		}
		line(3, '</bpmndi:BPMNShape>')
	}
	line(1, '<bpmndi:BPMNDiagram id="BPMNDiagram_1">')
	line(2, `<bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${collab ? 'Collaboration_1' : 'Process_1'}">`)
	if (collab) {
		for (const p of procs) {
			shapeDi(p.part, p.box, ' isHorizontal="true"')
			for (const u of p.units) {
				// job 225: a group at + POOL_HEAD, its lanes one level in
				const d = u.xid !== null ? POOL_HEAD : 0
				if (u.xid !== null) {
					const b0 = u.bands[0]
					const h = u.bands.reduce((s, b) => s + b.h, 0)
					shapeDi(u.xid, { x: p.box.x + POOL_HEAD, y: p.frame.y + b0.y, w: p.box.w - POOL_HEAD, h }, ' isHorizontal="true"')
				}
				for (const b of u.bands) {
					shapeDi(`Lane_${p.id}_${b.key}`, { x: p.box.x + POOL_HEAD + d, y: p.frame.y + b.y, w: p.box.w - POOL_HEAD - d, h: b.h }, ' isHorizontal="true"')
				}
			}
		}
	}
	for (const n of nodes.values()) {
		shapeDi(n.xid, n.box, n.el === 'subProcess' ? ' isExpanded="false"' : '', n.label)
	}
	for (const a of annotations.values()) shapeDi(a.xid, a.box)
	for (const e of edges) {
		line(3, `<bpmndi:BPMNEdge id="${e.xid}_di" bpmnElement="${e.xid}">`)
		for (const [x, y] of e.wp) line(4, `<di:waypoint x="${num(x)}" y="${num(y)}" />`)
		line(3, '</bpmndi:BPMNEdge>')
	}
	line(2, '</bpmndi:BPMNPlane>')
	line(1, '</bpmndi:BPMNDiagram>')
	line(0, '</bpmn:definitions>')
	return out.join('\n') + '\n'
}

/**
 * (Job 225) The lanes of a pool by unit: each run of a lane group one unit
 * with the id of its lane (a group in two runs: "_2" for the second), a lane
 * without a group a unit of its own (xid null).
 *
 * @param {Array<{key: string, g: (string|null)}>} bands the lanes as written
 * @param {unknown} groups data.lgroups
 * @param {string} id the frame
 * @return {Array<{xid: (string|null), title: string, bands: object[]}>}
 */
function laneUnitsOf(bands, groups, id) {
	const out = []
	const seen = new Map()
	for (const b of bands) {
		const last = out[out.length - 1]
		if (b.g !== null && last && last.g === b.g) {
			last.bands.push(b)
			continue
		}
		if (b.g === null) {
			out.push({ g: null, xid: null, title: '', bands: [b] })
			continue
		}
		const n = (seen.get(b.g) ?? 0) + 1
		seen.set(b.g, n)
		const title = groups && typeof groups === 'object' && typeof groups[b.g] === 'string' ? groups[b.g] : ''
		out.push({ g: b.g, xid: `Lane_${id}_${b.g}` + (n > 1 ? '_' + n : ''), title, bands: [b] })
	}
	return out
}

// ---------------------------------------------------------------- inserting

/**
 * @param {import('../util/xmlRead.js').XmlNode|null} node a dc:Bounds
 * @return {{x: number, y: number, w: number, h: number}|null} its box, null without four finite numbers
 */
function boundsOf(node) {
	if (!node) return null
	const v = ['x', 'y', 'width', 'height'].map((k) => Number(node.attrs[k] ?? NaN))
	if (!v.every(Number.isFinite)) return null
	return { x: v[0], y: v[1], w: Math.max(0, v[2]), h: Math.max(0, v[3]) }
}

/**
 * @param {import('../util/xmlRead.js').XmlNode} el a BPMN element
 * @return {string|null} the kind of its shape, null when Knorke has none
 */
function kindOf(el) {
	if (hasOwn(EVENT_KINDS, el.name)) {
		const defs = el.children.filter((c) => c.name.endsWith('EventDefinition'))
		const def = defs.length === 1 ? defs[0].name.slice(0, -'EventDefinition'.length) : ''
		const table = EVENT_KINDS[el.name]
		return hasOwn(table, def) ? table[def] : table['']
	}
	return hasOwn(PLAIN_KINDS, el.name) ? PLAIN_KINDS[el.name] : null
}

/**
 * @param {string} text text
 * @param {number} w width
 * @param {number} fs font size
 * @return {number} the estimated height of a text item
 */
function textHeight(text, w, fs) {
	return Math.ceil(Math.max(1, wrapLabel(text, w, fs).length) * fs * LINE_HEIGHT)
}

/**
 * @param {number} v coordinate
 * @return {number} within ±1e7, 2 decimals
 */
const coord = (v) => q2(clampNum(v, -NUM_MAX, NUM_MAX))

/**
 * The payload of a .bpmn file (see the file comment), before validatePayload.
 *
 * @param {string} text the file's text
 * @param {() => string} newId id generator (ULIDs)
 * @param {() => number} rand random numbers (lane keys)
 * @return {{raw: object, skipped: number}|null} null when it is no BPMN file with a diagram
 */
export function bpmnPayload(text, newId = ulid, rand = Math.random) {
	const root = readXml(text)
	if (!root || root.name !== 'definitions') return null
	const byId = new Map()
	const parentOf = new Map()
	let plane = null
	walkXml(root, (node, parent) => {
		if (typeof node.attrs.id === 'string' && !byId.has(node.attrs.id)) byId.set(node.attrs.id, node)
		parentOf.set(node, parent)
		if (plane === null && node.name === 'BPMNPlane' && parent?.name === 'BPMNDiagram') plane = node
	})
	if (plane === null) return null
	let skipped = 0
	const pools = []
	const lanes = []
	const boxes = []
	const notes = []
	const edges = []
	for (const di of plane.children) {
		if (di.name === 'BPMNEdge') {
			edges.push(di)
			continue
		}
		if (di.name !== 'BPMNShape') continue
		const el = byId.get(di.attrs.bpmnElement)
		const b = boundsOf(childOf(di, 'Bounds'))
		if (!el || !b) {
			skipped++
			continue
		}
		if (el.name === 'participant') {
			pools.push({ el, b, horizontal: di.attrs.isHorizontal !== 'false', lanes: [] })
		} else if (el.name === 'lane') {
			lanes.push({ el, b })
		} else if (el.name === 'textAnnotation') {
			notes.push({ el, b })
		} else {
			const kind = kindOf(el)
			if (kind === null) {
				skipped++
			} else {
				boxes.push({ el, b, kind })
			}
		}
	}
	const items = []
	const mapped = new Map()
	// job 260: BPMN shapes keep the black border of 0.4.0 (shapes.js BPMN_STYLE)
	const shapeStyle = { ...TYPES.shape.defaults.style, stroke: TEXT_COLOR }
	const textStyle = TYPES.text.defaults.style
	const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
	const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

	// pools → frames with lanes
	const laneEls = new Set(lanes.map((l) => l.el))
	const isLeaf = (l) => {
		let leaf = true
		walkXml(l.el, (node) => {
			if (node !== l.el && node.name === 'lane' && laneEls.has(node)) leaf = false
		})
		return leaf
	}
	for (const l of lanes) {
		const p = pools.find((pl) => inside(centre(l.b), pl.b))
		if (p && p.horizontal && isLeaf(l)) p.lanes.push(l)
	}
	// job 225: the lane at the top of each nesting (no drawn lane above it in the file) is the group of the lanes below it
	const nested = new Set()
	for (const l of lanes) walkXml(l.el, (node) => { if (node !== l.el && laneEls.has(node)) nested.add(node) })
	const topOf = new Map()
	for (const l of lanes) {
		if (!nested.has(l.el)) walkXml(l.el, (node) => { if (node !== l.el && laneEls.has(node)) topOf.set(node, l.el) })
	}
	const frames = []
	for (const p of pools) {
		let list = p.lanes.sort((a, b) => a.b.y - b.b.y).map((l) => ({
			name: cleanText(l.el.attrs.name, LANE_TITLE_MAX).trim(), h: Math.max(1, l.b.h), top: topOf.get(l.el) ?? null,
		}))
		// job 225: with groups the frame's head has their cell, and the file's lanes start one POOL_HEAD further in
		const extra = list.some((l) => l.top !== null) ? LANE_GROUP_W - POOL_HEAD : 0
		const W = clampNum(p.b.w + LANE_HEAD_W - POOL_HEAD + extra, LANE_FRAME_MIN_W, FRAME_MAX)
		let H = clampNum(p.b.h, LANE_MIN_H, FRAME_MAX)
		if (list.length > LANES_MAX) {
			const rest = list.slice(LANES_MAX - 1).reduce((s, l) => s + l.h, 0)
			list = [...list.slice(0, LANES_MAX - 1), { ...list[LANES_MAX - 1], h: rest }]
		}
		if (list.length === 0) list = [{ name: '', h: H, top: null }]
		const sum = list.reduce((s, l) => s + l.h, 0)
		const hs = list.map((l) => Math.max(LANE_MIN_H, q2(l.h * H / sum)))
		const others = hs.slice(0, -1).reduce((s, h) => s + h, 0)
		hs[hs.length - 1] = Math.max(LANE_MIN_H, q2(H - others))
		H = q2(others + hs[hs.length - 1])
		const data = newLanes(H, list.map((l) => l.name), rand)
		// job 225: one group per top lane, in the order of its first lane
		const lgroups = {}
		const keyOf = new Map()
		for (const l of list) {
			if (l.top === null || keyOf.has(l.top)) continue
			const k = newGroupKey(lgroups, rand, 'g')
			lgroups[k] = cleanText(l.top.attrs.name, LANE_TITLE_MAX).trim()
			keyOf.set(l.top, k)
		}
		orderedLanes(data).forEach((l, i) => {
			data[l.key].h = hs[i]
			if (list[i].top !== null) data[l.key].g = keyOf.get(list[i].top)
		})
		const f = {
			id: newId(), t: 'frame', x: coord(p.b.x - (LANE_HEAD_W - POOL_HEAD) - extra), y: coord(p.b.y), w: q2(W), h: H, r: 0, parent: null,
			data: { title: cleanText(p.el.attrs.name, TYPES.frame.fields['data.title'][1]).trim(), lanes: data, ...(keyOf.size > 0 ? { lgroups } : {}) },
			style: { fill: TYPES.frame.defaults.style.fill }, group: null,
		}
		frames.push(f)
		items.push(f)
	}
	/** The frame whose box holds the centre of an absolute box (the smallest), its item placed in it. */
	const place = (it) => {
		const c = centre(it)
		let best = null
		for (const f of frames) {
			if (inside(c, f) && (best === null || f.w * f.h < best.w * best.h)) best = f
		}
		if (best !== null) {
			it.parent = best.id
			it.x = q2(it.x - best.x)
			it.y = q2(it.y - best.y)
		}
		return it
	}

	// shapes, then the text items of annotations
	const texts = []
	const textItem = (x, y, w, text, fontSize, align) => ({
		id: newId(), t: 'text', x: coord(x), y: coord(y), w: q2(w), h: textHeight(text, w, fontSize), r: 0, parent: null,
		data: { text }, style: { ...textStyle, fontSize, align }, group: null,
	})
	for (const s of boxes) {
		const w = q2(clampNum(s.b.w, SHAPE_MIN, SHAPE_MAX))
		const h = q2(clampNum(s.b.h, SHAPE_MIN, SHAPE_MAX))
		// job 211: the name of an event or gateway is its label below it
		const it = {
			id: newId(), t: 'shape', x: coord(s.b.x), y: coord(s.b.y), w, h, r: 0, parent: null,
			data: { kind: s.kind, text: cleanText(s.el.attrs.name, TEXT_MAX) }, style: { ...shapeStyle }, group: null,
		}
		mapped.set(s.el.attrs.id, { id: it.id, t: 'shape', kind: s.kind, box: { x: it.x, y: it.y, w, h } })
		items.push(it)
	}
	for (const n of notes) {
		const text = cleanText(childOf(n.el, 'text')?.text ?? '', TEXT_MAX).trim()
		const w = clampNum(n.b.w, 40, SHAPE_MAX)
		const it = textItem(n.b.x, n.b.y, w, text, NOTE_FONT, 'left')
		mapped.set(n.el.attrs.id, { id: it.id, t: 'text', kind: null, box: { x: it.x, y: it.y, w: it.w, h: it.h } })
		texts.push(it)
	}

	// flows → connectors
	const conns = []
	const dotted = (start, end) => ({ 'style.dash': 'dotted', 'style.startCap': start, 'style.endCap': end })
	const refText = (el, name) => childOf(el, name)?.text.trim() ?? ''
	const endAt = (ref, [px, py]) => {
		const m = mapped.get(ref)
		if (!m) return { x: coord(px), y: coord(py) }
		let best = null
		for (const [ax, ay] of anchorsFor(m.t, m.kind)) {
			const d = Math.hypot(m.box.x + ax * m.box.w - px, m.box.y + ay * m.box.h - py)
			if (best === null || d < best.d) best = { d, ax, ay }
		}
		return { item: m.id, ax: best.ax, ay: best.ay }
	}
	for (const di of edges) {
		const el = byId.get(di.attrs.bpmnElement)
		const pts = childrenOf(di, 'waypoint').map((w) => [Number(w.attrs.x), Number(w.attrs.y)]).filter((p) => p.every(Number.isFinite))
		if (!el || pts.length < 2) {
			skipped++
			continue
		}
		let src
		let tgt
		let look
		if (el.name === 'sequenceFlow' || el.name === 'messageFlow') {
			src = el.attrs.sourceRef
			tgt = el.attrs.targetRef
			look = el.name === 'sequenceFlow' ? FLOWS.sequence : FLOWS.message
		} else if (el.name === 'association') {
			const dir = el.attrs.associationDirection
			src = el.attrs.sourceRef
			tgt = el.attrs.targetRef
			look = dotted(dir === 'Both' ? 'arrow' : 'none', dir === 'One' || dir === 'Both' ? 'arrow' : 'none')
		} else if (el.name === 'dataInputAssociation' || el.name === 'dataOutputAssociation') {
			const owner = parentOf.get(el)?.attrs.id
			src = el.name === 'dataInputAssociation' ? refText(el, 'sourceRef') : owner
			tgt = el.name === 'dataInputAssociation' ? owner : refText(el, 'targetRef')
			look = dotted('none', 'arrow')
		} else {
			skipped++
			continue
		}
		const a = pts[0]
		const b = pts[pts.length - 1]
		const straight = pts.length === 2 && Math.abs(b[0] - a[0]) > 1 && Math.abs(b[1] - a[1]) > 1
		const data = { start: endAt(src, a), end: endAt(tgt, b), route: straight ? 'straight' : 'elbow' }
		const label = cleanText(el.attrs.name, LABEL_MAX).trim()
		if (label !== '') data.label = label
		conns.push({
			id: newId(), t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, parent: null, data,
			style: { stroke: CONNECTOR_STROKE, strokeWidth: 2, dash: look['style.dash'], startCap: look['style.startCap'], endCap: look['style.endCap'] },
			group: null,
		})
	}
	const placed = [...items.slice(frames.length), ...texts]
	items.push(...texts, ...conns)
	if (items.length === 0) return null
	const roots = [...frames, ...placed]
	const hull = roots.length > 0 ? hullOf(roots) : { x: 0, y: 0 }
	const origin = [hull.x, hull.y]
	placed.forEach(place)
	return { raw: { knorke: 1, board: null, origin, items }, skipped }
}

/**
 * @param {string} text text
 * @return {boolean} more than BPMN_FILE_MAX_BYTES as UTF-8
 */
function tooLarge(text) {
	if (text.length > BPMN_FILE_MAX_BYTES) return true
	return text.length * 3 > BPMN_FILE_MAX_BYTES && utf8Bytes(text) > BPMN_FILE_MAX_BYTES
}

/**
 * Reads a .bpmn file for inserting (see the file comment), like
 * boardFile.js readBoardFile.
 *
 * @param {unknown} text the file's text (anything but a string is invalid)
 * @param {{size?: number, limits?: (object|null)}} [o] size: items on the board now; limits: the initial state's
 * @param {() => string} [newId] id generator
 * @param {() => number} [rand] random numbers
 * @return {{ok: true, payload: object, title: string, skipped: number}|{ok: false, reason: 'invalid'}|{ok: false, reason: 'full', max: number}}
 */
export function readBpmnFile(text, { size = 0, limits = null } = {}, newId = ulid, rand = Math.random) {
	const invalid = { ok: false, reason: 'invalid' }
	if (typeof text !== 'string' || tooLarge(text)) return invalid
	const r = bpmnPayload(text, newId, rand)
	if (r === null) return invalid
	const v = validatePayload(r.raw, { maxItems: Infinity, maxBytes: BPMN_FILE_MAX_BYTES })
	if (!v.ok || v.payload.items.length === 0) return invalid
	const max = maxItemsOf(limits)
	if (size + v.payload.items.length > max) return { ok: false, reason: 'full', max }
	return { ok: true, payload: { ...v.payload, board: null }, title: '', skipped: r.skipped + v.skipped }
}
