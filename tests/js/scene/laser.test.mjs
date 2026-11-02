/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 171, the laser pointer in the scene (real SceneManager,
 * InputController, GestureController and SceneModel on the fake DOM, the
 * renderer stubbed; the fake clock behind performance.now()):
 * - AK2: mouse, pen and finger, over an item and over empty canvas: the tool
 *   stays 'laser', no onIntent, no onSelection, selection and camera stay;
 *   onLaser gives the points (world) and null at the end. Esc during a press
 *   gives onLaser(null) and chooses 'select', the selection stays.
 * - AK3: a second finger ends the finger's stroke and pinches; a pen press
 *   ends a finger's stroke; a right-drag pans without points; held still
 *   ≥ 1 point per 100 ms; setMode('vote') ends the stroke, and in vote and
 *   view a press gives no points.
 * - AK4: stats().lasers holds 'self' during the stroke and until 1000 ms
 *   after the last point, then not (and the loop stops); a trail of someone
 *   else wholly outside the view is neither listed nor adds an overlay
 *   element. The drawing: 4 px line, 12 px glow, 8 px tip at every zoom, in
 *   the colours of setLaserColor and of the samples, at the camera shown.
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { note, setupScene } from './sceneHarness.mjs'
import { LASER_BEAT_MS } from '../../../src/scene/SceneManager.js'
import { FADE } from '../../../src/scene/LaserLayer.js'

const A = '01JA0000000000000000000001'
const B = '01JA0000000000000000000002'

/** A at (100, 100), B at (600, 100), both 200 × 200; empty canvas below them. */
const notes = () => [note(A, { x: 100, y: 100 }), note(B, { x: 600, y: 100, z: 'a2' })]

const MOUSE = Object.freeze({ pointerType: 'mouse', pointerId: 1 })
const PEN = Object.freeze({ pointerType: 'pen', pointerId: 9 })
const finger = (id = 5) => ({ pointerType: 'touch', pointerId: id })
const DEVICES = [['mouse', MOUSE], ['pen', PEN], ['finger', finger(5)]]

let h = null
/** [p, time] of every onLaser */
let calls = []
afterEach(() => {
	h?.restore()
	h = null
	calls = []
})

/**
 * @param {object} [scene] SceneManager options
 * @return {object} harness with the laser tool chosen, selection [A], log cleared
 */
function setup(scene = {}) {
	h = setupScene(notes(), { scene, on: { onLaser: (p) => calls.push([p === null ? null : { x: p.x, y: p.y }, performance.now()]) } })
	h.scene.setSelection([A])
	h.scene.setTool('laser')
	h.log.length = 0
	return h
}

/** @return {Array<object|null>} the onLaser values in order */
const laser = () => calls.map((c) => c[0])
const of = (name) => h.log.filter((e) => e[0] === name)

/** One stroke of dev: down at path[0], a move (and a frame) for every further point, up at the last. */
function stroke(dev, path) {
	const [x0, y0] = path[0]
	h.pointer('pointerdown', x0, y0, dev)
	h.frame()
	for (const [x, y] of path.slice(1)) {
		h.pointer('pointermove', x, y, dev)
		h.frame()
	}
	const [x1, y1] = path[path.length - 1]
	h.pointer('pointerup', x1, y1, dev)
	h.frame()
}

