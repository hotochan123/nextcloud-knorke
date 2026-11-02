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
 * - (job 231, redesign V8) the own selection's color: setSelectionColor(c)
 *   (the scene, at mount: the theme's primary color, model/tokens.js
 *   selectionColorOf) colors every own selection mark in the uiGroup
 *   (outlines, group and multi frames, handles, connection points, the "+"
 *   buttons, the "+" and connect previews, the ghost of a dragged node);
 *   SELECTION_COLOR until then. setHandles draws only the handles it gets
 *   (the scene decides which show) at the size of handleLook for the mouse
 *   or for a pen or finger (touch); no line to the rotation handle.
 *   stats().selectionColor is the color.
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
 *   static layer is drawn once, never while dragging. Connector nodes stay
 *   out of every layer at LOD 2 (R13 (b)), (job 202) the painting draws
 *   them as thin lines (planCoarse at the camera's scale), but not the ones
 *   moving with a drag or a preview (they are in the activeGroup set).
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
 *   at every LOD, (job 151) only in mode edit (setMode; the constructor's
 *   mode, missing = edit). It exists only while a locked item is in view in
 *   mode edit (no extra shape, unchanged child counts otherwise), moves with
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
 * - selection frame with a gap (job 140): item, remote, group and
 *   multi-selection outlines lie on gapFrame() of their box, union or
 *   frame, SELECTION_GAP_PX screen px outside (rotated with the item); a
 *   scale change re-places them with the handles (overlay only), a CSS
 *   gesture scales them with the picture until the next drawing. Connector
 *   halos, the drop target and the connect target stay on the edge.
 *   stats().outlines lists the visible frames as placed (world units).
 * - title hint (job 143, nodes/titleHint.js): setTitleHint(id) puts ONE
 *   hint "Add title…" into the uiGroup (job 243: a dashed tab with the
 *   text), on the top left edge of frame id, and re-places it with the
 *   outlines (#placeUi: model changes, drags, remote previews); null
 *   removes it. The scene decides when it shows.
 * - title widths (job 158, the scene's text zone of a second click on a
 *   frame title): measureTitleWidth(text, weight) measures one line in the title
 *   font (job 243: also the hint's regular weight; ctx.measureTitle, the frame
 *   node's tab) with a detached Konva text (like measureTextHeight, only when
 *   asked); coarseTitleWidth(id) gives the width of a frame's title as the
 *   last LOD-2 painting drew it.
 * - shape text lines (job 177, the scene's text zone of a shape without
 *   fill): measureShapeLines(item, abs) lays the text out in a detached
 *   Konva text with the attributes of the shape's text node (nodes/shape.js
 *   shapeTextAttrs, SHAPE_TEXT_LAYOUT) and gives the widths of the lines it
 *   draws, only when asked.
 * - "+" preview (job 162): setPlusPreview({kind, box}) puts ONE Rect into
 *   the uiGroup on the rotated box (absolute, world): SELECTION_COLOR at
 *   PLUS_PREVIEW_OPACITY with a SELECTION_STROKE_PX screen-px stroke, solid
 *   for 'connect' (the item a click connects to), dashed for 'neighbour'
 *   (where the new neighbour lands); null removes it. The scene decides
 *   when it shows and hands a new box whenever it changes.
 * - tables (job 173, nodes/table.js): the node lays out its rows by the
 *   measured text heights (ctx.measureCell = measureCellHeight: a detached
 *   Konva text with the cell's attributes, remembered per text, width and
 *   weight); setTablePreview(id, p) draws one table as a local preview
 *   (a column border being dragged, the text of the open cell editor;
 *   model/table.js previewTable), null ends it; setTextHidden(id, hidden,
 *   cell) hides only the text of that cell.
 * - mind maps (job 195, nodes/mindmap.js): the node lays out its tree by
 *   the measured texts (ctx.measureNode = measureNodeText, a detached Konva
 *   text, remembered); setTablePreview(id, {key, text}) draws the text of
 *   the open node editor (model/mindmap.js previewMindmap); setTextHidden
 *   with the node's key hides only its text; setMindmapUi(id, ui) the focus
 *   outline and the hollow dots of this tab; setNodeDragPreview the ghost
 *   of a dragged node and the mark of its drop target in the uiGroup.
 * - reaction rows (job 172, nodes/reactions.js): setReactions(state) keeps
 *   the scene's ReactState; ONE Konva.Shape at the bottom of the uiGroup
 *   paints the rows of the notes in view in world units, rotated with each
 *   note, only at LOD 0 and only while a note in view has a row. A change of
 *   an item's reactions alone (ChangeField react) rebuilds no node and
 *   touches no static layer; the rows follow with the overlay.
 *   stats().reactions lists the rows of the last painting ({id, shown: [[e,
 *   n, mine]], more, add}). The local outline of the selected note
 *   (state.selected) reaches the band below it (gapFrame below:
 *   reactionBand) while the note shows a row.
 * - image export (job 178, scene/exportImage.js): renderImage(job) builds
 *   the image's nodes at LOD 0 into ONE detached group of its own (never in
 *   a layer), paints the reaction rows and vote badges of job.plan over
 *   them and turns the group into a PNG Blob through one canvas at pixel
 *   ratio 1; the stage, the culling, the LOD and the uiGroup stay as they are.
 *   (Job 200) renderVector(job) builds the same group without the scale and
 *   the white rectangle and draws it, item by item, into a VectorContext
 *   (scene/vectorContext.js) under a Konva SceneCanvas instead of pixels;
 *   exportSvg.js or exportPdf.js writes the commands as a Blob. The browser
 *   measures and rasterises the text (exportTextMetrics, exportRasterText).
 *   (Job 217) Those three modules are the lazy part vector
 *   (util/parts.js): renderVector loads it first (the session did already).
 *   (Job 203) Both wait up to EXPORT_PICTURE_WAIT_MS for the pictures of
 *   their own shapes (imageCache.js); the PDF gets them rasterised
 *   (exportRasterImage).
 * - note preview (job 188): setNotePreview({x, y, w, h, fill}) puts ONE Rect
 *   into the uiGroup, the note being taken off a pad (world units, the
 *   corners of a note, NOTE_PREVIEW_OPACITY); null removes it. Only this
 *   client sees it; the scene moves it with the pointer.
 * - tags (job 191, nodes/tags.js): setTags(list) puts the board's tag map
 *   into the builder context (ctx.tags) and renews the tag row and text of
 *   every built note (field 'tags'; a detached one when it is attached
 *   again), nothing else; the rows are part of the note nodes, so they
 *   stack, move and export with them (renderImage draws them at LOD 0).
 *   setTagFilter(ids) fades every note without a chosen tag to
 *   TAG_FADE_OPACITY (root opacity; at LOD 2 its box in the coarse
 *   painting), never another type, never the image; null or [] ends it.
 *   stats().tags lists the rows of the built notes in view ({id, shown,
 *   more}, nodes/tags.js tagStat; [] at LOD 2), stats().tagFilter is
 *   {chosen, faded} (faded: every note of the model the filter fades) or
 *   null.
 */
import Konva from 'konva/lib/Core'
import { SceneCanvas } from 'konva/lib/Canvas'
import { Line } from 'konva/lib/shapes/Line'
import { Rect } from 'konva/lib/shapes/Rect'
import { Text } from 'konva/lib/shapes/Text'
import {
	CONNECTOR_END_PX, DROP_TARGET_COLOR, DROP_TARGET_STROKE_PX, SEARCH_HIT_COLOR, SEARCH_HIT_GAP_PX, SEARCH_HIT_STROKE_PX, FONT_FAMILY, FRAME_TITLE_HINT_WEIGHT, FRAME_TITLE_SIZE, FRAME_TITLE_WEIGHT, GAP_MARKER_TICK_PX,
	HANDLE_FILL, HANDLE_STROKE_PX, HANDLE_VIEW_PX, HANDLE_VIEW_TOUCH_PX, LINE_HEIGHT, TRANSFORM_HANDLE_PX, TRANSFORM_HANDLE_TOUCH_PX, MARQUEE_FILL, MARQUEE_STROKE, MULTI_FRAME_DASH, SELECTION_COLOR,
	SELECTION_STROKE_PX, SNAP_GUIDE_COLOR, SNAP_GUIDE_DASH, SNAP_GUIDE_STROKE_PX, STICKY_RADIUS, TAG_FADE_OPACITY, shownColor,
} from '../model/tokens.js'
import { fadedNotes, noteTagIds, tagMap } from '../model/tags.js'
import { labelBox, routeConnector } from '../model/connectors.js'
import { rotatedBBox } from '../model/geometry.js'
import { fieldValue, typeInfo } from '../model/registry.js'
import { isLocked } from '../model/locks.js'
import { gapFrame } from '../model/transform.js'
import { cssTransformFor, cullRectOf, needsGestureRedraw, overscanLayout, overscanResize } from './Camera.js'
import { diffVisible } from './culling.js'
import { EXPORT_BACKGROUND, EXPORT_BADGE_SCALE } from './exportImage.js'
import { gridLines, paintGrid } from './grid.js'
import { BADGES_NONE, badgeAt, buildBadges, paintBadges, planBadges } from './nodes/badges.js'
import { buildCoarse, coarseOrder, coarseTitleHit, lodFor, paintCoarse, planCoarse } from './nodes/coarse.js'
import { SHAPE_BASE } from './nodes/common.js'
import { nodeSpecFor, place } from './nodes/index.js'
import { drawStructPlus, isStructPlus, structPlusSize } from './nodes/plusButton.js'
import { frameOutline, traceFrame } from './nodes/frame.js'
import { buildLocks, paintLocks, planLocks } from './nodes/locks.js'
import { buildReactions, paintReactions, planReactions, reactionBand, rowOf, rowStat } from './nodes/reactions.js'
import { SHAPE_TEXT_LAYOUT, shapeTextAttrs } from './nodes/shape.js'
import { cellTextAttrs } from './nodes/table.js'
import { dropMark, nodeTextAttrs } from './nodes/mindmap.js'
import { textItemAttrs } from './nodes/text.js'
import { aiCardHeight } from './nodes/ai.js'
import { isRich, richLayout, textLinkAt } from './nodes/richText.js'
import { hasMarks } from '../model/richText.js'
import { previewTable } from '../model/table.js'
import { previewMindmap } from '../model/mindmap.js'
import { previewLanes } from '../model/lanes.js'
import { tagStat } from './nodes/tags.js'
import { buildSnapLabel, placeSnapLabel } from './nodes/snapLabel.js'
import { buildTitleHint, placeTitleHint, titleHintText } from './nodes/titleHint.js'
import { insertIndex, shouldBulkReattach } from './order.js'
import { loadPart } from '../util/parts.js'
import { imageFor, pictureOf, whenImagesReady } from './imageCache.js'

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
/** (job 162) Opacity of the "+" preview outline. */
const PLUS_PREVIEW_OPACITY = 0.5
/** (job 195) Opacity of the ghost of a dragged mind map node. */
const NODE_GHOST_OPACITY = 0.3
/** (job 188) Opacity of the note being taken off a pad. */
const NOTE_PREVIEW_OPACITY = 0.85
/** (job 173) Cell heights remembered by measureCellHeight, cleared above this size. */
const CELL_MEASURE_MAX = 4000
/** Period of the snap guide dash pattern (screen px). */
const SNAP_GUIDE_PERIOD = SNAP_GUIDE_DASH.reduce((sum, d) => sum + d, 0)

