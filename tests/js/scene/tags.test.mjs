/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 191, AK4: the tag row of a note.
 * - pure (nodes/tags.js): the labels in the note's order with "+n", unknown
 *   ids not drawn, "…" for a long name, strokes at LOD 1, nothing at LOD 2,
 *   the band the text keeps free, the "+n" hit in the rotated axes
 * - the REAL KonvaRenderer on the fake DOM (the scaffold of
 *   reactionsRender.test.mjs): stats().tags, the text area of a note with
 *   tags is smaller, setTags renews only the notes, renderImage paints the
 *   labels, the tag filter fades (stats().tagFilter, opacity, LOD 2 colour)
 * - the scene on the fake DOM (sceneHarness.mjs): a tap on "+n" gives
 *   tagList in every mode (no vote, no selection), a drag from it moves the
 *   note, the note editor ends above the row
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { tagMap } from '../../../src/model/tags.js'
import { coarseOrder, planCoarse } from '../../../src/scene/nodes/coarse.js'
import { fitTagName, moreWidth, paintTagRow, tagMoreAt, tagReserve, tagRowPlan, tagStat, tagTextWidth } from '../../../src/scene/nodes/tags.js'
import {
	LOD_TEXT_SCALE, NOTE_EAR, STICKY_PADDING, TAG_FADE_OPACITY, TAG_GAP, TAG_H, TAG_INSET, TAG_LABEL_MAX_W, TAG_PAD_X, TAG_RESERVE,
	TAG_STROKE_H, contrastTextOn,
} from '../../../src/model/tokens.js'
import { dispatch, installDom } from './fakeDom.mjs'
import { callsOf, setupScene } from './sceneHarness.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const S = '01JA0000000000000000000003'
const U = (n) => '01JT' + String(n).padStart(22, '0')
const TAGS = [
	{ id: U(1), name: 'Kosten', color: '#c43e45' },
	{ id: U(2), name: 'Zeit', color: '#7e6f01' },
	{ id: U(3), name: 'Risiko', color: '#5165d3' },
]
const EIGHT = Array.from({ length: 8 }, (_, i) => ({ id: U(10 + i), name: 'Tag ' + (i + 1), color: '#307d37' }))
const note = (id, o = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: 'Hello' }, style: { fill: '#a2d9fe' }, ...o })
const tagged = (id, tags, o = {}) => note(id, { ...o, data: { text: 'Hello', tags } })

