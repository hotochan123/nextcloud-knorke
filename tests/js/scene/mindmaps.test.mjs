/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 195 (AK4): mind maps in the scene, on the real SceneManager,
 * InputController and TextEditor with the recording renderer stub
 * (sceneHarness.mjs; node sizes from estimateNodeSize):
 * - stats().mindmaps with layout both and right, at LOD 1 and LOD 2; the
 *   node builder (fake Konva) with and without text
 * - a click focuses the node under it; a click into the empty part of the
 *   hull hits the item below; Esc takes the focus, then the selection
 * - the "+" only at a focused node of the one selected, unlocked map in
 *   mode edit with the select tool, without an editor and not at LOD 2
 * - a click on a fold dot asks to fold; a node drag shows its ghost and asks
 *   for the move at the release, Esc ends it without one; (job 196) onto
 *   empty space it is drawn placed freely at once and the release asks to
 *   place it there
 * - a double click opens the editor kind node over the node; Enter and Tab
 *   in it ask for a sibling and a child after the final text; Shift+Enter
 *   stays; a node someone else holds offers "Take over"
 * - the keys at a focus: Tab, Enter, the arrows, F2, Delete
 * - the intent contextMenu carries the node
 * - (job 198) org and tree: stats, the node (two texts per card, right-angled
 *   lines, the band), the "+", a drag without preview, the arrows, the
 *   placeholder of a card's editor
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { callsOf, note, setStubLod, setupScene } from './sceneHarness.mjs'
import { dispatch } from './fakeDom.mjs'
import { dropMark, mindmap as mindmapSpec } from '../../../src/scene/nodes/mindmap.js'
import { nodeSpecFor } from '../../../src/scene/nodes/index.js'
import { coarseLook } from '../../../src/scene/nodes/coarse.js'
import { bucketOf, estimateNodeSize, mindmapLayout, nodeAtLayout } from '../../../src/model/mindmap.js'
import { MM_COARSE, MM_COLORS } from '../../../src/model/tokens.js'

const M = '01JA00000000000000000000M1'
const N = '01JA00000000000000000000N1'
const R = 'n00000000'
const A = 'n10000000'
const B = 'n20000000'
const A1 = 'n30000000'
const L = 'n40000000'

/** root "Thema", right A (child A1) and B, left L; its box as the estimate lays it out, at (100, 100). */
function mm(o = {}, style = {}) {
	const nodes = {
		b0: { [R]: { o: 'i0' } }, b1: { [A]: { o: 'i0', p: R, c: MM_COLORS[0] } }, b2: { [B]: { o: 'i1', p: R } },
		b3: { [A1]: { o: 'i0', p: A } }, b4: { [L]: { o: 'i2', p: R, d: 'l' } },
	}
	const texts = { b0: { [R]: 'Thema' }, b1: { [A]: 'Alpha' }, b2: { [B]: 'Beta' }, b3: { [A1]: 'a1' }, b4: { [L]: 'Links' } }
	const it = { id: M, t: 'mindmap', x: 100, y: 100, w: 0, h: 0, r: 0, z: 'a5', parent: null, data: { nodes, texts }, style, ...o }
	const l = mindmapLayout(it)
	return { ...it, w: l.w, h: l.h }
}

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

function setup(items = [mm()], opts = {}) {
	h = setupScene(items, opts)
	h.frame()
	return h
}

const stat = () => h.scene.stats().mindmaps[0]
const box = (key) => stat().nodes.find((n) => n.key === key)
/** the middle of a node's box (world = container coordinates at scale 1 from the origin) */
const mid = (key) => {
	const b = box(key)
	return [b.x + b.w / 2, b.y + b.h / 2]
}
const click = (x, y, props = {}) => {
	h.pointer('pointerdown', x, y, props)
	h.pointer('pointerup', x, y, props)
	h.frame()
}
const handleNames = () => h.scene.handles().map((x) => x.name)
const editor = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null
const focusLog = () => h.log.filter((e) => e[0] === 'onNodeFocus').map((e) => e.slice(1))

