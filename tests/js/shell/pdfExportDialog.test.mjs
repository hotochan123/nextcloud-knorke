/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 207 (AK3, AK4): the dialog of "Save as PDF…"
 * (src/components/PdfExportDialog.vue), rendered in Node:
 * - [data-knorke-dialog=export-pdf], a group "Page size" with the radios
 *   A4, A3, "Size of the content" in this order, one name, the page of the
 *   prop checked (an unknown one: the content)
 * - the new strings in de.json
 * - the board view opens it through ui.onExportPdf and saves through
 *   session.exportVector(scope, 'pdf', {page})
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDF_PAGE_KEYS } from '../../../src/scene/exportPdf.js'
import { n, t } from '../../../src/util/l10n.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const PdfExportDialog = (await import('../../../src/components/PdfExportDialog.vue')).default

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

/** @param {object} props props @return {Promise<string>} SSR HTML without comments */
async function render(props) {
	const app = createSSRApp(PdfExportDialog, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return strip(await renderToString(app))
}

test('job 207 the dialog: three page sizes in order, one group, the given one checked; an unknown one is the content', async () => {
	for (const page of PDF_PAGE_KEYS) {
		const html = await render({ page })
		assert.match(html, /data-knorke-dialog="export-pdf"/)
		assert.match(html, /<legend>Page size<\/legend>/)
		const keys = [...html.matchAll(/data-knorke-pdf-page="([^"]+)"/g)].map((m) => m[1])
		assert.deepEqual(keys, ['a4', 'a3', 'content'])
		const names = new Set([...html.matchAll(/type="radio" name="([^"]+)"/g)].map((m) => m[1]))
		assert.equal(names.size, 1, 'one radio group')
		const checked = [...html.matchAll(/data-knorke-pdf-page="([^"]+)"[^>]*><input([^>]*)>/g)].filter((m) => /\schecked\b/.test(m[2])).map((m) => m[1])
		assert.deepEqual(checked, [page], page)
		assert.match(html, />A4<[\s\S]*>A3<[\s\S]*>Size of the content</)
	}
	assert.equal(setupOf(PdfExportDialog, { page: 'letter' }).bindings.choice.value, 'content')
	assert.equal(setupOf(PdfExportDialog, { page: 'a3' }).bindings.choice.value, 'a3')
})

test('job 207 the new strings are in de.json', () => {
	const de = JSON.parse(read('l10n/de.json')).translations
	assert.deepEqual(['Save as PDF…', 'Page size', 'A4', 'A3', 'Size of the content'].map((k) => de[k]), ['Als PDF speichern…', 'Seitengröße', 'A4', 'A3', 'Größe des Inhalts'])
	assert.equal(de['Save as PDF'], 'Als PDF speichern', 'the dialog title')
})

test('job 207 the board view: ui.onExportPdf opens the dialog, Save runs exportVector with the page, both give the canvas the focus', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /<PdfExportDialog v-if="pdfExport"\s+:page="pdfExport\.page"\s+@save="savePdf"\s+@close="closePdfExport" \/>/)
	assert.match(view, /onExportPdf: \(x\) => openPdfDialog\(x\)/)
	// job 217: the dialog is part of the lazy vector part: it opens once loaded; failing, the canvas gets the focus
	assert.match(view, /const PdfExportDialog = partComponent\('pdfDialog'\)/)
	const open = view.match(/async function openPdfDialog\(x\) \{[\s\S]*?\n\}/)?.[0] ?? ''
	assert.match(open, /if \(!x \|\| \(x\.scope !== 'board' && x\.scope !== 'selection'\)\) \{\s+pdfExport\.value = null\s+return\s+\}/)
	assert.match(open, /if \(await loadPart\('pdfDialog'\)\) \{\s+pdfExport\.value = x\s+\} else \{\s+nextTick\(\(\) => focusCanvasHost\(\)\)/)
	assert.match(view, /function savePdf\(page\) \{[\s\S]*?pdfExport\.value = null[\s\S]*?focusCanvasHost\(\)[\s\S]*?session\.value\?\.exportVector\(x\.scope, 'pdf', \{ page \}\)/)
	assert.match(view, /function closePdfExport\(\) \{\s+pdfExport\.value = null\s+nextTick\(\(\) => focusCanvasHost\(\)\)/)
	const dialog = read('src/components/PdfExportDialog.vue')
	assert.match(dialog, /@submit="\$emit\('save', choice\)"/, 'Save and Enter emit the choice')
	assert.match(dialog, /data-knorke-action="export-pdf-save"/)
	assert.match(dialog, /@keydown\.esc\.stop\.prevent="\$emit\('close'\)"/, 'Esc on a radio closes')
})
