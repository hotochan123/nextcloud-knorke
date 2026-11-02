/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Favorites and sort order of the board list (factory job 219).
 *
 * Sort order: 'opened' ("Last opened": openedAt of the account, newest
 * first; boards it never opened since the feature came follow, as
 * 'updated'), 'updated' ("Last modified", the default and the server's
 * order: updatedAt, then id, both descending) or 'name' (the language's
 * collation, numbers by value, case and accents ignored; equal names as
 * 'updated'). The choice is kept in this browser (localStorage
 * knorke.boardSort, util/storage.js); missing, unknown or blocked storage
 * means 'updated'.
 *
 * Star: useFavorites flips a row at once, sends route 55 and keeps that
 * row's button locked while its request runs (two taps never race each
 * other); a failed request flips the row back and calls onError.
 *
 * Factory job 232 (redesign board list): the view "Grid" or "List" is kept
 * like the sort order (knorke.boardView, default 'grid'); "New board"
 * hands the template it picked to the board view through startWith and
 * takeStart (in this page only, once); createLongPress is the long press
 * that opens a card's actions on a phone.
 */
import { ref } from 'vue'
import { setFavorite } from '../api/boards.js'
import { getItem, setItem } from '../util/storage.js'

/** The sort orders, in the order of the menu. */
export const SORTS = Object.freeze(['opened', 'updated', 'name'])
export const SORT_KEY = 'knorke.boardSort'
const DEFAULT_SORT = 'updated'

/** @return {'opened'|'updated'|'name'} the stored sort order of this browser */
export function readSort() {
	const v = getItem('local', SORT_KEY)
	return SORTS.includes(v) ? v : DEFAULT_SORT
}

/**
 * @param {string} sort sort order
 * @return {boolean} true when stored
 */
export function writeSort(sort) {
	return SORTS.includes(sort) && setItem('local', SORT_KEY, sort)
}

/**
 * @param {unknown} v number or not
 * @return {number} v, or 0 when it is no finite number
 */
function num(v) {
	return Number.isFinite(v) ? v : 0
}

/**
 * @param {object} a board
 * @param {object} b board
 * @return {number} "Last modified" order
 */
function byUpdated(a, b) {
	return (num(b.updatedAt) - num(a.updatedAt)) || (num(b.id) - num(a.id))
}

/**
 * @param {object} b board
 * @return {number|null} openedAt or null
 */
function openedOf(b) {
	return Number.isFinite(b?.openedAt) ? b.openedAt : null
}

/**
 * @param {string} [lang] language code
 * @return {Intl.Collator}
 */
function collator(lang) {
	try {
		return new Intl.Collator(lang || undefined, { numeric: true, sensitivity: 'base' })
	} catch (e) {
		return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
	}
}

/**
 * @param {object[]} boards boards of the list
 * @param {string} sort 'opened' | 'updated' | 'name' (anything else: 'updated')
 * @param {string} [lang] language of the name order
 * @return {object[]} a sorted copy
 */
export function sortBoards(boards, sort, lang = undefined) {
	const list = Array.isArray(boards) ? [...boards] : []
	if (sort === 'opened') {
		return list.sort((a, b) => {
			const x = openedOf(a)
			const y = openedOf(b)
			if (x !== null && y !== null && x !== y) {
				return y - x
			}
			if ((x === null) !== (y === null)) {
				return x === null ? 1 : -1
			}
			return byUpdated(a, b)
		})
	}
	if (sort === 'name') {
		const c = collator(lang)
		return list.sort((a, b) => c.compare(String(a.title ?? ''), String(b.title ?? '')) || byUpdated(a, b))
	}
	return list.sort(byUpdated)
}

/**
 * @param {import('vue').Ref<object[]>} boards the list of the shell
 * @param {number} id board id
 * @param {object} patch fields to set
 */
export function patchBoard(boards, id, patch) {
	boards.value = boards.value.map((b) => (b.id === id ? { ...b, ...patch } : b))
}

/**
 * @param {import('vue').Ref<object[]>} boards the list of the shell
 * @param {{save?: (id: number, favorite: boolean) => Promise<unknown>, onError?: (e: unknown) => void}} [opts] injection points
 * @return {{busy: import('vue').Ref<number[]>, toggle: (id: number) => Promise<void>}}
 */
