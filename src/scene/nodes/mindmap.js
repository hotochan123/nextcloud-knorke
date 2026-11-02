/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Mind map node (factory job 195): Konva only, no DOM per node. The layout
 * comes from model/mindmap.js mindmapLayout with ctx.measureNode (the
 * renderer's text measurement) or estimateNodeSize, never from the stored
 * w and h, so a branch that grew is drawn whole even while the box lags.
 *
 * - ONE Konva.Shape (lines) paints, in this order, every branch as a cubic
 *   curve from its parent's attach point (the root: the middle of its edge
 *   on that side) to the inner end of the child, in the branch colour and
 *   width; the line under every node of shape line; the boxes (rect,
 *   roundRect, pill) on MM_FILL with a MM_BORDER_W border in the branch
 *   colour (the root: its border colour); the dot of every folded branch,
 *   filled in its colour, at level 0 with the number of hidden nodes in
 *   white (from 100 on "99+").
 * - at level 0 one Konva.Text per node with text, TEXT_COLOR, MM_FONT (the
 *   root MM_ROOT_FONT bold), left on a line, centred in a box. Level 1
 *   (below LOD_TEXT_SCALE) has no text; LOD 2 paints a box (coarse.js).
 * - ONE Konva.Shape (ui) on top, only what this tab shows: the outline of
 *   the focused node (SELECTION_COLOR, 2 screen px) and the hollow dots of
 *   the unfolded branches while the mind map is selected (ui.dots) or the
 *   pointer is over that node (ui.hover). setUi(entry, ui) sets them; an
 *   image (renderImage) has none.
 *
 * Job 198, layouts org and tree: every branch is a right-angled line in
 * the colour of the parent (from the root in its border colour): in org
 * down from the middle of the parent's bottom edge to MM_ORG_GAP_Y / 2
 * above the child's row, across, down to the middle of its top edge; in
 * tree right from the parent's right edge to MM_GAP_X / 2 beyond it, up or
 * down, right to the child's left edge. In org a card has a band of
 * MM_CARD_BAND in its colour along its top, cut to its shape, and two texts
 * at level 0: its name bold, its role (the rest of its text) below.
 *
 * Job 266 (design round 4, M3 and O1): see paintMindmap; branches taper,
 * main branches are pills on their light tone, a folded branch shows its
 * "+n" badge instead of the dot; org and tree draw every node as a white
 * card with a dark border and its band (tree: on the left), the role in
 * MM_ROLE_FONT grey, the lines dark with round bends.
 *
 * The entry keeps its layout (entry.layout). textHidden is the node whose
 * editor is open (its key), or false.
 */
import {
	MM_BADGE_FONT, MM_BORDER_W, MM_BRANCH_W, MM_CARD_BAND, MM_DOT_R, MM_GAP_X, MM_LINE_BEND, MM_ORG_GAP_Y, MM_RADIUS,
	MM_ROLE_FONT, MM_ROOT_RADIUS, MM_TAPER, estimateNodeSize, isBoxLayout, mindmapLayout, rootAttach,
} from '../../model/mindmap.js'
import { FONT_FAMILY, LINE_HEIGHT, MM_FILL, MM_INK_BORDER, MM_ROLE_COLOR, SELECTION_COLOR, TEXT_COLOR } from '../../model/tokens.js'
import { SHAPE_BASE, makeGroup, place } from './common.js'

/** Segments of a tapering branch (job 266). */
export const MM_TAPER_STEPS = 24
/** Outline of the focused node: screen px, and its distance to the node (world units). */
const FOCUS_PX = 2
const FOCUS_GAP = 3

/**
 * Konva text attributes of a node's text (also used to measure it, KonvaRenderer.measureNodeText).
 *
 * @param {string} text text
 * @param {number} width wrap width
 * @param {number} size font size
 * @param {boolean} bold bold (the root)
 * @return {object}
 */
export function nodeTextAttrs(text, width, size, bold) {
	return {
		text,
		width: Math.max(1, width),
		fontSize: size,
		fontFamily: FONT_FAMILY,
		fontStyle: bold ? 'bold' : 'normal',
		lineHeight: LINE_HEIGHT,
		wrap: 'word',
		padding: 0,
	}
}

