/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Shared harness of the M1 scene tests (helper, not a test file; the glob
 * only runs *.test.mjs): the real SceneManager, InputController,
 * GestureController, TextEditor, TransformController and SceneModel on the
 * fake DOM (fakeDom.mjs), with the Konva renderer replaced by a recording
 * stub (no canvas in Node). Every renderer call is logged in `rcalls`;
 * measureTextHeight answers lines × fontSize × 1.2 with a fixed glyph width,
 * so text heights are deterministic. lodLevel()/lodAt() answer the level set
 * with setStubLod() (0 after every setupScene; LOD 2 rules of SPEC-M1 §6.3).
 * coarseTitleAt() answers from the title rectangles of the last
 * paintStubCoarse(): the real planCoarse/paintCoarse of the whole board on
 * a recording context whose glyphs are GLYPH · font size wide (R14-13).
 * (job 158) measureTitleWidth(text) answers GLYPH · FRAME_TITLE_SIZE per
 * code point (14 world px), coarseTitleWidth(id) the width of id's
 * rectangle of the last paintStubCoarse() (null without one).
 * (job 177) measureShapeLines(item, abs) wraps the shape's text like
 * fakeTextHeight at its inner text box (nodes/shape.js shapeTextAttrs: width
 * and font size) and answers the line widths, GLYPH · font size per
 * character (fakeLineWidths; no cut at the box's height).
 * voteDrawn() answers what setStubVoteDrawn() set (undefined after every
 * setupScene: nothing painted), the counters of a badge painting (stage 3).
 * stats() carries the overscan setStubOverscan() set (M2, job 034; none
 * after every setupScene, as a renderer that reports no overscan).
 */
import { KonvaRenderer } from '../../../src/scene/KonvaRenderer.js'
import { coarseOrder, coarseTitleHit, paintCoarse, planCoarse } from '../../../src/scene/nodes/coarse.js'
import { SceneManager } from '../../../src/scene/SceneManager.js'
import { SceneModel } from '../../../src/model/SceneModel.js'
import { shapeTextAttrs } from '../../../src/scene/nodes/shape.js'
import { FRAME_TITLE_SIZE } from '../../../src/model/tokens.js'
import { dispatch, installDom } from './fakeDom.mjs'

/** Every call on the stubbed renderer: [name, ...args]. */
export const rcalls = []

/** Level of detail the stubbed renderer reports (lodLevel, lodAt). */
let stubLod = 0
/** Title rectangles of the last paintStubCoarse (coarseTitleAt answers from them). */
let stubTitleRects = []
/** What the stubbed renderer's voteDrawn() answers. */
let stubVoteDrawn
/** Overscan the stubbed renderer's stats() reports (undefined: the key is missing). */
let stubOverscan

/**
 * @param {{l:number, r:number, t:number, b:number, stageW:number, stageH:number}|undefined} v overscan
 *   the stubbed renderer's stats() reports from now on (undefined: none)
 */
export function setStubOverscan(v) {
	stubOverscan = v
}

/**
 * @param {{rings:number, badges:number, totals:number, outline:(string|null)}|null|undefined} v what
 *   the stubbed renderer reports as drawn by its last badge painting
 */
export function setStubVoteDrawn(v) {
	stubVoteDrawn = v
}

/**
 * @param {0|1|2} lod level the stubbed renderer draws from now on
 */
export function setStubLod(lod) {
	stubLod = lod
}

/** Glyph width of the fake text measuring, as a share of the font size. */
export const GLYPH = 0.5

/**
 * Paints the whole board at LOD 2 the way the renderer does (planCoarse,
 * paintCoarse) into a context that only measures (GLYPH · font size per
 * code point) and keeps the title rectangles for the stub's coarseTitleAt.
 *
 * @param {object} model SceneModel
 * @param {number} scale camera scale of the painting
 * @return {Array<{id:string, x:number, y:number, w:number, h:number}>} the title rectangles
 */
export function paintStubCoarse(model, scale) {
	const ctx = {
		font: '10px sans-serif',
		measureText: (str) => ({ width: Array.from(str).length * GLYPH * parseFloat(ctx.font) }),
		fillRect() {},
		strokeRect() {},
		fillText() {},
	}
	// job 202: outlines, lines and caps paint into nothing
	for (const k of ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arcTo', 'arc', 'ellipse', 'rect',
		'closePath', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'setLineDash', 'setAttr']) ctx[k] = () => {}
	const hits = model.query(-1e12, -1e12, 1e12, 1e12)
	const plan = planCoarse(model, hits, () => false, coarseOrder(model), null, scale)
	stubTitleRects = []
	paintCoarse(ctx, plan, scale, new Map(), stubTitleRects)
	return stubTitleRects.slice()
}

