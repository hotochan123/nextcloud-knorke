/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 243: the frame title as a tab (design round 2, A2), with the
 * real Konva (a fake 2D canvas, as shapeTextMeasure.test.mjs) and the
 * frame builder drawn into a VectorContext like KonvaRenderer.renderVector:
 * - AK3 a titled frame: the tab 40 high, title + 2 · 14 wide, in the tab
 *   tone of its fill, the title 22 semibold FRAME_TAB_PAD in, one outline
 *   round tab and frame with rounded corners; a long title cut at w − 24; a
 *   frame 20 wide: a tab 12 wide without text
 * - AK4 no title (or blanks): a rounded rectangle, nothing above y 0; a
 *   title change by update resizes the tab or removes it
 * - AK7 (the node) while the title editor is open: the widest tab, no text;
 *   white text on a black frame
 * - AK8 a frame with lanes: its heads clipped to the outline, the lines in
 *   FRAME_STROKE
 * - AK9 the SVG of a titled frame: the tab as a path in its tone, the title
 *   as <text> 22 px, the outline in #67686a
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import {
	FRAME_STROKE, FRAME_STROKE_WIDTH, FRAME_TAB_INSET, FRAME_TAB_PAD, FRAME_TITLE_BAND, FRAME_TITLE_SIZE, FRAME_TITLE_WEIGHT, TEXT_COLOR, laneTones,
} from '../../../src/model/tokens.js'

const ctx2d = {
	font: '10px sans-serif',
	fontKerning: 'auto',
	save() {},
	restore() {},
	clearRect() {},
	fillRect() {},
	// the SceneCanvas of draw() sets its pixel ratio before its context is swapped for the VectorContext
	scale() {},
	setTransform() {},
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
	measureText(text) {
		const fs = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
		return { width: Array.from(text).length * 0.5 * fs, fontBoundingBoxAscent: 0.8 * fs, fontBoundingBoxDescent: 0.2 * fs }
	},
}

/** The title's width: 0.5 em per code point (11 world units at 22). */
const GLYPH_W = 0.5 * FRAME_TITLE_SIZE
const measureTitle = (text) => Array.from(text).length * GLYPH_W

let frame
let ctx
let VectorContext
let SceneCanvas
let svgDocument

before(async () => {
	globalThis.document = { documentElement: { dataset: {}, lang: 'en' }, createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	const { Text } = await import('konva/lib/shapes/Text')
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	;({ SceneCanvas } = await import('konva/lib/Canvas'))
	;({ frame } = await import('../../../src/scene/nodes/frame.js'))
	;({ VectorContext } = await import('../../../src/scene/vectorContext.js'))
	;({ svgDocument } = await import('../../../src/scene/exportSvg.js'))
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true, measureTitle }
})

/**
 * @param {object} [o] fields over a white 400 × 300 frame at (0, 0)
 * @return {object} frame WireItem
 */
const item = (o = {}) => ({
	id: 'F', t: 'frame', x: 0, y: 0, w: 400, h: 300, r: 0, z: 'a1', parent: null,
	data: { title: 'Ideen', ...o.data }, style: { fill: '#ffffff', ...o.style }, ...o.top,
})
const absOf = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: 0 })

/** Builds the frame and draws it into a VectorContext; its path ops. */
function draw(it, entry = frame.build(ctx, it, absOf(it), 0)) {
	const vc = new VectorContext({ measure: (font, text) => ({ width: GLYPH_W * Array.from(text).length, shift: 0 }) })
	const canvas = new SceneCanvas({ width: 0, height: 0, pixelRatio: 1 })
	canvas.getContext()._context = vc
	vc.beginGroup('F')
	entry.root.drawScene(canvas)
	vc.endGroup()
	return { entry, vc, paths: vc.ops.filter((o) => o.op === 'path'), texts: vc.ops.filter((o) => o.op === 'text') }
}
const hex = (paint) => paint && '#' + paint.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
const ys = (d) => d.filter((s) => s[0] !== 'Z').map((s) => s.at(-1))
const curves = (d) => d.filter((s) => s[0] === 'C').length