/**
 * The mark of a node drag's drop target (KonvaRenderer.setNodeDragPreview,
 * world units): the outline of the new parent ('child'), else a bar on the
 * top or bottom edge of the node it goes before or after; (job 198 round
 * 6) with beside (org) on its left or right edge, where the node lands.
 *
 * @param {{x:number, y:number, w:number, h:number, where: string, beside?: boolean}} t target
 * @return {{x:number, y:number, width:number, height:number, bar: boolean}} bar: filled
 */
export function dropMark(t) {
	if (t.where === 'child') return { x: t.x - 3, y: t.y - 3, width: t.w + 6, height: t.h + 6, bar: false }
	if (t.beside) return { x: t.where === 'before' ? t.x - 2 : t.x + t.w + 1, y: t.y, width: 1, height: t.h, bar: true }
	return { x: t.x, y: t.where === 'before' ? t.y - 2 : t.y + t.h + 1, width: t.w, height: 1, bar: true }
}

/**
 * @param {object} ctx builder context
 * @return {Function} the text size of a node (mindmapLayout's measure)
 */
function measureOf(ctx) {
	return typeof ctx.measureNode === 'function'
		? (text, maxW, size, bold) => {
			const m = ctx.measureNode(text, maxW, size, bold)
			return m && Number.isFinite(m.w) && Number.isFinite(m.h) ? m : estimateNodeSize(text, maxW, size, bold)
		}
		: estimateNodeSize
}

/**
 * @param {object} c 2D context
 * @param {number} x left
 * @param {number} y top
 * @param {number} w width
 * @param {number} h height
 * @param {number} r corner radius
 */
function roundRect(c, x, y, w, h, r) {
	const k = Math.max(0, Math.min(r, w / 2, h / 2))
	c.moveTo(x + k, y)
	c.lineTo(x + w - k, y)
	c.arcTo(x + w, y, x + w, y + k, k)
	c.lineTo(x + w, y + h - k)
	c.arcTo(x + w, y + h, x + w - k, y + h, k)
	c.lineTo(x + k, y + h)
	c.arcTo(x, y + h, x, y + h - k, k)
	c.lineTo(x, y + k)
	c.arcTo(x, y, x + k, y, k)
	c.closePath()
}

/**
 * The branches of a layout: one per visible node below the root.
 *
 * @param {object} l layout
 * @return {Array<{key: string, depth: number, from: {x: number, y: number}, to: {x: number, y: number}, color: string,
 *   width: number, points: (number[]|null)}>} points (job 198, org and tree): the corners of the right-angled line,
 *   from to to; (job 266) those lines in MM_INK_BORDER, MM_BRANCH_W wide
 */
export function branchesOf(l) {
	const out = []
	for (const n of l.nodes) {
		if (n.parent === null) continue
		const p = l.byKey.get(n.parent)
		if (!p || !n.inner) continue
		const from = p.parent === null && l.layout !== 'org' ? rootAttach(p, n.side) : p.attach
		const to = n.inner
		if (l.layout === 'org') {
			const y = to.y - MM_ORG_GAP_Y / 2
			out.push({ key: n.key, depth: n.depth, from, to, color: MM_INK_BORDER, width: MM_BRANCH_W, points: [from.x, from.y, from.x, y, to.x, y, to.x, to.y] })
		} else if (isBoxLayout(l.layout)) {
			const x = from.x + MM_GAP_X / 2
			out.push({ key: n.key, depth: n.depth, from, to, color: MM_INK_BORDER, width: MM_BRANCH_W, points: [from.x, from.y, x, from.y, x, to.y, to.x, to.y] })
		} else {
			out.push({ key: n.key, depth: n.depth, from, to, color: n.color, width: n.width, points: null })
		}
	}
	return out
}

/**
 * @param {number} depth depth of the child a branch leads to
 * @return {number[]} (job 266) its width at the start and at the end (MM_TAPER)
 */
export function taperOf(depth) {
	return MM_TAPER[Math.max(0, Math.min(MM_TAPER.length, depth) - 1)]
}