/** (Job 200) The 2D context that measures the text of a vector export (made on first use). */
let exportMeasure = null

/** @return {CanvasRenderingContext2D} the measuring context */
function measureContext() {
	if (!exportMeasure) exportMeasure = Konva.Util.createCanvasElement().getContext('2d')
	return exportMeasure
}

/**
 * (Job 200) The browser's width of a text in a canvas font and, for a
 * textBaseline other than alphabetic, the shift down to the alphabetic
 * baseline (the ascent of "M" under both baselines: the baseline sits where
 * the font's metrics put it, whatever glyph is measured).
 *
 * @param {string} font canvas font
 * @param {string} text text
 * @param {string} [baseline] textBaseline
 * @return {{width: number, shift: number}}
 */
function exportTextMetrics(font, text, baseline = 'alphabetic') {
	const c = measureContext()
	c.font = font
	c.textBaseline = 'alphabetic'
	const width = c.measureText(text).width
	if (baseline === 'alphabetic') return { width, shift: 0 }
	const a0 = c.measureText('M').actualBoundingBoxAscent
	c.textBaseline = baseline
	const a1 = c.measureText('M').actualBoundingBoxAscent
	c.textBaseline = 'alphabetic'
	return { width, shift: Number.isFinite(a0 - a1) ? a0 - a1 : 0 }
}

/**
 * (Job 200) A CSS colour as the browser reads it (named colours of the
 * export), null when the browser rejects it.
 *
 * @param {string} s CSS colour
 * @return {string|null} #rrggbb or rgba()
 */
function exportCssColor(s) {
	const c = measureContext()
	c.fillStyle = '#000000'
	c.fillStyle = s
	const a = c.fillStyle
	c.fillStyle = '#ffffff'
	c.fillStyle = s
	return a === c.fillStyle ? a : null
}

/**
 * @param {number} w width (px)
 * @param {number} h height (px)
 * @return {HTMLCanvasElement} a canvas of that size
 */
function exportCanvas(w, h) {
	const c = Konva.Util.createCanvasElement()
	c.width = w
	c.height = h
	return c
}

/** (Job 203) Longest wait of an export for the pictures of its own shapes (ms); one not decoded by then is its placeholder. */
export const EXPORT_PICTURE_WAIT_MS = 5000

/**
 * (Job 203) The picture of an own shape for the PDF, drawn by the browser
 * stretched over width × height px.
 *
 * @param {string} src the picture (decoded: imageCache)
 * @param {number} width px
 * @param {number} height px
 * @return {{width: number, height: number, data: Uint8ClampedArray}|null} null when it is not decoded
 */
function exportRasterImage(src, width, height) {
	const img = imageFor(src)
	if (!img || !(width > 0 && height > 0)) return null
	const canvas = exportCanvas(width, height)
	try {
		const g = canvas.getContext('2d')
		g.drawImage(img, 0, 0, width, height)
		return { width, height, data: g.getImageData(0, 0, width, height).data }
	} catch (err) {
		return null
	} finally {
		canvas.width = 0
		canvas.height = 0
	}
}

/**
 * (Job 200) A text run of the PDF that WinAnsi cannot encode, drawn by the
 * browser at px pixels per world unit with a margin of a quarter of the font
 * size around its advance and the font's ascent and descent.
 *
 * @param {(font: string) => {size: number}} parseFont vectorContext.js parseFont (job 217: of the lazy part)
 * @param {string} font canvas font
 * @param {string} text the run
 * @param {string} color CSS colour
 * @param {number} px pixels per world unit
 * @return {{width: number, height: number, data: Uint8ClampedArray, top: number, left: number}|null}
 *   RGBA; top: units from the baseline up to the top edge; left: units from the run's x to the left edge
 */
function exportRasterText(parseFont, font, text, color, px) {
	const c = measureContext()
	c.font = font
	c.textBaseline = 'alphabetic'
	const m = c.measureText(text)
	const size = parseFont(font).size
	const pad = size / 4
	const asc = Math.max(m.fontBoundingBoxAscent || 0, m.actualBoundingBoxAscent || 0, 0.8 * size)
	const desc = Math.max(m.fontBoundingBoxDescent || 0, m.actualBoundingBoxDescent || 0, 0.2 * size)
	const width = Math.ceil((m.width + 2 * pad) * px)
	const height = Math.ceil((asc + desc + 2 * pad) * px)
	if (!(width > 0 && height > 0)) return null
	const canvas = exportCanvas(width, height)
	try {
		const g = canvas.getContext('2d')
		g.scale(px, px)
		g.font = font
		g.textBaseline = 'alphabetic'
		g.fillStyle = color
		g.fillText(text, pad, pad + asc)
		const img = g.getImageData(0, 0, width, height)
		return { width, height, data: img.data, top: pad + asc, left: -pad }
	} finally {
		canvas.width = 0
		canvas.height = 0
	}
}

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
 * Look of a handle by name ([S]-internal), sizes in screen px: (job 231,
 * redesign V8) transformer squares with rounded corners (radius), the round
 * rotation handle and round connection points (plus-t/r/b/l), all hollow,
 * HANDLE_VIEW_PX for the mouse and HANDLE_VIEW_TOUCH_PX for a pen or a
 * finger; hollow round connector ends (CONNECTOR_END_PX, with a pen or a
 * finger HANDLE_VIEW_TOUCH_PX); the filled round "+" buttons of tables,
 * mind maps and lanes. (Job 262, design round 4 R4) The transformer handles
 * (corners, sides, rotation) are white circles of TRANSFORM_HANDLE_PX
 * (pen, finger: TRANSFORM_HANDLE_TOUCH_PX); the "+" buttons are
 * STRUCT_PLUS_PX circles with a white plus (plus: true), "+ Lane" a pill
 * w wide with its word (label).
 *
 * @param {string} name handle name
 * @param {boolean} [touch] a pen or a finger
 * @param {string} [color] the selection color
 * @return {{size:number, w:number, round:boolean, radius:number, fill:string, stroke:string, plus:boolean, label:string}}
 */
