/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 219: favorites and sort order of the board list
 * (components/boardList.js, the filter "favorites" of components/share.js,
 * views/BoardList.vue).
 */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { setupOf, useSfc } from './sfc.mjs'

useSfc()
// @nextcloud/router needs a web root outside a browser (board-list hrefs)
globalThis.window ??= { _oc_webroot: '' }

const { createSSRApp, ref } = await import('vue')
const { renderToString } = await import('vue/server-renderer')
const { SORTS, SORT_KEY, readSort, sortBoards, useFavorites, writeSort } = await import('../../../src/components/boardList.js')
const { filterBoards } = await import('../../../src/components/share.js')
const BoardList = (await import('../../../src/views/BoardList.vue')).default

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

const T0 = 1760000000000
const BOARDS = [
	{ id: 1, title: 'Retro 10', role: 'owner', source: 'own', updatedAt: T0 + 5, openedAt: null, favorite: false },
	{ id: 2, title: 'retro 9', role: 'edit', source: 'share', owner: { name: 'Bob' }, updatedAt: T0 + 9, openedAt: T0 + 1, favorite: true },
	{ id: 3, title: 'Ärger', role: 'view', source: 'link', viaLink: true, owner: { name: 'Bob' }, updatedAt: T0 + 5, openedAt: T0 + 7, favorite: true },
	{ id: 4, title: 'Board', role: 'owner', source: 'own', updatedAt: T0 + 1, favorite: false },
]
const ids = (list) => list.map((b) => b.id)

test('job 219 AK6: the filter "favorites" shows exactly the starred boards, of every source', () => {
	assert.deepEqual(ids(filterBoards(BOARDS, 'favorites')), [2, 3])
	assert.deepEqual(ids(filterBoards([{ id: 9 }, { id: 8, favorite: 'yes' }], 'favorites')), [], 'missing or non-boolean = not starred')
	assert.deepEqual(ids(filterBoards(BOARDS, 'all')), [1, 2, 3, 4], 'the other filters stay')
})

test('job 219 AK6: "Last modified" = updatedAt, then id, both descending (the server order)', () => {
	assert.deepEqual(ids(sortBoards(BOARDS, 'updated')), [2, 3, 1, 4])
	assert.deepEqual(ids(sortBoards(BOARDS, 'nonsense')), [2, 3, 1, 4], 'anything unknown sorts as updated')
	assert.deepEqual(ids(BOARDS), [1, 2, 3, 4], 'a copy, the input stays')
	assert.deepEqual(sortBoards(null, 'updated'), [])
})

test('job 219 AK6: "Last opened" = openedAt descending; never opened boards follow, as "Last modified"', () => {
	assert.deepEqual(ids(sortBoards(BOARDS, 'opened')), [3, 2, 1, 4])
	const same = [{ id: 5, updatedAt: 1, openedAt: 50 }, { id: 6, updatedAt: 2, openedAt: 50 }]
	assert.deepEqual(ids(sortBoards(same, 'opened')), [6, 5], 'same time: as updated')
})

test('job 219 AK6: "Name" = the collation of the language (numbers by value, case and accents ignored); equal names as "Last modified"', () => {
	assert.deepEqual(ids(sortBoards(BOARDS, 'name', 'de')), [3, 4, 2, 1], 'Ärger, Board, retro 9, Retro 10')
	const twins = [{ id: 7, title: 'Plan', updatedAt: 1 }, { id: 8, title: 'plan', updatedAt: 3 }]
	assert.deepEqual(ids(sortBoards(twins, 'name', 'de')), [8, 7])
	assert.deepEqual(ids(sortBoards(BOARDS, 'name', 'not a language!')), [3, 4, 2, 1], 'a bad language falls back')
})

