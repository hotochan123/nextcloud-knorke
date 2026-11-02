/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/**
 * Factory job 257 (tags out of BoardSession, board/sessionTags.js):
 * BoardSession keeps thin methods that hand over to SessionTags; undo and
 * redo of tag steps (recordTagStep, sendTagHistory) stay in the class.
 * Nothing visible changes.
 *
 * - AK1: every moved method, recordTagStep, sendTagHistory and the static
 *   tagRect are still functions of BoardSession: BoardView, the menus and
 *   the tests call them on the session.
 * - AK2: undo and redo of a tag rename while the tag route answers slowly:
 *   the panel shows busy, a second undo waits, the names and route bodies
 *   are right, the note keeps its tag id.
 * - AK4: sessionTags.js never imports BoardSession.js.
 * - AK6: info replaced on the instance after the constructor is the one
 *   called; the state stays a field of the session (tagPanel, tagFilter).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import { HttpError } from '../../../src/sync/http.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, memoryStorage, sticky } from './fakes.mjs'

/** The 29 methods of job 257, in the order of the old block. */
const MOVED = Object.freeze([
	'tagApi', 'boardTags', 'mayTag', 'tagTargets', 'pushTags', 'tagsView', 'emitTags',
	'openTagPanel', 'openTagFilter', 'openTagList', 'closeTagPanel', 'checkTags',
	'tickTag', 'createTag', 'renameTag', 'recolorTag', 'deleteTag', 'changeTag', 'tagById', 'notesWithTag',
	'retag', 'saveTags', 'tagFailed', 'setTagFilter', 'toggleTagFilter', 'selectWithTag', 'tagAction', 'withPasteTags',
])

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const TG = (n) => '01JT' + String(n).padStart(22, '0')
const KOSTEN = { id: TG(1), name: 'Kosten', color: '#0275a9' }
const A = ID(1)
const ITEMS = Object.freeze([sticky(A, { x: 0, y: 0, z: 'i1', data: { text: 'A', tags: [TG(1)] } })])

class TagScene extends FakeScene {
	setMode(mode) {
		this.viewOnly = mode !== 'edit'
	}

	setVoteState() {}

	setTags() {}

	setTagFilter() {}

	getViewport() {
		return { x: 0, y: 0, w: 1280, h: 800 }
	}
}

/**
 * @return {Promise<object>} a session on a board with the tag Kosten on note A, its tag route and the clock
 */
async function open() {
	const clock = new FakeClock(10000)
	const live = new Map(ITEMS.map((it) => [it.id, structuredClone(it)]))
	let rev = 5
	const board = { meta: { tags: [structuredClone(KOSTEN)] }, metaRev: 3 }
	const api = {
		calls: [],
		async save(body) {
			api.calls.push(structuredClone(body))
			const list = structuredClone(board.meta.tags)
			const tg = list.find((x) => x.id === body.tag)
			if (body.action === 'update' && tg && body.name !== undefined) tg.name = body.name
			board.meta = { ...board.meta, tags: list }
			board.metaRev++
			return { board: { title: 'Retro', meta: structuredClone(board.meta), metaRev: board.metaRev }, now: T0 }
		},
	}
	const views = []
	const log = []
	const tr = {
		kind: 'user',
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev, minRev: 0, board: { id: 7, title: 'Retro', role: 'owner', metaRev: board.metaRev, meta: structuredClone(board.meta) }, me: ALICE, items: structuredClone(ITEMS) }
		},
		async sync(body, opts = {}) {
			if (opts.keepalive) return {}
			const res = (body.ops ?? []).map((op) => {
				if (op.o === 'put') live.set(op.id, itemFromPut(op))
				else if (op.o === 'patch' && live.has(op.id)) applyPatch(live.get(op.id), structuredClone(op.p))
				rev++
				return 'ok'
			})
			const out = { rev, items: [], removed: [], presence: {} }
			if (body.ops) out.acks = { seq: body.seq, rev, res }
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
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			rand: () => 0.5,
			win: null,
			toast: (m, o) => log.push(['toast', m, o?.hook ?? null]),
			info: (m, o) => log.push(['info', m, o?.hook ?? null]),
			wall: () => T0,
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, api, log, views }
}

const tick = () => new Promise((r) => setImmediate(r))

