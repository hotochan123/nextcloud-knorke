/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 145, the shortcuts overview:
 * - AK3: shortcutGroups({mode: 'edit'}) (components/shortcutList.js) gives
 *   the six groups in order; every name of SHORTCUT_NAMES but unlock occurs,
 *   every key comes from shortcut() (English, German, Apple).
 * - AK4: vote and view hold exactly View (no zoom to selection) and the
 *   wheel zoom, of the gestures only two fingers; edit has both gestures;
 *   touch puts the gestures first, else last.
 * - AK5: (job 229: the round "?" button is gone) the zoom menu of
 *   ZoomControls (SSR) ends with "Keyboard shortcuts" and its key ?, with
 *   and without a selection; its click emits shortcuts; the menu's trigger
 *   gets the focus back.
 * - ShortcutsDialog (SSR): the groups as headings, the keys as <kbd> with the
 *   formatter's hints, two names with " / "; Esc closes only this dialog
 *   (preventDefault, stopPropagation), never one on top of it.
 * Factory job 161:
 * - AK1: a new ? (Shift allowed) closes the overview like Esc; not with
 *   Ctrl/⌘/Alt, a repeat, during IME composition, nor from a dialog on top.
 * - AK2: util/device.js hasTouchScreen is maxTouchPoints > 0 or
 *   (any-pointer: coarse): a touch laptop and a tablet are touch screens.
 * - AK3: touch: gestures first in every mode, "With mouse or pen" stays.
 * - The click beside the box (onPointer): press, release and click on the
 *   backdrop close; inside the box, another dialog, other buttons, a second
 *   finger or a release elsewhere do not; every backdrop event stops.
 * Factory job 174, AK5: "While writing" gets the rows of a table's cell
 * editor (Tab / Shift+Tab, the arrows) in mode edit, German texts.
 * Factory job 190, AK6: "With mouse or pen" gets "Selection frame: only
 * locked items" with Alt in mode edit, not in vote and view.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { register, unregister } from '@nextcloud/l10n'
import { shortcutGroups } from '../../../src/components/shortcutList.js'
import { TOOLS } from '../../../src/model/tools.js'
import { hasTouchScreen } from '../../../src/util/device.js'
import { SHORTCUT_NAMES, shortcut } from '../../../src/util/shortcuts.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ZoomControls = (await import('../../../src/components/ZoomControls.vue')).default
const ShortcutsDialog = (await import('../../../src/components/ShortcutsDialog.vue')).default

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DE = JSON.parse(readFileSync(join(ROOT, 'l10n', 'de.json'), 'utf8')).translations
const render = async (C, props) => (await renderToString(createSSRApp(C, props))).replace(/<!--[^>]*-->/g, '')

/**
 * @param {() => unknown} fn test body, run with the German bundle registered
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

/** @return {string[]} the names of every key of the groups, in order */
const namesOf = (groups) => groups.flatMap((g) => g.rows.flatMap((r) => r.keys.map((k) => k.name)))
/** @return {Array<[string, string[]]>} [label, names] of a group's rows */
const rowsOf = (g) => g.rows.map((r) => [r.label, r.keys.map((k) => k.name)])

// ---- AK3: mode edit ------------------------------------------------------------

