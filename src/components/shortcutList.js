/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The contents of the shortcuts overview (factory job 145,
 * ShortcutsDialog.vue): groups with a heading and rows "label – keys". The
 * keys of every row come from the one formatter (util/shortcuts.js
 * shortcut), never as text of their own; a row with two names shows both
 * ("Esc / Ctrl+Enter").
 *
 * Mode edit: Tools, Edit, Selection, View, While writing (job 174: with the
 * keys of a table's cell editor), (job 195) Mind map (the keys at a focused
 * node), With mouse or pen.
 * Modes vote and view (a frozen board too): only the keys that work there,
 * View without zoom to selection (nothing is selected) and the wheel zoom.
 * Finger gestures (rows without keys): hold-then-drag only in mode edit, two
 * fingers in every mode; first on a device with a touch screen (job 161,
 * util/device.js hasTouchScreen), last on one without.
 *
 * Texts are translated at the call (the language of the moment).
 */
import { TOOLS } from '../model/tools.js'
import { t } from '../util/l10n.js'
import { shortcut } from '../util/shortcuts.js'
import { toolLabel } from './labels.js'

/**
 * @typedef {{name: string, hint: string, aria: string}} ShortcutKey
 * @typedef {{label: string, keys: ShortcutKey[]}} ShortcutRow
 * @typedef {{id: string, title: string, rows: ShortcutRow[]}} ShortcutGroup
 */

/**
 * The groups of the overview, in their order.
 *
 * @param {{mode?: string, apple?: boolean, touch?: boolean}} [o] mode: client mode ('edit' | 'vote' |
 *   'view'; the board shows 'view' while frozen); apple: Apple platform (util/device.js
 *   isApplePlatform); touch: the gestures come first
 * @return {ShortcutGroup[]} groups (ids tools, edit, selection, view, writing, mindmap, pointer, gestures)
 */
