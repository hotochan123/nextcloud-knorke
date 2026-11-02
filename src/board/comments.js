/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Comments (factory job 189): the pure parts of the comment threads, so
 * every rule is a Node test. The server keeps the threads in Nextcloud's
 * comment store (routes 35–43); the session loads them (CommentFeed) and
 * the shell draws the list, the threads and the bubbles from what is here.
 *
 * Thread (GET routes 35/40): {id, item, x, y, resolved, comments: [{id,
 * name, guest, pid, mine, parts, at, edited, raw?, mentions?}]}, threads and
 * comments ascending. `parts` is a list of strings and {m: name}; it is only
 * ever set as text (partsView), never as HTML.
 *
 * - (Job 195) A thread on a mind map names its node (node, a key, else
 *   null): its bubble sits at that node's box (boxOf(item, node): the
 *   session's, the nearest node the layout shows, the root when it is gone).
 * - Bubbles: every open thread has one. On a live item of the five types
 *   (COMMENT_TYPES) its anchor is the top right corner of the item's
 *   axis-aligned hull (rotated items: the hull of the rotated box) and
 *   follows the live box. (Job 233, redesign docs/redesign/ P1) The bubble
 *   stands right of the item: its left edge BUBBLE_SIDE_PX right of the
 *   hull, its top BUBBLE_DROP_PX below the hull's top (round 1: clear of the
 *   vote badge at the corner, whatever its outward shift); more open threads on one item stand
 *   side by side to the right (slot 0 nearest the item). Without a live
 *   item it sits at the thread's x/y: beside it the same way when the thread
 *   names an item (x/y is that item's last corner, so a deleted item's
 *   bubble stays where it was), centred on it for a free thread. Its size on
 *   screen is always BUBBLE_PX.
 * - List: tab "Open" or "Resolved", newest activity first (the newest `at`
 *   or `edited` of its comments): author and first text of the first
 *   comment, the replies, the time.
 * - "Comment" in the context bar and the menu: exactly one selected item of
 *   the five types (commentableIds); the menu of the empty canvas always
 *   (while this person may comment).
 * - Mentions while typing (accounts): "@" at the start or after white space
 *   opens the @ list (mentionQuery); a choice writes "@Name " (insertMention)
 *   and is remembered; sending turns every remembered "@Name" into Nextcloud's
 *   form @"uid" (toWire); editing an own comment turns the stored @"uid" of
 *   its mentions back into "@Name" (fromWire).
 * - Live (CommentFeed): a snapshot with meta.comments or a change of the
 *   value loads the threads; at most one load runs, a change while it runs
 *   loads exactly once more afterwards; without the key nothing loads (the
 *   empty list counts as loaded). The
 *   answer of an own write counts at once (take, drop); a load that started
 *   before such an answer is dropped and repeated.
 */
import { rotatedBBox } from '../model/geometry.js'
import { t } from '../util/l10n.js'
import { isSlowDown, slowDownDelay } from '../sync/http.js'

/** Items a thread can hang on (CommentService::ITEM_TYPES). */
export const COMMENT_TYPES = Object.freeze(['sticky', 'shape', 'text', 'frame', 'table', 'mindmap'])
/** Characters of one comment (the server's COMMENT_MAX, Nextcloud's own limit). */
export const COMMENT_MAX = 1000
/** Diameter of a bubble on screen (px), whatever the zoom. */
export const BUBBLE_PX = 28
/** Gap between bubbles of one item (px). */
export const BUBBLE_GAP_PX = 4
/** (Job 233) Gap between an item's hull and its first bubble (px). */
export const BUBBLE_SIDE_PX = 6
/** (Job 233) The bubble's top below the hull's top (px): below the vote badge at the corner (its circle reaches 14 px down at most). */
export const BUBBLE_DROP_PX = 18
/** Longest @ query the server accepts (route 39). */
export const MENTION_QUERY_MAX = 64

/**
 * @param {string} type item type
 * @return {boolean} a thread can hang on it
 */
export function canCommentOn(type) {
	return COMMENT_TYPES.includes(type)
}