describe('AK2: a stroke selects, moves and creates nothing; the tool stays', () => {
	for (const [name, dev] of DEVICES) {
		for (const [where, start] of [['over note A', [200, 200]], ['over empty canvas', [500, 600]]]) {
			test(`${name} ${where}`, () => {
				setup()
				const cam = h.scene.getCamera()
				const [x, y] = start
				stroke(dev, [[x, y], [x + 20, y + 10], [x + 60, y + 30]])
				assert.equal(h.scene.getTool(), 'laser', 'the tool stays')
				assert.deepEqual(of('onIntent'), [], 'no intent')
				assert.deepEqual(of('onSelection'), [], 'no onSelection')
				assert.deepEqual(h.scene.getSelection(), [A], 'the selection stays')
				assert.deepEqual(h.scene.getCamera(), cam, 'the camera stays')
				assert.equal(h.scene.stats().dragging, false)
				assert.deepEqual(laser(), [{ x, y }, { x: x + 20, y: y + 10 }, { x: x + 60, y: y + 30 }, null], 'the points in world units, null at the release')
			})
		}
	}

	test('Esc during a press: onLaser(null), the tool becomes select (onTool), the selection stays; the release adds nothing', () => {
		setup()
		h.pointer('pointerdown', 500, 600, MOUSE)
		h.pointer('pointermove', 520, 610, MOUSE)
		h.frame()
		h.key('Escape')
		assert.deepEqual(laser(), [{ x: 500, y: 600 }, { x: 520, y: 610 }, null])
		assert.equal(h.scene.getTool(), 'select')
		assert.deepEqual(of('onTool').map((e) => e[1]), ['select'])
		assert.deepEqual(h.scene.getSelection(), [A], 'Esc leaves the selection alone')
		assert.deepEqual(of('onSelection'), [])
		h.pointer('pointermove', 540, 620, MOUSE)
		h.pointer('pointerup', 540, 620, MOUSE)
		h.frame()
		assert.equal(laser().length, 3, 'nothing after Esc')
		assert.deepEqual(of('onIntent'), [])
	})

	test('Esc without a press goes back to select as well; the selection stays', () => {
		setup()
		h.focusCanvas()
		h.key('Escape')
		assert.equal(h.scene.getTool(), 'select')
		assert.deepEqual(h.scene.getSelection(), [A])
		assert.deepEqual(laser(), [], 'no stroke ran: no onLaser')
	})

	test('the cursor is a crosshair with the laser', () => {
		setup()
		assert.equal(h.scene.renderer.contentEl.style.cursor, 'crosshair')
	})

	test('another tool from the shell during a stroke ends it', () => {
		setup()
		h.pointer('pointerdown', 500, 600, MOUSE)
		h.scene.setTool('select')
		assert.deepEqual(laser(), [{ x: 500, y: 600 }, null])
		h.pointer('pointerup', 500, 600, MOUSE)
		assert.equal(laser().length, 2)
	})

	test('a missed pointerup (a move without a button) ends the stroke; the next press starts a new one', () => {
		setup()
		h.pointer('pointerdown', 500, 600, { ...MOUSE, buttons: 1 })
		h.pointer('pointermove', 510, 600, { ...MOUSE, buttons: 1 })
		h.pointer('pointermove', 520, 600, { ...MOUSE, buttons: 0 })
		assert.deepEqual(laser(), [{ x: 500, y: 600 }, { x: 510, y: 600 }, null])
		for (let t = 0; t < 300; t += 50) h.frame(50)
		assert.equal(laser().length, 3, 'no beat after it')
		stroke({ ...MOUSE, buttons: 1 }, [[300, 300], [310, 300]])
		assert.deepEqual(laser().slice(3), [{ x: 300, y: 300 }, { x: 310, y: 300 }, null])
	})

	test('a contextmenu during a stroke (pen held still) opens nothing; the stroke goes on', () => {
		setup()
		h.pointer('pointerdown', 500, 600, PEN)
		const e = dispatch(h.container, 'contextmenu', { clientX: 500, clientY: 600, button: 0, pointerId: 9, pointerType: 'pen' })
		assert.equal(e.defaultPrevented, true, 'no browser menu')
		assert.deepEqual(of('onIntent'), [], 'no contextMenu intent')
		h.pointer('pointermove', 510, 600, PEN)
		h.pointer('pointerup', 510, 600, PEN)
		assert.deepEqual(laser(), [{ x: 500, y: 600 }, { x: 510, y: 600 }, null])
	})
})

