/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The context menu of the shell (SPEC-M1 §6.6 ContextMenu.vue, §6.8,
 * §6.11, §6.12; stage 4, R19 T4-02/T4-03): entries from the context bar's
 * source (menuEntries), labels and shortcut hints (Meta+… on Apple,
 * Control+… elsewhere), placement (mirror at an axis, then 8 px into the
 * viewport; the outer height capped by the same bounds, UX B9), the APG
 * "Menu" keyboard (roving tabindex, ↓/↑ wrap, Home/End, Enter/Space,
 * Esc/Tab close, every one of them kept from the scene), the DOM hooks and
 * the rendered roles; the focus on the way out (§6.6 R20, K6: a focus
 * inside the unmounting menu goes to the canvas host, never body).
 * Job 230: the entries come in the groups of the context bar's "…"
 * (menuGroups), a separator between two groups (never an entry), "Delete"
 * last in the error colour; the board menu keeps "Mouse wheel", the mass
 * unlocks and the grid, its count line is gone. A press beside the entries
 * (a separator; the root itself while the menu has nothing to scroll,
 * noScrollRange) keeps the focus.
 * Job 044: the moderators' entries unlock-all (board menu) and unlock-frame
 * (on a frame), shown from menu.unlockAll / menu.unlockFrame. Job 062: both
 * mass unlocks last in the board menu (unlock-frame there for the frame
 * under the point), unlock-by after unlock on items (menu.unlockBy,
 * menu.unlockByName, its label as text and title), "Alles entsperren".
 * Job 144: the entries only-<kind> after zoom-selection (selection v2 kinds).
 * Job 151: a guest's lock says "(guest)" in the badge, unlock and unlock-by
 * (menu.unlockByGuest), in English and German; an account's never.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MENU_ITEMS, lockBadgeText, menuBlocked, menuEntries, menuGroups, menuLabel, menuName, menuShortcut, unlockLabel } from '../../../src/components/contextbar.js'
import { icons } from '../../../src/components/icons.js'
import { MENU_MARGIN, intersect, menuKey, menuMaxHeight, noScrollRange, placeMenu } from '../../../src/components/menu.js'
import { isApplePlatform } from '../../../src/util/device.js'
import { TYPES } from '../../../src/model/registry.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
const { createSSRApp, createRenderer, h, markRaw, nextTick, ref } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const ContextMenu = (await import('../../../src/components/ContextMenu.vue')).default

const render = (C, props) => renderToString(createSSRApp(C, props))
const strip = (html) => html.replace(/<!--[^>]*-->/g, '')

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
	return { ids: types.map((_, i) => 'id' + i), count: types.length, types: new Set(types), fields: fields ?? [], mixed: [], canConnect: false, box: null, ...extra }
}

const ON_ITEMS = ['cut', 'copy', 'duplicate', 'front', 'back']
/** (job 178, 200, 205, 179) the exports of the selection, before "Delete" (job 230) */
const EXPORTS = ['export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv']

test('menuEntries (T4-02), job 230: on one note the groups of "…" – cut, copy, duplicate, front, back, the exports, delete last; connect only with the bar\'s "Connect"; no edit-text, zoom-selection or paste-here', () => {
	assert.deepEqual(menuEntries(sel(['sticky']), 'id0'), [...ON_ITEMS, ...EXPORTS, 'delete'])
	assert.deepEqual(menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'id1'), [...ON_ITEMS, 'connect', ...EXPORTS, 'delete'], 'two bindable items: connect')
	assert.deepEqual(menuEntries(sel(['sticky', 'frame']), 'id0'), [...ON_ITEMS, ...EXPORTS, 'delete'], 'a frame is not bindable: no connect')
	assert.deepEqual(menuEntries(sel(['sticky', 'sticky', 'sticky']), 'id0'), [...ON_ITEMS, ...EXPORTS, 'delete'])
	for (const t of ['sticky', 'shape', 'text', 'frame', 'connector']) {
		const list = menuEntries(sel([t]), 'id0', { canPaste: true })
		assert.ok(!list.includes('edit-text') && !list.includes('zoom-selection') && !list.includes('paste-here'), t)
	}
	// one item with a box: "Arrange…" after the order group
	assert.deepEqual(menuEntries(sel(['sticky'], { box: { x: 0, y: 0, w: 10, h: 10, r: 0 } }), 'id0'), [...ON_ITEMS, 'arrange', ...EXPORTS, 'delete'])
})

test('menuEntries (T4-02, T4-03), job 230: on the empty canvas only "Mouse wheel", the mass unlocks, "Show grid" and "Snap to grid"; never paste-here, note-here, pad-here, insert-template, comment, select-all, fit or cursors', () => {
	assert.deepEqual(menuEntries(sel([]), null), [], 'the two-argument call: the menu knows no grid state')
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, comment: true, cursors: true, grid: false }), ['grid'])
	assert.deepEqual(menuEntries(null, null, { grid: true, gridSnap: false, wheel: 'auto', cursors: false }), ['wheel', 'grid', 'grid-snap'])
	assert.deepEqual(menuEntries(null, undefined, { grid: false }), ['grid'])
	for (const list of [menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'x'), menuEntries(null, null, { grid: true, gridSnap: true, wheel: 'pan', unlockAll: 2, unlockFrame: 1 })]) {
		assert.ok(list.every((x) => MENU_ITEMS.includes(x)))
		assert.equal(new Set(list).size, list.length)
	}
	assert.equal(MENU_ITEMS.length, 78, 'job 023: lock and unlock; job 026: group and ungroup; job 044: unlock-frame and unlock-all; job 062: unlock-by; job 139: sort-colors and sort-frame; job 144: only-<kind>; job 147: cursors; job 153: swap-direction; job 154: wheel; job 172: react; job 173: the seven table entries; job 178: export-png; job 179: export-csv; job 180: insert-template; job 182: save-template; job 189: comment; job 188: pad-here; job 191: tags; job 195: the five mind map entries; job 196: mm-rearrange; job 199: the six lane entries; job 200: export-svg and export-pdf; job 205: export-bpmn; job 208: the seven column entries; job 225: the six group entries; job 230: arrange; job 278: frame-around')
	assert.ok(!MENU_ITEMS.some((x) => x === 'paste'), 'no generic paste entry')
})

test('job 230 AK2: menuGroups – the groups of "…" in the same order on items (the moderators\' unlocks in the lock group, the entries of the point and the exports before delete), no empty group; the board menu in two groups', () => {
	const two = sel(['sticky', 'sticky'], { canConnect: true, sortable: 2, groupable: 2, grouped: 0, oneGroup: false, lockable: 2, unlocked: 2 })
	assert.deepEqual(menuGroups(two, 'id0'), [['cut', 'copy', 'duplicate'], ['front', 'back'], ['connect'], ['sort-colors'], ['group'], ['lock'], EXPORTS, ['delete']])
	assert.deepEqual(menuGroups(two, 'id0', { templateRight: 'suggest' }).at(-2), [...EXPORTS, 'save-template'])
	// fully locked by someone else, a moderator: copy, unlock and the mass unlocks, the exports; no delete
	const locked = sel(['frame'], { locked: 1, unlocked: 0, lockable: 0, unlockable: 1, unlockBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuGroups(locked, 'id0', { unlockBy: 2, unlockByName: 'Bob', unlockFrame: 3 }), [['copy'], ['unlock', 'unlock-by', 'unlock-frame'], EXPORTS])
	// the mass unlocks without unlock of the own: a group of their own
	const none = sel(['frame'], { locked: 1, unlocked: 0, lockable: 0, unlockable: 0 })
	assert.deepEqual(menuGroups(none, 'id0', { unlockFrame: 1 }), [['copy'], ['unlock-frame'], EXPORTS])
	// a table cell: its entries before the exports
	const table = sel(['table'])
	assert.deepEqual(menuGroups(table, 'id0', { table: { rows: 2, cols: 1, locked: false } }).slice(-3), [['row-above', 'row-below', 'col-left', 'col-right', 'row-delete', 'table-csv'], EXPORTS, ['delete']])
	assert.deepEqual(menuGroups(null, null, { wheel: 'zoom', unlockFrame: 1, unlockAll: 4, grid: true, gridSnap: true }), [['wheel', 'unlock-frame', 'unlock-all'], ['grid', 'grid-snap']])
	assert.deepEqual(menuGroups(null, null, { grid: false }), [['grid']])
	assert.deepEqual(menuGroups(null, null), [])
	for (const s of [two, locked, table]) {
		assert.deepEqual(menuEntries(s, 'id0'), menuGroups(s, 'id0').flat())
	}
})

test('labels (§6.11): the bar\'s texts where the bar has the action, the new ones for the rest; root names by target', () => {
	assert.deepEqual(MENU_ITEMS.map(menuLabel), [
		'Cut', 'Copy', 'Duplicate', 'Delete', 'Bring to front', 'Send to back',
		'Add reaction', 'Tags', 'Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete row', 'Delete column', 'Export as CSV',
		'Add child', 'Add sibling', 'Fold branch', 'Rearrange', 'Delete branch', 'Copy as text',
		'Rename lane', 'Add lane above', 'Add lane below', 'Move lane up', 'Move lane down', 'Delete lane',
		'Create lane group', 'Rename lane group', 'Dissolve lane group',
		'Add column', 'Rename column', 'Add column left', 'Add column right', 'Move column left', 'Move column right', 'Delete column',
		'Create column group', 'Rename column group', 'Dissolve column group',
		'Edit text', 'Swap direction', 'Connect', 'Arrange…', 'Sort by color', 'Sort notes by color', 'Group items', 'Ungroup', 'Frame around', 'Lock', 'Unlock',
		'Unlock all locked by ', 'Unlock all in this frame', 'Zoom to selection', 'Save as image (PNG)', 'Save as SVG', 'Save as PDF…', 'Save as BPMN', 'Save as CSV', 'Suggest as template…', 'Comment',
		'Only notes (0)', 'Only shapes (0)', 'Only text items (0)', 'Only connectors (0)', 'Only frames (0)', 'Only groups (0)',
		'Paste here', 'Add note here', 'Add note pad here', 'Insert template…', 'Select all', 'Show everything', 'Show grid', 'Snap to grid', 'Mouse wheel: Automatic', 'Show other people\'s cursors', 'Unlock all',
	], 'unlock-by without a name (map passes no env; job 154: wheel without a stage is Automatic)')
	assert.equal(menuName('01JA0000000000000000000001'), 'Selection actions')
	assert.equal(menuName(null), 'Board actions')
	// job 230: the entries of "…" take their texts from menuLabel, so the bar and the menu say the same
	const bar = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	assert.match(bar, /function moreLabel\(name\) \{\n\treturn menuLabel\(name, props\.selection\)\n\}/)
})

test('shortcut hints (§6.6): visible and as aria-keyshortcuts – Apple Meta+… with ⌘, elsewhere Control+… with Ctrl', () => {
	assert.deepEqual(menuShortcut('cut', false), { hint: 'Ctrl+X', aria: 'Control+X' })
	assert.deepEqual(menuShortcut('cut', true), { hint: '⌘X', aria: 'Meta+X' })
	assert.deepEqual(menuShortcut('copy', false).aria, 'Control+C')
	assert.deepEqual(menuShortcut('duplicate', true).aria, 'Meta+D')
	assert.deepEqual(menuShortcut('paste-here', false), { hint: 'Ctrl+V', aria: 'Control+V' })
	assert.deepEqual(menuShortcut('select-all', true), { hint: '⌘A', aria: 'Meta+A' })
	assert.deepEqual(menuShortcut('zoom-selection', false), { hint: 'Shift+2', aria: 'Shift+2' })
	assert.deepEqual(menuShortcut('fit', true), { hint: '⇧1', aria: 'Shift+1' })
	assert.deepEqual(menuShortcut('delete', false), { hint: 'Del', aria: 'Delete' })
	assert.deepEqual(menuShortcut('delete', true), { hint: '⌫', aria: 'Backspace' })
	assert.deepEqual(menuShortcut('edit-text', false), { hint: 'Enter', aria: 'Enter' })
	for (const none of ['front', 'back', 'connect', 'note-here', 'pad-here', 'insert-template', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv']) {
		assert.equal(menuShortcut(none, false), null, none)
		assert.equal(menuShortcut(none, true), null, none)
	}
	for (const name of MENU_ITEMS) {
		const s = menuShortcut(name, false)
		if (s) {
			// job 195: Tab (mm-child)
			assert.match(s.aria, /^(?:(?:Control|Meta)\+)?(?:Shift\+)?(?:[A-Z0-9]|Delete|Backspace|Enter|Tab)$/, 'WAI-ARIA key names: ' + name)
			assert.doesNotMatch(menuShortcut(name, true).aria, /Control/, 'no Control on Apple: ' + name)
		}
	}
})

test('isApplePlatform: macOS, iPadOS, iOS (navigator.platform or userAgentData); not Windows, Linux, Android; never throws', () => {
	for (const p of ['MacIntel', 'Macintosh', 'iPad', 'iPhone', 'iPod']) {
		assert.equal(isApplePlatform({ platform: p }), true, p)
	}
	assert.equal(isApplePlatform({ userAgentData: { platform: 'macOS' }, platform: '' }), true)
	for (const p of ['Win32', 'Linux x86_64', 'Linux armv8l', '']) {
		assert.equal(isApplePlatform({ platform: p }), false, p)
	}
	assert.equal(isApplePlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }), false, 'userAgentData first')
	assert.equal(isApplePlatform(null), false)
	assert.equal(isApplePlatform({ get platform() { throw new Error('x') } }), false)
})

const VIEW = { left: 0, top: 0, right: 1280, bottom: 800 }

test('placeMenu (§6.6): top left corner at canvas rect + at; mirrored where it does not fit; then 8 px into the bounds; always wholly inside', () => {
	const size = { width: 220, height: 300 }
	const canvas = { left: 0, top: 50 }
	const bounds = intersect(VIEW, { left: 0, top: 50, right: 1280, bottom: 800 })
	assert.deepEqual(placeMenu({ canvas, at: [100, 100], size, bounds }), { x: 100, y: 150 })
	// right edge: mirrored at the vertical axis through the point
	assert.deepEqual(placeMenu({ canvas, at: [1200, 100], size, bounds }), { x: 980, y: 150 })
	// bottom edge: mirrored at the horizontal axis
	assert.deepEqual(placeMenu({ canvas, at: [100, 700], size, bounds }), { x: 100, y: 450 })
	// E37 (6): 5 px before the bottom right corner of the canvas
	const corner = placeMenu({ canvas, at: [1275, 745], size, bounds })
	assert.deepEqual(corner, { x: 1052, y: 492 }, 'mirrored, then pushed in: the point lies inside the 8 px margin')
	const inside = (p) => p.x >= bounds.left + MENU_MARGIN && p.y >= bounds.top + MENU_MARGIN && p.x + size.width <= bounds.right - MENU_MARGIN && p.y + size.height <= bounds.bottom - MENU_MARGIN
	assert.ok(inside(corner))
	// mirrored would leave the bounds (small viewport, 390 × 844): pushed in with the margin
	const phone = { left: 0, top: 0, right: 390, bottom: 844 }
	assert.deepEqual(placeMenu({ canvas: { left: 0, top: 0 }, at: [200, 10], size, bounds: phone }), { x: 8, y: 10 }, 'mirrored to -20, then pushed in: the left margin')
	assert.deepEqual(placeMenu({ canvas: { left: 0, top: 0 }, at: [200, 10], size: { width: 220, height: 900 }, bounds: phone }).y, 8, 'taller than the bounds: from the top margin')
	// a sweep: every point of the canvas gives a menu wholly inside
	for (let x = 0; x <= 1280; x += 40) {
		for (let y = 0; y <= 750; y += 50) {
			assert.ok(inside(placeMenu({ canvas, at: [x, y], size, bounds })), x + ',' + y)
		}
	}
	assert.deepEqual(intersect(VIEW, { left: -10, top: 50, right: 2000, bottom: 900 }), { left: 0, top: 50, right: 1280, bottom: 800 })
})