/**
 * The top right corner of the axis-aligned hull of a (rotated) box.
 *
 * @param {{x: number, y: number, w: number, h: number, r?: number}|null} box absolute box (degrees)
 * @return {{x: number, y: number}|null}
 */
export function cornerOf(box) {
	if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) {
		return null
	}
	const b = rotatedBBox(box.x, box.y, box.w, box.h, Number.isFinite(box.r) ? box.r : 0)
	return { x: Math.max(b[0], b[2]), y: Math.min(b[1], b[3]) }
}

/**
 * @param {object} t thread
 * @return {boolean} a thread object with an id and comments
 */
function isThread(t) {
	return !!t && typeof t === 'object' && typeof t.id === 'string' && Array.isArray(t.comments) && t.comments.length > 0
}

/**
 * Where the bubbles of the open threads go (world anchors).
 *
 * @param {object[]} threads threads, ascending
 * @param {(id: string, node: (string|null)) => ({x: number, y: number, w: number, h: number, r?: number}|null)} boxOf the
 *   live box of an item (null: no live item of the five types); (job 195) of a mind map's node
 * @return {{id: string, n: number, x: number, y: number, slot: number, item: (string|null), side: boolean}[]} x, y:
 *   the hull's top right corner (else the thread's point); slot 0 nearest the item, 1 right of it, …, else slot 0;
 *   item: the live item; side (job 233): the bubble stands right of x/y (a thread on an item, live or gone)
 */
export function bubbleAnchors(threads, boxOf) {
	const out = []
	const slots = new Map()
	for (const t of Array.isArray(threads) ? threads : []) {
		if (!isThread(t) || t.resolved === true) {
			continue
		}
		const node = typeof t.node === 'string' ? t.node : null
		const c = typeof t.item === 'string' ? cornerOf(boxOf(t.item, node)) : null
		if (c !== null) {
			// (job 195) the bubbles of one node stand side by side
			const where = node === null ? t.item : t.item + '#' + node
			const slot = slots.get(where) ?? 0
			slots.set(where, slot + 1)
			out.push({ id: t.id, n: t.comments.length, x: c.x, y: c.y, slot, item: t.item, side: true })
		} else if (Number.isFinite(t.x) && Number.isFinite(t.y)) {
			out.push({ id: t.id, n: t.comments.length, x: t.x, y: t.y, slot: 0, item: null, side: typeof t.item === 'string' })
		}
	}
	return out
}

/**
 * Screen places of the bubbles (container px of their centres). (Job 233)
 * A bubble of an item (anchor side) stands right of it: centre
 * BUBBLE_SIDE_PX + size / 2 right of the anchor plus slot · (size + gap),
 * BUBBLE_DROP_PX + size / 2 below it; a free thread's bubble is centred on its point.
 *
 * @param {object[]} anchors bubbleAnchors()
 * @param {{x: number, y: number, scale: number}} cam camera
 * @param {number} [size] bubble diameter (px)
 * @param {number} [gap] gap between bubbles of one item (px)
 * @return {{id: string, n: number, x: number, y: number}[]}
 */
export function bubblePlaces(anchors, cam, size = BUBBLE_PX, gap = BUBBLE_GAP_PX) {
	if (!cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !(cam.scale > 0)) {
		return []
	}
	return anchors.map((a) => {
		const side = a.side === true ? 1 : 0
		return {
			id: a.id,
			n: a.n,
			x: (a.x - cam.x) * cam.scale + side * (BUBBLE_SIDE_PX + size / 2 + a.slot * (size + gap)),
			y: (a.y - cam.y) * cam.scale + side * (BUBBLE_DROP_PX + size / 2),
		}
	})
}

/** Width of the thread popover (px; also in knorke.css). */
export const THREAD_W = 320
/** Gap between the popover and its bubble, and the popover's distance to the board's edges (px). */
export const THREAD_GAP = 18
export const THREAD_EDGE = 8
/** The popover keeps at least this much height below its top when its bubble is low (px), and is at most THREAD_MAX_H high. */
export const THREAD_ROOM = 360
export const THREAD_MAX_H = 560

