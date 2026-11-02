/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Comments (factory job 189), the client side:
 * - AK3: the session loads the threads (GET routes 35/40) for a snapshot
 *   with meta.comments and for every change of the value, never without the
 *   key, with at most one load at a time and exactly one more after a
 *   change during it; a meta change in comments alone touches neither the
 *   vote state nor following.
 * - AK6: the pure rules of board/comments.js (where a bubble goes: the
 *   corner of the rotated item's hull, the free spot, side by side; the
 *   order and numbers of the list; parts only as text; the @ helpers),
 *   "Comment" in the context bar and the menu only for exactly one item of
 *   the five types in mode edit (and in the menu of the empty canvas), and
 *   the exports (exportPlan/exportIds, the CSV rows, the board file) the
 *   same with and without threads.
 * - The session's comment actions: the own answer counts at once, a
 *   deleted item's thread gets PATCH x/y with the item's last corner (undo
 *   hangs it on the item again), "New comment" picks without selecting.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoardSession, onlyCommentsChanged } from '../../../src/board/BoardSession.js'
import { boardFileText } from '../../../src/board/boardFile.js'
import {
	BUBBLE_DROP_PX, BUBBLE_GAP_PX, BUBBLE_PX, BUBBLE_SIDE_PX, COMMENT_TYPES, CommentFeed, bubbleAnchors, bubblePlaces, commentableIds, cornerOf, fromWire, insertMention,
	listEntries, mentionQuery, openThreadOf, partsText, partsView, pickItem, rectsOverlap, tabCounts, threadPlace, timeLabel, toWire,
	THREAD_EDGE, THREAD_GAP, THREAD_MAX_H, THREAD_ROOM, THREAD_W,
} from '../../../src/board/comments.js'
import { VOTE_BADGE_PX, VOTE_DOT_BORDER_PX } from '../../../src/model/tokens.js'
import { csvRows } from '../../../src/board/exportCsv.js'
import { menuEntries } from '../../../src/components/contextbar.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { exportIds, exportPlan } from '../../../src/scene/exportImage.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeModel, FakeScene, ID, connector, frame, memoryStorage, shape, sticky, textItem } from './fakes.mjs'

const A = ID(1)
const B = ID(2)
const C = ID(3)
const F = ID(4)
const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VERA = { pid: 'pidvera000000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }

/** A promise with its resolve outside. */
function deferred() {
	let resolve
	const p = new Promise((r) => { resolve = r })
	return { p, resolve }
}

/** @return {object} a thread of the wire form */
function thread(id, { item = null, x = 0, y = 0, resolved = false, comments = null } = {}) {
	return { id, item, x, y, resolved, comments: comments ?? [{ id, name: 'Alice Adler', guest: false, pid: 'p1', mine: true, parts: ['Hi ' + id], at: 1000, edited: null }] }
}

class PickScene extends FakeScene {
	setPick(on) {
		this.pick = on === true
		this.log('setPick', on === true)
	}

	liveCamera() {
		return { ...this.camera }
	}

	getViewport() {
		return { x: this.camera.x, y: this.camera.y, w: 1000 / this.camera.scale, h: 600 / this.camera.scale }
	}
}

/**
 * A session on a fake transport and a fake comment API (deps.comments).
 *
 * @param {object} [o] options
 * @return {Promise<object>} harness
 */
async function open({ meta = {}, me = ALICE, items = [sticky(A, { z: 'a1' }), sticky(B, { x: 400, z: 'a2' }), connector(C, { item: A }, { item: B }), frame(F, { x: 2000, z: 'a0' })], threads = [], list = null, Model = FakeModel } = {}) {
	const clock = new FakeClock(10000)
	const ui = { comments: [], votes: [], follow: [], compose: [], open: [], picks: [], selection: [] }
	const toasts = []
	let rev = 5
	const api = {
		calls: [],
		threads,
		async list() {
			api.calls.push(['list'])
			return list ? list() : { threads: api.threads }
		},
		async create(body) {
			api.calls.push(['create', body])
			const th = body.thread
				? { ...api.threads.find((t) => t.id === body.thread), comments: [...api.threads.find((t) => t.id === body.thread).comments, { id: '99', name: 'Alice Adler', guest: false, pid: 'p1', mine: true, parts: [body.text], at: 2000, edited: null }] }
				: thread('50', { item: body.item, x: body.x, y: body.y })
			return { thread: th }
		},
		async update(body) {
			api.calls.push(['update', body])
			const t0 = api.threads.find((t) => t.id === body.comment) ?? thread(body.comment)
			return { thread: { ...t0, ...(body.resolved === undefined ? {} : { resolved: body.resolved }), ...(body.x === undefined ? {} : { x: body.x, y: body.y }) } }
		},
		async remove(id) {
			api.calls.push(['remove', id])
			return { deleted: [id] }
		},
		async mentions(q) {
			api.calls.push(['mentions', q])
			return { accounts: [{ id: 'bob', name: 'Bob Berg' }] }
		},
	}
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Board', role: me.role, metaRev: 3, meta }, me, items }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) {
				return {}
			}
			tr.calls.push(structuredClone(body))
			const res = { rev: body.since, presence: {} }
			if (body.ops) {
				rev = Math.max(rev, body.since) + 1
				res.acks = { seq: body.seq, rev, res: body.ops.map(() => 'ok') }
				res.rev = rev
			}
			return res
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) },
		mode: 'user',
		boardId: 7,
		ui: {
			onComments: (x) => ui.comments.push(x),
			onVotes: (x) => ui.votes.push(x),
			onFollow: (x) => ui.follow.push(x),
			onCommentCompose: (x) => ui.compose.push(x),
			onCommentOpen: (x) => ui.open.push(x),
			onCommentPick: (x) => ui.picks.push(x),
			onSelection: (x) => ui.selection.push(x),
		},
		deps: {
			SceneModel: Model,
			SceneManager: PickScene,
			transport: tr,
			comments: api,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => toasts.push(o?.hook ? [m, o.hook] : m),
			info: () => {},
			wall: () => T0 - 10000 + clock.now(),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, ui, toasts, api, scene: s.scene, model: s.model }
}

