/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * The tags of a board session (factory job 191, undo job 206, shown colours
 * job 227; factory job 257 moved them out of BoardSession.js): the board's
 * tag list (meta.tags), the tag panel, the "+n" list and the filter panel
 * (TagPanels.vue through ui.onTags), this tab's filter, ticking, creating,
 * renaming, recolouring and deleting tags (routes 44/45, transport.tags),
 * retag and the tags of pasted notes. The methods run on the session's
 * state through the host callbacks of the constructor (the pattern of
 * SessionComments, sessionComments.js). BoardSession keeps a thin method of
 * the same name for each one (BoardView, the menus and the tests call them
 * on the session) and keeps undo and redo of a tag step (recordTagStep,
 * sendTagHistory); this module never imports BoardSession.js. Every
 * callback reads the session at the time of the call; the state (tagFilter,
 * tagPanel, tagBusy) stays a field of the session, written through h.set
 * (the set undoPending is changed in place).
 */
import { isLocked } from '../model/locks.js'
import { ulid } from '../model/ids.js'
import { TAGS_PER_BOARD, TAGS_PER_NOTE, cleanTagName, findTagByName, nextTagColor, noteTagIds, planPasteTags, sortTags, tagCounts, tagMap, tagPatch, tagState, tagsOf } from '../model/tags.js'
import { TAG_COLORS, shownColor } from '../model/tokens.js'
import { HttpError } from '../sync/http.js'
import { t } from '../util/l10n.js'
import { canEdit } from './mode.js'
import { metaMapOf, modelItems } from './sessionConsts.js'

/** The session's fields the host gives as functions without arguments (read at the call). */
export const TAGS_STATE = Object.freeze(['board', 'clientMode', 'deps', 'destroyed', 'frozen', 'me', 'model', 'scene', 'selection', 'sync', 'tagBusy', 'tagFilter', 'tagPanel', 'transport', 'ui', 'undoPending'])

/** The session's methods the host hands over under the same name (looked up on the session at the call). */
export const TAGS_CALLS = Object.freeze(['cameraNow', 'commit', 'flushVisible', 'focusCanvas', 'guard', 'info', 'onMeta', 'recordTagStep', 'select', 'toast', 'unlockedOf'])

/** The session's fields this module may write (h.set). */
export const TAGS_SETS = Object.freeze(['tagBusy', 'tagFilter', 'tagPanel'])

/**
 * @param {unknown} rect a box of the shell (board px)
 * @return {{x: number, y: number, w: number, h: number}|null}
 */
export function tagRect(rect) {
	return rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null
}

export class SessionTags {
	/**
	 * @param {object} h host: one function per name of TAGS_STATE and TAGS_CALLS, plus
	 *   set(k, v) for the names of TAGS_SETS
	 */
	constructor(h) {
		this.h = h
	}

	/** @return {object|null} the tag calls of the transport (tests: deps.tags) */
	tagApi() {
		const h = this.h
		return h.deps().tags ?? h.transport()?.tags ?? null
	}

	/** @return {Array<{id: string, name: string, color: string}>} the board's tags (meta.tags, cleaned) */
	boardTags() {
		const h = this.h
		return tagsOf(metaMapOf(h.board()?.meta))
	}

	/** @return {boolean} this person may tag notes and manage the tag list now (canEdit(me.role), not frozen) */
	mayTag() {
		const h = this.h
		return !h.frozen() && !h.destroyed() && canEdit(h.me()?.role)
	}

	/** @return {object[]} the notes the tag panel works on: the unlocked selected notes, in mode edit */
	tagTargets() {
		const h = this.h
		if (h.clientMode() !== 'edit' || !h.model()) {
			return []
		}
		return h.unlockedOf(h.selection()).map((id) => h.model().get(id)).filter((it) => it?.t === 'sticky')
	}

	/** The board's tags to the scene; a deleted tag leaves the filter; the shell's view follows. */
	pushTags() {
		const h = this.h
		const list = this.boardTags()
		try {
			h.scene()?.setTags?.(list)
		} catch (e) {
			console.error('[knorke] scene.setTags failed', e)
		}
		const known = new Set(list.map((tg) => tg.id))
		if (h.tagFilter().some((id) => !known.has(id))) {
			this.setTagFilter(h.tagFilter().filter((id) => known.has(id)))
		}
		if (h.tagPanel()?.kind === 'filter' && list.length === 0) {
			h.set('tagPanel', null)
		}
		this.emitTags()
	}

