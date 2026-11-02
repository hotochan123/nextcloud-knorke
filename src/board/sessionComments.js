/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Comments, emoji reactions and the laser pointer of a board session
 * (factory job 255, moved out of BoardSession.js): the methods below run on
 * the session's state through the host callbacks of the constructor (the
 * pattern of SessionFiles, sessionFiles.js). BoardSession keeps a thin
 * method of the same name for each one (BoardView, transport.js, the menus
 * and the tests call them on the session), and this module never imports
 * BoardSession.js. Every callback reads the session at the time of the
 * call; the state (comments, bubbles, commentPicking, reactPicker,
 * reactPopup, laser, laserEnded) stays a field of the session, written
 * through h.set (the array laser is changed in place).
 *
 * Job 172 (emoji reactions of notes, model/reactions.js): whoever may vote
 * (canVote(me.role): owner, edit, vote, guests of both links) reacts while
 * the board is not frozen (mayReact), in every client mode; the scene gets
 * that, the own pid and (job 183) the touch screen of the option touch
 * (pushReactions → scene.setReactions) and adds its own rule (mode edit:
 * the select tool; touch in mode vote or view: the button at every note).
 * react(id, e) sends ONE reaction patch {data.react.p<pid>: {e, n:
 * me.name}} for a sticky note: set, the
 * same emoji again takes it back (null), another replaces it; through
 * enqueue, never into the undo stack, the model shows it at once. Bad,
 * denied and limit (and any other code but gone, dup and busy) toast
 * "Your reaction could not be saved." once per answer
 * ([data-knorke-toast=react-failed]); gone stays silent.
 * - The scene's intents (every mode, no end of following): react → react();
 *   reactPick → the picker (ui.onReactionPicker({id, rect, mine}) or null);
 *   reactList → the list of every emoji with names, reactNames → the names
 *   of one emoji (ui.onReactionNames({kind: 'list'|'names', id, rect,
 *   entries: summarize(…), canReact}) or null; id null hides names).
 * - The picker also opens from the context bar (reactFromBar(rect), exactly
 *   one note) and the menu entry react (at the menu's point); selection v2
 *   reactable says when (exactly one note, mayReact, mode edit).
 *   pickReaction(e) is the shell's choice: it closes the picker and
 *   reacts. The picker closes when its note leaves the model, the rights
 *   or the mode change, the board freezes, and on a camera change; the
 *   names and the list follow every change of their note (and close when
 *   it goes or the camera changes), a frozen board keeps them (no action).
 *
 * Job 171 (laser pointer): the scene's onLaser points are stored with now()
 * (laserPoint): a point less than LASER_MIN_GAP_MS after the last stored one
 * only replaces its place, null marks the end of a stroke (a null goes
 * between it and the next point), and every point pokes the sync loop.
 * getPresence() adds l to the full me of mode edit (laserWire: the points
 * of the last LASER_WINDOW_MS, at most the newest LASER_WIRE_MAX elements,
 * [x, y, d] with d = ms from the point to the building of me, oldest first,
 * null only between two strokes; no l without a point there), never to null
 * or the presenter's {v}. Nothing is stored, no op, no undo step. The scene
 * gets the own colour (setLaserColor, colorFor(me.pid)); the presence model
 * plays the others' trails laserDelay(deviceViewOnly) behind them, and the
 * fast cadence holds while someone points (hasDragging() || hasLaser()).
 *
 * Factory job 189 (comments, board/comments.js): the threads live in
 * Nextcloud's comment store (routes 35–43, transport.comments). A snapshot
 * with meta.comments and every change of that value load them (CommentFeed:
 * at most one load, one more after a change during it; without the key
 * none). A meta change that changes nothing but comments leaves VoteState,
 * the timer and the follower alone (onMeta keeps the other values as they
 * were and skips applyMeta). Whoever may vote may comment (mayComment:
 * canVote(me.role), not frozen); ui.onComments gets commentsView(). The
 * own writes (createThread, replyTo, editComment, setResolved,
 * deleteComment) count at once (take, drop); errors toast
 * [data-knorke-toast=comment-failed]. "New comment" (startCommentPick)
 * switches the scene to pick (scene.setPick): the next click or tap picks
 * the topmost item of the five types (pickItem) or the free point; a tap on
 * an item with an open thread opens that one (ui.onCommentOpen), anything
 * else opens the editor there (ui.onCommentCompose); Esc, "Cancel", a
 * frozen board end it (ui.onCommentPick). "Comment" of the context bar
 * (commentOn, selection v2 commentable: exactly one item of the five types,
 * mode edit) and the menu (on items and the empty canvas, menuAction
 * 'comment') work the same way. Deleting items (also undo, redo, cut) sends
 * for every thread on them PATCH x/y with their last top right corner, so
 * the thread stays there; when undo brings an item back the thread hangs on
 * it again (it keeps item). commentPlaces() and threadPlace() give the
 * bubbles' screen places from the live camera and the live model;
 * centerOn() pans a world point into the free part of the canvas. The
 * switch "Show bubbles" is localStorage knorke.bubbles = '0' (every board of
 * this browser). No comment action is an undo step.
 */
import { mindTree, nodesOf, visibleAncestor } from '../model/mindmap.js'
import { isEmoji, reactionOf, reactionPatch, summarize } from '../model/reactions.js'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'
import { keys } from '../util/storage.js'
import { bubbleAnchors, bubblePlaces, canCommentOn, cornerOf, openThreadOf, pickItem } from './comments.js'
import { canVote } from './mode.js'
import { LASER_MIN_GAP_MS, LASER_WINDOW_MS, LASER_WIRE_MAX, r1 } from './sessionConsts.js'

/** The session's fields the host gives as functions without arguments (read at the call). */
export const COMMENTS_STATE = Object.freeze(['bubbles', 'clientMode', 'comments', 'commentPicking', 'deps', 'destroyed', 'deviceTouch', 'deviceViewOnly', 'follower', 'frozen', 'laser', 'laserEnded', 'me', 'mmFocus', 'mode', 'model', 'reactPicker', 'reactPopup', 'replica', 'scene', 'selection', 'storage', 'sync', 'transport', 'ui'])

/** The session's methods the host hands over under the same name (looked up on the session at the call). */
export const COMMENTS_CALLS = Object.freeze(['cameraNow', 'closeMenu', 'flushVisible', 'now', 'toast'])

/** The session's fields this module may write (h.set). */
export const COMMENTS_SETS = Object.freeze(['bubbles', 'commentPicking', 'reactPicker', 'reactPopup', 'laserEnded'])

export class SessionComments {
	/**
	 * @param {object} h host: one function per name of COMMENTS_STATE and COMMENTS_CALLS, plus
	 *   set(k, v) for the names of COMMENTS_SETS
	 */
	constructor(h) {
		this.h = h
	}

	// ---- job 172: emoji reactions ------------------------------------------

	/** @return {boolean} this person may react now: canVote(me.role) on a board that is not frozen */
	mayReact() {
		const h = this.h
		return !h.frozen() && !h.destroyed() && canVote(h.me()?.role)
	}

	/**
	 * The scene's part of the reaction rule: who may react, the own pid
	 * (which pills are mine) and (job 183) the touch screen (in mode vote or
	 * view the button stands at every note).
	 */
	pushReactions() {
		const h = this.h
		try {
			h.scene()?.setReactions?.({ canReact: this.mayReact(), me: typeof h.me()?.pid === 'string' ? h.me().pid : null, touch: h.deviceTouch() })
		} catch (e) {
			console.error('[knorke] scene.setReactions failed', e)
		}
	}

	/**
	 * Sets, replaces or takes back the own reaction on a note: ONE patch
	 * data.react.p<pid> (model/reactions.js reactionPatch; the same emoji
	 * again takes it back), never an undo step. Nothing for anything but a
	 * note, an invalid emoji, or when this person may not react.
	 *
	 * @param {string} id note
	 * @param {string} e emoji (hex form)
	 * @return {boolean} an op went out
	 */
	react(id, e) {
		const h = this.h
		if (!this.mayReact() || !h.sync() || typeof id !== 'string' || !h.model()?.has(id) || !isEmoji(e)) {
			return false
		}
		const it = h.replica().visible(id) ?? h.model().get(id)
		if (it?.t !== 'sticky') {
			return false
		}
		const r = reactionPatch(it, h.me()?.pid, e, typeof h.me()?.name === 'string' ? h.me().name : '')
		if (r === null) {
			return false
		}
		const ids = h.sync().enqueue([{ o: 'patch', id, p: { [r.path]: r.value } }], { urgent: !h.deviceViewOnly() })
		h.flushVisible(ids)
		return true
	}

	/**
	 * The scene's reaction intents (every mode): a pill toggles, the button
	 * opens the picker, "+n" the list, a hold or a resting mouse the names.
	 *
	 * @param {object} i intent react | reactPick | reactList | reactNames
	 */
	reactIntent(i) {
		const h = this.h
		switch (i.type) {
		case 'react':
			this.react(i.id, i.e)
			break
		case 'reactPick':
			this.openReactionPicker(i.id, i.rect ?? null)
			break
		case 'reactList':
			this.openReactionPopup('list', i.id, null, i.rect ?? null)
			break
		default:
			if (typeof i.id === 'string') {
				this.openReactionPopup('names', i.id, i.e, i.rect ?? null, i.hold === true)
			} else if (h.reactPopup()?.kind === 'names' && !h.reactPopup().hold) {
				this.closeReactionPopup()
			}
		}
	}

	/**
	 * Opens the reaction picker of a note at a screen box (container px): the
	 * smiley-plus button, the context bar's button or the menu's point.
	 *
	 * @param {string} id note
	 * @param {{x: number, y: number, w: number, h: number}|null} rect where it opens
	 * @return {boolean} it opened
	 */
	openReactionPicker(id, rect) {
		const h = this.h
		if (!this.mayReact() || typeof id !== 'string' || !h.model()?.has(id) || h.model().get(id).t !== 'sticky') {
			return false
		}
		this.closeReactionPopup()
		const r = rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null
		h.set('reactPicker', { id, rect: r, cam: h.cameraNow(), mode: h.clientMode() })
		this.emitReactionPicker()
		return true
	}

	/**
	 * The context bar's "Add reaction": the picker of the one selected note,
	 * below the button.
	 *
	 * @param {{x: number, y: number, w: number, h: number}|null} rect the button (container px)
	 * @return {boolean} it opened
	 */
	reactFromBar(rect) {
		const h = this.h
		return h.selection().length === 1 && this.openReactionPicker(h.selection()[0], rect)
	}

	/** The shell's state of the picker: {id, rect, mine} (the own emoji on that note, or null), or null. */
	emitReactionPicker() {
		const h = this.h
		const p = h.reactPicker()
		const it = p && h.model()?.has(p.id) ? (h.replica().visible(p.id) ?? h.model().get(p.id)) : null
		h.ui().onReactionPicker?.(p ? { id: p.id, rect: p.rect ? { ...p.rect } : null, mine: reactionOf(it, h.me()?.pid) } : null)
	}

	/** Closes the reaction picker (its Esc, a click beside it, a choice, or a rule of checkReactions). */
	closeReactionPicker() {
		const h = this.h
		if (h.reactPicker() === null) {
			return
		}
		h.set('reactPicker', null)
		this.emitReactionPicker()
	}

	/**
	 * The choice of the picker (quick row or the full list): closes it, then
	 * sets, replaces or takes back the own reaction.
	 *
	 * @param {string} e emoji (hex form)
	 * @return {boolean} an op went out
	 */
	pickReaction(e) {
		const h = this.h
		const p = h.reactPicker()
		if (p === null) {
			return false
		}
		this.closeReactionPicker()
		return this.react(p.id, e)
	}

	/**
	 * Opens the names of one emoji (kind 'names') or the list of all (kind
	 * 'list') of a note at a screen box.
	 *
	 * @param {'names'|'list'} kind what shows
	 * @param {string} id note
	 * @param {string|null} e the emoji (names)
	 * @param {{x: number, y: number, w: number, h: number}|null} rect the pill or "+n" (container px)
	 * @param {boolean} [hold] names of a long press (a popover; a resting mouse's are a tooltip)
	 */
	openReactionPopup(kind, id, e, rect, hold = false) {
		const h = this.h
		if (typeof id !== 'string' || !h.model()?.has(id)) {
			return
		}
		const r = rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null
		h.set('reactPopup', { kind, id, e: typeof e === 'string' ? e : null, rect: r, cam: h.cameraNow(), hold: kind === 'list' || hold === true })
		this.emitReactionPopup()
	}

	/**
	 * The shell's state of the names or the list: {kind, id, rect, entries
	 * (summarize: e, n, mine, names [{name, mine}]), canReact, hold} or null;
	 * it closes when nothing of it is left.
	 */
	emitReactionPopup() {
		const h = this.h
		const p = h.reactPopup()
		if (p === null) {
			h.ui().onReactionNames?.(null)
			return
		}
		const item = h.model()?.has(p.id) ? h.model().get(p.id) : null
		const all = item ? summarize(item, h.me()?.pid) : []
		const entries = p.kind === 'names' ? all.filter((g) => g.e === p.e) : all
		if (entries.length === 0) {
			this.closeReactionPopup()
			return
		}
		h.ui().onReactionNames?.({ kind: p.kind, id: p.id, rect: p.rect ? { ...p.rect } : null, entries, canReact: this.mayReact(), hold: p.hold })
	}

	/** Closes the names or the list. */
	closeReactionPopup() {
		const h = this.h
		if (h.reactPopup() === null) {
			return
		}
		h.set('reactPopup', null)
		h.ui().onReactionNames?.(null)
	}

	/**
	 * After model changes: the picker closes when its note is gone (or no
	 * note), when this person may no longer react or the mode changed; its
	 * own emoji follows. The names and the list follow their note.
	 *
	 * @param {Iterable<string>} ids the ids of the change
	 */
	checkReactions(ids) {
		const h = this.h
		const set = ids instanceof Set ? ids : new Set(ids)
		const p = h.reactPicker()
		if (p !== null) {
			if (!this.mayReact() || !h.model()?.has(p.id) || h.model().get(p.id).t !== 'sticky' || h.clientMode() !== p.mode) {
				this.closeReactionPicker()
			} else if (set.has(p.id)) {
				this.emitReactionPicker()
			}
		}
		if (h.reactPopup() !== null && set.has(h.reactPopup().id)) {
			this.emitReactionPopup()
		}
	}

	// ---- factory job 189: comments ----------------------------------------

	/** @return {object|null} the comment calls of the transport (tests: deps.comments) */
	commentApi() {
		const h = this.h
		return h.deps().comments ?? h.transport()?.comments ?? null
	}

	/** @return {boolean} this person may write comments now (canVote(me.role), not frozen) */
	mayComment() {
		const h = this.h
		return !h.frozen() && !h.destroyed() && canVote(h.me()?.role)
	}

	/**
	 * @return {{threads: object[], loaded: boolean, mayWrite: boolean, mod: boolean, guest: boolean, bubbles: boolean,
	 *   picking: boolean}} what the shell shows
	 */
	commentsView() {
		const h = this.h
		return {
			threads: h.comments().threads,
			loaded: h.comments().loaded,
			mayWrite: this.mayComment(),
			mod: h.me()?.mod === true,
			guest: h.mode() === 'guest',
			bubbles: h.bubbles(),
			picking: h.commentPicking(),
		}
	}

	emitComments() {
		const h = this.h
		h.ui().onComments?.(this.commentsView())
	}

	/**
	 * "Show bubbles": localStorage knorke.bubbles '0' (off) or the key removed
	 * (on); every board of this browser.
	 *
	 * @param {boolean} on show the bubbles
	 */
	setBubbles(on) {
		const h = this.h
		h.set('bubbles', on === true)
		if (h.bubbles()) {
			h.storage().removeItem('local', keys.bubbles())
		} else {
			h.storage().setItem('local', keys.bubbles(), '0')
		}
		this.emitComments()
	}

	/**
	 * "New comment": the next click or tap picks the place (every mode).
	 *
	 * @return {boolean} the pick started
	 */
	startCommentPick() {
		const h = this.h
		if (!this.mayComment() || !h.scene()) {
			return false
		}
		h.closeMenu()
		h.set('commentPicking', true)
		h.scene().setPick?.(true)
		h.ui().onCommentPick?.(true)
		this.emitComments()
		return true
	}

	/** Ends the pick of "New comment" (Esc, "Cancel", frozen, the pick itself). */
	cancelCommentPick() {
		const h = this.h
		if (!h.commentPicking()) {
			return
		}
		h.set('commentPicking', false)
		try {
			h.scene()?.setPick?.(false)
		} catch (e) {
			// the scene is gone
		}
		h.ui().onCommentPick?.(false)
		this.emitComments()
	}

	/**
	 * The scene's pick: the topmost item of the five types at the point, else
	 * the free point.
	 *
	 * @param {{world: {x: number, y: number}}} i intent pick
	 */
	onCommentPick(i) {
		const h = this.h
		if (!h.commentPicking()) {
			return
		}
		this.cancelCommentPick()
		const w = i?.world
		if (!this.mayComment() || !h.model() || !w || !Number.isFinite(w.x) || !Number.isFinite(w.y)) {
			return
		}
		const scale = h.scene()?.getCamera?.()?.scale
		const id = pickItem(h.model(), w, scale > 0 ? 4 / scale : 0)
		if (id !== null) {
			// job 195: on a mind map the node under the point
			this.commentOn(id, h.model().get(id)?.t === 'mindmap' ? (h.scene()?.nodeAt?.(id, w) ?? null) : undefined)
		} else {
			this.composeComment({ item: null, x: w.x, y: w.y })
		}
	}

	/**
	 * "Comment" on an item: its open thread opens; without one the editor of a
	 * new thread opens at the item's corner. (Job 195) On a mind map the thread
	 * hangs on a node: node, else the focused one, else the root.
	 *
	 * @param {string} id item
	 * @param {string|null} [node] (job 195) the node of a mind map
	 * @return {boolean} something opened
	 */
	commentOn(id, node = undefined) {
		const h = this.h
		if (!this.mayComment() || typeof id !== 'string' || !h.model()?.has(id) || !canCommentOn(h.model().get(id).t)) {
			return false
		}
		const it = h.model().get(id)
		const key = it.t === 'mindmap'
			? (typeof node === 'string' && nodesOf(it.data).has(node) ? node : (h.mmFocus()?.id === id ? h.mmFocus().key : mindTree(it).root))
			: undefined
		const open = openThreadOf(h.comments().threads, id, key)
		if (open !== null) {
			h.ui().onCommentOpen?.(open.id)
			return true
		}
		const c = cornerOf(this.liveCommentBox(id, key ?? null) ?? h.model().abs?.(id) ?? null)
		if (c === null) {
			return false
		}
		return this.composeComment(key === undefined ? { item: id, x: c.x, y: c.y } : { item: id, node: key, x: c.x, y: c.y })
	}

	/**
	 * The editor of a new thread opens at a place (nothing is saved before Send).
	 *
	 * @param {{item: (string|null), x: number, y: number}} place item or free point (world)
	 * @return {boolean}
	 */
	composeComment(place) {
		const h = this.h
		if (!this.mayComment() || !place || !Number.isFinite(place.x) || !Number.isFinite(place.y)) {
			return false
		}
		const node = typeof place.item === 'string' && typeof place.node === 'string' ? { node: place.node } : {}
		h.ui().onCommentCompose?.({ item: typeof place.item === 'string' ? place.item : null, ...node, x: place.x, y: place.y })
		return true
	}

	/**
	 * One comment call: the answer's thread (or deleted ids) counts at once;
	 * an error toasts and rejects.
	 *
	 * @param {(api: object) => Promise<object>} fn the call
	 * @return {Promise<object>} the answer
	 */
	async commentCall(fn) {
		const h = this.h
		const api = this.commentApi()
		if (!api || !this.mayComment()) {
			throw new HttpError(403, 'forbidden', 'No right to comment', null, true)
		}
		let res
		try {
			res = await fn(api)
		} catch (e) {
			this.commentError(e)
			throw e
		}
		if (res?.thread) {
			h.comments().take(res.thread)
		}
		if (Array.isArray(res?.deleted)) {
			h.comments().drop(res.deleted)
		}
		return res
	}

	/**
	 * @param {{text: string, item: (string|null), node?: (string|null), x: number, y: number}} o a new thread
	 *   (job 195: node, the node of a mind map item)
	 * @return {Promise<object>} the thread
	 */
	async createThread({ text, item = null, node = null, x, y }) {
		const on = typeof item === 'string' && typeof node === 'string' ? { node } : {}
		const res = await this.commentCall((api) => api.create({ text, x, y, item: typeof item === 'string' ? item : null, ...on }))
		return res.thread
	}

	/**
	 * @param {string} thread thread id
	 * @param {string} text reply (wire form)
	 * @return {Promise<object>} the thread
	 */
	async replyTo(thread, text) {
		return (await this.commentCall((api) => api.create({ text, thread }))).thread
	}

	/**
	 * @param {string} comment own comment
	 * @param {string} text new text (wire form)
	 * @return {Promise<object>} the thread
	 */
	async editComment(comment, text) {
		return (await this.commentCall((api) => api.update({ comment, text }))).thread
	}

	/**
	 * @param {string} thread thread id
	 * @param {boolean} resolved resolve (true) or reopen
	 * @return {Promise<object>} the thread
	 */
	async setResolved(thread, resolved) {
		return (await this.commentCall((api) => api.update({ comment: thread, resolved: resolved === true }))).thread
	}

	/**
	 * @param {string} comment comment (the first one takes its thread)
	 * @return {Promise<string[]>} deleted ids
	 */
	async deleteComment(comment) {
		return (await this.commentCall((api) => api.remove(comment))).deleted
	}

	/**
	 * The @ list (route 39, accounts with the right to write).
	 *
	 * @param {string} q query
	 * @return {Promise<{id: string, name: string}[]>} [] for guests and on errors
	 */
	async searchMentions(q) {
		const h = this.h
		const api = this.commentApi()
		if (h.mode() === 'guest' || typeof api?.mentions !== 'function' || !this.mayComment()) {
			return []
		}
		try {
			const res = await api.mentions(typeof q === 'string' ? q : '')
			return Array.isArray(res?.accounts) ? res.accounts.filter((a) => typeof a?.id === 'string' && typeof a?.name === 'string') : []
		} catch (e) {
			return []
		}
	}

	/**
	 * Toast of a failed comment call ([data-knorke-toast=comment-failed]).
	 *
	 * @param {unknown} e error
	 */
	commentError(e) {
		const h = this.h
		const code = e instanceof HttpError ? e.code : null
		const text = code === 'slow_down'
			? t('knorke', 'Too many comments at once. Please wait a moment.')
			: code === 'thread_resolved'
				? t('knorke', 'This thread was resolved meanwhile.')
				: code === 'comments_full'
					? t('knorke', 'This board has reached the most comments it can have.')
					: code === 'comment_too_long'
						? t('knorke', 'The comment is too long.')
						: code === 'not_found'
							? t('knorke', 'This comment no longer exists.')
							: t('knorke', 'Your comment could not be saved.')
		h.toast(text, { hook: 'comment-failed' })
	}

	/**
	 * Threads on items a commit removes keep their last top right corner
	 * (PATCH x/y; the deleting client sends it). Failures stay silent: the
	 * thread then stands at its former spot.
	 *
	 * @param {object[]} ops ops about to be sent
	 */
	commentsOnRemove(ops) {
		const h = this.h
		const api = this.commentApi()
		if (!api || !h.model() || h.comments().threads.length === 0 || !this.mayComment()) {
			return
		}
		const removed = new Set(ops.filter((op) => op?.o === 'remove' && typeof op.id === 'string').map((op) => op.id))
		if (removed.size === 0) {
			return
		}
		for (const th of h.comments().threads) {
			if (typeof th.item !== 'string' || !removed.has(th.item) || !h.model().has(th.item)) {
				continue
			}
			const c = cornerOf(h.model().abs?.(th.item) ?? null)
			if (c === null) {
				continue
			}
			Promise.resolve().then(() => api.update({ comment: th.id, x: c.x, y: c.y })).then((res) => {
				if (res?.thread) {
					h.comments().take(res.thread)
				}
			}, () => {})
		}
	}

	/**
	 * @param {string} item item id
	 * @param {string|null} [node] (job 195) the node of a mind map: its box as drawn (a hidden one: the nearest
	 *   node shown; a gone one: the root's)
	 * @return {{x: number, y: number, w: number, h: number, r: number}|null} its live box when a thread can hang on it
	 */
	liveCommentBox(item, node = null) {
		const h = this.h
		const it = h.model()?.has(item) ? h.model().get(item) : null
		if (!it || !canCommentOn(it.t)) {
			return null
		}
		if (it.t === 'mindmap' && typeof node === 'string') {
			const key = visibleAncestor(it, node) ?? mindTree(it).root
			const box = key !== null ? h.scene()?.nodeBox?.(item, key) ?? null : null
			if (box) {
				return box
			}
		}
		return h.model().abs?.(item) ?? null
	}

	/** @return {{x: number, y: number, scale: number}|null} the camera the user sees now */
	liveCameraNow() {
		const h = this.h
		const sc = h.scene()
		let c = null
		try {
			c = typeof sc?.liveCamera === 'function' ? sc.liveCamera() : sc?.getCamera?.() ?? null
		} catch (e) {
			c = null
		}
		return c && Number.isFinite(c.x) && Number.isFinite(c.y) && c.scale > 0 ? c : null
	}

	/**
	 * The bubbles of the open threads on screen now (container px of their
	 * centres): the live camera and the live model (a drag or resize moves them).
	 *
	 * @return {{id: string, n: number, x: number, y: number}[]}
	 */
	commentPlaces() {
		const h = this.h
		const cam = this.liveCameraNow()
		return cam ? bubblePlaces(bubbleAnchors(h.comments().threads, (id, node) => this.liveCommentBox(id, node)), cam) : []
	}

	/**
	 * The world anchor of a thread: its bubble's place (an open thread), else
	 * its item's corner or its x/y.
	 *
	 * @param {string} id thread id
	 * @return {{x: number, y: number}|null}
	 */
	threadAnchor(id) {
		const h = this.h
		const th = h.comments().get(id)
		if (!th) {
			return null
		}
		const c = typeof th.item === 'string' ? cornerOf(this.liveCommentBox(th.item, typeof th.node === 'string' ? th.node : null)) : null
		return c ?? (Number.isFinite(th.x) && Number.isFinite(th.y) ? { x: th.x, y: th.y } : null)
	}

	/**
	 * The screen place (container px) of a thread's bubble, or of a world
	 * point (the editor of a new thread on an item follows the item).
	 *
	 * @param {{thread?: string, item?: (string|null), x?: number, y?: number}} o what
	 * @return {{x: number, y: number}|null}
	 */
	commentScreen(o) {
		const cam = this.liveCameraNow()
		if (!cam || !o) {
			return null
		}
		if (typeof o.thread === 'string') {
			const p = this.commentPlaces().find((b) => b.id === o.thread)
			if (p) {
				return { x: p.x, y: p.y }
			}
			const a = this.threadAnchor(o.thread)
			return a ? { x: (a.x - cam.x) * cam.scale, y: (a.y - cam.y) * cam.scale } : null
		}
		const c = typeof o.item === 'string' ? cornerOf(this.liveCommentBox(o.item, typeof o.node === 'string' ? o.node : null)) : null
		const w = c ?? (Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: o.x, y: o.y } : null)
		return w ? { x: (w.x - cam.x) * cam.scale, y: (w.y - cam.y) * cam.scale } : null
	}

	/**
	 * Pans (same zoom) so that a world point lands in the middle of the free
	 * part of the canvas (covered screen px at the left and right edge).
	 *
	 * @param {{x: number, y: number}} w world point
	 * @param {{left?: number, right?: number}} [reserve] covered edges
	 * @return {boolean}
	 */
	centerOn(w, { left = 0, right = 0 } = {}) {
		const h = this.h
		const sc = h.scene()
		const cam = sc?.getCamera?.()
		const vp = sc?.getViewport?.()
		if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y) || !cam || !(cam.scale > 0) || !vp) {
			return false
		}
		const W = vp.w * cam.scale
		const H = vp.h * cam.scale
		const l = Number.isFinite(left) && left > 0 ? left : 0
		const r = Number.isFinite(right) && right > 0 ? right : 0
		const sx = W - l - r > 0 ? l + (W - l - r) / 2 : W / 2
		h.follower()?.stop('user')
		sc.setCamera({ x: w.x - sx / cam.scale, y: w.y - H / 2 / cam.scale, scale: cam.scale })
		return true
	}

	// ---- job 171: laser pointer -------------------------------------------

	/**
	 * (Job 171) A point of the own laser stroke from the scene (world), or null
	 * at its end (header): stored with now(), a point less than
	 * LASER_MIN_GAP_MS after the last stored one only moves it; every point
	 * pokes the sync loop.
	 *
	 * @param {{x: number, y: number}|null} p point or null
	 */
	laserPoint(p) {
		const h = this.h
		if (p === null || p === undefined) {
			h.set('laserEnded', true)
			return
		}
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
			return
		}
		const now = h.now()
		const x = r1(p.x)
		const y = r1(p.y)
		const last = h.laser().length > 0 ? h.laser()[h.laser().length - 1] : null
		if (h.laserEnded()) {
			h.set('laserEnded', false)
			if (last !== null) {
				h.laser().push(null)
			}
			h.laser().push([x, y, now])
		} else if (last !== null && now - last[2] < LASER_MIN_GAP_MS) {
			last[0] = x
			last[1] = y
		} else {
			h.laser().push([x, y, now])
		}
		// what can never go out again goes
		while (h.laser().length > 0 && (h.laser()[0] === null || now - h.laser()[0][2] > LASER_WINDOW_MS)) {
			h.laser().shift()
		}
		h.sync()?.poke()
	}

	/**
	 * (Job 171) me.l (header): the laser points of the last LASER_WINDOW_MS,
	 * at most the newest LASER_WIRE_MAX elements, as [x, y, d] (d = whole ms
	 * from the point to now), oldest first, null only between two strokes.
	 *
	 * @return {Array<[number, number, number]|null>|null} l, or null without a point in the window
	 */
	laserWire() {
		const h = this.h
		const now = h.now()
		const out = []
		for (const p of h.laser()) {
			if (p === null) {
				if (out.length > 0 && out[out.length - 1] !== null) {
					out.push(null)
				}
			} else if (now - p[2] <= LASER_WINDOW_MS) {
				out.push([p[0], p[1], Math.max(0, Math.round(now - p[2]))])
			}
		}
		let l = out.slice(-LASER_WIRE_MAX)
		while (l.length > 0 && l[0] === null) {
			l = l.slice(1)
		}
		while (l.length > 0 && l[l.length - 1] === null) {
			l = l.slice(0, -1)
		}
		return l.length > 0 ? l : null
	}
}
