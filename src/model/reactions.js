/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Emoji reactions of notes (factory job 172), pure. Mirror of the checks in
 * lib/Service/Reactions.php; tests/fixtures/reactions-golden.json pins both.
 *
 * A sticky note keeps its reactions in data.react: a map from the key
 * p<pid> (pid = me.pid, 16 hex characters) to {e, n}. e is the emoji as its
 * code points in hex, lower case, without leading zeros, joined by '-'
 * (👍 1f44d, ❤️ 2764-fe0f), so nothing is lost without utf8mb4; n is the
 * name the server wrote. One reaction per person and note; when the last
 * one goes, data.react is missing.
 *
 * The op is a patch with exactly one path, data.react.p<own pid>: {e, n}
 * sets or replaces the own reaction, null takes it back (isReactionPatch).
 * The server reads only e and writes n itself; the client sends me.name so
 * its own state equals the echo.
 *
 * Valid e: 1–10 code points, each one of U+00A9, U+00AE, U+200D, U+203C,
 * U+2049, U+20E3, U+2100–U+2BFF, U+3030, U+303D, U+3297, U+3299, U+FE0F,
 * U+1F000–U+1FAFF, U+E0020–U+E007F; '#', '*' and '0'–'9' only as the first
 * code point of a keycap that ends with 20e3.
 *
 * The row under a note (rowPlan, sizes in world units, tokens.js): pills
 * REACT_H high, REACT_PAD + REACT_EMOJI + REACT_EMOJI_GAP + REACT_DIGIT ·
 * digits + REACT_PAD wide, REACT_SPACING apart; "+n" REACT_PAD + REACT_DIGIT
 * · characters + REACT_PAD; the button REACT_ADD square. As many pills as
 * fit into the note's width together with "+n" (when needed) and the
 * button (when one may react), at least none.
 */
import {
	REACT_ADD, REACT_DIGIT, REACT_EMOJI, REACT_EMOJI_GAP, REACT_PAD, REACT_SPACING,
} from './tokens.js'

/** The quick row of the picker, in this order: 👍 ❤️ 😂 🎉 🤔 👀. */
export const QUICK_REACTIONS = Object.freeze(['1f44d', '2764-fe0f', '1f602', '1f389', '1f914', '1f440'])

/** data key of the reactions and the prefix of a reaction path. */
export const REACT_FIELD = 'react'
export const REACT_PREFIX = 'data.react.'
/** Key of one person's reaction: p + their pid. */
export const REACT_KEY_RE = /^p[0-9a-f]{16}$/
/** Most code points of one emoji. */
export const REACT_MAX_POINTS = 10

const HEX_RE = /^[0-9a-f]{1,6}(?:-[0-9a-f]{1,6}){0,9}$/
const PID_RE = /^[0-9a-f]{16}$/
/** Keycap bases: #, * and 0–9. */
const KEYCAP = new Set([0x23, 0x2a, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])
/** Single code points of the allowed set. */
const SINGLE = new Set([0xa9, 0xae, 0x200d, 0x203c, 0x2049, 0x20e3, 0x3030, 0x303d, 0x3297, 0x3299, 0xfe0f])
/** Ranges of the allowed set (inclusive). */
const RANGES = Object.freeze([[0x2100, 0x2bff], [0x1f000, 0x1faff], [0xe0020, 0xe007f]])

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * @param {number} cp code point
 * @return {boolean} one of the allowed code points (keycap bases excluded)
 */
function allowed(cp) {
	return SINGLE.has(cp) || RANGES.some(([a, b]) => cp >= a && cp <= b)
}

/**
 * @param {unknown} e value
 * @return {boolean} a valid emoji in hex form (see the file comment)
 */