export function useFavorites(boards, { save = setFavorite, onError = () => {} } = {}) {
	const busy = ref([])
	/** @param {number} id board id */
	async function toggle(id) {
		const board = boards.value.find((b) => b.id === id)
		if (!board || busy.value.includes(id)) {
			return
		}
		const next = board.favorite !== true
		patchBoard(boards, id, { favorite: next })
		busy.value = [...busy.value, id]
		try {
			await save(id, next)
		} catch (e) {
			patchBoard(boards, id, { favorite: !next })
			onError(e)
		} finally {
			busy.value = busy.value.filter((x) => x !== id)
		}
	}
	return { busy, toggle }
}

/** (Job 232) The views of the list, in the order of the switch. */
export const VIEWS = Object.freeze(['grid', 'list'])
export const VIEW_KEY = 'knorke.boardView'

/** @return {'grid'|'list'} (job 232) the stored view of this browser; missing, unknown or blocked storage: 'grid' */
export function readView() {
	const v = getItem('local', VIEW_KEY)
	return VIEWS.includes(v) ? v : 'grid'
}

/**
 * @param {string} view 'grid' | 'list'
 * @return {boolean} true when stored
 */
export function writeView(view) {
	return VIEWS.includes(view) && setItem('local', VIEW_KEY, view)
}

/**
 * (Job 232) The value of a tile of "New board" as a start template:
 * 'blank' (or anything that is no template) is none.
 *
 * @param {unknown} value a tile's value: a key of board/templates.js or 'own:<id>'
 * @return {{key: string}|{own: number}|null} the template to insert, null for none
 */
export function startPick(value) {
	if (typeof value !== 'string' || value === 'blank') {
		return null
	}
	const m = /^own:(\d+)$/.exec(value)
	if (m) {
		const id = Number(m[1])
		return Number.isSafeInteger(id) && id >= 1 ? { own: id } : null
	}
	return /^[a-z]+$/.test(value) ? { key: value } : null
}

/** (Job 232) board id → the template "New board" picked for it, until the board view takes it. */
const starts = new Map()

/**
 * @param {number} id the new board
 * @param {{key: string}|{own: number}|null} pick its template (startPick); null: none
 */
export function startWith(id, pick) {
	if (Number.isSafeInteger(id) && pick) {
		starts.set(id, pick)
	}
}

/**
 * @param {number} id the board that opens
 * @return {{key: string}|{own: number}|null} its template, once (then forgotten)
 */
export function takeStart(id) {
	const pick = starts.get(id) ?? null
	starts.delete(id)
	return pick
}

/** (Job 232) A long press: this long without moving more than LONG_PRESS_SLOP px. */
export const LONG_PRESS_MS = 500
export const LONG_PRESS_SLOP = 10

/**
 * (Job 232) A long press of a finger or pen on a card of the narrow list.
 * down(e, arg) starts the timer (a mouse never does), move cancels it beyond
 * the slop, up and cancel end it; after it fired, takeFired() is true once,
 * so the click that follows the press does not open the board. The next
 * down forgets it (a press whose browser sent no click).
 *
 * @param {(arg: unknown) => void} onPress called when the press fires
 * @param {{delay?: number, slop?: number, timers?: {setTimeout: Function, clearTimeout: Function}}} [opts] injection points
 * @return {{down: Function, move: Function, up: Function, cancel: Function, takeFired: () => boolean}}
 */
export function createLongPress(onPress, { delay = LONG_PRESS_MS, slop = LONG_PRESS_SLOP, timers = globalThis } = {}) {
	let timer = null
	let start = null
	let fired = false
	const clear = () => {
		if (timer !== null) {
			timers.clearTimeout(timer)
		}
		timer = null
		start = null
	}
	return {
		down(e, arg) {
			clear()
			fired = false
			if (e?.pointerType !== 'touch' && e?.pointerType !== 'pen') {
				return
			}
			start = { x: e.clientX, y: e.clientY }
			timer = timers.setTimeout(() => {
				timer = null
				start = null
				fired = true
				onPress(arg)
			}, delay)
		},
		move(e) {
			if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > slop) {
				clear()
			}
		},
		up: clear,
		cancel: clear,
		takeFired() {
			const f = fired
			fired = false
			return f
		},
	}
}
