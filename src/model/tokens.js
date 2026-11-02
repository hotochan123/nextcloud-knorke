/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Visual constants shared by the model (hit bands, rbush padding), the scene
 * nodes and the shell (SPEC-M0 §6.2, SPEC-M1 §6.2). Port of the engine spike's
 * style.js, plus the M1 palettes and color helpers of the context bar
 * (§6.5.1). Anything that changes how a node looks or where it can be hit
 * lives here, so renderer and hit test cannot drift apart. Colors are
 * lowercase #rrggbb, the form the server stores. The shell imports the
 * palettes by name and never repeats their values. (Job 186) labOf and
 * nearestColor find the palette colour that looks most like a custom one.
 *
 * Job 227 (redesign, docs/redesign/tokens.css part 2): ONE palette of 13
 * named colours (PALETTE), each with a light tone for notes and fills and a
 * strong tone for lines, text, mind-map branches, tags and people. The old
 * palettes (STICKY_COLORS, SHAPE_PALETTE, CONNECTOR_COLORS, FRAME_FILLS,
 * LEGACY_TAG_COLORS, LEGACY_MM_COLORS) stay frozen only for shownColor and
 * the scene lab: a stored old palette colour is DRAWN as the nearest new
 * tone of its row, the stored value stays until someone recolours.
 */

/**
 * (Job 227) The one palette, in the order every picker shows it; name is the
 * English source text of its tooltip (components/labels.js paletteName).
 * White's strong tone is white itself (white text or border on a dark
 * fill); STRONG_COLORED leaves it out.
 */
export const PALETTE = Object.freeze([
	{ key: 'hellblau', name: 'Light blue', light: '#a2d9fe', strong: '#0275a9' },
	{ key: 'tuerkis', name: 'Turquoise', light: '#8fe7e1', strong: '#087c77' },
	{ key: 'salbei', name: 'Sage', light: '#b3e8b3', strong: '#307d37' },
	{ key: 'gelb', name: 'Yellow', light: '#faea89', strong: '#7e6f01' },
	{ key: 'orange', name: 'Orange', light: '#febf87', strong: '#a25d04' },
	{ key: 'koralle', name: 'Coral', light: '#ffaaa7', strong: '#c43e45' },
	{ key: 'rosa', name: 'Pink', light: '#f9b7d6', strong: '#b94082' },
	{ key: 'lila', name: 'Purple', light: '#d9b9ee', strong: '#9550bb' },
	{ key: 'indigo', name: 'Indigo', light: '#b9c8fc', strong: '#5165d3' },
	{ key: 'sand', name: 'Sand', light: '#e1ceb0', strong: '#816b46' },
	{ key: 'weiss', name: 'White', light: '#ffffff', strong: '#ffffff' },
	{ key: 'grau', name: 'Gray', light: '#e0e0dd', strong: '#6f6f6d' },
	{ key: 'schwarz', name: 'Black', light: '#191b1d', strong: '#191b1d' },
].map((e) => Object.freeze(e)))

/** (Job 227) The 13 light tones: fills of notes, note pads, frames, shapes and table headers. */
export const LIGHT = Object.freeze(PALETTE.map((e) => e.light))
/** (Job 227) The 13 strong tones: borders and text of shapes, text items and tables. */
export const STRONG = Object.freeze(PALETTE.map((e) => e.strong))
/** (Job 227) The 12 strong tones without white: connector lines, tags, mind-map branches. */
export const STRONG_COLORED = Object.freeze(PALETTE.filter((e) => e.key !== 'weiss').map((e) => e.strong))
/** (Job 227) The first 10 strong tones: the colours of people and of new main branches. */
export const TEN = Object.freeze(STRONG.slice(0, 10))

/**
 * Sticky note palette of 0.1.0–0.4.0, 14 colors (job 227: legacy, drawn
 * through shownColor; the scene lab still generates with it).
 */
export const STICKY_COLORS = Object.freeze([
	'#fff6b6', '#f5d76e', '#d4e98a', '#b8f0a0', '#a8d8f8', '#7fd3cc', '#6cc6ea',
	'#ffb27a', '#f2a7c8', '#f58a98', '#c8a5d6', '#dfe98a', '#e4e4e4', '#ffd8e6',
])

/** Default note color: Light blue's light tone (job 227). Deliberately not yellow (brand note in the dossier §5). */
export const DEFAULT_STICKY_FILL = '#a2d9fe'

/**
 * (Job 227) The text sizes S, M and L of notes (the context bar's steps for
 * notes); a new note gets NOTE_SIZE_M, and a long word shrinks a note's text
 * at most down to NOTE_SIZE_S (model/text.js noteTextLayout).
 */
export const NOTE_SIZE_S = 16
export const NOTE_SIZE_M = 22
export const NOTE_SIZE_L = 32

/** (Job 227) Text on the canvas: tokens.css --canvas-text (Black). */
export const TEXT_COLOR = '#191b1d'
/**
 * (Job 277) The one AI violet: the sparkle of the AI card and, as --k-ai in
 * knorke.css, every AI marking of the bars (5.39 : 1 on #ffffff, 4.94 : 1 on
 * the hover #f5f5f5, so the small label "AI" passes WCAG AA).
 */
export const AI_VIOLET = '#6a4fe8'
/** The canvas keeps Arial (job 227, user decision): every device wraps a note the same. */
export const FONT_FAMILY = 'Arial, "Liberation Sans", Helvetica, sans-serif'
export const LINE_HEIGHT = 1.2
/** (Job 259, redesign round 3 N4) Line height of a note's text (canvas and editor); every other item keeps LINE_HEIGHT. */
export const NOTE_LINE_HEIGHT = 1.25
/** (Job 227) tokens.css --note-radius; (job 259) padding 18 (round 3 N4, before 16). */
export const STICKY_PADDING = 18
export const STICKY_RADIUS = 6
/** (Job 259) Leg length of a note's dog ear at its bottom right corner (round 3 N2c), world units. */
export const NOTE_EAR = 26
/** (Job 259) A note's fine edge: width and opacity of its strong tone (noteStrongTone). */
export const NOTE_EDGE_WIDTH = 1
export const NOTE_EDGE_OPACITY = 0.18
/** (Job 259) Opacity of the strong tone over the dog-ear flap. */
export const NOTE_EAR_TONE_OPACITY = 0.22
/** (Job 259) The flap's small shadow: the flap moved down by y, black at opacity (no shadowBlur). */
export const NOTE_EAR_SHADOW = Object.freeze({ y: 1, opacity: 0.12 })

/**
 * (Job 259) The dog ear of a w × h note: NOTE_EAR, at most a quarter of either side.
 *
 * @param {number} w width
 * @param {number} h height
 * @return {number} the ear's leg length (0 for an empty box)
 */
export function noteEar(w, h) {
	if (!(w > 0) || !(h > 0)) return 0
	return Math.min(NOTE_EAR, w / 4, h / 4)
}

