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
 * The count line of the board menu (menuCount): plural text from menu.items,
 * only on the empty canvas, aria-hidden and named through aria-describedby,
 * never an entry. A press beside the entries (count line; the root itself
 * while the menu has nothing to scroll, noScrollRange) keeps the focus.
 * Job 044: the moderators' entries unlock-all (board menu) and unlock-frame
 * (on a frame), shown from menu.unlockAll / menu.unlockFrame. Job 062: both
 * mass unlocks last in the board menu (unlock-frame there for the frame
 * under the point), unlock-by after unlock on items (menu.unlockBy,
 * menu.unlockByName, its label as text and title), "Alles entsperren".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MENU_ITEMS, lockBadgeText, menuBlocked, menuCount, menuEntries, menuLabel, menuName, menuShortcut, unlockLabel } from '../../../src/components/contextbar.js'
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

const ON_ITEMS = ['cut', 'copy', 'duplicate', 'delete', 'front', 'back']

test('menuEntries (T4-02): on one note: the bar\'s commands, edit-text, zoom-selection; connect only with the bar\'s "Connect"', () => {
	assert.deepEqual(menuEntries(sel(['sticky']), 'id0'), [...ON_ITEMS, 'edit-text', 'zoom-selection'])
	assert.deepEqual(menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'id1'), [...ON_ITEMS, 'connect', 'zoom-selection'], 'two bindable items: connect, no edit-text')
	assert.deepEqual(menuEntries(sel(['sticky', 'frame']), 'id0'), [...ON_ITEMS, 'zoom-selection'], 'a frame is not bindable: no connect')
	assert.deepEqual(menuEntries(sel(['sticky', 'sticky', 'sticky']), 'id0'), [...ON_ITEMS, 'zoom-selection'])
	for (const t of ['shape', 'text', 'frame', 'connector']) {
		assert.ok(menuEntries(sel([t]), 'id0').includes('edit-text'), t + ' has a text path (Enter edits it)')
	}
	assert.deepEqual(menuEntries(sel(['sticky']), 'id0', { canPaste: true }), [...ON_ITEMS, 'edit-text', 'zoom-selection'], 'paste-here never on items')
})

test('menuEntries (T4-02, T4-03): on the empty canvas – paste-here only with canPaste (secure context), select-all not on an empty board', () => {
	assert.deepEqual(menuEntries(sel([]), null), ['note-here', 'select-all', 'fit'], 'the two-argument call: no paste-here')
	assert.deepEqual(menuEntries(null, null, { canPaste: false, items: 3 }), ['note-here', 'select-all', 'fit'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3 }), ['paste-here', 'note-here', 'select-all', 'fit'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 0 }), ['paste-here', 'note-here', 'fit'])
	assert.deepEqual(menuEntries(null, undefined), ['note-here', 'select-all', 'fit'])
	for (const list of [menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'x'), menuEntries(null, null, { canPaste: true })]) {
		assert.ok(list.every((x) => MENU_ITEMS.includes(x)))
		assert.equal(new Set(list).size, list.length)
	}
	assert.equal(MENU_ITEMS.length, 22, 'job 023: lock and unlock; job 026: group and ungroup; job 044: unlock-frame and unlock-all; job 062: unlock-by')
	assert.ok(!MENU_ITEMS.some((x) => x === 'paste'), 'no generic paste entry')
})

test('menuCount: the plural text for the board menu (id null/undefined, a whole count ≥ 0), else null (menu on items, no or a bad count)', () => {
	assert.equal(menuCount(null, 0), '0 items on this board')
	assert.equal(menuCount(null, 1), '1 item on this board')
	assert.equal(menuCount(null, 3), '3 items on this board')
	assert.equal(menuCount(undefined, 5000), '5000 items on this board', '%n is the bare number')
	assert.equal(menuCount('01JA0000000000000000000001', 3), null, 'menu on items: no line')
	for (const bad of [undefined, -1, 1.5, NaN, '3', null, Infinity]) {
		assert.equal(menuCount(null, bad), null, 'items ' + String(bad))
	}
})

