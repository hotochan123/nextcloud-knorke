/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 141, shortcut hints from one formatter (src/util/shortcuts.js):
 * - AK1: shortcut(name, apple) gives hint and aria for Apple and elsewhere,
 *   in English (no bundle) and German (l10n/de.json registered); aria stays
 *   WAI-ARIA, never translated; withShortcut; the tool keys from TOOLS.
 * - AK2–AK4: the titles of Toolbar, ContextBar, ZoomControls and
 *   FollowBanner (SSR), with the prop apple and in German.
 * - AK5: menuShortcut (the menu) with the German bundle; the same entries
 *   and keys as before the job.
 * - AK7: the copy prompt of ShareLinks (copy fails: the field is selected and
 *   a toast names the copy key).
 * - AK8: no hard-wired key hint left in src/ outside the formatter.
 * AK6 (toast paste-blocked) is in tests/js/board/contextMenu.test.mjs.
 *
 * Factory job 145, AK2: the names the shortcuts overview adds (shortcuts,
 * paste-in-place, the arrows, Tab, Shift+F10, the Esc names, Ctrl/⌘+Enter,
 * the keys held with a mouse or pen), English, German and Apple; every hint
 * above stays as it was (the job 141 cases below run unchanged, their name
 * list and the WAI-ARIA pattern only grew by the new names and key names).
 *
 * Factory job 174, AK5: the names of a table's cell editor (next-cell,
 * previous-cell, cell-arrows), English, German and Apple.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { register, unregister } from '@nextcloud/l10n'
import { MENU_ITEMS, menuShortcut } from '../../../src/components/contextbar.js'
import { copyPrompt } from '../../../src/components/share.js'
import { TOOLS } from '../../../src/model/tools.js'
import { TYPES } from '../../../src/model/registry.js'
import { SHORTCUT_NAMES, shortcut, withShortcut } from '../../../src/util/shortcuts.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const Toolbar = (await import('../../../src/components/Toolbar.vue')).default
const UndoBar = (await import('../../../src/components/UndoBar.vue')).default
const ContextBar = (await import('../../../src/components/ContextBar.vue')).default
const ContextMenu = (await import('../../../src/components/ContextMenu.vue')).default
const ZoomControls = (await import('../../../src/components/ZoomControls.vue')).default
const FollowBanner = (await import('../../../src/components/FollowBanner.vue')).default
const ShareLinks = (await import('../../../src/components/ShareLinks.vue')).default

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DE = JSON.parse(readFileSync(join(ROOT, 'l10n', 'de.json'), 'utf8')).translations
const render = async (C, props) => (await renderToString(createSSRApp(C, props))).replace(/<!--[^>]*-->/g, '')

/**
 * Runs fn with the German bundle registered (as Nextcloud's l10n/de.js does).
 *
 * @param {() => unknown} fn test body
 * @return {Promise<unknown>} its result
 */
async function inGerman(fn) {
	register('knorke', DE)
	try {
		return await fn()
	} finally {
		unregister('knorke')
	}
}

/**
 * @param {string} html rendered HTML
 * @return {string[]} every title attribute, in document order
 */
const titles = (html) => [...html.matchAll(/\stitle="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

/**
 * @param {string[]} types selected types
 * @param {object} [extra] selection keys
 * @return {object} selection v2 like BoardSession.selectionInfo
 */
function sel(types, extra = {}) {
	let fields = null
	for (const t of new Set(types)) {
		const own = Object.keys(TYPES[t]?.fields ?? {})
		fields = fields === null ? own : fields.filter((p) => own.includes(p))
	}
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: { x: 0, y: 0, w: 1, h: 1, r: 0 }, ...extra }
}

// ---- AK1: the formatter ----------------------------------------------------------

/** The rows of the spec's table: name → [Apple hint, English hint, German hint, Apple aria, aria elsewhere]. */
const TABLE = Object.freeze({
	copy: ['⌘C', 'Ctrl+C', 'Strg+C', 'Meta+C', 'Control+C'],
	redo: ['⌘⇧Z', 'Ctrl+Shift+Z', 'Strg+Umschalt+Z', 'Meta+Shift+Z', 'Control+Shift+Z'],
	'zoom-selection': ['⇧2', 'Shift+2', 'Umschalt+2', 'Shift+2', 'Shift+2'],
	delete: ['⌫', 'Del', 'Entf', 'Backspace', 'Delete'],
	'edit-text': ['↩', 'Enter', 'Enter', 'Enter', 'Enter'],
	'stop-following': ['Esc', 'Esc', 'Esc', 'Escape', 'Escape'],
	grid: ['G', 'G', 'G', 'G', 'G'],
	select: ['V', 'V', 'V', 'V', 'V'],
	'zoom-in': ['+', '+', '+', '+', '+'],
	'zoom-out': ['−', '−', '−', '-', '-'],
})

/** The four arrows' WAI-ARIA shortcuts with the modifier prefix p (job 145). */
const arrows = (p = '') => ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].map((k) => p + k).join(' ')

