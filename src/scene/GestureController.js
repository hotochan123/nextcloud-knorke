/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Camera gestures (SPEC-M0 §6.3, ERGEBNIS correction 8). Two paths:
 *
 * - CSS path, for the wheel (pan, and zoom with Ctrl/⌘ or a trackpad pinch)
 *   and for EVERY touch gesture (one-finger pan, pinch, and switching between
 *   them). While it runs the controller only reports a live camera
 *   (onGestureFrame); the scene moves the already drawn canvas with a CSS
 *   transform and leaves Konva alone. onGestureEnd hands over the final
 *   camera, which the scene draws once, synchronously.
 *   A wheel gesture starts with the first event and ends wheelEndMs after the
 *   last one. A touch gesture runs while any of its fingers is down: pinch →
 *   one finger lifts → the other keeps panning in the SAME gesture, with its
 *   current position as the new reference.
 * - direct path, for mouse and pen only: the hand tool, the space bar, the
 *   middle button and, in view-only mode (modes view and vote), every plain
 *   drag with the left button or the pen (the scene's wantsPan decides). In
 *   mode vote every left-button or pen press, hand tool and space bar
 *   included, starts the pan only beyond the deferPan threshold (3 px mouse,
 *   10 px pen; see "Taps and the late start" below); the middle button pans
 *   at once. onDirect(camera) on every move; the scene applies it once per
 *   animation frame. Each move pans the CURRENT confirmed camera by the
 *   pointer delta since the previous move, so a camera change during the pan
 *   (zoom key, fit, setCamera) is kept instead of being reverted.
 *
 * The two paths never run at the same time (each would start from a camera
 * the other one is about to replace, and the view would snap back when the
 * other one ends):
 * - a mouse/pen pan that starts during a wheel gesture ends it first
 *   (commit), so the pan continues from the camera the user sees; a touch
 *   gesture ends at every pen press (below);
 * - wheel events during a mouse/pen pan (or a touch gesture) are swallowed,
 *   e.g. trackpad momentum or a free-spinning wheel.
 *
 * The pen goes first (job 134, pen tablets without palm rejection): a pen
 * press is a pointerdown of a pen or a mouse with button 0 or 1 on the
 * canvas (not ignoreTarget), whatever it does (pan, drag, marquee, create,
 * connect, transform, a tap in mode vote), until the pointerup or
 * pointercancel of that pointer or a pointermove of it with buttons 0 (a
 * missed pointerup); cancel() does not end it, destroy() forgets it. Its
 * pointer is captured at the pointerdown. At its pointerdown every finger
 * that is down loses its effect until it lifts: a pending finger is no
 * longer pending (no pan, tap or hold signal), a claimed one no longer
 * claimed (the input controller ends its press itself), and a running touch
 * gesture ends at once with a commit (this controller listens before the
 * input controller, which so maps the pen point with the camera shown).
 * Then the press runs as without fingers (wantsPan: the pan starts). A
 * touch that lands during a pen press (palm, second device) is ignored
 * until it lifts: claimTouch is not asked, no gesture, tap or hold timer.
 *
 * A first touch on an item in edit mode may be claimed by the input
 * controller (claimTouch → true) for selection and dragging; (H1, SPEC-M1
 * §35) with a create tool or the connector any first touch in edit mode is
 * claimed (it creates like the mouse, no pan). A second finger
 * cancels that claim (cancelClaim: the input controller aborts a finger's
 * press like Esc) and both fingers belong to a new pinch. In view-only
 * mode nothing is ever claimed.
 *
 * Hold, then drag (SPEC-M1 §6.3 (R38) "Halten, dann Ziehen"): a first
 * finger that becomes pending outside view-only mode starts a hold timer of
 * LONG_PRESS_MS (setTimer; only when the longPress option is given). A move
 * beyond TAP_SLOP_PX, its pointerup or pointercancel, a second finger, any
 * mouse or pen pointerdown (the pen goes first: a palm resting on the
 * screen gets no hold signal), cancel() and destroy() clear it, and
 * nothing happens. When it runs out
 * while the finger is still the pending one (and the mode is still not
 * view-only), longPress(pointerId, p) is asked exactly once, p = the
 * container point of its pointerdown. true: the input controller took the
 * finger (a marquee with the hold signal); from now on it counts as claimed
 * (not pending, owns false, isClaimed true; a second finger cancels it like
 * any claim). false: it stays pending (a move pans as before, its release
 * is no tap since it lasted longer than TAP_MS). Only the timer decides: no
 * move starts a marquee without the signal before it.
 *
 * Taps and the late start (SPEC-M1 §6.3 "Tipp-Erkennung", stage 3): a first
 * touch that is not claimed does NOT start the CSS path at once. It stays
 * pending until it moves more than TAP_SLOP_PX from its pointerdown; then
 * the one-finger pan starts and its first frame already covers the whole
 * way since the pointerdown (M0-E11: a 200-px swipe pans 200 / scale). A
 * pending finger that lifts within TAP_MS without a second finger is a tap
 * (onTap(e), no gesture, no draw); a second finger turns it into a pinch
 * (the first finger's way so far pans first, as in M0). No double tap. A
 * mouse/pen press that wantsPan pans at once (M0), unless deferPan(e) gives
 * it a threshold (the scene does that for button 0 in mode vote): then the
 * pan starts only beyond that threshold (again from the pointerdown) and a
 * release before it is a click (onTap(e); a pen within TAP_MS, like a
 * finger). beforeStart() runs right before any CSS gesture or pan starts,
 * before the camera is read (the scene ends a follow glide there).
 *
 * The controller is DOM-light on purpose: it only needs addEventListener,
 * getBoundingClientRect and (optionally) setPointerCapture on `el`, so the
 * state machine runs in Node with synthetic events (tests/js/scene/gesture.test.mjs).
 */
import { MAX_SCALE, MIN_SCALE } from '../model/tokens.js'
import { clampScale, zoomCamera } from './Camera.js'

/** @typedef {{x:number, y:number, scale:number}} CameraState */

/** Zoom speed of the wheel: factor = exp(-deltaY * WHEEL_ZOOM). */
export const WHEEL_ZOOM = 0.0015
/** A wheel gesture ends this long after the last event. */
export const WHEEL_END_MS = 120
/** Pixels per line for deltaMode 1 (DOM_DELTA_LINE). */
const LINE_PX = 16
/** A first finger (and a deferred pen press) moving at most this far from its pointerdown is still a tap. */
export const TAP_SLOP_PX = 10
/** A tap (finger, deferred pen press) lasts at most this long. */
export const TAP_MS = 500
/** A pending first finger held still this long asks longPress (hold, then drag: the touch marquee). */
export const LONG_PRESS_MS = 500

const noop = () => {}

export class GestureController {
	#el
	#o
	/** @type {null|'wheel'|'touch'} */
	#mode = null
	/** @type {CameraState|null} */
	#c1 = null
	/** all touch pointers that are down, in container coordinates @type {Map<number, {x:number, y:number}>} */
	#touches = new Map()
	/** touch pointers the input controller handles @type {Set<number>} */
	#claimed = new Set()
	/** touch pointers of the running gesture (at most two are used) @type {number[]} */
	#gp = []
	/** reference for the touch gesture: camera plus one point or midpoint + distance */
	#ref = null
	/** mouse/pen pan; `last` = pointer position of the previous move @type {null|{id:number, last:{x:number, y:number}}} */
	#direct = null
	/** a first touch below TAP_SLOP_PX: no gesture yet (container px at its pointerdown) @type {null|{id:number, x:number, y:number, t0:number}} */
	#pendingTouch = null
	/** a mouse/pen press whose pan waits for its threshold (deferPan) @type {null|{id:number, x:number, y:number, t0:number, slop:number, type:string}} */
	#armed = null
	/** pointers of the running pen presses (pen or mouse, button 0 or 1): fingers are inert meanwhile @type {Set<number>} */
	#pens = new Set()
	#wheelTimer = null
	/** hold timer of the pending first finger (LONG_PRESS_MS), null while none runs */
	#holdTimer = null
	#rect = null
	#listeners = []

	/**
	 * @param {EventTarget & {getBoundingClientRect():DOMRect}} el scene container
	 * @param {object} opts callbacks and options
	 * @param {() => CameraState} opts.getCamera confirmed camera (read when a gesture starts and on every mouse/pen pan move)
	 * @param {() => boolean} [opts.viewOnly] true in view-only mode (no touch is ever claimed)
	 * @param {(e:PointerEvent) => boolean} [opts.claimTouch] true when the input controller takes a first touch
	 * @param {() => void} [opts.cancelClaim] a second finger arrived: the input controller aborts a finger's press like Esc
	 * @param {(e:PointerEvent) => boolean} [opts.wantsPan] mouse/pen pointerdown that pans, at once or, with
	 *   deferPan, beyond its threshold (the scene: the hand tool, the space bar, the middle button and, in
	 *   view-only mode (modes view and vote), every press with the left button or the pen)
	 * @param {(e:Event) => boolean} [opts.ignoreTarget] events from overlay controls (editor, chip buttons)
	 * @param {(cam:CameraState) => void} [opts.onDirect] direct path: new camera
	 * @param {() => void} [opts.onDirectStart] direct pan started
	 * @param {() => void} [opts.onDirectEnd] direct pan ended
	 * @param {(c0:CameraState) => void} [opts.onGestureStart] CSS path started at camera c0
	 * @param {(c1:CameraState) => void} [opts.onGestureFrame] live camera changed
	 * @param {(c1:CameraState) => void} [opts.onGestureEnd] gesture over, c1 becomes the confirmed camera
	 * @param {(e:PointerEvent) => void} [opts.onTap] a tap (finger) or a click/tap of a deferred mouse/pen press, at its pointerup
	 * @param {(e:PointerEvent) => number} [opts.deferPan] mouse/pen pointerdown that wantsPan: threshold in px
	 *   before the pan starts (0 or none = at once, M0)
	 * @param {() => void} [opts.beforeStart] right before a CSS gesture or a pan starts (before the camera is read)
	 * @param {(pointerId:number, p:{x:number, y:number}) => boolean} [opts.longPress] a pending first finger was
	 *   held still for LONG_PRESS_MS (p = its pointerdown point, container px): true when the input controller
	 *   takes it (none: no hold timer, a finger held still stays pending, as with an answer false)
	 * @param {() => number} [opts.now] clock in ms (tap duration)
	 * @param {number} [opts.minScale] zoom range
	 * @param {number} [opts.maxScale] zoom range
	 * @param {number} [opts.wheelEndMs] idle time that ends a wheel gesture
	 * @param {(fn:Function, ms:number) => any} [opts.setTimer] timer (tests inject fakes)
	 * @param {(h:any) => void} [opts.clearTimer] timer
	 */
	constructor(el, opts) {
		this.#el = el
		this.#o = {
			viewOnly: () => false,
			claimTouch: () => false,
			cancelClaim: noop,
			wantsPan: () => false,
			ignoreTarget: () => false,
			onDirect: noop,
			onDirectStart: noop,
			onDirectEnd: noop,
			onGestureStart: noop,
			onGestureFrame: noop,
			onGestureEnd: noop,
			onTap: noop,
			deferPan: () => 0,
			beforeStart: noop,
			longPress: null,
			now: () => performance.now(),
			minScale: MIN_SCALE,
			maxScale: MAX_SCALE,
			wheelEndMs: WHEEL_END_MS,
			setTimer: (fn, ms) => setTimeout(fn, ms),
			clearTimer: (h) => clearTimeout(h),
			...opts,
		}
		this.#listen('wheel', this.#onWheel, { passive: false })
		this.#listen('pointerdown', this.#onDown)
		this.#listen('pointermove', this.#onMove)
		this.#listen('pointerup', this.#onUp)
		this.#listen('pointercancel', this.#onUp)
		// WebKit's own pinch zoom
		this.#listen('gesturestart', (e) => e.preventDefault())
	}

	/** @return {boolean} true while a CSS-path gesture runs */
	get active() {
		return this.#mode !== null
	}

	/** @return {null|'wheel'|'touch'} kind of the running CSS-path gesture */
	get mode() {
		return this.#mode
	}

	/** @return {CameraState|null} live camera of the running gesture */
	get live() {
		return this.#c1 ? { ...this.#c1 } : null
	}

	/** @return {boolean} true while a mouse/pen pan runs */
	get panning() {
		return this.#direct !== null
	}

	/**
	 * @return {boolean} true while a press may still become a camera gesture: a first finger
	 *   below TAP_SLOP_PX, or a deferred mouse/pen press below its threshold
	 */
	get pending() {
		return this.#pendingTouch !== null || this.#armed !== null
	}

	/**
	 * @param {number} pointerId pointer
	 * @return {boolean} true when this controller handles the pointer (the input controller must not)
	 */
	owns(pointerId) {
		return this.#gp.includes(pointerId) || this.#direct?.id === pointerId || this.#armed?.id === pointerId ||
			(this.#touches.has(pointerId) && !this.#claimed.has(pointerId))
	}

	/**
	 * @param {number} pointerId pointer
	 * @return {boolean} true for a touch the input controller claimed
	 */
	isClaimed(pointerId) {
		return this.#claimed.has(pointerId)
	}

	/** Ends a running gesture now (commit) and stops a direct pan and a hold timer. */
	cancel() {
		this.#clearHold()
		if (this.#mode !== null) {
			this.#end()
		}
		if (this.#direct) {
			this.#direct = null
			this.#o.onDirectEnd()
		}
	}

	destroy() {
		this.#o.clearTimer(this.#wheelTimer)
		this.#wheelTimer = null
		this.#clearHold()
		for (const [type, fn, options] of this.#listeners) {
			this.#el.removeEventListener(type, fn, options)
		}
		this.#listeners = []
		this.#mode = null
		this.#direct = null
		this.#pendingTouch = null
		this.#armed = null
		this.#pens.clear()
		this.#touches.clear()
		this.#claimed.clear()
		this.#gp = []
	}

	// ---------------------------------------------------------------- internals

	#listen(type, fn, options) {
		this.#el.addEventListener(type, fn, options)
		this.#listeners.push([type, fn, options])
	}

	/**
	 * @param {{clientX:number, clientY:number}} e event
	 * @return {{x:number, y:number}} container coordinates
	 */
	#local(e) {
		const r = this.#rect ?? this.#el.getBoundingClientRect()
		return { x: e.clientX - r.left, y: e.clientY - r.top }
	}

	#capture(e) {
		try {
			this.#el.setPointerCapture?.(e.pointerId)
		} catch {
			// synthetic or already released pointers cannot be captured
		}
	}

	/**
	 * @param {'wheel'|'touch'} mode gesture kind
	 */
	#start(mode) {
		this.#o.beforeStart()
		const c0 = this.#o.getCamera()
		this.#mode = mode
		this.#c1 = { x: c0.x, y: c0.y, scale: c0.scale }
		this.#rect = this.#el.getBoundingClientRect()
		this.#o.onGestureStart({ ...c0 })
	}

	#end() {
		this.#o.clearTimer(this.#wheelTimer)
		this.#wheelTimer = null
		const c = this.#c1
		this.#mode = null
		this.#gp = []
		this.#ref = null
		this.#rect = null
		this.#c1 = null
		this.#o.onGestureEnd({ ...c })
	}

	#frame() {
		this.#o.onGestureFrame({ ...this.#c1 })
	}

	#onWheel = (e) => {
		const zoom = e.ctrlKey || e.metaKey
		if (!zoom && this.#o.ignoreTarget(e)) {
			return // let the text editor scroll
		}
		e.preventDefault()
		if (this.#mode === 'touch' || this.#direct || this.#pendingTouch || this.#armed) {
			return // another gesture owns the camera (or a press may still become one)
		}
		if (this.#mode === null) {
			this.#start('wheel')
		}
		const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? (this.#rect?.height || 800) : 1
		let dx = (Number(e.deltaX) || 0) * unit
		let dy = (Number(e.deltaY) || 0) * unit
		const c = this.#c1
		if (zoom) {
			const p = this.#local(e)
			this.#c1 = zoomCamera(c, p.x, p.y, Math.exp(-dy * WHEEL_ZOOM), this.#o.minScale, this.#o.maxScale)
		} else {
			if (e.shiftKey && dx === 0) {
				dx = dy
				dy = 0
			}
			this.#c1 = { x: c.x + dx / c.scale, y: c.y + dy / c.scale, scale: c.scale }
		}
		this.#frame()
		this.#o.clearTimer(this.#wheelTimer)
		this.#wheelTimer = this.#o.setTimer(() => {
			this.#wheelTimer = null
			if (this.#mode === 'wheel') this.#end()
		}, this.#o.wheelEndMs)
	}

	#onDown = (e) => {
		if (e.pointerType === 'touch') {
			this.#touchDown(e)
			return
		}
		// (R38) a mouse or pen press goes first: a waiting finger (a resting palm) gets no hold signal
		this.#clearHold()
		const pen = (e.pointerType === 'pen' || e.pointerType === 'mouse') && (e.button === 0 || e.button === 1) && !this.#o.ignoreTarget(e)
		if (pen) {
			this.#penDown(e)
		}
		if (this.#direct || this.#armed || this.#mode === 'touch' || this.#pendingTouch || this.#o.ignoreTarget(e)) {
			return
		}
		if (!this.#o.wantsPan(e)) {
			return
		}
		if (e.button === 1) {
			e.preventDefault?.() // no autoscroll
		}
		if (this.#mode === 'wheel') {
			// commit the wheel camera first: the pan (or the click) continues from what the user sees
			this.#end()
		}
		if (!pen) this.#capture(e)
		const p = this.#local(e)
		const slop = Number(this.#o.deferPan(e))
		if (slop > 0) {
			this.#armed = { id: e.pointerId, x: p.x, y: p.y, t0: this.#o.now(), slop, type: e.pointerType }
			return
		}
		this.#beginDirect(e.pointerId, p)
	}

	/**
	 * A pen press starts (header, "The pen goes first"): its pointer is captured, and every
	 * finger that is down loses its effect until it lifts. A pending finger is dropped (no pan,
	 * tap or hold), a claimed one too (the input controller ends its press), a running touch
	 * gesture ends with a commit; the fingers leave #touches, so their moves and releases do
	 * nothing and no later finger pinches with them.
	 *
	 * @param {PointerEvent} e pointerdown of a pen or a mouse, button 0 or 1, on the canvas
	 */
	#penDown(e) {
		this.#pens.add(e.pointerId)
		this.#capture(e)
		this.#pendingTouch = null
		this.#claimed.clear()
		this.#touches.clear()
		if (this.#mode === 'touch') {
			this.#end()
		}
	}

	/**
	 * @param {number} id pointer
	 * @param {{x:number, y:number}} p container point the pan starts from
	 */
	#beginDirect(id, p) {
		this.#o.beforeStart()
		this.#direct = { id, last: { x: p.x, y: p.y } }
		this.#o.onDirectStart()
	}

	#touchDown(e) {
		if (this.#direct || this.#armed || this.#pens.size > 0 || this.#o.ignoreTarget(e)) {
			return // a mouse/pen pan or press runs: the pen goes first, this touch stays inert until it lifts
		}
		const id = e.pointerId
		this.#touches.set(id, this.#local(e))
		if (this.#mode === 'touch') {
			if (this.#gp.length < 2) {
				this.#gp.push(id)
				this.#reference()
			}
			this.#capture(e)
			return
		}
		const first = this.#pendingTouch
		if (first !== null) {
			// a second finger before the first moved: no tap, no hold; both fingers pinch
			this.#pendingTouch = null
			this.#clearHold()
			this.#startTouch(first)
			this.#gp.push(id)
			this.#reference()
			this.#capture(e)
			return
		}
		if (this.#claimed.size > 0) {
			// Another finger while a finger is claimed: cancelClaim aborts a finger's
			// press like Esc (InputController.cancelTouch; never during a pen press, which
			// keeps every finger out) and the fingers belong to a pinch.
			const held = [...this.#claimed].filter((k) => this.#touches.has(k))
			this.#claimed.clear()
			this.#o.cancelClaim()
			if (this.#mode === 'wheel') this.#end()
			this.#start('touch')
			this.#gp = [...held, id].slice(-2)
			this.#reference()
			this.#capture(e)
			return
		}
		if (this.#mode === 'wheel') {
			this.#end()
		}
		if (!this.#o.viewOnly() && this.#o.claimTouch(e)) {
			this.#claimed.add(id)
			return
		}
		this.#capture(e)
		const p = this.#touches.get(id)
		// late start: a pan only beyond TAP_SLOP_PX, a tap otherwise; held still, maybe a marquee
		this.#pendingTouch = { id, x: p.x, y: p.y, t0: this.#o.now() }
		this.#armHold(this.#pendingTouch)
	}

	/**
	 * Starts the hold timer of a pending first finger (not view-only, longPress given).
	 *
	 * @param {{id:number, x:number, y:number}} pt the pending touch
	 */
	#armHold(pt) {
		this.#clearHold()
		if (typeof this.#o.longPress !== 'function' || this.#o.viewOnly()) return
		this.#holdTimer = this.#o.setTimer(() => {
			this.#holdTimer = null
			this.#hold(pt)
		}, LONG_PRESS_MS)
	}

	#clearHold() {
		if (this.#holdTimer === null) return
		this.#o.clearTimer(this.#holdTimer)
		this.#holdTimer = null
	}

	/**
	 * The hold timer ran out: a finger that is still the pending one is offered
	 * to the input controller once; when it takes it, it counts as claimed.
	 *
	 * @param {{id:number, x:number, y:number}} pt the pending touch the timer was started for
	 */
	#hold(pt) {
		if (this.#pendingTouch !== pt || this.#o.viewOnly()) return
		if (this.#o.longPress(pt.id, { x: pt.x, y: pt.y }) !== true) return
		this.#pendingTouch = null
		this.#claimed.add(pt.id)
	}

	/**
	 * The one-finger pan of a pending touch starts: reference = the camera now
	 * and the finger's pointerdown point, so the first frame covers the whole
	 * way since the pointerdown.
	 *
	 * @param {{id:number, x:number, y:number}} first pending touch
	 */
	#startTouch(first) {
		this.#start('touch')
		this.#gp = [first.id]
		this.#ref = { cam: { ...this.#c1 }, p: { x: first.x, y: first.y } }
		const cur = this.#touches.get(first.id)
		if (cur && (cur.x !== first.x || cur.y !== first.y)) {
			this.#c1 = this.#fromRef()
			this.#frame()
		}
	}

	/** New reference: the live camera plus the current finger position(s). */
	#reference() {
		const pts = this.#gp.map((k) => this.#touches.get(k))
		const cam = { ...this.#c1 }
		if (pts.length >= 2) {
			const [a, b] = pts
			this.#ref = {
				cam,
				mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
				dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
			}
		} else {
			this.#ref = { cam, p: { ...pts[0] } }
		}
	}

	/** @return {CameraState} camera for the current finger positions */
	#fromRef() {
		const ref = this.#ref
		const pts = this.#gp.map((k) => this.#touches.get(k))
		if (pts.length >= 2 && ref.mid) {
			const [a, b] = pts
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
			const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
			const scale = clampScale(ref.cam.scale * dist / ref.dist, this.#o.minScale, this.#o.maxScale)
			const wx = ref.cam.x + ref.mid.x / ref.cam.scale
			const wy = ref.cam.y + ref.mid.y / ref.cam.scale
			return { x: wx - mid.x / scale, y: wy - mid.y / scale, scale }
		}
		const p = pts[0]
		return {
			x: ref.cam.x - (p.x - ref.p.x) / ref.cam.scale,
			y: ref.cam.y - (p.y - ref.p.y) / ref.cam.scale,
			scale: ref.cam.scale,
		}
	}

	#onMove = (e) => {
		if (e.pointerType === 'touch') {
			if (!this.#touches.has(e.pointerId)) return
			const p = this.#local(e)
			this.#touches.set(e.pointerId, p)
			const pt = this.#pendingTouch
			if (pt !== null && pt.id === e.pointerId) {
				if (Math.hypot(p.x - pt.x, p.y - pt.y) > TAP_SLOP_PX) {
					this.#pendingTouch = null
					this.#clearHold()
					this.#startTouch(pt)
				}
				return
			}
			if (this.#mode !== 'touch' || !this.#gp.includes(e.pointerId)) return
			this.#c1 = this.#fromRef()
			this.#frame()
			return
		}
		if (e.buttons === 0) {
			// no button down any more: a pointerup of this pen press was missed
			this.#pens.delete(e.pointerId)
		}
		const a = this.#armed
		if (a !== null && e.pointerId === a.id) {
			const p = this.#local(e)
			if (Math.hypot(p.x - a.x, p.y - a.y) <= a.slop) return
			// beyond the threshold: the pan starts at the pointerdown point, this move pans the whole way
			this.#armed = null
			this.#beginDirect(a.id, a)
		}
		const d = this.#direct
		if (d && e.pointerId === d.id) {
			const p = this.#local(e)
			const c = this.#o.getCamera()
			const dx = p.x - d.last.x
			const dy = p.y - d.last.y
			d.last = p
			this.#o.onDirect({ x: c.x - dx / c.scale, y: c.y - dy / c.scale, scale: c.scale })
		}
	}

	#onUp = (e) => {
		if (e.pointerType === 'touch') {
			const id = e.pointerId
			this.#touches.delete(id)
			this.#claimed.delete(id)
			const pt = this.#pendingTouch
			if (pt !== null && pt.id === id) {
				// never moved beyond TAP_SLOP_PX and no second finger: a tap when short (pointercancel never is)
				this.#pendingTouch = null
				this.#clearHold()
				if (this.#isTap(e, pt, TAP_SLOP_PX, true)) this.#o.onTap(e)
				return
			}
			const i = this.#gp.indexOf(id)
			if (i < 0 || this.#mode !== 'touch') return
			this.#gp.splice(i, 1)
			// A finger that is still down but was not used (third finger) joins.
			for (const k of this.#touches.keys()) {
				if (this.#gp.length >= 2) break
				if (!this.#gp.includes(k) && !this.#claimed.has(k)) this.#gp.push(k)
			}
			if (this.#gp.length === 0) {
				this.#end()
			} else {
				this.#reference()
			}
			return
		}
		this.#pens.delete(e.pointerId)
		const a = this.#armed
		if (a !== null && e.pointerId === a.id) {
			// released below its threshold: a click (mouse, any duration) or a tap (pen, within TAP_MS)
			this.#armed = null
			if (this.#isTap(e, a, a.slop, a.type !== 'mouse')) this.#o.onTap(e)
			return
		}
		if (this.#direct && e.pointerId === this.#direct.id) {
			this.#direct = null
			this.#o.onDirectEnd()
		}
	}

	/**
	 * @param {PointerEvent} e pointerup or pointercancel
	 * @param {{x:number, y:number, t0:number}} press where and when it went down
	 * @param {number} slop largest distance of the release from the pointerdown (px)
	 * @param {boolean} timed TAP_MS applies
	 * @return {boolean} a tap: a pointerup within slop (and within TAP_MS when timed)
	 */
	#isTap(e, press, slop, timed) {
		if (e.type !== 'pointerup') return false
		const p = this.#local(e)
		if (Math.hypot(p.x - press.x, p.y - press.y) > slop) return false
		return !timed || this.#o.now() - press.t0 <= TAP_MS
	}
}
