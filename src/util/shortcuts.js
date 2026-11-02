/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The one formatter of keyboard shortcut hints (factory job 141): tooltips
 * of the tool bar, the context bar, the zoom controls and the follow banner,
 * the right-click menu (contextbar.js menuShortcut) and the messages that
 * name a key (toast paste-blocked, the copy prompt of the share links). The
 * keys themselves live in InputController; this table only names them.
 *
 * shortcut(name, apple) gives { hint, aria }:
 * - hint, the visible text. Apple (util/device.js isApplePlatform): ⌘ and ⇧
 *   written before the key without "+" (⌘⇧Z), ⌫ for delete, ↩ for Enter.
 *   Elsewhere the key names joined with "+", Ctrl, Shift and Del translated
 *   (German Strg, Umschalt, Entf) at the call, never when the module loads.
 *   Esc stays "Esc" everywhere, Enter stays "Enter" off Apple, a single key
 *   (G, +, −, the tool keys) stays as it is.
 * - aria, the aria-keyshortcuts value: the WAI-ARIA key names, never
 *   translated (Meta+… on Apple, Control+… elsewhere; Backspace on Apple,
 *   Delete elsewhere; Enter, Escape).
 * The tools take their single key from model/tools.js TOOLS, in capitals
 * (V, H, N, S, T, L, F); their names are the tool ids.
 *
 * Job 145 (the shortcuts overview, components/shortcutList.js) adds the keys
 * no tooltip names; every hint above stays as it was. Alt is ⌥ on Apple
 * (written before ⇧), "Alt" elsewhere; the four arrows are one hint ←↑→↓
 * and four aria shortcuts (ArrowLeft ArrowUp ArrowRight ArrowDown, each with
 * the modifiers); Tab, F10 and ? stay as they are. The keys held with a
 * mouse or pen (hold-*) are a modifier alone: ⌘/Ctrl, ⇧/Shift, ⌥/Alt, and
 * Space, translated on every platform (German Leertaste); their aria is the
 * key's WAI-ARIA name (Meta/Control, Shift, Alt, Space).
 *
 * Job 174 adds the keys of a table's cell editor for the overview: Tab and
 * Shift+Tab (next-cell, previous-cell) and the four arrows (cell-arrows).
 * Job 195 adds the keys at a focused mind map node: Tab (mm-child), Enter
 * (mm-sibling), the arrows (mm-arrows), F2 (mm-edit), Delete (mm-delete)
 * and Shift+Enter in its editor (mm-break). Job 271 adds Ctrl/⌘+F (search).
 */
import { TOOLS } from '../model/tools.js'
import { t } from './l10n.js'

/**
 * name → keys: mod (Ctrl, ⌘ on Apple), alt (job 145), shift, key (a single
 * character, or Delete, Enter, Escape, Tab, F10; job 145: Arrows for the four
 * arrow keys, Space, and Shift, Mod, Alt held alone) and, where it differs
 * from the visible key, its aria name (the minus key).
 */
const KEYS = Object.freeze({
	undo: { mod: true, key: 'Z' },
	redo: { mod: true, shift: true, key: 'Z' },
	copy: { mod: true, key: 'C' },
	cut: { mod: true, key: 'X' },
	duplicate: { mod: true, key: 'D' },
	paste: { mod: true, key: 'V' },
	'select-all': { mod: true, key: 'A' },
	delete: { key: 'Delete' },
	'edit-text': { key: 'Enter' },
	// job 279: in a text editor with Markdown
	bold: { mod: true, key: 'B' },
	italic: { mod: true, key: 'I' },
	group: { mod: true, key: 'G' },
	ungroup: { mod: true, shift: true, key: 'G' },
	lock: { mod: true, shift: true, key: 'L' },
	unlock: { mod: true, shift: true, key: 'L' },
	'zoom-selection': { shift: true, key: '2' },
	'zoom-100': { shift: true, key: '0' },
	fit: { shift: true, key: '1' },
	'zoom-in': { key: '+' },
	'zoom-out': { key: '−', aria: '-' },
	grid: { key: 'G' },
	// job 147: other people's cursors
	cursors: { key: 'C' },
	'stop-following': { key: 'Escape' },
	// job 145: the keys of the shortcuts overview only
	shortcuts: { key: '?' },
	'paste-in-place': { mod: true, shift: true, key: 'V' },
	nudge: { key: 'Arrows' },
	'nudge-big': { shift: true, key: 'Arrows' },
	neighbour: { alt: true, key: 'Arrows' },
	'next-item': { key: 'Tab' },
	'previous-item': { shift: true, key: 'Tab' },
	'context-menu': { shift: true, key: 'F10' },
	deselect: { key: 'Escape' },
	'end-edit': { key: 'Escape' },
	'end-edit-mod': { mod: true, key: 'Enter' },
	'next-note': { key: 'Tab' },
	// job 174: a table's cell editor
	'next-cell': { key: 'Tab' },
	'previous-cell': { shift: true, key: 'Tab' },
	'cell-arrows': { key: 'Arrows' },
	// job 195: a focused mind map node and its editor
	'mm-child': { key: 'Tab' },
	'mm-sibling': { key: 'Enter' },
	'mm-arrows': { key: 'Arrows' },
	'mm-edit': { key: 'F2' },
	'mm-delete': { key: 'Delete' },
	'mm-break': { shift: true, key: 'Enter' },
	// job 271: search on the board
	search: { mod: true, key: 'F' },
	'hold-space': { key: 'Space' },
	'hold-shift': { key: 'Shift' },
	'hold-mod': { key: 'Mod' },
	'hold-alt': { key: 'Alt' },
})

