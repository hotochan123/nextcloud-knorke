/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 191 in BoardSession (AK5, AK6, AK8), with the real
 * SceneModel, a scene fake that records setTags and setTagFilter, an LWW
 * server for the ops (as in boardFileSession.test.mjs) and a fake of the
 * tag routes 44/45 (deps.tags: it applies add/update/delete to meta.tags
 * and answers {board: {title, meta, metaRev}, now} like the server).
 * - AK5 ticking is one commit with inverse; locked notes stay untouched,
 *   full notes give the hint tag-full, the box has three states; Enter
 *   sends add first and then the patch, an error sends no patch; onMeta
 *   with tags alone triggers neither vote, timer nor summon (applyMeta)
 * - AK6 copy, duplicate, board file and own template carry the right tags;
 *   pasting maps them and sends at most one add before the puts; a failed
 *   add pastes without these tags and with the hint
 * - AK8 the filter fades in the scene and sends nothing; "Select all with
 *   this tag" only in mode edit, never a locked note; the menus' entries
 * - job 206 (undo for tags): creating (with its ticking), renaming,
 *   recolouring and deleting are one undo step each, redo writes them
 *   again, also between other steps (AK2); undoing a delete brings the tag
 *   back on its notes, also on one that lost its id meanwhile (AK3); a tag
 *   someone else changed is skipped, a failed or skipped write leaves the
 *   step (AK4); tag steps run one after another (AK5)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { encodeClip } from '../../../src/board/clipboard.js'
import { copyPayload } from '../../../src/board/actions.js'
import { boardMenuItems } from '../../../src/components/boardMenu.js'
import { menuEntries } from '../../../src/components/contextbar.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { HttpError } from '../../../src/sync/http.js'
import { TAG_COLORS } from '../../../src/model/tokens.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, memoryStorage, shape, sticky } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const VIEWER = { pid: 'pidviewer0000001', name: 'Vera', role: 'view', guest: false, mod: false, source: 'share' }
const TG = (n) => '01JT' + String(n).padStart(22, '0')
/** (Job 227) the first two tag colours */
const KOSTEN = { id: TG(1), name: 'Kosten', color: '#0275a9' }
const ZEIT = { id: TG(2), name: 'Zeit', color: '#087c77' }
const A = ID(1)
const B = ID(2)
const L = ID(3)
const S = ID(4)
const LOCK = { by: 'pidbob0000000001', name: 'Bob' }
const ITEMS = Object.freeze([
	sticky(A, { x: 0, y: 0, z: 'i1', data: { text: 'A', tags: [TG(1)] } }),
	sticky(B, { x: 300, y: 0, z: 'i2', data: { text: 'B' } }),
	sticky(L, { x: 600, y: 0, z: 'i3', data: { text: 'locked', tags: [TG(2)] }, lock: LOCK }),
	shape(S, { x: 900, y: 0, z: 'i4', data: { kind: 'rect', text: 'S' } }),
])

class TagScene extends FakeScene {
	setMode(mode) {
		this.log('setMode', mode)
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	setTags(list) {
		this.log('setTags', structuredClone(list))
	}

	setTagFilter(ids) {
		this.log('setTagFilter', ids === null ? null : [...ids])
	}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

/**
 * @param {object[]} items WireItems
 * @return {object} LWW server of the ops
 */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			srv.live.set(op.id, itemFromPut(op))
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) return 'gone'
			applyPatch(it, structuredClone(op.p))
		} else if (op.o === 'remove') {
			srv.live.delete(op.id)
		}
		srv.rev++
		srv.changed.push([srv.rev, op.id])
		return 'ok'
	}
	srv.apply = (ops) => ops.map(apply)
	srv.since = (rev) => {
		const ids = new Set(srv.changed.filter(([r]) => r > rev).map(([, id]) => id))
		return { items: [...ids].filter((id) => srv.live.has(id)).map((id) => structuredClone(srv.live.get(id))), removed: [...ids].filter((id) => !srv.live.has(id)) }
	}
	return srv
}

/**
 * The tag routes of the test: the server's rules for add (skip a taken id
 * or name), update and delete; fail: an HttpError to throw instead.
 *
 * @param {{meta: object, metaRev: number}} board the board state shared with the snapshot
 * @return {object} api {save, calls, fail}
 */
function tagServer(board) {
	const api = {
		calls: [],
		fail: null,
		/** a database without 4-byte UTF-8: names are stored with U+FFFD for every astral character */
		bmp: false,
		async save(body) {
			api.calls.push(structuredClone(body))
			if (api.fail) throw api.fail
			const list = structuredClone(board.meta.tags ?? [])
			const key = (s) => s.toLowerCase()
			const stored = (s) => (api.bmp ? s.replace(/[\u{10000}-\u{10FFFF}]/gu, '\uFFFD') : s)
			if (body.action === 'add') {
				for (const raw of body.tags) {
					const tg = { ...raw, name: stored(raw.name) }
					if (!list.some((x) => x.id === tg.id || key(x.name) === key(tg.name))) list.push(tg)
				}
			} else if (body.action === 'update') {
				const tg = list.find((x) => x.id === body.tag)
				if (!tg) throw new HttpError(409, 'tag_gone', 'gone', null, true)
				if (body.name !== undefined) tg.name = body.name
				if (body.color !== undefined) tg.color = body.color
			} else {
				list.splice(list.findIndex((x) => x.id === body.tag) >>> 0, list.some((x) => x.id === body.tag) ? 1 : 0)
			}
			board.meta = { ...board.meta, tags: list }
			board.metaRev++
			return { board: { title: 'Retro', meta: structuredClone(board.meta), metaRev: board.metaRev }, now: T0 }
		},
	}
	return api
}

