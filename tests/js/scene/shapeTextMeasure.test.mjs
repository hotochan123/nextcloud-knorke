/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * The text block of a shape without fill in the REAL Konva.Text layout
 * (factory job 177): KonvaRenderer.measureShapeLines (a detached Konva.Text,
 * no stage needed) against the text node nodes/shape.js builds, and
 * shapeTextBlock against the place Konva draws the lines at. Konva measures
 * through getDummyContext(); a fake document hands it a 2D context whose
 * glyphs are 0.5 em wide, so the wraps are known.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { LINE_HEIGHT } from '../../../src/model/tokens.js'

const ctx2d = {
	font: '10px sans-serif',
	fontKerning: 'auto',
	save() {},
	restore() {},
	clearRect() {},
	fillRect() {},
	// Konva's canvas farbling probe at import: an unmodified 10 × 10 read-back
	getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).map((v, i) => (i % 4 === 3 ? 255 : 40)) }),
	measureText(text) {
		const fs = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10)
		return { width: Array.from(text).length * 0.5 * fs, fontBoundingBoxAscent: 0.8 * fs, fontBoundingBoxDescent: 0.2 * fs }
	},
}

let renderer
let ctx
let shape
let shapeTextBlock
let shapeTextBox

before(async () => {
	// documentElement: @nextcloud/l10n (the renderer's title hint) reads the locale at import
	globalThis.document = { documentElement: { dataset: {}, lang: 'en' }, createElement: () => ({ style: {}, getContext: () => ctx2d }) }
	const Konva = (await import('konva/lib/Core')).default
	const { Text } = await import('konva/lib/shapes/Text')
	const { Rect } = await import('konva/lib/shapes/Rect')
	const { Line } = await import('konva/lib/shapes/Line')
	const { KonvaRenderer } = await import('../../../src/scene/KonvaRenderer.js')
	;({ shape, shapeTextBlock, shapeTextBox } = await import('../../../src/scene/nodes/shape.js'))
	const { SceneModel } = await import('../../../src/model/SceneModel.js')
	renderer = new KonvaRenderer(null, new SceneModel())
	ctx = { Group: Konva.Group, Rect, Text, Shape: Konva.Shape, Line, shadows: true }
})

const ABS = Object.freeze({ x: 100, y: 100, w: 200, h: 120, r: 0 })

/**
 * @param {string} text data.text
 * @param {object} [style] style fields over fillOpacity 0
 * @return {object} shape WireItem (200 × 120 rect)
 */
const item = (text, style = {}) => ({
	id: 'S', t: 'shape', x: 100, y: 100, w: 200, h: 120, r: 0, z: 'a2', parent: null,
	data: { kind: 'rect', text }, style: { fill: '#ffffff', fillOpacity: 0, stroke: '#1a1a1a', strokeWidth: 2, ...style },
})

/**
 * @param {object} it shape WireItem
 * @return {object} the Konva.Text of its node at LOD 0
 */
const nodeText = (it) => shape.build(ctx, it, ABS, 0).parts.text

describe('measureShapeLines: the lines the text node draws', () => {
	test('"Hello" at 20: one line of 50', () => {
		assert.deepEqual(renderer.measureShapeLines(item('Hello', { fontSize: 20 }), ABS), [50])
	})

	test('word wrap at the inner text box (184): the same lines as the node', () => {
		const it = item('alpha beta gamma delta epsilon', { fontSize: 20 })
		const lines = renderer.measureShapeLines(it, ABS)
		assert.deepEqual(lines, [160, 130])
		assert.deepEqual(lines, nodeText(it).textArr.map((l) => l.width))
	})

	test('an overflow ends with the ellipsis: as many lines as fit (4 × 24 in 104), the same as the node', () => {
		const it = item('a\nb\nc\nd\ne\nf', { fontSize: 20 })
		const lines = renderer.measureShapeLines(it, ABS)
		assert.equal(lines.length, 4)
		assert.deepEqual(lines, nodeText(it).textArr.map((l) => l.width))
		assert.equal(nodeText(it).textArr.at(-1).text, 'd…')
	})

	test('the automatic font size (none stored): the same lines as the node', () => {
		const it = item('Retrospective sprint twelve and a few more words')
		const t = nodeText(it)
		assert.equal(t.fontSize(), shapeTextBox(it, ABS).fontSize)
		assert.deepEqual(renderer.measureShapeLines(it, ABS), t.textArr.map((l) => l.width))
	})
})

describe('shapeTextBlock: where Konva draws the lines', () => {
	for (const align of ['left', 'center', 'right']) {
		for (const valign of ['top', 'middle', 'bottom']) {
			test(`${align}/${valign}: the block holds every drawn line, the widest one edge to edge`, () => {
				const it = item('Hello\nBig world', { fontSize: 20, align, valign })
				const t = nodeText(it)
				const b = shapeTextBlock(shapeTextBox(it, ABS), renderer.measureShapeLines(it, ABS))
				const lineH = t.fontSize() * LINE_HEIGHT
				const top = t.y() + t._getTextTop()
				assert.equal(b.y, top, 'the top of the first line')
				assert.equal(b.h, t.textArr.length * lineH)
				const xs = t.textArr.map((l) => {
					const free = t.width() - l.width
					return t.x() + (align === 'right' ? free : align === 'center' ? free / 2 : 0)
				})
				assert.equal(b.x, Math.min(...xs), 'the left end of the leftmost line')
				assert.equal(b.x + b.w, Math.max(...t.textArr.map((l, i) => xs[i] + l.width)), 'the right end of the rightmost line')
			})
		}
	}
})
