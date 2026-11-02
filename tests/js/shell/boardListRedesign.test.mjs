/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 232 (redesign board list): the cards, the switch "Grid /
 * List", the empty states, the phone's sheet (views/BoardList.vue,
 * components/BoardActionsSheet.vue), the template grid of "New board", the
 * empty board and "Insert template" (components/TemplateGrid.vue), and the
 * helpers of components/boardList.js (view, start template, long press).
 */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TEMPLATE_KEYS } from '../../../src/board/templates.js'
import { n, t } from '../../../src/util/l10n.js'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
// @nextcloud/router needs a web root outside a browser (board-list hrefs)
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const { LONG_PRESS_MS, VIEWS, VIEW_KEY, createLongPress, readView, startPick, startWith, takeStart, writeView } = await import('../../../src/components/boardList.js')
const BoardList = (await import('../../../src/views/BoardList.vue')).default
const BoardActionsSheet = (await import('../../../src/components/BoardActionsSheet.vue')).default
const TemplateGrid = (await import('../../../src/components/TemplateGrid.vue')).default

const read = (f) => readFileSync(new URL('../../../' + f, import.meta.url), 'utf8')

/** A localStorage stand-in; `fail` makes every access throw (private window, blocked storage). */
function fakeStorage(fail = false) {
	const m = new Map()
	return {
		getItem: (k) => {
			if (fail) {
				throw new Error('SecurityError')
			}
			return m.has(k) ? m.get(k) : null
		},
		setItem: (k, v) => {
			if (fail) {
				throw new Error('QuotaExceededError')
			}
			m.set(k, String(v))
		},
		removeItem: (k) => m.delete(k),
		map: m,
	}
}

beforeEach(() => {
	globalThis.localStorage = fakeStorage()
})

const NOW = Date.now()
const BOARDS = [
	{ id: 1, title: 'Retro', role: 'owner', source: 'own', updatedAt: NOW, favorite: false },
	{ id: 2, title: 'Planung', role: 'edit', source: 'share', owner: { name: 'Bob' }, updatedAt: NOW, favorite: true },
]
const PROPS = { boards: BOARDS, loading: false, error: '', filter: 'all', favoriteBusy: [] }

/**
 * @param {object} props BoardList props
 * @param {boolean} [narrow] the phone layout
 * @return {Promise<string>} SSR HTML without comments
 */
