/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Konva renderer (SPEC-M0 §6.3), the engine-bound part of the scene. Its
 * interface stays engine-neutral (cheap insurance should the iPad measurement
 * in M1 overturn the engine choice). Ported from the spike's konva.js
 * (imports, flags, layers, builders, batched camera, drag flow, binary insert)
 * and extended with culling by detaching, lazy node building and summaries.
 *
 * Rules (all mandatory):
 * - deep imports only: konva/lib/Core (Group, Shape) plus Rect, Text and Line
 *   (SPEC-M1 §0, §6.3: ellipses and polygons are Konva.Shape sceneFuncs)
 * - Konva.autoDrawEnabled = false; touched layers are marked dirty and drawn
 *   by flushDraws() from the scene's single animation-frame loop (batchDraw
 *   semantics, but cancellable during a CSS gesture and flushable at its end)
 * - Konva.pixelRatio = min(2, devicePixelRatio) before the stage exists
 * - two layers (two canvases): staticLayer, and overlayLayer with activeGroup
 *   (dragged and transformed nodes, remote drag previews) and uiGroup
 *   (selection, marquee, drop target, transformer handles, snap guides,
 *   gap markers).
 *   Both layers and all nodes have listening: false; hit testing is
 *   SceneModel.hitTest (and the scene's screen-space handle test), never
 *   Konva's hit graph.
 * - transformer (SPEC-M1 §6.3): live up to TRANSFORM_LIVE_MAX items
 *   (transformMoved re-builds the parts of the moved entries), above that ONE
 *   activeGroup.setAttrs per frame (setActiveTransform); handles keep their
 *   screen size and are re-placed on every confirmed camera
 * - text items change their level with the scale inside LOD 1 (levelOf of
 *   the node spec, TEXT_MIN_PX); only those entries are re-checked
 * - the camera is ONE stage.setAttrs({scaleX, scaleY, x, y}) per change
 *   (x/y shifted by the overscan l/t)
 * - overscan (M2, SPEC-M1 §6.3 "Überstand und Deckungsregel"; Camera.js):
 *   the stage, and with it both layers, is larger than the viewport by
 *   {l, r, t, b} CSS px (overscanLayout: up to 384 per side within 12 M
 *   device px per layer and 3 × the viewport area; 0 on large Retina
 *   screens). stage.content sits at left −l, top −t (no resting transform),
 *   transform-origin "l px t px" so cssTransformFor stays valid; mount sets
 *   overflow: clip (hidden first, the fallback) on the host and destroy
 *   restores its inline value, nothing else writes overflow. A resize keeps
 *   and re-centres the bitmaps while they leave 0.75 · M per side within the
 *   budget (overscanResize), else reallocates once; during a CSS gesture it
 *   draws at the live camera. stats().overscan reports {l, r, t, b, stageW,
 *   stageH}
 * - CSS gesture: the redraw in between follows the coverage rule
 *   (needsGestureRedraw): when the transformed stage would leave more than
 *   1 px of the viewport uncovered, or k > 2, the live camera is applied and
 *   drawn in the same frame and the transform reset in the same task
 * - culling detaches nodes (node.remove()); nodes are built when their item
 *   first enters the cull rectangle (cullRectOf: the stage with its
 *   overscan, per side at least CULL_MARGIN of the viewport), then cached.
 *   Dragged and previewed nodes live in activeGroup and are never culled.
 * - an empty overlay layer is not redrawn on camera changes
 * - connectors (SPEC-M1 §6.3, round 1b) are routed specs: built and placed
 *   from SceneModel.routeOf (no place(), root at (0, 0)); their selection
 *   outline is a halo line along the route; the connectors attached to a
 *   remote drag preview move into the activeGroup with it (the scene re-routes
 *   them over the model's box resolver, previewOffset), as the ones of a local
 *   drag do (beginDrag gets them from the scene)
 * - uiGroup also holds the "+" handles and connector end handles (round,
 *   same constant screen size rule as the transformer handles) and the
 *   preview of a connect/retarget drag (dashed route, target outline, anchor
 *   dots)
 * - snap guides (M2, SPEC-M1 §1.2 (R12)): setSnapGuides puts one dashed
 *   Line per guide into the uiGroup (name knorke-snap-guide, world
 *   coordinates with a screen-px stroke and SNAP_GUIDE_DASH in screen px, so
 *   nothing to re-place on camera changes); the dash phase is anchored to the
 *   board (dashOffset = snapGuideDashOffset(from, scale)): the dashes stay put
 *   while a guide grows or shrinks during a drag; every call marks only the
 *   overlay dirty (0 static draws while dragging, G11/G12)
 * - gap markers of equal gaps (M2, R12): setGapMarkers puts one solid Line
 *   per marker into the uiGroup (name knorke-gap-marker, the guide color and
 *   width, a cross tick of GAP_MARKER_TICK_PX screen px at both ends:
 *   gapMarkerPoints with the scale of the call, kept on camera changes until
 *   the list changes); every call marks only the overlay dirty
 * - LOD 2 (SPEC-M1 §6.3, stage 2; nodes/coarse.js): entered below
 *   LOD2_ENTER, left above LOD2_LEAVE (hysteresis). On entry
 *   staticLayer.removeChildren() (the built entries stay cached) and ONE
 *   Konva.Shape goes into the static layer; its sceneFunc paints the ids the
 *   culling found (culling keeps only that list then: one rbush query per
 *   camera step, no node is attached or detached). Dragged, transformed and
 *   previewed items stay real nodes in the activeGroup (drawn at level 1)
 *   and are left out of the painting (R13 (a)); whenever that set changes the
 *   static layer is drawn once, never while dragging. Connectors are drawn
 *   nowhere at LOD 2 (R13 (b)): their nodes stay out of the activeGroup too.
 *   Selection outlines (also a connector's halo) stay in the uiGroup. Each
 *   painting keeps the rectangles of the frame titles it painted;
 *   coarseTitleAt() answers which frame title lies under a world point
 *   (R14-13: at LOD 2 a frame also hits in its painted title).
 * - vote badges (SPEC-M1 §6.3 mode vote, stage 3; nodes/badges.js): ONE
 *   Konva.Shape in the uiGroup paints the own votes, the totals, the empty
 *   rings (not at LOD 2) and the scope outline for the items in view; it
 *   exists only while there is something to paint, moves with the CSS
 *   gesture like everything else (no DOM per badge) and keeps the counters
 *   of its last painting (voteDrawn, stats().voteState of the scene).
 * - lock symbols (M2, SPEC-M1 §1.2 "(R20) Sperren"; nodes/locks.js): ONE
 *   Konva.Shape in the uiGroup paints a padlock on every locked item in
 *   view (the culled set; at LOD 2 the coarse hits, without connectors),
 *   in every mode and at every LOD. It exists only while a locked item is
 *   in view (no extra shape, unchanged child counts otherwise), moves with
 *   the CSS gesture like the badges, and counts its last painting
 *   (stats().locks). A change of an item's lock alone rebuilds no node and
 *   touches no static layer: the symbol follows with the overlay.
 * - background grid (M2, SPEC-M1 §1.2 (R12); grid.js): setGrid(true) puts
 *   ONE own <canvas class="knorke-grid" aria-hidden="true"> (no third Konva
 *   layer, pointer-events none) into the stage's container right before
 *   stage.content, so it lies below the Konva content and the scene overlay;
 *   setGrid(false) removes it (memory only while the grid is on). It never
 *   gets the CSS transform of a gesture (only contentEl does) and is painted
 *   with the camera the picture shows, at most once per occasion: every
 *   camera the stage takes (#applyCamera: setCamera, the redraw in
 *   gestureFrame, endGesture), every CSS-path gestureFrame with its live
 *   camera, resize and setGrid(true); never for model changes, drags,
 *   resizes, selection or guides. stats().draws.grid counts the paintings.
 * - group outlines (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): setSelection's
 *   third argument lists the fully selected groups (member ids); each gets
 *   ONE solid Rect in the uiGroup (SELECTION_COLOR, SELECTION_STROKE_PX),
 *   the axis-parallel union of its members' rotated boxes, placed like the
 *   item outlines (#placeUi: drag, transform preview, remote previews,
 *   camera); its members get no outline of their own (the scene leaves
 *   them out of localIds). stats().groupOutlines counts them.
 */
import Konva from 'konva/lib/Core'
import { Line } from 'konva/lib/shapes/Line'
import { Rect } from 'konva/lib/shapes/Rect'
import { Text } from 'konva/lib/shapes/Text'
import {
	CONNECTOR_END_PX, CONNECTOR_PLUS_PX, DROP_TARGET_COLOR, DROP_TARGET_STROKE_PX, FONT_FAMILY, GAP_MARKER_TICK_PX, HANDLE_FILL,
	HANDLE_PX, HANDLE_STROKE_PX, LINE_HEIGHT, MARQUEE_FILL, MARQUEE_STROKE, MULTI_FRAME_DASH, SELECTION_COLOR,
	SELECTION_STROKE_PX, SNAP_GUIDE_COLOR, SNAP_GUIDE_DASH, SNAP_GUIDE_STROKE_PX,
} from '../model/tokens.js'
import { rotatedBBox } from '../model/geometry.js'
import { typeInfo } from '../model/registry.js'
import { isLocked } from '../model/locks.js'
import { cssTransformFor, cullRectOf, needsGestureRedraw, overscanLayout, overscanResize } from './Camera.js'
import { diffVisible } from './culling.js'
import { gridLines, paintGrid } from './grid.js'
import { BADGES_NONE, buildBadges, paintBadges, planBadges } from './nodes/badges.js'
import { buildCoarse, coarseOrder, coarseTitleHit, lodFor, paintCoarse, planCoarse } from './nodes/coarse.js'
import { nodeSpecFor, place } from './nodes/index.js'
import { buildLocks, paintLocks, planLocks } from './nodes/locks.js'
import { textItemAttrs } from './nodes/text.js'
import { insertIndex, shouldBulkReattach } from './order.js'

/** Culling margin around the viewport (fraction of its size): the least the cull rectangle adds per side. */
export const CULL_MARGIN = 0.1

const ALL_FIELDS = Object.freeze(['geom', 'z', 'parent', 'text', 'style', 'data'])
/** Fields a transformer step changes (box, and the font size of text items). */
const TRANSFORM_FIELDS = Object.freeze(new Set(['geom', 'style']))
/** Identity attributes of the activeGroup (no transform preview). */
const ACTIVE_IDENTITY = Object.freeze({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, offsetX: 0, offsetY: 0 })

/** @param {object} node Konva node @return {string} item id of an entry root */
const kidOf = (node) => node.getAttr('kid')

/** Width (screen px) and opacity of the halo line that marks a selected connector. */
const LINE_SELECTION_PX = 3 * SELECTION_STROKE_PX
const LINE_SELECTION_OPACITY = 0.45
/** Connect preview: anchor dots of the target (screen px). */
const CONNECT_DOT_PX = 7
/** Period of the snap guide dash pattern (screen px). */
const SNAP_GUIDE_PERIOD = SNAP_GUIDE_DASH.reduce((sum, d) => sum + d, 0)

/**
 * dashOffset of a snap guide that starts at the world coordinate from (M2,
 * R12): canvas gives the pattern at path position s (screen px from the
 * start) the phase (s + dashOffset) mod P, so with this offset every world
 * point w of the guide has the phase (w · scale) mod P wherever from lies,
 * and the dashes stay put while from moves during a drag.
 *
 * @param {number} from world coordinate where the guide starts (along its axis)
 * @param {number} scale camera scale
 * @return {number} offset in [0, P) (never −0); 0 for a non-finite input or scale ≤ 0
 */
export function snapGuideDashOffset(from, scale) {
	if (!Number.isFinite(from) || !Number.isFinite(scale) || scale <= 0) return 0
	const s = from * scale
	if (!Number.isFinite(s)) return 0
	return ((s % SNAP_GUIDE_PERIOD) + SNAP_GUIDE_PERIOD) % SNAP_GUIDE_PERIOD
}

/**
 * Points of a gap marker (M2, R12) as ONE polyline: a cross tick of
 * GAP_MARKER_TICK_PX screen px at from, the line along the gap at at, a tick
 * at to.
 *
 * @param {{axis:'x'|'y', at:number, from:number, to:number}} m marker (axis 'x': horizontal from x = from
 *   to x = to at y = at; 'y': vertical at x = at)
 * @param {number} scale camera scale (not finite or ≤ 0: 1)
 * @return {number[]} 12 numbers (world)
 */
export function gapMarkerPoints(m, scale) {
	const s = Number.isFinite(scale) && scale > 0 ? scale : 1
	const t = GAP_MARKER_TICK_PX / 2 / s
	const { at, from, to } = m
	return m.axis === 'x'
		? [from, at - t, from, at + t, from, at, to, at, to, at - t, to, at + t]
		: [at - t, from, at + t, from, at, from, at, to, at - t, to, at + t, to]
}

/**
 * Look of a handle by name ([S]-internal): transformer squares, the round
 * rotation handle, filled round "+" handles, hollow round connector ends.
 *
 * @param {string} name handle name
 * @return {{size:number, round:boolean, fill:string, stroke:string}}
 */
function handleLook(name) {
	if (name.startsWith('plus-')) return { size: CONNECTOR_PLUS_PX, round: true, fill: SELECTION_COLOR, stroke: HANDLE_FILL }
	if (name === 'start' || name === 'end') return { size: CONNECTOR_END_PX, round: true, fill: HANDLE_FILL, stroke: SELECTION_COLOR }
	return { size: HANDLE_PX, round: name === 'rot', fill: HANDLE_FILL, stroke: SELECTION_COLOR }
}

export class KonvaRenderer {
	#container
	#model
	#ctx
	#stage = null
	#static = null
	#overlay = null
	#active = null
	#ui = null
	#w = 0
	#h = 0
	/** overscan of the stage (CSS px per side) and its size @type {import('./Camera.js').Overscan} */
	#ov = { l: 0, r: 0, t: 0, b: 0, stageW: 0, stageH: 0 }
	/** inline style.overflow of the host before mount (destroy restores it) */
	#hostOverflow = ''
	#cam = { x: 0, y: 0, scale: 1 }
	#lod = 0
	/** item id → node entry @type {Map<string, object>} */
	#entries = new Map()
	/** ids attached to the static layer @type {Set<string>} */
	#attached = new Set()
	/** locally dragged ids (in activeGroup) @type {Set<string>} */
	#dragging = new Set()
	/** remote drag previews: id → offset from the model position @type {Map<string, {dx:number, dy:number}>} */
	#previews = new Map()
	/** ids whose text is hidden for the editor @type {Set<string>} */
	#textHidden = new Set()
	#dirty = { static: false, overlay: false }
	#draws = { static: 0, overlay: 0, grid: 0 }
	#visibleCount = 0
	#base = null
	#css = null
	/** selection outlines: [{id, color, local, node}] */
	#sel = []
	/** outlines of fully selected groups (M2, R20): [{ids, node}] */
	#groupSel = []
	#selSig = ''
	#marquee = null
	#drop = null
	#dropId = null
	/** snap guide lines of a local drag or resize (uiGroup) */
	#guides = []
	/** gap marker lines of a local drag (uiGroup) */
	#gapMarkers = []
	/** built entries of scale-sensitive specs (text items) @type {Set<string>} */
	#scaleIds = new Set()
	/** transformer handles: world positions + Konva nodes */
	#handles = { list: [], outline: null, rotFrom: null, nodes: new Map(), outlineNode: null, rotLine: null }
	/** transform preview of the activeGroup, or null */
	#activeXf = null
	/** detached text node for measureTextHeight (never in a layer) */
	#measurer = null
	/** connect/retarget preview: {spec, line, target, dots[]} */
	#connect = { spec: null, line: null, target: null, dots: [] }
	/**
	 * LOD 2: the one static node, the culled index entries, the cached paint
	 * order (null = renew), the ids of the last painting, paint count, title
	 * fits, the title rectangles of the last painting (R14-13)
	 */
	#coarse = { node: null, hits: [], order: null, painted: [], paints: 0, titles: new Map(), titleRects: [] }
	/**
	 * vote badges (SPEC-M1 §6.3 mode vote, stage 3): the state they are
	 * painted from, the ONE badge node in the uiGroup (only while there is
	 * something to paint: badges or markVotable), the counters of the last
	 * painting (stats().voteState counts what is drawn)
	 */
	#vote = { state: null, node: null, drawn: BADGES_NONE }
	/**
	 * lock symbols (M2, R20): the ONE node in the uiGroup (only while a locked
	 * item is in view) and the symbols its last painting drew (stats().locks)
	 */
	#locks = { node: null, drawn: 0 }
	/** background grid (R12): its own <canvas> below the Konva content while on, else null */
	#grid = null
	/** the camera the picture shows (the live camera of a CSS gesture), what the grid is painted with */
	#shown = { x: 0, y: 0, scale: 1 }

	/**
	 * @param {HTMLElement} container element the stage is mounted in
	 * @param {import('../model/SceneModel.js').SceneModel} model scene model
	 * @param {{shadows?:boolean}} [opts] note shadows on/off
	 */
	constructor(container, model, { shadows = true } = {}) {
		this.#container = container
		this.#model = model
		this.#ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: shadows !== false }
	}

	/**
	 * @param {number} width viewport width
	 * @param {number} height viewport height
	 */
	mount(width, height) {
		Konva.autoDrawEnabled = false
		const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
		Konva.pixelRatio = Math.min(2, dpr || 1)
		this.#w = width
		this.#h = height
		this.#ov = overscanLayout(width, height, Konva.pixelRatio)
		this.#stage = new Konva.Stage({ container: this.#container, width: this.#ov.stageW, height: this.#ov.stageH, listening: false })
		this.#static = new Konva.Layer({ listening: false })
		this.#overlay = new Konva.Layer({ listening: false })
		this.#active = new Konva.Group({ listening: false })
		this.#ui = new Konva.Group({ listening: false })
		this.#overlay.add(this.#active, this.#ui)
		this.#stage.add(this.#static, this.#overlay)
		this.#static.on('draw', () => { this.#draws.static++ })
		this.#overlay.on('draw', () => {
			this.#draws.overlay++
			// a frame without the badge node draws no badge
			if (!this.#vote.node) this.#vote.drawn = BADGES_NONE
			// … and without the lock node no lock
			if (!this.#locks.node) this.#locks.drawn = 0
		})
		this.#placeContent()
		// the larger content is clipped and neither the host nor a parent ever scrolls
		// ('hidden' first: a browser without 'clip' keeps it)
		const style = this.#container.style
		this.#hostOverflow = style.overflow
		style.overflow = 'hidden'
		style.overflow = 'clip'
	}

	/**
	 * New viewport size: the stage is kept and re-centred while it leaves
	 * 0.75 · M per side within the budget (overscanResize), else reallocated
	 * once. During a CSS gesture the live camera is drawn at once (the next
	 * gestureFrame starts from it); otherwise both layers are marked as before.
	 *
	 * @param {number} width viewport width
	 * @param {number} height viewport height
	 */
	resize(width, height) {
		this.#w = width
		this.#h = height
		const { kept, ...ov } = overscanResize(this.#ov, width, height, Konva.pixelRatio)
		this.#ov = ov
		if (!kept) this.#stage.setAttrs({ width: ov.stageW, height: ov.stageH })
		this.#placeContent()
		if (this.#grid !== null) this.#sizeGrid()
		if (this.#base !== null) {
			const c = { ...this.#shown }
			this.#applyCamera(c.x, c.y, c.scale)
			this.#drawNow()
			this.#base = c
			this.#setTransform(null)
			return
		}
		// the stage offset through the one camera setAttrs, the grid and the culling of the new size
		this.#applyCamera(this.#cam.x, this.#cam.y, this.#cam.scale)
		this.#invalidate(true, this.#overlayNonEmpty())
	}

	destroy() {
		this.#grid?.remove()
		this.#grid = null
		if (this.#stage) this.#container.style.overflow = this.#hostOverflow
		this.#hostOverflow = ''
		this.#stage?.destroy()
		this.#stage = null
		this.#entries.clear()
		this.#attached.clear()
		this.#dragging.clear()
		this.#previews.clear()
		this.#scaleIds.clear()
		this.#sel = []
		this.#groupSel = []
		this.#handles = { list: [], outline: null, rotFrom: null, nodes: new Map(), outlineNode: null, rotLine: null }
		this.#connect = { spec: null, line: null, target: null, dots: [] }
		this.#guides = []
		this.#gapMarkers = []
		this.#coarse = { node: null, hits: [], order: null, painted: [], paints: 0, titles: new Map(), titleRects: [] }
		this.#vote = { state: null, node: null, drawn: BADGES_NONE }
		this.#locks = { node: null, drawn: 0 }
		this.#measurer?.destroy()
		this.#measurer = null
	}

	/** @return {HTMLElement} stage content element (.konvajs-content), target of the CSS gesture transform */
	get contentEl() {
		return this.#stage.content
	}

	/** @return {{x:number, y:number, scale:number}} camera the stage is drawn with */
	get camera() {
		return { ...this.#cam }
	}

	/**
	 * Camera change: one setAttrs, cull, mark layers (overlay only when not empty).
	 *
	 * @param {number} x world x of the top-left corner
	 * @param {number} y world y of the top-left corner
	 * @param {number} scale zoom
	 */
	setCamera(x, y, scale) {
		this.#applyCamera(x, y, scale)
		this.#invalidate(true, this.#overlayNonEmpty())
	}

	// ------------------------------------------------------------ CSS gesture

	/** A CSS-path gesture starts from the camera the stage shows now. */
	beginGesture() {
		this.#base = { ...this.#cam }
		const el = this.contentEl
		el.style.transformOrigin = `${this.#ov.l}px ${this.#ov.t}px`
		el.style.willChange = 'transform'
	}

	/**
	 * Live camera of the gesture: move the drawn stage with a CSS transform;
	 * Konva stays untouched while the moved stage still covers the viewport
	 * (the coverage rule, needsGestureRedraw). Otherwise the live camera is
	 * applied and drawn in this frame, the transform reset in the same task.
	 *
	 * @param {{x:number, y:number, scale:number}} c1 live camera
	 */
	gestureFrame(c1) {
		if (!this.#base) {
			this.beginGesture()
		}
		if (needsGestureRedraw(cssTransformFor(this.#base, c1), this.#w, this.#h, this.#ov)) {
			this.#applyCamera(c1.x, c1.y, c1.scale)
			this.#drawNow()
			this.#base = { ...c1 }
			this.#setTransform(null)
			return
		}
		const { k, tx, ty } = cssTransformFor(this.#base, c1)
		this.#setTransform(`translate(${tx}px, ${ty}px) scale(${k})`)
		// the grid canvas is not transformed: it follows the live camera in every frame
		this.#shown = { x: c1.x, y: c1.y, scale: c1.scale }
		this.#paintGrid()
	}

	/**
	 * Gesture end: apply the camera and draw every non-empty layer
	 * synchronously, then reset the transform in the same task, so no stale
	 * frame (canvas or selection outline) is ever shown.
	 *
	 * @param {{x:number, y:number, scale:number}} c1 final camera
	 */
	endGesture(c1) {
		this.#applyCamera(c1.x, c1.y, c1.scale)
		this.#drawNow()
		this.#setTransform(null)
		this.#base = null
		this.contentEl.style.willChange = ''
	}

	// ------------------------------------------------------------ background grid

	/**
	 * Background grid on or off (M2, R12): on puts the grid canvas below the
	 * Konva content and paints it with the camera the picture shows; off
	 * removes it. The same state again does nothing.
	 *
	 * @param {boolean} on grid shown
	 */
	setGrid(on) {
		const v = on === true
		if (v === (this.#grid !== null)) return
		if (!v) {
			this.#grid.remove()
			this.#grid = null
			return
		}
		const c = document.createElement('canvas')
		c.className = 'knorke-grid'
		c.setAttribute('aria-hidden', 'true')
		c.style.position = 'absolute'
		c.style.left = '0'
		c.style.top = '0'
		c.style.pointerEvents = 'none'
		c.style.display = 'block'
		this.#stage.container().insertBefore(c, this.#stage.content)
		this.#grid = c
		this.#sizeGrid()
		this.#paintGrid()
	}

	/** CSS size of the grid canvas = the viewport (not the stage with its overscan), its bitmap = that times the pixel ratio. */
	#sizeGrid() {
		const c = this.#grid
		const pr = Konva.pixelRatio
		c.style.width = this.#w + 'px'
		c.style.height = this.#h + 'px'
		c.width = Math.round(this.#w * pr)
		c.height = Math.round(this.#h * pr)
	}

	/** Paints the grid with the camera the picture shows (only while the grid is on). */
	#paintGrid() {
		const c = this.#grid
		if (c === null) return
		const ctx = c.getContext('2d')
		if (!ctx) return
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		paintGrid(ctx, gridLines(this.#shown, this.#w, this.#h, Konva.pixelRatio), c.width, c.height)
		this.#draws.grid += 1
	}

	/** @return {string|null} CSS transform currently applied by a gesture */
	get cssTransform() {
		return this.#css
	}

	// ------------------------------------------------------------ drawing

	/** Draws dirty layers (called once per animation frame, never during a CSS gesture). */
	flushDraws() {
		if (this.#dirty.static) {
			this.#dirty.static = false
			this.#static.draw()
		}
		if (this.#dirty.overlay) {
			this.#dirty.overlay = false
			this.#overlay.draw()
		}
	}

	/** @return {boolean} true when a layer waits for a draw */
	hasDirty() {
		return this.#dirty.static || this.#dirty.overlay
	}

	// ------------------------------------------------------------ model changes

	/**
	 * Applies a ChangeSummary of SceneModel.apply: build/rebuild/place/reorder
	 * what is attached, mark detached cached nodes stale, re-cull.
	 *
	 * @param {import('../model/SceneModel.js').ChangeSummary} summary changes
	 */
	applySummary(summary) {
		let touchStatic = false
		let touchOverlay = false
		for (const id of summary.removed) {
			const e = this.#entries.get(id)
			if (!e) continue
			if (this.#attached.has(id)) touchStatic = true
			if (this.#dragging.has(id) || this.#previews.has(id)) touchOverlay = true
			e.root.destroy()
			this.#entries.delete(id)
			this.#attached.delete(id)
			this.#dragging.delete(id)
			this.#previews.delete(id)
			this.#scaleIds.delete(id)
		}
		const reorder = []
		for (const [id, fields] of summary.updated) {
			const e = this.#entries.get(id)
			if (!e) continue
			// the lock alone changes no node (M2, R20): the lock symbol follows with the overlay
			if (fields.size > 0 && [...fields].every((x) => x === 'lock')) {
				touchOverlay = touchOverlay || this.#locks.node !== null || isLocked(this.#model.get(id))
				continue
			}
			if (!this.#isLive(id)) {
				e.stale = e.stale ? new Set([...e.stale, ...fields]) : new Set(fields)
				continue
			}
			this.#refresh(id, e, fields)
			if (fields.has('z') || fields.has('type')) reorder.push(id)
			if (this.#attached.has(id)) touchStatic = true
			else touchOverlay = true
		}
		for (const id of summary.geometry) {
			const e = this.#entries.get(id)
			if (!e) continue
			if (!this.#isLive(id)) {
				e.stale = e.stale ? e.stale.add('geom') : new Set(['geom'])
				continue
			}
			this.#placeEntry(id, this.#entries.get(id))
			if (this.#attached.has(id)) touchStatic = true
			else touchOverlay = true
		}
		for (const id of reorder) {
			if (!this.#attached.has(id)) continue
			const e = this.#entries.get(id)
			e.root.remove()
			this.#insertInOrder(id, e.root)
		}
		// the LOD-2 paint order follows the set and the stacking order
		if (summary.added.length > 0 || summary.removed.length > 0 || summary.reordered) this.#coarse.order = null
		// LOD 2 paints every item in view from the model: any change may show
		if (this.#lod === 2 && (summary.removed.length > 0 || summary.updated.size > 0 || summary.geometry.size > 0)) touchStatic = true
		// the badges sit on the items' corners and depend on what is votable
		if (this.#vote.node && (summary.added.length > 0 || summary.removed.length > 0 || summary.updated.size > 0 || summary.geometry.size > 0)) {
			touchOverlay = true
		}
		// the lock symbols sit on the items' corners
		if (this.#locks.node && (summary.added.length > 0 || summary.removed.length > 0 || summary.updated.size > 0 || summary.geometry.size > 0)) {
			touchOverlay = true
		}
		const before = this.#attached.size
		const locks = this.#locks.node
		this.#cull()
		if (this.#attached.size !== before || summary.added.length > 0) touchStatic = true
		if (this.#placeUi() || this.#locks.node !== locks) touchOverlay = true
		this.#invalidate(touchStatic, touchOverlay)
	}

	/** Drops every node (after SceneModel.load, e.g. a resync) and culls anew. */
	reset() {
		this.#static.destroyChildren()
		this.#active.destroyChildren()
		this.#entries.clear()
		this.#attached.clear()
		this.#dragging.clear()
		this.#previews.clear()
		this.#scaleIds.clear()
		this.#clearUi()
		// destroyChildren took the LOD-2 node along; a new board needs a new paint order
		this.#coarse.node = null
		this.#coarse.order = null
		this.#coarse.painted = []
		this.#coarse.titleRects = []
		if (this.#lod === 2) this.#static.add(this.#coarseNode())
		this.#cull()
		this.#invalidate(true, true)
	}

	// ------------------------------------------------------------ local drag

	/**
	 * Moves the nodes of the dragged items (with descendants) into activeGroup.
	 *
	 * @param {Iterable<string>} ids dragged ids including descendants
	 */
	beginDrag(ids) {
		const list = this.#model.sortByOrder([...ids].filter((id) => this.#model.has(id)))
		for (const id of list) {
			const e = this.#ensure(id)
			this.#previews.delete(id)
			this.#attached.delete(id)
			this.#placeEntry(id, e)
			this.#toActive(e)
			this.#dragging.add(id)
		}
		this.#placeUi()
		// a dragged item from beyond the culled set may be locked (a locked child of a free frame)
		this.#syncLocks()
		// one static draw: the items leave the static layer (at LOD 2: the painting)
		this.#invalidate(true, true)
	}

	/**
	 * Dragged items moved in the model: re-place their nodes (overlay only).
	 *
	 * @param {Iterable<string>} geometryIds ids whose absolute box changed
	 */
	dragMoved(geometryIds) {
		let any = false
		for (const id of geometryIds) {
			if (this.#dragging.has(id) || this.#previews.has(id)) {
				const e = this.#entries.get(id)
				if (e) this.#placeEntry(id, e)
				any = true
				continue
			}
			// LOD 2 paints this box from the model
			if (this.#lod === 2 && this.#paintedAtLod2(id)) this.#invalidate(true, false)
			const e = this.#entries.get(id)
			if (!e) continue
			if (this.#attached.has(id)) {
				this.#placeEntry(id, e)
				this.#invalidate(true, false)
			} else {
				e.stale = e.stale ? e.stale.add('geom') : new Set(['geom'])
			}
		}
		if (this.#placeUi() || any) {
			this.#invalidate(false, true)
		}
	}

	/**
	 * Transformer live step (SPEC-M1 §6.3): the model changed the boxes (and
	 * text font sizes) of these items locally (setBoxesLocal); their parts are
	 * updated (a note re-wraps its text, a text item its lines) and placed.
	 * They live in the activeGroup (beginDrag), so only the overlay redraws.
	 *
	 * @param {Iterable<string>} ids ids whose box or font size changed
	 */
	transformMoved(ids) {
		let overlay = false
		let staticLayer = false
		for (const id of ids) {
			if (this.#lod === 2 && !this.#dragging.has(id) && !this.#previews.has(id) && this.#paintedAtLod2(id)) staticLayer = true
			const e = this.#entries.get(id)
			if (!e || !this.#model.has(id)) continue
			if (!this.#isLive(id)) {
				e.stale = e.stale ? new Set([...e.stale, ...TRANSFORM_FIELDS]) : new Set(TRANSFORM_FIELDS)
				continue
			}
			this.#refresh(id, e, TRANSFORM_FIELDS)
			if (this.#attached.has(id)) staticLayer = true
			else overlay = true
		}
		if (this.#placeUi()) overlay = true
		this.#invalidate(staticLayer, overlay)
	}

	/**
	 * Transformer preview above TRANSFORM_LIVE_MAX items: ONE setAttrs of the
	 * activeGroup per call (uniform scale k about the frame's origin, G11);
	 * null resets it. The model is untouched until the release.
	 *
	 * @param {{x:number, y:number, k:number, offsetX:number, offsetY:number}|null} t world transform
	 */
	setActiveTransform(t) {
		if (!this.#active) return
		this.#activeXf = t ? { x: t.x, y: t.y, k: t.k, offsetX: t.offsetX, offsetY: t.offsetY } : null
		this.#active.setAttrs(t
			? { x: t.x, y: t.y, scaleX: t.k, scaleY: t.k, rotation: 0, offsetX: t.offsetX, offsetY: t.offsetY }
			: ACTIVE_IDENTITY)
		this.#invalidate(false, true)
	}

	/** @return {object|null} the current activeGroup preview transform (lab and tests) */
	get activeTransform() {
		return this.#activeXf ? { ...this.#activeXf } : null
	}

	/**
	 * Transformer handles in the uiGroup (world positions; size and stroke
	 * stay constant in screen px, re-placed on every confirmed camera).
	 *
	 * @param {{handles:Array<{name:string, x:number, y:number}>, outline:({x:number, y:number, w:number, h:number}|null),
	 *          rotFrom:({x:number, y:number}|null)}|null} h handles, the union frame of a multi
	 *   selection (dashed) and the point the rotation handle's line starts at; null removes all
	 */
	setHandles(h) {
		const list = Array.isArray(h?.handles) ? h.handles : []
		const H = this.#handles
		const names = new Set(list.map((x) => x.name))
		let changed = false
		for (const [name, node] of H.nodes) {
			if (!names.has(name)) {
				node.destroy()
				H.nodes.delete(name)
				changed = true
			}
		}
		for (const name of names) {
			if (H.nodes.has(name)) continue
			const look = handleLook(name)
			const node = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				fill: look.fill,
				stroke: look.stroke,
				strokeWidth: HANDLE_STROKE_PX,
				strokeScaleEnabled: false,
				shadowForStrokeEnabled: false,
			})
			this.#ui.add(node)
			H.nodes.set(name, node)
			changed = true
		}
		const outline = h?.outline ?? null
		if (outline && !H.outlineNode) {
			H.outlineNode = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SELECTION_COLOR,
				strokeWidth: 1,
				strokeScaleEnabled: false,
				dash: MULTI_FRAME_DASH.slice(),
			})
			this.#ui.add(H.outlineNode)
			changed = true
		} else if (!outline && H.outlineNode) {
			H.outlineNode.destroy()
			H.outlineNode = null
			changed = true
		}
		const rotFrom = names.has('rot') ? (h?.rotFrom ?? null) : null
		if (rotFrom && !H.rotLine) {
			H.rotLine = new Line({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SELECTION_COLOR,
				strokeWidth: 1,
				strokeScaleEnabled: false,
			})
			this.#ui.add(H.rotLine)
			changed = true
		} else if (!rotFrom && H.rotLine) {
			H.rotLine.destroy()
			H.rotLine = null
			changed = true
		}
		H.list = list.map((x) => ({ name: x.name, x: x.x, y: x.y }))
		H.outline = outline ? { ...outline } : null
		H.rotFrom = rotFrom ? { ...rotFrom } : null
		if (this.#placeHandles() || changed) this.#invalidate(false, true)
	}

	/**
	 * Vote badges of mode vote (SPEC-M1 §6.3, stage 3; nodes/badges.js): the
	 * own votes in `color`, totals, with markVotable the empty rings on
	 * votable items without an own vote (not at LOD 2) and the outline of the
	 * scope frame. ONE node in the uiGroup paints them for the items in view
	 * (the culled set); it exists only while there is something to paint.
	 * Changes redraw the overlay layer only. null removes everything.
	 *
	 * @param {import('./nodes/badges.js').BadgeState|null} state badges, a safe votable predicate,
	 *   markVotable, scope, color (#rrggbb)
	 */
	setVoteBadges(state) {
		const V = this.#vote
		V.state = state
			? { badges: state.badges, votable: state.votable, markVotable: state.markVotable === true, scope: state.scope ?? null, color: state.color }
			: null
		const want = V.state !== null && (V.state.badges.size > 0 || V.state.markVotable)
		if (want && !V.node && this.#ui) {
			V.node = buildBadges(this.#ctx, (context) => this.#paintBadges(context))
			this.#ui.add(V.node)
		} else if (!want && V.node) {
			V.node.destroy()
			V.node = null
		}
		this.#invalidate(false, true)
	}

	/**
	 * What the last painting of the badge node drew (SceneManager stats().voteState, R16).
	 *
	 * @return {{rings:number, badges:number, totals:number, outline:(string|null)}|null} null without a vote state
	 */
	voteDrawn() {
		return this.#vote.state ? { ...this.#vote.drawn } : null
	}

	/**
	 * sceneFunc of the badge node: plans the items in view and paints them;
	 * the counters of this painting become voteDrawn().
	 *
	 * @param {object} context Konva context with the camera transform
	 */
	#paintBadges(context) {
		const V = this.#vote
		const s = V.state
		if (!s) return
		const live = (id) => this.#attached.has(id) || this.#dragging.has(id) || this.#previews.has(id)
		let ids
		if (this.#lod === 2) {
			// no rings at LOD 2: only items with a badge, among the culled entries
			ids = s.badges.size > 0 ? this.#coarse.hits.filter((e) => s.badges.has(e.id)).map((e) => e.id) : []
		} else if (s.markVotable) {
			ids = [...this.#attached, ...this.#dragging, ...this.#previews.keys()]
		} else {
			ids = [...s.badges.keys()].filter(live)
		}
		const plan = planBadges(this.#model, ids, s, { rings: this.#lod !== 2, offsetOf: (id) => this.#previews.get(id) ?? null })
		V.drawn = Object.freeze({ ...plan.counts })
		paintBadges(context, plan, this.#cam.scale, s.color)
	}

	/**
	 * Measures the height of a text item for a target state (SPEC-M1 §6.3,
	 * rule 13): a detached Konva.Text with the item's wrap width, font size and
	 * text, never added to a layer and never asked per frame.
	 *
	 * @param {object} item WireItem (or a target state of it)
	 * @return {number} height in world units (lines × fontSize × LINE_HEIGHT)
	 */
	measureTextHeight(item) {
		if (!this.#measurer) {
			this.#measurer = new Text({ listening: false, perfectDrawEnabled: false, fontFamily: FONT_FAMILY, wrap: 'word', lineHeight: LINE_HEIGHT, padding: 0 })
		}
		this.#measurer.setAttrs(textItemAttrs(item, Number.isFinite(item?.w) ? item.w : 0))
		return this.#measurer.height()
	}

	/** Dragged nodes go back into the static layer, in order (binary insert via cull). */
	endDrag() {
		const ids = [...this.#dragging]
		this.#dragging.clear()
		for (const id of ids) {
			const e = this.#entries.get(id)
			if (!e) continue
			e.root.remove()
			if (this.#previews.has(id)) {
				this.#toActive(e)
			}
		}
		this.#cull()
		this.#placeUi()
		this.#invalidate(true, true)
	}

	// ------------------------------------------------------------ remote previews and UI

	/**
	 * Drag previews of other participants (absolute world top-left per item);
	 * containers take their descendants along, and the connectors attached to
	 * any of them come into the activeGroup too (offset 0: the scene re-routes
	 * them over the model's box resolver, see previewOffset). Locally dragged
	 * ids are skipped.
	 *
	 * @param {Map<string, {x:number, y:number}>} map id → absolute position
	 * @return {boolean} true when the previews changed
	 */
	setPreviews(map) {
		const next = new Map()
		for (const [id, p] of map) {
			if (!this.#model.has(id) || this.#dragging.has(id) || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue
			const a = this.#model.abs(id)
			const off = { dx: p.x - a.x, dy: p.y - a.y }
			next.set(id, off)
			for (const d of this.#model.descendantsOf(id)) {
				if (!this.#dragging.has(d) && !next.has(d)) next.set(d, off)
			}
		}
		if (next.size > 0) {
			for (const c of this.#model.connectorsOf([...next.keys()])) {
				if (!this.#dragging.has(c) && !next.has(c)) next.set(c, { dx: 0, dy: 0 })
			}
		}
		let changed = next.size !== this.#previews.size
		let moved = false
		for (const [id, off] of next) {
			const old = this.#previews.get(id)
			if (!old || old.dx !== off.dx || old.dy !== off.dy) changed = true
		}
		if (!changed) {
			return false
		}
		const leaving = [...this.#previews.keys()].filter((id) => !next.has(id))
		const prev = this.#previews
		this.#previews = next
		for (const id of leaving) {
			const e = this.#entries.get(id)
			if (!e) continue
			e.root.remove()
			this.#placeEntry(id, e)
			moved = true
		}
		for (const [id] of next) {
			const e = this.#ensure(id)
			if (!prev.has(id)) {
				this.#attached.delete(id)
				this.#toActive(e)
				moved = true
			}
			this.#placeEntry(id, e)
		}
		if (moved) {
			this.#sortActive()
			this.#cull()
		}
		this.#placeUi()
		this.#invalidate(moved, true)
		return true
	}

	/**
	 * Offset of an item's remote drag preview (the scene's box resolver for
	 * routing connectors over previews).
	 *
	 * @param {string} id item id
	 * @return {{dx:number, dy:number}|null}
	 */
	previewOffset(id) {
		const off = this.#previews.get(id)
		return off ? { dx: off.dx, dy: off.dy } : null
	}

	/**
	 * Selection outlines: local selection (solid) and the selections of other
	 * participants (dashed, in their color); (M2, R20) one solid outline per
	 * fully selected group, around the union of its members.
	 *
	 * @param {string[]} localIds local selection (without the members of `groups`)
	 * @param {Array<{ids:string[], color:string}>} [remote] remote selections
	 * @param {string[][]} [groups] member ids of each fully selected group
	 */
	setSelection(localIds, remote = [], groups = []) {
		const want = []
		const isLine = (id) => typeInfo(this.#model.get(id)?.t).hit === 'line'
		for (const id of localIds) want.push({ id, color: SELECTION_COLOR, local: true, line: isLine(id) })
		for (const r of remote) {
			for (const id of r.ids ?? []) want.push({ id, color: r.color, local: false, line: isLine(id) })
		}
		const sig = want.map((s) => s.id + '|' + s.color + '|' + (s.local ? 1 : 0) + (s.line ? 'l' : '')).join(',')
			+ ';' + (groups ?? []).map((g) => g.join('+')).join(',')
		if (sig === this.#selSig) {
			if (this.#placeUi()) this.#invalidate(false, true)
			return
		}
		this.#selSig = sig
		for (const s of this.#sel) s.node.destroy()
		this.#sel = []
		for (const s of this.#groupSel) s.node.destroy()
		this.#groupSel = []
		for (const ids of groups ?? []) {
			const node = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SELECTION_COLOR,
				strokeWidth: SELECTION_STROKE_PX,
				strokeScaleEnabled: false,
				name: 'knorke-group-outline',
			})
			this.#ui.add(node)
			this.#groupSel.push({ ids: [...ids], node })
		}
		for (const s of want) {
			const node = s.line
				// a connector: a halo along its route
				? new Line({
					listening: false,
					perfectDrawEnabled: false,
					stroke: s.color,
					strokeWidth: LINE_SELECTION_PX,
					strokeScaleEnabled: false,
					opacity: LINE_SELECTION_OPACITY,
					lineCap: 'round',
					lineJoin: 'round',
					dash: s.local ? undefined : [6, 6],
				})
				: new Rect({
					listening: false,
					perfectDrawEnabled: false,
					stroke: s.color,
					strokeWidth: SELECTION_STROKE_PX,
					strokeScaleEnabled: false,
					dash: s.local ? undefined : [6, 4],
				})
			this.#ui.add(node)
			this.#sel.push({ ...s, node })
		}
		this.#placeUi()
		this.#invalidate(false, true)
	}

	/**
	 * @param {{x:number, y:number, w:number, h:number}|null} rect world rectangle or null
	 * @param {'select'|'frame'} [kind] rubber band or frame preview
	 */
	setMarquee(rect, kind = 'select') {
		if (!rect) {
			if (this.#marquee) {
				this.#marquee.destroy()
				this.#marquee = null
				this.#invalidate(false, true)
			}
			return
		}
		if (!this.#marquee) {
			this.#marquee = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				strokeWidth: 1,
				strokeScaleEnabled: false,
			})
			this.#ui.add(this.#marquee)
		}
		const x = Math.min(rect.x, rect.x + rect.w)
		const y = Math.min(rect.y, rect.y + rect.h)
		this.#marquee.setAttrs({
			x, y, width: Math.abs(rect.w), height: Math.abs(rect.h),
			fill: kind === 'frame' ? 'rgba(255,255,255,0.6)' : MARQUEE_FILL,
			stroke: MARQUEE_STROKE,
			dash: kind === 'frame' ? [8, 4] : undefined,
		})
		this.#invalidate(false, true)
	}

	/**
	 * Snap guides of a local drag or resize in the uiGroup (M2, SPEC-M1 §1.2 (R12)):
	 * one dashed Line per guide, in world coordinates with a screen-px stroke
	 * and SNAP_GUIDE_DASH in screen px (no re-placing on camera changes). The
	 * dash phase is anchored to the board: dashOffset = snapGuideDashOffset(from,
	 * scale of this call), so the dashes stay put while a guide grows or shrinks
	 * (a scale change alone keeps the old offset until the list changes again).
	 * Marks only the overlay dirty.
	 *
	 * @param {Array<{axis:'x'|'y', at:number, from:number, to:number}>|null} list guides (axis 'x': vertical
	 *   at x = at from y = from to y = to; 'y': horizontal at y = at); null or [] destroys every guide node
	 */
	setSnapGuides(list) {
		const want = Array.isArray(list) ? list : []
		while (this.#guides.length > want.length) this.#guides.pop().destroy()
		while (this.#guides.length < want.length) {
			const line = new Line({
				name: 'knorke-snap-guide',
				listening: false,
				perfectDrawEnabled: false,
				stroke: SNAP_GUIDE_COLOR,
				strokeWidth: SNAP_GUIDE_STROKE_PX,
				strokeScaleEnabled: false,
				dash: SNAP_GUIDE_DASH.slice(),
			})
			this.#ui.add(line)
			this.#guides.push(line)
		}
		const s = this.#cam.scale > 0 ? this.#cam.scale : 1
		want.forEach((g, i) => {
			this.#guides[i].setAttrs({
				points: g.axis === 'x' ? [g.at, g.from, g.at, g.to] : [g.from, g.at, g.to, g.at],
				dashOffset: snapGuideDashOffset(g.from, s),
			})
		})
		this.#invalidate(false, true)
	}

	/**
	 * Gap markers of a local drag in the uiGroup (M2, SPEC-M1 §1.2 (R12),
	 * equal gaps): one solid Line per marker in the guide color and width
	 * (screen px), the line along the gap with a cross tick of
	 * GAP_MARKER_TICK_PX screen px at both ends (gapMarkerPoints with the
	 * scale of this call; a scale change alone keeps the ticks' world length
	 * until the list changes again). Marks only the overlay dirty.
	 *
	 * @param {Array<{axis:'x'|'y', at:number, from:number, to:number}>|null} list markers (axis 'x':
	 *   horizontal from x = from to x = to at y = at; 'y': vertical at x = at); null or [] destroys every marker node
	 */
	setGapMarkers(list) {
		const want = Array.isArray(list) ? list : []
		while (this.#gapMarkers.length > want.length) this.#gapMarkers.pop().destroy()
		while (this.#gapMarkers.length < want.length) {
			const line = new Line({
				name: 'knorke-gap-marker',
				listening: false,
				perfectDrawEnabled: false,
				stroke: SNAP_GUIDE_COLOR,
				strokeWidth: SNAP_GUIDE_STROKE_PX,
				strokeScaleEnabled: false,
			})
			this.#ui.add(line)
			this.#gapMarkers.push(line)
		}
		const s = this.#cam.scale > 0 ? this.#cam.scale : 1
		want.forEach((m, i) => {
			this.#gapMarkers[i].setAttrs({ points: gapMarkerPoints(m, s) })
		})
		this.#invalidate(false, true)
	}

	/**
	 * Preview of a connect or retarget drag in the uiGroup (SPEC-M1 §6.3):
	 * the route as a dashed line (none while retargeting: the connector itself
	 * follows in the activeGroup), the outline of the item the end would bind
	 * to and its anchor dots (the snapped one filled). Sizes in screen px.
	 *
	 * @param {{points:number[], target:({x:number,y:number,w:number,h:number,r:number}|null),
	 *          anchors:Array<{x:number, y:number}>, snap:({x:number, y:number}|null)}|null} p preview, null removes it
	 */
	setConnectPreview(p) {
		const C = this.#connect
		if (!p) {
			if (!C.spec) return
			C.line?.destroy()
			C.target?.destroy()
			for (const d of C.dots) d.destroy()
			this.#connect = { spec: null, line: null, target: null, dots: [] }
			this.#invalidate(false, true)
			return
		}
		C.spec = {
			points: Array.isArray(p.points) ? p.points.slice() : [],
			target: p.target ? { ...p.target } : null,
			anchors: Array.isArray(p.anchors) ? p.anchors.map((a) => ({ x: a.x, y: a.y })) : [],
			snap: p.snap ? { x: p.snap.x, y: p.snap.y } : null,
		}
		if (!C.line) {
			C.line = new Line({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SELECTION_COLOR,
				strokeWidth: SELECTION_STROKE_PX,
				strokeScaleEnabled: false,
				dash: MULTI_FRAME_DASH.slice(),
				lineCap: 'round',
				lineJoin: 'round',
			})
			this.#ui.add(C.line)
		}
		if (!C.target) {
			C.target = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SELECTION_COLOR,
				strokeWidth: SELECTION_STROKE_PX,
				strokeScaleEnabled: false,
			})
			this.#ui.add(C.target)
		}
		while (C.dots.length < C.spec.anchors.length) {
			const dot = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SELECTION_COLOR,
				strokeWidth: HANDLE_STROKE_PX,
				strokeScaleEnabled: false,
			})
			this.#ui.add(dot)
			C.dots.push(dot)
		}
		while (C.dots.length > C.spec.anchors.length) C.dots.pop().destroy()
		this.#placeConnectPreview()
		this.#invalidate(false, true)
	}

	/** Places the connect preview for the current camera scale. */
	#placeConnectPreview() {
		const C = this.#connect
		if (!C.spec) return
		const s = this.#cam.scale > 0 ? this.#cam.scale : 1
		C.line.setAttrs({ points: C.spec.points, opacity: C.spec.points.length >= 4 ? 1 : 0 })
		this.#placeOutline(C.target, C.spec.target)
		const size = CONNECT_DOT_PX / s
		C.spec.anchors.forEach((a, i) => {
			const snapped = C.spec.snap !== null && C.spec.snap.x === a.x && C.spec.snap.y === a.y
			C.dots[i].setAttrs({
				x: a.x - size / 2, y: a.y - size / 2, width: size, height: size, cornerRadius: size / 2,
				fill: snapped ? SELECTION_COLOR : HANDLE_FILL,
			})
		})
	}

	/**
	 * @param {string|null} id container that would receive the dragged items
	 */
	setDropTarget(id) {
		if (id === this.#dropId) {
			return
		}
		this.#dropId = id
		if (this.#drop) {
			this.#drop.destroy()
			this.#drop = null
		}
		if (id !== null && this.#model.has(id)) {
			this.#drop = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: DROP_TARGET_COLOR,
				strokeWidth: DROP_TARGET_STROKE_PX,
				strokeScaleEnabled: false,
			})
			this.#ui.add(this.#drop)
			this.#placeUi()
		}
		this.#invalidate(false, true)
	}

	/**
	 * @param {string} id item id
	 * @param {boolean} hidden hide the Konva text while the editor is open
	 */
	setTextHidden(id, hidden) {
		if (hidden) this.#textHidden.add(id)
		else this.#textHidden.delete(id)
		const e = this.#entries.get(id)
		if (!e) return
		e.spec.setTextHidden(e, hidden)
		this.#invalidate(this.#attached.has(id), !this.#attached.has(id))
	}

	/**
	 * visible: the items in the cull rectangle (cullRectOf); overscan: the
	 * stage's overscan per side and its size (whole CSS px).
	 *
	 * @return {{nodesBuilt:number, attached:number, staticChildren:number, activeChildren:number,
	 *           uiChildren:number, locks:number, lod:number, visible:number, draws:{static:number, overlay:number, grid:number},
	 *           overscan:{l:number, r:number, t:number, b:number, stageW:number, stageH:number}}}
	 */
	stats() {
		return {
			handles: this.#handles.nodes.size,
			nodesBuilt: this.#entries.size,
			attached: this.#attached.size + this.#active.children.length,
			staticChildren: this.#static.children.length,
			activeChildren: this.#active.children.length,
			uiChildren: this.#ui.children.length,
			locks: this.#locks.drawn,
			groupOutlines: this.#groupSel.length,
			lod: this.#lod,
			visible: this.#visibleCount,
			draws: { ...this.#draws },
			overscan: { ...this.#ov },
		}
	}

	/**
	 * Ids attached to the static layer, in layer order (lab and tests); empty
	 * at LOD 2 (the one painting node is no item).
	 *
	 * @return {string[]}
	 */
	staticOrder() {
		return this.#static.children.map(kidOf).filter((id) => id !== undefined)
	}

	/** @return {0|1|2} the level of detail drawn now (SceneManager: hit test and handles at LOD 2) */
	lodLevel() {
		return this.#lod
	}

	/**
	 * Level a camera with this scale gets when it is applied next (the
	 * hysteresis starts from the level drawn now).
	 *
	 * @param {number} scale camera scale
	 * @return {0|1|2}
	 */
	lodAt(scale) {
		return lodFor(scale, this.#lod)
	}

	/**
	 * LOD 2 (lab and tests): the ids of the last painting in paint order, and
	 * how often the board was painted.
	 *
	 * @return {{ids:string[], paints:number}}
	 */
	coarsePainted() {
		return { ids: this.#coarse.painted.slice(), paints: this.#coarse.paints }
	}

	/**
	 * (R14-13) At LOD 2: the frame whose title, as the last painting drew it,
	 * lies under a world point (SceneManager: a click on the title selects the
	 * frame; SPEC-M1 §6.3 LOD 2 rule (d)).
	 *
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @param {number} [tol] hit tolerance (world)
	 * @return {string|null} frame id; null at LOD 0/1 and beside every painted title
	 */
	coarseTitleAt(wx, wy, tol = 0) {
		return this.#lod === 2 ? coarseTitleHit(this.#coarse.titleRects, wx, wy, tol) : null
	}

	/**
	 * LOD 2 (lab and tests): the title rectangles of the last painting in
	 * paint order (world units).
	 *
	 * @return {Array<{id:string, x:number, y:number, w:number, h:number}>}
	 */
	coarseTitles() {
		return this.#lod === 2 ? this.#coarse.titleRects.map((r) => ({ ...r })) : []
	}

	/**
	 * Text of the built Konva text node of an item (lab and tests).
	 *
	 * @param {string} id item id
	 * @return {string|null}
	 */
	nodeText(id) {
		const t = this.#entries.get(id)?.parts?.text
		return t ? t.text() : null
	}

	/**
	 * Layout Konva made of an item's text node (lab and tests: connector
	 * labels must not be cut, finding S-1b-01).
	 *
	 * @param {string} id item id
	 * @return {{rows: Array<{text:string, width:number}>, x:number, y:number, width:number,
	 *           height:number, fixedWidth:boolean}|null} null without a built text node
	 */
	nodeTextLayout(id) {
		const t = this.#entries.get(id)?.parts?.text
		if (!t) return null
		return {
			rows: (t.textArr ?? []).map((r) => ({ text: r.text, width: r.width })),
			x: t.x(),
			y: t.y(),
			width: t.width(),
			height: t.height(),
			fixedWidth: typeof t.attrs.width === 'number',
		}
	}

	/**
	 * Level an item's node is drawn at (lab and tests): the LOD, or for text
	 * items 0 = text, 1 = line bars.
	 *
	 * @param {string} id item id
	 * @return {number|null} null without a built node
	 */
	nodeLevel(id) {
		const e = this.#entries.get(id)
		return e ? e.lod : null
	}

	/** @return {object} the stage (lab only: spies) */
	get stage() {
		return this.#stage
	}

	// ------------------------------------------------------------ internals

	#invalidate(staticLayer, overlayLayer) {
		if (staticLayer) this.#dirty.static = true
		if (overlayLayer) this.#dirty.overlay = true
	}

	#overlayNonEmpty() {
		return this.#active.hasChildren() || this.#ui.hasChildren()
	}

	/** Synchronous draw of the static layer and the overlay when it has content or changed. */
	#drawNow() {
		this.#dirty.static = false
		this.#static.draw()
		if (this.#overlayNonEmpty() || this.#dirty.overlay) {
			this.#dirty.overlay = false
			this.#overlay.draw()
		}
	}

	#setTransform(css) {
		this.#css = css
		this.contentEl.style.transform = css ?? ''
	}

	/** stage.content at (−l, −t) of the host, the transform origin at the host's corner. */
	#placeContent() {
		const st = this.contentEl.style
		st.left = `${-this.#ov.l}px`
		st.top = `${-this.#ov.t}px`
		st.transformOrigin = `${this.#ov.l}px ${this.#ov.t}px`
	}

	#applyCamera(x, y, scale) {
		const scaleChanged = scale !== this.#cam.scale
		this.#cam = { x, y, scale }
		this.#shown = { x, y, scale }
		this.#paintGrid()
		this.#stage.setAttrs({ scaleX: scale, scaleY: scale, x: -x * scale + this.#ov.l, y: -y * scale + this.#ov.t })
		const prev = this.#lod
		const lod = lodFor(scale, prev)
		this.#lod = lod
		if (lod === 2 && prev !== 2) this.#enterCoarse()
		else if (prev === 2 && lod !== 2) this.#leaveCoarse()
		this.#cull()
		if (Math.min(lod, 1) !== Math.min(prev, 1)) {
			for (const id of this.#attached) this.#syncLod(id)
			for (const id of this.#dragging) this.#syncLod(id)
			for (const id of this.#previews.keys()) this.#syncLod(id)
		} else if (scaleChanged && lod >= 1) {
			// text items switch between text and line bars with fontSize · scale
			for (const id of this.#scaleIds) {
				if (this.#isLive(id)) this.#syncLod(id)
			}
		}
		if ((lod === 2) !== (prev === 2)) this.#syncRoutedActive()
		if (scaleChanged) {
			this.#placeHandles()
			this.#placeConnectPreview()
		}
	}

	/**
	 * LOD 2 starts: the static layer gives up its nodes (the entries stay in
	 * the cache) and takes the one painting node.
	 */
	#enterCoarse() {
		this.#static.removeChildren()
		this.#attached.clear()
		this.#static.add(this.#coarseNode())
	}

	/** LOD 2 ends: the painting node leaves; the culling attaches the item nodes again. */
	#leaveCoarse() {
		this.#coarse.node?.remove()
		this.#coarse.hits = []
		this.#coarse.painted = []
		this.#coarse.titleRects = []
	}

	/** @return {object} the LOD-2 node (built once per renderer and reset) */
	#coarseNode() {
		if (!this.#coarse.node) {
			this.#coarse.node = buildCoarse(this.#ctx, (context) => this.#paintCoarse(context))
		}
		return this.#coarse.node
	}

	/**
	 * sceneFunc of the LOD-2 node: plans the culled ids (skipping the
	 * activeGroup and every connector) and paints them; renews the paint
	 * order when it is missing or stale.
	 *
	 * @param {object} context Konva context with the camera transform
	 */
	#paintCoarse(context) {
		const c = this.#coarse
		const skip = (id) => this.#dragging.has(id) || this.#previews.has(id)
		let plan = c.order ? planCoarse(this.#model, c.hits, skip, c.order) : null
		if (!plan) {
			c.order = coarseOrder(this.#model)
			plan = planCoarse(this.#model, c.hits, skip, c.order) ?? { frames: [], groups: new Map(), painted: [] }
		}
		c.painted = plan.painted
		c.paints++
		c.titleRects = []
		paintCoarse(context, plan, this.#cam.scale, c.titles, c.titleRects)
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} LOD 2 paints this item (everything but connectors)
	 */
	#paintedAtLod2(id) {
		const it = this.#model.get(id)
		return !!it && typeInfo(it.t).hit !== 'line'
	}

	/**
	 * A node joins the activeGroup (drag, transform, remote preview); at LOD 2
	 * a connector stays out of every layer (R13 (b)).
	 *
	 * @param {object} e entry
	 */
	#toActive(e) {
		if (this.#lod === 2 && e.spec.routed) e.root.remove()
		else e.root.moveTo(this.#active)
	}

	/** LOD 2 started or ended while items are active: their connectors leave or rejoin the activeGroup. */
	#syncRoutedActive() {
		let moved = false
		for (const id of new Set([...this.#dragging, ...this.#previews.keys()])) {
			const e = this.#entries.get(id)
			if (!e || !e.spec.routed) continue
			const inActive = e.root.getParent() === this.#active
			if (this.#lod === 2 && inActive) {
				e.root.remove()
				moved = true
			} else if (this.#lod !== 2 && !inActive) {
				e.root.moveTo(this.#active)
				moved = true
			}
		}
		if (moved) {
			this.#sortActive()
			this.#invalidate(false, true)
		}
	}

	/**
	 * @param {object} spec node spec
	 * @param {object} it WireItem
	 * @return {number} the level the spec draws at now (the LOD, or levelOf for scale-sensitive
	 *   specs); nodes at LOD 2 (activeGroup only) draw like LOD 1
	 */
	#levelOf(spec, it) {
		const lod = Math.min(this.#lod, 1)
		return typeof spec.levelOf === 'function' ? spec.levelOf(it, lod, this.#cam.scale) : lod
	}

	/** @param {string} id item id with a built entry */
	#syncLod(id) {
		const e = this.#entries.get(id)
		if (!e) return
		const it = this.#model.get(id)
		if (!it) return
		const level = this.#levelOf(e.spec, it)
		if (e.lod === level) return
		e.spec.setLod(this.#ctx, e, it, this.#boxFor(id, e.spec), level)
	}

	/**
	 * @param {string} id item id
	 * @param {object} spec its node spec
	 * @return {object|null} what the spec draws from: the absolute box, or the
	 *   model's route for a routed spec (connector)
	 */
	#boxFor(id, spec) {
		return spec.routed ? this.#model.routeOf(id) : this.#model.abs(id)
	}

	#isLive(id) {
		return this.#attached.has(id) || this.#dragging.has(id) || this.#previews.has(id)
	}

	/**
	 * Entry for an item: built on first use, refreshed when stale, LOD synced.
	 *
	 * @param {string} id item id (must exist in the model)
	 * @return {object} entry
	 */
	#ensure(id) {
		let e = this.#entries.get(id)
		if (!e) {
			const it = this.#model.get(id)
			const spec = nodeSpecFor(it.t)
			e = spec.build(this.#ctx, it, this.#boxFor(id, spec), this.#levelOf(spec, it), this.#textHidden.has(id))
			e.spec = spec
			e.type = it.t
			e.root.setAttr('kid', id)
			this.#entries.set(id, e)
			if (spec.scaleSensitive) this.#scaleIds.add(id)
			return e
		}
		if (e.stale) {
			const fields = e.stale
			e.stale = null
			e = this.#refresh(id, e, fields)
		}
		this.#syncLod(id)
		return e
	}

	/**
	 * Updates an entry for changed fields; rebuilds it when the builder asks.
	 *
	 * @param {string} id item id
	 * @param {object} e entry
	 * @param {Set<string>} fields changed fields
	 * @return {object} the (possibly new) entry
	 */
	#refresh(id, e, fields) {
		const it = this.#model.get(id)
		const a = this.#boxFor(id, e.spec)
		const rebuild = it.t !== e.type || e.spec.update(this.#ctx, e, it, a, fields, e.lod)
		if (rebuild) {
			const parent = e.root.getParent()
			const index = parent ? e.root.index : -1
			e.root.destroy()
			this.#entries.delete(id)
			this.#scaleIds.delete(id)
			const fresh = this.#ensure(id)
			this.#placeEntry(id, fresh)
			if (parent) {
				parent.add(fresh.root)
				fresh.root.zIndex(Math.min(index, parent.children.length - 1))
			}
			return fresh
		}
		this.#placeEntry(id, e)
		// a style change can move a text item across TEXT_MIN_PX
		if (e.spec.scaleSensitive) this.#syncLod(id)
		return e
	}

	/**
	 * @param {string} id item id
	 * @param {object} e entry
	 */
	#placeEntry(id, e) {
		if (e.spec.routed) {
			// routed (connector): drawn from the model's route, which already
			// follows local drags and (box resolver) remote drag previews
			const it = this.#model.get(id)
			if (it) e.spec.place(this.#ctx, e, it, this.#model.routeOf(id))
			return
		}
		const a = this.#model.abs(id)
		if (!a) return
		const off = this.#previews.get(id)
		place(e, off ? { x: a.x + off.dx, y: a.y + off.dy, w: a.w, h: a.h, r: a.r } : a)
	}

	/**
	 * @param {string} id item id
	 * @param {object} root entry root
	 */
	#insertInOrder(id, root) {
		const kids = this.#static.children
		const i = insertIndex(kids, id, (a, b) => this.#model.compareOrder(a, b), kidOf)
		this.#static.add(root)
		if (i < kids.length - 1) {
			root.zIndex(i)
		}
	}

	#sortActive() {
		const kids = this.#active.children.slice()
		kids.sort((a, b) => this.#model.compareOrder(kidOf(a), kidOf(b)))
		kids.forEach((n, i) => {
			if (n.index !== i) n.zIndex(i)
		})
	}

	/**
	 * Detach what left the cull rectangle (the stage with its overscan, per
	 * side at least CULL_MARGIN of the viewport), build and insert what
	 * entered. At LOD 2 only the list of index entries in view is kept (the
	 * painting reads it; no node moves).
	 */
	#cull() {
		this.#cullNodes()
		this.#syncLocks()
	}

	/** The culling itself (see #cull). */
	#cullNodes() {
		if (!this.#stage) return
		const r = cullRectOf(this.#cam, this.#w, this.#h, this.#ov, CULL_MARGIN)
		const hits = this.#model.query(r.minX, r.minY, r.maxX, r.maxY)
		this.#visibleCount = hits.length
		if (this.#lod === 2) {
			this.#coarse.hits = hits
			return
		}
		const exempt = new Set(this.#dragging)
		for (const id of this.#previews.keys()) exempt.add(id)
		const { enter, leave, next } = diffVisible(this.#attached, hits.map((e) => e.id), exempt)
		for (const id of leave) {
			this.#entries.get(id)?.root.remove()
		}
		if (enter.length === 0) {
			this.#attached = next
			return
		}
		const remaining = this.#attached.size - leave.length
		if (shouldBulkReattach(enter.length, remaining)) {
			this.#static.removeChildren()
			const roots = []
			for (const id of this.#model.sortByOrder(next)) {
				const e = this.#ensure(id)
				this.#placeEntry(id, e)
				roots.push(e.root)
			}
			if (roots.length) this.#static.add(...roots)
		} else {
			for (const id of this.#model.sortByOrder(enter)) {
				const e = this.#ensure(id)
				this.#placeEntry(id, e)
				this.#insertInOrder(id, e.root)
			}
		}
		this.#attached = next
	}

	/** @return {string[]} the ids in view: the coarse hits at LOD 2, else attached, dragged and previewed */
	#inView() {
		if (this.#lod === 2) return this.#coarse.hits.map((e) => e.id)
		return [...this.#attached, ...this.#dragging, ...this.#previews.keys()]
	}

	/**
	 * The lock node exists exactly while a locked item is in view (M2, R20);
	 * a board without one keeps the uiGroup as it was.
	 */
	#syncLocks() {
		if (!this.#ui) return
		const coarse = this.#lod === 2
		const want = this.#inView().some((id) => {
			const it = this.#model.get(id)
			return isLocked(it) && !(coarse && typeInfo(it.t).hit === 'line')
		})
		if (want && !this.#locks.node) {
			this.#locks.node = buildLocks(this.#ctx, (context) => this.#paintLocks(context))
			this.#ui.add(this.#locks.node)
			this.#invalidate(false, true)
		} else if (!want && this.#locks.node) {
			this.#locks.node.destroy()
			this.#locks.node = null
			this.#locks.drawn = 0
			this.#invalidate(false, true)
		}
	}

	/**
	 * sceneFunc of the lock node: plans the locked items in view and paints
	 * them; the count of this painting becomes stats().locks.
	 *
	 * @param {object} context Konva context with the camera transform
	 */
	#paintLocks(context) {
		const plan = planLocks(this.#model, this.#inView(), { lod: this.#lod, offsetOf: (id) => this.#previews.get(id) ?? null })
		this.#locks.drawn = paintLocks(context, plan, this.#cam.scale)
	}

	#clearUi() {
		for (const s of this.#sel) s.node.destroy()
		this.#sel = []
		for (const s of this.#groupSel) s.node.destroy()
		this.#groupSel = []
		this.#selSig = ''
		this.setHandles(null)
		this.#marquee?.destroy()
		this.#marquee = null
		this.#drop?.destroy()
		this.#drop = null
		this.#dropId = null
		this.setConnectPreview(null)
		this.setSnapGuides(null)
		this.setGapMarkers(null)
	}

	/**
	 * Positions selection outlines and the drop target on the current boxes
	 * (including drag and preview offsets).
	 *
	 * @return {boolean} true when any outline moved
	 */
	#placeUi() {
		let changed = false
		const box = (id) => {
			const a = this.#model.abs(id)
			if (!a) return null
			const off = this.#previews.get(id)
			return off ? { ...a, x: a.x + off.dx, y: a.y + off.dy } : a
		}
		for (const s of this.#sel) {
			if (s.line) {
				changed = this.#placeLineOutline(s.node, this.#model.routeOf(s.id)) || changed
				continue
			}
			const a = box(s.id)
			changed = this.#placeOutline(s.node, a) || changed
		}
		for (const s of this.#groupSel) {
			// the axis-parallel union of the members' rotated boxes (M2, R20)
			let u = null
			for (const id of s.ids) {
				const a = box(id)
				if (!a) continue
				const [x0, y0, x1, y1] = rotatedBBox(a.x, a.y, a.w, a.h, a.r || 0)
				u = u === null ? [x0, y0, x1, y1] : [Math.min(u[0], x0), Math.min(u[1], y0), Math.max(u[2], x1), Math.max(u[3], y1)]
			}
			changed = this.#placeOutline(s.node, u === null ? null : { x: u[0], y: u[1], w: u[2] - u[0], h: u[3] - u[1], r: 0 }) || changed
		}
		if (this.#drop) {
			changed = this.#placeOutline(this.#drop, box(this.#dropId)) || changed
		}
		return changed
	}

	/**
	 * Places the transformer handles for the current camera scale: squares of
	 * HANDLE_PX screen px (the rotation handle round), the union frame and the
	 * line to the rotation handle.
	 *
	 * @return {boolean} true when any node changed
	 */
	#placeHandles() {
		const H = this.#handles
		if (H.nodes.size === 0 && !H.outlineNode) return false
		const s = this.#cam.scale > 0 ? this.#cam.scale : 1
		let changed = false
		const apply = (node, attrs) => {
			for (const k of Object.keys(attrs)) {
				const v = attrs[k]
				const cur = node.getAttr(k)
				if (Array.isArray(v) ? JSON.stringify(cur) !== JSON.stringify(v) : cur !== v) {
					node.setAttrs(attrs)
					changed = true
					return
				}
			}
		}
		for (const h of H.list) {
			const node = H.nodes.get(h.name)
			if (!node) continue
			const look = handleLook(h.name)
			const size = look.size / s
			apply(node, { x: h.x - size / 2, y: h.y - size / 2, width: size, height: size, cornerRadius: look.round ? size / 2 : 0 })
		}
		if (H.outlineNode && H.outline) {
			apply(H.outlineNode, { x: H.outline.x, y: H.outline.y, width: H.outline.w, height: H.outline.h })
		}
		const rot = H.list.find((h) => h.name === 'rot')
		if (H.rotLine && H.rotFrom && rot) {
			apply(H.rotLine, { points: [H.rotFrom.x, H.rotFrom.y, rot.x, rot.y] })
		}
		return changed
	}

	/**
	 * @param {object} node halo line of a selected connector
	 * @param {{geom:{hitPts:number[]}}|null} route its route (null: hidden)
	 * @return {boolean} true when attributes changed
	 */
	#placeLineOutline(node, route) {
		const pts = route ? route.geom.hitPts : []
		const opacity = route ? LINE_SELECTION_OPACITY : 0
		const cur = node.getAttr('points') ?? []
		let same = cur.length === pts.length && node.getAttr('opacity') === opacity
		for (let i = 0; same && i < pts.length; i++) same = cur[i] === pts[i]
		if (same) return false
		node.setAttrs({ points: pts.slice(), opacity })
		return true
	}

	/**
	 * @param {object} node outline rect
	 * @param {object|null} a absolute box or null (hidden)
	 * @return {boolean} true when attributes changed
	 */
	#placeOutline(node, a) {
		const attrs = a
			? (a.r
				? { x: a.x + a.w / 2, y: a.y + a.h / 2, offsetX: a.w / 2, offsetY: a.h / 2, rotation: a.r, width: a.w, height: a.h, opacity: 1 }
				: { x: a.x, y: a.y, offsetX: 0, offsetY: 0, rotation: 0, width: a.w, height: a.h, opacity: 1 })
			: { opacity: 0 }
		let changed = false
		for (const k of Object.keys(attrs)) {
			if (node.getAttr(k) !== attrs[k]) {
				changed = true
				break
			}
		}
		if (changed) node.setAttrs(attrs)
		return changed
	}
}

export { ALL_FIELDS }
