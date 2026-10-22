/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Scene lab page (SPEC-M0 §9.4, SPEC-M1 §8.5): mounts SceneModel +
 * SceneManager without Nextcloud and without sync, on the generated board
 * (M1 set: 3000 notes, 500 shapes, 100 text items, 800 connectors, 20
 * frames, 30 unknown types), and exposes window.__lab for run.mjs.
 *
 * - spies on the Konva prototypes are installed BEFORE the scene exists:
 *   stage.scale/stage.position calls (must stay 0), Node.visible setter calls
 *   (0 during a pure pan without LOD change)
 * - every layer draw is logged with the CSS transform at that moment (proves
 *   the synchronous end-of-gesture draw happens before the transform reset)
 * - a minimal fake session applies intents the way BoardSession [C] does
 *   (deferred while the item is active, flushed on activity end), so drags,
 *   transforms, creates and text commits change the model like in the app
 *   (text items with their measured h); round 1b: connect creates a
 *   connector, retarget re-binds an end, a move shifts the free ends of a
 *   moved connector
 * - gate procedures that need frame-exact timing run inside the page
 *   (G11 transformer, G18 text measuring, G12 dragging the note with six
 *   connectors, G13 route snapshots of routes.js, the connector labels of
 *   finding S-1b-01, stage 2: G14 LOD 2 and the LOD-2 interaction checks;
 *   stage 3: G15 follow glide, G16 vote badges, follow semantics, mode vote
 *   with real input; vote/voteMiss intents and onUserCamera are recorded;
 *   M2: snapping a drag to another note, free with Ctrl (snapDrag, R12),
 *   to the gap of two notes in its row (gapDrag, R12), and a resize to
 *   another note (resizeSnap, R12); the background grid with its canvas,
 *   pixels, drag snapping and wheel gesture (gridCheck, R12); job 034, the
 *   overscan of the stage: G20 "Rand ohne Lücke" (edge*: touch and real
 *   wheel pans and a pinch-out on the CSS path, coverage and item pixels of
 *   the newly exposed strip in every frame), overscanCheck and
 *   overscanResizeCheck)
 * - the helpers that compare with the renderer's culled set (visibleCount,
 *   coarsePaintCheck, connectorsInView of measure) use its cull rectangle:
 *   cullRectOf with stats().overscan (null, as with a renderer without an
 *   overscan, is viewport + CULL_MARGIN)
 */
import Konva from 'konva/lib/Core'
import { SceneModel } from '../../src/model/SceneModel.js'
import { SceneManager } from '../../src/scene/index.js'
import { canBeChildOf, typeInfo, TYPES } from '../../src/model/registry.js'
import { routeConnector } from '../../src/model/connectors.js'
import { labelGlyphWidth } from '../../src/model/text.js'
import { keyBetween } from '../../src/model/zorder.js'
import { ulid } from '../../src/model/ids.js'
import { COVER_TOL_PX, cssTransformFor, cullRectOf, gestureRedrawFrames, viewRectOf } from '../../src/scene/Camera.js'
import { CULL_MARGIN, KonvaRenderer, gapMarkerPoints, snapGuideDashOffset } from '../../src/scene/KonvaRenderer.js'
import { gridLines } from '../../src/scene/grid.js'
import {
	CONNECTOR_LABEL_FONT_SIZE, CONNECTOR_LABEL_PAD, FONT_FAMILY, FRAME_EDGE_HIT_PX, FRAME_TITLE_BAND, GRID_MAJOR_COLOR,
	GRID_MINOR_COLOR, LOD2_ENTER, LOD2_LEAVE, LOD_COARSE_SCALE, LOD_TEXT_SCALE, MIN_SCALE, SNAP_GUIDE_COLOR, SNAP_GUIDE_DASH,
	SNAP_GUIDE_STROKE_PX, TRANSFORM_LIVE_MAX,
} from '../../src/model/tokens.js'
import { COARSE_TITLE_BOX_PX, COARSE_TITLE_MIN_PX, COARSE_TITLE_PX, coarseLook, fitTitle } from '../../src/scene/nodes/coarse.js'
import { HIT_TOL_MOUSE_PX } from '../../src/scene/InputController.js'
import { SCENE_SETS, generateScene } from './scene-gen.js'
import { ROUTE_CASES, routeAll, routeItems } from './routes.js'
import routeExpected from './routes-expected.json'
import { FrameMeter, measureRefresh, summarize } from './metrics.js'
import { mountPanel } from './panel.js'
import { PALETTE } from '../../src/sync/presence.js'

const errors = []
window.addEventListener('error', (e) => errors.push(String(e.message || e.error)))
window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + String(e.reason)))

// ---------------------------------------------------------------- spies (before the scene exists)
const spies = { stageScale: 0, stagePosition: 0, nodeScale: 0, nodePosition: 0, visibleSet: 0, visibleGet: 0 }
const proto = Konva.Node.prototype
for (const [name, stageKey, nodeKey] of [['scale', 'stageScale', 'nodeScale'], ['position', 'stagePosition', 'nodePosition']]) {
	const orig = proto[name]
	proto[name] = function (...args) {
		spies[nodeKey]++
		if (this instanceof Konva.Stage) spies[stageKey]++
		return orig.apply(this, args)
	}
}
const origVisible = proto.visible
proto.visible = function (...args) {
	if (args.length > 0) spies.visibleSet++
	else spies.visibleGet++
	return origVisible.apply(this, args)
}

// ---------------------------------------------------------------- scene
const params = new URLSearchParams(location.search)
const shadows = params.get('shadows') !== '0'
// ?set= (measurement mode only, run.mjs --set): m1 (default) or noconn, the
// same board without its connectors (scene-gen.js SCENE_SETS); run.mjs checks
// meta.set after loading
const set = params.get('set') ?? 'm1'
if (!Object.hasOwn(SCENE_SETS, set)) throw new Error(`unknown ?set=${set} (${Object.keys(SCENE_SETS).join('|')})`)
const { items, meta } = generateScene({ counts: SCENE_SETS[set] })
meta.set = set
const container = document.getElementById('board')
const model = new SceneModel()
const tLoad0 = performance.now()
model.load(items)
const loadMs = performance.now() - tLoad0

const log = []
const deferred = new Map()
let samples = []
let cameraEvents = 0
let userCameraEvents = 0
let lastPointer = null

/** Fake session: intents → model changes, deferred while the item is active. */
function handleIntent(i) {
	switch (i.type) {
	case 'move': {
		const extra = {
			activeAtIntent: i.ids.every((id) => scene.isActive(id)),
			absAtIntent: model.abs(i.ids[0]),
		}
		log.push(['intent', { type: 'move', ids: i.ids, dx: i.dx, dy: i.dy }, extra])
		const exclude = new Set()
		for (const id of i.ids) {
			exclude.add(id)
			for (const d of model.descendantsOf(id)) exclude.add(d)
		}
		for (const id of i.ids) {
			const it0 = model.get(id)
			if (typeInfo(it0.t).placement === 'none') {
				// a connector moves its free ends (stored data: the model only shifted them locally)
				const next = structuredClone(it0)
				for (const which of ['start', 'end']) {
					const ep = next.data[which]
					if (ep && !('item' in ep)) next.data[which] = { x: Math.round((ep.x + i.dx) * 100) / 100, y: Math.round((ep.y + i.dy) * 100) / 100 }
				}
				deferred.set(id, next)
				continue
			}
			const o = i.origin.get(id)
			const p = o.parent ? model.abs(o.parent) : null
			const ax = (p ? p.x : 0) + o.x + i.dx
			const ay = (p ? p.y : 0) + o.y + i.dy
			const it = model.get(id)
			const c = model.topContainerAt(ax + it.w / 2, ay + it.h / 2, exclude)
			const parent = c !== null && canBeChildOf(it.t, model.get(c).t) ? c : null
			const pa = parent ? model.abs(parent) : { x: 0, y: 0 }
			const next = structuredClone(it)
			next.x = Math.round((ax - pa.x) * 100) / 100
			next.y = Math.round((ay - pa.y) * 100) / 100
			next.parent = parent
			deferred.set(id, next)
		}
		// a nudge (arrow keys) has no activity that would flush it
		if (!i.ids.some((id) => scene.isActive(id))) flush()
		return
	}
	case 'create': {
		log.push(['intent', { type: 'create', t: i.t, rect: i.rect, data: i.data }])
		const info = TYPES[i.t]
		const w = i.rect ? i.rect.w : info.defaults.w
		let h = i.rect && i.t !== 'text' ? i.rect.h : info.defaults.h
		const x = i.rect ? i.rect.x : i.at.x - w / 2
		const y = i.rect ? i.rect.y : i.at.y - h / 2
		const id = ulid()
		const it = {
			id, t: i.t, x, y, w, h, r: 0, z: keyBetween(model.maxZ(info.layer), null), parent: null,
			data: { ...structuredClone(info.defaults.data), ...(i.data ?? {}) }, style: { ...structuredClone(info.defaults.style), ...(i.style ?? {}) },
		}
		if (i.t === 'text') {
			h = scene.measureTextHeight(it)
			it.h = h
		}
		if (canBeChildOf(i.t, 'frame')) {
			const c = model.topContainerAt(x + w / 2, y + h / 2)
			if (c !== null) {
				const pa = model.abs(c)
				it.parent = c
				it.x -= pa.x
				it.y -= pa.y
			}
		}
		scene.update(model.apply({ upserts: [it] }))
		scene.setSelection([id])
		if (i.t !== 'frame') scene.openTextEditor(id)
		return
	}
	case 'transform': {
		const extra = { activeAtIntent: i.ids.every((id) => scene.isActive(id)) }
		log.push(['intent', { type: 'transform', ids: i.ids, keep: i.keep, after: [...i.after.entries()], before: [...i.before.entries()] }, extra])
		for (const id of i.ids) {
			const a = i.after.get(id)
			// selected connectors come without a box (their free ends are [C]'s business)
			if (!a) continue
			const it = structuredClone(model.get(id))
			const pa = it.parent ? model.abs(it.parent) : null
			it.x = Math.round((a.x - (pa ? pa.x : 0)) * 100) / 100
			it.y = Math.round((a.y - (pa ? pa.y : 0)) * 100) / 100
			it.w = Math.round(a.w * 100) / 100
			it.h = Math.round(a.h * 100) / 100
			it.r = Math.round(a.r * 100) / 100
			if (typeof a.fontSize === 'number') it.style = { ...it.style, fontSize: a.fontSize }
			if (it.t === 'text') it.h = scene.measureTextHeight(it)
			deferred.set(id, it)
		}
		return
	}
	case 'delete': {
		log.push(['intent', { type: 'delete', ids: i.ids }])
		const removes = i.ids.filter((id) => model.has(id))
		const upserts = []
		for (const id of removes) {
			if (!typeInfo(model.get(id).t).container) continue
			for (const k of model.childrenOf(id)) {
				if (removes.includes(k)) continue
				const a = model.abs(k)
				upserts.push({ ...structuredClone(model.get(k)), x: a.x, y: a.y, parent: null })
			}
		}
		scene.update(model.apply({ upserts, removes }))
		return
	}
	case 'text': {
		log.push(['intent', { type: 'text', id: i.id, path: i.path, value: i.value, before: i.before, final: i.final, h: i.h, next: i.next },
			{ activeAtIntent: scene.isActive(i.id) }])
		const it = deferred.get(i.id) ?? structuredClone(model.get(i.id))
		if (!it) return
		const key = i.path.split('.')[1]
		it.data = { ...it.data, [key]: i.value }
		if (typeof i.h === 'number') it.h = i.h
		deferred.set(i.id, it)
		if (!scene.isActive(i.id)) flush()
		return
	}
	case 'connect': {
		log.push(['intent', { ...i }])
		const id = ulid()
		const it = {
			id, t: 'connector', x: 0, y: 0, w: 0, h: 0, r: 0, z: keyBetween(model.maxZ('content'), null), parent: null,
			data: { start: i.start, end: i.end, route: i.route }, style: { stroke: '#1a1a1a', strokeWidth: 2, endCap: i.endCap },
		}
		scene.update(model.apply({ upserts: [it] }))
		scene.setSelection([id])
		return
	}
	case 'retarget': {
		log.push(['intent', { ...i }, { activeAtIntent: scene.isActive(i.id) }])
		const it = deferred.get(i.id) ?? structuredClone(model.get(i.id))
		it.data = { ...it.data, [i.which]: i.value }
		deferred.set(i.id, it)
		if (!scene.isActive(i.id)) flush()
		return
	}
	case 'vote':
	case 'voteMiss':
	case 'contextMenu':
		log.push(['intent', { ...i }])
		return
	case 'copy':
	case 'cut':
	case 'duplicate':
	case 'pasteKey':
		log.push(['intent', { ...i }])
		return
	default:
		log.push(['intent', { type: i.type }])
	}
}

/** Applies deferred states of items that are no longer active. */
function flush() {
	const upserts = []
	for (const [id, it] of deferred) {
		if (scene.isActive(id)) continue
		upserts.push(it)
		deferred.delete(id)
	}
	if (upserts.length) scene.update(model.apply({ upserts }))
}

const scene = new SceneManager(container, model, {
	viewOnly: false,
	shadows,
	limits: { maxText: 6000, maxTitle: 200 },
	callbacks: {
		onIntent: handleIntent,
		onSelection: (ids) => log.push(['selection', ids.slice()]),
		onCamera: () => { cameraEvents++ },
		onUserCamera: () => { userCameraEvents++ },
		onPointer: (w) => { lastPointer = w },
		onActivity: (a) => {
			log.push(['activity', { kind: a.kind, active: a.active, n: a.ids.length }])
			if (!a.active) flush()
		},
		onDragPreview: (p) => log.push(['dragPreview', p.length]),
		onEditing: (id, takeover) => log.push(['editing', id, takeover]),
		onTool: (t) => log.push(['tool', t]),
	},
})

const tMount0 = performance.now()
scene.mount()
const vw = container.clientWidth
const vh = container.clientHeight
scene.setCamera({ x: meta.denseCenter.x - vw / 2, y: meta.denseCenter.y - vh / 2, scale: 1 })
scene.setRemoteSampler(() => samples)

// draw log with the CSS transform at draw time; ms = duration of the layer's
// drawScene on the main thread (Konva fires beforeDraw and draw around it)
const drawLog = []
let firstStaticDrawAt = null
const drawStart = { static: 0, overlay: 0 }
const layers = scene.renderer.stage.getLayers()
layers.forEach((layer, i) => {
	const name = i === 0 ? 'static' : 'overlay'
	layer.on('beforeDraw.lab', () => {
		drawStart[name] = performance.now()
	})
	layer.on('draw.lab', () => {
		const t = performance.now()
		if (name === 'static' && firstStaticDrawAt === null) firstStaticDrawAt = t
		drawLog.push({ layer: name, transform: scene.renderer.contentEl.style.transform, t, ms: t - drawStart[name] })
	})
})

// ---------------------------------------------------------------- helpers
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/*
 * Holding frames: the page's requestAnimationFrame queues instead of running,
 * so DOM overlays stay exactly as the last frame left them (a slow frame).
 * Playwright's actionability checks run in their own world and keep their
 * own frames. Never await frames()/idle() while frames are held.
 */
const realRaf = window.requestAnimationFrame.bind(window)
let heldFrames = null

function holdFrames() {
	if (heldFrames) return
	heldFrames = []
	window.requestAnimationFrame = (fn) => {
		heldFrames.push(fn)
		return 1e9 + heldFrames.length
	}
}

/** @return {number} held callbacks handed to the real requestAnimationFrame */
function releaseFrames() {
	if (!heldFrames) return 0
	const fns = heldFrames
	heldFrames = null
	window.requestAnimationFrame = realRaf
	for (const fn of fns) realRaf(fn)
	return fns.length
}

/** @param {number} n frames @return {Promise<void>} */
async function frames(n) {
	for (let i = 0; i < n; i++) await frame()
}

/**
 * Waits until the scene's loop has stopped for two consecutive frames.
 *
 * @param {number} [maxMs] timeout
 * @return {Promise<boolean>} true when idle
 */
async function idle(maxMs = 10000) {
	const t0 = performance.now()
	let quiet = 0
	while (performance.now() - t0 < maxMs) {
		await frame()
		quiet = scene.stats().loopRunning ? 0 : quiet + 1
		if (quiet >= 2) return true
	}
	return false
}

/**
 * @return {number} items whose index box meets the cull rectangle (the stage with its overscan, at
 *   least viewport + 10 %; rbush, independent of the renderer)
 */
function visibleCount() {
	const r = cullRectOf(scene.getCamera(), container.clientWidth, container.clientHeight, scene.stats().overscan, CULL_MARGIN)
	return model.query(r.minX, r.minY, r.maxX, r.maxY).length
}

/** @param {string} id item @return {{x:number, y:number}} client coordinates of the item centre */
function clientCenter(id) {
	const r = scene.itemScreenRect(id)
	const b = container.getBoundingClientRect()
	return { x: b.left + r.x + r.w / 2, y: b.top + r.y + r.h / 2 }
}

/**
 * @param {string} id item
 * @param {number} [scale] zoom
 */
async function focusItem(id, scale = 1) {
	const a = model.abs(id)
	scene.setCamera({ x: a.x + a.w / 2 - vw / (2 * scale), y: a.y + a.h / 2 - vh / (2 * scale), scale })
	await idle()
}

