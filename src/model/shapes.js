/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shapes are data (SPEC-M1 §6.2, retrofit rules §3.10): one entry per
 * data.kind of the `shape` type, used by the renderer, the hit test, the
 * LOD-2 painter and the "+" handles alike. All coordinates are normalised to
 * the unrotated item box (multiply x by w and y by h):
 *
 * - hit:     'box' (the whole box), 'ellipse' (ellipse formula) or 'polygon'
 *            (pointInPolygon over the outline); the inside always hits, also
 *            with fillOpacity 0
 * - outline: null (the box itself), 'ellipse', or a flat polygon [x0, y0, …]
 * - radius:  corner radius as a share of min(w, h) (terminal, BPMN tasks;
 *            job 260: rect and roundRect have a fixed corner instead)
 * - text:    the text box [x, y, w, h] inside the shape
 * - anchors: the four docking points of the "+" handles (top, right, bottom,
 *            left), each [ax, ay] like a connector anchor end (§3.10)
 *
 * A later shape pack adds entries here plus the kind to the enum lists of the
 * PHP and JS registries (registry golden). A kind this client does not know
 * (newer version) is drawn as rect: shapeOf() never fails.
 *
 * Job 201 (shapes panel) adds the flowchart kinds terminal … offPage and 20
 * symbols (icon…), and three optional keys:
 *
 * - lines:  inner lines, a list of flat polylines [x0, y0, …] in the same
 *           unit box; drawn after fill and border, stroked only, with the
 *           border's colour, width and dash (database, subprocess)
 * - icon:   SVG path data in a 24 × 24 grid (job 244: Phosphor Regular,
 *           phosphor.js, MIT, THIRD-PARTY.md; before MDI), stretched over the
 *           box and filled with style.fill (nonzero rule); the shape is a
 *           symbol: its hit, outline and anchors are the box, and it has no
 *           text editor
 * - duo:    (job 244) the light layer of the symbol (Phosphor Duotone), same
 *           grid, filled under the icon with style.fill at DUO_SHARE of its
 *           opacity; no border, no hit of its own
 * - create: {w, h, style} of a NEW shape of this kind without a dragged box
 *           (actions.createItem; the intent's style comes on top)
 *
 * Job 203 (own shape libraries) adds the kind image, a shape whose picture
 * is its data.img (model/shapeImage.js), with the key
 *
 * - image:  true; drawn as its picture over the box, no fill, border or
 *           text inside; hit, outline and anchors are the box (isSymbolKind);
 *           the preview is IMAGE_PREVIEW
 *
 * Curved parts (the wave of document, the caps of database, the round side
 * of delay) are polygons of CURVE_STEPS segments per curve, on the 1e-4 grid,
 * so hit test, anchors, outlinePoints and drawing share one outline.
 *
 * Job 204 (BPMN 2.0) adds 28 kinds bpmn… (events, tasks, gateways, data;
 * BPMN_GROUPS) and four keys:
 *
 * - mark:   {icon, share}: SVG path data (24 × 24, MDI 7.4.47) as a
 *           square of share · min(w, h), centred in the box
 * - badge:  {icon, at}: the same as a small square (badgeBox: at most
 *           BADGE_SIZE world units, BADGE_SHARE of the shorter side) at the
 *           top left ('tl') or the bottom centre ('bottom')
 *           Mark and badge (markPlace) are filled in the border's colour
 *           after fill, border and inner lines, also without a border
 * - thick:  true: the border is drawn twice style.strokeWidth wide (end
 *           events, call activity), so a kind switch keeps the look
 * - noText: true: like a symbol, no text inside (isTextless: events and
 *           gateways)
 *
 * Job 211: a symbol and a kind marked noText have a label instead (hasLabel):
 * their data.text stands centred below the box (symbolLabelBox) and opens
 * the text editor there; (job 235) an own shape (image) too.
 *
 * Job 260 (design round 3, variant F4) adds two keys:
 *
 * - corner: a fixed corner radius in world units (not a share of the box):
 *           a box kind draws it as a rounded rectangle (instead of radius),
 *           a polygon kind rounds each corner with at most half of its
 *           shorter neighbouring edge; hit test, anchors and outlinePoints
 *           keep the sharp polygon
 * - pad:    the text padding of the kind (else SHAPE_TEXT_PADDING), also
 *           for the auto-fit size (textPad)
 */
import { deepFreeze } from './freeze.js'
import { PHOSPHOR, PHOSPHOR_DUO, PHOSPHOR_SCALE } from './phosphor.js'
import { parseSvgPath, scalePath } from './svgPath.js'
import { hasMarks, shownText } from './richText.js'
import { wrapLabel } from './text.js'
import {
	LINE_HEIGHT, OLD_SHAPE_BORDER, PALETTE, SHAPE_BORDER, SHAPE_TEXT_PADDING, SYMBOL_LABEL_FONT_SIZE, SYMBOL_LABEL_GAP, SYMBOL_LABEL_WRAP_W, TEXT_COLOR,
	shownColor,
} from './tokens.js'

/** (job 201) Segments of each curved part of a flowchart outline. */
export const CURVE_STEPS = 16

/**
 * @param {number} v number
 * @return {number} v on the 1e-4 grid (no -0)
 */
function q4(v) {
	return Math.round(v * 10000) / 10000 + 0
}

/**
 * Points of a curve f(t) for t = 0 … 1 in CURVE_STEPS steps, both ends included.
 *
 * @param {(t: number) => number[]} f point at t
 * @return {number[]} flat points on the 1e-4 grid
 */
function curve(f) {
	const out = []
	for (let i = 0; i <= CURVE_STEPS; i++) {
		const [x, y] = f(i / CURVE_STEPS)
		out.push(q4(x), q4(y))
	}
	return out
}

const SIDES = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]
// the caps of database: half height of their ellipses
const CAP = 0.1
// the wave of document: y = WAVE_Y + WAVE_A · sin(2πx)
const WAVE_Y = 0.875
const WAVE_A = 0.1