/**
 * (Job 266, M3) The outline of a tapering branch: the S curve of before (a
 * cubic from from to to, its control points halfway across at the height
 * of each end) offset by half the width on both sides, the width linear
 * from w0 to w1, MM_TAPER_STEPS segments.
 *
 * @param {{x: number, y: number}} from start
 * @param {{x: number, y: number}} to end
 * @param {number} w0 width at the start
 * @param {number} w1 width at the end
 * @return {number[][]} the points of the closed outline: one side forward, the other back
 */
export function taperOutline(from, to, w0, w1) {
	const dx = to.x - from.x
	const p = [[from.x, from.y], [from.x + dx / 2, from.y], [to.x - dx / 2, to.y], [to.x, to.y]]
	const left = []
	const right = []
	for (let i = 0; i <= MM_TAPER_STEPS; i++) {
		const t = i / MM_TAPER_STEPS
		const u = 1 - t
		const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0]
		const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]
		// the tangent (derivative of the cubic); a branch without length points along x
		let tx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0])
		let ty = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1])
		const d = Math.hypot(tx, ty)
		if (d > 1e-9) {
			tx /= d
			ty /= d
		} else {
			tx = 1
			ty = 0
		}
		const hw = (w0 + (w1 - w0) * t) / 2
		left.push([x - ty * hw, y + tx * hw])
		right.push([x + ty * hw, y - tx * hw])
	}
	return [...left, ...right.reverse()]
}

/**
 * Strokes a polyline with round bends of radius r (at most half of each
 * adjoining segment), (job 266, O1) the lines of org and tree.
 *
 * @param {object} c 2D context
 * @param {number[]} pts x, y pairs
 * @param {number} r bend radius
 */
export function bentLine(c, pts, r) {
	c.moveTo(pts[0], pts[1])
	for (let i = 2; i + 3 < pts.length; i += 2) {
		const [ox, oy, px, py, qx, qy] = [pts[i - 2], pts[i - 1], pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]
		const k = Math.min(r, Math.hypot(px - ox, py - oy) / 2, Math.hypot(qx - px, qy - py) / 2)
		if (k > 0) c.arcTo(px, py, qx, qy, k)
		else c.lineTo(px, py)
	}
	c.lineTo(pts[pts.length - 2], pts[pts.length - 1])
}

/**
 * Paints branches, lines, boxes and the folded badges (sceneFunc of the lines shape).
 * Job 266 (design round 4): branches of the mind map taper (taperOutline,
 * round ends), the lines of org and tree are dark with round bends; a box
 * on n.fill (a main pill: its light tone) with n.border (none for a main
 * pill), the root of a mind map (roundRect) with radius MM_ROOT_RADIUS; a
 * card's band (n.band) on top or on the left, cut to its shape; a folded
 * branch has its "+n" badge (n.badge) in its colour, the number at level 0.
 *
 * @param {object} c Konva context
 * @param {object} l layout
 * @param {number} level 0 = with the numbers of the badges
 */
