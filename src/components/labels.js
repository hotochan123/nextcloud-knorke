/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Translated names of the enum values the shell offers (shape kinds,
 * dashes, alignments, connector routes and tips; SPEC-M1 §6.11). Every
 * text is written out as t('knorke', …) so build/l10n-check.mjs finds it.
 * An unknown value (a later version) shows as itself.
 *
 * Aligning items (itemAlignLabel, M2) has source texts of its own, apart
 * from the text alignment (alignLabel, valignLabel), so each meaning gets
 * its own translation. Distributing items (distributeLabel, M2) as well.
 * (Job 179) colorName names the palette colours for the board's CSV, and
 * (job 186) every other colour by the palette colour nearest to it; (job
 * 227) paletteName gives the tooltips of the one palette's swatches.
 * (Job 188) noteTypeLabel names what the note tool creates, (job 199)
 * frameKindLabel what the frame tool creates.
 */
import { CONNECTOR_STROKE, LIGHT, PALETTE, STRONG_COLORED, TABLE_HEADER_FILL, nearestColor, shownColor } from '../model/tokens.js'
import { t } from '../util/l10n.js'

/**
 * @param {string} kind shape kind
 * @return {string} label
 */
export function shapeKindLabel(kind) {
	switch (kind) {
	case 'rect': return t('knorke', 'Rectangle')
	case 'roundRect': return t('knorke', 'Rounded rectangle')
	case 'ellipse': return t('knorke', 'Ellipse')
	case 'diamond': return t('knorke', 'Diamond')
	case 'triangle': return t('knorke', 'Triangle')
	case 'arrowRight': return t('knorke', 'Arrow')
	// job 201: the flowchart kinds (the context bar's section "Shape"; the shapes panel has its own labels)
	case 'terminal': return t('knorke', 'Start / end')
	case 'parallelogram': return t('knorke', 'Input / output')
	case 'document': return t('knorke', 'Document')
	case 'database': return t('knorke', 'Database')
	case 'subprocess': return t('knorke', 'Subprocess')
	case 'hexagon': return t('knorke', 'Preparation')
	case 'manualInput': return t('knorke', 'Manual input')
	case 'trapezoid': return t('knorke', 'Manual operation')
	case 'delay': return t('knorke', 'Delay')
	case 'offPage': return t('knorke', 'Off-page reference')
	// job 204: the BPMN kinds (the same texts as their entries in the shapes panel)
	case 'bpmnStart': return t('knorke', 'Start event')
	case 'bpmnStartMessage': return t('knorke', 'Message start event')
	case 'bpmnStartTimer': return t('knorke', 'Timer start event')
	case 'bpmnIntermediate': return t('knorke', 'Intermediate event')
	case 'bpmnIntermediateMessage': return t('knorke', 'Message intermediate event')
	case 'bpmnIntermediateTimer': return t('knorke', 'Timer intermediate event')
	case 'bpmnEnd': return t('knorke', 'End event')
	case 'bpmnEndMessage': return t('knorke', 'Message end event')
	case 'bpmnEndError': return t('knorke', 'Error end event')
	case 'bpmnEndTerminate': return t('knorke', 'Terminate end event')
	case 'bpmnTask': return t('knorke', 'Task')
	case 'bpmnUserTask': return t('knorke', 'User task')
	case 'bpmnServiceTask': return t('knorke', 'Service task')
	case 'bpmnManualTask': return t('knorke', 'Manual task')
	case 'bpmnScriptTask': return t('knorke', 'Script task')
	case 'bpmnRuleTask': return t('knorke', 'Business rule task')
	case 'bpmnSendTask': return t('knorke', 'Send task')
	case 'bpmnReceiveTask': return t('knorke', 'Receive task')
	case 'bpmnSubprocess': return t('knorke', 'Collapsed subprocess')
	case 'bpmnCallActivity': return t('knorke', 'Call activity')
	case 'bpmnExclusive': return t('knorke', 'Exclusive gateway')
	case 'bpmnParallel': return t('knorke', 'Parallel gateway')
	case 'bpmnInclusive': return t('knorke', 'Inclusive gateway')
	case 'bpmnEventGateway': return t('knorke', 'Event-based gateway')
	case 'bpmnDataObject': return t('knorke', 'Data object')
	case 'bpmnDataInput': return t('knorke', 'Data input')
	case 'bpmnDataOutput': return t('knorke', 'Data output')
	case 'bpmnDataStore': return t('knorke', 'Data store')
	default: return String(kind)
	}
}

/**
 * @param {string} shape a node shape of a mind map (model/mindmap.js MM_SHAPES)
 * @return {string} (job 195) its label
 */
