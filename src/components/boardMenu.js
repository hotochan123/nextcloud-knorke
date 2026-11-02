/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The board menu "⋯" (factory job 178): the board-wide actions for every
 * person who can see the board, in every mode and on a frozen board too.
 * Wide, the top bar shows them in its own menu [data-knorke-menu=board]
 * (named "More", after "Share"); narrow (≤ 600 px) they follow the
 * moderation entries in the overflow menu [data-knorke-menu=overflow]
 * (ModerationMenu.vue). boardMenuItems() is the one list both render, in
 * menu order; the jobs "Export as CSV", "Board as a file" and "Templates"
 * append their entries here.
 * - action entries {kind: 'action', key, label, icon}: an NcActionButton
 *   [data-knorke-action=<key>] that closes the menu and emits board-action
 *   with the key; export-png ("Save as image (PNG)") once the board is
 *   loaded; (job 200) right after it export-svg ("Save as SVG") and
 *   export-pdf ("Save as PDF…", job 207: a dialog asks for the page size),
 *   under the same condition, (job 205) then
 *   export-bpmn ("Save as BPMN"); (job 179) after
 *   them export-csv ("Save as CSV"), only for
 *   people who may edit the board (canEdit: board/mode.js canEdit of
 *   me.role, in every mode, on every device and on a frozen board too);
 *   (job 181) download-board ("Download board") after them for every person
 *   who can see the board (every role, guests, every mode, frozen too);
 *   (job 182) save-template right after it for an account with a template
 *   right (templateRight of route 28: 'suggest' "Suggest as template…",
 *   'save' "Save as template…" for admins; null – the guest page, an account
 *   of the Guests app, before the first answer, after an error – none) in
 *   every role and mode, frozen too; (job 180) insert-template ("Insert template…") while this person edits
 *   (mode edit, board not frozen), (job 181) insert-board-file ("Insert
 *   board file…") right after it, (job 205) insert-bpmn-file ("Insert BPMN
 *   file…") and (job 220) import-csv ("Import CSV…") as the last actions,
 *   under the same condition;
 *   (job 191) filter-tags ("Filter by tags…") first, for every person in
 *   every mode, frozen too, once the board has tags (tags)
 * - link entries {kind: 'link', key, label, href}: the legal links of the
 *   instance (legal.js legalLinks, [data-knorke-legal=<key>], a new tab),
 *   for guests since U9 and (job 228) for accounts too
 *
 * Job 228 (redesign header, docs/redesign/ P6): every entry carries its
 * group, the level of the menu "More" it stands on (ModerationMenu.vue): 'root',
 * 'export' (the submenu "Export": PNG, SVG, PDF, BPMN, CSV and the board
 * file), 'insert' (the submenu "Insert": template, board file, BPMN file, CSV)
 * or 'legal' (the submenu "Legal": the instance's links). On the root stand
 * filter-tags, save-template and (prop shortcuts, not in the narrow layout)
 * keyboard-shortcuts ("Keyboard shortcuts", the overview of job 145; the round
 * "?" button has [data-knorke-action=shortcuts]). The labels inside
 * a submenu leave out what its name says ("As SVG" under "Export").
 */
import { t } from '../util/l10n.js'
import { icons } from './icons.js'
import { legalLinks } from './legal.js'

/** (Job 182) The template rights of route 28 that bring save-template. */
export const TEMPLATE_RIGHTS = Object.freeze(['suggest', 'save'])

/** The action keys of the board menu, in menu order. */
export const BOARD_ACTIONS = Object.freeze(['filter-tags', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'download-board', 'save-template', 'insert-template', 'insert-board-file', 'insert-bpmn-file', 'import-csv', 'keyboard-shortcuts'])

/** (Job 228) The submenus of "More", in menu order. */
export const BOARD_SUBMENUS = Object.freeze(['export', 'insert', 'legal'])

/**
 * @typedef {{kind: 'action', key: string, label: string, icon: string, group: string}
 *          | {kind: 'link', key: string, label: string, href: string, group: string}} BoardMenuItem
 */

/**
 * The entries of the board menu (see the file comment).
 *
 * @param {{ready?: boolean, canEdit?: boolean, edit?: boolean, templateRight?: (string|null), guest?: boolean,
 *   legal?: (object|null), tags?: boolean, shortcuts?: boolean}} [o] (job 191) tags: the board has tags (filter-tags);
 *   ready: the board is loaded; canEdit: this person may edit the board (job 179: export-csv); edit: this person edits
 *   now (mode edit, board not frozen; job 180: insert-template, job 181: insert-board-file); templateRight: 'suggest'
 *   or 'save' of route 28 (job 182: save-template), else none; guest: the guest page (kept for the callers, job 228:
 *   the legal links follow `legal` on every page); legal: the initial state `legal` ({imprintUrl, privacyUrl});
 *   (job 228) shortcuts: "Keyboard shortcuts" on the root (not in the narrow layout)
 * @return {BoardMenuItem[]}
 */
export function boardMenuItems({ ready = false, canEdit = false, edit = false, templateRight = null, legal = null, tags = false, shortcuts = false } = {}) {
	const out = []
	const action = (group, key, label, icon) => out.push({ kind: 'action', key, label, icon, group })
	if (ready === true && tags === true) {
		action('root', 'filter-tags', t('knorke', 'Filter by tags…'), icons.tag)
	}
	if (ready === true) {
		action('export', 'export-png', t('knorke', 'As image (PNG)'), icons.image)
		action('export', 'export-svg', t('knorke', 'As SVG'), icons.image)
		action('export', 'export-pdf', t('knorke', 'As PDF…'), icons.image)
		action('export', 'export-bpmn', t('knorke', 'As BPMN'), icons.download)
		if (canEdit === true) {
			action('export', 'export-csv', t('knorke', 'As CSV'), icons.table)
		}
		action('export', 'download-board', t('knorke', 'Download board file'), icons.download)
		if (TEMPLATE_RIGHTS.includes(templateRight)) {
			action('root', 'save-template', saveTemplateLabel(templateRight), icons.board)
		}
	}
	if (ready === true && edit === true) {
		action('insert', 'insert-template', t('knorke', 'Template…'), icons.frame)
		action('insert', 'insert-board-file', t('knorke', 'Board file…'), icons.upload)
		action('insert', 'insert-bpmn-file', t('knorke', 'BPMN file…'), icons.upload)
		action('insert', 'import-csv', t('knorke', 'CSV…'), icons.table)
	}
	if (ready === true && shortcuts === true) {
		action('root', 'keyboard-shortcuts', t('knorke', 'Keyboard shortcuts'), icons.keyboard)
	}
	for (const l of legalLinks(legal)) {
		out.push({ kind: 'link', key: l.key, label: l.label, href: l.href, group: 'legal' })
	}
	return out
}

/**
 * (Job 182) The label of save-template in the board menu and the context menu.
 *
 * @param {string|null} right the template right of route 28
 * @return {string} "Save as template…" for admins ('save'), else "Suggest as template…"
 */
export function saveTemplateLabel(right) {
	return right === 'save' ? t('knorke', 'Save as template…') : t('knorke', 'Suggest as template…')
}