describe('nodes/tags.js (pure)', () => {
	test('labels in the note\'s order, in the tag colour with contrastTextOn; unknown ids are not drawn', () => {
		const byId = tagMap(TAGS)
		const plan = tagRowPlan(tagged(A, [U(3), U(99), U(1)]), byId, 200, 200)
		assert.deepEqual(plan.ids, [U(3), U(1)], 'U(99) names no tag')
		assert.deepEqual(plan.labels.map((l) => [l.id, l.text, l.fill, l.color]), [
			[U(3), 'Risiko', '#5165d3', contrastTextOn('#5165d3')],
			[U(1), 'Kosten', '#c43e45', contrastTextOn('#c43e45')],
		])
		assert.equal(plan.labels[0].x, TAG_INSET)
		assert.equal(plan.labels[0].w, 2 * TAG_PAD_X + tagTextWidth('Risiko'))
		assert.equal(plan.labels[1].x, TAG_INSET + plan.labels[0].w + TAG_GAP)
		assert.equal(plan.y, 200 - TAG_INSET - TAG_H, 'inside, at the bottom edge')
		assert.equal(plan.more, null)
		assert.deepEqual(tagStat(A, plan, 0), { id: A, shown: [U(3), U(1)], more: 0 })
		assert.equal(tagRowPlan(tagged(A, [U(99)]), byId, 200, 200), null, 'no valid tag: no row')
		assert.equal(tagRowPlan(note(A), byId, 200, 200), null)
		assert.equal(tagRowPlan({ ...tagged(A, [U(1)]), t: 'shape' }, byId, 200, 200), null, 'notes only')
	})

	test('what does not fit becomes "+n"; a long name ends in "…"', () => {
		const byId = tagMap(EIGHT)
		const plan = tagRowPlan(tagged(A, EIGHT.map((x) => x.id)), byId, 200, 200)
		assert.ok(plan.labels.length >= 1 && plan.labels.length < 8, String(plan.labels.length))
		assert.equal(plan.more.n, 8 - plan.labels.length)
		assert.deepEqual(plan.labels.map((l) => l.id), EIGHT.slice(0, plan.labels.length).map((x) => x.id), 'in order')
		const last = plan.labels.at(-1)
		assert.equal(plan.more.x, last.x + last.w + TAG_GAP)
		assert.equal(plan.more.w, moreWidth(plan.more.n))
		assert.ok(plan.more.x + plan.more.w <= 200 - TAG_INSET, 'inside the note')
		assert.deepEqual(tagStat(A, plan, 0), { id: A, shown: plan.labels.map((l) => l.id), more: plan.more.n })
		assert.deepEqual(tagStat(A, plan, 1), { id: A, shown: EIGHT.map((x) => x.id), more: 0 }, 'LOD 1: a stroke per tag')
		const long = tagMap([{ id: U(1), name: 'A very long tag name for x', color: '#c43e45' }])
		const lp = tagRowPlan(tagged(A, [U(1)]), long, 400, 200)
		assert.equal(lp.labels[0].w, TAG_LABEL_MAX_W)
		assert.match(lp.labels[0].text, /…$/)
		assert.ok(tagTextWidth(lp.labels[0].text) <= TAG_LABEL_MAX_W - 2 * TAG_PAD_X)
		assert.equal(fitTagName('Kosten', 1000), 'Kosten')
		assert.equal(fitTagName('Kosten', 1), '')
		const tiny = tagRowPlan(tagged(A, [U(1), U(2)]), tagMap(TAGS), 40, 40)
		assert.deepEqual([tiny.labels.length, tiny.more.n], [0, 2], 'a tiny note: only "+n"')
	})

	test('paintTagRow: labels and "+n" at LOD 0, strokes at LOD 1, nothing at LOD 2', () => {
		const calls = []
		const ctx = new Proxy({}, {
			get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a])),
			set: (t, k, v) => { t[k] = v; return true },
		})
		const plan = tagRowPlan(tagged(A, EIGHT.map((x) => x.id)), tagMap(EIGHT), 200, 200)
		assert.equal(paintTagRow(ctx, plan, 0, 200, 200), plan.labels.length + 1)
		const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
		assert.deepEqual(texts, [...plan.labels.map((l) => l.text), '+' + plan.more.n])
		calls.length = 0
		assert.equal(paintTagRow(ctx, plan, 1, 200, 200), 8)
		const rects = calls.filter((c) => c[0] === 'fillRect')
		assert.equal(rects.length, 8)
		assert.deepEqual(rects.map((r) => [r[2], r[4]]), Array(8).fill([200 - TAG_INSET - TAG_STROKE_H, TAG_STROKE_H]))
		assert.equal(calls.filter((c) => c[0] === 'fillText').length, 0, 'no text')
		calls.length = 0
		assert.equal(paintTagRow(ctx, plan, 2, 200, 200), 0)
		assert.deepEqual(calls, [])
	})

	test('tagReserve: the band of a note with a valid tag; tagMoreAt: an exact hit on "+n", rotated with the note, LOD 0 only', () => {
		const byId = tagMap(EIGHT)
		assert.equal(tagReserve(tagged(A, [U(10)]), byId), TAG_RESERVE)
		assert.equal(tagReserve(tagged(A, [U(99)]), byId), 0)
		assert.equal(tagReserve(note(A), byId), 0)
		const m = new SceneModel()
		m.load([tagged(A, EIGHT.map((x) => x.id), { x: 100, y: 100 })])
		const plan = tagRowPlan(m.get(A), byId, 200, 200)
		const cx = 100 + plan.more.x + plan.more.w / 2
		const cy = 100 + plan.y + TAG_H / 2
		assert.deepEqual(tagMoreAt(m, { x: cx, y: cy }, byId, 1)?.id, A)
		assert.equal(tagMoreAt(m, { x: cx, y: cy }, byId, 1).n, plan.more.n)
		assert.equal(tagMoreAt(m, { x: 100 + plan.labels[0].x + 2, y: cy }, byId, 1), null, 'a label is no hit')
		assert.equal(tagMoreAt(m, { x: cx, y: cy }, byId, LOD_TEXT_SCALE - 0.01), null, 'below LOD_TEXT_SCALE')
		assert.equal(tagMoreAt(m, { x: cx, y: cy }, new Map(), 1), null)
		const r = new SceneModel()
		r.load([tagged(A, EIGHT.map((x) => x.id), { x: 100, y: 100, r: 180 })])
		assert.equal(tagMoreAt(r, { x: 300 - plan.more.x - plan.more.w / 2, y: 300 - plan.y - TAG_H / 2 }, byId, 1)?.id, A, 'turned 180°')
		// covered by another note on top
		const c = new SceneModel()
		c.load([tagged(A, EIGHT.map((x) => x.id), { x: 100, y: 100 }), note(B, { x: cx - 5, y: cy - 5, w: 40, h: 40, z: 'a2' })])
		assert.equal(tagMoreAt(c, { x: cx, y: cy }, byId, 1), null, 'an item above covers the chip')
	})

	test('planCoarse fades the boxes of the faded notes (LOD 2)', () => {
		const m = new SceneModel()
		m.load([tagged(A, [U(1)]), note(B, { x: 300 }), { id: S, t: 'shape', x: 600, y: 0, w: 100, h: 100, r: 0, z: 'a3', parent: null, data: { kind: 'rect' }, style: { fill: '#a2d9fe' } }])
		const hits = m.query(-1e9, -1e9, 1e9, 1e9)
		const plan = planCoarse(m, hits, () => false, coarseOrder(m), (id) => id === B)
		assert.deepEqual([...plan.groups.keys()].sort(), ['#a2d9fe', `rgba(162,217,254,${TAG_FADE_OPACITY})`].sort())
		assert.deepEqual(plan.groups.get(`rgba(162,217,254,${TAG_FADE_OPACITY})`), [300, 0, 200, 200])
	})
})