test('job 145 AK3: edit – Tools, Edit, Selection, View, While writing, With mouse or pen, then Finger gestures; the tools from TOOLS with toolLabel', () => {
	const g = shortcutGroups({ mode: 'edit' })
	// job 195: the mind map's keys after "While writing"
	assert.deepEqual(g.map((x) => x.id), ['tools', 'edit', 'selection', 'view', 'writing', 'mindmap', 'pointer', 'gestures'])
	assert.deepEqual(g.map((x) => x.title), ['Tools', 'Edit', 'Selection', 'View', 'While writing', 'Mind map', 'With mouse or pen', 'Finger gestures'])
	// job 171: the laser pointer, with K (job 273: then the pen, with P); job 173 AK6: the table after the text, with B
	assert.deepEqual(rowsOf(g[0]), [['Select', ['select']], ['Pan', ['hand']], ['Sticky note', ['sticky']], ['Shape', ['shape']], ['Text', ['text']], ['Table', ['table']], ['Mind map', ['mindmap']], ['Connector', ['connector']], ['Frame', ['frame']], ['Laser pointer', ['laser']], ['Pen', ['pen']]])
	assert.deepEqual(g[0].rows.map((r) => r.keys[0].hint), TOOLS.map((x) => x.key.toUpperCase()))
	assert.deepEqual(namesOf([g[1]]), ['undo', 'redo', 'copy', 'cut', 'paste', 'paste-in-place', 'duplicate', 'delete', 'edit-text', 'group', 'ungroup', 'lock', 'neighbour'])
	assert.deepEqual(namesOf([g[2]]), ['select-all', 'next-item', 'previous-item', 'deselect', 'nudge', 'nudge-big', 'context-menu'])
	assert.deepEqual(namesOf([g[3]]), ['zoom-in', 'zoom-out', 'zoom-100', 'fit', 'zoom-selection', 'grid', 'cursors', 'stop-following', 'search', 'shortcuts'])
	// job 174 AK5: the two rows of a table's cell editor
	assert.deepEqual(rowsOf(g[4]), [
		['Finish editing', ['end-edit', 'end-edit-mod']],
		['Finish and start the next note to the right', ['next-note']],
		['Table: next or previous cell', ['next-cell', 'previous-cell']],
		['Table: neighbouring cell at the edge of the text', ['cell-arrows']],
		// job 279: Markdown
		['Bold', ['bold']],
		['Italic', ['italic']],
	])
	// job 190 AK6: the marquee with Alt takes only locked items
	assert.deepEqual(rowsOf(g[6]), [
		['Drag: move the view', ['hold-space']],
		['Click: add to or remove from the selection', ['hold-shift']],
		['Selection frame: only locked items', ['hold-alt']],
		['Scroll: zoom', ['hold-mod']],
		['Drag: no snapping', ['hold-mod']],
		// job 279
		['Click a link in a text: open it', ['hold-mod']],
		['Corner handle: keep or free the proportions', ['hold-shift']],
		['Rotate: 15° steps', ['hold-shift']],
		['Resize: from the centre', ['hold-alt']],
	])
	const labels = Object.fromEntries(g.flatMap((x) => x.rows.map((r) => [r.keys[0]?.name, r.label])))
	assert.equal(labels.lock, 'Lock or unlock')
	assert.equal(labels.neighbour, 'Add an item beside it')
	assert.equal(labels.deselect, 'Clear the selection or cancel')
	assert.equal(labels.grid, 'Show or hide the grid')
})

test('job 145 AK3: every name of SHORTCUT_NAMES but unlock occurs in edit; every key is shortcut(name, apple), English, German and Apple', async () => {
	const check = () => {
		for (const apple of [false, true]) {
			const g = shortcutGroups({ mode: 'edit', apple })
			const names = namesOf(g)
			assert.deepEqual([...new Set(names)].sort(), SHORTCUT_NAMES.filter((n) => n !== 'unlock').sort(), 'apple ' + apple)
			for (const k of g.flatMap((x) => x.rows.flatMap((r) => r.keys))) {
				assert.deepEqual(k, { name: k.name, ...shortcut(k.name, apple) }, `${k.name}, apple ${apple}`)
			}
		}
	}
	check()
	await inGerman(() => {
		check()
		const g = shortcutGroups({ mode: 'edit' })
		assert.deepEqual(g.map((x) => x.title), ['Werkzeuge', 'Bearbeiten', 'Auswahl', 'Ansicht', 'Beim Schreiben', 'Mindmap', 'Mit Maus oder Stift', 'Fingergesten'])
		const paste = g[1].rows.find((r) => r.keys[0].name === 'paste-in-place')
		assert.deepEqual([paste.label, paste.keys[0].hint], ['An derselben Stelle einfügen', 'Strg+Umschalt+V'])
		assert.equal(g[6].rows[0].keys[0].hint, 'Leertaste')
	})
	const mac = shortcutGroups({ mode: 'edit', apple: true })
	assert.deepEqual(mac[4].rows[0].keys.map((k) => k.hint), ['Esc', '⌘↩'])
	assert.equal(mac[1].rows.find((r) => r.keys[0].name === 'neighbour').keys[0].hint, '⌥←↑→↓')
})