/**
 * Job 145, AK2: the names of the shortcuts overview → [Apple hint, English hint, German hint, Apple aria,
 * aria elsewhere]; hold-space's hint is translated on Apple too (its own test).
 */
const ADDED = Object.freeze({
	shortcuts: ['?', '?', '?', '?', '?'],
	'paste-in-place': ['⌘⇧V', 'Ctrl+Shift+V', 'Strg+Umschalt+V', 'Meta+Shift+V', 'Control+Shift+V'],
	nudge: ['←↑→↓', '←↑→↓', '←↑→↓', arrows(), arrows()],
	'nudge-big': ['⇧←↑→↓', 'Shift+←↑→↓', 'Umschalt+←↑→↓', arrows('Shift+'), arrows('Shift+')],
	neighbour: ['⌥←↑→↓', 'Alt+←↑→↓', 'Alt+←↑→↓', arrows('Alt+'), arrows('Alt+')],
	'next-item': ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'],
	'previous-item': ['⇧Tab', 'Shift+Tab', 'Umschalt+Tab', 'Shift+Tab', 'Shift+Tab'],
	'context-menu': ['⇧F10', 'Shift+F10', 'Umschalt+F10', 'Shift+F10', 'Shift+F10'],
	deselect: ['Esc', 'Esc', 'Esc', 'Escape', 'Escape'],
	'end-edit': ['Esc', 'Esc', 'Esc', 'Escape', 'Escape'],
	'end-edit-mod': ['⌘↩', 'Ctrl+Enter', 'Strg+Enter', 'Meta+Enter', 'Control+Enter'],
	'next-note': ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'],
	'hold-space': [null, 'Space', 'Leertaste', 'Space', 'Space'],
	'hold-shift': ['⇧', 'Shift', 'Umschalt', 'Shift', 'Shift'],
	'hold-mod': ['⌘', 'Ctrl', 'Strg', 'Meta', 'Control'],
	'hold-alt': ['⌥', 'Alt', 'Alt', 'Alt', 'Alt'],
})

/** Job 174, AK5: the keys of a table's cell editor in the overview, in the form of ADDED. */
const CELL_KEYS = Object.freeze({
	'next-cell': ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'],
	'previous-cell': ['⇧Tab', 'Shift+Tab', 'Umschalt+Tab', 'Shift+Tab', 'Shift+Tab'],
	'cell-arrows': ['←↑→↓', '←↑→↓', '←↑→↓', arrows(), arrows()],
})

/** Job 195, AK5: the keys at a focused mind map node in the overview, in the form of ADDED. */
const MM_KEYS = Object.freeze({
	'mm-child': ['Tab', 'Tab', 'Tab', 'Tab', 'Tab'],
	'mm-sibling': ['↩', 'Enter', 'Enter', 'Enter', 'Enter'],
	'mm-arrows': ['←↑→↓', '←↑→↓', '←↑→↓', arrows(), arrows()],
	'mm-edit': ['F2', 'F2', 'F2', 'F2', 'F2'],
	'mm-delete': ['⌫', 'Del', 'Entf', 'Backspace', 'Delete'],
	'mm-break': ['⇧↩', 'Shift+Enter', 'Umschalt+Enter', 'Shift+Enter', 'Shift+Enter'],
})

test('job 195 AK5: the mind map keys – Apple, English and German; aria WAI-ARIA, never translated', async () => {
	const check = (lang) => {
		for (const [name, [mac, en, de, ariaMac, aria]] of Object.entries(MM_KEYS)) {
			assert.deepEqual(shortcut(name, true), { hint: mac, aria: ariaMac }, `${name}, Apple, ${lang}`)
			assert.deepEqual(shortcut(name, false), { hint: lang === 'de' ? de : en, aria }, `${name}, elsewhere, ${lang}`)
		}
	}
	check('en')
	await inGerman(() => check('de'))
})

test('job 174 AK5: next-cell, previous-cell and cell-arrows – Apple, English and German; aria WAI-ARIA, never translated', async () => {
	const check = (lang) => {
		for (const [name, [mac, en, de, ariaMac, aria]] of Object.entries(CELL_KEYS)) {
			assert.deepEqual(shortcut(name, true), { hint: mac, aria: ariaMac }, `${name}, Apple, ${lang}`)
			assert.deepEqual(shortcut(name, false), { hint: lang === 'de' ? de : en, aria }, `${name}, elsewhere, ${lang}`)
		}
	}
	check('en')
	await inGerman(() => check('de'))
})