test('menuMaxHeight (§6.6, UX B9): the tallest outer height that fits the bounds with the margin above and below, whole px rounded down, ≥ 0; null for bounds or a margin that are no finite numbers; reads only top and bottom', () => {
	assert.equal(menuMaxHeight({ left: 0, top: 50, right: 1280, bottom: 800 }), 734, 'NC 1280 × 800: far above the menu, nothing changes')
	assert.equal(menuMaxHeight({ left: 0, top: 50, right: 1280, bottom: 242 }), 176, 'NC 1280 × 250: board 50 … 242')
	assert.equal(menuMaxHeight({ left: 0, top: 0, right: 1280, bottom: 250 }), 234, 'minimal page 1280 × 250')
	assert.equal(menuMaxHeight({ top: 50, bottom: 291.6 }), 225, 'rounded down: never too large')
	assert.equal(menuMaxHeight({ top: 100, bottom: 110 }), 0, 'less than the two margins: 0, never negative')
	assert.equal(menuMaxHeight({ top: 0, bottom: 100 }, 0), 100)
	assert.equal(menuMaxHeight({ top: 0, bottom: 100 }, 20), 60)
	for (const b of [VIEW, { top: 50, bottom: 242 }, { top: 0, bottom: 250 }, { top: 50, bottom: 291.6 }]) {
		assert.equal(menuMaxHeight(b), menuMaxHeight(b, MENU_MARGIN), 'the default margin is MENU_MARGIN: ' + JSON.stringify(b))
	}
	assert.equal(MENU_MARGIN, 8)
	for (const [bounds, margin] of [
		[null], [undefined], [{}], [{ top: NaN, bottom: 100 }], [{ top: 0, bottom: '250' }], [{ top: 0, bottom: Infinity }],
		[{ top: 0, bottom: 100 }, NaN],
	]) {
		const args = margin === undefined ? [bounds] : [bounds, margin]
		assert.equal(menuMaxHeight(...args), null, 'no finite numbers: ' + String(bounds && JSON.stringify(bounds)) + (args.length > 1 ? ', margin ' + margin : ''))
	}
	const read = []
	const spy = new Proxy({ left: 0, top: 50, right: 1280, bottom: 242 }, { get: (o, k) => { read.push(k); return o[k] } })
	assert.equal(menuMaxHeight(spy), 176)
	assert.deepEqual(read.sort(), ['bottom', 'top'], 'reads only top and bottom')
})

test('menuKey (APG "Menu"): ↓/↑ wrap, Home/End, Enter/Space activate, Esc/Tab close, the menu keys do nothing; everything else is not the menu\'s', () => {
	assert.deepEqual(menuKey({ key: 'ArrowDown' }, 0, 4), { handled: true, index: 1 })
	assert.deepEqual(menuKey({ key: 'ArrowDown' }, 3, 4), { handled: true, index: 0 }, 'wraps')
	assert.deepEqual(menuKey({ key: 'ArrowUp' }, 0, 4), { handled: true, index: 3 }, 'wraps')
	assert.deepEqual(menuKey({ key: 'ArrowUp' }, 2, 4), { handled: true, index: 1 })
	assert.deepEqual(menuKey({ key: 'Home' }, 2, 4), { handled: true, index: 0 })
	assert.deepEqual(menuKey({ key: 'End' }, 0, 4), { handled: true, index: 3 })
	assert.deepEqual(menuKey({ key: 'Enter' }, 2, 4), { handled: true, index: 2, activate: true })
	assert.deepEqual(menuKey({ key: ' ' }, 1, 4), { handled: true, index: 1, activate: true })
	assert.deepEqual(menuKey({ key: 'Escape' }, 1, 4), { handled: true, close: 'esc' })
	assert.deepEqual(menuKey({ key: 'Tab', shiftKey: true }, 1, 4), { handled: true, close: 'tab' })
	assert.deepEqual(menuKey({ key: 'ContextMenu' }, 1, 4), { handled: true, index: 1 })
	assert.deepEqual(menuKey({ key: 'F10', shiftKey: true }, 1, 4), { handled: true, index: 1 })
	for (const key of ['F10', 'a', 'Delete', 'ArrowLeft', 'ArrowRight', 'Shift']) {
		assert.deepEqual(menuKey({ key }, 1, 4), { handled: false }, key)
	}
	assert.deepEqual(menuKey({ key: 'Enter' }, 0, 0), { handled: true, index: 0, activate: false }, 'nothing to activate')
	assert.deepEqual(menuKey({ key: 'ArrowDown' }, 0, 0), { handled: true, index: 0 })
})

const MENU = { id: '01JA0000000000000000000001', at: [10.4, 20.6], seq: 1, items: 3 }

test('ContextMenu.vue renders the hooks of §6.8: one role=menu root (named), target and at (whole px), menuitem buttons with roving tabindex and aria-keyshortcuts, never data-knorke-action', async () => {
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false }))
	const root = /^<div[^>]*>/.exec(html)[0]
	assert.match(root, /class="knorke-contextmenu"/)
	assert.match(root, /role="menu"/)
	assert.match(root, /aria-label="Selection actions"/)
	assert.match(root, /data-knorke-menu="context"/)
	assert.match(root, /data-knorke-menu-target="01JA0000000000000000000001"/)
	assert.match(root, /data-knorke-menu-at="10,21"/)
	const buttons = html.match(/<button[^>]*>/g)
	assert.deepEqual(buttons.map((b) => /data-knorke-menu-item="([^"]+)"/.exec(b)[1]), [...ON_ITEMS, ...EXPORTS, 'delete'])
	for (const [i, b] of buttons.entries()) {
		assert.match(b, /type="button"/)
		assert.match(b, /role="menuitem"/)
		assert.match(b, new RegExp(`tabindex="${i === 0 ? 0 : -1}"`), 'roving tabindex: the first entry is the tab stop')
		assert.doesNotMatch(b, /data-knorke-action/)
	}
	assert.match(buttons[0], /aria-keyshortcuts="Control\+X"/)
	assert.doesNotMatch(buttons[3], /aria-keyshortcuts/, 'front: no shortcut, no attribute')
	assert.match(html, /<span class="knorke-contextmenu__key" aria-hidden="true">Ctrl\+X<\/span>/, 'the hint is visible and hidden from assistive technology')
	assert.match(html, />Bring to front</)
	// empty canvas, Apple: the mouse wheel and the grid (G on every platform)
	const board = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, grid: false, wheel: 'auto' }, selection: sel([]), host: null, apple: true }))
	assert.match(board, /data-knorke-menu-target(?:="")?[ >]/, 'empty target (SSR writes the empty value without quotes; the DOM attribute is "")')
	assert.match(board, /aria-label="Board actions"/)
	assert.deepEqual((board.match(/data-knorke-menu-item="([^"]+)"/g) ?? []).map((x) => x.split('"')[1]), ['wheel', 'grid'])
	assert.match(board, /aria-keyshortcuts="G"/)
	assert.doesNotMatch(board, /paste-here|note-here|select-all|data-knorke-menu-item="fit"/)
})

test('job 230 AK2: ContextMenu.vue draws a separator (div role=separator, no tab stop, no entry) between two groups, none before the first; Delete last with the error colour class; no count line', async () => {
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false }))
	const order = [...html.matchAll(/<div class="knorke-contextmenu__sep"[^>]*><\/div>|data-knorke-menu-item="([a-z-]+)"/g)].map((m) => m[1] ?? '|')
	assert.deepEqual(order, ['cut', 'copy', 'duplicate', '|', 'front', 'back', '|', ...EXPORTS, '|', 'delete'])
	assert.doesNotMatch(html, /knorke-contextmenu__sep[^>]*tabindex/)
	const del = html.match(/<button[^>]*data-knorke-menu-item="delete"[^>]*>/)[0]
	assert.match(del, /class="[^"]*\bknorke-contextmenu__item--danger\b[^"]*"/)
	assert.doesNotMatch(html.replace(del, ''), /knorke-contextmenu__item--danger/, 'only Delete')
	assert.doesNotMatch(html, /data-knorke-menu-count|aria-describedby/)
	const board = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, grid: true, gridSnap: false, unlockAll: 2 }, selection: sel([]), host: null, apple: false }))
	const b = [...board.matchAll(/<div class="knorke-contextmenu__sep"[^>]*><\/div>|data-knorke-menu-item="([a-z-]+)"/g)].map((m) => m[1] ?? '|')
	assert.deepEqual(b, ['unlock-all', '|', 'grid', 'grid-snap'], 'the grid entries last, after a separator')
	assert.doesNotMatch(board, /data-knorke-menu-count|items on this board/)
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /button\.knorke-contextmenu__item--danger \{\s*color: var\(--color-error-text, #8a0000\) !important;/)
	assert.match(css, /\.knorke-contextmenu__sep \{[^}]*height: 1px;[^}]*background: var\(--knorke-border\);/)
})

/**
 * @return {{e: object, calls: string[]}} a keydown stand-in that records preventDefault/stopPropagation
 * @param {string} key key
 * @param {object} [extra] modifiers
 */
function key(key, extra = {}) {
	const calls = []
	return { calls, e: { key, ...extra, preventDefault: () => calls.push('preventDefault'), stopPropagation: () => calls.push('stopPropagation') } }
}

test('ContextMenu.vue keyboard: arrows move the roving focus, Enter/Space emit the focused entry, Esc/Tab emit close – each with preventDefault AND stopPropagation; other keys pass', () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false })
	assert.equal(bindings.active.value, 0)
	let k = key('ArrowDown')
	bindings.onKey(k.e)
	assert.equal(bindings.active.value, 1)
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
	bindings.onKey(key('ArrowUp').e)
	bindings.onKey(key('ArrowUp').e)
	assert.equal(bindings.active.value, 10, 'wrapped to the last of 11 (job 230: the groups of "…", the exports, delete)')
	bindings.onKey(key('Home').e)
	assert.equal(bindings.active.value, 0)
	bindings.onKey(key('End').e)
	assert.equal(bindings.active.value, 10)
	k = key('Enter')
	bindings.onKey(k.e)
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'], 'no native click on top: activated once')
	assert.deepEqual(emitted.map((x) => x.slice(0, 2)), [['action', 'delete']])
	bindings.onKey(key('Home').e)
	bindings.onKey(key(' ').e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'cut'])
	k = key('Escape')
	bindings.onKey(k.e)
	assert.deepEqual(emitted.at(-1), ['close', 'esc'])
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'], 'the scene never sees Esc (it would clear the selection)')
	k = key('Tab')
	bindings.onKey(k.e)
	assert.deepEqual(emitted.at(-1), ['close', 'tab'])
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
	k = key('F10', { shiftKey: true })
	bindings.onKey(k.e)
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'], 'no browser menu over the open one')
	k = key('x', { ctrlKey: true })
	bindings.onKey(k.e)
	assert.deepEqual(k.calls, [], 'not the menu\'s key')
	assert.equal(emitted.length, 4)
	// a click emits the entry with its event
	const ev = { type: 'click' }
	bindings.activate('copy', ev)
	assert.deepEqual(emitted.at(-1), ['action', 'copy', ev])
})

test('job 230: ContextMenu.vue keyboard over the separators: they are never entries – ↓ on duplicate goes to front, ↑ on front back to duplicate; the entries carry sep only where a group starts', () => {
	const { bindings } = setupOf(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false })
	assert.deepEqual(bindings.items.value.map((e) => e.name), [...ON_ITEMS, ...EXPORTS, 'delete'])
	assert.deepEqual(bindings.items.value.filter((e) => e.sep).map((e) => e.name), ['front', 'export-png', 'delete'])
	bindings.onKey(key('ArrowDown').e)
	bindings.onKey(key('ArrowDown').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'duplicate')
	bindings.onKey(key('ArrowDown').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'front', 'past the separator')
	bindings.onKey(key('ArrowUp').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'duplicate')
})

test('ContextMenu.vue closing: a pointerdown outside (capture) emits close("outside"), inside not; window blur and resize emit close with their reason', () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, canPaste: false, apple: false })
	const inside = { id: 'inside' }
	bindings.root.value = { contains: (n) => n === inside }
	bindings.onDown({ target: inside })
	assert.deepEqual(emitted, [], 'a pointerdown on an entry keeps the menu')
	bindings.onDown({ target: { id: 'canvas' } })
	assert.deepEqual(emitted.at(-1), ['close', 'outside'])
	bindings.onBlur()
	assert.deepEqual(emitted.at(-1), ['close', 'blur'])
	bindings.onResize()
	assert.deepEqual(emitted.at(-1), ['close', 'resize'])
	const src = readFileSync(new URL('../../../src/components/ContextMenu.vue', import.meta.url), 'utf8')
	assert.match(src, /document\.addEventListener\('pointerdown', onDown, true\)/, 'capture: the event goes on to its target')
	assert.match(src, /document\.removeEventListener\('pointerdown', onDown, true\)/)
	assert.match(src, /window\.addEventListener\('blur', onBlur\)/)
	assert.match(src, /window\.addEventListener\('resize', onResize\)/)
	// the board view: Esc, Tab and outside give the canvas the focus, blur and resize do not
	const view = readFileSync(new URL('../../../src/views/BoardView.vue', import.meta.url), 'utf8')
	assert.match(view, /if \(reason === 'esc' \|\| reason === 'tab' \|\| reason === 'outside'\) \{\s*s\.focusCanvas\(\)/)
})

/*
 * The focus on the way out (§6.6 R20, K6; RSC-01): the real component is
 * mounted with Vue's own renderer on a small fake DOM (no browser, no extra
 * dependency): its template is compiled at run time from the .vue file, its
 * onMounted focuses the first entry, and the board's v-if drops it through
 * `menu = null` – the way BoardSession.closeMenu does for the user camera,
 * following, a mode switch, a frozen status or a selection from elsewhere.
 */

/** The board's and the canvas's rect in the fake DOM unless a test sets its own (doc.rects). */
const RECT = { left: 0, top: 50, right: 1280, bottom: 800 }

/**
 * @return {object} a document stand-in: element factory, activeElement, focus log, listeners,
 *   the viewport (documentElement), rects by class (rects) and the menu root's offsetHeight (menuHeight)
 */
function fakeDocument() {
	const doc = {
		activeElement: null,
		focusCalls: [],
		listeners: [],
		documentElement: { clientWidth: 1280, clientHeight: 800 },
		/** class → {left, top, right, bottom}: getBoundingClientRect of the nodes with that class (else RECT) */
		rects: {},
		/** (root) → offsetHeight of the menu root (role=menu); null: 300 */
		menuHeight: null,
		addEventListener: (type, fn, capture) => doc.listeners.push([type, fn, !!capture]),
		removeEventListener: (type, fn, capture) => {
			const k = doc.listeners.findIndex((l) => l[0] === type && l[1] === fn && l[2] === !!capture)
			if (k >= 0) {
				doc.listeners.splice(k, 1)
			}
		},
		// like a real element, a fake node never turns into a reactive proxy in a ref (Vue proxies plain objects only)
		create: (tag) => markRaw(new FakeNode(tag, doc)),
	}
	return doc
}

class FakeNode {

