/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 217: the parts most visitors never use (src/util/parts.js
 * PARTS), each one lazy chunk js/<area>-*.chunk.mjs. vite.config.js puts a
 * root and every module only the area imports into it; build/check-bundle.mjs
 * checks that the roots sit in that chunk and in no file a page loads at once.
 * Paths relative to the app root.
 */
export const LAZY_AREAS = Object.freeze({
	vector: Object.freeze(['src/scene/vectorContext.js', 'src/scene/exportSvg.js', 'src/scene/exportPdf.js', 'src/components/PdfExportDialog.vue']),
	bpmn: Object.freeze(['src/board/bpmnFile.js', 'src/util/xmlRead.js']),
	csv: Object.freeze(['src/board/csvFile.js']),
	shapelib: Object.freeze(['src/board/shapeImport.js', 'src/components/ShapeLibDialog.vue']),
	admin: Object.freeze(['src/admin/AdminSettings.vue', 'src/admin/ShapeLibAdmin.vue', 'src/admin/TemplateAdmin.vue']),
	share: Object.freeze(['src/components/ShareDialog.vue', 'src/components/SharePeople.vue', 'src/components/ShareLinks.vue', 'src/components/LinkSettings.vue', 'src/components/PresentLinkDialog.vue', 'src/components/QrCode.vue', 'src/components/qr.js']),
	shortcuts: Object.freeze(['src/components/ShortcutsDialog.vue', 'src/components/shortcutList.js']),
	search: Object.freeze(['src/components/SearchPanel.vue', 'src/board/search.js']),
	outline: Object.freeze(['src/components/OutlineView.vue', 'src/board/outline.js']),
	// factory job 275: the moderators' dialogs (private writing, voting, timer)
	moderate: Object.freeze(['src/components/PrivateWritingDialog.vue', 'src/components/VoteSetupDialog.vue', 'src/components/TimerDialog.vue']),
	ai: Object.freeze(['src/components/AiDiagramDialog.vue', 'src/components/aiPreview.js', 'src/board/aiFlow.js']),
})
