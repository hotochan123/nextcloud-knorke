/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Export and file insert of a board session (factory job 253, moved out of
 * BoardSession.js): the methods below run on the session's state through
 * the host callbacks of the constructor (the pattern of FollowController,
 * follow.js, and CommentFeed, comments.js). BoardSession keeps a thin method
 * of the same name for each public one (BoardView, the menus and the tests
 * call them on the session), and this module never imports BoardSession.js.
 * Every callback reads the session at the time of the call: tests replace
 * download, downloadFile, commit … on the instance after the constructor.
 *
 * Job 178 (save as image): exportPng('board') saves the whole board (the
 * top bar's "⋯", every role and mode, frozen too), exportPng('selection')
 * the selection (the context menu's export-png, menuAction). The items,
 * the plan (reaction rows, the vote badges of sceneVoteState) and the
 * layout come from scene/exportImage.js, the picture from
 * scene.exportImage (a detached Konva group): never the camera, the LOD or
 * devicePixelRatio. Nothing to save: the info export-empty, no file. When
 * the scene gives no image, exactly one second try at s ÷ √2; when that
 * fails too, the error export-failed, no file. Else the Blob downloads as
 * exportFileName(board title, local date) (deps.downloadBlob,
 * util/download.js downloadBlob), and an image with s < 2 is followed by
 * the info export-scaled. A call while an export runs is ignored. No op,
 * no undo step. lastExport = {name, format, width, height, scale, scaled,
 * ids, bounds} of the last image that downloaded (format 'png'; bounds: the
 * content in world units, without the margin), null before.
 *
 * Job 200 (save as SVG or PDF): exportVector(scope, format) with format
 * 'svg' or 'pdf', from the top bar's "⋯" ('board') and the context menu's
 * export-svg and export-pdf ('selection', menuAction), for everyone and in
 * every mode like the PNG. The same items, plan and frame (bounds plus
 * EXPORT_MARGIN) as the PNG's, but never scaled down: scene.exportVector
 * draws vectors (KonvaRenderer.renderVector). Nothing to save: the info
 * export-empty, no file; a call while any image export runs is ignored; no
 * file from the scene: the error export-failed. Else the Blob downloads as
 * exportFileName(board title, local date, format). No op, no undo step.
 * lastExport = {name, format, width, height, scale, scaled: false, ids,
 * bounds}: width × height the frame in world units (SVG, scale 1) or the
 * page in pt (PDF, scale pt per unit).
 *
 * Job 207 (PDF page size): export-pdf of both menus goes through
 * openPdfExport(scope): a call while an export runs is ignored, nothing to
 * save gives export-empty, else ui.onExportPdf({scope, page}) opens the
 * shell's dialog (without that hook the PDF saves at once) with page =
 * pdfPage(), localStorage knorke.pdfPage ('a4', 'a3', 'content'; missing
 * or any other value: 'content'). Its "Save" calls exportVector(scope,
 * 'pdf', {page}), which stores a valid page first and hands it to the scene
 * (exportPdf.js pdfPage: A4 or A3 fitted, or the size of the content);
 * lastExport of a PDF names it as page.
 *
 * Job 179 (save as CSV): exportBoardCsv('board') saves the whole board
 * (the top bar's "⋯"), exportBoardCsv('selection') the selection with the
 * content of its frames (the context menu's export-csv, menuAction); only
 * while canEdit(me.role), in every mode and on a frozen board too, else
 * nothing (no file, no toast). The items are exportIds' (as the image's),
 * the rows, their order and fields board/exportCsv.js's, the votes those of
 * the last finished vote (closedVotes of the VoteState). No row: the info
 * export-empty, no file. Else the text downloads as exportFileName(board
 * title, local date, 'csv') (deps.download). The separator is
 * csvSeparator(language) (deps.language, default util/l10n.js language),
 * for the table's "Export as CSV" too. No op, no undo step.
 *
 * Job 180 (templates, board/templates.js): insertTemplate(key) pastes the
 * template's set (templatePayload) with actions.pasteItems at the viewport
 * centre, only in mode edit on a board that is not frozen: one commit (one
 * undo step), then exactly the new frames are selected, the camera shows
 * their union with the title band (zoomToRect, like "Zoom to selection":
 * it zooms in too and ends following), below the top chrome and the
 * context bar of the new selection (reserveTop with ui.viewTop, job 143),
 * and the canvas gets the focus. A full
 * board: the toast "This board is full.", nothing pasted. Existing items get
 * no op. The context menu's insert-template asks the shell for the dialog
 * (ui.onTemplates). ui.onEmpty(empty) says whether the local model holds no
 * item: after loading and at every change (own ops, server changes, undo,
 * resync), only when it changes.
 *
 * Job 181 (board as a file, board/boardFile.js): exportBoardFile() (the
 * top bar's "Download board", every role and mode, frozen too) downloads
 * the whole local model as "<board title>.knorke" (boardFileName), a Blob of
 * type application/octet-stream through deps.downloadBlob; an empty model:
 * the info export-empty, no file. No op, no undo step.
 * insertBoardFile(text) works only in mode edit, on a board that is not
 * frozen and that this person may edit (else false, no message): the text
 * goes through boardFile.js readBoardFile, then actions.pasteItems at the
 * viewport centre with board null (new ids, groups and connector ends as
 * for a paste). An invalid file (or null, a file over BOARD_FILE_MAX_BYTES
 * the shell did not read, one without an item that passes, or one whose
 * paste has no op left) toasts board-file-invalid, more checked items than
 * limits.maxItems board-file-full, and nothing goes out. Else one commit
 * (one undo step), the new roots and connectors are selected, the camera
 * moves (zoomToRect of their hull, reserveTop with ui.viewTop) only when
 * the hull is not wholly in viewportWorld(), and the canvas gets the focus.
 * The board's title stays. Job 187: single items that fail the check (an
 * unknown type of a newer version, a double id, a broken value) are left
 * out like in a clipboard paste: a connector at one of them drops, the
 * rest of a group of two or more stays a group, a frame's child becomes a
 * root. The left-out items and dropped connectors are counted in the
 * clipboard's toast "%n items could not be pasted." (board-file-skipped).
 *
 * Job 182 (template suggestions, board/ownTemplates.js): templateDraft('board')
 * (the top bar's "Suggest as template…" / "Save as template…", every role
 * and mode, frozen too) and
 * templateDraft('selection') (the context menu's save-template, menuAction:
 * the draft goes to the shell through ui.onSaveTemplate, the dialog takes
 * the focus) capture the content at the click, only for accounts (mode
 * user, else null without a message): a board file with title "" and its
 * sketch, plus the name the dialog starts with (the board title cut to 100
 * characters). Nothing to save: the info export-empty; more than 1000
 * objects or 2 MiB: the toast template-too-large; null then, no dialog.
 * No op, no undo step. insertOwnTemplate(content) inserts a loaded
 * template like insertBoardFile (mode edit, not frozen, canEdit; readBoardFile;
 * one commit, the new roots and connectors selected, the camera only when
 * they are not wholly in view, the canvas focused) with its own toasts
 * template-invalid and template-full ({max}). Job 192: like a board file
 * since job 187, single items that fail the check are left out and the
 * rest goes in; the left-out items and dropped connectors are counted in
 * the toast "%n items could not be pasted." (template-skipped).
 *
 * Job 205 (BPMN files, board/bpmnFile.js): exportBpmn(scope) from the top
 * bar's "⋯" ('board') and the context menu's export-bpmn ('selection',
 * menuAction), for everyone and in every mode like the SVG, with exportIds'
 * items: no BPMN shape among them → the info bpmn-empty, no file; else
 * bpmnXml downloads as exportFileName(board title, local date, 'bpmn'), a
 * Blob of type application/octet-stream. A call while an image export runs
 * is ignored. No op, no undo step. insertBpmnFile(text) inserts like
 * insertBoardFile (mode edit, not frozen, canEdit; one commit, selected, the
 * camera only when needed, the canvas focused), reading the text with
 * bpmnFile.js readBpmnFile, with the toasts bpmn-file-invalid,
 * bpmn-file-full ({max}) and bpmn-file-skipped (elements Knorke has no shape
 * for, and items the check left out).
 *
 * Job 217 (rarely used parts on first use, util/parts.js): exportVector
 * loads the part vector after its checks, exportBpmn and insertBpmnFile the
 * part bpmn (insertBpmnFile only when the file may be inserted at all),
 * through part(name) over deps.parts; both BPMN calls are async now. A part
 * that does not load: false, only the toast part-load-failed (no
 * export-failed), exporting free again.
 *
 * Job 220 (CSV files, board/csvFile.js, the lazy part csv):
 * insertCsvFile(bytes) works like insertBpmnFile (mode edit, not frozen,
 * canEdit, else false without a message; the part loads only then):
 * readCsvFile finds the encoding and the separator, then the text becomes
 * notes like cells pasted from a spreadsheet (pasteNotes with the
 * separator), centred in the viewport, one undo step, selected, the canvas
 * focused, the camera stays. Toasts csv-file-invalid (also null, a file
 * over CSV_FILE_MAX_BYTES), csv-file-spreadsheet (.xlsx, .ods, .xls),
 * csv-file-empty (no note), csv-file-cut (more than PASTE_NOTES_MAX notes);
 * above NOTES_ASK notes ui.onConfirm asks "Insert {n} notes?".
 */
import { FRAME_TITLE_BAND } from '../model/tokens.js'
import { csvFileName, csvSeparator, tableCsv } from '../model/table.js'
import { selectionFrame } from '../model/transform.js'
import { PDF_PAGE_KEYS, exportBounds, exportFileName, exportIds, exportLayout, exportPlan } from '../scene/exportImage.js'
import { n, t } from '../util/l10n.js'
import { loadPart } from '../util/parts.js'
import { keys } from '../util/storage.js'
import * as actions from './actions.js'
import { BOARD_FILE_TYPE, BPMN_FILE_EXT, BPMN_FILE_TYPE, boardFileName, boardFileText, readBoardFile } from './boardFile.js'
import { boardCsv, closedVotes, csvRows } from './exportCsv.js'
import { canEdit } from './mode.js'
import { TEMPLATE_MAX_BYTES, TEMPLATE_MAX_ITEMS, templateDraft as ownTemplateDraft, templateName } from './ownTemplates.js'
import { templatePayload } from './templates.js'

/** The session's fields the host gives as functions without arguments (read at the call). */
export const FILES_STATE = Object.freeze(['model', 'scene', 'destroyed', 'board', 'selection', 'limits', 'viewOnly', 'sync', 'frozen', 'clientMode', 'ui', 'storage', 'me', 'voteState', 'parts', 'mode', 'boardId', 'exporting'])

/** The session's methods the host hands over under the same name (looked up on the session at the call). */
export const FILES_CALLS = Object.freeze(['actionFailed', 'boardTags', 'boundsOf', 'commit', 'download', 'downloadFile', 'exportVector', 'focusCanvas', 'guard', 'info', 'knownItem', 'language', 'pasteNotes', 'reserveTop', 'sceneVoteState', 'select', 'toast', 'viewTop', 'viewportCenter', 'viewportWorld', 'wall', 'withPasteTags', 'zoomToRect'])

export class SessionFiles {
	/**
	 * @param {object} h host: one function per name of FILES_STATE and FILES_CALLS, plus
	 *   setExporting(on) and setLastExport(last), the session's fields exporting and lastExport
	 */
	constructor(h) {
		this.h = h
	}

	/**
	 * "Export as CSV": the table as it is known (model/table.js tableCsv) as
	 * "<board title> - Table.csv" (csvFileName), with the separator of the
	 * language (job 179, csvSep). No op, no undo step.
	 *
	 * @param {string} id table
	 * @return {boolean} the download started
	 */
	exportCsv(id) {
		const h = this.h
		const it = h.knownItem(id)
		if (it?.t !== 'table') {
			return false
		}
		try {
			return h.download(csvFileName(h.board()?.title), tableCsv(it, this.csvSep())) !== false
		} catch (e) {
			h.actionFailed(e)
			return false
		}
	}

	/** @return {';'|','} (job 179) the CSV separator of the language (model/table.js csvSeparator) */
	csvSep() {
		const h = this.h
		return csvSeparator(h.language())
	}

	/**
	 * (Job 179) "Save as CSV": the whole board or the selection as a CSV
	 * file (see the file comment). Never an op, never an undo step.
	 *
	 * @param {'board'|'selection'} scope what goes into the file
	 * @return {boolean} a file downloaded
	 */
	exportBoardCsv(scope) {
		const h = this.h
		const m = h.model()
		if (!m || h.destroyed() || !canEdit(h.me()?.role)) {
			return false
		}
		const rows = csvRows(m, exportIds(m, scope === 'selection' ? h.selection() : null), closedVotes(h.voteState()), h.boardTags())
		if (rows.length === 0) {
			h.info(t('knorke', 'There is nothing on the board to save.'), { hook: 'export-empty' })
			return false
		}
		try {
			return h.download(exportFileName(h.board()?.title, new Date(h.wall()), 'csv'), boardCsv(rows, this.csvSep())) !== false
		} catch (e) {
			h.actionFailed(e)
			return false
		}
	}

	/**
	 * (Job 178) "Save as image (PNG)": the whole board or the selection as a
	 * PNG (see the file comment). Never an op, never an undo step.
	 *
	 * @param {'board'|'selection'} scope what goes into the image
	 * @return {Promise<boolean>} a file downloaded
	 */
	async exportPng(scope) {
		const h = this.h
		const m = h.model()
		if (h.exporting() || !m || !h.scene()) {
			return false
		}
		const ids = exportIds(m, scope === 'selection' ? h.selection() : null)
		if (ids.length === 0) {
			h.info(t('knorke', 'There is nothing on the board to save.'), { hook: 'export-empty' })
			return false
		}
		h.setExporting(true)
		try {
			const plan = exportPlan(m, ids, h.sceneVoteState())
			const bounds = exportBounds(m, ids, plan)
			let lay = exportLayout(bounds)
			let blob = null
			// no image from the browser: exactly one second try at s ÷ √2
			for (let i = 0; i < 2 && !blob && !h.destroyed(); i++) {
				if (i > 0) {
					lay = exportLayout(bounds, lay.scale / Math.SQRT2)
				}
				try {
					blob = await h.scene().exportImage({ ids, plan, ...lay })
				} catch (e) {
					console.error('[knorke] exportImage failed', e)
				}
			}
			if (h.destroyed()) {
				return false
			}
			const name = exportFileName(h.board()?.title, new Date(h.wall()))
			if (!blob || h.downloadFile(name, blob) === false) {
				h.toast(t('knorke', 'The image could not be saved.'), { hook: 'export-failed' })
				return false
			}
			h.setLastExport({ name, format: 'png', width: lay.width, height: lay.height, scale: lay.scale, scaled: lay.scaled, ids, bounds })
			if (lay.scaled) {
				h.info(t('knorke', 'The board is too large for a sharp image in this browser. The image was saved smaller.'), { hook: 'export-scaled' })
			}
			return true
		} finally {
			h.setExporting(false)
		}
	}

	/**
	 * (Job 200) "Save as SVG" and "Save as PDF": the whole board or the
	 * selection as vectors (see the file comment). Never an op, never an
	 * undo step.
	 *
	 * @param {'board'|'selection'} scope what goes into the file
	 * @param {'svg'|'pdf'} format the file type
	 * @param {{page?: string}} [opts] (job 207) page: the PDF's page size (PDF_PAGE_KEYS), stored for the next
	 *   time; missing or unknown: 'content', nothing stored
	 * @return {Promise<boolean>} a file downloaded
	 */
	async exportVector(scope, format, { page } = {}) {
		const h = this.h
		const m = h.model()
		if (h.exporting() || !m || !h.scene() || (format !== 'svg' && format !== 'pdf')) {
			return false
		}
		const paper = format === 'pdf' && PDF_PAGE_KEYS.includes(page) ? page : 'content'
		if (format === 'pdf' && paper === page) {
			h.storage().setItem('local', keys.pdfPage(), paper)
		}
		const ids = exportIds(m, scope === 'selection' ? h.selection() : null)
		if (ids.length === 0) {
			h.info(t('knorke', 'There is nothing on the board to save.'), { hook: 'export-empty' })
			return false
		}
		h.setExporting(true)
		try {
			// job 217: the vector part comes on first use; failing, only its toast
			if (!(await this.part('vector')) || h.destroyed()) {
				return false
			}
			const plan = exportPlan(m, ids, h.sceneVoteState())
			const bounds = exportBounds(m, ids, plan)
			const { frame } = exportLayout(bounds)
			let file = null
			try {
				file = await h.scene().exportVector(format === 'pdf' ? { ids, plan, frame, format, page: paper } : { ids, plan, frame, format })
			} catch (e) {
				console.error('[knorke] exportVector failed', e)
			}
			if (h.destroyed()) {
				return false
			}
			const name = exportFileName(h.board()?.title, new Date(h.wall()), format)
			if (!file?.blob || h.downloadFile(name, file.blob) === false) {
				h.toast(t('knorke', 'The image could not be saved.'), { hook: 'export-failed' })
				return false
			}
			const last = { name, format, width: file.width, height: file.height, scale: file.scale, scaled: false, ids, bounds }
			if (format === 'pdf') {
				last.page = paper
			}
			h.setLastExport(last)
			return true
		} finally {
			h.setExporting(false)
		}
	}

	/**
	 * (Job 207) The page size "Save as PDF…" starts with.
	 *
	 * @return {string} localStorage knorke.pdfPage when it is a PDF_PAGE_KEYS key, else 'content'
	 */
	pdfPage() {
		const h = this.h
		const stored = h.storage().getItem('local', keys.pdfPage())
		return PDF_PAGE_KEYS.includes(stored) ? stored : 'content'
	}

	/**
	 * (Job 207) "Save as PDF…" of the board menu ('board') or the context
	 * menu ('selection'): the shell's dialog asks for the page size (see the
	 * file comment).
	 *
	 * @param {'board'|'selection'} scope what goes into the file
	 * @return {boolean} the dialog opened, or the PDF is being saved
	 */
	openPdfExport(scope) {
		const h = this.h
		const m = h.model()
		if (h.exporting() || !m || !h.scene()) {
			return false
		}
		if (exportIds(m, scope === 'selection' ? h.selection() : null).length === 0) {
			h.info(t('knorke', 'There is nothing on the board to save.'), { hook: 'export-empty' })
			return false
		}
		const page = this.pdfPage()
		if (h.ui().onExportPdf) {
			h.ui().onExportPdf({ scope, page })
		} else {
			h.exportVector(scope, 'pdf', { page })
		}
		return true
	}

	/**
	 * (Job 180) Inserts a template (see the file comment): its frames and
	 * notes at the viewport centre, one undo step, the new frames selected
	 * and shown with their title band, the canvas focused.
	 *
	 * @param {string} key board/templates.js TEMPLATE_KEYS
	 * @return {boolean} the template was inserted
	 */
	insertTemplate(key) {
		const h = this.h
		if (h.clientMode() !== 'edit' || h.viewOnly() || h.frozen() || !h.model() || !h.sync()) {
			return false
		}
		const payload = templatePayload(key)
		if (!payload) {
			return false
		}
		let done = false
		h.guard(() => {
			const r = actions.pasteItems(h.model(), payload, { at: h.viewportCenter(), limits: h.limits(), board: h.boardId() })
			if (r.full) {
				h.toast(t('knorke', 'This board is full.'))
				return
			}
			if (r.ops.length === 0) {
				return
			}
			h.commit(r, { urgent: true })
			// the roots of the set: exactly the new frames
			const frames = r.selectIds.filter((id) => h.model().get(id)?.t === 'frame')
			h.select(frames)
			const b = h.boundsOf(frames)
			if (b) {
				// the title bands below the top chrome and the context bar of the new selection
				h.zoomToRect(h.reserveTop({ x: b.x, y: b.y - FRAME_TITLE_BAND, w: b.w, h: b.h + FRAME_TITLE_BAND }, h.viewTop()))
			}
			h.focusCanvas()
			done = true
		})
		return done
	}

	/**
	 * (Job 205) "Save as BPMN": the BPMN diagram of the whole board or of the
	 * selection (see the file comment). Never an op, never an undo step.
	 *
	 * (Job 217) The BPMN part comes on first use (util/parts.js); failing,
	 * only its toast part-load-failed.
	 *
	 * @param {'board'|'selection'} scope what goes into the file
	 * @return {Promise<boolean>} a file downloaded
	 */
	async exportBpmn(scope) {
		const h = this.h
		if (h.exporting() || !h.model() || h.destroyed()) {
			return false
		}
		const bpmn = await this.part('bpmn')
		const m = h.model()
		if (!bpmn || h.exporting() || !m || h.destroyed()) {
			return false
		}
		try {
			const text = bpmn.bpmnXml(m, exportIds(m, scope === 'selection' ? h.selection() : null))
			if (text === null) {
				h.info(t('knorke', 'There is no BPMN diagram to save.'), { hook: 'bpmn-empty' })
				return false
			}
			const name = exportFileName(h.board()?.title, new Date(h.wall()), BPMN_FILE_EXT)
			return h.downloadFile(name, new Blob([text], { type: BPMN_FILE_TYPE })) !== false
		} catch (e) {
			h.actionFailed(e)
			return false
		}
	}

	/**
	 * (Job 181) "Download board": the whole board as a ".knorke" file (see
	 * the file comment). Never an op, never an undo step.
	 *
	 * @return {boolean} a file downloaded
	 */
	exportBoardFile() {
		const h = this.h
		const m = h.model()
		if (!m || h.destroyed()) {
			return false
		}
		if (m.size === 0) {
			h.info(t('knorke', 'There is nothing on the board to save.'), { hook: 'export-empty' })
			return false
		}
		try {
			const title = h.board()?.title ?? ''
			const blob = new Blob([boardFileText(m, title, h.boardTags())], { type: BOARD_FILE_TYPE })
			return h.downloadFile(boardFileName(title), blob) !== false
		} catch (e) {
			h.actionFailed(e)
			return false
		}
	}

	/**
	 * (Job 182) "Suggest as template…": the content of the whole board or the
	 * selection as it is now (see the file comment). Never an op, never an
	 * undo step.
	 *
	 * @param {'board'|'selection'} scope what goes into the template
	 * @return {{scope: string, content: string, sketch: Array, name: string}|null} the draft for the save dialog;
	 *   null: no account, nothing to save (export-empty) or too large (template-too-large)
	 */
	templateDraft(scope) {
		const h = this.h
		const m = h.model()
		if (!m || h.destroyed() || h.mode() !== 'user') {
			return null
		}
		const d = ownTemplateDraft(m, scope, scope === 'selection' ? h.selection() : null, h.boardTags())
		if (!d.ok) {
			if (d.reason === 'empty') {
				h.info(t('knorke', 'There is nothing on the board to save.'), { hook: 'export-empty' })
			} else {
				h.toast(t('knorke', 'This is too large for a template: at most {items} items and {mb} MB.', { items: TEMPLATE_MAX_ITEMS, mb: TEMPLATE_MAX_BYTES / 1048576 }), { hook: 'template-too-large' })
			}
			return null
		}
		return { scope: scope === 'selection' ? 'selection' : 'board', content: d.content, sketch: d.sketch, name: templateName(h.board()?.title) }
	}

	/**
	 * (Jobs 181, 187) Inserts the items of a board file (see the file
	 * comment): the items that pass, at the viewport centre, one undo step,
	 * selected, the canvas focused; how many were left out says the toast
	 * board-file-skipped.
	 *
	 * @param {string|null} text the file's text; null: a file over BOARD_FILE_MAX_BYTES (not read, invalid)
	 * @return {boolean} the items were inserted
	 */
	insertBoardFile(text) {
		const h = this.h
		return this.pasteBoardFile(text, {
			invalid: () => h.toast(t('knorke', 'This file is not a valid Knorke board file.'), { hook: 'board-file-invalid' }),
			full: (max) => h.toast(t('knorke', 'The board file does not fit: a board holds at most {max} items.', { max }), { hook: 'board-file-full' }),
			skipped: (lost) => h.toast(n('knorke', '%n item could not be pasted.', '%n items could not be pasted.', lost), { hook: 'board-file-skipped' }),
		})
	}

	/**
	 * (Job 205) Inserts a .bpmn file (see the file comment): like a board
	 * file, read by bpmnFile.js readBpmnFile, with the toasts
	 * bpmn-file-invalid, bpmn-file-full and bpmn-file-skipped. (Job 217) The
	 * BPMN part comes on first use, only when the file may be inserted at all;
	 * failing, only its toast part-load-failed.
	 *
	 * @param {string|null} text the file's text; null: a file over BPMN_FILE_MAX_BYTES (not read, invalid)
	 * @return {Promise<boolean>} the items were inserted
	 */
	async insertBpmnFile(text) {
		const h = this.h
		if (!this.mayInsertFile()) {
			return false
		}
		const bpmn = await this.part('bpmn')
		if (!bpmn) {
			return false
		}
		return this.pasteBoardFile(text, {
			invalid: () => h.toast(t('knorke', 'This file is not a BPMN diagram that Knorke can read.'), { hook: 'bpmn-file-invalid' }),
			full: (max) => h.toast(t('knorke', 'The BPMN file does not fit: a board holds at most {max} items.', { max }), { hook: 'bpmn-file-full' }),
			skipped: (lost) => h.toast(n('knorke', '%n item could not be pasted.', '%n items could not be pasted.', lost), { hook: 'bpmn-file-skipped' }),
		}, bpmn.readBpmnFile)
	}

	/**
	 * (Job 220) Inserts a CSV file as notes (see the file comment).
	 *
	 * @param {Uint8Array|null} bytes the file; null: a file over CSV_FILE_MAX_BYTES (not read, invalid)
	 * @return {Promise<boolean>} notes were inserted
	 */
	async insertCsvFile(bytes) {
		const h = this.h
		const may = () => !h.destroyed() && this.mayInsertFile()
		if (!may()) {
			return false
		}
		const csv = await this.part('csv')
		if (!csv || !may()) {
			return false
		}
		const r = csv.readCsvFile(bytes)
		if (!r.ok) {
			if (r.error === 'spreadsheet') {
				h.toast(t('knorke', 'Excel and OpenDocument files can\'t be read here. Save the table as CSV first.'), { hook: 'csv-file-spreadsheet' })
			} else {
				h.toast(t('knorke', 'This file is not a CSV or text file that Knorke can read.'), { hook: 'csv-file-invalid' })
			}
			return false
		}
		const done = await h.pasteNotes(r.text, {
			at: () => h.viewportCenter(),
			sep: r.sep,
			may,
			ask: (count) => ({ name: t('knorke', 'Insert {n} notes?', { n: count }), confirmLabel: t('knorke', 'Insert') }),
			cut: () => h.toast(t('knorke', 'Only the first {n} notes were inserted.', { n: actions.PASTE_NOTES_MAX }), { hook: 'csv-file-cut' }),
			empty: () => h.toast(t('knorke', 'This file has no text to insert.'), { hook: 'csv-file-empty' }),
		})
		if (done) {
			h.focusCanvas()
		}
		return done
	}

	/**
	 * (Jobs 182, 192) Inserts the content of an adopted template (see the
	 * file comment): like a board file, with the toasts template-invalid,
	 * template-full and template-skipped.
	 *
	 * @param {string|null} content the template's content (route 30)
	 * @return {boolean} the items were inserted
	 */
	insertOwnTemplate(content) {
		const h = this.h
		return this.pasteBoardFile(content, {
			invalid: () => h.toast(t('knorke', 'This template cannot be inserted.'), { hook: 'template-invalid' }),
			full: (max) => h.toast(t('knorke', 'The template does not fit: a board holds at most {max} items.', { max }), { hook: 'template-full' }),
			skipped: (lost) => h.toast(n('knorke', '%n item could not be pasted.', '%n items could not be pasted.', lost), { hook: 'template-skipped' }),
		})
	}

	/**
	 * (Job 217) A lazy part (util/parts.js loadPart over deps.parts), its
	 * failure shown through this session's toast.
	 *
	 * @param {string} name key of PARTS
	 * @return {Promise<object|null>} the part's module; null when it could not be loaded
	 */
	part(name) {
		const h = this.h
		return loadPart(name, { loaders: h.parts(), toast: h.toast })
	}

	/**
	 * @return {boolean} a file (board file, own template, .bpmn) may be inserted now: mode edit, not frozen, may edit
	 */
	mayInsertFile() {
		const h = this.h
		return h.clientMode() === 'edit' && !h.viewOnly() && !h.frozen() && canEdit(h.me()?.role) && !!h.model() && !!h.sync()
	}

	/**
	 * The insert of a board file and of an own template (jobs 181, 182, 187,
	 * 192), and (job 205) of a .bpmn file: only in mode edit on a board that is
	 * not frozen and may be edited (else false, no message); readBoardFile (or
	 * the reader given), one commit, selected, the
	 * camera only when the items are not wholly in view, the canvas focused.
	 * The items that pass go in, and say.skipped gets the count of the
	 * left-out items and dropped connectors.
	 *
	 * @param {string|null} text the board file's text
	 * @param {{invalid: () => void, full: (max: number) => void, skipped: (lost: number) => void}} say the toasts of the caller
	 * @param {Function} [read] the reader of the text (boardFile.js readBoardFile, bpmnFile.js readBpmnFile)
	 * @return {boolean} the items were inserted
	 */
	pasteBoardFile(text, { invalid, full, skipped }, read = readBoardFile) {
		const h = this.h
		if (!this.mayInsertFile()) {
			return false
		}
		const f = read(text, { size: h.model().size, limits: h.limits() })
		if (!f.ok) {
			if (f.reason === 'full') {
				full(f.max)
			} else {
				invalid()
			}
			return false
		}
		let done = false
		// job 191: the file's tags first (one add for the missing ones), then the items
		const paste = (tagMap) => {
			if (h.clientMode() !== 'edit' || h.viewOnly() || h.frozen() || !h.model() || !h.sync()) {
				return false
			}
			const r = actions.pasteItems(h.model(), f.payload, { at: h.viewportCenter(), limits: h.limits(), board: null, tagMap })
			if (r.full) {
				full(actions.maxItemsOf(h.limits()))
				return false
			}
			if (r.ops.length === 0) {
				// nothing left to insert
				invalid()
				return false
			}
			h.commit(r, { urgent: true })
			h.select(r.selectIds)
			const hull = selectionFrame(h.model(), r.selectIds)
			const v = h.viewportWorld()
			if (hull && v && !(hull.x >= v.x && hull.y >= v.y && hull.x + hull.w <= v.x + v.w && hull.y + hull.h <= v.y + v.h)) {
				// below the top chrome and the context bar of the new selection, like a template
				h.zoomToRect(h.reserveTop({ x: hull.x, y: hull.y, w: hull.w, h: hull.h }, h.viewTop()))
			}
			h.focusCanvas()
			const lost = f.skipped + r.skipped
			if (lost > 0) {
				skipped(lost)
			}
			return true
		}
		h.guard(() => {
			done = h.withPasteTags(f.payload, paste)
		})
		return done
	}
}