test('labels (§6.11): the bar\'s texts where the bar has the action, the new ones for the rest; root names by target', () => {
	assert.deepEqual(MENU_ITEMS.map(menuLabel), [
		'Cut', 'Copy', 'Duplicate', 'Delete', 'Bring to front', 'Send to back', 'Edit text', 'Connect', 'Group items', 'Ungroup', 'Lock', 'Unlock',
		'Unlock all locked by ', 'Unlock all in this frame', 'Zoom to selection',
		'Paste here', 'Add note here', 'Select all', 'Show everything', 'Show grid', 'Snap to grid', 'Unlock all',
	], 'unlock-by without a name (map passes no env)')
	assert.equal(menuName('01JA0000000000000000000001'), 'Selection actions')
	assert.equal(menuName(null), 'Board actions')
	const bar = readFileSync(new URL('../../../src/components/ContextBar.vue', import.meta.url), 'utf8')
	for (const text of ['Cut', 'Copy', 'Duplicate', 'Delete', 'Bring to front', 'Send to back', 'Connect']) {
		assert.ok(bar.includes(`t('knorke', '${text}')`), 'the bar uses the same text: ' + text)
	}
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
	for (const none of ['front', 'back', 'connect', 'note-here']) {
		assert.equal(menuShortcut(none, false), null, none)
		assert.equal(menuShortcut(none, true), null, none)
	}
	for (const name of MENU_ITEMS) {
		const s = menuShortcut(name, false)
		if (s) {
			assert.match(s.aria, /^(?:(?:Control|Meta)\+)?(?:Shift\+)?(?:[A-Z0-9]|Delete|Backspace|Enter)$/, 'WAI-ARIA key names: ' + name)
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
	const html = strip(await render(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, canPaste: false, apple: false }))
	const root = /^<div[^>]*>/.exec(html)[0]
	assert.match(root, /class="knorke-contextmenu"/)
	assert.match(root, /role="menu"/)
	assert.match(root, /aria-label="Selection actions"/)
	assert.match(root, /data-knorke-menu="context"/)
	assert.match(root, /data-knorke-menu-target="01JA0000000000000000000001"/)
	assert.match(root, /data-knorke-menu-at="10,21"/)
	const buttons = html.match(/<button[^>]*>/g)
	assert.deepEqual(buttons.map((b) => /data-knorke-menu-item="([^"]+)"/.exec(b)[1]), [...ON_ITEMS, 'edit-text', 'zoom-selection'])
	for (const [i, b] of buttons.entries()) {
		assert.match(b, /type="button"/)
		assert.match(b, /role="menuitem"/)
		assert.match(b, new RegExp(`tabindex="${i === 0 ? 0 : -1}"`), 'roving tabindex: the first entry is the tab stop')
		assert.doesNotMatch(b, /data-knorke-action/)
	}
	assert.match(buttons[0], /aria-keyshortcuts="Control\+X"/)
	assert.doesNotMatch(buttons[4], /aria-keyshortcuts/, 'front: no shortcut, no attribute')
	assert.match(html, /<span class="knorke-contextmenu__key" aria-hidden="true">Ctrl\+X<\/span>/, 'the hint is visible and hidden from assistive technology')
	assert.match(html, />Bring to front</)
	// empty canvas, Apple, secure context
	const board = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3 }, selection: sel([]), host: null, canPaste: true, apple: true }))
	assert.match(board, /data-knorke-menu-target(?:="")?[ >]/, 'empty target (SSR writes the empty value without quotes; the DOM attribute is "")')
	assert.match(board, /aria-label="Board actions"/)
	assert.deepEqual((board.match(/data-knorke-menu-item="([^"]+)"/g) ?? []).map((x) => x.split('"')[1]), ['paste-here', 'note-here', 'select-all', 'fit'])
	assert.match(board, /data-knorke-menu-item="paste-here"[^>]*>|aria-keyshortcuts="Meta\+V"[^>]*data-knorke-menu-item="paste-here"/)
	assert.match(board, /aria-keyshortcuts="Meta\+V"/)
	assert.match(board, /aria-hidden="true">⌘V</)
	// http dev stack: no paste-here
	const http = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 3, items: 3 }, selection: sel([]), host: null, canPaste: false, apple: false }))
	assert.doesNotMatch(http, /paste-here/)
})

test('ContextMenu.vue count line: the board menu shows "<n> items on this board" after the last entry (aria-hidden, named by the root\'s aria-describedby); the entries stay; no line on items or without a count', async () => {
	const boardMenu = async (items) => strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items }, selection: sel([]), host: null, canPaste: true, apple: false }))
	const html = await boardMenu(3)
	const root = /^<div[^>]*>/.exec(html)[0]
	assert.match(root, /aria-describedby="knorke-contextmenu-count"/)
	assert.equal((html.match(/data-knorke-menu-count=/g) ?? []).length, 1, 'exactly one count line')
	const line = /<(\w+)([^>]*data-knorke-menu-count="3"[^>]*)>([^<]*)<\/\1>/.exec(html)
	assert.ok(line, 'the line with data-knorke-menu-count="3"')
	assert.equal(line[1], 'div', 'no button')
	assert.match(line[2], /class="knorke-contextmenu__count"/)
	assert.match(line[2], /id="knorke-contextmenu-count"/)
	assert.match(line[2], /aria-hidden="true"/)
	assert.doesNotMatch(line[2], /tabindex|role=/, 'no tab stop, no role')
	assert.equal(line[3], '3 items on this board')
	assert.ok(html.indexOf('data-knorke-menu-count') > html.lastIndexOf('</button>'), 'behind the last entry')
	const buttons = html.match(/<button[^>]*>/g)
	assert.deepEqual(buttons.map((b) => /data-knorke-menu-item="([^"]+)"/.exec(b)[1]), ['paste-here', 'note-here', 'select-all', 'fit'], 'the entries are unchanged')
	assert.match(buttons[0], /tabindex="0"/, 'the first entry keeps the tab stop')
	for (const b of buttons.slice(1)) {
		assert.match(b, /tabindex="-1"/)
	}
	// an empty board: "0 items", no select-all
	const empty = await boardMenu(0)
	assert.match(empty, /data-knorke-menu-count="0"[^>]*>0 items on this board<\/div>/)
	assert.doesNotMatch(empty, /select-all/)
	assert.match(empty, /aria-describedby="knorke-contextmenu-count"/)
	// the menu on items, and a board menu without items: no line, no aria-describedby
	const onItems = strip(await render(ContextMenu, { menu: { id: '01JA0000000000000000000001', at: [0, 0], seq: 4, items: 3 }, selection: sel(['sticky']), host: null, canPaste: true, apple: false }))
	const noItems = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 5 }, selection: sel([]), host: null, canPaste: true, apple: false }))
	for (const [what, x] of [['on items', onItems], ['without items', noItems]]) {
		assert.doesNotMatch(x, /data-knorke-menu-count/, what)
		assert.doesNotMatch(x, /aria-describedby/, what)
		assert.doesNotMatch(x, /knorke-contextmenu__count/, what)
	}
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
	const { bindings, emitted } = setupOf(ContextMenu, { menu: MENU, selection: sel(['sticky']), host: null, canPaste: false, apple: false })
	assert.equal(bindings.active.value, 0)
	let k = key('ArrowDown')
	bindings.onKey(k.e)
	assert.equal(bindings.active.value, 1)
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
	bindings.onKey(key('ArrowUp').e)
	bindings.onKey(key('ArrowUp').e)
	assert.equal(bindings.active.value, 7, 'wrapped to the last of 8')
	bindings.onKey(key('Home').e)
	assert.equal(bindings.active.value, 0)
	bindings.onKey(key('End').e)
	assert.equal(bindings.active.value, 7)
	k = key('Enter')
	bindings.onKey(k.e)
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'], 'no native click on top: activated once')
	assert.deepEqual(emitted.map((x) => x.slice(0, 2)), [['action', 'zoom-selection']])
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
	// a click emits the entry with its event (the board runs it synchronously: "Paste here" reads in the click)
	const ev = { type: 'click' }
	bindings.activate('copy', ev)
	assert.deepEqual(emitted.at(-1), ['action', 'copy', ev])
})

