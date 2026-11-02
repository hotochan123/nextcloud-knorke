/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 195 (AK1): src/model/mindmap.js – the form against
 * tests/fixtures/mindmap-golden.json (the PHP MindmapsTest reads the same
 * file), the tree, the layout with estimateNodeSize, the op builders, the
 * box that keeps the root in its place, the indented list in and out;
 * (job 196, AK1) nodes placed freely: the form, the layout that moves the
 * other nodes out of their way, placeNode, moveNode, rearrange; (job 198,
 * AK2) the layouts org and tree, the keys, the drop target and moveNode there.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
	LINE_HEIGHT, MM_COLORS, MM_FILL,
} from '../../../src/model/tokens.js'
import {
	MM_CARD_BAND, MM_CARD_MIN_W, MM_DOT_R, MM_GAP_X, MM_GAP_Y, MM_MAX_NODES, MM_ORG_GAP_X, MM_ORG_GAP_Y, cardLines, drawnShape, MM_PATCH_PATHS, MM_PLACE_MAX, NODE_KEY_RE, addChild, addSibling, applyMindmapPatch,
	bucketOf, checkMindmap, deleteBranch, dropTarget, estimateNodeSize, focusAfterDelete, hasPlaced, mindTree, mindmapBytes,
	mindmapFromOutline, mindmapLayout, moveNode, newMindmapData, newNodeKey, nodeAtLayout, nodePath, nodeText, nodeOfTextPath,
	outlineText, parseOutline, placeNode, placeOf, previewMindmap, rearrange, rowOf, setNodeField, setNodeText, sideOf, stepFocus,
	textPath, toggleFold, visibleAncestor, withBox,
} from '../../../src/model/mindmap.js'

import { keyBetween } from '../../../src/model/zorder.js'

const golden = JSON.parse(readFileSync(new URL('../../fixtures/mindmap-golden.json', import.meta.url), 'utf8'))

const R = 'n00000000'
const A = 'n10000000'
const B = 'n20000000'
const A1 = 'n30000000'
const A2 = 'n40000000'
const L = 'n50000000'

/**
 * @param {Array<[string, object, string?]>} list [key, node, text]
 * @param {object} [style] style
 * @return {object} a mind map item
 */
function mm(list, style = {}) {
	const nodes = {}
	const texts = {}
	for (const [k, n, t] of list) {
		nodes[bucketOf(k)] = nodes[bucketOf(k)] ?? {}
		nodes[bucketOf(k)][k] = n
		if (t) {
			texts[bucketOf(k)] = texts[bucketOf(k)] ?? {}
			texts[bucketOf(k)][k] = t
		}
	}
	const data = Object.keys(texts).length > 0 ? { nodes, texts } : { nodes }
	return { id: 'M', t: 'mindmap', x: 100, y: 50, w: 300, h: 60, r: 0, z: 'i0', parent: null, data, style }
}

/** root "Thema", right A (A1, A2), right B, left L */
const sample = (style = {}, extra = {}) => mm([
	[R, { o: 'i0' }, 'Thema'],
	[A, { o: 'i0', p: R, c: '#0275a9' }, 'Alpha'],
	[B, { o: 'i1', p: R }, 'Beta'],
	[L, { o: 'i2', p: R, d: 'l' }, 'Links'],
	[A1, { o: 'i0', p: A, ...extra }, 'a1'],
	[A2, { o: 'i1', p: A }, 'a2'],
], style)

/** a fixed random source */
function seq(...vals) {
	let i = 0
	return () => vals[i++ % vals.length]
}

describe('mindmap form (golden, AK1)', () => {
	test('checkMindmap gives the golden verdict for every case, the named ones included', () => {
		assert.ok(golden.checks.length >= 30)
		const wrong = golden.checks.filter((c) => checkMindmap(c.data) !== c.ok).map((c) => c.name)
		assert.deepEqual(wrong, [])
		const names = Object.fromEntries(golden.checks.map((c) => [c.name, c.ok]))
		for (const [n, ok] of Object.entries({ 'a new mind map': true, 'two roots': false, 'a cycle beside the root': false, 'orphan p': false, '501 nodes': false, '1001 code points': false, 'extra key in data': false, 'colour with C': false, 'unknown shape': false })) {
			assert.equal(names[n], ok, n)
		}
	})

	test('a new mind map is valid; keys, pots and paths', () => {
		const d = newMindmapData(seq(0.1, 0.2, 0.3))
		assert.equal(checkMindmap(d), true)
		const [b] = Object.keys(d.nodes)
		const [k] = Object.keys(d.nodes[b])
		assert.match(k, NODE_KEY_RE)
		assert.equal(bucketOf(k), b)
		assert.equal(nodePath('n7abcdefg'), 'data.nodes.b7.n7abcdefg')
		assert.equal(textPath('n7abcdefg'), 'data.texts.b7.n7abcdefg')
		assert.equal(nodeOfTextPath('data.texts.b7.n7abcdefg'), 'n7abcdefg')
		assert.equal(nodeOfTextPath('data.texts.b8.n7abcdefg'), null)
		assert.equal(nodeOfTextPath('data.nodes.b7.n7abcdefg'), null)
	})

	test('newNodeKey never gives a taken key nor one in a full pot', () => {
		const nodes = { b0: {} }
		for (let i = 0; i < 100; i++) nodes.b0['n0' + String(i).padStart(7, '0')] = { o: 'i0' }
		// a random source that always asks for pot b0 first
		const k = newNodeKey({ nodes }, seq(0, 0.5))
		assert.notEqual(bucketOf(k), 'b0')
		assert.equal(nodes.b0[k], undefined)
	})
})