describe('AK3 a frame with a title: the tab', () => {
	test('"Ideen" on a white 400 × 300 frame: tab 40 high, 55 + 28 wide in #d1d1ce, the title 22 semibold 14 in, dark; one rounded outline in the strong tone (job 262: #6f6f6d)', () => {
		const { entry, paths } = draw(item())
		assert.equal(entry.tab.tabW, 5 * GLYPH_W + 2 * FRAME_TAB_PAD)
		assert.equal(entry.tab.tabW, 83)
		const t = entry.parts.text.attrs
		assert.deepEqual([t.x, t.y, t.width, t.height], [FRAME_TAB_PAD, -FRAME_TITLE_BAND, 55, FRAME_TITLE_BAND])
		assert.deepEqual([t.fontSize, t.fontStyle, t.fill, t.ellipsis, t.wrap, t.verticalAlign], [22, FRAME_TITLE_WEIGHT, TEXT_COLOR, true, 'none', 'middle'])
		assert.equal(entry.parts.text.visible(), true)
		const [body, tab, edge] = paths
		assert.equal(paths.length, 3, 'fill, tab, outline')
		assert.equal(hex(body.fill), '#ffffff')
		assert.equal(body.stroke, null)
		assert.equal(Math.min(...ys(body.d)), -40, 'the outline runs round the tab')
		assert.equal(curves(body.d), 5, 'two tab corners and three frame corners rounded (the top left one gives way to the tab)')
		assert.equal(hex(tab.fill), '#d1d1ce')
		assert.deepEqual([Math.min(...ys(tab.d)), Math.max(...ys(tab.d))], [-40, 0])
		assert.ok(tab.d.every((s) => s[0] === 'Z' || (s[s.length - 2] >= 0 && s[s.length - 2] <= 83)), 'the tab spans x 0 … 83')
		assert.equal(edge.fill, null)
		assert.equal(hex(edge.stroke.paint), '#6f6f6d')
		assert.equal(edge.stroke.width, FRAME_STROKE_WIDTH)
		assert.deepEqual(edge.d, body.d, 'the stroke follows the same outline')
	})

	test('Yellow and Light blue: their tab tones; Black: white text', () => {
		assert.equal(hex(draw(item({ style: { fill: '#faea89' } })).paths[1].fill), '#e8ce49')
		assert.equal(hex(draw(item({ style: { fill: '#a2d9fe' } })).paths[1].fill), '#6bbef2')
		const black = draw(item({ style: { fill: '#191b1d' } }))
		assert.equal(black.entry.parts.text.attrs.fill, '#ffffff')
		assert.equal(hex(black.paths[1].fill), '#36383b')
	})

	test('a long title: the tab ends 24 left of the right edge, the text is cut with an ellipsis at 400 − 24 − 28', () => {
		const { entry } = draw(item({ data: { title: 'Ergebnisse aus den Interviews mit der Stadtbibliothek im Oktober' } }))
		assert.equal(entry.tab.tabW, 400 - FRAME_TAB_INSET)
		assert.equal(entry.parts.text.attrs.width, 400 - FRAME_TAB_INSET - 2 * FRAME_TAB_PAD)
		assert.equal(entry.parts.text.attrs.ellipsis, true)
	})

	test('a frame 20 wide: a tab 12 wide without text; a frame 50 wide at an emoji title: finite widths', () => {
		const narrow = draw(item({ top: { w: 20 } }))
		assert.equal(narrow.entry.tab.tabW, 12)
		assert.equal(narrow.entry.parts.text.visible(), false)
		assert.ok(narrow.paths.every((p) => p.d.flat().every((v) => typeof v === 'string' || Number.isFinite(v))))
		const emoji = draw(item({ top: { w: 50 }, data: { title: '🎉🎉 Retro' } }))
		assert.equal(emoji.entry.tab.tabW, 50 - FRAME_TAB_INSET)
		assert.ok(emoji.paths.every((p) => p.d.flat().every((v) => typeof v === 'string' || Number.isFinite(v))))
	})
})

