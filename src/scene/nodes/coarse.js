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
 * - content as fillRect batched by fill color: notes and shapes as boxes,
 *   text items as one grey bar, unknown types as a grey box, rotated items as
 *   their axis-aligned bounding box
 * - (R13) (a) ids that live as nodes in the activeGroup (local drag or
 *   transform with descendants, remote drag previews) are skipped (the
 *   renderer passes them as `skip`); (b) connectors are never painted
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
import { rotatedBBox } from '../../model/geometry.js'
import { fieldValue, typeInfo } from '../../model/registry.js'
import {
	FONT_FAMILY, FRAME_STROKE, FRAME_TITLE_COLOR, LOD2_ENTER, LOD2_LEAVE, LOD_TEXT_SCALE, PLACEHOLDER_STROKE,
	TEXT_BAR_COLOR,
} from '../../model/tokens.js'
import { SHAPE_BASE, str } from './common.js'
import { withAlpha } from './shape.js'

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
/** Title fits remembered per renderer (title × width in px); cleared above this size. */
export const COARSE_TITLE_CACHE_MAX = 512
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

/** Not painted at LOD 2 (connectors, rule (b)). */
const SKIP = Object.freeze({ cls: 'skip', color: null, title: '' })
/** item object → its LOD-2 look (a new object per stored state: the model replaces items on apply) */
const LOOKS = new WeakMap()

/**
 * How an item is painted at LOD 2, from its stored fields (fieldValue, rule
 * 18): frames with their fill and title; notes with their fill; shapes with
 * their fill (fillOpacity as alpha), or their stroke color when they have
 * no fill, or not at all when they have neither; text items as a grey bar;
 * unknown types as a grey box; connectors never. Cached per item object
 * (fill and title change only with a new stored state).
 *
 * @param {object} item WireItem
 * @return {{cls:('frame'|'box'|'skip'), color:(string|null), title:string}}
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
	if (info.hit === 'line') return SKIP
	if (info.container) {
		return { cls: 'frame', color: fieldValue(item, 'style.fill'), title: str(fieldValue(item, 'data.title')) }
	}
	if (item.t === 'sticky') return { cls: 'box', color: fieldValue(item, 'style.fill'), title: '' }
	if (item.t === 'shape') {
		const op = fieldValue(item, 'style.fillOpacity')
		if (op > 0) return { cls: 'box', color: withAlpha(fieldValue(item, 'style.fill'), op), title: '' }
		return fieldValue(item, 'style.strokeWidth') > 0 ? { cls: 'box', color: fieldValue(item, 'style.stroke'), title: '' } : SKIP
	}
	if (item.t === 'text') return { cls: 'box', color: TEXT_BAR_COLOR, title: '' }
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
 * @return {{frames:Array<{id:string, x:number, y:number, w:number, h:number, fill:string, title:string}>,
 *           groups:Map<string, number[]>, painted:string[]}|null} frames in order, content boxes
 *   per color (flat x, y, w, h; colors in the order of their first box), the painted ids in
 *   paint order; null when an id has no rank (the order is stale: renew it and plan again)
 */
export function planCoarse(model, hits, skip, order) {
	const ranks = new Uint32Array(hits.length)
	let k = 0
	for (const e of hits) {
		if (typeInfo(e.t).hit === 'line' || skip(e.id)) continue
		const r = order.rank.get(e.id)
		if (r === undefined) return null
		ranks[k++] = r
	}
	const sorted = ranks.subarray(0, k).sort()
	const frames = []
	const groups = new Map()
	const painted = []
	for (let i = 0; i < k; i++) {
		const id = order.ids[sorted[i]]
		const it = model.get(id)
		const a = it ? model.abs(id) : null
		if (!a) continue
		const look = coarseLook(it)
		if (look.cls === 'skip') continue
		painted.push(id)
		if (look.cls === 'frame') {
			frames.push({ id, x: a.x, y: a.y, w: a.w, h: a.h, fill: look.color, title: look.title })
			continue
		}
		let box = groups.get(look.color)
		if (!box) {
			box = []
			groups.set(look.color, box)
		}
		if (a.r) {
			const b = rotatedBBox(a.x, a.y, a.w, a.h, a.r)
			box.push(b[0], b[1], b[2] - b[0], b[3] - b[1])
		} else {
			box.push(a.x, a.y, a.w, a.h)
		}
	}
	return { frames, groups, painted }
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
 * (world units): frames (fill, 1-px border, title), then the content boxes
 * color by color. With `rects`, every painted title leaves its rectangle
 * there (R14-13), in paint order and world units: from the frame's left edge
 * as wide as the shortened title, COARSE_TITLE_BOX_PX screen px high, its
 * bottom on the frame's top edge.
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
		ctx.strokeStyle = FRAME_STROKE
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
	for (const [color, b] of plan.groups) {
		ctx.fillStyle = color
		for (let i = 0; i < b.length; i += 4) ctx.fillRect(b[i], b[i + 1], b[i + 2], b[i + 3])
	}
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