	/**
	 * @param {string} tag tag name ('#text', '#comment' for those)
	 * @param {object} doc owner (fakeDocument)
	 */
	constructor(tag, doc) {
		this.tag = tag
		this.doc = doc
		this.parentNode = null
		this.children = []
		this.attrs = {}
		this.on = {}
		this.style = {}
		this.text = ''
		this.offsetWidth = 220
	}

	get parentElement() {
		return this.parentNode
	}

	/** @return {number} 300, or what doc.menuHeight says for the menu root */
	get offsetHeight() {
		return this.attrs.role === 'menu' && this.doc.menuHeight ? this.doc.menuHeight(this) : 300
	}

	/**
	 * @param {FakeNode|null} n node
	 * @return {boolean} n is this node or below it
	 */
	contains(n) {
		for (let x = n; x; x = x.parentNode) {
			if (x === this) {
				return true
			}
		}
		return false
	}

	/** @param {object} [opts] focus options (logged) */
	focus(opts) {
		this.doc.focusCalls.push([this, opts])
		this.doc.activeElement = this
		this.on.onFocus?.({ type: 'focus' })
	}

	getBoundingClientRect() {
		const r = this.doc.rects[this.attrs.class] ?? RECT
		return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }
	}

	/**
	 * @param {string} sel an attribute selector "[name]" (all the menu asks)
	 * @return {FakeNode|null} this node or its nearest ancestor with that attribute
	 */
	closest(sel) {
		const name = /^\[([\w-]+)\]$/.exec(sel)?.[1]
		for (let x = this; x && name; x = x.parentNode) {
			if (x.attrs[name] !== undefined && x.attrs[name] !== null) {
				return x
			}
		}
		return null
	}

}

/** Node operations of a Vue custom renderer over FakeNode. */
const nodeOps = {
	createElement: (tag) => fakeDoc.create(tag),
	createText: (text) => Object.assign(fakeDoc.create('#text'), { text }),
	createComment: (text) => Object.assign(fakeDoc.create('#comment'), { text }),
	setText: (n, text) => { n.text = text },
	setElementText: (el, text) => {
		for (const c of el.children) {
			c.parentNode = null
		}
		el.children = []
		el.text = text
	},
	insert: (child, parent, anchor) => {
		if (child.parentNode) {
			nodeOps.remove(child)
		}
		const k = anchor ? parent.children.indexOf(anchor) : -1
		parent.children.splice(k < 0 ? parent.children.length : k, 0, child)
		child.parentNode = parent
	},
	remove: (child) => {
		const p = child.parentNode
		if (p) {
			p.children.splice(p.children.indexOf(child), 1)
			child.parentNode = null
		}
	},
	parentNode: (n) => n.parentNode,
	nextSibling: (n) => {
		const p = n.parentNode
		return p ? (p.children[p.children.indexOf(n) + 1] ?? null) : null
	},
	patchProp: (el, key, prev, next) => {
		if (/^on[A-Z]/.test(key)) {
			el.on[key] = next
		} else {
			el.attrs[key] = next
		}
	},
}

let fakeDoc = null

/**
 * Mounts a board stand-in with the menu under `v-if="menu"` (BoardView).
 *
 * @param {object} [state] the menu prop (default: the menu on one item)
 * @param {object} [opts] the layout before mounting (default: 1280 × 800, board and canvas RECT, root 300 px high)
 * @param {{clientWidth?: number, clientHeight?: number}} [opts.viewport] documentElement
 * @param {object} [opts.rects] class → rect (doc.rects: 'knorke-board', 'knorke-canvas')
 * @param {Function} [opts.menuHeight] (root) → its offsetHeight (doc.menuHeight)
 * @param {object} [opts.selection] the selection prop (default: one note)
 * @return {Promise<object>} {doc, host, menu (ref), root(), items(), drop(), done()}
 */
async function mountMenu(state = MENU, opts = {}) {
	const { compileScript, parse } = await import('vue/compiler-sfc')
	const file = new URL('../../../src/components/ContextMenu.vue', import.meta.url)
	const { descriptor } = parse(readFileSync(file, 'utf8'))
	// the client template, compiled at run time against the script's bindings ($setup.…), as the build does
	const { bindings } = compileScript(descriptor, { id: 'contextmenu', inlineTemplate: false })
	const Menu = { ...ContextMenu, template: descriptor.template.content, compilerOptions: { bindingMetadata: bindings, prefixIdentifiers: true } }
	const doc = fakeDocument()
	Object.assign(doc.documentElement, opts.viewport ?? {})
	Object.assign(doc.rects, opts.rects ?? {})
	doc.menuHeight = opts.menuHeight ?? null
	fakeDoc = doc
	const saved = { document: globalThis.document, window: globalThis.window }
	globalThis.document = doc
	globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener }
	const host = doc.create('div')
	host.attrs.class = 'knorke-canvas'
	const menu = ref({ ...state })
	const selection = opts.selection ?? sel(['sticky'])
	const Board = { setup: () => () => h('div', { class: 'knorke-board' }, [menu.value ? h(Menu, { menu: menu.value, selection, host, canPaste: false, apple: false }) : null]) }
	const app = createRenderer(nodeOps).createApp(Board)
	const container = doc.create('body')
	nodeOps.insert(host, container, null)
	app.mount(container)
	await nextTick()
	const root = () => container.children.flatMap((n) => n.children).find((n) => n.attrs.role === 'menu') ?? null
	return {
		doc,
		host,
		menu,
		root,
		items: () => root()?.children.filter((n) => n.attrs.role === 'menuitem') ?? [],
		async drop() {
			menu.value = null
			await nextTick()
		},
		done() {
			app.unmount()
			for (const k of ['document', 'window']) {
				if (saved[k] === undefined) {
					delete globalThis[k]
				} else {
					globalThis[k] = saved[k]
				}
			}
			fakeDoc = null
		},
	}
}

test('ContextMenu.vue (K6): the session drops the menu while an entry has the focus → the canvas host gets it, without scrolling, never body', async () => {
	const m = await mountMenu()
	try {
		const root = m.root()
		assert.ok(root, 'mounted: the menu root is in the board')
		assert.equal(root.attrs['data-knorke-menu'], 'context')
		const items = m.items()
		assert.equal(items.length, 11, 'job 230: the groups of "…", the exports and delete')
		assert.equal(m.doc.activeElement, items[0], 'opened: the first entry has the focus (roving tabindex)')
		assert.deepEqual(m.doc.listeners.map((l) => [l[0], l[2]]), [['pointerdown', true], ['blur', false], ['resize', false]])
		// the user moves down one entry, then the session closes the menu (e.g. the user camera)
		items[1].focus({ preventScroll: true })
		const before = m.doc.focusCalls.length
		await m.drop()
		assert.equal(m.root(), null, 'unmounted')
		assert.equal(m.doc.activeElement, m.host, 'the focus is on the canvas host')
		assert.deepEqual(m.doc.focusCalls.slice(before), [[m.host, { preventScroll: true }]], 'one focus call, on the host, without scrolling')
		assert.deepEqual(m.doc.listeners, [], 'the listeners are gone')
	} finally {
		m.done()
	}
})

test('ContextMenu.vue (K6): the focus is outside the menu when it goes away (Esc/Tab/outside → focusCanvas, edit-text/note-here → editor) → no focus change', async () => {
	for (const where of ['editor', 'host', 'none']) {
		const m = await mountMenu()
		try {
			assert.equal(m.doc.activeElement, m.items()[0])
			let target = null
			if (where === 'editor') {
				// "Edit text": the scene's editor takes the focus before the menu unmounts
				target = m.doc.create('textarea')
				target.focus()
			} else if (where === 'host') {
				// Esc, Tab, a click outside: the board ran focusCanvas first
				target = m.host
				target.focus({ preventScroll: true })
			} else {
				// the focus already left the document's elements (body)
				m.doc.activeElement = null
			}
			const before = m.doc.focusCalls.length
			await m.drop()
			assert.equal(m.root(), null, where + ': unmounted')
			assert.equal(m.doc.activeElement, target, where + ': the focus stays where it is')
			assert.deepEqual(m.doc.focusCalls.slice(before), [], where + ': no focus call')
		} finally {
			m.done()
		}
	}
})

/** (job 230) the board menu: "Mouse wheel" and "Show grid" (the session always reports the grid's state) */
const BOARD = { id: null, at: [0, 0], seq: 2, items: 3, grid: false, wheel: 'auto' }

test('ContextMenu.vue separator (UX B1, job 230: the count line is gone): a mousedown on a separator is prevented, so the active entry keeps the focus and Esc/arrows still reach the menu; on an entry nothing is prevented; the menu stays open', async () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false })
	const node = (attrs, parentNode = null) => ({ attrs, parentNode, closest: FakeNode.prototype.closest })
	const root = node({ role: 'menu' })
	const sep = node({ 'data-knorke-menu-sep': '', role: 'separator' }, root)
	const entry = node({ 'data-knorke-menu-item': 'delete' }, root)
	const label = node({ class: 'knorke-contextmenu__label' }, entry)
	const press = (target) => {
		const calls = []
		bindings.onRootDown({ target, preventDefault: () => calls.push('preventDefault') })
		return calls
	}
	assert.deepEqual(press(sep), ['preventDefault'], 'the separator: the focus stays where it is')
	for (const [what, target] of [['entry', entry], ['label inside an entry', label], ['no target', null]]) {
		assert.deepEqual(press(target), [], what + ': default action as before')
	}
	bindings.root.value = { contains: (n) => [root, sep, entry, label].includes(n) }
	bindings.onDown({ target: sep })
	assert.deepEqual(emitted, [], 'a press on the separator keeps the menu open')
	bindings.onKey(key('ArrowUp').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'delete', 'the arrows still work')
	bindings.onKey(key('Escape').e)
	assert.deepEqual(emitted.at(-1), ['close', 'esc'], 'and Esc closes it')
	// mounted: the compiled template binds it on the root, and the real separators match
	const m = await mountMenu(MENU)
	try {
		const r = m.root()
		const seps = r.children.filter((n) => n.attrs['data-knorke-menu-sep'] !== undefined)
		assert.equal(seps.length, 3, 'three separators between the four groups')
		assert.ok(seps.every((x) => x.attrs.role === 'separator' && x.attrs.tabindex === undefined && x.on.onMousedown === undefined))
		assert.equal(r.children.find((n) => n.attrs['data-knorke-menu-count'] !== undefined), undefined, 'no count line')
		const calls = []
		r.on.onMousedown({ target: seps[0], preventDefault: () => calls.push('sep') })
		r.on.onMousedown({ target: m.items().at(-1), preventDefault: () => calls.push('entry') })
		assert.deepEqual(calls, ['sep'])
		assert.equal(m.doc.activeElement, m.items()[0], 'the first entry keeps the focus')
	} finally {
		m.done()
	}
})

/** Measures of a board menu with nothing to scroll (both axes fit). */
const FITS = { scrollWidth: 210, scrollHeight: 166, clientWidth: 210, clientHeight: 166 }

test('noScrollRange: true only when all four measures are finite numbers and both scroll sizes fit their client sizes; anything unknown counts as "can scroll"', () => {
	assert.equal(noScrollRange(FITS), true, 'equal sizes: nothing to scroll')
	assert.equal(noScrollRange({ scrollWidth: 200, scrollHeight: 150, clientWidth: 210, clientHeight: 166 }), true, 'smaller content')
	assert.equal(noScrollRange({ scrollWidth: 210, scrollHeight: 300, clientWidth: 210, clientHeight: 266 }), false, 'taller than the box: a vertical scroll range')
	assert.equal(noScrollRange({ scrollWidth: 230, scrollHeight: 166, clientWidth: 200, clientHeight: 166 }), false, 'wider than the box: a horizontal scroll range')
	for (const bad of [null, undefined, {}, { ...FITS, scrollHeight: NaN }, { ...FITS, clientHeight: '166' }, { ...FITS, scrollWidth: Infinity }, 'menu', 0]) {
		assert.equal(noScrollRange(bad), false, 'unknown: ' + String(bad && JSON.stringify(bad)))
	}
	const read = []
	const spy = new Proxy({ ...FITS }, { get: (o, k) => { read.push(k); return o[k] } })
	assert.equal(noScrollRange(spy), true)
	assert.deepEqual(read.sort(), ['clientHeight', 'clientWidth', 'scrollHeight', 'scrollWidth'], 'reads only the four measures')
})

/**
 * A fake menu for setupOf: the root (FITS), a count line, an entry with its
 * label. markRaw, like a real element: a ref keeps it as it is (a plain
 * object would turn into a reactive proxy, never === the event target).
 *
 * @return {{root: object, line: object, entry: object, label: object}} the nodes
 */
function fakeMenu() {
	const node = (attrs, parentNode = null) => markRaw({ attrs, parentNode, closest: FakeNode.prototype.closest, contains: FakeNode.prototype.contains })
	const root = Object.assign(node({ role: 'menu' }), FITS)
	const entry = node({ 'data-knorke-menu-item': 'fit' }, root)
	return {
		root,
		entry,
		label: node({ class: 'knorke-contextmenu__label' }, entry),
	}
}

test('ContextMenu.vue padding (UX B2): a mousedown on the root itself (padding, border) is prevented in both menus while they have nothing to scroll, so the active entry keeps the focus, the menu stays open and Esc/arrows still reach it; not on an entry, a menu that can scroll, without target or root', () => {
	for (const [what, props, last] of [
		['board menu', { menu: BOARD, selection: sel([]), host: null, apple: false }, 'grid'],
		['menu on items', { menu: MENU, selection: sel(['sticky']), host: null, apple: false }, 'delete'],
	]) {
		const { bindings, emitted } = setupOf(ContextMenu, props)
		const { root, entry, label } = fakeMenu()
		bindings.root.value = root
		assert.equal(bindings.root.value, root, what + ': the ref keeps the fake root as it is')
		const press = (target) => {
			const calls = []
			bindings.onRootDown({ target, preventDefault: () => calls.push('preventDefault') })
			return calls
		}
		assert.deepEqual(press(root), ['preventDefault'], what + ': the root (nothing to scroll): the focus stays where it is')
		for (const [where, target] of [['entry', entry], ['label inside an entry', label], ['no target', null]]) {
			assert.deepEqual(press(target), [], what + ', ' + where + ': default action as before')
		}
		assert.doesNotThrow(() => bindings.onRootDown(undefined), what + ': no event')
		// a menu that can scroll (a very low window): the root, its scrollbar included, behaves as before
		Object.assign(root, { scrollHeight: 300, clientHeight: 266 })
		assert.deepEqual(press(root), [], what + ': the root of a menu that can scroll')
		assert.deepEqual(press(entry), [], what + ': an entry of a menu that can scroll')
		Object.assign(root, FITS)
		// no root (not mounted): nothing, and no throw
		bindings.root.value = null
		assert.deepEqual(press(root), [], what + ': no root')
		bindings.root.value = root
		// after the press on the root: the menu stays open, the keys still work
		assert.deepEqual(press(root), ['preventDefault'])
		bindings.onDown({ target: root })
		assert.deepEqual(emitted, [], what + ': a press on the padding is inside, the menu stays open')
		bindings.onKey(key('ArrowUp').e)
		assert.equal(bindings.items.value[bindings.active.value].name, last, what + ': the arrows still work')
		bindings.onKey(key('Escape').e)
		assert.deepEqual(emitted.at(-1), ['close', 'esc'], what + ': and Esc closes it')
	}
})