test('job 195 AK5: "Mind map" shows the keys at a focused node (Tab, Enter, the arrows, F2, Del, Shift+Enter) in edit only', async () => {
	const g = shortcutGroups({ mode: 'edit' }).find((x) => x.id === 'mindmap')
	assert.deepEqual(g.rows.map((r) => [r.label, r.keys.map((k) => k.hint)]), [
		['Add a child', ['Tab']], ['Add a sibling', ['Enter']], ['Go to the next node', ['←↑→↓']], ['Edit the node', ['F2']],
		['Delete the branch', ['Del']], ['While writing: a new line', ['Shift+Enter']],
	])
	for (const mode of ['vote', 'view']) assert.equal(shortcutGroups({ mode }).some((x) => x.id === 'mindmap'), false, mode)
	await inGerman(() => {
		const de = shortcutGroups({ mode: 'edit' }).find((x) => x.id === 'mindmap')
		assert.deepEqual(de.rows.map((r) => r.label), ['Kind anhängen', 'Geschwister anhängen', 'Zum nächsten Knoten', 'Knoten bearbeiten', 'Ast löschen', 'Beim Schreiben: neue Zeile'])
		assert.deepEqual(de.rows.map((r) => r.keys[0].hint), ['Tab', 'Enter', '←↑→↓', 'F2', 'Entf', 'Umschalt+Enter'])
	})
})

test('job 174 AK5: "While writing" shows the cell keys (Tab / Shift+Tab, the arrows) in edit only, with German texts', async () => {
	const keysOf = (g, label) => g.find((x) => x.id === 'writing').rows.find((r) => r.label === label).keys.map((k) => k.hint)
	const g = shortcutGroups({ mode: 'edit' })
	assert.deepEqual(keysOf(g, 'Table: next or previous cell'), ['Tab', 'Shift+Tab'])
	assert.deepEqual(keysOf(g, 'Table: neighbouring cell at the edge of the text'), ['←↑→↓'])
	assert.deepEqual(keysOf(shortcutGroups({ mode: 'edit', apple: true }), 'Table: next or previous cell'), ['Tab', '⇧Tab'])
	for (const mode of ['vote', 'view']) {
		assert.equal(shortcutGroups({ mode }).some((x) => x.id === 'writing'), false, mode)
	}
	await inGerman(() => {
		const de = shortcutGroups({ mode: 'edit' }).find((x) => x.id === 'writing').rows.map((r) => [r.label, r.keys.map((k) => k.hint)])
		assert.deepEqual(de.slice(2, 4), [['Tabelle: nächste oder vorige Zelle', ['Tab', 'Umschalt+Tab']], ['Tabelle: Nachbarzelle am Rand des Textes', ['←↑→↓']]])
		// job 279: bold and italic after them
		assert.deepEqual(de.slice(4), [['Fett', ['Strg+B']], ['Kursiv', ['Strg+I']]])
	})
})

// ---- AK4: modes vote and view, the gestures ----------------------------------

test('job 145 AK4: vote and view – exactly View (zoom in/out/100, fit, grid, cursors (job 147), stop following, shortcuts) and "Scroll: zoom"; of the gestures only two fingers', () => {
	for (const mode of ['vote', 'view']) {
		const g = shortcutGroups({ mode })
		assert.deepEqual(g.map((x) => x.id), ['view', 'pointer', 'gestures'], mode)
		assert.deepEqual(namesOf([g[0]]), ['zoom-in', 'zoom-out', 'zoom-100', 'fit', 'grid', 'cursors', 'stop-following', 'search', 'shortcuts'], mode)
		assert.deepEqual(rowsOf(g[1]), [['Scroll: zoom', ['hold-mod']]], mode)
		assert.deepEqual(rowsOf(g[2]), [['Two fingers: zoom and move the view', []]], mode)
	}
	const edit = shortcutGroups({ mode: 'edit' })
	assert.deepEqual(rowsOf(edit.at(-1)), [['Hold a finger still, then drag: select several items', []], ['Two fingers: zoom and move the view', []]])
})