const lists = (h) => h.api.calls.filter((c) => c[0] === 'list').length

// ---- AK3: live -------------------------------------------------------------

test('AK3: a snapshot with meta.comments loads the threads once; without the key never', async () => {
	const h = await open({ meta: { comments: 4 }, threads: [thread('5', { item: A })] })
	assert.equal(lists(h), 1, 'the snapshot carries the key')
	assert.equal(h.s.comments.loaded, true)
	assert.deepEqual(h.s.comments.threads.map((t) => t.id), ['5'])
	assert.deepEqual(h.ui.comments.at(-1).threads.map((t) => t.id), ['5'], 'ui.onComments got them')
	const none = await open({ meta: {} })
	assert.equal(lists(none), 0, 'no key, no GET')
	none.s.onMeta({ metaRev: 4, meta: { timer: null } })
	assert.equal(lists(none), 0, 'a meta change without the key: still no GET')
	none.s.onMeta({ metaRev: 5, meta: { comments: 1 } })
	await none.clock.advance(0)
	assert.equal(lists(none), 1, 'the first comment brings the key')
	h.s.destroy()
	none.s.destroy()
})

test('AK3: every change of meta.comments loads; the same value does not; at most one load at a time, exactly one more after a change during it', async () => {
	const gates = []
	const h = await open({ meta: { comments: 1 }, list: () => { const d = deferred(); gates.push(d); return d.p } })
	assert.equal(lists(h), 1)
	h.s.onMeta({ metaRev: 4, meta: { comments: 2 } })
	h.s.onMeta({ metaRev: 5, meta: { comments: 3 } })
	h.s.onMeta({ metaRev: 6, meta: { comments: 4 } })
	assert.equal(lists(h), 1, 'one load runs: no second one in parallel')
	gates[0].resolve({ threads: [thread('5')] })
	await h.clock.advance(0)
	assert.equal(lists(h), 2, 'the changes during it: exactly one more load')
	gates[1].resolve({ threads: [thread('5'), thread('6')] })
	await h.clock.advance(0)
	assert.equal(lists(h), 2, 'nothing changed meanwhile: no third load')
	assert.deepEqual(h.s.comments.threads.map((t) => t.id), ['5', '6'])
	h.s.onMeta({ metaRev: 7, meta: { comments: 4 } })
	await h.clock.advance(0)
	assert.equal(lists(h), 2, 'the same value: no load')
	h.s.onMeta({ metaRev: 8, meta: { comments: 5 } })
	await h.clock.advance(0)
	assert.equal(lists(h), 3)
	gates[2].resolve({ threads: [] })
	await h.clock.advance(0)
	h.s.destroy()
})

