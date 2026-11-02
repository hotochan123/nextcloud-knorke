/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 180: the template dialog and the button of an empty board,
 * run in Node with ./sfc.mjs (@nextcloud/vue as stubs that render their
 * slots):
 * - TemplateDialog: an NcDialog "Insert template" [data-knorke-dialog=templates]
 *   that closes on a click beside it; four native buttons in the order retro,
 *   swot, kanban, brainstorm, [data-knorke-template=<key>], named by their
 *   name (aria-labelledby), described by their sentence; the sketch an SVG
 *   (aria-hidden) with one rect per frame and one coloured square per note,
 *   only numbers and palette colours; a tile emits insert with its key.
 *   Job 237: the tiles are labels around native radios that only pick
 *   ([data-knorke-picked]); "Insert" (ConfirmDialog) inserts the picked one,
 *   once, and stays off while nothing of the dialog is picked
 * - the board view: the dialog only with canInsert, its insert and close
 *   wired; (job 232) instead of the button "Start with a template" the
 *   start tiles [data-knorke=start-templates] (TemplateGrid mode start)
 *   only with canInsert and an empty board (ui.onEmpty), in the middle of
 *   the canvas, the layer letting the pointer through to it
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TEMPLATE_KEYS, templateOf, templateSketch } from '../../../src/board/templates.js'
import { n, t } from '../../../src/util/l10n.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()

const { createSSRApp, reactive } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const TemplateDialog = (await import('../../../src/components/TemplateDialog.vue')).default
const TemplateGrid = (await import('../../../src/components/TemplateGrid.vue')).default

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

/**
 * @param {object} props props of the component
 * @param {object} component (job 237) TemplateGrid unless named
 * @return {Promise<string>} its SSR HTML without comments
 */
async function renderGrid(props, component = TemplateGrid) {
	const app = createSSRApp(component, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

/** @return {Promise<string>} SSR HTML of the dialog without comments */
const render = () => renderGrid({}, TemplateDialog)

/** (job 237) @param {string} html rendered HTML @return {Array<{attrs: string, radio: string, inner: string}>} the picking tiles: label, its radio, the rest */
const tilesOf = (html) => [...html.matchAll(/<label([^>]*)><input([^>]*)>([\s\S]*?)<\/label>/g)].map((m) => ({ attrs: m[1], radio: m[2], inner: m[3] }))

test('job 180/237 TemplateDialog: NcDialog "Insert template" [data-knorke-dialog=templates] (ConfirmDialog, "Insert"), closing on a click beside it; four tiles in the order retro, swot, kanban, brainstorm, each a label around a native radio of one group, none picked', async () => {
	const html = await render()
	assert.match(html, /^<div data-stub="NcDialog"[^>]*name="Insert template"/)
	assert.match(html, /^<div data-stub="NcDialog"[^>]*data-knorke-dialog="templates"/)
	assert.match(html, /^<div data-stub="NcDialog"[^>]*close-on-click-outside/)
	assert.match(html, /^<div data-stub="NcDialog"[^>]*is-form/, 'Enter in the form submits like "Insert"')
	assert.match(read('src/components/TemplateDialog.vue'), /<ConfirmDialog :name="t\('knorke', 'Insert template'\)"\s+size="normal"\s+:confirm-label="t\('knorke', 'Insert'\)"\s+:confirm-disabled="picked === null"/)
	const tiles = tilesOf(html)
	assert.deepEqual(tiles.map((b) => /data-knorke-template="([^"]+)"/.exec(b.attrs)?.[1]), ['retro', 'swot', 'kanban', 'brainstorm'])
	for (const b of tiles) {
		assert.match(b.attrs, /^ class="knorke-templates__tile"/)
		assert.match(b.attrs, /data-knorke-picked="false"/)
		assert.match(b.radio, /^ type="radio" class="knorke-templates__radio" name="knorke-template-insert-pick" value="[a-z]+"/)
		assert.doesNotMatch(b.radio, /checked/)
	}
	assert.doesNotMatch(html, /<button[^>]*data-knorke-template=/, 'no tile is a button any more')
	assert.doesNotMatch(html, /data-knorke-template="blank"/, 'no "Blank" in the dialog')
	assert.doesNotMatch(read('src/components/TemplateDialog.vue'), /v-html/)
	assert.doesNotMatch(read('src/components/TemplateGrid.vue'), /v-html/)
})

test('job 180 TemplateDialog: each tile\'s radio is named by its name and described by its (job 237: visible) sentence; the sketch is aria-hidden, one rect per frame and one coloured square per note and (job 188) per pad, to scale', async () => {
	const html = await render()
	const tiles = tilesOf(html)
	TEMPLATE_KEYS.forEach((key, i) => {
		const b = tiles[i]
		const def = templateOf(key)
		const name = /aria-labelledby="([^"]+)"/.exec(b.radio)[1]
		const text = /aria-describedby="([^"]+)"/.exec(b.radio)[1]
		assert.match(b.inner, new RegExp(`<span id="${name}" class="knorke-templates__name">${def.name}</span>`), key + ': the name names it')
		assert.match(b.inner, new RegExp(`<span id="${text}" class="knorke-templates__text">${def.text.replace(/[?.;:]/g, '\\$&')}</span>`), key + ': the sentence describes it')
		// job 232: TemplateSketch draws it (SSR writes a child component's root attributes in lower case)
		assert.match(b.inner, /^<svg class="knorke-templates__sketch" viewBox="0 0 120 80" aria-hidden="true" focusable="false">/i)
		const sk = templateSketch(key)
		const frames = [...b.inner.matchAll(/<rect class="knorke-templates__frame" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"><\/rect>/g)].map((m) => m.slice(1).map(Number))
		assert.deepEqual(frames, sk.frames.map((f) => [f.x, f.y, f.w, f.h]), key + ': the frames')
		const notes = [...b.inner.matchAll(/<rect class="knorke-templates__note" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9a-f]{6})"><\/rect>/g)].map((m) => [...m.slice(1, 5).map(Number), m[5]])
		// job 188: the pad squares after the note squares
		assert.deepEqual(notes, [...sk.notes, ...sk.pads].map((s) => [s.x, s.y, s.size, s.size, s.fill]), key + ': the note and pad squares')
	})
	assert.equal(new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])).size, 8, 'unique ids')
	// job 237: the grid of the dialog keeps its sentences in sight (only "New board" hides them)
	assert.match(html, /<div class="knorke-templates__grid knorke-templates__grid--insert">/)
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	assert.doesNotMatch(css, /grid--insert \.knorke-templates__text/)
})