test('job 190 AK6: "Selection frame: only locked items" with Alt (⌥) in "With mouse or pen" of mode edit only, right after Shift+click; German text', async () => {
	const rowOf = (g) => g.find((x) => x.id === 'pointer').rows.find((r) => r.keys[0]?.name === 'hold-alt' && r.label !== 'Resize: from the centre') ?? null
	const row = rowOf(shortcutGroups({ mode: 'edit' }))
	assert.equal(row.label, 'Selection frame: only locked items')
	assert.deepEqual(row.keys, [{ name: 'hold-alt', ...shortcut('hold-alt', false) }])
	assert.equal(rowOf(shortcutGroups({ mode: 'edit', apple: true })).keys[0].hint, shortcut('hold-alt', true).hint)
	const pointer = shortcutGroups({ mode: 'edit' }).find((x) => x.id === 'pointer').rows.map((r) => r.label)
	assert.equal(pointer.indexOf('Selection frame: only locked items'), pointer.indexOf('Click: add to or remove from the selection') + 1)
	for (const mode of ['vote', 'view']) {
		for (const touch of [false, true]) {
			assert.equal(shortcutGroups({ mode, touch }).flatMap((g) => g.rows).some((r) => r.label === 'Selection frame: only locked items'), false, mode)
		}
	}
	const de = await inGerman(() => rowOf(shortcutGroups({ mode: 'edit' })))
	assert.equal(de.label, 'Auswahlrahmen: nur gesperrte Objekte')
})

test('job 147 AK7: View has the row "Show or hide other people\'s cursors" (cursors, C) directly after the grid, in edit, vote and view; German text', async () => {
	for (const mode of ['edit', 'vote', 'view']) {
		for (const apple of [false, true]) {
			const view = shortcutGroups({ mode, apple }).find((g) => g.id === 'view')
			const i = view.rows.findIndex((r) => r.keys[0]?.name === 'grid')
			const row = view.rows[i + 1]
			assert.ok(i >= 0, mode)
			assert.equal(row.label, 'Show or hide other people\'s cursors', mode)
			assert.deepEqual(row.keys, [{ name: 'cursors', hint: 'C', aria: 'C' }], mode + (apple ? ' (Apple)' : ''))
		}
	}
	const de = await inGerman(() => shortcutGroups({ mode: 'vote' }).find((g) => g.id === 'view').rows.find((r) => r.keys[0]?.name === 'cursors'))
	assert.equal(de.label, 'Cursor der anderen ein- oder ausblenden')
	assert.equal(de.keys[0].hint, 'C')
})

test('job 145 AK4: touch puts Finger gestures first, a computer last – in every mode', () => {
	for (const mode of ['edit', 'vote', 'view']) {
		const touch = shortcutGroups({ mode, touch: true })
		const desk = shortcutGroups({ mode, touch: false })
		assert.equal(touch[0].id, 'gestures', mode)
		assert.equal(desk.at(-1).id, 'gestures', mode)
		assert.deepEqual(touch.slice(1).map((x) => x.id), desk.slice(0, -1).map((x) => x.id), mode + ': the rest in the same order')
	}
	assert.equal(shortcutGroups().at(-1).id, 'gestures', 'defaults: edit, not touch')
	assert.equal(shortcutGroups()[0].id, 'tools')
})

test('job 161 AK2: hasTouchScreen is maxTouchPoints > 0 or (any-pointer: coarse) – a touch laptop and a tablet are touch screens, a computer without touch is not', () => {
	/** A fake window: navigator.maxTouchPoints (undefined: no navigator) and the media queries that match. */
	const win = (points, queries) => ({
		...(points === undefined ? {} : { navigator: { maxTouchPoints: points } }),
		matchMedia: (q) => ({ matches: queries.includes(q) }),
	})
	assert.equal(hasTouchScreen(win(10, ['(any-pointer: coarse)', '(pointer: fine)', '(any-pointer: fine)'])), true, 'touch laptop')
	assert.equal(hasTouchScreen({ navigator: { maxTouchPoints: 5 } }), true, 'only maxTouchPoints 5')
	assert.equal(hasTouchScreen(win(0, ['(any-pointer: coarse)'])), true, 'only (any-pointer: coarse)')
	assert.equal(hasTouchScreen(win(undefined, ['(any-pointer: coarse)'])), true, '(any-pointer: coarse) without a navigator')
	assert.equal(hasTouchScreen(win(5, ['(pointer: coarse)', '(any-pointer: coarse)'])), true, 'tablet')
	assert.equal(hasTouchScreen(win(0, [])), false, 'computer without touch')
	assert.equal(hasTouchScreen(win(0, ['(pointer: fine)', '(any-pointer: fine)'])), false, 'computer with a mouse')
	assert.equal(hasTouchScreen({}), false, '{}')
	assert.equal(hasTouchScreen(undefined), false, 'undefined')
	assert.equal(hasTouchScreen({ navigator: { maxTouchPoints: 0 }, matchMedia: () => { throw new Error('x') } }), false, 'matchMedia throws, no touch points')
	assert.equal(hasTouchScreen({ navigator: { maxTouchPoints: 2 }, matchMedia: () => { throw new Error('x') } }), true, 'matchMedia throws, touch points')
	const throwing = { get navigator() { throw new Error('x') }, matchMedia: (q) => ({ matches: q === '(any-pointer: coarse)' }) }
	assert.equal(hasTouchScreen(throwing), true, 'navigator throws, (any-pointer: coarse)')
	assert.equal(hasTouchScreen({ get navigator() { throw new Error('x') } }), false, 'navigator throws, no matchMedia')
})