test('AK3: a meta change in comments alone touches neither the vote state nor following; the other values keep their objects', async () => {
	const vote = { sid: 12, state: 'open', cfg: { per: 3, perItem: 1, scope: null, types: ['sticky'] }, startedAt: T0, endsAt: null, by: 'Alice Adler', show: false }
	const timer = { state: 'running', dur: 60000, end: T0 + 60000, left: null, by: 'Alice Adler', seq: 1 }
	const summon = { pid: 'pidother00000001', client: 'cOther', name: 'Otto', seq: 1, at: T0 }
	const h = await open({ meta: { vote, timer, summon, comments: 1 } })
	const votes = h.ui.votes.length
	const follow = h.ui.follow.length
	const before = h.s.board.meta
	h.s.onMeta({ metaRev: 4, meta: { vote: structuredClone(vote), timer: structuredClone(timer), summon: structuredClone(summon), comments: 2 } })
	await h.clock.advance(0)
	assert.equal(h.ui.votes.length, votes, 'no votes event: VoteState untouched')
	assert.equal(h.ui.follow.length, follow, 'no follow event')
	assert.equal(h.s.board.meta.comments, 2)
	assert.equal(h.s.board.meta.vote, before.vote, 'the vote object is the same one')
	assert.equal(h.s.board.meta.timer, before.timer, 'the timer object is the same one (no new timer, no sound)')
	assert.equal(h.s.board.meta.summon, before.summon)
	assert.equal(lists(h), 2, 'the comments load')
	// any other change goes the usual way
	h.s.onMeta({ metaRev: 5, meta: { vote: { ...vote, show: true }, timer, summon, comments: 3 } })
	assert.ok(h.ui.votes.length > votes, 'a vote change still reaches VoteState')
	assert.equal(onlyCommentsChanged({ a: 1, comments: 1 }, { a: 1, comments: 2 }), true)
	assert.equal(onlyCommentsChanged({ a: 1, comments: 1 }, { a: 2, comments: 2 }), false)
	assert.equal(onlyCommentsChanged({ a: 1 }, { a: 1, b: 1, comments: 2 }), false)
	assert.equal(onlyCommentsChanged({ comments: 2 }, { comments: 2 }), false)
	h.s.destroy()
})

test('AK3: CommentFeed alone – no key no load, an own answer counts at once and a load that started before it is repeated', async () => {
	const gates = []
	let changes = 0
	const f = new CommentFeed({ load: () => { const d = deferred(); gates.push(d); return d.p }, onChange: () => { changes++ } })
	f.meta(undefined)
	f.meta(null)
	assert.equal(f.loads, 0)
	assert.equal(f.loaded, true, 'no key: the empty list counts as loaded (no "Loading" forever)')
	f.meta(3)
	assert.equal(f.loads, 1)
	f.take(thread('7'))
	assert.deepEqual(f.threads.map((t) => t.id), ['7'], 'the own answer at once')
	gates[0].resolve({ threads: [] })
	await new Promise((r) => setTimeout(r, 0))
	assert.deepEqual(f.threads.map((t) => t.id), ['7'], 'the older load does not undo it')
	assert.equal(f.loads, 2, 'it is repeated instead')
	gates[1].resolve({ threads: [thread('7'), thread('8')] })
	await new Promise((r) => setTimeout(r, 0))
	assert.deepEqual(f.threads.map((t) => t.id), ['7', '8'])
	f.drop(['7'])
	assert.deepEqual(f.threads.map((t) => t.id), ['8'])
	assert.ok(changes >= 3)
})

// ---- AK6: pure rules -----------------------------------------------------------

