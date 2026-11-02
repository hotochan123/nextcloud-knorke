/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Factory job 188 (AK5): note pads in the scene, on the real SceneManager,
 * InputController, GestureController, TextEditor and SceneModel with the
 * recording renderer stub (sceneHarness.mjs; camera at the origin, scale 1:
 * container px = world units). The pad P lies at (100, 100), 200 × 200;
 * job 263 (B4): its binding is y 100–136, the grip ('band') reaches down to
 * the tear line at y 142, the pile below it and the sheets down to y 312.
 * - a drag from the pile shows the preview note (the renderer's
 *   setNotePreview, stats().notePreview) and its release gives ONE takeNote
 *   with at = the pile's corner plus the way; the pointerdown changes no
 *   selection; Esc ends it without an intent; a click and a double click on
 *   the pile give nothing and keep the selection
 * - a locked pad: the pile still gives takeNote (the mouse, a finger that
 *   is claimed, no pan), a drag on its band moves nothing
 * - the band: a click selects, a drag moves, a double click opens the
 *   editor kind padTitle over the band (one line, Enter ends it)
 * - Enter at the selected pad gives takeNote with at null (locked too); in
 *   modes vote and view nothing, neither from the pile
 * - hit and index box take in the sheets and the band (bboxOf, hitTest)
 * - a selected pad: four corner handles, no rotation handle, no "+"
 * - the cursor copy over the pile; the note tool's type pad creates a pad
 *   at a click and is sticky again afterwards
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch } from './fakeDom.mjs'
import { callsOf, note, setupScene } from './sceneHarness.mjs'
import { TAP_SLOP_PX } from '../../../src/scene/GestureController.js'
import { HIT_TOL_MOUSE_PX } from '../../../src/scene/InputController.js'
import { coarseLook } from '../../../src/scene/nodes/coarse.js'
import { nodeSpecFor } from '../../../src/scene/nodes/index.js'
import { pad as padSpec } from '../../../src/scene/nodes/pad.js'
import { padPartAt } from '../../../src/model/pad.js'
import { PAD_TITLE_SIZE, frameTabFill, frameTabText, withAlpha } from '../../../src/model/tokens.js'
import { STICKY_PAD } from '../../../src/model/SceneModel.js'

const P = '01JA00000000000000000000P1'
const N = '01JA00000000000000000000N1'
const LOCK = Object.freeze({ by: 'pidcarol00000001', name: 'Carol' })

/** The pad P at (100, 100), 200 × 200, with a title. */
const padItem = (o = {}) => ({ id: P, t: 'pad', x: 100, y: 100, w: 200, h: 200, r: 0, z: 'a5', parent: null, data: { title: 'Ideen' }, style: { fill: '#faea89' }, ...o })

let h = null
afterEach(() => {
	h?.restore()
	h = null
})

/** @param {object[]} [items] WireItems @param {object} [opts] setupScene options @return {object} harness */
function setup(items = [padItem()], opts = {}) {
	h = setupScene(items, opts)
	h.frame()
	return h
}

/** A mouse press along a path: down, moves (each with a frame), up. */
function drag(path, props = {}) {
	const [x0, y0] = path[0]
	h.pointer('pointerdown', x0, y0, props)
	for (const [x, y] of path.slice(1)) {
		h.pointer('pointermove', x, y, props)
		h.frame()
	}
	const [x1, y1] = path[path.length - 1]
	h.pointer('pointerup', x1, y1, props)
	h.frame()
}

const click = (x, y, props = {}) => drag([[x, y]], props)
const finger = { pointerType: 'touch', pointerId: 7 }
const editor = () => h.container.descendants().find((el) => el.tagName === 'TEXTAREA' && el.hasAttribute('data-knorke-editor')) ?? null
const cursor = () => h.scene.renderer.contentEl.style.cursor

