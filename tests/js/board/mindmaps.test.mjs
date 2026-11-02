/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 195 (AK3): mind maps in BoardSession, with the fake scene and
 * a small LWW server that applies, checks (checkMindmap) and echoes the ops:
 * - creating: one put of the empty root, selected, the root's editor; its
 *   first text and the creation are one undo step
 * - Tab, Enter, the "+" and the menu add a node, focus it and open its
 *   editor; the node and its first text are one undo step
 * - after every patch the root stays at its world point (±0.01)
 * - moving (before, after, as a child, to the other side), colour, shape,
 *   folding, "Right only"; a branch of 60 nodes deleted in patches of at
 *   most 50 paths, undo brings it back
 * - the limits send nothing; a locked map, modes view and vote and a frozen
 *   board send nothing
 * - an indented list pasted: one put; a flat list notes; a cut list the info
 * - "Copy as text" copies the subtree
 * - (job 196) a node dropped on empty space: one patch with m and the box,
 *   the root stays, a main branch over the middle line changes side, 60
 *   free nodes below it in patches of at most 50 paths as one undo step;
 *   "Rearrange" on a node and at the root; nothing when locked, in modes
 *   view and vote, frozen
 * - (job 198) Mind map, Right only, Org chart, Tree: one patch with the box
 *   each, the root stays, d and m stay; in org no side for a new main
 *   branch, no "Rearrange", no free place, the shape drawn sends nothing
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoardSession } from '../../../src/board/BoardSession.js'
import { applyPatch, itemFromPut } from '../../../src/model/paths.js'
import {
	MM_PATCH_PATHS, bucketOf, checkMindmap, mindTree, mindmapLayout, nodePath, nodeText, rowOf, sideOf, textPath,
} from '../../../src/model/mindmap.js'
import { MM_COLORS } from '../../../src/model/tokens.js'
import { plainTextOf, validatePayload } from '../../../src/board/clipboard.js'
import { bubbleAnchors } from '../../../src/board/comments.js'
import { FakeClock } from '../sync/fakeClock.mjs'
import { FakeScene, ID, RoutedModel, memoryStorage } from './fakes.mjs'

const T0 = 1760100000000
const ALICE = { pid: 'pidalice00000001', name: 'Alice Adler', role: 'owner', guest: false, mod: true, source: 'own' }
const M = ID('M1')
const R = 'n00000000'
const A = 'n10000000'
const B = 'n20000000'
const A1 = 'n30000000'

/** A stored mind map: root "Thema", right A (child A1), right B; its box as the estimate lays it out. */
function mindmap(extra = {}) {
	const nodes = { b0: { [R]: { o: 'i0' } }, b1: { [A]: { o: 'i0', p: R, c: MM_COLORS[0] } }, b2: { [B]: { o: 'i1', p: R, c: MM_COLORS[1] } }, b3: { [A1]: { o: 'i0', p: A } } }
	const texts = { b0: { [R]: 'Thema' }, b1: { [A]: 'Alpha' }, b2: { [B]: 'Beta' }, b3: { [A1]: 'a1' } }
	const it = { id: M, t: 'mindmap', x: 100, y: 200, w: 0, h: 0, r: 0, z: 'i5', parent: null, data: { nodes, texts }, style: {}, group: null, lock: null, ...extra }
	const l = mindmapLayout(it)
	return { ...it, w: Math.round(l.w * 100) / 100, h: Math.round(l.h * 100) / 100 }
}