describe('mindmap tree and layout (AK1)', () => {
	test('the tree: root, children in order, sides, rows', () => {
		const t = mindTree(sample())
		assert.equal(t.root, R)
		assert.deepEqual(t.nodes.get(R).kids, [A, B, L])
		assert.deepEqual(t.nodes.get(A).kids, [A1, A2])
		assert.deepEqual([sideOf(t, A), sideOf(t, A1), sideOf(t, L), sideOf(t, R)], [1, 1, -1, 0])
		assert.deepEqual(rowOf(t, A), [A, B], 'the right main branches')
		assert.deepEqual(rowOf(t, L), [L])
		const right = mindTree(sample({ layout: 'right' }))
		assert.deepEqual(rowOf(right, L), [A, B, L], 'right only: one row')
		assert.equal(sideOf(right, L), 1)
	})

	test('layout both: right of the root, left mirrored, the hull is the box, children beside their parent', () => {
		const l = mindmapLayout(sample())
		const n = (k) => l.byKey.get(k)
		const root = n(R)
		assert.equal(l.nodes[0].key, R)
		assert.deepEqual(l.nodes.map((x) => x.key), [R, A, A1, A2, B, L], 'outline order: right block, then left')
		for (const k of [A, B, A1, A2]) assert.ok(n(k).x >= root.x + root.w + MM_GAP_X - 1e-9, k)
		assert.ok(n(L).x + n(L).w <= root.x - MM_GAP_X + 1e-9)
		assert.ok(Math.abs(n(A1).x - (n(A).x + n(A).w + MM_GAP_X)) < 1e-9, 'a child MM_GAP_X beside its parent')
		// siblings do not overlap, the parent is centred on its children
		assert.ok(n(A1).y + n(A1).h <= n(A2).y)
		assert.ok(n(A).y + n(A).h <= n(B).y + 1e-9 || n(A2).y + n(A2).h <= n(B).y)
		const kidsMid = (n(A1).y + n(A2).y + n(A2).h) / 2
		assert.ok(Math.abs(n(A).y + n(A).h / 2 - kidsMid) < 1e-9)
		// the hull starts at 0, 0 and holds every node and dot
		let minX = Infinity
		let minY = Infinity
		for (const x of l.nodes) {
			minX = Math.min(minX, x.x, x.dot ? x.dot.x - MM_DOT_R : Infinity)
			minY = Math.min(minY, x.y, x.dot ? x.dot.y - MM_DOT_R : Infinity)
			assert.ok(x.x + x.w <= l.w + 1e-9 && x.y + x.h <= l.h + 1e-9, x.key)
		}
		assert.ok(Math.abs(minX) < 1e-9 && Math.abs(minY) < 1e-9)
		// shapes, colours, widths
		assert.equal(root.shape, 'roundRect')
		assert.equal(n(A).shape, 'pill', 'job 266: a main branch is a pill')
		assert.equal(n(A1).shape, 'line')
		assert.equal(n(A).color, '#0275a9')
		assert.equal(n(A1).color, '#0275a9', 'children take the colour of their branch')
		assert.equal(n(B).color, MM_COLORS[1], 'a main branch without c: by its place')
		assert.equal(n(A).width, 3)
		assert.equal(n(A1).width, 2)
		assert.ok(n(A).dot !== null && n(A1).dot === null, 'a dot only with children')
		assert.equal(MM_FILL, '#ffffff')
	})

	test('layout right: every main branch right of the root; folded children are hidden and counted', () => {
		const l = mindmapLayout(sample({ layout: 'right' }))
		const root = l.byKey.get(R)
		for (const k of [A, B, L]) assert.ok(l.byKey.get(k).x > root.x + root.w, k)
		const f = mindmapLayout(mm([
			[R, { o: 'i0' }, 'R'], [A, { o: 'i0', p: R, f: true }, 'A'], [A1, { o: 'i0', p: A }, 'x'], [A2, { o: 'i0', p: A1 }, 'y'],
		]))
		assert.deepEqual(f.nodes.map((x) => x.key), [R, A])
		assert.equal(f.byKey.get(A).folded, true)
		assert.equal(f.byKey.get(A).count, 2)
		assert.ok(f.byKey.get(A).dot !== null)
	})

	test('estimateNodeSize wraps at the width; the root is bold and larger; an empty node has its least width', () => {
		const one = estimateNodeSize('abc', 240, 16, false)
		assert.equal(one.h, 16 * 1.2)
		assert.ok(Math.abs(one.w - 3 * 16 * 0.55) < 1e-9)
		const long = estimateNodeSize('word '.repeat(40), 240, 16, false)
		assert.ok(long.w <= 240 && long.h > 16 * 1.2)
		const l = mindmapLayout(mm([[R, { o: 'i0' }], [A, { o: 'i0', p: R }]]))
		assert.equal(l.byKey.get(R).w, 120)
		assert.ok(Math.abs(l.byKey.get(A).w - (16 * 1.2 + 16 + 24)) < 1e-9, 'job 266: an empty main pill as wide as high plus its padding')
		assert.equal(l.byKey.get(R).font, 20)
		const deep = mindmapLayout(mm([[R, { o: 'i0' }], [A, { o: 'i0', p: R }], [A1, { o: 'i0', p: A }]]))
		assert.equal(deep.byKey.get(A1).w, 40)
	})

	test('nodeAtLayout finds nodes and dots; the empty room of the hull hits nothing', () => {
		const l = mindmapLayout(sample())
		const a = l.byKey.get(A)
		assert.deepEqual(nodeAtLayout(l, a.x + 2, a.y + 2), { key: A, part: 'node' })
		assert.deepEqual(nodeAtLayout(l, a.dot.x, a.dot.y), { key: A, part: 'dot' })
		assert.deepEqual(nodeAtLayout(l, a.x + a.w - 1, a.y + a.h - 1, 30), { key: A, part: 'node' }, 'job 198 round 6: in its box, also where the tolerance of its dot reaches')
		assert.deepEqual(nodeAtLayout(l, a.dot.x, a.dot.y, 30), { key: A, part: 'dot' })
		const r = l.byKey.get(R)
		assert.equal(nodeAtLayout(l, r.x + r.w + 10, r.y + r.h / 2), null, 'the gap between the root and its branches')
		assert.equal(nodeAtLayout(l, -50, -50), null)
	})

	test('previewMindmap lays out the editor text; visibleAncestor of a hidden node is its folded ancestor', () => {
		const it = sample()
		const p = previewMindmap(it, { key: B, text: 'a much longer text that wraps once or twice in the layout' })
		assert.ok(mindmapLayout(p).byKey.get(B).h > mindmapLayout(it).byKey.get(B).h)
		assert.equal(nodeText(previewMindmap(it, { key: B, text: '' }).data, B), '')
		assert.equal(nodeText(it.data, B), 'Beta', 'the item stays')
		const f = sample({}, {})
		f.data.nodes[bucketOf(A)][A].f = true
		assert.equal(visibleAncestor(f, A1), A)
		assert.equal(visibleAncestor(f, B), B)
		assert.equal(visibleAncestor(f, 'n99999999'), null)
	})
})