/** Discrete font sizes for auto-fit text (computed, never stored). */
export const FONT_STEPS = Object.freeze([10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64])

/**
 * Drop shadows under notes (dropped below LOD_TEXT_SCALE). Job 227: one
 * layer; job 259 (redesign round 3 N4): two, the far one first (painted
 * first), then the near one. blur as a canvas shadowBlur (sigma = blur / 2).
 */
export const NOTE_SHADOWS = Object.freeze([
	Object.freeze({ x: 0, y: 5, blur: 14, opacity: 0.09 }),
	Object.freeze({ x: 0, y: 1, blur: 2, opacity: 0.10 }),
])

/** Frame defaults; the fill of a real frame comes from its style.fill. */
export const FRAME_FILL = '#ffffff'
/**
 * Frame palette of 0.1.0–0.4.0 (the note palette plus white), FRAME_FILL
 * first; job 227: legacy, like STICKY_COLORS.
 */
export const FRAME_FILLS = Object.freeze([FRAME_FILL, ...STICKY_COLORS])
/**
 * (Job 227) tokens.css --frame-stroke and --frame-stroke-width; also the lane
 * dividers. (Job 243) Dark enough for 3 : 1 on every LIGHT tone and on
 * BOARD_BACKGROUND.
 */
export const FRAME_STROKE = '#67686a'
export const FRAME_STROKE_WIDTH = 1.5
/** (Job 243) The frame name stands in a tab on the frame's top left edge: 22, semibold, dark (design round 2, A2). */
export const FRAME_TITLE_SIZE = 22
export const FRAME_TITLE_WEIGHT = '600'
export const FRAME_TITLE_COLOR = TEXT_COLOR
/**
 * (job 143) The grey "Add title…" hint above a selected frame without a
 * title: lighter than FRAME_TITLE_COLOR, still 4.6 : 1 on BOARD_BACKGROUND.
 * (Job 243) In a dashed tab (FRAME_TITLE_HINT_DASH, screen px), regular weight.
 */
export const FRAME_TITLE_HINT_COLOR = '#646d77'
export const FRAME_TITLE_HINT_WEIGHT = 'normal'
export const FRAME_TITLE_HINT_DASH = Object.freeze([5, 4])
/** Height of the title band above a frame (job 243: the tab's height); it belongs to the frame's hit area. */
export const FRAME_TITLE_BAND = 40
/** (Job 243) The space left and right of the title in its tab. */
export const FRAME_TAB_PAD = 14
/** (Job 243) A tab ends at least this far left of its frame's right edge. */
export const FRAME_TAB_INSET = 24
/** (Job 243) The least width of a tab (a narrower frame: its width). */
export const FRAME_TAB_MIN_W = 12
/** (Job 243) The corner radius of frames and of their tab; (job 262, design round 4 R4) 8 (6 before). */
export const FRAME_RADIUS = 8
/**
 * (Job 262, design round 4 R4) The tab of a frame the own user selected is
 * its tab tone mixed with FRAME_SELECTED_TAB_MIX of the selection colour.
 */
export const FRAME_SELECTED_TAB_MIX = 0.22
/** (Job 243) The least contrast of a tab's title on its tone (WCAG 2.x). */
export const FRAME_TAB_MIN_CONTRAST = 4.5
/**
 * (Job 243) The tab tone of each LIGHT tone (design round 2, A2): White,
 * Yellow and Light blue as the design gives them, the other ten computed
 * once by the rule of frameTabFill (tests/js/model/tokens.test.mjs checks
 * that they still match it).
 */
export const FRAME_TAB_FILLS = Object.freeze({
	'#ffffff': '#d1d1ce',
	'#faea89': '#e8ce49',
	'#a2d9fe': '#6bbef2',
	'#8fe7e1': '#50cec7',
	'#b3e8b3': '#8acf8b',
	'#febf87': '#ec9d4f',
	'#ffaaa7': '#ef8482',
	'#f9b7d6': '#e693bc',
	'#d9b9ee': '#c198db',
	'#b9c8fc': '#98aaec',
	'#e1ceb0': '#c8b08a',
	'#e0e0dd': '#c3c3bf',
	'#191b1d': '#36383b',
})

/**
 * (Job 243) The width of a frame's tab for a title (or the hint) textW wide
 * in one line of its font, on a frame w wide: the text with FRAME_TAB_PAD
 * on both sides, ending at least FRAME_TAB_INSET left of the right edge,
 * at least FRAME_TAB_MIN_W (or w, for a narrower frame).
 *
 * @param {number} textW width of the text (world units)
 * @param {number} w frame width
 * @return {number} the tab's width, ≥ 0
 */
export function frameTabWidth(textW, w) {
	const fw = Number.isFinite(w) && w > 0 ? w : 0
	const tw = Number.isFinite(textW) && textW > 0 ? textW : 0
	return Math.max(Math.min(tw + 2 * FRAME_TAB_PAD, fw - FRAME_TAB_INSET), Math.min(fw, FRAME_TAB_MIN_W))
}
/** Width of the frame border band that hits the frame, in screen px (÷ scale in world). */
export const FRAME_EDGE_HIT_PX = 8
/**
 * (Job 264, design round 4 S4) The heads of a frame with lanes: the tab tone
 * at LANE_HEAD_MIX over the frame's fill, a group's cell at LANE_GROUP_MIX;
 * the dividers in the tab tone mixed LANE_LINE_MIX with black, those between
 * columns at LANE_COL_LINE_OPACITY.
 */
export const LANE_HEAD_MIX = 0.45
export const LANE_GROUP_MIX = 0.75
export const LANE_LINE_MIX = 0.85
export const LANE_COL_LINE_OPACITY = 0.7

/** Unknown item types: grey dashed box with the type name. */
export const PLACEHOLDER_FILL = '#f4f4f4'
export const PLACEHOLDER_STROKE = '#9aa0a6'
export const PLACEHOLDER_DASH = Object.freeze([6, 4])
export const PLACEHOLDER_TEXT_COLOR = '#5f6368'

/** (Job 227) tokens.css --canvas-bg; also --knorke-board-bg in styles/knorke.css. */
export const BOARD_BACKGROUND = '#f3f2f0'

/** LOD 1 below this scale: notes without text and shadow; frame titles stay. */
export const LOD_TEXT_SCALE = 0.3
/** LOD 2 (M1, not used in M0). */
export const LOD_COARSE_SCALE = 0.1
/** LOD 2 hysteresis (SPEC-M1 §6.2, §8.5 G14): enter below, leave above. */
export const LOD2_ENTER = 0.095
export const LOD2_LEAVE = 0.105
/** LOD 1 of `text` items: drawn while fontSize · scale ≥ TEXT_MIN_PX. */
export const TEXT_MIN_PX = 6

/** Zoom range 5 % to 1000 % (job 238: up to 400 % before). */
export const MIN_SCALE = 0.05
export const MAX_SCALE = 10
/**
 * (Job 238) The highest scale of a zoom that fits something in: a jump to an
 * item (SceneManager.cameraForRect), the camera after inserting a template or
 * a board file and the small-target zoom of mode vote; a zoom by hand,
 * following and (job 242) "Zoom to selection" (Shift+2) go up to MAX_SCALE.
 */