/** New symbols: a square, filled in the text colour, without border. */
const SYMBOL_CREATE = { w: 96, h: 96, style: { fill: TEXT_COLOR, strokeWidth: 0 } }

/** (Job 244) Opacity of a symbol's light layer (duo) as a share of its fill's. */
export const DUO_SHARE = 0.2

/**
 * @param {string} name a Phosphor name (phosphor.js, job 244)
 * @return {object} the table entry of a symbol: its Regular path as icon, its
 *   Duotone light layer as duo, both on the 24 × 24 grid
 */
function symbol(name) {
	return {
		hit: 'box', outline: null, radius: 0, text: [0, 0, 1, 1], anchors: SIDES, create: SYMBOL_CREATE,
		icon: scalePath(PHOSPHOR[name], PHOSPHOR_SCALE), duo: scalePath(PHOSPHOR_DUO[name], PHOSPHOR_SCALE),
	}
}

/**
 * (Job 204) A circle around the box centre as a closed polyline (inner lines).
 *
 * @param {number} r radius as a share of the box
 * @return {number[]} flat points on the 1e-4 grid, the first point repeated at the end
 */
function ring(r) {
	const out = []
	const n = 2 * CURVE_STEPS
	for (let i = 0; i <= n; i++) {
		const t = -Math.PI / 2 + (2 * Math.PI * i) / n
		out.push(q4(0.5 + r * Math.cos(t)), q4(0.5 + r * Math.sin(t)))
	}
	return out
}

/**
 * (Job 204) A regular pentagon around the box centre, its tip at the top, closed.
 *
 * @param {number} r radius as a share of the box
 * @return {number[]} flat points on the 1e-4 grid
 */
function pentagon(r) {
	const out = []
	for (let i = 0; i <= 5; i++) {
		const t = -Math.PI / 2 + (2 * Math.PI * (i % 5)) / 5
		out.push(q4(0.5 + r * Math.cos(t)), q4(0.5 + r * Math.sin(t)))
	}
	return out
}

/** (Job 204) The MDI 7.4.47 paths of the BPMN marks and badges (the MDI name in the comment). */
const MDI = {
	// email-outline
	emailOutline: 'M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6M20 6L12 11L4 6H20M20 18H4V8L12 13L20 8V18Z',
	// email
	email: 'M20,8L12,13L4,8V6L12,11L20,6M20,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6C22,4.89 21.1,4 20,4Z',
	// clock-outline
	clockOutline: 'M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z',
	// flash
	flash: 'M7,2V13H10V22L17,10H13L17,2H7Z',
	// circle
	circle: 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z',
	// account
	account: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
	// cog-outline
	cogOutline: 'M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10M10,22C9.75,22 9.54,21.82 9.5,21.58L9.13,18.93C8.5,18.68 7.96,18.34 7.44,17.94L4.95,18.95C4.73,19.03 4.46,18.95 4.34,18.73L2.34,15.27C2.21,15.05 2.27,14.78 2.46,14.63L4.57,12.97L4.5,12L4.57,11L2.46,9.37C2.27,9.22 2.21,8.95 2.34,8.73L4.34,5.27C4.46,5.05 4.73,4.96 4.95,5.05L7.44,6.05C7.96,5.66 8.5,5.32 9.13,5.07L9.5,2.42C9.54,2.18 9.75,2 10,2H14C14.25,2 14.46,2.18 14.5,2.42L14.87,5.07C15.5,5.32 16.04,5.66 16.56,6.05L19.05,5.05C19.27,4.96 19.54,5.05 19.66,5.27L21.66,8.73C21.79,8.95 21.73,9.22 21.54,9.37L19.43,11L19.5,12L19.43,13L21.54,14.63C21.73,14.78 21.79,15.05 21.66,15.27L19.66,18.73C19.54,18.95 19.27,19.04 19.05,18.95L16.56,17.95C16.04,18.34 15.5,18.68 14.87,18.93L14.5,21.58C14.46,21.82 14.25,22 14,22H10M11.25,4L10.88,6.61C9.68,6.86 8.62,7.5 7.85,8.39L5.44,7.35L4.69,8.65L6.8,10.2C6.4,11.37 6.4,12.64 6.8,13.8L4.68,15.36L5.43,16.66L7.86,15.62C8.63,16.5 9.68,17.14 10.87,17.38L11.24,20H12.76L13.13,17.39C14.32,17.14 15.37,16.5 16.14,15.62L18.57,16.66L19.32,15.36L17.2,13.81C17.6,12.64 17.6,11.37 17.2,10.2L19.31,8.65L18.56,7.35L16.15,8.39C15.38,7.5 14.32,6.86 13.12,6.62L12.75,4H11.25Z',
	// hand-back-right-outline
	handOutline: 'M21 7C21 5.62 19.88 4.5 18.5 4.5C18.33 4.5 18.16 4.5 18 4.55V4C18 2.62 16.88 1.5 15.5 1.5C15.27 1.5 15.04 1.53 14.83 1.59C14.46 .66 13.56 0 12.5 0C11.27 0 10.25 .89 10.04 2.06C9.87 2 9.69 2 9.5 2C8.12 2 7 3.12 7 4.5V10.39C6.66 10.08 6.24 9.85 5.78 9.73L5 9.5C4.18 9.29 3.31 9.61 2.82 10.35C2.44 10.92 2.42 11.66 2.67 12.3L5.23 18.73C6.5 21.91 9.57 24 13 24C17.42 24 21 20.42 21 16V7M19 16C19 19.31 16.31 22 13 22C10.39 22 8.05 20.41 7.09 18L4.5 11.45L5 11.59C5.5 11.71 5.85 12.05 6 12.5L7 15H9V4.5C9 4.22 9.22 4 9.5 4S10 4.22 10 4.5V12H12V2.5C12 2.22 12.22 2 12.5 2S13 2.22 13 2.5V12H15V4C15 3.72 15.22 3.5 15.5 3.5S16 3.72 16 4V12H18V7C18 6.72 18.22 6.5 18.5 6.5S19 6.72 19 7V16Z',
	// script-text-outline
	scriptOutline: 'M15,20A1,1 0 0,0 16,19V4H8A1,1 0 0,0 7,5V16H5V5A3,3 0 0,1 8,2H19A3,3 0 0,1 22,5V6H20V5A1,1 0 0,0 19,4A1,1 0 0,0 18,5V9L18,19A3,3 0 0,1 15,22H5A3,3 0 0,1 2,19V18H13A2,2 0 0,0 15,20M9,6H14V8H9V6M9,10H14V12H9V10M9,14H14V16H9V14Z',
	// table-large
	tableLarge: 'M4,3H20A2,2 0 0,1 22,5V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V5A2,2 0 0,1 4,3M4,7V10H8V7H4M10,7V10H14V7H10M20,10V7H16V10H20M4,12V15H8V12H4M4,20H8V17H4V20M10,12V15H14V12H10M10,20H14V17H10V20M20,20V17H16V20H20M20,12H16V15H20V12Z',
	// plus-box-outline
	plusBoxOutline: 'M19,19V5H5V19H19M19,3A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5C3,3.89 3.9,3 5,3H19M11,7H13V11H17V13H13V17H11V13H7V11H11V7Z',
	// close-thick
	closeThick: 'M20 6.91L17.09 4L12 9.09L6.91 4L4 6.91L9.09 12L4 17.09L6.91 20L12 14.91L17.09 20L20 17.09L14.91 12L20 6.91Z',
	// plus-thick
	plusThick: 'M20 14H14V20H10V14H4V10H10V4H14V10H20V14Z',
	// circle-outline
	circleOutline: 'M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z',
	// arrow-right-bold-outline
	arrowBoldOutline: 'M11,16H3V8H11V2L21,12L11,22V16M13,7V10H5V14H13V17L18,12L13,7Z',
	// arrow-right-bold
	arrowBold: 'M4,15V9H12V4.16L19.84,12L12,19.84V15H4Z',
}