test('ContextMenu.vue keyboard with the count line: the line is never an entry – 4 entries, ↑ on the first wraps to fit, ↓ on fit wraps to the first', () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3 }, selection: sel([]), host: null, canPaste: true, apple: false })
	assert.equal(bindings.count.value, '3 items on this board', 'the line is shown')
	assert.equal(bindings.items.value.length, 4)
	assert.deepEqual(bindings.items.value.map((e) => e.name), ['paste-here', 'note-here', 'select-all', 'fit'])
	assert.equal(bindings.active.value, 0)
	bindings.onKey(key('ArrowUp').e)
	assert.equal(bindings.active.value, 3)
	assert.equal(bindings.items.value[bindings.active.value].name, 'fit')
	bindings.onKey(key('ArrowDown').e)
	assert.equal(bindings.active.value, 0, 'wrapped past the line to the first entry')
	bindings.onKey(key('End').e)
	assert.equal(bindings.active.value, 3, 'End: the last entry, not the line')
	bindings.onKey(key('Enter').e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'fit'])
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
		assert.equal(items.length, 8)
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

const BOARD = { id: null, at: [0, 0], seq: 2, items: 3 }

test('ContextMenu.vue count line (UX B1): a mousedown on the line is prevented, so the active entry keeps the focus and Esc/arrows still reach the menu; on an entry nothing is prevented; the menu stays open', async () => {
	const { bindings, emitted } = setupOf(ContextMenu, { menu: BOARD, selection: sel([]), host: null, canPaste: true, apple: false })
	const node = (attrs, parentNode = null) => ({ attrs, parentNode, closest: FakeNode.prototype.closest })
	const root = node({ role: 'menu' })
	const line = node({ 'data-knorke-menu-count': 3 }, root)
	const entry = node({ 'data-knorke-menu-item': 'fit' }, root)
	const label = node({ class: 'knorke-contextmenu__label' }, entry)
	const press = (target) => {
		const calls = []
		bindings.onRootDown({ target, preventDefault: () => calls.push('preventDefault') })
		return calls
	}
	assert.deepEqual(press(line), ['preventDefault'], 'the line: the focus stays where it is')
	for (const [what, target] of [['entry', entry], ['label inside an entry', label], ['no target', null]]) {
		assert.deepEqual(press(target), [], what + ': default action as before')
	}
	bindings.root.value = { contains: (n) => [root, line, entry, label].includes(n) }
	bindings.onDown({ target: line })
	assert.deepEqual(emitted, [], 'a press on the line keeps the menu open')
	bindings.onKey(key('ArrowUp').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'fit', 'the arrows still work')
	bindings.onKey(key('Escape').e)
	assert.deepEqual(emitted.at(-1), ['close', 'esc'], 'and Esc closes it')
	// mounted: the compiled template binds it on the root, and the real line matches
	const m = await mountMenu(BOARD)
	try {
		const r = m.root()
		const real = r.children.find((n) => n.attrs['data-knorke-menu-count'] !== undefined)
		assert.ok(real, 'the count line is rendered')
		assert.equal(r.children.at(-1), real, 'after the entries')
		assert.equal(typeof r.on.onMousedown, 'function', 'the root handles mousedown')
		assert.equal(real.on.onMousedown, undefined, 'the line itself has no handler')
		const calls = []
		r.on.onMousedown({ target: real, preventDefault: () => calls.push('line') })
		r.on.onMousedown({ target: m.items().at(-1), preventDefault: () => calls.push('entry') })
		assert.deepEqual(calls, ['line'])
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
		line: node({ 'data-knorke-menu-count': 3 }, root),
		entry,
		label: node({ class: 'knorke-contextmenu__label' }, entry),
	}
}

test('ContextMenu.vue padding (UX B2): a mousedown on the root itself (padding, gap above the count line, border) is prevented in both menus while they have nothing to scroll, so the active entry keeps the focus, the menu stays open and Esc/arrows still reach it; not on an entry, a menu that can scroll, without target or root', () => {
	for (const [what, props, last] of [
		['board menu', { menu: BOARD, selection: sel([]), host: null, canPaste: true, apple: false }, 'fit'],
		['menu on items', { menu: MENU, selection: sel(['sticky']), host: null, canPaste: false, apple: false }, 'zoom-selection'],
	]) {
		const { bindings, emitted } = setupOf(ContextMenu, props)
		const { root, line, entry, label } = fakeMenu()
		bindings.root.value = root
		assert.equal(bindings.root.value, root, what + ': the ref keeps the fake root as it is')
		const press = (target) => {
			const calls = []
			bindings.onRootDown({ target, preventDefault: () => calls.push('preventDefault') })
			return calls
		}
		assert.deepEqual(press(root), ['preventDefault'], what + ': the root (nothing to scroll): the focus stays where it is')
		if (bindings.count.value !== null) {
			assert.deepEqual(press(line), ['preventDefault'], what + ': the count line as before')
		}
		for (const [where, target] of [['entry', entry], ['label inside an entry', label], ['no target', null]]) {
			assert.deepEqual(press(target), [], what + ', ' + where + ': default action as before')
		}
		assert.doesNotThrow(() => bindings.onRootDown(undefined), what + ': no event')
		// a menu that can scroll (a very low window): the root, its scrollbar included, behaves as before
		Object.assign(root, { scrollHeight: 300, clientHeight: 266 })
		assert.deepEqual(press(root), [], what + ': the root of a menu that can scroll')
		if (bindings.count.value !== null) {
			assert.deepEqual(press(line), ['preventDefault'], what + ': the count line still')
		}
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

test('ContextMenu.vue padding (UX B2) mounted: the compiled template\'s root handler prevents a press on the root of both menus while nothing scrolls, not when it can scroll, never on an entry; no new listener, no handler on the count line', async () => {
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
			const line = r.children.find((n) => n.attrs['data-knorke-menu-count'] !== undefined)
			if (state === BOARD) {
				assert.ok(line, 'the board menu has its count line')
				assert.equal(line.on.onMousedown, undefined, 'the line itself has no handler')
			} else {
				assert.equal(line, undefined, 'no count line on items')
			}
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
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: false }), ['note-here', 'select-all', 'fit', 'grid'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: true }), ['paste-here', 'note-here', 'select-all', 'fit', 'grid'])
	assert.deepEqual(menuEntries(null, undefined, { items: 0, grid: false }), ['note-here', 'fit', 'grid'])
	assert.ok(!menuEntries(sel(['sticky']), 'id0', { grid: true }).includes('grid'), 'not on items')
	assert.ok(!menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'id1', { grid: false }).includes('grid'))
	for (const g of [undefined, null, 'true', 1]) {
		assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: g }), ['paste-here', 'note-here', 'select-all', 'fit'], String(g))
	}
	assert.deepEqual(menuEntries(sel([]), null), ['note-here', 'select-all', 'fit'])
})