test('job 161 AK3: touch – Finger gestures first in every mode and "With mouse or pen" stays; without touch the gestures last', () => {
	for (const mode of ['edit', 'vote', 'view']) {
		const touch = shortcutGroups({ mode, touch: true }).map((g) => g.id)
		const desk = shortcutGroups({ mode, touch: false }).map((g) => g.id)
		assert.equal(touch[0], 'gestures', mode)
		assert.ok(touch.includes('pointer'), mode + ': With mouse or pen')
		assert.equal(desk.at(-1), 'gestures', mode)
		assert.ok(desk.includes('pointer'), mode)
	}
	assert.equal(shortcutGroups({ mode: 'edit', touch: true })[1].id, 'tools', 'then the tools')
})

// ---- AK5: the "?" button of the zoom controls ---------------------------------

/**
 * @param {string} html rendered HTML
 * @return {string[]} the data-knorke-action values in document order
 */
const actions = (html) => [...html.matchAll(/data-knorke-action="([^"]+)"/g)].map((m) => m[1])

/**
 * @param {string} html rendered HTML
 * @return {string} the opening tag of the menu entry "Keyboard shortcuts"
 */
const shortcutsTag = (html) => html.match(/<div[^>]*data-knorke-action="shortcuts"[^>]*>/)[0]

test('job 145 AK5, job 229: the zoom menu ends with "Keyboard shortcuts" and its key ?, with and without a selection, in English and German; no round "?" button', async () => {
	for (const hasSelection of [false, true]) {
		const html = await render(ZoomControls, { hasSelection })
		assert.deepEqual(actions(html), ['zoom-out', 'zoom-100', 'zoom-selection', 'shortcuts', 'zoom-in', 'zoom-fit'], 'selection ' + hasSelection)
		const tag = shortcutsTag(html)
		assert.match(tag, /data-stub="NcActionButton"/)
		assert.match(tag, /description="\?"/)
		assert.match(html, /data-knorke-action="shortcuts"[^>]*>[\s\S]*?Keyboard shortcuts/)
		assert.doesNotMatch(html, /knorke-zoom__shortcuts/)
	}
	await inGerman(async () => {
		assert.match(await render(ZoomControls, { hasSelection: true }), /data-knorke-action="shortcuts"[^>]*>[\s\S]*?Tastenkürzel/)
	})
})

test('job 145 AK5, job 229: the menu entry emits shortcuts with the click event; focusShortcuts gives the menu\'s trigger the focus', () => {
	const src = readFileSync(new URL('../../../src/components/ZoomControls.vue', import.meta.url), 'utf8')
	assert.match(src, /data-knorke-action="shortcuts"\s+@click="\(e\) => \$emit\('shortcuts', e\)"/)
	const { bindings } = setupOf(ZoomControls, { percent: 100, frames: [], hasSelection: false, apple: false })
	assert.equal(bindings.focusShortcuts(), false, 'no trigger yet')
	let focused = 0
	bindings.menuEl.value = { querySelector: (sel) => (sel === '.action-item__menutoggle' ? { focus: () => { focused++ } } : null) }
	assert.equal(bindings.focusShortcuts(), true)
	assert.equal(focused, 1)
})

// ---- the dialog ----------------------------------------------------------------

/**
 * @param {string} html rendered dialog
 * @return {Array<[string, string[]]>} [heading, kbd texts] per group
 */
function sectionsOf(html) {
	return [...html.matchAll(/<section[^>]*data-knorke-shortcuts-group="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map((m) => [
		m[2].match(/<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>/)[1],
		[...m[2].matchAll(/<kbd[^>]*>([\s\S]*?)<\/kbd>/g)].map((k) => k[1].replace(/&amp;/g, '&')),
	])
}