	/**
	 * What the shell shows (TagPanels.vue): the tags by name with their count
	 * of notes and, while the tag panel is open, their state on its notes;
	 * the filter; the open panel.
	 * (Job 227) Each tag's colour as it is drawn (tokens.shownColor).
	 *
	 * @return {{tags: object[], mayEdit: boolean, edit: boolean, filter: string[], busy: boolean, panel: (object|null)}}
	 */
	tagsView() {
		const h = this.h
		const list = this.boardTags()
		const byId = tagMap(list)
		const p = h.tagPanel()
		const targets = p?.kind === 'tag' ? this.tagTargets() : []
		const counts = h.model() ? tagCounts(modelItems(h.model()), byId) : new Map()
		let panel = null
		if (p !== null) {
			const note = p.kind === 'list' ? h.model()?.get(p.id) ?? null : null
			panel = {
				kind: p.kind,
				id: p.id ?? null,
				rect: p.rect ? { ...p.rect } : null,
				targets: targets.length,
				list: note ? noteTagIds(note, byId).map((id) => ({ ...byId.get(id) })) : [],
			}
		}
		return {
			tags: sortTags(list).map((tg) => ({ ...tg, color: shownColor(tg.color), count: counts.get(tg.id) ?? 0, state: p?.kind === 'tag' ? tagState(targets, tg.id, byId) : 'off' })),
			mayEdit: this.mayTag(),
			edit: h.clientMode() === 'edit' && this.mayTag(),
			filter: [...h.tagFilter()],
			busy: h.tagBusy(),
			panel,
		}
	}

	emitTags() {
		const h = this.h
		h.ui().onTags?.(this.tagsView())
	}

	/**
	 * "Tags" of the context bar and the context menu: the panel for the
	 * unlocked selected notes (mode edit, this person may edit).
	 *
	 * @param {{x: number, y: number, w: number, h: number}|null} [rect] the button or the menu's point (board px)
	 * @return {boolean} it opened
	 */
	openTagPanel(rect = null) {
		const h = this.h
		if (!this.mayTag() || this.tagTargets().length === 0) {
			return false
		}
		h.set('tagPanel', { kind: 'tag', rect: tagRect(rect) })
		this.emitTags()
		return true
	}

	/**
	 * "Filter by tags…" of the board menu "⋯": every person, every mode, once the board has tags.
	 *
	 * @return {boolean} it opened
	 */
	openTagFilter() {
		const h = this.h
		if (h.destroyed() || this.boardTags().length === 0) {
			return false
		}
		h.set('tagPanel', { kind: 'filter', rect: null })
		this.emitTags()
		return true
	}

	/**
	 * The scene's tagList (a tap on "+n", every mode): the list of the note's tags.
	 *
	 * @param {string} id note
	 * @param {{x: number, y: number, w: number, h: number}|null} rect "+n" (container px)
	 * @return {boolean} it opened
	 */
	openTagList(id, rect) {
		const h = this.h
		if (typeof id !== 'string' || h.model()?.get(id)?.t !== 'sticky') {
			return false
		}
		h.set('tagPanel', { kind: 'list', id, rect: tagRect(rect), cam: h.cameraNow() })
		this.emitTags()
		return true
	}

	/**
	 * Closes the open tag panel (its Esc, its close button, a rule of checkTags).
	 *
	 * @param {{focus?: boolean}} [o] focus: the canvas gets the focus (Esc, a pointer beside it)
	 */
	closeTagPanel({ focus = true } = {}) {
		const h = this.h
		if (h.tagPanel() === null) {
			return
		}
		h.set('tagPanel', null)
		this.emitTags()
		if (focus) {
			h.focusCanvas()
		}
	}

	/** After a selection or model change: the panel follows (or closes when its notes or note are gone). */
	checkTags() {
		const h = this.h
		const p = h.tagPanel()
		if (p === null) {
			return
		}
		if ((p.kind === 'tag' && this.tagTargets().length === 0) || (p.kind === 'list' && h.model()?.get(p.id)?.t !== 'sticky')) {
			this.closeTagPanel({ focus: false })
			return
		}
		this.emitTags()
	}

