/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 182 (template suggestions) in the shell, run in Node with
 * ./sfc.mjs (@nextcloud/vue as stubs that render their default slots):
 * - AK10 the board menu: save-template right after download-board with a
 *   template right ('suggest': "Suggest as template…", 'save': "Save as
 *   template…") in every role and mode, frozen too, none without one; the
 *   context menu on items: save-template after export-csv with
 *   env.templateRight, never on the empty canvas
 * - AK11 the suggest/save dialog (name and note, route 29, errors in the
 *   dialog); the insert dialog (4 built-in tiles, the adopted ones as
 *   tiles without "by" (job 237: they pick, "Insert" inserts), the own
 *   open suggestions as cards with a 44 px
 *   withdraw button beside them, nothing for right null); the admin
 *   section (adopt, reject and delete after a question, rename with Enter
 *   and Esc, a 404 reloads, empty lists, other errors in an alert); the
 *   board view's wiring
 * - the texts of Verhalten 10 in de.json
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as boards from '../../../src/api/boards.js'
import { BOARD_ACTIONS, TEMPLATE_RIGHTS, boardMenuItems } from '../../../src/components/boardMenu.js'
import { MENU_ITEMS, menuEntries, menuLabel, menuShortcut } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { HttpError } from '../../../src/sync/http.js'
import { n, t } from '../../../src/util/l10n.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const TopBar = (await import('../../../src/components/TopBar.vue')).default
const ContextMenu = (await import('../../../src/components/ContextMenu.vue')).default
const TemplateDialog = (await import('../../../src/components/TemplateDialog.vue')).default
const TemplateGrid = (await import('../../../src/components/TemplateGrid.vue')).default
const TemplateEditDialog = (await import('../../../src/components/TemplateEditDialog.vue')).default
const TemplateAdmin = (await import('../../../src/admin/TemplateAdmin.vue')).default

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** @param {object} C component @param {object} props props @return {Promise<string>} SSR HTML without comments */
async function render(C, props) {
	const app = createSSRApp(C, props)
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return strip(await renderToString(app))
}

let calls
let answers
beforeEach(() => {
	calls = []
	answers = []
	globalThis._nc_auth_requestToken = 'tok1'
	boards.deps.urlOf = (p) => '/index.php/apps/knorke' + p
	boards.deps.csrfUrl = () => '/index.php/csrftoken'
	boards.deps.request = async (method, url, opts) => {
		calls.push([method, url.replace('/index.php/apps/knorke', ''), opts.body])
		const a = answers.shift()
		if (a instanceof Error) {
			throw a
		}
		return a
	}
})

// ---- AK10: the board menu ---------------------------------------------------------

const ITEM = (label) => Object.freeze({ kind: 'action', key: 'save-template', label, icon: icons.board, group: 'root' })
const LABELS = Object.freeze({ suggest: 'Suggest as template…', save: 'Save as template…' })

test('AK10 boardMenuItems: save-template right after download-board with templateRight suggest or save (its label), with and without canEdit and edit (every role, mode, frozen); null and anything else: none', () => {
	assert.deepEqual(TEMPLATE_RIGHTS, ['suggest', 'save'])
	// job 191: filter-tags first (only once the board has tags)
	assert.deepEqual(BOARD_ACTIONS, ['filter-tags', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'download-board', 'save-template', 'insert-template', 'insert-board-file', 'insert-bpmn-file', 'import-csv', 'keyboard-shortcuts'])
	for (const right of ['suggest', 'save']) {
		for (const canEdit of [false, true]) {
			for (const edit of [false, true]) {
				const items = boardMenuItems({ ready: true, templateRight: right, canEdit, edit })
				const keys = items.map((e) => e.key)
				assert.equal(keys.indexOf('save-template'), keys.indexOf('download-board') + 1, `${right}, canEdit ${canEdit}, edit ${edit}: right after download-board`)
				assert.deepEqual(items[keys.indexOf('save-template')], ITEM(LABELS[right]))
			}
		}
		assert.deepEqual(boardMenuItems({ ready: true, templateRight: right }).map((e) => e.key), ['export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'download-board', 'save-template'], 'a viewer in view or vote, a frozen board')
		assert.deepEqual(boardMenuItems({ ready: false, templateRight: right }), [], 'not before the board is loaded')
	}
	for (const none of [null, undefined, '', 'admin', true]) {
		assert.ok(!boardMenuItems({ ready: true, canEdit: true, edit: true, templateRight: none }).some((e) => e.key === 'save-template'), String(none))
	}
})

test('AK10 TopBar: templateRight brings save-template on the root of "More" with its label (job 228: after the submenus, before "Keyboard shortcuts"; wide and narrow, every role, with and without edit); without it none, the guest page none', async () => {
	const roles = {
		owner: { isOwner: true, canModerate: true, canEdit: true },
		moderator: { mod: true, canModerate: true, canEdit: true },
		editor: { canEdit: true },
		viewer: {},
	}
	const hooks = (html) => [...html.matchAll(/data-knorke-(action|legal|submenu)="([^"]+)"/g)].map((m) => m[2])
	for (const [role, props] of Object.entries(roles)) {
		for (const narrow of [false, true]) {
			for (const edit of [false, true]) {
				for (const right of ['suggest', 'save']) {
					const html = await render(TopBar, { title: 'Retro', participants: [], ready: true, ...props, narrow, edit, templateRight: right })
					const list = hooks(html)
					const last = list.lastIndexOf(edit ? 'insert' : 'export')
					assert.equal(list.indexOf('save-template'), last + 1, `${role} narrow ${narrow} edit ${edit} ${right}: right after the submenus`)
					assert.equal(list.indexOf('keyboard-shortcuts'), narrow ? -1 : list.indexOf('save-template') + 1, 'then "Keyboard shortcuts" (wide)')
					assert.match(html, new RegExp(`data-knorke-action="save-template"[^>]*>[\\s\\S]*?${LABELS[right]}`))
				}
				assert.ok(!hooks(await render(TopBar, { title: 'Retro', participants: [], ready: true, ...props, narrow, edit })).includes('save-template'), `${role}: none without a right`)
			}
		}
	}
	for (const narrow of [false, true]) {
		const guest = await render(TopBar, { title: 'Retro', participants: [], ready: true, isGuest: true, canGoBack: false, canEdit: true, edit: true, narrow })
		assert.ok(hooks(guest).includes('export'), 'precondition: the guest has the board menu')
		assert.ok(!hooks(guest).includes('save-template'), 'never on the guest page')
	}
})

// ---- AK10: the context menu ---------------------------------------------------------

const note = { ids: ['id0'], count: 1, types: new Set(['sticky']), fields: [], mixed: [], canConnect: false, box: null }

test('AK10 menuEntries on items: save-template after export-csv with env.templateRight suggest or save, else missing; never on the empty canvas; the label follows the right, no shortcut', () => {
	for (const right of ['suggest', 'save']) {
		const on = menuEntries(note, 'id0', { templateRight: right })
		assert.equal(on.indexOf('save-template'), on.indexOf('export-csv') + 1, right)
		const locked = { ...note, unlockable: 0, lockable: 0, locked: 1 }
		assert.ok(menuEntries(locked, 'id0', { templateRight: right }).includes('save-template'), 'locked items too')
		assert.ok(!menuEntries(null, null, { templateRight: right, items: 3 }).includes('save-template'), 'never on the empty canvas')
		assert.equal(menuLabel('save-template', note, { templateRight: right }), LABELS[right])
	}
	for (const none of [undefined, null, 'admin', true]) {
		assert.ok(!menuEntries(note, 'id0', { templateRight: none }).includes('save-template'), String(none))
	}
	assert.equal(MENU_ITEMS.indexOf('save-template'), MENU_ITEMS.indexOf('export-csv') + 1)
	assert.equal(menuLabel('save-template'), 'Suggest as template…')
	assert.equal(menuShortcut('save-template', false), null)
	assert.equal(menuShortcut('save-template', true), null)
})

test('AK10 ContextMenu.vue: with templateRight the menu on items renders save-template after export-csv with its label; without it none', async () => {
	const menu = { id: '01JA0000000000000000000001', at: [0, 0], seq: 1, items: 3 }
	const items = (html) => [...html.matchAll(/data-knorke-menu-item="([a-z-]+)"/g)].map((m) => m[1])
	for (const right of ['suggest', 'save']) {
		const html = await render(ContextMenu, { menu, selection: note, host: null, canPaste: false, apple: false, templateRight: right })
		assert.deepEqual(items(html).slice(-3), ['export-csv', 'save-template', 'delete'], 'job 230: before Delete, the last entry')
		assert.match(html, new RegExp(`data-knorke-menu-item="save-template"[\\s\\S]*?${LABELS[right]}`))
	}
	assert.ok(!items(await render(ContextMenu, { menu, selection: note, host: null, canPaste: false, apple: false })).includes('save-template'))
})

// ---- AK11: the suggest/save dialog ------------------------------------------------------

const DRAFT = Object.freeze({ scope: 'board', content: '{"knorke":1,"kind":"board","title":"","origin":[0,0],"items":[{"id":"x"}]}', sketch: [[4, 4, 112, 72, '']], name: 'Retro Q3' })

test('AK11 suggest dialog: template-suggest with the name (prefilled, at most 100) and the note field (at most 200), Cancel and Suggest; route 29 with name, note, content and sketch, then saved', async () => {
	const html = await render(TemplateEditDialog, { draft: DRAFT, right: 'suggest' })
	assert.match(html, /^<div data-stub="NcDialog"[^>]*name="Suggest as template"/)
	assert.match(html, /^<div data-stub="NcDialog"[^>]*data-knorke-dialog="template-suggest"/)
	assert.match(html, /^<div data-stub="NcDialog"[^>]*is-form/)
	assert.match(html, /<label class="knorke-templateedit__field"><span>Name<\/span><input type="text" maxlength="100" required data-knorke-template-name value="Retro Q3"><\/label>/)
	assert.match(html, /<label class="knorke-templateedit__field"><span>Note for the admins \(optional\)<\/span><input type="text" maxlength="200" data-knorke-template-note value(?:="")?><\/label>/)
	// the stub of NcDialog leaves the #actions slot out: the buttons from the source
	const actions = read('src/components/TemplateEditDialog.vue').match(/<template #actions>([\s\S]*?)<\/template>/)[1]
	assert.match(actions, /data-knorke-action="template-cancel"\s+@click="\$emit\('close'\)">\s+\{\{ t\('knorke', 'Cancel'\) \}\}/)
	assert.match(actions, /data-knorke-action="template-save">\s+\{\{ suggest \? t\('knorke', 'Suggest'\) : t\('knorke', 'Save'\) \}\}/)
	assert.equal(setupOf(TemplateEditDialog, { draft: DRAFT, right: 'suggest' }).bindings.suggest.value, true)
	const { bindings, emitted } = setupOf(TemplateEditDialog, { draft: DRAFT, right: 'suggest' })
	bindings.name.value = '   '
	assert.equal(bindings.canSave.value, false, 'disabled with an empty name')
	await bindings.submit()
	assert.deepEqual(calls, [], 'nothing sent')
	bindings.name.value = '  Retro Q3 neu '
	bindings.note.value = ' Gut für Retros '
	answers = [{ id: 7, state: 'pending' }]
	await bindings.submit()
	assert.deepEqual(calls, [['POST', '/api/v1/templates', { name: 'Retro Q3 neu', note: 'Gut für Retros', content: DRAFT.content, sketch: DRAFT.sketch }]])
	assert.deepEqual(emitted, [['saved', { id: 7, state: 'pending' }]])
	assert.equal(bindings.error.value, '')
	const src = read('src/components/TemplateEditDialog.vue')
	assert.match(src, /type="submit"\s+variant="primary"\s+:disabled="!canSave"\s+data-knorke-action="template-save">/)
	assert.match(src, /@submit="submit"/, 'Enter sends (is-form)')
	assert.doesNotMatch(src, /v-html/)
})

test('AK11 save dialog (admins): template-save with only the name, Cancel and Save; route 29 without a note', async () => {
	const html = await render(TemplateEditDialog, { draft: DRAFT, right: 'save' })
	assert.match(html, /^<div data-stub="NcDialog"[^>]*name="Save as template"/)
	assert.match(html, /^<div data-stub="NcDialog"[^>]*data-knorke-dialog="template-save"/)
	assert.doesNotMatch(html, /data-knorke-template-note/)
	const { bindings, emitted } = setupOf(TemplateEditDialog, { draft: DRAFT, right: 'save' })
	assert.equal(bindings.suggest.value, false, 'the button says "Save"')
	answers = [{ id: 8, state: 'adopted' }]
	await bindings.submit()
	assert.deepEqual(calls, [['POST', '/api/v1/templates', { name: 'Retro Q3', content: DRAFT.content, sketch: DRAFT.sketch }]])
	assert.deepEqual(emitted, [['saved', { id: 8, state: 'adopted' }]])
})

test('AK11 suggest dialog: 409 suggestion_limit shows the limit with {max}, any other error a general text; both stay in the dialog', async () => {
	const { bindings, emitted } = setupOf(TemplateEditDialog, { draft: DRAFT, right: 'suggest' })
	answers = [new HttpError(409, 'suggestion_limit', 'x', null, true, { error: 'suggestion_limit', max: 10 })]
	await bindings.submit()
	assert.equal(bindings.error.value, 'You have 10 open suggestions already. Withdraw one or wait for a decision.')
	answers = [new HttpError(0, 'network')]
	await bindings.submit()
	assert.equal(bindings.error.value, 'The template could not be saved.')
	answers = [new HttpError(413, 'too_large', 'x', null, true)]
	await bindings.submit()
	assert.equal(bindings.error.value, 'The template could not be saved.')
	assert.deepEqual(emitted, [], 'no close, no saved')
	assert.equal(bindings.busy.value, false)
	assert.match(read('src/components/TemplateEditDialog.vue'), /<p v-if="error"\s+class="knorke-dialog__error"\s+role="alert"\s+data-knorke-template-error>/)
})

// ---- AK11: the insert dialog ----------------------------------------------------------

const ADOPTED = Object.freeze({ id: 9007199254740991, name: 'Unsere <b>Retro</b>', sketch: [[4, 10, 50, 30, ''], [10, 20, 12.5, 12.5, '#faea89']] })
const ADOPTED2 = Object.freeze({ id: 17, name: 'Kanban', sketch: [[0, 0, 120, 80, '#a2d9fe']] })
const PENDING = Object.freeze({ id: 23, name: 'Mein Vorschlag', note: 'Satz', sketch: [[2, 2, 20, 20, '#ffd5a8']], created: 5 })

/** @param {string} html @return {Array<{attrs: string, inner: string}>} the native buttons */
const buttonsOf = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2] }))
/** (job 237) @param {string} html @return {Array<{attrs: string, radio: string, inner: string}>} the picking tiles: label, its radio, the rest */
const tilesOf = (html) => [...html.matchAll(/<label([^>]*)><input([^>]*)>([\s\S]*?)<\/label>/g)].map((m) => ({ attrs: m[1], radio: m[2], inner: m[3] }))