describe('job 195 AK4: stats().mindmaps, levels and the node', () => {
	test('stats().mindmaps: world boxes, sides, colours and shapes; layout right; LOD 1 and LOD 2', () => {
		setup()
		const s = stat()
		assert.deepEqual([s.id, s.layout, s.focus, s.nodes.length], [M, 'both', null, 5])
		assert.deepEqual(s.nodes.map((n) => [n.key, n.side, n.depth]), [[R, 0, 0], [A, 1, 1], [B, 1, 1], [A1, 1, 2], [L, -1, 1]].sort((x, y) => s.nodes.findIndex((n) => n.key === x[0]) - s.nodes.findIndex((n) => n.key === y[0])))
		assert.ok(box(A).x > box(R).x + box(R).w && box(L).x + box(L).w < box(R).x)
		assert.deepEqual([box(R).shape, box(A).shape, box(A).color, box(A1).color], ['roundRect', 'pill', MM_COLORS[0], MM_COLORS[0]])
		assert.ok(Math.abs(Math.min(...s.nodes.map((n) => n.x)) - 100) < 1e-9, 'the hull starts at the item box')
		h.model.apply({ upserts: [mm({}, { layout: 'right' })] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		assert.equal(stat().layout, 'right')
		assert.equal(box(L).side, 1, 'right only')
		for (const lod of [1, 2]) {
			setStubLod(lod)
			h.frame()
			assert.equal(h.scene.stats().mindmaps.length, 1, 'LOD ' + lod)
		}
		assert.deepEqual({ ...coarseLook(mm()) }, { cls: 'tree', color: MM_COARSE, title: '' })
	})

	test('node: one lines shape, one ui shape on top, a text per node at level 0 only; the editor hides its node\'s text', () => {
		const built = []
		class Node {
			constructor(a = {}) {
				this.attrs = { ...a }
				built.push(this)
			}

			setAttrs(a) { Object.assign(this.attrs, a) }
			getAttr(k) { return this.attrs[k] }
			visible(v) { this.attrs.visible = v }
			transformsEnabled() {}
			add() {}
			moveToTop() { this.top = true }
			destroy() { this.destroyed = true }
		}
		const ctx = { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {}, Line: class extends Node {}, shadows: true }
		assert.equal(nodeSpecFor('mindmap'), mindmapSpec)
		const it = mm()
		const e = mindmapSpec.build(ctx, it, { x: 100, y: 100, w: it.w, h: it.h, r: 0 }, 0, A)
		assert.deepEqual([...e.parts.texts.keys()].sort(), [R, A, B, A1, L].sort())
		assert.equal(e.parts.texts.get(A).attrs.visible, false, 'the open editor\'s node')
		assert.equal(e.parts.texts.get(R).attrs.fontStyle, 'bold')
		assert.equal(e.parts.texts.get(R).attrs.align, 'center')
		assert.equal(e.parts.texts.get(A).attrs.align, 'center', 'job 266: a main pill')
		assert.equal(e.parts.texts.get(A).attrs.fontStyle, 'bold')
		assert.equal(e.parts.texts.get(A1).attrs.align, 'left')
		mindmapSpec.setLod(ctx, e, it, null, 1)
		assert.equal(e.parts.texts.size, 0, 'level 1: no text')
		mindmapSpec.setUi(e, { focus: A, dots: true })
		assert.deepEqual(e.ui, { focus: A, hover: null, dots: true })
		// the painters (job 266): tapering branches as filled outlines, the "+n" badge of a folded branch
		const calls = []
		const c = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])), set: (t, k, v) => { t[k] = v; return true } })
		const folded = mm()
		folded.data.nodes[bucketOf(A)][A].f = true
		const lf = mindmapLayout(folded)
		e.layout = lf
		e.lod = 0
		e.parts.lines.attrs.sceneFunc(c)
		assert.equal(calls.filter((x) => x[0] === 'bezierCurveTo').length, 0, 'no stroked curves')
		assert.equal(calls.filter((x) => x[0] === 'closePath').length >= 3, true, 'A, B and L (A1 is hidden)')
		assert.deepEqual(calls.find((x) => x[0] === 'fillText').slice(1, 2), ['+1'], 'one hidden node')
	})
})