export const ZOOM_TO_MAX_SCALE = 4

/**
 * Shape palette of 0.1.0–0.4.0 (fill, stroke and text color of shapes): a
 * light row (the first 8) for fills and a strong row for strokes and text.
 * Job 227: legacy, like STICKY_COLORS.
 */
export const SHAPE_PALETTE = Object.freeze([
	'#ffffff', '#e4e4e4', '#fff6b6', '#ffe8cc', '#ffc9c9', '#e5dbff', '#a8d8f8', '#d3f9d8',
	'#1a1a1a', '#868e96', '#f08c00', '#e03131', '#c2255c', '#7048e8', '#0082c9', '#2f9e44',
])

/**
 * Line colors of connectors of 0.1.0–0.4.0, the old default '#1a1a1a'
 * first. Job 227: legacy, like STICKY_COLORS.
 */
export const CONNECTOR_COLORS = Object.freeze([
	'#1a1a1a', '#868e96', '#e03131', '#f08c00', '#2f9e44', '#0082c9', '#7048e8', '#c2255c',
])

/**
 * (Job 227) The default line of connectors (tokens.css --connector-stroke,
 * 9.3 : 1 on the canvas): not one of the 13 colours, so the line palette
 * offers it first as "Default"; a connector with the old default '#1a1a1a'
 * is drawn in it (shownLine).
 */
export const CONNECTOR_STROKE = '#3d4044'
/** (Job 227) The default text of shapes and the colour of text items: Black's strong tone (job 260: no longer the border). */
export const SHAPE_STROKE = TEXT_COLOR
/**
 * (Job 260, design round 3 F4) The default border of the basic and flowchart
 * shapes (shapes.js REDESIGN_KINDS): the connector's default line, so the
 * border palette offers it first as "Default".
 */
export const SHAPE_BORDER = CONNECTOR_STROKE
/** (Job 260) The default border of 0.4.0 (Black's strong tone): drawn as SHAPE_BORDER on those kinds (shapes.js shownBorder). */
export const OLD_SHAPE_BORDER = '#191b1d'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * @param {unknown} hex color
 * @return {[number, number, number]|null} sRGB channels 0..255, null when not #rrggbb
 */
function channels(hex) {
	if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
		return null
	}
	const n = parseInt(hex.slice(1), 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * @param {number} v sRGB channel 0..255
 * @return {number} linear value (WCAG 2.x relative luminance)
 */
function linear(v) {
	const c = v / 255
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Text color on a colored background (e.g. vote badge digits on a pid
 * color): '#000000' or '#ffffff', whichever has the higher WCAG 2.x contrast
 * ratio against hex; on a tie '#000000'. The higher of the two is always at
 * least √21 ≈ 4.58 : 1, so the result meets 4.5 : 1 for every color.
 *
 * @param {unknown} hex #rrggbb (upper case accepted)
 * @return {'#000000'|'#ffffff'} '#000000' for invalid input
 */
export function contrastTextOn(hex) {
	const c = channels(hex)
	if (!c) {
		return '#000000'
	}
	const l = 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2])
	const onBlack = (l + 0.05) / 0.05
	const onWhite = 1.05 / (l + 0.05)
	return onBlack >= onWhite ? '#000000' : '#ffffff'
}

/**
 * Text color of a note on its fill (job 135): white where contrastTextOn
 * picks white (a dark custom color), else TEXT_COLOR. Every STICKY_COLORS
 * entry keeps TEXT_COLOR. Notes only: shapes keep their style.textColor.
 *
 * @param {unknown} fill the note's fill, #rrggbb
 * @return {string} '#ffffff' or TEXT_COLOR (also for invalid input)
 */
export function noteTextColor(fill) {
	return contrastTextOn(fill) === '#ffffff' ? '#ffffff' : TEXT_COLOR
}

/** CIELAB: below (6/29)³ f(t) is linear; the D65 white point (X, Z; Y = 1). */
const LAB_EPS = (6 / 29) ** 3
const D65_X = 0.95047
const D65_Z = 1.08883

/**
 * @param {number} v X/Xn, Y/Yn or Z/Zn
 * @return {number} the CIELAB f(t)
 */
function labF(v) {
	return v > LAB_EPS ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29
}

/**
 * (Job 186) CIELAB of a colour: each sRGB channel through linear, then XYZ
 * with the sRGB matrix (D65), then L*a*b* (white point D65).
 *
 * @param {unknown} hex #rrggbb (upper case accepted)
 * @return {[number, number, number]|null} [L*, a*, b*], null when not #rrggbb
 */