test('ContextMenu.vue padding (UX B2) mounted: the compiled template\'s root handler prevents a press on the root of both menus while nothing scrolls, not when it can scroll, never on an entry; no new listener; no count line (job 230)', async () => {
	for (const [what, state] of [['board menu', BOARD], ['menu on items', MENU]]) {
		const m = await mountMenu(state)
		try {
			const r = Object.assign(m.root(), FITS)
			const press = (target) => {
				const calls = []
				r.on.onMousedown({ target, preventDefault: () => calls.push('preventDefault') })
				return calls
			}
			assert.deepEqual(press(r), ['preventDefault'], what + ': the root, nothing to scroll')
			assert.deepEqual(press(m.items().at(-1)), [], what + ': the last entry')
			r.scrollHeight = r.clientHeight + 40
			assert.deepEqual(press(r), [], what + ': the root of a menu that can scroll')
			assert.deepEqual(press(m.items().at(-1)), [], what + ': the last entry of a menu that can scroll')
			assert.deepEqual(m.doc.listeners.map((l) => [l[0], l[2]]), [['pointerdown', true], ['blur', false], ['resize', false]], what + ': no new listener')
			assert.equal(r.children.find((n) => n.attrs['data-knorke-menu-count'] !== undefined), undefined, what + ': no count line')
		} finally {
			m.done()
		}
	}
})

/*
 * A very low window (UX B9; §6.6 placement): place() sets the root's
 * max-height inline from the bounds (viewport ∩ board, less 8 px above and
 * below, menu.js) before it measures the menu, so the whole menu lies in
 * the board with the margin and scrolls what does not fit.
 */

/**
 * The root's offsetHeight: 266 px of entries (the menu on a note), capped
 * by its inline max-height (none: 266); logs that max-height on every read.
 *
 * @param {string[]} log style.maxHeight at each read
 * @return {Function} doc.menuHeight
 */
function cappedHeight(log) {
	return (el) => {
		log.push(el.style.maxHeight)
		const cap = parseFloat(el.style.maxHeight)
		return Number.isFinite(cap) ? Math.min(266, cap) : 266
	}
}

test('ContextMenu.vue (UX B9) mounted: place() sets max-height from the bounds before it measures – 734px in 1280 × 800, 176px with the menu 8 px into the board 50 … 242 in a 250 px window, 226px after a new intent at 300 px, "" for bounds that are no numbers; no :style binding, no new listener', async () => {
	for (const [what, state] of [['menu on items', MENU], ['board menu', BOARD]]) {
		// as before: 1280 × 800, board and canvas 0/50/1280/800
		let m = await mountMenu(state)
		try {
			assert.equal(m.root().style.maxHeight, '734px', what + ': 800 − 50 − 2 × 8')
			assert.equal(m.root().attrs.style, undefined, what + ': no :style binding on the root (Vue would overwrite the value)')
		} finally {
			m.done()
		}
		// a 250 px window in NC: the board 50 … 242 (header above, 8 px below)
		const low = { left: 0, top: 50, right: 1280, bottom: 242 }
		const log = []
		m = await mountMenu(state, { viewport: { clientHeight: 250 }, rects: { 'knorke-board': low, 'knorke-canvas': low }, menuHeight: cappedHeight(log) })
		try {
			const r = m.root()
			assert.equal(r.style.maxHeight, '176px', what + ': 242 − 50 − 2 × 8')
			assert.ok(log.length > 0, what + ': place() measured the menu')
			assert.deepEqual([...new Set(log)], ['176px'], what + ': offsetHeight is read only after max-height is set')
			assert.equal(r.style.top, '8px', what + ': 8 px below the board top, the box 58 … 234 = 242 − 8')
			assert.ok(50 + parseFloat(r.style.top) + r.offsetHeight <= low.bottom - MENU_MARGIN, what + ': wholly inside with the margin')
			// a new intent (seq + 1) after the window grew to 300 px: the limit follows the new bounds
			const taller = { ...low, bottom: 292 }
			m.doc.documentElement.clientHeight = 300
			Object.assign(m.doc.rects, { 'knorke-board': taller, 'knorke-canvas': taller })
			m.menu.value = { ...m.menu.value, seq: m.menu.value.seq + 1 }
			await nextTick()
			await nextTick()
			assert.equal(r.style.maxHeight, '226px', what + ': 292 − 50 − 2 × 8')
			assert.equal(log.at(-1), '226px', what + ': measured again after the new limit')
			assert.equal(r.style.top, '8px', what + ': the box 58 … 284 = 292 − 8')
			assert.deepEqual(m.doc.listeners.map((l) => [l[0], l[2]]), [['pointerdown', true], ['blur', false], ['resize', false]], what + ': no new listener')
		} finally {
			m.done()
		}
		// bounds that are no numbers: no inline limit (the CSS one applies), no throw
		const bad = { left: 0, top: 50, right: 1280, bottom: NaN }
		let broken = null
		await assert.doesNotReject(async () => {
			broken = await mountMenu(state, { rects: { 'knorke-board': bad } })
		}, what + ': mounting does not throw')
		try {
			assert.equal(broken.root().style.maxHeight, '', what + ': no finite bounds, no inline max-height')
			assert.equal(broken.doc.activeElement, broken.items()[0], what + ': opened as usual, the first entry has the focus')
		} finally {
			broken?.done()
		}
	}
})

// ---- M2 (SPEC-M1 §1.2 (R12), job 016): "Show grid" in the board menu (AK10) ----------

test('menuEntries (AK10 a): grid last on the empty canvas when env.grid is a boolean; never on items; without env.grid the lists stay', () => {
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: false }), ['grid'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: true }), ['grid'])
	assert.deepEqual(menuEntries(null, undefined, { items: 0, grid: false }), ['grid'])
	assert.ok(!menuEntries(sel(['sticky']), 'id0', { grid: true }).includes('grid'), 'not on items')
	assert.ok(!menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'id1', { grid: false }).includes('grid'))
	for (const g of [undefined, null, 'true', 1]) {
		assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: g }), [], String(g))
	}
	assert.deepEqual(menuEntries(sel([]), null), [])
})

test('grid entry (AK10 b): fifth from last of MENU_ITEMS (job 062: unlock-all last; job 147: cursors before it; job 154: wheel before that), label "Show grid", the single key G on every platform', () => {
	assert.equal(MENU_ITEMS.at(-5), 'grid')
	assert.equal(menuLabel('grid'), 'Show grid')
	assert.deepEqual(menuShortcut('grid', false), { hint: 'G', aria: 'G' })
	assert.deepEqual(menuShortcut('grid', true), { hint: 'G', aria: 'G' })
})

test('ContextMenu.vue grid (AK10 c): the board menu with grid on – a menuitemcheckbox, aria-checked true, the check mark in its column; every other entry a menuitem with an empty column', async () => {
	const board = async (grid) => strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, grid }, selection: sel([]), host: null, canPaste: true, apple: false }))
	const buttonsOf = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2], name: /data-knorke-menu-item="([^"]+)"/.exec(m[1])[1] }))
	const on = buttonsOf(await board(true))
	assert.deepEqual(on.map((b) => b.name), ['grid'])
	const g = on.at(-1)
	assert.match(g.attrs, /type="button"/)
	assert.match(g.attrs, /role="menuitemcheckbox"/)
	assert.match(g.attrs, /aria-checked="true"/)
	assert.match(g.attrs, /aria-keyshortcuts="G"/)
	assert.match(g.inner, /<span class="knorke-contextmenu__label">Show grid<\/span>/)
	assert.match(g.inner, /<span class="knorke-contextmenu__key" aria-hidden="true">G<\/span>/)
	const col = /^<span class="knorke-contextmenu__check" aria-hidden="true">([\s\S]*?)<\/span>/.exec(g.inner)
	assert.ok(col, 'the check column comes first, aria-hidden')
	assert.match(col[1], /^<svg[^>]*viewBox="0 0 24 24"[^>]*>/)
	assert.match(col[1], /width="20"/) // job 226: icons 20 px
	assert.match(col[1], /height="20"/)
	assert.match(col[1], /focusable="false"/)
	assert.ok(col[1].includes('<path d="' + icons.check + '" fill="currentColor"'), 'the check mark (job 244: Phosphor check)')
	for (const b of on.slice(0, -1)) {
		assert.match(b.attrs, /role="menuitem"/, b.name)
		assert.doesNotMatch(b.attrs, /aria-checked/, b.name)
		assert.match(b.inner, /^<span class="knorke-contextmenu__check" aria-hidden="true"><\/span>/, b.name + ': an empty column')
	}
	// grid off: aria-checked false, an empty column
	const off = buttonsOf(await board(false))
	assert.match(off.at(-1).attrs, /role="menuitemcheckbox"/)
	assert.match(off.at(-1).attrs, /aria-checked="false"/)
	assert.match(off.at(-1).inner, /^<span class="knorke-contextmenu__check" aria-hidden="true"><\/span>/)
	assert.doesNotMatch(off.at(-1).inner, /<svg/)
	// the menu on items (grid in the payload too): no check box, no column
	const items = strip(await render(ContextMenu, { menu: { id: '01JA0000000000000000000001', at: [0, 0], seq: 4, items: 3, grid: true }, selection: sel(['sticky']), host: null, canPaste: true, apple: false }))
	assert.doesNotMatch(items, /menuitemcheckbox/)
	assert.doesNotMatch(items, /knorke-contextmenu__check/)
	// a board menu without grid in the payload: as before
	const plain = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 5, items: 3 }, selection: sel([]), host: null, canPaste: true, apple: false }))
	assert.doesNotMatch(plain, /menuitemcheckbox|knorke-contextmenu__check|data-knorke-menu-item="grid"/)
})

test('ContextMenu.vue grid (AK10 d): Enter on the focused grid entry emits action grid; the count line stays after it', () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, grid: false }, selection: sel([]), host: null, canPaste: false, apple: false })
	assert.deepEqual(bindings.items.value.map((e) => [e.name, e.checked]), [['grid', false]])
	assert.equal(bindings.checkColumn.value, true)
	bindings.onKey(key('End').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'grid')
	const k = key('Enter')
	bindings.onKey(k.e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'grid'])
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
})

// ---- M2 (SPEC-M1 §1.2 (R12), job 019): "Snap to grid" in the board menu (AK6, AK7) ----------

test('menuEntries (019 AK6 a–c): grid-snap last after grid, only with the grid on and env.gridSnap a boolean; never on items', () => {
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: true }), ['grid', 'grid-snap'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: false }), ['grid', 'grid-snap'], 'the same list when off')
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 0, grid: true, gridSnap: false }), ['grid', 'grid-snap'])
	// (b) only grid: the grid hidden, or gridSnap no boolean
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: false, gridSnap: true }), ['grid'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: false, gridSnap: false }), ['grid'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true }), ['grid'])
	for (const v of ['true', 1, null]) {
		assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: v }), ['grid'], String(v))
	}
	// no grid state: neither entry, whatever gridSnap says
	assert.deepEqual(menuEntries(null, null, { items: 3, gridSnap: true }), [])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: 'true', gridSnap: true }), [])
	// (c) never on items
	const onItems = menuEntries(sel(['sticky']), 'id0', { grid: true, gridSnap: true })
	assert.ok(!onItems.includes('grid'), 'no grid on items')
	assert.ok(!onItems.includes('grid-snap'), 'no grid-snap on items')
	assert.ok(!menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'id1', { grid: true, gridSnap: false }).includes('grid-snap'))
})

test('grid-snap entry (019 AK6 d, e): fourth from last of MENU_ITEMS, after grid (job 062: unlock-all last; job 147: cursors before it; job 154: wheel before that), label "Snap to grid", no shortcut on any platform', () => {
	assert.equal(MENU_ITEMS.length, 78)
	assert.equal(MENU_ITEMS.at(-4), 'grid-snap')
	assert.equal(MENU_ITEMS.at(-5), 'grid')
	assert.equal(menuLabel('grid-snap'), 'Snap to grid')
	assert.equal(menuShortcut('grid-snap', false), null)
	assert.equal(menuShortcut('grid-snap', true), null)
})

test('ContextMenu.vue grid-snap (019 AK7 a–d): a menuitemcheckbox after grid, aria-checked from menu.gridSnap, the check mark in its column, no key; only with the grid on; never on items', async () => {
	const board = async (menu) => strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, ...menu }, selection: sel([]), host: null, canPaste: false, apple: false }))
	const buttonsOf = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2], name: /data-knorke-menu-item="([^"]+)"/.exec(m[1])[1] }))
	// (a) both on
	const on = buttonsOf(await board({ grid: true, gridSnap: true }))
	assert.deepEqual(on.map((b) => b.name).slice(-2), ['grid', 'grid-snap'], 'the entries end on grid, grid-snap')
	const s = on.at(-1)
	assert.match(s.attrs, /type="button"/)
	assert.match(s.attrs, /role="menuitemcheckbox"/)
	assert.match(s.attrs, /aria-checked="true"/)
	assert.doesNotMatch(s.attrs, /aria-keyshortcuts/)
	const col = /^<span class="knorke-contextmenu__check" aria-hidden="true">([\s\S]*?)<\/span>/.exec(s.inner)
	assert.ok(col, 'the check column comes first, aria-hidden')
	assert.match(col[1], /^<svg[^>]*viewBox="0 0 24 24"[^>]*>/)
	assert.match(s.inner, /<span class="knorke-contextmenu__label">Snap to grid<\/span>/)
	assert.doesNotMatch(s.inner, /knorke-contextmenu__key/)
	assert.match(on.at(-2).attrs, /role="menuitemcheckbox"/)
	assert.match(on.at(-2).attrs, /aria-checked="true"/, 'grid stays checked')
	// (b) gridSnap off: aria-checked false, an empty column; grid still checked
	const off = buttonsOf(await board({ grid: true, gridSnap: false }))
	assert.equal(off.at(-1).name, 'grid-snap')
	assert.match(off.at(-1).attrs, /role="menuitemcheckbox"/)
	assert.match(off.at(-1).attrs, /aria-checked="false"/)
	assert.match(off.at(-1).inner, /^<span class="knorke-contextmenu__check" aria-hidden="true"><\/span>/)
	assert.doesNotMatch(off.at(-1).inner, /<svg/)
	assert.match(off.at(-2).attrs, /aria-checked="true"/)
	// (c) the grid hidden: no grid-snap
	const hidden = await board({ grid: false, gridSnap: true })
	assert.doesNotMatch(hidden, /data-knorke-menu-item="grid-snap"/)
	assert.match(hidden, /data-knorke-menu-item="grid"/)
	// (d) the menu on items: neither check box nor grid-snap
	const items = strip(await render(ContextMenu, { menu: { id: '01JA0000000000000000000001', at: [0, 0], seq: 4, items: 3, grid: true, gridSnap: true }, selection: sel(['sticky']), host: null, canPaste: false, apple: false }))
	assert.doesNotMatch(items, /menuitemcheckbox/)
	assert.doesNotMatch(items, /grid-snap/)
})

test('ContextMenu.vue grid-snap (019 AK7 e): items with their states, End focuses grid-snap, Enter and Space emit action grid-snap; the count line stays', () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, grid: true, gridSnap: false }, selection: sel([]), host: null, canPaste: false, apple: false })
	assert.deepEqual(bindings.items.value.map((e) => [e.name, e.checked]), [['grid', true], ['grid-snap', false]])
	assert.equal(bindings.items.value.at(-1).label, 'Snap to grid')
	assert.equal(bindings.items.value.at(-1).aria, null, 'no aria-keyshortcuts')
	assert.equal(bindings.items.value.at(-1).hint, '', 'no hint')
	bindings.onKey(key('End').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'grid-snap')
	const k = key('Enter')
	bindings.onKey(k.e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'grid-snap'])
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
	const sp = key(' ')
	bindings.onKey(sp.e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'grid-snap'], 'Space too')
	assert.deepEqual(sp.calls, ['preventDefault', 'stopPropagation'])
})