test('grid entry (AK10 b): third from last of MENU_ITEMS (job 062: unlock-all last), label "Show grid", the single key G on every platform', () => {
	assert.equal(MENU_ITEMS.at(-3), 'grid')
	assert.equal(menuLabel('grid'), 'Show grid')
	assert.deepEqual(menuShortcut('grid', false), { hint: 'G', aria: 'G' })
	assert.deepEqual(menuShortcut('grid', true), { hint: 'G', aria: 'G' })
})

test('ContextMenu.vue grid (AK10 c): the board menu with grid on – a menuitemcheckbox, aria-checked true, the check mark in its column; every other entry a menuitem with an empty column', async () => {
	const board = async (grid) => strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, grid }, selection: sel([]), host: null, canPaste: true, apple: false }))
	const buttonsOf = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2], name: /data-knorke-menu-item="([^"]+)"/.exec(m[1])[1] }))
	const on = buttonsOf(await board(true))
	assert.deepEqual(on.map((b) => b.name), ['paste-here', 'note-here', 'select-all', 'fit', 'grid'])
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
	assert.match(col[1], /width="16"/)
	assert.match(col[1], /height="16"/)
	assert.match(col[1], /focusable="false"/)
	assert.match(col[1], /<path d="M21,7L9,19L3\.5,13\.5L4\.91,12\.09L9,16\.17L19\.59,5\.59L21,7Z" fill="currentColor"/)
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
	assert.deepEqual(bindings.items.value.map((e) => [e.name, e.checked]), [['note-here', null], ['select-all', null], ['fit', null], ['grid', false]])
	assert.equal(bindings.checkColumn.value, true)
	bindings.onKey(key('End').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'grid')
	const k = key('Enter')
	bindings.onKey(k.e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'grid'])
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
	assert.equal(bindings.count.value, '3 items on this board')
})

// ---- M2 (SPEC-M1 §1.2 (R12), job 019): "Snap to grid" in the board menu (AK6, AK7) ----------

