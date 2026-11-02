/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The preview of an AI diagram (factory job 268, AiDiagramDialog.vue): the
 * tree as the mind map "Insert" would put (actions.outlineOfTree,
 * mindmapFromOutline, mindmapLayout with estimateNodeSize), reduced to boxes
 * and lines for a small SVG. Texts are the first line of a node, cut to
 * LABEL_MAX characters; the dialog shows them as SVG text, never as markup.
 * Lines: from the middle of the parent to the middle of the child; in an
 * org chart right-angled (down, across, down) from the bottom of the parent
 * to the top of the child.
 * (Job 269) A flowchart (shape flowchart, the result {nodes, edges}):
 * flowPreview, the boxes of aiFlow.js flowLayout with their outlines (d),
 * right-angled arrows with tips and their labels.
 * (Job 276) A workshop (shape workshop, the result {parts}):
 * workshopPreview, one frame per part with its title at the top and a
 * small square for the note, WS_ROW frames per row.
 */
import { outlineOfTree } from '../board/actions.js'
import { flowLayout, GAP_Y } from '../board/aiFlow.js'
import { WS_FILLS, workshopParts } from '../board/aiWorkshop.js'
import { mindmapFromOutline, mindmapLayout } from '../model/mindmap.js'

/** Characters of a node's label in the preview. */
export const LABEL_MAX = 24

/**
 * @param {string} text node text
 * @return {string} its first line, at most LABEL_MAX characters (else cut with …)
 */
export function previewLabel(text) {
	const first = String(text ?? '').split('\n')[0].trim()
	const chars = [...first]
	return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX - 1).join('') + '…' : first
}

/**
 * @param {unknown} tree {text, children} (route 59); (job 269) a flowchart's {nodes, edges}
 * @param {string} shape mindmap | org | tree | flowchart
 * @return {{w: number, h: number, boxes: object[], lines: string[]}|null} world units from 0/0; null: no tree
 */
export function aiPreview(tree, shape) {
	if (shape === 'flowchart') return flowPreview(tree)
	if (shape === 'workshop') return workshopPreview(tree)
	const outline = outlineOfTree(tree)
	if (!outline) return null
	const { data } = mindmapFromOutline(outline, { rand: seeded() })
	const style = shape === 'org' || shape === 'tree' ? { layout: shape } : {}
	const l = mindmapLayout({ t: 'mindmap', data, style })
	const byKey = new Map(l.nodes.map((nd) => [nd.key, nd]))
	const boxes = l.nodes.map((nd) => ({
		key: nd.key, x: nd.x, y: nd.y, w: nd.w, h: nd.h, root: nd.key === l.root,
		stroke: nd.border ?? nd.color ?? '#3d4044', fill: nd.fill ?? '#ffffff', label: previewLabel(nd.text),
	}))
	const lines = []
	for (const nd of l.nodes) {
		const p = nd.parent === null || nd.parent === undefined ? null : byKey.get(nd.parent)
		if (!p) continue
		if (shape === 'org') {
			const x1 = p.x + p.w / 2
			const y1 = p.y + p.h
			const x2 = nd.x + nd.w / 2
			const mid = (y1 + nd.y) / 2
			lines.push(`M${r(x1)} ${r(y1)}V${r(mid)}H${r(x2)}V${r(nd.y)}`)
		} else {
			lines.push(`M${r(p.x + p.w / 2)} ${r(p.y + p.h / 2)}L${r(nd.x + nd.w / 2)} ${r(nd.y + nd.h / 2)}`)
		}
	}
	return { w: l.w, h: l.h, boxes, lines }
}

/** @param {number} v @return {number} rounded to 0.1 */
function r(v) {
	return Math.round(v * 10) / 10
}

/** @return {() => number} fixed random numbers (the preview's keys need not be random) */
function seeded() {
	let s = 7
	return () => {
		s = (s * 16807) % 2147483647
		return s / 2147483647
	}
}

/** (Job 269) Room right of the boxes for each back arrow of a flowchart preview. */
const BACK_STEP = 14

/**
 * (Job 269) The outline of a flowchart box as an SVG path (the preview's
 * simple forms: rectangle, pill, diamond, parallelogram, wavy-bottomed
 * document).
 *
 * @param {string} kind shape kind (aiFlow.js FLOW_SHAPES)
 * @param {number} x left
 * @param {number} y top
 * @param {number} w width
 * @param {number} h height
 * @return {string} path data
 */