test('job 145 AK2: the new names – Apple symbols (⌘⇧V, ⌥←↑→↓, ⇧F10, ⌘↩), English (Ctrl+Shift+V, Alt+←↑→↓, Shift+Tab) and German (Strg+Umschalt+V, Umschalt+F10); aria WAI-ARIA, never translated', async () => {
	const check = (lang) => {
		for (const [name, [mac, en, de, ariaMac, aria]] of Object.entries(ADDED)) {
			if (mac !== null) {
				assert.deepEqual(shortcut(name, true), { hint: mac, aria: ariaMac }, `${name}, Apple, ${lang}`)
			}
			assert.deepEqual(shortcut(name, false), { hint: lang === 'de' ? de : en, aria }, `${name}, elsewhere, ${lang}`)
		}
	}
	check('en')
	await inGerman(() => check('de'))
	check('en')
	assert.equal(withShortcut('Keyboard shortcuts', 'shortcuts', false), 'Keyboard shortcuts (?)')
	assert.equal(withShortcut('Keyboard shortcuts', 'shortcuts', true), 'Keyboard shortcuts (?)')
})

test('job 145 AK2: hold-space is the translated word on every platform – Space, Leertaste (also on Apple); aria Space', async () => {
	assert.deepEqual(shortcut('hold-space', true), { hint: 'Space', aria: 'Space' })
	assert.deepEqual(shortcut('hold-space', false), { hint: 'Space', aria: 'Space' })
	await inGerman(() => {
		assert.deepEqual(shortcut('hold-space', true), { hint: 'Leertaste', aria: 'Space' })
		assert.deepEqual(shortcut('hold-space', false), { hint: 'Leertaste', aria: 'Space' })
	})
})

test('job 141 AK1: every row of the table – Apple symbols in any language, Ctrl/Shift/Del in English, Strg/Umschalt/Entf in German; aria never translated', async () => {
	const check = (lang) => {
		for (const [name, [mac, en, de, ariaMac, aria]] of Object.entries(TABLE)) {
			assert.deepEqual(shortcut(name, true), { hint: mac, aria: ariaMac }, `${name}, Apple, ${lang}`)
			assert.deepEqual(shortcut(name, false), { hint: lang === 'de' ? de : en, aria }, `${name}, elsewhere, ${lang}`)
		}
	}
	check('en')
	await inGerman(() => check('de'))
	check('en')
})

test('job 141 AK1: translated at the call, not when the module loads; aria of every name is a WAI-ARIA value with the German bundle', async () => {
	assert.equal(shortcut('undo', false).hint, 'Ctrl+Z')
	await inGerman(() => {
		assert.equal(shortcut('undo', false).hint, 'Strg+Z', 'the same imported module, now German')
		// job 145: Alt, ?, Tab, F10, Space, the arrows and a modifier held alone; a list of shortcuts is space-separated;
		// job 195: F2
		const ARIA = /^(?:(?:Control|Meta)\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9+?−-]|Delete|Backspace|Enter|Escape|Tab|F10|F2|Space|Arrow(?:Left|Up|Right|Down)|Control|Meta|Shift|Alt)$/
		for (const name of SHORTCUT_NAMES) {
			for (const apple of [false, true]) {
				const s = shortcut(name, apple)
				assert.ok(s !== null, name)
				for (const one of s.aria.split(' ')) {
					assert.match(one, ARIA, `${name}, apple ${apple}`)
				}
			}
		}
	})
	assert.equal(shortcut('undo', false).hint, 'Ctrl+Z', 'English again without the bundle')
})

