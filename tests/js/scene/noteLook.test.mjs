/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 259: notes in the look of redesign round 3 (N4 with the dog
 * ear of N2c), with the real Konva (a fake 2D canvas, as frameTab.test.mjs)
 * and the sticky builder drawn into a VectorContext like
 * KonvaRenderer.renderVector (the shadows: shade.test.mjs):
 * - AK2 the edge: the strong tone of the note's colour at 18 %, grey on
 *   white, none on black, 1 unit, also at LOD 1, renewed by a colour change
 * - AK3 the dog ear: the outline cut from (w, h − e) to (w − e, h), the
 *   flap painted shadow, fill, tone (22 %); a resize moves both
 * - AK4 the text area (18 in, ending e above the bottom without tags, the
 *   tag reserve with) and line height 1.25; other items keep 1.2
 * - AK5 the note editor: line height 1.25, padding 18; a text item's 1.2
 * - AK6 the tag row ends left of the ear (labels, "+n", LOD 1 strokes)
 * - AK7 the SVG of a note: outline with the cut, the flap, the edge
 * - AK8 old and odd notes build and update without errors
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
	LINE_HEIGHT, NOTE_EAR, NOTE_LINE_HEIGHT, STICKY_PADDING, TAG_GAP, TAG_INSET, TAG_RESERVE, noteEar, noteStrongTone, PALETTE, withAlpha,
} from '../../../src/model/tokens.js'
import { noteTextLayout } from '../../../src/model/text.js'
import { noteTextReserve, paintTagRow, tagRoom, tagRowPlan } from '../../../src/scene/nodes/tags.js'
import { notePath, paintEar } from '../../../src/scene/nodes/sticky.js'
import { note as sceneNote, setupScene, textItem } from './sceneHarness.mjs'

const ctx2d = {
	font: '10px sans-serif',
	fontKerning: 'auto',
	save() {},
	restore() {},
	clearRect() {},
	fillRect() {},
	scale() {},
	setTransform() {},
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
	measureText(text) {
		const fs = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
		return { width: Array.from(text).length * 0.5 * fs, fontBoundingBoxAscent: 0.8 * fs, fontBoundingBoxDescent: 0.2 * fs }
	},
}

let sticky
let ctx
let VectorContext
let SceneCanvas
let svgDocument
let savedDocument

before(async () => {
	savedDocument = globalThis.document
	globalThis.document = { documentElement: { dataset: {}, lang: 'en' }, createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	const { Text } = await import('konva/lib/shapes/Text')
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	;({ SceneCanvas } = await import('konva/lib/Canvas'))
	;({ sticky } = await import('../../../src/scene/nodes/sticky.js'))
	;({ VectorContext } = await import('../../../src/scene/vectorContext.js'))
	;({ svgDocument } = await import('../../../src/scene/exportSvg.js'))
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true, tags: new Map() }
})
after(() => { globalThis.document = savedDocument })

const ID = '01JN0000000000000000000001'
const item = (o = {}) => ({ id: ID, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: 'Idee', ...o.data }, style: { fill: '#faea89', ...o.style }, ...o.top })
const absOf = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: it.r })

/** Builds (or takes) a note entry and draws it into a VectorContext. */
function draw(it, entry = sticky.build(ctx, it, absOf(it), 0)) {
	const vc = new VectorContext({ measure: (font, text) => ({ width: 5 * Array.from(text).length, shift: 0 }) })
	const canvas = new SceneCanvas({ width: 0, height: 0, pixelRatio: 1 })
	canvas.getContext()._context = vc
	vc.beginGroup(ID)
	entry.root.drawScene(canvas)
	vc.endGroup()
	return { entry, vc, paths: vc.ops.filter((o) => o.op === 'path') }
}
const hex = (paint) => paint?.rgb && '#' + paint.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
const strongOf = (key) => PALETTE.find((p) => p.key === key).strong
const lightOf = (key) => PALETTE.find((p) => p.key === key).light