export function shortcutGroups({ mode = 'edit', apple = false, touch = false } = {}) {
	/**
	 * @param {string} label translated label
	 * @param {...string} names formatter names (util/shortcuts.js SHORTCUT_NAMES)
	 * @return {ShortcutRow} the row
	 */
	const row = (label, ...names) => ({ label, keys: names.map((name) => ({ name, ...shortcut(name, apple) })) })
	const edit = mode === 'edit'
	const groups = edit
		? [
			{
				id: 'tools',
				title: t('knorke', 'Tools'),
				rows: TOOLS.map((x) => row(toolLabel(x.id), x.id)),
			},
			{
				id: 'edit',
				title: t('knorke', 'Edit'),
				rows: [
					row(t('knorke', 'Undo'), 'undo'),
					row(t('knorke', 'Redo'), 'redo'),
					row(t('knorke', 'Copy'), 'copy'),
					row(t('knorke', 'Cut'), 'cut'),
					row(t('knorke', 'Paste'), 'paste'),
					row(t('knorke', 'Paste in place'), 'paste-in-place'),
					row(t('knorke', 'Duplicate'), 'duplicate'),
					row(t('knorke', 'Delete'), 'delete'),
					row(t('knorke', 'Edit text'), 'edit-text'),
					row(t('knorke', 'Group items'), 'group'),
					row(t('knorke', 'Ungroup'), 'ungroup'),
					row(t('knorke', 'Lock or unlock'), 'lock'),
					row(t('knorke', 'Add an item beside it'), 'neighbour'),
				],
			},
			{
				id: 'selection',
				title: t('knorke', 'Selection'),
				rows: [
					row(t('knorke', 'Select all'), 'select-all'),
					row(t('knorke', 'Select the next item'), 'next-item'),
					row(t('knorke', 'Select the previous item'), 'previous-item'),
					row(t('knorke', 'Clear the selection or cancel'), 'deselect'),
					row(t('knorke', 'Move the selection'), 'nudge'),
					row(t('knorke', 'Move the selection in big steps'), 'nudge-big'),
					row(t('knorke', 'Open the context menu'), 'context-menu'),
				],
			},
			{
				id: 'view',
				title: t('knorke', 'View'),
				rows: [
					row(t('knorke', 'Zoom in'), 'zoom-in'),
					row(t('knorke', 'Zoom out'), 'zoom-out'),
					row(t('knorke', 'Zoom to 100 %'), 'zoom-100'),
					row(t('knorke', 'Show everything'), 'fit'),
					row(t('knorke', 'Zoom to selection'), 'zoom-selection'),
					row(t('knorke', 'Show or hide the grid'), 'grid'),
					row(t('knorke', 'Show or hide other people\'s cursors'), 'cursors'),
					row(t('knorke', 'Stop following'), 'stop-following'),
					// job 271
					row(t('knorke', 'Search on the board'), 'search'),
					row(t('knorke', 'Keyboard shortcuts'), 'shortcuts'),
				],
			},
			{
				id: 'writing',
				title: t('knorke', 'While writing'),
				rows: [
					row(t('knorke', 'Finish editing'), 'end-edit', 'end-edit-mod'),
					row(t('knorke', 'Finish and start the next note to the right'), 'next-note'),
					// job 174: a table's cell editor
					row(t('knorke', 'Table: next or previous cell'), 'next-cell', 'previous-cell'),
					row(t('knorke', 'Table: neighbouring cell at the edge of the text'), 'cell-arrows'),
					// job 279: Markdown in notes, shapes, text items and cells
					row(t('knorke', 'Bold'), 'bold'),
					row(t('knorke', 'Italic'), 'italic'),
				],
			},
			{
				// job 195: at a focused node of a mind map
				id: 'mindmap',
				title: t('knorke', 'Mind map'),
				rows: [
					row(t('knorke', 'Add a child'), 'mm-child'),
					row(t('knorke', 'Add a sibling'), 'mm-sibling'),
					row(t('knorke', 'Go to the next node'), 'mm-arrows'),
					row(t('knorke', 'Edit the node'), 'mm-edit'),
					row(t('knorke', 'Delete the branch'), 'mm-delete'),
					row(t('knorke', 'While writing: a new line'), 'mm-break'),
				],
			},
			{
				id: 'pointer',
				title: t('knorke', 'With mouse or pen'),
				rows: [
					row(t('knorke', 'Drag: move the view'), 'hold-space'),
					row(t('knorke', 'Click: add to or remove from the selection'), 'hold-shift'),
					// job 190: Alt with the marquee
					row(t('knorke', 'Selection frame: only locked items'), 'hold-alt'),
					row(t('knorke', 'Scroll: zoom'), 'hold-mod'),
					row(t('knorke', 'Drag: no snapping'), 'hold-mod'),
					// job 279
					row(t('knorke', 'Click a link in a text: open it'), 'hold-mod'),
					row(t('knorke', 'Corner handle: keep or free the proportions'), 'hold-shift'),
					row(t('knorke', 'Rotate: 15° steps'), 'hold-shift'),
					row(t('knorke', 'Resize: from the centre'), 'hold-alt'),
				],
			},
		]
		: [
			{
				id: 'view',
				title: t('knorke', 'View'),
				rows: [
					row(t('knorke', 'Zoom in'), 'zoom-in'),
					row(t('knorke', 'Zoom out'), 'zoom-out'),
					row(t('knorke', 'Zoom to 100 %'), 'zoom-100'),
					row(t('knorke', 'Show everything'), 'fit'),
					row(t('knorke', 'Show or hide the grid'), 'grid'),
					row(t('knorke', 'Show or hide other people\'s cursors'), 'cursors'),
					row(t('knorke', 'Stop following'), 'stop-following'),
					// job 271
					row(t('knorke', 'Search on the board'), 'search'),
					row(t('knorke', 'Keyboard shortcuts'), 'shortcuts'),
				],
			},
			{
				id: 'pointer',
				title: t('knorke', 'With mouse or pen'),
				rows: [row(t('knorke', 'Scroll: zoom'), 'hold-mod')],
			},
		]
	const gestures = {
		id: 'gestures',
		title: t('knorke', 'Finger gestures'),
		rows: [
			...(edit ? [row(t('knorke', 'Hold a finger still, then drag: select several items'))] : []),
			row(t('knorke', 'Two fingers: zoom and move the view')),
		],
	}
	return touch ? [gestures, ...groups] : [...groups, gestures]
}