async function render(props, narrow = false) {
	const comp = narrow
		? {
			...BoardList,
			setup(p, ctx) {
				const b = BoardList.setup(p, ctx)
				b.narrow.value = true
				return b
			},
		}
		: BoardList
	const app = createSSRApp(comp, { ...PROPS, ...props })
	return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

/** @param {string} html @param {number} id @return {string} the card's HTML */
const cardOf = (html, id) => html.match(new RegExp('<li [^>]*data-knorke-board="' + id + '"[\\s\\S]*?</li>'))?.[0] ?? ''

// ---- components/boardList.js ---------------------------------------------------------

test('job 232 AK4: the view is kept in this browser; missing, unknown or blocked storage means "grid"', () => {
	assert.deepEqual(VIEWS, ['grid', 'list'])
	assert.equal(readView(), 'grid', 'a fresh browser')
	assert.equal(writeView('list'), true)
	assert.equal(globalThis.localStorage.map.get(VIEW_KEY), 'list')
	assert.equal(VIEW_KEY, 'knorke.boardView')
	assert.equal(readView(), 'list')
	assert.equal(writeView('cards'), false, 'unknown views are not stored')
	globalThis.localStorage.map.set(VIEW_KEY, 'cards')
	assert.equal(readView(), 'grid')
	globalThis.localStorage = fakeStorage(true)
	assert.equal(readView(), 'grid', 'blocked storage')
	assert.equal(writeView('list'), false)
})

test('job 232 AK7: startPick turns a tile of "New board" into the template to insert; "Blank" and anything else is none', () => {
	assert.equal(startPick('blank'), null)
	assert.deepEqual(startPick('kanban'), { key: 'kanban' })
	assert.deepEqual(startPick('own:12'), { own: 12 })
	for (const bad of ['own:0', 'own:x', 'own:-1', 'Kanban', '', null, 7, 'own:99999999999999999999']) {
		assert.equal(startPick(bad), null, String(bad))
	}
})

test('job 232 AK7: startWith/takeStart hand the template to that board once; another board gets nothing', () => {
	startWith(41, { key: 'swot' })
	startWith(42, null)
	assert.equal(takeStart(40), null)
	assert.equal(takeStart(42), null, 'no pick, nothing kept')
	assert.deepEqual(takeStart(41), { key: 'swot' })
	assert.equal(takeStart(41), null, 'only once (a reload or a second visit inserts nothing)')
})

/** Fake timers for createLongPress. */
function fakeTimers() {
	let next = 1
	const timers = new Map()
	return {
		setTimeout: (fn, ms) => {
			timers.set(next, { fn, ms })
			return next++
		},
		clearTimeout: (id) => timers.delete(id),
		run() {
			for (const [id, { fn }] of [...timers]) {
				timers.delete(id)
				fn()
			}
		},
		size: () => timers.size,
		delays: () => [...timers.values()].map((x) => x.ms),
	}
}

test('job 232 AK6: a long press of a finger or pen fires after 500 ms and swallows the click after it once; a mouse, moving more than 10 px or lifting early does not', () => {
	const timers = fakeTimers()
	const fired = []
	const lp = createLongPress((b) => fired.push(b), { timers })
	const at = (pointerType, x = 0, y = 0) => ({ pointerType, clientX: x, clientY: y })

	lp.down(at('mouse'), 'A')
	assert.equal(timers.size(), 0, 'a mouse never starts it')
	lp.down(at('touch', 10, 10), 'A')
	assert.deepEqual(timers.delays(), [LONG_PRESS_MS])
	assert.equal(LONG_PRESS_MS, 500)
	timers.run()
	assert.deepEqual(fired, ['A'])
	lp.up()
	assert.equal(lp.takeFired(), true, 'the click after the press is swallowed')
	assert.equal(lp.takeFired(), false, 'once')

	lp.down(at('pen', 10, 10), 'B')
	lp.move(at('pen', 16, 17))
	assert.equal(timers.size(), 1, 'within 10 px it keeps waiting')
	lp.move(at('pen', 21, 10))
	assert.equal(timers.size(), 0, 'beyond 10 px it is a drag')
	lp.down(at('touch'), 'C')
	lp.up()
	assert.equal(timers.size(), 0, 'lifted early')
	lp.down(at('touch'), 'D')
	lp.cancel()
	timers.run()
	assert.deepEqual(fired, ['A'])

	// a press whose browser sent no click (Android's contextmenu): the next tap opens its board
	lp.down(at('touch'), 'E')
	timers.run()
	lp.down(at('touch'), 'F')
	lp.up()
	assert.equal(lp.takeFired(), false)
})

// ---- views/BoardList.vue: grid, list, switch, empty states ---------------------------------

test('job 232 AK1: the cards: picture, title and the time in the link; owner, origin and access of a board not of one\'s own in a second muted line; the star and the owner\'s "…" beside the link', async () => {
	const html = await render({})
	assert.match(html, /^<div class="knorke-list knorke-list--grid" data-knorke="board-list" data-knorke-view-mode="grid">/)
	const own = cardOf(html, 1)
	assert.match(own, /<a class="knorke-list__link" href="[^"]*\/apps\/knorke\/b\/1">/)
	assert.match(own, /<span class="knorke-list__title">Retro<\/span><span class="knorke-list__meta">[^<]+<\/span><\/span><\/a>/, 'title and time, no origin line for an own board')
	assert.match(own, /data-stub="NcButton"[^>]*data-knorke-action="favorite"[^>]*aria-pressed="false"/)
	assert.match(own, /<span class="knorke-list__actions"><div data-stub="NcActions"[^>]*force-menu[^>]*aria-label="Actions for Retro"/)
	assert.match(own, /data-knorke-action="rename"[\s\S]*data-knorke-action="delete"/)
	const shared = cardOf(html, 2)
	assert.match(shared, /<span class="knorke-list__meta knorke-list__origin">by Bob · Shared with you · Can edit<\/span>/)
	assert.doesNotMatch(shared, /knorke-list__actions|data-knorke-action="rename"/, 'not the owner: no "…"')
	assert.match(shared, /aria-pressed="true"[^>]*aria-label="Remove from favorites"/)
	assert.doesNotMatch(html, /knorke-list__starmark|hidden-visually/, 'the mark only on a phone')
	assert.doesNotMatch(html, /data-knorke-sheet/)
})

test('job 232 AK4: the switch "Grid / List" names both, presses the one in use and keeps the choice; the menu and the switch only with boards', async () => {
	const html = await render({})
	assert.match(html, /<div class="knorke-list__views" role="group" aria-label="View" data-knorke-view-switch>/)
	const sw = html.split('data-knorke-view-switch>')[1].split('<ul')[0]
	assert.deepEqual([...sw.matchAll(/data-knorke-view="([a-z]+)" aria-pressed="(true|false)" aria-label="([^"]+)"/g)].map((m) => m.slice(1)),
		[['grid', 'true', 'Grid'], ['list', 'false', 'List']])
	globalThis.localStorage.map.set(VIEW_KEY, 'list')
	const list = await render({})
	assert.match(list, /^<div class="knorke-list" data-knorke="board-list" data-knorke-view-mode="list">/)
	assert.match(list, /data-knorke-view="list" aria-pressed="true"/)
	const { bindings } = setupOf(BoardList, PROPS)
	assert.equal(bindings.view.value, 'list')
	bindings.pickView('grid')
	assert.equal(bindings.view.value, 'grid')
	assert.equal(globalThis.localStorage.map.get(VIEW_KEY), 'grid')
	bindings.pickView('bogus')
	assert.equal(bindings.view.value, 'grid')
	const none = await render({ boards: [] })
	assert.doesNotMatch(none, /data-knorke-view-switch|data-knorke-action="sort"/)
	assert.doesNotMatch(await render({ error: 'x' }), /data-knorke-view-switch/)
})

test('job 232 AK5: every filter has its empty state with its hook', async () => {
	const want = {
		all: ['No boards yet', 'Create your first board with “New board”.'],
		mine: ['No boards of your own yet', 'Create one with “New board”.'],
		favorites: ['No favorites yet', 'Mark a board with the star to find it here.'],
		shared: ['Nothing has been shared with you yet.', 'Boards that others share with you appear here.'],
	}
	for (const [filter, [name, description]] of Object.entries(want)) {
		const html = await render({ boards: [], filter })
		assert.match(html, new RegExp(`data-stub="NcEmptyContent" name="${name.replace(/\./g, '\\.')}" description="${description.replace(/\./g, '\\.')}" data-knorke-empty="${filter}"`), filter)
		assert.equal([...html.matchAll(/data-knorke-empty=/g)].length, 1, filter)
	}
	// own boards only shared with others: "Mine" says so, "All" lists them
	const shared = [BOARDS[1]]
	assert.match(await render({ boards: shared, filter: 'mine' }), /data-knorke-empty="mine"/)
})

// ---- views/BoardList.vue: the phone layout ------------------------------------------------

test('job 232 AK6: on a phone no "…" and no star button; a set star is a mark and the link says "Favorite"; the sort menu only as its icon, named', async () => {
	const html = await render({}, true)
	assert.match(html, /^<div class="knorke-list knorke-list--grid knorke-list--narrow"/)
	assert.doesNotMatch(html, /data-knorke-action="favorite"|knorke-list__actions|data-knorke-action="rename"/)
	const starred = cardOf(html, 2)
	assert.match(starred, /<span class="hidden-visually">Favorite<\/span><\/span><\/a><span class="knorke-list__starmark" aria-hidden="true">/)
	assert.doesNotMatch(cardOf(html, 1), /starmark|Favorite</)
	assert.match(html, /data-stub="NcActions" class="knorke-list__sort"[^>]*aria-label="Sort: Last modified"/)
	assert.doesNotMatch(html, /menu-name=/, 'only the icon')
	assert.match(await render({}), /menu-name="Sort: Last modified"/, 'the name beside the icon on wider screens')
})

/** A pointer or mouse event stand-in. */
function ev(extra = {}) {
	const e = { button: 0, defaultPrevented: false, prevented: 0, ...extra }
	e.preventDefault = () => {
		e.defaultPrevented = true
		e.prevented++
	}
	return e
}

test('job 232 AK6: on a phone the link\'s context menu (long press on Android, right-click) opens the sheet instead of the browser\'s menu; wider screens keep the browser\'s menu', () => {
	const { bindings, emitted } = setupOf(BoardList, PROPS)
	const wide = ev()
	bindings.onMenu(wide, BOARDS[0])
	assert.equal(wide.prevented, 0, 'the browser\'s menu ("Open in new tab")')
	assert.equal(bindings.sheetBoard.value, null)
	bindings.narrow.value = true
	const menu = ev()
	bindings.onMenu(menu, BOARDS[0])
	assert.equal(menu.prevented, 1)
	assert.equal(bindings.sheetBoard.value.id, 1)
	bindings.closeSheet()
	assert.equal(bindings.sheetBoard.value, null)
	assert.deepEqual(emitted, [], 'nothing opened')
})

test('job 232 AK6: a long press on a phone opens the sheet and the click after it does not open the board; a plain tap does', async () => {
	const { bindings, emitted } = setupOf(BoardList, PROPS)
	bindings.narrow.value = true
	const real = globalThis.setTimeout
	let pending = null
	globalThis.setTimeout = (fn) => {
		pending = fn
		return 1
	}
	try {
		bindings.onDown({ pointerType: 'touch', clientX: 5, clientY: 5 }, BOARDS[1])
	} finally {
		globalThis.setTimeout = real
	}
	assert.equal(typeof pending, 'function')
	pending()
	assert.equal(bindings.sheetBoard.value.id, 2, 'the sheet of the pressed card')
	const click = ev()
	bindings.open(click, 2)
	assert.equal(click.prevented, 1, 'the link is not followed')
	assert.deepEqual(emitted, [], 'the board does not open')
	bindings.sheetDo('favorite')
	assert.equal(bindings.sheetBoard.value, null, 'an entry closes the sheet')
	assert.deepEqual(emitted, [['favorite', 2]])
	bindings.onMenu(ev(), BOARDS[0])
	bindings.sheetDo('rename')
	bindings.onMenu(ev(), BOARDS[0])
	bindings.sheetDo('delete')
	assert.deepEqual(emitted.slice(1).map(([name, b]) => [name, b.id]), [['rename', 1], ['delete', 1]])
	bindings.open(ev(), 1)
	assert.deepEqual(emitted.at(-1), ['open', 1], 'a plain tap opens its board')
})

test('job 232 AK6: the sheet is a modal dialog named by the board, with the star for everyone and Rename and Delete for the owner, as native buttons; Esc closes, Tab stays inside', async () => {
	const sheetOf = async (board) => {
		const ctx = {}
		const app = createSSRApp(BoardActionsSheet, { board })
		app.config.globalProperties.t = t
		app.config.globalProperties.n = n
		await renderToString(app, ctx)
		return (ctx.teleports?.body ?? '').replace(/<!--[^>]*-->/g, '')
	}
	const own = await sheetOf(BOARDS[0])
	assert.match(own, /<div class="knorke-sheet__scrim"><\/div><div class="knorke-sheet" role="dialog" aria-modal="true" aria-labelledby="knorke-sheet-title-1" data-knorke-sheet="board-actions"><h3 id="knorke-sheet-title-1" class="knorke-sheet__title">\s*Retro\s*<\/h3>/)
	assert.deepEqual([...own.matchAll(/<button type="button" class="knorke-sheet__entry[^"]*" data-knorke-action="([a-z]+)">[\s\S]*?([A-Z][a-z ]+)\s*<\/button>/g)].map((m) => [m[1], m[2].trim()]),
		[['favorite', 'Add to favorites'], ['rename', 'Rename'], ['delete', 'Delete']])
	assert.match(own, /class="knorke-sheet__entry knorke-sheet__entry--danger" data-knorke-action="delete"/)
	const other = await sheetOf(BOARDS[1])
	assert.deepEqual([...other.matchAll(/data-knorke-action="([a-z]+)"/g)].map((m) => m[1]), ['favorite'])
	assert.match(other, /Remove from favorites/)
	const { bindings, emitted } = setupOf(BoardActionsSheet, { board: BOARDS[0] })
	const esc = { key: 'Escape', preventDefault() { this.p = true }, stopPropagation() { this.s = true } }
	bindings.onKey(esc)
	assert.deepEqual(emitted, [['close']])
	assert.ok(esc.p && esc.s)
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	assert.match(/\nbutton\.knorke-sheet__entry \{([^}]*)\}/.exec(css)?.[1] ?? '', /min-height: var\(--knorke-touch\) !important;/, 'entries ≥ 44 px')})

test('job 232 AK6 (risk: a long press on Android): the click that ends the press lands on the scrim or an entry and does nothing; a keyboard click always counts, a pointer click after a pointer went down in the sheet', () => {
	const { bindings, emitted } = setupOf(BoardActionsSheet, { board: BOARDS[0] })
	bindings.act('close', { detail: 1 })
	bindings.act('delete', { detail: 1 })
	assert.deepEqual(emitted, [], 'the trailing click of the press')
	bindings.act('favorite', { detail: 0 })
	assert.deepEqual(emitted, [['favorite']], 'Enter or Space on an entry')
	bindings.onDown()
	bindings.act('rename', { detail: 1 })
	assert.deepEqual(emitted, [['favorite'], ['rename']], 'a tap in the sheet')
	const src = read('src/components/BoardActionsSheet.vue')
	assert.match(src, /<div class="knorke-sheet__scrim"\s+@pointerdown="onDown"\s+@mousedown\.prevent\s+@click="act\('close', \$event\)" \/>/)
	assert.equal([...src.matchAll(/@click="act\('(favorite|rename|delete)', \$event\)"/g)].length, 3)
})

test('job 232 AK1/AK2/AK6: the CSS: the grid of 240 px cards with the picture at 240 : 150, the title in two lines; an unset star hidden only where the device can hover; two columns on a phone', () => {
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	const rule = (sel) => new RegExp('\\n' + sel.replace(/[.[\]()]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css)?.[1] ?? ''
	assert.match(rule('.knorke-list--grid .knorke-list__items'), /grid-template-columns: repeat\(auto-fill, minmax\(240px, 1fr\)\);/)
	assert.match(rule('.knorke-list--grid .knorke-list__icon'), /aspect-ratio: 240 \/ 150;/)
	assert.match(rule('.knorke-list--grid .knorke-list__title'), /-webkit-line-clamp: 2;/)
	assert.match(rule('.knorke-list__meta'), /color: var\(--knorke-text-muted\);/)
	const hover = css.match(/@media \(hover: hover\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
	assert.match(hover, /\.knorke-list--grid \.knorke-list__star\[aria-pressed='false'\] \{\s+opacity: 0;/)
	assert.match(hover, /\.knorke-list--grid \.knorke-list__item:hover \.knorke-list__star,\s+\.knorke-list--grid \.knorke-list__item:focus-within \.knorke-list__star \{\s+opacity: 1;/)
	assert.doesNotMatch(css.replace(hover, ''), /knorke-list__star[^{]*\{[^}]*opacity: 0/, 'nowhere else')
	assert.match(rule('.knorke-list--narrow.knorke-list--grid .knorke-list__items'), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
	assert.match(rule('.knorke-list--narrow .knorke-list__link'), /-webkit-touch-callout: none;/)
	assert.match(rule('.knorke-list__icon'), /width: 96px;\s+height: 60px;/, 'the list\'s picture')
})

// ---- components/TemplateGrid.vue ------------------------------------------------------------

const OWN = { state: 'ready', templates: [{ id: 17, name: 'Teamtag', sketch: [[0, 0, 120, 80, '#a2d9fe']] }], pending: [{ id: 23, name: 'Mein Vorschlag', sketch: [] }] }

/** @param {object} props TemplateGrid props @return {Promise<string>} SSR HTML without comments */
async function grid(props) {
	const app = createSSRApp(TemplateGrid, props)
	app.config.globalProperties.t = t
	return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

const order = (html) => [...html.matchAll(/data-knorke-(template|own-template|pending-template)="([^"]+)"/g)].map((m) => m[2])

test('job 232 AK7: "New board" picks with native radios: "Blank" first and picked, then the built-in and the adopted templates, no suggestions; picking emits update:pick', async () => {
	const html = await grid({ mode: 'pick', own: OWN, pick: 'blank' })
	assert.deepEqual(order(html), ['blank', ...TEMPLATE_KEYS, '17'])
	assert.doesNotMatch(html, /<button/, 'labels around radios, no buttons')
	const labels = [...html.matchAll(/<label class="([^"]+)"[^>]*data-knorke-picked="(true|false)">\s*<input type="radio" class="knorke-templates__radio" name="knorke-template-pick-pick" value="([^"]+)"( checked)?/g)]
	assert.deepEqual(labels.map((m) => [m[3], m[2], !!m[4]]), [['blank', 'true', true], ...TEMPLATE_KEYS.map((k) => [k, 'false', false]), ['own:17', 'false', false]])
	assert.match(labels[0][1], /knorke-templates__tile--blank/)
	assert.match(html, /<span id="knorke-template-pick-name-blank" class="knorke-templates__name">Blank<\/span><span id="knorke-template-pick-text-blank" class="knorke-templates__text">Without a template<\/span>/)
	const kanban = await grid({ mode: 'pick', pick: 'kanban' })
	assert.match(kanban, /data-knorke-template="kanban" data-knorke-picked="true"/)
	assert.match(kanban, /data-knorke-template="blank" data-knorke-picked="false"/)
	const src = read('src/components/TemplateGrid.vue')
	assert.match(src, /@change="\$emit\('update:pick', e\.value\)"\s+@keydown\.esc="\$emit\('cancel'\)"/, 'NcModal ignores Esc in an input: the radio closes the dialog itself')
})

test('job 232 AK8/AK9: the empty board\'s tiles are buttons, built-in, adopted, then "Blank", which emits blank; "Insert template" has no "Blank"; the ids of the modes never meet', async () => {
	const start = await grid({ mode: 'start', own: OWN })
	assert.deepEqual(order(start), [...TEMPLATE_KEYS, '17', 'blank'])
	assert.equal([...start.matchAll(/<button type="button" class="knorke-templates__tile/g)].length, 6)
	assert.doesNotMatch(start, /data-knorke-templates-error/)
	assert.doesNotMatch(await grid({ mode: 'start', own: { state: 'error', templates: [], pending: [] } }), /data-knorke-templates-error/, 'no error line on the canvas')
	const insert = await grid({ mode: 'insert', own: OWN })
	assert.deepEqual(order(insert), [...TEMPLATE_KEYS, '17', '23'])
	const ids = (html) => new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
	const both = [...ids(start)].filter((id) => ids(insert).has(id))
	assert.deepEqual(both, [], 'the start tiles and the dialog can show at once')
	const { bindings, emitted } = setupOf(TemplateGrid, { mode: 'start', own: OWN })
	for (const e of bindings.entries.value) bindings.choose(e)
	assert.deepEqual(emitted, [...TEMPLATE_KEYS.map((k) => ['insert', k]), ['insert-own', 17], ['blank']])
})

// ---- the shell and the board view ---------------------------------------------------------

test('job 232 AK7: "New board" has the title and the template grid, "Blank" picked on opening, route 28 loaded then; a picked template goes to the new board', () => {
	const app = read('src/App.vue')
	assert.match(app, /<ConfirmDialog v-if="dialog === 'create'"\s+:name="t\('knorke', 'New board'\)"\s+size="large"[\s\S]*?data-knorke-dialog="new-board"[\s\S]*?data-knorke-field="title" \/>\s+<fieldset v-if="newTemplatesShown" class="knorke-newboard__templates">\s+<legend class="knorke-newboard__legend">\s+\{\{ t\('knorke', 'Template'\) \}\}\s+<\/legend>\s+<TemplateGrid v-model:pick="pick"\s+mode="pick"\s+:own="newTemplates"\s+@cancel="closeDialog" \/>/)
	assert.match(app, /function openCreate\(\) \{[\s\S]*?pick\.value = 'blank'\s+newTemplatesShown\.value = !isViewOnlyDevice\(\)\s+dialog\.value = 'create'\s+if \(newTemplatesShown\.value\) \{\s+loadNewTemplates\(\)/)
	assert.match(app, /newTemplates\.value = res\.right === null \? null : \{ state: 'ready', templates: res\.templates, pending: \[\] \}/)
	assert.match(app, /const b = await boardsApi\.createBoard\(title\)\s+\/\/ job 232[^\n]*\n\s+startWith\(b\.id, startPick\(pick\.value\)\)\s+dialog\.value = null\s+push\(\{ name: 'board', id: b\.id \}\)/)
	assert.match(read('src/components/ConfirmDialog.vue'), /:size="size"/)
})

test('job 232 AK7/AK8: the board view takes the template of "New board" once and inserts it when the session may insert and reports the board empty; not empty, it is dropped; "Blank" hides the tiles for the visit', () => {
	const view = read('src/views/BoardView.vue')
	assert.match(view, /const boardEmpty = ref\(null\)/, 'unknown until the first report')
	assert.match(view, /const startPick = ref\(takeStart\(props\.boardId\)\)/)
	assert.match(view, /watch\(\[canInsert, boardEmpty\], \(\[may, empty\]\) => \{\s+const p = startPick\.value\s+if \(!p \|\| !may \|\| empty === null\) \{\s+return\s+\}\s+startPick\.value = null\s+if \(empty !== true\) \{\s+return\s+\}\s+if \(p\.own\) \{\s+insertOwnTemplate\(p\.own\)\s+\} else \{\s+insertTemplate\(p\.key\)/)
	assert.match(view, /function startBlank\(\) \{\s+startDone\.value = true\s+nextTick\(\(\) => focusCanvasHost\(\)\)/)
})

test('job 232 round 1: the mouse event of the lifting finger keeps the focus in the sheet (scrim and surface prevent it, an entry may take it); Esc and Tab are heard on the document, Tab from outside goes to the first entry', () => {
	const src = read('src/components/BoardActionsSheet.vue')
	assert.match(src, /data-knorke-sheet="board-actions"\s+@pointerdown="onDown"\s+@mousedown="keepFocus">/)
	assert.doesNotMatch(src, /@keydown=/, 'not on the sheet: the focus may have left it')
	assert.match(src, /onMounted\(async \(\) => \{\s+document\.addEventListener\('keydown', onKey\)/)
	assert.match(src, /onBeforeUnmount\(\(\) => \{\s+document\.removeEventListener\('keydown', onKey\)/)
	const { bindings, emitted } = setupOf(BoardActionsSheet, { board: BOARDS[0] })
	const md = (target) => ({ target, prevented: false, preventDefault() { this.prevented = true } })
	const surface = md({ closest: () => null })
	bindings.keepFocus(surface)
	assert.equal(surface.prevented, true, 'the surface or title of the sheet keeps the focus where it is')
	const entry = md({ closest: (sel) => (sel === 'button' ? {} : null) })
	bindings.keepFocus(entry)
	assert.equal(entry.prevented, false, 'an entry takes it')
	// Tab with the focus outside the sheet: back to the first entry
	const focused = []
	const first = { focus: () => focused.push('first') }
	const last = { focus: () => focused.push('last') }
	bindings.el.value = { querySelectorAll: () => [first, {}, last] }
	globalThis.document = { activeElement: null }
	try {
		const tab = { key: 'Tab', shiftKey: false, prevented: false, preventDefault() { this.prevented = true } }
		bindings.onKey(tab)
		assert.deepEqual(focused, ['first'])
		assert.equal(tab.prevented, true)
		globalThis.document.activeElement = last
		bindings.onKey({ key: 'Tab', shiftKey: false, preventDefault() {} })
		globalThis.document.activeElement = first
		bindings.onKey({ key: 'Tab', shiftKey: true, preventDefault() {} })
		assert.deepEqual(focused, ['first', 'first', 'last'], 'Tab wraps both ways')
		bindings.onKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
		assert.deepEqual(emitted, [['close']])
	} finally {
		delete globalThis.document
	}
})

test('job 232 AK3: deleting asks in a dialog with the question as its title, one sentence and "Cancel / Delete" in the error colour (German: „Board löschen?“, „Abbrechen“, „Löschen“)', () => {
	const app = read('src/App.vue')
	const dlg = app.match(/<ConfirmDialog v-if="dialog === 'delete'"[\s\S]*?\/>/)?.[0] ?? ''
	assert.match(dlg, /:name="t\('knorke', 'Delete board\?'\)"/)
	assert.match(dlg, /:message="t\('knorke', '“\{title\}” and everything on it will be deleted for everyone\. This cannot be undone\.'/)
	assert.match(dlg, /:confirm-label="t\('knorke', 'Delete'\)"/)
	assert.match(dlg, /\n\s+danger\n/)
	assert.match(dlg, /@confirm="remove"\s+@cancel="closeDialog"/)
	// the stub of NcDialog does not render its actions slot: the buttons from the source
	const confirm = read('src/components/ConfirmDialog.vue')
	assert.match(confirm, /<NcButton v-if="!hideCancel"\s+type="button"\s+variant="tertiary"[\s\S]*?\{\{ cancelLabel \|\| t\('knorke', 'Cancel'\) \}\}/)
	assert.match(confirm, /<NcButton type="submit"\s+:variant="danger \? 'error' : 'primary'"[\s\S]*?\{\{ confirmLabel \|\| t\('knorke', 'OK'\) \}\}/)
	const de = JSON.parse(read('l10n/de.json')).translations
	assert.equal(de['Delete board?'], 'Board löschen?')
	assert.equal(de.Cancel, 'Abbrechen')
	assert.equal(de.Delete, 'Löschen')
})

test('job 232 round 2: on a device that only views (no mouse or pen) "New board" has no template grid and loads no templates, so the board starts blank; with a mouse it has both', async () => {
	const App = (await import('../../../src/App.vue')).default
	const realMatch = globalThis.window.matchMedia
	const realLocation = globalThis.window.location
	globalThis.window.location = { pathname: '/index.php/apps/knorke/', search: '', hash: '' }
	try {
		for (const [fine, shown] of [[false, false], [true, true]]) {
			globalThis.window.matchMedia = (q) => ({ matches: q === '(any-pointer: fine)' ? fine : false, addEventListener() {}, removeEventListener() {} })
			const { bindings } = setupOf(App, {})
			bindings.pick.value = 'kanban'
			bindings.openCreate()
			assert.equal(bindings.newTemplatesShown.value, shown, 'fine pointer: ' + fine)
			assert.equal(bindings.pick.value, 'blank', 'the pick starts blank')
			if (!shown) assert.equal(bindings.newTemplates.value, null, 'nothing loads')
			else assert.equal(bindings.newTemplates.value?.state, 'loading', 'route 28 loads')
		}
	} finally {
		globalThis.window.matchMedia = realMatch
		globalThis.window.location = realLocation
	}
})

test('job 232 round 2: a start tile stays light under the pointer in every theme; on a phone the start layer begins right of the tool bar', () => {
	const css = read('src/styles/knorke.css').replace(/\/\*[\s\S]*?\*\//g, '')
	const rule = (sel) => new RegExp('\\n' + sel.replace(/[.[\]()]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css)?.[1] ?? ''
	assert.match(rule('.knorke-start button.knorke-templates__tile:hover'), /background: #f5f5f5 !important;/)
	assert.match(rule('.knorke-start button.knorke-templates__tile--blank:hover'), /background: rgba\(0, 0, 0, 0\.04\) !important;/)
	const narrow = rule('.knorke-board--narrow .knorke-start')
	assert.match(narrow, /inset-inline: calc\(3 \* var\(--knorke-gap\) \+ var\(--knorke-bar-h\)\) var\(--knorke-gap\);/)
	assert.match(narrow, /transform: translateY\(-50%\);/)
})

test('job 283 AK5: "No boards yet" shows the coloured logo L7 (img/app-color.svg, decorative); the other empty states keep their icons', async () => {
	const html = await render({ boards: [], filter: 'all' })
	const all = html.split('data-knorke-empty="all"')[1]
	assert.match(all, /<img class="knorke-list__logo" src="[^"]*\/img\/app-color\.svg" alt(="")? width="64" height="64">/)
	for (const filter of ['mine', 'favorites', 'shared']) {
		assert.doesNotMatch(await render({ boards: [], filter }), /app-color\.svg/, filter)
	}
	const css = read('src/styles/knorke.css')
	assert.match(css, /\[data-knorke-empty\] \.empty-content__icon:has\(> \.knorke-list__logo\) \{\s+opacity: 1;/, 'not dimmed by NcEmptyContent')
})