test('job 141 AK1: the whole table (undo … stop-following), the tool keys from TOOLS in capitals, no shortcut for unknown names; withShortcut', () => {
	const expect = {
		undo: ['Ctrl+Z', 'Control+Z', '⌘Z', 'Meta+Z'],
		redo: ['Ctrl+Shift+Z', 'Control+Shift+Z', '⌘⇧Z', 'Meta+Shift+Z'],
		copy: ['Ctrl+C', 'Control+C', '⌘C', 'Meta+C'],
		cut: ['Ctrl+X', 'Control+X', '⌘X', 'Meta+X'],
		duplicate: ['Ctrl+D', 'Control+D', '⌘D', 'Meta+D'],
		paste: ['Ctrl+V', 'Control+V', '⌘V', 'Meta+V'],
		'select-all': ['Ctrl+A', 'Control+A', '⌘A', 'Meta+A'],
		delete: ['Del', 'Delete', '⌫', 'Backspace'],
		'edit-text': ['Enter', 'Enter', '↩', 'Enter'],
		group: ['Ctrl+G', 'Control+G', '⌘G', 'Meta+G'],
		ungroup: ['Ctrl+Shift+G', 'Control+Shift+G', '⌘⇧G', 'Meta+Shift+G'],
		lock: ['Ctrl+Shift+L', 'Control+Shift+L', '⌘⇧L', 'Meta+Shift+L'],
		unlock: ['Ctrl+Shift+L', 'Control+Shift+L', '⌘⇧L', 'Meta+Shift+L'],
		'zoom-selection': ['Shift+2', 'Shift+2', '⇧2', 'Shift+2'],
		'zoom-100': ['Shift+0', 'Shift+0', '⇧0', 'Shift+0'],
		fit: ['Shift+1', 'Shift+1', '⇧1', 'Shift+1'],
		'zoom-in': ['+', '+', '+', '+'],
		'zoom-out': ['−', '-', '−', '-'],
		grid: ['G', 'G', 'G', 'G'],
		// job 147: other people's cursors
		cursors: ['C', 'C', 'C', 'C'],
		'stop-following': ['Esc', 'Escape', 'Esc', 'Escape'],
		// job 279: bold and italic in a text editor
		bold: ['Ctrl+B', 'Control+B', '⌘B', 'Meta+B'],
		italic: ['Ctrl+I', 'Control+I', '⌘I', 'Meta+I'],
	}
	for (const [name, [hint, aria, macHint, macAria]] of Object.entries(expect)) {
		assert.deepEqual(shortcut(name, false), { hint, aria }, name)
		assert.deepEqual(shortcut(name, true), { hint: macHint, aria: macAria }, name + ' (Apple)')
	}
	// job 173: the table (B) after the text; job 195: the mind map (M) after the table
	assert.deepEqual(TOOLS.map((x) => shortcut(x.id, false).hint), ['V', 'H', 'N', 'S', 'T', 'B', 'M', 'L', 'F', 'K', 'P'])
	for (const x of TOOLS) {
		assert.deepEqual(shortcut(x.id, true), { hint: x.key.toUpperCase(), aria: x.key.toUpperCase() }, x.id)
	}
	assert.deepEqual([...SHORTCUT_NAMES].sort(), [...Object.keys(expect), ...Object.keys(ADDED), ...Object.keys(CELL_KEYS), ...Object.keys(MM_KEYS), 'search', ...TOOLS.map((x) => x.id)].sort(), 'job 145 added ADDED, job 174 CELL_KEYS, job 195 MM_KEYS, job 271 search, nothing else')
	for (const name of ['front', 'connect', 'note-here', 'grid-snap', 'unlock-all', 'toString', '__proto__', '']) {
		assert.equal(shortcut(name, false), null, name)
		assert.equal(withShortcut('Label', name, true), 'Label', name)
	}
	assert.equal(withShortcut('Copy', 'copy', false), 'Copy (Ctrl+C)')
	assert.equal(withShortcut('Copy', 'copy', true), 'Copy (⌘C)')
	assert.equal(withShortcut('Select', 'select', false), 'Select (V)')
})

// ---- AK2: tool bar ---------------------------------------------------------------

test('job 141 AK2: tool bar titles – Undo/Redo with Ctrl, ⌘ with apple, Strg/Umschalt in German; the tools with their single key', async () => {
	const toolTitles = (html) => (html.match(/<[a-z]+[^>]*data-knorke-tool="[^"]+"[^>]*>/g) ?? []).map((tag) => titles(tag)[0])
	const enHtml = await render(Toolbar, {})
	// job 229: two groups (job 273: nine buttons with the pen); table, mind map and laser pointer behind "More tools"
	assert.deepEqual(toolTitles(enHtml), ['Select (V)', 'Pan (H)', 'Sticky note (N)', 'Shape (S)', 'Text (T)', 'Pen (P)', 'Connector (L)', 'Frame (F)', 'More tools'])
	const mac = titles(await render(Toolbar, { apple: true }))
	assert.equal(mac[0], 'Select (V)')
	const deHtml = await inGerman(() => render(Toolbar, {}))
	assert.equal(toolTitles(deHtml)[0], 'Auswählen (V)')
	assert.equal(toolTitles(deHtml).at(-1), 'Mehr Werkzeuge')
	// the tiles behind "More tools" name their key the same way (job 171 laser, job 173 table, job 195 mind map)
	assert.match(readFileSync(join(ROOT, 'src/components/Toolbar.vue'), 'utf8'), /:title="withShortcut\(toolLabel\(id\), id, apple\)"\s+:data-knorke-tool="id"\s+@click="\(e\) => pickMore\(id, e\)"/)
	await inGerman(async () => {
		assert.equal(withShortcut(DE['Laser pointer'], 'laser', false), 'Laserpointer (K)', 'job 171: German')
		assert.equal(withShortcut(DE.Table, 'table', false), 'Tabelle (B)', 'job 173: German')
		assert.equal(withShortcut(DE['Mind map'], 'mindmap', false), 'Mindmap (M)', 'job 195: German')
		assert.equal(withShortcut(DE.Pen, 'pen', false), 'Stift (P)', 'job 273: German')
	})
	// job 229: undo and redo in their own island
	const undo = titles(await render(UndoBar, {}))
	assert.deepEqual(undo, ['Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)'])
	const undoMac = titles(await render(UndoBar, { apple: true }))
	assert.deepEqual(undoMac, ['Undo (⌘Z)', 'Redo (⌘⇧Z)'])
	const undoDe = await inGerman(async () => titles(await render(UndoBar, {})))
	assert.deepEqual(undoDe, ['Rückgängig (Strg+Z)', 'Wiederholen (Strg+Umschalt+Z)'])
	assert.ok(![...mac, ...undoMac, ...undoDe].some((x) => x.includes('Ctrl')), 'no Ctrl on Apple or in German')
})

// ---- AK3: context bar ------------------------------------------------------------

const TWO_NOTES = sel(['sticky', 'sticky'], { ids: ['a', 'b'], locked: 0, unlocked: 2, lockable: 2, unlockable: 0, groupable: 2, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false })
const ONE_CONNECTOR = sel(['connector'], { ids: ['c'] })
const LOCKED = sel(['sticky'], { ids: ['a'], locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'mine' }, unlockBy: { kind: 'mine' } })
const MIXED = sel(['sticky', 'sticky'], { ids: ['a', 'b'], locked: 1, unlocked: 1, lockable: 1, unlockable: 1, lockedBy: { kind: 'mine' }, unlockBy: { kind: 'mine' } })

