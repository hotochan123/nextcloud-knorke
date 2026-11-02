/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 151 AK4) The lock symbol only in mode edit, with the REAL
 * KonvaRenderer: Konva runs on the fake DOM (fakeDom.mjs) with canvases
 * whose 2D context records nothing (a Proxy: every method a no-op, the few
 * read back answered). This file never imports sceneHarness.mjs, which
 * stubs the renderer for its whole process. A scene with one locked note
 * in view: stats().locks is 1 in mode edit, 0 after setMode('vote') and
 * setMode('view') (no lock node in the uiGroup), 1 again right after
 * setMode('edit'), also at LOD 2; a scene built in mode vote paints none.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { installDom } from './fakeDom.mjs'

const L = '01JA00000000000000000000L1'
const B = '01JA0000000000000000000002'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })
const note = (id, o = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: id }, style: { fill: '#a8d8f8' }, ...o })

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
 * @param {object} [opts] SceneManager options (mode)
 * @return {SceneManager}
 */
function mount(opts = {}) {
	dom = installDom()
	Konva.isBrowser = true
	globalThis.window.document = dom.doc
	dom.doc.addEventListener = () => {}
	dom.doc.removeEventListener = () => {}
	const create = dom.doc.createElement.bind(dom.doc)
	dom.doc.createElement = (tag) => {
		const el = create(tag)
		// Konva's destroy takes its content out of the container
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
	const model = new SceneModel()
	model.load([note(L, { x: 100, y: 100, lock: LOCK }), note(B, { x: 400, y: 100, z: 'a2' })])
	scene = new SceneManager(container, model, opts)
	scene.mount()
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	frames()
	return scene
}

/** Runs a few animation frames (the scene draws dirty layers in its frame). */
function frames(n = 3) {
	for (let i = 0; i < n; i++) dom.frame()
}

test('stats().locks: 1 in mode edit, 0 after setMode(vote) and setMode(view), 1 again right after setMode(edit)', () => {
	mount()
	assert.equal(scene.stats().locks, 1, 'edit: the symbol on L')
	const ui = scene.stats().uiChildren
	scene.setMode('vote')
	frames()
	assert.equal(scene.stats().locks, 0, 'vote: no symbol')
	assert.equal(scene.stats().uiChildren, ui - 1, 'vote: no lock node in the uiGroup')
	scene.setMode('view')
	frames()
	assert.equal(scene.stats().locks, 0, 'view: no symbol')
	assert.equal(scene.stats().uiChildren, ui - 1)
	scene.setMode('edit')
	frames(1)
	assert.equal(scene.stats().locks, 1, 'back in edit: at once (the next frame)')
	assert.equal(scene.stats().uiChildren, ui)
})

test('at LOD 2 the same: 1 in edit, 0 in vote, 1 again in edit', () => {
	mount()
	scene.setCamera({ x: -2000, y: -2000, scale: 0.05 })
	frames()
	assert.equal(scene.stats().lod, 2)
	assert.equal(scene.stats().locks, 1)
	scene.setMode('vote')
	frames()
	assert.equal(scene.stats().locks, 0)
	scene.setMode('edit')
	frames(1)
	assert.equal(scene.stats().locks, 1)
})

test('a scene built in mode vote paints no symbol; setMode(edit) brings it', () => {
	mount({ mode: 'vote' })
	assert.equal(scene.stats().locks, 0)
	scene.setMode('edit')
	frames(1)
	assert.equal(scene.stats().locks, 1)
})