test('menuEntries (019 AK6 a–c): grid-snap last after grid, only with the grid on and env.gridSnap a boolean; never on items', () => {
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: true }), ['note-here', 'select-all', 'fit', 'grid', 'grid-snap'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: false }), ['note-here', 'select-all', 'fit', 'grid', 'grid-snap'], 'the same list when off')
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 0, grid: true, gridSnap: false }), ['paste-here', 'note-here', 'fit', 'grid', 'grid-snap'])
	// (b) only grid: the grid hidden, or gridSnap no boolean
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: false, gridSnap: true }), ['note-here', 'select-all', 'fit', 'grid'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: false, gridSnap: false }), ['note-here', 'select-all', 'fit', 'grid'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: true }), ['note-here', 'select-all', 'fit', 'grid'])
	for (const v of ['true', 1, null]) {
		assert.deepEqual(menuEntries(null, null, { items: 3, grid: true, gridSnap: v }), ['note-here', 'select-all', 'fit', 'grid'], String(v))
	}
	// no grid state: neither entry, whatever gridSnap says
	assert.deepEqual(menuEntries(null, null, { items: 3, gridSnap: true }), ['note-here', 'select-all', 'fit'])
	assert.deepEqual(menuEntries(null, null, { items: 3, grid: 'true', gridSnap: true }), ['note-here', 'select-all', 'fit'])
	// (c) never on items
	const onItems = menuEntries(sel(['sticky']), 'id0', { grid: true, gridSnap: true })
	assert.ok(!onItems.includes('grid'), 'no grid on items')
	assert.ok(!onItems.includes('grid-snap'), 'no grid-snap on items')
	assert.ok(!menuEntries(sel(['sticky', 'sticky'], { canConnect: true }), 'id1', { grid: true, gridSnap: false }).includes('grid-snap'))
})

test('grid-snap entry (019 AK6 d, e): second from last of MENU_ITEMS, after grid (job 062: unlock-all last), label "Snap to grid", no shortcut on any platform', () => {
	assert.equal(MENU_ITEMS.length, 22)
	assert.equal(MENU_ITEMS.at(-2), 'grid-snap')
	assert.equal(MENU_ITEMS.at(-3), 'grid')
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
	assert.deepEqual(bindings.items.value.map((e) => [e.name, e.checked]), [['note-here', null], ['select-all', null], ['fit', null], ['grid', true], ['grid-snap', false]])
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
	assert.equal(bindings.count.value, '3 items on this board')
})

// ---- Job 023 (M2, SPEC-M1 §1.2 "(R20) Sperren"): lock and unlock ---------------

/**
 * @param {string[]} types types of the UNLOCKED selected items
 * @param {object} lock lock fields of selection v2 (count, locked, unlocked, lockable, unlockable, lockedBy, unlockBy)
 * @return {object} selection v2 with locks
 */
const lockSel = (types, lock) => sel(types, { lockedBy: null, unlockBy: null, ...lock })

test('job 023 (AK9): MENU_ITEMS has lock and unlock after connect; labels, the unlock label names the locker', () => {
	assert.deepEqual(MENU_ITEMS, ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'edit-text', 'connect', 'group', 'ungroup', 'lock', 'unlock',
		'unlock-by', 'unlock-frame', 'zoom-selection', 'paste-here', 'note-here', 'select-all', 'fit', 'grid', 'grid-snap', 'unlock-all'],
	'job 044: unlock-frame and unlock-all; job 062: unlock-by, unlock-all last')
	assert.equal(menuLabel('lock'), 'Lock')
	assert.equal(menuLabel('unlock'), 'Unlock')
	assert.equal(menuLabel('unlock', { unlockBy: { kind: 'name', name: 'Alice' } }), 'Unlock (locked by Alice)')
	assert.deepEqual(menuShortcut('lock', true), { hint: '⌘⇧L', aria: 'Meta+Shift+L' })
	assert.deepEqual(menuShortcut('lock', false), { hint: 'Ctrl+Shift+L', aria: 'Control+Shift+L' })
	assert.deepEqual(menuShortcut('unlock', true), { hint: '⌘⇧L', aria: 'Meta+Shift+L' })
	assert.deepEqual(menuShortcut('unlock', false), { hint: 'Ctrl+Shift+L', aria: 'Control+Shift+L' })
})