/**
 * @param {object} [o] items, me, meta
 * @return {Promise<object>} harness
 */
async function open({ items = ITEMS, me = ALICE, meta = { tags: [KOSTEN, ZEIT] } } = {}) {
	const clock = new FakeClock(10000)
	const log = []
	const srv = lwwServer(items)
	const board = { meta: structuredClone(meta), metaRev: 3 }
	const api = tagServer(board)
	const views = []
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Retro', role: me.role, metaRev: board.metaRev, meta: structuredClone(board.meta) }, me, items: structuredClone(items) }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) return {}
			tr.calls.push(structuredClone(body))
			const res = body.ops ? srv.apply(body.ops) : null
			const out = { rev: srv.rev, ...srv.since(body.since), presence: {} }
			if (res) out.acks = { seq: body.seq, rev: srv.rev, res }
			return out
		},
	}
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		ui: { onTags: (v) => views.push(v) },
		deps: {
			SceneModel,
			SceneManager: TagScene,
			transport: tr,
			tags: api,
			// no DOMParser in Node: the clip attribute of encodeClip's html
			parseHtml: (html) => ({ querySelector: () => ({ getAttribute: () => /data-knorke-clip="([^"]*)"/.exec(html)?.[1] ?? null }) }),
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			wall: () => T0,
			downloadBlob: (name, blob) => {
				log.push(['download', name, blob])
				return true
			},
		},
	})
	await s.open()
	await clock.advance(0)
	const opsSince = async (from = 0) => {
		await clock.advance(200)
		return tr.calls.slice(from).flatMap((b) => b.ops ?? [])
	}
	return { s, clock, tr, api, log, views, srv, scene: s.scene, model: s.model, opsSince, view: () => views.at(-1) }
}

/** the order of events: the add call and the puts (by the sync body that carried them) */
function stateOf(h, id) {
	return h.view().tags.find((x) => x.id === id)?.state
}

test('the scene gets the board\'s tags on open; a view lists them by name with their counts', async () => {
	const h = await open()
	assert.deepEqual(h.scene.callsOf('setTags').at(-1)[1], [KOSTEN, ZEIT])
	assert.deepEqual(h.view().tags.map((x) => [x.name, x.count]), [['Kosten', 1], ['Zeit', 1]])
	assert.equal(h.view().edit, true)
	assert.equal(h.view().panel, null)
})

test('AK5: ticking is one commit with inverse; the locked note stays untouched; three states', async () => {
	const h = await open()
	h.s.select([A, B, L])
	assert.equal(h.s.selectionInfo().taggable, 2, 'the two unlocked notes')
	assert.equal(h.s.openTagPanel({ x: 10, y: 10, w: 20, h: 20 }), true)
	assert.equal(stateOf(h, TG(1)), 'mixed', 'A has it, B not (L is locked and does not count)')
	assert.equal(stateOf(h, TG(2)), 'off')
	const n = h.tr.calls.length
	assert.equal(h.s.tickTag(TG(1)), true, 'mixed → every note')
	assert.deepEqual(await h.opsSince(n), [{ o: 'patch', id: B, p: { 'data.tags': [TG(1)] } }])
	assert.equal(stateOf(h, TG(1)), 'on')
	assert.equal(h.s.undoStack.canUndo(), true)
	const m = h.tr.calls.length
	h.s.tickTag(TG(1))
	assert.deepEqual(await h.opsSince(m), [{ o: 'patch', id: A, p: { 'data.tags': null } }, { o: 'patch', id: B, p: { 'data.tags': null } }], 'on → from all')
	assert.equal(stateOf(h, TG(1)), 'off')
	const u = h.tr.calls.length
	h.s.undo()
	assert.deepEqual(await h.opsSince(u), [{ o: 'patch', id: A, p: { 'data.tags': [TG(1)] } }, { o: 'patch', id: B, p: { 'data.tags': [TG(1)] } }], 'undo: the inverse')
	assert.deepEqual(h.model.get(L).data.tags, [TG(2)], 'the locked note never changes')
	assert.equal(h.api.calls.length, 0, 'ticking writes no tag list')
})

test('AK5: a note with 8 tags is skipped with the hint "A note can have at most 8 tags."', async () => {
	const eight = Array.from({ length: 8 }, (_, i) => ({ id: TG(10 + i), name: 'T' + i, color: TAG_COLORS[i] }))
	const h = await open({
		items: [sticky(A, { data: { tags: eight.map((x) => x.id) } }), sticky(B, { x: 300, z: 'i2' })],
		meta: { tags: [...eight, KOSTEN] },
	})
	h.s.select([A, B])
	h.s.openTagPanel(null)
	const n = h.tr.calls.length
	h.s.tickTag(TG(1))
	assert.deepEqual(await h.opsSince(n), [{ o: 'patch', id: B, p: { 'data.tags': [TG(1)] } }])
	assert.deepEqual(h.log, [['info', 'A note can have at most 8 tags.', 'tag-full']])
})