/** (Job 260) BPMN shapes keep the black border of 0.4.0: the redesign of design round 3 leaves them as they are. */
const BPMN_STYLE = { stroke: TEXT_COLOR }

/** (Job 204) BPMN events: a circle, no text of their own. */
const EVENT = { hit: 'ellipse', outline: 'ellipse', text: [0.15, 0.15, 0.7, 0.7], anchors: SIDES, noText: true, create: { w: 64, h: 64, style: BPMN_STYLE } }
/** (Job 204) The inner circle of an intermediate event. */
const EVENT_INNER = [ring(0.44)]
/** (Job 204) BPMN tasks: a rounded box with text. */
const TASK = { hit: 'box', outline: null, radius: 0.1, text: [0, 0, 1, 1], anchors: SIDES, create: { w: 180, h: 120, style: BPMN_STYLE } }
/** (Job 204) BPMN gateways: a diamond, no text of their own. */
const GATEWAY = {
	hit: 'polygon', outline: [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5], text: [0.25, 0.25, 0.5, 0.5], anchors: SIDES, noText: true, create: { w: 80, h: 80, style: BPMN_STYLE },
}
/** (Job 204) BPMN data objects: a sheet with a folded corner. */
const DATA = {
	hit: 'polygon', outline: [0, 0, 0.75, 0, 1, 0.2, 1, 1, 0, 1], lines: [[0.75, 0, 0.75, 0.2, 1, 0.2]], text: [0, 0.2, 1, 0.8],
	anchors: SIDES, create: { w: 80, h: 100, style: BPMN_STYLE },
}

/**
 * @param {string} icon SVG path data (24 × 24)
 * @return {object} (job 204) a task with this badge at the top left; its text box keeps the full
 *   height (two or three lines of a usual name fit at the auto-fit size) and stays clear of the badge
 */
function badgeTask(icon) {
	return { ...TASK, text: [0.15, 0, 0.7, 1], badge: { icon, at: 'tl' } }
}