describe('mindmap op builders (AK1, AK3)', () => {
	test('addChild: last child, colour and side of a main branch, unfold', () => {
		const it = sample()
		const r = addChild(it, A, {}, seq(0.9, 0.1))
		assert.match(r.key, NODE_KEY_RE)
		const node = r.p[nodePath(r.key)]
		assert.equal(node.p, A)
		assert.ok(node.o > 'i1', 'after the last child')
		assert.equal(node.c, undefined)
		assert.equal(checkMindmap(applyMindmapPatch(it, r.p).data), true)
		assert.deepEqual(r.inv, { [nodePath(r.key)]: null })
		// a main branch: the balanced side (2 right, 1 left → left) and the first free colour
		const m = addChild(it, R, {}, seq(0.9, 0.1))
		assert.equal(m.p[nodePath(m.key)].d, 'l')
		assert.equal(m.p[nodePath(m.key)].c, MM_COLORS.find((c) => c !== '#0275a9'))
		assert.equal(addChild(it, R, { side: 'r' }, seq(0.9)).p[nodePath(addChild(it, R, { side: 'r' }, seq(0.9)).key)].d, undefined)
		// right only: no side
		const right = sample({ layout: 'right' })
		const k = addChild(right, R, { side: 'l' }, seq(0.9))
		assert.equal(k.p[nodePath(k.key)].d, undefined)
		// a folded parent unfolds in the same patch
		const f = sample({}, {})
		f.data.nodes[bucketOf(A)][A].f = true
		const u = addChild(f, A, {}, seq(0.9))
		assert.equal(u.p[nodePath(A) + '.f'], null)
		assert.equal(u.inv[nodePath(A) + '.f'], true)
		assert.deepEqual(addChild(it, 'n99999999'), { error: 'gone' })
	})

	test('addChild at MM_MAX_NODES nodes: error nodes', () => {
		const list = [[R, { o: 'i0' }]]
		const A36 = '0123456789abcdefghijklmnopqrstuvwxyz'
		for (let i = 1; i < MM_MAX_NODES; i++) list.push(['n' + A36[i % 36] + String(Math.floor(i / 36) + 1).padStart(7, '0'), { o: 'i0', p: R }])
		const big = mm(list)
		assert.equal(checkMindmap(big.data), true)
		assert.deepEqual(addChild(big, R), { error: 'nodes' })
		assert.deepEqual(addSibling(big, list[1][0]), { error: 'nodes' })
	})

	test('addSibling: right after the node, its side; never beside the root', () => {
		const it = sample()
		const r = addSibling(it, A, seq(0.9, 0.1))
		const n = r.p[nodePath(r.key)]
		assert.equal(n.p, R)
		const after = mindTree(applyMindmapPatch(it, r.p))
		assert.deepEqual(rowOf(after, A), [A, r.key, B])
		const l = addSibling(it, L, seq(0.9))
		assert.equal(l.p[nodePath(l.key)].d, 'l')
		const a1 = addSibling(it, A1, seq(0.9))
		assert.deepEqual(mindTree(applyMindmapPatch(it, a1.p)).nodes.get(A).kids, [A1, a1.key, A2])
		assert.deepEqual(addSibling(it, R), { error: 'root' })
	})

	test('deleteBranch: children first, texts with them, at most 50 paths, every state valid; the inverse parents first', () => {
		const list = [[R, { o: 'i0' }, 'R'], [A, { o: 'i0', p: R }, 'A']]
		const A36 = '0123456789abcdefghijklmnopqrstuvwxyz'
		const keys = []
		for (let i = 0; i < 60; i++) {
			const k = 'n' + A36[i % 36] + String(Math.floor(i / 36) + 5).padStart(7, '0')
			keys.push(k)
			list.push([k, { o: 'i0', p: i === 0 ? A : keys[i - 1] }, 'n' + i])
		}
		const it = mm(list)
		assert.equal(checkMindmap(it.data), true)
		const r = deleteBranch(it, A)
		assert.equal(r.keys.length, 61)
		assert.ok(r.patches.length >= 3)
		let s = it
		for (const p of r.patches) {
			assert.ok(Object.keys(p).length <= MM_PATCH_PATHS)
			s = applyMindmapPatch(s, p)
			assert.equal(checkMindmap(s.data), true)
		}
		assert.deepEqual(Object.keys(s.data.nodes).flatMap((b) => Object.keys(s.data.nodes[b])), [R])
		for (const p of r.inverse) {
			assert.ok(Object.keys(p).length <= MM_PATCH_PATHS)
			s = applyMindmapPatch(s, p)
			assert.equal(checkMindmap(s.data), true)
		}
		assert.deepEqual(s.data, it.data)
		assert.deepEqual(deleteBranch(it, R), { error: 'root' })
	})

	test('setNodeText, setNodeField, toggleFold', () => {
		const it = sample()
		assert.deepEqual(setNodeText(it, B, 'Neu'), { p: { [textPath(B)]: 'Neu' }, inv: { [textPath(B)]: 'Beta' } })
		assert.deepEqual(setNodeText(it, B, ''), { p: { [textPath(B)]: null }, inv: { [textPath(B)]: 'Beta' } })
		assert.deepEqual(setNodeText(it, 'n99999999', 'x'), { error: 'gone' })
		assert.deepEqual(setNodeField(it, A, 'c', '#c43e45'), { p: { [nodePath(A) + '.c']: '#c43e45' }, inv: { [nodePath(A) + '.c']: '#0275a9' } })
		assert.deepEqual(setNodeField(it, A, 'c', '#0275a9'), { error: 'same' })
		assert.deepEqual(setNodeField(it, B, 's', 'pill'), { p: { [nodePath(B) + '.s']: 'pill' }, inv: { [nodePath(B) + '.s']: null } })
		assert.deepEqual(toggleFold(it, A), { p: { [nodePath(A) + '.f']: true }, inv: { [nodePath(A) + '.f']: null }, folded: true })
		assert.deepEqual(toggleFold(it, B), { error: 'same' })
		assert.deepEqual(toggleFold(it, R), { error: 'root' })
	})

	test('moveNode: as a child, before and after, to the other side; never into the own subtree', () => {
		const it = sample()
		const child = moveNode(it, B, { key: A, where: 'child' })
		assert.deepEqual(mindTree(applyMindmapPatch(it, child.p)).nodes.get(A).kids, [A1, A2, B])
		const before = moveNode(it, A2, { key: A1, where: 'before' })
		assert.deepEqual(mindTree(applyMindmapPatch(it, before.p)).nodes.get(A).kids, [A2, A1])
		assert.deepEqual(Object.keys(before.p), [nodePath(A2) + '.o'], 'the same row: only o')
		const toLeft = moveNode(it, B, { key: L, where: 'after' })
		const t = mindTree(applyMindmapPatch(it, toLeft.p))
		assert.deepEqual(rowOf(t, L), [L, B])
		assert.equal(toLeft.p[nodePath(B) + '.d'], 'l')
		const out = moveNode(it, L, { key: A1, where: 'after' })
		assert.equal(out.p[nodePath(L) + '.d'], null, 'no longer a main branch: d goes')
		assert.equal(out.inv[nodePath(L) + '.d'], 'l')
		const root = moveNode(it, A1, { key: R, where: 'child', side: 'l' })
		assert.equal(root.p[nodePath(A1) + '.d'], 'l')
		assert.deepEqual(moveNode(it, A, { key: A1, where: 'child' }), { error: 'gone' }, 'into its own subtree')
		assert.deepEqual(moveNode(it, A1, { key: R, where: 'before' }), { error: 'root' })
		assert.deepEqual(moveNode(it, A2, { key: A1, where: 'after' }), { error: 'same' })
		assert.deepEqual(moveNode(it, R, { key: A, where: 'child' }), { error: 'root' })
		for (const r of [child, before, toLeft, out, root]) assert.equal(checkMindmap(applyMindmapPatch(it, r.p).data), true)
	})

	test('dropTarget: quarters mean before and after, the middle a child; the root by the side of the point; never the own subtree', () => {
		const it = sample()
		const l = mindmapLayout(it)
		const a1 = l.byKey.get(A1)
		assert.deepEqual(dropTarget(it, l, B, a1.x + 2, a1.y + 1), { key: A1, where: 'before', side: null })
		assert.deepEqual(dropTarget(it, l, B, a1.x + 2, a1.y + a1.h - 1), { key: A1, where: 'after', side: null })
		assert.deepEqual(dropTarget(it, l, B, a1.x + 2, a1.y + a1.h / 2), { key: A1, where: 'child', side: null })
		const r = l.byKey.get(R)
		assert.deepEqual(dropTarget(it, l, A1, r.x + 2, r.y + 2), { key: R, where: 'child', side: 'l' })
		assert.deepEqual(dropTarget(it, l, A1, r.x + r.w - 2, r.y + 2), { key: R, where: 'child', side: 'r' })
		assert.equal(dropTarget(it, l, A, a1.x + 2, a1.y + a1.h / 2), null, 'its own child')
		assert.equal(dropTarget(it, l, A, r.x + r.w + 10, r.y + r.h / 2), null, 'no node there')
	})

	test('stepFocus and focusAfterDelete', () => {
		const it = sample()
		assert.equal(stepFocus(it, R, 'right'), A)
		assert.equal(stepFocus(it, R, 'left'), L)
		assert.equal(stepFocus(it, R, 'up'), null)
		assert.equal(stepFocus(it, A, 'right'), A1)
		assert.equal(stepFocus(it, A, 'left'), R)
		assert.equal(stepFocus(it, A, 'down'), B)
		assert.equal(stepFocus(it, B, 'down'), null)
		assert.equal(stepFocus(it, A1, 'down'), A2)
		assert.equal(stepFocus(it, L, 'right'), R, 'left side: right goes in')
		assert.equal(stepFocus(it, L, 'left'), null)
		assert.equal(focusAfterDelete(it, A2), A1)
		assert.equal(focusAfterDelete(it, A1), A2)
		assert.equal(focusAfterDelete(it, L), R)
		const f = sample()
		f.data.nodes[bucketOf(A)][A].f = true
		assert.equal(stepFocus(f, A, 'right'), null, 'a folded node has no visible child')
	})

	test('withBox keeps the root at its world point; nothing when nothing moved', () => {
		const it = sample()
		const before = mindmapLayout(it)
		const l0 = before.byKey.get(R)
		const stored = { ...it, w: before.w, h: before.h }
		const r = withBox(stored, addChild(stored, L, {}, seq(0.9)))
		const after = applyMindmapPatch(stored, r.p)
		const l1 = mindmapLayout(after).byKey.get(R)
		assert.ok(Math.abs(stored.x + l0.x - (after.x + l1.x)) <= 0.01)
		assert.ok(Math.abs(stored.y + l0.y - (after.y + l1.y)) <= 0.01)
		assert.equal(r.p.parent, null, 'the placement group goes together')
		assert.equal(r.inv.x, stored.x)
		const same = withBox(stored, { p: {}, inv: {} })
		assert.deepEqual(same, { p: {}, inv: {} })
		assert.ok(mindmapBytes(it) > 0)
	})
})

