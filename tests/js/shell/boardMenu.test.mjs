/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The board menu "⋯" (factory job 178, AK6), run in Node with ./sfc.mjs
 * (@nextcloud/vue as stubs that render their slots):
 * - boardMenuItems: export-png once the board is loaded, for guests the
 *   legal links after it
 * - TopBar wide: [data-knorke-menu=board] for owner, moderator, editor,
 *   viewer and guest, last in the bar (after "Share"), export-png first;
 *   guests then imprint and privacy, no [data-knorke=guest-menu]
 * - TopBar narrow: no board menu; [data-knorke-menu=overflow] for every
 *   role: "Share" (owner, moderators), the moderation entries (moderators),
 *   export-png, the legal links (guests)
 * - the wiring: an action emits board-action with its key, the board view
 *   saves the whole board with it
 * Factory job 179 (AK5): export-csv ("Save as CSV", icons.table) right after
 * export-png, only with canEdit (owner, moderator, editor, a guest of the
 * edit link), in both layouts; a viewer and a guest of a view link keep
 * export-png alone (the guest with the legal links after it).
 * Job 180 (AK4): with edit, insert-template ("Insert template…") is the last
 * action, for guests before the legal links; without edit or ready it is
 * missing; the TopBar's prop edit follows the board view's canInsert.
 * Job 181 (AK1): download-board ("Download board", icons.download) after
 * export-csv (without canEdit right after export-png) once the board is
 * loaded, for every role, guests too, with and without edit;
 * insert-board-file ("Insert board file…", icons.upload) only with edit,
 * right after insert-template, as the last action (guests: before the legal
 * links); the board view downloads the file and opens the hidden file field
 * synchronously in the click.
 * Job 228 (redesign header): every entry has its group, the level of "More"
 * it stands on: 'root' (filter-tags, save-template, shortcuts), 'export'
 * (PNG, SVG, PDF, BPMN, CSV, the board file), 'insert' (template, board
 * file, BPMN file, CSV) and 'legal' (the instance's links, now for accounts
 * too); the TopBar renders the root with "Export ▸", "Insert ▸" and
 * "Legal ▸" ([data-knorke-submenu]); the submenus open in the same list.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOARD_ACTIONS, BOARD_SUBMENUS, boardMenuItems } from '../../../src/components/boardMenu.js'
import { icons } from '../../../src/components/icons.js'
import { n, t } from '../../../src/util/l10n.js'
import { useSfc } from './sfc.mjs'

useSfc()
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const TopBar = (await import('../../../src/components/TopBar.vue')).default

const LEGAL = Object.freeze({ imprintUrl: 'https://example.org/impressum', privacyUrl: 'https://example.org/datenschutz' })
const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

/**
 * @param {object} props TopBar props
 * @return {Promise<string>} SSR HTML without comments
 */