/**
 * Where the thread popover goes (board px): beside its bubble, on the right
 * when it fits, else on the left; its top at the bubble, moved up so at
 * least THREAD_ROOM (or the whole board) stays below it; its height bound
 * to the room below its top (the list scrolls), so the field and "Send"
 * always lie inside the board.
 *
 * @param {{x: number, y: number}} anchor the bubble's centre
 * @param {{w: number, h: number}|null} bounds the board's size (null: unknown)
 * @return {{left: number, top: number, maxHeight: (number|null)}}
 */
export function threadPlace(anchor, bounds) {
	const w = bounds?.w > 0 ? bounds.w : 0
	const h = bounds?.h > 0 ? bounds.h : 0
	let left = anchor.x + THREAD_GAP
	if (w > 0 && left + THREAD_W > w - THREAD_EDGE) {
		left = Math.max(THREAD_EDGE, anchor.x - THREAD_GAP - THREAD_W)
	}
	let top = Math.max(THREAD_EDGE, anchor.y - THREAD_GAP)
	let maxHeight = null
	if (h > 0) {
		const room = Math.max(0, Math.min(THREAD_ROOM, h - 2 * THREAD_EDGE))
		top = Math.max(THREAD_EDGE, Math.min(top, h - THREAD_EDGE - room))
		maxHeight = Math.max(0, Math.min(THREAD_MAX_H, h - top - THREAD_EDGE))
	}
	return { left: Math.round(left), top: Math.round(top), maxHeight: maxHeight === null ? null : Math.floor(maxHeight) }
}

/**
 * (Review round 1) Do two screen rectangles overlap? The comment panel
 * closes at "New comment" when it covers the hint with its "Cancel".
 *
 * @param {{left: number, top: number, right: number, bottom: number}|null} a rectangle
 * @param {{left: number, top: number, right: number, bottom: number}|null} b rectangle
 * @return {boolean} both are there, not empty, and share an area
 */
export function rectsOverlap(a, b) {
	if (!a || !b || !(a.right > a.left) || !(a.bottom > a.top) || !(b.right > b.left) || !(b.bottom > b.top)) {
		return false
	}
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** The token id of a deleted account's mention (factory job 249, the server's CommentService::DELETED_MENTION). */
export const DELETED_MENTION = 'deleted_users'

/**
 * @param {Array<string|{m: string, gone?: true}>} parts parts of a comment
 * @return {{text: string, mention: boolean}[]} the parts as plain text pieces (set as text only);
 *   a deleted account's mention (gone) reads "@Deleted user" in the user's language
 */
export function partsView(parts) {
	const out = []
	for (const p of Array.isArray(parts) ? parts : []) {
		if (typeof p === 'string') {
			out.push({ text: p, mention: false })
		} else if (p && typeof p === 'object' && p.gone === true) {
			out.push({ text: '@' + t('knorke', 'Deleted user'), mention: true })
		} else if (p && typeof p === 'object' && typeof p.m === 'string') {
			out.push({ text: '@' + p.m, mention: true })
		}
	}
	return out
}

/**
 * @param {Array<string|{m: string}>} parts parts of a comment
 * @return {string} the text with @name
 */
export function partsText(parts) {
	return partsView(parts).map((p) => p.text).join('')
}

/**
 * @param {object} t thread
 * @return {number} ms of its newest activity: the newest `at` or `edited` of its comments
 */
export function lastActivity(t) {
	let last = 0
	for (const c of isThread(t) ? t.comments : []) {
		last = Math.max(last, Number.isFinite(c?.at) ? c.at : 0, Number.isFinite(c?.edited) ? c.edited : 0)
	}
	return last
}

/**
 * @param {string} a id
 * @param {string} b id
 * @return {number} numeric order of two decimal ids
 */
export function cmpId(a, b) {
	const x = String(a)
	const y = String(b)
	return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0)
}

/**
 * One entry of the list.
 *
 * @param {object} t thread
 * @return {{id: string, author: string, guest: boolean, text: string, replies: number, at: number, resolved: boolean}}
 */