/**
 * Synthetic touch pointer event on the container (container coordinates).
 *
 * @param {string} type pointerdown | pointermove | pointerup | pointercancel
 * @param {number} pointerId id
 * @param {number} x container x
 * @param {number} y container y
 */
function touch(type, pointerId, x, y) {
	const b = container.getBoundingClientRect()
	container.dispatchEvent(new PointerEvent(type, {
		pointerId,
		pointerType: 'touch',
		isPrimary: pointerId % 10 === 1,
		clientX: b.left + x,
		clientY: b.top + y,
		bubbles: true,
		cancelable: true,
		button: type === 'pointermove' ? -1 : 0,
		buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
	}))
}

/**
 * Synthetic mouse pointer event on the container (container coordinates).
 *
 * @param {string} type pointerdown | pointermove | pointerup
 * @param {number} x container x
 * @param {number} y container y
 * @param {object} [mods] shiftKey, altKey
 */
function mouse(type, x, y, mods = {}) {
	const b = container.getBoundingClientRect()
	container.dispatchEvent(new PointerEvent(type, {
		pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: b.left + x, clientY: b.top + y, bubbles: true, cancelable: true,
		button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, ...mods,
	}))
}

/** @return {{sorted:boolean, n:number, violation:(string[]|null)}} static layer order vs compareOrder */
function orderCheck() {
	const kids = scene.renderer.staticOrder()
	for (let i = 1; i < kids.length; i++) {
		if (model.compareOrder(kids[i - 1], kids[i]) > 0) {
			return { sorted: false, n: kids.length, violation: [kids[i - 1], kids[i]] }
		}
	}
	return { sorted: true, n: kids.length, violation: null }
}

const draws = () => ({ ...scene.stats().draws })
const clearLog = () => { log.length = 0 }

/**
 * Empty canvas inside a frame (no item within 20 world units) with at least
 * three notes in the 600 × 500 rectangle below-right of it (marquee start).
 *
 * @param {string} frameId frame
 * @return {{x:number, y:number}|null} world point
 */
function emptySpotIn(frameId) {
	const a = model.abs(frameId)
	for (let y = a.y + 150; y < a.y + a.h - 700; y += 50) {
		for (let x = a.x + 30; x < a.x + a.w - 700; x += 50) {
			if (model.hitTest(x, y, 20) !== null || model.topContainerAt(x, y) !== frameId) continue
			const notes = model.queryRect({ x, y, w: 600, h: 500 }).filter((id) => model.get(id).t === 'sticky')
			if (notes.length >= 3) return { x, y }
		}
	}
	return null
}

// ---------------------------------------------------------------- gate procedures (frame-exact, in the page)

/**
 * Serpentine pan over the whole board at a fixed scale, one camera step per
 * frame (waiting until the loop is idle); attached vs. visible at every step.
 *
 * @param {number} scale zoom (no LOD change during the pan)
 * @return {Promise<object>}
 */
async function panAcross(scale) {
	const b = model.allBounds()
	const w = vw / scale
	const h = vh / scale
	scene.setCamera({ x: b.x - w * 0.05, y: b.y - h * 0.05, scale })
	await idle()
	spies.visibleSet = 0
	const xs = []
	for (let x = b.x - w * 0.05; x < b.x + b.w; x += w * 0.9) xs.push(x)
	let steps = 0
	let maxExcess = -Infinity
	let worst = null
	const lods = new Set()
	let row = 0
	for (let y = b.y - h * 0.05; y < b.y + b.h; y += h * 0.9, row++) {
		for (const x of (row % 2 ? xs.slice().reverse() : xs)) {
			scene.setCamera({ x, y, scale })
			await idle()
			const st = scene.stats()
			const vis = visibleCount()
			lods.add(st.lod)
			if (st.attached - vis > maxExcess) {
				maxExcess = st.attached - vis
				worst = { x, y, attached: st.attached, visible: vis, staticChildren: st.staticChildren }
			}
			steps++
		}
	}
	return { steps, maxExcess, worst, visibleSetCalls: spies.visibleSet, lods: [...lods], nodesBuilt: scene.stats().nodesBuilt }
}

/**
 * One-finger touch pan through synthetic PointerEvents.
 *
 * @param {number} dx total movement to the left (px)
 * @return {Promise<object>}
 */
async function touchPan(dx = 300) {
	await idle()
	const before = { draws: draws(), cam: scene.getCamera(), overlayNonEmpty: scene.stats().activeChildren + scene.stats().uiChildren > 0 }
	const x0 = vw / 2
	const y0 = vh / 2
	const during = []
	touch('pointerdown', 11, x0, y0)
	await frame()
	for (let i = 1; i <= 10; i++) {
		touch('pointermove', 11, x0 - (dx * i) / 10, y0)
		await frame()
		const st = scene.stats()
		during.push({ css: st.cssTransform, active: st.gestureActive, draws: { ...st.draws }, cam: st.camera })
	}
	touch('pointerup', 11, x0 - dx, y0)
	const atEnd = { draws: draws(), css: scene.stats().cssTransform, transform: scene.renderer.contentEl.style.transform }
	await frames(3)
	const st = scene.stats()
	return { before, during, atEnd, after: { draws: st.draws, css: st.cssTransform, cam: st.camera, active: st.gestureActive } }
}

/**
 * Pinch (spread) → one finger lifts → the other keeps panning: one gesture.
 *
 * @return {Promise<object>}
 */
async function pinchLiftPan() {
	await idle()
	const before = { draws: draws(), cam: scene.getCamera() }
	const cx = vw / 2
	const cy = vh / 2
	const trace = []
	const sample = (label) => {
		const st = scene.stats()
		trace.push({ label, css: st.cssTransform, active: st.gestureActive, draws: { ...st.draws }, live: st.liveCamera })
	}
	touch('pointerdown', 21, cx - 100, cy)
	touch('pointerdown', 22, cx + 100, cy)
	await frame()
	for (let i = 1; i <= 6; i++) {
		touch('pointermove', 21, cx - 100 - 10 * i, cy)
		touch('pointermove', 22, cx + 100 + 10 * i, cy)
		await frame()
		sample('pinch')
	}
	touch('pointerup', 21, cx - 160, cy)
	await frame()
	sample('lifted')
	for (let i = 1; i <= 6; i++) {
		touch('pointermove', 22, cx + 160 - 30 * i, cy)
		await frame()
		sample('pan')
	}
	touch('pointerup', 22, cx - 20, cy)
	const atEnd = { draws: draws() }
	await frames(3)
	const st = scene.stats()
	return { before, trace, atEnd, after: { draws: st.draws, css: st.cssTransform, cam: st.camera, active: st.gestureActive } }
}

/**
 * Cursor on a quiet scene: the loop is stopped, the sampler gets a new
 * entry, presenceChanged() → the cursor must be in the DOM in the next frame.
 *
 * @return {Promise<object>}
 */
async function cursorQuiet() {
	samples = []
	scene.presenceChanged()
	await idle()
	const wasRunning = scene.stats().loopRunning
	const cam = scene.getCamera()
	const wx = cam.x + 400 / cam.scale
	const wy = cam.y + 300 / cam.scale
	samples = [{
		key: 'pidQuiet:cQuiet1', pid: 'pidQuiet', name: 'Tom & Jerry <b>x</b>', color: '#d64545', guest: true,
		cursor: [wx, wy], selection: [], drag: [], editing: null, editingHolder: false,
	}]
	scene.presenceChanged()
	await frame()
	const el = document.querySelector('[data-knorke-cursor="pidQuiet:cQuiet1"]')
	const name = el?.querySelector('.knorke-cursor-name')
	const b = container.getBoundingClientRect()
	const r = el?.getBoundingClientRect()
	const out = {
		wasRunning,
		found: !!el,
		name: name ? name.textContent : null,
		nameHasElements: name ? name.children.length : null,
		guestClass: el ? el.classList.contains('knorke-cursor--guest') : false,
		dx: r ? r.left + 1 - (b.left + 400) : null,
		dy: r ? r.top + 1 - (b.top + 300) : null,
	}
	samples = []
	scene.presenceChanged()
	await idle()
	out.removed = !document.querySelector('[data-knorke-cursor="pidQuiet:cQuiet1"]')
	return out
}

/**
 * Remote model changes through model.apply + scene.update, the way the
 * session flushes server changes: cascade of a moved frame, a stale cached
 * node re-entering, reorder, type change (rebuild as placeholder), removal,
 * and reset() after a reload.
 *
 * @return {Promise<object>}
 */
async function updatesCheck() {
	const out = {}
	const frameId = meta.denseFrameId
	const kid = model.childrenOf(frameId)[0]
	// cascade: move the frame by (+50, +20) → its child moves on screen
	await focusItem(kid, 1)
	const before = clientCenter(kid)
	const f = structuredClone(model.get(frameId))
	f.x += 50
	f.y += 20
	scene.update(model.apply({ upserts: [f] }))
	await idle()
	const after = clientCenter(kid)
	out.cascade = { dx: after.x - before.x, dy: after.y - before.y, order: orderCheck().sorted }
	// stale cached node: change a cached note while it is detached, then bring it back
	const far = meta.centerNoteIds[7]
	await focusItem(far, 1)
	await focusItem(meta.unknownIds[0], 1)
	const detached = !scene.renderer.staticOrder().includes(far)
	const n = structuredClone(model.get(far))
	n.data.text = 'changed while away'
	n.style.fill = '#ffd8e6'
	scene.update(model.apply({ upserts: [n] }))
	await focusItem(far, 1)
	out.stale = { detached, text: scene.renderer.nodeText(far) }
	// reorder: bring a note below its neighbours to the top
	const victim = meta.centerNoteIds[6]
	await focusItem(victim, 1)
	const z = structuredClone(model.get(victim))
	z.z = keyBetween(model.maxZ('content'), null)
	scene.update(model.apply({ upserts: [z] }))
	await idle()
	const kids = scene.renderer.staticOrder()
	out.reorder = { last: kids[kids.length - 1] === victim, sorted: orderCheck().sorted }
	// type change → placeholder node
	const tc = structuredClone(model.get(victim))
	tc.t = 'kanban'
	tc.parent = null
	scene.update(model.apply({ upserts: [tc] }))
	await idle()
	out.typeChange = { text: scene.renderer.nodeText(victim), sorted: orderCheck().sorted }
	// removal of an attached item
	scene.setSelection([victim])
	scene.update(model.apply({ removes: [victim] }))
	await idle()
	out.removed = { attached: scene.renderer.staticOrder().includes(victim), selection: scene.getSelection().length, built: scene.stats().nodesBuilt }
	// reset after a reload: same items, all nodes rebuilt, order kept
	model.load(model.sortByOrder([...model.ids()]).map((id) => structuredClone(model.get(id))))
	scene.reset()
	await idle()
	const st = scene.stats()
	out.reset = { nodesBuilt: st.nodesBuilt, visible: visibleCount(), sorted: orderCheck().sorted }
	return out
}

/**
 * Gate G11 (SPEC-M1 §8.5): drags a transformer handle frame by frame.
 * One item: live (model + nodes every frame) with 0 draws of the static
 * layer while dragging; more than TRANSFORM_LIVE_MAX items: the preview is
 * ONE setAttrs of the activeGroup per frame, the model changes only at the
 * release. Counted between the first step and the last move (the move of
 * the nodes into the activeGroup at the start redraws the static layer once).
 * With ctrl every mouse event carries ctrlKey: the resize does not snap
 * (R12), so the size follows the pointer exactly.
 *
 * @param {string[]} ids selection
 * @param {string} anchor handle name
 * @param {number} [steps] moves (one per frame)
 * @param {{dx:number, dy:number}} [step] pointer movement per frame (screen px)
 * @param {boolean} [ctrl] hold Ctrl (resizes free)
 * @return {Promise<object>}
 */
async function transformDrag(ids, anchor, steps = 12, step = { dx: 6, dy: 4 }, ctrl = false) {
	scene.setSelection(ids)
	await idle()
	const hd = scene.handles().find((x) => x.name === anchor)
	if (!hd) return { error: 'no handle ' + anchor, handles: scene.handles().map((x) => x.name) }
	const active = scene.renderer.stage.getLayers()[1].children[0]
	let xfCalls = 0
	const own = active.setAttrs
	active.setAttrs = function (a) {
		if (a && 'scaleX' in a) xfCalls++
		return own.call(this, a)
	}
	const probe = ids[ids.length - 1]
	const absBefore = model.abs(probe)
	const mods = ctrl ? { ctrlKey: true } : {}
	try {
		clearLog()
		mouse('pointerdown', hd.x, hd.y, mods)
		mouse('pointermove', hd.x + step.dx, hd.y + step.dy, mods)
		await frames(2)
		const d0 = draws()
		const st0 = scene.stats()
		const x0 = xfCalls
		let midAbs = null
		for (let i = 2; i <= steps + 1; i++) {
			mouse('pointermove', hd.x + step.dx * i, hd.y + step.dy * i, mods)
			await frame()
			if (i === Math.floor(steps / 2)) midAbs = model.abs(probe)
		}
		const d1 = draws()
		const mid = scene.stats()
		const xfDuring = xfCalls - x0
		mouse('pointerup', hd.x + step.dx * (steps + 1), hd.y + step.dy * (steps + 1), mods)
		await idle()
		const st = scene.stats()
		const intent = log.find((e) => e[0] === 'intent' && e[1].type === 'transform')
		const order = log.filter((e) => e[0] === 'dragPreview' || (e[0] === 'intent' && e[1].type === 'transform') ||
			(e[0] === 'activity' && e[1].kind === 'transform')).map((e) => e[0] === 'activity' ? 'activity:' + e[1].active : e[0])
		return {
			n: ids.length,
			live: st0.transformLive,
			transformingDuring: mid.transforming,
			activeChildrenDuring: mid.activeChildren,
			staticDrawsDuring: d1.static - d0.static,
			overlayDrawsDuring: d1.overlay - d0.overlay,
			frames: steps,
			activeSetAttrsDuring: xfDuring,
			modelMovedDuring: midAbs !== null && (midAbs.w !== absBefore.w || midAbs.x !== absBefore.x),
			modelAfter: model.abs(probe),
			absBefore,
			activeAfter: { ...active.attrs },
			activeChildrenAfter: st.activeChildren,
			intent: intent ? { ids: intent[1].ids.length, keep: intent[1].keep, after: intent[1].after.slice(0, 1), activeAtIntent: intent[2].activeAtIntent } : null,
			order,
			orderCheck: orderCheck(),
		}
	} finally {
		active.setAttrs = own
	}
}

/**
 * Gate G18 (SPEC-M1 §8.5): measureTextHeight of 50 text items in two runs
 * (with camera changes and node rebuilds in between) gives the same values;
 * the heights are whole lines (lines × fontSize × 1.2).
 *
 * @return {Promise<object>}
 */
async function measureTexts() {
	const ids = meta.textIds.slice(0, 50)
	const run = () => ids.map((id) => scene.measureTextHeight(model.get(id)))
	const first = run()
	await focusItem(ids[0], 0.5)
	await focusItem(ids[10], 1)
	const second = run()
	const lines = ids.map((id, i) => first[i] / (model.get(id).style.fontSize * 1.2))
	const whole = lines.every((l) => Math.abs(l - Math.round(l)) < 1e-9 && l >= 1)
	return { n: ids.length, same: first.every((v, i) => Object.is(v, second[i])), whole, sample: first.slice(0, 5), lines: lines.slice(0, 5) }
}

/**
 * Gate G12 (SPEC-M1 §8.5): drags the note with six connectors
 * (meta.hubNoteId) frame by frame with real pointer events. The note and
 * its connectors live in the activeGroup; the connectors are re-routed in
 * every frame in which the note moved, and the static layer must not be
 * drawn while dragging (counted between the first step and the last move;
 * moving the nodes into the activeGroup at the start redraws it once). Frame
 * times of the drag are reported (the target of ≥ 55 fps in Chromium is a
 * report, not a gate condition). The drag snaps (M2, R12) like a user's: a
 * frame in which the snapped note stays where it was has nothing to draw, so
 * movedFrames counts the frames in which the note moved.
 *
 * @param {number} [steps] moves (one per frame)
 * @return {Promise<object>}
 */
