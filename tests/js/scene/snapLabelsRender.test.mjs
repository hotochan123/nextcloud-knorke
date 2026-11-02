/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 194 AK4) The labels and measuring lines with the REAL KonvaRenderer
 * (the scaffold of reactionsRender.test.mjs: Konva on the fake DOM, canvases
 * whose 2D context records nothing and measures 5 px per character; this
 * file never imports sceneHarness.mjs):
 * - a distance label: a group (knorke-snap-label) with a rectangle in
 *   SNAP_LABEL_FILL and the white text, SNAP_LABEL_FONT_PX, not listening;
 *   centred below a horizontal line, right of a vertical one, at the same
 *   screen size at zoom 1, 2 and 0.5 (re-placed on the scale change)
 * - the size label (knorke-size-label): its right edge on the anchor, its
 *   top SIZE_LABEL_GAP_PX below it; null removes it
 * - measuring lines (knorke-measure-line) drawn like gap markers; the labels
 *   lie above them
 * - a real drag shows the label of its measuring line and draws no static
 *   layer meanwhile
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { gapMarkerPoints } from '../../../src/scene/KonvaRenderer.js'
import {
	SIZE_LABEL_GAP_PX, SNAP_GUIDE_COLOR, SNAP_LABEL_FILL, SNAP_LABEL_FONT_PX, SNAP_LABEL_OFFSET_PX, SNAP_LABEL_PAD_X, SNAP_LABEL_PAD_Y,
} from '../../../src/model/tokens.js'
import { dispatch, installDom } from './fakeDom.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const note = (id, o = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: id }, style: { fill: '#a8d8f8' }, ...o })
/** The fake context measures 5 px per character. */
const CHAR_PX = 5
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9, `${msg ?? ''} ${a} ≈ ${b}`)

/** @return {object} a 2D context that draws nothing */
function nullContext() {
	return new Proxy({}, {
		get(t, name) {
			if (name in t) return t[name]
			if (name === 'measureText') return (s) => ({ width: String(s).length * CHAR_PX })
			if (name === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)) })
			if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
			if (typeof name === 'string' && name.startsWith('create')) return () => ({ addColorStop() {} })
			return () => {}
		},
		set(t, name, v) {
			t[name] = v
			return true
		},
	})
}

let dom = null
let scene = null
let container = null
const browser = Konva.isBrowser
afterEach(() => {
	scene?.destroy()
	scene = null
	dom?.restore()
	dom = null
	Konva.isBrowser = browser
})

/**
 * A mounted scene with the real renderer, camera at the origin, scale 1.
 *
 * @param {object[]} items WireItems
 * @return {SceneManager}
 */
function mount(items) {
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
			const ctx = nullContext()
			el.getContext = () => ctx
		}
		return el
	}
	container = dom.doc.createElement('div')
	container.clientWidth = 1000
	container.clientHeight = 800
	dom.doc.body.appendChild(container)
	const model = new SceneModel()
	model.load(items)
	scene = new SceneManager(container, model, {})
	scene.mount()
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	frames()
	return scene
}

/** Runs a few animation frames (the scene draws dirty layers in its frame). */
function frames(n = 3) {
	for (let i = 0; i < n; i++) dom.frame()
}

/** @param {string} name node name @return {object[]} the nodes of that name on the stage */
const nodes = (name) => scene.renderer.stage.find('.' + name)
/** @param {string} text label text @return {{w:number, h:number}} the label's size in screen px */
const sizeOf = (text) => ({ w: text.length * CHAR_PX + 2 * SNAP_LABEL_PAD_X, h: SNAP_LABEL_FONT_PX + 2 * SNAP_LABEL_PAD_Y })

test('a distance label: filled rectangle, white text, not listening; below a horizontal line, right of a vertical one', () => {
	mount([])
	scene.renderer.setSnapLabels([{ text: '200', x: 400, y: 300, place: 'below' }, { text: '60', x: 150, y: 130, place: 'right' }])
	const [below, right] = nodes('knorke-snap-label')
	assert.equal(nodes('knorke-snap-label').length, 2)
	const [rect, text] = below.getChildren()
	assert.equal(rect.fill(), SNAP_LABEL_FILL)
	assert.equal(text.fill(), '#ffffff')
	assert.equal(text.text(), '200')
	assert.equal(text.fontSize(), SNAP_LABEL_FONT_PX)
	assert.equal(below.listening(), false)
	assert.deepEqual([rect.width(), rect.height()], [sizeOf('200').w, sizeOf('200').h])
	assert.deepEqual([below.x(), below.y(), below.scaleX()], [400 - sizeOf('200').w / 2, 300 + SNAP_LABEL_OFFSET_PX, 1])
	assert.deepEqual([right.x(), right.y()], [150 + SNAP_LABEL_OFFSET_PX, 130 - sizeOf('60').h / 2])
	scene.renderer.setSnapLabels([{ text: '1306', x: 400, y: 300, place: 'below' }])
	assert.equal(nodes('knorke-snap-label').length, 1)
	assert.equal(nodes('knorke-snap-label')[0].getChildren()[1].text(), '1306')
	assert.equal(nodes('knorke-snap-label')[0].getChildren()[0].width(), sizeOf('1306').w, 'the rectangle follows the text')
	scene.renderer.setSnapLabels(null)
	assert.equal(nodes('knorke-snap-label').length, 0)
})