// ---- Job 023 (M2, SPEC-M1 §1.2 "(R20) Sperren"): lock and unlock ---------------

/**
 * @param {string[]} types types of the UNLOCKED selected items
 * @param {object} lock lock fields of selection v2 (count, locked, unlocked, lockable, unlockable, lockedBy, unlockBy)
 * @return {object} selection v2 with locks
 */
const lockSel = (types, lock) => sel(types, { lockedBy: null, unlockBy: null, ...lock })

test('job 023 (AK9): MENU_ITEMS has lock and unlock after connect; labels, the unlock label names the locker', () => {
	assert.deepEqual(MENU_ITEMS, ['cut', 'copy', 'duplicate', 'delete', 'front', 'back',
		'react', 'tags', 'row-above', 'row-below', 'col-left', 'col-right', 'row-delete', 'col-delete', 'table-csv',
		'mm-child', 'mm-sibling', 'mm-fold', 'mm-rearrange', 'mm-delete', 'mm-text', 'lane-rename', 'lane-above', 'lane-below', 'lane-up', 'lane-down', 'lane-delete', 'lane-group', 'lane-group-rename', 'lane-ungroup', 'column-add', 'column-rename', 'column-left', 'column-right', 'column-move-left', 'column-move-right', 'column-delete', 'column-group', 'column-group-rename', 'column-ungroup', 'edit-text', 'swap-direction', 'connect', 'arrange', 'sort-colors', 'sort-frame', 'group', 'ungroup', 'frame-around', 'lock', 'unlock',
		'unlock-by', 'unlock-frame', 'zoom-selection', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'save-template', 'comment', 'only-sticky', 'only-shape', 'only-text', 'only-connector', 'only-frame', 'only-group', 'paste-here', 'note-here', 'pad-here', 'insert-template', 'select-all', 'fit', 'grid', 'grid-snap', 'wheel', 'cursors', 'unlock-all'],
	'job 044: unlock-frame and unlock-all; job 062: unlock-by, unlock-all last; job 139: sort-colors and sort-frame after connect; job 144: only-<kind> after zoom-selection; job 147: cursors; job 153: swap-direction after edit-text; job 154: wheel before cursors; job 172: react after back; job 173: the table entries after react (never shown with it: after back in the menu of a table); job 182: save-template after export-csv; job 189: comment after save-template; job 188: pad-here after note-here; job 191: tags after react; job 195: the mind map entries after the table entries (never shown together); job 196: mm-rearrange after mm-fold; job 230: arrange after connect')
	assert.equal(menuLabel('lock'), 'Lock')
	assert.equal(menuLabel('unlock'), 'Unlock')
	assert.equal(menuLabel('unlock', { unlockBy: { kind: 'name', name: 'Alice' } }), 'Unlock (locked by Alice)')
	assert.deepEqual(menuShortcut('lock', true), { hint: '⌘⇧L', aria: 'Meta+Shift+L' })
	assert.deepEqual(menuShortcut('lock', false), { hint: 'Ctrl+Shift+L', aria: 'Control+Shift+L' })
	assert.deepEqual(menuShortcut('unlock', true), { hint: '⌘⇧L', aria: 'Meta+Shift+L' })
	assert.deepEqual(menuShortcut('unlock', false), { hint: 'Ctrl+Shift+L', aria: 'Control+Shift+L' })
})

test('job 023 (AK9), job 230: menuEntries – a fully, foreign locked selection: copy and the exports; with mod also unlock; mixed: the editing entries, lock, unlock if allowed, delete last; no edit-text', () => {
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(foreign, 'id0'), ['copy', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv'], 'one locked note: no delete')
	const withMod = { ...foreign, unlockable: 1, unlockBy: { kind: 'name', name: 'Bob' } }
	assert.deepEqual(menuEntries(withMod, 'id0'), ['copy', 'unlock', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv'])
	const mixed = lockSel(['sticky'], { count: 2, locked: 1, unlocked: 1, lockable: 1, unlockable: 0, canConnect: true })
	assert.deepEqual(menuEntries(mixed, 'id0'), ['cut', 'copy', 'duplicate', 'front', 'back', 'connect', 'lock', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'])
	assert.deepEqual(menuEntries({ ...mixed, unlockable: 1 }, 'id0'), ['cut', 'copy', 'duplicate', 'front', 'back', 'connect', 'lock', 'unlock', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'])
	const free = lockSel(['sticky'], { count: 1, locked: 0, unlocked: 1, lockable: 1, unlockable: 0 })
	assert.deepEqual(menuEntries(free, 'id0'), ['cut', 'copy', 'duplicate', 'front', 'back', 'lock', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'])
	const viewOnly = lockSel(['sticky'], { count: 1, locked: 0, unlocked: 1, lockable: 0, unlockable: 0 })
	assert.ok(!menuEntries(viewOnly, 'id0').includes('lock'), 'lockable 0 while the session cannot write')
	assert.deepEqual(menuEntries(null, null), [], 'never on the empty canvas')
})

test('job 023 (AK9), job 105: unlockLabel and lockBadgeText for every kind; the name is plain text', () => {
	assert.equal(unlockLabel({ unlockBy: { kind: 'mine' } }), 'Unlock')
	assert.equal(unlockLabel({ unlockBy: { kind: 'name', name: 'Bob' } }), 'Unlock (locked by Bob)')
	assert.equal(unlockLabel({ unlockBy: { kind: 'unknown' } }), 'Unlock (locker unknown)')
	assert.equal(unlockLabel({ unlockBy: { kind: 'several' } }), 'Unlock (locked by several people)')
	assert.equal(unlockLabel(null), 'Unlock')
	assert.equal(unlockLabel(3), 'Unlock', 'Array.map(menuLabel) passes an index')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'mine' }, locked: 2 }), 'Locked by you')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'name', name: '<b>x</b> & {name}' }, locked: 1 }), 'Locked by <b>x</b> & {name}', 'literal')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'unknown' }, locked: 1 }), 'Locked, locker unknown')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'several' }, locked: 3 }), '3 locked items')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'several' }, locked: 1 }), '1 locked item')
	assert.equal(lockBadgeText({ lockedBy: null }), '')
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual(['Lock', 'Unlock', 'Unlock (locked by {name})', 'Locked by you', 'Locked, locker unknown'].map((k) => de[k]),
		['Sperren', 'Entsperren', 'Entsperren (von {name})', 'Von dir gesperrt', 'Gesperrt, unbekannt von wem'], 'job 105: the shorter German label')
})

test('job 023: ContextMenu.vue renders "Unlock (locked by …)" with the full text in its title (cut with an ellipsis by CSS), as text', async () => {
	const selection = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: '<b>x</b> & {name}' }, unlockBy: { kind: 'name', name: '<b>x</b> & {name}' } })
	const html = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 1, items: 1 }, selection, host: null, canPaste: false, apple: false }))
	const tag = html.match(/<button[^>]*data-knorke-menu-item="unlock"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
	assert.match(tag, /title="Unlock \(locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}\)"/)
	assert.match(tag, /aria-keyshortcuts="Control\+Shift\+L"/)
	assert.match(tag, /<span class="knorke-contextmenu__label">Unlock \(locked by &lt;b&gt;x&lt;\/b&gt; &amp; \{name\}\)<\/span>/)
	assert.doesNotMatch(html, /<b>x<\/b>/, 'never HTML')
	assert.deepEqual([...html.matchAll(/data-knorke-menu-item="([a-z-]+)"/g)].map((m) => m[1]), ['copy', 'unlock', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv'])
	// review round 1 (UX N2): with something lockable the key locks, so unlock shows no key
	const mixed = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 1, items: 2 }, selection: { ...selection, count: 2, unlocked: 1, lockable: 1, types: new Set(['sticky']) }, host: null, canPaste: false, apple: false }))
	const un = mixed.match(/<button[^>]*data-knorke-menu-item="unlock"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
	assert.doesNotMatch(un, /aria-keyshortcuts/)
	assert.doesNotMatch(un, /knorke-contextmenu__key/)
	assert.match(mixed.match(/<button[^>]*data-knorke-menu-item="lock"[^>]*>/)?.[0] ?? '', /aria-keyshortcuts="Control\+Shift\+L"/)
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /\.knorke-contextmenu__label \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
})

// ---- Job 026 (M2, SPEC-M1 §1.2 "(R20) Gruppieren"): group and ungroup ----------

test('job 026 (AK7): MENU_ITEMS has group and ungroup after connect; menuEntries under the bar\'s conditions; menuBlocked gives every reason; the shortcuts', () => {
	assert.deepEqual(MENU_ITEMS.slice(MENU_ITEMS.indexOf('connect'), MENU_ITEMS.indexOf('zoom-selection') + 6), ['connect', 'arrange', 'sort-colors', 'sort-frame', 'group', 'ungroup', 'frame-around', 'lock', 'unlock', 'unlock-by', 'unlock-frame', 'zoom-selection', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv'], 'job 044: unlock-frame after unlock; job 062: unlock-by between them; job 139: the sort entries before group; job 178: export-png after zoom-selection; job 179: export-csv after it; job 200: export-svg and export-pdf between them')
	const two = sel(['sticky', 'sticky'], { groupable: 2, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(menuEntries(two, 'id0'), [...ON_ITEMS, 'group', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'])
	const one = sel(['sticky', 'sticky'], { groupable: 2, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: true })
	assert.deepEqual(menuEntries(one, 'id0'), [...ON_ITEMS, 'ungroup', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'], 'exactly one group: only ungroup')
	const mixed = sel(['sticky', 'sticky', 'sticky'], { groupable: 3, groupBlock: 'parent', grouped: 1, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(menuEntries(mixed, 'id0'), [...ON_ITEMS, 'group', 'ungroup', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv', 'delete'], 'a blocked entry stays (aria-disabled)')
	assert.deepEqual(menuEntries(sel(['sticky'], { groupable: 1, grouped: 0 }), 'id0').filter((e) => e === 'group' || e === 'ungroup'), [], 'one item: neither')
	assert.deepEqual(menuEntries(sel(['sticky', 'sticky']), 'id0').filter((e) => e === 'group' || e === 'ungroup'), [], 'a selection v2 without the keys: neither')
	assert.equal(menuBlocked('group', { groupBlock: 'frame' }), 'Frames cannot be grouped.')
	assert.equal(menuBlocked('group', { groupBlock: 'locked' }), 'Locked items cannot be grouped or ungrouped.')
	assert.equal(menuBlocked('group', { groupBlock: 'parent' }), 'Only items in the same frame, or all outside frames, can be grouped.')
	assert.equal(menuBlocked('ungroup', { ungroupBlock: 'locked' }), 'Locked items cannot be grouped or ungrouped.')
	assert.equal(menuBlocked('group', { groupBlock: null }), null)
	assert.equal(menuBlocked('ungroup', {}), null)
	assert.equal(menuBlocked('lock', { groupBlock: 'frame' }), null, 'only group and ungroup')
	assert.deepEqual(menuShortcut('group', true), { hint: '⌘G', aria: 'Meta+G' })
	assert.deepEqual(menuShortcut('group', false), { hint: 'Ctrl+G', aria: 'Control+G' })
	assert.deepEqual(menuShortcut('ungroup', true), { hint: '⌘⇧G', aria: 'Meta+Shift+G' })
	assert.deepEqual(menuShortcut('ungroup', false), { hint: 'Ctrl+Shift+G', aria: 'Control+Shift+G' })
	assert.deepEqual([menuLabel('group'), menuLabel('ungroup')], ['Group items', 'Ungroup'])
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual(['Group items', 'Ungroup', 'Group'].map((k) => de[k]), ['Gruppieren', 'Gruppierung aufheben', 'Gruppe'], 'AK9: "Group" (the share dialog) stays')
})

test('job 026 (AK7): ContextMenu.vue renders a blocked group entry with aria-disabled="true" and the reason as its title; a free one without', async () => {
	const render2 = async (extra) => strip(await render(ContextMenu, {
		menu: { id: 'id0', at: [0, 0], seq: 1, items: 2 },
		selection: sel(['sticky', 'sticky'], { groupable: 2, grouped: 1, oneGroup: false, ungroupBlock: null, ...extra }),
		host: null, canPaste: false, apple: false,
	}))
	let html = await render2({ groupBlock: 'parent' })
	const tag = (h, name) => h.match(new RegExp(`<button[^>]*data-knorke-menu-item="${name}"[^>]*>`))?.[0] ?? ''
	assert.match(tag(html, 'group'), /aria-disabled="true"/)
	assert.match(tag(html, 'group'), /title="Only items in the same frame, or all outside frames, can be grouped\."/)
	assert.match(tag(html, 'group'), /aria-keyshortcuts="Control\+G"/)
	assert.doesNotMatch(tag(html, 'ungroup'), /aria-disabled/)
	assert.match(tag(html, 'ungroup'), /aria-keyshortcuts="Control\+Shift\+G"/)
	html = await render2({ groupBlock: null, ungroupBlock: 'locked' })
	assert.doesNotMatch(tag(html, 'group'), /aria-disabled|title=/)
	assert.match(tag(html, 'ungroup'), /aria-disabled="true"[^>]*title="Locked items cannot be grouped or ungrouped\."|title="Locked items cannot be grouped or ungrouped\."[^>]*aria-disabled="true"/)
})

test('job 026 round 1 (code review 1, UX B1): the menu has no dead "Group items" – a member alone or a group plus a connector: ungroup only; the shortcut hint of a blocked entry is dimmed with its label (UI review 1)', () => {
	const member = sel(['sticky'], { groupable: 0, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(menuEntries(member, 'id0').filter((e) => e === 'group' || e === 'ungroup'), ['ungroup'], 'one member: groupable 0 (groupSummary)')
	const withConnector = sel(['sticky', 'sticky', 'connector'], { groupable: 0, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(menuEntries(withConnector, 'id0').filter((e) => e === 'group' || e === 'ungroup'), ['ungroup'], 'the group plus a connector')
	const css = readFileSync(new URL('../../../src/styles/knorke.css', import.meta.url), 'utf8')
	assert.match(css, /button\.knorke-contextmenu__item\[aria-disabled='true'\] \.knorke-contextmenu__label,\s*button\.knorke-contextmenu__item\[aria-disabled='true'\] \.knorke-contextmenu__key \{\s*opacity: var\(--opacity-disabled, 0\.5\);/)
})

// ---- Job 044: "Unlock all" and "Unlock all in this frame" for moderators -------

test('job 044 (AK1), job 230: MENU_ITEMS has unlock-frame after unlock (job 062: after unlock-by) and unlock-all last (job 062); menuEntries only with a whole count > 0; unlock-all never on items; the board menu has the mass unlocks before "Show grid"; labels; no shortcut, never blocked', () => {
	assert.equal(MENU_ITEMS.length, 78)
	assert.deepEqual(MENU_ITEMS.slice(MENU_ITEMS.indexOf('unlock'), MENU_ITEMS.indexOf('unlock') + 9), ['unlock', 'unlock-by', 'unlock-frame', 'zoom-selection', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv'])
	assert.deepEqual(MENU_ITEMS.slice(-6), ['fit', 'grid', 'grid-snap', 'wheel', 'cursors', 'unlock-all'])
	// the board menu (job 230: the mass unlocks, then the grid)
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockAll: 2 }), ['unlock-all'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, unlockAll: 1, grid: true, gridSnap: false }), ['unlock-all', 'grid', 'grid-snap'])
	for (const bad of [0, -1, 1.5, '2', null, NaN, Infinity]) {
		assert.deepEqual(menuEntries(null, null, { items: 3, unlockAll: bad }), [], 'unlockAll ' + String(bad))
		assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: true, unlockAll: bad }), ['grid', 'grid-snap'], 'unlockAll ' + String(bad) + ' with grid')
	}
	// the menu on items: in the lock group
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Bob' }, unlockBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(foreign, 'id0', { unlockFrame: 3 }), ['copy', 'unlock', 'unlock-frame', ...EXPORTS])
	const free = lockSel(['frame'], { count: 1, locked: 0, unlocked: 1, lockable: 1, unlockable: 0 })
	const list = menuEntries(free, 'id0', { unlockFrame: 2 })
	assert.equal(list[list.indexOf('lock') + 1], 'unlock-frame', 'right after lock: ' + list)
	assert.deepEqual(list.filter((e) => e !== 'unlock-frame'), menuEntries(free, 'id0'), 'the rest as before')
	for (const bad of [0, -2, 0.5, '1', undefined]) {
		assert.deepEqual(menuEntries(foreign, 'id0', { unlockFrame: bad }), ['copy', 'unlock', ...EXPORTS], 'unlockFrame ' + String(bad))
	}
	const both = { items: 3, unlockAll: 5, unlockFrame: 5 }
	assert.ok(!menuEntries(foreign, 'id0', both).includes('unlock-all'), 'unlock-all never on items')
	assert.deepEqual(menuEntries(null, null, both), ['unlock-frame', 'unlock-all'], 'job 062: the frame under the point, too')
	assert.equal(menuLabel('unlock-all'), 'Unlock all')
	assert.equal(menuLabel('unlock-frame'), 'Unlock all in this frame')
	for (const name of ['unlock-all', 'unlock-frame']) {
		assert.equal(menuShortcut(name, true), null, name)
		assert.equal(menuShortcut(name, false), null, name)
		assert.equal(menuBlocked(name, { groupBlock: 'frame', ungroupBlock: 'locked' }), null, name)
	}
})

const buttonsOf = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2], name: /data-knorke-menu-item="([^"]+)"/.exec(m[1])[1] }))

test('job 044 (AK2), job 230: ContextMenu.vue – the board menu with menu.unlockAll 2 renders "Unlock all" (a menuitem, no aria-keyshortcuts, no title) before "Show grid"; End and Enter emit grid; with 0 no button; a frame menu with menu.unlockFrame 1 renders "Unlock all in this frame" after lock', async () => {
	const boardHtml = async (menu) => strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, ...menu }, selection: sel([]), host: null, apple: false }))
	const buttons = buttonsOf(await boardHtml({ unlockAll: 2, grid: false }))
	assert.deepEqual(buttons.map((b) => b.name), ['unlock-all', 'grid'])
	const u = buttons[0]
	assert.match(u.attrs, /type="button"/)
	assert.match(u.attrs, /role="menuitem"/)
	assert.match(u.attrs, /tabindex="0"/)
	assert.doesNotMatch(u.attrs, /aria-keyshortcuts|title=|aria-disabled|aria-checked/)
	assert.match(u.inner, /<span class="knorke-contextmenu__label">Unlock all<\/span>/)
	assert.doesNotMatch(u.inner, /knorke-contextmenu__key/)
	assert.match(u.inner, /^<span class="knorke-contextmenu__check" aria-hidden="true"><\/span>/, 'an empty check column beside "Show grid"')
	for (const none of [{ unlockAll: 0 }, {}]) {
		assert.doesNotMatch(await boardHtml(none), /unlock-all/, JSON.stringify(none))
	}
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, unlockAll: 2, grid: true }, selection: sel([]), host: null, apple: false })
	assert.deepEqual(bindings.items.value.map((e) => e.name), ['unlock-all', 'grid'])
	bindings.onKey(key('Enter').e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'unlock-all'], 'the first entry has the focus')
	// a frame: the frame menu
	const frameSel = lockSel(['frame'], { count: 1, locked: 0, unlocked: 1, lockable: 1, unlockable: 0 })
	const fb = buttonsOf(strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockFrame: 1 }, selection: frameSel, host: null, apple: false })))
	const f = fb.find((b) => b.name === 'unlock-frame')
	assert.ok(f, 'the entry is there')
	assert.equal(fb[fb.indexOf(f) - 1].name, 'lock')
	assert.match(f.attrs, /role="menuitem"/)
	assert.doesNotMatch(f.attrs, /aria-keyshortcuts|title=/)
	assert.match(f.inner, /<span class="knorke-contextmenu__label">Unlock all in this frame<\/span>/)
	const noFrame = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockFrame: 0, unlockAll: 4 }, selection: frameSel, host: null, apple: false }))
	assert.doesNotMatch(noFrame, /unlock-frame|unlock-all/, 'unlockFrame 0; unlockAll never on items')
})