export function handleLook(name, touch = false, color = SELECTION_COLOR) {
	const view = touch ? HANDLE_VIEW_TOUCH_PX : HANDLE_VIEW_PX
	const look = (size, fill, stroke) => ({ size, w: size, round: true, radius: 0, fill, stroke, plus: false, label: '' })
	if (name.startsWith('plus-')) return look(view, HANDLE_FILL, color)
	// job 173: the "+" of a table (table-col, table-row)
	// job 195: so does the "+" of a mind map node (mm-child, mm-sibling, mm-child-r, mm-child-l)
	// job 199: and the "+" of a frame with lanes (lane-add; job 208: col-add)
	if (isStructPlus(name)) {
		const s = structPlusSize(name)
		return { ...look(s.h, color, HANDLE_FILL), w: s.w, plus: true, label: s.label }
	}
	if (name === 'start' || name === 'end') return look(touch ? view : CONNECTOR_END_PX, HANDLE_FILL, color)
	return look(touch ? TRANSFORM_HANDLE_TOUCH_PX : TRANSFORM_HANDLE_PX, HANDLE_FILL, color)
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
	/** (job 173) table id → the cell whose text is hidden for the editor @type {Map<string, string>} */
	#hiddenCell = new Map()
	/** (job 173) table id → its local preview (previewTable) @type {Map<string, object>} */
	#tablePreview = new Map()
	/** (job 173) detached text node for measureCellHeight and its results ('bold|width|text' → height) */
	#cellMeasurer = null
	#cellHeights = new Map()
	/** (job 195) detached text of the node measurement, and what it measured (text, width, size, weight → {w, h}) */
	#nodeMeasurer = null
	#nodeSizes = new Map()
	/** (job 195) mind map id → what this tab shows on it ({focus, hover, dots}) */
	#mmUi = new Map()
	/** (job 262) the locally selected frames whose tab is tinted */
	#tinted = new Set()
	/** (job 195) the node drag preview in the uiGroup: {group, ghost, mark} */
	#nodeDrag = null
	#dirty = { static: false, overlay: false }
	#draws = { static: 0, overlay: 0, grid: 0 }
	#visibleCount = 0
	#base = null
	#css = null
	/** selection outlines: [{id, color, local, node, placed}] (placed: the frame drawn, null while hidden) */
	#sel = []
	/** outlines of fully selected groups (M2, R20): [{ids, node, placed}] */
	#groupSel = []
	#selSig = ''
	#marquee = null
	#drop = null
	#dropId = null
	/** (job 271) the frame around the current search hit, and its item */
	#hit = null
	#hitId = null
	/** snap guide lines of a local drag or resize (uiGroup) */
	#guides = []
	/** gap marker lines of a local drag (uiGroup) */
	#gapMarkers = []
	/** (job 194) measuring lines of the guides of a local drag or resize (uiGroup) */
	#measures = []
	/** (job 194) distance labels of a local drag or resize: [{label, node}] (uiGroup) */
	#labels = []
	/** (job 194) the size label of a local resize: {label, node} (node null without one) */
	#sizeLabel = { label: null, node: null }
	/** built entries of scale-sensitive specs (text items) @type {Set<string>} */
	#scaleIds = new Set()
	/** transformer handles: world positions + Konva nodes (placed: the multi-selection frame drawn) */
	#handles = { list: [], outline: null, nodes: new Map(), outlineNode: null, placed: null, touch: false }
	/** (job 231) the color of the own selection marks (setSelectionColor) */
	#selColor = SELECTION_COLOR
	/** transform preview of the activeGroup, or null */
	#activeXf = null
	/** detached text node for measureTextHeight (never in a layer) */
	#measurer = null
	/** (job 267) a 2D context that measures the text of AI cards, made on first use */
	#aiMeasure = null
	/** (job 279) text widths per font and text, for rich text measured outside a drawing */
	#richWidths = new Map()
	/** (job 158) detached text node for measureTitleWidth (never in a layer) */
	#titleMeasurer = null
	/** (job 177) detached text node for measureShapeLines (never in a layer) */
	#shapeMeasurer = null
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
	 * painting (stats().voteState counts what is drawn) and (job 233) its
	 * plan, for the badges' hit test
	 */
	#vote = { state: null, node: null, drawn: BADGES_NONE, plan: null }
	/**
	 * lock symbols (M2, R20): the ONE node in the uiGroup (only while a locked
	 * item is in view) and the symbols its last painting drew (stats().locks)
	 */
	#locks = { node: null, drawn: 0 }
	/**
	 * (job 172) reaction rows: the scene's ReactState (null: none), the ONE node at the bottom of the
	 * uiGroup (only while a note in view shows a row) and the rows of its last painting (rowStat)
	 */
	#react = { state: null, node: null, drawn: [] }
	/** (job 151) the scene is in mode edit: only then are lock symbols painted */
	#edit = true
	/** background grid (R12): its own <canvas> below the Konva content while on, else null */
	#grid = null
	/**
	 * (job 143) the "Add title…" hint: the frame it belongs to and its node in the uiGroup (null without one);
	 * (job 243) hint: its parts (nodes/titleHint.js), textW: the width of its text
	 */
	#titleHint = { id: null, node: null, hint: null, textW: 0 }
	/** (job 162) the "+" preview: its kind and its node in the uiGroup (null without one) */
	#plusPreview = { kind: null, node: null }
	/** (job 188) the note being taken off a pad: its Rect in the uiGroup, null without one */
	#notePreview = null
	/** the camera the picture shows (the live camera of a CSS gesture), what the grid is painted with */
	#shown = { x: 0, y: 0, scale: 1 }
	/** (job 191) the chosen tags of the tag filter (null: no filter) */
	#tagFilter = null
	/** (job 273) the pen strokes the running eraser path touched: hidden until it ends @type {Set<string>|null} */
	#erasing = null

	/**
	 * @param {HTMLElement} container element the stage is mounted in
	 * @param {import('../model/SceneModel.js').SceneModel} model scene model
	 * @param {{shadows?:boolean, mode?:string}} [opts] note shadows on/off; (job 151) the scene's mode
	 *   (missing = 'edit'; any other mode paints no lock symbols)
	 */
	constructor(container, model, { shadows = true, mode = 'edit' } = {}) {
		this.#container = container
		this.#model = model
		// job 173: measureCell, the text height of a table cell (nodes/table.js)
		// job 191: tags, the board's tag map (setTags)
		// job 195: measureNode, the text size of a mind map node (nodes/mindmap.js)
		// job 243: measureTitle, the width of a frame title (nodes/frame.js, its tab)
		this.#ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: shadows !== false, measureCell: this.measureCellHeight.bind(this), measureNode: this.measureNodeText.bind(this), measureTitle: this.measureTitleWidth.bind(this), tags: new Map() }
		this.#edit = mode === 'edit'
	}

	/**
	 * (job 151) The scene's mode changed: the lock symbols show only in mode
	 * edit (vote and view paint none, stats().locks 0); back in edit they are
	 * painted with the next overlay draw.
	 *
	 * @param {string} mode 'edit', 'vote' or 'view'
	 */
	setMode(mode) {
		const edit = mode === 'edit'
		if (edit === this.#edit) return
		this.#edit = edit
		this.#syncLocks()
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
			if (!this.#vote.node) {
				this.#vote.drawn = BADGES_NONE
				this.#vote.plan = null
			}
			// … and without the lock node no lock
			if (!this.#locks.node) this.#locks.drawn = 0
			// … nor a reaction row without its node (job 172)
			if (!this.#react.node) this.#react.drawn = []
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
		this.#handles = { list: [], outline: null, nodes: new Map(), outlineNode: null, placed: null, touch: false }
		this.#connect = { spec: null, line: null, target: null, dots: [] }
		this.#guides = []
		this.#gapMarkers = []
		this.#measures = []
		this.#labels = []
		this.#sizeLabel = { label: null, node: null }
		this.#coarse = { node: null, hits: [], order: null, painted: [], paints: 0, titles: new Map(), titleRects: [] }
		this.#vote = { state: null, node: null, drawn: BADGES_NONE, plan: null }
		this.#locks = { node: null, drawn: 0 }
		this.#react = { state: null, node: null, drawn: [] }
		this.#titleHint = { id: null, node: null, hint: null, textW: 0 }
		this.#measurer?.destroy()
		this.#measurer = null
		this.#shapeMeasurer?.destroy()
		this.#shapeMeasurer = null
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

	/** (Job 203) A picture of an own shape was decoded: both layers draw again (the coarse painting too). */
	picturesChanged() {
		if (this.#stage) this.#invalidate(true, this.#overlayNonEmpty())
	}

	/** @return {boolean} true when a layer waits for a draw */
	hasDirty() {
		return this.#dirty.static || this.#dirty.overlay
	}

	// ------------------------------------------------------------ tags (job 191)

	/**
	 * The board's tags (meta.tags, cleaned): the tag rows and texts of the
	 * notes follow; nothing else is touched.
	 * (Job 227) An old tag colour is kept as its new tone (tokens.shownColor).
	 *
	 * @param {Array<{id: string, name: string, color: string}>} list tags
	 */
	setTags(list) {
		this.#ctx.tags = tagMap(Array.isArray(list) ? list.map((tg) => (tg && typeof tg === 'object' ? { ...tg, color: shownColor(tg.color) } : tg)) : [])
		if (this.#tagFilter !== null) {
			const left = [...this.#tagFilter].filter((t) => this.#ctx.tags.has(t))
			this.#tagFilter = left.length > 0 ? new Set(left) : null
		}
		if (!this.#stage) return
		let touch = false
		for (const [id, e] of [...this.#entries]) {
			if (e.type !== 'sticky') continue
			if (!this.#isLive(id)) {
				e.stale = e.stale ? e.stale.add('tags') : new Set(['tags'])
				continue
			}
			this.#refresh(id, e, new Set(['tags']))
			touch = true
		}
		this.#invalidate(touch || this.#lod === 2, this.#dragging.size > 0 || this.#previews.size > 0)
	}

	/**
	 * The tag filter of this tab: notes without one of the tags fade.
	 *
	 * @param {string[]|null} ids chosen tags (null or []: no filter)
	 */
	setTagFilter(ids) {
		const list = Array.isArray(ids) ? ids.filter((t) => typeof t === 'string') : []
		this.#tagFilter = list.length > 0 ? new Set(list) : null
		if (!this.#stage) return
		for (const [id, e] of this.#entries) {
			if (e.type === 'sticky') this.#applyFade(id, e)
		}
		this.#invalidate(true, this.#dragging.size > 0 || this.#previews.size > 0)
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} the tag filter fades it (a note without a chosen tag)
	 */
	#isFaded(id) {
		const f = this.#tagFilter
		if (f === null) return false
		const it = this.#model.get(id)
		return it?.t === 'sticky' && !noteTagIds(it, this.#ctx.tags).some((t) => f.has(t))
	}

	/**
	 * @param {string} id item id
	 * @param {object} e its entry
	 */
	#applyFade(id, e) {
		if (e?.type === 'pen') {
			// (job 273) a stroke the eraser touched is invisible (opacity 0) until the eraser lets go
			const op = this.#erasing?.has(id) ? 0 : 1
			if (e.root.opacity() !== op) e.root.opacity(op)
			return
		}
		if (e?.type !== 'sticky') return
		const op = this.#isFaded(id) ? TAG_FADE_OPACITY : 1
		if (e.root.opacity() !== op) e.root.opacity(op)
	}

	/**
	 * (Job 273) The pen strokes the running eraser path touched: invisible (opacity 0), until the next
	 * call; null or [] shows them all again.
	 *
	 * @param {string[]|null} ids stroke ids
	 */
	setErasing(ids) {
		const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
		const before = this.#erasing
		this.#erasing = list.length > 0 ? new Set(list) : null
		if (!this.#stage) return
		for (const id of new Set([...(before ?? []), ...list])) {
			const e = this.#entries.get(id)
			if (e) this.#applyFade(id, e)
		}
		this.#invalidate(true, false)
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
			// the lock alone changes no node (M2, R20): the lock symbol follows with the overlay;
			// (job 172) nor do the reactions, the rows follow with the overlay
			if (fields.size > 0 && [...fields].every((x) => x === 'lock' || x === 'react')) {
				touchOverlay = touchOverlay || this.#locks.node !== null || isLocked(this.#model.get(id)) || this.#react.node !== null || fields.has('react')
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
		// the lock symbols sit on the items' corners, (job 172) the reaction rows under the notes
		if ((this.#locks.node || this.#react.node) && (summary.added.length > 0 || summary.removed.length > 0 || summary.updated.size > 0 || summary.geometry.size > 0)) {
			touchOverlay = true
		}
		const before = this.#attached.size
		const locks = this.#locks.node
		const react = this.#react.node
		this.#cull()
		if (this.#attached.size !== before || summary.added.length > 0) touchStatic = true
		if (this.#placeUi() || this.#locks.node !== locks || this.#react.node !== react) touchOverlay = true
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
		this.#syncReactions()
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
	 *          touch?:boolean}|null} h the handles drawn now, the union frame of a multi
	 *   selection (dashed; drawn as its gapFrame, job 140) and (job 231) the look of a pen or a
	 *   finger (handleLook); null removes all
	 */
	setHandles(h) {
		const list = Array.isArray(h?.handles) ? h.handles : []
		const H = this.#handles
		const names = new Set(list.map((x) => x.name))
		let changed = false
		const touch = h?.touch === true
		if (touch !== H.touch) {
			H.touch = touch
			changed = true
		}
		for (const [name, node] of H.nodes) {
			if (!names.has(name)) {
				node.destroy()
				H.nodes.delete(name)
				changed = true
			}
		}
		for (const name of names) {
			if (H.nodes.has(name)) continue
			const look = handleLook(name, touch, this.#selColor)
			const attrs = {
				// (job 231) knorke-handle: found by tests and the E2E look check
				name: 'knorke-handle knorke-handle-' + name,
				listening: false,
				perfectDrawEnabled: false,
				fill: look.fill,
				stroke: look.stroke,
				strokeWidth: HANDLE_STROKE_PX,
				strokeScaleEnabled: false,
				shadowForStrokeEnabled: false,
			}
			// (job 262) a "+" button: circle or pill with its white plus or word (nodes/plusButton.js);
			// px, the world size of a screen px, is set by #placeHandles
			const node = look.plus
				? new Konva.Shape({
					...attrs,
					label: look.label,
					px: 1,
					sceneFunc: (c, shape) => drawStructPlus(c, {
						w: shape.width(), h: shape.height(), px: shape.getAttr('px'), fill: shape.fill(), ring: shape.stroke(), label: shape.getAttr('label'),
					}),
				})
				: new Rect(attrs)
			this.#ui.add(node)
			H.nodes.set(name, node)
			changed = true
		}
		const outline = h?.outline ?? null
		if (outline && !H.outlineNode) {
			H.outlineNode = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: this.#selColor,
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
		H.list = list.map((x) => ({ name: x.name, x: x.x, y: x.y }))
		H.outline = outline ? { ...outline } : null
		if (this.#placeHandles() || changed) this.#invalidate(false, true)
	}

	/**
	 * (job 231, redesign V8) The color of the own selection marks: the
	 * scene's primary color (#rrggbb, model/tokens.js selectionColorOf), set
	 * at mount before anything is selected. The handles and the multi frame
	 * drawn now take it at once, every other mark when it is drawn next.
	 *
	 * @param {string} color #rrggbb
	 */
	setSelectionColor(color) {
		if (typeof color !== 'string' || color === this.#selColor) return
		this.#selColor = color
		const H = this.#handles
		for (const [name, node] of H.nodes) {
			const look = handleLook(name, H.touch, color)
			node.setAttrs({ fill: look.fill, stroke: look.stroke })
		}
		if (H.outlineNode) H.outlineNode.stroke(color)
		// (job 262) the tinted tabs take the new colour
		const tinted = [...this.#tinted]
		this.#tinted = new Set()
		this.#syncTints(tinted)
		if (H.nodes.size > 0 || H.outlineNode) this.#invalidate(false, true)
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
	 *   markVotable, scope, color (#rrggbb), live (job 149: the totals are hollow "live" pills)
	 */
	setVoteBadges(state) {
		const V = this.#vote
		V.state = state
			? { badges: state.badges, votable: state.votable, markVotable: state.markVotable === true, scope: state.scope ?? null, color: state.color, live: state.live === true }
			: null
		const want = V.state !== null && (V.state.badges.size > 0 || V.state.markVotable)
		if (want && !V.node && this.#ui) {
			V.node = buildBadges(this.#ctx, (context) => this.#paintBadges(context))
			this.#ui.add(V.node)
		} else if (!want && V.node) {
			V.node.destroy()
			V.node = null
			V.plan = null
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
	 * (Job 233) The item whose drawn vote badge a press hits (nodes/badges.js
	 * badgeAt on the last painted plan, at the camera scale it was painted
	 * for); null without a badge node.
	 *
	 * @param {{x:number, y:number}} w world point
	 * @param {number} radiusPx hit radius (screen px)
	 * @param {string|null} hit the item under the press
	 * @return {string|null} item id
	 */
	voteBadgeAt(w, radiusPx, hit) {
		const V = this.#vote
		if (!V.state || !V.node || !V.plan) return null
		return badgeAt(V.plan, w, this.#cam.scale, radiusPx, hit, (a, b) => this.#model.compareOrder(a, b))
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
		const plan = planBadges(this.#model, ids, s, { rings: this.#lod !== 2, offsetOf: (id) => this.#previews.get(id) ?? null, scale: this.#cam.scale })
		V.drawn = Object.freeze({ ...plan.counts })
		V.plan = plan
		paintBadges(context, plan, this.#cam.scale, s.color, { live: s.live })
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
		const attrs = textItemAttrs(item, Number.isFinite(item?.w) ? item.w : 0)
		const m = hasMarks(attrs.text) ? this.#richMeasure() : null
		if (m) {
			// job 279: a text with Markdown marks as the rich shape lays it out
			return richLayout(null, m, { ...attrs, fontFamily: FONT_FAMILY, lineHeight: LINE_HEIGHT }).height
		}
		this.#measurer.setAttrs(attrs)
		return this.#measurer.height()
	}

	/**
	 * (Job 279) The address of the link under a world point in the drawn
	 * text of an item (a note, shape or text item; a table's cells), from the
	 * layout its rich shape drew; null when there is none, the item is not
	 * drawn or its text is hidden (an open editor, LOD 1).
	 *
	 * @param {string} id item
	 * @param {number} wx world x
	 * @param {number} wy world y
	 * @return {string|null}
	 */
	linkAt(id, wx, wy) {
		const e = this.#entries.get(id)
		if (!e || !e.parts) return null
		const nodes = []
		if (e.parts.text) nodes.push(e.parts.text)
		if (e.parts.texts instanceof Map) nodes.push(...e.parts.texts.values())
		const m = this.#richMeasure()
		if (!m) return null
		const top = e.root.getParent()
		for (const n of nodes) {
			if (!isRich(n) || n.getAttr('visible') === false) continue
			const p = n.getAbsoluteTransform(top).copy().invert().point({ x: wx, y: wy })
			const href = textLinkAt(n, p.x, p.y, m)
			if (href) return href
		}
		return null
	}

	/**
	 * (Job 279) The drawn text of an item for the test hook: the text part (a
	 * table: its first cell with marks, else its first cell) as
	 * {rich: true, runs: [{text, b, i, s, c, href}]} or {rich: false, text};
	 * null when it is not built (culled, LOD 1).
	 *
	 * @param {string} id item
	 * @return {object|null}
	 */
	drawnText(id) {
		const e = this.#entries.get(id)
		if (!e || !e.parts) return null
		const cells = e.parts.texts instanceof Map ? [...e.parts.texts.values()] : []
		const n = e.parts.text ?? cells.find((c) => isRich(c)) ?? cells[0] ?? null
		if (!n) return null
		if (!isRich(n)) return { rich: false, text: String(n.getAttr('text') ?? '') }
		const m = this.#richMeasure()
		if (!m) return null
		const lay = richLayout(n, m)
		return { rich: true, runs: lay.lines.flatMap((l) => l.runs.map((r) => ({ text: r.text, b: r.b, i: r.i, s: r.s, c: r.c, href: r.href }))) }
	}

	/**
	 * (Job 279) Width of a text in a CSS font from a detached canvas context,
	 * remembered per font and text; null without a canvas.
	 *
	 * @return {((text: string, font: string) => number)|null}
	 */
	#richMeasure() {
		if (!this.#aiMeasure) {
			this.#aiMeasure = Konva.Util.createCanvasElement()?.getContext?.('2d') ?? null
			if (!this.#aiMeasure) return null
		}
		const c = this.#aiMeasure
		return (text, font) => {
			const key = font + '\u0001' + text
			let w = this.#richWidths.get(key)
			if (w === undefined) {
				c.font = font
				w = c.measureText(text).width
				if (this.#richWidths.size >= 20000) this.#richWidths.clear()
				this.#richWidths.set(key, w)
			}
			return w
		}
	}

	/**
	 * (Job 267) The height the content of an AI card needs at its width
	 * (nodes/ai.js aiCardHeight, measured with a detached canvas context).
	 *
	 * @param {object} item WireItem
	 * @return {number|null} height in world units, null without a canvas
	 */
	measureAiHeight(item) {
		if (!this.#aiMeasure) {
			this.#aiMeasure = Konva.Util.createCanvasElement()?.getContext?.('2d') ?? null
			if (!this.#aiMeasure) return null
		}
		const c = this.#aiMeasure
		return aiCardHeight(item, Number.isFinite(item?.w) ? item.w : 0, (text, font) => {
			c.font = font
			return c.measureText(text).width
		})
	}

	/**
	 * (Job 173) The text height of a table cell: a detached Konva.Text with
	 * the cell's attributes (nodes/table.js cellTextAttrs), never in a layer;
	 * remembered per text, width and weight.
	 *
	 * @param {string} text cell text
	 * @param {number} width wrap width
	 * @param {boolean} bold header row
	 * @return {number} height in world units
	 */
	measureCellHeight(text, width, bold) {
		const key = (bold ? 1 : 0) + '|' + width + '|' + text
		const known = this.#cellHeights.get(key)
		if (known !== undefined) return known
		if (!this.#cellMeasurer) {
			this.#cellMeasurer = new Text({ listening: false, perfectDrawEnabled: false })
		}
		const attrs = cellTextAttrs(String(text), width, bold === true)
		const m = hasMarks(attrs.text) ? this.#richMeasure() : null
		let h
		if (m) {
			// job 279: a cell with Markdown marks as the rich shape lays it out
			h = richLayout(null, m, attrs).height
		} else {
			this.#cellMeasurer.setAttrs(attrs)
			h = this.#cellMeasurer.height()
		}
		if (this.#cellHeights.size >= CELL_MEASURE_MAX) this.#cellHeights.clear()
		this.#cellHeights.set(key, h)
		return h
	}

	/**
	 * (Job 195) The text size of a mind map node: a detached Konva.Text with
	 * the node's attributes (nodes/mindmap.js nodeTextAttrs), never in a
	 * layer; the width of its longest line (at most maxW) and its height,
	 * remembered per text, width, size and weight.
	 *
	 * @param {string} text text
	 * @param {number} maxW wrap width
	 * @param {number} size font size
	 * @param {boolean} bold bold (the root)
	 * @return {{w: number, h: number}} world units
	 */
	measureNodeText(text, maxW, size, bold) {
		const key = (bold ? 1 : 0) + '|' + maxW + '|' + size + '|' + text
		const known = this.#nodeSizes.get(key)
		if (known !== undefined) return known
		if (!this.#nodeMeasurer) {
			this.#nodeMeasurer = new Text({ listening: false, perfectDrawEnabled: false })
		}
		this.#nodeMeasurer.setAttrs(nodeTextAttrs(String(text), maxW, size, bold === true))
		const rows = Array.isArray(this.#nodeMeasurer.textArr) ? this.#nodeMeasurer.textArr : []
		const w = Math.min(maxW, rows.reduce((m, r) => Math.max(m, Number.isFinite(r.width) ? r.width : 0), 0))
		const out = { w, h: this.#nodeMeasurer.height() }
		if (this.#nodeSizes.size >= CELL_MEASURE_MAX) this.#nodeSizes.clear()
		this.#nodeSizes.set(key, out)
		return out
	}

	/**
	 * (Job 195) What this tab shows on a mind map: the outline of the focused
	 * node, the hollow dots (dots: the map is selected; hover: the node under
	 * the pointer); null ends it. Redraws its node only.
	 *
	 * @param {string} id mind map id
	 * @param {{focus?: (string|null), hover?: (string|null), dots?: boolean}|null} ui state
	 */
	setMindmapUi(id, ui) {
		if (ui) this.#mmUi.set(id, { ...ui })
		else if (!this.#mmUi.delete(id)) return
		const e = this.#entries.get(id)
		if (!e || typeof e.spec.setUi !== 'function') return
		e.spec.setUi(e, ui)
		this.#invalidate(this.#attached.has(id), !this.#attached.has(id))
	}

	/**
	 * (Job 195) The node being dragged in a mind map (uiGroup, world units):
	 * its ghost at the pointer (SELECTION_COLOR at NODE_GHOST_OPACITY, a
	 * dashed SELECTION_STROKE_PX screen-px edge) and the mark of the drop
	 * target in DROP_TARGET_COLOR: the outline of the new parent ('child'),
	 * a bar on the top or bottom edge of the node it goes before or after
	 * (job 198: with beside on its left or right edge; nodes/mindmap.js
	 * dropMark); null removes it.
	 *
	 * @param {{ghost: {x:number, y:number, w:number, h:number}, target: ({x:number, y:number, w:number, h:number,
	 *   where: string, beside?: boolean}|null)}|null} p preview
	 */
	setNodeDragPreview(p) {
		if (!p || !this.#ui) {
			if (this.#nodeDrag) {
				this.#nodeDrag.group.destroy()
				this.#nodeDrag = null
				this.#invalidate(false, true)
			}
			return
		}
		if (!this.#nodeDrag) {
			const group = new Konva.Group({ listening: false, name: 'knorke-node-drag' })
			const ghost = new Rect({
				...SHAPE_BASE, fill: this.#selColor, opacity: NODE_GHOST_OPACITY, stroke: this.#selColor,
				strokeWidth: SELECTION_STROKE_PX, strokeScaleEnabled: false, dash: MULTI_FRAME_DASH.slice(),
			})
			const mark = new Rect({ ...SHAPE_BASE, stroke: DROP_TARGET_COLOR, strokeWidth: DROP_TARGET_STROKE_PX, strokeScaleEnabled: false })
			group.add(ghost, mark)
			this.#ui.add(group)
			this.#nodeDrag = { group, ghost, mark }
		}
		const D = this.#nodeDrag
		const g = p.ghost
		D.ghost.setAttrs({ x: g.x, y: g.y, width: g.w, height: g.h })
		const t = p.target
		if (!t) {
			D.mark.setAttrs({ visible: false })
		} else {
			const m = dropMark(t)
			D.mark.setAttrs({ visible: true, x: m.x, y: m.y, width: m.width, height: m.height, fill: m.bar ? DROP_TARGET_COLOR : undefined })
		}
		this.#invalidate(false, true)
	}

	/**
	 * (Job 173) Draws a table as a local preview (model/table.js
	 * previewTable: {col, w} while its column border is dragged, {cell, text}
	 * while that cell's editor is open); null ends it. Redraws its node only.
	 *
	 * @param {string} id table id
	 * @param {object|null} p preview
	 */
	setTablePreview(id, p) {
		if (p) this.#tablePreview.set(id, { ...p })
		else if (!this.#tablePreview.delete(id)) return
		const e = this.#entries.get(id)
		if (!e || !this.#model.get(id)) return
		if (!this.#isLive(id)) {
			e.stale = e.stale ? e.stale.add('data') : new Set(['data'])
			return
		}
		this.#refresh(id, e, new Set(['data']))
		this.#invalidate(this.#attached.has(id), !this.#attached.has(id))
	}

	/**
	 * @param {string} id item id
	 * @return {object} the model's item, (job 173) a table with its local preview, (job 195) a mind map with the
	 *   text of its open editor ({key, text}, model/mindmap.js previewMindmap), (job 199) a frame with the height
	 *   of a dragged lane border ({key, h}, model/lanes.js previewLanes)
	 */
	#itemFor(id) {
		const it = this.#model.get(id)
		const p = this.#tablePreview.get(id)
		if (!p || !it) return it
		return it.t === 'mindmap' ? previewMindmap(it, p) : it.t === 'frame' ? previewLanes(it, p) : previewTable(it, p)
	}

	/**
	 * @param {string} id item id
	 * @return {boolean|string} what setTextHidden of its spec gets: (job 173) the hidden cell of a table
	 */
	#hiddenOf(id) {
		return this.#textHidden.has(id) ? (this.#hiddenCell.get(id) ?? true) : false
	}

	/**
	 * (job 158) Width of a frame title (or the hint) in one line, in the
	 * title font (FONT_FAMILY, FRAME_TITLE_SIZE, job 227: FRAME_TITLE_WEIGHT): a detached Konva.Text,
	 * never added to a layer, asked per press and (job 243) when a frame node lays its tab out, never per frame.
	 *
	 * @param {string} text the text
	 * @param {string} [weight] the font weight (job 243: the hint's FRAME_TITLE_HINT_WEIGHT)
	 * @return {number} width in world units (uncut)
	 */
	measureTitleWidth(text, weight = FRAME_TITLE_WEIGHT) {
		if (!this.#titleMeasurer) {
			this.#titleMeasurer = new Text({ listening: false, perfectDrawEnabled: false, fontFamily: FONT_FAMILY, fontSize: FRAME_TITLE_SIZE, fontStyle: FRAME_TITLE_WEIGHT, wrap: 'none', padding: 0 })
		}
		this.#titleMeasurer.fontStyle(weight)
		this.#titleMeasurer.text(typeof text === 'string' ? text : '')
		return this.#titleMeasurer.getTextWidth()
	}

	/**
	 * (job 177) The lines the text node of a shape draws (word wrap, the
	 * ellipsis of an overflow, the stored or automatic font size): a detached
	 * Konva.Text with the node's attributes (nodes/shape.js), never added to a
	 * layer, asked per press, never per frame.
	 *
	 * @param {object} item WireItem (a shape)
	 * @param {{w:number, h:number}} abs its absolute box
	 * @return {number[]} widths of the drawn lines in world units, top first
	 */
	measureShapeLines(item, abs) {
		if (!this.#shapeMeasurer) {
			this.#shapeMeasurer = new Text({ listening: false, perfectDrawEnabled: false, padding: 0, ...SHAPE_TEXT_LAYOUT })
		}
		const attrs = shapeTextAttrs(item, abs)
		const m = hasMarks(attrs.text) ? this.#richMeasure() : null
		if (m) {
			// job 279: the lines of the rich shape
			return richLayout(null, m, { ...attrs, ...SHAPE_TEXT_LAYOUT }).lines.map((l) => l.w)
		}
		this.#shapeMeasurer.setAttrs(attrs)
		return this.#shapeMeasurer.textArr.map((l) => l.width)
	}

	/**
	 * (Job 178) Draws an image of items (scene/exportImage.js) apart from the
	 * stage: ONE detached Konva group, scaled by job.scale and moved so that
	 * job.frame starts at (0, 0), with a white rectangle below and, per id
	 * in the given (stacking) order, a node built at LOD 0 with its text
	 * shown, placed at the model's box; a connector from its route, routed
	 * again over the model's boxes while an end's item has a remote drag
	 * preview (the image shows the local state). Over them ONE shape paints
	 * job.plan's reaction rows and vote badges (EXPORT_BADGE_SCALE). The
	 * group goes to a canvas of job.width × job.height px at pixel ratio 1
	 * (Node.toCanvas, the only bitmap), then to a PNG Blob; the group is
	 * destroyed, the canvas emptied. Nothing of the stage changes: no camera,
	 * no culling, no LOD, no layer, no selection, handles, grid, lock
	 * symbols, cursors or editors.
	 *
	 * @param {{ids: string[], frame: {x:number, y:number, w:number, h:number}, scale: number, width: number,
	 *   height: number, plan: import('./exportImage.js').ExportPlan}} job the image (exportLayout, exportPlan)
	 * @return {Promise<Blob|null>} the PNG; null when the browser gave no canvas or toBlob no Blob
	 */
	async renderImage(job) {
		let canvas = null
		let root = null
		await this.#picturesOf(job.ids)
		try {
			const s = job.scale
			root = new Konva.Group({ listening: false, x: -job.frame.x * s, y: -job.frame.y * s, scaleX: s, scaleY: s })
			root.add(new Rect({ ...SHAPE_BASE, x: job.frame.x, y: job.frame.y, width: job.width / s + 1, height: job.height / s + 1, fill: EXPORT_BACKGROUND }))
			this.#exportNodes(job, root)
			canvas = root.toCanvas({ x: 0, y: 0, width: job.width, height: job.height, pixelRatio: 1 })
		} catch (err) {
			canvas = null
		} finally {
			root?.destroy()
		}
		if (!canvas || typeof canvas.toBlob !== 'function' || canvas.width !== job.width || canvas.height !== job.height) return null
		const blob = await new Promise((resolve) => {
			try {
				canvas.toBlob((b) => resolve(b ?? null), 'image/png')
			} catch (err) {
				resolve(null)
			}
		})
		// the bitmap goes at once (up to 128 MB)
		canvas.width = 0
		canvas.height = 0
		return blob && blob.size > 0 ? blob : null
	}

	/**
	 * (Job 203) Waits until the pictures of the own shapes among ids are
	 * decoded, at most EXPORT_PICTURE_WAIT_MS.
	 *
	 * @param {string[]} ids the items of an export
	 * @return {Promise<void>}
	 */
	#picturesOf(ids) {
		const uris = []
		for (const id of ids) {
			const uri = pictureOf(this.#model.get(id))
			if (uri) uris.push(uri)
		}
		return whenImagesReady(uris, EXPORT_PICTURE_WAIT_MS)
	}

	/**
	 * (Job 178, 200) The nodes of an export, added to root: per id in the
	 * given (stacking) order a node built at LOD 0 with its text shown,
	 * placed at the model's box (a connector at its export route), then ONE
	 * shape that paints job.plan's reaction rows and vote badges
	 * (EXPORT_BADGE_SCALE), when there are any.
	 *
	 * @param {{ids: string[], plan: (import('./exportImage.js').ExportPlan|null)}} job the export
	 * @param {object} root the detached group
	 * @return {{id: string, node: object}[]} the nodes in order; the overlay has the id "overlay"
	 */
	#exportNodes(job, root) {
		const out = []
		for (const id of job.ids) {
			const it = this.#model.get(id)
			if (!it) continue
			const spec = nodeSpecFor(it.t)
			const box = spec.routed ? this.#exportRoute(id, it) : this.#model.abs(id)
			if (!box) continue
			const e = spec.build(this.#ctx, it, box, 0, false)
			if (spec.routed) spec.place(this.#ctx, e, it, box)
			else place(e, box)
			root.add(e.root)
			out.push({ id, node: e.root })
		}
		const plan = job.plan
		if (plan && (plan.reactions.length > 0 || (plan.badges && plan.badges.items.length > 0))) {
			const node = new Konva.Shape({
				...SHAPE_BASE,
				sceneFunc: (context) => {
					paintReactions(context, plan.reactions)
					if (plan.badges && plan.badges.items.length > 0) paintBadges(context, plan.badges, EXPORT_BADGE_SCALE, plan.color, { live: plan.live })
				},
			})
			root.add(node)
			out.push({ id: 'overlay', node })
		}
		return out
	}

	/**
	 * (Job 200) Draws an export as vectors: the nodes of #exportNodes in a
	 * detached group without scale or offset (world units), item by item
	 * into ONE VectorContext (a group per id) under a SceneCanvas of size 0
	 * at pixel ratio 1 (so Konva never takes a buffer canvas and a stroke
	 * that does not scale is drawn in world units), then written by
	 * svgDocument or pdfDocument over job.frame. The group is destroyed.
	 * Nothing of the stage changes. (Job 217) The vector part is loaded
	 * first; failing, null.
	 *
	 * @param {{ids: string[], frame: {x:number, y:number, w:number, h:number},
	 *   plan: import('./exportImage.js').ExportPlan, format: 'svg'|'pdf', page?: string}} job the export (job 207: page, the PDF's size)
	 * @return {Promise<{blob: Blob, width: number, height: number, scale: number}|null>} the file and its size
	 *   (SVG: world units, scale 1; PDF: pt, scale pt per unit); null when it could not be drawn or written
	 */
	async renderVector(job) {
		let root = null
		const part = await loadPart('vector')
		if (!part) return null
		const { VectorContext, parseFont, pdfDocument, svgDocument } = part
		await this.#picturesOf(job.ids)
		try {
			const ctx = new VectorContext({ measure: exportTextMetrics, resolveColor: exportCssColor })
			root = new Konva.Group({ listening: false })
			const nodes = this.#exportNodes(job, root)
			const canvas = new SceneCanvas({ width: 0, height: 0, pixelRatio: 1 })
			canvas.getContext()._context = ctx
			for (const { id, node } of nodes) {
				ctx.beginGroup(id)
				node.drawScene(canvas)
				ctx.endGroup()
			}
			if (job.format === 'svg') {
				const svg = svgDocument(ctx.ops, job.frame)
				return { blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), width: job.frame.w, height: job.frame.h, scale: 1 }
			}
			const pdf = await pdfDocument(ctx.ops, job.frame, { measure: exportTextMetrics, rasterize: (...run) => exportRasterText(parseFont, ...run), rasterizeImage: exportRasterImage, page: job.page })
			return { blob: new Blob([pdf.bytes], { type: 'application/pdf' }), width: pdf.width, height: pdf.height, scale: pdf.scale }
		} catch (err) {
			console.error('[knorke] renderVector failed', err)
			return null
		} finally {
			root?.destroy()
		}
	}

	/**
	 * (Job 178) The route a connector shows in an image: the model's, unless
	 * an end's item has a remote drag preview (the model routes over the
	 * preview box then); then it is routed again over the model's boxes.
	 *
	 * @param {string} id connector id
	 * @param {object} it its WireItem
	 * @return {object|null} route ({geom, label}) or null
	 */
	#exportRoute(id, it) {
		const route = this.#model.routeOf(id)
		const ends = ['start', 'end'].map((w) => fieldValue(it, 'data.' + w))
		if (!route || !ends.some((ep) => this.#previews.has(ep?.item))) return route
		const kind = fieldValue(it, 'data.route')
		// (job 197) an elbow route runs around the other items, as the model routes it
		const obstacles = kind === 'elbow' ? this.#model.obstaclesFor(ends.map((ep) => ep?.item).filter((x) => typeof x === 'string')) : null
		const geom = routeConnector(...ends.map((ep, i) => ({ box: this.#model.abs(ep?.item), ep, point: route.geom[i ? 'end' : 'start'] })), kind, { obstacles })
		return geom ? { geom, label: labelBox(fieldValue(it, 'data.label'), geom.labelAt) } : route
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
	 * fully selected group, around the union of its members. (job 140) Each
	 * lies SELECTION_GAP_PX screen px outside (#placeUi).
	 *
	 * @param {string[]} localIds local selection (without the members of `groups`)
	 * @param {Array<{ids:string[], color:string}>} [remote] remote selections
	 * @param {string[][]} [groups] member ids of each fully selected group
	 */
	setSelection(localIds, remote = [], groups = []) {
		const want = []
		const isLine = (id) => typeInfo(this.#model.get(id)?.t).hit === 'line'
		// (job 262) a frame's outline follows frame and tab
		const isFrame = (id) => this.#model.get(id)?.t === 'frame'
		for (const id of localIds) want.push({ id, color: this.#selColor, local: true, line: isLine(id), frame: isFrame(id) })
		for (const r of remote) {
			for (const id of r.ids ?? []) want.push({ id, color: r.color, local: false, line: isLine(id), frame: isFrame(id) })
		}
		this.#syncTints(localIds.filter(isFrame))
		const sig = want.map((s) => s.id + '|' + s.color + '|' + (s.local ? 1 : 0) + (s.line ? 'l' : '') + (s.frame ? 'f' : '')).join(',')
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
				stroke: this.#selColor,
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
				: s.frame
					// (job 262) a frame: round frame and tab (frameOutline, set by #placeFrameOutline)
					? new Konva.Shape({
						listening: false,
						perfectDrawEnabled: false,
						stroke: s.color,
						strokeWidth: SELECTION_STROKE_PX,
						strokeScaleEnabled: false,
						dash: s.local ? undefined : [6, 4],
						name: 'knorke-frame-outline',
						sceneFunc: (c, shape) => {
							const o = shape.getAttr('frameOutline')
							if (!o) return
							traceFrame(c, o.w, o.h, o.tabW, o.r)
							c.strokeShape(shape)
						},
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
	 * (Job 262, design round 4 R4) Tints the tab of every frame of the local
	 * selection with the selection colour (nodes/frame.js setTint) and takes
	 * the tint off the frames no longer in it; the static layer redraws when
	 * a tab changed.
	 *
	 * @param {string[]} ids the locally selected frames
	 */
	#syncTints(ids) {
		const next = new Set(ids)
		let changed = false
		for (const id of this.#tinted) {
			if (next.has(id)) continue
			const e = this.#entries.get(id)
			if (e && typeof e.spec.setTint === 'function') changed = e.spec.setTint(e, null) || changed
		}
		for (const id of next) {
			const e = this.#entries.get(id)
			if (e && typeof e.spec.setTint === 'function') changed = e.spec.setTint(e, this.#selColor) || changed
		}
		this.#tinted = next
		if (changed) this.#invalidate(true, true)
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
	 * (job 194) Measuring lines of the guides of a local drag or resize in the
	 * uiGroup: drawn like the gap markers (name knorke-measure-line). Marks
	 * only the overlay dirty.
	 *
	 * @param {Array<{axis:'x'|'y', at:number, from:number, to:number}>|null} list lines (as setGapMarkers);
	 *   null or [] destroys every measuring line
	 */
	setMeasureLines(list) {
		const want = Array.isArray(list) && this.#ui ? list : []
		if (want.length === 0 && this.#measures.length === 0) return
		while (this.#measures.length > want.length) this.#measures.pop().destroy()
		while (this.#measures.length < want.length) {
			const line = new Line({
				name: 'knorke-measure-line',
				listening: false,
				perfectDrawEnabled: false,
				stroke: SNAP_GUIDE_COLOR,
				strokeWidth: SNAP_GUIDE_STROKE_PX,
				strokeScaleEnabled: false,
			})
			this.#ui.add(line)
			this.#measures.push(line)
		}
		const s = this.#cam.scale > 0 ? this.#cam.scale : 1
		want.forEach((m, i) => {
			this.#measures[i].setAttrs({ points: gapMarkerPoints(m, s) })
		})
		this.#raiseLabels()
		this.#invalidate(false, true)
	}

	/**
	 * (job 194) Distance labels of a local drag or resize in the uiGroup
	 * (nodes/snapLabel.js, name knorke-snap-label): the number of each gap
	 * marker and measuring line beside the middle of its line, at the same
	 * screen size at every zoom (re-placed on each scale change), above the
	 * lines. Marks only the overlay dirty.
	 *
	 * @param {Array<import('./nodes/snapLabel.js').SnapLabel>|null} list labels (place 'below' or 'right');
	 *   null or [] destroys every distance label
	 */
	setSnapLabels(list) {
		const want = Array.isArray(list) && this.#ui ? list : []
		if (want.length === 0 && this.#labels.length === 0) return
		while (this.#labels.length > want.length) this.#labels.pop().node.destroy()
		while (this.#labels.length < want.length) {
			const node = buildSnapLabel(this.#ctx, 'knorke-snap-label')
			this.#ui.add(node)
			this.#labels.push({ label: null, node })
		}
		const s = this.#cam.scale > 0 ? this.#cam.scale : 1
		want.forEach((label, i) => {
			this.#labels[i].label = { ...label }
			placeSnapLabel(this.#labels[i].node, label, s)
		})
		this.#raiseLabels()
		this.#invalidate(false, true)
	}

	/**
	 * (job 194) The size label of a local resize in the uiGroup (name
	 * knorke-size-label): "240 × 180" with its right edge on the anchor point
	 * (the bottom right corner of the drawn selection frame) and its top
	 * SIZE_LABEL_GAP_PX below it, at the same screen size at every zoom.
	 * Marks only the overlay dirty.
	 *
	 * @param {{text:string, x:number, y:number}|null} label text and anchor point (world); null removes it
	 */
	setSizeLabel(label) {
		const S = this.#sizeLabel
		if (!label || !this.#ui) {
			if (S.node) {
				S.node.destroy()
				this.#sizeLabel = { label: null, node: null }
				this.#invalidate(false, true)
			}
			return
		}
		if (!S.node) {
			S.node = buildSnapLabel(this.#ctx, 'knorke-size-label')
			this.#ui.add(S.node)
		}
		S.label = { text: label.text, x: label.x, y: label.y, place: 'corner' }
		placeSnapLabel(S.node, S.label, this.#cam.scale)
		S.node.moveToTop()
		this.#invalidate(false, true)
	}

	/** (job 194) The labels lie above the lines of the uiGroup. */
	#raiseLabels() {
		for (const l of this.#labels) l.node.moveToTop()
		this.#sizeLabel.node?.moveToTop()
	}

	/** (job 194) Re-places the labels for the current scale (their screen size stays). */
	#placeLabels() {
		const s = this.#cam.scale
		for (const l of this.#labels) placeSnapLabel(l.node, l.label, s)
		if (this.#sizeLabel.node) placeSnapLabel(this.#sizeLabel.node, this.#sizeLabel.label, s)
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
				stroke: this.#selColor,
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
				stroke: this.#selColor,
				strokeWidth: SELECTION_STROKE_PX,
				strokeScaleEnabled: false,
			})
			this.#ui.add(C.target)
		}
		while (C.dots.length < C.spec.anchors.length) {
			const dot = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: this.#selColor,
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
				fill: snapped ? this.#selColor : HANDLE_FILL,
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
	 * (Job 271) The frame around the current hit of the board search
	 * (uiGroup, overlay only, never hit or exported); null, or an id the
	 * model does not know, removes it. It follows its item and hides while
	 * the item is gone.
	 *
	 * @param {string|null} id item id
	 */
	setSearchHit(id) {
		const want = typeof id === 'string' && this.#model.has(id) ? id : null
		if (want === this.#hitId || !this.#ui) return
		this.#hitId = want
		this.#hit?.destroy()
		this.#hit = null
		if (want !== null) {
			this.#hit = new Rect({
				listening: false,
				perfectDrawEnabled: false,
				stroke: SEARCH_HIT_COLOR,
				strokeWidth: SEARCH_HIT_STROKE_PX,
				strokeScaleEnabled: false,
				cornerRadius: 0,
				name: 'knorke-search-hit',
			})
			this.#ui.add(this.#hit)
			this.#placeUi()
		}
		this.#invalidate(false, true)
	}

	/** @return {string|null} (job 271) the item the search frame is drawn around */
	searchHit() {
		return this.#hitId
	}

	/**
	 * (job 143) The hint "Add title…" in the title band of frame id (uiGroup,
	 * overlay only); null, or an id the model does not know, removes it.
	 *
	 * @param {string|null} id frame id
	 */
	setTitleHint(id) {
		const T = this.#titleHint
		const want = typeof id === 'string' && this.#model.has(id) ? id : null
		if (want === T.id || !this.#ui) return
		T.id = want
		if (want === null) {
			T.node.destroy()
			T.node = null
			T.hint = null
		} else if (!T.node) {
			T.hint = buildTitleHint(this.#ctx)
			T.node = T.hint.node
			T.textW = this.measureTitleWidth(titleHintText(), FRAME_TITLE_HINT_WEIGHT)
			this.#ui.add(T.node)
		}
		this.#placeUi()
		this.#invalidate(false, true)
	}

	/**
	 * (job 162) The preview of a "+" handle in the uiGroup (overlay only):
	 * ONE Rect on the rotated box, in SELECTION_COLOR at half opacity with a
	 * screen-px stroke, solid for 'connect', dashed for 'neighbour'.
	 *
	 * @param {{kind:('connect'|'neighbour'), box:{x:number, y:number, w:number, h:number, r:number}}|null} p
	 *   preview (absolute box, world); null, or one without a box, removes it
	 */
	setPlusPreview(p) {
		const P = this.#plusPreview
		const a = p?.box ?? null
		if (!a || !this.#ui) {
			if (P.node) {
				P.node.destroy()
				this.#plusPreview = { kind: null, node: null }
				this.#invalidate(false, true)
			}
			return
		}
		const kind = p.kind === 'connect' ? 'connect' : 'neighbour'
		if (P.node && P.kind !== kind) {
			P.node.destroy()
			P.node = null
		}
		if (!P.node) {
			P.node = new Rect({
				name: 'knorke-plus-preview',
				listening: false,
				perfectDrawEnabled: false,
				stroke: this.#selColor,
				strokeWidth: SELECTION_STROKE_PX,
				strokeScaleEnabled: false,
				opacity: PLUS_PREVIEW_OPACITY,
				dash: kind === 'neighbour' ? MULTI_FRAME_DASH.slice() : undefined,
			})
			P.kind = kind
			this.#ui.add(P.node)
		}
		const r = a.r || 0
		P.node.setAttrs(r
			? { x: a.x + a.w / 2, y: a.y + a.h / 2, offsetX: a.w / 2, offsetY: a.h / 2, rotation: r, width: a.w, height: a.h }
			: { x: a.x, y: a.y, offsetX: 0, offsetY: 0, rotation: 0, width: a.w, height: a.h })
		this.#invalidate(false, true)
	}

	/**
	 * (Job 188) The note being taken off a pad, in the uiGroup (file comment).
	 *
	 * @param {{x:number, y:number, w:number, h:number, fill:string}|null} p its box (world units) and fill; null
	 *   removes it
	 */
	setNotePreview(p) {
		if (!p || !this.#ui) {
			if (this.#notePreview) {
				this.#notePreview.destroy()
				this.#notePreview = null
				this.#invalidate(false, true)
			}
			return
		}
		if (!this.#notePreview) {
			this.#notePreview = new Rect({
				...SHAPE_BASE,
				name: 'knorke-note-preview',
				cornerRadius: STICKY_RADIUS,
				opacity: NOTE_PREVIEW_OPACITY,
			})
			this.#ui.add(this.#notePreview)
		}
		this.#notePreview.setAttrs({ x: p.x, y: p.y, width: p.w, height: p.h, fill: p.fill })
		this.#invalidate(false, true)
	}

	/**
	 * @param {string} id item id
	 * @param {boolean} hidden hide the Konva text while the editor is open
	 * @param {string|null} [cell] (job 173) only the text of this cell of a table
	 */
	setTextHidden(id, hidden, cell = null) {
		if (hidden) this.#textHidden.add(id)
		else this.#textHidden.delete(id)
		if (hidden && typeof cell === 'string') this.#hiddenCell.set(id, cell)
		else this.#hiddenCell.delete(id)
		const e = this.#entries.get(id)
		if (!e) return
		e.spec.setTextHidden(e, this.#hiddenOf(id))
		this.#invalidate(this.#attached.has(id), !this.#attached.has(id))
	}

	/**
	 * visible: the items in the cull rectangle (cullRectOf); overscan: the
	 * stage's overscan per side and its size (whole CSS px); outlines (job
	 * 140): the visible selection frames as placed, in world units ('local'
	 * and 'remote' per item, 'group' per fully selected group, 'multi' the
	 * dashed frame; no connector halos).
	 *
	 * @return {{nodesBuilt:number, attached:number, staticChildren:number, activeChildren:number,
	 *           uiChildren:number, locks:number, reactions:Array<{id:string, shown:Array<[string, number, boolean]>, more:number, add:boolean}>,
	 *           lod:number, visible:number, draws:{static:number, overlay:number, grid:number},
	 *           overscan:{l:number, r:number, t:number, b:number, stageW:number, stageH:number},
	 *           outlines:Array<{kind:('local'|'remote'|'group'|'multi'), id:(string|null), x:number, y:number, w:number, h:number, r:number}>}}
	 */
	stats() {
		const outlines = []
		const put = (kind, id, f) => {
			if (f) outlines.push({ kind, id, x: f.x, y: f.y, w: f.w, h: f.h, r: f.r || 0 })
		}
		for (const s of this.#sel) {
			if (!s.line) put(s.local ? 'local' : 'remote', s.id, s.placed)
		}
		for (const s of this.#groupSel) put('group', null, s.placed)
		put('multi', null, this.#handles.placed)
		return {
			outlines,
			handles: this.#handles.nodes.size,
			selectionColor: this.#selColor,
			nodesBuilt: this.#entries.size,
			attached: this.#attached.size + this.#active.children.length,
			staticChildren: this.#static.children.length,
			activeChildren: this.#active.children.length,
			uiChildren: this.#ui.children.length,
			locks: this.#locks.drawn,
			reactions: this.#react.drawn.map((r) => ({ id: r.id, shown: r.shown.map((x) => [...x]), more: r.more, add: r.add })),
			groupOutlines: this.#groupSel.length,
			lod: this.#lod,
			visible: this.#visibleCount,
			draws: { ...this.#draws },
			overscan: { ...this.#ov },
			// job 191
			tags: this.#tagStats(),
			tagFilter: this.#tagFilter === null
				? null
				: { chosen: [...this.#tagFilter], faded: fadedNotes([...this.#model.ids()].map((id) => this.#model.get(id)), this.#tagFilter, this.#ctx.tags).sort() },
		}
	}

	/** @return {Array<{id: string, shown: string[], more: number}>} (job 191) the tag rows of the built notes in view, by id */
	#tagStats() {
		if (this.#lod === 2) return []
		const out = []
		for (const id of new Set(this.#inView())) {
			const e = this.#entries.get(id)
			if (e?.type === 'sticky' && e.tagPlan) out.push(tagStat(id, e.tagPlan, e.lod))
		}
		return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
	 * (job 158) At LOD 2: the width of frame id's title as the last painting
	 * drew it (its title rectangle, the shortened title).
	 *
	 * @param {string} id frame id
	 * @return {number|null} world units; null at LOD 0/1 and when that painting drew no title of id
	 */
	coarseTitleWidth(id) {
		if (this.#lod !== 2) return null
		const r = this.#coarse.titleRects.find((x) => x.id === id)
		return r ? r.w : null
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
			// (job 140) the selection frames keep SELECTION_GAP_PX screen px at the new scale
			this.#placeUi()
			this.#placeHandles()
			this.#placeConnectPreview()
			// (job 194) the labels keep their screen size
			this.#placeLabels()
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
	 * activeGroup) at the camera's scale and paints them; renews the paint
	 * order when it is missing or stale.
	 *
	 * @param {object} context Konva context with the camera transform
	 */
	#paintCoarse(context) {
		const c = this.#coarse
		const skip = (id) => this.#dragging.has(id) || this.#previews.has(id)
		// job 191: the notes the tag filter fades are painted faded at LOD 2 too
		const fade = this.#tagFilter === null ? null : (id) => this.#isFaded(id)
		const scale = this.#cam.scale
		let plan = c.order ? planCoarse(this.#model, c.hits, skip, c.order, fade, scale) : null
		if (!plan) {
			c.order = coarseOrder(this.#model)
			plan = planCoarse(this.#model, c.hits, skip, c.order, fade, scale) ?? { frames: [], groups: new Map(), painted: [] }
		}
		c.painted = plan.painted
		c.paints++
		c.titleRects = []
		paintCoarse(context, plan, scale, c.titles, c.titleRects)
	}

	/**
	 * @param {string} id item id
	 * @return {boolean} a change of this item repaints LOD 2: (job 202) connectors too, but not
	 *   while a local drag or transform runs (job 197 re-routes the ones it passes live; R13: no
	 *   static draw while dragging, endDrag paints them once with their new routes)
	 */
	#paintedAtLod2(id) {
		const it = this.#model.get(id)
		return !!it && (typeInfo(it.t).hit !== 'line' || this.#dragging.size === 0)
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
		const it = this.#itemFor(id)
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
			const it = this.#itemFor(id)
			const spec = nodeSpecFor(it.t)
			e = spec.build(this.#ctx, it, this.#boxFor(id, spec), this.#levelOf(spec, it), this.#hiddenOf(id))
			e.spec = spec
			e.type = it.t
			// (job 195) the focus and dots of this tab on a mind map
			if (typeof spec.setUi === 'function' && this.#mmUi.has(id)) spec.setUi(e, this.#mmUi.get(id))
			// (job 262) the tinted tab of a locally selected frame, also after a rebuild
			if (this.#tinted.has(id) && typeof spec.setTint === 'function') spec.setTint(e, this.#selColor)
			e.root.setAttr('kid', id)
			this.#entries.set(id, e)
			if (spec.scaleSensitive) this.#scaleIds.add(id)
			this.#applyFade(id, e)
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
		const it = this.#itemFor(id)
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
		// (job 191) a change of a note's tags can fade it or not
		this.#applyFade(id, e)
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
		this.#syncReactions()
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
	 * The lock node exists exactly while a locked item is in view (M2, R20)
	 * and (job 151) the scene is in mode edit; a board without one keeps the
	 * uiGroup as it was.
	 */
	#syncLocks() {
		if (!this.#ui || !this.#stage) return
		const coarse = this.#lod === 2
		const want = this.#edit && this.#inView().some((id) => {
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

	/**
	 * (job 172) The scene's ReactState as this renderer draws it: rows only
	 * at LOD 0 (scale 0 below it: no row anywhere).
	 *
	 * @return {import('./nodes/reactions.js').ReactState}
	 */
	#reactState() {
		const s = this.#react.state
		return s ? { ...s, scale: this.#lod === 0 ? this.#cam.scale : 0 } : { canReact: false, me: null, hover: null, selected: null, hidden: null, scale: 0 }
	}

	/**
	 * (job 172) The reaction node exists exactly while a note in view shows a
	 * row; it lies at the bottom of the uiGroup (outlines and handles above it).
	 */
	#syncReactions() {
		if (!this.#ui || !this.#stage) return
		const R = this.#react
		const st = this.#reactState()
		const want = R.state !== null && this.#lod === 0 && this.#inView().some((id) => rowOf(this.#model, id, st) !== null)
		if (want && !R.node) {
			R.node = buildReactions(this.#ctx, (context) => this.#paintReactions(context))
			this.#ui.add(R.node)
			R.node.moveToBottom()
			this.#invalidate(false, true)
		} else if (!want && R.node) {
			R.node.destroy()
			R.node = null
			R.drawn = []
			this.#invalidate(false, true)
		}
	}

	/**
	 * sceneFunc of the reaction node: plans the rows of the notes in view and
	 * paints them; the rows become stats().reactions.
	 *
	 * @param {object} context Konva context with the camera transform
	 */
	#paintReactions(context) {
		const rows = planReactions(this.#model, this.#inView(), this.#reactState(), (id) => this.#previews.get(id) ?? null)
		this.#react.drawn = rows.map(rowStat)
		paintReactions(context, rows)
	}

	/**
	 * (job 172) The scene's reaction state (nodes/reactions.js ReactState,
	 * scale aside: the renderer draws rows at LOD 0 only): who may react, the
	 * own pid, the hovered and the one selected note, the notes whose button
	 * hides and (job 183) everyNote, the button at every note. null draws no
	 * row. The overlay redraws; the outline of the selected note follows its band.
	 *
	 * @param {import('./nodes/reactions.js').ReactState|null} state state
	 */
	setReactions(state) {
		this.#react.state = state
			? { canReact: state.canReact === true, me: typeof state.me === 'string' ? state.me : null, hover: state.hover ?? null,
				selected: state.selected ?? null, hidden: new Set(state.hidden ?? []), scale: 1, everyNote: state.everyNote === true }
			: null
		this.#syncReactions()
		this.#placeUi()
		this.#invalidate(false, true)
	}

	#clearUi() {
		this.#syncTints([])
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
		this.#hit?.destroy()
		this.#hit = null
		this.#hitId = null
		this.setConnectPreview(null)
		this.setSnapGuides(null)
		this.setGapMarkers(null)
		this.setMeasureLines(null)
		this.setSnapLabels(null)
		this.setSizeLabel(null)
		this.setPlusPreview(null)
		this.setNotePreview(null)
	}

	/**
	 * Positions selection outlines and the drop target on the current boxes
	 * (including drag and preview offsets); (job 140) the selection and group
	 * outlines on gapFrame() of the box or union at the current scale, the
	 * drop target on the edge.
	 *
	 * @return {boolean} true when any outline moved
	 */
	#placeUi() {
		let changed = false
		const scale = this.#cam.scale
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
			// (job 172) the one selected note's frame reaches the band of its reaction row
			const below = s.local && s.id === this.#react.state?.selected ? reactionBand(this.#model, s.id, this.#reactState()) : 0
			s.placed = gapFrame(box(s.id), scale, { below })
			changed = this.#placeOutline(s.node, s.placed) || changed
			// (job 262) a frame: round frame and tab, SELECTION_GAP_PX outside
			if (s.frame) changed = this.#placeFrameOutline(s.node, s.id, box(s.id), scale) || changed
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
			s.placed = u === null ? null : gapFrame({ x: u[0], y: u[1], w: u[2] - u[0], h: u[3] - u[1], r: 0 }, scale)
			changed = this.#placeOutline(s.node, s.placed) || changed
		}
		if (this.#drop) {
			changed = this.#placeOutline(this.#drop, box(this.#dropId)) || changed
		}
		if (this.#hit) {
			// (job 271) SEARCH_HIT_GAP_PX outside the box at every zoom
			const a = box(this.#hitId)
			const g = SEARCH_HIT_GAP_PX / (scale > 0 ? scale : 1)
			changed = this.#placeOutline(this.#hit, a ? { ...a, x: a.x - g, y: a.y - g, w: a.w + 2 * g, h: a.h + 2 * g } : null) || changed
		}
		const T = this.#titleHint
		if (T.node) {
			// (job 143) the hint in its frame's title band; hidden while the frame has no box
			changed = placeTitleHint(T.hint, box(T.id), T.textW) || changed
		}
		return changed
	}

	/**
	 * Places the transformer handles for the current camera scale at the
	 * screen size of handleLook (mouse or touch) and the union frame.
	 *
	 * @return {boolean} true when any node changed
	 */
	#placeHandles() {
		const H = this.#handles
		if (H.nodes.size === 0 && !H.outlineNode) {
			H.placed = null
			return false
		}
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
			const look = handleLook(h.name, H.touch, this.#selColor)
			const size = look.size / s
			const w = look.w / s
			// (job 262) a "+" button draws itself (px: world units per screen px); every other handle is a round Rect
			apply(node, look.plus
				? { x: h.x - w / 2, y: h.y - size / 2, width: w, height: size, px: 1 / s }
				: { x: h.x - w / 2, y: h.y - size / 2, width: w, height: size, cornerRadius: look.round ? Math.min(w, size) / 2 : look.radius / s })
		}
		// (job 140) the dashed frame of a multi selection with the gap, like every outline
		H.placed = H.outlineNode && H.outline ? gapFrame({ ...H.outline, r: 0 }, s) : null
		if (H.placed) {
			apply(H.outlineNode, { x: H.placed.x, y: H.placed.y, width: H.placed.w, height: H.placed.h })
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
	 * (Job 262) The path of a frame's selection outline (nodes/frame.js
	 * frameOutline) for its box and the width of its tab now drawn (none
	 * while its node is not built); #placeOutline has put the node on the
	 * gap frame already.
	 *
	 * @param {object} node outline shape
	 * @param {string} id frame id
	 * @param {object|null} a absolute box or null (hidden)
	 * @param {number} scale camera scale
	 * @return {boolean} true when the path changed
	 */
	#placeFrameOutline(node, id, a, scale) {
		const o = a ? frameOutline(a, this.#entries.get(id)?.tab?.tabW ?? 0, scale) : null
		const cur = node.getAttr('frameOutline')
		if (o === null ? cur == null : cur && o.w === cur.w && o.h === cur.h && o.tabW === cur.tabW && o.r === cur.r) return false
		node.setAttr('frameOutline', o)
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