describe('mindmap indented list (AK1, AK3)', () => {
	test('parseOutline: tabs, 2 and 4 spaces, bullets, the one top line as root', () => {
		assert.deepEqual(parseOutline('Thema\n\tA\n\t\tA1\n\tB'), { root: 'Thema', lines: [{ depth: 1, text: 'A' }, { depth: 2, text: 'A1' }, { depth: 1, text: 'B' }] })
		assert.deepEqual(parseOutline('Thema\n  A\n    A1\n  B'), parseOutline('Thema\n\tA\n\t\tA1\n\tB'))
		assert.deepEqual(parseOutline('- Thema\n    - A\n        * A1\n    - B'), parseOutline('Thema\n\tA\n\t\tA1\n\tB'))
		assert.deepEqual(parseOutline('1. Thema\n   a) A\n      1) A1\n   b) B'), parseOutline('Thema\n\tA\n\t\tA1\n\tB'))
		assert.deepEqual(parseOutline('\r\nThema\r\n\r\n\tA\r\n'), { root: 'Thema', lines: [{ depth: 1, text: 'A' }] })
	})

	test('parseOutline: Word plain text (•\\t, o\\t at one indent), several top lines, no list', () => {
		assert.deepEqual(parseOutline('•\tThema\no\tA\no\tB\n▪\tB1'), { root: 'Thema', lines: [{ depth: 1, text: 'A' }, { depth: 1, text: 'B' }, { depth: 2, text: 'B1' }] })
		assert.deepEqual(parseOutline('A\n\tA1\nB\n\tB1'), { root: '', lines: [{ depth: 1, text: 'A' }, { depth: 2, text: 'A1' }, { depth: 1, text: 'B' }, { depth: 2, text: 'B1' }] })
		assert.equal(parseOutline('- a\n- b\n- c'), null, 'a flat list stays notes')
		assert.equal(parseOutline('a\nb'), null)
		assert.equal(parseOutline('only one line'), null)
		assert.equal(parseOutline('Thema\n\tA\tB'), null, 'a tab inside a text: a table')
		assert.equal(parseOutline('x\ty\n\tz'), null)
		assert.equal(parseOutline(5), null)
	})

	test('mindmapFromOutline: a valid map, sides alternate, colours in turn, the cut from the end', () => {
		const o = parseOutline('Thema\n\tA\n\t\tA1\n\tB\n\tC')
		const r = mindmapFromOutline(o, { rand: seq(0.1, 0.4, 0.7, 0.2, 0.9, 0.3) })
		assert.equal(r.cut, 0)
		assert.equal(checkMindmap(r.data), true)
		const it = { t: 'mindmap', data: r.data, style: {} }
		const t = mindTree(it)
		assert.deepEqual(t.nodes.get(t.root).kids.map((k) => nodeText(r.data, k)), ['A', 'B', 'C'])
		assert.deepEqual(t.nodes.get(t.root).kids.map((k) => [sideOf(t, k), t.nodes.get(k).n.c]), [[1, MM_COLORS[0]], [-1, MM_COLORS[1]], [1, MM_COLORS[2]]])
		assert.equal(outlineText(it), 'Thema\n\tA\n\t\tA1\n\tC\n\tB', 'right side first, then left')
		const lines = ['Root', ...Array.from({ length: 600 }, (_, i) => '\tline ' + i)].join('\n')
		const big = mindmapFromOutline(parseOutline(lines))
		assert.equal(big.cut, 600 - (MM_MAX_NODES - 1))
		assert.equal(checkMindmap(big.data), true)
		const bytes = mindmapFromOutline(parseOutline(['Root', ...Array.from({ length: 300 }, () => '\t' + 'x'.repeat(900))].join('\n')))
		assert.ok(bytes.cut > 0)
		assert.ok(mindmapBytes({ data: bytes.data }) <= 65536)
		assert.equal(checkMindmap(bytes.data), true)
	})

	test('outlineText: a subtree, folded children too, line breaks as spaces; the round trip keeps the tree', () => {
		const it = sample({ layout: 'right' })
		it.data.nodes[bucketOf(A)][A].f = true
		it.data.texts[bucketOf(B)][B] = 'Beta\nzwei'
		assert.equal(outlineText(it, A), 'Alpha\n\ta1\n\ta2')
		assert.equal(outlineText(it), 'Thema\n\tAlpha\n\t\ta1\n\t\ta2\n\tBeta zwei\n\tLinks')
		const back = mindmapFromOutline(parseOutline(outlineText(it)))
		assert.equal(outlineText({ t: 'mindmap', data: back.data, style: { layout: 'right' } }), outlineText(it))
		assert.equal(outlineText(it, 'n99999999'), '')
	})
})