test('AK11 insert dialog: the 4 built-in tiles, then the adopted ones (job 237: picking tiles) named by their name without a second line, then the own suggestions as cards (no button, no radio) with "Waiting for approval"', async () => {
	const html = await render(TemplateDialog, { own: { state: 'ready', templates: [ADOPTED, ADOPTED2], pending: [PENDING] } })
	assert.match(html, /^<div data-stub="NcDialog"[^>]*data-knorke-templates-state="ready"/)
	const order = [...html.matchAll(/data-knorke-(template|own-template|pending-template)="([^"]+)"/g)].map((m) => m[1] + ':' + m[2])
	assert.deepEqual(order, ['template:retro', 'template:swot', 'template:kanban', 'template:brainstorm', 'own-template:' + ADOPTED.id, 'own-template:17', 'pending-template:23'])
	const buttons = buttonsOf(html)
	const tiles = tilesOf(html)
	for (const e of [ADOPTED, ADOPTED2]) {
		const b = tiles.find((x) => x.attrs.includes(`data-knorke-own-template="${e.id}"`))
		assert.match(b.radio, new RegExp(`^ type="radio" class="knorke-templates__radio" name="knorke-template-insert-pick" value="own:${e.id}"`))
		assert.doesNotMatch(b.radio, /aria-describedby/, 'no second line')
		const name = /aria-labelledby="([^"]+)"/.exec(b.radio)[1]
		const esc = e.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')
		assert.equal(b.inner.replace(/^<svg[\s\S]*?<\/svg>/, ''), `<span id="${name}" class="knorke-templates__name">${esc}</span>`, e.id + ': sketch and name only, no "by"')
		// (SSR writes the attributes of a child component's root in lower case; the browser keeps viewBox)
		assert.match(b.inner, /^<svg class="knorke-templates__sketch" viewBox="0 0 120 80" aria-hidden="true" focusable="false">/i)
		const rects = [...b.inner.matchAll(/<rect class="knorke-templates__(frame|note)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"(?: fill="(#[0-9a-f]{6})")?><\/rect>/g)]
			.map((m) => [...m.slice(2, 6).map(Number), m[6] ?? ''])
		assert.deepEqual(rects, e.sketch, e.id + ': the sketch, only numbers and colours')
	}
	assert.ok(!buttons.some((b) => b.attrs.includes('data-knorke-pending-template')), 'a suggestion is no button')
	assert.ok(!tiles.some((b) => b.attrs.includes('data-knorke-pending-template')), 'nor a picking tile')
	assert.equal(tiles.length, 6, 'the 4 built-in and the 2 adopted tiles pick')
	const card = /<div class="knorke-templates__tile knorke-templates__pending" data-knorke-pending-template="23">([\s\S]*?)<\/div>/.exec(html)
	assert.ok(card, 'the card is a div')
	assert.doesNotMatch(card[0], /tabindex/, 'not focusable')
	assert.match(card[1], /<span class="knorke-templates__name">Mein Vorschlag<\/span><span class="knorke-templates__text">Waiting for approval<\/span>$/)
	assert.ok(!html.includes('<b>'), 'a name is never markup')
	assert.doesNotMatch(read('src/components/TemplateDialog.vue'), /v-html/)
})

