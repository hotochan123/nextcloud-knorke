/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 267 (AK8, AK9): the AI card node with the real Konva (a fake
 * 2D canvas, as frameTab.test.mjs) drawn into a VectorContext like
 * KonvaRenderer.renderVector: the header with the frame's title, the
 * Markdown formatted (bold heading, bold and italic runs, list markers) and
 * the SVG keeps them as <text>; no editor; the content height.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TYPES, typeInfo } from '../../../src/model/registry.js'

const ctx2d = {
	font: '10px sans-serif',
	save() {},
	restore() {},
	clearRect() {},
	fillRect() {},
	scale() {},
	setTransform() {},
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
	measureText(text) {
		const fs = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
		return { width: Array.from(text).length * 0.5 * fs }
	},
}

/** 0.5 em per code point. */
const measure = (text, font) => Array.from(text).length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)

let ai
let aiCardHeight
let ctx
let VectorContext
let SceneCanvas
let svgDocument
let nodeSpecFor

before(async () => {
	globalThis.document = { documentElement: { dataset: {}, lang: 'en' }, createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	const { Text } = await import('konva/lib/shapes/Text')
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	;({ SceneCanvas } = await import('konva/lib/Canvas'))
	;({ ai, aiCardHeight } = await import('../../../src/scene/nodes/ai.js'))
	;({ nodeSpecFor } = await import('../../../src/scene/nodes/index.js'))
	;({ VectorContext } = await import('../../../src/scene/vectorContext.js'))
	;({ svgDocument } = await import('../../../src/scene/exportSvg.js'))
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true }
})

const item = (data, o = {}) => ({ id: 'A', t: 'ai', x: 0, y: 0, w: 360, h: 400, r: 0, z: 'i1', parent: null, data, style: {}, ...o })
const absOf = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h, r: 0 })

function draw(it) {
	const vc = new VectorContext({ measure: (font, text) => ({ width: measure(text, font), shift: 0 }) })
	const canvas = new SceneCanvas({ width: 0, height: 0, pixelRatio: 1 })
	canvas.getContext()._context = vc
	vc.beginGroup('A')
	ai.build(ctx, it, absOf(it), 0).root.drawScene(canvas)
	vc.endGroup()
	return { vc, texts: vc.ops.filter((o) => o.op === 'text'), paths: vc.ops.filter((o) => o.op === 'path') }
}

describe('job 267: the AI card', () => {
	test('AK9 the header names the frame; the Markdown is drawn formatted', () => {
		const { texts, paths } = draw(item({ md: '# Summary\nSome **bold** and *it*.\n\n- one\n1. two', title: 'Retro' }))
		const by = (s) => texts.find((t) => t.text === s)
		assert.ok(by('AI summary · Retro'), 'the header')
		assert.equal(by('AI summary · Retro').bold, true)
		assert.equal(by('Summary').bold, true, 'a heading is bold')
		assert.equal(by('Summary').size, 20)
		assert.equal(by('bold').bold, true)
		assert.equal(by('it').italic, true)
		assert.ok(by('•') && by('1.'), 'list markers')
		assert.ok(by('one') && by('two'))
		assert.ok(!texts.some((t) => t.text.includes('**')), 'no Markdown syntax is drawn')
		assert.ok(paths.some((p) => p.fill && p.fill.rgb.join() === '255,255,255'), 'a white card')
	})

	test('AK9 without a title the header is "AI summary"; the SVG keeps the texts with bold runs', () => {
		const { vc, texts } = draw(item({ md: '**Key** point' }))
		assert.ok(texts.some((t) => t.text === 'AI summary'))
		const svg = svgDocument(vc.ops, { x: 0, y: 0, w: 360, h: 400 })
		assert.match(svg, /<text [^>]*font-weight="bold"[^>]*>Key<\/text>/)
		assert.match(svg, /<text [^>]*> point<\/text>/)
	})

	test('AK9 HTML in the Markdown stays text', () => {
		const { texts } = draw(item({ md: '<img src=x onerror=alert(1)>' }))
		assert.ok(texts.some((t) => t.text.includes('<img')))
	})

	test('a short stored height clips the body, the content height is measured', () => {
		const md = Array.from({ length: 30 }, (_, i) => '- point ' + i).join('\n')
		const { texts } = draw(item({ md }, { h: 120 }))
		assert.ok(texts.filter((t) => t.text.startsWith('point')).length < 5, 'only what fits')
		const h = aiCardHeight(item({ md }), 360, measure)
		assert.ok(h > 600 && h < 800, String(h))
		assert.ok(aiCardHeight(item({ md: '' }), 360, measure) >= 46)
	})

	test('AK8 registry: no editor, no text path, not resized, not rotated; the node spec is ai', () => {
		const info = typeInfo('ai')
		assert.deepEqual([info.editor, info.textPath, info.resize, info.rotatable], [null, null, 'none', false])
		assert.ok('ai' in TYPES)
		assert.equal(nodeSpecFor('ai'), ai)
		assert.doesNotMatch(readFileSync(new URL('../../../src/scene/nodes/ai.js', import.meta.url), 'utf8'), /innerHTML|v-html/)
	})
})

describe('job 277: the AI violet', () => {
	test('AK1 the card draws its sparkle in AI_VIOLET', async () => {
		const { AI_VIOLET } = await import('../../../src/model/tokens.js')
		assert.equal(AI_VIOLET, '#6a4fe8')
		const rgb = [1, 3, 5].map((i) => parseInt(AI_VIOLET.slice(i, i + 2), 16)).join()
		const { paths } = draw(item({ md: 'x' }))
		assert.ok(paths.some((p) => p.fill && p.fill.rgb.join() === rgb), 'a violet sparkle')
		assert.doesNotMatch(readFileSync(new URL('../../../src/scene/nodes/ai.js', import.meta.url), 'utf8'), /#7b61ff/i, 'no own hex')
	})
})