async function connectorDrag(steps = 90) {
	const id = meta.hubNoteId
	const conns = meta.hubConnectorIds.slice()
	await focusItem(id, 1)
	scene.setSelection([])
	await idle()
	const c = scene.itemScreenRect(id)
	const x0 = c.x + c.w / 2
	const y0 = c.y + c.h / 2
	const before = conns.map((k) => model.geometryOf(k)?.points.slice() ?? null)
	const refreshMs = await measureRefresh(20)
	clearLog()
	mouse('pointerdown', x0, y0)
	mouse('pointermove', x0 + 6, y0 + 3)
	await frames(2)
	const d0 = draws()
	const meter = new FrameMeter()
	meter.start()
	let during = null
	let movedFrames = 0
	let prev = model.abs(id)
	for (let i = 2; i <= steps + 1; i++) {
		mouse('pointermove', x0 + 6 * i, y0 + 3 * i)
		await frame()
		if (i === Math.floor(steps / 2)) during = scene.stats()
		const now = model.abs(id)
		if (now.x !== prev.x || now.y !== prev.y) movedFrames++
		prev = now
	}
	const fps = meter.stop(refreshMs)
	const d1 = draws()
	const moved = conns.map((k) => model.geometryOf(k)?.points.slice() ?? null)
	// the model routes like the pure function over the moved boxes
	const consistent = conns.every((k) => {
		const it = model.get(k)
		const end = (ep) => ('item' in ep ? { box: model.abs(ep.item), ep, point: null } : { box: null, ep, point: null })
		const g = routeConnector(end(it.data.start), end(it.data.end), it.data.route)
		return JSON.stringify(g.points) === JSON.stringify(model.geometryOf(k).points)
	})
	const activeIds = conns.every((k) => scene.isActive(k))
	mouse('pointerup', x0 + 6 * (steps + 1), y0 + 3 * (steps + 1))
	await idle()
	const intent = log.find((e) => e[0] === 'intent' && e[1].type === 'move')
	return {
		hub: id,
		connectors: conns.length,
		staticDrawsDuring: d1.static - d0.static,
		overlayDrawsDuring: d1.overlay - d0.overlay,
		frames: steps,
		movedFrames,
		activeChildrenDuring: during?.activeChildren ?? null,
		connectorsActive: activeIds,
		allRerouted: moved.every((pts, k) => pts !== null && JSON.stringify(pts) !== JSON.stringify(before[k])),
		consistent,
		intent: intent ? { ids: intent[1].ids, dx: intent[1].dx, dy: intent[1].dy } : null,
		fps,
		after: { activeChildren: scene.stats().activeChildren, order: orderCheck().sorted },
	}
}

/** @return {number} snap guide nodes on the stage */
const snapGuideNodes = () => scene.renderer.stage.find('.knorke-snap-guide').length

/**
 * @return {object[]} the look of every snap guide node: stroke, width, dash, dashOffset and the
 *   offset snapGuideDashOffset gives for its start at the renderer's scale
 */
function snapGuideLooks() {
	return scene.renderer.stage.find('.knorke-snap-guide').map((n) => {
		const p = n.points()
		const from = p[0] === p[2] ? p[1] : p[0]
		return {
			stroke: n.stroke(), strokeWidth: n.strokeWidth(), dash: (n.dash() ?? []).slice(), dashEnabled: n.dashEnabled(),
			strokeScaleEnabled: n.strokeScaleEnabled(), dashOffset: n.dashOffset(),
			wantOffset: snapGuideDashOffset(from, scene.renderer.camera.scale),
		}
	})
}

/**
 * @param {object[]} looks snapGuideLooks()
 * @return {boolean} at least one node, each dashed as SNAP_GUIDE_DASH, magenta, 1 px, unscaled, phase anchored to the board
 */
const snapGuideLooksOk = (looks) => looks.length >= 1 && looks.every((l) => l.stroke === SNAP_GUIDE_COLOR &&
	l.strokeWidth === SNAP_GUIDE_STROKE_PX && l.dash.length === SNAP_GUIDE_DASH.length &&
	l.dash.every((d, i) => d === SNAP_GUIDE_DASH[i]) && l.dashEnabled === true && l.strokeScaleEnabled === false &&
	Math.abs(l.dashOffset - l.wantOffset) <= 1e-9)

/**
 * Snapping to objects (M2, SPEC-M1 §1.2 (R12)): note A = centerNoteIds[0]
 * at scale 1 and another note B fully in view, at least 100 world units of
 * drag away; a drag with synthetic mouse events (as connectorDrag, with
 * ctrlKey on every event when ctrl is set) by the raw shift that puts A's
 * left edge 3 left of B's left edge and A's top 40 below B's bottom, then
 * the release. Counted one frame after the last move (static draws from
 * the second frame of the drag on, as G12) and after the release. The drag
 * moves A (the fake session applies the intent). During the drag the look
 * of every guide node is read too (during.looks: stroke, width, dash,
 * dashOffset against snapGuideDashOffset of its start; during.lookOk: at
 * least one node and each one dashed as SNAP_GUIDE_DASH, magenta, 1 px,
 * unscaled, phase anchored to the board). during.gapMarkers (equal gaps,
 * stats().gapMarkers) is only reported.
 *
 * @param {boolean} ctrl hold Ctrl (drags free)
 * @return {Promise<object>} {a, b, ctrl, rawDx, rawDy, during, after: {snapGuides, nodes, staticDraws}, intent}
 */
async function snapDrag(ctrl) {
	const idA = meta.centerNoteIds[0]
	await focusItem(idA, 1)
	scene.setSelection([])
	await idle()
	const a = model.boundsOf([idA])
	const v = viewRectOf(scene.getCamera(), vw, vh, 0)
	const inView = (b) => b !== null && b.x >= v.minX && b.y >= v.minY && b.x + b.w <= v.maxX && b.y + b.h <= v.maxY
	const shiftTo = (b) => ({ dx: (b.x - a.x) - 3, dy: (b.y + b.h - a.y) + 40 })
	const notes = model.queryRect({ x: v.minX, y: v.minY, w: v.maxX - v.minX, h: v.maxY - v.minY })
		.filter((id) => id !== idA && model.get(id).t === 'sticky')
	const idB = [...meta.centerNoteIds.slice(1), ...notes].find((id) => {
		const b = model.boundsOf([id])
		return id !== idA && inView(b) && Math.hypot(shiftTo(b).dx, shiftTo(b).dy) >= 100
	}) ?? null
	if (idB === null) return { a: idA, b: null, ctrl, error: 'no other note in view' }
	const { dx: rawDx, dy: rawDy } = shiftTo(model.boundsOf([idB]))
	const c = scene.itemScreenRect(idA)
	const x0 = c.x + c.w / 2
	const y0 = c.y + c.h / 2
	const mods = ctrl ? { ctrlKey: true } : {}
	const steps = 12
	clearLog()
	mouse('pointerdown', x0, y0, mods)
	mouse('pointermove', x0 + rawDx / steps, y0 + rawDy / steps, mods)
	await frames(2)
	const d0 = draws()
	for (let i = 2; i <= steps; i++) {
		mouse('pointermove', x0 + rawDx * i / steps, y0 + rawDy * i / steps, mods)
		await frame()
	}
	await frame()
	const d1 = draws()
	const st = scene.stats()
	const looks = snapGuideLooks()
	const during = {
		snapGuides: st.snapGuides, nodes: snapGuideNodes(), staticDraws: d1.static - d0.static, dragging: st.dragging,
		looks, lookOk: snapGuideLooksOk(looks), gapMarkers: st.gapMarkers,
	}
	mouse('pointerup', x0 + rawDx, y0 + rawDy, mods)
	await idle()
	const after = { snapGuides: scene.stats().snapGuides, nodes: snapGuideNodes(), staticDraws: draws().static - d1.static }
	const e = log.find((x) => x[0] === 'intent' && x[1].type === 'move')
	return { a: idA, b: idB, ctrl, rawDx, rawDy, during, after, intent: e ? { ids: e[1].ids, dx: e[1].dx, dy: e[1].dy } : null }
}

/**
 * Equal gaps (M2, SPEC-M1 §1.2 (R12)): three 200 × 200 notes alone below
 * the board (as voteTouch), P at (x0, y0), Q 60 right of P, A at
 * (x0 + 600, y0 + 20); A at scale 1 dragged with synthetic mouse events (as
 * snapDrag, ctrlKey on every event when ctrl is set) by (−77, 0) in 12
 * steps, which leaves 63 to Q: snapped, A lands 60 right of Q (intent −80).
 * Counted one frame after the last move (static draws from the second frame
 * of the drag on, as snapDrag) and after the release. During the drag the
 * look of every gap marker node is read (during.looks: stroke, width,
 * unscaled, dash, points; during.lookOk: two nodes, each solid, magenta,
 * 1 px, unscaled, its points those of gapMarkerPoints of the markers P–Q
 * and Q–A at the renderer's scale). P, Q and A are removed at the end.
 *
 * @param {boolean} ctrl hold Ctrl (drags free)
 * @return {Promise<object>} {ctrl, rawDx, rawDy, during: {gapMarkers, snapGuides, nodes, staticDraws, looks,
 *   lookOk}, after: {gapMarkers, nodes}, intent}
 */
async function gapDrag(ctrl) {
	const b = model.allBounds()
	const x0 = Math.round(b.x) + 2000
	const y0 = Math.round(b.y + b.h) + 15000
	const ids = [ulid(), ulid(), ulid()]
	const [, , A] = ids
	let z = model.maxZ('content')
	const upserts = [[x0, y0], [x0 + 260, y0], [x0 + 600, y0 + 20]].map(([x, y], i) => {
		z = keyBetween(z, null)
		return { id: ids[i], t: 'sticky', x, y, w: 200, h: 200, r: 0, z, parent: null, data: { text: '' }, style: { fill: '#a8d8f8' } }
	})
	scene.update(model.apply({ upserts }))
	await focusItem(A, 1)
	scene.setSelection([])
	await idle()
	const rawDx = -77
	const rawDy = 0
	const c = scene.itemScreenRect(A)
	const cx = c.x + c.w / 2
	const cy = c.y + c.h / 2
	const mods = ctrl ? { ctrlKey: true } : {}
	const steps = 12
	const want = [{ axis: 'x', from: x0 + 200, to: x0 + 260, at: y0 + 100 }, { axis: 'x', from: x0 + 460, to: x0 + 520, at: y0 + 110 }]
	const markerNodes = () => scene.renderer.stage.find('.knorke-gap-marker')
	const looksOf = () => markerNodes().map((n) => ({
		stroke: n.stroke(), strokeWidth: n.strokeWidth(), strokeScaleEnabled: n.strokeScaleEnabled(),
		dash: (n.dash() ?? []).slice(), points: n.points().slice(),
	}))
	const looksOk = (looks) => {
		const s = scene.renderer.camera.scale
		return looks.length === 2 && looks.every((l, i) => {
			const p = gapMarkerPoints(want[i], s)
			return l.stroke === SNAP_GUIDE_COLOR && l.strokeWidth === SNAP_GUIDE_STROKE_PX && l.strokeScaleEnabled === false &&
				l.dash.length === 0 && l.points.length === p.length && l.points.every((v, k) => Math.abs(v - p[k]) <= 1e-6)
		})
	}
	clearLog()
	mouse('pointerdown', cx, cy, mods)
	mouse('pointermove', cx + rawDx / steps, cy + rawDy / steps, mods)
	await frames(2)
	const d0 = draws()
	for (let i = 2; i <= steps; i++) {
		mouse('pointermove', cx + rawDx * i / steps, cy + rawDy * i / steps, mods)
		await frame()
	}
	await frame()
	const d1 = draws()
	const st = scene.stats()
	const looks = looksOf()
	const during = {
		gapMarkers: st.gapMarkers, snapGuides: st.snapGuides, nodes: looks.length, staticDraws: d1.static - d0.static,
		looks, lookOk: looksOk(looks),
	}
	mouse('pointerup', cx + rawDx, cy + rawDy, mods)
	await idle()
	const after = { gapMarkers: scene.stats().gapMarkers, nodes: markerNodes().length }
	const e = log.find((x) => x[0] === 'intent' && x[1].type === 'move')
	scene.update(model.apply({ removes: ids.filter((id) => model.has(id)) }))
	await focusItem(meta.centerNoteIds[0], 1)
	clearLog()
	return { ctrl, rawDx, rawDy, during, after, intent: e ? { ids: e[1].ids, dx: e[1].dx, dy: e[1].dy } : null }
}

/**
 * Snapping a resize (M2, SPEC-M1 §1.2 (R12), job 015): two 200 × 200 notes
 * alone below the board (own place, below the one of gapDrag), A at
 * (x0, y0), B at (x0 + 400, y0 + 300); A at scale 1 selected and its handle
 * r dragged with synthetic mouse events (as gapDrag, ctrlKey on every event
 * when ctrl is set) by (+197, 0) screen px in 12 steps, which leaves A's
 * right edge 3 left of B's left edge: snapped, A ends 400 wide. Counted one
 * frame after the last move (static draws from the second frame of the
 * drag on, as gapDrag) and after the release; during the drag the look of
 * every guide node is read (as snapDrag). A and B are removed at the end.
 *
 * @param {boolean} ctrl hold Ctrl (resizes free)
 * @return {Promise<object>} {ctrl, x0, y0, rawDx, during: {snapGuides, nodes, looks, lookOk, staticDraws,
 *   gapMarkers, transforming}, after: {snapGuides, nodes}, intent: {after: A's box}|null}
 */
async function resizeSnap(ctrl) {
	const b = model.allBounds()
	const x0 = Math.round(b.x) + 2000
	const y0 = Math.round(b.y + b.h) + 21000
	const ids = [ulid(), ulid()]
	const [A] = ids
	let z = model.maxZ('content')
	const upserts = [[x0, y0], [x0 + 400, y0 + 300]].map(([x, y], i) => {
		z = keyBetween(z, null)
		return { id: ids[i], t: 'sticky', x, y, w: 200, h: 200, r: 0, z, parent: null, data: { text: '' }, style: { fill: '#a8d8f8' } }
	})
	scene.update(model.apply({ upserts }))
	await focusItem(A, 1)
	scene.setSelection([A])
	await idle()
	const cleanup = async () => {
		scene.update(model.apply({ removes: ids.filter((id) => model.has(id)) }))
		await focusItem(meta.centerNoteIds[0], 1)
		clearLog()
	}
	const hd = scene.handles().find((x) => x.name === 'r')
	if (!hd) {
		await cleanup()
		return { ctrl, error: 'no handle r' }
	}
	const rawDx = 197
	const mods = ctrl ? { ctrlKey: true } : {}
	const steps = 12
	clearLog()
	mouse('pointerdown', hd.x, hd.y, mods)
	mouse('pointermove', hd.x + rawDx / steps, hd.y, mods)
	await frames(2)
	const d0 = draws()
	for (let i = 2; i <= steps; i++) {
		mouse('pointermove', hd.x + rawDx * i / steps, hd.y, mods)
		await frame()
	}
	await frame()
	const d1 = draws()
	const st = scene.stats()
	const looks = snapGuideLooks()
	const during = {
		snapGuides: st.snapGuides, nodes: snapGuideNodes(), staticDraws: d1.static - d0.static, transforming: st.transforming,
		looks, lookOk: snapGuideLooksOk(looks), gapMarkers: st.gapMarkers,
	}
	mouse('pointerup', hd.x + rawDx, hd.y, mods)
	await idle()
	const after = { snapGuides: scene.stats().snapGuides, nodes: snapGuideNodes() }
	const e = log.find((x) => x[0] === 'intent' && x[1].type === 'transform')
	const box = e ? (e[1].after.find(([id]) => id === A)?.[1] ?? null) : null
	await cleanup()
	return { ctrl, x0, y0, rawDx, during, after, intent: box ? { after: box } : null }
}

/**
 * Background grid (M2, SPEC-M1 §1.2 (R12), job 016): a 200 × 200 note N
 * alone below the board (own place, below the ones of gapDrag and
 * resizeSnap) at (x0, y0), both multiples of 100; the camera at scale 1
 * with whole x and y, N in view; then scene.setGrid(true) and one frame.
 * Reads
 * - dom: the canvas.knorke-grid in the scene container (count, first
 *   element child before .konvajs-content, computed pointer-events,
 *   aria-hidden, its bitmap against round(w · Konva.pixelRatio) × round(h ·
 *   Konva.pixelRatio)) and the canvases in #board
 * - hit: document.elementFromPoint on a vertical grid line in empty canvas
 *   is not the grid canvas
 * - px: RGBA of the grid canvas on a vertical minor and a vertical major
 *   line (gridLines of stats().camera), halfway between two horizontal
 *   lines, and in the middle of a cell
 * - drag: N dragged with synthetic mouse events by (+47, +33) screen px in
 *   12 steps: the grid and static draws from the second frame of the drag
 *   on (both 0: the grid paints only on camera changes), stats().snapGuides,
 *   N after the release (snapped to (x0 + 40, y0 + 40))
 * - wheel: a synthetic wheel pan without Ctrl (5 events, a frame each):
 *   during the CSS gesture the grid paintings since before it (≥ 1) and the
 *   grid canvas's style.transform (empty: never transformed), after its end
 *   cssTransform
 * - off: after scene.setGrid(false) the .knorke-grid elements, the canvases
 *   in #board and stats().grid
 * N is removed at the end and the camera goes back to centerNoteIds[0] (as
 * gapDrag); the grid is off again also when something throws (finally).
 *
 * @return {Promise<object>} {x0, y0, colors: {minor, major}, dom, hit, px, drag, wheel, off}
 */