test('job 219 AK6: the sort order is kept in this browser; missing, unknown or blocked storage means "updated"', () => {
	assert.deepEqual(SORTS, ['opened', 'updated', 'name'])
	assert.equal(readSort(), 'updated', 'nothing stored')
	assert.equal(writeSort('name'), true)
	assert.equal(globalThis.localStorage.map.get(SORT_KEY), 'name')
	assert.equal(readSort(), 'name')
	assert.equal(writeSort('random'), false, 'only known orders are stored')
	assert.equal(readSort(), 'name')
	globalThis.localStorage.map.set(SORT_KEY, 'size')
	assert.equal(readSort(), 'updated')
	globalThis.localStorage = fakeStorage(true)
	assert.equal(readSort(), 'updated', 'blocked storage: no error')
	assert.equal(writeSort('opened'), false)
	delete globalThis.localStorage
	assert.equal(readSort(), 'updated', 'no storage at all')
})

test('job 219 AK7: the star flips at once, sends its request and locks the row until the answer; a second tap meanwhile does nothing', async () => {
	const boards = ref(BOARDS.map((b) => ({ ...b })))
	const sent = []
	let finish
	const fav = useFavorites(boards, { save: (id, v) => { sent.push([id, v]); return new Promise((resolve) => { finish = resolve }) } })
	const first = fav.toggle(1)
	assert.equal(boards.value.find((b) => b.id === 1).favorite, true, 'flipped at once')
	assert.deepEqual(fav.busy.value, [1])
	await fav.toggle(1)
	assert.deepEqual(sent, [[1, true]], 'a double tap sends one request')
	assert.equal(boards.value.find((b) => b.id === 1).favorite, true)
	finish(true)
	await first
	assert.deepEqual(fav.busy.value, [])
	await Promise.all([fav.toggle(1).then(() => {}), Promise.resolve().then(() => finish(false))])
	assert.deepEqual(sent, [[1, true], [1, false]])
	assert.equal(boards.value.find((b) => b.id === 1).favorite, false, 'the last visible state is the stored one')
	await fav.toggle(99)
	assert.equal(sent.length, 2, 'an unknown row sends nothing')
})

test('job 219 AK7: a failed star request flips the row back and reports once', async () => {
	const boards = ref(BOARDS.map((b) => ({ ...b })))
	const errors = []
	const fav = useFavorites(boards, { save: async () => { throw new Error('offline') }, onError: (e) => errors.push(e.message) })
	await fav.toggle(2)
	assert.equal(boards.value.find((b) => b.id === 2).favorite, true, 'back to starred')
	assert.deepEqual(errors, ['offline'])
	assert.deepEqual(fav.busy.value, [])
})

// ---- views/BoardList.vue --------------------------------------------------------

/**
 * @param {object} props BoardList props
 * @return {Promise<string>} SSR HTML
 */
function render(props) {
	return renderToString(createSSRApp(BoardList, { boards: [], loading: false, error: '', filter: 'all', favoriteBusy: [], ...props }))
}

/**
 * @param {string} html SSR HTML
 * @param {number} id board id
 * @return {string} the row's HTML
 */
function rowOf(html, id) {
	return html.match(new RegExp('<li [^>]*data-knorke-board="' + id + '"[\\s\\S]*?</li>'))?.[0] ?? ''
}

test('job 219 AK7: each row has a named star with aria-pressed, the row says data-knorke-favorite; busy rows are aria-disabled', async () => {
	const html = await render({ boards: BOARDS, favoriteBusy: [3] })
	const own = rowOf(html, 1)
	assert.match(own, /<li [^>]*data-knorke-favorite="false"/)
	assert.match(own, /data-stub="NcButton"[^>]*data-knorke-action="favorite"/)
	assert.match(own, /data-knorke-action="favorite"[^>]*aria-pressed="false"[^>]*aria-label="Add to favorites"/)
	const starred = rowOf(html, 2)
	assert.match(starred, /<li [^>]*data-knorke-favorite="true"/)
	assert.match(starred, /aria-pressed="true"[^>]*aria-label="Remove from favorites"/)
	assert.doesNotMatch(starred, /aria-disabled/)
	assert.match(rowOf(html, 3), /data-knorke-action="favorite"[^>]*aria-disabled="true"/, 'its request runs')
	assert.equal([...html.matchAll(/data-knorke-action="favorite"/g)].length, 4, 'every row, not only own boards')
})