test('AK6 (job 233 AK11): a bubble stands right of the item\'s hull (rotated too), top aligned, a free one at x/y, several on one item side by side to the right', () => {
	assert.deepEqual(cornerOf({ x: 10, y: 20, w: 200, h: 100, r: 0 }), { x: 210, y: 20 })
	// 90°: the hull of 200 × 100 around its centre (110, 70) is 100 × 200
	const c = cornerOf({ x: 10, y: 20, w: 200, h: 100, r: 90 })
	assert.ok(Math.abs(c.x - 160) < 1e-9 && Math.abs(c.y - -30) < 1e-9, JSON.stringify(c))
	// 45°: half of (200 + 100)/√2 around the centre
	const d = cornerOf({ x: 0, y: 0, w: 200, h: 100, r: 45 })
	const half = 300 / Math.SQRT2 / 2
	assert.ok(Math.abs(d.x - (100 + half)) < 1e-9 && Math.abs(d.y - (50 - half)) < 1e-9)
	assert.equal(cornerOf(null), null)
	const boxes = { [A]: { x: 0, y: 0, w: 200, h: 200, r: 0 } }
	const anchors = bubbleAnchors([
		thread('1', { item: A }),
		thread('2', { x: 5, y: 6 }),
		thread('3', { item: A, comments: [thread('3').comments[0], { ...thread('3').comments[0], id: '30' }] }),
		thread('4', { item: A, resolved: true }),
		thread('5', { item: 'gone', x: 7, y: 8 }),
	], (id) => boxes[id] ?? null)
	assert.deepEqual(anchors, [
		{ id: '1', n: 1, x: 200, y: 0, slot: 0, item: A, side: true },
		{ id: '2', n: 1, x: 5, y: 6, slot: 0, item: null, side: false },
		{ id: '3', n: 2, x: 200, y: 0, slot: 1, item: A, side: true },
		{ id: '5', n: 1, x: 7, y: 8, slot: 0, item: null, side: true },
	], 'resolved: no bubble; an item that does not live: its x/y (its last corner, so the bubble keeps its side)')
	const places = bubblePlaces(anchors, { x: -100, y: -50, scale: 2 })
	// the hull's corner (200, 0) lies at (600, 100) on screen: the bubble's left edge BUBBLE_SIDE_PX right of it, its top BUBBLE_DROP_PX below it
	const cx = 600 + BUBBLE_SIDE_PX + BUBBLE_PX / 2
	const cy = 100 + BUBBLE_DROP_PX + BUBBLE_PX / 2
	assert.deepEqual(places.map((p) => [p.id, p.x, p.y]), [
		['1', cx, cy], ['2', 210, 112], ['3', cx + BUBBLE_PX + BUBBLE_GAP_PX, cy],
		['5', 214 + BUBBLE_SIDE_PX + BUBBLE_PX / 2, 116 + BUBBLE_DROP_PX + BUBBLE_PX / 2],
	], 'the same size on screen at any zoom; slot 1 one bubble right of slot 0; a free thread centred on its point, one of a gone item beside its last corner')
	for (const p of places.filter((x) => x.id === '1' || x.id === '3')) {
		assert.ok(p.x - BUBBLE_PX / 2 >= 600 + BUBBLE_SIDE_PX, 'never over the item: the whole bubble right of the hull')
		// round 1: clear of the vote badge at the corner (radius 14 plus its white edge, moved out by up to VOTE_BADGE_CLEAR_PX)
		assert.ok(p.y - BUBBLE_PX / 2 >= 100 + VOTE_BADGE_PX / 2 + VOTE_DOT_BORDER_PX / 2, 'below the badge circle at the corner')
	}
	assert.deepEqual(bubblePlaces(anchors, null), [])
})