async function gridCheck() {
	const b = model.allBounds()
	const x0 = Math.round((b.x + 2000) / 100) * 100
	const y0 = Math.round((b.y + b.h + 27000) / 100) * 100
	const N = ulid()
	const upserts = [{
		id: N, t: 'sticky', x: x0, y: y0, w: 200, h: 200, r: 0, z: keyBetween(model.maxZ('content'), null), parent: null,
		data: { text: '' }, style: { fill: '#a8d8f8' },
	}]
	scene.update(model.apply({ upserts }))
	const out = { x0, y0, colors: { minor: GRID_MINOR_COLOR, major: GRID_MAJOR_COLOR } }
	try {
		scene.setSelection([])
		scene.setCamera({ x: x0 + 100 - Math.round(vw / 2), y: y0 + 100 - Math.round(vh / 2), scale: 1 })
		await idle()
		scene.setGrid(true)
		await frame()
		const pr = Konva.pixelRatio
		const grids = container.querySelectorAll('canvas.knorke-grid')
		const gc = grids[0] ?? null
		const content = container.querySelector('.konvajs-content')
		out.dom = {
			count: grids.length,
			first: gc !== null && container.firstElementChild === gc && gc.nextElementSibling === content,
			pointerEvents: gc ? getComputedStyle(gc).pointerEvents : null,
			ariaHidden: gc ? gc.getAttribute('aria-hidden') : null,
			width: gc ? gc.width : null,
			height: gc ? gc.height : null,
			wantWidth: Math.round(vw * pr),
			wantHeight: Math.round(vh * pr),
			canvases: container.querySelectorAll('canvas').length,
		}
		const cam = scene.stats().camera
		const lines = gridLines(cam, vw, vh, pr)
		const minor = lines.xs.find((l, i) => !l.major && i > 0 && l.at < lines.xs.at(-1).at)
		const major = lines.xs.find((l, i) => l.major && i > 0)
		// halfway between the first two horizontal lines (the top of the view, away from N)
		const yMid = Math.floor((lines.ys[0].at + lines.ys[1].at) / 2)
		const ix = lines.xs.indexOf(minor)
		const xMid = Math.floor((minor.at + lines.xs[ix + 1].at) / 2)
		const r = container.getBoundingClientRect()
		const hitEl = document.elementFromPoint(r.left + minor.at / pr, r.top + yMid / pr)
		out.hit = { grid: hitEl === gc, tag: hitEl ? hitEl.tagName : null, cls: hitEl ? String(hitEl.className) : null }
		const ctx = gc.getContext('2d')
		const rgba = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data)
		out.px = {
			step: lines.step, minorAt: minor.at, majorAt: major.at, y: yMid, cellX: xMid,
			minor: rgba(minor.at, yMid), major: rgba(major.at, yMid), cell: rgba(xMid, yMid),
		}
		// drag N by (+47, +33) screen px in 12 steps (as gapDrag)
		const c = scene.itemScreenRect(N)
		const cx = c.x + c.w / 2
		const cy = c.y + c.h / 2
		const steps = 12
		clearLog()
		mouse('pointerdown', cx, cy)
		mouse('pointermove', cx + 47 / steps, cy + 33 / steps)
		await frames(2)
		const d0 = draws()
		let guides = 0
		for (let i = 2; i <= steps; i++) {
			mouse('pointermove', cx + 47 * i / steps, cy + 33 * i / steps)
			await frame()
			guides = Math.max(guides, scene.stats().snapGuides)
		}
		await frame()
		const d1 = draws()
		mouse('pointerup', cx + 47, cy + 33)
		await idle()
		const a = model.abs(N)
		out.drag = { gridDraws: d1.grid - d0.grid, staticDraws: d1.static - d0.static, snapGuides: guides, at: a ? { x: a.x, y: a.y } : null }
		// a wheel pan without Ctrl: the CSS path, the grid painted with the live camera
		const w0 = draws().grid
		for (let i = 0; i < 5; i++) {
			container.dispatchEvent(new WheelEvent('wheel', {
				deltaX: 12, deltaY: 30, deltaMode: 0, clientX: r.left + vw / 2, clientY: r.top + vh / 2, bubbles: true, cancelable: true,
			}))
			await frame()
		}
		const mid = scene.stats()
		out.wheel = { css: mid.cssTransform, gridDraws: mid.draws.grid - w0, transform: gc.style.transform }
		await new Promise((resolve) => setTimeout(resolve, 300))
		await idle()
		out.wheel.cssAfter = scene.stats().cssTransform
		scene.setGrid(false)
		await frame()
		out.off = {
			count: container.querySelectorAll('.knorke-grid').length,
			canvases: container.querySelectorAll('canvas').length,
			grid: scene.stats().grid,
		}
	} finally {
		scene.setGrid(false)
		scene.update(model.apply({ removes: [N].filter((id) => model.has(id)) }))
		await focusItem(meta.centerNoteIds[0], 1)
		clearLog()
	}
	return out
}

/**
 * Gate G13 (SPEC-M1 §8.5): the route cases of routes.js routed in this
 * browser equal the snapshots of routes-expected.json bit for bit; and a
 * SceneModel loaded with the cases (own targets per case) routes every
 * connector exactly like routeConnector.
 *
 * @return {object}
 */
function routeCheck() {
	const got = routeAll(routeConnector)
	const mismatched = Object.keys(routeExpected).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(routeExpected[k]))
	let n = 0
	const { items, checks } = routeItems(() => '01JF5Q4T0V9W8X7Y6Z5A' + String(n++).padStart(6, '0'))
	const m = new SceneModel()
	m.load(items)
	const modelMismatched = checks.filter((k) => {
		const want = routeConnector(k.a, k.b, k.route)
		return JSON.stringify(m.geometryOf(k.id)?.points) !== JSON.stringify(want.points)
	}).map((k) => k.name)
	const kinds = {}
	for (const c of ROUTE_CASES) kinds[c.route] = (kinds[c.route] ?? 0) + 1
	const combos = new Set(ROUTE_CASES.filter((c) => c.sides).map((c) => c.sides.join('-')))
	const rotated = ROUTE_CASES.filter((c) => (c.a.box?.r ?? 0) !== 0 || (c.b.box?.r ?? 0) !== 0).length
	return { n: ROUTE_CASES.length, snapshots: Object.keys(routeExpected).length, mismatched, modelMismatched, kinds, combos: combos.size, rotated }
}

/** @param {...number[]} seqs code point sequences @return {string[]} one string per sequence */
const fromCps = (...seqs) => seqs.map((cps) => String.fromCodePoint(...cps))

/** Labels of finding S-1b-01: each must stay whole on ONE line. */
const LABEL_FINDING = ['OK', 'TODO', 'WICHTIG', '👍', '会议记录']

/** Longer labels: wrapped, multi-line, other scripts, emoji sequences (❤+VS16, skin tone, flag, ZWJ family). */
const LABEL_MORE = [
	'Kundenzufriedenheit Barrierefreiheit Datenschutzerklärung', 'ÄÖÜ äöü ß', 'Привет, мир', 'zwei\nZeilen',
	'会议记录'.repeat(8), '👍'.repeat(20), 'W'.repeat(40),
	fromCps([0x2764, 0xfe0f], [0x2705], [0x1f44d, 0x1f3fd], [0x1f1e9, 0x1f1ea], [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467]).join(' '),
]

/** Glyphs and sequences beyond Latin-1 whose real width must stay within labelGlyphWidth. */
const GLYPH_SAMPLES = [
	...'ЉЊЖШЩЮжшщюΩΣΨω€₧№™…—‰ẞŴŒœ',
	...'会议记录あアカ한글ＡｗＷ',
	...'👍😀🎉❤✅⭐⌚☀→',
	String.fromCodePoint(0x3000),
	...fromCps([0x2764, 0xfe0f], [0x1f44d, 0x1f3fd], [0x1f1e9, 0x1f1ea], [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467], [0x23, 0xfe0f, 0x20e3]),
]

/**
 * Connector labels in this browser (finding S-1b-01): sets labels on the
 * first hub connector (LOD 0) one after the other and reads the layout Konva
 * made of each (KonvaRenderer.nodeTextLayout) next to the model's estimated
 * box; then measures every printable Latin-1 glyph and GLYPH_SAMPLES with
 * the label font against labelGlyphWidth. The connector gets its label back.
 *
 * @return {Promise<object>}
 */
async function labelCheck() {
	const id = meta.hubConnectorIds[0]
	await focusItem(meta.hubNoteId, 1)
	const orig = structuredClone(model.get(id))
	const labels = []
	for (const text of [...LABEL_FINDING, ...LABEL_MORE]) {
		const c = structuredClone(model.get(id))
		c.data.label = text
		scene.update(model.apply({ upserts: [c] }))
		await idle()
		labels.push({
			text,
			finding: LABEL_FINDING.includes(text),
			box: model.routeOf(id)?.label ?? null,
			layout: scene.renderer.nodeTextLayout(id),
			level: scene.renderer.nodeLevel(id),
		})
	}
	scene.update(model.apply({ upserts: [orig] }))
	await idle()
	const g = document.createElement('canvas').getContext('2d')
	g.font = `${CONNECTOR_LABEL_FONT_SIZE}px ${FONT_FAMILY}`
	const over = []
	let n = 0
	const probe = (s) => {
		n++
		const real = g.measureText(s).width
		let est = 0
		for (const ch of s) est += labelGlyphWidth(ch.codePointAt(0), CONNECTOR_LABEL_FONT_SIZE)
		if (real > est) over.push({ s, real, est })
	}
	for (let cp = 0x20; cp <= 0xff; cp++) {
		if (cp <= 0x7e || cp >= 0xa0) probe(String.fromCodePoint(cp))
	}
	GLYPH_SAMPLES.forEach(probe)
	return { pad: CONNECTOR_LABEL_PAD, labels, restored: scene.renderer.nodeText(id) === orig.data.label, glyphs: { n, over } }
}

/**
 * Canvas probe for the memory part of the report (§9.4 "Seitenspeicher mit
 * zwei Canvas"): pixel size of every backing store the scene holds, i.e. the
 * scene canvas of each layer, its hit canvas (0 × 0 while listening is false)
 * and an isolation surface if Konva allocated one, plus the stage's lazy hit
 * buffer. memory.js turns this into bytes.
 *
 * @return {{dom: number, pixelRatio: number, list: Array<{name: string, w: number, h: number}>}}
 */
function canvasMemory() {
	const stage = scene.renderer.stage
	const list = []
	const add = (name, el) => {
		if (el) list.push({ name, w: el.width, h: el.height })
	}
	stage.getLayers().forEach((layer, i) => {
		const name = i === 0 ? 'static' : i === 1 ? 'overlay' : `layer${i}`
		add(name, layer.getCanvas()._canvas)
		add(name + ':hit', layer.getHitCanvas()._canvas)
		add(name + ':isolation', layer.getCanvas()._isolationCanvas?._canvas)
	})
	add('stage:bufferHit', stage.bufferHitCanvas?._canvas)
	return { dom: container.querySelectorAll('canvas').length, pixelRatio: Konva.pixelRatio, list }
}

/** Amplitude of the whole-board pan in measure() (screen px, below the 48 px fit padding). */
const BOARD_PAN_PX = 40

/**
 * One measured camera series: fn(i) moves the camera, one frame per step;
 * frame times, the camera step and what the renderer holds (attached nodes,
 * static children, LOD) are read from the same stats() call after each step.
 *
 * @param {number} steps camera steps (one per frame)
 * @param {(i:number) => void} fn camera step i
 * @param {number} refreshMs rAF interval when idle (metrics.js)
 * @return {Promise<object>} frames, camera, draw per layer, attached, staticChildren, lods
 */
async function cameraSeries(steps, fn, refreshMs) {
	await idle()
	const meter = new FrameMeter()
	const cameraMs = []
	// read from the same stats() call as the camera step (no extra work per frame)
	const attached = []
	const statics = []
	const lods = new Set()
	const d0 = drawLog.length
	meter.start()
	for (let i = 0; i < steps; i++) {
		fn(i)
		await frame()
		const st = scene.stats()
		cameraMs.push(st.lastCameraMs)
		attached.push(st.attached)
		statics.push(st.staticChildren)
		lods.add(st.lod)
	}
	await idle()
	const drawn = drawLog.slice(d0)
	const drawMs = (layer) => summarize(drawn.filter((x) => x.layer === layer).map((x) => x.ms))
	return {
		frames: meter.stop(refreshMs),
		camera: summarize(cameraMs),
		draw: { static: drawMs('static'), overlay: drawMs('overlay') },
		attached: { min: Math.min(...attached), max: Math.max(...attached) },
		staticChildren: { min: Math.min(...statics), max: Math.max(...statics) },
		lods: [...lods].sort(),
	}
}

let mid = null
/** @return {{x:number, y:number}} centre of the whole board (world), taken once: camera steps stay O(1) */
function boardMid() {
	if (!mid) {
		const b = model.allBounds()
		mid = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
	}
	return mid
}

/**
 * @param {number} s scale
 * @param {{x:number, y:number}} [at] world point in the viewport centre (default: the board centre)
 * @return {{x:number, y:number, scale:number}} camera
 */
function camAt(s, at = boardMid()) {
	return { x: at.x - vw / (2 * s), y: at.y - vh / (2 * s), scale: s }
}

/** Scales of the G14 zoom series around 0.08: all below LOD2_ENTER (SPEC-M1 §8.5 G14 (2)). */
const LOD2_ZOOM = Object.freeze({ from: 0.065, to: 0.094, steps: 180 })

/**
 * @param {number} i step
 * @return {number} scale of step i: from → to → from, geometric
 */
function lod2ZoomScale(i) {
	const u = i < LOD2_ZOOM.steps / 2 ? i / (LOD2_ZOOM.steps / 2) : (LOD2_ZOOM.steps - i) / (LOD2_ZOOM.steps / 2)
	return Math.exp(Math.log(LOD2_ZOOM.from) + (Math.log(LOD2_ZOOM.to) - Math.log(LOD2_ZOOM.from)) * u)
}

/**
 * Figure eight of the whole-board pan at a fixed scale (±BOARD_PAN_PX screen px).
 *
 * @param {{x:number, y:number, scale:number}} c0 start camera
 * @param {number} i step of 180
 * @return {{x:number, y:number, scale:number}}
 */
function boardPanCam(c0, i) {
	const a = (2 * Math.PI * i) / 180
	const s = c0.scale
	return { x: c0.x + (BOARD_PAN_PX * Math.sin(a)) / s, y: c0.y + (BOARD_PAN_PX * Math.sin(2 * a)) / (2 * s), scale: s }
}

/**
 * First render at a scale (G14 (3): the whole board at 0.05): the model is
 * reloaded and the scene reset first (no node, no LOD-2 paint order, no
 * cached look survives), the camera settles at 100 % on the dense frame;
 * then one camera step to the board centre at the scale, until the end of
 * the next static-layer draw.
 *
 * @param {number} scale target scale
 * @return {Promise<{ms:(number|null), scale:number, lod:number, staticChildren:number, painted:number}>}
 */
async function firstRenderAt(scale) {
	model.load(model.sortByOrder([...model.ids()]).map((id) => structuredClone(model.get(id))))
	scene.reset()
	scene.setSelection([])
	await focusItem(meta.centerNoteIds[0], 1)
	const before = drawLog.length
	const t0 = performance.now()
	scene.setCamera(camAt(scale))
	await idle()
	const hit = drawLog.slice(before).find((d) => d.layer === 'static')
	const st = scene.stats()
	return {
		ms: hit ? Math.round((hit.t - t0) * 10) / 10 : null, scale: st.camera.scale, lod: st.lod,
		staticChildren: st.staticChildren, painted: scene.renderer.coarsePainted().ids.length,
	}
}

/**
 * G14 (4): the camera wobbles around LOD_COARSE_SCALE by ±0.004, once
 * coming from LOD 1 and once from LOD 2; the level must not change. Then
 * the thresholds do switch: just above LOD2_LEAVE → 1, just below
 * LOD2_ENTER → 2.
 *
 * @return {Promise<object>}
 */
async function lod2Hysteresis() {
	const wobble = async () => {
		const lods = new Set()
		let switches = 0
		let last = scene.stats().lod
		for (let i = 0; i <= 90; i++) {
			scene.setCamera(camAt(LOD_COARSE_SCALE + 0.004 * Math.sin(i / 4)))
			await frame()
			const lod = scene.stats().lod
			if (lod !== last) switches++
			last = lod
			lods.add(lod)
		}
		await idle()
		return { lods: [...lods], switches }
	}
	scene.setCamera(camAt(0.2))
	await idle()
	const from1 = await wobble()
	scene.setCamera(camAt(0.09))
	await idle()
	const from2 = await wobble()
	scene.setCamera(camAt(LOD2_LEAVE + 0.001))
	await idle()
	const left = scene.stats().lod
	scene.setCamera(camAt(LOD2_ENTER - 0.001))
	await idle()
	const entered = scene.stats().lod
	return { from1, from2, left, entered, band: [LOD_COARSE_SCALE - 0.004, LOD_COARSE_SCALE + 0.004], enter: LOD2_ENTER, leave: LOD2_LEAVE }
}

/**
 * G14 (5): drags the note with six connectors (meta.hubNoteId) at a LOD-2
 * scale with real pointer events: 0 static draws while dragging (no LOD-2
 * paint either), one static node, the note is a node in the activeGroup and
 * missing from the painted list, its connectors are drawn nowhere (R13 (b));
 * after the release the board is painted again with the note.
 *
 * @param {number} scale LOD-2 scale (0.08)
 * @param {number} [steps] moves (one per frame)
 * @return {Promise<object>}
 */