/** LWW server: applies like §4.6, mind maps keep their form, answers with every item changed since the cursor. */
function lwwServer(items) {
	const srv = { live: new Map(items.map((it) => [it.id, structuredClone(it)])), dead: new Set(), rev: 5, changed: [] }
	const apply = (op) => {
		if (op.o === 'put') {
			if (srv.live.has(op.id)) return 'dup'
			if (srv.dead.has(op.id) && op.revive !== true) return 'gone'
			const it = itemFromPut(op)
			if (it.t === 'mindmap' && !checkMindmap(it.data)) return 'bad'
			srv.live.set(op.id, it)
			srv.dead.delete(op.id)
		} else if (op.o === 'patch') {
			const it = srv.live.get(op.id)
			if (!it) return 'gone'
			if (Object.keys(op.p).length > 50) return 'bad'
			const next = applyPatch(structuredClone(it), structuredClone(op.p))
			if (next.t === 'mindmap' && !checkMindmap(next.data)) return 'bad'
			srv.live.set(op.id, next)
		} else if (op.o === 'remove') {
			if (!srv.live.has(op.id)) return 'gone'
			srv.live.delete(op.id)
			srv.dead.add(op.id)
		} else {
			return 'bad'
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

async function open({ items = [mindmap()], me = ALICE, limits = null, copyText = null } = {}) {
	const clock = new FakeClock(10000)
	const infos = []
	const toasts = []
	const copied = []
	const srv = lwwServer(items)
	const tr = {
		kind: 'user',
		calls: [],
		async snapshot() {
			return { proto: 2, epoch: 'k3x9a0b2', now: T0, rev: srv.rev, minRev: 0, board: { id: 7, title: 'Retro', role: me.role, metaRev: 3, meta: {} }, me, items: [...srv.live.values()].map((it) => structuredClone(it)) }
		},
		async sync(body) {
			tr.calls.push(structuredClone(body))
			const res = body.ops ? srv.apply(body.ops) : null
			const out = { rev: srv.rev, ...srv.since(body.since), presence: {} }
			if (res) out.acks = { seq: body.seq, rev: srv.rev, res }
			return out
		},
	}
	let seed = 0
	const s = new BoardSession({
		container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
		mode: 'user',
		boardId: 7,
		limits,
		ui: {},
		deps: {
			SceneModel: RoutedModel,
			SceneManager: FakeScene,
			transport: tr,
			storage: memoryStorage(),
			now: clock.now,
			sleep: clock.sleep,
			// distinct keys for every new node
			rand: () => {
				seed = (seed + 0.0371) % 1
				return seed
			},
			win: null,
			toast: (m, o) => toasts.push(o?.hook ? [m, o.hook] : m),
			info: (m, o) => infos.push(o?.hook ? [m, o.hook] : m),
			wall: () => T0 - 10000 + clock.now(),
			copyText: copyText ?? ((text) => {
				copied.push(text)
				return Promise.resolve(true)
			}),
		},
	})
	await s.open()
	await clock.advance(0)
	return { s, clock, tr, srv, infos, toasts, copied, scene: s.scene, model: s.model }
}

/** @return {Promise<object[]>} the ops sent since call n */
async function opsAfter(h, n) {
	await h.clock.advance(200)
	return h.tr.calls.slice(n).flatMap((b) => b.ops ?? [])
}

const cb = (h) => h.scene.callbacks
const live = (h) => h.srv.live.get(M)
/** @return {{x: number, y: number}} the world point of the root as the estimate lays the item out */
const rootAt = (it) => {
	const l = mindmapLayout(it)
	const r = l.byKey.get(l.root)
	return { x: it.x + r.x, y: it.y + r.y }
}
const near = (a, b, label) => {
	assert.ok(Math.abs(a.x - b.x) <= 0.01 && Math.abs(a.y - b.y) <= 0.01, `${label}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
}
/** the last key the scene was asked to focus */
const focused = (h) => h.scene.callsOf('focusNode').at(-1)?.[2] ?? null

test('AK3: the tool M puts the empty root, selects it and opens its editor; me.e/me.ec while it is open; its first text and the creation one undo step', async () => {
	const h = await open({ items: [] })
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'create', t: 'mindmap', at: { x: 500, y: 300 }, rect: null })
	const id = h.scene.selection[0]
	assert.ok(id)
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(1), [id, {}], 'the scene opens the root (its default)')
	const it = h.model.get(id)
	const root = mindTree(it).root
	assert.deepEqual([it.w, it.h, it.x, it.y], [120, 48, 440, 276], 'centred on the point')
	cb(h).onEditing(id, false, root)
	assert.deepEqual([h.s.getPresence().e, h.s.getPresence().ec], [id, root])
	cb(h).onIntent({ type: 'text', id, path: textPath(root), value: 'Ideen', before: '', final: true, cell: root })
	cb(h).onEditing(null, false)
	const ops = await opsAfter(h, n)
	assert.equal(ops[0].o, 'put')
	assert.equal(checkMindmap(ops[0].p.data), true)
	assert.equal(nodeText(h.srv.live.get(id).data, root), 'Ideen')
	assert.equal(h.s.undoStack.done.length, 1, 'creation and first text: one step')
	h.s.undo()
	await opsAfter(h, h.tr.calls.length)
	assert.equal(h.srv.live.has(id), false, 'one undo removes it')
})

test('AK3: Tab adds a child, Enter a sibling, the "+" of the root a main branch on its side; each gets the focus and its editor; node and first text one undo step; the root stays', async () => {
	const h = await open()
	h.s.select([M])
	const r0 = rootAt(live(h))
	// Tab at A: a child of A, focused, its editor open
	cb(h).onIntent({ type: 'mmAdd', id: M, key: A, as: 'child', open: true })
	await opsAfter(h, 0)
	const c = focused(h)
	assert.ok(c && c !== A1)
	assert.equal(mindTree(live(h)).nodes.get(c).parent, A)
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(1), [M, { cell: c }])
	near(rootAt(live(h)), r0, 'after a child')
	// its first text merges with its creation
	cb(h).onEditing(M, false, c)
	cb(h).onIntent({ type: 'text', id: M, path: textPath(c), value: 'neu', before: '', final: true, cell: c })
	cb(h).onEditing(null, false)
	await opsAfter(h, 0)
	assert.equal(h.s.undoStack.done.length, 1, 'the node and its text: one step')
	near(rootAt(live(h)), r0, 'after the text')
	// Enter at A1: a sibling right after it
	cb(h).onIntent({ type: 'mmAdd', id: M, key: A1, as: 'sibling', open: true })
	await opsAfter(h, 0)
	const sib = focused(h)
	assert.equal(mindTree(live(h)).nodes.get(A).kids.indexOf(sib), mindTree(live(h)).nodes.get(A).kids.indexOf(A1) + 1, 'right after A1')
	// the "+" left of the root: a main branch on the left with the next colour
	cb(h).onIntent({ type: 'mmAdd', id: M, key: R, as: 'child', side: 'l', open: true })
	await opsAfter(h, 0)
	const left = focused(h)
	const t = mindTree(live(h))
	assert.equal(sideOf(t, left), -1)
	assert.equal(t.nodes.get(left).n.c, MM_COLORS[2])
	near(rootAt(live(h)), r0, 'after a left branch')
	// Enter at the root: a child as well (no sibling of the root)
	cb(h).onIntent({ type: 'mmAdd', id: M, key: R, as: 'sibling', open: false })
	await opsAfter(h, 0)
	assert.equal(mindTree(live(h)).nodes.get(focused(h)).parent, R)
	near(rootAt(live(h)), r0, 'after a fourth main branch')
	// undo step by step: every node goes, the root stays
	while (h.s.undoStack.canUndo()) h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data, mindmap().data)
	near(rootAt(live(h)), r0, 'after the undos')
})

test('AK3: move before, after, as a child and to the other side; colour, shape, fold, "Right only"; one undo step each; the root stays', async () => {
	const h = await open()
	h.s.select([M])
	const r0 = rootAt(live(h))
	const steps = () => h.s.undoStack.done.length
	cb(h).onIntent({ type: 'mmMove', id: M, key: B, target: { key: A1, where: 'child', side: null } })
	await opsAfter(h, 0)
	assert.equal(mindTree(live(h)).nodes.get(B).parent, A1)
	cb(h).onIntent({ type: 'mmMove', id: M, key: B, target: { key: A, where: 'before', side: null } })
	await opsAfter(h, 0)
	assert.deepEqual(rowOf(mindTree(live(h)), A), [B, A])
	cb(h).onIntent({ type: 'mmMove', id: M, key: B, target: { key: R, where: 'child', side: 'l' } })
	await opsAfter(h, 0)
	assert.equal(sideOf(mindTree(live(h)), B), -1, 'to the left')
	near(rootAt(live(h)), r0, 'after the moves')
	assert.equal(steps(), 3)
	// colour and shape of the focused node
	cb(h).onNodeFocus(M, A)
	assert.equal(h.s.selectionInfo().mindmap.node.key, A)
	assert.equal(h.s.mindmapStyle('color', '#c43e45'), true)
	// job 266 (AK2): a main branch is a pill by default; line is stored, pill again is stored as none
	assert.equal(h.s.mindmapStyle('shape', 'pill'), false, 'the default shape of a main branch: nothing')
	assert.equal(h.s.mindmapStyle('shape', 'line'), true)
	assert.equal(h.s.mindmapStyle('shape', 'line'), false, 'the same shape again: nothing')
	await opsAfter(h, 0)
	assert.deepEqual([live(h).data.nodes.b1[A].c, live(h).data.nodes.b1[A].s], ['#c43e45', 'line'])
	assert.deepEqual([h.s.selectionInfo().mindmap.node.color, h.s.selectionInfo().mindmap.node.shape], ['#c43e45', 'line'])
	assert.equal(h.s.mindmapStyle('shape', 'pill'), true, 'the default shape: stored as none')
	await opsAfter(h, 0)
	assert.equal(live(h).data.nodes.b1[A].s, undefined)
	assert.equal(h.s.selectionInfo().mindmap.node.shape, 'pill')
	// fold A, then right only
	cb(h).onIntent({ type: 'mmFold', id: M, key: A })
	await opsAfter(h, 0)
	assert.equal(live(h).data.nodes.b1[A].f, true)
	assert.equal(h.s.mindmapStyle('layout', 'right'), true)
	await opsAfter(h, 0)
	assert.equal(live(h).style.layout, 'right')
	assert.equal(h.s.selectionInfo().mindmap.layout, 'right')
	near(rootAt(live(h)), r0, 'after colour, shape, fold and layout')
	assert.equal(steps(), 8)
	while (h.s.undoStack.canUndo()) h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([live(h).data, live(h).style], [mindmap().data, {}])
})

test('AK3: a branch of 60 nodes: deleted in patches of at most 50 paths, one undo step; undo brings every node with its text; the focus goes to the neighbour', async () => {
	const base = mindmap()
	const A36 = '0123456789abcdefghijklmnopqrstuvwxyz'
	let prev = B
	for (let i = 0; i < 60; i++) {
		const k = 'n' + A36[i % 36] + String(Math.floor(i / 36) + 5).padStart(7, '0')
		base.data.nodes[bucketOf(k)] = base.data.nodes[bucketOf(k)] ?? {}
		base.data.nodes[bucketOf(k)][k] = { o: 'i0', p: prev }
		base.data.texts[bucketOf(k)] = base.data.texts[bucketOf(k)] ?? {}
		base.data.texts[bucketOf(k)][k] = 'n' + i
		prev = k
	}
	assert.equal(checkMindmap(base.data), true)
	const l = mindmapLayout(base)
	const item = { ...base, w: Math.round(l.w * 100) / 100, h: Math.round(l.h * 100) / 100 }
	const h = await open({ items: [item] })
	h.s.select([M])
	const r0 = rootAt(live(h))
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'mmDelete', id: M, key: B })
	const ops = await opsAfter(h, n)
	assert.ok(ops.length >= 3, 'several patches')
	assert.ok(ops.every((op) => Object.keys(op.p).length <= MM_PATCH_PATHS))
	assert.equal(mindTree(live(h)).nodes.size, 3, 'root, A, A1')
	assert.equal(focused(h), A, 'the node before it in its row')
	near(rootAt(live(h)), r0, 'after the delete')
	assert.equal(h.s.undoStack.done.length, 1)
	h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data, item.data, 'every node with its text')
	near(rootAt(live(h)), r0, 'after the undo')
})

test('AK3: the limits send nothing (500 nodes, the map is full); a text that does not fit keeps the editor with its notice', async () => {
	const big = mindmap()
	const A36 = '0123456789abcdefghijklmnopqrstuvwxyz'
	for (let i = 0; i < 496; i++) {
		const k = 'n' + A36[i % 36] + String(Math.floor(i / 36) + 5).padStart(7, '0')
		big.data.nodes[bucketOf(k)] = big.data.nodes[bucketOf(k)] ?? {}
		big.data.nodes[bucketOf(k)][k] = { o: 'i1', p: A1 }
	}
	assert.equal(checkMindmap(big.data), true)
	const h = await open({ items: [big] })
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'mmAdd', id: M, key: A, as: 'child', open: true })
	assert.deepEqual(h.infos, [['A mind map can have at most 500 nodes.', 'mindmap-limit']])
	assert.deepEqual(await opsAfter(h, n), [])
	// the sample takes 323 bytes: room for 7 more
	const small = await open({ limits: { maxItemBytes: 330 } })
	const m = small.tr.calls.length
	small.s.select([M])
	cb(small).onIntent({ type: 'mmAdd', id: M, key: A, as: 'child' })
	assert.deepEqual(small.infos, [['The mind map is full.', 'mindmap-full']])
	cb(small).onEditing(M, false, B)
	cb(small).onIntent({ type: 'text', id: M, path: textPath(B), value: 'x'.repeat(400), before: 'Beta', final: false, cell: B })
	assert.deepEqual(small.scene.callsOf('setEditorNotice').at(-1), ['setEditorNotice', M, 'Not saved: the mind map is full. Copy your text before closing.', B])
	assert.deepEqual(await opsAfter(small, m), [])
})

test('AK3: a locked map, modes view and vote and a frozen board send nothing', async () => {
	const locked = await open({ items: [mindmap({ lock: { by: 'pidbob', name: 'Bob' } })] })
	let n = locked.tr.calls.length
	cb(locked).onIntent({ type: 'mmAdd', id: M, key: A, as: 'child' })
	cb(locked).onIntent({ type: 'mmFold', id: M, key: A })
	cb(locked).onIntent({ type: 'mmDelete', id: M, key: A })
	cb(locked).onIntent({ type: 'mmMove', id: M, key: B, target: { key: A, where: 'child' } })
	assert.deepEqual(await opsAfter(locked, n), [])
	for (const role of ['view', 'vote']) {
		const h = await open({ me: { ...ALICE, role, mod: false } })
		n = h.tr.calls.length
		cb(h).onIntent({ type: 'mmAdd', id: M, key: A, as: 'child' })
		h.s.mindmapAdd(M, A, 'child')
		h.s.mindmapDelete(M, A)
		assert.deepEqual(await opsAfter(h, n), [], role)
	}
	const frozen = await open()
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.mindmapAdd(M, A, 'child')
	frozen.s.mindmapStep(M, () => ({ p: { [nodePath(A) + '.f']: true }, inv: {} }))
	assert.deepEqual(frozen.tr.calls.slice(n).flatMap((b) => b.ops ?? []), [])
})

test('AK3: an indented list pasted is one put of a mind map, selected, its root at the point; a flat list stays notes; a cut list names the lines left out', async () => {
	const h = await open({ items: [] })
	const n = h.tr.calls.length
	h.s.pasteText('Thema\n\tA\n\t\tA1\n\tB', { x: 300, y: 300 })
	const ops = await opsAfter(h, n)
	assert.equal(ops.length, 1)
	assert.deepEqual([ops[0].o, ops[0].t], ['put', 'mindmap'])
	const it = h.srv.live.get(ops[0].id)
	assert.equal(checkMindmap(it.data), true)
	const l = mindmapLayout(it)
	const r = l.byKey.get(l.root)
	near({ x: it.x + r.x + r.w / 2, y: it.y + r.y + r.h / 2 }, { x: 300, y: 300 }, 'the root at the point')
	assert.deepEqual(h.scene.selection, [ops[0].id])
	const flat = await open({ items: [] })
	const m = flat.tr.calls.length
	flat.s.pasteText('- a\n- b\n- c', { x: 0, y: 0 })
	const notes = await opsAfter(flat, m)
	assert.deepEqual(notes.map((op) => op.t), ['sticky', 'sticky', 'sticky'])
	const cut = await open({ items: [] })
	cut.s.pasteText(['Root', ...Array.from({ length: 520 }, (_, i) => '\tline ' + i)].join('\n'), { x: 0, y: 0 })
	await opsAfter(cut, 0)
	assert.deepEqual(cut.infos, [['21 lines were left out.', 'mindmap-cut']])
})

test('AK3: "Copy as text" copies the node and its subtree; the menu on a node has the mind map entries; Ctrl/⌘+C puts the list into text/plain', async () => {
	const menus = []
	const h = await open()
	h.s.ui.onContextMenu = (x) => menus.push(x)
	h.s.select([M])
	assert.equal(h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: A }), true)
	assert.deepEqual(menus.at(-1).mindmap, { root: false, kids: 1, folded: false, locked: false, placed: false })
	h.s.menuAction('mm-text')
	await h.clock.advance(0)
	assert.deepEqual(h.copied, ['Alpha\n\ta1'])
	assert.deepEqual(h.infos.at(-1), ['Copied as text.', 'mindmap-copied'])
	// the menu without a node: the root
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10] })
	assert.deepEqual(menus.at(-1).mindmap, { root: true, kids: 2, folded: false, locked: false, placed: false })
	h.s.menuAction('mm-text')
	await h.clock.advance(0)
	assert.equal(h.copied.at(-1), 'Thema\n\tAlpha\n\t\ta1\n\tBeta')
	// the menu's "Add child" adds and opens the editor
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: B })
	h.s.menuAction('mm-child')
	await opsAfter(h, 0)
	assert.equal(mindTree(live(h)).nodes.get(focused(h)).parent, B)
	assert.deepEqual(h.scene.callsOf('openTextEditor').at(-1).slice(1), [M, { cell: focused(h) }])
	// a failed copy: the toast
	const bad = await open({ copyText: () => Promise.resolve(false) })
	bad.s.select([M])
	bad.s.copyMindmapText(M, null)
	await bad.clock.advance(0)
	assert.deepEqual(bad.toasts, ['The text could not be copied.'])
})

test('AK3: Ctrl/⌘+C puts the indented list into text/plain; a pasted payload keeps only mind maps of a valid form', () => {
	const it = mindmap()
	assert.equal(plainTextOf({ items: [it] }), 'Thema\n\tAlpha\n\t\ta1\n\tBeta')
	const ok = validatePayload({ knorke: 1, board: 7, origin: [0, 0], items: [{ ...it, x: 0, y: 0 }] })
	assert.equal(ok.ok, true)
	assert.equal(ok.payload.items.length, 1)
	const broken = structuredClone(it)
	broken.data.nodes.b9 = { n9zzzzzzz: { o: 'i0' } }
	const bad = validatePayload({ knorke: 1, board: 7, origin: [0, 0], items: [{ ...broken, x: 0, y: 0 }, { ...it, id: ID('M2'), x: 0, y: 0 }] })
	assert.equal(bad.payload.items.length, 1, 'a second root: left out')
	assert.equal(bad.skipped, 1)
})

test('AK3 (comments): the bubble of a thread on a node sits at that node, at its folded ancestor when hidden, at the root when gone', async () => {
	const h = await open()
	const thread = (node) => ({ id: '1', item: M, node, x: 0, y: 0, resolved: false, comments: [{ id: '1', parts: ['x'], at: 1 }] })
	const corner = (b) => ({ x: b.x + b.w, y: b.y })
	const at = (node) => bubbleAnchors([thread(node)], (id, n) => h.s.liveCommentBox(id, n))[0]
	const a1 = h.scene.nodeBox(M, A1)
	assert.deepEqual({ x: at(A1).x, y: at(A1).y }, corner(a1))
	assert.deepEqual({ x: at('n99999999').x, y: at('n99999999').y }, corner(h.scene.nodeBox(M, R)), 'gone: the root')
	assert.equal(at(null).x, h.model.abs(M).x + h.model.abs(M).w, 'no node: the corner of the map')
	// folded: the bubble moves to A
	h.srv.apply([{ o: 'patch', id: M, p: { [nodePath(A) + '.f']: true } }])
	h.s.onChanges(h.srv.since(5).items, [])
	assert.deepEqual({ x: at(A1).x, y: at(A1).y }, corner(h.scene.nodeBox(M, A)))
	// "Comment" on the selected map: the focused node, else the root
	const composed = []
	h.s.ui.onCommentCompose = (p) => composed.push(p)
	h.s.select([M])
	h.s.commentOn(M)
	cb(h).onNodeFocus(M, B)
	h.s.commentOn(M)
	h.s.commentOn(M, A)
	assert.deepEqual(composed.map((p) => p.node), [R, B, A])
})

test('round 1: an undo whose place someone else changed meanwhile keeps the root where it is (the box from the state before the undo)', async () => {
	const h = await open()
	h.s.select([M])
	const r0 = rootAt(live(h))
	// alice: a main branch on the left (the hull grows left, x moves)
	cb(h).onIntent({ type: 'mmAdd', id: M, key: R, as: 'child', side: 'l', open: false })
	await opsAfter(h, 0)
	near(rootAt(live(h)), r0, 'after alice')
	// bob: a main branch on the right on his own base; his patch writes y
	const it = live(h)
	const p = { 'data.nodes.bz.nz0000000': { o: 'i5', p: R } }
	const l0 = mindmapLayout(it)
	const l1 = mindmapLayout(applyPatch(structuredClone(it), structuredClone(p)))
	Object.assign(p, { x: it.x + l0.byKey.get(R).x - l1.byKey.get(R).x, y: it.y + l0.byKey.get(R).y - l1.byKey.get(R).y, parent: null, w: l1.w, h: l1.h })
	assert.notEqual(p.y, it.y, 'bob moves the box')
	const rev = h.srv.rev
	h.srv.apply([{ o: 'patch', id: M, p }])
	h.s.onChanges(h.srv.since(rev).items, [])
	await opsAfter(h, 0)
	near(rootAt(live(h)), r0, 'after bob')
	// alice undoes her branch: the step's place is skipped (bob changed it), the root stays
	h.s.undo()
	await opsAfter(h, 0)
	assert.equal(mindTree(live(h)).nodes.size, 5, 'her branch went, bob\'s stays')
	near(rootAt(live(h)), r0, 'after the undo')
	h.s.redo()
	await opsAfter(h, 0)
	assert.equal(mindTree(live(h)).nodes.size, 6)
	near(rootAt(live(h)), r0, 'after the redo')
})

/** the world centre of a node as the estimate lays the item out */
const centreAt = (it, key) => {
	const n = mindmapLayout(it).byKey.get(key)
	return { x: it.x + n.x + n.w / 2, y: it.y + n.y + n.h / 2 }
}

test('job 196 AK3: a node dropped on empty space: one patch with m and the box, it lands there, the root stays; over the middle line a main branch changes side; undo', async () => {
	const h = await open()
	h.s.select([M])
	const r0 = rootAt(live(h))
	const rc = centreAt(live(h), R)
	const n = h.tr.calls.length
	cb(h).onIntent({ type: 'mmMove', id: M, key: A, target: null, place: { x: rc.x + 300, y: rc.y - 150 } })
	const ops = await opsAfter(h, n)
	assert.equal(ops.length, 1)
	assert.deepEqual(ops[0].p[nodePath(A) + '.m'], [300, -150])
	assert.ok('w' in ops[0].p || 'h' in ops[0].p, 'the box comes with it')
	near(centreAt(live(h), A), { x: rc.x + 300, y: rc.y - 150 }, 'A where it was dropped')
	near(rootAt(live(h)), r0, 'the root stays')
	assert.equal(h.s.undoStack.done.length, 1)
	// B, the only main branch left in the row, moves out of A's way if needed: never covered
	const l = mindmapLayout(live(h))
	const a = l.byKey.get(A)
	const b = l.byKey.get(B)
	assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y))
	// over the middle line: B becomes a left branch
	cb(h).onIntent({ type: 'mmMove', id: M, key: B, target: null, place: { x: rc.x - 250, y: rc.y + 80 } })
	await opsAfter(h, 0)
	assert.equal(live(h).data.nodes.b2[B].d, 'l')
	assert.equal(sideOf(mindTree(live(h)), B), -1)
	near(centreAt(live(h), B), { x: rc.x - 250, y: rc.y + 80 }, 'B where it was dropped')
	near(rootAt(live(h)), r0, 'the root stays')
	while (h.s.undoStack.canUndo()) h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data, mindmap().data)
	near(rootAt(live(h)), r0, 'after the undos')
})

test('job 196 AK3: 60 free nodes below A travel along in patches of at most 50 paths, one undo step; "Rearrange" on a node and at the root; the menu knows placed', async () => {
	const base = mindmap()
	const A36 = '0123456789abcdefghijklmnopqrstuvwxyz'
	for (let i = 0; i < 60; i++) {
		const k = 'n' + A36[i % 36] + String(Math.floor(i / 36) + 5).padStart(7, '0')
		base.data.nodes[bucketOf(k)] = base.data.nodes[bucketOf(k)] ?? {}
		base.data.nodes[bucketOf(k)][k] = { o: 'i0', p: A1, m: [400 + i, i * 40 - 1200] }
	}
	assert.equal(checkMindmap(base.data), true)
	const l0 = mindmapLayout(base)
	const item = { ...base, w: Math.round(l0.w * 100) / 100, h: Math.round(l0.h * 100) / 100 }
	const h = await open({ items: [item] })
	const menus = []
	h.s.ui.onContextMenu = (x) => menus.push(x)
	h.s.select([M])
	const r0 = rootAt(live(h))
	const rc = centreAt(live(h), R)
	let n = h.tr.calls.length
	cb(h).onIntent({ type: 'mmMove', id: M, key: A, target: null, place: { x: rc.x + 200, y: rc.y + 300 } })
	let ops = await opsAfter(h, n)
	assert.ok(ops.length >= 2, 'several patches')
	assert.ok(ops.every((op) => Object.keys(op.p).length <= MM_PATCH_PATHS))
	const k0 = 'n0' + '5'.padStart(7, '0')
	const before = item.data.nodes[bucketOf(k0)][k0].m
	const dA = { x: 200 - (centreAt(item, A).x - rc.x), y: 300 - (centreAt(item, A).y - rc.y) }
	assert.deepEqual(live(h).data.nodes[bucketOf(k0)][k0].m, [Math.round((before[0] + dA.x) * 100) / 100, Math.round((before[1] + dA.y) * 100) / 100], 'a free node below travels along')
	assert.equal(h.s.undoStack.done.length, 1, 'one undo step')
	near(rootAt(live(h)), r0, 'the root stays')
	// the menu on A1 (its branch has free nodes) and on B (none)
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: A1 })
	assert.equal(menus.at(-1).mindmap.placed, true)
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: B })
	assert.equal(menus.at(-1).mindmap.placed, false)
	// "Rearrange" on A: A and every node below it back into the layout, one step
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: A })
	n = h.tr.calls.length
	h.s.menuAction('mm-rearrange')
	ops = await opsAfter(h, n)
	assert.ok(ops.length >= 2 && ops.every((op) => Object.keys(op.p).length <= MM_PATCH_PATHS))
	assert.equal(mindmapLayout(live(h)).nodes.some((x) => x.free), false)
	assert.equal(h.s.undoStack.done.length, 2)
	near(rootAt(live(h)), r0, 'the root stays')
	h.s.undo()
	await opsAfter(h, 0)
	assert.equal(mindmapLayout(live(h)).byKey.get(A).free, true, 'undo: placed again')
	// at the root: everything
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10] })
	assert.equal(menus.at(-1).mindmap.placed, true)
	h.s.menuAction('mm-rearrange')
	await opsAfter(h, 0)
	assert.equal(mindmapLayout(live(h)).nodes.some((x) => x.free), false)
	while (h.s.undoStack.canUndo()) h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual(live(h).data, item.data)
})

test('job 196 AK3: a locked map, modes view and vote and a frozen board place nothing and rearrange nothing', async () => {
	const placed = () => {
		const it = mindmap()
		it.data.nodes.b1[A].m = [300, 0]
		return it
	}
	const locked = await open({ items: [{ ...placed(), lock: { by: 'pidbob', name: 'Bob' } }] })
	let n = locked.tr.calls.length
	cb(locked).onIntent({ type: 'mmMove', id: M, key: B, target: null, place: { x: 900, y: 900 } })
	locked.s.mindmapMenuAction('mm-rearrange', M, A)
	assert.deepEqual(await opsAfter(locked, n), [])
	for (const role of ['view', 'vote']) {
		const h = await open({ items: [placed()], me: { ...ALICE, role, mod: false } })
		n = h.tr.calls.length
		cb(h).onIntent({ type: 'mmMove', id: M, key: B, target: null, place: { x: 900, y: 900 } })
		h.s.mindmapMenuAction('mm-rearrange', M, A)
		assert.deepEqual(await opsAfter(h, n), [], role)
	}
	const frozen = await open({ items: [placed()] })
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.mindmapPlace(M, B, null, { x: 900, y: 900 })
	frozen.s.mindmapMenuAction('mm-rearrange', M, A)
	assert.deepEqual(frozen.tr.calls.slice(n).flatMap((b) => b.ops ?? []), [])
})

test('job 198 AK4: Mind map, Right only, Org chart, Tree: one patch each with the box, the root stays, one undo step; the pressed one sends nothing; d and m stay', async () => {
	const base = mindmap()
	base.data.nodes.b2[B].d = 'l'
	base.data.nodes.b3[A1].m = [300, 120]
	const fresh = mindmap({ data: base.data })
	const h = await open({ items: [fresh] })
	h.s.select([M])
	const r0 = rootAt(live(h))
	assert.equal(h.s.mindmapStyle('layout', 'both'), false, 'already a mind map')
	assert.equal(h.s.mindmapStyle('layout', 'diagonal'), false, 'no layout')
	for (const v of ['org', 'tree', 'right', 'both']) {
		const n = h.tr.calls.length
		assert.equal(h.s.mindmapStyle('layout', v), true, v)
		const ops = await opsAfter(h, n)
		assert.equal(ops.length, 1, v)
		assert.equal(ops[0].p['style.layout'], v === 'both' ? null : v)
		assert.ok('w' in ops[0].p || 'h' in ops[0].p, v + ': with the box')
		assert.equal(live(h).style.layout, v === 'both' ? undefined : v)
		assert.equal(h.s.selectionInfo().mindmap.layout, v)
		near(rootAt(live(h)), r0, v)
		const l = mindmapLayout(live(h))
		assert.ok(Math.abs(live(h).w - l.w) <= 0.01 && Math.abs(live(h).h - l.h) <= 0.01, v + ': the stored box is the hull')
		assert.equal(h.s.mindmapStyle('layout', v), false, v + ' again: nothing')
	}
	assert.equal(h.s.undoStack.done.length, 4)
	assert.deepEqual([live(h).data.nodes.b2[B].d, live(h).data.nodes.b3[A1].m], ['l', [300, 120]], 'd and m kept')
	while (h.s.undoStack.canUndo()) h.s.undo()
	await opsAfter(h, 0)
	assert.deepEqual([live(h).data, live(h).style], [fresh.data, {}])
	near(rootAt(live(h)), r0, 'after undo')
})

test('job 198 AK4: in org a new main branch gets no side, "Rearrange" is not offered, a drop without a target and the shape drawn send nothing', async () => {
	const base = mindmap({ style: { layout: 'org' } })
	base.data.nodes.b3[A1].m = [300, 120]
	const h = await open({ items: [mindmap({ data: base.data, style: { layout: 'org' } })] })
	const menus = []
	h.s.ui.onContextMenu = (x) => menus.push(x)
	h.s.select([M])
	let n = h.tr.calls.length
	cb(h).onIntent({ type: 'mmAdd', id: M, key: R, as: 'child' })
	cb(h).onIntent({ type: 'mmAdd', id: M, key: A, as: 'sibling' })
	const ops = await opsAfter(h, n)
	const added = ops.flatMap((op) => Object.entries(op.p ?? {})).filter(([k, v]) => /^data\.nodes\.b[0-9a-z]\.n[0-9a-z]{8}$/.test(k) && v !== null)
	assert.equal(added.length, 2)
	assert.ok(added.every(([, v]) => v.p === R && !('d' in v)), 'no d in org')
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: A })
	assert.equal(menus.at(-1).mindmap.placed, false, 'A1 has m, but nothing is placed freely in org')
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10] })
	assert.equal(menus.at(-1).mindmap.placed, false)
	n = h.tr.calls.length
	cb(h).onIntent({ type: 'mmMove', id: M, key: B, target: null, place: { x: 900, y: 900 } })
	assert.deepEqual(await opsAfter(h, n), [], 'no free place in org')
	cb(h).onNodeFocus(M, A)
	assert.equal(h.s.selectionInfo().mindmap.node.shape, 'roundRect', 'the shape drawn')
	assert.equal(h.s.mindmapStyle('shape', 'roundRect'), false, 'the shape drawn: nothing')
	assert.equal(h.s.mindmapStyle('shape', 'rect'), true)
	await opsAfter(h, 0)
	assert.equal(live(h).data.nodes.b1[A].s, 'rect')
	// back in the mind map A1 is free again
	assert.equal(h.s.mindmapStyle('layout', 'both'), true)
	await opsAfter(h, 0)
	h.s.openMenu({ type: 'contextMenu', id: M, at: [10, 10], cell: A })
	assert.equal(menus.at(-1).mindmap.placed, true)
})

test('job 198 AK4: the layout switch sends nothing for a locked map, in modes view and vote and on a frozen board', async () => {
	const locked = await open({ items: [mindmap({ lock: { by: 'pidbob', name: 'Bob' } })] })
	locked.s.select([M])
	let n = locked.tr.calls.length
	locked.s.mindmapStyle('layout', 'org')
	assert.deepEqual(await opsAfter(locked, n), [])
	for (const role of ['view', 'vote']) {
		const h = await open({ me: { ...ALICE, role, mod: false } })
		h.s.select([M])
		n = h.tr.calls.length
		h.s.mindmapStyle('layout', 'org')
		h.s.mindmapStep(M, () => ({ p: { 'style.layout': 'tree' }, inv: { 'style.layout': null } }))
		assert.deepEqual(await opsAfter(h, n), [], role)
	}
	const frozen = await open()
	frozen.s.select([M])
	frozen.s.onStatus('gone')
	n = frozen.tr.calls.length
	frozen.s.mindmapStyle('layout', 'org')
	assert.deepEqual(frozen.tr.calls.slice(n).flatMap((b) => b.ops ?? []), [])
})