export function paintMindmap(c, l, level) {
	c.lineCap = 'round'
	c.lineJoin = 'round'
	for (const b of branchesOf(l)) {
		c.beginPath()
		if (b.points) {
			bentLine(c, b.points, MM_LINE_BEND)
			c.strokeStyle = b.color
			c.lineWidth = b.width
			c.stroke()
			continue
		}
		const [w0, w1] = taperOf(b.depth)
		const o = taperOutline(b.from, b.to, w0, w1)
		c.moveTo(o[0][0], o[0][1])
		for (let i = 1; i < o.length; i++) c.lineTo(o[i][0], o[i][1])
		c.closePath()
		c.fillStyle = b.color
		c.fill()
		// round ends
		c.beginPath()
		c.moveTo(b.from.x + w0 / 2, b.from.y)
		c.arc(b.from.x, b.from.y, w0 / 2, 0, Math.PI * 2)
		c.moveTo(b.to.x + w1 / 2, b.to.y)
		c.arc(b.to.x, b.to.y, w1 / 2, 0, Math.PI * 2)
		c.fill()
	}
	for (const n of l.nodes) {
		if (n.shape === 'line') {
			c.beginPath()
			c.moveTo(n.x, n.y + n.h)
			c.lineTo(n.x + n.w, n.y + n.h)
			c.strokeStyle = n.color
			c.lineWidth = MM_BRANCH_W
			c.stroke()
			continue
		}
		c.beginPath()
		const half = MM_BORDER_W / 2
		const card = n.band === 'top' || n.band === 'left'
		const r = n.shape === 'pill' ? n.h / 2 : n.shape === 'roundRect' ? (n.parent === null && !card ? MM_ROOT_RADIUS : MM_RADIUS) : 0
		roundRect(c, n.x + half, n.y + half, n.w - MM_BORDER_W, n.h - MM_BORDER_W, r)
		c.fillStyle = n.fill ?? MM_FILL
		c.fill()
		if (card) {
			// job 198: the colour band of a card, cut to its shape (job 266: a tree's on the left)
			c.save()
			c.clip()
			c.fillStyle = n.color
			if (n.band === 'top') c.fillRect(n.x, n.y, n.w, MM_CARD_BAND + half)
			else c.fillRect(n.x, n.y, MM_CARD_BAND + half, n.h)
			c.restore()
		}
		if (n.border) {
			c.strokeStyle = n.border
			c.lineWidth = MM_BORDER_W
			c.stroke()
		}
	}
	for (const n of l.nodes) {
		const g = n.badge
		if (!n.folded || !g) continue
		c.beginPath()
		roundRect(c, g.x, g.y, g.w, g.h, g.h / 2)
		c.fillStyle = n.color
		c.fill()
		if (level === 0) {
			c.fillStyle = '#ffffff'
			c.font = 'bold ' + MM_BADGE_FONT + 'px ' + FONT_FAMILY
			c.textAlign = 'center'
			c.textBaseline = 'middle'
			c.fillText('+' + n.count, g.x + g.w / 2, g.y + g.h / 2 + 0.5)
		}
	}
}

/**
 * Paints the focus outline and the hollow dots (sceneFunc of the ui shape).
 *
 * @param {object} c Konva context
 * @param {object} l layout
 * @param {{focus?: (string|null), hover?: (string|null), dots?: boolean}|null} ui what this tab shows
 * @param {number} scale world → screen factor of the shape
 */
export function paintMindmapUi(c, l, ui, scale) {
	if (!ui) return
	for (const n of l.nodes) {
		if (n.folded || !n.dot || (ui.dots !== true && ui.hover !== n.key)) continue
		c.beginPath()
		c.arc(n.dot.x, n.dot.y, MM_DOT_R - 1, 0, Math.PI * 2)
		c.fillStyle = MM_FILL
		c.fill()
		c.strokeStyle = n.color
		c.lineWidth = 1.5
		c.stroke()
	}
	const f = typeof ui.focus === 'string' ? l.byKey.get(ui.focus) : null
	if (f) {
		const px = 1 / (scale > 0 ? scale : 1)
		c.beginPath()
		c.rect(f.x - FOCUS_GAP, f.y - FOCUS_GAP, f.w + 2 * FOCUS_GAP, f.h + 2 * FOCUS_GAP)
		c.strokeStyle = SELECTION_COLOR
		c.lineWidth = FOCUS_PX * px
		c.stroke()
	}
}

/**
 * Builds, updates and removes the text nodes for the layout.
 *
 * @param {object} ctx builder context
 * @param {object} entry node entry
 */