export function threadEntry(t) {
	const first = t.comments[0]
	return {
		id: t.id,
		author: typeof first?.name === 'string' ? first.name : '',
		guest: first?.guest === true,
		text: partsText(first?.parts),
		replies: t.comments.length - 1,
		at: lastActivity(t),
		resolved: t.resolved === true,
	}
}

/**
 * The entries of one tab, newest activity first (equal: the newer thread first).
 *
 * @param {object[]} threads threads
 * @param {'open'|'resolved'} tab tab
 * @return {object[]} threadEntry() of each
 */
export function listEntries(threads, tab) {
	const want = tab === 'resolved'
	return (Array.isArray(threads) ? threads : [])
		.filter((t) => isThread(t) && (t.resolved === true) === want)
		.map(threadEntry)
		.sort((a, b) => b.at - a.at || cmpId(b.id, a.id))
}

/**
 * @param {object[]} threads threads
 * @return {{open: number, resolved: number}} the numbers of the two tabs
 */
export function tabCounts(threads) {
	const out = { open: 0, resolved: 0 }
	for (const t of Array.isArray(threads) ? threads : []) {
		if (isThread(t)) {
			out[t.resolved === true ? 'resolved' : 'open']++
		}
	}
	return out
}

/**
 * The open thread of an item (the oldest one; "Comment" on an item opens it
 * instead of a second one).
 *
 * @param {object[]} threads threads, ascending
 * @param {string} item item id
 * @param {string|null} [node] (job 195) only a thread on this node of a mind map (undefined: any)
 * @return {object|null}
 */
export function openThreadOf(threads, item, node = undefined) {
	if (typeof item !== 'string') {
		return null
	}
	const on = (t) => node === undefined || (typeof t.node === 'string' ? t.node : null) === node
	return (Array.isArray(threads) ? threads : []).find((t) => isThread(t) && t.resolved !== true && t.item === item && on(t)) ?? null
}

/**
 * "Comment" of the context bar and the menu on items: exactly one selected
 * item, of the five types.
 *
 * @param {string[]} ids selected ids
 * @param {(id: string) => (object|null)} get item of an id
 * @return {boolean}
 */
export function commentableIds(ids, get) {
	if (!Array.isArray(ids) || ids.length !== 1) {
		return false
	}
	const it = get(ids[0])
	return !!it && canCommentOn(it.t)
}

/**
 * The place of "New comment": the topmost item of the five types at a world
 * point (the scene model's hit test: frames by their title band and border,
 * a shape without fill by its outline, like a click), else null.
 *
 * @param {object} model scene model (hitTest; models without it: the topmost hull that holds the point)
 * @param {{x: number, y: number}} w world point
 * @param {number} [tol] tolerance (world units)
 * @return {string|null} item id
 */
export function pickItem(model, w, tol = 0) {
	if (!model || !w) {
		return null
	}
	const accept = (id) => canCommentOn(model.get(id)?.t)
	if (typeof model.hitTest === 'function') {
		return model.hitTest(w.x, w.y, tol, { accept, hollow: true }) ?? null
	}
	let best = null
	for (const id of model.ids?.() ?? []) {
		const a = accept(id) ? model.abs?.(id) : null
		const b = a ? rotatedBBox(a.x, a.y, a.w, a.h, Number.isFinite(a.r) ? a.r : 0) : null
		if (b && w.x >= b[0] - tol && w.x <= b[2] + tol && w.y >= b[1] - tol && w.y <= b[3] + tol
			&& (best === null || model.compareOrder(id, best) > 0)) {
			best = id
		}
	}
	return best
}

/**
 * The @ query at the caret: "@" at the start or after white space, then up
 * to MENTION_QUERY_MAX characters without white space and "@".
 *
 * @param {string} text field text
 * @param {number} caret caret position
 * @return {{start: number, q: string}|null} start = index of the "@"
 */
export function mentionQuery(text, caret) {
	if (typeof text !== 'string' || !Number.isInteger(caret) || caret < 0 || caret > text.length) {
		return null
	}
	const m = /(^|\s)@([^\s@]*)$/u.exec(text.slice(0, caret))
	if (!m || m[2].length > MENTION_QUERY_MAX) {
		return null
	}
	return { start: caret - m[2].length - 1, q: m[2] }
}