// ---- the real renderer on the fake DOM -----------------------------------------------

/** every fillText of every canvas */
const drawn = []
/** (job 227) every fillStyle and strokeStyle set on any canvas */
const styles = []

/** @return {object} a 2D context that records fillText and draws nothing */
function recordingContext() {
	return new Proxy({}, {
		get(t, name) {
			if (name in t) return t[name]
			if (name === 'fillText') return (s) => drawn.push(String(s))
			if (name === 'measureText') return (s) => ({ width: String(s).length * 5 })
			if (name === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)) })
			if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
			if (typeof name === 'string' && name.startsWith('create')) return () => ({ addColorStop() {} })
			return () => {}
		},
		set(t, name, v) {
			if (name === 'fillStyle' || name === 'strokeStyle') styles.push(String(v).toLowerCase())
			t[name] = v
			return true
		},
	})
}

describe('the real renderer', () => {
	let dom = null
	let scene = null
	let model = null
	const browser = Konva.isBrowser
	afterEach(() => {
		scene?.destroy()
		scene = null
		dom?.restore()
		dom = null
		Konva.isBrowser = browser
	})

	function mount(items, opts = {}) {
		dom = installDom()
		Konva.isBrowser = true
		globalThis.window.document = dom.doc
		dom.doc.addEventListener = () => {}
		dom.doc.removeEventListener = () => {}
		const create = dom.doc.createElement.bind(dom.doc)
		dom.doc.createElement = (tag) => {
			const el = create(tag)
			el.removeChild = (c) => {
				c.remove()
				return c
			}
			if (String(tag).toLowerCase() === 'canvas') {
				const ctx = recordingContext()
				el.getContext = () => ctx
			}
			return el
		}
		const container = dom.doc.createElement('div')
		container.clientWidth = 1000
		container.clientHeight = 800
		dom.doc.body.appendChild(container)
		model = new SceneModel()
		model.load(items)
		scene = new SceneManager(container, model, opts)
		scene.mount()
		scene.setCamera({ x: 0, y: 0, scale: 1 })
		frames()
		return scene
	}
	const frames = (n = 3) => {
		for (let i = 0; i < n; i++) dom.frame()
	}

	test('stats().tags: the rows in view with "+n"; strokes at LOD 1; none at LOD 2; setTags renews them', () => {
		mount([tagged(A, [U(2), U(1)], { x: 100, y: 100 }), tagged(B, EIGHT.map((x) => x.id), { x: 400, y: 100, z: 'a2' }), note(S, { x: 700, y: 100, z: 'a3' })])
		assert.deepEqual(scene.stats().tags, [], 'without the tag list nothing is drawn')
		scene.setTags([...TAGS, ...EIGHT])
		frames()
		const st = scene.stats().tags
		assert.deepEqual(st.map((x) => x.id), [A, B])
		assert.deepEqual(st[0], { id: A, shown: [U(2), U(1)], more: 0 })
		assert.ok(st[1].more > 0 && st[1].shown.length + st[1].more === 8, JSON.stringify(st[1]))
		scene.setCamera({ x: 0, y: 0, scale: 0.2 })
		frames()
		assert.deepEqual(scene.stats().tags.find((x) => x.id === B), { id: B, shown: EIGHT.map((x) => x.id), more: 0 }, 'LOD 1: strokes')
		scene.setCamera({ x: 0, y: 0, scale: 0.05 })
		frames()
		assert.deepEqual(scene.stats().tags, [], 'LOD 2: nothing')
		scene.setCamera({ x: 0, y: 0, scale: 1 })
		frames()
		scene.setTags(TAGS.slice(1))
		frames()
		assert.deepEqual(scene.stats().tags, [{ id: A, shown: [U(2)], more: 0 }], 'a deleted tag disappears')
	})

	test('the text area of a note with tags ends TAG_RESERVE above its bottom edge', () => {
		mount([tagged(A, [U(1)], { x: 100, y: 100 }), note(B, { x: 400, y: 100, z: 'a2' })])
		const r = scene.renderer
		// job 259: without tags the text ends NOTE_EAR above the bottom, clear of the dog ear
		assert.equal(r.nodeTextLayout(A).height, 200 - STICKY_PADDING - NOTE_EAR, 'no tag list yet: the whole note less the dog ear')
		scene.setTags(TAGS)
		frames()
		assert.equal(r.nodeTextLayout(A).height, 200 - 2 * STICKY_PADDING - TAG_RESERVE)
		assert.equal(r.nodeTextLayout(B).height, 200 - STICKY_PADDING - NOTE_EAR, 'a note without tags as before')
	})

	test('job 227 AK3: the real renderer draws an old note fill and an old tag colour as their new tones; the model keeps the stored values', () => {
		mount([tagged(A, [U(1)], { x: 100, y: 100, style: { fill: '#a8d8f8' } })])
		styles.length = 0
		scene.setTags([{ id: U(1), name: 'Kosten', color: '#e53935' }])
		frames()
		assert.ok(styles.includes('#a2d9fe'), 'the note in Light blue: ' + [...new Set(styles)].join(' '))
		assert.ok(styles.includes('#c43e45'), 'the tag in Coral: ' + [...new Set(styles)].join(' '))
		assert.ok(!styles.includes('#a8d8f8') && !styles.includes('#e53935'), 'no old colour is drawn')
		assert.equal(model.get(A).style.fill, '#a8d8f8', 'the stored fill stays')
	})

	test('a change of the tag list alone redraws the static layer once and no other type', () => {
		mount([tagged(A, [U(1)], { x: 100, y: 100 })])
		const before = scene.stats().draws.static
		scene.setTags(TAGS)
		frames()
		assert.equal(scene.stats().draws.static, before + 1)
	})

	test('renderImage paints the labels like LOD 0, and the filter changes no image', async () => {
		mount([tagged(A, [U(1), U(3)], { x: 100, y: 100 })])
		scene.setTags(TAGS)
		scene.setTagFilter([U(2)])
		frames()
		drawn.length = 0
		await scene.renderer.renderImage({ ids: [A], frame: { x: 80, y: 80, w: 240, h: 240 }, scale: 1, width: 240, height: 240, plan: { reactions: [], badges: null } })
		assert.ok(drawn.includes('Kosten') && drawn.includes('Risiko'), JSON.stringify(drawn))
	})

	test('the tag filter: stats().tagFilter {chosen, faded}, opacity of the faded notes only, the filter drops a deleted tag', () => {
		const items = [tagged(A, [U(1)], { x: 100, y: 100 }), tagged(B, [U(2)], { x: 400, y: 100, z: 'a2' }), note(S, { x: 700, y: 100, z: 'a3' })]
		mount(items)
		scene.setTags(TAGS)
		assert.equal(scene.stats().tagFilter, null)
		scene.setTagFilter([U(1)])
		frames()
		assert.deepEqual(scene.stats().tagFilter, { chosen: [U(1)], faded: [B, S].sort() })
		const opacity = (id) => scene.renderer.stage.findOne((n) => n.getAttr('kid') === id).opacity()
		assert.deepEqual([opacity(A), opacity(B), opacity(S)], [1, TAG_FADE_OPACITY, TAG_FADE_OPACITY])
		scene.setTagFilter([U(1), U(2)])
		frames()
		assert.deepEqual(scene.stats().tagFilter.faded, [S])
		assert.equal(opacity(B), 1)
		scene.setTags([TAGS[0]])
		assert.deepEqual(scene.stats().tagFilter, { chosen: [U(1)], faded: [B, S].sort() }, 'the deleted tag left the filter')
		scene.setTagFilter(null)
		frames()
		assert.equal(scene.stats().tagFilter, null)
		assert.equal(opacity(B), 1)
	})
})