export const SHAPES = deepFreeze({

	// job 260 (design round 3, F4): corner, pad and the size on a click (create; rect and roundRect: the
	// registry default 200 × 120)
	rect: { hit: 'box', outline: null, corner: 4, pad: 12, text: [0, 0, 1, 1], anchors: SIDES },
	roundRect: { hit: 'box', outline: null, corner: 16, pad: 12, text: [0, 0, 1, 1], anchors: SIDES },
	ellipse: { hit: 'ellipse', outline: 'ellipse', pad: 8, text: [0.08, 0.23, 0.84, 0.54], anchors: SIDES, create: { w: 160, h: 160 } },
	diamond: {
		hit: 'polygon', outline: [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5], corner: 4, pad: 4, text: [0.21, 0.31, 0.58, 0.38], anchors: SIDES,
		create: { w: 160, h: 160 },
	},
	triangle: {
		hit: 'polygon', outline: [0.5, 0, 1, 1, 0, 1], corner: 4, pad: 4, text: [0.21, 0.6, 0.58, 0.4],
		anchors: [[0.5, 0], [0.75, 0.5], [0.5, 1], [0.25, 0.5]], create: { w: 160, h: 140 },
	},
	arrowRight: {
		hit: 'polygon',
		outline: [0, 0.25, 0.65, 0.25, 0.65, 0, 1, 0.5, 0.65, 1, 0.65, 0.75, 0, 0.75],
		corner: 4,
		pad: 12,
		text: [0, 0.25, 0.65, 0.5],
		anchors: [[0.5, 0.25], [1, 0.5], [0.5, 0.75], [0, 0.5]],
		create: { w: 200, h: 100 },
	},
	// job 201: flowchart
	terminal: { hit: 'box', outline: null, radius: 0.5, text: [0.1, 0, 0.8, 1], anchors: SIDES },
	parallelogram: { hit: 'polygon', outline: [0.2, 0, 1, 0, 0.8, 1, 0, 1], text: [0.2, 0, 0.6, 1], anchors: [[0.6, 0], [0.9, 0.5], [0.4, 1], [0.1, 0.5]] },
	document: {
		hit: 'polygon',
		// the top edge, then the wave from the right to the left
		outline: [0, 0, 1, 0, ...curve((t) => [1 - t, WAVE_Y + WAVE_A * Math.sin(2 * Math.PI * (1 - t))])],
		corner: 4,
		pad: 12,
		text: [0, 0, 1, 0.8],
		anchors: [[0.5, 0], [1, 0.5], [0.5, WAVE_Y], [0, 0.5]],
	},
	database: {
		hit: 'polygon',
		// the top cap from the left over the top, then the bottom cap from the right under the bottom
		outline: [
			...curve((t) => [0.5 - 0.5 * Math.cos(Math.PI * t), CAP - CAP * Math.sin(Math.PI * t)]),
			...curve((t) => [0.5 + 0.5 * Math.cos(Math.PI * t), 1 - CAP + CAP * Math.sin(Math.PI * t)]),
		],
		// the front half of the top ellipse
		lines: [curve((t) => [0.5 - 0.5 * Math.cos(Math.PI * t), CAP + CAP * Math.sin(Math.PI * t)])],
		pad: 12,
		text: [0, 2 * CAP, 1, 0.7],
		anchors: SIDES,
		create: { w: 160, h: 200 },
	},
	subprocess: { hit: 'box', outline: null, radius: 0, lines: [[0.1, 0, 0.1, 1], [0.9, 0, 0.9, 1]], text: [0.1, 0, 0.8, 1], anchors: SIDES },
	hexagon: { hit: 'polygon', outline: [0.2, 0, 0.8, 0, 1, 0.5, 0.8, 1, 0.2, 1, 0, 0.5], text: [0.2, 0, 0.6, 1], anchors: SIDES },
	manualInput: { hit: 'polygon', outline: [0, 0.3, 1, 0, 1, 1, 0, 1], text: [0, 0.3, 1, 0.7], anchors: [[0.5, 0.15], [1, 0.5], [0.5, 1], [0, 0.65]] },
	trapezoid: { hit: 'polygon', outline: [0, 0, 1, 0, 0.8, 1, 0.2, 1], text: [0.15, 0, 0.7, 1], anchors: [[0.5, 0], [0.9, 0.5], [0.5, 1], [0.1, 0.5]] },
	delay: {
		hit: 'polygon',
		// the left half a box, the right half an ellipse from the top over the right to the bottom
		outline: [0, 0, ...curve((t) => [0.5 + 0.5 * Math.sin(Math.PI * t), 0.5 - 0.5 * Math.cos(Math.PI * t)]), 0, 1],
		text: [0, 0, 0.85, 1],
		anchors: SIDES,
	},
	offPage: {
		hit: 'polygon', outline: [0, 0, 1, 0, 1, 0.6, 0.5, 1, 0, 0.6], text: [0, 0, 1, 0.6],
		anchors: [[0.5, 0], [1, 0.3], [0.5, 1], [0, 0.3]], create: { w: 120, h: 120 },
	},
	// job 201: symbols; job 244: Phosphor (the name; Regular lines, Duotone light layer)
	iconPerson: symbol('user'),
	iconPeople: symbol('users'),
	iconPlace: symbol('map-pin'),
	iconClock: symbol('clock'),
	iconWarning: symbol('warning'),
	iconInfo: symbol('info'),
	iconQuestion: symbol('question'),
	iconDone: symbol('check-circle'),
	iconError: symbol('x-circle'),
	iconStar: symbol('star'),
	iconHeart: symbol('heart'),
	iconIdea: symbol('lightbulb'),
	iconFlag: symbol('flag'),
	iconCalendar: symbol('calendar-blank'),
	iconMail: symbol('envelope-simple'),
	iconPhone: symbol('phone'),
	iconHome: symbol('house'),
	iconSettings: symbol('gear'),
	iconLock: symbol('lock'),
	iconCloud: symbol('cloud'),
	// job 203: an own shape (its picture in data.img); a new one is placed with the size of its library entry
	image: { hit: 'box', outline: null, radius: 0, text: [0, 0, 1, 1], anchors: SIDES, image: true, create: { w: 96, h: 96, style: { strokeWidth: 0, fillOpacity: 0 } } },
	// job 204: BPMN events
	bpmnStart: EVENT,
	bpmnStartMessage: { ...EVENT, mark: { icon: MDI.emailOutline, share: 0.5 } },
	bpmnStartTimer: { ...EVENT, mark: { icon: MDI.clockOutline, share: 0.6 } },
	bpmnIntermediate: { ...EVENT, lines: EVENT_INNER },
	bpmnIntermediateMessage: { ...EVENT, lines: EVENT_INNER, mark: { icon: MDI.emailOutline, share: 0.45 } },
	bpmnIntermediateTimer: { ...EVENT, lines: EVENT_INNER, mark: { icon: MDI.clockOutline, share: 0.55 } },
	bpmnEnd: { ...EVENT, thick: true },
	bpmnEndMessage: { ...EVENT, thick: true, mark: { icon: MDI.email, share: 0.5 } },
	bpmnEndError: { ...EVENT, thick: true, mark: { icon: MDI.flash, share: 0.55 } },
	bpmnEndTerminate: { ...EVENT, thick: true, mark: { icon: MDI.circle, share: 0.6 } },
	// job 204: BPMN tasks
	bpmnTask: TASK,
	bpmnUserTask: badgeTask(MDI.account),
	bpmnServiceTask: badgeTask(MDI.cogOutline),
	bpmnManualTask: badgeTask(MDI.handOutline),
	bpmnScriptTask: badgeTask(MDI.scriptOutline),
	bpmnRuleTask: badgeTask(MDI.tableLarge),
	bpmnSendTask: badgeTask(MDI.email),
	bpmnReceiveTask: badgeTask(MDI.emailOutline),
	// its text above the badge, narrower so two lines of a usual name fit at the auto-fit size
	bpmnSubprocess: { ...TASK, text: [0.1, 0, 0.8, 0.78], badge: { icon: MDI.plusBoxOutline, at: 'bottom' } },
	bpmnCallActivity: { ...TASK, thick: true },
	// job 204: BPMN gateways
	bpmnExclusive: { ...GATEWAY, mark: { icon: MDI.closeThick, share: 0.45 } },
	bpmnParallel: { ...GATEWAY, mark: { icon: MDI.plusThick, share: 0.5 } },
	bpmnInclusive: { ...GATEWAY, mark: { icon: MDI.circleOutline, share: 0.5 } },
	bpmnEventGateway: { ...GATEWAY, lines: [ring(0.2), ring(0.16), pentagon(0.1)] },
	// job 204: BPMN data (the data store is the cylinder of database)
	bpmnDataObject: DATA,
	bpmnDataInput: { ...DATA, text: [0, 0.3, 1, 0.7], badge: { icon: MDI.arrowBoldOutline, at: 'tl' } },
	bpmnDataOutput: { ...DATA, text: [0, 0.3, 1, 0.7], badge: { icon: MDI.arrowBold, at: 'tl' } },
	bpmnDataStore: {
		hit: 'polygon',
		outline: [
			...curve((t) => [0.5 - 0.5 * Math.cos(Math.PI * t), CAP - CAP * Math.sin(Math.PI * t)]),
			...curve((t) => [0.5 + 0.5 * Math.cos(Math.PI * t), 1 - CAP + CAP * Math.sin(Math.PI * t)]),
		],
		lines: [curve((t) => [0.5 - 0.5 * Math.cos(Math.PI * t), CAP + CAP * Math.sin(Math.PI * t)])],
		text: [0, 2 * CAP, 1, 0.7],
		anchors: SIDES,
		create: { w: 120, h: 120, style: BPMN_STYLE },
	},
})