test('job 145: ShortcutsDialog renders the groups as headings and the keys as <kbd> from the formatter; two names with " / "', async () => {
	const html = await render(ShortcutsDialog, { mode: 'edit', apple: false, touch: false })
	assert.match(html, /data-knorke-dialog="shortcuts"/)
	assert.match(html, /name="Keyboard shortcuts"/)
	const s = sectionsOf(html)
	assert.deepEqual(s.map((x) => x[0]), ['Tools', 'Edit', 'Selection', 'View', 'While writing', 'Mind map', 'With mouse or pen', 'Finger gestures'])
	assert.deepEqual(s[0][1], ['V', 'H', 'N', 'S', 'T', 'B', 'M', 'L', 'F', 'K', 'P'])
	assert.deepEqual(s.map((x) => x[1]), shortcutGroups({ mode: 'edit' }).map((g) => g.rows.flatMap((r) => r.keys.map((k) => k.hint))))
	assert.deepEqual(s.at(-1)[1], [], 'the gestures have no keys')
	assert.match(html, /<kbd[^>]*>Esc<\/kbd><span[^>]*> \/ <\/span><kbd[^>]*>Ctrl\+Enter<\/kbd>/)
	const phone = sectionsOf(await render(ShortcutsDialog, { mode: 'view', apple: true, touch: true }))
	assert.deepEqual(phone.map((x) => x[0]), ['Finger gestures', 'View', 'With mouse or pen'])
	assert.deepEqual(phone[2][1], ['⌘'])
	await inGerman(async () => {
		const de = await render(ShortcutsDialog, { mode: 'edit' })
		assert.match(de, /name="Tastenkürzel"/)
		assert.ok(sectionsOf(de)[1][1].includes('Strg+Umschalt+V'))
	})
})

test('job 145: Esc closes only the overview (preventDefault, stopPropagation), wherever the focus is, but not a dialog on top of it; other keys pass', () => {
	const { bindings, emitted } = setupOf(ShortcutsDialog, { mode: 'edit', apple: false, touch: false })
	const ev = (key, target, extra = {}) => {
		const e = { key, target, isComposing: false, prevented: false, stopped: false, ...extra }
		e.preventDefault = () => { e.prevented = true }
		e.stopPropagation = () => { e.stopped = true }
		return e
	}
	const mine = { closest: () => mine }
	const inMine = { closest: () => mine }
	const other = { closest: (sel) => (sel.includes('shortcuts') ? null : other) }
	const inOther = { closest: () => other }
	const canvas = { closest: () => null }
	const a = ev('Escape', inMine)
	assert.equal(bindings.onKey(a), true)
	assert.deepEqual([a.prevented, a.stopped], [true, true])
	const b = ev('Escape', canvas)
	assert.equal(bindings.onKey(b), true, 'the focus still on the canvas (before the focus trap)')
	assert.deepEqual([b.prevented, b.stopped], [true, true])
	const c = ev('Escape', inOther)
	assert.equal(bindings.onKey(c), false, 'a dialog on top keeps its Esc')
	assert.deepEqual([c.prevented, c.stopped], [false, false])
	for (const d of [ev('/', canvas), ev('Tab', inMine), ev('Escape', inMine, { isComposing: true })]) {
		assert.equal(bindings.onKey(d), false, d.key)
		assert.deepEqual([d.prevented, d.stopped], [false, false])
	}
	assert.deepEqual(emitted, [['close'], ['close']])
})

// ---- job 161: ? and a click beside the box close the overview ------------------

/**
 * A fake key or pointer event with recorded preventDefault / stopPropagation.
 *
 * @param {object} fields event fields
 * @return {object} event
 */
function fakeEvent(fields) {
	const e = { isComposing: false, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, stopped: false, ...fields }
	e.preventDefault = () => { e.prevented = true }
	e.stopPropagation = () => { e.stopped = true }
	return e
}

/**
 * Fake elements: the overview's mask (NcModal .modal-mask with
 * data-knorke-dialog="shortcuts"), an element of the backdrop (the
 * .modal-wrapper around the box), one in the box (.modal-container), one in
 * another dialog on top and the canvas (no dialog).
 */