describe('AK3: fingers, pen, right-drag, holding still, modes', () => {
	test('a second finger ends the finger\'s stroke and the two fingers zoom; the tool stays', () => {
		setup()
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 400, 500, finger(5))
		h.pointer('pointermove', 450, 550, finger(5))
		h.frame()
		h.pointer('pointerdown', 600, 550, finger(6))
		assert.deepEqual(laser(), [{ x: 400, y: 500 }, { x: 450, y: 550 }, null], 'the second finger ends the stroke')
		h.pointer('pointermove', 700, 550, finger(6))
		h.frame()
		assert.equal(h.scene.stats().gestureActive, true, 'pinch on the CSS path')
		h.pointer('pointermove', 460, 550, finger(5))
		h.pointer('pointerup', 460, 550, finger(5))
		h.pointer('pointerup', 700, 550, finger(6))
		h.frame()
		assert.ok(h.scene.getCamera().scale > cam.scale, 'zoomed in')
		assert.equal(laser().length, 3, 'no point after the second finger')
		assert.equal(h.scene.getTool(), 'laser')
		assert.deepEqual(of('onIntent'), [])
	})

	test('a pen press ends a finger\'s stroke (resting palm); the pen draws its own', () => {
		setup()
		h.pointer('pointerdown', 100, 600, finger(5))
		h.pointer('pointermove', 120, 610, finger(5))
		h.frame()
		h.pointer('pointerdown', 500, 400, PEN)
		h.pointer('pointermove', 530, 420, PEN)
		h.frame()
		h.pointer('pointermove', 140, 620, finger(5))
		h.pointer('pointerup', 530, 420, PEN)
		h.pointer('pointerup', 140, 620, finger(5))
		h.frame()
		assert.deepEqual(laser(), [{ x: 100, y: 600 }, { x: 120, y: 610 }, null, { x: 500, y: 400 }, { x: 530, y: 420 }, null])
		assert.deepEqual(of('onIntent'), [])
	})

	for (const [name, dev] of [['mouse', { pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2 }], ['pen side button', { pointerType: 'pen', pointerId: 9, button: 2, buttons: 2 }]]) {
		test(`a right-drag (${name}) pans without points`, () => {
			setup()
			const cam = h.scene.getCamera()
			h.pointer('pointerdown', 500, 500, dev)
			for (let i = 1; i <= 10; i++) {
				h.pointer('pointermove', 500 - 20 * i, 500 - 10 * i, { ...dev, button: -1 })
				h.frame()
			}
			h.pointer('pointerup', 300, 400, { ...dev, buttons: 0 })
			h.frame()
			assert.deepEqual(laser(), [], 'no laser point')
			assert.notDeepEqual(h.scene.getCamera(), cam, 'panned')
			assert.equal(h.scene.getTool(), 'laser')
		})
	}

	test('the middle button and the space bar pan without points', () => {
		setup()
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 500, 500, { ...MOUSE, button: 1, buttons: 4 })
		h.pointer('pointermove', 450, 480, { ...MOUSE, button: -1, buttons: 4 })
		h.frame()
		h.pointer('pointerup', 450, 480, { ...MOUSE, button: 1, buttons: 0 })
		h.frame()
		h.focusCanvas()
		dispatch(h.container, 'keydown', { key: ' ', code: 'Space', repeat: false, isComposing: false })
		h.pointer('pointerdown', 500, 500, MOUSE)
		h.pointer('pointermove', 450, 480, MOUSE)
		h.frame()
		h.pointer('pointerup', 450, 480, MOUSE)
		dispatch(h.container, 'keyup', { key: ' ', code: 'Space' })
		h.frame()
		assert.deepEqual(laser(), [])
		assert.notDeepEqual(h.scene.getCamera(), cam)
	})

	test('held still: at least one point every 100 ms, at the same place', () => {
		setup()
		h.pointer('pointerdown', 500, 400, MOUSE)
		for (let t = 0; t < 1000; t += 16) h.frame(16)
		const pts = calls.filter((c) => c[0] !== null)
		assert.ok(pts.length >= 10, `${pts.length} points in 1 s`)
		for (let i = 1; i < pts.length; i++) {
			assert.ok(pts[i][1] - pts[i - 1][1] <= 100, `gap ${pts[i][1] - pts[i - 1][1]} ms`)
		}
		assert.ok(pts.every((c) => c[0].x === 500 && c[0].y === 400), 'the tip stands as a dot')
		assert.ok(LASER_BEAT_MS < 100)
		h.pointer('pointerup', 500, 400, MOUSE)
		assert.equal(laser().at(-1), null)
	})

	for (const settle of [false, true]) {
		test(`setMode('vote'${settle ? ', {settle}' : ''}) ends the stroke; in vote and view a press gives no points`, () => {
			setup()
			h.pointer('pointerdown', 500, 400, MOUSE)
			h.pointer('pointermove', 510, 400, MOUSE)
			h.frame()
			h.scene.setMode('vote', { settle })
			assert.deepEqual(laser(), [{ x: 500, y: 400 }, { x: 510, y: 400 }, null])
			h.pointer('pointerup', 510, 400, MOUSE)
			h.frame()
			for (const mode of ['vote', 'view']) {
				h.scene.setMode(mode)
				for (const [, dev] of DEVICES) stroke(dev, [[300, 600], [320, 610]])
			}
			assert.equal(laser().length, 3, 'no point in vote or view')
			assert.deepEqual(of('onIntent').filter((e) => e[1].type !== 'voteMiss'), [])
			for (let t = 0; t < 600; t += 100) h.frame(100)
			assert.equal(laser().length, 3, 'no beat after the end either')
		})
	}
})