/** (job 203) The preview of the kind image (MDI image-outline, 24 × 24): a picture without its data. */
export const IMAGE_PREVIEW = 'M19,19H5V5H19M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M13.96,12.29L11.21,15.83L9.25,13.47L6.5,17H17.5L13.96,12.29Z'

/** (job 201) The six kinds of M1: the shape tool's menu and the context bar outside the flowchart. */
export const BASIC_KINDS = Object.freeze(['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'arrowRight'])

/** (job 201) The flowchart's kinds in the order of its library (process = rect, decision = diamond). */
export const FLOWCHART_KINDS = Object.freeze([
	'rect', 'diamond', 'terminal', 'parallelogram', 'document', 'database', 'subprocess', 'hexagon', 'manualInput',
	'trapezoid', 'delay', 'offPage',
])

/**
 * (Job 204) The BPMN kinds by group, in the order of the BPMN library: the
 * section "Shape" of the context bar offers the kinds of one group.
 */
export const BPMN_GROUPS = deepFreeze({
	events: [
		'bpmnStart', 'bpmnStartMessage', 'bpmnStartTimer', 'bpmnIntermediate', 'bpmnIntermediateMessage', 'bpmnIntermediateTimer',
		'bpmnEnd', 'bpmnEndMessage', 'bpmnEndError', 'bpmnEndTerminate',
	],
	tasks: [
		'bpmnTask', 'bpmnUserTask', 'bpmnServiceTask', 'bpmnManualTask', 'bpmnScriptTask', 'bpmnRuleTask', 'bpmnSendTask',
		'bpmnReceiveTask', 'bpmnSubprocess', 'bpmnCallActivity',
	],
	gateways: ['bpmnExclusive', 'bpmnParallel', 'bpmnInclusive', 'bpmnEventGateway'],
	data: ['bpmnDataObject', 'bpmnDataInput', 'bpmnDataOutput', 'bpmnDataStore'],
})

/**
 * @param {unknown} kind data.kind
 * @return {string[]|null} (job 204) the kinds of the BPMN group of kind, null for any other kind
 */
export function bpmnGroupOf(kind) {
	for (const list of Object.values(BPMN_GROUPS)) {
		if (list.includes(kind)) return list
	}
	return null
}

/**
 * @param {unknown} kind data.kind
 * @return {number} (job 260) the text padding of the kind: its pad, else SHAPE_TEXT_PADDING
 */
export function textPad(kind) {
	const p = shapeOf(kind).pad
	return typeof p === 'number' ? p : SHAPE_TEXT_PADDING
}

/**
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 * @return {number} (job 260) the corner radius of a box kind drawn at w × h: its fixed corner, else its
 *   radius share of min(w, h), at most half of each side; 0 = sharp
 */
export function boxRadius(kind, w, h) {
	const s = shapeOf(kind)
	const r = s.corner > 0 ? s.corner : s.radius > 0 ? s.radius * Math.min(w, h) : 0
	return Math.max(0, Math.min(r, w / 2, h / 2))
}

/** Segments of the polygon that stands in for an ellipse in outlinePoints(). */
export const ELLIPSE_SEGMENTS = 32

/**
 * @param {unknown} kind data.kind of a shape
 * @return {object} SHAPES[kind], or SHAPES.rect for a missing or unknown kind
 *   (own keys only: 'constructor' is an unknown kind, too)
 */
export function shapeOf(kind) {
	return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(SHAPES, kind) ? SHAPES[kind] : SHAPES.rect
}

/**
 * @param {unknown} kind data.kind
 * @return {boolean} (job 201) a kind with a symbol (icon), (job 203) or the picture
 *   of an own shape: it has no text inside its box (job 211: a symbol has a label below)
 */
export function isSymbolKind(kind) {
	const s = shapeOf(kind)
	return typeof s.icon === 'string' || s.image === true
}

/**
 * @param {unknown} kind data.kind
 * @return {boolean} (job 203) the kind of an own shape (its picture in data.img)
 */
export function isImageKind(kind) {
	return shapeOf(kind).image === true
}

/**
 * @param {unknown} kind data.kind
 * @return {boolean} (job 204) a kind without text inside its box: a symbol, an own
 *   shape, or a kind marked noText (BPMN events and gateways); (job 211) the
 *   symbols and noText kinds, (job 235) and own shapes, have a label below instead (hasLabel)
 */
export function isTextless(kind) {
	return isSymbolKind(kind) || shapeOf(kind).noText === true
}

/**
 * @param {unknown} kind data.kind
 * @return {boolean} (job 211) a kind whose text is a label below its box: a
 *   symbol (icon) or a kind marked noText (BPMN events and gateways); (job 235) or an
 *   own shape (image)
 */
export function hasLabel(kind) {
	const s = shapeOf(kind)
	return typeof s.icon === 'string' || s.noText === true || s.image === true
}

/**
 * (Job 260) The kinds the redesign of design round 3 (variant F4) applies to:
 * the six basic kinds and the twelve of the flowchart. Their default border
 * is SHAPE_BORDER (shownBorder), and picking a fill from the palette gives
 * them the strong tone of that colour as border (actions.setStyle). BPMN
 * kinds, symbols and own shapes stay as they are.
 */
export const REDESIGN_KINDS = Object.freeze(BASIC_KINDS.concat(FLOWCHART_KINDS))

/**
 * (Job 260) The colour a shape's border is DRAWN in: on a kind of
 * REDESIGN_KINDS the old default border '#191b1d' (stored by every shape of
 * 0.4.0; also an old palette colour shownColor draws as it, like '#1a1a1a',
 * the default of 0.1.0) as SHAPE_BORDER; everything else through shownColor.
 *
 * @param {unknown} kind data.kind
 * @param {unknown} hex the shape's style.stroke
 * @return {unknown} see shownColor
 */
export function shownBorder(kind, hex) {
	const c = shownColor(hex)
	return c === OLD_SHAPE_BORDER && REDESIGN_KINDS.includes(kind) ? SHAPE_BORDER : c
}

/**
 * (Job 260) The border a fill picked from the palette brings along on a
 * kind of REDESIGN_KINDS: the strong tone of the same palette colour (tone
 * on tone), SHAPE_BORDER for white (a white border on a white fill would
 * vanish). A custom colour (not one of LIGHT) and any other kind: null, the
 * border stays.
 *
 * @param {unknown} kind data.kind
 * @param {unknown} fill the new style.fill (normalised lowercase #rrggbb, as checkField gives it)
 * @return {string|null} lowercase #rrggbb, or null
 */
export function fillBorder(kind, fill) {
	const e = REDESIGN_KINDS.includes(kind) && PALETTE.find((p) => p.light === fill)
	return !e ? null : e.key === 'weiss' ? SHAPE_BORDER : e.strong
}

/**
 * (Job 240) The kinds that begin square: a square `create`, without the own
 * shape (it takes the proportions of its picture). Symbols, BPMN events,
 * gateways, the data store and the off-page reference.
 */
export const SQUARE_KINDS = Object.freeze(Object.keys(SHAPES).filter((k) => {
	const c = SHAPES[k].create
	// (job 260) ellipse and diamond begin square since design round 3 but keep resizing freely
	return !SHAPES[k].image && !!c && c.w === c.h && k !== 'ellipse' && k !== 'diamond'
}))

/**
 * (Job 240) The tick "1:1" of "Arrange" as it acts: only shapes have it;
 * style.square 'on' or 'off' as stored; without a stored value a shape of a
 * SQUARE_KINDS kind counts as ticked while it is square (w and h equal on
 * the 0.01 grid), every other shape as unticked.
 *
 * @param {object|null|undefined} item stored item
 * @param {unknown} [square] style.square to judge instead of the stored one
 * @return {boolean} the shape keeps 1:1
 */
export function squareOn(item, square = item?.style?.square) {
	if (item?.t !== 'shape') return false
	if (square === 'on' || square === 'off') return square === 'on'
	const { w, h } = item
	return SQUARE_KINDS.includes(item.data?.kind) && typeof w === 'number' && typeof h === 'number' && Math.abs(w - h) < 0.005
}

/**
 * (Job 211) The label of a symbol, BPMN event or gateway in the item's own
 * coordinates (origin top-left of its unrotated box), ESTIMATED like a
 * connector label (text.js wrapLabel, upper bounds per glyph, no canvas), so
 * the index box, the hit test, the drawing and the editor agree on every
 * client. Font size fs: the stored one, else SYMBOL_LABEL_FONT_SIZE; the
 * lines wrap at wrapW = max(w, SYMBOL_LABEL_WRAP_W); the box is as wide as
 * the widest line, lines × fs × LINE_HEIGHT high, centred SYMBOL_LABEL_GAP
 * below the box.
 *
 * @param {unknown} kind data.kind
 * @param {unknown} text data.text
 * @param {unknown} fontSize style.fontSize as stored (null: none)
 * @param {number} w width of the box
 * @param {number} h height of the box
 * @return {{x: number, y: number, w: number, h: number, fs: number, lines: number, wrapW: number}|null}
 *   null for a kind without a label or a blank text
 */
export function symbolLabelBox(kind, text, fontSize, w, h) {
	if (!hasLabel(kind) || typeof text !== 'string' || text.trim() === '') return null
	const fs = typeof fontSize === 'number' && fontSize > 0 ? fontSize : SYMBOL_LABEL_FONT_SIZE
	const wrapW = Math.max(w, SYMBOL_LABEL_WRAP_W)
	// job 279: Markdown marks take no room; bold runs a little more (10 %)
	const marks = hasMarks(text)
	const rows = wrapLabel(marks ? shownText(text) : text, wrapW, fs)
	let widest = 0
	for (const r of rows) widest = Math.max(widest, r.width)
	if (marks) widest = Math.min(wrapW, widest * 1.1)
	const lines = Math.max(1, rows.length)
	return { x: (w - widest) / 2, y: h + SYMBOL_LABEL_GAP, w: widest, h: lines * fs * LINE_HEIGHT, fs, lines, wrapW }
}

/** (Job 204) Largest side of a badge (world units) and its share of the box's shorter side. */
export const BADGE_SIZE = 20
export const BADGE_SHARE = 0.3

/**
 * (Job 204) The square of a kind's badge: side s = min(BADGE_SIZE,
 * BADGE_SHARE · min(w, h)), margin 0.3 · s from the edges; 'tl' at the top
 * left, 'bottom' centred at the bottom.
 *
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 * @return {{x: number, y: number, s: number}|null} null without a badge (or an empty box)
 */
export function badgeBox(kind, w, h) {
	const b = shapeOf(kind).badge
	if (!b) return null
	const s = Math.min(BADGE_SIZE, BADGE_SHARE * Math.min(w, h))
	if (!(s > 0)) return null
	const m = 0.3 * s
	return b.at === 'bottom' ? { x: (w - s) / 2, y: h - s - m, s } : { x: m, y: m, s }
}

/**
 * (Job 204) Where a kind's mark (centred, share · min(w, h)) or badge
 * (badgeBox) goes in its box.
 *
 * @param {unknown} kind data.kind
 * @param {number} w width
 * @param {number} h height
 * @return {{icon: string, x: number, y: number, s: number}|null} the icon's square, null without one
 */
export function markPlace(kind, w, h) {
	const sh = shapeOf(kind)
	if (sh.mark) {
		const s = sh.mark.share * Math.min(w, h)
		return s > 0 ? { icon: sh.mark.icon, x: (w - s) / 2, y: (h - s) / 2, s } : null
	}
	const b = badgeBox(kind, w, h)
	return b ? { icon: sh.badge.icon, ...b } : null
}

/** (job 204) Side of a badge in the preview, as a share of the preview box's shorter side. */
const PREVIEW_BADGE = 0.55

/** (job 201) Size of the preview grid (an icon's 24 × 24) and its margin. */
const PREVIEW = 24
const PREVIEW_PAD = 2

/**
 * @param {number} v number
 * @return {string} v with at most two decimals
 */
function n2(v) {
	return String(Math.round(v * 100) / 100 + 0)
}

/**
 * (Job 201) The preview of a kind in a 24 × 24 grid, from the same table as
 * the board (the shapes panel's tiles, the context bar's buttons): a symbol
 * is its icon, filled; any other kind its outline and inner lines, to be
 * stroked, in the proportions of a new shape of the kind (create, else
 * 200 × 120) and centred.
 *
 * (Job 204) mark: the mark of the kind (markPlace on the preview's box) or
 * its badge (PREVIEW_BADGE of the box's shorter side) as {d, x, y, s}, its icon's path data and its square in the
 * grid (translate x, y, then scale s / 24), filled; thick: the outline
 * stroked twice as wide.
 *
 * @param {unknown} kind data.kind (unknown kinds: rect)
 * (Job 244) duo: the light layer of a symbol (path data in the same grid,
 * filled at DUO_SHARE under d), null for any other kind.
 *
 * @return {{d: string, filled: boolean, mark: ({d: string, x: number, y: number, s: number}|null), thick: boolean, duo: (string|null)}}
 *   SVG path data and whether it is filled (else stroked)
 */
export function shapePreview(kind) {
	const s = shapeOf(kind)
	if (typeof s.icon === 'string') {
		return { d: s.icon, filled: true, mark: null, thick: false, duo: typeof s.duo === 'string' ? s.duo : null }
	}
	if (s.image === true) {
		return { d: IMAGE_PREVIEW, filled: true, mark: null, thick: false, duo: null }
	}
	const W = s.create?.w ?? 200
	const H = s.create?.h ?? 120
	const k = (PREVIEW - 2 * PREVIEW_PAD) / Math.max(W, H)
	const w = W * k
	const h = H * k
	const ox = (PREVIEW - w) / 2
	const oy = (PREVIEW - h) / 2
	const X = (v) => n2(ox + v * w)
	const Y = (v) => n2(oy + v * h)
	const poly = (pts) => pts.map((v, i) => (i % 2 === 0 ? (i === 0 ? 'M' : 'L') + X(v) : ' ' + Y(v))).join('')
	let d
	if (Array.isArray(s.outline)) {
		d = poly(s.outline) + 'Z'
	} else if (s.outline === 'ellipse') {
		const rx = n2(w / 2)
		const ry = n2(h / 2)
		d = `M${X(0)} ${Y(0.5)}A${rx} ${ry} 0 1 0 ${X(1)} ${Y(0.5)}A${rx} ${ry} 0 1 0 ${X(0)} ${Y(0.5)}Z`
	} else if (boxRadius(kind, W, H) > 0) {
		// (job 260) the radius at the board size of the kind, scaled like the box
		const r = boxRadius(kind, W, H) * k
		const rr = n2(r)
		const a = (x, y) => `A${rr} ${rr} 0 0 1 ${n2(x)} ${n2(y)}`
		d = `M${n2(ox + r)} ${n2(oy)}H${n2(ox + w - r)}${a(ox + w, oy + r)}V${n2(oy + h - r)}${a(ox + w - r, oy + h)}`
			+ `H${n2(ox + r)}${a(ox, oy + h - r)}V${n2(oy + r)}${a(ox + r, oy)}Z`
	} else {
		d = `M${X(0)} ${Y(0)}H${X(1)}V${Y(1)}H${X(0)}Z`
	}
	for (const line of s.lines ?? []) {
		d += poly(line)
	}
	let m = markPlace(kind, w, h)
	if (m && s.badge) {
		// a badge at its board size would be a dot in the small preview
		const bs = PREVIEW_BADGE * Math.min(w, h)
		const mg = 0.1 * bs
		m = { icon: m.icon, s: bs, x: s.badge.at === 'bottom' ? (w - bs) / 2 : mg, y: s.badge.at === 'bottom' ? h - bs - mg : mg }
	}
	const mark = m ? { d: m.icon, x: Math.round((ox + m.x) * 100) / 100, y: Math.round((oy + m.y) * 100) / 100, s: Math.round(m.s * 100) / 100 } : null
	return { d, filled: false, mark, thick: s.thick === true, duo: null }
}

/**
 * The outline as a flat point list in item coordinates (origin top-left of
 * the unrotated box). rect and roundRect give the four box corners (the
 * renderer rounds the corners of roundRect itself), ellipse a regular
 * ELLIPSE_SEGMENTS-gon starting at the top and running clockwise, the
 * polygon kinds their outline scaled by w and h. geometry.shapePolygon
 * delegates here for the polygon kinds.
 *
 * @param {unknown} kind data.kind (unknown kinds count as rect)
 * @param {number} w width
 * @param {number} h height
 * @return {number[]} [x0, y0, x1, y1, …], a new array
 */
export function outlinePoints(kind, w, h) {
	const outline = shapeOf(kind).outline
	if (Array.isArray(outline)) {
		return outline.map((v, i) => (i % 2 === 0 ? v * w : v * h))
	}
	if (outline === 'ellipse') {
		const out = []
		const rx = w / 2
		const ry = h / 2
		for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
			const t = -Math.PI / 2 + (2 * Math.PI * i) / ELLIPSE_SEGMENTS
			out.push(rx + rx * Math.cos(t), ry + ry * Math.sin(t))
		}
		return out
	}
	return [0, 0, w, 0, w, h, 0, h]
}

/** (job 201) Parsed icons by kind (parseSvgPath once per kind; null = unreadable). */
const ICON_COMMANDS = new Map()

/**
 * @param {unknown} kind data.kind
 * @return {Array|null} (job 201) the icon of a symbol kind as canvas commands
 *   in its 24 × 24 grid (svgPath.js), null for any other kind or an unreadable icon
 */
export function iconCommands(kind) {
	return commandsOf(shapeOf(kind).icon)
}

/**
 * @param {unknown} kind data.kind
 * @return {Array|null} (job 244) the light layer of a symbol kind as canvas
 *   commands in its 24 × 24 grid, null for any other kind
 */
export function duoCommands(kind) {
	return commandsOf(shapeOf(kind).duo)
}

/**
 * @param {unknown} icon SVG path data (24 × 24)
 * @return {Array|null} its canvas commands (parsed once), null for no or unreadable data
 */
function commandsOf(icon) {
	if (typeof icon !== 'string') return null
	if (!ICON_COMMANDS.has(icon)) ICON_COMMANDS.set(icon, parseSvgPath(icon))
	return ICON_COMMANDS.get(icon)
}

/**
 * @param {unknown} kind data.kind
 * @return {Array|null} (job 204) the icon of the kind's mark or badge as canvas
 *   commands in its 24 × 24 grid, null without one or for an unreadable icon
 */
export function markCommands(kind) {
	const s = shapeOf(kind)
	return commandsOf(s.mark?.icon ?? s.badge?.icon)
}