/** Recording context for the pure paint functions. */
function recorder() {
	const calls = []
	const c = { calls }
	let fill
	Object.defineProperty(c, 'fillStyle', { get: () => fill, set: (v) => { fill = v; calls.push(['fillStyle', v]) } })
	for (const m of ['beginPath', 'moveTo', 'lineTo', 'arcTo', 'closePath', 'fill', 'fillRect', 'fillText', 'stroke']) c[m] = (...a) => calls.push([m, ...a])
	c.font = ''
	c.textBaseline = ''
	c.textAlign = ''
	c.lineWidth = 1
	c.strokeStyle = ''
	return c
}

describe('AK2 the edge', () => {
	test('noteStrongTone: each palette fill its strong tone, white → grey, black and a very dark colour → none; an old colour its shown tone', () => {
		for (const p of PALETTE) {
			const want = p.key === 'weiss' ? '#6f6f6d' : p.key === 'schwarz' ? null : p.strong
			assert.equal(noteStrongTone(p.light), want, p.key)
		}
		assert.equal(noteStrongTone('#0a0a0a'), null)
		assert.equal(noteStrongTone('#a8d8f8'), strongOf('hellblau'), 'old light blue as the new light blue')
		assert.equal(noteStrongTone('nope'), null)
		assert.equal(withAlpha('#6f6f6d', 0.18), 'rgba(111,111,109,0.18)')
	})

	test('the body strokes 1 unit in the strong tone at 18 % at LOD 0 and LOD 1; none on black; a colour change renews it', () => {
		for (const lod of [0, 1]) {
			const e = sticky.build(ctx, item({ style: { fill: '#ffffff' } }), absOf(item()), lod)
			const b = e.parts.body.attrs
			assert.deepEqual([b.stroke, b.strokeWidth, b.strokeEnabled], ['rgba(111,111,109,0.18)', 1, true], `LOD ${lod}`)
		}
		const it = item()
		const e = sticky.build(ctx, it, absOf(it), 1)
		assert.equal(e.parts.body.attrs.stroke, withAlpha(strongOf('gelb'), 0.18))
		sticky.update(ctx, e, item({ style: { fill: lightOf('schwarz') } }), absOf(it), new Set(['style']))
		assert.equal(e.parts.body.attrs.strokeEnabled, false, 'no edge on black')
		sticky.update(ctx, e, item({ style: { fill: lightOf('koralle') } }), absOf(it), new Set(['style']))
		assert.deepEqual([e.parts.body.attrs.stroke, e.parts.body.attrs.strokeEnabled], [withAlpha(strongOf('koralle'), 0.18), true])
		assert.equal(e.earLook.tone, strongOf('koralle'), 'the flap follows the colour too')
	})
})

describe('AK3 the dog ear', () => {
	test('notePath: the outline of a 200 × 200 note runs from (200, 174) to (174, 200)', () => {
		const c = recorder()
		notePath(c, 200, 200, noteEar(200, 200))
		const lines = c.calls.filter((x) => x[0] === 'lineTo').map((x) => x.slice(1))
		assert.deepEqual(lines, [[200, 174], [174, 200]])
		assert.equal(c.calls.filter((x) => x[0] === 'arcTo').length, 3, 'three round corners')
		const plain = recorder()
		notePath(plain, 200, 200, 0)
		assert.equal(plain.calls.filter((x) => x[0] === 'arcTo').length, 4)
	})

	test('noteEar: 26, at most a quarter of either side', () => {
		assert.equal(NOTE_EAR, 26)
		assert.equal(noteEar(200, 200), 26)
		assert.equal(noteEar(60, 200), 15)
		assert.equal(noteEar(20, 20), 5)
		assert.equal(noteEar(1, 1), 0.25)
		assert.equal(noteEar(0, 10), 0)
	})

	test('paintEar: shadow (1 down, 12 %), fill, tone at 22 % in this order; no shadow when off, no tone on black', () => {
		const c = recorder()
		assert.equal(paintEar(c, 200, 200, { fill: '#faea89', tone: strongOf('gelb') }, true), 3)
		const styles = c.calls.filter((x) => x[0] === 'fillStyle').map((x) => x[1])
		assert.deepEqual(styles, ['rgba(0,0,0,0.12)', '#faea89', withAlpha(strongOf('gelb'), 0.22)])
		const moves = c.calls.filter((x) => x[0] === 'moveTo' || x[0] === 'lineTo').map((x) => x.slice(1))
		assert.deepEqual(moves.slice(0, 3), [[200, 175], [174, 177], [174, 201]], 'the shadow 1 below')
		assert.deepEqual(moves.slice(3, 6), [[200, 174], [174, 176], [174, 200]], 'the flap')
		const off = recorder()
		assert.equal(paintEar(off, 200, 200, { fill: '#191b1d', tone: null }, false), 1)
		assert.equal(paintEar(recorder(), 0, 200, { fill: '#fff', tone: null }, true), 0)
	})

	test('the node: flap above the body, its shadow only at LOD 0; a resize moves outline and flap', () => {
		const it = item()
		const { entry, paths } = draw(it)
		const fills = paths.map((p) => hex(p.fill)).filter(Boolean)
		assert.ok(fills.includes('#faea89'), 'body and flap in the fill')
		const shadowAt0 = paths.filter((p) => p.fill?.rgb && hex(p.fill) === '#000000' && Math.abs(p.fill.a - 0.12) < 1e-9).length
		assert.equal(shadowAt0, 1, 'the flap shadow at LOD 0')
		sticky.setLod(ctx, entry, it, absOf(it), 1)
		const lod1 = draw(it, entry).paths.filter((p) => p.fill?.rgb && hex(p.fill) === '#000000' && Math.abs(p.fill.a - 0.12) < 1e-9).length
		assert.equal(lod1, 0, 'no flap shadow at LOD 1')
		sticky.setLod(ctx, entry, it, absOf(it), 0)
		const big = { ...it, w: 300, h: 300 }
		sticky.update(ctx, entry, big, absOf(big), new Set(['geom']))
		const svg = svgDocument(draw(big, entry).vc.ops, { x: -30, y: -30, w: 360, h: 360 })
		assert.match(svg, /L300 274L274 300/, 'the cut of the bigger note')
	})
})