async function coarseDrag(scale, steps = 60) {
	const id = meta.hubNoteId
	const a = model.abs(id)
	scene.setSelection([])
	scene.setCamera(camAt(scale, { x: a.x + a.w / 2, y: a.y + a.h / 2 }))
	await idle()
	const c = scene.itemScreenRect(id)
	const x0 = c.x + c.w / 2
	const y0 = c.y + c.h / 2
	const hitAtPress = model.hitTest(a.x + a.w / 2, a.y + a.h / 2, 4 / scale, { accept: (k) => model.get(k)?.t !== 'connector' })
	clearLog()
	mouse('pointerdown', x0, y0)
	mouse('pointermove', x0 + 6, y0 + 3)
	await frames(2)
	const d0 = draws()
	const p0 = scene.renderer.coarsePainted()
	const statics = []
	const actives = []
	for (let i = 2; i <= steps + 1; i++) {
		mouse('pointermove', x0 + 6 * i, y0 + 3 * i)
		await frame()
		const st = scene.stats()
		statics.push(st.staticChildren)
		actives.push(st.activeChildren)
	}
	const d1 = draws()
	const p1 = scene.renderer.coarsePainted()
	const conns = new Set(meta.hubConnectorIds)
	const during = {
		lod: scene.stats().lod,
		paintedHasNote: p1.ids.includes(id),
		paintedConnectors: p1.ids.filter((k) => model.get(k)?.t === 'connector').length,
		connectorsActive: meta.hubConnectorIds.every((k) => scene.isActive(k)),
		connectorsInLayers: scene.renderer.stage.find((n) => conns.has(n.getAttr('kid'))).length,
	}
	mouse('pointerup', x0 + 6 * (steps + 1), y0 + 3 * (steps + 1))
	await idle()
	const intent = log.find((e) => e[0] === 'intent' && e[1].type === 'move')
	const after = scene.renderer.coarsePainted()
	return {
		hub: id,
		hitAtPress: hitAtPress === id,
		frames: steps,
		staticDrawsDuring: d1.static - d0.static,
		paintsDuring: p1.paints - p0.paints,
		staticChildren: { min: Math.min(...statics), max: Math.max(...statics) },
		activeChildren: { min: Math.min(...actives), max: Math.max(...actives) },
		...during,
		intent: intent ? { ids: intent[1].ids, dx: intent[1].dx, dy: intent[1].dy } : null,
		after: { paintedHasNote: after.ids.includes(id), lod: scene.stats().lod, activeChildren: scene.stats().activeChildren },
	}
}

/**
 * Gate G14 (SPEC-M1 §8.5, R13): LOD 2 with the M1 set. (3) first render at
 * MIN_SCALE (0.05), (4) hysteresis, (1)+(2) one static child and the camera
 * step at 0.08 and in the zoom series around 0.08 (all scales below
 * LOD2_ENTER), (1)+(2) the whole-board pan at 0.05, (5) dragging at 0.08.
 * fps and % missed are reported, not gated.
 *
 * @return {Promise<object>}
 */
async function lod2Gate() {
	const refreshMs = await measureRefresh(20)
	const out = { refreshMs }
	out.firstRender = await firstRenderAt(MIN_SCALE)
	out.hysteresis = await lod2Hysteresis()
	scene.setSelection([])
	scene.setCamera(camAt(0.08))
	await idle()
	const st = scene.stats()
	out.at008 = { lod: st.lod, staticChildren: st.staticChildren, visible: st.visible, painted: scene.renderer.coarsePainted().ids.length }
	out.zoom = await cameraSeries(LOD2_ZOOM.steps, (i) => scene.setCamera(camAt(lod2ZoomScale(i))), refreshMs)
	out.zoom.scales = { from: LOD2_ZOOM.from, to: LOD2_ZOOM.to }
	scene.setCamera(camAt(MIN_SCALE))
	await idle()
	const c0 = scene.getCamera()
	out.boardPan = await cameraSeries(180, (i) => scene.setCamera(boardPanCam(c0, i)), refreshMs)
	out.boardPan.scale = c0.scale
	out.drag = await coarseDrag(0.08)
	return out
}

/**
 * Real-mouse targets at LOD 2 (run.mjs clicks them): the centre of a note
 * (its own topmost hit), a point on a connector line away from every box
 * (the connector is hit there only while connectors count), and a rectangle
 * for the marquee with notes and whole connectors inside. Client
 * coordinates of the current camera.
 *
 * @param {number} scale LOD-2 scale
 * @return {Promise<object>}
 */
async function lod2Targets(scale) {
	scene.setSelection([])
	scene.setCamera(camAt(scale))
	await idle()
	const b = container.getBoundingClientRect()
	const toClient = (w) => {
		const p = scene.worldToScreen(w.x, w.y)
		return { x: b.left + p.x, y: b.top + p.y }
	}
	const tol = 4 / scale
	const noConn = { accept: (k) => model.get(k)?.t !== 'connector' }
	const inView = (p) => p.x > b.left + 40 && p.x < b.right - 40 && p.y > b.top + 40 && p.y < b.bottom - 40
	let note = null
	for (const id of meta.centerNoteIds) {
		const a = model.abs(id)
		const w = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
		if (model.hitTest(w.x, w.y, tol, noConn) === id && inView(toClient(w))) {
			note = { id, at: toClient(w) }
			break
		}
	}
	let line = null
	for (const id of meta.connectorIds) {
		const g = model.geometryOf(id)
		if (!g) continue
		const pts = g.hitPts
		const k = Math.floor(pts.length / 4) * 2
		const w = { x: pts[k], y: pts[k + 1] }
		if (model.hitTest(w.x, w.y, tol) === id && model.hitTest(w.x, w.y, 3 * tol, noConn) === null &&
			model.queryRect({ x: w.x - 3 * tol, y: w.y - 3 * tol, w: 6 * tol, h: 6 * tol }).every((x) => model.get(x)?.t === 'connector') &&
			inView(toClient(w))) {
			line = { id, at: toClient(w) }
			break
		}
	}
	// marquee: 640 × 400 screen px around the dense frame (inside the viewport), with whole
	// connectors inside; it starts on empty canvas (the top-left corner moves until nothing is hit)
	const d = meta.denseRect
	// the dense frame's centre, moved inside the viewport far enough for the whole rectangle
	const sc = scene.worldToScreen(d.x + d.w / 2, d.y + d.h / 2)
	const c = scene.screenToWorld(Math.min(Math.max(sc.x, 400), vw - 400), Math.min(Math.max(sc.y, 280), vh - 280))
	const r = { x: c.x - 320 / scale, y: c.y - 200 / scale, w: 640 / scale, h: 400 / scale }
	for (let i = 0; i < 60 && model.hitTest(r.x, r.y, tol, noConn) !== null; i++) {
		r.x -= 4 / scale
		r.y -= 4 / scale
		r.w += 4 / scale
		r.h += 4 / scale
	}
	const inside = model.queryRect(r, 'contain')
	const marquee = {
		from: toClient({ x: r.x, y: r.y }), to: toClient({ x: r.x + r.w, y: r.y + r.h }),
		startEmpty: model.hitTest(r.x, r.y, tol, noConn) === null,
		inView: inView(toClient({ x: r.x, y: r.y })) && inView(toClient({ x: r.x + r.w, y: r.y + r.h })),
		connectorsInside: inside.filter((x) => model.get(x)?.t === 'connector').length,
		notesInside: inside.filter((x) => model.get(x)?.t === 'sticky').length,
	}
	return { note, line, marquee, lod: scene.stats().lod }
}

/**
 * (R14-13) Real-mouse targets on a painted frame title at LOD 2 (run.mjs
 * clicks them): the first frame in view whose title LOD 2 paints, with a
 * point on its title 13–14 px above the top edge, and a point at the same
 * height beside the title (over the frame, ≥ 8 px right of the title plus
 * tolerance). Both points lie outside the bands of rule (d) (title band
 * FRAME_TITLE_BAND · scale + 4 px, border band 8 + 4 px above the edge: the
 * old hit test misses them) and ±20 px around them is nothing but the frame
 * (no other item, so no other frame title either). The title width is
 * measured here on a canvas of its own (12-px font, fitTitle), independent of
 * the renderer; the renderer's recorded rectangle is compared with it.
 * Client coordinates (integers) of the current camera.
 *
 * @param {number} scale LOD-2 scale
 * @return {Promise<object>}
 */
async function lod2TitleTargets(scale) {
	scene.setSelection([])
	scene.setCamera(camAt(scale))
	await idle()
	const b = container.getBoundingClientRect()
	const g = document.createElement('canvas').getContext('2d')
	g.font = `${COARSE_TITLE_PX}px ${FONT_FAMILY}`
	const measure = (str) => g.measureText(str).width
	const tol = HIT_TOL_MOUSE_PX / scale
	// the scene's hit test before R14-13 (rule (c) and (d) at LOD 2, InputController)
	const oldHit = (w) => model.hitTest(w.x, w.y, tol, { edgeWorld: FRAME_EDGE_HIT_PX / scale, accept: (k) => model.get(k)?.t !== 'connector' })
	const r20 = 20 / scale
	const alone = (w, id) => model.queryRect({ x: w.x - r20, y: w.y - r20, w: 2 * r20, h: 2 * r20 }).every((k) => k === id)
	const inView = (x, y) => x > b.left + 40 && x < b.right - 40 && y > b.top + 40 && y < b.bottom - 40
	const toWorld = (x, y) => scene.screenToWorld(x - b.left, y - b.top)
	const recorded = scene.renderer.coarseTitles()
	const bands = { titleBandPx: FRAME_TITLE_BAND * scale + HIT_TOL_MOUSE_PX, borderBandPx: FRAME_EDGE_HIT_PX + HIT_TOL_MOUSE_PX, boxPx: COARSE_TITLE_BOX_PX }
	let target = null
	let tried = 0
	for (const id of meta.frameIds) {
		const a = model.abs(id)
		const wPx = a.w * scale
		const title = model.get(id).data.title
		if (!title || wPx < COARSE_TITLE_MIN_PX) continue
		const text = fitTitle(measure, title, wPx)
		if (text === '') continue
		tried++
		const tw = measure(text)
		const p = scene.worldToScreen(a.x, a.y)
		const left = b.left + p.x
		const top = b.top + p.y
		const y = Math.floor(top - 13)
		const on = { x: Math.round(left + tw / 2), y }
		const beside = { x: Math.ceil(left + tw + HIT_TOL_MOUSE_PX + 8), y }
		if (beside.x > left + wPx - 30 || !inView(on.x, on.y) || !inView(beside.x, beside.y)) continue
		const wOn = toWorld(on.x, on.y)
		const wBeside = toWorld(beside.x, beside.y)
		if (oldHit(wOn) !== null || oldHit(wBeside) !== null || !alone(wOn, id) || !alone(wBeside, id)) continue
		const rec = recorded.find((r) => r.id === id) ?? null
		target = {
			id, title: text, titlePx: tw, frameTop: top, above: top - y, on, beside,
			recorded: rec && { x: rec.x, y: rec.y, wPx: rec.w * scale, hPx: rec.h * scale },
			recordedOk: !!rec && Math.abs(rec.w * scale - tw) <= 1.5 && Math.abs(rec.h * scale - COARSE_TITLE_BOX_PX) < 1e-6 &&
				Math.abs(rec.x - a.x) < 1e-6 && Math.abs(rec.y + rec.h - a.y) < 1e-6,
		}
		break
	}
	return { target, tried, bands, lod: scene.stats().lod, recordedTitles: recorded.length }
}

/**
 * The LOD-2 painting (SPEC-M1 §6.3 table, R13 (a), (b)): one static draw at
 * a LOD-2 scale with spies on the 2D context: every painted id is one
 * fillRect (frames: fill + one strokeRect for the 1-px border), the frames
 * with a title from COARSE_TITLE_MIN_PX on get one fillText, no connector
 * is painted, the painted ids are the non-connector ids in view in
 * compareOrder; then a remote drag preview of a note: it leaves the painting
 * (one static draw) and comes back when the preview ends.
 *
 * @param {number} scale LOD-2 scale
 * @return {Promise<object>}
 */
async function coarsePaintCheck(scale) {
	scene.setSelection([])
	scene.setCamera(camAt(scale))
	await idle()
	const proto = CanvasRenderingContext2D.prototype
	const spy = { fillRect: 0, strokeRect: 0, fillText: 0, texts: [] }
	const own = { fillRect: proto.fillRect, strokeRect: proto.strokeRect, fillText: proto.fillText }
	proto.fillRect = function (...a) { spy.fillRect++; return own.fillRect.apply(this, a) }
	proto.strokeRect = function (...a) { spy.strokeRect++; return own.strokeRect.apply(this, a) }
	proto.fillText = function (...a) { spy.fillText++; spy.texts.push(a[0]); return own.fillText.apply(this, a) }
	const d0 = draws()
	try {
		// one camera step of a hair: one static draw, nothing else changes
		const c = scene.getCamera()
		scene.setCamera({ ...c, x: c.x + 1 })
		await idle()
	} finally {
		Object.assign(proto, own)
	}
	const d1 = draws()
	const painted = scene.renderer.coarsePainted().ids
	const st = scene.stats()
	const r = cullRectOf(scene.getCamera(), vw, vh, st.overscan, CULL_MARGIN)
	// everything in view that LOD 2 paints: no connector, no shape without fill and stroke (nothing to see)
	const expected = model.sortByOrder(model.query(r.minX, r.minY, r.maxX, r.maxY).map((e) => e.id)
		.filter((id) => model.get(id).t !== 'connector' && coarseLook(model.get(id)).cls !== 'skip'))
	const invisible = model.query(r.minX, r.minY, r.maxX, r.maxY)
		.filter((e) => e.t === 'shape' && coarseLook(model.get(e.id)).cls === 'skip').length
	const framesPainted = painted.filter((id) => model.get(id).t === 'frame')
	const titled = framesPainted.filter((id) => model.abs(id).w * scale >= COARSE_TITLE_MIN_PX && model.get(id).data.title)
	// a remote drag preview of a note: out of the painting (one static draw), back after
	const victim = meta.centerNoteIds[1]
	const a = model.abs(victim)
	const pd0 = draws()
	samples = [{ key: 'pidLod:c1', pid: 'pidLod', name: 'Lod Lea', color: '#2f6fdb', guest: false, cursor: null,
		selection: [], drag: [[victim, a.x + 400, a.y]], editing: null, editingHolder: false }]
	scene.presenceChanged()
	await frames(3)
	const pd1 = draws()
	const preview = { inPainting: scene.renderer.coarsePainted().ids.includes(victim), activeChildren: scene.stats().activeChildren, staticDraws: pd1.static - pd0.static }
	samples = []
	scene.presenceChanged()
	await idle()
	preview.back = scene.renderer.coarsePainted().ids.includes(victim)
	return {
		lod: st.lod, staticChildren: st.staticChildren, staticDraws: d1.static - d0.static,
		painted: painted.length, expected: expected.length, sameOrder: JSON.stringify(painted) === JSON.stringify(expected),
		connectorsPainted: painted.filter((id) => model.get(id).t === 'connector').length,
		fillRect: spy.fillRect, strokeRect: spy.strokeRect, fillText: spy.fillText, frames: framesPainted.length, titled: titled.length,
		titles: spy.texts.slice(0, 3), invisibleShapes: invisible, preview,
	}
}

// ---------------------------------------------------------------- job 034: overscan of the stage (M2, SPEC-M1 §6.3)

/**
 * @return {{l:number, t:number, r:number, b:number}} how far each edge of .konvajs-content lies inside
 *   the container (CSS px; at most COVER_TOL_PX everywhere = the stage covers the container)
 */
function contentGaps() {
	const c = container.getBoundingClientRect()
	const k = scene.renderer.contentEl.getBoundingClientRect()
	return { l: k.left - c.left, t: k.top - c.top, r: c.right - k.right, b: c.bottom - k.bottom }
}

/** @param {{l:number, t:number, r:number, b:number}} g gaps @return {boolean} covered within COVER_TOL_PX */
const coveredBy = (g) => Math.max(g.l, g.t, g.r, g.b) <= COVER_TOL_PX

/** @return {Array<{w:number, h:number}>} bitmap sizes of the static and the overlay canvas */
function layerBitmaps() {
	return scene.renderer.stage.getLayers().map((l) => {
		const c = l.getCanvas()._canvas
		return { w: c.width, h: c.height }
	})
}

/**
 * Check "Überstand" (job 034): stats().overscan, both layer bitmaps,
 * .konvajs-content at (−l, −t) without a resting transform and its rect,
 * the host's computed overflow (clip), scrollTo on the document and on the
 * host moves nothing; a second KonvaRenderer on a helper host with an
 * inline overflow auto sets clip at mount and restores auto at destroy.
 *
 * @return {Promise<object>}
 */
async function overscanCheck() {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	await idle()
	const content = scene.renderer.contentEl
	const cr = container.getBoundingClientRect()
	const kr = content.getBoundingClientRect()
	const cs = getComputedStyle(container)
	const out = {
		overscan: scene.stats().overscan,
		layers: layerBitmaps(),
		style: { left: content.style.left, top: content.style.top, transform: content.style.transform },
		rect: { l: cr.left - kr.left, t: cr.top - kr.top, r: kr.right - cr.right, b: kr.bottom - cr.bottom },
		overflow: { x: cs.overflowX, y: cs.overflowY },
	}
	const se = document.scrollingElement
	se.scrollTo(500, 500)
	container.scrollTo(500, 500)
	await frame()
	out.scroll = [se.scrollLeft, se.scrollTop, container.scrollLeft, container.scrollTop, document.body.scrollLeft, document.body.scrollTop]
	const host = document.createElement('div')
	host.style.cssText = 'position: absolute; left: 0; top: 0; width: 400px; height: 300px; visibility: hidden'
	host.style.overflow = 'auto'
	document.body.appendChild(host)
	try {
		const r = new KonvaRenderer(host, new SceneModel(), { shadows: false })
		r.mount(400, 300)
		out.second = { given: 'auto', mounted: host.style.overflow, computed: getComputedStyle(host).overflowX, overscan: r.stats().overscan }
		r.destroy()
		out.second.destroyed = host.style.overflow
	} finally {
		host.remove()
	}
	return out
}