describe('job 195 AK4: focus, handles, dots and drags', () => {
	test('a click focuses the node under it (onNodeFocus); the empty part of the hull hits the item below; Esc takes the focus, then the selection', () => {
		// a note under the empty corner of the hull
		setup([note(N, { x: 100, y: 100, w: 20, h: 20, z: 'a1' }), mm()])
		click(...mid(A))
		assert.deepEqual(h.scene.getSelection(), [M])
		assert.deepEqual(focusLog().at(-1), [M, A])
		assert.equal(stat().focus, A)
		assert.deepEqual(callsOf('setMindmapUi').at(-1), [M, { focus: A, hover: null, dots: true }])
		click(...mid(R))
		assert.equal(stat().focus, R, 'the root is a node too')
		click(105, 105)
		assert.deepEqual(h.scene.getSelection(), [N], 'the empty corner of the hull: the note below')
		assert.deepEqual(focusLog().at(-1), [null, null], 'another selection: no focus')
		click(...mid(B))
		h.focusCanvas()
		h.key('Escape')
		assert.deepEqual([h.scene.getSelection(), stat().focus], [[M], null], 'first the focus')
		h.key('Escape')
		assert.deepEqual(h.scene.getSelection(), [], 'then the selection')
		// Shift-click: into the selection without a focus
		click(...mid(A), { shiftKey: true })
		assert.deepEqual([h.scene.getSelection(), stat().focus], [[M], null])
	})

	test('the "+" only at a focused node of the one selected, unlocked map (select tool, no editor, not LOD 2); a click asks for the node', () => {
		setup()
		click(...mid(A))
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child', 'mm-sibling'])
		assert.ok(!handleNames().some((n) => n.startsWith('plus-')), 'never the connector "+"')
		const plus = h.scene.handles().find((x) => x.name === 'mm-child')
		assert.ok(plus.x > box(A).x + box(A).w, 'beyond the outer edge (and the dot)')
		click(plus.x, plus.y)
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'child', open: true })
		const sib = h.scene.handles().find((x) => x.name === 'mm-sibling')
		click(sib.x, sib.y)
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'sibling', open: true })
		click(...mid(R))
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child-r', 'mm-child-l'])
		const left = h.scene.handles().find((x) => x.name === 'mm-child-l')
		click(left.x, left.y)
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: R, as: 'child', side: 'l', open: true })
		// right only: one "+" at the root
		h.model.apply({ upserts: [mm({}, { layout: 'right' })] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		h.frame()
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child-r'])
		// an open editor, LOD 2, a locked map: none
		h.scene.openTextEditor(M, { cell: A })
		h.frame()
		assert.equal(handleNames().filter((n) => n.startsWith('mm-')).length, 0, 'editor open')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		setStubLod(2)
		h.scene.setCamera({ x: 0, y: 0, scale: 0.05 })
		h.frame()
		assert.equal(handleNames().filter((n) => n.startsWith('mm-')).length, 0, 'LOD 2')
	})

	test('a locked map: the focus and the arrows, no "+", no drag, no keys that change it', () => {
		setup([mm({ lock: { by: 'pidbob', name: 'Bob' } })])
		click(...mid(A))
		assert.deepEqual([h.scene.getSelection(), stat().focus], [[M], A])
		assert.equal(handleNames().filter((n) => n.startsWith('mm-')).length, 0)
		h.focusCanvas()
		h.key('ArrowRight')
		assert.equal(stat().focus, A1, 'the arrows move the focus')
		h.key('Tab')
		h.key('Delete')
		assert.equal(h.intents('mmAdd').length + h.intents('mmDelete').length, 0)
	})

	test('a click on a fold dot asks to fold that branch and changes no selection; a hovering mouse shows the hollow dot of its node', () => {
		setup()
		const s = stat()
		const l = mindmapLayout(mm())
		const dot = l.byKey.get(A).dot
		h.pointer('pointermove', 100 + dot.x, 100 + dot.y, { buttons: 0 })
		h.frame()
		assert.deepEqual(callsOf('setMindmapUi').at(-1), [M, { focus: null, hover: A, dots: false }])
		click(100 + dot.x, 100 + dot.y)
		assert.deepEqual(h.intents('mmFold'), [{ type: 'mmFold', id: M, key: A }])
		assert.deepEqual(h.scene.getSelection(), [], 'no selection')
		assert.ok(s)
	})

	test('a node drag: the ghost and the target; one intent at the release; Esc without one; the root drags the whole map', () => {
		setup()
		click(...mid(A))
		const [bx, by] = mid(B)
		h.pointer('pointerdown', bx, by)
		h.pointer('pointermove', bx + 10, by + 10)
		h.frame()
		// job 196: the target comes from the picture drawn while B is dragged (the rest stays where it was)
		const [tx, ty] = mid(A1)
		h.pointer('pointermove', tx, ty)
		h.frame()
		assert.deepEqual(h.scene.stats().nodeDrag, { id: M, key: B, target: { key: A1, where: 'child', side: null } })
		const prev = callsOf('setNodeDragPreview').at(-1)[0]
		assert.deepEqual(prev.target.where, 'child')
		h.pointer('pointerup', tx, ty)
		assert.deepEqual(h.intents('mmMove'), [{ type: 'mmMove', id: M, key: B, target: { key: A1, where: 'child', side: null } }])
		assert.deepEqual(callsOf('setNodeDragPreview').at(-1), [null])
		// the top quarter of A1: before it; Esc ends it without an intent
		h.pointer('pointerdown', bx, by)
		h.pointer('pointermove', tx, ty + 10)
		h.pointer('pointermove', tx, box(A1).y + 1)
		h.focusCanvas()
		h.key('Escape')
		h.pointer('pointerup', tx, box(A1).y + 1)
		assert.equal(h.intents('mmMove').length, 1, 'Esc: no intent')
		// the root moves the map
		const [rx, ry] = mid(R)
		h.pointer('pointerdown', rx, ry)
		h.pointer('pointermove', rx + 40, ry)
		h.pointer('pointerup', rx + 40, ry)
		assert.equal(h.intents('move').at(-1).ids[0], M)
	})

	test('job 196 AK4: dragged onto empty space the node is drawn at its ghost (free) at once; the release asks to place it there; Esc draws the stored map again', () => {
		setup()
		click(...mid(A))
		const b0 = box(B)
		const [bx, by] = mid(B)
		const a0 = box(A)
		h.pointer('pointerdown', bx, by)
		h.pointer('pointermove', bx + 10, by + 10)
		h.pointer('pointermove', bx + 300, by + 200)
		h.frame()
		assert.equal(h.scene.stats().nodeDrag.target, null)
		const b = box(B)
		assert.equal(b.free, true, 'B drawn as placed freely')
		assert.ok(Math.abs(b.x + b.w / 2 - (bx + 300)) < 0.01 && Math.abs(b.y + b.h / 2 - (by + 200)) < 0.01, 'at the ghost')
		const ghost = callsOf('setNodeDragPreview').at(-1)[0].ghost
		assert.ok(Math.abs(ghost.x + ghost.w / 2 - bx - 300) < 1e-9 && Math.abs(ghost.y + ghost.h / 2 - by - 200) < 1e-9)
		assert.equal(callsOf('setNodeDragPreview').at(-1)[0].target, null)
		assert.deepEqual(callsOf('setTablePreview').at(-1)[0], M, 'the renderer draws the preview')
		assert.deepEqual([box(R).x, box(R).y], [stat().nodes.find((n) => n.key === R).x, box(R).y], 'the root stays')
		h.pointer('pointerup', bx + 300, by + 200)
		const [i] = h.intents('mmMove')
		assert.deepEqual({ ...i, place: null }, { type: 'mmMove', id: M, key: B, target: null, place: null })
		assert.ok(Math.abs(i.place.x - bx - 300) < 1e-9 && Math.abs(i.place.y - by - 200) < 1e-9, 'place: the centre of the ghost')
		assert.deepEqual(box(B), { ...b0, free: false }, 'after the release the stored map until the patch arrives')
		assert.deepEqual(callsOf('setTablePreview').at(-1), [M, null])
		// Esc: no intent, the stored picture again
		h.pointer('pointerdown', bx, by)
		h.pointer('pointermove', bx + 10, by + 10)
		h.pointer('pointermove', bx - 600, by)
		h.frame()
		assert.equal(box(B).free, true)
		h.focusCanvas()
		h.key('Escape')
		h.pointer('pointerup', bx - 600, by)
		h.frame()
		assert.equal(h.intents('mmMove').length, 1, 'Esc: no intent')
		assert.deepEqual(box(B), { ...b0, free: false })
		assert.deepEqual(box(A), a0)
	})
})