test('job 141 AK3: context bar on a Mac – Delete (⌫), Lock (⌘⇧L), Group items (⌘G), Edit label (↩), Copy (⌘C)', async () => {
	const notes = titles(await render(ContextBar, { selection: TWO_NOTES, apple: true }))
	for (const x of ['Delete (⌫)', 'Lock (⌘⇧L)', 'Group items (⌘G)', 'Copy (⌘C)', 'Cut (⌘X)', 'Duplicate (⌘D)']) {
		assert.ok(notes.includes(x), x + ' in ' + notes.join(' | '))
	}
	const line = titles(await render(ContextBar, { selection: ONE_CONNECTOR, apple: true }))
	assert.ok(line.includes('Edit label (↩)'), line.join(' | '))
	const whole = titles(await render(ContextBar, { selection: { ...TWO_NOTES, grouped: 1, oneGroup: true }, apple: true }))
	assert.ok(whole.includes('Ungroup (⌘⇧G)'), whole.join(' | '))
})

test('job 141 AK3: context bar in German off Apple – Löschen (Entf), Kopieren (Strg+C), Sperren (Strg+Umschalt+L); a blocked group keeps its reason', async () => {
	await inGerman(async () => {
		const notes = titles(await render(ContextBar, { selection: TWO_NOTES }))
		for (const x of ['Löschen (Entf)', 'Kopieren (Strg+C)', 'Sperren (Strg+Umschalt+L)', 'Ausschneiden (Strg+X)', 'Duplizieren (Strg+D)', 'Gruppieren (Strg+G)']) {
			assert.ok(notes.includes(x), x + ' in ' + notes.join(' | '))
		}
		const line = titles(await render(ContextBar, { selection: ONE_CONNECTOR }))
		assert.ok(line.includes('Beschriftung bearbeiten (Enter)'), line.join(' | '))
		const blocked = titles(await render(ContextBar, { selection: { ...TWO_NOTES, groupBlock: 'parent' }, apple: true }))
		assert.ok(blocked.includes(DE['Only items in the same frame, or all outside frames, can be grouped.']), 'the reason, no key')
	})
})

test('job 141 AK3: Unlock names its key only while nothing can be locked (Apple, English, German)', async () => {
	const unlockTitle = async (selection, apple) => {
		const html = await render(ContextBar, { selection, apple })
		return html.match(/<[a-z]+[^>]*data-knorke-action="unlock"[^>]*>/)[0].match(/\stitle="([^"]*)"/)[1]
	}
	assert.equal(await unlockTitle(LOCKED, true), 'Unlock (⌘⇧L)')
	assert.equal(await unlockTitle(LOCKED, false), 'Unlock (Ctrl+Shift+L)')
	assert.equal(await unlockTitle(MIXED, true), 'Unlock')
	assert.equal(await unlockTitle(MIXED, false), 'Unlock')
	await inGerman(async () => {
		assert.equal(await unlockTitle(LOCKED, false), 'Entsperren (Strg+Umschalt+L)')
		assert.equal(await unlockTitle(MIXED, false), 'Entsperren')
	})
})

// ---- AK4: zoom controls and follow banner ----------------------------------------