test('AK6: the list – open or resolved, newest activity first (an edit counts), first text, replies; the tab numbers', () => {
	const c = (id, at, edited = null, parts = ['t' + id], name = 'N') => ({ id, name, guest: false, pid: 'p', mine: false, parts, at, edited })
	const threads = [
		{ id: '1', item: null, x: 0, y: 0, resolved: false, comments: [c('1', 1000, null, ['First ', { m: 'Bob' }]), c('2', 5000)] },
		{ id: '3', item: null, x: 0, y: 0, resolved: false, comments: [c('3', 2000, 9000)] },
		{ id: '4', item: null, x: 0, y: 0, resolved: true, comments: [{ ...c('4', 3000), guest: true, name: 'Gina' }] },
		{ id: '6', item: null, x: 0, y: 0, resolved: false, comments: [c('6', 5000)] },
	]
	assert.deepEqual(listEntries(threads, 'open').map((e) => [e.id, e.at, e.replies]), [['3', 9000, 0], ['6', 5000, 0], ['1', 5000, 1]],
		'the edit makes 3 the newest; equal activity: the newer thread first')
	assert.deepEqual(listEntries(threads, 'open')[2], { id: '1', author: 'N', guest: false, text: 'First @Bob', replies: 1, at: 5000, resolved: false })
	assert.deepEqual(listEntries(threads, 'resolved').map((e) => [e.id, e.author, e.guest]), [['4', 'Gina', true]])
	assert.deepEqual(tabCounts(threads), { open: 3, resolved: 1 })
	assert.deepEqual(tabCounts([]), { open: 0, resolved: 0 })
	assert.equal(openThreadOf(threads, null)?.id ?? null, null)
})

test('AK6: parts are text only – a mention becomes "@name", markup stays characters', () => {
	const parts = ['<img src=x onerror=alert(1)> ', { m: '<b>Bob</b>' }, ' & more']
	assert.deepEqual(partsView(parts), [
		{ text: '<img src=x onerror=alert(1)> ', mention: false },
		{ text: '@<b>Bob</b>', mention: true },
		{ text: ' & more', mention: false },
	])
	assert.equal(partsText(parts), '<img src=x onerror=alert(1)> @<b>Bob</b> & more')
	assert.deepEqual(partsView([null, 5, { x: 1 }, 'ok']), [{ text: 'ok', mention: false }], 'anything else is left out')
})

test('job 249: a deleted account\'s mention reads "@Deleted user" in the user\'s language, list and editing too', () => {
	const parts = ['Hi ', { m: 'Deleted user', gone: true }, ' and ', { m: 'Bob' }]
	assert.deepEqual(partsView(parts), [
		{ text: 'Hi ', mention: false },
		{ text: '@Deleted user', mention: true },
		{ text: ' and ', mention: false },
		{ text: '@Bob', mention: true },
	])
	const de = JSON.parse(readFileSync(new URL('../../../l10n/de.json', import.meta.url), 'utf8')).translations
	globalThis._oc_l10n_registry_translations ??= {}
	globalThis._oc_l10n_registry_plural_functions ??= {}
	const reg = globalThis._oc_l10n_registry_translations
	const plural = globalThis._oc_l10n_registry_plural_functions
	reg.knorke = de
	plural.knorke = (k) => (k === 1 ? 0 : 1)
	try {
		assert.equal(de['Deleted user'], 'Gelöschtes Konto')
		assert.equal(partsText(parts), 'Hi @Gelöschtes Konto and @Bob')
		const raw = 'Hi @"deleted_users" and @"bob"'
		const { text, chosen } = fromWire(raw, { bob: 'Bob', deleted_users: 'Deleted user' })
		assert.equal(text, 'Hi @Gelöschtes Konto and @Bob')
		assert.equal(toWire(text, chosen), raw, 'saving unchanged gives the stored text back')
	} finally {
		delete reg.knorke
		delete plural.knorke
	}
})

test('AK6: "Comment" only for exactly one item of the five types', () => {
	const items = { [A]: sticky(A), [B]: shape(B), [C]: connector(C, null, null), [F]: frame(F), T: textItem('T'), X: { id: 'X', t: 'table' } }
	const get = (id) => items[id] ?? null
	assert.deepEqual(COMMENT_TYPES, ['sticky', 'shape', 'text', 'frame', 'table', 'mindmap'])
	for (const id of [A, B, F, 'T', 'X']) {
		assert.equal(commentableIds([id], get), true, items[id].t)
	}
	assert.equal(commentableIds([C], get), false, 'a connector')
	assert.equal(commentableIds([A, B], get), false, 'two items')
	assert.equal(commentableIds([], get), false)
	assert.equal(commentableIds(['nope'], get), false)
	// job 230: "Comment" is in the bar's collaboration group and in the comments panel ("New comment"), no menu lists it
	const sel = (extra) => ({ ids: [A], count: 1, types: new Set(['sticky']), fields: [], unlocked: 1, ...extra })
	assert.ok(!menuEntries(sel({ commentable: true }), A).includes('comment'))
	assert.ok(!menuEntries(null, null, { items: 3, comment: true }).includes('comment'))
})