describe('job 188 AK5: a note off the pile', () => {
	test('a drag from the pile: the preview note under the pointer, its release ONE takeNote at the pile\'s corner plus the way; the selection stays', () => {
		setup([padItem(), note(N, { x: 600, y: 100 })])
		click(700, 200)
		assert.deepEqual(h.scene.getSelection(), [N])
		h.log.length = 0
		h.pointer('pointerdown', 150, 160)
		assert.deepEqual(h.scene.getSelection(), [N], 'the pointerdown changes nothing')
		assert.equal(h.scene.stats().notePreview, null, 'no preview below the threshold')
		h.pointer('pointermove', 250, 300)
		h.frame()
		assert.deepEqual(h.scene.stats().notePreview, { id: P, x: 200, y: 240, w: 200, h: 200 })
		assert.deepEqual(callsOf('setNotePreview').at(-1), [{ x: 200, y: 240, w: 200, h: 200, fill: '#faea89' }], 'the pad\'s size and fill')
		assert.equal(cursor(), 'copy')
		assert.deepEqual(h.intents(), [], 'others see nothing until the release')
		h.pointer('pointermove', 450, 560)
		h.frame()
		h.pointer('pointerup', 450, 560)
		h.frame()
		assert.deepEqual(h.intents(), [{ type: 'takeNote', id: P, at: { x: 400, y: 500 } }])
		assert.equal(h.scene.stats().notePreview, null)
		assert.deepEqual(callsOf('setNotePreview').at(-1), [null])
		assert.deepEqual(h.model.abs(P), { x: 100, y: 100, w: 200, h: 200, r: 0 }, 'the pad stays')
		assert.deepEqual(h.scene.getSelection(), [N], 'the selection is the session\'s then')
		assert.equal(h.log.filter((e) => e[0] === 'onSelection').length, 0)
	})

	test('a click (no drag beyond the threshold) gives no intent and keeps the selection; a double click on the pile opens nothing; Esc during the drag ends it without an intent', () => {
		setup([padItem(), note(N, { x: 600, y: 100 })])
		click(700, 200)
		h.log.length = 0
		drag([[150, 160], [152, 161]])
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.scene.getSelection(), [N])
		const p = { clientX: 150, clientY: 160 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		assert.equal(editor(), null, 'no editor on the pile')
		assert.deepEqual(h.intents(), [])
		assert.deepEqual(h.scene.getSelection(), [N])
		h.pointer('pointerdown', 150, 160)
		h.pointer('pointermove', 300, 300)
		h.frame()
		assert.notEqual(h.scene.stats().notePreview, null)
		h.key('Escape')
		h.pointer('pointerup', 300, 300)
		h.frame()
		assert.deepEqual(h.intents(), [], 'Esc: no note')
		assert.equal(h.scene.stats().notePreview, null)
	})

	test('a locked pad: the pile gives takeNote; a drag on the band moves nothing; a finger on the pile is claimed (no pan) and takes a note', () => {
		setup([padItem({ lock: LOCK })])
		drag([[200, 200], [260, 260], [300, 300]])
		assert.deepEqual(h.intents(), [{ type: 'takeNote', id: P, at: { x: 200, y: 200 } }])
		h.log.length = 0
		drag([[200, 120], [400, 500], [500, 600]])
		assert.deepEqual(h.intents('move'), [], 'the band of a locked pad does not move it')
		assert.deepEqual(h.model.abs(P), { x: 100, y: 100, w: 200, h: 200, r: 0 })
		h.log.length = 0
		const cam = h.scene.getCamera()
		h.pointer('pointerdown', 200, 200, finger)
		h.pointer('pointermove', 200 + TAP_SLOP_PX - 1, 200, finger)
		h.frame()
		assert.equal(h.scene.stats().notePreview, null, 'a finger within TAP_SLOP_PX: nothing yet')
		h.pointer('pointermove', 260, 280, finger)
		h.frame()
		h.pointer('pointerup', 260, 280, finger)
		h.frame()
		assert.deepEqual(h.intents(), [{ type: 'takeNote', id: P, at: { x: 160, y: 180 } }])
		assert.deepEqual(h.scene.getCamera(), cam, 'the finger did not pan')
	})

	test('the band: a click selects the pad, a drag moves it; a double click opens padTitle over the band, one line, Enter ends it with the title', () => {
		setup()
		click(200, 120)
		assert.deepEqual(h.scene.getSelection(), [P])
		h.log.length = 0
		drag([[200, 120], [260, 150], [300, 170]])
		const mv = h.intents('move')
		assert.equal(mv.length, 1)
		assert.deepEqual([mv[0].ids, mv[0].dx, mv[0].dy], [[P], 100, 50])
		h.log.length = 0
		h.model.apply({ upserts: [padItem()] })
		h.scene.update({ added: [], removed: [], updated: new Map([[P, new Set(['geom'])]]), geometry: new Set([P]), reordered: false })
		h.frame()
		const p = { clientX: 200, clientY: 120 }
		for (let i = 0; i < 2; i++) {
			dispatch(h.container, 'pointerdown', p)
			dispatch(h.container, 'pointerup', p)
		}
		dispatch(h.container, 'dblclick', p)
		h.frame()
		const ta = editor()
		assert.ok(ta, 'the title editor')
		assert.equal(ta.getAttribute('data-knorke-editor-kind'), 'padTitle')
		assert.equal(ta.value, 'Ideen')
		assert.match(ta.style.getPropertyValue('transform'), /translate\(112px, 100px\)/, 'job 263: on the binding, 12 inside')
		assert.equal(ta.style.getPropertyValue('width'), '176px')
		assert.equal(ta.style.getPropertyValue('height'), '36px')
		assert.equal(ta.style.getPropertyValue('font-size'), PAD_TITLE_SIZE + 'px')
		assert.equal(ta.style.getPropertyValue('font-weight'), 'bold')
		assert.equal(ta.style.getPropertyValue('text-align'), 'left')
		assert.equal(ta.style.getPropertyValue('white-space'), 'pre')
		ta.value = 'Neue Ideen'
		dispatch(ta, 'input')
		const k = dispatch(ta, 'keydown', { key: 'Enter', shiftKey: true })
		assert.ok(k.defaultPrevented, 'one line: Shift+Enter ends it too')
		h.frame()
		assert.equal(editor(), null)
		assert.deepEqual(h.intents('text').at(-1), { type: 'text', id: P, path: 'data.title', value: 'Neue Ideen', before: 'Ideen', final: true })
	})

	test('Enter at the one selected pad gives takeNote with at null, locked too, never its editor; in modes vote and view nothing', () => {
		setup([padItem({ lock: LOCK })])
		h.scene.setSelection([P])
		h.focusCanvas()
		h.log.length = 0
		const e = h.key('Enter')
		assert.ok(e.defaultPrevented)
		assert.deepEqual(h.intents(), [{ type: 'takeNote', id: P, at: null }])
		assert.equal(editor(), null)
		for (const mode of ['vote', 'view']) {
			h.scene.setMode(mode)
			h.log.length = 0
			h.key('Enter')
			drag([[200, 200], [300, 300], [400, 400]])
			assert.deepEqual(h.intents().filter((i) => i.type === 'takeNote'), [], mode)
			assert.equal(h.scene.stats().notePreview, null, mode + ': no preview')
			h.scene.setMode('edit')
		}
	})

	test('a mode switch during the drag ends it without an intent, settled too', () => {
		setup()
		for (const settle of [false, true]) {
			h.log.length = 0
			h.pointer('pointerdown', 150, 160)
			h.pointer('pointermove', 300, 300)
			h.frame()
			assert.notEqual(h.scene.stats().notePreview, null)
			h.scene.setMode('vote', { settle })
			h.pointer('pointerup', 300, 300)
			h.frame()
			assert.deepEqual(h.intents(), [], 'settle ' + settle)
			assert.equal(h.scene.stats().notePreview, null)
			h.scene.setMode('edit')
		}
	})
})

