/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Layout rules of the tool bar (factory job 229, redesign docs/redesign/ P1,
 * P5, P5b), pure.
 *
 * - TOOL_GROUPS: the buttons of the bar in two groups (a separator between
 *   them): Select and Pan; then Note, Shape, Text, (job 273) Pen, Connector,
 *   Frame and 'more' ("More tools"). MORE_TOOLS: the tools of the small grid behind
 *   "More tools". Every tool of model/tools.js TOOLS stands exactly once in
 *   the bar or in MORE_TOOLS.
 * - VARIANTS: the tools with variants and their options (a subset of TOOLS'
 *   options; the shape tool's kind comes from the shapes panel). Their button
 *   carries a corner; a click (job 239: the first one already), a long press
 *   or a right-click shows the variants as pictures (ToolVariants.vue).
 * - toolIcon: the icon of a button, the picked variant's picture where it
 *   differs from the tool (note pad, swimlanes, elbow and curved routes).
 * - LONG_PRESS_MS / LONG_PRESS_SLOP_PX: a press held this long without
 *   moving further opens the variants.
 */
import { TOOLS } from '../model/tools.js'
import { icons, OPTION_ICONS } from './icons.js'

/** The bar's buttons in their two groups; 'more' is "More tools". */
export const TOOL_GROUPS = Object.freeze([
	Object.freeze(['select', 'hand']),
	Object.freeze(['sticky', 'shape', 'text', 'pen', 'connector', 'frame', 'more']),
])

/** The tools behind "More tools", in grid order. */
export const MORE_TOOLS = Object.freeze(['table', 'mindmap', 'laser'])

/** The tools with variants: tool → its options shown as pictures (TOOLS[].options). */
export const VARIANTS = Object.freeze({
	sticky: Object.freeze(['type']),
	connector: Object.freeze(['route', 'endCap']),
	frame: Object.freeze(['frameKind']),
	// job 273: the kind; ToolVariants.vue adds the width and the colour of a pen or highlighter
	pen: Object.freeze(['penKind']),
})

/** A press held this long (ms) opens the variants. */
export const LONG_PRESS_MS = 500
/** A press that moves further than this (CSS px) is no long press. */
export const LONG_PRESS_SLOP_PX = 8

/** The icon of each tool and of "More tools". */
export const TOOL_ICONS = Object.freeze({
	select: icons.select,
	hand: icons.hand,
	sticky: icons.sticky,
	shape: icons.shape,
	text: icons.text,
	table: icons.table,
	mindmap: icons.mindmap,
	connector: icons.connector,
	frame: icons.frame,
	laser: icons.laser,
	pen: icons.pen,
	more: icons.moreTools,
})

/**
 * @param {string} id a tool id of TOOLS or 'more'
 * @return {boolean} the tool has variants
 */
export function hasVariants(id) {
	return Object.prototype.hasOwnProperty.call(VARIANTS, id)
}

/**
 * @param {string} id a tool id
 * @return {boolean} the tool stands behind "More tools"
 */
export function isMoreTool(id) {
	return MORE_TOOLS.includes(id)
}

/**
 * The icon of a tool button: the picked variant's picture where it is not
 * the tool's own look (note pad, swimlanes, elbow and curved routes).
 *
 * @param {string} id a tool id of TOOLS or 'more'
 * @param {object} [options] the tool options of the session ({sticky: {type}, connector: {route}, frame: {frameKind}, pen: {penKind}})
 * @return {string} SVG path
 */
export function toolIcon(id, options = {}) {
	if (id === 'sticky' && options?.sticky?.type === 'pad') return OPTION_ICONS.type.pad
	if (id === 'frame' && options?.frame?.frameKind === 'lanes') return OPTION_ICONS.frameKind.lanes
	// job 273: the highlighter or the eraser
	if (id === 'pen' && (options?.pen?.penKind === 'marker' || options?.pen?.penKind === 'eraser')) return OPTION_ICONS.penKind[options.pen.penKind]
	if (id === 'connector') {
		const route = options?.connector?.route
		if (route === 'elbow' || route === 'curved') return OPTION_ICONS.route[route]
	}
	return TOOL_ICONS[id] ?? icons.select
}

/** Every tool id of TOOLS (for the check that the bar and MORE_TOOLS hold each once). */
export const ALL_TOOL_IDS = Object.freeze(TOOLS.map((x) => x.id))