test('job 044 (AK2) mounted, job 230: the compiled template renders the board menu with "Unlock all" before "Show grid", the focus on the first entry, no count line', async () => {
	const m = await mountMenu({ ...BOARD, unlockAll: 2 })
	try {
		assert.deepEqual(m.items().map((n) => n.attrs['data-knorke-menu-item']), ['wheel', 'unlock-all'])
		assert.equal(m.doc.activeElement, m.items()[0])
		assert.equal(m.root().children.find((n) => n.attrs['data-knorke-menu-count'] !== undefined), undefined)
		assert.equal(m.items()[1].attrs['aria-keyshortcuts'] ?? null, null, 'no aria-keyshortcuts')
	} finally {
		m.done()
	}
})

test('job 044 (AK7), job 062 (AK8), job 086: the German texts – "Alles entsperren", "Alles in diesem Frame entsperren", the plural with two forms; the two new strings of job 062, unlock-by shortened by job 086', () => {
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Unlock all'], 'Alles entsperren', 'like "Alles auswählen" and "Alles zeigen"')
	assert.equal(de['Unlock all in this frame'], 'Alles in diesem Frame entsperren')
	assert.deepEqual(de['_%n item unlocked_::_%n items unlocked_'], ['%n Objekt entsperrt', '%n Objekte entsperrt'])
	assert.equal(de['Unlock all locked by {name}'], 'Alles von {name} entsperren', 'job 086: the name early, so it stays readable when the label is cut')
	assert.equal(de['Nothing left to unlock.'], 'Nichts mehr zu entsperren.')
	assert.deepEqual([de['Select all'], de['Show everything']], ['Alles auswählen', 'Alles zeigen'], 'the neighbours in the board menu')
})

// ---- Job 062: unlock-by, the frame entry in the board menu, the mass unlocks last ----

test('job 062 (AK1), job 230: MENU_ITEMS has 78 entries, unlock-all last after fit, grid, grid-snap, wheel, cursors; unlock-by, unlock-frame, zoom-selection after unlock; menuEntries of both menus; labels; no shortcut, never blocked', () => {
	assert.equal(MENU_ITEMS.length, 78)
	assert.equal(MENU_ITEMS.at(-1), 'unlock-all')
	assert.deepEqual(MENU_ITEMS.slice(-6, -1), ['fit', 'grid', 'grid-snap', 'wheel', 'cursors'])
	const u = MENU_ITEMS.indexOf('unlock')
	assert.deepEqual(MENU_ITEMS.slice(u + 1, u + 9), ['unlock-by', 'unlock-frame', 'zoom-selection', 'export-png', 'export-svg', 'export-pdf', 'export-bpmn', 'export-csv'])
	assert.equal(new Set(MENU_ITEMS).size, 78)
	// the board menu: wheel and the mass unlocks first, the grid last
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockAll: 2 }), ['unlock-all'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, unlockAll: 4, unlockFrame: 1, grid: true, gridSnap: false, wheel: 'zoom' }), ['wheel', 'unlock-frame', 'unlock-all', 'grid', 'grid-snap'])
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockFrame: 2 }), ['unlock-frame'])
	const plain = menuEntries(null, null, { items: 3, grid: true, gridSnap: true })
	for (const bad of [0, -1, 1.5, '2', undefined]) {
		assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: true, unlockFrame: bad, unlockAll: bad }), plain, 'unlockFrame/unlockAll ' + String(bad))
	}
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockBy: 3, unlockByName: 'Carol' }), [], 'no unlock-by on the empty canvas')
	// the menu on items
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Carol' }, unlockBy: { kind: 'name', name: 'Carol' } })
	assert.deepEqual(menuEntries(foreign, 'id0', { unlockBy: 2, unlockByName: 'Carol', unlockFrame: 3 }), ['copy', 'unlock', 'unlock-by', 'unlock-frame', ...EXPORTS])
	for (const env of [{ unlockBy: 0, unlockByName: 'Carol' }, { unlockBy: 2, unlockByName: '' }, { unlockBy: 2, unlockByName: null }, { unlockBy: 2 },
		{ unlockBy: 1.5, unlockByName: 'Carol' }, { unlockBy: '2', unlockByName: 'Carol' }, {}]) {
		assert.deepEqual(menuEntries(foreign, 'id0', env), ['copy', 'unlock', ...EXPORTS], JSON.stringify(env))
	}
	assert.ok(!menuEntries(foreign, 'id0', { unlockAll: 5, unlockBy: 1, unlockByName: 'Carol' }).includes('unlock-all'), 'unlock-all never on items')
	assert.equal(menuLabel('unlock-by', null, { unlockByName: 'Carol' }), 'Unlock all locked by Carol')
	assert.equal(menuLabel('unlock-by', null, { unlockByName: '<b>x</b> & {name}' }), 'Unlock all locked by <b>x</b> & {name}', 'plain text, never escaped by t()')
	assert.equal(menuLabel('unlock-by'), 'Unlock all locked by ')
	assert.equal(menuLabel('unlock-all'), 'Unlock all')
	assert.equal(menuLabel('unlock', { unlockBy: { kind: 'name', name: 'Carol' } }, { unlockByName: 'Dan' }), 'Unlock (locked by Carol)', 'env is only read by unlock-by')
	for (const apple of [true, false]) {
		assert.equal(menuShortcut('unlock-by', apple), null)
	}
	assert.equal(menuBlocked('unlock-by', { groupBlock: 'frame', ungroupBlock: 'locked' }), null)
})

test('job 062 (AK2), job 230: ContextMenu.vue – the board menu holds "Unlock all in this frame", "Unlock all" (no title, no key) before the grid; End + Enter emit grid; on an item unlock-by right after unlock, its label as escaped text and as title, no key', async () => {
	const board = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, unlockAll: 2, unlockFrame: 1, grid: false }, selection: sel([]), host: null, apple: false }))
	const bb = buttonsOf(board)
	assert.deepEqual(bb.map((b) => b.name), ['unlock-frame', 'unlock-all', 'grid'])
	assert.match(bb[0].inner, /<span class="knorke-contextmenu__label">Unlock all in this frame<\/span>/)
	assert.match(bb[1].inner, /<span class="knorke-contextmenu__label">Unlock all<\/span>/)
	for (const b of bb.slice(0, 2)) {
		assert.match(b.attrs, /role="menuitem"/, b.name)
		assert.doesNotMatch(b.attrs, /title=|aria-keyshortcuts/, b.name)
	}
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, unlockAll: 2, unlockFrame: 1, grid: false }, selection: sel([]), host: null, apple: false })
	bindings.onKey(key('End').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'grid')
	bindings.onKey(key('Enter').e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'grid'])
	// on an item someone else locked
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Carol <b>&' }, unlockBy: { kind: 'name', name: 'Carol <b>&' } })
	const html = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockBy: 2, unlockByName: 'Carol <b>&' }, selection: foreign, host: null, apple: false }))
	const ib = buttonsOf(html)
	assert.deepEqual(ib.map((b) => b.name), ['copy', 'unlock', 'unlock-by', ...EXPORTS], 'directly after unlock')
	const by = ib[2]
	assert.match(by.attrs, /role="menuitem"/)
	assert.match(by.inner, /<span class="knorke-contextmenu__label">Unlock all locked by Carol &lt;b&gt;&amp;<\/span>/)
	assert.match(by.attrs, /title="Unlock all locked by Carol &lt;b&gt;&amp;"/)
	assert.doesNotMatch(by.attrs, /aria-keyshortcuts/)
	assert.doesNotMatch(by.inner, /knorke-contextmenu__key/)
	assert.doesNotMatch(html, /<b>/, 'never HTML')
})

test('job 062 (AK2) mounted, job 230: the board menu holds unlock-frame and unlock-all after "Mouse wheel"; on an item unlock-by follows unlock with its label as text and title, no aria-keyshortcuts', async () => {
	const m = await mountMenu({ ...BOARD, unlockAll: 2, unlockFrame: 1 })
	try {
		assert.deepEqual(m.items().map((n) => n.attrs['data-knorke-menu-item']), ['wheel', 'unlock-frame', 'unlock-all'])
		assert.equal(m.doc.activeElement, m.items()[0])
		for (const n of m.items().slice(1)) {
			assert.equal(n.attrs.title ?? null, null, n.attrs['data-knorke-menu-item'] + ': no title')
			assert.equal(n.attrs['aria-keyshortcuts'] ?? null, null)
		}
	} finally {
		m.done()
	}
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Carol' }, unlockBy: { kind: 'name', name: 'Carol' } })
	const o = await mountMenu({ ...MENU, unlockBy: 2, unlockByName: 'Carol' }, { selection: foreign })
	try {
		const items = o.items()
		assert.deepEqual(items.map((n) => n.attrs['data-knorke-menu-item']), ['copy', 'unlock', 'unlock-by', ...EXPORTS])
		const by = items[2]
		assert.equal(by.attrs.title, 'Unlock all locked by Carol')
		assert.equal(by.attrs['aria-keyshortcuts'] ?? null, null)
		const label = by.children.find((c) => c.attrs.class === 'knorke-contextmenu__label')
		const text = label.text || label.children.map((c) => c.text).join('')
		assert.equal(text, 'Unlock all locked by Carol')
	} finally {
		o.done()
	}
})

// ---- Job 151: a guest's lock says "(guest)" ----------------------------------------------

test('job 151 (AK6): lockBadgeText, unlockLabel and menuLabel(unlock-by) say "(guest)" for a guest locker; an account stays as it was; German "Gesperrt von Anna (Gast)"', () => {
	const guest = { kind: 'name', name: 'Anna', guest: true }
	assert.equal(lockBadgeText({ lockedBy: guest, locked: 1 }), 'Locked by Anna (guest)')
	assert.equal(unlockLabel({ unlockBy: guest }), 'Unlock (locked by Anna (guest))')
	assert.equal(menuLabel('unlock', { unlockBy: guest }), 'Unlock (locked by Anna (guest))', 'the menu entry unlock')
	assert.equal(menuLabel('unlock-by', null, { unlockByName: 'Anna', unlockByGuest: true }), 'Unlock all locked by Anna (guest)')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'name', name: 'Anna' }, locked: 1 }), 'Locked by Anna', 'an account')
	assert.equal(unlockLabel({ unlockBy: { kind: 'name', name: 'Anna' } }), 'Unlock (locked by Anna)')
	assert.equal(menuLabel('unlock-by', null, { unlockByName: 'Anna' }), 'Unlock all locked by Anna')
	assert.equal(menuLabel('unlock-by', null, { unlockByName: 'Anna', unlockByGuest: 'true' }), 'Unlock all locked by Anna', 'only true counts')
	assert.equal(lockBadgeText({ lockedBy: { kind: 'name', name: '<b>x</b>', guest: true }, locked: 1 }), 'Locked by <b>x</b> (guest)', 'plain text')
	for (const kind of ['mine', 'unknown', 'several']) {
		assert.doesNotMatch(lockBadgeText({ lockedBy: { kind, guest: true }, locked: 2 }), /guest/, kind)
		assert.doesNotMatch(unlockLabel({ unlockBy: { kind, guest: true } }), /guest/, kind)
	}
	// German: the existing strings, composed
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	const reg = globalThis._oc_l10n_registry_translations
	const plural = globalThis._oc_l10n_registry_plural_functions
	reg.knorke = de
	plural.knorke = (k) => (k === 1 ? 0 : 1)
	try {
		assert.equal(lockBadgeText({ lockedBy: guest, locked: 1 }), 'Gesperrt von Anna (Gast)')
		assert.equal(unlockLabel({ unlockBy: guest }), 'Entsperren (von Anna (Gast))')
		assert.equal(menuLabel('unlock-by', null, { unlockByName: 'Anna', unlockByGuest: true }), de['Unlock all locked by {name}'].replace('{name}', 'Anna (Gast)'))
	} finally {
		delete reg.knorke
		delete plural.knorke
	}
})