/**
 * (job 177) Deterministic line layout: greedy word wrap at width w with GLYPH · fs per character.
 *
 * @param {string} text text
 * @param {number} fs font size
 * @param {number} w wrap width
 * @return {number[]} widths of the lines, top first
 */
export function fakeLineWidths(text, fs, w) {
	const widths = []
	for (const para of text.split('\n')) {
		let cur = 0
		for (const word of para.split(' ')) {
			const ww = word.length * GLYPH * fs
			if (cur > 0 && cur + GLYPH * fs + ww > w) {
				widths.push(cur)
				cur = ww
			} else {
				cur += (cur > 0 ? GLYPH * fs : 0) + ww
			}
		}
		widths.push(cur)
	}
	return widths
}

/**
 * Deterministic text height: greedy word wrap with GLYPH · fontSize per character.
 *
 * @param {object} item text item (w, style.fontSize, data.text)
 * @return {number} lines × fontSize × 1.2
 */
export function fakeTextHeight(item) {
	const fs = Number.isInteger(item?.style?.fontSize) ? item.style.fontSize : 24
	const text = typeof item?.data?.text === 'string' ? item.data.text : ''
	return fakeLineWidths(text, fs, item?.w ?? 0).length * fs * 1.2
}

/**
 * (job 177) The stub of renderer.measureShapeLines: the shape's text wrapped at its inner text box.
 *
 * @param {object} item shape WireItem
 * @param {{w:number, h:number}} abs absolute box
 * @return {number[]} widths of the lines, top first
 */
export function fakeShapeLines(item, abs) {
	const a = shapeTextAttrs(item, abs)
	return fakeLineWidths(a.text, a.fontSize, a.width)
}

/** Replaces every KonvaRenderer member with a recording stub (idempotent). */
export function stubRenderer() {
	const proto = KonvaRenderer.prototype
	if (proto.__stubbed) return
	const answers = {
		hasDirty: () => false,
		stats: () => ({
			handles: 0, nodesBuilt: 0, attached: 0, staticChildren: 0, activeChildren: 0, uiChildren: 0, lod: 0, visible: 0, draws: { static: 0, overlay: 0 },
			...(stubOverscan !== undefined ? { overscan: stubOverscan } : {}),
		}),
		measureTextHeight: (item) => fakeTextHeight(item),
		measureShapeLines: (item, abs) => fakeShapeLines(item, abs),
		lodLevel: () => stubLod,
		lodAt: () => stubLod,
		coarseTitleAt: (wx, wy, tol) => coarseTitleHit(stubTitleRects, wx, wy, tol),
		measureTitleWidth: (text) => Array.from(typeof text === 'string' ? text : '').length * GLYPH * FRAME_TITLE_SIZE,
		coarseTitleWidth: (id) => stubTitleRects.find((r) => r.id === id)?.w ?? null,
		voteDrawn: () => stubVoteDrawn,
	}
	for (const name of Object.getOwnPropertyNames(proto)) {
		if (name === 'constructor') continue
		const d = Object.getOwnPropertyDescriptor(proto, name)
		if (typeof d.value === 'function') {
			const answer = answers[name]
			Object.defineProperty(proto, name, {
				configurable: true,
				writable: true,
				value(...args) {
					rcalls.push([name, ...args])
					return answer ? answer(...args) : undefined
				},
			})
		}
	}
	const content = new WeakMap()
	Object.defineProperty(proto, 'contentEl', {
		configurable: true,
		get() {
			if (!content.has(this)) content.set(this, { style: {} })
			return content.get(this)
		},
	})
	Object.defineProperty(proto, 'cssTransform', { configurable: true, get: () => null })
	Object.defineProperty(proto, 'stage', { configurable: true, get: () => null })
	Object.defineProperty(proto, '__stubbed', { value: true })
}

/**
 * @param {string} name renderer method
 * @return {Array<Array>} argument lists of its calls
 */
export function callsOf(name) {
	return rcalls.filter((c) => c[0] === name).map((c) => c.slice(1))
}

/**
 * A mounted scene on the fake DOM (1000 × 800 container, camera at the world
 * origin, scale 1 after one frame).
 *
 * @param {object[]} items WireItems
 * @param {object} [opts] {scene: SceneManager options, on: {callback name: fn}, viewInsets: fn}; every callback
 *   except onCamera, onPointer, onSelectionBox, onTouchPan and onLockedOffer (job 190) is added to the log,
 *   every one is handed to opts.on; (job 223) opts.viewInsets becomes the asked callback viewInsets as it is
 * @return {object} {dom, container, model, scene, log, frame, key, pointer, focusCanvas, restore}
 */