describe('mindmap free places (job 196, AK1)', () => {
	const centre = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })
	const rel = (l, key) => {
		const r = centre(l.byKey.get(l.root))
		const c = centre(l.byKey.get(key))
		return { x: c.x - r.x, y: c.y - r.y }
	}
	const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	const near = (a, b, msg) => {
		assert.ok(Math.abs(a.x - b.x) <= 0.01 && Math.abs(a.y - b.y) <= 0.01, `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`)
	}

	test('the golden cases of m; placeOf', () => {
		const names = Object.fromEntries(golden.checks.map((c) => [c.name, c.ok]))
		for (const [n, ok] of Object.entries({ 'm on a node (job 196)': true, 'm at the limit': true, 'm at the root': false, 'm with one number': false, 'm with three numbers': false, 'm with a string': false, 'm an object': false, 'm beyond the limit': false })) {
			assert.equal(names[n], ok, n)
		}
		assert.deepEqual(placeOf({ m: [1, -2] }), [1, -2])
		assert.equal(placeOf({ m: [1, NaN] }), null)
		assert.equal(placeOf({ m: [MM_PLACE_MAX + 1, 0] }), null)
		assert.equal(placeOf({}), null)
	})

	test('a free node stands at the root centre + (s·u, v), its children beside it, no room in its row; Right only mirrors it', () => {
		const it = sample({}, {})
		it.data.nodes[bucketOf(A)][A].m = [300, -200]
		it.data.nodes[bucketOf(L)][L].m = [150, 40]
		const l = mindmapLayout(it)
		assert.equal(l.byKey.get(A).free, true)
		assert.equal(l.byKey.get(B).free, false)
		near(rel(l, A), { x: 300, y: -200 }, 'A right')
		near(rel(l, L), { x: -150, y: 40 }, 'L left, mirrored')
		const a = l.byKey.get(A)
		const a1 = l.byKey.get(A1)
		assert.equal(a1.x, a.x + a.w + MM_GAP_X, 'A1 beside A')
		assert.ok(Math.abs(centre(a).y - (centre(a1).y + centre(l.byKey.get(A2)).y) / 2) < 0.01, 'its block centred on A')
		// B alone in the right row: centred on the root
		assert.ok(Math.abs(rel(l, B).y) < 0.01, 'B takes the middle')
		const r = mindmapLayout({ ...it, style: { layout: 'right' } })
		near(rel(r, L), { x: 150, y: 40 }, 'Right only: L mirrored with its branch')
		// the inner end of a free node is where its branch arrives
		assert.equal(a.inner.x, a.x)
	})

	test('a folded parent hides a free child, which is then no obstacle', () => {
		const it = sample({}, { m: [-30, 0] })
		it.data.nodes[bucketOf(A)][A].f = true
		const plain = sample()
		plain.data.nodes[bucketOf(A)][A].f = true
		const l = mindmapLayout(it)
		assert.equal(l.byKey.has(A1), false)
		assert.deepEqual(rel(l, B), rel(mindmapLayout(plain), B), 'B where it is without the hidden free A1')
	})

	test('property: in 200 random trees no free node covers a node Knorke lays out; root and free nodes keep their places', () => {
		let s = 196
		const rnd = () => {
			s = (s * 1103515245 + 12345) % 2147483648
			return s / 2147483648
		}
		const words = ['a', 'Idee', 'ein längerer Ast', 'Workshop Planung Q4', 'x y z w v u t', 'Kurz']
		for (let run = 0; run < 200; run++) {
			const count = 5 + Math.floor(rnd() * 56)
			const keys = Array.from({ length: count }, (_, i) => 'n' + (i % 36).toString(36) + String(i).padStart(7, '0'))
			const list = [[keys[0], { o: 'i0' }, 'Thema']]
			for (let i = 1; i < count; i++) {
				const p = keys[Math.floor(rnd() * i)]
				const n = { o: 'i' + (i % 10), p }
				if (p === keys[0] && rnd() < 0.5) n.d = 'l'
				list.push([keys[i], n, words[Math.floor(rnd() * words.length)]])
			}
			const free = 1 + Math.floor(rnd() * 5)
			for (let f = 0; f < free; f++) {
				const e = list[1 + Math.floor(rnd() * (count - 1))]
				e[1].m = [Math.round((rnd() * 900 - 450) * 100) / 100, Math.round((rnd() * 900 - 450) * 100) / 100]
			}
			const it = mm(list, rnd() < 0.3 ? { layout: 'right' } : {})
			assert.equal(checkMindmap(it.data), true)
			const l = mindmapLayout(it)
			const tree = mindTree(it)
			for (const n of l.nodes) {
				if (!n.free) continue
				const u = tree.nodes.get(n.key).n.m
				near(rel(l, n.key), { x: (n.side > 0 ? 1 : -1) * u[0], y: u[1] }, `run ${run}: free ${n.key} at its place`)
				for (const o of l.nodes) {
					if (o.free || o.parent === null) continue
					assert.ok(!overlaps(n, o), `run ${run}: free ${n.key} covers ${o.key}`)
				}
			}
		}
	})

	test('a node pushed down keeps a gap of MM_GAP_Y; one unit closer than the gap pushes, one unit farther does not', () => {
		const X = 'n60000000'
		const make = (m) => mm([[R, { o: 'i0' }, 'Thema'], [X, { o: 'i0', p: R }, 'Rechts'], [L, { o: 'i1', p: R, d: 'l', ...(m ? { m } : {}) }, 'Links']])
		const l0 = mindmapLayout(make(null))
		const x = l0.byKey.get(X)
		const rx = rel(l0, X)
		const h = l0.byKey.get(L).h
		// L placed freely right above X: its bottom edge MM_GAP_Y ± 1 above the top of X
		const at = (dy) => mindmapLayout(make([-rx.x, rx.y - x.h / 2 - MM_GAP_Y - h / 2 + dy]))
		near(rel(at(-1), X), rx, 'one unit farther: X stays')
		const close = at(1)
		const lc = close.byKey.get(L)
		const xc = close.byKey.get(X)
		assert.ok(Math.abs(xc.y - (lc.y + lc.h + MM_GAP_Y)) < 0.001, 'one unit closer: X moves below L with the gap')
		near(rel(close, L), { x: rx.x, y: rx.y - x.h / 2 - MM_GAP_Y - h / 2 + 1 }, 'L stays')
	})

	test('placeNode: the centre lands on the point, a main branch changes side, free nodes below travel along, the limit', () => {
		const it = sample({}, { m: [400, 100] })
		const l = mindmapLayout(it)
		const r = centre(l.byKey.get(R))
		const a1Before = rel(l, A1)
		const right = placeNode(it, A, { x: r.x + 250, y: r.y - 120 })
		assert.deepEqual(right.p[nodePath(A) + '.m'], [250, -120])
		assert.equal(right.inv[nodePath(A) + '.m'], null)
		const after = mindmapLayout(applyMindmapPatch(it, right.p))
		near(rel(after, A), { x: 250, y: -120 }, 'A where dropped')
		const dA = { x: 250 - rel(l, A).x, y: -120 - rel(l, A).y }
		near(rel(after, A1), { x: a1Before.x + dA.x, y: a1Before.y + dA.y }, 'A1 travels along')
		// over the middle line: A becomes a left branch, A1 mirrored with it
		const left = placeNode(it, A, { x: r.x - 250, y: r.y })
		assert.equal(left.p[nodePath(A) + '.d'], 'l')
		assert.deepEqual(left.p[nodePath(A) + '.m'], [250, 0])
		const al = mindmapLayout(applyMindmapPatch(it, left.p))
		assert.equal(al.byKey.get(A).side, -1)
		near(rel(al, A), { x: -250, y: 0 }, 'A on the left')
		assert.ok(al.byKey.get(A2).x < al.byKey.get(A).x, 'its branches grow away from the root')
		// a deeper node keeps the side of its main branch
		const deep = placeNode(it, A2, { x: r.x - 500, y: r.y })
		assert.equal(deep.p[nodePath(A2) + '.d'], undefined)
		assert.deepEqual(deep.p[nodePath(A2) + '.m'], [-500, 0])
		assert.deepEqual(placeNode(it, A, { x: r.x + 1e7, y: r.y })?.p[nodePath(A) + '.m'], [MM_PLACE_MAX, 0], 'the limit')
		assert.deepEqual(placeNode(it, R, { x: 0, y: 0 }), { error: 'root' })
		assert.deepEqual(placeNode(it, 'n99999999', { x: 0, y: 0 }), { error: 'gone' })
		const same = applyMindmapPatch(it, right.p)
		assert.deepEqual(placeNode(same, A, { x: centre(after.byKey.get(A)).x, y: centre(after.byKey.get(A)).y }), { error: 'same' })
		for (const x of [right, left, deep]) assert.equal(checkMindmap(applyMindmapPatch(it, x.p).data), true)
	})

	test('moveNode onto a node: the node loses m, the free nodes below keep their shape to it', () => {
		const it = sample({}, { m: [400, 100] })
		it.data.nodes[bucketOf(A)][A].m = [200, -150]
		const l = mindmapLayout(it)
		const off = { x: rel(l, A1).x - rel(l, A).x, y: rel(l, A1).y - rel(l, A).y }
		const r = moveNode(it, A, { key: B, where: 'child' })
		assert.equal(r.p[nodePath(A) + '.m'], null)
		assert.deepEqual(r.inv[nodePath(A) + '.m'], [200, -150])
		const after = mindmapLayout(applyMindmapPatch(it, r.p))
		assert.equal(after.byKey.get(A).free, false)
		near({ x: rel(after, A1).x - rel(after, A).x, y: rel(after, A1).y - rel(after, A).y }, off, 'A1 keeps its place to A')
		// a free node dropped back into its own row is no "same"
		const back = moveNode(it, A, { key: B, where: 'before' })
		assert.equal(back.p[nodePath(A) + '.m'], null)
	})

	test('rearrange: the node and its branch, at the root everything; hasPlaced', () => {
		const it = sample({}, { m: [400, 100] })
		it.data.nodes[bucketOf(B)][B].m = [100, 300]
		assert.equal(hasPlaced(it, A), true, 'A1 below A')
		assert.equal(hasPlaced(it, A2), false)
		assert.equal(hasPlaced(it, R), true)
		const a = rearrange(it, A)
		assert.deepEqual(a.p, { [nodePath(A1) + '.m']: null })
		assert.deepEqual(a.inv, { [nodePath(A1) + '.m']: [400, 100] })
		const all = rearrange(it, R)
		assert.deepEqual(Object.keys(all.p).sort(), [nodePath(A1) + '.m', nodePath(B) + '.m'].sort())
		assert.deepEqual(rearrange(it, A2), { error: 'same' })
		assert.deepEqual(rearrange(it, 'n99999999'), { error: 'gone' })
		assert.equal(mindmapLayout(applyMindmapPatch(it, all.p)).nodes.some((n) => n.free), false)
	})

	test('60 free nodes below one node: patches of at most 50 paths, every state valid, the inverse restores', () => {
		const list = [[R, { o: 'i0' }, 'Thema'], [A, { o: 'i0', p: R }, 'A']]
		for (let i = 0; i < 60; i++) {
			list.push(['n' + (i % 36).toString(36) + 'f' + String(i).padStart(6, '0'), { o: 'i' + (i % 10), p: A, m: [300 + i, i * 30] }])
		}
		const it = mm(list)
		const l = mindmapLayout(it)
		const r = centre(l.byKey.get(R))
		for (const res of [placeNode(it, A, { x: r.x + 100, y: r.y + 400 }), rearrange(it, R)]) {
			assert.ok(Array.isArray(res.patches) && res.patches.length >= 2)
			let state = it
			for (const p of res.patches) {
				assert.ok(Object.keys(p).length <= MM_PATCH_PATHS)
				state = applyMindmapPatch(state, p)
				assert.equal(checkMindmap(state.data), true)
			}
			for (const p of res.inverse) state = applyMindmapPatch(state, p)
			assert.deepEqual(state.data, it.data)
		}
	})

	test('previewMindmap with a patch and a ghost: the dragged branch is drawn at its place; the rest stays as drawn, its old room too', () => {
		for (const style of [{}, { layout: 'right' }]) {
			const it = sample(style)
			const l = mindmapLayout(it)
			const root = l.byKey.get(R)
			const r = centre(root)
			// A dropped right on B, and A over the middle line (it changes side in the picture)
			for (const at of [{ x: r.x + rel(l, B).x, y: r.y + rel(l, B).y }, { x: r.x - 300, y: r.y + 40 }]) {
				const drop = placeNode(it, A, at)
				const ghost = mindmapLayout(previewMindmap(it, { patch: drop.p, ghost: A, anchor: { x: root.x, y: root.y } }))
				assert.equal(ghost.byKey.get(A).free, true)
				near(centre(ghost.byKey.get(A)), at, 'A at the ghost')
				for (const k of [R, B, L]) {
					assert.deepEqual([ghost.byKey.get(k).x, ghost.byKey.get(k).y], [l.byKey.get(k).x, l.byKey.get(k).y], `${k} stays while A is dragged`)
				}
				const dropped = mindmapLayout(applyMindmapPatch(it, drop.p))
				const a = dropped.byKey.get(A)
				assert.ok(dropped.nodes.every((n) => n.key === A || n.parent === null || !overlaps(a, n)), 'after the drop nothing lies under A')
			}
		}
		const it = sample()
		const drop = placeNode(it, A, { x: 0, y: 0 })
		assert.equal(Object.keys(previewMindmap(it, { patch: drop.p, ghost: A })).includes('mmGhost'), false, 'never on the wire')
	})
})

