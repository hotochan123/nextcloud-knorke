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
 * - Fill: shapes only → the shape palette; frames only → the frame palette;
 *   anything else (notes, or a mix of notes, shapes and frames) → the note
 *   palette of M0 (plus FRAME_FILL when a frame is selected). A note colour
 *   lands on frames as the nearest frame colour (actions.setStyle).
 * - Palettes come from tokens.js by name (SHAPE_PALETTE, FRAME_FILLS,
 *   STICKY_COLORS); this module never repeats their values.
 * - Font sizes: the steps inside the bounds of every selected type's rule;
 *   "Auto" only when every selected type fits its text by default (notes,
 *   shapes).
 * - Connectors (round 1b): route, start and end tip, line colour from
 *   CONNECTOR_COLORS (connectors only; a mix with shapes keeps the shape
 *   palette), widths inside every selected type's rule (a connector line is
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
 * aria-keyshortcuts (Meta+… on Apple, Control+… elsewhere); menuCount the
 * item count line of the board menu. M2 (SPEC-M1 §1.2 (R12)): the board
 * menu's entry "Show grid" (grid, the single key G on every platform) is a
 * check box; it is only listed when the menu knows the grid's state. After
 * it, only while the grid is shown, the check box "Snap to grid"
 * (grid-snap, no key); only the mass unlocks follow (job 062).
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
 */
import { ENUMS, fieldDefault, fieldRule, textPathOf, typeInfo } from '../model/registry.js'
import { CONNECTOR_COLORS, FRAME_FILL, FRAME_FILLS, SHAPE_PALETTE, STICKY_COLORS } from '../model/tokens.js'
import { n, t } from '../util/l10n.js'

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
})

/** Font size steps of the context bar. */
export const FONT_SIZES = Object.freeze([12, 16, 20, 24, 32, 48, 64, 96, 128])
/** Border widths of shapes (0 = no border) and line widths of connectors (from 1). */
export const STROKE_WIDTHS = Object.freeze([0, 1, 2, 4, 8, 12])
/** Fill opacities of shapes (0 = no fill). */
export const OPACITIES = Object.freeze([100, 75, 50, 25, 0])

/**
 * @param {Iterable<string>} types selected types
 * @return {string[]} fill palette (lowercase #rrggbb)
 */
export function fillPalette(types) {
	const ts = [...(types ?? [])]
	if (ts.length === 0) {
		return []
	}
	if (ts.every((t) => t === 'shape')) {
		return [...SHAPE_PALETTE]
	}
	if (ts.every((t) => t === 'frame')) {
		return [...FRAME_FILLS]
	}
	const list = STICKY_COLORS.map((c) => c.toLowerCase())
	if (ts.includes('frame') && !list.includes(FRAME_FILL)) {
		list.push(FRAME_FILL)
	}
	return list
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
 * @return {string[]} line/border palette: CONNECTOR_COLORS for connectors only, else SHAPE_PALETTE
 */
export function strokePalette(types) {
	const ts = [...(types ?? [])]
	return ts.length > 0 && ts.every((t) => t === 'connector') ? [...CONNECTOR_COLORS] : [...SHAPE_PALETTE]
}

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
 *   distribute: boolean, styled: boolean}}
 *   line: the stroke is a connector line (connectors only), not a border;
 *   itemAlign: "Align" for the items (M2), apart from `align`, the text alignment;
 *   distribute: "Distribute" in the align panel (M2, never without itemAlign)
 */