// ---- the scene (fake DOM, recording renderer) ----------------------------------------

describe('the scene: "+n"', () => {
	let h = null
	afterEach(() => {
		h?.restore()
		h = null
	})
	const plan = tagRowPlan(tagged(A, EIGHT.map((x) => x.id)), tagMap(EIGHT), 200, 200)
	const MX = 100 + plan.more.x + plan.more.w / 2
	const MY = 100 + plan.y + TAG_H / 2
	const tap = (x, y, type = 'mouse') => {
		h.pointer('pointerdown', x, y, { pointerType: type, pointerId: 1 })
		h.pointer('pointerup', x, y, { pointerType: type, pointerId: 1 })
	}
	function setup(mode = 'edit') {
		h = setupScene([tagged(A, EIGHT.map((x) => x.id), { x: 100, y: 100 })], { scene: { mode } })
		h.scene.setTags(EIGHT)
		h.frame()
		h.log.length = 0
		return h
	}

	for (const mode of ['edit', 'vote', 'view']) {
		for (const type of ['mouse', 'touch']) {
			test(`${mode}, ${type}: a tap on "+n" gives tagList, no vote, no selection`, () => {
				setup(mode)
				if (mode === 'vote') {
					h.scene.setVoteState({ votable: () => true, scope: null, badges: new Map(), markVotable: false, color: '#c62828' })
					h.frame()
					h.log.length = 0
				}
				tap(MX, MY, type)
				const intents = h.intents()
				assert.deepEqual(intents.map((i) => [i.type, i.id]), [['tagList', A]])
				const rect = intents[0].rect
				assert.ok(Math.abs(rect.x - (100 + plan.more.x)) < 1e-9 && Math.abs(rect.w - plan.more.w) < 1e-9 && Math.abs(rect.h - TAG_H) < 1e-9, JSON.stringify(rect))
				assert.deepEqual(h.log.filter((e) => e[0] === 'onSelection'), [])
				assert.deepEqual(h.scene.getSelection(), [])
			})
		}
	}

	test('a drag that starts on "+n" moves the note as before; a double click opens no editor', () => {
		setup('edit')
		h.pointer('pointerdown', MX, MY, { pointerType: 'mouse', pointerId: 1 })
		h.pointer('pointermove', MX + 40, MY, { pointerType: 'mouse', pointerId: 1, buttons: 1 })
		h.pointer('pointermove', MX + 80, MY, { pointerType: 'mouse', pointerId: 1, buttons: 1 })
		h.pointer('pointerup', MX + 80, MY, { pointerType: 'mouse', pointerId: 1 })
		const move = h.intents().find((i) => i.type === 'move')
		assert.ok(move, JSON.stringify(h.intents()))
		assert.deepEqual(move.ids, [A])
		assert.ok(!h.intents().some((i) => i.type === 'tagList'))
		h.log.length = 0
		const at = { x: MX + 80, y: MY }
		tap(at.x, at.y)
		tap(at.x, at.y)
		dispatch(h.container, 'dblclick', { clientX: at.x, clientY: at.y, button: 0 })
		h.frame()
		assert.deepEqual(h.intents().map((i) => i.type), ['tagList', 'tagList'], 'two taps, two lists')
		assert.equal(h.scene.stats().editing, null, 'no editor')
	})

	test('without the tag list the chip is no hit; the note editor ends above the tag row', () => {
		h = setupScene([tagged(A, EIGHT.map((x) => x.id), { x: 100, y: 100 })])
		tap(MX, MY)
		assert.ok(!h.intents().some((i) => i.type === 'tagList'), 'no tags known: a click on the note')
		h.scene.setTags(EIGHT)
		h.scene.openTextEditor(A)
		h.frame()
		const el = h.dom.doc.activeElement
		assert.equal(el?.tagName, 'TEXTAREA', 'the editor is open')
		assert.equal(el.style.getPropertyValue('height'), (200 - TAG_RESERVE) + 'px')
		h.scene.setTags([])
		assert.equal(el.style.getPropertyValue('height'), (200 - (NOTE_EAR - STICKY_PADDING)) + 'px', 'without tags the whole note less the dog ear (job 259)')
		assert.ok(callsOf('setTags').length > 0)
	})
})
