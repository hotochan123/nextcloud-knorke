/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * (job 231, redesign V8, AK4, AK5) The handles with the REAL KonvaRenderer
 * (the scaffold of snapLabelsRender.test.mjs: Konva on the fake DOM,
 * canvases whose 2D context records nothing; this file never imports
 * sceneHarness.mjs):
 * - a selected note: four squares (knorke-handle) of 10 screen px with
 *   2-px corners, white with a 2-px border in the primary color of the
 *   container (--color-primary-element), no line to the rotation handle;
 *   the same size at zoom 2
 * - a pen: every handle, round points and rot, 14 px
 * - setSelectionColor recolors the handles drawn; stats().selectionColor
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import Konva from 'konva/lib/Core'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { HANDLE_FILL, HANDLE_STROKE_PX, SELECTION_COLOR } from '../../../src/model/tokens.js'
import { dispatch, installDom } from './fakeDom.mjs'

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9, `${msg ?? ''} ${a} ≈ ${b}`)
const A = '01JA0000000000000000000001'
const note = (id, o = {}) => ({ id, t: 'sticky', x: 100, y: 100, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: id }, style: { fill: '#a8d8f8' }, ...o })

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
let container = null
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
 * A mounted scene with the real renderer, camera at the origin, scale 1, note A selected; the
 * container's --color-primary-element is primary.
 *
 * @param {string} primary the theme's primary color
 * @return {SceneManager}
 */
function mount(primary = '#00679e') {
	dom = installDom()
	Konva.isBrowser = true
	globalThis.window.document = dom.doc
	dom.doc.addEventListener = () => {}
	dom.doc.removeEventListener = () => {}
	Object.defineProperty(globalThis, 'getComputedStyle', {
		value: () => ({ getPropertyValue: (n) => (n === '--color-primary-element' ? primary : '') }), configurable: true, writable: true,
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
	container = dom.doc.createElement('div')
	container.clientWidth = 1000
	container.clientHeight = 800
	dom.doc.body.appendChild(container)
	const model = new SceneModel()
	model.load([note(A)])
	scene = new SceneManager(container, model, {})
	scene.mount()
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	scene.setSelection([A])
	frames()
	return scene
}

function frames(n = 3) {
	for (let i = 0; i < n; i++) dom.frame()
}

/** @return {Map<string, object>} the handle nodes by handle name */
const handleNodes = () => new Map(scene.renderer.stage.find('.knorke-handle').map((n) => [n.name().split(' ')[1].slice('knorke-handle-'.length), n]))

test('a selected note: four circles of 12 px (job 262; squares of 10 before), white with a 2-px border in the primary color; no line to rot', () => {
	mount()
	const hs = handleNodes()
	assert.deepEqual([...hs.keys()].sort(), ['bl', 'br', 'tl', 'tr'])
	const br = hs.get('br')
	assert.deepEqual([br.width(), br.height(), br.cornerRadius()], [12, 12, 6])
	assert.deepEqual([br.fill(), br.stroke(), br.strokeWidth(), br.strokeScaleEnabled()], [HANDLE_FILL, '#00679e', HANDLE_STROKE_PX, false])
	// centred on the corner of the drawn frame (304, 304)
	assert.deepEqual([br.x() + 6, br.y() + 6], [304, 304])
	assert.equal(scene.renderer.stage.find('Line').length, 0, 'no line to the rotation handle')
	assert.equal(scene.renderer.stats().selectionColor, '#00679e')
})

test('zoom 2: the circles keep 12 screen px', () => {
	mount()
	scene.setCamera({ x: 0, y: 0, scale: 2 })
	frames()
	const br = handleNodes().get('br')
	close(br.width() * 2, 12, 'screen size')
	close(br.cornerRadius() * 2, 6, 'screen corner')
})

test('a pen hovering: everything round, the transformer handles 16 px, the points 14 (job 262)', () => {
	mount()
	dispatch(container, 'pointermove', { clientX: 700, clientY: 600, button: 0, buttons: 0, pointerId: 3, pointerType: 'pen' })
	frames()
	const hs = handleNodes()
	assert.deepEqual([...hs.keys()].sort(), ['bl', 'br', 'plus-b', 'plus-l', 'plus-r', 'plus-t', 'rot', 'tl', 'tr'])
	for (const [name, n] of hs) assert.equal(n.width(), name.startsWith('plus-') ? 14 : 16, name)
	assert.equal(hs.get('rot').cornerRadius(), 8)
	assert.equal(hs.get('plus-r').cornerRadius(), 7)
	assert.deepEqual([hs.get('plus-r').fill(), hs.get('plus-r').stroke()], [HANDLE_FILL, '#00679e'], 'a hollow point')
	assert.equal(hs.get('tl').cornerRadius(), 8)
})

test('a light primary color falls back to SELECTION_COLOR; setSelectionColor recolors the handles drawn', () => {
	mount('#e0f0ff')
	assert.equal(handleNodes().get('tl').stroke(), SELECTION_COLOR)
	scene.renderer.setSelectionColor('#123456')
	assert.equal(handleNodes().get('tl').stroke(), '#123456')
	assert.equal(scene.renderer.stats().selectionColor, '#123456')
})