test('AK5: Enter with a new name: add first (next free colour), then ONE patch; (job 206 AK2) one step with the tag: undo deletes it, redo adds it back', async () => {
	const h = await open()
	h.s.select([A, B])
	h.s.openTagPanel(null)
	const n = h.tr.calls.length
	const done = h.s.createTag('  Risiko ')
	assert.equal(h.tr.calls.length, n, 'nothing is sent before the answer')
	assert.equal(await done, true)
	assert.equal(h.api.calls.length, 1)
	const add = h.api.calls[0]
	assert.equal(add.action, 'add')
	assert.deepEqual([add.tags.length, add.tags[0].name, add.tags[0].color], [1, 'Risiko', TAG_COLORS[2]], 'the first colour no tag has')
	const id = add.tags[0].id
	assert.deepEqual(await h.opsSince(n), [{ o: 'patch', id: A, p: { 'data.tags': [TG(1), id] } }, { o: 'patch', id: B, p: { 'data.tags': [id] } }])
	assert.deepEqual(h.scene.callsOf('setTags').at(-1)[1].map((x) => x.name), ['Kosten', 'Zeit', 'Risiko'], 'the scene draws the new tag')
	const u = h.tr.calls.length
	// the delete goes out before the notes lose the tag
	const save = h.api.save
	const seen = []
	h.api.save = (body) => {
		seen.push(structuredClone(h.model.get(B).data?.tags ?? null))
		return save(body)
	}
	await h.s.undo()
	assert.deepEqual(h.api.calls[1], { action: 'delete', tag: id })
	assert.deepEqual(seen, [[id]], 'B still had the tag when the delete went out')
	assert.deepEqual(await h.opsSince(u), [{ o: 'patch', id: A, p: { 'data.tags': [TG(1)] } }, { o: 'patch', id: B, p: { 'data.tags': null } }])
	assert.deepEqual(h.s.boardTags().map((x) => x.name), ['Kosten', 'Zeit'], 'the tag left the list')
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, true], 'ONE step')
	const r = h.tr.calls.length
	await h.s.redo()
	assert.deepEqual(h.api.calls[2], { action: 'add', tags: [{ id, name: 'Risiko', color: TAG_COLORS[2] }] }, 'same id, name and colour')
	assert.deepEqual(seen[1], null, 'B got the tag after the add')
	assert.deepEqual(await h.opsSince(r), [{ o: 'patch', id: A, p: { 'data.tags': [TG(1), id] } }, { o: 'patch', id: B, p: { 'data.tags': [id] } }])
	assert.deepEqual(h.s.boardTags().map((x) => x.name), ['Kosten', 'Zeit', 'Risiko'])
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [true, false])
})

test('AK5: Enter with an existing name ticks it (no add); an error or 100 tags tick nothing', async () => {
	const h = await open()
	h.s.select([B])
	h.s.openTagPanel(null)
	let n = h.tr.calls.length
	assert.equal(await h.s.createTag('zeit'), true)
	assert.equal(h.api.calls.length, 0)
	assert.deepEqual(await h.opsSince(n), [{ o: 'patch', id: B, p: { 'data.tags': [TG(2)] } }])
	h.api.fail = new HttpError(500, 'internal', 'x', null, true)
	n = h.tr.calls.length
	assert.equal(await h.s.createTag('Neu'), false)
	assert.deepEqual(await h.opsSince(n), [], 'no patch after an error')
	assert.deepEqual(h.log.at(-1), ['toast', 'The tag could not be saved.', 'tag-failed'])
	h.api.fail = new HttpError(409, 'tag_limit', 'x', null, true)
	assert.equal(await h.s.createTag('Neu'), false)
	assert.deepEqual(h.log.at(-1), ['info', 'A board can have at most 100 tags.', 'tag-limit'])
	const full = await open({ meta: { tags: Array.from({ length: 100 }, (_, i) => ({ id: TG(100 + i), name: 'T' + i, color: '#c43e45' })) } })
	full.s.select([B])
	full.s.openTagPanel(null)
	assert.equal(await full.s.createTag('Neu'), false)
	assert.equal(full.api.calls.length, 0, '100 tags: no add')
	assert.deepEqual(full.log, [['info', 'A board can have at most 100 tags.', 'tag-limit']])
})

test('review 1: without 4-byte UTF-8 on the server Enter with an emoji name still ticks the new tag (found by its id), and a name stored the same ticks that tag', async () => {
	const h = await open()
	h.api.bmp = true
	h.s.select([A, B])
	h.s.openTagPanel(null)
	let n = h.tr.calls.length
	assert.equal(await h.s.createTag('🔥 Hot'), true)
	const id = h.api.calls[0].tags[0].id
	assert.equal(h.s.boardTags().find((x) => x.id === id).name, '\uFFFD Hot', 'stored with U+FFFD')
	assert.deepEqual(await h.opsSince(n), [{ o: 'patch', id: A, p: { 'data.tags': [TG(1), id] } }, { o: 'patch', id: B, p: { 'data.tags': [id] } }])
	h.s.select([B])
	h.s.openTagPanel(null)
	h.s.tickTag(id)
	await h.opsSince(h.tr.calls.length)
	n = h.tr.calls.length
	assert.equal(await h.s.createTag('💡 Hot'), true, 'the server skips it: the same stored name')
	assert.equal(h.s.boardTags().length, 3, 'no new tag')
	assert.deepEqual(await h.opsSince(n), [{ o: 'patch', id: B, p: { 'data.tags': [id] } }], 'the tag of the stored name is ticked')
	assert.deepEqual(h.log, [])
})