describe('job 188 AK5: hit, index box, handles, cursor, the tool', () => {
	test('job 263 AK4: hit box (0, 0)–(w, h + 12), index box plus the shadow; the grip down to the tear line, the pile below', () => {
		setup()
		assert.deepEqual(h.model.bboxOf(P), { minX: 100 - STICKY_PAD, minY: 100 - STICKY_PAD, maxX: 300 + STICKY_PAD, maxY: 312 + STICKY_PAD })
		assert.equal(h.model.hitTest(200, 310), P, 'the sheets below the box')
		assert.equal(h.model.hitTest(305, 200), null, 'nothing right of the box (sheets straight down)')
		assert.equal(h.model.hitTest(200, 330), null, 'the old band below the pad is canvas now')
		assert.equal(h.model.hitTest(200, 314, HIT_TOL_MOUSE_PX), P, 'with the tolerance')
		assert.deepEqual([padPartAt(100, 20, 200, 200), padPartAt(100, 42, 200, 200), padPartAt(100, 43, 200, 200), padPartAt(100, 205, 200, 200), padPartAt(100, 230, 200, 200), padPartAt(210, 100, 200, 200)], ['band', 'band', 'stack', 'stack', null, null])
		assert.deepEqual([padPartAt(50, 20, 100, 100), padPartAt(50, 21, 100, 100), padPartAt(50, 22, 100, 100)], ['band', 'band', 'stack'], 'a pad 100 high: the tear line at 21')
	})

	test('job 263 risk: a finger on the grip just above the tear line selects, just below it takes a note', () => {
		setup()
		h.pointer('pointerdown', 200, 140, finger)
		h.pointer('pointerup', 200, 140, finger)
		h.frame()
		assert.deepEqual(h.scene.getSelection(), [P], 'y 140 (ly 40): the grip')
		h.log.length = 0
		drag([[200, 160], [260, 220], [300, 260]], finger)
		assert.equal(h.intents('takeNote').length, 1, 'y 160 (ly 60): the pile')
		assert.deepEqual(h.intents('move'), [])
	})

	test('a selected pad: four corner handles at the pile, no rotation handle, no "+"', () => {
		setup()
		h.scene.setSelection([P])
		h.frame()
		assert.deepEqual(h.scene.handles().map((x) => x.name).sort(), ['bl', 'br', 'tl', 'tr'])
	})

	test('the cursor copy over the pile (mouse hover), not over the band', () => {
		setup()
		h.pointer('pointermove', 200, 200, { buttons: 0 })
		assert.equal(cursor(), 'copy')
		h.pointer('pointermove', 200, 120, { buttons: 0 })
		assert.equal(cursor(), 'default')
		h.pointer('pointermove', 200, 200, { buttons: 0 })
		dispatch(h.container, 'pointerleave', { pointerType: 'mouse' })
		assert.equal(cursor(), 'default')
	})

	test('the note tool with type pad: a click creates a pad centred on the point, then select and the type sticky again', () => {
		setup([])
		h.scene.setTool('sticky', { type: 'pad' })
		assert.deepEqual(h.scene.getToolOptions('sticky'), { type: 'pad' })
		click(500, 400)
		assert.deepEqual(h.intents('create'), [{ type: 'create', t: 'pad', at: { x: 500, y: 400 }, rect: null }])
		assert.equal(h.scene.getTool(), 'select')
		assert.deepEqual(h.scene.getToolOptions('sticky'), { type: 'sticky' })
		h.scene.setTool('sticky')
		click(100, 100)
		assert.equal(h.intents('create').at(-1).t, 'sticky')
		// another tool resets it too, and options given with the tool apply after that
		h.scene.setTool('sticky', { type: 'pad' })
		h.scene.setTool('shape')
		assert.deepEqual(h.scene.getToolOptions('sticky'), { type: 'sticky' })
		h.scene.setTool('sticky', { type: 'pad' })
		assert.deepEqual(h.scene.getToolOptions('sticky'), { type: 'pad' })
	})

	test('job 263 AK1–AK3, AK7: the node in the look B4: four sheets below, the binding with the title, the line and the tear line; LOD 1 without title and shadow; a small pad scales', () => {
		const built = []
		class Node {
			constructor(a = {}) {
				this.attrs = { ...a }
				this.kids = []
				built.push(this)
			}

			setAttrs(a) { Object.assign(this.attrs, a) }
			getAttr(k) { return this.attrs[k] }
			visible(v) { this.attrs.visible = v }
			text(v) { this.attrs.text = v }
			fill(v) { this.attrs.fill = v }
			transformsEnabled() {}
			add(...k) { this.kids.push(...k) }
		}
		const ctx = { Group: class extends Node {}, Rect: class extends Node {}, Text: class extends Node {}, Shape: class extends Node {}, Line: class extends Node {}, shadows: true }
		assert.equal(nodeSpecFor('pad'), padSpec)
		// AK7: an old colour (#f5d76e of the 0.1–0.4 palette) is drawn as its nearest light tone, yellow #faea89
		const e = padSpec.build(ctx, padItem({ style: { fill: '#f5d76e' } }), { x: 100, y: 100, w: 200, h: 200, r: 0 }, 0, false)
		const { shade, sheets, body, band, line, tear, text } = e.parts
		const strong = '#7e6f01'
		assert.deepEqual(sheets.map((s) => [s.attrs.x, s.attrs.y, s.attrs.width, s.attrs.height, s.attrs.fill, s.attrs.stroke]),
			[12, 9, 6, 3].map((y) => [0, y, 200, 200, '#faea89', withAlpha(strong, 0.18)]))
		assert.deepEqual([body.attrs.width, body.attrs.height, body.attrs.fill, body.attrs.stroke, body.attrs.cornerRadius], [200, 200, '#faea89', withAlpha(strong, 0.18), 6])
		assert.deepEqual([band.attrs.x, band.attrs.y, band.attrs.width, band.attrs.height, band.attrs.fill, band.attrs.cornerRadius], [0, 0, 200, 36, frameTabFill('#faea89'), [6, 6, 0, 0]])
		assert.deepEqual([line.attrs.points, line.attrs.stroke, line.attrs.strokeWidth], [[0, 36, 200, 36], withAlpha(strong, 0.35), 1])
		assert.deepEqual([tear.attrs.points, tear.attrs.stroke, tear.attrs.strokeWidth, tear.attrs.dash], [[8, 42, 192, 42], withAlpha(strong, 0.4), 1, [4, 4]])
		assert.deepEqual([text.attrs.text, text.attrs.x, text.attrs.y, text.attrs.width, text.attrs.height, text.attrs.align, text.attrs.fontStyle, text.attrs.wrap, text.attrs.ellipsis, text.attrs.fontSize, text.attrs.fill],
			['Ideen', 12, 0, 176, 36, 'left', 'bold', 'none', true, 16, frameTabText(frameTabFill('#faea89'))])
		assert.deepEqual([shade.attrs.y, shade.attrs.visible], [12, true], 'the shadow under the bottom sheet only')
		assert.deepEqual(e.root.kids, [shade, ...sheets, body, band, line, tear, text], 'back to front')
		const lowest = Math.max(...sheets.map((s) => s.attrs.y + s.attrs.height))
		assert.equal(lowest, 212, 'nothing below y 212')
		// AK1: white: edges in gray #6f6f6d; black: the title white
		const white = padSpec.build(ctx, padItem({ style: { fill: '#ffffff' } }), { x: 0, y: 0, w: 200, h: 200, r: 0 }, 0, false)
		assert.equal(white.parts.body.attrs.stroke, withAlpha('#6f6f6d', 0.18))
		assert.equal(white.parts.tear.attrs.stroke, withAlpha('#6f6f6d', 0.4))
		const black = padSpec.build(ctx, padItem({ style: { fill: '#191b1d' } }), { x: 0, y: 0, w: 200, h: 200, r: 0 }, 0, false)
		assert.equal(black.parts.text.attrs.fill, '#ffffff')
		assert.equal(black.parts.band.attrs.fill, '#36383b')
		assert.equal(black.parts.line.attrs.stroke, withAlpha('#191b1d', 0.35))
		// AK2: LOD 1 no title, no shadow, the binding stays
		padSpec.setLod(ctx, e, padItem(), { x: 100, y: 100, w: 200, h: 200, r: 0 }, 1)
		assert.deepEqual([text.attrs.visible, shade.attrs.visible, band.attrs.visible], [false, false, undefined], 'LOD 1')
		padSpec.setLod(ctx, e, padItem(), { x: 100, y: 100, w: 200, h: 200, r: 0 }, 0)
		assert.deepEqual([text.attrs.visible, shade.attrs.visible], [true, true], 'back at LOD 0')
		const lod1 = padSpec.build(ctx, padItem(), { x: 0, y: 0, w: 200, h: 200, r: 0 }, 1, false)
		assert.deepEqual([lod1.parts.text, lod1.parts.shade.attrs.visible], [null, false])
		// AK3: a resize and a recolour update every part in place; a pad 100 high scales its top by 0.5
		const n = built.length
		assert.equal(padSpec.update(ctx, e, padItem({ w: 100, h: 100, style: { fill: '#a2d9fe' } }), { x: 100, y: 100, w: 100, h: 100, r: 0 }, new Set(['geom', 'style'])), false)
		assert.equal(built.length, n, 'no new node')
		assert.deepEqual([sheets[0].attrs.width, sheets[0].attrs.y, body.attrs.fill, band.attrs.width, band.attrs.height, band.attrs.fill], [100, 12, '#a2d9fe', 100, 18, frameTabFill('#a2d9fe')])
		assert.deepEqual([line.attrs.points, tear.attrs.points, line.attrs.stroke], [[0, 18, 100, 18], [4, 21, 96, 21], withAlpha('#0275a9', 0.35)])
		assert.deepEqual([text.attrs.x, text.attrs.width, text.attrs.height, text.attrs.fontSize], [6, 88, 18, 8])
		assert.deepEqual(coarseLook(padItem()), { cls: 'box', color: '#faea89', title: '' })
	})
})
