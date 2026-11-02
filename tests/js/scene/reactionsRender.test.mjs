/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 172 AK5) The reaction rows with the REAL KonvaRenderer (the scaffold
 * of lockModes.test.mjs: Konva on the fake DOM, canvases whose 2D context
 * records nothing; this file never imports sceneHarness.mjs): stats()
 * .reactions lists the rows the last painting drew ({id, shown, more, add}),
 * none below LOD_TEXT_SCALE; a change of the reactions alone redraws only
 * the overlay; the outline of the one selected note reaches REACT_BAND + 4
 * px below it while it shows a row, as before without one. (job 183 AK5)
 * With touch in mode vote every note in view has a row with the button.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { LOD_TEXT_SCALE, REACT_BAND } from '../../../src/model/tokens.js'
import { installDom } from './fakeDom.mjs'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'
const C = '01JA0000000000000000000003'
const ME = 'a1b2c3d4e5f60718'
const note = (id, o = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: id }, style: { fill: '#a8d8f8' }, ...o })
const REACT = { [`p${ME}`]: { e: '1f44d', n: 'Vic' }, pbbbbbbbbbbbbbbbb: { e: '2764-fe0f', n: 'Bob' } }
const items = () => [note(A, { x: 100, y: 100, data: { text: 'A', react: structuredClone(REACT) } }), note(B, { x: 400, y: 100, z: 'a2' })]

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
/** the model of the mounted scene */
let sceneModel = null
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
 * @param {object} [opts] SceneManager options (mode)
 * @return {SceneManager}
 */
function mount(items, opts = {}) {
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
	model.load(items)
	sceneModel = model
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

test('stats().reactions: the painted rows; the button only where one may react; none below LOD_TEXT_SCALE', () => {
	mount(items())
	assert.deepEqual(scene.stats().reactions, [{ id: A, shown: [['1f44d', 1, false], ['2764-fe0f', 1, false]], more: 0, add: false }],
		'before the session part: everybody sees the pills, nothing is mine, no button')
	scene.setReactions({ canReact: true, me: ME })
	frames()
	assert.deepEqual(scene.stats().reactions, [{ id: A, shown: [['1f44d', 1, true], ['2764-fe0f', 1, false]], more: 0, add: true }])
	scene.setReactions({ canReact: false, me: ME })
	frames()
	assert.deepEqual(scene.stats().reactions, [{ id: A, shown: [['1f44d', 1, true], ['2764-fe0f', 1, false]], more: 0, add: false }], 'view: the pills, no button')
	scene.setReactions({ canReact: true, me: null })
	frames()
	assert.equal(scene.stats().reactions[0].shown[0][2], false, 'without the own pid nothing is mine')
	scene.setCamera({ x: 0, y: 0, scale: 0.25 })
	frames()
	assert.deepEqual(scene.stats().reactions, [], 'LOD 1: no row')
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	frames()
	assert.equal(scene.stats().reactions.length, 1)
})

test('job 183 AK5: mode vote with touch: stats().reactions lists every note in view with the button; none below LOD_TEXT_SCALE', () => {
	mount([...items(), note(C, { x: 2000, y: 100, z: 'a3' })], { mode: 'vote' })
	scene.setReactions({ canReact: true, me: ME, touch: true })
	frames()
	assert.deepEqual(scene.stats().reactions, [
		{ id: A, shown: [['1f44d', 1, true], ['2764-fe0f', 1, false]], more: 0, add: true },
		{ id: B, shown: [], more: 0, add: true },
	], 'A and B in view (C is not), the button at both')
	scene.setCamera({ x: 0, y: 0, scale: LOD_TEXT_SCALE - 0.01 })
	frames()
	assert.deepEqual(scene.stats().reactions, [], 'below LOD_TEXT_SCALE: no row, no button')
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	frames()
	assert.equal(scene.stats().reactions.length, 2)
	scene.setMode('edit')
	frames()
	assert.deepEqual(scene.stats().reactions.map((r) => [r.id, r.add]), [[A, true]], 'mode edit: as before')
	scene.setMode('view')
	scene.setReactions({ canReact: true, me: ME, touch: false })
	frames()
	assert.deepEqual(scene.stats().reactions.map((r) => [r.id, r.add]), [[A, true]], 'without a touch screen: as before')
})

test('a reaction that arrives redraws only the overlay; the selected note\'s outline reaches the band (32 + 4 px), without a band as before', () => {
	const sc = mount(items())
	sc.setReactions({ canReact: true, me: ME })
	frames()
	const draws = sc.stats().draws
	const it = { ...items()[1], data: { ...items()[1].data, react: { pbbbbbbbbbbbbbbbb: { e: '1f602', n: 'Bob' } } } }
	const summary = sceneModel.apply({ upserts: [it], removes: [] })
	assert.deepEqual([...summary.updated.get(B)], ['react'], 'the reactions are a change field of their own')
	sc.update(summary)
	frames()
	const after = sc.stats()
	assert.equal(after.draws.static, draws.static, 'no static draw')
	assert.ok(after.draws.overlay > draws.overlay)
	assert.deepEqual(after.reactions.map((r) => r.id), [A, B])
	// the outline of the one selected note
	sc.setSelection([A])
	frames()
	const local = sc.stats().outlines.find((o) => o.kind === 'local')
	assert.deepEqual([local.x, local.y, local.w, local.h], [96, 96, 208, 208 + REACT_BAND])
	sc.setReactions({ canReact: false, me: ME })
	sc.setSelection([A])
	frames()
	const pills = sc.stats().outlines.find((o) => o.kind === 'local')
	assert.deepEqual([pills.w, pills.h], [208, 208 + REACT_BAND], 'the pills alone keep the band')
	sceneModel.apply({ upserts: [{ ...items()[0], data: { text: 'A' } }], removes: [] })
	sc.update({ added: [], removed: [], updated: new Map([[A, new Set(['react'])]]), geometry: new Set(), reordered: false })
	frames()
	const plain = sc.stats().outlines.find((o) => o.kind === 'local')
	assert.deepEqual([plain.x, plain.y, plain.w, plain.h], [96, 96, 208, 208], 'no row: as today')
	sc.setSelection([A, B])
	frames()
	assert.ok(sc.stats().outlines.filter((o) => o.kind === 'local').every((o) => o.h === 208), 'a multi selection keeps its frames')
})