export function isEmoji(e) {
	if (typeof e !== 'string' || !HEX_RE.test(e)) {
		return false
	}
	const parts = e.split('-')
	if (parts.length > REACT_MAX_POINTS) {
		return false
	}
	for (let i = 0; i < parts.length; i++) {
		const h = parts[i]
		if (h[0] === '0') {
			return false
		}
		const cp = parseInt(h, 16)
		if (KEYCAP.has(cp)) {
			if (i !== 0 || parts.length < 2 || parts[parts.length - 1] !== '20e3') {
				return false
			}
			continue
		}
		if (!allowed(cp)) {
			return false
		}
	}
	return true
}

/**
 * @param {unknown} native emoji as text
 * @return {string|null} its hex form (every code point, lower case, '-'), null for '' or a non-string
 */
export function toHex(native) {
	if (typeof native !== 'string' || native === '') {
		return null
	}
	return Array.from(native, (c) => c.codePointAt(0).toString(16)).join('-')
}

/**
 * @param {unknown} e hex form
 * @return {string} the emoji as text ('' when e is no hex form with code points in range)
 */
export function fromHex(e) {
	if (typeof e !== 'string' || !HEX_RE.test(e)) {
		return ''
	}
	const cps = e.split('-').map((h) => parseInt(h, 16))
	return cps.every((cp) => cp <= 0x10ffff) ? String.fromCodePoint(...cps) : ''
}

/**
 * @param {unknown} pid participant id (16 hex characters)
 * @return {string|null} the reaction key p<pid>, null for anything else
 */
export function reactKey(pid) {
	return typeof pid === 'string' && PID_RE.test(pid) ? 'p' + pid : null
}

/**
 * @param {unknown} path patch path
 * @return {boolean} data.react or a path below it
 */
export function isReactPath(path) {
	return typeof path === 'string' && (path === 'data.' + REACT_FIELD || path.startsWith(REACT_PREFIX))
}

/**
 * @param {object|null|undefined} op op
 * @return {boolean} a reaction patch: a patch whose only path is data.react.<key> (one key below react)
 */
export function isReactionPatch(op) {
	if (!op || op.o !== 'patch' || !isMap(op.p)) {
		return false
	}
	const keys = Object.keys(op.p)
	return keys.length === 1 && keys[0].startsWith(REACT_PREFIX) && keys[0].length > REACT_PREFIX.length
		&& !keys[0].slice(REACT_PREFIX.length).includes('.')
}

/**
 * @param {object|null|undefined} data data of an item
 * @return {object} a shallow copy without the reactions (copies and pastes never carry them)
 */
export function withoutReactions(data) {
	if (!isMap(data)) {
		return {}
	}
	if (!hasOwn(data, REACT_FIELD)) {
		return data
	}
	const out = { ...data }
	delete out[REACT_FIELD]
	return out
}

/**
 * The valid entries of an item's reactions (key, e and a string n), in key order.
 *
 * @param {object|null|undefined} item WireItem
 * @return {Array<{key: string, e: string, n: string}>}
 */
export function entriesOf(item) {
	const map = isMap(item?.data) ? item.data[REACT_FIELD] : null
	if (!isMap(map)) {
		return []
	}
	const out = []
	for (const key of Object.keys(map)) {
		const v = map[key]
		if (REACT_KEY_RE.test(key) && isMap(v) && isEmoji(v.e) && typeof v.n === 'string') {
			out.push({ key, e: v.e, n: v.n })
		}
	}
	return out
}

/**
 * @param {object|null|undefined} item WireItem
 * @return {boolean} the item has at least one valid reaction
 */
export function hasReactions(item) {
	return entriesOf(item).length > 0
}

/**
 * @param {object|null|undefined} item WireItem
 * @param {unknown} pid my pid
 * @return {string|null} my reaction's emoji, null without one
 */
export function reactionOf(item, pid) {
	const key = reactKey(pid)
	if (key === null) {
		return null
	}
	const own = entriesOf(item).find((x) => x.key === key)
	return own ? own.e : null
}

/**
 * The value of my reaction patch for a choice (set, replace, take back).
 *
 * @param {object|null|undefined} item WireItem (visible state)
 * @param {string} pid my pid
 * @param {string} e chosen emoji
 * @param {string} name my name (n of the patch)
 * @return {{path: string, value: ({e: string, n: string}|null)}|null} null for an invalid pid or emoji
 */