export function flowOutline(kind, x, y, w, h) {
	const [X, Y, W, H] = [r(x), r(y), r(w), r(h)]
	if (kind === 'terminal') {
		const rr = r(h / 2)
		return `M${r(x + rr)} ${Y}H${r(x + w - rr)}A${rr} ${rr} 0 0 1 ${r(x + w - rr)} ${r(y + h)}H${r(x + rr)}A${rr} ${rr} 0 0 1 ${r(x + rr)} ${Y}Z`
	}
	if (kind === 'diamond') return `M${r(x + w / 2)} ${Y}L${r(x + w)} ${r(y + h / 2)}L${r(x + w / 2)} ${r(y + h)}L${X} ${r(y + h / 2)}Z`
	if (kind === 'parallelogram') return `M${r(x + w * 0.2)} ${Y}H${r(x + w)}L${r(x + w * 0.8)} ${r(y + h)}H${X}Z`
	if (kind === 'document') return `M${X} ${Y}H${r(x + w)}V${r(y + h * 0.85)}Q${r(x + w * 0.75)} ${r(y + h * 0.7)} ${r(x + w / 2)} ${r(y + h * 0.85)}T${X} ${r(y + h * 0.85)}Z`
	return `M${X} ${Y}h${W}v${H}h${-W}Z`
}

/**
 * (Job 269) The preview of a flowchart: the boxes of flowLayout with their
 * outlines, the arrows right-angled (forward: down, across, down into the
 * top middle; back: out of the right side, around the right of all boxes,
 * into the right side of the target) with a tip, each label as text at the
 * start of its line.
 *
 * @param {unknown} flow {nodes, edges} (route 59)
 * @return {{w: number, h: number, boxes: object[], lines: string[], labels: object[], arrows: true}|null} from 0/0; null: no flow
 */
export function flowPreview(flow) {
	const l = flowLayout(flow)
	if (!l) return null
	const dx = -l.x
	const boxes = l.nodes.map((nd, i) => ({
		key: 'n' + i, x: nd.x + dx, y: nd.y, w: nd.w, h: nd.h, root: false, stroke: '#3d4044', fill: '#ffffff',
		label: previewLabel(nd.text), d: flowOutline(nd.kind, nd.x + dx, nd.y, nd.w, nd.h),
	}))
	const lines = []
	const labels = []
	let lane = l.w
	for (const e of l.edges) {
		const a = boxes[e.from]
		const b = boxes[e.to]
		const label = e.label === '' ? '' : previewLabel(e.label)
		if (e.back) {
			lane += BACK_STEP
			const y1 = a.y + a.h / 2
			const y2 = b.y + b.h / 2
			lines.push(`M${r(a.x + a.w)} ${r(y1)}H${r(lane)}V${r(y2)}H${r(b.x + b.w)}`)
			if (label) labels.push({ x: r(a.x + a.w + 4), y: r(y1 - 4), text: label })
		} else {
			const x1 = a.x + a.w / 2
			const y1 = a.y + a.h
			const mid = b.y - GAP_Y / 2
			lines.push(`M${r(x1)} ${r(y1)}V${r(mid)}H${r(b.x + b.w / 2)}V${r(b.y)}`)
			if (label) labels.push({ x: r(x1 + 4), y: r(y1 + 14), text: label })
		}
	}
	return { w: lane, h: l.h, boxes, lines, labels, arrows: true }
}

/** (Job 276) Frames of a workshop preview per row, their size, gap, note square. */
const WS_ROW = 4
const WS_W = 200
const WS_H = 150
const WS_GAP = 24
const WS_NOTE = 56

/**
 * (Job 276) The preview of a workshop: one frame per part in rows of
 * WS_ROW (reading order = the order of the parts), the title (with its
 * minutes) at the top, a coloured square for the note of a part with a
 * question. frames = the count of frames (the dialog's label).
 *
 * @param {unknown} ws {parts} (route 59)
 * @return {{w: number, h: number, boxes: object[], lines: string[], frames: number}|null} from 0/0; null: no workshop
 */
export function workshopPreview(ws) {
	const parts = workshopParts(ws)
	if (!parts) return null
	const boxes = []
	parts.forEach((p, i) => {
		const x = (i % WS_ROW) * (WS_W + WS_GAP)
		const y = Math.floor(i / WS_ROW) * (WS_H + WS_GAP)
		boxes.push({ key: 'f' + i, x, y, w: WS_W, h: WS_H, root: false, stroke: '#3d4044', fill: '#ffffff', label: previewLabel(p.title), ty: y + 22 })
		if (p.question !== '') {
			boxes.push({ key: 'n' + i, x: x + 16, y: y + 48, w: WS_NOTE, h: WS_NOTE, root: false, stroke: 'none', fill: WS_FILLS[i % WS_FILLS.length], label: '' })
		}
	})
	const cols = Math.min(parts.length, WS_ROW)
	const rows = Math.ceil(parts.length / WS_ROW)
	return { w: cols * WS_W + (cols - 1) * WS_GAP, h: rows * WS_H + (rows - 1) * WS_GAP, boxes, lines: [], frames: parts.length }
}