/**
 * Check "Überstand bei Größenänderung" (job 034): the container is resized
 * through its inline style (the scene's ResizeObserver path) to 1920 × 1000
 * (stage kept, t = b = 424), 1080 × 1920 (new, 1848 × 2688), 1920 × 1080
 * (new, 2688 × 1848); a spy on stage.setAttrs counts the reallocations
 * (width/height); after each change the stage covers the container and the
 * static layer was drawn. Then a touch pan (24 × 12 px, mode view) is cut in
 * the middle by the change to 1920 × 1000 (resizeDuringPan). The container
 * style is restored at the end.
 *
 * @return {Promise<object>}
 */
async function overscanResizeCheck() {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	await idle()
	const saved = container.getAttribute('style')
	const stage = scene.renderer.stage
	const own = stage.setAttrs
	let allocs = 0
	stage.setAttrs = function (a) {
		if (a && ('width' in a || 'height' in a)) allocs++
		return own.call(this, a)
	}
	const sizeTo = (w, h) => {
		container.style.right = 'auto'
		container.style.bottom = 'auto'
		container.style.width = `${w}px`
		container.style.height = `${h}px`
	}
	const change = async (w, h) => {
		const a0 = allocs
		const s0 = draws().static
		sizeTo(w, h)
		await frames(2)
		await idle()
		const g = contentGaps()
		return {
			size: [container.clientWidth, container.clientHeight], overscan: scene.stats().overscan, layer: layerBitmaps()[0],
			reallocated: allocs - a0, staticDraws: draws().static - s0, covered: coveredBy(g), gaps: g,
		}
	}
	const out = {}
	try {
		out.short = await change(1920, 1000)
		out.portrait = await change(1080, 1920)
		out.back = await change(1920, 1080)
		out.gesture = await resizeDuringPan(sizeTo)
		out.restored = await change(1920, 1080)
	} finally {
		delete stage.setAttrs
		container.setAttribute('style', saved)
		await frames(2)
		await idle()
		await focusItem(meta.centerNoteIds[0], 1)
	}
	return out
}

/**
 * A touch pan in mode view (24 moves of 12 px, 288 px in all) whose 13th
 * move comes with the container change to 1920 × 1000: per frame the static
 * draws, the overscan top and the coverage; the frame in which the scene
 * takes the new size (overscan.t changes), the end draw and the camera shift.
 *
 * @param {(w:number, h:number) => void} sizeTo sets the container size
 * @return {Promise<object>}
 */
async function resizeDuringPan(sizeTo) {
	scene.setMode('view')
	await idle()
	try {
		const c0 = scene.getCamera()
		const x0 = vw / 2
		const y0 = vh / 2
		const rows = []
		const s0 = draws().static
		touch('pointerdown', 61, x0, y0)
		await frame()
		for (let i = 1; i <= 24; i++) {
			if (i === 13) sizeTo(1920, 1000)
			touch('pointermove', 61, x0 - 12 * i, y0)
			const d0 = draws().static
			await frame()
			const st = scene.stats()
			rows.push({ statics: st.draws.static - d0, t: st.overscan?.t ?? null, covered: coveredBy(contentGaps()), css: st.cssTransform !== null })
		}
		const sEnd = draws().static
		touch('pointerup', 61, x0 - 288, y0)
		await idle()
		const c1 = scene.getCamera()
		const takeover = rows.findIndex((r) => r.t !== rows[0].t)
		return {
			frames: rows.length,
			drawFrames: rows.flatMap((r, i) => (r.statics > 0 ? [i] : [])),
			drawsDuring: sEnd - s0,
			takeover,
			tBefore: rows[0].t,
			tAfter: takeover >= 0 ? rows[takeover].t : null,
			covered: rows.every((r) => r.covered),
			endDraws: draws().static - sEnd,
			dx: (c1.x - c0.x) * c0.scale,
			dy: (c1.y - c0.y) * c0.scale,
			overscan: scene.stats().overscan,
		}
	} finally {
		scene.setMode('edit')
	}
}

/** G20: the band's notes, its probe points (world), the camera of every run start, the run in progress. */
const edge = { ids: [], points: [], cam0: null, run: null }

/**
 * Gate G20 "Rand ohne Lücke", setup: far right of the board (nothing else
 * near), opaque notes without text as an L-shaped band across the right and
 * the bottom viewport edge of the start camera (100 %), reaching into the
 * overscan at rest (first column at vw − 40, first row at vh − 40, 200 × 200
 * with 20 px gaps). The probe points are the note interiors (at least 16
 * world px from a note edge) on a 6-px grid: every strip of 10 px or more
 * contains some.
 *
 * @return {{notes:number, points:number, camera:object}}
 */
function edgeSetup() {
	const b = model.allBounds()
	const X = Math.round((b.x + b.w + 30000) / 100) * 100
	const Y = Math.round((b.y + 2000) / 100) * 100
	edge.cam0 = { x: X, y: Y, scale: 1 }
	const cells = []
	for (let c = 0; c < 5; c++) {
		for (let y = -400; y < vh + 720; y += 220) cells.push([vw - 40 + 220 * c, y])
	}
	for (let x = -400; x + 200 <= vw - 60; x += 220) {
		for (let r = 0; r < 4; r++) cells.push([x, vh - 40 + 220 * r])
	}
	let z = model.maxZ('content')
	const upserts = []
	edge.ids = []
	edge.points = []
	for (const [sx, sy] of cells) {
		z = keyBetween(z, null)
		const id = ulid()
		edge.ids.push(id)
		upserts.push({ id, t: 'sticky', x: X + sx, y: Y + sy, w: 200, h: 200, r: 0, z, parent: null, data: { text: '' }, style: { fill: '#a8d8f8' } })
		for (let py = 16; py <= 184; py += 6) {
			for (let px = 16; px <= 184; px += 6) edge.points.push({ x: X + sx + px, y: Y + sy + py })
		}
	}
	scene.update(model.apply({ upserts }))
	scene.setSelection([])
	return { notes: edge.ids.length, points: edge.points.length, camera: edge.cam0 }
}

/**
 * A G20 run starts at the start camera, the scene idle.
 *
 * @param {string} mode scene mode of the run (touch: view, no finger claims a note)
 * @return {Promise<object>} the run record
 */
async function edgeStart(mode) {
	scene.setMode(mode)
	scene.setCamera(edge.cam0)
	await idle()
	const st = scene.stats()
	const d = draws()
	edge.run = {
		c0: st.camera, ov: st.overscan, lives: [], d0: d, dLast: d, lastStatic: d.static, drawFrames: [],
		probesMin: Infinity, misses: 0, missSample: [], uncovered: 0, worstGap: -Infinity, stepAt: [],
	}
	return edge.run
}

/**
 * One frame of a G20 run, after the scene's frame with the live camera ran:
 * coverage (the .konvajs-content rect contains the container, ≤ 1 px gap per
 * edge), and 16 probe points of the newly exposed strip (world points of the
 * band, outside the viewport at the run start, now at least 2 px inside it)
 * read from the static layer's canvas at ((p − (tx, ty))/k + (l, t)) · pr,
 * {k, tx, ty} = cssTransformFor(renderer.camera, liveCamera): alpha < 250 is a
 * miss. A static draw since the last frame marks this frame as redrawn.
 *
 * @param {object} run edge.run
 */
function edgeSample(run) {
	const st = scene.stats()
	const live = st.liveCamera
	const ov = st.overscan ?? { l: 0, t: 0 }
	const { k, tx, ty } = cssTransformFor(scene.renderer.camera, live)
	const pr = Konva.pixelRatio
	const g = contentGaps()
	if (!coveredBy(g)) run.uncovered++
	run.worstGap = Math.max(run.worstGap, g.l, g.t, g.r, g.b)
	const c0 = run.c0
	const fresh = edge.points.filter((p) => {
		const x0 = (p.x - c0.x) * c0.scale
		const y0 = (p.y - c0.y) * c0.scale
		if (x0 >= 0 && x0 <= vw && y0 >= 0 && y0 <= vh) return false
		const x1 = (p.x - live.x) * live.scale
		const y1 = (p.y - live.y) * live.scale
		return x1 >= 2 && x1 <= vw - 2 && y1 >= 2 && y1 <= vh - 2
	})
	const n = Math.min(16, fresh.length)
	const ctx = scene.renderer.stage.getLayers()[0].getCanvas()._canvas.getContext('2d')
	for (let i = 0; i < n; i++) {
		const p = fresh[Math.floor((i * fresh.length) / n)]
		const cx = Math.floor((((p.x - live.x) * live.scale - tx) / k + ov.l) * pr)
		const cy = Math.floor((((p.y - live.y) * live.scale - ty) / k + ov.t) * pr)
		const a = ctx.getImageData(cx, cy, 1, 1).data[3]
		if (!(a >= 250)) {
			run.misses++
			if (run.missSample.length < 3) run.missSample.push({ frame: run.lives.length, cx, cy, a })
		}
	}
	run.probesMin = Math.min(run.probesMin, n)
	const d = draws()
	if (d.static !== run.lastStatic) run.drawFrames.push(run.lives.length)
	run.lastStatic = d.static
	run.dLast = d
	run.lives.push({ ...live })
}

/**
 * @param {object} run edge.run after the gesture ended and the scene is idle
 * @return {object} frames, probes, misses, coverage, draws during and at the end, the redraw frames measured and
 *   predicted (gestureRedrawFrames from the live cameras), the transform afterwards
 */
function edgeSummary(run) {
	const d = draws()
	const last = run.lives.at(-1) ?? run.c0
	const gaps = run.stepAt.slice(1).map((t, i) => t - run.stepAt[i])
	return {
		frames: run.lives.length,
		probesMin: Number.isFinite(run.probesMin) ? run.probesMin : 0,
		misses: run.misses,
		missSample: run.missSample,
		uncovered: run.uncovered,
		worstGap: Math.round(run.worstGap * 100) / 100,
		during: { static: run.dLast.static - run.d0.static, overlay: run.dLast.overlay - run.d0.overlay },
		end: { static: d.static - run.dLast.static, overlay: d.overlay - run.dLast.overlay },
		drawFrames: run.drawFrames,
		predicted: gestureRedrawFrames(run.c0, run.lives, vw, vh, run.ov),
		k: Math.round((last.scale / run.c0.scale) * 10000) / 10000,
		pan: { x: Math.round((last.x - run.c0.x) * run.c0.scale), y: Math.round((last.y - run.c0.y) * run.c0.scale) },
		maxStepGapMs: gaps.length ? Math.round(Math.max(...gaps)) : null,
		cssAfter: scene.stats().cssTransform,
		transformAfter: scene.renderer.contentEl.style.transform,
		overscan: run.ov,
	}
}

/**
 * G20 touch runs (synthetic touch PointerEvents, mode view): 'straight' and
 * 'diagonal' 30 × 12 px (the right edge, or right and bottom, exposed; the
 * first move beyond TAP_SLOP_PX as in touchPanSeries), 'long' 50 × 12 px,
 * 'pinch' a centred two-finger pinch-out from 500 to 300 px (k 0.6) in 30
 * frames.
 *
 * @param {'straight'|'diagonal'|'long'|'pinch'} kind run
 * @return {Promise<object>} edgeSummary
 */
async function edgeTouch(kind) {
	const run = await edgeStart('view')
	try {
		const x0 = vw / 2
		const y0 = vh / 2
		const n = kind === 'long' ? 50 : 30
		if (kind === 'pinch') {
			touch('pointerdown', 71, x0 - 250, y0)
			touch('pointerdown', 72, x0 + 250, y0)
		} else {
			touch('pointerdown', 71, x0, y0)
		}
		await frame()
		run.lastStatic = draws().static
		run.d0 = draws()
		let at = { x: x0, y: y0 }
		for (let i = 1; i <= n; i++) {
			if (kind === 'pinch') {
				const half = 250 - (100 * i) / n
				touch('pointermove', 71, x0 - half, y0)
				touch('pointermove', 72, x0 + half, y0)
				at = { x: x0 - half, y: y0, x2: x0 + half }
			} else {
				at = { x: x0 - 12 * i, y: kind === 'diagonal' ? y0 - 12 * i : y0 }
				touch('pointermove', 71, at.x, at.y)
			}
			await frame()
			edgeSample(run)
		}
		if (kind === 'pinch') touch('pointerup', 72, at.x2, at.y)
		touch('pointerup', 71, at.x, at.y)
		await idle()
		return edgeSummary(run)
	} finally {
		scene.setMode('edit')
	}
}

/**
 * G20 wheel run, start: run.mjs then sends real wheel steps
 * (page.mouse.wheel, no Ctrl) at the returned client point and calls
 * edgeWheelStep after each.
 *
 * @return {Promise<{x:number, y:number}>} client point (the viewport centre)
 */
async function edgeWheelBegin() {
	await edgeStart('edit')
	const b = container.getBoundingClientRect()
	return { x: b.left + vw / 2, y: b.top + vh / 2 }
}

/** G20 wheel run, after each wheel step: waits for the live camera to move, then one frame, then edgeSample. */
async function edgeWheelStep() {
	const run = edge.run
	run.stepAt.push(performance.now())
	const prev = run.lives.at(-1) ?? run.c0
	for (let i = 0; i < 30 && sameCamera(scene.stats().liveCamera, prev); i++) await frame()
	await frame()
	edgeSample(run)
}

/** @return {Promise<object>} G20 wheel run, end (run.mjs waited beyond WHEEL_END_MS): edgeSummary */
async function edgeWheelEnd() {
	await idle()
	return edgeSummary(edge.run)
}

/** G20 teardown: the band goes, mode edit, the camera back to centerNoteIds[0]. */
async function edgeTeardown() {
	scene.setMode('edit')
	const ids = edge.ids.filter((id) => model.has(id))
	if (ids.length) scene.update(model.apply({ removes: ids }))
	edge.ids = []
	edge.points = []
	edge.run = null
	await focusItem(meta.centerNoteIds[0], 1)
}

// ---------------------------------------------------------------- stage 3: follow, badges, vote input

/** @param {object} a draws @param {object} b draws @return {boolean} equal counts */
const sameDrawCounts = (a, b) => a.static === b.static && a.overlay === b.overlay
/** @param {object} a camera @param {object} b camera @return {boolean} equal within 1e-9 */
const sameCamera = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.scale - b.scale) < 1e-12

/**
 * Waits frame by frame until a promise settled (the scene's loop runs it).
 *
 * @param {Promise<any>} p promise
 * @param {number} [maxMs] timeout
 * @return {Promise<{value:any, ms:number|null}>} its value and the time from now to its settling
 */
async function settleWithFrames(p, maxMs = 5000) {
	const t0 = performance.now()
	let done = false
	let value
	let ms = null
	p.then((v) => {
		value = v
		done = true
		ms = performance.now() - t0
	})
	while (!done && performance.now() - t0 < maxMs) await frame()
	return { value: done ? value : null, ms }
}

/**
 * Gate G15 (SPEC-M1 §8.5, §6.3 "Folgen"): followTo over 600 ms within the
 * CSS-path rule (k = 1.2, translation below half the viewport): no Konva draw
 * while gliding, exactly one draw (the end draw of each non-empty layer,
 * while the CSS transform still stands) at the end, the target exactly, no
 * onUserCamera and no gesture activity. Reported: a long glide (5000 px),
 * where the renderer's gesture rule redraws in between.
 *
 * @return {Promise<object>}
 */
async function followGate() {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	await idle()
	const c0 = scene.getCamera()
	const st0 = scene.stats()
	const overlayNonEmpty = st0.activeChildren + st0.uiChildren > 0
	const target = { x: c0.x + 300, y: c0.y + 150, scale: 1.2 }
	const user0 = userCameraEvents
	const log0 = log.length
	const d0 = draws()
	const dl0 = drawLog.length
	const samples = []
	let result = null
	let tEnd = null
	const t0 = performance.now()
	scene.followTo(target, 600).then((v) => {
		result = v
		tEnd = performance.now()
	})
	while (result === null && performance.now() - t0 < 3000) {
		await frame()
		const st = scene.stats()
		samples.push({ gliding: st.gliding, css: st.cssTransform, draws: { ...st.draws }, confirmed: st.camera })
	}
	const endDraws = drawLog.slice(dl0)
	await idle()
	const st1 = scene.stats()
	const gliding = samples.filter((s) => s.gliding)
	// reported: a long glide over 5000 px at 100 % (translation beyond half the viewport: the gesture rule redraws in between)
	const c1 = scene.getCamera()
	const dl1 = drawLog.length
	const long = await settleWithFrames(scene.followTo({ x: c1.x + 5000, y: c1.y, scale: 1 }, 800))
	const longDraws = drawLog.slice(dl1)
	await focusItem(meta.centerNoteIds[0], 1)
	return {
		result,
		ms: tEnd !== null ? Math.round((tEnd - t0) * 10) / 10 : null,
		framesGliding: gliding.length,
		drawsWhileGliding: gliding.filter((s) => !sameDrawCounts(s.draws, d0)).length,
		cssWhileGliding: gliding.filter((s) => s.css !== null).length,
		confirmedWhileGliding: gliding.every((s) => sameCamera(s.confirmed, c0)),
		endDraws: {
			static: endDraws.filter((x) => x.layer === 'static').length,
			overlay: endDraws.filter((x) => x.layer === 'overlay').length,
			underTransform: endDraws.every((x) => x.transform !== ''),
		},
		afterIdle: { static: st1.draws.static - d0.static, overlay: st1.draws.overlay - d0.overlay },
		overlayNonEmpty,
		exact: sameCamera(st1.camera, target),
		camera: st1.camera,
		target,
		userCamera: userCameraEvents - user0,
		gestureActivity: log.slice(log0).filter((e) => e[0] === 'activity' && e[1].kind === 'gesture').length,
		cssAfter: st1.cssTransform,
		long: { result: long.value, ms: long.ms && Math.round(long.ms), staticDraws: longDraws.filter((x) => x.layer === 'static').length },
	}
}