function fakeDom() {
	const mask = { closest: (sel) => (sel.includes('shortcuts') || sel.includes('dialog') ? mask : null) }
	const backdrop = { closest: (sel) => (sel === '.modal-container' ? null : mask) }
	const box = { closest: (sel) => (sel === '.modal-container' ? box : mask) }
	const other = { closest: (sel) => (sel.includes('shortcuts') || sel === '.modal-container' ? null : other) }
	const inOther = { closest: (sel) => (sel.includes('shortcuts') || sel === '.modal-container' ? null : other) }
	const canvas = { closest: () => null }
	return { mask, backdrop, box, other, inOther, canvas }
}

test('job 161 AK1: a new ? closes the overview like Esc (Shift allowed, preventDefault, stopPropagation); not with Ctrl, ⌘ or Alt, a repeat, during IME composition, nor from a dialog on top', () => {
	const { bindings, emitted } = setupOf(ShortcutsDialog, { mode: 'edit', apple: false, touch: false })
	const { box, inOther, canvas } = fakeDom()
	for (const [what, e] of [
		['? on the canvas (before the focus trap)', fakeEvent({ key: '?', target: canvas })],
		['Shift+? in the box (US Shift+/, DE Shift+ß)', fakeEvent({ key: '?', shiftKey: true, target: box })],
		['Esc still', fakeEvent({ key: 'Escape', target: box })],
	]) {
		assert.equal(bindings.onKey(e), true, what)
		assert.deepEqual([e.prevented, e.stopped], [true, true], what)
	}
	assert.equal(emitted.length, 3)
	for (const [what, e] of [
		['Ctrl+?', fakeEvent({ key: '?', ctrlKey: true, target: box })],
		['⌘+?', fakeEvent({ key: '?', metaKey: true, target: box })],
		['Alt+?', fakeEvent({ key: '?', altKey: true, target: box })],
		['a held ? (repeat)', fakeEvent({ key: '?', repeat: true, target: canvas })],
		['Shift+? repeat', fakeEvent({ key: '?', shiftKey: true, repeat: true, target: box })],
		['? while composing', fakeEvent({ key: '?', isComposing: true, target: box })],
		['? in a dialog on top', fakeEvent({ key: '?', target: inOther })],
		['/ (no ?)', fakeEvent({ key: '/', target: canvas })],
	]) {
		assert.equal(bindings.onKey(e), false, what)
		assert.deepEqual([e.prevented, e.stopped], [false, false], what)
	}
	assert.equal(bindings.onKey(undefined), false)
	assert.deepEqual(emitted, [['close'], ['close'], ['close']], 'no close for the others')
})

/**
 * Runs a gesture through the dialog's onPointer.
 *
 * @param {object} bindings setup bindings of ShortcutsDialog
 * @param {object[]} events fake events in order
 * @return {boolean[]} onPointer's results
 */
const gesture = (bindings, events) => events.map((e) => bindings.onPointer(e))

/**
 * The events of a click of the main button: pointerdown, mousedown on
 * `down`, pointerup, mouseup on `up`, click on `click` (default: the backdrop
 * that holds both, as the browser's common ancestor).
 */
function clickOf({ down, up = down, click, pointerType = 'mouse', button = 0, pointerId = 1, isPrimary = true }) {
	const p = { pointerType, button, pointerId, isPrimary, clientX: 10, clientY: 10 }
	return [
		fakeEvent({ type: 'pointerdown', target: down, ...p }),
		fakeEvent({ type: 'mousedown', target: down, button }),
		fakeEvent({ type: 'pointerup', target: up, ...p }),
		fakeEvent({ type: 'mouseup', target: up, button }),
		fakeEvent({ type: 'click', target: click, button }),
	]
}

test('job 161: a click of the main button (mouse, finger, pen) beside the box closes the overview at the click; every event of it stops on the backdrop', () => {
	const { backdrop } = fakeDom()
	for (const pointerType of ['mouse', 'touch', 'pen']) {
		const { bindings, emitted } = setupOf(ShortcutsDialog, { mode: 'edit', apple: false, touch: false })
		const evs = clickOf({ down: backdrop, click: backdrop, pointerType })
		assert.deepEqual(gesture(bindings, evs), [false, false, false, false, true], pointerType + ': only the click closes')
		assert.deepEqual(evs.map((e) => e.stopped), [true, true, true, true, true], pointerType + ': no listener after the window sees them')
		assert.deepEqual(evs.map((e) => e.prevented), [false, false, false, false, true], pointerType + ': the click is prevented')
		assert.deepEqual(emitted, [['close']], pointerType)
	}
})