test('job 141 AK4: zoom controls – ⇧2 with apple, Umschalt in German, + and − everywhere; the follow banner names Esc', async () => {
	// job 229: the bar is −, the zoom menu, +, "Show everything"; the menu's entries name their key as their second line
	const descs = (html) => [...html.matchAll(/\sdescription="([^"]*)"/g)].map((m) => m[1])
	const macHtml = await render(ZoomControls, { hasSelection: true, apple: true })
	const mac = titles(macHtml)
	assert.deepEqual(mac, ['Zoom out (−)', 'Zoom in (+)', 'Show everything (⇧1)'])
	assert.deepEqual(descs(macHtml), ['⇧0', '⇧2', '?'], '100 %, selection, shortcuts')
	const enHtml = await render(ZoomControls, { hasSelection: true })
	const en = titles(enHtml)
	assert.deepEqual(en, ['Zoom out (−)', 'Zoom in (+)', 'Show everything (Shift+1)'])
	assert.deepEqual(descs(enHtml), ['Shift+0', 'Shift+2', '?'])
	await inGerman(async () => {
		const deHtml = await render(ZoomControls, { hasSelection: true })
		assert.deepEqual(titles(deHtml), ['Verkleinern (−)', 'Vergrößern (+)', 'Alles zeigen (Umschalt+1)'])
		assert.deepEqual(descs(deHtml), ['Umschalt+0', 'Umschalt+2', '?'])
		const banner = titles(await render(FollowBanner, { following: { pid: 'p', name: 'Alice', summon: false } }))
		assert.deepEqual(banner, ['Nicht mehr folgen (Esc)', 'Hinweis schließen'], 'job 228: then the close button')
	})
	assert.deepEqual(titles(await render(FollowBanner, { following: { pid: 'p', name: 'Alice', summon: true } })), ['Stop following (Esc)', 'Close notice'])
})

// ---- AK5: the context menu -------------------------------------------------------

test('job 141 AK5: menuShortcut in German – Strg+X, Entf, Strg+Umschalt+L, Umschalt+2; aria and the Apple values unchanged', async () => {
	await inGerman(() => {
		assert.deepEqual(menuShortcut('cut', false), { hint: 'Strg+X', aria: 'Control+X' })
		assert.deepEqual(menuShortcut('delete', false), { hint: 'Entf', aria: 'Delete' })
		assert.deepEqual(menuShortcut('lock', false), { hint: 'Strg+Umschalt+L', aria: 'Control+Shift+L' })
		assert.deepEqual(menuShortcut('zoom-selection', false), { hint: 'Umschalt+2', aria: 'Shift+2' })
		assert.deepEqual(menuShortcut('cut', true), { hint: '⌘X', aria: 'Meta+X' })
		assert.deepEqual(menuShortcut('delete', true), { hint: '⌫', aria: 'Backspace' })
		assert.deepEqual(menuShortcut('lock', true), { hint: '⌘⇧L', aria: 'Meta+Shift+L' })
		assert.deepEqual(menuShortcut('zoom-selection', true), { hint: '⇧2', aria: 'Shift+2' })
	})
})

test('job 141 AK5: the menu keeps its entries and keys – the same hints and aria for every MENU_ITEMS entry as before the job (English)', () => {
	/** menuShortcut before job 141 (English): entry → [hint, aria, Apple hint, Apple aria] */
	const before = {
		cut: ['Ctrl+X', 'Control+X', '⌘X', 'Meta+X'],
		copy: ['Ctrl+C', 'Control+C', '⌘C', 'Meta+C'],
		duplicate: ['Ctrl+D', 'Control+D', '⌘D', 'Meta+D'],
		delete: ['Del', 'Delete', '⌫', 'Backspace'],
		'edit-text': ['Enter', 'Enter', '↩', 'Enter'],
		'zoom-selection': ['Shift+2', 'Shift+2', '⇧2', 'Shift+2'],
		'paste-here': ['Ctrl+V', 'Control+V', '⌘V', 'Meta+V'],
		'select-all': ['Ctrl+A', 'Control+A', '⌘A', 'Meta+A'],
		fit: ['Shift+1', 'Shift+1', '⇧1', 'Shift+1'],
		grid: ['G', 'G', 'G', 'G'],
		group: ['Ctrl+G', 'Control+G', '⌘G', 'Meta+G'],
		ungroup: ['Ctrl+Shift+G', 'Control+Shift+G', '⌘⇧G', 'Meta+Shift+G'],
		lock: ['Ctrl+Shift+L', 'Control+Shift+L', '⌘⇧L', 'Meta+Shift+L'],
		unlock: ['Ctrl+Shift+L', 'Control+Shift+L', '⌘⇧L', 'Meta+Shift+L'],
		// job 147: the entry came later, with its single key
		cursors: ['C', 'C', 'C', 'C'],
		// job 195: the entries of a mind map node, with the keys at a focus
		'mm-child': ['Tab', 'Tab', 'Tab', 'Tab'],
		'mm-sibling': ['Enter', 'Enter', '↩', 'Enter'],
		'mm-delete': ['Del', 'Delete', '⌫', 'Backspace'],
	}
	for (const name of MENU_ITEMS) {
		const b = before[name]
		assert.deepEqual(menuShortcut(name, false), b ? { hint: b[0], aria: b[1] } : null, name)
		assert.deepEqual(menuShortcut(name, true), b ? { hint: b[2], aria: b[3] } : null, name + ' (Apple)')
	}
	for (const name of ['undo', 'redo', 'paste', 'zoom-in', 'select', 'stop-following']) {
		assert.equal(menuShortcut(name, false), null, name + ' is no menu entry')
	}
})