test('job 023 (AK9): menuEntries – a fully, foreign locked selection: copy and zoom; with mod also unlock; mixed: the editing entries, lock, unlock if allowed; no edit-text on one locked note', () => {
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 0, lockedBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(foreign, 'id0'), ['copy', 'zoom-selection'], 'one locked note: no edit-text either')
	const withMod = { ...foreign, unlockable: 1, unlockBy: { kind: 'name', name: 'Bob' } }
	assert.deepEqual(menuEntries(withMod, 'id0'), ['copy', 'unlock', 'zoom-selection'])
	const mixed = lockSel(['sticky'], { count: 2, locked: 1, unlocked: 1, lockable: 1, unlockable: 0, canConnect: true })
	assert.deepEqual(menuEntries(mixed, 'id0'), ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'connect', 'lock', 'zoom-selection'], 'no edit-text: two selected')
	assert.deepEqual(menuEntries({ ...mixed, unlockable: 1 }, 'id0'), ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'connect', 'lock', 'unlock', 'zoom-selection'])
	const free = lockSel(['sticky'], { count: 1, locked: 0, unlocked: 1, lockable: 1, unlockable: 0 })
	assert.deepEqual(menuEntries(free, 'id0'), ['cut', 'copy', 'duplicate', 'delete', 'front', 'back', 'edit-text', 'lock', 'zoom-selection'])
	const viewOnly = lockSel(['sticky'], { count: 1, locked: 0, unlocked: 1, lockable: 0, unlockable: 0 })
	assert.ok(!menuEntries(viewOnly, 'id0').includes('lock'), 'lockable 0 while the session cannot write')
	assert.deepEqual(menuEntries(null, null), ['note-here', 'select-all', 'fit'], 'never on the empty canvas')
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
	assert.deepEqual([...html.matchAll(/data-knorke-menu-item="([a-z-]+)"/g)].map((m) => m[1]), ['copy', 'unlock', 'zoom-selection'])
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
	assert.deepEqual(MENU_ITEMS.slice(MENU_ITEMS.indexOf('connect'), MENU_ITEMS.indexOf('zoom-selection') + 1), ['connect', 'group', 'ungroup', 'lock', 'unlock', 'unlock-by', 'unlock-frame', 'zoom-selection'], 'job 044: unlock-frame after unlock; job 062: unlock-by between them')
	const two = sel(['sticky', 'sticky'], { groupable: 2, groupBlock: null, grouped: 0, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(menuEntries(two, 'id0'), [...ON_ITEMS, 'group', 'zoom-selection'])
	const one = sel(['sticky', 'sticky'], { groupable: 2, groupBlock: null, grouped: 1, ungroupBlock: null, oneGroup: true })
	assert.deepEqual(menuEntries(one, 'id0'), [...ON_ITEMS, 'ungroup', 'zoom-selection'], 'exactly one group: only ungroup')
	const mixed = sel(['sticky', 'sticky', 'sticky'], { groupable: 3, groupBlock: 'parent', grouped: 1, ungroupBlock: null, oneGroup: false })
	assert.deepEqual(menuEntries(mixed, 'id0'), [...ON_ITEMS, 'group', 'ungroup', 'zoom-selection'], 'a blocked entry stays (aria-disabled)')
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

test('job 044 (AK1): MENU_ITEMS has unlock-frame after unlock (job 062: after unlock-by) and unlock-all last (job 062); menuEntries only with a whole count > 0; unlock-all never on items; labels; no shortcut, never blocked', () => {
	assert.equal(MENU_ITEMS.length, 22)
	assert.deepEqual(MENU_ITEMS.slice(MENU_ITEMS.indexOf('unlock'), MENU_ITEMS.indexOf('unlock') + 4), ['unlock', 'unlock-by', 'unlock-frame', 'zoom-selection'])
	assert.deepEqual(MENU_ITEMS.slice(-4), ['fit', 'grid', 'grid-snap', 'unlock-all'])
	// the board menu (job 062: the mass unlocks last)
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockAll: 2 }), ['note-here', 'select-all', 'fit', 'unlock-all'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, unlockAll: 1, grid: true, gridSnap: false }),
		['paste-here', 'note-here', 'select-all', 'fit', 'grid', 'grid-snap', 'unlock-all'])
	assert.deepEqual(menuEntries(null, null, { items: 0, unlockAll: 1 }), ['note-here', 'fit', 'unlock-all'], 'without select-all')
	for (const bad of [0, -1, 1.5, '2', null, NaN, Infinity]) {
		assert.deepEqual(menuEntries(null, null, { items: 3, unlockAll: bad }), ['note-here', 'select-all', 'fit'], 'unlockAll ' + String(bad))
		assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: true, gridSnap: true, unlockAll: bad }),
			['paste-here', 'note-here', 'select-all', 'fit', 'grid', 'grid-snap'], 'unlockAll ' + String(bad) + ' with grid')
	}
	assert.deepEqual(menuEntries(null, null, { items: 3 }), ['note-here', 'select-all', 'fit'], 'without the key')
	// the menu on items
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Bob' }, unlockBy: { kind: 'name', name: 'Bob' } })
	assert.deepEqual(menuEntries(foreign, 'id0', { unlockFrame: 3 }), ['copy', 'unlock', 'unlock-frame', 'zoom-selection'])
	const free = lockSel(['frame'], { count: 1, locked: 0, unlocked: 1, lockable: 1, unlockable: 0 })
	const list = menuEntries(free, 'id0', { unlockFrame: 2 })
	assert.equal(list[list.indexOf('zoom-selection') - 1], 'unlock-frame', 'directly before zoom-selection: ' + list)
	assert.deepEqual(list.filter((e) => e !== 'unlock-frame'), menuEntries(free, 'id0'), 'the rest as before')
	for (const bad of [0, -2, 0.5, '1', undefined]) {
		assert.deepEqual(menuEntries(foreign, 'id0', { unlockFrame: bad }), ['copy', 'unlock', 'zoom-selection'], 'unlockFrame ' + String(bad))
	}
	// unlock-all only in the board menu; unlock-frame in both (job 062)
	const both = { items: 3, unlockAll: 5, unlockFrame: 5 }
	assert.ok(!menuEntries(foreign, 'id0', both).includes('unlock-all'), 'unlock-all never on items')
	assert.deepEqual(menuEntries(null, null, both), ['note-here', 'select-all', 'fit', 'unlock-frame', 'unlock-all'], 'job 062: the frame under the point, too')
	assert.equal(menuLabel('unlock-all'), 'Unlock all')
	assert.equal(menuLabel('unlock-frame'), 'Unlock all in this frame')
	for (const name of ['unlock-all', 'unlock-frame']) {
		assert.equal(menuShortcut(name, true), null, name)
		assert.equal(menuShortcut(name, false), null, name)
		assert.equal(menuBlocked(name, { groupBlock: 'frame', ungroupBlock: 'locked' }), null, name)
	}
})

const buttonsOf = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], inner: m[2], name: /data-knorke-menu-item="([^"]+)"/.exec(m[1])[1] }))

