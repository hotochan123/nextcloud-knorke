/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Parts most visitors never use (factory job 217): each lives in a lazy
 * chunk of its own (vite.config.js LAZY_AREAS, build/check-bundle.mjs
 * LAZY_CHUNKS) and comes in on first use, as the emoji list does:
 * - vector: save as SVG and PDF (scene/vectorContext.js, exportSvg.js,
 *   exportPdf.js), pdfDialog its page size dialog;
 * - bpmn: BPMN files (board/bpmnFile.js with util/xmlRead.js);
 * - csv: (job 220) CSV files as notes (board/csvFile.js);
 * - shapelib: importing own shape libraries (board/shapeImport.js),
 *   shapeLibDialog the dialog of an own library;
 * - admin: the admin section "Knorke" (admin/AdminSettings.vue);
 * - share: the share dialog with QR code, people search and link settings;
 * - aiDialog: (job 268) the window "Create with AI" with its preview;
 *   aiFlow (job 269) the layout of an AI flowchart, in the same chunk;
 * - search: (job 271) the board search, its panel with board/search.js;
 * - shortcuts: (job 271) the shortcuts overview (job 145) with its list;
 * - outline: (job 274) the board as an outline with board/outline.js.
 * - privateDialog, voteDialog, timerDialog: (job 275) the moderators' dialogs
 *   (private writing, voting, timer), one chunk.
 *
 * loadPart(name) runs the part's import() and keeps a loaded module (also
 * while it loads, so two calls share one request); a failed import is
 * forgotten, so the next call tries again. A failure (an old tab after an
 * update asks for a chunk that is gone) logs, shows the error toast
 * [data-knorke-toast=part-load-failed] and gives null; nothing is thrown.
 * Tests pass their own loaders and toast.
 */
import { defineAsyncComponent } from 'vue'
import { t } from './l10n.js'
import { showError } from './toast.js'

/** The import() of each part (the names of loadPart). */
export const PARTS = Object.freeze({
	vector: async () => {
		const [ctx, svg, pdf] = await Promise.all([import('../scene/vectorContext.js'), import('../scene/exportSvg.js'), import('../scene/exportPdf.js')])
		return { VectorContext: ctx.VectorContext, parseFont: ctx.parseFont, svgDocument: svg.svgDocument, pdfDocument: pdf.pdfDocument }
	},
	pdfDialog: () => import('../components/PdfExportDialog.vue'),
	bpmn: () => import('../board/bpmnFile.js'),
	csv: () => import('../board/csvFile.js'),
	shapelib: () => import('../board/shapeImport.js'),
	shapeLibDialog: () => import('../components/ShapeLibDialog.vue'),
	admin: () => import('../admin/AdminSettings.vue'),
	share: () => import('../components/ShareDialog.vue'),
	aiDialog: () => import('../components/AiDiagramDialog.vue'),
	aiFlow: () => import('../board/aiFlow.js'),
	search: () => import('../components/SearchPanel.vue'),
	shortcuts: () => import('../components/ShortcutsDialog.vue'),
	outline: () => import('../components/OutlineView.vue'),
	privateDialog: () => import('../components/PrivateWritingDialog.vue'),
	voteDialog: () => import('../components/VoteSetupDialog.vue'),
	timerDialog: () => import('../components/TimerDialog.vue'),
})

/** @type {WeakMap<object, Map<string, Promise<object|null>>>} loaded (or loading) parts per loader table */
const loaded = new WeakMap()

/**
 * @param {string} name a key of PARTS
 * @param {{loaders?: object, toast?: Function}} [opts] the loader table and the error toast (tests)
 * @return {Promise<object|null>} the part's module; null when it could not be loaded
 */
export function loadPart(name, { loaders = PARTS, toast = showError } = {}) {
	let parts = loaded.get(loaders)
	if (!parts) {
		parts = new Map()
		loaded.set(loaders, parts)
	}
	const known = parts.get(name)
	if (known) {
		return known
	}
	const load = loaders[name]
	const p = Promise.resolve()
		.then(() => {
			if (typeof load !== 'function') {
				throw new Error('unknown part ' + name)
			}
			return load()
		})
		.catch((err) => {
			parts.delete(name)
			console.error('[knorke] part ' + name + ' could not be loaded', err)
			toast(t('knorke', 'This part of Knorke could not be loaded. Reload the page.'), { hook: 'part-load-failed' })
			return null
		})
	parts.set(name, p)
	return p
}

/**
 * A component of a part (its default export), for a dialog the caller opens
 * only after loadPart(name) gave the module: the component then resolves at
 * once from the same promise.
 *
 * @param {string} name a key of PARTS whose module is a component
 * @return {object} async component
 */
export function partComponent(name) {
	return defineAsyncComponent(async () => {
		const m = await loadPart(name)
		if (!m) {
			throw new Error('part ' + name + ' could not be loaded')
		}
		return m.default
	})
}