test('job 141 AK5: the rendered menu in German shows the translated hint (aria-hidden) and keeps aria-keyshortcuts', async () => {
	const html = await inGerman(() => render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 1 }, selection: sel(['sticky'], { ids: ['id0'] }), host: null, canPaste: false, apple: false }))
	const cut = html.match(/<button[^>]*data-knorke-menu-item="cut"[^>]*>[\s\S]*?<\/button>/)[0]
	assert.match(cut, /aria-keyshortcuts="Control\+X"/)
	assert.match(cut, /<span class="knorke-contextmenu__key" aria-hidden="true">Strg\+X<\/span>/)
	const del = html.match(/<button[^>]*data-knorke-menu-item="delete"[^>]*>[\s\S]*?<\/button>/)[0]
	assert.match(del, /aria-keyshortcuts="Delete"/)
	assert.match(del, /aria-hidden="true">Entf<\/span>/)
	// job 230: zoom-selection left the menu (the zoom bar and Shift+2 have it); duplicate shows its key the same way
	const dup = html.match(/<button[^>]*data-knorke-menu-item="duplicate"[^>]*>[\s\S]*?<\/button>/)[0]
	assert.match(dup, /aria-keyshortcuts="Control\+D"/)
	assert.match(dup, /aria-hidden="true">Strg\+D<\/span>/)
})

// ---- AK7: the copy prompt of the share links -------------------------------------

test('job 141 AK7: copyPrompt – ⌘C on Apple, Ctrl+C elsewhere, "Link markiert. Mit Strg+C kopieren." in German', async () => {
	assert.equal(copyPrompt(true), 'Link selected. Press ⌘C to copy it.')
	assert.equal(copyPrompt(false), 'Link selected. Press Ctrl+C to copy it.')
	await inGerman(() => {
		assert.equal(copyPrompt(false), 'Link markiert. Mit Strg+C kopieren.')
		assert.equal(copyPrompt(true), 'Link markiert. Mit ⌘C kopieren.')
	})
	assert.ok(!('Link selected. Press Ctrl+C to copy it.' in DE), 'the old text is gone from de.json')
})

test('job 141 AK7: ShareLinks – copying fails (no clipboard, no execCommand): the toast names the platform\'s copy key', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
	const docDesc = Object.getOwnPropertyDescriptor(globalThis, 'document')
	const toasts = []
	const element = () => ({
		className: '',
		textContent: '',
		parentNode: null,
		classList: { add() {} },
		setAttribute() {},
		addEventListener() {},
		remove() {},
		appendChild(c) {
			toasts.push(c)
		},
	})
	// a document without execCommand: copyText gives up, the toast container is a plain element
	Object.defineProperty(globalThis, 'document', { value: { body: { contains: () => true, appendChild() {} }, createElement: element }, configurable: true, writable: true })
	const setPlatform = (platform) => Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true, writable: true })
	const props = {
		links: { edit: { url: 'https://cloud.example/s/abc' }, vote: null },
		linkPolicy: {}, drafts: {}, settingsOpen: {}, qrOpen: {}, errors: {}, today: '2026-10-23',
	}
	try {
		for (const [platform, german, text] of [
			['MacIntel', false, 'Link selected. Press ⌘C to copy it.'],
			['Win32', false, 'Link selected. Press Ctrl+C to copy it.'],
			['Win32', true, 'Link markiert. Mit Strg+C kopieren.'],
		]) {
			setPlatform(platform)
			const { bindings } = setupOf(ShareLinks, props)
			const before = toasts.length
			if (german) {
				await inGerman(() => bindings.copy('edit'))
			} else {
				await bindings.copy('edit')
			}
			assert.equal(toasts.length, before + 1, platform + ': one toast')
			assert.equal(toasts.at(-1).textContent, text, platform)
		}
	} finally {
		for (const [key, desc] of [['navigator', navDesc], ['document', docDesc]]) {
			if (desc) {
				Object.defineProperty(globalThis, key, desc)
			} else {
				delete globalThis[key]
			}
		}
	}
})