/**
 * Follow semantics beyond G15 (SPEC-M1 §6.3 "Folgen" (2), (5)): a new
 * followTo replaces a glide (old false, new true, no draw in between, one
 * end draw); a pointerdown on the canvas (mode view: the press pans) and
 * stopFollow end a glide at the camera shown with one draw, false, no
 * onUserCamera.
 *
 * @return {Promise<object>}
 */
async function followChecks() {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	await idle()
	const c0 = scene.getCamera()
	const T1 = { x: c0.x + 400, y: c0.y, scale: 1 }
	const T2 = { x: c0.x - 200, y: c0.y + 200, scale: 0.9 }
	const out = {}
	// (2) replace
	let first = null
	const d0 = draws()
	scene.followTo(T1, 800).then((v) => { first = v })
	await frames(10)
	const pSecond = scene.followTo(T2, 300)
	const atReplace = draws()
	const second = await settleWithFrames(pSecond)
	await idle()
	out.replace = { first, second: second.value, noDrawBefore: sameDrawCounts(atReplace, d0), static: draws().static - d0.static, exact: sameCamera(scene.getCamera(), T2) }
	// (5) a pointerdown (mode view: the mouse pans there, no selection)
	scene.setMode('view')
	await idle()
	for (const kind of ['pointerdown', 'stopFollow']) {
		let res = null
		const u0 = userCameraEvents
		scene.followTo(T1, 800).then((v) => { res = v })
		await frames(8)
		const shown = scene.stats().liveCamera
		const d1 = draws()
		if (kind === 'pointerdown') mouse('pointerdown', 300, 300)
		else scene.stopFollow()
		const after = { camera: scene.getCamera(), gliding: scene.stats().gliding, draws: draws(), css: scene.stats().cssTransform }
		if (kind === 'pointerdown') mouse('pointerup', 300, 300)
		await frames(1)
		await idle()
		out[kind] = {
			result: res, atShown: sameCamera(after.camera, shown), gliding: after.gliding, css: after.css,
			static: after.draws.static - d1.static, userCamera: userCameraEvents - u0,
		}
		scene.setCamera(c0)
		await idle()
	}
	scene.setMode('edit')
	await focusItem(meta.centerNoteIds[0], 1)
	return out
}

/**
 * (1) With prefers-reduced-motion (run.mjs emulates it) followTo jumps:
 * true at once, no glide, no CSS transform.
 *
 * @return {Promise<object>}
 */
async function followReduced() {
	await focusItem(meta.centerNoteIds[0], 1)
	const c0 = scene.getCamera()
	const T = { x: c0.x + 500, y: c0.y - 100, scale: 1.5 }
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	const p = scene.followTo(T, 600)
	const gliding = scene.stats().gliding
	const camera = scene.getCamera()
	let css = 0
	for (let i = 0; i < 5; i++) {
		await frame()
		if (scene.stats().cssTransform !== null) css++
	}
	const result = await p
	await focusItem(meta.centerNoteIds[0], 1)
	return { reduce, result, gliding, atOnce: sameCamera(camera, T), css }
}

/**
 * @param {string} hex #rrggbb
 * @return {number} WCAG 2.x relative luminance (independent of src/model/tokens.js)
 */