test('job 161: no close for a press in the box released beside it, a press beside it released in the box, a click in the box, a right or middle click, a second finger, another dialog', () => {
	const { backdrop, box, inOther, canvas } = fakeDom()
	const { bindings, emitted } = setupOf(ShortcutsDialog, { mode: 'edit', apple: false, touch: false })
	// press in the box (selecting text), release beside it: the click goes to the common ancestor
	let evs = clickOf({ down: box, up: backdrop, click: backdrop })
	assert.deepEqual(gesture(bindings, evs), [false, false, false, false, false], 'in → out')
	assert.deepEqual(evs.map((e) => e.stopped), [false, false, true, true, true], 'in → out: the box keeps its own events')
	// press beside it, release in the box
	evs = clickOf({ down: backdrop, up: box, click: backdrop })
	assert.deepEqual(gesture(bindings, evs), [false, false, false, false, false], 'out → in')
	// a click in the box: heading, border, scroll bar
	evs = clickOf({ down: box, click: box })
	assert.deepEqual(gesture(bindings, evs), [false, false, false, false, false], 'in the box')
	assert.deepEqual(evs.map((e) => e.stopped), [false, false, false, false, false], 'the box handles its events')
	// right and middle button on the backdrop (a click event with that button, if any)
	for (const button of [1, 2]) {
		evs = clickOf({ down: backdrop, click: backdrop, button })
		assert.deepEqual(gesture(bindings, evs), [false, false, false, false, false], 'button ' + button)
		assert.ok(evs.every((e) => e.stopped), 'button ' + button + ': stopped on the backdrop')
	}
	// a second finger during the press ends it
	const first = clickOf({ down: backdrop, click: backdrop, pointerType: 'touch', pointerId: 1 })
	const second = fakeEvent({ type: 'pointerdown', target: backdrop, pointerType: 'touch', button: 0, pointerId: 2, isPrimary: false })
	assert.deepEqual(gesture(bindings, [first[0], second, ...first.slice(1)]), [false, false, false, false, false, false], 'two fingers')
	// a click in another dialog on top, and one outside every dialog
	for (const [what, target] of [['other dialog', inOther], ['canvas', canvas]]) {
		evs = clickOf({ down: target, click: target })
		assert.deepEqual(gesture(bindings, evs), [false, false, false, false, false], what)
		assert.ok(evs.every((e) => !e.stopped && !e.prevented), what + ': untouched')
	}
	// a click without a press on the backdrop before it (e.g. synthetic)
	const lone = fakeEvent({ type: 'click', target: backdrop, button: 0 })
	assert.equal(bindings.onPointer(lone), false, 'a click alone')
	assert.deepEqual(emitted, [])
	// after all that, a real click beside the box still closes
	assert.deepEqual(gesture(bindings, clickOf({ down: backdrop, click: backdrop })).at(-1), true)
	assert.deepEqual(emitted, [['close']])
})

test('job 161: a finger keeps its pointerdown target (implicit capture): its release is looked up at the point – lifted in the box, no close', () => {
	const { backdrop, box } = fakeDom()
	const { bindings, emitted } = setupOf(ShortcutsDialog, { mode: 'edit', apple: false, touch: false })
	const had = Object.getOwnPropertyDescriptor(globalThis, 'document')
	let under = box
	globalThis.document = { elementFromPoint: () => under }
	try {
		assert.equal(gesture(bindings, clickOf({ down: backdrop, click: backdrop, pointerType: 'touch' })).at(-1), false, 'lifted over the box')
		under = backdrop
		assert.equal(gesture(bindings, clickOf({ down: backdrop, click: backdrop, pointerType: 'touch' })).at(-1), true, 'lifted beside it')
		under = box
		assert.equal(gesture(bindings, clickOf({ down: backdrop, up: backdrop, click: backdrop, pointerType: 'mouse' })).at(-1), true, 'a mouse uses its target')
	} finally {
		if (had) Object.defineProperty(globalThis, 'document', had)
		else delete globalThis.document
	}
	assert.deepEqual(emitted, [['close'], ['close']])
})
