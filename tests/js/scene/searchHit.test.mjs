/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 271: the frame around the current hit of the board search
 * (SceneManager setSearchHit, KonvaRenderer setSearchHit).
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { SEARCH_HIT_COLOR, SEARCH_HIT_GAP_PX, SEARCH_HIT_STROKE_PX } from '../../../src/model/tokens.js'
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

const hits = () => scene.renderer.stage.find('.knorke-search-hit')

test('setSearchHit draws one frame 6 px outside the item in every mode, follows the zoom, and goes with null', () => {
	mount([frameItem(), note])
	scene.setSearchHit(N)
	frames()
	assert.equal(scene.getSearchHit(), N)
	let h = hits()
	assert.equal(h.length, 1)
	assert.deepEqual([h[0].x(), h[0].y(), h[0].width(), h[0].height()], [700 - SEARCH_HIT_GAP_PX, 100 - SEARCH_HIT_GAP_PX, 200 + 2 * SEARCH_HIT_GAP_PX, 200 + 2 * SEARCH_HIT_GAP_PX])
	assert.deepEqual([h[0].stroke(), h[0].strokeWidth(), h[0].strokeScaleEnabled(), h[0].listening()], [SEARCH_HIT_COLOR, SEARCH_HIT_STROKE_PX, false, false])
	assert.deepEqual(scene.getSelection(), [], 'the selection stays empty')
	scene.setCamera({ x: 0, y: 0, scale: 2 })
	frames()
	assert.equal(hits()[0].x(), 700 - SEARCH_HIT_GAP_PX / 2)
	for (const mode of ['vote', 'view']) {
		scene.setMode(mode)
		frames()
		assert.equal(hits().length, 1, mode)
	}
	scene.setSearchHit(F)
	frames()
	h = hits()
	assert.equal(h.length, 1, 'one frame at a time')
	assert.equal(h[0].width(), 400 + SEARCH_HIT_GAP_PX)
	scene.setSearchHit(null)
	frames()
	assert.equal(hits().length, 0)
	assert.equal(scene.getSearchHit(), null)
})

test('the frame hides while its item is gone; an unknown id draws nothing', () => {
	mount([frameItem(), note])
	scene.setSearchHit(N)
	frames()
	scene.update(model.apply({ removes: [N] }))
	frames()
	assert.equal(scene.getSearchHit(), null)
	assert.equal(hits()[0]?.opacity() ?? 0, 0)
	scene.setSearchHit('01JA000000000000000000NONE')
	frames()
	assert.equal(hits().length, 0)
})
