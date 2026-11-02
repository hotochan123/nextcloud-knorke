/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * What the context bar shows for a selection (SPEC-M1 §6.5.1, §6.6). Pure,
 * so the rules can be checked in Node.
 *
 * - Only the style fields EVERY selected type has (the intersection of the
 *   registry `fields`, selection v2 `fields`).
 * - Fill (job 227): the 13 light tones of the one palette (tokens.LIGHT)
 *   for every type; borders and text colours the 13 strong tones (STRONG).
 *   Every type, frames included, takes a picked colour unchanged
 *   (actions.setStyle).
 * - Palettes come from tokens.js by name (LIGHT, STRONG, STRONG_COLORED);
 *   this module never repeats their values.
 * - Job 135 (colour picker, ColorPicker.vue): parseHex reads the "#" field
 *   (optional "#", exactly six hex digits, blanks around and case do not
 *   matter); boardColors gives the row "On this board": the custom colours
 *   (no palette colour, old or new, and no "Default") of every item's colour
 *   fields, most used first, at most BOARD_COLORS_MAX (selection v2 boardColors).
 * - Font sizes: the steps inside the bounds of every selected type's rule;
 *   "Auto" only when every selected type fits its text by default (notes,
 *   shapes). (Job 227) Notes only: "Auto", S, M and L (NOTE_SIZES).
 * - Connectors (round 1b): route, start and end tip, line colour from
 *   LINE_COLORS (job 227: "Default" and the strong tones without white;
 *   connectors only, a mix with shapes keeps the strong tones), widths inside every selected type's rule (a connector line is
 *   at least 1 wide), dash; "Label" for exactly one connector. Arrange
 *   never applies to connectors (their box is derived, rule 12).
 * - M2 (SPEC-M1 §1.2): "Align" (itemAlign; `align` is the text alignment)
 *   from two alignable items on (selection v2 `alignable`: no connectors,
 *   no children of selected frames); "Distribute" (distribute, a row of the
 *   align panel) from three on.
 *
 * Stage 4 (SPEC-M1 §6.6 ContextMenu.vue, R19 T4-02): the right-click menu
 * takes its entries from here too (menuEntries), with the bar's labels and
 * its "Connect" rule; menuShortcut gives the visible hints and
 * aria-keyshortcuts (Meta+… on Apple, Control+… elsewhere; job 141: from
 * the one formatter util/shortcuts.js) (job 230: the board menu has no
 * count line any more). M2 (SPEC-M1 §1.2 (R12)): the board
 * menu's entry "Show grid" (grid, the single key G on every platform) is a
 * check box; it is only listed when the menu knows the grid's state. After
 * it, only while the grid is shown, the check box "Snap to grid"
 * (grid-snap, no key); then (job 154) "Mouse wheel: Automatic" / "…: Zoom"
 * / "…: Pan" (wheel, a plain entry without key that names the stage of
 * env.wheel), only listed when the menu knows that stage; then (job 147) the
 * check box "Show other people's cursors" (cursors, the single key C), only
 * listed when the menu knows that state; only the mass unlocks follow (job
 * 062).
 *
 * M2 (SPEC-M1 §1.2 "(R20) Sperren"): selection v2 counts locked and
 * unlocked items (BoardSession.selectionInfo; its style fields describe the
 * unlocked ones only). The bar shows cut, duplicate, front, back and delete
 * only with unlocked items, copy always, connect as before, then Lock
 * (lockable > 0), Unlock (unlockable > 0, unlockLabel names the locker)
 * and the badge (locked > 0, lockBadgeText). The menu on items lists lock
 * and unlock the same way (Ctrl/⌘+Shift+L), edit-text only for exactly one
 * unlocked item. A selection v2 without these keys (older callers) counts
 * as all unlocked. Moderators (job 044) get mass unlocks, only while the
 * session counted something to unlock when it reported the menu
 * (BoardSession.emitMenu unlockAll / unlockFrame / unlockBy): "Unlock all"
 * (unlock-all) last in the board menu; "Unlock all in this frame"
 * (unlock-frame) on a frame before zoom-selection, and in the board menu for
 * the frame under the point, before unlock-all (job 062); "Unlock all locked
 * by {name}" (unlock-by, job 062) on an item someone else locked, after
 * unlock, named after that person (env.unlockByName); no shortcut, never
 * blocked.
 *
 * M2 (SPEC-M1 §1.2 "(R20) Gruppieren"): selection v2 carries groupable,
 * groupBlock, grouped, ungroupBlock and oneGroup (model/groups.js
 * groupSummary). "Group items" shows while groupable ≥ 2 and the selection
 * is not exactly one group (showGroup), "Ungroup" while it touches a group
 * (showUngroup); in the bar and in the menu (group, ungroup, after connect,
 * Ctrl/⌘+G and Ctrl/⌘+Shift+G). A blocked one (groupBlock / ungroupBlock)
 * stays visible and focusable but aria-disabled, with the reason as its
 * title (groupHint, ungroupHint, groupHintText; menuBlocked for the menu,
 * where "unavailable entries are missing" does not hold for these two).
 * A selection v2 without these keys shows neither.
 *
 * Job 139 (sort notes by colour): selection v2 sortable (the loose notes
 * "Sort by color" moves) and frameSortable (the notes in the one selected
 * frame). From two on, contextSections gives sortColors ("Sort by color"
 * in the align panel, after "Tidy up") and sortFrame ("Sort notes by color"
 * in the bar, before "Arrange"); the menu on items lists sort-colors and
 * sort-frame with the same texts after connect, before group, without a
 * shortcut. A selection v2 without the keys shows none of them.
 *
 * Job 143 (frame titles): "Rename" (rename) in the bar, at the place of
 * "Edit label", for exactly one unlocked frame; the menu entry edit-text
 * keeps its name, rule and key (Enter) and reads "Rename" when the
 * selection is exactly one frame.
 *
 * Job 144 (filter the selection): selection v2 kinds ([{kind, count}],
 * model/groups.js filterKinds; [] or missing: not filterable). filterLabel
 * gives the texts "Only notes ({count})" …; the menu on items lists
 * only-<kind> for every entry of kinds after zoom-selection, in the order of
 * kinds, with the same texts and no shortcut.
 *
 * Job 153 (swap direction): selection v2 swappable (the unlocked selected
 * connectors whose tips differ). The menu on items lists swap-direction
 * ("Swap direction", no shortcut) after edit-text (or back) and before
 * connect, only while the bar shows the panel "Tips" (contextSections
 * startCap and endCap) and swappable > 0.
 *
 * Job 173 (tables): the border and text sections come from the common fields
 * as before (a table has no width, dash or size: only the colour). Only
 * tables selected: the section header ("Header", contextSections header:
 * the switch "Header row", style.header, job 265 the switch "Header column",
 * style.headerCol, and the colour style.headerFill
 * with TABLE_HEADER_FILL and, job 227, the light tones). The menu on a cell of the one
 * selected table (env.table {rows, cols, locked}, the session's) lists after
 * back (and after react, which a table never has): row-above, row-below,
 * col-left, col-right, row-delete (not with one row), col-delete (not with
 * one column), then table-csv ("Export as CSV"); a locked table only
 * table-csv; no shortcuts.
 *
 * Job 199 (swimlanes): the menu on a lane of the one selected frame with
 * lanes (env.lanes {index, count, locked}, the session's) lists after back
 * (and after the table and mind map entries, which a frame never has):
 * lane-rename, lane-above, lane-below, lane-up (not at the first lane),
 * lane-down (not at the last), lane-delete (not with one lane); a locked
 * frame none of them; no shortcuts. (Job 208) Then, without columns
 * (env.lanes.cols null), column-add; with them (env.lanes.cols {index,
 * count}: the column under W) column-rename, column-left, column-right,
 * column-move-left (not at the first column), column-move-right (not at the
 * last) and column-delete. (Job 225) After lane-delete lane-group for a lane
 * without a group (env.lanes.group false), else lane-group-rename and
 * lane-ungroup; after column-delete the same for its column (column-group,
 * column-group-rename, column-ungroup; env.lanes.cols.group).
 *
 * Job 195 (mind maps): selection v2 mindmap (exactly one mind map: {id,
 * layout, locked, node: the focused node or null}) gives the sections mmNode
 * ("Branch": job 227 the colours STRONG_COLORED, the four shapes
 * MM_SHAPES; only with a focused node) and mmLayout (the switch "Right
 * only"), both only for an unlocked map. (Job 198) mmLayout is the section
 * "Layout" {layouts: MM_LAYOUTS} (Mind map, Right only, Org chart, Tree);
 * in org and tree mmNode has the three box shapes (no line). The menu on a node of the one
 * selected map (env.mindmap {root, kids, folded, locked}, the session's)
 * lists after back (and after the table entries, which a map never has):
 * mm-child, mm-sibling (not at the root), mm-fold (not at the root, only
 * with children: "Fold branch" or "Unfold branch"), mm-delete (not at the
 * root), then mm-text ("Copy as text"); a locked map only mm-text. The
 * keys of mm-child (Tab), mm-sibling (Enter) and mm-delete (Del) show.
 * (Job 196) mm-rearrange ("Rearrange") follows mm-fold (at the root
 * mm-child) when env.mindmap.placed: the node or one of its branch is
 * placed freely (at the root: any node); never on a locked map.
 *
 * Job 172 (emoji reactions): selection v2 reactable (exactly one note, in
 * mode edit, while this person may react) shows "Add reaction" in the bar
 * ([data-knorke-action=react]) and the menu entry react ("Add reaction",
 * after back, before edit-text, no shortcut); both open the reaction
 * picker. A selection v2 without the key shows neither.
 *
 * Job 178 (save as image): the menu on items always lists export-png
 * ("Save as image (PNG)", no shortcut) after zoom-selection and before the
 * only-<kind> entries, also for locked items only; the board menu of the
 * empty canvas does not (the top bar's "⋯" saves the whole board).
 *
 * Job 179 (save as CSV): the menu on items lists export-csv ("Save as
 * CSV", no shortcut) right after export-png, also for locked items only;
 * the empty canvas does not. table-csv stays on a table's cell.
 *
 * Job 200 (save as SVG or PDF): export-svg ("Save as SVG") and export-pdf
 * ("Save as PDF", job 207: "Save as PDF…", a dialog asks for the page
 * size), no shortcut, stand between export-png and export-csv,
 * under the same conditions.
 *
 * Job 205 (BPMN files): export-bpmn ("Save as BPMN"), no shortcut, stands
 * between export-pdf and export-csv, under the same conditions.
 *
 * Job 180 (templates): the menu of the empty canvas lists insert-template
 * ("Insert template…", no shortcut) right after note-here, also on an empty
 * board; the menu on items never does.
 *
 * Job 182 (template suggestions): the menu on items lists save-template (no
 * shortcut) right after export-csv while env.templateRight is 'suggest'
 * ("Suggest as template…") or 'save' (admins: "Save as template…"), never
 * on the guest page; the empty canvas does not (the top bar's "⋯" takes the
 * whole board).
 *
 * Job 188 (note pads): the menu of the empty canvas lists pad-here ("Add
 * note pad here", no shortcut) right after note-here. A note pad has the
 * fill of the note palette (fillPalette) and "Edit text" opens its title.
 *
 * Job 191 (tags): selection v2 taggable (the unlocked selected notes, in
 * mode edit, while this person may edit) shows "Tags" in the bar
 * ([data-knorke-action=tags]) and the menu entry tags ("Tags", after
 * react, no shortcut) while it is > 0; both open the tag panel.
 */
import { ENUMS, fieldDefault, fieldRule, fieldValue, textPathOf, typeInfo } from '../model/registry.js'
import {
	CONNECTOR_COLORS, CONNECTOR_STROKE, FRAME_FILLS, LEGACY_MM_COLORS, LEGACY_TAG_COLORS, LIGHT, NOTE_SIZE_L, NOTE_SIZE_M, NOTE_SIZE_S,
	SHAPE_BORDER, SHAPE_PALETTE, STICKY_COLORS, STRONG, STRONG_COLORED, TABLE_HEADER_FILL,
} from '../model/tokens.js'
import { PEN_COLORS, PEN_WIDTHS } from '../model/ink.js'
import { FLOWS } from '../model/connectors.js'
import { MM_LAYOUTS, MM_SHAPES, isBoxLayout } from '../model/mindmap.js'
import { BASIC_KINDS, FLOWCHART_KINDS, bpmnGroupOf, isSymbolKind } from '../model/shapes.js'
import { n, t } from '../util/l10n.js'
import { shortcut } from '../util/shortcuts.js'

/**
 * Selection v2 (SPEC-M1 §6.5.1): flat keys of the common field values and
 * their paths (BoardSession.selectionInfo fills them, the bar reads them).
 */
export const SELECTION_FIELDS = Object.freeze({
	fill: 'style.fill',
	fillOpacity: 'style.fillOpacity',
	stroke: 'style.stroke',
	strokeWidth: 'style.strokeWidth',
	dash: 'style.dash',
	textColor: 'style.textColor',
	color: 'style.color',
	fontSize: 'style.fontSize',
	align: 'style.align',
	valign: 'style.valign',
	kind: 'data.kind',
	route: 'data.route',
	startCap: 'style.startCap',
	endCap: 'style.endCap',
	// job 173: tables
	header: 'style.header',
	headerFill: 'style.headerFill',
	// job 265: the header column
	headerCol: 'style.headerCol',
})

/** Font size steps of the context bar. */
export const FONT_SIZES = Object.freeze([12, 16, 20, 24, 32, 48, 64, 96, 128])
/** Border widths of shapes (0 = no border) and line widths of connectors (from 1). */
export const STROKE_WIDTHS = Object.freeze([0, 1, 2, 4, 8, 12])
/** Fill opacities of shapes (0 = no fill). */
export const OPACITIES = Object.freeze([100, 75, 50, 25, 0])

/**
 * (Job 227) The note sizes of the bar when only notes are selected: S, M
 * and L ("Auto" besides them is null).
 */
export const NOTE_SIZES = Object.freeze([NOTE_SIZE_S, NOTE_SIZE_M, NOTE_SIZE_L])

/**
 * (Job 227) The fill palette: the 13 light tones of the one palette for every
 * type with a fill (notes, note pads, frames, shapes, a mix of them).
 *
 * @param {Iterable<string>} types selected types
 * @return {string[]} fill palette (lowercase #rrggbb), [] without types
 */
export function fillPalette(types) {
	return [...(types ?? [])].length === 0 ? [] : [...LIGHT]
}

/** The colour fields of the registry (rule 'color'), read for the row "On this board". */
export const COLOR_PATHS = Object.freeze(['style.fill', 'style.stroke', 'style.textColor', 'style.color', 'style.headerFill'])
/** Most colours in the row "On this board". */
export const BOARD_COLORS_MAX = 8
/** (job 173) The palette of a table's header row: its default tint ("Default"), then (job 227) the light tones. */
export const HEADER_FILLS = Object.freeze([TABLE_HEADER_FILL, ...LIGHT])
/** (Job 227) The line palette of connectors: the default line ("Default"), then the strong tones without white. */
export const LINE_COLORS = Object.freeze([CONNECTOR_STROKE, ...STRONG_COLORED])
/**
 * (Job 260) The border palette of shapes: the default border ("Default",
 * SHAPE_BORDER), then the strong tones without Black (the last one), whose
 * value is the old default border (drawn as SHAPE_BORDER on basic and
 * flowchart shapes).
 */
export const BORDER_COLORS = Object.freeze([SHAPE_BORDER, ...STRONG.slice(0, -1)])
/** (Job 227) The colours a palette shows as "Default" (components/labels.js paletteName). */
export const DEFAULT_COLORS = Object.freeze([CONNECTOR_STROKE, TABLE_HEADER_FILL])
/**
 * Every palette colour of the bar, never a custom colour of the board:
 * (job 227) the tones of the one palette, the two defaults and every colour
 * of the old palettes (drawn as a new tone, tokens.shownColor).
 */
const PALETTE_COLORS = new Set([
	...LIGHT, ...STRONG, ...DEFAULT_COLORS, ...STICKY_COLORS, ...FRAME_FILLS, ...SHAPE_PALETTE, ...CONNECTOR_COLORS,
	...LEGACY_TAG_COLORS, ...LEGACY_MM_COLORS,
])
const HEX_COLOR = /^#[0-9a-f]{6}$/

/**
 * The "#" field of the colour picker (job 135).
 *
 * @param {unknown} text typed text
 * @return {string|null} lowercase #rrggbb for an optional "#" plus exactly six hex digits (blanks
 *   around and case do not matter), else null
 */
export function parseHex(text) {
	if (typeof text !== 'string') {
		return null
	}
	const m = /^#?([0-9a-fA-F]{6})$/.exec(text.trim())
	return m ? '#' + m[1].toLowerCase() : null
}

/**
 * The row "On this board" (job 135, selection v2 boardColors): every value
 * of the colour fields (COLOR_PATHS, read through fieldValue: only values
 * that pass the rule 'color', defaults included) of all given items, locked
 * ones too, lowercase, without the palette colours. One count per item and
 * field; most used first, on a tie the lower hex first; at most
 * BOARD_COLORS_MAX. Linear in the number of items; the order of the items
 * does not matter.
 *
 * @param {Iterable<object>} items WireItems (the whole model)
 * @return {string[]} lowercase #rrggbb
 */
export function boardColors(items) {
	const counts = new Map()
	for (const it of items ?? []) {
		if (it === null || typeof it !== 'object') {
			continue
		}
		for (const path of COLOR_PATHS) {
			if (fieldRule(it.t, path)?.[0] !== 'color') {
				continue
			}
			const v = fieldValue(it, path)
			const c = typeof v === 'string' ? v.toLowerCase() : null
			if (c !== null && HEX_COLOR.test(c) && !PALETTE_COLORS.has(c)) {
				counts.set(c, (counts.get(c) ?? 0) + 1)
			}
		}
	}
	return [...counts]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.slice(0, BOARD_COLORS_MAX)
		.map(([c]) => c)
}

/**
 * @param {Iterable<string>} types selected types
 * @return {{sizes: number[], auto: boolean}} font sizes valid for every type, and whether "Auto" applies
 */
export function fontSizes(types) {
	const ts = [...(types ?? [])]
	let min = -Infinity
	let max = Infinity
	let auto = ts.length > 0
	for (const t of ts) {
		const rule = fieldRule(t, 'style.fontSize')
		if (rule === null) {
			return { sizes: [], auto: false }
		}
		min = Math.max(min, rule[1])
		max = Math.min(max, rule[2])
		auto = auto && fieldDefault(t, 'style.fontSize') === null
	}
	// job 227: notes only get S, M and L
	if (ts.length > 0 && ts.every((t) => t === 'sticky')) {
		return { sizes: [...NOTE_SIZES], auto }
	}
	return { sizes: FONT_SIZES.filter((s) => s >= min && s <= max), auto }
}

/**
 * @param {Iterable<string>} types selected types
 * @return {number[]} STROKE_WIDTHS inside the style.strokeWidth rule of every type
 */
export function strokeWidths(types) {
	let min = -Infinity
	let max = Infinity
	for (const t of types ?? []) {
		const rule = fieldRule(t, 'style.strokeWidth')
		if (rule === null) {
			return []
		}
		min = Math.max(min, rule[1])
		max = Math.min(max, rule[2])
	}
	return STROKE_WIDTHS.filter((w) => w >= min && w <= max)
}

/**
 * @param {Iterable<string>} types selected types
 * @param {boolean} [redesigned] (job 260) every selected item is a basic or flowchart shape (sel.redesigned)
 * @return {string[]} line/border palette: (job 227) LINE_COLORS for connectors only, (job 260) BORDER_COLORS for
 *   basic and flowchart shapes only (BPMN, symbols and own shapes keep the strong tones with Black), else the 13
 *   strong tones
 */
export function strokePalette(types, redesigned = false) {
	const ts = [...(types ?? [])]
	if (redesigned && ts.length > 0 && ts.every((t) => t === 'shape')) return [...BORDER_COLORS]
	return ts.length > 0 && ts.every((t) => t === 'connector') ? [...LINE_COLORS] : [...STRONG]
}

/**
 * (Job 201) The kinds of the section "Shape": the twelve of the flowchart when
 * the common kind is one of its own (not rect or diamond), none for a symbol,
 * else the six of M1 (also for mixed kinds). (Job 204) A BPMN kind: the
 * kinds of its group (shapes.js BPMN_GROUPS: events, tasks, gateways, data).
 *
 * @param {object|null} sel selection v2 (kind, mixed)
 * @return {string[]|null} kinds in button order, null: no section
 */
export function kindChoices(sel) {
	const mixed = Array.isArray(sel?.mixed) && sel.mixed.includes('data.kind')
	const k = mixed ? null : sel?.kind
	const group = bpmnGroupOf(k)
	if (group) return [...group]
	if (isSymbolKind(k)) return null
	if (FLOWCHART_KINDS.includes(k) && !BASIC_KINDS.includes(k)) return [...FLOWCHART_KINDS]
	return [...BASIC_KINDS]
}

/**
 * (Job 204) The BPMN flow the selected connectors show (the buttons
 * "Sequence flow" and "Message flow" of the panel "Tips" are pressed for it):
 * line, start and end tip of every selected one equal to FLOWS[flow].
 *
 * @param {object|null} sel selection v2 (dash, startCap, endCap, mixed, types)
 * @return {string|null} sequence | message, null for any other look or a mixed one
 */
export function flowOf(sel) {
	const types = [...(sel?.types ?? [])]
	if (types.length === 0 || !types.every((t) => t === 'connector')) return null
	const mixed = Array.isArray(sel?.mixed) ? sel.mixed : []
	for (const [flow, look] of Object.entries(FLOWS)) {
		const same = Object.entries(look).every(([path, value]) => !mixed.includes(path) && sel[FIELD_KEYS[path]] === value)
		if (same) return flow
	}
	return null
}

/** (Job 204) The selection v2 key of each field path (SELECTION_FIELDS turned round). */
const FIELD_KEYS = Object.freeze(Object.fromEntries(Object.entries(SELECTION_FIELDS).map(([k, p]) => [p, k])))

/**
 * The sections of the context bar for a selection v2 (BoardSession
 * selectionInfo).
 *
 * @param {object|null} sel selection v2
 * @return {{fill: string[]|null, fillOpacity: boolean, stroke: string[]|null, strokeWidth: boolean,
 *   strokeWidths: number[], line: boolean,
 *   dash: string[]|null, textColor: {path: string, palette: string[]}|null, fontSize: {sizes: number[], auto: boolean}|null,
 *   align: string[]|null, valign: string[]|null, kind: string[]|null, route: string[]|null,
 *   startCap: string[]|null, endCap: string[]|null, label: boolean, arrange: boolean, itemAlign: boolean,
 *   distribute: boolean, sortColors: boolean, sortFrame: boolean, rename: boolean, styled: boolean}}
 *   line: the stroke is a connector line (connectors only), not a border;
 *   itemAlign: "Align" for the items (M2), apart from `align`, the text alignment;
 *   distribute: "Distribute" in the align panel (M2, never without itemAlign);
 *   sortColors: "Sort by color" in the align panel (job 139, sortable ≥ 2);
 *   sortFrame: "Sort notes by color" in the bar (job 139, frameSortable ≥ 2);
 *   rename: "Rename" in the bar (job 143, exactly one unlocked frame);
 *   header (job 173): only tables selected, {palette} of style.headerFill (the switch "Header row" is style.header);
 *   mmNode (job 195): {colors, shapes} of the focused node of the one unlocked mind map; mmLayout (job 198): {layouts}
 *   of its section "Layout"; align and valign (job 211): none when only labelled shapes are selected
 *   (sel.labelled: symbols, BPMN events and gateways; job 235: own shapes)
 *   stroke (job 260): the border palette with "Default" instead of Black only when sel.redesigned (basic and
 *   flowchart shapes only);
 */
export function contextSections(sel) {
	const fields = new Set(sel?.fields ?? [])
	const types = sel?.types ?? new Set()
	const has = (p) => fields.has(p)
	const out = {
		fill: has('style.fill') ? fillPalette(types) : null,
		fillOpacity: has('style.fillOpacity'),
		stroke: has('style.stroke') ? strokePalette(types, sel?.redesigned === true) : null,
		strokeWidth: has('style.strokeWidth') && strokeWidths(types).length > 0,
		strokeWidths: has('style.strokeWidth') ? strokeWidths(types) : [],
		line: [...types].length > 0 && [...types].every((t) => t === 'connector'),
		// job 273: only pen strokes (their colour and width are a line's)
		ink: false,
		dash: has('style.dash') ? [...ENUMS.dashes] : null,
		textColor: has('style.textColor')
			? { path: 'style.textColor', palette: [...STRONG] }
			: (has('style.color') ? { path: 'style.color', palette: [...STRONG] } : null),
		fontSize: null,
		align: has('style.align') ? [...ENUMS.aligns] : null,
		valign: has('style.valign') ? [...ENUMS.valigns] : null,
		kind: has('data.kind') ? kindChoices(sel) : null,
		route: has('data.route') ? [...ENUMS.routes] : null,
		startCap: has('style.startCap') ? [...ENUMS.caps] : null,
		endCap: has('style.endCap') ? [...ENUMS.caps] : null,
		label: (sel?.count ?? 0) === 1 && has('data.label'),
		arrange: (sel?.count ?? 0) === 1 && !!sel?.box && [...types].every((t) => typeInfo(t).placement !== 'none'),
		itemAlign: (sel?.alignable ?? 0) >= 2,
		distribute: (sel?.alignable ?? 0) >= 3,
		sortColors: countsAtLeast(sel?.sortable, 2),
		sortFrame: countsAtLeast(sel?.frameSortable, 2),
		// job 267: "Summarise" and "Cluster by topic" (selection v2 ai, sessionAi.js offer)
		aiSummarise: sel?.ai?.summarise === true,
		aiCluster: sel?.ai?.cluster === true,
		rename: oneFrame(sel) && unlockedOf(sel) === 1,
		header: [...types].length > 0 && [...types].every((t) => t === 'table') && has('style.header') ? { palette: [...HEADER_FILLS] } : null,
		// job 195: the focused node of the one unlocked mind map, and its layout
		mmNode: sel?.mindmap && sel.mindmap.locked !== true && sel.mindmap.node
			? { colors: [...STRONG_COLORED], shapes: MM_SHAPES.filter((s) => s !== 'line' || !isBoxLayout(sel.mindmap.layout)) }
			: null,
		mmLayout: sel?.mindmap && sel.mindmap.locked !== true ? { layouts: [...MM_LAYOUTS] } : null,
		styled: false,
	}
	if (has('style.fontSize')) {
		const fs = fontSizes(types)
		out.fontSize = fs.sizes.length > 0 || fs.auto ? fs : null
	}
	// (job 203) own shapes only (kind image): they show their picture, so no colour, border or kind;
	// (job 235) their label keeps its text colour and size
	const ts = [...types]
	if (ts.length === 1 && ts[0] === 'shape' && sel?.kind === 'image' && !(Array.isArray(sel?.mixed) && sel.mixed.includes('data.kind'))) {
		Object.assign(out, {
			fill: null, fillOpacity: false, stroke: null, strokeWidth: false, strokeWidths: [], dash: null,
			align: null, valign: null, kind: null,
		})
	}
	// (job 273) data.kind of a pen stroke (pen or highlighter) is no shape kind; strokes are not arranged (no size
	// box to set); strokes only: the colours and widths of their kind (model/ink.js), both kinds: the strong tones
	// and the widths of both
	if (ts.some((x) => x === 'pen')) {
		if (!ts.every((x) => x === 'shape')) out.kind = null
		out.arrange = false
		if (ts.every((x) => x === 'pen')) {
			const k = Array.isArray(sel?.mixed) && sel.mixed.includes('data.kind') ? null : (sel?.kind === 'marker' ? 'marker' : 'pen')
			if (has('style.stroke')) out.stroke = k === null ? [...STRONG] : [...PEN_COLORS[k]]
			if (has('style.strokeWidth')) {
				out.strokeWidths = k === null ? [...PEN_WIDTHS.pen, ...PEN_WIDTHS.marker] : [...PEN_WIDTHS[k]]
				out.strokeWidth = true
			}
			out.ink = true
		}
	}
	// (job 211) labels below symbols, BPMN events, gateways (job 235: own shapes) are always centred: no text alignment
	if (sel?.labelled === true) {
		out.align = null
		out.valign = null
	}
	out.styled = !!(out.fill || out.stroke || out.textColor || out.fontSize || out.align || out.kind || out.route || out.startCap || out.endCap || out.header ||
		out.mmNode || out.mmLayout)
	return out
}

/**
 * @param {object|null} sel selection v2
 * @param {string} key flat key (fill, stroke, fontSize …)
 * @param {unknown} value candidate value
 * @return {boolean} the candidate is the common value of the selection (never
 *   when the selected items differ in that field)
 */
export function isCurrent(sel, key, value) {
	if (!sel || (sel.count ?? 0) === 0) {
		return false
	}
	const path = SELECTION_FIELDS[key]
	if (path && Array.isArray(sel.mixed) && sel.mixed.includes(path)) {
		return false
	}
	const v = sel[key]
	if (typeof v === 'string' && typeof value === 'string') {
		return v.toLowerCase() === value.toLowerCase()
	}
	return v === value && v !== undefined
}

// ---- SPEC-M1 §6.6 ContextMenu.vue, §6.8, §6.11 (stage 4, R19 T4-02) ----------

/**
 * Every entry name the session runs (BoardSession.menuAction,
 * [data-knorke-menu-item=<name>], §6.8). (Job 230) The menus list a subset
 * (menuGroups); react, tags, edit-text, swap-direction, zoom-selection,
 * comment, only-<kind>, paste-here, note-here, pad-here, insert-template,
 * select-all, fit and cursors are no longer listed (the bar, the zoom bar
 * and the keys have them), the session still runs them. arrange (job 230)
 * opens the bar's panel "Arrange".
 */
export const MENU_ITEMS = Object.freeze([
	'cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'react', 'tags',
	// job 173: on a cell of the one selected table (never with react: so after back there)
	'row-above', 'row-below', 'col-left', 'col-right', 'row-delete', 'col-delete', 'table-csv',
	// job 195: on a node of the one selected mind map
	'mm-child', 'mm-sibling', 'mm-fold', 'mm-rearrange', 'mm-delete', 'mm-text',
	// job 199: on a lane of the one selected frame with lanes
	'lane-rename', 'lane-above', 'lane-below', 'lane-up', 'lane-down', 'lane-delete',
	// job 225: its group
	'lane-group', 'lane-group-rename', 'lane-ungroup',
	// job 208: and on its column
	'column-add', 'column-rename', 'column-left', 'column-right', 'column-move-left', 'column-move-right', 'column-delete',
	// job 225: its group
	'column-group', 'column-group-rename', 'column-ungroup',
	'edit-text', 'swap-direction', 'connect', 'arrange', 'sort-colors', 'sort-frame', 'group',
	'ungroup', 'frame-around', 'lock', 'unlock',
	'unlock-by', 'unlock-frame', 'zoom-selection', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'save-template', 'comment',
	'only-sticky', 'only-shape', 'only-text', 'only-connector', 'only-frame', 'only-group',
	'paste-here', 'note-here', 'pad-here', 'insert-template', 'select-all', 'fit', 'grid', 'grid-snap', 'wheel', 'cursors', 'unlock-all',
])

/** (job 154) the stages of the mouse wheel the entry wheel names (env.wheel), in the order its activation cycles. */
export const WHEEL_STAGES = Object.freeze(['auto', 'zoom', 'pan'])

/**
 * Menu entries whose action has a key under another name in the formatter
 * (util/shortcuts.js); every other entry is looked up under its own name.
 */
const MENU_SHORTCUT_NAMES = Object.freeze({ 'paste-here': 'paste' })

/**
 * The shortcut hint of an entry: visible text (aria-hidden in the menu) and
 * the aria-keyshortcuts value (WAI-ARIA key names), both from the one
 * formatter (util/shortcuts.js shortcut, job 141). Apple: ⌘/⇧ symbols,
 * Meta+…, ⌫ and Backspace (the Mac delete key), ↩; elsewhere Ctrl+…,
 * Shift+…, Del (translated, German Strg, Umschalt, Entf) and Control+…,
 * Shift+…, Delete. Lock and unlock: ⌘⇧L / Meta+Shift+L, elsewhere
 * Ctrl+Shift+L / Control+Shift+L; group ⌘G / Ctrl+G, ungroup ⌘⇧G /
 * Ctrl+Shift+G; grid the single key G, cursors C. Entries the formatter has no key for
 * (front, back, swap-direction, connect, sort-colors, sort-frame, unlock-by, unlock-frame,
 * export-png, export-svg, export-pdf, export-bpmn, export-csv, save-template, comment (job 189: no key), note-here, pad-here, insert-template, grid-snap,
 * wheel, unlock-all) have none.
 *
 * @param {string} name entry name (MENU_ITEMS)
 * @param {boolean} apple Apple platform (util/device.js isApplePlatform)
 * @return {{hint: string, aria: string}|null} null for entries without a shortcut
 */
export function menuShortcut(name, apple) {
	if (!MENU_ITEMS.includes(name)) {
		return null
	}
	return shortcut(MENU_SHORTCUT_NAMES[name] ?? name, apple)
}

/**
 * @param {object|null} sel selection v2
 * @return {boolean} the selection is exactly one frame (job 143: "Rename")
 */
function oneFrame(sel) {
	const types = [...(sel?.types ?? [])]
	return (sel?.count ?? 0) === 1 && types.length === 1 && types[0] === 'frame'
}

/**
 * @param {string} name entry name (MENU_ITEMS)
 * @param {object|null} [sel] selection v2 (unlock reads it: unlockLabel; edit-text: "Rename" for one frame;
 *   only-<kind>: the count of kinds)
 * @param {{unlockByName?: string|null, unlockByGuest?: boolean, wheel?: string, templateRight?: (string|null)}} [env]
 *   the menu's state (unlock-by reads the locker's name, plain text; (job 151) unlockByGuest true: that locker is a
 *   guest, the name gets "(guest)"; (job 154) wheel reads the stage 'zoom' or 'pan', anything else is Automatic;
 *   (job 182) save-template is "Save as template…" with templateRight 'save', else "Suggest as template…")
 * @return {string} its label (§6.11; the bar's texts where the bar has the action)
 */
export function menuLabel(name, sel = null, env = {}) {
	switch (name) {
	case 'cut': return t('knorke', 'Cut')
	case 'copy': return t('knorke', 'Copy')
	case 'duplicate': return t('knorke', 'Duplicate')
	case 'delete': return t('knorke', 'Delete')
	case 'front': return t('knorke', 'Bring to front')
	case 'back': return t('knorke', 'Send to back')
	case 'row-above': return t('knorke', 'Insert row above')
	case 'row-below': return t('knorke', 'Insert row below')
	case 'col-left': return t('knorke', 'Insert column left')
	case 'col-right': return t('knorke', 'Insert column right')
	case 'row-delete': return t('knorke', 'Delete row')
	case 'col-delete': return t('knorke', 'Delete column')
	case 'table-csv': return t('knorke', 'Export as CSV')
	case 'mm-child': return t('knorke', 'Add child')
	case 'mm-sibling': return t('knorke', 'Add sibling')
	case 'mm-fold': return env?.mindmap?.folded === true ? t('knorke', 'Unfold branch') : t('knorke', 'Fold branch')
	case 'mm-rearrange': return t('knorke', 'Rearrange')
	case 'mm-delete': return t('knorke', 'Delete branch')
	case 'mm-text': return t('knorke', 'Copy as text')
	case 'lane-rename': return t('knorke', 'Rename lane')
	case 'lane-above': return t('knorke', 'Add lane above')
	case 'lane-below': return t('knorke', 'Add lane below')
	case 'lane-up': return t('knorke', 'Move lane up')
	case 'lane-down': return t('knorke', 'Move lane down')
	case 'lane-delete': return t('knorke', 'Delete lane')
	case 'column-add': return t('knorke', 'Add column')
	case 'column-rename': return t('knorke', 'Rename column')
	case 'column-left': return t('knorke', 'Add column left')
	case 'column-right': return t('knorke', 'Add column right')
	case 'column-move-left': return t('knorke', 'Move column left')
	case 'column-move-right': return t('knorke', 'Move column right')
	case 'column-delete': return t('knorke', 'Delete column')
	case 'lane-group': return t('knorke', 'Create lane group')
	case 'lane-group-rename': return t('knorke', 'Rename lane group')
	case 'lane-ungroup': return t('knorke', 'Dissolve lane group')
	case 'column-group': return t('knorke', 'Create column group')
	case 'column-group-rename': return t('knorke', 'Rename column group')
	case 'column-ungroup': return t('knorke', 'Dissolve column group')
	case 'react': return t('knorke', 'Add reaction')
	case 'tags': return t('knorke', 'Tags')
	case 'edit-text': return oneFrame(sel) ? t('knorke', 'Rename') : t('knorke', 'Edit text')
	case 'swap-direction': return t('knorke', 'Swap direction')
	case 'connect': return t('knorke', 'Connect')
	case 'arrange': return t('knorke', 'Arrange…')
	case 'sort-colors': return t('knorke', 'Sort by color')
	case 'sort-frame': return t('knorke', 'Sort notes by color')
	case 'group': return t('knorke', 'Group items')
	case 'ungroup': return t('knorke', 'Ungroup')
	case 'frame-around': return t('knorke', 'Frame around')
	case 'lock': return t('knorke', 'Lock')
	case 'unlock': return unlockLabel(sel)
	case 'unlock-by': return t('knorke', 'Unlock all locked by {name}', { name: lockerName(env?.unlockByName, env?.unlockByGuest) })
	case 'unlock-frame': return t('knorke', 'Unlock all in this frame')
	case 'zoom-selection': return t('knorke', 'Zoom to selection')
	case 'export-png': return t('knorke', 'Save as image (PNG)')
	case 'export-svg': return t('knorke', 'Save as SVG')
	case 'export-pdf': return t('knorke', 'Save as PDF…')
	case 'export-bpmn': return t('knorke', 'Save as BPMN')
	case 'export-csv': return t('knorke', 'Save as CSV')
	case 'save-template': return env.templateRight === 'save' ? t('knorke', 'Save as template…') : t('knorke', 'Suggest as template…')
	case 'comment': return t('knorke', 'Comment')
	case 'only-sticky':
	case 'only-shape':
	case 'only-text':
	case 'only-connector':
	case 'only-frame':
	case 'only-group': return filterLabel(name.slice('only-'.length), kindCount(sel, name.slice('only-'.length)))
	case 'paste-here': return t('knorke', 'Paste here')
	case 'note-here': return t('knorke', 'Add note here')
	case 'pad-here': return t('knorke', 'Add note pad here')
	case 'insert-template': return t('knorke', 'Insert template…')
	case 'select-all': return t('knorke', 'Select all')
	case 'fit': return t('knorke', 'Show everything')
	case 'grid': return t('knorke', 'Show grid')
	case 'grid-snap': return t('knorke', 'Snap to grid')
	case 'wheel': return env?.wheel === 'zoom'
		? t('knorke', 'Mouse wheel: Zoom')
		: env?.wheel === 'pan' ? t('knorke', 'Mouse wheel: Pan') : t('knorke', 'Mouse wheel: Automatic')
	case 'cursors': return t('knorke', 'Show other people\'s cursors')
	case 'unlock-all': return t('knorke', 'Unlock all')
	default: return name
	}
}

/**
 * @param {string|null} id target of the menu (null: the empty canvas)
 * @return {string} aria-label of the menu root (§6.11)
 */
export function menuName(id) {
	return id === null ? t('knorke', 'Board actions') : t('knorke', 'Selection actions')
}

/**
 * The groups of the context menu (SPEC-M1 §6.6, R19 T4-02; job 230: the
 * groups of "…", zuordnung.md "Rechtsklick-Menü"): the same source as the
 * context bar (selection v2 of BoardSession.selectionInfo). Unavailable
 * entries are missing, never disabled — except group and ungroup (M2, R20
 * Gruppieren, the user's wish): blocked, they stay with aria-disabled and
 * the reason (menuBlocked). Empty groups are left out; the menu draws a
 * separator between two groups.
 * - On items (id ≠ null; they act on the selection the scene set before the
 *   intent), the groups of moreGroups in their order: cut, copy, duplicate
 *   (cut and duplicate only with unlocked items, M2 R20; copy always) ·
 *   front, back (unlocked) · connect (canConnect) · arrange (exactly one
 *   unlocked item with a box, contextSections arrange), sort-colors
 *   (sortable ≥ 2), sort-frame (frameSortable ≥ 2) · group (showGroup),
 *   ungroup (showUngroup) · lock (lockable > 0), unlock (unlockable > 0),
 *   (job 062) unlock-by while env.unlockBy is a whole number > 0 and
 *   env.unlockByName a non-empty string, (job 044) unlock-frame while
 *   env.unlockFrame is one; then the entries of the point: (job 173) the
 *   cell of the one selected table (env.table), (job 195) the node of the one
 *   selected mind map (env.mindmap), (job 199, 208, 225) the lane and column
 *   of the one selected frame with lanes (env.lanes); then (job 178, 200,
 *   205, 179) export-png, export-svg, export-pdf, export-bpmn, export-csv,
 *   always, and (job 182) save-template while env.templateRight is 'suggest'
 *   or 'save'; delete last (unlocked).
 * - On the empty canvas (id === null): (job 154) wheel while env.wheel is
 *   'auto', 'zoom' or 'pan', unlock-frame while env.unlockFrame counts
 *   something (the frame under the point, job 062), unlock-all while
 *   env.unlockAll does (job 044) · (M2, R12) grid while env.grid is a
 *   boolean, then grid-snap while the grid is on and env.gridSnap is a
 *   boolean.
 *
 * @param {object|null} selection selection v2
 * @param {string|null} id target of the intent contextMenu
 * @param {{grid?: boolean, gridSnap?: boolean, wheel?: string,
 *   unlockAll?: number, unlockFrame?: number, unlockBy?: number, unlockByName?: (string|null),
 *   table?: {rows: number, cols: number, locked: boolean}, lanes?: {index: number, count: number, locked: boolean,
 *   cols?: ({index: number, count: number}|null)}, mindmap?: object,
 *   templateRight?: (string|null)} [env] (job 199) lanes: the menu is on a lane of the one selected
 *   frame with lanes (BoardSession.menuLanes; job 208: cols its column under W, null without columns); (job 173)
 *   table: the menu is on a cell of the one selected table (BoardSession.emitMenu); (job 195) mindmap: on a node
 *   of the one selected mind map; (job 182) templateRight: the right of route 28 ('suggest' or 'save'; anything
 *   else: no save-template); grid: the background grid is on (missing: no grid entry); gridSnap: snapping to the
 *   shown grid is on (missing: no grid-snap entry); wheel: the stage of the mouse wheel (no stage: no wheel
 *   entry); unlockAll / unlockFrame / unlockBy: how many items a moderator's "Unlock all" (board) / "Unlock all
 *   in this frame" (the target, or the frame under the point) / "Unlock all locked by {name}" (the target's
 *   locker) would unlock (missing, 0 or no whole number: no entry); unlockByName: that locker's name (missing
 *   or empty: no unlock-by)
 * @return {string[][]} the non-empty groups of entry names in menu order (names of MENU_ITEMS)
 */
export function menuGroups(selection, id, env = {}) {
	if (id !== null && id !== undefined) {
		const groups = moreGroups(selection)
		const del = groups.length > 0 && groups[groups.length - 1][0] === 'delete' ? groups.pop() : null
		const lock = groups.find((g) => g.includes('lock') || g.includes('unlock'))
		const mass = []
		if (countsSome(env.unlockBy) && typeof env.unlockByName === 'string' && env.unlockByName !== '') {
			mass.push('unlock-by')
		}
		if (countsSome(env.unlockFrame)) {
			mass.push('unlock-frame')
		}
		if (lock) {
			lock.push(...mass)
		} else if (mass.length > 0) {
			groups.push(mass)
		}
		groups.push(pointEntries(env))
		// job 178: always on items, locked ones too; job 200: SVG and PDF after it; job 205: BPMN; job 179: then the CSV
		const out = ['export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv']
		// job 182: an account suggests the selection as a template (an admin saves it)
		if (env.templateRight === 'suggest' || env.templateRight === 'save') {
			out.push('save-template')
		}
		groups.push(out)
		if (del) {
			groups.push(del)
		}
		return groups.filter((g) => g.length > 0)
	}
	const first = []
	if (WHEEL_STAGES.includes(env.wheel)) {
		first.push('wheel')
	}
	if (countsSome(env.unlockFrame)) {
		first.push('unlock-frame')
	}
	if (countsSome(env.unlockAll)) {
		first.push('unlock-all')
	}
	const grid = []
	if (typeof env.grid === 'boolean') {
		grid.push('grid')
	}
	if (env.grid === true && typeof env.gridSnap === 'boolean') {
		grid.push('grid-snap')
	}
	return [first, grid].filter((g) => g.length > 0)
}

/**
 * @param {object|null} selection selection v2
 * @param {string|null} id target of the intent contextMenu
 * @param {object} [env] as menuGroups
 * @return {string[]} the entries of menuGroups in menu order, without the group borders
 */
export function menuEntries(selection, id, env = {}) {
	return menuGroups(selection, id, env).flat()
}

/**
 * The entries of the point of an item's menu (the session's env): (job 173)
 * a cell of the one selected table, (job 195) a node of the one selected
 * mind map, (job 199) a lane of the one selected frame with lanes and (job
 * 208) its column, (job 225) with their groups.
 *
 * @param {object} env the menu's state (table, mindmap, lanes)
 * @return {string[]} entry names (maybe none)
 */
function pointEntries(env) {
	const out = []
	const tb = env.table
	if (tb && typeof tb === 'object' && Number.isInteger(tb.rows) && Number.isInteger(tb.cols)) {
		if (tb.locked !== true) {
			out.push('row-above', 'row-below', 'col-left', 'col-right')
			if (tb.rows > 1) {
				out.push('row-delete')
			}
			if (tb.cols > 1) {
				out.push('col-delete')
			}
		}
		out.push('table-csv')
	}
	const mm = env.mindmap
	if (mm && typeof mm === 'object' && Number.isInteger(mm.kids)) {
		if (mm.locked !== true) {
			out.push('mm-child')
			if (mm.root !== true) {
				out.push('mm-sibling')
				if (mm.kids > 0) {
					out.push('mm-fold')
				}
			}
			// job 196: back into the automatic layout
			if (mm.placed === true) {
				out.push('mm-rearrange')
			}
			if (mm.root !== true) {
				out.push('mm-delete')
			}
		}
		out.push('mm-text')
	}
	const ln = env.lanes
	if (ln && typeof ln === 'object' && Number.isInteger(ln.index) && Number.isInteger(ln.count) && ln.locked !== true) {
		out.push('lane-rename', 'lane-above', 'lane-below')
		if (ln.index > 0) {
			out.push('lane-up')
		}
		if (ln.index < ln.count - 1) {
			out.push('lane-down')
		}
		if (ln.count > 1) {
			out.push('lane-delete')
		}
		// job 225: the lane's group
		out.push(...(ln.group === true ? ['lane-group-rename', 'lane-ungroup'] : ['lane-group']))
		// job 208: the column under W (none yet: the first one)
		const c = ln.cols
		if (c && typeof c === 'object' && Number.isInteger(c.index) && Number.isInteger(c.count)) {
			out.push('column-rename', 'column-left', 'column-right')
			if (c.index > 0) {
				out.push('column-move-left')
			}
			if (c.index < c.count - 1) {
				out.push('column-move-right')
			}
			out.push('column-delete')
			// job 225: the column's group
			out.push(...(c.group === true ? ['column-group-rename', 'column-ungroup'] : ['column-group']))
		} else if (c === null || c === undefined) {
			out.push('column-add')
		}
	}
	return out
}

/**
 * (Job 230) The groups of "…" in the context bar (zuordnung.md
 * "Kontextleiste"), each a list of entry names (MENU_ITEMS), empty groups
 * left out: cut, copy, duplicate · front, back · connect · arrange,
 * sort-colors, sort-frame · group, ungroup · lock, unlock · delete. cut,
 * duplicate, front, back, arrange and delete only with unlocked items (M2,
 * R20); copy always; connect with canConnect; arrange for exactly one
 * unlocked item with a box (contextSections arrange); sort-colors with
 * sortable ≥ 2, sort-frame with frameSortable ≥ 2 (job 139); group under
 * showGroup and ungroup under showUngroup, also when blocked (menuBlocked);
 * (job 278) frame-around after them while frameable, also when blocked;
 * lock with lockable > 0, unlock with unlockable > 0.
 *
 * @param {object|null} sel selection v2
 * @return {string[][]} the groups; [] without a selection
 */
export function moreGroups(sel) {
	if ((sel?.count ?? 0) === 0) {
		return []
	}
	const unlocked = unlockedOf(sel) > 0
	const sec = contextSections(sel)
	const groups = [
		unlocked ? ['cut', 'copy', 'duplicate'] : ['copy'],
		unlocked ? ['front', 'back'] : [],
		sel?.canConnect === true ? ['connect'] : [],
		[
			...(unlocked && sec.arrange ? ['arrange'] : []),
			...(sec.sortColors ? ['sort-colors'] : []),
			...(sec.sortFrame ? ['sort-frame'] : []),
		],
		[...(showGroup(sel) ? ['group'] : []), ...(showUngroup(sel) ? ['ungroup'] : []), ...(sel?.frameable === true ? ['frame-around'] : [])],
		[...((sel?.lockable ?? 0) > 0 ? ['lock'] : []), ...((sel?.unlockable ?? 0) > 0 ? ['unlock'] : [])],
		unlocked ? ['delete'] : [],
	]
	return groups.filter((g) => g.length > 0)
}

/**
 * (Job 230) The tabs of the colour panel: fill, border (a connector's
 * "Line") and text, those the selection has.
 *
 * @param {object} sec contextSections
 * @return {string[]} 'fill', 'border', 'text' in this order
 */
export function colorTabs(sec) {
	const out = []
	if (sec?.fill) out.push('fill')
	if (sec?.stroke) out.push('border')
	if (sec?.textColor || sec?.fontSize || sec?.align || sec?.valign) out.push('text')
	return out
}

/**
 * (Job 230) What the colour dot shows: the common fill (job 135: two
 * differing fills split it, selection v2 fills); without a fill the common
 * line or border colour; else the common text colour. A colour that differs
 * across the selection is 'mixed'.
 *
 * @param {object|null} sel selection v2
 * @return {{value: string, colors: string[]}} value: lowercase #rrggbb, 'mixed' or '' (none); colors: the
 *   colours to draw (one, two halves for mixed fills, none)
 */
export function dotOf(sel) {
	const sec = contextSections(sel)
	const key = sec.fill ? 'fill' : sec.stroke ? 'stroke' : sec.textColor ? (sec.textColor.path === 'style.color' ? 'color' : 'textColor') : null
	if (key === null) {
		return { value: '', colors: [] }
	}
	if (Array.isArray(sel?.mixed) && sel.mixed.includes(SELECTION_FIELDS[key])) {
		const fills = key === 'fill' ? (sel.fills ?? []).map(parseHex).filter((c) => c !== null) : []
		return { value: 'mixed', colors: fills.length >= 2 ? fills.slice(0, 2) : [] }
	}
	const c = parseHex(sel?.[key]) ?? (key === 'fill' ? (sel?.fills ?? []).map(parseHex).find((x) => x !== null) ?? null : null)
	return c === null ? { value: '', colors: [] } : { value: c, colors: [c] }
}

/** (Job 279) The bar's buttons while a text editor with Markdown is open. */
export const FORMAT_ITEMS = Object.freeze(['bold', 'italic', 'strike', 'list'])

/**
 * (Job 230) The elements of the context bar in their fixed order, in groups
 * (a separator between two groups): [chip or count, "Align items", colour
 * dot] · the type's toggles (kind, label, rename, route, caps, header,
 * mm-node, mm-layout) · collaboration (react, comment, tags) · (job 267) AI
 * (ai-summarise, ai-cluster) · lock badge and
 * "Select n locked items" · "…" (more). The chip ('chip') from two items on
 * when there is something to narrow (narrowEntries), else the plain count
 * ('count'); none for one item. Without a selection (count 0) only 'offer'.
 * (Job 279) While a text editor with Markdown is open (selection v2
 * richEditing) only bold, italic, strike and list; 'link' ("Open link")
 * among the type's toggles when the one selected item has links.
 *
 * @param {object|null} sel selection v2
 * @return {string[][]} the non-empty groups
 */
export function barGroups(sel) {
	const count = sel?.count ?? 0
	const offer = Number.isInteger(sel?.lockedOffer) && sel.lockedOffer > 0
	if (count === 0) {
		return offer ? [['offer']] : []
	}
	// job 279: while an editor with Markdown is open the bar formats its text, nothing else
	if (sel?.richEditing === true) {
		return [[...FORMAT_ITEMS]]
	}
	const sec = contextSections(sel)
	const lead = []
	if (count >= 2) {
		lead.push(canNarrow(sel) ? 'chip' : 'count')
	}
	if (sec.itemAlign) lead.push('align')
	if (colorTabs(sec).length > 0) lead.push('color')
	const type = []
	if (sec.kind) type.push('kind')
	if (sec.label) type.push('label')
	if (sec.rename) type.push('rename')
	if (sec.route) type.push('route')
	if (sec.startCap || sec.endCap) type.push('caps')
	if (sec.header) type.push('header')
	if (sec.mmNode) type.push('mm-node')
	if (sec.mmLayout) type.push('mm-layout')
	// job 279: the links of the one selected item
	if (Array.isArray(sel?.links) && sel.links.length > 0) type.push('link')
	const collab = []
	if (sel?.reactable === true) collab.push('react')
	if (sel?.commentable === true) collab.push('comment')
	if ((sel?.taggable ?? 0) > 0) collab.push('tags')
	// job 267: the AI's two buttons, a group of their own
	const ai = []
	if (sec.aiSummarise) ai.push('ai-summarise')
	if (sec.aiCluster) ai.push('ai-cluster')
	const lock = []
	if ((sel?.locked ?? 0) > 0) lock.push('badge')
	if (offer) lock.push('offer')
	const more = moreGroups(sel).length > 0 ? ['more'] : []
	return [lead, type, collab, ai, lock, more].filter((g) => g.length > 0)
}

/**
 * @param {object|null} sel selection v2
 * @return {string[]} barGroups without the group borders
 */
export function barItems(sel) {
	return barGroups(sel).flat()
}

/**
 * (Job 230) The entries of the chip's panel "Narrow selection": the kinds
 * (filterEntries, job 144) and the tags of the selected notes (selection v2
 * tags: [{id, name, color, count}]) whose count is smaller than the
 * selection (a tag every selected item has changes nothing), in the given
 * order.
 *
 * @param {object|null} sel selection v2
 * @return {{kinds: Array<{kind: string, count: number}>, tags: Array<{id: string, name: string, color: string, count: number}>}}
 */
export function narrowEntries(sel) {
	const count = sel?.count ?? 0
	const tags = (Array.isArray(sel?.tags) ? sel.tags : []).filter((tg) => typeof tg?.id === 'string' && tg.id !== ''
		&& typeof tg.name === 'string' && countsSome(tg.count) && tg.count < count)
	return { kinds: filterEntries(sel), tags }
}

/**
 * @param {object|null} sel selection v2
 * @return {boolean} the chip has something to narrow
 */
export function canNarrow(sel) {
	const e = narrowEntries(sel)
	return e.kinds.length > 0 || e.tags.length > 0
}

/**
 * @param {unknown} v a count of the menu payload (unlockAll, unlockFrame, unlockBy)
 * @return {boolean} a whole number > 0: the mass unlock's entry shows
 */
function countsSome(v) {
	return Number.isInteger(v) && v > 0
}

/**
 * @param {unknown} v a count of selection v2 (sortable, frameSortable)
 * @param {number} n least count
 * @return {boolean} a whole number ≥ n (missing: false)
 */
function countsAtLeast(v, n) {
	return Number.isInteger(v) && v >= n
}

// ---- Job 144: filter the selection ---------------------------------------------

/** The kinds "Filter selection" knows (model/groups.js selectionKinds), in list order. */
export const FILTER_KINDS = Object.freeze(['sticky', 'shape', 'text', 'connector', 'frame', 'group'])

/**
 * @param {object|null} sel selection v2
 * @return {Array<{kind: string, count: number}>} its kinds: the known kinds with a whole count > 0, in
 *   the order given ([] for a selection v2 without the key)
 */
export function filterEntries(sel) {
	const list = Array.isArray(sel?.kinds) ? sel.kinds : []
	return list.filter((k) => FILTER_KINDS.includes(k?.kind) && countsSome(k.count))
}

/**
 * @param {object|null} sel selection v2
 * @param {string} kind a kind of FILTER_KINDS
 * @return {number} its count in kinds (0 without one)
 */
function kindCount(sel, kind) {
	return filterEntries(sel).find((k) => k.kind === kind)?.count ?? 0
}

/**
 * The text of an entry of "Filter selection" (the bar's panel and the menu).
 *
 * @param {string} kind sticky, shape, text, connector, frame or group
 * @param {number} count how many items (groups for 'group')
 * @return {string} "Only notes (5)" …; the kind itself for an unknown one
 */
export function filterLabel(kind, count) {
	const c = { count: String(count) }
	switch (kind) {
	case 'sticky': return t('knorke', 'Only notes ({count})', c)
	case 'shape': return t('knorke', 'Only shapes ({count})', c)
	case 'text': return t('knorke', 'Only text items ({count})', c)
	case 'connector': return t('knorke', 'Only connectors ({count})', c)
	case 'frame': return t('knorke', 'Only frames ({count})', c)
	case 'group': return t('knorke', 'Only groups ({count})', c)
	default: return String(kind)
	}
}

// ---- M2 (SPEC-M1 §1.2 "(R20) Sperren") ----------------------------------------

/**
 * @param {object|null} sel selection v2
 * @return {number} unlocked selected items; a selection v2 without the key counts every item
 */
export function unlockedOf(sel) {
	return Number.isInteger(sel?.unlocked) ? sel.unlocked : (sel?.count ?? 0)
}

/**
 * (job 151) The name a lock shows: a guest's with "(guest)" (the presence's
 * string), so nobody passes as an account unnoticed; an account's as it is.
 *
 * @param {unknown} name the locker's name
 * @param {boolean} guest the locker locked as a guest
 * @return {string} plain text
 */
function lockerName(name, guest) {
	const s = String(name ?? '')
	return guest === true ? t('knorke', '{name} (guest)', { name: s }) : s
}

/**
 * Text of the lock badge of the bar (selection v2 lockedBy): "Locked by
 * you", "Locked by {name}" ((job 151) a guest: "{name} (guest)"), "Locked,
 * locker unknown" or "%n locked items".
 * The name is plain text (interpolation, t() never escapes; every sink is
 * text, an attribute binding or textContent).
 *
 * @param {object|null} sel selection v2
 * @return {string} badge text; '' without a locked item
 */
export function lockBadgeText(sel) {
	const by = sel?.lockedBy ?? null
	switch (by?.kind) {
	case 'mine': return t('knorke', 'Locked by you')
	case 'name': return t('knorke', 'Locked by {name}', { name: lockerName(by.name, by.guest) })
	case 'unknown': return t('knorke', 'Locked, locker unknown')
	case 'several': return n('knorke', '%n locked item', '%n locked items', sel?.locked ?? 0)
	default: return ''
	}
}

/**
 * Label of Unlock in the bar and the menu (selection v2 unlockBy): "Unlock"
 * for the own locks, else the locker visibly named ((job 151) a guest with
 * "(guest)"), no silent bypass.
 *
 * @param {object|null} sel selection v2
 * @return {string} label
 */
export function unlockLabel(sel) {
	const by = sel !== null && typeof sel === 'object' ? sel.unlockBy ?? null : null
	switch (by?.kind) {
	case 'name': return t('knorke', 'Unlock (locked by {name})', { name: lockerName(by.name, by.guest) })
	case 'unknown': return t('knorke', 'Unlock (locker unknown)')
	case 'several': return t('knorke', 'Unlock (locked by several people)')
	default: return t('knorke', 'Unlock')
	}
}

// ---- M2 (SPEC-M1 §1.2 "(R20) Gruppieren") ------------------------------------

/**
 * @param {object|null} sel selection v2
 * @return {boolean} "Group items" shows: at least two items would form the group and the selection is not exactly one group
 */
export function showGroup(sel) {
	return (sel?.groupable ?? 0) >= 2 && sel?.oneGroup !== true
}

/**
 * @param {object|null} sel selection v2
 * @return {boolean} "Ungroup" shows: the selection touches a group
 */
export function showUngroup(sel) {
	return (sel?.grouped ?? 0) > 0
}

/**
 * The hint of a blocked "Group items" / "Ungroup" (selection v2 groupBlock,
 * ungroupBlock), the same fixed text in the bar's title, the menu's title
 * and the toast group-blocked.
 *
 * @param {unknown} reason 'frame', 'locked' or 'parent'
 * @return {string|null} the text, null for no (or an unknown) reason
 */
export function groupHintText(reason) {
	switch (reason) {
	case 'frame': return t('knorke', 'Frames cannot be grouped.')
	case 'parent': return t('knorke', 'Only items in the same frame, or all outside frames, can be grouped.')
	case 'locked': return t('knorke', 'Locked items cannot be grouped or ungrouped.')
	default: return null
	}
}

/**
 * (Job 278) The hint of a blocked "Frame around" (selection v2 frameBlock,
 * model/groups.js frameAroundPlan): the bar's and the menu's title and the
 * toast frame-blocked.
 *
 * @param {unknown} reason 'parent' or 'locked'
 * @return {string|null} the text, null for no (or an unknown) reason
 */
export function frameHintText(reason) {
	switch (reason) {
	case 'parent': return t('knorke', 'Only items in the same frame, or all outside frames, can be framed.')
	case 'locked': return t('knorke', 'Locked items cannot be framed.')
	default: return null
	}
}

/**
 * @param {object|null} sel selection v2
 * @return {string|null} why "Group items" is blocked (groupBlock), null when it is not
 */
export function groupHint(sel) {
	return groupHintText(sel?.groupBlock ?? null)
}

/**
 * @param {object|null} sel selection v2
 * @return {string|null} why "Ungroup" is blocked (ungroupBlock), null when it is not
 */
export function ungroupHint(sel) {
	return groupHintText(sel?.ungroupBlock ?? null)
}

/**
 * A blocked entry of the context menu (M2, R20): group and ungroup stay in
 * the menu while blocked, with aria-disabled and this text as their title;
 * activating one closes the menu and shows the toast group-blocked.
 *
 * @param {string} name entry name (MENU_ITEMS)
 * @param {object|null} sel selection v2
 * @return {string|null} the hint, null when the entry is not blocked (every other entry: null)
 */
export function menuBlocked(name, sel) {
	if (name === 'group') {
		return groupHint(sel)
	}
	if (name === 'ungroup') {
		return ungroupHint(sel)
	}
	if (name === 'frame-around') {
		return frameHintText(sel?.frameBlock ?? null)
	}
	return null
}