test('job 219 AK7: the star is a sibling of the link (U14), before the owner\'s actions, and emits favorite(id)', () => {
	const src = readFileSync(new URL('../../../src/views/BoardList.vue', import.meta.url), 'utf8')
	const ast = parse(src.match(/<template>([\s\S]*)<\/template>\s*<script/)[1])
	const all = []
	const walk = (n) => {
		if (n.type === 1) {
			all.push(n)
		}
		for (const c of n.children ?? []) {
			walk(c)
		}
	}
	walk(ast)
	const li = all.find((e) => e.tag === 'li')
	const kids = li.children.filter((c) => c.type === 1)
	// job 232: on a phone a set star is a mark (span) instead of the button
	assert.deepEqual(kids.map((c) => c.tag), ['a', 'NcButton', 'span', 'span'], 'link, star (or its mark on a phone), actions')
	assert.equal(kids[2].props.find((p) => p.name === 'class')?.value?.content, 'knorke-list__starmark')
	assert.equal(kids[3].props.find((p) => p.name === 'class')?.value?.content, 'knorke-list__actions')
	const star = kids[1]
	const on = star.props.find((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')
	assert.equal(on.exp.content, "$emit('favorite', b.id)")
	const { bindings, emitted } = setupOf(BoardList, { boards: BOARDS, loading: false, error: '', filter: 'all', favoriteBusy: [] })
	assert.equal(typeof bindings.starLabel, 'function')
	assert.deepEqual(emitted, [])
})

test('job 219 AK7: the filter "favorites" lists the starred boards under the heading "Favorites"; none says so', async () => {
	const html = await render({ boards: BOARDS, filter: 'favorites' })
	assert.match(html, /knorke-list__heading">\s*Favorites\s*</)
	assert.deepEqual([...html.matchAll(/<li [^>]*data-knorke-board="(\d+)"/g)].map((m) => Number(m[1])), [2, 3])
	const none = await render({ boards: BOARDS.map((b) => ({ ...b, favorite: false })), filter: 'favorites' })
	assert.match(none, /data-knorke-empty="favorites"/)
	assert.match(none, /name="No favorites yet"/)
	assert.match(none, /description="Mark a board with the star to find it here\."/)
	assert.doesNotMatch(none, /data-knorke-empty="shared"/)
})

test('job 219 AK7: the sort menu names the order in use and offers the three orders; picking one sorts and stores it', async () => {
	globalThis.localStorage.map.set(SORT_KEY, 'opened')
	const html = await render({ boards: BOARDS })
	assert.match(html, /data-stub="NcActions"[^>]*data-knorke-action="sort"/)
	assert.match(html, /menu-name="Sort: Last opened"/)
	assert.deepEqual([...html.matchAll(/data-knorke-sort="([a-z]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]),
		[['opened', 'Last opened'], ['updated', 'Last modified'], ['name', 'Name']])
	assert.deepEqual([...html.matchAll(/<li [^>]*data-knorke-board="(\d+)"/g)].map((m) => Number(m[1])), [3, 2, 1, 4], 'rows in the stored order')
	const { bindings } = setupOf(BoardList, { boards: BOARDS, loading: false, error: '', filter: 'all', favoriteBusy: [] })
	assert.equal(bindings.sort.value, 'opened')
	bindings.pickSort('name')
	assert.equal(bindings.sort.value, 'name')
	assert.equal(globalThis.localStorage.map.get(SORT_KEY), 'name')
	assert.deepEqual(ids(bindings.shown.value), [3, 4, 2, 1])
	bindings.pickSort('bogus')
	assert.equal(bindings.sort.value, 'name', 'unknown orders are ignored')
	assert.doesNotMatch(await render({ boards: [] }), /data-knorke-action="sort"/, 'nothing to sort, no menu')
})