for (const scale of [2, 0.5]) {
	test(`zoom ${scale}: the labels keep their screen size and distance, re-placed on the scale change`, () => {
		mount([])
		scene.renderer.setSnapLabels([{ text: '200', x: 400, y: 300, place: 'below' }])
		scene.renderer.setSizeLabel({ text: '250 × 160', x: 354, y: 264 })
		scene.setCamera({ x: 0, y: 0, scale })
		frames()
		const [label] = nodes('knorke-snap-label')
		close(label.scaleX(), 1 / scale, 'scaleX')
		close(label.scaleY(), 1 / scale, 'scaleY')
		close(label.x(), 400 - sizeOf('200').w / 2 / scale, 'x')
		close(label.y(), 300 + SNAP_LABEL_OFFSET_PX / scale, 'y')
		// on screen: the same 13 px high rectangle as at zoom 1
		close(label.getChildren()[0].height() * label.scaleY() * scale, sizeOf('200').h, 'screen height')
		const [size] = nodes('knorke-size-label')
		close(size.scaleX(), 1 / scale, 'size scaleX')
		close(size.x() + sizeOf('250 × 160').w / scale, 354, 'right edge on the anchor')
		close(size.y(), 264 + SIZE_LABEL_GAP_PX / scale, 'top below the anchor')
	})
}

test('the size label: right edge on the anchor, top SIZE_LABEL_GAP_PX below; one node; null removes it', () => {
	mount([])
	scene.renderer.setSizeLabel({ text: '250 × 160', x: 354, y: 264 })
	scene.renderer.setSizeLabel({ text: '260 × 160', x: 364, y: 264 })
	const list = nodes('knorke-size-label')
	assert.equal(list.length, 1)
	const [rect, text] = list[0].getChildren()
	assert.equal(text.text(), '260 × 160')
	assert.equal(rect.fill(), SNAP_LABEL_FILL)
	assert.deepEqual([list[0].x() + rect.width(), list[0].y()], [364, 264 + SIZE_LABEL_GAP_PX])
	assert.ok(SIZE_LABEL_GAP_PX > 4, 'below the corner handle (HANDLE_PX / 2)')
	scene.renderer.setSizeLabel(null)
	assert.equal(nodes('knorke-size-label').length, 0)
})

test('measuring lines like gap markers, in the guide colour; the labels above them', () => {
	mount([])
	const m = { axis: 'x', at: 300, from: 300, to: 500 }
	scene.renderer.setSnapLabels([{ text: '200', x: 400, y: 300, place: 'below' }])
	scene.renderer.setMeasureLines([m])
	const [line] = nodes('knorke-measure-line')
	assert.deepEqual(line.points(), gapMarkerPoints(m, 1))
	assert.equal(line.stroke(), SNAP_GUIDE_COLOR)
	assert.ok(nodes('knorke-snap-label')[0].zIndex() > line.zIndex(), 'the label lies above the line')
	scene.renderer.setMeasureLines(null)
	assert.equal(nodes('knorke-measure-line').length, 0)
})

test('a real drag: the measuring line and its label "200"; no static draw while dragging; gone at the release', () => {
	mount([note(A, { x: 100, y: 400 }), note(B, { x: 500, y: 100 })])
	dispatch(container, 'pointerdown', { clientX: 200, clientY: 500 })
	dispatch(container, 'pointermove', { clientX: 200, clientY: 420 })
	frames()
	// the drag has begun (the static layer gave up A once); from here on no static draw
	const before = scene.stats().draws
	dispatch(container, 'pointermove', { clientX: 200, clientY: 405 })
	frames()
	assert.deepEqual(nodes('knorke-snap-label').map((n) => n.getChildren()[1].text()), ['200'])
	assert.equal(nodes('knorke-measure-line').length, 1)
	dispatch(container, 'pointermove', { clientX: 200, clientY: 420 })
	frames()
	assert.equal(nodes('knorke-snap-label').length, 0)
	dispatch(container, 'pointermove', { clientX: 200, clientY: 404 })
	frames()
	assert.equal(nodes('knorke-snap-label').length, 1)
	const after = scene.stats().draws
	assert.equal(after.static, before.static, 'no static draw while dragging')
	assert.ok(after.overlay > before.overlay, 'the overlay draws the labels')
	dispatch(container, 'pointerup', { clientX: 200, clientY: 405 })
	frames()
	assert.equal(nodes('knorke-snap-label').length, 0)
	assert.equal(nodes('knorke-measure-line').length, 0)
})

test('a real resize: the size label at the bottom right corner of the drawn frame; gone at the release', () => {
	mount([note(A, { x: 100, y: 100 })])
	scene.setSelection([A])
	frames()
	dispatch(container, 'pointerdown', { clientX: 304, clientY: 304 })
	dispatch(container, 'pointermove', { clientX: 354, clientY: 354 })
	frames()
	const [size] = nodes('knorke-size-label')
	assert.equal(size.getChildren()[1].text(), '250 × 250')
	close(size.x() + size.getChildren()[0].width(), 354, 'right edge')
	close(size.y(), 354 + SIZE_LABEL_GAP_PX, 'top')
	dispatch(container, 'pointerup', { clientX: 354, clientY: 354 })
	frames()
	assert.equal(nodes('knorke-size-label').length, 0)
})