test('AK6: the @ helpers – the query at the caret, the chosen name, the wire form @"uid" and back', () => {
	assert.deepEqual(mentionQuery('Hi @bo', 6), { start: 3, q: 'bo' })
	assert.deepEqual(mentionQuery('@', 1), { start: 0, q: '' })
	assert.equal(mentionQuery('mail a@b', 8), null, 'not inside a word')
	assert.equal(mentionQuery('Hi @bo b', 8), null, 'white space ends it')
	assert.equal(mentionQuery('@' + 'x'.repeat(65), 66), null, 'longer than 64')
	const r = insertMention('Hi @bo and', 'Hi @'.length - 1, 6, 'Bob Berg')
	assert.deepEqual(r, { text: 'Hi @Bob Berg  and', caret: 'Hi @Bob Berg '.length })
	const chosen = [{ id: 'bob', name: 'Bob' }, { id: 'bob2', name: 'Bob Berg' }]
	assert.equal(toWire('@Bob Berg and @Bob, not @Bobby or @Bo', chosen), '@"bob2" and @"bob", not @Bobby or @Bo')
	assert.equal(toWire('a $& @Bob', [{ id: 'b$&', name: 'Bob' }]), 'a $& @"b$&"', '$ in an id stays as it is')
	assert.deepEqual(fromWire('Hi @"bob2" and @"carol"', { bob2: 'Bob Berg' }), { text: 'Hi @Bob Berg and @"carol"', chosen: [{ id: 'bob2', name: 'Bob Berg' }] })
	assert.match(timeLabel(Date.UTC(2026, 9, 26, 10, 5), Date.UTC(2026, 9, 26, 12, 0), 'en'), /\d/)
	assert.equal(timeLabel(0, 1), '')
})

// ---- the session ----------------------------------------------------------------

test('AK6: selection v2 commentable – one item of the five types in mode edit while this person may comment; the bar and the menu follow it', async () => {
	const h = await open()
	const sel = (ids) => {
		h.s.select(ids)
		return h.s.selectionInfo()
	}
	assert.equal(sel([A]).commentable, true, 'a note')
	assert.equal(sel([F]).commentable, true, 'a frame')
	assert.equal(sel([C]).commentable, false, 'a connector')
	assert.equal(sel([A, B]).commentable, false, 'two notes')
	assert.ok(!menuEntries(sel([A]), A).includes('comment'), 'job 230: the bar has it, the menu not')
	h.s.destroy()
	const v = await open({ me: VERA })
	v.s.select([A])
	assert.equal(v.s.selectionInfo().commentable, false, 'view: no right to comment')
	assert.equal(v.s.mayComment(), false)
	v.s.destroy()
})

test('"Comment" on an item: its open thread opens; without one the editor opens at the corner; the menu of the empty canvas composes a free one', async () => {
	const h = await open({ meta: { comments: 1 }, threads: [thread('5', { item: B })] })
	assert.equal(h.s.commentOn(B), true)
	assert.deepEqual(h.ui.open, ['5'], 'the open thread of B')
	assert.equal(h.s.commentOn(A), true)
	assert.deepEqual(h.ui.compose, [{ item: A, x: 200, y: 0 }], 'a new one at A\'s corner')
	assert.equal(h.s.commentOn(C), false, 'not on a connector')
	assert.equal(h.api.calls.filter((c) => c[0] !== 'list').length, 0, 'nothing is saved before Send')
	h.s.destroy()
})

