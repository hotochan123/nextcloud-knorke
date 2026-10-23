/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Pointer and keyboard logic of the scene (SPEC-M0 §6.3, v2 in SPEC-M1 §6.3,
 * §6.10) for everything that is not a camera gesture: selection (click,
 * Shift+click, marquee, Ctrl/⌘+A, Tab), dragging (threshold 3 px, only the
 * top-level selected items), transformer handles, the create tools, double
 * click → text editor, and the keyboard shortcuts.
 *
 * Mouse and pen arrive here unless the GestureController pans with them
 * (hand tool, space, middle button, view-only). Touch arrives here only when
 * the GestureController let this controller claim it (claimTouch: a first
 * finger on an item or a handle in edit mode; (H1, SPEC-M1 §35) with a
 * create tool or the connector any first finger, and the touchend of a
 * finger that created an item is cancelled: no click lands on the new
 * editor or the context bar). (R38, SPEC-M1 §6.3) A first finger held still
 * on empty canvas reaches it over claimLongPress when the GestureController's
 * hold timer runs out: with the select tool, no press running and nothing
 * (no handle, no item) under the pointerdown point it becomes a marquee
 * press that starts beyond TAP_SLOP_PX (not DRAG_THRESHOLD_PX) and replaces
 * the selection like a mouse marquee without Shift; the selection stays
 * until then. The scene shows the hold signal (host.holdSignal: ring and
 * vibration) at once; every end of that press (release, Esc, pointercancel,
 * a second finger, settle, destroy) hides the ring again (holdSignal(null)).
 * A mouse or pen pointerdown goes before every press a finger started (a
 * palm resting on a pen tablet: held on empty canvas, on an item, with a
 * create tool or the connector; job 134): that press ends like Esc (no
 * create, no connector, a drag springs back, a marquee goes, no intent; the
 * selection the finger set at its pointerdown stays) and the mouse or pen
 * works as usual; the finger stays without effect until it lifts, and the
 * GestureController keeps every finger out while the pen press runs. A
 * second finger (cancelTouch) aborts only a press a finger started, like
 * Esc; a mouse or pen press goes on.
 * In modes vote and view
 * nothing is selected, dragged or created here; (stage 3) a click or tap in
 * mode vote reaches the scene as GestureController.onTap, which asks hitAt()
 * for the item (SceneManager: vote, voteMiss, small-target zoom).
 *
 * Hit testing: transformer handles first, in screen space (HANDLE_PX for a
 * mouse, HANDLE_TOUCH_PX for touch and pen), then SceneModel.hitTest only
 * (4 px / scale for mouse and pen, 12 px / scale for touch). The controller
 * talks to the scene via a small host object; it never touches Konva.
 *
 * Keys v2 (WCAG 2.1.4): single keys (tools, Delete, arrows, Enter, Tab, Space,
 * zoom keys) work only while the canvas has the focus (the scene container,
 * tabindex 0; a click on the canvas focuses it, (R9) in mode edit a finger
 * too, and like a click it ends an open text editor with its commit; in vote
 * and view a finger does not focus). Ctrl/⌘ combinations stay window wide
 * (outside text fields and dialogs), Esc too. A key another listener already
 * cancelled (defaultPrevented) is left alone, except Esc on the canvas host
 * itself: Nextcloud's header menus (NcHeaderMenu, e.g. the notifications)
 * listen on the window before the scene and call preventDefault on every Esc
 * outside text fields (@nextcloud/vue useHotKey('Escape', …, { prevent:
 * true })), so honouring it there would leave Esc without effect for every
 * signed-in user. Ctrl/⌘+C/X/D fire
 * copy/cut/duplicate synchronously in the keydown with preventDefault, except
 * while the page has a DOM text selection (then the browser copies the text:
 * no intent, no preventDefault). Ctrl/⌘(+Shift)+V fires pasteKey
 * synchronously and WITHOUT preventDefault, so the DOM paste event follows.
 * (M2, SPEC-M1 §1.2 (R12)) G with the canvas focus toggles the background
 * grid (host.toggleGrid) in every mode, like a tool key without
 * preventDefault; not with Shift, Alt or Ctrl/⌘ (Ctrl/⌘+G and
 * Ctrl/⌘+Shift+G group and ungroup, below), not on auto-repeat and not
 * during a press.
 *
 * Connectors (round 1b, SPEC-M1 §6.3): the connector tool (L) turns a drag
 * into a new connector from the press point (a click creates nothing and
 * keeps the tool); a drag on a "+" handle (plus-t/r/b/l) does the same from
 * its anchor, a drag on an end handle (start, end) of a selected connector
 * re-targets that end. Ctrl/⌘ during such a drag suppresses snapping (also
 * when pressed or released without moving); Esc cancels. The marquee takes
 * a connector only when its route box lies completely inside.
 *
 * Snapping of a drag (M2, SPEC-M1 §1.2 (R12)): host.moveDrag gets {ctrl}
 * with every step; the scene snaps the dragged selection to the edges and
 * centres of the items in view unless ctrl is set. As for a connector,
 * Ctrl/⌘ pressed or released during the drag acts at once (moveDrag with
 * the last pointer position); the next pointer move reads the modifier from
 * the event again, so a missed keyup corrects itself. A resize with a
 * transformer handle snaps the same way: host.moveTransform gets {ctrl}
 * besides Shift and Alt, and Ctrl/⌘ pressed or released acts at once
 * (moveTransform with the last pointer position).
 *
 * LOD 2 (SPEC-M1 §6.3 R13 (c), host.coarse()): connectors are not drawn,
 * so a click, a double click, a touch claim and the marquee pass over them;
 * Ctrl/⌘+A and Tab still select them. (R14-13, rule (d)) A frame hits
 * there also in its painted title (host.coarseTitleAt): content under the
 * point wins (LOD 2 paints content above every frame and title); the title
 * wins over another frame hit only by its title band or border band (at LOD
 * 2 an invisible ≈ 2-px band and a 12-px zone around a 1-px line, while the
 * title is painted text; frames stacked with a small gap would otherwise
 * hide the lower title in the upper frame's border band). settle() ends a
 * press like a release (setMode with settle), cancel() like Esc.
 *
 * Context menu (SPEC-M1 §9.5 WP-S4 (R16), frozen in stage-4 step 4.2): the
 * intent {type:'contextMenu', id, at:[x, y]} (at in container px, like
 * vote.rect), only in mode edit. Pointer path, from the canvas's
 * contextmenu event, checked in this order:
 *  1. a contextmenu from an overlay control (the text editor, a chip button)
 *     or while a text editor is open: nothing at all, no preventDefault (the
 *     browser's own menu stays, e.g. spelling); every other contextmenu on
 *     the canvas gets preventDefault (no native menu over the board);
 *  2. modes vote and view: no intent (preventDefault only, as before);
 *  3. no pointerdown on the canvas since the last contextmenu, or the
 *     ContextMenu key / Shift+F10 since that pointerdown: the echo of the
 *     key (handled by the keydown below) or a synthetic event, no intent;
 *  4. a finger (the event's pointerType when the browser sets one, else the
 *     type of that pointerdown): no intent, no long press on touch;
 *  5. a press that already moved (drag, transform, connect, marquee, create
 *     drag) goes on, no intent; a touch gesture, a mouse/pen pan or a finger
 *     below the tap threshold: no intent; a wheel gesture or a follow glide
 *     ends first (host.menuReady: the camera shown becomes the confirmed one);
 *  6. a press that has not moved (macOS Ctrl+click and a pen held still both
 *     fire contextmenu after a button-0 pointerdown) is dropped like Esc
 *     before step 7: it starts no drag, marquee, transform, connect
 *     or create (with a create tool nothing is created; every tool stays);
 *  7. the item under the event point (same hit rules as a click, mouse
 *     tolerance): on a transformer handle of the selection (handleAt) the
 *     selection stays and id = the hit item when it is selected, else the
 *     last selected item; an item outside the selection is selected first
 *     (onSelection before onIntent); an item inside keeps the selection;
 *     empty canvas clears the selection like a click there, id = null.
 *     Modifier keys change nothing. at = the event point.
 * Keyboard path: the ContextMenu key or Shift+F10 (no Ctrl/⌘/Alt) with the
 * canvas focus, mode edit, no press and the conditions of 5 → preventDefault
 * on the keydown and the intent with id = the last selected item (the one
 * Tab treats as current) or null, at = host.menuAnchor (the midpoint of the
 * selection's screen box clamped into the container, the container centre
 * without a selection). A right-button pointerdown starts nothing here (no
 * pan, marquee or drag: button 0 only), it only focuses the canvas (which
 * ends an open text editor with its commit, like a click beside it).
 *
 * Locked items (M2, SPEC-M1 §1.2 "(R20) Sperren", model/locks.js): a press on
 * a locked item selects it by the usual rules (a click selects it alone,
 * Shift toggles, a click into a multi-selection narrows it on release); a
 * move past the threshold then does nothing at all (no drag, no marquee,
 * no camera move, for mouse, pen and finger alike: claimTouch takes the
 * finger as before). A drag of a selection moves only its unlocked
 * top-level items (the scene, beginDrag). The marquee and Ctrl/⌘+A skip
 * locked items (Shift keeps what was selected); Tab still reaches them
 * (the keyboard way to Unlock). Ctrl/⌘+Shift+L (window wide like the other
 * Ctrl/⌘ keys, outside text fields and dialogs) always gets preventDefault
 * and, in mode edit without a press, fires the intent {type: 'toggleLock'}.
 *
 * Groups (M2, SPEC-M1 §1.2 "(R20) Gruppieren", model/groups.js): a press
 * on X whose group G (members M) counts (groupOf), in mode edit with the
 * select tool:
 *   X not selected      → selection M with X last (a drag moves M);
 *                         Shift: M joins the selection whole
 *   selection = M       → a release without a drag narrows to [X] (second
 *                         click); a drag moves M; Shift: M leaves whole
 *   selection = [X]     → stays (a drag moves X alone); Shift: M leaves
 *   X selected, else    → a release without a drag selects M with X last;
 *                         a drag moves the selection; Shift: M leaves
 * Items without a group behave as before; a locked X selects by the same
 * rules and a move does nothing. A double click opens X's editor as before
 * (first click M, second [X], then the editor). The marquee takes every
 * member of a group it hits (locked ones left out); a right click on a
 * member outside the selection selects M first (X last). Enter on a
 * selection that is exactly one group is the keyboard way to the double
 * click (round 1, UX review): it narrows the selection to the current item
 * (the last one), like the second click, and then opens its editor when it
 * has a text path and is not locked. The group is no longer fully
 * selected afterwards, so the next Tab reaches the next member (WCAG
 * 2.1.1: every member's text is editable without a mouse).
 * Ctrl/⌘+G (without Shift and Alt) and Ctrl/⌘+Shift+G always get
 * preventDefault (else the browser finds on) and, in mode edit without a
 * press, fire {type: 'group'} and {type: 'ungroup'}.
 */
import { expandGroups, groupOf, isOneGroup } from '../model/groups.js'
import { isLocked } from '../model/locks.js'
import { textPathOf, typeInfo } from '../model/registry.js'
import { TOOLS } from '../model/tools.js'
import { FRAME_EDGE_HIT_PX, NUDGE, NUDGE_BIG } from '../model/tokens.js'
import { TAP_SLOP_PX } from './GestureController.js'

/** Movement (screen px) that turns a press into a drag, a marquee or a transform. */
export const DRAG_THRESHOLD_PX = 3
export const HIT_TOL_MOUSE_PX = 4
export const HIT_TOL_TOUCH_PX = 12
/** Smallest frame drawn with the frame tool; a smaller drag is a click (default size). */
export const MIN_FRAME_PX = 50
/** Smallest shape drawn with the shape tool (screen px); a smaller drag is a click (default size). */
export const MIN_SHAPE_PX = 10
/** Smallest wrap width drawn with the text tool (screen px); a smaller drag is a click (default width). */
export const MIN_TEXT_PX = 20

const KEY_ZOOM_STEP = 1.25
const TOOLS_BY_KEY = Object.freeze(Object.fromEntries(TOOLS.map((t) => [t.key, t.id])))
/** Handles that start a connector drag instead of a transform. */
const CONNECT_HANDLES = new Set(['plus-t', 'plus-r', 'plus-b', 'plus-l', 'start', 'end'])
const CREATE_TOOLS = new Set(['sticky', 'frame', 'shape', 'text'])
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'])
const ARROWS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] })