describe('AK4: the trails on the screen', () => {
	test('stats().lasers has "self" during the stroke and until 1000 ms after the last point, then not; the loop stops', () => {
		setup()
		h.pointer('pointerdown', 500, 400, MOUSE)
		h.frame()
		assert.deepEqual(h.scene.stats().lasers, ['self'])
		h.pointer('pointermove', 540, 420, MOUSE)
		h.pointer('pointerup', 540, 420, MOUSE)
		const last = calls.filter((c) => c[0] !== null).at(-1)[1]
		h.frame()
		assert.deepEqual(h.scene.stats().lasers, ['self'], 'right after the release')
		while (performance.now() < last + FADE - 20) h.frame(16)
		h.frame(0)
		assert.deepEqual(h.scene.stats().lasers, ['self'], `${performance.now() - last} ms after the last point`)
		while (performance.now() <= last + FADE + 20) h.frame(16)
		assert.deepEqual(h.scene.stats().lasers, [], `${performance.now() - last} ms after the last point`)
		h.frame(16)
		assert.equal(h.dom.pendingFrames(), 0, 'no more frames once nothing is visible')
	})

	test('a trail of someone else wholly outside the view is not listed and adds no overlay element; one in view is', () => {
		setup()
		const far = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#2e7d32', guest: false, cursor: null, selection: [], drag: [], editing: null, editingHolder: false, view: null, laser: [[[5000, 5000, 400], [5100, 5050, 200], [5200, 5100, 0]]] }
		const before = h.container.descendants().length
		h.scene.setRemoteSampler(() => [far])
		h.frame()
		h.frame()
		assert.deepEqual(h.scene.stats().lasers, [], 'outside the view: not counted')
		assert.equal(h.container.descendants().length, before, 'no overlay element came')
		const near = { ...far, key: 'pidcarol:c2', pid: 'pidcarol', laser: [[[300, 300, 500], [350, 320, 100], [360, 330, 0]]] }
		h.scene.setRemoteSampler(() => [far, near])
		h.frame()
		assert.deepEqual(h.scene.stats().lasers, ['pidcarol:c2'])
		const old = { ...far, laser: undefined }
		h.scene.setRemoteSampler(() => [old])
		h.frame()
		assert.deepEqual(h.scene.stats().lasers, [], 'a sample without laser draws none')
	})
})