test('job 237 AK2: picking emits update:pick and inserts nothing; "Insert" stays off until a tile of the dialog is picked, then sends insert with the key or insert-own with the id, once', () => {
	// the grid: a tile picks (update:pick), never insert or insert-own
	const grid = read('src/components/TemplateGrid.vue')
	assert.match(grid, /const picking = props\.mode === 'pick' \|\| props\.mode === 'insert'/)
	assert.match(grid, /:checked="pick === e\.value"[\s\S]*?@change="\$emit\('update:pick', e\.value\)"/)
	assert.match(grid, /@click="picking \|\| choose\(e\)"/, 'a picking tile never runs choose')
	const dialog = read('src/components/TemplateDialog.vue')
	assert.match(dialog, /<TemplateGrid v-model:pick="pick"\s+mode="insert"\s+:own="own"\s+autofocus\s+@withdraw="\(e\) => \$emit\('withdraw', e\)"\s+@cancel="\$emit\('close'\)" \/>/)
	assert.doesNotMatch(dialog, /@insert(-own)?=/, 'the grid of the dialog inserts nothing itself')
	assert.match(dialog, /@confirm="insert"/)
	// nothing picked: "Insert" is off and submitting sends nothing
	let s = setupOf(TemplateDialog, { own: null })
	assert.equal(s.bindings.pick.value, null)
	assert.equal(s.bindings.picked.value, null)
	s.bindings.insert()
	assert.deepEqual(s.emitted, [])
	// a built-in tile: insert with its key, once (a second click on the closing dialog adds nothing)
	for (const key of TEMPLATE_KEYS) {
		s = setupOf(TemplateDialog, { own: null })
		s.bindings.pick.value = key
		assert.equal(s.bindings.picked.value, key)
		s.bindings.insert()
		s.bindings.insert()
		assert.deepEqual(s.emitted, [['insert', key]])
	}
	// an adopted tile: insert-own with its id
	const own = { state: 'ready', templates: [{ id: 17, name: 'A', sketch: [] }], pending: [{ id: 23, name: 'P', sketch: [] }] }
	s = setupOf(TemplateDialog, { own })
	s.bindings.pick.value = 'own:17'
	s.bindings.insert()
	assert.deepEqual(s.emitted, [['insert-own', 17]])
	// a value that is no tile of the dialog: "Insert" off (a suggestion, blank, junk)
	for (const v of ['own:23', 'blank', 'own:x', 'nope', '']) {
		s = setupOf(TemplateDialog, { own })
		s.bindings.pick.value = v
		assert.equal(s.bindings.picked.value, null, v)
		s.bindings.insert()
		assert.deepEqual(s.emitted, [], v)
	}
	// a picked own template that a new load of route 28 no longer lists: "Insert" off again
	const props = reactive({ own })
	s = setupOf(TemplateDialog, props)
	s.bindings.pick.value = 'own:17'
	assert.equal(s.bindings.picked.value, 'own:17')
	props.own = { state: 'ready', templates: [], pending: [] }
	assert.equal(s.bindings.picked.value, null)
	props.own = { state: 'error', templates: [], pending: [] }
	assert.equal(s.bindings.picked.value, null)
	s.bindings.insert()
	assert.deepEqual(s.emitted, [])
	// ConfirmDialog: the disabled button and its form submit nothing
	const confirm = read('src/components/ConfirmDialog.vue')
	assert.match(confirm, /:disabled="busy \|\| confirmDisabled"\s+data-knorke-action="confirm"/)
	assert.match(confirm, /function onSubmit\(\) \{\s+if \(!props\.busy && !props\.confirmDisabled\) \{\s+emit\('confirm'\)/)
})

test('job 237 AK1: a picked tile carries [data-knorke-picked=true] and its radio is checked, the others not', async () => {
	const html = await renderGrid({ mode: 'insert', pick: 'kanban', own: { state: 'ready', templates: [{ id: 17, name: 'A', sketch: [] }], pending: [] } })
	const tiles = tilesOf(html)
	assert.deepEqual(tiles.map((b) => [/data-knorke-(?:own-)?template="([^"]+)"/.exec(b.attrs)[1], /data-knorke-picked="(\w+)"/.exec(b.attrs)[1], / checked/.test(b.radio)]),
		[['retro', 'false', false], ['swot', 'false', false], ['kanban', 'true', true], ['brainstorm', 'false', false], ['17', 'false', false]])
	const own = await renderGrid({ mode: 'insert', pick: 'own:17', own: { state: 'ready', templates: [{ id: 17, name: 'A', sketch: [] }], pending: [] } })
	assert.match(own, /data-knorke-own-template="17" data-knorke-picked="true"><input type="radio" class="knorke-templates__radio" name="knorke-template-insert-pick" value="own:17" checked/)
	// the mark of "New board" holds in every mode
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	assert.match(css, /\nlabel\.knorke-templates__tile\[data-knorke-picked='true'\] \{\s+border-color: var\(--color-primary-element, #00679e\) !important;/)
})

test('job 180/237 AK3: Esc on a radio, "Cancel" and NcDialog\'s closing emit close, never insert; the first tile\'s radio gets the focus when it opens (unpicked)', () => {
	const dialog = read('src/components/TemplateDialog.vue')
	assert.match(dialog, /@cancel="\$emit\('close'\)">\s+<TemplateGrid/, 'ConfirmDialog\'s cancel: "Cancel", Esc, the close button, a click beside it')
	assert.match(dialog, /@cancel="\$emit\('close'\)" \/>\s+<\/ConfirmDialog>/, 'Esc on a radio (NcModal ignores Esc in an input)')
	const confirm = read('src/components/ConfirmDialog.vue')
	assert.match(confirm, /@update:open="onOpen"/)
	assert.match(confirm, /function onOpen\(open\) \{\s+if \(!open && !props\.busy\) \{\s+emit\('cancel'\)/)
	const grid = read('src/components/TemplateGrid.vue')
	assert.match(grid, /@change="\$emit\('update:pick', e\.value\)"\s+@keydown\.esc="\$emit\('cancel'\)"/)
	assert.match(grid, /onMounted\(async \(\) => \{\s+if \(props\.autofocus\) \{\s+await nextTick\(\)[\s\S]*?const first = picking \? buttons\[0\]\?\.querySelector\?\.\('input'\) : buttons\[0\]\s+first\?\.focus\?\.\(\)/)
	// the grid's setup: the tiles of the dialog in order, no "Blank"
	const { bindings } = setupOf(TemplateGrid, { mode: 'insert' })
	assert.deepEqual(bindings.entries.value.map((e) => e.key), TEMPLATE_KEYS)
	assert.equal(bindings.picking, true)
	assert.equal(setupOf(TemplateGrid, { mode: 'start' }).bindings.picking, false, 'the empty board\'s tiles stay buttons')
})

test('job 180 board view: the dialog only with canInsert (closing when it goes), insert and close wired; the button of an empty board with canInsert and ui.onEmpty', () => {
	const view = read('src/views/BoardView.vue')
	// job 182: the template suggestions (own, insert-own, withdraw) between them
	assert.match(view, /<TemplateDialog v-if="templatesOpen && canInsert"\s+(?::[a-z-]+="[^"]+"\s+)*@insert="insertTemplate"\s+(?:@[a-z-]+="[^"]+"\s+)*@close="closeTemplates" \/>/)
	assert.match(view, /watch\(canInsert, \(may\) => \{\s+if \(!may\) \{\s+templatesOpen\.value = false/)
	// job 232: the start tiles instead of the button
	assert.match(view, /<div v-if="startTiles" class="knorke-start" data-knorke="start-templates">\s+<h2 class="knorke-start__title">\s+\{\{ t\('knorke', 'Start with a template'\) \}\}\s+<\/h2>\s+<TemplateGrid mode="start"\s+:own="templateOwn"\s+@insert="insertTemplate"\s+@insert-own="insertOwnTemplate"\s+@blank="startBlank" \/>/)
	// (round 0) only with Select or Pan: a creating tool's click in the middle never lands on a tile (E64)
	assert.match(view, /const startTiles = computed\(\(\) => canInsert\.value && boardEmpty\.value === true && !startPick\.value && !startDone\.value && \(tool\.value === 'select' \|\| tool\.value === 'hand'\)\)/)
	assert.doesNotMatch(view, /start-template"/)
	assert.match(view, /onEmpty: \(x\) => \{ boardEmpty\.value = x === true \}/)
	assert.match(view, /onTemplates: \(\) => openTemplates\(\)/)
	assert.match(view, /async function insertTemplate\(key\) \{\s+templatesOpen\.value = false\s+await nextTick\(\)\s+if \(!session\.value\?\.insertTemplate\(key\)\) \{\s+focusCanvasHost\(\)/)
	// the tiles' layer is a direct child of the board, beside the canvas
	assert.match(view, /:aria-label="t\('knorke', 'Canvas'\)" \/>\s+<div v-if="startTiles"/)
})

test('job 180 CSS: the tiles at least 44 px high, native button resets, they fill their cells (Nextcloud\'s width: 130px on native buttons); (job 232) the start layer in the middle of the canvas lets the pointer through, only its tiles take it', () => {
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	const rule = (sel) => {
		const m = new RegExp('(?:^|\\n)' + sel.replace(/\./g, '\\.').replace(/\[/g, '\\[') + ' \\{([^}]*)\\}').exec(css)
		assert.ok(m, sel)
		return m[1]
	}
	const start = rule('.knorke-start')
	for (const d of [/position: absolute;/, /top: 50%;/, /left: 50%;/, /transform: translate\(-50%, -50%\);/, /max-width: calc\(100% - 2 \* \(3 \* var\(--knorke-gap\) \+ var\(--knorke-bar-h\)\)\);/, /max-height: 70%;/, /pointer-events: none;/]) {
		assert.match(start, d)
	}
	const tileOnCanvas = rule('.knorke-start button.knorke-templates__tile')
	assert.match(tileOnCanvas, /pointer-events: auto;/)
	assert.match(tileOnCanvas, /width: 184px !important;/)
	assert.match(rule('.knorke-start .knorke-templates__grid--start'), /overflow-y: auto;/)
	assert.match(rule('.knorke-board--narrow .knorke-start button.knorke-templates__tile'), /width: calc\(50% - 8px\) !important;/)
	const tile = rule('button.knorke-templates__tile,\nlabel.knorke-templates__tile')
	for (const d of [/min-height: var\(--knorke-touch\) !important;/, /(^|[;\s])width: 100% !important;/, /background: var\(--knorke-surface\) !important;/, /border: 1px solid [^;]+ !important;/, /border-radius: [^;]+ !important;/, /box-shadow: none !important;/]) {
		assert.match(tile, d)
	}
	assert.match(css, /--knorke-touch: 44px;/)
})