// ---- AK8: no hard-wired hints ----------------------------------------------------

/**
 * The string literals of a JS or Vue source, comments left out ('//', block
 * comments, HTML comments): '…', "…" and `…`, each with its quotes. A "…"
 * in a Vue template is an attribute value, so it holds the bound expression
 * with its own '…' literals.
 *
 * @param {string} src source text
 * @return {string[]} literals
 */
function literals(src) {
	const out = []
	let i = 0
	while (i < src.length) {
		if (src.startsWith('<!--', i)) {
			const e = src.indexOf('-->', i + 4)
			i = e < 0 ? src.length : e + 3
			continue
		}
		if (src.startsWith('//', i)) {
			const e = src.indexOf('\n', i)
			i = e < 0 ? src.length : e
			continue
		}
		if (src.startsWith('/*', i)) {
			const e = src.indexOf('*/', i + 2)
			i = e < 0 ? src.length : e + 2
			continue
		}
		const q = src[i]
		if (q === '\'' || q === '"' || q === '`') {
			let j = i + 1
			while (j < src.length && src[j] !== q && !(q !== '`' && src[j] === '\n')) {
				j += src[j] === '\\' ? 2 : 1
			}
			out.push(src.slice(i, j + 1))
			i = j + 1
			continue
		}
		i++
	}
	return out
}

/** The spec's patterns (with the quote) and, stricter, the same without it. */
const HARD_WIRED = Object.freeze(['\' (Ctrl+', '\' (Shift+', '\' (Del)', '\' (Esc)', '\' (Enter)', '\'Ctrl+', '\'⌘', ' (Ctrl+', ' (Shift+', ' (Del)', ' (Esc)', ' (Enter)', 'Ctrl+', '⌘'])

/**
 * @param {string} src source text
 * @return {string[]} the literals with a hard-wired key hint
 */
const hardWired = (src) => literals(src).filter((l) => HARD_WIRED.some((p) => l.includes(p)))

/**
 * @param {string} dir directory
 * @return {string[]} every .js and .vue file below it
 */
function sources(dir) {
	const out = []
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, e.name)
		if (e.isDirectory()) {
			out.push(...sources(full))
		} else if (/\.(?:js|vue)$/.test(e.name)) {
			out.push(full)
		}
	}
	return out
}

test('job 141 AK8: the scanner finds the old hard-wired forms and skips comments', () => {
	assert.equal(hardWired(':title="t(\'knorke\', \'Undo\') + \' (Ctrl+Z)\'"').length, 1)
	assert.equal(hardWired('const s = apple ? \'⌘V\' : \'Ctrl+V\'').length, 2)
	assert.equal(hardWired(':title="tool.label + \' (\' + tool.key + \')\'" :x="t(\'knorke\', \'Stop following\') + \' (Esc)\'"').length, 1)
	assert.equal(hardWired('showInfo(t(\'knorke\', \'Link selected. Press Ctrl+C to copy it.\'))').length, 1)
	assert.equal(hardWired('x = "Delete (Del)"; y = `Undo (Ctrl+Z)`').length, 2, 'double quotes and template literals too')
	assert.deepEqual(hardWired('// Ctrl/⌘+Shift+L locks\n/* \'Ctrl+C\' ⌘ */\n<!-- \'⌘V\' -->\nconst url = \'https://x//y\'\n'), [])
})

test('job 141 AK8: no .js or .vue file under src/ but the formatter has a hard-wired key hint in a string literal', () => {
	const files = sources(join(ROOT, 'src')).map((f) => relative(ROOT, f).split('\\').join('/'))
	assert.ok(files.includes('src/components/Toolbar.vue') && files.includes('src/board/BoardSession.js') && files.length > 100, 'the scan covers src/')
	const found = []
	for (const f of files) {
		if (f === 'src/util/shortcuts.js') {
			continue
		}
		for (const l of hardWired(readFileSync(join(ROOT, f), 'utf8'))) {
			found.push(`${f}: ${l}`)
		}
	}
	assert.deepEqual(found, [])
	assert.ok(hardWired(readFileSync(join(ROOT, 'src/util/shortcuts.js'), 'utf8')).length > 0, 'the formatter itself holds the symbols')
})

test('job 271 AK6: search is Ctrl/⌘+F (German Strg+F)', async () => {
	assert.deepEqual(shortcut('search', false), { hint: 'Ctrl+F', aria: 'Control+F' })
	assert.deepEqual(shortcut('search', true), { hint: '⌘F', aria: 'Meta+F' })
	await inGerman(() => assert.deepEqual(shortcut('search', false), { hint: 'Strg+F', aria: 'Control+F' }))
})