describe('mindmap org chart and tree (job 198, AK2)', () => {
	const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	const mid = (n) => n.x + n.w / 2
	const one = 16 * LINE_HEIGHT

	test('org: the children in a row below their parent in order, their block centred on it; rows per depth MM_ORG_GAP_Y apart', () => {
		const l = mindmapLayout(sample({ layout: 'org' }))
		const [r, a, b, left, a1, a2] = [R, A, B, L, A1, A2].map((k) => l.byKey.get(k))
		assert.deepEqual(l.nodes.map((n) => n.key), [R, A, A1, A2, B, L], 'outline order')
		assert.ok([a, b, left].every((n) => n.y === a.y && n.side === 1), 'one row, all on one side (d is ignored)')
		assert.ok(a.x + a.w < b.x && b.x + b.w < left.x, 'in order o: A, B, Links')
		assert.ok(Math.abs((Math.min(a.x, a1.x) + left.x + left.w) / 2 - mid(r)) < 1e-9, 'the block of the main branches (A with its subtree) centred below the root')
		assert.ok(Math.abs((a1.x + a2.x + a2.w) / 2 - mid(a)) < 1e-9, 'A1 and A2 centred below A')
		assert.equal(a1.x + a1.w + MM_ORG_GAP_X <= a2.x + 1e-9, true)
		assert.ok(Math.abs(a.y - (r.y + r.h + MM_ORG_GAP_Y)) < 1e-9, 'row 1 below the root')
		const row1 = Math.max(a.y + a.h, b.y + b.h, left.y + left.h)
		assert.ok(Math.abs(a1.y - (row1 + MM_ORG_GAP_Y)) < 1e-9 && a1.y === a2.y, 'row 2 below the lowest card of row 1')
		for (const x of l.nodes) {
			for (const y of l.nodes) {
				if (x !== y) assert.ok(!overlaps(x, y), `${x.key} and ${y.key} do not overlap`)
			}
		}
		assert.deepEqual({ x: a.attach.x, y: a.attach.y }, { x: mid(a), y: a.y + a.h }, 'attached at the middle of the bottom edge')
		assert.deepEqual({ x: a.inner.x, y: a.inner.y }, { x: mid(a), y: a.y }, 'reached at the middle of the top edge')
		assert.deepEqual({ x: a.dot.x, y: a.dot.y }, { x: mid(a), y: a.y + a.h + MM_DOT_R + 1 }, 'the dot below the card')
		assert.equal(b.dot, null)
	})

	test('org: uneven subtrees take their width, never overlapping; folded children are hidden', () => {
		const it = mm([
			[R, { o: 'i0' }, 'Chefin'], [A, { o: 'i0', p: R }, 'A'], [B, { o: 'i1', p: R }, 'B'],
			[A1, { o: 'i0', p: A }, 'A1'], [A2, { o: 'i1', p: A }, 'A2'], [L, { o: 'i2', p: A }, 'A3'],
			['n60000000', { o: 'i0', p: A1 }, 'A1a'], ['n70000000', { o: 'i1', p: A1 }, 'A1b'],
		], { layout: 'org' })
		const l = mindmapLayout(it)
		for (const x of l.nodes) {
			for (const y of l.nodes) {
				if (x !== y) assert.ok(!overlaps(x, y), `${x.key} and ${y.key}`)
			}
		}
		const b = l.byKey.get(B)
		const a1b = l.byKey.get('n70000000')
		assert.ok(l.byKey.get(L).x + l.byKey.get(L).w + MM_ORG_GAP_X <= b.x + 1e-9, 'B right of the whole subtree of A')
		assert.ok(a1b.x + a1b.w <= l.byKey.get(L).x, 'the children of A1 stay left of A3')
		const folded = mindmapLayout(applyMindmapPatch(it, { [nodePath(A) + '.f']: true }))
		assert.deepEqual(folded.nodes.map((n) => n.key), [R, A, B])
		assert.equal(folded.byKey.get(A).folded, true)
		assert.equal(folded.byKey.get(A).count, 5)
	})

	test('org: a card is its name bold over its role, after a band; at least MM_CARD_MIN_W wide; every node a box', () => {
		assert.deepEqual(cardLines('Anna\nLead\nBerlin'), { name: 'Anna', role: 'Lead\nBerlin' })
		assert.deepEqual(cardLines('Anna'), { name: 'Anna', role: '' })
		assert.deepEqual(cardLines(''), { name: '', role: '' })
		const calls = []
		const measure = (text, maxW, size, bold) => {
			calls.push([text, maxW, size, bold])
			return estimateNodeSize(text, maxW, size, bold)
		}
		const it = mm([[R, { o: 'i0' }, 'Chefin\nCEO'], [A, { o: 'i0', p: R }, 'Anna'], [B, { o: 'i1', p: R, s: 'pill' }]], { layout: 'org' })
		const l = mindmapLayout(it, measure)
		const [r, a, b] = [R, A, B].map((k) => l.byKey.get(k))
		assert.deepEqual([r.name, r.role, a.name, a.role, b.name, b.role], ['Chefin', 'CEO', 'Anna', '', '', ''])
		assert.ok(calls.some((c) => c[0] === 'Chefin' && c[1] === 200 && c[2] === 16 && c[3] === true), 'the name bold, wrapped at 200')
		assert.ok(calls.some((c) => c[0] === 'CEO' && c[3] === false), 'the role normal')
		assert.ok(calls.some((c) => c[0] === 'CEO' && c[2] === 14), 'job 266: the role 14')
		assert.ok(Math.abs(r.h - (MM_CARD_BAND + one + 14 * 1.2 + 16)) < 1e-9, 'with a role: two lines')
		assert.ok(Math.abs(a.h - (MM_CARD_BAND + one + 16)) < 1e-9, 'without: one')
		assert.ok(Math.abs(b.h - a.h) < 1e-9, 'an empty card has one line')
		assert.ok(r.w >= MM_CARD_MIN_W && a.w === MM_CARD_MIN_W)
		assert.deepEqual([r.shape, a.shape, b.shape], ['roundRect', 'roundRect', 'pill'], 'line is drawn as roundRect')
		assert.equal(r.bold, false, 'the root is a card like the others (its name bold)')
		assert.equal(mindmapLayout(sample()).byKey.get(A).name, null, 'no card outside org')
		assert.equal(drawnShape({}, false, 'tree'), 'roundRect')
		assert.equal(drawnShape({ s: 'line' }, false, 'org'), 'roundRect')
		assert.equal(drawnShape({}, false, 'both'), 'line')
	})

	test('tree: the geometry of right with boxes; attached right, reached left', () => {
		const tree = mindmapLayout(sample({ layout: 'tree' }))
		const boxes = mm([
			[R, { o: 'i0' }, 'Thema'], [A, { o: 'i0', p: R, c: '#0275a9', s: 'roundRect' }, 'Alpha'], [B, { o: 'i1', p: R, s: 'roundRect' }, 'Beta'],
			[L, { o: 'i2', p: R, d: 'l', s: 'roundRect' }, 'Links'], [A1, { o: 'i0', p: A, s: 'roundRect' }, 'a1'], [A2, { o: 'i1', p: A, s: 'roundRect' }, 'a2'],
		], { layout: 'right' })
		const right = mindmapLayout(boxes)
		assert.deepEqual(tree.nodes.map((n) => n.key), right.nodes.map((n) => n.key))
		// job 266 (O1): every node a card with its band on the left, children MM_GAP_X beyond their parent
		const n = (k) => tree.byKey.get(k)
		assert.ok(tree.nodes.every((x) => x.band === 'left' && x.w >= MM_CARD_MIN_W + MM_CARD_BAND && x.name !== null))
		assert.ok(Math.abs(n(A1).x - (n(A).x + n(A).w + MM_GAP_X)) < 1e-9)
		assert.ok(Math.abs(n(A).x - (n(R).x + n(R).w + MM_GAP_X)) < 1e-9)
		assert.ok(Math.abs(n(A).h - (16 * 1.2 + 16)) < 1e-9, 'no band height in tree')
		const a = tree.byKey.get(A)
		assert.deepEqual([a.attach.x, a.attach.y, a.inner.x, a.inner.y], [a.x + a.w, a.y + a.h / 2, a.x, a.y + a.h / 2])
		assert.ok(tree.nodes.every((n) => n.side !== -1 && n.shape === 'roundRect'))
	})

	test('d and m stay stored but do not count in org and tree; back to both the boxes are those of before', () => {
		const it = sample({}, { m: [400, -300] })
		const before = mindmapLayout(it)
		assert.equal(before.byKey.get(A1).free, true)
		for (const layout of ['org', 'tree']) {
			const l = mindmapLayout(applyMindmapPatch(it, { 'style.layout': layout }))
			assert.ok(l.nodes.every((n) => n.free === false && n.side !== -1), layout)
			assert.equal(hasPlaced(applyMindmapPatch(it, { 'style.layout': layout }), R), false, 'no "Rearrange" there')
			assert.deepEqual(placeNode(applyMindmapPatch(it, { 'style.layout': layout }), B, { x: 0, y: 0 }), { error: 'same' }, 'nothing placed freely')
		}
		const back = mindmapLayout(applyMindmapPatch(applyMindmapPatch(it, { 'style.layout': 'org' }), { 'style.layout': null }))
		assert.deepEqual(back.nodes.map((n) => [n.key, n.x, n.y, n.side, n.free]), before.nodes.map((n) => [n.key, n.x, n.y, n.side, n.free]))
		assert.equal(mindTree(applyMindmapPatch(it, { 'style.layout': 'tree' })).layout, 'tree')
		assert.equal(mindTree(applyMindmapPatch(it, { 'style.layout': 'diagonal' })).layout, 'both', 'an unknown layout counts as both')
	})

	test('org: the arrows, the drop target by quarters of the width, moveNode keeps the m of the nodes below', () => {
		const it = sample({ layout: 'org' }, { m: [400, -300] })
		assert.equal(stepFocus(it, R, 'down'), A)
		assert.equal(stepFocus(it, R, 'right'), null)
		assert.equal(stepFocus(it, R, 'up'), null)
		assert.equal(stepFocus(it, A, 'down'), A1)
		assert.equal(stepFocus(it, A, 'up'), R)
		assert.equal(stepFocus(it, A, 'right'), B)
		assert.equal(stepFocus(it, A, 'left'), null)
		assert.equal(stepFocus(it, B, 'left'), A)
		assert.equal(stepFocus(it, B, 'right'), L, 'Links is a sibling in the row, d does not count')
		assert.equal(stepFocus(it, A2, 'left'), A1)
		const l = mindmapLayout(it)
		const b = l.byKey.get(B)
		const cy = b.y + b.h / 2
		assert.deepEqual(dropTarget(it, l, A2, b.x + 2, cy), { key: B, where: 'before', side: null })
		assert.deepEqual(dropTarget(it, l, A2, b.x + b.w - 2, cy), { key: B, where: 'after', side: null })
		assert.deepEqual(dropTarget(it, l, A2, mid(b), b.y + 2), { key: B, where: 'child', side: null }, 'top quarter of the height: still a child')
		const r = l.byKey.get(R)
		assert.deepEqual(dropTarget(it, l, A2, r.x + 2, r.y + r.h / 2), { key: R, where: 'child', side: 'r' })
		const mv = moveNode(it, A, { key: B, where: 'child' })
		assert.ok(!Object.keys(mv.p).some((k) => k.startsWith(nodePath(A1))), 'the m of A1 stays as it is')
		assert.equal(mv.p[nodePath(A) + '.p'], B)
		const tree = sample({ layout: 'tree' })
		assert.equal(stepFocus(tree, R, 'right'), A)
		assert.equal(stepFocus(tree, R, 'left'), null, 'no left side in tree')
		assert.equal(stepFocus(tree, A, 'down'), B)
	})

	test('risk: 499 leaves below the root in org stay below the box limit, without overlap', () => {
		const list = [[R, { o: 'i0' }, 'Chefin']]
		let o = null
		for (let i = 1; i < MM_MAX_NODES; i++) {
			o = keyBetween(o, null)
			list.push(['n' + '0123456789abcdefghijklmnopqrstuvwxyz'[i % 36] + String(i).padStart(7, '0'), { o, p: R }, 'L' + i])
		}
		const it = mm(list, { layout: 'org' })
		assert.equal(checkMindmap(it.data), true)
		const l = mindmapLayout(it)
		assert.ok(l.w < 100000 && Math.abs(l.w - ((MM_MAX_NODES - 1) * (MM_CARD_MIN_W + MM_ORG_GAP_X) - MM_ORG_GAP_X)) < 1e-6, String(l.w))
		const row = l.nodes.filter((n) => n.parent === R)
		for (let i = 1; i < row.length; i++) assert.ok(row[i - 1].x + row[i - 1].w < row[i].x)
		const r = withBox(mm(list, {}), { p: { 'style.layout': 'org' }, inv: { 'style.layout': null } })
		assert.ok(Math.abs(r.p.w - Math.round(l.w * 100) / 100) <= 0.01)
	})
})

describe('mindmap palette', () => {
	test('white text on every branch colour has at least 4.5 : 1', () => {
		const lin = (v) => {
			const c = v / 255
			return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
		}
		for (const c of MM_COLORS) {
			const n = parseInt(c.slice(1), 16)
			const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
			assert.ok(1.05 / (L + 0.05) >= 4.5, c)
		}
	})
})