async function render(props) {
	const app = createSSRApp(TopBar, { title: 'Retro', participants: [], ready: true, ...props })
	app.config.globalProperties.t = t
	app.config.globalProperties.n = n
	return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

/** The roles of AK6 as TopBar props (job 179: canEdit of me.role). */
const ROLES = Object.freeze({
	owner: { isOwner: true, canModerate: true, canEdit: true },
	moderator: { mod: true, canModerate: true, canEdit: true },
	editor: { canEdit: true },
	viewer: {},
	guest: { isGuest: true, canGoBack: false, legal: LEGAL, canEdit: true },
	'guest of a view link': { isGuest: true, canGoBack: false, legal: LEGAL },
})

/** The export group of a loaded board (job 179: export-csv with canEdit; job 181: download-board). */
const exportsOf = (props) => ['export-png', 'export-svg', 'export-pdf', 'export-bpmn', ...(props.canEdit ? ['export-csv'] : []), 'download-board']
/** The insert group while this person edits (jobs 180, 181, 205, 220). */
const INSERTS = Object.freeze(['insert-template', 'insert-board-file', 'insert-bpmn-file', 'import-csv'])

const item = (group, key, label, icon) => Object.freeze({ kind: 'action', key, label, icon, group })
// job 178/200/205/181, job 228: the labels inside "Export" leave out what its name says
const PNG = item('export', 'export-png', 'As image (PNG)', icons.image)
const SVG = item('export', 'export-svg', 'As SVG', icons.image)
const PDF = item('export', 'export-pdf', 'As PDF…', icons.image)
const BPMN = item('export', 'export-bpmn', 'As BPMN', icons.download)
const CSV = item('export', 'export-csv', 'As CSV', icons.table)
const DOWNLOAD = item('export', 'download-board', 'Download board file', icons.download)
const TEMPLATE_ITEM = item('insert', 'insert-template', 'Template…', icons.frame)
const BOARD_FILE_ITEM = item('insert', 'insert-board-file', 'Board file…', icons.upload)
const BPMN_FILE_ITEM = item('insert', 'insert-bpmn-file', 'BPMN file…', icons.upload)
const CSV_FILE_ITEM = item('insert', 'import-csv', 'CSV…', icons.table)
const SHORTCUTS = item('root', 'keyboard-shortcuts', 'Keyboard shortcuts', icons.keyboard)
const LINKS = Object.freeze([
	{ kind: 'link', key: 'imprint', label: 'Legal notice', href: LEGAL.imprintUrl, group: 'legal' },
	{ kind: 'link', key: 'privacy', label: 'Privacy policy', href: LEGAL.privacyUrl, group: 'legal' },
])

/** @param {object[]} items boardMenuItems @param {string} g group @return {string[]} the keys of that group in order */
const keysIn = (items, g) => items.filter((e) => e.group === g).map((e) => e.key)

/**
 * @param {string} html rendered HTML
 * @param {string} menu value of data-knorke-menu
 * @return {string|null} the HTML of that menu's root element (up to the next sibling root), null without one
 */
function menuOf(html, menu) {
	const at = html.indexOf(`data-knorke-menu="${menu}"`)
	if (at < 0) return null
	const start = html.lastIndexOf('<div', at)
	let depth = 0
	const re = /<div\b|<\/div>/g
	re.lastIndex = start
	for (let m; (m = re.exec(html));) {
		depth += m[0] === '</div>' ? -1 : 1
		if (depth === 0) return html.slice(start, m.index + 6)
	}
	return null
}

/** @param {string} html @return {string[]} the hooks in document order: action:<key>, legal:<key>, submenu:<name> */
const hooks = (html) => [...html.matchAll(/data-knorke-(action|legal|submenu)="([^"]+)"/g)].map((m) => m[1] + ':' + m[2])

/** @param {object} props TopBar props @return {string[]} the root level of "More" for those props (wide: with shortcuts) */
const rootOf = (props, { narrow = false } = {}) => [
	...(props.hasTags ? ['action:filter-tags'] : []),
	'submenu:export',
	...(props.edit ? ['submenu:insert'] : []),
	...(narrow ? [] : ['action:keyboard-shortcuts']),
	...(props.legal ? ['submenu:legal'] : []),
]

test('AK6 boardMenuItems (job 228 groups): the groups and their order; the action keys', () => {
	assert.deepEqual(BOARD_ACTIONS, ['filter-tags', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'download-board', 'save-template', 'insert-template', 'insert-board-file', 'insert-bpmn-file', 'import-csv', 'keyboard-shortcuts'], 'job 182: save-template after download-board; job 191: filter-tags first; job 228: keyboard-shortcuts last (the round "?" button has [data-knorke-action=shortcuts])')
	assert.deepEqual(BOARD_SUBMENUS, ['export', 'insert', 'legal'])
	assert.deepEqual(boardMenuItems(), [])
	assert.deepEqual(boardMenuItems({ ready: true }), [PNG, SVG, PDF, BPMN, DOWNLOAD])
	assert.deepEqual(boardMenuItems({ ready: true, shortcuts: true }), [PNG, SVG, PDF, BPMN, DOWNLOAD, SHORTCUTS])
	assert.deepEqual(boardMenuItems({ ready: true, legal: LEGAL }), [PNG, SVG, PDF, BPMN, DOWNLOAD, ...LINKS], 'job 228: the legal links for accounts too')
	assert.deepEqual(boardMenuItems({ ready: true, guest: true, legal: LEGAL }), [PNG, SVG, PDF, BPMN, DOWNLOAD, ...LINKS])
	assert.deepEqual(boardMenuItems({ guest: true, legal: LEGAL }).map((e) => e.key), ['imprint', 'privacy'], 'before the board is loaded: the links only')
	assert.deepEqual(boardMenuItems({ ready: true, guest: true, legal: { imprintUrl: '', privacyUrl: '' } }).map((e) => e.key), exportsOf({}))
	assert.deepEqual(boardMenuItems({ ready: true, legal: { imprintUrl: 'javascript:alert(1)', privacyUrl: '' } }).map((e) => e.key), exportsOf({}), 'never a javascript: href')
	assert.deepEqual(boardMenuItems({ shortcuts: true }), [], 'shortcuts once the board is loaded')
	const all = boardMenuItems({ ready: true, canEdit: true, edit: true, templateRight: 'suggest', tags: true, shortcuts: true, legal: LEGAL })
	assert.deepEqual(keysIn(all, 'root'), ['filter-tags', 'save-template', 'keyboard-shortcuts'])
	assert.deepEqual(keysIn(all, 'export'), exportsOf({ canEdit: true }))
	assert.deepEqual(keysIn(all, 'insert'), INSERTS)
	assert.deepEqual(keysIn(all, 'legal'), ['imprint', 'privacy'])
	assert.deepEqual(all.filter((e) => e.kind === 'action').map((e) => e.key), BOARD_ACTIONS, 'BOARD_ACTIONS in list order')
})

for (const [role, props] of Object.entries(ROLES)) {
	test(`AK6 wide (${role}): [data-knorke-menu=board] named "More", last in the right island; its root: Export ▸, (Insert ▸), Keyboard shortcuts, (Legal ▸)`, async () => {
		for (const edit of [false, true]) {
			const html = await render({ ...props, edit })
			const menu = menuOf(html, 'board')
			assert.ok(menu, 'the board menu')
			assert.match(menu, /data-stub="NcActions"[^>]*aria-label="More"/)
			assert.ok(menu.startsWith('<div class="knorke-modmenu" data-knorke-menu="board"><div data-stub="NcActions"') && menu.includes('><div data-stub="NcIconSvgWrapper" path="' + icons.dotsHorizontal + '"></div><div data-stub="NcActionButton"'), 'job 244: its icon is Phosphor\'s "⋯" (icons.dotsHorizontal)')
			assert.deepEqual(hooks(menu), rootOf({ ...props, edit }), `edit ${edit}`)
			assert.match(menu, /data-knorke-submenu="export"[^>]*is-menu|is-menu[^>]*data-knorke-submenu="export"/, 'is-menu: the chevron')
			assert.match(menu, /data-knorke-submenu="export"[^>]*>[\s\S]*?Export/)
			assert.equal(hooks(html.slice(html.indexOf('data-knorke-menu="board"'))).length, hooks(menu).length, 'nothing after it')
			assert.equal(menuOf(html, 'overflow'), null, 'no overflow menu in the wide layout')
		}
	})

	test(`AK6 narrow (${role}): no board menu; [data-knorke-menu=overflow] with share, moderation, then the root of "More" without shortcuts`, async () => {
		const html = await render({ ...props, narrow: true })
		assert.equal(menuOf(html, 'board'), null, 'no second menu')
		const menu = menuOf(html, 'overflow')
		assert.ok(menu, 'the overflow menu for every role')
		const want = [
			...((props.isOwner || props.mod) && !props.isGuest ? ['action:share'] : []),
			...(props.canModerate ? ['action:vote-setup', 'action:timer-open', 'action:private-setup', 'action:summon'] : []),
			...rootOf(props, { narrow: true }),
		]
		assert.deepEqual(hooks(menu), want)
		assert.match(menu, /data-stub="NcActions"[^>]*aria-label="More"/)
	})
}

test('AK6 before the board is loaded: no menu for accounts without legal links, the guest keeps "Legal ▸"', async () => {
	assert.equal(menuOf(await render({ ready: false }), 'board'), null)
	assert.deepEqual(hooks(menuOf(await render({ ...ROLES.guest, ready: false }), 'board')), ['submenu:legal'])
	assert.deepEqual(hooks(menuOf(await render({ ...ROLES.owner, ready: false, narrow: true }), 'overflow')), ['action:share', 'action:vote-setup', 'action:timer-open', 'action:private-setup', 'action:summon'])
})

test('AK6 wiring: every board action closes the menu and emits board-action with its key; the board view saves the whole board', () => {
	const menu = read('src/components/ModerationMenu.vue')
	assert.match(menu, /<NcActionButton v-else\s+close-after-click\s+:data-knorke-action="e\.key"\s+@click="\$emit\('board-action', e\.key\)">/, 'in a submenu')
	assert.equal([...menu.matchAll(/close-after-click\s+:data-knorke-action="e\.key"\s+@click="\$emit\('board-action', e\.key\)"/g)].length, 3, 'root before, root after, submenu')
	const bar = read('src/components/TopBar.vue')
	assert.equal([...bar.matchAll(/:board-items="boardItems"\s+@board-action="\(k\) => \$emit\('board-action', k\)"/g)].length, 2, 'the overflow and the board menu pass it on')
	assert.match(bar, /<ModerationMenu v-if="boardItems\.length > 0"\s+board\s/)
	const view = read('src/views/BoardView.vue')
	assert.match(view, /:ready="ready"\s+:can-edit="mayEdit"\s+@board-action="boardAction"/)
	assert.match(view, /function boardAction\(key\) \{\s+const s = session\.value\s+if \(s && key === 'export-png'\) \{\s+s\.exportPng\('board'\)/)
	assert.match(view, /\} else if \(key === 'keyboard-shortcuts'\) \{\s+openShortcuts\('pointer'\)/, 'job 228: "Keyboard shortcuts" opens the overview')
})

test('job 228 AK2 submenus: an is-menu entry per submenu that keeps the menu open, a back entry with the name, the focus to the first entry, the root again on close', () => {
	const menu = read('src/components/ModerationMenu.vue')
	const triggers = [...menu.matchAll(/<NcActionButton[^>]*?is-menu[^>]*?>/gs)].map((m) => m[0])
	assert.equal(triggers.length, 2, 'Export/Insert (v-for) and Legal')
	for (const tr of triggers) {
		assert.doesNotMatch(tr, /close-after-click/, 'a submenu entry keeps the menu open')
		assert.match(tr, /data-knorke-submenu/)
		assert.match(tr, /@click="openLevel\(/)
	}
	assert.match(menu, /<NcActionButton data-knorke-submenu-back\s+@click="openLevel\('root'\)">[\s\S]*?icons\.chevronLeft[\s\S]*?\{\{ submenuName\(level\) \}\}/)
	assert.doesNotMatch(menu.match(/<NcActionButton data-knorke-submenu-back[^>]*>/)[0], /close-after-click/)
	assert.match(menu, /@close="level = 'root'"/, 'closing goes back to the root')
	assert.match(menu, /async function openLevel\(g\) \{\s+level\.value = g\s+await nextTick\(\)\s+actions\.value\?\.focusFirstAction\?\.\(\)/)
	assert.match(menu, /<template v-if="level === 'root'">/)
	assert.match(menu, /const levelItems = computed\(\(\) => props\.boardItems\.filter\(\(e\) => e\.group === level\.value\)\)/)
	assert.match(menu, /:menu-name="overflow \|\| board \? undefined : t\('knorke', 'Facilitate'\)"/, 'the moderation menu: the flag with the word')
	const de = JSON.parse(read('l10n/de.json')).translations
	assert.deepEqual(['Export', 'Insert', 'Legal', 'Keyboard shortcuts', 'As image (PNG)', 'As SVG', 'As PDF…', 'As BPMN', 'As CSV', 'Download board file', 'Template…', 'Board file…', 'BPMN file…', 'CSV…'].map((k) => de[k]),
		['Exportieren', 'Einfügen', 'Rechtliches', 'Tastenkürzel', 'Als Bild (PNG)', 'Als SVG', 'Als PDF …', 'Als BPMN', 'Als CSV', 'Board-Datei herunterladen', 'Vorlage …', 'Board-Datei …', 'BPMN-Datei …', 'CSV …'])
})

test('job 179 AK5 wiring: the board view passes canEdit of me.role and saves the whole board as CSV with export-csv', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /const mayEdit = computed\(\(\) => canEdit\(me\.value\?\.role\)\)/)
	assert.match(view, /\} else if \(s && key === 'export-csv'\) \{\s+s\.exportBoardCsv\('board'\)/)
	assert.match(read('src/components/TopBar.vue'), /boardMenuItems\(\{ ready: props\.ready, canEdit: props\.canEdit,/)
})

test('job 180 AK4 wiring: the board view passes canInsert (ready, mode edit, not frozen) as edit; insert-template opens the template dialog', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /:edit="canInsert"\s+:ready="ready"\s+:can-edit="mayEdit"\s+@board-action="boardAction"/)
	assert.match(view, /const canInsert = computed\(\(\) => ready\.value && uiMode\.value === 'edit' && !frozen\.value\)/)
	assert.match(view, /\} else if \(key === 'insert-template'\) \{\s+openTemplates\(\)/)
	assert.match(read('src/components/TopBar.vue'), /boardMenuItems\(\{ ready: props\.ready, canEdit: props\.canEdit, edit: props\.edit, /)
})

test('job 181 AK1 wiring: download-board saves the board file; insert-board-file clicks the hidden file field synchronously (no accept filter), a picked file goes to the session and the field is emptied', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /\} else if \(s && key === 'download-board'\) \{\s+s\.exportBoardFile\(\)/)
	// job 205: one picker and one reader for the board file and the .bpmn file
	assert.match(view, /\} else if \(key === 'insert-board-file'\) \{\s+pickFile\(boardFileEl\.value\)/)
	const field = view.match(/<input ref="boardFileEl"[^>]*>/)?.[0] ?? ''
	assert.match(field, /type="file"/)
	assert.match(field, /data-knorke-board-file/)
	assert.match(field, /@change="onBoardFile"/)
	assert.doesNotMatch(field, /accept/, 'no accept filter')
	const pick = view.match(/function pickFile\(el\) \{[\s\S]*?\n\}/)?.[0] ?? ''
	assert.match(pick, /if \(canInsert\.value && el\) \{\s+el\.click\(\)/, 'only while this person edits')
	assert.doesNotMatch(pick, /await|async|nextTick|then\(/, 'synchronous in the click: the picker needs the user gesture')
	assert.doesNotMatch(view.match(/function boardAction\(key\) \{[\s\S]*?\n\}/)?.[0] ?? '', /await|async/)
	const change = view.match(/async function insertPicked\(e, max, insert, read = \(file\) => file\.text\(\)\) \{[\s\S]*?\n\}/)?.[0] ?? ''
	assert.match(change, /if \(!file\) \{\s+return\s+\}/, 'cancelling does nothing')
	assert.match(change, /if \(file\.size <= max\) \{\s+text = await read\(file\)/, 'a file over the limit is not read')
	assert.match(change, /el\.value = ''/, 'emptied: the same file can be picked again')
	// job 217: the insert may be async (the BPMN part loads first), so its answer is awaited
	assert.match(change, /if \(session\.value && !\(await insert\(session\.value, text\)\)\) \{\s+focusCanvasHost\(\)/)
	assert.match(view, /function onBoardFile\(e\) \{\s+return insertPicked\(e, BOARD_FILE_MAX_BYTES, \(s, text\) => s\.insertBoardFile\(text\)\)/)
})

test('job 205 AK7 wiring: export-bpmn saves the BPMN file of the board; insert-bpmn-file clicks its own hidden file field (no accept filter), a picked file goes to insertBpmnFile', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /\} else if \(s && key === 'export-bpmn'\) \{\s+s\.exportBpmn\('board'\)/)
	assert.match(view, /\} else if \(key === 'insert-bpmn-file'\) \{\s+pickFile\(bpmnFileEl\.value\)/)
	const field = view.match(/<input ref="bpmnFileEl"[^>]*>/)?.[0] ?? ''
	assert.match(field, /type="file"/)
	assert.match(field, /data-knorke-bpmn-file/)
	assert.match(field, /@change="onBpmnFile"/)
	assert.doesNotMatch(field, /accept/, 'no accept filter: Android greys out .bpmn otherwise')
	assert.match(view, /function onBpmnFile\(e\) \{\s+return insertPicked\(e, BPMN_FILE_MAX_BYTES, \(s, text\) => s\.insertBpmnFile\(text\)\)/)
})

test('job 205 AK7 wiring: export-bpmn saves the BPMN file of the board; insert-bpmn-file clicks its own hidden file field (no accept filter), a picked file goes to insertBpmnFile', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /\} else if \(s && key === 'export-bpmn'\) \{\s+s\.exportBpmn\('board'\)/)
	assert.match(view, /\} else if \(key === 'insert-bpmn-file'\) \{\s+pickFile\(bpmnFileEl\.value\)/)
	const field = view.match(/<input ref="bpmnFileEl"[^>]*>/)?.[0] ?? ''
	assert.match(field, /type="file"/)
	assert.match(field, /data-knorke-bpmn-file/)
	assert.match(field, /@change="onBpmnFile"/)
	assert.doesNotMatch(field, /accept/, 'no accept filter: Android greys out .bpmn otherwise')
	assert.match(view, /function onBpmnFile\(e\) \{\s+return insertPicked\(e, BPMN_FILE_MAX_BYTES, \(s, text\) => s\.insertBpmnFile\(text\)\)/)
})

test('jobs 179, 180, 181, 200, 205, 220 conditions (job 228 groups): CSV only with canEdit, the inserts only with edit === true, none before loading', () => {
	assert.deepEqual(boardMenuItems({ ready: true, canEdit: true }), [PNG, SVG, PDF, BPMN, CSV, DOWNLOAD])
	for (const canEdit of [false, 'yes', undefined]) assert.deepEqual(boardMenuItems({ ready: true, canEdit }), [PNG, SVG, PDF, BPMN, DOWNLOAD], String(canEdit))
	assert.deepEqual(boardMenuItems({ ready: true, edit: true }), [PNG, SVG, PDF, BPMN, DOWNLOAD, TEMPLATE_ITEM, BOARD_FILE_ITEM, BPMN_FILE_ITEM, CSV_FILE_ITEM])
	for (const edit of [false, 'yes']) assert.deepEqual(keysIn(boardMenuItems({ ready: true, edit }), 'insert'), [], String(edit))
	assert.deepEqual(boardMenuItems({ ready: false, canEdit: true, edit: true, tags: true, templateRight: 'save' }), [], 'not before the board is loaded')
	const de = JSON.parse(read('l10n/de.json')).translations
	assert.deepEqual(['There is no BPMN diagram to save.', 'This file is not a BPMN diagram that Knorke can read.', 'The BPMN file does not fit: a board holds at most {max} items.'].map((k) => typeof de[k] === 'string' && de[k] !== ''), [true, true, true])
})

test('job 220 AK1 wiring: import-csv clicks its own hidden file field (no accept filter); a picked file goes to insertCsvFile as bytes, over CSV_FILE_MAX_BYTES unread', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /\} else if \(key === 'import-csv'\) \{\s+pickFile\(csvFileEl\.value\)/)
	const field = view.match(/<input ref="csvFileEl"[^>]*>/)?.[0] ?? ''
	assert.match(field, /type="file"/)
	assert.match(field, /data-knorke-csv-file/)
	assert.match(field, /@change="onCsvFile"/)
	assert.doesNotMatch(field, /accept/, 'no accept filter: Android greys out extensions it does not know')
	assert.match(view, /function onCsvFile\(e\) \{\s+return insertPicked\(e, CSV_FILE_MAX_BYTES, \(s, bytes\) => s\.insertCsvFile\(bytes\), async \(file\) => new Uint8Array\(await file\.arrayBuffer\(\)\)\)/)
})