test('AK1: the moved tag methods, recordTagStep, sendTagHistory and tagRect are still functions of BoardSession', () => {
	assert.equal(MOVED.length, 28)
	for (const name of [...MOVED, 'recordTagStep', 'sendTagHistory']) {
		assert.equal(typeof BoardSession.prototype[name], 'function', name)
	}
	assert.equal(typeof BoardSession.tagRect, 'function')
	assert.deepEqual(BoardSession.tagRect({ x: 1, y: 2, w: 3, h: 4, z: 9 }), { x: 1, y: 2, w: 3, h: 4 })
	assert.equal(BoardSession.tagRect({ x: 1, y: 2, w: Number.NaN, h: 4 }), null)
})

test('AK2: undo and redo of a tag rename while the network is slow', async () => {
	const h = await open()
	assert.equal(await h.s.renameTag(TG(1), 'Budget'), true)
	assert.equal(h.s.tagById(TG(1)).name, 'Budget')
	h.api.calls.length = 0
	// from now on the tag route answers only when the test lets it
	const save = h.api.save
	const gates = []
	h.api.save = (body) => new Promise((resolve) => gates.push(() => resolve(save(body))))

	const first = h.s.undo()
	await h.clock.advance(0)
	await tick()
	assert.equal(gates.length, 1)
	assert.equal(h.s.tagsView().busy, true, 'the panel shows the running write')
	assert.equal(h.views.at(-1).busy, true)
	const second = h.s.undo()
	await tick()
	assert.equal(gates.length, 1, 'a second undo sends no second write while the first waits')
	gates[0]()
	await first
	await second
	assert.equal(gates.length, 1, 'nothing more to undo')
	assert.equal(h.s.tagById(TG(1)).name, 'Kosten')
	assert.equal(h.s.tagsView().busy, false)
	assert.equal(h.views.at(-1).busy, false)
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [false, true])
	assert.deepEqual(h.s.model.get(A).data.tags, [TG(1)])

	const third = h.s.redo()
	await tick()
	assert.equal(gates.length, 2)
	assert.equal(h.s.tagsView().busy, true)
	assert.equal(h.s.tagById(TG(1)).name, 'Kosten', 'the name changes only with the answer')
	gates[1]()
	await third
	assert.equal(h.s.tagById(TG(1)).name, 'Budget')
	assert.equal(h.s.tagsView().busy, false)
	assert.deepEqual([h.s.undoStack.canUndo(), h.s.undoStack.canRedo()], [true, false])
	assert.deepEqual(h.api.calls, [{ action: 'update', tag: TG(1), name: 'Kosten' }, { action: 'update', tag: TG(1), name: 'Budget' }])
	assert.deepEqual(h.s.model.get(A).data.tags, [TG(1)], 'the note keeps the tag id throughout')
	assert.equal(h.log.length, 0, 'no hint')
	h.s.destroy?.()
})

test('AK4: sessionTags.js does not import BoardSession.js', () => {
	const src = readFileSync(new URL('../../../src/board/sessionTags.js', import.meta.url), 'utf8')
	assert.doesNotMatch(src, /from '\.\/BoardSession\.js'/)
	assert.doesNotMatch(src, /import\(['"]\.\/BoardSession/)
})

test('AK6: info replaced on the instance is the one the module calls', async () => {
	const h = await open()
	const seen = []
	h.s.info = (m, o) => seen.push(o?.hook ?? null)
	h.s.tagFailed(new HttpError(409, 'tag_exists', 'exists', null, true))
	assert.deepEqual(seen, ['tag-exists'])
	assert.equal(h.log.length, 0, 'not the info of the constructor')
	h.s.destroy?.()
})

test('AK6: the panel and the filter stay fields of the session', async () => {
	const h = await open()
	assert.equal(h.s.openTagFilter(), true)
	assert.equal(h.s.tagPanel.kind, 'filter')
	h.s.setTagFilter([TG(1), 'unknown'])
	assert.deepEqual(h.s.tagFilter, [TG(1)])
	assert.deepEqual(h.views.at(-1).filter, [TG(1)])
	h.s.closeTagPanel({ focus: false })
	assert.equal(h.s.tagPanel, null)
	h.s.destroy?.()
})
