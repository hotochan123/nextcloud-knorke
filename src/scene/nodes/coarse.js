/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * LOD 2 (SPEC-M1 §6.3, stage 2): below LOD2_ENTER the static layer holds no
 * item nodes but exactly ONE Konva.Shape (buildCoarse) whose sceneFunc paints
 * the board coarsely in one pass:
 * - the ids the renderer's culling found in the view (one rbush query per
 *   camera step, model.query), sorted by compareOrder through a cached rank
 *   (coarseOrder: one sort of the board, renewed when items come, go or
 *   change their stacking order) – frames first (layer "back"), then content
 * - frames: fill + a 1-px border (screen px) + the title in 12 px screen size
 *   above the box, only from 40 px frame width on (ellipsis at the width)
 * - content as fillRect batched by fill color: notes as boxes, text items as
 *   one grey bar, (job 173) tables as a box in their border colour, (job
 *   188) note pads as a box in their fill, unknown types as a grey box,
 *   rotated items as their axis-aligned bounding box
 * - (job 202) shapes from COARSE_SHAPE_MIN_PX screen px on keep their
 *   outline (traceOutline, a symbol its icon), rotated about the box centre:
 *   filled with their own path and fill() each (one path for many outlines
 *   would cancel overlapping ones of opposite winding), their border and
 *   inner lines as a line of at least COARSE_LINE_PX in the border colour;
 *   smaller shapes stay boxes (the fill, else the border colour)
 * - (job 202) connectors as lines of at least COARSE_LINE_PX in their colour
 *   along the model's route (polyline or bezier), solid, no label; their
 *   caps (drawCap) only from COARSE_CAP_MIN_PX screen px of capSize on
 * - (job 273) pen strokes as lines in their colour and width (at least
 *   COARSE_LINE_PX), every COARSE_INK_EVERY-th point, a highlighter see-through
 * - (job 202) mind maps from COARSE_SHAPE_MIN_PX on: the root a box in its
 *   colour, every other node a bar of a third of its height (at least 1 px)
 *   in its branch colour, the branches (branchesOf) as lines; no text, no
 *   fold dots; smaller ones a box in MM_COARSE over their hull
 * - paint order: frames, then the fills colour by colour (boxes, then
 *   outlines; colours in the order of their first item), then (job 203) the
 *   own shapes, then the lines (borders, branches, connectors) by colour and
 *   width, one stroke() each, then the caps
 * - (R13) (a) ids that live as nodes in the activeGroup (local drag or
 *   transform with descendants, remote drag previews, the connectors moving
 *   with them) are skipped (the renderer passes them as `skip`)
 * - (job 191) the notes the tag filter fades (the renderer's `fade`) are
 *   painted in their fill at TAG_FADE_OPACITY
 * - (job 203) own shapes (kind image) after the fills: their picture over
 *   their (rotated) box once it is decoded and the box is at least
 *   COARSE_PICTURE_MIN_PX wide and high on screen, else their bounding box
 *   in PLACEHOLDER_FILL
 * No node.cache(), no bitmaps (iOS canvas memory). Hit testing and selection
 * stay with the model (SceneManager, InputController), with one addition
 * (R14-13, rule (d)): paintCoarse records the rectangle of every title it
 * paints (width of the shortened title, COARSE_TITLE_PX + COARSE_TITLE_GAP_PX
 * screen px above the frame's top edge) and coarseTitleHit finds the topmost
 * one under a point, so the input controller can hit a frame by its title.
 *
 * lodFor() is the level rule with the hysteresis (LOD2_ENTER/LOD2_LEAVE
 * around LOD_COARSE_SCALE); planCoarse() and paintCoarse() are pure (model
 * and a 2D context in, canvas calls out) and unit tested in Node.
 */
import { capSize } from '../../model/connectors.js'
import { MARKER_OPACITY, pointsOf, tracePath } from '../../model/ink.js'
import { rotatedBBox } from '../../model/geometry.js'
import { fieldValue, typeInfo } from '../../model/registry.js'
import {
	FONT_FAMILY, FRAME_TITLE_COLOR, LOD2_ENTER, LOD2_LEAVE, LOD_TEXT_SCALE, MM_COARSE, PLACEHOLDER_FILL, PLACEHOLDER_STROKE,
	TAG_FADE_OPACITY, TEXT_BAR_COLOR, frameStroke, shownColor, shownLine,
} from '../../model/tokens.js'
import { isImageKind, shownBorder } from '../../model/shapes.js'
import { imageFor, pictureOf } from '../imageCache.js'
import { SHAPE_BASE, str } from './common.js'
import { drawCap } from './connector.js'
import { branchesOf } from './mindmap.js'
import { addLines, addOutline, withAlpha } from './shape.js'

/** Frame title size at LOD 2 (screen px). */
export const COARSE_TITLE_PX = 12
/** Frames narrower than this (screen px) get no title at LOD 2. */
export const COARSE_TITLE_MIN_PX = 40
/** Frame border at LOD 2 (screen px). */
export const COARSE_BORDER_PX = 1
/** Gap between the title's baseline and the frame's top edge (screen px). */
export const COARSE_TITLE_GAP_PX = 3
/** Height of a frame's title rectangle above its top edge (screen px, R14-13): the title plus its gap. */
export const COARSE_TITLE_BOX_PX = COARSE_TITLE_PX + COARSE_TITLE_GAP_PX
/** (Job 203) Smallest width and height (screen px) at which an own shape shows its picture at LOD 2. */
export const COARSE_PICTURE_MIN_PX = 4
/** Title fits remembered per renderer (title × width in px); cleared above this size. */
export const COARSE_TITLE_CACHE_MAX = 512
/** (job 202) Shapes and mind maps whose longer side is smaller than this (screen px) stay boxes at LOD 2. */
export const COARSE_SHAPE_MIN_PX = 4
/** (job 202) Least width of a border, a branch or a connector at LOD 2 (screen px). */
export const COARSE_LINE_PX = 1
/** (job 273) A pen stroke at LOD 2 takes every n-th of its points. */
export const COARSE_INK_EVERY = 4
/** (job 202) Connector caps are painted at LOD 2 only from this capSize on (screen px). */
export const COARSE_CAP_MIN_PX = 3
const ELLIPSIS = '…'

/**
 * Level of detail for a scale (SPEC-M1 §6.3 table): 0 at ≥ LOD_TEXT_SCALE,
 * 1 below it, 2 below LOD2_ENTER. LOD 2 is left only above LOD2_LEAVE
 * (hysteresis), so a camera that wobbles around LOD_COARSE_SCALE
 * (0.1 ± 0.004) never switches.
 *
 * @param {number} scale camera scale
 * @param {number} prev current level (0, 1 or 2)
 * @return {0|1|2} the level for this scale
 */
export function lodFor(scale, prev) {
	if (!(scale > 0)) return prev === 1 || prev === 2 ? prev : 0
	if (prev === 2 ? scale <= LOD2_LEAVE : scale < LOD2_ENTER) return 2
	return scale < LOD_TEXT_SCALE ? 1 : 0
}

/** Not painted at LOD 2 (a shape without fill and border). */
const SKIP = Object.freeze({ cls: 'skip', color: null, title: '' })
/** item object → its LOD-2 look (a new object per stored state: the model replaces items on apply) */
const LOOKS = new WeakMap()
/** (job 202) mind map layout object → its LOD-2 parts (treeOf) */
const TREES = new WeakMap()

/**
 * How an item is painted at LOD 2, from its stored fields (fieldValue, rule
 * 18): frames with their fill and title; notes with their fill; (job 202)
 * shapes by their kind with their fill (fillOpacity as alpha) and their
 * border, color = the box of a small shape (the fill, else the border
 * colour), not at all without both; text items as a grey bar; unknown
 * types as a grey box; (job 202) connectors as lines with their colour,
 * width and caps; mind maps as their tree (MM_COARSE: the box of a small
 * one). Cached per item object (fill and title change only with a new
 * stored state).
 *
 * @param {object} item WireItem
 * @return {{cls:('frame'|'box'|'shape'|'line'|'tree'|'ink'|'skip'), color:(string|null), title:string}}
 *   (shape: also kind, fill, stroke, sw; line: also sw, startCap, endCap)
 */
export function coarseLook(item) {
	let look = LOOKS.get(item)
	if (!look) {
		look = Object.freeze(lookOf(item))
		LOOKS.set(item, look)
	}
	return look
}

/**
 * @param {object} item WireItem
 * @return {{cls:string, color:(string|null), title:string}}
 */
function lookOf(item) {
	const info = typeInfo(item.t)
	if (info.hit === 'line') {
		return {
			cls: 'line', color: shownLine(fieldValue(item, 'style.stroke')), title: '', sw: fieldValue(item, 'style.strokeWidth'),
			startCap: fieldValue(item, 'style.startCap'), endCap: fieldValue(item, 'style.endCap'),
		}
	}
	if (info.container) {
		// (job 262) the border in the strong tone of the fill, as at LOD 0 and 1
		return { cls: 'frame', color: shownColor(fieldValue(item, 'style.fill')), stroke: frameStroke(fieldValue(item, 'style.fill')), title: str(fieldValue(item, 'data.title')) }
	}
	// job 188: a note pad is a box in its fill at LOD 2
	if (item.t === 'sticky' || item.t === 'pad') return { cls: 'box', color: shownColor(fieldValue(item, 'style.fill')), title: '' }
	// job 203: an own shape, its picture
	if (item.t === 'shape' && isImageKind(fieldValue(item, 'data.kind'))) return { cls: 'image', color: PLACEHOLDER_FILL, title: '', src: pictureOf(item) }
	if (item.t === 'shape') {
		const op = fieldValue(item, 'style.fillOpacity')
		const sw = fieldValue(item, 'style.strokeWidth')
		const fill = op > 0 ? withAlpha(shownColor(fieldValue(item, 'style.fill')), op) : null
		const kind = fieldValue(item, 'data.kind')
		// job 260: the old default border drawn as SHAPE_BORDER, like the node
		const stroke = sw > 0 ? shownBorder(kind, fieldValue(item, 'style.stroke')) : null
		if (fill === null && stroke === null) return SKIP
		return { cls: 'shape', color: fill ?? stroke, title: '', kind, fill, stroke, sw }
	}
	if (item.t === 'text') return { cls: 'box', color: TEXT_BAR_COLOR, title: '' }
	// job 173: a table is a box at LOD 2
	if (item.t === 'table') return { cls: 'box', color: shownColor(fieldValue(item, 'style.stroke')), title: '' }
	// job 195: a small mind map a light grey box over its hull; job 202: else its tree
	if (item.t === 'mindmap') return { cls: 'tree', color: MM_COARSE, title: '' }
	// job 267: an AI card is a white box at LOD 2
	if (item.t === 'ai') return { cls: 'box', color: '#ffffff', title: '' }
	// job 273: a pen stroke is its line (a highlighter see-through)
	if (item.t === 'pen') {
		const c = fieldValue(item, 'style.stroke')
		return { cls: 'ink', color: fieldValue(item, 'data.kind') === 'marker' ? withAlpha(c, MARKER_OPACITY * 100) : c, title: '', sw: fieldValue(item, 'style.strokeWidth') }
	}
	// unknown types (placeholders): a box, like the LOD-2 rule for later types (§1.2)
	return { cls: 'box', color: PLACEHOLDER_STROKE, title: '' }
}

/**
 * The paint order of the whole board: every id sorted by compareOrder, and
 * its rank. One sort per change of the set or of the stacking order; the
 * painter then sorts only ranks (numbers).
 *
 * @param {object} model SceneModel
 * @return {{ids:string[], rank:Map<string, number>}}
 */
export function coarseOrder(model) {
	const ids = model.sortByOrder(model.ids())
	const rank = new Map()
	for (let i = 0; i < ids.length; i++) rank.set(ids[i], i)
	return { ids, rank }
}

/**
 * What LOD 2 paints for the culled ids, in compareOrder.
 *
 * @param {object} model SceneModel
 * @param {Array<{id:string, t:string}>} hits index entries in view (model.query)
 * @param {(id:string) => boolean} skip ids that are nodes in the activeGroup (rule (a))
 * @param {{ids:string[], rank:Map<string, number>}} order coarseOrder of the model
 * @param {((id:string) => boolean)|null} [fade] (job 191) ids the tag filter fades (a #rrggbb colour gets TAG_FADE_OPACITY)
 * @param {number} [scale] (job 202) camera scale of the painting; 0 paints every shape and mind map as a box
 * @return {{frames:Array<{id:string, x:number, y:number, w:number, h:number, fill:string, title:string}>,
 *           groups:Map<string, number[]>, shapes:Map<string, object[]>, colors:string[],
 *           lines:Map<string, {color:string, px:number, list:object[]}>, caps:object[], painted:string[],
 *           images:Array<{x:number, y:number, w:number, h:number, r:number, src:(string|null)}>}|null}
 *   frames in order; content boxes per color (flat x, y, w, h); (job 202) the filled outlines per color
 *   ({kind, x, y, w, h, r}); the fill colors in the order of their first box or outline; the lines per
 *   color and width in screen px (a shape outline, a connector's ConnGeom or a mind map's branches
 *   {branches, dx, dy}); the caps; the painted ids in paint order; (job 203) the own shapes in order;
 *   null when an id has no rank (the order is stale: renew it and plan again)
 */
export function planCoarse(model, hits, skip, order, fade = null, scale = 0) {
	const ranks = new Uint32Array(hits.length)
	let k = 0
	for (const e of hits) {
		if (skip(e.id)) continue
		const r = order.rank.get(e.id)
		if (r === undefined) return null
		ranks[k++] = r
	}
	const sorted = ranks.subarray(0, k).sort()
	const plan = { frames: [], groups: new Map(), shapes: new Map(), colors: [], lines: new Map(), caps: [], painted: [], images: [] }
	const s = Number.isFinite(scale) && scale > 0 ? scale : 0
	for (let i = 0; i < k; i++) {
		const id = order.ids[sorted[i]]
		const it = model.get(id)
		if (!it) continue
		const look = coarseLook(it)
		if (look.cls === 'skip') continue
		if (look.cls === 'line') {
			if (planLine(plan, look, model.geometryOf(id), s)) plan.painted.push(id)
			continue
		}
		const a = model.abs(id)
		if (!a) continue
		plan.painted.push(id)
		if (look.cls === 'ink') {
			// job 273: the stroke's line, its points relative to its box
			lineOf(plan, look.color, look.sw * s).push({ ink: pointsOf(it.data?.points), dx: a.x, dy: a.y })
			continue
		}
		if (look.cls === 'frame') {
			plan.frames.push({ id, x: a.x, y: a.y, w: a.w, h: a.h, fill: look.color, stroke: look.stroke, title: look.title })
			continue
		}
		if (look.cls === 'image') {
			plan.images.push({ x: a.x, y: a.y, w: a.w, h: a.h, r: a.r || 0, src: look.src })
			continue
		}
		const big = Math.max(a.w, a.h) * s >= COARSE_SHAPE_MIN_PX
		if (look.cls === 'shape' && big) {
			const e = { kind: look.kind, x: a.x, y: a.y, w: a.w, h: a.h, r: a.r || 0 }
			if (look.fill !== null) outlinesOf(plan, look.fill).push(e)
			if (look.stroke !== null) lineOf(plan, look.stroke, look.sw * s).push(e)
			continue
		}
		if (look.cls === 'tree' && big && planTree(plan, treeOf(model.treeLayoutOf(id)), a, s)) continue
		const color = fade !== null && /^#[0-9a-f]{6}$/i.test(look.color) && fade(id) ? withAlpha(look.color, TAG_FADE_OPACITY * 100) : look.color
		const box = boxesOf(plan, color)
		if (a.r) {
			const b = rotatedBBox(a.x, a.y, a.w, a.h, a.r)
			box.push(b[0], b[1], b[2] - b[0], b[3] - b[1])
		} else {
			box.push(a.x, a.y, a.w, a.h)
		}
	}
	return plan
}

/**
 * @param {object} plan plan of planCoarse
 * @param {string} color fill colour
 * @return {number[]} its boxes (flat x, y, w, h); a new colour joins plan.colors
 */
function boxesOf(plan, color) {
	let b = plan.groups.get(color)
	if (!b) {
		b = []
		plan.groups.set(color, b)
		if (!plan.shapes.has(color)) plan.colors.push(color)
	}
	return b
}

/**
 * @param {object} plan plan of planCoarse
 * @param {string} color fill colour
 * @return {object[]} its filled outlines; a new colour joins plan.colors
 */
function outlinesOf(plan, color) {
	let o = plan.shapes.get(color)
	if (!o) {
		o = []
		plan.shapes.set(color, o)
		if (!plan.groups.has(color)) plan.colors.push(color)
	}
	return o
}

/**
 * @param {object} plan plan of planCoarse
 * @param {string} color line colour
 * @param {number} px width in screen px (at least COARSE_LINE_PX)
 * @return {object[]} the entries stroked with this colour and width
 */
function lineOf(plan, color, px) {
	const w = Math.max(COARSE_LINE_PX, px)
	const key = color + ' ' + w
	let l = plan.lines.get(key)
	if (!l) {
		l = { color, px: w, list: [] }
		plan.lines.set(key, l)
	}
	return l.list
}

/**
 * (job 202) A connector's line and the caps that are big enough to see.
 *
 * @param {object} plan plan of planCoarse
 * @param {object} look its coarseLook
 * @param {object|null} g its ConnGeom (model.geometryOf)
 * @param {number} scale camera scale
 * @return {boolean} false without a route (nothing painted)
 */
function planLine(plan, look, g, scale) {
	const p = g?.points
	if (!Array.isArray(p) || p.length < 4) return false
	lineOf(plan, look.color, look.sw * scale).push(g)
	const size = capSize(look.sw)
	if (size * scale >= COARSE_CAP_MIN_PX) {
		const n = p.length
		const cap = (c, x, y, angle) => {
			if (c !== 'none') plan.caps.push({ cap: c, x, y, angle, size, sw: look.sw, color: look.color })
		}
		cap(look.startCap, p[0], p[1], g.start?.angle ?? 0)
		cap(look.endCap, p[n - 2], p[n - 1], g.end?.angle ?? 0)
	}
	return true
}

/**
 * (job 202) The LOD-2 parts of a mind map layout, relative to its hull's
 * corner: its nodes and its branches per colour (curves as the four points
 * of their bezier, as paintMindmap draws them). Cached per layout object.
 *
 * @param {object|null} l layout (model.treeLayoutOf)
 * @return {{nodes:object[], branches:Map<string, Array<{points:number[], bezier:boolean}>>}|null} null without nodes
 */
function treeOf(l) {
	if (!l || typeof l !== 'object' || !Array.isArray(l.nodes) || l.nodes.length === 0) return null
	let t = TREES.get(l)
	if (!t) {
		const branches = new Map()
		for (const b of branchesOf(l)) {
			let list = branches.get(b.color)
			if (!list) {
				list = []
				branches.set(b.color, list)
			}
			const dx = b.to.x - b.from.x
			list.push(b.points
				? { points: b.points, bezier: false }
				: { points: [b.from.x, b.from.y, b.from.x + dx / 2, b.from.y, b.to.x - dx / 2, b.to.y, b.to.x, b.to.y], bezier: true })
		}
		t = { nodes: l.nodes, branches }
		TREES.set(l, t)
	}
	return t
}

/**
 * (job 202) A mind map: the root a box in its colour, every other node a
 * bar of a third of its height (at least COARSE_LINE_PX) across its middle
 * in its branch colour, the branches as lines.
 *
 * @param {object} plan plan of planCoarse
 * @param {ReturnType<typeof treeOf>} t parts of its layout
 * @param {{x:number, y:number}} a its absolute box
 * @param {number} scale camera scale (> 0)
 * @return {boolean} false without parts (it stays a box)
 */
function planTree(plan, t, a, scale) {
	if (!t) return false
	const least = COARSE_LINE_PX / scale
	for (const n of t.nodes) {
		const b = boxesOf(plan, n.color)
		if (n.parent === null) {
			b.push(a.x + n.x, a.y + n.y, n.w, n.h)
		} else {
			const h = Math.max(n.h / 3, least)
			b.push(a.x + n.x, a.y + n.y + (n.h - h) / 2, n.w, h)
		}
	}
	for (const [color, list] of t.branches) lineOf(plan, color, 0).push({ branches: list, dx: a.x, dy: a.y })
	return true
}

/**
 * Longest prefix of a title (whole code points) that fits maxW with an
 * ellipsis; the title itself when it fits.
 *
 * @param {(s:string) => number} measure width of a string (same units as maxW)
 * @param {string} title title
 * @param {number} maxW available width
 * @return {string} '' when not even one character with the ellipsis fits
 */
export function fitTitle(measure, title, maxW) {
	if (title === '' || measure(title) <= maxW) return title
	const cps = Array.from(title)
	let lo = 0
	let hi = cps.length - 1
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1
		if (measure(cps.slice(0, mid).join('') + ELLIPSIS) <= maxW) lo = mid
		else hi = mid - 1
	}
	return lo === 0 ? '' : cps.slice(0, lo).join('') + ELLIPSIS
}

/**
 * Paints a plan into a 2D context that already carries the camera transform
 * (world units): frames (fill, 1-px border, title), then the fills color by
 * color (boxes, then (job 202) every outline with its own path), then the
 * lines per color and width (one stroke() each), then the caps. With
 * `rects`, every painted title leaves its rectangle there (R14-13), in paint
 * order and world units: from the frame's left edge as wide as the
 * shortened title, COARSE_TITLE_BOX_PX screen px high, its bottom on the
 * frame's top edge.
 *
 * @param {object} ctx 2D context (Konva.Context or a canvas context)
 * @param {ReturnType<typeof planCoarse>} plan plan
 * @param {number} scale camera scale (screen px = world × scale)
 * @param {Map<string, {text:string, px:number}>} [titles] remembered title fits of this renderer
 *   (the shortened title and its width in screen px)
 * @param {Array<{id:string, x:number, y:number, w:number, h:number}>|null} [rects] receives the
 *   painted title rectangles (appended)
 */
export function paintCoarse(ctx, plan, scale, titles = new Map(), rects = null) {
	const px = 1 / scale
	let font = false
	for (const f of plan.frames) {
		ctx.fillStyle = f.fill
		ctx.fillRect(f.x, f.y, f.w, f.h)
		ctx.lineWidth = COARSE_BORDER_PX * px
		ctx.strokeStyle = f.stroke
		ctx.strokeRect(f.x, f.y, f.w, f.h)
		const wPx = f.w * scale
		if (f.title === '' || wPx < COARSE_TITLE_MIN_PX) continue
		if (!font) {
			ctx.font = `${COARSE_TITLE_PX * px}px ${FONT_FAMILY}`
			ctx.textBaseline = 'bottom'
			ctx.textAlign = 'left'
			font = true
		}
		const key = Math.floor(wPx) + '\u0000' + f.title
		let fit = titles.get(key)
		if (fit === undefined) {
			// measured in world units of the 12-px font: the fit and its width in px depend on the width in px only
			const text = fitTitle((s) => ctx.measureText(s).width, f.title, f.w)
			fit = { text, px: text === '' ? 0 : ctx.measureText(text).width * scale }
			if (titles.size >= COARSE_TITLE_CACHE_MAX) titles.clear()
			titles.set(key, fit)
		}
		if (fit.text === '') continue
		ctx.fillStyle = FRAME_TITLE_COLOR
		ctx.fillText(fit.text, f.x, f.y - COARSE_TITLE_GAP_PX * px)
		if (rects) rects.push({ id: f.id, x: f.x, y: f.y - COARSE_TITLE_BOX_PX * px, w: fit.px * px, h: COARSE_TITLE_BOX_PX * px })
	}
	for (const color of plan.colors ?? plan.groups.keys()) {
		ctx.fillStyle = color
		const b = plan.groups.get(color)
		if (b) for (let i = 0; i < b.length; i += 4) ctx.fillRect(b[i], b[i + 1], b[i + 2], b[i + 3])
		const o = plan.shapes?.get(color)
		if (!o) continue
		// job 202: one path per outline (a shared path would cancel overlapping outlines of opposite winding)
		for (const e of o) {
			ctx.beginPath()
			addShape(ctx, e, false)
			ctx.fill()
		}
	}
	// job 203: own shapes
	for (const m of plan.images ?? []) {
		const img = m.w * scale >= COARSE_PICTURE_MIN_PX && m.h * scale >= COARSE_PICTURE_MIN_PX ? imageFor(m.src) : null
		if (!img) {
			const b = rotatedBBox(m.x, m.y, m.w, m.h, m.r)
			ctx.fillStyle = PLACEHOLDER_FILL
			ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1])
			continue
		}
		if (!m.r) {
			ctx.drawImage(img, m.x, m.y, m.w, m.h)
			continue
		}
		ctx.save()
		ctx.translate(m.x + m.w / 2, m.y + m.h / 2)
		ctx.rotate(m.r * Math.PI / 180)
		ctx.drawImage(img, -m.w / 2, -m.h / 2, m.w, m.h)
		ctx.restore()
	}
	if (plan.lines && plan.lines.size > 0) {
		ctx.setLineDash([])
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		for (const l of plan.lines.values()) {
			ctx.beginPath()
			for (const e of l.list) addLine(ctx, e)
			ctx.lineWidth = l.px * px
			ctx.strokeStyle = l.color
			ctx.stroke()
		}
	}
	for (const c of plan.caps ?? []) drawCap(ctx, c.cap, c.x, c.y, c.angle, c.size, c.sw, c.color)
}