export function nodeShapeLabel(shape) {
	switch (shape) {
	case 'line': return t('knorke', 'Text on a line')
	case 'rect': return t('knorke', 'Rectangle')
	case 'roundRect': return t('knorke', 'Rounded rectangle')
	case 'pill': return t('knorke', 'Pill')
	default: return String(shape)
	}
}

/**
 * @param {string} layout a layout of a mind map (model/mindmap.js MM_LAYOUTS)
 * @return {string} (job 198) its label
 */
export function mindLayoutLabel(layout) {
	switch (layout) {
	case 'both': return t('knorke', 'Mind map')
	case 'right': return t('knorke', 'Right only')
	case 'org': return t('knorke', 'Org chart')
	case 'tree': return t('knorke', 'Tree')
	default: return String(layout)
	}
}

/**
 * (Job 188) The entries of the note tool's option type (model/tools.js NOTE_TOOL_TYPES).
 *
 * @param {string} type sticky|pad
 * @return {string} label
 */
export function noteTypeLabel(type) {
	switch (type) {
	case 'sticky': return t('knorke', 'Note')
	case 'pad': return t('knorke', 'Note pad')
	default: return String(type)
	}
}

/**
 * (Job 199) The entries of the frame tool's option frameKind (model/tools.js FRAME_TOOL_KINDS).
 *
 * @param {string} kind frame|lanes
 * @return {string} label
 */
export function frameKindLabel(kind) {
	switch (kind) {
	case 'frame': return t('knorke', 'Frame')
	case 'lanes': return t('knorke', 'Swimlanes')
	default: return String(kind)
	}
}

/**
 * (Job 273) The entries of the pen tool's option penKind (model/ink.js PEN_TOOL_KINDS).
 *
 * @param {string} kind pen|marker|eraser
 * @return {string} label
 */
export function penKindLabel(kind) {
	switch (kind) {
	case 'pen': return t('knorke', 'Pen')
	case 'marker': return t('knorke', 'Highlighter')
	case 'eraser': return t('knorke', 'Eraser')
	default: return String(kind)
	}
}

/**
 * (Job 273) The three widths of the pen and the highlighter (model/ink.js PEN_WIDTHS), by their place.
 *
 * @param {number} i 0, 1 or 2
 * @return {string} label
 */
export function penWidthLabel(i) {
	switch (i) {
	case 0: return t('knorke', 'Thin')
	case 1: return t('knorke', 'Medium')
	case 2: return t('knorke', 'Thick')
	default: return String(i)
	}
}

/**
 * @param {string} dash solid|dashed|dotted
 * @return {string} label
 */
export function dashLabel(dash) {
	switch (dash) {
	case 'solid': return t('knorke', 'Solid')
	case 'dashed': return t('knorke', 'Dashed')
	case 'dotted': return t('knorke', 'Dotted')
	default: return String(dash)
	}
}

/**
 * @param {string} align left|center|right
 * @return {string} label
 */
export function alignLabel(align) {
	switch (align) {
	case 'left': return t('knorke', 'Align left')
	case 'center': return t('knorke', 'Align center')
	case 'right': return t('knorke', 'Align right')
	default: return String(align)
	}
}

/**
 * @param {string} valign top|middle|bottom
 * @return {string} label
 */
export function valignLabel(valign) {
	switch (valign) {
	case 'top': return t('knorke', 'Align top')
	case 'middle': return t('knorke', 'Align middle')
	case 'bottom': return t('knorke', 'Align bottom')
	default: return String(valign)
	}
}

/**
 * @param {string} edge left|center|right|top|middle|bottom (actions.ALIGN_EDGES)
 * @return {string} label of that edge's command in the "Align items" panel
 */
export function itemAlignLabel(edge) {
	switch (edge) {
	case 'left': return t('knorke', 'Align left edges')
	case 'center': return t('knorke', 'Align horizontal centers')
	case 'right': return t('knorke', 'Align right edges')
	case 'top': return t('knorke', 'Align top edges')
	case 'middle': return t('knorke', 'Align vertical centers')
	case 'bottom': return t('knorke', 'Align bottom edges')
	default: return String(edge)
	}
}

/**
 * @param {string} axis horizontal|vertical (actions.DISTRIBUTE_AXES)
 * @return {string} label of the "Distribute" button for that axis
 */
export function distributeLabel(axis) {
	switch (axis) {
	case 'horizontal': return t('knorke', 'Distribute horizontally')
	case 'vertical': return t('knorke', 'Distribute vertically')
	default: return String(axis)
	}
}

/**
 * @param {string} tool tool id
 * @return {string} label
 */