/** The WAI-ARIA names of the four arrow keys, in the order of the hint ←↑→↓. */
const ARROW_KEYS = Object.freeze(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'])

/** Every name the formatter knows: the table above, then the tool ids of TOOLS. */
export const SHORTCUT_NAMES = Object.freeze([...Object.keys(KEYS), ...TOOLS.map((x) => x.id)])

/**
 * @param {string} name a name of SHORTCUT_NAMES (an action or a tool id)
 * @return {{mod?: boolean, alt?: boolean, shift?: boolean, key: string, aria?: string}|null} its keys
 */
function keysOf(name) {
	if (Object.prototype.hasOwnProperty.call(KEYS, name)) {
		return KEYS[name]
	}
	const tool = TOOLS.find((x) => x.id === name)
	return tool ? { key: tool.key.toUpperCase() } : null
}

/**
 * @param {string} key a key of the table
 * @param {boolean} apple Apple platform
 * @return {string} its visible text
 */
function keyHint(key, apple) {
	switch (key) {
	case 'Delete': return apple ? '⌫' : t('knorke', 'Del')
	case 'Enter': return apple ? '↩' : 'Enter'
	case 'Escape': return 'Esc'
	case 'Arrows': return '←↑→↓'
	case 'Space': return t('knorke', 'Space')
	case 'Shift': return apple ? '⇧' : t('knorke', 'Shift')
	case 'Mod': return apple ? '⌘' : t('knorke', 'Ctrl')
	case 'Alt': return apple ? '⌥' : 'Alt'
	default: return key
	}
}

/**
 * @param {{key: string, aria?: string}} k keys of a name
 * @param {boolean} apple Apple platform
 * @return {string} the WAI-ARIA name of its key
 */
function keyAria(k, apple) {
	if (k.key === 'Delete') {
		return apple ? 'Backspace' : 'Delete'
	}
	if (k.key === 'Mod') {
		return apple ? 'Meta' : 'Control'
	}
	return k.aria ?? k.key
}

/**
 * The shortcut of an action or a tool, for the platform and the language of
 * the moment.
 *
 * @param {string} name a name of SHORTCUT_NAMES
 * @param {boolean} apple Apple platform (util/device.js isApplePlatform)
 * @return {{hint: string, aria: string}|null} visible text and aria-keyshortcuts value; null for a name
 *   without a shortcut
 */
export function shortcut(name, apple) {
	const k = keysOf(name)
	if (k === null) {
		return null
	}
	const key = keyHint(k.key, apple)
	const hint = apple
		? (k.mod ? '⌘' : '') + (k.alt ? '⌥' : '') + (k.shift ? '⇧' : '') + key
		: [k.mod ? t('knorke', 'Ctrl') : null, k.alt ? 'Alt' : null, k.shift ? t('knorke', 'Shift') : null, key].filter((x) => x !== null).join('+')
	const mods = [k.mod ? (apple ? 'Meta' : 'Control') : null, k.alt ? 'Alt' : null, k.shift ? 'Shift' : null].filter((x) => x !== null)
	const keys = k.key === 'Arrows' ? ARROW_KEYS : [keyAria(k, apple)]
	const aria = keys.map((x) => [...mods, x].join('+')).join(' ')
	return { hint, aria }
}

/**
 * A tooltip with its key: "Copy (Ctrl+C)", "Copy (⌘C)", "Kopieren (Strg+C)".
 *
 * @param {string} label the (translated) name of the button
 * @param {string} name a name of SHORTCUT_NAMES
 * @param {boolean} apple Apple platform
 * @return {string} label + ' (' + hint + ')', only the label for a name without a shortcut
 */
export function withShortcut(label, name, apple) {
	const s = shortcut(name, apple)
	return s === null ? label : label + ' (' + s.hint + ')'
}