test('AK11 insert dialog: beside each card (never inside) a native withdraw button named "Withdraw suggestion “{name}”", ≥ 44 px by the CSS; it emits withdraw, an adopted tile (job 237: picked, then "Insert") insert-own', async () => {
	const html = await render(TemplateDialog, { own: { state: 'ready', templates: [ADOPTED], pending: [PENDING, { ...PENDING, id: 24, name: 'Zweiter' }] } })
	const withdraw = buttonsOf(html).filter((b) => /data-knorke-template-withdraw=/.test(b.attrs))
	assert.deepEqual(withdraw.map((b) => /data-knorke-template-withdraw="([^"]+)"/.exec(b.attrs)[1]), ['23', '24'])
	assert.match(withdraw[0].attrs, /type="button"/)
	assert.match(withdraw[0].attrs, /aria-label="Withdraw suggestion “Mein Vorschlag”"/)
	assert.match(withdraw[1].attrs, /aria-label="Withdraw suggestion “Zweiter”"/)
	assert.match(withdraw[0].inner, /^<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="[^"]+" fill="currentColor"><\/path><\/svg>$/)
	assert.match(html, /<div class="knorke-templates__cell"><div class="knorke-templates__tile knorke-templates__pending" data-knorke-pending-template="23">[\s\S]*?<\/div><button type="button" class="knorke-templates__withdraw" data-knorke-template-withdraw="23"/, 'siblings in a cell')
	// job 232: the tiles are TemplateGrid's; the dialog passes withdraw on (job 237: and inserts the picked tile itself)
	const src = read('src/components/TemplateGrid.vue')
	assert.match(src, /:data-knorke-own-template="e\.kind === 'own' \? e\.id : null"[\s\S]*?@click="picking \|\| choose\(e\)"/)
	assert.match(src, /:data-knorke-template-withdraw="e\.id"[\s\S]*?@click="\$emit\('withdraw', \{ id: e\.id, name: e\.name \}\)"/)
	const dialog = read('src/components/TemplateDialog.vue')
	assert.match(dialog, /@withdraw="\(e\) => \$emit\('withdraw', e\)"/)
	const { bindings, emitted } = setupOf(TemplateDialog, { own: { state: 'ready', templates: [ADOPTED], pending: [PENDING] } })
	bindings.pick.value = 'own:' + ADOPTED.id
	bindings.insert()
	assert.deepEqual(emitted, [['insert-own', ADOPTED.id]])
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	const rule = (sel) => new RegExp(sel.replace(/\./g, '\\.') + ' \\{([^}]*)\\}').exec(css)?.[1] ?? ''
	const w = rule('button.knorke-templates__withdraw')
	for (const d of [/width: var\(--knorke-touch\) !important;/, /height: var\(--knorke-touch\) !important;/, /min-width: var\(--knorke-touch\) !important;/, /min-height: var\(--knorke-touch\) !important;/, /border: 1px solid [^;]+ !important;/, /box-shadow: none !important;/]) {
		assert.match(w, d)
	}
	assert.match(css, /--knorke-touch: 44px;/)
	assert.match(rule('.knorke-templates__grid'), /overflow-y: auto;/)
})

