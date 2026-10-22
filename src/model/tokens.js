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
 * palettes by name and never repeats their values.
 */

/** Sticky note palette, 14 colors (also the fill buttons of the context bar). */
export const STICKY_COLORS = Object.freeze([
	'#fff6b6', '#f5d76e', '#d4e98a', '#b8f0a0', '#a8d8f8', '#7fd3cc', '#6cc6ea',
	'#ffb27a', '#f2a7c8', '#f58a98', '#c8a5d6', '#dfe98a', '#e4e4e4', '#ffd8e6',
])

/** Default note color. Deliberately not yellow (brand note in the dossier §5). */
export const DEFAULT_STICKY_FILL = '#a8d8f8'

export const TEXT_COLOR = '#1a1a1a'
export const FONT_FAMILY = 'Arial, "Liberation Sans", Helvetica, sans-serif'
export const LINE_HEIGHT = 1.2
export const STICKY_PADDING = 12
export const STICKY_RADIUS = 3

/** Discrete font sizes for auto-fit text (computed, never stored). */
export const FONT_STEPS = Object.freeze([10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64])

/** Subtle drop shadow under notes (dropped below LOD_TEXT_SCALE). */
export const SHADOW = Object.freeze({ x: 0, y: 2, blur: 6, color: 'rgba(0,0,0,0.25)', opacity: 0.25 })

/** Frame defaults; the fill of a real frame comes from its style.fill. */
export const FRAME_FILL = '#ffffff'
/**
 * Frame palette (M0: the note palette plus white, ContextBar), FRAME_FILL
 * first. A mixed selection with frames maps a note color to a frame color
 * with nearestFrameFill() (§6.5.1).
 */
export const FRAME_FILLS = Object.freeze([FRAME_FILL, ...STICKY_COLORS])
export const FRAME_STROKE = '#d5d8dc'
export const FRAME_STROKE_WIDTH = 2
export const FRAME_TITLE_SIZE = 28
export const FRAME_TITLE_COLOR = '#55606b'
/** Height of the title band above a frame; it belongs to the frame's hit area. */
export const FRAME_TITLE_BAND = FRAME_TITLE_SIZE * 1.5
/** Width of the frame border band that hits the frame, in screen px (÷ scale in world). */
export const FRAME_EDGE_HIT_PX = 8

/** Unknown item types: grey dashed box with the type name. */
export const PLACEHOLDER_FILL = '#f4f4f4'
export const PLACEHOLDER_STROKE = '#9aa0a6'
export const PLACEHOLDER_DASH = Object.freeze([6, 4])
export const PLACEHOLDER_TEXT_COLOR = '#5f6368'

export const BOARD_BACKGROUND = '#f1f1ec'

/** LOD 1 below this scale: notes without text and shadow; frame titles stay. */
export const LOD_TEXT_SCALE = 0.3
/** LOD 2 (M1, not used in M0). */
export const LOD_COARSE_SCALE = 0.1
/** LOD 2 hysteresis (SPEC-M1 §6.2, §8.5 G14): enter below, leave above. */
export const LOD2_ENTER = 0.095
export const LOD2_LEAVE = 0.105
/** LOD 1 of `text` items: drawn while fontSize · scale ≥ TEXT_MIN_PX. */
export const TEXT_MIN_PX = 6

/** Zoom range 5 % to 400 %. */
export const MIN_SCALE = 0.05
export const MAX_SCALE = 4

/**
 * Shape palette of the context bar (fill, stroke and text color of shapes):
 * a light row for fills and a strong row for strokes and text. Contains the
 * shape defaults '#ffffff' (fill) and '#1a1a1a' (stroke, text).
 */
export const SHAPE_PALETTE = Object.freeze([
	'#ffffff', '#e4e4e4', '#fff6b6', '#ffe8cc', '#ffc9c9', '#e5dbff', '#a8d8f8', '#d3f9d8',
	'#1a1a1a', '#868e96', '#f08c00', '#e03131', '#c2255c', '#7048e8', '#0082c9', '#2f9e44',
])

/**
 * Line colors of connectors (context bar), the default '#1a1a1a' first; all
 * of them stay visible on BOARD_BACKGROUND and on white.
 */