export function contextSections(sel) {
	const fields = new Set(sel?.fields ?? [])
	const types = sel?.types ?? new Set()
	const has = (p) => fields.has(p)
	const out = {
		fill: has('style.fill') ? fillPalette(types) : null,
		fillOpacity: has('style.fillOpacity'),
		stroke: has('style.stroke') ? strokePalette(types) : null,
		strokeWidth: has('style.strokeWidth') && strokeWidths(types).length > 0,
		strokeWidths: has('style.strokeWidth') ? strokeWidths(types) : [],
		line: [...types].length > 0 && [...types].every((t) => t === 'connector'),
		dash: has('style.dash') ? [...ENUMS.dashes] : null,
		textColor: has('style.textColor')
			? { path: 'style.textColor', palette: [...SHAPE_PALETTE] }
			: (has('style.color') ? { path: 'style.color', palette: [...SHAPE_PALETTE] } : null),
		fontSize: null,
		align: has('style.align') ? [...ENUMS.aligns] : null,
		valign: has('style.valign') ? [...ENUMS.valigns] : null,
		kind: has('data.kind') ? [...ENUMS.shapeKinds] : null,
		route: has('data.route') ? [...ENUMS.routes] : null,
		startCap: has('style.startCap') ? [...ENUMS.caps] : null,
		endCap: has('style.endCap') ? [...ENUMS.caps] : null,
		label: (sel?.count ?? 0) === 1 && has('data.label'),
		arrange: (sel?.count ?? 0) === 1 && !!sel?.box && [...types].every((t) => typeInfo(t).placement !== 'none'),
		itemAlign: (sel?.alignable ?? 0) >= 2,
		distribute: (sel?.alignable ?? 0) >= 3,
		styled: false,
	}
	if (has('style.fontSize')) {
		const fs = fontSizes(types)
		out.fontSize = fs.sizes.length > 0 || fs.auto ? fs : null
	}
	out.styled = !!(out.fill || out.stroke || out.textColor || out.fontSize || out.align || out.kind || out.route || out.startCap || out.endCap)
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
 * Every entry the context menu knows ([data-knorke-menu-item=<name>], §6.8),
 * in menu order: the entries on items (id ≠ null), then the entries on the
 * empty canvas (id === null). unlock-frame is listed once, with the entries
 * on items, but shows in both menus: on a frame before zoom-selection, in
 * the board menu (the frame under the point, job 062) before unlock-all.
 */
export const MENU_ITEMS = Object.freeze([
	'cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'edit-text', 'connect', 'group', 'ungroup', 'lock', 'unlock',
	'unlock-by', 'unlock-frame', 'zoom-selection',
	'paste-here', 'note-here', 'select-all', 'fit', 'grid', 'grid-snap', 'unlock-all',
])

/**
 * Keyboard shortcut per entry: `mod` = Ctrl on most platforms, ⌘ on Apple
 * (aria-keyshortcuts Control+… / Meta+…, §6.6); entries without one have none.
 */
const MENU_KEYS = Object.freeze({
	cut: { mod: 'X' },
	copy: { mod: 'C' },
	duplicate: { mod: 'D' },
	delete: { key: 'delete' },
	'edit-text': { key: 'enter' },
	'zoom-selection': { shift: '2' },
	'paste-here': { mod: 'V' },
	'select-all': { mod: 'A' },
	fit: { shift: '1' },
	grid: { single: 'G' },
	group: { mod: 'G' },
	ungroup: { modShift: 'G' },
	lock: { modShift: 'L' },
	unlock: { modShift: 'L' },
})

/**
 * The shortcut hint of an entry: visible text (aria-hidden in the menu) and
 * the aria-keyshortcuts value (WAI-ARIA key names). Apple: ⌘/⇧ symbols,
 * Meta+…, Backspace (the Mac delete key); elsewhere Ctrl+…, Shift+…, Del.
 * Lock and unlock: ⌘⇧L / Meta+Shift+L, elsewhere Ctrl+Shift+L / Control+Shift+L.
 * Group: ⌘G / Meta+G, else Ctrl+G / Control+G; ungroup: ⌘⇧G / Meta+Shift+G,
 * else Ctrl+Shift+G / Control+Shift+G.
 *
 * @param {string} name entry name (MENU_ITEMS)
 * @param {boolean} apple Apple platform (util/device.js isApplePlatform)
 * @return {{hint: string, aria: string}|null} null for entries without a shortcut
 */
export function menuShortcut(name, apple) {
	const k = MENU_KEYS[name]
	if (!k) {
		return null
	}
	if (k.mod) {
		return apple ? { hint: '⌘' + k.mod, aria: 'Meta+' + k.mod } : { hint: 'Ctrl+' + k.mod, aria: 'Control+' + k.mod }
	}
	if (k.modShift) {
		return apple ? { hint: '⌘⇧' + k.modShift, aria: 'Meta+Shift+' + k.modShift } : { hint: 'Ctrl+Shift+' + k.modShift, aria: 'Control+Shift+' + k.modShift }
	}
	if (k.shift) {
		return apple ? { hint: '⇧' + k.shift, aria: 'Shift+' + k.shift } : { hint: 'Shift+' + k.shift, aria: 'Shift+' + k.shift }
	}
	if (k.single) {
		return { hint: k.single, aria: k.single }
	}
	if (k.key === 'delete') {
		return apple ? { hint: '⌫', aria: 'Backspace' } : { hint: 'Del', aria: 'Delete' }
	}
	return apple ? { hint: '↩', aria: 'Enter' } : { hint: 'Enter', aria: 'Enter' }
}

/**
 * @param {string} name entry name (MENU_ITEMS)
 * @param {object|null} [sel] selection v2 (only unlock reads it: unlockLabel)
 * @param {{unlockByName?: string|null}} [env] the menu's state (only unlock-by reads it: the locker's
 *   name, plain text)
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
	case 'edit-text': return t('knorke', 'Edit text')
	case 'connect': return t('knorke', 'Connect')
	case 'group': return t('knorke', 'Group items')
	case 'ungroup': return t('knorke', 'Ungroup')
	case 'lock': return t('knorke', 'Lock')
	case 'unlock': return unlockLabel(sel)
	case 'unlock-by': return t('knorke', 'Unlock all locked by {name}', { name: String(env?.unlockByName ?? '') })
	case 'unlock-frame': return t('knorke', 'Unlock all in this frame')
	case 'zoom-selection': return t('knorke', 'Zoom to selection')
	case 'paste-here': return t('knorke', 'Paste here')
	case 'note-here': return t('knorke', 'Add note here')
	case 'select-all': return t('knorke', 'Select all')
	case 'fit': return t('knorke', 'Show everything')
	case 'grid': return t('knorke', 'Show grid')
	case 'grid-snap': return t('knorke', 'Snap to grid')
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
 * The count line under the entries of the board menu (empty canvas only):
 * the items of the local scene model at the moment the session reported the
 * menu (BoardSession.emitMenu `items`), not live. %n is the bare number,
 * like every other %n text.
 *
 * @param {string|null|undefined} id target of the menu (null: the empty canvas)
 * @param {unknown} items items on the board (menu.items)
 * @return {string|null} "12 items on this board"; null on items or without a valid count (no line)
 */
export function menuCount(id, items) {
	if ((id !== null && id !== undefined) || !Number.isInteger(items) || items < 0) {
		return null
	}
	return n('knorke', '%n item on this board', '%n items on this board', items)
}

/**
 * The entries of the context menu (SPEC-M1 §6.6, R19 T4-02): the same source
 * as the context bar (selection v2 of BoardSession.selectionInfo, the bar's
 * "Connect" rule). Unavailable entries are missing, never disabled — except
 * group and ungroup (M2, R20 Gruppieren, the user's wish): blocked, they
 * stay with aria-disabled and the reason (menuBlocked).
 * - On items (id ≠ null; they act on the selection the scene set before the
 *   intent): cut, duplicate, delete, front, back only with unlocked items
 *   (M2, R20), copy always; edit-text only for exactly one selected,
 *   unlocked item with a text path (like Enter); connect only when the bar
 *   shows "Connect" (canConnect); group under showGroup, ungroup under
 *   showUngroup (like the bar); lock with lockable > 0, unlock with
 *   unlockable > 0; (job 062) unlock-by while env.unlockBy is a whole number
 *   > 0 and env.unlockByName a non-empty string; (job 044) unlock-frame while
 *   env.unlockFrame is a whole number > 0; zoom-selection (like Shift+2).
 * - On the empty canvas (id === null): paste-here only where the browser can
 *   read the clipboard (secure context with navigator.clipboard.read, §6.5.3
 *   R19), note-here, select-all (not on an empty board), fit; (M2, R12) grid,
 *   only when env.grid is a boolean (the state of the background grid); then
 *   grid-snap, only when the grid is on (env.grid true) and env.gridSnap is
 *   a boolean (snapping to it can only be switched while it is shown); the
 *   mass unlocks last, so no other entry moves when there are locks (job
 *   062): unlock-frame while env.unlockFrame is a whole number > 0 (the
 *   frame under the point), then unlock-all while env.unlockAll is one (job
 *   044).
 *
 * @param {object|null} selection selection v2
 * @param {string|null} id target of the intent contextMenu
 * @param {{canPaste?: boolean, items?: number, grid?: boolean, gridSnap?: boolean, unlockAll?: number,
 *   unlockFrame?: number, unlockBy?: number, unlockByName?: (string|null)}} [env] canPaste:
 *   board/clipboard.js canReadClipboard() (default: false); items: items on the board (default: some);
 *   grid: the background grid is on (missing: no grid entry); gridSnap: snapping to the shown grid is on
 *   (missing: no grid-snap entry); unlockAll / unlockFrame / unlockBy: how many items a moderator's
 *   "Unlock all" (board) / "Unlock all in this frame" (the target, or the frame under the point) /
 *   "Unlock all locked by {name}" (the target's locker) would unlock (missing, 0 or no whole number: no
 *   entry); unlockByName: that locker's name (missing or empty: no unlock-by)
 * @return {string[]} entry names in menu order (a subset of MENU_ITEMS)
 */
export function menuEntries(selection, id, env = {}) {
	if (id !== null && id !== undefined) {
		const count = selection?.count ?? 0
		const unlocked = unlockedOf(selection)
		const types = [...(selection?.types ?? [])]
		const out = unlocked > 0 ? ['cut', 'copy', 'duplicate', 'delete', 'front', 'back'] : ['copy']
		if (count === 1 && unlocked === 1 && types.length === 1 && textPathOf(types[0]) !== null) {
			out.push('edit-text')
		}
		if (selection?.canConnect === true) {
			out.push('connect')
		}
		if (showGroup(selection)) {
			out.push('group')
		}
		if (showUngroup(selection)) {
			out.push('ungroup')
		}
		if ((selection?.lockable ?? 0) > 0) {
			out.push('lock')
		}
		if ((selection?.unlockable ?? 0) > 0) {
			out.push('unlock')
		}
		if (countsSome(env.unlockBy) && typeof env.unlockByName === 'string' && env.unlockByName !== '') {
			out.push('unlock-by')
		}
		if (countsSome(env.unlockFrame)) {
			out.push('unlock-frame')
		}
		out.push('zoom-selection')
		return out
	}
	const out = []
	if (env.canPaste === true) {
		out.push('paste-here')
	}
	out.push('note-here')
	if (env.items === undefined || env.items > 0) {
		out.push('select-all')
	}
	out.push('fit')
	if (typeof env.grid === 'boolean') {
		out.push('grid')
	}
	if (env.grid === true && typeof env.gridSnap === 'boolean') {
		out.push('grid-snap')
	}
	if (countsSome(env.unlockFrame)) {
		out.push('unlock-frame')
	}
	if (countsSome(env.unlockAll)) {
		out.push('unlock-all')
	}
	return out
}

/**
 * @param {unknown} v a count of the menu payload (unlockAll, unlockFrame, unlockBy)
 * @return {boolean} a whole number > 0: the mass unlock's entry shows
 */
function countsSome(v) {
	return Number.isInteger(v) && v > 0
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
 * Text of the lock badge of the bar (selection v2 lockedBy): "Locked by
 * you", "Locked by {name}", "Locked, locker unknown" or "%n locked items".
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
	case 'name': return t('knorke', 'Locked by {name}', { name: String(by.name ?? '') })
	case 'unknown': return t('knorke', 'Locked, locker unknown')
	case 'several': return n('knorke', '%n locked item', '%n locked items', sel?.locked ?? 0)
	default: return ''
	}
}

/**
 * Label of Unlock in the bar and the menu (selection v2 unlockBy): "Unlock"
 * for the own locks, else the locker visibly named, no silent bypass.
 *
 * @param {object|null} sel selection v2
 * @return {string} label
 */
export function unlockLabel(sel) {
	const by = sel !== null && typeof sel === 'object' ? sel.unlockBy ?? null : null
	switch (by?.kind) {
	case 'name': return t('knorke', 'Unlock (locked by {name})', { name: String(by.name ?? '') })
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
	return null
}