/**
 * Writes "@Name " over the query.
 *
 * @param {string} text field text
 * @param {number} start index of the "@" (mentionQuery)
 * @param {number} caret caret position
 * @param {string} name display name
 * @return {{text: string, caret: number}}
 */
export function insertMention(text, start, caret, name) {
	const token = '@' + name + ' '
	return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length }
}

/**
 * @param {string} s text
 * @return {string} s escaped for a RegExp
 */
function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The text as sent: every "@Name" of a remembered mention (longest names
 * first, not followed by a letter or digit) becomes @"uid".
 *
 * @param {string} text field text
 * @param {{id: string, name: string}[]} chosen remembered mentions
 * @return {string}
 */
export function toWire(text, chosen) {
	let out = typeof text === 'string' ? text : ''
	const list = (Array.isArray(chosen) ? chosen : [])
		.filter((c) => c && typeof c.id === 'string' && c.id !== '' && typeof c.name === 'string' && c.name !== '')
		.sort((a, b) => b.name.length - a.name.length)
	const marks = []
	for (const c of list) {
		const re = new RegExp('@' + escapeRe(c.name) + '(?![\\p{L}\\p{N}_])', 'gu')
		out = out.replace(re, () => {
			marks.push('@"' + c.id + '"')
			// a placeholder keeps a shorter name from matching inside this one
			return '\u0000' + (marks.length - 1) + '\u0000'
		})
	}
	return out.replace(/\u0000(\d+)\u0000/g, (m, k) => marks[Number(k)])
}

/**
 * An own comment for editing: the stored @"uid" (and @uid) of its mentions
 * become "@Name"; the mentions are remembered. A deleted account's mention
 * (@"deleted_users", job 249) reads "@Deleted user" in the user's language.
 *
 * @param {string} raw stored text
 * @param {Record<string, string>|null} mentions {uid: name}
 * @return {{text: string, chosen: {id: string, name: string}[]}}
 */
export function fromWire(raw, mentions) {
	const map = mentions && typeof mentions === 'object' ? mentions : {}
	const chosen = Object.entries(map).filter(([id, name]) => typeof name === 'string' && name !== '')
		.map(([id, name]) => ({ id, name: id === DELETED_MENTION ? t('knorke', 'Deleted user') : name }))
	let text = typeof raw === 'string' ? raw : ''
	for (const c of chosen) {
		text = text.split('@"' + c.id + '"').join('@' + c.name)
	}
	return { text, chosen }
}

/**
 * The time of a comment for the list and the thread: the time on the same
 * day, else date and time (short forms of the language).
 *
 * @param {number} ms time
 * @param {number} now now (ms)
 * @param {string} [lang] language (BCP 47)
 * @return {string}
 */
export function timeLabel(ms, now, lang = undefined) {
	if (!Number.isFinite(ms) || ms <= 0) {
		return ''
	}
	const d = new Date(ms)
	const today = new Date(now)
	const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
	try {
		return sameDay
			? d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
	} catch (e) {
		return d.toISOString().slice(0, 16).replace('T', ' ')
	}
}

/**
 * @param {unknown} list threads of an answer
 * @return {object[]} the valid threads, ascending
 */
export function normalizeThreads(list) {
	return (Array.isArray(list) ? list : []).filter(isThread).sort((a, b) => cmpId(a.id, b.id))
}

/**
 * The comment threads of one board session, live (see the file comment).
 * The load function is the transport's GET (routes 35/40).
 */