test('job 044 (AK2): ContextMenu.vue – the board menu with menu.unlockAll 2 renders "Unlock all" last (job 062; a menuitem, no aria-keyshortcuts, no title), the count line after it; End and Enter emit unlock-all; with 0 no button; a frame menu with menu.unlockFrame 1 renders "Unlock all in this frame"', async () => {
	const boardHtml = async (menu) => strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, ...menu }, selection: sel([]), host: null, canPaste: false, apple: false }))
	const html = await boardHtml({ unlockAll: 2 })
	const buttons = buttonsOf(html)
	assert.deepEqual(buttons.map((b) => b.name), ['note-here', 'select-all', 'fit', 'unlock-all'])
	const u = buttons[3]
	assert.match(u.attrs, /type="button"/)
	assert.match(u.attrs, /role="menuitem"/)
	assert.match(u.attrs, /tabindex="-1"/)
	assert.doesNotMatch(u.attrs, /aria-keyshortcuts|title=|aria-disabled|aria-checked/)
	assert.match(u.inner, /<span class="knorke-contextmenu__label">Unlock all<\/span>/)
	assert.doesNotMatch(u.inner, /knorke-contextmenu__key|knorke-contextmenu__check/)
	assert.ok(html.indexOf('data-knorke-menu-count') > html.lastIndexOf('</button>'), 'the count line stays after the last entry')
	assert.match(html, /data-knorke-menu-count="3"[^>]*>3 items on this board</)
	for (const none of [{ unlockAll: 0 }, {}]) {
		assert.doesNotMatch(await boardHtml(none), /unlock-all/, JSON.stringify(none))
	}
	// with the grid: the check column, as for every entry; unlock-all after grid-snap
	const grid = buttonsOf(await boardHtml({ unlockAll: 1, grid: true, gridSnap: true }))
	assert.deepEqual(grid.map((b) => b.name), ['note-here', 'select-all', 'fit', 'grid', 'grid-snap', 'unlock-all'])
	assert.match(grid[5].inner, /^<span class="knorke-contextmenu__check" aria-hidden="true"><\/span>/)
	// keyboard: Enter on the focused entry
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, unlockAll: 2 }, selection: sel([]), host: null, canPaste: false, apple: false })
	assert.deepEqual(bindings.items.value.map((e) => e.name), ['note-here', 'select-all', 'fit', 'unlock-all'])
	bindings.onKey(key('End').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'unlock-all')
	const k = key('Enter')
	bindings.onKey(k.e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'unlock-all'])
	assert.deepEqual(k.calls, ['preventDefault', 'stopPropagation'])
	assert.equal(bindings.count.value, '3 items on this board')
	// a frame: the frame menu
	const frameSel = lockSel(['frame'], { count: 1, locked: 0, unlocked: 1, lockable: 1, unlockable: 0 })
	const fh = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockFrame: 1 }, selection: frameSel, host: null, canPaste: false, apple: false }))
	const fb = buttonsOf(fh)
	const f = fb.find((b) => b.name === 'unlock-frame')
	assert.ok(f, 'the entry is there')
	assert.equal(fb[fb.indexOf(f) + 1].name, 'zoom-selection')
	assert.match(f.attrs, /role="menuitem"/)
	assert.doesNotMatch(f.attrs, /aria-keyshortcuts|title=/)
	assert.match(f.inner, /<span class="knorke-contextmenu__label">Unlock all in this frame<\/span>/)
	const noFrame = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockFrame: 0, unlockAll: 4 }, selection: frameSel, host: null, canPaste: false, apple: false }))
	assert.doesNotMatch(noFrame, /unlock-frame|unlock-all/, 'unlockFrame 0; unlockAll never on items')
})

test('job 044 (AK2) mounted: the compiled template renders the board menu with "Unlock all" last (job 062), focus on the first entry, the count line after it', async () => {
	const m = await mountMenu({ ...BOARD, unlockAll: 2 })
	try {
		const names = m.items().map((n) => n.attrs['data-knorke-menu-item'])
		assert.deepEqual(names, ['note-here', 'select-all', 'fit', 'unlock-all'])
		assert.equal(m.doc.activeElement, m.items()[0])
		const r = m.root()
		assert.notEqual(r.children.at(-1).attrs['data-knorke-menu-count'], undefined, 'the count line after the entries')
		assert.equal(m.items()[3].attrs['aria-keyshortcuts'], null, 'no aria-keyshortcuts')
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

test('job 062 (AK1): MENU_ITEMS has 22 entries, unlock-all last after fit, grid, grid-snap; unlock-by, unlock-frame, zoom-selection after unlock; menuEntries of both menus; labels; no shortcut, never blocked', () => {
	assert.equal(MENU_ITEMS.length, 22)
	assert.equal(MENU_ITEMS.at(-1), 'unlock-all')
	assert.deepEqual(MENU_ITEMS.slice(-4, -1), ['fit', 'grid', 'grid-snap'])
	const u = MENU_ITEMS.indexOf('unlock')
	assert.deepEqual(MENU_ITEMS.slice(u + 1, u + 4), ['unlock-by', 'unlock-frame', 'zoom-selection'])
	assert.equal(new Set(MENU_ITEMS).size, 22, 'unlock-frame once, though in both menus')
	// the board menu: the mass unlocks last, the rest as without locks
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockAll: 2 }), ['note-here', 'select-all', 'fit', 'unlock-all'])
	assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, unlockAll: 4, unlockFrame: 1, grid: true, gridSnap: false }),
		['paste-here', 'note-here', 'select-all', 'fit', 'grid', 'grid-snap', 'unlock-frame', 'unlock-all'])
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockFrame: 2 }), ['note-here', 'select-all', 'fit', 'unlock-frame'])
	const plain = menuEntries(null, null, { canPaste: true, items: 3, grid: true, gridSnap: true })
	for (const bad of [0, -1, 1.5, '2', undefined]) {
		assert.deepEqual(menuEntries(null, null, { canPaste: true, items: 3, grid: true, gridSnap: true, unlockFrame: bad, unlockAll: bad }), plain, 'unlockFrame/unlockAll ' + String(bad))
	}
	assert.deepEqual(menuEntries(null, null, { items: 3, unlockBy: 3, unlockByName: 'Carol' }), ['note-here', 'select-all', 'fit'], 'no unlock-by on the empty canvas')
	// the menu on items
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Carol' }, unlockBy: { kind: 'name', name: 'Carol' } })
	assert.deepEqual(menuEntries(foreign, 'id0', { unlockBy: 2, unlockByName: 'Carol', unlockFrame: 3 }), ['copy', 'unlock', 'unlock-by', 'unlock-frame', 'zoom-selection'])
	for (const env of [{ unlockBy: 0, unlockByName: 'Carol' }, { unlockBy: 2, unlockByName: '' }, { unlockBy: 2, unlockByName: null }, { unlockBy: 2 },
		{ unlockBy: 1.5, unlockByName: 'Carol' }, { unlockBy: '2', unlockByName: 'Carol' }, {}]) {
		assert.deepEqual(menuEntries(foreign, 'id0', env), ['copy', 'unlock', 'zoom-selection'], JSON.stringify(env))
	}
	assert.ok(!menuEntries(foreign, 'id0', { unlockAll: 5, unlockBy: 1, unlockByName: 'Carol' }).includes('unlock-all'), 'unlock-all never on items')
	// labels, shortcuts, blocked
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