export function reactionPatch(item, pid, e, name) {
	const key = reactKey(pid)
	if (key === null || !isEmoji(e)) {
		return null
	}
	const value = reactionOf(item, pid) === e ? null : { e, n: typeof name === 'string' ? name : '' }
	return { path: REACT_PREFIX + key, value }
}

/**
 * The reactions of an item grouped by emoji: count, whether one is mine, and
 * the names (localeCompare, mine marked). Order: count descending, then e
 * ascending; the key order of data.react does not matter.
 *
 * @param {object|null|undefined} item WireItem
 * @param {unknown} pid my pid (null: none is mine)
 * @return {Array<{e: string, n: number, mine: boolean, names: Array<{name: string, mine: boolean}>}>}
 */
export function summarize(item, pid) {
	const mineKey = reactKey(pid)
	const by = new Map()
	for (const x of entriesOf(item)) {
		let g = by.get(x.e)
		if (!g) {
			g = { e: x.e, n: 0, mine: false, names: [] }
			by.set(x.e, g)
		}
		g.n++
		const mine = x.key === mineKey
		g.mine = g.mine || mine
		g.names.push({ name: x.n, mine })
	}
	const out = [...by.values()]
	for (const g of out) {
		g.names.sort((a, b) => a.name.localeCompare(b.name) || (a.mine === b.mine ? 0 : a.mine ? -1 : 1))
	}
	out.sort((a, b) => b.n - a.n || (a.e < b.e ? -1 : a.e > b.e ? 1 : 0))
	return out
}

/**
 * @param {number} n count of a pill
 * @return {number} its width (world units)
 */
export function pillWidth(n) {
	return REACT_PAD + REACT_EMOJI + REACT_EMOJI_GAP + REACT_DIGIT * String(n).length + REACT_PAD
}

/**
 * @param {number} n kinds left over
 * @return {number} width of the "+n" pill (world units)
 */
export function moreWidth(n) {
	return REACT_PAD + REACT_DIGIT * ('+' + n).length + REACT_PAD
}

/**
 * The row of a note (world units, x from the note's left edge): the pills
 * that fit into w together with "+n" (when kinds are left over) and the
 * button (add), at least none.
 *
 * @param {Array<{e: string, n: number, mine: boolean}>} summary summarize() of the note
 * @param {number} w the note's width
 * @param {{add?: boolean}} [o] add: the button ends the row (one may react)
 * @return {{pills: Array<{e: string, n: number, mine: boolean, x: number, w: number}>,
 *   more: ({n: number, x: number, w: number}|null), add: ({x: number, w: number}|null), width: number}}
 */
export function rowPlan(summary, w, { add = false } = {}) {
	const list = Array.isArray(summary) ? summary : []
	const total = (k) => {
		const widths = list.slice(0, k).map((g) => pillWidth(g.n))
		if (k < list.length) widths.push(moreWidth(list.length - k))
		if (add) widths.push(REACT_ADD)
		return widths.reduce((s, x) => s + x, 0) + REACT_SPACING * Math.max(0, widths.length - 1)
	}
	let k = list.length
	while (k > 0 && !(total(k) <= w)) {
		k--
	}
	let x = 0
	const pills = []
	for (const g of list.slice(0, k)) {
		const pw = pillWidth(g.n)
		pills.push({ e: g.e, n: g.n, mine: g.mine, x, w: pw })
		x += pw + REACT_SPACING
	}
	let more = null
	if (k < list.length) {
		const mw = moreWidth(list.length - k)
		more = { n: list.length - k, x, w: mw }
		x += mw + REACT_SPACING
	}
	let button = null
	if (add) {
		button = { x, w: REACT_ADD }
		x += REACT_ADD + REACT_SPACING
	}
	return { pills, more, add: button, width: Math.max(0, x - REACT_SPACING) }
}