export class CommentFeed {
	/**
	 * @param {object} o options
	 * @param {() => Promise<{threads: object[]}>} o.load GET of the threads
	 * @param {() => void} [o.onChange] the threads changed
	 * @param {(e: unknown) => void} [o.onError] a load failed
	 * @param {(fn: () => void, ms: number) => unknown} [o.setTimer] setTimeout (tests)
	 * @param {(id: unknown) => void} [o.clearTimer] clearTimeout (tests)
	 * @param {() => number} [o.rand] Math.random (tests)
	 */
	constructor({ load, onChange = () => {}, onError = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), rand = Math.random }) {
		this.load = load
		this.onChange = onChange
		this.onError = onError
		this.setTimer = setTimer
		this.clearTimer = clearTimer
		this.rand = rand
		/** job 251: slow_down answers in a row (the guest's list throttle, route 40) and the waiting repeat */
		this.slowStreak = 0
		this.retryTimer = null
		/** @type {object[]} the threads, ascending */
		this.threads = []
		/** a load answered at least once */
		this.loaded = false
		/** meta.comments seen last (undefined: none) */
		this.seen = undefined
		this.running = false
		this.again = false
		/** loads started (tests and the debug view) */
		this.loads = 0
		/** own answers taken (a load started before one is dropped) */
		this.version = 0
		this.closed = false
		/** unsent text per thread ('new' for a new one) until the page is left */
		this.drafts = new Map()
	}

	/**
	 * meta.comments of a snapshot or a meta change.
	 *
	 * @param {unknown} value the key's value (undefined: the key is missing)
	 */
	meta(value) {
		if (value === undefined || value === null) {
			if (!this.loaded && !this.running && this.loads === 0 && !this.closed) {
				// no key: the board never had a comment, there is nothing to load
				this.loaded = true
				this.onChange()
			}
			return
		}
		if (value === this.seen) {
			return
		}
		this.seen = value
		this.refresh()
	}

	/** Loads the threads: at most one load at a time, one more after a change during it. */
	refresh() {
		if (this.closed) {
			return
		}
		if (this.running) {
			this.again = true
			return
		}
		this.cancelRetry()
		this.running = true
		this.loads++
		const version = this.version
		let p
		try {
			p = Promise.resolve(this.load())
		} catch (e) {
			p = Promise.reject(e)
		}
		p.then((res) => {
			if (this.closed) {
				return
			}
			if (this.version !== version) {
				// an own answer came meanwhile: this load may be older than it
				this.again = true
				return
			}
			this.slowStreak = 0
			this.threads = normalizeThreads(res?.threads)
			this.loaded = true
			this.onChange()
		}, (e) => {
			if (this.closed) {
				return
			}
			if (isSlowDown(e)) {
				// job 251: the guest's list throttle; load again after the wait (a change meanwhile loads at once)
				this.slowStreak++
				this.again = false
				this.retryTimer = this.setTimer(() => {
					this.retryTimer = null
					this.refresh()
				}, slowDownDelay(e, this.slowStreak, this.rand))
				return
			}
			this.onError(e)
		}).finally(() => {
			this.running = false
			if (this.again && !this.closed) {
				this.again = false
				this.refresh()
			}
		})
	}

	/**
	 * The answer of an own write: the thread replaces the one with its id
	 * (or joins the list).
	 *
	 * @param {object} thread thread of the answer
	 */
	take(thread) {
		if (!isThread(thread) || this.closed) {
			return
		}
		this.version++
		this.threads = normalizeThreads([...this.threads.filter((t) => t.id !== thread.id), thread])
		this.onChange()
	}

	/**
	 * Deleted comments of an own delete: a first comment takes its thread.
	 *
	 * @param {string[]} ids deleted ids
	 */
	drop(ids) {
		if (!Array.isArray(ids) || ids.length === 0 || this.closed) {
			return
		}
		const gone = new Set(ids.map(String))
		this.version++
		this.threads = this.threads
			.filter((t) => !gone.has(t.id))
			.map((t) => (t.comments.some((c) => gone.has(c.id)) ? { ...t, comments: t.comments.filter((c) => !gone.has(c.id)) } : t))
		this.onChange()
	}

	/**
	 * @param {string} id thread id
	 * @return {object|null} the thread
	 */
	get(id) {
		return this.threads.find((t) => t.id === id) ?? null
	}

	close() {
		this.closed = true
		this.cancelRetry()
	}

	/** Drops a waiting repeat after a slow_down (job 251). */
	cancelRetry() {
		if (this.retryTimer !== null) {
			this.clearTimer(this.retryTimer)
			this.retryTimer = null
		}
	}
}