export const CONNECTOR_COLORS = Object.freeze([
	'#1a1a1a', '#868e96', '#e03131', '#f08c00', '#2f9e44', '#0082c9', '#7048e8', '#c2255c',
])

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
 * The frame color for a color picked for a mixed selection (§6.5.1): the
 * FRAME_FILLS entry with the smallest squared sRGB distance (channels
 * 0..255); on a tie the earlier entry wins. Upper-case hex is accepted.
 *
 * @param {unknown} hex #rrggbb
 * @return {string} an entry of FRAME_FILLS; FRAME_FILL for invalid input
 */
export function nearestFrameFill(hex) {
	const c = channels(hex)
	if (!c) {
		return FRAME_FILL
	}
	let best = FRAME_FILL
	let bestD = Infinity
	for (const f of FRAME_FILLS) {
		const [r, g, b] = channels(f)
		const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2
		if (d < bestD) {
			best = f
			bestD = d
		}
	}
	return best
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
 * The "+" handles sit CONNECTOR_PLUS_OFFSET_PX screen px outside their
 * anchor (beyond the rotation handle, which hangs ROT_HANDLE_OFFSET_PX above
 * the top edge), the end handles of a selected connector on its end points;
 * both are round.
 */
export const CONNECTOR_LABEL_FONT_SIZE = 16
export const CONNECTOR_LABEL_PAD = 4
export const CONNECTOR_LABEL_MAX_W = 240
export const CONNECTOR_LABEL_MIN_W = 10
export const CONNECTOR_PLUS_OFFSET_PX = 44
export const CONNECTOR_PLUS_PX = 12
export const CONNECTOR_END_PX = 12

/**
 * Transformer and keyboard (SPEC-M1 §6.2, §6.3), in screen px unless noted:
 * handle size (mouse, touch), distance of the rotation handle above the top
 * edge, snapping distance (connector ends to anchors), the snapping
 * threshold per axis of a dragged selection to the edges and centres of
 * other items (M2, R12; src/model/snap.js), the selection size up to which
 * every item previews live (above: one setAttrs of the activeGroup, G11),
 * and the arrow key steps in world units (with Shift: NUDGE_BIG).
 */
export const HANDLE_PX = 8
export const HANDLE_TOUCH_PX = 22
export const ROT_HANDLE_OFFSET_PX = 28
export const SNAP_PX = 16
export const OBJECT_SNAP_PX = 8
export const TRANSFORM_LIVE_MAX = 50
export const NUDGE = 1
export const NUDGE_BIG = 10

/**
 * Transformer handles (drawn in screen px, [S]-internal): white squares with
 * the selection color; the rotation handle is round and hangs on a short
 * line above the top edge. MULTI_FRAME_DASH outlines the union frame of a
 * multi selection.
 */
export const HANDLE_FILL = '#ffffff'
export const HANDLE_STROKE_PX = 1.5
export const MULTI_FRAME_DASH = Object.freeze([6, 4])

/**
 * Shapes and text items ([S]-internal): inner padding of a shape's text box,
 * the grey line bars of a text item at LOD 1 when its letters would be
 * smaller than TEXT_MIN_PX, and the default text box padding of new shapes.
 */
export const SHAPE_TEXT_PADDING = 8
export const TEXT_BAR_COLOR = '#c6cacf'

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
 * separates the circles; the first one sits VOTE_DOT_INSET_PX inside the
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

/** Selection outline (local user) and drop-target highlight, drawn in screen px. */
export const SELECTION_COLOR = '#0082c9'
export const SELECTION_STROKE_PX = 2
export const DROP_TARGET_COLOR = '#0082c9'
export const DROP_TARGET_STROKE_PX = 3
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
 * Background grid (M2, SPEC-M1 §1.2 (R12)): lines every GRID_SIZE world
 * units, every GRID_MAJOR_EVERY-th one a major line; zoomed out, the drawn
 * step grows by GRID_MAJOR_EVERY before two lines come closer than
 * GRID_MIN_PX screen px (src/scene/grid.js). A drag or resize with the grid
 * on snaps to GRID_SIZE at every zoom. The colors are tuned to
 * BOARD_BACKGROUND (#f1f1ec): faint minor lines, slightly darker major ones.
 */
export const GRID_SIZE = 20
export const GRID_MAJOR_EVERY = 5
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