describe('job 195 AK4: the node editor and the keys', () => {
	test('a double click opens the editor kind node over the node; Enter and Tab ask for a sibling and a child after the final text; Shift+Enter stays', () => {
		setup()
		const [x, y] = mid(A)
		const p = { clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		const ta = editor()
		assert.ok(ta)
		assert.deepEqual([ta.getAttribute('data-knorke-editor-kind'), ta.getAttribute('data-knorke-node')], ['node', A])
		assert.match(ta.style.getPropertyValue('transform'), new RegExp(`translate\\(${box(A).x + 4}px, ${box(A).y}px\\)`), 'over the node (inset padX − padY)')
		assert.equal(h.scene.isActive(M), false, 'the others\' nodes arrive meanwhile')
		assert.equal(h.scene.stats().editingCell, A)
		assert.deepEqual(callsOf('setTextHidden').at(-1), [M, true, A])
		const r0 = { x: box(R).x, y: box(R).y }
		ta.value = 'a long text that wraps into a second line for sure, and more words after it'
		dispatch(ta, 'input')
		h.frame()
		assert.ok(box(A).h > 30, 'the node grows while typing')
		assert.deepEqual({ x: box(R).x, y: box(R).y }, r0, 'the root stays')
		dispatch(ta, 'keydown', { key: 'Enter', shiftKey: true })
		assert.ok(editor(), 'Shift+Enter: a new line')
		dispatch(ta, 'keydown', { key: 'Enter' })
		const text = h.intents('text').at(-1)
		assert.deepEqual([text.cell, text.final, text.path], [A, true, 'data.texts.b1.' + A])
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'sibling', open: true })
		h.scene.openTextEditor(M, { cell: B })
		dispatch(editor(), 'keydown', { key: 'Tab' })
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: B, as: 'child', open: true })
		h.scene.openTextEditor(M, { cell: B })
		dispatch(editor(), 'keydown', { key: 'Tab', shiftKey: true })
		assert.equal(editor(), null, 'Shift+Tab: closed')
		assert.equal(h.intents('mmAdd').length, 2)
		// the root's editor is bold
		h.scene.openTextEditor(M, { cell: R })
		assert.equal(editor().style.getPropertyValue('font-weight'), 'bold')
	})

	test('a node someone else holds opens nothing; its chip sits at the node and offers "Take over"', () => {
		setup()
		const bob = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#1565c0', guest: false, cursor: null, selection: [], drag: [], editing: M, editingCell: B, editingHolder: true }
		h.scene.setRemoteSampler(() => [bob])
		h.frame()
		const chip = h.container.descendants().find((el) => el.getAttribute('data-knorke-editing') === M)
		assert.ok(chip)
		assert.equal(chip.getAttribute('data-knorke-node'), B)
		assert.equal(h.scene.openTextEditor(M, { cell: B }), false)
		assert.equal(h.scene.openTextEditor(M, { cell: A }), true, 'another node is free')
	})

	test('the keys at a focus: Tab a child, Enter a sibling (the root: its editor), F2 the editor, the arrows, Delete', () => {
		setup()
		click(...mid(A))
		h.focusCanvas()
		h.key('Tab')
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'child', open: true })
		h.key('Enter')
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'sibling', open: true })
		h.key('ArrowRight')
		assert.equal(stat().focus, A1)
		h.key('ArrowLeft')
		h.key('ArrowDown')
		assert.equal(stat().focus, B)
		h.key('Tab', { shiftKey: true })
		assert.equal(stat().focus, R, 'Shift+Tab: the parent')
		h.key('ArrowLeft')
		assert.equal(stat().focus, L)
		h.key('Delete')
		assert.deepEqual(h.intents('mmDelete'), [{ type: 'mmDelete', id: M, key: L }])
		h.key('ArrowRight')
		assert.equal(stat().focus, R)
		h.key('Delete')
		assert.deepEqual(h.intents('delete').at(-1), { type: 'delete', ids: [M] }, 'the root: the map')
		h.key('Enter')
		assert.deepEqual(editor()?.getAttribute('data-knorke-node'), R, 'Enter at the root: its editor')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		h.focusCanvas()
		h.key('ArrowRight')
		h.key('F2')
		assert.deepEqual(editor()?.getAttribute('data-knorke-node'), A, 'F2: the focused node')
	})

	test('the intent contextMenu carries the node under the point (it gets the focus), on the keyboard path the focus', () => {
		setup()
		click(...mid(B))
		const [x, y] = mid(A1)
		h.pointer('pointerdown', x, y, { button: 2, buttons: 2 })
		h.pointer('pointerup', x, y, { button: 2, buttons: 0 })
		h.frame()
		const menu = h.intents('contextMenu').at(-1)
		assert.deepEqual([menu.id, menu.cell], [M, A1])
		assert.equal(stat().focus, A1)
		h.focusCanvas()
		h.key('F10', { shiftKey: true })
		assert.equal(h.intents('contextMenu').at(-1).cell, A1, 'the keyboard path: the focus')
	})
})