function luminanceOf(hex) {
	const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
	const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** @param {string} a #rrggbb @param {string} b #rrggbb @return {number} WCAG contrast ratio */
function contrastRatio(a, b) {
	const la = luminanceOf(a)
	const lb = luminanceOf(b)
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** G16 board: 30 × 20 notes plus a frame around them, below the generated board (nothing else in view). */
const G16 = Object.freeze({ cols: 30, rows: 20, size: 200, gap: 20 })

/**
 * The G16 board: 30 × 20 notes in a frame below the generated board, with
 * the vote state of the gate (every other note an own badge of 1–3 votes,
 * the others an empty ring, all votable, the frame the scope). Used by the
 * gate G16 and by the badge rows of measure(); the caller removes it again
 * (model.apply({removes: [fid, ...ids]})).
 *
 * @return {{fid:string, ids:string[], frameBox:object, own:string[], rings:Set<string>,
 *           voteState:(color:string) => object}}
 */
function badgeGrid() {
	const b = model.allBounds()
	const x0 = b.x
	const y0 = b.y + b.h + 3000
	const step = G16.size + G16.gap
	const fid = ulid()
	const frameBox = { x: x0 - 100, y: y0 - 100, w: G16.cols * step + 180, h: G16.rows * step + 180 }
	const upserts = [{
		id: fid, t: 'frame', x: frameBox.x, y: frameBox.y, w: frameBox.w, h: frameBox.h, r: 0,
		z: keyBetween(model.maxZ('back'), null), parent: null, data: { title: 'G16' }, style: { fill: '#ffffff' },
	}]
	let z = model.maxZ('content')
	const ids = []
	for (let r = 0; r < G16.rows; r++) {
		for (let c = 0; c < G16.cols; c++) {
			z = keyBetween(z, null)
			const id = ulid()
			ids.push(id)
			upserts.push({ id, t: 'sticky', x: x0 + c * step, y: y0 + r * step, w: G16.size, h: G16.size, r: 0, z, parent: null, data: { text: '' }, style: { fill: '#a8d8f8' } })
		}
	}
	scene.update(model.apply({ upserts }))
	const own = ids.filter((_, i) => i % 2 === 0)
	const rings = new Set(ids.filter((_, i) => i % 2 === 1))
	const votable = new Set(ids)
	const badges = new Map(own.map((id, i) => [id, { mine: 1 + (i % 3), total: null }]))
	const voteState = (color) => ({ votable: (id) => votable.has(id), scope: fid, badges, markVotable: true, color })
	return { fid, ids, frameBox, own, rings, voteState }
}

/**
 * Gate G16 (SPEC-M1 §8.5): 300 own badges plus 300 empty rings
 * (markVotable) and the outline of the scope frame, all visible (600 notes
 * added below the board for the gate and removed after it):
 * - stats().voteState counts exactly that (CLI-03), at LOD 2 no rings
 * - a touch pan runs on the CSS path: no Konva draw and no DOM mutation
 *   besides the CSS transform of the content element while it runs, one end
 *   draw; after a pan the counters follow what is drawn
 * - digit contrast: for every PALETTE entry of src/sync/presence.js the
 *   digits drawn on an own circle (read from the canvas calls of the real
 *   overlay draw) reach ≥ 4.5 : 1; the total circle too
 * - reported: fps of the CSS-path pan and of a direct-path pan (a camera
 *   step per frame, the overlay with the badges redrawn every frame)
 *
 * @return {Promise<object>}
 */
async function badgeGate() {
	const { fid, ids, frameBox, own, rings, voteState } = badgeGrid()
	const out = { notes: ids.length, own: own.length, ringItems: rings.size }
	try {
		scene.setSelection([])
		const cam = scene.cameraForRect(frameBox, 24)
		scene.setCamera(cam)
		scene.setMode('vote')
		scene.setVoteState(voteState(PALETTE[0]))
		await idle()
		out.camera = scene.getCamera()
		out.lod = scene.stats().lod
		out.counts = scene.stats().voteState
		out.uiChildren = scene.stats().uiChildren
		// CSS path: a synthetic one-finger pan with a MutationObserver on the scene host
		const content = scene.renderer.contentEl
		const muts = []
		const mo = new MutationObserver((list) => {
			for (const m of list) {
				if (!(m.target === content && m.attributeName === 'style')) muts.push(`${m.type}:${m.attributeName ?? ''}:${m.target.nodeName}`)
			}
		})
		const refreshMs = await measureRefresh(20)
		const d0 = draws()
		const dl0 = drawLog.length
		mo.observe(container, { subtree: true, childList: true, attributes: true, characterData: true })
		const meter = new FrameMeter()
		meter.start()
		touch('pointerdown', 41, vw / 2, vh / 2)
		await frame()
		const during = []
		// the first move is beyond TAP_SLOP_PX: the pan starts with it (late start, SPEC-M1 §6.3)
		for (let i = 1; i <= 60; i++) {
			touch('pointermove', 41, vw / 2 - 6 * (i + 1), vh / 2 + 2 * (i + 1))
			await frame()
			const st = scene.stats()
			during.push({ css: st.cssTransform, active: st.gestureActive, draws: { ...st.draws } })
		}
		const cssFps = meter.stop(refreshMs)
		touch('pointerup', 41, vw / 2 - 366, vh / 2 + 122)
		const atEnd = drawLog.slice(dl0)
		await frames(2)
		muts.push(...mo.takeRecords().filter((m) => !(m.target === content && m.attributeName === 'style')).map((m) => `${m.type}:${m.attributeName ?? ''}`))
		mo.disconnect()
		await idle()
		out.cssPan = {
			frames: during.length,
			allCss: during.every((x) => x.css !== null && x.active),
			drawsDuring: during.filter((x) => !sameDrawCounts(x.draws, d0)).length,
			domMutations: muts.length,
			mutationSample: muts.slice(0, 5),
			endDraws: { static: atEnd.filter((x) => x.layer === 'static').length, overlay: atEnd.filter((x) => x.layer === 'overlay').length },
			fps: cssFps.fps,
			missed: cssFps.pctMissed,
		}
		// the counters follow what is drawn: half the grid out of view → fewer rings and badges
		scene.setCamera({ ...cam, x: cam.x + (0.6 * vw) / cam.scale })
		await idle()
		out.afterPan = scene.stats().voteState
		// direct path: a camera step per frame, the overlay with the badges redrawn each time (reported)
		scene.setCamera(cam)
		await idle()
		const series = await cameraSeries(120, (i) => scene.setCamera({ x: cam.x + (40 * Math.sin(i / 10)) / cam.scale, y: cam.y + (20 * Math.sin(i / 7)) / cam.scale, scale: cam.scale }), refreshMs)
		out.directPan = { fps: series.frames.fps, missed: series.frames.pctMissed, overlayDrawP50: series.draw.overlay.p50, overlayDrawP95: series.draw.overlay.p95 }
		scene.setCamera(cam)
		await idle()
		out.back = scene.stats().voteState
		// digit contrast on the canvas: the fillStyle of every fillText against the fill before it
		const native = scene.renderer.stage.getLayers()[1].getContext()._context
		const origFill = native.fill
		const origText = native.fillText
		let lastFill = null
		let pairs = []
		native.fill = function (...a) {
			lastFill = this.fillStyle
			return origFill.apply(this, a)
		}
		native.fillText = function (...a) {
			pairs.push({ circle: lastFill, digits: this.fillStyle, text: String(a[0]) })
			return origText.apply(this, a)
		}
		const contrast = []
		try {
			for (const color of PALETTE) {
				pairs = []
				scene.setVoteState(voteState(color))
				await idle()
				const ownPairs = pairs.filter((p) => p.circle === color.toLowerCase())
				const worst = Math.min(...pairs.map((p) => contrastRatio(p.circle, p.digits)))
				contrast.push({ color, own: ownPairs.length, pairs: pairs.length, digits: [...new Set(ownPairs.map((p) => p.digits))], worst: Math.round(worst * 100) / 100 })
			}
			// totals (results shown): the total circle and its digits
			pairs = []
			scene.setVoteState({ ...voteState(PALETTE[0]), badges: new Map(own.map((id) => [id, { mine: 0, total: 12 }])) })
			await idle()
			out.totals = {
				counts: scene.stats().voteState,
				pairs: pairs.length,
				worst: pairs.length ? Math.round(Math.min(...pairs.map((p) => contrastRatio(p.circle, p.digits))) * 100) / 100 : null,
			}
		} finally {
			native.fill = origFill
			native.fillText = origText
		}
		out.contrast = contrast
		// LOD 2: no rings, the outline stays
		scene.setVoteState(voteState(PALETTE[0]))
		scene.setCamera({ ...cam, scale: 0.06, x: frameBox.x + frameBox.w / 2 - vw / (2 * 0.06), y: frameBox.y + frameBox.h / 2 - vh / (2 * 0.06) })
		await idle()
		out.lod2 = { lod: scene.stats().lod, counts: scene.stats().voteState }
	} finally {
		scene.setVoteState(null)
		scene.setMode('edit')
		scene.update(model.apply({ removes: [fid, ...ids] }))
		await focusItem(meta.centerNoteIds[0], 1)
	}
	out.cleared = { voteState: scene.stats().voteState, uiChildren: scene.stats().uiChildren }
	return out
}

/**
 * Mode vote with real input (run.mjs clicks with Playwright's mouse): note
 * A votable, its neighbour B not; returns client points for A, B and empty
 * canvas, A's screen box, and clears the log.
 *
 * @return {Promise<object>}
 */
async function voteSetup() {
	const [A, B] = meta.centerNoteIds
	await focusItem(A, 1)
	scene.setSelection([])
	scene.setMode('vote')
	scene.setVoteState({ votable: (id) => id === A, scope: null, badges: new Map(), markVotable: true, color: '#1565c0' })
	await idle()
	const r = container.getBoundingClientRect()
	let empty = null
	const cam = scene.getCamera()
	for (let y = 100; y < vh - 100 && !empty; y += 20) {
		for (let x = 100; x < vw - 100 && !empty; x += 20) {
			if (model.hitTest(cam.x + x / cam.scale, cam.y + y / cam.scale, 30) === null) empty = { x: r.left + x, y: r.top + y }
		}
	}
	clearLog()
	voteBase = { user: userCameraEvents, camera: scene.getCamera(), A, B }
	return { A, B, a: clientCenter(A), b: clientCenter(B), empty, aRect: scene.itemScreenRect(A) }
}
let voteBase = null

/** @return {object} what the real clicks caused since voteSetup */
function voteResult() {
	return {
		intents: log.filter((e) => e[0] === 'intent').map((e) => e[1]),
		press: log.filter((e) => e[0] === 'activity' && e[1].kind === 'press').map((e) => e[1].active),
		userCamera: userCameraEvents - voteBase.user,
		cameraMoved: !sameCamera(scene.getCamera(), voteBase.camera),
		selection: scene.getSelection(),
	}
}

/**
 * Finger taps of mode vote (synthetic touch PointerEvents) on a 200 × 200
 * note alone below the board (earlier checks create items near the dense
 * centre): at 10 % it is 20 px, a tap zooms (onUserCamera, no vote), the
 * next tap votes. voteTeardown removes the note.
 *
 * @return {Promise<object>}
 */
async function voteTouch() {
	const b = model.allBounds()
	const A = ulid()
	const a = { x: b.x + 2000, y: b.y + b.h + 9000, w: 200, h: 200 }
	scene.update(model.apply({ upserts: [{ id: A, t: 'sticky', ...a, r: 0, z: keyBetween(model.maxZ('content'), null), parent: null, data: { text: 'tap' }, style: { fill: '#a8d8f8' } }] }))
	voteBase.touchNote = A
	scene.setVoteState({ votable: (id) => id === A, scope: null, badges: new Map(), markVotable: true, color: '#1565c0' })
	scene.setCamera({ x: a.x + a.w / 2 - vw / (2 * 0.1), y: a.y + a.h / 2 - vh / (2 * 0.1), scale: 0.1 })
	await idle()
	clearLog()
	const u0 = userCameraEvents
	const small = scene.itemScreenRect(A)
	const tapAt = (r) => {
		touch('pointerdown', 51, r.x + r.w / 2, r.y + r.h / 2)
		touch('pointerup', 51, r.x + r.w / 2, r.y + r.h / 2)
	}
	tapAt(small)
	await idle()
	const zoomed = scene.itemScreenRect(A)
	const afterZoom = { intents: log.filter((e) => e[0] === 'intent').length, userCamera: userCameraEvents - u0 }
	tapAt(zoomed)
	await idle()
	const out = {
		A, small, zoomed, afterZoom, lod: scene.stats().lod,
		intents: log.filter((e) => e[0] === 'intent').map((e) => e[1]),
		press: log.filter((e) => e[0] === 'activity' && e[1].kind === 'press').map((e) => e[1].active),
		userCamera: userCameraEvents - u0,
	}
	return out
}

/** Back to mode edit without a vote state. */
async function voteTeardown() {
	scene.setVoteState(null)
	scene.setMode('edit')
	if (voteBase?.touchNote && model.has(voteBase.touchNote)) scene.update(model.apply({ removes: [voteBase.touchNote] }))
	await focusItem(meta.centerNoteIds[0], 1)
	clearLog()
}

/**
 * Measurement mode (Phase 2 report, no gate): camera step and frame times.
 *
 * @return {Promise<object>}
 */
async function measure() {
	const refreshMs = await measureRefresh()
	const result = { refreshMs, firstRenderMs: firstStaticDrawAt !== null ? firstStaticDrawAt - tMount0 : null, loadMs }
	const run = async (name, steps, fn) => {
		result[name] = await cameraSeries(steps, fn, refreshMs)
	}
	await focusItem(meta.centerNoteIds[0], 1)
	const c0 = scene.getCamera()
	await run('pan', 180, (i) => scene.setCamera({ x: c0.x + i * 12, y: c0.y + Math.sin(i / 20) * 200, scale: 1 }))
	await focusItem(meta.centerNoteIds[0], 1)
	await run('zoom', 180, (i) => {
		const f = i < 90 ? 0.985 : 1 / 0.985
		scene.zoomBy(f)
	})
	await focusItem(meta.centerNoteIds[0], 1)
	const id = meta.centerNoteIds[0]
	const start = clientCenter(id)
	const mouse = (type, x, y) => container.dispatchEvent(new PointerEvent(type, {
		pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true,
		button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
	}))
	mouse('pointerdown', start.x, start.y)
	await run('drag', 120, (i) => mouse('pointermove', start.x + i * 4, start.y + Math.sin(i / 10) * 40))
	mouse('pointerup', start.x + 480, start.y)
	await idle()
	// SPEC-M1 §8.5 G12: the note with six connectors (re-routed in every frame in which the note moved)
	if (meta.hubNoteId) {
		await focusItem(meta.hubNoteId, 1)
		const hub = clientCenter(meta.hubNoteId)
		mouse('pointerdown', hub.x, hub.y)
		await run('connectorDrag', 120, (i) => mouse('pointermove', hub.x + i * 4, hub.y + Math.sin(i / 10) * 40))
		mouse('pointerup', hub.x + 480, hub.y)
		await idle()
	}
	// whole board (SPEC-M1 §8.5 "Zoom über das ganze Board bei 5 %", decision rule §8.8)
	result.fit = await fitRender()
	const lo = Math.log(result.fit.scale)
	const hi = Math.log(Math.min(2 * result.fit.scale, LOD_TEXT_SCALE))
	const fitCam = scene.getCamera()
	const mid = { x: fitCam.x + vw / (2 * fitCam.scale), y: fitCam.y + vh / (2 * fitCam.scale) }
	await run('board', 180, (i) => {
		const u = i < 90 ? i / 90 : (180 - i) / 90
		const s = Math.exp(lo + (hi - lo) * u)
		scene.setCamera({ x: mid.x - vw / (2 * s), y: mid.y - vh / (2 * s), scale: s })
	})
	result.board.scales = { from: result.fit.scale, to: Math.round(Math.exp(hi) * 10000) / 10000 }
	// SPEC-M1 §8.5 "Kamera-Schritt mit 800 Verbindern": the camera pans over the
	// whole board at the fit scale on a figure eight of ±BOARD_PAN_PX screen px.
	// The fit padding and the cull margin keep every item in view (all
	// connectors among them) and the scale stays constant (no LOD change). Up
	// to round 1b (LOD 1) every item was attached, each step the culling query
	// plus attaching; since stage 2 the fit scale is LOD 2: the culling query
	// over the whole board, one static node, the connectors in view but never
	// drawn. run.mjs --set noconn gives the same board without its connectors (A/B).
	scene.setCamera(fitCam)
	await idle()
	const connIds = new Set(meta.connectorIds)
	const connectorsAttached = () => scene.renderer.staticOrder().filter((k) => connIds.has(k)).length
	const connectorsInView = () => {
		const r = cullRectOf(scene.getCamera(), vw, vh, scene.stats().overscan, CULL_MARGIN)
		return model.query(r.minX, r.minY, r.maxX, r.maxY).filter((e) => connIds.has(e.id)).length
	}
	const connectorsAtStart = connectorsAttached()
	const inViewAtStart = connectorsInView()
	await run('boardPan', 180, (i) => {
		const a = (2 * Math.PI * i) / 180
		const s = fitCam.scale
		scene.setCamera({ x: fitCam.x + (BOARD_PAN_PX * Math.sin(a)) / s, y: fitCam.y + (BOARD_PAN_PX * Math.sin(2 * a)) / (2 * s), scale: s })
	})
	result.boardPan.view = {
		scale: fitCam.scale, panPx: BOARD_PAN_PX, items: model.size, connectors: connIds.size,
		connectorsAttached: { start: connectorsAtStart, end: connectorsAttached() },
		connectorsInView: { start: inViewAtStart, end: connectorsInView() },
	}
	// G14 (SPEC-M1 §8.5, stage 2): the zoom series around 0.08 (all scales below LOD2_ENTER)
	scene.setCamera(camAt(0.08))
	await idle()
	await run('lod2Zoom', LOD2_ZOOM.steps, (i) => scene.setCamera(camAt(lod2ZoomScale(i))))
	result.lod2Zoom.scales = { from: LOD2_ZOOM.from, to: LOD2_ZOOM.to }
	// stage 4 (SPEC-M1 §9.5 WP-S4, WebKit fixes; report only): the tablet's own
	// pan on the CSS path, follow (short within the CSS rule, long with draws
	// in between) and the badges of mode vote on a camera step per frame
	result.touchPan = await touchPanSeries(refreshMs)
	// job 034 (overscan): the long one-finger pan and the pinch-out on the CSS path
	result.touchPan1500 = await touchPan1500Series(refreshMs)
	result.pinchOut = await pinchOutSeries(refreshMs)
	result.followShort = await followSeries(FOLLOW_SHORT, refreshMs)
	result.followLong = await followSeries(FOLLOW_LONG, refreshMs)
	Object.assign(result, await badgeSeries(refreshMs))
	result.stats = scene.stats()
	return result
}

/** Follow rows of measure(): world offset, target scale, duration (G15 and its long glide). */
const FOLLOW_SHORT = Object.freeze({ dx: 300, dy: 150, scale: 1.2, ms: 600 })
const FOLLOW_LONG = Object.freeze({ dx: 5000, dy: 0, scale: 1, ms: 800 })

/**
 * @param {number} d0 drawLog index before the scenario
 * @return {{static:object, overlay:object}} draw time per layer since d0 (summarize)
 */
function drawsSince(d0) {
	const drawn = drawLog.slice(d0)
	const ms = (layer) => summarize(drawn.filter((x) => x.layer === layer).map((x) => x.ms))
	return { static: ms('static'), overlay: ms('overlay') }
}

/**
 * Stage-4 row: a one-finger pan at 100 % in mode view (as on a tablet) runs
 * on the CSS path, no Konva draw while it runs; the draw at its end is the
 * one a tablet waits for after every pan.
 *
 * @param {number} refreshMs idle rAF interval
 * @return {Promise<object>} frames, draws while panning, draw time at the end
 */
async function touchPanSeries(refreshMs) {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	scene.setMode('view')
	await idle()
	try {
		const d0 = drawLog.length
		const meter = new FrameMeter()
		meter.start()
		touch('pointerdown', 42, vw / 2, vh / 2)
		await frame()
		// 4 px per frame, the first move beyond TAP_SLOP_PX: the pan starts with it
		for (let i = 1; i <= 90; i++) {
			touch('pointermove', 42, vw / 2 - 4 * (i + 2), vh / 2 + 2 * (i + 2))
			await frame()
		}
		const frames = meter.stop(refreshMs)
		const drawsDuring = drawLog.length - d0
		touch('pointerup', 42, vw / 2 - 368, vh / 2 + 184)
		await idle()
		return { frames, drawsDuring, draw: drawsSince(d0 + drawsDuring) }
	} finally {
		scene.setMode('edit')
		await focusItem(meta.centerNoteIds[0], 1)
	}
}

/**
 * Job 034 rows (overscan): a CSS-path touch gesture in mode view from 100 %
 * on the dense frame, a one-finger pan of 1500 px (125 × 12 px; three draws
 * in between at M = 384) or a centred pinch-out from 500 to 300 px (k 0.6) in
 * 30 frames: frames, the draws per layer while it runs, the draw time per
 * layer (in between and at the end).
 *
 * @param {'pan'|'pinch'} kind gesture
 * @param {number} refreshMs idle rAF interval
 * @return {Promise<object>} frames, drawsDuring {static, overlay}, draw time per layer, scale at the end, overscan
 */
async function cssGestureSeries(kind, refreshMs) {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	scene.setMode('view')
	await idle()
	try {
		const d0 = drawLog.length
		const x0 = vw / 2
		const y0 = vh / 2
		const n = kind === 'pinch' ? 30 : 125
		const meter = new FrameMeter()
		meter.start()
		if (kind === 'pinch') {
			touch('pointerdown', 81, x0 - 250, y0)
			touch('pointerdown', 82, x0 + 250, y0)
		} else {
			touch('pointerdown', 81, x0, y0)
		}
		await frame()
		let half = 250
		for (let i = 1; i <= n; i++) {
			if (kind === 'pinch') {
				half = 250 - (100 * i) / n
				touch('pointermove', 81, x0 - half, y0)
				touch('pointermove', 82, x0 + half, y0)
			} else {
				touch('pointermove', 81, x0 - 12 * i, y0)
			}
			await frame()
		}
		const frames = meter.stop(refreshMs)
		const during = drawLog.slice(d0)
		if (kind === 'pinch') {
			touch('pointerup', 82, x0 + half, y0)
			touch('pointerup', 81, x0 - half, y0)
		} else {
			touch('pointerup', 81, x0 - 12 * n, y0)
		}
		await idle()
		return {
			kind, frames, drawsDuring: { static: during.filter((x) => x.layer === 'static').length, overlay: during.filter((x) => x.layer === 'overlay').length },
			draw: drawsSince(d0), scale: scene.getCamera().scale, overscan: scene.stats().overscan,
		}
	} finally {
		scene.setMode('edit')
		await focusItem(meta.centerNoteIds[0], 1)
	}
}

/** @param {number} refreshMs idle rAF interval @return {Promise<object>} the 1500-px one-finger pan (cssGestureSeries) */
const touchPan1500Series = (refreshMs) => cssGestureSeries('pan', refreshMs)
/** @param {number} refreshMs idle rAF interval @return {Promise<object>} the pinch-out to k 0.6 (cssGestureSeries) */
const pinchOutSeries = (refreshMs) => cssGestureSeries('pinch', refreshMs)

/**
 * Stage-4 row: a followTo glide from 100 % on the dense frame, frames while
 * it runs, the draws it causes (short: one at the end; long: the gesture
 * rule draws in between).
 *
 * @param {{dx:number, dy:number, scale:number, ms:number}} f glide
 * @param {number} refreshMs idle rAF interval
 * @return {Promise<object>} result, duration, frames, draw time per layer
 */
async function followSeries(f, refreshMs) {
	await focusItem(meta.centerNoteIds[0], 1)
	scene.setSelection([])
	await idle()
	const c0 = scene.getCamera()
	const d0 = drawLog.length
	const meter = new FrameMeter()
	meter.start()
	const r = await settleWithFrames(scene.followTo({ x: c0.x + f.dx, y: c0.y + f.dy, scale: f.scale }, f.ms), f.ms + 3000)
	const frames = meter.stop(refreshMs)
	await idle()
	const out = { glide: { ...f }, result: r.value, ms: r.ms === null ? null : Math.round(r.ms * 10) / 10, frames, draw: drawsSince(d0) }
	await focusItem(meta.centerNoteIds[0], 1)
	return out
}

/**
 * Stage-4 rows: the G16 board in mode vote (300 own badges + 300 empty rings
 * + the scope outline), a camera step per frame (the overlay with all badges
 * drawn every frame), then the same with a total on all 600 notes.
 *
 * @param {number} refreshMs idle rAF interval
 * @return {Promise<{badgePan:object, badgeTotalsPan:object}>}
 */
async function badgeSeries(refreshMs) {
	const grid = badgeGrid()
	const out = {}
	try {
		scene.setSelection([])
		const cam = scene.cameraForRect(grid.frameBox, 24)
		scene.setCamera(cam)
		scene.setMode('vote')
		const pan = (i) => scene.setCamera({ x: cam.x + (40 * Math.sin(i / 10)) / cam.scale, y: cam.y + (20 * Math.sin(i / 7)) / cam.scale, scale: cam.scale })
		scene.setVoteState(grid.voteState(PALETTE[0]))
		await idle()
		out.badgePan = { ...await cameraSeries(120, pan, refreshMs), counts: scene.stats().voteState, scale: cam.scale }
		const totals = new Map(grid.ids.map((id, i) => [id, { mine: i % 2 ? 0 : 1 + (i % 3), total: 10 + (i % 7) }]))
		scene.setVoteState({ ...grid.voteState(PALETTE[0]), badges: totals })
		await idle()
		out.badgeTotalsPan = { ...await cameraSeries(120, pan, refreshMs), counts: scene.stats().voteState, scale: cam.scale }
	} finally {
		scene.setVoteState(null)
		scene.setMode('edit')
		scene.update(model.apply({ removes: [grid.fid, ...grid.ids] }))
		await focusItem(meta.centerNoteIds[0], 1)
	}
	return out
}

/**
 * First render of the whole board: from the fit() camera step to the end of
 * the next static-layer draw (scene settled at 100 % before).
 *
 * @return {Promise<{ms: number|null, scale: number, attached: number, lod: number}>}
 */
async function fitRender() {
	await focusItem(meta.centerNoteIds[0], 1)
	const before = drawLog.length
	const t0 = performance.now()
	scene.fit()
	await idle()
	const hit = drawLog.slice(before).find((d) => d.layer === 'static')
	const st = scene.stats()
	return { ms: hit ? Math.round((hit.t - t0) * 10) / 10 : null, scale: st.camera.scale, attached: st.attached, lod: st.lod }
}

/**
 * Frame meter for a hand gesture on a real device (iPad session R-A,
 * SPEC-M1 §8.8): records rAF frames for ms while the user pans or pinches.
 *
 * @param {number} [ms] window
 * @return {Promise<object>} frames, draws during the window, LOD at the end
 */
async function meterFor(ms = 5000) {
	const refreshMs = await measureRefresh(20)
	const d0 = scene.stats().draws
	const meter = new FrameMeter()
	meter.start()
	await new Promise((resolve) => setTimeout(resolve, ms))
	const frames = meter.stop(refreshMs)
	const st = scene.stats()
	return { refreshMs, frames, draws: { static: st.draws.static - d0.static, overlay: st.draws.overlay - d0.overlay }, lod: st.lod, scale: st.camera.scale }
}

/**
 * Device facts the R-A protocol asks for (SPEC-M1 §8.8 point 3).
 *
 * @return {Promise<object>}
 */
async function device() {
	// smallest observable performance.now() increment over a 50 ms busy loop
	let step = Infinity
	let last = performance.now()
	const end = last + 50
	for (let t = last; t < end; t = performance.now()) {
		if (t > last) {
			step = Math.min(step, t - last)
			last = t
		}
	}
	return {
		userAgent: navigator.userAgent,
		devicePixelRatio: window.devicePixelRatio,
		viewport: { w: container.clientWidth, h: container.clientHeight },
		crossOriginIsolated: self.crossOriginIsolated === true,
		timerStepMs: Number.isFinite(step) ? Math.round(step * 1000) / 1000 : null,
		refreshMs: await measureRefresh(),
		items: model.size,
	}
}

window.__lab = {
	ready: true,
	meta,
	model,
	scene,
	spies,
	log,
	drawLog,
	errors,
	timings: { loadMs, mountToReadyMs: null },
	get cameraEvents() { return cameraEvents },
	get userCameraEvents() { return userCameraEvents },
	get lastPointer() { return lastPointer },
	stats: () => scene.stats(),
	camera: () => scene.getCamera(),
	draws,
	frames,
	idle,
	holdFrames,
	releaseFrames,
	visibleCount,
	clientCenter,
	focusItem,
	touch,
	orderCheck,
	emptySpotIn,
	setSamples: (s) => {
		samples = s
		scene.presenceChanged()
	},
	setViewOnly: (v) => scene.setViewOnly(v),
	setMode: (m, o) => scene.setMode(m, o),
	select: (ids) => scene.setSelection(ids),
	focusCanvas: () => scene.focusCanvas(),
	handles: () => scene.handles(),
	mouse,
	transformDrag,
	measureTexts,
	connectorDrag,
	snapDrag,
	gapDrag,
	resizeSnap,
	gridCheck,
	routeCheck,
	labelCheck,
	lod2Gate,
	lod2Targets,
	lod2TitleTargets,
	coarsePaintCheck,
	firstRenderAt,
	camAt,
	TRANSFORM_LIVE_MAX,
	editor: () => document.querySelector('textarea[data-knorke-editor]'),
	nodeText: (id) => scene.renderer.nodeText(id),
	staticOrder: () => scene.renderer.staticOrder(),
	layersListening: () => scene.renderer.stage.getLayers().map((l) => l.listening()),
	clearLog,
	clearDrawLog: () => { drawLog.length = 0 },
	panAcross,
	touchPan,
	pinchLiftPan,
	cursorQuiet,
	updatesCheck,
	measure,
	followGate,
	followChecks,
	followReduced,
	badgeGate,
	voteSetup,
	voteResult,
	voteTouch,
	voteTeardown,
	canvasMemory,
	overscanCheck,
	overscanResizeCheck,
	edgeSetup,
	edgeTouch,
	edgeWheelBegin,
	edgeWheelStep,
	edgeWheelEnd,
	edgeTeardown,
	meterFor,
	device,
}

idle().then(() => {
	window.__lab.timings.mountToReadyMs = performance.now() - tMount0
	window.__lab.settled = true
	// measurement panel for a device without a console (iPad session R-A): ?panel=1
	if (params.get('panel') === '1') mountPanel(window.__lab)
})