test('job 151 (AK6): ContextMenu.vue with a guest\'s lock – unlock and unlock-by say "(guest)" as text and title; an account\'s menu has no "(guest)"', async () => {
	const guest = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Gina', guest: true }, unlockBy: { kind: 'name', name: 'Gina', guest: true } })
	const html = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockBy: 2, unlockByName: 'Gina', unlockByGuest: true }, selection: guest, host: null, apple: false }))
	const ib = buttonsOf(html)
	assert.deepEqual(ib.map((b) => b.name), ['copy', 'unlock', 'unlock-by', ...EXPORTS])
	assert.match(ib[1].inner, /<span class="knorke-contextmenu__label">Unlock \(locked by Gina \(guest\)\)<\/span>/)
	assert.match(ib[2].inner, /<span class="knorke-contextmenu__label">Unlock all locked by Gina \(guest\)<\/span>/)
	assert.match(ib[2].attrs, /title="Unlock all locked by Gina \(guest\)"/)
	const account = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Carol' }, unlockBy: { kind: 'name', name: 'Carol' } })
	const plain = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 4, items: 3, unlockBy: 2, unlockByName: 'Carol' }, selection: account, host: null, apple: false }))
	assert.match(plain, /Unlock all locked by Carol</)
	assert.doesNotMatch(plain, /guest/)
})

// ---- Job 143: "Rename" for a frame ----------------------------------------------------

test('job 143 (AK7), job 230: edit-text reads "Rename" for exactly one frame, else "Edit text"; name, rule and key Enter stay (no menu lists it: the bar\'s "Rename", Enter and a double click)', async () => {
	assert.equal(menuLabel('edit-text', sel(['frame'])), 'Rename')
	assert.equal(menuLabel('edit-text', sel(['sticky'])), 'Edit text')
	for (const types of [['shape'], ['text'], ['connector'], ['frame', 'frame'], ['frame', 'sticky'], []]) {
		assert.equal(menuLabel('edit-text', sel(types)), 'Edit text', types.join('+') || 'nothing')
	}
	assert.equal(menuLabel('edit-text'), 'Edit text', 'without a selection')
	assert.equal(menuLabel('edit-text', 0), 'Edit text', 'Array.map(menuLabel) passes an index')
	assert.ok(!menuEntries(sel(['frame']), 'id0').includes('edit-text'), 'job 230: not in the menu')
	assert.deepEqual(menuShortcut('edit-text', false), { hint: 'Enter', aria: 'Enter' })
	assert.deepEqual(menuShortcut('edit-text', true), { hint: '↩', aria: 'Enter' })
})

// ---- Job 144: filter the selection -------------------------------------------------------

test('job 144 (AK4), job 230: the menu lists no only-<kind> (the bar\'s chip narrows the selection); the labels with the count stay, no shortcut, never blocked', async () => {
	const kinds = [{ kind: 'sticky', count: 5 }, { kind: 'shape', count: 2 }, { kind: 'connector', count: 1 }, { kind: 'group', count: 1 }]
	const f = sel(['sticky', 'sticky', 'sticky', 'sticky', 'shape', 'shape', 'connector', 'sticky', 'widget'], { kinds, locked: 1, unlocked: 8 })
	assert.ok(!menuEntries(f, 'id0').some((e) => e.startsWith('only-')))
	assert.ok(!menuEntries(f, null, { items: 9 }).some((e) => e.startsWith('only-')), 'never in the board menu')
	assert.equal(menuLabel('only-group', f), 'Only groups (1)')
	assert.equal(menuLabel('only-sticky', f), 'Only notes (5)')
	assert.equal(menuLabel('only-connector', f), 'Only connectors (1)')
	for (const name of ['only-sticky', 'only-shape', 'only-text', 'only-connector', 'only-frame', 'only-group']) {
		assert.equal(menuShortcut(name, false), null, name)
		assert.equal(menuShortcut(name, true), null, name + ' (Apple)')
		assert.equal(menuBlocked(name, f), null, name + ' is never blocked')
	}
	const html = strip(await render(ContextMenu, { menu: MENU, selection: f, host: null, apple: false }))
	assert.doesNotMatch(html, /data-knorke-menu-item="only-/)
})

// ---- Job 147: hide other people's cursors -------------------------------------------------

test('job 147 (AK1), job 230: the menu lists no cursors entry any more (the key C switches them); label and key stay', () => {
	for (const env of [{ grid: false, cursors: true }, { items: 3, cursors: false }, { grid: true, gridSnap: true, cursors: true, unlockFrame: 1, unlockAll: 2 }]) {
		assert.ok(!menuEntries(null, null, env).includes('cursors'), JSON.stringify(env))
	}
	assert.ok(!menuEntries(sel(['sticky']), 'id0', { grid: true, cursors: true }).includes('cursors'), 'never on items')
	assert.equal(menuLabel('cursors'), 'Show other people\'s cursors')
	assert.deepEqual(menuShortcut('cursors', false), { hint: 'C', aria: 'C' })
	assert.deepEqual(menuShortcut('cursors', true), { hint: 'C', aria: 'C' })
	assert.equal(menuBlocked('cursors', sel([])), null)
})

test('job 147 (AK1), job 230: ContextMenu.vue never renders the cursors entry, whatever menu.cursors says', async () => {
	for (const cursors of [true, false]) {
		const html = strip(await render(ContextMenu, { menu: { ...BOARD, grid: true, gridSnap: true, cursors, unlockAll: 1 }, selection: sel([]), host: null, apple: false }))
		assert.deepEqual(buttonsOf(html).map((b) => b.name), ['wheel', 'unlock-all', 'grid', 'grid-snap'])
	}
})

// ---- Job 154: the mouse wheel zooms ---------------------------------------------------------

test('job 154 (AK6), job 230: menuEntries puts wheel first in the board menu, before the mass unlocks and the grid; only with env.wheel auto, zoom or pan; never on items; three labels; no shortcut, never blocked', () => {
	assert.deepEqual(menuEntries(null, null, { grid: false, wheel: 'auto', cursors: true }), ['wheel', 'grid'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: true, wheel: 'pan', cursors: false }), ['wheel', 'grid', 'grid-snap'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: true, gridSnap: true, wheel: 'zoom', cursors: true, unlockFrame: 1, unlockAll: 2 }),
		['wheel', 'unlock-frame', 'unlock-all', 'grid', 'grid-snap'])
	assert.deepEqual(menuEntries(null, null, { items: 3, wheel: 'auto' }), ['wheel'], 'without the grid key too')
	for (const bad of [undefined, null, 'x', 'Zoom', '', true, 1]) {
		assert.ok(!menuEntries(null, null, { items: 3, grid: false, wheel: bad, cursors: true }).includes('wheel'), 'wheel ' + String(bad))
	}
	for (const s of [sel(['sticky']), sel(['frame'], { unlocked: 1 }), sel([], { count: 1, locked: 1, unlocked: 0 })]) {
		assert.ok(!menuEntries(s, 'id0', { grid: true, gridSnap: true, wheel: 'auto', cursors: true }).includes('wheel'), 'never on items')
	}
	assert.equal(MENU_ITEMS.indexOf('wheel'), MENU_ITEMS.indexOf('grid-snap') + 1)
	assert.equal(menuLabel('wheel', null, { wheel: 'auto' }), 'Mouse wheel: Automatic')
	assert.equal(menuLabel('wheel', null, { wheel: 'zoom' }), 'Mouse wheel: Zoom')
	assert.equal(menuLabel('wheel', null, { wheel: 'pan' }), 'Mouse wheel: Pan')
	assert.equal(menuLabel('wheel'), 'Mouse wheel: Automatic', 'no stage: Automatic')
	assert.equal(menuShortcut('wheel', false), null)
	assert.equal(menuShortcut('wheel', true), null)
	assert.equal(menuBlocked('wheel', sel([])), null)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual(['Mouse wheel: Automatic', 'Mouse wheel: Zoom', 'Mouse wheel: Pan'].map((k) => de[k]), ['Mausrad: Automatisch', 'Mausrad: Zoomen', 'Mausrad: Verschieben'])
})

test('job 154 (AK6), job 230: ContextMenu.vue renders wheel as role=menuitem without aria-checked and key, labelled with menu.wheel; Enter emits action wheel', async () => {
	for (const [wheel, label, apple] of [['auto', 'Automatic', false], ['zoom', 'Zoom', true], ['pan', 'Pan', false]]) {
		const list = buttonsOf(strip(await render(ContextMenu, { menu: { ...BOARD, grid: true, gridSnap: false, wheel }, selection: sel([]), host: null, apple })))
		assert.deepEqual(list.map((b) => b.name), ['wheel', 'grid', 'grid-snap'])
		const w = list[0]
		assert.match(w.attrs, /type="button"/)
		assert.match(w.attrs, /role="menuitem"/)
		assert.doesNotMatch(w.attrs, /aria-checked|menuitemcheckbox/)
		assert.doesNotMatch(w.attrs, /aria-keyshortcuts/)
		assert.match(w.inner, new RegExp(`<span class="knorke-contextmenu__label">Mouse wheel: ${label}</span>`))
		assert.doesNotMatch(w.inner, /knorke-contextmenu__key/)
		assert.match(w.inner, /^<span class="knorke-contextmenu__check" aria-hidden="true"><\/span>/, 'an empty check column, so the labels line up')
	}
	// alone: a plain menu without the check column
	const alone = buttonsOf(strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, wheel: 'zoom' }, selection: sel([]), host: null, apple: false })))
	assert.deepEqual(alone.map((b) => b.name), ['wheel'])
	assert.ok(alone.every((b) => !b.inner.includes('knorke-contextmenu__check')), 'no state: no check column')
	assert.doesNotMatch(strip(await render(ContextMenu, { menu: { ...BOARD, wheel: 'x' }, selection: sel([]), host: null, apple: false })), /data-knorke-menu-item="wheel"/, 'no valid stage: no entry')
	assert.doesNotMatch(strip(await render(ContextMenu, { menu: { ...MENU, wheel: 'auto' }, selection: sel(['sticky']), host: null, apple: false })), /data-knorke-menu-item="wheel"/, 'never on items')
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { ...BOARD, grid: false, wheel: 'pan' }, selection: sel([]), host: null, apple: false })
	assert.deepEqual(bindings.items.value.map((e) => [e.name, e.checked]), [['wheel', null], ['grid', false]])
	assert.equal(bindings.items.value[0].label, 'Mouse wheel: Pan')
	bindings.onKey(key('Enter').e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'wheel'])
})

test('job 173 AK6, job 230: menuEntries on a cell of the one selected table – the inserts, the deletes, then table-csv as a group before the exports; no delete with one row or column; a locked table only table-csv; labels', () => {
	const one = { ids: ['T'], count: 1, unlocked: 1, types: new Set(['table']), fields: [] }
	assert.deepEqual(menuEntries(one, 'T', { table: { rows: 3, cols: 3, locked: false } }),
		['cut', 'copy', 'duplicate', 'front', 'back', 'row-above', 'row-below', 'col-left', 'col-right', 'row-delete', 'col-delete', 'table-csv', ...EXPORTS, 'delete'])
	assert.deepEqual(menuEntries(one, 'T', { table: { rows: 1, cols: 3, locked: false } }).filter((x) => x.includes('-delete')), ['col-delete'], 'one row: no row-delete')
	assert.deepEqual(menuEntries(one, 'T', { table: { rows: 2, cols: 1, locked: false } }).filter((x) => x.includes('-delete')), ['row-delete'], 'one column: no col-delete')
	const locked = { ids: ['T'], count: 1, unlocked: 0, locked: 1, types: new Set(), fields: [] }
	assert.deepEqual(menuEntries(locked, 'T', { table: { rows: 3, cols: 3, locked: true } }), ['copy', 'table-csv', ...EXPORTS], 'locked: only table-csv of the table entries')
	assert.equal(menuEntries(one, 'T', {}).some((x) => x.startsWith('row-') || x.startsWith('col-') || x === 'table-csv'), false, 'without a cell (env.table) none')
	assert.equal(menuEntries(one, 'T', { table: null }).includes('table-csv'), false)
	assert.deepEqual(['row-above', 'row-below', 'col-left', 'col-right', 'row-delete', 'col-delete', 'table-csv'].map((x) => menuLabel(x)),
		['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete row', 'Delete column', 'Export as CSV'])
	for (const x of ['row-above', 'row-delete', 'table-csv']) assert.equal(menuShortcut(x, false), null, x)
})

// ---- Job 178: "Save as image (PNG)" -------------------------------------------

test('job 178 AK5, job 230: menuEntries on items lists export-png first of the exports, before delete (locked items only too); never on the empty canvas; label, no key; the rendered entry', async () => {
	const note = menuEntries(sel(['sticky']), 'id0')
	assert.equal(note.at(-6), 'export-png', 'job 200: export-svg and export-pdf after it; job 205: export-bpmn; job 179: then export-csv; job 230: delete last')
	const locked = lockSel(['sticky'], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(locked, 'id0'), ['copy', ...EXPORTS], 'only locked items')
	for (const env of [{}, { canPaste: true, items: 3, grid: true, gridSnap: true, wheel: 'auto', cursors: true, unlockAll: 2, unlockFrame: 1 }, { items: 0 }]) {
		assert.ok(!menuEntries(null, null, env).includes('export-png'), 'the board menu never: ' + JSON.stringify(env))
	}
	assert.equal(MENU_ITEMS.indexOf('export-png'), MENU_ITEMS.indexOf('zoom-selection') + 1)
	assert.equal(menuLabel('export-png'), 'Save as image (PNG)')
	assert.equal(menuShortcut('export-png', false), null)
	assert.equal(menuShortcut('export-png', true), null)
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false }))
	const entry = html.match(/<button[^>]*data-knorke-menu-item="export-png"[^>]*>[\s\S]*?<\/button>/)?.[0]
	assert.ok(entry, 'rendered')
	assert.match(entry, /Save as image \(PNG\)/)
	assert.doesNotMatch(entry, /aria-keyshortcuts/)
})

// ---- Job 179: "Save as CSV" ---------------------------------------------------