	/**
	 * A click on a tag's box in the panel: off or mixed gives every note of
	 * the panel the tag, on takes it from all; one undo step; a note that has
	 * TAGS_PER_NOTE tags is skipped with the hint tag-full.
	 *
	 * @param {string} tagId tag
	 * @param {boolean|null} [on] tick (true), untick (false), or (null) by the box's state
	 * @param {object|null} [made] (job 206) the tag part of creating it: the ticking and it are one step
	 * @return {boolean} an op went out
	 */
	tickTag(tagId, on = null, made = null) {
		const h = this.h
		const byId = tagMap(this.boardTags())
		const targets = this.mayTag() && h.clientMode() === 'edit' && h.model() && h.sync() ? this.tagTargets() : []
		if (targets.length === 0 || !byId.has(tagId)) {
			h.recordTagStep(made)
			return false
		}
		const tick = on === null ? tagState(targets, tagId, byId) !== 'on' : on === true
		const r = tagPatch(targets, tagId, tick, byId)
		if (r.ops.length > 0) {
			h.guard(() => h.commit(r, { urgent: true, tag: made }))
		} else {
			h.recordTagStep(made)
		}
		if (r.full > 0) {
			h.info(t('knorke', 'A note can have at most 8 tags.'), { hook: 'tag-full' })
		}
		this.emitTags()
		return r.ops.length > 0
	}

	/**
	 * Enter in the panel's search field or "Create “…”": an existing name is
	 * ticked; otherwise route 44/45 adds a tag with the next free colour and,
	 * after its answer, the panel's notes get it (job 206: creating and
	 * ticking are one undo step; undo takes the tag off the notes and out of
	 * the list). A failure or a full list: a hint, nothing ticked.
	 *
	 * @param {string} name the typed name
	 * @return {Promise<boolean>} the notes got the tag
	 */
	async createTag(name) {
		const h = this.h
		const clean = cleanTagName(name)
		if (clean === null || !this.mayTag() || h.clientMode() !== 'edit') {
			return false
		}
		const list = this.boardTags()
		const have = findTagByName(list, clean)
		if (have !== null) {
			return this.tickTag(have.id, true)
		}
		if (list.length >= TAGS_PER_BOARD) {
			h.info(t('knorke', 'A board can have at most {max} tags.', { max: TAGS_PER_BOARD }), { hook: 'tag-limit' })
			return false
		}
		const id = ulid()
		const ok = await this.saveTags({ action: 'add', tags: [{ id, name: clean, color: nextTagColor(list) }] })
		if (!ok || h.destroyed()) {
			return false
		}
		// the new tag by its id (a database without 4-byte UTF-8 stores an emoji of the name as
		// U+FFFD); the server skips a name someone else just took: that tag, by the name as sent
		// or as such a database stores it
		const now = this.boardTags()
		const made = now.find((tg) => tg.id === id) ?? findTagByName(now, clean) ?? findTagByName(now, clean.replace(/[\u{10000}-\u{10FFFF}]/gu, '\uFFFD'))
		if (made === undefined || made === null) {
			return false
		}
		// job 206: only a tag this call created belongs to the step
		return this.tickTag(made.id, true, made.id === id ? { id, before: null, after: { ...made } } : null)
	}

	/**
	 * @param {string} id tag
	 * @param {string} name new name
	 * @return {Promise<boolean>} saved
	 */
	async renameTag(id, name) {
		const h = this.h
		const clean = cleanTagName(name)
		if (clean === null) {
			return false
		}
		const other = findTagByName(this.boardTags(), clean)
		if (other !== null && other.id !== id) {
			h.info(t('knorke', 'A tag with this name already exists.'), { hook: 'tag-exists' })
			return false
		}
		return this.changeTag(id, { action: 'update', tag: id, name: clean })
	}

	/**
	 * @param {string} id tag
	 * @param {string} color one of TAG_COLORS
	 * @return {Promise<boolean>} saved
	 */
	recolorTag(id, color) {
		return TAG_COLORS.includes(color) ? this.changeTag(id, { action: 'update', tag: id, color }) : Promise.resolve(false)
	}

	/**
	 * "Delete tag" (job 206: without a question, undo brings it back): the
	 * tag leaves the list and so every note; its id stays on them.
	 *
	 * @param {string} id tag
	 * @return {Promise<boolean>} saved
	 */
	deleteTag(id) {
		return this.changeTag(id, { action: 'delete', tag: id }, { notes: this.notesWithTag(id) })
	}