describe('the drawing (recording 2D context)', () => {
	/** Gives every new <canvas> a 2D context that records what is drawn. */
	function recordCanvas() {
		const ops = []
		const make = h.dom.doc.createElement.bind(h.dom.doc)
		h.dom.doc.createElement = (tag) => {
			const el = make(tag)
			if (tag === 'canvas') {
				const ctx = { globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '' }
				for (const name of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill']) {
					ctx[name] = (...args) => ops.push({ name, args, lineWidth: ctx.lineWidth, alpha: ctx.globalAlpha, stroke: ctx.strokeStyle, fill: ctx.fillStyle })
				}
				el.getContext = () => ctx
			}
			return el
		}
		return ops
	}

	test('own trail: 12 px glow under a 4 px line in the own colour, an 8 px tip, the same widths at zoom 2, at the camera shown', () => {
		setup()
		const ops = recordCanvas()
		h.scene.setLaserColor('#c62828')
		h.scene.setCamera({ x: 100, y: 50, scale: 2 })
		h.frame()
		h.pointer('pointerdown', 400, 300, MOUSE)
		h.frame(40)
		h.pointer('pointermove', 500, 300, MOUSE)
		h.frame(40)
		const canvas = h.container.descendants().find((el) => el.tagName === 'CANVAS')
		assert.ok(canvas, 'the canvas is in the overlay')
		assert.equal(canvas.style.getPropertyValue('z-index'), '2', 'over the items, under the cursors (3)')
		assert.equal(canvas.style.getPropertyValue('pointer-events'), 'none')
		const strokes = ops.filter((o) => o.name === 'stroke')
		assert.deepEqual([...new Set(strokes.map((o) => o.lineWidth))].sort((a, b) => a - b), [4, 12])
		assert.ok(strokes.every((o) => o.stroke === '#c62828'))
		assert.ok(strokes.filter((o) => o.lineWidth === 12).every((o) => o.alpha < 0.5), 'the glow is translucent')
		const arcs = ops.filter((o) => o.name === 'arc')
		assert.ok(arcs.length > 0 && arcs.every((o) => o.args[2] === 4), 'tip of 8 px')
		// the tip at the pointer: screen = (world − cam) · scale
		const tip = arcs.at(-1)
		assert.deepEqual([tip.args[0], tip.args[1]], [500, 300])
		assert.deepEqual(laser().at(-1), { x: 100 + 500 / 2, y: 50 + 300 / 2 }, 'the world point')
		h.pointer('pointerup', 500, 300, MOUSE)
	})

	test('a remote trail in its sample colour; pieces fade with age (older pieces fainter)', () => {
		setup()
		const ops = recordCanvas()
		const s = { key: 'pidbob:c1', pid: 'pidbob', name: 'Bob', color: '#2e7d32', guest: false, cursor: null, selection: [], drag: [], editing: null, editingHolder: false, view: null, laser: [[[100, 100, 900], [200, 100, 600], [300, 100, 300], [400, 100, 0]]] }
		h.scene.setRemoteSampler(() => [s])
		h.frame()
		const lines = ops.filter((o) => o.name === 'stroke' && o.lineWidth === 4)
		assert.ok(lines.every((o) => o.stroke === '#2e7d32'))
		const alphas = lines.map((o) => o.alpha)
		assert.deepEqual(alphas, [...alphas].sort((a, b) => a - b), 'from faint (old) to full (new)')
		assert.ok(alphas[0] <= 0.15 && alphas.at(-1) >= 0.65, alphas.join(', '))
		assert.deepEqual(h.scene.stats().lasers, ['pidbob:c1'])
	})
})