test('AK5: onMeta with only tags draws the notes again and triggers neither vote, timer nor summon', async () => {
	const h = await open({ meta: { tags: [KOSTEN], timer: { state: 'running', endsAt: T0 + 60000, by: 'Alice' } } })
	let applied = 0
	const orig = h.s.applyMeta.bind(h.s)
	h.s.applyMeta = (...a) => {
		applied++
		return orig(...a)
	}
	const tags = h.scene.callsOf('setTags').length
	const timer = h.s.board.meta.timer
	assert.equal(h.s.onMeta({ metaRev: 10, meta: { tags: [KOSTEN, ZEIT], timer } }), true)
	assert.equal(applied, 0, 'no applyMeta')
	assert.equal(h.s.board.meta.timer, timer, 'the timer keeps its object')
	assert.equal(h.scene.callsOf('setTags').length, tags + 1)
	assert.deepEqual(h.log, [], 'no toast')
	assert.equal(h.s.onMeta({ metaRev: 11, meta: { tags: [KOSTEN, ZEIT], timer: { ...timer, state: 'paused' } } }), true)
	assert.equal(applied, 1, 'another key still goes through applyMeta')
	assert.equal(h.s.onMeta({ metaRev: 12, meta: { timer: { ...timer, state: 'paused' }, comments: 3 } }), true)
	assert.equal(applied, 1, 'tags gone and comments new: quiet too')
	assert.deepEqual(h.s.boardTags(), [])
})

test('AK5: rename, recolour and delete go through the route; a viewer may not', async () => {
	const h = await open()
	assert.equal(await h.s.renameTag(TG(1), 'Budget'), true)
	assert.equal(await h.s.recolorTag(TG(1), TAG_COLORS[5]), true)
	assert.equal(await h.s.recolorTag(TG(1), '#123456'), false, 'only the 12 colours')
	assert.equal(await h.s.renameTag(TG(1), 'zeit'), false, 'a name another tag has')
	assert.deepEqual(h.log.at(-1), ['info', 'A tag with this name already exists.', 'tag-exists'])
	assert.equal(await h.s.deleteTag(TG(2)), true)
	assert.deepEqual(h.api.calls, [
		{ action: 'update', tag: TG(1), name: 'Budget' },
		{ action: 'update', tag: TG(1), color: TAG_COLORS[5] },
		{ action: 'delete', tag: TG(2) },
	])
	assert.deepEqual(h.s.boardTags(), [{ id: TG(1), name: 'Budget', color: TAG_COLORS[5] }])
	const v = await open({ me: VIEWER })
	assert.equal(v.view().edit, false)
	assert.equal(await v.s.deleteTag(TG(1)), false)
	assert.equal(v.api.calls.length, 0)
})

test('AK8: the filter fades through the scene and sends nothing; a deleted tag leaves it', async () => {
	const h = await open()
	const n = h.tr.calls.length
	h.s.setTagFilter([TG(1), 'unknown'])
	assert.deepEqual(h.scene.callsOf('setTagFilter').at(-1)[1], [TG(1)])
	assert.deepEqual(h.view().filter, [TG(1)])
	h.s.toggleTagFilter(TG(2))
	assert.deepEqual(h.scene.callsOf('setTagFilter').at(-1)[1], [TG(1), TG(2)])
	await h.clock.advance(3000)
	assert.deepEqual(h.tr.calls.slice(n).flatMap((b) => b.ops ?? []), [], 'no op')
	assert.equal(h.api.calls.length, 0, 'no tag write')
	await h.s.deleteTag(TG(2))
	assert.deepEqual(h.view().filter, [TG(1)])
	assert.deepEqual(h.scene.callsOf('setTagFilter').at(-1)[1], [TG(1)])
	h.s.setTagFilter([])
	assert.equal(h.scene.callsOf('setTagFilter').at(-1)[1], null)
})

test('AK8: "Select all with this tag" only in mode edit, never a locked note', async () => {
	const h = await open({ items: [...ITEMS, sticky(ID(9), { x: 1200, z: 'i9', data: { tags: [TG(2)] } })] })
	assert.equal(h.s.selectWithTag(TG(2)), true)
	assert.deepEqual(h.s.selection, [ID(9)], 'L is locked')
	const v = await open({ me: VIEWER })
	assert.equal(v.s.selectWithTag(TG(1)), false)
	assert.deepEqual(v.s.selection, [])
})