	/**
	 * Job 206: one write of the tag list that is an undo step of its own: the
	 * tag before the write and after its answer, as meta.tags stores it (no
	 * step when nothing changed).
	 *
	 * @param {string} id tag
	 * @param {object} body {action, \u2026} of saveTags
	 * @param {{notes?: string[]}} [extra] a delete's notes that carried the tag
	 * @return {Promise<boolean>} saved
	 */
	async changeTag(id, body, extra = {}) {
		const h = this.h
		const before = this.tagById(id)
		const ok = await this.saveTags(body)
		if (ok && !h.destroyed()) {
			const after = this.tagById(id)
			if (JSON.stringify(before) !== JSON.stringify(after)) {
				h.recordTagStep({ id, before, after, ...extra })
			}
		}
		return ok
	}

	/**
	 * @param {string} id tag
	 * @return {{id: string, name: string, color: string}|null} that tag of meta.tags (a copy) or null
	 */
	tagById(id) {
		const tg = this.boardTags().find((x) => x.id === id)
		return tg ? { id: tg.id, name: tg.name, color: tg.color } : null
	}

	/**
	 * @param {string} id tag
	 * @return {string[]} the notes whose data.tags holds the id (also of a deleted tag)
	 */
	notesWithTag(id) {
		const h = this.h
		return h.model() ? [...h.model().ids()].filter((x) => {
			const it = h.model().get(x)
			return it?.t === 'sticky' && Array.isArray(it.data?.tags) && it.data.tags.includes(id)
		}) : []
	}

	/**
	 * Job 206: a restored deleted tag on the notes that carried it and lost
	 * its id meanwhile (their tags were written again): one patch each, its
	 * known tags plus the id at the end; not on deleted or locked notes nor
	 * on notes with TAGS_PER_NOTE tags. Part of the undo, no step of its own.
	 *
	 * @param {string} id the restored tag
	 * @param {string[]} notes the notes that carried it when it was deleted
	 */
	retag(id, notes) {
		const h = this.h
		if (!h.model() || !h.sync()) {
			return
		}
		const byId = tagMap(this.boardTags())
		const ops = []
		for (const nid of notes) {
			const it = h.model().get(nid)
			if (it?.t !== 'sticky' || isLocked(it) || (Array.isArray(it.data?.tags) && it.data.tags.includes(id))) {
				continue
			}
			const known = noteTagIds(it, byId)
			if (known.length < TAGS_PER_NOTE) {
				ops.push({ o: 'patch', id: nid, p: { 'data.tags': [...known, id] } })
			}
		}
		if (ops.length > 0) {
			const ids = h.sync().enqueue(ops, { urgent: true })
			for (const x of ids) {
				h.undoPending().add(x)
			}
			h.flushVisible(ids)
		}
	}

	/**
	 * One write of the tag list (route 44, guests 45); the answer takes the
	 * onMeta path. Errors give a hint (quiet: none, the caller tells).
	 *
	 * @param {object} body {action, …}
	 * @param {{quiet?: boolean}} [o] options
	 * @return {Promise<boolean>} written (or nothing to write)
	 */
	async saveTags(body, { quiet = false } = {}) {
		const h = this.h
		const api = this.tagApi()
		if (!api || typeof api.save !== 'function' || !this.mayTag()) {
			return false
		}
		h.set('tagBusy', true)
		this.emitTags()
		try {
			const res = await api.save(body)
			if (h.destroyed()) {
				return false
			}
			if (res?.board) {
				h.onMeta(res.board)
			}
			return true
		} catch (e) {
			if (!quiet && !h.destroyed()) {
				this.tagFailed(e)
			}
			return false
		} finally {
			h.set('tagBusy', false)
			if (!h.destroyed()) {
				this.emitTags()
			}
		}
	}

	/**
	 * @param {unknown} e the error of a tag write
	 */
	tagFailed(e) {
		const h = this.h
		const code = e instanceof HttpError ? e.code : null
		if (code === 'tag_limit') {
			h.info(t('knorke', 'A board can have at most {max} tags.', { max: TAGS_PER_BOARD }), { hook: 'tag-limit' })
		} else if (code === 'tag_exists') {
			h.info(t('knorke', 'A tag with this name already exists.'), { hook: 'tag-exists' })
		} else if (code === 'tag_gone') {
			h.info(t('knorke', 'This tag no longer exists.'), { hook: 'tag-gone' })
		} else {
			h.toast(t('knorke', 'The tag could not be saved.'), { hook: 'tag-failed' })
		}
	}