describe('job 195 round 1: a fold dot that is not drawn', () => {
	test('a finger on the dot of an unfolded branch of a map that is not selected focuses the node; a folded dot folds; a selected map\'s dot folds', () => {
		setup()
		const l = mindmapLayout(mm())
		const dot = l.byKey.get(A).dot
		const touch = { pointerType: 'touch', pointerId: 7 }
		click(100 + dot.x, 100 + dot.y, touch)
		assert.equal(h.intents('mmFold').length, 0, 'not drawn: no fold')
		assert.deepEqual([h.scene.getSelection(), stat().focus], [[M], A], 'the node instead')
		// the map is selected now: its dots are drawn, a finger folds
		click(100 + dot.x, 100 + dot.y, touch)
		assert.deepEqual(h.intents('mmFold'), [{ type: 'mmFold', id: M, key: A }])
		// a folded branch of a map that is not selected: its dot is always drawn
		h.focusCanvas()
		h.key('Escape')
		h.key('Escape')
		const folded = mm()
		folded.data.nodes[bucketOf(A)][A].f = true
		h.model.apply({ upserts: [folded] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['data'])]]), geometry: new Set(), reordered: false })
		h.frame()
		const fd = mindmapLayout(folded).byKey.get(A).dot
		click(100 + fd.x, 100 + fd.y, touch)
		assert.equal(h.intents('mmFold').length, 2, 'a folded dot')
		assert.deepEqual(h.scene.getSelection(), [], 'no selection')
	})
})

describe('job 195 round 2: the "+" of a focused node never lies on a node', () => {
	test('the "+" lie off every node box and dot (a node with a child, the root with both sides); a press on a node there focuses it, by mouse and by finger, and adds nothing', () => {
		setup()
		const l = mindmapLayout(mm())
		const offNodes = (label) => {
			for (const p of h.scene.handles().filter((x) => x.name.startsWith('mm-'))) {
				assert.equal(nodeAtLayout(l, p.x - 100, p.y - 100, 0), null, `${label}: ${p.name} at ${p.x}, ${p.y}`)
			}
		}
		click(...mid(A))
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child', 'mm-sibling'])
		offNodes('A with its child A1')
		const plus = h.scene.handles().find((x) => x.name === 'mm-child')
		assert.ok(plus.x > box(A).x + box(A).w && plus.x < box(A1).x, 'between A (and its dot) and its child')
		const sib = h.scene.handles().find((x) => x.name === 'mm-sibling')
		assert.ok(sib.x < box(A).x && sib.y > box(A).y + box(A).h && sib.y < box(B).y, 'beside A\'s inner end, below A, above B')
		// the child A1 by mouse: its focus, no new node
		click(...mid(A1))
		assert.equal(stat().focus, A1)
		// the next sibling B by finger (the "+" reach a finger with 22 px): its focus
		click(...mid(A))
		const touch = { pointerType: 'touch', pointerId: 9 }
		click(...mid(B), touch)
		assert.equal(stat().focus, B)
		click(...mid(R))
		offNodes('the root')
		click(...mid(L), touch)
		assert.equal(stat().focus, L, 'the left main branch beside the root')
		assert.equal(h.intents('mmAdd').length, 0, 'no node added')
		// the "+" still add where they are drawn
		click(...mid(A))
		const p2 = h.scene.handles().find((x) => x.name === 'mm-child')
		click(p2.x, p2.y, touch)
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'child', open: true })
		const s2 = h.scene.handles().find((x) => x.name === 'mm-sibling')
		click(s2.x, s2.y)
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'sibling', open: true })
	})
})