test('AK8: the menus: tags on items only in mode edit with an unlocked note (job 230: in the bar only, no menu lists it); filter-tags once the board has tags', async () => {
	assert.ok(!menuEntries({ count: 1, unlocked: 1, types: new Set(['sticky']), taggable: 1 }, A).includes('tags'), 'job 230: the bar has it')
	assert.ok(!menuEntries(null, null).includes('tags'), 'not on the empty canvas')
	const h = await open()
	h.s.select([S])
	assert.equal(h.s.selectionInfo().taggable, 0)
	h.s.select([L])
	assert.equal(h.s.selectionInfo().taggable, 0, 'a locked note')
	const v = await open({ me: VIEWER })
	v.s.select([A])
	assert.equal(v.s.selectionInfo().taggable, 0, 'mode view')
	const keys = (o) => boardMenuItems({ ready: true, ...o }).map((x) => x.key)
	assert.equal(keys({ tags: true })[0], 'filter-tags', 'first, for every person')
	assert.ok(!keys({ tags: false }).includes('filter-tags'))
	assert.ok(keys({ tags: true, canEdit: false, edit: false }).includes('filter-tags'))
	assert.equal(v.s.openTagFilter(), true, 'every mode')
	const empty = await open({ meta: {} })
	assert.equal(empty.s.openTagFilter(), false, 'no tags: no filter panel')
})

test('the list of "+n" (tagList intent, every mode) and the tag panel follow their notes', async () => {
	const v = await open({ me: VIEWER })
	v.s.onIntent({ type: 'tagList', id: A, rect: { x: 1, y: 2, w: 3, h: 4 } })
	assert.deepEqual(v.view().panel, { kind: 'list', id: A, rect: { x: 1, y: 2, w: 3, h: 4 }, targets: 0, list: [KOSTEN] })
	const h = await open()
	h.s.select([B])
	h.s.openTagPanel(null)
	assert.equal(h.view().panel.kind, 'tag')
	h.s.select([])
	assert.equal(h.view().panel, null, 'no note left: the panel closes')
})

// ---- AK6: copy, paste, file, template -------------------------------------------------

test('AK6: copy carries the tags of its notes; duplicate keeps them', async () => {
	const h = await open()
	const payload = copyPayload(h.model, [A, B], { board: 7, tags: h.s.boardTags() })
	assert.deepEqual(payload.tags, [KOSTEN], 'only the tags its notes use')
	assert.equal(payload.knorke, 1)
	h.s.select([A])
	const n = h.tr.calls.length
	h.s.duplicateNow()
	const ops = await h.opsSince(n)
	assert.equal(ops.length, 1)
	assert.deepEqual(ops[0].p.data.tags, [TG(1)])
	assert.equal(h.api.calls.length, 0)
})

test('AK6: paste into another board: same id kept, same name mapped, a new tag created with ONE add before the puts', async () => {
	const src = new SceneModel()
	const other = [{ id: TG(1), name: 'Kosten', color: '#0275a9' }, { id: TG(50), name: 'ZEIT', color: '#000000' }, { id: TG(51), name: 'Neu', color: '#307d37' }]
	src.load([sticky(ID(30), { data: { text: 'x', tags: [TG(51), TG(50), TG(1)] } })])
	const clip = encodeClip(copyPayload(src, [ID(30)], { board: 8, tags: other }))
	const h = await open()
	const n = h.tr.calls.length
	h.s.pasteData({ html: clip.html, text: clip.text }, { inPlace: false })
	assert.equal(h.tr.calls.length, n, 'the puts wait for the add')
	await h.clock.advance(0)
	assert.equal(h.api.calls.length, 1, 'one add')
	const add = h.api.calls[0]
	assert.deepEqual(add.tags.map((x) => [x.name, x.color]), [['Neu', '#307d37']])
	assert.notEqual(add.tags[0].id, TG(51), 'a fresh id')
	const ops = await h.opsSince(n)
	assert.equal(ops.length, 1)
	assert.deepEqual(ops[0].p.data.tags, [add.tags[0].id, TG(2), TG(1)], 'Neu new, ZEIT → Zeit, Kosten by id')
	assert.equal(h.s.undoStack.canUndo(), true)
	h.s.undo()
	assert.equal((await h.opsSince(n + 1)).filter((o) => o.o === 'remove').length, 1, 'one undo step removes the paste')
})

test('AK6: a failed add pastes the notes without these tags, with the hint', async () => {
	const src = new SceneModel()
	src.load([sticky(ID(30), { data: { text: 'x', tags: [TG(51), TG(1)] } })])
	const clip = encodeClip(copyPayload(src, [ID(30)], { board: 8, tags: [KOSTEN, { id: TG(51), name: 'Neu', color: '#307d37' }] }))
	const h = await open()
	h.api.fail = new HttpError(500, 'internal', 'x', null, true)
	const n = h.tr.calls.length
	h.s.pasteData({ html: clip.html, text: clip.text }, { inPlace: false })
	await h.clock.advance(0)
	const ops = await h.opsSince(n)
	assert.deepEqual(ops.map((o) => o.p.data.tags), [[TG(1)]], 'only the tag the board has')
	assert.deepEqual(h.log, [['toast', 'Some tags could not be created.', 'tags-not-created']])
})

test('AK6: a board file carries every tag of the board; inserting it into another board adds the missing ones first', async () => {
	const h = await open()
	h.s.exportBoardFile()
	const blob = h.log.find((x) => x[0] === 'download')[2]
	const text = await blob.text()
	const file = JSON.parse(text)
	assert.deepEqual(file.tags, [KOSTEN, ZEIT])
	const g = await open({ items: [], meta: {} })
	assert.equal(g.s.insertBoardFile(text), true)
	await g.clock.advance(0)
	assert.equal(g.api.calls.length, 1)
	assert.deepEqual(g.api.calls[0].tags.map((x) => x.name), ['Kosten', 'Zeit'])
	const ops = await g.opsSince(0)
	const ids = new Map(g.api.calls[0].tags.map((x) => [x.name, x.id]))
	const tagged = ops.filter((o) => o.o === 'put' && o.p.data.tags).map((o) => o.p.data.tags)
	assert.deepEqual(tagged, [[ids.get('Kosten')], [ids.get('Zeit')]])
})