test('AK11 insert dialog: loading and error states; without own (right null, the guest page) no state, no adopted tiles, nothing loads', async () => {
	const loading = await render(TemplateDialog, { own: { state: 'loading', templates: [], pending: [] } })
	assert.match(loading, /data-knorke-templates-state="loading"/)
	assert.equal(tilesOf(loading).length, 4, 'the four built-in tiles at once')
	const error = await render(TemplateDialog, { own: { state: 'error', templates: [], pending: [] } })
	assert.match(error, /<p class="knorke-dialog__error" role="alert" data-knorke-templates-error>\s*The templates could not be loaded\.\s*<\/p>/)
	const none = await render(TemplateDialog, {})
	assert.doesNotMatch(none, /data-knorke-templates-state|data-knorke-own-template|data-knorke-pending-template|data-knorke-templates-error/)
	assert.equal(tilesOf(none).length, 4)
	const { bindings } = setupOf(TemplateGrid, { mode: 'insert', own: { state: 'ready', templates: [ADOPTED, { id: 'x' }, null], pending: [{ name: '' }] } })
	assert.deepEqual(bindings.adopted.value.map((e) => e.id), [ADOPTED.id], 'entries that are no template are left out')
	assert.deepEqual(bindings.pending.value, [])
	// the board view: right null loads nothing when the dialog opens; the guest page never loads
	const view = read('src/views/BoardView.vue')
	const fn = (name) => view.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''
	assert.match(fn('openTemplates'), /templatesOpen\.value = true[\s\S]*if \(templateList\.value\.right !== null\) \{\s+loadTemplates\(\)/)
	assert.match(fn('loadTemplates'), /^async function loadTemplates\(\) \{\s+if \(props\.mode !== 'user'\) \{\s+return/)
	assert.match(view, /const templateOwn = computed\(\(\) => \{\s+const l = templateList\.value\s+return props\.mode !== 'user' \|\| l\.right === null \|\| l\.state === null \? null :/)
})

// ---- AK11: the admin section ----------------------------------------------------------

const S1 = Object.freeze({ id: 31, name: 'Retro <i>Q3</i>', note: 'Für alle Teams', sketch: [[4, 4, 40, 40, '']], by: 'Bob Berg', created: 1 })
const S2 = Object.freeze({ id: 32, name: 'Kanban', note: null, sketch: [], by: 'alice', created: 2 })
const A1 = Object.freeze({ id: 41, name: 'Brainstorm', sketch: [[0, 0, 10, 10, '#faea89']], adopted: 3 })
const REVIEW = Object.freeze({ suggestions: [S1, S2], templates: [A1] })

/** TemplateAdmin with an answer of route 34 already loaded (its setup as it is, the lists filled like load() does). */
const adminWith = (review) => ({
	...TemplateAdmin,
	setup(props, ctx) {
		const b = TemplateAdmin.setup(props, ctx)
		b.suggestions.value = b.rows(review.suggestions)
		b.adopted.value = b.rows(review.templates)
		b.state.value = 'ready'
		return b
	},
})

/** @param {object} review an answer of route 34 @return {{bindings: object, emitted: Array}} the admin section's setup with it loaded */
const adminSetup = (review) => setupOf(adminWith(review), {})

test('AK11 admin section (job 281 AK7): the suggestions (sketch, name, note, "suggested by {name}", Adopt, Reject) and the adopted templates (sketch, name, Rename, Remove); text only', async () => {
	const html = await render(adminWith(REVIEW), {})
	// job 281: title and intro moved into the head of the collapsible section (AdminSettings.vue)
	assert.match(html, /^<div class="knorke-admin-templates" data-knorke-admin="templates" data-knorke-admin-templates-state="ready"><h3 /)
	assert.match(html, /<h3 class="knorke-admin__heading" tabindex="-1" data-knorke-admin-heading="suggestions">\s*Suggestions\s*<\/h3>/)
	assert.match(html, /<h3 class="knorke-admin__heading" tabindex="-1" data-knorke-admin-heading="adopted">\s*Adopted templates\s*<\/h3>/)
	const row = (attr, id) => new RegExp(`<li class="knorke-admin-templates__row" ${attr}="${id}">([\\s\\S]*?)</li>`).exec(html)?.[1] ?? ''
	const r1 = row('data-knorke-suggestion', 31)
	assert.match(r1, /^<svg class="knorke-templates__sketch knorke-admin-templates__sketch" viewBox="0 0 120 80" aria-hidden="true" focusable="false"><rect class="knorke-templates__frame" x="4" y="4" width="40" height="40"><\/rect><\/svg>/i, 'the same sketch as the insert dialog')
	assert.match(read('src/admin/TemplateAdmin.vue'), /import TemplateSketch from '\.\.\/components\/TemplateSketch\.vue'/)
	assert.match(read('src/components/TemplateGrid.vue'), /import TemplateSketch from '\.\/TemplateSketch\.vue'/)
	assert.match(r1, /<span class="knorke-admin-templates__name">Retro &lt;i&gt;Q3&lt;\/i&gt;<\/span><span class="knorke-admin-templates__note">Für alle Teams<\/span><span class="knorke-admin-templates__by">suggested by Bob Berg<\/span>/)
	assert.match(r1, /data-knorke-action="template-adopt"[^>]*>\s*Adopt/)
	assert.match(r1, /data-knorke-action="template-reject"[^>]*>\s*Reject/)
	assert.doesNotMatch(row('data-knorke-suggestion', 32), /knorke-admin-templates__note/, 'no note: no line')
	assert.match(row('data-knorke-suggestion', 32), /suggested by alice/)
	const a1 = row('data-knorke-adopted', 41)
	assert.match(a1, /<span class="knorke-admin-templates__name">Brainstorm<\/span>/)
	assert.match(a1, /data-knorke-action="template-rename"[^>]*>\s*Rename/)
	assert.match(a1, /data-knorke-action="template-delete"[^>]*>\s*Remove/)
	assert.ok(!html.includes('<i>'), 'names are never markup')
	assert.doesNotMatch(read('src/admin/TemplateAdmin.vue'), /v-html/)
	// job 281: the first section of the admin page, then Shape libraries, AI, Privacy notice
	const page = read('src/admin/AdminSettings.vue')
	const at = ['<TemplateAdmin ', '<ShapeLibAdmin ', 'id="ai"', 'id="privacy"'].map((x) => page.indexOf(x))
	assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), 'templates, shape libraries, AI, privacy notice')
	// the page's pill and notice: the counts go up with the event lists
	const { emitted } = adminSetup(REVIEW)
	await new Promise((r) => setTimeout(r, 0))
	assert.deepEqual(emitted.at(-1), ['lists', { state: 'ready', suggestions: 2, adopted: 1 }])
})

test('AK11 admin section: empty lists show their text; a failed load its alert', async () => {
	const html = await render(adminWith({ suggestions: [], templates: [] }), {})
	assert.match(html, /data-knorke-admin-empty="suggestions">\s*No open suggestions\.\s*</)
	assert.match(html, /data-knorke-admin-empty="adopted">\s*No adopted templates yet\.\s*</)
	assert.doesNotMatch(html, /<li /)
	const { bindings } = setupOf(TemplateAdmin, {})
	assert.equal(bindings.state.value, 'loading')
	answers = [new HttpError(500, 'internal', 'x', null, true)]
	await bindings.load()
	assert.equal(bindings.state.value, 'error')
	assert.match(read('src/admin/TemplateAdmin.vue'), /<p v-if="state === 'error'" class="knorke-admin__error" role="alert" data-knorke-error="templates-load">/)
})

test('AK11 admin section: Adopt sends route 33 and reloads route 34; a 404 reloads too; another error shows "The change could not be saved." and keeps the lists', async () => {
	const { bindings } = adminSetup(REVIEW)
	assert.deepEqual(bindings.suggestions.value.map((e) => [e.id, e.by]), [[31, 'Bob Berg'], [32, 'alice']])
	answers = [{ id: 31 }, { suggestions: [S2], templates: [{ ...S1, adopted: 9 }, A1] }]
	await bindings.adopt(bindings.suggestions.value[0])
	assert.deepEqual(calls, [['POST', '/api/v1/templates/31/adopt', {}], ['GET', '/api/v1/templates/review', undefined]])
	assert.deepEqual(bindings.adopted.value.map((e) => e.id), [31, 41])
	assert.equal(bindings.state.value, 'ready')
	calls = []
	answers = [new HttpError(404, 'not_found', 'x', null, true), { suggestions: [], templates: [A1] }]
	await bindings.adopt({ id: 32 })
	assert.deepEqual(calls.map((c) => c[0] + ' ' + c[1]), ['POST /api/v1/templates/32/adopt', 'GET /api/v1/templates/review'], 'a 404 (another admin was faster) reloads')
	assert.equal(bindings.failure.value, '')
	calls = []
	answers = [new HttpError(500, 'internal', 'x', null, true)]
	await bindings.adopt({ id: 41 })
	assert.deepEqual(calls.map((c) => c[0] + ' ' + c[1]), ['POST /api/v1/templates/41/adopt'], 'no reload')
	assert.equal(bindings.failure.value, 'The change could not be saved.')
	assert.deepEqual(bindings.adopted.value.map((e) => e.id), [41], 'the lists stay')
	assert.match(read('src/admin/TemplateAdmin.vue'), /<p v-if="failure" class="knorke-admin__error" role="alert" data-knorke-error="templates">/)
})

test('AK11 admin section: Reject and Delete ask first (danger), then send route 32 and reload; Cancel sends nothing', async () => {
	const { bindings } = adminSetup(REVIEW)
	bindings.ask('reject', bindings.suggestions.value[0])
	assert.deepEqual(bindings.question.value, { kind: 'reject', id: 31, name: 'Retro <i>Q3</i>', by: 'Bob Berg' })
	assert.equal(bindings.questionText.value, '“Retro <i>Q3</i>” is deleted and Bob Berg is told.')
	assert.deepEqual(calls, [], 'asking sends nothing')
	answers = [{ deleted: true }, { suggestions: [S2], templates: [A1] }]
	await bindings.confirm()
	assert.deepEqual(calls, [['DELETE', '/api/v1/templates/31', undefined], ['GET', '/api/v1/templates/review', undefined]])
	assert.equal(bindings.question.value, null)
	calls = []
	bindings.ask('delete', bindings.adopted.value[0])
	assert.equal(bindings.questionText.value, '“Brainstorm” will be deleted. Nobody can insert it any more; items already on boards stay. This cannot be undone.')
	answers = [{ deleted: true }, { suggestions: [S2], templates: [] }]
	await bindings.confirm()
	assert.deepEqual(calls.map((c) => c[0] + ' ' + c[1]), ['DELETE /api/v1/templates/41', 'GET /api/v1/templates/review'])
	assert.deepEqual(bindings.adopted.value, [])
	const src = read('src/admin/TemplateAdmin.vue')
	assert.match(src, /<ConfirmDialog v-if="question"[\s\S]*?:confirm-label="question\.kind === 'reject' \? t\('knorke', 'Reject'\) : t\('knorke', 'Delete'\)"\s+:busy="busy"\s+danger\s+:data-knorke-dialog="'template-' \+ question\.kind"\s+@confirm="confirm"\s+@cancel="question = null" \/>/)
})

test('AK11 admin section: Rename turns the name into a field with Save and Cancel; Save (and Enter) sends route 31 and reloads; Cancel (and Esc) restores; an empty name sends nothing', async () => {
	const { bindings } = adminSetup(REVIEW)
	bindings.startRename(bindings.adopted.value[0])
	assert.equal(bindings.renaming.value, 41)
	assert.equal(bindings.renameValue.value, 'Brainstorm')
	bindings.renameValue.value = '   '
	await bindings.saveName(bindings.adopted.value[0])
	assert.deepEqual(calls, [], 'an empty name sends nothing')
	bindings.renameValue.value = '  Ideen sammeln '
	answers = [{ id: 41, name: 'Ideen sammeln' }, { suggestions: [], templates: [{ ...A1, name: 'Ideen sammeln' }] }]
	await bindings.saveName(bindings.adopted.value[0])
	assert.deepEqual(calls, [['PATCH', '/api/v1/templates/41', { name: 'Ideen sammeln' }], ['GET', '/api/v1/templates/review', undefined]])
	assert.equal(bindings.renaming.value, null, 'the field goes')
	assert.equal(bindings.adopted.value[0].name, 'Ideen sammeln')
	bindings.startRename(bindings.adopted.value[0])
	bindings.renameValue.value = 'Verworfen'
	bindings.cancelRename()
	assert.equal(bindings.renaming.value, null)
	answers = [new HttpError(500, 'internal', 'x', null, true)]
	bindings.startRename(bindings.adopted.value[0])
	bindings.renameValue.value = 'X'
	await bindings.saveName(bindings.adopted.value[0])
	assert.equal(bindings.renaming.value, 41, 'an error keeps the field')
	assert.equal(bindings.failure.value, 'The change could not be saved.')
	const src = read('src/admin/TemplateAdmin.vue')
	assert.match(src, /data-knorke-field="template-name"\s+@keydown\.enter\.prevent="saveName\(e\)"\s+@keydown\.esc\.stop\.prevent="cancelRename">/, 'Enter saves, Esc cancels')
	assert.match(src, /data-knorke-action="template-rename-save"\s+@click="saveName\(e\)"/)
	assert.match(src, /data-knorke-action="template-rename-cancel"\s+@click="cancelRename"/)
	const html = await render(adminWith(REVIEW), {})
	assert.doesNotMatch(html, /data-knorke-field="template-name"/, 'no field before Rename')
})

test('AK11 admin section: after an action the focus goes to the heading of the row\'s list', async () => {
	const { bindings } = adminSetup(REVIEW)
	const focused = []
	bindings.setHeading('suggestions', { focus: () => focused.push('suggestions') })
	bindings.setHeading('adopted', { focus: () => focused.push('adopted') })
	answers = [{ id: 31 }, REVIEW]
	await bindings.adopt({ id: 31 })
	await flush()
	bindings.ask('delete', { id: 41, name: 'Brainstorm' })
	answers = [{ deleted: true }, REVIEW]
	await bindings.confirm()
	await flush()
	assert.deepEqual(focused, ['suggestions', 'adopted'])
})

// ---- the board view -------------------------------------------------------------------

test('the board view: route 28 on opening (accounts), its right to the top bar and the context menu; the dialogs and their events wired; withdraw asks and comes back; the infos', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /<ContextMenu [^>]*:template-right="templateRight"/)
	assert.match(view, /<TopBar ref="topBar"[^>]*:template-right="templateRight"/)
	assert.match(view, /const templateRight = computed\(\(\) => props\.mode === 'user' && \(templateList\.value\.right === 'suggest' \|\| templateList\.value\.right === 'save'\) \? templateList\.value\.right : null\)/)
	assert.match(view, /onMounted\(async \(\) => \{[\s\S]{0,200}?loadTemplates\(\)/, 'loads when the board opens')
	assert.match(view, /\} else if \(s && key === 'save-template'\) \{\s+openSaveTemplate\(s\.templateDraft\('board'\)\)/)
	assert.match(view, /onSaveTemplate: \(d\) => openSaveTemplate\(d\)/)
	assert.match(view, /<TemplateDialog v-if="templatesOpen && canInsert"\s+:own="templateOwn"\s+@insert="insertTemplate"\s+@insert-own="insertOwnTemplate"\s+@withdraw="askWithdraw"\s+@close="closeTemplates" \/>/)
	assert.match(view, /<TemplateEditDialog v-if="templateSave && templateRight"\s+:draft="templateSave"\s+:right="templateRight"\s+@saved="templateSaved"\s+@close="closeTemplateSave" \/>/)
	assert.match(view, /<ConfirmDialog v-if="withdrawing"\s+:name="t\('knorke', 'Withdraw suggestion\?'\)"[\s\S]*?danger\s+data-knorke-dialog="template-withdraw"\s+@confirm="withdraw"\s+@cancel="closeWithdraw" \/>/)
	const fn = (name) => view.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] ?? ''
	assert.match(fn('loadTemplates'), /const n = \+\+templateLoad[\s\S]*templatesApi\.listTemplates\(\)[\s\S]*if \(n === templateLoad\) \{\s+templateList\.value = \{ right: res\.right, state: 'ready'/, 'the newest answer wins')
	assert.match(fn('loadTemplates'), /templateList\.value = \{ right: undefined, state: 'error'/, 'an error forgets the right (no menu entry)')
	assert.match(fn('askWithdraw'), /templatesOpen\.value = false\s+withdrawing\.value = entry/, 'never two dialogs')
	assert.match(fn('withdraw'), /templatesApi\.deleteTemplate\(entry\.id\)[\s\S]*e\.status === 404[\s\S]*hook: 'template-withdraw-failed'[\s\S]*closeWithdraw\(\)/)
	assert.match(fn('closeWithdraw'), /withdrawing\.value = null\s+if \(canInsert\.value\) \{\s+openTemplates\(\)/, 'back to the insert dialog with a fresh list')
	assert.match(fn('templateSaved'), /res\?\.state === 'adopted'[\s\S]*hook: 'template-saved'[\s\S]*hook: 'template-suggested'[\s\S]*nextTick\(\(\) => focusCanvasHost\(\)\)/)
	assert.match(fn('openSaveTemplate'), /if \(draft && templateRight\.value\) \{\s+templateSave\.value = draft/)
	assert.match(fn('insertOwnTemplate'), /templatesOpen\.value = false\s+await nextTick\(\)[\s\S]*templatesApi\.templateContent\(id\)[\s\S]*hook: 'template-load-failed'[\s\S]*s\.insertOwnTemplate\(content\)/)
})

// ---- the texts ------------------------------------------------------------------------

test('the texts of Verhalten 10 and the other new ones have their German entries in l10n/de.json', () => {
	const de = JSON.parse(read('l10n/de.json')).translations
	const want = {
		'Suggest as template…': 'Als Vorlage vorschlagen …',
		'Save as template…': 'Als Vorlage speichern …',
		'Note for the admins (optional)': 'Hinweis an die Admins (optional)',
		'Template suggested. An admin decides whether to adopt it.': 'Vorlage vorgeschlagen. Ein Admin entscheidet, ob sie übernommen wird.',
		'Template saved. Everyone can now insert it.': 'Vorlage gespeichert. Alle können sie jetzt einfügen.',
		'You have {max} open suggestions already. Withdraw one or wait for a decision.': 'Du hast schon {max} offene Vorschläge. Ziehe einen zurück oder warte auf eine Entscheidung.',
		'Waiting for approval': 'Wartet auf Freigabe',
		'Withdraw suggestion “{name}”': 'Vorschlag „{name}“ zurückziehen',
		'Suggestions': 'Vorschläge',
		'Adopted templates': 'Übernommene Vorlagen',
		'Adopt': 'Übernehmen',
		'Reject': 'Ablehnen',
		'“{name}” will be deleted. Nobody can insert it any more; items already on boards stay. This cannot be undone.': '„{name}“ wird gelöscht. Niemand kann sie danach noch einfügen; was schon auf Boards liegt, bleibt. Das lässt sich nicht rückgängig machen.',
		'{user} suggested the template {name}': '{user} hat die Vorlage {name} vorgeschlagen',
		'Your template {name} was adopted. Everyone can now insert it.': 'Deine Vorlage {name} wurde übernommen. Alle können sie jetzt einfügen.',
		'Your template suggestion {name} was not adopted.': 'Dein Vorlagenvorschlag {name} wurde nicht übernommen.',
	}
	for (const [en, german] of Object.entries(want)) {
		assert.equal(de[en], german, en)
	}
	for (const gone of ['Only for me', 'For everyone on this Nextcloud', 'Edit template', 'by a deleted account']) {
		assert.ok(!(gone in de), `round 1's "${gone}" is gone`)
	}
})