describe('AK4 the text', () => {
	test('200 × 200 without tags: text area (18, 18, 164, 156), line height 1.25, centred; with a tag 134 high', () => {
		const it = item()
		const e = sticky.build(ctx, it, absOf(it), 0)
		const t = e.parts.text.attrs
		assert.deepEqual([t.x, t.y, t.width, t.height, t.lineHeight, t.align, t.verticalAlign], [18, 18, 164, 156, 1.25, 'center', 'middle'])
		const tags = new Map([['01JT0000000000000000000001', { id: '01JT0000000000000000000001', name: 'Eins', color: '#0275a9' }]])
		const tagged = item({ data: { tags: ['01JT0000000000000000000001'] } })
		const e2 = sticky.build({ ...ctx, tags }, tagged, absOf(tagged), 0)
		assert.equal(e2.parts.text.attrs.height, 200 - 18 - 48)
		assert.equal(noteTextReserve(tagged, tags, 200, 200), TAG_RESERVE)
		assert.equal(noteTextReserve(it, tags, 200, 200), NOTE_EAR - STICKY_PADDING)
		assert.equal(noteTextReserve(it, tags, 40, 40), 0, 'a small ear needs no more than the padding')
	})

	test('noteTextLayout counts lines at 1.25: a text that fits at 1.2 but not at 1.25 gets the next smaller step', () => {
		assert.equal(NOTE_LINE_HEIGHT, 1.25)
		assert.equal(LINE_HEIGHT, 1.2)
		// five lines of "a" at 32: 5 · 32 · 1.2 = 192 fits a 192 high area, 5 · 32 · 1.25 = 200 does not
		const it = { t: 'sticky', w: 300, h: 192 + 2 * STICKY_PADDING, data: { text: 'a\na\na\na\na' }, style: { fontSize: 32 } }
		assert.equal(noteTextLayout(it).fontSize, 28)
		const roomy = { ...it, h: 200 + 2 * STICKY_PADDING }
		assert.equal(noteTextLayout(roomy).fontSize, 32)
	})
})

