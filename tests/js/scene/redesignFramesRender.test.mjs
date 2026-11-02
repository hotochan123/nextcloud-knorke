/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 262 (design round 4 R4) with the REAL KonvaRenderer (the
 * scaffold of selectionRender.test.mjs):
 * - AK2 the body of a frame strokes in the strong tone of its fill, 1.5
 *   screen px; a colour change takes the new tone
 * - AK4 a selected frame: its outline is the knorke-frame-outline shape
 *   round frame and tab (frameOutline), solid for the own selection, dashed
 *   for another participant's; a note keeps its rectangle
 * - AK5 the own selection tints the tab (22 % of the primary colour), another
 *   participant's does not; deselecting takes the tint off
 * - AK8 old frame colours, no title, lanes, a custom colour: load and draw
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { FRAME_FILLS, FRAME_STROKE_WIDTH, frameTabFill, mixColor } from '../../../src/model/tokens.js'
import { installDom } from './fakeDom.mjs'

const F = '01JA00000000000000000000F1'
const N = '01JA00000000000000000000N1'
const frameItem = (o = {}) => ({
	id: F, t: 'frame', x: 100, y: 100, w: 400, h: 300, r: 0, z: 'a0', parent: null, data: { title: 'Ideen' }, style: { fill: '#faea89' }, ...o,
})
const note = { id: N, t: 'sticky', x: 700, y: 100, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: 'n' }, style: { fill: '#a2d9fe' } }

/** @return {object} a 2D context that draws nothing */
function nullContext() {
	return new Proxy({}, {
		get(t, name) {
			if (name in t) return t[name]
			if (name === 'measureText') return (s) => ({ width: String(s).length * 5 })
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
let model = null
const browser = Konva.isBrowser
const savedStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
afterEach(() => {
	scene?.destroy()
	scene = null
	dom?.restore()
	dom = null
	Konva.isBrowser = browser
	if (savedStyle) Object.defineProperty(globalThis, 'getComputedStyle', savedStyle)
	else delete globalThis.getComputedStyle
})

/**
 * @param {object[]} items board items
 * @return {SceneManager} mounted, camera at the origin, scale 1, primary colour #00679e
 */
function mount(items) {
	dom = installDom()
	Konva.isBrowser = true
	globalThis.window.document = dom.doc
	dom.doc.addEventListener = () => {}
	dom.doc.removeEventListener = () => {}
	Object.defineProperty(globalThis, 'getComputedStyle', {
		value: () => ({ getPropertyValue: (n) => (n === '--color-primary-element' ? '#00679e' : '') }), configurable: true, writable: true,
	})
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
	const container = dom.doc.createElement('div')
	container.clientWidth = 1000
	container.clientHeight = 800
	dom.doc.body.appendChild(container)
	model = new SceneModel()
	model.load(items)
	scene = new SceneManager(container, model, {})
	scene.mount()
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	frames()
	return scene
}

function frames(n = 3) {
	for (let i = 0; i < n; i++) dom.frame()
}

/** @return {object} the body shape of the frame's node (its first child) */
const body = (id = F) => scene.renderer.stage.find((n) => n.getAttr('kid') === id)[0].getChildren()[0]

/** The tab fill the body paints: its sceneFunc into a recording context. */
function tabFill(id = F) {
	const b = body(id)
	const fills = []
	const c = new Proxy({}, {
		get: (t, name) => (name === 'setAttr' ? (k, v) => { if (k === 'fillStyle') fills.push(v) } : () => {}),
	})
	b.sceneFunc()(c, b)
	return fills.at(-1)
}

test('AK2 the border in the strong tone of the fill, 1.5 screen px; a colour change takes the new tone', () => {
	mount([frameItem()])
	const b = body()
	assert.deepEqual([b.stroke(), b.strokeWidth(), b.strokeScaleEnabled()], ['#7e6f01', FRAME_STROKE_WIDTH, false])
	scene.update(model.apply({ upserts: [frameItem({ style: { fill: '#ffffff' } })] }))
	frames()
	assert.equal(body().stroke(), '#6f6f6d')
})

test('AK4 the own selection of a frame: one outline round frame and tab, 4 px outside, radius 12; a note keeps its rectangle', () => {
	mount([frameItem(), note])
	scene.setSelection([F])
	frames()
	const outlines = scene.renderer.stage.find('.knorke-frame-outline')
	assert.equal(outlines.length, 1)
	const o = outlines[0]
	assert.deepEqual([o.x(), o.y(), o.width(), o.height()], [96, 96, 408, 308])
	const fo = o.getAttr('frameOutline')
	assert.equal(fo.r, 12)
	assert.equal(fo.w, 408)
	assert.ok(fo.tabW > 8, 'a titled frame: the tab, 8 wider')
	assert.equal(o.dash(), undefined)
	scene.setSelection([N])
	frames()
	assert.equal(scene.renderer.stage.find('.knorke-frame-outline').length, 0, 'a note: the rectangle as before')
})

test('AK4 another participant\'s selection of a frame: the same outline, dashed', () => {
	mount([frameItem()])
	scene.renderer.setSelection([], [{ ids: [F], color: '#c43e45' }])
	frames()
	const o = scene.renderer.stage.find('.knorke-frame-outline')[0]
	assert.deepEqual([o.stroke(), o.dash()], ['#c43e45', [6, 4]])
	assert.equal(o.getAttr('frameOutline').r, 12)
})

test('AK5 the own selection tints the tab by 22 %, another\'s does not, deselecting takes it off', () => {
	mount([frameItem()])
	const tone = frameTabFill('#faea89')
	assert.equal(tabFill(), tone)
	scene.setSelection([F])
	frames()
	assert.equal(tabFill(), mixColor('#00679e', tone, 0.22))
	scene.setSelection([])
	frames()
	assert.equal(tabFill(), tone)
	scene.renderer.setSelection([], [{ ids: [F], color: '#c43e45' }])
	frames()
	assert.equal(tabFill(), tone, 'no tint for another participant')
	scene.renderer.setSelection([F])
	scene.renderer.setSelectionColor('#123456')
	assert.equal(tabFill(), mixColor('#123456', tone, 0.22), 'a new primary colour')
})

test('AK8 old colours, no title, lanes and a custom colour load and draw without errors', () => {
	const items = FRAME_FILLS.map((fill, i) => frameItem({ id: '01JA0000000000000000000F' + String(i).padStart(2, '0'), x: (i % 5) * 500, y: Math.floor(i / 5) * 450, style: { fill }, data: { title: i % 2 ? '' : 'Alt ' + i } }))
	items.push(frameItem({ id: '01JA0000000000000000000FX', x: 0, y: 1400, style: { fill: '#ff8800' }, data: { title: 'Bahnen', lanes: { l00000001: { o: 'i0', h: 150, t: 'A' }, l00000002: { o: 'i1', h: 150 } } } }))
	mount(items)
	scene.setCamera({ x: 0, y: 0, scale: 0.35 })
	frames()
	scene.setSelection(items.map((x) => x.id))
	frames()
	for (const it of items) assert.match(body(it.id).stroke(), /^#[0-9a-f]{6}$/, it.id)
	assert.equal(scene.renderer.stage.find('.knorke-frame-outline').length, items.length)
})