test('"New comment": the scene picks; a click on an item opens there, on empty canvas the free spot; nothing gets selected; Cancel ends it', async () => {
	const h = await open()
	const selected = h.scene.callsOf('setSelection').length
	assert.equal(h.s.startCommentPick(), true)
	assert.equal(h.scene.pick, true)
	assert.equal(h.ui.comments.at(-1).picking, true)
	h.scene.callbacks.onIntent({ type: 'pick', at: [50, 50], world: { x: 50, y: 50 } })
	assert.equal(h.scene.pick, false, 'the pick ends with its tap')
	assert.deepEqual(h.ui.compose, [{ item: A, x: 200, y: 0 }])
	h.s.startCommentPick()
	h.scene.callbacks.onIntent({ type: 'pick', at: [900, 900], world: { x: 900, y: 900 } })
	assert.deepEqual(h.ui.compose.at(-1), { item: null, x: 900, y: 900 }, 'the free point')
	h.s.startCommentPick()
	h.s.cancelCommentPick()
	assert.equal(h.scene.pick, false)
	h.scene.callbacks.onIntent({ type: 'pick', at: [50, 50], world: { x: 50, y: 50 } })
	assert.equal(h.ui.compose.length, 2, 'after Cancel a tap picks nothing')
	assert.equal(h.scene.callsOf('setSelection').length, selected, 'never a selection')
	h.s.destroy()
	const v = await open({ me: VERA })
	assert.equal(v.s.startCommentPick(), false, 'view: no pick')
	v.s.destroy()
})

test('the own writes count at once; errors toast comment-failed and reject; the @ list only for accounts that may write', async () => {
	const h = await open({ meta: { comments: 1 }, threads: [thread('5', { item: B })] })
	const th = await h.s.createThread({ text: 'New', item: A, x: 1, y: 2 })
	assert.equal(th.id, '50')
	assert.deepEqual(h.api.calls.at(-1), ['create', { text: 'New', x: 1, y: 2, item: A }])
	assert.deepEqual(h.s.comments.threads.map((t) => t.id), ['5', '50'], 'at once, before any GET')
	await h.s.replyTo('5', 'Reply')
	assert.equal(h.s.comments.get('5').comments.length, 2)
	await h.s.setResolved('5', true)
	assert.equal(h.s.comments.get('5').resolved, true)
	await h.s.deleteComment('50')
	assert.deepEqual(h.s.comments.threads.map((t) => t.id), ['5'])
	assert.deepEqual(await h.s.searchMentions('bo'), [{ id: 'bob', name: 'Bob Berg' }])
	h.api.create = async () => { throw Object.assign(new Error('x'), { name: 'HttpError' }) }
	await assert.rejects(h.s.replyTo('5', 'nope'))
	assert.deepEqual(h.toasts.at(-1), ['Your comment could not be saved.', 'comment-failed'])
	h.s.destroy()
})

test('deleting an item sends PATCH x/y with its last corner for its threads; undo brings it back and the thread hangs on it again', async () => {
	const h = await open({ meta: { comments: 1 }, threads: [thread('5', { item: B, x: 0, y: 0 }), thread('6', { item: A })] })
	h.s.select([B])
	h.s.deleteSelection()
	await h.clock.advance(0)
	const patches = h.api.calls.filter((c) => c[0] === 'update')
	assert.deepEqual(patches, [['update', { comment: '5', x: 600, y: 0 }]], 'B\'s corner (400 + 200, 0); A untouched')
	assert.equal(h.model.has(B), false)
	assert.deepEqual(h.s.commentPlaces().find((p) => p.id === '5'), { id: '5', n: 1, x: 600 - h.scene.camera.x + BUBBLE_SIDE_PX + BUBBLE_PX / 2, y: 0 - h.scene.camera.y + BUBBLE_DROP_PX + BUBBLE_PX / 2 }, 'the bubble stays where it was, right of the corner (job 233)')
	h.s.undo()
	await h.clock.advance(0)
	assert.equal(h.model.has(B), true)
	assert.equal(h.s.threadAnchor('5').x, 600, 'on the item again (it keeps item)')
	h.model.moveLocal([B], 100, 0)
	assert.equal(h.s.threadAnchor('5').x, 700, 'and follows it, a drag too')
	h.s.destroy()
})