describe('job 198 AK5: org chart and tree in the scene', () => {
	/** the sample map in a layout, the root's text optionally with a role */
	const laid = (layout, rootText = 'Thema') => {
		const it = mm({}, { layout })
		it.data.texts.b0[R] = rootText
		const l = mindmapLayout(it)
		return { ...it, w: l.w, h: l.h }
	}

	test('stats().mindmaps in org: the main branches in a row below the root, A1 below A, cards with name and role; in tree all right of the root', () => {
		setup([laid('org', 'Chefin\nCEO')])
		const s = stat()
		assert.equal(s.layout, 'org')
		const r = box(R)
		for (const k of [A, B, L]) {
			assert.ok(box(k).y >= r.y + r.h + 40 - 1e-9 && box(k).y === box(A).y && box(k).side === 1, k + ' in the row below the root')
		}
		assert.ok(box(A).x < box(B).x && box(B).x < box(L).x, 'in order')
		assert.ok(box(A1).y > box(A).y + box(A).h)
		assert.deepEqual([r.name, r.role, box(A).name, box(A).role, box(A).shape, r.shape], ['Chefin', 'CEO', 'Alpha', '', 'roundRect', 'roundRect'])
		h.model.apply({ upserts: [laid('tree')] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		assert.equal(stat().layout, 'tree')
		for (const k of [A, B, L]) assert.ok(box(k).x > box(R).x + box(R).w && box(k).side === 1, k + ' right of the root')
		assert.deepEqual([box(A).name, box(A).role, box(A).shape], ['Alpha', '', 'roundRect'], 'job 266: tree cards too')
	})

	test('the node in org: two texts per card (the name bold), right-angled lines in the parent\'s colour, the colour band; in tree right-angled too', () => {
		class Node {
			constructor(a = {}) { this.attrs = { ...a } }
			setAttrs(a) { Object.assign(this.attrs, a) }
			visible(v) { this.attrs.visible = v }
			transformsEnabled() {}
			add() {}
			moveToTop() {}
			destroy() {}
		}
		const ctx = { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {}, Line: class extends Node {}, shadows: true }
		const it = laid('org', 'Chefin\nCEO')
		const e = mindmapSpec.build(ctx, it, { x: 100, y: 100, w: it.w, h: it.h, r: 0 }, 0, false)
		assert.deepEqual([...e.parts.texts.keys()].sort(), [R, R + ':r', A, B, A1, L].sort())
		assert.deepEqual([e.parts.texts.get(R).attrs.text, e.parts.texts.get(R).attrs.fontStyle], ['Chefin', 'bold'])
		assert.deepEqual([e.parts.texts.get(R + ':r').attrs.text, e.parts.texts.get(R + ':r').attrs.fontStyle], ['CEO', 'normal'])
		assert.ok(e.parts.texts.get(R + ':r').attrs.y > e.parts.texts.get(R).attrs.y, 'the role below the name')
		mindmapSpec.setTextHidden(e, R)
		assert.deepEqual([e.parts.texts.get(R).attrs.visible, e.parts.texts.get(R + ':r').attrs.visible, e.parts.texts.get(A).attrs.visible], [false, false, true])
		const paint = (layout) => {
			const calls = []
			const c = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])), set: (t, k, v) => { calls.push(['set:' + String(k), v]); t[k] = v; return true } })
			e.layout = mindmapLayout(laid(layout, 'Chefin\nCEO'))
			e.parts.lines.attrs.sceneFunc(c)
			return calls
		}
		const org = paint('org')
		assert.equal(org.filter((x) => x[0] === 'bezierCurveTo').length, 0, 'no curves')
		assert.equal(org.filter((x) => x[0] === 'lineTo').length >= 3 * 4, true, 'three corners per branch')
		assert.equal(org.filter((x) => x[0] === 'fillRect').length, 5, 'a band per card')
		assert.equal(org.filter((x) => x[0] === 'clip').length, 5)
		const strokes = org.filter((x) => x[0] === 'set:strokeStyle').map((x) => x[1])
		assert.equal(strokes[0], '#3d4044', 'job 266: every line dark')
		assert.ok(strokes.every((x) => x === '#3d4044'), 'card borders too')
		const tree = paint('tree')
		assert.equal(tree.filter((x) => x[0] === 'bezierCurveTo').length, 0)
		assert.equal(tree.filter((x) => x[0] === 'fillRect').length, 5, 'job 266: a band per card in tree')
		assert.ok(tree.filter((x) => x[0] === 'fillRect').every((x) => x[3] === 7), 'on the left, 6 wide (+ half the border)')
	})

	test('the "+" in org: the child\'s below the card, the sibling\'s above its top right corner; at the root one below; tree: one at the root', () => {
		setup([laid('org')])
		click(...mid(A))
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child', 'mm-sibling'])
		const a = box(A)
		const child = h.scene.handles().find((x) => x.name === 'mm-child')
		assert.ok(Math.abs(child.x - (a.x + a.w / 2)) < 1e-9 && child.y > a.y + a.h + 2 * 7 && child.y < box(A1).y, 'below A, between its dot and A1')
		const sib = h.scene.handles().find((x) => x.name === 'mm-sibling')
		assert.ok(Math.abs(sib.x - (a.x + a.w + 10)) < 1e-9 && Math.abs(sib.y - (a.y - 10)) < 1e-9, 'in the gap above the top right corner of A')
		click(child.x, child.y)
		assert.deepEqual(h.intents('mmAdd').at(-1), { type: 'mmAdd', id: M, key: A, as: 'child', open: true })
		click(...mid(R))
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child-r'])
		const rc = h.scene.handles().find((x) => x.name === 'mm-child-r')
		assert.ok(rc.y > box(R).y + box(R).h && rc.y < box(A).y, 'below the root')
		h.model.apply({ upserts: [laid('tree')] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		h.frame()
		assert.deepEqual(handleNames().filter((n) => n.startsWith('mm-')), ['mm-child-r'])
	})

	test('round 1: in org no "+" lies on a card or a dot (a leaf with a card right beside it, at 50 %, 100 %, 200 %); a click on the sibling\'s adds a sibling', () => {
		const T = 'n50000000'
		const U = 'n60000000'
		const it = laid('org')
		it.data.nodes.b5 = { [T]: { o: 'i0', p: B } }
		it.data.nodes.b6 = { [U]: { o: 'i1', p: B } }
		it.data.texts.b5 = { [T]: 'Tim' }
		it.data.texts.b6 = { [U]: 'Ute' }
		const l = mindmapLayout(it)
		setup([{ ...it, w: l.w, h: l.h }])
		const onNode = (x, y) => stat().nodes.some((n) => n.x !== null && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) ||
			stat().nodes.some((n) => n.dot && Math.hypot(x - n.dot.x, y - n.dot.y) <= 7)
		for (const scale of [0.5, 1, 2]) {
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.frame()
			for (const key of [T, U, A1, A, B, L]) {
				const [wx, wy] = mid(key)
				click(wx * scale, wy * scale)
				assert.equal(stat().focus, key, `focus ${key} at ${scale}`)
				const plus = h.scene.handles().filter((x) => x.name.startsWith('mm-'))
				assert.deepEqual(plus.map((x) => x.name), ['mm-child', 'mm-sibling'])
				// handles are container points: world = point / scale (camera at the origin)
				for (const x of plus) assert.ok(!onNode(x.x / scale, x.y / scale), `${x.name} of ${key} at ${scale} lies on no card or dot`)
			}
			const [tx, ty] = mid(T)
			click(tx * scale, ty * scale)
			const sib = h.scene.handles().find((x) => x.name === 'mm-sibling')
			const n = h.intents('mmAdd').length
			click(sib.x, sib.y)
			assert.deepEqual(h.intents('mmAdd').slice(n), [{ type: 'mmAdd', id: M, key: T, as: 'sibling', open: true }], 'Tim\'s sibling at ' + scale)
		}
	})

	test('a drag in org: no preview, a release without a target asks nothing; the right quarter of a card is after it; ↓ focuses the first child', () => {
		setup([laid('org')])
		click(...mid(A))
		const b0 = box(B)
		const [bx, by] = mid(B)
		const before = callsOf('setTablePreview').length
		h.pointer('pointerdown', bx, by)
		h.pointer('pointermove', bx + 10, by + 10)
		h.pointer('pointermove', bx + 400, by + 300)
		h.frame()
		assert.equal(h.scene.stats().nodeDrag.target, null)
		assert.deepEqual(box(B), b0, 'the map stays as it is drawn')
		assert.ok(callsOf('setTablePreview').slice(before).every((c) => c[1] === null), 'no preview patch')
		assert.ok(callsOf('setNodeDragPreview').at(-1)[0].ghost, 'the ghost follows')
		h.pointer('pointerup', bx + 400, by + 300)
		assert.deepEqual(h.intents('mmMove'), [], 'nothing placed freely')
		const a = box(A)
		h.pointer('pointerdown', bx, by)
		h.pointer('pointermove', bx + 10, by + 10)
		h.pointer('pointermove', a.x + a.w - 3, a.y + a.h / 2)
		h.frame()
		assert.deepEqual(h.scene.stats().nodeDrag.target, { key: A, where: 'after', side: null })
		h.pointer('pointerup', a.x + a.w - 3, a.y + a.h / 2)
		assert.deepEqual(h.intents('mmMove').at(-1), { type: 'mmMove', id: M, key: B, target: { key: A, where: 'after', side: null } })
		click(...mid(R))
		h.focusCanvas()
		h.key('ArrowDown')
		assert.equal(stat().focus, A)
		h.key('ArrowRight')
		assert.equal(stat().focus, B)
		h.key('ArrowUp')
		assert.equal(stat().focus, R)
	})

	test('round 6: a finger on a card with children in org (the map selected, its dots drawn, at 50 % and 82 %) focuses the card and folds nothing; the dot itself folds', () => {
		setup([laid('org')])
		const touch = { pointerType: 'touch', pointerId: 7 }
		for (const scale of [0.5, 0.82]) {
			h.scene.setCamera({ x: 0, y: 0, scale })
			h.frame()
			const tap = (x, y, props) => click(x * scale, y * scale, props)
			const a = box(A)
			assert.ok(a.dot, 'A has children')
			// the case: the finger's tolerance (7 + 12 / scale) reaches from the dot into the card, at 50 % to its middle
			const reach = (x, y) => Math.hypot(x - a.dot.x, y - a.dot.y) <= 7 + 12 / scale
			assert.ok(reach(a.x + a.w / 2, a.y + a.h - 1) && (scale > 0.5 || reach(a.x + a.w / 2, a.y + a.h / 2)), 'the case at ' + scale)
			for (const [x, y, where] of [[a.x + a.w / 2, a.y + a.h / 2, 'the middle'], [a.x + a.w / 2, a.y + a.h - 1, 'the bottom edge']]) {
				tap(...mid(B))
				assert.deepEqual([h.scene.getSelection(), stat().focus], [[M], B], 'selected by mouse, B focused')
				tap(x, y, touch)
				assert.equal(h.intents('mmFold').length, 0, `${where} of A at ${scale}: no fold`)
				assert.equal(stat().focus, A, `${where} of A at ${scale}: the focus`)
			}
		}
		const d = box(A).dot
		click(d.x * 0.82, d.y * 0.82, touch)
		assert.deepEqual(h.intents('mmFold'), [{ type: 'mmFold', id: M, key: A }], 'the dot folds')
	})

	test('round 6: the drop mark of a drag in org stands on the left or right edge of the card; in tree on its top or bottom edge', () => {
		setup([laid('org')])
		click(...mid(A))
		const [bx, by] = mid(B)
		const drag = (x, y) => {
			h.pointer('pointerdown', bx, by)
			h.pointer('pointermove', bx + 10, by + 10)
			h.pointer('pointermove', x, y)
			h.frame()
			const t = callsOf('setNodeDragPreview').at(-1)[0].target
			h.pointer('pointerup', x, y)
			return t
		}
		const a = box(A)
		const after = drag(a.x + a.w - 3, a.y + a.h / 2)
		assert.deepEqual([after.where, after.beside], ['after', true])
		assert.deepEqual(dropMark(after), { x: a.x + a.w + 1, y: a.y, width: 1, height: a.h, bar: true }, 'a bar on the right edge')
		const before = drag(a.x + 3, a.y + a.h / 2)
		assert.deepEqual([before.where, before.beside], ['before', true])
		assert.deepEqual(dropMark(before), { x: a.x - 2, y: a.y, width: 1, height: a.h, bar: true }, 'a bar on the left edge')
		const child = drag(a.x + a.w / 2, a.y + a.h / 2)
		assert.deepEqual(dropMark(child), { x: a.x - 3, y: a.y - 3, width: a.w + 6, height: a.h + 6, bar: false }, 'the outline')
		h.model.apply({ upserts: [laid('tree')] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		h.frame()
		const [mx, my] = mid(B)
		const t = box(A1)
		h.pointer('pointerdown', mx, my)
		h.pointer('pointermove', mx + 10, my + 10)
		h.pointer('pointermove', t.x + t.w / 2, t.y + t.h - 2)
		h.frame()
		const below = callsOf('setNodeDragPreview').at(-1)[0].target
		h.pointer('pointerup', t.x + t.w / 2, t.y + t.h - 2)
		assert.deepEqual([below.where, below.beside], ['after', false])
		assert.deepEqual(dropMark(below), { x: t.x, y: t.y + t.h + 1, width: t.w, height: 1, bar: true }, 'tree: a bar on the bottom edge')
	})

	test('round 2: the editor of an empty card in org is large enough for the whole placeholder; typing gives the card its text size', () => {
		const ph = 'Name (Umschalt+Enter: Rolle)'
		const it = laid('org')
		delete it.data.texts.b2
		const l = mindmapLayout(it)
		setup([{ ...it, w: l.w, h: l.h }], { scene: { cardPlaceholder: ph } })
		const empty = box(B)
		assert.ok(Math.abs(empty.h - (6 + 16 * 1.2 + 16)) < 1e-9, 'stored: one line')
		h.scene.openTextEditor(M, { cell: B })
		h.frame()
		assert.equal(editor().placeholder, ph)
		const need = estimateNodeSize(ph, 200, 16, true)
		const open = box(B)
		assert.ok(open.h >= 6 + need.h + 16 - 1e-9 && open.w >= need.w + 24 - 1e-9, 'the card is laid out for the placeholder')
		const px = (k) => parseFloat(editor().style.getPropertyValue(k))
		assert.ok(px('height') >= need.h + 16 - 1e-9, 'the editor holds every line of it: ' + px('height'))
		// the placeholder is drawn normal, narrower than bold: at the width of the bold lines it needs no more lines
		assert.ok(px('width') - 2 * 8 >= need.w - 1e-9, 'and as wide as its lines: ' + px('width'))
		editor().value = 'Ina'
		dispatch(editor(), 'input')
		h.frame()
		assert.ok(Math.abs(box(B).h - empty.h) < 1e-9, 'typed: one line again')
		editor().value = ''
		dispatch(editor(), 'input')
		h.frame()
		assert.ok(Math.abs(box(B).h - open.h) < 1e-9, 'empty again: the placeholder\'s size')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		h.frame()
		assert.ok(Math.abs(box(B).h - empty.h) < 1e-9, 'closed: the stored card')
	})

	test('the editor of a card in org has the placeholder of the session; elsewhere none; it sits below the band', () => {
		setup([laid('org')], { scene: { cardPlaceholder: 'Name (Shift+Enter: role)' } })
		h.scene.openTextEditor(M, { cell: B })
		h.frame()
		assert.equal(editor().placeholder, 'Name (Shift+Enter: role)')
		assert.match(editor().style.getPropertyValue('transform'), new RegExp(`translate\\([0-9.]+px, ${box(B).y + 6}px\\)`), 'below the band')
		assert.equal(editor().style.getPropertyValue('font-weight'), 'normal')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		h.model.apply({ upserts: [laid('tree')] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		h.frame()
		h.scene.openTextEditor(M, { cell: B })
		assert.equal(editor().placeholder, 'Name (Shift+Enter: role)', 'job 266: tree cards too')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		h.scene.openTextEditor(M, { cell: R })
		assert.equal(editor().style.getPropertyValue('font-weight'), 'normal', 'job 266: the root of a tree is a card')
		dispatch(editor(), 'keydown', { key: 'Escape' })
		h.model.apply({ upserts: [laid('both')] })
		h.scene.update({ added: [], removed: [], updated: new Map([[M, new Set(['style'])]]), geometry: new Set(), reordered: false })
		h.frame()
		h.scene.openTextEditor(M, { cell: B })
		assert.ok(!editor().placeholder, 'a mind map: none')
	})
})