function syncTexts(ctx, entry) {
	const l = entry.layout
	const texts = entry.parts.texts
	const seen = new Set()
	const put = (id, attrs) => {
		seen.add(id)
		let node = texts.get(id)
		if (node) {
			node.setAttrs(attrs)
		} else {
			node = new ctx.Text({ ...SHAPE_BASE, ...attrs })
			node.transformsEnabled('position')
			entry.root.add(node)
			texts.set(id, node)
		}
	}
	if (entry.lod === 0) {
		for (const n of l.nodes) {
			if (n.text === '') continue
			const shown = entry.textHidden !== n.key
			if (n.band === 'top' || n.band === 'left') {
				// job 198: a card, its name bold over its role (the text ids key and key:r); job 266 (O1): the role
				// MM_ROLE_FONT in MM_ROLE_COLOR, a tree's card right of its band
				const bandL = n.band === 'left' ? MM_CARD_BAND : 0
				const w = n.w - bandL - 2 * n.padX
				const x = n.x + bandL + n.padX
				const top = n.y + (n.band === 'top' ? MM_CARD_BAND : 0) + n.padY
				if (n.name !== '') put(n.key, { ...nodeTextAttrs(n.name, w, n.font, true), x, y: top, fill: TEXT_COLOR, align: 'center', visible: shown })
				if (n.role !== '') put(n.key + ':r', { ...nodeTextAttrs(n.role, w, MM_ROLE_FONT, false), x, y: top + n.nameH, fill: MM_ROLE_COLOR, align: 'center', visible: shown })
				continue
			}
			const box = n.shape !== 'line' || n.parent === null
			put(n.key, {
				...nodeTextAttrs(n.text, n.w - 2 * n.padX, n.font, n.bold), x: n.x + n.padX, y: n.y + n.padY, fill: TEXT_COLOR,
				align: box ? 'center' : 'left', visible: shown,
			})
		}
	}
	for (const [key, node] of texts) {
		if (!seen.has(key)) {
			node.destroy()
			texts.delete(key)
		}
	}
	// the ui shape stays on top of the texts
	entry.parts.ui.moveToTop()
}

export const mindmap = {
	/**
	 * @param {object} ctx builder context (measureNode: the renderer's text measurement)
	 * @param {object} item mind map item
	 * @param {object} abs absolute box
	 * @param {0|1} level 0 = with text, 1 = without
	 * @param {string|boolean} [textHidden] the node whose editor is open
	 * @return {object} entry
	 */
	build(ctx, item, abs, level, textHidden = false) {
		const root = makeGroup(ctx)
		const entry = {
			root, parts: null, lod: level, transforms: null, textHidden: typeof textHidden === 'string' ? textHidden : false,
			layout: mindmapLayout(item, measureOf(ctx)), ui: null,
		}
		const lines = new ctx.Shape({ ...SHAPE_BASE, sceneFunc: (c) => paintMindmap(c, entry.layout, entry.lod) })
		const ui = new ctx.Shape({ ...SHAPE_BASE, sceneFunc: (c, shape) => paintMindmapUi(c, entry.layout, entry.ui, shape.getAbsoluteScale?.().x ?? 1) })
		for (const n of [lines, ui]) n.transformsEnabled('position')
		root.add(lines, ui)
		entry.parts = { lines, ui, texts: new Map() }
		syncTexts(ctx, entry)
		place(entry, abs)
		return entry
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item mind map item (new state, a local preview included)
	 * @param {object} abs absolute box
	 * @param {Set<string>} fields changed fields
	 * @return {boolean} true = rebuild
	 */
	update(ctx, entry, item, abs, fields) {
		if (fields.has('type')) return true
		if (fields.has('data') || fields.has('style') || fields.has('geom') || fields.has('text')) {
			entry.layout = mindmapLayout(item, measureOf(ctx))
			syncTexts(ctx, entry)
		}
		return false
	},

	/**
	 * @param {object} ctx builder context
	 * @param {object} entry node entry
	 * @param {object} item mind map item
	 * @param {object} abs absolute box
	 * @param {0|1} level new level
	 */
	setLod(ctx, entry, item, abs, level) {
		entry.lod = level
		syncTexts(ctx, entry)
	},

	/**
	 * @param {object} entry node entry
	 * @param {string|boolean} hidden the node whose editor opened, false when it closed
	 */
	setTextHidden(entry, hidden) {
		entry.textHidden = typeof hidden === 'string' ? hidden : false
		for (const [id, node] of entry.parts.texts) node.visible(entry.textHidden !== id.split(':')[0])
	},

	/**
	 * @param {object} entry node entry
	 * @param {{focus?: (string|null), hover?: (string|null), dots?: boolean}|null} ui what this tab shows
	 */
	setUi(entry, ui) {
		entry.ui = ui ? { focus: ui.focus ?? null, hover: ui.hover ?? null, dots: ui.dots === true } : null
	},
}