test('AK6: exportPlan/exportIds, the CSV rows and the board file are the same with and without threads', async () => {
	const items = [frame(F, { x: 0, y: 0, z: 'a0' }), sticky(A, { x: 40, y: 60, parent: F, z: 'a1', data: { text: 'One' } }), sticky(B, { x: 900, z: 'a2', data: { text: 'Two' } })]
	const exports = (s) => {
		const ids = exportIds(s.model, null)
		return { ids, plan: exportPlan(s.model, ids, null), csv: csvRows(s.model, ids, null), file: boardFileText(s.model, 'Board') }
	}
	const without = await open({ items, Model: SceneModel })
	const a = exports(without.s)
	const withThreads = await open({ items, Model: SceneModel, meta: { comments: 3 }, threads: [thread('5', { item: A }), thread('6', { item: F, resolved: true }), thread('7', { x: 3, y: 4 })] })
	assert.equal(withThreads.s.comments.threads.length, 3, 'the threads are there')
	assert.deepEqual(exports(withThreads.s), a)
	assert.doesNotMatch(a.file, /Hi 5|"comments"/)
	without.s.destroy()
	withThreads.s.destroy()
})

test('pickItem: the topmost item of the five types at the point (connectors pass through), else null', () => {
	const m = new FakeModel([frame(F, { x: 0, y: 0, w: 800, h: 600, z: 'a0' }), sticky(A, { x: 100, y: 100, z: 'a1' }), sticky(B, { x: 150, y: 150, z: 'a2' }), connector(C, { item: A }, { item: B }, { x: 0, y: 0, w: 1000, h: 1000, z: 'z9' })])
	assert.equal(pickItem(m, { x: 160, y: 160 }), B, 'the upper note')
	assert.equal(pickItem(m, { x: 110, y: 110 }), A)
	assert.equal(pickItem(m, { x: 700, y: 500 }), F)
	assert.equal(pickItem(m, { x: 5000, y: 5000 }), null)
})

test('review round 1: the thread popover stays inside the board – beside the bubble, moved up when the bubble is low, its height bound to the room below its top', () => {
	const B = { w: 1440, h: 892 }
	// a bubble in the upper half: right of it, at its height, at most THREAD_MAX_H
	assert.deepEqual(threadPlace({ x: 800, y: 300 }, B), { left: 800 + THREAD_GAP, top: 300 - THREAD_GAP, maxHeight: THREAD_MAX_H })
	// the case of the review (1440 × 900, opened from the list: the bubble at about 471): the whole popover fits
	const mid = threadPlace({ x: 900, y: 471 }, B)
	assert.ok(mid.top + mid.maxHeight <= B.h - THREAD_EDGE, JSON.stringify(mid))
	// low bubble: moved up so THREAD_ROOM stays, never past the bottom edge
	const low = threadPlace({ x: 400, y: 850 }, B)
	assert.equal(low.top, B.h - THREAD_EDGE - THREAD_ROOM)
	assert.equal(low.top + low.maxHeight, B.h - THREAD_EDGE)
	// no room on the right: left of the bubble
	assert.equal(threadPlace({ x: 1300, y: 200 }, B).left, 1300 - THREAD_GAP - THREAD_W)
	// a small board (laptop 1366 × 768 minus the chrome, a tablet in landscape): the whole height minus the edges
	const small = threadPlace({ x: 100, y: 500 }, { w: 1000, h: 300 })
	assert.deepEqual([small.top, small.maxHeight], [THREAD_EDGE, 300 - 2 * THREAD_EDGE])
	// unknown board: no limit, never above the edge
	assert.deepEqual(threadPlace({ x: 10, y: 0 }, null), { left: 10 + THREAD_GAP, top: THREAD_EDGE, maxHeight: null })
})

test('review round 1: the panel closes at "New comment" when it covers the hint (rectsOverlap)', () => {
	const r = (left, top, right, bottom) => ({ left, top, right, bottom })
	// 820 × 1180: the hint from 208 to 612, the panel from 452 – they overlap
	assert.equal(rectsOverlap(r(208, 108, 612, 164), r(452, 108, 812, 1172)), true)
	// 1440 × 900: the hint in the middle, the panel on the right – apart
	assert.equal(rectsOverlap(r(518, 108, 922, 164), r(1064, 108, 1424, 884)), false)
	assert.equal(rectsOverlap(r(0, 0, 10, 10), r(10, 0, 20, 10)), false, 'touching edges are no overlap')
	assert.equal(rectsOverlap(null, r(0, 0, 1, 1)), false)
	assert.equal(rectsOverlap(r(0, 0, 0, 0), r(0, 0, 1, 1)), false, 'an empty rectangle (hidden) never overlaps')
})