export function labOf(hex) {
	const c = channels(hex)
	if (!c) {
		return null
	}
	const [r, g, b] = c.map(linear)
	const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / D65_X)
	const fy = labF(0.2126729 * r + 0.7151522 * g + 0.0721750 * b)
	const fz = labF((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / D65_Z)
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/**
 * (Job 186) The entry of list that looks most like hex: the smallest square
 * of the CIE76 distance (Euclidean in labOf); on a tie the earlier entry.
 *
 * @param {unknown} hex #rrggbb (upper case accepted)
 * @param {readonly string[]} list #rrggbb colours (other entries are skipped)
 * @return {string|null} an entry of list as given; null when hex is not #rrggbb or list has no colour
 */
export function nearestColor(hex, list) {
	const p = labOf(hex)
	if (!p) {
		return null
	}
	let best = null
	let bestD = Infinity
	for (const c of list) {
		const q = labOf(c)
		if (q) {
			const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
			if (d < bestD) {
				best = c
				bestD = d
			}
		}
	}
	return best
}

/** (Job 227) Old palette colour → new tone; built on first use (the old tag and branch lists come further down). */
let legacyTones = null

/**
 * (Job 227) The table of shownColor: every colour of the old light rows
 * (STICKY_COLORS, the first 8 of SHAPE_PALETTE, FRAME_FILL) to the nearest
 * of LIGHT, every colour of the old strong rows (the last 8 of
 * SHAPE_PALETTE, CONNECTOR_COLORS, LEGACY_TAG_COLORS, LEGACY_MM_COLORS) to
 * the nearest of STRONG_COLORED (nearestColor, CIE76). No old colour is in
 * both rows.
 *
 * @return {Map<string, string>} lowercase #rrggbb → lowercase #rrggbb
 */
function legacyMap() {
	if (legacyTones === null) {
		const m = new Map()
		for (const c of [...STICKY_COLORS, ...SHAPE_PALETTE.slice(0, 8), FRAME_FILL]) {
			m.set(c, nearestColor(c, LIGHT))
		}
		for (const c of [...SHAPE_PALETTE.slice(8), ...CONNECTOR_COLORS, ...LEGACY_TAG_COLORS, ...LEGACY_MM_COLORS]) {
			m.set(c, nearestColor(c, STRONG_COLORED))
		}
		legacyTones = m
	}
	return legacyTones
}

/**
 * (Job 227) The colour an item colour is DRAWN in: a colour of the old
 * palettes as the nearest new tone of its row (legacyMap), any other
 * #rrggbb (new tones, custom colours) unchanged, in lower case. The stored
 * value is never touched; every renderer, the context bar's current colour,
 * "Sort by color" and the CSV names go through it.
 *
 * @param {unknown} hex #rrggbb (upper case accepted)
 * @return {unknown} lowercase #rrggbb; anything else as given
 */
export function shownColor(hex) {
	if (typeof hex !== 'string' || !HEX_RE.test(hex)) {
		return hex
	}
	const c = hex.toLowerCase()
	return legacyMap().get(c) ?? c
}

/**
 * (Job 227) The line colour a connector is drawn in: its old default
 * '#1a1a1a' as CONNECTOR_STROKE, everything else through shownColor.
 *
 * @param {unknown} hex the connector's style.stroke
 * @return {unknown} see shownColor
 */
export function shownLine(hex) {
	return typeof hex === 'string' && hex.toLowerCase() === '#1a1a1a' ? CONNECTOR_STROKE : shownColor(hex)
}

/**
 * (Job 259) The strong tone of a note's edge and dog-ear tone: the strong
 * tone of the PALETTE entry whose light tone is nearest to the shown fill
 * (shownColor, nearestColor); white → gray's strong tone; black, and every
 * colour nearest to it → null (no edge, no tone).
 *
 * @param {unknown} fill the note's fill, #rrggbb
 * @return {string|null} #rrggbb, or null (also for an invalid fill)
 */
export function noteStrongTone(fill) {
	const near = nearestColor(shownColor(fill), LIGHT)
	if (near === null) return null
	const e = PALETTE[LIGHT.indexOf(near)]
	if (e.key === 'schwarz') return null
	if (e.key === 'weiss') return PALETTE.find((p) => p.key === 'grau').strong
	return e.strong
}

/**
 * (Job 262, design round 4 R4) The border of a frame: the strong tone of the
 * PALETTE entry whose light tone is nearest to the shown fill; white (and an
 * invalid fill) → gray's strong tone #6f6f6d, black → #191b1d.
 *
 * @param {unknown} fill the frame's style.fill
 * @return {string} #rrggbb
 */
export function frameStroke(fill) {
	const gray = PALETTE.find((p) => p.key === 'grau').strong
	const near = nearestColor(shownColor(fill), LIGHT)
	if (near === null) return gray
	const e = PALETTE[LIGHT.indexOf(near)]
	return e.key === 'weiss' ? gray : e.strong
}

/**
 * (Job 262) Mixes two #rrggbb colours channel by channel: a · k + b · (1 − k).
 *
 * @param {string} a #rrggbb
 * @param {string} b #rrggbb
 * @param {number} k share of a, 0..1
 * @return {string} #rrggbb (b when either is invalid)
 */
export function mixColor(a, b, k) {
	const ca = channels(a)
	const cb = channels(b)
	if (!ca || !cb) return b
	return '#' + ca.map((v, i) => Math.round(v * k + cb[i] * (1 - k)).toString(16).padStart(2, '0')).join('')
}

/**
 * (Job 259) A #rrggbb colour at an opacity.
 *
 * @param {string} hex #rrggbb
 * @param {number} a opacity 0..1
 * @return {string} rgba(r,g,b,a); black at a for anything else
 */
export function withAlpha(hex, a) {
	const c = channels(hex)
	return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgba(0,0,0,${a})`
}

/**
 * (Job 243) WCAG 2.x contrast ratio of two colours.
 *
 * @param {string} a #rrggbb
 * @param {string} b #rrggbb
 * @return {number} 1..21
 */
export function contrastRatio(a, b) {
	const x = luminance(a)
	const y = luminance(b)
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * (Job 243) OKLab of linear sRGB channels (Björn Ottosson's matrices).
 *
 * @param {number[]} rgb linear sRGB 0..1
 * @return {[number, number, number]} [L, a, b]
 */
function oklabOf([r, g, b]) {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	return [
		0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
	]
}

/**
 * @param {number} L OKLab lightness
 * @param {number} A OKLab a
 * @param {number} B OKLab b
 * @return {number[]} linear sRGB (may lie outside 0..1)
 */
function linearOfOklab(L, A, B) {
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
	const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
	]
}

/**
 * (Job 243) An OKLCH colour as #rrggbb, its chroma lowered in steps of
 * 0.002 until it lies in sRGB.
 *
 * @param {number} L lightness (clamped to 0..1)
 * @param {number} C chroma
 * @param {number} H hue (radians)
 * @return {string} lowercase #rrggbb
 */
function hexOfOklch(L, C, H) {
	const l = Math.min(1, Math.max(0, L))
	let c = C
	let rgb = linearOfOklab(l, c * Math.cos(H), c * Math.sin(H))
	while (c > 0 && !rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
		c = Math.max(0, c - 0.002)
		rgb = linearOfOklab(l, c * Math.cos(H), c * Math.sin(H))
	}
	return '#' + rgb.map((v) => {
		const x = Math.min(1, Math.max(0, v))
		const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
		return Math.round(s * 255).toString(16).padStart(2, '0')
	}).join('')
}

/**
 * (Job 243) The title colour on a tab tone: TEXT_COLOR or white, whichever
 * has the higher contrast (on a tie TEXT_COLOR).
 *
 * @param {unknown} tab #rrggbb (frameTabFill)
 * @return {string} TEXT_COLOR or '#ffffff'; TEXT_COLOR when not #rrggbb
 */
export function frameTabText(tab) {
	if (typeof tab !== 'string' || !HEX_RE.test(tab)) return TEXT_COLOR
	return contrastRatio(tab, TEXT_COLOR) >= contrastRatio(tab, '#ffffff') ? TEXT_COLOR : '#ffffff'
}

/**
 * (Job 264) The tones of a frame's lanes (S4): head fill, group fill, divider.
 *
 * @param {unknown} fill the frame's style.fill
 * @return {{head: string, group: string, line: string}} #rrggbb each
 */
export function laneTones(fill) {
	const tab = frameTabFill(fill)
	const c = shownColor(fill)
	const f = typeof c === 'string' && HEX_RE.test(c) ? c : FRAME_FILL
	return { head: mixColor(tab, f, LANE_HEAD_MIX), group: mixColor(tab, f, LANE_GROUP_MIX), line: mixColor(tab, '#000000', LANE_LINE_MIX) }
}

/**
 * (Job 243) The rule of frameTabFill for a colour FRAME_TAB_FILLS does not
 * list: in OKLCH the lightness − 0.09 (a fill darker than 0.5: + 0.12), the
 * chroma × 1.3, the hue kept (hexOfOklch brings it into sRGB); when
 * frameTabText reaches FRAME_TAB_MIN_CONTRAST nowhere on it, the lightness
 * moves on by 0.01 away from that text colour until it does.
 *
 * @param {string} hex #rrggbb (lower case)
 * @return {string} lowercase #rrggbb
 */
export function frameTabRule(hex) {
	const [L, A, B] = oklabOf(channels(hex).map(linear))
	const H = Math.atan2(B, A)
	const C = Math.hypot(A, B) * 1.3
	let l = L >= 0.5 ? L - 0.09 : L + 0.12
	let tab = hexOfOklch(l, C, H)
	const step = frameTabText(tab) === '#ffffff' ? -0.01 : 0.01
	while (contrastRatio(tab, frameTabText(tab)) < FRAME_TAB_MIN_CONTRAST && l > 0 && l < 1) {
		l += step
		tab = hexOfOklch(l, C, H)
	}
	return tab
}

/**
 * (Job 243) The tone of a frame's tab, a stronger tone of its fill (design
 * round 2, A2): the fill as shownColor draws it, a LIGHT tone from
 * FRAME_TAB_FILLS, any other colour by frameTabRule; not #rrggbb: as white.
 * frameTabText on it reaches FRAME_TAB_MIN_CONTRAST.
 *
 * @param {unknown} fill the frame's style.fill
 * @return {string} lowercase #rrggbb
 */
export function frameTabFill(fill) {
	const c = shownColor(fill)
	const hex = typeof c === 'string' && HEX_RE.test(c) ? c : FRAME_FILL
	return FRAME_TAB_FILLS[hex] ?? frameTabRule(hex)
}

/** Arrow head size; padding of connector bounding boxes (geometry.js, M1 connectors). */
export const ARROW_SIZE = 10

/**
 * Connector label and handles ([S]-internal, SPEC-M1 §6.3, round 1b): the
 * label is drawn at 50 % of the path length on a BOARD_BACKGROUND box whose
 * size the model ESTIMATES (connectors.labelBox: no canvas measuring, so hit
 * test, rbush padding, renderer and label editor agree on every client):
 * font size and padding in world units, at most CONNECTOR_LABEL_MAX_W wide
 * (word wrap like Konva.Text), the text at least CONNECTOR_LABEL_MIN_W wide;
 * glyph widths are upper bounds per code point (text.js labelGlyphWidth).
 * The "+" buttons of tables, lanes and mind maps sit CONNECTOR_PLUS_OFFSET_PX
 * screen px outside the selection frame (job 140); (job 231) the connection
 * points plus-t/r/b/l lie on the drawn frame, SELECTION_GAP_PX outside their
 * anchor; the end handles of a selected connector on its end points; all
 * are round.
 */
export const CONNECTOR_LABEL_FONT_SIZE = 15
export const CONNECTOR_LABEL_PAD = 5
/**
 * (Job 261, design round 3 V6) The label is a pill: CONNECTOR_LABEL_PAD above
 * and below the text, CONNECTOR_LABEL_PAD_X left and right (16 and 4 all
 * round until 0.4.0), filled CONNECTOR_LABEL_FILL with a 1 unit edge
 * CONNECTOR_LABEL_EDGE (TEXT_COLOR at 28 %), its corner radius half its
 * height, at most CONNECTOR_LABEL_RADIUS.
 */
export const CONNECTOR_LABEL_PAD_X = 9
export const CONNECTOR_LABEL_FILL = '#ffffff'
export const CONNECTOR_LABEL_EDGE = 'rgba(25,27,29,0.28)'
export const CONNECTOR_LABEL_RADIUS = 12
/** (Job 261, design round 3 V6) Corner radius of the bends of an elbow route, at most half of the shorter neighbouring piece. */
export const CONNECTOR_CORNER = 10
export const CONNECTOR_LABEL_MAX_W = 240
export const CONNECTOR_LABEL_MIN_W = 10
export const CONNECTOR_PLUS_OFFSET_PX = 44
export const CONNECTOR_PLUS_PX = 12
/**
 * (Job 262, design round 4 R4) The "+" buttons of tables, lanes and mind
 * maps: a STRUCT_PLUS_PX circle in the selection colour with a white ring
 * (HANDLE_STROKE_PX) and a white plus of two STRUCT_PLUS_BAR_PX bars; the
 * centre of a table's or lane's STRUCT_PLUS_OFFSET_PX outside the item's
 * edge; a mouse hits it within STRUCT_PLUS_PX / 2. The "+ Lane" button is a
 * pill STRUCT_PLUS_PX high with its word in STRUCT_PLUS_FONT_PX bold,
 * STRUCT_PLUS_PAD_X beside it.
 */
export const STRUCT_PLUS_PX = 24
export const STRUCT_PLUS_BAR_PX = 10
export const STRUCT_PLUS_OFFSET_PX = 36
export const STRUCT_PLUS_FONT_PX = 12
export const STRUCT_PLUS_PAD_X = 10
export const CONNECTOR_END_PX = 12

/**
 * Transformer and keyboard (SPEC-M1 §6.2, §6.3), in screen px unless noted:
 * hit radius of a handle (mouse; pen and finger: a 44-px hit area), the
 * snapping distance (connector ends to anchors), the
 * snapping threshold per axis of a dragged selection to the edges and centres
 * of other items (M2, R12; src/model/snap.js), the selection size up to which
 * every item previews live (above: one setAttrs of the activeGroup, G11),
 * and the arrow key steps in world units (with Shift: NUDGE_BIG).
 * (job 231, redesign V8) The drawn size of a handle (mouse; pen or finger),
 * the offset of the rotation handle beyond the top right corner of the drawn
 * frame along both of the frame's axes, and how close the mouse comes before
 * a handle shows: the rotation handle within ROT_REVEAL_PX of that corner,
 * the connection point of an edge within POINT_REVEAL_PX of that edge.
 */
export const HANDLE_PX = 8
export const HANDLE_TOUCH_PX = 22
export const HANDLE_VIEW_PX = 10
export const HANDLE_VIEW_TOUCH_PX = 14
/**
 * (Job 262, design round 4 R4) The drawn diameter of the transformer handles
 * (corners, sides, rotation): round, mouse and pen or finger. Connection
 * points and connector ends keep HANDLE_VIEW_PX / HANDLE_VIEW_TOUCH_PX.
 */
export const TRANSFORM_HANDLE_PX = 12
export const TRANSFORM_HANDLE_TOUCH_PX = 16
export const ROT_HANDLE_OFFSET_PX = 16
export const ROT_REVEAL_PX = 24
export const POINT_REVEAL_PX = 16
export const SNAP_PX = 16
export const OBJECT_SNAP_PX = 8
export const TRANSFORM_LIVE_MAX = 50
export const NUDGE = 1
export const NUDGE_BIG = 10

/**
 * Transformer handles (drawn in screen px, [S]-internal): white squares with
 * HANDLE_RADIUS_PX corners and a border in the selection color; the
 * rotation handle and the connection points are round (job 231: no line to
 * the rotation handle). MULTI_FRAME_DASH outlines the union frame of a
 * multi selection.
 */
export const HANDLE_FILL = '#ffffff'
export const HANDLE_STROKE_PX = 2
export const HANDLE_RADIUS_PX = 2
export const MULTI_FRAME_DASH = Object.freeze([6, 4])

/**
 * Shapes and text items ([S]-internal): inner padding of a shape's text box,
 * the grey line bars of a text item at LOD 1 when its letters would be
 * smaller than TEXT_MIN_PX, and the default text box padding of new shapes.
 */
export const SHAPE_TEXT_PADDING = 8
export const TEXT_BAR_COLOR = '#c6cacf'

/**
 * (Job 211) The label below a symbol, BPMN event or gateway
 * (shapes.js symbolLabelBox): SYMBOL_LABEL_GAP below the box, wrapped at
 * the box width but at least SYMBOL_LABEL_WRAP_W, in SYMBOL_LABEL_FONT_SIZE
 * unless the shape has a stored font size (world units).
 */
export const SYMBOL_LABEL_GAP = 6
export const SYMBOL_LABEL_WRAP_W = 160
export const SYMBOL_LABEL_FONT_SIZE = 16

/**
 * Vote badges of mode vote (SPEC-M1 §6.3, stage 3, [S]-internal; drawn in
 * the uiGroup in screen px): a circle of VOTE_DOT_PX at the top-right
 * corner of an item for the own votes (in SceneVoteState.color, digits in
 * contrastTextOn of it), a VOTE_TOTAL_FILL circle beside it for the total,
 * both widened to a pill for longer numbers (VOTE_DOT_PAD_PX beside the
 * digits) and edged in VOTE_DOT_BORDER; an empty ring of VOTE_RING_PX
 * (VOTE_RING_STROKE_PX stroke in the own color, VOTE_DOT_BORDER inside)
 * marks a votable item without an own vote (markVotable); the voting area
 * gets a VOTE_SCOPE_STROKE_PX outline in VOTE_SCOPE_COLOR. VOTE_DOT_GAP_PX
 * separates the circles. (Job 233) The own count and the empty ring became
 * the VOTE_BADGE_* badge below; VOTE_DOT_* sizes the totals beside it. The
 * first one sat VOTE_DOT_INSET_PX inside the
 * corner.
 */
export const VOTE_DOT_PX = 20
export const VOTE_DOT_FONT_PX = 12
export const VOTE_DOT_PAD_PX = 5
export const VOTE_DOT_GAP_PX = 3
export const VOTE_DOT_INSET_PX = 2
export const VOTE_DOT_BORDER = '#ffffff'
export const VOTE_DOT_BORDER_PX = 1.5
export const VOTE_TOTAL_FILL = '#37474f'
export const VOTE_RING_PX = 16
export const VOTE_RING_STROKE_PX = 2
export const VOTE_SCOPE_COLOR = '#0082c9'
export const VOTE_SCOPE_STROKE_PX = 2

/**
 * (Factory job 233, redesign docs/redesign/ P7, P11) The vote badge of an
 * item: a VOTE_BADGE_PX circle (a pill for longer numbers) with the own
 * count in VOTE_BADGE_FONT_PX bold, or on a votable item without an own vote
 * (markVotable) a white circle with a VOTE_BADGE_RING_PX ring and a "+" of
 * VOTE_BADGE_PLUS_PX (VOTE_BADGE_RING_PX strokes), both in the own color.
 * Its centre lies on the item's top-right corner, moved outwards along the
 * corner's diagonal (rotated with the item) by d = max(0, VOTE_BADGE_CLEAR_PX
 * − pad · scale) screen px on each axis, pad = the item's text inset
 * (STICKY_PADDING, SHAPE_TEXT_PADDING, else 0): the circle and its white
 * edge never cover the text box at any zoom. In mode vote a press within
 * VOTE_BADGE_HIT_MOUSE_PX (mouse) or VOTE_BADGE_HIT_TOUCH_PX (pen, finger)
 * of the centre hits the badge (a 32 / 44 px target).
 */
export const VOTE_BADGE_PX = 28
export const VOTE_BADGE_FONT_PX = 13
export const VOTE_BADGE_RING_PX = 2
export const VOTE_BADGE_PLUS_PX = 12
export const VOTE_BADGE_CLEAR_PX = 11
export const VOTE_BADGE_HIT_MOUSE_PX = 16
export const VOTE_BADGE_HIT_TOUCH_PX = 22

/**
 * Lock symbol of a locked item (M2, SPEC-M1 §1.2 "(R20) Sperren"; drawn in
 * the uiGroup in screen px, src/scene/nodes/locks.js): a padlock of
 * LOCK_ICON_PX on a LOCK_FILL rounded square (LOCK_PAD_PX around it) with a
 * LOCK_BORDER_PX edge in LOCK_BORDER, rotated with its item, LOCK_INSET_PX
 * from where it sits: inside the top-left corner (notes, shapes), outside
 * left of it (text items, frames, shapes with text at the top left), on the
 * middle of a connector's route, or left of its label box at LOD 0 (the
 * places of src/scene/nodes/locks.js). LOCK_COLOR on LOCK_FILL is ≈ 9.7 : 1.
 */
export const LOCK_ICON_PX = 16
export const LOCK_INSET_PX = 4
export const LOCK_PAD_PX = 2
export const LOCK_RADIUS_PX = 4
export const LOCK_BORDER_PX = 1
export const LOCK_FILL = '#ffffff'
export const LOCK_BORDER = '#9aa0a6'
export const LOCK_COLOR = '#37474f'

/**
 * Emoji reactions of notes (factory job 172, src/model/reactions.js,
 * src/scene/nodes/reactions.js), in WORLD units: the row lies REACT_GAP
 * below the note's bottom edge, left aligned, rotated with the note (its
 * band is REACT_BAND high); a pill is REACT_H high and REACT_PAD +
 * REACT_EMOJI + REACT_EMOJI_GAP + REACT_DIGIT · digits + REACT_PAD wide,
 * REACT_SPACING apart, "+n" REACT_PAD + REACT_DIGIT · characters +
 * REACT_PAD, the smiley-plus button REACT_ADD square. The emoji is drawn
 * REACT_EMOJI high, the count in REACT_COUNT_SIZE. A pill is REACT_FILL
 * with a REACT_BORDER edge; the own one is tinted (REACT_MINE_FILL) with a
 * REACT_MINE_BORDER (the selection blue) edge of REACT_MINE_STROKE. Text
 * and the button's icon in REACT_TEXT.
 */
export const REACT_GAP = 8
export const REACT_H = 24
export const REACT_BAND = REACT_GAP + REACT_H
export const REACT_PAD = 6
export const REACT_EMOJI = 16
export const REACT_EMOJI_GAP = 4
export const REACT_DIGIT = 7
export const REACT_SPACING = 4
export const REACT_ADD = 24
export const REACT_COUNT_SIZE = 12
export const REACT_FILL = '#ffffff'
export const REACT_BORDER = '#c6cacf'
export const REACT_STROKE = 1
export const REACT_MINE_FILL = '#e0f0fa'
export const REACT_MINE_BORDER = '#0082c9'
export const REACT_MINE_STROKE = 1.5
export const REACT_TEXT = '#1a1a1a'

/**
 * Tags of notes (factory job 191, src/model/tags.js, src/scene/nodes/tags.js):
 * TAG_COLORS are the 12 colours a tag can have, in the order a new tag takes
 * them (the first one no tag has yet). In WORLD units: the labels stand in
 * one row inside the note, TAG_INSET from its left, right and bottom edge,
 * TAG_H high, TAG_PAD_X + the name in TAG_FONT_SIZE + TAG_PAD_X wide (at
 * most TAG_LABEL_MAX_W, longer names end in "…"), TAG_GAP apart, corners
 * TAG_RADIUS; the text area of a note with tags ends TAG_RESERVE above its
 * bottom edge. Below LOD_TEXT_SCALE each tag is a stroke TAG_STROKE_W ×
 * TAG_STROKE_H. A note the tag filter fades is drawn at TAG_FADE_OPACITY.
 * Job 227: TAG_COLORS = STRONG_COLORED (the one palette); a tag with one of
 * LEGACY_TAG_COLORS is drawn through shownColor.
 */
export const TAG_COLORS = STRONG_COLORED
export const LEGACY_TAG_COLORS = Object.freeze([
	'#e53935', '#fb8c00', '#fdd835', '#7cb342', '#43a047', '#00897b',
	'#039be5', '#1e88e5', '#5e35b1', '#8e24aa', '#d81b60', '#6d4c41',
])
export const TAG_H = 22
export const TAG_FONT_SIZE = 13
export const TAG_PAD_X = 6
export const TAG_GAP = 4
export const TAG_INSET = 8
export const TAG_RADIUS = 4
export const TAG_LABEL_MAX_W = 120
export const TAG_RESERVE = TAG_H + TAG_INSET
export const TAG_STROKE_W = 28
export const TAG_STROKE_H = 10
export const TAG_FADE_OPACITY = 0.25

/** Selection outline (local user) and drop-target highlight, drawn in screen px. */
export const SELECTION_COLOR = '#0082c9'
export const SELECTION_STROKE_PX = 2
/** (job 231) The least contrast of the own selection's color against BOARD_BACKGROUND (WCAG 1.4.11). */
export const SELECTION_MIN_CONTRAST = 3

/**
 * @param {string} hex #rrggbb
 * @return {number} WCAG 2.x relative luminance
 */
function luminance(hex) {
	const c = channels(hex)
	return 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2])
}

/**
 * (job 231, redesign V8) The color of the own selection (outlines, handles,
 * connection points) from the theme's primary color, the value of
 * --color-primary-element: #rgb, #rrggbb or an opaque rgb()/rgba(); taken
 * when it has at least SELECTION_MIN_CONTRAST against BOARD_BACKGROUND (the
 * canvas stays light, also in a dark theme, whose primary color is light),
 * else SELECTION_COLOR.
 *
 * @param {unknown} css the custom property's value (getPropertyValue)
 * @return {string} #rrggbb (lower case)
 */
export function selectionColorOf(css) {
	const v = typeof css === 'string' ? css.trim().toLowerCase() : ''
	let hex = null
	let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
	if (m) {
		hex = '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]
	} else if (HEX_RE.test(v)) {
		hex = v
	} else if ((m = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(1|1\.0+|100%)\s*)?\)$/.exec(v))) {
		const rgb = m.slice(1, 4).map(Number)
		if (rgb.every((n) => n <= 255)) hex = '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('')
	}
	if (hex === null) return SELECTION_COLOR
	const a = luminance(hex)
	const b = luminance(BOARD_BACKGROUND)
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= SELECTION_MIN_CONTRAST ? hex : SELECTION_COLOR
}
/**
 * Gap between an item and its selection frame (job 140, like Miro), in
 * screen px at every zoom: the frame (the middle of its stroke) lies
 * SELECTION_GAP_PX outside the item's box, rotated with it
 * (transform.js gapFrame). The same gap holds for the dashed selections of
 * others, the dashed frame of a multi selection and group outlines; the
 * transformer handles sit on the frame, and a press into the gap hits a
 * selected item (InputController). Connectors keep their halo; drop target,
 * connect target and voting area stay on the edge.
 */
export const SELECTION_GAP_PX = 4
export const DROP_TARGET_COLOR = '#0082c9'
export const DROP_TARGET_STROKE_PX = 3
/**
 * (Job 271) The current hit of the board search: a frame in the primary
 * colour of Nextcloud, SEARCH_HIT_STROKE_PX wide, SEARCH_HIT_GAP_PX outside
 * the item box (screen px), overlay only.
 */
export const SEARCH_HIT_COLOR = '#0082c9'
export const SEARCH_HIT_STROKE_PX = 3
export const SEARCH_HIT_GAP_PX = 6
/**
 * Snap guides of a drag (M2, R12), drawn in screen px: magenta, ≈ 4.4 : 1
 * against white (≥ 3 : 1 for graphics, WCAG 1.4.11) and clearly apart from
 * the selection blue; dashed with SNAP_GUIDE_DASH (4 px dash, 4 px gap,
 * screen px). The gap markers of equal gaps (src/model/snap.js snapMove)
 * use the same color and width, solid, with a cross tick of
 * GAP_MARKER_TICK_PX at both ends.
 */
export const SNAP_GUIDE_COLOR = '#e0218a'
export const SNAP_GUIDE_STROKE_PX = 1
export const SNAP_GUIDE_DASH = Object.freeze([4, 4])
export const GAP_MARKER_TICK_PX = 8
/**
 * (job 194) The labels of the snapping: the distance of a gap marker or a
 * measuring line and the size "240 × 180" of a resize, white FONT_FAMILY text
 * of SNAP_LABEL_FONT_PX on a filled rectangle in SNAP_LABEL_FILL (a darker
 * magenta than the guides, ≈ 5.4 : 1 against the white text), with
 * SNAP_LABEL_PAD_X / SNAP_LABEL_PAD_Y inside and SNAP_LABEL_RADIUS corners,
 * all in screen px. A distance label lies SNAP_LABEL_OFFSET_PX beside the
 * middle of its line; the size label SIZE_LABEL_GAP_PX below the drawn
 * selection frame, clear of the corner handle.
 */
export const SNAP_LABEL_FILL = '#c81d7b'
export const SNAP_LABEL_TEXT = '#ffffff'
export const SNAP_LABEL_FONT_PX = 11
export const SNAP_LABEL_PAD_X = 4
export const SNAP_LABEL_PAD_Y = 1
export const SNAP_LABEL_RADIUS = 2
export const SNAP_LABEL_OFFSET_PX = 4
export const SIZE_LABEL_GAP_PX = HANDLE_VIEW_TOUCH_PX / 2 + 2
/**
 * Background grid (M2, SPEC-M1 §1.2 (R12)): lines every GRID_SIZE world
 * units, every GRID_MAJOR_EVERY-th one a major line; zoomed out, the drawn
 * step grows by GRID_MAJOR_EVERY before two lines come closer than
 * GRID_MIN_PX screen px (src/scene/grid.js). A drag or resize with the grid
 * on snaps to GRID_SIZE at every zoom up to GRID_FINE_SCALE; (job 238) above
 * it lines every GRID_SIZE / GRID_MAJOR_EVERY units join (the GRID_SIZE lines
 * are their major ones) and a drag or resize snaps to them. The colors are tuned to
 * BOARD_BACKGROUND (#f1f1ec until job 227, now #f3f2f0): faint minor lines, slightly darker major ones.
 */
export const GRID_SIZE = 20
export const GRID_MAJOR_EVERY = 5
export const GRID_FINE_SCALE = 4
export const GRID_MIN_PX = 10
export const GRID_MINOR_COLOR = '#dcdcd4'
export const GRID_MAJOR_COLOR = '#c8c8bf'
/** Marquee (rubber band) selection and frame-creation preview. */
export const MARQUEE_FILL = 'rgba(0,130,201,0.08)'
export const MARQUEE_STROKE = '#0082c9'
/**
 * Hold signal of the touch marquee (SPEC-M1 §6.3 (R38)): the ring under the
 * finger (diameter in container px; its look is .knorke-hold-ring in
 * knorke.css, in the marquee colour) and the one short vibration (ms) where
 * navigator.vibrate exists. A resting fingertip hides about 90–100 CSS px
 * around its contact point (15–18 mm on a phone; the contact area itself is
 * only about 40 px), so the ring is about 20 mm wide and shows above and
 * beside a finger or thumb while it is still held.
 */
export const HOLD_RING_PX = 120
export const LONG_PRESS_VIBRATE_MS = 20
/**
 * Laser pointer (job 171, src/scene/LaserLayer.js), screen px at every zoom:
 * a LASER_LINE_PX line in the person's colour over a translucent glow of
 * LASER_GLOW_PX (LASER_GLOW_ALPHA of the line's opacity), a LASER_TIP_PX dot
 * at the tip. Every piece is fully visible when it appears and fades evenly
 * until it is gone after LASER_FADE_MS, at the sender and at every receiver
 * (src/sync/presence.js plays the same window).
 */
export const LASER_LINE_PX = 4
export const LASER_GLOW_PX = 12
export const LASER_GLOW_ALPHA = 0.3
export const LASER_TIP_PX = 8
export const LASER_FADE_MS = 1000
/**
 * Tables (job 173, src/model/table.js, src/scene/nodes/table.js): the
 * default tint of the header row (style.headerFill), its border
 * (style.stroke) and text colour (style.textColor) defaults; the grid lines
 * are 1 world unit wide on a white ground.
 */
export const TABLE_HEADER_FILL = '#eef1f5'
export const TABLE_STROKE = '#a9adb2'
export const TABLE_FILL = '#ffffff'
/**
 * Job 265 (redesign round 4, T3): outer corners TABLE_RADIUS (the content is
 * clipped), the outer border TABLE_BORDER_PX screen px in style.stroke, the
 * inner lines 1 unit (tableLines); the cell being edited gets TABLE_EDIT_MIX
 * of the selection colour over its fill and a 2 px inner border in it.
 */
export const TABLE_RADIUS = 6
export const TABLE_BORDER_PX = 1.5
export const TABLE_EDIT_MIX = 0.08

/**
 * (Job 265) The inner lines of a table for its border colour: #d5d8dc
 * across and #e9ebee down for TABLE_STROKE, else the border mixed with white.
 *
 * @param {string} stroke shown border colour
 * @return {{h: string, v: string}}
 */
export function tableLines(stroke) {
	return stroke === TABLE_STROKE ? { h: '#d5d8dc', v: '#e9ebee' } : { h: mixColor(stroke, '#ffffff', 0.47), v: mixColor(stroke, '#ffffff', 0.24) }
}
/**
 * Note pads (job 188, src/model/pad.js, src/scene/nodes/pad.js), in world
 * units. Job 263 (redesign round 4, B4): PAD_SHEETS sheets lie behind the
 * top one (the box, in style.fill), each PAD_SHEET_OFFSET lower (not to the
 * right), with a fine edge in the strong tone at PAD_EDGE_ALPHA; only the
 * bottom one casts the note shadow (N4). On top of the box a binding
 * PAD_BIND_H high in the frame tab tone of the fill (top corners
 * STICKY_RADIUS), a line below it in the strong tone at PAD_BIND_LINE_ALPHA,
 * then PAD_TEAR_GAP below the binding a dashed tear line (PAD_TEAR_DASH,
 * PAD_TEAR_INSET from the sides, strong tone at PAD_TEAR_ALPHA). The title
 * stands on the binding: bold PAD_TITLE_SIZE, left, PAD_TITLE_PAD inside, one
 * line cut with "…". These are the measures of a pad PAD_FULL_H high or
 * higher; a lower one scales binding, gaps and title by h / PAD_FULL_H
 * (model/pad.js padLayout). No grey band, no dog ear.
 */
export const PAD_SHEETS = 4
export const PAD_SHEET_OFFSET = 3
export const PAD_EDGE_ALPHA = 0.18
export const PAD_BIND_H = 36
export const PAD_BIND_LINE_ALPHA = 0.35
export const PAD_TEAR_GAP = 6
export const PAD_TEAR_INSET = 8
export const PAD_TEAR_DASH = Object.freeze([4, 4])
export const PAD_TEAR_ALPHA = 0.4
export const PAD_TITLE_SIZE = 16
export const PAD_TITLE_PAD = 12
export const PAD_FULL_H = 200
/** (Job 263) The strong tone of a pad whose fill is black (or nearest to it): noteStrongTone gives none there. */
export const PAD_STRONG_BLACK = '#191b1d'
/**
 * Mind maps (job 195, src/model/mindmap.js, src/scene/nodes/mindmap.js): the
 * colours of the main branches in turn (white text on each of them has a
 * contrast of at least 4.5 : 1, the count of a folded branch), the fill of
 * a box node and the box a mind map is at LOD 2. Job 227: MM_COLORS = TEN
 * (the strong tones in palette order); a node with one of LEGACY_MM_COLORS
 * as its stored c is drawn through shownColor.
 */
export const MM_COLORS = TEN
export const LEGACY_MM_COLORS = Object.freeze(['#1864ab', '#c92a2a', '#2b7a39', '#862e9c', '#b35900', '#0b7285', '#5f3dc4', '#a61e4d'])
export const MM_FILL = '#ffffff'
/** Job 266 (design round 4, M3/O1): the border of the centre and of every card, the lines of org and tree; a card's role. */
export const MM_INK_BORDER = '#3d4044'
export const MM_ROLE_COLOR = '#5c5f63'
export const MM_COARSE = '#dee2e6'