test('AK6: an own template of a selection carries the tags of its notes', async () => {
	const h = await open()
	h.s.select([A, B])
	const d = h.s.templateDraft('selection')
	assert.deepEqual(JSON.parse(d.content).tags, [KOSTEN])
	const all = h.s.templateDraft('board')
	assert.deepEqual(JSON.parse(all.content).tags, [KOSTEN, ZEIT])
})

test('AK7 in the session: the CSV ends with the Tags column', async () => {
	const h = await open()
	h.s.downloadText = null
	const texts = []
	h.s.download = (name, text) => {
		texts.push(text)
		return true
	}
	assert.equal(h.s.exportBoardCsv('board'), true)
	const lines = texts[0].replace(/^﻿/, '').split('\r\n')
	assert.ok(lines[0].endsWith(',Tags'))
	assert.ok(lines[1].endsWith(',Kosten'), lines[1])
	assert.ok(lines.some((l) => l.startsWith('Shape,') && l.endsWith(',')), 'a shape has an empty field')
})

// ---- job 206: undo for tags ---------------------------------------------

/** Bob writes ops on the server; a sync brings them to Alice (as in undoOthers.test.mjs). */
function bob(h, ops) {
	const before = h.srv.rev
	assert.ok(h.srv.apply(ops).every((x) => x === 'ok'), 'Bob\'s ops apply')
	const { items, removed } = h.srv.since(before)
	h.s.onChanges(items, removed)
}

/** Bob changes the tag list (route 44 at his end); the answer reaches Alice as a meta change. */
async function bobTags(h, body) {
	const calls = h.api.calls.length
	const res = await h.api.save(body)
	h.api.calls.length = calls
	h.s.onMeta(res.board)
}

const SKIPPED = ['info', 'The tag was skipped because someone else changed it.', 'undo-changed']

test('job 206 AK2: renaming, recolouring and deleting are one undo step each; redo writes them again', async () => {
	const h = await open()
	assert.equal(await h.s.renameTag(TG(1), 'Budget'), true)
	assert.equal(await h.s.recolorTag(TG(1), TAG_COLORS[5]), true)
	assert.equal(await h.s.deleteTag(TG(2)), true)
	assert.equal(h.s.undoStack.done.length, 3)
	h.api.calls.length = 0
	await h.s.undo()
	assert.deepEqual(h.s.boardTags(), [{ id: TG(1), name: 'Budget', color: TAG_COLORS[5] }, ZEIT], 'the deleted tag is back with its id, name and colour')
	await h.s.undo()
	await h.s.undo()
	assert.deepEqual(h.api.calls, [
		{ action: 'add', tags: [ZEIT] },
		{ action: 'update', tag: TG(1), color: KOSTEN.color },
		{ action: 'update', tag: TG(1), name: 'Kosten' },
	])
	assert.deepEqual(h.s.boardTags(), [KOSTEN, ZEIT])
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, true])
	h.api.calls.length = 0
	await h.s.redo()
	await h.s.redo()
	await h.s.redo()
	assert.deepEqual(h.api.calls, [
		{ action: 'update', tag: TG(1), name: 'Budget' },
		{ action: 'update', tag: TG(1), color: TAG_COLORS[5] },
		{ action: 'delete', tag: TG(2) },
	])
	assert.deepEqual(h.s.boardTags(), [{ id: TG(1), name: 'Budget', color: TAG_COLORS[5] }])
	assert.equal(h.log.length, 0, 'no hint')
	// a write without effect is no step
	await h.s.recolorTag(TG(1), TAG_COLORS[5])
	assert.equal(h.s.undoStack.done.length, 3)
})

test('job 206 AK2: tag steps keep their place among other steps', async () => {
	const h = await open()
	h.s.commit({ ops: [{ o: 'patch', id: B, p: { x: 350 } }], inverse: [{ o: 'patch', id: B, p: { x: 300 } }] })
	await h.s.renameTag(TG(1), 'Budget')
	h.s.commit({ ops: [{ o: 'patch', id: B, p: { y: 50 } }], inverse: [{ o: 'patch', id: B, p: { y: 0 } }] })
	const u = h.tr.calls.length
	const xAtSave = []
	const save = h.api.save
	h.api.save = (body) => {
		xAtSave.push([h.model.get(B).x, h.model.get(B).y])
		return save(body)
	}
	h.s.undo()
	h.s.undo()
	await h.s.undo()
	assert.deepEqual(xAtSave, [[350, 0]], 'the rename went back after the step above it and before the one below')
	assert.deepEqual(h.api.calls.at(-1), { action: 'update', tag: TG(1), name: 'Kosten' })
	assert.deepEqual(await h.opsSince(u), [{ o: 'patch', id: B, p: { x: 300, y: 0 } }], 'both moves back (one op on the wire)')
	assert.equal(h.s.undoStack.canUndo(), false)
})