/**
 * (job 202) Adds a shape's outline (and its inner lines) to the open path,
 * placed and rotated about its box centre like the node (place()).
 *
 * @param {object} ctx 2D context
 * @param {{kind:string, x:number, y:number, w:number, h:number, r:number}} e outline entry
 * @param {boolean} inner also the inner lines (SHAPES[kind].lines)
 */
function addShape(ctx, e, inner) {
	ctx.save()
	if (e.r) {
		ctx.translate(e.x + e.w / 2, e.y + e.h / 2)
		ctx.rotate((e.r * Math.PI) / 180)
		ctx.translate(-e.w / 2, -e.h / 2)
	} else {
		ctx.translate(e.x, e.y)
	}
	addOutline(ctx, e.kind, e.w, e.h)
	if (inner) addLines(ctx, e.kind, e.w, e.h)
	ctx.restore()
}

/**
 * (job 202) Adds one line entry to the open path: a connector's ConnGeom,
 * a mind map's branches of one colour, or a shape's border.
 *
 * @param {object} ctx 2D context
 * @param {object} e entry of plan.lines
 */
function addLine(ctx, e) {
	if (e.points) {
		addPath(ctx, e.points, e.kind === 'bezier', 0, 0)
	} else if (e.branches) {
		for (const b of e.branches) addPath(ctx, b.points, b.bezier, e.dx, e.dy)
	} else if (e.ink) {
		// job 273: a pen stroke, every COARSE_INK_EVERY-th point of its smooth line
		ctx.save()
		ctx.translate(e.dx, e.dy)
		tracePath(ctx, e.ink, COARSE_INK_EVERY)
		ctx.restore()
	} else {
		addShape(ctx, e, true)
	}
}