export function toolLabel(tool) {
	switch (tool) {
	case 'select': return t('knorke', 'Select')
	case 'hand': return t('knorke', 'Pan')
	case 'sticky': return t('knorke', 'Sticky note')
	case 'shape': return t('knorke', 'Shape')
	case 'text': return t('knorke', 'Text')
	case 'table': return t('knorke', 'Table')
	case 'mindmap': return t('knorke', 'Mind map')
	case 'connector': return t('knorke', 'Connector')
	case 'frame': return t('knorke', 'Frame')
	case 'laser': return t('knorke', 'Laser pointer')
	case 'pen': return t('knorke', 'Pen')
	default: return String(tool)
	}
}

/**
 * @param {string} route straight|elbow|curved (connector data.route)
 * @return {string} label
 */
export function routeLabel(route) {
	switch (route) {
	case 'straight': return t('knorke', 'Straight')
	case 'elbow': return t('knorke', 'Elbow')
	case 'curved': return t('knorke', 'Curved')
	default: return String(route)
	}
}

/**
 * @param {string} cap none|arrow|triangle|dot|diamond|circleOpen|triangleOpen (style.startCap, style.endCap)
 * @return {string} label
 */
export function capLabel(cap) {
	switch (cap) {
	case 'none': return t('knorke', 'No tip')
	case 'arrow': return t('knorke', 'Arrow tip')
	case 'triangle': return t('knorke', 'Triangle tip')
	case 'dot': return t('knorke', 'Dot tip')
	case 'diamond': return t('knorke', 'Diamond tip')
	// job 204: the tips of a BPMN message flow
	case 'circleOpen': return t('knorke', 'Open circle')
	case 'triangleOpen': return t('knorke', 'Open triangle')
	default: return String(cap)
	}
}

/**
 * (Job 227) The names of the one palette (tokens.PALETTE keys), the tooltips
 * of its swatches and the colour names of the board's CSV; a colour's light
 * and strong tone share the name.
 */
const PALETTE_NAMES = Object.freeze({
	hellblau: () => t('knorke', 'Light blue'),
	tuerkis: () => t('knorke', 'Turquoise'),
	salbei: () => t('knorke', 'Sage'),
	gelb: () => t('knorke', 'Yellow'),
	orange: () => t('knorke', 'Orange'),
	koralle: () => t('knorke', 'Coral'),
	rosa: () => t('knorke', 'Pink'),
	lila: () => t('knorke', 'Purple'),
	indigo: () => t('knorke', 'Indigo'),
	sand: () => t('knorke', 'Sand'),
	weiss: () => t('knorke', 'White'),
	grau: () => t('knorke', 'Gray'),
	schwarz: () => t('knorke', 'Black'),
})

/** (Job 227) Each tone of the one palette (lower case) → its palette key; the light tone first. */
const KEY_OF = new Map()
for (const e of PALETTE) {
	for (const c of [e.light, e.strong]) {
		if (!KEY_OF.has(c)) KEY_OF.set(c, e.key)
	}
}

/**
 * (Job 186, 227) The tones a colour name is looked up among: the light
 * tones, then the strong ones without white, in palette order.
 */
export const NAMED_COLORS = Object.freeze([...new Set([...LIGHT, ...STRONG_COLORED])])

/**
 * (Job 227) The tooltip of a palette swatch: the name of a tone of the one
 * palette, "Default" for the default line of connectors and the default
 * tint of table header rows (contextbar.js DEFAULT_COLORS); null for any
 * other colour (a custom one).
 *
 * @param {unknown} color #rrggbb (upper case accepted)
 * @return {string|null} the name
 */
export function paletteName(color) {
	const c = String(color ?? '').toLowerCase()
	if (c === CONNECTOR_STROKE || c === TABLE_HEADER_FILL) {
		return t('knorke', 'Default')
	}
	const key = KEY_OF.get(c)
	return key ? PALETTE_NAMES[key]() : null
}

/**
 * (Job 179, 186, 227) The name of a colour for the board's CSV: the colour
 * as it is drawn (tokens.shownColor: an old palette colour as its new tone);
 * a tone of the one palette by its name, any other colour by the name of the
 * tone of NAMED_COLORS that looks most like it (model/tokens.js
 * nearestColor, CIE76 in CIELAB); never a hex code.
 *
 * @param {unknown} color #rrggbb (upper case accepted)
 * @return {string} its name, '' when not #rrggbb
 */
export function colorName(color) {
	const c = String(color ?? '').toLowerCase()
	if (!/^#[0-9a-f]{6}$/.test(c)) {
		return ''
	}
	const s = shownColor(c)
	return PALETTE_NAMES[KEY_OF.get(s) ?? KEY_OF.get(nearestColor(s, NAMED_COLORS))]()
}