test('job 206 AK3: undoing a delete brings the tag back on every note that carried it, also on one that lost its id meanwhile', async () => {
	const C = ID(5)
	const F = ID(6)
	const more = [3, 4, 5, 6, 7, 8, 9].map((k) => ({ id: TG(k), name: 'T' + k, color: TAG_COLORS[k] }))
	const items = [...ITEMS,
		sticky(C, { x: 0, y: 300, z: 'i5', data: { text: 'C', tags: [TG(2), TG(1)] } }),
		sticky(F, { x: 300, y: 300, z: 'i6', data: { text: 'F', tags: [TG(1)] } })]
	const h = await open({ items, meta: { tags: [KOSTEN, ZEIT, ...more] } })
	await h.s.deleteTag(TG(1))
	assert.deepEqual(h.s.undoStack.peek('undo').tag.notes, [A, C, F], 'the notes that carried it')
	// meanwhile Bob writes the tags of C (the dead id falls out) and fills F with 8 others
	bob(h, [{ o: 'patch', id: C, p: { 'data.tags': [TG(2), TG(3)] } }, { o: 'patch', id: F, p: { 'data.tags': [TG(2), ...more.map((x) => x.id)] } }])
	// a locked note and a deleted one in the list get nothing either
	h.s.undoStack.peek('undo').tag.notes.push(L, ID(99))
	const u = h.tr.calls.length
	await h.s.undo()
	assert.deepEqual(h.api.calls.at(-1), { action: 'add', tags: [KOSTEN] })
	assert.deepEqual(await h.opsSince(u), [{ o: 'patch', id: C, p: { 'data.tags': [TG(2), TG(3), TG(1)] } }], 'only C: A still has the id, F is full, L locked, ID(99) gone')
	assert.deepEqual(h.scene.callsOf('setTags').at(-1)[1].map((x) => x.name).slice(0, 2), ['Zeit', 'T3'])
	assert.deepEqual(h.s.tagsView().tags.find((x) => x.id === TG(1)).count, 2, 'A and C show it again')
	assert.equal(h.model.get(A).data.tags[0], TG(1), 'at its old place on A')
	// redo deletes it again, the step remembers the notes that carry it now
	await h.s.redo()
	assert.deepEqual(h.s.undoStack.peek('undo').tag.notes, [A, C])
})

test('job 206 AK4: a tag someone else changed is skipped with a hint and the step vanishes', async () => {
	const h = await open()
	await h.s.renameTag(TG(1), 'Budget')
	await bobTags(h, { action: 'update', tag: TG(1), name: 'Geld' })
	const calls = h.api.calls.length
	await h.s.undo()
	assert.equal(h.api.calls.length, calls, 'nothing written')
	assert.deepEqual(h.log.at(-1), SKIPPED)
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, false])
	assert.equal(h.s.tagById(TG(1)).name, 'Geld', 'Bob\'s name stays')
	// undo of a create whose tag Bob renamed: the tag stays, its ticking goes back
	h.s.select([B])
	h.s.openTagPanel(null)
	await h.s.createTag('Risiko')
	const id = h.api.calls.at(-1).tags[0].id
	await bobTags(h, { action: 'update', tag: id, name: 'Gefahr' })
	const u = h.tr.calls.length
	await h.s.undo()
	assert.notEqual(h.api.calls.at(-1).action, 'delete')
	assert.deepEqual(h.log.at(-1), SKIPPED)
	assert.deepEqual(await h.opsSince(u), [{ o: 'patch', id: B, p: { 'data.tags': null } }])
	assert.equal(h.s.tagById(id).name, 'Gefahr')
	// undo of a rename whose tag Bob deleted: skipped
	await h.s.renameTag(TG(2), 'Dauer')
	await bobTags(h, { action: 'delete', tag: TG(2) })
	await h.s.undo()
	assert.deepEqual(h.log.at(-1), SKIPPED)
	assert.equal(h.s.tagById(TG(2)), null)
})

test('job 206 AK4: a failed write or an add the server skips leaves the step; the next undo tries again', async () => {
	const h = await open()
	await h.s.deleteTag(TG(1))
	// Bob creates "kosten" meanwhile: the server skips the add
	await bobTags(h, { action: 'add', tags: [{ id: TG(7), name: 'kosten', color: TAG_COLORS[7] }] })
	const u = h.tr.calls.length
	await h.s.undo()
	assert.deepEqual(h.log.at(-1), ['info', 'A tag with this name already exists.', 'tag-exists'])
	assert.equal(h.s.tagById(TG(1)), null)
	assert.deepEqual(await h.opsSince(u), [], 'no note patch')
	assert.deepEqual([h.s.undoStack.done.length, h.s.undoStack.canRedo()], [1, false], 'the step stays')
	// a network error: the hint tag-failed, the step stays, the next undo sends again
	await bobTags(h, { action: 'delete', tag: TG(7) })
	h.api.fail = new Error('offline')
	await h.s.undo()
	assert.deepEqual(h.log.at(-1), ['toast', 'The tag could not be saved.', 'tag-failed'])
	assert.equal(h.s.undoStack.done.length, 1)
	h.api.fail = null
	await h.s.undo()
	assert.deepEqual(h.s.tagById(TG(1)), KOSTEN)
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, true])
	// 100 tags: the hint tag-limit
	const full = await open()
	await full.s.deleteTag(TG(1))
	full.api.fail = new HttpError(409, 'tag_limit', 'limit', null, true)
	await full.s.undo()
	assert.deepEqual(full.log.at(-1), ['info', 'A board can have at most 100 tags.', 'tag-limit'])
	assert.equal(full.s.undoStack.done.length, 1)
})