test('job 062 (AK2): ContextMenu.vue – the board menu ends on "Unlock all in this frame", "Unlock all" (no title, no key), the count line after them, End + Enter emit unlock-all; on an item unlock-by right after unlock, its label as escaped text and as title, no key', async () => {
	const board = strip(await render(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, unlockAll: 2, unlockFrame: 1 }, selection: sel([]), host: null, canPaste: false, apple: false }))
	const bb = buttonsOf(board)
	assert.deepEqual(bb.map((b) => b.name), ['note-here', 'select-all', 'fit', 'unlock-frame', 'unlock-all'])
	assert.match(bb[3].inner, /<span class="knorke-contextmenu__label">Unlock all in this frame<\/span>/)
	assert.match(bb[4].inner, /<span class="knorke-contextmenu__label">Unlock all<\/span>/)
	for (const b of bb.slice(3)) {
		assert.match(b.attrs, /role="menuitem"/, b.name)
		assert.doesNotMatch(b.attrs, /title=|aria-keyshortcuts/, b.name)
	}
	assert.ok(board.indexOf('data-knorke-menu-count') > board.lastIndexOf('</button>'), 'the count line after the last entry')
	const { bindings, emitted } = setupOf(ContextMenu, { menu: { id: null, at: [0, 0], seq: 2, items: 3, unlockAll: 2, unlockFrame: 1 }, selection: sel([]), host: null, canPaste: false, apple: false })
	bindings.onKey(key('End').e)
	assert.equal(bindings.items.value[bindings.active.value].name, 'unlock-all')
	bindings.onKey(key('Enter').e)
	assert.deepEqual(emitted.at(-1).slice(0, 2), ['action', 'unlock-all'])
	// on an item someone else locked
	const foreign = lockSel([], { count: 1, locked: 1, unlocked: 0, lockable: 0, unlockable: 1, lockedBy: { kind: 'name', name: 'Carol <b>&' }, unlockBy: { kind: 'name', name: 'Carol <b>&' } })
	const html = strip(await render(ContextMenu, { menu: { id: 'id0', at: [0, 0], seq: 3, items: 3, unlockBy: 2, unlockByName: 'Carol <b>&' }, selection: foreign, host: null, canPaste: false, apple: false }))
	assert.match(html, /<button[^>]*role="menuitem"[^>]*data-knorke-menu-item="unlock-by"|<button[^>]*data-knorke-menu-item="unlock-by"[^>]*role="menuitem"/)
	const ib = buttonsOf(html)
	assert.deepEqual(ib.map((b) => b.name), ['copy', 'unlock', 'unlock-by', 'zoom-selection'], 'directly after unlock')
	const by = ib[2]
	assert.match(by.inner, /<span class="knorke-contextmenu__label">Unlock all locked by Carol &lt;b&gt;&amp;<\/span>/)
	assert.match(by.attrs, /title="Unlock all locked by Carol &lt;b&gt;&amp;"/)
	assert.doesNotMatch(by.attrs, /aria-keyshortcuts/)
	assert.doesNotMatch(by.inner, /knorke-contextmenu__key/)
	assert.doesNotMatch(html, /<b>/, 'never HTML')
})

test('job 062 (AK2) mounted: the board menu ends on unlock-frame, unlock-all with the count line after them; on an item unlock-by follows unlock with its label as text and title, no aria-keyshortcuts', async () => {
	const m = await mountMenu({ ...BOARD, unlockAll: 2, unlockFrame: 1 })
	try {
		assert.deepEqual(m.items().map((n) => n.attrs['data-knorke-menu-item']), ['note-here', 'select-all', 'fit', 'unlock-frame', 'unlock-all'])
		assert.equal(m.doc.activeElement, m.items()[0])
		assert.notEqual(m.root().children.at(-1).attrs['data-knorke-menu-count'], undefined, 'the count line after the entries')
		for (const n of m.items().slice(3)) {
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
		assert.deepEqual(items.map((n) => n.attrs['data-knorke-menu-item']), ['copy', 'unlock', 'unlock-by', 'zoom-selection'])
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