/**
 * True when keyboard shortcuts must not fire for this target: text fields,
 * editable content, and anything inside a dialog.
 *
 * @param {EventTarget|null} target event target
 * @return {boolean}
 */
export function ignoresShortcuts(target) {
	if (!target || target.nodeType !== 1) {
		return false
	}
	if (target.isContentEditable) {
		return true
	}
	const tag = target.tagName
	if (tag === 'TEXTAREA' || tag === 'SELECT') {
		return true
	}
	if (tag === 'INPUT' && !NON_TEXT_INPUTS.has(String(target.type || 'text').toLowerCase())) {
		return true
	}
	return !!target.closest?.('[role="dialog"], [aria-modal="true"], .modal-mask')
}

/**
 * @return {boolean} true while the page has a non-empty DOM text selection
 *   (marked page text, SPEC-M1 §6.3: Ctrl/⌘+C/X/D then belong to the browser)
 */
export function hasTextSelection() {
	try {
		const sel = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null
		return !!sel && sel.isCollapsed === false
	} catch {
		return false
	}
}

/**
 * @param {KeyboardEvent} e keydown
 * @return {boolean} the ContextMenu key or Shift+F10 (the keys that open a context menu)
 */
function isMenuKey(e) {
	return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey === true)
}

/**
 * @param {unknown} t item type
 * @return {boolean} a routed item (connector)
 */