describe('AK5 the editor', () => {
	test('a note\'s editor: line height 1.25, padding 18 · zoom; a text item\'s line height 1.2', () => {
		const N = '01JN0000000000000000000009'
		const T = '01JX0000000000000000000009'
		const h = setupScene([sceneNote(N, { x: 100, y: 100 }), textItem(T, { x: 500, y: 100 })])
		try {
			h.scene.setCamera({ x: 0, y: 0, scale: 2 })
			h.scene.openTextEditor(N)
			h.frame()
			const el = h.dom.doc.activeElement
			assert.equal(el?.tagName, 'TEXTAREA')
			assert.equal(el.style.getPropertyValue('line-height'), '1.25')
			assert.equal(el.style.getPropertyValue('padding'), (STICKY_PADDING * 2) + 'px')
			assert.equal(el.style.getPropertyValue('height'), (200 - (NOTE_EAR - STICKY_PADDING)) * 2 + 'px', 'ends clear of the ear')
			h.key('Escape', { target: el })
			h.frame()
			h.scene.openTextEditor(T)
			h.frame()
			assert.equal(h.dom.doc.activeElement.style.getPropertyValue('line-height'), '1.2')
		} finally {
			h.restore()
		}
	})
})

describe('AK6 the tag row and the ear', () => {
	const tags = new Map()
	for (let i = 1; i <= 8; i++) {
		const id = '01JT' + String(i).padStart(22, '0')
		tags.set(id, { id, name: 'Tag-Name ' + i, color: '#0275a9' })
	}
	const tagged = (w, h) => item({ data: { tags: [...tags.keys()] }, top: { w, h } })

	test('room 200 − 8 − 26 − 4 = 162; labels and "+n" end TAG_GAP left of the ear', () => {
		assert.equal(tagRoom(200, 200), 162)
		assert.equal(tagRoom(200, 200), 200 - TAG_INSET - NOTE_EAR - TAG_GAP)
		for (const [w, h] of [[200, 200], [400, 200], [120, 300]]) {
			const plan = tagRowPlan(tagged(w, h), tags, w, h)
			const ends = [...plan.labels.map((l) => l.x + l.w), plan.more ? plan.more.x + plan.more.w : 0]
			assert.ok(Math.max(...ends) <= w - noteEar(w, h) - TAG_GAP + 1e-9, `${w}×${h}: ${Math.max(...ends)}`)
			assert.ok(plan.more && plan.more.n > 0, 'the rest in "+n"')
		}
	})

	test('LOD 1 strokes end left of the ear too', () => {
		const plan = tagRowPlan(tagged(200, 200), tags, 200, 200)
		const c = recorder()
		paintTagRow(c, plan, 1, 200, 200)
		const rects = c.calls.filter((x) => x[0] === 'fillRect')
		assert.ok(rects.length > 0)
		for (const r of rects) assert.ok(r[1] + r[3] <= 200 - NOTE_EAR - TAG_GAP + 1e-9, JSON.stringify(r))
	})
})

describe('AK7 the SVG of a note', () => {
	test('the outline with the cut, the flap, the edge (width 1) and gradient shadows', () => {
		const it = item({ style: { fill: '#ffffff' } })
		const { vc } = draw(it)
		const svg = svgDocument(vc.ops, { x: -30, y: -30, w: 260, h: 260 })
		assert.match(svg, /L200 174L174 200/, 'the outline cut at the bottom right')
		assert.match(svg, /M200 174L174 176L174 200Z/, 'the flap')
		assert.match(svg, /stroke="#6f6f6d" stroke-opacity="0\.18" stroke-width="1"/, 'the grey edge of a white note')
		assert.equal((svg.match(/<linearGradient /g) ?? []).length, 2, 'two shadows')
		assert.doesNotMatch(svg, /filter|feGaussianBlur/)
	})
})

describe('AK8 old and odd notes', () => {
	test('an old palette colour, an invalid fill, no text, 1 × 1, rotated: build, draw and update without errors', () => {
		const cases = [
			item({ style: { fill: '#a8d8f8' } }),
			item({ style: { fill: 'nope' } }),
			item({ data: { text: '' } }),
			item({ top: { w: 1, h: 1 } }),
			item({ top: { r: 30 } }),
			{ id: ID, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0 },
		]
		for (const it of cases) {
			for (const lod of [0, 1]) {
				const e = sticky.build(ctx, it, absOf(it), lod)
				draw(it, e)
				sticky.update(ctx, e, { ...it, w: 150 }, { ...absOf(it), w: 150 }, new Set(['geom', 'style', 'data']))
				draw(it, e)
			}
		}
	})
})