test('job 179 AK5: menuEntries on items lists export-csv directly after export-png, svg, pdf and bpmn (locked items only too, a table cell too); never on the empty canvas; label "Save as CSV", no key; in de.json; the rendered entry', async () => {
	const after = (list) => list[list.indexOf('export-png') + 4]
	assert.equal(after(menuEntries(sel(['sticky']), 'id0')), 'export-csv')
	const locked = lockSel(['sticky'], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(locked, 'id0'), ['copy', ...EXPORTS], 'only locked items')
	const cell = menuEntries(sel(['table']), 'T', { table: { rows: 2, cols: 2, locked: false } })
	assert.ok(cell.includes('table-csv') && after(cell) === 'export-csv', 'a table cell: both CSV entries')
	for (const env of [{}, { canPaste: true, items: 3, grid: true, gridSnap: true, wheel: 'auto', cursors: true, unlockAll: 2, unlockFrame: 1 }, { items: 0 }]) {
		assert.ok(!menuEntries(null, null, env).includes('export-csv'), 'the board menu never: ' + JSON.stringify(env))
	}
	assert.equal(MENU_ITEMS.indexOf('export-csv'), MENU_ITEMS.indexOf('export-png') + 4)
	assert.equal(menuLabel('export-csv'), 'Save as CSV')
	assert.equal(menuShortcut('export-csv', false), null)
	assert.equal(menuShortcut('export-csv', true), null)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Save as CSV'], 'Als CSV speichern')
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false }))
	const entry = html.match(/<button[^>]*data-knorke-menu-item="export-csv"[^>]*>[\s\S]*?<\/button>/)?.[0]
	assert.ok(entry, 'rendered')
	assert.match(entry, /Save as CSV/)
	assert.doesNotMatch(entry, /aria-keyshortcuts/)
})

// ---- Job 200: "Save as SVG" and "Save as PDF" ---------------------------------

test('job 200 AK1: menuEntries on items lists export-svg and export-pdf between export-png and export-csv (locked items only too); never on the empty canvas; labels, no key; in de.json; rendered', async () => {
	const note = menuEntries(sel(['sticky']), 'id0')
	assert.deepEqual(note.slice(note.indexOf('export-png')), [...EXPORTS, 'delete'])
	const locked = lockSel(['sticky'], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(locked, 'id0'), ['copy', ...EXPORTS])
	for (const env of [{}, { canPaste: true, items: 3, grid: true }, { items: 0 }]) {
		const board = menuEntries(null, null, env)
		assert.ok(!board.includes('export-svg') && !board.includes('export-pdf'), JSON.stringify(env))
	}
	assert.deepEqual(MENU_ITEMS.slice(MENU_ITEMS.indexOf('export-png'), MENU_ITEMS.indexOf('export-csv') + 1), EXPORTS)
	assert.deepEqual([menuLabel('export-svg'), menuLabel('export-pdf')], ['Save as SVG', 'Save as PDF…'])
	for (const k of ['export-svg', 'export-pdf']) for (const apple of [false, true]) assert.equal(menuShortcut(k, apple), null)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual([de['Save as SVG'], de['Save as PDF…']], ['Als SVG speichern', 'Als PDF speichern…'])
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, apple: false }))
	assert.match(html, /data-knorke-menu-item="export-png"[\s\S]*data-knorke-menu-item="export-svg"[\s\S]*Save as SVG[\s\S]*data-knorke-menu-item="export-pdf"[\s\S]*Save as PDF[\s\S]*data-knorke-menu-item="export-csv"/)
})

test('job 188 AK6, job 230: no menu lists pad-here any more (the tool "Note pad" places one); label "Add note pad here" ("Notizblock hier hinzufügen"), no shortcut', () => {
	for (const env of [{}, { canPaste: true, items: 0 }, { items: 3, grid: true, gridSnap: true, cursors: true, unlockAll: 2 }]) {
		assert.ok(!menuEntries(null, null, env).includes('pad-here'), JSON.stringify(env))
	}
	assert.equal(MENU_ITEMS[MENU_ITEMS.indexOf('note-here') + 1], 'pad-here')
	assert.equal(menuLabel('pad-here'), 'Add note pad here')
	assert.equal(menuShortcut('pad-here', true), null)
	assert.equal(menuShortcut('pad-here', false), null)
	assert.ok(!menuEntries(sel(['sticky']), 'id0').includes('pad-here'), 'not on items')
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Add note pad here'], 'Notizblock hier hinzufügen')
})

test('job 195 AK5: the menu on a node of the one selected mind map – after back mm-child, mm-sibling, mm-fold, mm-delete, mm-text; the root without sibling, fold and delete; locked only mm-text; the labels and keys', () => {
	const map = sel(['mindmap'])
	const on = (env) => menuEntries(map, 'id0', { mindmap: env })
	const mm = (list) => list.filter((x) => x.startsWith('mm-'))
	assert.deepEqual(mm(on({ root: false, kids: 2, folded: false, locked: false })), ['mm-child', 'mm-sibling', 'mm-fold', 'mm-delete', 'mm-text'])
	const list = on({ root: false, kids: 2, folded: false, locked: false })
	assert.equal(list.indexOf('mm-child'), list.indexOf('back') + 1, 'right after back')
	assert.deepEqual(mm(on({ root: false, kids: 0, folded: false, locked: false })), ['mm-child', 'mm-sibling', 'mm-delete', 'mm-text'], 'no children: no fold')
	assert.deepEqual(mm(on({ root: true, kids: 3, folded: false, locked: false })), ['mm-child', 'mm-text'], 'the root')
	assert.deepEqual(mm(on({ root: false, kids: 2, folded: false, locked: true })), ['mm-text'], 'locked')
	assert.deepEqual(mm(menuEntries(map, 'id0')), [], 'without env.mindmap none')
	assert.equal(menuLabel('mm-fold', null, { mindmap: { folded: true } }), 'Unfold branch')
	assert.equal(menuLabel('mm-fold', null, { mindmap: { folded: false } }), 'Fold branch')
	assert.deepEqual(['mm-child', 'mm-sibling', 'mm-delete', 'mm-text'].map((x) => menuLabel(x)), ['Add child', 'Add sibling', 'Delete branch', 'Copy as text'])
	assert.deepEqual(menuShortcut('mm-child', false), { hint: 'Tab', aria: 'Tab' })
	assert.deepEqual(menuShortcut('mm-sibling', false), { hint: 'Enter', aria: 'Enter' })
	assert.equal(menuShortcut('mm-text', false), null)
	assert.equal(menuShortcut('mm-fold', false), null)
	assert.ok(!list.includes('edit-text'), 'a mind map has no text of its own')
})

test('job 196 AK5: mm-rearrange ("Rearrange") follows mm-fold, at the root mm-child, only when its branch is placed freely, never locked', () => {
	const map = sel(['mindmap'])
	const mm = (env) => menuEntries(map, 'id0', { mindmap: env }).filter((x) => x.startsWith('mm-'))
	assert.deepEqual(mm({ root: false, kids: 2, folded: false, locked: false, placed: true }), ['mm-child', 'mm-sibling', 'mm-fold', 'mm-rearrange', 'mm-delete', 'mm-text'])
	assert.deepEqual(mm({ root: false, kids: 0, folded: false, locked: false, placed: true }), ['mm-child', 'mm-sibling', 'mm-rearrange', 'mm-delete', 'mm-text'], 'no children')
	assert.deepEqual(mm({ root: true, kids: 3, folded: false, locked: false, placed: true }), ['mm-child', 'mm-rearrange', 'mm-text'], 'the root')
	assert.deepEqual(mm({ root: false, kids: 2, folded: false, locked: false, placed: false }), ['mm-child', 'mm-sibling', 'mm-fold', 'mm-delete', 'mm-text'], 'nothing placed freely')
	assert.deepEqual(mm({ root: false, kids: 2, folded: false, locked: true, placed: true }), ['mm-text'], 'locked')
	assert.equal(menuLabel('mm-rearrange'), 'Rearrange')
	assert.equal(menuShortcut('mm-rearrange', false), null)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de.Rearrange, 'Neu anordnen')
})

test('job 199 AK5: the menu on a lane of the one selected frame – after back lane-rename, lane-above, lane-below, lane-up, lane-down, lane-delete; the first without up, the last without down, one lane without delete; locked none; a plain frame none; labels, no keys', () => {
	const fr = sel(['frame'])
	const on = (env) => menuEntries(fr, 'id0', { lanes: env })
	// (job 225) the group entries after lane-delete: test of job 225
	const ln = (list) => list.filter((x) => x.startsWith('lane-') && !x.includes('group'))
	const list = on({ index: 1, count: 3, locked: false })
	assert.deepEqual(ln(list), ['lane-rename', 'lane-above', 'lane-below', 'lane-up', 'lane-down', 'lane-delete'])
	assert.equal(list.indexOf('lane-rename'), list.indexOf('back') + 1, 'right after back')
	assert.deepEqual(ln(on({ index: 0, count: 3, locked: false })), ['lane-rename', 'lane-above', 'lane-below', 'lane-down', 'lane-delete'], 'the first lane')
	assert.deepEqual(ln(on({ index: 2, count: 3, locked: false })), ['lane-rename', 'lane-above', 'lane-below', 'lane-up', 'lane-delete'], 'the last lane')
	assert.deepEqual(ln(on({ index: 0, count: 1, locked: false })), ['lane-rename', 'lane-above', 'lane-below'], 'the only lane')
	assert.deepEqual(ln(on({ index: 1, count: 3, locked: true })), [], 'a locked frame')
	assert.deepEqual(ln(menuEntries(fr, 'id0')), [], 'a plain frame (no env.lanes)')
	assert.deepEqual(['lane-rename', 'lane-above', 'lane-below', 'lane-up', 'lane-down', 'lane-delete'].map((x) => menuLabel(x)),
		['Rename lane', 'Add lane above', 'Add lane below', 'Move lane up', 'Move lane down', 'Delete lane'])
	for (const x of ['lane-rename', 'lane-above', 'lane-below', 'lane-up', 'lane-down', 'lane-delete']) {
		assert.equal(menuShortcut(x, false), null, x)
	}
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual([de['Rename lane'], de['Delete lane'], de['Lane {n}']], ['Bahn umbenennen', 'Bahn löschen', 'Bahn {n}'])
	// the menu component hands the session's lanes to menuEntries
	const vue = readFileSync(new URL('../../../src/components/ContextMenu.vue', import.meta.url), 'utf8')
	assert.match(vue, /lanes: props\.menu\.lanes \?\? null,/)
})

test('job 205 AK7: the menu on items lists export-bpmn ("Save as BPMN", "Als BPMN speichern") between export-pdf and export-csv, locked items too, no shortcut; never the empty canvas', async () => {
	for (const s of [sel(['sticky']), sel(['shape', 'shape']), lockSel(['sticky'], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } })]) {
		const list = menuEntries(s, 'id0')
		assert.equal(list[list.indexOf('export-pdf') + 1], 'export-bpmn')
		assert.equal(list[list.indexOf('export-bpmn') + 1], 'export-csv')
	}
	for (const env of [{}, { canPaste: true, items: 3, grid: true }, { items: 0 }]) {
		assert.ok(!menuEntries(null, null, env).includes('export-bpmn'), JSON.stringify(env))
	}
	assert.equal(menuLabel('export-bpmn'), 'Save as BPMN')
	for (const apple of [false, true]) assert.equal(menuShortcut('export-bpmn', apple), null)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.equal(de['Save as BPMN'], 'Als BPMN speichern')
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, canPaste: false, apple: false }))
	assert.match(html, /data-knorke-menu-item="export-pdf"[\s\S]*data-knorke-menu-item="export-bpmn"[\s\S]*Save as BPMN[\s\S]*data-knorke-menu-item="export-csv"/)
})

test('job 208 AK5: after the lane entries column-add without columns; with them column-rename, column-left, column-right, column-move-left (not at the first), column-move-right (not at the last), column-delete; locked none; labels, no keys', () => {
	const fr = sel(['frame'])
	const on = (cols, locked = false) => menuEntries(fr, 'id0', { lanes: { index: 1, count: 3, locked, cols } })
	// (job 225) the group entries after column-delete: test of job 225
	const cl = (list) => list.filter((x) => x.startsWith('column-') && !x.includes('group'))
	const none = on(null)
	assert.deepEqual(cl(none), ['column-add'])
	assert.equal(none.indexOf('column-add'), none.indexOf('lane-group') + 1, 'right after the lane entries (job 225: and the lane\'s group)')
	const all = ['column-rename', 'column-left', 'column-right', 'column-move-left', 'column-move-right', 'column-delete']
	assert.deepEqual(cl(on({ index: 1, count: 3 })), all)
	assert.deepEqual(cl(on({ index: 0, count: 3 })), all.filter((x) => x !== 'column-move-left'), 'the first column')
	assert.deepEqual(cl(on({ index: 2, count: 3 })), all.filter((x) => x !== 'column-move-right'), 'the last column')
	assert.deepEqual(cl(on({ index: 0, count: 1 })), ['column-rename', 'column-left', 'column-right', 'column-delete'], 'the only column: delete is there')
	assert.deepEqual(cl(on({})), [], 'columns, but none under W')
	assert.deepEqual(cl(on({ index: 1, count: 3 }, true)), [], 'a locked frame')
	assert.deepEqual(cl(menuEntries(fr, 'id0')), [], 'a plain frame')
	assert.deepEqual(['column-add', ...all].map((x) => menuLabel(x)),
		['Add column', 'Rename column', 'Add column left', 'Add column right', 'Move column left', 'Move column right', 'Delete column'])
	for (const x of ['column-add', ...all]) assert.equal(menuShortcut(x, false), null, x)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual([de['Add column'], de['Move column right'], de['The frame cannot get any wider.']], ['Spalte hinzufügen', 'Spalte nach rechts', 'Der Rahmen kann nicht breiter werden.'])
})

test('job 225 AK5: after lane-delete lane-group (no group) or lane-group-rename and lane-ungroup; after column-delete the same for the column; locked none; labels, German, no keys', () => {
	const fr = sel(['frame'])
	const on = (lanes) => menuEntries(fr, 'id0', { lanes })
	const gr = (list) => list.filter((x) => x.includes('group'))
	const free = on({ index: 1, count: 3, locked: false, group: false, cols: null })
	assert.deepEqual(gr(free), ['lane-group'])
	assert.equal(free.indexOf('lane-group'), free.indexOf('lane-delete') + 1)
	const inG = on({ index: 1, count: 3, locked: false, group: true, cols: { index: 0, count: 2, group: true } })
	assert.deepEqual(gr(inG), ['lane-group-rename', 'lane-ungroup', 'column-group-rename', 'column-ungroup'])
	assert.equal(inG.indexOf('column-group-rename'), inG.indexOf('column-delete') + 1)
	assert.deepEqual(gr(on({ index: 0, count: 1, locked: false, group: false, cols: { index: 0, count: 2, group: false } })), ['lane-group', 'column-group'])
	assert.deepEqual(gr(on({ index: 0, count: 3, locked: true, group: true, cols: { index: 0, count: 2, group: true } })), [], 'a locked frame')
	const names = ['lane-group', 'lane-group-rename', 'lane-ungroup', 'column-group', 'column-group-rename', 'column-ungroup']
	assert.deepEqual(names.map((x) => menuLabel(x)),
		['Create lane group', 'Rename lane group', 'Dissolve lane group', 'Create column group', 'Rename column group', 'Dissolve column group'])
	for (const x of names) assert.equal(menuShortcut(x, false), null, x)
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	assert.deepEqual(['Create lane group', 'Dissolve lane group', 'Create column group', 'Rename column group'].map((x) => de[x]),
		['Bahngruppe bilden', 'Bahngruppe auflösen', 'Spaltengruppe bilden', 'Spaltengruppe umbenennen'])
})