describe('AK4 a frame without a title', () => {
	for (const title of ['', '   ']) {
		test(`title ${JSON.stringify(title)}: a rounded rectangle (four corners), nothing above y 0, no text`, () => {
			const { entry, paths } = draw(item({ data: { title } }))
			assert.equal(entry.tab.tabW, 0)
			assert.equal(entry.parts.text.visible(), false)
			assert.equal(paths.length, 2, 'fill and outline, no tab')
			assert.equal(Math.min(...paths.flatMap((p) => ys(p.d))), 0)
			assert.equal(curves(paths[0].d), 4)
		})
	}

	test('a title change by update (local or by sync, the renderer calls the same) resizes the tab, a removed title removes it', () => {
		const it = item()
		const entry = frame.build(ctx, it, absOf(it), 0)
		assert.equal(entry.tab.tabW, 83)
		const longer = { ...it, data: { title: 'Ideen und Fragen' } }
		assert.equal(frame.update(ctx, entry, longer, absOf(longer), new Set(['text'])), false, 'in place')
		assert.equal(entry.tab.tabW, 16 * GLYPH_W + 28)
		assert.equal(entry.parts.text.attrs.text, 'Ideen und Fragen')
		const none = { ...it, data: { title: '' } }
		frame.update(ctx, entry, none, absOf(none), new Set(['text']))
		assert.equal(entry.tab.tabW, 0)
		assert.equal(draw(none, entry).paths.length, 2)
		const yellow = { ...longer, style: { fill: '#faea89' }, w: 120 }
		frame.update(ctx, entry, yellow, absOf(yellow), new Set(['text', 'style', 'geom']))
		assert.equal(entry.tab.tabW, 120 - FRAME_TAB_INSET)
		assert.equal(hex(draw(yellow, entry).paths[1].fill), '#e8ce49')
	})
})

describe('AK7 the node while the title editor is open', () => {
	test('the widest tab (w − 24), no title text; back when it closes', () => {
		const it = item()
		const entry = frame.build(ctx, it, absOf(it), 0)
		frame.setTextHidden(entry, true)
		assert.equal(entry.tab.tabW, 400 - FRAME_TAB_INSET)
		assert.equal(entry.parts.text.visible(), false)
		assert.equal(draw(it, entry).paths.length, 3, 'the tab is drawn')
		frame.setTextHidden(entry, false)
		assert.equal(entry.tab.tabW, 83)
		assert.equal(entry.parts.text.visible(), true)
	})

	test('a new frame without a title: its editor gets the widest tab in the tab tone too; built while editing', () => {
		const it = item({ data: { title: '' } })
		const entry = frame.build(ctx, it, absOf(it), 0, true)
		assert.equal(entry.tab.tabW, 376)
		assert.equal(hex(draw(it, entry).paths[1].fill), '#d1d1ce')
	})
})

describe('AK8 a frame with lanes', () => {
	const lanes = (title) => item({
		top: { w: 700, h: 320 },
		data: {
			title,
			lanes: { l00000001: { o: 'i0', h: 160, t: 'Kunde', g: 'g00000001' }, l00000002: { o: 'i1', h: 160, t: 'Design', g: 'g00000001' } },
			lgroups: { g00000001: 'Team' },
			cols: { c00000001: { o: 'i0', w: 300, t: 'Planen' }, c00000002: { o: 'i1', w: 304, t: 'Bauen' } },
		},
	})

	for (const title of ['Bestellprozess', '']) {
		test(`title ${JSON.stringify(title)}: the head fills are clipped to the outline, the dividers (job 264) in the dark tab tone, the outline (job 262) in the strong tone`, () => {
			const { entry, paths } = draw(lanes(title))
			assert.equal(entry.lanes, true)
			assert.equal(entry.tab.tabW > 0, title !== '')
			const outline = paths[0].d
			const tone = laneTones('#ffffff')
			const heads = paths.filter((p) => p.fill && [tone.head, tone.group].includes(hex(p.fill)))
			assert.equal(heads.length, 3, 'head column, head row, lane group cell (job 264: the group fill)')
			for (const p of heads) {
				assert.ok(p.clip && p.clip.length === 1, 'drawn under one clip')
				assert.deepEqual(p.clip[0].d ?? p.clip[0], outline, 'the clip is the outline')
			}
			const lines = paths.filter((p) => p.stroke && p !== paths.at(-1))
			assert.ok(lines.length >= 1)
			for (const p of paths.filter((x) => x.stroke)) assert.equal(hex(p.stroke.paint), JSON.stringify(p.d) === JSON.stringify(outline) ? '#6f6f6d' : tone.line)
		})
	}
})

describe('AK9 the SVG export of a titled frame', () => {
	test('the tab as a path in #d1d1ce, the title as <text> 22 px, the outline in #6f6f6d (job 262; #67686a before)', () => {
		const { vc } = draw(item({ top: { x: 0, y: 0 } }))
		const svg = svgDocument(vc.ops, { x: -16, y: -56, w: 432, h: 372 })
		assert.match(svg, /<path [^>]*fill="#d1d1ce"/)
		assert.match(svg, /<text [^>]*font-size="22"[^>]*>Ideen<\/text>/)
		assert.match(svg, /stroke="#6f6f6d"/)
		assert.doesNotMatch(svg, /#8a8c8e/, 'the old outline colour is gone')
	})
})