/**
 * @param {object} ctx 2D context
 * @param {number[]} p flat points (bezier: [p0, c1, c2, p1])
 * @param {boolean} bezier one cubic curve
 * @param {number} dx offset x
 * @param {number} dy offset y
 */
function addPath(ctx, p, bezier, dx, dy) {
	ctx.moveTo(p[0] + dx, p[1] + dy)
	if (bezier && p.length === 8) {
		ctx.bezierCurveTo(p[2] + dx, p[3] + dy, p[4] + dx, p[5] + dy, p[6] + dx, p[7] + dy)
		return
	}
	for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i] + dx, p[i + 1] + dy)
}

/**
 * The frame whose painted title rectangle (paintCoarse `rects`) lies under a
 * world point; the topmost one, i.e. the last painted, when titles overlap
 * (R14-13, SPEC-M1 §6.3 LOD 2 rule (d)). Like the title band of the model's
 * hit test, the rectangle widens by the hit tolerance to the left, the right
 * and the top, but not below the frame's top edge (the border band is there).
 *
 * @param {Array<{id:string, x:number, y:number, w:number, h:number}>} rects title rectangles in paint order
 * @param {number} wx world x
 * @param {number} wy world y
 * @param {number} [tol] tolerance in world units (4 px / scale for a mouse, 12 px / scale for touch)
 * @return {string|null} frame id
 */
export function coarseTitleHit(rects, wx, wy, tol = 0) {
	const t = Number.isFinite(tol) && tol > 0 ? tol : 0
	for (let i = rects.length - 1; i >= 0; i--) {
		const r = rects[i]
		if (wx >= r.x - t && wx <= r.x + r.w + t && wy >= r.y - t && wy < r.y + r.h) return r.id
	}
	return null
}

/**
 * The one node of the static layer at LOD 2.
 *
 * @param {{Shape:Function}} ctx builder context
 * @param {(context:object) => void} paint paints the board into the Konva context
 * @return {object} Konva.Shape without hit graph
 */
export function buildCoarse(ctx, paint) {
	const node = new ctx.Shape({
		...SHAPE_BASE,
		sceneFunc: (context) => paint(context),
	})
	node.transformsEnabled('position')
	return node
}