test('job 206 AK5: undo and redo of tag steps run one after another; a step made meanwhile ends redo', async () => {
	const h = await open()
	await h.s.renameTag(TG(1), 'Budget')
	await h.s.renameTag(TG(1), 'Geld')
	h.api.calls.length = 0
	// the server answers only when the test lets it
	const save = h.api.save
	const gates = []
	h.api.save = (body) => new Promise((resolve) => gates.push(() => resolve(save(body))))
	h.s.undo()
	const second = h.s.undo()
	await h.clock.advance(0)
	assert.equal(gates.length, 1, 'the second write waits for the answer of the first')
	gates[0]()
	await h.clock.advance(0)
	await new Promise((r) => setImmediate(r))
	assert.equal(gates.length, 2)
	gates[1]()
	await second
	assert.deepEqual(h.api.calls, [{ action: 'update', tag: TG(1), name: 'Budget' }, { action: 'update', tag: TG(1), name: 'Kosten' }])
	// redo, and while its write runs a note moves: the redo lands below the move, nothing to redo
	const third = h.s.redo()
	await new Promise((r) => setImmediate(r))
	h.s.commit({ ops: [{ o: 'patch', id: B, p: { x: 350 } }], inverse: [{ o: 'patch', id: B, p: { x: 300 } }] })
	gates[2]()
	await third
	assert.equal(h.s.tagById(TG(1)).name, 'Budget')
	assert.equal(h.s.undoStack.canRedo(), false)
	assert.deepEqual(h.s.undoStack.done.map((x) => (x.tag ? 'tag' : 'move')), ['tag', 'move'])
	// an undo while a write runs, then a new step: the undone step does not land on the redo side
	const fourth = h.s.undo()
	await new Promise((r) => setImmediate(r))
	assert.equal(gates.length, 3, 'the move goes back at once (no tag step)')
	const fifth = h.s.undo()
	await new Promise((r) => setImmediate(r))
	h.s.commit({ ops: [{ o: 'patch', id: B, p: { y: 50 } }], inverse: [{ o: 'patch', id: B, p: { y: 0 } }] })
	gates[3]()
	await fifth
	assert.equal(fourth, undefined)
	assert.equal(h.s.tagById(TG(1)).name, 'Kosten')
	assert.equal(h.s.undoStack.canRedo(), false)
})

test('job 227 AK3: a tag with an old colour shows its new tone in the panels (tagsView) and the scene gets it as stored; the stored colour stays', async () => {
	const h = await open({ meta: { tags: [{ id: TG(1), name: 'Kosten', color: '#e53935' }] } })
	assert.equal(h.s.tagsView().tags.find((x) => x.id === TG(1)).color, '#c43e45')
	assert.equal(h.s.boardTags().find((x) => x.id === TG(1)).color, '#e53935')
	assert.equal(h.scene.callsOf('setTags').at(-1)[1].find((x) => x.id === TG(1)).color, '#e53935', 'the renderer maps it itself (scene/tags.test.mjs)')
	h.s.destroy?.()
})

test('job 230 AK4: selection v2 tags – the tags of the board on the selected notes with their counts (shown colours), [] for nothing writable; filterSelectionByTag keeps the items with the tag, no op, no undo step, nothing outside mode edit', async () => {
	const C = ID(5)
	const h = await open({ items: [...ITEMS, sticky(C, { x: 1200, y: 0, z: 'i5', data: { text: 'C', tags: [TG(1), TG(2)] } })] })
	h.s.select([A, B, L, S, C])
	assert.deepEqual(h.s.selectionInfo().tags.map((t) => [t.id, t.name, t.count]), [[TG(1), 'Kosten', 2], [TG(2), 'Zeit', 2]], 'the order of the board, a locked note counts')
	assert.ok(h.s.selectionInfo().tags.every((t) => /^#[0-9a-f]{6}$/.test(t.color)))
	const n = h.tr.calls.length
	assert.equal(h.s.filterSelectionByTag(TG(1)), true)
	assert.deepEqual(h.s.selection, [A, C])
	assert.equal(h.s.undoStack.canUndo(), false, 'no undo step')
	assert.deepEqual(await h.opsSince(n), [], 'no op')
	assert.equal(h.s.filterSelectionByTag(TG(1)), false, 'every selected item has it: nothing changes')
	assert.equal(h.s.filterSelectionByTag(TG(2)), true)
	assert.deepEqual(h.s.selection, [C])
	h.s.select([A, B])
	assert.equal(h.s.filterSelectionByTag(TG(2)), false, 'no selected item has it')
	assert.equal(h.s.filterSelectionByTag('nope'), false, 'no tag of the board')
	assert.equal(h.s.filterSelectionByTag(null), false)
	assert.deepEqual(h.s.selection, [A, B])
	const v = await open({ me: VIEWER })
	v.s.select([A, B])
	assert.equal(v.s.filterSelectionByTag(TG(1)), false, 'mode view')
	assert.deepEqual(v.s.selectionInfo().tags, [], 'mode view: nothing to narrow')
})