export function setupScene(items, opts = {}) {
	stubRenderer()
	rcalls.length = 0
	stubLod = 0
	stubTitleRects = []
	stubVoteDrawn = undefined
	stubOverscan = undefined
	const dom = installDom()
	const container = dom.doc.createElement('div')
	container.clientWidth = 1000
	container.clientHeight = 800
	dom.doc.body.appendChild(container)
	const model = new SceneModel()
	model.load(items)
	const log = []
	// job 171: onLaser too (only the laser tool calls it, so other logs stay as they were)
	// job 195: onNodeFocus (only a mind map calls it)
	const names = ['onIntent', 'onSelection', 'onCamera', 'onUserCamera', 'onPointer', 'onActivity', 'onDragPreview', 'onEditing', 'onTool', 'onGrid', 'onSelectionBox', 'onTouchPan', 'onShortcuts', 'onCursors', 'onLaser', 'onLockedOffer', 'onNodeFocus', 'onSearch']
	const callbacks = {}
	for (const n of names) {
		callbacks[n] = (...args) => {
			// onCamera, onPointer and onSelectionBox (job 137) are frequent: not logged, only handed to opts.on;
			// onTouchPan (job 142) and onLockedOffer (job 190) neither, so the logs of other tests stay as they were
			if (n !== 'onCamera' && n !== 'onPointer' && n !== 'onSelectionBox' && n !== 'onTouchPan' && n !== 'onLockedOffer') log.push([n, ...args])
			opts.on?.[n]?.(...args)
		}
	}
	if (opts.viewInsets) callbacks.viewInsets = opts.viewInsets
	const scene = new SceneManager(container, model, { limits: { maxText: 6000, maxTitle: 200 }, ...opts.scene, callbacks })
	scene.mount()
	scene.setCamera({ x: 0, y: 0, scale: 1 })
	dom.frame()
	log.length = 0
	return {
		dom,
		container,
		model,
		scene,
		log,
		frame: (ms) => dom.frame(ms),
		/**
		 * keydown (and keyup) on a target (default: the canvas container).
		 *
		 * @param {string} key KeyboardEvent.key
		 * @param {object} [props] modifiers, code, target
		 * @return {object} the keydown event
		 */
		key(key, props = {}) {
			const target = props.target ?? container
			const e = dispatch(target, 'keydown', { key, code: props.code ?? '', repeat: false, isComposing: false, ...props })
			dispatch(target, 'keyup', { key, code: props.code ?? '', ...props })
			return e
		},
		/**
		 * Pointer event on the container (container coordinates = client coordinates here).
		 *
		 * @param {string} type pointerdown | pointermove | pointerup | pointercancel
		 * @param {number} x x
		 * @param {number} y y
		 * @param {object} [props] pointerType, shiftKey, …
		 * @return {object} event
		 */
		pointer(type, x, y, props = {}) {
			return dispatch(props.target ?? container, type, { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', ...props })
		},
		focusCanvas() {
			scene.focusCanvas()
		},
		intents(type) {
			return log.filter((e) => e[0] === 'onIntent' && (!type || e[1].type === type)).map((e) => e[1])
		},
		restore() {
			scene.destroy()
			dom.restore()
		},
	}
}

/**
 * @param {string} id item id
 * @param {object} [o] fields
 * @return {object} sticky WireItem
 */
export const note = (id, o = {}) => ({ id, t: 'sticky', x: 0, y: 0, w: 200, h: 200, r: 0, z: 'a1', parent: null, data: { text: id }, style: { fill: '#a8d8f8' }, ...o })
/**
 * @param {string} id item id
 * @param {object} [o] fields
 * @return {object} frame WireItem
 */
export const frameItem = (id, o = {}) => ({ id, t: 'frame', x: 0, y: 0, w: 800, h: 600, r: 0, z: 'a0', parent: null, data: { title: id }, style: { fill: '#ffffff' }, ...o })
/**
 * @param {string} id item id
 * @param {object} [o] fields
 * @return {object} shape WireItem
 */
export const shapeItem = (id, o = {}) => ({ id, t: 'shape', x: 0, y: 0, w: 200, h: 120, r: 0, z: 'a2', parent: null, data: { kind: 'rect', text: '' }, style: { fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 2 }, ...o })
/**
 * @param {string} id item id
 * @param {object} [o] fields
 * @return {object} text WireItem
 */
export const textItem = (id, o = {}) => ({ id, t: 'text', x: 0, y: 0, w: 240, h: 28.8, r: 0, z: 'a3', parent: null, data: { text: 'Hello' }, style: { fontSize: 24, color: '#1a1a1a', align: 'left' }, ...o })