function isLine(t) {
	return typeInfo(t).hit === 'line'
}

/**
 * @param {{x:number, y:number}} a corner
 * @param {{x:number, y:number}} b opposite corner
 * @return {{x:number, y:number, w:number, h:number}} normalized rectangle
 */
function rectOf(a, b) {
	return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export class InputController {
	#el
	#h
	#press = null
	#listeners = []
	#hover = null
	/**
	 * pointerType ('' when unknown) of the last pointerdown on the canvas; null after a
	 * contextmenu or a menu key (rule 3: a contextmenu without a pointerdown is no pointer's)
	 * @type {string|null}
	 */
	#menuDown = null
	/**
	 * (H1, SPEC-M1 §35) a finger just created an item: its touchend is
	 * cancelled, so the browser sends no compatibility mouse events and no
	 * click to the editor or context bar that now lies under the finger
	 * @type {boolean}
	 */
	#touchCreated = false

	/**
	 * @param {HTMLElement} el scene container
	 * @param {object} host scene services (see SceneManager#host)
	 */
	constructor(el, host) {
		this.#el = el
		this.#h = host
		this.#on(el, 'pointerdown', this.#onDown)
		this.#on(el, 'pointermove', this.#onMove)
		this.#on(el, 'pointerup', this.#onUp)
		this.#on(el, 'pointercancel', this.#onCancel)
		this.#on(el, 'pointerleave', this.#onLeave)
		this.#on(el, 'dblclick', this.#onDblClick)
		this.#on(el, 'contextmenu', this.#onContextMenu)
		this.#on(el, 'touchend', this.#onTouchEnd)
		this.#on(window, 'keydown', this.#onKeyDown)
		this.#on(window, 'keyup', this.#onKeyUp)
		this.#on(window, 'blur', () => this.#h.setSpace(false))
	}

	/** @return {boolean} true while a press (click, drag, marquee, create, transform) is in progress */
	get busy() {
		return this.#press !== null
	}

	/**
	 * GestureController asks whether a first touch belongs to this controller:
	 * yes in edit mode with the select tool when the finger hits a handle or
	 * an item; (H1, SPEC-M1 §35) yes anywhere with a create tool (sticky,
	 * text, shape, frame) or the connector, so a finger creates like the
	 * mouse (a touch device that also reports a fine pointer is in mode
	 * edit). The hand tool keeps the finger for the pan.
	 *
	 * @param {PointerEvent} e touch pointerdown
	 * @return {boolean}
	 */
	claimTouch(e) {
		const h = this.#h
		if (h.viewOnly() || this.#press !== null || h.isInteractiveTarget(e)) {
			return false
		}
		const tool = h.tool()
		if (CREATE_TOOLS.has(tool) || tool === 'connector') return true
		if (tool !== 'select') return false
		return this.#takenAt(h.local(e))
	}

	/**
	 * @param {{x:number, y:number}} sp container point
	 * @return {boolean} a finger there would hit a transformer handle or an item (claimTouch, claimLongPress)
	 */
	#takenAt(sp) {
		const h = this.#h
		return h.handleAt(sp, true) !== null || this.#hit(h.toWorld(sp), HIT_TOL_TOUCH_PX) !== null
	}

	/**
	 * (R38, SPEC-M1 §6.3) The GestureController's hold timer ran out for a
	 * pending first finger: it becomes a marquee press when the tool is
	 * select, no press runs and neither a handle nor an item lies under the
	 * pointerdown point (the hits of claimTouch, asked now: an item another
	 * client put there meanwhile counts). The press starts its marquee only
	 * beyond TAP_SLOP_PX and replaces the selection then (keep []); the
	 * selection stays until that. The scene shows the hold signal at once.
	 *
	 * @param {number} pointerId the finger
	 * @param {{x:number, y:number}} sp its pointerdown point, container px
	 * @return {boolean} true when this controller took the finger
	 */
	claimLongPress(pointerId, sp) {
		const h = this.#h
		if (h.viewOnly() || this.#press !== null || h.tool() !== 'select') return false
		const at = { x: sp.x, y: sp.y }
		if (this.#takenAt(at)) return false
		const w = h.toWorld(at)
		this.#press = { pid: pointerId, touch: true, coarse: true, sp: at, w, last: w, moved: false, mode: 'marquee-pending', keep: [], slop: TAP_SLOP_PX, hold: true }
		h.holdSignal(at)
		return true
	}

	/**
	 * The item a click or tap at a world point hits, by the same rules as a
	 * selection click (SceneModel.hitTest; at LOD 2 no connectors and a frame
	 * also by its painted title). The scene asks it for a vote in mode vote.
	 *
	 * @param {{x:number, y:number}} w world point
	 * @param {boolean} touch a finger (HIT_TOL_TOUCH_PX), else HIT_TOL_MOUSE_PX
	 * @return {string|null} item id
	 */
	hitAt(w, touch) {
		return this.#hit(w, touch ? HIT_TOL_TOUCH_PX : HIT_TOL_MOUSE_PX)
	}

	/**
	 * (R13) Ends the current press like a release (settled mode switch,
	 * SPEC-M1 §6.3 setMode): a drag, transform or connect drag commits with
	 * its intent; a marquee or a create drag just ends (nothing is created);
	 * a press that has not moved yet is dropped. The later pointerup finds no
	 * press.
	 */
	settle() {
		const p = this.#press
		if (!p) return
		this.#press = null
		if (p.hold) this.#h.holdSignal(null)
		if (p.mode === 'drag') {
			this.#h.endDrag(true)
		} else if (p.mode === 'transform') {
			this.#h.endTransform(true)
		} else if (p.mode === 'connect') {
			this.#h.endConnect(true)
		} else if (p.mode === 'marquee' || p.mode === 'frame' || p.mode === 'shape' || p.mode === 'text') {
			this.#h.setMarquee(null)
		}
	}

	/** Aborts the current press like Esc (view-only switch, resync; a second finger goes through cancelTouch). */
	cancel() {
		const p = this.#press
		if (!p) return
		this.#press = null
		if (p.hold) this.#h.holdSignal(null)
		if (p.mode === 'drag') {
			this.#h.endDrag(false)
		} else if (p.mode === 'transform') {
			this.#h.endTransform(false)
		} else if (p.mode === 'connect') {
			this.#h.endConnect(false)
		} else if (p.mode === 'marquee' || p.mode === 'frame' || p.mode === 'shape' || p.mode === 'text') {
			this.#h.setMarquee(null)
		}
	}

	/**
	 * A second finger arrived (the GestureController's cancelClaim): aborts the
	 * current press like cancel() only when a finger started it (claimTouch,
	 * claimLongPress); a mouse or pen press goes on (the GestureController does
	 * not even ask while one runs: a third contact during a pen drag is inert).
	 */
	cancelTouch() {
		if (this.#press?.touch === true) this.cancel()
	}

	destroy() {
		this.cancel()
		for (const [target, type, fn] of this.#listeners) {
			target.removeEventListener(type, fn)
		}
		this.#listeners = []
	}

	// ---------------------------------------------------------------- internals

	#on(target, type, fn) {
		target.addEventListener(type, fn)
		this.#listeners.push([target, type, fn])
	}

	/**
	 * @param {{x:number, y:number}} w world point
	 * @param {number} tolPx tolerance in screen px
	 * @return {string|null} item id; at LOD 2 never a connector (R13 (c): not drawn, not hit),
	 *   and a frame also by its painted title (R14-13)
	 */
	#hit(w, tolPx) {
		const s = this.#h.scale()
		const model = this.#h.model
		const tol = tolPx / s
		const opts = { edgeWorld: FRAME_EDGE_HIT_PX / s }
		if (!this.#h.coarse?.()) return model.hitTest(w.x, w.y, tol, opts)
		opts.accept = (id) => !isLine(model.get(id)?.t)
		const id = model.hitTest(w.x, w.y, tol, opts)
		const title = this.#h.coarseTitleAt?.(w, tol) ?? null
		if (title === null || title === id || !model.get(title)) return id
		// LOD 2 paints all frames with their titles first, then the content; a frame
		// the model hits is hit only by its title band or border band (never its inside)
		return id !== null && !typeInfo(model.get(id).t).container ? id : title
	}

	#capture(e) {
		try {
			this.#el.setPointerCapture?.(e.pointerId)
		} catch {
			// synthetic pointers cannot be captured
		}
	}

	#onDown = (e) => {
		const h = this.#h
		this.#touchCreated = false
		// context menu rule 3: a contextmenu after this pointerdown is this pointer's
		this.#menuDown = typeof e.pointerType === 'string' ? e.pointerType : ''
		// (R38, job 134) a mouse or pen goes before every press a finger started (a resting palm): it ends like Esc
		if (e.pointerType !== 'touch' && this.#press?.touch === true) this.cancel()
		if (h.isInteractiveTarget(e)) return
		// a click on the canvas focuses it (single keys need the canvas focus);
		// (R9) in mode edit a finger too (focus({preventScroll}) on the tabindex
		// div opens no on-screen keyboard), in vote/view a finger does not
		// (viewOnly() means "not edit": vote and view)
		if (e.pointerType !== 'touch' || !h.viewOnly()) h.focusCanvas()
		if (h.gestures.owns(e.pointerId)) return
		if (e.pointerType === 'touch' && !h.gestures.isClaimed(e.pointerId)) return
		if (this.#press !== null || e.button !== 0) return
		// a click beside the open editor ends it (with commit)
		h.finishEditor()
		if (h.viewOnly()) return
		const sp = h.local(e)
		const w = h.toWorld(sp)
		const base = { pid: e.pointerId, touch: e.pointerType === 'touch', coarse: e.pointerType === 'touch' || e.pointerType === 'pen', sp, w, last: w, moved: false }
		const tool = h.tool()
		if (tool === 'connector') {
			this.#press = { ...base, mode: 'connect-pending' }
			this.#capture(e)
			return
		}
		if (CREATE_TOOLS.has(tool)) {
			this.#press = { ...base, mode: tool }
			this.#capture(e)
			return
		}
		if (tool !== 'select') return
		const handle = h.handleAt(sp, e.pointerType === 'touch' || e.pointerType === 'pen')
		if (handle !== null) {
			this.#press = { ...base, mode: 'handle', handle }
			this.#capture(e)
			return
		}
		const sel = h.selection
		const hit = this.#hit(w, base.touch ? HIT_TOL_TOUCH_PX : HIT_TOL_MOUSE_PX)
		if (hit !== null) {
			// collapse: the selection a release without a drag sets (null: it stays)
			let collapse = null
			let canDrag = true
			const g = groupOf(h.model, hit)
			if (g === null) {
				if (e.shiftKey) {
					sel.toggle(hit)
					h.selectionChanged()
					canDrag = sel.has(hit)
				} else if (!sel.has(hit)) {
					sel.set([hit])
					h.selectionChanged()
				} else if (sel.size > 1) {
					collapse = [hit]
				}
			} else {
				// a group (M2, R20): its members M, the hit item last (header table); Sets, no scan per member
				const withHit = expandGroups(h.model, [hit])
				const inGroup = new Set(withHit)
				const selected = sel.values()
				const others = selected.filter((id) => !inGroup.has(id))
				const hitSelected = sel.has(hit)
				if (e.shiftKey) {
					sel.set(hitSelected ? others : [...others, ...withHit])
					h.selectionChanged()
					canDrag = !hitSelected
				} else if (!hitSelected) {
					sel.set(withHit)
					h.selectionChanged()
				} else if (others.length === 0 && selected.length === inGroup.size) {
					// the selection is exactly M: the second click narrows to X
					collapse = [hit]
				} else if (selected.length > 1) {
					collapse = withHit
				}
			}
			// a locked item is selected, but a move past the threshold does nothing (M2, R20)
			const held = isLocked(h.model.get(hit))
			this.#press = { ...base, mode: canDrag ? (held ? 'held' : 'pending') : 'none', hit, collapse }
		} else {
			const keep = e.shiftKey ? sel.values() : []
			if (!e.shiftKey && sel.clear()) h.selectionChanged()
			this.#press = { ...base, mode: 'marquee-pending', keep }
		}
		this.#capture(e)
	}

	#onMove = (e) => {
		const h = this.#h
		const p = this.#press
		if (!p || e.pointerId !== p.pid) {
			if (e.pointerType !== 'touch' && !h.isInteractiveTarget(e)) {
				const sp = h.local(e)
				const w = h.toWorld(sp)
				h.pointer([w.x, w.y])
				this.#hoverAt(sp)
			}
			return
		}
		const sp = h.local(e)
		const w = h.toWorld(sp)
		p.last = w
		if (!p.touch) h.pointer([w.x, w.y])
		// a held finger (R38) starts its marquee only beyond TAP_SLOP_PX: no jitter after the signal
		if (!p.moved && Math.hypot(sp.x - p.sp.x, sp.y - p.sp.y) > (p.slop ?? DRAG_THRESHOLD_PX)) {
			p.moved = true
		}
		if (!p.moved) return
		const cmods = { ctrl: e.ctrlKey || e.metaKey, coarse: p.coarse }
		switch (p.mode) {
		case 'handle':
			if (CONNECT_HANDLES.has(p.handle)) {
				if (h.beginConnectHandle(p.handle, p.w)) {
					p.mode = 'connect'
					h.moveConnect(w, cmods)
				} else {
					p.mode = 'none'
				}
			} else if (h.beginTransform(p.handle, p.w)) {
				p.mode = 'transform'
				h.moveTransform(w, { shift: e.shiftKey, alt: e.altKey, ctrl: cmods.ctrl })
			} else {
				p.mode = 'none'
			}
			break
		case 'connect-pending':
			if (h.beginConnect(p.w, cmods)) {
				p.mode = 'connect'
				h.moveConnect(w, cmods)
			} else {
				p.mode = 'none'
			}
			break
		case 'connect':
			h.moveConnect(w, cmods)
			break
		case 'transform':
			h.moveTransform(w, { shift: e.shiftKey, alt: e.altKey, ctrl: cmods.ctrl })
			break
		case 'held':
			// a press on a locked item that moved: nothing (no drag, no marquee, no pan)
			p.mode = 'none'
			break
		case 'pending':
			if (h.beginDrag(h.selection.values(), p.hit)) {
				p.mode = 'drag'
				h.moveDrag(w.x - p.w.x, w.y - p.w.y, { ctrl: cmods.ctrl })
			} else {
				p.mode = 'none'
			}
			break
		case 'drag':
			h.moveDrag(w.x - p.w.x, w.y - p.w.y, { ctrl: cmods.ctrl })
			break
		case 'marquee-pending':
			p.mode = 'marquee'
			this.#marquee(p, w)
			break
		case 'marquee':
			this.#marquee(p, w)
			break
		case 'frame':
		case 'shape':
		case 'text':
			h.setMarquee(rectOf(p.w, w), 'frame')
			break
		default:
			break
		}
	}

	/**
	 * Cursor over a transformer handle (mouse only, no press).
	 *
	 * @param {{x:number, y:number}} sp container point
	 */
	#hoverAt(sp) {
		const name = this.#h.tool() === 'select' && !this.#h.viewOnly() ? this.#h.handleAt(sp, false) : null
		if (name !== this.#hover) {
			this.#hover = name
			this.#h.setHoverHandle(name)
		}
	}

	/**
	 * Rubber band: items that intersect it; containers only when fully inside
	 * (otherwise a marquee started in a frame's empty inside would always grab the frame).
	 *
	 * @param {object} p press
	 * @param {{x:number, y:number}} w current world point
	 */
	#marquee(p, w) {
		const h = this.#h
		const rect = rectOf(p.w, w)
		h.setMarquee(rect, 'select')
		const model = h.model
		const inside = new Set(model.queryRect(rect, 'contain'))
		// containers and connectors only when completely inside; at LOD 2 no connectors (R13 (c))
		const whole = (t) => typeInfo(t).container || isLine(t)
		const coarse = !!h.coarse?.()
		// a hit member brings its whole group (M2, R20 Gruppieren); locked items never (M2, R20)
		const hits = model.queryRect(rect, 'intersect')
			.filter((id) => !(coarse && isLine(model.get(id).t)) && (!whole(model.get(id).t) || inside.has(id)))
		const ids = expandGroups(model, hits).filter((id) => !isLocked(model.get(id)))
		if (h.selection.set([...p.keep, ...ids])) {
			h.selectionChanged()
		}
	}

	#onUp = (e) => {
		const h = this.#h
		const p = this.#press
		if (!p || e.pointerId !== p.pid) return
		this.#press = null
		if (p.hold) h.holdSignal(null)
		switch (p.mode) {
		case 'pending':
		case 'held':
			if (p.collapse !== null && h.selection.set(p.collapse)) h.selectionChanged()
			break
		case 'drag':
			h.endDrag(true)
			break
		case 'transform':
			h.endTransform(true)
			break
		case 'connect':
			h.moveConnect(h.toWorld(h.local(e)), { ctrl: e.ctrlKey || e.metaKey, coarse: p.coarse })
			h.endConnect(true)
			break
		case 'marquee':
			h.setMarquee(null)
			break
		case 'sticky':
			h.intent({ type: 'create', t: 'sticky', at: { x: p.w.x, y: p.w.y }, rect: null })
			h.setToolFromScene('select')
			this.#touchCreated = p.touch
			break
		case 'frame':
		case 'shape':
		case 'text':
			this.#create(p)
			this.#touchCreated = p.touch
			break
		default:
			break
		}
	}

	/**
	 * (H1, SPEC-M1 §35) The touchend of a finger that just created an item:
	 * cancelled, because the browser would otherwise follow the tap with
	 * compatibility mouse events and a click at the finger's point, where the
	 * new item's editor or the context bar now lies (the mousedown moved the
	 * focus out of the editor, which ended it; the click hit a colour
	 * swatch). The mouse has no such echo: its mousedown comes before the
	 * item. Only after a create: a tap with the select tool keeps its click
	 * (two of them make the double tap that opens the editor). Never on an
	 * overlay control (editor, chip button): the creating finger never starts
	 * there (claimTouch), so such a touchend belongs to a later touch whose
	 * pointerdown the control stopped before it cleared the flag.
	 *
	 * @param {TouchEvent} e touchend
	 */
	#onTouchEnd = (e) => {
		if (!this.#touchCreated) return
		this.#touchCreated = false
		if (e.cancelable && !this.#h.isInteractiveTarget(e)) e.preventDefault()
	}

	/**
	 * Frame, shape or text tool released: a drag big enough gives a rect
	 * (text: its width is the wrap width), a click the default size (rect null).
	 *
	 * @param {object} p press
	 */
	#create(p) {
		const h = this.#h
		h.setMarquee(null)
		const r = rectOf(p.w, p.last)
		const s = h.scale()
		let big
		if (p.mode === 'frame') {
			big = p.moved && r.w * s >= MIN_FRAME_PX && r.h * s >= MIN_FRAME_PX && r.w >= MIN_FRAME_PX && r.h >= MIN_FRAME_PX
		} else if (p.mode === 'shape') {
			const [min] = typeInfo('shape').size
			big = p.moved && r.w * s >= MIN_SHAPE_PX && r.h * s >= MIN_SHAPE_PX && r.w >= min && r.h >= min
		} else {
			const [min] = typeInfo('text').size
			big = p.moved && r.w * s >= MIN_TEXT_PX && r.w >= min
		}
		const intent = { type: 'create', t: p.mode, at: { x: p.w.x, y: p.w.y }, rect: big ? r : null }
		if (p.mode === 'shape') {
			const o = h.toolOptions('shape')
			intent.data = { kind: o.kind }
		}
		h.intent(intent)
		h.setToolFromScene('select')
	}

	#onCancel = (e) => {
		if (this.#press && e.pointerId === this.#press.pid) {
			this.cancel()
		}
	}

	#onLeave = (e) => {
		if (e.pointerType !== 'touch' && !this.#press) {
			this.#h.pointer(null)
		}
	}

	#onDblClick = (e) => {
		const h = this.#h
		if (h.isInteractiveTarget(e) || h.viewOnly() || h.tool() !== 'select') return
		const w = h.toWorld(h.local(e))
		const id = this.#hit(w, HIT_TOL_MOUSE_PX)
		if (id === null) return
		const it = h.model.get(id)
		if (!textPathOf(it.t)) return
		if (typeInfo(it.t).hit === 'frameEdge' && w.y >= h.model.abs(id).y) {
			return // frames: only the title band edits the title
		}
		e.preventDefault()
		h.editFromUser(id)
	}

	/**
	 * The canvas's contextmenu event → intent contextMenu (rules 1–7 in the
	 * header; SPEC-M1 §9.5 WP-S4, step 4.2).
	 *
	 * @param {MouseEvent|PointerEvent} e contextmenu
	 */
	#onContextMenu = (e) => {
		const h = this.#h
		const down = this.#menuDown
		this.#menuDown = null
		// 1. overlay controls and an open text editor keep the browser's own menu (spelling)
		if (h.isInteractiveTarget(e) || h.editorOpen()) return
		e.preventDefault()
		// 2. mode edit only; 3. no pointerdown before it: a menu key's echo (the keydown handled it) or synthetic
		if (h.viewOnly() || down === null) return
		// 4. no long press on touch (pointerType of the event where the browser sets it, else of the pointerdown)
		const type = typeof e.pointerType === 'string' && e.pointerType !== '' ? e.pointerType : down
		if (type === 'touch') return
		// 5. a press that moved goes on; a user camera gesture: nothing; a wheel gesture or glide ends first
		const p = this.#press
		if ((p !== null && p.moved) || !h.menuReady()) return
		// 6. a press that has not moved (macOS Ctrl+click, a pen held still): no drag, marquee or create
		if (p !== null) this.cancel()
		// 7. the item under the point
		const sp = h.local(e)
		const sel = h.selection
		const hit = this.#hit(h.toWorld(sp), HIT_TOL_MOUSE_PX)
		let id = hit
		if (h.handleAt(sp, type === 'pen') !== null) {
			// a handle belongs to the selection: it stays
			const ids = sel.values()
			id = hit !== null && sel.has(hit) ? hit : ids[ids.length - 1] ?? null
		} else if (hit === null) {
			if (sel.clear()) h.selectionChanged()
		} else if (!sel.has(hit)) {
			// a member of a group (M2, R20): its members first, the hit item last
			sel.set(expandGroups(h.model, [hit]))
			h.selectionChanged()
		}
		h.intent({ type: 'contextMenu', id, at: [sp.x, sp.y] })
	}

	/**
	 * ContextMenu key or Shift+F10 with the canvas focus (keyboard path, header).
	 *
	 * @param {KeyboardEvent} e keydown
	 */
	#menuKey(e) {
		const h = this.#h
		if (h.viewOnly() || this.#press !== null || !h.menuReady()) return
		e.preventDefault()
		const ids = h.selection.values()
		h.intent({ type: 'contextMenu', id: ids[ids.length - 1] ?? null, at: h.menuAnchor(ids) })
	}

	#onKeyDown = (e) => {
		const h = this.#h
		// context menu rule 3: the contextmenu event a menu key may cause is that key's echo
		if (isMenuKey(e)) this.#menuDown = null
		if (this.#press?.mode === 'connect' && (e.key === 'Control' || e.key === 'Meta')) {
			// Ctrl/⌘ suppresses snapping at once, not only on the next move
			h.moveConnect(this.#press.last, { ctrl: true, coarse: this.#press.coarse })
			return
		}
		if (this.#press?.mode === 'drag' && (e.key === 'Control' || e.key === 'Meta')) {
			// the same for an item drag (R12): free at once, the next move reads the event again
			const p = this.#press
			h.moveDrag(p.last.x - p.w.x, p.last.y - p.w.y, { ctrl: true })
			return
		}
		if (this.#press?.mode === 'transform' && (e.key === 'Control' || e.key === 'Meta')) {
			// and for a resize (R12): the same pointer position, free at once
			h.moveTransform(this.#press.last, { shift: e.shiftKey, alt: e.altKey, ctrl: true })
			return
		}
		// Esc on the canvas host goes on even when a header menu of Nextcloud cancelled it (see above)
		const cancelled = e.defaultPrevented && !(e.key === 'Escape' && h.canvasFocused(e))
		if (cancelled || ignoresShortcuts(e.target) || e.isComposing) return
		const key = e.key
		const mod = e.ctrlKey || e.metaKey
		const lower = typeof key === 'string' ? key.toLowerCase() : ''
		const editable = !h.viewOnly()
		if (mod && !e.altKey) {
			this.#modKey(e, lower, editable)
			return
		}
		if (e.altKey) return
		if (key === 'Escape') {
			if (this.#press !== null) {
				this.cancel()
			} else if (h.selection.clear()) {
				h.selectionChanged()
			}
			return
		}
		// every other key is a single-key shortcut: only with the canvas focus
		if (!h.canvasFocused(e)) return
		if (isMenuKey(e)) {
			this.#menuKey(e)
			return
		}
		if (key === ' ' || e.code === 'Space') {
			e.preventDefault()
			if (!e.repeat) h.setSpace(true)
			return
		}
		if (e.shiftKey && e.code === 'Digit1') {
			e.preventDefault()
			h.userCamera('fit')
			return
		}
		if (e.shiftKey && e.code === 'Digit0') {
			e.preventDefault()
			h.userCamera('100')
			return
		}
		if (e.shiftKey && e.code === 'Digit2') {
			e.preventDefault()
			h.userCamera('selection')
			return
		}
		if (key === '+' || key === '=' || e.code === 'NumpadAdd') {
			e.preventDefault()
			h.userCamera('in')
			return
		}
		if (key === '-' || key === '_' || e.code === 'NumpadSubtract') {
			e.preventDefault()
			h.userCamera('out')
			return
		}
		if (key === 'Delete' || key === 'Backspace') {
			e.preventDefault()
			const ids = h.selection.values()
			if (editable && ids.length > 0 && this.#press === null) {
				h.intent({ type: 'delete', ids })
			}
			return
		}
		if (Object.prototype.hasOwnProperty.call(ARROWS, key)) {
			e.preventDefault()
			if (editable && this.#press === null) {
				const [ux, uy] = ARROWS[key]
				h.nudge(ux * (e.shiftKey ? NUDGE_BIG : NUDGE), uy * (e.shiftKey ? NUDGE_BIG : NUDGE))
			}
			return
		}
		if (key === 'Tab') {
			// no preventDefault after the last (before the first) item: Tab leaves the canvas (WCAG 2.1.2)
			if (editable && this.#press === null && h.tabSelect(e.shiftKey ? -1 : 1)) e.preventDefault()
			return
		}
		if (key === 'Enter') {
			const ids = h.selection.values()
			if (editable && ids.length === 1 && this.#press === null && textPathOf(h.model.get(ids[0])?.t)) {
				e.preventDefault()
				h.editFromUser(ids[0])
			} else if (editable && this.#press === null && isOneGroup(h.model, ids)) {
				// exactly one group (M2, R20): the keyboard way to the double click – narrow to
				// the current item like the second click, then its editor (when it may open)
				e.preventDefault()
				const cur = h.model.get(ids[ids.length - 1])
				if (h.selection.set([cur.id])) h.selectionChanged()
				if (textPathOf(cur?.t) && !isLocked(cur)) h.editFromUser(cur.id)
			}
			return
		}
		if (lower === 'g' && !e.shiftKey) {
			// the background grid (R12): a view setting of this person, in every mode
			if (!e.repeat && this.#press === null) h.toggleGrid()
			return
		}
		if (!e.shiftKey && Object.prototype.hasOwnProperty.call(TOOLS_BY_KEY, lower) && this.#press === null) {
			const tool = TOOLS_BY_KEY[lower]
			if (editable || tool === 'select' || tool === 'hand') {
				h.setToolFromScene(tool)
			}
		}
	}

	/**
	 * Ctrl/⌘ combinations (window wide, outside text fields and dialogs).
	 *
	 * @param {KeyboardEvent} e event
	 * @param {string} lower lower-case key
	 * @param {boolean} editable not view-only
	 */
	#modKey(e, lower, editable) {
		const h = this.#h
		if (lower === 'z' && !e.shiftKey) {
			e.preventDefault()
			if (editable && this.#press === null) h.intent({ type: 'undo' })
		} else if ((lower === 'z' && e.shiftKey) || (lower === 'y' && e.ctrlKey && !e.shiftKey)) {
			e.preventDefault()
			if (editable && this.#press === null) h.intent({ type: 'redo' })
		} else if (lower === 'a' && !e.shiftKey) {
			e.preventDefault()
			// every item but the locked ones (M2, R20)
			if (h.selection.set([...h.model.ids()].filter((id) => !isLocked(h.model.get(id))))) h.selectionChanged()
		} else if (lower === 'l' && e.shiftKey) {
			// lock or unlock the selection (M2, R20): always ours, like Ctrl/⌘+Z
			e.preventDefault()
			if (editable && this.#press === null) h.intent({ type: 'toggleLock' })
		} else if (lower === 'g') {
			// group (Shift: ungroup) the selection (M2, R20): always ours, else the browser finds on
			e.preventDefault()
			if (editable && this.#press === null) h.intent({ type: e.shiftKey ? 'ungroup' : 'group' })
		} else if ((lower === 'c' || lower === 'x' || lower === 'd') && !e.shiftKey) {
			// marked page text: the browser copies it, Knorke stays out (§6.3)
			if (hasTextSelection() || h.selection.size === 0 || this.#press !== null) return
			if (lower === 'c') {
				e.preventDefault()
				h.intent({ type: 'copy' })
			} else if (editable) {
				e.preventDefault()
				h.intent({ type: lower === 'x' ? 'cut' : 'duplicate' })
			}
		} else if (lower === 'v' && editable && this.#press === null) {
			// no preventDefault: the DOM paste event must follow (the session focuses its paste catcher now)
			h.intent({ type: 'pasteKey', inPlace: e.shiftKey })
		}
	}

	#onKeyUp = (e) => {
		if (e.key === ' ' || e.code === 'Space') {
			this.#h.setSpace(false)
		}
		if (this.#press?.mode === 'connect' && (e.key === 'Control' || e.key === 'Meta')) {
			this.#h.moveConnect(this.#press.last, { ctrl: false, coarse: this.#press.coarse })
		}
		if (this.#press?.mode === 'drag' && (e.key === 'Control' || e.key === 'Meta')) {
			const p = this.#press
			this.#h.moveDrag(p.last.x - p.w.x, p.last.y - p.w.y, { ctrl: false })
		}
		if (this.#press?.mode === 'transform' && (e.key === 'Control' || e.key === 'Meta')) {
			this.#h.moveTransform(this.#press.last, { shift: e.shiftKey, alt: e.altKey, ctrl: false })
		}
	}
}