	/**
	 * This tab's tag filter (never sent): the notes without one of the tags fade.
	 *
	 * @param {string[]} ids chosen tags (unknown ones are dropped; []: no filter)
	 */
	setTagFilter(ids) {
		const h = this.h
		const known = new Set(this.boardTags().map((tg) => tg.id))
		h.set('tagFilter', [...new Set((Array.isArray(ids) ? ids : []).filter((id) => known.has(id)))])
		try {
			h.scene()?.setTagFilter?.(h.tagFilter().length > 0 ? [...h.tagFilter()] : null)
		} catch (e) {
			console.error('[knorke] scene.setTagFilter failed', e)
		}
		this.emitTags()
	}

	/** @param {string} id a tag of the filter panel: chosen or not */
	toggleTagFilter(id) {
		const h = this.h
		this.setTagFilter(h.tagFilter().includes(id) ? h.tagFilter().filter((x) => x !== id) : [...h.tagFilter(), id])
	}

	/**
	 * "Select all with this tag" (filter panel, mode edit): every unlocked note with the tag, like Ctrl/⌘+A.
	 *
	 * @param {string} id tag
	 * @return {boolean} selected
	 */
	selectWithTag(id) {
		const h = this.h
		const byId = tagMap(this.boardTags())
		if (h.clientMode() !== 'edit' || h.frozen() || !h.model() || !byId.has(id)) {
			return false
		}
		h.select(h.unlockedOf([...h.model().ids()]).filter((x) => noteTagIds(h.model().get(x), byId).includes(id)))
		this.closeTagPanel()
		return true
	}

	/**
	 * The events of TagPanels.vue.
	 *
	 * @param {string} name tick | create | rename | recolor | delete | filter | clear-filter | select | close | open-filter
	 * @param {...any} args its arguments
	 * @return {unknown} what the action returns
	 */
	tagAction(name, ...args) {
		switch (name) {
		case 'tick': return this.tickTag(args[0])
		case 'create': return this.createTag(args[0])
		case 'rename': return this.renameTag(args[0], args[1])
		case 'recolor': return this.recolorTag(args[0], args[1])
		case 'delete': return this.deleteTag(args[0])
		case 'filter': return this.toggleTagFilter(args[0])
		case 'clear-filter': return this.setTagFilter([])
		case 'select': return this.selectWithTag(args[0])
		case 'open-filter': return this.openTagFilter()
		case 'close': return this.closeTagPanel({ focus: args[0] !== false })
		default: return false
		}
	}

	/**
	 * (Job 191) The tags of pasted notes (copy, duplicate, board file, own
	 * template): model/tags.js planPasteTags; the missing ones are created
	 * with ONE add before the notes go out (run waits for its answer). A
	 * failed add pastes the notes without these tags, with the hint
	 * tags-not-created; so do tags beyond the board's limit.
	 *
	 * @param {object} payload validated payload (tags)
	 * @param {(tagMap: Map<string, string>) => boolean|void} run pastes with the map
	 * @return {boolean} run's answer (synchronous) or true (it runs after the add)
	 */
	withPasteTags(payload, run) {
		const h = this.h
		const plan = planPasteTags(payload?.tags, this.boardTags())
		const finish = (map, failed) => {
			const out = run(map)
			if (failed || plan.dropped > 0) {
				h.toast(t('knorke', 'Some tags could not be created.'), { hook: 'tags-not-created' })
			}
			return out
		}
		if (plan.add.length === 0) {
			return finish(plan.map, false) !== false
		}
		const added = new Set(plan.add.map((tg) => tg.id))
		this.saveTags({ action: 'add', tags: plan.add }, { quiet: true }).then((ok) => {
			if (h.destroyed() || !h.model()) {
				return
			}
			// each new tag as the board has it now: its id, else the tag of its name
			const now = this.boardTags()
			const byId = tagMap(now)
			const map = new Map()
			let failed = !ok
			for (const [from, to] of plan.map) {
				if (!added.has(to)) {
					map.set(from, to)
					continue
				}
				const name = plan.add.find((tg) => tg.id === to).name
				const have = ok ? (byId.has(to) ? to : findTagByName(now, name)?.id ?? null) : null
				if (have !== null) {
					map.set(from, have)
				} else {
					failed = true
				}
			}
			h.guard(() => finish(map, failed))
		})
		return true
	}
}
